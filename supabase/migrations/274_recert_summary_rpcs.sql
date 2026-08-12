-- ============================================================
-- Migration 274: Recertification — Summary Excel Import, RPCs
--
-- Two new RPCs, mirroring Surveillance 1's 272 exactly in shape:
--   1. upsert_recert_from_summary — update a recertification record with
--      parsed summary text fields (dates are written separately by the
--      caller via the generic update_tenant_record, same split
--      SurveilanceImport.tsx already uses).
--   2. append_recert_summary_pack_entry — attach the uploaded summary
--      sheet to recert_summary_pack__a.
--
-- One deliberate correction versus 272's append_renewal_audit_pack_entry:
-- that function's "is this array empty" check tested for '{}'::jsonb (an
-- empty object), even though the column is always treated as an array in
-- practice — a pre-existing minor inconsistency there. recert_summary_pack__a
-- defaults to '[]'::jsonb (migration 273), so this function checks against
-- that instead, matching what the column actually is from the start.
-- ============================================================

-- ================================================================
-- upsert_recert_from_summary
--
-- Called by RecertificationImport.tsx after parsing the Excel sheet.
-- Text fields only — date fields go through update_tenant_record
-- directly in the frontend (p_table_name, p_record_id, p_tenant_id,
-- p_update_data — migration 231, the latest of its three redefinitions;
-- getting this signature wrong is exactly the bug SurveilanceImport.tsx
-- had to fix, not repeated here since this RPC and the frontend caller
-- were written together against the verified real signature).
--
-- Parameters:
--   p_record_id — the recertification_clients__a.id to update
--   p_data — JSONB with keys matching column names (without __a suffix)
-- ================================================================
DROP FUNCTION IF EXISTS public.upsert_recert_from_summary(UUID, JSONB);

CREATE OR REPLACE FUNCTION public.upsert_recert_from_summary(
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
    SELECT 1 FROM tenant.recertification_clients__a
    WHERE id = p_record_id AND tenant_id = _tenant_id
  ) INTO _exists;

  IF NOT _exists THEN
    RETURN QUERY SELECT false, 'Recertification record not found'::TEXT;
    RETURN;
  END IF;

  -- Build dynamic UPDATE for each key in p_data that isn't NULL
  -- Only update columns where the value is non-null (respect blanks
  -- that the user explicitly set in the spreadsheet)
  _update_sql := 'UPDATE tenant.recertification_clients__a SET ';
  FOR _col_name, _col_value IN
    SELECT key, value FROM jsonb_each_text(p_data)
  LOOP
    -- Skip null values; skip status (handled separately if at all)
    IF _col_value IS NOT NULL AND _col_name != 'status__a' THEN
      _update_sql := _update_sql || format('%I__a = %L, ', _col_name, _col_value);
    END IF;
  END LOOP;

  -- If no columns were found, return early
  IF _update_sql = 'UPDATE tenant.recertification_clients__a SET ' THEN
    RETURN QUERY SELECT true, 'No changes to apply'::TEXT;
    RETURN;
  END IF;

  -- Remove trailing ", " and add WHERE clause
  _update_sql := rtrim(_update_sql, ', ') ||
                 format(' WHERE id = %L AND tenant_id = %L', p_record_id, _tenant_id);

  EXECUTE _update_sql;

  -- If status__a is in p_data, update it separately (direct write, not column-based)
  IF p_data ? 'status__a' AND (p_data->>'status__a') IS NOT NULL THEN
    UPDATE tenant.recertification_clients__a
    SET status__a = p_data->>'status__a'
    WHERE id = p_record_id AND tenant_id = _tenant_id;
  END IF;

  RETURN QUERY SELECT true, 'Updated'::TEXT;
END $$;

-- ================================================================
-- append_recert_summary_pack_entry
--
-- Called by RecertificationImport.tsx's apply() method after uploading
-- the summary sheet to Storage, to attach it to recert_summary_pack__a.
--
-- recert_summary_pack__a is a JSONB array of file objects:
-- [{name, bucket, path, size, uploadedAt}, ...] — bucket+path, NOT a
-- stored `url`, so SummaryDetail's download button can sign a fresh URL
-- on demand (same shape ClientSummaryTab.tsx's downloadAudit and
-- SurveilanceSummaryTab.tsx's downloadAudit both already expect).
--
-- Parameters:
--   p_record_id — the recertification_clients__a.id
--   p_file_json — JSONB object: {name, bucket, path, size, uploadedAt}
-- ================================================================
DROP FUNCTION IF EXISTS public.append_recert_summary_pack_entry(UUID, JSONB);

CREATE OR REPLACE FUNCTION public.append_recert_summary_pack_entry(
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

  UPDATE tenant.recertification_clients__a
  SET recert_summary_pack__a =
    CASE
      WHEN recert_summary_pack__a = '[]'::jsonb OR recert_summary_pack__a IS NULL
      THEN jsonb_build_array(p_file_json)
      ELSE recert_summary_pack__a || jsonb_build_array(p_file_json)
    END,
    updated_at = now()
  WHERE id = p_record_id AND tenant_id = _tenant_id;

  RETURN QUERY SELECT true, 'File attached'::TEXT;
END $$;

GRANT EXECUTE ON FUNCTION public.upsert_recert_from_summary(UUID, JSONB)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.append_recert_summary_pack_entry(UUID, JSONB)   TO authenticated;
