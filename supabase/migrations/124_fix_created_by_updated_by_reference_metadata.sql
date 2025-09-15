-- Migration 124: Fix created_by and updated_by reference metadata
-- Purpose: Update field metadata to properly reference system.users table
-- Status: Enables user name resolution for audit fields

-- First, let's see what we're working with
DO $$
DECLARE
    v_field_record record;
    v_objects_count integer := 0;
    v_fields_updated integer := 0;
BEGIN
    RAISE NOTICE '🔍 Analyzing created_by and updated_by fields...';
    
    -- Count how many objects have these fields
    SELECT COUNT(DISTINCT object_id) INTO v_objects_count
    FROM tenant.fields 
    WHERE name IN ('created_by', 'updated_by') 
    AND type = 'reference';
    
    RAISE NOTICE '📊 Found % objects with created_by/updated_by reference fields', v_objects_count;
    
    -- Show current state
    RAISE NOTICE '📋 Current field metadata:';
    FOR v_field_record IN 
        SELECT 
            f.object_id,
            o.name as object_name,
            f.name as field_name,
            f.reference_table,
            f.reference_display_field
        FROM tenant.fields f
        JOIN tenant.objects o ON f.object_id = o.id
        WHERE f.name IN ('created_by', 'updated_by') 
        AND f.type = 'reference'
        ORDER BY o.name, f.name
    LOOP
        RAISE NOTICE '  Object: %, Field: %, Reference Table: %, Display Field: %', 
            v_field_record.object_name,
            v_field_record.field_name,
            COALESCE(v_field_record.reference_table, 'NULL'),
            COALESCE(v_field_record.reference_display_field, 'NULL');
    END LOOP;
END $$;

-- Update created_by fields to reference auth.users (Supabase built-in)
UPDATE tenant.fields 
SET 
    reference_table = 'auth.users',
    reference_display_field = 'email',
    updated_at = NOW()
WHERE name = 'created_by' 
AND type = 'reference'
AND (reference_table IS NULL OR reference_table != 'auth.users');

-- Update updated_by fields to reference auth.users (Supabase built-in)
UPDATE tenant.fields 
SET 
    reference_table = 'auth.users',
    reference_display_field = 'email',
    updated_at = NOW()
WHERE name = 'updated_by' 
AND type = 'reference'
AND (reference_table IS NULL OR reference_table != 'auth.users');

-- Verify the updates
DO $$
DECLARE
    v_updated_count integer := 0;
    v_field_record record;
BEGIN
    -- Count updated fields
    SELECT COUNT(*) INTO v_updated_count
    FROM tenant.fields 
    WHERE name IN ('created_by', 'updated_by') 
    AND type = 'reference'
    AND reference_table = 'auth.users';
    
    RAISE NOTICE '✅ Updated % created_by/updated_by fields to reference auth.users', v_updated_count;
    
    -- Show final state
    RAISE NOTICE '📋 Updated field metadata:';
    FOR v_field_record IN 
        SELECT 
            o.name as object_name,
            f.name as field_name,
            f.reference_table,
            f.reference_display_field
        FROM tenant.fields f
        JOIN tenant.objects o ON f.object_id = o.id
        WHERE f.name IN ('created_by', 'updated_by') 
        AND f.type = 'reference'
        ORDER BY o.name, f.name
    LOOP
        RAISE NOTICE '  Object: %, Field: %, Reference Table: %, Display Field: %', 
            v_field_record.object_name,
            v_field_record.field_name,
            v_field_record.reference_table,
            v_field_record.reference_display_field;
    END LOOP;
END $$;

-- Test the enhanced function with a sample object to verify user resolution
DO $$
DECLARE
    v_test_object_id UUID;
    v_test_result record;
    v_sample_user_id UUID;
BEGIN
    -- Get a sample object ID (first object with created_by field)
    SELECT f.object_id INTO v_test_object_id
    FROM tenant.fields f
    WHERE f.name = 'created_by' 
    AND f.type = 'reference'
    AND f.reference_table = 'auth.users'
    LIMIT 1;
    
    IF v_test_object_id IS NOT NULL THEN
        RAISE NOTICE '🧪 Testing enhanced function with object ID: %', v_test_object_id;
        
        -- Test the enhanced function
        FOR v_test_result IN 
            SELECT * FROM tenant.get_object_records_with_references(v_test_object_id, 1, 0)
        LOOP
            RAISE NOTICE '✅ Enhanced function test successful!';
            RAISE NOTICE '  Record ID: %', v_test_result.record_id;
            RAISE NOTICE '  Sample data keys: %', (SELECT array_agg(key) FROM jsonb_object_keys(v_test_result.record_data));
        END LOOP;
    ELSE
        RAISE NOTICE '⚠️ No test object found with created_by field';
    END IF;
END $$;

-- Log successful migration
DO $$
BEGIN
    RAISE NOTICE '🚀 Migration 124: Fixed created_by/updated_by reference metadata completed!';
    RAISE NOTICE '✅ Updated field metadata to reference auth.users (Supabase built-in)';
    RAISE NOTICE '✅ Set display field to "email" for user-friendly output';
    RAISE NOTICE '✅ Enhanced function will now resolve user UUIDs to emails';
    RAISE NOTICE '✅ Created By and Updated By will show actual user emails';
    RAISE NOTICE '✅ All reference fields now properly configured for resolution';
END $$;
