-- ============================================================
-- Migration 290: Fix get_object_records_with_references' first-pass
--                 reference-field skip check — the REAL root cause of the
--                 raw-UUID display bug migration 286 only half-fixed
--
-- ── What was actually wrong ──────────────────────────────────────────
-- Migration 286 flipped external_client_id's tenant.fields.type to
-- 'reference' and confirmed (via direct RPC query) that the metadata is
-- correct AND that the record_data JSONB returned by
-- get_object_records_with_references DOES contain a correctly-resolved
-- bare key: "external_client_id": "The winning edge". So the resolution
-- itself has always worked.
--
-- The bug is one step earlier: this function's FIRST pass (which is
-- supposed to build plain non-reference fields, and explicitly skip any
-- column that belongs to a 'reference'-typed field so the second pass can
-- resolve it instead) checks:
--     WHERE f.object_id = p_object_id AND f.name = v_column_record.column_name
-- comparing the REGISTERED field name ('external_client_id', no suffix —
-- confirmed via every field-registration statement across this entire
-- app, e.g. 221/264/265/etc.) against the PHYSICAL column name
-- ('external_client_id__a', WITH suffix). These never match for any
-- field following that (standard, universal) naming convention, so the
-- "skip if reference" check silently no-ops, and the RAW column value
-- gets included too, under the __a-suffixed key, alongside the correctly
-- resolved label under the bare key.
--
-- The frontend then loses the race: RecordDetailView.tsx's
-- findFieldValue/getSmartFieldValue (fixed earlier this Sprint to fall
-- back to the bare key when the __a-suffixed key is MISSING) never get a
-- chance to fall back, because the __a-suffixed key isn't missing — it's
-- present with the wrong (raw UUID) value, and gets returned on the very
-- first exact-match check.
--
-- This is not specific to external_client_id or to Surveillance 1 — it
-- silently affected (and silently half-worked, leaking a raw UUID
-- alongside the correct label) EVERY reference field on EVERY object in
-- the app using the standard name/name__a convention. Confirmed live via
-- Playwright + a direct RPC query of the actual record_data payload
-- before writing this fix, not assumed.
--
-- ── The fix ───────────────────────────────────────────────────────────
-- One WHERE-clause change: also match when the column name equals the
-- registered field name WITH '__a' appended — mirroring exactly how the
-- second pass already builds its own JOIN column reference
-- (`t.` || quote_ident(v_field_record.name || '__a')). Reproduces 288's
-- full body verbatim otherwise (both the tenant function and its public
-- bridge) — 288 is the current live version (adds the caller-identity
-- read-scoping on top of 284's app-scoping filter).
-- ============================================================

DROP FUNCTION IF EXISTS tenant.get_object_records_with_references(UUID, INTEGER, INTEGER, TEXT);

CREATE OR REPLACE FUNCTION tenant.get_object_records_with_references(
    p_object_id UUID,
    p_limit INTEGER DEFAULT 100,
    p_offset INTEGER DEFAULT 0,
    p_certification_body TEXT DEFAULT NULL   -- app-scoping filter (284)
)
RETURNS TABLE(
    record_id uuid,
    record_data jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_table_name text;
    v_select_sql text;
    v_jsonb_fields text := '';
    v_column_record record;
    v_reference_fields text := '';
    v_join_clauses text := '';
    v_field_record record;
    v_reference_table text;
    v_display_field text;
    v_join_alias text;
    v_join_counter integer := 1;
    v_where_clause text := '';
    v_has_cert_body_col boolean := false;
    -- caller-identity scoping for the External Client role (288)
    v_caller_id uuid;
    v_caller_email text;
    v_custom_role text;
    v_is_external_client boolean := false;
    v_has_client_user_id_col boolean := false;
    v_has_email_col boolean := false;
BEGIN
    -- Get table name from tenant.objects
    SELECT o.name INTO v_table_name
    FROM tenant.objects o
    WHERE o.id = p_object_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Object not found';
    END IF;

    -- resolve caller identity + role once, only relevant for the 3 client
    -- tables the read-scoping (288) applies to.
    v_caller_id := auth.uid();

    SELECT su.email INTO v_caller_email
    FROM system.users su WHERE su.id = v_caller_id;

    SELECT r.name INTO v_custom_role
    FROM system.users su
    JOIN tenant.roles r ON r.id = su.custom_role_id
    WHERE su.id = v_caller_id;

    v_is_external_client := lower(coalesce(v_custom_role, '')) LIKE '%external%client%';

    -- First pass: Build basic JSONB fields (non-reference fields)
    FOR v_column_record IN
        SELECT c.column_name, c.data_type
        FROM information_schema.columns c
        WHERE c.table_schema = 'tenant'
        AND c.table_name = v_table_name
        AND c.column_name NOT IN ('id', 'created_at', 'updated_at')
        AND c.column_name NOT IN ('autonumber')
        ORDER BY c.ordinal_position
    LOOP
        -- Check if this column is a reference field. FIXED (290): match
        -- either the exact registered name OR name || '__a' — the
        -- physical column almost always carries the __a suffix while
        -- tenant.fields.name is registered WITHOUT it (see migration
        -- header). Previously only the exact match was tried, so this
        -- check silently never fired for any standard custom field.
        SELECT f.reference_table, f.reference_display_field
        INTO v_reference_table, v_display_field
        FROM tenant.fields f
        WHERE f.object_id = p_object_id
        AND (f.name = v_column_record.column_name OR f.name || '__a' = v_column_record.column_name)
        AND f.type = 'reference';

        IF v_reference_table IS NOT NULL THEN
            -- This is a reference field - we'll handle it in the second pass
            CONTINUE;
        END IF;

        IF v_column_record.column_name = 'certification_body__a' THEN
            v_has_cert_body_col := true;
        END IF;

        -- track whether this table has the two identity columns
        IF v_column_record.column_name = 'client_user_id__a' THEN
            v_has_client_user_id_col := true;
        END IF;
        IF v_column_record.column_name = 'email__a' THEN
            v_has_email_col := true;
        END IF;

        -- Handle different data types safely for non-reference fields
        IF v_column_record.data_type = 'bigint' THEN
            v_jsonb_fields := v_jsonb_fields ||
                CASE
                    WHEN v_jsonb_fields != '' THEN ' || '
                    ELSE ''
                END ||
                'jsonb_build_object(' || quote_literal(v_column_record.column_name) || ', COALESCE(NULLIF(t.' || quote_ident(v_column_record.column_name) || '::text, ''''), NULL))';
        ELSE
            v_jsonb_fields := v_jsonb_fields ||
                CASE
                    WHEN v_jsonb_fields != '' THEN ' || '
                    ELSE ''
                END ||
                'jsonb_build_object(' || quote_literal(v_column_record.column_name) || ', COALESCE(t.' || quote_ident(v_column_record.column_name) || '::text, ''''))';
        END IF;
    END LOOP;

    -- Second pass: Build reference field resolution and JOIN clauses
    -- ONLY for tenant schema tables (skip system.users, auth.users for now)
    -- Also skip created_by and updated_by fields since they're now text fields
    FOR v_field_record IN
        SELECT f.name, f.reference_table, f.reference_display_field
        FROM tenant.fields f
        WHERE f.object_id = p_object_id
        AND f.type = 'reference'
        AND f.reference_table IS NOT NULL
        AND f.reference_table NOT LIKE 'system.%'  -- Skip system tables
        AND f.reference_table != 'auth.users'      -- Skip auth tables
        AND f.reference_table NOT LIKE 'auth.%'    -- Skip all auth tables
        AND f.name NOT IN ('created_by', 'updated_by')  -- Skip these specific fields
    LOOP
        -- Generate unique alias for this JOIN
        v_join_alias := 'ref_' || v_join_counter;

        -- Determine the best display field for the reference table
        IF v_field_record.reference_display_field IS NOT NULL THEN
            v_display_field := v_field_record.reference_display_field;
        ELSE
            -- Auto-detect best display field (prioritize name, label, title)
            SELECT COALESCE(
                (SELECT column_name FROM information_schema.columns
                 WHERE table_schema = 'tenant' AND table_name = v_field_record.reference_table
                 AND column_name = 'name' LIMIT 1),
                (SELECT column_name FROM information_schema.columns
                 WHERE table_schema = 'tenant' AND table_name = v_field_record.reference_table
                 AND column_name = 'label' LIMIT 1),
                (SELECT column_name FROM information_schema.columns
                 WHERE table_schema = 'tenant' AND table_name = v_field_record.reference_table
                 AND column_name = 'title' LIMIT 1),
                'id'
            ) INTO v_display_field;
        END IF;

        -- Build JOIN clause with column name mapping
        -- Handle the case where field name doesn't match actual column name (e.g., "channelPartner" vs "channelPartner__a")
        v_join_clauses := v_join_clauses ||
            ' LEFT JOIN tenant.' || quote_ident(v_field_record.reference_table) || ' ' || v_join_alias ||
            ' ON ' || v_join_alias || '.id = t.' || quote_ident(v_field_record.name || '__a');

        -- Build reference field resolution in JSONB with column name mapping
        v_reference_fields := v_reference_fields ||
            CASE
                WHEN v_reference_fields != '' THEN ' || '
                ELSE ''
            END ||
            'jsonb_build_object(' || quote_literal(v_field_record.name) || ', COALESCE(' || v_join_alias || '.' || quote_ident(v_display_field) || '::text, t.' || quote_ident(v_field_record.name || '__a') || '::text, ''''))';

        v_join_counter := v_join_counter + 1;
    END LOOP;

    -- App-scoping filter (284) — only when the table has the column AND a
    -- value was actually passed in.
    IF v_has_cert_body_col AND p_certification_body IS NOT NULL AND trim(p_certification_body) != '' THEN
        v_where_clause := v_where_clause || ' AND t.certification_body__a = ' || quote_literal(p_certification_body);
    END IF;

    -- caller-identity scoping (288) — only for External_Client__a,
    -- renewal_clients__a, recertification_clients__a, and only when the
    -- caller's own custom role is External Client. Admin and every other
    -- role are untouched. Record matches if EITHER identifier passes.
    IF v_is_external_client
       AND v_table_name IN ('external_clients__a', 'renewal_clients__a', 'recertification_clients__a')
       AND v_has_client_user_id_col
    THEN
        v_where_clause := v_where_clause || ' AND (t.client_user_id__a = ' || quote_literal(coalesce(v_caller_id::text, '')) ||
            CASE
                WHEN v_has_email_col AND v_caller_email IS NOT NULL THEN
                    ' OR lower(t.email__a) = lower(' || quote_literal(v_caller_email) || ')'
                ELSE ''
            END || ')';
    END IF;

    IF v_where_clause != '' THEN
        v_where_clause := ' WHERE ' || substring(v_where_clause from 6); -- strip leading ' AND '
    END IF;

    -- Build the final SQL with reference resolution
    v_select_sql := '
        SELECT
            t.id as record_id,
            jsonb_build_object(
                ''id'', t.id,
                ''created_at'', COALESCE(t.created_at::text, ''''),
                ''updated_at'', COALESCE(t.updated_at::text, '''')
            )' ||
            CASE
                WHEN v_jsonb_fields != '' THEN ' || ' || v_jsonb_fields
                ELSE ''
            END ||
            CASE
                WHEN v_reference_fields != '' THEN ' || ' || v_reference_fields
                ELSE ''
            END || '
        as record_data
        FROM tenant.' || quote_ident(v_table_name) || ' t' ||
        v_join_clauses ||
        v_where_clause || '
        ORDER BY t.created_at DESC
        LIMIT ' || p_limit || '
        OFFSET ' || p_offset;

    RETURN QUERY EXECUTE v_select_sql;
END;
$$;

-- Update the public bridge function as well (unchanged signature)

DROP FUNCTION IF EXISTS public.get_object_records_with_references(UUID, UUID, INTEGER, INTEGER, TEXT);

CREATE OR REPLACE FUNCTION public.get_object_records_with_references(
    p_object_id UUID,
    p_tenant_id UUID,
    p_limit INTEGER DEFAULT 100,
    p_offset INTEGER DEFAULT 0,
    p_certification_body TEXT DEFAULT NULL
)
RETURNS TABLE(
    record_id uuid,
    record_data jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Call tenant function (RLS policies will enforce tenant isolation)
    RETURN QUERY
    SELECT * FROM tenant.get_object_records_with_references(
        p_object_id,
        p_limit,
        p_offset,
        p_certification_body
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_object_records_with_references(UUID, UUID, INTEGER, INTEGER, TEXT) TO authenticated;
