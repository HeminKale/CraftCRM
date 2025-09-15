-- Migration: Add bridge function for creating tenant clients
-- This function allows secure creation of client records from the frontend

-- Drop function if it exists to allow recreation
DROP FUNCTION IF EXISTS public.create_tenant_client(UUID, TEXT, TEXT, TEXT, TEXT, UUID);

-- Create the bridge function for creating tenant clients
CREATE OR REPLACE FUNCTION public.create_tenant_client(
  p_tenant_id UUID,
  p_name TEXT,
  p_iso_standard TEXT,
  p_channel_partner TEXT,
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

  -- Insert new client record
  INSERT INTO tenant.clients__a (
    tenant_id,
    name,
    "ISO standard__a",
    channelPartner__a,
    type__a,
    created_by,
    updated_by,
    is_active
  ) VALUES (
    p_tenant_id,
    p_name,
    COALESCE(p_iso_standard, 'N/A'),
    COALESCE(p_channel_partner, 'N/A'),
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

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.create_tenant_client(UUID, TEXT, TEXT, TEXT, TEXT, UUID) TO authenticated;

-- Add comment
COMMENT ON FUNCTION public.create_tenant_client(UUID, TEXT, TEXT, TEXT, TEXT, UUID) IS 
'Bridge function to create tenant clients. Returns client ID on success, error message on failure.';
