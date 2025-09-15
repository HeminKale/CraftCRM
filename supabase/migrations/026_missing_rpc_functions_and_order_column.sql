-- ================================
-- Migration 026: Add Missing RPC Functions and Order Column
-- ================================
-- This migration adds the missing RPC functions that the frontend expects
-- and adds the missing 'order' column to tenant.apps table

-- 1. Add missing 'order' column to tenant.apps table
ALTER TABLE tenant.apps 
ADD COLUMN IF NOT EXISTS "order" integer DEFAULT 0;

-- Update existing records to have sequential order
UPDATE tenant.apps 
SET "order" = subquery.row_num
FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY name) as row_num
    FROM tenant.apps
) subquery
WHERE tenant.apps.id = subquery.id;

-- 2. Create get_apps function (wrapper around get_tenant_apps)
-- Drop existing function first if it exists with different return type
DROP FUNCTION IF EXISTS public.get_apps();

CREATE OR REPLACE FUNCTION public.get_apps()
RETURNS TABLE (
    id uuid,
    name text,
    description text,
    is_active boolean,
    "order" integer,
    created_at timestamptz,
    updated_at timestamptz
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Get the current user's tenant_id from JWT
    RETURN QUERY
    SELECT 
        a.id,
        a.name,
        a.description,
        a.is_active,
        a."order",
        a.created_at,
        a.updated_at
    FROM tenant.apps a
    WHERE a.tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
        AND a.is_active = true
    ORDER BY a."order", a.name;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.get_apps() TO authenticated;

-- 3. Create get_app_tabs function
-- Drop existing function first if it exists with different return type
DROP FUNCTION IF EXISTS public.get_app_tabs(uuid);

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
    -- Include object details for convenience
    object_name text,
    object_label text
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Get the current user's tenant_id from JWT
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
    WHERE at.tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
        AND at.is_active = true
        AND o.is_active = true
        AND (p_app_id IS NULL OR at.app_id = p_app_id)
    ORDER BY at.tab_order, o.label;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.get_app_tabs(uuid) TO authenticated;

-- 4. Create get_app_tabs function without parameters (for backward compatibility)
-- Drop existing function first if it exists with different return type
DROP FUNCTION IF EXISTS public.get_app_tabs();

CREATE OR REPLACE FUNCTION public.get_app_tabs()
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
    RETURN QUERY SELECT * FROM public.get_app_tabs(NULL);
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.get_app_tabs() TO authenticated;

-- 5. Create get_available_tabs function (for the frontend)
-- Drop existing function first if it exists with different return type
DROP FUNCTION IF EXISTS public.get_available_tabs();

CREATE OR REPLACE FUNCTION public.get_available_tabs()
RETURNS TABLE (
    object_id uuid,
    object_name text,
    object_label text,
    route text,
    is_visible boolean
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Get the current user's tenant_id from JWT
    RETURN QUERY
    SELECT 
        o.id as object_id,
        o.name as object_name,
        o.label as object_label,
        '/' || o.name as route,
        true as is_visible
    FROM tenant.objects o
    WHERE o.tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
        AND o.is_active = true
    ORDER BY o.name;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.get_available_tabs() TO authenticated;

-- 6. Add RLS policies if they don't exist
DO $$
BEGIN
    -- RLS policy for tenant.apps
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'tenant' 
        AND tablename = 'apps' 
        AND policyname = 'apps_tenant_isolation'
    ) THEN
        CREATE POLICY apps_tenant_isolation ON tenant.apps
            FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
    END IF;

    -- RLS policy for tenant.app_tabs
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'tenant' 
        AND tablename = 'app_tabs' 
        AND policyname = 'app_tabs_tenant_isolation'
    ) THEN
        CREATE POLICY app_tabs_tenant_isolation ON tenant.app_tabs
            FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
    END IF;
END $$;
