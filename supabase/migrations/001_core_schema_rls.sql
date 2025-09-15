-- ================================
-- Migration 001: Core Schema & RLS
-- Craft App - Multi-Tenant Architecture
-- ================================

-- 1. Create Schemas for Organization
CREATE SCHEMA IF NOT EXISTS system;
CREATE SCHEMA IF NOT EXISTS tenant;

-- ===========================================
-- 2. SYSTEM-LEVEL TABLES (Global)
-- ===========================================

-- Tenants
CREATE TABLE IF NOT EXISTS system.tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug VARCHAR(100) UNIQUE,
    domain VARCHAR(255),
    settings JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Users mapping Supabase auth.users to tenant
CREATE TABLE IF NOT EXISTS system.users (
    id UUID PRIMARY KEY, -- same as auth.users.id
    tenant_id UUID REFERENCES system.tenants(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    role TEXT DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    department VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS for users
ALTER TABLE system.users ENABLE ROW LEVEL SECURITY;

-- RLS policy for multi-tenant isolation (JWT-based)
CREATE POLICY "Users per tenant"
ON system.users
FOR ALL
USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid)
WITH CHECK (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

-- ===========================================
-- 3. TENANT-LEVEL TABLES
-- ===========================================

-- Permission Sets
CREATE TABLE IF NOT EXISTS tenant.permission_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES system.tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    api_name VARCHAR(255),
    license_type VARCHAR(50) DEFAULT 'standard',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Objects (like Salesforce Object Manager)
CREATE TABLE IF NOT EXISTS tenant.objects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES system.tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    label TEXT,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Fields (per object)
CREATE TABLE IF NOT EXISTS tenant.fields (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES system.tenants(id) ON DELETE CASCADE,
    object_id UUID REFERENCES tenant.objects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    label TEXT NOT NULL,
    type TEXT NOT NULL,
    is_required BOOLEAN DEFAULT false,
    is_nullable BOOLEAN DEFAULT true,
    default_value TEXT,
    validation_rules JSONB DEFAULT '[]',
    display_order INTEGER DEFAULT 0,
    section VARCHAR(100) DEFAULT 'details',
    width VARCHAR(20) DEFAULT 'half' CHECK (width IN ('half', 'full')),
    is_visible BOOLEAN DEFAULT true,
    is_system_field BOOLEAN DEFAULT false,
    reference_table VARCHAR(255),
    reference_display_field VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Permission Set ↔ Object Mapping
CREATE TABLE IF NOT EXISTS tenant.permission_set_objects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    perm_set_id UUID REFERENCES tenant.permission_sets(id) ON DELETE CASCADE,
    object_id UUID REFERENCES tenant.objects(id) ON DELETE CASCADE,
    can_create BOOLEAN DEFAULT false,
    can_read BOOLEAN DEFAULT false,
    can_update BOOLEAN DEFAULT false,
    can_delete BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(perm_set_id, object_id)
);

-- Permission Set ↔ Field Mapping
CREATE TABLE IF NOT EXISTS tenant.permission_set_fields (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    perm_set_id UUID REFERENCES tenant.permission_sets(id) ON DELETE CASCADE,
    field_id UUID REFERENCES tenant.fields(id) ON DELETE CASCADE,
    can_read BOOLEAN DEFAULT false,
    can_edit BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(perm_set_id, field_id)
);

-- User ↔ Permission Set Mapping
CREATE TABLE IF NOT EXISTS tenant.user_permission_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES system.users(id) ON DELETE CASCADE,
    perm_set_id UUID REFERENCES tenant.permission_sets(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ DEFAULT now(),
    assigned_by UUID REFERENCES system.users(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Tabs (Navigation Management)
CREATE TABLE IF NOT EXISTS tenant.tabs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES system.tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    api_name VARCHAR(255),
    is_visible BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Apps (Application Management)
CREATE TABLE IF NOT EXISTS tenant.apps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES system.tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- App Tabs (App-Tab Relationships)
CREATE TABLE IF NOT EXISTS tenant.app_tabs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID REFERENCES tenant.apps(id) ON DELETE CASCADE,
    tab_id UUID REFERENCES tenant.tabs(id) ON DELETE CASCADE,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(app_id, tab_id)
);

-- Layout Blocks (Dynamic Page Layouts)
CREATE TABLE IF NOT EXISTS tenant.layout_blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES system.tenants(id) ON DELETE CASCADE,
    object_id UUID REFERENCES tenant.objects(id) ON DELETE CASCADE,
    block_type VARCHAR(50) NOT NULL CHECK (block_type IN ('field', 'related_list')),
    field_id UUID REFERENCES tenant.fields(id) ON DELETE CASCADE,
    related_list_id UUID, -- Will reference related_list_metadata(id)
    label TEXT NOT NULL,
    section VARCHAR(100) DEFAULT 'details',
    display_order INTEGER DEFAULT 0,
    width VARCHAR(20) DEFAULT 'half' CHECK (width IN ('half', 'full')),
    is_visible BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    -- Ensure either field_id or related_list_id is set, but not both
    CONSTRAINT layout_blocks_content_check CHECK (
        (block_type = 'field' AND field_id IS NOT NULL AND related_list_id IS NULL) OR
        (block_type = 'related_list' AND related_list_id IS NOT NULL AND field_id IS NULL)
    )
);

-- Related List Metadata
CREATE TABLE IF NOT EXISTS tenant.related_list_metadata (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES system.tenants(id) ON DELETE CASCADE,
    parent_object_id UUID REFERENCES tenant.objects(id) ON DELETE CASCADE,
    child_object_id UUID REFERENCES tenant.objects(id) ON DELETE CASCADE,
    foreign_key_field TEXT NOT NULL,
    label TEXT NOT NULL,
    display_columns JSONB DEFAULT '[]',
    section VARCHAR(100) DEFAULT 'related',
    display_order INTEGER DEFAULT 0,
    is_visible BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Add foreign key constraint to layout_blocks
ALTER TABLE tenant.layout_blocks ADD CONSTRAINT fk_layout_blocks_related_list
    FOREIGN KEY (related_list_id) REFERENCES tenant.related_list_metadata(id) ON DELETE CASCADE;

-- Picklist Values (Dropdown Options)
CREATE TABLE IF NOT EXISTS tenant.picklist_values (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES system.tenants(id) ON DELETE CASCADE,
    field_id UUID REFERENCES tenant.fields(id) ON DELETE CASCADE,
    value VARCHAR(255) NOT NULL,
    label VARCHAR(255) NOT NULL,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS for all tenant tables
ALTER TABLE tenant.permission_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.permission_set_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.permission_set_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.user_permission_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.tabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.app_tabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.layout_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.related_list_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.picklist_values ENABLE ROW LEVEL SECURITY;

-- Tenant Isolation Policies (JWT-based)
CREATE POLICY "Tenant Isolation" ON tenant.permission_sets
FOR ALL USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid)
WITH CHECK (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

CREATE POLICY "Tenant Isolation" ON tenant.objects
FOR ALL USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid)
WITH CHECK (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

CREATE POLICY "Tenant Isolation" ON tenant.fields
FOR ALL USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid)
WITH CHECK (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

CREATE POLICY "Tenant Isolation" ON tenant.permission_set_objects
FOR ALL USING (
    perm_set_id IN (
        SELECT id FROM tenant.permission_sets
        WHERE tenant_id = (auth.jwt()->>'tenant_id')::uuid
    )
);

CREATE POLICY "Tenant Isolation" ON tenant.permission_set_fields
FOR ALL USING (
    perm_set_id IN (
        SELECT id FROM tenant.permission_sets
        WHERE tenant_id = (auth.jwt()->>'tenant_id')::uuid
    )
);

CREATE POLICY "Tenant Isolation" ON tenant.user_permission_sets
FOR ALL USING (
    user_id IN (
        SELECT id FROM system.users
        WHERE tenant_id = (auth.jwt()->>'tenant_id')::uuid
    )
);

CREATE POLICY "Tenant Isolation" ON tenant.tabs
FOR ALL USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid)
WITH CHECK (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

CREATE POLICY "Tenant Isolation" ON tenant.apps
FOR ALL USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid)
WITH CHECK (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

CREATE POLICY "Tenant Isolation" ON tenant.app_tabs
FOR ALL USING (
    app_id IN (
        SELECT id FROM tenant.apps
        WHERE tenant_id = (auth.jwt()->>'tenant_id')::uuid
    )
);

CREATE POLICY "Tenant Isolation" ON tenant.layout_blocks
FOR ALL USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid)
WITH CHECK (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

CREATE POLICY "Tenant Isolation" ON tenant.related_list_metadata
FOR ALL USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid)
WITH CHECK (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

CREATE POLICY "Tenant Isolation" ON tenant.picklist_values
FOR ALL USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid)
WITH CHECK (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

-- Indexes for RLS performance
CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON system.users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_permsets_tenant_id ON tenant.permission_sets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_objects_tenant_id ON tenant.objects(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fields_tenant_id ON tenant.fields(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tabs_tenant_id ON tenant.tabs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_apps_tenant_id ON tenant.apps(tenant_id);
CREATE INDEX IF NOT EXISTS idx_layout_blocks_tenant_id ON tenant.layout_blocks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_layout_blocks_object_id ON tenant.layout_blocks(object_id);
CREATE INDEX IF NOT EXISTS idx_layout_blocks_section_order ON tenant.layout_blocks(object_id, section, display_order);
CREATE INDEX IF NOT EXISTS idx_fields_object_id ON tenant.fields(object_id);
CREATE INDEX IF NOT EXISTS idx_fields_tenant_id ON tenant.fields(tenant_id);

-- Utility Functions
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add updated_at triggers to all tables
CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON system.tenants FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON system.users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_permission_sets_updated_at BEFORE UPDATE ON tenant.permission_sets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_objects_updated_at BEFORE UPDATE ON tenant.objects FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_fields_updated_at BEFORE UPDATE ON tenant.fields FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_permission_set_objects_updated_at BEFORE UPDATE ON tenant.permission_set_objects FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_permission_set_fields_updated_at BEFORE UPDATE ON tenant.permission_set_fields FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_tabs_updated_at BEFORE UPDATE ON tenant.tabs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_apps_updated_at BEFORE UPDATE ON tenant.apps FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_layout_blocks_updated_at BEFORE UPDATE ON tenant.layout_blocks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_related_list_metadata_updated_at BEFORE UPDATE ON tenant.related_list_metadata FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_picklist_values_updated_at BEFORE UPDATE ON tenant.picklist_values FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Sample data for testing
INSERT INTO system.tenants (name, slug, domain) VALUES 
('Craft App Demo', 'craft-app-demo', 'demo.craftapp.com')
ON CONFLICT (slug) DO NOTHING;

-- Migration complete
SELECT 'Migration 001 completed successfully!' as status; 