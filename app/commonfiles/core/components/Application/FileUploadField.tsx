'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import toast from 'react-hot-toast';

interface Attachment {
  id: string;
  filename: string;
  mime_type: string | null;
  byte_size: number | null;
  storage_path: string;
  storage_bucket: string;
  uploaded_by: string;
  created_at: string;
}

interface FileUploadFieldProps {
  objectId: string;
  fieldId: string;
  fieldLabel: string;
  recordId: string | null;    // null = new record (upload deferred)
  multiple?: boolean;         // true = 'files' type, false = 'file' type
  disabled?: boolean;
  readOnly?: boolean;
  companyName?: string;       // prefixed onto downloaded filename
}

const BUCKET = 'tenant-uploads';

function formatBytes(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(mimeType: string | null): string {
  if (!mimeType) return '📄';
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType === 'application/pdf') return '📕';
  if (mimeType.includes('word') || mimeType.includes('document')) return '📝';
  if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return '📊';
  if (mimeType.includes('zip') || mimeType.includes('rar')) return '🗜️';
  return '📄';
}

export default function FileUploadField({
  objectId,
  fieldId,
  fieldLabel,
  recordId,
  multiple = false,
  disabled = false,
  readOnly = false,
  companyName,
}: FileUploadFieldProps) {
  const supabase = createClientComponentClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Load existing attachments when record exists
  useEffect(() => {
    if (recordId && fieldId) {
      loadAttachments();
    }
  }, [recordId, fieldId]);

  const loadAttachments = async () => {
    if (!recordId) return;
    try {
      setLoadingAttachments(true);
      const { data, error } = await supabase.rpc('get_record_attachments', {
        p_record_id: recordId,
        p_field_id: fieldId,
      });
      if (!error) setAttachments(data || []);
    } finally {
      setLoadingAttachments(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    if (!recordId) {
      toast.error('Please save the record first before uploading files.');
      return;
    }

    // For single file type, replace existing
    const filesToUpload = multiple ? files : [files[0]];

    setUploading(true);
    let successCount = 0;

    for (const file of filesToUpload) {
      try {
        // 1. Start upload — creates attachment record + returns storage path
        const { data: startData, error: startError } = await supabase.rpc('start_file_upload', {
          p_object_id: objectId,
          p_record_id: recordId,
          p_field_id:  fieldId,
          p_filename:  file.name,
          p_mime_type: file.type || null,
          p_byte_size: file.size,
        });

        if (startError || !startData?.[0]?.success) {
          toast.error(`Failed to start upload for ${file.name}: ${startError?.message || startData?.[0]?.message}`);
          continue;
        }

        const { attachment_id, bucket, storage_path } = startData[0];

        // 2. Upload file bytes to Supabase Storage
        const { error: storageError } = await supabase.storage
          .from(bucket || BUCKET)
          .upload(storage_path, file, { upsert: true });

        if (storageError) {
          toast.error(`Storage upload failed for ${file.name}: ${storageError.message}`);
          continue;
        }

        // 3. Finalize — updates the record column with file metadata
        const { data: finalData, error: finalError } = await supabase.rpc('finalize_file_upload', {
          p_attachment_id:    attachment_id,
          p_final_byte_size:  file.size,
          p_final_mime_type:  file.type || null,
        });

        if (finalError || !finalData?.[0]?.success) {
          toast.error(`Failed to finalize ${file.name}`);
          continue;
        }

        successCount++;
      } catch (err: any) {
        toast.error(`Error uploading ${file.name}: ${err.message}`);
      }
    }

    if (successCount > 0) {
      toast.success(`${successCount} file${successCount > 1 ? 's' : ''} uploaded`);
      await loadAttachments();
    }

    setUploading(false);
    // Reset input so the same file can be re-selected
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleDelete = async (attachment: Attachment) => {
    if (!confirm(`Remove "${attachment.filename}"?`)) return;
    setDeletingId(attachment.id);
    try {
      // Delete from storage
      await supabase.storage.from(attachment.storage_bucket).remove([attachment.storage_path]);

      // Soft-delete attachment record
      const { data, error } = await supabase.rpc('delete_file', { p_attachment_id: attachment.id });
      if (error || !data?.[0]?.success) {
        toast.error(data?.[0]?.message || 'Failed to delete file');
        return;
      }

      toast.success('File removed');
      setAttachments(prev => prev.filter(a => a.id !== attachment.id));
    } finally {
      setDeletingId(null);
    }
  };

  const handleDownload = async (attachment: Attachment) => {
    try {
      // Get a signed URL
      let signedUrl: string | null = null;

      const { data, error } = await supabase.rpc('get_file_download_url', {
        p_attachment_id: attachment.id,
        p_expires_in:    300,
      });

      if (!error && data?.[0]?.download_url) {
        signedUrl = data[0].download_url;
      } else {
        const { data: sd, error: se } = await supabase.storage
          .from(attachment.storage_bucket)
          .createSignedUrl(attachment.storage_path, 300);
        if (se || !sd?.signedUrl) { toast.error('Could not generate download link'); return; }
        signedUrl = sd.signedUrl;
      }

      // Fetch and trigger named download
      const res = await fetch(signedUrl);
      if (!res.ok) { toast.error('Download failed'); return; }
      const blob = await res.blob();

      // Build filename: "<CompanyName> - <originalFilename>"
      const ext = attachment.filename.includes('.')
        ? attachment.filename.slice(attachment.filename.lastIndexOf('.'))
        : '';
      const base = attachment.filename.includes('.')
        ? attachment.filename.slice(0, attachment.filename.lastIndexOf('.'))
        : attachment.filename;
      const prefix = companyName ? `${companyName}_` : '';
      const downloadName = `${prefix}${base}${ext}`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Download failed');
    }
  };

  const canUpload = !readOnly && !disabled && !!recordId;

  return (
    <div className="space-y-2">
      {/* Existing attachments */}
      {loadingAttachments ? (
        <p className="text-xs text-gray-400">Loading files...</p>
      ) : attachments.length > 0 ? (
        <div className="space-y-1">
          {attachments.map(att => (
            <div
              key={att.id}
              className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-md group"
            >
              <span className="text-base flex-shrink-0">{fileIcon(att.mime_type)}</span>
              <div className="flex-1 min-w-0">
                <button
                  onClick={() => handleDownload(att)}
                  className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline truncate block text-left max-w-full"
                  title={att.filename}
                >
                  {att.filename}
                </button>
                {att.byte_size && (
                  <span className="text-xs text-gray-400">{formatBytes(att.byte_size)}</span>
                )}
              </div>
              {!readOnly && !disabled && (
                <button
                  onClick={() => handleDelete(att)}
                  disabled={deletingId === att.id}
                  className="text-gray-300 hover:text-red-500 transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100 disabled:opacity-50"
                  title="Remove file"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        recordId && !readOnly && (
          <p className="text-xs text-gray-400">No files attached yet.</p>
        )
      )}

      {/* Upload button */}
      {canUpload && (
        <>
          <input
            ref={inputRef}
            type="file"
            multiple={multiple}
            onChange={handleFileSelect}
            className="hidden"
            id={`file-upload-${fieldId}`}
          />
          <label
            htmlFor={`file-upload-${fieldId}`}
            className={`inline-flex items-center gap-2 px-3 py-2 text-sm border-2 border-dashed border-gray-300 rounded-md cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors ${
              uploading ? 'opacity-50 pointer-events-none' : ''
            }`}
          >
            {uploading ? (
              <>
                <svg className="animate-spin w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-gray-500">Uploading...</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <span className="text-gray-500">
                  {multiple ? 'Upload files' : 'Upload file'}
                </span>
              </>
            )}
          </label>
        </>
      )}

      {/* New record warning */}
      {!recordId && !readOnly && (
        <p className="text-xs text-amber-600">
          Save the record first to enable file uploads.
        </p>
      )}
    </div>
  );
}
