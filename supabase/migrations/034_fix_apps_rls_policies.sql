-- Migration: 034_fix_apps_rls_policies.sql
-- Purpose: Fix missing RLS policies for tenant.apps table
-- Date: 2024-01-XX

-- 1. Enable RLS on apps table if not already enabled
ALTER TABLE tenant.apps ENABLE ROW LEVEL SECURITY;

-- 2. Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Users can view apps in their tenant" ON tenant.apps;
DROP POLICY IF EXISTS "Users can insert apps in their tenant" ON tenant.apps;
DROP POLICY IF EXISTS "Users can update apps in their tenant" ON tenant.apps;
DROP POLICY IF EXISTS "Users can delete apps in their tenant" ON tenant.apps;

-- 3. Create comprehensive RLS policies for apps table
-- Policy for viewing apps (SELECT)
CREATE POLICY "Users can view apps in their tenant" ON tenant.apps
    FOR SELECT USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- Policy for creating apps (INSERT)
CREATE POLICY "Users can insert apps in their tenant" ON tenant.apps
    FOR INSERT WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- Policy for updating apps (UPDATE)
CREATE POLICY "Users can update apps in their tenant" ON tenant.apps
    FOR UPDATE USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- Policy for deleting apps (DELETE)
CREATE POLICY "Users can delete apps in their tenant" ON tenant.apps
    FOR DELETE USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- 4. Also fix RLS policies for app_tabs table
ALTER TABLE tenant.app_tabs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view app_tabs in their tenant" ON tenant.app_tabs;
DROP POLICY IF EXISTS "Users can insert app_tabs in their tenant" ON tenant.app_tabs;
DROP POLICY IF EXISTS "Users can update app_tabs in their tenant" ON tenant.app_tabs;
DROP POLICY IF EXISTS "Users can delete app_tabs in their tenant" ON tenant.app_tabs;

-- Create policies for app_tabs
CREATE POLICY "Users can view app_tabs in their tenant" ON tenant.app_tabs
    FOR SELECT USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

CREATE POLICY "Users can insert app_tabs in their tenant" ON tenant.app_tabs
    FOR INSERT WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

CREATE POLICY "Users can update app_tabs in their tenant" ON tenant.app_tabs
    FOR UPDATE USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

CREATE POLICY "Users can delete app_tabs in their tenant" ON tenant.app_tabs
    FOR DELETE USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- 5. Grant necessary permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.apps TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.app_tabs TO authenticated;

-- 6. Verify the policies were created
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE schemaname = 'tenant' 
    AND tablename IN ('apps', 'app_tabs')
ORDER BY tablename, policyname;
