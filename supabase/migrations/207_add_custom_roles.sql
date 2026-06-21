-- ================================
-- Migration 207: Custom Roles
--
-- Adds tenant.roles table for named custom roles (e.g. Manager, Sales Rep).
-- These are display/grouping labels independent of the system admin/user roles.
-- Also adds custom_role_id to system.users and updates get_tenant_users to return it.
-- ================================

-- -----------------------------------------------
-- 1. tenant.roles table
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS tenant.roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES system.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, name)
);

ALTER TABLE tenant.roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "roles_tenant_select" ON tenant.roles
  FOR SELECT USING (
    tenant_id = (SELECT su.tenant_id FROM system.users su WHERE su.id = auth.uid())
  );

CREATE POLICY "roles_tenant_insert" ON tenant.roles
  FOR INSERT WITH CHECK (
    tenant_id = (SELECT su.tenant_id FROM system.users su WHERE su.id = auth.uid())
  );

CREATE POLICY "roles_tenant_update" ON tenant.roles
  FOR UPDATE USING (
    tenant_id = (SELECT su.tenant_id FROM system.users su WHERE su.id = auth.uid())
  );

CREATE POLICY "roles_tenant_delete" ON tenant.roles
  FOR DELETE USING (
    tenant_id = (SELECT su.tenant_id FROM system.users su WHERE su.id = auth.uid())
  );

-- -----------------------------------------------
-- 2. Link custom_role_id to system.users
-- -----------------------------------------------
ALTER TABLE system.users ADD COLUMN IF NOT EXISTS custom_role_id UUID REFERENCES tenant.roles(id) ON DELETE SET NULL;

-- -----------------------------------------------
-- 3. get_tenant_roles — list all custom roles for a tenant
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION public.get_tenant_roles(p_tenant_id UUID)
RETURNS TABLE(
  id UUID,
  name TEXT,
  description TEXT,
  user_count BIGINT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _caller_tenant_id UUID;
BEGIN
  SELECT su.tenant_id INTO _caller_tenant_id
  FROM system.users su WHERE su.id = auth.uid();

  IF _caller_tenant_id IS NULL OR _caller_tenant_id != p_tenant_id THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.name::TEXT,
    r.description::TEXT,
    COUNT(su.id) AS user_count,
    r.created_at
  FROM tenant.roles r
  LEFT JOIN system.users su ON su.custom_role_id = r.id AND su.tenant_id = p_tenant_id
  WHERE r.tenant_id = p_tenant_id
  ORDER BY r.name;
END;
$$;

-- -----------------------------------------------
-- 4. create_tenant_role
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION public.create_tenant_role(
  p_tenant_id UUID,
  p_name TEXT,
  p_description TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, message TEXT, role_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _caller_tenant_id UUID;
  _caller_id UUID;
  _new_id UUID;
BEGIN
  _caller_id := auth.uid();
  SELECT su.tenant_id INTO _caller_tenant_id FROM system.users su WHERE su.id = _caller_id;

  IF _caller_tenant_id IS NULL OR _caller_tenant_id != p_tenant_id THEN
    RETURN QUERY SELECT false, 'Access denied', NULL::UUID; RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM system.users su WHERE su.id = _caller_id AND su.role = 'admin') THEN
    RETURN QUERY SELECT false, 'Only admins can create roles', NULL::UUID; RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM tenant.roles r WHERE r.tenant_id = p_tenant_id AND lower(r.name) = lower(p_name)) THEN
    RETURN QUERY SELECT false, 'A role with this name already exists', NULL::UUID; RETURN;
  END IF;

  INSERT INTO tenant.roles(tenant_id, name, description)
  VALUES (p_tenant_id, p_name, p_description)
  RETURNING tenant.roles.id INTO _new_id;

  RETURN QUERY SELECT true, 'Role created successfully', _new_id;
END;
$$;

-- -----------------------------------------------
-- 5. update_tenant_role
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION public.update_tenant_role(
  p_role_id UUID,
  p_name TEXT,
  p_description TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _caller_tenant_id UUID;
  _caller_id UUID;
  _role_tenant_id UUID;
BEGIN
  _caller_id := auth.uid();
  SELECT su.tenant_id INTO _caller_tenant_id FROM system.users su WHERE su.id = _caller_id;

  SELECT r.tenant_id INTO _role_tenant_id FROM tenant.roles r WHERE r.id = p_role_id;

  IF NOT FOUND OR _caller_tenant_id != _role_tenant_id THEN
    RETURN QUERY SELECT false, 'Role not found'; RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM system.users su WHERE su.id = _caller_id AND su.role = 'admin') THEN
    RETURN QUERY SELECT false, 'Only admins can update roles'; RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM tenant.roles r
    WHERE r.tenant_id = _role_tenant_id AND lower(r.name) = lower(p_name) AND r.id != p_role_id
  ) THEN
    RETURN QUERY SELECT false, 'A role with this name already exists'; RETURN;
  END IF;

  UPDATE tenant.roles r SET name = p_name, description = p_description, updated_at = NOW()
  WHERE r.id = p_role_id;

  RETURN QUERY SELECT true, 'Role updated successfully';
END;
$$;

-- -----------------------------------------------
-- 6. delete_tenant_role
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_tenant_role(p_role_id UUID)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _caller_tenant_id UUID;
  _caller_id UUID;
  _role_tenant_id UUID;
BEGIN
  _caller_id := auth.uid();
  SELECT su.tenant_id INTO _caller_tenant_id FROM system.users su WHERE su.id = _caller_id;

  SELECT r.tenant_id INTO _role_tenant_id FROM tenant.roles r WHERE r.id = p_role_id;

  IF NOT FOUND OR _caller_tenant_id != _role_tenant_id THEN
    RETURN QUERY SELECT false, 'Role not found'; RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM system.users su WHERE su.id = _caller_id AND su.role = 'admin') THEN
    RETURN QUERY SELECT false, 'Only admins can delete roles'; RETURN;
  END IF;

  -- Unassign role from all users first (ON DELETE SET NULL handles it, but be explicit)
  UPDATE system.users su SET custom_role_id = NULL WHERE su.custom_role_id = p_role_id;

  DELETE FROM tenant.roles r WHERE r.id = p_role_id;

  RETURN QUERY SELECT true, 'Role deleted successfully';
END;
$$;

-- -----------------------------------------------
-- 7. assign_user_role — assign a custom role to a user
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_user_role(
  p_user_id UUID,
  p_role_id UUID  -- pass NULL to unassign
)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _caller_tenant_id UUID;
  _caller_id UUID;
  _target_tenant_id UUID;
  _role_tenant_id UUID;
BEGIN
  _caller_id := auth.uid();
  SELECT su.tenant_id INTO _caller_tenant_id FROM system.users su WHERE su.id = _caller_id;

  IF NOT EXISTS (SELECT 1 FROM system.users su WHERE su.id = _caller_id AND su.role = 'admin') THEN
    RETURN QUERY SELECT false, 'Only admins can assign roles'; RETURN;
  END IF;

  SELECT su.tenant_id INTO _target_tenant_id FROM system.users su WHERE su.id = p_user_id;

  IF _target_tenant_id IS NULL OR _target_tenant_id != _caller_tenant_id THEN
    RETURN QUERY SELECT false, 'User not found in this tenant'; RETURN;
  END IF;

  IF p_role_id IS NOT NULL THEN
    SELECT r.tenant_id INTO _role_tenant_id FROM tenant.roles r WHERE r.id = p_role_id;
    IF _role_tenant_id IS NULL OR _role_tenant_id != _caller_tenant_id THEN
      RETURN QUERY SELECT false, 'Role not found in this tenant'; RETURN;
    END IF;
  END IF;

  UPDATE system.users su SET custom_role_id = p_role_id, updated_at = NOW() WHERE su.id = p_user_id;

  RETURN QUERY SELECT true, 'Role assigned successfully';
END;
$$;

-- -----------------------------------------------
-- 8. Update get_tenant_users to include custom role
-- Must drop first because return type is changing
-- -----------------------------------------------
DROP FUNCTION IF EXISTS public.get_tenant_users(UUID);

CREATE OR REPLACE FUNCTION public.get_tenant_users(p_tenant_id UUID)
RETURNS TABLE(
  id UUID,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  role TEXT,
  department TEXT,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  last_sign_in TIMESTAMPTZ,
  custom_role_id UUID,
  custom_role_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _caller_tenant_id UUID;
BEGIN
  SELECT su.tenant_id INTO _caller_tenant_id
  FROM system.users su WHERE su.id = auth.uid();

  IF _caller_tenant_id IS NULL OR _caller_tenant_id != p_tenant_id THEN
    RAISE EXCEPTION 'Access denied: Cannot access users from different tenant';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.email::TEXT,
    u.first_name::TEXT,
    u.last_name::TEXT,
    u.role::TEXT,
    u.department::TEXT,
    u.is_active,
    u.created_at,
    au.last_sign_in_at,
    u.custom_role_id,
    r.name::TEXT AS custom_role_name
  FROM system.users u
  LEFT JOIN auth.users au ON au.id = u.id
  LEFT JOIN tenant.roles r ON r.id = u.custom_role_id
  WHERE u.tenant_id = p_tenant_id
  ORDER BY u.created_at DESC;
END;
$$;

-- -----------------------------------------------
-- 9. Grants
-- -----------------------------------------------
GRANT EXECUTE ON FUNCTION public.get_tenant_roles(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_tenant_role(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_tenant_role(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_tenant_role(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_user_role(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_users(UUID) TO authenticated;

CREATE INDEX IF NOT EXISTS idx_tenant_roles_tenant ON tenant.roles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_custom_role ON system.users(custom_role_id);
