-- Migration: Fix create_tenant_object trigger creation conflicts
-- This fixes the "trigger already exists" error by adding existence checks
-- Date: 2025-01-17
-- Issue: Function was trying to create triggers without checking if they already exist

-- Drop the existing function
DROP FUNCTION IF EXISTS public.create_tenant_object(TEXT, TEXT, UUID, TEXT, BOOLEAN);

-- Create the corrected function with trigger existence checks
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

  -- Create updated_at trigger with existence check
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers 
    WHERE trigger_name = format('set_updated_at_%s', v_table_name)
    AND event_object_table = v_table_name
    AND trigger_schema = 'tenant'
  ) THEN
    EXECUTE format('
      CREATE TRIGGER set_updated_at_%I
      BEFORE UPDATE ON tenant.%I
      FOR EACH ROW EXECUTE FUNCTION system.set_updated_at()',
      v_table_name, v_table_name);
    RAISE NOTICE '✅ Created updated_at trigger for table %', v_table_name;
  ELSE
    RAISE NOTICE 'ℹ️ Updated_at trigger already exists for table %, skipping creation', v_table_name;
  END IF;

  -- Add index on tenant_id for better RLS performance
  EXECUTE format('CREATE INDEX idx_%I_tenant_id ON tenant.%I(tenant_id)', 
                 v_table_name, v_table_name);

  -- Seed system fields metadata (this will include autonumber field)
  PERFORM public.seed_system_fields(new_object_id, p_tenant_id);

  -- Create autonumber sequence for this object
  EXECUTE format('
    CREATE SEQUENCE tenant.seq_%s_autonumber START 1 INCREMENT 1',
    v_table_name);

  -- Add autonumber sequence record with conflict handling
  INSERT INTO tenant.autonumber_sequences (
      object_id, tenant_id, field_name, current_value, start_value, increment_by
  ) VALUES (
      new_object_id, p_tenant_id, 'autonumber', 0, 1, 1
  ) ON CONFLICT (object_id, field_name, tenant_id) 
  DO UPDATE SET
      current_value = EXCLUDED.current_value,
      start_value = EXCLUDED.start_value,
      increment_by = EXCLUDED.increment_by,
      updated_at = now();

  -- Create autonumber trigger with existence check
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers 
    WHERE trigger_name = format('set_autonumber_%s_autonumber', v_table_name)
    AND event_object_table = v_table_name
    AND trigger_schema = 'tenant'
  ) THEN
    EXECUTE format('
      CREATE TRIGGER set_autonumber_%s_autonumber
      BEFORE INSERT ON tenant.%I
      FOR EACH ROW EXECUTE FUNCTION tenant.set_autonumber_value(''autonumber'')',
      v_table_name, v_table_name);
    RAISE NOTICE '✅ Created autonumber trigger for table %', v_table_name;
  ELSE
    RAISE NOTICE 'ℹ️ Autonumber trigger already exists for table %, skipping creation', v_table_name;
  END IF;

  -- Return the created object details
  RETURN QUERY
  SELECT new_object_id AS id, v_table_name AS name, p_label AS label;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.create_tenant_object(TEXT, TEXT, UUID, TEXT, BOOLEAN) TO authenticated;

-- Add comment explaining the fix
COMMENT ON FUNCTION public.create_tenant_object(TEXT, TEXT, UUID, TEXT, BOOLEAN) IS 'FIXED: Now handles trigger conflicts gracefully with existence checks';

-- Verify the function was created correctly
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.routines 
    WHERE routine_name = 'create_tenant_object' 
    AND routine_schema = 'public'
  ) THEN
    RAISE NOTICE '✅ create_tenant_object function updated successfully with trigger conflict handling';
  ELSE
    RAISE EXCEPTION '❌ create_tenant_object function update failed';
  END IF;
END $$;


