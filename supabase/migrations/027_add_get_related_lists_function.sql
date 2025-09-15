-- Migration: 027_add_get_related_lists_function.sql
-- Add function to get related lists for an object

-- Drop existing function if it exists
DROP FUNCTION IF EXISTS public.get_related_lists(text, uuid);

-- Create function to get related lists for a parent object
CREATE OR REPLACE FUNCTION public.get_related_lists(p_parent_table text, p_tenant_id uuid)
RETURNS TABLE(
  id uuid,
  parent_object_id uuid,
  child_object_id uuid,
  foreign_key_field text,
  label text,
  display_columns jsonb,
  section text,
  display_order integer,
  is_visible boolean,
  created_at timestamptz,
  updated_at timestamptz,
  parent_object_name text,
  child_object_name text,
  child_object_label text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant, public
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

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.get_related_lists(text, uuid) TO authenticated, anon, public;
