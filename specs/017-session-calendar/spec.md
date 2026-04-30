# Feature Specification: Session Management & Calendar - Imhotep Data

**Feature Branch**: `017-session-calendar`  
**Created**: 2025-01-27  
**Status**: Draft  
**Input**: User description: "Phase 3: Gestion des Sessions & Calendrier - Module Imhotep Data"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View Public Session Calendar (Priority: P1)

A prospective learner wants to browse available professional training sessions to find one that fits their schedule and interests. They navigate to the public calendar page where they can see all upcoming sessions organized by date, filter by training topic, delivery mode, and status, and quickly identify sessions with available spots.

**Why this priority**: This is the primary entry point for learners to discover training opportunities. Without this, users cannot find or evaluate sessions, making the entire session management system invisible to the target audience.

**Independent Test**: Can be fully tested by accessing the public calendar page, viewing sessions in different date ranges, applying filters, and verifying that session information (dates, mode, availability) is accurately displayed. This delivers immediate value by enabling session discovery without requiring any admin functionality.

**Acceptance Scenarios**:

1. **Given** a user visits the public session calendar page, **When** they view the calendar, **Then** they see all upcoming sessions that are open for enrollment, displayed in a calendar format organized by date
2. **Given** sessions exist with different delivery modes (in-person, remote, hybrid), **When** a user filters by delivery mode, **Then** only sessions matching the selected mode are displayed
3. **Given** sessions exist for different training topics, **When** a user filters by training topic, **Then** only sessions for the selected topics are displayed
4. **Given** sessions have different availability statuses, **When** a user views the calendar, **Then** they can distinguish between sessions that are open, full, or in progress through visual indicators
5. **Given** a user is viewing the calendar, **When** they click on a specific date or session, **Then** they can see detailed information about that session or navigate to the session detail page

---

### User Story 2 - View Session Details (Priority: P1)

A learner has found an interesting session on the calendar and wants to learn more before enrolling. They click on the session to view comprehensive details including dates, schedule, location or video link, trainers, pricing, available spots, and training program information.

**Why this priority**: Learners need detailed information to make enrollment decisions. This complements the calendar view and is essential for the enrollment conversion funnel.

**Independent Test**: Can be fully tested by navigating to a session detail page from the calendar or direct link, verifying all session information is displayed correctly, and confirming that availability updates are reflected in real-time. This delivers value by providing the information needed for enrollment decisions.

**Acceptance Scenarios**:

1. **Given** a user views a session detail page, **When** they access the page, **Then** they see complete session information including training title, dates, schedule, delivery mode, location or video link, trainers, pricing, and current availability
2. **Given** a session has multiple trainers assigned, **When** a user views the session details, **Then** they see information about all trainers including names and expertise areas
3. **Given** a session's availability changes (spots fill up), **When** a user views the session detail page, **Then** the availability count updates automatically without requiring a page refresh
4. **Given** a session is full, **When** a user views the session detail page, **Then** they see a clear indication that the session is full and information about waitlist options if available
5. **Given** a user views a session detail page, **When** they want to enroll, **Then** they can access the enrollment process directly from the detail page

---

### User Story 3 - Admin: Create New Session (Priority: P2)

An administrator needs to schedule a new training session. They access the admin interface to create a session by selecting a training program, setting dates and schedule, choosing delivery mode and location/video link, assigning trainers, setting capacity and pricing, and publishing the session for enrollment.

**Why this priority**: Administrators must be able to create sessions to populate the calendar. This is foundational for the session management workflow but comes after public viewing since sessions must exist before they can be managed.

**Independent Test**: Can be fully tested by an admin user creating a new session through the admin interface, completing all required fields, verifying trainer availability, and confirming the session appears in the public calendar after creation. This delivers value by enabling session scheduling and management.

**Acceptance Scenarios**:

1. **Given** an admin user accesses the session creation form, **When** they fill in all required information (training, dates, mode, trainers, capacity, pricing), **Then** they can successfully create and publish a new session
2. **Given** an admin is creating a session, **When** they assign trainers, **Then** the system checks trainer availability for the selected dates and warns if any trainers have scheduling conflicts
3. **Given** an admin creates a session with specific dates, **When** they save the session, **Then** the system automatically generates a unique session code and validates that end date is after start date
4. **Given** an admin creates an in-person session, **When** they specify the location, **Then** the location is required and displayed on the public session detail page
5. **Given** an admin creates a remote session, **When** they specify the video link, **Then** the video link is required and becomes visible to enrolled participants
6. **Given** an admin creates a session, **When** they set the initial status, **Then** they can choose to publish it immediately (open for enrollment) or keep it as planned (not yet visible publicly)

---

### User Story 4 - Admin: Manage Existing Sessions (Priority: P2)

An administrator needs to view, filter, search, and manage all existing training sessions. They access the admin session list to see all sessions, filter by status, training topic, date range, or delivery mode, view key metrics, and perform bulk actions on multiple sessions.

**Why this priority**: Administrators need efficient tools to manage the growing number of sessions. This enables oversight, quick status updates, and bulk operations that save time as the system scales.

**Independent Test**: Can be fully tested by an admin accessing the session management interface, applying various filters and search criteria, viewing session statistics, and performing actions like status changes or exports. This delivers value by providing efficient session oversight and management capabilities.

**Acceptance Scenarios**:

1. **Given** an admin accesses the session management page, **When** they view the list, **Then** they see all sessions with key information (code, training, dates, enrollment status, capacity utilization)
2. **Given** an admin wants to find specific sessions, **When** they use search or filters (by status, training topic, date range, delivery mode), **Then** the list updates to show only matching sessions
3. **Given** an admin views the session list, **When** they see the overview, **Then** they can view summary statistics such as total active sessions, enrollment rates, and upcoming sessions
4. **Given** an admin selects multiple sessions, **When** they perform bulk actions (status change, export), **Then** the actions apply to all selected sessions
5. **Given** an admin wants to export session data, **When** they request an export, **Then** they receive a file containing session information in a standard format

---

### User Story 5 - Admin: Edit Session Details (Priority: P2)

An administrator needs to update an existing session's information, such as changing dates, location, trainers, capacity, or pricing. They access the session edit form, make changes, and the system validates updates (especially checking trainer availability and ensuring capacity changes don't conflict with existing enrollments).

**Why this priority**: Sessions often need updates due to scheduling changes, trainer availability, or capacity adjustments. This is essential for maintaining accurate session information.

**Independent Test**: Can be fully tested by an admin editing an existing session, modifying various fields, verifying validation rules (especially trainer conflicts and capacity constraints), and confirming changes are reflected in the public view. This delivers value by enabling session information updates.

**Acceptance Scenarios**:

1. **Given** an admin accesses the edit form for an existing session, **When** they modify session details, **Then** they can update dates, location, trainers, capacity, pricing, and other session information
2. **Given** an admin changes session dates or trainers, **When** they save the changes, **Then** the system re-checks trainer availability and warns if conflicts exist
3. **Given** an admin attempts to reduce session capacity below the number of existing enrollments, **When** they try to save, **Then** the system prevents the change and displays an error message
4. **Given** an admin updates session information that affects enrolled participants (dates, location, video link), **When** they save the changes, **Then** enrolled participants are automatically notified of the changes
5. **Given** a session is in progress or completed, **When** an admin attempts to edit it, **Then** the system restricts which fields can be modified to prevent disruption

---

### User Story 6 - Admin: View Session Enrollment Details (Priority: P3)

An administrator needs to see who is enrolled in a specific session, their enrollment status, payment status, and contact information. They access the session detail page in admin mode to view the complete enrollment list, filter by enrollment or payment status, and export the enrollment list.

**Why this priority**: Administrators need enrollment information for session planning, communication, and record-keeping. This is important for operational management but less critical than session creation and basic management.

**Independent Test**: Can be fully tested by an admin viewing a session's enrollment details, seeing the list of enrolled participants with their information, applying filters, and exporting the data. This delivers value by providing enrollment visibility for session management.

**Acceptance Scenarios**:

1. **Given** an admin views a session detail page, **When** they access the enrollment tab, **Then** they see a list of all enrolled participants with their contact information, enrollment status, and payment status
2. **Given** an admin views enrollments, **When** they filter by enrollment status (confirmed, pending) or payment status, **Then** the list updates to show only matching participants
3. **Given** an admin wants enrollment records, **When** they request an export, **Then** they receive a file with participant information in a standard format
4. **Given** a session has enrolled participants, **When** an admin views enrollment details, **Then** they can see enrollment dates and any notes related to specific enrollments

---

### Edge Cases

- What happens when a session reaches full capacity while a user is viewing the detail page?
- How does the system handle simultaneous enrollment attempts when only one spot remains?
- What happens when an admin tries to assign a trainer who is already scheduled for another session on overlapping dates?
- How does the system handle session date changes when participants have already made travel arrangements?
- What happens when a session is cancelled after participants have enrolled and paid?
- How does the system handle timezone differences for remote sessions?
- What happens when an admin tries to delete a session that has existing enrollments?
- How does the system handle trainer unavailability due to last-minute changes?
- What happens when session capacity is increased after the session was marked as full?
- How does the system handle duplicate session code generation attempts?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow public users to view a calendar of all training sessions that are open for enrollment
- **FR-002**: System MUST allow public users to filter sessions by training topic, delivery mode (in-person, remote, hybrid), date range, and enrollment status
- **FR-003**: System MUST display session availability (number of spots remaining) in real-time on both calendar and detail views
- **FR-004**: System MUST allow public users to view detailed information about any session including dates, schedule, location or video link, assigned trainers, pricing, and training program details
- **FR-005**: System MUST allow administrators to create new training sessions by providing training program, dates, schedule, delivery mode, location or video link, trainers, capacity, and pricing
- **FR-006**: System MUST automatically generate a unique session code when a new session is created
- **FR-007**: System MUST validate that session end date is after start date when creating or editing sessions
- **FR-008**: System MUST check trainer availability for the selected dates and warn administrators of scheduling conflicts before session creation or update
- **FR-009**: System MUST require location information for in-person sessions and video link for remote sessions
- **FR-010**: System MUST prevent administrators from reducing session capacity below the number of existing enrollments
- **FR-011**: System MUST allow administrators to update session information including dates, location, trainers, capacity, and pricing
- **FR-012**: System MUST automatically notify enrolled participants when critical session information changes (dates, location, video link)
- **FR-013**: System MUST allow administrators to change session status (planned, open, full, in progress, completed, cancelled)
- **FR-014**: System MUST restrict which session fields can be modified when a session is in progress or completed
- **FR-015**: System MUST allow administrators to view all sessions in a list with filtering, searching, and sorting capabilities
- **FR-016**: System MUST display session management statistics to administrators (total sessions, enrollment rates, upcoming sessions)
- **FR-017**: System MUST allow administrators to perform bulk actions on multiple selected sessions (status changes, exports)
- **FR-018**: System MUST allow administrators to export session data in a standard file format
- **FR-019**: System MUST allow administrators to view enrollment details for any session including participant information, enrollment status, and payment status
- **FR-020**: System MUST allow administrators to filter and export enrollment lists
- **FR-021**: System MUST automatically update session availability when enrollments are created, modified, or cancelled
- **FR-022**: System MUST automatically change session status to "full" when all spots are taken and back to "open" if spots become available
- **FR-023**: System MUST prevent deletion of sessions that have existing enrollments
- **FR-024**: System MUST allow administrators to duplicate an existing session with new dates
- **FR-025**: System MUST display session information differently based on user role (public users see limited information, administrators see full details including internal notes)

### Key Entities *(include if feature involves data)*

- **Training Session**: Represents a scheduled instance of a professional training program. Key attributes include unique session code, associated training program, start and end dates, schedule, delivery mode (in-person/remote/hybrid), location or video link, assigned trainers, total capacity, reserved spots, available spots (calculated), pricing, status (planned/open/full/in progress/completed/cancelled), and internal notes. Relationships: belongs to one training program, has many enrollments, has many trainers through assignment table.

- **Session Trainer Assignment**: Represents the relationship between a session and assigned trainers. Key attributes include session reference, trainer reference, and role (primary/assistant/intervenant). Relationships: belongs to one session, belongs to one trainer.

- **Session Enrollment**: Represents a participant's enrollment in a session. Key attributes include session reference, participant information, enrollment type (individual/company), enrollment status, payment status, and enrollment date. Relationships: belongs to one session, belongs to one participant/apprenant.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Public users can view and filter the session calendar, and access session details, completing the discovery process in under 2 minutes
- **SC-002**: Session availability information updates automatically within 30 seconds of any enrollment change, ensuring users always see current availability
- **SC-003**: Administrators can create a new session with all required information in under 5 minutes, including trainer availability validation
- **SC-004**: The system prevents 100% of scheduling conflicts by validating trainer availability before session creation or updates
- **SC-005**: Administrators can find any specific session using search or filters in under 10 seconds from the session management page
- **SC-006**: Session management interface supports viewing and managing at least 100 concurrent sessions without performance degradation
- **SC-007**: 95% of session information updates (dates, location, trainers) are successfully communicated to enrolled participants within 1 hour of the change
- **SC-008**: Administrators can export session or enrollment data in under 5 seconds for sessions with up to 500 enrollments
- **SC-009**: The calendar view accurately displays all sessions for the selected time period (month/week) with correct dates, availability, and status indicators
- **SC-010**: Session capacity calculations are 100% accurate, automatically updating when enrollments change and preventing over-booking

## Assumptions

- The database schema for sessions, trainers, and enrollments already exists from Phase 1 and Phase 2
- Training programs (formations_professionnelles) are already created and available in the system
- Trainers (formateurs) are already registered in the system with their availability information
- User authentication and role-based access control (admin vs public) is already implemented
- The system supports multi-tenant isolation (Imhotep Data tenant)
- Email notification infrastructure exists for sending notifications to enrolled participants
- Session codes follow a format pattern (e.g., PREFIX-YEAR-NUMBER) but the exact format can be determined during implementation
- Real-time availability updates use polling or similar mechanism (specific technology choice is an implementation detail)
- Export file format is a standard spreadsheet format (CSV or similar) - exact format is an implementation detail
- Calendar view supports at least month and week views, with list view as an alternative - specific calendar library is an implementation detail

## Dependencies

- Phase 1: Database schema for professional training module (sessions_professionnelles table and related tables)
- Phase 2: Training program catalog (formations_professionnelles) must be populated with training programs
- Existing authentication system with role-based access control
- Trainer management system (formateurs table and related functionality)
- Email notification system for participant communications

## Out of Scope

- Enrollment process itself (this will be handled in Phase 4)
- Payment processing for session enrollment
- Trainer calendar/availability management interface (assumes trainers are managed separately)
- Session content delivery (materials, recordings, etc.)
- Attendance tracking during sessions
- Session evaluation and feedback collection
- Automated session reminders (can be added in future phase)
- Integration with external calendar systems (Google Calendar, Outlook, etc.)
- Mobile app version (web interface only for this phase)
