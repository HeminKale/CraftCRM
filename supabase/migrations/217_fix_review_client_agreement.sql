-- ================================
-- Migration 217: Fix review_client_agreement
--
-- Live function was setting status = 'Stage_one_plan_Sent' on accept.
-- Correct behaviour: accept → Client_Agreement_Signed + stamp date.
-- ================================

DROP FUNCTION IF EXISTS public.review_client_agreement(UUID, TEXT, TEXT);

CREATE FUNCTION public.review_client_agreement(
  p_record_id UUID,
  p_action    TEXT,
  p_notes     TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_id      UUID;
  _caller_tenant  UUID;
  _caller_role    TEXT;
  _client_user_id UUID;
BEGIN
  _caller_id := auth.uid();

  SELECT su.tenant_id, su.role INTO _caller_tenant, _caller_role
  FROM system.users su WHERE su.id = _caller_id;

  SELECT ec.client_user_id__a INTO _client_user_id
  FROM tenant.external_clients__a ec
  WHERE ec.id = p_record_id AND ec.tenant_id = _caller_tenant;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Record not found';
    RETURN;
  END IF;

  -- Allow: admin OR the linked client user
  IF _caller_role != 'admin' AND _client_user_id != _caller_id THEN
    RETURN QUERY SELECT false, 'Access denied: you are not the linked client for this record';
    RETURN;
  END IF;

  IF p_action = 'accept' THEN
    UPDATE tenant.external_clients__a
    SET
      status__a                         = 'Client_Agreement_Signed',
      "Client_Agreement_Signed_Date__a" = CURRENT_DATE,
      rejection_notes__a                = NULL,
      updated_at                        = NOW()
    WHERE id = p_record_id AND tenant_id = _caller_tenant;

    RETURN QUERY SELECT true, 'Agreement signed — status set to Client Agreement Signed';

  ELSIF p_action = 'reject' THEN
    UPDATE tenant.external_clients__a
    SET
      status__a          = 'Quotation_Received',
      rejection_notes__a = p_notes,
      updated_at         = NOW()
    WHERE id = p_record_id AND tenant_id = _caller_tenant;

    RETURN QUERY SELECT true, 'Agreement rejected — status reverted to Quotation Received';

  ELSE
    RETURN QUERY SELECT false, 'Invalid action: use accept or reject';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.review_client_agreement(UUID, TEXT, TEXT) TO authenticated;
