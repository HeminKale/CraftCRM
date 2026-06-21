-- ================================
-- Migration 208: Permission Set Entries
--
-- Adds the actual rules stored inside a permission set.
-- Each entry targets one resource (app, tab, object, or field)
-- and declares what the holder can do with it.
--
-- Effective permissions = UNION of all sets assigned to a user.
-- Admins bypass all checks entirely.
-- Users with no sets assigned get full access (nothing broken).
-- ================================

-- -----------------------------------------------
-- 1. permission_set_entries table
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS tenant.permission_set_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  permission_set_id UUID NOT NULL REFERENCES tenant.permission_sets(id) ON DELETE CASCADE,
  tenant_id        UUID NOT NULL REFERENCES system.tenants(id) ON DELETE CASCADE,

  -- What resource this entry controls
  resource_type    TEXT NOT NULL CHECK (resource_type IN ('app', 'tab', 'object', 'field')),
  resource_id      UUID NOT NULL,   -- id of the app / tab / object / field

  -- Access flags (NULL = not controlled by this entry = inherit default)
  can_read         BOOLEAN NOT NULL DEFAULT true,
  can_edit         BOOLEAN NOT NULL DEFAULT false,
  can_create       BOOLEAN NOT NULL DEFAULT false,
  can_delete       BOOLEAN NOT NULL DEFAULT false,

  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(permission_set_id, resource_type, resource_id)
);

ALTER TABLE tenant.permission_set_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pse_tenant_select" ON tenant.permission_set_entries
  FOR SELECT USING (
    tenant_id = (SELECT su.tenant_id FROM system.users su WHERE su.id = auth.uid())
  );
CREATE POLICY "pse_tenant_insert" ON tenant.permission_set_entries
  FOR INSERT WITH CHECK (
    tenant_id = (SELECT su.tenant_id FROM system.users su WHERE su.id = auth.uid())
  );
CREATE POLICY "pse_tenant_update" ON tenant.permission_set_entries
  FOR UPDATE USING (
    tenant_id = (SELECT su.tenant_id FROM system.users su WHERE su.id = auth.uid())
  );
CREATE POLICY "pse_tenant_delete" ON tenant.permission_set_entries
  FOR DELETE USING (
    tenant_id = (SELECT su.tenant_id FROM system.users su WHERE su.id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_pse_permission_set ON tenant.permission_set_entries(permission_set_id);
CREATE INDEX IF NOT EXISTS idx_pse_resource       ON tenant.permission_set_entries(tenant_id, resource_type, resource_id);

-- -----------------------------------------------
-- 2. get_permission_sets (public-schema wrapper)
--    The tenant-schema function exists but UI calls public schema.
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION public.get_permission_sets(p_tenant_id UUID)
RETURNS TABLE(
  id          UUID,
  name        TEXT,
  description TEXT,
  api_name    TEXT,
  created_at  TIMESTAMPTZ
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
  SELECT ps.id, ps.name::TEXT, ps.description::TEXT, ps.api_name::TEXT, ps.created_at
  FROM tenant.permission_sets ps
  WHERE ps.tenant_id = p_tenant_id
  ORDER BY ps.name;
END;
$$;

-- -----------------------------------------------
-- 3. create_permission_set (public wrapper)
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION public.create_permission_set(
  p_tenant_id   UUID,
  p_name        TEXT,
  p_description TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, message TEXT, perm_set_id UUID)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_tenant UUID;
  _caller_id     UUID;
  _new_id        UUID;
BEGIN
  _caller_id := auth.uid();
  SELECT su.tenant_id INTO _caller_tenant FROM system.users su WHERE su.id = _caller_id;

  IF _caller_tenant IS NULL OR _caller_tenant != p_tenant_id THEN
    RETURN QUERY SELECT false, 'Access denied', NULL::UUID; RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM system.users su WHERE su.id = _caller_id AND su.role = 'admin') THEN
    RETURN QUERY SELECT false, 'Only admins can create permission sets', NULL::UUID; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM tenant.permission_sets ps WHERE ps.tenant_id = p_tenant_id AND lower(ps.name) = lower(p_name)) THEN
    RETURN QUERY SELECT false, 'A permission set with this name already exists', NULL::UUID; RETURN;
  END IF;

  INSERT INTO tenant.permission_sets(tenant_id, name, description)
  VALUES (p_tenant_id, p_name, p_description)
  RETURNING tenant.permission_sets.id INTO _new_id;

  RETURN QUERY SELECT true, 'Permission set created', _new_id;
END;
$$;

-- -----------------------------------------------
-- 4. update_permission_set (public wrapper)
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION public.update_permission_set(
  p_perm_set_id UUID,
  p_name        TEXT,
  p_description TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_tenant UUID;
  _caller_id     UUID;
  _ps_tenant     UUID;
BEGIN
  _caller_id := auth.uid();
  SELECT su.tenant_id INTO _caller_tenant FROM system.users su WHERE su.id = _caller_id;
  SELECT ps.tenant_id INTO _ps_tenant FROM tenant.permission_sets ps WHERE ps.id = p_perm_set_id;

  IF NOT FOUND OR _caller_tenant != _ps_tenant THEN
    RETURN QUERY SELECT false, 'Permission set not found'; RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM system.users su WHERE su.id = _caller_id AND su.role = 'admin') THEN
    RETURN QUERY SELECT false, 'Only admins can update permission sets'; RETURN;
  END IF;

  UPDATE tenant.permission_sets ps
  SET name = p_name, description = p_description, updated_at = NOW()
  WHERE ps.id = p_perm_set_id;

  RETURN QUERY SELECT true, 'Permission set updated';
END;
$$;

-- -----------------------------------------------
-- 5. delete_permission_set (public wrapper)
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_permission_set(p_perm_set_id UUID)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_tenant UUID;
  _caller_id     UUID;
  _ps_tenant     UUID;
BEGIN
  _caller_id := auth.uid();
  SELECT su.tenant_id INTO _caller_tenant FROM system.users su WHERE su.id = _caller_id;
  SELECT ps.tenant_id INTO _ps_tenant FROM tenant.permission_sets ps WHERE ps.id = p_perm_set_id;

  IF NOT FOUND OR _caller_tenant != _ps_tenant THEN
    RETURN QUERY SELECT false, 'Permission set not found'; RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM system.users su WHERE su.id = _caller_id AND su.role = 'admin') THEN
    RETURN QUERY SELECT false, 'Only admins can delete permission sets'; RETURN;
  END IF;

  DELETE FROM tenant.permission_sets ps WHERE ps.id = p_perm_set_id;
  RETURN QUERY SELECT true, 'Permission set deleted';
END;
$$;

-- -----------------------------------------------
-- 6. get_permission_set_entries — list rules in one set
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION public.get_permission_set_entries(p_perm_set_id UUID)
RETURNS TABLE(
  id              UUID,
  resource_type   TEXT,
  resource_id     UUID,
  resource_name   TEXT,
  can_read        BOOLEAN,
  can_edit        BOOLEAN,
  can_create      BOOLEAN,
  can_delete      BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_tenant UUID;
  _ps_tenant     UUID;
BEGIN
  SELECT su.tenant_id INTO _caller_tenant FROM system.users su WHERE su.id = auth.uid();
  SELECT ps.tenant_id INTO _ps_tenant FROM tenant.permission_sets ps WHERE ps.id = p_perm_set_id;

  IF NOT FOUND OR _caller_tenant != _ps_tenant THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    e.resource_type::TEXT,
    e.resource_id,
    -- Resolve human-readable name per resource type
    CASE e.resource_type
      WHEN 'app'    THEN (SELECT a.name::TEXT  FROM tenant.apps    a WHERE a.id = e.resource_id)
      WHEN 'tab'    THEN (SELECT t.label::TEXT FROM tenant.tabs    t WHERE t.id = e.resource_id)
      WHEN 'object' THEN (SELECT o.name::TEXT  FROM tenant.objects o WHERE o.id = e.resource_id)
      WHEN 'field'  THEN (SELECT f.label::TEXT FROM tenant.fields  f WHERE f.id = e.resource_id)
    END AS resource_name,
    e.can_read,
    e.can_edit,
    e.can_create,
    e.can_delete
  FROM tenant.permission_set_entries e
  WHERE e.permission_set_id = p_perm_set_id
  ORDER BY e.resource_type, e.created_at;
END;
$$;

-- -----------------------------------------------
-- 7. upsert_permission_entry — add or update one rule
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_permission_entry(
  p_perm_set_id UUID,
  p_resource_type TEXT,
  p_resource_id   UUID,
  p_can_read      BOOLEAN DEFAULT true,
  p_can_edit      BOOLEAN DEFAULT false,
  p_can_create    BOOLEAN DEFAULT false,
  p_can_delete    BOOLEAN DEFAULT false
)
RETURNS TABLE(success BOOLEAN, message TEXT, entry_id UUID)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_tenant UUID;
  _caller_id     UUID;
  _ps_tenant     UUID;
  _entry_id      UUID;
BEGIN
  _caller_id := auth.uid();
  SELECT su.tenant_id INTO _caller_tenant FROM system.users su WHERE su.id = _caller_id;
  SELECT ps.tenant_id INTO _ps_tenant FROM tenant.permission_sets ps WHERE ps.id = p_perm_set_id;

  IF NOT FOUND OR _caller_tenant != _ps_tenant THEN
    RETURN QUERY SELECT false, 'Permission set not found', NULL::UUID; RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM system.users su WHERE su.id = _caller_id AND su.role = 'admin') THEN
    RETURN QUERY SELECT false, 'Only admins can manage permission entries', NULL::UUID; RETURN;
  END IF;
  IF p_resource_type NOT IN ('app','tab','object','field') THEN
    RETURN QUERY SELECT false, 'Invalid resource_type', NULL::UUID; RETURN;
  END IF;

  INSERT INTO tenant.permission_set_entries(
    permission_set_id, tenant_id, resource_type, resource_id,
    can_read, can_edit, can_create, can_delete
  ) VALUES (
    p_perm_set_id, _caller_tenant, p_resource_type, p_resource_id,
    p_can_read, p_can_edit, p_can_create, p_can_delete
  )
  ON CONFLICT (permission_set_id, resource_type, resource_id)
  DO UPDATE SET
    can_read   = EXCLUDED.can_read,
    can_edit   = EXCLUDED.can_edit,
    can_create = EXCLUDED.can_create,
    can_delete = EXCLUDED.can_delete,
    updated_at = NOW()
  RETURNING tenant.permission_set_entries.id INTO _entry_id;

  RETURN QUERY SELECT true, 'Entry saved', _entry_id;
END;
$$;

-- -----------------------------------------------
-- 8. delete_permission_entry — remove one rule
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_permission_entry(p_entry_id UUID)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_tenant UUID;
  _caller_id     UUID;
  _entry_tenant  UUID;
BEGIN
  _caller_id := auth.uid();
  SELECT su.tenant_id INTO _caller_tenant FROM system.users su WHERE su.id = _caller_id;
  SELECT e.tenant_id INTO _entry_tenant FROM tenant.permission_set_entries e WHERE e.id = p_entry_id;

  IF NOT FOUND OR _caller_tenant != _entry_tenant THEN
    RETURN QUERY SELECT false, 'Entry not found'; RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM system.users su WHERE su.id = _caller_id AND su.role = 'admin') THEN
    RETURN QUERY SELECT false, 'Only admins can delete permission entries'; RETURN;
  END IF;

  DELETE FROM tenant.permission_set_entries e WHERE e.id = p_entry_id;
  RETURN QUERY SELECT true, 'Entry deleted';
END;
$$;

-- -----------------------------------------------
-- 9. assign_permission_set_to_user / remove (public wrappers)
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_permission_set(p_user_id UUID, p_perm_set_id UUID)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_tenant UUID;
  _caller_id     UUID;
  _ps_tenant     UUID;
  _user_tenant   UUID;
BEGIN
  _caller_id := auth.uid();
  SELECT su.tenant_id INTO _caller_tenant FROM system.users su WHERE su.id = _caller_id;

  IF NOT EXISTS (SELECT 1 FROM system.users su WHERE su.id = _caller_id AND su.role = 'admin') THEN
    RETURN QUERY SELECT false, 'Only admins can assign permission sets'; RETURN;
  END IF;

  SELECT ps.tenant_id INTO _ps_tenant FROM tenant.permission_sets ps WHERE ps.id = p_perm_set_id;
  SELECT su.tenant_id INTO _user_tenant FROM system.users su WHERE su.id = p_user_id;

  IF _ps_tenant IS NULL OR _ps_tenant != _caller_tenant THEN
    RETURN QUERY SELECT false, 'Permission set not found'; RETURN;
  END IF;
  IF _user_tenant IS NULL OR _user_tenant != _caller_tenant THEN
    RETURN QUERY SELECT false, 'User not found in this tenant'; RETURN;
  END IF;

  INSERT INTO tenant.user_permission_sets(user_id, perm_set_id, tenant_id)
  VALUES (p_user_id, p_perm_set_id, _caller_tenant)
  ON CONFLICT DO NOTHING;

  RETURN QUERY SELECT true, 'Permission set assigned';
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_permission_set(p_user_id UUID, p_perm_set_id UUID)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_tenant UUID;
  _caller_id     UUID;
BEGIN
  _caller_id := auth.uid();
  SELECT su.tenant_id INTO _caller_tenant FROM system.users su WHERE su.id = _caller_id;

  IF NOT EXISTS (SELECT 1 FROM system.users su WHERE su.id = _caller_id AND su.role = 'admin') THEN
    RETURN QUERY SELECT false, 'Only admins can remove permission sets'; RETURN;
  END IF;

  DELETE FROM tenant.user_permission_sets ups
  WHERE ups.user_id = p_user_id AND ups.perm_set_id = p_perm_set_id;

  RETURN QUERY SELECT true, 'Permission set removed';
END;
$$;

-- -----------------------------------------------
-- 10. get_user_permission_sets (public wrapper)
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_permission_sets(p_user_id UUID)
RETURNS TABLE(
  perm_set_id   UUID,
  name          TEXT,
  description   TEXT,
  assigned_at   TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_tenant UUID;
BEGIN
  SELECT su.tenant_id INTO _caller_tenant FROM system.users su WHERE su.id = auth.uid();

  RETURN QUERY
  SELECT ps.id, ps.name::TEXT, ps.description::TEXT, ups.created_at
  FROM tenant.user_permission_sets ups
  JOIN tenant.permission_sets ps ON ps.id = ups.perm_set_id
  JOIN system.users su ON su.id = ups.user_id
  WHERE ups.user_id = p_user_id
    AND su.tenant_id = _caller_tenant
    AND ps.tenant_id = _caller_tenant
  ORDER BY ups.created_at;
END;
$$;

-- -----------------------------------------------
-- 11. get_my_effective_permissions
--     Called once at app boot. Returns the merged permission
--     map for the current user across all their assigned sets.
--     Admins get an empty array (frontend treats that as full access).
--     Users with no sets get an empty array too (full access default).
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_effective_permissions()
RETURNS TABLE(
  resource_type TEXT,
  resource_id   UUID,
  can_read      BOOLEAN,
  can_edit      BOOLEAN,
  can_create    BOOLEAN,
  can_delete    BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_id     UUID;
  _caller_tenant UUID;
  _caller_role   TEXT;
  _has_sets      BOOLEAN;
BEGIN
  _caller_id := auth.uid();
  SELECT su.tenant_id, su.role
  INTO _caller_tenant, _caller_role
  FROM system.users su WHERE su.id = _caller_id;

  -- Admins bypass all permission checks
  IF _caller_role = 'admin' THEN
    RETURN;
  END IF;

  -- Check if user has any permission sets assigned
  SELECT EXISTS (
    SELECT 1 FROM tenant.user_permission_sets ups
    JOIN tenant.permission_sets ps ON ps.id = ups.perm_set_id
    WHERE ups.user_id = _caller_id AND ps.tenant_id = _caller_tenant
  ) INTO _has_sets;

  -- No sets assigned → return empty (frontend gives full access)
  IF NOT _has_sets THEN
    RETURN;
  END IF;

  -- Union of all sets: most permissive wins (bool_or)
  RETURN QUERY
  SELECT
    e.resource_type::TEXT,
    e.resource_id,
    bool_or(e.can_read)   AS can_read,
    bool_or(e.can_edit)   AS can_edit,
    bool_or(e.can_create) AS can_create,
    bool_or(e.can_delete) AS can_delete
  FROM tenant.user_permission_sets ups
  JOIN tenant.permission_sets ps ON ps.id = ups.perm_set_id
  JOIN tenant.permission_set_entries e ON e.permission_set_id = ps.id
  WHERE ups.user_id = _caller_id
    AND ps.tenant_id = _caller_tenant
  GROUP BY e.resource_type, e.resource_id;
END;
$$;

-- -----------------------------------------------
-- 12. Ensure user_permission_sets has tenant_id column
-- -----------------------------------------------
ALTER TABLE tenant.user_permission_sets ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES system.tenants(id);

-- Backfill existing rows
UPDATE tenant.user_permission_sets ups
SET tenant_id = ps.tenant_id
FROM tenant.permission_sets ps
WHERE ps.id = ups.perm_set_id
  AND ups.tenant_id IS NULL;

-- -----------------------------------------------
-- 13. Grants
-- -----------------------------------------------
GRANT EXECUTE ON FUNCTION public.get_permission_sets(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_permission_set(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_permission_set(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_permission_set(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_permission_set_entries(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_permission_entry(UUID, TEXT, UUID, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_permission_entry(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_permission_set(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_permission_set(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_permission_sets(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_effective_permissions() TO authenticated;
