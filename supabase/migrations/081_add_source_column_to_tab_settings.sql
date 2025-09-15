-- Migration 081: Add Source Column to Tab Settings
-- Purpose: Add object_label to show which object each tab is created for

-- Drop the existing function first to allow return type changes
DROP FUNCTION IF EXISTS public.get_tenant_tabs_for_settings(uuid);

-- Update get_tenant_tabs_for_settings to include object_label for Source column
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
    description text,
    -- NEW: Source column to show object label or tab type
    source_label text
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
        COALESCE(t.custom_route, t.label, 'No description') as description,  -- Create description
        -- NEW: Source column logic
        CASE 
            WHEN t.tab_type = 'object' AND t.object_id IS NOT NULL THEN
                COALESCE(o.label, o.name, 'Unknown Object')  -- Show object label, fallback to name
            WHEN t.tab_type = 'custom' AND t.custom_component_path IS NOT NULL THEN
                'Custom Component'
            WHEN t.tab_type = 'hybrid' THEN
                'Hybrid Tab'
            ELSE
                'System Tab'
        END as source_label
    FROM tenant.tabs t
    LEFT JOIN tenant.objects o ON t.object_id = o.id  -- Join to get object label
    WHERE t.tenant_id = p_tenant_id
        AND t.is_active = true
    ORDER BY t.order_index, t.label;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_tenant_tabs_for_settings(uuid) TO public;

-- Log successful migration
DO $$
BEGIN
    RAISE NOTICE '🚀 Migration 081: Source column added to tab settings!';
    RAISE NOTICE '✅ New source_label column shows object labels for object-type tabs';
    RAISE NOTICE '✅ Custom tabs show "Custom Component" or "Custom Route"';
    RAISE NOTICE '✅ System tabs are properly identified';
    RAISE NOTICE '🔮 Tab settings now clearly show what each tab is connected to!';
END $$;
