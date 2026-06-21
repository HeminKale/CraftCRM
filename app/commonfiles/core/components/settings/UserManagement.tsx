'use client';

import React, { useState, useEffect } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useSupabase } from '../../providers/SupabaseProvider';
import DataTable from '../DataTable';
import toast from 'react-hot-toast';


interface User {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string;
  department: string | null;
  is_active: boolean;
  created_at: string;
  last_sign_in: string | null;
  custom_role_id: string | null;
  custom_role_name: string | null;
}

interface UserInvitation {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string;
  department: string | null;
  status: string;
  created_at: string;
  expires_at: string;
  invited_by_email: string | null;
}

interface Role {
  id: string;
  name: string;
  description: string | null;
  user_count: number;
  created_at: string;
}

interface PermissionSet {
  id: string;
  name: string;
  description: string | null;
  api_name: string | null;
  created_at: string;
}

interface UserPermSet {
  perm_set_id: string;
  name: string;
  description: string | null;
  assigned_at: string;
}

interface HomeTabProps {
  tenant: any;
}

export default function UserManagement({ tenant }: HomeTabProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [invitations, setInvitations] = useState<UserInvitation[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [invitationsLoading, setInvitationsLoading] = useState(true);

  // Permission set assignment state
  const [permSets, setPermSets] = useState<PermissionSet[]>([]);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [userPermSets, setUserPermSets] = useState<Record<string, UserPermSet[]>>({});
  const [loadingPermSets, setLoadingPermSets] = useState<Record<string, boolean>>({});

  // Invite modal
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteForm, setInviteForm] = useState({
    email: '',
    first_name: '',
    last_name: '',
    role: 'user' as 'user' | 'admin',
    department: '',
    custom_role_id: ''
  });
  const [processing, setProcessing] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  // Roles modal
  const [showRolesModal, setShowRolesModal] = useState(false);
  const [roleForm, setRoleForm] = useState({ name: '', description: '' });
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [savingRole, setSavingRole] = useState(false);
  const [showRoleForm, setShowRoleForm] = useState(false);

  const supabase = createClientComponentClient();
  const { userProfile } = useSupabase();

  const isAdmin = userProfile?.role === 'admin';

  useEffect(() => {
    if (tenant?.id) {
      loadUsers();
      loadInvitations();
      loadRoles();
      loadPermSets();
    }
  }, [tenant?.id]);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .rpc('get_tenant_users', { p_tenant_id: tenant.id });
      if (error) { toast.error('Failed to load users'); return; }
      setUsers(data || []);
    } catch {
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const loadInvitations = async () => {
    try {
      setInvitationsLoading(true);
      const { data, error } = await supabase
        .rpc('get_pending_invitations', { p_tenant_id: tenant.id });
      if (error) { toast.error('Failed to load invitations'); return; }
      setInvitations(data || []);
    } catch {
      toast.error('Failed to load invitations');
    } finally {
      setInvitationsLoading(false);
    }
  };

  const loadRoles = async () => {
    try {
      const { data, error } = await supabase
        .rpc('get_tenant_roles', { p_tenant_id: tenant.id });
      if (!error) setRoles(data || []);
    } catch {
      // non-critical
    }
  };

  const loadPermSets = async () => {
    try {
      const { data, error } = await supabase
        .rpc('get_permission_sets', { p_tenant_id: tenant.id });
      if (!error) setPermSets(data || []);
    } catch {
      // non-critical
    }
  };

  const loadUserPermSets = async (userId: string) => {
    setLoadingPermSets(prev => ({ ...prev, [userId]: true }));
    try {
      const { data, error } = await supabase
        .rpc('get_user_permission_sets', { p_user_id: userId });
      if (!error) setUserPermSets(prev => ({ ...prev, [userId]: data || [] }));
    } catch {
      // non-critical
    } finally {
      setLoadingPermSets(prev => ({ ...prev, [userId]: false }));
    }
  };

  const handleToggleExpand = (userId: string) => {
    if (expandedUserId === userId) {
      setExpandedUserId(null);
    } else {
      setExpandedUserId(userId);
      if (!userPermSets[userId]) loadUserPermSets(userId);
    }
  };

  const handleAssignPermSet = async (userId: string, permSetId: string) => {
    if (!permSetId) return;
    try {
      const { data, error } = await supabase.rpc('assign_permission_set', {
        p_user_id: userId,
        p_perm_set_id: permSetId,
      });
      if (error) { toast.error(error.message || 'Failed to assign'); return; }
      if (data?.[0]?.success) {
        toast.success('Permission set assigned');
        loadUserPermSets(userId);
      } else {
        toast.error(data?.[0]?.message || 'Failed to assign');
      }
    } catch {
      toast.error('Failed to assign permission set');
    }
  };

  const handleRemovePermSet = async (userId: string, permSetId: string) => {
    try {
      const { data, error } = await supabase.rpc('remove_permission_set', {
        p_user_id: userId,
        p_perm_set_id: permSetId,
      });
      if (error) { toast.error(error.message || 'Failed to remove'); return; }
      if (data?.[0]?.success) {
        toast.success('Permission set removed');
        loadUserPermSets(userId);
      } else {
        toast.error(data?.[0]?.message || 'Failed to remove');
      }
    } catch {
      toast.error('Failed to remove permission set');
    }
  };

  // ── Invite ──────────────────────────────────────────────
  const handleInviteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) { toast.error('Only admins can invite users'); return; }

    try {
      setProcessing(true);
      const { data, error } = await supabase.rpc('invite_user', {
        p_email: inviteForm.email.toLowerCase().trim(),
        p_first_name: inviteForm.first_name.trim(),
        p_last_name: inviteForm.last_name.trim(),
        p_role: inviteForm.role,
        p_department: inviteForm.department.trim() || null
      });

      if (error) { toast.error(error.message || 'Failed to invite user'); return; }

      if (data?.[0]?.success) {
        try {
          // Fetch the token so admin can copy and share the invite link
          const { data: tokenData } = await supabase
            .schema('system')
            .from('user_invitations')
            .select('invitation_token')
            .eq('email', inviteForm.email.toLowerCase().trim())
            .eq('tenant_id', tenant.id)
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

          if (tokenData?.invitation_token) {
            const link = `${window.location.origin}/invite?token=${tokenData.invitation_token}`;
            setInviteLink(link);
          }
        } catch {
          // non-critical
        }

        loadInvitations();
        // Keep modal open to show the link — user closes it manually
      } else {
        toast.error(data?.[0]?.message || 'Failed to invite user');
      }
    } catch {
      toast.error('Failed to invite user');
    } finally {
      setProcessing(false);
    }
  };

  // ── Role assignment ──────────────────────────────────────
  const handleAssignRole = async (userId: string, roleId: string) => {
    if (!isAdmin) { toast.error('Only admins can assign roles'); return; }
    try {
      const { data, error } = await supabase.rpc('assign_user_role', {
        p_user_id: userId,
        p_role_id: roleId || null
      });
      if (error) { toast.error(error.message || 'Failed to assign role'); return; }
      if (data?.[0]?.success) {
        loadUsers();
      } else {
        toast.error(data?.[0]?.message || 'Failed to assign role');
      }
    } catch {
      toast.error('Failed to assign role');
    }
  };

  // ── System role update ───────────────────────────────────
  const handleUpdateRole = async (userId: string, newRole: string) => {
    if (!isAdmin) { toast.error('Only admins can update user roles'); return; }
    try {
      const { data, error } = await supabase.rpc('update_user_role', {
        p_user_id: userId,
        p_new_role: newRole
      });
      if (error) { toast.error(error.message || 'Failed to update user role'); return; }
      if (data?.[0]?.success) {
        toast.success('User role updated successfully');
        loadUsers();
      } else {
        toast.error(data?.[0]?.message || 'Failed to update user role');
      }
    } catch {
      toast.error('Failed to update user role');
    }
  };

  // ── Status toggle ────────────────────────────────────────
  const handleToggleStatus = async (userId: string, isActive: boolean) => {
    if (!isAdmin) { toast.error('Only admins can change user status'); return; }
    try {
      const { data, error } = await supabase.rpc('toggle_user_status', {
        p_user_id: userId,
        p_is_active: isActive
      });
      if (error) { toast.error(error.message || 'Failed to update user status'); return; }
      if (data?.[0]?.success) {
        toast.success(data[0].message);
        loadUsers();
      } else {
        toast.error(data?.[0]?.message || 'Failed to update user status');
      }
    } catch {
      toast.error('Failed to update user status');
    }
  };

  // ── Cancel / Resend invitation ───────────────────────────
  const handleCancelInvitation = async (invitationId: string) => {
    if (!isAdmin) { toast.error('Only admins can cancel invitations'); return; }
    try {
      const { data, error } = await supabase.rpc('cancel_invitation', {
        p_invitation_id: invitationId,
        p_reason: 'Cancelled by admin'
      });
      if (error) { toast.error(error.message || 'Failed to cancel invitation'); return; }
      if (data?.[0]?.success) {
        toast.success('Invitation cancelled successfully');
        loadInvitations();
      } else {
        toast.error(data?.[0]?.message || 'Failed to cancel invitation');
      }
    } catch {
      toast.error('Failed to cancel invitation');
    }
  };

  const handleResendInvitation = async (invitationId: string) => {
    if (!isAdmin) { toast.error('Only admins can resend invitations'); return; }
    try {
      const { data, error } = await supabase.rpc('resend_invitation', {
        p_invitation_id: invitationId
      });
      if (error) { toast.error(error.message || 'Failed to resend invitation'); return; }
      if (data?.[0]?.success) {
        toast.success('Invitation resent successfully');
        loadInvitations();
      } else {
        toast.error(data?.[0]?.message || 'Failed to resend invitation');
      }
    } catch {
      toast.error('Failed to resend invitation');
    }
  };

  // ── Roles CRUD ───────────────────────────────────────────
  const handleSaveRole = async () => {
    if (!roleForm.name.trim()) { toast.error('Role name is required'); return; }
    setSavingRole(true);
    try {
      if (editingRole) {
        const { data, error } = await supabase.rpc('update_tenant_role', {
          p_role_id: editingRole.id,
          p_name: roleForm.name.trim(),
          p_description: roleForm.description.trim() || null
        });
        if (error) { toast.error(error.message || 'Failed to update role'); return; }
        if (data?.[0]?.success) {
          toast.success('Role updated');
          resetRoleForm();
          loadRoles();
        } else {
          toast.error(data?.[0]?.message || 'Failed to update role');
        }
      } else {
        const { data, error } = await supabase.rpc('create_tenant_role', {
          p_tenant_id: tenant.id,
          p_name: roleForm.name.trim(),
          p_description: roleForm.description.trim() || null
        });
        if (error) { toast.error(error.message || 'Failed to create role'); return; }
        if (data?.[0]?.success) {
          toast.success('Role created');
          resetRoleForm();
          loadRoles();
        } else {
          toast.error(data?.[0]?.message || 'Failed to create role');
        }
      }
    } catch {
      toast.error('Failed to save role');
    } finally {
      setSavingRole(false);
    }
  };

  const handleDeleteRole = async (role: Role) => {
    if (!confirm(`Delete role "${role.name}"? It will be unassigned from ${role.user_count} user(s).`)) return;
    try {
      const { data, error } = await supabase.rpc('delete_tenant_role', { p_role_id: role.id });
      if (error) { toast.error(error.message || 'Failed to delete role'); return; }
      if (data?.[0]?.success) {
        toast.success('Role deleted');
        loadRoles();
        loadUsers();
      } else {
        toast.error(data?.[0]?.message || 'Failed to delete role');
      }
    } catch {
      toast.error('Failed to delete role');
    }
  };

  const resetRoleForm = () => {
    setRoleForm({ name: '', description: '' });
    setEditingRole(null);
    setShowRoleForm(false);
  };

  // ── Role → Permission Set mappings ───────────────────────
  const [roleMappings, setRoleMappings] = useState<Record<string, { id: string; permission_set_id: string; perm_set_name: string }[]>>({});

  const loadRoleMappings = async () => {
    try {
      const { data, error } = await supabase.rpc('get_role_perm_set_mappings', { p_tenant_id: tenant.id });
      if (error || !data) return;
      const grouped: Record<string, { id: string; permission_set_id: string; perm_set_name: string }[]> = {};
      for (const m of data) {
        if (!grouped[m.role_id]) grouped[m.role_id] = [];
        grouped[m.role_id].push({ id: m.id, permission_set_id: m.permission_set_id, perm_set_name: m.perm_set_name });
      }
      setRoleMappings(grouped);
    } catch { /* non-critical */ }
  };

  const handleAddRoleMapping = async (roleId: string, permSetId: string) => {
    if (!permSetId) return;
    const { data, error } = await supabase.rpc('add_role_perm_set_mapping', {
      p_role_id: roleId,
      p_permission_set_id: permSetId,
    });
    if (error || !data?.[0]?.success) { toast.error(data?.[0]?.message || 'Failed'); return; }
    toast.success('Mapping added — users assigned this role will automatically get the permission set');
    loadRoleMappings();
  };

  const handleRemoveRoleMapping = async (mappingId: string) => {
    const { data, error } = await supabase.rpc('remove_role_perm_set_mapping', { p_mapping_id: mappingId });
    if (error || !data?.[0]?.success) { toast.error('Failed to remove mapping'); return; }
    toast.success('Mapping removed');
    loadRoleMappings();
  };

  // ── Empty state ──────────────────────────────────────────
  if (!tenant?.id) {
    return (
      <div className="text-center py-8">
        <div className="text-gray-400 mb-4">
          <svg className="mx-auto h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">Tenant Not Loaded</h3>
        <p className="text-sm text-gray-500">Please wait while we load your tenant information.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Users & Roles</h2>
          <p className="text-sm text-gray-600 mt-1">Manage users and their roles for {tenant.name}</p>
        </div>
        {isAdmin && (
          <div className="flex space-x-3">
            <button
              onClick={() => { loadRoles(); loadPermSets(); loadRoleMappings(); setShowRolesModal(true); }}
              className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors text-sm font-medium"
            >
              Manage Roles
            </button>
            <button
              onClick={() => setShowInviteModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors text-sm font-medium"
            >
              Invite User
            </button>
          </div>
        )}
      </div>

      {/* Users Table */}
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">Active Users</h3>
        {loading ? (
          <div className="text-center py-8 text-gray-400 text-sm">Loading users...</div>
        ) : users.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm">No users found. Invite your first user to get started.</div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">System Role</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Sign In</th>
                  {isAdmin && <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Permissions</th>}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {users.map(user => {
                  const isExpanded = expandedUserId === user.id;
                  const assignedSets = userPermSets[user.id] || [];
                  const isLoadingPS = loadingPermSets[user.id];

                  return (
                    <React.Fragment key={user.id}>
                      <tr className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                              <span className="text-blue-600 font-medium text-sm">
                                {user.first_name?.[0] || user.last_name?.[0] || user.email[0].toUpperCase()}
                              </span>
                            </div>
                            <div className="ml-3">
                              <div className="font-medium text-gray-900">
                                {user.first_name && user.last_name ? `${user.first_name} ${user.last_name}` : user.email}
                              </div>
                              {user.first_name && user.last_name && (
                                <div className="text-xs text-gray-500">{user.email}</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {isAdmin ? (
                            <select
                              value={user.role}
                              onChange={(e) => handleUpdateRole(user.id, e.target.value)}
                              className="text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                              disabled={user.id === userProfile?.id}
                            >
                              <option value="user">User</option>
                              <option value="admin">Admin</option>
                            </select>
                          ) : (
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              user.role === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-800'
                            }`}>
                              {user.role === 'admin' ? 'Admin' : 'User'}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {isAdmin ? (
                            <select
                              value={user.custom_role_id || ''}
                              onChange={(e) => handleAssignRole(user.id, e.target.value)}
                              className="text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                            >
                              <option value="">— No role —</option>
                              {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                            </select>
                          ) : (
                            <span className="text-sm text-gray-900">{user.custom_role_name || '—'}</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {isAdmin ? (
                            <button
                              onClick={() => handleToggleStatus(user.id, !user.is_active)}
                              disabled={user.id === userProfile?.id}
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors ${
                                user.is_active ? 'bg-green-100 text-green-800 hover:bg-green-200' : 'bg-red-100 text-red-800 hover:bg-red-200'
                              } ${user.id === userProfile?.id ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                            >
                              {user.is_active ? 'Active' : 'Inactive'}
                            </button>
                          ) : (
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              user.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                            }`}>
                              {user.is_active ? 'Active' : 'Inactive'}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                          {user.last_sign_in ? new Date(user.last_sign_in).toLocaleDateString() : 'Never'}
                        </td>
                        {isAdmin && (
                          <td className="px-6 py-4 whitespace-nowrap text-center">
                            <button
                              onClick={() => handleToggleExpand(user.id)}
                              className="text-xs text-blue-600 hover:text-blue-900 font-medium"
                            >
                              {isExpanded ? 'Hide ▲' : 'Permissions ▼'}
                            </button>
                          </td>
                        )}
                      </tr>

                      {/* Expandable permission sets row */}
                      {isAdmin && isExpanded && (
                        <tr className="bg-blue-50">
                          <td colSpan={6} className="px-8 py-4">
                            <div className="space-y-3">
                              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                                Permission Sets assigned to {user.first_name || user.email}
                              </p>

                              {isLoadingPS ? (
                                <p className="text-xs text-gray-400">Loading...</p>
                              ) : (
                                <>
                                  {/* Assigned sets */}
                                  <div className="flex flex-wrap gap-2">
                                    {assignedSets.length === 0 ? (
                                      <span className="text-xs text-gray-400 italic">No permission sets assigned — full access by default.</span>
                                    ) : (
                                      assignedSets.map(ps => (
                                        <span key={ps.perm_set_id} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                          {ps.name}
                                          <button
                                            onClick={() => handleRemovePermSet(user.id, ps.perm_set_id)}
                                            className="ml-1 text-blue-500 hover:text-red-600 font-bold leading-none"
                                            title="Remove"
                                          >
                                            ×
                                          </button>
                                        </span>
                                      ))
                                    )}
                                  </div>

                                  {/* Assign new set */}
                                  {permSets.filter(ps => !assignedSets.find(a => a.perm_set_id === ps.id)).length > 0 && (
                                    <div className="flex items-center gap-2">
                                      <select
                                        defaultValue=""
                                        onChange={(e) => { if (e.target.value) { handleAssignPermSet(user.id, e.target.value); e.target.value = ''; } }}
                                        className="text-xs border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 py-1"
                                      >
                                        <option value="">+ Assign a permission set…</option>
                                        {permSets
                                          .filter(ps => !assignedSets.find(a => a.perm_set_id === ps.id))
                                          .map(ps => <option key={ps.id} value={ps.id}>{ps.name}</option>)
                                        }
                                      </select>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pending Invitations */}
      {invitations.length > 0 && (
        <div>
          <DataTable
            title="Pending Invitations"
            data={invitations}
            searchPlaceholder="Search invitations..."
            searchKeys={['email', 'first_name', 'last_name', 'role', 'department']}
            loading={invitationsLoading}
            emptyMessage="No pending invitations."
            noSearchResultsMessage="No invitations found matching your search."
            renderHeader={() => (
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Invited User</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Department</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Invited On</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Expires</th>
                {isAdmin && (
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                )}
              </tr>
            )}
            renderRow={(invitation) => (
              <tr key={invitation.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="w-8 h-8 bg-yellow-100 rounded-full flex items-center justify-center">
                      <span className="text-yellow-600 font-medium text-sm">
                        {invitation.first_name?.[0] || invitation.last_name?.[0] || invitation.email[0].toUpperCase()}
                      </span>
                    </div>
                    <div className="ml-3">
                      <div className="text-sm font-medium text-gray-900">
                        {invitation.first_name && invitation.last_name
                          ? `${invitation.first_name} ${invitation.last_name}`
                          : invitation.email}
                      </div>
                      <div className="text-sm text-gray-500">{invitation.email}</div>
                      {invitation.invited_by_email && (
                        <div className="text-xs text-gray-400">Invited by: {invitation.invited_by_email}</div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    invitation.role === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-800'
                  }`}>
                    {invitation.role === 'admin' ? 'Admin' : 'User'}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{invitation.department || '-'}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {new Date(invitation.created_at).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {new Date(invitation.expires_at).toLocaleDateString()}
                </td>
                {isAdmin && (
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-center">
                    <div className="flex space-x-2 justify-center">
                      <button onClick={() => handleResendInvitation(invitation.id)} className="text-blue-600 hover:text-blue-900">Resend</button>
                      <button onClick={() => handleCancelInvitation(invitation.id)} className="text-red-600 hover:text-red-900">Cancel</button>
                    </div>
                  </td>
                )}
              </tr>
            )}
          />
        </div>
      )}

      {/* ── Invite User Modal ── */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-[440px] shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Invite New User</h3>

              {/* ── Success: show invite link ── */}
              {inviteLink ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-3 p-3 bg-green-50 border border-green-200 rounded-md">
                    <svg className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-green-800">Invitation created successfully!</p>
                      <p className="text-xs text-green-600 mt-0.5">Share this link with <strong>{inviteForm.email}</strong></p>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Invitation Link</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        readOnly
                        value={inviteLink}
                        className="flex-1 px-3 py-2 text-xs border border-gray-300 rounded-md bg-gray-50 text-gray-700 font-mono"
                        onClick={e => (e.target as HTMLInputElement).select()}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(inviteLink);
                          toast.success('Link copied!');
                        }}
                        className="px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 flex-shrink-0"
                      >
                        Copy
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-gray-400">Link expires in 7 days. Share via email, WhatsApp, or any channel.</p>
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowInviteModal(false);
                        setInviteLink(null);
                        setInviteForm({ email: '', first_name: '', last_name: '', role: 'user', department: '', custom_role_id: '' });
                      }}
                      className="px-4 py-2 text-sm font-medium text-white bg-gray-600 rounded-md hover:bg-gray-700"
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : (
                /* ── Form ── */
                <form onSubmit={handleInviteUser} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Email *</label>
                    <input
                      type="email" required
                      value={inviteForm.email}
                      onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                      className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                      placeholder="user@example.com"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">First Name</label>
                      <input
                        type="text"
                        value={inviteForm.first_name}
                        onChange={(e) => setInviteForm({ ...inviteForm, first_name: e.target.value })}
                        className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                        placeholder="First name"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Last Name</label>
                      <input
                        type="text"
                        value={inviteForm.last_name}
                        onChange={(e) => setInviteForm({ ...inviteForm, last_name: e.target.value })}
                        className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Last name"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">System Role *</label>
                    <select
                      value={inviteForm.role}
                      onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value as 'user' | 'admin' })}
                      className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Role</label>
                    <select
                      value={inviteForm.custom_role_id}
                      onChange={(e) => setInviteForm({ ...inviteForm, custom_role_id: e.target.value })}
                      className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">— None —</option>
                      {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                    {roles.length === 0 && (
                      <p className="mt-1 text-xs text-gray-400">No roles created yet. Use "Manage Roles" to add some.</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Department</label>
                    <input
                      type="text"
                      value={inviteForm.department}
                      onChange={(e) => setInviteForm({ ...inviteForm, department: e.target.value })}
                      className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                      placeholder="e.g., Sales, Engineering"
                    />
                  </div>
                  <div className="flex justify-end space-x-3 pt-4">
                    <button
                      type="button"
                      onClick={() => { setShowInviteModal(false); setInviteLink(null); }}
                      className="px-4 py-2 text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300 transition-colors"
                      disabled={processing}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={processing}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {processing ? 'Creating...' : 'Create Invitation'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Manage Roles Modal ── */}
      {showRolesModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-10 mx-auto p-6 border w-[560px] shadow-lg rounded-md bg-white max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-lg font-medium text-gray-900">Manage Roles</h3>
              <button onClick={() => { setShowRolesModal(false); resetRoleForm(); }} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>

            {/* Role list */}
            <div className="space-y-3 mb-5">
              {roles.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">No custom roles yet. Create your first role below.</p>
              ) : (
                roles.map(role => {
                  const mappings = roleMappings[role.id] || [];
                  const unassignedSets = permSets.filter(ps => !mappings.find(m => m.permission_set_id === ps.id));
                  return (
                    <div key={role.id} className="border border-gray-200 rounded-md p-3 hover:bg-gray-50">
                      {/* Role header */}
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{role.name}</div>
                          {role.description && <div className="text-xs text-gray-500">{role.description}</div>}
                          <div className="text-xs text-gray-400 mt-0.5">{role.user_count} user{role.user_count !== 1 ? 's' : ''}</div>
                        </div>
                        <div className="flex space-x-2 flex-shrink-0">
                          <button
                            onClick={() => { setEditingRole(role); setRoleForm({ name: role.name, description: role.description || '' }); setShowRoleForm(true); }}
                            className="text-xs text-blue-600 hover:text-blue-900 px-2 py-1 rounded hover:bg-blue-50"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteRole(role)}
                            className="text-xs text-red-600 hover:text-red-900 px-2 py-1 rounded hover:bg-red-50"
                          >
                            Delete
                          </button>
                        </div>
                      </div>

                      {/* Auto-assign permission sets */}
                      <div className="mt-2 pt-2 border-t border-gray-100">
                        <p className="text-xs font-medium text-gray-500 mb-1.5">
                          Auto-assign permission sets when this role is assigned:
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {mappings.map(m => (
                            <span key={m.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-800">
                              {m.perm_set_name}
                              <button
                                onClick={() => handleRemoveRoleMapping(m.id)}
                                className="text-purple-400 hover:text-red-600 font-bold leading-none ml-0.5"
                                title="Remove mapping"
                              >×</button>
                            </span>
                          ))}
                          {unassignedSets.length > 0 && (
                            <select
                              defaultValue=""
                              onChange={(e) => { if (e.target.value) { handleAddRoleMapping(role.id, e.target.value); e.target.value = ''; } }}
                              className="text-xs border-gray-300 rounded-full px-2 py-0.5 focus:ring-blue-500 focus:border-blue-500 bg-gray-50"
                            >
                              <option value="">+ Add…</option>
                              {unassignedSets.map(ps => <option key={ps.id} value={ps.id}>{ps.name}</option>)}
                            </select>
                          )}
                          {mappings.length === 0 && unassignedSets.length === 0 && (
                            <span className="text-xs text-gray-400 italic">No permission sets available</span>
                          )}
                          {mappings.length === 0 && unassignedSets.length > 0 && (
                            <span className="text-xs text-gray-400 italic">None — select one to add</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Add / Edit role form */}
            {showRoleForm ? (
              <div className="border-t pt-4 space-y-3">
                <h4 className="text-sm font-medium text-gray-900">{editingRole ? 'Edit Role' : 'New Role'}</h4>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Name *</label>
                  <input
                    type="text"
                    value={roleForm.name}
                    onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                    placeholder="e.g. Manager, Sales Rep"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
                  <input
                    type="text"
                    value={roleForm.description}
                    onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Optional description"
                  />
                </div>
                <div className="flex justify-end space-x-2">
                  <button onClick={resetRoleForm} className="px-3 py-1.5 text-sm text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200">Cancel</button>
                  <button onClick={handleSaveRole} disabled={savingRole} className="px-3 py-1.5 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50">
                    {savingRole ? 'Saving...' : editingRole ? 'Save Changes' : 'Create Role'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="border-t pt-4">
                <button
                  onClick={() => setShowRoleForm(true)}
                  className="w-full px-4 py-2 text-sm font-medium text-blue-600 border border-blue-300 rounded-md hover:bg-blue-50 transition-colors"
                >
                  + Add New Role
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
