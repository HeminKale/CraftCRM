-- Migration 014: Fix Field Creation and Type Mapping
-- Craft App - Fix the gap between UI field creation and actual database column creation
-- ================================

-- ===========================================
-- 1. UPDATE TENANT.ADD_FIELD TO SUPPORT ALL UI TYPES
-- ===========================================

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
    _auth_user_id UUID;
BEGIN
    -- Get current user's ID
    _auth_user_id := auth.uid();
    
    IF _auth_user_id IS NULL THEN
        RAISE EXCEPTION 'User not authenticated';
    END IF;

    -- Validate field name format
    IF _field_name !~ '^[a-z][a-z0-9_]*$' THEN
        RAISE EXCEPTION 'Invalid field api name "%" (use snake_case)', _field_name;
    END IF;

    -- Get tenant_id from system.users (primary method)
    SELECT tenant_id INTO _tenant_id 
    FROM system.users 
    WHERE id = _auth_user_id;
    
    -- Fallback: try JWT app_metadata if system.users lookup fails
    IF _tenant_id IS NULL THEN
        _tenant_id := (auth.jwt()->'app_metadata'->>'tenant_id')::uuid;
    END IF;
    
    IF _tenant_id IS NULL THEN
        RAISE EXCEPTION 'User not associated with any tenant. Please contact administrator.';
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
    
    -- Check if field already exists in metadata
    IF EXISTS (
        SELECT 1 FROM tenant.fields 
        WHERE object_id = _object_id AND name = _final_field_name
    ) THEN
        RAISE EXCEPTION 'Field with name "%" already exists on this object', _field_name;
    END IF;

    -- Check if column already exists in actual table (metadata sync guard)
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'tenant' AND table_name = _object_name AND column_name = _final_field_name
    ) THEN
        RAISE EXCEPTION 'Column "%" already exists on "%"', _final_field_name, _object_name;
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

    -- Build column definition with COMPLETE TYPE MAPPING
    CASE _field_type
        -- TEXT TYPES
        WHEN 'text' THEN _column_definition := 'TEXT';
        WHEN 'longtext' THEN _column_definition := 'TEXT';
        
        -- NUMERIC TYPES
        WHEN 'integer' THEN _column_definition := 'INTEGER';
        WHEN 'number' THEN _column_definition := 'NUMERIC';
        WHEN 'decimal(10,2)' THEN _column_definition := 'DECIMAL(10,2)';
        WHEN 'money' THEN _column_definition := 'DECIMAL(15,2)';
        WHEN 'percent' THEN _column_definition := 'DECIMAL(5,2)';
        
        -- BOOLEAN
        WHEN 'boolean' THEN _column_definition := 'BOOLEAN';
        
        -- DATE/TIME TYPES
        WHEN 'date' THEN _column_definition := 'DATE';
        WHEN 'datetime' THEN _column_definition := 'TIMESTAMPTZ';
        WHEN 'timestamptz' THEN _column_definition := 'TIMESTAMPTZ';
        WHEN 'time' THEN _column_definition := 'TIME';
        
        -- IDENTIFIER TYPES
        WHEN 'uuid' THEN _column_definition := 'UUID';
        WHEN 'reference' THEN _column_definition := 'UUID';
        
        -- COMPLEX TYPES
        WHEN 'jsonb' THEN _column_definition := 'JSONB';
        WHEN 'json' THEN _column_definition := 'JSONB';
        WHEN 'picklist' THEN _column_definition := 'TEXT';
        WHEN 'multiselect' THEN _column_definition := 'JSONB';
        
        -- SPECIALIZED TYPES
        WHEN 'email' THEN _column_definition := 'TEXT';
        WHEN 'url' THEN _column_definition := 'TEXT';
        WHEN 'phone' THEN _column_definition := 'TEXT';
        WHEN 'image' THEN _column_definition := 'TEXT';
        WHEN 'file' THEN _column_definition := 'TEXT';
        WHEN 'color' THEN _column_definition := 'VARCHAR(7)'; -- #RRGGBB
        WHEN 'rating' THEN _column_definition := 'INTEGER';
        
        -- DEFAULT FALLBACK
        ELSE _column_definition := 'TEXT';
    END CASE;

    -- Handle dynamic type parsing for varchar(n) and decimal(p,s)
    IF _field_type ~* '^varchar\(\d+\)$' THEN
        _column_definition := lower(_field_type);
    ELSIF _field_type ~* '^decimal\(\d+,\d+\)$' THEN
        _column_definition := 'numeric' || substring(lower(_field_type) from '\(\d+,\d+\)');
    END IF;

    -- Add NOT NULL if required
    IF _is_required THEN
        _column_definition := _column_definition || ' NOT NULL';
    END IF;

    -- Add default value if provided (with proper type casting)
    IF _default_value IS NOT NULL THEN
        CASE _field_type
            WHEN 'integer', 'number', 'decimal(10,2)', 'money', 'percent', 'rating' THEN
                _column_definition := _column_definition || ' DEFAULT ' || _default_value;
            WHEN 'boolean' THEN
                _column_definition := _column_definition || ' DEFAULT ' || _default_value;
            WHEN 'date', 'datetime', 'timestamptz', 'time' THEN
                _column_definition := _column_definition || ' DEFAULT ' || quote_literal(_default_value) || '::' || 
                    CASE _field_type
                        WHEN 'date' THEN 'date'
                        WHEN 'time' THEN 'time'
                        ELSE 'timestamptz'
                    END;
            ELSE
                _column_definition := _column_definition || ' DEFAULT ' || quote_literal(_default_value);
        END CASE;
    END IF;

    -- Add column to table with schema qualification
    _sql := format('ALTER TABLE tenant.%I ADD COLUMN %I %s', 
                   _object_name, _final_field_name, _column_definition);
    EXECUTE _sql;

    RETURN _field_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = tenant, public;

-- ===========================================
-- 2. UPDATE PUBLIC.CREATE_TENANT_FIELD TO CALL TENANT.ADD_FIELD
-- ===========================================

-- Remove p_tenant_id parameter and derive tenant from system.users
CREATE OR REPLACE FUNCTION public.create_tenant_field(
  p_object_id UUID,
  p_name TEXT,
  p_label TEXT,
  p_type TEXT,
  p_is_required BOOLEAN DEFAULT FALSE,
  p_is_nullable BOOLEAN DEFAULT TRUE,
  p_default_value TEXT DEFAULT NULL,
  p_validation_rules JSONB DEFAULT '[]'::jsonb,
  p_display_order INTEGER DEFAULT 0,
  p_section VARCHAR DEFAULT 'details',
  p_width VARCHAR DEFAULT 'half',
  p_is_visible BOOLEAN DEFAULT TRUE,
  p_is_system_field BOOLEAN DEFAULT FALSE,
  p_reference_table VARCHAR DEFAULT NULL,
  p_reference_display_field VARCHAR DEFAULT NULL
)
RETURNS TABLE(
  id UUID,
  name TEXT,
  label TEXT,
  type TEXT,
  is_required BOOLEAN,
  is_nullable BOOLEAN,
  default_value TEXT,
  validation_rules JSONB,
  display_order INTEGER,
  section TEXT,
  width TEXT,
  is_visible BOOLEAN,
  is_system_field BOOLEAN,
  reference_table TEXT,
  reference_display_field TEXT,
  tenant_id UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant, public
AS $$
DECLARE
  new_field_id UUID;
  new_field tenant.fields;
  _auth_user_id UUID;
  _user_tenant_id UUID;
BEGIN
  -- Get current user's ID
  _auth_user_id := auth.uid();
  
  IF _auth_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  -- Get tenant_id from system.users
  SELECT tenant_id INTO _user_tenant_id 
  FROM system.users 
  WHERE id = _auth_user_id;
  
  IF _user_tenant_id IS NULL THEN
    RAISE EXCEPTION 'User not found in system.users. Please contact administrator.';
  END IF;

  -- Call tenant.add_field which will:
  -- 1. Insert metadata into tenant.fields
  -- 2. Create actual database column
  -- 3. Return the field ID
  new_field_id := tenant.add_field(
    p_object_id,
    p_name,
    p_label,
    p_type,
    p_is_required,
    p_default_value,
    p_validation_rules,
    p_section,
    CASE p_width
      WHEN 'half' THEN 50
      WHEN 'full' THEN 100
      ELSE 50
    END,
    p_is_visible
  );

  -- Get the complete field record
  SELECT * INTO new_field
  FROM tenant.fields
  WHERE id = new_field_id;

  -- Return the complete field data
  RETURN QUERY
  SELECT 
    new_field.id,
    new_field.name,
    new_field.label,
    new_field.type,
    new_field.is_required,
    new_field.is_nullable,
    new_field.default_value,
    new_field.validation_rules,
    new_field.display_order,
    new_field.section,
    new_field.width,
    new_field.is_visible,
    new_field.is_system_field,
    new_field.reference_table,
    new_field.reference_display_field,
    new_field.tenant_id,
    new_field.created_at,
    new_field.updated_at;
END;
$$;

-- ===========================================
-- 3. ADD VALIDATION FUNCTIONS FOR NEW FIELD TYPES
-- ===========================================

-- Money validation (ensure positive values)
CREATE OR REPLACE FUNCTION tenant.validate_money_field(value DECIMAL)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN value >= 0;
END;
$$ LANGUAGE plpgsql;

-- Percentage validation (0-100)
CREATE OR REPLACE FUNCTION tenant.validate_percent_field(value DECIMAL)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN value >= 0 AND value <= 100;
END;
$$ LANGUAGE plpgsql;

-- Color validation (hex format)
CREATE OR REPLACE FUNCTION tenant.validate_color_field(value TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN value ~ '^#[0-9A-Fa-f]{6}$';
END;
$$ LANGUAGE plpgsql;

-- Rating validation (1-5)
CREATE OR REPLACE FUNCTION tenant.validate_rating_field(value INTEGER)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN value >= 1 AND value <= 5;
END;
$$ LANGUAGE plpgsql;

-- Email validation
CREATE OR REPLACE FUNCTION tenant.validate_email_field(value TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN value ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$';
END;
$$ LANGUAGE plpgsql;

-- URL validation
CREATE OR REPLACE FUNCTION tenant.validate_url_field(value TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN value ~ '^https?://[^\s/$.?#].[^\s]*$';
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- 4. UPDATE GRANTS
-- ===========================================

GRANT EXECUTE ON FUNCTION tenant.add_field(UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, JSONB, TEXT, INTEGER, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.validate_money_field(DECIMAL) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.validate_percent_field(DECIMAL) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.validate_color_field(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.validate_rating_field(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.validate_email_field(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.validate_url_field(TEXT) TO authenticated;

-- Grant execute on the updated create_tenant_field function (removed p_tenant_id parameter)
GRANT EXECUTE ON FUNCTION public.create_tenant_field(UUID, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, JSONB, INTEGER, VARCHAR, VARCHAR, BOOLEAN, BOOLEAN, VARCHAR, VARCHAR) TO authenticated;

-- Revoke from public for security
REVOKE EXECUTE ON FUNCTION public.create_tenant_field(UUID, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, JSONB, INTEGER, VARCHAR, VARCHAR, BOOLEAN, BOOLEAN, VARCHAR, VARCHAR) FROM public;

-- ===========================================
-- 5. ADD COMMENTS FOR CLARITY
-- ===========================================

COMMENT ON FUNCTION tenant.add_field(UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, JSONB, TEXT, INTEGER, BOOLEAN) IS 'Creates field metadata AND actual database column with proper system.users tenant resolution and schema safety';
COMMENT ON FUNCTION public.create_tenant_field(UUID, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, JSONB, INTEGER, VARCHAR, VARCHAR, BOOLEAN, BOOLEAN, VARCHAR, VARCHAR) IS 'Bridge function that creates field metadata AND database column via tenant.add_field with automatic tenant resolution';

-- ===========================================
-- 6. VERIFICATION QUERY
-- ===========================================

-- Test that the function works correctly
DO $$
DECLARE
    test_object_id UUID;
    test_field_id UUID;
    test_user_id UUID;
    test_tenant_id UUID;
BEGIN
    RAISE NOTICE 'Testing field creation with type mapping and system.users integration...';
    
    -- Get current user and tenant
    test_user_id := auth.uid();
    IF test_user_id IS NULL THEN
        RAISE NOTICE 'No authenticated user found. Skipping tests.';
        RETURN;
    END IF;
    
    -- Get tenant_id from system.users
    SELECT tenant_id INTO test_tenant_id 
    FROM system.users 
    WHERE id = test_user_id;
    
    IF test_tenant_id IS NULL THEN
        RAISE NOTICE 'User not found in system.users. Skipping tests.';
        RETURN;
    END IF;
    
    -- Create a test object if none exists
    SELECT id INTO test_object_id 
    FROM tenant.objects 
    WHERE tenant_id = test_tenant_id 
    LIMIT 1;
    
    IF test_object_id IS NULL THEN
        RAISE NOTICE 'No test object found for tenant %. Please create an object first.', test_tenant_id;
        RETURN;
    END IF;
    
    -- Test creating a field with a complex type
    BEGIN
        test_field_id := tenant.add_field(
            test_object_id,
            'test_price',
            'Test Price',
            'money',
            true
        );
        RAISE NOTICE '✅ Successfully created field with type "money" (ID: %)', test_field_id;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '❌ Failed to create field: %', SQLERRM;
    END;
    
    -- Test creating a field with varchar type
    BEGIN
        test_field_id := tenant.add_field(
            test_object_id,
            'test_sku',
            'Test SKU',
            'varchar(255)',
            true
        );
        RAISE NOTICE '✅ Successfully created field with type "varchar(255)" (ID: %)', test_field_id;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '❌ Failed to create field: %', SQLERRM;
    END;
    
    -- Test creating a field with dynamic decimal type
    BEGIN
        test_field_id := tenant.add_field(
            test_object_id,
            'test_discount',
            'Test Discount',
            'decimal(8,4)',
            false
        );
        RAISE NOTICE '✅ Successfully created field with type "decimal(8,4)" (ID: %)', test_field_id;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '❌ Failed to create field: %', SQLERRM;
    END;
    
    RAISE NOTICE 'Field creation test completed with system.users integration and hardening.';
END $$;

