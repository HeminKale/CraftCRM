-- ============================================================
-- Migration 229: Record Owner field
--
-- Adds record_owner__a (TEXT, stores UUID) as a system field on
-- every existing __a object table and registers it in field
-- metadata so it appears in RecordDetailView.
--
-- Behaviour:
--   - On INSERT: set to auth.uid()::text (same as created_by)
--   - On UPDATE: never touched automatically — user changes it
--                manually from the UI picker
--   - On UI:    UUID resolved to "First Last" via useUserMap,
--               rendered as an editable user picker
--
-- Sharing policies (migrations 226 / 227) will be updated in
-- migration 230 to filter on record_owner__a instead of created_by.
-- ============================================================

-- ── 1. Add column to every existing __a table ───────────────

DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOR v_table IN
    SELECT table_name
      FROM information_schema.tables
     WHERE table_schema = 'tenant'
       AND table_name   LIKE '%__a'
     ORDER BY table_name
  LOOP
    -- Add column only if it does not already exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'tenant'
         AND table_name   = v_table
         AND column_name  = 'record_owner__a'
    ) THEN
      EXECUTE format(
        'ALTER TABLE tenant.%I ADD COLUMN record_owner__a TEXT DEFAULT NULL',
        v_table
      );
      RAISE NOTICE 'Added record_owner__a to tenant.%', v_table;
    END IF;
  END LOOP;
END;
$$;

-- ── 2. Add record_owner__a to seed_system_fields ────────────
-- Replaces the function defined in 011_runtime_audit_triggers.sql
-- so that new objects created in the future get this field automatically.

CREATE OR REPLACE FUNCTION public.seed_system_fields(
  p_object_id UUID,
  p_tenant_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- name
  INSERT INTO tenant.fields (object_id, tenant_id, name, label, type, is_required, is_nullable,
    default_value, validation_rules, display_order, section, width, is_visible, is_system_field)
  SELECT p_object_id, p_tenant_id, 'name', 'Name', 'text', true, false, NULL,
         '[]'::jsonb, 1, 'details', 'half', true, true
  WHERE NOT EXISTS (
    SELECT 1 FROM tenant.fields f WHERE f.object_id=p_object_id AND f.tenant_id=p_tenant_id AND f.name='name'
  );

  -- is_active
  INSERT INTO tenant.fields (object_id, tenant_id, name, label, type, is_required, is_nullable,
    default_value, validation_rules, display_order, section, width, is_visible, is_system_field)
  SELECT p_object_id, p_tenant_id, 'is_active', 'Active', 'boolean', false, true, NULL,
         '[]'::jsonb, 2, 'system', 'half', true, true
  WHERE NOT EXISTS (
    SELECT 1 FROM tenant.fields f WHERE f.object_id=p_object_id AND f.tenant_id=p_tenant_id AND f.name='is_active'
  );

  -- created_at
  INSERT INTO tenant.fields (object_id, tenant_id, name, label, type, is_required, is_nullable,
    default_value, validation_rules, display_order, section, width, is_visible, is_system_field)
  SELECT p_object_id, p_tenant_id, 'created_at', 'Created Date', 'timestamptz', false, true, NULL,
         '[]'::jsonb, 90, 'system', 'half', true, true
  WHERE NOT EXISTS (
    SELECT 1 FROM tenant.fields f WHERE f.object_id=p_object_id AND f.tenant_id=p_tenant_id AND f.name='created_at'
  );

  -- updated_at
  INSERT INTO tenant.fields (object_id, tenant_id, name, label, type, is_required, is_nullable,
    default_value, validation_rules, display_order, section, width, is_visible, is_system_field)
  SELECT p_object_id, p_tenant_id, 'updated_at', 'Updated Date', 'timestamptz', false, true, NULL,
         '[]'::jsonb, 91, 'system', 'half', true, true
  WHERE NOT EXISTS (
    SELECT 1 FROM tenant.fields f WHERE f.object_id=p_object_id AND f.tenant_id=p_tenant_id AND f.name='updated_at'
  );

  -- created_by
  INSERT INTO tenant.fields (object_id, tenant_id, name, label, type, is_required, is_nullable,
    default_value, validation_rules, display_order, section, width, is_visible, is_system_field)
  SELECT p_object_id, p_tenant_id, 'created_by', 'Created By', 'text', false, true, NULL,
         '[]'::jsonb, 92, 'system', 'half', true, true
  WHERE NOT EXISTS (
    SELECT 1 FROM tenant.fields f WHERE f.object_id=p_object_id AND f.tenant_id=p_tenant_id AND f.name='created_by'
  );

  -- updated_by
  INSERT INTO tenant.fields (object_id, tenant_id, name, label, type, is_required, is_nullable,
    default_value, validation_rules, display_order, section, width, is_visible, is_system_field)
  SELECT p_object_id, p_tenant_id, 'updated_by', 'Updated By', 'text', false, true, NULL,
         '[]'::jsonb, 93, 'system', 'half', true, true
  WHERE NOT EXISTS (
    SELECT 1 FROM tenant.fields f WHERE f.object_id=p_object_id AND f.tenant_id=p_tenant_id AND f.name='updated_by'
  );

  -- record_owner__a  ← new
  INSERT INTO tenant.fields (object_id, tenant_id, name, label, type, is_required, is_nullable,
    default_value, validation_rules, display_order, section, width, is_visible, is_system_field)
  SELECT p_object_id, p_tenant_id, 'record_owner__a', 'Record Owner', 'record_owner', false, true, NULL,
         '[]'::jsonb, 94, 'system', 'half', true, true
  WHERE NOT EXISTS (
    SELECT 1 FROM tenant.fields f WHERE f.object_id=p_object_id AND f.tenant_id=p_tenant_id AND f.name='record_owner__a'
  );

  -- tenant_id (hidden)
  INSERT INTO tenant.fields (object_id, tenant_id, name, label, type, is_required, is_nullable,
    default_value, validation_rules, display_order, section, width, is_visible, is_system_field)
  SELECT p_object_id, p_tenant_id, 'tenant_id', 'Tenant', 'uuid', false, true, NULL,
         '[]'::jsonb, 95, 'system', 'half', false, true
  WHERE NOT EXISTS (
    SELECT 1 FROM tenant.fields f WHERE f.object_id=p_object_id AND f.tenant_id=p_tenant_id AND f.name='tenant_id'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_system_fields(UUID, UUID) TO authenticated;

-- ── 3. Seed record_owner__a metadata on all existing objects ─

DO $$
DECLARE
  v_obj RECORD;
BEGIN
  FOR v_obj IN
    SELECT DISTINCT o.id AS object_id, o.tenant_id
      FROM tenant.objects o
     ORDER BY o.id
  LOOP
    INSERT INTO tenant.fields (
      object_id, tenant_id, name, label, type,
      is_required, is_nullable, default_value,
      validation_rules, display_order, section, width,
      is_visible, is_system_field
    )
    SELECT
      v_obj.object_id, v_obj.tenant_id,
      'record_owner__a', 'Record Owner', 'record_owner',
      false, true, NULL,
      '[]'::jsonb, 94, 'system', 'half',
      true, true
    WHERE NOT EXISTS (
      SELECT 1 FROM tenant.fields f
       WHERE f.object_id = v_obj.object_id
         AND f.tenant_id = v_obj.tenant_id
         AND f.name      = 'record_owner__a'
    );
  END LOOP;
  RAISE NOTICE '✅ record_owner__a field metadata seeded for all existing objects';
END;
$$;

-- ── 4. Update insert trigger to also set record_owner__a ─────
-- Replaces audit_set_on_insert_safe from 130_add_missing_insert_triggers.sql

CREATE OR REPLACE FUNCTION public.audit_set_on_insert_safe()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id   UUID;
  v_user_name TEXT;
BEGIN
  NEW.created_at := COALESCE(NEW.created_at, NOW());
  NEW.updated_at := COALESCE(NEW.updated_at, NOW());

  v_user_id := auth.uid();

  IF v_user_id IS NOT NULL THEN
    -- Resolve display name for created_by / updated_by
    SELECT COALESCE(
      NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''),
      u.email
    ) INTO v_user_name
    FROM system.users u
    WHERE u.id = v_user_id;

    IF v_user_name IS NULL OR v_user_name = '' THEN
      SELECT email INTO v_user_name
        FROM auth.users WHERE id = v_user_id;
    END IF;

    -- created_by: store name (display), only on insert
    IF NEW.created_by IS NULL OR NEW.created_by = '' THEN
      NEW.created_by := COALESCE(v_user_name, v_user_id::text);
    END IF;

    -- updated_by: store name (display)
    IF NEW.updated_by IS NULL OR NEW.updated_by = '' THEN
      NEW.updated_by := COALESCE(v_user_name, v_user_id::text);
    END IF;

    -- record_owner__a: store UUID (used by sharing policy filter)
    IF NEW.record_owner__a IS NULL OR NEW.record_owner__a = '' THEN
      NEW.record_owner__a := v_user_id::text;
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'audit_set_on_insert_safe error on %: %', TG_TABLE_NAME, SQLERRM;
    NEW.created_at := COALESCE(NEW.created_at, NOW());
    NEW.updated_at := COALESCE(NEW.updated_at, NOW());
    RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION public.audit_set_on_insert_safe() TO authenticated;

-- ── 5. Backfill record_owner__a on existing records ──────────
-- For tables where the column is TEXT, copy created_by if it
-- looks like a UUID, otherwise try to resolve by name.

DO $$
DECLARE
  v_table  TEXT;
  v_sql    TEXT;
  v_rows   BIGINT;
  v_total  BIGINT := 0;
BEGIN
  FOR v_table IN
    SELECT table_name
      FROM information_schema.columns
     WHERE table_schema = 'tenant'
       AND table_name   LIKE '%__a'
       AND column_name  = 'record_owner__a'
       AND data_type    IN ('text', 'character varying')
     ORDER BY table_name
  LOOP
    -- Determine the data type of created_by on this table
    DECLARE
      v_cb_type TEXT;
    BEGIN
      SELECT data_type INTO v_cb_type
        FROM information_schema.columns
       WHERE table_schema = 'tenant'
         AND table_name   = v_table
         AND column_name  = 'created_by';

      IF v_cb_type IS NULL THEN
        -- No created_by column at all — skip
        CONTINUE;

      ELSIF v_cb_type = 'uuid' THEN
        -- created_by is native UUID → cast directly to text
        v_sql := format($q$
          UPDATE tenant.%I
             SET record_owner__a = created_by::text
           WHERE record_owner__a IS NULL
             AND created_by IS NOT NULL
        $q$, v_table);
        EXECUTE v_sql;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_total := v_total + v_rows;
        IF v_rows > 0 THEN
          RAISE NOTICE 'Backfilled (uuid) record_owner__a for % row(s) in tenant.%', v_rows, v_table;
        END IF;

      ELSE
        -- created_by is text — may contain a UUID string or a display name

        -- Case 1: already looks like a UUID → copy directly
        v_sql := format($q$
          UPDATE tenant.%I
             SET record_owner__a = created_by
           WHERE record_owner__a IS NULL
             AND created_by IS NOT NULL
             AND created_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        $q$, v_table);
        EXECUTE v_sql;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_total := v_total + v_rows;

        -- Case 2: display name → look up UUID in system.users
        v_sql := format($q$
          UPDATE tenant.%I t
             SET record_owner__a = u.id::text
            FROM system.users u
           WHERE t.record_owner__a IS NULL
             AND t.created_by IS NOT NULL
             AND (
               TRIM(CONCAT(u.first_name, ' ', u.last_name)) = t.created_by
               OR u.email = t.created_by
             )
        $q$, v_table);
        EXECUTE v_sql;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_total := v_total + v_rows;

        IF v_rows > 0 THEN
          RAISE NOTICE 'Backfilled (text) record_owner__a for % row(s) in tenant.%', v_rows, v_table;
        END IF;

      END IF;
    END;
  END LOOP;

  RAISE NOTICE '✅ record_owner__a backfill complete. Total rows set: %', v_total;
END;
$$;
