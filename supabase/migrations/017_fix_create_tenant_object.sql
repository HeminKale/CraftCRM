-- Migration 017: Fix create_tenant_object function to resolve ambiguous column reference
-- This fixes the "column reference 'id' is ambiguous" error

-- Drop the existing function
DROP FUNCTION IF EXISTS public.create_tenant_object(TEXT, TEXT, UUID, TEXT, BOOLEAN);

-- Create the fixed function
CREATE OR REPLACE FUNCTION public.create_tenant_object(
  p_name TEXT,
  p_label TEXT,
  p_tenant_id UUID,
  p_description TEXT DEFAULT '',
  p_is_system_object BOOLEAN DEFAULT FALSE
)
RETURNS TABLE(
  id UUID,
  name TEXT,
  label TEXT,
  description TEXT,
  is_active BOOLEAN,
  is_system_object BOOLEAN,
  tenant_id UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant, public
AS $$
DECLARE
  new_object_id UUID;
BEGIN
  -- Ensure name ends with __a for custom objects
  IF NOT p_is_system_object AND NOT p_name LIKE '%__a' THEN
    p_name := p_name || '__a';
  END IF;

  -- Insert the new object
  INSERT INTO tenant.objects (name, label, description, is_active, is_system_object, tenant_id)
  VALUES (p_name, p_label, p_description, TRUE, p_is_system_object, p_tenant_id)
  RETURNING tenant.objects.id INTO new_object_id;

  -- Seed system fields for the new object (if function exists)
  BEGIN
    PERFORM public.seed_system_fields(new_object_id, p_tenant_id);
  EXCEPTION WHEN undefined_function THEN
    -- Function doesn't exist, skip seeding
    NULL;
  END;

  -- Return the created object with explicit table references
  RETURN QUERY
  SELECT 
    o.id,
    o.name::text,
    o.label::text,
    o.description::text,
    o.is_active,
    o.is_system_object,
    o.tenant_id,
    o.created_at,
    o.updated_at
  FROM tenant.objects o
  WHERE o.id = new_object_id;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.create_tenant_object(TEXT, TEXT, UUID, TEXT, BOOLEAN) TO authenticated;

-- Verify the function was created correctly
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc 
    WHERE proname = 'create_tenant_object' 
    AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  ) THEN
    RAISE NOTICE '✅ create_tenant_object function created successfully';
  ELSE
    RAISE EXCEPTION '❌ create_tenant_object function creation failed';
  END IF;
END $$;
