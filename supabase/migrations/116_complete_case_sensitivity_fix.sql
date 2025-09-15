-- Migration 116: Complete Case Sensitivity Fix for Clients Function
-- Craft App - Fix ALL case sensitivity issues with camelCase columns
-- ================================

-- Drop the existing function completely
DROP FUNCTION IF EXISTS public.get_tenant_clients(UUID);

-- Recreate the function with ALL case sensitivity issues fixed
CREATE OR REPLACE FUNCTION public.get_tenant_clients(p_tenant_id UUID)
RETURNS TABLE(
  id UUID,
  name TEXT,
  "ISO standard__a" TEXT,
  "channelPartner__a" UUID,
  "originalIssueDate__a" DATE,
  "surveillanceDate__a" DATE,
  "issueDate__a" DATE,
  "recertificationDate__a" DATE,
  "certificateNumber__a" TEXT,
  type__a TEXT,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Use explicit quotes for ALL camelCase columns to preserve case
  RETURN QUERY
  SELECT 
    c.id, 
    c.name, 
    c."ISO standard__a", 
    c."channelPartner__a",
    c."originalIssueDate__a", 
    c."surveillanceDate__a", 
    c."issueDate__a",
    c."recertificationDate__a", 
    c."certificateNumber__a", 
    c.type__a,
    c.is_active, 
    c.created_at, 
    c.updated_at
  FROM tenant.clients__a c
  WHERE c.tenant_id = p_tenant_id
    AND c.is_active = true
  ORDER BY c.name;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.get_tenant_clients(UUID) TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION public.get_tenant_clients IS 'Returns active clients for a specific tenant. ALL case sensitivity issues fixed.';
