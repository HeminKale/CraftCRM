-- Migration: 095_create_record_creation_rpc.sql
-- Description: Create RPC function to create new object records
-- Date: 2024-01-XX

-- Force drop the old function first
DROP FUNCTION IF EXISTS create_object_record(UUID, UUID, JSONB);

-- Function to create a new object record
CREATE OR REPLACE FUNCTION create_object_record(
  p_object_id UUID,
  p_tenant_id UUID,
  p_record_data JSONB
)
RETURNS TABLE (
  record_id UUID,
  success BOOLEAN,
  message TEXT
) AS $$
DECLARE
  v_table_name TEXT;
  v_record_id UUID;
  v_sql TEXT;
  v_key TEXT;
  v_value TEXT;
  v_keys TEXT[] := '{}';
  v_values TEXT[] := '{}';
  v_inserted_id UUID;
BEGIN
  -- Get the table name for the object (FIXED: use 'name' column, not 'table_name')
  SELECT name INTO v_table_name
  FROM tenant.objects
  WHERE id = p_object_id
    AND tenant_id = p_tenant_id;
  
  IF v_table_name IS NULL THEN
    RETURN QUERY SELECT 
      gen_random_uuid()::UUID as record_id,
      false as success,
      'Object not found' as message;
    RETURN;
  END IF;
  
  -- Generate a new record ID
  v_record_id := gen_random_uuid();
  
  -- Extract keys and values from JSONB
  FOR v_key, v_value IN SELECT * FROM jsonb_each_text(p_record_data)
  LOOP
    v_keys := array_append(v_keys, v_key);
    v_values := array_append(v_values, v_value);
  END LOOP;
  
  -- Build SQL with proper string quoting using quote_literal
  v_sql := format(
    'INSERT INTO tenant.%I (id, tenant_id, %s) VALUES (%L, %L, %s) RETURNING id',
    v_table_name,
    array_to_string(v_keys, ', '),
    v_record_id,
    p_tenant_id,
    array_to_string(array_map(x => quote_literal(x), v_values), ', ')
  );
  
  -- Debug: Log the SQL being executed
  RAISE NOTICE 'Executing SQL: %', v_sql;
  RAISE NOTICE 'Keys: %', v_keys;
  RAISE NOTICE 'Values: %', v_values;
  
  -- Execute the insert
  EXECUTE v_sql INTO v_inserted_id;
  
  -- Check if insert was successful
  IF v_inserted_id IS NULL THEN
    RETURN QUERY SELECT 
      gen_random_uuid()::UUID as record_id,
      false as success,
      'Insert failed - no ID returned' as message;
    RETURN;
  END IF;
  
  -- Return single row (not table)
  RETURN QUERY SELECT 
    v_record_id as record_id,
    true as success,
    'Record created successfully' as message
  LIMIT 1;
    
EXCEPTION WHEN OTHERS THEN
  -- Log the error details
  RAISE NOTICE 'Error in create_object_record: %', SQLERRM;
  RAISE NOTICE 'SQL State: %', SQLSTATE;
  RAISE NOTICE 'Generated SQL: %', v_sql;
  
  RETURN QUERY SELECT 
    gen_random_uuid()::UUID as record_id,
    false as success,
    'Error creating record: ' || SQLERRM as message
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION create_object_record(UUID, UUID, JSONB) TO authenticated;

-- Function to get reference options for dropdowns
CREATE OR REPLACE FUNCTION get_reference_options(
  p_table_name TEXT,
  p_tenant_id UUID,
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  label TEXT
) AS $$
DECLARE
  v_sql TEXT;
BEGIN
  -- Build dynamic SQL to get reference options
  v_sql := format(
    'SELECT id, COALESCE(name, label, id::text) as name, COALESCE(label, name, id::text) as label FROM tenant.%I WHERE tenant_id = $1 ORDER BY COALESCE(name, label, id::text) LIMIT $2',
    p_table_name
  );
  
  RETURN QUERY EXECUTE v_sql USING p_tenant_id, p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_reference_options(TEXT, UUID, INTEGER) TO authenticated;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE '✅ Migration 095 completed: Record creation RPC functions created';
  RAISE NOTICE '🔧 Functions: create_object_record, get_reference_options';
  RAISE NOTICE '📝 Purpose: Create new records and load reference field options';
  RAISE NOTICE '🔧 FIXED: table_name lookup now uses objects.name column';
  RAISE NOTICE '🔧 FIXED: Removed array_fill function dependency';
  RAISE NOTICE '🔧 FIXED: Added DROP FUNCTION to force recreation';
  RAISE NOTICE '🔧 FIXED: Added better error handling and debugging';
  RAISE NOTICE '🔧 FIXED: Fixed string quoting issues with quote_literal';
  RAISE NOTICE '�� FIXED: Added LIMIT 1 to return single object instead of array';
END $$;