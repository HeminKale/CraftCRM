-- Migration: Fix objects table unique constraint
-- This migration adds the missing unique constraint needed for ON CONFLICT operations

-- Add unique constraint on (name, tenant_id) for tenant.objects table
-- This allows ON CONFLICT (name, tenant_id) DO NOTHING to work properly
ALTER TABLE tenant.objects 
ADD CONSTRAINT unique_object_name_per_tenant UNIQUE (name, tenant_id);

-- Add index for performance on this constraint
CREATE INDEX IF NOT EXISTS idx_objects_name_tenant_id ON tenant.objects(name, tenant_id);

-- Add comment explaining the constraint
COMMENT ON CONSTRAINT unique_object_name_per_tenant ON tenant.objects IS 'Ensures unique object names per tenant, allowing ON CONFLICT operations';

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.objects TO authenticated;
GRANT USAGE ON SCHEMA tenant TO authenticated;
