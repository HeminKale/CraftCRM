-- ================================
-- Migration 211: File Upload - get_record_attachments RPC
--
-- Adds a function to list all active attachments for a record+field
-- combination. Used by the FileUploadField UI component.
--
-- Also provides a helper to fix TEXT columns to JSONB for file fields.
-- Run fix_file_field_column_types() once after this migration.
-- ================================

-- -----------------------------------------------
-- 1. get_record_attachments
--    Returns all active (non-deleted) attachments for a record+field
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION public.get_record_attachments(
  p_record_id UUID,
  p_field_id  UUID
)
RETURNS TABLE(
  id           UUID,
  filename     TEXT,
  mime_type    TEXT,
  byte_size    BIGINT,
  storage_path TEXT,
  storage_bucket TEXT,
  uploaded_by  UUID,
  created_at   TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _tenant_id UUID;
BEGIN
  SELECT su.tenant_id INTO _tenant_id FROM system.users su WHERE su.id = auth.uid();
  IF _tenant_id IS NULL THEN RAISE EXCEPTION 'Access denied'; END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.filename::TEXT,
    a.mime_type::TEXT,
    a.byte_size,
    a.storage_path::TEXT,
    a.storage_bucket::TEXT,
    a.uploaded_by,
    a.created_at
  FROM tenant.attachments a
  WHERE a.record_id   = p_record_id
    AND a.field_id    = p_field_id
    AND a.tenant_id   = _tenant_id
    AND a.deleted_at  IS NULL
  ORDER BY a.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_record_attachments(UUID, UUID) TO authenticated;

-- -----------------------------------------------
-- 2. fix_file_field_column_types
--    Converts any TEXT column that belongs to a field of type 'file'
--    or 'files' to JSONB, safely (only if no data exists or it's NULL).
--    Call this once manually after running the migration.
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION public.fix_file_field_column_types()
RETURNS TABLE(table_name TEXT, column_name TEXT, result TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _rec RECORD;
  _sql TEXT;
BEGIN
  FOR _rec IN
    SELECT
      o.name  AS obj_name,
      f.name  AS field_name,
      f.type  AS field_type
    FROM tenant.fields f
    JOIN tenant.objects o ON o.id = f.object_id
    WHERE f.type IN ('file', 'files')
  LOOP
    -- Column name in the physical table
    DECLARE
      _col TEXT := _rec.field_name || '__a';
      _tbl TEXT := _rec.obj_name;
      _data_type TEXT;
    BEGIN
      -- Check current data type
      SELECT data_type INTO _data_type
      FROM information_schema.columns
      WHERE table_schema = 'tenant'
        AND table_name   = _tbl
        AND column_name  = _col;

      IF _data_type IS NULL THEN
        table_name  := _tbl;
        column_name := _col;
        result      := 'column not found';
        RETURN NEXT;
        CONTINUE;
      END IF;

      IF _data_type = 'jsonb' THEN
        table_name  := _tbl;
        column_name := _col;
        result      := 'already JSONB, skipped';
        RETURN NEXT;
        CONTINUE;
      END IF;

      -- Safe conversion: set to NULL first (file columns should be empty before use)
      _sql := format(
        'ALTER TABLE tenant.%I ALTER COLUMN %I TYPE JSONB USING NULL',
        _tbl, _col
      );

      EXECUTE _sql;

      table_name  := _tbl;
      column_name := _col;
      result      := 'converted TEXT → JSONB';
      RETURN NEXT;
    END;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fix_file_field_column_types() TO authenticated;
