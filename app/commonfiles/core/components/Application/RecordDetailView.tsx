'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useSupabase } from '../../providers/SupabaseProvider';
import { UniversalFieldDisplay, formatColumnLabel } from '../ui/UniversalFieldDisplay';
import CustomTabRenderer from './CustomTabRenderer';
import { draftToClientService } from '../../services/DraftToClientService';

interface RecordDetailViewProps {
  recordId: string;
  objectId: string;
  recordName: string;
  objectLabel: string;
  onBackToList: () => void;
}

interface LayoutBlock {
  id: string;
  object_id: string;
  block_type: 'field' | 'related_list' | 'button';
  field_id?: string;
  related_list_id?: string;
  label: string;
  section: string;
  display_order: number;
  width?: 'half' | 'full';
  is_visible: boolean;
  created_at?: string;
  updated_at?: string;
  tab_type?: 'main' | 'related_list';
  display_columns?: string[];
  button_id?: string;
}

interface FieldMetadata {
  id: string;
  object_id: string;
  name: string;
  label: string;
  type: string;
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

interface RecordData {
  [key: string]: any;
}

interface RelatedListData {
  record_id: string;
  record_data: RecordData;
  created_at: string;
  updated_at: string;
}

interface ChildObject {
  object_id: string;
  object_name: string;
  object_label: string;
  relationship_type: string;
  is_active: boolean;
  display_order: number;
}

type TabType = 'information' | string; // 'information' or child object ID

// Helper function to check if a field is a system field
const isSystemField = (fieldName: string): boolean => {
  const systemFields = ['created_at', 'updated_at', 'created_by', 'updated_by'];
  return systemFields.includes(fieldName);
};

// Helper function to normalize field names by removing __a suffix
const normalizeFieldName = (fieldName: string): string => {
  // Remove __a suffix if present (e.g., hero__a -> hero)
  return fieldName.replace(/__a$/, '');
};

// Helper function to map display field names to database API names
const mapDisplayNameToApiName = (displayName: string, fieldMetadata: FieldMetadata[]): string => {
  // First try to find exact match by database column name (this is most common)
  const fieldByName = fieldMetadata.find(f => f.name === displayName);
  if (fieldByName) {
    return fieldByName.name; // This is already the corrected database column name
  }
  
  // Try to find by label (display name)
  const fieldByLabel = fieldMetadata.find(f => f.label === displayName);
  if (fieldByLabel) {
    return fieldByLabel.name; // This is the corrected database column name
  }
  
  // Try to find by normalized name (remove __a suffix) - for cases where display name doesn't have suffix
  const normalizedDisplayName = normalizeFieldName(displayName);
  const fieldByNormalizedName = fieldMetadata.find(f => normalizeFieldName(f.name) === normalizedDisplayName);
  if (fieldByNormalizedName) {
    return fieldByNormalizedName.name;
  }
  
  // If no match found, return the original display name
  // This handles system fields that don't have __a suffix
  console.warn(`⚠️ No field metadata found for display name: ${displayName}`);
  return displayName;
};

// Helper function to find field value using normalized field names
const findFieldValue = (recordData: RecordData, fieldName: string): any => {
  // First try exact match
  if (recordData[fieldName] !== undefined) {
    return recordData[fieldName];
  }
  
  // Then try with __a suffix
  const fieldNameWithSuffix = `${fieldName}__a`;
  if (recordData[fieldNameWithSuffix] !== undefined) {
    return recordData[fieldNameWithSuffix];
  }
  
  // Finally try normalized version
  const normalizedName = normalizeFieldName(fieldName);
  if (normalizedName !== fieldName && recordData[normalizedName] !== undefined) {
    return recordData[normalizedName];
  }
  
  return undefined;
};

// Enhanced smart field value lookup that tries multiple field name variations
const getSmartFieldValue = (recordData: RecordData, fieldName: string): any => {
  // First try exact match
  if (recordData[fieldName] !== undefined) {
    return recordData[fieldName];
  }
  
  // Try with __a suffix
  const fieldNameWithSuffix = `${fieldName}__a`;
  if (recordData[fieldNameWithSuffix] !== undefined) {
    return recordData[fieldNameWithSuffix];
  }
  
  // Try with _a suffix
  const fieldNameWithSingleA = `${fieldName}_a`;
  if (recordData[fieldNameWithSingleA] !== undefined) {
    return recordData[fieldNameWithSingleA];
  }
  
  // Try snake_case version
  const snakeCaseName = fieldName.replace(/([A-Z])/g, '_$1').toLowerCase();
  if (recordData[snakeCaseName] !== undefined) {
    return recordData[snakeCaseName];
  }
  
  // Try snake_case with __a suffix
  const snakeCaseWithSuffix = `${snakeCaseName}__a`;
  if (recordData[snakeCaseWithSuffix] !== undefined) {
    return recordData[snakeCaseWithSuffix];
  }
  
  // Try snake_case with _a suffix
  const snakeCaseWithSingleA = `${snakeCaseName}_a`;
  if (recordData[snakeCaseWithSingleA] !== undefined) {
    return recordData[snakeCaseWithSingleA];
  }
  
  // If nothing found, return undefined
  return undefined;
};

export default function RecordDetailView({ 
  recordId, 
  objectId, 
  recordName, 
  objectLabel,
  onBackToList 
}: RecordDetailViewProps) {
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [layoutBlocks, setLayoutBlocks] = useState<LayoutBlock[]>([]);
  const [fieldMetadata, setFieldMetadata] = useState<FieldMetadata[]>([]);
  const [recordData, setRecordData] = useState<RecordData | null>(null);
  const [sections, setSections] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>('information');
  const [childObjects, setChildObjects] = useState<ChildObject[]>([]);
  const [relatedListData, setRelatedListData] = useState<{[key: string]: RelatedListData[]}>({});
  const [isEditing, setIsEditing] = useState(false);
  const [editingValues, setEditingValues] = useState<RecordData>({});
  const [saving, setSaving] = useState(false);
  
  // Custom component state for modal display
  const [activeCustomComponent, setActiveCustomComponent] = useState<{
    componentPath: string;
    buttonDetail: any;
  } | null>(null);
  
  // NEW: Add picklist and reference options for edit mode (same as create modal)
  const [picklistOptions, setPicklistOptions] = useState<{ [key: string]: any[] }>({});
  const [referenceOptions, setReferenceOptions] = useState<{ [key: string]: any[] }>({});
  const [referenceLoading, setReferenceLoading] = useState<{ [key: string]: boolean }>({});
  
  
  const { tenant } = useSupabase();
  const supabase = createClientComponentClient();

  // NEW: Load picklist field options for edit mode
  useEffect(() => {
    const loadPicklistOptions = async () => {
      const picklistFields = fieldMetadata.filter(f => f.type === 'picklist');
      
      for (const field of picklistFields) {
        try {
          // Fetch picklist values from database
          const { data, error } = await supabase
            .rpc('get_picklist_values', {
              p_field_id: field.id
            });

          if (error) {
            console.warn(`Warning loading picklist options for edit ${field.name}:`, error);
          } else if (data) {
            setPicklistOptions(prev => ({
              ...prev,
              [field.name]: data
            }));
          }
        } catch (err) {
          console.warn(`Error loading picklist options for edit ${field.name}:`, err);
        }
      }
    };

    if (fieldMetadata.length > 0) {
      loadPicklistOptions();
    }
  }, [fieldMetadata]);

  // NEW: Load reference field options for edit mode
  useEffect(() => {
    const loadReferenceOptions = async () => {
      const referenceFields = fieldMetadata.filter(f => f.type === 'reference' && f.reference_table);
      
      if (referenceFields.length === 0) {
        return;
      }

      for (const field of referenceFields) {
        // Set loading state for this field
        setReferenceLoading(prev => ({ ...prev, [field.name]: true }));
        
        try {
          // Use the same RPC function as create modal
          const { data, error } = await supabase
            .rpc('get_reference_options', {
              p_table_name: field.reference_table!,
              p_tenant_id: tenant?.id || '',
              p_limit: 100
            });

          if (error) {
            console.error(`❌ Error loading reference options for edit ${field.name}:`, error);
            console.error(`❌ Error details:`, error);
          } else if (data) {
            if (Array.isArray(data) && data.length > 0) {
              setReferenceOptions(prev => ({
                ...prev,
                [field.name]: data
              }));
            } else {
              console.warn(`⚠️ No reference options returned for edit ${field.name}`);
              console.warn(`⚠️ This usually means the RPC function returned null or undefined`);
            }
          }
        } catch (err) {
          console.error(`💥 Exception loading reference options for edit ${field.name}:`, err);
          console.error(`💥 Exception type:`, typeof err);
          console.error(`💥 Exception message:`, err instanceof Error ? err.message : String(err));
        } finally {
          // Clear loading state for this field
          setReferenceLoading(prev => ({ ...prev, [field.name]: false }));
        }
      }
    };

    if (fieldMetadata.length > 0 && tenant?.id) {
      loadReferenceOptions();
    }
  }, [fieldMetadata, tenant?.id]);

  // NEW: Create tabs for child objects based on related lists
  const childObjectTabs = useMemo(() => {
    if (!childObjects || childObjects.length === 0) {
      return [];
    }
    
    const tabs = childObjects.map(childObj => {
      return {
        id: childObj.object_id,
        label: childObj.object_label, // Use display label, not name
        type: 'child_object',
        objectId: childObj.object_id
      };
    });
    
    return tabs;
  }, [childObjects]);

  // NEW: Map child objects to their related list blocks using proper database relationship
  const childObjectToRelatedListMap = useMemo(() => {
    if (!childObjects || !layoutBlocks) return new Map();
    
    const mapping = new Map();
    
    // Find related list blocks that correspond to child objects
    let relatedListBlockCount = 0;
    layoutBlocks.forEach((block, index) => {
      if (block.block_type === 'related_list') {
        relatedListBlockCount++;
        
        // The related_list_id in the block references related_list_metadata.id
        // We need to find which child object this related list represents
        // The relationship is: Layout Block -> Related List Metadata -> Child Object
        
        // For now, let's try to find the child object by looking at the block label
        // This is a temporary fix until we can properly query the related_list_metadata table
        const childObject = childObjects.find(child => {
          // Try to match by object label (case-insensitive)
          return child.object_label.toLowerCase() === block.label.toLowerCase();
        });
        
        if (childObject) {
          // Map the child object ID to the related list block
          mapping.set(childObject.object_id, block);
        } else {
          // Alternative: try to match by object name
          const childObjectByName = childObjects.find(child => {
            return child.object_name.toLowerCase() === block.label.toLowerCase();
          });
          
          if (childObjectByName) {
            mapping.set(childObjectByName.object_id, block);
          }
        }
      }
    });
    
    return mapping;
  }, [childObjects, layoutBlocks]);

  // Combine information tab with child object tabs
  const allTabs = useMemo(() => {
    const tabs = [
      { id: 'information', label: 'Information', type: 'information' }
    ];
    
    // Add child object tabs
    childObjectTabs.forEach(childTab => {
      tabs.push(childTab);
    });
    
    return tabs;
  }, [childObjectTabs]);

  // Set default active tab to information
  useEffect(() => {
    if (allTabs.length > 0 && !activeTab) {
      setActiveTab('information');
    }
  }, [allTabs, activeTab]);

  // Load button details for custom components
  const [buttonDetails, setButtonDetails] = useState<{[key: string]: any}>({});
  

  
  const loadButtonDetails = async () => {
    if (!tenant?.id) {
      return;
    }
    
    try {
      // Get button IDs from layout blocks
      const buttonIds = layoutBlocks
        .filter(block => block.block_type === 'button' && block.button_id)
        .map(block => block.button_id!);
      
      if (buttonIds.length === 0) {
        return;
      }
      
      // Skip RPC since it doesn't exist, go directly to query
      const { data: directData, error: directError } = await supabase
        .schema('tenant')
        .from('button__a')
        .select('*')
        .in('id', buttonIds)
        .eq('tenant_id', tenant.id);
      
      if (!directError && directData && directData.length > 0) {
        // Map the button details by ID
        const detailsMap: {[key: string]: any} = {};
        directData.forEach((button: any) => {
          const mappedButton = {
            id: button.id,
            name: button.name,
            api_name: button.name, // Use name as api_name
            button_type: button.button_type__a,
            is_active: button.is_active,
            label: button.label__a,
            custom_component_path: button.custom_component_path__a,
            custom_route: button.custom_route__a,
            action_type: button.action_type__a,
            action_config: button.action_config__a,
            button_style: button.button_style__a,
            button_size: button.button_size__a,
            display_order: button.display_order__a,
          };
          detailsMap[button.id] = mappedButton;
        });
        setButtonDetails(prev => ({ ...prev, ...detailsMap }));
      }
    } catch (error) {
      console.error('❌ Error loading button details:', error);
    }
  };

  useEffect(() => {
    if (layoutBlocks.length > 0 && tenant?.id) {
      loadButtonDetails();
    }
  }, [layoutBlocks, tenant?.id]);





  // Fetch layout configuration and record data
  useEffect(() => {
    const fetchRecordDetail = async () => {
      if (!objectId || !recordId || !tenant?.id) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // 1. Fetch layout blocks for the object
        const { data: layoutData, error: layoutError } = await supabase
          .rpc('get_layout_blocks', {
            p_object_id: objectId,
            p_tenant_id: tenant.id
          });

        if (layoutError) {
          console.error('❌ Error fetching layout blocks:', layoutError);
          throw new Error(`Failed to fetch layout blocks: ${layoutError.message}`);
        }
        
        // Check related list blocks specifically
        const relatedListBlocks = layoutData?.filter(block => block.block_type === 'related_list') || [];
        
        setLayoutBlocks(layoutData || []);

        // 2. Fetch field metadata for the object using bridge function
        const { data: fieldData, error: fieldError } = await supabase
          .rpc('get_tenant_fields', {
            p_object_id: objectId,
            p_tenant_id: tenant.id
          });

        if (fieldError) {
          console.error('❌ Error fetching field metadata:', fieldError);
          throw new Error(`Failed to fetch field metadata: ${fieldError.message}`);
        }

        // Add __a suffix to custom field names to get API names
        const correctedFieldData = (fieldData || []).map(field => {
          const systemFields = ['id', 'tenant_id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'name', 'is_active', 'autonumber'];
          const isSystemField = systemFields.includes(field.name);
          
          if (!isSystemField && !field.name.endsWith('__a')) {
            return { ...field, name: field.name + '__a' };
          }
          
          return field;
        });
        
        setFieldMetadata(correctedFieldData);

        // 3. Fetch record data using bridge function
        const { data: recordsData, error: recordError } = await supabase
          .rpc('get_object_records_with_references', {
            p_object_id: objectId,
            p_tenant_id: tenant.id,
            p_limit: 100,
            p_offset: 0
          });

        if (recordError) {
          console.error('❌ Error fetching record data:', recordError);
          throw new Error(`Failed to fetch record data: ${recordError.message}`);
        }

        const targetRecord = recordsData?.find(r => r.record_id === recordId);
        if (!targetRecord) {
          throw new Error(`Record not found: ${recordId}`);
        }

        const extractedRecordData = targetRecord.record_data;
        setRecordData(extractedRecordData);
        setEditingValues(extractedRecordData); // Initialize editing values

        // 4. Extract unique sections from layout blocks
        const allSections = Array.from(
          new Set(layoutData?.map((block: LayoutBlock) => block.section) || [])
        );
        
        const uniqueSections = allSections
        .filter(section => section !== 'related_lists') // NEW: Filter out related_lists section
        .sort((a, b) => {
          // Prioritize "details" section at the top
          if (a === 'details') return -1;
          if (b === 'details') return 1;
          return String(a).localeCompare(String(b));
        }) as string[];
        
        setSections(uniqueSections);

        // 5. Fetch child objects for tabs
        const { data: childObjectData, error: childObjectError } = await supabase
          .rpc('get_child_objects_for_tabs', {
            p_parent_object_id: objectId,  // Correct parameter!
            p_tenant_id: tenant.id
          });

        if (childObjectError) {
          console.error('⚠️ Warning fetching child objects:', childObjectError);
          setChildObjects([]);
        } else {
          setChildObjects(childObjectData || []);
        }

        // 6. Fetch related list data for each related list block
        const relatedData: {[key: string]: RelatedListData[]} = {};
        
        for (const block of relatedListBlocks) {
          
          if (block.related_list_id) {
            try {
              const { data: relatedListData, error: relatedError } = await supabase
                .rpc('get_related_list_records', {
                  p_parent_object_id: objectId,
                  p_parent_record_id: recordId,
                  p_tenant_id: tenant.id,
                  p_related_list_id: block.related_list_id
                });

              if (relatedError) {
                console.error('⚠️ Warning fetching related list data:', relatedError);
                console.error('⚠️ Error details:', {
                  code: relatedError.code,
                  message: relatedError.message,
                  details: relatedError.details,
                  hint: relatedError.hint
                });
                relatedData[block.id] = [];
              } else {
                relatedData[block.id] = relatedListData || [];
              }
            } catch (err) {
              console.error('⚠️ Error fetching related list data for block:', block.id, err);
              console.error('⚠️ Exception details:', {
                type: typeof err,
                message: err instanceof Error ? err.message : String(err)
              });
              relatedData[block.id] = [];
            }
          } else {
            relatedData[block.id] = [];
          }
        }
        
        setRelatedListData(relatedData);

      } catch (err) {
        console.error('❌ Error in fetchRecordDetail:', err);
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchRecordDetail();
  }, [objectId, recordId, tenant?.id]);


  // NEW: Fetch related list data for a specific block
  const fetchRelatedListDataForBlock = async (blockId: string) => {
    if (!tenant?.id || !recordId || !objectId) {
      return;
    }
    
    try {
      const { data: relatedListData, error: relatedError } = await supabase
        .rpc('get_related_list_records', {
          p_parent_object_id: objectId,
          p_parent_record_id: recordId,
          p_tenant_id: tenant.id,
          p_related_list_id: blockId
        });

      if (relatedError) {
        console.error('❌ Error fetching related list data:', relatedError);
        console.error('❌ Error details:', {
          code: relatedError.code,
          message: relatedError.message,
          details: relatedError.details,
          hint: relatedError.hint
        });
        return;
      }

      // Update the related list data state
      setRelatedListData(prev => ({
        ...prev,
        [blockId]: relatedListData || []
      }));
      
    } catch (error) {
      console.error('💥 Exception fetching related list data:', error);
      console.error('💥 Exception type:', typeof error);
      console.error('💥 Exception message:', error instanceof Error ? error.message : String(error));
    }
  };

  // NEW: Fetch related list data when child object tab is clicked
  useEffect(() => {
    if (activeTab !== 'information' && childObjectTabs.some(tab => tab.id === activeTab)) {
      // Find the related list block for this child object
      const childObjectTab = childObjectTabs.find(tab => tab.id === activeTab);
      if (childObjectTab) {
        const relatedListBlock = layoutBlocks.find(block => 
          block.block_type === 'related_list' && 
          block.related_list_id === childObjectTab.id
        );
        
        if (relatedListBlock && !relatedListData[relatedListBlock.id]) {
          fetchRelatedListDataForBlock(relatedListBlock.id);
        }
        
      }
    }
  }, [activeTab, childObjectTabs, layoutBlocks, relatedListData]);


  // Handle edit mode toggle
  const handleEditToggle = () => {
    if (isEditing) {
      // Cancel editing - restore original values
      setEditingValues(recordData || {});
    }
    setIsEditing(!isEditing);
  };

  // Handle field value change
  const handleFieldChange = (fieldName: string, value: any) => {
    setEditingValues(prev => ({
      ...prev,
      [fieldName]: value
    }));
  };

  // Handle save changes
  const handleSaveChanges = async () => {
    if (!recordData || !tenant?.id) return;

    setSaving(true);
    try {

      // Get the table name from the object
      const { data: objectData, error: objectError } = await supabase
        .rpc('get_tenant_objects', { p_tenant_id: tenant.id });

      if (objectError) {
        throw new Error(`Failed to get object info: ${objectError.message}`);
      }

      const object = objectData?.find((obj: any) => obj.id === objectId);
      if (!object) {
        throw new Error('Object not found');
      }

      // Use the object's name as the table name (not table_name field)
      const tableName = object.name; // This is 'hey_a__a'

      // Log the original editing values for debugging
      console.log('✏️ Original editing values:', editingValues);
      console.log('✏️ Available field metadata:', fieldMetadata.map(f => ({ name: f.name, label: f.label })));
      
      // Debug specific problematic fields
      const problematicFields = ['type', 'type__a', 'ISO standard', 'ISO standard__a'];
      problematicFields.forEach(fieldName => {
        const fieldMeta = fieldMetadata.find(f => f.name === fieldName || f.label === fieldName);
        if (fieldMeta) {
          console.log(`🔍 Field metadata for "${fieldName}":`, { name: fieldMeta.name, label: fieldMeta.label, is_system_field: fieldMeta.is_system_field });
        } else {
          console.log(`❌ No field metadata found for "${fieldName}"`);
        }
      });
      
      // Clean the editing values - remove system fields and empty values
      // CRITICAL FIX: Map display field names to database API names
      const cleanValues = Object.entries(editingValues).reduce((acc, [displayName, value]) => {
        // Skip system fields
        if (displayName === 'id' || displayName === 'tenant_id' || displayName === 'created_at' || displayName === 'updated_at') {
          return acc;
        }
        
        // Skip empty strings, null, and undefined values
        if (value === '' || value === null || value === undefined) {
          return acc;
        }
        
        // Map display name to actual database API name
        let apiName = mapDisplayNameToApiName(displayName, fieldMetadata);
        
        // FALLBACK FIX: If the field name has __a suffix but metadata doesn't, use the __a version
        if (displayName.endsWith('__a') && !apiName.endsWith('__a')) {
          console.log(`🔄 Fallback fix: Using original name with __a suffix: "${displayName}"`);
          apiName = displayName; // Use the original name with __a suffix
        }
        
        // Include only non-empty values with correct API names
        acc[apiName] = value;
        
        // Log the mapping for debugging
        if (displayName !== apiName) {
          console.log(`🔄 Field name mapping: "${displayName}" -> "${apiName}"`);
        } else {
          console.log(`✅ Field name unchanged: "${displayName}"`);
        }
        
        return acc;
      }, {} as RecordData);



      // Validate UUIDs before calling RPC
      if (!recordId || recordId === '') {
        throw new Error('Record ID is empty or invalid');
      }
      if (!tenant.id || tenant.id === '') {
        throw new Error('Tenant ID is empty or invalid');
      }

      // Check if we have any values to update
      if (Object.keys(cleanValues).length === 0) {
        alert('No changes to save');
        setIsEditing(false);
        return;
      }

      // Log the final values being sent to database
      console.log('💾 Saving record with values:', cleanValues);
      console.log('💾 Table name:', tableName);
      console.log('💾 Record ID:', recordId);
      console.log('💾 Tenant ID:', tenant.id);

      // Use the RPC function to update the tenant schema table
      const { error: updateError } = await supabase
        .rpc('update_tenant_record', {
          p_table_name: tableName,
          p_record_id: recordId,
          p_tenant_id: tenant.id,
          p_update_data: cleanValues
        });

      if (updateError) {
        console.error('❌ RPC update error:', updateError);
        console.error('❌ Error details:', {
          code: updateError.code,
          message: updateError.message,
          details: updateError.details,
          hint: updateError.hint
        });
        throw new Error(`Failed to update record: ${updateError.message}`);
      }

      // Check if this is a draft approval that should trigger data copying
      console.log('🔍 === POST-SAVE DRAFT CHECK ===');
      console.log('🔍 ObjectId:', objectId);
      console.log('🔍 RecordId:', recordId);
      console.log('🔍 CleanValues (what was saved):', cleanValues);
      console.log('🔍 EditingValues (current form state):', editingValues);
      console.log('🔍 RecordData (current record data):', recordData);
      console.log('🔍 === APPROVED FIELD ANALYSIS ===');
      console.log('🔍 CleanValues.approved__a:', cleanValues.approved__a);
      console.log('🔍 EditingValues.approved__a:', editingValues.approved__a);
      console.log('🔍 RecordData.approved__a:', recordData?.approved__a);

      const shouldTrigger = await draftToClientService.shouldTriggerDraftApproval(objectId, cleanValues, tenant.id);
      console.log('🔍 Should trigger draft approval:', shouldTrigger);

      if (shouldTrigger) {
        console.log('🎯 Draft approved via inline editing! Triggering data copy...');
        
        try {
          const result = await draftToClientService.handleDraftApproval(
            recordId,
            tenant.id,
            tenant.id, // Using tenant.id as user ID for now, could be improved with actual user context
            objectId // Pass the actual object UUID
          );

          console.log('🔍 Draft approval result:', result);

          if (result.success) {
            alert(`Record updated successfully! ${result.message}`);
          } else {
            console.error('❌ Draft approval failed:', result.message);
            alert('Record updated successfully, but failed to copy data to client. Please check console for details.');
          }
        } catch (draftError) {
          console.error('❌ Error in draft approval process:', draftError);
          alert('Record updated successfully, but there was an error in the draft approval process. Please check console for details.');
        }
      } else {
        console.log('🔍 Not triggering draft approval - conditions not met');
        // Show regular success message
        alert('Record updated successfully!');
      }
      
      // Update local state
      setRecordData(editingValues);
      setIsEditing(false);
      
    } catch (err) {
      console.error('❌ Error saving changes:', err);
      alert(`Failed to save changes: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  // Format field value for display
  const formatFieldValue = (value: any, fieldType: string): string => {
    if (value === null || value === undefined) return '-';
    
    switch (fieldType) {
      case 'boolean':
        return value ? 'Yes' : 'No';
      case 'date':
      case 'timestamptz':
        return new Date(value).toLocaleDateString();
      case 'decimal':
      case 'money':
        return typeof value === 'number' ? value.toLocaleString() : value;
      case 'percent':
        return typeof value === 'number' ? `${value}%` : value;
      default:
        return String(value);
    }
  };

  // Render editable field input - UPDATED to match create modal exactly
  const renderEditableField = (field: FieldMetadata, value: any) => {
    const currentValue = editingValues[field.name] || value || '';
    
    // Handle different field types exactly like the create modal
    if (field.type === 'text' || field.type === 'varchar' || field.type === 'longtext') {
      return (
        <textarea
          value={currentValue}
          onChange={(e) => setEditingValues(prev => ({ ...prev, [field.name]: e.target.value }))}
          className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          rows={field.type === 'longtext' ? 4 : 1}
          placeholder={`Enter ${field.label}`}
          maxLength={field.type === 'varchar' ? 255 : undefined}
        />
      );
    }
    
    if (field.type === 'number' || field.type === 'integer' || field.type === 'decimal' || field.type === 'money' || field.type === 'percent') {
      return (
        <input
          type="number"
          value={currentValue}
          onChange={(e) => setEditingValues(prev => ({ ...prev, [field.name]: e.target.value }))}
          className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          placeholder={`Enter ${field.label}`}
        />
      );
    }
    
    if (field.type === 'date' || field.type === 'timestamptz') {
      // Handle date fields properly - convert to YYYY-MM-DD format for input
      let dateValue = '';
      if (currentValue) {
        try {
          const date = new Date(currentValue);
          if (!isNaN(date.getTime())) {
            dateValue = date.toISOString().split('T')[0];
          }
        } catch (e) {
          console.warn('Invalid date value:', currentValue);
        }
      }
      
      return (
        <input
          type="date"
          value={dateValue}
          onChange={(e) => setEditingValues(prev => ({ ...prev, [field.name]: e.target.value }))}
          className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
        />
      );
    }
    
    if (field.type === 'boolean') {
      return (
        <select
          value={currentValue ? 'true' : 'false'}
          onChange={(e) => setEditingValues(prev => ({ ...prev, [field.name]: e.target.value === 'true' }))}
          className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
        >
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
    }
    
    if (field.type === 'reference' && field.reference_table) {
      return (
        <div className="space-y-2">
          <div className="relative">
            <select
              value={currentValue}
              onChange={(e) => setEditingValues(prev => ({ ...prev, [field.name]: e.target.value }))}
              className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              disabled={!referenceOptions[field.name] || referenceOptions[field.name].length === 0 || referenceLoading[field.name]}
            >
              <option value="">
                {referenceLoading[field.name] 
                  ? 'Loading options...' 
                  : referenceOptions[field.name]?.length === 0 
                    ? 'No options available' 
                    : `Select ${field.label}`
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
      );
    }
    
    if (field.type === 'picklist') {
      return (
        <select
          value={currentValue}
          onChange={(e) => setEditingValues(prev => ({ ...prev, [field.name]: e.target.value }))}
          className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
        >
          <option value="">Select {field.label}</option>
          {picklistOptions[field.name]?.map((option: any) => (
            <option key={option.value} value={option.value}>
              {option.label || option.value}
            </option>
          )) || []}
        </select>
      );
    }
    
    if (field.type === 'autonumber') {
      return (
        <input
          type="text"
          value="Auto-generated"
          readOnly
          className="mt-1 block w-full border-gray-300 rounded-md shadow-sm bg-gray-50 text-gray-500 cursor-not-allowed sm:text-sm"
          title="This field is automatically populated by the system"
        />
      );
    }
    
    // Default fallback for unknown field types
    return (
      <input
        type="text"
        value={currentValue}
        onChange={(e) => setEditingValues(prev => ({ ...prev, [field.name]: e.target.value }))}
        className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
        placeholder={`Enter ${field.label}`}
      />
    );
  };



  // NEW: Navigate to child record detail
  const navigateToChildRecord = (childObjectId: string, childRecordId: string, childObjectLabel: string) => {
    console.log('🔗 Navigating to child record:', {
      childObjectId,
      childRecordId,
      childObjectLabel
    });
    
    // Create a URL that can be used to navigate to the child record
    // Format: /dashboard?objectId={childObjectId}&recordId={childRecordId}&objectLabel={childObjectLabel}
    const searchParams = new URLSearchParams({
      objectId: childObjectId,
      recordId: childRecordId,
      objectLabel: childObjectLabel,
      fromRelatedList: 'true'
    });
    
    const navigationUrl = `/dashboard?${searchParams.toString()}`;
    
    console.log('🔗 Navigation URL:', navigationUrl);
    
    // Navigate to the dashboard with the child record parameters
    window.location.href = navigationUrl;
  };

  // Render related list
  const renderRelatedList = (block: LayoutBlock) => {
    const relatedRecords = relatedListData[block.id] || [];
    const displayColumns = block.display_columns || ['id', 'name']; // Default columns
    

    
    // Find the child object that corresponds to this related list block
    const childObject = childObjects.find(child => {
      // Try to match by object label first
      return child.object_label.toLowerCase() === block.label.toLowerCase();
    });
    
    // Use the child object's label if found, otherwise fall back to block label
    const displayLabel = childObject ? childObject.object_label : block.label;
    
    return (
      <div key={block.id} className="md:col-span-2">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm font-medium text-gray-700">{displayLabel}</h4>
          <button 
            className="text-blue-600 hover:text-blue-800 text-sm font-medium px-3 py-1 border border-blue-300 rounded hover:bg-blue-50"
            onClick={() => console.log('Add record to related list:', displayLabel)}
          >
            + Add Record
          </button>
        </div>
        
        {relatedRecords.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {displayColumns.map(col => {
                    const displayLabel = formatColumnLabel(col);
                    
                    return (
                      <th key={col} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {displayLabel}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {relatedRecords.map((record, recordIndex) => {
                  return (
                    <tr key={record.record_id} className="hover:bg-gray-50">
                                              {displayColumns.map(col => {
                          // Find the field metadata for this column
                          const fieldMeta = fieldMetadata.find(f => f.name === col);
                          
                          const smartValue = getSmartFieldValue(record.record_data, col);
                          
                          return (
                            <td key={col} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {col === 'name' ? (
                                // Make name field a clickable hyperlink
                                <UniversalFieldDisplay
                                  record={record.record_data}
                                  fieldName={col}
                                  fieldValue={getSmartFieldValue(record.record_data, col)}
                                  fieldType={fieldMeta?.type}
                                  referenceTable={fieldMeta?.reference_table || undefined}
                                  referenceDisplayField={fieldMeta?.reference_display_field || undefined}
                                  tenantId={tenant?.id || ''}
                                  recordId={record.record_id}
                                  isClickable={true}
                                  onClick={() => {
                                    // Find the child object for this related list
                                    const childObject = childObjects.find(child => {
                                      // Try to match by object label first
                                      return child.object_label.toLowerCase() === block.label.toLowerCase();
                                    });
                                    
                                    if (childObject) {
                                      navigateToChildRecord(
                                        childObject.object_id,
                                        record.record_id,
                                        childObject.object_label
                                      );
                                    }
                                  }}
                                />
                              ) : (
                                // Regular field display - use universal component
                                <UniversalFieldDisplay
                                  record={record.record_data}
                                  fieldName={col}
                                  fieldValue={getSmartFieldValue(record.record_data, col)}
                                  fieldType={fieldMeta?.type}
                                  referenceTable={fieldMeta?.reference_table || undefined}
                                  referenceDisplayField={fieldMeta?.reference_display_field || undefined}
                                  tenantId={tenant?.id || ''}
                                  recordId={record.record_id}
                                />
                              )}
                            </td>
                          );
                        })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
            <p className="text-sm">No records found in this related list.</p>
            <p className="text-xs mt-1">Click "Add Record" to create one.</p>
          </div>
        )}
      </div>
    );
  };

  // Render tab content based on active tab
  const renderTabContent = () => {
    // Information tab - shows main record details and layout
    if (activeTab === 'information') {
      if (sections.length === 0) {
        return (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex items-center">
              <div className="ml-3">
                <h3 className="text-sm font-medium text-yellow-800">No Page Layout Configured</h3>
                <p className="text-sm text-yellow-700 mt-1">
                  This object doesn't have a page layout configured yet. 
                  Configure the page layout in Object Manager to see fields organized here.
                </p>
              </div>
            </div>
          </div>
        );
      }

      return (
        <div className="p-6 space-y-6">
          {/* Edit Mode Indicator */}
          {isEditing && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-blue-800">Edit Mode</h3>
                  <p className="text-sm text-blue-700 mt-1">
                    You are currently editing this record. Make your changes and click "Save Changes" to save, or "Cancel" to discard changes.
                  </p>
                </div>
              </div>
            </div>
          )}

          {sections.map(section => {
            const sectionBlocks = layoutBlocks.filter(block => block.section === section);
            
            if (sectionBlocks.length === 0) return null;

            return (
              <div key={section} className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4 capitalize">{section}</h3>
                
                {/* Separate editable and system fields */}
                {(() => {
                  const fieldBlocks = sectionBlocks.filter(block => block.block_type === 'field');
                  
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
                    <div className="space-y-4">
                      {/* Editable fields first */}
                      {editableFields.length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {editableFields
                            .sort((a, b) => a.display_order - b.display_order)
                            .map(block => {
                              if (block.block_type === 'field' && block.field_id) {
                                const field = fieldMetadata.find(f => f.id === block.field_id);
                                
                                if (!field) {
                                  return null;
                                }
                                
                                // Get field value from record data using normalized field names
                                const fieldValue = findFieldValue(recordData || {}, field.name);
                                const displayValue = formatFieldValue(fieldValue, field.type);

                                return (
                                  <div 
                                    key={block.id} 
                                    className={`${block.width === 'full' ? 'md:col-span-2' : 'md:col-span-1'}`}
                                  >
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                      {field.label}
                                      {field.is_required && <span className="text-red-500 ml-1">*</span>}
                                      {isEditing && <span className="text-blue-600 ml-1">(Editing)</span>}
                                    </label>
                                    
                                    {isEditing ? (
                                      // Edit mode - show input fields
                                      renderEditableField(field, fieldValue)
                                    ) : (
                                      // View mode - show formatted values
                                      <div className="text-sm text-gray-900 bg-gray-50 px-3 py-2 rounded border">
                                        {displayValue}
                                      </div>
                                    )}
                                  </div>
                                );
                              }
                              
                              return null;
                            })}
                        </div>
                      )}
                      
                      {/* System fields at bottom of section */}
                      {systemFields.length > 0 && (
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                          <h4 className="text-sm font-medium text-gray-700 mb-3">System Fields (Auto-populated)</h4>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {systemFields
                              .sort((a, b) => a.display_order - b.display_order)
                              .map(block => {
                                if (block.block_type === 'field' && block.field_id) {
                                  const field = fieldMetadata.find(f => f.id === block.field_id);
                                  
                                  if (!field) return null;
                                  
                                  // Get field value from record data using normalized field names
                                  const fieldValue = findFieldValue(recordData || {}, field.name);
                                  const displayValue = formatFieldValue(fieldValue, field.type);

                                  return (
                                    <div 
                                      key={block.id} 
                                      className={`${block.width === 'full' ? 'md:col-span-2' : 'md:col-span-1'}`}
                                    >
                                      <label className="block text-sm font-medium text-gray-500 mb-1">
                                        {field.label}
                                      </label>
                                      
                                      <div className="text-sm text-gray-900 bg-white border border-gray-300 rounded-md px-3 py-2">
                                        {displayValue}
                                      </div>
                                    </div>
                                  );
                                }
                                
                                return null;
                              })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      );
    }
    
    // Child object tabs - show related list data for specific child objects
    const childObjectTab = childObjectTabs.find(tab => tab.id === activeTab);
    if (childObjectTab) {
      // Find the related list block for this child object using the mapping
      const relatedListBlock = childObjectToRelatedListMap.get(childObjectTab.id);
      
      if (relatedListBlock) {
        // Check if we have data for this related list
        const relatedRecords = relatedListData[relatedListBlock.id] || [];
        
        return (
          <div className="p-6">
            {/* Render the related list for this child object */}
            {renderRelatedList(relatedListBlock)}
          </div>
        );
      } else {
        // Try to find the related list block by looking at the layout blocks directly
        const directRelatedListBlock = layoutBlocks.find(block => 
          block.block_type === 'related_list' && 
          block.related_list_id === childObjectTab.id
        );
        
        if (directRelatedListBlock) {
          return (
            <div className="p-6">
              {/* Render the related list for this child object */}
              {renderRelatedList(directRelatedListBlock)}
            </div>
          );
        }
        
        return (
          <div className="p-6">
            <div className="text-center py-8 text-gray-500">
              <p className="text-sm">No related list configuration found for {childObjectTab.label}</p>
              <p className="text-xs mt-1">Configure this in Object Manager → Page Layout</p>
            </div>
          </div>
        );
      }
    }
    
    // Fallback for unknown tabs
    return (
      <div className="p-6">
        <div className="text-center py-8 text-gray-500">
          <p className="text-sm">Unknown tab: {activeTab}</p>
        </div>
      </div>
    );
  };

  // Render loading state
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">{recordName}</h2>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-gray-200 rounded w-1/4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          </div>
        </div>
      </div>
    );
  }

  // Render error state
  if (error) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">{recordName}</h2>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <div className="flex items-center">
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">Error Loading Record</h3>
              <p className="text-sm text-red-700 mt-1">{error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // NEW: Render tab navigation
  const renderTabNavigation = () => {
    if (allTabs.length <= 1) {
      return null; // Only show if there are multiple tabs
    }
    
    return (
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          {allTabs.map(tab => {
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                }}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>
    );
  };

  // Main render
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">{recordName}</h2>
        <div className="flex items-center space-x-3">
          {/* Custom Action Buttons */}
          {(() => {
            // Get all button blocks from layout (buttons can be in any section)
            const buttonBlocks = layoutBlocks.filter(block => block.block_type === 'button');
            
            if (buttonBlocks.length === 0) return null;

            return (
              <div className="flex items-center space-x-2 mr-4">
                {buttonBlocks
                  .sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
                  .map(block => {
                    if (block.block_type === 'button' && block.button_id) {
                      const buttonLabel = block.label || 'Button';
                      const buttonDetail = buttonDetails[block.button_id];
                      
                      const handleButtonClick = async () => {
                        let currentButtonDetail = buttonDetail;
                        
                        // If button details are missing, try reloading once
                        if (!currentButtonDetail) {
                          await loadButtonDetails();
                          
                          // Get the updated button details directly from the query result
                          const { data: updatedData, error: updatedError } = await supabase
                            .schema('tenant')
                            .from('button__a')
                            .select('*')
                            .eq('id', block.button_id)
                            .eq('tenant_id', tenant?.id)
                            .single();
                          
                          if (updatedData && !updatedError) {
                            const updatedButtonDetail = {
                              id: updatedData.id,
                              name: updatedData.name__a || updatedData.name,
                              label: updatedData.label__a || updatedData.label,
                              custom_component_path: updatedData.custom_component_path__a || updatedData.custom_component_path,
                              button_type: updatedData.button_type__a || updatedData.button_type,
                              object_id: updatedData.object_id__a || updatedData.object_id,
                              tenant_id: updatedData.tenant_id__a || updatedData.tenant_id
                            };
                            
                            if (updatedButtonDetail.custom_component_path) {
                              setActiveCustomComponent({
                                componentPath: updatedButtonDetail.custom_component_path,
                                buttonDetail: updatedButtonDetail
                              });
                            } else {
                              alert(`Button "${buttonLabel}" clicked! This button doesn't have a custom component configured.`);
                            }
                          } else {
                            alert(`Button "${buttonLabel}" clicked! Button details not loaded.`);
                          }
                          return;
                        }
                        
                        if (currentButtonDetail) {
                          if (currentButtonDetail.custom_component_path) {
                            setActiveCustomComponent({
                              componentPath: currentButtonDetail.custom_component_path,
                              buttonDetail: currentButtonDetail
                            });
                          } else {
                            alert(`Button "${buttonLabel}" clicked! This button doesn't have a custom component configured.`);
                          }
                        } else {
                          alert(`Button "${buttonLabel}" clicked! Button details not loaded yet.`);
                        }
                      };

                      return (
                        <button
                          key={block.id}
                          onClick={handleButtonClick}
                          className="px-3 py-2 text-sm font-medium rounded-md transition-colors bg-blue-600 hover:bg-blue-700 text-white"
                          title={`Button: ${buttonLabel}`}
                        >
                          {buttonLabel}
                        </button>
                      );
                    }
                    
                    return null;
                  })}
              </div>
            );
          })()}

          {/* Edit/Save/Cancel Buttons */}
          {isEditing ? (
            <>
              <button
                onClick={handleSaveChanges}
                disabled={saving}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                onClick={handleEditToggle}
                disabled={saving}
                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={handleEditToggle}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium"
            >
              Edit Record
            </button>
          )}
          
          <button
            onClick={onBackToList}
            className="text-gray-600 hover:text-gray-900 text-sm font-medium"
          >
            ← Back to List
          </button>
        </div>
      </div>

      {/* NEW: Tab Navigation */}
      {renderTabNavigation()}

      {/* Tab Content */}
      <div className="bg-white rounded-lg border border-gray-200">
        {renderTabContent()}
      </div>

      {/* Custom Component Modal */}
      {activeCustomComponent && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black bg-opacity-50 transition-opacity" onClick={() => setActiveCustomComponent(null)}></div>
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative w-full max-w-4xl max-h-[90vh] bg-white rounded-lg shadow-xl">
              {/* Modal Header with title and close button */}
              <div className="flex items-center justify-between p-6 border-b border-gray-200">
                <h3 className="text-xl font-semibold text-gray-900">
                  {activeCustomComponent.buttonDetail.label || activeCustomComponent.buttonDetail.name || 'Custom Component'}
                </h3>
                <button 
                  onClick={() => setActiveCustomComponent(null)}
                  className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-full hover:bg-gray-100"
                  title="Close"
                >
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              {/* Modal Content */}
              <div className="overflow-y-auto max-h-[calc(90vh-80px)]">
                <React.Suspense fallback={
                  <div className="flex items-center justify-center p-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    <span className="ml-2 text-gray-600">Loading component...</span>
                  </div>
                }>
                  <CustomTabRenderer
                    componentPath={activeCustomComponent.componentPath}
                    tabId={`button_${activeCustomComponent.buttonDetail.id}`}
                    tabLabel={activeCustomComponent.buttonDetail.label || activeCustomComponent.buttonDetail.name || 'Custom Component'}
                    recordId={recordId}
                    objectId={objectId}
                    recordData={recordData}
                    tenantId={tenant?.id}
                  />
                </React.Suspense>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}