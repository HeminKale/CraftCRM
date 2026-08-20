-- ============================================================
-- Migration 289: Recertification Sprint 9 — port the three Surveillance 1
--                 Sprint 9 fixes across (raw-UUID display, client access by
--                 email, email-on-upload gap is handled entirely in the
--                 frontend — see RECERT_EMAIL_ON_UPLOAD_FIELDS in
--                 RecordDetailView.tsx, no migration needed for that part)
--
-- Same root causes as Surveillance 1, confirmed by direct code inspection
-- before writing this (not assumed):
--
-- 1. recertification_clients__a's `external_client_id` field was
--    registered `type = 'text'` in 264_recertification_table_and_intimation.sql
--    (line 84), same as renewal_clients__a's equivalent bug fixed in 286.
--    Flip to 'reference' here; the generic frontend fix already shipped in
--    RecordDetailView.tsx (findFieldValue / getSmartFieldValue's bare-key
--    fallback) picks this up automatically — no frontend change needed.
--
-- 2. create_recertification_client (283, live body) copies client_user_id__a
--    from the selected External Client's own client_user_id__a at creation
--    time — identical fragility to create_renewal_client. Same fix as 287:
--    every client-facing write RPC/gate on recertification_clients__a now
--    ALSO accepts a case-insensitive match between the caller's login email
--    and the record's own email__a, in addition to the existing
--    client_user_id__a check. Purely additive.
--
-- Four call sites updated, each reproducing its current live body verbatim:
--   1. review_recert_agreement (live body: 265) — client accept+sign
--   2. review_recert_plan      (live body: 266) — client accept/reject plan
--   3. start_file_upload — recert_application_form block
--   4. start_file_upload — recert_ncr_rca / recert_evidences block
-- (3) and (4) are both inside the one shared start_file_upload function
-- (live body: 287, which already carries Surveillance 1's Sprint 9 fix for
-- surv_ncr_rca — reproduced here verbatim otherwise).
-- ============================================================

-- ── 0. External Client raw-UUID display fix (metadata-only) ──────────
UPDATE tenant.fields f
SET type                     = 'reference',
    reference_table          = 'external_clients__a',
    reference_display_field  = 'Company_name__a',
    updated_at                = now()
FROM tenant.objects o
WHERE f.object_id = o.id
  AND o.name = 'recertification_clients__a'
  AND f.name = 'external_client_id';

-- ── 1. review_recert_agreement ──────────────────────────────────────
DROP FUNCTION IF EXISTS public.review_recert_agreement(UUID, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.review_recert_agreement(
  p_record_id UUID,
  p_action    TEXT,   -- 'accept' or 'reject'
  p_notes     TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_id      UUID;
  _caller_email   TEXT;
  _caller_tenant  UUID;
  _caller_role    TEXT;
  _client_user_id UUID;
  _record_email   TEXT;
BEGIN
  _caller_id := auth.uid();

  SELECT su.tenant_id, su.role, su.email INTO _caller_tenant, _caller_role, _caller_email
  FROM system.users su WHERE su.id = _caller_id;

  SELECT rc.client_user_id__a, rc.email__a INTO _client_user_id, _record_email
  FROM tenant.recertification_clients__a rc
  WHERE rc.id = p_record_id AND rc.tenant_id = _caller_tenant;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Record not found';
    RETURN;
  END IF;

  IF _caller_role != 'admin'
     AND _client_user_id IS DISTINCT FROM _caller_id
     AND (_record_email IS NULL OR lower(_record_email) != lower(_caller_email)) THEN
    RETURN QUERY SELECT false, 'Access denied: you are not the linked client for this record';
    RETURN;
  END IF;

  IF p_action = 'accept' THEN
    UPDATE tenant.recertification_clients__a
    SET status__a                      = 'Recert_Agreement_Signed',
        "recert_agreement_signed_date__a" = CURRENT_DATE,
        rejection_notes__a             = NULL,
        updated_at                     = NOW()
    WHERE id = p_record_id AND tenant_id = _caller_tenant;

    RETURN QUERY SELECT true, 'Agreement signed';

  ELSIF p_action = 'reject' THEN
    -- Step back to Recert_Quotation_Received
    UPDATE tenant.recertification_clients__a
    SET status__a          = 'Recert_Quotation_Received',
        rejection_notes__a = p_notes,
        updated_at         = NOW()
    WHERE id = p_record_id AND tenant_id = _caller_tenant;

    RETURN QUERY SELECT true, 'Agreement rejected — status reverted to Quotation Received';

  ELSE
    RETURN QUERY SELECT false, 'Invalid action: use accept or reject';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.review_recert_agreement(UUID, TEXT, TEXT) TO authenticated;

-- ── 2. review_recert_plan ───────────────────────────────────────────
DROP FUNCTION IF EXISTS public.review_recert_plan(UUID, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.review_recert_plan(
  p_record_id UUID,
  p_action    TEXT,   -- 'accept' or 'reject'
  p_notes     TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_id      UUID;
  _caller_email   TEXT;
  _caller_tenant  UUID;
  _caller_role    TEXT;
  _client_user_id UUID;
  _record_email   TEXT;
BEGIN
  _caller_id := auth.uid();

  SELECT su.tenant_id, su.role, su.email INTO _caller_tenant, _caller_role, _caller_email
  FROM system.users su WHERE su.id = _caller_id;

  SELECT rc.client_user_id__a, rc.email__a INTO _client_user_id, _record_email
  FROM tenant.recertification_clients__a rc
  WHERE rc.id = p_record_id AND rc.tenant_id = _caller_tenant;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Record not found';
    RETURN;
  END IF;

  IF _caller_role != 'admin'
     AND _client_user_id IS DISTINCT FROM _caller_id
     AND (_record_email IS NULL OR lower(_record_email) != lower(_caller_email)) THEN
    RETURN QUERY SELECT false, 'Access denied: only the linked client can review the audit plan';
    RETURN;
  END IF;

  IF p_action = 'accept' THEN
    UPDATE tenant.recertification_clients__a
    SET status__a                       = 'Recert_Plan_Accepted',
        "recert_plan_accepted_date__a" = CURRENT_DATE,
        "recert_plan_client_remarks__a" = NULL,
        updated_at                     = NOW()
    WHERE id = p_record_id AND tenant_id = _caller_tenant;
    RETURN QUERY SELECT true, 'Recertification audit plan accepted';

  ELSIF p_action = 'reject' THEN
    UPDATE tenant.recertification_clients__a
    SET status__a                       = 'Recert_Plan_Sent',
        "recert_plan_client_remarks__a" = p_notes,
        updated_at                      = NOW()
    WHERE id = p_record_id AND tenant_id = _caller_tenant;
    RETURN QUERY SELECT true, 'Recertification audit plan rejected — awaiting revised plan';

  ELSE
    RETURN QUERY SELECT false, 'Invalid action: use accept or reject';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.review_recert_plan(UUID, TEXT, TEXT) TO authenticated;

-- ── 3. start_file_upload — recert_application_form and
--       recert_ncr_rca/recert_evidences blocks updated, full body
--       reproduced verbatim from 287 otherwise ─────────────────────
CREATE OR REPLACE FUNCTION public.start_file_upload(
  p_object_id UUID,
  p_record_id UUID,
  p_field_id UUID,
  p_filename TEXT,
  p_mime_type TEXT DEFAULT NULL,
  p_byte_size BIGINT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE(
  attachment_id UUID,
  bucket TEXT,
  storage_path TEXT,
  upload_url TEXT,
  success BOOLEAN,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant, public
AS $$
DECLARE
  _auth_user_id UUID;
  _tenant_id UUID;
  _object_name TEXT;
  _field_name TEXT;
  _attachment_id UUID;
  _canonical_path TEXT;
  _bucket TEXT := 'tenant-uploads';
  _caller_role TEXT;
  _caller_email TEXT;
  _custom_role TEXT;
  _linked_client_id UUID;
  _record_email TEXT;
  _auditor_id UUID;
  _tech_reviewer_id UUID;
  _current_status TEXT;
BEGIN
  -- Get current user
  _auth_user_id := auth.uid();
  IF _auth_user_id IS NULL THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false, 'User not authenticated';
    RETURN;
  END IF;

  -- Get tenant_id from system.users
  SELECT tenant_id INTO _tenant_id
  FROM system.users
  WHERE id = _auth_user_id;

  IF _tenant_id IS NULL THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false, 'User not found in system.users';
    RETURN;
  END IF;

  -- Verify object and field belong to user's tenant
  SELECT o.name, f.name INTO _object_name, _field_name
  FROM tenant.objects o
  JOIN tenant.fields f ON f.object_id = o.id
  WHERE o.id = p_object_id
    AND f.id = p_field_id
    AND o.tenant_id = _tenant_id
    AND f.tenant_id = _tenant_id;

  IF _object_name IS NULL OR _field_name IS NULL THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false, 'Object or field not found or access denied';
    RETURN;
  END IF;

  -- ── Quotation upload lock: admin / CRM Office only (migration 232) ──
  IF _object_name = 'external_clients__a' AND _field_name = 'quotation' THEN
    SELECT su.role INTO _caller_role FROM system.users su WHERE su.id = _auth_user_id;
    SELECT r.name INTO _custom_role
    FROM system.users su
    JOIN tenant.roles r ON r.id = su.custom_role_id
    WHERE su.id = _auth_user_id;

    IF _caller_role != 'admin' AND (lower(coalesce(_custom_role, '')) NOT LIKE '%crm%') THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'Access denied: CRM Office role required to upload quotation';
      RETURN;
    END IF;
  END IF;

  -- ── Client agreement upload lock: admin / CRM Office / the record's own
  -- linked client (migration 239 — carried forward via 244) ──
  IF _object_name = 'external_clients__a' AND _field_name = 'clientAgreement__c' THEN
    SELECT su.role INTO _caller_role FROM system.users su WHERE su.id = _auth_user_id;
    SELECT r.name INTO _custom_role
    FROM system.users su
    JOIN tenant.roles r ON r.id = su.custom_role_id
    WHERE su.id = _auth_user_id;

    SELECT ec.client_user_id__a INTO _linked_client_id
    FROM tenant.external_clients__a ec
    WHERE ec.id = p_record_id AND ec.tenant_id = _tenant_id;

    IF _caller_role != 'admin'
       AND (lower(coalesce(_custom_role, '')) NOT LIKE '%crm%')
       AND (_linked_client_id IS NULL OR _linked_client_id != _auth_user_id) THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'Access denied: CRM Office role required to upload client agreement';
      RETURN;
    END IF;
  END IF;

  -- ── Stage 1 audit plan: team must be assigned first (migration 244) ──
  IF _object_name = 'external_clients__a' AND _field_name = 'stage_one_audit_plan' THEN
    SELECT ec.auditor_id__a, ec.tech_reviewer_id__a INTO _auditor_id, _tech_reviewer_id
    FROM tenant.external_clients__a ec
    WHERE ec.id = p_record_id AND ec.tenant_id = _tenant_id;

    IF _auditor_id IS NULL OR _tech_reviewer_id IS NULL THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'Assign an Auditor and a Tech Reviewer before uploading the Stage 1 audit plan';
      RETURN;
    END IF;
  END IF;

  -- ── CRM/Auditor-only upload fields: the plan, report and NCR sheet on
  -- both stages (migration 248) ──
  IF _object_name = 'external_clients__a' AND _field_name IN (
    'stage_one_audit_plan', 'Stage_two_audit_plan',
    'stage1_report', 'stage1_ncr',
    'stage2_report', 'stage2_ncr'
  ) THEN
    SELECT su.role INTO _caller_role FROM system.users su WHERE su.id = _auth_user_id;
    SELECT r.name INTO _custom_role
    FROM system.users su
    JOIN tenant.roles r ON r.id = su.custom_role_id
    WHERE su.id = _auth_user_id;

    IF _caller_role != 'admin'
       AND (lower(coalesce(_custom_role, '')) NOT LIKE '%crm%')
       AND (lower(coalesce(_custom_role, '')) NOT LIKE '%auditor%') THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'Access denied: CRM Office or Auditor role required to upload this file';
      RETURN;
    END IF;
  END IF;

  -- ── Client-only upload fields: NCR+RCA (both stages) and Stage 2
  -- evidences (migration 248) ──
  IF _object_name = 'external_clients__a' AND _field_name IN (
    'stage1_ncr_rca', 'stage2_ncr_rca', 'stage2_evidences'
  ) THEN
    SELECT su.role INTO _caller_role FROM system.users su WHERE su.id = _auth_user_id;
    SELECT ec.client_user_id__a INTO _linked_client_id
    FROM tenant.external_clients__a ec
    WHERE ec.id = p_record_id AND ec.tenant_id = _tenant_id;

    IF _caller_role != 'admin'
       AND (_linked_client_id IS NULL OR _linked_client_id != _auth_user_id) THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'Access denied: only the linked client can upload this file';
      RETURN;
    END IF;
  END IF;

  -- ── renewal_clients__a / Surveillance 1 hard upload gates (261) ──

  IF _object_name = 'renewal_clients__a' AND _field_name = 'surv_audit_plan' THEN
    SELECT rc.auditor_id__a, rc.tech_reviewer_id__a INTO _auditor_id, _tech_reviewer_id
    FROM tenant.renewal_clients__a rc
    WHERE rc.id = p_record_id AND rc.tenant_id = _tenant_id;

    IF _auditor_id IS NULL OR _tech_reviewer_id IS NULL THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'Assign an Auditor and a Tech Reviewer before uploading the surveillance audit plan';
      RETURN;
    END IF;
  END IF;

  IF _object_name = 'renewal_clients__a' AND _field_name IN (
    'surveillance_intimation_letter', 'surveillance_certificates'
  ) THEN
    SELECT su.role INTO _caller_role FROM system.users su WHERE su.id = _auth_user_id;
    SELECT r.name INTO _custom_role
    FROM system.users su
    JOIN tenant.roles r ON r.id = su.custom_role_id
    WHERE su.id = _auth_user_id;

    IF _caller_role != 'admin' AND (lower(coalesce(_custom_role, '')) NOT LIKE '%crm%') THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'Access denied: CRM Office role required to upload this file';
      RETURN;
    END IF;
  END IF;

  IF _object_name = 'renewal_clients__a' AND _field_name IN (
    'surv_audit_plan', 'surv_ncr', 'surveillance_audit_report'
  ) THEN
    SELECT su.role INTO _caller_role FROM system.users su WHERE su.id = _auth_user_id;
    SELECT r.name INTO _custom_role
    FROM system.users su
    JOIN tenant.roles r ON r.id = su.custom_role_id
    WHERE su.id = _auth_user_id;

    IF _caller_role != 'admin'
       AND (lower(coalesce(_custom_role, '')) NOT LIKE '%crm%')
       AND (lower(coalesce(_custom_role, '')) NOT LIKE '%auditor%') THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'Access denied: CRM Office or Auditor role required to upload this file';
      RETURN;
    END IF;
  END IF;

  -- ── surv_ncr_rca: client-only. Accepts client_user_id__a match OR a
  -- case-insensitive match on the record's own email__a (287). ──
  IF _object_name = 'renewal_clients__a' AND _field_name = 'surv_ncr_rca' THEN
    SELECT su.role, su.email INTO _caller_role, _caller_email FROM system.users su WHERE su.id = _auth_user_id;
    SELECT rc.client_user_id__a, rc.email__a INTO _linked_client_id, _record_email
    FROM tenant.renewal_clients__a rc
    WHERE rc.id = p_record_id AND rc.tenant_id = _tenant_id;

    IF _caller_role != 'admin'
       AND (_linked_client_id IS NULL OR _linked_client_id != _auth_user_id)
       AND (_record_email IS NULL OR lower(_record_email) != lower(_caller_email)) THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'Access denied: only the linked client can upload this file';
      RETURN;
    END IF;
  END IF;

  IF _object_name = 'renewal_clients__a' AND _field_name = 'surv_tech_findings_file' THEN
    SELECT su.role INTO _caller_role FROM system.users su WHERE su.id = _auth_user_id;
    SELECT r.name INTO _custom_role
    FROM system.users su
    JOIN tenant.roles r ON r.id = su.custom_role_id
    WHERE su.id = _auth_user_id;

    IF _caller_role != 'admin' AND (lower(coalesce(_custom_role, '')) NOT LIKE '%tech%') THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'Access denied: Tech Reviewer role required to upload this file';
      RETURN;
    END IF;
  END IF;

  IF _object_name = 'renewal_clients__a' AND _field_name = 'cdc_report' THEN
    SELECT su.role INTO _caller_role FROM system.users su WHERE su.id = _auth_user_id;
    SELECT r.name INTO _custom_role
    FROM system.users su
    JOIN tenant.roles r ON r.id = su.custom_role_id
    WHERE su.id = _auth_user_id;

    IF _caller_role != 'admin' AND (lower(coalesce(_custom_role, '')) NOT LIKE '%cdc%') THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'Access denied: CDC role required to upload this file';
      RETURN;
    END IF;
  END IF;

  -- ── renewal_clients__a Sprint 8: Suspension & Withdrawal (277/278) ──

  IF _object_name = 'renewal_clients__a' AND _field_name = 'surv_suspension_intimation' THEN
    SELECT su.role INTO _caller_role FROM system.users su WHERE su.id = _auth_user_id;
    SELECT r.name INTO _custom_role
    FROM system.users su
    JOIN tenant.roles r ON r.id = su.custom_role_id
    WHERE su.id = _auth_user_id;

    IF _caller_role != 'admin' AND (lower(coalesce(_custom_role, '')) NOT LIKE '%crm%') THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'Access denied: CRM Office role required to upload this file';
      RETURN;
    END IF;

    SELECT rc.status__a INTO _current_status
    FROM tenant.renewal_clients__a rc
    WHERE rc.id = p_record_id AND rc.tenant_id = _tenant_id;

    IF _caller_role != 'admin' AND _current_status IS DISTINCT FROM 'Certificate_Issued' THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'This record is not at the Certificate Issued checkpoint yet';
      RETURN;
    END IF;
  END IF;

  IF _object_name = 'renewal_clients__a' AND _field_name = 'surv_suspension_decision' THEN
    SELECT su.role INTO _caller_role FROM system.users su WHERE su.id = _auth_user_id;
    SELECT r.name INTO _custom_role
    FROM system.users su
    JOIN tenant.roles r ON r.id = su.custom_role_id
    WHERE su.id = _auth_user_id;

    IF _caller_role != 'admin' AND (lower(coalesce(_custom_role, '')) NOT LIKE '%cdc%') THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'Access denied: CDC role required to upload this file';
      RETURN;
    END IF;

    SELECT rc.status__a INTO _current_status
    FROM tenant.renewal_clients__a rc
    WHERE rc.id = p_record_id AND rc.tenant_id = _tenant_id;

    IF _caller_role != 'admin' AND _current_status IS DISTINCT FROM 'Suspension_Intimation_Sent' THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'This record is not at the Suspension Intimation Sent checkpoint yet';
      RETURN;
    END IF;
  END IF;

  IF _object_name = 'renewal_clients__a' AND _field_name = 'surv_suspension_letter' THEN
    SELECT su.role INTO _caller_role FROM system.users su WHERE su.id = _auth_user_id;
    SELECT r.name INTO _custom_role
    FROM system.users su
    JOIN tenant.roles r ON r.id = su.custom_role_id
    WHERE su.id = _auth_user_id;

    IF _caller_role != 'admin' AND (lower(coalesce(_custom_role, '')) NOT LIKE '%crm%') THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'Access denied: CRM Office role required to upload this file';
      RETURN;
    END IF;

    SELECT rc.status__a INTO _current_status
    FROM tenant.renewal_clients__a rc
    WHERE rc.id = p_record_id AND rc.tenant_id = _tenant_id;

    IF _caller_role != 'admin' AND _current_status IS DISTINCT FROM 'Suspension_Decision_Uploaded' THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'This record is not at the Suspension Decision Uploaded checkpoint yet';
      RETURN;
    END IF;
  END IF;

  IF _object_name = 'renewal_clients__a' AND _field_name = 'surv_withdrawal_intimation' THEN
    SELECT su.role INTO _caller_role FROM system.users su WHERE su.id = _auth_user_id;
    SELECT r.name INTO _custom_role
    FROM system.users su
    JOIN tenant.roles r ON r.id = su.custom_role_id
    WHERE su.id = _auth_user_id;

    IF _caller_role != 'admin' AND (lower(coalesce(_custom_role, '')) NOT LIKE '%crm%') THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'Access denied: CRM Office role required to upload this file';
      RETURN;
    END IF;

    SELECT rc.status__a INTO _current_status
    FROM tenant.renewal_clients__a rc
    WHERE rc.id = p_record_id AND rc.tenant_id = _tenant_id;

    IF _caller_role != 'admin' AND _current_status IS DISTINCT FROM 'Suspension_Letter_Sent' THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'This record is not at the Suspension Letter Sent checkpoint yet';
      RETURN;
    END IF;
  END IF;

  IF _object_name = 'renewal_clients__a' AND _field_name = 'surv_withdrawal_decision' THEN
    SELECT su.role INTO _caller_role FROM system.users su WHERE su.id = _auth_user_id;
    SELECT r.name INTO _custom_role
    FROM system.users su
    JOIN tenant.roles r ON r.id = su.custom_role_id
    WHERE su.id = _auth_user_id;

    IF _caller_role != 'admin' AND (lower(coalesce(_custom_role, '')) NOT LIKE '%cdc%') THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'Access denied: CDC role required to upload this file';
      RETURN;
    END IF;

    SELECT rc.status__a INTO _current_status
    FROM tenant.renewal_clients__a rc
    WHERE rc.id = p_record_id AND rc.tenant_id = _tenant_id;

    IF _caller_role != 'admin' AND _current_status IS DISTINCT FROM 'Withdrawal_Intimation_Sent' THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'This record is not at the Withdrawal Intimation Sent checkpoint yet';
      RETURN;
    END IF;
  END IF;

  IF _object_name = 'renewal_clients__a' AND _field_name = 'surv_withdrawal_letter' THEN
    SELECT su.role INTO _caller_role FROM system.users su WHERE su.id = _auth_user_id;
    SELECT r.name INTO _custom_role
    FROM system.users su
    JOIN tenant.roles r ON r.id = su.custom_role_id
    WHERE su.id = _auth_user_id;

    IF _caller_role != 'admin' AND (lower(coalesce(_custom_role, '')) NOT LIKE '%crm%') THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'Access denied: CRM Office role required to upload this file';
      RETURN;
    END IF;

    SELECT rc.status__a INTO _current_status
    FROM tenant.renewal_clients__a rc
    WHERE rc.id = p_record_id AND rc.tenant_id = _tenant_id;

    IF _caller_role != 'admin' AND _current_status IS DISTINCT FROM 'Withdrawal_Decision_Uploaded' THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'This record is not at the Withdrawal Decision Uploaded checkpoint yet';
      RETURN;
    END IF;
  END IF;

  -- ── recertification_clients__a: intimation letter, CRM-only (264) ──
  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_intimation_letter' THEN
    SELECT su.role INTO _caller_role FROM system.users su WHERE su.id = _auth_user_id;
    SELECT r.name INTO _custom_role
    FROM system.users su
    JOIN tenant.roles r ON r.id = su.custom_role_id
    WHERE su.id = _auth_user_id;

    IF _caller_role != 'admin' AND (lower(coalesce(_custom_role, '')) NOT LIKE '%crm%') THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'Access denied: CRM Office role required to upload this file';
      RETURN;
    END IF;
  END IF;

  -- ── recertification_clients__a: Sprint 1 intake hard gates (265) ──

  -- ── Application form: client-only. UPDATED (289) — now also accepts a
  -- case-insensitive match on the record's own email__a, not only
  -- client_user_id__a (same reasoning as 287's surv_ncr_rca fix). ──
  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_application_form' THEN
    SELECT su.role, su.email INTO _caller_role, _caller_email FROM system.users su WHERE su.id = _auth_user_id;
    SELECT rc.client_user_id__a, rc.email__a INTO _linked_client_id, _record_email
    FROM tenant.recertification_clients__a rc
    WHERE rc.id = p_record_id AND rc.tenant_id = _tenant_id;

    IF _caller_role != 'admin'
       AND (_linked_client_id IS NULL OR _linked_client_id != _auth_user_id)
       AND (_record_email IS NULL OR lower(_record_email) != lower(_caller_email)) THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'Access denied: only the linked client can upload this file';
      RETURN;
    END IF;
  END IF;

  -- ── Quotation + Agreement: CRM-only ──
  IF _object_name = 'recertification_clients__a' AND _field_name IN (
    'recert_quotation', 'recert_agreement'
  ) THEN
    SELECT su.role INTO _caller_role FROM system.users su WHERE su.id = _auth_user_id;
    SELECT r.name INTO _custom_role
    FROM system.users su
    JOIN tenant.roles r ON r.id = su.custom_role_id
    WHERE su.id = _auth_user_id;

    IF _caller_role != 'admin' AND (lower(coalesce(_custom_role, '')) NOT LIKE '%crm%') THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'Access denied: CRM Office role required to upload this file';
      RETURN;
    END IF;
  END IF;

  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_audit_plan' THEN
    SELECT rc.auditor_id__a, rc.tech_reviewer_id__a INTO _auditor_id, _tech_reviewer_id
    FROM tenant.recertification_clients__a rc
    WHERE rc.id = p_record_id AND rc.tenant_id = _tenant_id;

    IF _auditor_id IS NULL OR _tech_reviewer_id IS NULL THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'Assign an Auditor and a Tech Reviewer before uploading the recertification audit plan';
      RETURN;
    END IF;
  END IF;

  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_audit_plan' THEN
    SELECT su.role INTO _caller_role FROM system.users su WHERE su.id = _auth_user_id;
    SELECT r.name INTO _custom_role
    FROM system.users su
    JOIN tenant.roles r ON r.id = su.custom_role_id
    WHERE su.id = _auth_user_id;

    IF _caller_role != 'admin'
       AND (lower(coalesce(_custom_role, '')) NOT LIKE '%crm%')
       AND (lower(coalesce(_custom_role, '')) NOT LIKE '%auditor%') THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'Access denied: CRM Office or Auditor role required to upload this file';
      RETURN;
    END IF;
  END IF;

  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_ncr' THEN
    SELECT su.role INTO _caller_role FROM system.users su WHERE su.id = _auth_user_id;
    SELECT r.name INTO _custom_role
    FROM system.users su
    JOIN tenant.roles r ON r.id = su.custom_role_id
    WHERE su.id = _auth_user_id;

    IF _caller_role != 'admin'
       AND (lower(coalesce(_custom_role, '')) NOT LIKE '%crm%')
       AND (lower(coalesce(_custom_role, '')) NOT LIKE '%auditor%') THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'Access denied: CRM Office or Auditor role required to upload this file';
      RETURN;
    END IF;
  END IF;

  -- ── Client-only upload fields: NCR root-cause response, evidences.
  -- UPDATED (289) — same email-match addition as recert_application_form
  -- above. ──
  IF _object_name = 'recertification_clients__a' AND _field_name IN (
    'recert_ncr_rca', 'recert_evidences'
  ) THEN
    SELECT su.role, su.email INTO _caller_role, _caller_email FROM system.users su WHERE su.id = _auth_user_id;
    SELECT rc.client_user_id__a, rc.email__a INTO _linked_client_id, _record_email
    FROM tenant.recertification_clients__a rc
    WHERE rc.id = p_record_id AND rc.tenant_id = _tenant_id;

    IF _caller_role != 'admin'
       AND (_linked_client_id IS NULL OR _linked_client_id != _auth_user_id)
       AND (_record_email IS NULL OR lower(_record_email) != lower(_caller_email)) THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'Access denied: only the linked client can upload this file';
      RETURN;
    END IF;
  END IF;

  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_audit_report' THEN
    SELECT su.role INTO _caller_role FROM system.users su WHERE su.id = _auth_user_id;
    SELECT r.name INTO _custom_role
    FROM system.users su
    JOIN tenant.roles r ON r.id = su.custom_role_id
    WHERE su.id = _auth_user_id;

    IF _caller_role != 'admin'
       AND (lower(coalesce(_custom_role, '')) NOT LIKE '%crm%')
       AND (lower(coalesce(_custom_role, '')) NOT LIKE '%auditor%') THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'Access denied: CRM Office or Auditor role required to upload this file';
      RETURN;
    END IF;
  END IF;

  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_tech_findings_file' THEN
    SELECT su.role INTO _caller_role FROM system.users su WHERE su.id = _auth_user_id;
    SELECT r.name INTO _custom_role
    FROM system.users su
    JOIN tenant.roles r ON r.id = su.custom_role_id
    WHERE su.id = _auth_user_id;

    IF _caller_role != 'admin' AND (lower(coalesce(_custom_role, '')) NOT LIKE '%tech%') THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'Access denied: Tech Reviewer role required to upload this file';
      RETURN;
    END IF;
  END IF;

  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_cdc_report' THEN
    SELECT su.role INTO _caller_role FROM system.users su WHERE su.id = _auth_user_id;
    SELECT r.name INTO _custom_role
    FROM system.users su
    JOIN tenant.roles r ON r.id = su.custom_role_id
    WHERE su.id = _auth_user_id;

    IF _caller_role != 'admin' AND (lower(coalesce(_custom_role, '')) NOT LIKE '%cdc%') THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'Access denied: CDC role required to upload this file';
      RETURN;
    END IF;
  END IF;

  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_certificates' THEN
    SELECT su.role INTO _caller_role FROM system.users su WHERE su.id = _auth_user_id;
    SELECT r.name INTO _custom_role
    FROM system.users su
    JOIN tenant.roles r ON r.id = su.custom_role_id
    WHERE su.id = _auth_user_id;

    IF _caller_role != 'admin' AND (lower(coalesce(_custom_role, '')) NOT LIKE '%crm%') THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'Access denied: CRM Office role required to upload this file';
      RETURN;
    END IF;
  END IF;

  -- Generate canonical storage path
  _canonical_path := format('tenants/%s/%s/%s/%s/%s-%s',
    _tenant_id,
    _object_name,
    p_record_id,
    _field_name,
    gen_random_uuid(),
    lower(regexp_replace(p_filename, '[^a-zA-Z0-9.-]', '-', 'g'))
  );

  -- Create attachment record
  INSERT INTO tenant.attachments (
    tenant_id, object_id, record_id, field_id,
    storage_bucket, storage_path, filename, mime_type,
    byte_size, uploaded_by, metadata
  )
  VALUES (
    _tenant_id, p_object_id, p_record_id, p_field_id,
    _bucket, _canonical_path, p_filename, p_mime_type,
    p_byte_size, _auth_user_id, p_metadata
  )
  RETURNING id INTO _attachment_id;

  -- upload_url is intentionally NULL — the frontend uploads via the
  -- authenticated Supabase Storage client using `bucket` + `storage_path`
  -- returned below, not a signed URL (see migration 235).
  RETURN QUERY SELECT
    _attachment_id,
    _bucket,
    _canonical_path,
    NULL::TEXT,
    true,
    'Upload started successfully';
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_file_upload(UUID, UUID, UUID, TEXT, TEXT, BIGINT, JSONB) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.start_file_upload(UUID, UUID, UUID, TEXT, TEXT, BIGINT, JSONB) FROM public;
