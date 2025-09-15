'use client';

import React, { useState } from 'react';

interface DataTableProps<T> {
  title?: string;
  data: T[];
  searchPlaceholder?: string;
  searchKeys?: (keyof T)[];
  renderRow: (item: T, index: number) => React.ReactNode;
  renderHeader?: () => React.ReactNode;
  emptyMessage?: string;
  noSearchResultsMessage?: string;
  className?: string;
  showSearch?: boolean;
  loading?: boolean;
  // NEW: Selection functionality
  enableSelection?: boolean;
  selectedItems?: string[];
  onSelectionChange?: (selectedIds: string[]) => void;
  getItemId?: (item: T) => string;
  // NEW: Column width functionality
  columnWidths?: { [key: string]: string };
  onColumnWidthChange?: (columnKey: string, width: string) => void;
}

// Helper type to handle both direct properties and nested fields
type DataItem<T> = T & {
  fields?: Record<string, any>;
}

export default function DataTable<T>({
  title,
  data,
  searchPlaceholder = "Search...",
  searchKeys = [],
  renderRow,
  renderHeader,
  emptyMessage = "No items found.",
  noSearchResultsMessage = "No items found matching your search.",
  className = "",
  showSearch = true,
  loading = false,
  // NEW: Selection props
  enableSelection = false,
  selectedItems = [],
  onSelectionChange,
  getItemId,
  // NEW: Column width props
  columnWidths = {},
  onColumnWidthChange
}: DataTableProps<T>) {
  const [searchQuery, setSearchQuery] = useState('');

  // Filter data based on search
  const filteredData = data.filter((item: DataItem<T>) => {
    if (!searchQuery) return true;
    
    return searchKeys.some(key => {
      // Handle both direct properties and nested fields structure
      let value;
      if (item.fields && typeof item.fields === 'object') {
        // For records with fields structure (like in TabContent)
        value = item.fields[key as string];
      } else {
        // For direct properties
        value = item[key];
      }
      
      if (value === null || value === undefined) return false;
      const matches = String(value).toLowerCase().includes(searchQuery.toLowerCase());
      
      // Debug logging for search
      if (searchQuery && matches) {
        console.log('🔍 Search match found:', {
          key,
          value,
          searchQuery,
          item: (item as DataItem<T>).fields ? 'has fields' : 'direct properties'
        });
      }
      
      return matches;
    });
  });

  // Debug logging for search state
  if (searchQuery) {
    console.log('🔍 DataTable Search Debug:', {
      searchQuery,
      totalItems: data.length,
      filteredItems: filteredData.length,
      searchKeys: searchKeys.length,
      sampleItem: data[0] ? ((data[0] as DataItem<T>).fields ? 'has fields structure' : 'direct properties') : 'no data'
    });
  }

  // NEW: Selection logic
  const handleSelectAll = (checked: boolean) => {
    if (!enableSelection || !onSelectionChange || !getItemId) return;
    
    if (checked) {
      const allIds = filteredData.map(item => getItemId(item));
      onSelectionChange(allIds);
    } else {
      onSelectionChange([]);
    }
  };

  const handleSelectItem = (itemId: string, checked: boolean) => {
    if (!enableSelection || !onSelectionChange) return;
    
    if (checked) {
      onSelectionChange([...selectedItems, itemId]);
    } else {
      onSelectionChange(selectedItems.filter(id => id !== itemId));
    }
  };

  const isAllSelected = enableSelection && filteredData.length > 0 && 
    filteredData.every(item => getItemId ? selectedItems.includes(getItemId(item)) : false);
  
  const isIndeterminate = enableSelection && selectedItems.length > 0 && !isAllSelected;

  // DEBUG: Log DataTable selection state
  console.log('🔍 DataTable Selection Debug:', {
    enableSelection,
    selectedItems: selectedItems.length,
    filteredDataLength: filteredData.length,
    isAllSelected,
    isIndeterminate,
    hasOnSelectionChange: !!onSelectionChange,
    hasGetItemId: !!getItemId
  });

  return (
    <div className={`bg-white rounded-lg shadow ${className}`}>
      <div className="p-6">
        {title && (
          <h3 className="text-lg font-medium text-gray-900 mb-4">{title}</h3>
        )}
        
        {/* Search Box */}
        {showSearch && searchKeys.length > 0 && (
          <div className="mb-4">
            <input
              type="text"
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        )}

        {loading ? (
          <div className="text-center py-8 text-gray-500">
            <p>Loading...</p>
          </div>
        ) : filteredData.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 table-fixed">
              {renderHeader && (
                <thead className="bg-gray-50">
                  {enableSelection ? (
                    <tr>
                      <th className="px-6 py-3 text-left w-12">
                        <input
                          type="checkbox"
                          checked={isAllSelected}
                          ref={(input) => {
                            if (input) input.indeterminate = isIndeterminate;
                          }}
                          onChange={(e) => handleSelectAll(e.target.checked)}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                      </th>
                      {renderHeader()}
                    </tr>
                  ) : (
                    renderHeader()
                  )}
                </thead>
              )}
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredData.map((item, index) => {
                  const itemId = getItemId ? getItemId(item) : '';
                  const isSelected = enableSelection && selectedItems.includes(itemId);
                  
                  if (enableSelection) {
                    // For selection-enabled tables, renderRow returns <td> elements
                    return (
                      <tr key={itemId || index} className={isSelected ? 'bg-blue-50' : ''}>
                        <td className="px-6 py-4 w-12">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => handleSelectItem(itemId, e.target.checked)}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                          />
                        </td>
                        {renderRow(item, index)}
                      </tr>
                    );
                  } else {
                    // For non-selection tables, renderRow returns <tr> element
                    return renderRow(item, index);
                  }
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <p>{searchQuery ? noSearchResultsMessage : emptyMessage}</p>
          </div>
        )}
      </div>
    </div>
  );
} 