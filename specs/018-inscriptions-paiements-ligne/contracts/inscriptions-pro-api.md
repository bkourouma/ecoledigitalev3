# API Contracts: Inscriptions Professionnelles

**Date**: 2025-11-20  
**Feature**: 018-inscriptions-paiements-ligne  
**Base Path**: `/api/v1/inscriptions-pro`

## Overview

This document defines the API contracts for the professional training enrollment system. Endpoints handle enrollment creation, availability checking, promotional code validation, enrollment history, and enrollment cancellation.

---

## Endpoints

### 1. POST /api/v1/inscriptions-pro/verifier-disponibilite

**Description**: Check real-time session availability before and during enrollment process

**Authentication**: Not required (public endpoint)

**Request Body**:
```typescript
{
  session_id: string;  // UUID of the training session
}
```

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    disponible: boolean;           // Whether session has available places
    places_restantes: number;      // Number of available places
    message: string;               // Human-readable message
    session: {
      id: string;
      code_session: string;
      date_debut: string;          // ISO date
      date_fin: string;             // ISO date
      places_totales: number;
      places_reservees: number;
      places_disponibles: number;
      statut: 'planifiee' | 'ouverte' | 'complete' | 'en_cours' | 'terminee' | 'annulee';
    };
  };
}
```

**Error Responses**:
- `400 Bad Request`: Invalid session_id
- `404 Not Found`: Session not found
- `500 Internal Server Error`: Server error

---

### 2. POST /api/v1/inscriptions-pro/creer

**Description**: Create a new enrollment (individual or company) with temporary reservation

**Authentication**: Optional (if user logged in, links to account; otherwise creates new account)

**Request Body**:
```typescript
{
  session_id: string;              // UUID of the training session
  type_inscription: 'individuelle' | 'entreprise';
  
  // For individual enrollment
  apprenant?: {
    civilite?: 'M.' | 'Mme' | 'Autre';
    nom: string;
    prenom: string;
    email: string;
    telephone: string;
    poste?: string;
  };
  apprenant_id?: string;           // UUID if user already exists/logged in
  
  // For company enrollment
  entreprise?: {
    raison_sociale: string;
    siret: string;
    adresse: string;
    code_postal?: string;
    ville: string;
    secteur_activite?: string;
    contact_nom: string;
    contact_prenom: string;
    contact_email: string;
    contact_telephone: string;
    contact_poste?: string;
  };
  entreprise_id?: string;          // UUID if company already exists
  
  code_promo?: string;             // Optional promotional code
  cgv_accepte: boolean;            // Must be true
}
```

**Response** (201 Created):
```typescript
{
  success: true;
  data: {
    inscription: {
      id: string;
      numero_inscription: string;   // Format: INS-DATA-YYYYMMDD-XXX
      session_id: string;
      apprenant_id: string;
      entreprise_id: string | null;
      type_inscription: 'individuelle' | 'entreprise';
      statut: 'en_attente';
      montant_ht: number;
      montant_ttc: number;
      code_promo_utilise: string | null;
      reduction_appliquee: number;
      date_inscription: string;      // ISO timestamp
    };
    montant_final: number;
    reduction_appliquee: number;
    next_step: 'paiement';
    reservation_expires_at: string; // ISO timestamp (15 minutes from now)
  };
}
```

**Error Responses**:
- `400 Bad Request`: Invalid input, session full, CGV not accepted
- `404 Not Found`: Session not found
- `409 Conflict`: Duplicate enrollment attempt
- `422 Unprocessable Entity`: Validation errors
- `500 Internal Server Error`: Server error

---

### 3. GET /api/v1/inscriptions-pro/:id

**Description**: Get enrollment details by ID

**Authentication**: Required (user must own enrollment or be admin)

**Path Parameters**:
- `id` (string): Enrollment UUID

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    inscription: {
      id: string;
      numero_inscription: string;
      session: {
        id: string;
        code_session: string;
        date_debut: string;
        date_fin: string;
        horaires: string;
        mode_formation: 'presential' | 'remote' | 'hybrid' | 'elearning';
        lieu: string | null;
        lien_visio: string | null;
        formation: {
          id: string;
          titre: string;
          slug: string;
        };
      };
      apprenant: {
        id: string;
        email: string;
        profile: {
          civilite: string | null;
          nom: string;
          prenom: string;
          telephone: string | null;
        };
      };
      entreprise: {
        id: string;
        raison_sociale: string;
        siret: string;
      } | null;
      type_inscription: 'individuelle' | 'entreprise';
      statut: 'en_attente' | 'confirmee' | 'annulee' | 'terminee';
      montant_ht: number;
      montant_ttc: number;
      code_promo_utilise: string | null;
      reduction_appliquee: number;
      facture_numero: string | null;
      facture_url: string | null;
      date_inscription: string;
      paiements: Array<{
        id: string;
        numero_transaction: string;
        montant: number;
        methode_paiement: string;
        statut: string;
        date_paiement: string | null;
      }>;
    };
  };
}
```

**Error Responses**:
- `401 Unauthorized`: Not authenticated
- `403 Forbidden`: User doesn't own enrollment
- `404 Not Found`: Enrollment not found

---

### 4. PATCH /api/v1/inscriptions-pro/:id/annuler

**Description**: Cancel an enrollment (before session start)

**Authentication**: Required (user must own enrollment)

**Path Parameters**:
- `id` (string): Enrollment UUID

**Request Body**:
```typescript
{
  raison?: string;  // Optional cancellation reason
}
```

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    message: 'Inscription annulée';
    inscription: {
      id: string;
      statut: 'annulee';
    };
  };
}
```

**Error Responses**:
- `400 Bad Request`: Cannot cancel (session started, already cancelled, etc.)
- `401 Unauthorized`: Not authenticated
- `403 Forbidden`: User doesn't own enrollment
- `404 Not Found`: Enrollment not found

---

### 5. GET /api/v1/inscriptions-pro/:id/facture

**Description**: Download invoice PDF for confirmed enrollment

**Authentication**: Required (user must own enrollment or be admin)

**Path Parameters**:
- `id` (string): Enrollment UUID

**Response** (200 OK):
- Content-Type: `application/pdf`
- Body: PDF file stream
- Headers: `Content-Disposition: attachment; filename="facture-{numero}.pdf"`

**Error Responses**:
- `401 Unauthorized`: Not authenticated
- `403 Forbidden`: User doesn't own enrollment
- `404 Not Found`: Enrollment not found or invoice not generated
- `500 Internal Server Error`: PDF generation failed

---

### 6. GET /api/v1/mon-compte/inscriptions-pro

**Description**: Get user's enrollment history with filtering

**Authentication**: Required

**Query Parameters**:
```typescript
{
  statut?: 'en_attente' | 'confirmee' | 'annulee' | 'terminee' | 'toutes';
  date_debut?: string;      // ISO date
  date_fin?: string;        // ISO date
  search?: string;          // Search in training title or session code
  page?: number;            // Default: 1
  limit?: number;           // Default: 10, Max: 50
}
```

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    inscriptions: Array<{
      id: string;
      numero_inscription: string;
      session: {
        code_session: string;
        date_debut: string;
        date_fin: string;
        formation: {
          titre: string;
        };
      };
      statut: string;
      montant_ttc: number;
      date_inscription: string;
      paiement_statut: string | null;
    }>;
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
}
```

**Error Responses**:
- `401 Unauthorized`: Not authenticated
- `400 Bad Request`: Invalid query parameters

---

### 7. GET /api/v1/entreprises/rechercher

**Description**: Search for existing companies (autocomplete)

**Authentication**: Not required (public endpoint)

**Query Parameters**:
```typescript
{
  q: string;  // Search query (company name or SIRET)
}
```

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    entreprises: Array<{
      id: string;
      raison_sociale: string;
      siret: string;
      adresse: string;
      code_postal: string | null;
      ville: string;
    }>;
  };
}
```

**Error Responses**:
- `400 Bad Request`: Missing or invalid query parameter

---

## Promotional Code Endpoints

### 8. POST /api/v1/codes-promo/valider

**Description**: Validate and calculate discount for a promotional code

**Authentication**: Not required (public endpoint)

**Request Body**:
```typescript
{
  code: string;           // Promotional code (case-insensitive)
  formation_id: string;   // UUID of training program
  montant: number;        // Original amount (FCFA)
}
```

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    valide: boolean;
    code_promo: {
      id: string;
      code: string;
      type_reduction: 'pourcentage' | 'montant_fixe';
      valeur_reduction: number;
    } | null;
    reduction_pourcentage: number | null;  // If percentage type
    reduction_montant: number;             // Calculated discount amount
    nouveau_montant: number;               // Final amount after discount
    message: string;                       // Success or error message
  };
}
```

**Error Responses**:
- `400 Bad Request`: Invalid input
- `404 Not Found`: Code not found (returns valide: false with message)

---

## Common Error Response Format

```typescript
{
  success: false;
  error: {
    code: string;        // Error code (e.g., 'SESSION_FULL', 'INVALID_CODE')
    message: string;     // Human-readable error message
    details?: any;       // Additional error details
  };
}
```

---

## Notes

- All endpoints respect tenant isolation via RLS policies
- Enrollment creation creates temporary 15-minute reservation
- Promotional code validation is real-time and doesn't reserve the code
- Invoice generation requires confirmed enrollment with validated payment
- Enrollment history is scoped to authenticated user's enrollments
- Company search is case-insensitive and matches partial names/SIRET

