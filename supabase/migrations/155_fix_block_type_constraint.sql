-- Migration: 155_fix_block_type_constraint.sql
-- Fix the block_type constraint to allow 'button' as a valid value

-- First, drop the existing constraint
ALTER TABLE tenant.layout_blocks 
DROP CONSTRAINT IF EXISTS layout_blocks_block_type_check;

-- Add the new constraint that includes 'button'
ALTER TABLE tenant.layout_blocks 
ADD CONSTRAINT layout_blocks_block_type_check 
CHECK (block_type IN ('field', 'related_list', 'button'));

-- Add comment explaining the constraint
COMMENT ON CONSTRAINT layout_blocks_block_type_check ON tenant.layout_blocks 
IS 'Ensures block_type is one of: field, related_list, or button';
