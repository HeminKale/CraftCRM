-- Migration: 043_fix_get_app_tab_configs_function.sql
-- Description: Fix get_app_tab_configs function with proper data types and JOIN logic
-- Date: 2025-01-11

-- Fix get_app_tab_configs function to properly filter by app_id
-- The current function is not using the app_id parameter correctly

-- Drop the existing function
DROP FUNCTION IF EXISTS public.get_app_tab_configs(uuid);

-- Recreate the function with proper app_id filtering and correct data types
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
  app_description text,  -- Use text for description columns
  tab_label character varying,
  tab_description character varying
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
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
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_app_tab_configs(uuid) TO authenticated;
