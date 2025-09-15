-- Migration 100: Add Draft Creation Bridge Function
-- Craft App - Enable frontend to create draft records through public functions
-- ================================

-- Bridge function to create a new draft record with duplicate checking
CREATE OR REPLACE FUNCTION public.create_tenant_draft(
  p_tenant_id UUID,
  p_client_id UUID,
  p_type TEXT,
  p_company_name TEXT,
  p_address TEXT,
  p_iso_standard TEXT,
  p_scope TEXT,
  p_created_by TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_draft_id UUID;
  v_draft_name TEXT;
  v_timestamp TEXT;
  v_existing_draft_id UUID;
  v_result JSON;
BEGIN
  -- Check if tenant exists and user has access
  IF NOT EXISTS (SELECT 1 FROM tenant.tenants WHERE id = p_tenant_id) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Tenant not found or access denied',
      'draft_id', null
    );
  END IF;

  -- Check if client exists
  IF NOT EXISTS (SELECT 1 FROM tenant.clients__a WHERE id = p_client_id AND tenant_id = p_tenant_id) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Client not found',
      'draft_id', null
    );
  END IF;

  -- Generate timestamp for draft name
  v_timestamp := to_char(now(), 'YYYYMMDD_HH24MISS');
  
  -- Generate draft name
  v_draft_name := 'draft_' || 
                  regexp_replace(p_company_name, '[^a-zA-Z0-9]', '_', 'g') || '_' ||
                  regexp_replace(p_iso_standard, '[^a-zA-Z0-9]', '_', 'g') || '_' ||
                  v_timestamp;

  -- Check for existing draft with same parameters
  SELECT id INTO v_existing_draft_id
  FROM tenant.drafts__a
  WHERE tenant_id = p_tenant_id
    AND client__a = p_client_id
    AND type__a = p_type
    AND name = p_company_name
    AND "isoStandard__a" = p_iso_standard
    AND scope__a = p_scope
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

  -- Create new draft record
  INSERT INTO tenant.drafts__a (
    tenant_id,
    client__a,
    type__a,
    name,
    address__a,
    "isoStandard__a",
    scope__a,
    draftName__a,
    status__a,
    createdBy__a,
    createdAt__a,
    updatedAt__a
  ) VALUES (
    p_tenant_id,
    p_client_id,
    p_type,
    p_company_name,
    p_address,
    p_iso_standard,
    p_scope,
    v_draft_name,
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
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.create_tenant_draft(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION public.create_tenant_draft IS 'Creates a new draft record with duplicate checking. Returns existing draft if found with same parameters.';
