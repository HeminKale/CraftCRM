-- Drop existing function if it exists (with any parameter signature)
DROP FUNCTION IF EXISTS get_related_list_records(uuid, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS get_related_list_records(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS get_related_list_records(uuid, uuid);
DROP FUNCTION IF EXISTS get_related_list_records(uuid);
DROP FUNCTION IF EXISTS get_related_list_records();

-- Create the related list data bridge function
CREATE OR REPLACE FUNCTION get_related_list_records(
  p_parent_object_id UUID,
  p_parent_record_id UUID,
  p_tenant_id UUID,
  p_related_list_id UUID
)
RETURNS TABLE(
  record_id UUID,
  record_data JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_child_object_id UUID;
  v_foreign_key_field TEXT;
  v_child_table_name TEXT;
  v_sql TEXT;
BEGIN
  -- Get related list metadata
  SELECT child_object_id, foreign_key_field 
  INTO v_child_object_id, v_foreign_key_field
  FROM tenant.related_list_metadata 
  WHERE id = p_related_list_id 
  AND parent_object_id = p_parent_object_id
  AND tenant_id = p_tenant_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Related list not found for object %', p_parent_object_id;
  END IF;
  
  -- Get child object table name
  SELECT name INTO v_child_table_name
  FROM tenant.objects 
  WHERE id = v_child_object_id 
  AND tenant_id = p_tenant_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Child object not found';
  END IF;
  
  -- Build dynamic SQL to fetch related records
  v_sql := format(
    'SELECT id as record_id, to_jsonb(t.*) as record_data, created_at, updated_at 
     FROM tenant.%I t 
     WHERE tenant_id = %L 
     AND %I = %L',
    v_child_table_name,
    p_tenant_id,
    v_foreign_key_field,
    p_parent_record_id
  );
  
  RETURN QUERY EXECUTE v_sql;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_related_list_records TO authenticated;