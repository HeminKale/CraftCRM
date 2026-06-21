-- ================================
-- Migration 216: Auto-advance status on quotation upload
--
-- NOTE: Cannot use a column-level trigger because finalize_file_upload
-- updates columns via EXECUTE (dynamic SQL) which bypasses triggers.
-- Instead, we extend finalize_file_upload to check if the uploaded
-- field is 'quotation' on external_clients__a and auto-advance status.
-- ================================

-- Drop the trigger approach (won't work with dynamic SQL)
DROP TRIGGER IF EXISTS trg_quotation_uploaded ON tenant.external_clients__a;
DROP FUNCTION IF EXISTS tenant.on_quotation_uploaded();

-- Replace finalize_file_upload with status-aware version
DROP FUNCTION IF EXISTS public.finalize_file_upload(UUID, BIGINT, TEXT);

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
  _tenant_id    UUID;
  _attachment   tenant.attachments;
  _object_name  TEXT;
  _field_name   TEXT;
  _column_name  TEXT;
  _file_metadata JSONB;
  _sql          TEXT;
  -- For status auto-advance
  _caller_role  TEXT;
  _custom_role  TEXT;
  _should_advance BOOLEAN := false;
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
  WHERE id = p_attachment_id AND tenant_id = _tenant_id;

  IF _attachment.id IS NULL THEN
    RETURN QUERY SELECT false, 'Attachment not found or access denied', NULL::JSONB;
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

  -- Update the object column
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

  -- ── Status auto-advance for quotation on external_clients__a ──
  IF _object_name = 'external_clients__a' AND _field_name = 'quotation' THEN

    SELECT su.role INTO _caller_role FROM system.users su WHERE su.id = _auth_user_id;
    SELECT r.name INTO _custom_role
    FROM system.users su
    JOIN tenant.roles r ON r.id = su.custom_role_id
    WHERE su.id = _auth_user_id;

    IF _caller_role = 'admin' OR (lower(coalesce(_custom_role,'')) LIKE '%crm%') THEN
      _should_advance := true;
    END IF;

    IF _should_advance THEN
      UPDATE tenant.external_clients__a
      SET
        status__a                    = 'Quotation_Received',
        "Quotation_Received_Date__a" = CURRENT_DATE,
        updated_at                   = NOW()
      WHERE id = _attachment.record_id
        AND tenant_id = _tenant_id;
    END IF;
  END IF;

  -- Client agreement upload does NOT auto-advance status.
  -- Status advances to Client_Agreement_Signed only when the client signs
  -- via the review_client_agreement RPC.

  RETURN QUERY SELECT true, 'File upload finalized successfully', _file_metadata;
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_file_upload(UUID, BIGINT, TEXT) TO authenticated;
