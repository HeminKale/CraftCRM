-- Migration: 038_cleanup_conflicting_rls.sql
-- Purpose: Clean up conflicting RLS policies and create a single consistent one
-- Date: 2024-01-XX

-- First, disable RLS temporarily
ALTER TABLE tenant.apps DISABLE ROW LEVEL SECURITY;

-- Drop ALL existing conflicting policies
DROP POLICY IF EXISTS "Users can delete apps in their tenant" ON tenant.apps;
DROP POLICY IF EXISTS "Users can insert apps in their tenant" ON tenant.apps;
DROP POLICY IF EXISTS "Users can update apps in their tenant" ON tenant.apps;
DROP POLICY IF EXISTS "Users can view apps from their tenant" ON tenant.apps;
DROP POLICY IF EXISTS "Users can view apps in their tenant" ON tenant.apps;
DROP POLICY IF EXISTS "apps_tenant_isolation" ON tenant.apps;

-- Re-enable RLS
ALTER TABLE tenant.apps ENABLE ROW LEVEL SECURITY;

-- Create a single, comprehensive policy that tries multiple JWT paths
CREATE POLICY "apps_tenant_isolation_comprehensive" ON tenant.apps
    FOR ALL USING (
        -- Try multiple possible JWT paths for tenant_id
        tenant_id = COALESCE(
            (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
            (auth.jwt() ->> 'tenant_id')::uuid,
            (auth.jwt() -> 'user_metadata' ->> 'tenant_id')::uuid
        )
    ) WITH CHECK (
        -- Same logic for INSERT/UPDATE operations
        tenant_id = COALESCE(
            (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
            (auth.jwt() ->> 'tenant_id')::uuid,
            (auth.jwt() -> 'user_metadata' ->> 'tenant_id')::uuid
        )
    );

-- Also clean up tenant.app_tabs if it has similar issues
ALTER TABLE tenant.app_tabs DISABLE ROW LEVEL SECURITY;

-- Drop ALL existing policies on app_tabs (comprehensive cleanup)
DROP POLICY IF EXISTS "Users can delete app tabs in their tenant" ON tenant.app_tabs;
DROP POLICY IF EXISTS "Users can insert app tabs in their tenant" ON tenant.app_tabs;
DROP POLICY IF EXISTS "Users can update app tabs in their tenant" ON tenant.app_tabs;
DROP POLICY IF EXISTS "Users can view app tabs from their tenant" ON tenant.app_tabs;
DROP POLICY IF EXISTS "Users can view app tabs in their tenant" ON tenant.app_tabs;
DROP POLICY IF EXISTS "app_tabs_tenant_isolation" ON tenant.app_tabs;
DROP POLICY IF EXISTS "Users can delete app_tabs for their tenant" ON tenant.app_tabs;
DROP POLICY IF EXISTS "Users can insert app_tabs for their tenant" ON tenant.app_tabs;
DROP POLICY IF EXISTS "Users can update app_tabs for their tenant" ON tenant.app_tabs;
DROP POLICY IF EXISTS "Users can view app_tabs for their tenant" ON tenant.app_tabs;
DROP POLICY IF EXISTS "delete_app_tabs_per_tenant" ON tenant.app_tabs;
DROP POLICY IF EXISTS "insert_app_tabs_per_tenant" ON tenant.app_tabs;
DROP POLICY IF EXISTS "select_app_tabs_per_tenant" ON tenant.app_tabs;
DROP POLICY IF EXISTS "update_app_tabs_per_tenant" ON tenant.app_tabs;
DROP POLICY IF EXISTS "app_tabs_tenant_isolation_comprehensive" ON tenant.app_tabs;

-- Re-enable RLS
ALTER TABLE tenant.app_tabs ENABLE ROW LEVEL SECURITY;

-- Create comprehensive policy for app_tabs
CREATE POLICY "app_tabs_tenant_isolation_comprehensive" ON tenant.app_tabs
    FOR ALL USING (
        tenant_id = COALESCE(
            (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
            (auth.jwt() ->> 'tenant_id')::uuid,
            (auth.jwt() -> 'user_metadata' ->> 'tenant_id')::uuid
        )
    ) WITH CHECK (
        tenant_id = COALESCE(
            (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
            (auth.jwt() ->> 'tenant_id')::uuid,
            (auth.jwt() -> 'user_metadata' ->> 'tenant_id')::uuid
        )
    );

-- Verify the cleanup worked
SELECT 
    'Cleanup Results' as info,
    schemaname,
    tablename,
    policyname,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE tablename IN ('apps', 'app_tabs') 
    AND schemaname = 'tenant'
ORDER BY tablename, policyname;

-- Test that we can now access the tables
SELECT 
    'Policy Test' as info,
    CASE 
        WHEN (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid IS NOT NULL 
        THEN 'JWT app_metadata.tenant_id is valid'
        ELSE 'JWT app_metadata.tenant_id is NULL'
    END as app_metadata_status,
    CASE 
        WHEN (auth.jwt() ->> 'tenant_id')::uuid IS NOT NULL 
        THEN 'JWT tenant_id is valid'
        ELSE 'JWT tenant_id is NULL'
    END as direct_tenant_status,
    CASE 
        WHEN (auth.jwt() -> 'user_metadata' ->> 'tenant_id')::uuid IS NOT NULL 
        THEN 'JWT user_metadata.tenant_id is valid'
        ELSE 'JWT user_metadata.tenant_id is NULL'
    END as user_metadata_status;
