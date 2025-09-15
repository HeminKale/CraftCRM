-- Migration 106: Force Cleanup Duplicate Functions
-- Purpose: Aggressively remove ALL duplicate functions using direct DROP statements
-- This is a simpler approach that will definitely work

-- 1. First, let's see what we're dealing with
DO $$
BEGIN
    RAISE NOTICE '🔍 === DIAGNOSING FUNCTION CHAOS ===';
    
    DECLARE
        function_count INTEGER;
    BEGIN
        -- Count all add_field functions
        SELECT COUNT(*) INTO function_count
        FROM information_schema.routines r
        WHERE r.routine_name = 'add_field'
        AND r.routine_schema = 'tenant';
        
        RAISE NOTICE '🔍 Found % add_field functions in tenant schema', function_count;
        
        IF function_count > 1 THEN
            RAISE NOTICE '🚨 MULTIPLE FUNCTIONS DETECTED - CLEANUP NEEDED!';
        ELSE
            RAISE NOTICE '✅ Only one function found - no cleanup needed';
        END IF;
    END;
END $$;

-- 2. FORCE DROP ALL tenant.add_field functions using CASCADE
-- This will remove ALL functions regardless of signature
DO $$
BEGIN
    RAISE NOTICE '🧹 === FORCE CLEANUP - DROPPING ALL FUNCTIONS ===';
    
    -- Drop all functions with CASCADE to remove any dependencies
    DROP FUNCTION IF EXISTS tenant.add_field(UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, JSONB, TEXT, INTEGER, BOOLEAN) CASCADE;
    DROP FUNCTION IF EXISTS tenant.add_field(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, JSONB, TEXT, INTEGER, BOOLEAN) CASCADE;
    DROP FUNCTION IF EXISTS tenant.add_field(UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, JSONB, TEXT, INTEGER, BOOLEAN, UUID) CASCADE;
    DROP FUNCTION IF EXISTS tenant.add_field(UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, JSONB, TEXT, INTEGER, BOOLEAN, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT) CASCADE;
    
    RAISE NOTICE '✅ All known function signatures have been dropped with CASCADE';
END $$;

-- 3. DROP ALL public.create_tenant_field functions
DO $$
BEGIN
    RAISE NOTICE '🧹 === CLEANING UP PUBLIC FUNCTIONS ===';
    
    -- Drop all create_tenant_field functions
    DROP FUNCTION IF EXISTS public.create_tenant_field(UUID, TEXT, TEXT, TEXT, UUID, BOOLEAN, BOOLEAN, TEXT, JSONB, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT) CASCADE;
    DROP FUNCTION IF EXISTS public.create_tenant_field(UUID, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, INTEGER, BOOLEAN, INTEGER, BOOLEAN) CASCADE;
    
    RAISE NOTICE '✅ All public.create_tenant_field functions have been dropped';
END $$;

-- 4. Verify cleanup was successful
DO $$
BEGIN
    RAISE NOTICE '🔍 === VERIFYING CLEANUP ===';
    
    DECLARE
        tenant_func_count INTEGER;
        public_func_count INTEGER;
    BEGIN
        -- Count remaining functions
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
        
        IF tenant_func_count > 0 THEN
            RAISE NOTICE '⚠️ Still have % tenant.add_field functions - will force drop all', tenant_func_count;
            
            -- Force drop ALL remaining functions by name only
            EXECUTE 'DROP FUNCTION IF EXISTS tenant.add_field CASCADE';
            RAISE NOTICE '🧹 Force dropped ALL tenant.add_field functions';
        END IF;
        
        IF public_func_count > 0 THEN
            RAISE NOTICE '⚠️ Still have % public.create_tenant_field functions - will force drop all', public_func_count;
            
            -- Force drop ALL remaining functions by name only
            EXECUTE 'DROP FUNCTION IF EXISTS public.create_tenant_field CASCADE';
            RAISE NOTICE '🧹 Force dropped ALL public.create_tenant_field functions';
        END IF;
    END;
END $$;

-- 5. Final verification
DO $$
BEGIN
    RAISE NOTICE '🔍 === FINAL VERIFICATION ===';
    
    DECLARE
        tenant_func_count INTEGER;
        public_func_count INTEGER;
    BEGIN
        -- Final count
        SELECT COUNT(*) INTO tenant_func_count
        FROM information_schema.routines 
        WHERE routine_name = 'add_field' 
        AND routine_schema = 'tenant';
        
        SELECT COUNT(*) INTO public_func_count
        FROM information_schema.routines 
        WHERE routine_name = 'create_tenant_field' 
        AND routine_schema = 'public';
        
        RAISE NOTICE '🔍 Final tenant.add_field count: %', tenant_func_count;
        RAISE NOTICE '🔍 Final public.create_tenant_field count: %', public_func_count;
        
        IF tenant_func_count = 0 AND public_func_count = 0 THEN
            RAISE NOTICE '✅ SUCCESS: All functions have been cleaned up!';
        ELSE
            RAISE EXCEPTION '❌ FAILED: Still have functions after cleanup!';
        END IF;
    END;
END $$;

-- 6. Log successful cleanup
DO $$
BEGIN
    RAISE NOTICE '🚀 Migration 106: Force Cleanup completed successfully!';
    RAISE NOTICE '✅ All duplicate functions have been aggressively removed';
    RAISE NOTICE '✅ Database is now clean and ready for fresh functions';
    RAISE NOTICE '🔮 Next step: Run Migration 105 to create the correct functions';
END $$;

