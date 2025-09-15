-- Migration 019: Ensure picklist value management functions exist
-- This ensures picklist values can be created and retrieved properly

-- Drop existing functions if they exist
DROP FUNCTION IF EXISTS public.add_picklist_values(UUID, JSONB);
DROP FUNCTION IF EXISTS public.get_picklist_values(UUID);

-- Create public bridge function for adding picklist values
CREATE OR REPLACE FUNCTION public.add_picklist_values(
  p_field_id UUID,
  p_values JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant, public
AS $$
DECLARE
  _auth_user_id UUID;
  _tenant_id UUID;
  _value_record JSONB;
  _display_order INTEGER := 1;
BEGIN
  -- Get current user and tenant
  _auth_user_id := auth.uid();
  IF _auth_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  -- Get tenant from user
  SELECT tenant_id INTO _tenant_id
  FROM system.users
  WHERE id = _auth_user_id;

  IF _tenant_id IS NULL THEN
    RAISE EXCEPTION 'User not associated with any tenant';
  END IF;

  -- Verify field belongs to user's tenant
  IF NOT EXISTS (
    SELECT 1 FROM tenant.fields f
    JOIN tenant.objects o ON f.object_id = o.id
    WHERE f.id = p_field_id AND o.tenant_id = _tenant_id
  ) THEN
    RAISE EXCEPTION 'Field not found or access denied';
  END IF;

  -- Clear existing picklist values for this field
  DELETE FROM tenant.picklist_values WHERE field_id = p_field_id;

  -- Insert new picklist values
  FOR _value_record IN SELECT * FROM jsonb_array_elements(p_values)
  LOOP
    INSERT INTO tenant.picklist_values (
      tenant_id, field_id, value, label, display_order
    )
    VALUES (
      _tenant_id, p_field_id, 
      _value_record->>'value', 
      _value_record->>'label', 
      _display_order
    );
    _display_order := _display_order + 1;
  END LOOP;
END;
$$;

-- Create public bridge function for getting picklist values
CREATE OR REPLACE FUNCTION public.get_picklist_values(
  p_field_id UUID
)
RETURNS TABLE(
  id UUID,
  value TEXT,
  label TEXT,
  display_order INTEGER,
  is_active BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant, public
AS $$
DECLARE
  _auth_user_id UUID;
  _tenant_id UUID;
BEGIN
  -- Get current user and tenant
  _auth_user_id := auth.uid();
  IF _auth_user_id IS NULL THEN
    RETURN;
  END IF;

  -- Get tenant from user
  SELECT tenant_id INTO _tenant_id
  FROM system.users
  WHERE id = _auth_user_id;

  IF _tenant_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT pv.id, pv.value, pv.label, pv.display_order, pv.is_active
  FROM tenant.picklist_values pv
  JOIN tenant.fields f ON pv.field_id = f.id
  JOIN tenant.objects o ON f.object_id = o.id
  WHERE pv.field_id = p_field_id 
    AND o.tenant_id = _tenant_id
    AND pv.is_active = true
  ORDER BY pv.display_order;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.add_picklist_values(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_picklist_values(UUID) TO authenticated;

-- Verify functions were created
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc 
    WHERE proname = 'add_picklist_values' 
    AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  ) THEN
    RAISE NOTICE '✅ add_picklist_values function created successfully';
  ELSE
    RAISE EXCEPTION '❌ add_picklist_values function creation failed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc 
    WHERE proname = 'get_picklist_values' 
    AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  ) THEN
    RAISE NOTICE '✅ get_picklist_values function created successfully';
  ELSE
    RAISE EXCEPTION '❌ get_picklist_values function creation failed';
  END IF;
END $$;
