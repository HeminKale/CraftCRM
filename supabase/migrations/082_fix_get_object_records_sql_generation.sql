-- Migration 082: Fix get_object_records SQL generation bug
-- Purpose: Fix malformed column headers caused by incorrect quote_literal usage

-- Drop and recreate the tenant function with fixed SQL generation
DROP FUNCTION IF EXISTS tenant.get_object_records(UUID, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION tenant.get_object_records(
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
BEGIN
    -- Get table name from tenant.objects
    SELECT o.name INTO v_table_name
    FROM tenant.objects o
    WHERE o.id = p_object_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Object not found';
    END IF;
    
    -- Build JSONB fields dynamically based on what columns actually exist
    -- SKIP problematic columns that might cause conversion errors
    FOR v_column_record IN 
        SELECT column_name, data_type
        FROM information_schema.columns 
        WHERE table_schema = 'tenant' 
        AND table_name = v_table_name
        AND column_name NOT IN ('id', 'created_at', 'updated_at')
        -- Skip autonumber and other potentially problematic columns
        AND column_name NOT IN ('autonumber')
        ORDER BY ordinal_position
    LOOP
        -- Handle different data types safely
        IF v_column_record.data_type = 'bigint' THEN
            -- For bigint columns, use NULLIF to handle empty strings safely
            v_jsonb_fields := v_jsonb_fields || 
                CASE 
                    WHEN v_jsonb_fields != '' THEN ' || '
                    ELSE ''
                END ||
                'jsonb_build_object(' || quote_literal(v_column_record.column_name) || ', COALESCE(NULLIF(t.' || quote_ident(v_column_record.column_name) || '::text, ''''), NULL))';
        ELSE
            -- For other columns, use the original logic
            v_jsonb_fields := v_jsonb_fields || 
                CASE 
                    WHEN v_jsonb_fields != '' THEN ' || '
                    ELSE ''
                END ||
                'jsonb_build_object(' || quote_literal(v_column_record.column_name) || ', COALESCE(t.' || quote_ident(v_column_record.column_name) || '::text, ''''))';
        END IF;
    END LOOP;
    
    -- Build the final SQL with UUID return type
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
            END || '
        as record_data
        FROM tenant.' || quote_ident(v_table_name) || ' t
        ORDER BY t.created_at DESC
        LIMIT ' || p_limit || '
        OFFSET ' || p_offset;
    
    RETURN QUERY EXECUTE v_select_sql;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION tenant.get_object_records(UUID, INTEGER, INTEGER) TO authenticated;

-- Add comment explaining the fix
COMMENT ON FUNCTION tenant.get_object_records(UUID, INTEGER, INTEGER) IS 'Fixed: SQL generation bug resolved - proper quote_literal usage';

-- Log successful migration
DO $$
BEGIN
    RAISE NOTICE '🚀 Migration 082: get_object_records SQL generation bug fixed!';
    RAISE NOTICE '✅ Fixed malformed column headers (no more || QUOTE LITERAL... ||)';
    RAISE NOTICE '✅ Proper quote_literal function usage';
    RAISE NOTICE '✅ Clean column names in table headers';
END $$;
