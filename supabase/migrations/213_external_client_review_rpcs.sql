-- ================================
-- Migration 213: External Client Review RPCs
--
-- Adds rejection_notes column to external_clients__a
-- and two review RPCs:
--   review_client_application  — CRM Office: accept/reject application
--   review_client_agreement    — External Client: accept/reject agreement
-- ================================

-- -----------------------------------------------
-- 1. rejection_notes__a column (if not already added via Object Manager)
-- -----------------------------------------------
ALTER TABLE tenant.external_clients__a
  ADD COLUMN IF NOT EXISTS rejection_notes__a TEXT;

-- -----------------------------------------------
-- 2. review_client_application
--    Called by: admin OR user with CRM Office custom role
--    Triggered when status = 'Application_Sent'
--
--    accept → status = 'Application_Accepted' + stamp Application_Accpeted_Date__a
--    reject → status cleared (NULL = back to pending) + store notes
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION public.review_client_application(
  p_record_id  UUID,
  p_action     TEXT,   -- 'accept' or 'reject'
  p_notes      TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_id     UUID;
  _caller_tenant UUID;
  _caller_role   TEXT;
  _custom_role   TEXT;
  _current_status TEXT;
BEGIN
  _caller_id := auth.uid();

  SELECT su.tenant_id, su.role INTO _caller_tenant, _caller_role
  FROM system.users su WHERE su.id = _caller_id;

  -- Resolve custom role name
  SELECT r.name INTO _custom_role
  FROM system.users su
  JOIN tenant.roles r ON r.id = su.custom_role_id
  WHERE su.id = _caller_id;

  -- Allow: admin OR user whose custom role contains 'crm'
  IF _caller_role != 'admin'
     AND (lower(coalesce(_custom_role, '')) NOT LIKE '%crm%') THEN
    RETURN QUERY SELECT false, 'Access denied: CRM Office role required';
    RETURN;
  END IF;

  -- Check record exists and belongs to this tenant
  SELECT ec.status__a INTO _current_status
  FROM tenant.external_clients__a ec
  WHERE ec.id = p_record_id AND ec.tenant_id = _caller_tenant;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Record not found';
    RETURN;
  END IF;

  IF p_action = 'accept' THEN
    UPDATE tenant.external_clients__a
    SET
      status__a                     = 'Application_Accepted',
      "Application_Accpeted_Date__a" = CURRENT_DATE,
      rejection_notes__a            = NULL,
      updated_at                    = NOW()
    WHERE id = p_record_id AND tenant_id = _caller_tenant;

    RETURN QUERY SELECT true, 'Application accepted';

  ELSIF p_action = 'reject' THEN
    -- Revert to NULL (pending / no status) and store rejection notes
    UPDATE tenant.external_clients__a
    SET
      status__a          = NULL,
      rejection_notes__a = p_notes,
      updated_at         = NOW()
    WHERE id = p_record_id AND tenant_id = _caller_tenant;

    RETURN QUERY SELECT true, 'Application rejected — status reset to pending';

  ELSE
    RETURN QUERY SELECT false, 'Invalid action: use accept or reject';
  END IF;
END;
$$;

-- -----------------------------------------------
-- 3. review_client_agreement
--    Called by: admin OR user whose client_user_id__a = their user id
--    Triggered when status = 'Client_Agreement_Signed'
--
--    accept → status = 'Stage_one_plan_Sent' + stamp Stage_one_plan_Sent_Date__a
--    reject → status = 'Quotation_Received' (back one step) + store notes
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION public.review_client_agreement(
  p_record_id UUID,
  p_action    TEXT,   -- 'accept' or 'reject'
  p_notes     TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_id     UUID;
  _caller_tenant UUID;
  _caller_role   TEXT;
  _client_user_id UUID;
BEGIN
  _caller_id := auth.uid();

  SELECT su.tenant_id, su.role INTO _caller_tenant, _caller_role
  FROM system.users su WHERE su.id = _caller_id;

  -- Check client_user_id__a on the record
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
    -- Step back to Quotation Received
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

-- -----------------------------------------------
-- 4. Grants
-- -----------------------------------------------
GRANT EXECUTE ON FUNCTION public.review_client_application(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_client_agreement(UUID, TEXT, TEXT) TO authenticated;
