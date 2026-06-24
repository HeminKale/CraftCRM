-- ============================================================
-- Migration 226: Record Sharing Policy
--
-- Adds two tables:
--   tenant.object_sharing_policies  — baseline mode per object
--   tenant.sharing_overrides        — per-role or per-permission-set overrides
--
-- Modes:
--   'all'        → user sees/edits every record on this object
--   'owner'      → user sees/edits only records where created_by = their UUID
--   'role_peers' → user sees/edits records owned by anyone with the same custom role
--
-- Enforcement is added to tenant.get_object_records and public.get_object_records.
-- Admin always bypasses all sharing (consistent with permission set behaviour).
-- ============================================================

-- ── 1. object_sharing_policies ──────────────────────────────

CREATE TABLE IF NOT EXISTS tenant.object_sharing_policies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES system.tenants(id) ON DELETE CASCADE,
  object_id     UUID NOT NULL REFERENCES tenant.objects(id) ON DELETE CASCADE,
  read_mode     TEXT NOT NULL DEFAULT 'all'
                  CHECK (read_mode  IN ('all', 'owner', 'role_peers')),
  edit_mode     TEXT NOT NULL DEFAULT 'all'
                  CHECK (edit_mode  IN ('all', 'owner', 'role_peers')),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(object_id)
);

ALTER TABLE tenant.object_sharing_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "osp_tenant_select" ON tenant.object_sharing_policies
  FOR SELECT USING (
    tenant_id = (SELECT su.tenant_id FROM system.users su WHERE su.id = auth.uid())
  );
CREATE POLICY "osp_tenant_insert" ON tenant.object_sharing_policies
  FOR INSERT WITH CHECK (
    tenant_id = (SELECT su.tenant_id FROM system.users su WHERE su.id = auth.uid())
  );
CREATE POLICY "osp_tenant_update" ON tenant.object_sharing_policies
  FOR UPDATE USING (
    tenant_id = (SELECT su.tenant_id FROM system.users su WHERE su.id = auth.uid())
  );
CREATE POLICY "osp_tenant_delete" ON tenant.object_sharing_policies
  FOR DELETE USING (
    tenant_id = (SELECT su.tenant_id FROM system.users su WHERE su.id = auth.uid())
  );

-- ── 2. sharing_overrides ────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenant.sharing_overrides (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES system.tenants(id) ON DELETE CASCADE,
  object_id     UUID NOT NULL REFERENCES tenant.objects(id) ON DELETE CASCADE,
  -- target: exactly one of role_id or perm_set_id must be set
  role_id       UUID REFERENCES tenant.roles(id) ON DELETE CASCADE,
  perm_set_id   UUID REFERENCES tenant.permission_sets(id) ON DELETE CASCADE,
  read_mode     TEXT NOT NULL DEFAULT 'all'
                  CHECK (read_mode IN ('all', 'owner', 'role_peers')),
  edit_mode     TEXT NOT NULL DEFAULT 'all'
                  CHECK (edit_mode IN ('all', 'owner', 'role_peers')),
  -- custom_formula reserved for Phase 3 — stored but not yet evaluated
  custom_formula TEXT DEFAULT NULL,
  priority      INTEGER NOT NULL DEFAULT 10,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT one_target CHECK (
    (role_id IS NULL) != (perm_set_id IS NULL)
  )
);

ALTER TABLE tenant.sharing_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "so_tenant_select" ON tenant.sharing_overrides
  FOR SELECT USING (
    tenant_id = (SELECT su.tenant_id FROM system.users su WHERE su.id = auth.uid())
  );
CREATE POLICY "so_tenant_insert" ON tenant.sharing_overrides
  FOR INSERT WITH CHECK (
    tenant_id = (SELECT su.tenant_id FROM system.users su WHERE su.id = auth.uid())
  );
CREATE POLICY "so_tenant_update" ON tenant.sharing_overrides
  FOR UPDATE USING (
    tenant_id = (SELECT su.tenant_id FROM system.users su WHERE su.id = auth.uid())
  );
CREATE POLICY "so_tenant_delete" ON tenant.sharing_overrides
  FOR DELETE USING (
    tenant_id = (SELECT su.tenant_id FROM system.users su WHERE su.id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_so_object   ON tenant.sharing_overrides(object_id);
CREATE INDEX IF NOT EXISTS idx_so_role     ON tenant.sharing_overrides(role_id)     WHERE role_id     IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_so_perm_set ON tenant.sharing_overrides(perm_set_id) WHERE perm_set_id IS NOT NULL;

-- ── 3. Helper: resolve effective sharing modes for caller ───

CREATE OR REPLACE FUNCTION public._resolve_sharing_mode(
  p_object_id  UUID,
  p_tenant_id  UUID
)
RETURNS TABLE(effective_read_mode TEXT, effective_edit_mode TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_id      UUID;
  _caller_role    TEXT;
  _custom_role_id UUID;
  _base_read      TEXT := 'all';
  _base_edit      TEXT := 'all';
  _best_read      TEXT := NULL;
  _best_edit      TEXT := NULL;
  _priority_read  INTEGER := -1;
  _priority_edit  INTEGER := -1;
  _r              RECORD;
BEGIN
  _caller_id := auth.uid();

  SELECT su.role, su.custom_role_id
    INTO _caller_role, _custom_role_id
    FROM system.users su
   WHERE su.id = _caller_id;

  -- Admins bypass sharing entirely
  IF _caller_role = 'admin' THEN
    RETURN QUERY SELECT 'all'::TEXT, 'all'::TEXT;
    RETURN;
  END IF;

  -- Fetch baseline policy for this object
  SELECT osp.read_mode, osp.edit_mode
    INTO _base_read, _base_edit
    FROM tenant.object_sharing_policies osp
   WHERE osp.object_id = p_object_id;

  -- No policy configured → all access (existing behaviour preserved)
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'all'::TEXT, 'all'::TEXT;
    RETURN;
  END IF;

  -- Find most-permissive applicable override (role or perm set)
  -- Mode rank: all > role_peers > owner  (higher = more permissive)
  FOR _r IN
    SELECT so.read_mode, so.edit_mode, so.priority
      FROM tenant.sharing_overrides so
     WHERE so.object_id = p_object_id
       AND so.tenant_id = p_tenant_id
       AND (
         (so.role_id     IS NOT NULL AND so.role_id     = _custom_role_id)
         OR
         (so.perm_set_id IS NOT NULL AND so.perm_set_id IN (
           SELECT ups.perm_set_id
             FROM tenant.user_permission_sets ups
            WHERE ups.user_id = _caller_id
         ))
       )
     ORDER BY so.priority DESC
  LOOP
    -- Take the most permissive read mode seen
    IF _best_read IS NULL OR
       (CASE _r.read_mode WHEN 'all' THEN 3 WHEN 'role_peers' THEN 2 ELSE 1 END) >
       (CASE _best_read   WHEN 'all' THEN 3 WHEN 'role_peers' THEN 2 ELSE 1 END)
    THEN
      _best_read := _r.read_mode;
    END IF;

    IF _best_edit IS NULL OR
       (CASE _r.edit_mode WHEN 'all' THEN 3 WHEN 'role_peers' THEN 2 ELSE 1 END) >
       (CASE _best_edit   WHEN 'all' THEN 3 WHEN 'role_peers' THEN 2 ELSE 1 END)
    THEN
      _best_edit := _r.edit_mode;
    END IF;
  END LOOP;

  -- Override beats baseline if more permissive; otherwise baseline applies
  RETURN QUERY
    SELECT
      COALESCE(_best_read, _base_read),
      COALESCE(_best_edit, _base_edit);
END;
$$;

GRANT EXECUTE ON FUNCTION public._resolve_sharing_mode(UUID, UUID) TO authenticated;

-- ── 4. Updated tenant.get_object_records with sharing filter ─

DROP FUNCTION IF EXISTS tenant.get_object_records(UUID, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION tenant.get_object_records(
  p_object_id  UUID,
  p_limit      INTEGER DEFAULT 100,
  p_offset     INTEGER DEFAULT 0
)
RETURNS TABLE(record_id UUID, record_data JSONB)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_table_name    TEXT;
  v_jsonb_fields  TEXT := '';
  v_where_clause  TEXT := '';
  v_select_sql    TEXT;
  v_column_record RECORD;
  v_tenant_id     UUID;
  v_read_mode     TEXT;
  v_edit_mode     TEXT;
  v_caller_id     UUID;
  v_custom_role_id UUID;
BEGIN
  v_caller_id := auth.uid();

  SELECT o.name, o.tenant_id INTO v_table_name, v_tenant_id
    FROM tenant.objects o
   WHERE o.id = p_object_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Object not found';
  END IF;

  -- Resolve effective sharing mode
  SELECT s.effective_read_mode, s.effective_edit_mode
    INTO v_read_mode, v_edit_mode
    FROM public._resolve_sharing_mode(p_object_id, v_tenant_id) s;

  -- Build WHERE clause based on read mode
  IF v_read_mode = 'owner' THEN
    v_where_clause := ' AND t.created_by = ' || quote_literal(v_caller_id::text);
  ELSIF v_read_mode = 'role_peers' THEN
    SELECT su.custom_role_id INTO v_custom_role_id
      FROM system.users su WHERE su.id = v_caller_id;
    IF v_custom_role_id IS NOT NULL THEN
      v_where_clause := ' AND t.created_by IN (
        SELECT su2.id::text FROM system.users su2
        WHERE su2.custom_role_id = ' || quote_literal(v_custom_role_id::text) || '
      )';
    ELSE
      -- User has no custom role — fall back to owner-only for role_peers
      v_where_clause := ' AND t.created_by = ' || quote_literal(v_caller_id::text);
    END IF;
  END IF;
  -- 'all' → no WHERE clause addition

  -- Build dynamic JSONB columns (same as migration 082)
  FOR v_column_record IN
    SELECT column_name, data_type
      FROM information_schema.columns
     WHERE table_schema = 'tenant'
       AND table_name   = v_table_name
       AND column_name NOT IN ('id', 'created_at', 'updated_at', 'autonumber')
     ORDER BY ordinal_position
  LOOP
    IF v_column_record.data_type = 'bigint' THEN
      v_jsonb_fields := v_jsonb_fields ||
        CASE WHEN v_jsonb_fields != '' THEN ' || ' ELSE '' END ||
        'jsonb_build_object(' || quote_literal(v_column_record.column_name) ||
        ', COALESCE(NULLIF(t.' || quote_ident(v_column_record.column_name) || '::text, ''''), NULL))';
    ELSE
      v_jsonb_fields := v_jsonb_fields ||
        CASE WHEN v_jsonb_fields != '' THEN ' || ' ELSE '' END ||
        'jsonb_build_object(' || quote_literal(v_column_record.column_name) ||
        ', COALESCE(t.' || quote_ident(v_column_record.column_name) || '::text, ''''))';
    END IF;
  END LOOP;

  v_select_sql := '
    SELECT
      t.id as record_id,
      jsonb_build_object(
        ''id'',         t.id,
        ''created_at'', COALESCE(t.created_at::text, ''''),
        ''updated_at'', COALESCE(t.updated_at::text, '''')
      )' ||
      CASE WHEN v_jsonb_fields != '' THEN ' || ' || v_jsonb_fields ELSE '' END || '
      as record_data
    FROM tenant.' || quote_ident(v_table_name) || ' t
    WHERE t.tenant_id = ' || quote_literal(v_tenant_id::text) ||
    v_where_clause || '
    ORDER BY t.created_at DESC
    LIMIT '  || p_limit  || '
    OFFSET ' || p_offset;

  RETURN QUERY EXECUTE v_select_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION tenant.get_object_records(UUID, INTEGER, INTEGER) TO authenticated;

-- ── 5. CRUD RPCs ─────────────────────────────────────────────

-- Get policy for one object
CREATE OR REPLACE FUNCTION public.get_object_sharing_policy(p_object_id UUID)
RETURNS TABLE(id UUID, read_mode TEXT, edit_mode TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
    SELECT osp.id, osp.read_mode, osp.edit_mode
      FROM tenant.object_sharing_policies osp
     WHERE osp.object_id = p_object_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_object_sharing_policy(UUID) TO authenticated;

-- Upsert baseline policy
CREATE OR REPLACE FUNCTION public.upsert_object_sharing_policy(
  p_object_id UUID,
  p_tenant_id UUID,
  p_read_mode TEXT,
  p_edit_mode TEXT
)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_role TEXT;
BEGIN
  SELECT su.role INTO _caller_role FROM system.users su WHERE su.id = auth.uid();
  IF _caller_role != 'admin' THEN
    RETURN QUERY SELECT false, 'Admin only';
    RETURN;
  END IF;

  INSERT INTO tenant.object_sharing_policies(tenant_id, object_id, read_mode, edit_mode)
  VALUES (p_tenant_id, p_object_id, p_read_mode, p_edit_mode)
  ON CONFLICT(object_id) DO UPDATE
    SET read_mode  = EXCLUDED.read_mode,
        edit_mode  = EXCLUDED.edit_mode,
        updated_at = NOW();

  RETURN QUERY SELECT true, 'Saved';
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_object_sharing_policy(UUID, UUID, TEXT, TEXT) TO authenticated;

-- List overrides for one object
CREATE OR REPLACE FUNCTION public.get_sharing_overrides(p_object_id UUID)
RETURNS TABLE(
  id             UUID,
  role_id        UUID,
  role_name      TEXT,
  perm_set_id    UUID,
  perm_set_name  TEXT,
  read_mode      TEXT,
  edit_mode      TEXT,
  custom_formula TEXT,
  priority       INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
    SELECT
      so.id,
      so.role_id,
      r.name       AS role_name,
      so.perm_set_id,
      ps.name      AS perm_set_name,
      so.read_mode,
      so.edit_mode,
      so.custom_formula,
      so.priority
    FROM tenant.sharing_overrides so
    LEFT JOIN tenant.roles r            ON r.id  = so.role_id
    LEFT JOIN tenant.permission_sets ps ON ps.id = so.perm_set_id
    WHERE so.object_id = p_object_id
    ORDER BY so.priority DESC, so.created_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_sharing_overrides(UUID) TO authenticated;

-- Upsert one override
CREATE OR REPLACE FUNCTION public.upsert_sharing_override(
  p_object_id     UUID,
  p_tenant_id     UUID,
  p_override_id   UUID,        -- NULL = new row
  p_role_id       UUID,        -- NULL if targeting perm set
  p_perm_set_id   UUID,        -- NULL if targeting role
  p_read_mode     TEXT,
  p_edit_mode     TEXT,
  p_custom_formula TEXT,
  p_priority      INTEGER
)
RETURNS TABLE(success BOOLEAN, message TEXT, override_id UUID)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_role TEXT;
  _new_id      UUID;
BEGIN
  SELECT su.role INTO _caller_role FROM system.users su WHERE su.id = auth.uid();
  IF _caller_role != 'admin' THEN
    RETURN QUERY SELECT false, 'Admin only', NULL::UUID;
    RETURN;
  END IF;

  IF p_override_id IS NOT NULL THEN
    UPDATE tenant.sharing_overrides
       SET role_id        = p_role_id,
           perm_set_id    = p_perm_set_id,
           read_mode      = p_read_mode,
           edit_mode      = p_edit_mode,
           custom_formula = p_custom_formula,
           priority       = p_priority,
           updated_at     = NOW()
     WHERE id = p_override_id;
    RETURN QUERY SELECT true, 'Updated', p_override_id;
  ELSE
    INSERT INTO tenant.sharing_overrides(
      tenant_id, object_id, role_id, perm_set_id,
      read_mode, edit_mode, custom_formula, priority
    ) VALUES (
      p_tenant_id, p_object_id, p_role_id, p_perm_set_id,
      p_read_mode, p_edit_mode, p_custom_formula, p_priority
    ) RETURNING id INTO _new_id;
    RETURN QUERY SELECT true, 'Created', _new_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_sharing_override(UUID, UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, INTEGER) TO authenticated;

-- Delete one override
CREATE OR REPLACE FUNCTION public.delete_sharing_override(p_override_id UUID)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _caller_role TEXT;
BEGIN
  SELECT su.role INTO _caller_role FROM system.users su WHERE su.id = auth.uid();
  IF _caller_role != 'admin' THEN
    RETURN QUERY SELECT false, 'Admin only';
    RETURN;
  END IF;

  DELETE FROM tenant.sharing_overrides WHERE id = p_override_id;
  RETURN QUERY SELECT true, 'Deleted';
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_sharing_override(UUID) TO authenticated;
