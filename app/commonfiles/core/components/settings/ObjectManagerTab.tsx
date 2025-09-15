'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import DataTable from '../DataTable';
import Message from '../ui/Message';
import ObjectLayoutEditor, { FieldMetadata } from './ObjectLayoutEditor';

interface Object {
  id: string;
  name: string;
  label: string;
  description: string;
  is_active: boolean;
  created_at: string;
}

interface Field {
  id: string;
  object_id: string;
  name: string;
  label: string;
  type: string;
  is_required: boolean;
  is_nullable: boolean;
  default_value: string | null;
  display_order: number;
  section: string;
  width: 'half' | 'full';
  is_visible: boolean;
  is_system_field: boolean;
  reference_table?: string;
  reference_display_field?: string;
}

interface PicklistValue {
  value: string;
  label: string;
}

interface RelatedList {
  id: string;
  parent_table: string;
  child_table: string;
  foreign_key_field: string;
  label: string;
  display_columns: string[];
  section: string;
  display_order: number;
  is_visible: boolean;
  created_at: string;
  updated_at: string;
  parent_object_name: string;
  child_object_name: string;
  child_object_label: string;
}

interface Button {
  id: string;
  name: string;
  api_name: string;
  button_type: 'object' | 'custom';
  is_active: boolean;
  label?: string;
  custom_component_path?: string;
  custom_route?: string;
  action_type?: string;
  action_config?: any;
  button_style?: string;
  button_size?: string;
  display_order?: number;
  created_at: string;
  updated_at: string;
}

interface ObjectManagerTabProps {
  user: any; // TODO: Define proper user type
  userProfile: any; // TODO: Define proper profile type
  tenant: any; // TODO: Define proper tenant type
}

const objectDetailSections = [
  { id: 'details', label: 'Details', icon: '📋' },
  { id: 'fields', label: 'Fields', icon: '📝' },
 // { id: 'relatedLists', label: 'Related Lists', icon: '🔗' },
  { id: 'layout', label: 'Page Layout', icon: '🎨' },
  { id: 'buttons', label: 'Buttons', icon: '🔘' },
  { id: 'validation', label: 'Validation Rules', icon: '✅' },
];

const dataTypes = [
  { value: 'text', label: 'Text' },
  { value: 'varchar(255)', label: 'Short Text (255 chars)' },
  { value: 'integer', label: 'Integer' },
  { value: 'decimal(10,2)', label: 'Decimal' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'date', label: 'Date' },
  { value: 'timestamptz', label: 'Timestamp' },
  { value: 'uuid', label: 'UUID' },
  { value: 'jsonb', label: 'JSON' },
  { value: 'reference', label: 'Reference (Foreign Key)' },
  { value: 'picklist', label: 'Picklist (Dropdown)' },
  // Additional field types for better UX
  { value: 'money', label: 'Currency' },
  { value: 'percent', label: 'Percentage' },
  { value: 'time', label: 'Time' },
  { value: 'longtext', label: 'Long Text' },
  { value: 'image', label: 'Image URL' },
  { value: 'file', label: 'File Upload (Single)' },
  { value: 'files', label: 'File Upload (Multiple)' },
  { value: 'color', label: 'Color Picker' },
  { value: 'rating', label: 'Rating (1-5)' },
  { value: 'multiselect', label: 'Multi-Select' },
  { value: 'email', label: 'Email' },
  { value: 'url', label: 'URL' },
  { value: 'phone', label: 'Phone' },
];

export default function ObjectManagerTab({ user, userProfile, tenant }: ObjectManagerTabProps) {
  const [selectedSection, setSelectedSection] = useState<'details' | 'fields' | 'layout' | 'buttons' | 'validation'>('details');
  const [selectedObject, setSelectedObject] = useState<string | null>(null);
  const [selectedObjectData, setSelectedObjectData] = useState<Object | null>(null);
  const [loading, setLoading] = useState(true);
  const [objects, setObjects] = useState<Object[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [relatedLists, setRelatedLists] = useState<RelatedList[]>([]);
  const [message, setMessage] = useState('');
  
  // Use refs to track loading state without causing re-renders
  const loadingFieldsRef = useRef(false);
  const loadingRelatedListsRef = useRef(false);
  
  
  // Object management state
  const [showCreateObject, setShowCreateObject] = useState(false);
  const [newObject, setNewObject] = useState({ name: '', label: '', description: '', is_active: true });
  const [creatingObject, setCreatingObject] = useState(false);
  const [showEditObject, setShowEditObject] = useState(false);
  const [editObject, setEditObject] = useState<{ id: string; name: string; label: string; description: string; is_active: boolean } | null>(null);
  const [updatingObject, setUpdatingObject] = useState(false);
  
  // Field management state
  const [showCreateField, setShowCreateField] = useState(false);
  const [newField, setNewField] = useState({
    name: '',
    label: '',
    type: 'text',
    is_required: false,
    is_nullable: true,
    default_value: '',
    section: 'details',
    width: 'half' as 'half' | 'full',
    is_visible: true,
    picklist_values: [] as PicklistValue[],
    reference_table: '',
    reference_display_field: ''
  });
  const [creatingField, setCreatingField] = useState(false);
  const [updatingField, setUpdatingField] = useState(false);
  
  // Reference field configuration state
  const [availableObjects, setAvailableObjects] = useState<{ id: string; name: string; label: string }[]>([]);
  const [referenceFields, setReferenceFields] = useState<{ name: string; label: string }[]>([]);
  const [loadingReferenceData, setLoadingReferenceData] = useState(false);

  // Button management state
  const [buttons, setButtons] = useState<Button[]>([]);
  const [showCreateButton, setShowCreateButton] = useState(false);
  const [newButton, setNewButton] = useState({
    name: '',
    api_name: '',
    button_type: 'object' as 'object' | 'custom',
    is_active: true,
    label: '',
    custom_component_path: '',
    custom_route: '',
    action_type: 'api_call' as 'api_call' | 'component' | 'route',
    action_config: {},
    button_style: 'primary' as 'primary' | 'secondary' | 'success' | 'danger' | 'warning',
    button_size: 'md' as 'sm' | 'md' | 'lg',
    display_order: 0
  });
  const [creatingButton, setCreatingButton] = useState(false);
  const [updatingButton, setUpdatingButton] = useState(false);

  const supabase = createClientComponentClient();

  useEffect(() => {
    if (tenant?.id) {
      loadObjects(tenant.id);
    }
  }, [tenant?.id]);

  const loadObjects = async (tenantId: string) => {
    try {
      console.log('🧭 ObjectManagerTab: Loading objects for tenant:', tenantId);
      const { data, error } = await supabase
        .rpc('get_tenant_objects', { p_tenant_id: tenantId });
  
      if (error) {
        console.error('❌ Error loading objects:', error);
        if (error.code === 'PGRST116') {
          setMessage('❌ Access denied. You do not have permission to view objects in this tenant.');
        } else if (error.code === 'PGRST301') {
          setMessage('❌ Tenant not found or has been deleted.');
        } else if (error.code === 'NETWORK_ERROR') {
          setMessage('❌ Network error. Please check your connection and try again.');
        } else if (error.code === 'TIMEOUT') {
          setMessage('❌ Request timed out. Please try again.');
        } else {
          setMessage(`❌ Error loading objects: ${error.message || 'Unknown error occurred'}`);
        }
        throw error;
      }
  
      console.log('✅ Objects loaded:', data);
      setObjects(data || []);
      setLoading(false);
      
      // Clear selected object if it no longer exists in the new objects list
      if (selectedObject && !data?.find(obj => obj.id === selectedObject)) {
        console.log('🔄 Selected object no longer exists, clearing selection');
        setSelectedObject(null);
        setSelectedObjectData(null);
        setFields([]);
        setRelatedLists([]);
      }
    } catch (error: any) {
      console.error('❌ Error loading objects:', error);
      if (!error.code) {
        setMessage(`❌ An unexpected error occurred: ${error.message || 'Unknown error'}`);
      }
      setLoading(false);
    }
  };

  const loadFields = useCallback(async (objectId: string) => {
    // Prevent multiple simultaneous calls
    if (loadingFieldsRef.current) {
      console.log('⚠️ loadFields already in progress, skipping duplicate call');
      return;
    }
    
    try {
      loadingFieldsRef.current = true;
      console.log('🧭 ObjectManagerTab: Loading fields for object:', objectId);
      const { data, error } = await supabase
        .rpc('get_tenant_fields', { p_object_id: objectId, p_tenant_id: tenant?.id });
  
      if (error) {
        console.error('❌ Error loading fields:', error);
        if (error.code === 'PGRST116') {
          setMessage('❌ Access denied. You do not have permission to view fields for this object.');
        } else if (error.code === 'PGRST301') {
          setMessage('❌ Object not found or has been deleted.');
        } else if (error.code === 'NETWORK_ERROR') {
          setMessage('❌ Network error. Please check your connection and try again.');
        } else if (error.code === 'TIMEOUT') {
          setMessage('❌ Request timed out. Please try again.');
        } else {
          setMessage(`❌ Error loading fields: ${error.message || 'Unknown error occurred'}`);
        }
        throw error;
      }
  
      console.log('✅ Fields loaded:', data);
      
      // Check for duplicates in the data from database
      if (data && data.length > 0) {
        const fieldIds = data.map(f => f.id);
        const uniqueFieldIds = Array.from(new Set(fieldIds));
        if (fieldIds.length !== uniqueFieldIds.length) {
          console.warn('⚠️ Duplicate fields detected in database response:', {
            totalFields: fieldIds.length,
            uniqueFields: uniqueFieldIds.length,
            duplicates: fieldIds.filter((id, index) => fieldIds.indexOf(id) !== index)
          });
          
          // Remove duplicates by keeping only the first occurrence of each field ID
          const uniqueFields = data.filter((field, index) => fieldIds.indexOf(field.id) === index);
          console.log('🔄 Removing duplicates, keeping unique fields:', uniqueFields.length);
          setFields(uniqueFields);
        } else {
          setFields(data);
        }
      } else {
        setFields([]);
      }
    } catch (error: any) {
      console.error('❌ Error loading fields:', error);
      if (!error.code) {
        setMessage(`❌ An unexpected error occurred: ${error.message || 'Unknown error'}`);
      }
    } finally {
      loadingFieldsRef.current = false;
    }
  }, [tenant?.id]);

  const loadRelatedLists = useCallback(async (objectId: string, objectData?: Object) => {
    // Prevent multiple simultaneous calls
    if (loadingRelatedListsRef.current) {
      console.log('⚠️ loadRelatedLists already in progress, skipping duplicate call');
      return;
    }
    
    try {
      loadingRelatedListsRef.current = true;
      console.log('🧭 ObjectManagerTab: Loading related lists for object:', objectId);
      
      // Use provided objectData or fall back to selectedObjectData
      const objectToUse = objectData || selectedObjectData;
      if (!objectToUse) {
        console.log('⚠️ Object data not available, skipping related lists load');
        setMessage('⚠️ Object data not available. Related lists cannot be loaded.');
        return;
      }
  
      console.log('🔍 ObjectManagerTab: Calling get_tenant_related_lists with:', { 
        p_parent_table: objectToUse.name, 
        p_tenant_id: tenant?.id 
      });

      const { data, error } = await supabase
        .rpc('get_tenant_related_lists', { 
          p_parent_table: objectToUse.name, 
          p_tenant_id: tenant?.id 
        });
  
      if (error) {
        console.error('❌ Error loading related lists:', error);
        
        // Check if it's a function not found error
        if (error.code === 'PGRST202' && error.message.includes('get_related_lists')) {
          console.log('⚠️ get_related_lists function not found, setting empty related lists');
          setMessage('⚠️ Related lists function not available. Setting empty list.');
          setRelatedLists([]);
          return;
        }
        
        if (error.code === 'PGRST116') {
          setMessage('❌ Access denied. You do not have permission to view related lists.');
        } else if (error.code === 'PGRST301') {
          setMessage('❌ Object not found or has been deleted.');
        } else if (error.code === 'NETWORK_ERROR') {
          setMessage('❌ Network error. Please check your connection and try again.');
        } else if (error.code === 'TIMEOUT') {
          setMessage('❌ Request timed out. Please try again.');
        } else {
          setMessage(`❌ Error loading related lists: ${error.message || 'Unknown error occurred'}`);
        }
        throw error;
      }

      console.log('✅ Related lists loaded:', data);
      
      // Map the data to match our interface
      const mappedRelatedLists = (data || []).map((item: {
        id: string;
        parent_object_id: string;
        child_object_id: string;
        foreign_key_field: string;
        label: string;
        display_columns: string[];
        section: string;
        display_order: number;
        is_visible: boolean;
        created_at: string;
        updated_at: string;
        parent_object_name: string;
        child_object_name: string;
        child_object_label: string;
      }) => ({
        id: item.id,
        parent_table: item.parent_object_name,
        child_table: item.child_object_name,
        foreign_key_field: item.foreign_key_field,
        label: item.label,
        display_columns: item.display_columns || [],
        section: item.section,
        display_order: item.display_order,
        is_visible: item.is_visible,
        created_at: item.created_at,
        updated_at: item.updated_at,
        parent_object_name: item.parent_object_name,
        child_object_name: item.child_object_name,
        child_object_label: item.child_object_label
      }));
      
      setRelatedLists(mappedRelatedLists);
    } catch (error: any) {
      console.error('❌ Error loading related lists:', error);
      if (!error.code) {
        setMessage(`❌ An unexpected error occurred: ${error.message || 'Unknown error'}`);
      }
    } finally {
      loadingRelatedListsRef.current = false;
    }
  }, [tenant?.id, supabase]);

  const loadButtons = useCallback(async (objectId: string) => {
    try {
      console.log('🔘 ObjectManagerTab: Loading buttons for object:', objectId);
      const { data, error } = await supabase
        .rpc('get_object_buttons', { p_object_id: objectId, p_tenant_id: tenant?.id });

      if (error) {
        console.error('❌ Error loading buttons:', error);
        setMessage(`❌ Error loading buttons: ${error.message || 'Unknown error occurred'}`);
        return;
      }

      console.log('✅ Buttons loaded:', data);
      setButtons(data || []);
    } catch (error: any) {
      console.error('❌ Error loading buttons:', error);
      setMessage(`❌ An unexpected error occurred: ${error.message || 'Unknown error'}`);
    }
  }, [tenant?.id, supabase]);

  // Load fields, related lists, and buttons when object is selected
  useEffect(() => {
    if (selectedObject && selectedObjectData && !loadingFieldsRef.current && !loadingRelatedListsRef.current) {
      console.log('🔄 Loading fields, related lists, and buttons for object:', selectedObject);
      loadFields(selectedObject);
      loadRelatedLists(selectedObject, selectedObjectData);
      loadButtons(selectedObject);
    } else if (!selectedObject) {
      // Clear data when no object is selected
      setFields([]);
      setRelatedLists([]);
      setButtons([]);
      setSelectedObjectData(null);
    }
  }, [selectedObject, selectedObjectData, loadFields, loadRelatedLists, loadButtons]);

  // Log when layout section is selected (for DnD debugging)
  useEffect(() => {
    if (selectedSection === 'layout') {
      console.log('🎨 ObjectManagerTab: Page Layout section selected - DndProvider will be initialized');
    }
  }, [selectedSection]);

  // Load available objects when create field modal opens
  useEffect(() => {
    if (showCreateField && newField.type === 'reference') {
      loadAvailableObjects();
    }
  }, [showCreateField, newField.type]);

  // Debug effect for showCreateButton state
  useEffect(() => {
    console.log('🔘 ObjectManagerTab: showCreateButton state changed to:', showCreateButton);
  }, [showCreateButton]);

  const handleCreateObject = async () => {
    if (!newObject.label.trim() || !newObject.name.trim()) {
      setMessage('❌ Label and API Name are required');
      return;
    }

    // Check if object name already exists
    const existingObject = objects.find(obj => 
      obj.name === newObject.name || obj.name === newObject.name + '__a'
    );
    
    if (existingObject) {
      setMessage('❌ An object with this name already exists. Please choose a different name.');
      return;
    }

    setCreatingObject(true);
    setMessage('');
    
    // Clear form when creating new object
    setNewObject({
      name: '',
      label: '',
      description: '',
      is_active: true
    });

    try {
      console.log('🧭 ObjectManagerTab: Creating object:', newObject);
      const { data, error } = await supabase
        .rpc('create_tenant_object', {
          p_name: newObject.name,
          p_label: newObject.label,
          p_tenant_id: tenant?.id,
          p_description: newObject.description,
          p_is_system_object: false  // Fixed: use p_is_system_object instead of p_is_active
        });

      if (error) {
        console.error('❌ Error creating object:', error);
        throw error;
      }

      console.log('✅ Object created:', data);
      setObjects([...objects, data[0]]);
      setShowCreateObject(false);
      setNewObject({ name: '', label: '', description: '', is_active: true });
      setMessage('✅ Object created successfully!');
      
      // Auto-select the newly created object
      setSelectedObject(data[0].id);
      setSelectedObjectData(data[0]);
    } catch (error: any) {
      console.error('❌ Error creating object:', error);
      
      // Handle specific error types with better user feedback
      let errorMessage = '❌ Error creating object';
      
      if (error.code === '23505') {
        // Unique constraint violation
        errorMessage = '❌ An object with this name already exists. Please choose a different name.';
      } else if (error.code === '23503') {
        // Foreign key constraint violation
        errorMessage = '❌ Invalid tenant or reference. Please check your permissions.';
      } else if (error.code === '42501') {
        // Insufficient privileges
        errorMessage = '❌ Insufficient privileges to create objects. Please contact your administrator.';
      } else if (error.message) {
        errorMessage = `❌ Error creating object: ${error.message}`;
      }
      
      setMessage(errorMessage);
    } finally {
      setCreatingObject(false);
    }
  };

  const handleCreateField = async () => {
    if (!newField.label.trim() || !newField.name.trim()) {
      setMessage('❌ Label and API Name are required');
      return;
    }

    setCreatingField(true);
    setMessage('');
    
    // Clear form when creating new field (not editing)
    if (!showEditField) {
      setNewField({
        name: '',
        label: '',
        type: 'text',
        is_required: false,
        is_nullable: true,
        default_value: '',
        section: 'details',
        width: 'half' as 'half' | 'full',
        is_visible: true,
        picklist_values: [],
        reference_table: '',
        reference_display_field: ''
      });
    }

    try {
      // Backend will handle __a appending, so don't append here
      const fieldName = newField.name;
      
      console.log('🧭 ObjectManagerTab: Creating field:', { ...newField, name: fieldName });
      const { data, error } = await supabase
        .rpc('create_tenant_field', {
          p_object_id: selectedObject!,
          p_name: fieldName,  // Send original name, backend will add __a if needed
          p_label: newField.label,
          p_type: newField.type,
          p_tenant_id: tenant?.id,  // Added missing parameter
          p_is_required: newField.is_required,
          p_is_nullable: newField.is_nullable,
          p_default_value: newField.default_value || null,
          p_validation_rules: '[]',  // Added missing parameter
          p_display_order: 0,  // Added missing parameter
          p_section: newField.section,
          p_width: newField.width,
          p_is_visible: newField.is_visible,
          p_is_system_field: false,  // Added missing parameter
          p_reference_table: newField.reference_table || null,  // Reference table
          p_reference_display_field: newField.reference_display_field || null  // Reference display field
        });

      if (error) {
        console.error('❌ Error creating field:', error);
        throw error;
      }

      console.log('✅ Field created:', data);
      
      // If this is a picklist field and has values, create picklist values
      if (newField.type === 'picklist' && newField.picklist_values.length > 0) {
        try {
          console.log('🧭 ObjectManagerTab: Creating picklist values for field:', data[0].id);
          console.log('🧭 ObjectManagerTab: Picklist values to add:', JSON.stringify(newField.picklist_values));
          console.log('🧭 ObjectManagerTab: Current user:', await supabase.auth.getUser());
          console.log('🧭 ObjectManagerTab: Current session:', await supabase.auth.getSession());
          
          const { error: picklistError } = await supabase
            .rpc('add_picklist_values', {
              p_field_id: data[0].id,
              p_values: newField.picklist_values
            });

          if (picklistError) {
            console.error('❌ Error creating picklist values:', picklistError);
            // Don't throw error here, field was created successfully
            setMessage('✅ Field created successfully! (Picklist values creation failed)');
          } else {
            console.log('✅ Picklist values created successfully');
            setMessage('✅ Field and picklist values created successfully!');
          }
        } catch (picklistError: any) {
          console.error('❌ Error creating picklist values:', picklistError);
          setMessage('✅ Field created successfully! (Picklist values creation failed)');
        }
      } else {
        setMessage('✅ Field created successfully!');
      }
      
      setFields([...fields, data[0]]);
      setShowCreateField(false);
      setNewField({
        name: '',
        label: '',
        type: 'text',
        is_required: false,
        is_nullable: true,
        default_value: '',
        section: 'details',
        width: 'half',
        is_visible: true,
        picklist_values: [],
        reference_table: '',
        reference_display_field: ''
      });
    } catch (error: any) {
      console.error('❌ Error creating field:', error);
      setMessage(`❌ Error creating field: ${error.message}`);
    } finally {
      setCreatingField(false);
    }
  };

  const openEditObject = (object: Object) => {
    setEditObject({
      id: object.id,
      name: object.name,
      label: object.label,
      description: object.description || '',
      is_active: object.is_active
    });
    setShowEditObject(true);
  };

  const handleUpdateObject = async () => {
    if (!editObject || !editObject.label.trim() || !editObject.name.trim()) {
      setMessage('❌ Label and API Name are required');
      return;
    }

    setUpdatingObject(true);
    setMessage('');

    try {
      console.log('🧭 ObjectManagerTab: Updating object:', editObject);
      const { data, error } = await supabase
        .rpc('update_tenant_object', {
          p_object_id: editObject.id,
          p_label: editObject.label,
          p_name: editObject.name,
          p_description: editObject.description,
          p_is_active: editObject.is_active
        });

      if (error) {
        console.error('❌ Error updating object:', error);
        throw error;
      }

      console.log('✅ Object updated:', data);
      setObjects(objects.map(obj => 
        obj.id === editObject.id 
          ? { ...obj, ...editObject }
          : obj
      ));
      setShowEditObject(false);
      setEditObject(null);
      setMessage('✅ Object updated successfully!');
    } catch (error: any) {
      console.error('❌ Error updating object:', error);
      setMessage(`❌ Error updating object: ${error.message}`);
    } finally {
      setUpdatingObject(false);
    }
  };

  // Helper functions for picklist value management
  const addPicklistValue = () => {
    setNewField(prev => ({
      ...prev,
      picklist_values: [...prev.picklist_values, { value: '', label: '' }]
    }));
  };

  const updatePicklistValue = (index: number, field: 'value' | 'label', value: string) => {
    setNewField(prev => ({
      ...prev,
      picklist_values: prev.picklist_values.map((item, i) => 
        i === index ? { ...item, [field]: value } : item
      )
    }));
  };

  const removePicklistValue = (index: number) => {
    setNewField(prev => ({
      ...prev,
      picklist_values: prev.picklist_values.filter((_, i) => i !== index)
    }));
  };

  // Field editing functionality
  const [editingField, setEditingField] = useState<Field | null>(null);
  const [showEditField, setShowEditField] = useState(false);

  const handleEditField = (field: Field) => {
    setEditingField(field);
    setShowEditField(true);
    
    // Pre-populate the form with current field data
    setNewField({
      label: field.label,
      name: field.name,
      type: field.type,
      is_required: field.is_required,
      is_nullable: field.is_nullable,
      default_value: field.default_value || '',
      section: field.section,
      width: field.width,
      is_visible: field.is_visible,
      picklist_values: [],
      reference_table: field.reference_table || '',
      reference_display_field: field.reference_display_field || ''
    });
    
    // Load picklist values if it's a picklist field
    if (field.type === 'picklist') {
      loadPicklistValuesForField(field.id);
    }
    
    // Load reference data if it's a reference field
    if (field.type === 'reference') {
      loadAvailableObjects();
      if (field.reference_table) {
        loadReferenceFields(field.reference_table);
      }
    }
  };

  const handleUpdateField = async () => {
    if (!editingField || !tenant?.id) {
      setMessage('❌ No field selected or tenant not found. Please try again.');
      return;
    }

    try {
      setUpdatingField(true);
      setMessage('');

      // Use the new database functions from Migration 065
      
      // 1. Update field label using tenant.update_field_label
      const { error: labelError } = await supabase
        .rpc('update_field_label', {
          p_field_id: editingField.id,
          p_new_label: newField.label
        });

      if (labelError) {
        console.error('❌ Error updating field label:', labelError);
        setMessage(`❌ Error updating field label: ${labelError.message || 'Unknown error occurred'}`);
        return;
      }

      // 2. Update picklist values if it's a picklist field using tenant.update_picklist_values
      if (editingField.type === 'picklist') {
        // Convert picklist values to array of strings (one per line)
        const picklistValuesArray = newField.picklist_values
          .map(pv => pv.value)
          .filter(value => value && value.trim() !== ''); // Remove empty values

        const { error: picklistError } = await supabase
          .rpc('update_picklist_values', {
            p_field_id: editingField.id,
            p_values: picklistValuesArray
          });

        if (picklistError) {
          console.error('❌ Error updating picklist values:', picklistError);
          setMessage(`❌ Field label updated, but picklist values update failed: ${picklistError.message || 'Unknown error occurred'}`);
          // Continue with success message for label update
        }
      }

      // 3. Update other field properties using new RPC functions
      // Update section
      const { error: sectionError } = await supabase
        .rpc('update_field_section', {
          p_field_id: editingField.id,
          p_new_section: newField.section
        });

      if (sectionError) {
        console.error('❌ Error updating field section:', sectionError);
        setMessage(`❌ Field label updated, but section update failed: ${sectionError.message || 'Unknown error occurred'}`);
      }

      // Update width
      const { error: widthError } = await supabase
        .rpc('update_field_width', {
          p_field_id: editingField.id,
          p_new_width: newField.width
        });

      if (widthError) {
        console.error('❌ Error updating field width:', widthError);
        setMessage(`❌ Field label updated, but width update failed: ${widthError.message || 'Unknown error occurred'}`);
      }

      // Update required status
      const { error: requiredError } = await supabase
        .rpc('update_field_required', {
          p_field_id: editingField.id,
          p_is_required: newField.is_required
        });

      if (requiredError) {
        console.error('❌ Error updating field required status:', requiredError);
        setMessage(`❌ Field label updated, but required status update failed: ${requiredError.message || 'Unknown error occurred'}`);
      }

      // Update visibility
      const { error: visibilityError } = await supabase
        .rpc('update_field_visibility', {
          p_field_id: editingField.id,
          p_is_visible: newField.is_visible
        });

      if (visibilityError) {
        console.error('❌ Error updating field visibility:', visibilityError);
        setMessage(`❌ Field label updated, but visibility update failed: ${visibilityError.message || 'Unknown error occurred'}`);
      }

      // Update default value
      const { error: defaultValueError } = await supabase
        .rpc('update_field_default_value', {
          p_field_id: editingField.id,
          p_default_value: newField.default_value || null
        });

      if (defaultValueError) {
        console.error('❌ Error updating field default value:', defaultValueError);
        setMessage(`❌ Field label updated, but default value update failed: ${defaultValueError.message || 'Unknown error occurred'}`);
      }

      // 4. Update reference configuration if it's a reference field
      if (editingField.type === 'reference') {
        await updateReferenceConfiguration(editingField.id, newField.reference_table, newField.reference_display_field);
      }

      setMessage('✅ Field updated successfully!');
      
      // Close the modal and refresh fields
      setShowEditField(false);
      setEditingField(null);
      if (selectedObject) {
        loadFields(selectedObject);
      }
      
      // Reset form
      setNewField({
        name: '',
        label: '',
        type: 'text',
        is_required: false,
        is_nullable: true,
        default_value: '',
        section: 'details',
        width: 'half' as 'half' | 'full',
        is_visible: true,
        picklist_values: [],
        reference_table: '',
        reference_display_field: ''
      });
    } catch (error: any) {
      console.error('❌ Error updating field:', error);
      if (!error.code) {
        setMessage(`❌ An unexpected error occurred: ${error.message || 'Unknown error'}`);
      }
    } finally {
      setUpdatingField(false);
    }
  };

  // Helper function to update picklist values
  const updatePicklistValues = async (fieldId: string, picklistValues: PicklistValue[]) => {
    try {
      // First, delete existing picklist values
      const { error: deleteError } = await supabase
        .from('tenant.picklist_values')
        .delete()
        .eq('field_id', fieldId);

      if (deleteError) {
        console.error('❌ Error deleting existing picklist values:', deleteError);
        return;
      }

      // Then, insert new picklist values
      if (picklistValues.length > 0) {
        const picklistData = picklistValues.map(pv => ({
          field_id: fieldId,
          value: pv.value,
          label: pv.label
        }));

        const { error: insertError } = await supabase
          .from('tenant.picklist_values')
          .insert(picklistData);

        if (insertError) {
          console.error('❌ Error inserting new picklist values:', insertError);
        }
      }
    } catch (error: any) {
      console.error('❌ Error updating picklist values:', error);
    }
  };

  // Helper function to update reference configuration
  const updateReferenceConfiguration = async (fieldId: string, referenceTable: string, referenceDisplayField: string) => {
    try {
      const { error } = await supabase
        .from('tenant.fields')
        .update({
          reference_table: referenceTable || null,
          reference_display_field: referenceDisplayField || null
        })
        .eq('id', fieldId);

      if (error) {
        console.error('❌ Error updating reference configuration:', error);
      }
    } catch (error: any) {
      console.error('❌ Error updating reference configuration:', error);
    }
  };

  const loadPicklistValuesForField = async (fieldId: string) => {
    if (!fieldId) {
      setMessage('❌ No field selected. Please select a field first.');
      return;
    }
  
    try {
      const { data, error } = await supabase
        .rpc('get_picklist_values', { p_field_id: fieldId });
  
      if (error) {
        console.error('❌ Error loading picklist values:', error);
        if (error.code === 'PGRST116') {
          setMessage('❌ Access denied. You do not have permission to view picklist values.');
        } else if (error.code === 'PGRST301') {
          setMessage('❌ Field not found or has been deleted.');
        } else if (error.code === 'NETWORK_ERROR') {
          setMessage('❌ Network error. Please check your connection and try again.');
        } else if (error.code === 'TIMEOUT') {
          setMessage('❌ Request timed out. Please try again.');
        } else {
          setMessage(`❌ Error loading picklist values: ${error.message || 'Unknown error occurred'}`);
        }
        return;
      }
  
      // Convert to the format expected by the form
      const picklistValues = data?.map(item => ({
        value: item.value,
        label: item.label
      })) || [];
  
      setNewField(prev => ({
        ...prev,
        picklist_values: picklistValues
      }));
    } catch (error: any) {
      console.error('❌ Error loading picklist values:', error);
      if (!error.code) {
        setMessage(`❌ An unexpected error occurred: ${error.message || 'Unknown error'}`);
      }
    }
  };

  const handleManagePicklistValues = (field: Field) => {
    setEditingField(field);
    setShowEditField(true);
    loadPicklistValuesForField(field.id);
  };

  // Helper functions for reference field management
  const loadAvailableObjects = async () => {
    if (!tenant?.id) {
      setMessage('❌ No tenant selected. Please select a tenant first.');
      return;
    }
    
    try {
      setLoadingReferenceData(true);
      const { data, error } = await supabase
        .rpc('get_tenant_objects', { p_tenant_id: tenant.id });
  
      if (error) {
        console.error('❌ Error loading available objects:', error);
        if (error.code === 'PGRST116') {
          setMessage('❌ Access denied. You do not have permission to view objects.');
        } else if (error.code === 'PGRST301') {
          setMessage('❌ Tenant not found or has been deleted.');
        } else if (error.code === 'NETWORK_ERROR') {
          setMessage('❌ Network error. Please check your connection and try again.');
        } else if (error.code === 'TIMEOUT') {
          setMessage('❌ Request timed out. Please try again.');
        } else {
          setMessage(`❌ Error loading available objects: ${error.message || 'Unknown error occurred'}`);
        }
        return;
      }
  
      // Filter out only the current object (include system objects)
      const filteredObjects = (data || []).filter(obj => 
        obj.id !== selectedObject
      );
      
      setAvailableObjects(filteredObjects);
    } catch (error: any) {
      console.error('❌ Error loading available objects:', error);
      if (!error.code) {
        setMessage(`❌ An unexpected error occurred: ${error.message || 'Unknown error'}`);
      }
    } finally {
      setLoadingReferenceData(false);
    }
  };

  const loadReferenceFields = async (objectId: string) => {
    if (!objectId) {
      setReferenceFields([]);
      return;
    }
  
    if (!tenant?.id) {
      setMessage('❌ No tenant selected. Please select a tenant first.');
      return;
    }
  
    try {
      setLoadingReferenceData(true);
      const { data, error } = await supabase
        .rpc('get_tenant_fields', { p_object_id: objectId, p_tenant_id: tenant?.id });
  
      if (error) {
        console.error('❌ Error loading reference fields:', error);
        if (error.code === 'PGRST116') {
          setMessage('❌ Access denied. You do not have permission to view fields.');
        } else if (error.code === 'PGRST301') {
          setMessage('❌ Object not found or has been deleted.');
        } else if (error.code === 'NETWORK_ERROR') {
          setMessage('❌ Network error. Please check your connection and try again.');
        } else if (error.code === 'TIMEOUT') {
          setMessage('❌ Request timed out. Please try again.');
        } else {
          setMessage(`❌ Error loading reference fields: ${error.message || 'Unknown error occurred'}`);
        }
        return;
      }
  
      // Filter to only show text-like fields that can be displayed
      const displayableFields = (data || []).filter(field => 
        ['text', 'varchar(255)', 'name', 'label', 'title'].includes(field.type) && 
        field.is_visible
      );
      
      setReferenceFields(displayableFields);
    } catch (error: any) {
      console.error('❌ Error loading reference fields:', error);
      if (!error.code) {
        setMessage(`❌ An unexpected error occurred: ${error.message || 'Unknown error'}`);
      }
    } finally {
      setLoadingReferenceData(false);
    }
  };

  // Button management functions
  const handleCreateButton = async () => {
    console.log('🔘 ObjectManagerTab: handleCreateButton called');
    console.log('🔘 ObjectManagerTab: newButton data:', newButton);
    console.log('🔘 ObjectManagerTab: selectedObject:', selectedObject);
    
    if (!newButton.name.trim() || !newButton.api_name.trim()) {
      console.log('🔘 ObjectManagerTab: Validation failed - missing name or api_name');
      setMessage('❌ Button name and API name are required');
      return;
    }

    if (!selectedObject) {
      console.log('🔘 ObjectManagerTab: Validation failed - no selected object');
      setMessage('❌ Please select an object first');
      return;
    }

    console.log('🔘 ObjectManagerTab: Starting button creation process');
    setCreatingButton(true);
    setMessage('');

    try {
      console.log('🔘 ObjectManagerTab: Creating button:', newButton);
      console.log('🔘 ObjectManagerTab: Calling create_object_button RPC with object_id:', selectedObject);
      
      const { data, error } = await supabase
        .rpc('create_object_button', {
          p_object_id: selectedObject,
          p_button_data: {
            name: newButton.name,
            api_name: newButton.name, // Use name as api_name since we don't have separate api_name column
            button_type: newButton.button_type,
            is_active: newButton.is_active,
            label: newButton.label,
            tenant_id: tenant?.id, // Add tenant_id to button data
            custom_component_path: newButton.custom_component_path,
            custom_route: newButton.custom_route,
            action_type: newButton.action_type,
            action_config: newButton.action_config,
            button_style: newButton.button_style,
            button_size: newButton.button_size,
            display_order: newButton.display_order
          }
        });

      console.log('🔘 ObjectManagerTab: RPC response - data:', data, 'error:', error);

      if (error) {
        console.error('🔘 ObjectManagerTab: Error creating button:', error);
        throw error;
      }

      console.log('🔘 ObjectManagerTab: Button created successfully:', data);
      setButtons([...buttons, data[0]]);
      setShowCreateButton(false);
      setNewButton({ 
        name: '', 
        api_name: '', 
        button_type: 'object', 
        is_active: true,
        label: '',
        custom_component_path: '',
        custom_route: '',
        action_type: 'api_call',
        action_config: {},
        button_style: 'primary',
        button_size: 'md',
        display_order: 0
      });
      setMessage('✅ Button created successfully!');
    } catch (error: any) {
      console.error('🔘 ObjectManagerTab: Error creating button:', error);
      setMessage(`❌ Error creating button: ${error.message || 'Unknown error occurred'}`);
    } finally {
      console.log('🔘 ObjectManagerTab: Button creation process completed');
      setCreatingButton(false);
    }
  };

  const handleUpdateButton = async (buttonId: string, updatedData: Partial<Button>) => {
    setUpdatingButton(true);
    setMessage('');

    try {
      console.log('🔘 ObjectManagerTab: Updating button:', buttonId, updatedData);
      const { data, error } = await supabase
        .rpc('update_object_button', {
          p_button_id: buttonId,
          p_button_data: {
            ...updatedData,
            tenant_id: tenant?.id // Add tenant_id to button data
          }
        });

      if (error) {
        console.error('❌ Error updating button:', error);
        throw error;
      }

      console.log('✅ Button updated:', data);
      setButtons(buttons.map(btn => btn.id === buttonId ? data[0] : btn));
      setMessage('✅ Button updated successfully!');
    } catch (error: any) {
      console.error('❌ Error updating button:', error);
      setMessage(`❌ Error updating button: ${error.message || 'Unknown error occurred'}`);
    } finally {
      setUpdatingButton(false);
    }
  };

  const handleDeleteButton = async (buttonId: string) => {
    if (!confirm('Are you sure you want to delete this button?')) {
      return;
    }

    try {
      console.log('🔘 ObjectManagerTab: Deleting button:', buttonId);
      const { data, error } = await supabase
        .rpc('delete_object_button', {
          p_button_id: buttonId,
          p_tenant_id: tenant?.id
        });

      if (error) {
        console.error('❌ Error deleting button:', error);
        throw error;
      }

      if (data) {
        console.log('✅ Button deleted successfully');
        setButtons(buttons.filter(btn => btn.id !== buttonId));
        setMessage('✅ Button deleted successfully!');
      } else {
        setMessage('❌ Button not found or could not be deleted');
      }
    } catch (error: any) {
      console.error('❌ Error deleting button:', error);
      setMessage(`❌ Error deleting button: ${error.message || 'Unknown error occurred'}`);
    }
  };

  const getFieldIcon = useCallback((type: string, isReference?: boolean) => {
    if (isReference) return '🔗';
    
    const icons: { [key: string]: string } = {
      'text': '📝',
      'varchar(255)': '📝',
      'integer': '🔢',
      'decimal(10,2)': '💰',
      'boolean': '✅',
      'date': '📅',
      'timestamptz': '⏰',
      'uuid': '🆔',
      'jsonb': '📄',
      'reference': '🔗',
      'picklist': '📋',
      'money': '💰',
      'percent': '📊',
      'time': '⏱️',
      'longtext': '📝',
      'image': '🖼️',
      'file': '📎',
      'files': '📁',
      'color': '🎨',
      'rating': '⭐',
      'multiselect': '📋',
      'email': '📧',
      'url': '🔗',
      'phone': '📞'
    };
    return icons[type] || '📝';
  }, []);

  const isSystemField = useCallback((apiName: string) => {
    const systemFields = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by'];
    return systemFields.includes(apiName);
  }, []);

  const handleLayoutChange = () => {
    // Only refresh fields if we're actually in the layout section
    // This prevents unnecessary reloads that might cause duplicates
    if (selectedObject && selectedSection === 'layout') {
      console.log('🔄 Layout changed, refreshing fields for object:', selectedObject);
      loadFields(selectedObject);
    }
  };

  // Convert Field to FieldMetadata for ObjectLayoutEditor
  const convertFieldsToMetadata = useCallback((fields: Field[]): FieldMetadata[] => {
    return fields.map(field => ({
      id: field.id,
      object_id: field.object_id,
      api_name: field.name,
      display_label: field.label,
      field_type: field.type,
      is_required: field.is_required,
      is_nullable: field.is_nullable,
      default_value: field.default_value,
      validation_rules: [], // TODO: Add validation rules support
      display_order: field.display_order,
      section: field.section,
      width: field.width,
      is_visible: field.is_visible,
      is_system_field: field.is_system_field,
      reference_table: field.reference_table || null,
      reference_display_field: field.reference_display_field || null,
    }));
  }, []);

  

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Message Display */}
      <Message
        message={message}
        type={message.includes('❌') ? 'error' : message.includes('✅') ? 'success' : 'info'}
        onDismiss={() => setMessage('')}
        autoDismiss={true}
        dismissDelay={5000}
      />

      {/* Objects List: show when no object is selected */}
      {!selectedObject && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-gray-900">Objects</h2>
            <button
              onClick={() => setShowCreateObject(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
            >
              + Create Object
            </button>
          </div>

          <DataTable
            data={objects}
            searchKeys={['label', 'name']}
            renderHeader={() => (
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Label</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">API Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
              </tr>
            )}
            renderRow={(object: Object) => (
              <tr key={object.id} className={selectedObject === object.id ? 'bg-blue-50' : ''}>
                <td className="px-6 py-4 whitespace-nowrap">
                  <button
                    onClick={() => {
                      console.log('🧭 ObjectManagerTab: Object clicked from list', {
                        objectId: object.id,
                        apiName: object.name,
                        label: object.label
                      });
                      setSelectedObject(object.id);
                      setSelectedObjectData(object);
                      setSelectedSection('details');
                    }}
                    className="text-blue-600 hover:text-blue-800 font-medium"
                  >
                    {object.label}
                  </button>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{object.name}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(object.created_at).toLocaleDateString()}</td>
              </tr>
            )}
          />

          {/* Create Object Modal */}
          {showCreateObject && (
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg p-6 w-96">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Create New Object</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Label</label>
                    <input
                      type="text"
                      value={newObject.label}
                      onChange={(e) => setNewObject({ ...newObject, label: e.target.value })}
                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                      placeholder="e.g., Customer"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">API Name</label>
                    <input
                      type="text"
                      value={newObject.name}
                      onChange={(e) => setNewObject({ ...newObject, name: e.target.value })}
                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                      placeholder="e.g., customer"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Description</label>
                    <textarea
                      value={newObject.description}
                      onChange={(e) => setNewObject({ ...newObject, description: e.target.value })}
                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                      rows={3}
                    />
                  </div>
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      checked={newObject.is_active}
                      onChange={(e) => setNewObject({ ...newObject, is_active: e.target.checked })}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label className="ml-2 text-sm text-gray-700">Active</label>
                  </div>
                </div>
                <div className="mt-6 flex justify-end space-x-3">
                  <button
                    onClick={() => setShowCreateObject(false)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateObject}
                    disabled={creatingObject}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {creatingObject ? 'Creating...' : 'Create Object'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Edit Object Modal */}
          {showEditObject && editObject && (
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg p-6 w-96">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Edit Object</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Label</label>
                    <input
                      type="text"
                      value={editObject.label}
                      onChange={(e) => setEditObject({ ...editObject, label: e.target.value })}
                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">API Name</label>
                    <input
                      type="text"
                      value={editObject.name}
                      onChange={(e) => setEditObject({ ...editObject, name: e.target.value })}
                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Description</label>
                    <textarea
                      value={editObject.description}
                      onChange={(e) => setEditObject({ ...editObject, description: e.target.value })}
                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                      rows={3}
                    />
                  </div>
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      checked={editObject.is_active}
                      onChange={(e) => setEditObject({ ...editObject, is_active: e.target.checked })}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label className="ml-2 text-sm text-gray-700">Active</label>
                  </div>
                </div>
                <div className="mt-6 flex justify-end space-x-3">
                  <button
                    onClick={() => setShowEditObject(false)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleUpdateObject}
                    disabled={updatingObject}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {updatingObject ? 'Updating...' : 'Update Object'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Detail view with 30/70 split */}
      {selectedObject && (
        <div>
          {/* Back to List Button */}
          <div className="mb-4">
            <button
              onClick={() => setSelectedObject(null)}
              className="flex items-center space-x-2 text-blue-600 hover:text-blue-800 font-medium"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span>Back to Objects List</span>
            </button>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-10 gap-6">
            {/* 30% sidebar tabs */}
            <div className="lg:col-span-3">
              <div className="bg-white rounded-lg border">
                <div className="p-2">
                  <nav className="space-y-1">
                    {objectDetailSections.map((section) => (
                      <button
                        key={section.id}
                        onClick={() => setSelectedSection(section.id as any)}
                        className={`w-full text-left px-4 py-3 rounded-md ${
                          selectedSection === section.id
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                        }`}
                      >
                        <div className="flex items-center space-x-3">
                          <span>{section.icon}</span>
                          <span className="font-medium">{section.label}</span>
                        </div>
                      </button>
                    ))}
                  </nav>
                </div>
              </div>
            </div>

            {/* 70% content */}
            <div className="lg:col-span-7">
              <div className="bg-white rounded-lg border">
                <div className="p-6">
                  {selectedSection === 'details' && (() => {
                    const obj = objects.find(o => o.id === selectedObject);
                    return (
                      <div className="space-y-6">
                        <h2 className="text-xl font-semibold text-gray-900">Object Details</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div>
                            <div className="text-sm text-gray-500">Label</div>
                            <div className="text-sm text-gray-900">{obj?.label || '-'}</div>
                          </div>
                          <div>
                            <div className="text-sm text-gray-500">API Name</div>
                            <div className="text-sm text-gray-900">{obj?.name || '-'}</div>
                          </div>
                          <div>
                            <div className="text-sm text-gray-500">Description</div>
                            <div className="text-sm text-gray-900">{(obj as any)?.description || '-'}</div>
                          </div>
                          <div>
                            <div className="text-sm text-gray-500">Status</div>
                            <div>
                              <span className={`px-2 py-1 text-xs rounded-full ${obj?.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>{obj?.is_active ? 'Active' : 'Inactive'}</span>
                            </div>
                          </div>
                          <div>
                            <div className="text-sm text-gray-500">Created</div>
                            <div className="text-sm text-gray-900">{obj?.created_at ? new Date(obj.created_at).toLocaleDateString() : '-'}</div>
                          </div>
                          <div>
                            <div className="text-sm text-gray-500">Updated</div>
                            <div className="text-sm text-gray-900">{(obj as any)?.updated_at ? new Date((obj as any).updated_at).toLocaleDateString() : '-'}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {selectedSection === 'fields' && (
                    <div>
                      <div className="flex justify-between items-center mb-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-4">
                            <button 
                              onClick={() => setSelectedObject(null)} 
                              className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                            >
                              ← Back to Objects List
                            </button>
                            <div className="text-gray-400">|</div>
                            <div className="text-lg font-semibold text-gray-900">
                              {objects.find(o => o.id === selectedObject)?.label}
                            </div>
                          </div>
                          <div>
                            <h2 className="text-xl font-semibold text-gray-900">Fields</h2>
                            <p className="text-sm text-gray-500">Managing fields for: {objects.find(o => o.id === selectedObject)?.label}</p>
                          </div>
                        </div>
                        <button onClick={() => setShowCreateField(true)} className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700">+ Create Field</button>
                      </div>
                      <DataTable
                        data={fields}
                        searchKeys={['name', 'label', 'type']}
                        renderHeader={() => (
                          <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Field</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Required</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Section</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Linked To</th>
                          </tr>
                        )}
                        renderRow={(field: Field) => (
                          <tr key={field.id}>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div>
                                <button
                                  onClick={() => handleEditField(field)}
                                  className="text-blue-600 hover:text-blue-800 font-medium text-sm underline"
                                  title="Click to edit field"
                                >
                                  {field.label}
                                </button>
                                <div className="text-sm text-gray-500">{field.name}</div>
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center">
                                <span className="mr-2">{getFieldIcon(field.type)}</span>
                                <span className="text-sm text-gray-900">{field.type}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`px-2 py-1 text-xs rounded-full ${field.is_required ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}`}>{field.is_required ? 'Required' : 'Optional'}</span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{field.section}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {field.type === 'reference' && field.reference_table ? (
                                <span className="text-blue-600 font-medium">{field.reference_table}</span>
                              ) : (
                                '-'
                              )}
                            </td>
                          </tr>
                        )}
                      />

                      {(showCreateField || showEditField) && (
                        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
                          <div className="bg-white rounded-lg p-6 w-96 max-h-[90vh] overflow-y-auto">
                            <div className="flex justify-between items-center mb-4">
                              <h3 className="text-lg font-medium text-gray-900">
                                {showEditField ? 'Edit Field' : 'Create New Field'}
                              </h3>
                              <button
                                onClick={() => {
                                  setShowCreateField(false);
                                  setShowEditField(false);
                                  setEditingField(null);
                                  // Reset form
                                  setNewField({
                                    name: '',
                                    label: '',
                                    type: 'text',
                                    is_required: false,
                                    is_nullable: true,
                                    default_value: '',
                                    section: 'details',
                                    width: 'half' as 'half' | 'full',
                                    is_visible: true,
                                    picklist_values: [],
                                    reference_table: '',
                                    reference_display_field: ''
                                  });
                                }}
                                className="text-gray-400 hover:text-gray-600"
                                title="Close"
                              >
                                ×
                              </button>
                            </div>
                            <div className="space-y-4">
                              {/* Field Details Section */}
                              {showEditField && editingField && (
                                <div className="bg-gray-50 p-4 rounded-md mb-4">
                                  <h4 className="text-sm font-medium text-gray-700 mb-2">Field Details</h4>
                                  <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div><span className="font-medium">ID:</span> <span className="text-gray-600">{editingField.id}</span></div>
                                    <div><span className="font-medium">Object ID:</span> <span className="text-gray-600">{editingField.object_id}</span></div>
                                    <div><span className="font-medium">Display Order:</span> <span className="text-gray-600">{editingField.display_order}</span></div>
                                    <div><span className="font-medium">System Field:</span> <span className="text-gray-600">{editingField.is_system_field ? 'Yes' : 'No'}</span></div>
                                    {editingField.reference_table && (
                                      <div><span className="font-medium">Reference Table:</span> <span className="text-gray-600">{editingField.reference_table}</span></div>
                                    )}
                                    {editingField.reference_display_field && (
                                      <div><span className="font-medium">Display Field:</span> <span className="text-gray-600">{editingField.reference_display_field}</span></div>
                                    )}
                                  </div>
                                </div>
                              )}

                              <div>
                                <label className="block text-sm font-medium text-gray-700">Label</label>
                                <input 
                                  type="text" 
                                  value={newField.label} 
                                  onChange={(e) => setNewField({ ...newField, label: e.target.value })} 
                                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500" 
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700">API Name</label>
                                <input 
                                  type="text" 
                                  value={newField.name} 
                                  onChange={(e) => setNewField({ ...newField, name: e.target.value })} 
                                  className={`mt-1 w-full px-3 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500 ${
                                    showEditField ? 'bg-gray-100 border-gray-300 text-gray-500 cursor-not-allowed' : 'border-gray-300'
                                  }`}
                                  disabled={showEditField}
                                  title={showEditField ? 'API Name cannot be changed after field creation' : ''}
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700">Type</label>
                                <select 
                                  value={newField.type} 
                                  onChange={(e) => setNewField({ ...newField, type: e.target.value })} 
                                  className={`mt-1 w-full px-3 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500 ${
                                    showEditField ? 'bg-gray-100 border-gray-300 text-gray-500 cursor-not-allowed' : 'border-gray-300'
                                  }`}
                                  disabled={showEditField}
                                  title={showEditField ? 'Field type cannot be changed after field creation' : ''}
                                >
                                  {dataTypes.map((type) => (
                                    <option key={type.value} value={type.value}>{type.label}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <label className="block text-sm font-medium text-gray-700">Section</label>
                                  <select value={newField.section} onChange={(e) => setNewField({ ...newField, section: e.target.value })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500">
                                    <option value="details">Details</option>
                                    <option value="additional">Additional</option>
                                    <option value="system">System</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700">Width</label>
                                  <select value={newField.width} onChange={(e) => setNewField({ ...newField, width: e.target.value as 'half' | 'full' })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500">
                                    <option value="half">Half</option>
                                    <option value="full">Full</option>
                                  </select>
                                </div>
                              </div>
                              <div className="flex items-center space-x-4">
                                <div className="flex items-center">
                                  <input type="checkbox" checked={newField.is_required} onChange={(e) => setNewField({ ...newField, is_required: e.target.checked })} className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded" />
                                  <label className="ml-2 text-sm text-gray-700">Required</label>
                                </div>
                                <div className="flex items-center">
                                  <input type="checkbox" checked={newField.is_visible} onChange={(e) => setNewField({ ...newField, is_visible: e.target.checked })} className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded" />
                                  <label className="ml-2 text-sm text-gray-700">Visible</label>
                                </div>
                              </div>

                              {/* Picklist Values Section - Only show for picklist type */}
                              {newField.type === 'picklist' && (
                                <div className="border-t pt-4">
                                  <div className="flex items-center justify-between mb-3">
                                    <label className="block text-sm font-medium text-gray-700">Picklist Values</label>
                                    <button
                                      type="button"
                                      onClick={addPicklistValue}
                                      className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                                    >
                                      + Add Value
                                    </button>
                                  </div>
                                  
                                  {newField.picklist_values.length === 0 ? (
                                    <div className="text-sm text-gray-500 italic">No picklist values added yet. Click "Add Value" to get started.</div>
                                  ) : (
                                    <div className="space-y-2 max-h-40 overflow-y-auto">
                                      {newField.picklist_values.map((picklistValue, index) => (
                                        <div key={index} className="flex items-center space-x-2 p-2 bg-gray-50 rounded">
                                          <div className="flex-1">
                                            <input
                                              type="text"
                                              placeholder="Value"
                                              value={picklistValue.value}
                                              onChange={(e) => updatePicklistValue(index, 'value', e.target.value)}
                                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500"
                                            />
                                          </div>
                                          <div className="flex-1">
                                            <input
                                              type="text"
                                              placeholder="Label"
                                              value={picklistValue.label}
                                              onChange={(e) => updatePicklistValue(index, 'label', e.target.value)}
                                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500"
                                            />
                                          </div>
                                          <button
                                            type="button"
                                            onClick={() => removePicklistValue(index)}
                                            className="text-red-600 hover:text-red-800 p-1"
                                          >
                                            ×
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Reference Configuration Section - Only show for reference type */}
                              {newField.type === 'reference' && (
                                <div className="border-t pt-4">
                                  <label className="block text-sm font-medium text-gray-700 mb-3">Reference Configuration</label>
                                  
                                  <div className="space-y-3">
                                    <div>
                                      <label className="block text-xs font-medium text-gray-600 mb-1">Reference Object</label>
                                      <select 
                                        value={newField.reference_table} 
                                        onChange={(e) => {
                                          const selectedObject = availableObjects.find(obj => obj.name === e.target.value);
                                          setNewField({ 
                                            ...newField, 
                                            reference_table: e.target.value,
                                            reference_display_field: '' // Reset display field when object changes
                                          });
                                          if (selectedObject) {
                                            loadReferenceFields(selectedObject.id);
                                          }
                                        }}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                                        disabled={loadingReferenceData}
                                      >
                                        <option value="">Select an object...</option>
                                        {availableObjects.map((obj) => (
                                          <option key={obj.id} value={obj.name}>
                                            {obj.label}
                                          </option>
                                        ))}
                                      </select>
                                      {loadingReferenceData && (
                                        <div className="text-xs text-gray-500 mt-1">Loading objects...</div>
                                      )}
                                    </div>

                                    <div>
                                      <label className="block text-xs font-medium text-gray-600 mb-1">Display Field</label>
                                      <select 
                                        value={newField.reference_display_field} 
                                        onChange={(e) => setNewField({ ...newField, reference_display_field: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                                        disabled={!newField.reference_table || loadingReferenceData}
                                      >
                                        <option value="">Select a display field...</option>
                                        {referenceFields.map((field) => (
                                          <option key={field.name} value={field.name}>
                                            {field.label}
                                          </option>
                                        ))}
                                      </select>
                                      {loadingReferenceData && (
                                        <div className="text-xs text-gray-500 mt-1">Loading fields...</div>
                                      )}
                                    </div>

                                    {newField.reference_table && (
                                      <div className="text-xs text-green-600 bg-green-50 p-2 rounded">
                                        ✅ This field will reference {newField.reference_table} records
                                        {newField.reference_display_field && ` and display the "${newField.reference_display_field}" field`}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                            {!showEditField && (
                              <div className="mt-6 flex justify-end space-x-3">
                                <button onClick={() => setShowCreateField(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200">Cancel</button>
                                <button onClick={handleCreateField} disabled={creatingField} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50">{creatingField ? 'Creating...' : 'Create Field'}</button>
                              </div>
                            )}
                            {showEditField && (
                              <div className="mt-6 flex justify-end space-x-3">
                                <button onClick={() => {
                                  setShowEditField(false);
                                  setEditingField(null);
                                  // Reset form
                                  setNewField({
                                    name: '',
                                    label: '',
                                    type: 'text',
                                    is_required: false,
                                    is_nullable: true,
                                    default_value: '',
                                    section: 'details',
                                    width: 'half' as 'half' | 'full',
                                    is_visible: true,
                                    picklist_values: [],
                                    reference_table: '',
                                    reference_display_field: ''
                                  });
                                }} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200">Cancel</button>
                                <button onClick={handleUpdateField} disabled={updatingField} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50">{updatingField ? 'Updating...' : 'Save Changes'}</button>
                              </div>
                            )}
                          </div>
                        </div>
                      )}


                    </div>
                  )}



                  {selectedSection === 'layout' && (
                    <div>
                      <DndProvider backend={HTML5Backend}>
                        <ObjectLayoutEditor
                          selectedObject={selectedObject}
                          fieldMetadata={convertFieldsToMetadata(fields)}
                          relatedLists={relatedLists}
                          buttons={buttons}
                          onLayoutChange={handleLayoutChange}
                          getFieldIcon={getFieldIcon}
                          handleEditField={(fieldMetadata) => {
                            // Find the original field and open edit modal
                            const originalField = fields.find(f => f.id === fieldMetadata.id);
                            if (originalField) {
                              handleEditField(originalField);
                            }
                          }}
                          isSystemField={isSystemField}
                          onEditRelatedList={() => {}}
                          onDeleteRelatedList={() => {}}
                          onAddRelatedList={() => {}}
                          tenantId={tenant?.id || ''}
                        />
                      </DndProvider>
                    </div>
                  )}

                  {selectedSection === 'buttons' && (
                    <div>
                      <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-semibold text-gray-900">Buttons</h2>
                        <button
                          onClick={() => {
                            console.log('🔘 ObjectManagerTab: Create Button clicked');
                            console.log('🔘 ObjectManagerTab: Current selectedObject:', selectedObject);
                            console.log('🔘 ObjectManagerTab: Current showCreateButton state:', showCreateButton);
                            setShowCreateButton(true);
                            console.log('🔘 ObjectManagerTab: setShowCreateButton(true) called');
                          }}
                          className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
                        >
                          + Create Button
                        </button>
                      </div>

                      {/* Buttons List */}
                      <div className="bg-white rounded-lg border border-gray-200">
                        {buttons.length === 0 ? (
                          <div className="p-6 text-center text-gray-500">
                            <p>No buttons created yet.</p>
                            <p className="text-sm mt-1">Create your first button to get started.</p>
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Label</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Style</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                                </tr>
                              </thead>
                              <tbody className="bg-white divide-y divide-gray-200">
                                {buttons.map((button) => (
                                  <tr key={button.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                      {button.name}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                      {button.label || button.name}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                        button.button_type === 'object' 
                                          ? 'bg-blue-100 text-blue-800' 
                                          : 'bg-purple-100 text-purple-800'
                                      }`}>
                                        {button.button_type}
                                      </span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                      <span className="text-xs font-mono">
                                        {button.action_type || 'api_call'}
                                      </span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                        button.button_style === 'primary' ? 'bg-blue-100 text-blue-800' :
                                        button.button_style === 'secondary' ? 'bg-gray-100 text-gray-800' :
                                        button.button_style === 'success' ? 'bg-green-100 text-green-800' :
                                        button.button_style === 'danger' ? 'bg-red-100 text-red-800' :
                                        button.button_style === 'warning' ? 'bg-yellow-100 text-yellow-800' :
                                        'bg-gray-100 text-gray-800'
                                      }`}>
                                        {button.button_style || 'primary'}
                                      </span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                        button.is_active 
                                          ? 'bg-green-100 text-green-800' 
                                          : 'bg-red-100 text-red-800'
                                      }`}>
                                        {button.is_active ? 'Active' : 'Inactive'}
                                      </span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                      <button
                                        onClick={() => handleDeleteButton(button.id)}
                                        className="text-red-600 hover:text-red-900"
                                      >
                                        Delete
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/*{selectedSection === 'layout' && (
                    <div>
                      {/*<div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-semibold text-gray-900">Page Layout</h2>
                        <button
                          onClick={() => setShowCreateRelatedList(true)}
                          className="bg-green-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-green-700"
                        >
                          + Create Related List
                        </button>
                      </div>
                      <ObjectLayoutEditor
                        selectedObject={selectedObject}
                        fieldMetadata={convertFieldsToMetadata(fields)}
                        relatedLists={relatedLists}
                        onLayoutChange={handleLayoutChange}
                        getFieldIcon={getFieldIcon}
                        handleEditField={(fieldMetadata) => {
                          // Find the original field and open edit modal
                          const originalField = fields.find(f => f.id === fieldMetadata.id);
                          if (originalField) {
                            handleEditField(originalField);
                          }
                        }}
                        isSystemField={isSystemField}
                        onEditRelatedList={() => {}}
                        onDeleteRelatedList={() => {}}
                        onAddRelatedList={() => {}}
                        tenantId={tenant?.id || ''}
                      />
                    </div>
                  )}*/}

                  {selectedSection === 'validation' && (
                    <div>
                      <h2 className="text-xl font-semibold text-gray-900 mb-4">Validation Rules</h2>
                      <div className="bg-gray-50 rounded-lg p-6">
                        <p className="text-gray-600">Validation rules will be implemented here.</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Button Modal */}
      {(() => {
        console.log('🔘 ObjectManagerTab: Modal render check - showCreateButton:', showCreateButton);
        return null;
      })()}
      {showCreateButton && (
        (() => { 
          console.log('🔘 ObjectManagerTab: Modal is being rendered!'); 
          return null; 
        })(),
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900">Create New Button</h3>
              <button
                onClick={() => {
                  setShowCreateButton(false);
                  setNewButton({ 
                    name: '', 
                    api_name: '', 
                    button_type: 'object', 
                    is_active: true,
                    label: '',
                    custom_component_path: '',
                    custom_route: '',
                    action_type: 'api_call',
                    action_config: {},
                    button_style: 'primary',
                    button_size: 'md',
                    display_order: 0
                  });
                }}
                className="text-gray-400 hover:text-gray-600"
                title="Close"
              >
                ×
              </button>
            </div>
            <div className="space-y-4">
              {/* Basic Information */}
              <div>
                <label className="block text-sm font-medium text-gray-700">Button Name</label>
                <input 
                  type="text" 
                  value={newButton.name} 
                  onChange={(e) => setNewButton({ ...newButton, name: e.target.value })} 
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500" 
                  placeholder="e.g., Generate Certificate"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700">Display Label</label>
                <input 
                  type="text" 
                  value={newButton.label} 
                  onChange={(e) => setNewButton({ ...newButton, label: e.target.value })} 
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500" 
                  placeholder="e.g., Generate Certificate"
                />
              </div>



              <div>
                <label className="block text-sm font-medium text-gray-700">API Name</label>
                <input 
                  type="text" 
                  value={newButton.api_name} 
                  onChange={(e) => setNewButton({ ...newButton, api_name: e.target.value })} 
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500" 
                  placeholder="e.g., generate_certificate"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Button Type</label>
                <select 
                  value={newButton.button_type} 
                  onChange={(e) => setNewButton({ ...newButton, button_type: e.target.value as 'object' | 'custom' })} 
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="object">Object Button</option>
                  <option value="custom">Custom Button</option>
                </select>
              </div>

              {/* Custom Button Fields */}
              {newButton.button_type === 'custom' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Custom Component Path</label>
                    <input 
                      type="text" 
                      value={newButton.custom_component_path} 
                      onChange={(e) => setNewButton({ ...newButton, custom_component_path: e.target.value })} 
                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500" 
                      placeholder="e.g., CustomButtonTab"
                    />
                    <p className="mt-1 text-sm text-gray-500">Component name that matches the registry in CustomTabRenderer</p>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Custom Route</label>
                    <input 
                      type="text" 
                      value={newButton.custom_route} 
                      onChange={(e) => setNewButton({ ...newButton, custom_route: e.target.value })} 
                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500" 
                      placeholder="e.g., /custom-button"
                    />
                  </div>
                </>
              )}

              {/* Action Configuration */}
              <div>
                <label className="block text-sm font-medium text-gray-700">Action Type</label>
                <select 
                  value={newButton.action_type} 
                  onChange={(e) => setNewButton({ ...newButton, action_type: e.target.value as 'api_call' | 'component' | 'route' })} 
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="api_call">API Call</option>
                  <option value="component">Component</option>
                  <option value="route">Route</option>
                </select>
              </div>

              {/* Button Styling */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Button Style</label>
                  <select 
                    value={newButton.button_style} 
                    onChange={(e) => setNewButton({ ...newButton, button_style: e.target.value as 'primary' | 'secondary' | 'success' | 'danger' | 'warning' })} 
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="primary">Primary</option>
                    <option value="secondary">Secondary</option>
                    <option value="success">Success</option>
                    <option value="danger">Danger</option>
                    <option value="warning">Warning</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700">Button Size</label>
                  <select 
                    value={newButton.button_size} 
                    onChange={(e) => setNewButton({ ...newButton, button_size: e.target.value as 'sm' | 'md' | 'lg' })} 
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="sm">Small</option>
                    <option value="md">Medium</option>
                    <option value="lg">Large</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Display Order</label>
                <input 
                  type="number" 
                  value={newButton.display_order} 
                  onChange={(e) => setNewButton({ ...newButton, display_order: parseInt(e.target.value) || 0 })} 
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500" 
                  placeholder="0"
                />
              </div>

              <div className="flex items-center">
                <input 
                  type="checkbox" 
                  id="is_active" 
                  checked={newButton.is_active} 
                  onChange={(e) => setNewButton({ ...newButton, is_active: e.target.checked })} 
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="is_active" className="ml-2 block text-sm text-gray-900">
                  Active
                </label>
              </div>
              <div className="mt-6 flex justify-end space-x-3">
                <button 
                  onClick={() => {
                    setShowCreateButton(false);
                    setNewButton({ 
                      name: '', 
                      api_name: '', 
                      button_type: 'object', 
                      is_active: true,
                      label: '',
                      custom_component_path: '',
                      custom_route: '',
                      action_type: 'api_call',
                      action_config: {},
                      button_style: 'primary',
                      button_size: 'md',
                      display_order: 0
                    });
                  }} 
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    console.log('🔘 ObjectManagerTab: Modal Create Button clicked');
                    console.log('🔘 ObjectManagerTab: creatingButton state:', creatingButton);
                    handleCreateButton();
                  }} 
                  disabled={creatingButton} 
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {creatingButton ? 'Creating...' : 'Create Button'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 