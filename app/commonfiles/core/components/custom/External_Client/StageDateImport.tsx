'use client';

import React, { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useSupabase } from '../../../providers/SupabaseProvider';
import toast from 'react-hot-toast';

const EXTERNAL_CLIENT_OBJECT_ID = '62803c4d-9430-4d19-a487-4370d52e062a';
const BUCKET = 'tenant-uploads';

// Every recognized Excel label, and where its value goes. `kind: 'date'`
// values are parsed/validated as calendar dates; `kind: 'text'` values are
// copied through as-is (trimmed), covering both genuinely free-text fields
// (names, standards, mandays) and the two fields that read like dates but
// are deliberately TEXT columns per S3/S4's design (stage1_audit_date__a /
// stage2_audit_date__a — manual, no status implication).
//
// extColumn / summaryColumn are independently optional — a label with only
// one of the two simply doesn't write to the other object. Several vertical
// dates have no reasonable client_summary__a target at all: that object's
// date columns are coarser (one stage1_date__a / stage2_date__a covering
// the whole stage, no per-checkpoint granularity), so per §5a of
// summary-excel-import-analysis.md, "tech review N date" (Stage N fully
// complete) is what's mirrored into stage{1,2}_date__a — not the mid-cycle
// "audit date"/"plan accept date"/"RCA accept date" checkpoints, which have
// nowhere coarse enough to land on Summary.
interface FieldMapping {
  extColumn?: string;
  summaryColumn?: string;
  kind: 'date' | 'text';
}

const FIELD_MAPPINGS: Record<string, FieldMapping> = {
  // Section B — per-checkpoint workflow dates (external_clients__a is the
  // detailed record; client_summary__a gets the ones that map cleanly onto
  // its coarser columns)
  'application':                     { extColumn: 'Date__a',                          summaryColumn: 'application_date__a',      kind: 'date' },
  'application review':              { extColumn: 'Application_Accpeted_Date__a',                                                 kind: 'date' },
  'quotation':                       { extColumn: 'Quotation_Received_Date__a',        summaryColumn: 'quotation_date__a',        kind: 'date' },
  'client agreement':                { extColumn: 'Client_Agreement_Signed_Date__a',   summaryColumn: 'client_agreement_date__a', kind: 'date' },
  'stage 1 plan sent date':          { extColumn: 'Stage_one_plan_Sent_Date__a',       summaryColumn: 'stage1_plan_sent_date__a', kind: 'date' },
  'stage 1 plan accept date':        { extColumn: 'stage1_plan_accepted_date__a',                                                 kind: 'date' },
  'stage 1 audit date':              { extColumn: 'stage1_audit_date__a',                                                         kind: 'text' },
  'stage 1 ncr rca acceptance date': { extColumn: 'stage1_auditor_accepted_date__a',                                              kind: 'date' },
  // Relabeled in a later template revision (confirmed 2026-08-02 against a
  // real production sheet) — additive alias, same target column, original
  // label above still works too.
  'ncr rca date':                    { extColumn: 'stage1_auditor_accepted_date__a',                                              kind: 'date' },
  'tech review 1 date':              { extColumn: 'stage1_tech_final_accepted_date__a', summaryColumn: 'stage1_date__a',          kind: 'date' },
  'stage 2 plan sent date':          { extColumn: 'stage2_plan_sent_date__a',          summaryColumn: 'stage2_plan_sent_date__a', kind: 'date' },
  'stage 2 plan accept date':        { extColumn: 'stage2_plan_accepted_date__a',                                                 kind: 'date' },
  'stage 2 audit date':              { extColumn: 'stage2_audit_date__a',                                                         kind: 'text' },
  'stage 2 audit rca accept date':   { extColumn: 'stage2_auditor_accepted_date__a',                                              kind: 'date' },
  'stage 2 audit + ncr upload date': { extColumn: 'stage2_auditor_accepted_date__a',                                              kind: 'date' }, // relabel alias, see note above
  'stage 2 ncr closure date':        { extColumn: 'stage2_evidences_accepted_date__a', summaryColumn: 'ncr_closure_date__a',      kind: 'date' },
  'stage 2 ncr rca accept date':     { extColumn: 'stage2_evidences_accepted_date__a', summaryColumn: 'ncr_closure_date__a',      kind: 'date' }, // relabel alias, see note above
  'tech review 2 date':              { extColumn: 'stage2_tech_findings_date__a',      summaryColumn: 'stage2_date__a',           kind: 'date' },
  'cdc date':                        { extColumn: 'cdc_date__a',                                                                  kind: 'date' },
  'registration date':               { extColumn: 'registration_date__a',              summaryColumn: 'registration_date__a',     kind: 'date' },

  // Section A — company/audit-planning metadata (migration 241)
  'company name':                    { extColumn: 'Company_name__a',           summaryColumn: 'company_name__a',      kind: 'text' },
  'standard':                        { extColumn: 'ISOStandard__a',            summaryColumn: 'iso_standards__a',     kind: 'text' },
  'certificate no':                  { extColumn: 'certificate_no__a',         summaryColumn: 'certificate_no__a',    kind: 'text' },
  'country':                         { extColumn: 'country__a',                summaryColumn: 'country__a',           kind: 'text' },
  'iaf code':                        { extColumn: 'iaf_code__a',               summaryColumn: 'iaf_code__a',          kind: 'text' },
  'address':                         { extColumn: 'Adddress__a',               summaryColumn: 'address__a',           kind: 'text' },
  'scope':                           { extColumn: 'scope__a',                  summaryColumn: 'scope__a',             kind: 'text' },
  'no of empl':                      { extColumn: 'totalNumberOfEmployees__a', summaryColumn: 'no_of_employees__a',   kind: 'text' },
  'total mandays':                   { extColumn: 'total_mandays__a',          summaryColumn: 'total_mandays__a',     kind: 'text' },
  'stg 1 manday':                    { extColumn: 'stage1_manday__a',          summaryColumn: 'stage1_manday__a',     kind: 'text' },
  'stg 2 manday':                    { extColumn: 'stage2_manday__a',          summaryColumn: 'stage2_manday__a',     kind: 'text' },
  'auditor stg 1':                   { extColumn: 'stage1_auditor__a',         summaryColumn: 'stage1_auditor__a',    kind: 'text' },
  'auditor stg 2':                   { extColumn: 'stage2_auditor__a',         summaryColumn: 'stage2_auditor__a',    kind: 'text' },
  // Excel has one "Tech Reviewer" column; maps to Stage 1 only (confirmed) —
  // stage2_tech_reviewer exists on both objects for parity but has no Excel source yet.
  'tech reviewer':                   { extColumn: 'stage1_tech_reviewer__a',   summaryColumn: 'stage1_tech_reviewer__a', kind: 'text' },
  'director name':                   { extColumn: 'director_name__a',          summaryColumn: 'director_name__a',     kind: 'text' },
  'auditor team':                    { extColumn: 'auditor_team__a',           summaryColumn: 'auditor_team__a',      kind: 'text' },
  'application reviewer name':       { extColumn: 'application_reviewer__a',   summaryColumn: 'application_reviewer__a', kind: 'text' },
  'appl reviewr name':               { extColumn: 'application_reviewer__a',   summaryColumn: 'application_reviewer__a', kind: 'text' }, // abbreviated spelling seen in a real wide-table header, confirmed 2026-08-02
  'lead auditor':                    { extColumn: 'lead_auditor__a',           summaryColumn: 'lead_auditor__a',      kind: 'text' },
  'food category':                   { extColumn: 'food_category__a',          summaryColumn: 'food_category__a',     kind: 'text' },
  'soa date':                        { extColumn: 'soa_date__a',               summaryColumn: 'soa_date__a',          kind: 'text' },
  // 'type', 'Surveillance 1 mandays', 'Recert mandays' — deferred, not mapped (see analysis doc §5a)
};

// Section A recognized a second time, for a *wide-table* header row —
// COMPANY NAME | Standard | ... across columns, one client's values in the
// single row beneath it. Confirmed 2026-08-02 against a real production
// sheet: this table sits at rows 0-1, immediately above the vertical date
// list (rows vary), and is a stable, recurring structure, not a one-off.
//
// Deliberately a separate, smaller dictionary from FIELD_MAPPINGS rather
// than reusing it wholesale: the wide table also carries columns that
// *restate* several of the vertical list's dates under sometimes-different
// header text (Reg date, Stg 1 date, Stage 2 date, Stage 2 start date, CDC,
// Tech review stg 1/2 Date, Client agreement date, Quotation, Application
// date) — confirmed 2026-08-02 that when both are present, the vertical
// list stays the source of truth and these wide-table restatements are
// read as reference/notes only, never imported. "Stage 2 start date" and
// standalone "CDC" don't correspond to any existing field either way and
// are left unmapped for now (not yet confirmed what they should mean).
// Only genuinely wide-table-only columns (company/audit metadata, no date
// duplication) are listed here.
const WIDE_TABLE_MAPPINGS: Record<string, FieldMapping> = {
  'company name':              FIELD_MAPPINGS['company name'],
  'standard':                  FIELD_MAPPINGS['standard'],
  'certificate no':            FIELD_MAPPINGS['certificate no'],
  'country':                   FIELD_MAPPINGS['country'],
  'address':                   FIELD_MAPPINGS['address'],
  'scope':                     FIELD_MAPPINGS['scope'],
  'iaf code':                  FIELD_MAPPINGS['iaf code'],
  'no of empl':                FIELD_MAPPINGS['no of empl'],
  'total mandays':             FIELD_MAPPINGS['total mandays'],
  'stg 1 manday':              FIELD_MAPPINGS['stg 1 manday'],
  'stg 2 manday':              FIELD_MAPPINGS['stg 2 manday'],
  'auditor stg 1':             FIELD_MAPPINGS['auditor stg 1'],
  'auditor stg 2':             FIELD_MAPPINGS['auditor stg 2'],
  'tech reviewer':             FIELD_MAPPINGS['tech reviewer'],
  'director name':             FIELD_MAPPINGS['director name'],
  'auditor team':              FIELD_MAPPINGS['auditor team'],
  'application reviewer name': FIELD_MAPPINGS['application reviewer name'],
  'appl reviewr name':         FIELD_MAPPINGS['appl reviewr name'],
  'lead auditor':              FIELD_MAPPINGS['lead auditor'],
  'food category':             FIELD_MAPPINGS['food category'],
  'soa date':                  FIELD_MAPPINGS['soa date'],
};

// Mirrors ClientWorkflowBar.tsx's STAGES order — keep in sync if that array
// changes. registration_date__a is last since Client_Registered is the
// terminal stage; no special-casing needed beyond that, the trigger added
// in migration 241 (tenant.sync_status_on_registration_date) is what
// actually enforces this server-side regardless of what status this preview
// computes — this list only drives what the preview *displays*.
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
  { column: 'registration_date__a',               status: 'Client_Registered' },
];

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

interface ParsedRow {
  label: string;
  mapping: FieldMapping;
  raw: string;
  value: string | null; // ISO date (kind 'date') or trimmed text (kind 'text'); null = blank/unparseable, skipped
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
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [currentStatus, setCurrentStatus] = useState<string | null>(null);
  const [impliedStatus, setImpliedStatus] = useState<string | null>(null);
  const [parsing, setParsing]         = useState(false);
  const [applying, setApplying]       = useState(false);

  if (!isCrmOrAdmin) return null;

  const reset = () => {
    setRows(null);
    setPendingFile(null);
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

      // Wide-table pass: row 0 as headers, row 1 as the single data row —
      // if any header in row 0 is recognized, treat both rows as consumed
      // by this table and skip them in the vertical pass below (otherwise
      // row 0's headers would themselves get misread as vertical
      // label/value pairs, e.g. label="Company Name", value="Standard").
      const headerRow = sheetRows[0] || [];
      const dataRow = sheetRows[1] || [];
      let wideTableDetected = false;
      headerRow.forEach((cell, colIdx) => {
        const header = String(cell ?? '').trim();
        const mapping = WIDE_TABLE_MAPPINGS[header.toLowerCase()];
        if (!mapping) return;
        wideTableDetected = true;
        const rawValue = dataRow[colIdx];
        const value = mapping.kind === 'date'
          ? parseFlexibleDate(rawValue)
          : (String(rawValue ?? '').trim() || null);
        parsed.push({ label: header, mapping, raw: String(rawValue ?? '').trim(), value });
      });

      // Vertical pass: label in column A, value in column B — falling back
      // to column C when B is blank (a later template revision, confirmed
      // 2026-08-02 against a real production sheet, shifted the value over
      // one column; supporting both keeps older-format sheets working too).
      sheetRows.forEach((r, rowIdx) => {
        if (wideTableDetected && (rowIdx === 0 || rowIdx === 1)) return;
        const label = String(r[0] ?? '').trim();
        if (!label) return;
        const mapping = FIELD_MAPPINGS[label.toLowerCase()];
        if (!mapping) return; // unmapped label — silently ignored, matches NewClientForm's convention
        const rawValue = (r[1] !== undefined && String(r[1]).trim() !== '') ? r[1] : r[2];
        const value = mapping.kind === 'date'
          ? parseFlexibleDate(rawValue)
          : (String(rawValue ?? '').trim() || null);
        parsed.push({ label, mapping, raw: String(rawValue ?? '').trim(), value });
      });

      if (parsed.length === 0) {
        toast('No recognized fields found in this file.', { icon: '⚠️' });
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

      const presentColumns = new Set(
        parsed.filter(r => r.value && r.mapping.kind === 'date' && r.mapping.extColumn).map(r => r.mapping.extColumn)
      );
      const currentIdx = STAGE_PROGRESSION.findIndex(s => s.status === status);
      let impliedIdx = -1;
      STAGE_PROGRESSION.forEach((s, i) => { if (presentColumns.has(s.column)) impliedIdx = i; });
      setImpliedStatus(impliedIdx > currentIdx ? STAGE_PROGRESSION[impliedIdx].status : null);

      setRows(parsed);
      setPendingFile(file);
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
      const valid = rows.filter(r => r.value !== null);

      const extUpdateData: Record<string, string> = {};
      valid.forEach(r => { if (r.mapping.extColumn) extUpdateData[r.mapping.extColumn] = r.value!; });
      if (impliedStatus) extUpdateData['status__a'] = impliedStatus;

      if (Object.keys(extUpdateData).length > 0) {
        const { error: updateErr } = await supabase.rpc('update_tenant_record', {
          p_table_name: 'external_clients__a',
          p_record_id: extClientId,
          p_tenant_id: tenant.id,
          p_update_data: extUpdateData,
        });
        if (updateErr) throw updateErr;
      }

      const summaryUpdateData: Record<string, string> = {};
      valid.forEach(r => { if (r.mapping.summaryColumn) summaryUpdateData[r.mapping.summaryColumn] = r.value!; });

      if (Object.keys(summaryUpdateData).length > 0) {
        const { data: summaryRes, error: summaryErr } = await supabase.rpc('upsert_client_summary', {
          p_external_client_id: extClientId,
          p_data: summaryUpdateData,
        });
        if (summaryErr) throw summaryErr;
        const summaryResult = Array.isArray(summaryRes) ? summaryRes[0] : summaryRes;
        if (!summaryResult?.success) throw new Error(summaryResult?.message || 'Failed to update Summary');
      }

      // Store the sheet itself as an attachment, same mechanism the old
      // "Upload Audit Pack" button used (append_audit_pack_entry / audit_pack__a).
      if (pendingFile) {
        const storagePath = `tenants/${tenant.id}/audit_packs/${extClientId}/${Date.now()}_${pendingFile.name}`;
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, pendingFile, { upsert: true });
        if (upErr) throw upErr;

        const entry = {
          name:        pendingFile.name,
          path:        storagePath,
          bucket:      BUCKET,
          size:        pendingFile.size,
          mime:        pendingFile.type || null,
          uploaded_at: new Date().toISOString(),
        };
        const { data: rpcRes, error: rpcErr } = await supabase.rpc('append_audit_pack_entry', {
          p_external_client_id: extClientId,
          p_entry:              entry,
        });
        if (rpcErr) throw rpcErr;
        const result = Array.isArray(rpcRes) ? rpcRes[0] : rpcRes;
        if (!result?.success) throw new Error(result?.message || 'Failed to save the summary sheet as an attachment');
      }

      toast.success(`Imported ${valid.length} field${valid.length === 1 ? '' : 's'}`);
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
          Import Summary
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
                  <td className="px-4 py-2 text-xs font-medium text-gray-500 whitespace-nowrap align-top">{r.label}</td>
                  <td className="px-4 py-2 text-sm">
                    {r.value ? (
                      <span className="text-gray-900 whitespace-pre-wrap">
                        {r.mapping.kind === 'date' ? formatIso(r.value) : r.value}
                      </span>
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
          {pendingFile && (
            <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 text-xs text-gray-600">
              📎 This sheet will also be saved as an attachment: {pendingFile.name}
            </div>
          )}
          <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex gap-2">
            <button
              onClick={apply}
              disabled={applying || rows.every(r => r.value === null)}
              className="px-4 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
            >
              {applying ? 'Applying…' : `Apply ${rows.filter(r => r.value !== null).length} field${rows.filter(r => r.value !== null).length === 1 ? '' : 's'}`}
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
