-- ================================================================
-- Migration 251: Fix upsert_client_summary's blank-row insert bug
--
-- Bug (found investigating "summary record vanishes after Excel import"):
-- upsert_client_summary's "row doesn't exist yet" branch inserts a bare
-- row with only tenant_id + external_client_id__a — no company_name__a,
-- no address/scope/email/etc. Normally unreachable, since
-- trg_create_client_summary (220) auto-creates a fully-populated summary
-- row the moment an external_clients__a row is inserted. But it's the
-- only insert path for the (small, real) set of clients that predate
-- migration 220, or whose summary row is otherwise missing.
--
-- For those clients, the first Import Summary / manual Summary edit
-- creates a summary row via this branch. If the sheet/edit doesn't happen
-- to include a Company Name value, company_name__a stays NULL forever —
-- SummaryDetail's header reads `data['company_name__a'] || 'Client
-- Summary'`, so the panel shows a blank/placeholder title even though the
-- row and its other data are there. Reads as "the record vanished."
--
-- Fix: when creating the row, backfill company_name__a/address__a/
-- scope__a/email__a/contact_person__a/iso_standards__a/application_date__a
-- from the linked external_clients__a record first — the exact same
-- backfill trg_create_client_summary already does at normal creation
-- time — then apply p_data on top as before. Reproduces the full function
-- body (241's version, with the 13 newer columns) per this repo's
-- redefinition convention; only the INSERT branch changes.
-- ================================================================

DROP FUNCTION IF EXISTS public.upsert_client_summary(UUID, JSONB);
CREATE OR REPLACE FUNCTION public.upsert_client_summary(
  p_external_client_id UUID,
  p_data               JSONB   -- partial update: only keys present are updated
)
RETURNS TABLE(success BOOLEAN, message TEXT, summary_id UUID)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _tenant_id  UUID;
  _summary_id UUID;
BEGIN
  SELECT su.tenant_id INTO _tenant_id FROM system.users su WHERE su.id = auth.uid();

  SELECT cs.id INTO _summary_id
  FROM tenant.client_summary__a cs
  WHERE cs.external_client_id__a = p_external_client_id AND cs.tenant_id = _tenant_id;

  IF _summary_id IS NULL THEN
    -- Backfill identity fields from the linked External Client record,
    -- same as trg_create_client_summary does on normal creation — so a
    -- late-created summary row starts populated instead of blank.
    INSERT INTO tenant.client_summary__a (
      tenant_id, external_client_id__a,
      company_name__a, address__a, scope__a, email__a,
      contact_person__a, iso_standards__a, application_date__a
    )
    SELECT
      _tenant_id, p_external_client_id,
      ec."Company_name__a", ec."Adddress__a", ec.scope__a, ec.email__a,
      ec."contactPerson__a", ec."ISOStandard__a", ec."Date__a"
    FROM tenant.external_clients__a ec
    WHERE ec.id = p_external_client_id AND ec.tenant_id = _tenant_id
    RETURNING id INTO _summary_id;

    IF _summary_id IS NULL THEN
      -- External client row not found under this tenant either — fall back
      -- to the bare insert so the function still behaves sanely rather than
      -- silently doing nothing.
      INSERT INTO tenant.client_summary__a (tenant_id, external_client_id__a)
      VALUES (_tenant_id, p_external_client_id)
      RETURNING id INTO _summary_id;
    END IF;
  END IF;

  UPDATE tenant.client_summary__a SET
    company_name__a             = COALESCE((p_data->>'company_name__a'),          company_name__a),
    address__a                  = COALESCE((p_data->>'address__a'),               address__a),
    scope__a                    = COALESCE((p_data->>'scope__a'),                  scope__a),
    email__a                    = COALESCE((p_data->>'email__a'),                  email__a),
    contact_person__a           = COALESCE((p_data->>'contact_person__a'),        contact_person__a),
    iso_standards__a            = COALESCE((p_data->>'iso_standards__a'),         iso_standards__a),
    application_date__a         = COALESCE((p_data->>'application_date__a')::DATE,        application_date__a),
    quotation_date__a           = COALESCE((p_data->>'quotation_date__a')::DATE,          quotation_date__a),
    client_agreement_date__a    = COALESCE((p_data->>'client_agreement_date__a')::DATE,   client_agreement_date__a),
    stage1_plan_sent_date__a    = COALESCE((p_data->>'stage1_plan_sent_date__a')::DATE,   stage1_plan_sent_date__a),
    stage1_date__a              = COALESCE((p_data->>'stage1_date__a')::DATE,             stage1_date__a),
    stage1_report_sent_date__a  = COALESCE((p_data->>'stage1_report_sent_date__a')::DATE, stage1_report_sent_date__a),
    stage2_plan_sent_date__a    = COALESCE((p_data->>'stage2_plan_sent_date__a')::DATE,   stage2_plan_sent_date__a),
    stage2_date__a              = COALESCE((p_data->>'stage2_date__a')::DATE,             stage2_date__a),
    stage2_report_sent_date__a  = COALESCE((p_data->>'stage2_report_sent_date__a')::DATE, stage2_report_sent_date__a),
    ncr_closure_date__a         = COALESCE((p_data->>'ncr_closure_date__a')::DATE,        ncr_closure_date__a),
    certificates_sent_date__a   = COALESCE((p_data->>'certificates_sent_date__a')::DATE,  certificates_sent_date__a),
    application_reviewer__a     = COALESCE((p_data->>'application_reviewer__a'),  application_reviewer__a),
    stage1_auditor__a           = COALESCE((p_data->>'stage1_auditor__a'),         stage1_auditor__a),
    stage2_auditor__a           = COALESCE((p_data->>'stage2_auditor__a'),         stage2_auditor__a),
    stage1_tech_reviewer__a     = COALESCE((p_data->>'stage1_tech_reviewer__a'),   stage1_tech_reviewer__a),
    stage2_tech_reviewer__a     = COALESCE((p_data->>'stage2_tech_reviewer__a'),   stage2_tech_reviewer__a),
    registration_date__a        = COALESCE((p_data->>'registration_date__a')::DATE,       registration_date__a),
    certificate_no__a           = COALESCE((p_data->>'certificate_no__a'),        certificate_no__a),
    country__a                  = COALESCE((p_data->>'country__a'),               country__a),
    no_of_employees__a          = COALESCE((p_data->>'no_of_employees__a'),       no_of_employees__a),
    iaf_code__a                 = COALESCE((p_data->>'iaf_code__a'),              iaf_code__a),
    total_mandays__a            = COALESCE((p_data->>'total_mandays__a'),         total_mandays__a),
    stage1_manday__a            = COALESCE((p_data->>'stage1_manday__a'),         stage1_manday__a),
    stage2_manday__a            = COALESCE((p_data->>'stage2_manday__a'),         stage2_manday__a),
    director_name__a            = COALESCE((p_data->>'director_name__a'),         director_name__a),
    auditor_team__a             = COALESCE((p_data->>'auditor_team__a'),          auditor_team__a),
    lead_auditor__a             = COALESCE((p_data->>'lead_auditor__a'),          lead_auditor__a),
    food_category__a            = COALESCE((p_data->>'food_category__a'),         food_category__a),
    soa_date__a                 = COALESCE((p_data->>'soa_date__a'),              soa_date__a),
    updated_at                  = now()
  WHERE id = _summary_id AND tenant_id = _tenant_id;

  RETURN QUERY SELECT true, 'Summary saved', _summary_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_client_summary(UUID, JSONB) TO authenticated;

-- ================================================================
-- Same fix, same bug, for append_audit_pack_entry (222) — it has its own
-- identical "row missing -> bare insert" branch, reachable independently:
-- if a summary sheet has no Company Name row but a file still gets
-- attached, StageDateImport.tsx's apply() calls this without ever calling
-- upsert_client_summary (summaryUpdateData can be empty while pendingFile
-- isn't), so the fix above alone doesn't cover this path.
-- ================================================================
DROP FUNCTION IF EXISTS public.append_audit_pack_entry(UUID, JSONB);
CREATE OR REPLACE FUNCTION public.append_audit_pack_entry(
  p_external_client_id UUID,
  p_entry              JSONB   -- { name, path, bucket, size, mime, uploaded_at }
)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _tenant_id  UUID;
  _summary_id UUID;
BEGIN
  SELECT su.tenant_id INTO _tenant_id FROM system.users su WHERE su.id = auth.uid();

  SELECT cs.id INTO _summary_id
  FROM tenant.client_summary__a cs
  WHERE cs.external_client_id__a = p_external_client_id AND cs.tenant_id = _tenant_id;

  IF _summary_id IS NULL THEN
    INSERT INTO tenant.client_summary__a (
      tenant_id, external_client_id__a,
      company_name__a, address__a, scope__a, email__a,
      contact_person__a, iso_standards__a, application_date__a
    )
    SELECT
      _tenant_id, p_external_client_id,
      ec."Company_name__a", ec."Adddress__a", ec.scope__a, ec.email__a,
      ec."contactPerson__a", ec."ISOStandard__a", ec."Date__a"
    FROM tenant.external_clients__a ec
    WHERE ec.id = p_external_client_id AND ec.tenant_id = _tenant_id
    RETURNING id INTO _summary_id;

    IF _summary_id IS NULL THEN
      INSERT INTO tenant.client_summary__a (tenant_id, external_client_id__a)
      VALUES (_tenant_id, p_external_client_id)
      RETURNING id INTO _summary_id;
    END IF;
  END IF;

  UPDATE tenant.client_summary__a
  SET
    audit_pack__a = COALESCE(audit_pack__a, '[]'::jsonb) || p_entry,
    updated_at    = now()
  WHERE id = _summary_id AND tenant_id = _tenant_id;

  RETURN QUERY SELECT true, 'Audit pack entry saved';
END;
$$;

GRANT EXECUTE ON FUNCTION public.append_audit_pack_entry(UUID, JSONB) TO authenticated;
