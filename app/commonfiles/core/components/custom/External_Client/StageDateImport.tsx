'use client';

import React, { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useSupabase } from '../../../providers/SupabaseProvider';
import toast from 'react-hot-toast';

const EXTERNAL_CLIENT_OBJECT_ID = '62803c4d-9430-4d19-a487-4370d52e062a';

// Mirrors ClientWorkflowBar.tsx's STAGES order — keep in sync if that array
// changes. Client_Registered is deliberately absent: it's handled via the
// dedicated set_stage2_registration_date RPC below, which sets status__a
// itself, so it never needs a place in this forward-only comparison.
const STAGE_PROGRESSION: { column: string; status: string }[] = [
  { column: 'Date__a',                            status: 'Application_Sent' },
  { column: 'Application_Accpeted_Date__a',       status: 'Application_Accepted' },
  { column: 'Quotation_Received_Date__a',         status: 'Quotation_Received' },
  { column: 'Client_Agreement_Signed_Date__a',    status: 'Client_Agreement_Signed' },
  { column: 'Stage_one_plan_Sent_Date__a',        status: 'Stage_one_plan_Sent' },
  { column: 'stage1_plan_accepted_date__a',       status: 'Stage1_Plan_Accepted' },
  { column: 'stage1_auditor_accepted_date__a',    status: 'Stage1_Auditor_Accepted' },
  { column: 'stage1_tech_final_accepted_date__a', status: 'Stage1_Complete' },
  { column: 'stage2_plan_sent_date__a',           status: 'Stage2_Plan_Sent' },
  { column: 'stage2_plan_accepted_date__a',       status: 'Stage2_Plan_Accepted' },
  { column: 'stage2_auditor_accepted_date__a',    status: 'Stage2_Auditor_Accepted' },
  { column: 'stage2_evidences_accepted_date__a',  status: 'Stage2_Evidences_Accepted' },
  { column: 'stage2_tech_findings_date__a',       status: 'Stage2_Tech_Findings_Given' },
  { column: 'cdc_date__a',                        status: 'CDC_Approved' },
];

// Excel label (col A, case-insensitive) -> external_clients__a column.
// stage1_audit_date__a / stage2_audit_date__a are free-text manual fields
// with no status implication (per S3/S4 design notes) — backfilled but
// absent from STAGE_PROGRESSION above.
const LABEL_TO_COLUMN: Record<string, string> = {
  'application':                     'Date__a',
  'application review':              'Application_Accpeted_Date__a',
  'quotation':                       'Quotation_Received_Date__a',
  'client agreement':                'Client_Agreement_Signed_Date__a',
  'stage 1 plan sent date':          'Stage_one_plan_Sent_Date__a',
  'stage 1 plan accept date':        'stage1_plan_accepted_date__a',
  'stage 1 audit date':              'stage1_audit_date__a',
  'stage 1 ncr rca acceptance date': 'stage1_auditor_accepted_date__a',
  'tech review 1 date':              'stage1_tech_final_accepted_date__a',
  'stage 2 plan sent date':          'stage2_plan_sent_date__a',
  'stage 2 plan accept date':        'stage2_plan_accepted_date__a',
  'stage 2 audit date':              'stage2_audit_date__a',
  'stage 2 audit rca accept date':   'stage2_auditor_accepted_date__a',
  'stage 2 ncr closure date':        'stage2_evidences_accepted_date__a',
  'tech review 2 date':              'stage2_tech_findings_date__a',
  'cdc date':                        'cdc_date__a',
  'registration date':               'stage2_registration_date__a',
};

const REGISTRATION_COLUMN = 'stage2_registration_date__a';

interface ParsedRow {
  label: string;
  column: string;
  raw: string;
  parsed: string | null; // ISO date (YYYY-MM-DD), or null if unparseable
}

// Builds a plain calendar-date string from a Date object's LOCAL fields.
// Deliberately never touches toISOString()/UTC conversion — these are
// date-only values with no time-of-day or timezone meaning, and going
// through UTC shifts the day backward by one whenever the runtime's local
// offset is positive (e.g. IST, UTC+5:30): local midnight on the 20th is
// still the 19th in UTC. Round-tripping through local fields only, both
// here and in formatIso below, keeps the calendar date the user typed
// exactly what gets stored and displayed, regardless of server/browser TZ.
function toIsoDateString(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseFlexibleDate(raw: any): string | null {
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return toIsoDateString(raw.getFullYear(), raw.getMonth() + 1, raw.getDate());
  }
  const s = String(raw ?? '').trim();
  if (!s || s.startsWith('#')) return null; // blank, or an Excel error value (#REF!, #N/A, #VALUE!, ...)
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return toIsoDateString(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatIso(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
}

interface Props {
  extClientId: string;
  isCrmOrAdmin: boolean;
  onImported?: () => void;
}

export default function StageDateImport({ extClientId, isCrmOrAdmin, onImported }: Props) {
  const supabase = createClientComponentClient();
  const { tenant } = useSupabase();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [rows, setRows]               = useState<ParsedRow[] | null>(null);
  const [currentStatus, setCurrentStatus] = useState<string | null>(null);
  const [impliedStatus, setImpliedStatus] = useState<string | null>(null);
  const [parsing, setParsing]         = useState(false);
  const [applying, setApplying]       = useState(false);

  if (!isCrmOrAdmin) return null;

  const reset = () => {
    setRows(null);
    setCurrentStatus(null);
    setImpliedStatus(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !tenant?.id) return;
    setParsing(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellText: true, cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const sheetRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });

      const parsed: ParsedRow[] = [];
      for (const r of sheetRows) {
        const label = String(r[0] ?? '').trim();
        if (!label) continue;
        const column = LABEL_TO_COLUMN[label.toLowerCase()];
        if (!column) continue; // unmapped label — silently ignored, matches NewClientForm's convention
        const rawValue = r[1];
        parsed.push({
          label,
          column,
          raw: String(rawValue ?? '').trim(),
          parsed: parseFlexibleDate(rawValue),
        });
      }

      if (parsed.length === 0) {
        toast('No recognized date fields found in this file.', { icon: '⚠️' });
        reset();
        return;
      }

      // Fetch current status__a so the preview can show whether/how status
      // would advance, and so Apply only ever moves it forward.
      const { data: recordsData, error: fetchErr } = await supabase.rpc('get_object_records_with_references', {
        p_object_id: EXTERNAL_CLIENT_OBJECT_ID,
        p_tenant_id: tenant.id,
        p_limit: 100,
        p_offset: 0,
      });
      if (fetchErr) throw fetchErr;
      const current = recordsData?.find((r: any) => r.record_id === extClientId)?.record_data;
      const status = current?.status__a ?? null;
      setCurrentStatus(status);

      const valid = parsed.filter(r => r.parsed);
      const registrationPresent = valid.some(r => r.column === REGISTRATION_COLUMN);
      if (registrationPresent) {
        setImpliedStatus('Client_Registered');
      } else {
        const currentIdx = STAGE_PROGRESSION.findIndex(s => s.status === status);
        const presentColumns = new Set(valid.map(r => r.column));
        let impliedIdx = -1;
        STAGE_PROGRESSION.forEach((s, i) => { if (presentColumns.has(s.column)) impliedIdx = i; });
        setImpliedStatus(impliedIdx > currentIdx ? STAGE_PROGRESSION[impliedIdx].status : null);
      }

      setRows(parsed);
    } catch (err: any) {
      toast.error('Could not read Excel file: ' + err.message);
      reset();
    } finally {
      setParsing(false);
    }
  };

  const apply = async () => {
    if (!rows || !tenant?.id) return;
    setApplying(true);
    try {
      const valid = rows.filter(r => r.parsed);
      const registrationRow = valid.find(r => r.column === REGISTRATION_COLUMN);
      const genericRows = valid.filter(r => r.column !== REGISTRATION_COLUMN);

      if (genericRows.length > 0) {
        const updateData: Record<string, string> = {};
        genericRows.forEach(r => { updateData[r.column] = r.parsed!; });
        if (impliedStatus) updateData['status__a'] = impliedStatus;

        const { error: updateErr } = await supabase.rpc('update_tenant_record', {
          p_table_name: 'external_clients__a',
          p_record_id: extClientId,
          p_tenant_id: tenant.id,
          p_update_data: updateData,
        });
        if (updateErr) throw updateErr;
      }

      if (registrationRow) {
        const { data, error } = await supabase.rpc('set_stage2_registration_date', {
          p_record_id: extClientId,
          p_date: registrationRow.parsed,
        });
        if (error) throw error;
        const result = Array.isArray(data) ? data[0] : data;
        if (!result?.success) throw new Error(result?.message || 'Failed to set registration date');
      }

      toast.success(`Imported ${valid.length} date${valid.length === 1 ? '' : 's'}`);
      reset();
      onImported?.();
    } catch (err: any) {
      toast.error('Import failed: ' + err.message);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div>
      <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFile} className="hidden" />
      {!rows && (
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={parsing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
        >
          {parsing ? (
            <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
          )}
          Import Stage Dates from Excel
        </button>
      )}

      {rows && (
        <div className="mt-3 border border-indigo-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2 bg-indigo-50 border-b border-indigo-200 flex items-center justify-between">
            <p className="text-xs font-semibold text-indigo-900">Preview — nothing saved yet</p>
            <button onClick={reset} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {rows.map((r, i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-4 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">{r.label}</td>
                  <td className="px-4 py-2 text-sm">
                    {r.parsed ? (
                      <span className="text-gray-900">{formatIso(r.parsed)}</span>
                    ) : (
                      <span className="text-red-600" title={`Raw value: "${r.raw}"`}>
                        ⚠️ Could not parse ("{r.raw || 'blank'}") — skipped
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {impliedStatus && (
            <div className="px-4 py-2 bg-blue-50 border-t border-blue-100 text-xs text-blue-800">
              Status will advance: <span className="font-mono">{currentStatus ?? '(none)'}</span> → <span className="font-mono font-semibold">{impliedStatus}</span>
            </div>
          )}
          <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex gap-2">
            <button
              onClick={apply}
              disabled={applying || rows.every(r => !r.parsed)}
              className="px-4 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
            >
              {applying ? 'Applying…' : `Apply ${rows.filter(r => r.parsed).length} date${rows.filter(r => r.parsed).length === 1 ? '' : 's'}`}
            </button>
            <button
              onClick={reset}
              disabled={applying}
              className="px-4 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
