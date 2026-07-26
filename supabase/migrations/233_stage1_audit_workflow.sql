-- ============================================================
-- Migration 233: External Client — Stage 1 Audit Workflow (backend)
--
-- Adds the Stage 1 certification-audit lifecycle to external_clients__a:
--   report upload → NCR upload → client root-cause response (RCA) →
--   auditor acceptance → tech-reviewer findings → auditor closure →
--   tech-reviewer final sign-off.
--
-- Roles (matched by custom role name, same convention as CRM Office):
--   CRM Office   → lower(role name) LIKE '%crm%'
--   Auditor      → lower(role name) LIKE '%auditor%'
--   Tech Reviewer→ lower(role name) LIKE '%tech%'
--   Linked client→ external_clients__a.client_user_id__a = auth.uid()
--   admin        → system.users.role = 'admin' (bypasses every gate)
--
-- Contents:
--   1. Columns on tenant.external_clients__a (4 file JSONB + 11 date/text)
--   2. Register the 4 file fields in tenant.fields (per-tenant)
--   3. RPCs: review_stage1_ncr_rca, submit_stage1_tech_findings,
--            close_stage1_audit, accept_stage1_tech_review
--   4. Extend finalize_file_upload for stage1_report / stage1_ncr
--      (CRM/Auditor gated) and stage1_ncr_rca (linked-client gated)
--
-- Status flow (status__a — plain text convention, no DB constraint):
--   Stage1_Report_Uploaded → Stage1_NCR_Uploaded → Stage1_NCR_RCA_Uploaded
--   → Stage1_Auditor_Accepted → Stage1_Tech_Findings_Given → Stage1_Closed
--   → Stage1_Complete
-- ============================================================

-- -----------------------------------------------
-- 1. Columns
-- File fields use the clean naming convention (field name without __a in
-- tenant.fields; finalize_file_upload appends __a for the column).
-- -----------------------------------------------
ALTER TABLE tenant.external_clients__a
  ADD COLUMN IF NOT EXISTS "stage1_report__a"                    JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "stage1_report_uploaded_date__a"      DATE,
  ADD COLUMN IF NOT EXISTS "stage1_ncr__a"                       JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "stage1_ncr_uploaded_date__a"         DATE,
  ADD COLUMN IF NOT EXISTS "stage1_ncr_rca__a"                   JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "stage1_ncr_rca_uploaded_date__a"     DATE,
  ADD COLUMN IF NOT EXISTS "stage1_auditor_accepted_date__a"     DATE,
  ADD COLUMN IF NOT EXISTS "stage1_rejection_notes__a"           TEXT,
  ADD COLUMN IF NOT EXISTS "stage1_tech_findings_notes__a"       TEXT,
  ADD COLUMN IF NOT EXISTS "stage1_tech_findings_file__a"        JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "stage1_tech_findings_date__a"        DATE,
  ADD COLUMN IF NOT EXISTS "stage1_closure_notes__a"             TEXT,
  ADD COLUMN IF NOT EXISTS "stage1_closed_date__a"               DATE,
  ADD COLUMN IF NOT EXISTS "stage1_tech_final_accepted_date__a"  DATE,
  ADD COLUMN IF NOT EXISTS "stage1_tech_final_rejection_notes__a" TEXT;

-- -----------------------------------------------
-- 2. Register the 4 file fields in tenant.fields
-- Required so finalize_file_upload / get_tenant_fields can resolve them.
-- Date/text columns are NOT registered here — tenant.get_object_records
-- returns every physical column, so the workflow bar reads them directly.
-- -----------------------------------------------
DO $$
DECLARE
  _tenant_id UUID;
  _object_id UUID;
BEGIN
  FOR _tenant_id IN SELECT id FROM system.tenants LOOP
    SELECT id INTO _object_id FROM tenant.objects
    WHERE tenant_id = _tenant_id AND name = 'external_clients__a' LIMIT 1;
    IF _object_id IS NULL THEN CONTINUE; END IF;

    INSERT INTO tenant.fields (id, tenant_id, object_id, name, label, type, is_required, is_system_field, display_order, created_at, updated_at)
    VALUES
      (gen_random_uuid(), _tenant_id, _object_id, 'stage1_report',             'Stage 1 Report',              'file', false, false, 101, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'stage1_ncr',                'Stage 1 NCR',                 'file', false, false, 102, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'stage1_ncr_rca',            'Stage 1 NCR (Root Cause)',    'file', false, false, 103, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'stage1_tech_findings_file', 'Stage 1 Tech Findings File',  'file', false, false, 104, now(), now())
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- -----------------------------------------------
-- 3a. review_stage1_ncr_rca
--     Auditor (or admin) accepts/rejects the client's root-cause response.
--     accept → Stage1_Auditor_Accepted + stamp date
--     reject → Stage1_NCR_Uploaded (client re-uploads RCA) + store notes
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION public.review_stage1_ncr_rca(
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
  _custom_role   TEXT;
  _current_status TEXT;
BEGIN
  _caller_id := auth.uid();

  SELECT su.tenant_id, su.role INTO _caller_tenant, _caller_role
  FROM system.users su WHERE su.id = _caller_id;

  SELECT r.name INTO _custom_role
  FROM system.users su
  JOIN tenant.roles r ON r.id = su.custom_role_id
  WHERE su.id = _caller_id;

  IF _caller_role != 'admin'
     AND (lower(coalesce(_custom_role, '')) NOT LIKE '%auditor%') THEN
    RETURN QUERY SELECT false, 'Access denied: Auditor role required';
    RETURN;
  END IF;

  SELECT ec.status__a INTO _current_status
  FROM tenant.external_clients__a ec
  WHERE ec.id = p_record_id AND ec.tenant_id = _caller_tenant;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Record not found';
    RETURN;
  END IF;

  IF p_action = 'accept' THEN
    UPDATE tenant.external_clients__a
    SET status__a                        = 'Stage1_Auditor_Accepted',
        "stage1_auditor_accepted_date__a" = CURRENT_DATE,
        "stage1_rejection_notes__a"       = NULL,
        updated_at                        = NOW()
    WHERE id = p_record_id AND tenant_id = _caller_tenant;
    RETURN QUERY SELECT true, 'Stage 1 root-cause accepted';

  ELSIF p_action = 'reject' THEN
    UPDATE tenant.external_clients__a
    SET status__a                  = 'Stage1_NCR_Uploaded',
        "stage1_rejection_notes__a" = p_notes,
        updated_at                  = NOW()
    WHERE id = p_record_id AND tenant_id = _caller_tenant;
    RETURN QUERY SELECT true, 'Stage 1 root-cause rejected — awaiting client re-upload';

  ELSE
    RETURN QUERY SELECT false, 'Invalid action: use accept or reject';
  END IF;
END;
$$;

-- -----------------------------------------------
-- 3b. submit_stage1_tech_findings
--     Tech Reviewer (or admin) records findings and advances the record.
--     One-way: Stage1_Tech_Findings_Given + notes + date.
--     (The optional findings file is uploaded separately via the
--      stage1_tech_findings_file field.)
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_stage1_tech_findings(
  p_record_id UUID,
  p_notes     TEXT DEFAULT NULL
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

  SELECT r.name INTO _custom_role
  FROM system.users su
  JOIN tenant.roles r ON r.id = su.custom_role_id
  WHERE su.id = _caller_id;

  IF _caller_role != 'admin'
     AND (lower(coalesce(_custom_role, '')) NOT LIKE '%tech%') THEN
    RETURN QUERY SELECT false, 'Access denied: Tech Reviewer role required';
    RETURN;
  END IF;

  SELECT ec.status__a INTO _current_status
  FROM tenant.external_clients__a ec
  WHERE ec.id = p_record_id AND ec.tenant_id = _caller_tenant;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Record not found';
    RETURN;
  END IF;

  UPDATE tenant.external_clients__a
  SET status__a                    = 'Stage1_Tech_Findings_Given',
      "stage1_tech_findings_notes__a" = p_notes,
      "stage1_tech_findings_date__a"  = CURRENT_DATE,
      updated_at                    = NOW()
  WHERE id = p_record_id AND tenant_id = _caller_tenant;

  RETURN QUERY SELECT true, 'Stage 1 tech-review findings submitted';
END;
$$;

-- -----------------------------------------------
-- 3c. close_stage1_audit
--     Auditor (or admin) closes the Stage 1 audit after findings.
--     One-way: Stage1_Closed + closure notes + date.
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION public.close_stage1_audit(
  p_record_id     UUID,
  p_closure_notes TEXT DEFAULT NULL
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

  SELECT r.name INTO _custom_role
  FROM system.users su
  JOIN tenant.roles r ON r.id = su.custom_role_id
  WHERE su.id = _caller_id;

  IF _caller_role != 'admin'
     AND (lower(coalesce(_custom_role, '')) NOT LIKE '%auditor%') THEN
    RETURN QUERY SELECT false, 'Access denied: Auditor role required';
    RETURN;
  END IF;

  SELECT ec.status__a INTO _current_status
  FROM tenant.external_clients__a ec
  WHERE ec.id = p_record_id AND ec.tenant_id = _caller_tenant;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Record not found';
    RETURN;
  END IF;

  UPDATE tenant.external_clients__a
  SET status__a               = 'Stage1_Closed',
      "stage1_closure_notes__a" = p_closure_notes,
      "stage1_closed_date__a"   = CURRENT_DATE,
      updated_at              = NOW()
  WHERE id = p_record_id AND tenant_id = _caller_tenant;

  RETURN QUERY SELECT true, 'Stage 1 audit closed';
END;
$$;

-- -----------------------------------------------
-- 3d. accept_stage1_tech_review
--     Tech Reviewer (or admin) gives the final sign-off on the closed audit.
--     accept → Stage1_Complete + stamp date
--     reject → Stage1_Tech_Findings_Given (auditor re-closes) + store notes
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_stage1_tech_review(
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
  _custom_role   TEXT;
  _current_status TEXT;
BEGIN
  _caller_id := auth.uid();

  SELECT su.tenant_id, su.role INTO _caller_tenant, _caller_role
  FROM system.users su WHERE su.id = _caller_id;

  SELECT r.name INTO _custom_role
  FROM system.users su
  JOIN tenant.roles r ON r.id = su.custom_role_id
  WHERE su.id = _caller_id;

  IF _caller_role != 'admin'
     AND (lower(coalesce(_custom_role, '')) NOT LIKE '%tech%') THEN
    RETURN QUERY SELECT false, 'Access denied: Tech Reviewer role required';
    RETURN;
  END IF;

  SELECT ec.status__a INTO _current_status
  FROM tenant.external_clients__a ec
  WHERE ec.id = p_record_id AND ec.tenant_id = _caller_tenant;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Record not found';
    RETURN;
  END IF;

  IF p_action = 'accept' THEN
    UPDATE tenant.external_clients__a
    SET status__a                           = 'Stage1_Complete',
        "stage1_tech_final_accepted_date__a"  = CURRENT_DATE,
        "stage1_tech_final_rejection_notes__a" = NULL,
        updated_at                           = NOW()
    WHERE id = p_record_id AND tenant_id = _caller_tenant;
    RETURN QUERY SELECT true, 'Stage 1 tech review accepted — stage complete';

  ELSIF p_action = 'reject' THEN
    UPDATE tenant.external_clients__a
    SET status__a                           = 'Stage1_Tech_Findings_Given',
        "stage1_tech_final_rejection_notes__a" = p_notes,
        updated_at                           = NOW()
    WHERE id = p_record_id AND tenant_id = _caller_tenant;
    RETURN QUERY SELECT true, 'Stage 1 tech review rejected — reverted to findings for re-closure';

  ELSE
    RETURN QUERY SELECT false, 'Invalid action: use accept or reject';
  END IF;
END;
$$;

-- -----------------------------------------------
-- 4. Extend finalize_file_upload
--    Reproduces the current definition (migration 221) verbatim and appends
--    the Stage 1 auto-advance blocks. All existing behavior is preserved.
--
--    stage1_report / stage1_ncr → CRM Office / Auditor / admin
--    stage1_ncr_rca             → linked client / admin
--    stage1_tech_findings_file  → no auto-advance (advance is via
--                                 submit_stage1_tech_findings RPC)
-- -----------------------------------------------
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
  _is_crm_or_auditor BOOLEAN := false;
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

  -- ── external_clients__a: Stage 1 audit uploads ───────────────
  IF _object_name = 'external_clients__a' THEN
    -- Stage 1 report / NCR: CRM Office, Auditor, or admin
    IF _field_name = 'stage1_report' AND _is_crm_or_auditor THEN
      UPDATE tenant.external_clients__a
      SET status__a = 'Stage1_Report_Uploaded',
          "stage1_report_uploaded_date__a" = CURRENT_DATE,
          updated_at = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id;

    ELSIF _field_name = 'stage1_ncr' AND _is_crm_or_auditor THEN
      UPDATE tenant.external_clients__a
      SET status__a = 'Stage1_NCR_Uploaded',
          "stage1_ncr_uploaded_date__a" = CURRENT_DATE,
          updated_at = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id;

    ELSIF _field_name = 'stage1_ncr_rca' THEN
      -- Root-cause response: linked client or admin
      SELECT ec.client_user_id__a INTO _client_user_id
      FROM tenant.external_clients__a ec
      WHERE ec.id = _attachment.record_id AND ec.tenant_id = _tenant_id;

      IF _caller_role = 'admin' OR _client_user_id = _auth_user_id THEN
        UPDATE tenant.external_clients__a
        SET status__a = 'Stage1_NCR_RCA_Uploaded',
            "stage1_ncr_rca_uploaded_date__a" = CURRENT_DATE,
            updated_at = NOW()
        WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT true, 'File upload finalized successfully', _file_metadata;
END;
$$;

-- -----------------------------------------------
-- 5. Grants
-- -----------------------------------------------
GRANT EXECUTE ON FUNCTION public.review_stage1_ncr_rca(UUID, TEXT, TEXT)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_stage1_tech_findings(UUID, TEXT)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_stage1_audit(UUID, TEXT)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_stage1_tech_review(UUID, TEXT, TEXT)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_file_upload(UUID, BIGINT, TEXT)     TO authenticated;
