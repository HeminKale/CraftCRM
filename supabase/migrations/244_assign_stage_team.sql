-- ============================================================
-- Migration 244: Assign Team (Auditor + Tech Reviewer) — mandatory checkpoint
--
-- Implements the "assign team" row from the stakeholder's rights-matrix
-- image (row 6 — previously a confirmed gap, see
-- S6_rights_matrix_verification.md #6). Decisions locked in for this build:
--   - Picklists populated live by role pattern (not a static reference
--     field), via a new RPC — always current if roles change later.
--   - HARD gate: the Stage 1 audit plan upload is rejected outright (inside
--     start_file_upload, not just silently skipped) unless both
--     auditor_id__a and tech_reviewer_id__a are already set.
--   - Ripple effect done in the same pass: every existing RPC gated on
--     "Auditor role" or "Tech Reviewer role" alone now also requires the
--     caller to be the SPECIFIC person assigned to that record — mirrors
--     the existing linked-client pattern (client_user_id__a = auth.uid()).
--   - CRM Office KEEPS its existing blanket bypass into these actions
--     (237/238's widened gates were a separate, deliberate decision) — only
--     a plain Auditor/Tech-Reviewer-role caller is now assignment-restricted.
--   - Scope boundary: only the ACCEPT/REJECT/WRITE/CLOSE/SIGN-OFF actions
--     are tightened (review_stage1_ncr_rca, close_stage1_audit,
--     accept_stage1_tech_review, submit_stage1_tech_findings,
--     review_stage2_ncr_rca, review_stage2_evidences,
--     submit_stage2_tech_findings). The Stage 1/2 plan/report/NCR UPLOAD
--     soft-gates (_is_crm_or_auditor in finalize_file_upload) are left as
--     pure role checks, unchanged — those were deliberately widened in
--     237/238 so CRM administrative staff can upload interchangeably with
--     Auditor, and that isn't what "assigned team" is meant to restrict.
--
-- New status value: Team_Assigned, inserted between Client_Agreement_Signed
-- (display_order 4) and Stage_one_plan_Sent (existing display_order 5, now
-- bumped along with everything after it). ClientWorkflowBar.tsx's STAGES
-- array and the picklist stay in sync, same convention as every prior
-- status addition in this epic.
-- ============================================================

-- ================================================================
-- PART A — Schema
-- ================================================================

ALTER TABLE tenant.external_clients__a
  ADD COLUMN IF NOT EXISTS "auditor_id__a"       UUID REFERENCES system.users(id),
  ADD COLUMN IF NOT EXISTS "tech_reviewer_id__a"  UUID REFERENCES system.users(id);

-- Deliberately NOT registered in tenant.fields — same reasoning as
-- stage2_registration_date__a (238/240): these are set exclusively through
-- assign_stage_team, which validates the chosen user actually holds the
-- right custom role. Registering them would let anyone with generic field-
-- edit access set an arbitrary user id directly, bypassing that validation.

-- ================================================================
-- PART B — New status value: Team_Assigned
-- ================================================================

DO $$
DECLARE
  _tenant_id UUID;
  _object_id UUID;
  _field_id  UUID;
BEGIN
  FOR _tenant_id IN SELECT id FROM system.tenants LOOP
    SELECT id INTO _object_id FROM tenant.objects
    WHERE tenant_id = _tenant_id AND name = 'external_clients__a' LIMIT 1;
    IF _object_id IS NULL THEN CONTINUE; END IF;

    SELECT id INTO _field_id FROM tenant.fields
    WHERE object_id = _object_id AND name = 'status' LIMIT 1;
    IF _field_id IS NULL THEN CONTINUE; END IF;

    -- Make room at display_order 5 by bumping everything from there onward.
    UPDATE tenant.picklist_values
    SET display_order = display_order + 1, updated_at = now()
    WHERE field_id = _field_id AND display_order >= 5;

    IF EXISTS (SELECT 1 FROM tenant.picklist_values WHERE field_id = _field_id AND value = 'Team_Assigned') THEN
      UPDATE tenant.picklist_values
      SET label = 'Team Assigned', display_order = 5, is_active = true, updated_at = now()
      WHERE field_id = _field_id AND value = 'Team_Assigned';
    ELSE
      INSERT INTO tenant.picklist_values (tenant_id, field_id, value, label, display_order, is_active)
      VALUES (_tenant_id, _field_id, 'Team_Assigned', 'Team Assigned', 5, true);
    END IF;
  END LOOP;
END $$;

-- ================================================================
-- PART C — get_tenant_users_by_role_pattern (NEW)
-- Populates the Auditor / Tech Reviewer picklists live, and also used to
-- resolve names for the read-only "assigned team" display once set. Open to
-- any authenticated member of the tenant (not just CRM) — it's a name/email
-- directory lookup, not a sensitive action; only assign_stage_team (CRM/
-- admin only) can actually use it to change anything.
-- ================================================================
CREATE OR REPLACE FUNCTION public.get_tenant_users_by_role_pattern(
  p_role_pattern TEXT
)
RETURNS TABLE(id UUID, name TEXT, email TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _caller_id     UUID;
  _caller_tenant UUID;
BEGIN
  _caller_id := auth.uid();

  SELECT su.tenant_id INTO _caller_tenant
  FROM system.users su WHERE su.id = _caller_id;

  IF _caller_tenant IS NULL THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    su.id,
    trim(coalesce(su.first_name, '') || ' ' || coalesce(su.last_name, ''))::TEXT AS name,
    su.email::TEXT
  FROM system.users su
  JOIN tenant.roles r ON r.id = su.custom_role_id
  WHERE su.tenant_id = _caller_tenant
    AND lower(r.name) LIKE '%' || lower(p_role_pattern) || '%'
    AND su.is_active = true
  ORDER BY su.first_name, su.last_name;
END;
$$;

-- ================================================================
-- PART D — assign_stage_team (NEW)
-- CRM Office / admin only. Only fires at the Client_Agreement_Signed
-- checkpoint — this is a one-time "confirm the team" action, not a general
-- reassignment tool (no ask for that yet). Validates both chosen users
-- actually hold the matching custom role, so a bad direct RPC call can't
-- assign, say, a Tech Reviewer into the auditor slot.
-- ================================================================
CREATE OR REPLACE FUNCTION public.assign_stage_team(
  p_record_id          UUID,
  p_auditor_id         UUID,
  p_tech_reviewer_id   UUID
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

  SELECT ec.status__a INTO _current_status
  FROM tenant.external_clients__a ec
  WHERE ec.id = p_record_id AND ec.tenant_id = _caller_tenant;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Record not found';
    RETURN;
  END IF;

  IF _current_status != 'Client_Agreement_Signed' THEN
    RETURN QUERY SELECT false, 'Team can only be assigned right after the client signs the agreement';
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

  UPDATE tenant.external_clients__a
  SET status__a            = 'Team_Assigned',
      "auditor_id__a"      = p_auditor_id,
      "tech_reviewer_id__a" = p_tech_reviewer_id,
      updated_at           = NOW()
  WHERE id = p_record_id AND tenant_id = _caller_tenant;

  RETURN QUERY SELECT true, 'Auditor and Tech Reviewer assigned';
END;
$$;

-- ================================================================
-- PART E — start_file_upload (REDEFINED — supersedes 239)
-- Reproduces 239's body verbatim (which itself carries forward 232's
-- quotation gate and 235's dead-signed-url fix) — NOT 235's, since 235
-- predates 239's clientAgreement__c gate and would silently drop it. Adds
-- one new HARD block: the Stage 1 audit plan upload is rejected outright
-- unless both auditor_id__a and tech_reviewer_id__a are already set on the
-- record. Caught during S6 sprint-planning verification (2026-08-01) —
-- this file originally reproduced 235 instead of 239 and would have
-- silently removed the clientAgreement__c CRM-only lock the moment this
-- migration applied, regardless of whether 239 had already run. Fixed here,
-- before this migration is applied anywhere.
-- ================================================================
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
  -- linked client (migration 239 — carried forward here, see Part E header) ──
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

  -- ── Stage 1 audit plan lock: team must be assigned first (migration 244) ──
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

GRANT EXECUTE ON FUNCTION public.start_file_upload(UUID, UUID, UUID, TEXT, TEXT, BIGINT, JSONB) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.start_file_upload(UUID, UUID, UUID, TEXT, TEXT, BIGINT, JSONB) FROM public;

-- ================================================================
-- PART F — review_stage1_ncr_rca (REDEFINED — supersedes 237)
-- Adds: a plain Auditor-role caller (not admin, not CRM) must be the
-- assigned auditor. CRM keeps its blanket bypass (237's widened gate).
-- ================================================================
CREATE OR REPLACE FUNCTION public.review_stage1_ncr_rca(
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
  _assigned_auditor_id UUID;
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

  SELECT ec.status__a, ec.auditor_id__a INTO _current_status, _assigned_auditor_id
  FROM tenant.external_clients__a ec
  WHERE ec.id = p_record_id AND ec.tenant_id = _caller_tenant;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Record not found';
    RETURN;
  END IF;

  -- Assignment check: only bypassed by admin or CRM (237's widened gate)
  IF _caller_role != 'admin'
     AND (lower(coalesce(_custom_role, '')) NOT LIKE '%crm%')
     AND _assigned_auditor_id IS DISTINCT FROM _caller_id THEN
    RETURN QUERY SELECT false, 'Access denied: you are not the auditor assigned to this record';
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

-- ================================================================
-- PART G — close_stage1_audit (REDEFINED — supersedes 233)
-- Adds: caller must be the assigned auditor (admin bypasses; no CRM
-- widening existed for this one, so none to preserve).
-- ================================================================
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
  _assigned_auditor_id UUID;
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

  SELECT ec.status__a, ec.auditor_id__a INTO _current_status, _assigned_auditor_id
  FROM tenant.external_clients__a ec
  WHERE ec.id = p_record_id AND ec.tenant_id = _caller_tenant;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Record not found';
    RETURN;
  END IF;

  IF _caller_role != 'admin' AND _assigned_auditor_id IS DISTINCT FROM _caller_id THEN
    RETURN QUERY SELECT false, 'Access denied: you are not the auditor assigned to this record';
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

-- ================================================================
-- PART H — accept_stage1_tech_review (REDEFINED — supersedes 233)
-- Adds: caller must be the assigned tech reviewer (admin bypasses).
-- ================================================================
CREATE OR REPLACE FUNCTION public.accept_stage1_tech_review(
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

-- ================================================================
-- PART I — submit_stage1_tech_findings (REDEFINED — supersedes 233)
-- Adds: caller must be the assigned tech reviewer (admin bypasses).
-- ================================================================
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

  UPDATE tenant.external_clients__a
  SET status__a                    = 'Stage1_Tech_Findings_Given',
      "stage1_tech_findings_notes__a" = p_notes,
      "stage1_tech_findings_date__a"  = CURRENT_DATE,
      updated_at                    = NOW()
  WHERE id = p_record_id AND tenant_id = _caller_tenant;

  RETURN QUERY SELECT true, 'Stage 1 tech-review findings submitted';
END;
$$;

-- ================================================================
-- PART J — review_stage2_ncr_rca (REDEFINED — supersedes 238)
-- Same pattern as Part F, Stage 2 side.
-- ================================================================
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
  _assigned_auditor_id UUID;
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

  SELECT ec.status__a, ec.auditor_id__a INTO _current_status, _assigned_auditor_id
  FROM tenant.external_clients__a ec
  WHERE ec.id = p_record_id AND ec.tenant_id = _caller_tenant;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Record not found';
    RETURN;
  END IF;

  IF _caller_role != 'admin'
     AND (lower(coalesce(_custom_role, '')) NOT LIKE '%crm%')
     AND _assigned_auditor_id IS DISTINCT FROM _caller_id THEN
    RETURN QUERY SELECT false, 'Access denied: you are not the auditor assigned to this record';
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

-- ================================================================
-- PART K — review_stage2_evidences (REDEFINED — supersedes 238)
-- Same pattern as Part F.
-- ================================================================
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
  _assigned_auditor_id UUID;
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

  SELECT ec.status__a, ec.auditor_id__a INTO _current_status, _assigned_auditor_id
  FROM tenant.external_clients__a ec
  WHERE ec.id = p_record_id AND ec.tenant_id = _caller_tenant;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Record not found';
    RETURN;
  END IF;

  IF _caller_role != 'admin'
     AND (lower(coalesce(_custom_role, '')) NOT LIKE '%crm%')
     AND _assigned_auditor_id IS DISTINCT FROM _caller_id THEN
    RETURN QUERY SELECT false, 'Access denied: you are not the auditor assigned to this record';
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

-- ================================================================
-- PART L — submit_stage2_tech_findings (REDEFINED — supersedes 234)
-- Adds: caller must be the assigned tech reviewer (admin bypasses).
-- ================================================================
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

  UPDATE tenant.external_clients__a
  SET status__a                    = 'Stage2_Tech_Findings_Given',
      "stage2_tech_findings_notes__a" = p_notes,
      "stage2_tech_findings_date__a"  = CURRENT_DATE,
      updated_at                    = NOW()
  WHERE id = p_record_id AND tenant_id = _caller_tenant;

  RETURN QUERY SELECT true, 'Stage 2 tech-review findings submitted';
END;
$$;

-- ================================================================
-- PART M — Grants
-- ================================================================
GRANT EXECUTE ON FUNCTION public.get_tenant_users_by_role_pattern(TEXT)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_stage_team(UUID, UUID, UUID)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_stage1_ncr_rca(UUID, TEXT, TEXT)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_stage1_audit(UUID, TEXT)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_stage1_tech_review(UUID, TEXT, TEXT)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_stage1_tech_findings(UUID, TEXT)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_stage2_ncr_rca(UUID, TEXT, TEXT)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_stage2_evidences(UUID, TEXT, TEXT)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_stage2_tech_findings(UUID, TEXT)      TO authenticated;
