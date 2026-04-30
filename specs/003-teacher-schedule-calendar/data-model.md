# Data Model: Teacher Schedule Calendar Upgrade

## Entities

### Teacher
- id (uuid)
- name (string)
- email (string)

### Class
- id (uuid)
- name (string)
- level (string)

### Course
- id (uuid)
- classId (uuid → Class.id)
- name (string)

### TeacherClassAssignment
- id (uuid)
- teacherId (uuid → Teacher.id)
- classId (uuid → Class.id)

### Session (ScheduledCourse)
- id (uuid)
- teacherId (uuid → Teacher.id)
- classId (uuid → Class.id)
- courseId (uuid → Course.id)
- startDateTime (timestamp with time zone)
- endDateTime (timestamp with time zone)
- notes (string, optional)

## Relationships
- Class 1→N Course
- Teacher N→N Class via TeacherClassAssignment
- Session belongs to Teacher, Class, Course

## Validation Rules
- startDateTime < endDateTime
- Duration increments of 15 minutes
- No overlaps for same teacher (time window intersects)
- No overlaps for same class (time window intersects)
- Edits/deletes disallowed after 24h past endDateTime
- Recurrence treated as independent instances only
