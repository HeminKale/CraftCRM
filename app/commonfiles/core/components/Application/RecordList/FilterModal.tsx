'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '../../../ui/Button';
import { 
  FilterGroup, 
  FilterCondition, 
  FilterFieldInfo, 
  FilterBuilderState,
  fieldTypeMap,
  TextOperator,
  NumberOperator,
  DateOperator,
  BooleanOperator
} from './types';

interface FilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (filters: FilterGroup[]) => void;
  availableFields: FilterFieldInfo[];
  initialFilters?: FilterGroup[];
}

export const FilterModal: React.FC<FilterModalProps> = ({
  isOpen,
  onClose,
  onSave,
  availableFields,
  initialFilters = []
}) => {
  const [filterState, setFilterState] = useState<FilterBuilderState>({
    groups: initialFilters.length > 0 ? initialFilters : [createDefaultGroup()],
    availableFields,
    currentGroupId: null
  });

  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (initialFilters.length > 0) {
      setFilterState(prev => ({
        ...prev,
        groups: initialFilters,
        currentGroupId: initialFilters[0]?.id || null
      }));
    }
  }, [initialFilters]);

  function createDefaultGroup(): FilterGroup {
    return {
      id: `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      conditions: [createDefaultCondition()],
      logic: 'AND',
      group_order: 0
    };
  }

  function createDefaultCondition(): FilterCondition {
    return {
      id: `condition_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      field_name: '',
      field_type: 'text',
      operator: '==',
      value: '',
      condition_order: 0
    };
  }

  function addNewGroup() {
    const newGroup = createDefaultGroup();
    newGroup.group_order = filterState.groups.length;
    
    setFilterState(prev => ({
      ...prev,
      groups: [...prev.groups, newGroup],
      currentGroupId: newGroup.id
    }));
  }

  function removeGroup(groupId: string) {
    if (filterState.groups.length <= 1) return;
    
    setFilterState(prev => ({
      ...prev,
      groups: prev.groups.filter(g => g.id !== groupId),
      currentGroupId: prev.groups.find(g => g.id !== groupId)?.id || null
    }));
  }

  function addConditionToGroup(groupId: string) {
    setFilterState(prev => ({
      ...prev,
      groups: prev.groups.map(group => {
        if (group.id === groupId) {
          const newCondition = createDefaultCondition();
          newCondition.condition_order = group.conditions.length;
          return {
            ...group,
            conditions: [...group.conditions, newCondition]
          };
        }
        return group;
      })
    }));
  }

  function removeConditionFromGroup(groupId: string, conditionId: string) {
    setFilterState(prev => ({
      ...prev,
      groups: prev.groups.map(group => {
        if (group.id === groupId) {
          return {
            ...group,
            conditions: group.conditions.filter(c => c.id !== conditionId)
          };
        }
        return group;
      })
    }));
  }

  function updateGroupLogic(groupId: string, logic: 'AND' | 'OR') {
    setFilterState(prev => ({
      ...prev,
      groups: prev.groups.map(group => 
        group.id === groupId ? { ...group, logic } : group
      )
    }));
  }

  function updateCondition(groupId: string, conditionId: string, updates: Partial<FilterCondition>) {
    setFilterState(prev => ({
      ...prev,
      groups: prev.groups.map(group => {
        if (group.id === groupId) {
          return {
            ...group,
            conditions: group.conditions.map(condition => {
              if (condition.id === conditionId) {
                const updated = { ...condition, ...updates };
                
                // Auto-update field type when field changes
                if (updates.field_name) {
                  const field = availableFields.find(f => f.field_name === updates.field_name);
                  if (field) {
                    updated.field_type = field.field_type;
                    // Reset operator to valid one for new field type
                    updated.operator = getDefaultOperatorForFieldType(field.field_type);
                  }
                }
                
                return updated;
              }
              return condition;
            })
          };
        }
        return group;
      })
    }));
  }

  function getDefaultOperatorForFieldType(fieldType: string): any {
    switch (fieldType) {
      case 'text': return '==';
      case 'number': return '==';
      case 'date': return '==';
      case 'boolean': return '==';
      default: return '==';
    }
  }

  function getOperatorsForFieldType(fieldType: string) {
    switch (fieldType) {
      case 'text':
        return ['==', '!=', 'LIKE', 'NOT LIKE', 'contains', 'starts_with', 'ends_with'] as TextOperator[];
      case 'number':
        return ['==', '!=', '>', '<', '>=', '<='] as NumberOperator[];
      case 'date':
        return ['==', '!=', '>', '<', '>=', '<='] as DateOperator[];
      case 'boolean':
        return ['==', '!='] as BooleanOperator[];
      default:
        return ['==', '!='];
    }
  }

  function validateFilters(): boolean {
    const errors: string[] = [];
    
    filterState.groups.forEach((group, groupIndex) => {
      group.conditions.forEach((condition, conditionIndex) => {
        if (!condition.field_name) {
          errors.push(`Group ${groupIndex + 1}, Condition ${conditionIndex + 1}: Field is required`);
        }
        if (condition.value === '' || condition.value === null || condition.value === undefined) {
          errors.push(`Group ${groupIndex + 1}, Condition ${conditionIndex + 1}: Value is required`);
        }
      });
    });
    
    setErrors(errors);
    return errors.length === 0;
  }

  function handleSave() {
    if (!validateFilters()) return;
    
    // Clean up empty conditions
    const cleanedGroups = filterState.groups.map(group => ({
      ...group,
      conditions: group.conditions.filter(c => c.field_name && c.value !== '' && c.value !== null)
    })).filter(group => group.conditions.length > 0);
    
    onSave(cleanedGroups);
    onClose();
  }

  function renderValueInput(condition: FilterCondition) {
    const { field_type, operator } = condition;
    
    switch (field_type) {
      case 'boolean':
        return (
          <select
            value={condition.value as string}
            onChange={(e) => updateCondition(
              condition.id?.split('_')[0] === 'group' ? 
                filterState.groups.find(g => g.conditions.includes(condition))?.id || '' : 
                filterState.groups.find(g => g.conditions.includes(condition))?.id || '',
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
              condition.id?.split('_')[0] === 'group' ? 
                filterState.groups.find(g => g.conditions.includes(condition))?.id || '' : 
                filterState.groups.find(g => g.conditions.includes(condition))?.id || '',
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
              condition.id?.split('_')[0] === 'group' ? 
                filterState.groups.find(g => g.conditions.includes(condition))?.id || '' : 
                filterState.groups.find(g => g.conditions.includes(condition))?.id || '',
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
              condition.id?.split('_')[0] === 'group' ? 
                filterState.groups.find(g => g.conditions.includes(condition))?.id || '' : 
                filterState.groups.find(g => g.conditions.includes(condition))?.id || '',
              condition.id || '',
              { value: e.target.value }
            )}
            className="border rounded px-2 py-1 text-sm"
            placeholder="Enter value"
          />
        );
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold">Build Advanced Filters</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            ✕
          </button>
        </div>

        {errors.length > 0 && (
          <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded text-red-700">
            <ul className="list-disc list-inside">
              {errors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-4">
          {filterState.groups.map((group, groupIndex) => (
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
                  <Button
                    onClick={() => addConditionToGroup(group.id)}
                    size="sm"
                    variant="outline"
                  >
                    + Condition
                  </Button>
                  {filterState.groups.length > 1 && (
                    <Button
                      onClick={() => removeGroup(group.id)}
                      size="sm"
                      variant="outline"
                      className="text-red-600 hover:text-red-700"
                    >
                      Remove Group
                    </Button>
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
                        onClick={() => removeConditionFromGroup(group.id, condition.id || '')}
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
        </div>

        <div className="flex justify-between mt-6">
          <Button
            onClick={addNewGroup}
            variant="outline"
          >
            + Add Filter Group
          </Button>
          
          <div className="space-x-3">
            <Button
              onClick={onClose}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Apply Filters
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};