-- ============================================================
-- Migration 237: External Client — Stage 1 workflow realignment
--
-- Reshapes the Stage 1 lifecycle built in 233 to match the agreed
-- business flow. Migration 233 is NOT edited (it is merged); this
-- migration supersedes the parts of it that changed.
--
-- Changes vs. 233:
--   1. NEW plan round at the front — the Stage 1 audit plan is uploaded by
--      CRM/Auditor (auto-advances + auto-stamps), then the linked client
--      accepts or rejects it with remarks.
--   2. NEW manual "Stage 1 Audit date" — set by CRM/Auditor, no status change.
--      Registered in tenant.fields (unlike the other Stage 1 dates) because
--      it must be user-editable on the record layout.
--   3. Report + NCR MERGED into one status. Previously two separate
--      auto-advances (Stage1_Report_Uploaded → Stage1_NCR_Uploaded), each
--      stamping its own date. Now either upload lands on Stage1_Report_Sent
--      and NO date is stamped (per the agreed spec).
--   4. review_stage1_ncr_rca gate WIDENED to CRM Office as well as Auditor,
--      and its reject branch repointed to the new merged status.
--
-- Deliberately UNCHANGED (confirmed decisions):
--   - The tail of the chain keeps 233's order: submit_stage1_tech_findings
--     → close_stage1_audit → accept_stage1_tech_review. The Tech Reviewer
--     still holds the final gate; Stage1_Complete is simply relabelled
--     "Ready for Stage 2" in the UI, not renamed in the data.
--   - The client does NOT formally accept the NCR sheet — uploading the
--     NCR + RCA is the acceptance. No status or RPC for it.
--   - Status STRINGS are never renamed, only their display labels, so no
--     existing record data is invalidated. The two retired Stage 1 values
--     are migrated in section 5.
--
-- Status flow after this migration (status__a — plain text, no constraint):
--   Application_Sent → Application_Accepted → Quotation_Received
--   → Client_Agreement_Signed → Stage_one_plan_Sent → Stage1_Plan_Accepted
--   → Stage1_Report_Sent → Stage1_NCR_RCA_Uploaded → Stage1_Auditor_Accepted
--   → Stage1_Tech_Findings_Given → Stage1_Closed → Stage1_Complete
--
-- Retired values: Stage_one_Audit_Done, Report_Sent,
--                 Stage1_Report_Uploaded, Stage1_NCR_Uploaded
-- ============================================================

-- -----------------------------------------------
-- 1. New columns
-- -----------------------------------------------
ALTER TABLE tenant.external_clients__a
  ADD COLUMN IF NOT EXISTS "stage1_plan_accepted_date__a"  DATE,
  ADD COLUMN IF NOT EXISTS "stage1_plan_client_remarks__a" TEXT,
  ADD COLUMN IF NOT EXISTS "stage1_audit_date__a"          DATE;

-- -----------------------------------------------
-- 2. Register the manual audit-date field
-- Unlike the other Stage 1 date columns (which are stamped by RPCs and read
-- straight off the record), this one is set BY HAND by CRM/Auditor, so it has
-- to exist in tenant.fields to render as an editable field on the layout.
-- It still needs adding to a layout section via Object Manager.
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
    SELECT gen_random_uuid(), _tenant_id, _object_id, 'stage1_audit_date', 'Stage 1 Audit Date', 'date', false, false, 105, now(), now()
    WHERE NOT EXISTS (
      SELECT 1 FROM tenant.fields
      WHERE object_id = _object_id AND name = 'stage1_audit_date'
    );
  END LOOP;
END $$;

-- -----------------------------------------------
-- 3. Relabel the Stage 1 file fields (labels only — never the api names,
--    which are string-matched inside finalize_file_upload / start_file_upload)
-- -----------------------------------------------
UPDATE tenant.fields f
SET label = 'Stage 1 Audit Report', updated_at = now()
FROM tenant.objects o
WHERE f.object_id = o.id AND o.name = 'external_clients__a' AND f.name = 'stage1_report';

UPDATE tenant.fields f
SET label = 'Stage 1 NCR + RCA', updated_at = now()
FROM tenant.objects o
WHERE f.object_id = o.id AND o.name = 'external_clients__a' AND f.name = 'stage1_ncr_rca';

-- -----------------------------------------------
-- 4. Register the status picklist values
-- The frontend workflow bar (ClientWorkflowBar.tsx) renders one dot per value
-- in this exact order — keep the two in sync when adding Stage 2 in Sprint 4.
-- Retired values are deactivated rather than deleted so historical records
-- that still reference them keep resolving.
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
        ('Application_Sent',            'Application Sent',            1),
        ('Application_Accepted',        'Application Accepted',        2),
        ('Quotation_Received',          'Quotation Received',          3),
        ('Client_Agreement_Signed',     'Client Agreement Signed',     4),
        ('Stage_one_plan_Sent',         'Stage 1 Plan Sent',           5),
        ('Stage1_Plan_Accepted',        'Stage 1 Plan Accepted',       6),
        ('Stage1_Report_Sent',          'Stage 1 Report Sent',         7),
        ('Stage1_NCR_RCA_Uploaded',     'Stage 1 RCA Done',            8),
        ('Stage1_Auditor_Accepted',     'Stage 1 NCR + RCA Accepted',  9),
        ('Stage1_Tech_Findings_Given',  'Stage 1 Tech Review Passed',  10),
        ('Stage1_Closed',               'Stage 1 Closed',              11),
        ('Stage1_Complete',             'Ready for Stage 2',           12)
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

    -- Retire the four superseded values
    UPDATE tenant.picklist_values
    SET is_active = false, updated_at = now()
    WHERE field_id = _field_id
      AND value IN ('Stage_one_Audit_Done', 'Report_Sent',
                    'Stage1_Report_Uploaded', 'Stage1_NCR_Uploaded');
  END LOOP;
END $$;

-- -----------------------------------------------
-- 5. Migrate existing records off the two merged Stage 1 statuses.
-- Without this, any record sitting on Stage1_Report_Uploaded /
-- Stage1_NCR_Uploaded would no longer match any dot on the workflow bar.
-- The retired main-pipeline values (Stage_one_Audit_Done, Report_Sent) are
-- intentionally left alone — those are historical states of the old 7-stage
-- pipeline, not part of the Stage 1 audit chain.
-- -----------------------------------------------
UPDATE tenant.external_clients__a
SET status__a = 'Stage1_Report_Sent',
    updated_at = NOW()
WHERE status__a IN ('Stage1_Report_Uploaded', 'Stage1_NCR_Uploaded');

-- -----------------------------------------------
-- 6. review_stage1_plan (NEW)
--    Linked client (or admin) accepts/rejects the Stage 1 audit plan.
--    accept → Stage1_Plan_Accepted + stamp date + clear remarks
--    reject → stays on Stage_one_plan_Sent + store client remarks, so
--             CRM/Auditor can revise and re-upload the plan.
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION public.review_stage1_plan(
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
    SET status__a                       = 'Stage1_Plan_Accepted',
        "stage1_plan_accepted_date__a"  = CURRENT_DATE,
        "stage1_plan_client_remarks__a" = NULL,
        updated_at                      = NOW()
    WHERE id = p_record_id AND tenant_id = _caller_tenant;
    RETURN QUERY SELECT true, 'Stage 1 audit plan accepted';

  ELSIF p_action = 'reject' THEN
    UPDATE tenant.external_clients__a
    SET status__a                       = 'Stage_one_plan_Sent',
        "stage1_plan_client_remarks__a" = p_notes,
        updated_at                      = NOW()
    WHERE id = p_record_id AND tenant_id = _caller_tenant;
    RETURN QUERY SELECT true, 'Stage 1 audit plan rejected — awaiting revised plan';

  ELSE
    RETURN QUERY SELECT false, 'Invalid action: use accept or reject';
  END IF;
END;
$$;

-- -----------------------------------------------
-- 7. review_stage1_ncr_rca (REDEFINED — supersedes 233)
--    Changes: gate now accepts CRM Office as well as Auditor; reject steps
--    back to Stage1_Report_Sent (Stage1_NCR_Uploaded no longer exists).
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
    SET status__a                         = 'Stage1_Auditor_Accepted',
        "stage1_auditor_accepted_date__a" = CURRENT_DATE,
        "stage1_rejection_notes__a"       = NULL,
        updated_at                        = NOW()
    WHERE id = p_record_id AND tenant_id = _caller_tenant;
    RETURN QUERY SELECT true, 'Stage 1 root-cause accepted';

  ELSIF p_action = 'reject' THEN
    UPDATE tenant.external_clients__a
    SET status__a                   = 'Stage1_Report_Sent',
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
-- 8. finalize_file_upload (REDEFINED — supersedes 234)
--    Reproduces 234's body verbatim, with two Stage 1 changes:
--      a) NEW: stage_one_audit_plan upload → Stage_one_plan_Sent +
--         stamps Stage_one_plan_Sent_Date__a (CRM/Auditor/admin gated).
--         The date column stays user-editable afterwards.
--      b) CHANGED: stage1_report and stage1_ncr now both advance to the
--         single Stage1_Report_Sent status and stamp NO date.
--    Every other block (quotation, renewal_clients, stage1_ncr_rca, all of
--    Stage 2) is carried forward unmodified.
--
--    NOTE: this is now the live definition. If these migrations are ever
--    replayed, 237 must run after 234.
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
    -- Stage 1 audit plan: CRM Office, Auditor, or admin (NEW in 237)
    IF _field_name = 'stage_one_audit_plan' AND _is_crm_or_auditor THEN
      UPDATE tenant.external_clients__a
      SET status__a = 'Stage_one_plan_Sent',
          "Stage_one_plan_Sent_Date__a" = CURRENT_DATE,
          updated_at = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id;

    -- Stage 1 report / NCR: CRM Office, Auditor, or admin.
    -- Both land on the same status and stamp no date (changed in 237).
    ELSIF _field_name IN ('stage1_report', 'stage1_ncr') AND _is_crm_or_auditor THEN
      UPDATE tenant.external_clients__a
      SET status__a = 'Stage1_Report_Sent',
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

  -- ── external_clients__a: Stage 2 audit uploads ───────────────
  IF _object_name = 'external_clients__a' THEN
    -- Stage 2 report / NCR: CRM Office, Auditor, or admin
    IF _field_name = 'stage2_report' AND _is_crm_or_auditor THEN
      UPDATE tenant.external_clients__a
      SET status__a = 'Stage2_Report_Uploaded',
          "stage2_report_uploaded_date__a" = CURRENT_DATE,
          updated_at = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id;

    ELSIF _field_name = 'stage2_ncr' AND _is_crm_or_auditor THEN
      UPDATE tenant.external_clients__a
      SET status__a = 'Stage2_NCR_Uploaded',
          "stage2_ncr_uploaded_date__a" = CURRENT_DATE,
          updated_at = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id;

    ELSIF _field_name = 'stage2_ncr_rca' THEN
      -- Root-cause response: linked client or admin
      SELECT ec.client_user_id__a INTO _client_user_id
      FROM tenant.external_clients__a ec
      WHERE ec.id = _attachment.record_id AND ec.tenant_id = _tenant_id;

      IF _caller_role = 'admin' OR _client_user_id = _auth_user_id THEN
        UPDATE tenant.external_clients__a
        SET status__a = 'Stage2_NCR_RCA_Uploaded',
            "stage2_ncr_rca_uploaded_date__a" = CURRENT_DATE,
            updated_at = NOW()
        WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
      END IF;

    ELSIF _field_name = 'stage2_evidences' THEN
      -- Evidences: linked client or admin
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
    END IF;
  END IF;

  RETURN QUERY SELECT true, 'File upload finalized successfully', _file_metadata;
END;
$$;

-- -----------------------------------------------
-- 9. Grants
-- -----------------------------------------------
GRANT EXECUTE ON FUNCTION public.review_stage1_plan(UUID, TEXT, TEXT)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_stage1_ncr_rca(UUID, TEXT, TEXT)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_file_upload(UUID, BIGINT, TEXT) TO authenticated;
