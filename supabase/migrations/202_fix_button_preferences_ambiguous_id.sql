-- Migration 202: Fix ambiguous column reference in save_button_preferences function

-- Drop and recreate the save_button_preferences function with explicit table references
DROP FUNCTION IF EXISTS public.save_button_preferences(UUID, UUID, UUID[]);

-- Function to save button preferences (FIXED: Explicit column references)
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
    current_button_id UUID;
    preference_id UUID;
    order_counter INTEGER := 0;
BEGIN
  -- First, mark all existing preferences as not selected
  UPDATE tenant.button_preferences__a 
  SET is_selected = false, updated_at = now()
  WHERE object_id = p_object_id AND tenant_id = p_tenant_id;

  -- Then, update or create preferences for selected buttons
  FOREACH current_button_id IN ARRAY p_selected_button_ids
  LOOP
    -- Check if preference already exists (FIXED: Explicit table alias and variable name)
    SELECT bp.id INTO preference_id
    FROM tenant.button_preferences__a bp
    WHERE bp.object_id = p_object_id 
      AND bp.tenant_id = p_tenant_id 
      AND bp.button_id = current_button_id;

    IF preference_id IS NOT NULL THEN
      -- Update existing preference (FIXED: Explicit table reference)
      UPDATE tenant.button_preferences__a 
      SET is_selected = true, 
          display_order = order_counter,
          updated_at = now()
      WHERE tenant.button_preferences__a.id = preference_id;
    ELSE
      -- Create new preference (FIXED: Use renamed variable)
      INSERT INTO tenant.button_preferences__a (
        tenant_id, object_id, button_id, is_selected, display_order
      ) VALUES (
        p_tenant_id, p_object_id, current_button_id, true, order_counter
      );
    END IF;

    order_counter := order_counter + 1;
  END LOOP;

  -- Return updated preferences (FIXED: Explicit table alias)
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

-- Log completion
DO $$
BEGIN
  RAISE NOTICE '✅ Migration 202 completed: Fixed ambiguous column reference in save_button_preferences function';
END $$;
