-- ============================================================
-- Migration 256: Surveillance 1 (Renewal) — Sprint 0 backend
--
-- Part of UAF New Changes/New Help Doc/Renewal/Sprints/00_Sprint_Plan.md,
-- Sprint 0 ("Rename, Email Field, Notification Route").
--
-- Only change here: create_renewal_client gets an optional p_email param
-- that overrides the copied external_clients__a.email__a when provided —
-- covers both "no client linked" (nothing to copy from) and "client's
-- stored email is stale" (stakeholder wants to send to a different address
-- for this particular Surveillance 1 record). No new column — email__a
-- already exists on tenant.renewal_clients__a since migration 221.
--
-- The email-sending itself lives in app/api/notifications/send/route.ts
-- (Resend, service-role, called from the client after this RPC succeeds)
-- — not part of this migration, no DB-side email dispatch.
-- ============================================================

DROP FUNCTION IF EXISTS public.create_renewal_client(UUID);
DROP FUNCTION IF EXISTS public.create_renewal_client(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.create_renewal_client(
  p_external_client_id UUID DEFAULT NULL,
  p_email               TEXT DEFAULT NULL   -- NEW: overrides copied email__a when provided
)
RETURNS TABLE(success BOOLEAN, message TEXT, record_id UUID)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_id    UUID;
  _caller_role  TEXT;
  _custom_role  TEXT;
  _caller_name  TEXT;
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

  -- Resolve caller display name (full name → email → uuid fallback)
  _caller_name := COALESCE(
    public.current_user_full_name(),
    _caller_id::text
  );

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

  -- Explicit p_email always wins over the copied value, when given
  _email := COALESCE(NULLIF(trim(p_email), ''), _email);

  _new_id := gen_random_uuid();

  INSERT INTO tenant.renewal_clients__a (
    id, tenant_id, external_client_id__a, client_user_id__a,
    name, company_name__a, contact_person__a, email__a, iso_standards__a,
    created_by, updated_by,
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
    _caller_name, _caller_name,
    now(), now()
  );

  RETURN QUERY SELECT true, 'Renewal record created', _new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_renewal_client(UUID, TEXT) TO authenticated;
