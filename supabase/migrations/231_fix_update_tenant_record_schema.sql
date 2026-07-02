-- ============================================================
-- Migration 231: Fix schema.table quoting in update_tenant_record
--
-- format('UPDATE %I ...', 'tenant.table_name') quotes the entire
-- string as a single identifier, producing:
--   UPDATE "tenant.table_name" ...   ← wrong
-- instead of:
--   UPDATE "tenant"."table_name" ... ← correct
--
-- Fix: pass schema and table as separate %I tokens.
-- ============================================================

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

  v_caller_id := auth.uid();

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

      IF v_edit_mode IN ('owner', 'role_peers') THEN
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'tenant'
             AND table_name   = p_table_name
             AND column_name  = 'record_owner__a'
        ) INTO v_has_owner_col;

        IF v_has_owner_col THEN
          EXECUTE format(
            'SELECT record_owner__a FROM %I.%I WHERE id = %L AND tenant_id = %L',
            'tenant', p_table_name, p_record_id, p_tenant_id
          ) INTO v_record_owner;
        ELSE
          EXECUTE format(
            'SELECT created_by FROM %I.%I WHERE id = %L AND tenant_id = %L',
            'tenant', p_table_name, p_record_id, p_tenant_id
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

  -- Use %I.%I so schema and table are quoted separately
  v_sql := format(
    'UPDATE %I.%I SET %s, updated_at = NOW() WHERE id = %L AND tenant_id = %L',
    'tenant',
    p_table_name,
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
