-- Migration 078: Fix Missing Autonumber Column in Existing Objects
-- This migration adds the missing autonumber column to existing object tables
-- Date: 2024-01-XX
-- Purpose: Fix autonumber field that exists in metadata but missing from physical table

-- 1. First, let's check what objects need autonumber columns added
DO $$
DECLARE
    v_object_record RECORD;
    v_count INTEGER := 0;
BEGIN
    RAISE NOTICE '🔍 Checking for objects that need autonumber columns...';
    
    -- Find objects that have autonumber field in metadata but missing from physical table
    FOR v_object_record IN 
        SELECT DISTINCT 
            o.id as object_id,
            o.name as table_name,
            o.tenant_id
        FROM tenant.objects o
        INNER JOIN tenant.fields f ON f.object_id = o.id
        WHERE f.name = 'autonumber' 
        AND f.type = 'autonumber'
        AND NOT EXISTS (
            SELECT 1 FROM information_schema.columns c
            WHERE c.table_schema = 'tenant'
            AND c.table_name = o.name
            AND c.column_name = 'autonumber'
        )
    LOOP
        RAISE NOTICE '📋 Object % (table: tenant.%) needs autonumber column', 
            v_object_record.object_id, v_object_record.table_name;
        v_count := v_count + 1;
    END LOOP;
    
    IF v_count = 0 THEN
        RAISE NOTICE '✅ All objects already have autonumber columns!';
    ELSE
        RAISE NOTICE '🔧 Found % objects that need autonumber columns added', v_count;
    END IF;
END $$;

-- 2. Add autonumber columns to existing objects that need them
DO $$
DECLARE
    v_object_record RECORD;
    v_sql TEXT;
    v_success_count INTEGER := 0;
    v_error_count INTEGER := 0;
BEGIN
    RAISE NOTICE '🔧 Adding autonumber columns to existing objects...';
    
    FOR v_object_record IN 
        SELECT DISTINCT 
            o.id as object_id,
            o.name as table_name,
            o.tenant_id
        FROM tenant.objects o
        INNER JOIN tenant.fields f ON f.object_id = o.id
        WHERE f.name = 'autonumber' 
        AND f.type = 'autonumber'
        AND NOT EXISTS (
            SELECT 1 FROM information_schema.columns c
            WHERE c.table_schema = 'tenant'
            AND c.table_name = o.name
            AND c.column_name = 'autonumber'
        )
    LOOP
        BEGIN
            -- Add autonumber column to physical table
            v_sql := format('ALTER TABLE tenant.%I ADD COLUMN autonumber BIGINT', v_object_record.table_name);
            EXECUTE v_sql;
            
            RAISE NOTICE '✅ Added autonumber column to tenant.%', v_object_record.table_name;
            v_success_count := v_success_count + 1;
            
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE '❌ Failed to add autonumber column to tenant.%: %', 
                v_object_record.table_name, SQLERRM;
            v_error_count := v_error_count + 1;
        END;
    END LOOP;
    
    RAISE NOTICE '📊 Summary: % columns added successfully, % errors', v_success_count, v_error_count;
END $$;

-- 3. Create autonumber sequences for objects that don't have them
DO $$
DECLARE
    v_object_record RECORD;
    v_count INTEGER := 0;
BEGIN
    RAISE NOTICE '🔧 Creating autonumber sequences...';
    
    FOR v_object_record IN 
        SELECT DISTINCT 
            o.id as object_id,
            o.tenant_id
        FROM tenant.objects o
        INNER JOIN tenant.fields f ON f.object_id = o.id
        WHERE f.name = 'autonumber' 
        AND f.type = 'autonumber'
        AND NOT EXISTS (
            SELECT 1 FROM tenant.autonumber_sequences ans
            WHERE ans.object_id = o.id
            AND ans.field_name = 'autonumber'
        )
    LOOP
        BEGIN
            -- Create autonumber sequence entry
            INSERT INTO tenant.autonumber_sequences (
                object_id, tenant_id, field_name, current_value, start_value, increment_by
            ) VALUES (
                v_object_record.object_id, 
                v_object_record.tenant_id, 
                'autonumber', 
                0, 
                1, 
                1
            );
            
            RAISE NOTICE '✅ Created autonumber sequence for object %', v_object_record.object_id;
            v_count := v_count + 1;
            
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE '❌ Failed to create sequence for object %: %', 
                v_object_record.object_id, SQLERRM;
        END;
    END LOOP;
    
    RAISE NOTICE '📊 Created % autonumber sequences', v_count;
END $$;

-- 4. Create autonumber triggers for objects that don't have them
DO $$
DECLARE
    v_object_record RECORD;
    v_sql TEXT;
    v_count INTEGER := 0;
BEGIN
    RAISE NOTICE '🔧 Creating autonumber triggers...';
    
    FOR v_object_record IN 
        SELECT DISTINCT 
            o.id as object_id,
            o.name as table_name
        FROM tenant.objects o
        INNER JOIN tenant.fields f ON f.object_id = o.id
        WHERE f.name = 'autonumber' 
        AND f.type = 'autonumber'
        AND NOT EXISTS (
            SELECT 1 FROM information_schema.triggers t
            WHERE t.event_object_schema = 'tenant'
            AND t.event_object_table = o.name
            AND t.trigger_name LIKE '%autonumber%'
        )
    LOOP
        BEGIN
            -- Create trigger for autonumber
            v_sql := format('
                CREATE TRIGGER set_autonumber_%I_autonumber
                BEFORE INSERT ON tenant.%I
                FOR EACH ROW EXECUTE FUNCTION tenant.set_autonumber_value()',
                v_object_record.object_id, v_object_record.table_name
            );
            
            EXECUTE v_sql;
            
            RAISE NOTICE '✅ Created autonumber trigger for tenant.%', v_object_record.table_name;
            v_count := v_count + 1;
            
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE '❌ Failed to create trigger for tenant.%: %', 
                v_object_record.table_name, SQLERRM;
        END;
    END LOOP;
    
    RAISE NOTICE '📊 Created % autonumber triggers', v_count;
END $$;

-- 5. Verify the fix worked
DO $$
DECLARE
    v_object_record RECORD;
    v_has_column BOOLEAN;
    v_has_sequence BOOLEAN;
    v_has_trigger BOOLEAN;
    v_total_objects INTEGER := 0;
    v_fixed_objects INTEGER := 0;
BEGIN
    RAISE NOTICE '🔍 Verifying autonumber fix...';
    
    FOR v_object_record IN 
        SELECT DISTINCT 
            o.id as object_id,
            o.name as table_name,
            o.tenant_id
        FROM tenant.objects o
        INNER JOIN tenant.fields f ON f.object_id = o.id
        WHERE f.name = 'autonumber' 
        AND f.type = 'autonumber'
    LOOP
        v_total_objects := v_total_objects + 1;
        
        -- Check if column exists
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns c
            WHERE c.table_schema = 'tenant'
            AND c.table_name = v_object_record.table_name
            AND c.column_name = 'autonumber'
        ) INTO v_has_column;
        
        -- Check if sequence exists
        SELECT EXISTS (
            SELECT 1 FROM tenant.autonumber_sequences ans
            WHERE ans.object_id = v_object_record.object_id
            AND ans.field_name = 'autonumber'
        ) INTO v_has_sequence;
        
        -- Check if trigger exists
        SELECT EXISTS (
            SELECT 1 FROM information_schema.triggers t
            WHERE t.event_object_schema = 'tenant'
            AND t.event_object_table = v_object_record.table_name
            AND t.trigger_name LIKE '%autonumber%'
        ) INTO v_has_trigger;
        
        IF v_has_column AND v_has_sequence AND v_has_trigger THEN
            RAISE NOTICE '✅ Object % (tenant.%) - FULLY FIXED', 
                v_object_record.object_id, v_object_record.table_name;
            v_fixed_objects := v_fixed_objects + 1;
        ELSE
            RAISE NOTICE '❌ Object % (tenant.%) - PARTIALLY FIXED: column=%, sequence=%, trigger=%', 
                v_object_record.object_id, v_object_record.table_name, 
                v_has_column, v_has_sequence, v_has_trigger;
        END IF;
    END LOOP;
    
    RAISE NOTICE '📊 Verification Complete: %/% objects fully fixed', v_fixed_objects, v_total_objects;
    
    IF v_fixed_objects = v_total_objects THEN
        RAISE NOTICE '🎉 SUCCESS: All autonumber fields are now properly configured!';
    ELSE
        RAISE NOTICE '⚠️  WARNING: Some objects still need manual attention';
    END IF;
END $$;

-- 6. Log successful migration
DO $$
BEGIN
    RAISE NOTICE '🚀 Migration 078: Autonumber column fix completed successfully!';
    RAISE NOTICE '✅ Added missing autonumber columns to physical tables';
    RAISE NOTICE '✅ Created autonumber sequences for proper numbering';
    RAISE NOTICE '✅ Created autonumber triggers for automatic value generation';
    RAISE NOTICE '🔍 Run the verification section above to check results';
END $$;
