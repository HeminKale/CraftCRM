'use client';

import React, { useState, useEffect } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import DataTable from '../DataTable';
import RecordDetailView from './RecordDetailView';
import RecordForm from './RecordForm';
import { useSupabase } from '../../providers/SupabaseProvider';
import RecordListDropdown from './RecordList/RecordListDropdown';
import { RecordListService } from './RecordList/RecordListService';
import { RecordList, FilterCriteria, FilterFieldInfo } from './RecordList/types';
import { FilterBuilder } from './RecordList/FilterBuilder';
import { UniversalFieldDisplay, formatColumnLabel } from '../ui/UniversalFieldDisplay';
import CustomTabRenderer from './CustomTabRenderer';
import * as XLSX from 'xlsx';
import { draftToClientService } from '../../services/DraftToClientService';

interface TabContentProps {
  tabId: string;
  tabType: string;
  objectId?: string;
  tabLabel: string;
  customComponentPath?: string;
  customRoute?: string;
  childRecordParams?: {
    objectId?: string;
    recordId?: string;
    objectLabel?: string;
    fromRelatedList?: string;
  } | null;
  onChildRecordProcessed?: () => void;
}

interface ObjectRecord {
  record_id: string;
  record_data: any; // JSONB data from the database
}

interface GroupedRecord {
  record_id: string;
  fields: { [key: string]: any };
  created_at: string;
  updated_at: string;
}

// NEW: Interface for page layout blocks
interface LayoutBlock {
  id: string;
  block_type: 'field' | 'section' | 'related_list';
  label: string;
  field_id?: string;
  section?: string;
  display_order: number;
  tenant_id: string;
}

// NEW: Interface for field metadata
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

export default function TabContent({
  tabId,
  tabType,
  objectId,
  tabLabel,
  customComponentPath,
  customRoute,
  childRecordParams,
  onChildRecordProcessed
}: TabContentProps) {
  const [records, setRecords] = useState<GroupedRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewRecordForm, setShowNewRecordForm] = useState(false);
 
  // NEW: State for new record modal and page layout
  const [pageLayout, setPageLayout] = useState<LayoutBlock[]>([]);
  const [fieldMetadata, setFieldMetadata] = useState<FieldMetadata[]>([]);
  const [layoutLoading, setLayoutLoading] = useState(false);
  const [layoutError, setLayoutError] = useState<string | null>(null);
 
  // NEW: State for record list dropdown
  const [showRecordListDropdown, setShowRecordListDropdown] = useState(false);
 
  // NEW: State for modals
  const [showCreateRecordListModal, setShowCreateRecordListModal] = useState(false);
  const [showFieldsToDisplayModal, setShowFieldsToDisplayModal] = useState(false);
  const [showButtonsToDisplayModal, setShowButtonsToDisplayModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [selectedFieldsForExport, setSelectedFieldsForExport] = useState<string[]>([]);

 
  // NEW: State for record list functionality
  const [selectedRecordList, setSelectedRecordList] = useState<RecordList | null>(null);
  const [recordLists, setRecordLists] = useState<RecordList[]>([]);
 
  // NEW: State for Create Record List modal form
  const [recordListForm, setRecordListForm] = useState({
    name: '',
    description: '',
    filterCriteria: [] as any[], // ✅ Array for structured filters
    selectedFields: [] as string[]
  });

  // NEW: State for available fields for filtering
  const [availableFields, setAvailableFields] = useState<FilterFieldInfo[]>([]);

  // NEW: State for buttons to display functionality
  const [availableButtons, setAvailableButtons] = useState<any[]>([]);
  const [selectedButtons, setSelectedButtons] = useState<string[]>([]);
  const [buttonsLoading, setButtonsLoading] = useState(false);

  // NEW: State for fields to display functionality
  const [availableFieldsForDisplay, setAvailableFieldsForDisplay] = useState<string[]>([]);
  const [selectedFieldsForDisplay, setSelectedFieldsForDisplay] = useState<string[]>([]);
  const [fieldsDisplayLoading, setFieldsDisplayLoading] = useState(false);

  // NEW: State for custom component props
  const [customComponentProps, setCustomComponentProps] = useState<any>(null);

  // NEW: State for direct bulk operation modal
  const [showBulkOperationModal, setShowBulkOperationModal] = useState(false);
  const [bulkOperationData, setBulkOperationData] = useState<any>(null);

  // NEW: State for record selection functionality
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([]);
  
  // NEW: State for table display options
  const [columnWidths, setColumnWidths] = useState<{ [key: string]: string }>({});
 
  // NEW: Navigation state for record detail view
  const [viewMode, setViewMode] = useState<'list' | 'detail'>('list');
  const [selectedRecord, setSelectedRecord] = useState<{
    recordId: string;
    recordName: string;
    objectId: string;
    objectLabel: string;
  } | null>(null);
 
 
  const { tenant, user } = useSupabase();
  const supabase = createClientComponentClient();





  // NEW: Reset to list view whenever tab changes
  useEffect(() => {



    console.log('�� New tabId:', tabId);

   
    setViewMode('list');
    setSelectedRecord(null);
   

  }, [tabId]);

  // NEW: Handle child record navigation from related lists
  useEffect(() => {
    if (childRecordParams && childRecordParams.objectId && childRecordParams.recordId && childRecordParams.objectLabel) {
      console.log('🔗 Handling child record navigation:', childRecordParams);
      
      // Check if this tab contains the child object
      if (objectId === childRecordParams.objectId) {
        console.log('🔗 This tab contains the child object, navigating to record');
        
        // Set the selected record to navigate to the child record detail view
        setSelectedRecord({
          recordId: childRecordParams.recordId,
          recordName: childRecordParams.objectLabel, // Use object label as record name for now
          objectId: childRecordParams.objectId,
          objectLabel: childRecordParams.objectLabel
        });
        
        // Switch to detail view
        setViewMode('detail');
        
        // Clear the child record parameters to avoid re-triggering
        if (onChildRecordProcessed) {
          onChildRecordProcessed();
        }
      } else {
        console.log('🔗 This tab does not contain the child object, ignoring navigation');
      }
    }
  }, [childRecordParams, objectId]);

  // NEW: Load button preferences, available buttons, and fields when component mounts or objectId changes
  useEffect(() => {
    if (objectId && tenant?.id) {
      // Fetch buttons, preferences, and fields in parallel
      Promise.all([
        fetchObjectButtons(),
        fetchButtonPreferences(),
        fetchAvailableFieldsForDisplay()
      ]);
    }
  }, [objectId, tenant?.id]);

  // NEW: Debug logging for field display state changes
  useEffect(() => {
    console.log('🔍 === FIELD DISPLAY STATE CHANGED ===');
    console.log('🔍 availableFieldsForDisplay updated:', availableFieldsForDisplay);
    console.log('🔍 availableFieldsForDisplay length:', availableFieldsForDisplay.length);
    console.log('🔍 selectedFieldsForDisplay updated:', selectedFieldsForDisplay);
    console.log('🔍 selectedFieldsForDisplay length:', selectedFieldsForDisplay.length);
  }, [availableFieldsForDisplay, selectedFieldsForDisplay]);

  // NEW: Reset form state when switching tabs
  useEffect(() => {
    // Reset form state when switching tabs



   
    setPageLayout([]);
    setFieldMetadata([]);
    setLayoutLoading(false);
    setLayoutError(null);
    setShowNewRecordForm(false); // Also close any open modal
    setShowRecordListDropdown(false); // Also close dropdown
    setShowCreateRecordListModal(false); // Also close create record list modal
    setShowFieldsToDisplayModal(false); // Also close fields to display modal
    setShowButtonsToDisplayModal(false); // Also close buttons to display modal
   
    // Reset record list state
    setSelectedRecordList(null);
    setRecordLists([]);
   
    // Reset record list form
    setRecordListForm({
      name: '',
      description: '',
      filterCriteria: [] as any[],
      selectedFields: []
    });
   
    console.log('�� ✅ Form state reset complete');
  }, [tabId]);

  // NEW: Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showRecordListDropdown) {
        const target = event.target as Element;
        if (!target.closest('.record-list-dropdown')) {
          setShowRecordListDropdown(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showRecordListDropdown]);

  // NEW: Function to fetch page layout and field metadata
  const fetchPageLayout = async () => {
    if (!objectId || !tenant?.id) {
      console.error('❌ Missing objectId or tenant.id for fetchPageLayout');
      return;
    }

    try {
      setLayoutLoading(true);
      setLayoutError(null);



      // Fetch layout blocks for the object using RPC function
      const { data: layoutData, error: layoutError } = await supabase
        .rpc('get_object_page_layout', {
          p_object_id: objectId,
          p_tenant_id: tenant.id
        });

      if (layoutError) {
        console.error('❌ Error fetching layout blocks:', layoutError);
        setLayoutError(layoutError.message);
        return;
      }

      if (layoutData) {




        setPageLayout(layoutData);

        // Fetch ALL field metadata for the object (not just layout fields)
        // This ensures UniversalFieldDisplay has complete metadata for all fields






        const { data: fieldData, error: fieldError } = await supabase
          .rpc('get_tenant_fields', {
            p_object_id: objectId,
            p_tenant_id: tenant.id
          });

        if (fieldError) {
          console.error('❌ Error fetching field metadata:', fieldError);
          setLayoutError(fieldError.message);
          return;
        }

        if (fieldData) {
          console.log('🔍 Fetched ALL field metadata:', fieldData.length, 'fields');
          
          // Log reference field details
          const referenceFields = fieldData.filter(f => f.type === 'reference');
          if (referenceFields.length > 0) {
            console.log('🔍 Reference fields found:', referenceFields.length);
            referenceFields.forEach(field => {
              console.log(`🔍 Reference field: ${field.name} -> ${field.reference_table} (display: ${field.reference_display_field})`);
            });
          } else {
            console.log('🔍 No reference fields found');
          }
          
          setFieldMetadata(fieldData);
        }
      }
    } catch (err) {
      console.error('❌ Error in fetchPageLayout:', err);
      setLayoutError('Failed to fetch page layout');
    } finally {
      setLayoutLoading(false);
    }
  };

  // NEW: Handle New button click
  const handleNewRecordClick = async () => {
    console.log('�� === NEW RECORD BUTTON CLICKED ===');
    console.log('🔍 Object ID:', objectId);
    console.log('🔍 Tab Label:', tabLabel);
   
    if (!objectId || !tenant?.id) {
      console.error('❌ Cannot open new record form: missing objectId or tenant');
      return;
    }

    // Fetch page layout if not already loaded
    if (pageLayout.length === 0) {

      await fetchPageLayout();
    }

    // Open the modal
    setShowNewRecordForm(true);

  };

  // NEW: Handle Record List icon click
  const handleRecordListClick = () => {
    console.log('�� === RECORD LIST ICON CLICKED ===');
    console.log('🔍 Object ID:', objectId);
    console.log('🔍 Tab Label:', tabLabel);
   
    // Toggle dropdown visibility
    setShowRecordListDropdown(prev => !prev);
  };

  // NEW: Handle Create Record List option
  const handleCreateRecordList = () => {
    console.log('🔍 === CREATE RECORD LIST CLICKED ===');
    console.log('🔍 Object ID:', objectId);
    console.log('🔍 Tab Label:', tabLabel);
   
    // Show create record list modal
    setShowCreateRecordListModal(true);
   
    // Close dropdown after action
    setShowRecordListDropdown(false);
  };

  // NEW: Handle Select Fields to Display option
  const handleSelectFieldsToDisplay = async () => {
    console.log('🔍 === SELECT FIELDS TO DISPLAY CLICKED ===');
    console.log('🔍 Object ID:', objectId);
    console.log('🔍 Tab Label:', tabLabel);
    console.log('🔍 Records available:', records.length);
    console.log('🔍 First record sample:', records[0]);
   
    // Use existing field names as fallback if RPC fails
    const existingFieldNames = getFieldNames();
    console.log('🔍 Existing field names from getFieldNames():', existingFieldNames);
    console.log('🔍 Field names count:', existingFieldNames.length);
    
    // Set available fields immediately as fallback
    setAvailableFieldsForDisplay(existingFieldNames);
    console.log('🔍 Set availableFieldsForDisplay to:', existingFieldNames);
    console.log('🔍 State update called for availableFieldsForDisplay');
    
    // Set default selected fields - include more fields by default
    const defaultSelected = existingFieldNames.filter((fieldName: string) => 
      fieldName === 'name' || 
      fieldName === 'created_at' || 
      fieldName === 'updated_at' ||
      fieldName === 'is_active' ||
      fieldName === 'type__a' ||
      fieldName === 'scope__a' ||
      fieldName === 'Client_name' ||
      fieldName === 'Client_name__a' ||
      fieldName === 'isoStandard__a' ||
      fieldName === 'initialRegistrationDate__a'
    );
    console.log('🔍 Default selected fields:', defaultSelected);
    console.log('🔍 Default selected count:', defaultSelected.length);
    setSelectedFieldsForDisplay(defaultSelected);
    console.log('🔍 State update called for selectedFieldsForDisplay');
    
    // Try to fetch additional field info from RPC (optional)
    await fetchAvailableFieldsForDisplay();
    
    // Show fields to display modal
    setShowFieldsToDisplayModal(true);
    console.log('🔍 Modal should now be visible');
   
    // Close dropdown after action
    setShowRecordListDropdown(false);
  };

  // NEW: Fetch buttons from object's page layout
  const fetchObjectButtons = async () => {
    if (!objectId || !tenant?.id) {
      console.error('❌ Cannot fetch buttons: missing objectId or tenant');
      return;
    }

    try {
      setButtonsLoading(true);
      console.log('🔍 Fetching buttons for object:', objectId);

      const { data: buttonsData, error: buttonsError } = await supabase
        .rpc('get_object_buttons', {
          p_object_id: objectId,
          p_tenant_id: tenant.id
        });

      if (buttonsError) {
        console.error('❌ Error fetching buttons:', buttonsError);
        setAvailableButtons([]);
        return;
      }

      console.log('🔍 Buttons fetched:', buttonsData);
      setAvailableButtons(buttonsData || []);
    } catch (error) {
      console.error('❌ Error fetching buttons:', error);
      setAvailableButtons([]);
    } finally {
      setButtonsLoading(false);
    }
  };

  // NEW: Fetch available fields for display
  const fetchAvailableFieldsForDisplay = async () => {
    try {
      setFieldsDisplayLoading(true);
      console.log('🔍 Fetching available fields using getFieldNames()...');
      
      // Use getFieldNames() which correctly extracts fields from record.fields
      const fieldNames = getFieldNames();
      console.log('🔍 Using field names from getFieldNames():', fieldNames);
      
      if (fieldNames && fieldNames.length > 0) {
        setAvailableFieldsForDisplay(fieldNames);
        
        // Set default selected fields - include more fields by default
        const defaultSelected = fieldNames.filter((fieldName: string) => 
          fieldName === 'name' || 
          fieldName === 'created_at' || 
          fieldName === 'updated_at' ||
          fieldName === 'is_active' ||
          fieldName === 'type__a' ||
          fieldName === 'scope__a' ||
          fieldName === 'Client_name' ||
          fieldName === 'Client_name__a' ||
          fieldName === 'isoStandard__a' ||
          fieldName === 'initialRegistrationDate__a'
        );
        setSelectedFieldsForDisplay(defaultSelected);
        console.log('✅ Set available fields:', fieldNames);
        console.log('✅ Set default selected:', defaultSelected);
      } else {
        setAvailableFieldsForDisplay([]);
        console.log('⚠️ No field names available from getFieldNames()');
      }
    } catch (error) {
      console.error('❌ Error fetching fields:', error);
      setAvailableFieldsForDisplay([]);
    } finally {
      setFieldsDisplayLoading(false);
    }
  };

  // NEW: Fetch button preferences from database
  const fetchButtonPreferences = async () => {
    if (!objectId || !tenant?.id) {
      console.error('❌ Cannot fetch button preferences: missing objectId or tenant');
      return;
    }

    try {
      console.log('🔍 Fetching button preferences for object:', objectId);

      const { data: preferencesData, error: preferencesError } = await supabase
        .rpc('get_button_preferences', {
          p_object_id: objectId,
          p_tenant_id: tenant.id
        });

      if (preferencesError) {
        console.error('❌ Error fetching button preferences:', preferencesError);
        setSelectedButtons([]);
        return;
      }

      console.log('🔍 Button preferences fetched:', preferencesData);
      
      // Extract selected button IDs
      const selectedIds = preferencesData
        ?.filter((pref: any) => pref.is_selected)
        ?.map((pref: any) => pref.button_id) || [];
      
      setSelectedButtons(selectedIds);
    } catch (error) {
      console.error('❌ Error fetching button preferences:', error);
      setSelectedButtons([]);
    }
  };

  // NEW: Handle Buttons to Display option
  const handleButtonsToDisplay = async () => {
    console.log('🔍 === BUTTONS TO DISPLAY CLICKED ===');
    console.log('🔍 Object ID:', objectId);
    console.log('🔍 Tab Label:', tabLabel);
   
    // Fetch buttons and preferences before showing modal
    await Promise.all([
      fetchObjectButtons(),
      fetchButtonPreferences()
    ]);
    
    // Show buttons to display modal
    setShowButtonsToDisplayModal(true);
   
    // Close dropdown after action
    setShowRecordListDropdown(false);
  };

  // NEW: Handle button selection
  const handleButtonSelection = (buttonId: string, isChecked: boolean) => {
    setSelectedButtons(prev => {
      if (isChecked) {
        return [...prev, buttonId];
      } else {
        return prev.filter(id => id !== buttonId);
      }
    });
  };

  // NEW: Handle field selection for display
  const handleFieldSelectionForDisplay = (fieldName: string, isSelected: boolean) => {
    setSelectedFieldsForDisplay(prev => {
      if (isSelected) {
        return [...prev, fieldName];
      } else {
        return prev.filter(name => name !== fieldName);
      }
    });
  };

  // NEW: Handle save field display preferences
  const handleSaveFieldDisplayPreferences = async () => {
    console.log('🔍 Saving field display preferences:', selectedFieldsForDisplay);
    
    try {
      // TODO: Implement database save functionality
      // For now, just close the modal
      setShowFieldsToDisplayModal(false);
      
      // Show success message
      console.log('✅ Field display preferences saved successfully');
    } catch (error) {
      console.error('❌ Error saving field display preferences:', error);
    }
  };

  // NEW: Handle select all fields
  const handleSelectAllFields = () => {
    setSelectedFieldsForDisplay([...availableFieldsForDisplay]);
  };

  // NEW: Handle select none fields
  const handleSelectNoneFields = () => {
    setSelectedFieldsForDisplay(['name']); // Keep only required field
  };

  // NEW: Handle save selected buttons
  const handleSaveSelectedButtons = async () => {
    if (!objectId || !tenant?.id) {
      console.error('❌ Cannot save button preferences: missing objectId or tenant');
      return;
    }

    try {
      console.log('🔍 Saving selected buttons:', selectedButtons);

      const { data, error } = await supabase
        .rpc('save_button_preferences', {
          p_object_id: objectId,
          p_tenant_id: tenant.id,
          p_selected_button_ids: selectedButtons
        });

      if (error) {
        console.error('❌ Error saving button preferences:', error);
        // You might want to show an error message to the user here
        return;
      }

      console.log('✅ Button preferences saved successfully:', data);
      
      // Close the modal
      setShowButtonsToDisplayModal(false);
      
      // Optionally show a success message
      // You could add a toast notification here
      
    } catch (error) {
      console.error('❌ Error saving button preferences:', error);
      // You might want to show an error message to the user here
    }
  };

  // NEW: Handle clear all button preferences
  const handleClearButtonPreferences = async () => {
    if (!objectId || !tenant?.id) {
      console.error('❌ Cannot clear button preferences: missing objectId or tenant');
      return;
    }

    try {
      console.log('🔍 Clearing all button preferences');

      const { error } = await supabase
        .rpc('clear_button_preferences', {
          p_object_id: objectId,
          p_tenant_id: tenant.id
        });

      if (error) {
        console.error('❌ Error clearing button preferences:', error);
        return;
      }

      console.log('✅ Button preferences cleared successfully');
      
      // Update local state
      setSelectedButtons([]);
      
    } catch (error) {
      console.error('❌ Error clearing button preferences:', error);
    }
  };

  // NEW: Handle record selection changes
  const handleRecordSelectionChange = (selectedIds: string[]) => {
    setSelectedRecordIds(selectedIds);
    console.log('🔍 Selected record IDs:', selectedIds);
  };

  // NEW: Handle column width changes
  const handleColumnWidthChange = (columnKey: string, width: string) => {
    setColumnWidths(prev => ({
      ...prev,
      [columnKey]: width
    }));
  };

  // NEW: Handle column resizing with mouse drag
  const handleColumnResize = (e: React.MouseEvent, fieldName: string) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = parseInt(columnWidths[fieldName]?.replace('px', '') || '200');
    
    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = startWidth + (e.clientX - startX);
      const clampedWidth = Math.max(100, Math.min(500, newWidth));
      handleColumnWidthChange(fieldName, `${clampedWidth}px`);
    };
    
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // NEW: Handle draft approval using the service
  const handleDraftApproval = async (recordId: string) => {
    if (!tenant?.id) {
      console.error('❌ No tenant ID available');
      return;
    }

    try {
      const result = await draftToClientService.handleDraftApproval(
        recordId,
        tenant.id,
        user?.id
      );

      if (result.success) {
        alert(result.message);
        // Refresh the records to show updated data
        await fetchObjectRecords();
      } else {
        console.error('❌ Draft approval failed:', result.message);
        if (result.error) {
          console.error('❌ Error details:', result.error);
        }
      }
    } catch (error) {
      console.error('❌ Error handling draft approval:', error);
    }
  };

  // DEBUG: Log DataTable props (moved to renderObjectTab function)





  // NEW: Fetch record lists for the current object
  const fetchRecordLists = async () => {
    if (!objectId || !tenant?.id) return;
   
    try {
      const data = await RecordListService.getRecordLists(objectId, tenant.id);
      setRecordLists(data);
      console.log('🔍 Record lists fetched:', data);
    } catch (error) {
      console.error('Error fetching record lists:', error);
    }
  };

  // CRITICAL FIX: Load field metadata immediately when component mounts
  useEffect(() => {
    if (objectId && tenant?.id) {
      console.log('🔍 COMPONENT MOUNTED - Loading field metadata for:', { objectId, tenantId: tenant?.id });
      fetchPageLayout();
    }
  }, [objectId, tenant?.id]);

  // DEBUG: Log field metadata when it changes
  useEffect(() => {
    if (fieldMetadata.length > 0) {
      console.log('🔍 FIELD METADATA LOADED:', fieldMetadata.length, 'fields');
      const referenceFields = fieldMetadata.filter(f => f.type === 'reference');
      if (referenceFields.length > 0) {
        console.log('🔍 REFERENCE FIELDS FOUND:', referenceFields.map(f => ({
          name: f.name,
          reference_table: f.reference_table,
          reference_display_field: f.reference_display_field
        })));
      }
    }
  }, [fieldMetadata]);



  // NEW: Get available fields for filtering from the same source as field selection
  const getAvailableFieldsForFiltering = (): FilterFieldInfo[] => {
    // Use the same getFieldNames() function that the field selection uses
    const fieldNames = getFieldNames();
   
    console.log('🔍 Converting field names to FilterFieldInfo:', fieldNames);
   
    // Convert field names to FilterFieldInfo format
    const filterFields: FilterFieldInfo[] = fieldNames.map((fieldName, index) => {
      // Determine field type based on field name patterns
      let fieldType: 'text' | 'number' | 'date' | 'boolean' = 'text';
     
      if (fieldName.includes('date') || fieldName.includes('created') || fieldName.includes('updated')) {
        fieldType = 'date';
      } else if (fieldName.includes('id') || fieldName.includes('count') || fieldName.includes('amount') ||
                 fieldName.includes('price') || fieldName.includes('budget') || fieldName.includes('number')) {
        fieldType = 'number';
      } else if (fieldName.includes('is_') || fieldName.includes('has_') || fieldName.includes('active')) {
        fieldType = 'boolean';
      }
     
      return {
        field_name: fieldName,
        field_type: fieldType,
        display_name: fieldName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        is_filterable: true
      };
    });
   
    console.log('✅ Converted filter fields:', filterFields);
    return filterFields;
  };

  // NEW: Update available fields when records change
  useEffect(() => {
    if (records.length > 0) {
      const filterFields = getAvailableFieldsForFiltering();
      setAvailableFields(filterFields);
      console.log('✅ Available fields updated from records:', filterFields);
    }
  }, [records]);

  // NEW: Handle record list selection
  const handleRecordListSelect = (recordList: RecordList | null) => {
    setSelectedRecordList(recordList);
    console.log('🔍 Record list selected:', recordList);
    console.log('�� Record list filter_criteria:', recordList?.filter_criteria);
    console.log('🔍 Record list selected_fields:', recordList?.selected_fields);
   
    if (recordList) {
      // Check if record list has filters
      if (recordList.filter_criteria && recordList.filter_criteria.length > 0) {
        // Apply the record list filters and fetch filtered records
        console.log('🔍 Record list has filters, applying filter criteria');
        console.log('🔍 Filter criteria length:', recordList.filter_criteria.length);
        console.log('🔍 Filter criteria details:', JSON.stringify(recordList.filter_criteria, null, 2));
        fetchFilteredRecords(recordList);
      } else {
        // Record list exists but no filters - show all records
        console.log('�� Record list has no filters, showing all records');
        console.log('🔍 This is why you see all records!');
        fetchObjectRecords();
      }
    } else {
      // No record list selected - show all records
      console.log('🔍 No record list selected, showing all records');
      fetchObjectRecords();
    }
  };

  // NEW: Fetch filtered records based on record list using RPC
  const fetchFilteredRecords = async (recordList: RecordList) => {
    if (!objectId || !tenant?.id) return;
   
    try {
      setLoading(true);
      setError(null);
     
      console.log('🔍 Fetching filtered records for record list:', recordList.name);
      console.log('�� Filter criteria:', recordList.filter_criteria);
      console.log('�� Selected fields:', recordList.selected_fields);
     
      // Convert old FilterCriteria to new FilterGroup format for enhanced filtering
      // This handles backward compatibility while enabling new features
      const enhancedFilters: any[] = [];
     
      if (recordList.filter_criteria && recordList.filter_criteria.length > 0) {
        // Handle both legacy FilterCriteria[] and new FilterGroup[] structures
        let allConditions: any[] = [];
       
        // Check if this is the new FilterGroup structure
        if (recordList.filter_criteria[0] && 'conditions' in recordList.filter_criteria[0]) {
          // New structure: FilterGroup[]
          allConditions = recordList.filter_criteria.flatMap((group: any) =>
            group.conditions || []
          );
        } else {
          // Legacy structure: FilterCriteria[]
          allConditions = recordList.filter_criteria;
        }
       
        if (allConditions.length > 0) {
          // Normalize and validate the extracted conditions
          const normalizedConditions = allConditions
            .map((c: any, i: number) => ({
              id: c.id || `condition_${Date.now()}_${i}`,
              field_name: c.field_name ?? c.field ?? c.column ?? null, // 👈 normalize field names
              field_type: c.field_type || 'text',
              operator: c.operator ?? '==',
              value: c.value ?? '',
              condition_order: i
            }))
            .filter(c =>
              c.field_name && String(c.field_name).trim() !== '' && c.operator && c.value !== undefined
            ); // 👈 drop bad conditions

          if (normalizedConditions.length > 0) {
            enhancedFilters.push({
              id: 'extracted_group',
              conditions: normalizedConditions,
              logic: 'AND',
              group_order: 0
            });
          }
        }
      }
     
      console.log('🔍 Converted to enhanced filters:', enhancedFilters);
     
      // Skip RPC call if no valid conditions after normalization
      if (enhancedFilters.length === 0) {
        console.log('⚠️ No valid filter conditions after normalization, showing all records');
        await fetchObjectRecords();
        return;
      }
     
      console.log('�� Calling RecordListService.getFilteredRecords with:');
      console.log('  - objectId:', objectId);
      console.log('  - enhancedFilters:', enhancedFilters);
      console.log('  - selectedFields:', recordList.selected_fields);
     
      // Use the enhanced service to get filtered records
      const filteredData = await RecordListService.getFilteredRecords(
        objectId,
        enhancedFilters, // Pass the converted enhanced filters
        recordList.selected_fields,  // Pass the selected fields
        100, // limit
        0    // offset
      );
     
      console.log('✅ Filtered records received:', filteredData);
      console.log('✅ Filtered data type:', typeof filteredData);
      console.log('✅ Filtered data is array:', Array.isArray(filteredData));
     
      // Process the filtered data and update the records state
      if (filteredData && Array.isArray(filteredData)) {
        const processedRecords = processRecords(filteredData);
        setRecords(processedRecords);
        console.log('✅ Records filtered and updated:', processedRecords);
        console.log('✅ Number of filtered records:', processedRecords.length);
      } else {
        console.log('⚠️ No filtered data received, showing all records');
        console.log('⚠️ Filtered data was:', filteredData);
        await fetchObjectRecords();
      }
     
    } catch (error) {
      console.error('❌ Error fetching filtered records:', error);
      console.error('❌ Error details:', error);
      setError('Failed to fetch filtered records');
      // Fallback to showing all records
      await fetchObjectRecords();
    } finally {
      setLoading(false);
    }
  };

  // NEW: Handle Create Record List form submission
  const handleCreateRecordListSubmit = async () => {
    if (!objectId || !tenant?.id) {
      console.error('Cannot create record list: missing objectId or tenant');
      return;
    }

    if (!recordListForm.name.trim() || recordListForm.selectedFields.length === 0) {
      console.error('Cannot create record list: missing required fields');
      return;
    }

    try {
      // Use structured filters from FilterBuilder
      const filterCriteria = recordListForm.filterCriteria || [];
     
      // Validate filters if any are provided
      if (filterCriteria.length > 0) {
        console.log('🔍 Using structured filters:', filterCriteria);
      }

      const createRequest = {
        name: recordListForm.name.trim(),
        description: recordListForm.description.trim() || undefined,
        filter_criteria: filterCriteria,
        selected_fields: recordListForm.selectedFields
      };

      console.log('🔍 Creating enhanced record list with:', createRequest);

      // Use enhanced record list creation for structured filters
      const newRecordList = await RecordListService.createEnhancedRecordList(objectId, {
        name: createRequest.name,
        description: createRequest.description || '',
        filter_criteria: createRequest.filter_criteria,
        selected_fields: createRequest.selected_fields,
        tenant_id: tenant?.id || ''
      });

      console.log('✅ Enhanced record list created:', newRecordList);

      // Close modal and reset form
      setShowCreateRecordListModal(false);
      setRecordListForm({
        name: '',
        description: '',
        filterCriteria: [] as any[], // Reset to empty array
        selectedFields: []
      });

      // Refresh record lists
      await fetchRecordLists();

      // Show success message (optional)
      console.log('✅ Enhanced record list created successfully!');

    } catch (error) {
      console.error('Error creating enhanced record list:', error);
      // TODO: Show error message to user
    }
  };

  // NEW: Handle field selection in Create Record List modal
  const handleFieldSelection = (fieldName: string, isChecked: boolean) => {
    setRecordListForm(prev => ({
      ...prev,
      selectedFields: isChecked
        ? [...prev.selectedFields, fieldName]
        : prev.selectedFields.filter(field => field !== fieldName)
    }));
  };

  // Fetch object records function (moved outside useEffect)
  const fetchObjectRecords = async () => {
    if (tabType !== 'object' || !objectId || !tenant?.id) {
      setLoading(false);
      return;
    }
    
    try {
      setLoading(true);
      setError(null);
      
      console.log('🔍 Fetching object records for:', objectId);

      const { data, error: fetchError } = await supabase
        .rpc('get_object_records_with_references', {
          p_object_id: objectId,
          p_tenant_id: tenant?.id,
          p_limit: 100,
          p_offset: 0
        });

      if (fetchError) {
        console.error('Error fetching object records:', fetchError);
        setError(fetchError.message);
        return;
      }
      
      if (data) {
        console.log('�� Raw object records:', data);
      console.log('🔍 Data type:', typeof data);
        console.log('🔍 Data length:', Array.isArray(data) ? data.length : 'Not an array');
        console.log('🔍 First record sample:', Array.isArray(data) && data.length > 0 ? data[0] : 'No records');
       
        // Log detailed record analysis
        if (data && Array.isArray(data) && data.length > 0) {
          console.log('🔍 === RECORD DATA ANALYSIS ===');
          data.forEach((record, index) => {
            console.log(`�� Record ${index}:`, record);
            if (record.record_data) {
            console.log(`🔍 Record ${index} data keys:`, Object.keys(record.record_data));
            console.log(`🔍 Record ${index} data values:`, Object.values(record.record_data));
            console.log(`🔍 Record ${index} data types:`, Object.entries(record.record_data).map(([key, value]) => `${key}: ${typeof value}`));
            }
          });
          console.log('🔍 === RECORD DATA ANALYSIS COMPLETE ===');
        }
       
        // Process the new data structure (record_id + record_data)
        const processedRecords = processRecords(data);
        console.log('🔍 Processed records:', processedRecords);
        setRecords(processedRecords);
       
        // Show success message if no records but system is working
        if (Array.isArray(data) && data.length === 0) {
          console.log('✅ System connected successfully - no records found');
        }
      } else {
        console.log('🔍 No data returned from get_object_records');
      }
    } catch (err) {
      console.error('Error in fetchObjectRecords:', err);
      setError('Failed to fetch records');
    } finally {
      setLoading(false);
    }
  };

  // Fetch object records when component mounts
  useEffect(() => {
    fetchObjectRecords();
  }, [tabType, objectId, tenant?.id, supabase]);

  // NEW: Fetch record lists when object changes
  useEffect(() => {
    if (objectId && tenant?.id) {
      fetchRecordLists();
      // availableFields will be populated automatically when records load
    }
  }, [objectId, tenant?.id]);

  // NEW: Handle record click to show detail view
  const handleRecordClick = (record: GroupedRecord) => {
    console.log('�� === RECORD CLICKED ===');
    console.log('�� Full record object:', record);
    console.log('🔍 record.record_id:', record.record_id);
    console.log('🔍 record.fields:', record.fields);
    console.log('�� record.fields.name:', record.fields.name);
    console.log('�� objectId:', objectId);
    console.log('🔍 tabLabel:', tabLabel);
   
    const selectedRecordData = {
      recordId: record.record_id,
      recordName: record.fields.name || 'Unnamed Record',
      objectId: objectId!,
      objectLabel: tabLabel
    };
   
    console.log('🔍 Setting selectedRecord to:', selectedRecordData);
    setSelectedRecord(selectedRecordData);
    console.log('🔍 Setting viewMode to "detail"');
    setViewMode('detail');
   
    console.log('🔍 === RECORD CLICK COMPLETE ===');
  };

  // NEW: Handle back to list view
  const handleBackToList = () => {
    setViewMode('list');
    setSelectedRecord(null);
  };

  // Process records from the new data structure
  const processRecords = (data: ObjectRecord[]): GroupedRecord[] => {
    console.log('�� === PROCESSING RECORDS ===');
    console.log('�� Input data:', data);
   
    if (!Array.isArray(data)) {
      console.error('Data is not an array:', data);
      return [];
    }

    const processedRecords = data.map((item, index) => {
      console.log(`�� Processing item ${index}:`, item);
      const recordData = item.record_data || {};
      console.log(`🔍 Item ${index} record_data:`, recordData);
      console.log(`🔍 Item ${index} record_data keys:`, Object.keys(recordData));
     
      const processedRecord = {
        record_id: item.record_id,
        fields: recordData,
        created_at: recordData.created_at || '',
        updated_at: recordData.updated_at || ''
      };
     
      console.log(`🔍 Item ${index} processed record:`, processedRecord);
      return processedRecord;
    });
   
    console.log('🔍 Final processed records:', processedRecords);
    console.log('🔍 === PROCESSING COMPLETE ===');
    return processedRecords;
  };

  // Helper function to get field names for table headers
  const getFieldNames = (): string[] => {
    console.log('🔍 === GETTING FIELD NAMES ===');
   
    if (records.length === 0) {
      console.log('🔍 No records yet, returning default fields');
      return ['name', 'created_at'];
    }
   
    // Get all unique field names from all records
    const allFieldNames = new Set<string>();
   
    records.forEach((record, index) => {
      if (record.fields) {
        const fieldKeys = Object.keys(record.fields);
        console.log(`🔍 Record ${index} has fields:`, fieldKeys);
        fieldKeys.forEach(key => allFieldNames.add(key));
      }
    });
   
    const fieldNames = Array.from(allFieldNames);
    console.log('🔍 All unique field names found:', fieldNames);
   
    // Ensure name is always first, then other fields, then created_at/updated_at last
    const sortedFields = ['name'];
    fieldNames.forEach(field => {
      if (field !== 'name' && field !== 'created_at' && field !== 'updated_at') {
        sortedFields.push(field);
      }
    });
    if (fieldNames.includes('created_at')) sortedFields.push('created_at');
    if (fieldNames.includes('updated_at')) sortedFields.push('updated_at');
   
    console.log('�� Final sorted field names:', sortedFields);
    console.log('🔍 === FIELD NAMES COMPLETE ===');
    return sortedFields;
  };
  // Helper function to get field label from field name
  const getFieldLabel = (fieldName: string): string => {
    // Look up field label from fieldMetadata first
    if (fieldMetadata && fieldMetadata.length > 0) {
      console.log('🔍 fieldMetadata available:', fieldMetadata.length, 'fields');
      console.log('🔍 Looking for field:', fieldName);
      
      // Try exact match first
      let field = fieldMetadata.find(f => f.name === fieldName);
      console.log('🔍 Exact match found:', field);
      
      // If no exact match, try removing __a suffix
      if (!field && fieldName.endsWith('__a')) {
        const baseFieldName = fieldName.replace(/__a$/, '');
        console.log('🔍 Trying base field name:', baseFieldName);
        field = fieldMetadata.find(f => f.name === baseFieldName);
        console.log('🔍 Base match found:', field);
      }
      
      if (field && field.label) {
        return field.label;
      }
    } else {
      console.log('🔍 fieldMetadata is empty or not loaded yet');
    }
    
    // Fallback: use universal label formatting
    return formatColumnLabel(fieldName);
  };
  // NEW: Render record detail view
  const renderRecordDetail = () => {
    console.log('🔍 === RENDER RECORD DETAIL ===');
    console.log('🔍 selectedRecord:', selectedRecord);
   
    if (!selectedRecord) {
      console.log('⚠️ No selectedRecord, returning null');
      return null;
    }

    const recordDetailProps = {
      recordId: selectedRecord.recordId,
      objectId: selectedRecord.objectId,
      recordName: selectedRecord.recordName,
      objectLabel: selectedRecord.objectLabel,
      onBackToList: handleBackToList
    };
   
    console.log('🔍 Passing props to RecordDetailView:', recordDetailProps);
    console.log('🔍 RecordDetailView component type:', typeof RecordDetailView);
    console.log('🔍 RecordDetailView component:', RecordDetailView);
    console.log('🔍 === RENDER RECORD DETAIL COMPLETE ===');

    // Test if we can render RecordDetailView at all
    try {
      return (
        <RecordDetailView
          recordId={selectedRecord.recordId}
          objectId={selectedRecord.objectId}
          recordName={selectedRecord.recordName}
          objectLabel={selectedRecord.objectLabel}
          onBackToList={handleBackToList}
        />
      );
    } catch (error) {
      console.error('❌ Error rendering RecordDetailView:', error);
      return (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <h3 className="text-lg font-medium text-red-800 mb-4">Error Rendering RecordDetailView</h3>
          <p className="text-sm text-red-700 mb-4">{String(error)}</p>
          <button
            onClick={handleBackToList}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Back to List
          </button>
        </div>
      );
    }
  };



  // Render Object Tab content
  const renderObjectTab = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center p-8">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading records...</p>
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">Error Loading Records</h3>
              <p className="text-sm text-red-700 mt-1">{error}</p>
            </div>
          </div>
        </div>
      );
    }

    // Get field names for table headers - use selected fields for display, then record list fields, then all fields
    const allFieldNames = getFieldNames();
    const displayFieldNames = selectedFieldsForDisplay.length > 0 
      ? selectedFieldsForDisplay 
      : (selectedRecordList?.selected_fields || allFieldNames);
   
    console.log('🔍 === TABLE RENDERING ===');
    console.log('🔍 allFieldNames for table:', allFieldNames);
    console.log('�� selectedRecordList:', selectedRecordList);
    console.log('🔍 displayFieldNames (fields to show):', displayFieldNames);

    // NEW: Handle export click (moved here to access displayFieldNames)
    const handleExportClick = () => {
      console.log('🔍 === EXPORT CLICKED ===');
      console.log('🔍 Selected records:', selectedRecordIds.length);
      console.log('🔍 Available fields:', allFieldNames);
      
      // Initialize with all available fields selected (not just display fields)
      setSelectedFieldsForExport([...allFieldNames]);
      setShowExportModal(true);
    };

    // NEW: Handle field selection for export
    const handleExportFieldSelection = (fieldName: string, isSelected: boolean) => {
      if (isSelected) {
        setSelectedFieldsForExport(prev => [...prev, fieldName]);
      } else {
        setSelectedFieldsForExport(prev => prev.filter(field => field !== fieldName));
      }
    };

    // NEW: Handle export to Excel
    const handleExportToExcel = () => {
      console.log('🔍 === EXPORTING TO EXCEL ===');
      console.log('🔍 Selected records:', selectedRecordIds);
      console.log('🔍 Selected fields:', selectedFieldsForExport);
      
      if (selectedRecordIds.length === 0) {
        console.log('❌ No records selected for export');
        return;
      }
      
      if (selectedFieldsForExport.length === 0) {
        console.log('❌ No fields selected for export');
        return;
      }

      // Get selected records
      const selectedRecords = records.filter(record => 
        selectedRecordIds.includes(record.record_id)
      );
      
      console.log('🔍 Records to export:', selectedRecords);

      // Prepare data for Excel
      const excelData = selectedRecords.map(record => {
        const row: any = {};
        selectedFieldsForExport.forEach(fieldName => {
          const fieldValue = record.fields[fieldName];
          const fieldMeta = fieldMetadata.find(f => f.name === fieldName);
          
          // Format the value based on field type
          if (fieldMeta?.type === 'reference' && fieldValue) {
            // For reference fields, show the display value
            row[getFieldLabel(fieldName)] = fieldValue.display_value || fieldValue.value || '';
          } else if (fieldMeta?.type === 'date' && fieldValue) {
            // For date fields, format the date
            row[getFieldLabel(fieldName)] = new Date(fieldValue).toLocaleDateString();
          } else {
            // For other fields, show the raw value
            row[getFieldLabel(fieldName)] = fieldValue || '';
          }
        });
        return row;
      });

      console.log('🔍 Excel data prepared:', excelData);

      // Create workbook and worksheet
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(excelData);
      
      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(wb, ws, 'Exported Records');
      
      // Generate filename
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `${tabLabel}_export_${timestamp}.xlsx`;
      
      // Save file
      XLSX.writeFile(wb, filename);
      
      console.log('✅ Excel file exported:', filename);
      
      // Close modal
      setShowExportModal(false);
    };



    // NEW: Handle bulk actions (moved here to access export and draft functions)
    const handleBulkAction = (action: string) => {
      console.log('🔍 Bulk action:', action, 'on records:', selectedRecordIds);
      switch (action) {
        case 'delete':
          console.log('🗑️ Bulk delete selected records');
          // TODO: Implement bulk delete
          break;
        case 'export':
          console.log('📤 Bulk export selected records');
          handleExportClick();
          break;

        case 'update':
          console.log('✏️ Bulk update selected records');
          // TODO: Implement bulk update
          break;
        default:
          console.log('❓ Unknown bulk action:', action);
      }
    };
    console.log('�� Records to display:', records);
    console.log('🔍 Records length:', records.length);
    if (records.length > 0) {
      console.log('🔍 First record fields:', records[0].fields);
      console.log('�� First record field keys:', Object.keys(records[0].fields));
    }
    console.log('🔍 === TABLE RENDERING COMPLETE ===');

    return (
      <div className="space-y-4">
        {/* Header Section - ALWAYS visible with Record List + New Button */}
        <div className="flex justify-between items-center">
          {/* Record List Dropdown - Replaces the tab label */}
          {objectId && tenant?.id ? (
            <>
              {console.log('🔍 Rendering RecordListDropdown with:', { objectId, tenantId: tenant?.id, tabLabel, selectedRecordList })}
              <RecordListDropdown
                objectId={objectId}
                tenantId={tenant.id}
                tabLabel={tabLabel}
                onRecordListSelect={handleRecordListSelect}
                selectedRecordList={selectedRecordList}
                onCreateRecordList={() => setShowCreateRecordListModal(true)}
              />
            </>
          ) : (
            <>
              {console.log('🔍 Not rendering RecordListDropdown because:', { objectId, tenantId: tenant?.id })}
              <h2 className="text-lg font-medium text-gray-900">{tabLabel}</h2>
            </>
          )}
          <div className="flex space-x-2">
            {/* Selected Buttons Display */}
            {selectedButtons.length > 0 && (
              <div className="flex items-center space-x-2">
                {selectedButtons.map((buttonId) => {
                  const button = availableButtons.find(b => b.id === buttonId);
                  if (!button) return null;
                  
                  return (
                    <button
                      key={buttonId}
                      onClick={async () => {
                        console.log('🔘 Selected button clicked:', button);
                        console.log('🔍 Selected record IDs:', selectedRecordIds);
                        
                        // Check if this is a custom component button
                        if (button.custom_component_path) {
                          // For bulk operations, directly fetch the selected records and open the component
                          try {
                            console.log('🔍 Fetching selected records for bulk operation...');
                            
                            // Fetch the selected records directly
                            const { data: recordsData, error: recordsError } = await supabase
                              .rpc('get_object_records_with_references', {
                                p_object_id: objectId,
                                p_tenant_id: tenant?.id,
                                p_limit: 100,
                                p_offset: 0
                              });

                            if (recordsError) {
                              console.error('❌ Error fetching selected records:', recordsError);
                              return;
                            }

                            // Filter to only selected records
                            const selectedRecords = recordsData
                              ?.filter((record: any) => selectedRecordIds.includes(record.record_id))
                              ?.map((record: any) => record.record_data) || [];

                            console.log('✅ Selected records fetched:', selectedRecords);

                            // Store bulk operation data and show modal
                            setBulkOperationData({
                              button: button,
                              selectedRecordIds: selectedRecordIds,
                              selectedRecords: selectedRecords,
                              objectId: objectId,
                              tenantId: tenant?.id
                            });
                            
                            // Show the bulk operation modal directly
                            setShowBulkOperationModal(true);
                            
                          } catch (error) {
                            console.error('❌ Error in bulk operation setup:', error);
                          }
                        } else {
                          // Handle other button types (object buttons, etc.)
                          console.log('🔧 Other button type clicked:', button.button_type);
                        }
                      }}
                      className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md shadow-sm text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
                      title={button.label || button.name}
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                      </svg>
                      {button.label || button.name}
                    </button>
                  );
                })}
              </div>
            )}
            
            {/* Record List Icon with Dropdown */}
            <div className="relative record-list-dropdown">
              <button
                onClick={handleRecordListClick}
                className="inline-flex items-center justify-center p-2 border border-gray-300 text-sm font-medium rounded-md shadow-sm text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
                title="Record List"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </button>
             
              {/* Dropdown Menu */}
              {showRecordListDropdown && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg border border-gray-200 z-10">
                  <div className="py-1">
                    <button
                      onClick={handleCreateRecordList}
                      className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 focus:outline-none focus:bg-gray-100"
                    >
                      <svg className="w-4 h-4 mr-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                      Create Record List
                    </button>
                    <button
                      onClick={handleSelectFieldsToDisplay}
                      className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 focus:outline-none focus:bg-gray-100"
                    >
                      <svg className="w-4 h-4 mr-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                        Fields to Display
                    </button>
                    <button
                      onClick={handleButtonsToDisplay}
                      className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 focus:outline-none focus:bg-gray-100"
                    >
                      <svg className="w-4 h-4 mr-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                      </svg>
                        Buttons to Display
                    </button>
                  </div>
                </div>
              )}
            </div>
           
            <button
              onClick={handleNewRecordClick}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              New
            </button>
          </div>
        </div>

        {/* Content Section - Changes based on data state */}
        {records.length === 0 ? (
          // Empty State Content
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="text-center py-8">
              <div className="text-gray-400 mb-4">
                <svg className="mx-auto h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                {selectedRecordList
                  ? `No ${selectedRecordList.name} Records Found`
                  : `No ${tabLabel} Found`
                }
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                {selectedRecordList
                  ? selectedRecordList.filter_criteria && selectedRecordList.filter_criteria.length > 0
                    ? `There are no records matching the "${selectedRecordList.name}" filter criteria.`
                    : `There are no records in the "${selectedRecordList.name}" view.`
                  : `There are no records in this ${tabLabel.toLowerCase()} yet.`
                }
              </p>
              <p className="text-xs text-gray-400 mb-6">
                The system is ready to display records when they become available.
              </p>
             
              {/* Table Structure Preview */}
              <div className="bg-gray-50 rounded-lg p-4 text-left">
                <h4 className="text-sm font-medium text-gray-700 mb-3">
                  {selectedRecordList
                    ? `${selectedRecordList.name} View Fields:`
                    : 'Table Structure Preview:'
                  }
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                  {(selectedRecordList?.selected_fields || allFieldNames).map(fieldName => (
                    <div key={fieldName} className="bg-white px-2 py-1 rounded border text-gray-600">
                      {getFieldLabel(fieldName)}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Bulk Actions Bar */}
            {selectedRecordIds.length > 0 && (
              <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <span className="text-sm font-medium text-blue-900">
                      {selectedRecordIds.length} record{selectedRecordIds.length !== 1 ? 's' : ''} selected
                    </span>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleBulkAction('export')}
                        className="inline-flex items-center px-3 py-2 border border-blue-300 text-sm font-medium rounded-md text-blue-700 bg-white hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                      >
                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Export
                      </button>

                      <button
                        onClick={() => handleBulkAction('update')}
                        className="inline-flex items-center px-3 py-2 border border-blue-300 text-sm font-medium rounded-md text-blue-700 bg-white hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                      >
                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        Update
                      </button>
                      <button
                        onClick={() => handleBulkAction('delete')}
                        className="inline-flex items-center px-3 py-2 border border-red-300 text-sm font-medium rounded-md text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                      >
                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Delete
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedRecordIds([])}
                    className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                  >
                    Clear Selection
                  </button>
                </div>
              </div>
            )}

            {/* Table Info Bar */}
            <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <span className="text-sm text-gray-500">
                    {records.length} record{records.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="text-sm text-gray-500">
                  {displayFieldNames.length} field{displayFieldNames.length !== 1 ? 's' : ''} displayed
                </div>
              </div>
            </div>

            {/* Data Table Content */}
            {console.log('🔍 DataTable Props Debug:', {
              recordsCount: records.length,
              searchKeys: displayFieldNames,
              searchKeysLength: displayFieldNames.length,
              sampleRecord: records[0] ? {
                hasFields: !!records[0].fields,
                fieldsKeys: records[0].fields ? Object.keys(records[0].fields) : 'no fields'
              } : 'no records'
            })}
            <DataTable
            title=""
            data={records}
            searchKeys={displayFieldNames as any}
            enableSelection={true}
            selectedItems={selectedRecordIds}
            onSelectionChange={handleRecordSelectionChange}
            getItemId={(record) => record.record_id}
            columnWidths={columnWidths}
            onColumnWidthChange={handleColumnWidthChange}
            renderHeader={() => (
              <>
                {displayFieldNames.map((fieldName, index) => (
                  <th 
                    key={fieldName} 
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider relative group"
                    style={{ 
                      width: columnWidths[fieldName] || 'auto',
                      minWidth: '120px',
                      maxWidth: columnWidths[fieldName] || '300px'
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span>{getFieldLabel(fieldName)}</span>
                    </div>
                    {/* Draggable Resizer */}
                    {index < displayFieldNames.length - 1 && (
                      <div
                        className="absolute right-0 top-0 bottom-0 w-1 bg-gray-300 hover:bg-blue-500 cursor-col-resize opacity-0 group-hover:opacity-100 transition-opacity"
                        onMouseDown={(e) => handleColumnResize(e, fieldName)}
                        style={{ width: '4px' }}
                      />
                    )}
                  </th>
                ))}
              </>
            )}
            renderRow={(record, index) => {
              console.log(`🔍 === RENDERING ROW ${index} ===`);
              console.log(`🔍 Record:`, record);
              console.log(`🔍 Record fields:`, record.fields);
              console.log(`🔍 Field names to render:`, displayFieldNames);
             
              return (
                <>
                  {displayFieldNames.map(fieldName => {
                    const fieldValue = record.fields[fieldName];
                    // Find field metadata for reference field detection
                    const fieldMeta = fieldMetadata.find(f => f.name === fieldName);
                    console.log(`🔍 RENDERING FIELD "${fieldName}":`, {
                      fieldValue,
                      fieldMeta,
                      isReference: fieldMeta?.type === 'reference',
                      referenceTable: fieldMeta?.reference_table,
                      referenceDisplayField: fieldMeta?.reference_display_field,
                      fieldMetadataLength: fieldMetadata.length,
                      allFieldMetadata: fieldMetadata.map(f => ({ name: f.name, type: f.type, reference_table: f.reference_table }))
                    });
                   
                    return (
                      <td 
                        key={fieldName} 
                        className="px-6 py-4 text-sm text-gray-900 break-words"
                        style={{ 
                          width: columnWidths[fieldName] || 'auto',
                          minWidth: '120px',
                          maxWidth: columnWidths[fieldName] || '300px'
                        }}
                      >
                        <div className="break-words">
                          {fieldName === 'name' ? (
                            // NEW: Make Name field clickable
                            <button
                              onClick={() => handleRecordClick(record)}
                              className="text-blue-600 hover:text-blue-800 hover:underline font-medium cursor-pointer"
                            >
                              {fieldValue || '-'}
                            </button>
                          ) : (
                            // Use UniversalFieldDisplay for all other fields
                            <UniversalFieldDisplay
                              record={record.fields}
                              fieldName={fieldName}
                              fieldValue={fieldValue}
                              fieldType={fieldMeta?.type}
                              referenceTable={fieldMeta?.reference_table || undefined}
                              referenceDisplayField={fieldMeta?.reference_display_field || undefined}
                              tenantId={tenant?.id || ''}
                              recordId={record.record_id}
                            />
                          )}
                        </div>
                      </td>
                    );
                  })}
                </>
              );
            }}
            emptyMessage={
              selectedRecordList
                ? `No ${selectedRecordList.name} records found.`
                : `No ${tabLabel.toLowerCase()} records found.`
            }
            noSearchResultsMessage={
              selectedRecordList
                ? `No ${selectedRecordList.name} records match your search.`
                : `No ${tabLabel.toLowerCase()} records match your search.`
            }
            className="w-full"
          />
          </>
        )}

        {/* Export Modal */}
        {showExportModal && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
            <div className="relative top-20 mx-auto p-5 border w-11/12 md:w-3/4 lg:w-1/2 shadow-lg rounded-md bg-white max-h-[80vh] overflow-y-auto">
              <div className="mt-3">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium text-gray-900">
                    Export Records to Excel
                  </h3>
                  <button
                    onClick={() => setShowExportModal(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                
                {/* Field Selection */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-sm text-gray-600">
                      Select which fields to include in the export:
                    </p>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => setSelectedFieldsForExport([...allFieldNames])}
                        className="text-xs px-2 py-1 text-blue-600 hover:text-blue-800 border border-blue-300 rounded"
                      >
                        Select All
                      </button>
                      <button
                        onClick={() => setSelectedFieldsForExport([])}
                        className="text-xs px-2 py-1 text-gray-600 hover:text-gray-800 border border-gray-300 rounded"
                      >
                        Select None
                      </button>
                    </div>
                  </div>
                  
                  <div className="border border-gray-300 rounded-md p-4 max-h-60 overflow-y-auto">
                    <div className="space-y-3">
                      {allFieldNames.map(fieldName => (
                        <label key={fieldName} className="flex items-center">
                          <input
                            type="checkbox"
                            checked={selectedFieldsForExport.includes(fieldName)}
                            onChange={(e) => handleExportFieldSelection(fieldName, e.target.checked)}
                            className="mr-3 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                          />
                          <span className="text-sm font-medium text-gray-700">
                            {getFieldLabel(fieldName)}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex justify-end space-x-3 pt-4">
                    <button
                      onClick={() => setShowExportModal(false)}
                      className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleExportToExcel}
                      className="px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    >
                      Export to Excel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Render Custom Tab content
  const renderCustomTab = () => {
    console.log('🔍 🎯 renderCustomTab called');
    console.log('🔍 customComponentPath:', customComponentPath);
    console.log('🔍 tabId:', tabId);
    console.log('🔍 tabLabel:', tabLabel);
    
    if (!customComponentPath) {
      console.log('❌ No customComponentPath provided');
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="text-center py-8 text-gray-500">
          <div className="text-gray-400 mb-4">
            <svg className="mx-auto h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">Custom Tab Configuration Missing</h3>
          <p className="text-sm text-gray-500">
              This custom tab doesn't have a component path configured.
            </p>
            <p className="text-xs text-gray-400 mt-2">
              Go to Settings → Home → Tabs to configure the custom component path.
          </p>
        </div>
      </div>
      );
    }

    console.log('✅ Custom component path found, rendering CustomTabRenderer');
    // Dynamic component loading with error boundary
    return (
      <CustomTabRenderer 
        componentPath={customComponentPath}
        tabId={tabId}
        tabLabel={tabLabel}
        selectedRecordIds={selectedRecordIds}
      />
    );
  };

  // Render the bulk operation modal
  const renderBulkOperationModal = () => {
    console.log('🔍 === RENDER BULK OPERATION MODAL ===');
    console.log('🔍 showBulkOperationModal:', showBulkOperationModal);
    console.log('🔍 bulkOperationData:', bulkOperationData);
    
    if (!showBulkOperationModal || !bulkOperationData) {
      console.log('🔍 Modal not showing - conditions not met');
      return null;
    }
    
    console.log('🔍 ✅ Rendering bulk operation modal');

    const { button, selectedRecordIds, selectedRecords, objectId, tenantId } = bulkOperationData;

    return (
      <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
        <div className="relative top-4 mx-auto p-5 border w-11/12 md:w-4/5 lg:w-3/4 xl:w-2/3 shadow-lg rounded-md bg-white max-h-[95vh] overflow-y-auto">
          <div className="mt-3">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">
                {button.label || button.name} - Bulk Operation
              </h3>
              <button
                onClick={() => setShowBulkOperationModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
              <p className="text-sm text-blue-800">
                <strong>{selectedRecordIds.length}</strong> records selected for bulk operation
              </p>
            </div>

            {/* Render the custom component directly in the modal */}
            <div className="max-h-[70vh] overflow-y-auto">
              <CustomTabRenderer 
                componentPath={button.custom_component_path}
                tabId="bulk-operation"
                tabLabel={button.label || button.name}
                selectedRecordIds={selectedRecordIds}
                recordId={null}
                objectId={objectId}
                recordData={selectedRecords}
                tenantId={tenantId}
              />
            </div>
          </div>
        </div>
      </div>
    );
  };

  // CRITICAL: Check for bulk operation modal FIRST, before any other rendering logic
  console.log('🔍 === BULK OPERATION MODAL CHECK ===');
  console.log('🔍 showBulkOperationModal:', showBulkOperationModal);
  console.log('🔍 bulkOperationData exists:', !!bulkOperationData);
  
  if (showBulkOperationModal && bulkOperationData) {
    console.log('🔍 ✅ Rendering bulk operation modal (PRIORITY)');
    return renderBulkOperationModal();
  }

  // NEW: Main render logic with navigation state
  console.log('🔍 === MAIN RENDER LOGIC ===');
  console.log('🔍 Current tabId:', tabId);
  console.log('🔍 Current objectId:', objectId);
  console.log('🔍 Current viewMode:', viewMode);
  console.log('🔍 Current selectedRecord:', selectedRecord);
  console.log('🔍 viewMode === "detail":', viewMode === 'detail');
  console.log('🔍 selectedRecord exists:', !!selectedRecord);
 
  // SAFETY CHECK: If we're in detail mode but tabId changed, force back to list
  if (viewMode === 'detail' && selectedRecord && selectedRecord.objectId !== objectId) {
    console.log('🔍 ⚠️ SAFETY CHECK: viewMode is detail but objectId changed, forcing reset');
    console.log('🔍 selectedRecord.objectId:', selectedRecord.objectId);
    console.log('🔍 current objectId:', objectId);
    console.log('🔍 Mismatch detected - resetting view');
   
    setViewMode('list');
    setSelectedRecord(null);
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <div className="text-center">
        <p className="text-blue-800">Switching tabs...</p>
        </div>
      </div>
    );
  }
 
  if (viewMode === 'detail' && selectedRecord) {
    console.log('�� ✅ Rendering record detail view');
    return renderRecordDetail();
  }
 
  console.log('🔍 ✅ Rendering list view (default)');
 
  // DEBUG: Show current state for troubleshooting
  if (viewMode === 'detail') {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
        <h3 className="text-lg font-medium text-yellow-800 mb-4">Debug: Record Detail View State</h3>
        <div className="space-y-2 text-sm">
          <div><strong>viewMode:</strong> {viewMode}</div>
          <div><strong>selectedRecord:</strong> {selectedRecord ? 'EXISTS' : 'NULL'}</div>
          {selectedRecord && (
            <>
              <div><strong>recordId:</strong> {selectedRecord.recordId}</div>
              <div><strong>recordName:</strong> {selectedRecord.recordName}</div>
              <div><strong>objectId:</strong> {selectedRecord.objectId}</div>
              <div><strong>objectLabel:</strong> {selectedRecord.objectLabel}</div>
            </>
          )}
          <button
            onClick={handleBackToList}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Back to List
          </button>
        </div>
      </div>
    );
  }

  // Main render logic for list view
  switch (tabType) {
    case 'custom':
      console.log('🔍 🎯 Rendering custom tab:', tabLabel);
      return renderCustomTab();
      
    case 'object':
      return (
        <div>
          {renderObjectTab()}
         
          {/* New Record Modal - Dynamic Form Based on Page Layout */}
          {showNewRecordForm && (
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
              <div className="relative top-20 mx-auto p-5 border w-11/12 md:w-3/4 lg:w-1/2 shadow-lg rounded-md bg-white max-h-[80vh] overflow-y-auto">
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-medium text-gray-900">
                        New {tabLabel.slice(0, -1)}
                      </h3>
                      <p className="text-sm text-gray-500 mt-1">
                        System fields (Created At, Updated At, Created By, Updated By) will be automatically populated.
                      </p>
                    </div>
                    <button
                      onClick={() => setShowNewRecordForm(false)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                 
                  {/* Dynamic Form Content Based on Page Layout */}
                  {layoutLoading ? (
                    <div className="text-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                      <p className="text-gray-600">Loading form configuration...</p>
                    </div>
                  ) : layoutError ? (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                      <div className="flex items-center">
                        <div className="flex-shrink-0">
                          <svg className="h-5 w-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                          </svg>
                        </div>
                        <div className="ml-3">
                          <h3 className="text-sm font-medium text-red-800">Error Loading Form</h3>
                          <p className="text-sm text-red-700 mt-1">{layoutError}</p>
                        </div>
                      </div>
                    </div>
                  ) : pageLayout.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      <div className="text-gray-400 mb-4">
                        <svg className="mx-auto h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <h3 className="text-lg font-medium text-gray-900 mb-2">
                        No Form Configuration Found
                      </h3>
                      <p className="text-sm text-gray-500">
                        This object doesn't have a page layout configured yet.
                      </p>
                    </div>
                  ) : (
                    <RecordForm
                      objectId={objectId!}
                      tenantId={tenant!.id}
                      pageLayout={pageLayout}
                      fieldMetadata={fieldMetadata}
                      onSuccess={(recordId) => {
                        console.log('🎉 === RECORD CREATION SUCCESS ===');
                        console.log('🎉 Record ID:', recordId);
                        console.log('🎉 Object ID:', objectId);
                        console.log('🎉 Tab Label:', tabLabel);
                       
                        // Close the modal
                        setShowNewRecordForm(false);
                        console.log('🎉 Modal closed');
                       
                        // Refresh the records list to show the new record
                        console.log('�� Refreshing records list...');
                        fetchObjectRecords();
                       
                        // Optional: Show success message
                        console.log('✅ Record created and list refreshed!');
                        console.log('🎉 === SUCCESS FLOW COMPLETE ===');
                      }}
                      onCancel={() => {
                        console.log('🚫 === RECORD CREATION CANCELLED ===');
                        console.log('🚫 User cancelled form');
                        console.log('🚫 Object ID:', objectId);
                        console.log('🚫 Tab Label:', tabLabel);
                        setShowNewRecordForm(false);
                      }}
                      onError={(error) => {
                        console.error('💥 === RECORD CREATION ERROR ===');
                        console.error('💥 Error message:', error);
                        console.error('💥 Object ID:', objectId);
                        console.error('💥 Tab Label:', tabLabel);
                        console.error('�� Page Layout Length:', pageLayout.length);
                        console.error('💥 Field Metadata Length:', fieldMetadata.length);
                        console.error('💥 === ERROR FLOW COMPLETE ===');
                        // Error is handled by the RecordForm component
                      }}
                    />
                  )}
                 
                  {/* Form buttons are handled by RecordForm component */}
                </div>
              </div>
            </div>
          )}

          {/* Create Record List Modal */}
          {showCreateRecordListModal && (
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
              <div className="relative top-20 mx-auto p-5 border w-11/12 md:w-3/4 lg:w-1/2 shadow-lg rounded-md bg-white max-h-[80vh] overflow-y-auto">
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-medium text-gray-900">
                      Create Record List
                    </h3>
                    <button
                      onClick={() => setShowCreateRecordListModal(false)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                 
                  {/* Create Record List Form */}
                  <div className="space-y-4">
                    {/* Record List Name */}
                    <div>
                      <label htmlFor="recordListName" className="block text-sm font-medium text-gray-700 mb-2">
                        Record List Name *
                      </label>
                      <input
                        type="text"
                        id="recordListName"
                        value={recordListForm.name}
                        onChange={(e) => setRecordListForm(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="Enter record list name"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>

                    {/* Description */}
                    <div>
                      <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
                        Description
                      </label>
                      <textarea
                        id="description"
                        value={recordListForm.description}
                        onChange={(e) => setRecordListForm(prev => ({ ...prev, description: e.target.value }))}
                        rows={2}
                        placeholder="Enter description (optional)"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>

                    {/* NEW: Advanced Filter Builder */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Filter Criteria
                      </label>
                      <FilterBuilder
                        filters={recordListForm.filterCriteria || []}
                        availableFields={availableFields} // ✅ Use dynamic fields from database
                        onFiltersChange={(filters) => setRecordListForm(prev => ({ ...prev, filterCriteria: filters }))}
                        className="border border-gray-300 rounded-md p-3"
                      />
                    </div>

                    {/* Select Fields */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Select Fields *
                      </label>
                      <div className="border border-gray-300 rounded-md p-3 max-h-40 overflow-y-auto">
                        <div className="space-y-2">
                          {/* Dynamic fields based on available fields */}
                          {getFieldNames().map(fieldName => (
                            <label key={fieldName} className="flex items-center">
                              <input
                                type="checkbox"
                                checked={recordListForm.selectedFields.includes(fieldName)}
                                onChange={(e) => handleFieldSelection(fieldName, e.target.checked)}
                                className="mr-2 text-blue-600 focus:ring-blue-500"
                              />
                              <span className="text-sm text-gray-700">
                                {fieldName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex justify-end space-x-3 pt-4">
                      <button
                        onClick={() => setShowCreateRecordListModal(false)}
                        className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleCreateRecordListSubmit}
                        className="px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                      >
                        Create Record List
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Fields to Display Modal */}
          {showFieldsToDisplayModal && (
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
              <div className="relative top-20 mx-auto p-5 border w-11/12 md:w-3/4 lg:w-1/2 shadow-lg rounded-md bg-white max-h-[80vh] overflow-y-auto">
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-medium text-gray-900">
                      Select Fields to Display
                    </h3>
                    <button
                      onClick={() => setShowFieldsToDisplayModal(false)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                 
                  {/* Fields Selection */}
                  <div className="space-y-4">
                    <p className="text-sm text-gray-600 mb-4">
                      Choose which fields to display in the {tabLabel} table. Fields marked with * are required.
                    </p>
                    
                    {/* Quick Selection Buttons */}
                    <div className="flex space-x-2 mb-4">
                      <button
                        onClick={handleSelectAllFields}
                        className="px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        Select All
                      </button>
                      <button
                        onClick={handleSelectNoneFields}
                        className="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500"
                      >
                        Select None
                      </button>
                      <span className="text-xs text-gray-500 self-center">
                        {selectedFieldsForDisplay.length} of {availableFieldsForDisplay.length} fields selected
                      </span>
                    </div>
                   
                    <div className="border border-gray-300 rounded-md p-4 max-h-60 overflow-y-auto">
                      {fieldsDisplayLoading ? (
                        <div className="text-center py-4">
                          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto"></div>
                          <p className="text-sm text-gray-500 mt-2">Loading fields...</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {(() => {
                            console.log('🔍 === RENDERING FIELDS MODAL ===');
                            console.log('🔍 availableFieldsForDisplay:', availableFieldsForDisplay);
                            console.log('🔍 availableFieldsForDisplay length:', availableFieldsForDisplay.length);
                            console.log('🔍 availableFieldsForDisplay type:', typeof availableFieldsForDisplay);
                            console.log('🔍 availableFieldsForDisplay is array:', Array.isArray(availableFieldsForDisplay));
                            console.log('🔍 selectedFieldsForDisplay:', selectedFieldsForDisplay);
                            console.log('🔍 selectedFieldsForDisplay length:', selectedFieldsForDisplay.length);
                            console.log('🔍 fieldsDisplayLoading:', fieldsDisplayLoading);
                            return null;
                          })()}
                          {availableFieldsForDisplay.length === 0 ? (
                            <div className="text-center py-4">
                              <p className="text-sm text-gray-500">No fields available</p>
                              <p className="text-xs text-gray-400 mt-1">Try refreshing the page or check console logs</p>
                            </div>
                          ) : (
                            availableFieldsForDisplay.map((fieldName) => {
                              const isRequired = fieldName === 'name';
                              const isSelected = selectedFieldsForDisplay.includes(fieldName);
                              
                              return (
                                <label key={fieldName} className="flex items-center justify-between">
                                  <div className="flex items-center">
                                    <input 
                                      type="checkbox" 
                                      checked={isSelected}
                                      disabled={isRequired}
                                      onChange={(e) => handleFieldSelectionForDisplay(fieldName, e.target.checked)}
                                      className="mr-3 text-blue-600 focus:ring-blue-500 disabled:opacity-50" 
                                    />
                                    <span className="text-sm font-medium text-gray-700">
                                      {getFieldLabel(fieldName)}
                                    </span>
                                    {isRequired && (
                                      <span className="ml-2 text-xs text-gray-500">(Required)</span>
                                    )}
                                  </div>
                                </label>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex justify-end space-x-3 pt-4">
                      <button
                        onClick={() => setShowFieldsToDisplayModal(false)}
                        className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveFieldDisplayPreferences}
                        className="px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                      >
                        Save Changes
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Buttons to Display Modal */}
          {showButtonsToDisplayModal && (
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
              <div className="relative top-20 mx-auto p-5 border w-11/12 md:w-3/4 lg:w-1/2 shadow-lg rounded-md bg-white max-h-[80vh] overflow-y-auto">
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-medium text-gray-900">
                      Buttons to Display
                    </h3>
                    <button
                      onClick={() => setShowButtonsToDisplayModal(false)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                 
                  {/* Buttons to Display Content */}
                  <div className="space-y-4">
                    {buttonsLoading ? (
                      <div className="text-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                        <p className="text-gray-600">Loading buttons...</p>
                      </div>
                    ) : availableButtons.length === 0 ? (
                      <div className="text-center py-8 text-gray-500">
                        <svg className="w-12 h-12 mx-auto mb-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                        </svg>
                        <p className="text-lg font-medium text-gray-900 mb-2">No Buttons Available</p>
                        <p className="text-sm text-gray-600">
                          No buttons are configured for this object's page layout.
                        </p>
                        <p className="text-xs text-gray-500 mt-2">
                          Create buttons in the Object Manager → Page Layout section.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-sm text-gray-600 mb-4">
                          Select which buttons to display beside the record list icon:
                        </p>
                        <div className="space-y-2 max-h-60 overflow-y-auto">
                          {availableButtons.map((button) => (
                            <div key={button.id} className="flex items-center space-x-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
                              <input
                                type="checkbox"
                                id={`button-${button.id}`}
                                checked={selectedButtons.includes(button.id)}
                                onChange={(e) => handleButtonSelection(button.id, e.target.checked)}
                                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                              />
                              <div className="flex-1">
                                <label htmlFor={`button-${button.id}`} className="text-sm font-medium text-gray-900 cursor-pointer">
                                  {button.label || button.name}
                                </label>
                                <div className="text-xs text-gray-500 mt-1">
                                  <span className="inline-block bg-gray-100 px-2 py-1 rounded text-xs mr-2">
                                    {button.button_type}
                                  </span>
                                  {button.action_type && (
                                    <span className="inline-block bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs">
                                      {button.action_type}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex justify-between pt-4">
                    <div className="flex space-x-2">
                      {selectedButtons.length > 0 && (
                        <button
                          onClick={handleClearButtonPreferences}
                          className="px-4 py-2 border border-red-300 text-sm font-medium rounded-md text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                        >
                          Clear All
                        </button>
                      )}
                    </div>
                    <div className="flex space-x-3">
                      <button
                        onClick={() => setShowButtonsToDisplayModal(false)}
                        className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                      >
                        Cancel
                      </button>
                      {availableButtons.length > 0 && (
                        <button
                          onClick={handleSaveSelectedButtons}
                          className="px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                        >
                          Save Changes
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
      </div>
    );
  };

  // Main render logic for list view
  const renderMainContent = () => {
    switch (tabType) {
      case 'custom':
        console.log('🔍 🎯 Rendering custom tab:', tabLabel);
        return renderCustomTab();
        
      case 'object':
        return renderObjectTab();
        
      default:
        return (
          <div className="text-center py-8 text-gray-500">
            <p>Unknown tab type: {tabType}</p>
          </div>
        );
    }
  };



    // This should never be reached since bulk operation modal check is now at the top
  console.log('🔍 ✅ Rendering main content (fallback)');
  return renderMainContent();
}