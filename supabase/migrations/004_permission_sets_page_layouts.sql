-- ================================
-- Migration 004: Permission Sets & Page Layouts (Production-Ready)
-- Craft App - Security & UI Management Layer
-- ================================

-- ===========================================
-- 1. PERMISSION SET MANAGEMENT
-- ===========================================

-- Function to create permission sets with __a suffix for custom ones
CREATE OR REPLACE FUNCTION tenant.create_permission_set(
    _name TEXT,
    _description TEXT DEFAULT NULL,
    _is_custom BOOLEAN DEFAULT true
)
RETURNS UUID AS $$
DECLARE
    _tenant_id UUID;
    _perm_set_id UUID;
    _final_name TEXT;
BEGIN
    -- Lookup tenant_id for current user
    SELECT tenant_id INTO _tenant_id
    FROM system.users
    WHERE id = auth.uid();

    IF _tenant_id IS NULL THEN
        RAISE EXCEPTION 'Tenant not found for current user';
    END IF;

    -- Determine final name (append __a for custom)
    IF _is_custom THEN
        _final_name := _name || '__a';
    ELSE
        _final_name := _name;
    END IF;

    -- Prevent duplicates
    IF EXISTS (
        SELECT 1 FROM tenant.permission_sets
        WHERE tenant_id = _tenant_id AND name = _final_name
    ) THEN
        RAISE EXCEPTION 'Permission set "%" already exists', _name;
    END IF;

    -- Insert permission set
    INSERT INTO tenant.permission_sets(tenant_id, name, description)
    VALUES (_tenant_id, _final_name, _description)
    RETURNING id INTO _perm_set_id;

    RETURN _perm_set_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to assign permission set to user
CREATE OR REPLACE FUNCTION tenant.assign_permission_set_to_user(
    _user_id UUID,
    _perm_set_id UUID
)
RETURNS VOID AS $$
DECLARE
    _tenant_id UUID;
BEGIN
    -- Lookup current user's tenant
    SELECT tenant_id INTO _tenant_id
    FROM system.users
    WHERE id = auth.uid();

    IF _tenant_id IS NULL THEN
        RAISE EXCEPTION 'Tenant not found for current user';
    END IF;

    -- Validate permission set ownership
    IF NOT EXISTS (
        SELECT 1 FROM tenant.permission_sets
        WHERE id = _perm_set_id AND tenant_id = _tenant_id
    ) THEN
        RAISE EXCEPTION 'Permission set does not belong to your tenant';
    END IF;

    -- Validate target user ownership
    IF NOT EXISTS (
        SELECT 1 FROM system.users
        WHERE id = _user_id AND tenant_id = _tenant_id
    ) THEN
        RAISE EXCEPTION 'User does not belong to your tenant';
    END IF;

    -- Assign permission set (avoid duplicates)
    INSERT INTO tenant.user_permission_sets(user_id, perm_set_id)
    VALUES (_user_id, _perm_set_id)
    ON CONFLICT (user_id, perm_set_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to remove permission set from user
CREATE OR REPLACE FUNCTION tenant.remove_permission_set_from_user(
    _user_id UUID,
    _perm_set_id UUID
)
RETURNS VOID AS $$
DECLARE
    _tenant_id UUID;
BEGIN
    -- Lookup current user's tenant
    SELECT tenant_id INTO _tenant_id
    FROM system.users
    WHERE id = auth.uid();

    IF _tenant_id IS NULL THEN
        RAISE EXCEPTION 'Tenant not found for current user';
    END IF;

    -- Validate permission set ownership
    IF NOT EXISTS (
        SELECT 1 FROM tenant.permission_sets
        WHERE id = _perm_set_id AND tenant_id = _tenant_id
    ) THEN
        RAISE EXCEPTION 'Permission set does not belong to your tenant';
    END IF;

    -- Validate target user ownership
    IF NOT EXISTS (
        SELECT 1 FROM system.users
        WHERE id = _user_id AND tenant_id = _tenant_id
    ) THEN
        RAISE EXCEPTION 'User does not belong to your tenant';
    END IF;

    -- Remove permission set assignment
    DELETE FROM tenant.user_permission_sets
    WHERE user_id = _user_id AND perm_set_id = _perm_set_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===========================================
-- 2. PAGE LAYOUT MANAGEMENT
-- ===========================================

-- Create page layouts table
CREATE TABLE IF NOT EXISTS tenant.page_layouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES system.tenants(id) ON DELETE CASCADE,
    object_id UUID REFERENCES tenant.objects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    layout JSONB NOT NULL,        -- sections & fields as JSON
    is_custom BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES system.users(id),
    updated_by UUID REFERENCES system.users(id)
);

-- Enable RLS & tenant isolation
ALTER TABLE tenant.page_layouts ENABLE ROW LEVEL SECURITY;

-- Separate RLS policies for page layouts
CREATE POLICY "select_page_layouts_per_tenant" ON tenant.page_layouts
    FOR SELECT USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

CREATE POLICY "insert_page_layouts_per_tenant" ON tenant.page_layouts
    FOR INSERT WITH CHECK (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

CREATE POLICY "update_page_layouts_per_tenant" ON tenant.page_layouts
    FOR UPDATE USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid)
    WITH CHECK (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

CREATE POLICY "delete_page_layouts_per_tenant" ON tenant.page_layouts
    FOR DELETE USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

-- Create page layout function
CREATE OR REPLACE FUNCTION tenant.create_page_layout(
    _object_id UUID,
    _name TEXT,
    _layout JSONB,
    _is_custom BOOLEAN DEFAULT true
)
RETURNS UUID AS $$
DECLARE
    _tenant_id UUID;
    _layout_id UUID;
    _final_name TEXT;
BEGIN
    -- Lookup tenant
    SELECT tenant_id INTO _tenant_id
    FROM system.users
    WHERE id = auth.uid();

    IF _tenant_id IS NULL THEN
        RAISE EXCEPTION 'Tenant not found for current user';
    END IF;

    -- Check object ownership
    IF NOT EXISTS (
        SELECT 1 FROM tenant.objects
        WHERE id = _object_id AND tenant_id = _tenant_id
    ) THEN
        RAISE EXCEPTION 'Object not found or not owned by tenant';
    END IF;

    -- Append __a for custom layouts
    IF _is_custom THEN
        _final_name := _name || '__a';
    ELSE
        _final_name := _name;
    END IF;

    -- Check for duplicate layout names
    IF EXISTS (
        SELECT 1 FROM tenant.page_layouts
        WHERE tenant_id = _tenant_id AND object_id = _object_id AND name = _final_name
    ) THEN
        RAISE EXCEPTION 'Page layout "%" already exists for this object', _name;
    END IF;

    -- Insert layout
    INSERT INTO tenant.page_layouts(tenant_id, object_id, name, layout, is_custom, created_by)
    VALUES (_tenant_id, _object_id, _final_name, _layout, _is_custom, auth.uid())
    RETURNING id INTO _layout_id;

    RETURN _layout_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update page layout
CREATE OR REPLACE FUNCTION tenant.update_page_layout(
    _layout_id UUID,
    _name TEXT,
    _layout JSONB
)
RETURNS VOID AS $$
DECLARE
    _tenant_id UUID;
BEGIN
    -- Lookup tenant
    SELECT tenant_id INTO _tenant_id
    FROM system.users
    WHERE id = auth.uid();

    IF _tenant_id IS NULL THEN
        RAISE EXCEPTION 'Tenant not found for current user';
    END IF;

    -- Update layout
    UPDATE tenant.page_layouts
    SET 
        name = _name,
        layout = _layout,
        updated_at = now(),
        updated_by = auth.uid()
    WHERE id = _layout_id AND tenant_id = _tenant_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Page layout not found or not owned by tenant';
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get page layouts for an object
CREATE OR REPLACE FUNCTION tenant.get_object_page_layouts(_object_id UUID)
RETURNS TABLE (
    id UUID,
    name TEXT,
    layout JSONB,
    is_custom BOOLEAN,
    is_active BOOLEAN,
    created_at TIMESTAMPTZ
) AS $$
DECLARE
    _tenant_id UUID;
BEGIN
    -- Get current user's tenant_id
    SELECT tenant_id INTO _tenant_id
    FROM system.users
    WHERE id = auth.uid();
    
    RETURN QUERY
    SELECT pl.id, pl.name, pl.layout, pl.is_custom, pl.is_active, pl.created_at
    FROM tenant.page_layouts pl
    JOIN tenant.objects o ON pl.object_id = o.id
    WHERE o.id = _object_id AND o.tenant_id = _tenant_id
    ORDER BY pl.created_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===========================================
-- 3. UTILITY FUNCTIONS
-- ===========================================

-- Function to get user's permission sets
CREATE OR REPLACE FUNCTION tenant.get_user_permission_sets(_user_id UUID)
RETURNS TABLE (
    perm_set_id UUID,
    perm_set_name TEXT,
    perm_set_description TEXT,
    assigned_at TIMESTAMPTZ
) AS $$
DECLARE
    _tenant_id UUID;
BEGIN
    -- Get current user's tenant_id
    SELECT tenant_id INTO _tenant_id
    FROM system.users
    WHERE id = auth.uid();
    
    RETURN QUERY
    SELECT ps.id, ps.name, ps.description, ups.created_at
    FROM tenant.user_permission_sets ups
    JOIN tenant.permission_sets ps ON ups.perm_set_id = ps.id
    WHERE ups.user_id = _user_id AND ps.tenant_id = _tenant_id
    ORDER BY ups.created_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get all permission sets for current tenant
CREATE OR REPLACE FUNCTION tenant.get_permission_sets()
RETURNS TABLE (
    id UUID,
    name TEXT,
    description TEXT,
    created_at TIMESTAMPTZ
) AS $$
DECLARE
    _tenant_id UUID;
BEGIN
    -- Get current user's tenant_id
    SELECT tenant_id INTO _tenant_id
    FROM system.users
    WHERE id = auth.uid();
    
    RETURN QUERY
    SELECT ps.id, ps.name, ps.description, ps.created_at
    FROM tenant.permission_sets ps
    WHERE ps.tenant_id = _tenant_id
    ORDER BY ps.created_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if user has specific permission
CREATE OR REPLACE FUNCTION tenant.user_has_permission(
    _user_id UUID,
    _permission_name TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
    _tenant_id UUID;
    _has_permission BOOLEAN;
BEGIN
    -- Get current user's tenant_id
    SELECT tenant_id INTO _tenant_id
    FROM system.users
    WHERE id = auth.uid();
    
    IF _tenant_id IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Check if user has the permission through any assigned permission set
    SELECT EXISTS (
        SELECT 1
        FROM tenant.user_permission_sets ups
        JOIN tenant.permission_sets ps ON ups.perm_set_id = ps.id
        WHERE ups.user_id = _user_id 
        AND ps.tenant_id = _tenant_id
        AND ps.name = _permission_name
    ) INTO _has_permission;
    
    RETURN COALESCE(_has_permission, FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===========================================
-- 4. ADD CONSTRAINTS AND INDEXES
-- ===========================================

-- Add unique constraint to prevent duplicate permission set names per tenant
ALTER TABLE tenant.permission_sets 
ADD CONSTRAINT uniq_permission_set_name_per_tenant UNIQUE(tenant_id, name);

-- Add unique constraint to prevent duplicate page layout names per object
ALTER TABLE tenant.page_layouts 
ADD CONSTRAINT uniq_page_layout_name_per_object UNIQUE(tenant_id, object_id, name);

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_tenant_page_layouts_tenant_id ON tenant.page_layouts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_page_layouts_object_id ON tenant.page_layouts(object_id);
CREATE INDEX IF NOT EXISTS idx_tenant_permission_sets_tenant_id ON tenant.permission_sets(tenant_id);

-- ===========================================
-- 5. GRANTS FOR FUNCTIONS
-- ===========================================

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION tenant.create_permission_set(TEXT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.assign_permission_set_to_user(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.remove_permission_set_from_user(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.create_page_layout(UUID, TEXT, JSONB, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.update_page_layout(UUID, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.get_object_page_layouts(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.get_user_permission_sets(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.get_permission_sets() TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.user_has_permission(UUID, TEXT) TO authenticated;

-- ===========================================
-- 6. COMMENTS FOR DOCUMENTATION
-- ===========================================

COMMENT ON FUNCTION tenant.create_permission_set(TEXT, TEXT, BOOLEAN) IS 'Create tenant-specific permission set (__a for custom)';
COMMENT ON FUNCTION tenant.assign_permission_set_to_user(UUID, UUID) IS 'Assign a permission set to a user in the same tenant';
COMMENT ON FUNCTION tenant.remove_permission_set_from_user(UUID, UUID) IS 'Remove a permission set from a user in the same tenant';
COMMENT ON FUNCTION tenant.create_page_layout(UUID, TEXT, JSONB, BOOLEAN) IS 'Create a page layout (JSON) for a tenant object';
COMMENT ON FUNCTION tenant.update_page_layout(UUID, TEXT, JSONB) IS 'Update an existing page layout';
COMMENT ON FUNCTION tenant.get_object_page_layouts(UUID) IS 'Get all page layouts for a specific object';
COMMENT ON FUNCTION tenant.get_user_permission_sets(UUID) IS 'Get all permission sets assigned to a user';
COMMENT ON FUNCTION tenant.get_permission_sets() IS 'Get all permission sets for current tenant';
COMMENT ON FUNCTION tenant.user_has_permission(UUID, TEXT) IS 'Check if user has a specific permission';

-- ===========================================
-- 7. VERIFICATION QUERIES
-- ===========================================

-- Test permission set creation (run from UI)
-- SELECT tenant.create_permission_set('Sales Manager', 'Can manage sales objects');

-- Test page layout creation (run from UI)
-- SELECT tenant.create_page_layout(object_id, 'Standard Layout', '{"sections": [{"name": "General", "fields": ["name", "email"]}]}'::jsonb);

-- ===========================================
-- MIGRATION COMPLETE - PRODUCTION READY
-- ===========================================

-- Next steps:
-- 1. Test permission set creation and assignment
-- 2. Test page layout creation and retrieval
-- 3. Integrate with UI components
-- 4. Verify RLS policies are working correctly 