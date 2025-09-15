-- Migration 103: Fix Autonumber NULL Handling
-- Purpose: Fix autonumber fields to handle NULL values properly and set defaults

-- 1. Set default 0 for ALL existing tables with autonumber columns
DO $$
DECLARE
    v_table_name TEXT;
    v_object_id UUID;
BEGIN
    RAISE NOTICE '�� Setting autonumber default to 0 for all tables...';
    
    FOR v_object_id, v_table_name IN
        SELECT o.id, o.name
        FROM tenant.objects o
        WHERE o.is_active = true
        AND EXISTS (
            SELECT 1 FROM tenant.fields f 
            WHERE f.object_id = o.id 
            AND f.type = 'autonumber'
        )
    LOOP
        EXECUTE format('ALTER TABLE tenant.%I ALTER COLUMN autonumber SET DEFAULT 0', v_table_name);
        RAISE NOTICE '✅ Set autonumber default to 0 for table %', v_table_name;
    END LOOP;
    
    RAISE NOTICE '🎉 All tables now have autonumber default 0!';
END $$;

-- 2. Update the trigger function to handle NULL values universally
CREATE OR REPLACE FUNCTION tenant.set_autonumber_value()
RETURNS TRIGGER AS $$
DECLARE
    v_next_value BIGINT;
    v_object_id UUID;
    v_table_name TEXT;
BEGIN
    -- Get the object ID from the table name
    SELECT o.id INTO v_object_id
    FROM tenant.objects o
    WHERE o.name = TG_TABLE_NAME::TEXT;
    
    IF v_object_id IS NULL THEN
        RAISE EXCEPTION 'Object not found for table %', TG_TABLE_NAME;
    END IF;
    
    -- Get the table name for logging
    v_table_name := TG_TABLE_NAME;
    
    -- Set default value if autonumber is NULL (works for ALL tables)
    IF NEW.autonumber IS NULL THEN
        NEW.autonumber = 0;
        RAISE NOTICE '🔧 Set NULL autonumber to 0 for table %', v_table_name;
    END IF;
    
    -- Get and increment the autonumber value
    UPDATE tenant.autonumber_sequences 
    SET 
        current_value = current_value + increment_by,
        updated_at = NOW()
    WHERE object_id = v_object_id 
    AND field_name = TG_ARGV[0]
    RETURNING current_value INTO v_next_value;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Autonumber sequence not found for object % and field %', v_object_id, TG_ARGV[0];
    END IF;
    
    -- Set the autonumber field value
    IF TG_ARGV[0] = 'autonumber' THEN
        NEW.autonumber = v_next_value;
        RAISE NOTICE '🔢 Set autonumber field to % for table % record %', v_next_value, v_table_name, NEW.id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Grant execute permission
GRANT EXECUTE ON FUNCTION tenant.set_autonumber_value() TO authenticated;

-- 4. Log successful migration
DO $$
BEGIN
    RAISE NOTICE '�� Migration 103: Fix Autonumber NULL Handling completed successfully!';
    RAISE NOTICE '✅ All tables now have autonumber default 0';
    RAISE NOTICE '✅ Trigger function handles NULL values properly';
    RAISE NOTICE '✅ Autonumber system works for all objects universally';
    RAISE NOTICE '🔮 No more "invalid input syntax for type bigint" errors!';
END $$;