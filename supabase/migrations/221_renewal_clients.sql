-- ============================================================
-- Migration 221: Renewal Clients
--
-- 1. Table: tenant.renewal_clients__a
-- 2. Register object + fields in tenant.objects/fields
-- 3. RPCs: create_renewal_client, review_surveillance_intimation,
--          review_surveillance_audit_plan, complete_renewal
-- 4. Extend finalize_file_upload for intimation + audit_plan auto-advance
-- ============================================================

-- ── 1. Table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant.renewal_clients__a (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                       UUID NOT NULL REFERENCES system.tenants(id) ON DELETE CASCADE,

  -- Link back to the original external client
  external_client_id__a           UUID REFERENCES tenant.external_clients__a(id) ON DELETE SET NULL,
  client_user_id__a               UUID,   -- copy of external_clients__a.client_user_id__a for RLS/auth

  -- Auto-populated from external_clients__a on creation
  name                            TEXT,
  company_name__a                 TEXT,
  contact_person__a               TEXT,
  email__a                        TEXT,
  iso_standards__a                TEXT,

  -- Workflow status (controlled by RPCs only)
  status__a                       TEXT,
  rejection_notes__a              TEXT,

  -- Stage: Surveillance Intimation Letter (CRM uploads)
  surveillance_intimation_letter__a JSONB DEFAULT '{}'::jsonb,
  intimation_sent_date__a         DATE,
  intimation_accepted_date__a     DATE,

  -- Stage: Surveillance Audit Plan (CRM uploads)
  surveillance_audit_plan__a      JSONB DEFAULT '{}'::jsonb,
  audit_plan_sent_date__a         DATE,
  audit_plan_accepted_date__a     DATE,

  -- Stage: Completion (CRM enters manually)
  surveillance_audit_report__a    JSONB DEFAULT '{}'::jsonb,
  surveillance_certificates__a    JSONB DEFAULT '[]'::jsonb,
  surveillance_audit_date__a      DATE,
  audit_report_sent_date__a       DATE,
  certificates_sent_date__a       DATE,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_renewal_clients_tenant     ON tenant.renewal_clients__a (tenant_id);
CREATE INDEX IF NOT EXISTS idx_renewal_clients_ext_client ON tenant.renewal_clients__a (external_client_id__a);

-- ── 2. Register object in tenant.objects ─────────────────────────
DO $$
DECLARE _tenant_id UUID;
BEGIN
  FOR _tenant_id IN SELECT id FROM system.tenants LOOP
    INSERT INTO tenant.objects (id, tenant_id, name, label, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), _tenant_id, 'renewal_clients__a', 'Renewal Clients', true, now(), now())
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- ── 3. Register fields ────────────────────────────────────────────
DO $$
DECLARE
  _tenant_id UUID;
  _object_id UUID;
BEGIN
  FOR _tenant_id IN SELECT id FROM system.tenants LOOP
    SELECT id INTO _object_id FROM tenant.objects
    WHERE tenant_id = _tenant_id AND name = 'renewal_clients__a' LIMIT 1;
    IF _object_id IS NULL THEN CONTINUE; END IF;

    INSERT INTO tenant.fields (id, tenant_id, object_id, name, label, type, is_required, is_system_field, display_order, created_at, updated_at)
    VALUES
      (gen_random_uuid(), _tenant_id, _object_id, 'external_client_id',               'External Client',               'text',  false, false,  1, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'company_name',                     'Company Name',                  'text',  false, false,  2, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'contact_person',                   'Contact Person',                'text',  false, false,  3, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'email',                            'Email',                         'text',  false, false,  4, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'iso_standards',                    'ISO Standards',                 'text',  false, false,  5, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'status',                           'Status',                        'text',  false, false,  6, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'rejection_notes',                  'Rejection Notes',               'text',  false, false,  7, now(), now()),
      -- File fields: name WITHOUT __a — finalize_file_upload appends it automatically
      (gen_random_uuid(), _tenant_id, _object_id, 'surveillance_intimation_letter',   'Surveillance Intimation Letter','file',  false, false,  8, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'surveillance_audit_plan',          'Surveillance Audit Plan',       'file',  false, false, 11, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'surveillance_audit_report',        'Surveillance Audit Report',     'file',  false, false, 14, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'surveillance_certificates',        'Surveillance Certificates',     'files', false, false, 15, now(), now()),
      -- Date fields: name WITHOUT __a — same convention
      (gen_random_uuid(), _tenant_id, _object_id, 'intimation_sent_date',             'Intimation Sent Date',          'date',  false, false,  9, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'intimation_accepted_date',         'Intimation Accepted Date',      'date',  false, false, 10, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'audit_plan_sent_date',             'Audit Plan Sent Date',          'date',  false, false, 12, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'audit_plan_accepted_date',         'Audit Plan Accepted Date',      'date',  false, false, 13, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'surveillance_audit_date',          'Surveillance Audit Date',       'date',  false, false, 16, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'audit_report_sent_date',           'Audit Report Sent Date',        'date',  false, false, 17, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'certificates_sent_date',           'Certificates Sent Date',        'date',  false, false, 18, now(), now())
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- ── 4. RPC: get_renewal_clients ───────────────────────────────────
-- Returns all renewal records for the calling user's tenant.
DROP FUNCTION IF EXISTS public.get_renewal_clients();
CREATE OR REPLACE FUNCTION public.get_renewal_clients()
RETURNS TABLE(
  id                              UUID,
  external_client_id__a           UUID,
  client_user_id__a               UUID,
  name                            TEXT,
  company_name__a                 TEXT,
  contact_person__a               TEXT,
  email__a                        TEXT,
  iso_standards__a                TEXT,
  status__a                       TEXT,
  rejection_notes__a              TEXT,
  surveillance_intimation_letter__a JSONB,
  intimation_sent_date__a         DATE,
  intimation_accepted_date__a     DATE,
  surveillance_audit_plan__a      JSONB,
  audit_plan_sent_date__a         DATE,
  audit_plan_accepted_date__a     DATE,
  surveillance_audit_report__a    JSONB,
  surveillance_certificates__a    JSONB,
  surveillance_audit_date__a      DATE,
  audit_report_sent_date__a       DATE,
  certificates_sent_date__a       DATE,
  created_at                      TIMESTAMPTZ,
  updated_at                      TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _tenant_id UUID;
BEGIN
  SELECT tenant_id INTO _tenant_id FROM system.users WHERE id = auth.uid();
  RETURN QUERY
    SELECT
      r.id, r.external_client_id__a, r.client_user_id__a,
      r.name, r.company_name__a, r.contact_person__a, r.email__a, r.iso_standards__a,
      r.status__a, r.rejection_notes__a,
      r.surveillance_intimation_letter__a, r.intimation_sent_date__a, r.intimation_accepted_date__a,
      r.surveillance_audit_plan__a, r.audit_plan_sent_date__a, r.audit_plan_accepted_date__a,
      r.surveillance_audit_report__a, r.surveillance_certificates__a,
      r.surveillance_audit_date__a, r.audit_report_sent_date__a, r.certificates_sent_date__a,
      r.created_at, r.updated_at
    FROM tenant.renewal_clients__a r
    WHERE r.tenant_id = _tenant_id
    ORDER BY r.created_at DESC;
END;
$$;

-- ── 5. RPC: create_renewal_client ─────────────────────────────────
-- Called by CRM. Creates a renewal record pre-filled from an external client.
DROP FUNCTION IF EXISTS public.create_renewal_client(UUID);
CREATE OR REPLACE FUNCTION public.create_renewal_client(
  p_external_client_id UUID DEFAULT NULL   -- optional: link to existing client
)
RETURNS TABLE(success BOOLEAN, message TEXT, record_id UUID)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_id    UUID;
  _caller_role  TEXT;
  _custom_role  TEXT;
  _tenant_id    UUID;
  _client       RECORD;
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

  -- Only look up client details if a client was provided
  IF p_external_client_id IS NOT NULL THEN
    SELECT
      ec.name, ec.Company_name__a, ec.contactPerson__a, ec.email__a, ec.ISOStandard__a,
      ec.client_user_id__a
    INTO _client
    FROM tenant.external_clients__a ec
    WHERE ec.id = p_external_client_id AND ec.tenant_id = _tenant_id;

    IF NOT FOUND THEN
      RETURN QUERY SELECT false, 'External client not found', NULL::UUID;
      RETURN;
    END IF;
  END IF;

  _new_id := gen_random_uuid();

  INSERT INTO tenant.renewal_clients__a (
    id, tenant_id, external_client_id__a, client_user_id__a,
    name, company_name__a, contact_person__a, email__a, iso_standards__a,
    created_at, updated_at
  ) VALUES (
    _new_id, _tenant_id,
    p_external_client_id,
    _client.client_user_id__a,
    COALESCE(_client.name, 'New Renewal'),
    _client.Company_name__a,
    _client.contactPerson__a,
    _client.email__a,
    _client.ISOStandard__a,
    now(), now()
  );

  RETURN QUERY SELECT true, 'Renewal record created', _new_id;
END;
$$;

-- ── 6. RPC: review_surveillance_intimation ────────────────────────
-- Called by the linked client (or admin).
-- accept → Intimation_Accepted + stamp date
-- reject → NULL (CRM can re-upload)
DROP FUNCTION IF EXISTS public.review_surveillance_intimation(UUID, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.review_surveillance_intimation(
  p_record_id UUID,
  p_action    TEXT,   -- 'accept' or 'reject'
  p_notes     TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_id     UUID;
  _tenant_id     UUID;
  _caller_role   TEXT;
  _client_user_id UUID;
BEGIN
  _caller_id := auth.uid();
  SELECT su.tenant_id, su.role INTO _tenant_id, _caller_role
  FROM system.users su WHERE su.id = _caller_id;

  SELECT r.client_user_id__a INTO _client_user_id
  FROM tenant.renewal_clients__a r
  WHERE r.id = p_record_id AND r.tenant_id = _tenant_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Record not found';
    RETURN;
  END IF;

  IF _caller_role != 'admin' AND _client_user_id != _caller_id THEN
    RETURN QUERY SELECT false, 'Access denied: you are not the linked client';
    RETURN;
  END IF;

  IF p_action = 'accept' THEN
    UPDATE tenant.renewal_clients__a
    SET status__a = 'Intimation_Accepted',
        intimation_accepted_date__a = CURRENT_DATE,
        rejection_notes__a = NULL,
        updated_at = now()
    WHERE id = p_record_id AND tenant_id = _tenant_id;
    RETURN QUERY SELECT true, 'Intimation accepted';

  ELSIF p_action = 'reject' THEN
    -- Go back to NULL so CRM can re-upload
    UPDATE tenant.renewal_clients__a
    SET status__a = NULL,
        rejection_notes__a = p_notes,
        updated_at = now()
    WHERE id = p_record_id AND tenant_id = _tenant_id;
    RETURN QUERY SELECT true, 'Intimation rejected — awaiting CRM re-upload';

  ELSE
    RETURN QUERY SELECT false, 'Invalid action';
  END IF;
END;
$$;

-- ── 7. RPC: review_surveillance_audit_plan ────────────────────────
-- Called by the linked client (or admin).
-- accept → Audit_Plan_Accepted + stamp date
-- reject → Intimation_Accepted (step back)
DROP FUNCTION IF EXISTS public.review_surveillance_audit_plan(UUID, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.review_surveillance_audit_plan(
  p_record_id UUID,
  p_action    TEXT,
  p_notes     TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_id      UUID;
  _tenant_id      UUID;
  _caller_role    TEXT;
  _client_user_id UUID;
BEGIN
  _caller_id := auth.uid();
  SELECT su.tenant_id, su.role INTO _tenant_id, _caller_role
  FROM system.users su WHERE su.id = _caller_id;

  SELECT r.client_user_id__a INTO _client_user_id
  FROM tenant.renewal_clients__a r
  WHERE r.id = p_record_id AND r.tenant_id = _tenant_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Record not found';
    RETURN;
  END IF;

  IF _caller_role != 'admin' AND _client_user_id != _caller_id THEN
    RETURN QUERY SELECT false, 'Access denied: you are not the linked client';
    RETURN;
  END IF;

  IF p_action = 'accept' THEN
    UPDATE tenant.renewal_clients__a
    SET status__a = 'Audit_Plan_Accepted',
        audit_plan_accepted_date__a = CURRENT_DATE,
        rejection_notes__a = NULL,
        updated_at = now()
    WHERE id = p_record_id AND tenant_id = _tenant_id;
    RETURN QUERY SELECT true, 'Audit plan accepted';

  ELSIF p_action = 'reject' THEN
    -- Step back to Intimation_Accepted
    UPDATE tenant.renewal_clients__a
    SET status__a = 'Intimation_Accepted',
        rejection_notes__a = p_notes,
        updated_at = now()
    WHERE id = p_record_id AND tenant_id = _tenant_id;
    RETURN QUERY SELECT true, 'Audit plan rejected — reverted to Intimation Accepted';

  ELSE
    RETURN QUERY SELECT false, 'Invalid action';
  END IF;
END;
$$;

-- ── 8. RPC: complete_renewal ──────────────────────────────────────
-- Called by CRM when uploading report/certs and entering final dates.
DROP FUNCTION IF EXISTS public.complete_renewal(UUID, DATE);
CREATE OR REPLACE FUNCTION public.complete_renewal(
  p_record_id            UUID,
  p_surveillance_date    DATE DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_id   UUID;
  _tenant_id   UUID;
  _caller_role TEXT;
  _custom_role TEXT;
BEGIN
  _caller_id := auth.uid();
  SELECT su.tenant_id, su.role INTO _tenant_id, _caller_role
  FROM system.users su WHERE su.id = _caller_id;

  SELECT r.name INTO _custom_role
  FROM system.users su
  JOIN tenant.roles r ON r.id = su.custom_role_id
  WHERE su.id = _caller_id;

  IF _caller_role != 'admin' AND (lower(coalesce(_custom_role,'')) NOT LIKE '%crm%') THEN
    RETURN QUERY SELECT false, 'Access denied: CRM Office role required';
    RETURN;
  END IF;

  UPDATE tenant.renewal_clients__a
  SET
    status__a = 'Renewal_Complete',
    surveillance_audit_date__a  = COALESCE(p_surveillance_date, surveillance_audit_date__a),
    audit_report_sent_date__a   = CURRENT_DATE,
    certificates_sent_date__a   = CURRENT_DATE,
    updated_at = now()
  WHERE id = p_record_id AND tenant_id = _tenant_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Record not found';
    RETURN;
  END IF;

  RETURN QUERY SELECT true, 'Renewal marked complete';
END;
$$;

-- ── 9. Extend finalize_file_upload for renewal auto-advance ───────
-- Replace the existing function adding renewal_clients__a status logic.
DROP FUNCTION IF EXISTS public.finalize_file_upload(UUID, BIGINT, TEXT);
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

  -- ── renewal_clients__a: audit plan upload ────────────────────
  IF _object_name = 'renewal_clients__a' AND _field_name = 'surveillance_audit_plan' AND _is_crm THEN
    UPDATE tenant.renewal_clients__a
    SET status__a = 'Audit_Plan_Sent',
        audit_plan_sent_date__a = CURRENT_DATE,
        updated_at = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
  END IF;

  RETURN QUERY SELECT true, 'File upload finalized successfully', _file_metadata;
END;
$$;

-- ── 10. Grants ────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.get_renewal_clients()                            TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_renewal_client(UUID)                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_surveillance_intimation(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_surveillance_audit_plan(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_renewal(UUID, DATE)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_file_upload(UUID, BIGINT, TEXT)         TO authenticated;
