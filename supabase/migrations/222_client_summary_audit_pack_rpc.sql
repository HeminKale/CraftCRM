-- Migration 222: RPC to append an audit pack entry to client_summary__a

DROP FUNCTION IF EXISTS public.append_audit_pack_entry(UUID, JSONB);
CREATE OR REPLACE FUNCTION public.append_audit_pack_entry(
  p_external_client_id UUID,
  p_entry              JSONB   -- { name, path, bucket, size, mime, uploaded_at }
)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _tenant_id  UUID;
  _summary_id UUID;
BEGIN
  SELECT su.tenant_id INTO _tenant_id FROM system.users su WHERE su.id = auth.uid();

  -- Ensure summary row exists
  SELECT cs.id INTO _summary_id
  FROM tenant.client_summary__a cs
  WHERE cs.external_client_id__a = p_external_client_id AND cs.tenant_id = _tenant_id;

  IF _summary_id IS NULL THEN
    INSERT INTO tenant.client_summary__a (tenant_id, external_client_id__a)
    VALUES (_tenant_id, p_external_client_id)
    RETURNING id INTO _summary_id;
  END IF;

  -- Append the new entry to the JSONB array
  UPDATE tenant.client_summary__a
  SET
    audit_pack__a = COALESCE(audit_pack__a, '[]'::jsonb) || p_entry,
    updated_at    = now()
  WHERE id = _summary_id AND tenant_id = _tenant_id;

  RETURN QUERY SELECT true, 'Audit pack entry saved';
END;
$$;

GRANT EXECUTE ON FUNCTION public.append_audit_pack_entry(UUID, JSONB) TO authenticated;
