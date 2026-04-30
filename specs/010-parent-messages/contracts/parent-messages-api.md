# API Contracts: Parent Communications & Messages

**Date**: 2025-01-27  
**Feature**: Parent Communications & Messages (`010-parent-messages`)

## Base Path

All endpoints are prefixed with `/api/v1/parent/messages`

## Authentication

All endpoints require:
- Authentication via `authMiddleware`
- Tenant context via `X-Tenant` header or subdomain
- Parent role (user must have 'parent' role)

## Endpoints

### GET /api/v1/parent/messages/teacher-messages

List all messages from teachers for children linked to the authenticated parent.

**Query Parameters**:
- `childId` (UUID, optional) - Filter by specific child
- `teacherId` (UUID, optional) - Filter by specific teacher
- `startDate` (ISO date string, optional) - Filter by date range start
- `endDate` (ISO date string, optional) - Filter by date range end
- `readStatus` (string, optional) - Filter by read/unread status (read, unread)
- `page` (integer, default: 1) - Page number for pagination
- `limit` (integer, default: 20) - Number of records per page

**Response**:
```json
{
  "success": true,
  "data": {
    "messages": [
      {
        "id": "uuid",
        "childId": "uuid",
        "childName": "string",
        "teacherId": "uuid",
        "teacherName": "string",
        "subject": "string",
        "content": "string",
        "priorityLevel": "low" | "normal" | "high" | "urgent" | null,
        "sentAt": "ISO date string",
        "isRead": true,
        "readAt": "ISO date string | null"
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

### GET /api/v1/parent/messages/announcements

Get school announcements for the authenticated parent's tenant/school.

**Query Parameters**:
- `startDate` (ISO date string, optional) - Filter by date range start
- `endDate` (ISO date string, optional) - Filter by date range end
- `priorityLevel` (string, optional) - Filter by priority level (low, normal, high, urgent)
- `readStatus` (string, optional) - Filter by read/unread status (read, unread)
- `page` (integer, default: 1) - Page number for pagination
- `limit` (integer, default: 20) - Number of records per page

**Response**:
```json
{
  "success": true,
  "data": {
    "announcements": [
      {
        "id": "uuid",
        "title": "string",
        "content": "string",
        "authorId": "uuid",
        "authorName": "string",
        "priorityLevel": "low" | "normal" | "high" | "urgent" | null,
        "postedAt": "ISO date string",
        "isRead": true,
        "readAt": "ISO date string | null"
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

### GET /api/v1/parent/messages/conversations

Get parent-teacher conversation threads for children linked to the authenticated parent.

**Query Parameters**:
- `childId` (UUID, optional) - Filter by specific child
- `teacherId` (UUID, optional) - Filter by specific teacher
- `status` (string, optional) - Filter by conversation status (active, archived, closed)

**Response**:
```json
{
  "success": true,
  "data": {
    "conversations": [
      {
        "id": "uuid",
        "childId": "uuid",
        "childName": "string",
        "teacherId": "uuid",
        "teacherName": "string",
        "subject": "string",
        "lastMessagePreview": "string",
        "lastMessageDate": "ISO date string",
        "unreadCount": 2,
        "status": "active" | "archived" | "closed"
      }
    ]
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user

### GET /api/v1/parent/messages/conversations/:conversationId

Get a conversation thread with all messages.

**Path Parameters**:
- `conversationId` (UUID) - Conversation ID

**Response**:
```json
{
  "success": true,
  "data": {
    "conversation": {
      "id": "uuid",
      "childId": "uuid",
      "childName": "string",
      "teacherId": "uuid",
      "teacherName": "string",
      "subject": "string",
      "status": "active" | "archived" | "closed",
      "messages": [
        {
          "id": "uuid",
          "senderId": "uuid",
          "senderName": "string",
          "content": "string",
          "sentAt": "ISO date string",
          "isRead": true,
          "readAt": "ISO date string | null"
        }
      ]
    }
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user or conversation not accessible
- `404 Not Found` - Conversation not found

### POST /api/v1/parent/messages/conversations/:conversationId/reply

Reply to a conversation thread.

**Path Parameters**:
- `conversationId` (UUID) - Conversation ID

**Request Body**:
```json
{
  "content": "string"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "message": {
      "id": "uuid",
      "senderId": "uuid",
      "senderName": "string",
      "content": "string",
      "sentAt": "ISO date string",
      "isRead": false,
      "readAt": null
    }
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `400 Bad Request` - Invalid request body
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user or conversation not accessible
- `404 Not Found` - Conversation not found

### GET /api/v1/parent/messages/notifications

Get notifications for the authenticated parent.

**Query Parameters**:
- `notificationType` (string, optional) - Filter by notification type (message, announcement, event, grade, payment, other)
- `startDate` (ISO date string, optional) - Filter by date range start
- `endDate` (ISO date string, optional) - Filter by date range end
- `readStatus` (string, optional) - Filter by read/unread status (read, unread)
- `page` (integer, default: 1) - Page number for pagination
- `limit` (integer, default: 20) - Number of records per page

**Response**:
```json
{
  "success": true,
  "data": {
    "notifications": [
      {
        "id": "uuid",
        "notificationType": "message" | "announcement" | "event" | "grade" | "payment" | "other",
        "title": "string",
        "content": "string",
        "actionLink": "string | null",
        "createdAt": "ISO date string",
        "isRead": true,
        "readAt": "ISO date string | null"
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

### POST /api/v1/parent/messages/notifications/:notificationId/read

Mark a notification as read.

**Path Parameters**:
- `notificationId` (UUID) - Notification ID

**Response**:
```json
{
  "success": true,
  "data": {
    "notification": {
      "id": "uuid",
      "isRead": true,
      "readAt": "ISO date string"
    }
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user or notification not accessible
- `404 Not Found` - Notification not found

### GET /api/v1/parent/messages/event-invitations

Get event invitations for children linked to the authenticated parent.

**Query Parameters**:
- `childId` (UUID, optional) - Filter by specific child
- `eventType` (string, optional) - Filter by event type
- `startDate` (ISO date string, optional) - Filter by date range start
- `endDate` (ISO date string, optional) - Filter by date range end
- `rsvpStatus` (string, optional) - Filter by RSVP status (pending, accepted, declined, tentative)

**Response**:
```json
{
  "success": true,
  "data": {
    "invitations": [
      {
        "id": "uuid",
        "eventId": "uuid",
        "childId": "uuid | null",
        "childName": "string | null",
        "eventName": "string",
        "eventDescription": "string",
        "eventDate": "ISO date string",
        "eventLocation": "string",
        "organizerId": "uuid",
        "organizerName": "string",
        "rsvpStatus": "pending" | "accepted" | "declined" | "tentative",
        "rsvpDeadline": "ISO date string",
        "rsvpResponseAt": "ISO date string | null"
      }
    ]
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user

### POST /api/v1/parent/messages/event-invitations/:invitationId/rsvp

Respond to an event invitation with RSVP.

**Path Parameters**:
- `invitationId` (UUID) - Invitation ID

**Request Body**:
```json
{
  "rsvpStatus": "accepted" | "declined" | "tentative"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "invitation": {
      "id": "uuid",
      "rsvpStatus": "accepted" | "declined" | "tentative",
      "rsvpResponseAt": "ISO date string"
    }
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `400 Bad Request` - Invalid request body or RSVP deadline passed
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user or invitation not accessible
- `404 Not Found` - Invitation not found

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
- `400 Bad Request` - Invalid query parameters or request body
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user or child not linked to parent
- `404 Not Found` - Resource not found
- `500 Internal Server Error` - Server error

## Data Access Control

- All endpoints verify parent-child relationship via `student_parents` table
- Only communication data for children linked to authenticated parent is returned
- All queries are filtered by tenant_id via RLS
- Parent can only access communication information for children explicitly linked to their account

