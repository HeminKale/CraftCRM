-- Migration 010: Seed system fields for newly created objects and wire into create_tenant_object

-- 1) Seeder function: inserts standard system fields for an object (idempotent)
CREATE OR REPLACE FUNCTION public.seed_system_fields(
  p_object_id UUID,
  p_tenant_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Name (primary display)
  INSERT INTO tenant.fields (
    object_id, tenant_id, name, label, type,
    is_required, is_nullable, default_value,
    validation_rules, display_order, section, width,
    is_visible, is_system_field
  )
  SELECT p_object_id, p_tenant_id, 'name', 'Name', 'text',
         true, false, NULL,
         '[]'::jsonb, 1, 'details', 'half',
         true, true
  WHERE NOT EXISTS (
    SELECT 1 FROM tenant.fields f
    WHERE f.object_id = p_object_id AND f.tenant_id = p_tenant_id AND f.name = 'name'
  );

  -- is_active
  INSERT INTO tenant.fields (
    object_id, tenant_id, name, label, type,
    is_required, is_nullable, default_value,
    validation_rules, display_order, section, width,
    is_visible, is_system_field
  )
  SELECT p_object_id, p_tenant_id, 'is_active', 'Active', 'boolean',
         false, true, NULL,
         '[]'::jsonb, 2, 'system', 'half',
         true, true
  WHERE NOT EXISTS (
    SELECT 1 FROM tenant.fields f
    WHERE f.object_id = p_object_id AND f.tenant_id = p_tenant_id AND f.name = 'is_active'
  );

  -- created_at
  INSERT INTO tenant.fields (
    object_id, tenant_id, name, label, type,
    is_required, is_nullable, default_value,
    validation_rules, display_order, section, width,
    is_visible, is_system_field
  )
  SELECT p_object_id, p_tenant_id, 'created_at', 'Created Date', 'timestamptz',
         false, true, NULL,
         '[]'::jsonb, 90, 'system', 'half',
         true, true
  WHERE NOT EXISTS (
    SELECT 1 FROM tenant.fields f
    WHERE f.object_id = p_object_id AND f.tenant_id = p_tenant_id AND f.name = 'created_at'
  );

  -- updated_at
  INSERT INTO tenant.fields (
    object_id, tenant_id, name, label, type,
    is_required, is_nullable, default_value,
    validation_rules, display_order, section, width,
    is_visible, is_system_field
  )
  SELECT p_object_id, p_tenant_id, 'updated_at', 'Updated Date', 'timestamptz',
         false, true, NULL,
         '[]'::jsonb, 91, 'system', 'half',
         true, true
  WHERE NOT EXISTS (
    SELECT 1 FROM tenant.fields f
    WHERE f.object_id = p_object_id AND f.tenant_id = p_tenant_id AND f.name = 'updated_at'
  );

  -- created_by (reference to system.users)
  INSERT INTO tenant.fields (
    object_id, tenant_id, name, label, type,
    is_required, is_nullable, default_value,
    validation_rules, display_order, section, width,
    is_visible, is_system_field, reference_table, reference_display_field
  )
  SELECT p_object_id, p_tenant_id, 'created_by', 'Created By', 'uuid',
         false, true, NULL,
         '[]'::jsonb, 92, 'system', 'half',
         true, true, 'system.users', 'email'
  WHERE NOT EXISTS (
    SELECT 1 FROM tenant.fields f
    WHERE f.object_id = p_object_id AND f.tenant_id = p_tenant_id AND f.name = 'created_by'
  );

  -- updated_by (reference to system.users)
  INSERT INTO tenant.fields (
    object_id, tenant_id, name, label, type,
    is_required, is_nullable, default_value,
    validation_rules, display_order, section, width,
    is_visible, is_system_field, reference_table, reference_display_field
  )
  SELECT p_object_id, p_tenant_id, 'updated_by', 'Updated By', 'uuid',
         false, true, NULL,
         '[]'::jsonb, 93, 'system', 'half',
         true, true, 'system.users', 'email'
  WHERE NOT EXISTS (
    SELECT 1 FROM tenant.fields f
    WHERE f.object_id = p_object_id AND f.tenant_id = p_tenant_id AND f.name = 'updated_by'
  );

  -- tenant_id (hidden system)
  INSERT INTO tenant.fields (
    object_id, tenant_id, name, label, type,
    is_required, is_nullable, default_value,
    validation_rules, display_order, section, width,
    is_visible, is_system_field
  )
  SELECT p_object_id, p_tenant_id, 'tenant_id', 'Tenant', 'uuid',
         false, true, NULL,
         '[]'::jsonb, 94, 'system', 'half',
         false, true
  WHERE NOT EXISTS (
    SELECT 1 FROM tenant.fields f
    WHERE f.object_id = p_object_id AND f.tenant_id = p_tenant_id AND f.name = 'tenant_id'
  );

  -- id (hidden system)
  INSERT INTO tenant.fields (
    object_id, tenant_id, name, label, type,
    is_required, is_nullable, default_value,
    validation_rules, display_order, section, width,
    is_visible, is_system_field
  )
  SELECT p_object_id, p_tenant_id, 'id', 'ID', 'uuid',
         false, false, NULL,
         '[]'::jsonb, 95, 'system', 'half',
         false, true
  WHERE NOT EXISTS (
    SELECT 1 FROM tenant.fields f
    WHERE f.object_id = p_object_id AND f.tenant_id = p_tenant_id AND f.name = 'id'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_system_fields(UUID, UUID) TO authenticated;

-- 2) Wire seeding into create_tenant_object (ensure it remains idempotent)
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
  new_object tenant.objects;
BEGIN
  INSERT INTO tenant.objects (name, label, description, is_system_object, is_active, tenant_id)
  VALUES (p_name, p_label, p_description, p_is_system_object, true, p_tenant_id)
  RETURNING * INTO new_object;

  -- Seed system fields (safe to run once per object)
  PERFORM public.seed_system_fields(new_object.id, p_tenant_id);

  RETURN QUERY
  SELECT new_object.id, new_object.name, new_object.label;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_tenant_object(TEXT, TEXT, UUID, TEXT, BOOLEAN) TO authenticated;

COMMENT ON FUNCTION public.seed_system_fields(UUID, UUID) IS 'Insert standard system fields for a tenant object (idempotent).';

