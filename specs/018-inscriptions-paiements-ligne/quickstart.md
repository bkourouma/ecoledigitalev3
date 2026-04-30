# Quickstart Guide: Inscriptions & Paiements en Ligne

**Date**: 2025-11-20  
**Feature**: 018-inscriptions-paiements-ligne

## Overview

This quickstart guide provides examples for using the enrollment and payment APIs. It covers the complete enrollment-to-payment flow with code examples.

## Prerequisites

- API base URL: `http://localhost:8011/api/v1` (development)
- Authentication: JWT token in `Authorization` header (for protected endpoints)
- Tenant context: `X-Tenant` header (e.g., `imhotepdata`)

## Enrollment Flow

### Step 1: Check Session Availability

Before starting enrollment, verify the session has available places:

```bash
curl -X POST http://localhost:8011/api/v1/inscriptions-pro/verifier-disponibilite \
  -H "Content-Type: application/json" \
  -H "X-Tenant: imhotepdata" \
  -d '{
    "session_id": "550e8400-e29b-41d4-a716-446655440000"
  }'
```

**Response**:
```json
{
  "success": true,
  "data": {
    "disponible": true,
    "places_restantes": 5,
    "message": "5 places disponibles",
    "session": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "code_session": "DATA-2024-001",
      "date_debut": "2024-12-14",
      "date_fin": "2024-12-16",
      "places_totales": 20,
      "places_reservees": 15,
      "places_disponibles": 5,
      "statut": "ouverte"
    }
  }
}
```

### Step 2: Validate Promotional Code (Optional)

If user has a promotional code, validate it before creating enrollment:

```bash
curl -X POST http://localhost:8011/api/v1/codes-promo/valider \
  -H "Content-Type: application/json" \
  -H "X-Tenant: imhotepdata" \
  -d '{
    "code": "PROMO20",
    "formation_id": "660e8400-e29b-41d4-a716-446655440000",
    "montant": 150000
  }'
```

**Response**:
```json
{
  "success": true,
  "data": {
    "valide": true,
    "code_promo": {
      "id": "770e8400-e29b-41d4-a716-446655440000",
      "code": "PROMO20",
      "type_reduction": "pourcentage",
      "valeur_reduction": 20
    },
    "reduction_pourcentage": 20,
    "reduction_montant": 30000,
    "nouveau_montant": 120000,
    "message": "Réduction de 30000 FCFA appliquée"
  }
}
```

### Step 3: Create Individual Enrollment

Create an enrollment for an individual participant:

```bash
curl -X POST http://localhost:8011/api/v1/inscriptions-pro/creer \
  -H "Content-Type: application/json" \
  -H "X-Tenant: imhotepdata" \
  -H "Authorization: Bearer {jwt_token}" \
  -d '{
    "session_id": "550e8400-e29b-41d4-a716-446655440000",
    "type_inscription": "individuelle",
    "apprenant": {
      "civilite": "M.",
      "nom": "KOUASSI",
      "prenom": "Jean",
      "email": "jean.kouassi@example.com",
      "telephone": "+225 07 12 34 56 78",
      "poste": "Data Analyst"
    },
    "code_promo": "PROMO20",
    "cgv_accepte": true
  }'
```

**Response**:
```json
{
  "success": true,
  "data": {
    "inscription": {
      "id": "880e8400-e29b-41d4-a716-446655440000",
      "numero_inscription": "INS-DATA-20241120-001",
      "session_id": "550e8400-e29b-41d4-a716-446655440000",
      "apprenant_id": "990e8400-e29b-41d4-a716-446655440000",
      "entreprise_id": null,
      "type_inscription": "individuelle",
      "statut": "en_attente",
      "montant_ht": 101694.92,
      "montant_ttc": 120000,
      "code_promo_utilise": "PROMO20",
      "reduction_appliquee": 30000,
      "date_inscription": "2024-11-20T10:30:00Z"
    },
    "montant_final": 120000,
    "reduction_appliquee": 30000,
    "next_step": "paiement",
    "reservation_expires_at": "2024-11-20T10:45:00Z"
  }
}
```

### Step 4: Create Company Enrollment

Create an enrollment for a company participant:

```bash
curl -X POST http://localhost:8011/api/v1/inscriptions-pro/creer \
  -H "Content-Type: application/json" \
  -H "X-Tenant: imhotepdata" \
  -H "Authorization: Bearer {jwt_token}" \
  -d '{
    "session_id": "550e8400-e29b-41d4-a716-446655440000",
    "type_inscription": "entreprise",
    "entreprise": {
      "raison_sociale": "Tech Solutions CI",
      "siret": "CI12345678901234",
      "adresse": "123 Avenue de la République",
      "code_postal": "01 BP 1234",
      "ville": "Abidjan",
      "secteur_activite": "Technologie",
      "contact_nom": "DIABATE",
      "contact_prenom": "Marie",
      "contact_email": "marie.diabate@techsolutions.ci",
      "contact_telephone": "+225 05 12 34 56 78",
      "contact_poste": "Directrice RH"
    },
    "apprenant": {
      "civilite": "M.",
      "nom": "KOUAME",
      "prenom": "Paul",
      "email": "paul.kouame@techsolutions.ci",
      "telephone": "+225 07 98 76 54 32",
      "poste": "Développeur"
    },
    "cgv_accepte": true
  }'
```

### Step 5: Search for Existing Company

Before creating company enrollment, search for existing companies:

```bash
curl -X GET "http://localhost:8011/api/v1/entreprises/rechercher?q=Tech%20Solutions" \
  -H "X-Tenant: imhotepdata"
```

**Response**:
```json
{
  "success": true,
  "data": {
    "entreprises": [
      {
        "id": "aa0e8400-e29b-41d4-a716-446655440000",
        "raison_sociale": "Tech Solutions CI",
        "siret": "CI12345678901234",
        "adresse": "123 Avenue de la République",
        "code_postal": "01 BP 1234",
        "ville": "Abidjan"
      }
    ]
  }
}
```

## Payment Flow

### Step 1: Initiate Payment (Orange Money)

```bash
curl -X POST http://localhost:8011/api/v1/paiements-pro/initier \
  -H "Content-Type: application/json" \
  -H "X-Tenant: imhotepdata" \
  -H "Authorization: Bearer {jwt_token}" \
  -d '{
    "inscription_id": "880e8400-e29b-41d4-a716-446655440000",
    "methode_paiement": "orange_money",
    "montant": 120000,
    "telephone": "+225 07 12 34 56 78",
    "return_url": "http://localhost:3000/inscription/confirmation/880e8400-e29b-41d4-a716-446655440000"
  }'
```

**Response**:
```json
{
  "success": true,
  "data": {
    "paiement_id": "bb0e8400-e29b-41d4-a716-446655440000",
    "transaction_id": "TXN-20241120103045-ABC12",
    "reference_externe": "OM-20241120-123456",
    "ussd_code": "#150*50#",
    "instructions": "Composez #150*50# sur votre téléphone +225 07 12 34 56 78 pour valider le paiement"
  }
}
```

### Step 2: Poll Payment Status

After initiating payment, poll for status updates:

```bash
curl -X GET http://localhost:8011/api/v1/paiements-pro/bb0e8400-e29b-41d4-a716-446655440000/statut \
  -H "X-Tenant: imhotepdata" \
  -H "Authorization: Bearer {jwt_token}"
```

**Response** (pending):
```json
{
  "success": true,
  "data": {
    "statut": "en_attente",
    "paiement": {
      "id": "bb0e8400-e29b-41d4-a716-446655440000",
      "numero_transaction": "TXN-20241120103045-ABC12",
      "montant": 120000,
      "methode_paiement": "orange_money",
      "statut": "en_attente",
      "date_paiement": null,
      "reference_externe": "OM-20241120-123456"
    },
    "inscription": {
      "id": "880e8400-e29b-41d4-a716-446655440000",
      "numero_inscription": "INS-DATA-20241120-001",
      "statut": "en_attente"
    }
  }
}
```

**Response** (validated):
```json
{
  "success": true,
  "data": {
    "statut": "valide",
    "paiement": {
      "id": "bb0e8400-e29b-41d4-a716-446655440000",
      "numero_transaction": "TXN-20241120103045-ABC12",
      "montant": 120000,
      "methode_paiement": "orange_money",
      "statut": "valide",
      "date_paiement": "2024-11-20T10:35:00Z",
      "reference_externe": "OM-20241120-123456"
    },
    "inscription": {
      "id": "880e8400-e29b-41d4-a716-446655440000",
      "numero_inscription": "INS-DATA-20241120-001",
      "statut": "confirmee"
    }
  }
}
```

### Step 3: Initiate Payment (Bank Card)

For bank card payments, user is redirected to payment gateway:

```bash
curl -X POST http://localhost:8011/api/v1/paiements-pro/initier \
  -H "Content-Type: application/json" \
  -H "X-Tenant: imhotepdata" \
  -H "Authorization: Bearer {jwt_token}" \
  -d '{
    "inscription_id": "880e8400-e29b-41d4-a716-446655440000",
    "methode_paiement": "carte_bancaire",
    "montant": 120000,
    "return_url": "http://localhost:3000/inscription/callback/carte-bancaire"
  }'
```

**Response**:
```json
{
  "success": true,
  "data": {
    "paiement_id": "cc0e8400-e29b-41d4-a716-446655440000",
    "transaction_id": "TXN-20241120103045-DEF34",
    "reference_externe": "CP-20241120-789012",
    "redirect_url": "https://checkout.cinetpay.com/payment?token=abc123xyz",
    "instructions": "Vous allez être redirigé vers la page de paiement sécurisée"
  }
}
```

## Enrollment Management

### Get Enrollment Details

```bash
curl -X GET http://localhost:8011/api/v1/inscriptions-pro/880e8400-e29b-41d4-a716-446655440000 \
  -H "X-Tenant: imhotepdata" \
  -H "Authorization: Bearer {jwt_token}"
```

### Get User Enrollment History

```bash
curl -X GET "http://localhost:8011/api/v1/mon-compte/inscriptions-pro?statut=confirmee&page=1&limit=10" \
  -H "X-Tenant: imhotepdata" \
  -H "Authorization: Bearer {jwt_token}"
```

### Cancel Enrollment

```bash
curl -X PATCH http://localhost:8011/api/v1/inscriptions-pro/880e8400-e29b-41d4-a716-446655440000/annuler \
  -H "Content-Type: application/json" \
  -H "X-Tenant: imhotepdata" \
  -H "Authorization: Bearer {jwt_token}" \
  -d '{
    "raison": "Changement de planning"
  }'
```

### Download Invoice

```bash
curl -X GET http://localhost:8011/api/v1/inscriptions-pro/880e8400-e29b-41d4-a716-446655440000/facture \
  -H "X-Tenant: imhotepdata" \
  -H "Authorization: Bearer {jwt_token}" \
  --output facture.pdf
```

## Frontend Integration Example

### React Hook for Enrollment

```typescript
import { useMutation, useQuery } from '@tanstack/react-query';
import axios from 'axios';

const API_BASE = 'http://localhost:8011/api/v1';

// Check availability
export function useCheckAvailability(sessionId: string) {
  return useQuery({
    queryKey: ['session-availability', sessionId],
    queryFn: async () => {
      const { data } = await axios.post(
        `${API_BASE}/inscriptions-pro/verifier-disponibilite`,
        { session_id: sessionId },
        { headers: { 'X-Tenant': 'imhotepdata' } }
      );
      return data.data;
    },
    refetchInterval: 30000, // Poll every 30 seconds
  });
}

// Create enrollment
export function useCreateEnrollment() {
  return useMutation({
    mutationFn: async (enrollmentData: any) => {
      const { data } = await axios.post(
        `${API_BASE}/inscriptions-pro/creer`,
        enrollmentData,
        {
          headers: {
            'X-Tenant': 'imhotepdata',
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
          },
        }
      );
      return data.data;
    },
  });
}

// Initiate payment
export function useInitiatePayment() {
  return useMutation({
    mutationFn: async (paymentData: any) => {
      const { data } = await axios.post(
        `${API_BASE}/paiements-pro/initier`,
        paymentData,
        {
          headers: {
            'X-Tenant': 'imhotepdata',
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
          },
        }
      );
      return data.data;
    },
  });
}

// Poll payment status
export function usePaymentStatus(paymentId: string) {
  return useQuery({
    queryKey: ['payment-status', paymentId],
    queryFn: async () => {
      const { data } = await axios.get(
        `${API_BASE}/paiements-pro/${paymentId}/statut`,
        {
          headers: {
            'X-Tenant': 'imhotepdata',
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
          },
        }
      );
      return data.data;
    },
    enabled: !!paymentId,
    refetchInterval: (data) => {
      // Stop polling if payment validated or failed
      if (data?.statut === 'valide' || data?.statut === 'echoue') {
        return false;
      }
      return 5000; // Poll every 5 seconds
    },
  });
}
```

## Error Handling

All endpoints return consistent error responses:

```json
{
  "success": false,
  "error": {
    "code": "SESSION_FULL",
    "message": "Cette session est complète",
    "details": {
      "session_id": "550e8400-e29b-41d4-a716-446655440000",
      "places_disponibles": 0
    }
  }
}
```

Common error codes:
- `SESSION_FULL`: Session has no available places
- `SESSION_CLOSED`: Session is not open for enrollment
- `INVALID_CODE`: Promotional code is invalid or expired
- `AMOUNT_MISMATCH`: Payment amount doesn't match enrollment total
- `ENROLLMENT_EXPIRED`: Temporary reservation expired
- `DUPLICATE_ENROLLMENT`: User already enrolled in this session

## Notes

- All timestamps are in ISO 8601 format (UTC)
- All amounts are in FCFA (West African CFA franc)
- Temporary reservations expire 15 minutes after enrollment creation
- Payment status polling recommended for mobile money (5-second intervals, 5-minute timeout)
- Webhook endpoints are publicly accessible (signature verification required)
- Invoice download requires confirmed enrollment with validated payment

