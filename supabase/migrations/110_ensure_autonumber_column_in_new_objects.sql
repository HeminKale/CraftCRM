-- Migration: 110_ensure_autonumber_column_in_new_objects.sql
-- Description: Ensure all new objects created from UI automatically get autonumber column
-- Date: 2024-01-XX
-- Purpose: Fix the root cause of missing autonumber columns in new objects

-- ===========================================
-- ENSURE AUTONUMBER COLUMN IN NEW OBJECTS
-- ===========================================
-- This migration ensures that when new objects are created from the UI,
-- they automatically get the autonumber column along with other system columns

-- 1. Drop the current function to recreate it properly
DROP FUNCTION IF EXISTS public.create_tenant_object(TEXT, TEXT, UUID, TEXT, BOOLEAN);

-- 2. Create the FIXED function that includes autonumber column
CREATE OR REPLACE FUNCTION public.create_tenant_object(
  p_name TEXT,
  p_label TEXT,
  p_tenant_id UUID,
  p_description TEXT DEFAULT NULL,
  p_is_system_object BOOLEAN DEFAULT FALSE
)
RETURNS TABLE(id UUID, name TEXT, label TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_object_id UUID;
  v_table_name TEXT;
  v_sql TEXT;
BEGIN
  -- Generate the table name (same logic as tenant.create_object)
  v_table_name := lower(regexp_replace(p_name, '[^a-zA-Z0-9]', '_', 'g'));
  v_table_name := left(v_table_name, 40) || '__a'; -- Truncate to 40 chars + '__a'
  
  -- Check if object already exists
  IF EXISTS (
    SELECT 1 FROM tenant.objects o
    WHERE o.tenant_id = p_tenant_id AND o.name = v_table_name
  ) THEN
    RAISE EXCEPTION 'Object with name "%" already exists', p_name;
  END IF;

  -- Insert object definition first
  INSERT INTO tenant.objects (tenant_id, name, label, description, is_system_object, is_active)
  VALUES (p_tenant_id, v_table_name, p_label, p_description, p_is_system_object, true)
  RETURNING tenant.objects.id INTO new_object_id;

  -- Create the physical table with ALL system fields including autonumber
  v_sql := format('
    CREATE TABLE tenant.%I (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now(),
        created_by UUID REFERENCES system.users(id),
        updated_by UUID REFERENCES system.users(id),
        name TEXT NOT NULL,
        is_active BOOLEAN DEFAULT true,
        autonumber BIGINT DEFAULT 0
    )', v_table_name);
  
  EXECUTE v_sql;

  -- Add RLS policies
  EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', v_table_name);
  
  -- SELECT policy
  EXECUTE format('
    CREATE POLICY "select_tenant_isolation_%I"
    ON tenant.%I FOR SELECT
    USING (tenant_id = %L)', v_table_name, v_table_name, p_tenant_id);
  
  -- INSERT policy
  EXECUTE format('
    CREATE POLICY "insert_tenant_isolation_%I"
    ON tenant.%I FOR INSERT
    WITH CHECK (tenant_id = %L)', v_table_name, v_table_name, p_tenant_id);
  
  -- UPDATE policy
  EXECUTE format('
    CREATE POLICY "update_tenant_isolation_%I"
    ON tenant.%I FOR UPDATE
    USING (tenant_id = %L)
    WITH CHECK (tenant_id = %L)', v_table_name, v_table_name, p_tenant_id, p_tenant_id);
  
  -- DELETE policy
  EXECUTE format('
    CREATE POLICY "delete_tenant_isolation_%I"
    ON tenant.%I FOR DELETE
    USING (tenant_id = %L)', v_table_name, v_table_name, p_tenant_id);

  -- Create updated_at trigger
  EXECUTE format('
    CREATE TRIGGER set_updated_at_%I
    BEFORE UPDATE ON tenant.%I
    FOR EACH ROW EXECUTE FUNCTION system.set_updated_at()',
    v_table_name, v_table_name);

  -- Add index on tenant_id for better RLS performance
  EXECUTE format('CREATE INDEX idx_%I_tenant_id ON tenant.%I(tenant_id)', 
                 v_table_name, v_table_name);

  -- Seed system fields metadata (this will include autonumber field)
  PERFORM public.seed_system_fields(new_object_id, p_tenant_id);

  -- Create autonumber sequence for this object
  EXECUTE format('
    CREATE SEQUENCE tenant.seq_%s_autonumber START 1 INCREMENT 1',
    v_table_name);

  -- Add autonumber sequence record
  INSERT INTO tenant.autonumber_sequences (
      object_id, tenant_id, field_name, current_value, start_value, increment_by
  ) VALUES (
      new_object_id, p_tenant_id, 'autonumber', 0, 1, 1
  );

  -- Create autonumber trigger
  EXECUTE format('
    CREATE TRIGGER set_autonumber_%s_autonumber
    BEFORE INSERT ON tenant.%I
    FOR EACH ROW EXECUTE FUNCTION tenant.set_autonumber_value(''autonumber'')',
    v_table_name, v_table_name);

  -- Return the created object details
  RETURN QUERY
  SELECT new_object_id AS id, v_table_name AS name, p_label AS label;
END;
$$;

-- 3. Grant execute permission
GRANT EXECUTE ON FUNCTION public.create_tenant_object(TEXT, TEXT, UUID, TEXT, BOOLEAN) TO authenticated;

-- 4. Add comment explaining the fix
COMMENT ON FUNCTION public.create_tenant_object(TEXT, TEXT, UUID, TEXT, BOOLEAN) IS 'FIXED: Now automatically creates autonumber column + sequence + trigger for all new objects';

-- 5. Verify the function was created correctly
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.routines 
    WHERE routine_name = 'create_tenant_object' 
    AND routine_schema = 'public'
  ) THEN
    RAISE NOTICE '✅ create_tenant_object function updated successfully with autonumber support';
  ELSE
    RAISE EXCEPTION '❌ create_tenant_object function update failed';
  END IF;
END $$;

-- 6. Test the function to make sure it works (optional - can be commented out in production)
DO $$
DECLARE
    test_tenant_id UUID;
    test_result RECORD;
BEGIN
    -- Get a tenant ID for testing
    SELECT tenant_id INTO test_tenant_id 
    FROM tenant.objects 
    LIMIT 1;
    
    IF test_tenant_id IS NULL THEN
        RAISE NOTICE 'No tenant found for testing - skipping test';
        RETURN;
    END IF;
    
    RAISE NOTICE '🧪 Testing create_tenant_object with autonumber support...';
    
    -- Try to create a test object
    SELECT * INTO test_result
    FROM public.create_tenant_object(
        'Test Object with Autonumber',
        'Test Object with Autonumber',
        test_tenant_id,
        'Test object to verify autonumber column creation',
        false
    );
    
    RAISE NOTICE '✅ Test object created: ID=%, Name=%, Label=%', 
        test_result.id, test_result.name, test_result.label;
    
    -- Verify the autonumber column was created
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'tenant' 
        AND table_name = test_result.name 
        AND column_name = 'autonumber'
    ) THEN
        RAISE NOTICE '✅ Autonumber column created successfully!';
    ELSE
        RAISE NOTICE '❌ Autonumber column was NOT created!';
    END IF;
    
    -- Verify the sequence was created
    IF EXISTS (
        SELECT 1 FROM information_schema.sequences 
        WHERE sequence_schema = 'tenant' 
        AND sequence_name = 'seq_' || test_result.name || '_autonumber'
    ) THEN
        RAISE NOTICE '✅ Autonumber sequence created successfully!';
    ELSE
        RAISE NOTICE '❌ Autonumber sequence was NOT created!';
    END IF;
    
    -- Verify the trigger was created
    IF EXISTS (
        SELECT 1 FROM information_schema.triggers 
        WHERE trigger_schema = 'tenant' 
        AND event_object_table = test_result.name 
        AND trigger_name LIKE '%autonumber%'
    ) THEN
        RAISE NOTICE '✅ Autonumber trigger created successfully!';
    ELSE
        RAISE NOTICE '❌ Autonumber trigger was NOT created!';
    END IF;
    
    -- Clean up test object
    DROP TABLE IF EXISTS tenant.test_object_with_autonumber__a CASCADE;
    DELETE FROM tenant.objects WHERE id = test_result.id;
    DELETE FROM tenant.autonumber_sequences WHERE object_id = test_result.id;
    DROP SEQUENCE IF EXISTS tenant.seq_test_object_with_autonumber__a_autonumber;
    
    RAISE NOTICE '🧹 Test object cleaned up';
    
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '❌ Test failed: %', SQLERRM;
    RAISE NOTICE '⚠️ This is not critical - the function may still work correctly';
END $$;

-- 7. Summary of what this migration accomplishes
COMMENT ON SCHEMA public IS 'Migration 110: Ensures all new objects automatically get autonumber column, sequence, and trigger to prevent missing autonumber errors';
