import { FilterGroup, FilterCondition, FilterFieldInfo, FilterValidationResult } from './types';

/**
 * Validates a filter configuration
 */
export function validateFilters(filters: FilterGroup[], availableFields: FilterFieldInfo[]): FilterValidationResult {
  const errors: string[] = [];
  
  if (!filters || filters.length === 0) {
    return { isValid: true, errors: [] };
  }

  filters.forEach((group, groupIndex) => {
    if (!group.conditions || group.conditions.length === 0) {
      errors.push(`Group ${groupIndex + 1}: Must have at least one condition`);
      return;
    }

    group.conditions.forEach((condition, conditionIndex) => {
      // Check if field exists
      if (!condition.field_name) {
        errors.push(`Group ${groupIndex + 1}, Condition ${conditionIndex + 1}: Field is required`);
        return;
      }

      const field = availableFields.find(f => f.field_name === condition.field_name);
      if (!field) {
        errors.push(`Group ${groupIndex + 1}, Condition ${conditionIndex + 1}: Field "${condition.field_name}" not found`);
        return;
      }

      if (!field.is_filterable) {
        errors.push(`Group ${groupIndex + 1}, Condition ${conditionIndex + 1}: Field "${condition.field_name}" is not filterable`);
        return;
      }

      // Check if operator is valid for field type
      const validOperators = getValidOperatorsForFieldType(field.field_type);
      if (!validOperators.includes(condition.operator)) {
        errors.push(`Group ${groupIndex + 1}, Condition ${conditionIndex + 1}: Operator "${condition.operator}" is not valid for field type "${field.field_type}"`);
        return;
      }

      // Check if value is provided
      if (condition.value === '' || condition.value === null || condition.value === undefined) {
        errors.push(`Group ${groupIndex + 1}, Condition ${conditionIndex + 1}: Value is required`);
        return;
      }

      // Type-specific validation
      if (field.field_type === 'number' && typeof condition.value !== 'number') {
        errors.push(`Group ${groupIndex + 1}, Condition ${conditionIndex + 1}: Value must be a number for field type "number"`);
        return;
      }

      if (field.field_type === 'boolean' && typeof condition.value !== 'boolean') {
        errors.push(`Group ${groupIndex + 1}, Condition ${conditionIndex + 1}: Value must be a boolean for field type "boolean"`);
        return;
      }

      if (field.field_type === 'date' && !isValidDate(condition.value)) {
        errors.push(`Group ${groupIndex + 1}, Condition ${conditionIndex + 1}: Value must be a valid date for field type "date"`);
        return;
      }
    });
  });

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Gets valid operators for a given field type
 */
export function getValidOperatorsForFieldType(fieldType: string): string[] {
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
}

/**
 * Checks if a value is a valid date
 */
export function isValidDate(value: any): boolean {
  if (value instanceof Date) return true;
  if (typeof value === 'string') {
    const date = new Date(value);
    return !isNaN(date.getTime());
  }
  return false;
}

/**
 * Converts filter groups to SQL WHERE clause
 */
export function filtersToSqlWhere(filters: FilterGroup[], tableAlias: string = ''): { sql: string; params: any[] } {
  if (!filters || filters.length === 0) {
    return { sql: '', params: [] };
  }

  const params: any[] = [];
  let paramIndex = 1;
  
  const groupClauses = filters.map(group => {
    if (!group.conditions || group.conditions.length === 0) return '';
    
    const conditionClauses = group.conditions.map(condition => {
      const fieldRef = tableAlias ? `${tableAlias}.${condition.field_name}` : condition.field_name;
      let sql: string;
      
      switch (condition.operator) {
        case '==':
          sql = `${fieldRef} = $${paramIndex}`;
          break;
        case '!=':
          sql = `${fieldRef} != $${paramIndex}`;
          break;
        case '>':
          sql = `${fieldRef} > $${paramIndex}`;
          break;
        case '<':
          sql = `${fieldRef} < $${paramIndex}`;
          break;
        case '>=':
          sql = `${fieldRef} >= $${paramIndex}`;
          break;
        case '<=':
          sql = `${fieldRef} <= $${paramIndex}`;
          break;
        case 'LIKE':
        case 'contains':
          sql = `${fieldRef} ILIKE $${paramIndex}`;
          break;
        case 'NOT LIKE':
          sql = `${fieldRef} NOT ILIKE $${paramIndex}`;
          break;
        case 'starts_with':
          sql = `${fieldRef} ILIKE $${paramIndex}`;
          break;
        case 'ends_with':
          sql = `${fieldRef} ILIKE $${paramIndex}`;
          break;
        default:
          sql = `${fieldRef} = $${paramIndex}`;
      }
      
      // Handle special cases for LIKE operators
      if (condition.operator === 'starts_with') {
        params.push(`${condition.value}%`);
      } else if (condition.operator === 'ends_with') {
        params.push(`%${condition.value}`);
      } else if (condition.operator === 'contains' || condition.operator === 'LIKE') {
        params.push(`%${condition.value}%`);
      } else if (condition.operator === 'NOT LIKE') {
        params.push(`%${condition.value}%`);
      } else {
        params.push(condition.value);
      }
      
      paramIndex++;
      return sql;
    });
    
    if (conditionClauses.length === 0) return '';
    
    return `(${conditionClauses.join(` ${group.logic} `)})`;
  });
  
  const validGroups = groupClauses.filter(clause => clause !== '');
  if (validGroups.length === 0) return { sql: '', params: [] };
  
  return {
    sql: validGroups.join(' AND '),
    params
  };
}

/**
 * Creates a default filter group
 */
export function createDefaultFilterGroup(): FilterGroup {
  return {
    id: `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    conditions: [createDefaultFilterCondition()],
    logic: 'AND',
    group_order: 0
  };
}

/**
 * Creates a default filter condition
 */
export function createDefaultFilterCondition(): FilterCondition {
  return {
    id: `condition_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    field_name: '',
    field_type: 'text',
    operator: '==',
    value: '',
    condition_order: 0
  };
}

/**
 * Gets the display name for an operator
 */
export function getOperatorDisplayName(operator: string): string {
  switch (operator) {
    case '==': return 'equals';
    case '!=': return 'not equals';
    case '>': return 'greater than';
    case '<': return 'less than';
    case '>=': return 'greater than or equal to';
    case '<=': return 'less than or equal to';
    case 'LIKE': return 'contains';
    case 'NOT LIKE': return 'not contains';
    case 'contains': return 'contains';
    case 'starts_with': return 'starts with';
    case 'ends_with': return 'ends with';
    default: return operator;
  }
}

/**
 * Sorts filter groups and conditions by their order
 */
export function sortFiltersByOrder(filters: FilterGroup[]): FilterGroup[] {
  return filters
    .sort((a, b) => a.group_order - b.group_order)
    .map(group => ({
      ...group,
      conditions: group.conditions.sort((a, b) => a.condition_order - b.condition_order)
    }));
}

/**
 * Generates a human-readable description of filters
 */
export function generateFilterDescription(filters: FilterGroup[], availableFields: FilterFieldInfo[]): string {
  if (!filters || filters.length === 0) {
    return 'No filters applied';
  }

  const descriptions = filters.map(group => {
    if (!group.conditions || group.conditions.length === 0) return '';
    
    const conditionDescriptions = group.conditions.map(condition => {
      const field = availableFields.find(f => f.field_name === condition.field_name);
      const fieldName = field ? field.display_name : condition.field_name;
      const operatorName = getOperatorDisplayName(condition.operator);
      
      let valueDisplay = condition.value;
      if (condition.field_type === 'boolean') {
        valueDisplay = condition.value ? 'Yes' : 'No';
      }
      
      return `${fieldName} ${operatorName} ${valueDisplay}`;
    });
    
    return conditionDescriptions.join(` ${group.logic} `);
  });
  
  return descriptions.filter(d => d !== '').join(' AND ');
}