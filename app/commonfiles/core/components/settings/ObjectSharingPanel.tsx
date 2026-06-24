'use client';

import React, { useState, useEffect } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import toast from 'react-hot-toast';

interface Props {
  objectId:    string;
  tenant:      any;
  userProfile: any;
}

const MODE_OPTIONS = [
  { value: 'all',        label: 'All records',          desc: 'Every user with access to this object can see/edit every record.' },
  { value: 'owner',      label: 'Own records only',     desc: 'Each user can only see and edit records they created.' },
  { value: 'role_peers', label: 'Same-role records',    desc: 'Users can see and edit records created by anyone with the same custom role.' },
];

export default function ObjectSharingPanel({ objectId, tenant, userProfile }: Props) {
  const supabase   = createClientComponentClient();
  const isAdmin    = userProfile?.role === 'admin';

  const [readMode,  setReadMode]  = useState('all');
  const [editMode,  setEditMode]  = useState('all');
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [hasPolicy, setHasPolicy] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data } = await supabase.rpc('get_object_sharing_policy', { p_object_id: objectId });
      if (data && data.length > 0) {
        setReadMode(data[0].read_mode);
        setEditMode(data[0].edit_mode);
        setHasPolicy(true);
      } else {
        setReadMode('all');
        setEditMode('all');
        setHasPolicy(false);
      }
      setLoading(false);
    };
    load();
  }, [objectId]);

  const handleSave = async () => {
    setSaving(true);
    const { data, error } = await supabase.rpc('upsert_object_sharing_policy', {
      p_object_id: objectId,
      p_tenant_id: tenant?.id,
      p_read_mode: readMode,
      p_edit_mode: editMode,
    });
    setSaving(false);
    if (error || !data?.[0]?.success) {
      toast.error(data?.[0]?.message || 'Failed to save');
      return;
    }
    setHasPolicy(true);
    toast.success('Sharing policy saved');
  };

  if (loading) {
    return <p className="text-sm text-gray-400 py-4">Loading sharing policy…</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Sharing</h2>
        <p className="text-sm text-gray-500 mt-1">
          Set the default record visibility for this object. Overrides for specific roles or
          permission sets can be configured in <strong>Settings → Sharing Overrides</strong>.
          Admin users always see all records regardless of this setting.
        </p>
      </div>

      {!hasPolicy && (
        <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-700">
          <span>ℹ️</span>
          <span>No sharing policy configured yet. Default is <strong>All records</strong> (existing behaviour). Save to make it explicit.</span>
        </div>
      )}

      {/* Read mode */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Read access (who can see records)</h3>
        <div className="space-y-2">
          {MODE_OPTIONS.map(opt => (
            <label
              key={opt.value}
              className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                readMode === opt.value
                  ? 'border-blue-400 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              } ${!isAdmin ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <input
                type="radio"
                name="read_mode"
                value={opt.value}
                checked={readMode === opt.value}
                onChange={() => isAdmin && setReadMode(opt.value)}
                disabled={!isAdmin}
                className="mt-0.5 text-blue-600"
              />
              <div>
                <p className="text-sm font-medium text-gray-900">{opt.label}</p>
                <p className="text-xs text-gray-500">{opt.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Edit mode */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Edit access (who can modify records)</h3>
        <div className="space-y-2">
          {MODE_OPTIONS.map(opt => (
            <label
              key={opt.value}
              className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                editMode === opt.value
                  ? 'border-blue-400 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              } ${!isAdmin ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <input
                type="radio"
                name="edit_mode"
                value={opt.value}
                checked={editMode === opt.value}
                onChange={() => isAdmin && setEditMode(opt.value)}
                disabled={!isAdmin}
                className="mt-0.5 text-blue-600"
              />
              <div>
                <p className="text-sm font-medium text-gray-900">{opt.label}</p>
                <p className="text-xs text-gray-500">{opt.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {isAdmin && (
        <div className="pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save sharing policy'}
          </button>
        </div>
      )}

      {/* Role peers note */}
      {(readMode === 'role_peers' || editMode === 'role_peers') && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-700">
          <strong>Same-role records</strong> mode uses the <em>Custom Role</em> assigned to each user
          in Users &amp; Roles settings. Users with no custom role assigned will fall back to seeing
          only their own records.
        </div>
      )}
    </div>
  );
}
