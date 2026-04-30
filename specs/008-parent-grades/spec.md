# Feature Specification: Parent Grades & Evaluations

**Feature Branch**: `008-parent-grades`  
**Created**: 2025-01-27  
**Status**: Draft  
**Input**: User description: "Grades & evaluations (/grades) - Grades by course, Assignment grades, Overall averages, Grade trends"

## Clarifications

### Session 2025-01-27

- Q: Should parents be able to view grades for all their children or filter by specific child? → A: Parents should be able to view grades for all their children with filtering capability by child
- Q: What time period should grade trends display by default? → A: Grade trends should show the current academic year by default, with ability to filter by semester or date range
- Q: Should overall averages include all courses or be filterable by course? → A: Overall averages should show all courses by default, with ability to filter by specific course
- Q: How should grade trends be displayed - as a chart or as a list? → A: Grade trends should be displayed as a visual chart (line or bar chart) showing grade progression over time
- Q: Should assignment grades include both submitted and unsubmitted assignments? → A: Assignment grades should only include graded assignments (submissions that have been graded), not pending or unsubmitted assignments

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View Assignment Grades (Priority: P1) 🎯 MVP

A parent logs into the system and navigates to the grades section. They see a list of all graded assignments for their children with detailed information. Each assignment grade displays the assignment name, course name, child name, grade value, max points, percentage, submission date, grading date, and feedback (if available). Parents can filter by child, course, and date range to focus on specific grades.

**Why this priority**: This is the entry point for all grades functionality. Parents need immediate visibility into their children's graded assignments to track academic performance. It provides immediate value by showing parents what grades their children have received and when.

**Independent Test**: Can be fully tested by logging in as a parent user and navigating to `/parent/grades` route. The page should display all graded assignments for linked children, showing assignment details and grades. This delivers value by giving parents visibility into their children's academic performance.

**Acceptance Scenarios**:

1. **Given** a parent is logged in with multiple children linked to their account, **When** they navigate to `/parent/grades`, **Then** they see a list of all graded assignments for all their children with assignment name, course name, child name, grade value, percentage, and submission date
2. **Given** a parent is viewing assignment grades, **When** they filter by a specific child, **Then** only grades for that child are displayed
3. **Given** a parent is viewing assignment grades, **When** they filter by a specific course, **Then** only grades for that course are displayed
4. **Given** a parent is viewing assignment grades, **When** they filter by a date range, **Then** only grades within that date range are displayed
5. **Given** a parent has no children with graded assignments, **When** they navigate to `/parent/grades`, **Then** they see an empty state indicating no grades are available

---

### User Story 2 - View Grades by Course (Priority: P1)

A parent views grades organized by course for their children. The view displays each course with all graded assignments for that course, showing course name, course code, child name, list of assignment grades, course average, and total graded assignments. Parents can filter by child to see course grades for a specific child, or view all children's course grades together.

**Why this priority**: Parents often want to understand performance by subject area. Organizing grades by course helps parents identify which subjects their children excel in or need support with. This provides immediate value by grouping related grades together.

**Independent Test**: Can be fully tested by navigating to the grades by course view. The system should group graded assignments by course and display course-level statistics. This delivers value by helping parents understand performance patterns by subject.

**Acceptance Scenarios**:

1. **Given** a parent is viewing grades by course, **When** they look at a specific course, **Then** they see all graded assignments for that course with course name, course code, child name, assignment grades, course average, and total graded assignments
2. **Given** a parent is viewing grades by course, **When** they filter by a specific child, **Then** only course grades for that child are displayed
3. **Given** a child has multiple graded assignments in a course, **When** a parent views that course, **Then** they see all assignments listed with grades and the calculated course average
4. **Given** a child has no graded assignments in a course, **When** a parent views grades by course, **Then** that course is not displayed or shown with zero graded assignments
5. **Given** a parent is viewing grades by course, **When** they have multiple children, **Then** they can see course grades for all children or filter to view one child's course grades

---

### User Story 3 - View Overall Averages (Priority: P2)

A parent views overall grade averages and statistics for their children. The view displays overall average grade across all courses, total graded assignments, grade distribution (excellent, good, average, below average), best score, and worst score. Parents can filter by child to see individual child statistics, or view aggregated statistics for all children. Statistics can be filtered by date range or semester.

**Why this priority**: While individual assignment grades provide detailed information, overall averages give parents a high-level view of their children's academic standing. This helps parents quickly assess overall performance and identify areas needing attention.

**Independent Test**: Can be fully tested by navigating to the overall averages section. The system should calculate and display aggregated statistics from all graded assignments. This delivers value by providing a comprehensive performance overview.

**Acceptance Scenarios**:

1. **Given** a parent is viewing overall averages, **When** they look at the statistics, **Then** they see overall average grade, total graded assignments, grade distribution, best score, and worst score
2. **Given** a parent is viewing overall averages, **When** they filter by a specific child, **Then** they see statistics calculated only for that child's grades
3. **Given** a parent is viewing overall averages, **When** they filter by date range or semester, **Then** statistics are recalculated based on grades within that period
4. **Given** a child has multiple graded assignments, **When** a parent views overall averages, **Then** the grade distribution correctly categorizes grades (e.g., excellent: ≥16, good: 14-15, average: 12-13, below average: <12)
5. **Given** a child has no graded assignments, **When** a parent views overall averages, **Then** they see an empty state indicating no grades are available for statistics calculation

---

### User Story 4 - View Grade Trends (Priority: P2)

A parent views grade trends showing how their children's grades have changed over time. The view displays a visual chart (line or bar chart) showing grade progression over time, with ability to filter by child, course, date range, or semester. The chart shows grade values over time periods (weeks, months, or semesters) to help parents identify improvement or decline patterns.

**Why this priority**: Grade trends help parents understand whether their children's performance is improving, declining, or stable over time. This longitudinal view provides valuable insights that individual grades cannot show.

**Independent Test**: Can be fully tested by navigating to the grade trends section. The system should display a visual chart showing grade progression over time. This delivers value by helping parents identify performance patterns and trends.

**Acceptance Scenarios**:

1. **Given** a parent is viewing grade trends, **When** they look at the chart, **Then** they see a visual representation of grade progression over time (current academic year by default)
2. **Given** a parent is viewing grade trends, **When** they filter by a specific child, **Then** the chart shows trends only for that child's grades
3. **Given** a parent is viewing grade trends, **When** they filter by a specific course, **Then** the chart shows trends only for that course's grades
4. **Given** a parent is viewing grade trends, **When** they filter by date range or semester, **Then** the chart updates to show trends within that period
5. **Given** a child has grades spanning multiple time periods, **When** a parent views grade trends, **Then** the chart displays grade values for each period (week, month, or semester) showing progression over time
6. **Given** a child has insufficient grade data for trends, **When** a parent views grade trends, **Then** they see an empty state indicating not enough data is available for trend analysis

---

### Edge Cases

- How does the system handle grades from different grading scales (0-20, 0-100, letter grades)?
- What happens when a child has grades from multiple academic years or semesters?
- How does the system handle incomplete grade data (e.g., some assignments graded, others pending)?
- What happens when a parent filters by a date range that has no grades?
- How does the system handle grade trends when a child has very few graded assignments?
- What happens when a course has no graded assignments yet?
- How does the system handle parents with multiple children who have different grading systems?
- What happens when a grade is updated or corrected after it was initially displayed?
- How does the system handle timezone differences when displaying grade dates?
- What happens when a child transfers between courses or classes mid-semester?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST display a list of all graded assignments for all children linked to the authenticated parent user account
- **FR-002**: System MUST show each graded assignment with assignment name, course name, child name, grade value, max points, percentage, submission date, grading date, and feedback (if available)
- **FR-003**: System MUST allow parents to filter assignment grades by child, course, and date range
- **FR-004**: System MUST display grades organized by course, showing course name, course code, child name, list of assignment grades, course average, and total graded assignments
- **FR-005**: System MUST allow parents to filter grades by course view by child
- **FR-006**: System MUST calculate and display course averages for each course based on graded assignments
- **FR-007**: System MUST display overall grade averages showing overall average grade, total graded assignments, grade distribution, best score, and worst score
- **FR-008**: System MUST allow parents to filter overall averages by child, date range, or semester
- **FR-009**: System MUST calculate grade distribution categories (excellent, good, average, below average) based on grade values
- **FR-010**: System MUST display grade trends as a visual chart (line or bar chart) showing grade progression over time
- **FR-011**: System MUST allow parents to filter grade trends by child, course, date range, or semester
- **FR-012**: System MUST display grade trends for the current academic year by default, with ability to filter by different time periods
- **FR-013**: System MUST only display graded assignments (submissions with final_score or manual_score), not pending or unsubmitted assignments
- **FR-014**: System MUST only display information for children linked to the authenticated parent user (enforce data access control)
- **FR-015**: System MUST handle empty states gracefully when no grades are available (no graded assignments, no course grades, no statistics, no trends)
- **FR-016**: System MUST display appropriate messaging when a child has no grades in any section
- **FR-017**: System MUST support filtering and aggregation across multiple children when a parent has multiple children

### Key Entities *(include if feature involves data)*

- **Parent Grade View**: Represents a graded assignment visible to a parent. Key attributes include assignment ID, assignment name, course ID, course name, course code, child ID, child name, grade value, max points, percentage, submission date, grading date, feedback. Relationship: linked to parent through parent-child relationship and child's graded assignments.

- **Course Grade Summary**: Represents aggregated grade information for a course. Key attributes include course ID, course name, course code, child ID, child name, list of assignment grades, course average, total graded assignments. Relationship: linked to parent through parent-child relationship and child's course enrollment.

- **Overall Grade Statistics**: Represents aggregated grade statistics across all courses. Key attributes include overall average grade, total graded assignments, grade distribution (excellent, good, average, below average), best score, worst score, time period. Relationship: linked to parent through parent-child relationship and child's grade records.

- **Grade Trend Data**: Represents grade progression over time. Key attributes include time period (week, month, semester), grade value, course ID (if filtered), child ID (if filtered), date range. Relationship: linked to parent through parent-child relationship and child's grade records over time.

- **Parent-Child Relationship**: Represents the link between a parent user account and a student profile. Key attributes include relationship type (parent, guardian, emergency contact), primary contact status. Relationship: enables parent access to child's grade data.

- **Assignment Submission**: Represents a student's submission for an assignment that has been graded. Key attributes include submission ID, assignment ID, student ID, grade value (final_score or manual_score), grading date, feedback. Relationship: linked to assignment instance and student profile.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Parents can view their complete list of graded assignments within 2 seconds of navigating to `/parent/grades` route
- **SC-002**: Parents can filter assignment grades by child, course, or date range within 1 second of applying filter
- **SC-003**: Parents can view grades organized by course with course averages calculated correctly
- **SC-004**: Parents can view overall grade averages and statistics within 2 seconds
- **SC-005**: Parents can filter overall averages by child, date range, or semester within 1 second
- **SC-006**: Parents can view grade trends as a visual chart showing progression over time within 3 seconds
- **SC-007**: Parents can filter grade trends by child, course, date range, or semester within 1 second
- **SC-008**: Grade calculations (averages, percentages, distributions) are accurate and reflect all available grade data
- **SC-009**: System displays appropriate empty states in 100% of cases where no grades are available
- **SC-010**: Parents can only access grade information for children explicitly linked to their account (100% data access control enforcement)
- **SC-011**: Grade trends display correctly even when grade data spans multiple time periods or semesters
- **SC-012**: Course averages are calculated correctly based on all graded assignments for that course

## Assumptions

- Parent-child relationships are already established in the system through the parent-student relationship management
- Children are enrolled in courses through the existing enrollment system
- Assignment submissions and grades are already being tracked and stored in the system
- Grades are stored with final_score or manual_score values in assignment_submissions table
- Parents have access to the system through authenticated user accounts
- The system supports multiple children per parent account
- Grade data includes all necessary information for calculations (grade value, max points, grading date, etc.)
- Course data includes all necessary information for course-based views (course name, course code, etc.)
- All data access is properly secured to ensure parents can only view information for their own linked children
- The system supports different grading scales (0-20, 0-100, etc.) and can normalize or display them appropriately
- Grade trends can be calculated from historical grade data stored in the system
