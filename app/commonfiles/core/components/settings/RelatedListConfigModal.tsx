'use client';

import React, { useState, useEffect } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useSupabase } from '../../providers/SupabaseProvider';
import Message from '../ui/Message';

export interface FieldMetadata {
  id: string;
  object_id: string;
  api_name: string;
  display_label: string;
  field_type: string;
  is_required: boolean;
  is_nullable: boolean;
  default_value: string | null;
  validation_rules: any[];
  display_order: number;
  section: string;
  width: 'half' | 'full';
  is_visible: boolean;
  is_system_field: boolean;
  reference_table: string | null;
  reference_display_field: string | null;
}

export interface RelatedList {
  id: string;
  parent_table: string;
  child_table: string;
  foreign_key_field: string;
  label: string;
  display_columns: string[];
  section: string;
  display_order: number;
  is_visible: boolean;
}

export interface LayoutBlock {
  id: string;
  object_id: string;
  block_type: 'field' | 'related_list' | 'button';
  field_id?: string;
  related_list_id?: string;
  button_id?: string;
  label: string;
  section: string;
  display_order: number;
  width?: 'half' | 'full';
  is_visible: boolean;
  created_at?: string;
  updated_at?: string;
  tab_type?: 'main' | 'related_list';
  display_columns?: string[];
}

interface RelatedListConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  layoutBlock: LayoutBlock | null;
  relatedList: RelatedList | null;
  onSave: (blockId: string, displayColumns: string[], customLabel?: string) => void;
  tenantId: string;
}

export default function RelatedListConfigModal({
  isOpen,
  onClose,
  layoutBlock,
  relatedList,
  onSave,
  tenantId,
}: RelatedListConfigModalProps) {
  const { tenant } = useSupabase();
  const supabase = createClientComponentClient();
  
  const [childFields, setChildFields] = useState<FieldMetadata[]>([]);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [customLabel, setCustomLabel] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  
  // Fetch child object fields when modal opens
  useEffect(() => {
    console.log('🔍 useEffect triggered:', { isOpen, relatedList: relatedList?.child_table, tenantId: tenant?.id });
    if (isOpen && relatedList && tenant?.id) {
      console.log('✅ All conditions met, calling fetchChildFields');
      fetchChildFields(relatedList.child_table);
      setCustomLabel(layoutBlock?.label || relatedList.label);
      
      // Don't set selected fields here - let fetchChildFields handle it after fetching the actual fields
    } else {
      console.log('❌ Conditions not met:', { 
        isOpen, 
        hasRelatedList: !!relatedList, 
        hasTenant: !!tenant?.id,
        relatedListChildTable: relatedList?.child_table
      });
    }
  }, [isOpen, relatedList, layoutBlock, tenant?.id]);

  // ... existing code ...

const fetchChildFields = async (childTable: string) => {
  try {
    setLoading(true);
    console.log('🔍 fetchChildFields called with childTable:', childTable);
    console.log('🔍 Current tenant ID:', tenant!.id);
    
    // First, get the object ID from the table name using the bridge function
    const { data: objectsData, error: objectsError } = await supabase
      .rpc('get_tenant_objects', { p_tenant_id: tenant!.id });

    if (objectsError) {
      console.error('❌ Error fetching objects:', objectsError);
      throw new Error(`Failed to fetch objects: ${objectsError.message}`);
    }

    console.log('✅ Objects fetched:', objectsData);
    const objectData = objectsData?.find((obj: any) => obj.name === childTable);
    console.log('🔍 Found object data:', objectData);

    if (!objectData?.id) {
      throw new Error(`Object not found: ${childTable}`);
    }

    // Now call get_tenant_fields with the actual object ID
    console.log('🔍 Calling get_tenant_fields with object ID:', objectData.id);
    const { data, error } = await supabase.rpc('get_tenant_fields', {
      p_tenant_id: tenant!.id,
      p_object_id: objectData.id  // Use the actual UUID, not the table name
    });

    if (error) {
      console.error('❌ Error fetching fields:', error);
      throw error;
    }

    console.log('✅ Fields fetched:', data);
    
    // Debug: Log the structure of the first few fields to understand the actual data format
    if (data && data.length > 0) {
      console.log('🔍 First field structure:', data[0]);
      console.log('🔍 Field keys:', Object.keys(data[0]));
      console.log('🔍 Sample field values:', data.slice(0, 3).map(field => ({
        id: field.id,
        api_name: field.api_name || (field as any).name || (field as any).field_name,
        display_label: field.display_label || (field as any).label || (field as any).name,
        field_type: field.field_type || (field as any).type
      })));
    }
    
    setChildFields(data || []);
    
    // Update selected fields to ensure they exist in the fetched fields
    if (data && data.length > 0) {
      setSelectedFields(prev => {
        const availableFieldNames = data.map(field => {
          const fieldAny = field as any;
          const fieldName = field.api_name || fieldAny.name || fieldAny.field_name;
          return fieldName || 'unknown_field';
        }).filter(Boolean);
        
        // First try to use existing display_columns from layoutBlock if available
        if (layoutBlock?.display_columns && layoutBlock.display_columns.length > 0) {
          const validExistingFields = layoutBlock.display_columns.filter(fieldName => 
            availableFieldNames.includes(fieldName)
          );
          if (validExistingFields.length > 0) {
            return validExistingFields;
          }
        }
        
        // If no valid existing fields, try to use previous selection
        const validSelectedFields = prev.filter(fieldName => availableFieldNames.includes(fieldName));
        
        // If no valid fields are selected, select the first few available fields
        if (validSelectedFields.length === 0 && data.length > 0) {
                  return data.slice(0, Math.min(3, data.length)).map(field => {
          const fieldAny = field as any;
          const fieldName = field.api_name || fieldAny.name || fieldAny.field_name;
          return fieldName || 'unknown_field';
        }).filter(Boolean);
        }
        
        return validSelectedFields;
      });
    }
  } catch (err: any) {
    console.error('❌ Error fetching child fields:', err);
    setMessage({ 
      text: `Error fetching fields: ${err.message || 'An unexpected error occurred'}`, 
      type: 'error' 
    });
  } finally {
    setLoading(false);
  }
};


  const handleFieldToggle = (fieldApiName: string) => {
    if (!fieldApiName || fieldApiName === 'unknown_field') {
      console.warn('Attempted to toggle invalid field name:', fieldApiName);
      return;
    }
    
    setSelectedFields(prev => 
      prev.includes(fieldApiName) 
        ? prev.filter(f => f !== fieldApiName)
        : [...prev, fieldApiName]
    );
  };

  const handleSelectAll = () => {
    setSelectedFields(childFields.map(field => {
      const fieldAny = field as any;
      const fieldName = field.api_name || fieldAny.name || fieldAny.field_name;
      return fieldName || 'unknown_field';
    }).filter(Boolean));
  };

  const handleSelectNone = () => {
    setSelectedFields([]);
  };

  const handleSelectDefault = () => {
    if (childFields.length === 0) return;
    
    // Try to select common default fields in order of preference
    const preferredFields = ['id', 'name', 'title', 'label', 'code'];
    const availableFieldNames = childFields.map(field => {
      const fieldAny = field as any;
      const fieldName = field.api_name || fieldAny.name || fieldAny.field_name;
      return fieldName || 'unknown_field';
    }).filter(Boolean);
    
    // Find the first available preferred fields
    const selectedDefaultFields = preferredFields.filter(fieldName => 
      availableFieldNames.includes(fieldName)
    );
    
    // If no preferred fields found, select the first few available fields
    if (selectedDefaultFields.length === 0) {
      const fallbackFields = childFields
        .filter(field => field.is_visible || (field as any).visible)
        .slice(0, Math.min(3, childFields.length))
        .map(field => {
          const fieldAny = field as any;
          const fieldName = field.api_name || fieldAny.name || fieldAny.field_name;
          return fieldName || 'unknown_field';
        }).filter(Boolean);
      setSelectedFields(fallbackFields);
    } else {
      setSelectedFields(selectedDefaultFields);
    }
  };

  const handleSave = () => {
    if (!layoutBlock || selectedFields.length === 0) {
      setMessage({ text: '⚠️ Please select at least one field', type: 'error' });
      return;
    }

    onSave(layoutBlock.id, selectedFields, customLabel.trim() || undefined);
    onClose();
  };

  const filteredFields = childFields.filter(field => {
    // Safely access field properties with fallbacks, using type assertion for dynamic data
    const fieldAny = field as any;
    
    // Standardize on ONE field name property to avoid duplicates
    const fieldName = field.api_name || fieldAny.name || fieldAny.field_name || '';
    const displayLabel = field.display_label || fieldAny.label || fieldAny.name || '';
    
    // Only include fields that have at least one valid name property
    if (!fieldName) {
      console.warn('Field missing field name:', field);
      return false;
    }
    
    // Search by both display label and field name
    return displayLabel.toLowerCase().includes(searchQuery.toLowerCase()) ||
           fieldName.toLowerCase().includes(searchQuery.toLowerCase());
  }).filter((field, index, self) => {
    // Remove duplicates based on field name
    const fieldAny = field as any;
    const fieldName = field.api_name || fieldAny.name || fieldAny.field_name || '';
    return self.findIndex(f => {
      const fAny = f as any;
      const fName = f.api_name || fAny.name || fAny.field_name || '';
      return fName === fieldName;
    }) === index;
  });

  // Debug logging
  console.log('🔍 Modal state:', {
    isOpen,
    childFieldsCount: childFields.length,
    selectedFieldsCount: selectedFields.length,
    filteredFieldsCount: filteredFields.length,
    loading,
    hasMessage: !!message
  });
  
  // Debug: Log the first few child fields to see their structure
  if (childFields.length > 0) {
    console.log('🔍 First few child fields:', childFields.slice(0, 3).map(field => ({
      id: field.id,
      api_name: field.api_name,
      display_label: field.display_label,
      field_type: field.field_type,
      hasApiName: !!field.api_name,
      hasDisplayLabel: !!field.display_label
    })));
  }

  if (!isOpen) return null;

  return (
    <div className="fixed z-50 inset-0 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
      <div className="flex items-center justify-center min-h-screen text-center sm:p-0">
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" aria-hidden="true"></div>
        
        <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
        
        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-2xl sm:w-full">
          <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
            <div className="sm:flex sm:items-start">
              <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-blue-100 sm:mx-0 sm:h-10 sm:w-10">
                <svg className="h-6 w-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              
              <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                <h3 className="text-lg leading-6 font-medium text-gray-900" id="modal-title">
                  Configure Related List: {relatedList?.label}
                </h3>
                
                <div className="mt-4 space-y-6">
                  {/* Custom Label */}
                  <div>
                    <label htmlFor="custom-label" className="block text-sm font-medium text-gray-700">
                      Tab Label
                    </label>
                    <input
                      type="text"
                      id="custom-label"
                      className="mt-1 focus:ring-blue-500 focus:border-blue-500 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"
                      value={customLabel}
                      onChange={(e) => setCustomLabel(e.target.value)}
                      placeholder="Enter custom tab label (optional)"
                    />
                    <p className="mt-1 text-sm text-gray-500">
                      This will be the name of the tab on the parent record page. Leave empty to use the default label.
                    </p>
                  </div>

                  {/* Field Selection */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <label className="block text-sm font-medium text-gray-700">
                        Visible Fields ({selectedFields.length} selected)
                      </label>
                      <div className="flex space-x-2">
                        <button
                          type="button"
                          onClick={handleSelectDefault}
                          className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                        >
                          Default
                        </button>
                        <button
                          type="button"
                          onClick={handleSelectAll}
                          className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                        >
                          All
                        </button>
                        <button
                          type="button"
                          onClick={handleSelectNone}
                          className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200"
                        >
                          None
                        </button>
                      </div>
                    </div>

                    {/* Search */}
                    <div className="mb-3">
                      <input
                        type="text"
                        placeholder="Search fields..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>

                    {/* Field List */}
                    <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-md">
                      {loading ? (
                        <div className="p-4 text-center text-gray-500">
                          Loading fields...
                        </div>
                      ) : filteredFields.length === 0 ? (
                        <div className="p-4 text-center text-gray-500">
                          {searchQuery ? 'No fields match your search' : 'No fields available'}
                        </div>
                      ) : (
                        <div className="divide-y divide-gray-200">
                          {filteredFields.map((field) => {
                            const fieldAny = field as any;
                            // Use consistent field name property
                            const fieldName = field.api_name || fieldAny.name || fieldAny.field_name || '';
                            const displayLabel = field.display_label || fieldAny.label || fieldAny.name || 'Unnamed Field';
                            
                            if (!fieldName) return null; // Skip fields without names
                            
                            return (
                              <label
                                key={field.id}
                                className="flex items-center px-4 py-3 hover:bg-gray-50 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                  checked={selectedFields.includes(fieldName)}
                                  onChange={() => handleFieldToggle(fieldName)}
                                />
                                <div className="ml-3 flex-1">
                                  <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium text-gray-900">
                                      {displayLabel}
                                    </span>
                                    <div className="flex items-center space-x-2">
                                      {(field.is_system_field || fieldAny.system_field) && (
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                                          System
                                        </span>
                                      )}
                                      {(field.reference_table || fieldAny.reference_table) && (
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                                          {field.reference_table || fieldAny.reference_table}
                                        </span>
                                      )}
                                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                        {field.field_type || fieldAny.type || 'Unknown'}
                                      </span>
                                    </div>
                                  </div>
                                  <p className="text-xs text-gray-500">{fieldName}</p>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    
                    <p className="mt-2 text-sm text-gray-500">
                      Select which fields from the {relatedList?.child_table} object should be visible in this related list tab.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Message Display */}
          {message && (
            <div className="px-4 pb-4">
              <Message
                message={message.text}
                type={message.type}
                onDismiss={() => setMessage(null)}
                autoDismiss={message.type === 'success'}
                dismissDelay={5000}
              />
            </div>
          )}
          
          <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
            <button
              type="button"
              className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm"
              onClick={handleSave}
            >
              Save Configuration
            </button>
            <button
              type="button"
              className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
              onClick={onClose}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
