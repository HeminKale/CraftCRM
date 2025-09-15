// Field type-specific operators for enhanced filtering
export type TextOperator = '==' | '!=' | 'LIKE' | 'NOT LIKE' | 'contains' | 'starts_with' | 'ends_with';
export type NumberOperator = '==' | '!=' | '>' | '<' | '>=' | '<=';
export type DateOperator = '==' | '!=' | '>' | '<' | '>=' | '<=';
export type BooleanOperator = '==' | '!=';

// Union type for all operators
export type FieldOperator = TextOperator | NumberOperator | DateOperator | BooleanOperator;

// Enhanced filter condition with field type awareness
export interface FilterCondition {
  id?: string;
  field_name: string;
  field_type: 'text' | 'number' | 'date' | 'boolean';
  operator: FieldOperator;
  value: string | number | boolean | Date;
  condition_order: number;
}

// Filter group for AND/OR logic grouping
export interface FilterGroup {
  id: string;
  conditions: FilterCondition[];
  logic: 'AND' | 'OR';
  group_order: number;
}

// Field type mapping utility type
export const fieldTypeMap: Record<string, 'text' | 'number' | 'date' | 'boolean'> = {
  'text': 'text',
  'varchar': 'text',
  'character varying': 'text',
  'char': 'text',
  'string': 'text',
  'integer': 'number',
  'bigint': 'number',
  'numeric': 'number',
  'decimal': 'number',
  'real': 'number',
  'double precision': 'number',
  'float': 'number',
  'smallint': 'number',
  'date': 'date',
  'timestamp': 'date',
  'timestamp without time zone': 'date',
  'timestamp with time zone': 'date',
  'time': 'date',
  'boolean': 'boolean',
  'bool': 'boolean'
};

// Legacy interfaces for backward compatibility
export interface RecordList {
  id: string;
  tenant_id: string;
  object_id: string;
  name: string;
  description?: string;
  filter_criteria: FilterCriteria[];
  selected_fields: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface FilterCriteria {
  id?: string;
  record_list_id?: string;
  field_name: string;
  operator: FilterOperator;
  value: string | number | boolean | null;
  logical_operator: LogicalOperator;
  created_at?: string;
}

export type FilterOperator = '==' | '!=' | 'contains' | '>' | '<' | '>=' | '<=' | 'LIKE' | 'NOT LIKE' | 'starts_with' | 'ends_with';
export type LogicalOperator = 'AND' | 'OR';

// Enhanced record list with new filter system
export interface EnhancedRecordList extends Omit<RecordList, 'filter_criteria'> {
  filter_criteria: FilterGroup[];
}

export interface CreateRecordListRequest {
  name: string;
  description?: string;
  filter_criteria: Omit<FilterCriteria, 'id' | 'record_list_id' | 'created_at'>[];
  selected_fields: string[];
  tenant_id: string;
}

export interface UpdateRecordListRequest {
  name?: string;
  description?: string;
  filter_criteria?: Omit<FilterCriteria, 'id' | 'record_list_id' | 'created_at'>[];
  selected_fields?: string[];
  is_active?: boolean;
}

// Enhanced create/update requests for new filter system
export interface CreateEnhancedRecordListRequest extends Omit<CreateRecordListRequest, 'filter_criteria'> {
  filter_criteria: Omit<FilterGroup, 'id'>[];
  tenant_id: string;
}

export interface UpdateEnhancedRecordListRequest extends Omit<UpdateRecordListRequest, 'filter_criteria'> {
  filter_criteria?: Omit<FilterGroup, 'id'>[];
}

// Utility types for filter operations
export interface FilterFieldInfo {
  field_name: string;
  field_type: 'text' | 'number' | 'date' | 'boolean';
  display_name: string;
  is_filterable: boolean;
}

export interface FilterValidationResult {
  isValid: boolean;
  errors: string[];
}

// Filter builder state interface
export interface FilterBuilderState {
  groups: FilterGroup[];
  availableFields: FilterFieldInfo[];
  currentGroupId: string | null;
}