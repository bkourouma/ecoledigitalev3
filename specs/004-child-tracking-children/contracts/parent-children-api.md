# API Contracts: Parent Children Tracking

**Date**: 2025-01-27  
**Feature**: Child Tracking (`004-child-tracking-children`)

## Base Path

All endpoints are prefixed with `/api/v1/parent/children`

## Authentication

All endpoints require:
- Authentication via `authMiddleware`
- Tenant context via `X-Tenant` header or subdomain
- Parent role (user must have 'parent' role)

## Endpoints

### GET /api/v1/parent/children

List all children linked to the authenticated parent.

**Query Parameters**: None

**Response**:
```json
{
  "success": true,
  "data": {
    "children": [
      {
        "id": "uuid",
        "name": "string",
        "email": "string",
        "currentYear": 1,
        "status": "active" | "suspended" | "dropped" | "transfer" | "graduated",
        "studentNumber": "string",
        "summaryIndicator": {
          "gradeAverage": 15.5 | null,
          "attendanceStatus": "good" | "warning" | null
        }
      }
    ],
    "total": 2
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user

### GET /api/v1/parent/children/:childId

Get child details.

**Path Parameters**:
- `childId` (UUID) - Child/student ID

**Response**:
```json
{
  "success": true,
  "data": {
    "child": {
      "id": "uuid",
      "name": "string",
      "email": "string",
      "currentYear": 1,
      "status": "active" | "suspended" | "dropped" | "transfer" | "graduated",
      "studentNumber": "string",
      "dateOfBirth": "YYYY-MM-DD" | null,
      "phone": "string" | null
    }
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `403 Forbidden` - Child not linked to parent
- `404 Not Found` - Child not found

### GET /api/v1/parent/children/:childId/grades-summary

Get grades summary for a child (all-time).

**Path Parameters**:
- `childId` (UUID) - Child/student ID

**Response**:
```json
{
  "success": true,
  "data": {
    "summary": {
      "averageGrade": 15.5,
      "totalAssignments": 25,
      "gradedAssignments": 20,
      "bestScore": 18.5,
      "gradeDistribution": {
        "excellent": 5,  // >= 16
        "good": 8,       // 14-15
        "average": 5,    // 12-13
        "belowAverage": 2 // < 12
      }
    }
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `403 Forbidden` - Child not linked to parent
- `404 Not Found` - Child not found

### GET /api/v1/parent/children/:childId/schedule

Get weekly schedule for a child.

**Path Parameters**:
- `childId` (UUID) - Child/student ID

**Query Parameters**:
- `week` (string, optional) - ISO week date (YYYY-MM-DD), defaults to current week

**Response**:
```json
{
  "success": true,
  "data": {
    "schedule": {
      "weekStart": "YYYY-MM-DD",
      "weekEnd": "YYYY-MM-DD",
      "sessions": [
        {
          "id": "uuid",
          "date": "YYYY-MM-DD",
          "startTime": "HH:mm",
          "endTime": "HH:mm",
          "courseName": "string",
          "courseCode": "string",
          "classroom": "string" | null,
          "teacherName": "string" | null
        }
      ]
    }
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `403 Forbidden` - Child not linked to parent
- `404 Not Found` - Child not found

### GET /api/v1/parent/children/:childId/upcoming-classes

Get upcoming classes for a child (next 7 days, max 10).

**Path Parameters**:
- `childId` (UUID) - Child/student ID

**Response**:
```json
{
  "success": true,
  "data": {
    "upcomingClasses": [
      {
        "id": "uuid",
        "date": "YYYY-MM-DD",
        "startTime": "HH:mm",
        "endTime": "HH:mm",
        "courseName": "string",
        "courseCode": "string",
        "classroom": "string" | null,
        "teacherName": "string" | null
      }
    ],
    "total": 8
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `403 Forbidden` - Child not linked to parent
- `404 Not Found` - Child not found

### GET /api/v1/parent/children/:childId/attendance

Get attendance records for a child (paginated).

**Path Parameters**:
- `childId` (UUID) - Child/student ID

**Query Parameters**:
- `page` (number, optional) - Page number (default: 1)
- `limit` (number, optional) - Records per page (default: 20, max: 100)

**Response**:
```json
{
  "success": true,
  "data": {
    "records": [
      {
        "id": "uuid",
        "date": "YYYY-MM-DD",
        "courseName": "string",
        "courseCode": "string",
        "status": "present" | "absent" | "late" | "excused" | "medical_leave",
        "arrivalTime": "HH:mm" | null,
        "departureTime": "HH:mm" | null,
        "excuseReason": "string" | null,
        "notes": "string" | null,
        "markedAt": "YYYY-MM-DDTHH:mm:ssZ"
      }
    ],
    "pagination": {
      "total": 150,
      "page": 1,
      "limit": 20,
      "totalPages": 8,
      "hasMore": true
    }
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `403 Forbidden` - Child not linked to parent
- `404 Not Found` - Child not found

### GET /api/v1/parent/children/:childId/absence-history

Get absence history for a child with filtering.

**Path Parameters**:
- `childId` (UUID) - Child/student ID

**Query Parameters**:
- `startDate` (string, optional) - Filter start date (YYYY-MM-DD)
- `endDate` (string, optional) - Filter end date (YYYY-MM-DD)
- `absenceType` (string, optional) - Filter by type: "excused", "unexcused", "medical", or "all"
- `courseId` (UUID, optional) - Filter by course ID

**Response**:
```json
{
  "success": true,
  "data": {
    "absences": [
      {
        "id": "uuid",
        "date": "YYYY-MM-DD",
        "courseName": "string",
        "courseCode": "string",
        "absenceType": "absent" | "excused" | "medical_leave",
        "excuseReason": "string" | null,
        "markedAt": "YYYY-MM-DDTHH:mm:ssZ"
      }
    ],
    "statistics": {
      "totalAbsences": 15,
      "excusedCount": 8,
      "unexcusedCount": 7,
      "medicalCount": 2,
      "absenceRate": 5.2  // percentage
    },
    "total": 15
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `403 Forbidden` - Child not linked to parent
- `404 Not Found` - Child not found

## Error Responses

All endpoints may return:

```json
{
  "success": false,
  "error": "Error Type",
  "message": "Human-readable error message"
}
```

**Common Status Codes**:
- `400 Bad Request` - Invalid parameters
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Access denied (child not linked to parent)
- `404 Not Found` - Resource not found
- `500 Internal Server Error` - Server error

## TypeScript Types

Types will be defined in `packages/contracts/src/parent.ts`:

```typescript
export interface ChildListItem {
  id: string;
  name: string;
  email: string;
  currentYear: number;
  status: 'active' | 'suspended' | 'dropped' | 'transfer' | 'graduated';
  studentNumber: string;
  summaryIndicator: {
    gradeAverage: number | null;
    attendanceStatus: 'good' | 'warning' | null;
  };
}

export interface GradesSummary {
  averageGrade: number;
  totalAssignments: number;
  gradedAssignments: number;
  bestScore: number;
  gradeDistribution: {
    excellent: number;
    good: number;
    average: number;
    belowAverage: number;
  };
}

export interface ScheduleSession {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  courseName: string;
  courseCode: string;
  classroom: string | null;
  teacherName: string | null;
}

export interface AttendanceRecord {
  id: string;
  date: string;
  courseName: string;
  courseCode: string;
  status: 'present' | 'absent' | 'late' | 'excused' | 'medical_leave';
  arrivalTime: string | null;
  departureTime: string | null;
  excuseReason: string | null;
  notes: string | null;
  markedAt: string;
}

export interface AbsenceRecord {
  id: string;
  date: string;
  courseName: string;
  courseCode: string;
  absenceType: 'absent' | 'excused' | 'medical_leave';
  excuseReason: string | null;
  markedAt: string;
}

export interface AbsenceStatistics {
  totalAbsences: number;
  excusedCount: number;
  unexcusedCount: number;
  medicalCount: number;
  absenceRate: number;
}
```

