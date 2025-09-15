-- Migration 107: Step-by-Step Organizational Cleanup (FIXED)
-- Purpose: Clean up all data in the correct dependency order
-- This will give us a fresh start

-- 1. DELETE ALL TABS (most dependent)
DO $$
BEGIN
    RAISE NOTICE '🧹 === STEP 1: DELETING ALL TABS ===';
    
    DECLARE
        tab_count INTEGER;
    BEGIN
        -- Count existing tabs
        SELECT COUNT(*) INTO tab_count FROM tenant.tabs;
        RAISE NOTICE '🔍 Found % tabs to delete', tab_count;
        
        -- Delete all tabs
        DELETE FROM tenant.tabs;
        RAISE NOTICE '✅ Deleted % tabs', tab_count;
    END;
END $$;

-- 2. DELETE ALL APP_TABS (next dependency level)
DO $$
BEGIN
    RAISE NOTICE '🧹 === STEP 2: DELETING ALL APP_TABS ===';
    
    DECLARE
        app_tab_count INTEGER;
    BEGIN
        -- Count existing app_tabs
        SELECT COUNT(*) INTO app_tab_count FROM tenant.app_tabs;
        RAISE NOTICE '🔍 Found % app_tabs to delete', app_tab_count;
        
        -- Delete all app_tabs
        DELETE FROM tenant.app_tabs;
        RAISE NOTICE '✅ Deleted % app_tabs', app_tab_count;
    END;
END $$;

-- 3. DELETE ALL APPS (next dependency level)
DO $$
BEGIN
    RAISE NOTICE '🧹 === STEP 3: DELETING ALL APPS ===';
    
    DECLARE
        app_count INTEGER;
    BEGIN
        -- Count existing apps
        SELECT COUNT(*) INTO app_count FROM tenant.apps;
        RAISE NOTICE '🔍 Found % apps to delete', app_count;
        
        -- Delete all apps
        DELETE FROM tenant.apps;
        RAISE NOTICE '✅ Deleted % apps', app_count;
    END;
END $$;

-- 4. DELETE ALL AUTONUMBER STUFF
DO $$
BEGIN
    RAISE NOTICE '🧹 === STEP 4: DELETING ALL AUTONUMBER DATA ===';
    
    DECLARE
        autonumber_count INTEGER;
        trigger_count INTEGER;
        trigger_record RECORD;
    BEGIN
        -- Count autonumber sequences
        SELECT COUNT(*) INTO autonumber_count FROM tenant.autonumber_sequences;
        RAISE NOTICE '🔍 Found % autonumber sequences to delete', autonumber_count;
        
        -- Delete all autonumber sequences
        DELETE FROM tenant.autonumber_sequences;
        RAISE NOTICE '✅ Deleted % autonumber sequences', autonumber_count;
        
        -- Count and drop autonumber triggers
        SELECT COUNT(*) INTO trigger_count
        FROM information_schema.triggers t
        WHERE t.trigger_name LIKE '%autonumber%'
        AND t.trigger_schema = 'tenant';
        
        RAISE NOTICE '🔍 Found % autonumber triggers to drop', trigger_count;
        
        -- Drop all autonumber triggers properly
        IF trigger_count > 0 THEN
            FOR trigger_record IN
                SELECT t.trigger_name, t.event_object_table
                FROM information_schema.triggers t
                WHERE t.trigger_name LIKE '%autonumber%'
                AND t.trigger_schema = 'tenant'
            LOOP
                EXECUTE format('DROP TRIGGER IF EXISTS %I ON tenant.%I', 
                    trigger_record.trigger_name, trigger_record.event_object_table);
                RAISE NOTICE '✅ Dropped trigger % on table %', 
                    trigger_record.trigger_name, trigger_record.event_object_table;
            END LOOP;
        END IF;
    END;
END $$;

-- 5. DELETE ALL FIELDS
DO $$
BEGIN
    RAISE NOTICE '🧹 === STEP 5: DELETING ALL FIELDS ===';
    
    DECLARE
        field_count INTEGER;
    BEGIN
        -- Count existing fields
        SELECT COUNT(*) INTO field_count FROM tenant.fields;
        RAISE NOTICE '🔍 Found % fields to delete', field_count;
        
        -- Delete all fields
        DELETE FROM tenant.fields;
        RAISE NOTICE '✅ Deleted % fields', field_count;
    END;
END $$;

-- 6. DELETE ALL OBJECTS (base level)
DO $$
BEGIN
    RAISE NOTICE '🧹 === STEP 6: DELETING ALL OBJECTS ===';
    
    DECLARE
        object_count INTEGER;
        object_record RECORD;
    BEGIN
        -- Count existing objects
        SELECT COUNT(*) INTO object_count FROM tenant.objects;
        RAISE NOTICE '🔍 Found % objects to delete', object_count;
        
        -- First, drop all object tables
        FOR object_record IN
            SELECT name FROM tenant.objects
        LOOP
            RAISE NOTICE '🧹 Dropping table: tenant.%', object_record.name;
            EXECUTE format('DROP TABLE IF EXISTS tenant.%I CASCADE', object_record.name);
        END LOOP;
        
        RAISE NOTICE '✅ Dropped all object tables';
        
        -- Now delete all objects
        DELETE FROM tenant.objects;
        RAISE NOTICE '✅ Deleted % objects', object_count;
    END;
END $$;

-- 7. CLEAN UP FUNCTIONS
DO $$
BEGIN
    RAISE NOTICE '🧹 === STEP 7: CLEANING UP FUNCTIONS ===';
    
    -- Drop all add_field functions
    DROP FUNCTION IF EXISTS tenant.add_field CASCADE;
    DROP FUNCTION IF EXISTS public.create_tenant_field CASCADE;
    
    RAISE NOTICE '✅ Dropped all field creation functions';
END $$;

-- 8. FINAL VERIFICATION
DO $$
BEGIN
    RAISE NOTICE '🔍 === FINAL VERIFICATION ===';
    
    DECLARE
        remaining_objects INTEGER;
        remaining_fields INTEGER;
        remaining_apps INTEGER;
        remaining_tabs INTEGER;
    BEGIN
        -- Check what's left
        SELECT COUNT(*) INTO remaining_objects FROM tenant.objects;
        SELECT COUNT(*) INTO remaining_fields FROM tenant.fields;
        SELECT COUNT(*) INTO remaining_apps FROM tenant.apps;
        SELECT COUNT(*) INTO remaining_tabs FROM tenant.tabs;
        
        RAISE NOTICE '🔍 Remaining objects: %', remaining_objects;
        RAISE NOTICE '🔍 Remaining fields: %', remaining_fields;
        RAISE NOTICE '🔍 Remaining apps: %', remaining_apps;
        RAISE NOTICE '🔍 Remaining tabs: %', remaining_tabs;
        
        IF remaining_objects = 0 AND remaining_fields = 0 AND 
           remaining_apps = 0 AND remaining_tabs = 0 THEN
            RAISE NOTICE '🎉 SUCCESS: Complete cleanup achieved!';
        ELSE
            RAISE NOTICE '⚠️ WARNING: Some data still remains';
        END IF;
    END;
END $$;

-- 9. Log successful cleanup
DO $$
BEGIN
    RAISE NOTICE '🚀 Migration 107: Step-by-Step Cleanup completed!';
    RAISE NOTICE '✅ All tabs deleted';
    RAISE NOTICE '✅ All app_tabs deleted';
    RAISE NOTICE '✅ All apps deleted';
    RAISE NOTICE '✅ All autonumber data deleted';
    RAISE NOTICE '✅ All fields deleted';
    RAISE NOTICE '✅ All objects deleted';
    RAISE NOTICE '✅ All functions cleaned up';
    RAISE NOTICE '🔮 Database is now completely clean and ready for fresh start!';
END $$;











































