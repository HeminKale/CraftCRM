-- Migration: 089_fix_layout_blocks_display_columns.sql
-- Fix get_layout_blocks function to properly return display_columns from related_list_metadata

-- Drop the existing function first (required for return type changes)
DROP FUNCTION IF EXISTS public.get_layout_blocks(UUID, UUID);

-- Create the updated function with display_columns
CREATE OR REPLACE FUNCTION public.get_layout_blocks(p_object_id UUID, p_tenant_id UUID)
RETURNS TABLE(
  id UUID,
  object_id UUID,
  block_type TEXT,
  field_id UUID,
  related_list_id UUID,
  label TEXT,
  section TEXT,
  display_order INTEGER,
  width TEXT,
  is_visible BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  display_columns JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    lb.id,
    lb.object_id,
    lb.block_type::text,
    lb.field_id,
    lb.related_list_id,
    lb.label,
    lb.section::text,
    lb.display_order,
    lb.width::text,
    lb.is_visible,
    lb.created_at,
    lb.updated_at,
    COALESCE(rlm.display_columns, '[]'::jsonb) as display_columns
  FROM tenant.layout_blocks lb
  LEFT JOIN tenant.related_list_metadata rlm ON lb.related_list_id = rlm.id
  WHERE lb.object_id = p_object_id 
  AND lb.tenant_id = p_tenant_id
  ORDER BY lb.section, lb.display_order;
END;
$$;