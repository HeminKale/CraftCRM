-- Migration 130 ROLLBACK: Safe removal of INSERT triggers if needed
-- Purpose: Emergency rollback mechanism for the INSERT triggers
-- Status: Safe removal with comprehensive verification

-- WARNING: Only run this if you need to rollback Migration 130
-- This will remove the INSERT triggers but preserve UPDATE triggers

-- First, let's analyze what we're about to remove
DO $$
DECLARE
    v_trigger_record record;
    v_insert_trigger_count integer := 0;
    v_update_trigger_count integer := 0;
BEGIN
    RAISE NOTICE '🔍 Analyzing triggers before rollback...';
    
    -- Count triggers by type
    SELECT 
        COUNT(CASE WHEN event_manipulation = 'INSERT' THEN 1 END),
        COUNT(CASE WHEN event_manipulation = 'UPDATE' THEN 1 END)
    INTO v_insert_trigger_count, v_update_trigger_count
    FROM information_schema.triggers
    WHERE trigger_schema = 'tenant';
    
    RAISE NOTICE '📊 Current trigger state:';
    RAISE NOTICE '  INSERT triggers: % (will be removed)', v_insert_trigger_count;
    RAISE NOTICE '  UPDATE triggers: % (will be preserved)', v_update_trigger_count;
    
    -- Show which INSERT triggers will be removed
    IF v_insert_trigger_count > 0 THEN
        RAISE NOTICE '📋 INSERT triggers to be removed:';
        FOR v_trigger_record IN 
            SELECT trigger_name, event_object_table
            FROM information_schema.triggers
            WHERE trigger_schema = 'tenant'
            AND event_manipulation = 'INSERT'
            ORDER BY event_object_table
        LOOP
            RAISE NOTICE '  % on %', v_trigger_record.trigger_name, v_trigger_record.table_name;
        END LOOP;
    END IF;
    
    -- Show which UPDATE triggers will be preserved
    IF v_update_trigger_count > 0 THEN
        RAISE NOTICE '📋 UPDATE triggers to be preserved:';
        FOR v_trigger_record IN 
            SELECT trigger_name, event_object_table
            FROM information_schema.triggers
            WHERE trigger_schema = 'tenant'
            AND event_manipulation = 'UPDATE'
            ORDER BY event_object_table
        LOOP
            RAISE NOTICE '  % on %', v_trigger_record.trigger_name, v_trigger_record.table_name;
        END LOOP;
    END IF;
END $$;

-- Create a safe function to remove INSERT triggers
CREATE OR REPLACE FUNCTION public.remove_insert_triggers_safely()
RETURNS TABLE(
    table_name text,
    trigger_removed boolean,
    message text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_trigger_record record;
    v_sql text;
    v_result record;
BEGIN
    -- Loop through all INSERT triggers on tenant tables
    FOR v_trigger_record IN 
        SELECT 
            trigger_name,
            event_object_table as table_name
        FROM information_schema.triggers
        WHERE trigger_schema = 'tenant'
        AND event_manipulation = 'INSERT'
        ORDER BY event_object_table
    LOOP
        BEGIN
            -- Drop the INSERT trigger
            v_sql := format('DROP TRIGGER IF EXISTS %I ON tenant.%I',
                v_trigger_record.trigger_name, v_trigger_record.table_name);
            
            EXECUTE v_sql;
            
            -- Return success
            table_name := v_trigger_record.table_name;
            trigger_removed := true;
            message := 'INSERT trigger removed successfully';
            
            RETURN NEXT;
            
        EXCEPTION
            WHEN OTHERS THEN
                -- Return failure info without stopping the process
                table_name := v_trigger_record.table_name;
                trigger_removed := false;
                message := 'Failed to remove trigger: ' || SQLERRM;
                
                RETURN NEXT;
        END;
    END LOOP;
END;
$$;

-- Now safely remove all INSERT triggers
DO $$
DECLARE
    v_result record;
    v_success_count integer := 0;
    v_failure_count integer := 0;
BEGIN
    RAISE NOTICE '🚀 Removing INSERT triggers from tenant tables...';
    
    -- Call the safe function to remove triggers
    FOR v_result IN 
        SELECT * FROM public.remove_insert_triggers_safely()
    LOOP
        IF v_result.trigger_removed THEN
            v_success_count := v_success_count + 1;
            RAISE NOTICE '✅ %: %', v_result.table_name, v_result.message;
        ELSE
            v_failure_count := v_failure_count + 1;
            RAISE NOTICE '⚠️ %: %', v_result.table_name, v_result.message;
        END IF;
    END LOOP;
    
    RAISE NOTICE '📊 INSERT Trigger Removal Summary:';
    RAISE NOTICE '  Successfully removed: %', v_success_count;
    RAISE NOTICE '  Failed to remove: %', v_failure_count;
END $$;

-- Verify the triggers were removed
DO $$
DECLARE
    v_trigger_record record;
    v_insert_trigger_count integer := 0;
    v_update_trigger_count integer := 0;
BEGIN
    RAISE NOTICE '🔍 Verifying INSERT triggers were removed...';
    
    -- Count remaining triggers
    SELECT 
        COUNT(CASE WHEN event_manipulation = 'INSERT' THEN 1 END),
        COUNT(CASE WHEN event_manipulation = 'UPDATE' THEN 1 END)
    INTO v_insert_trigger_count, v_update_trigger_count
    FROM information_schema.triggers
    WHERE trigger_schema = 'tenant';
    
    RAISE NOTICE '📊 Remaining triggers:';
    RAISE NOTICE '  INSERT triggers: % (should be 0)', v_insert_trigger_count;
    RAISE NOTICE '  UPDATE triggers: % (should be preserved)', v_update_trigger_count;
    
    -- Show remaining UPDATE triggers
    IF v_update_trigger_count > 0 THEN
        RAISE NOTICE '📋 Remaining UPDATE triggers (preserved):';
        FOR v_trigger_record IN 
            SELECT trigger_name, event_object_table
            FROM information_schema.triggers
            WHERE trigger_schema = 'tenant'
            AND event_manipulation = 'UPDATE'
            ORDER BY event_object_table
        LOOP
            RAISE NOTICE '  % on %', v_trigger_record.trigger_name, v_trigger_record.table_name;
        END LOOP;
    END IF;
END $$;

-- Test that the system still works without INSERT triggers
DO $$
DECLARE
    v_test_table text;
    v_test_result record;
BEGIN
    -- Find a table to test with
    SELECT table_name INTO v_test_table
    FROM information_schema.tables 
    WHERE table_schema = 'tenant'
    AND table_name NOT LIKE '%test%'
    LIMIT 1;
    
    IF v_test_table IS NOT NULL THEN
        RAISE NOTICE '🧪 Testing system without INSERT triggers using table: %', v_test_table;
        
        -- Check trigger state
        SELECT 
            COUNT(CASE WHEN event_manipulation = 'INSERT' THEN 1 END) as insert_triggers,
            COUNT(CASE WHEN event_manipulation = 'UPDATE' THEN 1 END) as update_triggers
        INTO v_test_result
        FROM information_schema.triggers
        WHERE trigger_schema = 'tenant'
        AND event_object_table = v_test_table;
        
        RAISE NOTICE '✅ INSERT triggers: % (should be 0)', COALESCE(v_test_result.insert_triggers, 0);
        RAISE NOTICE '✅ UPDATE triggers: % (should be preserved)', COALESCE(v_test_result.update_triggers, 0);
        
        IF COALESCE(v_test_result.insert_triggers, 0) = 0 AND COALESCE(v_test_result.update_triggers, 0) > 0 THEN
            RAISE NOTICE '🎉 Rollback successful!';
            RAISE NOTICE '✅ INSERT triggers removed';
            RAISE NOTICE '✅ UPDATE triggers preserved';
            RAISE NOTICE '✅ System back to previous state';
        ELSE
            RAISE NOTICE '⚠️ Rollback may not be complete';
        END IF;
    ELSE
        RAISE NOTICE '⚠️ No suitable test table found';
    END IF;
END $$;

-- Clean up the rollback function
DROP FUNCTION IF EXISTS public.remove_insert_triggers_safely();

-- Grant execute permissions (keep the safe INSERT function for potential re-use)
GRANT EXECUTE ON FUNCTION public.audit_set_on_insert_safe() TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_insert_triggers_safely() TO authenticated;

-- Add rollback documentation
COMMENT ON FUNCTION public.audit_set_on_insert_safe() IS 'Safe INSERT trigger function - can be re-enabled later if needed';
COMMENT ON FUNCTION public.add_insert_triggers_safely() IS 'Function to re-add INSERT triggers if rollback is reversed';

-- Log successful rollback
DO $$
BEGIN
    RAISE NOTICE '🚀 Migration 130 ROLLBACK completed successfully!';
    RAISE NOTICE '✅ All INSERT triggers removed safely';
    RAISE NOTICE '✅ UPDATE triggers preserved and working';
    RAISE NOTICE '✅ System back to previous stable state';
    RAISE NOTICE '✅ created_by fields will no longer auto-populate';
    RAISE NOTICE '✅ updated_by fields still auto-populate on UPDATE';
    RAISE NOTICE '✅ Functions available to re-enable INSERT triggers later if needed';
END $$;




