-- ================================================================
-- Migration 247: get_tenant_user_directory RPC — fix useUserMap
--
-- useUserMap.ts resolves created_by/updated_by/record_owner__a (and, as of
-- 246, auditor_id__a/tech_reviewer_id__a) UUIDs to display names via a
-- direct `supabase.schema('system').from('users').select(...)` call,
-- relying on system.users' RLS policy:
--   USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid)
-- Every other user-lookup in this app (get_tenant_users_by_role_pattern,
-- get_object_records, etc.) instead resolves the caller's tenant via a
-- SECURITY DEFINER function doing `SELECT tenant_id FROM system.users
-- WHERE id = auth.uid()` — never through a JWT claim. That split is the
-- likely reason useUserMap silently returns zero rows for real sessions:
-- the auth.jwt() 'tenant_id' claim path isn't the one this app's auth
-- actually populates/relies on anywhere else.
--
-- Fix: give useUserMap a SECURITY DEFINER RPC of its own, matching the
-- established pattern, instead of trying to make the raw table select work.
--
-- Note: deliberately NOT reusing get_tenant_users_by_role_pattern here —
-- that RPC INNER JOINs tenant.roles, which excludes any user with no
-- custom_role_id (e.g. the tenant admin). useUserMap needs to resolve
-- created_by/updated_by for ANY user, admin included, so this is a plain
-- tenant-scoped directory with no role filter.
-- ================================================================

CREATE OR REPLACE FUNCTION public.get_tenant_user_directory()
RETURNS TABLE(id UUID, first_name TEXT, last_name TEXT, email TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_tenant UUID;
BEGIN
  SELECT su.tenant_id INTO _caller_tenant
  FROM system.users su WHERE su.id = auth.uid();

  IF _caller_tenant IS NULL THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT su.id, su.first_name::TEXT, su.last_name::TEXT, su.email::TEXT
  FROM system.users su
  WHERE su.tenant_id = _caller_tenant;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_tenant_user_directory() TO authenticated;
