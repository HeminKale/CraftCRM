-- File: supabase/migrations/041_add_update_tab_visibility_function.sql

-- Create bridge function for updating tab visibility
-- This follows the same pattern as get_apps, get_app_tabs, etc.

-- Drop if exists
DROP FUNCTION IF EXISTS public.update_tab_visibility(uuid, uuid, boolean, uuid);

-- Create the function
CREATE OR REPLACE FUNCTION public.update_tab_visibility(
    p_app_id uuid,
    p_tab_id uuid,
    p_is_visible boolean,
    p_tenant_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    result json;
BEGIN
    -- Update or insert the app_tabs record
    INSERT INTO tenant.app_tabs (
        app_id,
        tab_id,
        is_visible,
        tenant_id,
        tab_order,
        created_at,
        updated_at
    ) VALUES (
        p_app_id,
        p_tab_id,
        p_is_visible,
        p_tenant_id,
        COALESCE((SELECT tab_order FROM tenant.app_tabs WHERE app_id = p_app_id AND tab_id = p_tab_id), 1),
        COALESCE((SELECT created_at FROM tenant.app_tabs WHERE app_id = p_app_id AND tab_id = p_tab_id), NOW()),
        NOW()
    )
    ON CONFLICT (app_id, tab_id)
    DO UPDATE SET
        is_visible = EXCLUDED.is_visible,
        updated_at = NOW();
    
    -- Return success response
    result := json_build_object(
        'success', true,
        'message', 'Tab visibility updated successfully',
        'app_id', p_app_id,
        'tab_id', p_tab_id,
        'is_visible', p_is_visible
    );
    
    RETURN result;
    
EXCEPTION
    WHEN OTHERS THEN
        -- Return error response
        result := json_build_object(
            'success', false,
            'message', SQLERRM,
            'app_id', p_app_id,
            'tab_id', p_tab_id
        );
        RETURN result;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.update_tab_visibility(uuid, uuid, boolean, uuid) TO authenticated;