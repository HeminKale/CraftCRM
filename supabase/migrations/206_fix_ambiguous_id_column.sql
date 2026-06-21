-- ================================
-- Migration 206: Fix ambiguous "id" column reference
--
-- RETURNS TABLE declares an output column named "id", so any bare
-- WHERE id = ... inside the function body is ambiguous between the
-- output column and the table column. Fix: qualify with table alias.
-- ================================

-- -----------------------------------------------
-- get_tenant_users
-- -----------------------------------------------
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
DECLARE
  _caller_tenant_id UUID;
BEGIN
  SELECT su.tenant_id INTO _caller_tenant_id
  FROM system.users su
  WHERE su.id = auth.uid();

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
    au.last_sign_in_at
  FROM system.users u
  LEFT JOIN auth.users au ON au.id = u.id
  WHERE u.tenant_id = p_tenant_id
  ORDER BY u.created_at DESC;
END;
$$;

-- -----------------------------------------------
-- get_pending_invitations
-- -----------------------------------------------
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
DECLARE
  _caller_tenant_id UUID;
BEGIN
  SELECT su.tenant_id INTO _caller_tenant_id
  FROM system.users su
  WHERE su.id = auth.uid();

  IF _caller_tenant_id IS NULL OR _caller_tenant_id != p_tenant_id THEN
    RAISE EXCEPTION 'Access denied: Cannot access invitations from different tenant';
  END IF;

  RETURN QUERY
  SELECT
    ui.id,
    ui.email::TEXT,
    ui.first_name::TEXT,
    ui.last_name::TEXT,
    ui.role::TEXT,
    ui.department::TEXT,
    u.email::TEXT AS invited_by_email,
    ui.status::TEXT,
    ui.created_at,
    ui.expires_at
  FROM system.user_invitations ui
  LEFT JOIN system.users u ON u.id = ui.invited_by
  WHERE ui.tenant_id = p_tenant_id
    AND ui.status = 'pending'
    AND ui.expires_at > NOW()
  ORDER BY ui.created_at DESC;
END;
$$;

-- -----------------------------------------------
-- invite_user
-- -----------------------------------------------
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
  _invitation_token TEXT;
  _invitation_id UUID;
BEGIN
  _invited_by := auth.uid();

  SELECT su.tenant_id INTO _tenant_id
  FROM system.users su
  WHERE su.id = _invited_by;

  IF _tenant_id IS NULL THEN
    RETURN QUERY SELECT false, 'User not associated with any tenant', NULL::UUID;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM system.users su
    WHERE su.id = _invited_by AND su.tenant_id = _tenant_id AND su.role = 'admin'
  ) THEN
    RETURN QUERY SELECT false, 'Only admins can invite users', NULL::UUID;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM system.users su
    WHERE su.email = p_email AND su.tenant_id = _tenant_id
  ) THEN
    RETURN QUERY SELECT false, 'User already exists in this tenant', NULL::UUID;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM system.user_invitations ui
    WHERE ui.email = p_email AND ui.tenant_id = _tenant_id AND ui.status = 'pending'
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
  ) RETURNING system.user_invitations.id INTO _invitation_id;

  RETURN QUERY SELECT true, 'User invited successfully', _invitation_id;
END;
$$;

-- -----------------------------------------------
-- update_user_role
-- -----------------------------------------------
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
  _current_user_id := auth.uid();

  SELECT su.tenant_id INTO _tenant_id
  FROM system.users su
  WHERE su.id = _current_user_id;

  IF _tenant_id IS NULL THEN
    RETURN QUERY SELECT false, 'User not associated with any tenant';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM system.users su
    WHERE su.id = _current_user_id AND su.tenant_id = _tenant_id AND su.role = 'admin'
  ) THEN
    RETURN QUERY SELECT false, 'Only admins can update user roles';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM system.users su
    WHERE su.id = p_user_id AND su.tenant_id = _tenant_id
  ) THEN
    RETURN QUERY SELECT false, 'User not found in this tenant';
    RETURN;
  END IF;

  IF p_user_id = _current_user_id AND p_new_role != 'admin' THEN
    RETURN QUERY SELECT false, 'Cannot change your own role from admin';
    RETURN;
  END IF;

  SELECT su.role INTO _target_user_role FROM system.users su WHERE su.id = p_user_id;

  IF _target_user_role = 'admin' AND p_new_role != 'admin' THEN
    IF (SELECT COUNT(*) FROM system.users su WHERE su.tenant_id = _tenant_id AND su.role = 'admin') <= 1 THEN
      RETURN QUERY SELECT false, 'Cannot remove the last admin user';
      RETURN;
    END IF;
  END IF;

  UPDATE system.users su SET role = p_new_role, updated_at = NOW() WHERE su.id = p_user_id;
  RETURN QUERY SELECT true, 'User role updated successfully';
END;
$$;

-- -----------------------------------------------
-- toggle_user_status
-- -----------------------------------------------
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
  _current_user_id := auth.uid();

  SELECT su.tenant_id INTO _tenant_id
  FROM system.users su
  WHERE su.id = _current_user_id;

  IF _tenant_id IS NULL THEN
    RETURN QUERY SELECT false, 'User not associated with any tenant';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM system.users su
    WHERE su.id = _current_user_id AND su.tenant_id = _tenant_id AND su.role = 'admin'
  ) THEN
    RETURN QUERY SELECT false, 'Only admins can change user status';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM system.users su
    WHERE su.id = p_user_id AND su.tenant_id = _tenant_id
  ) THEN
    RETURN QUERY SELECT false, 'User not found in this tenant';
    RETURN;
  END IF;

  IF p_user_id = _current_user_id AND NOT p_is_active THEN
    RETURN QUERY SELECT false, 'Cannot deactivate your own account';
    RETURN;
  END IF;

  SELECT su.role INTO _target_user_role FROM system.users su WHERE su.id = p_user_id;

  IF _target_user_role = 'admin' AND NOT p_is_active THEN
    IF (SELECT COUNT(*) FROM system.users su
        WHERE su.tenant_id = _tenant_id AND su.role = 'admin' AND su.is_active = true) <= 1 THEN
      RETURN QUERY SELECT false, 'Cannot deactivate the last admin user';
      RETURN;
    END IF;
  END IF;

  UPDATE system.users su SET is_active = p_is_active, updated_at = NOW() WHERE su.id = p_user_id;
  RETURN QUERY SELECT true,
    CASE WHEN p_is_active THEN 'User activated successfully' ELSE 'User deactivated successfully' END;
END;
$$;

-- -----------------------------------------------
-- cancel_invitation
-- -----------------------------------------------
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
  _current_user_id := auth.uid();

  SELECT su.tenant_id INTO _tenant_id
  FROM system.users su
  WHERE su.id = _current_user_id;

  IF _tenant_id IS NULL THEN
    RETURN QUERY SELECT false, 'User not associated with any tenant';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM system.users su
    WHERE su.id = _current_user_id AND su.tenant_id = _tenant_id AND su.role = 'admin'
  ) THEN
    RETURN QUERY SELECT false, 'Only admins can cancel invitations';
    RETURN;
  END IF;

  SELECT ui.tenant_id INTO _invitation_tenant_id
  FROM system.user_invitations ui
  WHERE ui.id = p_invitation_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Invitation not found';
    RETURN;
  END IF;

  IF _invitation_tenant_id != _tenant_id THEN
    RETURN QUERY SELECT false, 'Cannot cancel invitation from different tenant';
    RETURN;
  END IF;

  UPDATE system.user_invitations ui
  SET status = 'cancelled', cancelled_at = NOW(),
      cancelled_by = _current_user_id, cancellation_reason = p_reason
  WHERE ui.id = p_invitation_id;

  RETURN QUERY SELECT true, 'Invitation cancelled successfully';
END;
$$;

-- -----------------------------------------------
-- resend_invitation
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION public.resend_invitation(p_invitation_id UUID)
RETURNS TABLE(success BOOLEAN, message TEXT, new_token TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _tenant_id UUID;
  _current_user_id UUID;
  _inv_status TEXT;
  _new_token TEXT;
BEGIN
  _current_user_id := auth.uid();

  SELECT su.tenant_id INTO _tenant_id
  FROM system.users su
  WHERE su.id = _current_user_id;

  IF _tenant_id IS NULL THEN
    RETURN QUERY SELECT false, 'User not associated with any tenant', NULL::TEXT;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM system.users su
    WHERE su.id = _current_user_id AND su.tenant_id = _tenant_id AND su.role = 'admin'
  ) THEN
    RETURN QUERY SELECT false, 'Only admins can resend invitations', NULL::TEXT;
    RETURN;
  END IF;

  SELECT ui.status INTO _inv_status
  FROM system.user_invitations ui
  WHERE ui.id = p_invitation_id AND ui.tenant_id = _tenant_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Invitation not found', NULL::TEXT;
    RETURN;
  END IF;

  IF _inv_status != 'pending' THEN
    RETURN QUERY SELECT false, 'Cannot resend non-pending invitation', NULL::TEXT;
    RETURN;
  END IF;

  _new_token := encode(gen_random_bytes(32), 'hex');

  UPDATE system.user_invitations ui
  SET invitation_token = _new_token,
      expires_at = NOW() + INTERVAL '7 days',
      updated_at = NOW()
  WHERE ui.id = p_invitation_id;

  RETURN QUERY SELECT true, 'Invitation resent successfully', _new_token;
END;
$$;

-- -----------------------------------------------
-- Grants
-- -----------------------------------------------
GRANT EXECUTE ON FUNCTION public.get_tenant_users(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_invitations(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_user(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_user_role(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_user_status(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_invitation(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resend_invitation(UUID) TO authenticated;
