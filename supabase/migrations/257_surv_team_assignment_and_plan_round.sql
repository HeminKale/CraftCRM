-- ============================================================
-- Migration 257: Surveillance 1 (Renewal) — Sprint 1 backend
-- Team Assignment + Plan Round
--
-- Part of UAF New Changes/New Help Doc/Renewal/Sprints/00_Sprint_Plan.md,
-- Sprint 1. Follows the External Client Stage 1/2 precedent throughout
-- (migrations 237, 238, 244): assign-team gate, plan-round checkpoint with
-- remarks cleared on every re-upload (not just on accept), status__a
-- registered in tenant.picklist_values from the start.
--
-- Deliberate note on naming: this introduces a NEW column
-- surv_audit_plan__a / NEW RPC review_surv_plan, rather than reusing the
-- original surveillance_audit_plan__a / review_surveillance_audit_plan
-- from migration 221. The original pair predates the team-assignment gate
-- and the remarks-clear-on-reupload fix and lands on a different status
-- name (Audit_Plan_Sent/Accepted vs. Surv_Plan_Sent/Accepted). Rather than
-- mutate a field/RPC that may already be referenced elsewhere, this ships
-- as a fresh pair — the old ones are left in place, unused by the new flow,
-- same "don't delete, just stop wiring it up" convention this app already
-- follows for other superseded fields.
-- ============================================================

-- ================================================================
-- PART A — surveillance_audit_date__a: DATE -> TEXT
-- Free-text manual entry, no status implication — matches Stage 2's
-- audit-date field and the corrected Stage 1 convention (238). Skips the
-- DATE->TEXT rework Stage 1 needed later by doing it here from the start.
-- ================================================================
ALTER TABLE tenant.renewal_clients__a
  ALTER COLUMN "surveillance_audit_date__a" TYPE TEXT
  USING "surveillance_audit_date__a"::TEXT;

UPDATE tenant.fields f
SET type = 'text', updated_at = now()
FROM tenant.objects o
WHERE f.object_id = o.id AND o.name = 'renewal_clients__a' AND f.name = 'surveillance_audit_date';

-- ================================================================
-- PART B — New columns
-- ================================================================
ALTER TABLE tenant.renewal_clients__a
  ADD COLUMN IF NOT EXISTS "auditor_id__a"               UUID REFERENCES system.users(id),
  ADD COLUMN IF NOT EXISTS "tech_reviewer_id__a"          UUID REFERENCES system.users(id),
  ADD COLUMN IF NOT EXISTS "team_assigned_date__a"        DATE,
  ADD COLUMN IF NOT EXISTS "surv_audit_plan__a"           JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "surv_plan_sent_date__a"       DATE,
  ADD COLUMN IF NOT EXISTS "surv_plan_accepted_date__a"   DATE,
  ADD COLUMN IF NOT EXISTS "surv_plan_client_remarks__a"  TEXT;

-- auditor_id__a / tech_reviewer_id__a deliberately NOT registered in
-- tenant.fields — same reasoning as External Client's equivalent (244):
-- set exclusively through assign_surv_team, which validates the chosen
-- user actually holds the right custom role. Registering them would let
-- anyone with generic field-edit access set an arbitrary user id directly.

-- ================================================================
-- PART C — Register new fields
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
      (gen_random_uuid(), _tenant_id, _object_id, 'surv_audit_plan',          'Surveillance Audit Plan',       'file', false, false, 19, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'surv_plan_sent_date',      'Plan Sent Date',                'date', false, false, 20, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'surv_plan_accepted_date',  'Plan Accepted Date',            'date', false, false, 21, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'surv_plan_client_remarks', 'Plan — Client Remarks',         'text', false, false, 22, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'team_assigned_date',       'Team Assigned Date',            'date', false, false, 23, now(), now())
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- ================================================================
-- PART D — status__a picklist values
-- Backfills the five statuses that already existed live but were never
-- registered (a gap Stage 1 didn't close until migration 237), then adds
-- this sprint's new value. Closing the gap from day one instead of hitting
-- it later, per the sprint plan.
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
        ('Intimation_Sent',      'Intimation Sent',      1),
        ('Intimation_Accepted',  'Intimation Accepted',  2),
        ('Team_Assigned',        'Team Assigned',        3),
        ('Surv_Plan_Sent',       'Audit Plan Sent',      4),
        ('Surv_Plan_Accepted',   'Audit Plan Accepted',  5),
        ('Audit_Plan_Sent',      'Audit Plan Sent (legacy)',     90),
        ('Audit_Plan_Accepted',  'Audit Plan Accepted (legacy)', 91),
        ('Renewal_Complete',     'Renewal Complete (legacy)',    99)
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
-- PART E — assign_surv_team (NEW)
-- CRM Office / admin only. Fires right after intimation acceptance —
-- mirrors assign_stage_team's checkpoint placement and role-validation.
-- ================================================================
CREATE OR REPLACE FUNCTION public.assign_surv_team(
  p_record_id        UUID,
  p_auditor_id       UUID,
  p_tech_reviewer_id UUID
)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_id      UUID;
  _caller_tenant  UUID;
  _caller_role    TEXT;
  _custom_role    TEXT;
  _current_status TEXT;
  _auditor_role   TEXT;
  _tech_role      TEXT;
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

  IF p_auditor_id IS NULL OR p_tech_reviewer_id IS NULL THEN
    RETURN QUERY SELECT false, 'Both an Auditor and a Tech Reviewer are required';
    RETURN;
  END IF;

  SELECT rc.status__a INTO _current_status
  FROM tenant.renewal_clients__a rc
  WHERE rc.id = p_record_id AND rc.tenant_id = _caller_tenant;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Record not found';
    RETURN;
  END IF;

  IF _current_status != 'Intimation_Accepted' THEN
    RETURN QUERY SELECT false, 'Team can only be assigned right after the client accepts the intimation letter';
    RETURN;
  END IF;

  -- Validate the chosen users actually hold the matching role
  SELECT r.name INTO _auditor_role
  FROM system.users su JOIN tenant.roles r ON r.id = su.custom_role_id
  WHERE su.id = p_auditor_id AND su.tenant_id = _caller_tenant;

  IF _auditor_role IS NULL OR lower(_auditor_role) NOT LIKE '%auditor%' THEN
    RETURN QUERY SELECT false, 'Chosen Auditor does not hold the Auditor role';
    RETURN;
  END IF;

  SELECT r.name INTO _tech_role
  FROM system.users su JOIN tenant.roles r ON r.id = su.custom_role_id
  WHERE su.id = p_tech_reviewer_id AND su.tenant_id = _caller_tenant;

  IF _tech_role IS NULL OR lower(_tech_role) NOT LIKE '%tech%' THEN
    RETURN QUERY SELECT false, 'Chosen Tech Reviewer does not hold the Tech Reviewer role';
    RETURN;
  END IF;

  UPDATE tenant.renewal_clients__a
  SET status__a              = 'Team_Assigned',
      "auditor_id__a"        = p_auditor_id,
      "tech_reviewer_id__a"  = p_tech_reviewer_id,
      "team_assigned_date__a" = CURRENT_DATE,
      updated_at             = NOW()
  WHERE id = p_record_id AND tenant_id = _caller_tenant;

  RETURN QUERY SELECT true, 'Auditor and Tech Reviewer assigned';
END;
$$;

-- ================================================================
-- PART F — review_surv_plan (NEW)
-- Linked client (or admin) accepts/rejects the surveillance audit plan.
-- Mirrors review_stage1_plan exactly: accept → Surv_Plan_Accepted + stamp
-- date + clear remarks; reject → stays on Surv_Plan_Sent + store remarks
-- so CRM/Auditor can revise and re-upload.
-- ================================================================
CREATE OR REPLACE FUNCTION public.review_surv_plan(
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
  FROM tenant.renewal_clients__a rc
  WHERE rc.id = p_record_id AND rc.tenant_id = _caller_tenant;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Record not found';
    RETURN;
  END IF;

  IF _caller_role != 'admin' AND _client_user_id IS DISTINCT FROM _caller_id THEN
    RETURN QUERY SELECT false, 'Access denied: only the linked client can review the audit plan';
    RETURN;
  END IF;

  IF p_action = 'accept' THEN
    UPDATE tenant.renewal_clients__a
    SET status__a                      = 'Surv_Plan_Accepted',
        "surv_plan_accepted_date__a"   = CURRENT_DATE,
        "surv_plan_client_remarks__a"  = NULL,
        updated_at                     = NOW()
    WHERE id = p_record_id AND tenant_id = _caller_tenant;
    RETURN QUERY SELECT true, 'Surveillance audit plan accepted';

  ELSIF p_action = 'reject' THEN
    UPDATE tenant.renewal_clients__a
    SET status__a                     = 'Surv_Plan_Sent',
        "surv_plan_client_remarks__a" = p_notes,
        updated_at                    = NOW()
    WHERE id = p_record_id AND tenant_id = _caller_tenant;
    RETURN QUERY SELECT true, 'Surveillance audit plan rejected — awaiting revised plan';

  ELSE
    RETURN QUERY SELECT false, 'Invalid action: use accept or reject';
  END IF;
END;
$$;

-- ================================================================
-- PART G — finalize_file_upload (REDEFINED — supersedes 255)
-- Reproduces 255's body verbatim, adding one new block: surv_audit_plan
-- upload by CRM/Auditor/admin auto-advances to Surv_Plan_Sent and clears
-- any prior client remarks on EVERY (re-)upload, not just on accept —
-- building the 238 remarks-clearing fix in from day one instead of hitting
-- the same bug later.
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
  -- Left in place, unused by the new Sprint 1 flow — see module header.
  IF _object_name = 'renewal_clients__a' AND _field_name = 'surveillance_audit_plan' AND _is_crm THEN
    UPDATE tenant.renewal_clients__a
    SET status__a = 'Audit_Plan_Sent',
        audit_plan_sent_date__a = CURRENT_DATE,
        updated_at = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
  END IF;

  -- ── renewal_clients__a: surv_audit_plan upload (NEW, Sprint 1) ───────
  -- CRM Office, Auditor, or admin. Clears any prior client remarks on
  -- every (re-)upload — otherwise a stale rejection reason lingers after a
  -- revision (both land on the same Surv_Plan_Sent status).
  IF _object_name = 'renewal_clients__a' AND _field_name = 'surv_audit_plan' AND _is_crm_or_auditor THEN
    UPDATE tenant.renewal_clients__a
    SET status__a                     = 'Surv_Plan_Sent',
        "surv_plan_sent_date__a"      = CURRENT_DATE,
        "surv_plan_client_remarks__a" = NULL,
        updated_at                    = NOW()
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
-- PART H — Grants
-- ================================================================
GRANT EXECUTE ON FUNCTION public.assign_surv_team(UUID, UUID, UUID)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_surv_plan(UUID, TEXT, TEXT)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_file_upload(UUID, BIGINT, TEXT)    TO authenticated;
