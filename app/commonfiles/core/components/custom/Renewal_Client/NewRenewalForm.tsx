'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useSupabase } from '../../../providers/SupabaseProvider';
import toast from 'react-hot-toast';

interface Props {
  tabId: string;
  tabLabel: string;
  objectId?: string;
  tenantId?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
  [key: string]: any;
}

interface ExternalClient {
  id: string;
  label: string;
}

const BUCKET = 'tenant-uploads';

export default function NewRenewalForm({ objectId, tenantId, onSuccess, onCancel }: Props) {
  const supabase = createClientComponentClient();
  const { tenant } = useSupabase();

  const [date] = useState(() => new Date().toISOString().split('T')[0]);

  // Client picker — optional
  const [clients, setClients]             = useState<ExternalClient[]>([]);
  const [clientId, setClientId]           = useState('');
  const [loadingClients, setLoadingClients] = useState(true);

  // Surveillance letter upload — optional
  const [file, setFile]         = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [submitting, setSubmitting] = useState(false);
  const tid = tenantId || tenant?.id;

  useEffect(() => {
    if (tid) loadClients();
  }, [tid]);

  const loadClients = async () => {
    setLoadingClients(true);
    try {
      const { data: objects } = await supabase.rpc('get_tenant_objects', { p_tenant_id: tid });
      const extObj = objects?.find((o: any) => o.name === 'external_clients__a');
      if (!extObj) return;
      const { data: records } = await supabase.rpc('get_object_records', {
        p_object_id: extObj.id,
        p_tenant_id: tid,
      });
      setClients(
        (records || []).map((r: any) => {
          const d = r.record_data ?? r;
          const company = d.Company_name__a || d.name || 'Unknown';
          const contact = d.contactPerson__a ? ` (${d.contactPerson__a})` : '';
          return { id: r.record_id ?? r.id, label: `${company}${contact}` };
        })
      );
    } catch {
      // silently fail — picker is optional anyway
    } finally {
      setLoadingClients(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] || null;
    setFile(selected);
    setFileError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      // Create the renewal record (client link optional)
      const { data, error } = await supabase.rpc('create_renewal_client', {
        p_external_client_id: clientId || null,
      });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.success) throw new Error(result?.message || 'Failed to create renewal');

      const newRecordId: string = result.record_id;

      // Upload surveillance letter if provided
      if (file && objectId) {
        try {
          const { data: fieldsData } = await supabase.rpc('get_tenant_fields', {
            p_object_id: objectId,
            p_tenant_id: tid,
          });

          const letterField = fieldsData?.find(
            (f: any) => f.name === 'surveillance_intimation_letter' ||
                        f.name === 'surveillance_intimation_letter__a'
          );

          if (letterField) {
            const { data: startData, error: startErr } = await supabase.rpc('start_file_upload', {
              p_object_id: objectId,
              p_record_id: newRecordId,
              p_field_id:  letterField.id,
              p_filename:  file.name,
              p_mime_type: file.type || null,
              p_byte_size: file.size,
            });

            if (!startErr && startData?.[0]?.success) {
              const { bucket, storage_path, attachment_id } = startData[0];
              const { error: storageErr } = await supabase.storage
                .from(bucket || BUCKET)
                .upload(storage_path, file, { upsert: true });

              if (!storageErr) {
                await supabase.rpc('finalize_file_upload', {
                  p_attachment_id:   attachment_id,
                  p_final_byte_size: file.size,
                  p_final_mime_type: file.type || null,
                });
              }
            } else {
              toast('Letter upload failed — you can upload from the record.', { icon: '⚠️' });
            }
          } else {
            toast('Surveillance letter field not found — upload from the record.', { icon: '⚠️' });
          }
        } catch {
          toast('Letter upload failed — you can upload from the record.', { icon: '⚠️' });
        }
      }

      toast.success('Renewal record created');
      onSuccess?.();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create renewal');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white p-2">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">New Renewal</h2>
          <p className="text-sm text-gray-500 mt-1">
            Optionally link to an existing client and upload the surveillance intimation letter.
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

        {/* Row 1: Client picker (optional) + Date */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Client <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            {loadingClients ? (
              <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Loading clients...
              </div>
            ) : (
              <select
                value={clientId}
                onChange={e => setClientId(e.target.value)}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">— none —</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
            <input
              type="date"
              value={date}
              readOnly
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm bg-gray-50 text-gray-600 cursor-not-allowed"
            />
          </div>
        </div>

        {/* Row 2: Surveillance Intimation Letter upload */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Surveillance Intimation Letter <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <div
            onClick={() => !file && fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-md p-5 text-center transition-colors ${
              fileError
                ? 'border-red-400 bg-red-50'
                : file
                ? 'border-green-400 bg-green-50 cursor-default'
                : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50 cursor-pointer'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileChange}
              className="hidden"
            />
            {file ? (
              <div className="flex flex-col items-center gap-1">
                <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm font-medium text-gray-900 break-all">{file.name}</span>
                <span className="text-xs text-gray-400">{(file.size / 1024).toFixed(1)} KB</span>
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); setFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
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
                <p className="text-sm text-gray-500">Click to upload surveillance intimation letter</p>
                <p className="text-xs text-gray-400 mt-1">Any file type</p>
              </div>
            )}
          </div>
          {fileError && <p className="mt-1 text-xs text-red-600">{fileError}</p>}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
          {onCancel && (
            <button type="button" onClick={onCancel} disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50">
              Cancel
            </button>
          )}
          <button type="submit" disabled={submitting}
            className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
            {submitting ? (
              <>
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Creating...
              </>
            ) : 'Create Renewal'}
          </button>
        </div>
      </form>
    </div>
  );
}
