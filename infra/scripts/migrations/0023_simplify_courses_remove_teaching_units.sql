-- Migration 0023: Simplify courses schema - Remove teaching_units dependency
-- Make courses directly reference programmes instead of through teaching_units

BEGIN;

-- Step 1: Add programme_id column to courses table
ALTER TABLE courses 
ADD COLUMN IF NOT EXISTS programme_id UUID REFERENCES programmes(id) ON DELETE CASCADE;

-- Step 2: Create index for the new column
CREATE INDEX IF NOT EXISTS idx_courses_programme_id ON courses(programme_id);

-- Step 3: For any existing courses data, if we need to migrate, we could do it here
-- But since teaching_units table is empty and courses don't have teaching_unit_id,
-- we'll just ensure the column exists for new data

-- Step 4: Add constraint to make programme_id NOT NULL for new records
-- (We won't make it NOT NULL yet in case there's existing data without it)
-- ALTER TABLE courses ALTER COLUMN programme_id SET NOT NULL;

COMMIT;

-- Verification
SELECT 'Migration 0023 completed successfully - courses now reference programmes directly' AS status;

SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'courses' 
AND column_name IN ('programme_id', 'teaching_unit_id')
ORDER BY column_name;



