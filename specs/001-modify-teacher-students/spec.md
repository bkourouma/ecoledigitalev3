# Feature Specification: Teacher Students List with Class Filtering

**Feature Branch**: `001-modify-teacher-students`  
**Created**: 2025-10-10  
**Status**: Draft  
**Input**: User description: "Modify teacher/students page to show all students in classes assigned to the logged-in teacher with class filtering capability"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View All Students Across Assigned Classes (Priority: P1)

As a teacher, when I navigate to the students page, I want to see a consolidated list of all students enrolled in any class where I teach, so that I can have a comprehensive view of all my students regardless of which course or class they belong to.

**Why this priority**: This is the core functionality of the feature. Teachers need to see who their students are before they can take any other action. Without this, the page provides no value.

**Independent Test**: Can be fully tested by logging in as a teacher with multiple class assignments and verifying that students from all assigned classes appear in the list. Delivers immediate value by providing student visibility.

**Acceptance Scenarios**:

1. **Given** a teacher is assigned to teach 3 different classes (Class A, Class B, Class C), **When** they navigate to /teacher/students, **Then** they see all students enrolled in all 3 classes in a single consolidated list
2. **Given** a teacher is assigned to multiple courses within the same class, **When** they view the students page, **Then** students from that class appear only once (no duplicates)
3. **Given** a teacher has no class assignments, **When** they view the students page, **Then** they see an empty state message "Vous n'avez pas encore d'étudiants assignés"
4. **Given** a student is enrolled in multiple classes taught by the same teacher, **When** the teacher views the students list, **Then** the student appears only once with their primary class information

---

### User Story 2 - Filter Students by Class (Priority: P1)

As a teacher teaching multiple classes, I want to filter the student list by specific class, so that I can focus on students from one class at a time when needed (e.g., for attendance, grading, or class-specific communication).

**Why this priority**: This is equally critical as viewing all students. Teachers often work with one class at a time and need to quickly isolate students by class. This is part of the MVP as it directly addresses the user's specified requirement.

**Independent Test**: Can be tested independently by selecting different classes from the filter dropdown and verifying only students from the selected class are displayed. Works standalone and delivers value for class-specific tasks.

**Acceptance Scenarios**:

1. **Given** a teacher has students from multiple classes displayed, **When** they select "Licence 1 - Informatique" from the class filter, **Then** only students enrolled in that specific class are shown
2. **Given** a teacher has applied a class filter, **When** they select "Toutes les classes" from the filter, **Then** all students from all assigned classes are displayed again
3. **Given** a class has no enrolled students, **When** the teacher selects that class from the filter, **Then** they see "Aucun étudiant dans cette classe"
4. **Given** a teacher has applied a class filter and a search term, **When** both filters are active, **Then** only students matching both the class and search criteria are displayed

---

### User Story 3 - View Student Details and Class Context (Priority: P2)

As a teacher, when viewing the student list, I want to see each student's name, matricule, email, class name, and performance metrics, so that I can quickly identify students and understand their academic standing.

**Why this priority**: Important for usability and actionable insights, but the page can function without detailed metrics. Core identity information (name, email, class) is essential, but performance data can be added after basic list functionality works.

**Independent Test**: Can be tested by verifying that each student row displays the correct information fields. Delivers value by making the student list useful for identification and context.

**Acceptance Scenarios**:

1. **Given** a student is enrolled in "Master Data Science - IA", **When** the teacher views the student list, **Then** the class name "Master Data Science - IA" appears in the student's row
2. **Given** a student has an average grade of 14.5/20, **When** displayed in the list, **Then** the grade appears formatted as "14.5/20"
3. **Given** a student has 85% attendance rate, **When** displayed in the list, **Then** the attendance appears as "85%"
4. **Given** a student has no grades yet, **When** displayed in the list, **Then** the average shows as "0/20" or "-/20"

---

### User Story 4 - Search Students Across All Classes (Priority: P2)

As a teacher, I want to search for students by name, email, or matricule across all my classes, so that I can quickly find a specific student without remembering which class they belong to.

**Why this priority**: Enhances usability significantly but the page is functional without it. Teachers can manually scan the list, though this becomes impractical with many students.

**Independent Test**: Can be tested by entering search terms and verifying results. Works independently of filtering and delivers value for quick student lookup.

**Acceptance Scenarios**:

1. **Given** a teacher has 50 students across multiple classes, **When** they type "Jean" in the search box, **Then** only students with "Jean" in their first name or last name are displayed
2. **Given** a teacher searches for a student by email "student@example.com", **When** the search is performed, **Then** only the student with that email appears
3. **Given** a teacher has applied a class filter, **When** they perform a search, **Then** results are filtered by both class and search term
4. **Given** no students match the search criteria, **When** search is performed, **Then** message displays "Aucun étudiant ne correspond à vos critères de recherche"

---

### User Story 5 - View Statistics Across Filtered Students (Priority: P3)

As a teacher, I want to see statistics (total students, average grade, average attendance) that update based on my current filters, so that I can understand the performance of specific classes or filtered groups.

**Why this priority**: Nice to have for insights, but not essential for the core task of viewing and filtering students. Can be added after core functionality is stable.

**Independent Test**: Can be tested by applying filters and verifying statistics update correctly. Delivers analytical value but page works without it.

**Acceptance Scenarios**:

1. **Given** a teacher views all students (no filters), **When** statistics are displayed, **Then** they show totals across all assigned classes
2. **Given** a teacher filters by one class with 20 students, **When** viewing statistics, **Then** "Total Étudiants" shows "20"
3. **Given** filtered students have an average grade of 12.3/20, **When** statistics are displayed, **Then** "Moyenne Générale" shows "12.3/20"
4. **Given** a teacher applies search and class filters, **When** viewing statistics, **Then** statistics reflect only the filtered subset of students

---

### Edge Cases

- What happens when a teacher is assigned to a class but that class has no enrolled students?
  → Display the class in the filter dropdown but show empty state when selected
  
- What happens when a student is enrolled in multiple classes taught by the same teacher?
  → Show the student once with their primary/most recent class enrollment
  
- What happens when a class assignment for the teacher ends during the academic year?
  → Students from ended assignments should still be visible unless explicitly filtered by assignment status
  
- How does the system handle class names that are very long?
  → Truncate with ellipsis in table cells, show full name on hover tooltip
  
- What happens when a teacher has hundreds of students across many classes?
  → Implement pagination (20 students per page) with page navigation controls
  
- How are students sorted by default in the list?
  → Sort alphabetically by last name, then first name within each class grouping

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST fetch all students enrolled in classes where the logged-in teacher has active teaching assignments through the teacher_assignments and class_courses relationships
- **FR-002**: System MUST display student information including: full name, student number (matricule), email, phone, class name, average grade, attendance percentage, and status
- **FR-003**: System MUST provide a class filter dropdown populated with all classes assigned to the teacher, plus an "All Classes" option
- **FR-004**: System MUST filter the student list when a specific class is selected, showing only students enrolled in that class
- **FR-005**: System MUST remove duplicate students if they appear in multiple courses within the teacher's assignments
- **FR-006**: System MUST maintain search functionality that works across student names, emails, and matricules
- **FR-007**: System MUST combine class filter and search filter simultaneously when both are active
- **FR-008**: System MUST display statistics (total students, average grade, average attendance) that update based on current filters
- **FR-009**: System MUST show appropriate empty states when no students match current filters or when teacher has no assignments
- **FR-010**: System MUST load data from backend API endpoints with proper tenant isolation and authentication

### Security & Compliance Requirements (Constitution-Driven)

- **SR-001**: System MUST enforce tenant isolation - teachers can only see students from their own tenant (Constitution Principle I)
- **SR-002**: System MUST validate that the logged-in user has teacher role before allowing access to this page (Constitution Principle III)
- **SR-003**: System MUST verify teacher can only view students from classes they are assigned to teach - no access to students from other teachers' classes
- **SR-004**: System MUST include authentication headers (X-Tenant, session token) with all API requests
- **SR-005**: System MUST handle authentication failures gracefully by redirecting to login page

### Key Entities

- **Teacher**: The logged-in user who accesses this page; linked to user account via user_id; has teacher_assignments to classes
- **Student**: A student profile (student_profiles table) with associated user account; enrolled in one or more classes via student_enrollments
- **Class**: An academic class (e.g., "Licence 1 Informatique") belonging to a programme and academic year; linked to teachers via class_courses and teacher_assignments
- **Class-Course Relationship**: The association between a class and a course (class_courses table); represents a course being taught within a specific class
- **Teacher Assignment**: The link between a teacher and a class-course (teacher_assignments table); defines which teacher teaches which course in which class
- **Student Enrollment**: The link between a student and a class (student_enrollments table); defines which students belong to which classes

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Teachers can view their complete student roster across all assigned classes within 2 seconds of page load
- **SC-002**: Teachers can filter students by class and see results update within 500 milliseconds
- **SC-003**: Page correctly handles teachers with 1 to 100+ students across multiple classes without performance degradation
- **SC-004**: 100% of students enrolled in teacher's assigned classes appear in the list with no duplicates
- **SC-005**: Search and filter operations complete with zero incorrect results (100% accuracy)
- **SC-006**: Teachers can identify which class each student belongs to at a glance (class name visible in each row)
- **SC-007**: System prevents teachers from viewing students from classes they don't teach (0 unauthorized data access)
