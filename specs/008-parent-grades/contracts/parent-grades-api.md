# API Contracts: Parent Grades & Evaluations

**Date**: 2025-01-27  
**Feature**: Parent Grades & Evaluations (`008-parent-grades`)

## Base Path

All endpoints are prefixed with `/api/v1/parent/grades`

## Authentication

All endpoints require:
- Authentication via `authMiddleware`
- Tenant context via `X-Tenant` header or subdomain
- Parent role (user must have 'parent' role)

## Endpoints

### GET /api/v1/parent/grades/assignments

List all graded assignments for children linked to the authenticated parent.

**Query Parameters**:
- `childId` (UUID, optional) - Filter by specific child
- `courseId` (UUID, optional) - Filter by specific course
- `startDate` (ISO date string, optional) - Filter by date range start
- `endDate` (ISO date string, optional) - Filter by date range end
- `page` (integer, default: 1) - Page number for pagination
- `limit` (integer, default: 20) - Number of records per page

**Response**:
```json
{
  "success": true,
  "data": {
    "grades": [
      {
        "id": "uuid",
        "assignmentId": "uuid",
        "assignmentName": "string",
        "courseId": "uuid",
        "courseName": "string",
        "courseCode": "string | null",
        "childId": "uuid",
        "childName": "string",
        "grade": 15.5,
        "maxPoints": 20,
        "percentage": 77.5,
        "feedback": "string | null",
        "submittedAt": "ISO date string | null",
        "gradedAt": "ISO date string | null",
        "dueDate": "ISO date string | null"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 50,
      "totalPages": 3
    }
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user

### GET /api/v1/parent/grades/by-course

Get grades organized by course for children linked to the authenticated parent.

**Query Parameters**:
- `childId` (UUID, optional) - Filter by specific child

**Response**:
```json
{
  "success": true,
  "data": {
    "courses": [
      {
        "courseId": "uuid",
        "courseName": "string",
        "courseCode": "string | null",
        "childId": "uuid",
        "childName": "string",
        "assignmentGrades": [
          {
            "id": "uuid",
            "assignmentId": "uuid",
            "assignmentName": "string",
            "grade": 15.5,
            "maxPoints": 20,
            "percentage": 77.5,
            "gradedAt": "ISO date string | null"
          }
        ],
        "courseAverage": 16.2,
        "totalGraded": 10
      }
    ]
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user

### GET /api/v1/parent/grades/averages

Get overall grade averages and statistics for children linked to the authenticated parent.

**Query Parameters**:
- `childId` (UUID, optional) - Filter by specific child
- `startDate` (ISO date string, optional) - Filter by date range start
- `endDate` (ISO date string, optional) - Filter by date range end
- `semester` (string, optional) - Filter by semester (e.g., "2024-2025-1")

**Response**:
```json
{
  "success": true,
  "data": {
    "statistics": {
      "overallAverage": 15.8,
      "totalGraded": 45,
      "gradeDistribution": {
        "excellent": 15,
        "good": 20,
        "average": 8,
        "belowAverage": 2
      },
      "bestScore": 20,
      "worstScore": 10
    }
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user

### GET /api/v1/parent/grades/trends

Get grade trends data for chart visualization for children linked to the authenticated parent.

**Query Parameters**:
- `childId` (UUID, optional) - Filter by specific child
- `courseId` (UUID, optional) - Filter by specific course
- `startDate` (ISO date string, optional) - Filter by date range start (default: current academic year start)
- `endDate` (ISO date string, optional) - Filter by date range end (default: current date)
- `semester` (string, optional) - Filter by semester (e.g., "2024-2025-1")
- `period` (string, optional) - Time period grouping: "week", "month", "semester" (default: "month")

**Response**:
```json
{
  "success": true,
  "data": {
    "trends": [
      {
        "periodStart": "ISO date string",
        "periodEnd": "ISO date string",
        "periodLabel": "string",
        "averageGrade": 16.2,
        "gradeCount": 5
      }
    ]
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user

## Error Responses

All endpoints may return the following error responses:

```json
{
  "success": false,
  "error": "Error type",
  "message": "Human-readable error message"
}
```

**Common Error Codes**:
- `400 Bad Request` - Invalid query parameters
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user or child not linked to parent
- `404 Not Found` - Resource not found
- `500 Internal Server Error` - Server error

## Data Access Control

- All endpoints verify parent-child relationship via `student_parents` table
- Only graded assignments (`final_score IS NOT NULL OR manual_score IS NOT NULL`) are returned
- All queries are filtered by tenant_id via RLS
- Parent can only access grades for children explicitly linked to their account

