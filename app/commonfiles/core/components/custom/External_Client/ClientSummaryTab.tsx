'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useSupabase } from '../../../providers/SupabaseProvider';
import toast from 'react-hot-toast';

interface Props {
  tabId: string;
  tabLabel: string;
  recordId?: string;          // present when opened from an external_client record
  objectId?: string;
  recordData?: Record<string, any>;
  tenantId?: string;
  [key: string]: any;
}

const ROWS: { key: string; label: string; type: 'text' | 'date'; readonly: boolean }[] = [
  { key: 'company_name__a',            label: 'Company Name',              type: 'text', readonly: true  },
  { key: 'address__a',                 label: 'Address',                   type: 'text', readonly: false },
  { key: 'scope__a',                   label: 'Scope',                     type: 'text', readonly: false },
  { key: 'email__a',                   label: 'Email',                     type: 'text', readonly: false },
  { key: 'contact_person__a',          label: 'Contact Person',            type: 'text', readonly: false },
  { key: 'iso_standards__a',           label: 'ISO Standards',             type: 'text', readonly: false },
  { key: 'application_date__a',        label: 'Application Date',          type: 'date', readonly: false },
  { key: 'quotation_date__a',          label: 'Quotation Date',            type: 'date', readonly: false },
  { key: 'client_agreement_date__a',   label: 'Client Agreement Date',     type: 'date', readonly: false },
  { key: 'stage1_plan_sent_date__a',   label: 'Stage 1 Plan Sent Date',    type: 'date', readonly: false },
  { key: 'stage1_date__a',             label: 'Stage 1 Date',              type: 'date', readonly: false },
  { key: 'stage1_report_sent_date__a', label: 'Stage 1 Report Sent Date',  type: 'date', readonly: false },
  { key: 'stage2_plan_sent_date__a',   label: 'Stage 2 Plan Sent Date',    type: 'date', readonly: false },
  { key: 'stage2_date__a',             label: 'Stage 2 Date',              type: 'date', readonly: false },
  { key: 'stage2_report_sent_date__a', label: 'Stage 2 Report Sent Date',  type: 'date', readonly: false },
  { key: 'ncr_closure_date__a',        label: 'NCR Closure Date',          type: 'date', readonly: false },
  { key: 'certificates_sent_date__a',  label: 'Certificates Sent Date',    type: 'date', readonly: false },
  { key: 'application_reviewer__a',    label: 'Application Reviewer Name', type: 'text', readonly: false },
  { key: 'stage1_auditor__a',          label: 'Stage 1 Auditor Name',      type: 'text', readonly: false },
  { key: 'stage2_auditor__a',          label: 'Stage 2 Auditor Name',      type: 'text', readonly: false },
  { key: 'stage1_tech_reviewer__a',    label: 'Stage 1 Tech Reviewer',     type: 'text', readonly: false },
  { key: 'stage2_tech_reviewer__a',    label: 'Stage 2 Tech Reviewer',     type: 'text', readonly: false },
];

type SummaryRow = Record<string, any>;
const BUCKET = 'tenant-uploads';

const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

// ── Single-record detail view ──────────────────────────────────
function SummaryDetail({ extClientId, onBack }: { extClientId: string; onBack?: () => void }) {
  const supabase = createClientComponentClient();
  const { tenant } = useSupabase();

  const [data, setData]       = useState<SummaryRow>({});
  const [summaryId, setSummaryId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState<SummaryRow>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [uploading, setUploading] = useState(false);
  const [auditFiles, setAuditFiles] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { load(); }, [extClientId]);

  const load = async () => {
    setLoading(true);
    try {
      const { data: rows, error } = await supabase.rpc('get_client_summary', {
        p_external_client_id: extClientId,
      });
      if (error) throw error;
      if (rows?.length) {
        const row = rows[0];
        setSummaryId(row.id);
        const cleaned: SummaryRow = {};
        ROWS.forEach(r => { cleaned[r.key] = row[r.key] ?? null; });
        setData(cleaned);
        const pack = row.audit_pack__a;
        setAuditFiles(Array.isArray(pack) ? pack : (pack ? [pack] : []));
      } else {
        setData({});
      }
    } catch (err: any) {
      toast.error('Failed to load summary: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload: Record<string, string> = {};
      ROWS.filter(r => !r.readonly).forEach(r => {
        if (draft[r.key] != null && draft[r.key] !== '') payload[r.key] = draft[r.key];
      });
      const { data: res, error } = await supabase.rpc('upsert_client_summary', {
        p_external_client_id: extClientId,
        p_data: payload,
      });
      if (error) throw error;
      const result = Array.isArray(res) ? res[0] : res;
      if (!result?.success) throw new Error(result?.message || 'Save failed');
      toast.success('Summary saved');
      setEditing(false);
      await load();
    } catch (err: any) {
      toast.error(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleAuditUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !tenant?.id) return;
    setUploading(true);
    try {
      // 1. Upload file to Storage
      const storagePath = `tenants/${tenant.id}/audit_packs/${extClientId}/${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, file, { upsert: true });
      if (upErr) throw upErr;

      // 2. Persist the entry via RPC (avoids direct tenant-schema table access)
      const entry = {
        name:        file.name,
        path:        storagePath,
        bucket:      BUCKET,
        size:        file.size,
        mime:        file.type || null,
        uploaded_at: new Date().toISOString(),
      };
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('append_audit_pack_entry', {
        p_external_client_id: extClientId,
        p_entry:              entry,
      });
      if (rpcErr) throw rpcErr;
      const result = Array.isArray(rpcRes) ? rpcRes[0] : rpcRes;
      if (!result?.success) throw new Error(result?.message || 'Failed to save audit pack entry');

      // 3. Update local state
      setAuditFiles(prev => [...prev, entry]);
      toast.success('Audit pack uploaded');
    } catch (err: any) {
      toast.error('Upload failed: ' + err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const downloadAudit = async (entry: any) => {
    try {
      const { data: sd, error } = await supabase.storage.from(entry.bucket).createSignedUrl(entry.path, 300);
      if (error || !sd?.signedUrl) { toast.error('Could not generate link'); return; }
      const res = await fetch(sd.signedUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = entry.name;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch { toast.error('Download failed'); }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-16 text-gray-400">
      <svg className="animate-spin w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
      Loading…
    </div>
  );

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <div className="flex items-center gap-3">
          {onBack && (
            <button onClick={onBack} className="text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <h2 className="text-base font-semibold text-gray-900">
            {data['company_name__a'] || 'Client Summary'}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" onChange={handleAuditUpload} className="hidden" />
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50">
            {uploading
              ? <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>
              : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>}
            Upload Audit Pack
          </button>
          {!editing ? (
            <button onClick={() => { setDraft({ ...data }); setEditing(true); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 11l6-6 3 3-9 9H9v-3z" /></svg>
              Edit
            </button>
          ) : (
            <>
              <button onClick={save} disabled={saving}
                className="px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setEditing(false)} disabled={saving}
                className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <colgroup><col className="w-64" /><col /></colgroup>
          <tbody className="divide-y divide-gray-100">
            {ROWS.map((row, i) => {
              const isEditable = editing && !row.readonly;
              const value = isEditable ? (draft[row.key] ?? '') : (data[row.key] ?? '');
              return (
                <tr key={row.key} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-6 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">{row.label}</td>
                  <td className="px-6 py-2.5 text-sm text-gray-900">
                    {isEditable ? (
                      row.type === 'date' ? (
                        <input type="date" value={(draft[row.key] ?? '').slice(0, 10)}
                          onChange={e => setDraft(prev => ({ ...prev, [row.key]: e.target.value }))}
                          className="border border-gray-300 rounded px-2 py-1 text-sm w-44 focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                      ) : (
                        <input type="text" value={draft[row.key] ?? ''}
                          onChange={e => setDraft(prev => ({ ...prev, [row.key]: e.target.value }))}
                          className="border border-gray-300 rounded px-2 py-1 text-sm w-full max-w-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                      )
                    ) : row.key === 'company_name__a' && extClientId ? (
                      <a href={`?record=${extClientId}`}
                        onClick={e => { e.preventDefault(); window.dispatchEvent(new CustomEvent('navigate-to-record', { detail: { recordId: extClientId } })); }}
                        className="text-blue-600 hover:underline font-medium">{value || '—'}</a>
                    ) : row.type === 'date' ? (
                      <span>{fmtDate(value)}</span>
                    ) : (
                      <span>{value || '—'}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {auditFiles.length > 0 && (
        <div className="px-6 py-4 border-t border-gray-200">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Audit Pack Files</p>
          <div className="space-y-1">
            {auditFiles.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
                <button onClick={() => downloadAudit(f)} className="text-blue-600 hover:underline truncate">{f.name}</button>
                <span className="text-xs text-gray-400">{f.size ? `${(f.size / 1024).toFixed(1)} KB` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Top-level list view ────────────────────────────────────────
function SummaryList() {
  const supabase = createClientComponentClient();
  const [rows, setRows]         = useState<SummaryRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_all_client_summaries');
      if (error) throw error;
      setRows(data || []);
    } catch (err: any) {
      toast.error('Failed to load summaries: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  if (selected) {
    return <SummaryDetail extClientId={selected} onBack={() => { setSelected(null); load(); }} />;
  }

  const filtered = rows.filter(r =>
    !search || (r.company_name__a ?? '').toLowerCase().includes(search.toLowerCase())
  );

  // Columns shown in list view
  const LIST_COLS: { key: string; label: string; type: 'text' | 'date' }[] = [
    { key: 'company_name__a',         label: 'Company Name',           type: 'text' },
    { key: 'iso_standards__a',        label: 'ISO Standards',          type: 'text' },
    { key: 'application_date__a',     label: 'Application Date',       type: 'date' },
    { key: 'stage1_date__a',          label: 'Stage 1 Date',           type: 'date' },
    { key: 'stage2_date__a',          label: 'Stage 2 Date',           type: 'date' },
    { key: 'certificates_sent_date__a', label: 'Certificates Sent',    type: 'date' },
    { key: 'stage1_auditor__a',       label: 'Stage 1 Auditor',        type: 'text' },
    { key: 'stage2_auditor__a',       label: 'Stage 2 Auditor',        type: 'text' },
  ];

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <h2 className="text-base font-semibold text-gray-900">Client Summary</h2>
        <input
          type="text"
          placeholder="Search by company…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-56 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <svg className="animate-spin w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          {search ? 'No results match your search.' : 'No client summaries yet. They are created automatically when a new client is added.'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {LIST_COLS.map(c => (
                  <th key={c.key} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                    {c.label}
                  </th>
                ))}
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(row => (
                <tr key={row.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setSelected(row.external_client_id__a ?? row.id)}>
                  {LIST_COLS.map(c => (
                    <td key={c.key} className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">
                      {c.key === 'company_name__a' ? (
                        <span className="font-medium text-blue-600 hover:underline">{row[c.key] || '—'}</span>
                      ) : c.type === 'date' ? fmtDate(row[c.key]) : (row[c.key] || '—')}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right">
                    <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Root: choose mode based on whether recordId is passed ──────
export default function ClientSummaryTab({ recordId }: Props) {
  // When opened from inside an external_client record detail view
  if (recordId) {
    return <SummaryDetail extClientId={recordId} />;
  }
  // When opened as a top-level tab (no record context)
  return <SummaryList />;
}
