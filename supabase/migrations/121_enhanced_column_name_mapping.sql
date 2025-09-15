-- Migration 121: Enhanced Column Name Mapping for Related Lists
-- Provide a more robust solution for mapping field names to actual database columns
-- Handles mixed scenarios where some fields already have __a suffix and others don't
-- ================================

-- Drop the existing function first
DROP FUNCTION IF EXISTS get_related_list_records(uuid, uuid, uuid, uuid);

-- Create the enhanced function with intelligent column name mapping
CREATE OR REPLACE FUNCTION get_related_list_records(
  p_parent_object_id UUID,
  p_parent_record_id UUID,
  p_tenant_id UUID,
  p_related_list_id UUID
)
RETURNS TABLE(
  record_id UUID,
  record_data JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_child_object_id UUID;
  v_foreign_key_field TEXT;
  v_child_table_name TEXT;
  v_actual_column_name TEXT;
  v_sql TEXT;
  v_column_exists BOOLEAN;
BEGIN
  -- Get related list metadata
  SELECT child_object_id, foreign_key_field 
  INTO v_child_object_id, v_foreign_key_field
  FROM tenant.related_list_metadata 
  WHERE id = p_related_list_id 
  AND parent_object_id = p_parent_object_id
  AND tenant_id = p_tenant_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Related list not found for object %', p_parent_object_id;
  END IF;
  
  -- Get child object table name
  SELECT name INTO v_child_table_name
  FROM tenant.objects 
  WHERE id = v_child_object_id 
  AND tenant_id = p_tenant_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Child object not found';
  END IF;
  
  -- Try to find the actual column name using multiple strategies
  -- Strategy 1: Try the exact field name first (handles cases like "channelPartner__a")
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'tenant' 
    AND table_name = v_child_table_name 
    AND column_name = v_foreign_key_field
  ) INTO v_column_exists;
  
  IF v_column_exists THEN
    v_actual_column_name := v_foreign_key_field;
    RAISE NOTICE '✅ Found exact column match: %', v_actual_column_name;
  ELSE
    -- Strategy 2: Try with "__a" suffix (handles cases like "Client_name" -> "Client_name__a")
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'tenant' 
      AND table_name = v_child_table_name 
      AND column_name = v_foreign_key_field || '__a'
    ) INTO v_column_exists;
    
    IF v_column_exists THEN
      v_actual_column_name := v_foreign_key_field || '__a';
      RAISE NOTICE '✅ Found column with __a suffix: % -> %', v_foreign_key_field, v_actual_column_name;
    ELSE
      -- Strategy 3: Try with "_a" suffix (alternative pattern)
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'tenant' 
        AND table_name = v_child_table_name 
        AND column_name = v_foreign_key_field || '_a'
      ) INTO v_column_exists;
      
      IF v_column_exists THEN
        v_actual_column_name := v_foreign_key_field || '_a';
        RAISE NOTICE '✅ Found column with _a suffix: % -> %', v_foreign_key_field, v_actual_column_name;
      ELSE
        -- Strategy 4: Search for columns that contain the field name
        SELECT column_name INTO v_actual_column_name
        FROM information_schema.columns 
        WHERE table_schema = 'tenant' 
        AND table_name = v_child_table_name 
        AND column_name LIKE '%' || v_foreign_key_field || '%'
        LIMIT 1;
        
        IF v_actual_column_name IS NOT NULL THEN
          RAISE NOTICE '✅ Found column with pattern match: % -> %', v_foreign_key_field, v_actual_column_name;
        ELSE
          -- Strategy 5: If field already ends with __a, try without it
          IF v_foreign_key_field LIKE '%__a' THEN
            SELECT EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_schema = 'tenant' 
              AND table_name = v_child_table_name 
              AND column_name = substring(v_foreign_key_field, 1, length(v_foreign_key_field) - 3)
            ) INTO v_column_exists;
            
            IF v_column_exists THEN
              v_actual_column_name := substring(v_foreign_key_field, 1, length(v_foreign_key_field) - 3);
              RAISE NOTICE '✅ Found column without __a suffix: % -> %', v_foreign_key_field, v_actual_column_name;
            ELSE
              RAISE EXCEPTION 'Could not find column for field "%" in table "tenant.%". Available columns: %', 
                v_foreign_key_field, 
                v_child_table_name,
                (SELECT string_agg(column_name, ', ') FROM information_schema.columns 
                 WHERE table_schema = 'tenant' AND table_name = v_child_table_name);
            END IF;
          ELSE
            RAISE EXCEPTION 'Could not find column for field "%" in table "tenant.%". Available columns: %', 
              v_foreign_key_field, 
              v_child_table_name,
              (SELECT string_agg(column_name, ', ') FROM information_schema.columns 
               WHERE table_schema = 'tenant' AND table_name = v_child_table_name);
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;
  
  -- Build dynamic SQL to fetch related records using the found column name
  v_sql := format(
    'SELECT id as record_id, to_jsonb(t.*) as record_data, created_at, updated_at 
     FROM tenant.%I t 
     WHERE tenant_id = %L 
     AND %I = %L',
    v_child_table_name,
    p_tenant_id,
    v_actual_column_name,
    p_parent_record_id
  );
  
  -- Log the SQL for debugging
  RAISE NOTICE '🔍 Executing SQL: %', v_sql;
  RAISE NOTICE '📋 Field mapping: % -> %', v_foreign_key_field, v_actual_column_name;
  
  RETURN QUERY EXECUTE v_sql;
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error in get_related_list_records: % (Field: %, Mapped Column: %, Table: %)', 
      SQLERRM, v_foreign_key_field, v_actual_column_name, v_child_table_name;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_related_list_records(uuid, uuid, uuid, uuid) TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION get_related_list_records IS 'Enhanced function with intelligent column name mapping for related list queries. Handles mixed __a suffix scenarios.';

-- Log completion
DO $$
BEGIN
  RAISE NOTICE '✅ Migration 121 completed: Enhanced get_related_list_records function';
  RAISE NOTICE '🔧 Intelligent column mapping with multiple fallback strategies';
  RAISE NOTICE '📝 Handles various naming patterns: exact, __a, _a, pattern matching, and reverse __a removal';
  RAISE NOTICE '🎯 Specifically designed to handle mixed scenarios like channelPartner__a vs Client_name';
END $$;
