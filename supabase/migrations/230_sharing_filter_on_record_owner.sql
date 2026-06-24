-- ============================================================
-- Migration 230: Switch sharing policy filter from created_by
--                to record_owner__a
--
-- Replaces _resolve_sharing_mode and tenant.get_object_records
-- (from 226) and update_tenant_record (from 227) so all three
-- use record_owner__a for ownership comparisons instead of
-- created_by.
--
-- created_by remains an immutable audit field (who first created
-- the record). record_owner__a is the assignable ownership field.
-- ============================================================

-- ── 1. Updated tenant.get_object_records ────────────────────

DROP FUNCTION IF EXISTS tenant.get_object_records(UUID, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION tenant.get_object_records(
  p_object_id  UUID,
  p_limit      INTEGER DEFAULT 100,
  p_offset     INTEGER DEFAULT 0
)
RETURNS TABLE(record_id UUID, record_data JSONB)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_table_name     TEXT;
  v_jsonb_fields   TEXT := '';
  v_where_clause   TEXT := '';
  v_select_sql     TEXT;
  v_column_record  RECORD;
  v_tenant_id      UUID;
  v_read_mode      TEXT;
  v_caller_id      UUID;
  v_custom_role_id UUID;
BEGIN
  v_caller_id := auth.uid();

  SELECT o.name, o.tenant_id INTO v_table_name, v_tenant_id
    FROM tenant.objects o WHERE o.id = p_object_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Object not found';
  END IF;

  SELECT s.effective_read_mode, s.effective_edit_mode
    INTO v_read_mode, v_read_mode   -- only read_mode needed here
    FROM public._resolve_sharing_mode(p_object_id, v_tenant_id) s;

  -- Re-select properly (can't reuse same variable twice in INTO)
  SELECT s.effective_read_mode INTO v_read_mode
    FROM public._resolve_sharing_mode(p_object_id, v_tenant_id) s;

  IF v_read_mode = 'owner' THEN
    -- Filter on record_owner__a
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'tenant' AND table_name = v_table_name
         AND column_name = 'record_owner__a'
    ) THEN
      v_where_clause := ' AND t.record_owner__a = ' || quote_literal(v_caller_id::text);
    ELSE
      -- Fallback to created_by if record_owner__a column doesn't exist yet
      v_where_clause := ' AND t.created_by = ' || quote_literal(v_caller_id::text);
    END IF;

  ELSIF v_read_mode = 'role_peers' THEN
    SELECT su.custom_role_id INTO v_custom_role_id
      FROM system.users su WHERE su.id = v_caller_id;

    IF v_custom_role_id IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'tenant' AND table_name = v_table_name
           AND column_name = 'record_owner__a'
      ) THEN
        v_where_clause := ' AND t.record_owner__a IN (
          SELECT su2.id::text FROM system.users su2
          WHERE su2.custom_role_id = ' || quote_literal(v_custom_role_id::text) || '
        )';
      ELSE
        v_where_clause := ' AND t.created_by IN (
          SELECT su2.id::text FROM system.users su2
          WHERE su2.custom_role_id = ' || quote_literal(v_custom_role_id::text) || '
        )';
      END IF;
    ELSE
      -- No custom role → owner fallback
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'tenant' AND table_name = v_table_name
           AND column_name = 'record_owner__a'
      ) THEN
        v_where_clause := ' AND t.record_owner__a = ' || quote_literal(v_caller_id::text);
      ELSE
        v_where_clause := ' AND t.created_by = ' || quote_literal(v_caller_id::text);
      END IF;
    END IF;
  END IF;
  -- mode = 'all' → no extra WHERE

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

-- ── 2. Updated update_tenant_record ─────────────────────────

CREATE OR REPLACE FUNCTION public.update_tenant_record(
  p_table_name  TEXT,
  p_record_id   UUID,
  p_tenant_id   UUID,
  p_update_data JSONB
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_sql            TEXT;
  v_table_name     TEXT;
  v_object_id      UUID;
  v_caller_id      UUID;
  v_caller_role    TEXT;
  v_custom_role_id UUID;
  v_edit_mode      TEXT;
  v_record_owner   TEXT;
  v_has_owner_col  BOOLEAN;
BEGIN
  IF p_table_name !~ '^[a-zA-Z_][a-zA-Z0-9_]*$' THEN
    RAISE EXCEPTION 'Invalid table name: %', p_table_name;
  END IF;

  v_table_name := 'tenant.' || p_table_name;
  v_caller_id  := auth.uid();

  SELECT su.role, su.custom_role_id
    INTO v_caller_role, v_custom_role_id
    FROM system.users su WHERE su.id = v_caller_id;

  IF v_caller_role != 'admin' THEN
    SELECT o.id INTO v_object_id
      FROM tenant.objects o
     WHERE o.name = p_table_name AND o.tenant_id = p_tenant_id;

    IF v_object_id IS NOT NULL THEN
      SELECT s.effective_edit_mode INTO v_edit_mode
        FROM public._resolve_sharing_mode(v_object_id, p_tenant_id) s;

      IF v_edit_mode = 'owner' OR v_edit_mode = 'role_peers' THEN

        -- Check whether record_owner__a column exists on this table
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'tenant'
             AND table_name   = p_table_name
             AND column_name  = 'record_owner__a'
        ) INTO v_has_owner_col;

        IF v_has_owner_col THEN
          EXECUTE format(
            'SELECT record_owner__a FROM %I WHERE id = %L AND tenant_id = %L',
            v_table_name, p_record_id, p_tenant_id
          ) INTO v_record_owner;
        ELSE
          -- Fallback to created_by
          EXECUTE format(
            'SELECT created_by FROM %I WHERE id = %L AND tenant_id = %L',
            v_table_name, p_record_id, p_tenant_id
          ) INTO v_record_owner;
        END IF;

        IF v_edit_mode = 'owner' THEN
          IF v_record_owner IS DISTINCT FROM v_caller_id::text THEN
            RAISE EXCEPTION 'Access denied: you can only edit your own records';
          END IF;

        ELSIF v_edit_mode = 'role_peers' THEN
          IF v_custom_role_id IS NULL THEN
            IF v_record_owner IS DISTINCT FROM v_caller_id::text THEN
              RAISE EXCEPTION 'Access denied: you can only edit your own records';
            END IF;
          ELSE
            IF NOT EXISTS (
              SELECT 1 FROM system.users su2
               WHERE su2.id::text = v_record_owner
                 AND su2.custom_role_id = v_custom_role_id
            ) THEN
              RAISE EXCEPTION 'Access denied: you can only edit records within your role group';
            END IF;
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  v_sql := format(
    'UPDATE %I SET %s, updated_at = NOW() WHERE id = %L AND tenant_id = %L',
    v_table_name,
    (SELECT string_agg(format('%I = %L', key, value), ', ')
       FROM jsonb_each_text(p_update_data)),
    p_record_id,
    p_tenant_id
  );

  EXECUTE v_sql;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Record not found or no permission to update';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_tenant_record(TEXT, UUID, UUID, JSONB) TO authenticated;
