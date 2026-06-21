-- ================================
-- Migration 203: Fix User Management RPC Functions
-- Re-applies get_tenant_users and get_pending_invitations
-- which were missing from the live Supabase schema cache.
-- ================================

-- Ensure the invitations table exists before creating functions that reference it
CREATE TABLE IF NOT EXISTS system.user_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  role TEXT DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  department TEXT,
  tenant_id UUID NOT NULL REFERENCES system.tenants(id) ON DELETE CASCADE,
  invitation_token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  invited_by UUID NOT NULL REFERENCES system.users(id),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES system.users(id),
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES system.users(id),
  cancellation_reason TEXT
);

ALTER TABLE system.user_invitations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'system' AND tablename = 'user_invitations' AND policyname = 'invitations_per_tenant_select'
  ) THEN
    CREATE POLICY "invitations_per_tenant_select" ON system.user_invitations
      FOR SELECT USING (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'system' AND tablename = 'user_invitations' AND policyname = 'invitations_per_tenant_insert'
  ) THEN
    CREATE POLICY "invitations_per_tenant_insert" ON system.user_invitations
      FOR INSERT WITH CHECK (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'system' AND tablename = 'user_invitations' AND policyname = 'invitations_per_tenant_update'
  ) THEN
    CREATE POLICY "invitations_per_tenant_update" ON system.user_invitations
      FOR UPDATE USING (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid)
      WITH CHECK (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'system' AND tablename = 'user_invitations' AND policyname = 'invitations_per_tenant_delete'
  ) THEN
    CREATE POLICY "invitations_per_tenant_delete" ON system.user_invitations
      FOR DELETE USING (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);
  END IF;
END $$;

-- Function: get all users for a tenant
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
  last_sign_in TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF (auth.jwt()->'app_metadata'->>'tenant_id')::uuid != p_tenant_id THEN
    RAISE EXCEPTION 'Access denied: Cannot access users from different tenant';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.email,
    u.first_name,
    u.last_name,
    u.role,
    u.department,
    u.is_active,
    u.created_at,
    au.last_sign_in_at
  FROM system.users u
  LEFT JOIN auth.users au ON u.id = au.id
  WHERE u.tenant_id = p_tenant_id
  ORDER BY u.created_at DESC;
END;
$$;

-- Function: get pending invitations for a tenant
CREATE OR REPLACE FUNCTION public.get_pending_invitations(p_tenant_id UUID)
RETURNS TABLE(
  id UUID,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  role TEXT,
  department TEXT,
  invited_by_email TEXT,
  status TEXT,
  created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF (auth.jwt()->'app_metadata'->>'tenant_id')::uuid != p_tenant_id THEN
    RAISE EXCEPTION 'Access denied: Cannot access invitations from different tenant';
  END IF;

  RETURN QUERY
  SELECT
    ui.id,
    ui.email,
    ui.first_name,
    ui.last_name,
    ui.role,
    ui.department,
    u.email AS invited_by_email,
    ui.status,
    ui.created_at,
    ui.expires_at
  FROM system.user_invitations ui
  LEFT JOIN system.users u ON ui.invited_by = u.id
  WHERE ui.tenant_id = p_tenant_id
    AND ui.status = 'pending'
    AND ui.expires_at > NOW()
  ORDER BY ui.created_at DESC;
END;
$$;

-- Function: invite a user
CREATE OR REPLACE FUNCTION public.invite_user(
  p_email TEXT,
  p_first_name TEXT,
  p_last_name TEXT,
  p_role TEXT DEFAULT 'user',
  p_department TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, message TEXT, invitation_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _tenant_id UUID;
  _invited_by UUID;
  _invitation_id UUID;
  _invitation_token TEXT;
BEGIN
  _tenant_id := (auth.jwt()->'app_metadata'->>'tenant_id')::uuid;
  _invited_by := auth.uid();

  IF _tenant_id IS NULL THEN
    RETURN QUERY SELECT false, 'User not associated with any tenant', NULL::UUID;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM system.users WHERE id = _invited_by AND tenant_id = _tenant_id AND role = 'admin'
  ) THEN
    RETURN QUERY SELECT false, 'Only admins can invite users', NULL::UUID;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM system.users WHERE email = p_email AND tenant_id = _tenant_id) THEN
    RETURN QUERY SELECT false, 'User already exists in this tenant', NULL::UUID;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM system.user_invitations
    WHERE email = p_email AND tenant_id = _tenant_id AND status = 'pending'
  ) THEN
    RETURN QUERY SELECT false, 'User already has a pending invitation', NULL::UUID;
    RETURN;
  END IF;

  _invitation_token := encode(gen_random_bytes(32), 'hex');

  INSERT INTO system.user_invitations (
    email, first_name, last_name, role, department, tenant_id,
    invitation_token, expires_at, invited_by, status
  ) VALUES (
    p_email, p_first_name, p_last_name, p_role, p_department, _tenant_id,
    _invitation_token, NOW() + INTERVAL '7 days', _invited_by, 'pending'
  ) RETURNING id INTO _invitation_id;

  RETURN QUERY SELECT true, 'User invited successfully', _invitation_id;
END;
$$;

-- Function: update user role
CREATE OR REPLACE FUNCTION public.update_user_role(p_user_id UUID, p_new_role TEXT)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _tenant_id UUID;
  _current_user_id UUID;
  _target_user_role TEXT;
BEGIN
  _tenant_id := (auth.jwt()->'app_metadata'->>'tenant_id')::uuid;
  _current_user_id := auth.uid();

  IF NOT EXISTS (SELECT 1 FROM system.users WHERE id = _current_user_id AND tenant_id = _tenant_id AND role = 'admin') THEN
    RETURN QUERY SELECT false, 'Only admins can update user roles';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM system.users WHERE id = p_user_id AND tenant_id = _tenant_id) THEN
    RETURN QUERY SELECT false, 'User not found in this tenant';
    RETURN;
  END IF;

  IF p_user_id = _current_user_id AND p_new_role != 'admin' THEN
    RETURN QUERY SELECT false, 'Cannot change your own role from admin';
    RETURN;
  END IF;

  SELECT role INTO _target_user_role FROM system.users WHERE id = p_user_id;

  IF _target_user_role = 'admin' AND p_new_role != 'admin' THEN
    IF (SELECT COUNT(*) FROM system.users WHERE tenant_id = _tenant_id AND role = 'admin') <= 1 THEN
      RETURN QUERY SELECT false, 'Cannot remove the last admin user';
      RETURN;
    END IF;
  END IF;

  UPDATE system.users SET role = p_new_role, updated_at = NOW() WHERE id = p_user_id;
  RETURN QUERY SELECT true, 'User role updated successfully';
END;
$$;

-- Function: toggle user active status
CREATE OR REPLACE FUNCTION public.toggle_user_status(p_user_id UUID, p_is_active BOOLEAN)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _tenant_id UUID;
  _current_user_id UUID;
  _target_user_role TEXT;
BEGIN
  _tenant_id := (auth.jwt()->'app_metadata'->>'tenant_id')::uuid;
  _current_user_id := auth.uid();

  IF NOT EXISTS (SELECT 1 FROM system.users WHERE id = _current_user_id AND tenant_id = _tenant_id AND role = 'admin') THEN
    RETURN QUERY SELECT false, 'Only admins can change user status';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM system.users WHERE id = p_user_id AND tenant_id = _tenant_id) THEN
    RETURN QUERY SELECT false, 'User not found in this tenant';
    RETURN;
  END IF;

  IF p_user_id = _current_user_id AND NOT p_is_active THEN
    RETURN QUERY SELECT false, 'Cannot deactivate your own account';
    RETURN;
  END IF;

  SELECT role INTO _target_user_role FROM system.users WHERE id = p_user_id;

  IF _target_user_role = 'admin' AND NOT p_is_active THEN
    IF (SELECT COUNT(*) FROM system.users WHERE tenant_id = _tenant_id AND role = 'admin' AND is_active = true) <= 1 THEN
      RETURN QUERY SELECT false, 'Cannot deactivate the last admin user';
      RETURN;
    END IF;
  END IF;

  UPDATE system.users SET is_active = p_is_active, updated_at = NOW() WHERE id = p_user_id;
  RETURN QUERY SELECT true, CASE WHEN p_is_active THEN 'User activated successfully' ELSE 'User deactivated successfully' END;
END;
$$;

-- Function: cancel an invitation
CREATE OR REPLACE FUNCTION public.cancel_invitation(p_invitation_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _tenant_id UUID;
  _current_user_id UUID;
  _invitation_tenant_id UUID;
BEGIN
  _tenant_id := (auth.jwt()->'app_metadata'->>'tenant_id')::uuid;
  _current_user_id := auth.uid();

  IF NOT EXISTS (SELECT 1 FROM system.users WHERE id = _current_user_id AND tenant_id = _tenant_id AND role = 'admin') THEN
    RETURN QUERY SELECT false, 'Only admins can cancel invitations';
    RETURN;
  END IF;

  SELECT tenant_id INTO _invitation_tenant_id FROM system.user_invitations WHERE id = p_invitation_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Invitation not found';
    RETURN;
  END IF;

  IF _invitation_tenant_id != _tenant_id THEN
    RETURN QUERY SELECT false, 'Cannot cancel invitation from different tenant';
    RETURN;
  END IF;

  UPDATE system.user_invitations
  SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = _current_user_id, cancellation_reason = p_reason
  WHERE id = p_invitation_id;

  RETURN QUERY SELECT true, 'Invitation cancelled successfully';
END;
$$;

-- Function: resend an invitation
CREATE OR REPLACE FUNCTION public.resend_invitation(p_invitation_id UUID)
RETURNS TABLE(success BOOLEAN, message TEXT, new_token TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _tenant_id UUID;
  _current_user_id UUID;
  _invitation_record RECORD;
  _new_token TEXT;
BEGIN
  _tenant_id := (auth.jwt()->'app_metadata'->>'tenant_id')::uuid;
  _current_user_id := auth.uid();

  IF NOT EXISTS (SELECT 1 FROM system.users WHERE id = _current_user_id AND tenant_id = _tenant_id AND role = 'admin') THEN
    RETURN QUERY SELECT false, 'Only admins can resend invitations', NULL::TEXT;
    RETURN;
  END IF;

  SELECT * INTO _invitation_record FROM system.user_invitations WHERE id = p_invitation_id AND tenant_id = _tenant_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Invitation not found', NULL::TEXT;
    RETURN;
  END IF;

  IF _invitation_record.status != 'pending' THEN
    RETURN QUERY SELECT false, 'Cannot resend non-pending invitation', NULL::TEXT;
    RETURN;
  END IF;

  _new_token := encode(gen_random_bytes(32), 'hex');

  UPDATE system.user_invitations
  SET invitation_token = _new_token, expires_at = NOW() + INTERVAL '7 days', updated_at = NOW()
  WHERE id = p_invitation_id;

  RETURN QUERY SELECT true, 'Invitation resent successfully', _new_token;
END;
$$;

-- Ensure is_active column exists on system.users (added in earlier migrations)
ALTER TABLE system.users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE system.users ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE system.users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_invitations_email_tenant ON system.user_invitations(email, tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_invitations_token ON system.user_invitations(invitation_token);
CREATE INDEX IF NOT EXISTS idx_user_invitations_status_tenant ON system.user_invitations(status, tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_invitations_expires ON system.user_invitations(expires_at);

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.get_tenant_users(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_invitations(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_user(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_user_role(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_user_status(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_invitation(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resend_invitation(UUID) TO authenticated;
