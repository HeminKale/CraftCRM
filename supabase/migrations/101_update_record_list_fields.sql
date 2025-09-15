-- Migration 101: Add RPC function to update record list selected fields
-- Purpose: Allow users to update which fields are displayed for a record list

-- Function to update record list selected fields
CREATE OR REPLACE FUNCTION tenant.update_record_list_fields(
  p_record_list_id uuid,
  p_selected_fields text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_result jsonb;
BEGIN
  -- Get tenant ID from JWT
  v_tenant_id := (auth.jwt()->'app_metadata'->>'tenant_id')::uuid;
  
  -- Update only the selected_fields column
  UPDATE tenant.record_lists SET
    selected_fields = p_selected_fields,
    updated_at = NOW()
  WHERE id = p_record_list_id 
    AND tenant_id = v_tenant_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Record list not found or access denied';
  END IF;
  
  -- Return the updated record list
  SELECT jsonb_build_object(
    'id', rl.id,
    'tenant_id', rl.tenant_id,
    'object_id', rl.object_id,
    'name', rl.name,
    'description', rl.description,
    'filter_criteria', rl.filter_criteria,
    'selected_fields', rl.selected_fields,
    'is_active', rl.is_active,
    'created_at', rl.created_at,
    'updated_at', rl.updated_at,
    'created_by', rl.created_by
  ) INTO v_result
  FROM tenant.record_lists rl
  WHERE rl.id = p_record_list_id;
  
  RETURN v_result;
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error in update_record_list_fields: %', SQLERRM;
END;
$$;

-- Bridge function for public access
CREATE OR REPLACE FUNCTION public.update_record_list_fields(
  p_record_list_id uuid,
  p_selected_fields text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN tenant.update_record_list_fields(
    p_record_list_id,
    p_selected_fields
  );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION tenant.update_record_list_fields(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_record_list_fields(uuid, text[]) TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION tenant.update_record_list_fields IS 'Updates the selected_fields for a specific record list';
COMMENT ON FUNCTION public.update_record_list_fields IS 'Public bridge function to update record list selected fields';
