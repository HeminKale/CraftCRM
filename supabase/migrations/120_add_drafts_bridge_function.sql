-- Migration 120: Add Drafts Bridge Function
-- Craft App - Bridge function to access tenant.drafts__a table
-- ================================

-- Drop the existing function first (if it exists)
DROP FUNCTION IF EXISTS public.get_tenant_draft_for_client(UUID, UUID);

-- Create bridge function to get drafts for a specific client and tenant
CREATE OR REPLACE FUNCTION public.get_tenant_draft_for_client(
  p_tenant_id UUID,
  p_client_id UUID
)
RETURNS TABLE(
  id UUID,
  tenant_id UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  created_by UUID,
  updated_by UUID,
  name TEXT,
  is_active BOOLEAN,
  autonumber BIGINT,
  "Client_name__a" UUID,
  "address__a" TEXT,
  "scope__a" TEXT,
  "isoStandard__a" TEXT,
  "type__a" TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Return draft data for the specific client and tenant
  RETURN QUERY
  SELECT 
    d.id,
    d.tenant_id,
    d.created_at,
    d.updated_at,
    d.created_by,
    d.updated_by,
    d.name,
    d.is_active,
    d.autonumber,
    d."Client_name__a",
    d."address__a",
    d."scope__a",
    d."isoStandard__a",
    d."type__a"
  FROM tenant.drafts__a d
  WHERE d.tenant_id = p_tenant_id
    AND d."Client_name__a" = p_client_id
    AND d.is_active = true
  LIMIT 1;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.get_tenant_draft_for_client(UUID, UUID) TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION public.get_tenant_draft_for_client(UUID, UUID) IS 'Bridge function to access tenant.drafts__a table for a specific client and tenant';
