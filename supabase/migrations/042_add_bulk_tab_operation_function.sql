-- Migration: 042_add_bulk_tab_operation_function.sql
-- Description: Add bulk tab operation RPC function to bypass RLS policies
-- Date: [Today's Date]

-- Create bulk tab operation function
-- This function handles bulk operations on app_tabs table with SECURITY DEFINER
-- to bypass RLS policies

CREATE OR REPLACE FUNCTION public.bulk_update_tab_visibility(
  p_updates jsonb,
  p_tenant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  update_record jsonb;
  success_count integer := 0;
  error_count integer := 0;
  result jsonb;
BEGIN
  -- Validate input
  IF p_updates IS NULL OR jsonb_array_length(p_updates) = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'No updates provided',
      'success_count', 0,
      'error_count', 0
    );
  END IF;

  -- Process each update
  FOR update_record IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    BEGIN
      -- Extract values from JSON
      INSERT INTO tenant.app_tabs (
        app_id,
        tab_id,
        tab_order,
        is_visible,
        tenant_id,
        created_at,
        updated_at
      ) VALUES (
        (update_record->>'app_id')::uuid,
        (update_record->>'tab_id')::uuid,
        COALESCE((update_record->>'tab_order')::integer, 1),
        COALESCE((update_record->>'is_visible')::boolean, false),
        p_tenant_id,
        NOW(),
        NOW()
      )
      ON CONFLICT (app_id, tab_id, tenant_id)
      DO UPDATE SET
        tab_order = EXCLUDED.tab_order,
        is_visible = EXCLUDED.is_visible,
        updated_at = NOW();
      
      success_count := success_count + 1;
    EXCEPTION WHEN OTHERS THEN
      error_count := error_count + 1;
      RAISE NOTICE 'Error processing update %: %', update_record, SQLERRM;
    END;
  END LOOP;

  -- Return result
  result := jsonb_build_object(
    'success', true,
    'message', 'Bulk operation completed',
    'success_count', success_count,
    'error_count', error_count,
    'total_processed', jsonb_array_length(p_updates)
  );

  RETURN result;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.bulk_update_tab_visibility(jsonb, uuid) TO authenticated;