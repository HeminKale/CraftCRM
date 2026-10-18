-- Admin-only bulk import. Apply after 291-297. No live data is rewritten.
BEGIN;
CREATE OR REPLACE FUNCTION public._bulk_summary_spec(p_workflow TEXT) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN CASE p_workflow
WHEN 'initial' THEN RETURN $spec${"fields":{"Date__a":{"extColumn":"Date__a","summaryColumn":"application_date__a","kind":"date"},"Application_Accpeted_Date__a":{"extColumn":"Application_Accpeted_Date__a","kind":"date"},"Quotation_Received_Date__a":{"extColumn":"Quotation_Received_Date__a","summaryColumn":"quotation_date__a","kind":"date"},"Client_Agreement_Signed_Date__a":{"extColumn":"Client_Agreement_Signed_Date__a","summaryColumn":"client_agreement_date__a","kind":"date"},"Stage_one_plan_Sent_Date__a":{"extColumn":"Stage_one_plan_Sent_Date__a","summaryColumn":"stage1_plan_sent_date__a","kind":"date"},"stage1_plan_accepted_date__a":{"extColumn":"stage1_plan_accepted_date__a","kind":"date"},"stage1_audit_date__a":{"extColumn":"stage1_audit_date__a","kind":"text"},"stage1_auditor_accepted_date__a":{"extColumn":"stage1_auditor_accepted_date__a","kind":"date"},"stage1_tech_final_accepted_date__a":{"extColumn":"stage1_tech_final_accepted_date__a","summaryColumn":"stage1_date__a","kind":"date"},"stage2_plan_sent_date__a":{"extColumn":"stage2_plan_sent_date__a","summaryColumn":"stage2_plan_sent_date__a","kind":"date"},"stage2_plan_accepted_date__a":{"extColumn":"stage2_plan_accepted_date__a","kind":"date"},"stage2_audit_date__a":{"extColumn":"stage2_audit_date__a","kind":"text"},"stage2_auditor_accepted_date__a":{"extColumn":"stage2_auditor_accepted_date__a","kind":"date"},"stage2_evidences_accepted_date__a":{"extColumn":"stage2_evidences_accepted_date__a","summaryColumn":"ncr_closure_date__a","kind":"date"},"stage2_tech_findings_date__a":{"extColumn":"stage2_tech_findings_date__a","summaryColumn":"stage2_date__a","kind":"date"},"cdc_date__a":{"extColumn":"cdc_date__a","kind":"date"},"registration_date__a":{"extColumn":"registration_date__a","summaryColumn":"registration_date__a","kind":"date"},"Company_name__a":{"extColumn":"Company_name__a","summaryColumn":"company_name__a","kind":"text"},"ISOStandard__a":{"extColumn":"ISOStandard__a","summaryColumn":"iso_standards__a","kind":"text"},"certificate_no__a":{"extColumn":"certificate_no__a","summaryColumn":"certificate_no__a","kind":"text"},"country__a":{"extColumn":"country__a","summaryColumn":"country__a","kind":"text"},"iaf_code__a":{"extColumn":"iaf_code__a","summaryColumn":"iaf_code__a","kind":"text"},"Adddress__a":{"extColumn":"Adddress__a","summaryColumn":"address__a","kind":"text"},"scope__a":{"extColumn":"scope__a","summaryColumn":"scope__a","kind":"text"},"totalNumberOfEmployees__a":{"extColumn":"totalNumberOfEmployees__a","summaryColumn":"no_of_employees__a","kind":"text"},"total_mandays__a":{"extColumn":"total_mandays__a","summaryColumn":"total_mandays__a","kind":"text"},"stage1_manday__a":{"extColumn":"stage1_manday__a","summaryColumn":"stage1_manday__a","kind":"text"},"stage2_manday__a":{"extColumn":"stage2_manday__a","summaryColumn":"stage2_manday__a","kind":"text"},"stage1_auditor__a":{"extColumn":"stage1_auditor__a","summaryColumn":"stage1_auditor__a","kind":"text"},"stage2_auditor__a":{"extColumn":"stage2_auditor__a","summaryColumn":"stage2_auditor__a","kind":"text"},"stage1_tech_reviewer__a":{"extColumn":"stage1_tech_reviewer__a","summaryColumn":"stage1_tech_reviewer__a","kind":"text"},"director_name__a":{"extColumn":"director_name__a","summaryColumn":"director_name__a","kind":"text"},"auditor_team__a":{"extColumn":"auditor_team__a","summaryColumn":"auditor_team__a","kind":"text"},"application_reviewer__a":{"extColumn":"application_reviewer__a","summaryColumn":"application_reviewer__a","kind":"text"},"lead_auditor__a":{"extColumn":"lead_auditor__a","summaryColumn":"lead_auditor__a","kind":"text"},"food_category__a":{"extColumn":"food_category__a","summaryColumn":"food_category__a","kind":"text"},"soa_date__a":{"extColumn":"soa_date__a","summaryColumn":"soa_date__a","kind":"text"},"email__a":{"extColumn":"email__a","summaryColumn":"email__a","kind":"text"},"contactPerson__a":{"extColumn":"contactPerson__a","summaryColumn":"contact_person__a","kind":"text"}},"stages":[{"column":"Date__a","status":"Application_Sent"},{"column":"Application_Accpeted_Date__a","status":"Application_Accepted"},{"column":"Quotation_Received_Date__a","status":"Quotation_Received"},{"column":"Client_Agreement_Signed_Date__a","status":"Client_Agreement_Signed"},{"column":"Stage_one_plan_Sent_Date__a","status":"Stage_one_plan_Sent"},{"column":"stage1_plan_accepted_date__a","status":"Stage1_Plan_Accepted"},{"column":"stage1_auditor_accepted_date__a","status":"Stage1_Auditor_Accepted"},{"column":"stage1_tech_final_accepted_date__a","status":"Stage1_Complete"},{"column":"stage2_plan_sent_date__a","status":"Stage2_Plan_Sent"},{"column":"stage2_plan_accepted_date__a","status":"Stage2_Plan_Accepted"},{"column":"stage2_auditor_accepted_date__a","status":"Stage2_Auditor_Accepted"},{"column":"stage2_evidences_accepted_date__a","status":"Stage2_Evidences_Accepted"},{"column":"stage2_tech_findings_date__a","status":"Stage2_Tech_Findings_Given"},{"column":"cdc_date__a","status":"CDC_Approved"},{"column":"registration_date__a","status":"Client_Registered"}]}$spec$::jsonb;
WHEN 'surveillance' THEN RETURN $spec${"fields":{"intimation_sent_date__a":{"extColumn":"intimation_sent_date__a","kind":"date"},"intimation_accepted_date__a":{"extColumn":"intimation_accepted_date__a","kind":"date"},"team_assigned_date__a":{"extColumn":"team_assigned_date__a","kind":"date"},"surv_plan_sent_date__a":{"extColumn":"surv_plan_sent_date__a","kind":"date"},"surv_plan_accepted_date__a":{"extColumn":"surv_plan_accepted_date__a","kind":"date"},"surv_ncr_sent_date__a":{"extColumn":"surv_ncr_sent_date__a","kind":"date"},"surv_ncr_rca_uploaded_date__a":{"extColumn":"surv_ncr_rca_uploaded_date__a","kind":"date"},"surv_auditor_accepted_date__a":{"extColumn":"surv_auditor_accepted_date__a","kind":"date"},"surv_report_sent_date__a":{"extColumn":"surv_report_sent_date__a","kind":"date"},"surv_tech_findings_date__a":{"extColumn":"surv_tech_findings_date__a","kind":"date"},"surv_tech_findings_notes__a":{"extColumn":"surv_tech_findings_notes__a","kind":"text"},"cdc_date__a":{"extColumn":"cdc_date__a","kind":"date"},"certificates_sent_date__a":{"extColumn":"certificates_sent_date__a","kind":"date"},"surv_closed_date__a":{"extColumn":"surv_closed_date__a","kind":"date"},"company_name__a":{"extColumn":"company_name__a","kind":"text"},"iso_standards__a":{"extColumn":"iso_standards__a","kind":"text"},"certificate_no__a":{"extColumn":"certificate_no__a","kind":"text"},"country__a":{"extColumn":"country__a","kind":"text"},"address__a":{"extColumn":"address__a","kind":"text"},"scope__a":{"extColumn":"scope__a","kind":"text"},"iaf_code__a":{"extColumn":"iaf_code__a","kind":"text"},"no_of_employees__a":{"extColumn":"no_of_employees__a","kind":"text"},"surv_mandays__a":{"extColumn":"surv_mandays__a","kind":"text"},"auditor_team__a":{"extColumn":"auditor_team__a","kind":"text"},"surveillance_audit_date__a":{"extColumn":"surveillance_audit_date__a","kind":"text"},"auditor_name__a":{"extColumn":"auditor_name__a","kind":"text"},"lead_auditor__a":{"extColumn":"lead_auditor__a","kind":"text"},"tech_reviewer_name__a":{"extColumn":"tech_reviewer_name__a","kind":"text"},"cdc_name__a":{"extColumn":"cdc_name__a","kind":"text"},"director_name__a":{"extColumn":"director_name__a","kind":"text"},"application_reviewer__a":{"extColumn":"application_reviewer__a","kind":"text"},"food_category__a":{"extColumn":"food_category__a","kind":"text"},"soa_date__a":{"extColumn":"soa_date__a","kind":"text"},"email__a":{"extColumn":"email__a","kind":"text"},"contact_person__a":{"extColumn":"contact_person__a","kind":"text"}},"stages":[{"column":"intimation_sent_date__a","status":"Intimation_Sent"},{"column":"intimation_accepted_date__a","status":"Intimation_Accepted"},{"column":"team_assigned_date__a","status":"Team_Assigned"},{"column":"surv_plan_sent_date__a","status":"Surv_Plan_Sent"},{"column":"surv_plan_accepted_date__a","status":"Surv_Plan_Accepted"},{"column":"surv_ncr_sent_date__a","status":"Surv_NCR_Sent"},{"column":"surv_ncr_rca_uploaded_date__a","status":"Surv_NCR_RCA_Uploaded"},{"column":"surv_auditor_accepted_date__a","status":"Surv_Auditor_Accepted"},{"column":"surv_report_sent_date__a","status":"Surv_Report_Sent"},{"column":"surv_tech_findings_date__a","status":"Surv_Tech_Findings_Given"},{"column":"surv_closed_date__a","status":"Surv_Closed"},{"column":"cdc_date__a","status":"CDC_Approved"},{"column":"certificates_sent_date__a","status":"Certificate_Issued"}]}$spec$::jsonb;
WHEN 'recertification' THEN RETURN $spec${"fields":{"recert_intimation_sent_date__a":{"extColumn":"recert_intimation_sent_date__a","kind":"date"},"recert_application_sent_date__a":{"extColumn":"recert_application_sent_date__a","kind":"date"},"recert_application_accepted_date__a":{"extColumn":"recert_application_accepted_date__a","kind":"date"},"recert_quotation_received_date__a":{"extColumn":"recert_quotation_received_date__a","kind":"date"},"recert_agreement_sent_date__a":{"extColumn":"recert_agreement_sent_date__a","kind":"date"},"recert_agreement_signed_date__a":{"extColumn":"recert_agreement_signed_date__a","kind":"date"},"recert_team_assigned_date__a":{"extColumn":"recert_team_assigned_date__a","kind":"date"},"recert_plan_sent_date__a":{"extColumn":"recert_plan_sent_date__a","kind":"date"},"recert_plan_accepted_date__a":{"extColumn":"recert_plan_accepted_date__a","kind":"date"},"recert_ncr_sent_date__a":{"extColumn":"recert_ncr_sent_date__a","kind":"date"},"recert_ncr_rca_uploaded_date__a":{"extColumn":"recert_ncr_rca_uploaded_date__a","kind":"date"},"recert_auditor_accepted_date__a":{"extColumn":"recert_auditor_accepted_date__a","kind":"date"},"recert_evidences_uploaded_date__a":{"extColumn":"recert_evidences_uploaded_date__a","kind":"date"},"recert_report_sent_date__a":{"extColumn":"recert_report_sent_date__a","kind":"date"},"recert_tech_findings_date__a":{"extColumn":"recert_tech_findings_date__a","kind":"date"},"recert_cdc_date__a":{"extColumn":"recert_cdc_date__a","kind":"date"},"recert_certificates_sent_date__a":{"extColumn":"recert_certificates_sent_date__a","kind":"date"},"company_name__a":{"extColumn":"company_name__a","kind":"text"},"iso_standards__a":{"extColumn":"iso_standards__a","kind":"text"},"certificate_no__a":{"extColumn":"certificate_no__a","kind":"text"},"country__a":{"extColumn":"country__a","kind":"text"},"scope__a":{"extColumn":"scope__a","kind":"text"},"iaf_code__a":{"extColumn":"iaf_code__a","kind":"text"},"no_of_employees__a":{"extColumn":"no_of_employees__a","kind":"text"},"total_mandays__a":{"extColumn":"total_mandays__a","kind":"text"},"stage1_manday__a":{"extColumn":"stage1_manday__a","kind":"text"},"stage2_manday__a":{"extColumn":"stage2_manday__a","kind":"text"},"auditor_name__a":{"extColumn":"auditor_name__a","kind":"text"},"tech_reviewer_name__a":{"extColumn":"tech_reviewer_name__a","kind":"text"},"director_name__a":{"extColumn":"director_name__a","kind":"text"},"recert_mandays__a":{"extColumn":"recert_mandays__a","kind":"text"},"auditor_team__a":{"extColumn":"auditor_team__a","kind":"text"},"application_reviewer__a":{"extColumn":"application_reviewer__a","kind":"text"},"lead_auditor__a":{"extColumn":"lead_auditor__a","kind":"text"},"food_category__a":{"extColumn":"food_category__a","kind":"text"},"soa_date__a":{"extColumn":"soa_date__a","kind":"text"},"recert_audit_date__a":{"extColumn":"recert_audit_date__a","kind":"text"},"recert_auditor_name__a":{"extColumn":"recert_auditor_name__a","kind":"text"},"recert_lead_auditor__a":{"extColumn":"recert_lead_auditor__a","kind":"text"},"recert_tech_reviewer_name__a":{"extColumn":"recert_tech_reviewer_name__a","kind":"text"},"recert_cdc_name__a":{"extColumn":"recert_cdc_name__a","kind":"text"},"email__a":{"extColumn":"email__a","kind":"text"},"contact_person__a":{"extColumn":"contact_person__a","kind":"text"},"recert_evidences_accepted_date__a":{"extColumn":"recert_evidences_accepted_date__a","kind":"date"}},"stages":[{"column":"recert_intimation_sent_date__a","status":"Recert_Intimation_Sent"},{"column":"recert_application_sent_date__a","status":"Recert_Application_Sent"},{"column":"recert_application_accepted_date__a","status":"Recert_Application_Accepted"},{"column":"recert_quotation_received_date__a","status":"Recert_Quotation_Received"},{"column":"recert_agreement_sent_date__a","status":"Recert_Agreement_Sent"},{"column":"recert_agreement_signed_date__a","status":"Recert_Agreement_Signed"},{"column":"recert_team_assigned_date__a","status":"Recert_Team_Assigned"},{"column":"recert_plan_sent_date__a","status":"Recert_Plan_Sent"},{"column":"recert_plan_accepted_date__a","status":"Recert_Plan_Accepted"},{"column":"recert_ncr_sent_date__a","status":"Recert_NCR_Sent"},{"column":"recert_ncr_rca_uploaded_date__a","status":"Recert_NCR_RCA_Uploaded"},{"column":"recert_auditor_accepted_date__a","status":"Recert_Auditor_Accepted"},{"column":"recert_evidences_uploaded_date__a","status":"Recert_Evidences_Uploaded"},{"column":"recert_evidences_accepted_date__a","status":"Recert_Evidences_Accepted"},{"column":"recert_report_sent_date__a","status":"Recert_Report_Sent"},{"column":"recert_tech_findings_date__a","status":"Recert_Tech_Findings_Given"},{"column":"recert_closed_date__a","status":"Recert_Closed"},{"column":"recert_cdc_date__a","status":"Recert_CDC_Approved"},{"column":"recert_certificates_sent_date__a","status":"Recert_Certificate_Issued"}]}$spec$::jsonb;
ELSE RAISE EXCEPTION 'Unsupported bulk workflow'; END CASE; END; $$;
REVOKE ALL ON FUNCTION public._bulk_summary_spec(TEXT) FROM PUBLIC,anon,authenticated;

CREATE TABLE IF NOT EXISTS tenant.bulk_summary_import_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  app_id UUID NOT NULL, workflow TEXT NOT NULL, file_hash TEXT NOT NULL,
  sheet_name TEXT NOT NULL, row_number INTEGER NOT NULL, standard_group TEXT NOT NULL, request_data JSONB NOT NULL,
  before_data JSONB, result JSONB NOT NULL, source_file JSONB NOT NULL,
  imported_by UUID NOT NULL, imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,app_id,workflow,file_hash,sheet_name,row_number,standard_group)
);
ALTER TABLE tenant.bulk_summary_import_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tenant.bulk_summary_import_results FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public._bulk_context(p_app_id UUID)
RETURNS TABLE(tenant_id UUID, body TEXT) LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE _tenant UUID; _role TEXT; _body TEXT;
BEGIN
  SELECT u.tenant_id,u.role INTO _tenant,_role FROM system.users u WHERE u.id=auth.uid();
  IF _tenant IS NULL OR _role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Admin role required for bulk Summary upload'; END IF;
  SELECT a.name INTO _body FROM tenant.apps a WHERE a.id=p_app_id AND a.tenant_id=_tenant AND a.is_active;
  IF NOT FOUND OR nullif(btrim(_body),'') IS NULL THEN RAISE EXCEPTION 'Select an active app belonging to your tenant'; END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='tenant-uploads' AND public=false) THEN RAISE EXCEPTION 'Bulk workbooks require the private tenant-uploads bucket'; END IF;
  RETURN QUERY SELECT _tenant,_body;
END; $$;

CREATE OR REPLACE FUNCTION public._bulk_company(p_value TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT regexp_replace(lower(coalesce(p_value,'')),'[[:space:] ]+','','g')
$$;
CREATE OR REPLACE FUNCTION public._bulk_numbers(p_value TEXT) RETURNS TEXT[]
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT coalesce(array_agg(n ORDER BY n::integer),ARRAY[]::text[]) FROM
    (SELECT DISTINCT CASE m[1] WHEN '9' THEN '9001' WHEN '14' THEN '14001' WHEN '45' THEN '45001' ELSE m[1] END AS n
     FROM regexp_matches(coalesce(p_value,''),'(?<![0-9])([0-9]{1,6})(?![0-9])','g') m
     WHERE (length(m[1])>=4 OR m[1] IN ('9','14','45')) AND m[1]::integer NOT BETWEEN 1900 AND 2099) s
$$;
CREATE OR REPLACE FUNCTION public._bulk_integrated(p_value TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
  SELECT cardinality(public._bulk_numbers(p_value))>0 AND public._bulk_numbers(p_value)<@ARRAY['9001','14001','45001']::text[]
$$;
CREATE OR REPLACE FUNCTION public._bulk_standards(p_a TEXT,p_b TEXT DEFAULT '') RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
  SELECT coalesce(string_agg('ISO '||n,', ' ORDER BY n::integer),'') FROM
    unnest(public._bulk_numbers(coalesce(p_a,'')||','||coalesce(p_b,''))) n
$$;

CREATE OR REPLACE FUNCTION public._bulk_validate(p_workflow TEXT,p_data JSONB) RETURNS JSONB
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE _spec JSONB:=public._bulk_summary_spec(p_workflow); _out JSONB:='{}'; _key TEXT; _value TEXT;
  _company TEXT:=CASE WHEN p_workflow='initial' THEN 'Company_name__a' ELSE 'company_name__a' END;
  _iso TEXT:=CASE WHEN p_workflow='initial' THEN 'ISOStandard__a' ELSE 'iso_standards__a' END;
BEGIN
  IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR octet_length(p_data::text)>100000 THEN RAISE EXCEPTION 'Invalid or oversized row'; END IF;
  FOR _key,_value IN SELECT key,value FROM jsonb_each_text(p_data) LOOP
    IF NOT (_spec->'fields' ? _key) THEN RAISE EXCEPTION 'Unsupported bulk field: %',_key; END IF;
    IF nullif(btrim(_value),'') IS NULL THEN CONTINUE; END IF;
    IF _spec->'fields'->_key->>'kind'='date' THEN
      IF _value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'Use ISO calendar date for %',_key; END IF;
      PERFORM _value::date;
    END IF;
    _out:=_out||jsonb_build_object(_key,btrim(_value));
  END LOOP;
  IF public._bulk_company(_out->>_company)='' THEN RAISE EXCEPTION 'Company name is required'; END IF;
  IF cardinality(public._bulk_numbers(_out->>_iso))=0 THEN RAISE EXCEPTION 'ISO standard number is required'; END IF;
  IF NOT public._bulk_integrated(_out->>_iso) AND cardinality(public._bulk_numbers(_out->>_iso))>1 THEN RAISE EXCEPTION 'Split non-integrated standards into separate import parts'; END IF;
  RETURN _out||jsonb_build_object(_iso,public._bulk_standards(_out->>_iso));
END; $$;

-- Only same-tenant, same-name, selected-body (or explicitly selected legacy
-- blank-body) records are candidates. Only records containing exclusively
-- 9001/14001/45001 are merge targets. Other standards always stay separate.
CREATE OR REPLACE FUNCTION public._bulk_candidates(p_tenant UUID,p_body TEXT,p_table TEXT,p_company TEXT,p_iso TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE _rows JSONB; _company TEXT; _iso TEXT;
BEGIN
  IF p_table NOT IN ('external_clients__a','renewal_clients__a','recertification_clients__a') THEN RAISE EXCEPTION 'Invalid bulk table'; END IF;
  IF NOT public._bulk_integrated(p_iso) THEN RETURN '[]'::jsonb; END IF;
  _company:=CASE WHEN p_table='external_clients__a' THEN 'Company_name__a' ELSE 'company_name__a' END;
  _iso:=CASE WHEN p_table='external_clients__a' THEN 'ISOStandard__a' ELSE 'iso_standards__a' END;
  EXECUTE format($query$SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'version',md5(to_jsonb(r)::text),'data',to_jsonb(r)) ORDER BY r.created_at,r.id),'[]'::jsonb)
    FROM tenant.%I r WHERE r.tenant_id=$1 AND coalesce(nullif(public._bulk_company(r.%I),''),public._bulk_company(r.name))=$2
    AND (lower(btrim(coalesce(r.certification_body__a,'')))=lower(btrim($3)) OR nullif(btrim(r.certification_body__a),'') IS NULL)
    AND public._bulk_integrated(r.%I)$query$,p_table,_company,_iso)
    INTO _rows USING p_tenant,public._bulk_company(p_company),p_body;
  RETURN _rows;
END; $$;

CREATE OR REPLACE FUNCTION public.preview_bulk_summary_row(p_app_id UUID,p_workflow TEXT,p_data JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE _ctx RECORD; _data JSONB; _table TEXT; _company TEXT; _iso TEXT;
BEGIN
  SELECT * INTO _ctx FROM public._bulk_context(p_app_id);
  _data:=public._bulk_validate(p_workflow,p_data);
  _table:=CASE p_workflow WHEN 'initial' THEN 'external_clients__a' WHEN 'surveillance' THEN 'renewal_clients__a' ELSE 'recertification_clients__a' END;
  _company:=_data->>CASE WHEN p_workflow='initial' THEN 'Company_name__a' ELSE 'company_name__a' END;
  _iso:=_data->>CASE WHEN p_workflow='initial' THEN 'ISOStandard__a' ELSE 'iso_standards__a' END;
  RETURN jsonb_build_object('body',_ctx.body,'data',_data,
    'separate_standard',NOT public._bulk_integrated(_iso),
    'targets',public._bulk_candidates(_ctx.tenant_id,_ctx.body,_table,_company,_iso),
    'clients',CASE WHEN p_workflow='initial' THEN '[]'::jsonb ELSE
      public._bulk_candidates(_ctx.tenant_id,_ctx.body,'external_clients__a',_company,_iso) END);
END; $$;

CREATE OR REPLACE FUNCTION public._bulk_update_initial(p_id UUID,p_tenant UUID,p_data JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE _spec JSONB:=public._bulk_summary_spec('initial'); _key TEXT; _value TEXT; _mirror TEXT;
  _updates TEXT[]:=ARRAY[]::text[]; _summary JSONB:='{}'; _stage JSONB; _i INTEGER:=0; _implied INTEGER:=0;
  _current INTEGER:=0; _old TEXT; _new TEXT; _res RECORD;
BEGIN
  SELECT status__a INTO _old FROM tenant.external_clients__a WHERE id=p_id AND tenant_id=p_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client not found'; END IF;
  IF (SELECT count(*) FROM tenant.client_summary__a WHERE external_client_id__a=p_id AND tenant_id=p_tenant)>1 THEN RAISE EXCEPTION 'Multiple Initial Summaries exist for this client. Reconcile them before bulk import.'; END IF;
  FOR _stage IN SELECT value FROM jsonb_array_elements(_spec->'stages') LOOP
    _i:=_i+1;
    IF _stage->>'status'=_old THEN _current:=_i; END IF;
    IF p_data ? (_stage->>'column') THEN _implied:=_i; END IF;
  END LOOP;
  _new:=_old;
  IF (_old IS NULL OR _current>0) AND _implied>_current THEN _new:=_spec->'stages'->(_implied-1)->>'status'; END IF;
  FOR _key,_value IN SELECT key,value FROM jsonb_each_text(p_data) LOOP
    _updates:=array_append(_updates,format('%I=%L%s',_key,_value,CASE WHEN _spec->'fields'->_key->>'kind'='date' THEN '::date' ELSE '' END));
    _mirror:=_spec->'fields'->_key->>'summaryColumn';
    IF _mirror IS NOT NULL THEN _summary:=_summary||jsonb_build_object(_mirror,_value); END IF;
  END LOOP;
  EXECUTE format('UPDATE tenant.external_clients__a SET %s,status__a=$1,updated_by=$2,updated_at=now() WHERE id=$3 AND tenant_id=$4',array_to_string(_updates,','))
    USING _new,auth.uid(),p_id,p_tenant;
  -- An existing registration-date trigger must not silently replace an
  -- unrecognised future/suspension state during an unrelated historical import.
  IF _old IS NOT NULL AND _current=0 AND EXISTS(SELECT 1 FROM tenant.external_clients__a WHERE id=p_id AND status__a IS DISTINCT FROM _old) THEN
    RAISE EXCEPTION 'Existing status requires manual review';
  END IF;
  SELECT * INTO _res FROM public.upsert_client_summary(p_id,_summary);
  IF _res.success IS DISTINCT FROM true THEN RAISE EXCEPTION '%',coalesce(_res.message,'Summary update failed'); END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.can_access_bulk_summary_source(p_bucket TEXT,p_path TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT CASE WHEN p_bucket='tenant-uploads' AND strpos(p_path,'/bulk_summary_')>0 THEN
    EXISTS(SELECT 1 FROM system.users u WHERE u.id=auth.uid() AND u.role='admin' AND strpos(p_path,u.tenant_id::text||'/bulk_summary_')=1)
    AND EXISTS(SELECT 1 FROM storage.buckets WHERE id='tenant-uploads' AND public=false)
  ELSE true END
$$;
REVOKE ALL ON FUNCTION public.can_access_bulk_summary_source(TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_bulk_summary_source(TEXT,TEXT) TO anon,authenticated;
DROP POLICY IF EXISTS bulk_summary_sources_admin_only ON storage.objects;
CREATE POLICY bulk_summary_sources_admin_only ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated
USING(public.can_access_bulk_summary_source(bucket_id,name))
WITH CHECK(public.can_access_bulk_summary_source(bucket_id,name));

CREATE OR REPLACE FUNCTION public.apply_bulk_summary_row(
  p_app_id UUID,p_workflow TEXT,p_file_hash TEXT,p_sheet_name TEXT,p_row_number INTEGER,p_data JSONB,
  p_source_file JSONB,p_target_id UUID DEFAULT NULL,p_target_version TEXT DEFAULT NULL,
  p_client_id UUID DEFAULT NULL,p_client_version TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE _ctx RECORD; _data JSONB; _table TEXT; _company TEXT; _iso_key TEXT; _iso TEXT;
  _before JSONB; _client JSONB; _candidate JSONB; _targets JSONB; _clients JSONB;
  _id UUID:=p_target_id; _client_id UUID:=p_client_id; _result JSONB; _logged RECORD;
  _created BOOLEAN:=false; _client_created BOOLEAN:=false; _res RECORD; _uid UUID; _path TEXT; _group TEXT;
BEGIN
  SELECT * INTO _ctx FROM public._bulk_context(p_app_id);
  IF p_file_hash IS NULL OR p_file_hash !~ '^[a-f0-9]{64}$' OR p_row_number IS NULL OR p_row_number<2 OR p_row_number>100000 OR nullif(p_sheet_name,'') IS NULL THEN RAISE EXCEPTION 'Invalid batch identity'; END IF;
  _data:=public._bulk_validate(p_workflow,p_data);
  _table:=CASE p_workflow WHEN 'initial' THEN 'external_clients__a' WHEN 'surveillance' THEN 'renewal_clients__a' ELSE 'recertification_clients__a' END;
  _company:=_data->>CASE WHEN p_workflow='initial' THEN 'Company_name__a' ELSE 'company_name__a' END;
  _iso_key:=CASE WHEN p_workflow='initial' THEN 'ISOStandard__a' ELSE 'iso_standards__a' END;
  _iso:=_data->>_iso_key;
  -- Serialize all batch rows targeting the same company/body, and retries of
  -- the same file row. Different sessions cannot create ordinary duplicates.
  PERFORM pg_advisory_xact_lock(hashtextextended(_ctx.tenant_id::text||':'||lower(btrim(_ctx.body))||':'||public._bulk_company(_company),0));
  _group:=CASE WHEN public._bulk_integrated(_iso) THEN 'integrated' ELSE (public._bulk_numbers(_iso))[1] END;
  SELECT * INTO _logged FROM tenant.bulk_summary_import_results WHERE tenant_id=_ctx.tenant_id
    AND app_id=p_app_id AND workflow=p_workflow AND file_hash=p_file_hash AND sheet_name=p_sheet_name AND row_number=p_row_number AND standard_group=_group;
  IF FOUND THEN
    IF _logged.request_data IS DISTINCT FROM _data THEN RAISE EXCEPTION 'This file row was already imported with different mappings. Use a corrected workbook.'; END IF;
    RETURN _logged.result||jsonb_build_object('already_applied',true);
  END IF;
  _path:=p_source_file->>'path';
  IF p_source_file->>'bucket' IS DISTINCT FROM 'tenant-uploads' OR nullif(p_source_file->>'name','') IS NULL
     OR (_path IS DISTINCT FROM _ctx.tenant_id::text||'/bulk_summary_'||p_file_hash||'.xlsx' AND
         _path IS DISTINCT FROM _ctx.tenant_id::text||'/bulk_summary_'||p_file_hash||'.xls')
     OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='tenant-uploads' AND name=_path) THEN RAISE EXCEPTION 'Upload the bulk source workbook first'; END IF;
  _targets:=public._bulk_candidates(_ctx.tenant_id,_ctx.body,_table,_company,_iso);
  IF _id IS NOT NULL THEN
    SELECT value INTO _candidate FROM jsonb_array_elements(_targets) WHERE value->>'id'=_id::text;
    IF NOT FOUND THEN RAISE EXCEPTION 'Selected target is not eligible for this company/body/standard rule'; END IF;
    EXECUTE format('SELECT to_jsonb(r) FROM tenant.%I r WHERE id=$1 AND tenant_id=$2 FOR UPDATE',_table) INTO _before USING _id,_ctx.tenant_id;
    IF md5(_before::text) IS DISTINCT FROM p_target_version THEN RAISE EXCEPTION 'Target changed since preview. Refresh preview.'; END IF;
    _data:=_data||jsonb_build_object(_iso_key,public._bulk_standards(_before->>_iso_key,_iso));
  ELSIF jsonb_array_length(_targets)>0 THEN RAISE EXCEPTION 'Matching records exist. Select an existing target and refresh preview.';
  END IF;
  IF p_workflow='initial' THEN
    IF _id IS NULL THEN
      _id:=gen_random_uuid(); _created:=true;
      INSERT INTO tenant.external_clients__a(id,tenant_id,name,"Company_name__a","ISOStandard__a",certification_body__a,created_by,updated_by,created_at,updated_at)
        VALUES(_id,_ctx.tenant_id,_company,_company,_iso,_ctx.body,auth.uid(),auth.uid(),now(),now());
    END IF;
    PERFORM public._bulk_update_initial(_id,_ctx.tenant_id,_data);
    _client_id:=_id;
  ELSE
    IF _before IS NOT NULL AND nullif(_before->>'external_client_id__a','') IS NOT NULL THEN
      IF _client_id IS DISTINCT FROM (_before->>'external_client_id__a')::uuid THEN RAISE EXCEPTION 'Use the original client linked to the selected audit record'; END IF;
    END IF;
    _clients:=public._bulk_candidates(_ctx.tenant_id,_ctx.body,'external_clients__a',_company,_iso);
    IF _client_id IS NOT NULL THEN
      SELECT value INTO _candidate FROM jsonb_array_elements(_clients) WHERE value->>'id'=_client_id::text;
      IF NOT FOUND THEN RAISE EXCEPTION 'Selected original client is not eligible'; END IF;
      SELECT to_jsonb(c) INTO _client FROM tenant.external_clients__a c WHERE c.id=_client_id AND c.tenant_id=_ctx.tenant_id FOR UPDATE;
      IF md5(_client::text) IS DISTINCT FROM p_client_version THEN RAISE EXCEPTION 'Original client changed since preview. Refresh preview.'; END IF;
      UPDATE tenant.external_clients__a SET "ISOStandard__a"=public._bulk_standards("ISOStandard__a",_data->>_iso_key),updated_at=now(),updated_by=auth.uid() WHERE id=_client_id;
      -- Keep an already-existing Initial Summary's standard list consistent.
      UPDATE tenant.client_summary__a SET iso_standards__a=public._bulk_standards(iso_standards__a,_data->>_iso_key),updated_at=now()
        WHERE tenant_id=_ctx.tenant_id AND external_client_id__a=_client_id;
    ELSE
      IF jsonb_array_length(_clients)>0 THEN RAISE EXCEPTION 'Select the matching original client'; END IF;
      _client_id:=gen_random_uuid(); _client_created:=true;
      INSERT INTO tenant.external_clients__a(id,tenant_id,name,"Company_name__a","ISOStandard__a",email__a,"contactPerson__a",
        "Adddress__a",country__a,scope__a,"totalNumberOfEmployees__a",iaf_code__a,certification_body__a,created_by,updated_by,created_at,updated_at)
        VALUES(_client_id,_ctx.tenant_id,_company,_company,_iso,_data->>'email__a',_data->>'contact_person__a',
        _data->>'address__a',_data->>'country__a',_data->>'scope__a',_data->>'no_of_employees__a',_data->>'iaf_code__a',_ctx.body,auth.uid(),auth.uid(),now(),now());
      SELECT * INTO _res FROM public.upsert_client_summary(_client_id,jsonb_strip_nulls(jsonb_build_object(
        'country__a',_data->>'country__a','no_of_employees__a',_data->>'no_of_employees__a','iaf_code__a',_data->>'iaf_code__a')));
      IF _res.success IS DISTINCT FROM true THEN RAISE EXCEPTION '%',coalesce(_res.message,'Identity summary update failed'); END IF;
    END IF;
    IF _id IS NULL THEN
      SELECT to_jsonb(c) INTO _client FROM tenant.external_clients__a c WHERE c.id=_client_id AND c.tenant_id=_ctx.tenant_id;
      _uid:=CASE WHEN coalesce(_client->>'client_user_id__a','') ~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN (_client->>'client_user_id__a')::uuid ELSE NULL END;
      _id:=gen_random_uuid(); _created:=true;
      EXECUTE format('INSERT INTO tenant.%I(id,tenant_id,external_client_id__a,client_user_id__a,name,company_name__a,iso_standards__a,email__a,contact_person__a,certification_body__a,created_by,updated_by,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10,$10,now(),now())',_table)
        USING _id,_ctx.tenant_id,_client_id,_uid,_company,_iso,_client->>'email__a',_client->>'contactPerson__a',_ctx.body,auth.uid()::text;
    ELSIF _before->>'external_client_id__a' IS NULL THEN
      EXECUTE format('UPDATE tenant.%I SET external_client_id__a=$1 WHERE id=$2 AND tenant_id=$3',_table) USING _client_id,_id,_ctx.tenant_id;
    END IF;
    IF p_workflow='surveillance' THEN SELECT * INTO _res FROM public.import_renewal_summary(_id,_data,NULL);
    ELSE SELECT * INTO _res FROM public.import_recert_summary(_id,_data,NULL); END IF;
    IF _res.success IS DISTINCT FROM true THEN RAISE EXCEPTION '%',coalesce(_res.message,'Import failed'); END IF;
  END IF;
  _result:=jsonb_build_object('success',true,'record_id',_id,'client_id',_client_id,'created',_created,'client_created',_client_created,'already_applied',false);
  INSERT INTO tenant.bulk_summary_import_results(tenant_id,app_id,workflow,file_hash,sheet_name,row_number,standard_group,request_data,before_data,result,source_file,imported_by)
    VALUES(_ctx.tenant_id,p_app_id,p_workflow,p_file_hash,p_sheet_name,p_row_number,_group,public._bulk_validate(p_workflow,p_data),_before,_result,p_source_file,auth.uid());
  RETURN _result;
END; $$;

REVOKE ALL ON FUNCTION public._bulk_context(UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._bulk_company(TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._bulk_numbers(TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._bulk_integrated(TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._bulk_standards(TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._bulk_validate(TEXT,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._bulk_candidates(UUID,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._bulk_update_initial(UUID,UUID,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.preview_bulk_summary_row(UUID,TEXT,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.apply_bulk_summary_row(UUID,TEXT,TEXT,TEXT,INTEGER,JSONB,JSONB,UUID,TEXT,UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.preview_bulk_summary_row(UUID,TEXT,JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_bulk_summary_row(UUID,TEXT,TEXT,TEXT,INTEGER,JSONB,JSONB,UUID,TEXT,UUID,TEXT) TO authenticated;
COMMIT;
