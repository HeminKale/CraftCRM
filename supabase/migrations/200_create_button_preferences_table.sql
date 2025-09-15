-- Migration 200: Create Button Preferences Table
-- Stores which buttons should be displayed in record list views

-- Create table for button display preferences
CREATE TABLE IF NOT EXISTS tenant.button_preferences__a (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES system.tenants(id) ON DELETE CASCADE,
    object_id UUID NOT NULL REFERENCES tenant.objects(id) ON DELETE CASCADE,
    button_id UUID NOT NULL REFERENCES tenant.button__a(id) ON DELETE CASCADE,
    is_selected BOOLEAN DEFAULT false,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    -- Ensure one preference per button per object per tenant
    UNIQUE(tenant_id, object_id, button_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_button_preferences_tenant_object ON tenant.button_preferences__a(tenant_id, object_id);
CREATE INDEX IF NOT EXISTS idx_button_preferences_button ON tenant.button_preferences__a(button_id);

-- Add RLS policies
ALTER TABLE tenant.button_preferences__a ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see preferences for their tenant
CREATE POLICY "Users can view button preferences for their tenant" ON tenant.button_preferences__a
    FOR SELECT USING (
        tenant_id IN (
            SELECT id FROM system.tenants 
            WHERE id = (auth.jwt() ->> 'tenant_id')::UUID
        )
    );

-- Policy: Users can insert preferences for their tenant
CREATE POLICY "Users can insert button preferences for their tenant" ON tenant.button_preferences__a
    FOR INSERT WITH CHECK (
        tenant_id IN (
            SELECT id FROM system.tenants 
            WHERE id = (auth.jwt() ->> 'tenant_id')::UUID
        )
    );

-- Policy: Users can update preferences for their tenant
CREATE POLICY "Users can update button preferences for their tenant" ON tenant.button_preferences__a
    FOR UPDATE USING (
        tenant_id IN (
            SELECT id FROM system.tenants 
            WHERE id = (auth.jwt() ->> 'tenant_id')::UUID
        )
    );

-- Policy: Users can delete preferences for their tenant
CREATE POLICY "Users can delete button preferences for their tenant" ON tenant.button_preferences__a
    FOR DELETE USING (
        tenant_id IN (
            SELECT id FROM system.tenants 
            WHERE id = (auth.jwt() ->> 'tenant_id')::UUID
        )
    );

-- Add comment
COMMENT ON TABLE tenant.button_preferences__a IS 'Stores which buttons should be displayed in record list views for each object';

-- Log completion
DO $$
BEGIN
  RAISE NOTICE '✅ Migration 200 completed: Created button_preferences__a table';
END $$;
