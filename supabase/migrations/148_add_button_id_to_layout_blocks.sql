-- Add button_id column to layout_blocks table to support button blocks
ALTER TABLE tenant.layout_blocks 
ADD COLUMN IF NOT EXISTS button_id UUID;

-- Add foreign key constraint (PostgreSQL doesn't support IF NOT EXISTS for constraints)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_layout_blocks_button_id' 
        AND table_name = 'layout_blocks'
    ) THEN
        ALTER TABLE tenant.layout_blocks 
        ADD CONSTRAINT fk_layout_blocks_button_id 
        FOREIGN KEY (button_id) REFERENCES tenant.button__a(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Add index
CREATE INDEX IF NOT EXISTS idx_layout_blocks_button_id ON tenant.layout_blocks(button_id);

-- Add comment
COMMENT ON COLUMN tenant.layout_blocks.button_id IS 'Reference to button in button__a table for button type blocks';
