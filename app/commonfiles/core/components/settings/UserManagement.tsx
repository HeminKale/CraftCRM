'use client';

import React, { useState, useEffect } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useSupabase } from '../../providers/SupabaseProvider';
import DataTable from '../DataTable';
import toast from 'react-hot-toast';
import { sendInvitationEmail } from '../../lib/emailService';

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

interface HomeTabProps {
  tenant: any;
}

export default function UserManagement({ tenant }: HomeTabProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [invitations, setInvitations] = useState<UserInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [invitationsLoading, setInvitationsLoading] = useState(true);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteForm, setInviteForm] = useState({
    email: '',
    first_name: '',
    last_name: '',
    role: 'user' as 'user' | 'admin',
    department: ''
  });
  const [processing, setProcessing] = useState(false);

  const supabase = createClientComponentClient();
  const { userProfile } = useSupabase();

  // Check if current user is admin
  const isAdmin = userProfile?.role === 'admin';

  // Load users and invitations
  useEffect(() => {
    if (tenant?.id) {
      loadUsers();
      loadInvitations();
    }
  }, [tenant]);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .rpc('get_tenant_users', { p_tenant_id: tenant.id });
      
      if (error) {
        console.error('Error loading users:', error);
        toast.error('Failed to load users');
        return;
      }
      
      setUsers(data || []);
    } catch (err) {
      console.error('Error loading users:', err);
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
      
      if (error) {
        console.error('Error loading invitations:', error);
        toast.error('Failed to load invitations');
        return;
      }
      
      setInvitations(data || []);
    } catch (err) {
      console.error('Error loading invitations:', err);
      toast.error('Failed to load invitations');
    } finally {
      setInvitationsLoading(false);
    }
  };

  const handleInviteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!isAdmin) {
      toast.error('Only admins can invite users');
      return;
    }

    try {
      setProcessing(true);
      const { data, error } = await supabase
        .rpc('invite_user', {
          p_email: inviteForm.email.toLowerCase().trim(),
          p_first_name: inviteForm.first_name.trim(),
          p_last_name: inviteForm.last_name.trim(),
          p_role: inviteForm.role,
          p_department: inviteForm.department.trim() || null
        });
      
      if (error) {
        console.error('Error inviting user:', error);
        toast.error(error.message || 'Failed to invite user');
        return;
      }
      
      if (data?.[0]?.success) {
        // Send invitation email
        try {
          // Get the invitation details to get the token
          const { data: invitationData, error: invitationError } = await supabase
            .rpc('get_pending_invitations', { p_tenant_id: tenant.id });
          
          if (!invitationError && invitationData) {
            const newInvitation = invitationData.find(inv => inv.email === inviteForm.email.toLowerCase().trim());
            if (newInvitation) {
              const emailSent = await sendInvitationEmail(
                inviteForm.email.toLowerCase().trim(),
                newInvitation.id, // We'll use the invitation ID as a reference
                tenant.name,
                userProfile?.email || 'Admin',
                inviteForm.role,
                inviteForm.department.trim() || undefined
              );
              
              if (emailSent) {
                toast.success('User invited successfully! Invitation email sent.');
              } else {
                toast.success('User invited successfully! However, invitation email could not be sent.');
              }
            }
          }
        } catch (emailError) {
          console.error('Error sending invitation email:', emailError);
          toast.success('User invited successfully! However, invitation email could not be sent.');
        }
        
        // Reset form and reload
        setInviteForm({
          email: '', 
          first_name: '', 
          last_name: '', 
          role: 'user', 
          department: ''
        });
        setShowInviteModal(false);
        loadInvitations();
      } else {
        toast.error(data?.[0]?.message || 'Failed to invite user');
      }
    } catch (err) {
      console.error('Error inviting user:', err);
      toast.error('Failed to invite user');
    } finally {
      setProcessing(false);
    }
  };

  const handleUpdateRole = async (userId: string, newRole: string) => {
    if (!isAdmin) {
      toast.error('Only admins can update user roles');
      return;
    }

    try {
      const { data, error } = await supabase
        .rpc('update_user_role', {
          p_user_id: userId,
          p_new_role: newRole
        });
      
      if (error) {
        console.error('Error updating user role:', error);
        toast.error(error.message || 'Failed to update user role');
        return;
      }
      
      if (data?.[0]?.success) {
        toast.success('User role updated successfully');
        loadUsers(); // Reload to show updated role
      } else {
        toast.error(data?.[0]?.message || 'Failed to update user role');
      }
    } catch (err) {
      console.error('Error updating user role:', err);
      toast.error('Failed to update user role');
    }
  };

  const handleToggleStatus = async (userId: string, isActive: boolean) => {
    if (!isAdmin) {
      toast.error('Only admins can change user status');
      return;
    }

    try {
      const { data, error } = await supabase
        .rpc('toggle_user_status', {
          p_user_id: userId,
          p_is_active: isActive
        });
      
      if (error) {
        console.error('Error toggling user status:', error);
        toast.error(error.message || 'Failed to update user status');
        return;
      }
      
      if (data?.[0]?.success) {
        toast.success(data[0].message);
        loadUsers(); // Reload to show updated status
      } else {
        toast.error(data?.[0]?.message || 'Failed to update user status');
      }
    } catch (err) {
      console.error('Error toggling user status:', err);
      toast.error('Failed to update user status');
    }
  };

  const handleCancelInvitation = async (invitationId: string) => {
    if (!isAdmin) {
      toast.error('Only admins can cancel invitations');
      return;
    }

    try {
      const { data, error } = await supabase
        .rpc('cancel_invitation', {
          p_invitation_id: invitationId,
          p_reason: 'Cancelled by admin'
        });
      
      if (error) {
        console.error('Error cancelling invitation:', error);
        toast.error(error.message || 'Failed to cancel invitation');
        return;
      }
      
      if (data?.[0]?.success) {
        toast.success('Invitation cancelled successfully');
        loadInvitations();
      } else {
        toast.error(data?.[0]?.message || 'Failed to cancel invitation');
      }
    } catch (err) {
      console.error('Error cancelling invitation:', err);
      toast.error('Failed to cancel invitation');
    }
  };

  const handleResendInvitation = async (invitationId: string) => {
    if (!isAdmin) {
      toast.error('Only admins can resend invitations');
      return;
    }

    try {
      const { data, error } = await supabase
        .rpc('resend_invitation', {
          p_invitation_id: invitationId
        });
      
      if (error) {
        console.error('Error resending invitation:', error);
        toast.error(error.message || 'Failed to resend invitation');
        return;
      }
      
      if (data?.[0]?.success) {
        toast.success('Invitation resent successfully');
        loadInvitations();
        // TODO: Send new invitation email
      } else {
        toast.error(data?.[0]?.message || 'Failed to resend invitation');
      }
    } catch (err) {
      console.error('Error resending invitation:', err);
      toast.error('Failed to resend invitation');
    }
  };

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
          <p className="text-sm text-gray-600 mt-1">
            Manage users and their permissions for {tenant.name}
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowInviteModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
          >
            Invite User
          </button>
        )}
      </div>

      {/* Users Table */}
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">Active Users</h3>
        <DataTable
          title="Users"
          data={users}
          searchPlaceholder="Search users..."
          searchKeys={['email', 'first_name', 'last_name', 'role', 'department']}
          loading={loading}
          emptyMessage="No users found. Invite your first user to get started."
          noSearchResultsMessage="No users found matching your search."
          renderHeader={() => (
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                User
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Email
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Role
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Department
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Last Sign In
              </th>
              {isAdmin && (
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              )}
            </tr>
          )}
          renderRow={(user) => (
            <tr key={user.id} className="hover:bg-gray-50">
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                    <span className="text-blue-600 font-medium text-sm">
                      {user.first_name?.[0] || user.last_name?.[0] || user.email[0].toUpperCase()}
                    </span>
                  </div>
                  <div className="ml-3">
                    <div className="text-sm font-medium text-gray-900">
                      {user.first_name && user.last_name 
                        ? `${user.first_name} ${user.last_name}`
                        : user.email
                      }
                    </div>
                    {user.first_name && user.last_name && (
                      <div className="text-sm text-gray-500">{user.email}</div>
                    )}
                  </div>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                {user.email}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                {isAdmin ? (
                  <select
                    value={user.role}
                    onChange={(e) => handleUpdateRole(user.id, e.target.value)}
                    className="text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    disabled={user.id === userProfile?.id} // Can't change own role
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                ) : (
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    user.role === 'admin' 
                      ? 'bg-purple-100 text-purple-800' 
                      : 'bg-gray-100 text-gray-800'
                  }`}>
                    {user.role === 'admin' ? 'Admin' : 'User'}
                  </span>
                )}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                {user.department || '-'}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                {isAdmin ? (
                  <button
                    onClick={() => handleToggleStatus(user.id, !user.is_active)}
                    disabled={user.id === userProfile?.id} // Can't deactivate self
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors ${
                      user.is_active 
                        ? 'bg-green-100 text-green-800 hover:bg-green-200' 
                        : 'bg-red-100 text-red-800 hover:bg-red-200'
                    } ${user.id === userProfile?.id ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    {user.is_active ? 'Active' : 'Inactive'}
                  </button>
                ) : (
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    user.is_active 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {user.is_active ? 'Active' : 'Inactive'}
                  </span>
                )}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {user.last_sign_in 
                  ? new Date(user.last_sign_in).toLocaleDateString()
                  : 'Never'
                }
              </td>
              {isAdmin && (
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-center">
                  <button 
                    className="text-blue-600 hover:text-blue-900 disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={user.id === userProfile?.id}
                    title={user.id === userProfile?.id ? "Can't edit your own account" : "Edit user"}
                  >
                    Edit
                  </button>
                </td>
              )}
            </tr>
          )}
        />
      </div>

      {/* Pending Invitations */}
      {invitations.length > 0 && (
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Pending Invitations</h3>
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
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Invited User
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Role
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Department
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Invited On
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Expires
                </th>
                {isAdmin && (
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
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
                          : invitation.email
                        }
                      </div>
                      <div className="text-sm text-gray-500">{invitation.email}</div>
                      {invitation.invited_by_email && (
                        <div className="text-xs text-gray-400">
                          Invited by: {invitation.invited_by_email}
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    invitation.role === 'admin' 
                      ? 'bg-purple-100 text-purple-800' 
                      : 'bg-gray-100 text-gray-800'
                  }`}>
                    {invitation.role === 'admin' ? 'Admin' : 'User'}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {invitation.department || '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {new Date(invitation.created_at).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {new Date(invitation.expires_at).toLocaleDateString()}
                </td>
                {isAdmin && (
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-center">
                    <div className="flex space-x-2 justify-center">
                      <button
                        onClick={() => handleResendInvitation(invitation.id)}
                        className="text-blue-600 hover:text-blue-900"
                        title="Resend invitation"
                      >
                        Resend
                      </button>
                      <button
                        onClick={() => handleCancelInvitation(invitation.id)}
                        className="text-red-600 hover:text-red-900"
                        title="Cancel invitation"
                      >
                        Cancel
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            )}
          />
        </div>
      )}

      {/* Invite User Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Invite New User</h3>
              <form onSubmit={handleInviteUser} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Email *</label>
                  <input
                    type="email"
                    required
                    value={inviteForm.email}
                    onChange={(e) => setInviteForm({...inviteForm, email: e.target.value})}
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
                      onChange={(e) => setInviteForm({...inviteForm, first_name: e.target.value})}
                      className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                      placeholder="First name"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Last Name</label>
                    <input
                      type="text"
                      value={inviteForm.last_name}
                      onChange={(e) => setInviteForm({...inviteForm, last_name: e.target.value})}
                      className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Last name"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Role *</label>
                  <select
                    value={inviteForm.role}
                    onChange={(e) => setInviteForm({...inviteForm, role: e.target.value as 'user' | 'admin'})}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Department</label>
                  <input
                    type="text"
                    value={inviteForm.department}
                    onChange={(e) => setInviteForm({...inviteForm, department: e.target.value})}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                    placeholder="e.g., Sales, Engineering"
                  />
                </div>
                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowInviteModal(false)}
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
                    {processing ? 'Sending...' : 'Send Invitation'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
