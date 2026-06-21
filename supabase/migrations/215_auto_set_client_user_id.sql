-- ================================
-- Migration 215: Auto-set client_user_id__a on External Client record creation
--
-- When a user with the "External Client" custom role inserts a record
-- into external_clients__a, automatically set client_user_id__a = auth.uid().
--
-- Admin/CRM Office creating records on behalf of a client: not auto-set
-- (they can set it manually from the record edit view).
-- ================================

CREATE OR REPLACE FUNCTION tenant.auto_set_client_user_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER AS $$
DECLARE
  _caller_id   UUID;
  _custom_role TEXT;
BEGIN
  _caller_id := auth.uid();
  IF _caller_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get the custom role name for the inserting user
  SELECT r.name INTO _custom_role
  FROM system.users su
  JOIN tenant.roles r ON r.id = su.custom_role_id
  WHERE su.id = _caller_id;

  -- Only auto-assign if the user has "External Client" type role
  IF _custom_role IS NOT NULL AND lower(_custom_role) LIKE '%external%client%' THEN
    NEW.client_user_id__a := _caller_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_set_client_user_id ON tenant.external_clients__a;

CREATE TRIGGER trg_auto_set_client_user_id
  BEFORE INSERT ON tenant.external_clients__a
  FOR EACH ROW
  EXECUTE FUNCTION tenant.auto_set_client_user_id();
