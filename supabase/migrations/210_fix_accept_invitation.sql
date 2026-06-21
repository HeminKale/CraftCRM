-- ================================
-- Migration 210: Fix accept_invitation
--
-- The old RPC created a system.users row with gen_random_uuid() as the id,
-- but never created an auth.users entry. The invited user had no Supabase
-- auth account and could not sign in.
--
-- New approach:
--   1. Server-side API route creates auth.users via service role key,
--      gets back the real auth UUID.
--   2. API route calls this updated RPC with that UUID.
--   3. RPC creates system.users with the correct matching id,
--      marks invitation accepted.
--
-- The p_password param is removed — password is set by the API route
-- via auth.admin.createUser() before this RPC is called.
-- ================================

CREATE OR REPLACE FUNCTION public.accept_invitation(
  p_token      TEXT,
  p_auth_user_id UUID,   -- UUID from auth.users, created by API route
  p_first_name TEXT DEFAULT NULL,
  p_last_name  TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, message TEXT, user_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _inv RECORD;
BEGIN
  -- Fetch and validate invitation
  SELECT * INTO _inv
  FROM system.user_invitations
  WHERE invitation_token = p_token AND status = 'pending';

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Invalid or expired invitation', NULL::UUID;
    RETURN;
  END IF;

  IF _inv.expires_at < NOW() THEN
    UPDATE system.user_invitations SET status = 'expired' WHERE id = _inv.id;
    RETURN QUERY SELECT false, 'Invitation has expired', NULL::UUID;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM system.users su
    WHERE su.email = _inv.email AND su.tenant_id = _inv.tenant_id
  ) THEN
    RETURN QUERY SELECT false, 'User already exists with this email', NULL::UUID;
    RETURN;
  END IF;

  -- Create system.users row using the auth UUID so they match
  INSERT INTO system.users (
    id, email, first_name, last_name, role, department,
    tenant_id, is_active, created_at, updated_at
  ) VALUES (
    p_auth_user_id,
    _inv.email,
    COALESCE(p_first_name, _inv.first_name),
    COALESCE(p_last_name,  _inv.last_name),
    _inv.role,
    _inv.department,
    _inv.tenant_id,
    true,
    NOW(),
    NOW()
  );

  -- Mark invitation accepted
  UPDATE system.user_invitations
  SET status      = 'accepted',
      accepted_at = NOW(),
      accepted_by = p_auth_user_id
  WHERE id = _inv.id;

  RETURN QUERY SELECT true, 'Account created successfully', p_auth_user_id;
END;
$$;

-- Keep anon access so the invite page (unauthenticated) can call it
GRANT EXECUTE ON FUNCTION public.accept_invitation(TEXT, UUID, TEXT, TEXT) TO anon, authenticated;

-- Drop the old signature so it doesn't create confusion
DROP FUNCTION IF EXISTS public.accept_invitation(TEXT, TEXT, TEXT, TEXT);
