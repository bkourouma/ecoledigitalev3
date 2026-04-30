# API Contracts: Paiements Professionnels

**Date**: 2025-11-20  
**Feature**: 018-inscriptions-paiements-ligne  
**Base Path**: `/api/v1/paiements-pro`

## Overview

This document defines the API contracts for the professional training payment processing system. Endpoints handle payment initiation, status checking, webhook processing, and payment verification.

---

## Endpoints

### 1. POST /api/v1/paiements-pro/initier

**Description**: Initiate a payment transaction for an enrollment

**Authentication**: Required (or enrollment token)

**Request Body**:
```typescript
{
  inscription_id: string;         // UUID of the enrollment
  methode_paiement: 'orange_money' | 'mtn_money' | 'wave' | 'carte_bancaire' | 'tresorpay';
  montant: number;                 // Must match enrollment.montant_ttc
  telephone?: string;              // Required for mobile money methods
  return_url?: string;             // URL to redirect after payment (defaults to confirmation page)
}
```

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    paiement_id: string;
    transaction_id: string;        // Format: TXN-YYYYMMDDHHMMSS-XXXXX
    reference_externe: string | null;  // Provider transaction reference
    
    // Response varies by payment method:
    
    // For mobile money (Orange Money, MTN Money):
    ussd_code?: string;            // USSD code to dial
    instructions?: string;         // Payment instructions
    
    // For Wave:
    qr_code?: string;              // QR code image URL
    redirect_url?: string;         // Wave payment URL
    
    // For bank card / TresorPay:
    redirect_url?: string;         // Redirect to payment gateway
  };
}
```

**Error Responses**:
- `400 Bad Request`: Invalid input, amount mismatch, enrollment not pending
- `401 Unauthorized`: Not authenticated
- `404 Not Found`: Enrollment not found
- `409 Conflict`: Payment already initiated
- `500 Internal Server Error`: Payment provider error

---

### 2. GET /api/v1/paiements-pro/:id/statut

**Description**: Check payment status (for polling)

**Authentication**: Required (or enrollment token)

**Path Parameters**:
- `id` (string): Payment UUID

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    statut: 'en_attente' | 'valide' | 'echoue' | 'rembourse' | 'annule';
    paiement: {
      id: string;
      numero_transaction: string;
      montant: number;
      methode_paiement: string;
      statut: string;
      date_paiement: string | null;
      reference_externe: string | null;
    };
    inscription: {
      id: string;
      numero_inscription: string;
      statut: string;
    };
  };
}
```

**Error Responses**:
- `401 Unauthorized`: Not authenticated
- `404 Not Found`: Payment not found

---

### 3. POST /api/v1/paiements-pro/webhook/:provider

**Description**: Webhook endpoint for payment provider notifications

**Authentication**: Provider signature verification (not user authentication)

**Path Parameters**:
- `provider` (string): Payment provider name ('orange-money', 'mtn-money', 'wave', 'carte-bancaire', 'tresorpay')

**Request Body**: Provider-specific webhook payload (varies by provider)

**Response** (200 OK):
```typescript
{
  status: 'success';
}
```

**Error Responses**:
- `400 Bad Request`: Invalid webhook payload
- `401 Unauthorized`: Invalid webhook signature
- `404 Not Found`: Transaction not found
- `500 Internal Server Error`: Processing error

**Webhook Processing**:
1. Verify webhook signature (provider-specific)
2. Extract transaction ID and status from payload
3. Update payment record
4. If payment validated: trigger enrollment confirmation workflow
5. Return 200 OK (or appropriate error status)

---

### 4. POST /api/v1/paiements-pro/:id/verifier

**Description**: Manually verify payment status with provider (backup if webhook fails)

**Authentication**: Required (admin only, or system)

**Path Parameters**:
- `id` (string): Payment UUID

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    statut_actuel: 'en_attente' | 'valide' | 'echoue' | 'rembourse' | 'annule';
    mis_a_jour: boolean;           // Whether status was updated
    paiement: {
      id: string;
      statut: string;
      date_paiement: string | null;
    };
  };
}
```

**Error Responses**:
- `401 Unauthorized`: Not authenticated
- `403 Forbidden`: Not admin
- `404 Not Found`: Payment not found
- `500 Internal Server Error`: Provider API error

---

### 5. GET /api/v1/paiements-pro/by-transaction/:transactionId

**Description**: Get payment by transaction number (for callback handling)

**Authentication**: Not required (public endpoint, used in callbacks)

**Path Parameters**:
- `transactionId` (string): Transaction number (TXN-YYYYMMDDHHMMSS-XXXXX)

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    paiement: {
      id: string;
      numero_transaction: string;
      inscription_id: string;
      montant: number;
      methode_paiement: string;
      statut: string;
      reference_externe: string | null;
    };
  };
}
```

**Error Responses**:
- `404 Not Found`: Transaction not found

---

## Payment Provider Webhook Payloads

### Orange Money Webhook

```typescript
{
  order_id: string;           // Our transaction_id
  status: 'SUCCESS' | 'FAILED' | 'EXPIRED';
  payment_token: string;
  amount: number;
  currency: string;
}
```

### MTN Money Webhook

```typescript
{
  // MTN sends webhook with X-Reference-Id header
  // Need to query MTN API to get status
  // Webhook contains minimal info, status check required
}
```

### Wave Webhook

```typescript
{
  id: string;                 // Wave checkout ID
  status: 'completed' | 'cancelled' | 'failed';
  amount: number;
  currency: string;
  metadata: {
    inscription_id: string;
    transaction_id: string;
  };
}
```

### Carte Bancaire (CinetPay) Webhook

```typescript
{
  cpm_trans_id: string;       // Our transaction_id
  cpm_trans_status: '00' | '01';  // 00 = success, 01 = failed
  cpm_amount: number;
  cpm_custom: string;          // JSON metadata
}
```

### TresorPay Webhook

```typescript
{
  transaction_id: string;      // Our transaction_id
  status: 'SUCCESS' | 'FAILED' | 'CANCELLED';
  amount: number;
  signature: string;           // Signature for verification
}
```

---

## Payment Status Flow

```
en_attente (payment initiated)
    ↓
    ├─→ valide (payment confirmed via webhook/polling)
    │       ↓
    │   (enrollment confirmed, invoice generated)
    │
    ├─→ echoue (payment failed)
    │       ↓
    │   (user notified, can retry)
    │
    └─→ annule (payment cancelled)
            ↓
        (reservation released)
```

---

## Notes

- Payment initiation creates payment record with status 'en_attente'
- Webhook endpoints verify provider signatures for security
- Payment status polling recommended for mobile money (5-second intervals)
- Payment verification endpoint allows manual status checks
- All payment amounts must match enrollment total
- Only one validated payment per enrollment allowed
- Payment provider credentials stored in environment variables

