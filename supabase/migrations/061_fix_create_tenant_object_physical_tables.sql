-- Migration 061: Fix create_tenant_object to create physical tables
-- This migration fixes the critical gap where objects were only creating metadata
-- but not physical tables with system field columns
-- ALL ambiguous column references have been resolved with explicit table aliases

-- Drop the existing broken function
DROP FUNCTION IF EXISTS public.create_tenant_object(TEXT, TEXT, UUID, TEXT, BOOLEAN);

-- Create the fixed function that creates physical tables directly
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
  
  -- Check if object already exists (FIXED: use explicit table reference)
  IF EXISTS (
    SELECT 1 FROM tenant.objects o
    WHERE o.tenant_id = p_tenant_id AND o.name = v_table_name
  ) THEN
    RAISE EXCEPTION 'Object with name "%" already exists', p_name;
  END IF;

  -- Insert object definition first (FIXED: use explicit column reference)
  INSERT INTO tenant.objects (tenant_id, name, label, description, is_system_object, is_active)
  VALUES (p_tenant_id, v_table_name, p_label, p_description, p_is_system_object, true)
  RETURNING tenant.objects.id INTO new_object_id;

  -- Create the physical table with system fields as columns
  v_sql := format('
    CREATE TABLE tenant.%I (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now(),
        created_by UUID REFERENCES system.users(id),
        updated_by UUID REFERENCES system.users(id),
        name TEXT NOT NULL,
        is_active BOOLEAN DEFAULT true
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

  -- Seed system fields metadata
  PERFORM public.seed_system_fields(new_object_id, p_tenant_id);

  -- Return the created object details
  RETURN QUERY
  SELECT new_object_id AS id, v_table_name AS name, p_label AS label;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.create_tenant_object(TEXT, TEXT, UUID, TEXT, BOOLEAN) TO authenticated;

-- Add comment
COMMENT ON FUNCTION public.create_tenant_object(TEXT, TEXT, UUID, TEXT, BOOLEAN) IS 'Fixed: Creates physical table + metadata + system field columns (ALL ambiguities resolved)';

-- Verify the function was created
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.routines 
    WHERE routine_name = 'create_tenant_object' 
    AND routine_schema = 'public'
  ) THEN
    RAISE NOTICE '✅ create_tenant_object function created successfully';
  ELSE
    RAISE EXCEPTION '❌ create_tenant_object function creation failed';
  END IF;
END $$;