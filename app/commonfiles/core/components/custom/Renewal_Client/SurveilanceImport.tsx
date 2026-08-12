'use client';

import React, { useRef, useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useSupabase } from '../../../providers/SupabaseProvider';
import toast from 'react-hot-toast';
import {
  SURV_STAGE_PROGRESSION,
  formatIso,
  parseSummaryWorkbookRows,
  type ParsedRow,
} from './surveilanceSheetMapping';

const BUCKET = 'tenant-uploads';

interface Props {
  renewalId: string;
  isCrmOrAdmin: boolean;
  onImported?: () => void;
}

export default function SurveilanceImport({ renewalId, isCrmOrAdmin, onImported }: Props) {
  const supabase = createClientComponentClient();
  const { tenant } = useSupabase();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // get_object_records_with_references needs the real object UUID, not the
  // object's name — resolved once via get_tenant_objects, same pattern
  // NewRenewalForm.tsx already uses. Passing the literal string
  // 'renewal_clients__a' here would fail the RPC's UUID cast (a bug fixed
  // before this ever shipped).
  const [renewalObjectId, setRenewalObjectId] = useState<string | null>(null);
  useEffect(() => {
    if (!tenant?.id) return;
    supabase.rpc('get_tenant_objects', { p_tenant_id: tenant.id }).then(({ data }) => {
      const obj = data?.find((o: any) => o.name === 'renewal_clients__a');
      if (obj) setRenewalObjectId(obj.id);
    });
  }, [tenant?.id]);

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
    if (!renewalObjectId) {
      toast.error('Still resolving the Renewal Clients object — try again in a moment.');
      return;
    }
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

      // Fetch current status__a so the preview can show whether/how status would advance
      const { data: recordData, error: fetchErr } = await supabase.rpc(
        'get_object_records_with_references',
        {
          p_object_id: renewalObjectId,
          p_tenant_id: tenant.id,
          p_limit: 1,
          p_offset: 0,
        }
      );
      if (fetchErr) throw fetchErr;

      const current = recordData?.find((r: any) => r.record_id === renewalId)?.record_data;
      const status = current?.status__a ?? null;
      setCurrentStatus(status);

      // Compute which status this sheet would advance to
      const presentColumns = new Set(
        parsed
          .filter(r => r.value && r.mapping.kind === 'date' && r.mapping.extColumn)
          .map(r => r.mapping.extColumn)
      );

      const currentIdx = SURV_STAGE_PROGRESSION.findIndex(s => s.status === status);
      let impliedIdx = -1;
      SURV_STAGE_PROGRESSION.forEach((s, i) => {
        if (presentColumns.has(s.column)) impliedIdx = i;
      });

      setImpliedStatus(impliedIdx > currentIdx ? SURV_STAGE_PROGRESSION[impliedIdx].status : null);

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
      // Separate date fields from text fields
      const textFields: Record<string, string> = {};
      const dateFields: Record<string, string> = {};

      rows.forEach(row => {
        if (row.value === null) return; // Skip blanks
        if (!row.mapping.extColumn) return; // Skip unmapped

        if (row.mapping.kind === 'date') {
          dateFields[row.mapping.extColumn] = row.value;
        } else {
          textFields[row.mapping.extColumn] = row.value;
        }
      });

      // 1. Update text fields via upsert_renewal_from_summary
      if (Object.keys(textFields).length > 0) {
        const { error: updateErr } = await supabase.rpc('upsert_renewal_from_summary', {
          p_record_id: renewalId,
          p_data: textFields,
        });
        if (updateErr) throw updateErr;
      }

      // 2. Update date fields via update_tenant_record. Real signature is
      // (p_table_name, p_record_id, p_tenant_id, p_update_data) — plain
      // table name, no schema prefix, and p_tenant_id is required (migration
      // 231, the latest of its three redefinitions).
      if (Object.keys(dateFields).length > 0) {
        const { error: dateErr } = await supabase.rpc('update_tenant_record', {
          p_table_name: 'renewal_clients__a',
          p_record_id: renewalId,
          p_tenant_id: tenant.id,
          p_update_data: dateFields,
        });
        if (dateErr) throw dateErr;
      }

      // 3. Compute and advance status (if needed)
      const presentColumns = new Set(Object.keys(dateFields));
      const currentIdx = SURV_STAGE_PROGRESSION.findIndex(s => s.status === currentStatus);
      let newStatusIdx = -1;
      SURV_STAGE_PROGRESSION.forEach((s, i) => {
        if (presentColumns.has(s.column)) newStatusIdx = i;
      });

      const newStatus = newStatusIdx > currentIdx ? SURV_STAGE_PROGRESSION[newStatusIdx].status : null;

      if (newStatus && newStatus !== currentStatus) {
        const { error: statusErr } = await supabase.rpc('update_tenant_record', {
          p_table_name: 'renewal_clients__a',
          p_record_id: renewalId,
          p_tenant_id: tenant.id,
          p_update_data: { status__a: newStatus },
        });
        if (statusErr) throw statusErr;
      }

      // 4. Upload the summary sheet and attach it
      if (pendingFile) {
        const fileName = `${tenant.id}/renewal_summary_${renewalId}_${Date.now()}.xlsx`;
        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from(BUCKET)
          .upload(fileName, pendingFile);

        if (uploadErr) throw uploadErr;

        // Attach to surv_audit_pack__a — {bucket, path}, not a stored `url`,
        // so the download button (same pattern as ClientSummaryTab.tsx's
        // downloadAudit) can sign a fresh URL on demand.
        const { error: attachErr } = await supabase.rpc('append_renewal_audit_pack_entry', {
          p_record_id: renewalId,
          p_file_json: {
            name: pendingFile.name,
            bucket: BUCKET,
            path: uploadData.path,
            size: pendingFile.size,
            uploadedAt: new Date().toISOString(),
          },
        });
        if (attachErr) throw attachErr;
      }

      toast.success('Summary imported successfully');
      onImported?.();
      reset();
    } catch (err: any) {
      toast.error('Import failed: ' + err.message);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="space-y-4 border-t border-gray-200 pt-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Import Summary Sheet</label>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFile}
            disabled={parsing || applying}
            className="text-sm text-gray-500 file:px-4 file:py-2 file:rounded file:bg-blue-50 file:border file:border-blue-200 file:text-blue-700 hover:file:bg-blue-100"
          />
        </div>
        <p className="text-xs text-gray-500 mt-1">Excel only (.xlsx). Paste Surveillance 1 summary data.</p>
      </div>

      {parsing && <p className="text-sm text-gray-600">Reading file...</p>}

      {rows && (
        <div className="bg-gray-50 p-3 rounded space-y-2">
          <h4 className="text-sm font-semibold text-gray-800">Preview ({rows.length} fields)</h4>
          <div className="max-h-96 overflow-y-auto space-y-1">
            {rows.map((row, idx) => (
              <div key={idx} className="text-xs text-gray-700 flex justify-between">
                <span className="font-medium">{row.label}:</span>
                <span className={row.value === null ? 'text-gray-400 italic' : ''}>
                  {row.value === null ? '(blank)' : row.mapping.kind === 'date' ? formatIso(row.value) : row.value}
                </span>
              </div>
            ))}
          </div>
          {impliedStatus && (
            <div className="text-xs text-blue-700 font-medium">
              → Status would advance to: {impliedStatus}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={apply}
          disabled={!rows || applying}
          className="px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {applying ? 'Importing...' : 'Apply'}
        </button>
        {rows && (
          <button
            onClick={reset}
            disabled={applying}
            className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
