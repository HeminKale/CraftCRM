-- ============================================================
-- Migration 260: Surveillance 1 (Renewal) — Sprint 3 backend
-- Audit Report, Tech Review, Checklist, CDC, Certificate Issue
--
-- Part of UAF New Changes/New Help Doc/Renewal/Sprints/00_Sprint_Plan.md,
-- Sprint 3. Reproduces 259's finalize_file_upload body verbatim (259 is
-- confirmed the latest redefinition) and extends it.
--
-- Reuses two existing columns from migration 221 instead of duplicating
-- them: surveillance_audit_report__a and surveillance_certificates__a /
-- certificates_sent_date__a — these were never wired to a working RPC
-- flow for this checkpoint shape, so no naming collision risk like the
-- surv_audit_plan__a situation in Sprint 1.
--
-- One decision beyond a literal plan reading, flagged for confirmation
-- (same as Sprint 2's two flagged items):
--   - surveillance_audit_report upload only advances status while the
--     record is still at Surv_Auditor_Accepted or Surv_Report_Sent — the
--     same re-upload status guard migration 249 added for External Client
--     after a late-arriving revision silently rewound a record that had
--     already moved past Tech Review/Closure/CDC/Certificate. Built in
--     from day one here instead of waiting to hit the same bug.
-- ============================================================

-- ================================================================
-- PART A — New columns
-- ================================================================
ALTER TABLE tenant.renewal_clients__a
  ADD COLUMN IF NOT EXISTS "surv_report_sent_date__a"    DATE,
  ADD COLUMN IF NOT EXISTS "surv_tech_findings_notes__a" TEXT,
  ADD COLUMN IF NOT EXISTS "surv_tech_findings_file__a"  JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "surv_tech_findings_date__a"  DATE,
  ADD COLUMN IF NOT EXISTS "surv_closure_notes__a"       TEXT,
  ADD COLUMN IF NOT EXISTS "surv_closed_date__a"         DATE,
  ADD COLUMN IF NOT EXISTS "cdc_report__a"               JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "cdc_date__a"                 DATE;

-- ================================================================
-- PART B — Register new fields
-- surveillance_audit_report / surveillance_certificates / certificates_sent_date
-- are already registered (migration 221) — nothing to add for those three.
-- ================================================================
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
      (gen_random_uuid(), _tenant_id, _object_id, 'surv_report_sent_date',    'Report Sent Date',              'date', false, false, 30, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'surv_tech_findings_notes','Tech Review Findings',           'text', false, false, 31, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'surv_tech_findings_file', 'Tech Review Checklist',          'file', false, false, 32, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'surv_tech_findings_date', 'Tech Review Date',               'date', false, false, 33, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'surv_closure_notes',      'Closure Notes',                  'text', false, false, 34, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'surv_closed_date',        'Closed Date',                    'date', false, false, 35, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'cdc_report',              'CDC Report',                     'file', false, false, 36, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'cdc_date',                'CDC Date',                       'date', false, false, 37, now(), now())
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- ================================================================
-- PART C — status__a picklist values
-- ================================================================
DO $$
DECLARE
  _tenant_id UUID;
  _object_id UUID;
  _field_id  UUID;
  _row       RECORD;
BEGIN
  FOR _tenant_id IN SELECT id FROM system.tenants LOOP
    SELECT id INTO _object_id FROM tenant.objects
    WHERE tenant_id = _tenant_id AND name = 'renewal_clients__a' LIMIT 1;
    IF _object_id IS NULL THEN CONTINUE; END IF;

    SELECT id INTO _field_id FROM tenant.fields
    WHERE object_id = _object_id AND name = 'status' LIMIT 1;
    IF _field_id IS NULL THEN CONTINUE; END IF;

    FOR _row IN
      SELECT * FROM (VALUES
        ('Surv_Report_Sent',        'Audit Report Sent',        9),
        ('Surv_Tech_Findings_Given','Tech Review Findings Given', 10),
        ('Surv_Closed',             'Audit Closed',             11),
        ('CDC_Approved',            'CDC Approved',             12),
        ('Certificate_Issued',      'Certificate Issued',       13)
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

-- ================================================================
-- PART D — submit_surv_tech_findings (NEW)
-- Tech Reviewer/admin, gated to the SPECIFIC assigned tech_reviewer_id__a
-- (same convention as Sprint 2's review_surv_ncr_rca; mirrors migration
-- 244's tightening of submit_stage1_tech_findings). p_notes optional —
-- blank is a valid "no findings" submission, not an error; either way
-- advances to Surv_Tech_Findings_Given. Deliberately does NOT implement
-- External Client's later revision-loop-back (migration 253) — that was a
-- separate stakeholder request specific to that object and isn't in the
-- SURV1 rights matrix or the sprint plan for this one.
-- ================================================================
CREATE OR REPLACE FUNCTION public.submit_surv_tech_findings(
  p_record_id UUID,
  p_notes     TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_id        UUID;
  _caller_tenant    UUID;
  _caller_role      TEXT;
  _custom_role      TEXT;
  _assigned_tech_id UUID;
BEGIN
  _caller_id := auth.uid();

  SELECT su.tenant_id, su.role INTO _caller_tenant, _caller_role
  FROM system.users su WHERE su.id = _caller_id;

  SELECT r.name INTO _custom_role
  FROM system.users su
  JOIN tenant.roles r ON r.id = su.custom_role_id
  WHERE su.id = _caller_id;

  IF _caller_role != 'admin' AND (lower(coalesce(_custom_role, '')) NOT LIKE '%tech%') THEN
    RETURN QUERY SELECT false, 'Access denied: Tech Reviewer role required';
    RETURN;
  END IF;

  SELECT rc.tech_reviewer_id__a INTO _assigned_tech_id
  FROM tenant.renewal_clients__a rc
  WHERE rc.id = p_record_id AND rc.tenant_id = _caller_tenant;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Record not found';
    RETURN;
  END IF;

  IF _caller_role != 'admin' AND _assigned_tech_id IS DISTINCT FROM _caller_id THEN
    RETURN QUERY SELECT false, 'Access denied: you are not the tech reviewer assigned to this record';
    RETURN;
  END IF;

  UPDATE tenant.renewal_clients__a
  SET status__a                    = 'Surv_Tech_Findings_Given',
      "surv_tech_findings_notes__a" = p_notes,
      "surv_tech_findings_date__a"  = CURRENT_DATE,
      updated_at                   = NOW()
  WHERE id = p_record_id AND tenant_id = _caller_tenant;

  RETURN QUERY SELECT true, 'Tech review findings submitted';
END;
$$;

-- ================================================================
-- PART E — close_surv_audit (NEW)
-- Auditor/admin only, gated to the SPECIFIC assigned auditor_id__a.
-- Terminal-for-this-checkpoint action; Certificate Issue (CRM) follows.
-- ================================================================
CREATE OR REPLACE FUNCTION public.close_surv_audit(
  p_record_id     UUID,
  p_closure_notes TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_id           UUID;
  _caller_tenant       UUID;
  _caller_role         TEXT;
  _custom_role         TEXT;
  _assigned_auditor_id UUID;
BEGIN
  _caller_id := auth.uid();

  SELECT su.tenant_id, su.role INTO _caller_tenant, _caller_role
  FROM system.users su WHERE su.id = _caller_id;

  SELECT r.name INTO _custom_role
  FROM system.users su
  JOIN tenant.roles r ON r.id = su.custom_role_id
  WHERE su.id = _caller_id;

  IF _caller_role != 'admin' AND (lower(coalesce(_custom_role, '')) NOT LIKE '%auditor%') THEN
    RETURN QUERY SELECT false, 'Access denied: Auditor role required';
    RETURN;
  END IF;

  SELECT rc.auditor_id__a INTO _assigned_auditor_id
  FROM tenant.renewal_clients__a rc
  WHERE rc.id = p_record_id AND rc.tenant_id = _caller_tenant;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Record not found';
    RETURN;
  END IF;

  IF _caller_role != 'admin' AND _assigned_auditor_id IS DISTINCT FROM _caller_id THEN
    RETURN QUERY SELECT false, 'Access denied: you are not the auditor assigned to this record';
    RETURN;
  END IF;

  UPDATE tenant.renewal_clients__a
  SET status__a              = 'Surv_Closed',
      "surv_closure_notes__a" = p_closure_notes,
      "surv_closed_date__a"   = CURRENT_DATE,
      updated_at             = NOW()
  WHERE id = p_record_id AND tenant_id = _caller_tenant;

  RETURN QUERY SELECT true, 'Surveillance audit closed';
END;
$$;

-- ================================================================
-- PART F — finalize_file_upload (REDEFINED — supersedes 259)
-- Reproduces 259's body verbatim, adding surveillance_audit_report,
-- surv_tech_findings_file, cdc_report, surveillance_certificates blocks.
-- ================================================================
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

  -- ── renewal_clients__a: surv_audit_plan upload (Sprint 1) ────────────
  IF _object_name = 'renewal_clients__a' AND _field_name = 'surv_audit_plan' AND _is_crm_or_auditor THEN
    UPDATE tenant.renewal_clients__a
    SET status__a                     = 'Surv_Plan_Sent',
        "surv_plan_sent_date__a"      = CURRENT_DATE,
        "surv_plan_client_remarks__a" = NULL,
        updated_at                    = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
  END IF;

  -- ── renewal_clients__a: surv_ncr upload (Sprint 2) ───────────────────
  IF _object_name = 'renewal_clients__a' AND _field_name = 'surv_ncr' AND _is_crm_or_auditor THEN
    UPDATE tenant.renewal_clients__a
    SET status__a                = 'Surv_NCR_Sent',
        "surv_ncr_sent_date__a"  = CURRENT_DATE,
        updated_at               = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
  END IF;

  -- ── renewal_clients__a: surv_ncr_rca upload (Sprint 2) ───────────────
  IF _object_name = 'renewal_clients__a' AND _field_name = 'surv_ncr_rca' THEN
    SELECT rc.client_user_id__a INTO _client_user_id
    FROM tenant.renewal_clients__a rc
    WHERE rc.id = _attachment.record_id AND rc.tenant_id = _tenant_id;

    IF _caller_role = 'admin' OR _client_user_id = _auth_user_id THEN
      UPDATE tenant.renewal_clients__a
      SET status__a                       = 'Surv_NCR_RCA_Uploaded',
          "surv_ncr_rca_uploaded_date__a" = CURRENT_DATE,
          updated_at                      = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
    END IF;
  END IF;

  -- ── renewal_clients__a: surveillance_audit_report upload (NEW, Sprint 3)
  -- CRM/Auditor/admin. Re-upload status guard (mirrors migration 249's
  -- fix for External Client, built in from the start here): only
  -- advances/lands on Surv_Report_Sent while the record is still at the
  -- checkpoint where that's meaningful — a later revision still saves the
  -- file but won't rewind status__a past Tech Review/Closure/CDC/Cert.
  IF _object_name = 'renewal_clients__a' AND _field_name = 'surveillance_audit_report' AND _is_crm_or_auditor THEN
    UPDATE tenant.renewal_clients__a
    SET status__a                 = 'Surv_Report_Sent',
        "surv_report_sent_date__a" = CURRENT_DATE,
        updated_at                = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id
      AND status__a IN ('Surv_Auditor_Accepted', 'Surv_Report_Sent');
  END IF;

  -- ── renewal_clients__a: surv_tech_findings_file upload (NEW, Sprint 3)
  -- Tech Reviewer (or admin) ONLY — stricter than External Client's
  -- equivalent field, which has no upload gate at all today (a known,
  -- flagged gap there). Optional supporting file — no status advance
  -- regardless of role; submit_surv_tech_findings (Part D) drives the
  -- checkpoint. The role check (_is_tech) exists purely so a future
  -- "hard block wrong-role uploads outright" decision has something to
  -- key off of in start_file_upload — nothing to do here today since this
  -- field has no status side-effect either way (soft-gate-by-default: the
  -- file attach above already happened regardless of role).

  -- ── renewal_clients__a: cdc_report upload (NEW, Sprint 3) ────────────
  -- CDC role or admin ONLY (mirrors migration 243). Upload IS the
  -- approval — no separate accept step.
  IF _object_name = 'renewal_clients__a' AND _field_name = 'cdc_report' AND _is_cdc THEN
    UPDATE tenant.renewal_clients__a
    SET status__a    = 'CDC_Approved',
        "cdc_date__a" = CURRENT_DATE,
        updated_at   = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
  END IF;

  -- ── renewal_clients__a: surveillance_certificates upload (NEW, Sprint 3)
  -- CRM/admin ONLY. Terminal status for this plan.
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

  RETURN QUERY SELECT true, 'File upload finalized successfully', _file_metadata;
END;
$$;

-- ================================================================
-- PART G — Grants
-- ================================================================
GRANT EXECUTE ON FUNCTION public.submit_surv_tech_findings(UUID, TEXT)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_surv_audit(UUID, TEXT)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_file_upload(UUID, BIGINT, TEXT)  TO authenticated;
