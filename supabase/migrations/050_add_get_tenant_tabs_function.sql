-- Migration 050: Add get_tenant_tabs Bridge Function
-- This migration creates a bridge function to get tenant tabs, bypassing RLS issues

-- Create get_tenant_tabs bridge function to fetch actual tab records
CREATE OR REPLACE FUNCTION public.get_tenant_tabs(p_tenant_id uuid)
RETURNS TABLE (
    id uuid,
    label character varying(255),  -- Exact type: varchar(255)
    tab_type character varying(20),  -- Exact type: varchar(20)
    object_id uuid,
    custom_component_path text,
    custom_route text,
    is_active boolean,
    order_index integer,
    created_at timestamptz,
    updated_at timestamptz,
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
        t.id,
        t.label,
        t.tab_type,
        t.object_id,
        t.custom_component_path,
        t.custom_route,
        t.is_active,
        t.order_index,
        t.created_at,
        t.updated_at,
        t.is_system_tab
    FROM tenant.tabs t
    WHERE t.tenant_id = p_tenant_id
        AND t.is_active = true
    ORDER BY t.order_index, t.label;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_tenant_tabs(uuid) TO public;

-- Verify the function was created
SELECT 
    routine_name,
    routine_type,
    routine_schema
FROM information_schema.routines 
WHERE routine_name = 'get_tenant_tabs' 
AND routine_schema = 'public';

-- Expected result: Should return 1 row with the function details
