'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import toast from 'react-hot-toast';
import { useSupabase } from '../../providers/SupabaseProvider';

interface Props { tenant: any; }

interface ObjectOption  { id: string; name: string; label: string; }
interface RoleOption    { id: string; name: string; }
interface PSetOption    { id: string; name: string; }

interface Policy {
  id: string | null;
  read_mode: string;
  edit_mode: string;
}

interface Override {
  id: string;
  role_id:        string | null;
  role_name:      string | null;
  perm_set_id:    string | null;
  perm_set_name:  string | null;
  read_mode:      string;
  edit_mode:      string;
  custom_formula: string | null;
  priority:       number;
}

const MODE_OPTIONS = [
  { value: 'all',        label: 'All records' },
  { value: 'owner',      label: 'Own records only' },
  { value: 'role_peers', label: 'Same-role records' },
];

const MODE_BADGE: Record<string, string> = {
  all:        'bg-green-100 text-green-800',
  owner:      'bg-yellow-100 text-yellow-800',
  role_peers: 'bg-blue-100 text-blue-800',
};

const emptyForm = {
  id: '',
  target_type: 'role' as 'role' | 'perm_set',
  role_id: '',
  perm_set_id: '',
  read_mode: 'all',
  edit_mode: 'all',
  custom_formula: '',
  priority: 10,
};

export default function SharingOverrides({ tenant }: Props) {
  const supabase = createClientComponentClient();
  const { userProfile } = useSupabase();
  const isAdmin = userProfile?.role === 'admin';

  const [objects,  setObjects]  = useState<ObjectOption[]>([]);
  const [roles,    setRoles]    = useState<RoleOption[]>([]);
  const [psets,    setPsets]    = useState<PSetOption[]>([]);
  const [search,   setSearch]   = useState('');
  const [selectedObjectId, setSelectedObjectId] = useState<string>('');

  const [policy,        setPolicy]        = useState<Policy | null>(null);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policySaving,  setPolicySaving]  = useState(false);

  const [overrides,        setOverrides]        = useState<Override[]>([]);
  const [overridesLoading, setOverridesLoading] = useState(false);

  const [showForm,  setShowForm]  = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form,      setForm]      = useState({ ...emptyForm });
  const [saving,    setSaving]    = useState(false);

  // ── load resources ──────────────────────────────────────────

  useEffect(() => {
    if (!tenant?.id) return;
    const load = async () => {
      const [objRes, roleRes, psetRes] = await Promise.all([
        supabase.rpc('get_tenant_objects',  { p_tenant_id: tenant.id }),
        supabase.rpc('get_tenant_roles',    { p_tenant_id: tenant.id }),
        supabase.rpc('get_permission_sets', { p_tenant_id: tenant.id }),
      ]);
      setObjects((objRes.data  || []).map((o: any) => ({ id: o.id, name: o.name, label: o.label || o.name })));
      setRoles(  (roleRes.data || []).map((r: any) => ({ id: r.id, name: r.name })));
      setPsets(  (psetRes.data || []).map((p: any) => ({ id: p.id, name: p.name })));
    };
    load();
  }, [tenant?.id]);

  const loadPolicy = useCallback(async (objectId: string) => {
    setPolicyLoading(true);
    const { data } = await supabase.rpc('get_object_sharing_policy', { p_object_id: objectId });
    if (data && data.length > 0) {
      setPolicy({ id: data[0].id, read_mode: data[0].read_mode, edit_mode: data[0].edit_mode });
    } else {
      setPolicy({ id: null, read_mode: 'all', edit_mode: 'all' });
    }
    setPolicyLoading(false);
  }, [supabase]);

  const loadOverrides = useCallback(async (objectId: string) => {
    setOverridesLoading(true);
    const { data } = await supabase.rpc('get_sharing_overrides', { p_object_id: objectId });
    setOverrides(data || []);
    setOverridesLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (!selectedObjectId) { setPolicy(null); setOverrides([]); return; }
    loadPolicy(selectedObjectId);
    loadOverrides(selectedObjectId);
  }, [selectedObjectId]);

  // ── filtered object list ────────────────────────────────────

  const filteredObjects = objects.filter(o =>
    o.label.toLowerCase().includes(search.toLowerCase()) ||
    o.name.toLowerCase().includes(search.toLowerCase())
  );

  // ── save baseline ───────────────────────────────────────────

  const handleSavePolicy = async () => {
    if (!policy || !selectedObjectId) return;
    setPolicySaving(true);
    const { data, error } = await supabase.rpc('upsert_object_sharing_policy', {
      p_object_id: selectedObjectId,
      p_tenant_id: tenant.id,
      p_read_mode: policy.read_mode,
      p_edit_mode: policy.edit_mode,
    });
    setPolicySaving(false);
    if (error || !data?.[0]?.success) { toast.error(data?.[0]?.message || 'Failed'); return; }
    toast.success('Baseline policy saved');
    loadPolicy(selectedObjectId);
  };

  // ── override form ───────────────────────────────────────────

  const openNew = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  };

  const openEdit = (ov: Override) => {
    setEditingId(ov.id);
    setForm({
      id:             ov.id,
      target_type:    ov.role_id ? 'role' : 'perm_set',
      role_id:        ov.role_id     || '',
      perm_set_id:    ov.perm_set_id || '',
      read_mode:      ov.read_mode,
      edit_mode:      ov.edit_mode,
      custom_formula: ov.custom_formula || '',
      priority:       ov.priority,
    });
    setShowForm(true);
  };

  const handleSaveOverride = async () => {
    if (form.target_type === 'role'     && !form.role_id)     { toast.error('Select a role');           return; }
    if (form.target_type === 'perm_set' && !form.perm_set_id) { toast.error('Select a permission set'); return; }
    setSaving(true);
    const { data, error } = await supabase.rpc('upsert_sharing_override', {
      p_object_id:      selectedObjectId,
      p_tenant_id:      tenant.id,
      p_override_id:    editingId || null,
      p_role_id:        form.target_type === 'role'     ? form.role_id     : null,
      p_perm_set_id:    form.target_type === 'perm_set' ? form.perm_set_id : null,
      p_read_mode:      form.read_mode,
      p_edit_mode:      form.edit_mode,
      p_custom_formula: form.custom_formula || null,
      p_priority:       form.priority,
    });
    setSaving(false);
    if (error || !data?.[0]?.success) { toast.error(data?.[0]?.message || 'Failed'); return; }
    toast.success(editingId ? 'Updated' : 'Created');
    setShowForm(false);
    loadOverrides(selectedObjectId);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this override?')) return;
    const { data, error } = await supabase.rpc('delete_sharing_override', { p_override_id: id });
    if (error || !data?.[0]?.success) { toast.error('Failed'); return; }
    toast.success('Deleted');
    loadOverrides(selectedObjectId);
  };

  // ── render ──────────────────────────────────────────────────

  const selectedObject = objects.find(o => o.id === selectedObjectId);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Sharing Overrides</h2>
        <p className="text-sm text-gray-500 mt-1">
          Select an object to configure its record visibility baseline and role / permission-set overrides.
        </p>
      </div>

      <div className="flex gap-5 min-h-[500px]">

        {/* ── Left: object table ── */}
        <div className="w-64 flex-shrink-0 flex flex-col border border-gray-200 rounded-lg overflow-hidden">

          {/* Search bar */}
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <svg className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search objects…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Object rows */}
          <div className="flex-1 overflow-y-auto">
            {filteredObjects.length === 0 ? (
              <p className="px-4 py-6 text-xs text-gray-400 text-center">No objects found</p>
            ) : (
              filteredObjects.map(obj => {
                const hasPolicy = true; // could track per-object but keep simple for now
                return (
                  <button
                    key={obj.id}
                    onClick={() => setSelectedObjectId(obj.id)}
                    className={`w-full text-left px-4 py-3 border-b border-gray-50 transition-colors ${
                      selectedObjectId === obj.id
                        ? 'bg-blue-50 border-l-2 border-l-blue-500'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <p className={`text-sm font-medium truncate ${selectedObjectId === obj.id ? 'text-blue-700' : 'text-gray-900'}`}>
                      {obj.label}
                    </p>
                    <p className="text-xs text-gray-400 truncate">{obj.name}</p>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* ── Right: policy + overrides ── */}
        <div className="flex-1 min-w-0">
          {!selectedObjectId ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 text-sm gap-2">
              <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span>Select an object to configure sharing</span>
            </div>
          ) : (
            <div className="space-y-5">

              {/* ── Baseline policy ── */}
              <div className="border border-gray-200 rounded-lg p-5">
                <h3 className="text-sm font-semibold text-gray-800 mb-0.5">
                  Baseline — <span className="text-blue-700">{selectedObject?.label}</span>
                </h3>
                <p className="text-xs text-gray-500 mb-4">
                  Applies to every user with access to this object unless an override matches them.
                  Admin users always see all records regardless of this setting.
                </p>

                {policyLoading ? (
                  <p className="text-sm text-gray-400">Loading…</p>
                ) : policy && (
                  <div className="flex flex-wrap gap-6 items-end">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Read access</label>
                      <select
                        value={policy.read_mode}
                        onChange={e => setPolicy({ ...policy, read_mode: e.target.value })}
                        disabled={!isAdmin}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
                      >
                        {MODE_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Edit access</label>
                      <select
                        value={policy.edit_mode}
                        onChange={e => setPolicy({ ...policy, edit_mode: e.target.value })}
                        disabled={!isAdmin}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
                      >
                        {MODE_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                    </div>
                    {isAdmin && (
                      <button
                        onClick={handleSavePolicy}
                        disabled={policySaving}
                        className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                      >
                        {policySaving ? 'Saving…' : 'Save baseline'}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* ── Overrides ── */}
              <div className="border border-gray-200 rounded-lg">
                <div className="flex justify-between items-center px-5 py-3 border-b border-gray-100">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800">Overrides</h3>
                    <p className="text-xs text-gray-500">
                      Target a role or permission set. Most permissive override wins when multiple apply.
                    </p>
                  </div>
                  {isAdmin && (
                    <button
                      onClick={openNew}
                      className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
                    >
                      + Add override
                    </button>
                  )}
                </div>

                {overridesLoading ? (
                  <p className="px-5 py-6 text-sm text-gray-400">Loading…</p>
                ) : overrides.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-gray-400">No overrides — everyone uses the baseline.</p>
                ) : (
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-5 py-2 text-left text-xs font-medium text-gray-500 uppercase">Target</th>
                        <th className="px-5 py-2 text-center text-xs font-medium text-gray-500 uppercase">Read</th>
                        <th className="px-5 py-2 text-center text-xs font-medium text-gray-500 uppercase">Edit</th>
                        <th className="px-5 py-2 text-center text-xs font-medium text-gray-500 uppercase">Priority</th>
                        <th className="px-5 py-2 text-center text-xs font-medium text-gray-500 uppercase">Formula</th>
                        {isAdmin && <th className="px-5 py-2" />}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {overrides.map(ov => (
                        <tr key={ov.id} className="hover:bg-gray-50">
                          <td className="px-5 py-3 font-medium text-gray-900">
                            {ov.role_id
                              ? <span className="inline-flex items-center gap-1.5"><span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">Role</span>{ov.role_name}</span>
                              : <span className="inline-flex items-center gap-1.5"><span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Perm Set</span>{ov.perm_set_name}</span>
                            }
                          </td>
                          <td className="px-5 py-3 text-center">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${MODE_BADGE[ov.read_mode]}`}>
                              {MODE_OPTIONS.find(m => m.value === ov.read_mode)?.label}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-center">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${MODE_BADGE[ov.edit_mode]}`}>
                              {MODE_OPTIONS.find(m => m.value === ov.edit_mode)?.label}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-center text-gray-500">{ov.priority}</td>
                          <td className="px-5 py-3 text-center">
                            {ov.custom_formula
                              ? <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded" title={ov.custom_formula}>Formula set</span>
                              : <span className="text-gray-300 text-xs">—</span>
                            }
                          </td>
                          {isAdmin && (
                            <td className="px-5 py-3 text-right space-x-2 whitespace-nowrap">
                              <button onClick={() => openEdit(ov)}      className="text-xs text-blue-600 hover:text-blue-900">Edit</button>
                              <button onClick={() => handleDelete(ov.id)} className="text-xs text-red-600 hover:text-red-900">Del</button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

            </div>
          )}
        </div>
      </div>

      {/* ── Override form modal ── */}
      {showForm && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              {editingId ? 'Edit Override' : 'New Override'} — {selectedObject?.label}
            </h3>

            <div className="space-y-4">

              {/* Target type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Apply to</label>
                <div className="flex gap-4">
                  {(['role', 'perm_set'] as const).map(t => (
                    <label key={t} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        checked={form.target_type === t}
                        onChange={() => setForm({ ...form, target_type: t, role_id: '', perm_set_id: '' })}
                        className="text-blue-600"
                      />
                      <span className="text-sm">{t === 'role' ? 'Role' : 'Permission Set'}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Target picker */}
              {form.target_type === 'role' ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                  <select
                    value={form.role_id}
                    onChange={e => setForm({ ...form, role_id: e.target.value })}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">— select role —</option>
                    {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Permission Set</label>
                  <select
                    value={form.perm_set_id}
                    onChange={e => setForm({ ...form, perm_set_id: e.target.value })}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">— select permission set —</option>
                    {psets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}

              {/* Read / Edit modes */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Read access</label>
                  <select
                    value={form.read_mode}
                    onChange={e => setForm({ ...form, read_mode: e.target.value })}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                  >
                    {MODE_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Edit access</label>
                  <select
                    value={form.edit_mode}
                    onChange={e => setForm({ ...form, edit_mode: e.target.value })}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                  >
                    {MODE_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Priority */}
              <div className="max-w-xs">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Priority
                  <span className="text-gray-400 font-normal ml-1 text-xs">(higher number wins when multiple apply)</span>
                </label>
                <input
                  type="number"
                  value={form.priority}
                  onChange={e => setForm({ ...form, priority: parseInt(e.target.value) || 10 })}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* Custom formula — Phase 3 placeholder */}
              <div className="border border-dashed border-amber-300 rounded-lg p-4 bg-amber-50">
                <div className="flex items-start gap-2 mb-2">
                  <span className="text-amber-500 text-sm mt-0.5">⚗️</span>
                  <div>
                    <p className="text-sm font-medium text-amber-800">
                      Custom Formula
                      <span className="text-xs font-normal text-amber-600 ml-1">— Coming in Phase 3</span>
                    </p>
                    <p className="text-xs text-amber-600 mt-0.5">
                      Write a condition referencing record fields and the current user.
                      Example: <code className="bg-amber-100 px-1 rounded">record.country__a = user.country__a</code>
                    </p>
                  </div>
                </div>
                <textarea
                  value={form.custom_formula}
                  onChange={e => setForm({ ...form, custom_formula: e.target.value })}
                  rows={2}
                  placeholder="e.g. record.country__a = user.country__a"
                  className="block w-full px-3 py-2 border border-amber-200 rounded-md text-sm text-amber-900 bg-white placeholder-amber-300 focus:ring-amber-400 focus:border-amber-400"
                />
                <p className="text-xs text-amber-500 mt-1">
                  Saved but not yet evaluated. Formula enforcement will be added in a future migration.
                </p>
              </div>

            </div>

            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
              <button
                onClick={() => setShowForm(false)}
                disabled={saving}
                className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveOverride}
                disabled={saving}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : editingId ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
