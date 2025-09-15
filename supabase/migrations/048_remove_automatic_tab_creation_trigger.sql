-- Migration 048: Remove Automatic Tab Creation Trigger
-- This migration removes the problematic trigger that was causing errors

-- Step 1: Drop the trigger first
DROP TRIGGER IF EXISTS trigger_create_tab_for_object ON tenant.objects;

-- Step 2: Drop the function
DROP FUNCTION IF EXISTS create_tab_for_object();

-- Step 3: Verify removal
-- Check if trigger still exists
SELECT 
    trigger_name,
    event_manipulation,
    action_statement
FROM information_schema.triggers 
WHERE trigger_schema = 'tenant' 
    AND event_object_table = 'objects'
    AND trigger_name = 'trigger_create_tab_for_object';

-- Check if function still exists
SELECT 
    routine_name,
    routine_type
FROM information_schema.routines 
WHERE routine_schema = 'tenant' 
    AND routine_name = 'create_tab_for_object';

-- Expected result: Both queries should return no rows
-- This confirms the trigger and function have been successfully removed
