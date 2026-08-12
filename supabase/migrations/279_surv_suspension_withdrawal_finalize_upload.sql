-- ============================================================
-- Migration 279: Surveillance 1 (Renewal) — Sprint 8
-- finalize_file_upload soft gates for Suspension & Withdrawal
--
-- Reproduces the full LIVE body of finalize_file_upload verbatim (from
-- migration 268 recertification_report_tech_cdc_certificate.sql — the most
-- recent redefinition, confirmed via the same read used for migration 278's
-- start_file_upload reproduction). Same convention: full reproduction, not
-- diff-patch, so Recertification's Sprint 4 blocks aren't silently dropped.
--
-- New blocks: 6 soft-gate auto-advance blocks, one per field — CRM-only for
-- the 4 intimation/letter fields, CDC-only for the 2 decision fields.
-- Mirrors the cdc_report / surveillance_certificates blocks already in this
-- function exactly. Each sets its own ..._date__a to CURRENT_DATE. No
-- re-upload guard needed on the last one (surv_withdrawal_letter) — it's
-- the new terminal checkpoint, same reasoning migration 260 used for
-- surveillance_certificates being unguarded. The other five DO get a
-- re-upload guard (only advance while still at the checkpoint where it's
-- meaningful) — built in from day one this time, not retrofitted the way
-- migration 262 had to fix Sprint 1-3's fields after the fact.
-- ============================================================

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

  -- ════════════════════════════════════════════════════════════
  -- NEW (277/279) — renewal_clients__a Sprint 8: Suspension & Withdrawal.
  -- "Upload IS the action" for all six — mirrors the cdc_report /
  -- surveillance_certificates blocks directly above. Each of the first
  -- five carries a re-upload guard (only advances while still at the
  -- checkpoint where it's meaningful, built in from day one — Sprint 1-3's
  -- equivalents needed a follow-up migration, 262, for this same fix).
  -- surv_withdrawal_letter is the new terminal checkpoint, unguarded, same
  -- reasoning as surveillance_certificates above.
  -- ════════════════════════════════════════════════════════════

  IF _object_name = 'renewal_clients__a' AND _field_name = 'surv_suspension_intimation' AND _is_crm THEN
    UPDATE tenant.renewal_clients__a
    SET status__a                            = 'Suspension_Intimation_Sent',
        "surv_suspension_intimation_date__a" = CURRENT_DATE,
        updated_at                           = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id
      AND status__a IN ('Certificate_Issued', 'Suspension_Intimation_Sent');
  END IF;

  IF _object_name = 'renewal_clients__a' AND _field_name = 'surv_suspension_decision' AND _is_cdc THEN
    UPDATE tenant.renewal_clients__a
    SET status__a                          = 'Suspension_Decision_Uploaded',
        "surv_suspension_decision_date__a" = CURRENT_DATE,
        updated_at                         = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id
      AND status__a IN ('Suspension_Intimation_Sent', 'Suspension_Decision_Uploaded');
  END IF;

  IF _object_name = 'renewal_clients__a' AND _field_name = 'surv_suspension_letter' AND _is_crm THEN
    UPDATE tenant.renewal_clients__a
    SET status__a                        = 'Suspension_Letter_Sent',
        "surv_suspension_letter_date__a" = CURRENT_DATE,
        updated_at                       = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id
      AND status__a IN ('Suspension_Decision_Uploaded', 'Suspension_Letter_Sent');
  END IF;

  IF _object_name = 'renewal_clients__a' AND _field_name = 'surv_withdrawal_intimation' AND _is_crm THEN
    UPDATE tenant.renewal_clients__a
    SET status__a                            = 'Withdrawal_Intimation_Sent',
        "surv_withdrawal_intimation_date__a" = CURRENT_DATE,
        updated_at                           = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id
      AND status__a IN ('Suspension_Letter_Sent', 'Withdrawal_Intimation_Sent');
  END IF;

  IF _object_name = 'renewal_clients__a' AND _field_name = 'surv_withdrawal_decision' AND _is_cdc THEN
    UPDATE tenant.renewal_clients__a
    SET status__a                          = 'Withdrawal_Decision_Uploaded',
        "surv_withdrawal_decision_date__a" = CURRENT_DATE,
        updated_at                         = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id
      AND status__a IN ('Withdrawal_Intimation_Sent', 'Withdrawal_Decision_Uploaded');
  END IF;

  IF _object_name = 'renewal_clients__a' AND _field_name = 'surv_withdrawal_letter' AND _is_crm THEN
    UPDATE tenant.renewal_clients__a
    SET status__a                        = 'Withdrawal_Letter_Sent',
        "surv_withdrawal_letter_date__a" = CURRENT_DATE,
        updated_at                       = NOW()
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
  -- ════════════════════════════════════════════════════════════

  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_ncr' AND _is_crm_or_auditor THEN
    UPDATE tenant.recertification_clients__a
    SET status__a                  = 'Recert_NCR_Sent',
        "recert_ncr_sent_date__a" = CURRENT_DATE,
        updated_at                = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id
      AND status__a IN ('Recert_Plan_Accepted', 'Recert_NCR_Sent');
  END IF;

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

  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_audit_report' AND _is_crm_or_auditor THEN
    UPDATE tenant.recertification_clients__a
    SET status__a                     = 'Recert_Report_Sent',
        "recert_report_sent_date__a" = CURRENT_DATE,
        updated_at                   = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id
      AND status__a IN ('Recert_Evidences_Accepted', 'Recert_Report_Sent');
  END IF;

  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_cdc_report' AND _is_cdc THEN
    UPDATE tenant.recertification_clients__a
    SET status__a           = 'Recert_CDC_Approved',
        "recert_cdc_date__a" = CURRENT_DATE,
        updated_at          = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id
      AND status__a IN ('Recert_Closed', 'Recert_CDC_Approved');
  END IF;

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
