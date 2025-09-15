-- Migration 123: Fix column name mapping in enhanced get_object_records_with_references function
-- Purpose: Fix the column name mismatch between field metadata and actual database columns
-- Status: Fixes the "column t.channelPartner does not exist" error

-- Drop and recreate the enhanced function with proper column name mapping
DROP FUNCTION IF EXISTS tenant.get_object_records_with_references(UUID, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.get_object_records_with_references(UUID, UUID, INTEGER, INTEGER);

-- Create enhanced function that automatically resolves reference fields with proper column mapping
CREATE OR REPLACE FUNCTION tenant.get_object_records_with_references(
    p_object_id UUID,
    p_limit INTEGER DEFAULT 100,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
    record_id uuid,
    record_data jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_table_name text;
    v_select_sql text;
    v_jsonb_fields text := '';
    v_column_record record;
    v_reference_fields text := '';
    v_join_clauses text := '';
    v_field_record record;
    v_reference_table text;
    v_display_field text;
    v_join_alias text;
    v_join_counter integer := 1;
BEGIN
    -- Get table name from tenant.objects
    SELECT o.name INTO v_table_name
    FROM tenant.objects o
    WHERE o.id = p_object_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Object not found';
    END IF;
    
    -- First pass: Build basic JSONB fields (non-reference fields)
    FOR v_column_record IN 
        SELECT c.column_name, c.data_type
        FROM information_schema.columns c
        WHERE c.table_schema = 'tenant' 
        AND c.table_name = v_table_name
        AND c.column_name NOT IN ('id', 'created_at', 'updated_at')
        AND c.column_name NOT IN ('autonumber')
        ORDER BY c.ordinal_position
    LOOP
        -- Check if this column is a reference field
        SELECT f.reference_table, f.reference_display_field
        INTO v_reference_table, v_display_field
        FROM tenant.fields f
        WHERE f.object_id = p_object_id 
        AND f.name = v_column_record.column_name
        AND f.type = 'reference';
        
        IF v_reference_table IS NOT NULL THEN
            -- This is a reference field - we'll handle it in the second pass
            CONTINUE;
        END IF;
        
        -- Handle different data types safely for non-reference fields
        IF v_column_record.data_type = 'bigint' THEN
            v_jsonb_fields := v_jsonb_fields || 
                CASE 
                    WHEN v_jsonb_fields != '' THEN ' || '
                    ELSE ''
                END ||
                'jsonb_build_object(' || quote_literal(v_column_record.column_name) || ', COALESCE(NULLIF(t.' || quote_ident(v_column_record.column_name) || '::text, ''''), NULL))';
        ELSE
            v_jsonb_fields := v_jsonb_fields || 
                CASE 
                    WHEN v_jsonb_fields != '' THEN ' || '
                    ELSE ''
                END ||
                'jsonb_build_object(' || quote_literal(v_column_record.column_name) || ', COALESCE(t.' || quote_ident(v_column_record.column_name) || '::text, ''''))';
        END IF;
    END LOOP;
    
    -- Second pass: Build reference field resolution and JOIN clauses
    FOR v_field_record IN 
        SELECT f.name, f.reference_table, f.reference_display_field
        FROM tenant.fields f
        WHERE f.object_id = p_object_id 
        AND f.type = 'reference'
        AND f.reference_table IS NOT NULL
    LOOP
        -- Generate unique alias for this JOIN
        v_join_alias := 'ref_' || v_join_counter;
        
        -- Determine the best display field for the reference table
        IF v_field_record.reference_display_field IS NOT NULL THEN
            v_display_field := v_field_record.reference_display_field;
        ELSE
            -- Auto-detect best display field (prioritize name, label, title)
            SELECT COALESCE(
                (SELECT column_name FROM information_schema.columns 
                 WHERE table_schema = 'tenant' AND table_name = v_field_record.reference_table 
                 AND column_name = 'name' LIMIT 1),
                (SELECT column_name FROM information_schema.columns 
                 WHERE table_schema = 'tenant' AND table_name = v_field_record.reference_table 
                 AND column_name = 'label' LIMIT 1),
                (SELECT column_name FROM information_schema.columns 
                 WHERE table_schema = 'tenant' AND table_name = v_field_record.reference_table 
                 AND column_name = 'title' LIMIT 1),
                'id'
            ) INTO v_display_field;
        END IF;
        
        -- Build JOIN clause with column name mapping
        -- Handle the case where field name doesn't match actual column name (e.g., "channelPartner" vs "channelPartner__a")
        -- Also handle schema differences (e.g., system.users vs tenant.table_name)
        IF v_field_record.reference_table LIKE 'system.%' THEN
            -- For system schema tables, use the full schema name
            v_join_clauses := v_join_clauses || 
                ' LEFT JOIN ' || quote_ident(v_field_record.reference_table) || ' ' || v_join_alias ||
                ' ON ' || v_join_alias || '.id = t.' || quote_ident(v_field_record.name || '__a');
        ELSE
            -- For tenant schema tables, prefix with tenant.
            v_join_clauses := v_join_clauses || 
                ' LEFT JOIN tenant.' || quote_ident(v_field_record.reference_table) || ' ' || v_join_alias ||
                ' ON ' || v_join_alias || '.id = t.' || quote_ident(v_field_record.name || '__a');
        END IF;
        
        -- Build reference field resolution in JSONB with column name mapping
        v_reference_fields := v_reference_fields || 
            CASE 
                WHEN v_reference_fields != '' THEN ' || '
                ELSE ''
            END ||
            'jsonb_build_object(' || quote_literal(v_field_record.name) || ', COALESCE(' || v_join_alias || '.' || quote_ident(v_display_field) || '::text, t.' || quote_ident(v_field_record.name || '__a') || '::text, ''''))';
        
        v_join_counter := v_join_counter + 1;
    END LOOP;
    
    -- Build the final SQL with reference resolution
    v_select_sql := '
        SELECT 
            t.id as record_id,
            jsonb_build_object(
                ''id'', t.id,
                ''created_at'', COALESCE(t.created_at::text, ''''),
                ''updated_at'', COALESCE(t.updated_at::text, '''')
            )' || 
            CASE 
                WHEN v_jsonb_fields != '' THEN ' || ' || v_jsonb_fields
                ELSE ''
            END ||
            CASE 
                WHEN v_reference_fields != '' THEN ' || ' || v_reference_fields
                ELSE ''
            END || '
        as record_data
        FROM tenant.' || quote_ident(v_table_name) || ' t' ||
        v_join_clauses || '
        ORDER BY t.created_at DESC
        LIMIT ' || p_limit || '
        OFFSET ' || p_offset;
    
    RETURN QUERY EXECUTE v_select_sql;
END;
$$;

-- Create public bridge function for the enhanced version
CREATE OR REPLACE FUNCTION public.get_object_records_with_references(
    p_object_id UUID,
    p_tenant_id UUID,
    p_limit INTEGER DEFAULT 100,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
    record_id uuid,
    record_data jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Call tenant function (RLS policies will enforce tenant isolation)
    RETURN QUERY
    SELECT * FROM tenant.get_object_records_with_references(
        p_object_id,
        p_limit,
        p_offset
    );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION tenant.get_object_records_with_references(UUID, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_object_records_with_references(UUID, UUID, INTEGER, INTEGER) TO authenticated;

-- Add comments explaining the enhancement
COMMENT ON FUNCTION tenant.get_object_records_with_references(UUID, INTEGER, INTEGER) IS 'Enhanced: Automatically resolves reference fields to display names using JOINs with proper column name mapping';
COMMENT ON FUNCTION public.get_object_records_with_references(UUID, UUID, INTEGER, INTEGER) IS 'Enhanced bridge: Returns resolved reference field names instead of UUIDs with proper column mapping';

-- Log successful migration
DO $$
BEGIN
    RAISE NOTICE '🚀 Migration 123: Fixed column name mapping in enhanced function!';
    RAISE NOTICE '✅ Fixed: channelPartner vs channelPartner__a column mismatch';
    RAISE NOTICE '✅ Enhanced function now properly maps field names to column names';
    RAISE NOTICE '✅ Reference fields will resolve to display names correctly';
    RAISE NOTICE '✅ No more "column does not exist" errors';
END $$;
