'use client';

import React, { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useSupabase } from '../../../providers/SupabaseProvider';
import toast from 'react-hot-toast';
import {
  getSurveillanceImportStatus,
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
    reset();
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
      const { data: recordData, error: fetchErr } = await supabase.rpc('get_renewal_summary_import_state', {
        p_record_id: renewalId,
      });
      if (fetchErr) throw fetchErr;
      if (!recordData?.[0]) throw new Error('Surveillance record not found');
      const status = recordData[0].current_status ?? null;
      setCurrentStatus(status);
      setImpliedStatus(getSurveillanceImportStatus(parsed, status));

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
      const fields: Record<string, string> = {};
      rows.forEach(row => {
        if (row.value !== null && row.mapping.extColumn && row.mapping.kind !== 'file') {
          fields[row.mapping.extColumn] = row.value;
        }
      });

      // Storage bytes are uploaded first. All record changes and the pack
      // entry are then committed together by one authorized database RPC.
      let attachment: Record<string, any> | null = null;
      if (pendingFile) {
        const suffix = pendingFile.name.toLowerCase().endsWith('.xls') ? '.xls' : '.xlsx';
        const fileName = `${tenant.id}/renewal_summary_${renewalId}_${crypto.randomUUID()}${suffix}`;
        const { data, error } = await supabase.storage.from(BUCKET).upload(fileName, pendingFile);
        if (error) throw error;
        attachment = {
          name: pendingFile.name, bucket: BUCKET, path: data.path,
          size: pendingFile.size, uploadedAt: new Date().toISOString(),
        };
      }

      const { data, error } = await supabase.rpc('import_renewal_summary', {
        p_record_id: renewalId,
        p_data: fields,
        p_file_json: attachment,
      });
      if (error) {
        // A definite PostgreSQL rejection rolled back the import. Network
        // failures are ambiguous: preserve the bytes in case it committed.
        if (attachment && /^[0-9A-Z]{5}$/.test(error.code || '')) {
          await supabase.storage.from(BUCKET).remove([attachment.path]);
        }
        throw error;
      }
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.success) throw new Error(result?.message || 'Summary import failed');

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
        <p className="text-xs text-gray-500 mt-1">Excel only (.xlsx or .xls). Imports into this Surveillance 1 record after you review and apply the preview.</p>
      </div>

      {parsing && <p className="text-sm text-gray-600">Reading file...</p>}

      {rows && (
        <div className="bg-gray-50 p-3 rounded space-y-2">
          <h4 className="text-sm font-semibold text-gray-800">Preview ({rows.length} fields)</h4>
          <p className="text-xs text-gray-500">{pendingFile?.name}</p>
          <p className="text-xs text-gray-500">Current status: {currentStatus || 'Not started'}. Blank or invalid values are skipped.</p>
          <div className="max-h-96 overflow-y-auto space-y-1">
            {rows.map((row, idx) => (
              <div key={idx} className="text-xs text-gray-700 flex justify-between">
                <span className="font-medium">{row.label}:</span>
                <span className={row.value === null ? 'text-gray-400 italic' : ''}>
                  {row.value === null ? (row.raw ? '(invalid date; skipped)' : '(blank; unchanged)') : row.mapping.kind === 'date' ? formatIso(row.value) : row.value}
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
          disabled={!rows?.some(row => row.value !== null) || parsing || applying}
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
