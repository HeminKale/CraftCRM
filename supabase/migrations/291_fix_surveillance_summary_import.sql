-- Surveillance summary import: canonical column names, exact-record preview,
-- CRM/admin authorization, and atomic metadata/date/status/attachment updates.
-- Apply before deploying the updated SurveilanceImport component.
BEGIN;

CREATE OR REPLACE FUNCTION public._surveillance_import_tenant()
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  _tenant UUID;
  _role TEXT;
  _custom_role TEXT;
BEGIN
  SELECT su.tenant_id, su.role, r.name INTO _tenant, _role, _custom_role
  FROM system.users su LEFT JOIN tenant.roles r ON r.id = su.custom_role_id
  WHERE su.id = auth.uid();
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _role IS DISTINCT FROM 'admin' AND lower(coalesce(_custom_role, '')) NOT LIKE '%crm%' THEN
    RAISE EXCEPTION 'Access denied: CRM Office or admin required for summary import';
  END IF;
  RETURN _tenant;
END;
$$;
REVOKE ALL ON FUNCTION public._surveillance_import_tenant() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.get_renewal_summary_import_state(p_record_id UUID)
RETURNS TABLE(current_status TEXT) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE _tenant UUID;
BEGIN
  _tenant := public._surveillance_import_tenant();
  RETURN QUERY SELECT rc.status__a::text FROM tenant.renewal_clients__a rc
  WHERE rc.id = p_record_id AND rc.tenant_id = _tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Surveillance record not found'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.import_renewal_summary(
  p_record_id UUID, p_data JSONB, p_file_json JSONB DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, message TEXT, current_status TEXT, imported_fields INTEGER)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  _tenant UUID;
  _old_status TEXT;
  _new_status TEXT;
  _key TEXT;
  _column TEXT;
  _value TEXT;
  _normalized JSONB := '{}'::jsonb;
  _updates TEXT[] := ARRAY[]::text[];
  _current_rank INTEGER;
  _implied_rank INTEGER := 0;
  _i INTEGER;
  _previous_import TEXT;
  _text_columns TEXT[] := ARRAY[
    'company_name__a', 'address__a', 'contact_person__a', 'email__a', 'iso_standards__a',
    'certificate_no__a', 'country__a', 'scope__a', 'iaf_code__a', 'no_of_employees__a',
    'surv_mandays__a', 'auditor_team__a', 'surveillance_audit_date__a', 'auditor_name__a',
    'lead_auditor__a', 'tech_reviewer_name__a', 'cdc_name__a', 'director_name__a',
    'application_reviewer__a', 'food_category__a', 'soa_date__a', 'surv_tech_findings_notes__a'
  ];
  _date_columns TEXT[] := ARRAY[
    'intimation_sent_date__a', 'intimation_accepted_date__a', 'team_assigned_date__a',
    'surv_plan_sent_date__a', 'surv_plan_accepted_date__a', 'surv_ncr_sent_date__a',
    'surv_ncr_rca_uploaded_date__a', 'surv_auditor_accepted_date__a', 'surv_report_sent_date__a',
    'surv_tech_findings_date__a', 'surv_closed_date__a', 'cdc_date__a', 'certificates_sent_date__a'
  ];
  _status_order TEXT[] := ARRAY[
    'Intimation_Sent', 'Intimation_Accepted', 'Team_Assigned', 'Surv_Plan_Sent',
    'Surv_Plan_Accepted', 'Surv_NCR_Sent', 'Surv_NCR_RCA_Uploaded', 'Surv_Auditor_Accepted',
    'Surv_Report_Sent', 'Surv_Tech_Findings_Given', 'Surv_Closed', 'CDC_Approved', 'Certificate_Issued',
    'Suspension_Intimation_Sent', 'Suspension_Decision_Uploaded', 'Suspension_Letter_Sent',
    'Withdrawal_Intimation_Sent', 'Withdrawal_Decision_Uploaded', 'Withdrawal_Letter_Sent'
  ];
BEGIN
  _tenant := public._surveillance_import_tenant();
  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' THEN
    RAISE EXCEPTION 'Summary data must be an object';
  END IF;

  -- Lock the selected record, not the newest record in the list. Re-read its
  -- status here so a preview that became stale can never rewind the workflow.
  SELECT rc.status__a INTO _old_status FROM tenant.renewal_clients__a rc
  WHERE rc.id = p_record_id AND rc.tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Surveillance record not found'; END IF;

  FOR _key, _value IN SELECT key, value FROM jsonb_each_text(p_data) LOOP
    _column := regexp_replace(_key, '__a$', '') || '__a';
    IF NOT (_column = ANY(_text_columns) OR _column = ANY(_date_columns)) THEN
      RAISE EXCEPTION 'Unsupported summary field: %', _key;
    END IF;
    IF _value IS NULL OR btrim(_value) = '' THEN CONTINUE; END IF;
    IF _normalized ? _column AND _normalized->>_column IS DISTINCT FROM _value THEN
      RAISE EXCEPTION 'Conflicting values for summary field: %', _column;
    END IF;
    _normalized := _normalized || jsonb_build_object(_column, _value);
  END LOOP;

  FOR _column, _value IN SELECT key, value FROM jsonb_each_text(_normalized) LOOP
    IF _column = ANY(_date_columns) THEN
      -- Cast before any UPDATE. A bad date aborts the entire import.
      PERFORM _value::date;
      _updates := array_append(_updates, format('%I = %L::date', _column, _value));
    ELSE
      _updates := array_append(_updates, format('%I = %L', _column, _value));
    END IF;
  END LOOP;

  IF p_file_json IS NOT NULL THEN
    IF jsonb_typeof(p_file_json) <> 'object'
       OR p_file_json->>'bucket' IS DISTINCT FROM 'tenant-uploads'
       OR coalesce(p_file_json->>'name', '') = ''
       OR coalesce(strpos(p_file_json->>'path', _tenant::text || '/renewal_summary_' || p_record_id::text || '_'), 0) <> 1
    THEN RAISE EXCEPTION 'Invalid surveillance summary attachment'; END IF;
  END IF;

  _current_rank := array_position(_status_order, _old_status);
  IF _old_status IS NULL OR btrim(_old_status) = '' THEN _current_rank := 0;
  ELSIF _old_status = 'Audit_Plan_Sent' THEN _current_rank := 4;
  ELSIF _old_status = 'Audit_Plan_Accepted' THEN _current_rank := 5;
  ELSIF _old_status = 'Renewal_Complete' THEN _current_rank := 13;
  END IF;
  FOR _i IN 1..array_length(_date_columns, 1) LOOP
    IF _normalized ? _date_columns[_i] THEN _implied_rank := _i; END IF;
  END LOOP;
  _new_status := _old_status;
  -- Preserve unknown statuses conservatively, including future workflows.
  IF _current_rank IS NOT NULL AND _implied_rank > _current_rank THEN
    _new_status := _status_order[_implied_rank];
  END IF;

  -- A historical summary import is an explicit CRM/admin operation. This
  -- record-scoped marker lets the narrow RCA/team guard in 292 distinguish
  -- it from an unauthorized generic status update.
  _previous_import := current_setting('craft.summary_import_record', true);
  PERFORM set_config('craft.summary_import_record', p_record_id::text, true);
  IF cardinality(_updates) > 0 THEN
    EXECUTE format('UPDATE tenant.renewal_clients__a SET %s WHERE id = %L AND tenant_id = %L',
      array_to_string(_updates, ', '), p_record_id, _tenant);
  END IF;
  UPDATE tenant.renewal_clients__a rc
  SET status__a = _new_status, updated_at = now(),
      surv_audit_pack__a = CASE WHEN p_file_json IS NULL THEN rc.surv_audit_pack__a
        WHEN jsonb_typeof(rc.surv_audit_pack__a) = 'array' THEN rc.surv_audit_pack__a || jsonb_build_array(p_file_json)
        ELSE jsonb_build_array(p_file_json) END
  WHERE rc.id = p_record_id AND rc.tenant_id = _tenant;
  PERFORM set_config('craft.summary_import_record', coalesce(_previous_import, ''), true);
  RETURN QUERY SELECT true, 'Summary imported'::text, _new_status, cardinality(_updates);
END;
$$;

-- Keep the existing Summary tab Save API working with bare or suffixed keys.
CREATE OR REPLACE FUNCTION public.upsert_renewal_from_summary(p_record_id UUID, p_data JSONB)
RETURNS TABLE(success BOOLEAN, message TEXT) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RETURN QUERY SELECT r.success, r.message FROM public.import_renewal_summary(p_record_id, p_data, NULL) r;
END;
$$;

REVOKE ALL ON FUNCTION public.get_renewal_summary_import_state(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.import_renewal_summary(UUID, JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_renewal_from_summary(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_renewal_summary_import_state(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_renewal_summary(UUID, JSONB, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_renewal_from_summary(UUID, JSONB) TO authenticated;
COMMIT;
