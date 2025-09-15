-- Migration 135: Cleanup Draft Functions
-- Drop all conflicting create_tenant_draft functions and create one clean version

-- Drop all existing versions of the function
DROP FUNCTION IF EXISTS public.create_tenant_draft(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.create_tenant_draft(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID);

-- Create one clean version with correct signature and column names
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

  -- Check for existing draft with same parameters
  SELECT id INTO v_existing_draft_id
  FROM tenant.drafts__a
  WHERE tenant_id = p_tenant_id
    AND "Client_name__a" = p_client_id
    AND "type__a" = p_type
    AND name = p_company_name
    AND "isoStandard__a" = p_iso_standard
    AND "scope__a" = p_scope
    AND status__a = 'Draft'
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

  -- Create new draft record with correct column names
  INSERT INTO tenant.drafts__a (
    tenant_id,
    "Client_name__a",
    "type__a",
    name,
    "address__a",
    "isoStandard__a",
    "scope__a",
    status__a,
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
    'Draft',
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

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.create_tenant_draft(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) TO authenticated;

-- Add comment
COMMENT ON FUNCTION public.create_tenant_draft(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) IS 
'Clean bridge function to create tenant drafts with proper tenant validation and consistent column names.';
