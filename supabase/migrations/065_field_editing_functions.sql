-- Migration 065: Field editing functions
-- This migration provides functions to edit field labels and picklist values
-- while maintaining data integrity and display order

-- Function to update field label
CREATE OR REPLACE FUNCTION tenant.update_field_label(
    _field_id UUID,
    _new_label TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
    _tenant_id UUID;
    _object_id UUID;
BEGIN
    -- Get tenant_id from the field itself (no JWT needed)
    SELECT f.tenant_id, f.object_id INTO _tenant_id, _object_id
    FROM tenant.fields f
    WHERE f.id = _field_id;
    
    IF _tenant_id IS NULL THEN
        RAISE EXCEPTION 'Field not found';
    END IF;

    -- Update the field label
    UPDATE tenant.fields 
    SET 
        label = _new_label,
        updated_at = now()
    WHERE id = _field_id;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update picklist values with order preservation
CREATE OR REPLACE FUNCTION tenant.update_picklist_values(
    _field_id UUID,
    _values TEXT[]  -- Array of strings, one per line
)
RETURNS BOOLEAN AS $$
DECLARE
    _tenant_id UUID;
    _object_id UUID;
    _value TEXT;
    _display_order INTEGER;
BEGIN
    -- Get tenant_id from the field itself (no JWT needed)
    SELECT f.tenant_id, f.object_id INTO _tenant_id, _object_id
    FROM tenant.fields f
    WHERE f.id = _field_id;
    
    IF _tenant_id IS NULL THEN
        RAISE EXCEPTION 'Field not found';
    END IF;

    -- Verify this is a picklist field
    IF NOT EXISTS (
        SELECT 1 FROM tenant.fields 
        WHERE id = _field_id AND type = 'picklist'
    ) THEN
        RAISE EXCEPTION 'Field is not a picklist field';
    END IF;

    -- Delete existing picklist values
    DELETE FROM tenant.picklist_values 
    WHERE field_id = _field_id;

    -- Insert new picklist values with order preservation
    _display_order := 1;
    FOREACH _value IN ARRAY _values
    LOOP
        -- Skip empty values
        IF _value IS NOT NULL AND trim(_value) != '' THEN
            INSERT INTO tenant.picklist_values (
                tenant_id, 
                field_id, 
                value, 
                label, 
                display_order
            ) VALUES (
                _tenant_id,
                _field_id,
                trim(_value),
                trim(_value),  -- Use value as label for simplicity
                _display_order
            );
            _display_order := _display_order + 1;
        END IF;
    END LOOP;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get field details for editing (including picklist values)
CREATE OR REPLACE FUNCTION tenant.get_field_for_editing(
    _field_id UUID
)
RETURNS TABLE(
    id UUID,
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
    object_id UUID,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    picklist_values TEXT[]  -- Array of picklist values in order
) AS $$
DECLARE
    _tenant_id UUID;
BEGIN
    -- Get tenant_id from the field itself (no JWT needed)
    SELECT f.tenant_id INTO _tenant_id
    FROM tenant.fields f
    WHERE f.id = _field_id;
    
    IF _tenant_id IS NULL THEN
        RAISE EXCEPTION 'Field not found';
    END IF;

    -- Return field details with picklist values if applicable
    RETURN QUERY
    SELECT 
        f.id,
        f.name,
        f.label,
        f.type,
        f.is_required,
        f.is_nullable,
        f.default_value,
        f.validation_rules,
        f.display_order,
        f.section,
        f.width,
        f.is_visible,
        f.is_system_field,
        f.reference_table,
        f.reference_display_field,
        f.tenant_id,
        f.object_id,
        f.created_at,
        f.updated_at,
        CASE 
            WHEN f.type = 'picklist' THEN (
                SELECT array_agg(pv.value ORDER BY pv.display_order)
                FROM tenant.picklist_values pv
                WHERE pv.field_id = f.id
            )
            ELSE NULL
        END as picklist_values
    FROM tenant.fields f
    WHERE f.id = _field_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION tenant.update_field_label(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.update_picklist_values(UUID, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant.get_field_for_editing(UUID) TO authenticated;

-- Add comments
COMMENT ON FUNCTION tenant.update_field_label(UUID, TEXT) IS 'Update field label (display name)';
COMMENT ON FUNCTION tenant.update_picklist_values(UUID, TEXT[]) IS 'Update picklist values with order preservation';
COMMENT ON FUNCTION tenant.get_field_for_editing(UUID) IS 'Get field details for editing modal';

-- Verify the functions were created
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.routines 
        WHERE routine_name = 'update_field_label' 
        AND routine_schema = 'tenant'
    ) THEN
        RAISE NOTICE '✅ update_field_label function created successfully';
    ELSE
        RAISE EXCEPTION '❌ update_field_label function creation failed';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.routines 
        WHERE routine_name = 'update_picklist_values' 
        AND routine_schema = 'tenant'
    ) THEN
        RAISE NOTICE '✅ update_picklist_values function created successfully';
    ELSE
        RAISE EXCEPTION '❌ update_picklist_values function creation failed';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.routines 
        WHERE routine_name = 'get_field_for_editing' 
        AND routine_schema = 'tenant'
    ) THEN
        RAISE NOTICE '✅ get_field_for_editing function created successfully';
    ELSE
        RAISE EXCEPTION '❌ get_field_for_editing function creation failed';
    END IF;
END $$;