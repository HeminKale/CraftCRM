-- Migration: Enhance tabs table with new fields for enhanced tab management
-- This migration adds fields needed for object tabs, custom tabs, and hybrid tabs

-- Add new columns to tenant.tabs table
ALTER TABLE tenant.tabs 
ADD COLUMN IF NOT EXISTS tab_type VARCHAR(20) DEFAULT 'object' CHECK (tab_type IN ('object', 'custom', 'hybrid')),
ADD COLUMN IF NOT EXISTS object_id UUID REFERENCES tenant.objects(id),
ADD COLUMN IF NOT EXISTS custom_component_path TEXT,
ADD COLUMN IF NOT EXISTS custom_route TEXT,
ADD COLUMN IF NOT EXISTS is_system_tab BOOLEAN DEFAULT FALSE;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_tabs_object_id ON tenant.tabs(object_id);
CREATE INDEX IF NOT EXISTS idx_tabs_tab_type ON tenant.tabs(tab_type);

-- Update existing tabs to have default values
UPDATE tenant.tabs 
SET tab_type = 'object', is_system_tab = FALSE 
WHERE tab_type IS NULL;

-- Add comment to explain the new fields
COMMENT ON COLUMN tenant.tabs.tab_type IS 'Type of tab: object (displays object records), custom (custom component), or hybrid (both)';
COMMENT ON COLUMN tenant.tabs.object_id IS 'Reference to tenant.objects table for object tabs';
COMMENT ON COLUMN tenant.tabs.custom_component_path IS 'Path to custom component for custom tabs';
COMMENT ON COLUMN tenant.tabs.custom_route IS 'Custom route for custom tabs';
COMMENT ON COLUMN tenant.tabs.is_system_tab IS 'Whether this is a system-generated tab that cannot be deleted';

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.tabs TO authenticated;
GRANT USAGE ON SCHEMA tenant TO authenticated;
