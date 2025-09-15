-- ================================
-- Migration 002: Helper Functions & Triggers (Production-Ready)
-- Craft App - Tenant & User Onboarding
-- ================================

-- 1. Create a new tenant and return its ID
CREATE OR REPLACE FUNCTION system.create_tenant(_name TEXT, _slug TEXT DEFAULT NULL, _domain TEXT DEFAULT NULL)
RETURNS UUID AS $$
DECLARE
    _tenant_id UUID;
    _generated_slug TEXT;
BEGIN
    -- Generate slug if not provided
    IF _slug IS NULL THEN
        _generated_slug := lower(regexp_replace(_name, '[^a-zA-Z0-9]', '-', 'g'));
    ELSE
        _generated_slug := _slug;
    END IF;
    
    INSERT INTO system.tenants(name, slug, domain) 
    VALUES (_name, _generated_slug, _domain) 
    RETURNING id INTO _tenant_id;
    
    RETURN _tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Create a user for a given tenant (mapping auth.users → system.users)
CREATE OR REPLACE FUNCTION system.create_user_for_tenant(
    _user_id UUID, 
    _email TEXT, 
    _tenant_id UUID, 
    _role TEXT DEFAULT 'user',
    _first_name TEXT DEFAULT NULL,
    _last_name TEXT DEFAULT NULL
)
RETURNS UUID AS $$
BEGIN
    INSERT INTO system.users(id, email, tenant_id, role, first_name, last_name)
    VALUES (_user_id, _email, _tenant_id, _role, _first_name, _last_name)
    ON CONFLICT (id) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        role = EXCLUDED.role,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        updated_at = NOW();
    
    RETURN _user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Trigger: Auto-create system.users row when auth.users is created
CREATE OR REPLACE FUNCTION system.handle_new_auth_user()
RETURNS TRIGGER AS $$
DECLARE
    default_tenant UUID;
BEGIN
    -- Pick default tenant (single-tenant dev mode)
    SELECT id INTO default_tenant FROM system.tenants ORDER BY created_at LIMIT 1;
    
    -- If no tenant exists, create a default one
    IF default_tenant IS NULL THEN
        SELECT system.create_tenant('Default Tenant', 'default-tenant') INTO default_tenant;
    END IF;

    -- Create user mapping
    PERFORM system.create_user_for_tenant(NEW.id, NEW.email, default_tenant);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop and recreate trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION system.handle_new_auth_user();

-- 4. Create default permission set for a tenant
CREATE OR REPLACE FUNCTION tenant.create_default_permission_set(_tenant_id UUID)
RETURNS UUID AS $$
DECLARE
    _permset_id UUID;
BEGIN
    INSERT INTO tenant.permission_sets(tenant_id, name, description, api_name)
    VALUES (_tenant_id, 'System Administrator', 'Full system access with all permissions', 'system_administrator')
    RETURNING id INTO _permset_id;

    RETURN _permset_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Create default objects for a tenant
CREATE OR REPLACE FUNCTION tenant.create_default_objects(_tenant_id UUID)
RETURNS VOID AS $$
DECLARE
    _account_object_id UUID;
    _contact_object_id UUID;
    _lead_object_id UUID;
BEGIN
    -- Create Account object
    INSERT INTO tenant.objects(tenant_id, name, label, description)
    VALUES (_tenant_id, 'accounts', 'Accounts', 'Companies and organizations')
    RETURNING id INTO _account_object_id;

    -- Create Contact object
    INSERT INTO tenant.objects(tenant_id, name, label, description)
    VALUES (_tenant_id, 'contacts', 'Contacts', 'People and contacts')
    RETURNING id INTO _contact_object_id;

    -- Create Lead object
    INSERT INTO tenant.objects(tenant_id, name, label, description)
    VALUES (_tenant_id, 'leads', 'Leads', 'Sales leads and opportunities')
    RETURNING id INTO _lead_object_id;

    -- Add default fields to Account object
    INSERT INTO tenant.fields(tenant_id, object_id, name, label, type, is_required, display_order, section)
    VALUES 
        (_tenant_id, _account_object_id, 'name', 'Account Name', 'text', true, 1, 'General'),
        (_tenant_id, _account_object_id, 'industry', 'Industry', 'text', false, 2, 'General'),
        (_tenant_id, _account_object_id, 'website', 'Website', 'url', false, 3, 'General'),
        (_tenant_id, _account_object_id, 'phone', 'Phone', 'phone', false, 4, 'General'),
        (_tenant_id, _account_object_id, 'billing_address', 'Billing Address', 'text', false, 5, 'Address');

    -- Add default fields to Contact object
    INSERT INTO tenant.fields(tenant_id, object_id, name, label, type, is_required, display_order, section)
    VALUES 
        (_tenant_id, _contact_object_id, 'first_name', 'First Name', 'text', true, 1, 'General'),
        (_tenant_id, _contact_object_id, 'last_name', 'Last Name', 'text', true, 2, 'General'),
        (_tenant_id, _contact_object_id, 'email', 'Email', 'email', false, 3, 'General'),
        (_tenant_id, _contact_object_id, 'phone', 'Phone', 'phone', false, 4, 'General'),
        (_tenant_id, _contact_object_id, 'title', 'Title', 'text', false, 5, 'General'),
        (_tenant_id, _contact_object_id, 'account_id', 'Account', 'reference', false, 6, 'General');

    -- Add default fields to Lead object
    INSERT INTO tenant.fields(tenant_id, object_id, name, label, type, is_required, display_order, section)
    VALUES 
        (_tenant_id, _lead_object_id, 'first_name', 'First Name', 'text', true, 1, 'General'),
        (_tenant_id, _lead_object_id, 'last_name', 'Last Name', 'text', true, 2, 'General'),
        (_tenant_id, _lead_object_id, 'company', 'Company', 'text', false, 3, 'General'),
        (_tenant_id, _lead_object_id, 'email', 'Email', 'email', false, 4, 'General'),
        (_tenant_id, _lead_object_id, 'phone', 'Phone', 'phone', false, 5, 'General'),
        (_tenant_id, _lead_object_id, 'status', 'Status', 'picklist', false, 6, 'General'),
        (_tenant_id, _lead_object_id, 'source', 'Lead Source', 'picklist', false, 7, 'General');

    -- Add picklist values for Lead status
    INSERT INTO tenant.picklist_values(tenant_id, field_id, value, label, display_order)
    SELECT 
        _tenant_id, 
        f.id, 
        v.value, 
        v.label, 
        v.display_order
    FROM tenant.fields f
    CROSS JOIN (VALUES 
        ('New', 'New', 1),
        ('Contacted', 'Contacted', 2),
        ('Qualified', 'Qualified', 3),
        ('Proposal', 'Proposal', 4),
        ('Negotiation', 'Negotiation', 5),
        ('Closed Won', 'Closed Won', 6),
        ('Closed Lost', 'Closed Lost', 7)
    ) AS v(value, label, display_order)
    WHERE f.object_id = _lead_object_id AND f.name = 'status';

    -- Add picklist values for Lead source
    INSERT INTO tenant.picklist_values(tenant_id, field_id, value, label, display_order)
    SELECT 
        _tenant_id, 
        f.id, 
        v.value, 
        v.label, 
        v.display_order
    FROM tenant.fields f
    CROSS JOIN (VALUES 
        ('Website', 'Website', 1),
        ('Phone Inquiry', 'Phone Inquiry', 2),
        ('Email', 'Email', 3),
        ('Referral', 'Referral', 4),
        ('Social Media', 'Social Media', 5),
        ('Trade Show', 'Trade Show', 6),
        ('Other', 'Other', 7)
    ) AS v(value, label, display_order)
    WHERE f.object_id = _lead_object_id AND f.name = 'source';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Create default tabs for a tenant
CREATE OR REPLACE FUNCTION tenant.create_default_tabs(_tenant_id UUID)
RETURNS VOID AS $$
BEGIN
    INSERT INTO tenant.tabs(tenant_id, name, description, api_name, is_visible, display_order)
    VALUES 
        (_tenant_id, 'Accounts', 'Manage companies and organizations', 'accounts', true, 1),
        (_tenant_id, 'Contacts', 'Manage people and contacts', 'contacts', true, 2),
        (_tenant_id, 'Leads', 'Manage sales leads', 'leads', true, 3),
        (_tenant_id, 'Settings', 'System configuration', 'settings', true, 4);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Setup complete new tenant with all defaults
CREATE OR REPLACE FUNCTION system.setup_new_tenant(_name TEXT, _slug TEXT DEFAULT NULL, _domain TEXT DEFAULT NULL)
RETURNS UUID AS $$
DECLARE
    _tenant_id UUID;
    _permset_id UUID;
BEGIN
    -- Create tenant
    SELECT system.create_tenant(_name, _slug, _domain) INTO _tenant_id;
    
    -- Create default permission set
    SELECT tenant.create_default_permission_set(_tenant_id) INTO _permset_id;
    
    -- Create default objects and fields
    PERFORM tenant.create_default_objects(_tenant_id);
    
    -- Create default tabs
    PERFORM tenant.create_default_tabs(_tenant_id);
    
    RETURN _tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Utility function to get user's tenant_id
CREATE OR REPLACE FUNCTION system.get_user_tenant_id(_user_id UUID)
RETURNS UUID AS $$
DECLARE
    _tenant_id UUID;
BEGIN
    SELECT tenant_id INTO _tenant_id
    FROM system.users
    WHERE id = _user_id;
    
    RETURN _tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. Check object permission for current user
CREATE OR REPLACE FUNCTION tenant.check_object_permission(
    _object_id UUID,
    _permission TEXT -- 'create', 'read', 'update', 'delete'
)
RETURNS BOOLEAN AS $$
DECLARE
    _user_id UUID;
    _tenant_id UUID;
    _has_permission BOOLEAN;
BEGIN
    _user_id := auth.uid();
    
    -- Get user's tenant_id
    SELECT tenant_id INTO _tenant_id
    FROM system.users
    WHERE id = _user_id;
    
    IF _tenant_id IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Check if user has permission through any assigned permission set
    SELECT EXISTS (
        SELECT 1
        FROM tenant.user_permission_sets ups
        JOIN tenant.permission_set_objects pso ON ups.perm_set_id = pso.perm_set_id
        WHERE ups.user_id = _user_id
        AND pso.object_id = _object_id
        AND CASE _permission
            WHEN 'create' THEN pso.can_create
            WHEN 'read' THEN pso.can_read
            WHEN 'update' THEN pso.can_update
            WHEN 'delete' THEN pso.can_delete
            ELSE FALSE
        END
    ) INTO _has_permission;
    
    RETURN COALESCE(_has_permission, FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 10. Check field permission for current user
CREATE OR REPLACE FUNCTION tenant.check_field_permission(
    _field_id UUID,
    _permission TEXT -- 'read', 'edit'
)
RETURNS BOOLEAN AS $$
DECLARE
    _user_id UUID;
    _tenant_id UUID;
    _has_permission BOOLEAN;
BEGIN
    _user_id := auth.uid();
    
    -- Get user's tenant_id
    SELECT tenant_id INTO _tenant_id
    FROM system.users
    WHERE id = _user_id;
    
    IF _tenant_id IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Check if user has permission through any assigned permission set
    SELECT EXISTS (
        SELECT 1
        FROM tenant.user_permission_sets ups
        JOIN tenant.permission_set_fields psf ON ups.perm_set_id = psf.perm_set_id
        WHERE ups.user_id = _user_id
        AND psf.field_id = _field_id
        AND CASE _permission
            WHEN 'read' THEN psf.can_read
            WHEN 'edit' THEN psf.can_edit
            ELSE FALSE
        END
    ) INTO _has_permission;
    
    RETURN COALESCE(_has_permission, FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 11. Execute SQL with proper error handling
CREATE OR REPLACE FUNCTION system.execute_sql(sql_query TEXT)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
BEGIN
    BEGIN
        EXECUTE sql_query;
        result := jsonb_build_object('success', true, 'message', 'SQL executed successfully');
    EXCEPTION WHEN OTHERS THEN
        result := jsonb_build_object(
            'success', false, 
            'error', SQLERRM,
            'sql_state', SQLSTATE
        );
    END;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 12. Get database objects (tables, views, etc.)
CREATE OR REPLACE FUNCTION system.get_database_objects()
RETURNS TABLE (
    object_name TEXT,
    object_type TEXT,
    schema_name TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        t.table_name::TEXT,
        'table'::TEXT,
        t.table_schema::TEXT
    FROM information_schema.tables t
    WHERE t.table_schema IN ('public', 'system', 'tenant')
    AND t.table_type = 'BASE TABLE'
    ORDER BY t.table_schema, t.table_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 13. Get table columns
CREATE OR REPLACE FUNCTION system.get_table_columns(table_name_param TEXT)
RETURNS TABLE (
    column_name TEXT,
    data_type TEXT,
    is_nullable TEXT,
    column_default TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        c.column_name::TEXT,
        c.data_type::TEXT,
        c.is_nullable::TEXT,
        c.column_default::TEXT
    FROM information_schema.columns c
    WHERE c.table_name = table_name_param
    AND c.table_schema IN ('public', 'system', 'tenant')
    ORDER BY c.ordinal_position;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 14. Generic trigger function for updated_at (needed by Migration 003)
CREATE OR REPLACE FUNCTION system.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    NEW.updated_by = auth.uid();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- 15. ENHANCE RLS POLICIES (Production-Ready)
-- ===========================================

-- Drop existing policies and recreate with separate policies
DROP POLICY IF EXISTS "Users per tenant" ON system.users;

-- Separate RLS policies for system.users
CREATE POLICY "select_users_per_tenant" ON system.users
    FOR SELECT USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

CREATE POLICY "insert_users_per_tenant" ON system.users
    FOR INSERT WITH CHECK (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

CREATE POLICY "update_users_per_tenant" ON system.users
    FOR UPDATE USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid)
    WITH CHECK (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

CREATE POLICY "delete_users_per_tenant" ON system.users
    FOR DELETE USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

-- ===========================================
-- 16. ADD PERFORMANCE INDEXES
-- ===========================================

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_system_users_tenant_id ON system.users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_system_users_email ON system.users(email);
CREATE INDEX IF NOT EXISTS idx_system_tenants_slug ON system.tenants(slug);
CREATE INDEX IF NOT EXISTS idx_system_tenants_domain ON system.tenants(domain);

-- ===========================================
-- 17. GRANTS FOR FUNCTIONS
-- ===========================================

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION system.create_tenant(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION system.create_user_for_tenant(UUID, TEXT, UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION system.handle_new_auth_user() TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.create_default_permission_set(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.create_default_objects(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.create_default_tabs(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION system.setup_new_tenant(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION system.get_user_tenant_id(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.check_object_permission(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.check_field_permission(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION system.execute_sql(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION system.get_database_objects() TO authenticated;
GRANT EXECUTE ON FUNCTION system.get_table_columns(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION system.set_updated_at() TO authenticated;

-- ===========================================
-- 18. COMMENTS FOR DOCUMENTATION
-- ===========================================

COMMENT ON FUNCTION system.create_tenant(TEXT, TEXT, TEXT) IS 'Creates a new tenant with optional slug and domain';
COMMENT ON FUNCTION system.create_user_for_tenant(UUID, TEXT, UUID, TEXT, TEXT, TEXT) IS 'Creates or updates a user for a specific tenant';
COMMENT ON FUNCTION system.handle_new_auth_user() IS 'Trigger function to auto-create system.users when auth.users is created';
COMMENT ON FUNCTION tenant.create_default_permission_set(UUID) IS 'Creates default permission set for a tenant';
COMMENT ON FUNCTION tenant.create_default_objects(UUID) IS 'Creates default objects (accounts, contacts, leads) with fields';
COMMENT ON FUNCTION tenant.create_default_tabs(UUID) IS 'Creates default navigation tabs';
COMMENT ON FUNCTION system.setup_new_tenant(TEXT, TEXT, TEXT) IS 'Complete tenant setup with all defaults';
COMMENT ON FUNCTION system.get_user_tenant_id(UUID) IS 'Gets tenant_id for a specific user';
COMMENT ON FUNCTION tenant.check_object_permission(UUID, TEXT) IS 'Checks if current user has permission on object';
COMMENT ON FUNCTION tenant.check_field_permission(UUID, TEXT) IS 'Checks if current user has permission on field';
COMMENT ON FUNCTION system.execute_sql(TEXT) IS 'Executes SQL with error handling';
COMMENT ON FUNCTION system.get_database_objects() IS 'Gets list of database objects';
COMMENT ON FUNCTION system.get_table_columns(TEXT) IS 'Gets columns for a specific table';
COMMENT ON FUNCTION system.set_updated_at() IS 'Trigger function to set updated_at and updated_by';

