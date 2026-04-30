# API Contracts: Parent Reports & Documents

**Date**: 2025-01-27  
**Feature**: Parent Reports & Documents (`013-parent-documents`)

## Base Path

All endpoints are prefixed with `/api/v1/parent/documents`

## Authentication

All endpoints require:
- Authentication via `authMiddleware`
- Tenant context via `X-Tenant` header or subdomain
- Parent role (user must have 'parent' role)

## Endpoints

### GET /api/v1/parent/documents/report-cards

Get report cards for the authenticated parent's children.

**Query Parameters**:
- `childId` (UUID, optional) - Filter by specific child
- `academicYearId` (UUID, optional) - Filter by specific academic year
- `semester` (integer, optional) - Filter by semester number

**Response**:
```json
{
  "success": true,
  "data": {
    "reportCards": [
      {
        "reportCardId": "uuid",
        "childId": "uuid",
        "childName": "string",
        "academicYearId": "uuid",
        "academicYearName": "string",
        "semester": 1,
        "reportDate": "ISO date string",
        "overallGrade": 0.0,
        "reportUrl": "string",
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

### GET /api/v1/parent/documents/transcripts

Get transcripts for the authenticated parent's children.

**Query Parameters**:
- `childId` (UUID, optional) - Filter by specific child
- `academicYearId` (UUID, optional) - Filter by specific academic year

**Response**:
```json
{
  "success": true,
  "data": {
    "transcripts": [
      {
        "transcriptId": "uuid",
        "childId": "uuid",
        "childName": "string",
        "academicYearId": "uuid",
        "academicYearName": "string",
        "transcriptDate": "ISO date string",
        "totalCredits": 0,
        "gpa": 0.0,
        "transcriptUrl": "string",
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

### GET /api/v1/parent/documents/attendance-reports

Get attendance reports for the authenticated parent's children.

**Query Parameters**:
- `childId` (UUID, optional) - Filter by specific child
- `academicYearId` (UUID, optional) - Filter by specific academic year
- `startDate` (ISO date string, optional) - Filter by report date start
- `endDate` (ISO date string, optional) - Filter by report date end

**Response**:
```json
{
  "success": true,
  "data": {
    "attendanceReports": [
      {
        "reportId": "uuid",
        "childId": "uuid",
        "childName": "string",
        "academicYearId": "uuid",
        "academicYearName": "string",
        "reportPeriod": "string",
        "reportDate": "ISO date string",
        "attendanceRate": 0.0,
        "totalDays": 0,
        "presentDays": 0,
        "absentDays": 0,
        "reportUrl": "string",
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

### GET /api/v1/parent/documents/payment-receipts

Get payment receipts for the authenticated parent's children.

**Query Parameters**:
- `childId` (UUID, optional) - Filter by specific child
- `academicYearId` (UUID, optional) - Filter by specific academic year
- `startDate` (ISO date string, optional) - Filter by payment date start
- `endDate` (ISO date string, optional) - Filter by payment date end

**Response**:
```json
{
  "success": true,
  "data": {
    "paymentReceipts": [
      {
        "receiptId": "uuid",
        "childId": "uuid",
        "childName": "string",
        "receiptNumber": "string",
        "paymentDate": "ISO date string",
        "amount": 0.0,
        "currency": "string",
        "paymentMethod": "string",
        "feeType": "tuition" | "inscription" | "annexes" | "autres",
        "academicYearId": "uuid",
        "academicYearName": "string",
        "receiptUrl": "string",
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
- Only reports and documents for authenticated parent's linked children is returned
- All queries are filtered by tenant_id via RLS
- Parent can only view reports for their own linked children

