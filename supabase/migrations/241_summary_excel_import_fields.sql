-- ================================
-- Migration 241: Summary-excel-import fields + Registration Date sync
--
-- Implements the field-mapping plan in
-- UAF New Changes/New Help Doc/summary-excel-import-analysis.md (§5a/§6a).
-- Adds every field identified while mapping a real sample summary sheet
-- against external_clients__a and client_summary__a, per the stakeholder's
-- field-parity policy: any field created here gets a column AND a
-- tenant.fields registration on BOTH objects (except where noted below).
--
-- Registering these normally in tenant.fields is the entire permission
-- story — Permission Sets' field-level can_read/can_edit
-- (permission-sets.md) and Sharing Policy's row-level ownership checks
-- (sharing-policy.md) are both already generic, keyed off tenant.fields
-- rows and enforced inside get_tenant_fields / update_tenant_record. No
-- per-field code is needed for either; every field below is automatically
-- covered as soon as it's registered and always written through the
-- existing update_tenant_record / upsert_client_summary RPCs, never a new
-- bypass path.
--
-- ── Part A: registration_date__a — deliberately a NEW, separate field ──
-- stage2_registration_date__a (238) is untouched: still the RPC-only
-- column set_stage2_registration_date owns, still never registered in
-- tenant.fields. registration_date__a is a distinct column for manual
-- entry / summary-sheet import, confirmed by the stakeholder specifically
-- because stage2_registration_date__a had no existing label to reuse.
-- Part D adds a trigger so setting it still advances status__a the same
-- way the RPC does, regardless of which path sets it.
--
-- ── Part B: external_clients__a — 16 new fields ──
-- ── Part C: client_summary__a — 13 new fields (stage1_auditor__a,
-- stage2_auditor__a, stage1_tech_reviewer__a, stage2_tech_reviewer__a,
-- application_reviewer__a already exist there from 220 — not re-added) ──
-- ================================

-- -----------------------------------------------
-- Part A + B: new columns on external_clients__a
-- -----------------------------------------------
ALTER TABLE tenant.external_clients__a
  ADD COLUMN IF NOT EXISTS "registration_date__a"     DATE,
  ADD COLUMN IF NOT EXISTS "certificate_no__a"         TEXT,
  ADD COLUMN IF NOT EXISTS "iaf_code__a"                TEXT,
  ADD COLUMN IF NOT EXISTS "total_mandays__a"           TEXT,
  ADD COLUMN IF NOT EXISTS "stage1_manday__a"            TEXT,
  ADD COLUMN IF NOT EXISTS "stage2_manday__a"            TEXT,
  ADD COLUMN IF NOT EXISTS "stage1_auditor__a"           TEXT,
  ADD COLUMN IF NOT EXISTS "stage2_auditor__a"           TEXT,
  ADD COLUMN IF NOT EXISTS "stage1_tech_reviewer__a"     TEXT,
  ADD COLUMN IF NOT EXISTS "stage2_tech_reviewer__a"     TEXT,
  ADD COLUMN IF NOT EXISTS "application_reviewer__a"     TEXT,
  ADD COLUMN IF NOT EXISTS "director_name__a"            TEXT,
  ADD COLUMN IF NOT EXISTS "auditor_team__a"             TEXT,
  ADD COLUMN IF NOT EXISTS "lead_auditor__a"              TEXT,
  ADD COLUMN IF NOT EXISTS "food_category__a"             TEXT,
  ADD COLUMN IF NOT EXISTS "soa_date__a"                  TEXT;

-- -----------------------------------------------
-- Part C: new columns on client_summary__a
-- (registration_date / certificate_no / country / no_of_employees / iaf_code /
--  mandays / director / auditor_team / lead_auditor / food_category / soa_date
--  are new here; the 4 auditor/tech-reviewer fields already exist from 220)
-- -----------------------------------------------
ALTER TABLE tenant.client_summary__a
  ADD COLUMN IF NOT EXISTS "registration_date__a"   DATE,
  ADD COLUMN IF NOT EXISTS "certificate_no__a"       TEXT,
  ADD COLUMN IF NOT EXISTS "country__a"              TEXT,
  ADD COLUMN IF NOT EXISTS "no_of_employees__a"      TEXT,
  ADD COLUMN IF NOT EXISTS "iaf_code__a"             TEXT,
  ADD COLUMN IF NOT EXISTS "total_mandays__a"        TEXT,
  ADD COLUMN IF NOT EXISTS "stage1_manday__a"        TEXT,
  ADD COLUMN IF NOT EXISTS "stage2_manday__a"        TEXT,
  ADD COLUMN IF NOT EXISTS "director_name__a"        TEXT,
  ADD COLUMN IF NOT EXISTS "auditor_team__a"         TEXT,
  ADD COLUMN IF NOT EXISTS "lead_auditor__a"         TEXT,
  ADD COLUMN IF NOT EXISTS "food_category__a"        TEXT,
  ADD COLUMN IF NOT EXISTS "soa_date__a"             TEXT;

-- -----------------------------------------------
-- Register fields — external_clients__a (15) and client_summary__a (13)
-- -----------------------------------------------
DO $$
DECLARE
  _tenant_id UUID;
  _ext_object_id UUID;
  _summary_object_id UUID;
BEGIN
  FOR _tenant_id IN SELECT id FROM system.tenants LOOP
    SELECT id INTO _ext_object_id FROM tenant.objects
      WHERE tenant_id = _tenant_id AND name = 'external_clients__a' LIMIT 1;
    SELECT id INTO _summary_object_id FROM tenant.objects
      WHERE tenant_id = _tenant_id AND name = 'client_summary__a' LIMIT 1;

    IF _ext_object_id IS NOT NULL THEN
      INSERT INTO tenant.fields (id, tenant_id, object_id, name, label, type, is_required, is_system_field, display_order, created_at, updated_at)
      SELECT v.id, v.tenant_id, v.object_id, v.name, v.label, v.type, v.is_required, v.is_system_field, v.display_order, now(), now()
      FROM (VALUES
        (gen_random_uuid(), _tenant_id, _ext_object_id, 'registration_date',     'Registration Date',     'date', false, false, 139),
        (gen_random_uuid(), _tenant_id, _ext_object_id, 'certificate_no',        'Certificate No',        'text', false, false, 140),
        (gen_random_uuid(), _tenant_id, _ext_object_id, 'iaf_code',              'IAF Code',              'text', false, false, 141),
        (gen_random_uuid(), _tenant_id, _ext_object_id, 'total_mandays',         'Total Mandays',         'text', false, false, 142),
        (gen_random_uuid(), _tenant_id, _ext_object_id, 'stage1_manday',         'Stage 1 Manday',        'text', false, false, 143),
        (gen_random_uuid(), _tenant_id, _ext_object_id, 'stage2_manday',         'Stage 2 Manday',        'text', false, false, 144),
        (gen_random_uuid(), _tenant_id, _ext_object_id, 'stage1_auditor',        'Stage 1 Auditor',       'text', false, false, 145),
        (gen_random_uuid(), _tenant_id, _ext_object_id, 'stage2_auditor',        'Stage 2 Auditor',       'text', false, false, 146),
        (gen_random_uuid(), _tenant_id, _ext_object_id, 'stage1_tech_reviewer',  'Stage 1 Tech Reviewer', 'text', false, false, 147),
        (gen_random_uuid(), _tenant_id, _ext_object_id, 'stage2_tech_reviewer',  'Stage 2 Tech Reviewer', 'text', false, false, 148),
        (gen_random_uuid(), _tenant_id, _ext_object_id, 'application_reviewer',  'Application Reviewer',  'text', false, false, 149),
        (gen_random_uuid(), _tenant_id, _ext_object_id, 'director_name',         'Director Name',         'text', false, false, 150),
        (gen_random_uuid(), _tenant_id, _ext_object_id, 'auditor_team',          'Auditor Team',          'text', false, false, 151),
        (gen_random_uuid(), _tenant_id, _ext_object_id, 'lead_auditor',          'Lead Auditor',          'text', false, false, 152),
        (gen_random_uuid(), _tenant_id, _ext_object_id, 'food_category',         'Food Category',         'text', false, false, 153),
        (gen_random_uuid(), _tenant_id, _ext_object_id, 'soa_date',              'SOA Date',              'text', false, false, 154)
      ) AS v(id, tenant_id, object_id, name, label, type, is_required, is_system_field, display_order)
      WHERE NOT EXISTS (
        SELECT 1 FROM tenant.fields f WHERE f.object_id = v.object_id AND f.name = v.name
      );
    END IF;

    IF _summary_object_id IS NOT NULL THEN
      INSERT INTO tenant.fields (id, tenant_id, object_id, name, label, type, is_required, is_system_field, display_order, created_at, updated_at)
      SELECT v.id, v.tenant_id, v.object_id, v.name, v.label, v.type, v.is_required, v.is_system_field, v.display_order, now(), now()
      FROM (VALUES
        (gen_random_uuid(), _tenant_id, _summary_object_id, 'registration_date', 'Registration Date',             'date', false, false, 30),
        (gen_random_uuid(), _tenant_id, _summary_object_id, 'certificate_no',    'Certificate No',                'text', false, false, 31),
        (gen_random_uuid(), _tenant_id, _summary_object_id, 'country',           'Country',                       'text', false, false, 32),
        (gen_random_uuid(), _tenant_id, _summary_object_id, 'no_of_employees',   'Total Number of Employees',     'text', false, false, 33),
        (gen_random_uuid(), _tenant_id, _summary_object_id, 'iaf_code',          'IAF Code',                      'text', false, false, 34),
        (gen_random_uuid(), _tenant_id, _summary_object_id, 'total_mandays',     'Total Mandays',                 'text', false, false, 35),
        (gen_random_uuid(), _tenant_id, _summary_object_id, 'stage1_manday',     'Stage 1 Manday',                'text', false, false, 36),
        (gen_random_uuid(), _tenant_id, _summary_object_id, 'stage2_manday',     'Stage 2 Manday',                'text', false, false, 37),
        (gen_random_uuid(), _tenant_id, _summary_object_id, 'director_name',     'Director Name',                 'text', false, false, 38),
        (gen_random_uuid(), _tenant_id, _summary_object_id, 'auditor_team',      'Auditor Team',                  'text', false, false, 39),
        (gen_random_uuid(), _tenant_id, _summary_object_id, 'lead_auditor',      'Lead Auditor',                  'text', false, false, 40),
        (gen_random_uuid(), _tenant_id, _summary_object_id, 'food_category',     'Food Category',                 'text', false, false, 41),
        (gen_random_uuid(), _tenant_id, _summary_object_id, 'soa_date',          'SOA Date',                      'text', false, false, 42)
      ) AS v(id, tenant_id, object_id, name, label, type, is_required, is_system_field, display_order)
      WHERE NOT EXISTS (
        SELECT 1 FROM tenant.fields f WHERE f.object_id = v.object_id AND f.name = v.name
      );
    END IF;
  END LOOP;
END $$;

-- -----------------------------------------------
-- Part D: registration_date__a -> status__a sync trigger
--
-- Client_Registered is the terminal stage in the whole 22-stage pipeline
-- (ClientWorkflowBar.tsx's STAGES array), so — unlike the forward-only
-- comparison StageDateImport.tsx needs for the other dates, which can each
-- imply different mid-pipeline stages — setting registration_date__a always
-- means "this record is now fully registered," full stop. No stage-order
-- comparison needed.
--
-- Fires on every INSERT/UPDATE but only acts when registration_date__a is
-- being newly set or changed to a non-null value; clearing it back to NULL
-- does not revert status__a (matches the app's existing one-way convention
-- — nothing else in this schema un-advances status automatically either).
-- Covers every write path uniformly (manual edit through the generic
-- record form, the Summary Excel importer, any future caller) rather than
-- duplicating this check in each one.
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION tenant.sync_status_on_registration_date()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- OLD is unassigned during INSERT — only reference it for UPDATE, where
  -- it's used to skip re-firing on saves that don't touch this column.
  IF NEW."registration_date__a" IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD."registration_date__a" IS DISTINCT FROM NEW."registration_date__a") THEN
    NEW."status__a" := 'Client_Registered';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_status_on_registration_date ON tenant.external_clients__a;
CREATE TRIGGER trg_sync_status_on_registration_date
  BEFORE INSERT OR UPDATE ON tenant.external_clients__a
  FOR EACH ROW EXECUTE FUNCTION tenant.sync_status_on_registration_date();

-- -----------------------------------------------
-- Part E: extend client_summary__a's RPCs with the 13 new columns
--
-- get_client_summary / get_all_client_summaries / upsert_client_summary
-- (220, 221) all use explicit column lists, not SELECT *. Without
-- reproducing them here with the new columns added, StageDateImport.tsx's
-- writes to the new Summary columns would be silently dropped by
-- upsert_client_summary's UPDATE SET clause (no error — the JSONB keys
-- just wouldn't correspond to anything in the SET list), and even a
-- successful write would never be readable back through get_client_summary.
-- Reproduces both bodies verbatim (per this repo's redefinition
-- convention) plus the 13 added columns.
-- -----------------------------------------------
DROP FUNCTION IF EXISTS public.get_client_summary(UUID);
CREATE OR REPLACE FUNCTION public.get_client_summary(p_external_client_id UUID)
RETURNS TABLE(
  id                          UUID,
  external_client_id__a       UUID,
  company_name__a             TEXT,
  address__a                  TEXT,
  scope__a                    TEXT,
  email__a                    TEXT,
  contact_person__a           TEXT,
  iso_standards__a            TEXT,
  application_date__a         DATE,
  quotation_date__a           DATE,
  client_agreement_date__a    DATE,
  stage1_plan_sent_date__a    DATE,
  stage1_date__a              DATE,
  stage1_report_sent_date__a  DATE,
  stage2_plan_sent_date__a    DATE,
  stage2_date__a              DATE,
  stage2_report_sent_date__a  DATE,
  ncr_closure_date__a         DATE,
  certificates_sent_date__a   DATE,
  application_reviewer__a     TEXT,
  stage1_auditor__a           TEXT,
  stage2_auditor__a           TEXT,
  stage1_tech_reviewer__a     TEXT,
  stage2_tech_reviewer__a     TEXT,
  audit_pack__a               JSONB,
  registration_date__a        DATE,
  certificate_no__a           TEXT,
  country__a                  TEXT,
  no_of_employees__a          TEXT,
  iaf_code__a                 TEXT,
  total_mandays__a            TEXT,
  stage1_manday__a            TEXT,
  stage2_manday__a            TEXT,
  director_name__a            TEXT,
  auditor_team__a             TEXT,
  lead_auditor__a             TEXT,
  food_category__a            TEXT,
  soa_date__a                 TEXT
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _tenant_id UUID;
BEGIN
  SELECT su.tenant_id INTO _tenant_id FROM system.users su WHERE su.id = auth.uid();

  RETURN QUERY
  SELECT
    cs.id, cs.external_client_id__a,
    cs.company_name__a, cs.address__a, cs.scope__a, cs.email__a,
    cs.contact_person__a, cs.iso_standards__a,
    cs.application_date__a, cs.quotation_date__a, cs.client_agreement_date__a,
    cs.stage1_plan_sent_date__a, cs.stage1_date__a, cs.stage1_report_sent_date__a,
    cs.stage2_plan_sent_date__a, cs.stage2_date__a, cs.stage2_report_sent_date__a,
    cs.ncr_closure_date__a, cs.certificates_sent_date__a,
    cs.application_reviewer__a, cs.stage1_auditor__a, cs.stage2_auditor__a,
    cs.stage1_tech_reviewer__a, cs.stage2_tech_reviewer__a,
    cs.audit_pack__a,
    cs.registration_date__a, cs.certificate_no__a, cs.country__a, cs.no_of_employees__a,
    cs.iaf_code__a, cs.total_mandays__a, cs.stage1_manday__a, cs.stage2_manday__a,
    cs.director_name__a, cs.auditor_team__a, cs.lead_auditor__a, cs.food_category__a,
    cs.soa_date__a
  FROM tenant.client_summary__a cs
  WHERE cs.external_client_id__a = p_external_client_id
    AND cs.tenant_id = _tenant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_client_summary(UUID) TO authenticated;

DROP FUNCTION IF EXISTS public.get_all_client_summaries();
CREATE OR REPLACE FUNCTION public.get_all_client_summaries()
RETURNS TABLE(
  id                          UUID,
  external_client_id__a       UUID,
  company_name__a             TEXT,
  address__a                  TEXT,
  scope__a                    TEXT,
  email__a                    TEXT,
  contact_person__a           TEXT,
  iso_standards__a            TEXT,
  application_date__a         DATE,
  quotation_date__a           DATE,
  client_agreement_date__a    DATE,
  stage1_plan_sent_date__a    DATE,
  stage1_date__a              DATE,
  stage1_report_sent_date__a  DATE,
  stage2_plan_sent_date__a    DATE,
  stage2_date__a              DATE,
  stage2_report_sent_date__a  DATE,
  ncr_closure_date__a         DATE,
  certificates_sent_date__a   DATE,
  application_reviewer__a     TEXT,
  stage1_auditor__a           TEXT,
  stage2_auditor__a           TEXT,
  stage1_tech_reviewer__a     TEXT,
  stage2_tech_reviewer__a     TEXT,
  audit_pack__a               JSONB,
  registration_date__a        DATE,
  certificate_no__a           TEXT,
  country__a                  TEXT,
  no_of_employees__a          TEXT,
  iaf_code__a                 TEXT,
  total_mandays__a            TEXT,
  stage1_manday__a            TEXT,
  stage2_manday__a            TEXT,
  director_name__a            TEXT,
  auditor_team__a             TEXT,
  lead_auditor__a             TEXT,
  food_category__a            TEXT,
  soa_date__a                 TEXT
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _tenant_id UUID;
BEGIN
  SELECT su.tenant_id INTO _tenant_id FROM system.users su WHERE su.id = auth.uid();

  RETURN QUERY
  SELECT
    cs.id, cs.external_client_id__a,
    cs.company_name__a, cs.address__a, cs.scope__a, cs.email__a,
    cs.contact_person__a, cs.iso_standards__a,
    cs.application_date__a, cs.quotation_date__a, cs.client_agreement_date__a,
    cs.stage1_plan_sent_date__a, cs.stage1_date__a, cs.stage1_report_sent_date__a,
    cs.stage2_plan_sent_date__a, cs.stage2_date__a, cs.stage2_report_sent_date__a,
    cs.ncr_closure_date__a, cs.certificates_sent_date__a,
    cs.application_reviewer__a, cs.stage1_auditor__a, cs.stage2_auditor__a,
    cs.stage1_tech_reviewer__a, cs.stage2_tech_reviewer__a,
    cs.audit_pack__a,
    cs.registration_date__a, cs.certificate_no__a, cs.country__a, cs.no_of_employees__a,
    cs.iaf_code__a, cs.total_mandays__a, cs.stage1_manday__a, cs.stage2_manday__a,
    cs.director_name__a, cs.auditor_team__a, cs.lead_auditor__a, cs.food_category__a,
    cs.soa_date__a
  FROM tenant.client_summary__a cs
  WHERE cs.tenant_id = _tenant_id
  ORDER BY cs.company_name__a ASC NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_all_client_summaries() TO authenticated;

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
    INSERT INTO tenant.client_summary__a (tenant_id, external_client_id__a)
    VALUES (_tenant_id, p_external_client_id)
    RETURNING id INTO _summary_id;
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
