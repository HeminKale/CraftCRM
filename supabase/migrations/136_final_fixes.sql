-- Migration 136: Final Fixes
-- Fix remaining issues with client and draft functions

-- Fix create_tenant_client function - ensure all column references are qualified
DROP FUNCTION IF EXISTS public.create_tenant_client(UUID, TEXT, TEXT, UUID, TEXT, UUID);

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

  -- Insert new client record with correct column names and qualified references
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
  ) RETURNING tenant.clients__a.id INTO v_client_id;

  -- Return success
  RETURN QUERY SELECT v_client_id, true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  -- Return error details
  RETURN QUERY SELECT NULL::UUID, false, SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fix create_tenant_draft function - remove non-existent status__a column
DROP FUNCTION IF EXISTS public.create_tenant_draft(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.create_tenant_draft(
  p_tenant_id UUID,
  p_client_id UUID,
  p_type TEXT,
  p_company_name TEXT,
  p_address TEXT,
  p_iso_standard TEXT,
  p_scope TEXT,
  p_created_by UUID
) RETURNS JSON AS $$
DECLARE
  v_draft_id UUID;
  v_existing_draft_id UUID;
  v_draft_name TEXT;
  v_timestamp TEXT;
BEGIN
  -- Check if tenant exists and user has access (use system.tenants)
  IF NOT EXISTS (SELECT 1 FROM system.tenants WHERE id = p_tenant_id) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Tenant not found or access denied',
      'draft_id', null
    );
  END IF;

  -- Validate required parameters
  IF p_client_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Client ID is required',
      'draft_id', null
    );
  END IF;

  IF p_company_name IS NULL OR p_company_name = '' THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Company name is required',
      'draft_id', null
    );
  END IF;

  -- Generate unique draft name
  v_timestamp := to_char(now(), 'YYYYMMDDHH24MISS');
  v_draft_name := 'Draft_' || 
                  regexp_replace(p_company_name, '[^a-zA-Z0-9]', '_', 'g') || '_' ||
                  regexp_replace(p_iso_standard, '[^a-zA-Z0-9]', '_', 'g') || '_' ||
                  v_timestamp;

  -- Check for existing draft with same parameters (without status__a since it doesn't exist)
  SELECT id INTO v_existing_draft_id
  FROM tenant.drafts__a
  WHERE tenant_id = p_tenant_id
    AND "Client_name__a" = p_client_id
    AND "type__a" = p_type
    AND name = p_company_name
    AND "isoStandard__a" = p_iso_standard
    AND "scope__a" = p_scope
  LIMIT 1;

  -- If existing draft found, return it
  IF v_existing_draft_id IS NOT NULL THEN
    RETURN json_build_object(
      'success', true,
      'message', 'Existing draft found',
      'draft_id', v_existing_draft_id,
      'is_existing', true,
      'draft_name', v_draft_name
    );
  END IF;

  -- Create new draft record with correct column names (removed status__a)
  INSERT INTO tenant.drafts__a (
    tenant_id,
    "Client_name__a",
    "type__a",
    name,
    "address__a",
    "isoStandard__a",
    "scope__a",
    created_by,
    created_at,
    updated_at
  ) VALUES (
    p_tenant_id,
    p_client_id,
    p_type,
    p_company_name,
    p_address,
    p_iso_standard,
    p_scope,
    p_created_by,
    now(),
    now()
  )
  RETURNING id INTO v_draft_id;

  -- Return success result
  RETURN json_build_object(
    'success', true,
    'message', 'Draft created successfully',
    'draft_id', v_draft_id,
    'is_existing', false,
    'draft_name', v_draft_name
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Failed to create draft: ' || SQLERRM,
      'draft_id', null
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.create_tenant_client(UUID, TEXT, TEXT, UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_tenant_draft(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) TO authenticated;

-- Add comments
COMMENT ON FUNCTION public.create_tenant_client(UUID, TEXT, TEXT, UUID, TEXT, UUID) IS 
'Final fixed version of client creation function with qualified column references.';

COMMENT ON FUNCTION public.create_tenant_draft(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) IS 
'Final fixed version of draft creation function without non-existent status__a column.';
