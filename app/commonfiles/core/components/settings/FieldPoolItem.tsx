'use client';

import React, { useRef, useCallback, memo, useEffect } from 'react';
import { FieldMetadata } from './ObjectLayoutEditor';

interface FieldPoolItemProps {
  field: FieldMetadata;
  getFieldIcon: (dataType: string, isReference?: boolean) => string;
  onAddField: (field: FieldMetadata, section: string) => void;
  availableSections: string[]; // Add available sections
  sectionTypes: Record<string, 'field' | 'related_list' | 'mixed'>; // Add section types
}

const FieldPoolItem: React.FC<FieldPoolItemProps> = ({ field, getFieldIcon, onAddField, availableSections, sectionTypes }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [showSectionSelector, setShowSectionSelector] = React.useState(false);

  // Close section selector when clicking outside - TEMPORARILY DISABLED
  useEffect(() => {
    console.log('🔧 Click outside handler temporarily disabled for debugging');
    
    // Temporarily disable click outside handling to restore working state
    // const handleClickOutside = (event: MouseEvent) => {
    //   console.log('🔧 Click outside detected:', {
    //     target: event.target,
    //     currentRef: ref.current,
    //     containsTarget: ref.current?.contains(event.target as Node)
    //   });
    //   
    //   if (ref.current && !ref.current.contains(event.target as Node)) {
    //     console.log('🔧 Closing section selector due to click outside');
    //     setShowSectionSelector(false);
    //   }
    // };

    // if (showSectionSelector) {
    //   // Add a small delay to prevent immediate closure
    //   const timeoutId = setTimeout(() => {
    //     console.log('🔧 Adding click outside handler after 100ms delay');
    //     document.addEventListener('mousedown', handleClickOutside);
    //   }, 100);
    //   
    //   return () => {
    //     clearTimeout(timeoutId);
    //     document.removeEventListener('mousedown', handleClickOutside);
    //   };
    // }
  }, [showSectionSelector]);

  // Debug state changes
  useEffect(() => {
    console.log('🔧 showSectionSelector state changed to:', showSectionSelector);
    if (showSectionSelector) {
      console.log('🔧 Section selector opened, adding click outside handler with 100ms delay');
    } else {
      console.log('🔧 Section selector closed');
    }
  }, [showSectionSelector]);

  const handleDragStart = useCallback((e: React.DragEvent) => {
    setIsDragging(true);
    const dragData = { 
      type: 'field',
      field: field,
      section: 'pool' 
    };
    e.dataTransfer.setData('application/json', JSON.stringify(dragData));
    e.dataTransfer.effectAllowed = 'copy';
  }, [field]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleClick = useCallback(() => {
    console.log('🔧 Field clicked, setting showSectionSelector to true');
    setShowSectionSelector(true);
  }, []);

  const handleSectionSelect = useCallback((section: string) => {
    console.log('🔧 Section selected:', section);
    console.log('🔧 Field:', field);
    console.log('🔧 onAddField function:', onAddField);
    onAddField(field, section);
    console.log('🔧 onAddField called');
    setShowSectionSelector(false);
  }, [onAddField, field]);

  const handleCancel = useCallback(() => {
    setShowSectionSelector(false);
  }, []);

  return (
    <div className="relative">
      <div
        ref={ref}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        style={{ opacity: isDragging ? 0.5 : 1 }}
        className="flex items-center gap-2 p-2 bg-gray-50 border border-gray-200 rounded text-xs cursor-grab hover:bg-gray-100 transition-colors"
        onClick={handleClick}
      >
        <span className="text-sm">{getFieldIcon(field.field_type, !!field.reference_table)}</span>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-900 truncate">{field.display_label}</div>
          <div className="text-gray-500 truncate">{field.api_name}</div>
        </div>
      </div>

      {/* Section Selector Modal */}
      {showSectionSelector && (
        <div className="absolute z-50 top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-3 min-w-48">
          <div className="text-sm font-medium text-gray-700 mb-2">
            Add "{field.display_label}" to section:
          </div>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {availableSections.map((section) => {
              // Determine if this section can accept fields using actual section types
              const sectionType = sectionTypes[section];
              const canAcceptFields = section === 'details' || 
                                    sectionType === 'field' || 
                                    sectionType === 'mixed';
              
              return (
                <button
                  key={section}
                  onClick={() => {
                    if (canAcceptFields) {
                      handleSectionSelect(section);
                    }
                  }}
                  disabled={!canAcceptFields}
                  className={`w-full text-left px-3 py-2 text-sm rounded-md transition-colors ${
                    canAcceptFields 
                      ? 'text-gray-700 hover:bg-blue-50 hover:text-blue-700 cursor-pointer' 
                      : 'text-gray-400 cursor-not-allowed'
                  }`}
                >
                  <span className="flex items-center space-x-2">
                    <span>{section === 'details' ? '📝' : section === 'related_lists' ? '🔗' : '📋'}</span>
                    <span className="capitalize">{section.replace(/_/g, ' ')}</span>
                    {sectionType && <span className="text-xs text-gray-500">({sectionType})</span>}
                    {!canAcceptFields && <span className="text-xs text-gray-400">(fields only)</span>}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-2 pt-2 border-t border-gray-200">
            <button
              onClick={handleCancel}
              className="w-full px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-md transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default memo(FieldPoolItem);
