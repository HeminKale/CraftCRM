-- Migration: Fix seed_system_fields function reference
-- This fixes the wrong function reference that was causing trigger creation failures
-- Date: 2025-01-17
-- Issue: Function was calling tenant.set_tenant_object_value() instead of tenant.set_autonumber_value()

-- Drop the existing function
DROP FUNCTION IF EXISTS public.seed_system_fields(UUID, UUID);

-- Create the corrected function
CREATE OR REPLACE FUNCTION public.seed_system_fields(
    p_object_id UUID,
    p_tenant_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant, public
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
        
        -- Create autonumber sequence with conflict handling
        INSERT INTO tenant.autonumber_sequences (
            object_id, tenant_id, field_name, current_value, start_value
        ) VALUES (
            p_object_id, p_tenant_id, 'autonumber', 0, 1
        ) ON CONFLICT (object_id, field_name, tenant_id) 
        DO UPDATE SET
            current_value = EXCLUDED.current_value,
            start_value = EXCLUDED.start_value,
            updated_at = now();
        
        -- FIXED: Create autonumber trigger with CORRECT function reference and existence check
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.triggers 
            WHERE trigger_name = format('set_autonumber_%s_autonumber', v_table_name)
            AND event_object_table = v_table_name
            AND trigger_schema = 'tenant'
        ) THEN
            EXECUTE format('
                CREATE TRIGGER set_autonumber_%I_autonumber
                BEFORE INSERT ON tenant.%I
                FOR EACH ROW EXECUTE FUNCTION tenant.set_autonumber_value(''autonumber'')',
                v_table_name, v_table_name
            );
            RAISE NOTICE '✅ Created autonumber trigger for table %', v_table_name;
        ELSE
            RAISE NOTICE 'ℹ️ Autonumber trigger already exists for table %, skipping creation', v_table_name;
        END IF;
        
        RAISE NOTICE '✅ Created autonumber field metadata, sequence, and trigger';
    ELSE
        RAISE NOTICE 'ℹ️ Autonumber field already exists, skipping';
    END IF;
    
    RAISE NOTICE '🎉 SUCCESS: All system field metadata created for object % (table: tenant.%)', p_object_id, v_table_name;
    RAISE NOTICE '🔢 Physical columns already exist from create_tenant_object, only metadata was added';
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.seed_system_fields(UUID, UUID) TO authenticated;

-- Verify the function was created correctly
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc 
    WHERE proname = 'seed_system_fields' 
    AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  ) THEN
    RAISE NOTICE '✅ seed_system_fields function updated successfully with correct function reference';
  ELSE
    RAISE EXCEPTION '❌ seed_system_fields function update failed';
  END IF;
END $$;
