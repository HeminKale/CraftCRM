-- Migration 008: Add update function and adjust returns for tenant bridge
-- Ensures Object Manager uses only public RPCs for load/create/edit

-- Idempotent: create update function for tenant.objects
CREATE OR REPLACE FUNCTION public.update_tenant_object(
  p_object_id UUID,
  p_tenant_id UUID,
  p_label TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL
)
RETURNS TABLE(
  id UUID,
  name TEXT,
  label TEXT,
  description TEXT,
  is_system_object BOOLEAN,
  is_active BOOLEAN,
  tenant_id UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  updated tenant.objects;
BEGIN
  UPDATE tenant.objects AS o
  SET 
    label = COALESCE(p_label, o.label),
    description = COALESCE(p_description, o.description),
    is_active = COALESCE(p_is_active, o.is_active),
    updated_at = NOW()
  WHERE o.id = p_object_id
    AND o.tenant_id = p_tenant_id
  RETURNING * INTO updated;

  RETURN QUERY
  SELECT updated.id, updated.name, updated.label, updated.description,
         updated.is_system_object, updated.is_active, updated.tenant_id,
         updated.created_at, updated.updated_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_tenant_object(UUID, UUID, TEXT, TEXT, BOOLEAN) TO authenticated;


