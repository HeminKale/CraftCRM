-- Migration 016: File Upload RPC Functions
-- Craft App - Add file upload workflow functions
-- ================================

-- ===========================================
-- 1. CREATE FILE UPLOAD RPC FUNCTIONS
-- ===========================================

-- Function to start a file upload (creates attachment record, returns upload info)
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
  _signed_url TEXT;
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

  -- Generate signed upload URL (24 hour expiry)
  SELECT storage.sign_url(_bucket, _canonical_path, '1 day', 'PUT') INTO _signed_url;

  RETURN QUERY SELECT 
    _attachment_id,
    _bucket,
    _canonical_path,
    _signed_url,
    true,
    'Upload started successfully';
END;
$$;

-- Function to finalize a file upload (confirms upload, updates metadata)
CREATE OR REPLACE FUNCTION public.finalize_file_upload(
  p_attachment_id UUID,
  p_final_byte_size BIGINT DEFAULT NULL,
  p_final_mime_type TEXT DEFAULT NULL
)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT,
  file_metadata JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant, public
AS $$
DECLARE
  _auth_user_id UUID;
  _tenant_id UUID;
  _attachment tenant.attachments;
  _object_name TEXT;
  _field_name TEXT;
  _table_name TEXT;
  _column_name TEXT;
  _file_metadata JSONB;
  _sql TEXT;
BEGIN
  -- Get current user
  _auth_user_id := auth.uid();
  IF _auth_user_id IS NULL THEN
    RETURN QUERY SELECT false, 'User not authenticated', NULL::JSONB;
    RETURN;
  END IF;

  -- Get tenant_id from system.users
  SELECT tenant_id INTO _tenant_id 
  FROM system.users 
  WHERE id = _auth_user_id;
  
  IF _tenant_id IS NULL THEN
    RETURN QUERY SELECT false, 'User not found in system.users', NULL::JSONB;
    RETURN;
  END IF;

  -- Get attachment record
  SELECT * INTO _attachment
  FROM tenant.attachments
  WHERE id = p_attachment_id AND tenant_id = _tenant_id;

  IF _attachment.id IS NULL THEN
    RETURN QUERY SELECT false, 'Attachment not found or access denied', NULL::JSONB;
    RETURN;
  END IF;

  -- Update attachment with final metadata
  UPDATE tenant.attachments
  SET 
    byte_size = COALESCE(p_final_byte_size, byte_size),
    mime_type = COALESCE(p_final_mime_type, mime_type),
    updated_at = now()
  WHERE id = p_attachment_id;

  -- Get object and field info
  SELECT o.name, f.name INTO _object_name, _field_name
  FROM tenant.objects o
  JOIN tenant.fields f ON f.object_id = o.id
  WHERE o.id = _attachment.object_id AND f.id = _attachment.field_id;

  -- Generate field column name
  IF _field_name NOT IN ('name', 'email', 'phone', 'created_at', 'updated_at', 'created_by', 'updated_by') THEN
    _column_name := _field_name || '__a';
  ELSE
    _column_name := _field_name;
  END IF;

  -- Build file metadata JSON
  _file_metadata := jsonb_build_object(
    'id', _attachment.id,
    'bucket', _attachment.storage_bucket,
    'path', _attachment.storage_path,
    'name', _attachment.filename,
    'size', COALESCE(p_final_byte_size, _attachment.byte_size),
    'mime', COALESCE(p_final_mime_type, _attachment.mime_type),
    'version', _attachment.version,
    'uploaded_at', _attachment.created_at,
    'uploaded_by', _attachment.uploaded_by
  );

  -- Update the object's column with file metadata
  -- For 'file' type: overwrite with single file
  -- For 'files' type: append to array
  _sql := format('
    UPDATE tenant.%I 
    SET %I = CASE 
      WHEN (SELECT type FROM tenant.fields WHERE id = %L) = ''file'' THEN %L::jsonb
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

  RETURN QUERY SELECT true, 'File upload finalized successfully', _file_metadata;
END;
$$;

-- Function to delete a file (soft delete)
CREATE OR REPLACE FUNCTION public.delete_file(
  p_attachment_id UUID
)
RETURNS TABLE(
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
  _attachment tenant.attachments;
  _object_name TEXT;
  _field_name TEXT;
  _table_name TEXT;
  _column_name TEXT;
  _sql TEXT;
BEGIN
  -- Get current user
  _auth_user_id := auth.uid();
  IF _auth_user_id IS NULL THEN
    RETURN QUERY SELECT false, 'User not authenticated';
    RETURN;
  END IF;

  -- Get tenant_id from system.users
  SELECT tenant_id INTO _tenant_id 
  FROM system.users 
  WHERE id = _auth_user_id;
  
  IF _tenant_id IS NULL THEN
    RETURN QUERY SELECT false, 'User not found in system.users';
    RETURN;
  END IF;

  -- Get attachment record
  SELECT * INTO _attachment
  FROM tenant.attachments
  WHERE id = p_attachment_id AND tenant_id = _tenant_id;

  IF _attachment.id IS NULL THEN
    RETURN QUERY SELECT false, 'Attachment not found or access denied';
    RETURN;
  END IF;

  -- Soft delete the attachment
  UPDATE tenant.attachments
  SET deleted_at = now()
  WHERE id = p_attachment_id;

  -- Get object and field info
  SELECT o.name, f.name INTO _object_name, _field_name
  FROM tenant.objects o
  JOIN tenant.fields f ON f.object_id = o.id
  WHERE o.id = _attachment.object_id AND f.id = _attachment.field_id;

  -- Generate field column name
  IF _field_name NOT IN ('name', 'email', 'phone', 'created_at', 'updated_at', 'created_by', 'updated_by') THEN
    _column_name := _field_name || '__a';
  ELSE
    _column_name := _field_name;
  END IF;

  -- Remove file metadata from object column
  -- For 'file' type: set to null
  -- For 'files' type: remove from array
  _sql := format('
    UPDATE tenant.%I 
    SET %I = CASE 
      WHEN (SELECT type FROM tenant.fields WHERE id = %L) = ''file'' THEN NULL
      WHEN (SELECT type FROM tenant.fields WHERE id = %L) = ''files'' THEN 
        COALESCE(%I, ''[]''::jsonb) - %L
      ELSE %I
    END
    WHERE id = %L
  ', 
    _object_name, _column_name, _attachment.field_id,
    _attachment.field_id, _column_name, _attachment.id::text, _column_name, _attachment.record_id
  );

  EXECUTE _sql;

  RETURN QUERY SELECT true, 'File deleted successfully';
END;
$$;

-- Function to get signed download URL
CREATE OR REPLACE FUNCTION public.get_file_download_url(
  p_attachment_id UUID,
  p_expiry_hours INTEGER DEFAULT 1
)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT,
  download_url TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant, public
AS $$
DECLARE
  _auth_user_id UUID;
  _tenant_id UUID;
  _attachment tenant.attachments;
  _signed_url TEXT;
BEGIN
  -- Get current user
  _auth_user_id := auth.uid();
  IF _auth_user_id IS NULL THEN
    RETURN QUERY SELECT false, 'User not authenticated', NULL::TEXT;
    RETURN;
  END IF;

  -- Get tenant_id from system.users
  SELECT tenant_id INTO _tenant_id 
  FROM system.users 
  WHERE id = _auth_user_id;
  
  IF _tenant_id IS NULL THEN
    RETURN QUERY SELECT false, 'User not found in system.users', NULL::TEXT;
    RETURN;
  END IF;

  -- Get attachment record
  SELECT * INTO _attachment
  FROM tenant.attachments
  WHERE id = p_attachment_id 
    AND tenant_id = _tenant_id 
    AND deleted_at IS NULL;

  IF _attachment.id IS NULL THEN
    RETURN QUERY SELECT false, 'File not found or access denied', NULL::TEXT;
    RETURN;
  END IF;

  -- Generate signed download URL
  SELECT storage.sign_url(_attachment.storage_bucket, _attachment.storage_path, 
                         format('%s hours', p_expiry_hours), 'GET') INTO _signed_url;

  RETURN QUERY SELECT true, 'Download URL generated successfully', _signed_url;
END;
$$;

-- ===========================================
-- 2. GRANT EXECUTE PERMISSIONS
-- ===========================================

GRANT EXECUTE ON FUNCTION public.start_file_upload(UUID, UUID, UUID, TEXT, TEXT, BIGINT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_file_upload(UUID, BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_file(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_file_download_url(UUID, INTEGER) TO authenticated;

-- Revoke from public for security
REVOKE EXECUTE ON FUNCTION public.start_file_upload(UUID, UUID, UUID, TEXT, TEXT, BIGINT, JSONB) FROM public;
REVOKE EXECUTE ON FUNCTION public.finalize_file_upload(UUID, BIGINT, TEXT) FROM public;
REVOKE EXECUTE ON FUNCTION public.delete_file(UUID) FROM public;
REVOKE EXECUTE ON FUNCTION public.get_file_download_url(UUID, INTEGER) FROM public;

-- ===========================================
-- 3. ADD COMMENTS FOR CLARITY
-- ===========================================

COMMENT ON FUNCTION public.start_file_upload(UUID, UUID, UUID, TEXT, TEXT, BIGINT, JSONB) IS 'Initiates file upload process with tenant validation and signed URL generation';
COMMENT ON FUNCTION public.finalize_file_upload(UUID, BIGINT, TEXT) IS 'Finalizes file upload and updates object column with file metadata';
COMMENT ON FUNCTION public.delete_file(UUID) IS 'Soft deletes file attachment and removes from object column';
COMMENT ON FUNCTION public.get_file_download_url(UUID, INTEGER) IS 'Generates signed download URL for file access';
