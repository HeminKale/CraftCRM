-- Migration 201: Create Button Preferences RPC Functions

-- Function to get button preferences for an object
CREATE OR REPLACE FUNCTION public.get_button_preferences(
    p_object_id UUID,
    p_tenant_id UUID
)
RETURNS TABLE(
    id UUID,
    button_id UUID,
    is_selected BOOLEAN,
    display_order INTEGER,
    button_name TEXT,
    button_label TEXT,
    button_type TEXT,
    custom_component_path TEXT,
    action_type TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant, public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    bp.id,
    bp.button_id,
    bp.is_selected,
    bp.display_order,
    b.name::TEXT as button_name,
    b.label__a::TEXT as button_label,
    b.button_type__a::TEXT as button_type,
    b.custom_component_path__a::TEXT as custom_component_path,
    b.action_type__a::TEXT as action_type
  FROM tenant.button_preferences__a bp
  JOIN tenant.button__a b ON bp.button_id = b.id
  WHERE bp.object_id = p_object_id 
    AND bp.tenant_id = p_tenant_id
  ORDER BY bp.display_order, bp.created_at;
END;
$$;

-- Function to save button preferences
CREATE OR REPLACE FUNCTION public.save_button_preferences(
    p_object_id UUID,
    p_tenant_id UUID,
    p_selected_button_ids UUID[]
)
RETURNS TABLE(
    id UUID,
    button_id UUID,
    is_selected BOOLEAN,
    display_order INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant, public
AS $$
DECLARE
    button_id UUID;
    preference_id UUID;
    order_counter INTEGER := 0;
BEGIN
  -- First, mark all existing preferences as not selected
  UPDATE tenant.button_preferences__a 
  SET is_selected = false, updated_at = now()
  WHERE object_id = p_object_id AND tenant_id = p_tenant_id;

  -- Then, update or create preferences for selected buttons
  FOREACH button_id IN ARRAY p_selected_button_ids
  LOOP
    -- Check if preference already exists
    SELECT bp.id INTO preference_id
    FROM tenant.button_preferences__a bp
    WHERE bp.object_id = p_object_id 
      AND bp.tenant_id = p_tenant_id 
      AND bp.button_id = button_id;

    IF preference_id IS NOT NULL THEN
      -- Update existing preference
      UPDATE tenant.button_preferences__a 
      SET is_selected = true, 
          display_order = order_counter,
          updated_at = now()
      WHERE tenant.button_preferences__a.id = preference_id;
    ELSE
      -- Create new preference
      INSERT INTO tenant.button_preferences__a (
        tenant_id, object_id, button_id, is_selected, display_order
      ) VALUES (
        p_tenant_id, p_object_id, button_id, true, order_counter
      );
    END IF;

    order_counter := order_counter + 1;
  END LOOP;

  -- Return updated preferences
  RETURN QUERY
  SELECT 
    bp.id,
    bp.button_id,
    bp.is_selected,
    bp.display_order
  FROM tenant.button_preferences__a bp
  WHERE bp.object_id = p_object_id 
    AND bp.tenant_id = p_tenant_id
    AND bp.is_selected = true
  ORDER BY bp.display_order;
END;
$$;

-- Function to clear all button preferences for an object
CREATE OR REPLACE FUNCTION public.clear_button_preferences(
    p_object_id UUID,
    p_tenant_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant, public
AS $$
BEGIN
  UPDATE tenant.button_preferences__a 
  SET is_selected = false, updated_at = now()
  WHERE object_id = p_object_id AND tenant_id = p_tenant_id;
  
  RETURN TRUE;
END;
$$;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE '✅ Migration 201 completed: Created button preferences RPC functions';
END $$;
