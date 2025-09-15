-- ================================
-- Migration 016: App & Tab System
-- Implements Option A: Tabs derived from Objects
-- ================================

-- 1. Update existing tenant.tabs table to match our new structure
ALTER TABLE tenant.tabs 
ADD COLUMN IF NOT EXISTS label TEXT,
ADD COLUMN IF NOT EXISTS route TEXT,
ADD COLUMN IF NOT EXISTS "order" INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS object_id UUID REFERENCES tenant.objects(id) ON DELETE CASCADE;

-- 2. Update existing tenant.apps table to add missing columns
ALTER TABLE tenant.apps 
ADD COLUMN IF NOT EXISTS icon TEXT,
ADD COLUMN IF NOT EXISTS "order" INTEGER DEFAULT 0;

-- 3. Drop existing app_tabs table and recreate with new structure
DROP TABLE IF EXISTS tenant.app_tabs CASCADE;

CREATE TABLE tenant.app_tabs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES system.tenants(id) ON DELETE CASCADE,
    app_id UUID NOT NULL REFERENCES tenant.apps(id) ON DELETE CASCADE,
    object_id UUID NOT NULL REFERENCES tenant.objects(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    route TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    is_visible BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Ensure unique app-object combinations
    UNIQUE(app_id, object_id)
);

-- 4. Create user app preferences table
CREATE TABLE IF NOT EXISTS tenant.user_app_preferences (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES system.tenants(id) ON DELETE CASCADE,
    active_app_id UUID REFERENCES tenant.apps(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Enable RLS for new tables
ALTER TABLE tenant.app_tabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.user_app_preferences ENABLE ROW LEVEL SECURITY;

-- 6. Create RLS policies
CREATE POLICY "tenant_app_tabs_rls" ON tenant.app_tabs
    FOR ALL USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid)
    WITH CHECK (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

CREATE POLICY "user_app_preferences_rls" ON tenant.user_app_preferences
    FOR ALL USING (
        user_id = (auth.jwt()->>'sub')::uuid 
        AND tenant_id = (auth.jwt()->>'tenant_id')::uuid
    )
    WITH CHECK (
        user_id = (auth.jwt()->>'sub')::uuid 
        AND tenant_id = (auth.jwt()->>'tenant_id')::uuid
    );

-- 7. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_app_tabs_tenant_id ON tenant.app_tabs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_app_tabs_app_id ON tenant.app_tabs(app_id);
CREATE INDEX IF NOT EXISTS idx_app_tabs_app_order ON tenant.app_tabs(app_id, "order");
CREATE INDEX IF NOT EXISTS idx_apps_tenant_order ON tenant.apps(tenant_id, "order");
CREATE INDEX IF NOT EXISTS idx_user_app_prefs_user_tenant ON tenant.user_app_preferences(user_id, tenant_id);

-- 8. Add updated_at trigger to app_tabs
CREATE TRIGGER update_app_tabs_updated_at 
    BEFORE UPDATE ON tenant.app_tabs 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 9. Create RPC functions for app and tab management

-- Get all apps for current tenant
CREATE OR REPLACE FUNCTION public.get_apps()
RETURNS SETOF tenant.apps
LANGUAGE SQL SECURITY DEFINER
SET search_path = public, tenant
AS $$
    SELECT *
    FROM tenant.apps
    WHERE tenant_id = (auth.jwt()->>'tenant_id')::uuid
    ORDER BY "order", name
$$;

GRANT EXECUTE ON FUNCTION public.get_apps() TO authenticated;

-- Get tabs for a specific app
CREATE OR REPLACE FUNCTION public.get_app_tabs(p_app_id UUID)
RETURNS SETOF tenant.app_tabs
LANGUAGE SQL SECURITY DEFINER
SET search_path = public, tenant
AS $$
    SELECT t.*
    FROM tenant.app_tabs t
    JOIN tenant.apps a ON a.id = t.app_id
    WHERE a.id = p_app_id
      AND a.tenant_id = (auth.jwt()->>'tenant_id')::uuid
    ORDER BY t."order", t.label
$$;

GRANT EXECUTE ON FUNCTION public.get_app_tabs(UUID) TO authenticated;

-- Get all available tabs (derived from objects) for current tenant
CREATE OR REPLACE FUNCTION public.get_available_tabs()
RETURNS TABLE(
    object_id UUID,
    object_name TEXT,
    object_label TEXT,
    route TEXT,
    is_visible BOOLEAN
)
LANGUAGE SQL SECURITY DEFINER
SET search_path = public, tenant
AS $$
    SELECT 
        o.id as object_id,
        o.name as object_name,
        COALESCE(o.label, o.name) as object_label,
        '/' || o.name as route,
        true as is_visible
    FROM tenant.objects o
    WHERE o.tenant_id = (auth.jwt()->>'tenant_id')::uuid
      AND o.is_active = true
    ORDER BY o.name
$$;

GRANT EXECUTE ON FUNCTION public.get_available_tabs() TO authenticated;

-- Upsert app (create or update)
CREATE OR REPLACE FUNCTION public.upsert_app(
    p_id UUID,
    p_name TEXT,
    p_description TEXT,
    p_icon TEXT,
    p_is_active BOOLEAN,
    p_order INTEGER
) RETURNS tenant.apps
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, tenant
AS $$
DECLARE
    _t UUID := (auth.jwt()->>'tenant_id')::uuid;
    _row tenant.apps;
BEGIN
    IF _t IS NULL THEN 
        RAISE EXCEPTION 'No tenant'; 
    END IF;

    IF p_id IS NULL THEN
        INSERT INTO tenant.apps(tenant_id, name, description, icon, is_active, "order")
        VALUES (_t, p_name, p_description, p_icon, COALESCE(p_is_active, true), COALESCE(p_order, 0))
        RETURNING * INTO _row;
    ELSE
        UPDATE tenant.apps
           SET name = COALESCE(p_name, name),
               description = COALESCE(p_description, description),
               icon = COALESCE(p_icon, icon),
               is_active = COALESCE(p_is_active, is_active),
               "order" = COALESCE(p_order, "order"),
               updated_at = now()
         WHERE id = p_id AND tenant_id = _t
         RETURNING * INTO _row;
    END IF;
    
    RETURN _row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_app(UUID, TEXT, TEXT, TEXT, BOOLEAN, INTEGER) TO authenticated;

-- Upsert app tabs (replace all tabs for an app)
CREATE OR REPLACE FUNCTION public.upsert_app_tabs(
    p_app_id UUID,
    p_tabs JSONB
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, tenant
AS $$
DECLARE
    _t UUID := (auth.jwt()->>'tenant_id')::uuid;
    _own BOOLEAN;
    _tab JSONB;
BEGIN
    IF _t IS NULL THEN 
        RAISE EXCEPTION 'No tenant'; 
    END IF;

    -- Check if app belongs to tenant
    SELECT EXISTS(
        SELECT 1 FROM tenant.apps 
        WHERE id = p_app_id AND tenant_id = _t
    ) INTO _own;
    
    IF NOT _own THEN 
        RAISE EXCEPTION 'App not found for tenant'; 
    END IF;

    -- Replace all tabs for this app
    DELETE FROM tenant.app_tabs WHERE app_id = p_app_id AND tenant_id = _t;

    -- Insert new tabs
    FOR _tab IN SELECT * FROM jsonb_array_elements(COALESCE(p_tabs, '[]'::jsonb))
    LOOP
        INSERT INTO tenant.app_tabs(
            tenant_id, app_id, object_id, label, route, "order", is_visible
        )
        VALUES (
            _t,
            p_app_id,
            (_tab->>'object_id')::uuid,
            _tab->>'label',
            _tab->>'route',
            COALESCE((_tab->>'order')::integer, 0),
            COALESCE((_tab->>'is_visible')::boolean, true)
        );
    END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_app_tabs(UUID, JSONB) TO authenticated;

-- Set active app for current user
CREATE OR REPLACE FUNCTION public.set_active_app(p_app_id UUID)
RETURNS VOID 
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, tenant
AS $$
DECLARE
    _u UUID := (auth.jwt()->>'sub')::uuid;
    _t UUID := (auth.jwt()->>'tenant_id')::uuid;
    _ok BOOLEAN;
BEGIN
    IF _u IS NULL OR _t IS NULL THEN 
        RAISE EXCEPTION 'Not authenticated'; 
    END IF;
    
    IF p_app_id IS NOT NULL THEN
        SELECT EXISTS(
            SELECT 1 FROM tenant.apps 
            WHERE id = p_app_id AND tenant_id = _t
        ) INTO _ok;
        
        IF NOT _ok THEN 
            RAISE EXCEPTION 'App not found for tenant'; 
        END IF;
    END IF;

    INSERT INTO tenant.user_app_preferences(user_id, tenant_id, active_app_id)
    VALUES (_u, _t, p_app_id)
    ON CONFLICT (user_id) DO UPDATE
        SET active_app_id = excluded.active_app_id,
            updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_active_app(UUID) TO authenticated;

-- Get active app for current user
CREATE OR REPLACE FUNCTION public.get_active_app()
RETURNS UUID 
LANGUAGE SQL SECURITY DEFINER
SET search_path = public, tenant
AS $$
    SELECT active_app_id
    FROM tenant.user_app_preferences
    WHERE user_id = (auth.jwt()->>'sub')::uuid
      AND tenant_id = (auth.jwt()->>'tenant_id')::uuid
$$;

GRANT EXECUTE ON FUNCTION public.get_active_app() TO authenticated;

-- 10. Seed initial data if needed
-- Create a default app for existing tenants
INSERT INTO tenant.apps (tenant_id, name, description, icon, is_active, "order")
SELECT 
    t.id,
    'Main App',
    'Default application for ' || t.name,
    '🏠',
    true,
    0
FROM system.tenants t
WHERE NOT EXISTS (
    SELECT 1 FROM tenant.apps a WHERE a.tenant_id = t.id
);

-- Migration complete
SELECT 'Migration 016 completed successfully!' as status;
