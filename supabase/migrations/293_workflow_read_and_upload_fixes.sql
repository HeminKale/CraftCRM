-- Pending QA fixes: tenant/assigned-user/sharing read filters and email-linked upload finalization.
-- Suspension/withdrawal sequencing and rejection behavior are unchanged.
BEGIN;
CREATE OR REPLACE FUNCTION tenant.get_object_records_with_references(
    p_object_id UUID,
    p_limit INTEGER DEFAULT 100,
    p_offset INTEGER DEFAULT 0,
    p_certification_body TEXT DEFAULT NULL   -- app-scoping filter (284)
)
RETURNS TABLE(
    record_id uuid,
    record_data jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_table_name text;
    v_caller_tenant uuid;
    v_system_role text;
    v_custom_role_id uuid;
    v_read_mode text;
    v_owner_column text;
    v_select_sql text;
    v_jsonb_fields text := '';
    v_column_record record;
    v_reference_fields text := '';
    v_join_clauses text := '';
    v_field_record record;
    v_reference_table text;
    v_display_field text;
    v_join_alias text;
    v_join_counter integer := 1;
    v_where_clause text := '';
    v_has_cert_body_col boolean := false;
    -- caller-identity scoping for the External Client role (288)
    v_caller_id uuid;
    v_caller_email text;
    v_custom_role text;
    v_is_external_client boolean := false;
    v_has_client_user_id_col boolean := false;
    v_has_email_col boolean := false;
BEGIN
    SELECT su.tenant_id, su.role, su.custom_role_id INTO v_caller_tenant, v_system_role, v_custom_role_id
    FROM system.users su WHERE su.id = auth.uid();
    IF v_caller_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    -- Get table name from tenant.objects
    SELECT o.name INTO v_table_name
    FROM tenant.objects o
    WHERE o.id = p_object_id AND o.tenant_id = v_caller_tenant;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Object not found';
    END IF;

    -- resolve caller identity + role once, only relevant for the 3 client
    -- tables the read-scoping (288) applies to.
    v_caller_id := auth.uid();

    SELECT su.email INTO v_caller_email
    FROM system.users su WHERE su.id = v_caller_id;

    SELECT r.name INTO v_custom_role
    FROM system.users su
    JOIN tenant.roles r ON r.id = su.custom_role_id
    WHERE su.id = v_caller_id;

    v_is_external_client := v_system_role IS DISTINCT FROM 'admin' AND (
      lower(coalesce(v_custom_role, '')) LIKE '%external%client%' OR
      lower(coalesce(v_custom_role, '')) LIKE '%external%customer%');
    v_where_clause := ' AND t.tenant_id = ' || quote_literal(v_caller_tenant::text);

    IF v_system_role IS DISTINCT FROM 'admin' THEN
      SELECT effective_read_mode INTO v_read_mode FROM public._resolve_sharing_mode(p_object_id, v_caller_tenant);
      SELECT CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='tenant' AND table_name=v_table_name AND column_name='record_owner__a')
        THEN 'record_owner__a' ELSE 'created_by' END INTO v_owner_column;
      IF v_read_mode = 'owner' OR (v_read_mode = 'role_peers' AND v_custom_role_id IS NULL) THEN
        v_where_clause := v_where_clause || format(' AND t.%I::text = %L', v_owner_column, v_caller_id::text);
      ELSIF v_read_mode = 'role_peers' THEN
        v_where_clause := v_where_clause || format(' AND t.%I::text IN (SELECT su.id::text FROM system.users su WHERE su.tenant_id=%L AND su.custom_role_id=%L)', v_owner_column, v_caller_tenant, v_custom_role_id);
      END IF;
      IF v_table_name IN ('renewal_clients__a','recertification_clients__a')
         AND lower(coalesce(v_custom_role,'')) NOT LIKE '%crm%' AND lower(coalesce(v_custom_role,'')) NOT LIKE '%cdc%'
         AND (lower(coalesce(v_custom_role,'')) LIKE '%auditor%' OR lower(coalesce(v_custom_role,'')) LIKE '%tech%') THEN
        v_where_clause := v_where_clause || format(' AND ((%L AND t.auditor_id__a=%L) OR (%L AND t.tech_reviewer_id__a=%L))',
          lower(coalesce(v_custom_role,'')) LIKE '%auditor%', v_caller_id,
          lower(coalesce(v_custom_role,'')) LIKE '%tech%', v_caller_id);
      END IF;
    END IF;

    -- First pass: Build basic JSONB fields (non-reference fields)
    FOR v_column_record IN
        SELECT c.column_name, c.data_type
        FROM information_schema.columns c
        WHERE c.table_schema = 'tenant'
        AND c.table_name = v_table_name
        AND c.column_name NOT IN ('id', 'created_at', 'updated_at')
        AND c.column_name NOT IN ('autonumber')
        ORDER BY c.ordinal_position
    LOOP
        -- Check if this column is a reference field. FIXED (290): match
        -- either the exact registered name OR name || '__a' — the
        -- physical column almost always carries the __a suffix while
        -- tenant.fields.name is registered WITHOUT it (see migration
        -- header). Previously only the exact match was tried, so this
        -- check silently never fired for any standard custom field.
        SELECT f.reference_table, f.reference_display_field
        INTO v_reference_table, v_display_field
        FROM tenant.fields f
        WHERE f.object_id = p_object_id
        AND (f.name = v_column_record.column_name OR f.name || '__a' = v_column_record.column_name)
        AND f.type = 'reference';

        IF v_reference_table IS NOT NULL THEN
            -- This is a reference field - we'll handle it in the second pass
            CONTINUE;
        END IF;

        IF v_column_record.column_name = 'certification_body__a' THEN
            v_has_cert_body_col := true;
        END IF;

        -- track whether this table has the two identity columns
        IF v_column_record.column_name = 'client_user_id__a' THEN
            v_has_client_user_id_col := true;
        END IF;
        IF v_column_record.column_name = 'email__a' THEN
            v_has_email_col := true;
        END IF;

        -- Handle different data types safely for non-reference fields
        IF v_column_record.data_type = 'bigint' THEN
            v_jsonb_fields := v_jsonb_fields ||
                CASE
                    WHEN v_jsonb_fields != '' THEN ' || '
                    ELSE ''
                END ||
                'jsonb_build_object(' || quote_literal(v_column_record.column_name) || ', COALESCE(NULLIF(t.' || quote_ident(v_column_record.column_name) || '::text, ''''), NULL))';
        ELSE
            v_jsonb_fields := v_jsonb_fields ||
                CASE
                    WHEN v_jsonb_fields != '' THEN ' || '
                    ELSE ''
                END ||
                'jsonb_build_object(' || quote_literal(v_column_record.column_name) || ', COALESCE(t.' || quote_ident(v_column_record.column_name) || '::text, ''''))';
        END IF;
    END LOOP;

    -- Second pass: Build reference field resolution and JOIN clauses
    -- ONLY for tenant schema tables (skip system.users, auth.users for now)
    -- Also skip created_by and updated_by fields since they're now text fields
    FOR v_field_record IN
        SELECT f.name, f.reference_table, f.reference_display_field
        FROM tenant.fields f
        WHERE f.object_id = p_object_id
        AND f.type = 'reference'
        AND f.reference_table IS NOT NULL
        AND f.reference_table NOT LIKE 'system.%'  -- Skip system tables
        AND f.reference_table != 'auth.users'      -- Skip auth tables
        AND f.reference_table NOT LIKE 'auth.%'    -- Skip all auth tables
        AND f.name NOT IN ('created_by', 'updated_by')  -- Skip these specific fields
    LOOP
        -- Generate unique alias for this JOIN
        v_join_alias := 'ref_' || v_join_counter;

        -- Determine the best display field for the reference table
        IF v_field_record.reference_display_field IS NOT NULL THEN
            v_display_field := v_field_record.reference_display_field;
        ELSE
            -- Auto-detect best display field (prioritize name, label, title)
            SELECT COALESCE(
                (SELECT column_name FROM information_schema.columns
                 WHERE table_schema = 'tenant' AND table_name = v_field_record.reference_table
                 AND column_name = 'name' LIMIT 1),
                (SELECT column_name FROM information_schema.columns
                 WHERE table_schema = 'tenant' AND table_name = v_field_record.reference_table
                 AND column_name = 'label' LIMIT 1),
                (SELECT column_name FROM information_schema.columns
                 WHERE table_schema = 'tenant' AND table_name = v_field_record.reference_table
                 AND column_name = 'title' LIMIT 1),
                'id'
            ) INTO v_display_field;
        END IF;

        -- Build JOIN clause with column name mapping
        -- Handle the case where field name doesn't match actual column name (e.g., "channelPartner" vs "channelPartner__a")
        v_join_clauses := v_join_clauses ||
            ' LEFT JOIN tenant.' || quote_ident(v_field_record.reference_table) || ' ' || v_join_alias ||
            ' ON ' || v_join_alias || '.id = t.' || quote_ident(v_field_record.name || '__a') ||
            CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='tenant'
              AND table_name=v_field_record.reference_table AND column_name='tenant_id')
            THEN ' AND ' || v_join_alias || '.tenant_id = ' || quote_literal(v_caller_tenant::text) ELSE '' END;

        -- Build reference field resolution in JSONB with column name mapping
        v_reference_fields := v_reference_fields ||
            CASE
                WHEN v_reference_fields != '' THEN ' || '
                ELSE ''
            END ||
            'jsonb_build_object(' || quote_literal(v_field_record.name) || ', COALESCE(' || v_join_alias || '.' || quote_ident(v_display_field) || '::text, t.' || quote_ident(v_field_record.name || '__a') || '::text, ''''))';

        v_join_counter := v_join_counter + 1;
    END LOOP;

    -- App-scoping filter (284) — only when the table has the column AND a
    -- value was actually passed in.
    IF v_has_cert_body_col AND p_certification_body IS NOT NULL AND trim(p_certification_body) != '' THEN
        v_where_clause := v_where_clause || ' AND t.certification_body__a = ' || quote_literal(p_certification_body);
    END IF;

    -- caller-identity scoping (288) — only for External_Client__a,
    -- renewal_clients__a, recertification_clients__a, and only when the
    -- caller's own custom role is External Client. Admin and every other
    -- role are untouched. Record matches if EITHER identifier passes.
    IF v_is_external_client
       AND v_table_name IN ('external_clients__a', 'renewal_clients__a', 'recertification_clients__a')
       AND v_has_client_user_id_col
    THEN
        v_where_clause := v_where_clause || ' AND (t.client_user_id__a = ' || quote_literal(coalesce(v_caller_id::text, '')) ||
            CASE
                WHEN v_has_email_col AND v_caller_email IS NOT NULL THEN
                    ' OR lower(t.email__a) = lower(' || quote_literal(v_caller_email) || ')'
                ELSE ''
            END || ')';
    END IF;

    IF v_where_clause != '' THEN
        v_where_clause := ' WHERE ' || substring(v_where_clause from 6); -- strip leading ' AND '
    END IF;

    -- Build the final SQL with reference resolution
    v_select_sql := '
        SELECT
            t.id as record_id,
            jsonb_build_object(
                ''id'', t.id,
                ''created_at'', COALESCE(t.created_at::text, ''''),
                ''updated_at'', COALESCE(t.updated_at::text, '''')
            )' ||
            CASE
                WHEN v_jsonb_fields != '' THEN ' || ' || v_jsonb_fields
                ELSE ''
            END ||
            CASE
                WHEN v_reference_fields != '' THEN ' || ' || v_reference_fields
                ELSE ''
            END || '
        as record_data
        FROM tenant.' || quote_ident(v_table_name) || ' t' ||
        v_join_clauses ||
        v_where_clause || '
        ORDER BY t.created_at DESC
        LIMIT ' || least(greatest(coalesce(p_limit,100),1),1000) || '
        OFFSET ' || greatest(coalesce(p_offset,0),0);

    RETURN QUERY EXECUTE v_select_sql;
END;
$$;


CREATE OR REPLACE FUNCTION tenant.get_object_records(
  p_object_id  UUID,
  p_limit      INTEGER DEFAULT 100,
  p_offset     INTEGER DEFAULT 0
)
RETURNS TABLE(record_id UUID, record_data JSONB)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_table_name     TEXT;
  v_jsonb_fields   TEXT := '';
  v_where_clause   TEXT := '';
  v_select_sql     TEXT;
  v_column_record  RECORD;
  v_tenant_id      UUID;
  v_read_mode      TEXT;
  v_caller_id      UUID;
  v_custom_role_id UUID;
  v_system_role TEXT;
  v_custom_role TEXT;
  v_email TEXT;
  v_caller_tenant UUID;
BEGIN
  v_caller_id := auth.uid();
  SELECT su.tenant_id, su.role, r.name, su.email INTO v_caller_tenant,v_system_role,v_custom_role,v_email
  FROM system.users su LEFT JOIN tenant.roles r ON r.id=su.custom_role_id WHERE su.id=v_caller_id;
  IF v_caller_tenant IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT o.name, o.tenant_id INTO v_table_name, v_tenant_id
    FROM tenant.objects o WHERE o.id = p_object_id AND o.tenant_id=v_caller_tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Object not found';
  END IF;

  SELECT s.effective_read_mode INTO v_read_mode
    FROM public._resolve_sharing_mode(p_object_id, v_tenant_id) s;

  IF v_read_mode = 'owner' THEN
    -- Filter on record_owner__a
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'tenant' AND table_name = v_table_name
         AND column_name = 'record_owner__a'
    ) THEN
      v_where_clause := ' AND t.record_owner__a = ' || quote_literal(v_caller_id::text);
    ELSE
      -- Fallback to created_by if record_owner__a column doesn't exist yet
      v_where_clause := ' AND t.created_by = ' || quote_literal(v_caller_id::text);
    END IF;

  ELSIF v_read_mode = 'role_peers' THEN
    SELECT su.custom_role_id INTO v_custom_role_id
      FROM system.users su WHERE su.id = v_caller_id;

    IF v_custom_role_id IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'tenant' AND table_name = v_table_name
           AND column_name = 'record_owner__a'
      ) THEN
        v_where_clause := ' AND t.record_owner__a IN (
          SELECT su2.id::text FROM system.users su2
          WHERE su2.custom_role_id = ' || quote_literal(v_custom_role_id::text) || '
        )';
      ELSE
        v_where_clause := ' AND t.created_by IN (
          SELECT su2.id::text FROM system.users su2
          WHERE su2.custom_role_id = ' || quote_literal(v_custom_role_id::text) || '
        )';
      END IF;
    ELSE
      -- No custom role → owner fallback
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'tenant' AND table_name = v_table_name
           AND column_name = 'record_owner__a'
      ) THEN
        v_where_clause := ' AND t.record_owner__a = ' || quote_literal(v_caller_id::text);
      ELSE
        v_where_clause := ' AND t.created_by = ' || quote_literal(v_caller_id::text);
      END IF;
    END IF;
  END IF;
  -- mode = 'all' → no extra WHERE

  IF v_system_role IS DISTINCT FROM 'admin' AND v_table_name IN ('external_clients__a','renewal_clients__a','recertification_clients__a') THEN
    IF lower(coalesce(v_custom_role,'')) LIKE '%external%client%' OR lower(coalesce(v_custom_role,'')) LIKE '%external%customer%' THEN
      v_where_clause := v_where_clause || format(' AND (t.client_user_id__a=%L OR lower(t.email__a)=lower(%L))',v_caller_id,v_email);
    ELSIF v_table_name IN ('renewal_clients__a','recertification_clients__a')
      AND lower(coalesce(v_custom_role,'')) NOT LIKE '%crm%' AND lower(coalesce(v_custom_role,'')) NOT LIKE '%cdc%'
      AND (lower(coalesce(v_custom_role,'')) LIKE '%auditor%' OR lower(coalesce(v_custom_role,'')) LIKE '%tech%') THEN
      v_where_clause := v_where_clause || format(' AND ((%L AND t.auditor_id__a=%L) OR (%L AND t.tech_reviewer_id__a=%L))',
        lower(coalesce(v_custom_role,'')) LIKE '%auditor%',v_caller_id,
        lower(coalesce(v_custom_role,'')) LIKE '%tech%',v_caller_id);
    END IF;
  END IF;

  -- Build dynamic JSONB columns (same as migration 082)
  FOR v_column_record IN
    SELECT column_name, data_type
      FROM information_schema.columns
     WHERE table_schema = 'tenant'
       AND table_name   = v_table_name
       AND column_name NOT IN ('id', 'created_at', 'updated_at', 'autonumber')
     ORDER BY ordinal_position
  LOOP
    IF v_column_record.data_type = 'bigint' THEN
      v_jsonb_fields := v_jsonb_fields ||
        CASE WHEN v_jsonb_fields != '' THEN ' || ' ELSE '' END ||
        'jsonb_build_object(' || quote_literal(v_column_record.column_name) ||
        ', COALESCE(NULLIF(t.' || quote_ident(v_column_record.column_name) || '::text, ''''), NULL))';
    ELSE
      v_jsonb_fields := v_jsonb_fields ||
        CASE WHEN v_jsonb_fields != '' THEN ' || ' ELSE '' END ||
        'jsonb_build_object(' || quote_literal(v_column_record.column_name) ||
        ', COALESCE(t.' || quote_ident(v_column_record.column_name) || '::text, ''''))';
    END IF;
  END LOOP;

  v_select_sql := '
    SELECT
      t.id as record_id,
      jsonb_build_object(
        ''id'',         t.id,
        ''created_at'', COALESCE(t.created_at::text, ''''),
        ''updated_at'', COALESCE(t.updated_at::text, '''')
      )' ||
      CASE WHEN v_jsonb_fields != '' THEN ' || ' || v_jsonb_fields ELSE '' END || '
      as record_data
    FROM tenant.' || quote_ident(v_table_name) || ' t
    WHERE t.tenant_id = ' || quote_literal(v_tenant_id::text) ||
    v_where_clause || '
    ORDER BY t.created_at DESC
    LIMIT '  || least(greatest(coalesce(p_limit,100),1),1000)  || '
    OFFSET ' || greatest(coalesce(p_offset,0),0);

  RETURN QUERY EXECUTE v_select_sql;
END;
$$;

REVOKE EXECUTE ON FUNCTION tenant.get_object_records(UUID,INTEGER,INTEGER) FROM PUBLIC,authenticated;
REVOKE EXECUTE ON FUNCTION tenant.get_object_records_with_references(UUID,INTEGER,INTEGER,TEXT) FROM PUBLIC,authenticated;
CREATE OR REPLACE FUNCTION public.can_write_workflow_attachment(p_attachment_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  _tenant UUID;
  _role TEXT;
  _custom TEXT;
  _email TEXT;
  _a RECORD;
  _record JSONB;
  _field TEXT;
BEGIN
  SELECT su.tenant_id,su.role,r.name,su.email INTO _tenant,_role,_custom,_email
  FROM system.users su LEFT JOIN tenant.roles r ON r.id=su.custom_role_id WHERE su.id=auth.uid();
  SELECT a.record_id,a.object_id,o.name AS object_name,f.name AS field_name,f.id AS field_id INTO _a
  FROM tenant.attachments a JOIN tenant.objects o ON o.id=a.object_id JOIN tenant.fields f ON f.id=a.field_id
  WHERE a.id=p_attachment_id AND a.tenant_id=_tenant AND a.deleted_at IS NULL;
  IF NOT FOUND THEN RETURN false; END IF;
  IF _a.object_name='renewal_clients__a' AND
     regexp_replace(_a.field_name,'__a$','') IN (
       'surv_suspension_intimation','surv_suspension_decision','surv_suspension_letter',
       'surv_withdrawal_intimation','surv_withdrawal_decision','surv_withdrawal_letter'
     ) THEN RETURN false; END IF;
  IF _role='admin' THEN RETURN true; END IF;
  IF NOT public._check_permission('object',_a.object_id,'edit') OR NOT public._check_permission('field',_a.field_id,'edit') THEN RETURN false; END IF;
  EXECUTE format('SELECT to_jsonb(t) FROM tenant.%I t WHERE id=$1 AND tenant_id=$2',_a.object_name)
    INTO _record USING _a.record_id,_tenant;
  IF _record IS NULL THEN RETURN false; END IF;
  IF _a.object_name NOT IN ('renewal_clients__a','recertification_clients__a') THEN RETURN true; END IF;
  _field := regexp_replace(_a.field_name,'__a$','');
  IF _field IN ('surv_ncr_rca','recert_application_form','recert_ncr_rca','recert_evidences') THEN
    RETURN coalesce(_record->>'client_user_id__a'=auth.uid()::text OR
      (nullif(_record->>'email__a','') IS NOT NULL AND lower(_record->>'email__a')=lower(_email)),false);
  ELSIF _field IN ('surv_audit_plan','surv_ncr','surveillance_audit_report','recert_audit_plan','recert_ncr','recert_audit_report') THEN
    RETURN lower(coalesce(_custom,'')) LIKE '%crm%' OR coalesce(lower(_custom) LIKE '%auditor%' AND _record->>'auditor_id__a'=auth.uid()::text,false);
  ELSIF _field IN ('surv_tech_findings_file','recert_tech_findings_file') THEN
    RETURN coalesce(lower(_custom) LIKE '%tech%' AND _record->>'tech_reviewer_id__a'=auth.uid()::text,false);
  ELSIF _field IN ('cdc_report','recert_cdc_report','surv_suspension_decision','surv_withdrawal_decision') THEN
    RETURN lower(coalesce(_custom,'')) LIKE '%cdc%';
  ELSIF _field IN ('surveillance_intimation_letter','surveillance_certificates','recert_intimation_letter','recert_quotation','recert_agreement','recert_certificates',
    'surv_suspension_intimation','surv_suspension_letter','surv_withdrawal_intimation','surv_withdrawal_letter') THEN
    RETURN lower(coalesce(_custom,'')) LIKE '%crm%';
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.can_write_workflow_attachment(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_write_workflow_attachment(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.finalize_file_upload(
  p_attachment_id   UUID,
  p_final_byte_size BIGINT DEFAULT NULL,
  p_final_mime_type TEXT   DEFAULT NULL
)
RETURNS TABLE(
  success       BOOLEAN,
  message       TEXT,
  file_metadata JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant, public
AS $$
DECLARE
  _auth_user_id UUID;
  _tenant_id    UUID;
  _attachment   tenant.attachments;
  _object_name  TEXT;
  _field_name   TEXT;
  _column_name  TEXT;
  _file_metadata JSONB;
  _sql          TEXT;
  _caller_role  TEXT;
  _custom_role  TEXT;
  _is_crm       BOOLEAN := false;
  _is_crm_or_auditor BOOLEAN := false;
  _is_crm_or_tech    BOOLEAN := false;
  _is_tech           BOOLEAN := false;
  _is_cdc            BOOLEAN := false;
  _client_user_id UUID;
  _record_email TEXT;
  _caller_email TEXT;
BEGIN
  _auth_user_id := auth.uid();
  IF _auth_user_id IS NULL THEN
    RETURN QUERY SELECT false, 'User not authenticated', NULL::JSONB;
    RETURN;
  END IF;

  SELECT tenant_id INTO _tenant_id FROM system.users WHERE id = _auth_user_id;
  IF _tenant_id IS NULL THEN
    RETURN QUERY SELECT false, 'User not found in system.users', NULL::JSONB;
    RETURN;
  END IF;

  SELECT * INTO _attachment
  FROM tenant.attachments
  WHERE id = p_attachment_id AND tenant_id = _tenant_id AND uploaded_by = _auth_user_id AND deleted_at IS NULL;

  IF _attachment.id IS NULL THEN
    RETURN QUERY SELECT false, 'Attachment not found or access denied', NULL::JSONB;
    RETURN;
  END IF;

  IF NOT public.can_write_workflow_attachment(p_attachment_id) THEN
    RETURN QUERY SELECT false, 'Access denied: upload permissions changed', NULL::jsonb;
    RETURN;
  END IF;

  UPDATE tenant.attachments
  SET
    byte_size  = COALESCE(p_final_byte_size, byte_size),
    mime_type  = COALESCE(p_final_mime_type, mime_type),
    updated_at = now()
  WHERE id = p_attachment_id;

  SELECT o.name, f.name INTO _object_name, _field_name
  FROM tenant.objects o
  JOIN tenant.fields f ON f.object_id = o.id
  WHERE o.id = _attachment.object_id AND f.id = _attachment.field_id;

  IF _field_name NOT IN ('name','email','phone','created_at','updated_at','created_by','updated_by') THEN
    _column_name := _field_name || '__a';
  ELSE
    _column_name := _field_name;
  END IF;

  _file_metadata := jsonb_build_object(
    'id',          _attachment.id,
    'bucket',      _attachment.storage_bucket,
    'path',        _attachment.storage_path,
    'name',        _attachment.filename,
    'size',        COALESCE(p_final_byte_size, _attachment.byte_size),
    'mime',        COALESCE(p_final_mime_type, _attachment.mime_type),
    'version',     _attachment.version,
    'uploaded_at', _attachment.created_at,
    'uploaded_by', _attachment.uploaded_by
  );

  _sql := format('
    UPDATE tenant.%I
    SET %I = CASE
      WHEN (SELECT type FROM tenant.fields WHERE id = %L) = ''file''  THEN %L::jsonb
      WHEN (SELECT type FROM tenant.fields WHERE id = %L) = ''files'' THEN
        COALESCE(%I, ''[]''::jsonb) || %L::jsonb
      ELSE %I
    END
    WHERE id = %L
  ',
    _object_name, _column_name, _attachment.field_id, _file_metadata,
    _attachment.field_id, _column_name, _file_metadata, _column_name, _attachment.record_id
  );
  EXECUTE _sql;

  -- ── Resolve caller role once for status logic ────────────────
  SELECT su.role, su.email INTO _caller_role, _caller_email FROM system.users su WHERE su.id = _auth_user_id;
  SELECT r.name INTO _custom_role
  FROM system.users su
  JOIN tenant.roles r ON r.id = su.custom_role_id
  WHERE su.id = _auth_user_id;

  _is_crm := (_caller_role = 'admin') OR (lower(coalesce(_custom_role,'')) LIKE '%crm%');
  _is_crm_or_auditor := _is_crm OR (lower(coalesce(_custom_role,'')) LIKE '%auditor%');
  _is_crm_or_tech    := _is_crm OR (lower(coalesce(_custom_role,'')) LIKE '%tech%');
  _is_tech           := (_caller_role = 'admin') OR (lower(coalesce(_custom_role,'')) LIKE '%tech%');
  _is_cdc            := (_caller_role = 'admin') OR (lower(coalesce(_custom_role,'')) LIKE '%cdc%');

  -- ── external_clients__a: quotation upload ────────────────────
  IF _object_name = 'external_clients__a' AND _field_name = 'quotation' AND _is_crm THEN
    UPDATE tenant.external_clients__a
    SET status__a = 'Quotation_Received',
        "Quotation_Received_Date__a" = CURRENT_DATE,
        updated_at = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
  END IF;

  -- ── renewal_clients__a: intimation letter upload ─────────────
  IF _object_name = 'renewal_clients__a' AND _field_name = 'surveillance_intimation_letter' AND _is_crm THEN
    UPDATE tenant.renewal_clients__a
    SET status__a = 'Intimation_Sent',
        intimation_sent_date__a = CURRENT_DATE,
        updated_at = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
  END IF;

  -- ── renewal_clients__a: legacy audit plan upload (migration 221) ─────
  IF _object_name = 'renewal_clients__a' AND _field_name = 'surveillance_audit_plan' AND _is_crm THEN
    UPDATE tenant.renewal_clients__a
    SET status__a = 'Audit_Plan_Sent',
        audit_plan_sent_date__a = CURRENT_DATE,
        updated_at = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
  END IF;

  IF _object_name = 'renewal_clients__a' AND _field_name = 'surv_audit_plan' AND _is_crm_or_auditor THEN
    UPDATE tenant.renewal_clients__a
    SET status__a                     = 'Surv_Plan_Sent',
        "surv_plan_sent_date__a"      = CURRENT_DATE,
        "surv_plan_client_remarks__a" = NULL,
        updated_at                    = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id
      AND status__a IN ('Team_Assigned', 'Surv_Plan_Sent');
  END IF;

  IF _object_name = 'renewal_clients__a' AND _field_name = 'surv_ncr' AND _is_crm_or_auditor THEN
    UPDATE tenant.renewal_clients__a
    SET status__a                = 'Surv_NCR_Sent',
        "surv_ncr_sent_date__a"  = CURRENT_DATE,
        updated_at               = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id
      AND status__a IN ('Surv_Plan_Accepted', 'Surv_NCR_Sent');
  END IF;

  IF _object_name = 'renewal_clients__a' AND _field_name = 'surv_ncr_rca' THEN
    SELECT rc.client_user_id__a, rc.email__a INTO _client_user_id, _record_email
    FROM tenant.renewal_clients__a rc
    WHERE rc.id = _attachment.record_id AND rc.tenant_id = _tenant_id;

    IF _caller_role = 'admin' OR _client_user_id = _auth_user_id OR (_record_email IS NOT NULL AND lower(_record_email) = lower(_caller_email)) THEN
      UPDATE tenant.renewal_clients__a
      SET status__a                       = 'Surv_NCR_RCA_Uploaded',
          "surv_ncr_rca_uploaded_date__a" = CURRENT_DATE,
          updated_at                      = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id
        AND status__a IN ('Surv_NCR_Sent', 'Surv_NCR_RCA_Uploaded');
    END IF;
  END IF;

  IF _object_name = 'renewal_clients__a' AND _field_name = 'surveillance_audit_report' AND _is_crm_or_auditor THEN
    UPDATE tenant.renewal_clients__a
    SET status__a                 = 'Surv_Report_Sent',
        "surv_report_sent_date__a" = CURRENT_DATE,
        updated_at                = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id
      AND status__a IN ('Surv_Auditor_Accepted', 'Surv_Report_Sent');
  END IF;

  IF _object_name = 'renewal_clients__a' AND _field_name = 'cdc_report' AND _is_cdc THEN
    UPDATE tenant.renewal_clients__a
    SET status__a    = 'CDC_Approved',
        "cdc_date__a" = CURRENT_DATE,
        updated_at   = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id
      AND status__a IN ('Surv_Closed', 'CDC_Approved');
  END IF;

  IF _object_name = 'renewal_clients__a' AND _field_name = 'surveillance_certificates' AND _is_crm THEN
    UPDATE tenant.renewal_clients__a
    SET status__a                 = 'Certificate_Issued',
        certificates_sent_date__a = CURRENT_DATE,
        updated_at                = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
  END IF;

  -- ════════════════════════════════════════════════════════════
  -- NEW (277/279) — renewal_clients__a Sprint 8: Suspension & Withdrawal.
  -- "Upload IS the action" for all six — mirrors the cdc_report /
  -- surveillance_certificates blocks directly above. Each of the first
  -- five carries a re-upload guard (only advances while still at the
  -- checkpoint where it's meaningful, built in from day one — Sprint 1-3's
  -- equivalents needed a follow-up migration, 262, for this same fix).
  -- surv_withdrawal_letter is the new terminal checkpoint, unguarded, same
  -- reasoning as surveillance_certificates above.
  -- ════════════════════════════════════════════════════════════

  IF _object_name = 'renewal_clients__a' AND _field_name = 'surv_suspension_intimation' AND _is_crm THEN
    UPDATE tenant.renewal_clients__a
    SET status__a                            = 'Suspension_Intimation_Sent',
        "surv_suspension_intimation_date__a" = CURRENT_DATE,
        updated_at                           = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id
      AND status__a IN ('Certificate_Issued', 'Suspension_Intimation_Sent');
  END IF;

  IF _object_name = 'renewal_clients__a' AND _field_name = 'surv_suspension_decision' AND _is_cdc THEN
    UPDATE tenant.renewal_clients__a
    SET status__a                          = 'Suspension_Decision_Uploaded',
        "surv_suspension_decision_date__a" = CURRENT_DATE,
        updated_at                         = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id
      AND status__a IN ('Suspension_Intimation_Sent', 'Suspension_Decision_Uploaded');
  END IF;

  IF _object_name = 'renewal_clients__a' AND _field_name = 'surv_suspension_letter' AND _is_crm THEN
    UPDATE tenant.renewal_clients__a
    SET status__a                        = 'Suspension_Letter_Sent',
        "surv_suspension_letter_date__a" = CURRENT_DATE,
        updated_at                       = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id
      AND status__a IN ('Suspension_Decision_Uploaded', 'Suspension_Letter_Sent');
  END IF;

  IF _object_name = 'renewal_clients__a' AND _field_name = 'surv_withdrawal_intimation' AND _is_crm THEN
    UPDATE tenant.renewal_clients__a
    SET status__a                            = 'Withdrawal_Intimation_Sent',
        "surv_withdrawal_intimation_date__a" = CURRENT_DATE,
        updated_at                           = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id
      AND status__a IN ('Suspension_Letter_Sent', 'Withdrawal_Intimation_Sent');
  END IF;

  IF _object_name = 'renewal_clients__a' AND _field_name = 'surv_withdrawal_decision' AND _is_cdc THEN
    UPDATE tenant.renewal_clients__a
    SET status__a                          = 'Withdrawal_Decision_Uploaded',
        "surv_withdrawal_decision_date__a" = CURRENT_DATE,
        updated_at                         = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id
      AND status__a IN ('Withdrawal_Intimation_Sent', 'Withdrawal_Decision_Uploaded');
  END IF;

  IF _object_name = 'renewal_clients__a' AND _field_name = 'surv_withdrawal_letter' AND _is_crm THEN
    UPDATE tenant.renewal_clients__a
    SET status__a                        = 'Withdrawal_Letter_Sent',
        "surv_withdrawal_letter_date__a" = CURRENT_DATE,
        updated_at                       = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
  END IF;

  -- ── external_clients__a: Stage 1 audit uploads ───────────────
  IF _object_name = 'external_clients__a' THEN
    IF _field_name = 'stage_one_audit_plan' AND _is_crm_or_auditor THEN
      UPDATE tenant.external_clients__a
      SET status__a = 'Stage_one_plan_Sent',
          "Stage_one_plan_Sent_Date__a" = CURRENT_DATE,
          "stage1_plan_client_remarks__a" = NULL,
          updated_at = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id;

    ELSIF _field_name IN ('stage1_report', 'stage1_ncr') AND _is_crm_or_auditor THEN
      UPDATE tenant.external_clients__a
      SET status__a = 'Stage1_Report_Sent',
          updated_at = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id
        AND status__a IN ('Stage1_Plan_Accepted', 'Stage1_Report_Sent');

      UPDATE tenant.external_clients__a
      SET status__a = 'Stage1_Auditor_Accepted',
          "stage1_tech_findings_notes__a" = NULL,
          updated_at = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id
        AND status__a = 'Stage1_Tech_Findings_Rejected';

    ELSIF _field_name = 'stage1_ncr_rca' THEN
      SELECT ec.client_user_id__a INTO _client_user_id
      FROM tenant.external_clients__a ec
      WHERE ec.id = _attachment.record_id AND ec.tenant_id = _tenant_id;

      IF _caller_role = 'admin' OR _client_user_id = _auth_user_id THEN
        UPDATE tenant.external_clients__a
        SET status__a = 'Stage1_NCR_RCA_Uploaded',
            updated_at = NOW()
        WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
      END IF;
    END IF;
  END IF;

  -- ── external_clients__a: Stage 2 audit uploads ───────────────
  IF _object_name = 'external_clients__a' THEN
    IF _field_name = 'Stage_two_audit_plan' AND _is_crm_or_auditor THEN
      UPDATE tenant.external_clients__a
      SET status__a = 'Stage2_Plan_Sent',
          "stage2_plan_sent_date__a" = CURRENT_DATE,
          "stage2_plan_client_remarks__a" = NULL,
          updated_at = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id;

    ELSIF _field_name IN ('stage2_report', 'stage2_ncr') AND _is_crm_or_auditor THEN
      UPDATE tenant.external_clients__a
      SET status__a = 'Stage2_Report_Sent',
          updated_at = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id
        AND status__a IN ('Stage2_Plan_Accepted', 'Stage2_Report_Sent');

      UPDATE tenant.external_clients__a
      SET status__a = 'Stage2_Evidences_Accepted',
          "stage2_tech_findings_notes__a" = NULL,
          updated_at = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id
        AND status__a = 'Stage2_Tech_Findings_Rejected';

    ELSIF _field_name = 'stage2_ncr_rca' THEN
      SELECT ec.client_user_id__a INTO _client_user_id
      FROM tenant.external_clients__a ec
      WHERE ec.id = _attachment.record_id AND ec.tenant_id = _tenant_id;

      IF _caller_role = 'admin' OR _client_user_id = _auth_user_id THEN
        UPDATE tenant.external_clients__a
        SET status__a = 'Stage2_NCR_RCA_Uploaded',
            updated_at = NOW()
        WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
      END IF;

    ELSIF _field_name = 'stage2_evidences' THEN
      SELECT ec.client_user_id__a INTO _client_user_id
      FROM tenant.external_clients__a ec
      WHERE ec.id = _attachment.record_id AND ec.tenant_id = _tenant_id;

      IF _caller_role = 'admin' OR _client_user_id = _auth_user_id THEN
        UPDATE tenant.external_clients__a
        SET status__a = 'Stage2_Evidences_Uploaded',
            updated_at = NOW()
        WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
      END IF;

    ELSIF _field_name = 'cdc_report' AND _is_cdc THEN
      UPDATE tenant.external_clients__a
      SET status__a = 'CDC_Approved',
          "cdc_date__a" = CURRENT_DATE,
          updated_at = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
    END IF;
  END IF;

  -- ── recertification_clients__a: intimation letter upload (264) ──
  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_intimation_letter' AND _is_crm THEN
    UPDATE tenant.recertification_clients__a
    SET status__a = 'Recert_Intimation_Sent',
        recert_intimation_sent_date__a = CURRENT_DATE,
        updated_at = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
  END IF;

  -- ── recertification_clients__a: Sprint 1 intake uploads (265) ──

  -- ── Application form: linked client only ──
  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_application_form' THEN
    SELECT rc.client_user_id__a, rc.email__a INTO _client_user_id, _record_email
    FROM tenant.recertification_clients__a rc
    WHERE rc.id = _attachment.record_id AND rc.tenant_id = _tenant_id;

    IF _caller_role = 'admin' OR _client_user_id = _auth_user_id OR (_record_email IS NOT NULL AND lower(_record_email) = lower(_caller_email)) THEN
      UPDATE tenant.recertification_clients__a
      SET status__a                          = 'Recert_Application_Sent',
          "recert_application_sent_date__a"  = CURRENT_DATE,
          updated_at                         = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
    END IF;
  END IF;

  -- ── Quotation: CRM only ──
  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_quotation' AND _is_crm THEN
    UPDATE tenant.recertification_clients__a
    SET status__a                           = 'Recert_Quotation_Received',
        "recert_quotation_received_date__a" = CURRENT_DATE,
        updated_at                          = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
  END IF;

  -- ── Agreement: CRM only ──
  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_agreement' AND _is_crm THEN
    UPDATE tenant.recertification_clients__a
    SET status__a                       = 'Recert_Agreement_Sent',
        "recert_agreement_sent_date__a" = CURRENT_DATE,
        updated_at                      = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
  END IF;

  -- ════════════════════════════════════════════════════════════
  -- NEW (266) — recertification_clients__a Sprint 2 audit plan upload
  -- ════════════════════════════════════════════════════════════
  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_audit_plan' AND _is_crm_or_auditor THEN
    UPDATE tenant.recertification_clients__a
    SET status__a                        = 'Recert_Plan_Sent',
        "recert_plan_sent_date__a"      = CURRENT_DATE,
        "recert_plan_client_remarks__a" = NULL,
        updated_at                      = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id
      AND status__a IN ('Recert_Team_Assigned', 'Recert_Plan_Sent');
  END IF;

  -- ════════════════════════════════════════════════════════════
  -- NEW (267) — recertification_clients__a Sprint 3 NCR/RCA/evidences
  -- ════════════════════════════════════════════════════════════

  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_ncr' AND _is_crm_or_auditor THEN
    UPDATE tenant.recertification_clients__a
    SET status__a                  = 'Recert_NCR_Sent',
        "recert_ncr_sent_date__a" = CURRENT_DATE,
        updated_at                = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id
      AND status__a IN ('Recert_Plan_Accepted', 'Recert_NCR_Sent');
  END IF;

  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_ncr_rca' THEN
    SELECT rc.client_user_id__a, rc.email__a INTO _client_user_id, _record_email
    FROM tenant.recertification_clients__a rc
    WHERE rc.id = _attachment.record_id AND rc.tenant_id = _tenant_id;

    IF _caller_role = 'admin' OR _client_user_id = _auth_user_id OR (_record_email IS NOT NULL AND lower(_record_email) = lower(_caller_email)) THEN
      UPDATE tenant.recertification_clients__a
      SET status__a                          = 'Recert_NCR_RCA_Uploaded',
          "recert_ncr_rca_uploaded_date__a" = CURRENT_DATE,
          updated_at                        = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id
        AND status__a IN ('Recert_NCR_Sent', 'Recert_NCR_RCA_Uploaded');
    END IF;
  END IF;

  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_evidences' THEN
    SELECT rc.client_user_id__a, rc.email__a INTO _client_user_id, _record_email
    FROM tenant.recertification_clients__a rc
    WHERE rc.id = _attachment.record_id AND rc.tenant_id = _tenant_id;

    IF _caller_role = 'admin' OR _client_user_id = _auth_user_id OR (_record_email IS NOT NULL AND lower(_record_email) = lower(_caller_email)) THEN
      UPDATE tenant.recertification_clients__a
      SET status__a                           = 'Recert_Evidences_Uploaded',
          "recert_evidences_uploaded_date__a" = CURRENT_DATE,
          updated_at                          = NOW()
      WHERE id = _attachment.record_id AND tenant_id = _tenant_id
        AND status__a IN ('Recert_Auditor_Accepted', 'Recert_Evidences_Uploaded');
    END IF;
  END IF;

  -- ════════════════════════════════════════════════════════════
  -- NEW (268) — recertification_clients__a Sprint 4 uploads
  -- ════════════════════════════════════════════════════════════

  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_audit_report' AND _is_crm_or_auditor THEN
    UPDATE tenant.recertification_clients__a
    SET status__a                     = 'Recert_Report_Sent',
        "recert_report_sent_date__a" = CURRENT_DATE,
        updated_at                   = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id
      AND status__a IN ('Recert_Evidences_Accepted', 'Recert_Report_Sent');
  END IF;

  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_cdc_report' AND _is_cdc THEN
    UPDATE tenant.recertification_clients__a
    SET status__a           = 'Recert_CDC_Approved',
        "recert_cdc_date__a" = CURRENT_DATE,
        updated_at          = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id
      AND status__a IN ('Recert_Closed', 'Recert_CDC_Approved');
  END IF;

  IF _object_name = 'recertification_clients__a' AND _field_name = 'recert_certificates' AND _is_crm THEN
    UPDATE tenant.recertification_clients__a
    SET status__a                          = 'Recert_Certificate_Issued',
        "recert_certificates_sent_date__a" = CURRENT_DATE,
        updated_at                         = NOW()
    WHERE id = _attachment.record_id AND tenant_id = _tenant_id;
  END IF;

  RETURN QUERY SELECT true, 'File upload finalized successfully', _file_metadata;
END;
$$;
COMMIT;
