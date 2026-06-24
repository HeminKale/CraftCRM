'use client';

import React, { useState, useRef } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useSupabase } from '../../../providers/SupabaseProvider';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

// Maps Excel label (col A, case-insensitive) → DB column name
const LABEL_TO_COLUMN: Record<string, string> = {
  'company name':              'Company_name__a',
  'company':                   'Company_name__a',
  'address':                   'Adddress__a',
  'country':                   'country__a',
  'scope':                     'scope__a',
  'iso standard':              'ISOStandard__a',
  'iso':                       'ISOStandard__a',
  'total no of employees':     'totalNumberOfEmployees__a',
  'total number of employees': 'totalNumberOfEmployees__a',
  'employees':                 'totalNumberOfEmployees__a',
  'contact person':            'contactPerson__a',
  'contact':                   'contactPerson__a',
  'email':                     'email__a',
  'employee':                  'employee__a',
};

const BUCKET = 'tenant-uploads';

interface Props {
  objectId?: string;
  tenantId?: string;
  tabId?: string;
  tabLabel?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
  [key: string]: any;
}

interface ParsedEntry {
  file: File;
  fields: Record<string, string>;  // DB column → value
}

// Parse a single Excel File into DB column map
async function parseExcel(f: File): Promise<Record<string, string>> {
  const buffer = await f.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  const fields: Record<string, string> = {};
  for (const row of rows) {
    const label = String(row[0] ?? '').trim();
    const value = String(row[1] ?? '').trim();
    if (!label) continue;
    const colName = LABEL_TO_COLUMN[label.toLowerCase()];
    if (colName && value) {
      fields[colName] = value;
      if (colName === 'Company_name__a') fields['name'] = value;
    }
  }
  return fields;
}

export default function NewClientForm({ objectId, tenantId, onSuccess, onCancel }: Props) {
  const supabase = createClientComponentClient();
  const { user } = useSupabase();

  const [date] = useState(() => new Date().toISOString().split('T')[0]);
  const [entries, setEntries] = useState<ParsedEntry[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isZip = entries.length > 1 || (entries.length === 1 && entries[0].file.name.endsWith('.zip'));

  // ── File selection ────────────────────────────────────────────
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] || null;
    setEntries([]);
    setFileError(null);
    if (!selected) return;

    setExtracting(true);
    try {
      if (selected.name.toLowerCase().endsWith('.zip')) {
        // Unzip and parse each .xlsx inside
        const zip = await JSZip.loadAsync(await selected.arrayBuffer());
        const xlsFiles = Object.values(zip.files).filter(
          f => !f.dir && /\.(xlsx?|xls)$/i.test(f.name)
        );

        if (xlsFiles.length === 0) {
          setFileError('No Excel files found inside the ZIP.');
          return;
        }

        const parsed: ParsedEntry[] = [];
        for (const zipEntry of xlsFiles) {
          const blob = await zipEntry.async('blob');
          const file = new File([blob], zipEntry.name.split('/').pop() || zipEntry.name, {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          });
          const fields = await parseExcel(file);
          parsed.push({ file, fields });
        }

        setEntries(parsed);
        toast.success(`Found ${parsed.length} Excel file${parsed.length > 1 ? 's' : ''} in ZIP`);
      } else {
        // Single Excel
        const fields = await parseExcel(selected);
        if (Object.keys(fields).length === 0) {
          setFileError('No recognisable fields found. Check the Excel format.');
          return;
        }
        setEntries([{ file: selected, fields }]);
        toast.success('Application form ready');
      }
    } catch (err: any) {
      setFileError('Could not read file. Make sure it is a valid Excel (.xlsx/.xls) or ZIP file.');
    } finally {
      setExtracting(false);
    }
  };

  const clearFile = () => {
    setEntries([]);
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── Create one record + upload its file ───────────────────────
  const createRecord = async (entry: ParsedEntry, appFormFieldId: string | null) => {
    const recordData: Record<string, string> = {
      ...entry.fields,
      Date__a:    date,
      status__a:  'Application_Sent',
      name:       entry.fields['name'] || entry.fields['Company_name__a'] || 'New Client',
      created_by: user?.id || '',
      updated_by: user?.id || '',
    };

    const { data: createData, error: createError } = await supabase.rpc('create_object_record', {
      p_object_id:   objectId,
      p_tenant_id:   tenantId,
      p_record_data: recordData,
    });

    if (createError) throw new Error(createError.message);
    const result = Array.isArray(createData) ? createData[0] : createData;
    if (!result?.success) throw new Error(result?.message || 'Failed to create record');

    const newRecordId: string = result.record_id;

    // Upload the application form file
    if (appFormFieldId) {
      const { data: startData, error: startError } = await supabase.rpc('start_file_upload', {
        p_object_id: objectId,
        p_record_id: newRecordId,
        p_field_id:  appFormFieldId,
        p_filename:  entry.file.name,
        p_mime_type: entry.file.type || null,
        p_byte_size: entry.file.size,
      });

      if (!startError && startData?.[0]?.success) {
        const { bucket, storage_path, attachment_id } = startData[0];
        const { error: storageError } = await supabase.storage
          .from(bucket || BUCKET)
          .upload(storage_path, entry.file, { upsert: true });

        if (!storageError) {
          await supabase.rpc('finalize_file_upload', {
            p_attachment_id:   attachment_id,
            p_final_byte_size: entry.file.size,
            p_final_mime_type: entry.file.type || null,
          });
        }
      }
    }

    return newRecordId;
  };

  // ── Submit ────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (entries.length === 0) { setFileError('Please upload a file first.'); return; }
    if (!objectId || !tenantId) { toast.error('Missing object configuration'); return; }

    setSubmitting(true);
    try {
      // Resolve the application_Form field ID once
      const { data: fieldsData } = await supabase.rpc('get_tenant_fields', {
        p_object_id: objectId,
        p_tenant_id: tenantId,
      });
      const appFormField = fieldsData?.find((f: any) => f.name === 'application_Form');
      const appFormFieldId = appFormField?.id ?? null;

      if (entries.length === 1) {
        // Single record
        await createRecord(entries[0], appFormFieldId);
        toast.success('Client created successfully');
      } else {
        // Bulk — create all, report results
        let success = 0;
        let failed  = 0;
        for (const entry of entries) {
          try {
            await createRecord(entry, appFormFieldId);
            success++;
          } catch (err: any) {
            failed++;
            console.error(`Failed to create record for ${entry.file.name}:`, err.message);
          }
        }
        if (failed === 0) {
          toast.success(`${success} client${success > 1 ? 's' : ''} created successfully`);
        } else {
          toast(`${success} created, ${failed} failed. Check console for details.`, { icon: '⚠️' });
        }
      }

      clearFile();
      onSuccess?.();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create client');
    } finally {
      setSubmitting(false);
    }
  };

  const hasFile = entries.length > 0;
  const firstFileName = entries[0]?.file.name ?? '';

  return (
    <div className="bg-white p-2">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">New Client</h2>
          <p className="text-sm text-gray-500 mt-1">
            Upload an Excel application form, or a ZIP containing multiple Excel files to create clients in bulk.
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

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">

          {/* Left: File upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Application Form <span className="text-red-500">*</span>
              <span className="text-gray-400 font-normal ml-1">(.xlsx, .xls, or .zip)</span>
            </label>
            <div
              onClick={() => !hasFile && fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-md p-5 text-center transition-colors ${
                fileError
                  ? 'border-red-400 bg-red-50'
                  : hasFile
                  ? 'border-green-400 bg-green-50 cursor-default'
                  : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50 cursor-pointer'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.zip"
                onChange={handleFileChange}
                className="hidden"
              />

              {extracting ? (
                <div className="flex items-center justify-center gap-2 text-blue-600">
                  <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span className="text-sm">Reading file...</span>
                </div>
              ) : hasFile ? (
                <div className="flex flex-col items-center gap-1">
                  <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {entries.length === 1 ? (
                    <>
                      <span className="text-sm font-medium text-gray-900 break-all">{firstFileName}</span>
                      <span className="text-xs text-gray-400">{(entries[0].file.size / 1024).toFixed(1)} KB</span>
                    </>
                  ) : (
                    <>
                      <span className="text-sm font-medium text-gray-900">{entries.length} Excel files ready</span>
                      <ul className="text-xs text-gray-500 mt-1 space-y-0.5 max-h-24 overflow-y-auto text-left">
                        {entries.map((e, i) => (
                          <li key={i} className="truncate max-w-xs">• {e.fields['Company_name__a'] || e.file.name}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); clearFile(); }}
                    className="text-xs text-red-500 hover:text-red-700 mt-1"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div>
                  <svg className="mx-auto w-8 h-8 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  <p className="text-sm text-gray-500">Click to upload</p>
                  <p className="text-xs text-gray-400 mt-1">Single Excel or ZIP of multiple Excel files</p>
                </div>
              )}
            </div>
            {fileError && <p className="mt-1 text-xs text-red-600">{fileError}</p>}
          </div>

          {/* Right: Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
            <input
              type="date"
              value={date}
              readOnly
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm bg-gray-50 text-gray-600 cursor-not-allowed"
            />
            {entries.length > 1 && (
              <p className="mt-2 text-xs text-blue-600 bg-blue-50 border border-blue-100 rounded px-2 py-1.5">
                {entries.length} records will be created from the ZIP file.
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={submitting || extracting || !hasFile}
            className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {submitting ? (
              <>
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {entries.length > 1 ? `Creating ${entries.length} records...` : 'Creating...'}
              </>
            ) : entries.length > 1 ? `Create ${entries.length} Clients` : 'Create Client'}
          </button>
        </div>
      </form>
    </div>
  );
}
