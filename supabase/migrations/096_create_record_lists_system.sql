-- Migration 096: Create Record Lists System
-- Purpose: Add custom record list functionality with filters and field selection

-- Create record lists table
CREATE TABLE IF NOT EXISTS tenant.record_lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES system.tenants(id) ON DELETE CASCADE,
    object_id UUID NOT NULL REFERENCES tenant.objects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    filter_criteria JSONB DEFAULT '[]',
    selected_fields TEXT[] DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES system.users(id),
    
    -- Ensure unique names per object per tenant
    UNIQUE(tenant_id, object_id, name)
);

-- Create record list filters table for structured filtering
CREATE TABLE IF NOT EXISTS tenant.record_list_filters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    record_list_id UUID NOT NULL REFERENCES tenant.record_lists(id) ON DELETE CASCADE,
    field_name TEXT NOT NULL,
    operator TEXT NOT NULL CHECK (operator IN ('==', '!=', 'contains', '>', '<', '>=', '<=', 'in', 'not_in')),
    value TEXT,
    logical_operator TEXT DEFAULT 'AND' CHECK (logical_operator IN ('AND', 'OR')),
    created_at TIMESTAMPTZ DEFAULT now(),
    
    -- Ensure proper filter structure
    CONSTRAINT valid_filter CHECK (
        (operator IN ('==', '!=', '>', '<', '>=', '<=') AND value IS NOT NULL) OR
        (operator IN ('contains', 'in', 'not_in') AND value IS NOT NULL) OR
        (operator = 'is_null' AND value IS NULL)
    )
);

-- Enable RLS on new tables
ALTER TABLE tenant.record_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.record_list_filters ENABLE ROW LEVEL SECURITY;

-- RLS Policies for record_lists
CREATE POLICY "record_lists_tenant_isolation" ON tenant.record_lists
    FOR ALL USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

-- RLS Policies for record_list_filters
CREATE POLICY "record_list_filters_tenant_isolation" ON tenant.record_list_filters
    FOR ALL USING (
        record_list_id IN (
            SELECT id FROM tenant.record_lists 
            WHERE tenant_id = (auth.jwt()->>'tenant_id')::uuid
        )
    );

-- Create indexes for performance
CREATE INDEX idx_record_lists_tenant_object ON tenant.record_lists(tenant_id, object_id);
CREATE INDEX idx_record_lists_active ON tenant.record_lists(is_active) WHERE is_active = true;
CREATE INDEX idx_record_list_filters_record_list ON tenant.record_list_filters(record_list_id);

-- Add updated_at trigger for record_lists
CREATE TRIGGER set_updated_at_record_lists
    BEFORE UPDATE ON tenant.record_lists
    FOR EACH ROW EXECUTE FUNCTION system.set_updated_at();

-- Grant permissions
GRANT ALL ON tenant.record_lists TO authenticated;
GRANT ALL ON tenant.record_list_filters TO authenticated;

-- Log successful migration
DO $$
BEGIN
    RAISE NOTICE '🚀 Migration 095: Record Lists System created successfully!';
    RAISE NOTICE '✅ Tables: tenant.record_lists, tenant.record_list_filters';
    RAISE NOTICE '✅ RLS policies and indexes created';
    RAISE NOTICE '✅ Ready for custom record list functionality';
END $$;