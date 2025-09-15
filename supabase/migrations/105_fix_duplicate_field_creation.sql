-- Migration 105: Fix Duplicate Field Creation Issue
-- Purpose: Clean up all conflicting tenant.add_field functions and ensure only one correct version exists
-- This will fix the issue where fields are created twice

-- 1. First, let's see what functions currently exist
DO $$
BEGIN
    RAISE NOTICE '🔍 === DIAGNOSING FUNCTION CHAOS ===';
    
    DECLARE
        function_count INTEGER;
        function_list TEXT;
    BEGIN
        -- Count all add_field functions
        SELECT COUNT(*) INTO function_count
        FROM information_schema.routines r
        WHERE r.routine_name = 'add_field'
        AND r.routine_schema = 'tenant';
        
        RAISE NOTICE '🔍 Found % add_field functions in tenant schema', function_count;
        
        -- List all function signatures
        SELECT string_agg(
            r.routine_schema || '.' || r.routine_name || '(' || 
            COALESCE(p.parameter_name, 'param' || p.ordinal_position) || ' ' || p.data_type || 
            CASE WHEN p.parameter_default IS NOT NULL THEN ' DEFAULT ' || p.parameter_default ELSE '' END || ')', 
            ', '
        ) INTO function_list
        FROM information_schema.routines r
        LEFT JOIN information_schema.parameters p ON r.specific_name = p.specific_name
        WHERE r.routine_name = 'add_field'
        AND r.routine_schema = 'tenant'
        GROUP BY r.routine_name, r.routine_schema;
        
        IF function_list IS NOT NULL THEN
            RAISE NOTICE '🔍 Function signatures: %', function_list;
        END IF;
    END;
END $$;

-- 2. DROP ALL existing add_field functions to start fresh
DO $$
DECLARE
    func_record RECORD;
    param_list TEXT;
BEGIN
    RAISE NOTICE '🧹 === CLEANING UP ALL EXISTING FUNCTIONS ===';
    
    -- Drop all add_field functions from tenant schema
    FOR func_record IN
        SELECT routine_name, specific_name
        FROM information_schema.routines r
        WHERE r.routine_name = 'add_field'
        AND r.routine_schema = 'tenant'
    LOOP
        -- Build parameter list for this specific function
        SELECT string_agg(
            CASE 
                WHEN p.parameter_name IS NULL THEN p.data_type
                ELSE p.parameter_name || ' ' || p.data_type
            END, ', '
        ) INTO param_list
        FROM information_schema.parameters p 
        WHERE p.specific_name = func_record.specific_name;
        
        -- Drop the function with its specific signature
        IF param_list IS NOT NULL THEN
            EXECUTE 'DROP FUNCTION IF EXISTS tenant.add_field(' || param_list || ') CASCADE';
            RAISE NOTICE '🧹 Dropped function: % with params: %', func_record.specific_name, param_list;
        ELSE
            -- If no parameters, drop without parameter list
            EXECUTE 'DROP FUNCTION IF EXISTS tenant.add_field() CASCADE';
            RAISE NOTICE '🧹 Dropped function: % (no params)', func_record.specific_name;
        END IF;
    END LOOP;
    
    RAISE NOTICE '✅ All existing add_field functions have been cleaned up!';
END $$;

-- 3. Create the ONE CORRECT version of tenant.add_field
CREATE OR REPLACE FUNCTION tenant.add_field(
    p_tenant_id UUID,
    p_object_id UUID,
    p_field_name TEXT,
    p_label TEXT,
    p_field_type TEXT,
    p_is_required BOOLEAN DEFAULT false,
    p_default_value TEXT DEFAULT NULL,
    p_validation_rules JSONB DEFAULT '[]'::jsonb,
    p_section TEXT DEFAULT 'details',
    p_width TEXT DEFAULT 'full',
    p_is_visible BOOLEAN DEFAULT true
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_field_id UUID;
    v_table_name TEXT;
    v_column_name TEXT;
    v_sql TEXT;
    v_autonumber_start BIGINT;
    v_width_int INTEGER;
BEGIN
    RAISE NOTICE '🔧 Creating field: % (Type: %) for object %', p_field_name, p_field_type, p_object_id;
    
    -- Get object table name
    SELECT o.name INTO v_table_name
    FROM tenant.objects o
    WHERE o.id = p_object_id AND o.tenant_id = p_tenant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Object not found: %', p_object_id;
    END IF;
    
    RAISE NOTICE '🔧 Table name: %', v_table_name;
    
    -- Generate column name with __a suffix for custom fields
    v_column_name := p_field_name;
    IF p_field_name NOT IN ('id', 'name', 'created_at', 'updated_at', 'tenant_id', 'is_active', 'autonumber') THEN
        v_column_name := p_field_name || '__a';
    END IF;
    
    RAISE NOTICE '🔧 Column name: %', v_column_name;
    
    -- Check if field already exists in metadata
    IF EXISTS (
        SELECT 1 FROM tenant.fields f
        WHERE f.object_id = p_object_id AND f.name = p_field_name
    ) THEN
        RAISE EXCEPTION 'Field "%" already exists on object %', p_field_name, p_object_id;
    END IF;
    
    -- Check if column already exists in physical table
    IF EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'tenant' 
        AND c.table_name = v_table_name 
        AND c.column_name = v_column_name
    ) THEN
        RAISE EXCEPTION 'Column "%" already exists in table %', v_column_name, v_table_name;
    END IF;
    
    -- Convert width to integer for column creation
    v_width_int := CASE p_width
        WHEN 'full' THEN 100
        WHEN 'half' THEN 50
        WHEN 'third' THEN 33
        WHEN 'quarter' THEN 25
        ELSE 100
    END;
    
    -- Handle autonumber field type
    IF p_field_type = 'autonumber' THEN
        -- Extract start value from validation_rules if provided
        v_autonumber_start := COALESCE((p_validation_rules->>'start_value')::BIGINT, 1);
        
        RAISE NOTICE '🔧 Creating autonumber sequence starting at %', v_autonumber_start;
        
        -- Create autonumber sequence entry
        INSERT INTO tenant.autonumber_sequences (
            object_id, tenant_id, field_name, current_value, start_value, increment_by
        ) VALUES (
            p_object_id, p_tenant_id, p_field_name, v_autonumber_start - 1, v_autonumber_start, 1
        ) ON CONFLICT (object_id, field_name, tenant_id) 
        DO UPDATE SET 
            start_value = EXCLUDED.start_value,
            current_value = EXCLUDED.start_value - 1;
    END IF;
    
    -- Create field metadata
    INSERT INTO tenant.fields (
        id, object_id, tenant_id, name, label, type, 
        is_required, is_nullable, default_value, validation_rules, 
        display_order, section, width, is_visible, is_system_field
    ) VALUES (
        gen_random_uuid(), p_object_id, p_tenant_id, p_field_name, p_label, p_field_type,
        p_is_required, NOT p_is_required, p_default_value, p_validation_rules,
        0, p_section, p_width, p_is_visible, false
    ) RETURNING id INTO v_field_id;
    
    RAISE NOTICE '🔧 Field metadata created with ID: %', v_field_id;
    
    -- Add physical column to table
    v_sql := format('ALTER TABLE tenant.%I ADD COLUMN %I %s',
        v_table_name, v_column_name, 
        CASE p_field_type
            WHEN 'text' THEN 'TEXT'
            WHEN 'number' THEN 'NUMERIC'
            WHEN 'email' THEN 'TEXT'
            WHEN 'phone' THEN 'TEXT'
            WHEN 'date' THEN 'DATE'
            WHEN 'datetime' THEN 'TIMESTAMPTZ'
            WHEN 'boolean' THEN 'BOOLEAN'
            WHEN 'picklist' THEN 'TEXT'
            WHEN 'reference' THEN 'TEXT'
            WHEN 'autonumber' THEN 'BIGINT DEFAULT 0'
            WHEN 'textarea' THEN 'TEXT'
            WHEN 'url' THEN 'TEXT'
            WHEN 'currency' THEN 'NUMERIC(15,2)'
            WHEN 'percent' THEN 'NUMERIC(5,2)'
            ELSE 'TEXT'
        END
    );
    
    RAISE NOTICE '🔧 Executing SQL: %', v_sql;
    EXECUTE v_sql;
    
    RAISE NOTICE '✅ Field "%" created successfully!', p_field_name;
    
    RETURN v_field_id;
END;
$$;

-- 4. Grant execute permission
GRANT EXECUTE ON FUNCTION tenant.add_field(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, JSONB, TEXT, TEXT, BOOLEAN) TO authenticated;

-- 5. Drop the existing create_tenant_field function first to avoid signature conflicts
DROP FUNCTION IF EXISTS public.create_tenant_field(UUID, TEXT, TEXT, TEXT, UUID, BOOLEAN, BOOLEAN, TEXT, JSONB, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT);

-- 6. Create the public.create_tenant_field function to use the correct tenant.add_field
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
    p_display_order INTEGER DEFAULT 0,
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
AS $$
DECLARE
    v_field_id UUID;
BEGIN
    RAISE NOTICE '🔧 === CREATING TENANT FIELD ===';
    RAISE NOTICE '🔧 Object ID: %', p_object_id;
    RAISE NOTICE '🔧 Field Name: %', p_name;
    RAISE NOTICE '🔧 Field Type: %', p_type;
    RAISE NOTICE '🔧 Tenant ID: %', p_tenant_id;
    
    -- Call the SINGLE tenant.add_field function
    SELECT tenant.add_field(
        p_tenant_id,
        p_object_id,
        p_name,
        p_label,
        p_type,
        p_is_required,
        p_default_value,
        p_validation_rules,
        p_section,
        p_width,
        p_is_visible
    ) INTO v_field_id;
    
    RAISE NOTICE '✅ Field created with ID: %', v_field_id;
    
    -- Return the created field details
    RETURN QUERY
    SELECT 
        f.id,
        f.object_id,
        f.name::text,
        f.label::text,
        f.type::text,
        f.is_required,
        f.is_nullable,
        f.default_value::text,
        f.validation_rules,
        f.display_order::int,
        f.section::text,
        f.width::text,
        f.is_visible,
        f.is_system_field,
        f.reference_table::text,
        f.reference_display_field::text,
        f.tenant_id,
        f.created_at,
        f.updated_at
    FROM tenant.fields f
    WHERE f.id = v_field_id;
END;
$$;

-- 7. Grant execute permission
GRANT EXECUTE ON FUNCTION public.create_tenant_field(UUID, TEXT, TEXT, TEXT, UUID, BOOLEAN, BOOLEAN, TEXT, JSONB, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT) TO authenticated;

-- 8. Verify the functions were created correctly
DO $$
BEGIN
    RAISE NOTICE '🔍 === VERIFYING FUNCTION CREATION ===';
    
    -- Check tenant.add_field
    IF EXISTS (
        SELECT 1 FROM information_schema.routines 
        WHERE routine_name = 'add_field' 
        AND routine_schema = 'tenant'
    ) THEN
        RAISE NOTICE '✅ tenant.add_field function created successfully';
    ELSE
        RAISE EXCEPTION '❌ tenant.add_field function creation failed';
    END IF;
    
    -- Check public.create_tenant_field
    IF EXISTS (
        SELECT 1 FROM information_schema.routines 
        WHERE routine_name = 'create_tenant_field' 
        AND routine_schema = 'public'
    ) THEN
        RAISE NOTICE '✅ public.create_tenant_field function created successfully';
    ELSE
        RAISE EXCEPTION '❌ public.create_tenant_field function creation failed';
    END IF;
    
    -- Count functions to ensure no duplicates
    DECLARE
        tenant_func_count INTEGER;
        public_func_count INTEGER;
    BEGIN
        SELECT COUNT(*) INTO tenant_func_count
        FROM information_schema.routines 
        WHERE routine_name = 'add_field' 
        AND routine_schema = 'tenant';
        
        SELECT COUNT(*) INTO public_func_count
        FROM information_schema.routines 
        WHERE routine_name = 'create_tenant_field' 
        AND routine_schema = 'public';
        
        RAISE NOTICE '🔍 tenant.add_field count: %', tenant_func_count;
        RAISE NOTICE '🔍 public.create_tenant_field count: %', public_func_count;
        
        IF tenant_func_count > 1 THEN
            RAISE EXCEPTION '❌ Multiple tenant.add_field functions found - cleanup failed!';
        END IF;
        
        IF public_func_count > 1 THEN
            RAISE EXCEPTION '❌ Multiple public.create_tenant_field functions found - cleanup failed!';
        END IF;
    END;
END $$;

-- 9. Log successful migration
DO $$
BEGIN
    RAISE NOTICE '🚀 Migration 105: Fix Duplicate Field Creation completed successfully!';
    RAISE NOTICE '✅ All duplicate functions have been cleaned up';
    RAISE NOTICE '✅ Single correct tenant.add_field function created';
    RAISE NOTICE '✅ Single correct public.create_tenant_field function created';
    RAISE NOTICE '🔮 No more duplicate field creation!';
END $$;
