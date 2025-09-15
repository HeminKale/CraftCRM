'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useSupabase } from '../../providers/SupabaseProvider';
import Message from '../ui/Message';
import LayoutSection from './LayoutSection';
import FieldPool from './FieldPool';
import RelatedListConfigModal from './RelatedListConfigModal';
import RelatedListsSection from './RelatedListsSection';

// Types
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
  // New properties for related list support
  tab_type?: 'main' | 'related_list';
  display_columns?: string[];
}

// Section type system for better organization
export type SectionType = 'field' | 'related_list' | 'mixed';

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

// Drag and drop item types
export const ItemTypes = {
  LAYOUT_BLOCK: 'layout_block',
  FIELD: 'field',
  RELATED_LIST: 'related_list',
  BUTTON: 'button'
};


export interface Button {
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

interface ObjectLayoutEditorProps {
  selectedObject: string | null;
  fieldMetadata: FieldMetadata[];
  relatedLists: RelatedList[];
  buttons: Button[]; // Add buttons prop
  onLayoutChange: () => void;
  getFieldIcon: (dataType: string, isReference?: boolean) => string;
  handleEditField: (field: FieldMetadata) => void;
  isSystemField: (apiName: string) => boolean;
  onEditRelatedList: (relatedList: RelatedList) => void;
  onDeleteRelatedList: (relatedListId: string, label: string) => void;
  onAddRelatedList: () => void;
  tenantId: string;
}

export default function ObjectLayoutEditor({
  selectedObject,
  fieldMetadata,
  relatedLists,
  buttons,
  onLayoutChange,
  getFieldIcon,
  handleEditField,
  isSystemField,
  onEditRelatedList,
  onDeleteRelatedList,
  onAddRelatedList,
  tenantId,
}: ObjectLayoutEditorProps) {
  const { tenant } = useSupabase();
  const supabase = createClientComponentClient();
  
  // Log when component mounts to verify DnD context
  useEffect(() => {
    console.log('🔧 ObjectLayoutEditor: Component mounted - DnD context should be available');
    console.log('🔧 ObjectLayoutEditor: Props received:', { selectedObject, fieldMetadataLength: fieldMetadata.length, relatedListsLength: relatedLists.length });
  }, []);
  
  const [layoutBlocks, setLayoutBlocks] = useState<LayoutBlock[]>([]);
  const [customLayoutSections, setCustomLayoutSections] = useState<string[]>([]);
  const [sectionTypes, setSectionTypes] = useState<Record<string, SectionType>>({
    'details': 'field',
    'related_lists': 'related_list'
  }); // Store section types with system defaults
  const [sectionOrder, setSectionOrder] = useState<string[]>(['details', 'related_lists']); // Add section order state
  const [fieldPoolSearchQuery, setFieldPoolSearchQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [showCreateSectionModal, setShowCreateSectionModal] = useState(false);
  const [newSection, setNewSection] = useState({ name: '', type: 'field' as SectionType });
  const [editingSection, setEditingSection] = useState<string | null>(null);

  // Related list state variables
  const [showRelatedListModal, setShowRelatedListModal] = useState(false);
  const [selectedSectionForRelatedList, setSelectedSectionForRelatedList] = useState<string>('details');
  const [showRelatedListConfigModal, setShowRelatedListConfigModal] = useState(false);
  const [selectedRelatedList, setSelectedRelatedList] = useState<RelatedList | null>(null);
  const [selectedLayoutBlockForConfig, setSelectedLayoutBlockForConfig] = useState<LayoutBlock | null>(null);

  // Fetch layout blocks when object changes
  useEffect(() => {
    if (selectedObject && tenant?.id) {
      fetchLayoutBlocks(selectedObject);
    }
  }, [selectedObject, tenant?.id]);

  const fetchLayoutBlocks = async (objectId: string) => {
    try {
      const { data, error } = await supabase.rpc('get_layout_blocks', {
        p_object_id: objectId,
        p_tenant_id: tenant!.id
      });

      if (error) {
        console.error('Error fetching layout blocks:', error);
        
        // Provide specific error messages based on error codes
        let errorMessage = 'Failed to load layout configuration.';
        
        if (error.code === 'PGRST116') {
          errorMessage = 'Access denied. You do not have permission to view this object layout.';
        } else if (error.code === 'PGRST301') {
          errorMessage = 'Object not found or has been deleted.';
        } else if (error.code === 'PGRST400') {
          errorMessage = 'Invalid request. Please check the object ID.';
        } else if (error.code === 'NETWORK_ERROR') {
          errorMessage = 'Network error. Please check your connection and try again.';
        } else if (error.code === 'TIMEOUT') {
          errorMessage = 'Request timed out. Please try again.';
        } else if (error.message) {
          errorMessage = `Error: ${error.message}`;
        }
        
        setMessage({ text: errorMessage, type: 'error' });
        setLayoutBlocks([]);
        return;
      }

      setLayoutBlocks(data || []);
      
      // Extract custom sections from layout blocks, excluding system sections
      if (data) {
        const systemSections = ['details', 'related_lists'];
        const customSections: string[] = Array.from(new Set(data
          .map(block => block.section)
          .filter((section): section is string => section && !systemSections.includes(section))
        ));
        setCustomLayoutSections(customSections);
        
        // Set section order: system sections first, then custom sections
        const allSections = [...systemSections, ...customSections];
        setSectionOrder(allSections);
      }
    } catch (err: any) {
      console.error('Error fetching layout blocks:', err);
      
      // Provide user-friendly error messages for unexpected errors
      let errorMessage = 'An unexpected error occurred while loading the layout.';
      
      if (err.message) {
        errorMessage = err.message;
      } else if (err.code) {
        switch (err.code) {
          case 'NETWORK_ERROR':
            errorMessage = 'Network error. Please check your connection and try again.';
            break;
          case 'TIMEOUT':
            errorMessage = 'Request timed out. Please try again.';
            break;
          default:
            errorMessage = `Error (${err.code}): ${err.message || 'Unknown error'}`;
        }
      }
      
      setMessage({ text: errorMessage, type: 'error' });
      setLayoutBlocks([]);
    }
  };

  const handleSaveLayout = async () => {
    if (!selectedObject || !tenant?.id) {
      setMessage({ text: 'No object selected or tenant not available', type: 'error' });
      return;
    }

    setSaving(true);
    setMessage(null);
    
    try {
      // Verify we can fetch layout blocks for this object (this will validate access)
      const { data: existingBlocks, error: fetchError } = await supabase.rpc('get_layout_blocks', {
        p_object_id: selectedObject,
        p_tenant_id: tenant.id
      });

      if (fetchError) {
        console.error('Error fetching existing layout blocks:', fetchError);
        if (fetchError.code === 'PGRST116') {
          throw new Error('Access denied. You do not have permission to modify this object layout.');
        } else if (fetchError.code === 'PGRST301') {
          throw new Error('Object not found or has been deleted.');
        } else {
          throw new Error(`Cannot access this object: ${fetchError.message || 'Please check your permissions.'}`);
        }
      }

      const layoutToSave = layoutBlocks.map(b => ({
        block_type: b.block_type,
        field_id: b.block_type === 'field' ? b.field_id : null,
        related_list_id: b.block_type === 'related_list' ? b.related_list_id : null,
        button_id: b.block_type === 'button' ? b.button_id : null,
        label: b.label,
        section: b.section,
        display_order: b.display_order,
        width: b.width || 'half',
        is_visible: b.is_visible
      }));

      console.log('Saving layout for object:', selectedObject);
      console.log('Tenant ID:', tenant.id);
      console.log('Layout data:', layoutToSave);
      console.log('Section order:', sectionOrder); // Log section order for debugging

      const { data: savedBlocks, error } = await supabase.rpc('update_layout_blocks', {
        p_object_id: selectedObject as string,
        p_tenant_id: tenant.id,
        p_layout_blocks: layoutToSave
      });

      if (error) {
        if (error.code === 'PGRST116') {
          throw new Error('Access denied. You do not have permission to save layout changes.');
        } else if (error.code === 'PGRST301') {
          throw new Error('Object not found or has been deleted.');
        } else if (error.code === 'PGRST400') {
          throw new Error('Invalid layout data. Please check your configuration.');
        } else {
          throw error;
        }
      }

      // TODO: In future, save section order to database
      // For now, section order is maintained in component state
      // This could be enhanced with a separate RPC function or metadata field

      // NEW: Save related list display_columns configurations
      for (const block of layoutBlocks) {
        if (block.block_type === 'related_list' && block.related_list_id && block.display_columns) {
          console.log('Saving related list configuration:', {
            related_list_id: block.related_list_id,
            display_columns: block.display_columns
          });
          
          // Use the new database function instead of direct table update
          const { error: relatedListError } = await supabase.rpc('update_related_list_display_columns', {
            p_related_list_id: block.related_list_id,
            p_display_columns: block.display_columns,
            p_tenant_id: tenant.id
          });

          if (relatedListError) {
            console.error('Error saving related list configuration:', relatedListError);
            // Don't throw error here - layout was saved successfully
            // Just log it and continue
          } else {
            console.log('✅ Related list configuration saved successfully');
          }
        }
      }

      if (savedBlocks) {
        setLayoutBlocks(savedBlocks);
      } else {
        await fetchLayoutBlocks(selectedObject);
      }
      
      onLayoutChange();
      setMessage({ text: 'Layout saved successfully!', type: 'success' });
      
      setTimeout(() => setMessage(null), 5000);
    } catch (err: any) {
      console.error('Error saving layout:', err);
      
      // Provide user-friendly error messages
      let errorMessage = 'An unexpected error occurred while saving the layout.';
      
      if (err.message) {
        errorMessage = err.message;
      } else if (err.code) {
        switch (err.code) {
          case 'NETWORK_ERROR':
            errorMessage = 'Network error. Please check your connection and try again.';
            break;
          case 'TIMEOUT':
            errorMessage = 'Request timed out. Please try again.';
            break;
          default:
            errorMessage = `Error (${err.code}): ${err.message || 'Unknown error'}`;
        }
      }
      
      setMessage({ 
        text: errorMessage, 
        type: 'error' 
      });
    } finally {
      setSaving(false);
    }
  };

  const moveBlock = useCallback(
    (draggedId: string, hoverId: string, draggedSection: string, hoverSection: string) => {
      setLayoutBlocks((prevBlocks) => {
        const draggedBlock = prevBlocks.find((block) => block.id === draggedId);
        if (!draggedBlock) {
          return prevBlocks;
        }

        // Create a copy of the dragged block with its updated section
        const updatedDraggedBlock = { ...draggedBlock, section: hoverSection };

        // Filter out the dragged block from its original position
        let newBlocks = prevBlocks.filter((block) => block.id !== draggedId);

        // Find the index to insert the dragged block
        let insertIndex = -1;
        if (hoverId) {
          insertIndex = newBlocks.findIndex((block) => block.id === hoverId);
        }

        if (insertIndex > -1) {
          newBlocks.splice(insertIndex, 0, updatedDraggedBlock);
        } else {
          // If no hoverId, or hoverId not found, add to the end of the hoverSection
          const lastIndexInHoverSection = newBlocks.reduce((latestIndex, block, idx) => {
            if (block.section === hoverSection) {
              return idx;
            }
            return latestIndex;
          }, -1);
          
          if (lastIndexInHoverSection > -1) {
            newBlocks.splice(lastIndexInHoverSection + 1, 0, updatedDraggedBlock);
          } else {
            // If hoverSection is empty or not found, just push it to the end of the array
            newBlocks.push(updatedDraggedBlock);
          }
        }

        // Re-assign display_order based on their position
        const reorderedBlocks = newBlocks.map((block, index) => ({
          ...block,
          display_order: index,
        }));

        return reorderedBlocks;
      });
    },
    [],
  );

  const addFieldToLayout = (field: FieldMetadata, section: string) => {
    console.log('🔧 === ADD FIELD TO LAYOUT CALLED ===');
    console.log('🔧 Field:', field);
    console.log('🔧 Section:', section);
    console.log('🔧 Selected object:', selectedObject);
    console.log('🔧 Current layout blocks:', layoutBlocks);
    
    // Validate inputs
    if (!field || !field.id || !field.display_label) {
      console.log('❌ Field validation failed');
      setMessage({ 
        text: 'Invalid field data. Please try again.', 
        type: 'error' 
      });
      return;
    }
    
    if (!section || !selectedObject) {
      console.log('❌ Section or object validation failed');
      setMessage({ 
        text: 'Invalid section or object selection.', 
        type: 'error' 
      });
      return;
    }

    const newBlock: LayoutBlock = {
      id: `temp-${Date.now()}-${Math.random()}`,
      object_id: selectedObject,
      block_type: 'field',
      field_id: field.id,
      label: field.display_label,
      section: section,
      display_order: layoutBlocks.filter(b => b.section === section).length,
      width: field.width || 'half',
      is_visible: true,
      tab_type: 'main',
      display_columns: []
    };
    
    console.log('🔧 New block created:', newBlock);
    setLayoutBlocks(prev => {
      const newBlocks = [...prev, newBlock];
      console.log('🔧 Updated layout blocks:', newBlocks);
      return newBlocks;
    });
    console.log('✅ Field added successfully');
  };

  const getAvailableRelatedLists = useCallback(() => {
    // Get related lists that are not already in the layout
    const usedRelatedListIds = layoutBlocks
      .filter(block => block.block_type === 'related_list')
      .map(block => block.related_list_id)
      .filter(Boolean);
    
    return relatedLists.filter(rl => !usedRelatedListIds.includes(rl.id));
  }, [layoutBlocks, relatedLists]);

  const getAvailableButtons = useCallback(() => {
    // Get buttons that are not already in the header
    const usedButtonIds = layoutBlocks
      .filter(block => block.block_type === 'button' && block.section === 'header')
      .map(block => block.button_id)
      .filter(Boolean);
    
    return buttons.filter(btn => !usedButtonIds.includes(btn.id));
  }, [layoutBlocks, buttons]);

  const getRelatedListsInSection = useCallback(() => {
    // Get related list blocks that are in the 'related_lists' section
    return layoutBlocks.filter(block => 
      block.block_type === 'related_list' && block.section === 'related_lists'
    );
  }, [layoutBlocks]);

  const addRelatedListToLayout = (relatedList: RelatedList, section: string) => {
    // Validate inputs
    if (!relatedList || !relatedList.id) {
      setMessage({ 
        text: 'Invalid related list data. Please try again.', 
        type: 'error' 
      });
      return;
    }
    
    if (!section || !selectedObject) {
      setMessage({ 
        text: 'Invalid section or object selection.', 
        type: 'error' 
      });
      return;
    }

    // Check if this related list is already in the layout
    const isAlreadyInLayout = layoutBlocks.some(
      block => block.block_type === 'related_list' && block.related_list_id === relatedList.id
    );
    
    if (isAlreadyInLayout) {
      setMessage({ text: `Related list "${relatedList.label}" is already in the layout.`, type: 'info' });
      return;
    }

    let friendlyLabel = relatedList.label;
    if (!friendlyLabel) {
      friendlyLabel = relatedList.label || `Related ${relatedList.child_table}`;
    }
    
    const newBlock: LayoutBlock = {
      id: `temp-${Date.now()}-${Math.random()}`,
      object_id: selectedObject,
      block_type: 'related_list',
      related_list_id: relatedList.id,
      label: friendlyLabel,
      section: section,
      display_order: layoutBlocks.filter(b => b.section === section).length,
      width: 'full',
      is_visible: true,
      tab_type: 'related_list',
      display_columns: ['id', 'name']
    };
    
    setLayoutBlocks(prev => [...prev, newBlock]);
    
    // Automatically open configuration modal for newly added related lists
    // This provides immediate configuration opportunity for better UX
    setTimeout(() => {
      setSelectedRelatedList(relatedList);
      setSelectedLayoutBlockForConfig(newBlock);
      setShowRelatedListConfigModal(true);
    }, 100); // Small delay to ensure state updates are processed
  };

  const addButtonToLayout = (button: Button, section: string) => {
    console.log('🔧 === ADD BUTTON TO LAYOUT CALLED ===');
    console.log('🔧 Button:', button);
    console.log('🔧 Section:', section);
    console.log('🔧 Selected object:', selectedObject);
    
    // Validate inputs
    if (!button || !button.id) {
      console.log('❌ Button validation failed');
      setMessage({ 
        text: 'Invalid button data. Please try again.', 
        type: 'error' 
      });
      return;
    }
    
    if (!section || !selectedObject) {
      console.log('❌ Section or object validation failed');
      setMessage({ 
        text: 'Invalid section or object selection.', 
        type: 'error' 
      });
      return;
    }

    // Check if this button is already in the layout
    const isAlreadyInLayout = layoutBlocks.some(
      block => block.block_type === 'button' && block.button_id === button.id
    );
    
    if (isAlreadyInLayout) {
      setMessage({ text: `Button "${button.label || button.name}" is already in the layout.`, type: 'info' });
      return;
    }

    const newBlock: LayoutBlock = {
      id: `temp-${Date.now()}-${Math.random()}`,
      object_id: selectedObject,
      block_type: 'button',
      button_id: button.id,
      label: button.label || button.name,
      section: section,
      display_order: layoutBlocks.filter(b => b.section === section).length,
      width: 'half',
      is_visible: true,
      tab_type: 'main',
      display_columns: []
    };
    
    console.log('🔧 New button block created:', newBlock);
    setLayoutBlocks(prev => {
      const newBlocks = [...prev, newBlock];
      console.log('🔧 Updated layout blocks:', newBlocks);
      return newBlocks;
    });
    console.log('✅ Button added successfully');
  };

  // Handle adding related list to a specific section
  const handleAddRelatedListToSection = (section: string) => {
    setSelectedSectionForRelatedList(section);
    setShowRelatedListModal(true);
  };

  // Handle related list configuration
  const handleOpenRelatedListConfig = (layoutBlock: LayoutBlock) => {
    const relatedList = relatedLists.find(rl => rl.id === layoutBlock.related_list_id);
    if (relatedList) {
      setSelectedRelatedList(relatedList);
      setSelectedLayoutBlockForConfig(layoutBlock);
      setShowRelatedListConfigModal(true);
    }
  };

  // Save related list configuration
  const handleSaveRelatedListConfig = (blockId: string, displayColumns: string[], customLabel?: string) => {
    // Validate inputs
    if (!blockId) {
      setMessage({ 
        text: 'Invalid block ID. Please try again.', 
        type: 'error' 
      });
      return;
    }
    
    if (!displayColumns || displayColumns.length === 0) {
      setMessage({ 
        text: 'Please select at least one display column.', 
        type: 'error' 
      });
      return;
    }
    
    if (customLabel && customLabel.trim().length === 0) {
      setMessage({ 
        text: 'Custom label cannot be empty. Please enter a valid label or leave it blank.', 
        type: 'error' 
      });
      return;
    }

    setLayoutBlocks(prev => prev.map(block => {
      if (block.id === blockId) {
        return {
          ...block,
          label: customLabel?.trim() || block.label,
          display_columns: displayColumns
        };
      }
      return block;
    }));
    setShowRelatedListConfigModal(false);
    setSelectedRelatedList(null);
    setSelectedLayoutBlockForConfig(null);
    
    setMessage({ 
      text: 'Related list configuration saved successfully!', 
      type: 'success' 
    });
  };

  const removeBlockFromLayout = (blockId: string) => {
    const block = layoutBlocks.find(b => b.id === blockId);
    if (block) {
      setLayoutBlocks(prev => prev.filter(b => b.id !== blockId));
      setMessage({ 
        text: `Removed ${block.block_type === 'field' ? 'field' : 'related list'} "${block.label}" from layout.`, 
        type: 'success' 
      });
    } else {
      setMessage({ 
        text: 'Block not found. It may have already been removed.', 
        type: 'info' 
      });
    }
  };

  const handleAddLayoutSection = () => {
    const sectionName = newSection.name.trim().toLowerCase();
    const reservedSections = ['details', 'related_lists'];
    
    if (sectionName && 
        !customLayoutSections.some(section => section.toLowerCase() === sectionName) &&
        !reservedSections.includes(sectionName)) {
      
      // Validate section type restrictions
      if (newSection.type === 'related_list') {
        // Related list sections can only contain related lists
        setCustomLayoutSections(prev => [...prev, sectionName]);
        setSectionOrder(prev => [...prev, sectionName]); // Add to section order
        setSectionTypes(prev => ({ ...prev, [sectionName]: 'related_list' })); // Store section type
        setNewSection({ name: '', type: 'field' });
        setShowCreateSectionModal(false);
        setMessage({ 
          text: `Created '${sectionName}' section for related lists only.`, 
          type: 'success' 
        });
      } else if (newSection.type === 'field') {
        // Field sections can only contain fields
        setCustomLayoutSections(prev => [...prev, sectionName]);
        setSectionOrder(prev => [...prev, sectionName]); // Add to section order
        setSectionTypes(prev => ({ ...prev, [sectionName]: 'field' })); // Store section type
        setNewSection({ name: '', type: 'field' });
        setShowCreateSectionModal(false);
        setMessage({ 
          text: `Created '${sectionName}' section for fields only.`, 
          type: 'success' 
        });
      } else if (newSection.type === 'mixed') {
        // Mixed sections can contain both fields and related lists
        setCustomLayoutSections(prev => [...prev, sectionName]);
        setSectionOrder(prev => [...prev, sectionName]); // Add to section order
        setSectionTypes(prev => ({ ...prev, [sectionName]: 'mixed' })); // Store section type
        setNewSection({ name: '', type: 'field' });
        setShowCreateSectionModal(false);
        setMessage({ 
          text: `Created '${sectionName}' section for fields and related lists.`, 
          type: 'success' 
        });
      }
    } else if (reservedSections.includes(sectionName)) {
      setMessage({ 
        text: `Cannot create section with reserved name '${sectionName}'. This is a system section.`, 
        type: 'error' 
      });
    } else if (customLayoutSections.some(section => section.toLowerCase() === sectionName)) {
      setMessage({ 
        text: `Section '${sectionName}' already exists.`, 
        type: 'error' 
      });
    }
  };

  const handleRemoveLayoutSection = (sectionToRemove: string) => {
    const reservedSections = ['details', 'related_lists'];
    
    if (reservedSections.includes(sectionToRemove)) {
      setMessage({ 
        text: `Cannot remove the '${sectionToRemove}' section. This is a system section.`, 
        type: 'error' 
      });
      return;
    }
    
    if (confirm(`Are you sure you want to remove the section '${sectionToRemove}'? This will move all blocks in this section to the 'details' section.`)) {
      setCustomLayoutSections(prev => prev.filter(s => s !== sectionToRemove));
      setSectionOrder(prev => prev.filter(s => s !== sectionToRemove)); // Remove from section order
      setSectionTypes(prev => {
        const newTypes = { ...prev };
        delete newTypes[sectionToRemove]; // Clean up section type
        return newTypes;
      });
      // Move blocks from the removed section to 'details'
      setLayoutBlocks(prev => prev.map(block =>
        block.section === sectionToRemove ? { ...block, section: 'details' } : block
      ));
    }
  };

  const handleUpdateSectionName = () => {
    if (!editingSection || !newSection.name.trim()) return;

    const oldName = editingSection;
    const newName = newSection.name.trim().toLowerCase();
    const reservedSections = ['details', 'related_lists'];

    // Do nothing if the name hasn't changed or the new name already exists
    if (oldName === newName || customLayoutSections.includes(newName)) {
      setEditingSection(null);
      setShowCreateSectionModal(false);
      setNewSection({ name: '', type: 'field' });
      return;
    }

    // Prevent renaming to reserved section names
    if (reservedSections.includes(newName)) {
      setMessage({ 
        text: `Cannot rename section to '${newName}'. This is a reserved system section name.`, 
        type: 'error' 
      });
      return;
    }

    // 1. Update the customLayoutSections array
    setCustomLayoutSections(prevSections =>
      prevSections.map(section => section === oldName ? newName : section)
    );
    
    // 2. Update the section order
    setSectionOrder(prevOrder =>
      prevOrder.map(section => section === oldName ? newName : section)
    );
    
    // 3. Update the section types (preserve the type)
    setSectionTypes(prevTypes => {
      const newTypes = { ...prevTypes };
      if (newTypes[oldName]) {
        newTypes[newName] = newTypes[oldName]; // Preserve section type
        delete newTypes[oldName]; // Remove old name
      }
      return newTypes;
    });
    
    // 4. Update all layout blocks that reference the old section name
    setLayoutBlocks(prevBlocks =>
      prevBlocks.map(block =>
        block.section === oldName ? { ...block, section: newName } : block
      )
    );

    setMessage({ 
      text: `Section renamed from '${oldName}' to '${newName}'.`, 
      type: 'success' 
    });
    
    setEditingSection(null);
    setShowCreateSectionModal(false);
    setNewSection({ name: '', type: 'field' });
  };

  // Section reordering functions
  const moveSection = (draggedSection: string, targetSection: string) => {
    if (draggedSection === targetSection) return;
    
    const reservedSections = ['details', 'related_lists'];
    
    // Don't allow moving reserved sections
    if (reservedSections.includes(draggedSection)) {
      setMessage({
        text: `Cannot reorder the '${draggedSection}' section. This is a system section.`,
        type: 'error'
      });
      return;
    }
    
    // Don't allow moving sections to before reserved sections
    if (reservedSections.includes(targetSection)) {
      setMessage({
        text: `Cannot move sections before system sections.`,
        type: 'error'
      });
      return;
    }

    setSectionOrder(prevOrder => {
      const newOrder = [...prevOrder];
      const draggedIndex = newOrder.indexOf(draggedSection);
      const targetIndex = newOrder.indexOf(targetSection);
      
      if (draggedIndex === -1 || targetIndex === -1) return prevOrder;
      
      // Remove dragged section from its current position
      newOrder.splice(draggedIndex, 1);
      
      // Insert at target position
      newOrder.splice(targetIndex, 0, draggedSection);
      
      return newOrder;
    });

    setMessage({
      text: `Moved '${draggedSection}' section.`,
      type: 'success'
    });
  };

  const moveSectionUp = (sectionName: string) => {
    const reservedSections = ['details', 'related_lists'];
    if (reservedSections.includes(sectionName)) {
      setMessage({
        text: `Cannot reorder the '${sectionName}' section. This is a system section.`,
        type: 'error'
      });
      return;
    }

    setSectionOrder(prevOrder => {
      const newOrder = [...prevOrder];
      const currentIndex = newOrder.indexOf(sectionName);
      
      if (currentIndex <= 0) return prevOrder;
      
      // Find the previous non-reserved section
      let prevIndex = currentIndex - 1;
      while (prevIndex >= 0 && reservedSections.includes(newOrder[prevIndex])) {
        prevIndex--;
      }
      
      if (prevIndex >= 0) {
        // Swap positions
        [newOrder[currentIndex], newOrder[prevIndex]] = [newOrder[prevIndex], newOrder[currentIndex]];
      }
      
      return newOrder;
    });
  };

  const moveSectionDown = (sectionName: string) => {
    const reservedSections = ['details', 'related_lists'];
    if (reservedSections.includes(sectionName)) {
      setMessage({
        text: `Cannot reorder the '${sectionName}' section. This is a system section.`,
        type: 'error'
      });
      return;
    }

    setSectionOrder(prevOrder => {
      const newOrder = [...prevOrder];
      const currentIndex = newOrder.indexOf(sectionName);
      
      if (currentIndex === -1 || currentIndex >= newOrder.length - 1) return prevOrder;
      
      // Find the next non-reserved section
      let nextIndex = currentIndex + 1;
      while (nextIndex < newOrder.length && reservedSections.includes(newOrder[nextIndex])) {
        nextIndex++;
      }
      
      if (nextIndex < newOrder.length) {
        // Swap positions
        [newOrder[currentIndex], newOrder[nextIndex]] = [newOrder[nextIndex], newOrder[currentIndex]];
      }
      
      return newOrder;
    });
  };

  // Get fields that are not in any layout section
  const getAvailableFields = useCallback(() => {
    const usedFieldIds = layoutBlocks
      .filter(block => block.block_type === 'field')
      .map(block => block.field_id);
    const available = fieldMetadata.filter(field => !usedFieldIds.includes(field.id));
    
    // Check for duplicates in fieldMetadata
    const fieldIds = fieldMetadata.map(f => f.id);
    const uniqueFieldIds = Array.from(new Set(fieldIds));
    if (fieldIds.length !== uniqueFieldIds.length) {
      console.warn('⚠️ Duplicate fields detected in fieldMetadata:', {
        totalFields: fieldIds.length,
        uniqueFields: uniqueFieldIds.length,
        duplicates: fieldIds.filter((id, index) => fieldIds.indexOf(id) !== index)
      });
    }
    
    return available;
  }, [layoutBlocks, fieldMetadata]);

  // Helper function to determine section type based on content
  const getSectionType = useCallback((sectionName: string): SectionType => {
    // Prioritize the stored type if available
    if (sectionTypes[sectionName]) {
      return sectionTypes[sectionName];
    }

    // Fallback to analyzing content if type is not stored
    const sectionBlocks = layoutBlocks.filter(block => block.section === sectionName);
    
    if (sectionBlocks.length === 0) {
      // New section with no blocks - check if it was created as a specific type
      // For now, we'll default to 'field' for backward compatibility
      // In the future, we could store the section type in the database
      return 'field';
    }
    
    const hasFields = sectionBlocks.some(block => block.block_type === 'field');
    const hasRelatedLists = sectionBlocks.some(block => block.block_type === 'related_list');
    
    let detectedType: SectionType;
    if (hasFields && hasRelatedLists) detectedType = 'mixed';
    else if (hasRelatedLists) detectedType = 'related_list';
    else detectedType = 'field';
    
    return detectedType;
  }, [layoutBlocks, sectionTypes]);

  // Enhanced drop zone logic with section type validation
  const handleDropFromPool = (dropResult: any) => {
    const targetSection = dropResult.targetSection;
    const sectionType = getSectionType(targetSection);
    
    if (dropResult.type === 'field' && dropResult.field) {
      // Fields can only be dropped in field or mixed sections
      if (sectionType === 'related_list') {
        setMessage({
          text: `Fields cannot be dropped in the '${targetSection}' section. This section is restricted to related lists only.`,
          type: 'error'
        });
        return;
      }
      addFieldToLayout(dropResult.field, targetSection);
    } else if (dropResult.type === 'relatedList' && dropResult.relatedList) {
      // Related lists can only be dropped in related_list or mixed sections
      if (sectionType === 'field') {
        setMessage({
          text: `Related lists cannot be dropped in the '${targetSection}' section. This section is restricted to fields only.`,
          type: 'error'
        });
        return;
      }
      addRelatedListToLayout(dropResult.relatedList, targetSection);
    } else if (dropResult.type === 'button' && dropResult.button) {
      // Buttons are automatically added to the header when added to layout
      addButtonToLayout(dropResult.button, 'header');
      setMessage({
        text: `Button "${dropResult.button.label || dropResult.button.name}" added to record header.`,
        type: 'success'
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-bold text-gray-900">Page Layout</h3>
        <button 
          onClick={handleSaveLayout} 
          disabled={saving}
          className="px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving...' : 'Save Layout'}
        </button>
      </div>

      {/* Message Display */}
      {message && (
        <Message
          message={message.text}
          type={message.type}
          onDismiss={() => setMessage(null)}
          autoDismiss={message.type === 'success'}
          dismissDelay={5000}
        />
      )}
      
      {/* Field Pool */}
      <FieldPool
        availableFields={useMemo(() => getAvailableFields(), [getAvailableFields])}
        availableRelatedLists={useMemo(() => getAvailableRelatedLists(), [getAvailableRelatedLists])}
        availableButtons={useMemo(() => getAvailableButtons(), [getAvailableButtons])}
        searchQuery={fieldPoolSearchQuery}
        onSearchChange={useCallback(setFieldPoolSearchQuery, [])}
        getFieldIcon={getFieldIcon}
        onAddField={useCallback(addFieldToLayout, [])}
        onAddRelatedList={useCallback(addRelatedListToLayout, [])}
        onAddButton={useCallback(addButtonToLayout, [])}
        availableSections={sectionOrder}
        sectionTypes={sectionTypes}
      />
      
      <div className="space-y-4">
        {/* Section Order Indicator */}
        {sectionOrder.length > 2 && (
          <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
            <div className="flex items-center space-x-2 text-sm text-gray-600">
              <span className="font-medium">Section Order:</span>
              <div className="flex items-center space-x-1">
                {sectionOrder.map((section, index) => (
                  <div key={section} className="flex items-center">
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      {section === 'details' ? '📝 Details' : 
                       section === 'related_lists' ? '🔗 Related Lists' : 
                       section}
                    </span>
                    {index < sectionOrder.length - 1 && (
                      <svg className="w-4 h-4 text-gray-400 mx-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Use the ↑↓ arrows on custom sections to reorder them. System sections (Details, Related Lists) cannot be moved.
            </p>
          </div>
        )}

        {/* Render sections in the correct order */}
        {sectionOrder.map(section => {
          if (section === 'details') {
            return (
              <LayoutSection
                key={section}
                section={section}
                sectionType="field"
                blocks={layoutBlocks.filter(block => block.section === section)}
                fieldMetadata={fieldMetadata}
                relatedLists={relatedLists}
                buttons={buttons}
                moveBlock={moveBlock}
                onRemoveSection={() => {}} // Details section cannot be removed
                onRenameSection={() => {}} // Details section cannot be renamed
                getFieldIcon={getFieldIcon}
                handleEditField={handleEditField}
                isSystemField={isSystemField}
                onEditRelatedList={onEditRelatedList}
                onDeleteRelatedList={onDeleteRelatedList}
                onRemoveBlock={removeBlockFromLayout}
                onDropFromPool={handleDropFromPool}
                onOpenRelatedListConfig={handleOpenRelatedListConfig}
              />
            );
          } else if (section === 'related_lists') {
            return (
              <RelatedListsSection
                key={section}
                availableRelatedLists={getAvailableRelatedLists()}
                relatedListsInSection={getRelatedListsInSection()}
                relatedLists={relatedLists}
                onAddRelatedList={(relatedList, section) => {
                  onAddRelatedList();
                  addRelatedListToLayout(relatedList, section);
                }}
                onRemoveBlock={removeBlockFromLayout}
                onEditRelatedList={onEditRelatedList}
                onDeleteRelatedList={onDeleteRelatedList}
                onDropFromPool={handleDropFromPool}
                onOpenRelatedListConfig={handleOpenRelatedListConfig}
              />
            );
          } else {
            // Custom sections with reordering controls
            return (
              <div key={section} className="relative">
                <LayoutSection
                  section={section}
                  sectionType={getSectionType(section)}
                  blocks={layoutBlocks.filter(block => block.section === section)}
                  fieldMetadata={fieldMetadata}
                  relatedLists={relatedLists}
                  buttons={buttons}
                  moveBlock={moveBlock}
                  onRemoveSection={handleRemoveLayoutSection}
                  onRenameSection={(sectionName) => {
                    setEditingSection(sectionName);
                    setNewSection({ name: sectionName, type: 'field' });
                    setShowCreateSectionModal(true);
                  }}
                  getFieldIcon={getFieldIcon}
                  handleEditField={handleEditField}
                  isSystemField={isSystemField}
                  onEditRelatedList={onEditRelatedList}
                  onDeleteRelatedList={onDeleteRelatedList}
                  onRemoveBlock={removeBlockFromLayout}
                  onDropFromPool={handleDropFromPool}
                  onOpenRelatedListConfig={handleOpenRelatedListConfig}
                />
                
                {/* Section Reordering Controls */}
                <div className="absolute top-2 right-2 flex space-x-1 bg-white bg-opacity-90 rounded-lg p-1 shadow-sm">
                  <button
                    onClick={() => moveSectionUp(section)}
                    className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                    title="Move section up"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => moveSectionDown(section)}
                    className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                    title="Move section down"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          }
        })}
      </div>

      <div className="mt-4">
        <button 
          onClick={() => setShowCreateSectionModal(true)} 
          className="px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700"
        >
          Add Section
        </button>
      </div>

      {/* Create or Rename Section Modal */}
      {showCreateSectionModal && (
        <div className="fixed z-10 inset-0 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div className="flex items-center justify-center min-h-screen text-center sm:p-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" aria-hidden="true"></div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="sm:flex sm:items-start">
                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                    <h3 className="text-lg leading-6 font-medium text-gray-900" id="modal-title">
                      {editingSection ? 'Rename Section' : 'Create New Section'}
                    </h3>
                    <div className="mt-4">
                      <div>
                        <label htmlFor="section-name" className="block text-sm font-medium text-gray-700">Section Name</label>
                        <input
                          type="text"
                          id="section-name"
                          className="mt-1 focus:ring-blue-500 focus:border-blue-500 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"
                          value={newSection.name}
                          onChange={(e) => setNewSection({ ...newSection, name: e.target.value })}
                          placeholder="Enter section name"
                        />
                      </div>
                      
                      {/* Section Type Selection - Only show when creating new sections */}
                      {!editingSection && (
                        <div className="mt-4">
                          <label className="block text-sm font-medium text-gray-700">Section Type</label>
                          <div className="mt-2 space-y-2">
                            <label className="flex items-center">
                              <input
                                type="radio"
                                name="section-type"
                                value="field"
                                checked={newSection.type === 'field'}
                                onChange={(e) => setNewSection({ ...newSection, type: e.target.value as SectionType })}
                                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                              />
                              <span className="ml-2 text-sm text-gray-700">
                                <span className="font-medium">Fields Only</span>
                                <span className="text-gray-500"> - Can only contain field blocks</span>
                              </span>
                            </label>
                            <label className="flex items-center">
                              <input
                                type="radio"
                                name="section-type"
                                value="related_list"
                                checked={newSection.type === 'related_list'}
                                onChange={(e) => setNewSection({ ...newSection, type: e.target.value as SectionType })}
                                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                              />
                              <span className="ml-2 text-sm text-gray-700">
                                <span className="font-medium">Related Lists Only</span>
                                <span className="text-gray-500"> - Can only contain related list blocks</span>
                              </span>
                            </label>
                            <label className="flex items-center">
                              <input
                                type="radio"
                                name="section-type"
                                value="mixed"
                                checked={newSection.type === 'mixed'}
                                onChange={(e) => setNewSection({ ...newSection, type: e.target.value as SectionType })}
                                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                              />
                              <span className="ml-2 text-sm text-gray-700">
                                <span className="font-medium">Mixed</span>
                                <span className="text-gray-500"> - Can contain both fields and related lists</span>
                              </span>
                            </label>
                          </div>
                        </div>
                      )}
                      
                      {/* Section Type Info for existing sections */}
                      {editingSection && (
                        <div className="mt-4">
                          <div className="text-sm text-gray-600">
                            <span className="font-medium">Current Section Type:</span>{' '}
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                              {getSectionType(editingSection)}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-gray-500">
                            Section type cannot be changed after creation. Create a new section if you need a different type.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-green-600 text-base font-medium text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 sm:ml-3 sm:w-auto sm:text-sm"
                  onClick={editingSection ? handleUpdateSectionName : handleAddLayoutSection}
                >
                  {editingSection ? 'Save Changes' : 'Create Section'}
                </button>
                <button
                  type="button"
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                  onClick={() => {
                    setShowCreateSectionModal(false);
                    setNewSection({ name: '', type: 'field' });
                    setEditingSection(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Related List Configuration Modal */}
      <RelatedListConfigModal
        isOpen={showRelatedListConfigModal}
        onClose={() => {
          setShowRelatedListConfigModal(false);
          setSelectedRelatedList(null);
          setSelectedLayoutBlockForConfig(null);
        }}
        layoutBlock={selectedLayoutBlockForConfig}
        relatedList={selectedRelatedList}
        onSave={handleSaveRelatedListConfig}
        tenantId={tenantId}
      />
    </div>
  );
}

