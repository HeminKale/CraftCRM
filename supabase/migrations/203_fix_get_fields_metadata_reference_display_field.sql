-- Migration: 203_fix_get_fields_metadata_reference_display_field.sql
-- Description: Fix get_fields_metadata RPC function to include reference_display_field column
-- Date: 2024-01-XX

-- Update the get_fields_metadata function to include reference_display_field
CREATE OR REPLACE FUNCTION get_fields_metadata(
  p_field_ids UUID[],
  p_tenant_id UUID
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  label TEXT,
  type TEXT,
  is_required BOOLEAN,
  reference_table VARCHAR(255),
  reference_display_field VARCHAR(255),
  tenant_id UUID
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    f.id,
    f.name,
    f.label,
    f.type,
    f.is_required,
    f.reference_table,
    f.reference_display_field,
    f.tenant_id
  FROM tenant.fields f
  WHERE f.id = ANY(p_field_ids)
    AND f.tenant_id = p_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_fields_metadata(UUID[], UUID) TO authenticated;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE '✅ Migration 203 completed: get_fields_metadata function updated to include reference_display_field';
  RAISE NOTICE '🔧 Function: get_fields_metadata now returns reference_display_field for reference fields';
  RAISE NOTICE '📝 This should resolve UniversalFieldDisplay warnings about missing reference_display_field';
END $$;
