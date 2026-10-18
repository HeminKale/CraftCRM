-- QA follow-up. Apply after 291. No suspension/withdrawal behavior changes.
BEGIN;

CREATE OR REPLACE FUNCTION public.guard_workflow_team_and_rca()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  _caller UUID := auth.uid();
  _tenant UUID;
  _role TEXT;
  _custom TEXT;
  _old JSONB := coalesce(to_jsonb(OLD), '{}'::jsonb);
  _new JSONB := to_jsonb(NEW);
  _is_crm BOOLEAN;
  _is_import BOOLEAN;
  _approval_status TEXT;
  _approval_date TEXT;
  _team_date TEXT;
BEGIN
  _approval_status := CASE WHEN TG_TABLE_NAME = 'renewal_clients__a'
    THEN 'Surv_Auditor_Accepted' ELSE 'Recert_Auditor_Accepted' END;
  _approval_date := CASE WHEN TG_TABLE_NAME = 'renewal_clients__a'
    THEN 'surv_auditor_accepted_date__a' ELSE 'recert_auditor_accepted_date__a' END;
  _team_date := CASE WHEN TG_TABLE_NAME = 'renewal_clients__a'
    THEN 'team_assigned_date__a' ELSE 'recert_team_assigned_date__a' END;

  SELECT su.tenant_id, su.role, r.name INTO _tenant, _role, _custom
  FROM system.users su LEFT JOIN tenant.roles r ON r.id = su.custom_role_id WHERE su.id = _caller;
  _is_crm := lower(coalesce(_custom, '')) LIKE '%crm%';
  _is_import := TG_TABLE_NAME IN ('renewal_clients__a','recertification_clients__a') AND _is_crm
    AND current_setting('craft.summary_import_record', true) = NEW.id::text;

  IF _new->>'auditor_id__a' IS DISTINCT FROM _old->>'auditor_id__a'
     OR _new->>'tech_reviewer_id__a' IS DISTINCT FROM _old->>'tech_reviewer_id__a'
     OR _new->>_team_date IS DISTINCT FROM _old->>_team_date THEN
    IF _tenant IS DISTINCT FROM NEW.tenant_id OR (_role IS DISTINCT FROM 'admin' AND NOT _is_crm) THEN
      RAISE EXCEPTION 'Access denied: only CRM Office or admin can assign the team';
    END IF;
  END IF;

  IF (_new->>'status__a' = _approval_status AND _new->>'status__a' IS DISTINCT FROM _old->>'status__a')
     OR _new->>_approval_date IS DISTINCT FROM _old->>_approval_date THEN
    IF _tenant IS DISTINCT FROM NEW.tenant_id OR (
      _role IS DISTINCT FROM 'admin' AND NOT coalesce(_is_import, false) AND (
        lower(coalesce(_custom, '')) NOT LIKE '%auditor%'
        OR _old->>'auditor_id__a' IS DISTINCT FROM _caller::text
      )
    ) THEN
      RAISE EXCEPTION 'Access denied: only the assigned Auditor or admin can approve NCR RCA';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workflow_team_and_rca_guard ON tenant.renewal_clients__a;
CREATE TRIGGER workflow_team_and_rca_guard BEFORE INSERT OR UPDATE ON tenant.renewal_clients__a
FOR EACH ROW EXECUTE FUNCTION public.guard_workflow_team_and_rca();
DROP TRIGGER IF EXISTS workflow_team_and_rca_guard ON tenant.recertification_clients__a;
CREATE TRIGGER workflow_team_and_rca_guard BEFORE INSERT OR UPDATE ON tenant.recertification_clients__a
FOR EACH ROW EXECUTE FUNCTION public.guard_workflow_team_and_rca();

-- start_file_upload already checks role names. Check the record assignment
-- at attachment creation too, so another Auditor/Tech Reviewer cannot upload.
CREATE OR REPLACE FUNCTION public.guard_workflow_upload_assignment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  _object TEXT;
  _field TEXT;
  _tenant UUID;
  _role TEXT;
  _custom TEXT;
  _assigned UUID;
BEGIN
  SELECT o.name, f.name INTO _object, _field FROM tenant.objects o
  JOIN tenant.fields f ON f.object_id = o.id WHERE o.id = NEW.object_id AND f.id = NEW.field_id;
  IF _object NOT IN ('renewal_clients__a', 'recertification_clients__a') THEN RETURN NEW; END IF;
  SELECT su.tenant_id, su.role, r.name INTO _tenant, _role, _custom FROM system.users su
  LEFT JOIN tenant.roles r ON r.id = su.custom_role_id WHERE su.id = auth.uid();
  IF _tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF _role = 'admin' THEN RETURN NEW; END IF;
  IF _field IN ('surv_audit_plan', 'surv_ncr', 'surveillance_audit_report', 'recert_audit_plan', 'recert_ncr', 'recert_audit_report')
     AND lower(coalesce(_custom, '')) NOT LIKE '%crm%' THEN
    EXECUTE format('SELECT auditor_id__a FROM tenant.%I WHERE id = $1 AND tenant_id = $2', _object)
      INTO _assigned USING NEW.record_id, _tenant;
    IF _assigned IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Access denied: you are not the assigned Auditor'; END IF;
  ELSIF _field IN ('surv_tech_findings_file', 'recert_tech_findings_file') THEN
    EXECUTE format('SELECT tech_reviewer_id__a FROM tenant.%I WHERE id = $1 AND tenant_id = $2', _object)
      INTO _assigned USING NEW.record_id, _tenant;
    IF _assigned IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Access denied: you are not the assigned Tech Reviewer'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS workflow_upload_assignment_guard ON tenant.attachments;
CREATE TRIGGER workflow_upload_assignment_guard BEFORE INSERT ON tenant.attachments
FOR EACH ROW EXECUTE FUNCTION public.guard_workflow_upload_assignment();

-- Client's blank Assign Team cell means no access to team details, not
-- merely hidden controls. Keep them out of the record API response too.
CREATE OR REPLACE FUNCTION public._workflow_record_for_reader(
  p_object TEXT, p_data JSONB, p_role TEXT, p_custom TEXT, p_email TEXT, p_caller UUID
)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE _client BOOLEAN;
BEGIN
  _client := p_role IS DISTINCT FROM 'admin' AND (
    lower(coalesce(p_custom, '')) LIKE '%external%client%' OR lower(coalesce(p_custom, '')) LIKE '%external%customer%'
    OR p_data->>'client_user_id__a' = p_caller::text
    OR (nullif(p_data->>'email__a', '') IS NOT NULL AND lower(p_data->>'email__a') = lower(p_email))
  );
  IF coalesce(_client, false) AND p_object IN ('renewal_clients__a', 'recertification_clients__a') THEN
    RETURN p_data - ARRAY[
      'auditor_id__a', 'tech_reviewer_id__a', 'auditor_id', 'tech_reviewer_id',
      'team_assigned_date__a', 'recert_team_assigned_date__a', 'team_assigned_date', 'recert_team_assigned_date',
      'auditor_name__a', 'tech_reviewer_name__a', 'auditor_team__a', 'lead_auditor__a'
    ];
  END IF;
  RETURN p_data;
END;
$$;
REVOKE ALL ON FUNCTION public._workflow_record_for_reader(TEXT, JSONB, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.get_object_records_with_references(
  p_object_id UUID, p_tenant_id UUID, p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0, p_certification_body TEXT DEFAULT NULL
)
RETURNS TABLE(record_id UUID, record_data JSONB) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  _tenant UUID;
  _role TEXT;
  _custom TEXT;
  _email TEXT;
  _object TEXT;
  _row RECORD;
BEGIN
  SELECT su.tenant_id, su.role, r.name, su.email INTO _tenant, _role, _custom, _email
  FROM system.users su LEFT JOIN tenant.roles r ON r.id = su.custom_role_id WHERE su.id = auth.uid();
  IF _tenant IS NULL OR _tenant IS DISTINCT FROM p_tenant_id THEN RAISE EXCEPTION 'Access denied: invalid tenant'; END IF;
  SELECT o.name INTO _object FROM tenant.objects o WHERE o.id = p_object_id AND o.tenant_id = _tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Object not found'; END IF;
  IF NOT public._check_permission('object', p_object_id, 'read') THEN
    RAISE EXCEPTION 'Access denied: you do not have read permission for this object';
  END IF;

  FOR _row IN SELECT * FROM tenant.get_object_records_with_references(p_object_id, p_limit, p_offset, p_certification_body) LOOP
    IF _row.record_data->>'tenant_id' IS DISTINCT FROM _tenant::text THEN CONTINUE; END IF;
    record_id := _row.record_id;
    record_data := public._workflow_record_for_reader(_object, _row.record_data, _role, _custom, _email, auth.uid());
    RETURN NEXT;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.get_object_records_with_references(UUID, UUID, INTEGER, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_object_records_with_references(UUID, UUID, INTEGER, INTEGER, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION tenant.get_object_records_with_references(UUID, INTEGER, INTEGER, TEXT) FROM PUBLIC, authenticated;

-- The older read endpoint is still used by forms. Apply the same redaction
-- there rather than leaving a second API path to the hidden team fields.
CREATE OR REPLACE FUNCTION public.get_object_records(
  p_object_id UUID, p_tenant_id UUID, p_limit INTEGER DEFAULT 100, p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(record_id UUID, record_data JSONB) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  _tenant UUID;
  _role TEXT;
  _custom TEXT;
  _email TEXT;
  _object TEXT;
  _row RECORD;
BEGIN
  SELECT su.tenant_id, su.role, r.name, su.email INTO _tenant, _role, _custom, _email
  FROM system.users su LEFT JOIN tenant.roles r ON r.id = su.custom_role_id WHERE su.id = auth.uid();
  IF _tenant IS NULL OR _tenant IS DISTINCT FROM p_tenant_id THEN RAISE EXCEPTION 'Access denied: invalid tenant'; END IF;
  SELECT o.name INTO _object FROM tenant.objects o WHERE o.id = p_object_id AND o.tenant_id = _tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Object not found'; END IF;
  IF NOT public._check_permission('object', p_object_id, 'read') THEN
    RAISE EXCEPTION 'Access denied: you do not have read permission for this object';
  END IF;
  FOR _row IN SELECT * FROM tenant.get_object_records(p_object_id, p_limit, p_offset) LOOP
    IF _row.record_data->>'tenant_id' IS DISTINCT FROM _tenant::text THEN CONTINUE; END IF;
    record_id := _row.record_id;
    record_data := public._workflow_record_for_reader(_object, _row.record_data, _role, _custom, _email, auth.uid());
    RETURN NEXT;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.get_object_records(UUID, UUID, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_object_records(UUID, UUID, INTEGER, INTEGER) TO authenticated;
REVOKE EXECUTE ON FUNCTION tenant.get_object_records(UUID, INTEGER, INTEGER) FROM PUBLIC, authenticated;

-- Require a real client link and prefer the company label over a legacy placeholder.
CREATE OR REPLACE FUNCTION public.create_renewal_client(
  p_external_client_id  UUID DEFAULT NULL,
  p_email                TEXT DEFAULT NULL,   -- overrides copied email__a when provided
  p_certification_body   TEXT DEFAULT NULL    -- NEW: which app (Americo/BQSR/AQSR) this was created under
)
RETURNS TABLE(success BOOLEAN, message TEXT, record_id UUID)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_id    UUID;
  _caller_role  TEXT;
  _custom_role  TEXT;
  _caller_name  TEXT;
  _tenant_id    UUID;
  _name         TEXT;
  _company      TEXT;
  _contact      TEXT;
  _email        TEXT;
  _iso          TEXT;
  _client_uid   UUID;
  _new_id       UUID;
BEGIN
  _caller_id := auth.uid();
  SELECT su.tenant_id, su.role INTO _tenant_id, _caller_role
  FROM system.users su WHERE su.id = _caller_id;

  SELECT r.name INTO _custom_role
  FROM system.users su
  JOIN tenant.roles r ON r.id = su.custom_role_id
  WHERE su.id = _caller_id;

  IF _caller_role != 'admin' AND (lower(coalesce(_custom_role,'')) NOT LIKE '%crm%') THEN
    RETURN QUERY SELECT false, 'Access denied: CRM Office role required', NULL::UUID;
    RETURN;
  END IF;

  -- Resolve caller display name (full name → email → uuid fallback)
  _caller_name := COALESCE(
    public.current_user_full_name(),
    _caller_id::text
  );

  IF p_external_client_id IS NULL THEN
    RETURN QUERY SELECT false, 'Select or create a client first', NULL::UUID;
    RETURN;
  END IF;

  -- Copy the selected client, including its company name.
  IF p_external_client_id IS NOT NULL THEN
    SELECT
      ec.name,
      ec."Company_name__a",
      ec."contactPerson__a",
      ec."email__a",
      ec."ISOStandard__a",
      ec."client_user_id__a"
    INTO _name, _company, _contact, _email, _iso, _client_uid
    FROM tenant.external_clients__a ec
    WHERE ec.id = p_external_client_id AND ec.tenant_id = _tenant_id;

    IF NOT FOUND THEN
      RETURN QUERY SELECT false, 'External client not found', NULL::UUID;
      RETURN;
    END IF;
  END IF;

  -- Explicit p_email always wins over the copied value, when given
  _email := COALESCE(NULLIF(trim(p_email), ''), _email);

  _new_id := gen_random_uuid();

  INSERT INTO tenant.renewal_clients__a (
    id, tenant_id, external_client_id__a, client_user_id__a,
    name, company_name__a, contact_person__a, email__a, iso_standards__a,
    certification_body__a,
    created_by, updated_by,
    created_at, updated_at
  ) VALUES (
    _new_id, _tenant_id,
    p_external_client_id,
    _client_uid,
    COALESCE(NULLIF(btrim(_company), ''), NULLIF(btrim(_name), ''), 'Surveillance Client'),
    _company,
    _contact,
    _email,
    _iso,
    NULLIF(trim(p_certification_body), ''),
    _caller_name, _caller_name,
    now(), now()
  );

  RETURN QUERY SELECT true, 'Renewal record created', _new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_renewal_client(UUID, TEXT, TEXT) TO authenticated;


COMMIT;
