# API Contracts: Session Management & Calendar

**Date**: 2025-01-27  
**Feature**: 017-session-calendar  
**Base Path**: `/api/v1/sessions-pro` (public), `/api/v1/admin/sessions-pro` (admin)

## Overview

This document defines the API contracts for the session management and calendar feature. The API is split into public endpoints (for calendar viewing) and admin endpoints (for session management).

All endpoints follow RESTful conventions and use Zod validation for request/response schemas.

---

## Public Endpoints

### 1. GET /api/v1/sessions-pro

**Description**: List training sessions with filtering, sorting, and pagination (public access)

**Query Parameters**:
```typescript
{
  // Pagination
  page?: number;          // Default: 1, Min: 1
  limit?: number;         // Default: 20, Min: 1, Max: 100
  
  // Filters
  formation_id?: string;  // UUID of training program
  mode?: ("presentiel" | "distanciel" | "hybride")[];  // Delivery modes
  date_debut?: string;    // ISO date (YYYY-MM-DD), filter sessions starting from this date
  date_fin?: string;      // ISO date (YYYY-MM-DD), filter sessions ending before this date
  statut?: ("planifiee" | "ouverte" | "complete" | "en_cours" | "terminee")[];  // Status filters (excludes 'annulee')
  formateur_id?: string;  // UUID of trainer
  
  // Calendar-specific
  mois?: string;          // Format: YYYY-MM (e.g., "2024-11")
  annee?: number;         // Year (e.g., 2024)
  
  // Sorting
  sort?: "date_asc" | "date_desc" | "prix_asc" | "prix_desc";
}
```

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    sessions: SessionListItem[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
}
```

**SessionListItem**:
```typescript
{
  id: string;                    // UUID
  code_session: string;          // e.g., "DATA-2024-001"
  formation: {
    id: string;
    titre: string;
    slug: string;
  };
  date_debut: string;            // ISO date
  date_fin: string;              // ISO date
  horaires: string;              // e.g., "9h-17h"
  mode_formation: "presentiel" | "distanciel" | "hybride";
  lieu?: string;                 // If presentiel
  lien_visio?: string;           // If distanciel/hybride
  places_totales: number;
  places_reservees: number;
  places_disponibles: number;
  statut: "planifiee" | "ouverte" | "complete" | "en_cours" | "terminee";
  prix_ht?: number;
  prix_ttc?: number;
  formateurs: Array<{
    id: string;
    nom: string;
    prenom: string;
  }>;
}
```

---

### 2. GET /api/v1/sessions-pro/calendrier

**Description**: Get sessions formatted for calendar display (public access)

**Query Parameters**:
```typescript
{
  annee: number;                 // Required: Year (e.g., 2024)
  mois?: number;                 // Optional: Month (1-12)
  formations?: string[];          // Array of formation IDs (UUIDs)
  modes?: ("presentiel" | "distanciel" | "hybride")[];  // Delivery modes
}
```

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    events: CalendarEvent[];
  };
}
```

**CalendarEvent** (FullCalendar format):
```typescript
{
  id: string;                    // Session UUID
  title: string;                  // Formation title
  start: string;                  // ISO datetime (date_debut)
  end: string;                    // ISO datetime (date_fin + 1 day for all-day events)
  backgroundColor: string;        // Color based on mode_formation
  borderColor: string;            // Color based on statut
  extendedProps: {
    code_session: string;
    mode: "presentiel" | "distanciel" | "hybride";
    lieu?: string;
    formateurs: string;           // Comma-separated trainer names
    places_disponibles: number;
    statut: string;
  };
}
```

---

### 3. GET /api/v1/sessions-pro/:id

**Description**: Get detailed information about a specific session (public access)

**Path Parameters**:
- `id` (UUID) - Session ID

**Response** (200 OK):
```typescript
{
  success: true;
  data: SessionDetail;
}
```

**SessionDetail**:
```typescript
{
  id: string;
  code_session: string;
  formation: {
    id: string;
    titre: string;
    slug: string;
    description_courte?: string;
    description_complete?: string;
    objectifs?: string[];
    programme?: string;
  };
  date_debut: string;            // ISO date
  date_fin: string;              // ISO date
  horaires: string;
  mode_formation: "presentiel" | "distanciel" | "hybride";
  lieu?: string;
  lien_visio?: string;           // Only visible if user is enrolled (Phase 4)
  places_totales: number;
  places_reservees: number;
  places_disponibles: number;
  statut: string;
  prix_ht?: number;
  prix_ttc?: number;
  formateurs: Array<{
    id: string;
    nom: string;
    prenom: string;
    bio?: string;
    photo?: string;
    specialites?: string[];
  }>;
  inscriptions_count: number;    // Total enrollments (public count only)
}
```

**Response** (404 Not Found):
```typescript
{
  success: false;
  error: "SESSION_NOT_FOUND";
  message: "Session not found";
}
```

---

### 4. GET /api/v1/sessions-pro/:id/disponibilite

**Description**: Get real-time availability information for a session (public access)

**Path Parameters**:
- `id` (UUID) - Session ID

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    places_disponibles: number;
    places_reservees: number;
    places_totales: number;
    peut_inscrire: boolean;      // true if session is open and has available spots
    message?: string;             // Message if cannot enroll (e.g., "Session complète")
  };
}
```

---

## Admin Endpoints

All admin endpoints require authentication and admin role verification.

### 5. POST /api/v1/admin/sessions-pro

**Description**: Create a new training session

**Request Body**:
```typescript
{
  formation_id: string;          // UUID, required
  date_debut: string;            // ISO date (YYYY-MM-DD), required
  date_fin: string;              // ISO date (YYYY-MM-DD), required
  horaires: string;              // e.g., "9h-17h", required
  mode_formation: "presentiel" | "distanciel" | "hybride";  // required
  lieu?: string;                 // Required if mode_formation = 'presentiel'
  lien_visio?: string;           // Required if mode_formation = 'distanciel' or 'hybride'
  places_totales: number;        // Required, must be > 0
  prix_ht?: number;              // Optional, defaults to formation price
  prix_ttc?: number;             // Optional, defaults to prix_ht * 1.18
  formateur_ids: string[];       // Array of trainer UUIDs, required, min 1
  statut?: "planifiee" | "ouverte";  // Optional, defaults to 'planifiee'
  notes_internes?: string;       // Optional, admin-only notes
}
```

**Response** (201 Created):
```typescript
{
  success: true;
  data: SessionDetail;            // Full session details including generated code_session
}
```

**Response** (400 Bad Request):
```typescript
{
  success: false;
  error: "VALIDATION_ERROR" | "TRAINER_CONFLICT" | "INVALID_DATES";
  message: string;
  details?: {
    field: string;
    message: string;
  }[];
}
```

**Validation Rules**:
- `date_fin > date_debut`
- `date_debut >= today` (cannot create sessions in the past)
- `places_totales > 0`
- `formateur_ids.length >= 1`
- Trainer availability checked (no conflicts)
- If `mode_formation = 'presentiel'`: `lieu` required
- If `mode_formation = 'distanciel'` or `'hybride'`: `lien_visio` required
- `prix_ttc >= prix_ht` (if both provided)

---

### 6. PUT /api/v1/admin/sessions-pro/:id

**Description**: Update an existing session

**Path Parameters**:
- `id` (UUID) - Session ID

**Request Body**: Same as POST, all fields optional (only provided fields are updated)

**Response** (200 OK):
```typescript
{
  success: true;
  data: SessionDetail;
}
```

**Response** (400 Bad Request):
```typescript
{
  success: false;
  error: "VALIDATION_ERROR" | "TRAINER_CONFLICT" | "CAPACITY_CONFLICT" | "SESSION_LOCKED";
  message: string;
  details?: Array<{ field: string; message: string }>;
}
```

**Validation Rules**:
- Cannot reduce `places_totales` below current `places_reservees`
- Cannot modify sessions with status 'en_cours' or 'terminee' (except status change to 'annulee')
- If dates or trainers change: re-validate trainer availability
- If critical fields change (dates, location, video link): notify enrolled participants

---

### 7. PATCH /api/v1/admin/sessions-pro/:id/statut

**Description**: Update session status

**Path Parameters**:
- `id` (UUID) - Session ID

**Request Body**:
```typescript
{
  statut: "planifiee" | "ouverte" | "complete" | "en_cours" | "terminee" | "annulee";
}
```

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    id: string;
    statut: string;
    updated_at: string;
  };
}
```

**Status Transition Rules**:
- Valid transitions enforced by application logic
- If status changes to 'annulee': notify enrolled participants and initiate refunds if applicable

---

### 8. DELETE /api/v1/admin/sessions-pro/:id

**Description**: Delete a session (soft delete recommended)

**Path Parameters**:
- `id` (UUID) - Session ID

**Response** (200 OK):
```typescript
{
  success: true;
  message: "Session deleted successfully";
}
```

**Response** (400 Bad Request):
```typescript
{
  success: false;
  error: "SESSION_HAS_ENROLLMENTS";
  message: "Cannot delete session with existing enrollments";
}
```

**Validation Rules**:
- Cannot delete sessions with existing enrollments (inscriptions_professionnelles)
- Soft delete recommended (set status to 'annulee' instead of hard delete)

---

### 9. GET /api/v1/admin/sessions-pro

**Description**: List all sessions for admin management (with additional filters)

**Query Parameters**: Same as public GET /api/v1/sessions-pro, plus:
```typescript
{
  search?: string;               // Search by code_session or formation title
  // ... all public filters
}
```

**Response** (200 OK): Same format as public endpoint, but includes:
- `notes_internes` field in session data
- All statuses including 'annulee'

---

### 10. GET /api/v1/admin/sessions-pro/:id

**Description**: Get detailed session information for admin (includes enrollment data)

**Path Parameters**:
- `id` (UUID) - Session ID

**Response** (200 OK):
```typescript
{
  success: true;
  data: AdminSessionDetail;
}
```

**AdminSessionDetail** (extends SessionDetail):
```typescript
{
  // ... all SessionDetail fields
  notes_internes?: string;      // Admin-only notes
  inscriptions_count: number;    // Total enrollments
  // Enrollment details available via separate endpoint
}
```

---

### 11. GET /api/v1/admin/sessions-pro/:id/inscrits

**Description**: Get list of enrolled participants for a session (admin only)

**Path Parameters**:
- `id` (UUID) - Session ID

**Query Parameters**:
```typescript
{
  statut?: ("confirmee" | "en_attente" | "annulee")[];  // Filter by enrollment status
  paiement?: ("valide" | "en_attente" | "echec")[];     // Filter by payment status
  search?: string;              // Search by participant name or email
}
```

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    inscrits: EnrollmentDetail[];
    total: number;
  };
}
```

**EnrollmentDetail**:
```typescript
{
  id: string;                    // Enrollment ID
  apprenant: {
    id: string;
    nom: string;
    prenom: string;
    email: string;
    telephone?: string;
  };
  entreprise?: {
    id: string;
    nom: string;
  };
  type_inscription: "individuelle" | "entreprise";
  statut: "confirmee" | "en_attente" | "annulee";
  statut_paiement: "valide" | "en_attente" | "echec";
  date_inscription: string;      // ISO datetime
}
```

---

### 12. GET /api/v1/admin/formateurs/disponibilites

**Description**: Check trainer availability for given date range

**Query Parameters**:
```typescript
{
  date_debut: string;            // ISO date (YYYY-MM-DD), required
  date_fin: string;              // ISO date (YYYY-MM-DD), required
  formateur_ids?: string[];       // Optional: specific trainers to check
}
```

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    formateurs: Array<{
      id: string;
      nom: string;
      prenom: string;
      disponible: boolean;
      conflits?: Array<{
        session_id: string;
        code_session: string;
        formation: string;
        date_debut: string;
        date_fin: string;
      }>;
    }>;
  };
}
```

---

### 13. POST /api/v1/admin/sessions-pro/:id/dupliquer

**Description**: Duplicate an existing session with new dates

**Path Parameters**:
- `id` (UUID) - Source session ID

**Request Body**:
```typescript
{
  date_debut: string;            // ISO date (YYYY-MM-DD), required
  date_fin: string;              // ISO date (YYYY-MM-DD), required
}
```

**Response** (201 Created):
```typescript
{
  success: true;
  data: SessionDetail;          // New session with new code_session
}
```

**Behavior**:
- Copies all session data except dates and code_session
- Validates trainer availability for new dates
- Creates new session with status 'planifiee'

---

### 14. GET /api/v1/admin/sessions-pro/export

**Description**: Export sessions to Excel file

**Query Parameters**: Same filters as GET /api/v1/admin/sessions-pro, plus:
```typescript
{
  ids?: string[];                // Optional: specific session IDs to export
}
```

**Response** (200 OK):
- Content-Type: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- File download with Excel file containing session data

---

### 15. GET /api/v1/admin/sessions-pro/:id/inscrits/export

**Description**: Export enrollment list for a session to Excel

**Path Parameters**:
- `id` (UUID) - Session ID

**Response** (200 OK):
- Content-Type: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- File download with Excel file containing enrollment data

---

## Error Responses

All endpoints may return these error responses:

**400 Bad Request** (Validation Error):
```typescript
{
  success: false;
  error: "VALIDATION_ERROR";
  message: string;
  details?: Array<{
    field: string;
    message: string;
  }>;
}
```

**401 Unauthorized** (Authentication Required):
```typescript
{
  success: false;
  error: "UNAUTHORIZED";
  message: "Authentication required";
}
```

**403 Forbidden** (Admin Only):
```typescript
{
  success: false;
  error: "FORBIDDEN";
  message: "Admin access required";
}
```

**404 Not Found**:
```typescript
{
  success: false;
  error: "NOT_FOUND";
  message: string;
}
```

**500 Internal Server Error**:
```typescript
{
  success: false;
  error: "INTERNAL_ERROR";
  message: string;
}
```

---

## Authentication & Authorization

- **Public Endpoints**: No authentication required (GET /api/v1/sessions-pro/*)
- **Admin Endpoints**: Require:
  - Valid authentication token (JWT or session)
  - Admin role verification
  - Tenant context (from request header or subdomain)

---

## Rate Limiting

- Public endpoints: Standard rate limits (to be configured)
- Admin endpoints: Higher rate limits for authenticated admins
- Export endpoints: May have lower rate limits due to resource intensity

---

## Versioning

All endpoints use `/api/v1/` prefix. Future breaking changes will increment to `/api/v2/`.

