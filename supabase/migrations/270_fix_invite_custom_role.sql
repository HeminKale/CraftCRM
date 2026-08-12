-- ============================================================
-- Migration 270: Fix invite flow — custom role picker was a no-op
--
-- Traced end-to-end this session (Setup > Users and Roles > Invite User):
-- the modal's "Role" dropdown (tenant.roles — CRM Office/Auditor/
-- Tech reviewer/CDC/External Customer) captures a selection into React
-- state, but it was never actually wired anywhere:
--   1. UserManagement.tsx's handleInviteUser never included it in the
--      invite_user RPC call.
--   2. invite_user(p_email, p_first_name, p_last_name, p_role,
--      p_department) — migration 206, still the live definition before
--      this one — has no parameter to receive it at all.
--   3. system.user_invitations (migration 138, never altered since) has
--      no column to persist it on even if it were passed.
--   4. accept_invitation (migration 210, still live) creates the new
--      system.users row straight from the invitation's role/department —
--      never touches custom_role_id, so it lands NULL regardless.
--
-- Net effect: picking "CDC" (or any custom role) in the invite modal
-- silently does nothing. The invitation still succeeds, the invitee still
-- gets an account — just with no custom role, discovered only by noticing
-- a blank "Role" column in the Users list afterward. The only way
-- custom_role_id has ever actually gotten set is the SEPARATE per-user
-- "Assign Role" control (assign_user_role, migration 207) available only
-- after a user already exists.
--
-- Fix, three coordinated parts so the modal's picker actually works in one
-- step going forward — not the two-step invite-then-assign workaround:
--   1. ALTER system.user_invitations: add custom_role_id UUID (nullable,
--      matches the modal's "— None —" option).
--   2. invite_user: new optional p_custom_role_id param (DEFAULT NULL,
--      appended last so nothing about the existing 5-arg call shape
--      changes for backward compatibility beyond needing the new arg to
--      be passed). Validates the role belongs to the caller's own tenant
--      before accepting it — same check assign_user_role already does,
--      not a new invention.
--   3. accept_invitation: copies _inv.custom_role_id onto the new
--      system.users row.
--
-- Frontend fix (UserManagement.tsx) ships alongside this migration, not
-- separately — see that file's diff for the one-line RPC-call change.
-- ============================================================

-- ── 1. New column ────────────────────────────────────────────────────
ALTER TABLE system.user_invitations
  ADD COLUMN IF NOT EXISTS custom_role_id UUID REFERENCES tenant.roles(id);

-- ── 2. invite_user (REDEFINED — adds p_custom_role_id) ────────────────
DROP FUNCTION IF EXISTS public.invite_user(TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.invite_user(
  p_email          TEXT,
  p_first_name     TEXT,
  p_last_name      TEXT,
  p_role           TEXT DEFAULT 'user',
  p_department     TEXT DEFAULT NULL,
  p_custom_role_id UUID DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, message TEXT, invitation_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _tenant_id        UUID;
  _invited_by       UUID;
  _invitation_token TEXT;
  _invitation_id    UUID;
  _role_tenant_id   UUID;
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

  -- Same tenant-ownership check assign_user_role already does for the
  -- post-acceptance path (207) — a role id from another tenant (or a
  -- stale/deleted one) is rejected here instead of silently accepted and
  -- failing the FK at INSERT time with a less useful error.
  IF p_custom_role_id IS NOT NULL THEN
    SELECT r.tenant_id INTO _role_tenant_id FROM tenant.roles r WHERE r.id = p_custom_role_id;
    IF _role_tenant_id IS NULL OR _role_tenant_id != _tenant_id THEN
      RETURN QUERY SELECT false, 'Role not found in this tenant', NULL::UUID;
      RETURN;
    END IF;
  END IF;

  _invitation_token := encode(gen_random_bytes(32), 'hex');

  INSERT INTO system.user_invitations (
    email, first_name, last_name, role, department, custom_role_id, tenant_id,
    invitation_token, expires_at, invited_by, status
  ) VALUES (
    p_email, p_first_name, p_last_name, p_role, p_department, p_custom_role_id, _tenant_id,
    _invitation_token, NOW() + INTERVAL '7 days', _invited_by, 'pending'
  ) RETURNING system.user_invitations.id INTO _invitation_id;

  RETURN QUERY SELECT true, 'User invited successfully', _invitation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.invite_user(TEXT, TEXT, TEXT, TEXT, TEXT, UUID) TO authenticated;

-- ── 3. accept_invitation (REDEFINED — copies custom_role_id onto the new
-- system.users row) ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.accept_invitation(
  p_token        TEXT,
  p_auth_user_id UUID,   -- UUID from auth.users, created by API route
  p_first_name   TEXT DEFAULT NULL,
  p_last_name    TEXT DEFAULT NULL
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

  -- Create system.users row using the auth UUID so they match. custom_role_id
  -- now copied from the invitation (270) — previously always landed NULL
  -- regardless of what was picked in the invite modal.
  INSERT INTO system.users (
    id, email, first_name, last_name, role, department, custom_role_id,
    tenant_id, is_active, created_at, updated_at
  ) VALUES (
    p_auth_user_id,
    _inv.email,
    COALESCE(p_first_name, _inv.first_name),
    COALESCE(p_last_name,  _inv.last_name),
    _inv.role,
    _inv.department,
    _inv.custom_role_id,
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
