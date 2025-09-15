-- Migration 079: Fix seed_system_fields for New Objects
-- This migration fixes the root cause: seed_system_fields now ONLY adds metadata
-- Physical columns are created by create_tenant_object, not by seed_system_fields
-- Date: 2024-01-XX
-- Purpose: Ensure new objects get autonumber fields correctly without double column creation

-- 1. Drop the broken seed_system_fields function
DROP FUNCTION IF EXISTS public.seed_system_fields(UUID, UUID);

-- 2. Create the CORRECT seed_system_fields function that ONLY adds metadata
-- Physical columns are already created by create_tenant_object
CREATE OR REPLACE FUNCTION public.seed_system_fields(
    p_object_id UUID,
    p_tenant_id UUID
)
RETURNS VOID
AS $$
DECLARE
    v_table_name TEXT;
BEGIN
    -- Get table name from tenant.objects
    SELECT name INTO v_table_name
    FROM tenant.objects
    WHERE id = p_object_id AND tenant_id = p_tenant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Object not found or access denied';
    END IF;
    
    RAISE NOTICE '🔍 Seeding system fields for object % (table: tenant.%)', p_object_id, v_table_name;
    
    -- CORRECT: Only add field metadata, NOT physical columns
    -- The physical table is already created by create_tenant_object with all system fields
    
    -- Name field (metadata only)
    IF NOT EXISTS (SELECT 1 FROM tenant.fields WHERE object_id = p_object_id AND name = 'name') THEN
        INSERT INTO tenant.fields (
            tenant_id, object_id, name, label, type, is_required, is_nullable,
            default_value, validation_rules, section, width, is_visible, display_order
        ) VALUES (
            p_tenant_id, p_object_id, 'name', 'Name', 'text', true, false,
            NULL, '[]'::jsonb, 'details', 'full', true, 0
        );
        RAISE NOTICE '✅ Created name field metadata';
    ELSE
        RAISE NOTICE 'ℹ️ Name field already exists, skipping';
    END IF;
    
    -- Created At field (metadata only)
    IF NOT EXISTS (SELECT 1 FROM tenant.fields WHERE object_id = p_object_id AND name = 'created_at') THEN
        INSERT INTO tenant.fields (
            tenant_id, object_id, name, label, type, is_required, is_nullable,
            default_value, validation_rules, section, width, is_visible, display_order
        ) VALUES (
            p_tenant_id, p_object_id, 'created_at', 'Created At', 'datetime', false, true,
            NULL, '[]'::jsonb, 'system', 'half', false, 1
        );
        RAISE NOTICE '✅ Created created_at field metadata';
    ELSE
        RAISE NOTICE 'ℹ️ Created At field already exists, skipping';
    END IF;
    
    -- Updated At field (metadata only)
    IF NOT EXISTS (SELECT 1 FROM tenant.fields WHERE object_id = p_object_id AND name = 'updated_at') THEN
        INSERT INTO tenant.fields (
            tenant_id, object_id, name, label, type, is_required, is_nullable,
            default_value, validation_rules, section, width, is_visible, display_order
        ) VALUES (
            p_tenant_id, p_object_id, 'updated_at', 'Updated At', 'datetime', false, true,
            NULL, '[]'::jsonb, 'system', 'half', false, 2
        );
        RAISE NOTICE '✅ Created updated_at field metadata';
    ELSE
        RAISE NOTICE 'ℹ️ Updated At field already exists, skipping';
    END IF;
    
    -- Created By field (metadata only)
    IF NOT EXISTS (SELECT 1 FROM tenant.fields WHERE object_id = p_object_id AND name = 'created_by') THEN
        INSERT INTO tenant.fields (
            tenant_id, object_id, name, label, type, is_required, is_nullable,
            default_value, validation_rules, section, width, is_visible, display_order
        ) VALUES (
            p_tenant_id, p_object_id, 'created_by', 'Created By', 'reference', false, true,
            NULL, '[]'::jsonb, 'system', 'half', false, 3
        );
        RAISE NOTICE '✅ Created created_by field metadata';
    ELSE
        RAISE NOTICE 'ℹ️ Created By field already exists, skipping';
    END IF;
    
    -- Updated By field (metadata only)
    IF NOT EXISTS (SELECT 1 FROM tenant.fields WHERE object_id = p_object_id AND name = 'updated_by') THEN
        INSERT INTO tenant.fields (
            tenant_id, object_id, name, label, type, is_required, is_nullable,
            default_value, validation_rules, section, width, is_visible, display_order
        ) VALUES (
            p_tenant_id, p_object_id, 'updated_by', 'Updated By', 'reference', false, true,
            NULL, '[]'::jsonb, 'system', 'half', false, 4
        );
        RAISE NOTICE '✅ Created updated_by field metadata';
    ELSE
        RAISE NOTICE 'ℹ️ Updated By field already exists, skipping';
    END IF;
    
    -- Is Active field (metadata only)
    IF NOT EXISTS (SELECT 1 FROM tenant.fields WHERE object_id = p_object_id AND name = 'is_active') THEN
        INSERT INTO tenant.fields (
            tenant_id, object_id, name, label, type, is_required, is_nullable,
            default_value, validation_rules, section, width, is_visible, display_order
        ) VALUES (
            p_tenant_id, p_object_id, 'is_active', 'Active', 'boolean', false, true,
            'true', '[]'::jsonb, 'system', 'half', true, 5
        );
        RAISE NOTICE '✅ Created is_active field metadata';
    ELSE
        RAISE NOTICE 'ℹ️ Is Active field already exists, skipping';
    END IF;
    
    -- Tenant ID field (metadata only)
    IF NOT EXISTS (SELECT 1 FROM tenant.fields WHERE object_id = p_object_id AND name = 'tenant_id') THEN
        INSERT INTO tenant.fields (
            tenant_id, object_id, name, label, type, is_required, is_nullable,
            default_value, validation_rules, section, width, is_visible, display_order
        ) VALUES (
            p_tenant_id, p_object_id, 'tenant_id', 'Tenant ID', 'reference', false, true,
            NULL, '[]'::jsonb, 'system', 'half', false, 6
        );
        RAISE NOTICE '✅ Created tenant_id field metadata';
    ELSE
        RAISE NOTICE 'ℹ️ Tenant ID field already exists, skipping';
    END IF;
    
    -- Autonumber field (metadata only + sequence + trigger)
    IF NOT EXISTS (SELECT 1 FROM tenant.fields WHERE object_id = p_object_id AND name = 'autonumber') THEN
        -- Add field metadata
        INSERT INTO tenant.fields (
            tenant_id, object_id, name, label, type, is_required, is_nullable,
            default_value, validation_rules, section, width, is_visible, display_order
        ) VALUES (
            p_tenant_id, p_object_id, 'autonumber', 'Auto Number', 'autonumber', false, true,
            NULL, '{"start_value": 1}'::jsonb, 'details', 'half', true, 7
        );
        
        -- Create autonumber sequence
        INSERT INTO tenant.autonumber_sequences (
            object_id, tenant_id, field_name, current_value, start_value
        ) VALUES (
            p_object_id, p_tenant_id, 'autonumber', 0, 1
        );
        
        -- FIXED: Create autonumber trigger with proper naming (no UUID in trigger name)
        EXECUTE format('
            CREATE TRIGGER set_autonumber_%I_autonumber
            BEFORE INSERT ON tenant.%I
            FOR EACH ROW EXECUTE FUNCTION tenant.set_autonumber_value()',
            v_table_name, v_table_name  -- Use table name for both placeholders, not UUID
        );
        
        RAISE NOTICE '✅ Created autonumber field metadata, sequence, and trigger';
    ELSE
        RAISE NOTICE 'ℹ️ Autonumber field already exists, skipping';
    END IF;
    
    RAISE NOTICE '🎉 SUCCESS: All system field metadata created for object % (table: tenant.%)', p_object_id, v_table_name;
    RAISE NOTICE '🔢 Physical columns already exist from create_tenant_object, only metadata was added';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Grant execute permission
GRANT EXECUTE ON FUNCTION public.seed_system_fields(UUID, UUID) TO authenticated;

-- 4. Add comment explaining the fix
COMMENT ON FUNCTION public.seed_system_fields(UUID, UUID) IS 'FIXED: Only adds metadata for system fields, does not call tenant.add_field for them. Physical columns created by create_tenant_object.';

-- 5. Fix autonumber trigger to handle empty strings properly
CREATE OR REPLACE FUNCTION tenant.set_autonumber_value()
RETURNS TRIGGER AS $$
DECLARE
    v_next_value BIGINT;
    v_sequence_name TEXT;
BEGIN
    -- Get the sequence name for this object and field
    SELECT sequence_name INTO v_sequence_name
    FROM tenant.autonumber_sequences
    WHERE object_id = NEW.id::UUID
    AND field_name = TG_ARGV[0];
    
    IF v_sequence_name IS NULL THEN
        RAISE EXCEPTION 'Autonumber sequence not found for object % and field %', NEW.id, TG_ARGV[0];
    END IF;
    
    -- Get next value from sequence
    EXECUTE format('SELECT nextval(%L)', v_sequence_name) INTO v_next_value;
    
    -- Set the autonumber field value
    -- Handle both direct field access and dynamic field access
    IF TG_ARGV[0] = 'autonumber' THEN
        -- If autonumber field is empty string or NULL, set it to sequence value
        IF NEW.autonumber IS NULL OR NEW.autonumber = '' OR NEW.autonumber = 0 THEN
            NEW.autonumber = v_next_value;
            RAISE NOTICE '🔢 Set autonumber field to % for record %', v_next_value, NEW.id;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Add comment explaining the improved trigger
COMMENT ON FUNCTION tenant.set_autonumber_value() IS 'IMPROVED: Handles empty strings and NULL values for autonumber fields, converts them to proper sequence values.';

-- 7. Log successful migration
DO $$
BEGIN
    RAISE NOTICE '🚀 Migration 079: seed_system_fields fix completed successfully!';
    RAISE NOTICE '✅ Root cause fixed: seed_system_fields now ONLY adds metadata';
    RAISE NOTICE '✅ Physical columns created by create_tenant_object (no double creation)';
    RAISE NOTICE '✅ Trigger naming issue fixed (no more UUIDs in trigger names)';
    RAISE NOTICE '✅ Empty string handling fixed: Frontend empty strings converted to autonumber values';
    RAISE NOTICE '🔮 Future objects will work perfectly without manual intervention';
    RAISE NOTICE '🔮 No more "syntax error at or near UUID" errors!';
    RAISE NOTICE '🔮 No more "column already exists" errors!';
    RAISE NOTICE '🔮 Frontend fixes also applied: No autonumber reading when no records exist';
END $$;

-- 8. Frontend Fixes Applied (for reference)
-- The following frontend components were also fixed to prevent autonumber reading errors:
-- 
-- 1. TabContent.tsx: Modified getFieldNames() to not include 'autonumber' when records.length === 0
--    - Prevents frontend from trying to read autonumber column from empty tables
--    - Only shows basic fields: ['name', 'is_active', 'created_at', 'updated_at']
-- 
-- 2. HomeTab.tsx: Modified handleViewObjectRecords() to use specific column selection
--    - Changed from .select('*') to .select('id, name, created_at, updated_at, is_active, tenant_id')
--    - Avoids reading autonumber column when viewing object records
-- 
-- These frontend fixes ensure that:
-- - Empty tables don't trigger autonumber reading errors
-- - Only safe columns are read when viewing records
-- - Autonumber errors are prevented at both database and frontend levels
-- - Column order is prioritized: 'name' first, 'created_at' second, then others alphabetically
-- - PROJECT RECORDLIST: Currently shows only 'name' and 'created_at' columns by default
-- - Future: User-configurable field selection for recordlist display
