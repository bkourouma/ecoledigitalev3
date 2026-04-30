# API Contracts: Parent Academic Information

**Date**: 2025-01-27  
**Feature**: Parent Academic Information (`012-parent-academic`)

## Base Path

All endpoints are prefixed with `/api/v1/parent/academic`

## Authentication

All endpoints require:
- Authentication via `authMiddleware`
- Tenant context via `X-Tenant` header or subdomain
- Parent role (user must have 'parent' role)

## Endpoints

### GET /api/v1/parent/academic/enrolled-courses

Get enrolled courses for the authenticated parent's children.

**Query Parameters**:
- `childId` (UUID, optional) - Filter by specific child
- `courseId` (UUID, optional) - Filter by specific course
- `teacherId` (UUID, optional) - Filter by specific teacher
- `academicYearId` (UUID, optional) - Filter by specific academic year

**Response**:
```json
{
  "success": true,
  "data": {
    "courses": [
      {
        "courseId": "uuid",
        "courseName": "string",
        "courseCode": "string",
        "childId": "uuid",
        "childName": "string",
        "teacherId": "uuid",
        "teacherName": "string",
        "scheduleDay": 1,
        "scheduleTime": "HH:MM",
        "classroom": "string",
        "deliveryMode": "presential" | "remote" | "hybrid" | "elearning",
        "courseStatus": "draft" | "active" | "inactive",
        "academicYearId": "uuid",
        "academicYearName": "string"
      }
    ]
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user

### GET /api/v1/parent/academic/course-materials

Get course materials for the authenticated parent's children.

**Query Parameters**:
- `childId` (UUID, optional) - Filter by specific child
- `courseId` (UUID, optional) - Filter by specific course
- `materialType` (string, optional) - Filter by material type (document, video, link, etc.)
- `startDate` (ISO date string, optional) - Filter by upload date start
- `endDate` (ISO date string, optional) - Filter by upload date end

**Response**:
```json
{
  "success": true,
  "data": {
    "materials": [
      {
        "materialId": "uuid",
        "materialName": "string",
        "materialType": "document" | "video" | "link" | "other",
        "courseId": "uuid",
        "courseName": "string",
        "childId": "uuid",
        "childName": "string",
        "uploadDate": "ISO date string",
        "fileSize": 0,
        "fileUrl": "string",
        "downloadable": true,
        "viewable": true
      }
    ]
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user

### GET /api/v1/parent/academic/calendar

Get academic calendar events for the authenticated parent's tenant.

**Query Parameters**:
- `academicYearId` (UUID, optional) - Filter by specific academic year
- `semester` (integer, optional) - Filter by semester number
- `startDate` (ISO date string, optional) - Filter by event date start
- `endDate` (ISO date string, optional) - Filter by event date end

**Response**:
```json
{
  "success": true,
  "data": {
    "events": [
      {
        "eventId": "uuid",
        "eventName": "string",
        "eventType": "semester_start" | "semester_end" | "holiday" | "break" | "special_event" | "academic_milestone",
        "eventDate": "ISO date string",
        "eventDescription": "string",
        "academicYearId": "uuid",
        "academicYearName": "string",
        "semester": 1
      }
    ]
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user

### GET /api/v1/parent/academic/exam-schedules

Get exam schedules for the authenticated parent's children.

**Query Parameters**:
- `childId` (UUID, optional) - Filter by specific child
- `courseId` (UUID, optional) - Filter by specific course
- `examType` (string, optional) - Filter by exam type (midterm, final, quiz, etc.)
- `startDate` (ISO date string, optional) - Filter by exam date start
- `endDate` (ISO date string, optional) - Filter by exam date end
- `academicYearId` (UUID, optional) - Filter by specific academic year

**Response**:
```json
{
  "success": true,
  "data": {
    "exams": [
      {
        "examId": "uuid",
        "examName": "string",
        "examType": "midterm" | "final" | "quiz" | "other",
        "courseId": "uuid",
        "courseName": "string",
        "childId": "uuid",
        "childName": "string",
        "examDate": "ISO date string",
        "examTime": "HH:MM",
        "duration": 0,
        "location": "string",
        "academicYearId": "uuid",
        "academicYearName": "string"
      }
    ]
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user

### GET /api/v1/parent/academic/academic-year

Get academic year information for the authenticated parent's tenant.

**Query Parameters**:
- `childId` (UUID, optional) - Filter by specific child
- `academicYearId` (UUID, optional) - Filter by specific academic year

**Response**:
```json
{
  "success": true,
  "data": {
    "academicYears": [
      {
        "academicYearId": "uuid",
        "academicYearName": "string",
        "startDate": "ISO date string",
        "endDate": "ISO date string",
        "isCurrent": true,
        "semesterInfo": {
          "semester1": {
            "startDate": "ISO date string",
            "endDate": "ISO date string"
          },
          "semester2": {
            "startDate": "ISO date string",
            "endDate": "ISO date string"
          }
        },
        "enrollmentDetails": [
          {
            "childId": "uuid",
            "childName": "string",
            "enrollmentDate": "ISO date string",
            "status": "active" | "graduated" | "suspended" | "dropped" | "transfer"
          }
        ],
        "academicMilestones": [
          {
            "name": "string",
            "date": "ISO date string",
            "description": "string"
          }
        ]
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
- `400 Bad Request` - Invalid query parameters or validation errors
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user or resource not accessible
- `404 Not Found` - Resource not found
- `500 Internal Server Error` - Server error

## Data Access Control

- All endpoints verify authenticated user ID matches parent ID through `student_parents` relationship
- Only academic information for authenticated parent's linked children is returned
- All queries are filtered by tenant_id via RLS
- Parent can only view information for their own linked children

