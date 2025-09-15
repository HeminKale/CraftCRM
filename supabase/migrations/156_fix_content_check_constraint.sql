-- Migration: 156_fix_content_check_constraint.sql
-- Fix the content_check constraint to allow button blocks

-- First, drop the existing content_check constraint
ALTER TABLE tenant.layout_blocks 
DROP CONSTRAINT IF EXISTS layout_blocks_content_check;

-- Add the new content_check constraint that properly handles button blocks
ALTER TABLE tenant.layout_blocks 
ADD CONSTRAINT layout_blocks_content_check 
CHECK (
    (block_type = 'field' AND field_id IS NOT NULL AND related_list_id IS NULL AND button_id IS NULL) OR
    (block_type = 'related_list' AND related_list_id IS NOT NULL AND field_id IS NULL AND button_id IS NULL) OR
    (block_type = 'button' AND button_id IS NOT NULL AND field_id IS NULL AND related_list_id IS NULL)
);

-- Add comment explaining the constraint
COMMENT ON CONSTRAINT layout_blocks_content_check ON tenant.layout_blocks 
IS 'Ensures proper content relationships: field blocks have field_id, related_list blocks have related_list_id, button blocks have button_id';
