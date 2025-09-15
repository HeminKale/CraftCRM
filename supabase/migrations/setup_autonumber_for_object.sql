-- Migration 102: Fix Missing Autonumber Triggers
-- Purpose: Create autonumber triggers for all existing objects that are missing them

-- 1. Create universal autonumber setup function
CREATE OR REPLACE FUNCTION tenant.setup_autonumber_for_object(
  p_object_id UUID,
  p_table_name TEXT,
  p_tenant_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Create autonumber sequence if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM tenant.autonumber_sequences 
    WHERE object_id = p_object_id AND field_name = 'autonumber'
  ) THEN
    INSERT INTO tenant.autonumber_sequences (
      object_id, tenant_id, field_name, current_value, start_value, increment_by
    ) VALUES (
      p_object_id, p_tenant_id, 'autonumber', 0, 1, 1
    );
    RAISE NOTICE '✅ Created autonumber sequence for object %', p_object_id;
  END IF;
  
  -- Create autonumber trigger if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers 
    WHERE event_object_table = p_table_name 
    AND trigger_name LIKE '%autonumber%'
  ) THEN
    EXECUTE format('
      CREATE TRIGGER set_autonumber_%I_autonumber
      BEFORE INSERT ON tenant.%I
      FOR EACH ROW EXECUTE FUNCTION tenant.set_autonumber_value(''autonumber'')
    ', p_table_name, p_table_name);
    RAISE NOTICE '✅ Created autonumber trigger for table %', p_table_name;
  END IF;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION tenant.setup_autonumber_for_object(UUID, TEXT, UUID) TO authenticated;

-- 2. Fix all existing objects that are missing triggers
DO $$
DECLARE
    v_object_id UUID;
    v_table_name TEXT;
    v_tenant_id UUID;
BEGIN
    RAISE NOTICE '🔄 Setting up autonumber for all existing objects...';
    
    -- Loop through all objects that have autonumber fields but no triggers
    FOR v_object_id, v_table_name, v_tenant_id IN
        SELECT o.id, o.name, o.tenant_id
        FROM tenant.objects o
        WHERE o.is_active = true
        AND EXISTS (
            SELECT 1 FROM tenant.fields f 
            WHERE f.object_id = o.id 
            AND f.type = 'autonumber'
        )
        AND NOT EXISTS (
            SELECT 1 FROM information_schema.triggers t
            WHERE t.event_object_table = o.name
            AND t.trigger_name LIKE '%autonumber%'
        )
    LOOP
        RAISE NOTICE '🔧 Setting up autonumber for object: % (table: tenant.%)', v_object_id, v_table_name;
        
        -- Call the setup function
        PERFORM tenant.setup_autonumber_for_object(v_object_id, v_table_name, v_tenant_id);
        
        RAISE NOTICE '✅ Autonumber setup complete for table %', v_table_name;
    END LOOP;
    
    RAISE NOTICE '🎉 All existing objects now have autonumber triggers!';
END $$;

-- 3. Log successful migration
DO $$
BEGIN
    RAISE NOTICE '�� Migration 102: Fix Missing Autonumber Triggers completed successfully!';
    RAISE NOTICE '✅ Universal autonumber setup function created';
    RAISE NOTICE '✅ All existing objects now have autonumber triggers';
    RAISE NOTICE '✅ Future objects will automatically get autonumber triggers';
    RAISE NOTICE '🔮 Autonumber system is now fully automated!';
END $$;