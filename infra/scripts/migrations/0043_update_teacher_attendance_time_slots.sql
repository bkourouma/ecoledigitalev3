-- EcoleDigitale Database Schema Migration 0043
-- Updates teacher_attendance_sessions time_slot constraint to include new 2-hour slots

-- Drop the existing CHECK constraint (if it exists)
-- PostgreSQL auto-generates constraint names, so we need to find and drop it
DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    -- Find the constraint name for time_slot CHECK
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = 'teacher_attendance_sessions'::regclass
      AND contype = 'c'
      AND conname LIKE '%time_slot%';
    
    -- Drop the constraint if found
    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE teacher_attendance_sessions DROP CONSTRAINT IF EXISTS %I', constraint_name);
        RAISE NOTICE 'Dropped constraint: %', constraint_name;
    ELSE
        RAISE NOTICE 'No time_slot constraint found to drop';
    END IF;
END $$;

-- Add the new CHECK constraint with all valid time slots
ALTER TABLE teacher_attendance_sessions
ADD CONSTRAINT teacher_attendance_sessions_time_slot_check 
CHECK (time_slot IN ('08:00-10:00', '10:00-12:00', '14:00-16:00', '16:00-18:00', '08:00-12:00', '13:00-17:00', '18:00-20:00'));

-- Add comment for documentation
COMMENT ON CONSTRAINT teacher_attendance_sessions_time_slot_check ON teacher_attendance_sessions 
IS 'Validates time_slot values: supports both 2-hour slots (08:00-10:00, 10:00-12:00, 14:00-16:00, 16:00-18:00) and 4-hour slots (08:00-12:00, 13:00-17:00, 18:00-20:00)';

-- Migration complete
SELECT 'Migration 0043_update_teacher_attendance_time_slots.sql completed successfully' as result;

