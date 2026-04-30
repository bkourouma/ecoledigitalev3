# Feature Specification: Teacher Schedule Calendar Upgrade

**Feature Branch**: `003-teacher-schedule-calendar`  
**Created**: 2025-10-18  
**Status**: Draft  
**Input**: User description: "/speckit.specify http://localhost:3000/teacher/schedule Please modify this calendar widget to use a very sophisticated one that will allow to move courses from one date or time to another. aslo delete or modify when adding the teacher will select the class from a list of classes he was affected to and also the course from the liste of courses of  that class (cascade)"

## User Scenarios & Testing (mandatory)

### User Story 1 - Reschedule a course by drag-and-drop (Priority: P1)

A teacher views their schedule at `/teacher/schedule` and drags a scheduled course session to a different date/time on the calendar. The session updates to the new start and end time if no conflicts are detected.

**Why this priority**: Enables fast correction of schedule changes, the primary motivation for upgrading the calendar.

**Independent Test**: From a populated calendar, drag a session to a new slot; verify time updates and that conflicts are handled per rules.

**Acceptance Scenarios**:

1. Given a session scheduled for 10:00–11:00, When the teacher drags it to 13:00 the same day, Then the session’s start becomes 13:00 and end 14:00, and a success message is shown.
2. Given a potential overlap with another session for the same teacher or class, When the teacher drags into an overlapping slot, Then the system blocks the drop and shows a clear conflict message.

---

### User Story 2 - Adjust duration by resizing (Priority: P1)

A teacher resizes a session’s edge to make it longer or shorter; duration changes if within allowed constraints and without conflicts.

**Why this priority**: Direct control of duration is key to accurate schedules.

**Independent Test**: Resize a session by +30 minutes; verify duration and conflict checks.

**Acceptance Scenarios**:

1. Given a 60-minute session, When it is resized to 90 minutes, Then the end time extends by 30 minutes and saves successfully if no conflicts.
2. Given a resize would create an overlap, When the teacher attempts the resize, Then the system prevents it and explains the conflict.

---

### User Story 3 - Add a new session with cascading class → course selection (Priority: P1)

From the calendar, a teacher adds a session. They first select a class from only the classes assigned to them. Then they select a course filtered to that class. They pick date/time and duration, and save.

**Why this priority**: Ensures teachers only create sessions they are authorized to teach and reduces selection errors.

**Independent Test**: Start add flow; confirm class list is restricted; after class selection, confirm course list filters; create session and see it on calendar.

**Acceptance Scenarios**:

1. Given a teacher assigned to classes A and B, When starting add flow, Then only A and B appear in class dropdown.
2. Given class A has courses C1 and C2, When class A is selected, Then course dropdown shows only C1 and C2.
3. Given valid selections and time, When saving, Then the session appears on the calendar and persists on refresh.

---

### User Story 4 - Edit or delete an existing session (Priority: P2)

A teacher can open a session’s details to edit metadata (title/notes) or delete the session with confirmation.

**Why this priority**: Completes CRUD for schedule management alongside drag/resize.

**Independent Test**: Edit a session’s note; delete a session; verify confirmation and removal.

**Acceptance Scenarios**:

1. Given an existing session, When the teacher edits notes and saves, Then changes persist and display on hover/details.
2. Given an existing session, When the teacher chooses delete and confirms, Then the session is removed and a success message appears.

---

### Edge Cases

- Moving or resizing into outside working hours prompts a warning and blocks save unless explicitly allowed by policy. [Assumption]
- Moving across days or weeks preserves class and course (only time/date change). Changing class/course requires edit flow. [Assumption]
- DST transitions preserve actual duration based on start/end timestamps.
- Attempting to create/edit overlapping sessions for the same teacher or same class is blocked with a descriptive error.
- Past-dated changes are allowed only within the last 24 hours for corrections; otherwise blocked. [Assumption]
- Network failure during save shows an error and reverts the visual change.

## Requirements (mandatory)

### Functional Requirements

- FR-001: The system must provide a calendar at `/teacher/schedule` showing the teacher’s scheduled sessions by date and time.
- FR-002: Teachers must be able to drag a session to a new date/time; on drop, the system validates and, if valid, updates start and end times.
- FR-003: Teachers must be able to resize a session to change duration; on release, the system validates and updates end time if valid.
- FR-004: The system must prevent creating or saving overlapping sessions for the same teacher or for the same class. Conflicts must display a clear message indicating the conflicting session.
- FR-005: Teachers must be able to add a new session from the calendar UI.
- FR-006: During add flow, the class selector must list only classes assigned to the teacher.
- FR-007: During add flow, the course selector must be filtered to courses belonging to the selected class (cascading behavior). Changing class refreshes the course list.
- FR-008: Teachers must be able to edit an existing session’s metadata (e.g., notes/label) and delete a session with a confirmation step.
- FR-009: Calendar navigation must support day and week views and allow navigation across weeks.
- FR-010: All successful actions must show a visible confirmation; failures must show actionable error messages without losing context.
- FR-011: Only authenticated teachers can access `/teacher/schedule`; a teacher can view and modify only sessions tied to their assigned classes.
- FR-012: The calendar must support keyboard interactions for accessibility: focus, open details, and confirm actions.
- FR-013: Time granularity for drag/resize must be in 15-minute increments. [Assumption]
- FR-014: Recurring sessions are treated as individual instances; editing applies only to the single instance; no series-level editing.
- FR-015: Past sessions are read-only beyond 24 hours after end time; no edits or deletes allowed after that window.
- FR-016: Resource conflicts beyond teacher/class (e.g., room) are not enforced at this time.

### Key Entities (if data involved)

- Teacher: identity and authorization context.
- Class: teaching group assigned to one or more teachers.
- Course: subject taught within a class.
- TeacherClassAssignment: mapping of teacher to classes they can teach.
- Session (ScheduledCourse): class, course, teacher, startDateTime, endDateTime, notes.

## Success Criteria (mandatory)

### Measurable Outcomes

- SC-001: 90% of teachers can reschedule a session via drag-and-drop in under 10 seconds.
- SC-002: 95% of valid drag/resize attempts save successfully on first try.
- SC-003: 0% of saved sessions create overlaps for the same teacher or same class.
- SC-004: 90% of teachers complete the add flow (class → course → time) in under 30 seconds.
- SC-005: Support requests related to teacher scheduling decrease by 40% within one month of release.

