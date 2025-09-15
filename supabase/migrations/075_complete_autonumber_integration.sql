-- Migration 075: Complete Autonumber Integration
-- This completes the autonumber system by integrating it with field creation and existing objects
-- PREREQUISITE: Migration 074 must be completed first

-- 1. Update tenant.add_field function to support autonumber type
CREATE OR REPLACE FUNCTION tenant.add_field(
    _tenant_id UUID,
    _object_id UUID,
    _field_name TEXT,
    _label TEXT,
    _field_type TEXT,
    _is_required BOOLEAN DEFAULT false,
    _default_value TEXT DEFAULT NULL,
    _validation_rules JSONB DEFAULT '[]'::jsonb,
    _section TEXT DEFAULT 'details',
    _width INTEGER DEFAULT 100,
    _is_visible BOOLEAN DEFAULT true
)
RETURNS UUID
AS $$
DECLARE
    _field_id UUID;
    _final_field_name TEXT;
    _column_definition TEXT;
    _sql TEXT;
    _table_name TEXT;
    v_width_text TEXT;
    _autonumber_start BIGINT;
BEGIN
    -- Get table name from tenant.objects
    SELECT name INTO _table_name
    FROM tenant.objects
    WHERE id = _object_id AND tenant_id = _tenant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Object not found or access denied';
    END IF;

    -- Handle autonumber field type
    IF _field_type = 'autonumber' THEN
        -- Extract start value from validation_rules if provided
        _autonumber_start := COALESCE((_validation_rules->>'start_value')::BIGINT, 1);
        
        -- Create autonumber sequence entry
        INSERT INTO tenant.autonumber_sequences (
            object_id, tenant_id, field_name, current_value, start_value
        ) VALUES (
            _object_id, _tenant_id, _field_name, _autonumber_start - 1, _autonumber_start
        ) ON CONFLICT (object_id, field_name, tenant_id) 
        DO UPDATE SET 
            start_value = EXCLUDED.start_value,
            current_value = EXCLUDED.start_value - 1;
    END IF;

    -- Final field name (handle special characters)
    _final_field_name := lower(regexp_replace(_field_name, '[^a-zA-Z0-9]', '_', 'g'));
    
    -- Check if field already exists
    IF EXISTS (
        SELECT 1 FROM tenant.fields f
        WHERE f.object_id = _object_id AND f.name = _final_field_name
    ) THEN
        RAISE EXCEPTION 'Field with name "%" already exists on this object', _field_name;
    END IF;

    -- Convert width to text (only use values that match the current constraint)
    v_width_text := CASE 
        WHEN _width >= 100 THEN 'full'
        WHEN _width >= 50 THEN 'half'
        ELSE 'half'
    END;

    -- Insert field definition
    INSERT INTO tenant.fields (
        tenant_id, object_id, name, label, type, is_required, is_nullable,
        default_value, validation_rules, section, width, is_visible, display_order
    )
    VALUES (
        _tenant_id, _object_id, _final_field_name, _label, _field_type, _is_required, NOT _is_required,
        _default_value, _validation_rules, _section, v_width_text, _is_visible, 0
    )
    RETURNING id INTO _field_id;

    -- Build column definition
    CASE _field_type
        WHEN 'text' THEN _column_definition := 'TEXT';
        WHEN 'picklist' THEN _column_definition := 'TEXT';
        WHEN 'reference' THEN _column_definition := 'UUID';
        WHEN 'boolean' THEN _column_definition := 'BOOLEAN';
        WHEN 'integer' THEN _column_definition := 'INTEGER';
        WHEN 'number' THEN _column_definition := 'NUMERIC';
        WHEN 'date' THEN _column_definition := 'DATE';
        WHEN 'datetime' THEN _column_definition := 'TIMESTAMPTZ';
        WHEN 'autonumber' THEN _column_definition := 'BIGINT';
        ELSE _column_definition := 'TEXT';
    END CASE;

    -- Add NOT NULL if required
    IF _is_required THEN
        _column_definition := _column_definition || ' NOT NULL';
    END IF;

    -- Add default value if provided (except for autonumber)
    IF _default_value IS NOT NULL AND _field_type != 'autonumber' THEN
        CASE _field_type
            WHEN 'boolean' THEN
                IF _default_value = 'true' THEN
                    _column_definition := _column_definition || ' DEFAULT true';
                ELSIF _default_value = 'false' THEN
                    _column_definition := _column_definition || ' DEFAULT false';
                END IF;
            WHEN 'integer', 'number' THEN
                _column_definition := _column_definition || ' DEFAULT ' || _default_value;
            ELSE
                _column_definition := _column_definition || ' DEFAULT ' || quote_literal(_default_value);
        END CASE;
    END IF;

    -- Add column to physical table
    _sql := format('ALTER TABLE tenant.%I ADD COLUMN %I %s', 
                   _table_name, _final_field_name, _column_definition);
    
    EXECUTE _sql;
    RAISE NOTICE 'Column % added to table tenant.%', _final_field_name, _table_name;

    -- If this is an autonumber field, create trigger on the table
    IF _field_type = 'autonumber' THEN
        -- Create trigger for autonumber
        _sql := format('
            CREATE TRIGGER set_autonumber_%I_%I
            BEFORE INSERT ON tenant.%I
            FOR EACH ROW EXECUTE FUNCTION tenant.set_autonumber_value()',
            _object_id, _final_field_name, _table_name
        );
        
        EXECUTE _sql;
        RAISE NOTICE 'Autonumber trigger created for field % on table tenant.%', _final_field_name, _table_name;
    END IF;

    RETURN _field_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION tenant.add_field(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, JSONB, TEXT, INTEGER, BOOLEAN) TO authenticated;

-- 2. Update public.seed_system_fields to include autonumber field
CREATE OR REPLACE FUNCTION public.seed_system_fields(
    p_object_id UUID,
    p_tenant_id UUID
)
RETURNS VOID
AS $$
BEGIN
    -- Insert system fields including autonumber
    INSERT INTO tenant.fields (
        tenant_id, object_id, name, label, type, is_required, is_nullable,
        default_value, validation_rules, section, width, is_visible, display_order
    ) VALUES 
    -- Basic system fields
    (p_tenant_id, p_object_id, 'name', 'Name', 'text', true, false, NULL, '[]'::jsonb, 'details', 'full', true, 0),
    (p_tenant_id, p_object_id, 'created_at', 'Created At', 'datetime', false, true, NULL, '[]'::jsonb, 'system', 'half', false, 1),
    (p_tenant_id, p_object_id, 'updated_at', 'Updated At', 'datetime', false, true, NULL, '[]'::jsonb, 'system', 'half', false, 2),
    (p_tenant_id, p_object_id, 'created_by', 'Created By', 'reference', false, true, NULL, '[]'::jsonb, 'system', 'half', false, 3),
    (p_tenant_id, p_object_id, 'updated_by', 'Updated By', 'reference', false, true, NULL, '[]'::jsonb, 'system', 'half', false, 4),
    (p_tenant_id, p_object_id, 'is_active', 'Active', 'boolean', false, true, 'true', '[]'::jsonb, 'system', 'half', true, 5),
    (p_tenant_id, p_object_id, 'tenant_id', 'Tenant ID', 'reference', false, true, NULL, '[]'::jsonb, 'system', 'half', false, 6),
    -- NEW: Autonumber field
    (p_tenant_id, p_object_id, 'autonumber', 'Auto Number', 'autonumber', false, true, NULL, '{"start_value": 1}'::jsonb, 'details', 'half', true, 7);
    
    RAISE NOTICE 'System fields seeded for object % including autonumber field', p_object_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.seed_system_fields(UUID, UUID) TO authenticated;

-- 3. Create function to add autonumber support to existing objects
CREATE OR REPLACE FUNCTION tenant.add_autonumber_to_existing_object(
    p_object_id UUID,
    p_tenant_id UUID
)
RETURNS TEXT
AS $$
DECLARE
    v_table_name TEXT;
    v_autonumber_field_id UUID;
    v_sql TEXT;
BEGIN
    -- Get table name
    SELECT name INTO v_table_name
    FROM tenant.objects
    WHERE id = p_object_id AND tenant_id = p_tenant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Object not found or access denied';
    END IF;
    
    -- Check if autonumber field already exists
    IF EXISTS (
        SELECT 1 FROM tenant.fields 
        WHERE object_id = p_object_id AND name = 'autonumber'
    ) THEN
        RETURN format('Autonumber field already exists for object %', p_object_id);
    END IF;
    
    -- Add autonumber column to physical table
    v_sql := format('ALTER TABLE tenant.%I ADD COLUMN autonumber BIGINT', v_table_name);
    EXECUTE v_sql;
    
    -- Create autonumber sequence entry
    INSERT INTO tenant.autonumber_sequences (
        object_id, tenant_id, field_name, current_value, start_value
    ) VALUES (
        p_object_id, p_tenant_id, 'autonumber', 0, 1
    );
    
    -- Create trigger for autonumber
    v_sql := format('
        CREATE TRIGGER set_autonumber_%I_autonumber
        BEFORE INSERT ON tenant.%I
        FOR EACH ROW EXECUTE FUNCTION tenant.set_autonumber_value()',
        p_object_id, v_table_name
    );
    
    EXECUTE v_sql;
    
    RETURN format('Autonumber support added to object % (table: tenant.%)', p_object_id, v_table_name);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION tenant.add_autonumber_to_existing_object(UUID, UUID) TO authenticated;

-- 4. Create public bridge function for adding autonumber to existing objects
CREATE OR REPLACE FUNCTION public.add_autonumber_to_existing_object(
    p_object_id UUID,
    p_tenant_id UUID
)
RETURNS TEXT
AS $$
BEGIN
    RETURN tenant.add_autonumber_to_existing_object(p_object_id, p_tenant_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.add_autonumber_to_existing_object(UUID, UUID) TO authenticated;

-- 5. Create function to initialize autonumber values for existing records
CREATE OR REPLACE FUNCTION tenant.initialize_autonumber_for_existing_records(
    p_object_id UUID,
    p_tenant_id UUID
)
RETURNS TEXT
AS $$
DECLARE
    v_table_name TEXT;
    v_record RECORD;
    v_next_value BIGINT;
    v_sql TEXT;
    v_count INTEGER := 0;
BEGIN
    -- Get table name
    SELECT name INTO v_table_name
    FROM tenant.objects
    WHERE id = p_object_id AND tenant_id = p_tenant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Object not found or access denied';
    END IF;
    
    -- Check if autonumber field exists
    IF NOT EXISTS (
        SELECT 1 FROM tenant.fields 
        WHERE object_id = p_object_id AND name = 'autonumber'
    ) THEN
        RAISE EXCEPTION 'Autonumber field does not exist for this object';
    END IF;
    
    -- Get next autonumber value
    v_next_value := tenant.get_next_autonumber(p_object_id, 'autonumber', p_tenant_id);
    
    -- Update existing records with autonumber values
    v_sql := format('
        UPDATE tenant.%I 
        SET autonumber = v_next_value + ROW_NUMBER() OVER (ORDER BY created_at, id)
        WHERE autonumber IS NULL
        RETURNING id', v_table_name
    );
    
    EXECUTE v_sql INTO v_record;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    
    -- Update the sequence to reflect the highest value used
    UPDATE tenant.autonumber_sequences 
    SET current_value = v_next_value + v_count - 1
    WHERE object_id = p_object_id AND field_name = 'autonumber' AND tenant_id = p_tenant_id;
    
    RETURN format('Initialized autonumber for % existing records in object %', v_count, p_object_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION tenant.initialize_autonumber_for_existing_records(UUID, UUID) TO authenticated;

-- 6. Create public bridge function for initializing autonumber
CREATE OR REPLACE FUNCTION public.initialize_autonumber_for_existing_records(
    p_object_id UUID,
    p_tenant_id UUID
)
RETURNS TEXT
AS $$
BEGIN
    RETURN tenant.initialize_autonumber_for_existing_records(p_object_id, p_tenant_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.initialize_autonumber_for_existing_records(UUID, UUID) TO authenticated;

-- 7. Verify the migration
DO $$
BEGIN
    -- Check if tenant.add_field function supports autonumber
    IF EXISTS (
        SELECT 1 FROM information_schema.routines 
        WHERE routine_name = 'add_field' 
        AND routine_schema = 'tenant'
        AND routine_definition LIKE '%autonumber%'
    ) THEN
        RAISE NOTICE '✅ tenant.add_field function updated with autonumber support';
    ELSE
        RAISE EXCEPTION '❌ tenant.add_field function autonumber support update failed';
    END IF;
    
    -- Check if public.seed_system_fields includes autonumber
    IF EXISTS (
        SELECT 1 FROM information_schema.routines 
        WHERE routine_name = 'seed_system_fields' 
        AND routine_schema = 'public'
        AND routine_definition LIKE '%autonumber%'
    ) THEN
        RAISE NOTICE '✅ public.seed_system_fields updated with autonumber support';
    ELSE
        RAISE EXCEPTION '❌ public.seed_system_fields autonumber support update failed';
    END IF;
    
    -- Check if new functions exist
    IF EXISTS (
        SELECT 1 FROM information_schema.routines 
        WHERE routine_name = 'add_autonumber_to_existing_object' 
        AND routine_schema = 'tenant'
    ) THEN
        RAISE NOTICE '✅ tenant.add_autonumber_to_existing_object function created successfully';
    ELSE
        RAISE EXCEPTION '❌ tenant.add_autonumber_to_existing_object function creation failed';
    END IF;
    
    IF EXISTS (
        SELECT 1 FROM information_schema.routines 
        WHERE routine_name = 'initialize_autonumber_for_existing_records' 
        AND routine_schema = 'tenant'
    ) THEN
        RAISE NOTICE '✅ tenant.initialize_autonumber_for_existing_records function created successfully';
    ELSE
        RAISE EXCEPTION '❌ tenant.initialize_autonumber_for_existing_records function creation failed';
    END IF;
    
    RAISE NOTICE '🎉 Migration 075 completed successfully! Autonumber system is now fully integrated.';
    RAISE NOTICE '📝 You can now:';
    RAISE NOTICE '   1. Create autonumber fields from the UI';
    RAISE NOTICE '   2. Add autonumber to existing objects';
    RAISE NOTICE '   3. Initialize autonumber for existing records';
END $$;
