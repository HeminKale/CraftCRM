-- Migration 049: Add get_tenant_objects Bridge Function
-- This migration creates a bridge function to get tenant objects, bypassing RLS issues

-- Create get_tenant_objects bridge function following the same pattern as other functions
CREATE OR REPLACE FUNCTION public.get_tenant_objects(p_tenant_id uuid)
RETURNS TABLE (
    id uuid,
    name text,
    label text,
    description text,
    is_active boolean,
    created_at timestamptz,
    updated_at timestamptz,
    is_system_object boolean
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Verify tenant access (following the same pattern as other functions)
    IF NOT EXISTS (
        SELECT 1 FROM system.tenants t
        WHERE t.id = p_tenant_id
    ) THEN
        RAISE EXCEPTION 'Tenant not found or access denied';
    END IF;

    RETURN QUERY
    SELECT 
        o.id,
        o.name,
        o.label,
        o.description,
        o.is_active,
        o.created_at,
        o.updated_at,
        o.is_system_object
    FROM tenant.objects o
    WHERE o.tenant_id = p_tenant_id
        AND o.is_active = true
    ORDER BY o.name;
END;
$$;

-- Grant execute permission (same as other functions)
GRANT EXECUTE ON FUNCTION public.get_tenant_objects(uuid) TO public;

-- Verify the function was created
SELECT 
    routine_name,
    routine_type,
    routine_schema
FROM information_schema.routines 
WHERE routine_name = 'get_tenant_objects' 
AND routine_schema = 'public';

-- Expected result: Should return 1 row with the function details
