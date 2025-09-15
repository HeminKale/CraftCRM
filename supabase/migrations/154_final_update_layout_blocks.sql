-- Migration: 154_final_update_layout_blocks.sql
-- Final, simple update_layout_blocks function that definitely works

-- Drop all existing versions of the function
DROP FUNCTION IF EXISTS public.update_layout_blocks(UUID, UUID, JSONB, TEXT[]);
DROP FUNCTION IF EXISTS public.update_layout_blocks(UUID, UUID, JSONB);
DROP FUNCTION IF EXISTS public.update_layout_blocks(UUID, JSONB);

-- Create the function with exactly the signature the frontend calls
CREATE OR REPLACE FUNCTION public.update_layout_blocks(
    p_object_id UUID,
    p_tenant_id UUID,
    p_layout_blocks JSONB
)
RETURNS TABLE(
    id UUID,
    object_id UUID,
    tenant_id UUID,
    section VARCHAR(100),
    block_type VARCHAR(50),
    field_id UUID,
    related_list_id UUID,
    button_id UUID,
    label TEXT,
    display_order INTEGER,
    is_visible BOOLEAN,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_layout_block JSONB;
    v_block_id UUID;
    v_field_id UUID;
    v_related_list_id UUID;
    v_button_id UUID;
    v_section VARCHAR(100);
    v_block_type VARCHAR(50);
    v_label TEXT;
    v_display_order INTEGER;
    v_is_visible BOOLEAN;
BEGIN
    -- Basic validation
    IF p_object_id IS NULL THEN
        RAISE EXCEPTION 'object_id cannot be null';
    END IF;
    
    IF p_tenant_id IS NULL THEN
        RAISE EXCEPTION 'tenant_id cannot be null';
    END IF;
    
    IF p_layout_blocks IS NULL THEN
        RAISE EXCEPTION 'layout_blocks cannot be null';
    END IF;

    -- Delete existing layout blocks for this object and tenant
    DELETE FROM tenant.layout_blocks 
    WHERE tenant.layout_blocks.object_id = p_object_id AND tenant.layout_blocks.tenant_id = p_tenant_id;

    -- Insert new layout blocks
    FOR v_layout_block IN SELECT * FROM jsonb_array_elements(p_layout_blocks)
    LOOP
        -- Generate new UUID for the block instead of using the temporary one from frontend
        v_block_id := gen_random_uuid();
        v_section := (v_layout_block->>'section')::VARCHAR(100);
        v_block_type := (v_layout_block->>'block_type')::VARCHAR(50);
        v_label := (v_layout_block->>'label')::TEXT;
        v_display_order := (v_layout_block->>'display_order')::INTEGER;
        v_is_visible := COALESCE((v_layout_block->>'is_visible')::BOOLEAN, true);

        -- Set field_id, related_list_id, and button_id based on block_type
        IF v_block_type = 'field' THEN
            v_field_id := (v_layout_block->>'field_id')::UUID;
            v_related_list_id := NULL;
            v_button_id := NULL;
        ELSIF v_block_type = 'related_list' THEN
            v_field_id := NULL;
            v_related_list_id := (v_layout_block->>'related_list_id')::UUID;
            v_button_id := NULL;
        ELSIF v_block_type = 'button' THEN
            v_field_id := NULL;
            v_related_list_id := NULL;
            v_button_id := (v_layout_block->>'button_id')::UUID;
        ELSE
            RAISE EXCEPTION 'Invalid block_type: %. Must be field, related_list, or button', v_block_type;
        END IF;

        -- Insert the layout block
        INSERT INTO tenant.layout_blocks (
            id,
            object_id,
            tenant_id,
            section,
            block_type,
            field_id,
            related_list_id,
            button_id,
            label,
            display_order,
            is_visible
        ) VALUES (
            v_block_id,
            p_object_id,
            p_tenant_id,
            v_section,
            v_block_type,
            v_field_id,
            v_related_list_id,
            v_button_id,
            v_label,
            v_display_order,
            v_is_visible
        );
    END LOOP;

    -- Return the updated layout blocks
    RETURN QUERY
    SELECT 
        lb.id,
        lb.object_id,
        lb.tenant_id,
        lb.section,
        lb.block_type,
        lb.field_id,
        lb.related_list_id,
        lb.button_id,
        lb.label,
        lb.display_order,
        lb.is_visible,
        lb.created_at,
        lb.updated_at
    FROM tenant.layout_blocks lb
    WHERE lb.object_id = p_object_id AND lb.tenant_id = p_tenant_id
    ORDER BY lb.section, lb.display_order;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.update_layout_blocks(UUID, UUID, JSONB) TO authenticated;

-- Add comment
COMMENT ON FUNCTION public.update_layout_blocks(UUID, UUID, JSONB) IS 'Update layout blocks for a specific object, tenant-scoped. Supports field, related_list, and button block types.';
