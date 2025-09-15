-- Migration: 029_fix_schema_compliance.sql
-- Purpose: Move all bridge functions from public schema to system schema
-- Date: 2024-01-XX

-- 1. Drop existing functions from public schema
DROP FUNCTION IF EXISTS public.get_apps(p_tenant_id UUID);
DROP FUNCTION IF EXISTS public.get_available_tabs(p_tenant_id UUID);
DROP FUNCTION IF EXISTS public.get_app_tabs(p_app_id UUID, p_tenant_id UUID);
DROP FUNCTION IF EXISTS public.upsert_app(p_name TEXT, p_description TEXT, p_is_active BOOLEAN, p_tenant_id UUID);
DROP FUNCTION IF EXISTS public.upsert_app_tabs(p_app_id UUID, p_tab_ids UUID[], p_tenant_id UUID);

-- 2. Create functions in system schema with proper security
CREATE OR REPLACE FUNCTION system.get_apps(p_tenant_id UUID)
RETURNS TABLE (
    id UUID,
    name TEXT,
    description TEXT,
    is_active BOOLEAN,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = system, public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        a.id,
        a.name,
        a.description,
        a.is_active,
        a.created_at,
        a.updated_at
    FROM tenant.apps a
    WHERE a.tenant_id = p_tenant_id
    ORDER BY a.name;
END;
$$;

CREATE OR REPLACE FUNCTION system.get_available_tabs(p_tenant_id UUID)
RETURNS TABLE (
    id UUID,
    name TEXT,
    description TEXT,
    is_visible BOOLEAN,
    api_name TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = system, public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        t.id,
        t.name,
        t.description,
        t.is_visible,
        t.api_name,
        t.created_at
    FROM tenant.tabs t
    WHERE t.tenant_id = p_tenant_id
    ORDER BY t.name;
END;
$$;

CREATE OR REPLACE FUNCTION system.get_app_tabs(p_app_id UUID, p_tenant_id UUID)
RETURNS TABLE (
    tab_id UUID,
    tab_name TEXT,
    is_selected BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = system, public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        t.id as tab_id,
        t.name as tab_name,
        CASE WHEN at.tab_id IS NOT NULL THEN true ELSE false END as is_selected
    FROM tenant.tabs t
    LEFT JOIN tenant.app_tabs at ON t.id = at.tab_id AND at.app_id = p_app_id
    WHERE t.tenant_id = p_tenant_id
    ORDER BY t.name;
END;
$$;

CREATE OR REPLACE FUNCTION system.upsert_app(
    p_name TEXT,
    p_description TEXT,
    p_is_active BOOLEAN,
    p_tenant_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = system, public
AS $$
DECLARE
    v_app_id UUID;
BEGIN
    INSERT INTO tenant.apps (name, description, is_active, tenant_id)
    VALUES (p_name, p_description, p_is_active, p_tenant_id)
    ON CONFLICT (name, tenant_id) 
    DO UPDATE SET 
        description = EXCLUDED.description,
        is_active = EXCLUDED.is_active,
        updated_at = NOW()
    RETURNING id INTO v_app_id;
    
    RETURN v_app_id;
END;
$$;

CREATE OR REPLACE FUNCTION system.upsert_app_tabs(
    p_app_id UUID,
    p_tab_ids UUID[],
    p_tenant_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = system, public
AS $$
BEGIN
    -- Delete existing app tabs for this app
    DELETE FROM tenant.app_tabs 
    WHERE app_id = p_app_id AND tenant_id = p_tenant_id;
    
    -- Insert new app tabs
    IF array_length(p_tab_ids, 1) > 0 THEN
        INSERT INTO tenant.app_tabs (app_id, tab_id, tenant_id)
        SELECT p_app_id, unnest(p_tab_ids), p_tenant_id;
    END IF;
    
    RETURN true;
END;
$$;

-- 3. Grant execute permissions on system schema functions
GRANT EXECUTE ON FUNCTION system.get_apps(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION system.get_available_tabs(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION system.get_app_tabs(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION system.upsert_app(TEXT, TEXT, BOOLEAN, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION system.upsert_app_tabs(UUID, UUID[], UUID) TO authenticated;

-- 4. Ensure system schema is accessible
GRANT USAGE ON SCHEMA system TO authenticated;