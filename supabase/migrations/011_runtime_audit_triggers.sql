-- Migration 011: Runtime audit triggers + enforce __a suffix for custom objects/fields

-- 1) Helper to ensure custom suffix __a for non-system names
CREATE OR REPLACE FUNCTION public.ensure_custom_suffix(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_name IS NULL THEN
    RETURN NULL;
  END IF;
  IF RIGHT(p_name, 3) = '__a' THEN
    RETURN p_name;
  ELSE
    RETURN p_name || '__a';
  END IF;
END;
$$;

-- 2) Update create_tenant_field to append __a for non-system fields automatically
CREATE OR REPLACE FUNCTION public.create_tenant_field(
  p_object_id UUID,
  p_name TEXT,
  p_label TEXT,
  p_type TEXT,
  p_tenant_id UUID,
  p_is_required BOOLEAN DEFAULT FALSE,
  p_is_nullable BOOLEAN DEFAULT TRUE,
  p_default_value TEXT DEFAULT NULL,
  p_validation_rules JSONB DEFAULT '[]'::jsonb,
  p_display_order INTEGER DEFAULT 0,
  p_section VARCHAR DEFAULT 'details',
  p_width VARCHAR DEFAULT 'half',
  p_is_visible BOOLEAN DEFAULT TRUE,
  p_is_system_field BOOLEAN DEFAULT FALSE,
  p_reference_table VARCHAR DEFAULT NULL,
  p_reference_display_field VARCHAR DEFAULT NULL
)
RETURNS TABLE(id UUID, name TEXT, label TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  final_name TEXT;
  new_field tenant.fields;
BEGIN
  final_name := CASE WHEN p_is_system_field THEN p_name ELSE public.ensure_custom_suffix(p_name) END;

  INSERT INTO tenant.fields (
    object_id, name, label, type, is_required, is_nullable, default_value,
    validation_rules, display_order, section, width, is_visible, is_system_field,
    reference_table, reference_display_field, tenant_id
  )
  VALUES (
    p_object_id, final_name, p_label, p_type, p_is_required, p_is_nullable, p_default_value,
    p_validation_rules, p_display_order, p_section, p_width, p_is_visible, p_is_system_field,
    p_reference_table, p_reference_display_field, p_tenant_id
  )
  RETURNING * INTO new_field;

  RETURN QUERY SELECT new_field.id, new_field.name, new_field.label;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_tenant_field(UUID, TEXT, TEXT, TEXT, UUID, BOOLEAN, BOOLEAN, TEXT, JSONB, INTEGER, VARCHAR, VARCHAR, BOOLEAN, BOOLEAN, VARCHAR, VARCHAR) TO authenticated;

-- 3) Update create_tenant_object to append __a for non-system objects automatically
CREATE OR REPLACE FUNCTION public.create_tenant_object(
  p_name TEXT,
  p_label TEXT,
  p_tenant_id UUID,
  p_description TEXT DEFAULT NULL,
  p_is_system_object BOOLEAN DEFAULT FALSE
)
RETURNS TABLE(id UUID, name TEXT, label TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  final_name TEXT;
  new_object tenant.objects;
BEGIN
  final_name := CASE WHEN p_is_system_object THEN p_name ELSE public.ensure_custom_suffix(p_name) END;

  INSERT INTO tenant.objects (name, label, description, is_system_object, is_active, tenant_id)
  VALUES (final_name, p_label, p_description, p_is_system_object, true, p_tenant_id)
  RETURNING * INTO new_object;

  PERFORM public.seed_system_fields(new_object.id, p_tenant_id);

  RETURN QUERY SELECT new_object.id, new_object.name, new_object.label;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_tenant_object(TEXT, TEXT, UUID, TEXT, BOOLEAN) TO authenticated;

-- 4) Adjust seed_system_fields: created_by/updated_by as text (store names), not uuid
CREATE OR REPLACE FUNCTION public.seed_system_fields(
  p_object_id UUID,
  p_tenant_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Name
  INSERT INTO tenant.fields (
    object_id, tenant_id, name, label, type,
    is_required, is_nullable, default_value,
    validation_rules, display_order, section, width,
    is_visible, is_system_field
  )
  SELECT p_object_id, p_tenant_id, 'name', 'Name', 'text', true, false, NULL,
         '[]'::jsonb, 1, 'details', 'half', true, true
  WHERE NOT EXISTS (
    SELECT 1 FROM tenant.fields f WHERE f.object_id=p_object_id AND f.tenant_id=p_tenant_id AND f.name='name'
  );

  -- is_active
  INSERT INTO tenant.fields (
    object_id, tenant_id, name, label, type,
    is_required, is_nullable, default_value,
    validation_rules, display_order, section, width,
    is_visible, is_system_field
  )
  SELECT p_object_id, p_tenant_id, 'is_active', 'Active', 'boolean', false, true, NULL,
         '[]'::jsonb, 2, 'system', 'half', true, true
  WHERE NOT EXISTS (
    SELECT 1 FROM tenant.fields f WHERE f.object_id=p_object_id AND f.tenant_id=p_tenant_id AND f.name='is_active'
  );

  -- created_at
  INSERT INTO tenant.fields (object_id, tenant_id, name, label, type, is_required, is_nullable, default_value,
    validation_rules, display_order, section, width, is_visible, is_system_field)
  SELECT p_object_id, p_tenant_id, 'created_at', 'Created Date', 'timestamptz', false, true, NULL,
         '[]'::jsonb, 90, 'system', 'half', true, true
  WHERE NOT EXISTS (
    SELECT 1 FROM tenant.fields f WHERE f.object_id=p_object_id AND f.tenant_id=p_tenant_id AND f.name='created_at'
  );

  -- updated_at
  INSERT INTO tenant.fields (object_id, tenant_id, name, label, type, is_required, is_nullable, default_value,
    validation_rules, display_order, section, width, is_visible, is_system_field)
  SELECT p_object_id, p_tenant_id, 'updated_at', 'Updated Date', 'timestamptz', false, true, NULL,
         '[]'::jsonb, 91, 'system', 'half', true, true
  WHERE NOT EXISTS (
    SELECT 1 FROM tenant.fields f WHERE f.object_id=p_object_id AND f.tenant_id=p_tenant_id AND f.name='updated_at'
  );

  -- created_by (text name)
  INSERT INTO tenant.fields (object_id, tenant_id, name, label, type, is_required, is_nullable, default_value,
    validation_rules, display_order, section, width, is_visible, is_system_field)
  SELECT p_object_id, p_tenant_id, 'created_by', 'Created By', 'text', false, true, NULL,
         '[]'::jsonb, 92, 'system', 'half', true, true
  WHERE NOT EXISTS (
    SELECT 1 FROM tenant.fields f WHERE f.object_id=p_object_id AND f.tenant_id=p_tenant_id AND f.name='created_by'
  );

  -- updated_by (text name)
  INSERT INTO tenant.fields (object_id, tenant_id, name, label, type, is_required, is_nullable, default_value,
    validation_rules, display_order, section, width, is_visible, is_system_field)
  SELECT p_object_id, p_tenant_id, 'updated_by', 'Updated By', 'text', false, true, NULL,
         '[]'::jsonb, 93, 'system', 'half', true, true
  WHERE NOT EXISTS (
    SELECT 1 FROM tenant.fields f WHERE f.object_id=p_object_id AND f.tenant_id=p_tenant_id AND f.name='updated_by'
  );

  -- tenant_id (hidden)
  INSERT INTO tenant.fields (object_id, tenant_id, name, label, type, is_required, is_nullable, default_value,
    validation_rules, display_order, section, width, is_visible, is_system_field)
  SELECT p_object_id, p_tenant_id, 'tenant_id', 'Tenant', 'uuid', false, true, NULL,
         '[]'::jsonb, 94, 'system', 'half', false, true
  WHERE NOT EXISTS (
    SELECT 1 FROM tenant.fields f WHERE f.object_id=p_object_id AND f.tenant_id=p_tenant_id AND f.name='tenant_id'
  );

  -- id (hidden)
  INSERT INTO tenant.fields (object_id, tenant_id, name, label, type, is_required, is_nullable, default_value,
    validation_rules, display_order, section, width, is_visible, is_system_field)
  SELECT p_object_id, p_tenant_id, 'id', 'ID', 'uuid', false, false, NULL,
         '[]'::jsonb, 95, 'system', 'half', false, true
  WHERE NOT EXISTS (
    SELECT 1 FROM tenant.fields f WHERE f.object_id=p_object_id AND f.tenant_id=p_tenant_id AND f.name='id'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_system_fields(UUID, UUID) TO authenticated;

-- 5) User full name resolver
CREATE OR REPLACE FUNCTION public.current_user_full_name()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email)
  FROM system.users u
  WHERE u.id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.current_user_full_name() TO authenticated;

-- 6) Audit trigger functions
CREATE OR REPLACE FUNCTION public.audit_set_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  NEW.created_at := COALESCE(NEW.created_at, NOW());
  NEW.updated_at := COALESCE(NEW.updated_at, NOW());
  NEW.created_by := COALESCE(NEW.created_by, public.current_user_full_name());
  NEW.updated_by := COALESCE(NEW.updated_by, public.current_user_full_name());
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_set_on_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  NEW.updated_at := NOW();
  NEW.updated_by := public.current_user_full_name();
  RETURN NEW;
END;
$$;

-- 7) Helper to attach triggers to a given table
CREATE OR REPLACE FUNCTION public.attach_audit_triggers(p_table_schema TEXT, p_table_name TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  q TEXT;
BEGIN
  -- Create INSERT trigger
  q := format('CREATE TRIGGER %I BEFORE INSERT ON %I.%I FOR EACH ROW EXECUTE FUNCTION public.audit_set_on_insert();',
              p_table_name || '_audit_insert', p_table_schema, p_table_name);
  EXECUTE q;

  -- Create UPDATE trigger
  q := format('CREATE TRIGGER %I BEFORE UPDATE ON %I.%I FOR EACH ROW EXECUTE FUNCTION public.audit_set_on_update();',
              p_table_name || '_audit_update', p_table_schema, p_table_name);
  EXECUTE q;
END;
$$;

GRANT EXECUTE ON FUNCTION public.attach_audit_triggers(TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.attach_audit_triggers(TEXT, TEXT) IS 'Attach created_at/updated_at and created_by/updated_by auto-population triggers to a table.';

