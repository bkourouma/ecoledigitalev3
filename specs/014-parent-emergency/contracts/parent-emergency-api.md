# API Contracts: Parent Emergency Contacts & Authorization

**Date**: 2025-01-27  
**Feature**: Parent Emergency Contacts & Authorization (`014-parent-emergency`)

## Base Path

All endpoints are prefixed with `/api/v1/parent/emergency`

## Authentication

All endpoints require:
- Authentication via `authMiddleware`
- Tenant context via `X-Tenant` header or subdomain
- Parent role (user must have 'parent' role)

## Endpoints

### GET /api/v1/parent/emergency/contacts

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

### POST /api/v1/parent/emergency/contacts

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

### PUT /api/v1/parent/emergency/contacts/:contactId

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

### DELETE /api/v1/parent/emergency/contacts/:contactId

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

### GET /api/v1/parent/emergency/pickup-authorization

Get pickup authorization for the authenticated parent's children.

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
        "canPickup": true,
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

### PUT /api/v1/parent/emergency/pickup-authorization/:relationshipId

Update pickup authorization for a specific parent-child relationship.

**Path Parameters**:
- `relationshipId` (UUID) - Parent-child relationship ID

**Request Body**:
```json
{
  "canPickup": true
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "relationship": {
      "id": "uuid",
      "childId": "uuid",
      "childName": "string",
      "relationshipType": "parent" | "guardian" | "emergency_contact",
      "canPickup": true,
      "updatedAt": "ISO date string"
    }
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `400 Bad Request` - Invalid request body or validation errors
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user or relationship not accessible
- `404 Not Found` - Relationship not found

### GET /api/v1/parent/emergency/relationship-types

Get relationship types for the authenticated parent's children.

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

### PUT /api/v1/parent/emergency/relationship-types/:relationshipId

Update relationship type for a specific parent-child relationship.

**Path Parameters**:
- `relationshipId` (UUID) - Parent-child relationship ID

**Request Body**:
```json
{
  "relationshipType": "parent" | "guardian" | "emergency_contact"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "relationship": {
      "id": "uuid",
      "childId": "uuid",
      "childName": "string",
      "relationshipType": "parent" | "guardian" | "emergency_contact",
      "requiresApproval": false,
      "updatedAt": "ISO date string"
    },
    "message": "Relationship type updated. This change may require administrative approval."
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `400 Bad Request` - Invalid request body or validation errors
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user or relationship not accessible
- `404 Not Found` - Relationship not found

### GET /api/v1/parent/emergency/data-access

Get data access information for the authenticated parent's children.

**Query Parameters**: None

**Response**:
```json
{
  "success": true,
  "data": {
    "dataAccess": [
      {
        "relationshipId": "uuid",
        "childId": "uuid",
        "childName": "string",
        "relationshipType": "parent" | "guardian" | "emergency_contact",
        "canPickup": true,
        "accessLevel": "full" | "limited" | "view-only",
        "accessibleDataTypes": ["grades", "attendance", "payments", "homework", "messages", "academic", "documents"]
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
- `400 Bad Request` - Invalid query parameters or request body, validation errors
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user or resource not accessible
- `404 Not Found` - Resource not found
- `500 Internal Server Error` - Server error

## Data Access Control

- All endpoints verify authenticated user ID matches parent ID before returning data
- Only emergency contacts and relationships for authenticated parent is returned
- All queries are filtered by tenant_id via RLS
- Parent can only view and manage their own emergency contacts and relationships



