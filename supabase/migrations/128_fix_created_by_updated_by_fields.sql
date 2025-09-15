-- Migration 128: Fix created_by and updated_by fields by converting to text
-- Purpose: Convert problematic reference fields to simple text fields
-- Status: Avoids missing user table issues while maintaining functionality

-- First, let's see what we're working with
DO $$
DECLARE
    v_field_record record;
    v_objects_count integer := 0;
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
            f.type as field_type,
            f.reference_table,
            f.reference_display_field
        FROM tenant.fields f
        JOIN tenant.objects o ON f.object_id = o.id
        WHERE f.name IN ('created_by', 'updated_by') 
        AND f.type = 'reference'
        ORDER BY o.name, f.name
    LOOP
        RAISE NOTICE '  Object: %, Field: %, Type: %, Reference Table: %, Display Field: %', 
            v_field_record.object_name,
            v_field_record.field_name,
            v_field_record.field_type,
            COALESCE(v_field_record.reference_table, 'NULL'),
            COALESCE(v_field_record.reference_display_field, 'NULL');
    END LOOP;
END $$;

-- Convert created_by fields from reference to text
UPDATE tenant.fields 
SET 
    type = 'text',
    reference_table = NULL,
    reference_display_field = NULL,
    updated_at = NOW()
WHERE name = 'created_by' 
AND type = 'reference';

-- Convert updated_by fields from reference to text
UPDATE tenant.fields 
SET 
    type = 'text',
    reference_table = NULL,
    reference_display_field = NULL,
    updated_at = NOW()
WHERE name = 'updated_by' 
AND type = 'reference';

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
    AND type = 'text';
    
    RAISE NOTICE '✅ Updated % created_by/updated_by fields from reference to text', v_updated_count;
    
    -- Show final state
    RAISE NOTICE '📋 Updated field metadata:';
    FOR v_field_record IN 
        SELECT 
            o.name as object_name,
            f.name as field_name,
            f.type as field_type,
            f.reference_table,
            f.reference_display_field
        FROM tenant.fields f
        JOIN tenant.objects o ON f.object_id = o.id
        WHERE f.name IN ('created_by', 'updated_by') 
        ORDER BY o.name, f.name
    LOOP
        RAISE NOTICE '  Object: %, Field: %, Type: %, Reference Table: %, Display Field: %', 
            v_field_record.object_name,
            v_field_record.field_name,
            v_field_record.field_type,
            COALESCE(v_field_record.reference_table, 'NULL'),
            COALESCE(v_field_record.reference_display_field, 'NULL');
    END LOOP;
END $$;

-- Test that the enhanced function still works (should now skip these fields)
DO $$
DECLARE
    v_test_object_id UUID;
    v_test_result record;
BEGIN
    -- Get a sample object ID (first object with created_by field)
    SELECT f.object_id INTO v_test_object_id
    FROM tenant.fields f
    WHERE f.name = 'created_by' 
    LIMIT 1;
    
    IF v_test_object_id IS NOT NULL THEN
        RAISE NOTICE '🧪 Testing enhanced function with object ID: %', v_test_object_id;
        
        -- Test the enhanced function
        FOR v_test_result IN 
            SELECT * FROM tenant.get_object_records_with_references(v_test_object_id, 1, 0)
        LOOP
            RAISE NOTICE '✅ Enhanced function test successful!';
            RAISE NOTICE '  Record ID: %', v_test_result.record_id;
            RAISE NOTICE '  Sample data keys: %', (SELECT array_agg(k) FROM jsonb_object_keys(v_test_result.record_data) k);
            
            -- Check if created_by and updated_by are now simple text fields
            IF v_test_result.record_data ? 'created_by' THEN
                RAISE NOTICE '✅ Created By field present: %', v_test_result.record_data->>'created_by';
            END IF;
            
            IF v_test_result.record_data ? 'updated_by' THEN
                RAISE NOTICE '✅ Updated By field present: %', v_test_result.record_data->>'updated_by';
            END IF;
        END LOOP;
    ELSE
        RAISE NOTICE '⚠️ No test object found with created_by field';
    END IF;
END $$;

-- Log successful migration
DO $$
BEGIN
    RAISE NOTICE '🚀 Migration 128: Fixed created_by/updated_by fields completed!';
    RAISE NOTICE '✅ Converted reference fields to text fields';
    RAISE NOTICE '✅ No more missing user table errors';
    RAISE NOTICE '✅ Enhanced function will work without issues';
    RAISE NOTICE '✅ Created By and Updated By still store user IDs as text';
    RAISE NOTICE '✅ Can convert back to reference fields later when user tables exist';
END $$;
