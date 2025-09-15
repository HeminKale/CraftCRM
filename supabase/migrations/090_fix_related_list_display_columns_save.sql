-- Migration: 090_fix_related_list_display_columns_save.sql
-- Fix related list display_columns saving and add validation

-- The issue is that the frontend ObjectLayoutEditor.tsx needs to save display_columns
-- to the related_list_metadata table when saving layout blocks.
-- This migration adds a helper function to ensure data consistency.

-- Create a function to update related list display columns
CREATE OR REPLACE FUNCTION update_related_list_display_columns(
  p_related_list_id UUID,
  p_display_columns JSONB,
  p_tenant_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
  -- Update the related_list_metadata table with the new display_columns
  UPDATE tenant.related_list_metadata 
  SET 
    display_columns = COALESCE(p_display_columns, '[]'::jsonb),
    updated_at = NOW()
  WHERE id = p_related_list_id 
  AND tenant_id = p_tenant_id;
  
  -- Return true if update was successful
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION update_related_list_display_columns(UUID, JSONB, UUID) TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION update_related_list_display_columns(UUID, JSONB, UUID) IS 'Update display_columns for a related list in related_list_metadata table';

-- Create a function to get related list display columns for validation
CREATE OR REPLACE FUNCTION get_related_list_display_columns(
  p_related_list_id UUID,
  p_tenant_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_display_columns JSONB;
BEGIN
  -- Get the display_columns from related_list_metadata
  SELECT display_columns INTO v_display_columns
  FROM tenant.related_list_metadata 
  WHERE id = p_related_list_id 
  AND tenant_id = p_tenant_id;
  
  RETURN COALESCE(v_display_columns, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_related_list_display_columns(UUID, UUID) TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION get_related_list_display_columns(UUID, UUID) IS 'Get display_columns for a related list from related_list_metadata table';
