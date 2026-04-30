-- Migration: Create calendar_sessions view for schedule generation calendar
-- Date: 2025-10-17
-- Description: Create a view that combines scheduled_sessions with course and class information for calendar display

-- Create calendar_sessions view
CREATE OR REPLACE VIEW calendar_sessions AS
SELECT 
  ss.id as instance_id,
  ss.start_date as session_date,
  CONCAT(ss.start_date, ' ', ss.start_time) as start_datetime,
  CONCAT(ss.start_date, ' ', ss.end_time) as end_datetime,
  'scheduled' as status,
  COALESCE(cr.name, 'TBD') as classroom,
  c.id as class_id,
  c.name as class_name,
  co.id as course_id,
  co.name as course_name,
  co.code as course_code,
  t.id as teacher_id,
  COALESCE(CONCAT(u.first_name, ' ', u.last_name), 'TBD') as teacher_name,
  ss.day_of_week,
  ss.duration_minutes
FROM scheduled_sessions ss
JOIN class_courses cc ON ss.class_course_id = cc.id
JOIN classes c ON cc.class_id = c.id
JOIN courses co ON cc.course_id = co.id
LEFT JOIN teachers t ON ss.teacher_id = t.id
LEFT JOIN users u ON t.user_id = u.id
LEFT JOIN classrooms cr ON ss.classroom_id = cr.id
WHERE ss.is_active = true;

-- Grant permissions on the view
GRANT SELECT ON calendar_sessions TO PUBLIC;

-- Add comment
COMMENT ON VIEW calendar_sessions IS 'Calendar view combining scheduled sessions with course and class information for schedule generation calendar display';

