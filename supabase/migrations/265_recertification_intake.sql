-- ============================================================
-- Migration 265: Recertification — Sprint 1 (Intake: Application,
-- Quotation, Agreement)
--
-- Part of UAF New Changes/New Help Doc/Recertification/00_Sprint_Plan.md,
-- Sprint 1. Rows 2-6 of the matrix are a fresh cycle — new fields, new
-- uploads, new accept RPCs, independent of the client's original External
-- Client application/quotation/agreement.
--
-- 1. New columns on tenant.recertification_clients__a.
-- 2. Register Sprint 1 fields in tenant.fields.
-- 3. Register this sprint's five new status__a picklist values.
-- 4. RPC: review_recert_application — CRM/admin. Reject stays on
--    Recert_Application_Sent (not NULL) — this record already has a
--    linked client, unlike New Client's from-scratch reject-to-NULL.
-- 5. RPC: review_recert_agreement — linked client/admin.
-- 6. start_file_upload — reproduces 264's full body verbatim + adds
--    recert_application_form (Client-only), recert_quotation (CRM-only),
--    recert_agreement (CRM-only) hard gates.
-- 7. finalize_file_upload — reproduces 264's full body verbatim + adds
--    the three upload auto-advance blocks.
-- ============================================================

-- ── 1. New columns ─────────────────────────────────────────────────
ALTER TABLE tenant.recertification_clients__a
  ADD COLUMN IF NOT EXISTS "recert_application_form__a"          JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "recert_application_sent_date__a"     DATE,
  ADD COLUMN IF NOT EXISTS "recert_application_accepted_date__a" DATE,
  ADD COLUMN IF NOT EXISTS "recert_quotation__a"                 JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "recert_quotation_received_date__a"   DATE,
  ADD COLUMN IF NOT EXISTS "recert_agreement__a"                 JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "recert_agreement_sent_date__a"       DATE,
  ADD COLUMN IF NOT EXISTS "recert_agreement_signed_date__a"     DATE,
  ADD COLUMN IF NOT EXISTS "rejection_notes__a"                  TEXT;

-- ── 2. Register Sprint 1 fields ─────────────────────────────────────
DO $$
DECLARE
  _tenant_id UUID;
  _object_id UUID;
BEGIN
  FOR _tenant_id IN SELECT id FROM system.tenants LOOP
    SELECT id INTO _object_id FROM tenant.objects
    WHERE tenant_id = _tenant_id AND name = 'recertification_clients__a' LIMIT 1;
    IF _object_id IS NULL THEN CONTINUE; END IF;

    INSERT INTO tenant.fields (id, tenant_id, object_id, name, label, type, is_required, is_system_field, display_order, created_at, updated_at)
    VALUES
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_application_form',          'Application Form',              'file', false, false,  9, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_application_sent_date',     'Application Sent Date',         'date', false, false, 10, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_application_accepted_date', 'Application Accepted Date',     'date', false, false, 11, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_quotation',                 'Quotation',                     'file', false, false, 12, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_quotation_received_date',   'Quotation Received Date',       'date', false, false, 13, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_agreement',                 'Client Agreement',              'file', false, false, 14, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_agreement_sent_date',       'Agreement Sent Date',           'date', false, false, 15, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_agreement_signed_date',     'Agreement Signed Date',         'date', false, false, 16, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'rejection_notes',                  'Rejection Notes',               'text', false, false, 17, now(), now())
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- ── 3. status__a picklist values for this sprint ────────────────────
DO $$
DECLARE
  _tenant_id UUID;
  _object_id UUID;
  _field_id  UUID;
  _row       RECORD;
BEGIN
  FOR _tenant_id IN SELECT id FROM system.tenants LOOP
    SELECT id INTO _object_id FROM tenant.objects
    WHERE tenant_id = _tenant_id AND name = 'recertification_clients__a' LIMIT 1;
    IF _object_id IS NULL THEN CONTINUE; END IF;

    SELECT id INTO _field_id FROM tenant.fields
    WHERE object_id = _object_id AND name = 'status' LIMIT 1;
    IF _field_id IS NULL THEN CONTINUE; END IF;

    FOR _row IN
      SELECT * FROM (VALUES
        ('Recert_Application_Sent',     'Application Sent',     2),
        ('Recert_Application_Accepted', 'Application Accepted', 3),
        ('Recert_Quotation_Received',   'Quotation Received',   4),
        ('Recert_Agreement_Sent',       'Agreement Sent',       5),
        ('Recert_Agreement_Signed',     'Agreement Signed',     6)
      ) AS t(value, label, display_order)
    LOOP
      IF EXISTS (SELECT 1 FROM tenant.picklist_values WHERE field_id = _field_id AND value = _row.value) THEN
        UPDATE tenant.picklist_values
        SET label = _row.label, display_order = _row.display_order, is_active = true, updated_at = now()
        WHERE field_id = _field_id AND value = _row.value;
      ELSE
        INSERT INTO tenant.picklist_values (tenant_id, field_id, value, label, display_order, is_active)
        VALUES (_tenant_id, _field_id, _row.value, _row.label, _row.display_order, true);
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ── 4. RPC: review_recert_application ────────────────────────────────
-- CRM/admin. Mirrors review_client_application (213), but the reject
-- branch stays on Recert_Application_Sent (not NULL) — this record
-- already has a linked client, unlike New Client's from-scratch reset.
DROP FUNCTION IF EXISTS public.review_recert_application(UUID, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.review_recert_application(
  p_record_id UUID,
  p_action    TEXT,   -- 'accept' or 'reject'
  p_notes     TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_id      UUID;
  _caller_tenant  UUID;
  _caller_role    TEXT;
  _custom_role    TEXT;
  _current_status TEXT;
BEGIN
  _caller_id := auth.uid();

  SELECT su.tenant_id, su.role INTO _caller_tenant, _caller_role
  FROM system.users su WHERE su.id = _caller_id;

  SELECT r.name INTO _custom_role
  FROM system.users su
  JOIN tenant.roles r ON r.id = su.custom_role_id
  WHERE su.id = _caller_id;

  IF _caller_role != 'admin' AND (lower(coalesce(_custom_role, '')) NOT LIKE '%crm%') THEN
    RETURN QUERY SELECT false, 'Access denied: CRM Office role required';
    RETURN;
  END IF;

  SELECT rc.status__a INTO _current_status
  FROM tenant.recertification_clients__a rc
  WHERE rc.id = p_record_id AND rc.tenant_id = _caller_tenant;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Record not found';
    RETURN;
  END IF;

  IF p_action = 'accept' THEN
    UPDATE tenant.recertification_clients__a
    SET status__a                          = 'Recert_Application_Accepted',
        "recert_application_accepted_date__a" = CURRENT_DATE,
        rejection_notes__a                 = NULL,
        updated_at                         = NOW()
    WHERE id = p_record_id AND tenant_id = _caller_tenant;

    RETURN QUERY SELECT true, 'Application accepted';

  ELSIF p_action = 'reject' THEN
    -- Stays on Recert_Application_Sent — this record already has a
    -- linked client, so there is no "back to pending/unlinked" state to
    -- fall to the way New Client's from-scratch reject does.
    UPDATE tenant.recertification_clients__a
    SET status__a          = 'Recert_Application_Sent',
        rejection_notes__a = p_notes,
        updated_at         = NOW()
    WHERE id = p_record_id AND tenant_id = _caller_tenant;

    RETURN QUERY SELECT true, 'Application rejected — awaiting revised application';

  ELSE
    RETURN QUERY SELECT false, 'Invalid action: use accept or reject';
  END IF;
END;
$$;

-- ── 5. RPC: review_recert_agreement ──────────────────────────────────
-- Linked client/admin. Mirrors review_client_agreement (213).
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
  _caller_tenant  UUID;
  _caller_role    TEXT;
  _client_user_id UUID;
BEGIN
  _caller_id := auth.uid();

  SELECT su.tenant_id, su.role INTO _caller_tenant, _caller_role
  FROM system.users su WHERE su.id = _caller_id;

  SELECT rc.client_user_id__a INTO _client_user_id
  FROM tenant.recertification_clients__a rc
  WHERE rc.id = p_record_id AND rc.tenant_id = _caller_tenant;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Record not found';
    RETURN;
  END IF;

  IF _caller_role != 'admin' AND _client_user_id IS DISTINCT FROM _caller_id THEN
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

-- ── 6. start_file_upload (REDEFINED — reproduces 264 verbatim + adds
-- Sprint 1 intake hard gates) ───────────────────────────────────────
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
  _custom_role TEXT;
  _linked_client_id UUID;
  _auditor_id UUID;
  _tech_reviewer_id UUID;
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

  IF _object_name = 'renewal_clients__a' AND _field_name = 'surv_ncr_rca' THEN
    SELECT su.role INTO _caller_role FROM system.users su WHERE su.id = _auth_user_id;
    SELECT rc.client_user_id__a INTO _linked_client_id
    FROM tenant.renewal_clients__a rc
    WHERE rc.id = p_record_id AND rc.tenant_id = _tenant_id;

    IF _caller_role != 'admin'
       AND (_linked_client_id IS NULL OR _linked_client_id != _auth_user_id) THEN
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

  -- ════════════════════════════════════════════════════════════
  -- NEW (265) — recertification_clients__a Sprint 1 intake hard gates
  -- ════════════════════════════════════════════════════════════

  -- ── Application form: Client-only. Deliberately different from the
  -- intimation letter's CRM-only pattern — the client submits their own
  -- application (confirmed decision, matches how New Client's form works).
  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_application_form' THEN
    SELECT su.role INTO _caller_role FROM system.users su WHERE su.id = _auth_user_id;
    SELECT rc.client_user_id__a INTO _linked_client_id
    FROM tenant.recertification_clients__a rc
    WHERE rc.id = p_record_id AND rc.tenant_id = _tenant_id;

    IF _caller_role != 'admin'
       AND (_linked_client_id IS NULL OR _linked_client_id != _auth_user_id) THEN
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

-- ── 7. finalize_file_upload (REDEFINED — reproduces 264 verbatim + adds
-- Sprint 1 intake auto-advance blocks) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.finalize_file_upload(
  p_attachment_id   UUID,
  p_final_byte_size BIGINT DEFAULT NULL,
  p_final_mime_type TEXT   DEFAULT NULL
)
RETURNS TABLE(
  success       BOOLEAN,
  message       TEXT,
  file_metadata JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant, public
AS $$
DECLARE
  _auth_user_id UUID;
  _tenant_id    UUID;
  _attachment   tenant.attachments;
  _object_name  TEXT;
  _field_name   TEXT;
  _column_name  TEXT;
  _file_metadata JSONB;
  _sql          TEXT;
  _caller_role  TEXT;
  _custom_role  TEXT;
  _is_crm       BOOLEAN := false;
  _is_crm_or_auditor BOOLEAN := false;
  _is_crm_or_tech    BOOLEAN := false;
  _is_tech           BOOLEAN := false;
  _is_cdc            BOOLEAN := false;
  _client_user_id UUID;
BEGIN
  _auth_user_id := auth.uid();
  IF _auth_user_id IS NULL THEN
    RETURN QUERY SELECT false, 'User not authenticated', NULL::JSONB;
    RETURN;
  END IF;

  SELECT tenant_id INTO _tenant_id FROM system.users WHERE id = _auth_user_id;
  IF _tenant_id IS NULL THEN
    RETURN QUERY SELECT false, 'User not found in system.users', NULL::JSONB;
    RETURN;
  END IF;

  SELECT * INTO _attachment
  FROM tenant.attachments
  WHERE id = p_attachment_id AND tenant_id = _tenant_id;

  IF _attachment.id IS NULL THEN
    RETURN QUERY SELECT false, 'Attachment not found or access denied', NULL::JSONB;
    RETURN;
  END IF;

  UPDATE tenant.attachments
  SET
    byte_size  = COALESCE(p_final_byte_size, byte_size),
    mime_type  = COALESCE(p_final_mime_type, mime_type),
    updated_at = now()
  WHERE id = p_attachment_id;

  SELECT o.name, f.name INTO _object_name, _field_name
  FROM tenant.objects o
  JOIN tenant.fields f ON f.object_id = o.id
  WHERE o.id = _attachment.object_id AND f.id = _attachment.field_id;

  IF _field_name NOT IN ('name','email','phone','created_at','updated_at','created_by','updated_by') THEN
    _column_name := _field_name || '__a';
  ELSE
    _column_name := _field_name;
  END IF;

  _file_metadata := jsonb_build_object(
    'id',          _attachment.id,
    'bucket',      _attachment.storage_bucket,
    'path',        _attachment.storage_path,
    'name',        _attachment.filename,
    'size',        COALESCE(p_final_byte_size, _attachment.byte_size),
    'mime',        COALESCE(p_final_mime_type, _attachment.mime_type),
    'version',     _attachment.version,
    'uploaded_at', _attachment.created_at,
    'uploaded_by', _attachment.uploaded_by
  );

  _sql := format('
    UPDATE tenant.%I
    SET %I = CASE
      WHEN (SELECT type FROM tenant.fields WHERE id = %L) = ''file''  THEN %L::jsonb
      WHEN (SELECT type FROM tenant.fields WHERE id = %L) = ''files'' THEN
        COALESCE(%I, ''[]''::jsonb) || %L::jsonb
      ELSE %I
    END
    WHERE id = %L
  ',
    _object_name, _column_name, _attachment.field_id, _file_metadata,
    _attachment.field_id, _column_name, _file_metadata, _column_name, _attachment.record_id
  );
  EXECUTE _sql;

  -- ── Resolve caller role once for status logic ────────────────
  SELECT su.role INTO _caller_role FROM system.users su WHERE su.id = _auth_user_id;
  SELECT r.name INTO _custom_role
  FROM system.users su
  JOIN tenant.roles r ON r.id = su.custom_role_id
  WHERE su.id = _auth_user_id;

  _is_crm := (_caller_role = 'admin') OR (lower(coalesce(_custom_role,'')) LIKE '%crm%');
  _is_crm_or_auditor := _is_crm OR (lower(coalesce(_custom_role,'')) LIKE '%auditor%');
  _is_crm_or_tech    := _is_crm OR (lower(coalesce(_custom_role,'')) LIKE '%tech%');
  _is_tech           := (_caller_role = 'admin') OR (lower(coalesce(_custom_role,'')) LIKE '%tech%');
  _is_cdc            := (_caller_role = 'admin') OR (lower(coalesce(_custom_role,'')) LIKE '%cdc%');

  -- ── external_clients__a: quotation upload ────────────────────
  IF _object_name = 'external_clients__a' AND _field_name = 'quotation' AND _is_crm THEN
    UPDATE tenant.external_clients__a
    SET status__a = 'Quotation_Received',
        "Quotation_Received_Date__a" = CURRENT_DATE,
        updated_at = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
  END IF;

  -- ── renewal_clients__a: intimation letter upload ─────────────
  IF _object_name = 'renewal_clients__a' AND _field_name = 'surveillance_intimation_letter' AND _is_crm THEN
    UPDATE tenant.renewal_clients__a
    SET status__a = 'Intimation_Sent',
        intimation_sent_date__a = CURRENT_DATE,
        updated_at = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
  END IF;

  -- ── renewal_clients__a: legacy audit plan upload (migration 221) ─────
  IF _object_name = 'renewal_clients__a' AND _field_name = 'surveillance_audit_plan' AND _is_crm THEN
    UPDATE tenant.renewal_clients__a
    SET status__a = 'Audit_Plan_Sent',
        audit_plan_sent_date__a = CURRENT_DATE,
        updated_at = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
  END IF;

  IF _object_name = 'renewal_clients__a' AND _field_name = 'surv_audit_plan' AND _is_crm_or_auditor THEN
    UPDATE tenant.renewal_clients__a
    SET status__a                     = 'Surv_Plan_Sent',
        "surv_plan_sent_date__a"      = CURRENT_DATE,
        "surv_plan_client_remarks__a" = NULL,
        updated_at                    = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id
      AND status__a IN ('Team_Assigned', 'Surv_Plan_Sent');
  END IF;

  IF _object_name = 'renewal_clients__a' AND _field_name = 'surv_ncr' AND _is_crm_or_auditor THEN
    UPDATE tenant.renewal_clients__a
    SET status__a                = 'Surv_NCR_Sent',
        "surv_ncr_sent_date__a"  = CURRENT_DATE,
        updated_at               = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id
      AND status__a IN ('Surv_Plan_Accepted', 'Surv_NCR_Sent');
  END IF;

  IF _object_name = 'renewal_clients__a' AND _field_name = 'surv_ncr_rca' THEN
    SELECT rc.client_user_id__a INTO _client_user_id
    FROM tenant.renewal_clients__a rc
    WHERE rc.id = _attachment.record_id AND rc.tenant_id = _tenant_id;

    IF _caller_role = 'admin' OR _client_user_id = _auth_user_id THEN
      UPDATE tenant.renewal_clients__a
      SET status__a                       = 'Surv_NCR_RCA_Uploaded',
          "surv_ncr_rca_uploaded_date__a" = CURRENT_DATE,
          updated_at                      = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id
        AND status__a IN ('Surv_NCR_Sent', 'Surv_NCR_RCA_Uploaded');
    END IF;
  END IF;

  IF _object_name = 'renewal_clients__a' AND _field_name = 'surveillance_audit_report' AND _is_crm_or_auditor THEN
    UPDATE tenant.renewal_clients__a
    SET status__a                 = 'Surv_Report_Sent',
        "surv_report_sent_date__a" = CURRENT_DATE,
        updated_at                = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id
      AND status__a IN ('Surv_Auditor_Accepted', 'Surv_Report_Sent');
  END IF;

  IF _object_name = 'renewal_clients__a' AND _field_name = 'cdc_report' AND _is_cdc THEN
    UPDATE tenant.renewal_clients__a
    SET status__a    = 'CDC_Approved',
        "cdc_date__a" = CURRENT_DATE,
        updated_at   = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id
      AND status__a IN ('Surv_Closed', 'CDC_Approved');
  END IF;

  IF _object_name = 'renewal_clients__a' AND _field_name = 'surveillance_certificates' AND _is_crm THEN
    UPDATE tenant.renewal_clients__a
    SET status__a                 = 'Certificate_Issued',
        certificates_sent_date__a = CURRENT_DATE,
        updated_at                = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
  END IF;

  -- ── external_clients__a: Stage 1 audit uploads ───────────────
  IF _object_name = 'external_clients__a' THEN
    IF _field_name = 'stage_one_audit_plan' AND _is_crm_or_auditor THEN
      UPDATE tenant.external_clients__a
      SET status__a = 'Stage_one_plan_Sent',
          "Stage_one_plan_Sent_Date__a" = CURRENT_DATE,
          "stage1_plan_client_remarks__a" = NULL,
          updated_at = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id;

    ELSIF _field_name IN ('stage1_report', 'stage1_ncr') AND _is_crm_or_auditor THEN
      UPDATE tenant.external_clients__a
      SET status__a = 'Stage1_Report_Sent',
          updated_at = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id
        AND status__a IN ('Stage1_Plan_Accepted', 'Stage1_Report_Sent');

      UPDATE tenant.external_clients__a
      SET status__a = 'Stage1_Auditor_Accepted',
          "stage1_tech_findings_notes__a" = NULL,
          updated_at = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id
        AND status__a = 'Stage1_Tech_Findings_Rejected';

    ELSIF _field_name = 'stage1_ncr_rca' THEN
      SELECT ec.client_user_id__a INTO _client_user_id
      FROM tenant.external_clients__a ec
      WHERE ec.id = _attachment.record_id AND ec.tenant_id = _tenant_id;

      IF _caller_role = 'admin' OR _client_user_id = _auth_user_id THEN
        UPDATE tenant.external_clients__a
        SET status__a = 'Stage1_NCR_RCA_Uploaded',
            updated_at = NOW()
        WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
      END IF;
    END IF;
  END IF;

  -- ── external_clients__a: Stage 2 audit uploads ───────────────
  IF _object_name = 'external_clients__a' THEN
    IF _field_name = 'Stage_two_audit_plan' AND _is_crm_or_auditor THEN
      UPDATE tenant.external_clients__a
      SET status__a = 'Stage2_Plan_Sent',
          "stage2_plan_sent_date__a" = CURRENT_DATE,
          "stage2_plan_client_remarks__a" = NULL,
          updated_at = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id;

    ELSIF _field_name IN ('stage2_report', 'stage2_ncr') AND _is_crm_or_auditor THEN
      UPDATE tenant.external_clients__a
      SET status__a = 'Stage2_Report_Sent',
          updated_at = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id
        AND status__a IN ('Stage2_Plan_Accepted', 'Stage2_Report_Sent');

      UPDATE tenant.external_clients__a
      SET status__a = 'Stage2_Evidences_Accepted',
          "stage2_tech_findings_notes__a" = NULL,
          updated_at = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id
        AND status__a = 'Stage2_Tech_Findings_Rejected';

    ELSIF _field_name = 'stage2_ncr_rca' THEN
      SELECT ec.client_user_id__a INTO _client_user_id
      FROM tenant.external_clients__a ec
      WHERE ec.id = _attachment.record_id AND ec.tenant_id = _tenant_id;

      IF _caller_role = 'admin' OR _client_user_id = _auth_user_id THEN
        UPDATE tenant.external_clients__a
        SET status__a = 'Stage2_NCR_RCA_Uploaded',
            updated_at = NOW()
        WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
      END IF;

    ELSIF _field_name = 'stage2_evidences' THEN
      SELECT ec.client_user_id__a INTO _client_user_id
      FROM tenant.external_clients__a ec
      WHERE ec.id = _attachment.record_id AND ec.tenant_id = _tenant_id;

      IF _caller_role = 'admin' OR _client_user_id = _auth_user_id THEN
        UPDATE tenant.external_clients__a
        SET status__a = 'Stage2_Evidences_Uploaded',
            updated_at = NOW()
        WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
      END IF;

    ELSIF _field_name = 'cdc_report' AND _is_cdc THEN
      UPDATE tenant.external_clients__a
      SET status__a = 'CDC_Approved',
          "cdc_date__a" = CURRENT_DATE,
          updated_at = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
    END IF;
  END IF;

  -- ── recertification_clients__a: intimation letter upload (264) ──
  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_intimation_letter' AND _is_crm THEN
    UPDATE tenant.recertification_clients__a
    SET status__a = 'Recert_Intimation_Sent',
        recert_intimation_sent_date__a = CURRENT_DATE,
        updated_at = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
  END IF;

  -- ════════════════════════════════════════════════════════════
  -- NEW (265) — recertification_clients__a Sprint 1 intake uploads
  -- ════════════════════════════════════════════════════════════

  -- ── Application form: linked client only ──
  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_application_form' THEN
    SELECT rc.client_user_id__a INTO _client_user_id
    FROM tenant.recertification_clients__a rc
    WHERE rc.id = _attachment.record_id AND rc.tenant_id = _tenant_id;

    IF _caller_role = 'admin' OR _client_user_id = _auth_user_id THEN
      UPDATE tenant.recertification_clients__a
      SET status__a                          = 'Recert_Application_Sent',
          "recert_application_sent_date__a"  = CURRENT_DATE,
          updated_at                         = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
    END IF;
  END IF;

  -- ── Quotation: CRM only ──
  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_quotation' AND _is_crm THEN
    UPDATE tenant.recertification_clients__a
    SET status__a                           = 'Recert_Quotation_Received',
        "recert_quotation_received_date__a" = CURRENT_DATE,
        updated_at                          = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
  END IF;

  -- ── Agreement: CRM only ──
  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_agreement' AND _is_crm THEN
    UPDATE tenant.recertification_clients__a
    SET status__a                       = 'Recert_Agreement_Sent',
        "recert_agreement_sent_date__a" = CURRENT_DATE,
        updated_at                      = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
  END IF;

  RETURN QUERY SELECT true, 'File upload finalized successfully', _file_metadata;
END;
$$;

-- ── 8. Grants ────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.review_recert_application(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_recert_agreement(UUID, TEXT, TEXT)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_file_upload(UUID, UUID, UUID, TEXT, TEXT, BIGINT, JSONB) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.start_file_upload(UUID, UUID, UUID, TEXT, TEXT, BIGINT, JSONB) FROM public;
GRANT EXECUTE ON FUNCTION public.finalize_file_upload(UUID, BIGINT, TEXT)   TO authenticated;
