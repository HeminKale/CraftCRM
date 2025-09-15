-- Migration 067: Add field property update functions
-- This migration provides functions to update field properties other than label
-- since direct table access to tenant.fields via REST API is not allowed

-- Function to update field section
CREATE OR REPLACE FUNCTION tenant.update_field_section(
    _field_id UUID,
    _new_section TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
    _tenant_id UUID;
BEGIN
    -- Get tenant_id from the field itself
    SELECT f.tenant_id INTO _tenant_id
    FROM tenant.fields f
    WHERE f.id = _field_id;
    
    IF _tenant_id IS NULL THEN
        RAISE EXCEPTION 'Field not found';
    END IF;

    -- Update the field section
    UPDATE tenant.fields 
    SET 
        section = _new_section,
        updated_at = now()
    WHERE id = _field_id;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update field width
CREATE OR REPLACE FUNCTION tenant.update_field_width(
    _field_id UUID,
    _new_width TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
    _tenant_id UUID;
BEGIN
    -- Get tenant_id from the field itself
    SELECT f.tenant_id INTO _tenant_id
    FROM tenant.fields f
    WHERE f.id = _field_id;
    
    IF _tenant_id IS NULL THEN
        RAISE EXCEPTION 'Field not found';
    END IF;

    -- Update the field width
    UPDATE tenant.fields 
    SET 
        width = _new_width,
        updated_at = now()
    WHERE id = _field_id;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update field required status
CREATE OR REPLACE FUNCTION tenant.update_field_required(
    _field_id UUID,
    _is_required BOOLEAN
)
RETURNS BOOLEAN AS $$
DECLARE
    _tenant_id UUID;
BEGIN
    -- Get tenant_id from the field itself
    SELECT f.tenant_id INTO _tenant_id
    FROM tenant.fields f
    WHERE f.id = _field_id;
    
    IF _tenant_id IS NULL THEN
        RAISE EXCEPTION 'Field not found';
    END IF;

    -- Update the field required status
    UPDATE tenant.fields 
    SET 
        is_required = _is_required,
        updated_at = now()
    WHERE id = _field_id;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update field visibility
CREATE OR REPLACE FUNCTION tenant.update_field_visibility(
    _field_id UUID,
    _is_visible BOOLEAN
)
RETURNS BOOLEAN AS $$
DECLARE
    _tenant_id UUID;
BEGIN
    -- Get tenant_id from the field itself
    SELECT f.tenant_id INTO _tenant_id
    FROM tenant.fields f
    WHERE f.id = _field_id;
    
    IF _tenant_id IS NULL THEN
        RAISE EXCEPTION 'Field not found';
    END IF;

    -- Update the field visibility
    UPDATE tenant.fields 
    SET 
        is_visible = _is_visible,
        updated_at = now()
    WHERE id = _field_id;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update field default value
CREATE OR REPLACE FUNCTION tenant.update_field_default_value(
    _field_id UUID,
    _default_value TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
    _tenant_id UUID;
BEGIN
    -- Get tenant_id from the field itself
    SELECT f.tenant_id INTO _tenant_id
    FROM tenant.fields f
    WHERE f.id = _field_id;
    
    IF _tenant_id IS NULL THEN
        RAISE EXCEPTION 'Field not found';
    END IF;

    -- Update the field default value
    UPDATE tenant.fields 
    SET 
        default_value = _default_value,
        updated_at = now()
    WHERE id = _field_id;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION tenant.update_field_section(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.update_field_width(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.update_field_required(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.update_field_visibility(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.update_field_default_value(UUID, TEXT) TO authenticated;

-- Add comments
COMMENT ON FUNCTION tenant.update_field_section(UUID, TEXT) IS 'Update field section (details, additional, system)';
COMMENT ON FUNCTION tenant.update_field_width(UUID, TEXT) IS 'Update field width (half, full)';
COMMENT ON FUNCTION tenant.update_field_required(UUID, BOOLEAN) IS 'Update field required status';
COMMENT ON FUNCTION tenant.update_field_visibility(UUID, BOOLEAN) IS 'Update field visibility';
COMMENT ON FUNCTION tenant.update_field_default_value(UUID, TEXT) IS 'Update field default value';

-- Verify the functions were created
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.routines 
    WHERE routine_name = 'update_field_section' 
    AND routine_schema = 'tenant'
  ) THEN
    RAISE NOTICE '✅ update_field_section function created successfully';
  ELSE
    RAISE EXCEPTION '❌ update_field_section function creation failed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.routines 
    WHERE routine_name = 'update_field_width' 
    AND routine_schema = 'tenant'
  ) THEN
    RAISE NOTICE '✅ update_field_width function created successfully';
  ELSE
    RAISE EXCEPTION '❌ update_field_width function creation failed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.routines 
    WHERE routine_name = 'update_field_required' 
    AND routine_schema = 'tenant'
  ) THEN
    RAISE NOTICE '✅ update_field_required function created successfully';
  ELSE
    RAISE EXCEPTION '❌ update_field_required function creation failed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.routines 
    WHERE routine_name = 'update_field_visibility' 
    AND routine_schema = 'tenant'
  ) THEN
    RAISE NOTICE '✅ update_field_visibility function created successfully';
  ELSE
    RAISE EXCEPTION '❌ update_field_visibility function creation failed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.routines 
    WHERE routine_name = 'update_field_default_value' 
    AND routine_schema = 'tenant'
  ) THEN
    RAISE NOTICE '✅ update_field_default_value function created successfully';
  ELSE
    RAISE EXCEPTION '❌ update_field_default_value function creation failed';
  END IF;
END $$;
