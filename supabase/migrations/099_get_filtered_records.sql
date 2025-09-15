-- Migration: 099_get_filtered_records.sql
-- Description: Create RPC function for retrieving filtered records using the new filter system

-- Drop function if it exists
DROP FUNCTION IF EXISTS tenant.get_filtered_records(
  p_object_id uuid,
  p_filter_criteria jsonb,
  p_selected_fields text[],
  p_limit integer,
  p_offset integer
);

-- Create the main function for getting filtered records
CREATE OR REPLACE FUNCTION tenant.get_filtered_records(
  p_object_id uuid,
  p_filter_criteria jsonb DEFAULT '[]'::jsonb,
  p_selected_fields text[] DEFAULT '{}'::text[],
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_table_name text;
  v_sql text;
  v_where_clause text := '';
  v_select_clause text := '*';
  v_order_clause text := 'ORDER BY created_at DESC';
  v_filter_params jsonb;
  v_condition_count integer := 0;
  v_group_count integer := 0;
  v_result jsonb;
  v_total_count integer := 0;
  v_filtered_count integer := 0;
BEGIN
  -- Get tenant ID from JWT
  v_tenant_id := (auth.jwt()->'app_metadata'->>'tenant_id')::uuid;
  
  -- Validate object exists and user has access
  IF NOT EXISTS (
    SELECT 1 FROM tenant.objects 
    WHERE id = p_object_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Object not found or access denied';
  END IF;
  
  -- Get the physical table name for the object
  SELECT table_name INTO v_table_name
  FROM tenant.objects 
  WHERE id = p_object_id AND tenant_id = v_tenant_id;
  
  IF v_table_name IS NULL THEN
    RAISE EXCEPTION 'Object table not found';
  END IF;
  
  -- Build SELECT clause
  IF array_length(p_selected_fields, 1) > 0 THEN
    v_select_clause := array_to_string(p_selected_fields, ', ');
  END IF;
  
  -- Build WHERE clause from filter criteria
  IF p_filter_criteria IS NOT NULL AND jsonb_array_length(p_filter_criteria) > 0 THEN
    v_where_clause := tenant.build_filter_where_clause(p_filter_criteria, v_table_name);
  END IF;
  
  -- Add tenant_id filter for security
  IF v_where_clause != '' THEN
    v_where_clause := 'WHERE ' || v_where_clause || ' AND tenant_id = ' || quote_literal(v_tenant_id);
  ELSE
    v_where_clause := 'WHERE tenant_id = ' || quote_literal(v_tenant_id);
  END IF;
  
  -- Build the main query
  v_sql := format(
    'SELECT %s FROM %I %s %s LIMIT %s OFFSET %s',
    v_select_clause,
    v_table_name,
    v_where_clause,
    v_order_clause,
    p_limit,
    p_offset
  );
  
  -- Execute the query and get results
  EXECUTE v_sql INTO v_result;
  
  -- Get total count for pagination
  EXECUTE format(
    'SELECT COUNT(*) FROM %I %s',
    v_table_name,
    v_where_clause
  ) INTO v_total_count;
  
  -- Get filtered count
  IF p_filter_criteria IS NOT NULL AND jsonb_array_length(p_filter_criteria) > 0 THEN
    EXECUTE format(
      'SELECT COUNT(*) FROM %I %s',
      v_table_name,
      v_where_clause
    ) INTO v_filtered_count;
  ELSE
    v_filtered_count := v_total_count;
  END IF;
  
  -- Return structured result
  RETURN jsonb_build_object(
    'data', COALESCE(v_result, '[]'::jsonb),
    'pagination', jsonb_build_object(
      'total_count', v_total_count,
      'filtered_count', v_filtered_count,
      'limit', p_limit,
      'offset', p_offset,
      'has_more', (p_offset + p_limit) < v_filtered_count
    ),
    'filters_applied', p_filter_criteria,
    'sql_generated', v_sql
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error in get_filtered_records: %', SQLERRM;
END;
$$;

-- Create helper function to build WHERE clause from filter criteria
CREATE OR REPLACE FUNCTION tenant.build_filter_where_clause(
  p_filter_criteria jsonb,
  p_table_name text
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_where_clause text := '';
  v_group_clauses text[] := '{}';
  v_condition_clauses text[] := '{}';
  v_group jsonb;
  v_condition jsonb;
  v_field_name text;
  v_operator text;
  v_value text;
  v_field_type text;
  v_param_index integer := 1;
  v_group_index integer;
  v_condition_index integer;
  v_group_logic text;
BEGIN
  -- Process each filter group
  FOR v_group_index IN 0..jsonb_array_length(p_filter_criteria) - 1 LOOP
    v_group := p_filter_criteria->v_group_index;
    
    -- Process conditions within the group
    v_condition_clauses := '{}';
    FOR v_condition_index IN 0..jsonb_array_length(v_group->'conditions') - 1 LOOP
      v_condition := v_group->'conditions'->v_condition_index;
      
      v_field_name := v_condition->>'field_name';
      v_operator := v_condition->>'operator';
      v_value := v_condition->>'value';
      v_field_type := v_condition->>'field_type';
      
      -- Build condition clause based on operator and field type
      CASE v_operator
        WHEN '==' THEN
          v_condition_clauses := array_append(
            v_condition_clauses,
            format('%I = %s', v_field_name, quote_literal(v_value))
          );
        WHEN '!=' THEN
          v_condition_clauses := array_append(
            v_condition_clauses,
            format('%I != %s', v_field_name, quote_literal(v_value))
          );
        WHEN '>' THEN
          v_condition_clauses := array_append(
            v_condition_clauses,
            format('%I > %s', v_field_name, quote_literal(v_value))
          );
        WHEN '<' THEN
          v_condition_clauses := array_append(
            v_condition_clauses,
            format('%I < %s', v_field_name, quote_literal(v_value))
          );
        WHEN '>=' THEN
          v_condition_clauses := array_append(
            v_condition_clauses,
            format('%I >= %s', v_field_name, quote_literal(v_value))
          );
        WHEN '<=' THEN
          v_condition_clauses := array_append(
            v_condition_clauses,
            format('%I <= %s', v_field_name, quote_literal(v_value))
          );
        WHEN 'LIKE', 'contains' THEN
          v_condition_clauses := array_append(
            v_condition_clauses,
            format('%I ILIKE %s', v_field_name, quote_literal('%' || v_value || '%'))
          );
        WHEN 'NOT LIKE' THEN
          v_condition_clauses := array_append(
            v_condition_clauses,
            format('%I NOT ILIKE %s', v_field_name, quote_literal('%' || v_value || '%'))
          );
        WHEN 'starts_with' THEN
          v_condition_clauses := array_append(
            v_condition_clauses,
            format('%I ILIKE %s', v_field_name, quote_literal(v_value || '%'))
          );
        WHEN 'ends_with' THEN
          v_condition_clauses := array_append(
            v_condition_clauses,
            format('%I ILIKE %s', v_field_name, quote_literal('%' || v_value))
          );
        ELSE
          -- Default to equality
          v_condition_clauses := array_append(
            v_condition_clauses,
            format('%I = %s', v_field_name, quote_literal(v_value))
          );
      END CASE;
    END LOOP;
    
    -- Join conditions within the group using the group logic
    IF array_length(v_condition_clauses, 1) > 0 THEN
      v_group_logic := v_group->>'logic';
      IF v_group_logic = 'OR' THEN
        v_group_clauses := array_append(
          v_group_clauses,
          '(' || array_to_string(v_condition_clauses, ' OR ') || ')'
        );
      ELSE
        v_group_clauses := array_append(
          v_group_clauses,
          '(' || array_to_string(v_condition_clauses, ' AND ') || ')'
        );
      END IF;
    END IF;
  END LOOP;
  
  -- Join groups with AND logic
  IF array_length(v_group_clauses, 1) > 0 THEN
    v_where_clause := array_to_string(v_group_clauses, ' AND ');
  END IF;
  
  RETURN v_where_clause;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION tenant.get_filtered_records(uuid, jsonb, text[], integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.build_filter_where_clause(jsonb, text) TO authenticated;

-- Add comments
COMMENT ON FUNCTION tenant.get_filtered_records(uuid, jsonb, text[], integer, integer) IS 
'Retrieve filtered records for an object using the new filter system with AND/OR logic grouping';

COMMENT ON FUNCTION tenant.build_filter_where_clause(jsonb, text) IS 
'Helper function to build SQL WHERE clause from structured filter criteria';