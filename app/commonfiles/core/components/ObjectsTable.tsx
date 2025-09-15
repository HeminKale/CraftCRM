'use client';

import React, { useState, useEffect } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

interface Object {
  id: string;
  name: string;
  label: string;
  description: string;
  is_active: boolean;
  tenant_id: string;
  created_at: string;
  updated_at: string;
}

interface ObjectsTableProps {
  tenant: any;
  onObjectSelect?: (object: Object) => void;
  showActions?: boolean;
  selectable?: boolean;
  selectedObjectId?: string;
  onSelectionChange?: (objectId: string | null) => void;
}

export default function ObjectsTable({ 
  tenant, 
  onObjectSelect, 
  showActions = true, 
  selectable = false,
  selectedObjectId,
  onSelectionChange 
}: ObjectsTableProps) {
  const [objects, setObjects] = useState<Object[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingObject, setEditingObject] = useState<Object | null>(null);
  const [newObject, setNewObject] = useState({
    name: '',
    label: '',
    description: '',
    is_active: true
  });

  const supabase = createClientComponentClient();

  useEffect(() => {
    if (tenant?.id) {
      fetchObjects();
    }
  }, [tenant?.id]);

  const fetchObjects = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .schema('tenant')
        .from('objects')
        .select('*')
        .eq('tenant_id', tenant.id)
        .order('name');

      if (error) throw error;
      setObjects(data || []);
    } catch (err: any) {
      console.error('Error fetching objects:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateObject = async () => {
    if (!newObject.name.trim()) return;

    try {
      const { data, error } = await supabase
        .schema('tenant')
        .from('objects')
        .insert([{
          ...newObject,
          tenant_id: tenant.id
        }])
        .select();

      if (error) throw error;

      setObjects([...objects, data[0]]);
      setShowCreateModal(false);
      setNewObject({ name: '', label: '', description: '', is_active: true });
    } catch (err: any) {
      console.error('Error creating object:', err);
      setError(err.message);
    }
  };

  const handleEditObject = async () => {
    if (!editingObject || !editingObject.name.trim()) return;

    try {
      const { error } = await supabase
        .schema('tenant')
        .from('objects')
        .update({
          name: editingObject.name,
          label: editingObject.label,
          description: editingObject.description,
          is_active: editingObject.is_active
        })
        .eq('id', editingObject.id);

      if (error) throw error;

      setObjects(objects.map(obj => 
        obj.id === editingObject.id ? editingObject : obj
      ));
      setShowCreateModal(false);
      setEditingObject(null);
    } catch (err: any) {
      console.error('Error updating object:', err);
      setError(err.message);
    }
  };

  const handleDeleteObject = async (objectId: string) => {
    if (!confirm('Are you sure you want to delete this object? This action cannot be undone.')) return;

    try {
      const { error } = await supabase
        .schema('tenant')
        .from('objects')
        .delete()
        .eq('id', objectId);

      if (error) throw error;

      setObjects(objects.filter(obj => obj.id !== objectId));
    } catch (err: any) {
      console.error('Error deleting object:', err);
      setError(err.message);
    }
  };

  const handleObjectClick = (object: Object) => {
    if (selectable) {
      const newSelectedId = selectedObjectId === object.id ? null : object.id;
      onSelectionChange?.(newSelectedId);
    } else if (onObjectSelect) {
      onObjectSelect(object);
    }
  };

  const handleToggleActive = async (object: Object) => {
    try {
      const { error } = await supabase
        .schema('tenant')
        .from('objects')
        .update({ is_active: !object.is_active })
        .eq('id', object.id);

      if (error) throw error;

      setObjects(objects.map(obj => 
        obj.id === object.id ? { ...obj, is_active: !obj.is_active } : obj
      ));
    } catch (err: any) {
      console.error('Error toggling object status:', err);
      setError(err.message);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4">
        <div className="flex">
          <div className="text-red-400">⚠️</div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-red-800">Error loading objects</h3>
            <div className="mt-2 text-sm text-red-700">{error}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-medium text-gray-900">Objects</h3>
          <p className="text-sm text-gray-500">
            {objects.length} object{objects.length !== 1 ? 's' : ''} available
          </p>
        </div>
        {showActions && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            + Create Object
          </button>
        )}
      </div>

      {/* Objects Table */}
      <div className="bg-white shadow overflow-hidden border border-gray-200 rounded-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {selectable && <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Select
              </th>}
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Label
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Description
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              {showActions && (
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {objects.length === 0 ? (
              <tr>
                <td colSpan={selectable ? 6 : 5} className="px-6 py-12 text-center text-gray-500">
                  <div className="flex flex-col items-center">
                    <div className="text-4xl mb-2">📋</div>
                    <p className="text-lg font-medium">No objects found</p>
                    <p className="text-sm">Create your first object to get started</p>
                  </div>
                </td>
              </tr>
            ) : (
              objects.map((object) => (
                <tr 
                  key={object.id} 
                  className={`hover:bg-gray-50 cursor-pointer ${
                    selectable && selectedObjectId === object.id ? 'bg-blue-50' : ''
                  }`}
                  onClick={() => handleObjectClick(object)}
                >
                  {selectable && (
                    <td className="px-6 py-4 whitespace-nowrap">
                      <input
                        type="radio"
                        name="selectedObject"
                        checked={selectedObjectId === object.id}
                        onChange={() => onSelectionChange?.(object.id)}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                      />
                    </td>
                  )}
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">{object.name}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{object.label || '-'}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-gray-900 max-w-xs truncate">
                      {object.description || '-'}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      object.is_active 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {object.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  {showActions && (
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex space-x-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingObject(object);
                            setNewObject({
                              name: object.name,
                              label: object.label || '',
                              description: object.description || '',
                              is_active: object.is_active
                            });
                            setShowCreateModal(true);
                          }}
                          className="text-blue-600 hover:text-blue-900"
                        >
                          Edit
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleActive(object);
                          }}
                          className={`${
                            object.is_active ? 'text-yellow-600 hover:text-yellow-900' : 'text-green-600 hover:text-green-900'
                          }`}
                        >
                          {object.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteObject(object.id);
                          }}
                          className="text-red-600 hover:text-red-900"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create/Edit Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96 max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900">
                {editingObject ? 'Edit Object' : 'Create New Object'}
              </h3>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setEditingObject(null);
                  setNewObject({ name: '', label: '', description: '', is_active: true });
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Object Name *</label>
                <input
                  type="text"
                  value={newObject.name}
                  onChange={(e) => setNewObject({ ...newObject, name: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g., account, contact, lead"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Display Label</label>
                <input
                  type="text"
                  value={newObject.label}
                  onChange={(e) => setNewObject({ ...newObject, label: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g., Account, Contact, Lead"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Description</label>
                <textarea
                  value={newObject.description}
                  onChange={(e) => setNewObject({ ...newObject, description: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  rows={3}
                  placeholder="Describe what this object represents..."
                />
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="is_active"
                  checked={newObject.is_active}
                  onChange={(e) => setNewObject({ ...newObject, is_active: e.target.checked })}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="is_active" className="ml-2 block text-sm text-gray-900">
                  Object is active
                </label>
              </div>
            </div>

            <div className="mt-6 flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setEditingObject(null);
                  setNewObject({ name: '', label: '', description: '', is_active: true });
                }}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={editingObject ? handleEditObject : handleCreateObject}
                disabled={!newObject.name.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {editingObject ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
