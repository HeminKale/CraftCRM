-- Migration 052: Add get_tenant_tabs_for_settings Bridge Function
-- This migration creates a comprehensive bridge function for Tab Settings display
-- Returns all columns needed for the Tab Settings DataTable

-- Create get_tenant_tabs_for_settings bridge function for Tab Settings
CREATE OR REPLACE FUNCTION public.get_tenant_tabs_for_settings(p_tenant_id uuid)
RETURNS TABLE (
    id uuid,
    label character varying(255),
    tab_type character varying(20),
    object_id uuid,
    custom_component_path text,
    custom_route text,
    is_active boolean,
    order_index integer,
    created_at timestamptz,
    updated_at timestamptz,
    is_system_tab boolean,
    -- Additional columns needed for Tab Settings display:
    is_visible boolean,
    api_name varchar(255),
    description text
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
        t.is_system_tab,
        -- Map additional columns for Tab Settings:
        COALESCE(t.is_active, true) as is_visible,  -- Map is_active to is_visible
        CASE 
            WHEN t.object_id IS NOT NULL THEN 'Object ID: ' || t.object_id::text
            WHEN t.custom_route IS NOT NULL THEN t.custom_route
            ELSE t.label
        END as api_name,  -- Create api_name from available data
        COALESCE(t.custom_route, t.label, 'No description') as description  -- Create description
    FROM tenant.tabs t
    WHERE t.tenant_id = p_tenant_id
        AND t.is_active = true
    ORDER BY t.order_index, t.label;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_tenant_tabs_for_settings(uuid) TO public;

-- Verify the function was created
SELECT
    routine_name,
    routine_type,
    routine_schema
FROM information_schema.routines
WHERE routine_name = 'get_tenant_tabs_for_settings'
AND routine_schema = 'public';
