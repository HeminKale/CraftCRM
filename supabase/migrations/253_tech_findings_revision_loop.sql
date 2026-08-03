-- ================================================================
-- Migration 253: Tech Reviewer findings loop back to Auditor for revision
--
-- Stakeholder request (2026-08-03): when the Tech Reviewer records findings
-- (rather than accepting with none), the record should go back to the
-- Auditor/CRM to revise and re-upload the stage report/NCR — not straight
-- through to closure (Stage 1) / CDC upload (Stage 2). Only an "accept with
-- NO findings" should advance to the next stage. Once the Auditor re-uploads
-- the report/NCR, it should go straight back to the Tech Reviewer (NOT back
-- through the Client's RCA cycle — the RCA itself isn't in question, only
-- the Auditor's write-up/report is).
--
-- Design notes:
--   - Two new transient status__a values: Stage1_Tech_Findings_Rejected and
--     Stage2_Tech_Findings_Rejected. Deliberately NOT registered in
--     tenant.picklist_values and NOT added to ClientWorkflowBar.tsx's STAGES
--     array (that bar is client-facing progress display — "sent back to the
--     Auditor for an internal revision" isn't a client-facing pipeline step
--     and would need a new dot placed correctly in a linear sequence for no
--     real benefit). ClientWorkflowBar's resolveCurrentStageIndex() already
--     falls back cleanly to date-driven resolution when a status has no
--     matching STAGES entry — it'll land back on "Stage 1 NCR + RCA
--     Accepted" / "Stage 2 NCR Closed" (whichever date is already stamped),
--     which is an accurate approximation for the client. status__a is
--     documented as "plain text convention, no DB constraint" (see 233's
--     header), so this is safe.
--   - Reuses the existing stage1_tech_findings_notes__a / stage2_tech_
--     findings_notes__a columns to carry the Tech Reviewer's findings text
--     to the Auditor's revision prompt — same "one remarks field, latest
--     value wins" convention as stage1_plan_client_remarks__a /
--     stage1_rejection_notes__a elsewhere in this workflow. Cleared once the
--     Auditor re-uploads, same as those.
--   - Deliberately does NOT stamp stage1_tech_findings_date__a /
--     stage2_tech_findings_date__a on the "findings given, send back"
--     branch — those columns are ClientWorkflowBar dateKeys for the
--     "Tech Review Passed" dot; stamping them before the review has actually
--     passed would make the date-driven fallback jump the client-facing bar
--     ahead of where the record actually is.
-- ================================================================

-- ----------------------------------------------------------------
-- PART A — submit_stage1_tech_findings (REDEFINED — supersedes 244)
-- Blank notes: unchanged behavior, proceed to Stage1_Tech_Findings_Given.
-- Non-blank notes: NEW — send back to Auditor/CRM instead of proceeding.
-- ----------------------------------------------------------------
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
  _assigned_tech_id UUID;
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

  SELECT ec.status__a, ec.tech_reviewer_id__a INTO _current_status, _assigned_tech_id
  FROM tenant.external_clients__a ec
  WHERE ec.id = p_record_id AND ec.tenant_id = _caller_tenant;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Record not found';
    RETURN;
  END IF;

  IF _caller_role != 'admin' AND _assigned_tech_id IS DISTINCT FROM _caller_id THEN
    RETURN QUERY SELECT false, 'Access denied: you are not the tech reviewer assigned to this record';
    RETURN;
  END IF;

  IF p_notes IS NULL OR btrim(p_notes) = '' THEN
    -- Accept without findings — proceed to closure, unchanged from before.
    UPDATE tenant.external_clients__a
    SET status__a                      = 'Stage1_Tech_Findings_Given',
        "stage1_tech_findings_notes__a" = NULL,
        "stage1_tech_findings_date__a"  = CURRENT_DATE,
        updated_at                     = NOW()
    WHERE id = p_record_id AND tenant_id = _caller_tenant;

    RETURN QUERY SELECT true, 'Stage 1 tech-review findings submitted';
  ELSE
    -- Findings given — send back to Auditor/CRM to revise and re-upload the
    -- Stage 1 audit report/NCR, instead of proceeding to closure.
    UPDATE tenant.external_clients__a
    SET status__a                      = 'Stage1_Tech_Findings_Rejected',
        "stage1_tech_findings_notes__a" = p_notes,
        updated_at                     = NOW()
    WHERE id = p_record_id AND tenant_id = _caller_tenant;

    RETURN QUERY SELECT true, 'Findings recorded — sent back to the Auditor for revision';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_stage1_tech_findings(UUID, TEXT) TO authenticated;

-- ----------------------------------------------------------------
-- PART B — submit_stage2_tech_findings (REDEFINED — supersedes 244)
-- Mirrors Part A on the Stage 2 side.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_stage2_tech_findings(
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
  _assigned_tech_id UUID;
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

  SELECT ec.status__a, ec.tech_reviewer_id__a INTO _current_status, _assigned_tech_id
  FROM tenant.external_clients__a ec
  WHERE ec.id = p_record_id AND ec.tenant_id = _caller_tenant;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Record not found';
    RETURN;
  END IF;

  IF _caller_role != 'admin' AND _assigned_tech_id IS DISTINCT FROM _caller_id THEN
    RETURN QUERY SELECT false, 'Access denied: you are not the tech reviewer assigned to this record';
    RETURN;
  END IF;

  IF p_notes IS NULL OR btrim(p_notes) = '' THEN
    -- Accept without findings — proceed to CDC upload, unchanged from before.
    UPDATE tenant.external_clients__a
    SET status__a                      = 'Stage2_Tech_Findings_Given',
        "stage2_tech_findings_notes__a" = NULL,
        "stage2_tech_findings_date__a"  = CURRENT_DATE,
        updated_at                     = NOW()
    WHERE id = p_record_id AND tenant_id = _caller_tenant;

    RETURN QUERY SELECT true, 'Stage 2 tech-review findings submitted';
  ELSE
    -- Findings given — send back to Auditor/CRM to revise and re-upload the
    -- Stage 2 audit report/NCR, instead of proceeding to CDC upload.
    UPDATE tenant.external_clients__a
    SET status__a                      = 'Stage2_Tech_Findings_Rejected',
        "stage2_tech_findings_notes__a" = p_notes,
        updated_at                     = NOW()
    WHERE id = p_record_id AND tenant_id = _caller_tenant;

    RETURN QUERY SELECT true, 'Findings recorded — sent back to the Auditor for revision';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_stage2_tech_findings(UUID, TEXT) TO authenticated;

-- ----------------------------------------------------------------
-- PART C — finalize_file_upload (REDEFINED — supersedes 249)
-- Reproduces 249's body verbatim, adding one new guarded UPDATE per stage
-- so a stage1_report/stage1_ncr (or stage2_report/stage2_ncr) re-upload made
-- while the record sits at *_Tech_Findings_Rejected loops straight back to
-- the Tech Reviewer (*_Auditor_Accepted / *_Evidences_Accepted) — bypassing
-- the Client/RCA cycle entirely, since that isn't what's being revised.
-- The existing 249 guard (Stage1_Plan_Accepted / Stage1_Report_Sent →
-- Stage1_Report_Sent) is untouched, so the very first upload and an
-- idempotent re-upload before the RCA cycle starts behave exactly as before.
-- ----------------------------------------------------------------
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
    -- 249's re-upload guard: only advance/land on Stage1_Report_Sent while
    -- the record is still at the checkpoint where that's meaningful (first
    -- upload from Stage1_Plan_Accepted, or an idempotent re-upload before the
    -- RCA cycle starts).
    ELSIF _field_name IN ('stage1_report', 'stage1_ncr') AND _is_crm_or_auditor THEN
      UPDATE tenant.external_clients__a
      SET status__a = 'Stage1_Report_Sent',
          updated_at = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id
        AND status__a IN ('Stage1_Plan_Accepted', 'Stage1_Report_Sent');

      -- NEW (253): a revision uploaded in response to the Tech Reviewer's
      -- findings loops straight back to the Tech Reviewer, skipping the
      -- Client/RCA cycle — the RCA isn't what's being revised here, the
      -- Auditor's report/NCR write-up is. Clears the findings notes so a
      -- stale rejection reason doesn't linger through the fresh review.
      UPDATE tenant.external_clients__a
      SET status__a = 'Stage1_Auditor_Accepted',
          "stage1_tech_findings_notes__a" = NULL,
          updated_at = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id
        AND status__a = 'Stage1_Tech_Findings_Rejected';

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
    -- 249's re-upload guard, mirrored.
    ELSIF _field_name IN ('stage2_report', 'stage2_ncr') AND _is_crm_or_auditor THEN
      UPDATE tenant.external_clients__a
      SET status__a = 'Stage2_Report_Sent',
          updated_at = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id
        AND status__a IN ('Stage2_Plan_Accepted', 'Stage2_Report_Sent');

      -- NEW (253): mirrors the Stage 1 loop-back above — a revision uploaded
      -- in response to the Tech Reviewer's Stage 2 findings goes straight
      -- back to the Tech Reviewer, skipping the Client/RCA cycle.
      UPDATE tenant.external_clients__a
      SET status__a = 'Stage2_Evidences_Accepted',
          "stage2_tech_findings_notes__a" = NULL,
          updated_at = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id
        AND status__a = 'Stage2_Tech_Findings_Rejected';

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

    ELSIF _field_name = 'cdc_report' AND _is_cdc THEN
      -- CDC report: CDC role or admin ONLY (changed from CRM-or-Tech-Reviewer
      -- in 238 — stakeholder decision, see module header). Upload IS the
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

GRANT EXECUTE ON FUNCTION public.finalize_file_upload(UUID, BIGINT, TEXT) TO authenticated;
