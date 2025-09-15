'use client';

import React, { useState, useEffect } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useSupabase } from '../../providers/SupabaseProvider';

// Interfaces for form data and validation
interface FormFieldValue {
  [key: string]: any;
}

interface FormValidationError {
  [key: string]: string;
}

interface RecordFormProps {
  objectId: string;
  tenantId: string;
  pageLayout: LayoutBlock[];
  fieldMetadata: FieldMetadata[];
  onSuccess?: (recordId: string) => void;
  onCancel?: () => void;
  onError?: (error: string) => void;
}

// Reuse interfaces from TabContent (or move to shared types file)
interface LayoutBlock {
  id: string;
  block_type: 'field' | 'section' | 'related_list';
  label: string;
  field_id?: string;
  section?: string;
  display_order: number;
  width?: 'half' | 'full';
  tenant_id: string;
}

interface FieldMetadata {
  id: string;
  name: string;
  label: string;
  type: string;
  is_required: boolean;
  reference_table?: string;
  reference_display_field?: string;
  tenant_id: string;
}

export default function RecordForm({
  objectId,
  tenantId,
  pageLayout,
  fieldMetadata,
  onSuccess,
  onCancel,
  onError
}: RecordFormProps) {
  // Form state
  const [formData, setFormData] = useState<FormFieldValue>({});
  const [validationErrors, setValidationErrors] = useState<FormValidationError>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Reference field options (for dropdowns)
  const [referenceOptions, setReferenceOptions] = useState<{ [key: string]: any[] }>({});
  
  // Picklist field options (for dropdowns)
  const [picklistOptions, setPicklistOptions] = useState<{ [key: string]: any[] }>({});
  
  // Loading states
  const [referenceLoading, setReferenceLoading] = useState<{ [key: string]: boolean }>({});

  const supabase = createClientComponentClient();
  const { user, userProfile } = useSupabase();

  // Helper function to check if a field is a system field
  const isSystemField = (fieldName: string): boolean => {
    const systemFields = ['created_at', 'updated_at', 'created_by', 'updated_by'];
    return systemFields.includes(fieldName);
  };

  // Helper function to get current user info
  const getCurrentUser = () => {
    // Use actual user information from auth context
    return {
      id: user?.id || 'unknown-user-id',
      name: userProfile ? `${userProfile.first_name} ${userProfile.last_name}`.trim() : (user?.email || 'Unknown User')
    };
  };

  // Initialize form data with default values
  useEffect(() => {
    const initialData: FormFieldValue = {};
    const currentUser = getCurrentUser();
    const now = new Date().toISOString();
    
    pageLayout
      .filter(block => block.block_type === 'field')
      .forEach(block => {
        const field = fieldMetadata.find(f => f.id === block.field_id);
        if (field) {
          // Handle system fields automatically
          if (isSystemField(field.name)) {
            switch (field.name) {
              case 'created_at':
                initialData[field.name] = now;
                break;
              case 'updated_at':
                initialData[field.name] = now;
                break;
              case 'created_by':
                initialData[field.name] = currentUser.id;
                break;
              case 'updated_by':
                initialData[field.name] = currentUser.id;
                break;
              default:
                initialData[field.name] = '';
            }
          } else {
            // Set default values for non-system fields based on field type
            switch (field.type) {
              case 'boolean':
                initialData[field.name] = false;
                break;
              case 'number':
              case 'integer':
                initialData[field.name] = '';
                break;
              case 'autonumber':
                // Autonumber fields should be initialized with null
                // The database trigger will populate them automatically
                initialData[field.name] = null;
                console.log(`🔧 Initialized autonumber field ${field.name} with null`);
                break;
              default:
                initialData[field.name] = '';
            }
          }
        }
      });
    
    console.log('🔧 Initial form data created:', initialData);
    console.log('🔧 Autonumber field in initial data:', initialData.autonumber);
    console.log('🔧 Autonumber field type in initial data:', typeof initialData.autonumber);
    setFormData(initialData);
  }, [pageLayout, fieldMetadata]);

  // Load reference field options (for dropdowns)
  useEffect(() => {
    const loadReferenceOptions = async () => {
      console.log('🔍 === LOADING REFERENCE FIELD OPTIONS ===');
      const referenceFields = fieldMetadata.filter(f => f.type === 'reference');
      console.log('🔍 Reference fields found:', referenceFields);
      
      if (referenceFields.length === 0) {
        console.log('🔍 No reference fields to load options for');
        return;
      }
      
      for (const field of referenceFields) {
        console.log(`🔍 Loading reference options for field: ${field.name} (table: ${field.reference_table})`);
        
        // Set loading state for this field
        setReferenceLoading(prev => ({ ...prev, [field.name]: true }));
        
        try {
          // Use the original working approach: direct RPC call
          const { data, error } = await supabase.rpc('get_reference_options', {
            p_table_name: field.reference_table,
            p_tenant_id: tenantId,
            p_limit: 100
          });

          if (error) {
            console.error(`❌ Error loading reference options for ${field.name}:`, error);
            continue;
          }

          console.log(`✅ Reference options loaded for ${field.name}:`, data);
          console.log(`✅ Options count:`, data?.length || 0);
          if (data && data.length > 0) {
            console.log(`✅ Sample option:`, data[0]);
          } else {
            console.warn(`⚠️ No options returned for ${field.name} from table ${field.reference_table}`);
          }
          
          // Convert to the format expected by the existing state
          const convertedOptions = (data || []).map(opt => ({
            id: opt.id,
            display_name: opt.display_name,
            record_name: opt.record_name
          }));
          
          setReferenceOptions(prev => ({
            ...prev,
            [field.name]: convertedOptions
          }));
          
        } catch (err) {
          console.error(`💥 Exception loading reference options for ${field.name}:`, err);
          console.error(`💥 Exception type:`, typeof err);
          console.error(`💥 Exception message:`, err instanceof Error ? err.message : String(err));
        } finally {
          // Clear loading state for this field
          setReferenceLoading(prev => ({ ...prev, [field.name]: false }));
        }
      }
      
      console.log('🔍 === REFERENCE FIELD OPTIONS LOADING COMPLETE ===');
      console.log('🔍 Final reference options state:', referenceOptions);
    };

    if (fieldMetadata.length > 0 && tenantId) {
      console.log('🔍 Starting reference options loading...');
      loadReferenceOptions();
    } else {
      console.log('🔍 Skipping reference options loading:', { 
        fieldMetadataLength: fieldMetadata.length, 
        tenantId: !!tenantId 
      });
    }
  }, [fieldMetadata, tenantId, supabase]); // Use supabase instead of loadOptions

  // Load picklist field options
  useEffect(() => {
    const loadPicklistOptions = async () => {
      console.log('🔍 Loading picklist options for fields:', fieldMetadata);
      const picklistFields = fieldMetadata.filter(f => f.type === 'picklist');
      console.log('🔍 Found picklist fields:', picklistFields);
      
      for (const field of picklistFields) {
        try {
          console.log(`🔍 Loading picklist values for field: ${field.name} (ID: ${field.id})`);
          // Fetch picklist values from database
          const { data, error } = await supabase
            .rpc('get_picklist_values', {
              p_field_id: field.id
            });

          if (error) {
            console.warn(`Warning loading picklist options for ${field.name}:`, error);
          } else if (data) {
            console.log(`✅ Loaded picklist options for ${field.name}:`, data);
            setPicklistOptions(prev => ({
              ...prev,
              [field.name]: data
            }));
          }
        } catch (err) {
          console.warn(`Error loading picklist options for ${field.name}:`, err);
        }
      }
    };

    if (fieldMetadata.length > 0) {
      loadPicklistOptions();
    }
  }, [fieldMetadata, supabase]);

  // Handle form field changes
  const handleFieldChange = (fieldName: string, value: any) => {
    console.log(`🔧 Field change: ${fieldName} = ${value} (type: ${typeof value})`);
    if (fieldName === 'autonumber') {
      console.log(`🔧 AUTONUMBER FIELD CHANGE DETECTED: ${value} (type: ${typeof value})`);
    }
    setFormData(prev => ({
      ...prev,
      [fieldName]: value
    }));

    // Clear validation error for this field
    if (validationErrors[fieldName]) {
      setValidationErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[fieldName];
        return newErrors;
      });
    }
  };

  // Validate form data
  const validateForm = (): boolean => {
    const errors: FormValidationError = {};
    
    pageLayout
      .filter(block => block.block_type === 'field')
      .forEach(block => {
        const field = fieldMetadata.find(f => f.id === block.field_id);
        if (field) {
          const value = formData[field.name];
          
          // Required field validation
          if (field.is_required && (!value || value === '')) {
            errors[field.name] = `${field.label || field.name} is required`;
          }
          
          // Type-specific validation
          if (value && value !== '') {
            switch (field.type) {
              case 'number':
              case 'integer':
                if (isNaN(Number(value))) {
                  errors[field.name] = `${field.label || field.name} must be a number`;
                }
                break;
              case 'email':
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(value)) {
                  errors[field.name] = `${field.label || field.name} must be a valid email`;
                }
                break;
            }
          }
        }
      });
    
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

   // Handle form submission
   const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    console.log('🔍 === FORM SUBMISSION START ===');
    console.log('🔍 Form data:', formData);
    console.log('🔍 Object ID:', objectId);
    console.log('🔍 Tenant ID:', tenantId);
    console.log('�� Page layout length:', pageLayout.length);
    console.log('🔍 Field metadata length:', fieldMetadata.length);
    
    if (!validateForm()) {
      console.log('❌ Form validation failed');
      return;
    }

    console.log('✅ Form validation passed');
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      console.log('🚀 Calling create_object_record RPC...');
      
      // Prepare the data to send, ensuring system fields are up-to-date
      const submissionData = { ...formData };
      const currentUser = getCurrentUser();
      const now = new Date().toISOString();
      
      // Update system fields with current values
      if (submissionData.created_at) submissionData.created_at = now;
      if (submissionData.updated_at) submissionData.updated_at = now;
      if (submissionData.created_by) submissionData.created_by = currentUser.id;
      if (submissionData.updated_by) submissionData.updated_by = currentUser.id;
      
      // Remove autonumber fields from submission data - they're handled by database triggers
      Object.keys(submissionData).forEach(key => {
        const field = fieldMetadata.find(f => f.name === key);
        if (field && field.type === 'autonumber') {
          console.log(`🔧 Removing autonumber field ${key} from submission data`);
          delete submissionData[key];
        }
      });
      
      // Debug: Check if autonumber field is included
      console.log('🔍 Form data keys:', Object.keys(formData));
      console.log('🔍 Submission data keys:', Object.keys(submissionData));
      console.log('🔍 All field values:', submissionData);
      
      console.log('🚀 RPC parameters:', {
        p_object_id: objectId,
        p_tenant_id: tenantId,
        p_record_data: submissionData
      });
      
      // Create the record using RPC function
      const { data, error } = await supabase
        .rpc('create_object_record', {
          p_object_id: objectId,
          p_tenant_id: tenantId,
          p_record_data: submissionData
        });

      console.log('📡 RPC response received:');
      console.log('📡 Data:', data);
      console.log('📡 Error:', error);
      console.log('📡 Data type:', typeof data);
      console.log('📡 Data structure:', data ? Object.keys(data) : 'null');

      if (error) {
        console.error('❌ RPC error:', error);
        throw new Error(error.message);
      }

            // Handle both array and single object responses
            let recordData = data;
            if (Array.isArray(data) && data.length > 0) {
              recordData = data[0]; // Extract first item from array
              console.log('🔧 Extracted record data from array:', recordData);
            }
            
            // Check if we have valid record data
            if (recordData && recordData.record_id) {
              console.log('🔍 Record data received:', recordData);
              console.log('🔍 Success flag:', recordData.success);
              
              if (recordData.success) {
                // ✅ RPC succeeded
                console.log('✅ Record created successfully:', recordData.record_id);
                onSuccess?.(recordData.record_id);
              } else {
                // ❌ RPC failed
                console.error('❌ RPC failed:', recordData.message);
                throw new Error(recordData.message);
              }
            } else {
              console.error('❌ Invalid record data structure:', recordData);
              throw new Error('No record ID returned from creation');
            }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create record';
      console.error('❌ Error creating record:', errorMessage);
      console.error('❌ Full error object:', err);
      setSubmitError(errorMessage);
      onError?.(errorMessage);
    } finally {
      setIsSubmitting(false);
      console.log('🔍 === FORM SUBMISSION END ===');
    }
  };

  // Render form field based on type
  const renderFormField = (block: LayoutBlock) => {
    const field = fieldMetadata.find(f => f.id === block.field_id);
    if (!field) return null;

    console.log(`🔍 Rendering field: ${field.name} (Type: ${field.type})`);
    
    const fieldValue = field.type === 'autonumber' ? (formData[field.name] ?? null) : (formData[field.name] || '');
    const fieldError = validationErrors[field.name];
    const isRequired = field.is_required;
    const isSystem = isSystemField(field.name);

    // Don't render system fields in the form - they're handled automatically
    if (isSystem) {
      return null;
    }

    return (
      <div key={block.id} className={`${block.width === 'full' ? 'md:col-span-2' : 'md:col-span-1'}`}>
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            {block.label || field.label}
            {isRequired && <span className="text-red-500 ml-1">*</span>}
          </label>
          
          {/* Field Input Based on Type */}
          {field.type === 'text' || field.type === 'varchar' ? (
            <input
              type="text"
              value={fieldValue}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
              className={`block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 ${
                fieldError ? 'border-red-300' : 'border-gray-300'
              }`}
              placeholder={`Enter ${block.label || field.label}`}
              maxLength={255} // VARCHAR(255) limit
            />
          ) : field.type === 'longtext' ? (
            <textarea
              value={fieldValue}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
              rows={4}
              className={`block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 ${
                fieldError ? 'border-red-300' : 'border-gray-300'
              }`}
              placeholder={`Enter ${block.label || field.label}`}
            />
          ) : field.type === 'email' ? (
            <input
              type="email"
              value={fieldValue}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
              className={`block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 ${
                fieldError ? 'border-red-300' : 'border-gray-300'
              }`}
              placeholder={`Enter ${block.label || field.label}`}
            />
          ) : field.type === 'number' || field.type === 'integer' ? (
            <input
              type="number"
              value={fieldValue}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
              className={`block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 ${
                fieldError ? 'border-red-300' : 'border-gray-300'
              }`}
              placeholder={`Enter ${block.label || field.label}`}
            />
          ) : field.type === 'boolean' ? (
            <div className="flex items-center">
              <input
                type="checkbox"
                checked={fieldValue}
                onChange={(e) => handleFieldChange(field.name, e.target.checked)}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <label className="ml-2 text-sm text-gray-700">
                {block.label || field.label}
              </label>
            </div>
          ) : field.type === 'reference' && field.reference_table ? (
            <div className="space-y-2">
              <div className="relative">
                <select
                  value={fieldValue}
                  onChange={(e) => handleFieldChange(field.name, e.target.value)}
                  className={`block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 ${
                    fieldError ? 'border-red-300' : 'border-gray-300'
                  }`}
                  disabled={!referenceOptions[field.name] || referenceOptions[field.name].length === 0 || referenceLoading[field.name]}
                >
                  <option value="">
                    {referenceLoading[field.name] 
                      ? 'Loading options...' 
                      : referenceOptions[field.name]?.length === 0 
                        ? 'No options available' 
                        : `Select ${block.label || field.label}`
                    }
                  </option>
                  {referenceOptions[field.name]?.map((option: any) => (
                    <option key={option.id} value={option.id}>
                      {option.display_name || option.record_name || option.name || option.label || `Record ${option.id}`}
                    </option>
                  )) || []}
                </select>
                
                {/* Loading spinner */}
                {referenceLoading[field.name] && (
                  <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                  </div>
                )}
              </div>
              
            </div>
          ) : field.type === 'picklist' ? (
            <select
              value={fieldValue}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
              className={`block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 ${
                fieldError ? 'border-red-300' : 'border-gray-300'
              }`}
            >
              <option value="">Select {block.label || field.label}</option>
              {picklistOptions[field.name]?.map((option: any) => (
                <option key={option.value} value={option.value}>
                  {option.label || option.value}
                </option>
              )) || []}
            </select>
          ) : field.type === 'date' ? (
            <input
              type="date"
              value={fieldValue}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
              className={`block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 ${
                fieldError ? 'border-red-300' : 'border-gray-300'
              }`}
            />
          ) : field.type === 'datetime' ? (
            <input
              type="datetime-local"
              value={fieldValue}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
              className={`block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 ${
                fieldError ? 'border-red-300' : 'border-gray-300'
              }`}
            />
          ) : field.type === 'autonumber' ? (
            <input
              type="text"
              value="Auto-generated"
              readOnly
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-gray-50 text-gray-500 cursor-not-allowed"
              title="This field is automatically populated by the system"
            />
          ) : (
            <input
              type="text"
              value={fieldValue}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
              className={`block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 ${
                fieldError ? 'border-red-300' : 'border-gray-300'
              }`}
              placeholder={`Enter ${block.label || field.label}`}
            />
          )}
          
          {/* Field Error */}
          {fieldError && (
            <p className="text-sm text-red-600">{fieldError}</p>
          )}
          
        </div>
      </div>
    );
  };

  // Render form sections - FIXED: Only show fields from page layout with proper section grouping and two column layout
  const renderFormSections = () => {
    // Get only field blocks from page layout, sorted by display order
    const fieldBlocks = pageLayout
      .filter(block => block.block_type === 'field')
      .sort((a, b) => a.display_order - b.display_order);

    if (fieldBlocks.length === 0) {
      return (
        <div className="text-center py-8 text-gray-500">
          <p>No fields configured in page layout</p>
        </div>
      );
    }

    // Extract unique sections from layout blocks (matching RecordDetailView logic)
    const allSections = Array.from(
      new Set(pageLayout.map(block => block.section))
    );
    
    const uniqueSections = allSections
      .filter(section => section !== 'related_lists') // Filter out related_lists section
      .sort((a, b) => {
        // Prioritize "details" section at the top
        if (a === 'details') return -1;
        if (b === 'details') return 1;
        return a.localeCompare(b);
      }) as string[];

    if (uniqueSections.length === 0) {
      // No sections, render all fields in one group with two column layout
      // Separate editable and system fields
      const editableFields = fieldBlocks.filter(block => {
        const field = fieldMetadata.find(f => f.id === block.field_id);
        return field && !isSystemField(field.name);
      });
      
      const systemFields = fieldBlocks.filter(block => {
        const field = fieldMetadata.find(f => f.id === block.field_id);
        return field && isSystemField(field.name);
      });

      return (
        <div className="space-y-6">
          {/* Editable fields first */}
          {editableFields.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {editableFields.map(renderFormField)}
            </div>
          )}
          
          {/* System fields at bottom */}
          {systemFields.length > 0 && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-700 mb-3">System Fields (Auto-populated)</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {systemFields.map(block => {
                  const field = fieldMetadata.find(f => f.id === block.field_id);
                  if (!field) return null;
                  
                  let displayValue = '';
                  let displayLabel = '';
                  const currentUser = getCurrentUser();
                  const now = new Date().toLocaleString();
                  
                  switch (field.name) {
                    case 'created_at':
                      displayValue = now;
                      displayLabel = 'Created At';
                      break;
                    case 'updated_at':
                      displayValue = now;
                      displayLabel = 'Updated At';
                      break;
                    case 'created_by':
                      displayValue = currentUser.name;
                      displayLabel = 'Created By';
                      break;
                    case 'updated_by':
                      displayValue = currentUser.name;
                      displayLabel = 'Updated By';
                      break;
                    default:
                      displayValue = 'Auto-populated';
                      displayLabel = field.label || field.name;
                  }

                  return (
                    <div key={field.id} className="flex flex-col">
                      <label className="block text-sm font-medium text-gray-500 mb-1">
                        {displayLabel}
                      </label>
                      <div className="text-sm text-gray-900 bg-white border border-gray-300 rounded-md px-3 py-2">
                        {displayValue}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      );
    }

    // Render fields grouped by sections with two column layout
    return uniqueSections.map(section => {
      const sectionFields = fieldBlocks.filter(block => 
        block.section === section
      );

      // Separate editable and system fields within each section
      const editableFields = sectionFields.filter(block => {
        const field = fieldMetadata.find(f => f.id === block.field_id);
        return field && !isSystemField(field.name);
      });
      
      const systemFields = sectionFields.filter(block => {
        const field = fieldMetadata.find(f => f.id === block.field_id);
        return field && isSystemField(field.name);
      });

      return (
        <div key={section} className="space-y-4">
          <h3 className="text-lg font-medium text-gray-900 border-b border-gray-200 pb-2 capitalize">
            {section}
          </h3>
          
          {/* Editable fields first */}
          {editableFields.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {editableFields.map(renderFormField)}
            </div>
          )}
          
          {/* System fields at bottom of section */}
          {systemFields.length > 0 && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <h4 className="text-sm font-medium text-gray-700 mb-3">System Fields (Auto-populated)</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {systemFields.map(block => {
                  const field = fieldMetadata.find(f => f.id === block.field_id);
                  if (!field) return null;
                  
                  let displayValue = '';
                  let displayLabel = '';
                  const currentUser = getCurrentUser();
                  const now = new Date().toLocaleString();
                  
                  switch (field.name) {
                    case 'created_at':
                      displayValue = now;
                      displayLabel = 'Created At';
                      break;
                    case 'updated_at':
                      displayValue = now;
                      displayLabel = 'Updated At';
                      break;
                    case 'created_by':
                      displayValue = currentUser.name;
                      displayLabel = 'Created By';
                      break;
                    case 'updated_by':
                      displayValue = currentUser.name;
                      displayLabel = 'Updated By';
                      break;
                    default:
                      displayValue = 'Auto-populated';
                      displayLabel = field.label || field.name;
                  }

                  return (
                    <div key={field.id} className="flex flex-col">
                      <label className="block text-sm font-medium text-gray-500 mb-1">
                        {displayLabel}
                      </label>
                      <div className="text-sm text-gray-900 bg-white border border-gray-300 rounded-md px-3 py-2">
                        {displayValue}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      );
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Form Content */}
      {renderFormSections()}
      
      {/* Submit Error */}
      {submitError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">Error Creating Record</h3>
              <p className="text-sm text-red-700 mt-1">{submitError}</p>
            </div>
          </div>
        </div>
      )}
      
      {/* Form Actions */}
      <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
        >
          {isSubmitting ? (
            <>
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Creating...
            </>
          ) : (
            'Create Record'
          )}
        </button>
      </div>
    </form>
  );
}