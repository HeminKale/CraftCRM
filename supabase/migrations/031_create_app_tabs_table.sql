-- Migration: Enhance existing app_tabs table for app-specific tab configuration
-- This migration enhances the existing app_tabs table with new fields for visibility and tenant isolation

-- Add new columns to existing app_tabs table
ALTER TABLE tenant.app_tabs 
ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES system.tenants(id),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Rename display_order to tab_order for consistency
ALTER TABLE tenant.app_tabs RENAME COLUMN display_order TO tab_order;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_app_tabs_visible ON tenant.app_tabs(is_visible);
CREATE INDEX IF NOT EXISTS idx_app_tabs_tenant_id ON tenant.app_tabs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_app_tabs_order ON tenant.app_tabs(tab_order);

-- Update existing records to set tenant_id based on app's tenant_id
UPDATE tenant.app_tabs 
SET tenant_id = apps.tenant_id 
FROM tenant.apps 
WHERE tenant.app_tabs.app_id = tenant.apps.id 
AND tenant.app_tabs.tenant_id IS NULL;

-- Make tenant_id NOT NULL after populating existing records
ALTER TABLE tenant.app_tabs ALTER COLUMN tenant_id SET NOT NULL;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Users can view app_tabs for their tenant" ON tenant.app_tabs;
DROP POLICY IF EXISTS "Users can insert app_tabs for their tenant" ON tenant.app_tabs;
DROP POLICY IF EXISTS "Users can update app_tabs for their tenant" ON tenant.app_tabs;
DROP POLICY IF EXISTS "Users can delete app_tabs for their tenant" ON tenant.app_tabs;

-- Add RLS policies (table already has RLS enabled from core schema)
-- Policy: Users can only see app_tabs for their tenant
CREATE POLICY "Users can view app_tabs for their tenant" ON tenant.app_tabs
  FOR SELECT USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- Policy: Users can insert app_tabs for their tenant
CREATE POLICY "Users can insert app_tabs for their tenant" ON tenant.app_tabs
  FOR INSERT WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- Policy: Users can update app_tabs for their tenant
CREATE POLICY "Users can update app_tabs for their tenant" ON tenant.app_tabs
  FOR UPDATE USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- Policy: Users can delete app_tabs for their tenant
CREATE POLICY "Users can delete app_tabs for their tenant" ON tenant.app_tabs
  FOR DELETE USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.app_tabs TO authenticated;
GRANT USAGE ON SCHEMA tenant TO authenticated;

-- Add comments
COMMENT ON COLUMN tenant.app_tabs.is_visible IS 'Whether this tab is visible in the app';
COMMENT ON COLUMN tenant.app_tabs.tenant_id IS 'Tenant this configuration belongs to';
COMMENT ON COLUMN tenant.app_tabs.tab_order IS 'Order of this tab in the app (0-based, NULL means no specific order)';

-- Create trigger to update updated_at
CREATE OR REPLACE FUNCTION tenant.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_app_tabs_updated_at 
  BEFORE UPDATE ON tenant.app_tabs 
  FOR EACH ROW 
  EXECUTE FUNCTION tenant.update_updated_at_column();
