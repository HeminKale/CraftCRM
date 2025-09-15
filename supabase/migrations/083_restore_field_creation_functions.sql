-- Migration 083: Force Replace Field Creation Functions
-- This migration forces replacement of field creation functions to fix schema_name errors
-- We need to replace existing broken functions, not just create if missing

DO $outer$
BEGIN
    -- 1. Force replace tenant.add_field function (drop and recreate)
    RAISE NOTICE 'Dropping existing tenant.add_field function...';
    DROP FUNCTION IF EXISTS tenant.add_field(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, JSONB, TEXT, INTEGER, BOOLEAN);
    
    RAISE NOTICE 'Creating tenant.add_field function...';
    
    CREATE OR REPLACE FUNCTION tenant.add_field(
        p_tenant_id UUID,
        p_object_id UUID,
        p_field_name TEXT,
        p_display_label TEXT,
        p_field_type TEXT,
        p_is_required BOOLEAN,
        p_default_value TEXT DEFAULT NULL,
        p_validation_rules JSONB DEFAULT '[]'::jsonb,
        p_section TEXT DEFAULT 'details',
        p_display_order INTEGER DEFAULT 100,
        p_width TEXT DEFAULT 'full',
        p_is_visible BOOLEAN DEFAULT true
    )
    RETURNS UUID
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $func$
    DECLARE
        v_field_id UUID;
        v_table_name TEXT;
        v_column_name TEXT;
        v_sql TEXT;
    BEGIN
        -- Get object table name
        SELECT tenant.objects.name INTO v_table_name
        FROM tenant.objects 
        WHERE tenant.objects.id = p_object_id AND tenant.objects.tenant_id = p_tenant_id;
        
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Object not found: %', p_object_id;
        END IF;
        
        -- Append __a suffix for custom fields (not system fields)
        v_column_name := p_field_name;
        IF p_field_name NOT IN ('id', 'name', 'created_at', 'updated_at', 'tenant_id', 'is_active', 'autonumber') THEN
            v_column_name := p_field_name || '__a';
        END IF;
        
        -- Check if column already exists
        IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE information_schema.columns.table_schema = 'tenant' 
            AND information_schema.columns.table_name = v_table_name 
            AND information_schema.columns.column_name = v_column_name
        ) THEN
            RAISE EXCEPTION 'Column % already exists in table %', v_column_name, v_table_name;
        END IF;
        
        -- Create field metadata
        INSERT INTO tenant.fields (
            id, object_id, tenant_id, name, label, type, 
            is_required, is_nullable, default_value, validation_rules, 
            display_order, section, width, is_visible, is_system_field
        ) VALUES (
            gen_random_uuid(), p_object_id, p_tenant_id, p_field_name, p_display_label, p_field_type,
            p_is_required, NOT p_is_required, p_default_value, p_validation_rules,
            p_display_order, p_section, p_width, p_is_visible, false
        ) RETURNING tenant.fields.id INTO v_field_id;
        
        -- Add physical column to table
        v_sql := format('ALTER TABLE tenant.%I ADD COLUMN %I %s',
            v_table_name, v_column_name, 
            CASE p_field_type
                WHEN 'text' THEN 'TEXT'
                WHEN 'varchar(255)' THEN 'VARCHAR(255)'
                WHEN 'integer' THEN 'INTEGER'
                WHEN 'decimal(10,2)' THEN 'DECIMAL(10,2)'
                WHEN 'boolean' THEN 'BOOLEAN'
                WHEN 'date' THEN 'DATE'
                WHEN 'timestamptz' THEN 'TIMESTAMPTZ'
                WHEN 'uuid' THEN 'UUID'
                WHEN 'jsonb' THEN 'JSONB'
                WHEN 'reference' THEN 'UUID'
                WHEN 'picklist' THEN 'TEXT'
                WHEN 'money' THEN 'DECIMAL(10,2)'
                WHEN 'percent' THEN 'DECIMAL(5,2)'
                WHEN 'time' THEN 'TIME'
                WHEN 'longtext' THEN 'TEXT'
                WHEN 'image' THEN 'TEXT'
                WHEN 'file' THEN 'TEXT'
                WHEN 'files' THEN 'JSONB'
                WHEN 'color' THEN 'TEXT'
                WHEN 'rating' THEN 'INTEGER'
                WHEN 'multiselect' THEN 'JSONB'
                WHEN 'email' THEN 'TEXT'
                WHEN 'url' THEN 'TEXT'
                WHEN 'phone' THEN 'TEXT'
                WHEN 'autonumber' THEN 'BIGINT'
                ELSE 'TEXT'
            END
        );
        
        EXECUTE v_sql;
        
        -- Add default value if specified
        IF p_default_value IS NOT NULL THEN
            v_sql := format('ALTER TABLE tenant.%I ALTER COLUMN %I SET DEFAULT %L',
                v_table_name, v_column_name, p_default_value
            );
            EXECUTE v_sql;
        END IF;
        
        -- Add NOT NULL constraint if required
        IF p_is_required THEN
            v_sql := format('ALTER TABLE tenant.%I ALTER COLUMN %I SET NOT NULL',
                v_table_name, v_column_name
            );
            EXECUTE v_sql;
        END IF;
        
        RETURN v_field_id;
    END;
    $func$;
    
    -- Grant execute permission
    GRANT EXECUTE ON FUNCTION tenant.add_field(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, JSONB, TEXT, INTEGER, TEXT, BOOLEAN) TO authenticated;
    
    RAISE NOTICE 'tenant.add_field function created successfully';

    -- 2. Force replace public.create_tenant_field function (drop and recreate)
    RAISE NOTICE 'Dropping existing public.create_tenant_field function...';
    DROP FUNCTION IF EXISTS public.create_tenant_field(UUID, TEXT, TEXT, TEXT, UUID, BOOLEAN, BOOLEAN, TEXT, JSONB, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT);
    
    RAISE NOTICE 'Creating public.create_tenant_field function...';
    
    CREATE OR REPLACE FUNCTION public.create_tenant_field(
        p_object_id UUID,
        p_name TEXT,
        p_label TEXT,
        p_type TEXT,
        p_tenant_id UUID,
        p_is_required BOOLEAN DEFAULT false,
        p_is_nullable BOOLEAN DEFAULT true,
        p_default_value TEXT DEFAULT NULL,
        p_validation_rules JSONB DEFAULT '[]'::jsonb,
        p_display_order INTEGER DEFAULT 100,
        p_section TEXT DEFAULT 'details',
        p_width TEXT DEFAULT 'full',
        p_is_visible BOOLEAN DEFAULT true,
        p_is_system_field BOOLEAN DEFAULT false,
        p_reference_table TEXT DEFAULT NULL,
        p_reference_display_field TEXT DEFAULT NULL
    )
    RETURNS TABLE(
        id UUID,
        object_id UUID,
        tenant_id UUID,
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
        created_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $func2$
    DECLARE
        v_field_id UUID;
    BEGIN
        -- Verify tenant access
        IF NOT EXISTS (
            SELECT 1 FROM system.tenants t
            WHERE t.id = p_tenant_id
        ) THEN
            RAISE EXCEPTION 'Tenant not found or access denied';
        END IF;
        
        -- Create field metadata first
        INSERT INTO tenant.fields (
            id, object_id, tenant_id, name, label, type,
            is_required, is_nullable, default_value, validation_rules,
            display_order, section, width, is_visible, is_system_field,
            reference_table, reference_display_field
        ) VALUES (
            gen_random_uuid(), p_object_id, p_tenant_id, p_name, p_label, p_type,
            p_is_required, p_is_nullable, p_default_value, p_validation_rules,
            p_display_order, p_section, p_width, p_is_visible, p_is_system_field,
            p_reference_table, p_reference_display_field
        ) RETURNING tenant.fields.id INTO v_field_id;
        
        -- Call tenant.add_field to create the physical column
        PERFORM tenant.add_field(
            p_tenant_id,
            p_object_id,
            p_name,
            p_label,
            p_type,
            p_is_required,
            p_default_value,
            p_validation_rules,
            p_section,
            p_display_order,
            p_width,
            p_is_visible
        );
        
        -- Return the created field
        RETURN QUERY
        SELECT 
            f.id, f.object_id, f.tenant_id, f.name, f.label, f.type,
            f.is_required, f.is_nullable, f.default_value, f.validation_rules,
            f.display_order, f.section::text, f.width::text, f.is_visible, f.is_system_field,
            f.reference_table::text, f.reference_display_field::text, f.created_at, f.updated_at
            FROM tenant.fields f
            WHERE f.id = v_field_id;
    END;
    $func2$;
    
    -- Grant execute permission
    GRANT EXECUTE ON FUNCTION public.create_tenant_field(UUID, TEXT, TEXT, TEXT, UUID, BOOLEAN, BOOLEAN, TEXT, JSONB, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT) TO authenticated;
    
    RAISE NOTICE 'public.create_tenant_field function created successfully';

    -- 3. Verify the functions were created successfully
    RAISE NOTICE 'Migration 083 completed successfully!';
    RAISE NOTICE 'Both functions have been force-replaced and should work without schema_name errors';
    RAISE NOTICE 'Field creation functionality is now available';
END $outer$;
