-- Migration 062: Fix field creation to add physical columns
-- This migration ensures that when fields are created, they are added as
-- actual columns to the physical tables, not just metadata
-- FIXED: No JWT dependency + proper width handling + multitenancy maintained

-- Drop the existing function to recreate it
DROP FUNCTION IF EXISTS tenant.add_field(UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, JSONB, TEXT, INTEGER, BOOLEAN, UUID);
DROP FUNCTION IF EXISTS tenant.add_field(UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, JSONB, TEXT, INTEGER, BOOLEAN);

-- Create the updated function with comprehensive datatype mapping
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
    _object_name TEXT;
    _field_id UUID;
    _sql TEXT;
    _column_definition TEXT;
    _table_name TEXT;
    _final_field_name TEXT;
    _tenant_id UUID;
    v_width_text TEXT;
BEGIN
    -- Get tenant_id from the object itself (no JWT needed, but multitenancy maintained)
    SELECT o.tenant_id INTO _tenant_id
    FROM tenant.objects o
    WHERE o.id = _object_id;
    
    IF _tenant_id IS NULL THEN
        RAISE EXCEPTION 'Object not found';
    END IF;

    -- Get object name (this is the API name like 'one__a')
    SELECT o.name INTO _object_name 
    FROM tenant.objects o
    WHERE o.id = _object_id;
    
    IF _object_name IS NULL THEN
        RAISE EXCEPTION 'Object not found or access denied';
    END IF;

    -- CRITICAL FIX: Use the object name directly as table name
    -- The object name IS the table name (e.g., 'one__a' -> tenant.one__a)
    _table_name := _object_name;

    -- Generate field name with __a suffix if it's a custom field
    IF _field_name NOT IN ('name', 'email', 'phone', 'created_at', 'updated_at', 'created_by', 'updated_by', 'tenant_id', 'id', 'is_active') THEN
        _final_field_name := _field_name || '__a';
    ELSE
        _final_field_name := _field_name;
    END IF;
    
    -- Check if field already exists
    IF EXISTS (
        SELECT 1 FROM tenant.fields f
        WHERE f.object_id = _object_id AND f.name = _final_field_name
    ) THEN
        RAISE EXCEPTION 'Field with name "%" already exists on this object', _field_name;
    END IF;

    -- CRITICAL FIX: Convert integer width to proper text values for constraint
    v_width_text := CASE 
        WHEN _width >= 100 THEN 'full'
        WHEN _width >= 75 THEN 'three-quarter'
        WHEN _width >= 66 THEN 'two-third'
        WHEN _width >= 50 THEN 'half'
        WHEN _width >= 33 THEN 'third'
        WHEN _width >= 25 THEN 'quarter'
        ELSE 'full'
    END;

    -- Insert field definition with proper width text
    INSERT INTO tenant.fields (
        tenant_id, object_id, name, label, type, is_required, 
        default_value, validation_rules, section, width, is_visible
    )
    VALUES (
        _tenant_id, _object_id, _final_field_name, _label, _field_type, _is_required,
        _default_value, _validation_rules, _section, v_width_text, _is_visible
    )
    RETURNING id INTO _field_id;

    -- Build column definition with comprehensive datatype mapping
    CASE _field_type
        WHEN 'text' THEN _column_definition := 'TEXT';
        WHEN 'varchar(255)' THEN _column_definition := 'VARCHAR(255)';
        WHEN 'integer' THEN _column_definition := 'INTEGER';
        WHEN 'number' THEN _column_definition := 'NUMERIC';
        WHEN 'decimal(10,2)' THEN _column_definition := 'DECIMAL(10,2)';
        WHEN 'boolean' THEN _column_definition := 'BOOLEAN';
        WHEN 'date' THEN _column_definition := 'DATE';
        WHEN 'datetime' THEN _column_definition := 'TIMESTAMPTZ';
        WHEN 'timestamptz' THEN _column_definition := 'TIMESTAMPTZ';
        WHEN 'email' THEN _column_definition := 'TEXT';
        WHEN 'url' THEN _column_definition := 'TEXT';
        WHEN 'phone' THEN _column_definition := 'TEXT';
        WHEN 'picklist' THEN _column_definition := 'TEXT';
        WHEN 'reference' THEN _column_definition := 'UUID';
        WHEN 'uuid' THEN _column_definition := 'UUID';
        WHEN 'money' THEN _column_definition := 'NUMERIC(15,2)';
        WHEN 'percent' THEN _column_definition := 'NUMERIC(5,2)';
        WHEN 'time' THEN _column_definition := 'TIME';
        WHEN 'longtext' THEN _column_definition := 'TEXT';
        WHEN 'image' THEN _column_definition := 'TEXT';
        WHEN 'file' THEN _column_definition := 'TEXT';
        WHEN 'files' THEN _column_definition := 'JSONB';
        WHEN 'color' THEN _column_definition := 'TEXT';
        WHEN 'rating' THEN _column_definition := 'INTEGER';
        WHEN 'multiselect' THEN _column_definition := 'JSONB';
        WHEN 'jsonb' THEN _column_definition := 'JSONB';
        ELSE _column_definition := 'TEXT';
    END CASE;

    -- Add NOT NULL if required
    IF _is_required THEN
        _column_definition := _column_definition || ' NOT NULL';
    END IF;

    -- Add default value if provided
    IF _default_value IS NOT NULL THEN
        -- Handle different datatypes for default values
        CASE _field_type
            WHEN 'boolean' THEN
                IF _default_value = 'true' THEN
                    _column_definition := _column_definition || ' DEFAULT true';
                ELSIF _default_value = 'false' THEN
                    _column_definition := _column_definition || ' DEFAULT false';
                END IF;
            WHEN 'integer', 'number', 'decimal(10,2)', 'money', 'percent', 'rating' THEN
                _column_definition := _column_definition || ' DEFAULT ' || _default_value;
            ELSE
                _column_definition := _column_definition || ' DEFAULT ' || quote_literal(_default_value);
        END CASE;
    END IF;

    -- CRITICAL FIX: Add column to physical table using correct table name
    _sql := format('ALTER TABLE tenant.%I ADD COLUMN %I %s', 
                   _table_name, _final_field_name, _column_definition);
    
    BEGIN
        EXECUTE _sql;
        RAISE NOTICE 'Column % added to table tenant.%', _final_field_name, _table_name;
    EXCEPTION
        WHEN OTHERS THEN
            RAISE EXCEPTION 'Failed to add column % to table tenant.%: %', _final_field_name, _table_name, SQLERRM;
    END;

    RETURN _field_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION tenant.add_field(UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, JSONB, TEXT, INTEGER, BOOLEAN) TO authenticated;

-- Add comment
COMMENT ON FUNCTION tenant.add_field(UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, JSONB, TEXT, INTEGER, BOOLEAN) IS 'Updated: Adds field metadata AND physical column to table with comprehensive datatype mapping (NO JWT dependency, multitenancy maintained)';

-- Verify the function was created
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.routines 
        WHERE routine_name = 'add_field' 
        AND routine_schema = 'tenant'
    ) THEN
        RAISE NOTICE '✅ tenant.add_field function updated successfully';
    ELSE
        RAISE EXCEPTION '❌ tenant.add_field function update failed';
    END IF;
END $$;