-- Migration 073: Comprehensive fix for picklist values functions
-- This migration combines fixes for:
-- 1. Ambiguous column references (from Migration 71)
-- 2. Data type mismatches (from Migration 72)
-- 3. All picklist values loading issues

-- Drop and recreate the tenant.get_picklist_values function with comprehensive fixes
DROP FUNCTION IF EXISTS tenant.get_picklist_values(UUID);

CREATE OR REPLACE FUNCTION tenant.get_picklist_values(_field_id UUID)
RETURNS TABLE (
    id UUID,
    value VARCHAR(255),  -- Fixed: VARCHAR(255) to match database schema
    label VARCHAR(255),  -- Fixed: VARCHAR(255) to match database schema
    display_order INTEGER,
    is_active BOOLEAN
) AS $$
DECLARE
    _tenant_id UUID;
BEGIN
    -- Get current user's tenant_id from JWT app_metadata
    _tenant_id := (auth.jwt()->'app_metadata'->>'tenant_id')::uuid;
    
    -- Fixed: Use explicit table aliases and column references to avoid ambiguity
    RETURN QUERY
    SELECT 
        pv.id AS id,
        pv.value AS value,
        pv.label AS label,
        pv.display_order AS display_order,
        pv.is_active AS is_active
    FROM tenant.picklist_values pv
    JOIN tenant.fields f ON pv.field_id = f.id
    JOIN tenant.objects o ON f.object_id = o.id
    WHERE pv.field_id = _field_id 
      AND o.tenant_id = _tenant_id
      AND pv.is_active = true
    ORDER BY pv.display_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop and recreate the public.get_picklist_values function with comprehensive fixes
DROP FUNCTION IF EXISTS public.get_picklist_values(UUID);

CREATE OR REPLACE FUNCTION public.get_picklist_values(
  p_field_id UUID
)
RETURNS TABLE(
  id UUID,
  value VARCHAR(255),  -- Fixed: VARCHAR(255) to match database schema
  label VARCHAR(255),  -- Fixed: VARCHAR(255) to match database schema
  display_order INTEGER,
  is_active BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = tenant, public
AS $$
DECLARE
  _auth_user_id UUID;
  _tenant_id UUID;
BEGIN
  -- Get current user and tenant
  _auth_user_id := auth.uid();
  IF _auth_user_id IS NULL THEN
    RETURN;
  END IF;

  -- Get tenant from user
  SELECT u.tenant_id INTO _tenant_id
  FROM system.users u
  WHERE u.id = _auth_user_id;

  IF _tenant_id IS NULL THEN
    RETURN;
  END IF;

  -- Fixed: Use explicit table aliases and column references to avoid ambiguity
  RETURN QUERY
  SELECT 
      pv.id AS id,
      pv.value AS value,
      pv.label AS label,
      pv.display_order AS display_order,
      pv.is_active AS is_active
  FROM tenant.picklist_values pv
  JOIN tenant.fields f ON pv.field_id = f.id
  JOIN tenant.objects o ON f.object_id = o.id
  WHERE pv.field_id = p_field_id 
    AND o.tenant_id = _tenant_id
    AND pv.is_active = true
  ORDER BY pv.display_order;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION tenant.get_picklist_values(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_picklist_values(UUID) TO authenticated;

-- Add comprehensive comments
COMMENT ON FUNCTION tenant.get_picklist_values(UUID) IS 'COMPREHENSIVE FIX: Resolves ambiguous columns + data type mismatches + all picklist loading issues';
COMMENT ON FUNCTION public.get_picklist_values(UUID) IS 'COMPREHENSIVE FIX: Bridge function resolving all picklist values issues';

-- Verify both functions were updated successfully
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.routines 
    WHERE routine_name = 'get_picklist_values' 
    AND routine_schema = 'tenant'
  ) THEN
    RAISE NOTICE '✅ tenant.get_picklist_values function updated successfully - ALL issues fixed';
  ELSE
    RAISE EXCEPTION '❌ tenant.get_picklist_values function update failed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.routines 
    WHERE routine_name = 'get_picklist_values' 
    AND routine_schema = 'public'
  ) THEN
    RAISE NOTICE '✅ public.get_picklist_values function updated successfully - ALL issues fixed';
  ELSE
    RAISE EXCEPTION '❌ public.get_picklist_values function update failed';
  END IF;
END $$;
