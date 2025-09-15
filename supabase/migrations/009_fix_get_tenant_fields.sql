-- Migration 009: Fix get_tenant_fields return type mismatch by casting selected columns

CREATE OR REPLACE FUNCTION public.get_tenant_fields(p_object_id UUID, p_tenant_id UUID)
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
BEGIN
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
  WHERE f.object_id = p_object_id
    AND f.tenant_id = p_tenant_id
  ORDER BY f.display_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_tenant_fields(UUID, UUID) TO authenticated;

