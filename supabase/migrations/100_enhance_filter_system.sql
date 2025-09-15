-- Migration: 100_enhance_filter_system.sql
-- Description: Create enhanced record list RPC functions for the new filter system

-- Drop existing functions from public schema if they exist (to avoid conflicts)
DROP FUNCTION IF EXISTS public.create_enhanced_record_list CASCADE;
DROP FUNCTION IF EXISTS public.update_enhanced_record_list CASCADE;
DROP FUNCTION IF EXISTS public.get_enhanced_record_lists CASCADE;
DROP FUNCTION IF EXISTS public.get_filterable_fields CASCADE;
DROP FUNCTION IF EXISTS public.toggle_record_list_status CASCADE;
DROP FUNCTION IF EXISTS public.duplicate_record_list CASCADE;
DROP FUNCTION IF EXISTS public.get_record_list_stats CASCADE;
DROP FUNCTION IF EXISTS public.create_record_list CASCADE;
DROP FUNCTION IF EXISTS public.update_record_list CASCADE;
DROP FUNCTION IF EXISTS public.delete_record_list CASCADE;
DROP FUNCTION IF EXISTS public.get_record_lists CASCADE;
DROP FUNCTION IF EXISTS public.get_filtered_records CASCADE;

-- Drop existing functions from tenant schema if they exist
DROP FUNCTION IF EXISTS tenant.get_enhanced_record_lists CASCADE;
DROP FUNCTION IF EXISTS tenant.create_enhanced_record_list CASCADE;
DROP FUNCTION IF EXISTS tenant.update_enhanced_record_list CASCADE;
DROP FUNCTION IF EXISTS tenant.get_filterable_fields CASCADE;
DROP FUNCTION IF EXISTS tenant.toggle_record_list_status CASCADE;
DROP FUNCTION IF EXISTS tenant.duplicate_record_list CASCADE;
DROP FUNCTION IF EXISTS tenant.get_record_list_stats CASCADE;
DROP FUNCTION IF EXISTS tenant.create_record_list CASCADE;
DROP FUNCTION IF EXISTS tenant.update_record_list CASCADE;
DROP FUNCTION IF EXISTS tenant.delete_record_list CASCADE;
DROP FUNCTION IF EXISTS tenant.get_record_lists CASCADE;

-- ============================================================================
-- TENANT SCHEMA FUNCTIONS
-- ============================================================================

-- Function to get enhanced record lists with new filter system
CREATE OR REPLACE FUNCTION tenant.get_enhanced_record_lists(p_object_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_result jsonb;
BEGIN
  -- Get tenant ID from JWT
  v_tenant_id := (auth.jwt()->'app_metadata'->>'tenant_id')::uuid;
  
  -- Get record lists with enhanced filter structure
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', rl.id,
      'tenant_id', rl.tenant_id,
      'object_id', rl.object_id,
      'name', rl.name,
      'description', rl.description,
      'filter_criteria', COALESCE(rl.filter_criteria, '[]'::jsonb),
      'selected_fields', rl.selected_fields,
      'is_active', rl.is_active,
      'created_at', rl.created_at,
      'updated_at', rl.updated_at,
      'created_by', rl.created_by
    )
    ORDER BY rl.created_at DESC
  ) INTO v_result
  FROM tenant.record_lists rl
  WHERE rl.object_id = p_object_id 
    AND rl.tenant_id = v_tenant_id
    AND rl.is_active = true;
  
  RETURN COALESCE(v_result, '[]'::jsonb);
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error in get_enhanced_record_lists: %', SQLERRM;
END;
$$;

-- Function to create enhanced record list
CREATE OR REPLACE FUNCTION tenant.create_enhanced_record_list(
  p_name text,
  p_object_id uuid,
  p_tenant_id uuid,
  p_description text DEFAULT '',
  p_filter_criteria jsonb DEFAULT '[]'::jsonb,
  p_selected_fields text[] DEFAULT '{}'::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_record_list_id uuid;
  v_result jsonb;
BEGIN
  -- Insert the record list
  INSERT INTO tenant.record_lists (
    tenant_id,
    object_id,
    name,
    description,
    filter_criteria,
    selected_fields,
    is_active,
    created_by
  ) VALUES (
    p_tenant_id,
    p_object_id,
    p_name,
    p_description,
    p_filter_criteria,
    p_selected_fields,
    true,
    auth.uid()::uuid
  ) RETURNING id INTO v_record_list_id;
  
  -- Return the created record list
  SELECT jsonb_build_object(
    'id', rl.id,
    'tenant_id', rl.tenant_id,
    'object_id', rl.object_id,
    'name', rl.name,
    'description', rl.description,
    'filter_criteria', rl.filter_criteria,
    'selected_fields', rl.selected_fields,
    'is_active', rl.is_active,
    'created_at', rl.created_at,
    'updated_at', rl.updated_at,
    'created_by', rl.created_by
  ) INTO v_result
  FROM tenant.record_lists rl
  WHERE rl.id = v_record_list_id;
  
  RETURN v_result;
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error in create_enhanced_record_list: %', SQLERRM;
END;
$$;

-- Function to update enhanced record list
CREATE OR REPLACE FUNCTION tenant.update_enhanced_record_list(
  p_record_list_id uuid,
  p_name text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_filter_criteria jsonb DEFAULT NULL,
  p_selected_fields text[] DEFAULT NULL,
  p_is_active boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_result jsonb;
BEGIN
  -- Get tenant ID from JWT
  v_tenant_id := (auth.jwt()->'app_metadata'->>'tenant_id')::uuid;
  
  -- Update the record list
  UPDATE tenant.record_lists SET
    name = COALESCE(p_name, name),
    description = COALESCE(p_description, description),
    filter_criteria = COALESCE(p_filter_criteria, filter_criteria),
    selected_fields = COALESCE(p_selected_fields, selected_fields),
    is_active = COALESCE(p_is_active, is_active),
    updated_at = NOW()
  WHERE id = p_record_list_id 
    AND tenant_id = v_tenant_id;
  
  -- Return the updated record list
  SELECT jsonb_build_object(
    'id', rl.id,
    'tenant_id', rl.tenant_id,
    'object_id', rl.object_id,
    'name', rl.name,
    'description', rl.description,
    'filter_criteria', rl.filter_criteria,
    'selected_fields', rl.selected_fields,
    'is_active', rl.is_active,
    'created_at', rl.created_at,
    'updated_at', rl.updated_at,
    'created_by', rl.created_by
  ) INTO v_result
  FROM tenant.record_lists rl
  WHERE rl.id = p_record_list_id;
  
  RETURN v_result;
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error in update_enhanced_record_list: %', SQLERRM;
END;
$$;

-- Function to get filterable fields for an object
CREATE OR REPLACE FUNCTION tenant.get_filterable_fields(p_object_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_result jsonb;
BEGIN
  -- Get tenant ID from JWT
  v_tenant_id := (auth.jwt()->'app_metadata'->>'tenant_id')::uuid;
  
  -- Get filterable fields for the object
  SELECT jsonb_agg(
    jsonb_build_object(
      'field_name', f.field_name,
      'field_type', f.field_type,
      'display_name', COALESCE(f.display_name, f.field_name),
      'is_filterable', true
    )
    ORDER BY f.display_name, f.field_name
  ) INTO v_result
  FROM tenant.fields f
  WHERE f.object_id = p_object_id 
    AND f.tenant_id = v_tenant_id
    AND f.is_active = true
    AND f.field_type IN ('text', 'varchar', 'character varying', 'char', 'string', 
                         'integer', 'bigint', 'numeric', 'decimal', 'real', 'double precision', 'float', 'smallint',
                         'date', 'timestamp', 'timestamp without time zone', 'timestamp with time zone', 'time',
                         'boolean', 'bool');
  
  RETURN COALESCE(v_result, '[]'::jsonb);
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error in get_filterable_fields: %', SQLERRM;
END;
$$;

-- Function to toggle record list status
CREATE OR REPLACE FUNCTION tenant.toggle_record_list_status(
  p_record_list_id uuid,
  p_is_active boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  -- Get tenant ID from JWT
  v_tenant_id := (auth.jwt()->'app_metadata'->>'tenant_id')::uuid;
  
  -- Update the record list status
  UPDATE tenant.record_lists SET
    is_active = p_is_active,
    updated_at = NOW()
  WHERE id = p_record_list_id 
    AND tenant_id = v_tenant_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Record list not found or access denied';
  END IF;
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error in toggle_record_list_status: %', SQLERRM;
END;
$$;

-- Function to duplicate a record list
CREATE OR REPLACE FUNCTION tenant.duplicate_record_list(
  p_record_list_id uuid,
  p_new_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_new_record_list_id uuid;
  v_result jsonb;
BEGIN
  -- Get tenant ID from JWT
  v_tenant_id := (auth.jwt()->'app_metadata'->>'tenant_id')::uuid;
  
  -- Insert the duplicated record list
  INSERT INTO tenant.record_lists (
    tenant_id,
    object_id,
    name,
    description,
    filter_criteria,
    selected_fields,
    is_active,
    created_by
  )
  SELECT 
    tenant_id,
    object_id,
    p_new_name,
    description,
    filter_criteria,
    selected_fields,
    true,
    auth.uid()::uuid
  FROM tenant.record_lists
  WHERE id = p_record_list_id 
    AND tenant_id = v_tenant_id
  RETURNING id INTO v_new_record_list_id;
  
  IF v_new_record_list_id IS NULL THEN
    RAISE EXCEPTION 'Record list not found or access denied';
  END IF;
  
  -- Return the duplicated record list
  SELECT jsonb_build_object(
    'id', rl.id,
    'tenant_id', rl.tenant_id,
    'object_id', rl.object_id,
    'name', rl.name,
    'description', rl.description,
    'filter_criteria', rl.filter_criteria,
    'selected_fields', rl.selected_fields,
    'is_active', rl.is_active,
    'created_at', rl.created_at,
    'updated_at', rl.updated_at,
    'created_by', rl.created_by
  ) INTO v_result
  FROM tenant.record_lists rl
  WHERE rl.id = v_new_record_list_id;
  
  RETURN v_result;
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error in duplicate_record_list: %', SQLERRM;
END;
$$;

-- Function to get record list statistics
CREATE OR REPLACE FUNCTION tenant.get_record_list_stats(p_object_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_result jsonb;
BEGIN
  -- Get tenant ID from JWT
  v_tenant_id := (auth.jwt()->'app_metadata'->>'tenant_id')::uuid;
  
  -- Get statistics
  SELECT jsonb_build_object(
    'total_lists', COUNT(*),
    'active_lists', COUNT(*) FILTER (WHERE is_active = true),
    'total_records', 0, -- This would need to be calculated from actual data
    'most_used_lists', jsonb_agg(
      jsonb_build_object(
        'id', id,
        'name', name,
        'usage_count', 0 -- This would need to be tracked separately
      )
    ) FILTER (WHERE is_active = true)
  ) INTO v_result
  FROM tenant.record_lists
  WHERE object_id = p_object_id 
    AND tenant_id = v_tenant_id;
  
  RETURN v_result;
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error in get_record_list_stats: %', SQLERRM;
END;
$$;

-- Function to create a basic record list (legacy support)
CREATE OR REPLACE FUNCTION tenant.create_record_list(
  p_object_id uuid,
  p_tenant_id uuid,
  p_name text,
  p_description text DEFAULT '',
  p_filter_criteria jsonb DEFAULT '[]'::jsonb,
  p_selected_fields text[] DEFAULT '{}'::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_record_list_id uuid;
  v_result jsonb;
BEGIN
  -- Insert the record list
  INSERT INTO tenant.record_lists (
    tenant_id,
    object_id,
    name,
    description,
    filter_criteria,
    selected_fields,
    is_active,
    created_by
  ) VALUES (
    p_tenant_id,
    p_object_id,
    p_name,
    p_description,
    p_filter_criteria,
    p_selected_fields,
    true,
    auth.uid()::uuid
  ) RETURNING id INTO v_record_list_id;
  
  -- Return the created record list
  SELECT jsonb_build_object(
    'id', rl.id,
    'tenant_id', rl.tenant_id,
    'object_id', rl.object_id,
    'name', rl.name,
    'description', rl.description,
    'filter_criteria', rl.filter_criteria,
    'selected_fields', rl.selected_fields,
    'is_active', rl.is_active,
    'created_at', rl.created_at,
    'updated_at', rl.updated_at,
    'created_by', rl.created_by
  ) INTO v_result
  FROM tenant.record_lists rl
  WHERE rl.id = v_record_list_id;
  
  RETURN v_result;
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error in create_record_list: %', SQLERRM;
END;
$$;

-- Function to update a basic record list (legacy support)
CREATE OR REPLACE FUNCTION tenant.update_record_list(
  p_record_list_id uuid,
  p_name text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_filter_criteria jsonb DEFAULT NULL,
  p_is_active boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_result jsonb;
BEGIN
  -- Get tenant ID from JWT
  v_tenant_id := (auth.jwt()->'app_metadata'->>'tenant_id')::uuid;
  
  -- Update the record list
  UPDATE tenant.record_lists SET
    name = COALESCE(p_name, name),
    description = COALESCE(p_description, description),
    filter_criteria = COALESCE(p_filter_criteria, filter_criteria),
    is_active = COALESCE(p_is_active, is_active),
    updated_at = NOW()
  WHERE id = p_record_list_id 
    AND tenant_id = v_tenant_id;
  
  -- Return the updated record list
  SELECT jsonb_build_object(
    'id', rl.id,
    'tenant_id', rl.tenant_id,
    'object_id', rl.object_id,
    'name', rl.name,
    'description', rl.description,
    'filter_criteria', rl.filter_criteria,
    'selected_fields', rl.selected_fields,
    'is_active', rl.is_active,
    'created_at', rl.created_at,
    'updated_at', rl.updated_at,
    'created_by', rl.created_by
  ) INTO v_result
  FROM tenant.record_lists rl
  WHERE rl.id = p_record_list_id;
  
  RETURN v_result;
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error in update_record_list: %', SQLERRM;
END;
$$;

-- Function to delete a record list
CREATE OR REPLACE FUNCTION tenant.delete_record_list(
  p_record_list_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  -- Get tenant ID from JWT
  v_tenant_id := (auth.jwt()->'app_metadata'->>'tenant_id')::uuid;
  
  -- Delete the record list
  DELETE FROM tenant.record_lists 
  WHERE id = p_record_list_id 
    AND tenant_id = v_tenant_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Record list not found or access denied';
  END IF;
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error in delete_record_list: %', SQLERRM;
END;
$$;

-- Function to get basic record lists (for bridge function)
CREATE OR REPLACE FUNCTION tenant.get_record_lists(
  p_object_id uuid,
  p_tenant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Get record lists for the object and tenant
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', rl.id,
      'tenant_id', rl.tenant_id,
      'object_id', rl.object_id,
      'name', rl.name,
      'description', rl.description,
      'filter_criteria', COALESCE(rl.filter_criteria, '[]'::jsonb),
      'selected_fields', rl.selected_fields,
      'is_active', rl.is_active,
      'created_at', rl.created_at,
      'updated_at', rl.updated_at,
      'created_by', rl.created_by
    )
    ORDER BY rl.name
  ) INTO v_result
  FROM tenant.record_lists rl
  WHERE rl.object_id = p_object_id 
    AND rl.tenant_id = p_tenant_id
    AND rl.is_active = true;
  
  RETURN COALESCE(v_result, '[]'::jsonb);
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error in get_record_lists: %', SQLERRM;
END;
$$;

-- Drop existing function to ensure clean recreation
DROP FUNCTION IF EXISTS tenant.get_filtered_records(uuid, jsonb, text[], integer, integer) CASCADE;

-- Function to get filtered records (FIXED VERSION!)
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
  v_order_clause text := 'ORDER BY created_at DESC';
  v_result jsonb;
  v_total_count integer := 0;
  v_filtered_count integer := 0;
  v_tenant_where text;
  v_has_filter boolean := false;
BEGIN
  -- Tenant from JWT, fallback from object
  v_tenant_id := (auth.jwt()->'app_metadata'->>'tenant_id')::uuid;
  IF v_tenant_id IS NULL THEN
    SELECT tenant_id INTO v_tenant_id
    FROM tenant.objects
    WHERE id = p_object_id;
    IF v_tenant_id IS NULL THEN
      RAISE EXCEPTION 'Object not found';
    END IF;
  END IF;

  -- Ensure object belongs to tenant and get table name
  IF NOT EXISTS (
    SELECT 1 FROM tenant.objects
    WHERE id = p_object_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Object not found or access denied';
  END IF;

  SELECT name INTO v_table_name
  FROM tenant.objects
  WHERE id = p_object_id AND tenant_id = v_tenant_id;

  IF v_table_name IS NULL OR v_table_name = '' THEN
    RAISE EXCEPTION 'Object not found or has no name. object_id: %, tenant_id: %', p_object_id, v_tenant_id;
  END IF;

  -- Ensure table exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'tenant' AND table_name = v_table_name
  ) THEN
    RAISE EXCEPTION 'Table % not found in tenant schema', v_table_name;
  END IF;

  -- Build WHERE fragment from filters (no 'WHERE' prefix)
  IF p_filter_criteria IS NOT NULL
     AND jsonb_typeof(p_filter_criteria) = 'array'
     AND jsonb_array_length(p_filter_criteria) > 0 THEN
    v_where_clause := tenant.build_filter_where_clause(p_filter_criteria, v_table_name);
    v_has_filter := length(coalesce(btrim(v_where_clause), '')) > 0;
  END IF;

  -- Always enforce tenant
  IF v_has_filter THEN
    v_where_clause := 'WHERE ' || v_where_clause || ' AND tenant_id = ' || quote_literal(v_tenant_id);
  ELSE
    v_where_clause := 'WHERE tenant_id = ' || quote_literal(v_tenant_id);
  END IF;

  -- JSON array of {record_id, record_data}
  v_sql := format($q$
    SELECT COALESCE(jsonb_agg(row_to_json(s)), '[]'::jsonb)
    FROM (
      SELECT t.id AS record_id, to_jsonb(t) AS record_data
      FROM tenant.%I t
      %s
      %s
      LIMIT %s OFFSET %s
    ) s
  $q$, v_table_name, v_where_clause, v_order_clause, p_limit, p_offset);

  RAISE NOTICE 'Debug: Generated SQL = %', v_sql;

  EXECUTE v_sql INTO v_result;

  -- Counts
  v_tenant_where := format('WHERE tenant_id = %L', v_tenant_id);

  EXECUTE format(
    'SELECT COUNT(*) FROM tenant.%I t %s',
    v_table_name,
    v_tenant_where
  ) INTO v_total_count;

  IF v_has_filter THEN
    EXECUTE format(
      'SELECT COUNT(*) FROM tenant.%I t %s',
      v_table_name,
      v_where_clause
    ) INTO v_filtered_count;
  ELSE
    v_filtered_count := v_total_count;
  END IF;

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

-- Helper function to build WHERE clause from filter criteria
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

-- Grant execute permissions on tenant functions
GRANT EXECUTE ON FUNCTION tenant.get_enhanced_record_lists(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.create_enhanced_record_list(text, uuid, uuid, text, jsonb, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.update_enhanced_record_list(uuid, text, text, jsonb, text[], boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.get_filterable_fields(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.toggle_record_list_status(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.duplicate_record_list(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.get_record_list_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.create_record_list(uuid, uuid, text, text, jsonb, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.update_record_list(uuid, text, text, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.delete_record_list(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.get_record_lists(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.get_filtered_records(uuid, jsonb, text[], integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.build_filter_where_clause(jsonb, text) TO authenticated;

-- Add comments on tenant functions
COMMENT ON FUNCTION tenant.get_enhanced_record_lists(uuid) IS 'Get enhanced record lists with new filter system';
COMMENT ON FUNCTION tenant.create_enhanced_record_list(text, uuid, uuid, text, jsonb, text[]) IS 'Create enhanced record list with new filter system';
COMMENT ON FUNCTION tenant.update_enhanced_record_list(uuid, text, text, jsonb, text[], boolean) IS 'Update enhanced record list with new filter system';
COMMENT ON FUNCTION tenant.get_filterable_fields(uuid) IS 'Get filterable fields for an object';
COMMENT ON FUNCTION tenant.toggle_record_list_status(uuid, boolean) IS 'Toggle record list active status';
COMMENT ON FUNCTION tenant.duplicate_record_list(uuid, text) IS 'Duplicate an existing record list';
COMMENT ON FUNCTION tenant.get_record_list_stats(uuid) IS 'Get statistics for record lists';
COMMENT ON FUNCTION tenant.create_record_list(uuid, uuid, text, text, jsonb, text[]) IS 'Create a basic record list (legacy support)';
COMMENT ON FUNCTION tenant.update_record_list(uuid, text, text, jsonb, boolean) IS 'Update a basic record list (legacy support)';
COMMENT ON FUNCTION tenant.delete_record_list(uuid) IS 'Delete a record list';
COMMENT ON FUNCTION tenant.get_record_lists(uuid, uuid) IS 'Get basic record lists for an object and tenant';
COMMENT ON FUNCTION tenant.get_filtered_records(uuid, jsonb, text[], integer, integer) IS 'Get filtered records using the new filter system';
COMMENT ON FUNCTION tenant.build_filter_where_clause(jsonb, text) IS 'Helper function to build SQL WHERE clause from structured filter criteria';

-- ============================================================================
-- BRIDGE FUNCTIONS IN PUBLIC SCHEMA
-- ============================================================================
-- These bridge functions allow the REST API to access tenant schema functions
-- following the established pattern used throughout the codebase

-- Bridge function to create enhanced record list
CREATE OR REPLACE FUNCTION public.create_enhanced_record_list(
  p_name text,
  p_object_id uuid,
  p_tenant_id uuid,
  p_description text DEFAULT '',
  p_filter_criteria jsonb DEFAULT '[]'::jsonb,
  p_selected_fields text[] DEFAULT '{}'::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN tenant.create_enhanced_record_list(
    p_name,
    p_object_id,
    p_tenant_id,
    p_description,
    p_filter_criteria,
    p_selected_fields
  );
END;
$$;

-- Bridge function to get record lists (basic)
CREATE OR REPLACE FUNCTION public.get_record_lists(p_object_id uuid, p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN tenant.get_record_lists(p_object_id, p_tenant_id);
END;
$$;

-- Bridge function to get enhanced record lists
CREATE OR REPLACE FUNCTION public.get_enhanced_record_lists(p_object_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN tenant.get_enhanced_record_lists(p_object_id);
END;
$$;

-- Bridge function to update enhanced record list
CREATE OR REPLACE FUNCTION public.update_enhanced_record_list(
  p_record_list_id uuid,
  p_name text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_filter_criteria jsonb DEFAULT NULL,
  p_selected_fields text[] DEFAULT NULL,
  p_is_active boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN tenant.update_enhanced_record_list(
    p_record_list_id,
    p_name,
    p_description,
    p_filter_criteria,
    p_selected_fields,
    p_is_active
  );
END;
$$;

-- Bridge function to get filterable fields
CREATE OR REPLACE FUNCTION public.get_filterable_fields(p_object_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN tenant.get_filterable_fields(p_object_id);
END;
$$;

-- Bridge function to toggle record list status
CREATE OR REPLACE FUNCTION public.toggle_record_list_status(
  p_record_list_id uuid,
  p_is_active boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM tenant.toggle_record_list_status(p_record_list_id, p_is_active);
END;
$$;

-- Bridge function to duplicate record list
CREATE OR REPLACE FUNCTION public.duplicate_record_list(
  p_record_list_id uuid,
  p_new_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN tenant.duplicate_record_list(p_record_list_id, p_new_name);
END;
$$;

-- Bridge function to get record list stats
CREATE OR REPLACE FUNCTION public.get_record_list_stats(p_object_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN tenant.get_record_list_stats(p_object_id);
END;
$$;

-- Bridge function to create basic record list (legacy support)
CREATE OR REPLACE FUNCTION public.create_record_list(
  p_object_id uuid,
  p_tenant_id uuid,
  p_name text,
  p_description text DEFAULT '',
  p_filter_criteria jsonb DEFAULT '[]'::jsonb,
  p_selected_fields text[] DEFAULT '{}'::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN tenant.create_record_list(
    p_object_id,
    p_tenant_id,
    p_name,
    p_description,
    p_filter_criteria,
    p_selected_fields
  );
END;
$$;

-- Bridge function to update basic record list (legacy support)
CREATE OR REPLACE FUNCTION public.update_record_list(
  p_record_list_id uuid,
  p_name text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_filter_criteria jsonb DEFAULT NULL,
  p_is_active boolean DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM tenant.update_record_list(
    p_record_list_id,
    p_name,
    p_description,
    p_filter_criteria,
    p_is_active
  );
END;
$$;

-- Bridge function to delete record list
CREATE OR REPLACE FUNCTION public.delete_record_list(p_record_list_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM tenant.delete_record_list(p_record_list_id);
END;
$$;

-- Bridge function for get_filtered_records (MISSING FUNCTION!)
CREATE OR REPLACE FUNCTION public.get_filtered_records(
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
BEGIN
  RETURN tenant.get_filtered_records(
    p_object_id,
    p_filter_criteria,
    p_selected_fields,
    p_limit,
    p_offset
  );
END;
$$;

-- Grant execute permissions on bridge functions
GRANT EXECUTE ON FUNCTION public.create_enhanced_record_list(text, uuid, uuid, text, jsonb, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_record_lists(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_enhanced_record_lists(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_enhanced_record_list(uuid, text, text, jsonb, text[], boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_filterable_fields(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_record_list_status(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.duplicate_record_list(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_record_list_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_record_list(uuid, uuid, text, text, jsonb, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_record_list(uuid, text, text, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_record_list(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_filtered_records(uuid, jsonb, text[], integer, integer) TO authenticated;

-- Add comments on bridge functions
COMMENT ON FUNCTION public.create_enhanced_record_list(text, uuid, uuid, text, jsonb, text[]) IS 'Bridge function to access tenant.create_enhanced_record_list through REST API';
COMMENT ON FUNCTION public.get_record_lists(uuid, uuid) IS 'Bridge function to access tenant.get_record_lists through REST API';
COMMENT ON FUNCTION public.get_enhanced_record_lists(uuid) IS 'Bridge function to access tenant.get_enhanced_record_lists through REST API';
COMMENT ON FUNCTION public.update_enhanced_record_list(uuid, text, text, jsonb, text[], boolean) IS 'Bridge function to access tenant.update_enhanced_record_list through REST API';
COMMENT ON FUNCTION public.get_filterable_fields(uuid) IS 'Bridge function to access tenant.get_filterable_fields through REST API';
COMMENT ON FUNCTION public.toggle_record_list_status(uuid, boolean) IS 'Bridge function to access tenant.toggle_record_list_status through REST API';
COMMENT ON FUNCTION public.duplicate_record_list(uuid, text) IS 'Bridge function to access tenant.duplicate_record_list through REST API';
COMMENT ON FUNCTION public.get_record_list_stats(uuid) IS 'Bridge function to access tenant.get_record_list_stats through REST API';
COMMENT ON FUNCTION public.create_record_list(uuid, uuid, text, text, jsonb, text[]) IS 'Bridge function to access tenant.create_record_list through REST API';
COMMENT ON FUNCTION public.update_record_list(uuid, text, text, jsonb, boolean) IS 'Bridge function to access tenant.update_record_list through REST API';
COMMENT ON FUNCTION public.delete_record_list(uuid) IS 'Bridge function to access tenant.delete_record_list through REST API';
COMMENT ON FUNCTION public.get_filtered_records(uuid, jsonb, text[], integer, integer) IS 'Bridge function to access tenant.get_filtered_records through REST API';
