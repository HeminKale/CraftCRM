-- Migration 053: Fix get_tenant_app_tabs to include tab details via JOIN
-- This migration updates the RPC function to return complete tab information

-- Drop the existing function first
DROP FUNCTION IF EXISTS public.get_tenant_app_tabs(uuid);

-- Create the improved get_tenant_app_tabs function with tab details
CREATE OR REPLACE FUNCTION public.get_tenant_app_tabs(p_tenant_id uuid)
RETURNS TABLE (
    id uuid,
    app_id uuid,
    tab_id uuid,
    is_visible boolean,
    tab_order integer,
    tenant_id uuid,
    created_at timestamptz,
    updated_at timestamptz,
    -- Tab details from JOIN
    tab_label character varying,
    tab_type character varying,
    object_id uuid,
    custom_component_path text,
    custom_route text,
    is_system_tab boolean
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
        at.id,
        at.app_id,
        at.tab_id,
        at.is_visible,
        at.tab_order,
        at.tenant_id,
        at.created_at,
        at.updated_at,
        -- Tab details from JOIN - using correct column names
        t.label as tab_label,  -- Using t.label (which exists)
        t.tab_type,
        t.object_id,
        t.custom_component_path,
        t.custom_route,
        t.is_system_tab
    FROM tenant.app_tabs at
    JOIN tenant.tabs t ON at.tab_id = t.id
    WHERE at.tenant_id = p_tenant_id
    AND t.is_active = true  -- Using t.is_active (which exists)
    ORDER BY at.app_id, at.tab_order;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_tenant_app_tabs(uuid) TO public;

-- Verify the function was created
SELECT
    routine_name,
    routine_type,
    routine_schema
FROM information_schema.routines
WHERE routine_name = 'get_tenant_app_tabs'
AND routine_schema = 'public';
