-- ================================================================
-- Migration 246: 'user_lookup' field type for auditor_id / tech_reviewer_id
--
-- 244 added auditor_id__a/tech_reviewer_id__a but deliberately left them
-- unregistered in tenant.fields — registering a plain field would let
-- anyone with generic field-edit access write an arbitrary user id,
-- bypassing assign_stage_team's role validation. Stakeholder now wants
-- these placeable on the Page Layout, editable, with the picklist showing
-- names (filtered to the matching role) and the selection actually driving
-- who's authorized for accept/reject/close/findings on that record (already
-- true for free — those RPCs read auditor_id__a/tech_reviewer_id__a
-- directly off the record, whatever writes them is automatically live).
--
-- Key finding while building this: update_tenant_record
-- (231_fix_update_tenant_record_schema.sql) writes any column named in its
-- JSONB payload with ZERO field-level permission checking — can_edit in
-- Permission Sets is enforced client-side only for this RPC. So a DB
-- trigger is not optional defense-in-depth here, it's the only real
-- enforcement available for these two columns specifically.
--
-- Three parts:
--   A. Trigger on tenant.external_clients__a — rejects any write to
--      auditor_id__a/tech_reviewer_id__a unless the new value is a user
--      who actually holds the matching role. Covers every write path
--      (Page Layout, assign_stage_team, direct RPC calls).
--   B. tenant.fields.lookup_role_pattern (new column) + registration of
--      both fields with type='user_lookup'. Reuses the existing
--      get_tenant_users_by_role_pattern RPC (built for the Assign Team
--      panel) to populate the picklist by role.
--   C. get_tenant_fields / get_fields_metadata redefined to also return
--      lookup_role_pattern, so the frontend receives it.
-- ================================================================

-- ================================================================
-- PART A — enforcement trigger (see header: the only real guard here)
-- ================================================================
CREATE OR REPLACE FUNCTION tenant.validate_stage_team_role_match()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  _role_name TEXT;
BEGIN
  IF NEW.auditor_id__a IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.auditor_id__a IS DISTINCT FROM OLD.auditor_id__a) THEN
    SELECT r.name INTO _role_name
    FROM system.users su
    JOIN tenant.roles r ON r.id = su.custom_role_id
    WHERE su.id = NEW.auditor_id__a AND su.tenant_id = NEW.tenant_id;

    IF _role_name IS NULL OR lower(_role_name) NOT LIKE '%auditor%' THEN
      RAISE EXCEPTION 'auditor_id__a must reference a user holding the Auditor role';
    END IF;
  END IF;

  IF NEW.tech_reviewer_id__a IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.tech_reviewer_id__a IS DISTINCT FROM OLD.tech_reviewer_id__a) THEN
    SELECT r.name INTO _role_name
    FROM system.users su
    JOIN tenant.roles r ON r.id = su.custom_role_id
    WHERE su.id = NEW.tech_reviewer_id__a AND su.tenant_id = NEW.tenant_id;

    IF _role_name IS NULL OR lower(_role_name) NOT LIKE '%tech%' THEN
      RAISE EXCEPTION 'tech_reviewer_id__a must reference a user holding the Tech Reviewer role';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_stage_team_role_match ON tenant.external_clients__a;
CREATE TRIGGER trg_validate_stage_team_role_match
  BEFORE INSERT OR UPDATE OF auditor_id__a, tech_reviewer_id__a ON tenant.external_clients__a
  FOR EACH ROW
  EXECUTE FUNCTION tenant.validate_stage_team_role_match();

-- ================================================================
-- PART B — register the fields with the new 'user_lookup' type
-- ================================================================
ALTER TABLE tenant.fields
  ADD COLUMN IF NOT EXISTS lookup_role_pattern TEXT;

DO $$
DECLARE
  _tenant_id UUID;
  _object_id UUID;
BEGIN
  FOR _tenant_id IN SELECT id FROM system.tenants LOOP
    SELECT id INTO _object_id FROM tenant.objects
    WHERE tenant_id = _tenant_id AND name = 'external_clients__a' LIMIT 1;
    IF _object_id IS NULL THEN CONTINUE; END IF;

    -- Registered WITH the __a suffix already in the name — deliberately not
    -- following 242's bare-name convention. Traced the actual save path
    -- (mapDisplayNameToApiName -> update_tenant_record) and nothing ever
    -- re-adds __a to a bare tenant.fields.name before the dynamic
    -- UPDATE ... SET <name> runs, so a bare-registered field would try to
    -- write a column that doesn't exist and error out (this looks like it
    -- affects 242's 12 bare-named fields too, whenever/if they're ever
    -- edited through the generic Page Layout form — separate, pre-existing
    -- issue, not fixed here, flagged in rights_S3.md instead). Using the
    -- exact column name here avoids the bug entirely: both
    -- mapDisplayNameToApiName and findFieldValue match it on the first,
    -- exact-name branch.
    INSERT INTO tenant.fields (id, tenant_id, object_id, name, label, type, is_required, is_system_field, display_order, lookup_role_pattern, created_at, updated_at)
    SELECT v.id, v.tenant_id, v.object_id, v.name, v.label, v.type, v.is_required, v.is_system_field, v.display_order, v.lookup_role_pattern, now(), now()
    FROM (VALUES
      (gen_random_uuid(), _tenant_id, _object_id, 'auditor_id__a',       'Assigned Auditor',       'user_lookup', false, false, 172, 'auditor'),
      (gen_random_uuid(), _tenant_id, _object_id, 'tech_reviewer_id__a', 'Assigned Tech Reviewer', 'user_lookup', false, false, 173, 'tech')
    ) AS v(id, tenant_id, object_id, name, label, type, is_required, is_system_field, display_order, lookup_role_pattern)
    WHERE NOT EXISTS (
      SELECT 1 FROM tenant.fields f WHERE f.object_id = v.object_id AND f.name = v.name
    );
  END LOOP;
END $$;

-- ================================================================
-- PART C — get_tenant_fields / get_fields_metadata: return lookup_role_pattern
-- Reproduces 209's bodies verbatim, adding the one new output column.
-- ================================================================
DROP FUNCTION IF EXISTS public.get_tenant_fields(UUID, UUID);
CREATE OR REPLACE FUNCTION public.get_tenant_fields(p_object_id UUID, p_tenant_id UUID)
RETURNS TABLE(
  id                     UUID,
  object_id              UUID,
  name                   TEXT,
  label                  TEXT,
  type                   TEXT,
  is_required            BOOLEAN,
  is_nullable            BOOLEAN,
  default_value          TEXT,
  validation_rules       JSONB,
  display_order          INTEGER,
  section                TEXT,
  width                  TEXT,
  is_visible             BOOLEAN,
  is_system_field        BOOLEAN,
  reference_table        TEXT,
  reference_display_field TEXT,
  lookup_role_pattern    TEXT,
  tenant_id              UUID,
  created_at             TIMESTAMPTZ,
  updated_at             TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_id     UUID;
  _caller_role   TEXT;
  _caller_tenant UUID;
  _has_sets      BOOLEAN;
BEGIN
  _caller_id := auth.uid();
  SELECT su.role, su.tenant_id INTO _caller_role, _caller_tenant
  FROM system.users su WHERE su.id = _caller_id;

  IF _caller_role = 'admin' THEN
    RETURN QUERY
    SELECT f.id, f.object_id, f.name::TEXT, f.label::TEXT, f.type::TEXT,
           f.is_required, f.is_nullable, f.default_value::TEXT, f.validation_rules,
           f.display_order::INT, f.section::TEXT, f.width::TEXT, f.is_visible,
           f.is_system_field, f.reference_table::TEXT, f.reference_display_field::TEXT,
           f.lookup_role_pattern::TEXT,
           f.tenant_id, f.created_at, f.updated_at
    FROM tenant.fields f
    WHERE f.object_id = p_object_id AND f.tenant_id = p_tenant_id
    ORDER BY f.display_order;
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM tenant.user_permission_sets ups
    JOIN tenant.permission_sets ps ON ps.id = ups.perm_set_id
    WHERE ups.user_id = _caller_id AND ps.tenant_id = _caller_tenant
  ) INTO _has_sets;

  IF NOT _has_sets THEN
    RETURN QUERY
    SELECT f.id, f.object_id, f.name::TEXT, f.label::TEXT, f.type::TEXT,
           f.is_required, f.is_nullable, f.default_value::TEXT, f.validation_rules,
           f.display_order::INT, f.section::TEXT, f.width::TEXT, f.is_visible,
           f.is_system_field, f.reference_table::TEXT, f.reference_display_field::TEXT,
           f.lookup_role_pattern::TEXT,
           f.tenant_id, f.created_at, f.updated_at
    FROM tenant.fields f
    WHERE f.object_id = p_object_id AND f.tenant_id = p_tenant_id
    ORDER BY f.display_order;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT f.id, f.object_id, f.name::TEXT, f.label::TEXT, f.type::TEXT,
         f.is_required, f.is_nullable, f.default_value::TEXT, f.validation_rules,
         f.display_order::INT, f.section::TEXT, f.width::TEXT, f.is_visible,
         f.is_system_field, f.reference_table::TEXT, f.reference_display_field::TEXT,
         f.lookup_role_pattern::TEXT,
         f.tenant_id, f.created_at, f.updated_at
  FROM tenant.fields f
  WHERE f.object_id = p_object_id
    AND f.tenant_id = p_tenant_id
    AND NOT EXISTS (
      SELECT 1
      FROM tenant.user_permission_sets ups
      JOIN tenant.permission_sets ps ON ps.id = ups.perm_set_id
      JOIN tenant.permission_set_entries e
        ON e.permission_set_id = ps.id
        AND e.resource_type = 'field'
        AND e.resource_id = f.id
        AND e.can_read = false
      WHERE ups.user_id = _caller_id AND ps.tenant_id = _caller_tenant
    )
  ORDER BY f.display_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_tenant_fields(UUID, UUID) TO authenticated;

DROP FUNCTION IF EXISTS public.get_fields_metadata(UUID[], UUID);
CREATE OR REPLACE FUNCTION public.get_fields_metadata(
  p_field_ids UUID[],
  p_tenant_id UUID
)
RETURNS TABLE(
  id                      UUID,
  name                    TEXT,
  label                   TEXT,
  type                    TEXT,
  is_required             BOOLEAN,
  reference_table         VARCHAR(255),
  reference_display_field VARCHAR(255),
  lookup_role_pattern     TEXT,
  tenant_id               UUID
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_id     UUID;
  _caller_role   TEXT;
  _caller_tenant UUID;
  _has_sets      BOOLEAN;
BEGIN
  _caller_id := auth.uid();
  SELECT su.role, su.tenant_id INTO _caller_role, _caller_tenant
  FROM system.users su WHERE su.id = _caller_id;

  IF _caller_role = 'admin' THEN
    RETURN QUERY
    SELECT f.id, f.name, f.label, f.type, f.is_required,
           f.reference_table, f.reference_display_field, f.lookup_role_pattern::TEXT, f.tenant_id
    FROM tenant.fields f
    WHERE f.id = ANY(p_field_ids) AND f.tenant_id = p_tenant_id;
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM tenant.user_permission_sets ups
    JOIN tenant.permission_sets ps ON ps.id = ups.perm_set_id
    WHERE ups.user_id = _caller_id AND ps.tenant_id = _caller_tenant
  ) INTO _has_sets;

  IF NOT _has_sets THEN
    RETURN QUERY
    SELECT f.id, f.name, f.label, f.type, f.is_required,
           f.reference_table, f.reference_display_field, f.lookup_role_pattern::TEXT, f.tenant_id
    FROM tenant.fields f
    WHERE f.id = ANY(p_field_ids) AND f.tenant_id = p_tenant_id;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT f.id, f.name, f.label, f.type, f.is_required,
         f.reference_table, f.reference_display_field, f.lookup_role_pattern::TEXT, f.tenant_id
  FROM tenant.fields f
  WHERE f.id = ANY(p_field_ids)
    AND f.tenant_id = p_tenant_id
    AND NOT EXISTS (
      SELECT 1
      FROM tenant.user_permission_sets ups
      JOIN tenant.permission_sets ps ON ps.id = ups.perm_set_id
      JOIN tenant.permission_set_entries e
        ON e.permission_set_id = ps.id
        AND e.resource_type = 'field'
        AND e.resource_id = f.id
        AND e.can_read = false
      WHERE ups.user_id = _caller_id AND ps.tenant_id = _caller_tenant
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_fields_metadata(UUID[], UUID) TO authenticated;
