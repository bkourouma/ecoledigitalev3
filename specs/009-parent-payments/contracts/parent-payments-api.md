# API Contracts: Parent Payments & Finances

**Date**: 2025-01-27  
**Feature**: Parent Payments & Finances (`009-parent-payments`)

## Base Path

All endpoints are prefixed with `/api/v1/parent/payments`

## Authentication

All endpoints require:
- Authentication via `authMiddleware`
- Tenant context via `X-Tenant` header or subdomain
- Parent role (user must have 'parent' role)

## Endpoints

### GET /api/v1/parent/payments/history

List all payment transactions for children linked to the authenticated parent.

**Query Parameters**:
- `childId` (UUID, optional) - Filter by specific child
- `feeType` (string, optional) - Filter by fee type (tuition, inscription, annexes, autres)
- `startDate` (ISO date string, optional) - Filter by date range start
- `endDate` (ISO date string, optional) - Filter by date range end
- `status` (string, optional) - Filter by payment status (pending, completed, failed, cancelled)
- `page` (integer, default: 1) - Page number for pagination
- `limit` (integer, default: 20) - Number of records per page

**Response**:
```json
{
  "success": true,
  "data": {
    "transactions": [
      {
        "id": "uuid",
        "childId": "uuid",
        "childName": "string",
        "feeType": "tuition" | "inscription" | "annexes" | "autres",
        "amount": 50000.00,
        "currency": "XOF",
        "paymentMethod": "string",
        "status": "completed" | "pending" | "failed" | "cancelled",
        "receiptUrl": "string | null",
        "processedAt": "ISO date string | null",
        "createdAt": "ISO date string"
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

### GET /api/v1/parent/payments/installments

Get tuition installments for children linked to the authenticated parent.

**Query Parameters**:
- `childId` (UUID, optional) - Filter by specific child

**Response**:
```json
{
  "success": true,
  "data": {
    "installments": [
      {
        "id": "uuid",
        "childId": "uuid",
        "childName": "string",
        "installmentNumber": 1,
        "installmentLabel": "string",
        "amount": 50000.00,
        "dueDate": "ISO date string",
        "status": "pending" | "paid" | "overdue" | "partial",
        "amountPaid": 0.00,
        "lateFee": 0.00
      }
    ]
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user

### GET /api/v1/parent/payments/schedules

Get payment schedules for children linked to the authenticated parent.

**Query Parameters**:
- `childId` (UUID, optional) - Filter by specific child

**Response**:
```json
{
  "success": true,
  "data": {
    "schedules": [
      {
        "id": "uuid",
        "childId": "uuid",
        "childName": "string",
        "scheduleName": "string",
        "academicYear": "string",
        "totalTuition": 500000.00,
        "numberOfInstallments": 10,
        "installmentAmounts": [50000.00, 50000.00, ...],
        "dueDates": ["ISO date string", "ISO date string", ...]
      }
    ]
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user

### GET /api/v1/parent/payments/balances

Get outstanding balances for children linked to the authenticated parent.

**Query Parameters**:
- `childId` (UUID, optional) - Filter by specific child
- `feeType` (string, optional) - Filter by fee type (tuition, inscription, annexes, autres)

**Response**:
```json
{
  "success": true,
  "data": {
    "balances": [
      {
        "childId": "uuid",
        "childName": "string",
        "feeType": "tuition" | "inscription" | "annexes" | "autres",
        "totalOutstanding": 100000.00,
        "amountPaid": 400000.00,
        "amountDue": 100000.00
      }
    ]
  }
}
```

**Status Codes**:
- `200 OK` - Success
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not a parent user

### GET /api/v1/parent/payments/receipts

Get payment receipts for children linked to the authenticated parent.

**Query Parameters**:
- `childId` (UUID, optional) - Filter by specific child
- `feeType` (string, optional) - Filter by fee type (tuition, inscription, annexes, autres)
- `startDate` (ISO date string, optional) - Filter by date range start
- `endDate` (ISO date string, optional) - Filter by date range end
- `page` (integer, default: 1) - Page number for pagination
- `limit` (integer, default: 20) - Number of records per page

**Response**:
```json
{
  "success": true,
  "data": {
    "receipts": [
      {
        "id": "uuid",
        "transactionId": "uuid",
        "receiptNumber": "string",
        "receiptUrl": "string",
        "childId": "uuid",
        "childName": "string",
        "feeType": "tuition" | "inscription" | "annexes" | "autres",
        "amount": 50000.00,
        "paymentMethod": "string",
        "generatedAt": "ISO date string"
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

### GET /api/v1/parent/payments/methods

Get payment methods for the authenticated parent.

**Query Parameters**: None

**Response**:
```json
{
  "success": true,
  "data": {
    "methods": [
      {
        "id": "uuid",
        "methodType": "card" | "bank_transfer" | "mobile_money" | "other",
        "last4Digits": "string | null",
        "expirationDate": "ISO date string | null",
        "isDefault": true
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
- Only payment data for children linked to authenticated parent is returned
- All queries are filtered by tenant_id via RLS
- Parent can only access payment information for children explicitly linked to their account

