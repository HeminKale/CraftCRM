'use client';

import React, { useState, useEffect, useRef } from 'react';
import { RecordList } from './types';
import { RecordListService } from './RecordListService';

interface RecordListDropdownProps {
  objectId: string;
  tenantId: string;
  tabLabel: string;
  onRecordListSelect: (recordList: RecordList | null) => void;
  selectedRecordList: RecordList | null;
  onCreateRecordList: () => void;
}

export default function RecordListDropdown({
  objectId,
  tenantId,
  tabLabel,
  onRecordListSelect,
  selectedRecordList,
  onCreateRecordList
}: RecordListDropdownProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRecordListDropdown, setShowRecordListDropdown] = useState(false);
  const [recordLists, setRecordLists] = useState<RecordList[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);

  console.log('🔍 RecordListDropdown rendered with props:', { objectId, tenantId, tabLabel, selectedRecordList });
  console.log('🔍 RecordListDropdown state:', { recordLists, loading, error });

  useEffect(() => {
    if (objectId && tenantId) {
      fetchRecordLists();
    }
  }, [objectId, tenantId]);

  // Add click outside handler
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowRecordListDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const fetchRecordLists = async () => {
    console.log('🔍 fetchRecordLists called with objectId:', objectId);
    try {
      setLoading(true);
      setError(null);
      const data = await RecordListService.getRecordLists(objectId, tenantId);
      console.log('🔍 Record lists fetched:', data);
      setRecordLists(data);
    } catch (err: any) {
      console.error('❌ Error fetching record lists:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRecordListChange = (recordListId: string) => {
    if (recordListId === '') {
      onRecordListSelect(null);
    } else {
      const recordList = recordLists.find(rl => rl.id === recordListId);
      if (recordList) {
        onRecordListSelect(recordList);
      }
    }
  };

  // Get the current display label
  const getCurrentLabel = () => {
    if (selectedRecordList) {
      return selectedRecordList.name;
    }
    return 'All'; // Just show "All" instead of "All {tabLabel}"
  };

  console.log('🔍 RecordListDropdown render logic:', { loading, error, recordListsLength: recordLists.length });

  if (loading) {
    console.log('🔍 Rendering loading state');
    return (
      <div className="animate-pulse h-8 w-32 bg-gray-200 rounded"></div>
    );
  }

  if (error) {
    console.log('🔍 Rendering error state:', error);
    return (
      <div className="text-red-600 text-sm">
        Error loading record lists
      </div>
    );
  }

  // When no record lists exist, show simple "All" label
  if (recordLists.length === 0) {
    console.log('🔍 Rendering empty state (no record lists)');
    return (
      <div className="flex items-center space-x-3">
        <h2 className="text-lg font-medium text-gray-900">All</h2>
      </div>
    );
  }

  // When record lists exist, show dropdown with current selection
  return (
    <div className="flex items-center space-x-3">
      <div className="flex items-center space-x-2">
        {/* Current Selection Display */}
        <h2 className="text-lg font-medium text-gray-900">
          {getCurrentLabel()}
        </h2>
        
        {/* Simple Triangular Dropdown Button */}
        <div className="relative">
          <button
            onClick={() => setShowRecordListDropdown(!showRecordListDropdown)}
            className="inline-flex items-center justify-center p-1 border border-gray-300 text-sm font-medium rounded text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
          >
            {/* Triangular Down Arrow */}
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          
          {/* Dropdown Menu */}
          {showRecordListDropdown && (
            <div className="absolute left-0 mt-2 w-48 bg-white rounded-md shadow-lg border border-gray-200 z-10" ref={dropdownRef}>
              <div className="py-1">
                <button
                  onClick={() => {
                    handleRecordListChange('');
                    setShowRecordListDropdown(false);
                  }}
                  className={`flex items-center w-full px-4 py-2 text-sm text-left hover:bg-gray-100 focus:outline-none focus:bg-gray-100 ${
                    !selectedRecordList ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
                  }`}
                >
                  All
                </button>
                {recordLists.map(recordList => (
                  <button
                    key={recordList.id}
                    onClick={() => {
                      handleRecordListChange(recordList.id);
                      setShowRecordListDropdown(false);
                    }}
                    className={`flex items-center w-full px-4 py-2 text-sm text-left hover:bg-gray-100 focus:outline-none focus:bg-gray-100 ${
                      selectedRecordList?.id === recordList.id ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
                    }`}
                  >
                    {recordList.name}
                  </button>
                                 ))}
               </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}