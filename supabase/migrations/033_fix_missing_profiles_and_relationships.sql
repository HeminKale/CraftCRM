-- Migration: 033_fix_missing_profiles_and_relationships.sql
-- Purpose: Create missing profiles table and fix foreign key relationships
-- Date: 2024-01-XX

-- 1. Create profiles table in tenant schema
CREATE TABLE IF NOT EXISTS tenant.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES system.tenants(id),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Add RLS policy for profiles
ALTER TABLE tenant.profiles ENABLE ROW LEVEL SECURITY;

-- Create policy for tenant isolation
CREATE POLICY "Users can view profiles in their tenant" ON tenant.profiles
    FOR ALL USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- 3. Add missing foreign key relationships
-- Add foreign key from app_tabs to tabs
ALTER TABLE tenant.app_tabs 
ADD CONSTRAINT IF NOT EXISTS fk_app_tabs_tab_id 
FOREIGN KEY (tab_id) REFERENCES tenant.tabs(id) ON DELETE CASCADE;

-- Add foreign key from app_tabs to apps
ALTER TABLE tenant.app_tabs 
ADD CONSTRAINT IF NOT EXISTS fk_app_tabs_app_id 
FOREIGN KEY (app_id) REFERENCES tenant.apps(id) ON DELETE CASCADE;

-- Add foreign key from tabs to apps
ALTER TABLE tenant.tabs 
ADD CONSTRAINT IF NOT EXISTS fk_tabs_app_id 
FOREIGN KEY (app_id) REFERENCES tenant.apps(id) ON DELETE CASCADE;

-- 4. Insert sample profiles data (optional - you can customize these)
INSERT INTO tenant.profiles (tenant_id, name, description) VALUES
('2f07fa14-e8d0-4ac8-ae7f-ac7b48a48337', 'Administrator', 'Full system access'),
('2f07fa14-e8d0-4ac8-ae7f-ac7b48a48337', 'User', 'Standard user access'),
('2f07fa14-e8d0-4ac8-ae7f-ac7b48a48337', 'Manager', 'Manager level access')
ON CONFLICT (id) DO NOTHING;

-- 5. Grant necessary permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.profiles TO authenticated;

-- 6. Add comments
COMMENT ON TABLE tenant.profiles IS 'User profiles for role-based access control';
COMMENT ON COLUMN tenant.profiles.name IS 'Profile name (e.g., Administrator, User, Manager)';
COMMENT ON COLUMN tenant.profiles.description IS 'Description of profile permissions';