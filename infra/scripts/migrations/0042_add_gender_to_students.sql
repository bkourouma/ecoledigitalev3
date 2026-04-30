-- EcoleDigitale Database Schema Migration 0042
-- Adds gender field to student_profiles table

-- Create ENUM type for gender
CREATE TYPE gender_type AS ENUM ('masculin', 'feminin');

-- Add gender column to student_profiles table
ALTER TABLE student_profiles
ADD COLUMN IF NOT EXISTS gender gender_type NOT NULL DEFAULT 'masculin';

-- Add comment for documentation
COMMENT ON COLUMN student_profiles.gender IS 'Genre de l''étudiant (masculin ou féminin)';

-- Migration complete
SELECT 'Migration 0042_add_gender_to_students.sql completed successfully' as result;

