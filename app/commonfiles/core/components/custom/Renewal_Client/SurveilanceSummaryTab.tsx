'use client';

import React, { useState, useEffect } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useSupabase } from '../../../providers/SupabaseProvider';
import toast from 'react-hot-toast';
import SurveilanceImport from './SurveilanceImport';

// Mirrors ClientSummaryTab.tsx's architecture exactly, adapted for the fact
// that Surveillance 1 has NO separate summary table — unlike External Client
// (client_summary__a, a genuinely separate object auto-created via trigger),
// renewal_clients__a already IS one record per audit cycle, so a second
// table would just duplicate it (confirmed decision, Sprint 7/8 planning).
// This tab is a differently-shaped VIEW over the same renewal_clients__a
// fields SurveilanceImport.tsx already writes to — no new table, no trigger,
// no new "get_all_renewal_summaries"-style RPC. List/detail both go through
// the generic get_object_records_with_references (JSONB, includes every
// column automatically, unlike get_renewal_clients()'s fixed column list
// which was never updated past migration 221).

interface Props {
  tabId: string;
  tabLabel: string;
  recordId?: string;          // present when opened from a renewal_clients__a record
  objectId?: string;
  recordData?: Record<string, any>;
  tenantId?: string;
  [key: string]: any;
}

const ROWS: { key: string; label: string; type: 'text' | 'date'; readonly: boolean }[] = [
  // Identity / contact — mirrors ClientSummaryTab's first block
  { key: 'company_name__a',            label: 'Company Name',              type: 'text', readonly: true  },
  { key: 'address__a',                 label: 'Address',                   type: 'text', readonly: false },
  { key: 'contact_person__a',          label: 'Contact Person',            type: 'text', readonly: false },
  { key: 'email__a',                   label: 'Email',                     type: 'text', readonly: false },
  { key: 'iso_standards__a',           label: 'ISO Standards',             type: 'text', readonly: false },

  // Metadata fields — migration 271 (Sprint 7) + 275 (address/CDC name fix-up)
  { key: 'certificate_no__a',          label: 'Certificate No',            type: 'text', readonly: false },
  { key: 'country__a',                 label: 'Country',                   type: 'text', readonly: false },
  { key: 'scope__a',                   label: 'Scope',                     type: 'text', readonly: false },
  { key: 'iaf_code__a',                label: 'IAF Code',                  type: 'text', readonly: false },
  { key: 'no_of_employees__a',         label: 'Total Number of Employees', type: 'text', readonly: false },
  { key: 'surv_mandays__a',            label: 'Surveillance Mandays',      type: 'text', readonly: false },
  { key: 'auditor_name__a',            label: 'Auditor Name',              type: 'text', readonly: false },
  { key: 'tech_reviewer_name__a',      label: 'Tech Reviewer Name',        type: 'text', readonly: false },
  { key: 'cdc_name__a',                label: 'CDC Name',                  type: 'text', readonly: false },
  { key: 'director_name__a',           label: 'Director Name',             type: 'text', readonly: false },
  { key: 'auditor_team__a',            label: 'Auditor Team',              type: 'text', readonly: false },
  { key: 'application_reviewer__a',    label: 'Application Reviewer',      type: 'text', readonly: false },
  { key: 'lead_auditor__a',            label: 'Lead Auditor',              type: 'text', readonly: false },
  { key: 'food_category__a',           label: 'Food Category',             type: 'text', readonly: false },
  { key: 'soa_date__a',                label: 'SOA Date',                  type: 'text', readonly: false },

  // Workflow checkpoint dates — every date this object's own action panel
  // already drives via RPCs (Sprints 1-3). Shown read-only here since these
  // are RPC-owned, not free-text-editable from the Summary view — matches
  // how ClientSummaryTab shows stage1_date__a etc. as regular editable rows,
  // but here they're status-critical (not just a rollup mirror of a
  // per-checkpoint column elsewhere), so kept read-only to avoid a manual
  // edit silently drifting out of sync with status__a.
  { key: 'intimation_sent_date__a',        label: 'Intimation Sent Date',        type: 'date', readonly: true },
  { key: 'intimation_accepted_date__a',    label: 'Intimation Accepted Date',    type: 'date', readonly: true },
  { key: 'team_assigned_date__a',          label: 'Team Assigned Date',          type: 'date', readonly: true },
  { key: 'surv_plan_sent_date__a',         label: 'Plan Sent Date',              type: 'date', readonly: true },
  { key: 'surv_plan_accepted_date__a',     label: 'Plan Accepted Date',          type: 'date', readonly: true },
  { key: 'surv_ncr_sent_date__a',          label: 'NCR Sent Date',               type: 'date', readonly: true },
  { key: 'surv_ncr_rca_uploaded_date__a',  label: 'NCR RCA Uploaded Date',       type: 'date', readonly: true },
  { key: 'surv_auditor_accepted_date__a',  label: 'RCA Auditor Accepted Date',   type: 'date', readonly: true },
  { key: 'surv_report_sent_date__a',       label: 'Audit Report Sent Date',      type: 'date', readonly: true },
  { key: 'surv_tech_findings_date__a',     label: 'Tech Findings Date',          type: 'date', readonly: true },
  { key: 'surv_closed_date__a',            label: 'Audit Closed Date',           type: 'date', readonly: true },
  { key: 'cdc_date__a',                    label: 'CDC Date',                    type: 'date', readonly: true },
  { key: 'certificates_sent_date__a',      label: 'Certificate Issued Date',     type: 'date', readonly: true },
];

// Columns shown in the top-level list view
const LIST_COLS: { key: string; label: string; type: 'text' | 'date' }[] = [
  { key: 'company_name__a',       label: 'Company Name',       type: 'text' },
  { key: 'iso_standards__a',      label: 'ISO Standards',      type: 'text' },
  { key: 'certificate_no__a',     label: 'Certificate No',     type: 'text' },
  { key: 'auditor_name__a',       label: 'Auditor',            type: 'text' },
  { key: 'tech_reviewer_name__a', label: 'Tech Reviewer',      type: 'text' },
  { key: 'status__a',             label: 'Status',             type: 'text' },
  { key: 'certificates_sent_date__a', label: 'Certificate Issued', type: 'date' },
];

type SummaryRow = Record<string, any>;

const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

// Resolves the renewal_clients__a object UUID once — every RPC call in this
// file needs it (get_object_records_with_references takes a UUID, not a name).
function useRenewalObjectId(): string | null {
  const supabase = createClientComponentClient();
  const { tenant } = useSupabase();
  const [objectId, setObjectId] = useState<string | null>(null);

  useEffect(() => {
    if (!tenant?.id) return;
    supabase.rpc('get_tenant_objects', { p_tenant_id: tenant.id }).then(({ data }) => {
      const obj = data?.find((o: any) => o.name === 'renewal_clients__a');
      if (obj) setObjectId(obj.id);
    });
  }, [tenant?.id]);

  return objectId;
}

// ── Single-record detail view ──────────────────────────────────
function SummaryDetail({ renewalId, onBack }: { renewalId: string; onBack?: () => void }) {
  const supabase = createClientComponentClient();
  const { tenant, user, userProfile } = useSupabase();
  const renewalObjectId = useRenewalObjectId();

  const [data, setData]       = useState<SummaryRow>({});
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState<SummaryRow>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [auditFiles, setAuditFiles] = useState<any[]>([]);
  const [isCrmOrAdmin, setIsCrmOrAdmin] = useState(false);

  useEffect(() => { if (renewalObjectId) load(); }, [renewalId, renewalObjectId]);

  // Same resolution pattern ClientSummaryTab.tsx uses for customRoleName —
  // admin bypasses, otherwise match the custom role name case-insensitively.
  useEffect(() => {
    const resolveRole = async () => {
      if (userProfile?.role === 'admin') { setIsCrmOrAdmin(true); return; }
      if (!user?.id || !tenant?.id) return;
      try {
        const { data: users } = await supabase.rpc('get_tenant_users', { p_tenant_id: tenant.id });
        const me = users?.find((u: any) => u.id === user.id);
        setIsCrmOrAdmin(!!me?.custom_role_name?.toLowerCase().includes('crm'));
      } catch {
        setIsCrmOrAdmin(false);
      }
    };
    resolveRole();
  }, [user?.id, tenant?.id, userProfile?.role]);

  const load = async () => {
    if (!renewalObjectId || !tenant?.id) return;
    setLoading(true);
    try {
      const { data: rows, error } = await supabase.rpc('get_object_records_with_references', {
        p_object_id: renewalObjectId,
        p_tenant_id: tenant.id,
        p_limit: 1,
        p_offset: 0,
      });
      if (error) throw error;
      const row = rows?.find((r: any) => r.record_id === renewalId)?.record_data;
      if (row) {
        const cleaned: SummaryRow = {};
        ROWS.forEach(r => { cleaned[r.key] = row[r.key] ?? null; });
        setData(cleaned);
        const pack = row.surv_audit_pack__a;
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
    if (!tenant?.id) return;
    setSaving(true);
    try {
      const payload: Record<string, string> = {};
      ROWS.filter(r => !r.readonly).forEach(r => {
        if (draft[r.key] != null && draft[r.key] !== '') payload[r.key] = draft[r.key];
      });
      // Text metadata fields go through upsert_renewal_from_summary (same RPC
      // SurveilanceImport.tsx uses) — every editable row here is text-typed
      // (company/contact/metadata block), the date rows are all read-only.
      const { data: res, error } = await supabase.rpc('upsert_renewal_from_summary', {
        p_record_id: renewalId,
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
            {data['company_name__a'] || 'Surveillance 1 Summary'}
          </h2>
        </div>
        <div className="flex items-center gap-2">
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

      {isCrmOrAdmin && (
        <div className="px-6 py-3 border-b border-gray-100">
          <SurveilanceImport renewalId={renewalId} isCrmOrAdmin={isCrmOrAdmin} onImported={load} />
        </div>
      )}

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
                    ) : row.key === 'company_name__a' && renewalId ? (
                      <a href={`?record=${renewalId}`}
                        onClick={e => { e.preventDefault(); window.dispatchEvent(new CustomEvent('navigate-to-record', { detail: { recordId: renewalId } })); }}
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
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Summary Sheets</p>
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
  const { tenant } = useSupabase();
  const renewalObjectId = useRenewalObjectId();
  const [rows, setRows]         = useState<SummaryRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => { if (renewalObjectId) load(); }, [renewalObjectId]);

  const load = async () => {
    if (!renewalObjectId || !tenant?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_object_records_with_references', {
        p_object_id: renewalObjectId,
        p_tenant_id: tenant.id,
        p_limit: 200,
        p_offset: 0,
      });
      if (error) throw error;
      setRows((data || []).map((r: any) => ({ id: r.record_id, ...r.record_data })));
    } catch (err: any) {
      toast.error('Failed to load summaries: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  if (selected) {
    return <SummaryDetail renewalId={selected} onBack={() => { setSelected(null); load(); }} />;
  }

  const filtered = rows.filter(r =>
    !search || (r.company_name__a ?? '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <h2 className="text-base font-semibold text-gray-900">Surveillance 1 Summary</h2>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search by company…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-56 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
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
          {search ? 'No results match your search.' : 'No Surveillance 1 records yet. Create one from the Renewal Clients tab first.'}
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
                <tr key={row.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setSelected(row.id)}>
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
export default function SurveilanceSummaryTab({ recordId }: Props) {
  // When opened from inside a renewal_clients__a record detail view
  if (recordId) {
    return <SummaryDetail renewalId={recordId} />;
  }
  // When opened as a top-level tab (no record context)
  return <SummaryList />;
}
