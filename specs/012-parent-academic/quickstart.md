# Quickstart: Parent Academic Information

**Date**: 2025-01-27  
**Feature**: Parent Academic Information (`012-parent-academic`)

## Overview

This quickstart guide provides a high-level overview of the parent academic information feature implementation.

## Feature Summary

Enable parents to view academic information for their children including enrolled courses, course materials, academic calendar, exam schedules, and academic year information. The feature provides:

1. **Enrolled Courses**: View all courses their children are enrolled in with detailed information (course name, code, teacher, schedule, delivery mode, status)
2. **Course Materials**: View and download course materials for their children's courses (documents, videos, links, etc.)
3. **Academic Calendar**: View academic calendar events (semester start/end dates, holidays, breaks, special events, academic milestones)
4. **Exam Schedules**: View exam schedules for their children's courses (exam name, date, time, duration, location, type)
5. **Academic Year Information**: View academic year information (academic year name, dates, semester information, enrollment details, academic milestones)

## Key Components

### Backend (`apps/api/src/routes/parent-academic.ts`)

- `GET /api/v1/parent/academic/enrolled-courses` - Get enrolled courses for parent's children
- `GET /api/v1/parent/academic/course-materials` - Get course materials for parent's children
- `GET /api/v1/parent/academic/calendar` - Get academic calendar events
- `GET /api/v1/parent/academic/exam-schedules` - Get exam schedules for parent's children
- `GET /api/v1/parent/academic/academic-year` - Get academic year information

### Frontend (`apps/web/src/app/parent/academic/`)

- `page.tsx` - Main academic information page with tabs/sections
- `components/academic/EnrolledCourses.tsx` - Enrolled courses view with filtering
- `components/academic/CourseMaterials.tsx` - Course materials view with filtering
- `components/academic/AcademicCalendar.tsx` - Academic calendar view (calendar/list view)
- `components/academic/ExamSchedules.tsx` - Exam schedules view with filtering
- `components/academic/AcademicYearInfo.tsx` - Academic year information view

### Hooks (`apps/web/src/lib/hooks/use-parent-academic.ts`)

- `useEnrolledCourses(childId?, courseId?, teacherId?, academicYearId?)` - Fetch enrolled courses
- `useCourseMaterials(childId?, courseId?, materialType?, startDate?, endDate?)` - Fetch course materials
- `useAcademicCalendar(academicYearId?, semester?, startDate?, endDate?)` - Fetch academic calendar events
- `useExamSchedules(childId?, courseId?, examType?, startDate?, endDate?, academicYearId?)` - Fetch exam schedules
- `useAcademicYearInfo(childId?, academicYearId?)` - Fetch academic year information

## Data Model

### Key Tables

- `student_enrollments` - Student enrollment data
- `class_courses` - Course-class relationships
- `courses` - Course information
- `course_materials` - Course materials (may need to be created)
- `academic_calendar_events` - Academic calendar events (may need to be created)
- `exam_schedules` - Exam schedules (may need to be created)
- `academic_years` - Academic year information
- `student_parents` - Parent-child relationships

### Key Queries

1. **Enrolled Courses**: Query `student_enrollments` joined with `class_courses`, `courses`, `student_profiles`, `student_parents`, and `teachers` filtered by parent ID
2. **Course Materials**: Query `course_materials` joined with `courses`, `student_enrollments`, and `student_parents` filtered by parent ID
3. **Academic Calendar**: Query `academic_calendar_events` joined with `academic_years` filtered by tenant ID
4. **Exam Schedules**: Query `exam_schedules` joined with `courses`, `student_enrollments`, and `student_parents` filtered by parent ID
5. **Academic Year Information**: Query `academic_years` joined with `student_enrollments` filtered by tenant ID and parent ID

## Implementation Steps

1. **Backend API Endpoints**: Create `parent-academic.ts` route file with all five endpoints
2. **Data Access Control**: Verify authenticated user ID matches parent ID through `student_parents` relationship for all operations
3. **Filtering**: Implement filtering for all endpoints (child, course, teacher, academic year, date range, etc.)
4. **Frontend Hooks**: Create React Query hooks for data fetching with filtering support
5. **Frontend Components**: Create components for each academic information section (enrolled courses, course materials, calendar, exam schedules, academic year info)
6. **Calendar View**: Implement calendar view component for academic calendar display
7. **Testing**: Add contract tests, integration tests, and E2E tests

## Testing

- **Contract Tests**: Test all API endpoints with valid authenticated user
- **Integration Tests**: Test filtering, access control, and data retrieval
- **E2E Tests**: Test parent login, navigation, and viewing academic information in UI

## Security

- All queries filtered by authenticated user ID through `student_parents` relationship
- RLS policies enforce tenant isolation at database level
- API endpoints verify parent-child relationship before returning data
- Only academic information for authenticated parent's linked children is returned

