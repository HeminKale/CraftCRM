-- Migration 007: Tenant Schema Bridge Functions
-- Craft App - Enable frontend access to tenant schema through public functions
-- ================================

-- ===========================================
-- 1. ADD MISSING COLUMN TO TENANT.OBJECTS
-- ===========================================

ALTER TABLE tenant.objects 
ADD COLUMN IF NOT EXISTS is_system_object BOOLEAN DEFAULT FALSE;

-- ===========================================
-- 2. CREATE BRIDGE FUNCTIONS FOR TENANT SCHEMA
-- ===========================================

-- Bridge function to get objects for a tenant
CREATE OR REPLACE FUNCTION public.get_tenant_objects(p_tenant_id UUID)
RETURNS TABLE(
  id UUID, 
  name TEXT, 
  label TEXT, 
  description TEXT, 
  is_system_object BOOLEAN,
  is_active BOOLEAN,
  tenant_id UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT o.id, o.name, o.label, o.description, o.is_system_object, 
         o.is_active, o.tenant_id, o.created_at, o.updated_at
  FROM tenant.objects o
  WHERE o.tenant_id = p_tenant_id
  AND o.is_active = true
  ORDER BY o.label;
END;
$$;

-- Bridge function to create objects (FIXED: all parameters after default must have defaults)
CREATE OR REPLACE FUNCTION public.create_tenant_object(
  p_name TEXT,
  p_label TEXT,
  p_tenant_id UUID,
  p_description TEXT DEFAULT NULL,
  p_is_system_object BOOLEAN DEFAULT FALSE
)
RETURNS TABLE(id UUID, name TEXT, label TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_object tenant.objects;
BEGIN
  INSERT INTO tenant.objects (name, label, description, is_system_object, is_active, tenant_id)
  VALUES (p_name, p_label, p_description, p_is_system_object, true, p_tenant_id)
  RETURNING * INTO new_object;
  
  RETURN QUERY
  SELECT new_object.id, new_object.name, new_object.label;
END;
$$;

-- Bridge function to get fields for an object
CREATE OR REPLACE FUNCTION public.get_tenant_fields(p_object_id UUID, p_tenant_id UUID)
RETURNS TABLE(
  id UUID,
  object_id UUID,
  name TEXT,
  label TEXT,
  type TEXT,
  is_required BOOLEAN,
  is_nullable BOOLEAN,
  default_value TEXT,
  validation_rules JSONB,
  display_order INTEGER,
  section VARCHAR,
  width VARCHAR,
  is_visible BOOLEAN,
  is_system_field BOOLEAN,
  reference_table VARCHAR,
  reference_display_field VARCHAR,
  tenant_id UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT f.id, f.object_id, f.name, f.label, f.type, f.is_required, f.is_nullable,
         f.default_value, f.validation_rules, f.display_order, f.section, f.width,
         f.is_visible, f.is_system_field, f.reference_table, f.reference_display_field,
         f.tenant_id, f.created_at, f.updated_at
  FROM tenant.fields f
  WHERE f.object_id = p_object_id
  AND f.tenant_id = p_tenant_id
  ORDER BY f.display_order;
END;
$$;

-- Bridge function to create fields
CREATE OR REPLACE FUNCTION public.create_tenant_field(
  p_object_id UUID,
  p_name TEXT,
  p_label TEXT,
  p_type TEXT,
  p_tenant_id UUID,
  p_is_required BOOLEAN DEFAULT FALSE,
  p_is_nullable BOOLEAN DEFAULT TRUE,
  p_default_value TEXT DEFAULT NULL,
  p_validation_rules JSONB DEFAULT '[]'::jsonb,
  p_display_order INTEGER DEFAULT 0,
  p_section VARCHAR DEFAULT 'details',
  p_width VARCHAR DEFAULT 'half',
  p_is_visible BOOLEAN DEFAULT TRUE,
  p_is_system_field BOOLEAN DEFAULT FALSE,
  p_reference_table VARCHAR DEFAULT NULL,
  p_reference_display_field VARCHAR DEFAULT NULL
)
RETURNS TABLE(id UUID, name TEXT, label TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_field tenant.fields;
BEGIN
  INSERT INTO tenant.fields (
    object_id, name, label, type, is_required, is_nullable, default_value,
    validation_rules, display_order, section, width, is_visible, is_system_field,
    reference_table, reference_display_field, tenant_id
  )
  VALUES (
    p_object_id, p_name, p_label, p_type, p_is_required, p_is_nullable, p_default_value,
    p_validation_rules, p_display_order, p_section, p_width, p_is_visible, p_is_system_field,
    p_reference_table, p_reference_display_field, p_tenant_id
  )
  RETURNING * INTO new_field;
  
  RETURN QUERY
  SELECT new_field.id, new_field.name, new_field.label;
END;
$$;

-- ===========================================
-- 3. GRANT EXECUTE PERMISSIONS
-- ===========================================

GRANT EXECUTE ON FUNCTION public.get_tenant_objects(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_tenant_object(TEXT, TEXT, UUID, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_fields(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_tenant_field(UUID, TEXT, TEXT, TEXT, UUID, BOOLEAN, BOOLEAN, TEXT, JSONB, INTEGER, VARCHAR, VARCHAR, BOOLEAN, BOOLEAN, VARCHAR, VARCHAR) TO authenticated;

-- ===========================================
-- 4. ADD COMMENTS FOR CLARITY
-- ===========================================

COMMENT ON FUNCTION public.get_tenant_objects(UUID) IS 'Bridge function to access tenant.objects through REST API';
COMMENT ON FUNCTION public.create_tenant_object(TEXT, TEXT, UUID, TEXT, BOOLEAN) IS 'Bridge function to create objects in tenant.objects through REST API';
COMMENT ON FUNCTION public.get_tenant_fields(UUID, UUID) IS 'Bridge function to access tenant.fields through REST API';
COMMENT ON FUNCTION public.create_tenant_field(UUID, TEXT, TEXT, TEXT, UUID, BOOLEAN, BOOLEAN, TEXT, JSONB, INTEGER, VARCHAR, VARCHAR, BOOLEAN, BOOLEAN, VARCHAR, VARCHAR) IS 'Bridge function to create fields in tenant.fields through REST API';

-- ===========================================
-- 5. INSERT SOME SYSTEM OBJECTS (OPTIONAL)
-- ===========================================

-- Uncomment and modify these lines to add system objects for your tenant
-- INSERT INTO tenant.objects (name, label, description, is_system_object, is_active, tenant_id) VALUES
-- ('accounts', 'Accounts', 'Company accounts and organizations', true, true, 'your-tenant-id-here'),
-- ('contacts', 'Contacts', 'Individual contacts and people', true, true, 'your-tenant-id-here'),
-- ('leads', 'Leads', 'Sales leads and prospects', true, true, 'your-tenant-id-here'); 