-- ================================
-- Migration 138: User Invitations Table
-- Craft App - User Invitation System
-- ================================

-- ===========================================
-- 1. CREATE USER INVITATIONS TABLE
-- ===========================================

-- Table to track user invitations
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
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES system.users(id),
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES system.users(id),
  cancellation_reason TEXT
);

-- Enable RLS for user invitations
ALTER TABLE system.user_invitations ENABLE ROW LEVEL SECURITY;

-- RLS policies for multi-tenant isolation
CREATE POLICY "invitations_per_tenant_select" ON system.user_invitations
  FOR SELECT USING (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);

CREATE POLICY "invitations_per_tenant_insert" ON system.user_invitations
  FOR INSERT WITH CHECK (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);

CREATE POLICY "invitations_per_tenant_update" ON system.user_invitations
  FOR UPDATE USING (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);

CREATE POLICY "invitations_per_tenant_delete" ON system.user_invitations
  FOR DELETE USING (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);

-- ===========================================
-- 2. INVITATION MANAGEMENT FUNCTIONS
-- ===========================================

-- Function to validate an invitation token
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
  -- Find the invitation by token
  SELECT * INTO _invitation_record
  FROM system.user_invitations
  WHERE invitation_token = p_token;
  
  -- Check if invitation exists
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Invalid invitation token', NULL::JSONB;
    RETURN;
  END IF;
  
  -- Check if invitation is expired
  IF _invitation_record.expires_at < NOW() THEN
    -- Mark as expired
    UPDATE system.user_invitations 
    SET status = 'expired' 
    WHERE id = _invitation_record.id;
    
    RETURN QUERY SELECT false, 'Invitation has expired', NULL::JSONB;
    RETURN;
  END IF;
  
  -- Check if invitation is already accepted or cancelled
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
  
  -- Return valid invitation
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

-- Function to accept an invitation
CREATE OR REPLACE FUNCTION public.accept_invitation(
  p_token TEXT,
  p_password TEXT,
  p_first_name TEXT DEFAULT NULL,
  p_last_name TEXT DEFAULT NULL
)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT,
  user_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _invitation_record RECORD;
  _new_user_id UUID;
  _tenant_id UUID;
BEGIN
  -- Validate the invitation first
  SELECT * INTO _invitation_record
  FROM system.user_invitations
  WHERE invitation_token = p_token AND status = 'pending';
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Invalid or expired invitation', NULL::UUID;
    RETURN;
  END IF;
  
  -- Check if invitation is expired
  IF _invitation_record.expires_at < NOW() THEN
    UPDATE system.user_invitations 
    SET status = 'expired' 
    WHERE id = _invitation_record.id;
    
    RETURN QUERY SELECT false, 'Invitation has expired', NULL::UUID;
    RETURN;
  END IF;
  
  -- Check if user already exists with this email
  IF EXISTS (
    SELECT 1 FROM system.users 
    WHERE email = _invitation_record.email AND tenant_id = _invitation_record.tenant_id
  ) THEN
    RETURN QUERY SELECT false, 'User already exists with this email', NULL::UUID;
    RETURN;
  END IF;
  
  -- Create the user in system.users
  INSERT INTO system.users (
    id, email, first_name, last_name, role, department, 
    tenant_id, is_active, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), -- Generate new UUID for the user
    _invitation_record.email,
    COALESCE(p_first_name, _invitation_record.first_name),
    COALESCE(p_last_name, _invitation_record.last_name),
    _invitation_record.role,
    _invitation_record.department,
    _invitation_record.tenant_id,
    true,
    NOW(),
    NOW()
  ) RETURNING id INTO _new_user_id;
  
  -- Mark invitation as accepted
  UPDATE system.user_invitations 
  SET 
    status = 'accepted',
    accepted_at = NOW(),
    accepted_by = _new_user_id
  WHERE id = _invitation_record.id;
  
  RETURN QUERY SELECT true, 'Invitation accepted successfully', _new_user_id;
END;
$$;

-- Function to cancel an invitation
CREATE OR REPLACE FUNCTION public.cancel_invitation(
  p_invitation_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _tenant_id UUID;
  _current_user_id UUID;
  _invitation_tenant_id UUID;
BEGIN
  -- Get current user's tenant_id from JWT
  _tenant_id := (auth.jwt()->'app_metadata'->>'tenant_id')::uuid;
  _current_user_id := auth.uid();
  
  IF _tenant_id IS NULL THEN
    RETURN QUERY SELECT false, 'User not associated with any tenant';
    RETURN;
  END IF;
  
  -- Verify current user is an admin
  IF NOT EXISTS (
    SELECT 1 FROM system.users 
    WHERE id = _current_user_id AND tenant_id = _tenant_id AND role = 'admin'
  ) THEN
    RETURN QUERY SELECT false, 'Only admins can cancel invitations';
    RETURN;
  END IF;
  
  -- Get the invitation and verify it belongs to the same tenant
  SELECT tenant_id INTO _invitation_tenant_id
  FROM system.user_invitations
  WHERE id = p_invitation_id;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Invitation not found';
    RETURN;
  END IF;
  
  IF _invitation_tenant_id != _tenant_id THEN
    RETURN QUERY SELECT false, 'Cannot cancel invitation from different tenant';
    RETURN;
  END IF;
  
  -- Cancel the invitation
  UPDATE system.user_invitations 
  SET 
    status = 'cancelled',
    cancelled_at = NOW(),
    cancelled_by = _current_user_id,
    cancellation_reason = p_reason
  WHERE id = p_invitation_id;
  
  RETURN QUERY SELECT true, 'Invitation cancelled successfully';
END;
$$;

-- Function to resend an invitation
CREATE OR REPLACE FUNCTION public.resend_invitation(p_invitation_id UUID)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT,
  new_token TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _tenant_id UUID;
  _current_user_id UUID;
  _invitation_record RECORD;
  _new_token TEXT;
BEGIN
  -- Get current user's tenant_id from JWT
  _tenant_id := (auth.jwt()->'app_metadata'->>'tenant_id')::uuid;
  _current_user_id := auth.uid();
  
  IF _tenant_id IS NULL THEN
    RETURN QUERY SELECT false, 'User not associated with any tenant', NULL::TEXT;
    RETURN;
  END IF;
  
  -- Verify current user is an admin
  IF NOT EXISTS (
    SELECT 1 FROM system.users 
    WHERE id = _current_user_id AND tenant_id = _tenant_id AND role = 'admin'
  ) THEN
    RETURN QUERY SELECT false, 'Only admins can resend invitations', NULL::TEXT;
    RETURN;
  END IF;
  
  -- Get the invitation
  SELECT * INTO _invitation_record
  FROM system.user_invitations
  WHERE id = p_invitation_id AND tenant_id = _tenant_id;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Invitation not found', NULL::TEXT;
    RETURN;
  END IF;
  
  -- Check if invitation can be resent
  IF _invitation_record.status != 'pending' THEN
    RETURN QUERY SELECT false, 'Cannot resend non-pending invitation', NULL::TEXT;
    RETURN;
  END IF;
  
  -- Generate new token and extend expiration
  _new_token := encode(gen_random_bytes(32), 'hex');
  
  -- Update invitation with new token and extended expiration
  UPDATE system.user_invitations 
  SET 
    invitation_token = _new_token,
    expires_at = NOW() + INTERVAL '7 days',
    updated_at = NOW()
  WHERE id = p_invitation_id;
  
  RETURN QUERY SELECT true, 'Invitation resent successfully', _new_token;
END;
$$;

-- Function to get pending invitations for a tenant
CREATE OR REPLACE FUNCTION public.get_pending_invitations(p_tenant_id UUID)
RETURNS TABLE(
  id UUID,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  role TEXT,
  department TEXT,
  invited_by_email TEXT,
  created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Verify the requesting user belongs to the same tenant
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
    u.email as invited_by_email,
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

-- ===========================================
-- 3. GRANT EXECUTE PERMISSIONS
-- ===========================================

GRANT EXECUTE ON FUNCTION public.validate_invitation(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_invitation(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_invitation(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resend_invitation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_invitations(UUID) TO authenticated;

-- ===========================================
-- 4. ADD ADDITIONAL INDEXES
-- ===========================================

-- Index for invitation status and tenant
CREATE INDEX IF NOT EXISTS idx_user_invitations_status_tenant_created 
ON system.user_invitations(status, tenant_id, created_at);

-- Index for invitation lookup by email and tenant
CREATE INDEX IF NOT EXISTS idx_user_invitations_email_tenant_status 
ON system.user_invitations(email, tenant_id, status);

-- Index for invitation cleanup (expired pending invitations)
CREATE INDEX IF NOT EXISTS idx_user_invitations_cleanup 
ON system.user_invitations(status, expires_at) 
WHERE status = 'pending';

-- ===========================================
-- 5. ADD CONSTRAINTS AND VALIDATIONS
-- ===========================================

-- Add constraint to ensure email is lowercase
ALTER TABLE system.user_invitations 
ADD CONSTRAINT check_email_lowercase 
CHECK (email = lower(email));

-- Add constraint to ensure invitation token is not empty
ALTER TABLE system.user_invitations 
ADD CONSTRAINT check_token_not_empty 
CHECK (length(trim(invitation_token)) > 0);

-- Add constraint to ensure expiration is in the future when created
ALTER TABLE system.user_invitations 
ADD CONSTRAINT check_expiration_future 
CHECK (expires_at > created_at);

-- ===========================================
-- 6. VERIFICATION QUERIES
-- ===========================================

-- Uncomment and run these queries to verify the migration:
/*
-- Check if table was created
SELECT 
  schemaname,
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables 
WHERE tablename = 'user_invitations' AND schemaname = 'system';

-- Check if RLS policies were created
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE tablename = 'user_invitations' AND schemaname = 'system'
ORDER BY policyname;

-- Check if functions were created
SELECT 
  proname as function_name,
  prosrc as source
FROM pg_proc 
WHERE proname IN (
  'validate_invitation',
  'accept_invitation',
  'cancel_invitation',
  'resend_invitation',
  'get_pending_invitations'
);

-- Check if indexes were created
SELECT 
  indexname,
  tablename,
  indexdef
FROM pg_indexes 
WHERE tablename = 'user_invitations' AND schemaname = 'system'
ORDER BY indexname;
*/

