-- Migration 012: Ensure all RPC functions exist for Object Manager functionality
-- This migration should be run when setting up a new database or after schema changes

-- Check current function status (for debugging)
DO $$
DECLARE
    func_name TEXT;
    func_status TEXT;
BEGIN
    RAISE NOTICE 'Checking RPC function status...';
    
    FOR func_name IN SELECT unnest(ARRAY['get_tenant_objects', 'get_tenant_fields', 'create_tenant_object', 'create_tenant_field', 'update_tenant_object'])
    LOOP
        IF EXISTS (
            SELECT 1 FROM pg_proc 
            WHERE proname = func_name 
            AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
        ) THEN
            func_status := 'EXISTS';
        ELSE
            func_status := 'MISSING';
        END IF;
        
        RAISE NOTICE 'Function %: %', func_name, func_status;
    END LOOP;
END $$;

-- Drop and recreate all functions to ensure they're up to date
-- get_tenant_objects
DROP FUNCTION IF EXISTS public.get_tenant_objects(UUID);
CREATE OR REPLACE FUNCTION public.get_tenant_objects(p_tenant_id UUID)
RETURNS TABLE(
  id UUID,
  name TEXT,
  label TEXT,
  description TEXT,
  is_active BOOLEAN,
  is_system_object BOOLEAN,
  tenant_id UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    o.id,
    o.name::text,
    o.label::text,
    o.description::text,
    o.is_active,
    o.is_system_object,
    o.tenant_id,
    o.created_at,
    o.updated_at
  FROM tenant.objects o
  WHERE o.tenant_id = p_tenant_id
  ORDER BY o.created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_tenant_objects(UUID) TO authenticated;

-- get_tenant_fields
DROP FUNCTION IF EXISTS public.get_tenant_fields(UUID, UUID);
CREATE OR REPLACE FUNCTION public.get_tenant_fields(p_object_id UUID, p_tenant_id UUID)
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
BEGIN
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
  WHERE f.object_id = p_object_id
    AND f.tenant_id = p_tenant_id
  ORDER BY f.display_order;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_tenant_fields(UUID, UUID) TO authenticated;

-- create_tenant_object
DROP FUNCTION IF EXISTS public.create_tenant_object(TEXT, TEXT, UUID, TEXT, BOOLEAN);
CREATE OR REPLACE FUNCTION public.create_tenant_object(
  p_name TEXT,
  p_label TEXT,
  p_tenant_id UUID,
  p_description TEXT DEFAULT '',
  p_is_system_object BOOLEAN DEFAULT FALSE
)
RETURNS TABLE(
  id UUID,
  name TEXT,
  label TEXT,
  description TEXT,
  is_active BOOLEAN,
  is_system_object BOOLEAN,
  tenant_id UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_object_id UUID;
BEGIN
  -- Ensure name ends with __a for custom objects
  IF NOT p_is_system_object AND NOT p_name LIKE '%__a' THEN
    p_name := p_name || '__a';
  END IF;

  INSERT INTO tenant.objects (name, label, description, is_active, is_system_object, tenant_id)
  VALUES (p_name, p_label, p_description, TRUE, p_is_system_object, p_tenant_id)
  RETURNING id INTO new_object_id;

  -- Seed system fields for the new object (if function exists)
  BEGIN
    PERFORM public.seed_system_fields(new_object_id, p_tenant_id);
  EXCEPTION WHEN undefined_function THEN
    -- Function doesn't exist, skip seeding
    NULL;
  END;

  RETURN QUERY
  SELECT 
    o.id,
    o.name::text,
    o.label::text,
    o.description::text,
    o.is_active,
    o.is_system_object,
    o.tenant_id,
    o.created_at,
    o.updated_at
  FROM tenant.objects o
  WHERE o.id = new_object_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_tenant_object(TEXT, TEXT, UUID, TEXT, BOOLEAN) TO authenticated;

-- create_tenant_field
DROP FUNCTION IF EXISTS public.create_tenant_field(UUID, TEXT, TEXT, TEXT, UUID, BOOLEAN, BOOLEAN, TEXT, JSONB, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.create_tenant_field(
  p_object_id UUID,
  p_name TEXT,
  p_label TEXT,
  p_type TEXT,
  p_tenant_id UUID,
  p_is_required BOOLEAN DEFAULT FALSE,
  p_is_nullable BOOLEAN DEFAULT TRUE,
  p_default_value TEXT DEFAULT NULL,
  p_validation_rules JSONB DEFAULT '[]'::jsonb,
  p_display_order INTEGER DEFAULT 0,
  p_section TEXT DEFAULT 'details',
  p_width TEXT DEFAULT 'half',
  p_is_visible BOOLEAN DEFAULT TRUE,
  p_is_system_field BOOLEAN DEFAULT FALSE,
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
  new_field_id UUID;
BEGIN
  -- Ensure field name ends with __a for custom fields
  IF NOT p_is_system_field AND NOT p_name LIKE '%__a' THEN
    p_name := p_name || '__a';
  END IF;

  INSERT INTO tenant.fields (
    object_id, name, label, type, tenant_id, is_required, is_nullable, 
    default_value, validation_rules, display_order, section, width, 
    is_visible, is_system_field, reference_table, reference_display_field
  )
  VALUES (
    p_object_id, p_name, p_label, p_type, p_tenant_id, p_is_required, p_is_nullable,
    p_default_value, p_validation_rules, p_display_order, p_section, p_width,
    p_is_visible, p_is_system_field, p_reference_table, p_reference_display_field
  )
  RETURNING id INTO new_field_id;

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
  WHERE f.id = new_field_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_tenant_field(UUID, TEXT, TEXT, TEXT, UUID, BOOLEAN, BOOLEAN, TEXT, JSONB, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT) TO authenticated;

-- update_tenant_object
DROP FUNCTION IF EXISTS public.update_tenant_object(UUID, UUID, TEXT, TEXT, BOOLEAN);
CREATE OR REPLACE FUNCTION public.update_tenant_object(
  p_object_id UUID,
  p_tenant_id UUID,
  p_label TEXT,
  p_description TEXT,
  p_is_active BOOLEAN
)
RETURNS TABLE(
  id UUID,
  name TEXT,
  label TEXT,
  description TEXT,
  is_active BOOLEAN,
  is_system_object BOOLEAN,
  tenant_id UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE tenant.objects 
  SET 
    label = p_label,
    description = p_description,
    is_active = p_is_active,
    updated_at = NOW()
  WHERE id = p_object_id AND tenant_id = p_tenant_id;

  RETURN QUERY
  SELECT 
    o.id,
    o.name::text,
    o.label::text,
    o.description::text,
    o.is_active,
    o.is_system_object,
    o.tenant_id,
    o.created_at,
    o.updated_at
  FROM tenant.objects o
  WHERE o.id = p_object_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_tenant_object(UUID, UUID, TEXT, TEXT, BOOLEAN) TO authenticated;

-- Verify all functions were created successfully
DO $$
DECLARE
    func_name TEXT;
    func_status TEXT;
    missing_funcs TEXT[] := ARRAY[]::TEXT[];
BEGIN
    RAISE NOTICE 'Verifying RPC functions after creation...';
    
    FOR func_name IN SELECT unnest(ARRAY['get_tenant_objects', 'get_tenant_fields', 'create_tenant_object', 'create_tenant_field', 'update_tenant_object'])
    LOOP
        IF EXISTS (
            SELECT 1 FROM pg_proc 
            WHERE proname = func_name 
            AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
        ) THEN
            func_status := 'EXISTS';
            RAISE NOTICE '✅ Function %: %', func_name, func_status;
        ELSE
            func_status := 'MISSING';
            missing_funcs := array_append(missing_funcs, func_name);
            RAISE NOTICE '❌ Function %: %', func_name, func_status;
        END IF;
    END LOOP;
    
    IF array_length(missing_funcs, 1) > 0 THEN
        RAISE EXCEPTION 'Migration failed: Missing functions: %', array_to_string(missing_funcs, ', ');
    ELSE
        RAISE NOTICE '✅ All RPC functions created successfully!';
    END IF;
END $$;
