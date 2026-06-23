-- Migration: 224_user_field_preferences.sql
-- Per-user column selection preferences for list views

CREATE TABLE IF NOT EXISTS tenant.user_field_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES system.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES system.tenants(id) ON DELETE CASCADE,
  object_id UUID NOT NULL REFERENCES tenant.objects(id) ON DELETE CASCADE,
  selected_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_field_preferences_unique UNIQUE (user_id, object_id)
);

CREATE INDEX IF NOT EXISTS idx_user_field_prefs_user ON tenant.user_field_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_user_field_prefs_object ON tenant.user_field_preferences(object_id);
CREATE INDEX IF NOT EXISTS idx_user_field_prefs_tenant ON tenant.user_field_preferences(tenant_id);

ALTER TABLE tenant.user_field_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_field_preferences_tenant_isolation"
  ON tenant.user_field_preferences
  FOR ALL
  USING (tenant_id IN (
    SELECT tenant_id FROM system.users WHERE id = auth.uid()
  ));

CREATE OR REPLACE TRIGGER update_user_field_preferences_updated_at
  BEFORE UPDATE ON tenant.user_field_preferences
  FOR EACH ROW EXECUTE FUNCTION tenant.update_updated_at_column();

-- RPC: Get field preferences for the current user + object
DROP FUNCTION IF EXISTS public.get_user_field_preferences(UUID, UUID);
CREATE OR REPLACE FUNCTION public.get_user_field_preferences(
  p_object_id UUID,
  p_tenant_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_fields JSONB;
BEGIN
  v_user_id := auth.uid();

  SELECT selected_fields INTO v_fields
  FROM tenant.user_field_preferences
  WHERE user_id = v_user_id
    AND object_id = p_object_id
    AND tenant_id = p_tenant_id;

  RETURN COALESCE(v_fields, '[]'::jsonb);
END;
$$;

-- RPC: Save field preferences for the current user + object
DROP FUNCTION IF EXISTS public.save_user_field_preferences(UUID, UUID, JSONB);
CREATE OR REPLACE FUNCTION public.save_user_field_preferences(
  p_object_id UUID,
  p_tenant_id UUID,
  p_selected_fields JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();

  INSERT INTO tenant.user_field_preferences (user_id, tenant_id, object_id, selected_fields)
  VALUES (v_user_id, p_tenant_id, p_object_id, p_selected_fields)
  ON CONFLICT (user_id, object_id)
  DO UPDATE SET
    selected_fields = EXCLUDED.selected_fields,
    updated_at = NOW();
END;
$$;
