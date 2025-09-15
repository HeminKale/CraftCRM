-- Migration: 086_add_related_list_layout_generator
CREATE OR REPLACE FUNCTION generate_related_list_layout_blocks(
  p_object_id UUID,
  p_tenant_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_related_list RECORD;
  v_section_name TEXT;
BEGIN
  -- Loop through all related lists for this object
  FOR v_related_list IN 
    SELECT * FROM tenant.related_list_metadata 
    WHERE parent_object_id = p_object_id 
    AND tenant_id = p_tenant_id
    AND is_visible = true
  LOOP
    -- Check if layout block already exists
    IF NOT EXISTS (
      SELECT 1 FROM tenant.layout_blocks 
      WHERE object_id = p_object_id 
      AND related_list_id = v_related_list.id
      AND tenant_id = p_tenant_id
    ) THEN
      -- Insert new layout block for related list
      INSERT INTO tenant.layout_blocks (
        object_id,
        tenant_id,
        block_type,
        related_list_id,
        label,
        section,
        display_order,
        width,
        is_visible,
        created_at,
        updated_at
      ) VALUES (
        p_object_id,
        p_tenant_id,
        'related_list',
        v_related_list.id,
        v_related_list.label,
        COALESCE(v_related_list.section, 'related'),
        v_related_list.display_order,
        'full',
        v_related_list.is_visible,
        NOW(),
        NOW()
      );
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION generate_related_list_layout_blocks TO authenticated;