-- Migration 068: Add field property bridge functions
-- This migration creates public schema bridge functions for updating field properties
-- so the frontend can call tenant.update_field_* functions

-- Bridge function for updating field section
CREATE OR REPLACE FUNCTION public.update_field_section(
  p_field_id UUID,
  p_new_section TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Call the tenant schema function
  RETURN tenant.update_field_section(p_field_id, p_new_section);
END;
$$;

-- Bridge function for updating field width
CREATE OR REPLACE FUNCTION public.update_field_width(
  p_field_id UUID,
  p_new_width TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Call the tenant schema function
  RETURN tenant.update_field_width(p_field_id, p_new_width);
END;
$$;

-- Bridge function for updating field required status
CREATE OR REPLACE FUNCTION public.update_field_required(
  p_field_id UUID,
  p_is_required BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Call the tenant schema function
  RETURN tenant.update_field_required(p_field_id, p_is_required);
END;
$$;

-- Bridge function for updating field visibility
CREATE OR REPLACE FUNCTION public.update_field_visibility(
  p_field_id UUID,
  p_is_visible BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Call the tenant schema function
  RETURN tenant.update_field_visibility(p_field_id, p_is_visible);
END;
$$;

-- Bridge function for updating field default value
CREATE OR REPLACE FUNCTION public.update_field_default_value(
  p_field_id UUID,
  p_default_value TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Call the tenant schema function
  RETURN tenant.update_field_default_value(p_field_id, p_default_value);
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.update_field_section(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_field_width(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_field_required(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_field_visibility(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_field_default_value(UUID, TEXT) TO authenticated;

-- Add comments
COMMENT ON FUNCTION public.update_field_section(UUID, TEXT) IS 'Bridge function to update field section';
COMMENT ON FUNCTION public.update_field_width(UUID, TEXT) IS 'Bridge function to update field width';
COMMENT ON FUNCTION public.update_field_required(UUID, BOOLEAN) IS 'Bridge function to update field required status';
COMMENT ON FUNCTION public.update_field_visibility(UUID, BOOLEAN) IS 'Bridge function to update field visibility';
COMMENT ON FUNCTION public.update_field_default_value(UUID, TEXT) IS 'Bridge function to update field default value';

-- Verify the functions were created
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.routines 
    WHERE routine_name = 'update_field_section' 
    AND routine_schema = 'public'
  ) THEN
    RAISE NOTICE '✅ update_field_section bridge function created successfully';
  ELSE
    RAISE EXCEPTION '❌ update_field_section bridge function creation failed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.routines 
    WHERE routine_name = 'update_field_width' 
    AND routine_schema = 'public'
  ) THEN
    RAISE NOTICE '✅ update_field_width bridge function created successfully';
  ELSE
    RAISE EXCEPTION '❌ update_field_width bridge function creation failed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.routines 
    WHERE routine_name = 'update_field_required' 
    AND routine_schema = 'public'
  ) THEN
    RAISE NOTICE '✅ update_field_required bridge function created successfully';
  ELSE
    RAISE EXCEPTION '❌ update_field_required bridge function creation failed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.routines 
    WHERE routine_name = 'update_field_visibility' 
    AND routine_schema = 'public'
  ) THEN
    RAISE NOTICE '✅ update_field_visibility bridge function created successfully';
  ELSE
    RAISE EXCEPTION '❌ update_field_visibility bridge function creation failed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.routines 
    WHERE routine_name = 'update_field_default_value' 
    AND routine_schema = 'public'
  ) THEN
    RAISE NOTICE '✅ update_field_default_value bridge function created successfully';
  ELSE
    RAISE EXCEPTION '❌ update_field_default_value bridge function creation failed';
  END IF;
END $$;
