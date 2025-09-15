-- ================================
-- Migration 003a: Fix Missing tenant_id Columns
-- Craft App - Add tenant_id to missing tenant tables
-- ================================

-- ===========================================
-- 1. ADD MISSING tenant_id COLUMNS
-- ===========================================

-- Add tenant_id to user_permission_sets
ALTER TABLE tenant.user_permission_sets 
ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES system.tenants(id);

-- Add tenant_id to permission_set_objects
ALTER TABLE tenant.permission_set_objects 
ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES system.tenants(id);

-- Add tenant_id to permission_set_fields
ALTER TABLE tenant.permission_set_fields 
ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES system.tenants(id);

-- Add tenant_id to app_tabs
ALTER TABLE tenant.app_tabs 
ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES system.tenants(id);

-- ===========================================
-- 2. BACKFILL tenant_id VALUES
-- ===========================================

-- Backfill user_permission_sets.tenant_id from permission_sets
UPDATE tenant.user_permission_sets ups
SET tenant_id = ps.tenant_id
FROM tenant.permission_sets ps
WHERE ups.perm_set_id = ps.id
AND ups.tenant_id IS NULL;

-- Backfill permission_set_objects.tenant_id from permission_sets
UPDATE tenant.permission_set_objects pso
SET tenant_id = ps.tenant_id
FROM tenant.permission_sets ps
WHERE pso.perm_set_id = ps.id
AND pso.tenant_id IS NULL;

-- Backfill permission_set_fields.tenant_id from permission_sets
UPDATE tenant.permission_set_fields psf
SET tenant_id = ps.tenant_id
FROM tenant.permission_sets ps
WHERE psf.perm_set_id = ps.id
AND psf.tenant_id IS NULL;

-- Backfill app_tabs.tenant_id - check if object_id exists first
DO $$
BEGIN
    -- Check if app_tabs has object_id column
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'tenant' 
        AND table_name = 'app_tabs' 
        AND column_name = 'object_id'
    ) THEN
        -- If object_id exists, backfill from objects
        EXECUTE 'UPDATE tenant.app_tabs at
                SET tenant_id = o.tenant_id
                FROM tenant.objects o
                WHERE at.object_id = o.id
                AND at.tenant_id IS NULL';
    ELSE
        -- If no object_id, set tenant_id to a default tenant (first tenant)
        EXECUTE 'UPDATE tenant.app_tabs 
                SET tenant_id = (SELECT id FROM system.tenants LIMIT 1)
                WHERE tenant_id IS NULL';
    END IF;
END $$;

-- ===========================================
-- 3. MAKE tenant_id NOT NULL (After backfill)
-- ===========================================

-- Make tenant_id NOT NULL for user_permission_sets
ALTER TABLE tenant.user_permission_sets 
ALTER COLUMN tenant_id SET NOT NULL;

-- Make tenant_id NOT NULL for permission_set_objects
ALTER TABLE tenant.permission_set_objects 
ALTER COLUMN tenant_id SET NOT NULL;

-- Make tenant_id NOT NULL for permission_set_fields
ALTER TABLE tenant.permission_set_fields 
ALTER COLUMN tenant_id SET NOT NULL;

-- Make tenant_id NOT NULL for app_tabs
ALTER TABLE tenant.app_tabs 
ALTER COLUMN tenant_id SET NOT NULL;

-- ===========================================
-- 4. ADD INDEXES FOR PERFORMANCE
-- ===========================================

-- Add indexes for better RLS performance
CREATE INDEX IF NOT EXISTS idx_tenant_user_permission_sets_tenant_id 
ON tenant.user_permission_sets(tenant_id);

CREATE INDEX IF NOT EXISTS idx_tenant_permission_set_objects_tenant_id 
ON tenant.permission_set_objects(tenant_id);

CREATE INDEX IF NOT EXISTS idx_tenant_permission_set_fields_tenant_id 
ON tenant.permission_set_fields(tenant_id);

CREATE INDEX IF NOT EXISTS idx_tenant_app_tabs_tenant_id 
ON tenant.app_tabs(tenant_id);

-- ===========================================
-- 5. ADD RLS POLICIES
-- ===========================================

-- Enable RLS on all tenant tables
ALTER TABLE tenant.user_permission_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.permission_set_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.permission_set_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.app_tabs ENABLE ROW LEVEL SECURITY;

-- RLS policies for user_permission_sets
CREATE POLICY "select_user_permission_sets_per_tenant" ON tenant.user_permission_sets
    FOR SELECT USING (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);

CREATE POLICY "insert_user_permission_sets_per_tenant" ON tenant.user_permission_sets
    FOR INSERT WITH CHECK (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);

CREATE POLICY "update_user_permission_sets_per_tenant" ON tenant.user_permission_sets
    FOR UPDATE USING (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid)
    WITH CHECK (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);

CREATE POLICY "delete_user_permission_sets_per_tenant" ON tenant.user_permission_sets
    FOR DELETE USING (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);

-- RLS policies for permission_set_objects
CREATE POLICY "select_permission_set_objects_per_tenant" ON tenant.permission_set_objects
    FOR SELECT USING (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);

CREATE POLICY "insert_permission_set_objects_per_tenant" ON tenant.permission_set_objects
    FOR INSERT WITH CHECK (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);

CREATE POLICY "update_permission_set_objects_per_tenant" ON tenant.permission_set_objects
    FOR UPDATE USING (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid)
    WITH CHECK (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);

CREATE POLICY "delete_permission_set_objects_per_tenant" ON tenant.permission_set_objects
    FOR DELETE USING (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);

-- RLS policies for permission_set_fields
CREATE POLICY "select_permission_set_fields_per_tenant" ON tenant.permission_set_fields
    FOR SELECT USING (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);

CREATE POLICY "insert_permission_set_fields_per_tenant" ON tenant.permission_set_fields
    FOR INSERT WITH CHECK (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);

CREATE POLICY "update_permission_set_fields_per_tenant" ON tenant.permission_set_fields
    FOR UPDATE USING (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid)
    WITH CHECK (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);

CREATE POLICY "delete_permission_set_fields_per_tenant" ON tenant.permission_set_fields
    FOR DELETE USING (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);

-- RLS policies for app_tabs
CREATE POLICY "select_app_tabs_per_tenant" ON tenant.app_tabs
    FOR SELECT USING (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);

CREATE POLICY "insert_app_tabs_per_tenant" ON tenant.app_tabs
    FOR INSERT WITH CHECK (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);

CREATE POLICY "update_app_tabs_per_tenant" ON tenant.app_tabs
    FOR UPDATE USING (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid)
    WITH CHECK (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);

CREATE POLICY "delete_app_tabs_per_tenant" ON tenant.app_tabs
    FOR DELETE USING (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);

-- ===========================================
-- 6. VERIFICATION
-- ===========================================

-- Verify all tenant tables now have tenant_id
SELECT 
    table_name,
    CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'tenant' 
        AND table_name = t.table_name 
        AND column_name = 'tenant_id'
    ) THEN '✅ Has tenant_id' ELSE '❌ Missing tenant_id' END as status
FROM (
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'tenant' 
    AND table_type = 'BASE TABLE'
) t
ORDER BY table_name;

-- ===========================================
-- MIGRATION COMPLETE
-- ===========================================

-- Now you can run Migration 003 without the tenant_id error! 