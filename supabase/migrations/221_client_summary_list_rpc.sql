-- Migration 221: get_all_client_summaries RPC
-- Returns all summary rows for the caller's tenant (for the top-level Summary tab)

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
  WHERE cs.tenant_id = _tenant_id
  ORDER BY cs.company_name__a ASC NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_all_client_summaries() TO authenticated;
