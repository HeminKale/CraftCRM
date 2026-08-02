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

const BUCKET = 'tenant-uploads';

interface Props {
  isAdmin: boolean;
  onCreated?: () => void;
  onCancel?: () => void;
}

// "New Client from Summary" — creates BOTH the External Client and Client
// Summary records in one shot from a Summary sheet upload, unlike Import
// Summary (StageDateImport.tsx) which only ever updates an existing client.
// Reuses the exact same parseSummaryWorkbookRows/FIELD_MAPPINGS the update
// flow uses (summarySheetMapping.ts) — same recognized labels, same
// wide-table + vertical parsing, same vertical-list-wins-over-wide-table
// duplicate rule.
//
// Confirmed 2026-08-02:
// - Admin only, not CRM (unlike Import Summary's isCrmOrAdmin) — creating a
//   brand-new client this way skips the entire approval chain (rights_S0-
//   S6) with zero approval RPCs involved, which is only acceptable for
//   admin. isAdmin below is a UX convenience — hides/blocks the button so a
//   non-admin never even sees an action they can't use — the actual
//   enforcement is server-side in create_client_from_summary (252), which
//   checks role itself and returns "Cannot upload summary directly." if
//   called by anyone else. A client-side check alone would not be a real
//   security boundary (same class of gap 246 already found and fixed for
//   auditor_id__a/tech_reviewer_id__a).
// - Excel only for now (no PDF here yet — the Summary sheet's ~20-column
//   wide table is much riskier to split out of raw PDF text than the
//   Application Form's simple 2-column layout; add PDF once a real
//   Summary-PDF sample exists to validate the column-splitting against).
// - The uploaded sheet is attached to the new Client Summary record's
//   existing audit_pack__a field only — nothing gets attached anywhere on
//   the new External Client record. Every other stage-workflow document
//   (application form, quotation, client agreement, stage reports, ...)
//   is left for the admin to upload manually afterward through the normal
//   record page — this creation flow only ever writes plain field data.
// - No approval-gate RPCs are used for the initial status — same as Import
//   Summary, this writes status__a directly based on how far the sheet's
//   dates reach (STAGE_PROGRESSION), skipping the normal
//   auditor/tech-reviewer/CDC review chain entirely (rights_S* docs), since
//   the admin uploading a pre-completed Summary sheet is asserting those
//   checkpoints already happened outside the system.
export default function NewClientFromSummaryForm({ isAdmin, onCreated, onCancel }: Props) {
  const supabase = createClientComponentClient();
  const { tenant, user } = useSupabase();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [rows, setRows]               = useState<ParsedRow[] | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [initialStatus, setInitialStatus] = useState<string>('Application_Sent');
  const [parsing, setParsing]         = useState(false);
  const [creating, setCreating]       = useState(false);

  if (!isAdmin) return null;

  const reset = () => {
    setRows(null);
    setPendingFile(null);
    setInitialStatus('Application_Sent');
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

      const parsed = parseSummaryWorkbookRows(sheetRows);

      if (parsed.length === 0) {
        toast('No recognized fields found in this file.', { icon: '⚠️' });
        reset();
        return;
      }

      // No existing record yet, so there's no "current status" floor —
      // initial status is whichever is the furthest-along stage implied by
      // the dates present, defaulting to Application_Sent (same default
      // NewClientForm uses) if none of the workflow dates are present at all.
      const presentColumns = new Set(
        parsed.filter(r => r.value && r.mapping.kind === 'date' && r.mapping.extColumn).map(r => r.mapping.extColumn)
      );
      let impliedIdx = -1;
      STAGE_PROGRESSION.forEach((s, i) => { if (presentColumns.has(s.column)) impliedIdx = i; });
      setInitialStatus(impliedIdx >= 0 ? STAGE_PROGRESSION[impliedIdx].status : 'Application_Sent');

      setRows(parsed);
      setPendingFile(file);
    } catch (err: any) {
      toast.error('Could not read Excel file: ' + err.message);
      reset();
    } finally {
      setParsing(false);
    }
  };

  const create = async () => {
    if (!rows || !tenant?.id) return;
    // Belt-and-suspenders — the real gate is server-side (252 checks role
    // itself), but there's no reason to even attempt the call if the client
    // already knows this user isn't admin.
    if (!isAdmin) {
      toast.error('Cannot upload summary directly.');
      return;
    }
    setCreating(true);
    try {
      const valid = rows.filter(r => r.value !== null);

      const extInsertData: Record<string, string> = {};
      valid.forEach(r => { if (r.mapping.extColumn) extInsertData[r.mapping.extColumn] = r.value!; });

      // Date__a (Application date) is a required-in-practice field for the
      // workflow bar/status logic — fall back to today, same as
      // NewClientForm's default, if the sheet didn't carry an "application" row.
      if (!extInsertData['Date__a']) {
        extInsertData['Date__a'] = new Date().toISOString().split('T')[0];
      }

      const recordData: Record<string, string> = {
        ...extInsertData,
        status__a:  initialStatus,
        name:       extInsertData['Company_name__a'] || 'New Client',
        created_by: user?.id || '',
        updated_by: user?.id || '',
      };

      const summaryUpdateData: Record<string, string> = {};
      valid.forEach(r => { if (r.mapping.summaryColumn) summaryUpdateData[r.mapping.summaryColumn] = r.value!; });

      // create_client_from_summary (252) checks role = 'admin' itself and
      // returns success: false, message: "Cannot upload summary directly."
      // for anyone else — this is the actual enforcement, not the isAdmin
      // check above. It does the External Client insert (which fires
      // trg_create_client_summary, auto-creating and backfilling the linked
      // client_summary__a row) and the Summary-only fields upsert together.
      const { data: createData, error: createError } = await supabase.rpc('create_client_from_summary', {
        p_tenant_id:    tenant.id,
        p_ext_data:     recordData,
        p_summary_data: summaryUpdateData,
      });
      if (createError) throw createError;
      const createResult = Array.isArray(createData) ? createData[0] : createData;
      if (!createResult?.success) throw new Error(createResult?.message || 'Failed to create client');
      const newRecordId: string = createResult.record_id;

      // Attach the sheet itself to the Summary record only (confirmed
      // 2026-08-02) — nothing gets attached on the External Client record;
      // the admin uploads the actual stage documents manually afterward.
      if (pendingFile) {
        const storagePath = `tenants/${tenant.id}/audit_packs/${newRecordId}/${Date.now()}_${pendingFile.name}`;
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
          p_external_client_id: newRecordId,
          p_entry:              entry,
        });
        if (rpcErr) throw rpcErr;
        const result = Array.isArray(rpcRes) ? rpcRes[0] : rpcRes;
        if (!result?.success) throw new Error(result?.message || 'Failed to save the summary sheet as an attachment');
      }

      toast.success('Client created from Summary sheet');
      reset();
      onCreated?.();
    } catch (err: any) {
      toast.error('Create failed: ' + err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">New Client from Summary</h2>
          <p className="text-sm text-gray-500 mt-1">
            Upload a Summary Excel sheet to create both the External Client and Client Summary records at once.
          </p>
        </div>
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFile} className="hidden" />

      {!rows && (
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed rounded-md p-6 text-center cursor-pointer border-gray-300 hover:border-indigo-400 hover:bg-indigo-50 transition-colors"
        >
          {parsing ? (
            <div className="flex items-center justify-center gap-2 text-indigo-600">
              <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              <span className="text-sm">Reading file...</span>
            </div>
          ) : (
            <>
              <svg className="mx-auto w-8 h-8 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              <p className="text-sm text-gray-500">Click to upload a Summary Excel sheet</p>
              <p className="text-xs text-gray-400 mt-1">.xlsx or .xls</p>
            </>
          )}
        </div>
      )}

      {rows && (
        <div className="border border-indigo-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2 bg-indigo-50 border-b border-indigo-200 flex items-center justify-between">
            <p className="text-xs font-semibold text-indigo-900">Preview — nothing created yet</p>
            <button onClick={reset} className="text-xs text-gray-500 hover:text-gray-700">Choose a different file</button>
          </div>
          <div className="max-h-96 overflow-y-auto">
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
          </div>
          <div className="px-4 py-2 bg-blue-50 border-t border-blue-100 text-xs text-blue-800">
            New client will be created with status: <span className="font-mono font-semibold">{initialStatus}</span>
          </div>
          <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 text-xs text-gray-600">
            📎 This sheet will be attached to the new Summary record's Audit Pack Files. No documents will be attached on the External Client record — upload those manually afterward.
          </div>
          <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex gap-2">
            <button
              onClick={create}
              disabled={creating || rows.every(r => r.value === null)}
              className="px-4 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
            >
              {creating ? 'Creating…' : `Create Client (${rows.filter(r => r.value !== null).length} fields)`}
            </button>
            <button
              onClick={reset}
              disabled={creating}
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
