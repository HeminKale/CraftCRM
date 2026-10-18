-- Enforce configured field read/edit permissions at the API, not just UI.
-- Keep client reports locked until tech review, including email-linked clients.
BEGIN;

CREATE OR REPLACE FUNCTION public._workflow_record_for_reader(
  p_object TEXT, p_data JSONB, p_role TEXT, p_custom TEXT, p_email TEXT, p_caller UUID
)
RETURNS JSONB LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  _client BOOLEAN;
  _field RECORD;
  _name TEXT;
  _order TEXT[];
  _report TEXT;
  _unlock TEXT;
BEGIN
  _client := p_role IS DISTINCT FROM 'admin' AND (
    lower(coalesce(p_custom, '')) LIKE '%external%client%' OR lower(coalesce(p_custom, '')) LIKE '%external%customer%'
    OR p_data->>'client_user_id__a' = p_caller::text
    OR (nullif(p_data->>'email__a', '') IS NOT NULL AND lower(p_data->>'email__a') = lower(p_email))
  );
  IF coalesce(_client, false) AND p_object IN ('renewal_clients__a', 'recertification_clients__a') THEN
    p_data := p_data - ARRAY[
      'auditor_id__a', 'tech_reviewer_id__a', 'auditor_id', 'tech_reviewer_id',
      'team_assigned_date__a', 'recert_team_assigned_date__a', 'team_assigned_date', 'recert_team_assigned_date',
      'auditor_name__a', 'tech_reviewer_name__a', 'auditor_team__a', 'lead_auditor__a'
    ];
    IF p_object = 'renewal_clients__a' THEN
      _report := 'surveillance_audit_report'; _unlock := 'Surv_Tech_Findings_Given';
      _order := ARRAY['Intimation_Sent','Intimation_Accepted','Team_Assigned','Surv_Plan_Sent','Surv_Plan_Accepted',
        'Surv_NCR_Sent','Surv_NCR_RCA_Uploaded','Surv_Auditor_Accepted','Surv_Report_Sent','Surv_Tech_Findings_Given',
        'Surv_Closed','CDC_Approved','Certificate_Issued','Suspension_Intimation_Sent','Suspension_Decision_Uploaded',
        'Suspension_Letter_Sent','Withdrawal_Intimation_Sent','Withdrawal_Decision_Uploaded','Withdrawal_Letter_Sent'];
    ELSE
      _report := 'recert_audit_report'; _unlock := 'Recert_Tech_Findings_Given';
      _order := ARRAY['Recert_Intimation_Sent','Recert_Application_Sent','Recert_Application_Accepted','Recert_Quotation_Received',
        'Recert_Agreement_Sent','Recert_Agreement_Signed','Recert_Team_Assigned','Recert_Plan_Sent','Recert_Plan_Accepted',
        'Recert_NCR_Sent','Recert_NCR_RCA_Uploaded','Recert_Auditor_Accepted','Recert_Evidences_Uploaded','Recert_Evidences_Accepted',
        'Recert_Report_Sent','Recert_Tech_Findings_Given','Recert_Closed','Recert_CDC_Approved','Recert_Certificate_Issued'];
    END IF;
    IF coalesce(array_position(_order,p_data->>'status__a'),0) < array_position(_order,_unlock) THEN
      p_data := p_data - _report - (_report || '__a');
    END IF;
  END IF;
  IF p_role IS DISTINCT FROM 'admin' THEN
    FOR _field IN SELECT f.id,f.name FROM tenant.fields f JOIN tenant.objects o ON o.id=f.object_id
      WHERE o.name=p_object AND o.tenant_id=(p_data->>'tenant_id')::uuid LOOP
      IF NOT public._check_permission('field',_field.id,'read') THEN
        _name := regexp_replace(_field.name,'__a$','');
        p_data := p_data - _name - (_name || '__a');
      END IF;
    END LOOP;
  END IF;
  RETURN p_data;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_tenant_record(
  p_table_name TEXT, p_record_id UUID, p_tenant_id UUID, p_update_data JSONB
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  _caller UUID := auth.uid();
  _tenant UUID;
  _role TEXT;
  _custom UUID;
  _object UUID;
  _field UUID;
  _field_type TEXT;
  _reference_table TEXT;
  _reference_schema TEXT;
  _reference_allowed BOOLEAN;
  _edit_mode TEXT;
  _record JSONB;
  _key TEXT;
  _value TEXT;
  _updates TEXT[] := ARRAY[]::text[];
  _owner TEXT;
  _affected INTEGER;
BEGIN
  SELECT su.tenant_id,su.role,su.custom_role_id INTO _tenant,_role,_custom FROM system.users su WHERE su.id=_caller;
  IF _tenant IS NULL OR _tenant IS DISTINCT FROM p_tenant_id THEN RAISE EXCEPTION 'Access denied: invalid tenant'; END IF;
  SELECT o.id INTO _object FROM tenant.objects o WHERE o.name=p_table_name AND o.tenant_id=_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Object not found'; END IF;
  IF NOT public._check_permission('object',_object,'edit') THEN RAISE EXCEPTION 'Access denied: object is read-only'; END IF;
  IF p_update_data IS NULL OR jsonb_typeof(p_update_data)<>'object' THEN RAISE EXCEPTION 'Update data must be an object'; END IF;
  EXECUTE format('SELECT to_jsonb(t) FROM tenant.%I t WHERE id=$1 AND tenant_id=$2 FOR UPDATE',p_table_name)
    INTO _record USING p_record_id,_tenant;
  IF _record IS NULL THEN RAISE EXCEPTION 'Record not found'; END IF;
  IF _role IS DISTINCT FROM 'admin' THEN
    SELECT effective_edit_mode INTO _edit_mode FROM public._resolve_sharing_mode(_object,_tenant);
    _owner := coalesce(_record->>'record_owner__a',_record->>'created_by');
    IF _edit_mode='owner' OR (_edit_mode='role_peers' AND _custom IS NULL) THEN
      IF _owner IS DISTINCT FROM _caller::text THEN RAISE EXCEPTION 'Access denied: you can only edit your own records'; END IF;
    ELSIF _edit_mode='role_peers' AND NOT EXISTS(SELECT 1 FROM system.users su WHERE su.id::text=_owner AND su.tenant_id=_tenant AND su.custom_role_id=_custom) THEN
      RAISE EXCEPTION 'Access denied: record is outside your role group';
    END IF;
  END IF;
  FOR _key,_value IN SELECT key,value FROM jsonb_each_text(p_update_data) LOOP
    -- The existing edit form submits unchanged values too. Ignore them before
    -- checking immutable/hidden fields, rather than breaking ordinary saves.
    IF _record->>_key IS NOT DISTINCT FROM _value THEN CONTINUE; END IF;
    IF _key IN ('id','tenant_id','created_at','updated_at','created_by','updated_by','client_user_id__a','certification_body__a') THEN
      RAISE EXCEPTION 'Access denied: protected field %',_key;
    END IF;
    IF p_table_name IN ('renewal_clients__a','recertification_clients__a') AND _key='status__a' THEN
      RAISE EXCEPTION 'Access denied: use the workflow action or summary import to change status';
    END IF;
    SELECT f.id,f.type,f.reference_table INTO _field,_field_type,_reference_table FROM tenant.fields f WHERE f.object_id=_object AND
      (f.name=_key OR f.name || '__a'=_key) LIMIT 1;
    IF p_table_name IN ('renewal_clients__a','recertification_clients__a') AND (
      _field_type IN ('file','files') OR
      (_key LIKE '%\_date\_\_a' ESCAPE '\' AND _key NOT IN ('surveillance_audit_date__a','recert_audit_date__a','soa_date__a')) OR
      _key IN ('surv_tech_findings_notes__a','surv_closure_notes__a','recert_tech_findings_notes__a','recert_closure_notes__a')
    ) THEN RAISE EXCEPTION 'Access denied: use the dedicated workflow action for field %',_key; END IF;
    IF _role IS DISTINCT FROM 'admin' AND (_field IS NULL OR NOT public._check_permission('field',_field,'edit')) THEN
      RAISE EXCEPTION 'Access denied: field % is not editable',_key;
    END IF;
    IF NOT (_record ? _key) THEN RAISE EXCEPTION 'Unknown field: %',_key; END IF;
    IF _field_type='reference' AND _reference_table IS NOT NULL AND _value IS NOT NULL THEN
      _reference_schema := CASE WHEN strpos(_reference_table,'.')>0 THEN split_part(_reference_table,'.',1) ELSE 'tenant' END;
      _reference_table := CASE WHEN strpos(_reference_table,'.')>0 THEN split_part(_reference_table,'.',2) ELSE _reference_table END;
      IF _reference_schema NOT IN ('tenant','system') THEN RAISE EXCEPTION 'Unsupported reference target'; END IF;
      EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I WHERE id=$1::uuid AND tenant_id=$2)',_reference_schema,_reference_table)
        INTO _reference_allowed USING _value,_tenant;
      IF NOT _reference_allowed THEN RAISE EXCEPTION 'Reference must belong to your tenant'; END IF;
    END IF;
    _updates := array_append(_updates,format('%I=%L',_key,_value));
  END LOOP;
  IF cardinality(_updates)=0 THEN RETURN; END IF;
  EXECUTE format('UPDATE tenant.%I SET %s,updated_at=now() WHERE id=%L AND tenant_id=%L',
    p_table_name,array_to_string(_updates,', '),p_record_id,_tenant);
  GET DIAGNOSTICS _affected=ROW_COUNT;
  IF _affected<>1 THEN RAISE EXCEPTION 'Record not found'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.update_tenant_record(TEXT,UUID,UUID,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_tenant_record(TEXT,UUID,UUID,JSONB) TO authenticated;
COMMIT;
