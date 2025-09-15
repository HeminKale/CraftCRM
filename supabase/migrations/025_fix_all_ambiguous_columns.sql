-- Fix all ambiguous column references in update_layout_blocks function
DROP FUNCTION IF EXISTS public.update_layout_blocks(UUID, UUID, JSONB);

CREATE OR REPLACE FUNCTION public.update_layout_blocks(p_object_id UUID, p_tenant_id UUID, p_layout_blocks JSONB)
RETURNS TABLE(
  id UUID,
  object_id UUID,
  block_type TEXT,
  field_id UUID,
  related_list_id UUID,
  label TEXT,
  section TEXT,
  display_order INTEGER,
  width TEXT,
  is_visible BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant, public
AS $$
DECLARE
  _block JSONB;
  _new_block_id UUID;
BEGIN
  -- Verify tenant ownership of the object
  IF NOT EXISTS (
    SELECT 1 FROM tenant.objects o
    WHERE o.id = p_object_id AND o.tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Object not found or access denied';
  END IF;

  -- Start transaction
  BEGIN
    -- Delete existing layout blocks for this object
    DELETE FROM tenant.layout_blocks 
    WHERE layout_blocks.object_id = p_object_id AND layout_blocks.tenant_id = p_tenant_id;

    -- Insert new layout blocks
    FOR _block IN SELECT * FROM jsonb_array_elements(p_layout_blocks)
    LOOP
      -- Validate block structure
      IF NOT (
        _block ? 'block_type' AND 
        _block ? 'label' AND 
        _block ? 'section' AND 
        _block ? 'display_order'
      ) THEN
        RAISE EXCEPTION 'Invalid block structure: missing required fields';
      END IF;

      -- Validate block_type
      IF NOT (_block ->> 'block_type' IN ('field', 'related_list')) THEN
        RAISE EXCEPTION 'Invalid block_type: must be field or related_list';
      END IF;

      -- Validate width if present
      IF _block ? 'width' AND NOT (_block ->> 'width' IN ('half', 'full')) THEN
        RAISE EXCEPTION 'Invalid width: must be half or full';
      END IF;

      -- For field blocks, validate field_id belongs to this object and tenant
      IF _block ->> 'block_type' = 'field' AND _block ? 'field_id' THEN
        IF NOT EXISTS (
          SELECT 1 FROM tenant.fields f
          WHERE f.id = (_block ->> 'field_id')::UUID 
          AND f.object_id = p_object_id 
          AND f.tenant_id = p_tenant_id
        ) THEN
          RAISE EXCEPTION 'Field not found or does not belong to this object';
        END IF;
      END IF;

      -- Insert the block
      INSERT INTO tenant.layout_blocks (
        tenant_id,
        object_id,
        block_type,
        field_id,
        related_list_id,
        label,
        section,
        display_order,
        width,
        is_visible
      ) VALUES (
        p_tenant_id,
        p_object_id,
        _block ->> 'block_type',
        CASE WHEN _block ->> 'block_type' = 'field' THEN (_block ->> 'field_id')::UUID ELSE NULL END,
        CASE WHEN _block ->> 'block_type' = 'related_list' THEN (_block ->> 'related_list_id')::UUID ELSE NULL END,
        _block ->> 'label',
        _block ->> 'section',
        (_block ->> 'display_order')::INTEGER,
        COALESCE(_block ->> 'width', 'half'),
        COALESCE((_block ->> 'is_visible')::BOOLEAN, true)
      ) RETURNING layout_blocks.id INTO _new_block_id;
    END LOOP;

    -- Return updated layout blocks
    RETURN QUERY
    SELECT 
      lb.id,
      lb.object_id,
      lb.block_type::text,
      lb.field_id,
      lb.related_list_id,
      lb.label,
      lb.section::text,
      lb.display_order,
      lb.width::text,
      lb.is_visible,
      lb.created_at,
      lb.updated_at
    FROM tenant.layout_blocks lb
    WHERE lb.object_id = p_object_id 
    AND lb.tenant_id = p_tenant_id
    ORDER BY lb.section, lb.display_order;

  EXCEPTION
    WHEN OTHERS THEN
      -- Rollback on any error
      RAISE EXCEPTION 'Failed to update layout blocks: %', SQLERRM;
  END;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.update_layout_blocks(UUID, UUID, JSONB) TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION public.update_layout_blocks(UUID, UUID, JSONB) IS 'Update layout blocks for a specific object, with validation and tenant isolation';
