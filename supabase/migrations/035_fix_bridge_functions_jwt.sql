-- Migration: 035_fix_bridge_functions_jwt.sql
-- Purpose: Fix JWT path in bridge functions to match RLS policies
-- Date: 2024-01-XX

-- Drop existing functions first to avoid return type conflicts
DROP FUNCTION IF EXISTS public.get_apps();
DROP FUNCTION IF EXISTS public.get_app_tabs(uuid);
DROP FUNCTION IF EXISTS public.get_tenant_apps(UUID);
DROP FUNCTION IF EXISTS public.get_app_tab_configs();

-- Fix get_apps function to use correct JWT path
CREATE OR REPLACE FUNCTION public.get_apps()
RETURNS TABLE (
    id uuid,
    name text,
    label text,
    description text,
    is_active boolean,
    tenant_id uuid,
    created_at timestamptz,
    updated_at timestamptz
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Get the current user's tenant_id from JWT app_metadata
    RETURN QUERY
    SELECT 
        a.id,
        a.name,
        a.label,
        a.description,
        a.is_active,
        a.tenant_id,
        a.created_at,
        a.updated_at
    FROM tenant.apps a
    WHERE a.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
        AND a.is_active = true
    ORDER BY a.name;
END;
$$;

-- Fix get_app_tabs function to use correct JWT path
CREATE OR REPLACE FUNCTION public.get_app_tabs(p_app_id uuid DEFAULT NULL)
RETURNS TABLE (
    id uuid,
    app_id uuid,
    object_id uuid,
    tab_order integer,
    is_active boolean,
    tenant_id uuid,
    created_at timestamptz,
    updated_at timestamptz,
    object_name text,
    object_label text
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Get the current user's tenant_id from JWT app_metadata
    RETURN QUERY
    SELECT 
        at.id,
        at.app_id,
        at.object_id,
        at.tab_order,
        at.is_active,
        at.tenant_id,
        at.created_at,
        at.updated_at,
        o.name as object_name,
        o.label as object_label
    FROM tenant.app_tabs at
    JOIN tenant.objects o ON at.object_id = o.id
    WHERE at.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
        AND at.is_active = true
        AND o.is_active = true
        AND (p_app_id IS NULL OR at.app_id = p_app_id)
    ORDER BY at.tab_order, o.label;
END;
$$;

-- Create proper get_tenant_apps function for direct tenant access
CREATE OR REPLACE FUNCTION public.get_tenant_apps(p_tenant_id UUID)
RETURNS TABLE (
    id uuid,
    name text,
    label text,
    description text,
    is_active boolean,
    tenant_id uuid,
    created_at timestamptz,
    updated_at timestamptz
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Verify the user has access to this tenant
    IF (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid != p_tenant_id THEN
        RAISE EXCEPTION 'Access denied: tenant_id mismatch';
    END IF;
    
    RETURN QUERY
    SELECT 
        a.id,
        a.name,
        a.label,
        a.description,
        a.is_active,
        a.tenant_id,
        a.created_at,
        a.updated_at
    FROM tenant.apps a
    WHERE a.tenant_id = p_tenant_id
        AND a.is_active = true
    ORDER BY a.name;
END;
$$;

-- Create function for app tab configurations
CREATE OR REPLACE FUNCTION public.get_app_tab_configs()
RETURNS TABLE (
    id uuid,
    app_id uuid,
    tab_id uuid,
    tab_order integer,
    is_visible boolean,
    tenant_id uuid,
    created_at timestamptz,
    updated_at timestamptz,
    app_name text,
    app_description text,
    tab_name text,
    tab_description text,
    object_name text,
    object_label text
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
        t.label as tab_name,
        t.description as tab_description,
        o.name as object_name,
        o.label as object_label
    FROM tenant.app_tabs at
    JOIN tenant.apps a ON at.app_id = a.id
    JOIN tenant.tabs t ON at.tab_id = t.id
    LEFT JOIN tenant.objects o ON t.object_id = o.id
    WHERE at.tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
        AND at.is_active = true
        AND a.is_active = true
        AND t.is_active = true
    ORDER BY at.app_id, at.tab_order, t.label;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.get_apps() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_app_tabs(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_apps(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_app_tab_configs() TO authenticated;

-- Verify the functions were created
SELECT 
    routine_name,
    routine_type,
    data_type
FROM information_schema.routines 
WHERE routine_schema = 'public' 
    AND routine_name IN ('get_apps', 'get_app_tabs', 'get_tenant_apps', 'get_app_tab_configs')
ORDER BY routine_name;
