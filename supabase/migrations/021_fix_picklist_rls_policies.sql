-- Migration 021: Fix picklist_values RLS policies
-- This fixes the RLS policies to work with our RPC functions

-- Drop the existing policy that uses JWT tenant_id
DROP POLICY IF EXISTS "Tenant Isolation" ON tenant.picklist_values;

-- Create new policies that match our RPC function logic
-- Policy: Users can only see picklist values for their tenant
CREATE POLICY picklist_values_select_tenant ON tenant.picklist_values
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM system.users WHERE id = auth.uid()
    )
  );

-- Policy: Users can only insert picklist values for their tenant
CREATE POLICY picklist_values_insert_tenant ON tenant.picklist_values
  FOR INSERT WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM system.users WHERE id = auth.uid()
    )
  );

-- Policy: Users can only update picklist values for their tenant
CREATE POLICY picklist_values_update_tenant ON tenant.picklist_values
  FOR UPDATE USING (
    tenant_id IN (
      SELECT tenant_id FROM system.users WHERE id = auth.uid()
    )
  );

-- Policy: Users can only delete picklist values for their tenant
CREATE POLICY picklist_values_delete_tenant ON tenant.picklist_values
  FOR DELETE USING (
    tenant_id IN (
      SELECT tenant_id FROM system.users WHERE id = auth.uid()
    )
  );

-- Verify policies were created
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'picklist_values' 
    AND policyname = 'picklist_values_select_tenant'
  ) THEN
    RAISE NOTICE '✅ picklist_values RLS policies created successfully';
  ELSE
    RAISE EXCEPTION '❌ picklist_values RLS policies creation failed';
  END IF;
END $$;
