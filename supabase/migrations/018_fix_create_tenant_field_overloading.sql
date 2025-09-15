-- Migration 018: Fix create_tenant_field function overloading issue
-- This resolves the "Could not choose the best candidate function" error

-- Drop ALL existing versions of create_tenant_field to resolve overloading conflicts
DROP FUNCTION IF EXISTS public.create_tenant_field(UUID, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.create_tenant_field(UUID, TEXT, TEXT, TEXT, UUID, BOOLEAN, BOOLEAN, TEXT, JSONB, INTEGER, VARCHAR, VARCHAR, BOOLEAN, BOOLEAN, VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS public.create_tenant_field(UUID, TEXT, TEXT, TEXT, UUID, BOOLEAN, BOOLEAN, TEXT, JSONB, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.create_tenant_field(UUID, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, JSONB, INTEGER, VARCHAR, VARCHAR, BOOLEAN, BOOLEAN, VARCHAR, VARCHAR);

-- Create the single, definitive version of create_tenant_field
CREATE OR REPLACE FUNCTION public.create_tenant_field(
  p_object_id UUID,
  p_name TEXT,
  p_label TEXT,
  p_type TEXT,
  p_tenant_id UUID,
  p_is_required BOOLEAN DEFAULT FALSE,
  p_is_nullable BOOLEAN DEFAULT TRUE,
  p_default_value TEXT DEFAULT NULL,
  p_validation_rules JSONB DEFAULT '[]'::jsonb,
  p_display_order INTEGER DEFAULT 0,
  p_section TEXT DEFAULT 'details',
  p_width TEXT DEFAULT 'half',
  p_is_visible BOOLEAN DEFAULT TRUE,
  p_is_system_field BOOLEAN DEFAULT FALSE,
  p_reference_table TEXT DEFAULT NULL,
  p_reference_display_field TEXT DEFAULT NULL
)
RETURNS TABLE(
  id UUID,
  object_id UUID,
  name TEXT,
  label TEXT,
  type TEXT,
  is_required BOOLEAN,
  is_nullable BOOLEAN,
  default_value TEXT,
  validation_rules JSONB,
  display_order INTEGER,
  section TEXT,
  width TEXT,
  is_visible BOOLEAN,
  is_system_field BOOLEAN,
  reference_table TEXT,
  reference_display_field TEXT,
  tenant_id UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant, public
AS $$
DECLARE
  new_field_id UUID;
BEGIN
  -- Ensure field name ends with __a for custom fields
  IF NOT p_is_system_field AND NOT p_name LIKE '%__a' THEN
    p_name := p_name || '__a';
  END IF;

  -- Insert the new field
  INSERT INTO tenant.fields (
    object_id, name, label, type, tenant_id, is_required, is_nullable, 
    default_value, validation_rules, display_order, section, width, 
    is_visible, is_system_field, reference_table, reference_display_field
  )
  VALUES (
    p_object_id, p_name, p_label, p_type, p_tenant_id, p_is_required, p_is_nullable,
    p_default_value, p_validation_rules, p_display_order, p_section, p_width,
    p_is_visible, p_is_system_field, p_reference_table, p_reference_display_field
  )
  RETURNING tenant.fields.id INTO new_field_id;

  -- Return the created field with explicit table references
  RETURN QUERY
  SELECT 
    f.id,
    f.object_id,
    f.name::text,
    f.label::text,
    f.type::text,
    f.is_required,
    f.is_nullable,
    f.default_value::text,
    f.validation_rules,
    f.display_order::int,
    f.section::text,
    f.width::text,
    f.is_visible,
    f.is_system_field,
    f.reference_table::text,
    f.reference_display_field::text,
    f.tenant_id,
    f.created_at,
    f.updated_at
  FROM tenant.fields f
  WHERE f.id = new_field_id;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.create_tenant_field(UUID, TEXT, TEXT, TEXT, UUID, BOOLEAN, BOOLEAN, TEXT, JSONB, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT) TO authenticated;

-- Verify the function was created correctly
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc 
    WHERE proname = 'create_tenant_field' 
    AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  ) THEN
    RAISE NOTICE '✅ create_tenant_field function created successfully';
  ELSE
    RAISE EXCEPTION '❌ create_tenant_field function creation failed';
  END IF;
END $$;
