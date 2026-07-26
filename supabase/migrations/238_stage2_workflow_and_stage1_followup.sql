-- ============================================================
-- Migration 238: External Client — Stage 2 workflow (realigned) +
--                 Stage 1 follow-up corrections
--
-- Two things in one migration because they both touch
-- finalize_file_upload and were decided together in the same review pass:
--
--   PART A — Stage 1 follow-up (corrects choices made in 237):
--     1. stage1_audit_date__a: DATE -> TEXT (confirmed: intentionally free
--        text, not a real date column, matching Stage 2's equivalent field)
--     2. stage1_ncr_rca upload no longer stamps
--        stage1_ncr_rca_uploaded_date__a. The column is NOT dropped (kept
--        for any historical data) but is retired from the flow — no RPC,
--        panel, or workflow-bar logic should read it going forward.
--
--   PART B — Stage 2, realigned the same way Stage 1 was in 237:
--     - NEW plan round: CRM/Auditor uploads Stage_two_audit_plan -> client
--       accepts/rejects (review_stage2_plan, mirrors review_stage1_plan).
--     - NEW manual "Stage 2 Audit Date" (TEXT, per the Stage 1 correction
--       above — both audit-date fields are now TEXT, not DATE).
--     - Report + NCR MERGED into one status, no date (mirrors Stage 1).
--     - stage2_ncr_rca upload no longer stamps a date (mirrors Part A.2;
--       built retired from day one rather than added then removed).
--     - review_stage2_ncr_rca / review_stage2_evidences: gate WIDENED from
--       Auditor-only to Auditor-or-CRM (mirrors 237).
--     - Tail RESTRUCTURED (deliberately, NOT a mirror of Stage 1 — confirmed
--       with stakeholder): submit_stage2_tech_findings is the only
--       tech-review action (findings optional = direct accept, same trick
--       as Stage 1). close_stage2_audit and accept_stage2_tech_review are
--       RETIRED — left defined for now, not dropped, but never called by
--       the frontend and never reached by any upload/RPC. Do not wire them
--       into new UI without re-confirming with the user.
--     - NEW: CDC report upload (CRM or Tech Reviewer or admin) auto-advances
--       directly to CDC_Approved — no separate accept step, upload IS the
--       approval.
--     - NEW: set_stage2_registration_date RPC — manual entry, but per
--       stakeholder decision it explicitly writes status__a = 'Client_Registered'
--       rather than being inferred from the date alone.
--
-- Status flow after this migration (appends to Stage 1's, same status__a
-- column, same picklist field — this is still ONE bar, not two):
--   ... Stage1_Complete ("Ready for Stage 2")
--   -> Stage2_Plan_Sent -> Stage2_Plan_Accepted -> Stage2_Report_Sent
--   -> Stage2_NCR_RCA_Uploaded -> Stage2_Auditor_Accepted
--   -> Stage2_Evidences_Uploaded -> Stage2_Evidences_Accepted ("Stage 2 NCR Closed")
--   -> Stage2_Tech_Findings_Given ("Stage 2 Tech Review Passed")
--   -> CDC_Approved -> Client_Registered
--
-- Orphaned by this migration (columns kept, never written/read going
-- forward): stage1_ncr_rca_uploaded_date__a, stage2_ncr_rca_uploaded_date__a
-- Retired by 237 (unchanged here): Stage_one_Audit_Done, Report_Sent,
--   Stage1_Report_Uploaded, Stage1_NCR_Uploaded
-- Retired by this migration: Stage2_Report_Uploaded, Stage2_NCR_Uploaded
--   (merged), Stage2_Closed (tail restructured — no longer reachable)
-- ============================================================

-- ================================================================
-- PART A — Stage 1 follow-up
-- ================================================================

-- -----------------------------------------------
-- A1. stage1_audit_date__a: DATE -> TEXT
-- -----------------------------------------------
ALTER TABLE tenant.external_clients__a
  ALTER COLUMN "stage1_audit_date__a" TYPE TEXT
  USING "stage1_audit_date__a"::TEXT;

UPDATE tenant.fields f
SET type = 'text', updated_at = now()
FROM tenant.objects o
WHERE f.object_id = o.id AND o.name = 'external_clients__a' AND f.name = 'stage1_audit_date';

-- (A2 — dropping the stage1_ncr_rca_uploaded_date__a stamp — lives inside
-- the finalize_file_upload redefinition in Part C, since that's the only
-- place that writes it.)

-- ================================================================
-- PART B — Stage 2 schema + RPCs
-- ================================================================

-- -----------------------------------------------
-- B1. New columns
-- -----------------------------------------------
ALTER TABLE tenant.external_clients__a
  ADD COLUMN IF NOT EXISTS "stage2_plan_sent_date__a"      DATE,
  ADD COLUMN IF NOT EXISTS "stage2_plan_accepted_date__a"  DATE,
  ADD COLUMN IF NOT EXISTS "stage2_plan_client_remarks__a" TEXT,
  ADD COLUMN IF NOT EXISTS "stage2_audit_date__a"          TEXT,
  ADD COLUMN IF NOT EXISTS "cdc_report__a"                 JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "cdc_date__a"                   DATE,
  ADD COLUMN IF NOT EXISTS "stage2_registration_date__a"   DATE;

-- -----------------------------------------------
-- B2. Register new fields
-- registration date is intentionally NOT registered here — it's captured
-- through StageAuditActionPanel's own date input + RPC, not the generic
-- edit form, per the stakeholder's "explicit status write" decision.
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
    SELECT gen_random_uuid(), _tenant_id, _object_id, 'stage2_audit_date', 'Stage 2 Audit Date', 'text', false, false, 121, now(), now()
    WHERE NOT EXISTS (SELECT 1 FROM tenant.fields WHERE object_id = _object_id AND name = 'stage2_audit_date');

    INSERT INTO tenant.fields (id, tenant_id, object_id, name, label, type, is_required, is_system_field, display_order, created_at, updated_at)
    SELECT gen_random_uuid(), _tenant_id, _object_id, 'cdc_report', 'CDC Report', 'file', false, false, 122, now(), now()
    WHERE NOT EXISTS (SELECT 1 FROM tenant.fields WHERE object_id = _object_id AND name = 'cdc_report');
  END LOOP;
END $$;

-- -----------------------------------------------
-- B3. Register Stage 2 status picklist values (continues Stage 1's
-- display_order sequence from 237, same field, same bar — see the module
-- header for the full order).
-- -----------------------------------------------
DO $$
DECLARE
  _tenant_id UUID;
  _object_id UUID;
  _field_id  UUID;
  _row       RECORD;
BEGIN
  FOR _tenant_id IN SELECT id FROM system.tenants LOOP
    SELECT id INTO _object_id FROM tenant.objects
    WHERE tenant_id = _tenant_id AND name = 'external_clients__a' LIMIT 1;
    IF _object_id IS NULL THEN CONTINUE; END IF;

    SELECT id INTO _field_id FROM tenant.fields
    WHERE object_id = _object_id AND name = 'status' LIMIT 1;
    IF _field_id IS NULL THEN CONTINUE; END IF;

    FOR _row IN
      SELECT * FROM (VALUES
        ('Stage2_Plan_Sent',            'Stage 2 Plan Sent',            13),
        ('Stage2_Plan_Accepted',        'Stage 2 Plan Accepted',        14),
        ('Stage2_Report_Sent',          'Stage 2 Report Sent',          15),
        ('Stage2_NCR_RCA_Uploaded',     'Stage 2 RCA Done',             16),
        ('Stage2_Auditor_Accepted',     'Stage 2 NCR + RCA Accepted',   17),
        ('Stage2_Evidences_Uploaded',   'Stage 2 Evidences Uploaded',   18),
        ('Stage2_Evidences_Accepted',   'Stage 2 NCR Closed',           19),
        ('Stage2_Tech_Findings_Given',  'Stage 2 Tech Review Passed',   20),
        ('CDC_Approved',                'CDC Approved',                 21),
        ('Client_Registered',           'Client Registered',            22)
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

    -- Retire the merged/restructured values. Stage2_Complete is NOT retired
    -- here — it's simply unreachable going forward (tail restructured), but
    -- deactivating it isn't needed since 237's precedent only deactivates
    -- values that were actively merged into something else.
    UPDATE tenant.picklist_values
    SET is_active = false, updated_at = now()
    WHERE field_id = _field_id
      AND value IN ('Stage2_Report_Uploaded', 'Stage2_NCR_Uploaded', 'Stage2_Closed');
  END LOOP;
END $$;

-- -----------------------------------------------
-- B4. Migrate live records off the merged Stage 2 statuses.
-- (No migration for Stage2_Closed / Stage2_Complete — the tail restructure
-- has no clean 1:1 target; any record already there is left as-is.)
-- -----------------------------------------------
UPDATE tenant.external_clients__a
SET status__a = 'Stage2_Report_Sent',
    updated_at = NOW()
WHERE status__a IN ('Stage2_Report_Uploaded', 'Stage2_NCR_Uploaded');

-- -----------------------------------------------
-- B5. review_stage2_plan (NEW) — mirrors review_stage1_plan exactly.
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION public.review_stage2_plan(
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

  SELECT ec.client_user_id__a INTO _client_user_id
  FROM tenant.external_clients__a ec
  WHERE ec.id = p_record_id AND ec.tenant_id = _caller_tenant;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Record not found';
    RETURN;
  END IF;

  IF _caller_role != 'admin' AND _client_user_id IS DISTINCT FROM _caller_id THEN
    RETURN QUERY SELECT false, 'Access denied: only the linked client can review the audit plan';
    RETURN;
  END IF;

  IF p_action = 'accept' THEN
    UPDATE tenant.external_clients__a
    SET status__a                       = 'Stage2_Plan_Accepted',
        "stage2_plan_accepted_date__a"  = CURRENT_DATE,
        "stage2_plan_client_remarks__a" = NULL,
        updated_at                      = NOW()
    WHERE id = p_record_id AND tenant_id = _caller_tenant;
    RETURN QUERY SELECT true, 'Stage 2 audit plan accepted';

  ELSIF p_action = 'reject' THEN
    UPDATE tenant.external_clients__a
    SET status__a                       = 'Stage2_Plan_Sent',
        "stage2_plan_client_remarks__a" = p_notes,
        updated_at                      = NOW()
    WHERE id = p_record_id AND tenant_id = _caller_tenant;
    RETURN QUERY SELECT true, 'Stage 2 audit plan rejected — awaiting revised plan';

  ELSE
    RETURN QUERY SELECT false, 'Invalid action: use accept or reject';
  END IF;
END;
$$;

-- -----------------------------------------------
-- B6. review_stage2_ncr_rca (REDEFINED — supersedes 234)
--     Gate widened to CRM Office as well as Auditor; reject repointed to
--     Stage2_Report_Sent (Stage2_NCR_Uploaded no longer exists).
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION public.review_stage2_ncr_rca(
  p_record_id UUID,
  p_action    TEXT,
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
     AND (lower(coalesce(_custom_role, '')) NOT LIKE '%auditor%')
     AND (lower(coalesce(_custom_role, '')) NOT LIKE '%crm%') THEN
    RETURN QUERY SELECT false, 'Access denied: Auditor or CRM Office role required';
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
    SET status__a                         = 'Stage2_Auditor_Accepted',
        "stage2_auditor_accepted_date__a" = CURRENT_DATE,
        "stage2_rejection_notes__a"       = NULL,
        updated_at                        = NOW()
    WHERE id = p_record_id AND tenant_id = _caller_tenant;
    RETURN QUERY SELECT true, 'Stage 2 root-cause accepted';

  ELSIF p_action = 'reject' THEN
    UPDATE tenant.external_clients__a
    SET status__a                   = 'Stage2_Report_Sent',
        "stage2_rejection_notes__a" = p_notes,
        updated_at                  = NOW()
    WHERE id = p_record_id AND tenant_id = _caller_tenant;
    RETURN QUERY SELECT true, 'Stage 2 root-cause rejected — awaiting client re-upload';

  ELSE
    RETURN QUERY SELECT false, 'Invalid action: use accept or reject';
  END IF;
END;
$$;

-- -----------------------------------------------
-- B7. review_stage2_evidences (REDEFINED — supersedes 234)
--     Gate widened to CRM Office as well as Auditor. Reject target
--     unchanged (Stage2_Auditor_Accepted still exists).
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION public.review_stage2_evidences(
  p_record_id UUID,
  p_action    TEXT,
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
     AND (lower(coalesce(_custom_role, '')) NOT LIKE '%auditor%')
     AND (lower(coalesce(_custom_role, '')) NOT LIKE '%crm%') THEN
    RETURN QUERY SELECT false, 'Access denied: Auditor or CRM Office role required';
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
    SET status__a                           = 'Stage2_Evidences_Accepted',
        "stage2_evidences_accepted_date__a" = CURRENT_DATE,
        "stage2_evidences_rejection_notes__a" = NULL,
        updated_at                          = NOW()
    WHERE id = p_record_id AND tenant_id = _caller_tenant;
    RETURN QUERY SELECT true, 'Stage 2 evidences accepted';

  ELSIF p_action = 'reject' THEN
    UPDATE tenant.external_clients__a
    SET status__a                           = 'Stage2_Auditor_Accepted',
        "stage2_evidences_rejection_notes__a" = p_notes,
        updated_at                           = NOW()
    WHERE id = p_record_id AND tenant_id = _caller_tenant;
    RETURN QUERY SELECT true, 'Stage 2 evidences rejected — awaiting client re-upload';

  ELSE
    RETURN QUERY SELECT false, 'Invalid action: use accept or reject';
  END IF;
END;
$$;

-- -----------------------------------------------
-- B8. set_stage2_registration_date (NEW)
--     Manual entry, but explicitly writes status__a per stakeholder
--     decision (not inferred from the date alone). Gated to CRM/Auditor —
--     the spec's "Manual entry" didn't name a role; this assumption should
--     be revisited if the wrong role ends up needing it.
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION public.set_stage2_registration_date(
  p_record_id UUID,
  p_date      DATE
)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_id     UUID;
  _caller_tenant UUID;
  _caller_role   TEXT;
  _custom_role   TEXT;
BEGIN
  _caller_id := auth.uid();

  SELECT su.tenant_id, su.role INTO _caller_tenant, _caller_role
  FROM system.users su WHERE su.id = _caller_id;

  SELECT r.name INTO _custom_role
  FROM system.users su
  JOIN tenant.roles r ON r.id = su.custom_role_id
  WHERE su.id = _caller_id;

  IF _caller_role != 'admin'
     AND (lower(coalesce(_custom_role, '')) NOT LIKE '%auditor%')
     AND (lower(coalesce(_custom_role, '')) NOT LIKE '%crm%') THEN
    RETURN QUERY SELECT false, 'Access denied: Auditor or CRM Office role required';
    RETURN;
  END IF;

  IF p_date IS NULL THEN
    RETURN QUERY SELECT false, 'Registration date is required';
    RETURN;
  END IF;

  UPDATE tenant.external_clients__a
  SET status__a                     = 'Client_Registered',
      "stage2_registration_date__a" = p_date,
      updated_at                    = NOW()
  WHERE id = p_record_id AND tenant_id = _caller_tenant;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Record not found';
    RETURN;
  END IF;

  RETURN QUERY SELECT true, 'Client registration recorded';
END;
$$;

-- ================================================================
-- PART C — finalize_file_upload (REDEFINED — supersedes 237)
--
-- Reproduces 237's body verbatim with:
--   - Stage 1: stage1_ncr_rca no longer stamps its upload date (Part A2)
--   - Stage 2: NEW stage_two_audit_plan block, merged report/NCR block,
--     stage2_ncr_rca no longer stamps its upload date (built retired),
--     unchanged stage2_evidences block, NEW cdc_report block
--
-- NOTE: this is now the live definition. If these migrations are ever
-- replayed, 238 must run after 237.
-- ================================================================
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
  _is_crm_or_tech    BOOLEAN := false;
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
    -- Stage 1 audit plan: CRM Office, Auditor, or admin.
    -- Clears any prior client remarks on every (re-)upload — otherwise a
    -- stale rejection reason lingers after a revision and the client's
    -- review panel can't be distinguished from the one they already
    -- rejected (both keyed off the same Stage_one_plan_Sent status).
    IF _field_name = 'stage_one_audit_plan' AND _is_crm_or_auditor THEN
      UPDATE tenant.external_clients__a
      SET status__a = 'Stage_one_plan_Sent',
          "Stage_one_plan_Sent_Date__a" = CURRENT_DATE,
          "stage1_plan_client_remarks__a" = NULL,
          updated_at = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id;

    -- Stage 1 report / NCR: CRM Office, Auditor, or admin.
    -- Both land on the same status and stamp no date.
    ELSIF _field_name IN ('stage1_report', 'stage1_ncr') AND _is_crm_or_auditor THEN
      UPDATE tenant.external_clients__a
      SET status__a = 'Stage1_Report_Sent',
          updated_at = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id;

    ELSIF _field_name = 'stage1_ncr_rca' THEN
      -- Root-cause response: linked client or admin.
      -- No date is stamped here (retired in 238 — see module header).
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
    -- Stage 2 audit plan: CRM Office, Auditor, or admin (NEW).
    -- Clears any prior client remarks on every (re-)upload — same reasoning
    -- as the Stage 1 plan block above.
    IF _field_name = 'Stage_two_audit_plan' AND _is_crm_or_auditor THEN
      UPDATE tenant.external_clients__a
      SET status__a = 'Stage2_Plan_Sent',
          "stage2_plan_sent_date__a" = CURRENT_DATE,
          "stage2_plan_client_remarks__a" = NULL,
          updated_at = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id;

    -- Stage 2 report / NCR: CRM Office, Auditor, or admin.
    -- Merged into one status, no date (mirrors Stage 1).
    ELSIF _field_name IN ('stage2_report', 'stage2_ncr') AND _is_crm_or_auditor THEN
      UPDATE tenant.external_clients__a
      SET status__a = 'Stage2_Report_Sent',
          updated_at = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id;

    ELSIF _field_name = 'stage2_ncr_rca' THEN
      -- Root-cause response: linked client or admin. No date stamped.
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
      -- Evidences: linked client or admin. Date stamp unchanged/kept.
      SELECT ec.client_user_id__a INTO _client_user_id
      FROM tenant.external_clients__a ec
      WHERE ec.id = _attachment.record_id AND ec.tenant_id = _tenant_id;

      IF _caller_role = 'admin' OR _client_user_id = _auth_user_id THEN
        UPDATE tenant.external_clients__a
        SET status__a = 'Stage2_Evidences_Uploaded',
            "stage2_evidences_uploaded_date__a" = CURRENT_DATE,
            updated_at = NOW()
        WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
      END IF;

    ELSIF _field_name = 'cdc_report' AND _is_crm_or_tech THEN
      -- CDC report: CRM Office, Tech Reviewer, or admin. Upload IS the
      -- approval — no separate accept step.
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

-- -----------------------------------------------
-- D. Grants
-- -----------------------------------------------
GRANT EXECUTE ON FUNCTION public.review_stage2_plan(UUID, TEXT, TEXT)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_stage2_ncr_rca(UUID, TEXT, TEXT)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_stage2_evidences(UUID, TEXT, TEXT)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_stage2_registration_date(UUID, DATE)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_file_upload(UUID, BIGINT, TEXT)      TO authenticated;
