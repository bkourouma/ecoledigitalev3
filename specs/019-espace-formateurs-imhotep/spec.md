# Feature Specification: Trainer Space (Espace Formateurs) - Imhotep Data

**Feature Branch**: `019-espace-formateurs-imhotep`  
**Created**: 2025-11-20  
**Status**: Draft  
**Input**: User description: "PROMPT PHASE 5 : Espace Formateurs - Module Imhotep Data"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Trainer Dashboard Overview (Priority: P1)

A trainer logs into their dedicated space and immediately sees a comprehensive overview of their training activities. The dashboard displays key statistics including upcoming sessions, sessions in progress, completed sessions this month, total learners trained, and training hours delivered. They can quickly access their next sessions, review recent activity, and see notifications requiring attention.

**Why this priority**: This is the primary entry point for trainers to understand their workload and upcoming commitments. Without this overview, trainers cannot efficiently manage their schedule or prepare for upcoming sessions. It provides immediate value by centralizing all critical information in one place.

**Independent Test**: Can be fully tested by a trainer logging into their space, viewing the dashboard with various session states (upcoming, in progress, completed), verifying statistics are accurate, and accessing quick links to detailed views. This delivers immediate value by providing a centralized command center for trainer activities.

**Acceptance Scenarios**:

1. **Given** a trainer logs into their space, **When** they access the dashboard, **Then** they see statistics cards showing upcoming sessions count, in-progress sessions, completed sessions this month, total learners trained, and training hours for the month
2. **Given** a trainer views their dashboard, **When** they see the upcoming sessions section, **Then** they see the next 5 sessions with dates, training titles, number of enrolled learners, and quick access to session details
3. **Given** a trainer views their dashboard, **When** they see the recent sessions section, **Then** they see the last 5 completed sessions with completion status and access to certificates or attendance records
4. **Given** a trainer views their dashboard, **When** they see the recent course materials section, **Then** they see the last 5 uploaded materials with download counts and quick access to manage materials
5. **Given** a trainer has unread notifications, **When** they view the dashboard, **Then** they see a notification widget with count of unread items and recent notifications requiring attention

---

### User Story 2 - Trainer Schedule Management (Priority: P1)

A trainer needs to view their complete schedule in a calendar format to understand their availability, see all assigned sessions, and manage their unavailability periods. They can view sessions by month or week, see session details on click, add periods of unavailability, and remove unavailability periods when their schedule changes.

**Why this priority**: Trainers need to understand their schedule to plan preparation time, avoid conflicts, and communicate availability to administrators. This is essential for effective session planning and prevents scheduling conflicts.

**Independent Test**: Can be fully tested by a trainer viewing their calendar, seeing all assigned sessions displayed correctly, adding an unavailability period, viewing session details from the calendar, and removing unavailability. This delivers value by providing complete schedule visibility and unavailability management.

**Acceptance Scenarios**:

1. **Given** a trainer views their schedule calendar, **When** they select a month or week view, **Then** they see all their assigned sessions displayed with training titles, dates, and visual distinction from unavailability periods
2. **Given** a trainer views their calendar, **When** they click on a session, **Then** they see detailed session information including training program, enrolled learners count, location or video link, and access to full session details
3. **Given** a trainer needs to mark unavailability, **When** they add an unavailability period with start date, end date, and reason, **Then** the period appears on their calendar in a visually distinct way and administrators are aware of this unavailability
4. **Given** a trainer has marked unavailability, **When** they remove an unavailability period, **Then** the period is removed from their calendar and they become available for those dates
5. **Given** a trainer views their schedule, **When** they see overlapping sessions or conflicts, **Then** the system highlights potential conflicts for their attention

---

### User Story 3 - View and Manage Assigned Sessions (Priority: P1)

A trainer needs to see all sessions they are assigned to, filter them by status (upcoming, in progress, completed), search by training topic or date range, and access detailed information for each session. They can view session details including enrolled learners, associated course materials, session notes, and session status.

**Why this priority**: Trainers need to access their session list to prepare for upcoming sessions, review past sessions, and manage their teaching activities. This is the core functionality for session management from the trainer perspective.

**Independent Test**: Can be fully tested by a trainer viewing their session list, applying filters by status and date range, searching for specific sessions, and accessing detailed session information. This delivers value by providing complete session management capabilities.

**Acceptance Scenarios**:

1. **Given** a trainer views their session list, **When** they access the page, **Then** they see all their assigned sessions with key information including session code, training title, dates, delivery mode, number of enrolled learners, and status
2. **Given** a trainer wants to find specific sessions, **When** they apply filters (by status, training topic, date range), **Then** the list updates to show only matching sessions
3. **Given** a trainer views a session in the list, **When** they click to view details, **Then** they see complete session information including training program details, schedule, location or video link, enrolled learners list, associated course materials, and session notes
4. **Given** a trainer views session details, **When** they see the enrolled learners section, **Then** they can see learner names, contact information, enrollment status, and for completed sessions, attendance status
5. **Given** a trainer views a session, **When** they see the course materials section, **Then** they can view all materials associated with the session and access download links

---

### User Story 4 - Manage Learner Attendance (Priority: P2)

A trainer needs to mark attendance for learners during or after a session. For sessions that are in progress or completed, they can view the list of enrolled learners and mark each learner as present or absent. The system tracks attendance and provides statistics on attendance rates.

**Why this priority**: Attendance tracking is essential for session completion records, certificate generation, and understanding learner engagement. This comes after basic session viewing since attendance is only relevant for active or completed sessions.

**Independent Test**: Can be fully tested by a trainer viewing enrolled learners for an in-progress or completed session, marking learners as present or absent, and verifying attendance statistics are calculated correctly. This delivers value by enabling accurate attendance records.

**Acceptance Scenarios**:

1. **Given** a trainer views a session that is in progress or completed, **When** they access the enrolled learners section, **Then** they see a list of all enrolled learners with checkboxes or toggle switches to mark presence
2. **Given** a trainer marks a learner as present, **When** they update the attendance status, **Then** the system saves the attendance record with timestamp and the trainer's identity
3. **Given** a trainer marks attendance for multiple learners, **When** they view the session summary, **Then** they see attendance statistics including total enrolled, number present, number absent, and attendance percentage
4. **Given** a trainer has marked attendance, **When** they view the session later, **Then** they can see and modify attendance records if needed (within reasonable time limits)
5. **Given** a trainer views attendance for a completed session, **When** they see the attendance data, **Then** they can export the attendance list for record-keeping or certificate generation

---

### User Story 5 - Upload and Manage Course Materials (Priority: P2)

A trainer needs to upload course materials (presentations, documents, videos, etc.) for their sessions, organize them by training program or session, make them visible or hidden to learners, and track download statistics. They can upload new materials, edit material metadata, associate materials with specific sessions, and remove materials when no longer needed.

**Why this priority**: Course materials are essential for effective training delivery. Trainers need to share resources with learners and track material usage. This enables trainers to provide comprehensive learning resources.

**Independent Test**: Can be fully tested by a trainer uploading a course material file, setting metadata (title, description, visibility), associating it with a session, viewing download statistics, and managing the material. This delivers value by enabling material sharing and usage tracking.

**Acceptance Scenarios**:

1. **Given** a trainer wants to upload course material, **When** they select a file and provide title, description, and association (training program or session), **Then** the system validates file type and size, uploads the file, and creates a material record
2. **Given** a trainer uploads material, **When** they set visibility options, **Then** they can choose whether the material is visible to enrolled learners or kept private
3. **Given** a trainer views their materials list, **When** they see a material, **Then** they can see associated training program or sessions, upload date, file size, download count, and access management options
4. **Given** a trainer wants to modify material information, **When** they edit material metadata (title, description, visibility, session associations), **Then** the system updates the material record without requiring file re-upload
5. **Given** a trainer views material statistics, **When** they access statistics, **Then** they see total download count, last download date, and download breakdown by session if material is associated with multiple sessions
6. **Given** a trainer wants to remove material, **When** they delete a material, **Then** the system removes the material record and file, and learners can no longer access it

---

### User Story 6 - Add Session Notes (Priority: P3)

A trainer needs to add personal notes about a session for their own reference. These notes can include observations about learner engagement, topics that need more time, improvements for future sessions, or any other relevant information. Notes are private to the trainer and can be edited or updated over time.

**Why this priority**: Session notes help trainers improve their teaching, remember important details, and prepare better for future sessions. This is valuable for professional development but less critical than core session management.

**Independent Test**: Can be fully tested by a trainer adding notes to a session, editing existing notes, and viewing notes later. This delivers value by enabling trainers to maintain session records and improve their teaching.

**Acceptance Scenarios**:

1. **Given** a trainer views a session detail page, **When** they access the notes section, **Then** they see a text area where they can enter or edit session notes
2. **Given** a trainer adds or modifies session notes, **When** they save the notes, **Then** the system stores the notes with timestamp and makes them available for future reference
3. **Given** a trainer has saved notes for a session, **When** they view the session later, **Then** they can see their previous notes and continue editing them
4. **Given** a trainer views notes, **When** they see the notes interface, **Then** the notes are clearly marked as private and visible only to them

---

### User Story 7 - Send Group Messages to Enrolled Learners (Priority: P3)

A trainer needs to communicate with all enrolled learners for a session by sending group messages via email or SMS. They can compose a message with subject and content, choose communication method (email, SMS, or both), and send to all enrolled learners or filter by attendance status (present/absent).

**Why this priority**: Communication with learners is important for session coordination, reminders, and follow-up, but this is less critical than core session management. This enables trainers to maintain engagement with learners.

**Independent Test**: Can be fully tested by a trainer composing a group message for a session, selecting recipients and communication method, sending the message, and verifying delivery confirmation. This delivers value by enabling trainer-learner communication.

**Acceptance Scenarios**:

1. **Given** a trainer views a session with enrolled learners, **When** they access the group messaging feature, **Then** they see an interface to compose a message with subject and content fields
2. **Given** a trainer composes a message, **When** they select communication method (email, SMS, or both), **Then** the system shows the number of recipients who will receive the message via each method
3. **Given** a trainer sends a group message, **When** they submit the message, **Then** the system sends messages to all selected recipients and confirms the number of messages sent
4. **Given** a trainer wants to message specific learners, **When** they filter recipients (all, present only, absent only), **Then** the message is sent only to learners matching the filter criteria
5. **Given** a trainer sends messages, **When** they view message history, **Then** they can see records of sent messages with dates, recipients count, and communication method used

---

### User Story 8 - Manage Trainer Profile (Priority: P3)

A trainer needs to view and update their professional profile including biography, areas of expertise, LinkedIn profile, photo, and CV. They can edit profile information, upload or replace their photo and CV, and view their training statistics including total sessions conducted, total learners trained, and training hours delivered.

**Why this priority**: Profile management allows trainers to maintain their professional information and track their teaching activity. This is valuable for professional development but less critical than core session management functionality.

**Independent Test**: Can be fully tested by a trainer viewing their profile, updating biography and expertise areas, uploading a photo and CV, and viewing their training statistics. This delivers value by enabling profile maintenance and activity tracking.

**Acceptance Scenarios**:

1. **Given** a trainer views their profile page, **When** they access the page, **Then** they see their current profile information including name, email, biography, expertise areas, LinkedIn link, photo, CV, and training statistics
2. **Given** a trainer wants to update their profile, **When** they modify biography, expertise areas, or LinkedIn link, **Then** they can save changes and the updated information is reflected immediately
3. **Given** a trainer wants to update their photo, **When** they upload a new photo file, **Then** the system validates file type and size, uploads the photo, and updates their profile photo
4. **Given** a trainer wants to update their CV, **When** they upload a new CV file, **Then** the system validates file type (PDF), uploads the CV, and makes it available for download
5. **Given** a trainer views their profile, **When** they see training statistics, **Then** they can see total sessions conducted, total learners trained, total training hours, and number of course materials created
6. **Given** a trainer views their profile, **When** they see assigned training programs, **Then** they can see a list of all training programs they have been assigned to teach

---

### Edge Cases

- What happens when a trainer tries to mark attendance for a session that hasn't started yet?
- How does the system handle a trainer uploading a course material file that exceeds size limits?
- What happens when a trainer tries to send a group message but some learners don't have email or phone numbers?
- How does the system handle a trainer marking themselves as unavailable during dates when they already have assigned sessions?
- What happens when a trainer tries to delete a course material that has active downloads from learners?
- How does the system handle a trainer viewing a session they were previously assigned to but assignment was removed?
- What happens when a trainer uploads a course material with a file type that isn't supported?
- How does the system handle multiple trainers assigned to the same session viewing and managing attendance simultaneously?
- What happens when a trainer's account is deactivated while they have upcoming sessions?
- How does the system handle a trainer trying to access session details for a session that was cancelled or deleted?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow trainers to access a dedicated dashboard showing their training statistics, upcoming sessions, recent sessions, and recent course materials
- **FR-002**: System MUST display statistics to trainers including count of upcoming sessions, in-progress sessions, completed sessions this month, total learners trained, and training hours for the current month
- **FR-003**: System MUST allow trainers to view their schedule in calendar format (month or week view) showing all assigned sessions
- **FR-004**: System MUST allow trainers to add periods of unavailability with start date, end date, and reason
- **FR-005**: System MUST allow trainers to remove unavailability periods they have created
- **FR-006**: System MUST display unavailability periods visually distinct from sessions on the trainer's calendar
- **FR-007**: System MUST allow trainers to view detailed information about any session they are assigned to, including training program, dates, schedule, location or video link, enrolled learners, and course materials
- **FR-008**: System MUST allow trainers to filter their session list by status (upcoming, in progress, completed, all), training topic, and date range
- **FR-009**: System MUST allow trainers to search their sessions by training title or session code
- **FR-010**: System MUST allow trainers to view the list of enrolled learners for any session they are assigned to, including learner names, contact information, and enrollment status
- **FR-011**: System MUST allow trainers to mark learner attendance (present/absent) for sessions that are in progress or completed
- **FR-012**: System MUST track attendance records with timestamp and trainer identity who marked the attendance
- **FR-013**: System MUST display attendance statistics to trainers including total enrolled, number present, number absent, and attendance percentage
- **FR-014**: System MUST allow trainers to export attendance lists for completed sessions
- **FR-015**: System MUST allow trainers to upload course materials (documents, presentations, videos) with title, description, and association to training program or session
- **FR-016**: System MUST validate uploaded course materials for file type and maximum file size before accepting uploads
- **FR-017**: System MUST allow trainers to set visibility options for course materials (visible to enrolled learners or private)
- **FR-018**: System MUST allow trainers to associate course materials with one or more specific sessions
- **FR-019**: System MUST track download statistics for course materials including total download count, last download date, and downloads per session
- **FR-020**: System MUST allow trainers to view download statistics for their course materials
- **FR-021**: System MUST allow trainers to edit course material metadata (title, description, visibility, session associations) without re-uploading the file
- **FR-022**: System MUST allow trainers to delete course materials they have uploaded, removing both the record and the file
- **FR-023**: System MUST allow trainers to add, edit, and view private notes for sessions they are assigned to
- **FR-024**: System MUST store session notes with timestamps and make them accessible only to the trainer who created them
- **FR-025**: System MUST allow trainers to send group messages to enrolled learners via email, SMS, or both
- **FR-026**: System MUST allow trainers to filter message recipients by attendance status (all, present only, absent only) when sending group messages
- **FR-027**: System MUST track sent messages with date, recipient count, and communication method for trainer reference
- **FR-028**: System MUST confirm message delivery to trainers showing number of messages successfully sent
- **FR-029**: System MUST allow trainers to view and update their professional profile including biography, expertise areas, LinkedIn profile link, photo, and CV
- **FR-030**: System MUST validate uploaded profile photos for file type and size before accepting
- **FR-031**: System MUST validate uploaded CV files for file type (PDF) and size before accepting
- **FR-032**: System MUST display training statistics to trainers in their profile including total sessions conducted, total learners trained, total training hours, and number of course materials created
- **FR-033**: System MUST display list of assigned training programs to trainers in their profile
- **FR-034**: System MUST restrict trainer access to only sessions they are assigned to, preventing access to other trainers' sessions
- **FR-035**: System MUST display notifications to trainers for relevant events (new enrollments, session changes, administrative messages)
- **FR-036**: System MUST allow trainers to mark notifications as read and view notification history
- **FR-037**: System MUST display count of unread notifications to trainers on dashboard and navigation
- **FR-038**: System MUST prevent trainers from modifying session information they cannot change (dates, capacity, pricing set by administrators)
- **FR-039**: System MUST allow trainers to view session information in read-only mode for administrative fields while allowing editing of trainer-specific fields (notes, attendance)
- **FR-040**: System MUST ensure all trainer actions are logged with trainer identity and timestamp for audit purposes

### Key Entities *(include if feature involves data)*

- **Trainer Dashboard Data**: Aggregated information displayed to trainers including statistics (upcoming sessions count, in-progress sessions, completed sessions this month, total learners trained, training hours this month), list of upcoming sessions (next 5), list of recent completed sessions (last 5), list of recently uploaded course materials (last 5), and unread notifications count. Relationships: aggregated from trainer's sessions, enrollments, and materials.

- **Trainer Schedule**: Calendar view of trainer's assigned sessions and unavailability periods. Key attributes include session assignments with dates and details, unavailability periods with start date, end date, and reason, and calendar view preferences (month/week). Relationships: derived from session assignments and unavailability records.

- **Trainer Unavailability**: Periods when a trainer is not available for session assignments. Key attributes include trainer reference, start date, end date, reason, and creation timestamp. Relationships: belongs to one trainer.

- **Session Attendance Record**: Record of learner presence for a session. Key attributes include session reference, learner reference, present/absent status, marked by trainer reference, and timestamp. Relationships: belongs to one session, belongs to one learner, created by one trainer.

- **Course Material**: File uploaded by trainer for training purposes. Key attributes include trainer reference, file location/URL, file type, file size, title, description, associated training program (optional), associated sessions (multiple possible), visibility to learners, upload date, and download statistics. Relationships: belongs to one trainer, can belong to one training program, can belong to multiple sessions.

- **Course Material Download**: Record of learner downloading a course material. Key attributes include material reference, learner reference, session reference (if applicable), and download timestamp. Relationships: belongs to one material, belongs to one learner, optionally belongs to one session.

- **Session Note**: Private notes added by trainer about a session. Key attributes include session reference, trainer reference, note content, creation timestamp, and last update timestamp. Relationships: belongs to one session, belongs to one trainer.

- **Trainer Group Message**: Message sent by trainer to enrolled learners. Key attributes include trainer reference, session reference, subject, message content, communication method (email/SMS/both), recipient filter (all/present/absent), number of recipients, sent timestamp. Relationships: belongs to one trainer, belongs to one session.

- **Trainer Notification**: Notification for trainer about relevant events. Key attributes include trainer reference, notification type, title, message, metadata, read status, read timestamp, and creation timestamp. Relationships: belongs to one trainer.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Trainers can access their dashboard and view all key statistics and upcoming sessions within 3 seconds of page load
- **SC-002**: Trainers can view their complete schedule calendar for any month or week, with all assigned sessions and unavailability periods displayed, within 2 seconds of selecting the time period
- **SC-003**: Trainers can add or remove an unavailability period in under 30 seconds, with the change immediately reflected on their calendar
- **SC-004**: Trainers can filter and find any specific session from their list in under 5 seconds using search or filters
- **SC-005**: Trainers can mark attendance for all learners in a session (up to 50 learners) in under 2 minutes
- **SC-006**: Attendance statistics are calculated and displayed immediately after any attendance change, with 100% accuracy
- **SC-007**: Trainers can upload a course material file (up to 100MB) and complete the upload process in under 2 minutes for files under 50MB, and under 5 minutes for larger files
- **SC-008**: Course material download statistics update within 10 seconds of any download, showing accurate counts and last download timestamp
- **SC-009**: Trainers can edit course material metadata (title, description, visibility) and save changes in under 5 seconds
- **SC-010**: Trainers can add or edit session notes and save them in under 3 seconds, with notes immediately available for future viewing
- **SC-011**: Trainers can compose and send a group message to all enrolled learners (up to 100 learners) with delivery confirmation within 1 minute of sending
- **SC-012**: Group messages are successfully delivered to 95% of intended recipients within 5 minutes of sending
- **SC-013**: Trainers can update their profile information (biography, expertise, links) and save changes in under 5 seconds
- **SC-014**: Trainers can upload a profile photo (up to 5MB) and see it updated in their profile within 10 seconds of upload completion
- **SC-015**: Trainers can upload a CV file (up to 10MB PDF) and see it available for download within 10 seconds of upload completion
- **SC-016**: Trainer dashboard accurately displays statistics calculated from all assigned sessions, with calculations updating within 1 minute of any session status change
- **SC-017**: Trainers can only access sessions they are assigned to, with 100% access control accuracy (no unauthorized access to other trainers' sessions)
- **SC-018**: Notifications are delivered to trainers within 1 minute of the triggering event (new enrollment, session change, etc.)
- **SC-019**: The trainer space supports trainers managing up to 50 concurrent sessions without performance degradation
- **SC-020**: All trainer actions (attendance marking, material uploads, message sending) are logged with 100% accuracy for audit purposes

## Assumptions

- Trainers (formateurs) already exist in the database with user account links from previous phases
- Session assignments (session_formateurs table) are already created by administrators
- The authentication system supports role-based access control and can identify trainer users
- File storage infrastructure exists for uploading course materials, photos, and CVs (local file system or cloud storage)
- Email and SMS notification services are available for sending group messages to learners
- The system supports multi-tenant isolation for Imhotep Data tenant
- Course material file types include common formats (PDF, PowerPoint, Word documents, ZIP archives, video files) with reasonable size limits
- Trainers have access to enrolled learner contact information (email, phone) for the sessions they are assigned to
- Session statuses (planned, open, in progress, completed, cancelled) are already defined in the system
- Attendance marking is only available for sessions that are in progress or completed
- The system can track download events when learners access course materials
- Notification infrastructure exists for sending notifications to trainers about relevant events

## Dependencies

- Phase 1: Database schema for professional training module including formateurs table and session_formateurs assignment table
- Phase 2: Training program catalog (formations_professionnelles) must exist
- Phase 3: Session management system (sessions_professionnelles) must be functional with trainer assignments
- Phase 4: Enrollment system must exist so trainers can see enrolled learners
- Existing authentication system with role-based access control that can identify trainer users
- File storage service for handling course material, photo, and CV uploads
- Email and SMS notification services for group messaging functionality
- Database tables for course materials (supports_cours), attendance records, session notes, and notifications (if not already created in previous phases)

## Out of Scope

- Trainer registration or account creation (assumes trainers are created by administrators)
- Trainer availability management from administrator perspective (trainers manage their own unavailability)
- Course material content creation or editing tools (only file upload and management)
- Real-time collaboration features during sessions
- Video conferencing integration for remote sessions
- Learner evaluation or grading functionality
- Certificate generation (attendance data is provided but certificate creation is separate)
- Payment processing or financial transactions
- Integration with external calendar systems (Google Calendar, Outlook, etc.)
- Mobile app version (web interface only for this phase)
- Advanced analytics or reporting beyond basic statistics
- Trainer performance evaluation or rating systems

