import { 
    RecordList, 
    CreateRecordListRequest, 
    UpdateRecordListRequest,
    FilterGroup,
    FilterFieldInfo,
    FilterValidationResult,
    EnhancedRecordList,
    CreateEnhancedRecordListRequest,
    UpdateEnhancedRecordListRequest
  } from './types';
  import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
  import { validateFilters, filtersToSqlWhere } from './FilterUtils';
  
  export class RecordListService {
    /**
     * Get all record lists for a specific object
     */
    static async getRecordLists(objectId: string, tenantId: string): Promise<RecordList[]> {
      try {
        const supabase = createClientComponentClient();
        const { data, error } = await supabase.rpc('get_record_lists', {
          p_object_id: objectId,
          p_tenant_id: tenantId
        });
  
        if (error) {
          throw new Error(`Failed to fetch record lists: ${error.message}`);
        }
  
        return data || [];
      } catch (error) {
        throw error;
      }
    }
  
    /**
     * Get enhanced record lists with new filter system
     */
    static async getEnhancedRecordLists(objectId: string): Promise<EnhancedRecordList[]> {
      try {
        const supabase = createClientComponentClient();
        const { data, error } = await supabase.rpc('get_enhanced_record_lists', {
          p_object_id: objectId
        });
  
        if (error) {
          throw new Error(`Failed to fetch enhanced record lists: ${error.message}`);
        }
  
        return data || [];
      } catch (error) {
        throw error;
      }
    }
  
      /**
   * Create a new record list
   */
  static async createRecordList(objectId: string, request: CreateRecordListRequest): Promise<RecordList> {
    try {
      const supabase = createClientComponentClient();
              const { data, error } = await supabase.rpc('create_record_list', {
        p_object_id: objectId,
        p_tenant_id: request.tenant_id,
        p_name: request.name,
        p_description: request.description || '',
        p_filter_criteria: request.filter_criteria,
        p_selected_fields: request.selected_fields
      });
  
        if (error) {
          throw new Error(`Failed to create record list: ${error.message}`);
        }
  
        return data;
      } catch (error) {
        throw error;
      }
    }
  
    /**
     * Create an enhanced record list with new filter system
     */
    static async createEnhancedRecordList(objectId: string, request: CreateEnhancedRecordListRequest): Promise<EnhancedRecordList> {
      try {
        const supabase = createClientComponentClient();
        const { data, error } = await supabase.rpc('create_enhanced_record_list', {
          p_object_id: objectId,
          p_tenant_id: request.tenant_id,
          p_name: request.name,
          p_description: request.description || '',
          p_filter_criteria: request.filter_criteria,
          p_selected_fields: request.selected_fields
        });
  
        if (error) {
          throw new Error(`Failed to create enhanced record list: ${error.message}`);
        }
  
        return data;
      } catch (error) {
        throw error;
      }
    }
  
    /**
     * Update an existing record list
     */
    static async updateRecordList(id: string, request: UpdateRecordListRequest): Promise<RecordList> {
      try {
        const supabase = createClientComponentClient();
        const { data, error } = await supabase.rpc('update_record_list', {
          p_record_list_id: id,
          p_name: request.name,
          p_description: request.description,
          p_filter_criteria: request.filter_criteria,
          p_is_active: request.is_active
        });
  
        if (error) {
          throw new Error(`Failed to update record list: ${error.message}`);
        }
  
        return data;
      } catch (error) {
        throw error;
      }
    }
  
    /**
     * Update an enhanced record list
     */
    static async updateEnhancedRecordList(id: string, request: UpdateEnhancedRecordListRequest): Promise<EnhancedRecordList> {
      try {
        const supabase = createClientComponentClient();
        const { data, error } = await supabase.rpc('update_enhanced_record_list', {
          p_record_list_id: id,
          p_name: request.name,
          p_description: request.description,
          p_filter_criteria: request.filter_criteria,
          p_selected_fields: request.selected_fields,
          p_is_active: request.is_active
        });
  
        if (error) {
          throw new Error(`Failed to update enhanced record list: ${error.message}`);
        }
  
        return data;
      } catch (error) {
        throw error;
      }
    }
  
    /**
     * Delete a record list
     */
    static async deleteRecordList(id: string): Promise<void> {
      try {
        const supabase = createClientComponentClient();
        const { error } = await supabase.rpc('delete_record_list', {
          p_record_list_id: id
        });
  
        if (error) {
          throw new Error(`Failed to delete record list: ${error.message}`);
        }
      } catch (error) {
        throw error;
      }
    }
  
    /**
     * Get filtered records using the new filter system
     */
    static async getFilteredRecords(
      objectId: string, 
      filters: FilterGroup[], 
      selectedFields: string[] = [],
      limit: number = 100,
      offset: number = 0
    ): Promise<any[]> {
      try {
       
        
        // Skip validation for now since we don't have available fields
        // TODO: Fetch available fields and validate properly
        
        // Basic validation - just check if filters exist
        if (!filters || filters.length === 0) {
          return [];
        }
  
        const supabase = createClientComponentClient();
        
        const rpcParams = {
          p_object_id: objectId,
          p_filter_criteria: filters,
          p_selected_fields: selectedFields,
          p_limit: limit,
          p_offset: offset
        };
        
       
        const { data, error } = await supabase.rpc('get_filtered_records', rpcParams);
  
        if (error) {
          throw new Error(`Failed to fetch filtered records: ${error.message}`);
        }
  
        
        // ⬇️ IMPORTANT: unwrap the RPC payload
        // data is a JSON object like { data: [...], pagination: {...}, ... }
        if (data && typeof data === 'object' && 'data' in data) {
          return (data as any).data ?? [];
        }

        // In case the function ever returns bare arrays (future or legacy)
        return Array.isArray(data) ? data : [];
      } catch (error) {
        throw error;
      }
    }
  
    /**
     * Get available fields for filtering
     */
    static async getFilterableFields(objectId: string): Promise<FilterFieldInfo[]> {
      try {
        const supabase = createClientComponentClient();
        const { data, error } = await supabase.rpc('get_filterable_fields', {
          p_object_id: objectId
        });
  
        if (error) {
          throw new Error(`Failed to fetch filterable fields: ${error.message}`);
        }
  
        return data || [];
      } catch (error) {
        throw error;
      }
    }
  
    /**
     * Validate filters without sending to backend
     */
    static validateFilters(filters: FilterGroup[], availableFields: FilterFieldInfo[]): FilterValidationResult {
      return validateFilters(filters, availableFields);
    }
  
    /**
     * Convert filters to SQL WHERE clause (for debugging/testing)
     */
    static filtersToSql(filters: FilterGroup[], tableAlias: string = ''): { sql: string; params: any[] } {
      return filtersToSqlWhere(filters, tableAlias);
    }
  
    /**
     * Toggle record list active status
     */
    static async toggleRecordListStatus(id: string, isActive: boolean): Promise<void> {
      try {
        const supabase = createClientComponentClient();
        const { error } = await supabase.rpc('toggle_record_list_status', {
          p_record_list_id: id,
          p_is_active: isActive
        });
  
        if (error) {
          throw new Error(`Failed to toggle record list status: ${error.message}`);
        }
      } catch (error) {
        throw error;
      }
    }
  
    /**
     * Duplicate a record list
     */
    static async duplicateRecordList(id: string, newName: string): Promise<RecordList> {
      try {
        const supabase = createClientComponentClient();
        const { data, error } = await supabase.rpc('duplicate_record_list', {
          p_record_list_id: id,
          p_new_name: newName
        });
  
        if (error) {
          throw error;
        }
  
        return data;
      } catch (error) {
        throw error;
      }
    }
  
    /**
     * Update just the selected fields of a record list
     */
    static async updateRecordListFields(id: string, selectedFields: string[]): Promise<RecordList> {
      try {
        const supabase = createClientComponentClient();
        const { data, error } = await supabase.rpc('update_record_list_fields', {
          p_record_list_id: id,
          p_selected_fields: selectedFields
        });

        if (error) {
          throw new Error(`Failed to update record list fields: ${error.message}`);
        }

        return data;
      } catch (error) {
        throw error;
      }
    }
  
    /**
     * Get record list usage statistics
     */
    static async getRecordListStats(objectId: string): Promise<{
      total_lists: number;
      active_lists: number;
      total_records: number;
      most_used_lists: Array<{ id: string; name: string; usage_count: number }>;
    }> {
      try {
        const supabase = createClientComponentClient();
        const { data, error } = await supabase.rpc('get_record_list_stats', {
          p_object_id: objectId
        });
  
        if (error) {
          throw new Error(`Failed to fetch record list stats: ${error.message}`);
        }
  
        return data || {
          total_lists: 0,
          active_lists: 0,
          total_records: 0,
          most_used_lists: []
        };
      } catch (error) {
        throw error;
      }
    }
  }