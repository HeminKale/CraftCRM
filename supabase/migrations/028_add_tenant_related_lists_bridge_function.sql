-- Migration: 028_add_tenant_related_lists_bridge_function.sql
-- Add bridge function to get related lists for tenant objects

-- Drop existing function if it exists
DROP FUNCTION IF EXISTS public.get_tenant_related_lists(text, uuid);

-- Create bridge function for related lists following existing pattern
CREATE OR REPLACE FUNCTION public.get_tenant_related_lists(p_parent_table text, p_tenant_id uuid)
RETURNS TABLE(
  id uuid,
  parent_object_id uuid,
  child_object_id uuid,
  foreign_key_field text,
  label text,
  display_columns jsonb,
  section character varying(100),  -- Changed to match your DB schema
  display_order integer,
  is_visible boolean,
  created_at timestamp with time zone,  -- Changed to match your DB schema
  updated_at timestamp with time zone,  -- Changed to match your DB schema
  parent_object_name text,
  child_object_name text,
  child_object_label text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Verify tenant access
  IF NOT EXISTS (
    SELECT 1 FROM system.tenants t
    WHERE t.id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Tenant not found or access denied';
  END IF;

  RETURN QUERY
  SELECT 
    rlm.id,
    rlm.parent_object_id,
    rlm.child_object_id,
    rlm.foreign_key_field,
    rlm.label,
    rlm.display_columns,
    rlm.section,
    rlm.display_order,
    rlm.is_visible,
    rlm.created_at,
    rlm.updated_at,
    po.name as parent_object_name,
    co.name as child_object_name,
    co.label as child_object_label
  FROM tenant.related_list_metadata rlm
  JOIN tenant.objects po ON po.id = rlm.parent_object_id
  JOIN tenant.objects co ON co.id = rlm.child_object_id
  WHERE po.name = p_parent_table 
    AND rlm.tenant_id = p_tenant_id
    AND rlm.is_visible = true
  ORDER BY rlm.display_order, rlm.label;
END;
$$;

-- Grant execute permissions (following existing pattern)
GRANT EXECUTE ON FUNCTION public.get_tenant_related_lists(text, uuid) TO authenticated;

-- Add comment for clarity (following existing pattern)
COMMENT ON FUNCTION public.get_tenant_related_lists(text, uuid) IS 'Bridge function to access tenant.related_list_metadata through REST API';