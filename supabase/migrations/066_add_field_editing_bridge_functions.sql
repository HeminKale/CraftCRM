-- Migration 066: Add field editing bridge functions
-- This migration creates public schema bridge functions for field editing
-- so the frontend can call tenant.update_field_label and tenant.update_picklist_values

-- Bridge function for updating field label
CREATE OR REPLACE FUNCTION public.update_field_label(
  p_field_id UUID,
  p_new_label TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Call the tenant schema function
  RETURN tenant.update_field_label(p_field_id, p_new_label);
END;
$$;

-- Bridge function for updating picklist values
CREATE OR REPLACE FUNCTION public.update_picklist_values(
  p_field_id UUID,
  p_values TEXT[]
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Call the tenant schema function
  RETURN tenant.update_picklist_values(p_field_id, p_values);
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.update_field_label(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_picklist_values(UUID, TEXT[]) TO authenticated;

-- Add comments
COMMENT ON FUNCTION public.update_field_label(UUID, TEXT) IS 'Bridge function to update field label (display name)';
COMMENT ON FUNCTION public.update_picklist_values(UUID, TEXT[]) IS 'Bridge function to update picklist values with order preservation';

-- Verify the functions were created
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.routines 
    WHERE routine_name = 'update_field_label' 
    AND routine_schema = 'public'
  ) THEN
    RAISE NOTICE '✅ update_field_label bridge function created successfully';
  ELSE
    RAISE EXCEPTION '❌ update_field_label bridge function creation failed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.routines 
    WHERE routine_name = 'update_picklist_values' 
    AND routine_schema = 'public'
  ) THEN
    RAISE NOTICE '✅ update_picklist_values bridge function created successfully';
  ELSE
    RAISE EXCEPTION '❌ update_picklist_values bridge function creation failed';
  END IF;
END $$;
