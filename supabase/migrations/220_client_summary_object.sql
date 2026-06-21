-- ============================================================
-- Migration 220: Client Summary Object
--
-- 1. Creates the tenant.client_summary__a table
-- 2. Registers it as a tenant object + all fields in tenant.objects/fields
-- 3. RPCs: get_client_summary, upsert_client_summary
-- 4. Trigger: auto-create summary row when external_clients__a row is inserted
-- ============================================================

-- ── 1. Table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant.client_summary__a (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID NOT NULL REFERENCES system.tenants(id) ON DELETE CASCADE,
  -- Link back to the external client record
  external_client_id__a       UUID REFERENCES tenant.external_clients__a(id) ON DELETE SET NULL,

  -- Auto-populated from external_clients__a on creation
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

  -- Manual fields
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

  -- Audit pack file (uploaded via "Upload Audit Pack" button)
  audit_pack__a               JSONB DEFAULT '[]'::jsonb,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_summary_tenant  ON tenant.client_summary__a (tenant_id);
CREATE INDEX IF NOT EXISTS idx_client_summary_ext_id  ON tenant.client_summary__a (external_client_id__a);

-- ── 2. Register object in tenant.objects ─────────────────────────
DO $$
DECLARE
  _tenant_id  UUID;
  _object_id  UUID := gen_random_uuid();
BEGIN
  -- Register for every tenant that exists
  FOR _tenant_id IN SELECT id FROM system.tenants LOOP
    INSERT INTO tenant.objects (id, tenant_id, name, label, is_active, created_at, updated_at)
    VALUES (
      gen_random_uuid(), _tenant_id,
      'client_summary__a', 'Client Summary', true, now(), now()
    )
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- ── 3. Register fields ────────────────────────────────────────────
-- (Insert fields for each tenant's client_summary__a object)
DO $$
DECLARE
  _tenant_id  UUID;
  _object_id  UUID;
  _ord        INT;
BEGIN
  FOR _tenant_id IN SELECT id FROM system.tenants LOOP
    SELECT id INTO _object_id FROM tenant.objects
    WHERE tenant_id = _tenant_id AND name = 'client_summary__a'
    LIMIT 1;

    IF _object_id IS NULL THEN CONTINUE; END IF;

    _ord := 1;
    -- helper: insert field if not already present
    INSERT INTO tenant.fields (id, tenant_id, object_id, name, label, type, is_required, is_system_field, display_order, created_at, updated_at)
    VALUES
      (gen_random_uuid(), _tenant_id, _object_id, 'external_client_id__a', 'External Client',        'text',  false, false, _ord,     now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'company_name__a',       'Company Name',           'text',  false, false, _ord+1,  now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'address__a',            'Address',                'text',  false, false, _ord+2,  now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'scope__a',              'Scope',                  'text',  false, false, _ord+3,  now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'email__a',              'Email',                  'text',  false, false, _ord+4,  now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'contact_person__a',     'Contact Person',         'text',  false, false, _ord+5,  now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'iso_standards__a',      'ISO Standards',          'text',  false, false, _ord+6,  now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'application_date__a',   'Application Date',       'date',  false, false, _ord+7,  now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'quotation_date__a',     'Quotation Date',         'date',  false, false, _ord+8,  now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'client_agreement_date__a','Client Agreement Date','date',  false, false, _ord+9,  now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'stage1_plan_sent_date__a','Stage 1 Plan Sent Date','date', false, false, _ord+10, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'stage1_date__a',        'Stage 1 Date',           'date',  false, false, _ord+11, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'stage1_report_sent_date__a','Stage 1 Report Sent Date','date',false,false,_ord+12,now(),now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'stage2_plan_sent_date__a','Stage 2 Plan Sent Date','date', false, false, _ord+13, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'stage2_date__a',        'Stage 2 Date',           'date',  false, false, _ord+14, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'stage2_report_sent_date__a','Stage 2 Report Sent Date','date',false,false,_ord+15,now(),now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'ncr_closure_date__a',   'NCR Closure Date',       'date',  false, false, _ord+16, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'certificates_sent_date__a','Certificates Sent Date','date',false,false, _ord+17, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'application_reviewer__a','Application Reviewer',  'text',  false, false, _ord+18, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'stage1_auditor__a',     'Stage 1 Auditor',        'text',  false, false, _ord+19, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'stage2_auditor__a',     'Stage 2 Auditor',        'text',  false, false, _ord+20, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'stage1_tech_reviewer__a','Stage 1 Tech Reviewer', 'text',  false, false, _ord+21, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'stage2_tech_reviewer__a','Stage 2 Tech Reviewer', 'text',  false, false, _ord+22, now(), now()),
      (gen_random_uuid(), _tenant_id, _object_id, 'audit_pack__a',         'Audit Pack',             'files', false, false, _ord+23, now(), now())
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- ── 4. RPC: get_client_summary ────────────────────────────────────
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
  audit_pack__a               JSONB
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
    cs.audit_pack__a
  FROM tenant.client_summary__a cs
  WHERE cs.external_client_id__a = p_external_client_id
    AND cs.tenant_id = _tenant_id;
END;
$$;

-- ── 5. RPC: upsert_client_summary ────────────────────────────────
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

  -- Check / create row
  SELECT cs.id INTO _summary_id
  FROM tenant.client_summary__a cs
  WHERE cs.external_client_id__a = p_external_client_id AND cs.tenant_id = _tenant_id;

  IF _summary_id IS NULL THEN
    INSERT INTO tenant.client_summary__a (tenant_id, external_client_id__a)
    VALUES (_tenant_id, p_external_client_id)
    RETURNING id INTO _summary_id;
  END IF;

  -- Apply updates for every key present in p_data
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
    updated_at                  = now()
  WHERE id = _summary_id AND tenant_id = _tenant_id;

  RETURN QUERY SELECT true, 'Summary saved', _summary_id;
END;
$$;

-- ── 6. Trigger: auto-create summary when external client is created ──
CREATE OR REPLACE FUNCTION tenant.on_external_client_created()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO tenant.client_summary__a (
    tenant_id,
    external_client_id__a,
    company_name__a,
    address__a,
    scope__a,
    email__a,
    contact_person__a,
    iso_standards__a,
    application_date__a
  ) VALUES (
    NEW.tenant_id,
    NEW.id,
    NEW."Company_name__a",
    NEW."Adddress__a",
    NEW.scope__a,
    NEW.email__a,
    NEW."contactPerson__a",
    NEW."ISOStandard__a",
    NEW."Date__a"
  )
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_client_summary ON tenant.external_clients__a;
CREATE TRIGGER trg_create_client_summary
  AFTER INSERT ON tenant.external_clients__a
  FOR EACH ROW EXECUTE FUNCTION tenant.on_external_client_created();

-- ── 7. Grants ─────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON tenant.client_summary__a TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_client_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_client_summary(UUID, JSONB) TO authenticated;
