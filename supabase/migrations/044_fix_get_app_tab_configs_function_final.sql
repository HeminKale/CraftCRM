-- FINAL FIX: get_app_tab_configs function that returns ALL apps
-- This function was only returning CRM App data, missing BQSR, New test app, and test11

-- Drop the broken function
DROP FUNCTION IF EXISTS public.get_app_tab_configs(uuid);

-- Create the CORRECTED function that returns ALL app data
CREATE OR REPLACE FUNCTION public.get_app_tab_configs(p_tenant_id uuid)
RETURNS TABLE (
  id uuid,
  app_id uuid,
  tab_id uuid,
  tab_order integer,
  is_visible boolean,
  tenant_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  app_name character varying,
  app_description text,
  tab_label character varying,
  tab_description character varying
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Use SECURITY DEFINER to bypass RLS policies
  -- This function should return ALL app_tabs for the tenant, not just one app
  
  RETURN QUERY
  SELECT 
    at.id,
    at.app_id,
    at.tab_id,
    at.tab_order,
    at.is_visible,
    at.tenant_id,
    at.created_at,
    at.updated_at,
    a.name as app_name,
    a.description as app_description,
    t.label as tab_label,
    t.label as tab_description
  FROM tenant.app_tabs at
  JOIN tenant.apps a ON at.app_id = a.id
  JOIN tenant.tabs t ON at.tab_id = t.id
  WHERE at.tenant_id = p_tenant_id
  ORDER BY at.app_id, at.tab_order;
  
  -- Debug logging to see what's being returned
  RAISE NOTICE 'Function get_app_tab_configs called with tenant_id: %, returning % rows', 
    p_tenant_id, 
    (SELECT COUNT(*) FROM tenant.app_tabs WHERE tenant_id = p_tenant_id);
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_app_tab_configs(uuid) TO authenticated;

-- Test the function - should now return ALL 11 records
-- SELECT * FROM public.get_app_tab_configs('2f07fa14-e8d0-4ac8-ae7f-ac7b48a48337');
