-- ================================
-- Migration 236: Fix missing validate_invitation + broken invitation RLS
--
-- Two separate pre-existing gaps found while setting up test accounts:
--
-- 1. public.validate_invitation(TEXT) was defined once in migration 138 and
--    never recreated by any later migration. Migrations 203/205/206 re-applied
--    every other function from 138 (get_pending_invitations, invite_user,
--    update_user_role, toggle_user_status, cancel_invitation, resend_invitation)
--    after noticing THOSE were missing from the live schema cache — but nobody
--    exercised the actual /invite acceptance page at the time, so this one
--    slipped through and was never restored. The invite page's first step
--    ("Validate Invitation") has been broken ever since:
--      "Could not find the function public.validate_invitation(p_token) in
--       the schema cache"
--
-- 2. The 4 RLS policies on system.user_invitations still check
--    (auth.jwt()->'app_metadata'->>'tenant_id') — a claim this app has never
--    actually populated (confirmed: SupabaseProvider.tsx resolves tenant_id by
--    querying system.users directly, never from a JWT claim; migration 205's
--    own header already documented this exact root cause when fixing the RPCs,
--    but the RLS policies on this table were never updated to match). This
--    silently blocks UserManagement.tsx's own client-side SELECT that shows
--    the invite link in the admin modal after creating an invitation — it
--    fails with zero visible error (caught by a bare `catch {}` in the
--    component) and nobody notices the invite was even created successfully.
--
-- accept_invitation (migration 210, the live version) is unaffected by either
-- issue — it takes tenant_id from the invitation row itself, not a JWT claim.
-- ================================

-- -----------------------------------------------
-- 1. Recreate validate_invitation (unchanged from migration 138 — it was
--    correct, just missing)
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_invitation(p_token TEXT)
RETURNS TABLE(
  valid BOOLEAN,
  message TEXT,
  invitation JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _invitation_record RECORD;
BEGIN
  SELECT * INTO _invitation_record
  FROM system.user_invitations
  WHERE invitation_token = p_token;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Invalid invitation token', NULL::JSONB;
    RETURN;
  END IF;

  IF _invitation_record.expires_at < NOW() THEN
    UPDATE system.user_invitations
    SET status = 'expired'
    WHERE id = _invitation_record.id;

    RETURN QUERY SELECT false, 'Invitation has expired', NULL::JSONB;
    RETURN;
  END IF;

  IF _invitation_record.status != 'pending' THEN
    RETURN QUERY SELECT false,
      CASE
        WHEN _invitation_record.status = 'accepted' THEN 'Invitation already accepted'
        WHEN _invitation_record.status = 'cancelled' THEN 'Invitation was cancelled'
        ELSE 'Invitation is not valid'
      END,
      NULL::JSONB;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, 'Invitation is valid',
    jsonb_build_object(
      'id', _invitation_record.id,
      'email', _invitation_record.email,
      'first_name', _invitation_record.first_name,
      'last_name', _invitation_record.last_name,
      'role', _invitation_record.role,
      'department', _invitation_record.department,
      'tenant_id', _invitation_record.tenant_id,
      'expires_at', _invitation_record.expires_at,
      'tenant_name', (SELECT name FROM system.tenants WHERE id = _invitation_record.tenant_id)
    );
END;
$$;

-- Must be callable unauthenticated — the invite page has no session yet
-- when validating a token.
GRANT EXECUTE ON FUNCTION public.validate_invitation(TEXT) TO anon, authenticated;

-- -----------------------------------------------
-- 2. Fix the 4 RLS policies to resolve tenant_id from system.users,
--    matching every other working policy in this app (e.g. tenant.roles'
--    roles_tenant_select in migration 207), instead of the JWT claim that's
--    never populated.
-- -----------------------------------------------
DROP POLICY IF EXISTS "invitations_per_tenant_select" ON system.user_invitations;
DROP POLICY IF EXISTS "invitations_per_tenant_insert" ON system.user_invitations;
DROP POLICY IF EXISTS "invitations_per_tenant_update" ON system.user_invitations;
DROP POLICY IF EXISTS "invitations_per_tenant_delete" ON system.user_invitations;

CREATE POLICY "invitations_per_tenant_select" ON system.user_invitations
  FOR SELECT USING (
    tenant_id = (SELECT su.tenant_id FROM system.users su WHERE su.id = auth.uid())
  );

CREATE POLICY "invitations_per_tenant_insert" ON system.user_invitations
  FOR INSERT WITH CHECK (
    tenant_id = (SELECT su.tenant_id FROM system.users su WHERE su.id = auth.uid())
  );

CREATE POLICY "invitations_per_tenant_update" ON system.user_invitations
  FOR UPDATE USING (
    tenant_id = (SELECT su.tenant_id FROM system.users su WHERE su.id = auth.uid())
  )
  WITH CHECK (
    tenant_id = (SELECT su.tenant_id FROM system.users su WHERE su.id = auth.uid())
  );

CREATE POLICY "invitations_per_tenant_delete" ON system.user_invitations
  FOR DELETE USING (
    tenant_id = (SELECT su.tenant_id FROM system.users su WHERE su.id = auth.uid())
  );
