-- ================================
-- Migration 219: Fix file/files field type mapping in tenant.add_field
--
-- 'file' and 'files' were both mapping to TEXT.
-- They must map to JSONB (file = single attachment object, files = array).
-- ================================

CREATE OR REPLACE FUNCTION tenant.add_field(
  p_object_id        UUID,
  p_field_name       TEXT,
  p_field_label      TEXT,
  p_field_type       TEXT,
  p_required         BOOLEAN DEFAULT false,
  p_default_value    TEXT DEFAULT NULL,
  p_validation_rules JSONB DEFAULT '[]'::jsonb,
  p_field_group      TEXT DEFAULT NULL,
  p_display_order    INTEGER DEFAULT 0,
  p_is_system        BOOLEAN DEFAULT false
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant, public
AS $$
DECLARE
  _tenant_id         UUID;
  _object_name       TEXT;
  _column_name       TEXT;
  _column_definition TEXT;
  _field_id          UUID;
  _sql               TEXT;
  _field_type        TEXT;
BEGIN
  -- Resolve caller's tenant
  SELECT su.tenant_id INTO _tenant_id
  FROM system.users su WHERE su.id = auth.uid();

  IF _tenant_id IS NULL THEN
    RAISE EXCEPTION 'User not found or no tenant assigned';
  END IF;

  -- Verify object belongs to this tenant
  SELECT o.name INTO _object_name
  FROM tenant.objects o
  WHERE o.id = p_object_id AND o.tenant_id = _tenant_id;

  IF _object_name IS NULL THEN
    RAISE EXCEPTION 'Object not found or access denied';
  END IF;

  _field_type := lower(trim(p_field_type));

  -- Append __a suffix for custom (non-system) fields
  IF p_is_system OR p_field_name IN ('id','tenant_id','created_at','updated_at','created_by','updated_by','name','is_active','autonumber') THEN
    _column_name := p_field_name;
  ELSE
    _column_name := p_field_name || '__a';
  END IF;

  -- Map field type to PostgreSQL column type
  CASE _field_type
    WHEN 'text'          THEN _column_definition := 'TEXT';
    WHEN 'longtext'      THEN _column_definition := 'TEXT';
    WHEN 'integer'       THEN _column_definition := 'INTEGER';
    WHEN 'number'        THEN _column_definition := 'NUMERIC';
    WHEN 'decimal(10,2)' THEN _column_definition := 'DECIMAL(10,2)';
    WHEN 'money'         THEN _column_definition := 'DECIMAL(15,2)';
    WHEN 'percent'       THEN _column_definition := 'DECIMAL(5,2)';
    WHEN 'boolean'       THEN _column_definition := 'BOOLEAN';
    WHEN 'date'          THEN _column_definition := 'DATE';
    WHEN 'datetime'      THEN _column_definition := 'TIMESTAMPTZ';
    WHEN 'timestamptz'   THEN _column_definition := 'TIMESTAMPTZ';
    WHEN 'time'          THEN _column_definition := 'TIME';
    WHEN 'uuid'          THEN _column_definition := 'UUID';
    WHEN 'reference'     THEN _column_definition := 'UUID';
    WHEN 'jsonb'         THEN _column_definition := 'JSONB';
    WHEN 'json'          THEN _column_definition := 'JSONB';
    WHEN 'picklist'      THEN _column_definition := 'TEXT';
    WHEN 'multiselect'   THEN _column_definition := 'JSONB';
    WHEN 'email'         THEN _column_definition := 'TEXT';
    WHEN 'url'           THEN _column_definition := 'TEXT';
    WHEN 'phone'         THEN _column_definition := 'TEXT';
    WHEN 'image'         THEN _column_definition := 'TEXT';
    WHEN 'file'          THEN _column_definition := 'JSONB';   -- single file attachment
    WHEN 'files'         THEN _column_definition := 'JSONB';   -- multiple file attachments
    WHEN 'color'         THEN _column_definition := 'VARCHAR(7)';
    WHEN 'rating'        THEN _column_definition := 'INTEGER';
    WHEN 'autonumber'    THEN _column_definition := 'BIGINT GENERATED ALWAYS AS IDENTITY';
    ELSE _column_definition := 'TEXT';
  END CASE;

  -- Handle dynamic varchar/decimal types
  IF _field_type ~* '^varchar\(\d+\)$' THEN
    _column_definition := lower(_field_type);
  ELSIF _field_type ~* '^decimal\(\d+,\d+\)$' THEN
    _column_definition := lower(_field_type);
  END IF;

  -- Insert field metadata
  INSERT INTO tenant.fields (
    object_id, name, label, type, required,
    default_value, validation_rules, field_group,
    display_order, is_system, tenant_id
  ) VALUES (
    p_object_id, p_field_name, p_field_label, p_field_type, p_required,
    p_default_value, p_validation_rules, p_field_group,
    p_display_order, p_is_system, _tenant_id
  )
  RETURNING id INTO _field_id;

  -- Add column to the object table (skip autonumber — handled separately)
  IF _field_type != 'autonumber' THEN
    _sql := format(
      'ALTER TABLE tenant.%I ADD COLUMN IF NOT EXISTS %I %s',
      _object_name, _column_name, _column_definition
    );
    EXECUTE _sql;
  END IF;

  RETURN _field_id;
END;
$$;

GRANT EXECUTE ON FUNCTION tenant.add_field(UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, JSONB, TEXT, INTEGER, BOOLEAN) TO authenticated;
