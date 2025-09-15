-- Migration 015: File Upload System
-- Craft App - Add secure, tenant-scoped file upload capabilities
-- ================================

-- ===========================================
-- 1. CREATE ATTACHMENTS TABLE
-- ===========================================

CREATE TABLE IF NOT EXISTS tenant.attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  object_id UUID NOT NULL,           -- which custom object
  record_id UUID NOT NULL,           -- which row in that object table
  field_id UUID NOT NULL,            -- which field (custom field)
  storage_bucket TEXT NOT NULL DEFAULT 'tenant-uploads',
  storage_path TEXT NOT NULL,        -- canonical path in storage
  filename TEXT NOT NULL,
  mime_type TEXT,
  byte_size BIGINT,
  version INTEGER NOT NULL DEFAULT 1,    -- optional versioning
  uploaded_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL,       -- soft delete
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  -- Foreign key constraints
  CONSTRAINT fk_attachments_tenant FOREIGN KEY (tenant_id) REFERENCES system.tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_attachments_object FOREIGN KEY (object_id) REFERENCES tenant.objects(id) ON DELETE CASCADE,
  CONSTRAINT fk_attachments_field FOREIGN KEY (field_id) REFERENCES tenant.fields(id) ON DELETE CASCADE,
  CONSTRAINT fk_attachments_uploader FOREIGN KEY (uploaded_by) REFERENCES system.users(id)
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_attachments_tenant_object_record_field 
ON tenant.attachments (tenant_id, object_id, record_id, field_id);

CREATE INDEX IF NOT EXISTS idx_attachments_uploaded_by 
ON tenant.attachments (uploaded_by);

CREATE INDEX IF NOT EXISTS idx_attachments_created_at 
ON tenant.attachments (created_at);

CREATE INDEX IF NOT EXISTS idx_attachments_deleted_at 
ON tenant.attachments (deleted_at) WHERE deleted_at IS NULL;

-- Add updated_at trigger
CREATE TRIGGER update_attachments_updated_at 
BEFORE UPDATE ON tenant.attachments 
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===========================================
-- 2. ENABLE RLS ON ATTACHMENTS
-- ===========================================

ALTER TABLE tenant.attachments ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only access attachments from their tenant
CREATE POLICY "attachments_tenant_isolation" ON tenant.attachments
FOR ALL USING (
  tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid
);

-- ===========================================
-- 3. UPDATE TENANT.ADD_FIELD TO SUPPORT FILE TYPES
-- ===========================================

CREATE OR REPLACE FUNCTION tenant.add_field(
    _object_id UUID,
    _field_name TEXT,
    _label TEXT,
    _field_type TEXT,
    _is_required BOOLEAN DEFAULT false,
    _default_value TEXT DEFAULT NULL,
    _validation_rules JSONB DEFAULT NULL,
    _section TEXT DEFAULT 'General',
    _width INTEGER DEFAULT 100,
    _is_visible BOOLEAN DEFAULT true
)
RETURNS UUID AS $$
DECLARE
    _tenant_id UUID;
    _object_name TEXT;
    _field_id UUID;
    _sql TEXT;
    _column_definition TEXT;
    _table_name TEXT;
    _final_field_name TEXT;
    _auth_user_id UUID;
BEGIN
    -- Get current user's ID
    _auth_user_id := auth.uid();
    
    IF _auth_user_id IS NULL THEN
        RAISE EXCEPTION 'User not authenticated';
    END IF;

    -- Validate field name format
    IF _field_name !~ '^[a-z][a-z0-9_]*$' THEN
        RAISE EXCEPTION 'Invalid field api name "%" (use snake_case)', _field_name;
    END IF;

    -- Get tenant_id from system.users (primary method)
    SELECT tenant_id INTO _tenant_id 
    FROM system.users 
    WHERE id = _auth_user_id;
    
    -- Fallback: try JWT app_metadata if system.users lookup fails
    IF _tenant_id IS NULL THEN
        _tenant_id := (auth.jwt()->'app_metadata'->>'tenant_id')::uuid;
    END IF;
    
    IF _tenant_id IS NULL THEN
        RAISE EXCEPTION 'User not associated with any tenant. Please contact administrator.';
    END IF;

    -- Get object name
    SELECT name INTO _object_name 
    FROM tenant.objects 
    WHERE id = _object_id AND tenant_id = _tenant_id;
    
    IF _object_name IS NULL THEN
        RAISE EXCEPTION 'Object not found or access denied';
    END IF;

    -- Generate field name with __a suffix if it's a custom field
    IF _field_name NOT IN ('name', 'email', 'phone', 'created_at', 'updated_at', 'created_by', 'updated_by') THEN
        _final_field_name := _field_name || '__a';
    ELSE
        _final_field_name := _field_name;
    END IF;
    
    -- Check if field already exists in metadata
    IF EXISTS (
        SELECT 1 FROM tenant.fields 
        WHERE object_id = _object_id AND name = _final_field_name
    ) THEN
        RAISE EXCEPTION 'Field with name "%" already exists on this object', _field_name;
    END IF;

    -- Check if column already exists in actual table (metadata sync guard)
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'tenant' AND table_name = _object_name AND column_name = _final_field_name
    ) THEN
        RAISE EXCEPTION 'Column "%" already exists on "%"', _final_field_name, _object_name;
    END IF;

    -- Insert field definition
    INSERT INTO tenant.fields (
        tenant_id, object_id, name, label, type, is_required, 
        default_value, validation_rules, section, width, is_visible
    )
    VALUES (
        _tenant_id, _object_id, _final_field_name, _label, _field_type, _is_required,
        _default_value, _validation_rules, _section, _width, _is_visible
    )
    RETURNING id INTO _field_id;

    -- Build column definition with COMPLETE TYPE MAPPING (including file types)
    CASE _field_type
        -- TEXT TYPES
        WHEN 'text' THEN _column_definition := 'TEXT';
        WHEN 'longtext' THEN _column_definition := 'TEXT';
        
        -- NUMERIC TYPES
        WHEN 'integer' THEN _column_definition := 'INTEGER';
        WHEN 'number' THEN _column_definition := 'NUMERIC';
        WHEN 'decimal(10,2)' THEN _column_definition := 'DECIMAL(10,2)';
        WHEN 'money' THEN _column_definition := 'DECIMAL(15,2)';
        WHEN 'percent' THEN _column_definition := 'DECIMAL(5,2)';
        
        -- BOOLEAN
        WHEN 'boolean' THEN _column_definition := 'BOOLEAN';
        
        -- DATE/TIME TYPES
        WHEN 'date' THEN _column_definition := 'DATE';
        WHEN 'datetime' THEN _column_definition := 'TIMESTAMPTZ';
        WHEN 'timestamptz' THEN _column_definition := 'TIMESTAMPTZ';
        WHEN 'time' THEN _column_definition := 'TIME';
        
        -- IDENTIFIER TYPES
        WHEN 'uuid' THEN _column_definition := 'UUID';
        WHEN 'reference' THEN _column_definition := 'UUID';
        
        -- COMPLEX TYPES
        WHEN 'jsonb' THEN _column_definition := 'JSONB';
        WHEN 'json' THEN _column_definition := 'JSONB';
        WHEN 'picklist' THEN _column_definition := 'TEXT';
        WHEN 'multiselect' THEN _column_definition := 'JSONB';
        
        -- SPECIALIZED TYPES
        WHEN 'email' THEN _column_definition := 'TEXT';
        WHEN 'url' THEN _column_definition := 'TEXT';
        WHEN 'phone' THEN _column_definition := 'TEXT';
        WHEN 'image' THEN _column_definition := 'TEXT';
        WHEN 'file' THEN _column_definition := 'JSONB';  -- Single file metadata
        WHEN 'files' THEN _column_definition := 'JSONB'; -- Array of file metadata
        WHEN 'color' THEN _column_definition := 'VARCHAR(7)'; -- #RRGGBB
        WHEN 'rating' THEN _column_definition := 'INTEGER';
        
        -- DEFAULT FALLBACK
        ELSE _column_definition := 'TEXT';
    END CASE;

    -- Handle dynamic type parsing for varchar(n) and decimal(p,s)
    IF _field_type ~* '^varchar\(\d+\)$' THEN
        _column_definition := lower(_field_type);
    ELSIF _field_type ~* '^decimal\(\d+,\d+\)$' THEN
        _column_definition := 'numeric' || substring(lower(_field_type) from '\(\d+,\d+\)');
    END IF;

    -- Add NOT NULL if required
    IF _is_required THEN
        _column_definition := _column_definition || ' NOT NULL';
    END IF;

    -- Add default value if provided (with proper type casting)
    IF _default_value IS NOT NULL THEN
        CASE _field_type
            WHEN 'integer', 'number', 'decimal(10,2)', 'money', 'percent', 'rating' THEN
                _column_definition := _column_definition || ' DEFAULT ' || _default_value;
            WHEN 'boolean' THEN
                _column_definition := _column_definition || ' DEFAULT ' || _default_value;
            WHEN 'date', 'datetime', 'timestamptz', 'time' THEN
                _column_definition := _column_definition || ' DEFAULT ' || quote_literal(_default_value) || '::' || 
                    CASE _field_type
                        WHEN 'date' THEN 'date'
                        WHEN 'time' THEN 'time'
                        ELSE 'timestamptz'
                    END;
            ELSE
                _column_definition := _column_definition || ' DEFAULT ' || quote_literal(_default_value);
        END CASE;
    END IF;

    -- Add column to table with schema qualification
    _sql := format('ALTER TABLE tenant.%I ADD COLUMN %I %s', 
                   _object_name, _final_field_name, _column_definition);
    EXECUTE _sql;

    RETURN _field_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = tenant, public;
