-- Migration: 139_add_layout_block_fields.sql
-- Add required fields to layout_blocks__a object for button support

-- Add block_type field to layout_blocks__a
ALTER TABLE tenant.layout_blocks__a 
ADD COLUMN IF NOT EXISTS block_type__a VARCHAR(50) DEFAULT 'field';

-- Add field_id field to layout_blocks__a
ALTER TABLE tenant.layout_blocks__a 
ADD COLUMN IF NOT EXISTS field_id__a UUID;

-- Add related_list_id field to layout_blocks__a
ALTER TABLE tenant.layout_blocks__a 
ADD COLUMN IF NOT EXISTS related_list_id__a UUID;

-- Add button_id field to layout_blocks__a
ALTER TABLE tenant.layout_blocks__a 
ADD COLUMN IF NOT EXISTS button_id__a UUID;

-- Add section field to layout_blocks__a
ALTER TABLE tenant.layout_blocks__a 
ADD COLUMN IF NOT EXISTS section__a VARCHAR(100) DEFAULT 'details';

-- Add display_order field to layout_blocks__a
ALTER TABLE tenant.layout_blocks__a 
ADD COLUMN IF NOT EXISTS display_order__a INTEGER DEFAULT 0;

-- Add width field to layout_blocks__a
ALTER TABLE tenant.layout_blocks__a 
ADD COLUMN IF NOT EXISTS width__a VARCHAR(20) DEFAULT 'half';

-- Add is_visible field to layout_blocks__a
ALTER TABLE tenant.layout_blocks__a 
ADD COLUMN IF NOT EXISTS is_visible__a BOOLEAN DEFAULT true;

-- Add object_id field to layout_blocks__a (to link to which object this layout belongs)
ALTER TABLE tenant.layout_blocks__a 
ADD COLUMN IF NOT EXISTS object_id__a UUID;

-- Drop existing constraints if they exist (to avoid conflicts)
DO $$
BEGIN
    -- Drop block_type constraint if exists
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'layout_blocks_block_type_check' 
        AND table_schema = 'tenant' 
        AND table_name = 'layout_blocks__a'
    ) THEN
        ALTER TABLE tenant.layout_blocks__a DROP CONSTRAINT layout_blocks_block_type_check;
    END IF;
    
    -- Drop width constraint if exists
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'layout_blocks_width_check' 
        AND table_schema = 'tenant' 
        AND table_name = 'layout_blocks__a'
    ) THEN
        ALTER TABLE tenant.layout_blocks__a DROP CONSTRAINT layout_blocks_width_check;
    END IF;
    
    -- Drop content constraint if exists
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'layout_blocks_content_check' 
        AND table_schema = 'tenant' 
        AND table_name = 'layout_blocks__a'
    ) THEN
        ALTER TABLE tenant.layout_blocks__a DROP CONSTRAINT layout_blocks_content_check;
    END IF;
END $$;

-- Add constraints to ensure proper data integrity
ALTER TABLE tenant.layout_blocks__a 
ADD CONSTRAINT layout_blocks_block_type_check 
CHECK (block_type__a IN ('field', 'related_list', 'button'));

ALTER TABLE tenant.layout_blocks__a 
ADD CONSTRAINT layout_blocks_width_check 
CHECK (width__a IN ('half', 'full'));

-- Add constraint to ensure only one type of content per block
ALTER TABLE tenant.layout_blocks__a 
ADD CONSTRAINT layout_blocks_content_check 
CHECK (
    (block_type__a = 'field' AND field_id__a IS NOT NULL AND related_list_id__a IS NULL AND button_id__a IS NULL) OR
    (block_type__a = 'related_list' AND related_list_id__a IS NOT NULL AND field_id__a IS NULL AND button_id__a IS NULL) OR
    (block_type__a = 'button' AND button_id__a IS NOT NULL AND field_id__a IS NULL AND related_list_id__a IS NULL)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_layout_blocks_object_id ON tenant.layout_blocks__a(object_id__a);
CREATE INDEX IF NOT EXISTS idx_layout_blocks_section_order ON tenant.layout_blocks__a(object_id__a, section__a, display_order__a);

-- Log completion
DO $$
BEGIN
  RAISE NOTICE '✅ Migration 139 completed: Added layout block fields to layout_blocks__a';
END $$;


