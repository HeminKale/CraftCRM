-- Migration: 091_fix_get_child_objects_for_tabs_function.sql
-- Fix the get_child_objects_for_tabs function that has SQL syntax error

-- Drop the existing function if it exists
DROP FUNCTION IF EXISTS get_child_objects_for_tabs(UUID, UUID);

-- Create the corrected function
CREATE OR REPLACE FUNCTION get_child_objects_for_tabs(
  p_parent_object_id UUID,
  p_tenant_id UUID
)
RETURNS TABLE (
  object_id UUID,
  object_name VARCHAR,
  object_label VARCHAR,
  relationship_type VARCHAR,
  is_active BOOLEAN,
  display_order INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT
    o.id as object_id,
    o.name as object_name,
    o.label as object_label,
    r.relationship_type,
    o.is_active,
    COALESCE(o.display_order, 0) as display_order
  FROM tenant.objects o
  INNER JOIN tenant.relationships r ON (
    (r.parent_object_id = p_parent_object_id AND r.child_object_id = o.id) OR
    (r.child_object_id = p_parent_object_id AND r.parent_object_id = o.id)
  )
  WHERE o.tenant_id = p_tenant_id
    AND o.is_active = true
    AND r.is_active = true
  ORDER BY COALESCE(o.display_order, 0), o.label;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_child_objects_for_tabs(UUID, UUID) TO authenticated;
