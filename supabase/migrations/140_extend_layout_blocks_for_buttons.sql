-- Migration: 140_extend_layout_blocks_for_buttons.sql
-- Extend layout_blocks__a table to support button blocks

-- Add button_id column to layout_blocks__a
ALTER TABLE tenant.layout_blocks__a 
ADD COLUMN IF NOT EXISTS button_id__a UUID;

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

-- Update block_type constraint to include 'button'
ALTER TABLE tenant.layout_blocks__a 
ADD CONSTRAINT layout_blocks_block_type_check 
CHECK (block_type__a IN ('field', 'related_list', 'button'));

-- Update content check constraint to include button blocks
ALTER TABLE tenant.layout_blocks__a 
ADD CONSTRAINT layout_blocks_content_check 
CHECK (
    (block_type__a = 'field' AND field_id__a IS NOT NULL AND related_list_id__a IS NULL AND button_id__a IS NULL) OR
    (block_type__a = 'related_list' AND related_list_id__a IS NOT NULL AND field_id__a IS NULL AND button_id__a IS NULL) OR
    (block_type__a = 'button' AND button_id__a IS NOT NULL AND field_id__a IS NULL AND related_list_id__a IS NULL)
);

-- Create index for button_id for performance
CREATE INDEX IF NOT EXISTS idx_layout_blocks_button_id ON tenant.layout_blocks__a(button_id__a);

-- Log completion
DO $$
BEGIN
  RAISE NOTICE '✅ Migration 140 completed: Extended layout_blocks__a for button support';
END $$;


