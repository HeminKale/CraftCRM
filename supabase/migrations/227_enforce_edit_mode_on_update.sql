-- ============================================================
-- Migration 227: Enforce edit_mode sharing policy on record updates
--
-- update_tenant_record (084_update_tenant_record) currently runs
-- the UPDATE with no sharing check. This migration replaces it
-- to call _resolve_sharing_mode() before executing the update and
-- block the write if the caller does not have edit access to that
-- specific record.
--
-- Logic mirrors what get_object_records does for reads:
--   edit_mode = 'all'        → anyone can edit (no change to existing behaviour)
--   edit_mode = 'owner'      → caller can only edit records where created_by = their UUID
--   edit_mode = 'role_peers' → caller can only edit records owned by someone with the
--                              same custom_role_id as themselves
--
-- Admin users bypass the check entirely (consistent with all other sharing logic).
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_tenant_record(
  p_table_name  TEXT,
  p_record_id   UUID,
  p_tenant_id   UUID,
  p_update_data JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sql            TEXT;
  v_table_name     TEXT;
  v_object_id      UUID;
  v_caller_id      UUID;
  v_caller_role    TEXT;
  v_custom_role_id UUID;
  v_edit_mode      TEXT;
  v_record_owner   TEXT;
BEGIN
  -- Validate table name to prevent SQL injection
  IF p_table_name !~ '^[a-zA-Z_][a-zA-Z0-9_]*$' THEN
    RAISE EXCEPTION 'Invalid table name: %', p_table_name;
  END IF;

  v_table_name := 'tenant.' || p_table_name;
  v_caller_id  := auth.uid();

  -- Get caller role
  SELECT su.role, su.custom_role_id
    INTO v_caller_role, v_custom_role_id
    FROM system.users su
   WHERE su.id = v_caller_id;

  -- Admins bypass sharing entirely
  IF v_caller_role != 'admin' THEN

    -- Look up the object_id for this table
    SELECT o.id INTO v_object_id
      FROM tenant.objects o
     WHERE o.name = p_table_name
       AND o.tenant_id = p_tenant_id;

    IF v_object_id IS NOT NULL THEN
      -- Resolve effective edit mode for this caller on this object
      SELECT s.effective_edit_mode INTO v_edit_mode
        FROM public._resolve_sharing_mode(v_object_id, p_tenant_id) s;

      IF v_edit_mode = 'owner' OR v_edit_mode = 'role_peers' THEN
        -- Fetch the created_by value from the record
        EXECUTE format(
          'SELECT created_by FROM %I WHERE id = %L AND tenant_id = %L',
          v_table_name, p_record_id, p_tenant_id
        ) INTO v_record_owner;

        IF v_edit_mode = 'owner' THEN
          -- Caller must be the record owner
          IF v_record_owner IS DISTINCT FROM v_caller_id::text THEN
            RAISE EXCEPTION 'Access denied: you can only edit your own records';
          END IF;

        ELSIF v_edit_mode = 'role_peers' THEN
          -- Caller's custom role must match the record owner's custom role
          IF v_custom_role_id IS NULL THEN
            -- No custom role → fall back to owner check
            IF v_record_owner IS DISTINCT FROM v_caller_id::text THEN
              RAISE EXCEPTION 'Access denied: you can only edit your own records';
            END IF;
          ELSE
            -- Check if record owner shares the same custom role
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
      -- edit_mode = 'all' → no check needed
    END IF;
    -- If object not found in tenant.objects → no policy → allow (safe default)
  END IF;

  -- Build and execute the update
  v_sql := format(
    'UPDATE %I SET %s, updated_at = NOW() WHERE id = %L AND tenant_id = %L',
    v_table_name,
    (
      SELECT string_agg(format('%I = %L', key, value), ', ')
        FROM jsonb_each_text(p_update_data)
    ),
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
