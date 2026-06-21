-- ================================
-- Migration 212: Two fixes
--
-- 1. Fix fix_file_field_column_types() — ambiguous table_name variable
-- 2. Auto-assign permission sets when a custom role is assigned to a user
-- ================================

-- -----------------------------------------------
-- 1. Fix fix_file_field_column_types
--    Renamed output columns to avoid clash with information_schema.columns
-- -----------------------------------------------
DROP FUNCTION IF EXISTS public.fix_file_field_column_types();

CREATE OR REPLACE FUNCTION public.fix_file_field_column_types()
RETURNS TABLE(obj_table TEXT, col_name TEXT, result TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _rec        RECORD;
  _col        TEXT;
  _tbl        TEXT;
  _data_type  TEXT;
  _sql        TEXT;
BEGIN
  FOR _rec IN
    SELECT o.name AS obj_name, f.name AS field_name, f.type AS field_type
    FROM tenant.fields f
    JOIN tenant.objects o ON o.id = f.object_id
    WHERE f.type IN ('file', 'files')
  LOOP
    _col := _rec.field_name || '__a';
    _tbl := _rec.obj_name;

    SELECT c.data_type INTO _data_type
    FROM information_schema.columns c
    WHERE c.table_schema = 'tenant'
      AND c.table_name   = _tbl
      AND c.column_name  = _col;

    IF _data_type IS NULL THEN
      obj_table := _tbl; col_name := _col; result := 'column not found';
      RETURN NEXT; CONTINUE;
    END IF;

    IF _data_type = 'jsonb' THEN
      obj_table := _tbl; col_name := _col; result := 'already JSONB, skipped';
      RETURN NEXT; CONTINUE;
    END IF;

    _sql := format(
      'ALTER TABLE tenant.%I ALTER COLUMN %I TYPE JSONB USING NULL',
      _tbl, _col
    );
    EXECUTE _sql;

    obj_table := _tbl; col_name := _col; result := 'converted TEXT → JSONB';
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fix_file_field_column_types() TO authenticated;

-- -----------------------------------------------
-- 2. role_to_permission_set mapping table
--    Admins configure: "when role X is assigned → also assign perm set Y"
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS tenant.role_permission_set_mappings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES system.tenants(id) ON DELETE CASCADE,
  role_id          UUID NOT NULL REFERENCES tenant.roles(id) ON DELETE CASCADE,
  permission_set_id UUID NOT NULL REFERENCES tenant.permission_sets(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, role_id, permission_set_id)
);

ALTER TABLE tenant.role_permission_set_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rpsm_tenant_all" ON tenant.role_permission_set_mappings
  FOR ALL USING (
    tenant_id = (SELECT su.tenant_id FROM system.users su WHERE su.id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_rpsm_role ON tenant.role_permission_set_mappings(role_id);

-- -----------------------------------------------
-- 3. Trigger function: when custom_role_id changes on system.users,
--    auto-assign mapped permission sets
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION system.auto_assign_permission_sets_on_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _mapping RECORD;
BEGIN
  -- Only act when custom_role_id changes (set or updated)
  IF (NEW.custom_role_id IS NOT DISTINCT FROM OLD.custom_role_id) THEN
    RETURN NEW;
  END IF;

  -- If role was cleared, remove all auto-assigned sets
  -- (sets manually assigned by admin are left untouched — we only remove ones
  --  that came from the previous role mapping)
  IF OLD.custom_role_id IS NOT NULL THEN
    DELETE FROM tenant.user_permission_sets ups
    WHERE ups.user_id = NEW.id
      AND ups.perm_set_id IN (
        SELECT m.permission_set_id
        FROM tenant.role_permission_set_mappings m
        WHERE m.role_id   = OLD.custom_role_id
          AND m.tenant_id = NEW.tenant_id
      );
  END IF;

  -- Assign permission sets mapped to the new role
  IF NEW.custom_role_id IS NOT NULL THEN
    FOR _mapping IN
      SELECT m.permission_set_id
      FROM tenant.role_permission_set_mappings m
      WHERE m.role_id   = NEW.custom_role_id
        AND m.tenant_id = NEW.tenant_id
    LOOP
      INSERT INTO tenant.user_permission_sets(user_id, perm_set_id, tenant_id)
      VALUES (NEW.id, _mapping.permission_set_id, NEW.tenant_id)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

-- Attach trigger to system.users
DROP TRIGGER IF EXISTS trg_auto_assign_perm_sets ON system.users;
CREATE TRIGGER trg_auto_assign_perm_sets
  AFTER UPDATE OF custom_role_id ON system.users
  FOR EACH ROW
  EXECUTE FUNCTION system.auto_assign_permission_sets_on_role_change();

-- -----------------------------------------------
-- 4. RPC: get role-to-permission-set mappings
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION public.get_role_perm_set_mappings(p_tenant_id UUID)
RETURNS TABLE(
  id               UUID,
  role_id          UUID,
  role_name        TEXT,
  permission_set_id UUID,
  perm_set_name    TEXT
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_tenant UUID;
BEGIN
  SELECT su.tenant_id INTO _caller_tenant FROM system.users su WHERE su.id = auth.uid();
  IF _caller_tenant IS NULL OR _caller_tenant != p_tenant_id THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.role_id,
    r.name::TEXT  AS role_name,
    m.permission_set_id,
    ps.name::TEXT AS perm_set_name
  FROM tenant.role_permission_set_mappings m
  JOIN tenant.roles r ON r.id = m.role_id
  JOIN tenant.permission_sets ps ON ps.id = m.permission_set_id
  WHERE m.tenant_id = p_tenant_id
  ORDER BY r.name, ps.name;
END;
$$;

-- -----------------------------------------------
-- 5. RPC: add a role → permission set mapping
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION public.add_role_perm_set_mapping(
  p_role_id          UUID,
  p_permission_set_id UUID
)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_id     UUID;
  _caller_tenant UUID;
BEGIN
  _caller_id := auth.uid();
  SELECT su.tenant_id INTO _caller_tenant FROM system.users su WHERE su.id = _caller_id;

  IF NOT EXISTS (SELECT 1 FROM system.users su WHERE su.id = _caller_id AND su.role = 'admin') THEN
    RETURN QUERY SELECT false, 'Only admins can manage role mappings'; RETURN;
  END IF;

  -- Validate role and perm set belong to this tenant
  IF NOT EXISTS (SELECT 1 FROM tenant.roles r WHERE r.id = p_role_id AND r.tenant_id = _caller_tenant) THEN
    RETURN QUERY SELECT false, 'Role not found'; RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tenant.permission_sets ps WHERE ps.id = p_permission_set_id AND ps.tenant_id = _caller_tenant) THEN
    RETURN QUERY SELECT false, 'Permission set not found'; RETURN;
  END IF;

  INSERT INTO tenant.role_permission_set_mappings(tenant_id, role_id, permission_set_id)
  VALUES (_caller_tenant, p_role_id, p_permission_set_id)
  ON CONFLICT DO NOTHING;

  RETURN QUERY SELECT true, 'Mapping added';
END;
$$;

-- -----------------------------------------------
-- 6. RPC: remove a role → permission set mapping
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_role_perm_set_mapping(p_mapping_id UUID)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_id     UUID;
  _caller_tenant UUID;
  _map_tenant    UUID;
BEGIN
  _caller_id := auth.uid();
  SELECT su.tenant_id INTO _caller_tenant FROM system.users su WHERE su.id = _caller_id;

  IF NOT EXISTS (SELECT 1 FROM system.users su WHERE su.id = _caller_id AND su.role = 'admin') THEN
    RETURN QUERY SELECT false, 'Only admins can manage role mappings'; RETURN;
  END IF;

  SELECT m.tenant_id INTO _map_tenant FROM tenant.role_permission_set_mappings m WHERE m.id = p_mapping_id;
  IF NOT FOUND OR _map_tenant != _caller_tenant THEN
    RETURN QUERY SELECT false, 'Mapping not found'; RETURN;
  END IF;

  DELETE FROM tenant.role_permission_set_mappings m WHERE m.id = p_mapping_id;
  RETURN QUERY SELECT true, 'Mapping removed';
END;
$$;

-- -----------------------------------------------
-- 7. Grants
-- -----------------------------------------------
GRANT EXECUTE ON FUNCTION public.get_role_perm_set_mappings(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_role_perm_set_mapping(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_role_perm_set_mapping(UUID) TO authenticated;
