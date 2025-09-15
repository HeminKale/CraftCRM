'use client';

import React from 'react';
import { FilterGroup, FilterCondition, FilterFieldInfo } from './types';

interface FilterBuilderProps {
  filters: FilterGroup[];
  availableFields: FilterFieldInfo[];
  onFiltersChange: (filters: FilterGroup[]) => void;
  className?: string;
}

export const FilterBuilder: React.FC<FilterBuilderProps> = ({
  filters,
  availableFields,
  onFiltersChange,
  className = ''
}) => {
  const addCondition = (groupId: string) => {
    const newCondition: FilterCondition = {
      id: `condition_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      field_name: '',
      field_type: 'text',
      operator: '==',
      value: '',
      condition_order: 0
    };

    const updatedFilters = filters.map(group => {
      if (group.id === groupId) {
        return {
          ...group,
          conditions: [...group.conditions, { ...newCondition, condition_order: group.conditions.length }]
        };
      }
      return group;
    });

    onFiltersChange(updatedFilters);
  };

  const removeCondition = (groupId: string, conditionId: string) => {
    const updatedFilters = filters.map(group => {
      if (group.id === groupId) {
        return {
          ...group,
          conditions: group.conditions.filter(c => c.id !== conditionId)
        };
      }
      return group;
    });

    onFiltersChange(updatedFilters);
  };

  const updateCondition = (groupId: string, conditionId: string, updates: Partial<FilterCondition>) => {
    const updatedFilters = filters.map(group => {
      if (group.id === groupId) {
        return {
          ...group,
          conditions: group.conditions.map(condition => {
            if (condition.id === conditionId) {
              return { ...condition, ...updates };
            }
            return condition;
          })
        };
      }
      return group;
    });

    onFiltersChange(updatedFilters);
  };

  const updateGroupLogic = (groupId: string, logic: 'AND' | 'OR') => {
    const updatedFilters = filters.map(group => 
      group.id === groupId ? { ...group, logic } : group
    );
    onFiltersChange(updatedFilters);
  };

  const addGroup = () => {
    const newGroup: FilterGroup = {
      id: `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      conditions: [{
        id: `condition_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        field_name: '',
        field_type: 'text',
        operator: '==',
        value: '',
        condition_order: 0
      }],
      logic: 'AND',
      group_order: filters.length
    };

    onFiltersChange([...filters, newGroup]);
  };

  const removeGroup = (groupId: string) => {
    if (filters.length <= 1) return;
    onFiltersChange(filters.filter(g => g.id !== groupId));
  };

  const getOperatorsForFieldType = (fieldType: string) => {
    switch (fieldType) {
      case 'text':
        return ['==', '!=', 'LIKE', 'NOT LIKE', 'contains', 'starts_with', 'ends_with'];
      case 'number':
        return ['==', '!=', '>', '<', '>=', '<='];
      case 'date':
        return ['==', '!=', '>', '<', '>=', '<='];
      case 'boolean':
        return ['==', '!='];
      default:
        return ['==', '!='];
    }
  };

  const renderValueInput = (condition: FilterCondition) => {
    const { field_type, operator } = condition;
    
    switch (field_type) {
      case 'boolean':
        return (
          <select
            value={condition.value as string}
            onChange={(e) => updateCondition(
              filters.find(g => g.conditions.includes(condition))?.id || '',
              condition.id || '',
              { value: e.target.value === 'true' }
            )}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="">Select...</option>
            <option value="true">True</option>
            <option value="false">False</option>
          </select>
        );
      
      case 'date':
        return (
          <input
            type="date"
            value={condition.value as string}
            onChange={(e) => updateCondition(
              filters.find(g => g.conditions.includes(condition))?.id || '',
              condition.id || '',
              { value: e.target.value }
            )}
            className="border rounded px-2 py-1 text-sm"
          />
        );
      
      case 'number':
        return (
          <input
            type="number"
            value={condition.value as string}
            onChange={(e) => updateCondition(
              filters.find(g => g.conditions.includes(condition))?.id || '',
              condition.id || '',
              { value: parseFloat(e.target.value) || 0 }
            )}
            className="border rounded px-2 py-1 text-sm"
            placeholder="Enter number"
          />
        );
      
      default: // text
        return (
          <input
            type="text"
            value={condition.value as string}
            onChange={(e) => updateCondition(
              filters.find(g => g.conditions.includes(condition))?.id || '',
              condition.id || '',
              { value: e.target.value }
            )}
            className="border rounded px-2 py-1 text-sm"
            placeholder="Enter value"
          />
        );
    }
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {filters.map((group, groupIndex) => (
        <div key={group.id} className="border rounded-lg p-4 bg-gray-50">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-3">
              <span className="font-medium">Group {groupIndex + 1}</span>
              <select
                value={group.logic}
                onChange={(e) => updateGroupLogic(group.id, e.target.value as 'AND' | 'OR')}
                className="border rounded px-2 py-1 text-sm"
              >
                <option value="AND">AND</option>
                <option value="OR">OR</option>
              </select>
            </div>
            
            <div className="flex space-x-2">
              <button
                onClick={() => addCondition(group.id)}
                className="px-3 py-1 text-sm border rounded hover:bg-gray-100"
              >
                + Condition
              </button>
              {filters.length > 1 && (
                <button
                  onClick={() => removeGroup(group.id)}
                  className="px-3 py-1 text-sm border rounded text-red-600 hover:text-red-700 hover:bg-red-50"
                >
                  Remove Group
                </button>
              )}
            </div>
          </div>

          <div className="space-y-3">
            {group.conditions.map((condition, conditionIndex) => (
              <div key={condition.id} className="flex items-center space-x-3 p-3 bg-white rounded border">
                <span className="text-sm text-gray-500 w-16">
                  {conditionIndex === 0 ? 'Where' : group.logic}
                </span>
                
                <select
                  value={condition.field_name}
                  onChange={(e) => updateCondition(group.id, condition.id || '', { field_name: e.target.value })}
                  className="border rounded px-2 py-1 text-sm min-w-[150px]"
                >
                  <option value="">Select Field...</option>
                  {availableFields.map(field => (
                    <option key={field.field_name} value={field.field_name}>
                      {field.display_name}
                    </option>
                  ))}
                </select>
                
                <select
                  value={condition.operator}
                  onChange={(e) => updateCondition(group.id, condition.id || '', { operator: e.target.value as any })}
                  className="border rounded px-2 py-1 text-sm min-w-[100px]"
                >
                  {getOperatorsForFieldType(condition.field_type).map(op => (
                    <option key={op} value={op}>
                      {op === '==' ? 'equals' : 
                       op === '!=' ? 'not equals' : 
                       op === 'LIKE' ? 'contains' :
                       op === 'NOT LIKE' ? 'not contains' :
                       op === 'starts_with' ? 'starts with' :
                       op === 'ends_with' ? 'ends with' : op}
                    </option>
                  ))}
                </select>
                
                {renderValueInput(condition)}
                
                {group.conditions.length > 1 && (
                  <button
                    onClick={() => removeCondition(group.id, condition.id || '')}
                    className="text-red-500 hover:text-red-700 p-1"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      <button
        onClick={addGroup}
        className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:text-gray-700 hover:border-gray-400"
      >
        + Add Filter Group
      </button>
    </div>
  );
};