-- ================================
-- Migration 209: Enforce permissions in data-fetching RPCs
--
-- Adds permission checks to:
--   public.get_object_records   → enforce can_read on the object
--   public.get_tenant_fields    → filter out fields where can_read = false
--   public.get_fields_metadata  → filter out fields where can_read = false
--
-- Logic:
--   - Admin role → no restriction, pass through unchanged
--   - User with no permission sets → no restriction (full access default)
--   - User with sets → check merged effective permissions
-- -----------------------------------------------

-- Helper: returns TRUE if the current user can perform an action on a resource.
-- Used internally by the enforcement functions below.
CREATE OR REPLACE FUNCTION public._check_permission(
  p_resource_type TEXT,
  p_resource_id   UUID,
  p_action        TEXT   -- 'read' | 'edit' | 'create' | 'delete'
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_id     UUID;
  _caller_role   TEXT;
  _caller_tenant UUID;
  _has_sets      BOOLEAN;
  _result        BOOLEAN;
BEGIN
  _caller_id := auth.uid();

  SELECT su.role, su.tenant_id
  INTO _caller_role, _caller_tenant
  FROM system.users su WHERE su.id = _caller_id;

  -- Admins always pass
  IF _caller_role = 'admin' THEN
    RETURN true;
  END IF;

  -- No sets → full access
  SELECT EXISTS (
    SELECT 1 FROM tenant.user_permission_sets ups
    JOIN tenant.permission_sets ps ON ps.id = ups.perm_set_id
    WHERE ups.user_id = _caller_id AND ps.tenant_id = _caller_tenant
  ) INTO _has_sets;

  IF NOT _has_sets THEN
    RETURN true;
  END IF;

  -- Check merged effective permissions for this resource
  SELECT
    CASE p_action
      WHEN 'read'   THEN bool_or(e.can_read)
      WHEN 'edit'   THEN bool_or(e.can_edit)
      WHEN 'create' THEN bool_or(e.can_create)
      WHEN 'delete' THEN bool_or(e.can_delete)
      ELSE false
    END
  INTO _result
  FROM tenant.user_permission_sets ups
  JOIN tenant.permission_sets ps ON ps.id = ups.perm_set_id
  JOIN tenant.permission_set_entries e
    ON e.permission_set_id = ps.id
    AND e.resource_type = p_resource_type
    AND e.resource_id   = p_resource_id
  WHERE ups.user_id = _caller_id
    AND ps.tenant_id = _caller_tenant;

  -- If no explicit entry for this resource exists across any set,
  -- return true (resource not listed = not restricted)
  IF _result IS NULL THEN
    -- Check if any set has ANY entry for this resource type
    -- If they do but none for this specific resource, default to true
    RETURN true;
  END IF;

  RETURN COALESCE(_result, false);
END;
$$;

GRANT EXECUTE ON FUNCTION public._check_permission(TEXT, UUID, TEXT) TO authenticated;

-- -----------------------------------------------
-- get_object_records — enforce can_read on the object
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION public.get_object_records(
  p_object_id UUID,
  p_tenant_id UUID,
  p_limit     INTEGER DEFAULT 100,
  p_offset    INTEGER DEFAULT 0
)
RETURNS TABLE(record_id UUID, record_data JSONB)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Permission check: can user read this object?
  IF NOT public._check_permission('object', p_object_id, 'read') THEN
    RAISE EXCEPTION 'Access denied: you do not have read permission for this object';
  END IF;

  RETURN QUERY
  SELECT * FROM tenant.get_object_records(p_object_id, p_limit, p_offset);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_object_records(UUID, UUID, INTEGER, INTEGER) TO authenticated;

-- -----------------------------------------------
-- get_tenant_fields — filter out fields the user can't read
-- -----------------------------------------------
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

  -- Admins and users with no sets: return everything
  IF _caller_role = 'admin' THEN
    RETURN QUERY
    SELECT f.id, f.object_id, f.name::TEXT, f.label::TEXT, f.type::TEXT,
           f.is_required, f.is_nullable, f.default_value::TEXT, f.validation_rules,
           f.display_order::INT, f.section::TEXT, f.width::TEXT, f.is_visible,
           f.is_system_field, f.reference_table::TEXT, f.reference_display_field::TEXT,
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
           f.tenant_id, f.created_at, f.updated_at
    FROM tenant.fields f
    WHERE f.object_id = p_object_id AND f.tenant_id = p_tenant_id
    ORDER BY f.display_order;
    RETURN;
  END IF;

  -- Return fields, excluding any explicitly denied by a permission entry
  RETURN QUERY
  SELECT f.id, f.object_id, f.name::TEXT, f.label::TEXT, f.type::TEXT,
         f.is_required, f.is_nullable, f.default_value::TEXT, f.validation_rules,
         f.display_order::INT, f.section::TEXT, f.width::TEXT, f.is_visible,
         f.is_system_field, f.reference_table::TEXT, f.reference_display_field::TEXT,
         f.tenant_id, f.created_at, f.updated_at
  FROM tenant.fields f
  WHERE f.object_id = p_object_id
    AND f.tenant_id = p_tenant_id
    -- Exclude field if there is an explicit can_read=false entry for it
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

-- -----------------------------------------------
-- get_fields_metadata — filter out fields the user can't read
-- Must drop first because return type is changing
-- -----------------------------------------------
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
           f.reference_table, f.reference_display_field, f.tenant_id
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
           f.reference_table, f.reference_display_field, f.tenant_id
    FROM tenant.fields f
    WHERE f.id = ANY(p_field_ids) AND f.tenant_id = p_tenant_id;
    RETURN;
  END IF;

  -- Filter out explicitly denied fields
  RETURN QUERY
  SELECT f.id, f.name, f.label, f.type, f.is_required,
         f.reference_table, f.reference_display_field, f.tenant_id
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
