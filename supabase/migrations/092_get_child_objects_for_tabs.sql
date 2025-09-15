-- Migration: 092_get_child_objects_for_tabs.sql
-- Fix the get_child_objects_for_tabs function to use existing related_list_metadata table

-- Drop the existing function if it exists
DROP FUNCTION IF EXISTS get_child_objects_for_tabs(UUID, UUID);

-- The related_list_metadata table already exists, so we just need to fix the function
-- No new tables needed!

-- Create the corrected function using existing related_list_metadata table
CREATE OR REPLACE FUNCTION get_child_objects_for_tabs(
  p_parent_object_id UUID,
  p_tenant_id UUID
)
RETURNS TABLE (
  object_id UUID,
  object_name TEXT,           -- Changed from VARCHAR to TEXT to match database
  object_label TEXT,          -- Changed from VARCHAR to TEXT to match database
  relationship_type TEXT,     -- Changed from VARCHAR to TEXT to match database
  is_active BOOLEAN,
  display_order INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT
    o.id as object_id,
    o.name as object_name,
    o.label as object_label,
    'one_to_many' as relationship_type,  -- Default relationship type
    o.is_active,
    COALESCE(rlm.display_order, 0) as display_order
  FROM tenant.objects o
  INNER JOIN tenant.related_list_metadata rlm ON rlm.child_object_id = o.id
  WHERE rlm.parent_object_id = p_parent_object_id 
    AND rlm.tenant_id = p_tenant_id
    AND rlm.is_visible = true
    AND o.is_active = true
  ORDER BY COALESCE(rlm.display_order, 0), o.label;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_child_objects_for_tabs(UUID, UUID) TO authenticated;