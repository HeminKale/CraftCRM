-- Migration 133: Fix Client Functions - Final Version
-- Fix ambiguous column references and type mismatches

-- Drop existing functions
DROP FUNCTION IF EXISTS public.create_tenant_client(UUID, TEXT, TEXT, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.update_tenant_client(UUID, TEXT, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.get_tenant_channel_partners(UUID);

-- Fix create_tenant_client function with correct column names and UUID type for channel_partner
CREATE OR REPLACE FUNCTION public.create_tenant_client(
  p_tenant_id UUID,
  p_name TEXT,
  p_iso_standard TEXT,
  p_channel_partner UUID,
  p_type TEXT,
  p_created_by UUID
) RETURNS TABLE(
  id UUID,
  success BOOLEAN,
  error TEXT
) AS $$
DECLARE
  v_client_id UUID;
BEGIN
  -- Validate required parameters
  IF p_tenant_id IS NULL THEN
    RETURN QUERY SELECT NULL::UUID, false, 'Tenant ID is required';
    RETURN;
  END IF;
  
  IF p_name IS NULL OR p_name = '' THEN
    RETURN QUERY SELECT NULL::UUID, false, 'Client name is required';
    RETURN;
  END IF;
  
  IF p_created_by IS NULL THEN
    RETURN QUERY SELECT NULL::UUID, false, 'Created by user ID is required';
    RETURN;
  END IF;

  -- Insert new client record with correct column names
  INSERT INTO tenant.clients__a (
    tenant_id,
    name,
    "ISO standard__a",
    "channelPartner__a",
    type__a,
    created_by,
    updated_by,
    is_active
  ) VALUES (
    p_tenant_id,
    p_name,
    COALESCE(p_iso_standard, 'N/A'),
    p_channel_partner,
    COALESCE(p_type, 'new'),
    p_created_by,
    p_created_by,
    true
  ) RETURNING id INTO v_client_id;

  -- Return success
  RETURN QUERY SELECT v_client_id, true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  -- Return error details
  RETURN QUERY SELECT NULL::UUID, false, SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create update_tenant_client function with fixed ambiguous column references
CREATE OR REPLACE FUNCTION public.update_tenant_client(
  p_client_id UUID,
  p_iso_standard TEXT,
  p_channel_partner UUID,
  p_type TEXT,
  p_updated_by UUID
) RETURNS TABLE(
  id UUID,
  success BOOLEAN,
  error TEXT
) AS $$
DECLARE
  v_client_id UUID;
BEGIN
  -- Validate required parameters
  IF p_client_id IS NULL THEN
    RETURN QUERY SELECT NULL::UUID, false, 'Client ID is required';
    RETURN;
  END IF;
  
  IF p_updated_by IS NULL THEN
    RETURN QUERY SELECT NULL::UUID, false, 'Updated by user ID is required';
    RETURN;
  END IF;

  -- Update existing client record with qualified column references
  UPDATE tenant.clients__a SET
    "ISO standard__a" = COALESCE(p_iso_standard, "ISO standard__a"),
    "channelPartner__a" = COALESCE(p_channel_partner, "channelPartner__a"),
    type__a = COALESCE(p_type, type__a),
    updated_by = p_updated_by,
    updated_at = now()
  WHERE tenant.clients__a.id = p_client_id
  RETURNING tenant.clients__a.id INTO v_client_id;

  -- Check if update was successful
  IF v_client_id IS NULL THEN
    RETURN QUERY SELECT NULL::UUID, false, 'Client not found or update failed';
    RETURN;
  END IF;

  -- Return success
  RETURN QUERY SELECT v_client_id, true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  -- Return error details
  RETURN QUERY SELECT NULL::UUID, false, SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create get_tenant_channel_partners function
CREATE OR REPLACE FUNCTION public.get_tenant_channel_partners(p_tenant_id UUID)
RETURNS TABLE(
  id UUID,
  name TEXT,
  country__a TEXT,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Return active channel partners for the specific tenant
  RETURN QUERY
  SELECT 
    cp.id, 
    cp.name, 
    cp."country__a",
    cp.is_active, 
    cp.created_at, 
    cp.updated_at
  FROM tenant.channel_partner__a cp
  WHERE cp.tenant_id = p_tenant_id
    AND cp.is_active = true
  ORDER BY cp.name;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.create_tenant_client(UUID, TEXT, TEXT, UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_tenant_client(UUID, TEXT, UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_channel_partners(UUID) TO authenticated;

-- Add comments
COMMENT ON FUNCTION public.create_tenant_client(UUID, TEXT, TEXT, UUID, TEXT, UUID) IS 
'Bridge function to create tenant clients. Returns client ID on success, error message on failure.';

COMMENT ON FUNCTION public.update_tenant_client(UUID, TEXT, UUID, TEXT, UUID) IS 
'Bridge function to update tenant clients. Returns client ID on success, error message on failure.';

COMMENT ON FUNCTION public.get_tenant_channel_partners(UUID) IS 
'Bridge function to get active channel partners for a specific tenant.';
