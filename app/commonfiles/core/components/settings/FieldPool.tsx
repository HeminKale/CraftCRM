'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { FieldMetadata, RelatedList, Button, ItemTypes } from './ObjectLayoutEditor';
import FieldPoolItem from './FieldPoolItem';
import RelatedListPoolItem from './RelatedListPoolItem';
import ButtonPoolItem from './ButtonPoolItem';

interface FieldPoolProps {
  availableFields: FieldMetadata[];
  availableRelatedLists: RelatedList[];
  availableButtons: Button[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  getFieldIcon: (dataType: string, isReference?: boolean) => string;
  onAddField: (field: FieldMetadata, section: string) => void;
  onAddRelatedList: (relatedList: RelatedList, section: string) => void;
  onAddButton: (button: Button, section: string) => void;
  availableSections: string[]; // Add available sections
  sectionTypes: Record<string, 'field' | 'related_list' | 'mixed'>; // Add section types
}

const FieldPool: React.FC<FieldPoolProps> = ({
  availableFields,
  availableRelatedLists,
  availableButtons,
  searchQuery,
  onSearchChange,
  getFieldIcon,
  onAddField,
  onAddRelatedList,
  onAddButton,
  availableSections,
  sectionTypes,
}) => {
  const [activeTab, setActiveTab] = useState<'fields' | 'relatedLists' | 'buttons'>('fields');



  // Memoized filtered fields based on search query
  const filteredFields = useMemo(() => {
    // Check for duplicates in availableFields
    const fieldIds = availableFields.map(f => f.id);
    const uniqueFieldIds = Array.from(new Set(fieldIds));
    if (fieldIds.length !== uniqueFieldIds.length) {
      console.warn('⚠️ Duplicate fields detected in availableFields:', {
        totalFields: fieldIds.length,
        uniqueFields: uniqueFieldIds.length,
        duplicates: fieldIds.filter((id, index) => fieldIds.indexOf(id) !== index)
      });
    }
    
    return availableFields.filter(field =>
      field.display_label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      field.api_name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [availableFields, searchQuery]);

  // Memoized filtered related lists based on search query
  const filteredRelatedLists = useMemo(() => 
    availableRelatedLists.filter(list =>
      list.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      list.child_table.toLowerCase().includes(searchQuery.toLowerCase())
    ), [availableRelatedLists, searchQuery]
  );

  // Memoized filtered buttons based on search query
  const filteredButtons = useMemo(() => 
    availableButtons.filter(button =>
      (button.label || button.name).toLowerCase().includes(searchQuery.toLowerCase()) ||
      button.button_type.toLowerCase().includes(searchQuery.toLowerCase())
    ), [availableButtons, searchQuery]
  );

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex space-x-1">
          <button
            onClick={useCallback(() => setActiveTab('fields'), [])}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              activeTab === 'fields'
                ? 'bg-blue-100 text-blue-700 border border-blue-200'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
          >
            Fields ({availableFields.length})
          </button>
          <button
            onClick={useCallback(() => setActiveTab('relatedLists'), [])}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              activeTab === 'relatedLists'
                ? 'bg-blue-100 text-blue-700 border border-blue-200'
                : 'text-blue-600 hover:text-blue-700 hover:bg-blue-50'
            }`}
          >
            Related Lists ({availableRelatedLists.length})
          </button>
          <button
            onClick={useCallback(() => setActiveTab('buttons'), [])}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              activeTab === 'buttons'
                ? 'bg-blue-100 text-blue-700 border border-blue-200'
                : 'text-blue-600 hover:text-blue-700 hover:bg-blue-50'
            }`}
          >
            Buttons ({availableButtons.length})
          </button>
        </div>
        
        <div className="relative">
                  <input
          type="text"
          placeholder={`Search ${activeTab === 'fields' ? 'fields' : activeTab === 'relatedLists' ? 'related lists' : 'buttons'}...`}
          value={searchQuery}
          onChange={useCallback((e: React.ChangeEvent<HTMLInputElement>) => onSearchChange(e.target.value), [onSearchChange])}
          className="w-48 pl-8 pr-3 py-1 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
        />
          <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
            <svg className="h-3 w-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>
      </div>
      
      <div className="h-72 w-full border rounded bg-gray-50 p-2 overflow-y-auto">
        {activeTab === 'fields' ? (
          <div className="space-y-1">
            {filteredFields.length === 0 ? (
              <div className="text-center py-8 text-xs text-gray-500">
                {searchQuery ? 'No fields match your search' : 'All fields are already in layout sections'}
              </div>
            ) : (
              filteredFields.map((field) => (
                <FieldPoolItem
                  key={field.id}
                  field={field}
                  getFieldIcon={getFieldIcon}
                  onAddField={onAddField}
                  availableSections={availableSections}
                  sectionTypes={sectionTypes}
                />
              ))
            )}
          </div>
        ) : activeTab === 'relatedLists' ? (
          <div className="space-y-1">
            {filteredRelatedLists.length === 0 ? (
              <div className="text-center py-8 text-xs text-gray-500">
                {searchQuery ? 'No related lists match your search' : 'All related lists are already in layout sections'}
              </div>
            ) : (
              filteredRelatedLists.map((relatedList) => (
                <RelatedListPoolItem
                  key={relatedList.id}
                  relatedList={relatedList}
                  onAddToLayout={(rl) => onAddRelatedList(rl, 'related_lists')}
                />
              ))
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {filteredButtons.length === 0 ? (
              <div className="text-center py-8 text-xs text-gray-500">
                {searchQuery ? 'No buttons match your search' : 'No buttons available'}
              </div>
            ) : (
              filteredButtons.map((button) => (
                <ButtonPoolItem
                  key={button.id}
                  button={button}
                  onAddButton={onAddButton}
                  availableSections={availableSections}
                  sectionTypes={sectionTypes}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default FieldPool;

