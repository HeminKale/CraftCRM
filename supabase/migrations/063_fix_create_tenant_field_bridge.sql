-- Migration 063: Fix create_tenant_field RPC bridge
-- This migration ensures that when fields are created, they call tenant.add_field
-- to add physical columns to the tables, not just metadata

-- Drop the existing broken functions (there are duplicates)
DROP FUNCTION IF EXISTS public.create_tenant_field(UUID, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, INTEGER, BOOLEAN, INTEGER, BOOLEAN);
DROP FUNCTION IF EXISTS public.create_tenant_field(UUID, TEXT, TEXT, TEXT, UUID, BOOLEAN, BOOLEAN, TEXT, JSONB, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT);

-- Create the fixed function that properly calls tenant.add_field
CREATE OR REPLACE FUNCTION public.create_tenant_field(
  p_object_id UUID,
  p_name TEXT,
  p_label TEXT,
  p_type TEXT,
  p_tenant_id UUID,
  p_is_required BOOLEAN DEFAULT false,
  p_is_nullable BOOLEAN DEFAULT true,
  p_default_value TEXT DEFAULT NULL,
  p_validation_rules JSONB DEFAULT NULL,
  p_display_order INTEGER DEFAULT 0,
  p_section TEXT DEFAULT 'General',
  p_width TEXT DEFAULT 'full',
  p_is_visible BOOLEAN DEFAULT true,
  p_is_system_field BOOLEAN DEFAULT false,
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
AS $$
DECLARE
  new_field_id UUID;
BEGIN
  -- CRITICAL FIX: Call tenant.add_field to create the physical column
  -- This will add both metadata AND the physical column
  SELECT tenant.add_field(
    p_object_id,
    p_name,
    p_label,
    p_type,
    p_is_required,
    p_default_value,
    p_validation_rules,
    p_section,
    CASE p_width
      WHEN 'full' THEN 100
      WHEN 'half' THEN 50
      WHEN 'third' THEN 33
      WHEN 'quarter' THEN 25
      ELSE 100
    END,
    p_is_visible
  ) INTO new_field_id;

  -- Return the created field details
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

-- Add comment
COMMENT ON FUNCTION public.create_tenant_field(UUID, TEXT, TEXT, TEXT, UUID, BOOLEAN, BOOLEAN, TEXT, JSONB, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT) IS 'Fixed: Creates field metadata AND physical column by calling tenant.add_field';

-- Verify the function was created
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.routines 
    WHERE routine_name = 'create_tenant_field' 
    AND routine_schema = 'public'
  ) THEN
    RAISE NOTICE '✅ create_tenant_field function created successfully';
  ELSE
    RAISE EXCEPTION '❌ create_tenant_field function creation failed';
  END IF;
END $$;