-- ============================================================
-- Migration 288: Scope list/detail reads to the caller's own records
--                 for the External Client role
--
-- ── The gap this closes ─────────────────────────────────────────────
-- get_object_records_with_references (live body: 129, extended by 284
-- for app-scoping) is the function BOTH TabContent.tsx's list view AND
-- RecordDetailView.tsx's detail view call to read external_clients__a,
-- renewal_clients__a, and recertification_clients__a. Its generated SQL
-- has never had any filter tied to the caller's own identity — only
-- 284's app-scoping WHERE clause. Every write-side action RPC on these
-- three objects (accept/reject/upload — 213, 237, 248, 264, 278, etc.)
-- already gates on "only the linked client may act on their own record",
-- but nothing gated who could *read* which records. A user with the
-- External Client custom role could browse every client's record across
-- the whole tenant, not just their own — confirmed by direct code
-- inspection this session, not assumed.
--
-- ── Identification: two checks, not one, in this priority order ────
-- 1. PRIMARY — client_user_id__a = auth.uid(). The record's authoritative
--    UUID link to one specific logged-in user.
-- 2. FALLBACK — lower(email__a) = lower(caller's system.users.email).
--    Needed because client_user_id__a is frequently NULL in practice:
--    it's deliberately excluded from every generic edit form (see
--    project_certification_body_app_scoping's field-tampering
--    rationale — same treatment as created_by/updated_by), so there is
--    currently no UI path for CRM/Admin to set it when they create a
--    record on a client's behalf. It only auto-populates via the
--    migration-215 trigger, which only fires if the client self-created
--    the record. email__a is the email CRM typed onto the record itself
--    at intake — not looked up live from anywhere else.
--
-- This is NOT a new mechanism invented for this migration — it's the
-- exact dual-check migration 287 already introduced for 3 Surveillance-1
-- (renewal_clients__a) WRITE RPCs, for the same reason (client_user_id__a
-- unreliability). 287 explicitly left External Client / Recertification
-- on the old UUID-only check and explicitly scoped itself to writes only.
-- This migration is the first to (a) apply the same dual-check to READS,
-- and (b) extend it to all three client objects for consistency.
--
-- A record matches if EITHER check passes. Admin and every other role
-- (CRM Office, Auditor, Tech Reviewer, CDC) are completely unaffected —
-- the added WHERE fragment only applies when the caller's own custom
-- role is External Client. Every other object in the tenant (anything
-- that isn't one of these 3 client tables) is also completely
-- unaffected — same additive-only discipline as every prior
-- cross-cutting migration in this epic (282-287).
--
-- Reproduces 284's full body verbatim (both the tenant function and its
-- public bridge) plus the one new caller-identity WHERE fragment.
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
    -- NEW (288): caller-identity scoping for the External Client role
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

    -- NEW (288): resolve caller identity + role once, only relevant for
    -- the 3 client tables this scoping applies to.
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
        -- Check if this column is a reference field
        SELECT f.reference_table, f.reference_display_field
        INTO v_reference_table, v_display_field
        FROM tenant.fields f
        WHERE f.object_id = p_object_id
        AND f.name = v_column_record.column_name
        AND f.type = 'reference';

        IF v_reference_table IS NOT NULL THEN
            -- This is a reference field - we'll handle it in the second pass
            CONTINUE;
        END IF;

        IF v_column_record.column_name = 'certification_body__a' THEN
            v_has_cert_body_col := true;
        END IF;

        -- NEW (288): track whether this table has the two identity columns
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

    -- NEW (288): caller-identity scoping — only for External_Client__a,
    -- renewal_clients__a, recertification_clients__a, and only when the
    -- caller's own custom role is External Client. Admin and every other
    -- role are untouched. Record matches if EITHER identifier passes —
    -- see migration header for why two checks instead of one.
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

-- Update the public bridge function as well (unchanged signature — no new
-- params needed, caller identity is resolved via auth.uid() internally)

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
