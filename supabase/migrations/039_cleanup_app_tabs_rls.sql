-- Migration: 039_cleanup_app_tabs_rls.sql
-- Purpose: Clean up conflicting RLS policies on app_tabs table only
-- Date: 2024-01-XX

-- Clean up tenant.app_tabs RLS policies
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
WHERE tablename = 'app_tabs' 
    AND schemaname = 'tenant'
ORDER BY policyname;

-- Test that we can now access the app_tabs table
SELECT 
    'Access Test' as info,
    COUNT(*) as app_tabs_count
FROM tenant.app_tabs;
