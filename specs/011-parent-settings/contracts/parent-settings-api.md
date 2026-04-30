# API Contracts: Parent Profile & Settings

**Date**: 2025-01-27  
**Feature**: Parent Profile & Settings (`011-parent-settings`)

## Base Path

All endpoints are prefixed with `/api/v1/parent/settings`

## Authentication

All endpoints require:
- Authentication via `authMiddleware`
- Tenant context via `X-Tenant` header or subdomain
- Parent role (user must have 'parent' role)

## Endpoints

### GET /api/v1/parent/settings/profile

Get parent profile information.

**Query Parameters**: None

**Response**:
```json
{
  "success": true,
  "data": {
    "profile": {
      "id": "uuid",
      "email": "string",
      "firstName": "string",
      "lastName": "string",
      "name": "string",
      "phone": "string | null",
      "address": "string | null",
      "dateOfBirth": "ISO date string | null",
      "profilePictureUrl": "string | null",
      "createdAt": "ISO date string",
      "updatedAt": "ISO date string"
    }
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user

### PUT /api/v1/parent/settings/profile

Update parent profile information.

**Request Body**:
```json
{
  "firstName": "string",
  "lastName": "string",
  "phone": "string | null",
  "address": "string | null",
  "dateOfBirth": "ISO date string | null"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "profile": {
      "id": "uuid",
      "email": "string",
      "firstName": "string",
      "lastName": "string",
      "name": "string",
      "phone": "string | null",
      "address": "string | null",
      "dateOfBirth": "ISO date string | null",
      "profilePictureUrl": "string | null",
      "updatedAt": "ISO date string"
    }
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `400 Bad Request` - Invalid request body or validation errors
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user

### GET /api/v1/parent/settings/contact

Get contact information.

**Query Parameters**: None

**Response**:
```json
{
  "success": true,
  "data": {
    "contact": {
      "phone": "string | null",
      "email": "string",
      "address": "string | null"
    }
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user

### PUT /api/v1/parent/settings/contact

Update contact information.

**Request Body**:
```json
{
  "phone": "string | null",
  "email": "string",
  "address": "string | null"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "contact": {
      "phone": "string | null",
      "email": "string",
      "address": "string | null"
    }
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `400 Bad Request` - Invalid request body or validation errors
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user

### GET /api/v1/parent/settings/emergency-contacts

Get emergency contacts for the authenticated parent.

**Query Parameters**: None

**Response**:
```json
{
  "success": true,
  "data": {
    "contacts": [
      {
        "id": "uuid",
        "contactName": "string",
        "relationship": "string",
        "phone": "string",
        "email": "string | null",
        "createdAt": "ISO date string",
        "updatedAt": "ISO date string"
      }
    ]
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user

### POST /api/v1/parent/settings/emergency-contacts

Add a new emergency contact.

**Request Body**:
```json
{
  "contactName": "string",
  "relationship": "string",
  "phone": "string",
  "email": "string | null"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "contact": {
      "id": "uuid",
      "contactName": "string",
      "relationship": "string",
      "phone": "string",
      "email": "string | null",
      "createdAt": "ISO date string",
      "updatedAt": "ISO date string"
    }
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `400 Bad Request` - Invalid request body or validation errors
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user

### PUT /api/v1/parent/settings/emergency-contacts/:contactId

Update an existing emergency contact.

**Path Parameters**:
- `contactId` (UUID) - Emergency contact ID

**Request Body**:
```json
{
  "contactName": "string",
  "relationship": "string",
  "phone": "string",
  "email": "string | null"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "contact": {
      "id": "uuid",
      "contactName": "string",
      "relationship": "string",
      "phone": "string",
      "email": "string | null",
      "updatedAt": "ISO date string"
    }
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `400 Bad Request` - Invalid request body or validation errors
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user or contact not accessible
- `404 Not Found` - Contact not found

### DELETE /api/v1/parent/settings/emergency-contacts/:contactId

Remove an emergency contact.

**Path Parameters**:
- `contactId` (UUID) - Emergency contact ID

**Response**:
```json
{
  "success": true,
  "data": {
    "message": "Emergency contact removed successfully"
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user or contact not accessible
- `404 Not Found` - Contact not found

### GET /api/v1/parent/settings/notification-preferences

Get notification preferences for the authenticated parent.

**Query Parameters**: None

**Response**:
```json
{
  "success": true,
  "data": {
    "preferences": [
      {
        "id": "uuid",
        "notificationType": "message" | "announcement" | "event" | "grade" | "payment" | "other",
        "enabled": true,
        "deliveryMethods": ["email", "in-app", "sms"]
      }
    ]
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user

### PUT /api/v1/parent/settings/notification-preferences

Update notification preferences for the authenticated parent.

**Request Body**:
```json
{
  "preferences": [
    {
      "notificationType": "message" | "announcement" | "event" | "grade" | "payment" | "other",
      "enabled": true,
      "deliveryMethods": ["email", "in-app", "sms"]
    }
  ]
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "preferences": [
      {
        "id": "uuid",
        "notificationType": "message" | "announcement" | "event" | "grade" | "payment" | "other",
        "enabled": true,
        "deliveryMethods": ["email", "in-app", "sms"]
      }
    ]
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `400 Bad Request` - Invalid request body or validation errors
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user

### GET /api/v1/parent/settings/relationships

Get relationship management information for the authenticated parent.

**Query Parameters**: None

**Response**:
```json
{
  "success": true,
  "data": {
    "relationships": [
      {
        "id": "uuid",
        "childId": "uuid",
        "childName": "string",
        "relationshipType": "parent" | "guardian" | "emergency_contact",
        "isPrimaryContact": true,
        "emergencyContact": false,
        "canPickup": true,
        "notes": "string | null",
        "createdAt": "ISO date string"
      }
    ]
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user

### POST /api/v1/parent/settings/change-password

Change password for the authenticated parent.

**Request Body**:
```json
{
  "currentPassword": "string",
  "newPassword": "string",
  "confirmPassword": "string"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "message": "Password changed successfully"
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `400 Bad Request` - Invalid request body, validation errors, or current password incorrect
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
- `400 Bad Request` - Invalid query parameters or request body, validation errors
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user or resource not accessible
- `404 Not Found` - Resource not found
- `500 Internal Server Error` - Server error

## Data Access Control

- All endpoints verify authenticated user ID matches parent ID
- Only profile and settings data for authenticated parent is returned
- All queries are filtered by tenant_id via RLS
- Parent can only view and edit their own profile and settings

