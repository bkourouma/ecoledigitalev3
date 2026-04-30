# Feature Specification: Child Tracking

**Feature Branch**: `004-child-tracking-children`  
**Created**: 2025-01-27  
**Status**: Draft  
**Input**: User description: "Child tracking (/children) - List of children: all children linked to the parent. Per child: Grades summary, Schedule (/children/schedule) with Weekly schedule and Upcoming classes, Attendance records, Absence history"

## Clarifications

### Session 2025-01-27

- Q: How should the system display children who are no longer active (status: suspended, dropped, transfer) in the children list? → A: Show all children regardless of status (active, suspended, dropped, transfer)
- Q: Should parents be able to view grades, schedule, and attendance data for children with inactive status (suspended, dropped, transfer)? → A: Yes, parents can view all data (grades, schedule, attendance) for inactive children
- Q: What time period should the grades summary display by default? → A: All-time grades (all semesters/years for the child)
- Q: How many attendance records should be displayed by default in the attendance records view? → A: All attendance records with pagination (e.g., 20 per page)
- Q: What should determine the "upcoming classes" list when both time and count criteria apply? → A: Show classes from next 7 days, capped at 10 classes maximum

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View Children List (Priority: P1)

A parent logs into the system and navigates to the children tracking section. They see a list of all children linked to their account through the parent-student relationship, regardless of the child's status (active, suspended, dropped, transfer). Each child is displayed with their name, current year/grade level, status indicator, and a quick summary indicator (e.g., recent grade average or attendance status).

**Why this priority**: This is the entry point for all child tracking functionality. Without seeing their children, parents cannot access any child-specific information. It provides immediate value by showing parents what children are associated with their account.

**Independent Test**: Can be fully tested by logging in as a parent user and navigating to `/children` route. The page should display all children linked to the parent account, showing basic child information. This delivers value by confirming parent-child relationships are correctly established and accessible.

**Acceptance Scenarios**:

1. **Given** a parent is logged in with multiple children linked to their account (including children with different statuses), **When** they navigate to `/children`, **Then** they see a list of all their children with each child's name, current year/grade level, status indicator, and a summary indicator
2. **Given** a parent is logged in with only one child linked, **When** they navigate to `/children`, **Then** they see that single child displayed in the list
3. **Given** a parent is logged in with no children linked to their account, **When** they navigate to `/children`, **Then** they see an empty state message indicating no children are linked to their account
4. **Given** a parent views their children list, **When** they click on a specific child, **Then** they are taken to that child's detailed information page

---

### User Story 2 - View Child Grades Summary (Priority: P1)

A parent selects a child from the children list and views a grades summary page. The summary displays key academic performance metrics including average grade across all courses, total assignments completed, graded assignments count, best score achieved, and a grade distribution breakdown (e.g., excellent, good, average, below average). The summary includes all-time grades (all semesters/years) by default.

**Why this priority**: Grades are a primary concern for parents monitoring their child's academic progress. Providing a summary gives parents immediate insight into overall performance without requiring detailed analysis of individual assignments.

**Independent Test**: Can be fully tested by navigating to a child's grades summary section. The page should display aggregated grade statistics calculated from the child's grade records. This delivers value by giving parents a quick overview of their child's academic standing.

**Acceptance Scenarios**:

1. **Given** a parent has selected a child (regardless of status), **When** they view the grades summary, **Then** they see the child's average grade, total assignments, graded assignments count, and best score
2. **Given** a child has multiple grades from different courses, **When** a parent views the grades summary, **Then** all grades are included in the average calculation
3. **Given** a child has no grades recorded yet, **When** a parent views the grades summary, **Then** they see an empty state indicating no grades are available with appropriate messaging
4. **Given** a child has grades from different semesters or periods, **When** a parent views the grades summary, **Then** the summary reflects all-time grades (all semesters/years) by default

---

### User Story 3 - View Child Weekly Schedule (Priority: P2)

A parent views their child's weekly schedule showing all scheduled classes for the current week. The schedule displays classes organized by day of the week with time slots, course names, and classroom locations (if available). Parents can navigate to previous or future weeks to see historical or upcoming schedules.

**Why this priority**: Parents need to know when their child has classes to plan activities, ensure attendance, and coordinate pickups. The weekly view provides a comprehensive overview of the child's academic calendar.

**Independent Test**: Can be fully tested by navigating to `/children/schedule` for a selected child. The page should display the child's weekly schedule based on their class enrollment. This delivers value by helping parents understand their child's weekly routine and plan accordingly.

**Acceptance Scenarios**:

1. **Given** a parent has selected a child (regardless of status), **When** they navigate to `/children/schedule`, **Then** they see the child's weekly schedule for the current week with all scheduled classes showing day, time, course name, and location
2. **Given** a parent is viewing the weekly schedule, **When** they navigate to the next week, **Then** they see the schedule for that upcoming week
3. **Given** a parent is viewing the weekly schedule, **When** they navigate to the previous week, **Then** they see the schedule for that past week
4. **Given** a child has no scheduled classes for a week, **When** a parent views that week's schedule, **Then** they see an empty state indicating no classes are scheduled
5. **Given** a child's schedule includes recurring classes, **When** a parent views the weekly schedule, **Then** all instances of recurring classes appear on their respective days

---

### User Story 4 - View Upcoming Classes (Priority: P2)

A parent views a list of their child's upcoming classes, showing classes from the next 7 days, capped at 10 classes maximum. This provides a quick reference for immediate scheduling needs without requiring navigation through the full weekly calendar.

**Why this priority**: While the weekly schedule provides comprehensive information, parents often need quick access to immediate upcoming classes for planning purposes. This focused view reduces cognitive load for time-sensitive information.

**Independent Test**: Can be fully tested by viewing the upcoming classes section on the schedule page. The system should filter to show only future classes for the selected child. This delivers value by providing at-a-glance information about immediate scheduling needs.

**Acceptance Scenarios**:

1. **Given** a parent is viewing their child's schedule page, **When** they look at the upcoming classes section, **Then** they see a list of the child's scheduled classes from the next 7 days (capped at 10 classes maximum), ordered by date and time
2. **Given** a child has classes scheduled for today and future days, **When** a parent views upcoming classes, **Then** they see classes from the next 7 days including today's remaining classes, up to 10 classes maximum
3. **Given** a child has no upcoming classes scheduled, **When** a parent views the upcoming classes section, **Then** they see an empty state indicating no upcoming classes
4. **Given** a parent views upcoming classes, **When** the current date advances, **Then** past classes are automatically removed from the upcoming classes list

---

### User Story 5 - View Child Attendance Records (Priority: P2)

A parent views their child's attendance records showing all attendance history. The records display each attendance entry with the date, class/course name, attendance status (present, absent, late, excused, medical leave), arrival time (if late), and any notes. Records are shown in reverse chronological order (most recent first) with pagination (e.g., 20 records per page).

**Why this priority**: Parents need visibility into their child's attendance patterns to identify issues early and ensure regular school attendance. Recent attendance records are most actionable for parents.

**Independent Test**: Can be fully tested by navigating to a child's attendance records section. The system should display attendance records filtered by the selected child. This delivers value by providing transparency into attendance patterns.

**Acceptance Scenarios**:

1. **Given** a parent has selected a child (regardless of status), **When** they view attendance records, **Then** they see a paginated list of all attendance entries with date, course/class name, status, and relevant details (e.g., 20 records per page)
2. **Given** a child has multiple attendance records, **When** a parent views attendance records, **Then** records are displayed in reverse chronological order (most recent first) with pagination controls
3. **Given** a child has an attendance record marked as "late", **When** a parent views that record, **Then** they see the arrival time indicating when the child arrived
4. **Given** a child has an attendance record marked as "excused" or "medical leave", **When** a parent views that record, **Then** they see the excuse reason if available
5. **Given** a child has no attendance records yet, **When** a parent views attendance records, **Then** they see an empty state indicating no attendance records are available

---

### User Story 6 - View Child Absence History (Priority: P3)

A parent views a comprehensive history of all absences for their child, including both excused and unexcused absences. This view provides filtering options by date range, absence type, and course. The history shows patterns over time and may include absence statistics such as total absences, excused vs unexcused counts, and absence rate.

**Why this priority**: While recent attendance records provide immediate visibility, absence history provides a longer-term perspective that helps parents identify patterns and track improvement over time. This is valuable for addressing chronic attendance issues.

**Independent Test**: Can be fully tested by navigating to a child's absence history section. The system should filter attendance records to show only absences (absent, excused, medical leave statuses) and provide filtering capabilities. This delivers value by helping parents understand long-term attendance trends.

**Acceptance Scenarios**:

1. **Given** a parent has selected a child (regardless of status), **When** they view absence history, **Then** they see all historical absence records with date, course/class, absence type, and excuse details
2. **Given** a parent is viewing absence history, **When** they apply a date range filter, **Then** only absences within that date range are displayed
3. **Given** a parent is viewing absence history, **When** they filter by absence type (excused, unexcused, medical), **Then** only absences matching that type are displayed
4. **Given** a child has multiple absences, **When** a parent views absence history, **Then** they see absence statistics including total count, excused vs unexcused breakdown, and absence rate
5. **Given** a child has no absences recorded, **When** a parent views absence history, **Then** they see an empty state with a positive message indicating perfect attendance
6. **Given** a parent is viewing absence history, **When** they want to see absence patterns, **Then** the system provides a summary view showing absence trends over time (e.g., by month or semester)

---

### Edge Cases

- System displays all children regardless of status (active, suspended, dropped, transfer) in the children list, with status clearly indicated
- How does the system handle children who are enrolled in multiple classes or programmes simultaneously?
- What happens when a child's schedule changes after a parent has already viewed it (e.g., class cancellation, rescheduling)?
- How does the system handle attendance records that are marked retroactively (created after the session date)?
- What happens when a child has grades from different grading systems or scales (e.g., some courses use 0-20 scale, others use letter grades)?
- How does the system handle parents who are linked to the same child but have different relationship types (primary parent vs guardian)?
- What happens when a child's class schedule includes sessions that span multiple days or have irregular timing?
- How does the system handle pagination when a child has a large number of attendance records or grades?
- What happens when grade data is incomplete (e.g., assignment submitted but not yet graded)?
- How does the system handle timezone differences when displaying schedules and attendance records?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST display a list of all children linked to the authenticated parent user account, regardless of child status (active, suspended, dropped, transfer)
- **FR-002**: System MUST show each child's basic information including name, current year/grade level, status indicator, and at least one summary indicator (grade average or attendance status)
- **FR-003**: System MUST allow parents to navigate from the children list to individual child detail pages for all children, regardless of child status
- **FR-004**: System MUST display a grades summary for each child showing average grade, total assignments, graded assignments count, best score, and grade distribution breakdown, regardless of child status (active, suspended, dropped, transfer)
- **FR-005**: System MUST calculate grades summary from all-time grade records (all semesters/years) for the selected child by default, aggregating across all courses and assignments
- **FR-006**: System MUST display grades summary even when only partial grade data is available (e.g., some assignments graded, others pending)
- **FR-007**: System MUST display a weekly schedule view for each child showing all scheduled classes organized by day of the week with date, time, course name, and location, regardless of child status
- **FR-008**: System MUST allow navigation between weeks in the schedule view (previous week, next week, current week)
- **FR-009**: System MUST display an upcoming classes section showing the child's scheduled classes from the next 7 days, capped at 10 classes maximum
- **FR-010**: System MUST filter upcoming classes to show only future-dated sessions (including same-day classes that haven't occurred yet)
- **FR-011**: System MUST display attendance records for each child showing date, course/class name, attendance status, arrival time (if applicable), departure time (if applicable), and notes, regardless of child status
- **FR-012**: System MUST display all attendance records in reverse chronological order (most recent first) with pagination (e.g., 20 records per page)
- **FR-013**: System MUST distinguish between different attendance statuses (present, absent, late, excused, medical leave) in attendance records
- **FR-014**: System MUST display excuse reasons for attendance records marked as excused or medical leave
- **FR-015**: System MUST display an absence history view showing all historical absences (statuses: absent, excused, medical leave) for the selected child, regardless of child status
- **FR-016**: System MUST provide filtering capabilities in absence history by date range, absence type, and course
- **FR-017**: System MUST display absence statistics including total absences, excused vs unexcused breakdown, and absence rate
- **FR-018**: System MUST only display information for children linked to the authenticated parent user (enforce data access control)
- **FR-019**: System MUST handle empty states gracefully when no data is available (no children, no grades, no schedule, no attendance records, no absences)
- **FR-020**: System MUST display appropriate messaging when a child has no data in any section (grades, schedule, attendance)

### Key Entities *(include if feature involves data)*

- **Child/Student Profile**: Represents a student linked to a parent account. Key attributes include student ID, name, current year/grade level, status (active, graduated, suspended, dropped, transfer). Relationship: linked to parent through parent-child relationship.

- **Parent-Child Relationship**: Represents the link between a parent user account and a student profile. Key attributes include relationship type (parent, guardian, emergency contact), primary contact status, emergency contact status, pickup authorization.

- **Grade Record**: Represents an individual grade assignment for a student. Key attributes include assignment ID, course ID, grade value, maximum grade, coefficient, assignment type, grading date, instructor information, feedback. Relationship: linked to student profile.

- **Schedule/Session Instance**: Represents a scheduled class session for a student. Key attributes include session ID, class ID, course ID, start date/time, end date/time, classroom/location, teacher. Relationship: linked to student through class enrollment.

- **Attendance Record**: Represents an attendance entry for a student in a specific session. Key attributes include session ID, attendance status (present, absent, late, excused, medical leave), arrival time, departure time, excuse reason, notes, marked date/time. Relationship: linked to student profile and attendance session.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Parents can view their complete list of linked children within 2 seconds of navigating to `/children` route
- **SC-002**: Parents can access any child's grades summary within 1 second of selecting that child
- **SC-003**: Parents can view a child's weekly schedule with all classes displayed correctly for the selected week
- **SC-004**: Parents can see upcoming classes for their child showing classes from the next 7 days, capped at 10 classes maximum
- **SC-005**: Parents can view all their child's attendance records with pagination (e.g., 20 records per page), displayed in reverse chronological order
- **SC-006**: Parents can view absence history for their child with filtering capabilities returning results within 2 seconds
- **SC-007**: Parents can navigate between different sections (grades, schedule, attendance) for a child without errors or data loss
- **SC-008**: 95% of parents can successfully find and view information for their linked children on the first attempt
- **SC-009**: System displays appropriate empty states in 100% of cases where no data is available for a section
- **SC-010**: Parents can only access information for children explicitly linked to their account (100% data access control enforcement)
- **SC-011**: Grades summary calculations are accurate and reflect all available grade data for the selected child
- **SC-012**: Schedule information displays correctly for children enrolled in multiple classes or programmes simultaneously

## Assumptions

- Parent-child relationships are already established in the system through the parent-student relationship management
- Children are enrolled in classes and programmes through the existing enrollment system
- Grades, attendance records, and schedules are already being tracked and stored in the system
- Parents have access to the system through authenticated user accounts
- The system supports multiple children per parent account
- Grade data includes all necessary information for summary calculations (average, distribution, etc.)
- Schedule data includes all necessary information for displaying weekly schedules and upcoming classes
- Attendance records include all necessary information for displaying attendance history and absence tracking
- All data access is properly secured to ensure parents can only view information for their own linked children
