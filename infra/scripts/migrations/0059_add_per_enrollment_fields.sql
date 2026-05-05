-- Migration: per-enrollment override fields on student_enrollments
--
-- These ten fields existed only on student_profiles, but apps/api/src/routes/enrollments.ts
-- (and originally apps/api/src/routes/students.ts) read/write them on student_enrollments
-- so they can vary per academic year (e.g. a student may repeat one year, be a transfer
-- the next, etc.). Adding them as nullable here aligns the schema with how the code uses
-- them. Types and defaults mirror student_profiles for consistency.

ALTER TABLE student_enrollments ADD COLUMN IF NOT EXISTS origin_school        VARCHAR(255);
ALTER TABLE student_enrollments ADD COLUMN IF NOT EXISTS lv2                  VARCHAR(100);
ALTER TABLE student_enrollments ADD COLUMN IF NOT EXISTS scholarship_level    VARCHAR(100);
ALTER TABLE student_enrollments ADD COLUMN IF NOT EXISTS is_repeating         BOOLEAN DEFAULT false;
ALTER TABLE student_enrollments ADD COLUMN IF NOT EXISTS is_transfer          BOOLEAN DEFAULT false;
ALTER TABLE student_enrollments ADD COLUMN IF NOT EXISTS is_inscribed         BOOLEAN DEFAULT true;
ALTER TABLE student_enrollments ADD COLUMN IF NOT EXISTS transfer_decision    VARCHAR(255);
ALTER TABLE student_enrollments ADD COLUMN IF NOT EXISTS affectation_status   VARCHAR(50);
ALTER TABLE student_enrollments ADD COLUMN IF NOT EXISTS affectation_decision VARCHAR(255);
ALTER TABLE student_enrollments ADD COLUMN IF NOT EXISTS cepe_code            VARCHAR(100);
