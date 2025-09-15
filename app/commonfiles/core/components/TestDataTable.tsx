'use client';

import React, { useState } from 'react';
import DataTable from './DataTable';

// Test component to verify DataTable selection works
export default function TestDataTable() {
  const [selectedItems, setSelectedItems] = useState<string[]>([]);

  const testData = [
    { id: '1', name: 'Test Record 1', email: 'test1@example.com' },
    { id: '2', name: 'Test Record 2', email: 'test2@example.com' },
    { id: '3', name: 'Test Record 3', email: 'test3@example.com' }
  ];

  const handleSelectionChange = (selectedIds: string[]) => {
    setSelectedItems(selectedIds);
    console.log('Test DataTable - Selected IDs:', selectedIds);
  };

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold mb-4">Test DataTable with Selection</h2>
      <p className="mb-4">Selected items: {selectedItems.length}</p>
      
      <DataTable
        title="Test Records"
        data={testData}
        searchKeys={['name', 'email']}
        enableSelection={true}
        selectedItems={selectedItems}
        onSelectionChange={handleSelectionChange}
        getItemId={(item) => item.id}
        renderHeader={() => (
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Name
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Email
            </th>
          </tr>
        )}
        renderRow={(item) => (
          <>
            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
              {item.name}
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
              {item.email}
            </td>
          </>
        )}
      />
    </div>
  );
}
