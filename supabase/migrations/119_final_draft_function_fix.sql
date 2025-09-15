-- Migration 119: Final Draft Function Fix with Correct Column Names
-- Craft App - Use exact column names that exist in tenant.drafts__a table
-- ================================

-- Drop the existing function first
DROP FUNCTION IF EXISTS public.create_tenant_draft(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

-- Recreate the function with EXACT column names from the database
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
BEGIN
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

  -- Create new draft record with EXACT column names from database
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
    p_created_by::UUID,
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
COMMENT ON FUNCTION public.create_tenant_draft IS 'Creates a new draft record with duplicate checking. Uses EXACT column names from tenant.drafts__a table.';
