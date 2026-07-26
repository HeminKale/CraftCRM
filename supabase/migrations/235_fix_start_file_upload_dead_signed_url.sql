-- ================================
-- Migration 235: Remove dead storage.sign_url() call from start_file_upload
--
-- start_file_upload has always called `storage.sign_url(...)` to return an
-- `upload_url` — but the frontend (FileUploadField.tsx:119-124) never reads
-- that value. It only uses `attachment_id`, `bucket`, and `storage_path`
-- from the RPC result, then uploads via the authenticated Supabase client
-- (`supabase.storage.from(bucket).upload(storage_path, file, {upsert:true})`),
-- exactly like the download-URL fallback pattern elsewhere in the app
-- (`FileUploadField.tsx:193-195`, `ClientSummaryTab.tsx:155`).
--
-- `storage.sign_url` is not a function this Supabase project actually has
-- (confirmed by the "function storage.sign_url(...) does not exist" error
-- hit during Sprint 0/1/2 testing) — this call has likely never succeeded.
-- Since its output is unused, this migration removes it rather than trying
-- to reintroduce a working signed-URL mechanism nobody needs.
--
-- Every other part of start_file_upload (including the Sprint 0 CRM-only
-- gate on external_clients__a.quotation from migration 232) is unchanged.
-- ================================

CREATE OR REPLACE FUNCTION public.start_file_upload(
  p_object_id UUID,
  p_record_id UUID,
  p_field_id UUID,
  p_filename TEXT,
  p_mime_type TEXT DEFAULT NULL,
  p_byte_size BIGINT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE(
  attachment_id UUID,
  bucket TEXT,
  storage_path TEXT,
  upload_url TEXT,
  success BOOLEAN,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant, public
AS $$
DECLARE
  _auth_user_id UUID;
  _tenant_id UUID;
  _object_name TEXT;
  _field_name TEXT;
  _attachment_id UUID;
  _canonical_path TEXT;
  _bucket TEXT := 'tenant-uploads';
  _caller_role TEXT;
  _custom_role TEXT;
BEGIN
  -- Get current user
  _auth_user_id := auth.uid();
  IF _auth_user_id IS NULL THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false, 'User not authenticated';
    RETURN;
  END IF;

  -- Get tenant_id from system.users
  SELECT tenant_id INTO _tenant_id
  FROM system.users
  WHERE id = _auth_user_id;

  IF _tenant_id IS NULL THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false, 'User not found in system.users';
    RETURN;
  END IF;

  -- Verify object and field belong to user's tenant
  SELECT o.name, f.name INTO _object_name, _field_name
  FROM tenant.objects o
  JOIN tenant.fields f ON f.object_id = o.id
  WHERE o.id = p_object_id
    AND f.id = p_field_id
    AND o.tenant_id = _tenant_id
    AND f.tenant_id = _tenant_id;

  IF _object_name IS NULL OR _field_name IS NULL THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false, 'Object or field not found or access denied';
    RETURN;
  END IF;

  -- ── Quotation upload lock: admin / CRM Office only (migration 232) ──
  IF _object_name = 'external_clients__a' AND _field_name = 'quotation' THEN
    SELECT su.role INTO _caller_role FROM system.users su WHERE su.id = _auth_user_id;
    SELECT r.name INTO _custom_role
    FROM system.users su
    JOIN tenant.roles r ON r.id = su.custom_role_id
    WHERE su.id = _auth_user_id;

    IF _caller_role != 'admin' AND (lower(coalesce(_custom_role, '')) NOT LIKE '%crm%') THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, false,
        'Access denied: CRM Office role required to upload quotation';
      RETURN;
    END IF;
  END IF;

  -- Generate canonical storage path
  _canonical_path := format('tenants/%s/%s/%s/%s/%s-%s',
    _tenant_id,
    _object_name,
    p_record_id,
    _field_name,
    gen_random_uuid(),
    lower(regexp_replace(p_filename, '[^a-zA-Z0-9.-]', '-', 'g'))
  );

  -- Create attachment record
  INSERT INTO tenant.attachments (
    tenant_id, object_id, record_id, field_id,
    storage_bucket, storage_path, filename, mime_type,
    byte_size, uploaded_by, metadata
  )
  VALUES (
    _tenant_id, p_object_id, p_record_id, p_field_id,
    _bucket, _canonical_path, p_filename, p_mime_type,
    p_byte_size, _auth_user_id, p_metadata
  )
  RETURNING id INTO _attachment_id;

  -- upload_url is intentionally NULL — the frontend uploads via the
  -- authenticated Supabase Storage client using `bucket` + `storage_path`
  -- returned below, not a signed URL. See migration header for why.
  RETURN QUERY SELECT
    _attachment_id,
    _bucket,
    _canonical_path,
    NULL::TEXT,
    true,
    'Upload started successfully';
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_file_upload(UUID, UUID, UUID, TEXT, TEXT, BIGINT, JSONB) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.start_file_upload(UUID, UUID, UUID, TEXT, TEXT, BIGINT, JSONB) FROM public;
