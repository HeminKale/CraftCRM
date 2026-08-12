-- ============================================================
-- Migration 268: Recertification — Sprint 4
-- Audit Report, Tech Review, Checklist, CDC, Certificate Issue
--
-- Part of UAF New Changes/New Help Doc/Recertification/00_Sprint_Plan.md,
-- Sprint 4 — the last backend sprint before Sprint 5's frontend build.
-- Mirrors Surveillance 1's Sprint 3 (migration 260) for the RPC shapes
-- (submit_recert_tech_findings / close_recert_audit), with ALL hard upload
-- gates shipped in THIS migration rather than split across two files the
-- way Surveillance 1's were: 260 built the RPCs and soft gates only, and
-- `surv_tech_findings_file`/`cdc_report` didn't get their Tech-only/
-- CDC-only hard `start_file_upload` blocks until migration 261, a
-- follow-up. The plan doc calls for "from day one" gating here, so both
-- hard gates are added directly below, not deferred.
--
-- Unlike Surveillance 1 (which reused two pre-existing fields from
-- migration 221 — surveillance_audit_report__a and
-- surveillance_certificates__a — since they already existed unused),
-- Recertification has no equivalent legacy fields to inherit: this is a
-- brand-new table, so recert_audit_report__a and recert_certificates__a
-- are both new columns here, not reused ones. No naming-collision risk
-- either way.
--
-- Verified before writing: read 267_recertification_ncr_rca_evidences.sql
-- in full and reproduced its start_file_upload/finalize_file_upload bodies
-- exactly (extracted via sed from the live file) — confirmed 267 is still
-- the latest redefinition of both before extending them here.
--
-- 1. New columns on tenant.recertification_clients__a.
-- 2. Register Sprint 4 fields in tenant.fields.
-- 3. Register this sprint's five new status__a picklist values — the
--    19th and final value for this epic's status flow (matches the plan
--    doc's "19 statuses" count exactly: 1 + 5 + 3 + 5 + 5).
-- 4. RPC: submit_recert_tech_findings — Tech Reviewer/admin,
--    specific-assigned tech_reviewer_id__a.
-- 5. RPC: close_recert_audit — Auditor/admin, specific-assigned
--    auditor_id__a.
-- 6. start_file_upload — reproduces 267's full body verbatim + adds
--    recert_audit_report (CRM-or-Auditor), recert_tech_findings_file
--    (Tech-only), recert_cdc_report (CDC-only), recert_certificates
--    (CRM-only) hard gates — all four shipped here, none deferred.
-- 7. finalize_file_upload — reproduces 267's full body verbatim + adds
--    the four upload auto-advance blocks. recert_audit_report and
--    recert_cdc_report get re-upload status guards from day one (same
--    "don't wait for a follow-up migration" convention Sprints 2-3
--    already applied — Surveillance 1 needed migration 262 to retrofit
--    guards on its cdc_report and surveillance_audit_report equivalents).
--    recert_tech_findings_file causes no status change (supporting file
--    only — submit_recert_tech_findings drives that checkpoint, same as
--    Surveillance 1's surv_tech_findings_file). recert_certificates gets
--    no guard — terminal status for this plan, a re-upload just re-sets
--    the same terminal status, no rewind possible.
-- ============================================================

-- ── 1. New columns ─────────────────────────────────────────────────
ALTER TABLE tenant.recertification_clients__a
  ADD COLUMN IF NOT EXISTS "recert_audit_report__a"           JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "recert_report_sent_date__a"        DATE,
  ADD COLUMN IF NOT EXISTS "recert_tech_findings_notes__a"     TEXT,
  ADD COLUMN IF NOT EXISTS "recert_tech_findings_file__a"      JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "recert_tech_findings_date__a"      DATE,
  ADD COLUMN IF NOT EXISTS "recert_closure_notes__a"           TEXT,
  ADD COLUMN IF NOT EXISTS "recert_closed_date__a"             DATE,
  ADD COLUMN IF NOT EXISTS "recert_cdc_report__a"              JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "recert_cdc_date__a"                DATE,
  ADD COLUMN IF NOT EXISTS "recert_certificates__a"            JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "recert_certificates_sent_date__a"  DATE;

-- recert_certificates__a defaults to '[]'::jsonb (files, plural) — matches
-- recert_evidences__a's shape (267), not a single-object slot.

-- ── 2. Register Sprint 4 fields ─────────────────────────────────────
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
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_audit_report',          'Audit Report',                  'file',  false, false, 33, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_report_sent_date',      'Report Sent Date',              'date',  false, false, 34, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_tech_findings_notes',   'Tech Review Findings',          'text',  false, false, 35, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_tech_findings_file',    'Tech Review Checklist',         'file',  false, false, 36, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_tech_findings_date',    'Tech Review Date',              'date',  false, false, 37, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_closure_notes',         'Closure Notes',                 'text',  false, false, 38, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_closed_date',           'Closed Date',                   'date',  false, false, 39, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_cdc_report',            'CDC Report',                    'file',  false, false, 40, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_cdc_date',              'CDC Date',                      'date',  false, false, 41, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_certificates',          'Certificates',                  'files', false, false, 42, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_certificates_sent_date','Certificates Sent Date',        'date',  false, false, 43, now(), now())
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- ── 3. status__a picklist values for this sprint ────────────────────
-- Final 5 of 19 total statuses for this epic's status flow.
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
        ('Recert_Report_Sent',        'Audit Report Sent',          15),
        ('Recert_Tech_Findings_Given','Tech Review Findings Given', 16),
        ('Recert_Closed',             'Audit Closed',               17),
        ('Recert_CDC_Approved',       'CDC Approved',               18),
        ('Recert_Certificate_Issued', 'Certificate Issued',         19)
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

-- ── 4. RPC: submit_recert_tech_findings ──────────────────────────────
-- Tech Reviewer/admin, gated to the SPECIFIC assigned tech_reviewer_id__a
-- (same convention as review_recert_ncr_rca/review_recert_evidences).
-- p_notes optional — blank is a valid "no findings" submission, not an
-- error; either way advances to Recert_Tech_Findings_Given. Deliberately
-- does NOT implement External Client's later revision-loop-back
-- (migration 253) — that was a separate stakeholder request specific to
-- that object and isn't in this rights matrix or the sprint plan.
DROP FUNCTION IF EXISTS public.submit_recert_tech_findings(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.submit_recert_tech_findings(
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
  FROM tenant.recertification_clients__a rc
  WHERE rc.id = p_record_id AND rc.tenant_id = _caller_tenant;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Record not found';
    RETURN;
  END IF;

  IF _caller_role != 'admin' AND _assigned_tech_id IS DISTINCT FROM _caller_id THEN
    RETURN QUERY SELECT false, 'Access denied: you are not the tech reviewer assigned to this record';
    RETURN;
  END IF;

  UPDATE tenant.recertification_clients__a
  SET status__a                      = 'Recert_Tech_Findings_Given',
      "recert_tech_findings_notes__a" = p_notes,
      "recert_tech_findings_date__a"  = CURRENT_DATE,
      updated_at                     = NOW()
  WHERE id = p_record_id AND tenant_id = _caller_tenant;

  RETURN QUERY SELECT true, 'Tech review findings submitted';
END;
$$;

-- ── 5. RPC: close_recert_audit ───────────────────────────────────────
-- Auditor/admin only, gated to the SPECIFIC assigned auditor_id__a.
-- Terminal-for-this-checkpoint action; Certificate Issue (CRM) follows.
DROP FUNCTION IF EXISTS public.close_recert_audit(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.close_recert_audit(
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
  FROM tenant.recertification_clients__a rc
  WHERE rc.id = p_record_id AND rc.tenant_id = _caller_tenant;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Record not found';
    RETURN;
  END IF;

  IF _caller_role != 'admin' AND _assigned_auditor_id IS DISTINCT FROM _caller_id THEN
    RETURN QUERY SELECT false, 'Access denied: you are not the auditor assigned to this record';
    RETURN;
  END IF;

  UPDATE tenant.recertification_clients__a
  SET status__a               = 'Recert_Closed',
      "recert_closure_notes__a" = p_closure_notes,
      "recert_closed_date__a"   = CURRENT_DATE,
      updated_at               = NOW()
  WHERE id = p_record_id AND tenant_id = _caller_tenant;

  RETURN QUERY SELECT true, 'Recertification audit closed';
END;
$$;

-- ── 6. start_file_upload (REDEFINED — reproduces 267's full body
-- verbatim + adds recert_audit_report / recert_tech_findings_file /
-- recert_cdc_report / recert_certificates hard gates, all from day one) ──
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

  -- ── recertification_clients__a: Sprint 1 intake hard gates (265) ──

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

  -- ════════════════════════════════════════════════════════════
  -- NEW (266) — recertification_clients__a Sprint 2 hard gates
  -- ════════════════════════════════════════════════════════════

  -- ── Recert team must be assigned first (mirrors 261's surv_audit_plan
  -- gate) ──
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

  -- ── CRM-or-Auditor upload field: audit plan ──
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

  -- ════════════════════════════════════════════════════════════
  -- NEW (267) — recertification_clients__a Sprint 3 hard gates
  -- ════════════════════════════════════════════════════════════

  -- ── CRM-or-Auditor upload field: NCR ──
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

  -- ── Client-only upload fields: NCR root-cause response, evidences ──
  IF _object_name = 'recertification_clients__a' AND _field_name IN (
    'recert_ncr_rca', 'recert_evidences'
  ) THEN
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

  -- ════════════════════════════════════════════════════════════
  -- NEW (268) — recertification_clients__a Sprint 4 hard gates.
  -- All four shipped in this same migration (not split across a
  -- follow-up file the way Surveillance 1's equivalents were — 260 built
  -- the RPCs/soft gates, 261 had to add these hard gates later).
  -- ════════════════════════════════════════════════════════════

  -- ── CRM-or-Auditor upload field: audit report ──
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

  -- ── Tech-Reviewer-only upload field: findings checklist (matches
  -- Surveillance 1's improvement over External Client's still-ungated
  -- equivalent — shipped here from day one, not as a later migration) ──
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

  -- ── CDC-only upload field: CDC report (matches Surveillance 1's
  -- improvement over External Client's PS-only cdc_report — shipped here
  -- from day one) ──
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

  -- ── CRM-only upload field: certificates (terminal checkpoint) ──
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

-- ── 7. finalize_file_upload (REDEFINED — reproduces 267's full body
-- verbatim + adds the recert_audit_report / recert_tech_findings_file /
-- recert_cdc_report / recert_certificates auto-advance blocks) ──────────
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

  -- ── recertification_clients__a: Sprint 1 intake uploads (265) ──

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

  -- ════════════════════════════════════════════════════════════
  -- NEW (266) — recertification_clients__a Sprint 2 audit plan upload
  -- CRM Office, Auditor, or admin. Re-upload guard built in from day one
  -- (only advances while at the checkpoint where it's meaningful) —
  -- Surveillance 1 needed a follow-up migration (262) for this same fix;
  -- not repeating that gap here. Clears any prior client remarks on every
  -- (re-)upload so a stale rejection reason doesn't linger after a revision.
  -- ════════════════════════════════════════════════════════════
  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_audit_plan' AND _is_crm_or_auditor THEN
    UPDATE tenant.recertification_clients__a
    SET status__a                        = 'Recert_Plan_Sent',
        "recert_plan_sent_date__a"      = CURRENT_DATE,
        "recert_plan_client_remarks__a" = NULL,
        updated_at                      = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id
      AND status__a IN ('Recert_Team_Assigned', 'Recert_Plan_Sent');
  END IF;

  -- ════════════════════════════════════════════════════════════
  -- NEW (267) — recertification_clients__a Sprint 3 NCR/RCA/evidences
  -- uploads. Re-upload status guards built in from day one — same
  -- "don't wait for a follow-up migration" convention Sprint 2 already
  -- applied to recert_audit_plan (262 had to add this after the fact for
  -- Surveillance 1's equivalent fields).
  -- ════════════════════════════════════════════════════════════

  -- ── NCR: CRM-or-Auditor ──
  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_ncr' AND _is_crm_or_auditor THEN
    UPDATE tenant.recertification_clients__a
    SET status__a                  = 'Recert_NCR_Sent',
        "recert_ncr_sent_date__a" = CURRENT_DATE,
        updated_at                = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id
      AND status__a IN ('Recert_Plan_Accepted', 'Recert_NCR_Sent');
  END IF;

  -- ── NCR root-cause response: linked client or admin ONLY. Does NOT
  -- clear recert_rca_rejection_notes__a here — matches the corrected
  -- behavior from Surveillance 1's migration 259 (built in from the start,
  -- not retrofitted). Cleared only by review_recert_ncr_rca's accept
  -- branch. ──
  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_ncr_rca' THEN
    SELECT rc.client_user_id__a INTO _client_user_id
    FROM tenant.recertification_clients__a rc
    WHERE rc.id = _attachment.record_id AND rc.tenant_id = _tenant_id;

    IF _caller_role = 'admin' OR _client_user_id = _auth_user_id THEN
      UPDATE tenant.recertification_clients__a
      SET status__a                          = 'Recert_NCR_RCA_Uploaded',
          "recert_ncr_rca_uploaded_date__a" = CURRENT_DATE,
          updated_at                        = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id
        AND status__a IN ('Recert_NCR_Sent', 'Recert_NCR_RCA_Uploaded');
    END IF;
  END IF;

  -- ── Evidences: linked client or admin ONLY. Same "don't clear rejection
  -- notes on upload" convention applied for symmetry with the RCA block
  -- above — cleared only by review_recert_evidences's accept branch. ──
  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_evidences' THEN
    SELECT rc.client_user_id__a INTO _client_user_id
    FROM tenant.recertification_clients__a rc
    WHERE rc.id = _attachment.record_id AND rc.tenant_id = _tenant_id;

    IF _caller_role = 'admin' OR _client_user_id = _auth_user_id THEN
      UPDATE tenant.recertification_clients__a
      SET status__a                           = 'Recert_Evidences_Uploaded',
          "recert_evidences_uploaded_date__a" = CURRENT_DATE,
          updated_at                          = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id
        AND status__a IN ('Recert_Auditor_Accepted', 'Recert_Evidences_Uploaded');
    END IF;
  END IF;

  -- ════════════════════════════════════════════════════════════
  -- NEW (268) — recertification_clients__a Sprint 4 uploads
  -- ════════════════════════════════════════════════════════════

  -- ── Audit report: CRM/Auditor/admin. Re-upload status guard built in
  -- from day one (only advances/lands on Recert_Report_Sent while the
  -- record is still at the checkpoint where that's meaningful) — mirrors
  -- migration 262's fix for Surveillance 1's equivalent, not repeating the
  -- gap of shipping without one. ──
  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_audit_report' AND _is_crm_or_auditor THEN
    UPDATE tenant.recertification_clients__a
    SET status__a                     = 'Recert_Report_Sent',
        "recert_report_sent_date__a" = CURRENT_DATE,
        updated_at                   = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id
      AND status__a IN ('Recert_Evidences_Accepted', 'Recert_Report_Sent');
  END IF;

  -- ── Tech review checklist: Tech Reviewer only (hard-gated in
  -- start_file_upload above). Optional supporting file — no status
  -- advance regardless of role; submit_recert_tech_findings (Part 4)
  -- drives the checkpoint. Same no-op-on-upload shape as Surveillance 1's
  -- surv_tech_findings_file. ──

  -- ── CDC report: CDC role or admin ONLY. Upload IS the approval — no
  -- separate accept step. Re-upload status guard built in from day one
  -- (mirrors migration 262's fix for Surveillance 1's cdc_report). ──
  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_cdc_report' AND _is_cdc THEN
    UPDATE tenant.recertification_clients__a
    SET status__a           = 'Recert_CDC_Approved',
        "recert_cdc_date__a" = CURRENT_DATE,
        updated_at          = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id
      AND status__a IN ('Recert_Closed', 'Recert_CDC_Approved');
  END IF;

  -- ── Certificates: CRM/admin ONLY. Terminal status for this plan — no
  -- guard needed, a re-upload just re-sets the same terminal status. ──
  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_certificates' AND _is_crm THEN
    UPDATE tenant.recertification_clients__a
    SET status__a                          = 'Recert_Certificate_Issued',
        "recert_certificates_sent_date__a" = CURRENT_DATE,
        updated_at                         = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
  END IF;

  RETURN QUERY SELECT true, 'File upload finalized successfully', _file_metadata;
END;
$$;


-- ── 8. Grants ────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.submit_recert_tech_findings(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_recert_audit(UUID, TEXT)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_file_upload(UUID, UUID, UUID, TEXT, TEXT, BIGINT, JSONB) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.start_file_upload(UUID, UUID, UUID, TEXT, TEXT, BIGINT, JSONB) FROM public;
GRANT EXECUTE ON FUNCTION public.finalize_file_upload(UUID, BIGINT, TEXT) TO authenticated;
