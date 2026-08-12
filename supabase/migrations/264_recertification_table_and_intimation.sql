-- ============================================================
-- Migration 264: Recertification — Sprint 0 (Table + Intimation)
--
-- Part of UAF New Changes/New Help Doc/Recertification/00_Sprint_Plan.md,
-- Sprint 0. Third parallel workflow object alongside New Client
-- (external_clients__a) and Surveillance 1 (renewal_clients__a).
--
-- 1. Table: tenant.recertification_clients__a — external_client_id__a is
--    NOT NULL (this object never exists without a prior External Client,
--    unlike Renewal's nullable link).
-- 2. Register object + Sprint 0 fields in tenant.objects/tenant.fields.
-- 3. Register status__a picklist value for this sprint's one new status —
--    done from day one here, closing the gap Renewal's own Sprint 0 (221)
--    left open until migration 257 had to backfill it.
-- 4. RPC: create_recertification_client(p_external_client_id, p_email) —
--    p_external_client_id REQUIRED (not DEFAULT NULL like Renewal's).
-- 5. start_file_upload — reproduces 261's full body verbatim (confirmed
--    still the latest redefinition — nothing between 261 and this file
--    touches it) + adds recert_intimation_letter as a CRM-only hard gate
--    from day one (Renewal's equivalent field had no hard gate until 261,
--    three sprints after its own Sprint 0).
-- 6. finalize_file_upload — reproduces 262's full body verbatim (confirmed
--    still the latest redefinition) + adds the recert_intimation_letter
--    auto-advance block.
-- ============================================================

-- ── 1. Table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant.recertification_clients__a (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                       UUID NOT NULL REFERENCES system.tenants(id) ON DELETE CASCADE,

  -- Link back to the original external client — REQUIRED, this object
  -- never exists unlinked (unlike Renewal's nullable external_client_id__a).
  external_client_id__a           UUID NOT NULL REFERENCES tenant.external_clients__a(id) ON DELETE RESTRICT,
  client_user_id__a               UUID,   -- copy of external_clients__a.client_user_id__a for RLS/auth

  -- Auto-populated from external_clients__a on creation
  name                            TEXT,
  company_name__a                 TEXT,
  contact_person__a               TEXT,
  email__a                        TEXT,
  iso_standards__a                TEXT,

  -- Workflow status (controlled by RPCs only)
  status__a                       TEXT,

  -- Stage: Recert Intimation Letter (CRM uploads)
  recert_intimation_letter__a     JSONB DEFAULT '{}'::jsonb,
  recert_intimation_sent_date__a  DATE,

  created_by  TEXT,
  updated_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recert_clients_tenant     ON tenant.recertification_clients__a (tenant_id);
CREATE INDEX IF NOT EXISTS idx_recert_clients_ext_client ON tenant.recertification_clients__a (external_client_id__a);

-- ── 2. Register object in tenant.objects ─────────────────────────
DO $$
DECLARE _tenant_id UUID;
BEGIN
  FOR _tenant_id IN SELECT id FROM system.tenants LOOP
    INSERT INTO tenant.objects (id, tenant_id, name, label, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), _tenant_id, 'recertification_clients__a', 'Recertification Clients', true, now(), now())
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- ── 3. Register Sprint 0 fields ────────────────────────────────────
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
      (gen_random_uuid(), _tenant_id, _object_id, 'external_client_id',          'External Client',               'text', true,  false, 1, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'company_name',                'Company Name',                   'text', false, false, 2, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'contact_person',              'Contact Person',                 'text', false, false, 3, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'email',                       'Email',                          'text', false, false, 4, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'iso_standards',               'ISO Standards',                  'text', false, false, 5, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'status',                      'Status',                         'text', false, false, 6, now(), now()),
      -- File field: name WITHOUT __a — finalize_file_upload appends it automatically
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_intimation_letter',    'Recertification Intimation Letter', 'file', false, false, 7, now(), now()),
      -- Date field: name WITHOUT __a — same convention
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_intimation_sent_date', 'Intimation Sent Date',           'date', false, false, 8, now(), now())
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- ── 4. status__a picklist value for this sprint ───────────────────
DO $$
DECLARE
  _tenant_id UUID;
  _object_id UUID;
  _field_id  UUID;
BEGIN
  FOR _tenant_id IN SELECT id FROM system.tenants LOOP
    SELECT id INTO _object_id FROM tenant.objects
    WHERE tenant_id = _tenant_id AND name = 'recertification_clients__a' LIMIT 1;
    IF _object_id IS NULL THEN CONTINUE; END IF;

    SELECT id INTO _field_id FROM tenant.fields
    WHERE object_id = _object_id AND name = 'status' LIMIT 1;
    IF _field_id IS NULL THEN CONTINUE; END IF;

    IF NOT EXISTS (SELECT 1 FROM tenant.picklist_values WHERE field_id = _field_id AND value = 'Recert_Intimation_Sent') THEN
      INSERT INTO tenant.picklist_values (tenant_id, field_id, value, label, display_order, is_active)
      VALUES (_tenant_id, _field_id, 'Recert_Intimation_Sent', 'Intimation Sent', 1, true);
    END IF;
  END LOOP;
END $$;

-- ── 5. RPC: create_recertification_client ─────────────────────────
-- CRM/admin only. p_external_client_id is REQUIRED — this object cannot
-- exist unlinked. Mirrors create_renewal_client (migration 256's final
-- form) exactly, including the p_email override.
DROP FUNCTION IF EXISTS public.create_recertification_client(UUID);
DROP FUNCTION IF EXISTS public.create_recertification_client(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.create_recertification_client(
  p_external_client_id UUID,
  p_email               TEXT DEFAULT NULL   -- overrides copied email__a when provided
)
RETURNS TABLE(success BOOLEAN, message TEXT, record_id UUID)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_id    UUID;
  _caller_role  TEXT;
  _custom_role  TEXT;
  _caller_name  TEXT;
  _tenant_id    UUID;
  _name         TEXT;
  _company      TEXT;
  _contact      TEXT;
  _email        TEXT;
  _iso          TEXT;
  _client_uid   UUID;
  _new_id       UUID;
BEGIN
  _caller_id := auth.uid();
  SELECT su.tenant_id, su.role INTO _tenant_id, _caller_role
  FROM system.users su WHERE su.id = _caller_id;

  SELECT r.name INTO _custom_role
  FROM system.users su
  JOIN tenant.roles r ON r.id = su.custom_role_id
  WHERE su.id = _caller_id;

  IF _caller_role != 'admin' AND (lower(coalesce(_custom_role,'')) NOT LIKE '%crm%') THEN
    RETURN QUERY SELECT false, 'Access denied: CRM Office role required', NULL::UUID;
    RETURN;
  END IF;

  IF p_external_client_id IS NULL THEN
    RETURN QUERY SELECT false, 'An External Client is required to create a recertification record', NULL::UUID;
    RETURN;
  END IF;

  _caller_name := COALESCE(public.current_user_full_name(), _caller_id::text);

  SELECT
    ec.name,
    ec."Company_name__a",
    ec."contactPerson__a",
    ec."email__a",
    ec."ISOStandard__a",
    ec."client_user_id__a"
  INTO _name, _company, _contact, _email, _iso, _client_uid
  FROM tenant.external_clients__a ec
  WHERE ec.id = p_external_client_id AND ec.tenant_id = _tenant_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'External client not found', NULL::UUID;
    RETURN;
  END IF;

  -- Explicit p_email always wins over the copied value, when given
  _email := COALESCE(NULLIF(trim(p_email), ''), _email);

  _new_id := gen_random_uuid();

  INSERT INTO tenant.recertification_clients__a (
    id, tenant_id, external_client_id__a, client_user_id__a,
    name, company_name__a, contact_person__a, email__a, iso_standards__a,
    created_by, updated_by,
    created_at, updated_at
  ) VALUES (
    _new_id, _tenant_id,
    p_external_client_id,
    _client_uid,
    COALESCE(_name, 'New Recertification'),
    _company,
    _contact,
    _email,
    _iso,
    _caller_name, _caller_name,
    now(), now()
  );

  RETURN QUERY SELECT true, 'Recertification record created', _new_id;
END;
$$;

-- ── 6. start_file_upload (REDEFINED — reproduces 261 verbatim + adds
-- recert_intimation_letter's CRM-only hard gate) ───────────────────
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

  -- ════════════════════════════════════════════════════════════
  -- NEW (264) — recertification_clients__a / Recertification hard
  -- upload gate: intimation letter, CRM-only, from day one (Renewal's
  -- equivalent field had no hard gate until three sprints in).
  -- ════════════════════════════════════════════════════════════
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

-- ── 7. finalize_file_upload (REDEFINED — reproduces 262 verbatim + adds
-- the recert_intimation_letter auto-advance block) ─────────────────
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

  -- ════════════════════════════════════════════════════════════
  -- NEW (264) — recertification_clients__a: intimation letter upload.
  -- CRM/admin only (redundant with the start_file_upload hard gate above
  -- — same belt-and-braces pattern every object in this app follows).
  -- ════════════════════════════════════════════════════════════
  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_intimation_letter' AND _is_crm THEN
    UPDATE tenant.recertification_clients__a
    SET status__a = 'Recert_Intimation_Sent',
        recert_intimation_sent_date__a = CURRENT_DATE,
        updated_at = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
  END IF;

  RETURN QUERY SELECT true, 'File upload finalized successfully', _file_metadata;
END;
$$;

-- ── 8. Grants ────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.create_recertification_client(UUID, TEXT)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_file_upload(UUID, UUID, UUID, TEXT, TEXT, BIGINT, JSONB) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.start_file_upload(UUID, UUID, UUID, TEXT, TEXT, BIGINT, JSONB) FROM public;
GRANT EXECUTE ON FUNCTION public.finalize_file_upload(UUID, BIGINT, TEXT)      TO authenticated;
