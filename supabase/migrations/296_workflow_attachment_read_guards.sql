-- Apply after 295. Protect attachment lists, download RPCs and authenticated
-- Storage access with the same record/field/report rules as the record API.
BEGIN;

CREATE OR REPLACE FUNCTION public.can_read_workflow_attachment(p_attachment_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  _tenant UUID;
  _role TEXT;
  _custom TEXT;
  _custom_id UUID;
  _email TEXT;
  _a RECORD;
  _record JSONB;
  _visible JSONB;
  _mode TEXT;
  _owner TEXT;
  _name TEXT;
BEGIN
  SELECT su.tenant_id,su.role,r.name,su.custom_role_id,su.email INTO _tenant,_role,_custom,_custom_id,_email
  FROM system.users su LEFT JOIN tenant.roles r ON r.id=su.custom_role_id WHERE su.id=auth.uid();
  IF _tenant IS NULL THEN RETURN false; END IF;
  SELECT a.record_id,a.object_id,o.name AS object_name,f.name AS field_name,f.id AS field_id INTO _a
  FROM tenant.attachments a JOIN tenant.objects o ON o.id=a.object_id JOIN tenant.fields f ON f.id=a.field_id
  WHERE a.id=p_attachment_id AND a.tenant_id=_tenant AND a.deleted_at IS NULL;
  IF NOT FOUND OR NOT public._check_permission('object',_a.object_id,'read') OR NOT public._check_permission('field',_a.field_id,'read') THEN RETURN false; END IF;
  EXECUTE format('SELECT to_jsonb(t) FROM tenant.%I t WHERE id=$1 AND tenant_id=$2',_a.object_name)
    INTO _record USING _a.record_id,_tenant;
  IF _record IS NULL THEN RETURN false; END IF;
  IF _role IS DISTINCT FROM 'admin' THEN
    SELECT effective_read_mode INTO _mode FROM public._resolve_sharing_mode(_a.object_id,_tenant);
    _owner := coalesce(_record->>'record_owner__a',_record->>'created_by');
    IF (_mode='owner' OR (_mode='role_peers' AND _custom_id IS NULL)) AND _owner IS DISTINCT FROM auth.uid()::text THEN RETURN false; END IF;
    IF _mode='role_peers' AND _custom_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM system.users su WHERE su.id::text=_owner AND su.tenant_id=_tenant AND su.custom_role_id=_custom_id) THEN RETURN false; END IF;
    IF _a.object_name IN ('external_clients__a','renewal_clients__a','recertification_clients__a')
       AND (lower(coalesce(_custom,'')) LIKE '%external%client%' OR lower(coalesce(_custom,'')) LIKE '%external%customer%')
       AND _record->>'client_user_id__a' IS DISTINCT FROM auth.uid()::text
       AND lower(coalesce(_record->>'email__a','')) IS DISTINCT FROM lower(_email) THEN RETURN false; END IF;
    IF _a.object_name IN ('renewal_clients__a','recertification_clients__a')
       AND lower(coalesce(_custom,'')) NOT LIKE '%crm%' AND lower(coalesce(_custom,'')) NOT LIKE '%cdc%'
       AND (lower(coalesce(_custom,'')) LIKE '%auditor%' OR lower(coalesce(_custom,'')) LIKE '%tech%')
       AND NOT coalesce(lower(coalesce(_custom,'')) LIKE '%auditor%' AND _record->>'auditor_id__a'=auth.uid()::text,false)
       AND NOT coalesce(lower(coalesce(_custom,'')) LIKE '%tech%' AND _record->>'tech_reviewer_id__a'=auth.uid()::text,false) THEN RETURN false; END IF;
  END IF;
  _visible := public._workflow_record_for_reader(_a.object_name,_record,_role,_custom,_email,auth.uid());
  _name := regexp_replace(_a.field_name,'__a$','');
  RETURN _visible ? _name OR _visible ? (_name || '__a');
END;
$$;
REVOKE ALL ON FUNCTION public.can_read_workflow_attachment(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_workflow_attachment(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_read_workflow_storage_object(p_bucket TEXT,p_path TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE _attachment UUID;
BEGIN
  SELECT a.id INTO _attachment FROM tenant.attachments a
  WHERE a.storage_bucket=p_bucket AND a.storage_path=p_path ORDER BY a.created_at DESC LIMIT 1;
  -- Unattached uploads and summary sheets retain existing Storage policies.
  IF NOT FOUND THEN RETURN true; END IF;
  RETURN public.can_read_workflow_attachment(_attachment);
END;
$$;
REVOKE ALL ON FUNCTION public.can_read_workflow_storage_object(TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_workflow_storage_object(TEXT,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_write_workflow_storage_object(p_bucket TEXT,p_path TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE _attachment UUID;
BEGIN
  SELECT a.id INTO _attachment FROM tenant.attachments a
  WHERE a.storage_bucket=p_bucket AND a.storage_path=p_path ORDER BY a.created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN true; END IF;
  RETURN public.can_write_workflow_attachment(_attachment);
END;
$$;
REVOKE ALL ON FUNCTION public.can_write_workflow_storage_object(TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_write_workflow_storage_object(TEXT,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_record_attachments(p_record_id UUID,p_field_id UUID)
RETURNS TABLE(id UUID,filename TEXT,mime_type TEXT,byte_size BIGINT,storage_path TEXT,storage_bucket TEXT,uploaded_by UUID,created_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT a.id,a.filename::text,a.mime_type::text,a.byte_size,a.storage_path::text,a.storage_bucket::text,a.uploaded_by,a.created_at
  FROM tenant.attachments a WHERE a.record_id=p_record_id AND a.field_id=p_field_id
    AND a.deleted_at IS NULL AND public.can_read_workflow_attachment(a.id) ORDER BY a.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.get_record_attachments(UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_record_attachments(UUID,UUID) TO authenticated;

DO $$ BEGIN
  IF to_regprocedure('public._get_file_download_url_unchecked(uuid,integer)') IS NULL THEN
    ALTER FUNCTION public.get_file_download_url(UUID,INTEGER) RENAME TO _get_file_download_url_unchecked;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._get_file_download_url_unchecked(UUID,INTEGER) FROM PUBLIC,authenticated;
CREATE OR REPLACE FUNCTION public.get_file_download_url(p_attachment_id UUID,p_expiry_hours INTEGER DEFAULT 1)
RETURNS TABLE(success BOOLEAN,message TEXT,download_url TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT public.can_read_workflow_attachment(p_attachment_id) THEN
    RETURN QUERY SELECT false,'Access denied'::text,NULL::text; RETURN;
  END IF;
  BEGIN
    RETURN QUERY SELECT * FROM public._get_file_download_url_unchecked(p_attachment_id,p_expiry_hours);
  EXCEPTION WHEN undefined_function THEN
    -- Existing frontend falls back to the authenticated Storage SDK, which
    -- is protected by the restrictive policy below as well.
    RETURN QUERY SELECT false,'Use the authenticated Storage signed URL API'::text,NULL::text;
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.get_file_download_url(UUID,INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_file_download_url(UUID,INTEGER) TO authenticated;

DO $$ BEGIN
  IF to_regprocedure('public._delete_file_unchecked(uuid)') IS NULL THEN
    ALTER FUNCTION public.delete_file(UUID) RENAME TO _delete_file_unchecked;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._delete_file_unchecked(UUID) FROM PUBLIC,authenticated;
CREATE OR REPLACE FUNCTION public.delete_file(p_attachment_id UUID)
RETURNS TABLE(success BOOLEAN,message TEXT) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT public.can_write_workflow_attachment(p_attachment_id) THEN
    RETURN QUERY SELECT false,'Access denied'::text; RETURN;
  END IF;
  RETURN QUERY SELECT * FROM public._delete_file_unchecked(p_attachment_id);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_file(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_file(UUID) TO authenticated;

DO $$ BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    DROP POLICY IF EXISTS craft_workflow_read_guard ON storage.objects;
    CREATE POLICY craft_workflow_read_guard ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
      USING (bucket_id <> 'tenant-uploads' OR public.can_read_workflow_storage_object(bucket_id,name));
    DROP POLICY IF EXISTS craft_workflow_delete_guard ON storage.objects;
    CREATE POLICY craft_workflow_delete_guard ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
      USING (bucket_id <> 'tenant-uploads' OR public.can_write_workflow_storage_object(bucket_id,name));
    DROP POLICY IF EXISTS craft_workflow_update_guard ON storage.objects;
    CREATE POLICY craft_workflow_update_guard ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
      USING (bucket_id <> 'tenant-uploads' OR public.can_write_workflow_storage_object(bucket_id,name))
      WITH CHECK (bucket_id <> 'tenant-uploads' OR public.can_write_workflow_storage_object(bucket_id,name));
  END IF;
END $$;
COMMIT;
