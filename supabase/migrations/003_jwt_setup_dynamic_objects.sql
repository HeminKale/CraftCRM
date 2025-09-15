-- ================================
-- Migration 003: JWT Setup & Dynamic Objects (Production-Ready)
-- Craft App - JWT Claims & UI-Driven Object Creation
-- ================================

-- ===========================================
-- 1. JWT CLAIMS FUNCTION (Critical for RLS)
-- ===========================================

-- Function to add tenant_id to JWT claims (for Auth Hook)
CREATE OR REPLACE FUNCTION system.jwt_claims(event jsonb)
RETURNS jsonb AS $$
DECLARE
    _tenant_id uuid;
BEGIN
    -- Look up tenant_id from system.users based on the auth user id
    SELECT tenant_id INTO _tenant_id
    FROM system.users
    WHERE id = (event->'user'->>'id')::uuid;

    -- If tenant_id exists, add it to app_metadata
    IF _tenant_id IS NOT NULL THEN
        RETURN jsonb_set(
            event,
            '{app_metadata,tenant_id}',
            to_jsonb(_tenant_id::text),
            true
        );
    END IF;

    -- Otherwise return original event
    RETURN event;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===========================================
-- 2. DYNAMIC OBJECT CREATION FUNCTIONS
-- ===========================================

-- Function to create a new object with __a suffix
CREATE OR REPLACE FUNCTION tenant.create_object(
    _object_name TEXT,
    _label TEXT,
    _description TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    _tenant_id UUID;
    _object_id UUID;
    _table_name TEXT;
    _sql TEXT;
BEGIN
    -- Get current user's tenant_id from JWT app_metadata
    _tenant_id := (auth.jwt()->'app_metadata'->>'tenant_id')::uuid;
    
    IF _tenant_id IS NULL THEN
        RAISE EXCEPTION 'User not associated with any tenant';
    END IF;

    -- Generate table name with __a suffix and enforce length limits
    _table_name := lower(regexp_replace(_object_name, '[^a-zA-Z0-9]', '_', 'g'));
    _table_name := left(_table_name, 40) || '__a'; -- Truncate to 40 chars + '__a'
    
    -- Check if object already exists
    IF EXISTS (
        SELECT 1 FROM tenant.objects 
        WHERE tenant_id = _tenant_id AND name = _table_name
    ) THEN
        RAISE EXCEPTION 'Object with name "%" already exists', _object_name;
    END IF;
    
    -- Insert object definition
    INSERT INTO tenant.objects (tenant_id, name, label, description)
    VALUES (_tenant_id, _table_name, _label, _description)
    RETURNING id INTO _object_id;

    -- Create the actual table
    _sql := format('
        CREATE TABLE %I (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now(),
            created_by UUID REFERENCES system.users(id),
            updated_by UUID REFERENCES system.users(id)
        )', _table_name);
    
    EXECUTE _sql;

    -- Add RLS policies with separate SELECT/INSERT/UPDATE/DELETE policies
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', _table_name);
    
    -- SELECT policy (Auth Hook JWT-based)
    EXECUTE format('
        CREATE POLICY "select_tenant_isolation_%I"
        ON %I FOR SELECT
        USING (tenant_id = (auth.jwt()->''app_metadata''->>''tenant_id'')::uuid)', 
        _table_name, _table_name);
    
    -- INSERT policy (Auth Hook JWT-based)
    EXECUTE format('
        CREATE POLICY "insert_tenant_isolation_%I"
        ON %I FOR INSERT
        WITH CHECK (tenant_id = (auth.jwt()->''app_metadata''->>''tenant_id'')::uuid)', 
        _table_name, _table_name);
    
    -- UPDATE policy (Auth Hook JWT-based)
    EXECUTE format('
        CREATE POLICY "update_tenant_isolation_%I"
        ON %I FOR UPDATE
        USING (tenant_id = (auth.jwt()->''app_metadata''->>''tenant_id'')::uuid)
        WITH CHECK (tenant_id = (auth.jwt()->''app_metadata''->>''tenant_id'')::uuid)', 
        _table_name, _table_name);
    
    -- DELETE policy (Auth Hook JWT-based)
    EXECUTE format('
        CREATE POLICY "delete_tenant_isolation_%I"
        ON %I FOR DELETE
        USING (tenant_id = (auth.jwt()->''app_metadata''->>''tenant_id'')::uuid)', 
        _table_name, _table_name);

    -- Create updated_at trigger
    EXECUTE format('
        CREATE TRIGGER set_updated_at_%I
        BEFORE UPDATE ON %I
        FOR EACH ROW EXECUTE FUNCTION system.set_updated_at()',
        _table_name, _table_name);

    -- Add index on tenant_id for better RLS performance
    EXECUTE format('CREATE INDEX idx_%I_tenant_id ON %I(tenant_id)', 
                   _table_name, _table_name);

    RETURN _object_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to add fields to an object
CREATE OR REPLACE FUNCTION tenant.add_field(
    _object_id UUID,
    _field_name TEXT,
    _label TEXT,
    _field_type TEXT,
    _is_required BOOLEAN DEFAULT false,
    _default_value TEXT DEFAULT NULL,
    _validation_rules JSONB DEFAULT NULL,
    _section TEXT DEFAULT 'General',
    _width INTEGER DEFAULT 100,
    _is_visible BOOLEAN DEFAULT true
)
RETURNS UUID AS $$
DECLARE
    _tenant_id UUID;
    _object_name TEXT;
    _field_id UUID;
    _sql TEXT;
    _column_definition TEXT;
    _table_name TEXT;
    _final_field_name TEXT;
BEGIN
    -- Get current user's tenant_id from JWT app_metadata
    _tenant_id := (auth.jwt()->'app_metadata'->>'tenant_id')::uuid;
    
    IF _tenant_id IS NULL THEN
        RAISE EXCEPTION 'User not associated with any tenant';
    END IF;

    -- Get object name
    SELECT name INTO _object_name 
    FROM tenant.objects 
    WHERE id = _object_id AND tenant_id = _tenant_id;
    
    IF _object_name IS NULL THEN
        RAISE EXCEPTION 'Object not found or access denied';
    END IF;

    -- Generate field name with __a suffix if it's a custom field
    IF _field_name NOT IN ('name', 'email', 'phone', 'created_at', 'updated_at', 'created_by', 'updated_by') THEN
        _final_field_name := _field_name || '__a';
    ELSE
        _final_field_name := _field_name;
    END IF;
    
    -- Check if field already exists
    IF EXISTS (
        SELECT 1 FROM tenant.fields 
        WHERE object_id = _object_id AND name = _final_field_name
    ) THEN
        RAISE EXCEPTION 'Field with name "%" already exists on this object', _field_name;
    END IF;

    -- Insert field definition
    INSERT INTO tenant.fields (
        tenant_id, object_id, name, label, type, is_required, 
        default_value, validation_rules, section, width, is_visible
    )
    VALUES (
        _tenant_id, _object_id, _final_field_name, _label, _field_type, _is_required,
        _default_value, _validation_rules, _section, _width, _is_visible
    )
    RETURNING id INTO _field_id;

    -- Build column definition
    CASE _field_type
        WHEN 'text' THEN _column_definition := 'TEXT';
        WHEN 'number' THEN _column_definition := 'NUMERIC';
        WHEN 'date' THEN _column_definition := 'DATE';
        WHEN 'datetime' THEN _column_definition := 'TIMESTAMPTZ';
        WHEN 'boolean' THEN _column_definition := 'BOOLEAN';
        WHEN 'email' THEN _column_definition := 'TEXT';
        WHEN 'url' THEN _column_definition := 'TEXT';
        WHEN 'phone' THEN _column_definition := 'TEXT';
        WHEN 'picklist' THEN _column_definition := 'TEXT';
        WHEN 'reference' THEN _column_definition := 'UUID';
        ELSE _column_definition := 'TEXT';
    END CASE;

    -- Add NOT NULL if required
    IF _is_required THEN
        _column_definition := _column_definition || ' NOT NULL';
    END IF;

    -- Add default value if provided
    IF _default_value IS NOT NULL THEN
        _column_definition := _column_definition || ' DEFAULT ' || quote_literal(_default_value);
    END IF;

    -- Add column to table
    _sql := format('ALTER TABLE %I ADD COLUMN %I %s', 
                   _object_name, _final_field_name, _column_definition);
    EXECUTE _sql;

    RETURN _field_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to create picklist values
CREATE OR REPLACE FUNCTION tenant.add_picklist_values(
    _field_id UUID,
    _values JSONB -- Array of objects: [{"value": "option1", "label": "Option 1"}]
)
RETURNS VOID AS $$
DECLARE
    _tenant_id UUID;
    _value_record JSONB;
    _display_order INTEGER := 1;
BEGIN
    -- Get current user's tenant_id from JWT app_metadata
    _tenant_id := (auth.jwt()->'app_metadata'->>'tenant_id')::uuid;
    
    IF _tenant_id IS NULL THEN
        RAISE EXCEPTION 'User not associated with any tenant';
    END IF;

    -- Verify field belongs to user's tenant
    IF NOT EXISTS (
        SELECT 1 FROM tenant.fields f
        JOIN tenant.objects o ON f.object_id = o.id
        WHERE f.id = _field_id AND o.tenant_id = _tenant_id
    ) THEN
        RAISE EXCEPTION 'Field not found or access denied';
    END IF;

    -- Insert picklist values
    FOR _value_record IN SELECT * FROM jsonb_array_elements(_values)
    LOOP
        -- Check for duplicate values
        IF EXISTS (
            SELECT 1 FROM tenant.picklist_values 
            WHERE field_id = _field_id AND value = _value_record->>'value'
        ) THEN
            RAISE EXCEPTION 'Picklist value "%" already exists for this field', _value_record->>'value';
        END IF;

        INSERT INTO tenant.picklist_values (
            tenant_id, field_id, value, label, display_order
        )
        VALUES (
            _tenant_id, _field_id, 
            _value_record->>'value', 
            _value_record->>'label', 
            _display_order
        );
        _display_order := _display_order + 1;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===========================================
-- 3. UTILITY FUNCTIONS
-- ===========================================

-- Function to get all objects for current tenant
CREATE OR REPLACE FUNCTION tenant.get_objects()
RETURNS TABLE (
    id UUID,
    name TEXT,
    label TEXT,
    description TEXT,
    is_active BOOLEAN,
    created_at TIMESTAMPTZ
) AS $$
DECLARE
    _tenant_id UUID;
BEGIN
    -- Get current user's tenant_id from JWT app_metadata
    _tenant_id := (auth.jwt()->'app_metadata'->>'tenant_id')::uuid;
    
    RETURN QUERY
    SELECT o.id, o.name, o.label, o.description, o.is_active, o.created_at
    FROM tenant.objects o
    WHERE o.tenant_id = _tenant_id
    ORDER BY o.created_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get all fields for an object
CREATE OR REPLACE FUNCTION tenant.get_object_fields(_object_id UUID)
RETURNS TABLE (
    id UUID,
    name TEXT,
    label TEXT,
    type TEXT,
    is_required BOOLEAN,
    default_value TEXT,
    section TEXT,
    width INTEGER,
    is_visible BOOLEAN,
    display_order INTEGER,
    created_at TIMESTAMPTZ
) AS $$
DECLARE
    _tenant_id UUID;
BEGIN
    -- Get current user's tenant_id from JWT app_metadata
    _tenant_id := (auth.jwt()->'app_metadata'->>'tenant_id')::uuid;
    
    RETURN QUERY
    SELECT f.id, f.name, f.label, f.type, f.is_required, f.default_value,
           f.section, f.width, f.is_visible, f.display_order, f.created_at
    FROM tenant.fields f
    JOIN tenant.objects o ON f.object_id = o.id
    WHERE o.id = _object_id AND o.tenant_id = _tenant_id
    ORDER BY f.display_order, f.created_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get picklist values for a field
CREATE OR REPLACE FUNCTION tenant.get_picklist_values(_field_id UUID)
RETURNS TABLE (
    id UUID,
    value TEXT,
    label TEXT,
    display_order INTEGER,
    is_active BOOLEAN
) AS $$
DECLARE
    _tenant_id UUID;
BEGIN
    -- Get current user's tenant_id from JWT app_metadata
    _tenant_id := (auth.jwt()->'app_metadata'->>'tenant_id')::uuid;
    
    RETURN QUERY
    SELECT pv.id, pv.value, pv.label, pv.display_order, pv.is_active
    FROM tenant.picklist_values pv
    JOIN tenant.fields f ON pv.field_id = f.id
    JOIN tenant.objects o ON f.object_id = o.id
    WHERE pv.field_id = _field_id AND o.tenant_id = _tenant_id
    ORDER BY pv.display_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===========================================
-- 4. TRIGGER FOR UPDATED_AT
-- ===========================================

-- Generic trigger function for updated_at
CREATE OR REPLACE FUNCTION system.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    NEW.updated_by = auth.uid();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- 5. ADD CONSTRAINTS AND INDEXES
-- ===========================================

-- Add unique constraint to picklist values to prevent duplicates
ALTER TABLE tenant.picklist_values 
ADD CONSTRAINT uniq_picklist_value UNIQUE(field_id, value);

-- Add index on tenant_id for better performance
CREATE INDEX IF NOT EXISTS idx_tenant_objects_tenant_id ON tenant.objects(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_fields_tenant_id ON tenant.fields(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_permission_sets_tenant_id ON tenant.permission_sets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_user_permission_sets_tenant_id ON tenant.user_permission_sets(tenant_id);

-- ===========================================
-- 6. GRANTS FOR FUNCTIONS
-- ===========================================

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION system.jwt_claims(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.create_object(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.add_field(UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, JSONB, TEXT, INTEGER, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.add_picklist_values(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.get_objects() TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.get_object_fields(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.get_picklist_values(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION system.set_updated_at() TO authenticated;

-- ===========================================
-- 7. COMMENTS FOR DOCUMENTATION
-- ===========================================

COMMENT ON FUNCTION system.jwt_claims(jsonb) IS 'Auth Hook function to add tenant_id to JWT app_metadata';
COMMENT ON FUNCTION tenant.create_object(TEXT, TEXT, TEXT) IS 'Creates a new object with __a suffix and corresponding table with RLS policies';
COMMENT ON FUNCTION tenant.add_field(UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, JSONB, TEXT, INTEGER, BOOLEAN) IS 'Adds a field to an object with __a suffix for custom fields';
COMMENT ON FUNCTION tenant.add_picklist_values(UUID, JSONB) IS 'Adds picklist values to a field with duplicate prevention';
COMMENT ON FUNCTION tenant.get_objects() IS 'Gets all objects for current tenant';
COMMENT ON FUNCTION tenant.get_object_fields(UUID) IS 'Gets all fields for an object';
COMMENT ON FUNCTION tenant.get_picklist_values(UUID) IS 'Gets picklist values for a field';

-- ===========================================
-- 8. VERIFICATION QUERIES
-- ===========================================

-- Test JWT claims function (run after setting up JWT Auth Hook)
-- SELECT system.jwt_claims('{"user": {"id": "your-user-id"}}'::jsonb);

-- Test object creation (run from UI)
-- SELECT tenant.create_object('Products', 'Products', 'Product catalog');

-- Test field addition (run from UI)
-- SELECT tenant.add_field(object_id, 'sku', 'SKU', 'text', true);

-- ===========================================
-- MIGRATION COMPLETE - PRODUCTION READY
-- ===========================================

-- Next steps:
-- 1. Set up JWT Auth Hook in Supabase Dashboard → Authentication → Auth Hooks
-- 2. Configure "Customize Access Token (JWT) Claims hook" with function: system.jwt_claims
-- 3. Test JWT claims with: SELECT system.jwt_claims('{"user": {"id": "your-user-id"}}'::jsonb);
-- 4. Create objects and fields from UI

