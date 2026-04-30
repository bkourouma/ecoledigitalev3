# Quickstart: Parent Grades & Evaluations

**Date**: 2025-01-27  
**Feature**: Parent Grades & Evaluations (`008-parent-grades`)

## Overview

This quickstart guide provides a high-level overview of the parent grades and evaluations feature implementation.

## Feature Summary

Enable parents to view and track their children's grades and academic performance through a dedicated grades interface. The feature provides:

1. **Assignment Grades**: List of all graded assignments with detailed information
2. **Grades by Course**: Grades organized by course with course-level statistics
3. **Overall Averages**: Overall grade averages and statistics across all courses
4. **Grade Trends**: Visual chart showing grade progression over time

## Key Components

### Backend (`apps/api/src/routes/parent-grades.ts`)

- `GET /api/v1/parent/grades/assignments` - List graded assignments
- `GET /api/v1/parent/grades/by-course` - Get grades organized by course
- `GET /api/v1/parent/grades/averages` - Get overall averages and statistics
- `GET /api/v1/parent/grades/trends` - Get grade trends data for chart

### Frontend (`apps/web/src/app/parent/grades/`)

- `page.tsx` - Main grades page with tabs/sections
- `components/grades/AssignmentGrades.tsx` - Assignment grades list component
- `components/grades/GradesByCourse.tsx` - Grades by course component
- `components/grades/OverallAverages.tsx` - Overall averages component
- `components/grades/GradeTrends.tsx` - Grade trends chart component

### Hooks (`apps/web/src/lib/hooks/use-parent-grades.ts`)

- `useAssignmentGrades(childId, filters, page)` - Fetch assignment grades
- `useGradesByCourse(childId)` - Fetch grades organized by course
- `useOverallAverages(childId, filters)` - Fetch overall averages
- `useGradeTrends(childId, filters)` - Fetch grade trends data

## Data Model

### Key Tables

- `student_parents` - Parent-child relationships
- `assignment_submissions` - Graded assignments (where `final_score IS NOT NULL OR manual_score IS NOT NULL`)
- `assignments` - Assignment information
- `courses` - Course information

### Key Queries

1. **Graded Assignments**: Query `assignment_submissions` joined with `assignments` and `courses`, filtered by parent-child relationship
2. **Grades by Course**: Group graded assignments by `course_id` and calculate course averages
3. **Overall Averages**: Aggregate all graded assignments to calculate overall statistics
4. **Grade Trends**: Group grades by time period (week, month, or semester) for trend visualization

## Implementation Steps

1. **Backend API Endpoints**: Create `parent-grades.ts` route file with all four endpoints
2. **Data Access Control**: Verify parent-child relationship for all queries
3. **Grade Calculations**: Implement average, percentage, and distribution calculations
4. **Frontend Hooks**: Create React Query hooks for data fetching
5. **Frontend Components**: Create components for each view (assignments, by course, averages, trends)
6. **Grade Trends Chart**: Integrate charting library (Chart.js or Recharts) for trends visualization
7. **Testing**: Add contract tests, integration tests, and E2E tests

## Testing

- **Contract Tests**: Test all API endpoints with valid parent-child relationships
- **Integration Tests**: Test grade calculations accuracy and filtering
- **E2E Tests**: Test parent login, navigation, and viewing grades in UI

## Security

- All queries filtered by parent-child relationship via `student_parents` table
- RLS policies enforce tenant isolation at database level
- API endpoints verify parent relationship before returning data
- Only graded assignments are returned (not pending or unsubmitted)

