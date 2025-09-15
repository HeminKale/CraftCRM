-- ================================
-- Migration 006: REST API Bridge Functions
-- Craft App - Enable frontend access to system schema
-- ================================

-- ===========================================
-- 1. CREATE BRIDGE FUNCTIONS FOR SYSTEM SCHEMA
-- ===========================================

-- Function to get all active tenants
CREATE OR REPLACE FUNCTION public.get_tenants()
RETURNS TABLE(id UUID, name TEXT, slug VARCHAR(100), is_active BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT t.id, t.name, t.slug, t.is_active
  FROM system.tenants t
  WHERE t.is_active = true
  ORDER BY t.name;
END;
$$;

-- Function to create a new tenant
CREATE OR REPLACE FUNCTION public.create_tenant(
  tenant_name TEXT,
  tenant_slug VARCHAR(100) DEFAULT NULL
)
RETURNS TABLE(id UUID, name TEXT, slug VARCHAR(100))
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_slug VARCHAR(100);
  new_tenant system.tenants;
BEGIN
  -- Generate slug if not provided
  IF tenant_slug IS NULL THEN
    new_slug := LOWER(REPLACE(tenant_name, ' ', '-'));
  ELSE
    new_slug := tenant_slug;
  END IF;
  
  -- Insert new tenant
  INSERT INTO system.tenants (name, slug, is_active)
  VALUES (tenant_name, new_slug, true)
  RETURNING * INTO new_tenant;
  
  -- Return the created tenant
  RETURN QUERY
  SELECT new_tenant.id, new_tenant.name, new_tenant.slug;
END;
$$;

-- Function to create a new user
CREATE OR REPLACE FUNCTION public.create_user(
  p_user_id UUID,
  p_tenant_id UUID,
  p_user_email TEXT,
  p_first_name TEXT,
  p_last_name TEXT,
  p_user_role TEXT DEFAULT 'user'
)
RETURNS TABLE(id UUID, email TEXT, first_name TEXT, last_name TEXT, role TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Insert new user
  INSERT INTO system.users (id, tenant_id, email, first_name, last_name, role, is_active)
  VALUES (p_user_id, p_tenant_id, p_user_email, p_first_name, p_last_name, p_user_role, true);
  
  -- Return the created user
  RETURN QUERY
  SELECT u.id, u.email, u.first_name, u.last_name, u.role
  FROM system.users u
  WHERE u.id = p_user_id;
END;
$$;

-- Function to get user profile by auth user ID
CREATE OR REPLACE FUNCTION public.get_user_profile(p_user_id UUID)
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
  tenant_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.department,
         u.is_active, u.created_at, u.updated_at, u.tenant_id
  FROM system.users u
  WHERE u.id = p_user_id
  AND u.is_active = true;
END;
$$;

-- ===========================================
-- 2. GRANT EXECUTE PERMISSIONS
-- ===========================================

GRANT EXECUTE ON FUNCTION public.get_tenants() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_tenant(TEXT, VARCHAR(100)) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_user(UUID, UUID, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- Grant permissions (added to existing grants)
GRANT EXECUTE ON FUNCTION public.get_user_profile(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_user(UUID, UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- Bridge function to get all tenants (for signup organization selection)
CREATE OR REPLACE FUNCTION public.get_tenants()
RETURNS TABLE(
  id UUID,
  name TEXT,
  slug VARCHAR(100),
  domain VARCHAR(255),
  settings JSONB,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT t.id, t.name, t.slug, t.domain, t.settings, t.is_active, t.created_at, t.updated_at
  FROM system.tenants t
  WHERE t.is_active = true
  ORDER BY t.name;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.get_tenants() TO authenticated;

-- ===========================================
-- 3. DISABLE AUTOMATIC TRIGGER
-- ===========================================

-- Disable the automatic trigger to let frontend handle tenant creation
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- ===========================================
-- 4. ADD COMMENTS FOR CLARITY
-- ===========================================

COMMENT ON FUNCTION public.get_tenants() IS 'Bridge function to access system.tenants through REST API';
COMMENT ON FUNCTION public.create_tenant(TEXT, VARCHAR(100)) IS 'Bridge function to create new tenants through REST API';
COMMENT ON FUNCTION public.create_user(UUID, UUID, TEXT, TEXT, TEXT, TEXT) IS 'Bridge function to create new users through REST API';

-- ===========================================
-- 5. VERIFY FUNCTIONS ARE CREATED
-- ===========================================

-- This migration enables the organization picklist functionality
-- by providing REST API access to the system schema through
-- public bridge functions. 