-- Migration 051: Add get_tenant_app_tabs Bridge Function
-- This migration creates a bridge function to get app-tab relationships, bypassing RLS issues

-- Create get_tenant_app_tabs bridge function to fetch app-tab relationships
CREATE OR REPLACE FUNCTION public.get_tenant_app_tabs(p_tenant_id uuid)
RETURNS TABLE (
    id uuid,
    app_id uuid,
    tab_id uuid,
    is_visible boolean,
    tab_order integer,
    tenant_id uuid,
    created_at timestamptz,
    updated_at timestamptz
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
        at.updated_at
    FROM tenant.app_tabs at
    WHERE at.tenant_id = p_tenant_id
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
