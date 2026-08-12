-- ============================================================
-- Migration 276: Recertification — Sprint 3 backfill
--
-- Root cause: 267_recertification_ncr_rca_evidences.sql was pasted/run as a
-- single multi-statement script. Postgres treats a whole simple-query batch
-- like that as ONE implicit transaction unless it contains explicit BEGIN/
-- COMMIT — so when SOMETHING later in that same paste failed (most likely a
-- typo somewhere in the ~500-line reproduced start_file_upload/
-- finalize_file_upload bodies), everything before it in the same batch rolled
-- back too: the ALTER TABLE columns, the tenant.fields registration, the
-- status__a picklist values, and both review_recert_* RPCs. Confirmed via:
--   - 269's permission-set-entry diagnostic: 17 of 18 expected rows present,
--     the ONE missing row was recert_ncr (267's only field referenced there) —
--     every other migration's fields (264/265/266/268) resolved fine.
--   - Direct query: 0 of 267's 10 field names exist in tenant.fields.
--   - Direct query: 0 of 267's 10 physical columns exist on
--     tenant.recertification_clients__a.
--
-- What this migration deliberately does NOT touch: start_file_upload /
-- finalize_file_upload. Sprint 4's own doc (Sprint_4.md) confirms 268 built
-- its versions of both functions by sed-extracting 267's bodies out of the
-- MIGRATION FILE itself (not a live DB query) and adding Sprint 4's blocks on
-- top — so the LIVE functions right now already contain Sprint 3's gates as
-- code, regardless of whether 267 itself ever committed. 268's own field
-- registrations (recert_cdc_report, recert_certificates) were confirmed
-- present via the same 269 diagnostic, which proves 268's whole file DID
-- commit, including its complete start_file_upload/finalize_file_upload.
-- Re-running 267's copies of those two functions here would REGRESS them —
-- 267's versions don't have Sprint 4's gates. Left alone on purpose.
--
-- Everything below is copied verbatim from 267's own ALTER TABLE / DO blocks
-- / RPC definitions — same idempotent techniques (ADD COLUMN IF NOT EXISTS,
-- INSERT ... ON CONFLICT DO NOTHING, EXISTS-checked picklist upsert, DROP
-- FUNCTION IF EXISTS + CREATE) — safe to run regardless of partial state.
-- ============================================================

-- ── 1. Physical columns (267 section 1, verbatim) ──────────────────
ALTER TABLE tenant.recertification_clients__a
  ADD COLUMN IF NOT EXISTS "recert_ncr__a"                     JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "recert_ncr_sent_date__a"            DATE,
  ADD COLUMN IF NOT EXISTS "recert_ncr_rca__a"                  JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "recert_ncr_rca_uploaded_date__a"    DATE,
  ADD COLUMN IF NOT EXISTS "recert_auditor_accepted_date__a"    DATE,
  ADD COLUMN IF NOT EXISTS "recert_rca_rejection_notes__a"      TEXT,
  ADD COLUMN IF NOT EXISTS "recert_evidences__a"                JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "recert_evidences_uploaded_date__a"  DATE,
  ADD COLUMN IF NOT EXISTS "recert_evidences_accepted_date__a"  DATE,
  ADD COLUMN IF NOT EXISTS "recert_evidences_rejection_notes__a" TEXT;

-- ── 2. Register Sprint 3 fields (267 section 2, verbatim) ───────────
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
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_ncr',                       'Recertification NCR',            'file',  false, false, 23, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_ncr_sent_date',             'NCR Sent Date',                  'date',  false, false, 24, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_ncr_rca',                   'NCR Root Cause Analysis',        'file',  false, false, 25, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_ncr_rca_uploaded_date',     'RCA Uploaded Date',              'date',  false, false, 26, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_auditor_accepted_date',     'Auditor Accepted Date',          'date',  false, false, 27, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_rca_rejection_notes',       'RCA — Rejection Notes',          'text',  false, false, 28, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_evidences',                 'Evidences',                     'files', false, false, 29, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_evidences_uploaded_date',   'Evidences Uploaded Date',       'date',  false, false, 30, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_evidences_accepted_date',   'Evidences Accepted Date',       'date',  false, false, 31, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'recert_evidences_rejection_notes', 'Evidences — Rejection Notes',   'text',  false, false, 32, now(), now())
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- ── 3. status__a picklist values (267 section 3, verbatim) ──────────
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
        ('Recert_NCR_Sent',         'NCR Sent',            10),
        ('Recert_NCR_RCA_Uploaded', 'NCR + RCA Uploaded',  11),
        ('Recert_Auditor_Accepted', 'NCR + RCA Accepted',  12),
        ('Recert_Evidences_Uploaded', 'Evidences Uploaded', 13),
        ('Recert_Evidences_Accepted', 'Evidences Accepted', 14)
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

-- ── 4. RPC: review_recert_ncr_rca (267 section 4, verbatim) ─────────
DROP FUNCTION IF EXISTS public.review_recert_ncr_rca(UUID, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.review_recert_ncr_rca(
  p_record_id UUID,
  p_action    TEXT,   -- 'accept' or 'reject'
  p_notes     TEXT DEFAULT NULL
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

  IF p_action = 'accept' THEN
    UPDATE tenant.recertification_clients__a
    SET status__a                        = 'Recert_Auditor_Accepted',
        "recert_auditor_accepted_date__a" = CURRENT_DATE,
        "recert_rca_rejection_notes__a"   = NULL,
        updated_at                       = NOW()
    WHERE id = p_record_id AND tenant_id = _caller_tenant;
    RETURN QUERY SELECT true, 'NCR root-cause response accepted';

  ELSIF p_action = 'reject' THEN
    UPDATE tenant.recertification_clients__a
    SET status__a                      = 'Recert_NCR_Sent',
        "recert_rca_rejection_notes__a" = p_notes,
        updated_at                     = NOW()
    WHERE id = p_record_id AND tenant_id = _caller_tenant;
    RETURN QUERY SELECT true, 'NCR root-cause response rejected — awaiting revised RCA';

  ELSE
    RETURN QUERY SELECT false, 'Invalid action: use accept or reject';
  END IF;
END;
$$;

-- ── 5. RPC: review_recert_evidences (267 section 5, verbatim) ───────
DROP FUNCTION IF EXISTS public.review_recert_evidences(UUID, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.review_recert_evidences(
  p_record_id UUID,
  p_action    TEXT,   -- 'accept' or 'reject'
  p_notes     TEXT DEFAULT NULL
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

  IF p_action = 'accept' THEN
    UPDATE tenant.recertification_clients__a
    SET status__a                          = 'Recert_Evidences_Accepted',
        "recert_evidences_accepted_date__a" = CURRENT_DATE,
        "recert_evidences_rejection_notes__a" = NULL,
        updated_at                         = NOW()
    WHERE id = p_record_id AND tenant_id = _caller_tenant;
    RETURN QUERY SELECT true, 'Evidences accepted';

  ELSIF p_action = 'reject' THEN
    UPDATE tenant.recertification_clients__a
    SET status__a                          = 'Recert_Auditor_Accepted',
        "recert_evidences_rejection_notes__a" = p_notes,
        updated_at                         = NOW()
    WHERE id = p_record_id AND tenant_id = _caller_tenant;
    RETURN QUERY SELECT true, 'Evidences rejected — awaiting client re-upload';

  ELSE
    RETURN QUERY SELECT false, 'Invalid action: use accept or reject';
  END IF;
END;
$$;

-- ── 6. Grants (only the two RPCs — start_file_upload/finalize_file_upload
-- are NOT touched by this migration, see header) ────────────────────
GRANT EXECUTE ON FUNCTION public.review_recert_ncr_rca(UUID, TEXT, TEXT)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_recert_evidences(UUID, TEXT, TEXT) TO authenticated;
