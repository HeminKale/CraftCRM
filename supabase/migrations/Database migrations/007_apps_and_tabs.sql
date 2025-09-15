-- Drop existing tables if they exist (for clean migration)
DROP TABLE IF EXISTS tenant.tabs CASCADE;
DROP TABLE IF EXISTS tenant.apps CASCADE;

-- Create apps table in tenant schema
CREATE TABLE tenant.apps (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES system.tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create tabs table in tenant schema
CREATE TABLE tenant.tabs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES system.tenants(id) ON DELETE CASCADE,
  app_id UUID NOT NULL REFERENCES tenant.apps(id) ON DELETE CASCADE,
  label VARCHAR(255) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on apps table
ALTER TABLE tenant.apps ENABLE ROW LEVEL SECURITY;

-- Enable RLS on tabs table
ALTER TABLE tenant.tabs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view apps from their tenant" ON tenant.apps;
DROP POLICY IF EXISTS "Users can insert apps in their tenant" ON tenant.apps;
DROP POLICY IF EXISTS "Users can update apps in their tenant" ON tenant.apps;
DROP POLICY IF EXISTS "Users can delete apps in their tenant" ON tenant.apps;

DROP POLICY IF EXISTS "Users can view tabs from their tenant" ON tenant.tabs;
DROP POLICY IF EXISTS "Users can insert tabs in their tenant" ON tenant.tabs;
DROP POLICY IF EXISTS "Users can update tabs in their tenant" ON tenant.tabs;
DROP POLICY IF EXISTS "Users can delete tabs in their tenant" ON tenant.tabs;

-- Create RLS policies for apps table
CREATE POLICY "Users can view apps from their tenant" ON tenant.apps
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM system.users WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can insert apps in their tenant" ON tenant.apps
  FOR INSERT WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM system.users WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can update apps in their tenant" ON tenant.apps
  FOR UPDATE USING (
    tenant_id IN (
      SELECT tenant_id FROM system.users WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can delete apps in their tenant" ON tenant.apps
  FOR DELETE USING (
    tenant_id IN (
      SELECT tenant_id FROM system.users WHERE id = auth.uid()
    )
  );

-- Create RLS policies for tabs table
CREATE POLICY "Users can view tabs from their tenant" ON tenant.tabs
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM system.users WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can insert tabs in their tenant" ON tenant.tabs
  FOR INSERT WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM system.users WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can update tabs in their tenant" ON tenant.tabs
  FOR UPDATE USING (
    tenant_id IN (
      SELECT tenant_id FROM system.users WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can delete tabs in their tenant" ON tenant.tabs
  FOR DELETE USING (
    tenant_id IN (
      SELECT tenant_id FROM system.users WHERE id = auth.uid()
    )
  );

-- Drop existing indexes if they exist
DROP INDEX IF EXISTS idx_apps_tenant_id;
DROP INDEX IF EXISTS idx_apps_is_active;
DROP INDEX IF EXISTS idx_tabs_tenant_id;
DROP INDEX IF EXISTS idx_tabs_app_id;
DROP INDEX IF EXISTS idx_tabs_is_active;
DROP INDEX IF EXISTS idx_tabs_order_index;

-- Create indexes for better performance
CREATE INDEX idx_apps_tenant_id ON tenant.apps(tenant_id);
CREATE INDEX idx_apps_is_active ON tenant.apps(is_active);
CREATE INDEX idx_tabs_tenant_id ON tenant.tabs(tenant_id);
CREATE INDEX idx_tabs_app_id ON tenant.tabs(app_id);
CREATE INDEX idx_tabs_is_active ON tenant.tabs(is_active);
CREATE INDEX idx_tabs_order_index ON tenant.tabs(order_index); 