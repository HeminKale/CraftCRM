-- ============================================================
-- Migration 266: Surveillance 1 (Renewal) — Sprint 7 RPCs
-- Summary import functions
--
-- Two new RPCs:
--   1. upsert_renewal_from_summary — update renewal record with
--      parsed summary data (text fields only; dates handled separately)
--   2. append_renewal_audit_pack_entry — attach uploaded summary
--      sheet to surv_audit_pack__a
--
-- Both reuse patterns from External Client's migration 241
-- (upsert_client_summary + append_audit_pack_entry).
-- ============================================================

-- ================================================================
-- upsert_renewal_from_summary
--
-- Called by SurveilanceImport.tsx after parsing the Excel sheet.
-- Updates a renewal record with parsed metadata (text fields) and
-- optional status advancement. Date fields are written directly
-- as columns by the caller in a separate update_tenant_record call.
--
-- Parameters:
--   p_record_id — the renewal_clients__a.id to update
--   p_data — JSONB with keys matching column names (without __a suffix):
--     {certificate_no, country, scope, iaf_code, no_of_employees,
--      surv_mandays, auditor_name, tech_reviewer_name, director_name,
--      auditor_team, application_reviewer, lead_auditor, food_category,
--      soa_date, status__a (optional, for direct status advance)}
-- ================================================================
DROP FUNCTION IF EXISTS public.upsert_renewal_from_summary(UUID, JSONB);

CREATE OR REPLACE FUNCTION public.upsert_renewal_from_summary(
  p_record_id UUID,
  p_data      JSONB
)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _tenant_id   UUID;
  _exists      BOOLEAN;
  _update_sql  TEXT;
  _col_name    TEXT;
  _col_value   TEXT;
BEGIN
  -- Resolve caller's tenant
  SELECT tenant_id INTO _tenant_id FROM system.users WHERE id = auth.uid();
  IF _tenant_id IS NULL THEN
    RETURN QUERY SELECT false, 'Not authenticated'::TEXT;
    RETURN;
  END IF;

  -- Verify record exists and belongs to this tenant
  SELECT EXISTS(
    SELECT 1 FROM tenant.renewal_clients__a
    WHERE id = p_record_id AND tenant_id = _tenant_id
  ) INTO _exists;

  IF NOT _exists THEN
    RETURN QUERY SELECT false, 'Renewal record not found'::TEXT;
    RETURN;
  END IF;

  -- Build dynamic UPDATE for each key in p_data that isn't NULL
  -- Only update columns where the value is non-null (respect blanks
  -- that the user explicitly set in the spreadsheet)
  _update_sql := 'UPDATE tenant.renewal_clients__a SET ';
  FOR _col_name, _col_value IN
    SELECT key, value FROM jsonb_each_text(p_data)
  LOOP
    -- Skip null values; skip status (handled separately if at all)
    IF _col_value IS NOT NULL AND _col_name != 'status__a' THEN
      _update_sql := _update_sql || format('%I__a = %L, ', _col_name, _col_value);
    END IF;
  END LOOP;

  -- If no columns were found, return early
  IF _update_sql = 'UPDATE tenant.renewal_clients__a SET ' THEN
    RETURN QUERY SELECT true, 'No changes to apply'::TEXT;
    RETURN;
  END IF;

  -- Remove trailing ", " and add WHERE clause
  _update_sql := rtrim(_update_sql, ', ') ||
                 format(' WHERE id = %L AND tenant_id = %L', p_record_id, _tenant_id);

  EXECUTE _update_sql;

  -- If status__a is in p_data, update it separately (direct write, not column-based)
  IF p_data ? 'status__a' AND (p_data->>'status__a') IS NOT NULL THEN
    UPDATE tenant.renewal_clients__a
    SET status__a = p_data->>'status__a'
    WHERE id = p_record_id AND tenant_id = _tenant_id;
  END IF;

  RETURN QUERY SELECT true, 'Updated'::TEXT;
END $$;

-- ================================================================
-- append_renewal_audit_pack_entry
--
-- Called by SurveilanceImport.tsx's apply() method after uploading
-- the summary sheet to Storage, to attach it to surv_audit_pack__a.
--
-- surv_audit_pack__a is a JSONB array of file objects:
-- [{name, url, size, uploadedAt}, ...]
--
-- This function appends a new entry to the array (or creates the
-- array if empty).
--
-- Parameters:
--   p_record_id — the renewal_clients__a.id
--   p_file_json — JSONB object: {name, url, size, uploadedAt}
-- ================================================================
DROP FUNCTION IF EXISTS public.append_renewal_audit_pack_entry(UUID, JSONB);

CREATE OR REPLACE FUNCTION public.append_renewal_audit_pack_entry(
  p_record_id UUID,
  p_file_json JSONB
)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _tenant_id UUID;
BEGIN
  SELECT tenant_id INTO _tenant_id FROM system.users WHERE id = auth.uid();
  IF _tenant_id IS NULL THEN
    RETURN QUERY SELECT false, 'Not authenticated'::TEXT;
    RETURN;
  END IF;

  UPDATE tenant.renewal_clients__a
  SET surv_audit_pack__a =
    CASE
      WHEN surv_audit_pack__a = '{}'::jsonb OR surv_audit_pack__a IS NULL
      THEN jsonb_build_array(p_file_json)
      ELSE surv_audit_pack__a || jsonb_build_array(p_file_json)
    END,
    updated_at = now()
  WHERE id = p_record_id AND tenant_id = _tenant_id;

  RETURN QUERY SELECT true, 'File attached'::TEXT;
END $$;
