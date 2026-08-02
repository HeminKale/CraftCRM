'use client';

import React, { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useSupabase } from '../../../providers/SupabaseProvider';
import toast from 'react-hot-toast';
import {
  STAGE_PROGRESSION,
  formatIso,
  parseSummaryWorkbookRows,
  type ParsedRow,
} from './summarySheetMapping';

const EXTERNAL_CLIENT_OBJECT_ID = '62803c4d-9430-4d19-a487-4370d52e062a';
const BUCKET = 'tenant-uploads';

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

      const parsed: ParsedRow[] = parseSummaryWorkbookRows(sheetRows);

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
