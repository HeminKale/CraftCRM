-- ================================
-- Migration 137: User Management Functions
-- Craft App - User Management RPC Functions
-- ================================

-- ===========================================
-- 1. USER MANAGEMENT RPC FUNCTIONS
-- ===========================================

-- Function to get all users for a tenant
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
  -- Verify the requesting user belongs to the same tenant
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

-- Function to invite a new user
CREATE OR REPLACE FUNCTION public.invite_user(
  p_email TEXT,
  p_first_name TEXT,
  p_last_name TEXT,
  p_role TEXT DEFAULT 'user',
  p_department TEXT DEFAULT NULL
)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT,
  invitation_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _tenant_id UUID;
  _invited_by UUID;
  _invitation_id UUID;
  _invitation_token TEXT;
BEGIN
  -- Get current user's tenant_id from JWT
  _tenant_id := (auth.jwt()->'app_metadata'->>'tenant_id')::uuid;
  _invited_by := auth.uid();
  
  IF _tenant_id IS NULL THEN
    RETURN QUERY SELECT false, 'User not associated with any tenant', NULL::UUID;
    RETURN;
  END IF;
  
  -- Verify current user is an admin
  IF NOT EXISTS (
    SELECT 1 FROM system.users 
    WHERE id = _invited_by AND tenant_id = _tenant_id AND role = 'admin'
  ) THEN
    RETURN QUERY SELECT false, 'Only admins can invite users', NULL::UUID;
    RETURN;
  END IF;
  
  -- Check if user already exists in this tenant
  IF EXISTS (SELECT 1 FROM system.users WHERE email = p_email AND tenant_id = _tenant_id) THEN
    RETURN QUERY SELECT false, 'User already exists in this tenant', NULL::UUID;
    RETURN;
  END IF;
  
  -- Check if invitation already exists for this email
  IF EXISTS (
    SELECT 1 FROM system.user_invitations 
    WHERE email = p_email AND tenant_id = _tenant_id AND status = 'pending'
  ) THEN
    RETURN QUERY SELECT false, 'User already has a pending invitation', NULL::UUID;
    RETURN;
  END IF;
  
  -- Generate secure invitation token
  _invitation_token := encode(gen_random_bytes(32), 'hex');
  
  -- Insert invitation record
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

-- Function to update user role
CREATE OR REPLACE FUNCTION public.update_user_role(
  p_user_id UUID,
  p_new_role TEXT
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
  _target_user_role TEXT;
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
    RETURN QUERY SELECT false, 'Only admins can update user roles';
    RETURN;
  END IF;
  
  -- Verify target user belongs to same tenant
  IF NOT EXISTS (
    SELECT 1 FROM system.users 
    WHERE id = p_user_id AND tenant_id = _tenant_id
  ) THEN
    RETURN QUERY SELECT false, 'User not found in this tenant';
    RETURN;
  END IF;
  
  -- Prevent admin from changing their own role to non-admin
  IF p_user_id = _current_user_id AND p_new_role != 'admin' THEN
    RETURN QUERY SELECT false, 'Cannot change your own role from admin';
    RETURN;
  END IF;
  
  -- Get current role of target user
  SELECT role INTO _target_user_role FROM system.users WHERE id = p_user_id;
  
  -- Prevent changing the last admin to non-admin
  IF _target_user_role = 'admin' AND p_new_role != 'admin' THEN
    IF (SELECT COUNT(*) FROM system.users WHERE tenant_id = _tenant_id AND role = 'admin') <= 1 THEN
      RETURN QUERY SELECT false, 'Cannot remove the last admin user';
      RETURN;
    END IF;
  END IF;
  
  -- Update role
  UPDATE system.users 
  SET role = p_new_role, updated_at = NOW()
  WHERE id = p_user_id;
  
  RETURN QUERY SELECT true, 'User role updated successfully';
END;
$$;

-- Function to deactivate/reactivate a user
CREATE OR REPLACE FUNCTION public.toggle_user_status(
  p_user_id UUID,
  p_is_active BOOLEAN
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
  _target_user_role TEXT;
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
    RETURN QUERY SELECT false, 'Only admins can change user status';
    RETURN;
  END IF;
  
  -- Verify target user belongs to same tenant
  IF NOT EXISTS (
    SELECT 1 FROM system.users 
    WHERE id = p_user_id AND tenant_id = _tenant_id
  ) THEN
    RETURN QUERY SELECT false, 'User not found in this tenant';
    RETURN;
  END IF;
  
  -- Prevent admin from deactivating themselves
  IF p_user_id = _current_user_id AND NOT p_is_active THEN
    RETURN QUERY SELECT false, 'Cannot deactivate your own account';
    RETURN;
  END IF;
  
  -- Get current role of target user
  SELECT role INTO _target_user_role FROM system.users WHERE id = p_user_id;
  
  -- Prevent deactivating the last admin
  IF _target_user_role = 'admin' AND NOT p_is_active THEN
    IF (SELECT COUNT(*) FROM system.users WHERE tenant_id = _tenant_id AND role = 'admin' AND is_active = true) <= 1 THEN
      RETURN QUERY SELECT false, 'Cannot deactivate the last admin user';
      RETURN;
    END IF;
  END IF;
  
  -- Update status
  UPDATE system.users 
  SET is_active = p_is_active, updated_at = NOW()
  WHERE id = p_user_id;
  
  RETURN QUERY SELECT true, 
    CASE 
      WHEN p_is_active THEN 'User activated successfully'
      ELSE 'User deactivated successfully'
    END;
END;
$$;

-- Function to get user details by ID
CREATE OR REPLACE FUNCTION public.get_user_details(p_user_id UUID)
RETURNS TABLE(
  id UUID,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  role TEXT,
  department TEXT,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  last_sign_in TIMESTAMPTZ,
  tenant_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _tenant_id UUID;
BEGIN
  -- Get current user's tenant_id from JWT
  _tenant_id := (auth.jwt()->'app_metadata'->>'tenant_id')::uuid;
  
  IF _tenant_id IS NULL THEN
    RAISE EXCEPTION 'User not associated with any tenant';
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
    u.updated_at,
    au.last_sign_in_at,
    u.tenant_id
  FROM system.users u
  LEFT JOIN auth.users au ON u.id = au.id
  WHERE u.id = p_user_id AND u.tenant_id = _tenant_id;
END;
$$;

-- ===========================================
-- 2. GRANT EXECUTE PERMISSIONS
-- ===========================================

GRANT EXECUTE ON FUNCTION public.get_tenant_users(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_user(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_user_role(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_user_status(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_details(UUID) TO authenticated;

-- ===========================================
-- 3. ADD PERFORMANCE INDEXES
-- ===========================================

-- Index for user invitations lookup
CREATE INDEX IF NOT EXISTS idx_user_invitations_email_tenant 
ON system.user_invitations(email, tenant_id);

-- Index for user invitations by token
CREATE INDEX IF NOT EXISTS idx_user_invitations_token 
ON system.user_invitations(invitation_token);

-- Index for user invitations by status and tenant
CREATE INDEX IF NOT EXISTS idx_user_invitations_status_tenant 
ON system.user_invitations(status, tenant_id);

-- Index for user invitations expiration
CREATE INDEX IF NOT EXISTS idx_user_invitations_expires 
ON system.user_invitations(expires_at);

-- ===========================================
-- 4. CLEANUP EXPIRED INVITATIONS FUNCTION
-- ===========================================

-- Function to clean up expired invitations (can be called by a cron job)
CREATE OR REPLACE FUNCTION public.cleanup_expired_invitations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _deleted_count INTEGER;
BEGIN
  UPDATE system.user_invitations 
  SET status = 'expired' 
  WHERE status = 'pending' AND expires_at < NOW();
  
  GET DIAGNOSTICS _deleted_count = ROW_COUNT;
  
  RETURN _deleted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_expired_invitations() TO authenticated;

-- ===========================================
-- 5. VERIFICATION QUERIES
-- ===========================================

-- Uncomment and run these queries to verify the migration:
/*
-- Check if functions were created
SELECT 
  proname as function_name,
  prosrc as source
FROM pg_proc 
WHERE proname IN (
  'get_tenant_users',
  'invite_user', 
  'update_user_role',
  'toggle_user_status',
  'get_user_details',
  'cleanup_expired_invitations'
);

-- Check if indexes were created
SELECT 
  indexname,
  tablename,
  indexdef
FROM pg_indexes 
WHERE indexname LIKE 'idx_user_invitations%'
ORDER BY indexname;
*/

