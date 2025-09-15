-- Migration: 094_create_page_layout_rpc_functions.sql
-- Description: Create RPC functions to fetch page layout and field metadata
-- Date: 2024-01-XX

-- Drop existing functions first (since we're changing return types)
DROP FUNCTION IF EXISTS get_object_page_layout(UUID, UUID);
DROP FUNCTION IF EXISTS get_fields_metadata(UUID[], UUID);

-- Function to get object page layout blocks
CREATE OR REPLACE FUNCTION get_object_page_layout(
  p_object_id UUID,
  p_tenant_id UUID
)
RETURNS TABLE (
  id UUID,
  block_type VARCHAR(50),
  label TEXT,
  field_id UUID,
  section VARCHAR(100),
  display_order INTEGER,
  tenant_id UUID
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    lb.id,
    lb.block_type,
    lb.label,
    lb.field_id,
    lb.section,
    lb.display_order,
    lb.tenant_id
  FROM tenant.layout_blocks lb
  WHERE lb.object_id = p_object_id
    AND lb.tenant_id = p_tenant_id
  ORDER BY lb.display_order ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_object_page_layout(UUID, UUID) TO authenticated;

-- Function to get fields metadata
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
  RAISE NOTICE '✅ Migration 094 completed: Page layout RPC functions created';
  RAISE NOTICE '🔧 Functions: get_object_page_layout, get_fields_metadata';
  RAISE NOTICE '📝 Data types: Using exact database column types (TEXT, VARCHAR)';
END $$;
