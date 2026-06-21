-- ============================================================
-- Migration 222: Fix create_renewal_client column name casing
--
-- external_clients__a uses mixed-case columns (Company_name__a,
-- contactPerson__a, ISOStandard__a) which require double-quoting
-- in PostgreSQL. The original RPC used unquoted references which
-- PostgreSQL folded to lowercase, causing "column does not exist".
-- ============================================================

DROP FUNCTION IF EXISTS public.create_renewal_client(UUID);

CREATE OR REPLACE FUNCTION public.create_renewal_client(
  p_external_client_id UUID DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, message TEXT, record_id UUID)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_id    UUID;
  _caller_role  TEXT;
  _custom_role  TEXT;
  _tenant_id    UUID;
  _name         TEXT;
  _company      TEXT;
  _contact      TEXT;
  _email        TEXT;
  _iso          TEXT;
  _client_uid   UUID;
  _new_id       UUID;
BEGIN
  _caller_id := auth.uid();
  SELECT su.tenant_id, su.role INTO _tenant_id, _caller_role
  FROM system.users su WHERE su.id = _caller_id;

  SELECT r.name INTO _custom_role
  FROM system.users su
  JOIN tenant.roles r ON r.id = su.custom_role_id
  WHERE su.id = _caller_id;

  IF _caller_role != 'admin' AND (lower(coalesce(_custom_role,'')) NOT LIKE '%crm%') THEN
    RETURN QUERY SELECT false, 'Access denied: CRM Office role required', NULL::UUID;
    RETURN;
  END IF;

  -- Only look up client details if a client was provided
  IF p_external_client_id IS NOT NULL THEN
    SELECT
      ec.name,
      ec."Company_name__a",
      ec."contactPerson__a",
      ec."email__a",
      ec."ISOStandard__a",
      ec."client_user_id__a"
    INTO _name, _company, _contact, _email, _iso, _client_uid
    FROM tenant.external_clients__a ec
    WHERE ec.id = p_external_client_id AND ec.tenant_id = _tenant_id;

    IF NOT FOUND THEN
      RETURN QUERY SELECT false, 'External client not found', NULL::UUID;
      RETURN;
    END IF;
  END IF;

  _new_id := gen_random_uuid();

  INSERT INTO tenant.renewal_clients__a (
    id, tenant_id, external_client_id__a, client_user_id__a,
    name, company_name__a, contact_person__a, email__a, iso_standards__a,
    created_at, updated_at
  ) VALUES (
    _new_id, _tenant_id,
    p_external_client_id,
    _client_uid,
    COALESCE(_name, 'New Renewal'),
    _company,
    _contact,
    _email,
    _iso,
    now(), now()
  );

  RETURN QUERY SELECT true, 'Renewal record created', _new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_renewal_client(UUID) TO authenticated;
