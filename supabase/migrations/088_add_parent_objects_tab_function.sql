-- Migration: 088_add_parent_objects_tab_function
CREATE OR REPLACE FUNCTION get_parent_objects_for_tabs(
  p_child_object_id UUID,
  p_tenant_id UUID
)
RETURNS TABLE(
  object_id UUID,
  object_name TEXT,
  object_label TEXT,
  relationship_type TEXT,
  is_active BOOLEAN,
  display_order INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT
    o.id as object_id,
    o.name as object_name,
    o.label as object_label,
    'parent' as relationship_type,
    o.is_active,
    COALESCE(rlm.display_order, 0) as display_order
  FROM tenant.objects o
  INNER JOIN tenant.related_list_metadata rlm ON o.id = rlm.parent_object_id
  WHERE rlm.child_object_id = p_child_object_id
  AND rlm.tenant_id = p_tenant_id
  AND o.is_active = true
  AND rlm.is_visible = true
  ORDER BY rlm.display_order, o.name;
END;
$$;

GRANT EXECUTE ON FUNCTION get_parent_objects_for_tabs TO authenticated;