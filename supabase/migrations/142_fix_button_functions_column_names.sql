-- Migration: 142_fix_button_functions_column_names.sql
-- Fix button management functions to use correct column names

-- Drop existing functions
DROP FUNCTION IF EXISTS public.get_object_buttons(UUID, UUID);
DROP FUNCTION IF EXISTS public.create_object_button(UUID, JSONB);
DROP FUNCTION IF EXISTS public.update_object_button(UUID, JSONB);
DROP FUNCTION IF EXISTS public.delete_object_button(UUID, UUID);

-- Function to get buttons for an object
CREATE OR REPLACE FUNCTION public.get_object_buttons(p_object_id UUID, p_tenant_id UUID)
RETURNS TABLE(
  id UUID,
  name TEXT,
  api_name TEXT,
  button_type TEXT,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant, public
AS $$
BEGIN
  -- Verify tenant ownership of the object
  IF NOT EXISTS (
    SELECT 1 FROM tenant.objects o
    WHERE o.id = p_object_id AND o.tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Object not found or access denied';
  END IF;

  RETURN QUERY
  SELECT 
    b.id,
    b.name,
    b.name as api_name, -- Use name as api_name since api_name__a doesn't exist
    b.button_type__a,
    b.is_active,
    b.created_at,
    b.updated_at
  FROM tenant.button__a b
  WHERE b.tenant_id = p_tenant_id
  ORDER BY b.created_at;
END;
$$;

-- Function to create a new button
CREATE OR REPLACE FUNCTION public.create_object_button(p_object_id UUID, p_button_data JSONB)
RETURNS TABLE(
  id UUID,
  name TEXT,
  api_name TEXT,
  button_type TEXT,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant, public
AS $$
DECLARE
  _tenant_id UUID;
  _button_id UUID;
BEGIN
  -- Get tenant_id from JWT
  _tenant_id := (auth.jwt() ->> 'tenant_id')::UUID;
  
  -- Verify tenant ownership of the object
  IF NOT EXISTS (
    SELECT 1 FROM tenant.objects o
    WHERE o.id = p_object_id AND o.tenant_id = _tenant_id
  ) THEN
    RAISE EXCEPTION 'Object not found or access denied';
  END IF;

  -- Validate required fields
  IF NOT (p_button_data ? 'name' AND p_button_data ? 'api_name' AND p_button_data ? 'button_type') THEN
    RAISE EXCEPTION 'Missing required fields: name, api_name, button_type';
  END IF;

  -- Validate button_type
  IF NOT (p_button_data ->> 'button_type' IN ('object', 'custom')) THEN
    RAISE EXCEPTION 'Invalid button_type: must be object or custom';
  END IF;

  -- Insert the button
  INSERT INTO tenant.button__a (
    tenant_id,
    name,
    button_type__a,
    is_active,
    object_id
  ) VALUES (
    _tenant_id,
    p_button_data ->> 'name',
    p_button_data ->> 'button_type',
    COALESCE((p_button_data ->> 'is_active')::BOOLEAN, true),
    p_object_id
  ) RETURNING id INTO _button_id;

  -- Return the created button
  RETURN QUERY
  SELECT 
    b.id,
    b.name,
    b.name as api_name,
    b.button_type__a,
    b.is_active,
    b.created_at,
    b.updated_at
  FROM tenant.button__a b
  WHERE b.id = _button_id;
END;
$$;

-- Function to update a button
CREATE OR REPLACE FUNCTION public.update_object_button(p_button_id UUID, p_button_data JSONB)
RETURNS TABLE(
  id UUID,
  name TEXT,
  api_name TEXT,
  button_type TEXT,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant, public
AS $$
DECLARE
  _tenant_id UUID;
BEGIN
  -- Get tenant_id from JWT
  _tenant_id := (auth.jwt() ->> 'tenant_id')::UUID;
  
  -- Verify tenant ownership of the button
  IF NOT EXISTS (
    SELECT 1 FROM tenant.button__a b
    WHERE b.id = p_button_id AND b.tenant_id = _tenant_id
  ) THEN
    RAISE EXCEPTION 'Button not found or access denied';
  END IF;

  -- Update the button
  UPDATE tenant.button__a SET
    name = COALESCE(p_button_data ->> 'name', name),
    button_type__a = COALESCE(p_button_data ->> 'button_type', button_type__a),
    is_active = COALESCE((p_button_data ->> 'is_active')::BOOLEAN, is_active),
    updated_at = NOW()
  WHERE id = p_button_id;

  -- Return the updated button
  RETURN QUERY
  SELECT 
    b.id,
    b.name,
    b.name as api_name,
    b.button_type__a,
    b.is_active,
    b.created_at,
    b.updated_at
  FROM tenant.button__a b
  WHERE b.id = p_button_id;
END;
$$;

-- Function to delete a button
CREATE OR REPLACE FUNCTION public.delete_object_button(p_button_id UUID, p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant, public
AS $$
DECLARE
  _deleted_count INTEGER;
BEGIN
  -- Verify tenant ownership of the button
  IF NOT EXISTS (
    SELECT 1 FROM tenant.button__a b
    WHERE b.id = p_button_id AND b.tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Button not found or access denied';
  END IF;

  -- Delete the button
  DELETE FROM tenant.button__a 
  WHERE id = p_button_id AND tenant_id = p_tenant_id;
  
  GET DIAGNOSTICS _deleted_count = ROW_COUNT;
  
  RETURN _deleted_count > 0;
END;
$$;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE '✅ Migration 142 completed: Fixed button functions to use correct column names';
END $$;


