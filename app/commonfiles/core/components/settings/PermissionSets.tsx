'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useSupabase } from '../../providers/SupabaseProvider';
import toast from 'react-hot-toast';

interface PermissionSet {
  id: string;
  name: string;
  description: string | null;
  api_name: string | null;
  created_at: string;
}

interface EntryMap {
  [key: string]: {  // key: `${resource_type}:${resource_id}`
    id?: string;
    can_read: boolean;
    can_edit: boolean;
    can_create: boolean;
    can_delete: boolean;
  };
}

interface ResourceOption {
  id: string;
  name: string;
}

interface FieldOption {
  id: string;
  name: string;
  label: string;
  type: string;
}

type ResourceTab = 'app' | 'tab' | 'object';

interface Props {
  tenant: any;
}

export default function PermissionSets({ tenant }: Props) {
  const supabase = createClientComponentClient();
  const { userProfile } = useSupabase();
  const isAdmin = userProfile?.role === 'admin';

  // Left panel
  const [sets, setSets] = useState<PermissionSet[]>([]);
  const [setsLoading, setSetsLoading] = useState(true);
  const [selectedSet, setSelectedSet] = useState<PermissionSet | null>(null);
  const [showSetForm, setShowSetForm] = useState(false);
  const [editingSet, setEditingSet] = useState<PermissionSet | null>(null);
  const [setForm, setSetForm] = useState({ name: '', description: '' });
  const [savingSet, setSavingSet] = useState(false);

  // Right panel
  const [activeTab, setActiveTab] = useState<ResourceTab>('app');
  const [entriesMap, setEntriesMap] = useState<EntryMap>({});
  const [entriesLoading, setEntriesLoading] = useState(false);

  // Resources
  const [apps, setApps] = useState<ResourceOption[]>([]);
  const [tabs, setTabs] = useState<ResourceOption[]>([]);
  const [objects, setObjects] = useState<ResourceOption[]>([]);
  const [expandedObjects, setExpandedObjects] = useState<Set<string>>(new Set());
  const [objectFields, setObjectFields] = useState<Record<string, FieldOption[]>>({});
  const [fieldsLoading, setFieldsLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (tenant?.id) {
      loadSets();
      loadResources();
    }
  }, [tenant?.id]);

  useEffect(() => {
    if (selectedSet) loadEntries(selectedSet.id);
  }, [selectedSet?.id]);

  const loadSets = async () => {
    try {
      setSetsLoading(true);
      const { data, error } = await supabase.rpc('get_permission_sets', { p_tenant_id: tenant.id });
      if (error) { toast.error('Failed to load permission sets'); return; }
      setSets(data || []);
    } finally {
      setSetsLoading(false);
    }
  };

  const loadResources = async () => {
    try {
      const [appsRes, tabsRes, objectsRes] = await Promise.all([
        supabase.rpc('get_apps', { p_tenant_id: tenant.id }),
        supabase.rpc('get_tenant_tabs', { p_tenant_id: tenant.id }),
        supabase.rpc('get_tenant_objects', { p_tenant_id: tenant.id }),
      ]);
      setApps((appsRes.data || []).map((a: any) => ({ id: a.id, name: a.name })));
      setTabs((tabsRes.data || []).map((t: any) => ({ id: t.id, name: t.label || t.name })));
      setObjects((objectsRes.data || []).map((o: any) => ({ id: o.id, name: o.name })));
    } catch { /* non-critical */ }
  };

  const loadEntries = async (setId: string) => {
    try {
      setEntriesLoading(true);
      const { data, error } = await supabase.rpc('get_permission_set_entries', { p_perm_set_id: setId });
      if (error) { toast.error('Failed to load rules'); return; }

      // Build a quick-lookup map
      const map: EntryMap = {};
      for (const e of (data || [])) {
        map[`${e.resource_type}:${e.resource_id}`] = {
          id: e.id,
          can_read:   e.can_read,
          can_edit:   e.can_edit,
          can_create: e.can_create,
          can_delete: e.can_delete,
        };
      }
      setEntriesMap(map);
    } finally {
      setEntriesLoading(false);
    }
  };

  const loadFieldsForObject = async (objectId: string) => {
    if (objectFields[objectId]) return; // already loaded
    setFieldsLoading(prev => ({ ...prev, [objectId]: true }));
    try {
      const { data, error } = await supabase.rpc('get_tenant_fields', {
        p_object_id: objectId,
        p_tenant_id: tenant.id,
      });
      if (!error) {
        setObjectFields(prev => ({
          ...prev,
          [objectId]: (data || []).map((f: any) => ({
            id: f.id,
            name: f.name,
            label: f.label || f.name,
            type: f.type,
          })),
        }));
      }
    } finally {
      setFieldsLoading(prev => ({ ...prev, [objectId]: false }));
    }
  };

  const toggleObjectExpand = (objectId: string) => {
    setExpandedObjects(prev => {
      const next = new Set(prev);
      if (next.has(objectId)) {
        next.delete(objectId);
      } else {
        next.add(objectId);
        loadFieldsForObject(objectId);
      }
      return next;
    });
  };

  // Toggle a single permission flag
  const handleToggle = async (
    resourceType: ResourceTab | 'field',
    resourceId: string,
    flag: 'can_read' | 'can_edit' | 'can_create' | 'can_delete',
    currentValue: boolean
  ) => {
    if (!selectedSet || !isAdmin) return;

    const key = `${resourceType}:${resourceId}`;
    const current = entriesMap[key] || { can_read: false, can_edit: false, can_create: false, can_delete: false };
    const updated = { ...current, [flag]: !currentValue };

    // Optimistic update
    setEntriesMap(prev => ({ ...prev, [key]: updated }));

    try {
      const { data, error } = await supabase.rpc('upsert_permission_entry', {
        p_perm_set_id:   selectedSet.id,
        p_resource_type: resourceType,
        p_resource_id:   resourceId,
        p_can_read:      updated.can_read,
        p_can_edit:      updated.can_edit,
        p_can_create:    updated.can_create,
        p_can_delete:    updated.can_delete,
      });
      if (error || !data?.[0]?.success) {
        // Revert on failure
        setEntriesMap(prev => ({ ...prev, [key]: current }));
        toast.error('Failed to save rule');
      }
    } catch {
      setEntriesMap(prev => ({ ...prev, [key]: current }));
      toast.error('Failed to save rule');
    }
  };

  // ── Set CRUD ──────────────────────────────────────────────
  const handleSaveSet = async () => {
    if (!setForm.name.trim()) { toast.error('Name is required'); return; }
    setSavingSet(true);
    try {
      if (editingSet) {
        const { data, error } = await supabase.rpc('update_permission_set', {
          p_perm_set_id: editingSet.id,
          p_name: setForm.name.trim(),
          p_description: setForm.description.trim() || null,
        });
        if (error || !data?.[0]?.success) { toast.error(data?.[0]?.message || 'Failed'); return; }
        toast.success('Updated');
      } else {
        const { data, error } = await supabase.rpc('create_permission_set', {
          p_tenant_id: tenant.id,
          p_name: setForm.name.trim(),
          p_description: setForm.description.trim() || null,
        });
        if (error || !data?.[0]?.success) { toast.error(data?.[0]?.message || 'Failed'); return; }
        toast.success('Created');
      }
      resetSetForm();
      loadSets();
    } finally {
      setSavingSet(false);
    }
  };

  const handleDeleteSet = async (set: PermissionSet) => {
    if (!confirm(`Delete permission set "${set.name}"? All its rules will be removed.`)) return;
    const { data, error } = await supabase.rpc('delete_permission_set', { p_perm_set_id: set.id });
    if (error || !data?.[0]?.success) { toast.error(data?.[0]?.message || 'Failed'); return; }
    toast.success('Deleted');
    if (selectedSet?.id === set.id) setSelectedSet(null);
    loadSets();
  };

  const resetSetForm = () => {
    setSetForm({ name: '', description: '' });
    setEditingSet(null);
    setShowSetForm(false);
  };

  // ── Helpers ────────────────────────────────────────────────
  const getEntry = (type: string, id: string) =>
    entriesMap[`${type}:${id}`] || { can_read: false, can_edit: false, can_create: false, can_delete: false };

  const Checkbox = ({
    checked, onChange, disabled = false, title
  }: { checked: boolean; onChange: () => void; disabled?: boolean; title?: string }) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      disabled={disabled || !isAdmin}
      title={title}
      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
    />
  );

  // ── Render resource rows ───────────────────────────────────
  const renderApps = () => (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase w-full">App</th>
            <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Visible</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {apps.length === 0 && (
            <tr><td colSpan={2} className="px-4 py-6 text-center text-gray-400 text-xs">No apps found</td></tr>
          )}
          {apps.map(app => {
            const e = getEntry('app', app.id);
            return (
              <tr key={app.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{app.name}</td>
                <td className="px-4 py-3 text-center">
                  <Checkbox checked={e.can_read} onChange={() => handleToggle('app', app.id, 'can_read', e.can_read)} title="Visible to user" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const renderTabs = () => (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase w-full">Tab</th>
            <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Visible</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {tabs.length === 0 && (
            <tr><td colSpan={2} className="px-4 py-6 text-center text-gray-400 text-xs">No tabs found</td></tr>
          )}
          {tabs.map(tab => {
            const e = getEntry('tab', tab.id);
            return (
              <tr key={tab.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{tab.name}</td>
                <td className="px-4 py-3 text-center">
                  <Checkbox checked={e.can_read} onChange={() => handleToggle('tab', tab.id, 'can_read', e.can_read)} title="Visible to user" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const renderObjects = () => (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Object / Field</th>
            <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase w-16">Read</th>
            <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase w-16">Edit</th>
            <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase w-16">Create</th>
            <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase w-16">Delete</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {objects.length === 0 && (
            <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400 text-xs">No objects found</td></tr>
          )}
          {objects.map(obj => {
            const e = getEntry('object', obj.id);
            const isExpanded = expandedObjects.has(obj.id);
            const fields = objectFields[obj.id] || [];
            const isLoadingFields = fieldsLoading[obj.id];

            return (
              <React.Fragment key={obj.id}>
                {/* Object row */}
                <tr className="bg-white hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleObjectExpand(obj.id)}
                        className="text-gray-400 hover:text-gray-700 text-xs font-mono w-4"
                        title={isExpanded ? 'Hide fields' : 'Show fields'}
                      >
                        {isExpanded ? '▼' : '▶'}
                      </button>
                      <span className="font-semibold text-gray-900">{obj.name}</span>
                      <span className="text-xs text-gray-400 ml-1">Object</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Checkbox checked={e.can_read} onChange={() => handleToggle('object', obj.id, 'can_read', e.can_read)} title="Can view records" />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Checkbox checked={e.can_edit} onChange={() => handleToggle('object', obj.id, 'can_edit', e.can_edit)} title="Can edit records" />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Checkbox checked={e.can_create} onChange={() => handleToggle('object', obj.id, 'can_create', e.can_create)} title="Can create records" />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Checkbox checked={e.can_delete} onChange={() => handleToggle('object', obj.id, 'can_delete', e.can_delete)} title="Can delete records" />
                  </td>
                </tr>

                {/* Fields rows (expandable) */}
                {isExpanded && (
                  isLoadingFields ? (
                    <tr className="bg-blue-50">
                      <td colSpan={5} className="px-10 py-2 text-xs text-gray-400">Loading fields...</td>
                    </tr>
                  ) : fields.length === 0 ? (
                    <tr className="bg-blue-50">
                      <td colSpan={5} className="px-10 py-2 text-xs text-gray-400">No fields found for this object</td>
                    </tr>
                  ) : (
                    fields.map(field => {
                      const fe = getEntry('field', field.id);
                      return (
                        <tr key={field.id} className="bg-blue-50 hover:bg-blue-100">
                          <td className="px-4 py-2 pl-10">
                            <div className="flex items-center gap-2">
                              <span className="text-gray-300 text-xs">└</span>
                              <span className="text-gray-800">{field.label}</span>
                              <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{field.type}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2 text-center">
                            <Checkbox checked={fe.can_read} onChange={() => handleToggle('field', field.id, 'can_read', fe.can_read)} title="Can view this field" />
                          </td>
                          <td className="px-4 py-2 text-center">
                            <Checkbox checked={fe.can_edit} onChange={() => handleToggle('field', field.id, 'can_edit', fe.can_edit)} title="Can edit this field" />
                          </td>
                          <td className="px-4 py-2 text-center">
                            <span className="text-gray-300 text-xs">—</span>
                          </td>
                          <td className="px-4 py-2 text-center">
                            <span className="text-gray-300 text-xs">—</span>
                          </td>
                        </tr>
                      );
                    })
                  )
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  if (!tenant?.id) return null;

  return (
    <div className="flex gap-6 h-full">

      {/* ── Left: Permission Sets List ── */}
      <div className="w-64 flex-shrink-0">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-xl font-semibold text-gray-900">Permission Sets</h2>
          {isAdmin && (
            <button
              onClick={() => { resetSetForm(); setShowSetForm(true); }}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              + New
            </button>
          )}
        </div>

        {/* Create/edit form */}
        {showSetForm && (
          <div className="mb-4 p-3 border border-blue-200 rounded-md bg-blue-50 space-y-2">
            <p className="text-xs font-medium text-blue-800">{editingSet ? 'Edit Set' : 'New Permission Set'}</p>
            <input
              type="text" placeholder="Name *" value={setForm.name}
              onChange={(e) => setSetForm({ ...setForm, name: e.target.value })}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              autoFocus
            />
            <input
              type="text" placeholder="Description" value={setForm.description}
              onChange={(e) => setSetForm({ ...setForm, description: e.target.value })}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            />
            <div className="flex gap-2">
              <button onClick={resetSetForm} className="flex-1 py-1 text-xs text-gray-600 bg-gray-100 rounded hover:bg-gray-200">Cancel</button>
              <button onClick={handleSaveSet} disabled={savingSet} className="flex-1 py-1 text-xs text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50">
                {savingSet ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        )}

        <div className="space-y-1 max-h-[calc(100vh-280px)] overflow-y-auto">
          {setsLoading ? (
            <p className="text-sm text-gray-400 text-center py-6">Loading...</p>
          ) : sets.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-6">No permission sets yet.</p>
          ) : (
            sets.map(set => (
              <div
                key={set.id}
                onClick={() => setSelectedSet(set)}
                className={`p-3 rounded-md cursor-pointer border transition-colors ${
                  selectedSet?.id === set.id
                    ? 'bg-blue-50 border-blue-200'
                    : 'bg-white border-gray-200 hover:bg-gray-50'
                }`}
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{set.name}</p>
                    {set.description && <p className="text-xs text-gray-500 truncate">{set.description}</p>}
                  </div>
                  {isAdmin && (
                    <div className="flex gap-1 ml-2 flex-shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingSet(set); setSetForm({ name: set.name, description: set.description || '' }); setShowSetForm(true); }}
                        className="text-xs text-blue-600 hover:text-blue-900 px-1"
                      >
                        Edit
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteSet(set); }}
                        className="text-xs text-red-600 hover:text-red-900 px-1"
                      >
                        Del
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Right: Rules Panel ── */}
      <div className="flex-1 min-w-0">
        {!selectedSet ? (
          <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
            Select a permission set to manage its rules
          </div>
        ) : (
          <div>
            {/* Header */}
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-gray-900">{selectedSet.name}</h3>
              {selectedSet.description && <p className="text-sm text-gray-500">{selectedSet.description}</p>}
              <p className="text-xs text-gray-400 mt-1">
                Check a box to allow access. Unchecked = denied. Changes save instantly.
              </p>
            </div>

            {/* Resource type tabs */}
            <div className="flex border-b border-gray-200 mb-4">
              {([
                { key: 'app',    label: 'Apps' },
                { key: 'tab',    label: 'Tabs' },
                { key: 'object', label: 'Objects & Fields' },
              ] as { key: ResourceTab; label: string }[]).map(t => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === t.key
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Content */}
            {entriesLoading ? (
              <div className="text-center py-12 text-gray-400 text-sm">Loading rules...</div>
            ) : (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                {activeTab === 'app'    && renderApps()}
                {activeTab === 'tab'    && renderTabs()}
                {activeTab === 'object' && renderObjects()}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
