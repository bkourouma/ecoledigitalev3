# API Contracts: Professional Training Catalog

**Date**: 2025-11-14  
**Feature**: 016-catalogue-formations-pro  
**Base Path**: `/api/v1/formations-pro`

## Overview

This document defines the API contracts for the professional training catalog feature. All endpoints are read-only (GET requests) and follow RESTful conventions. The catalog is publicly accessible (no authentication required for browsing).

---

## Endpoints

### 1. GET /api/v1/formations-pro

**Description**: List professional training programs with search, filtering, sorting, and pagination

**Query Parameters**:
```typescript
{
  // Pagination
  page?: number;          // Default: 1, Min: 1
  limit?: number;         // Default: 20, Min: 1, Max: 100
  
  // Search
  search?: string;        // Full-text search on title and descriptions
  
  // Filters
  themes?: string[];      // Array of theme strings (e.g., ["data-science", "analytics"])
  duree_min?: number;     // Minimum duration in days
  duree_max?: number;     // Maximum duration in days
  prix_min?: number;      // Minimum price (FCFA)
  prix_max?: number;      // Maximum price (FCFA)
  niveau?: "Débutant" | "Intermédiaire" | "Avancé";
  mode?: ("presentiel" | "distanciel" | "hybride")[];  // Delivery modes
  certification?: boolean; // Has certification (true/false)
  
  // Sorting
  sort?: "pertinence" | "prix_asc" | "prix_desc" | "titre_asc" | "date_asc";
  // pertinence: Relevance (when search is active), otherwise by next session date
  // prix_asc/desc: Sort by price_ttc
  // titre_asc: Alphabetical by title
  // date_asc: By next available session date
}
```

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    formations: FormationListItem[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
}
```

**FormationListItem**:
```typescript
{
  id: string;                    // UUID
  titre: string;
  slug: string;
  description_courte: string | null;
  duree_jours: number | null;
  duree_heures: number | null;
  prix_ttc: number;
  niveau: "Débutant" | "Intermédiaire" | "Avancé" | null;
  type_certification: string | null;
  themes: string[];              // Array of theme strings
  prochaine_session: {
    date_debut: string;           // ISO date
    mode_formation: "presentiel" | "distanciel" | "hybride";
  } | null;
}
```

**Error Responses**:
- `400 Bad Request`: Invalid query parameters
- `500 Internal Server Error`: Server error

---

### 2. GET /api/v1/formations-pro/:slug

**Description**: Get detailed information about a specific training program

**Path Parameters**:
- `slug` (string): URL-friendly identifier of the training

**Response** (200 OK):
```typescript
{
  success: true;
  data: FormationDetail;
}
```

**FormationDetail**:
```typescript
{
  id: string;                    // UUID
  titre: string;
  slug: string;
  description_courte: string | null;
  description_complete: string | null;
  objectifs: string[];           // Array of learning objectives
  programme_detaille: {
    modules: Array<{
      titre: string;
      duree?: string;
      contenu: string[];
    }>;
  } | null;
  prerequis: string | null;
  public_cible: string | null;
  duree_jours: number | null;
  duree_heures: number | null;
  prix_ht: number | null;
  prix_ttc: number;
  type_certification: string | null;
  nom_certification: string | null;
  themes: string[];
  niveau: "Débutant" | "Intermédiaire" | "Avancé" | null;
  sessions: SessionListItem[];   // Upcoming sessions only
}
```

**SessionListItem**:
```typescript
{
  id: string;                    // UUID
  code_session: string;
  date_debut: string;             // ISO date
  date_fin: string;               // ISO date
  horaires: string | null;
  mode_formation: "presentiel" | "distanciel" | "hybride";
  lieu: string | null;
  places_disponibles: number;
  prix_ttc: number;              // Session-specific price (may differ from base)
}
```

**Error Responses**:
- `404 Not Found`: Training not found or inactive
- `500 Internal Server Error`: Server error

---

### 3. GET /api/v1/formations-pro/:id/sessions

**Description**: Get all upcoming sessions for a specific training program

**Path Parameters**:
- `id` (string, UUID): Training program ID

**Query Parameters**:
```typescript
{
  limit?: number;                // Default: 50, Max: 100
}
```

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    sessions: SessionListItem[];
    total: number;
  };
}
```

**Error Responses**:
- `404 Not Found`: Training not found
- `500 Internal Server Error`: Server error

---

### 4. GET /api/v1/formations-pro/:id/similaires

**Description**: Get similar training recommendations for a specific training program

**Path Parameters**:
- `id` (string, UUID): Training program ID

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    formations: FormationListItem[];  // Up to 4 recommendations
  };
}
```

**Error Responses**:
- `404 Not Found`: Training not found
- `500 Internal Server Error`: Server error

---

### 5. GET /api/v1/formations-pro/:id/programme-pdf

**Description**: Generate and download PDF document for a training program

**Path Parameters**:
- `id` (string, UUID): Training program ID

**Response** (200 OK):
- Content-Type: `application/pdf`
- Content-Disposition: `attachment; filename="programme-{slug}.pdf"`
- Body: PDF file binary data

**Error Responses**:
- `404 Not Found`: Training not found
- `500 Internal Server Error`: PDF generation failed
- `503 Service Unavailable`: PDF generation timeout

**Notes**:
- PDF generation may take up to 5 seconds
- PDFs are generated on-demand (not pre-generated)
- Consider implementing caching for frequently accessed trainings

---

### 6. GET /api/v1/formations-pro/themes

**Description**: Get list of all available themes for filtering

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    themes: Array<{
      value: string;             // Theme identifier
      label: string;             // Display name
      count: number;              // Number of active trainings with this theme
    }>;
  };
}
```

**Error Responses**:
- `500 Internal Server Error`: Server error

---

### 7. GET /api/v1/formations-pro/stats

**Description**: Get statistics for filter options (price ranges, duration ranges, etc.)

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    prix: {
      min: number;               // Minimum price_ttc
      max: number;               // Maximum price_ttc
    };
    duree: {
      min: number;                // Minimum duree_jours
      max: number;                // Maximum duree_jours
    };
    total_formations: number;     // Total active trainings
    total_sessions: number;       // Total upcoming sessions
  };
}
```

**Error Responses**:
- `500 Internal Server Error`: Server error

---

## Zod Schema Definitions

See `packages/contracts/src/formations-pro.ts` for complete Zod schema definitions matching these contracts.

---

## Authentication

**Status**: Public endpoints (no authentication required)

**Rationale**: Training catalog information is non-sensitive and should be publicly accessible for discovery. Enrollment functionality (future) will require authentication.

**Rate Limiting**: Consider applying rate limits to PDF generation endpoint to prevent abuse.

---

## Tenant Isolation

All endpoints automatically filter by tenant using:
- `X-Tenant` header (if provided)
- Subdomain-based tenant resolution (existing infrastructure)
- Row Level Security (RLS) policies in database

No tenant parameter required in requests - handled automatically by existing middleware.

---

## Error Response Format

All error responses follow this format:
```typescript
{
  success: false;
  error: string;                 // Error code (e.g., "NOT_FOUND", "VALIDATION_ERROR")
  message: string;                // Human-readable error message
  details?: unknown;              // Additional error details (optional)
}
```

---

## Notes

- All date fields use ISO 8601 format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ)
- All monetary values are in FCFA (West African CFA franc)
- Duration can be specified in days or hours (both fields may be present)
- Themes are stored as JSONB array in database, returned as string array in API
- Only active trainings (`actif = true`) are returned
- Only upcoming sessions (`date_debut >= CURRENT_DATE`) with status 'planifiee' or 'ouverte' are returned

