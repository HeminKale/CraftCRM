-- Migration: 093_auto_create_related_list_metadata.sql
-- Description: Automatically create related_list_metadata when reference fields are created
-- Date: 2024-01-XX

-- Drop the existing trigger first (since it depends on the function)
DROP TRIGGER IF EXISTS trigger_auto_create_related_list_metadata ON tenant.fields;

-- Drop the existing function
DROP FUNCTION IF EXISTS tenant.auto_create_related_list_metadata();

-- Create the updated function with interchanged parent-child logic
CREATE OR REPLACE FUNCTION tenant.auto_create_related_list_metadata()
RETURNS TRIGGER AS $$
DECLARE
  v_referenced_object_id UUID;
  v_referenced_object_label TEXT;
  v_referenced_object_name TEXT;
  v_child_object_name TEXT;
  v_child_object_label TEXT;
  v_related_list_id UUID;
BEGIN
  -- Only process reference fields
  IF NEW.type = 'reference' AND NEW.reference_table IS NOT NULL THEN
    
    -- Get the referenced object details (this will be the PARENT)
    SELECT id, label, name INTO v_referenced_object_id, v_referenced_object_label, v_referenced_object_name
    FROM tenant.objects 
    WHERE name = NEW.reference_table 
    AND tenant_id = NEW.tenant_id;
    
    -- Get the object where the field is created (this will be the CHILD)
    SELECT name, label INTO v_child_object_name, v_child_object_label
    FROM tenant.objects 
    WHERE id = NEW.object_id 
    AND tenant_id = NEW.tenant_id;
    
    -- Check if related list metadata already exists to avoid duplicates
    IF EXISTS (
      SELECT 1 FROM tenant.related_list_metadata 
      WHERE parent_object_id = v_referenced_object_id 
      AND child_object_id = NEW.object_id 
      AND foreign_key_field = NEW.name
      AND tenant_id = NEW.tenant_id
    ) THEN
      RAISE NOTICE 'ℹ️ Related list metadata already exists for field % -> object %', NEW.name, v_referenced_object_name;
      RETURN NEW;
    END IF;
    
    -- Create the related list metadata
    INSERT INTO tenant.related_list_metadata (
      tenant_id,
      parent_object_id,      -- Object P (referenced by field CP)
      child_object_id,       -- Object C (where field CP is created)
      foreign_key_field,     -- Field CP name
      label,                 -- Display label for the related list
      display_columns,       -- Default columns to show
      section,               -- Default section
      display_order,         -- Default order
      is_visible             -- Default visibility
    ) VALUES (
      NEW.tenant_id,
      v_referenced_object_id, -- Object P (referenced by field)
      NEW.object_id,         -- Object C (where field is created)
      NEW.name,              -- Field CP
      COALESCE(v_child_object_label, v_child_object_name, 'Related Records'), -- FIXED: Use child object label
      '["id", "name"]'::jsonb,
      'related',
      0,
      true
    ) RETURNING id INTO v_related_list_id;
    
    RAISE NOTICE '✅ Created related list metadata: ID=%, Parent=%, Child=%, Field=%', 
      v_related_list_id, v_referenced_object_name, v_child_object_name, NEW.name;
    
    -- Log the relationship for debugging
    RAISE NOTICE '🔗 Relationship established: % (parent) -> % (child) via field %', 
      v_referenced_object_label, v_child_object_label, NEW.label;
  END IF;
  
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION tenant.auto_create_related_list_metadata() TO authenticated;

-- Create the trigger
CREATE TRIGGER trigger_auto_create_related_list_metadata
  AFTER INSERT ON tenant.fields
  FOR EACH ROW
  EXECUTE FUNCTION tenant.auto_create_related_list_metadata();

-- Log completion
DO $$
BEGIN
  RAISE NOTICE '✅ Migration 093 completed: Auto-related list metadata creation trigger created';
  RAISE NOTICE '🔗 Parent-Child logic: Referenced objects become parents, referencing objects become children';
  RAISE NOTICE '🏷️ Label logic: Uses child object label for better UX';
END $$;
