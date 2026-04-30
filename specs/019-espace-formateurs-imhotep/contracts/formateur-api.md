# API Contracts: Trainer Space (Espace Formateurs)

**Date**: 2025-11-20  
**Feature**: 019-espace-formateurs-imhotep  
**Base Path**: `/api/v1/formateur`

## Overview

This document defines the API contracts for the trainer space feature. All endpoints require trainer authentication and are scoped to the authenticated trainer's assigned sessions and resources.

All endpoints follow RESTful conventions and use Zod validation for request/response schemas.

**Authentication**: All endpoints require authentication with trainer role verification via `formateurAuthMiddleware`.

---

## Dashboard Endpoints

### 1. GET /api/v1/formateur/dashboard

**Description**: Get trainer dashboard overview with statistics and recent activity

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    stats: {
      sessions_a_venir: number;        // Count of upcoming sessions
      sessions_en_cours: number;      // Count of in-progress sessions
      sessions_terminees_mois: number; // Count of completed sessions this month
      total_apprenants: number;        // Total learners trained across all sessions
      heures_formation_mois: number;   // Training hours this month
    };
    prochaines_sessions: SessionListItem[];  // Next 5 upcoming sessions
    sessions_recentes: SessionListItem[];    // Last 5 completed sessions
    supports_recents: SupportListItem[];      // Last 5 uploaded materials
    notifications: {
      nb_non_lues: number;            // Count of unread notifications
      recentes: NotificationItem[];    // Recent notifications (last 5)
    };
  };
}
```

---

## Schedule Endpoints

### 2. GET /api/v1/formateur/planning

**Description**: Get trainer schedule with sessions and unavailability periods

**Query Parameters**:
```typescript
{
  annee: number;        // Required: Year (e.g., 2024)
  mois?: number;        // Optional: Month (1-12), if not provided returns full year
  vue?: "mois" | "semaine" | "liste";  // View type, default: "mois"
}
```

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    sessions: CalendarSessionEvent[];
    indisponibilites: IndisponibiliteItem[];
  };
}
```

**CalendarSessionEvent** (FullCalendar format):
```typescript
{
  id: string;                    // Session UUID
  title: string;                 // Formation title
  start: string;                  // ISO date (date_debut)
  end: string;                    // ISO date (date_fin + 1 day)
  backgroundColor: string;        // Blue for sessions
  extendedProps: {
    type: "session";
    code_session: string;
    formation_titre: string;
    mode_formation: string;
    nb_inscrits: number;
    statut: string;
  };
}
```

**IndisponibiliteItem**:
```typescript
{
  id: string;
  date_debut: string;            // ISO date
  date_fin: string;              // ISO date
  raison: string;
  created_at: string;           // ISO timestamp
}
```

### 3. GET /api/v1/formateur/disponibilites

**Description**: Get all unavailability periods for the trainer

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    indisponibilites: IndisponibiliteItem[];
  };
}
```

### 4. POST /api/v1/formateur/disponibilites

**Description**: Create a new unavailability period

**Request Body**:
```typescript
{
  date_debut: string;            // ISO date (YYYY-MM-DD), required
  date_fin: string;              // ISO date (YYYY-MM-DD), required
  raison: string;                 // Reason, required, max 500 chars
}
```

**Response** (201 Created):
```typescript
{
  success: true;
  data: IndisponibiliteItem;
}
```

### 5. DELETE /api/v1/formateur/disponibilites/:id

**Description**: Delete an unavailability period

**Path Parameters**:
- `id` (UUID) - Unavailability period ID

**Response** (200 OK):
```typescript
{
  success: true;
  message: "Indisponibilité supprimée";
}
```

---

## Session Endpoints

### 6. GET /api/v1/formateur/sessions

**Description**: Get list of trainer's assigned sessions with filtering

**Query Parameters**:
```typescript
{
  page?: number;                  // Default: 1
  limit?: number;                 // Default: 10, Max: 50
  statuts?: string[];             // Array of statuses: "planifiee", "ouverte", "en_cours", "terminee"
  date_debut?: string;            // ISO date (YYYY-MM-DD)
  date_fin?: string;              // ISO date (YYYY-MM-DD)
  formation_id?: string;          // UUID of training program
  search?: string;                 // Search by session code or formation title
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

### 7. GET /api/v1/formateur/sessions/:id

**Description**: Get detailed information about a specific session (trainer must be assigned)

**Path Parameters**:
- `id` (UUID) - Session ID

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    session: SessionDetail;
    formation: FormationInfo;
    inscrits: InscritItem[];      // Enrolled learners
    supports: SupportListItem[];   // Associated course materials
    notes_formateur?: string;     // Trainer's private notes
  };
}
```

**SessionDetail**:
```typescript
{
  id: string;
  code_session: string;
  date_debut: string;
  date_fin: string;
  horaires: string;
  mode_formation: string;
  lieu?: string;
  lien_visio?: string;
  statut: string;
  places_totales: number;
  places_reservees: number;
  places_disponibles: number;
  notes_formateur?: string;
  notes_updated_at?: string;
}
```

### 8. GET /api/v1/formateur/sessions/:id/inscrits

**Description**: Get detailed list of enrolled learners for a session

**Path Parameters**:
- `id` (UUID) - Session ID

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    inscrits: InscritDetail[];
    stats: {
      total_inscrits: number;
      confirmees: number;
      presents?: number;           // If session is in progress or completed
      absents?: number;            // If session is in progress or completed
    };
  };
}
```

**InscritDetail**:
```typescript
{
  id: string;                     // Enrollment ID
  inscription_id: string;         // Enrollment ID (same as id)
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
  statut_inscription: string;
  presence?: boolean;              // Present/absent (if attendance marked)
  presence_marked_at?: string;     // When attendance was marked
}
```

---

## Attendance Endpoints

### 9. PATCH /api/v1/formateur/sessions/:id/inscrits/:inscritId/presence

**Description**: Mark attendance for a learner (session must be in progress or completed)

**Path Parameters**:
- `id` (UUID) - Session ID
- `inscritId` (UUID) - Enrollment ID

**Request Body**:
```typescript
{
  present: boolean;               // true = present, false = absent
}
```

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    inscription_id: string;
    present: boolean;
    marked_at: string;            // ISO timestamp
  };
}
```

### 10. GET /api/v1/formateur/sessions/:id/attendance/export

**Description**: Export attendance list as CSV/PDF (session must be completed)

**Path Parameters**:
- `id` (UUID) - Session ID

**Query Parameters**:
```typescript
{
  format?: "csv" | "pdf";         // Default: "csv"
}
```

**Response** (200 OK):
- CSV: `Content-Type: text/csv`
- PDF: `Content-Type: application/pdf`
- File download with filename: `emargement-{code_session}.{csv|pdf}`

---

## Course Materials Endpoints

### 11. GET /api/v1/formateur/supports

**Description**: Get list of trainer's course materials

**Query Parameters**:
```typescript
{
  page?: number;                  // Default: 1
  limit?: number;                 // Default: 10, Max: 50
  formation_id?: string;          // Filter by training program
  session_id?: string;             // Filter by session
  type_fichier?: string;           // Filter by file type: "PDF", "PPT", "DOC", "ZIP", "Video"
  search?: string;                 // Search by title
}
```

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    supports: SupportListItem[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
}
```

**SupportListItem**:
```typescript
{
  id: string;
  titre: string;
  description?: string;
  type_fichier: string;
  taille_fichier: number;         // Bytes
  fichier_url: string;
  formation?: {
    id: string;
    titre: string;
  };
  sessions: Array<{               // Associated sessions
    id: string;
    code_session: string;
  }>;
  visible_apprenants: boolean;
  nb_telechargements: number;      // Total download count
  created_at: string;              // ISO timestamp
}
```

### 12. POST /api/v1/formateur/supports/upload

**Description**: Upload a new course material

**Request** (multipart/form-data):
```typescript
{
  file: File;                     // Required, max 100MB
  titre: string;                   // Required, max 255 chars
  description?: string;             // Optional, max 2000 chars
  formation_id?: string;            // Optional UUID
  session_ids?: string[];           // Optional array of session UUIDs
  visible_apprenants?: boolean;     // Default: true
}
```

**Response** (201 Created):
```typescript
{
  success: true;
  data: SupportDetail;
}
```

**SupportDetail**:
```typescript
{
  id: string;
  titre: string;
  description?: string;
  type_fichier: string;
  taille_fichier: number;
  fichier_url: string;
  visible_apprenants: boolean;
  created_at: string;
}
```

### 13. GET /api/v1/formateur/supports/:id

**Description**: Get detailed information about a course material

**Path Parameters**:
- `id` (UUID) - Support ID

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    support: SupportDetail;
    sessions_associees: Array<{
      id: string;
      code_session: string;
      formation_titre: string;
    }>;
    statistiques: {
      nb_telechargements: number;
      dernier_telechargement?: string;  // ISO timestamp
      telechargements_par_session: Array<{
        session_code: string;
        nb_telechargements: number;
      }>;
    };
  };
}
```

### 14. PUT /api/v1/formateur/supports/:id

**Description**: Update course material metadata (file cannot be changed)

**Path Parameters**:
- `id` (UUID) - Support ID

**Request Body**:
```typescript
{
  titre?: string;                 // Max 255 chars
  description?: string;           // Max 2000 chars
  visible_apprenants?: boolean;
  session_ids?: string[];         // Update session associations
}
```

**Response** (200 OK):
```typescript
{
  success: true;
  data: SupportDetail;
}
```

### 15. DELETE /api/v1/formateur/supports/:id

**Description**: Delete a course material (removes file and record)

**Path Parameters**:
- `id` (UUID) - Support ID

**Response** (200 OK):
```typescript
{
  success: true;
  message: "Support supprimé";
}
```

### 16. GET /api/v1/formateur/supports/:id/statistiques

**Description**: Get download statistics for a course material

**Path Parameters**:
- `id` (UUID) - Support ID

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    nb_telechargements: number;
    dernier_telechargement?: string;
    telechargements_par_session: Array<{
      session_code: string;
      nb_telechargements: number;
    }>;
  };
}
```

---

## Session Notes Endpoints

### 17. POST /api/v1/formateur/sessions/:id/notes

**Description**: Add or update session notes

**Path Parameters**:
- `id` (UUID) - Session ID

**Request Body**:
```typescript
{
  notes: string;                  // Notes content, max 10000 chars
}
```

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    session_id: string;
    notes: string;
    updated_at: string;           // ISO timestamp
  };
}
```

---

## Messaging Endpoints

### 18. POST /api/v1/formateur/sessions/:id/message-groupe

**Description**: Send group message to enrolled learners

**Path Parameters**:
- `id` (UUID) - Session ID

**Request Body**:
```typescript
{
  sujet: string;                  // Required, max 200 chars
  message: string;                // Required, max 2000 chars
  type: "email" | "sms" | "both"; // Required
  destinataires?: "tous" | "presents" | "absents";  // Default: "tous"
}
```

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    nb_destinataires: number;     // Number of messages sent
    email_envoyes?: number;        // If type includes email
    sms_envoyes?: number;          // If type includes SMS
  };
}
```

---

## Profile Endpoints

### 19. GET /api/v1/formateur/profil

**Description**: Get trainer profile information

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    formateur: {
      id: string;
      nom: string;
      prenom: string;
      email: string;
      telephone?: string;
      bio?: string;
      specialites?: string[];      // Array of expertise areas
      linkedin_url?: string;
      photo_url?: string;
      cv_url?: string;
    };
    formations_assignees: Array<{
      id: string;
      titre: string;
    }>;
    statistiques: {
      nb_sessions_total: number;
      nb_apprenants_formes: number;
      heures_formation_total: number;
      nb_supports_crees: number;
    };
  };
}
```

### 20. PUT /api/v1/formateur/profil

**Description**: Update trainer profile information

**Request Body**:
```typescript
{
  bio?: string;                   // Max 2000 chars
  specialites?: string[];         // Array of expertise areas
  linkedin_url?: string;          // URL format
  photo?: string;                  // Base64 encoded image (JPG/PNG, max 5MB)
}
```

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    formateur: {
      id: string;
      bio?: string;
      specialites?: string[];
      linkedin_url?: string;
      photo_url?: string;
      updated_at: string;
    };
  };
}
```

### 21. POST /api/v1/formateur/profil/cv

**Description**: Upload or replace trainer CV

**Request** (multipart/form-data):
```typescript
{
  file: File;                     // Required, PDF only, max 10MB
}
```

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    cv_url: string;
    updated_at: string;
  };
}
```

---

## Notification Endpoints

### 22. GET /api/v1/formateur/notifications

**Description**: Get trainer notifications

**Query Parameters**:
```typescript
{
  page?: number;                  // Default: 1
  limit?: number;                 // Default: 20, Max: 50
  non_lues?: boolean;             // Filter unread only, default: false
}
```

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    notifications: NotificationItem[];
    nb_non_lues: number;
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
}
```

**NotificationItem**:
```typescript
{
  id: string;
  type: string;                   // "nouvelle_inscription", "session_modifiee", etc.
  titre: string;
  message: string;
  metadata?: Record<string, any>;  // Additional data
  lue: boolean;
  lue_at?: string;                // ISO timestamp
  created_at: string;             // ISO timestamp
}
```

### 23. PATCH /api/v1/formateur/notifications/:id/lire

**Description**: Mark notification as read

**Path Parameters**:
- `id` (UUID) - Notification ID

**Response** (200 OK):
```typescript
{
  success: true;
  data: {
    id: string;
    lue: true;
    lue_at: string;               // ISO timestamp
  };
}
```

---

## Error Responses

All endpoints may return the following error responses:

**400 Bad Request**:
```typescript
{
  success: false;
  error: "Validation error";
  details?: string[];             // Array of validation errors
}
```

**401 Unauthorized**:
```typescript
{
  success: false;
  error: "Non authentifié";
}
```

**403 Forbidden**:
```typescript
{
  success: false;
  error: "Accès non autorisé à cette session";
}
```

**404 Not Found**:
```typescript
{
  success: false;
  error: "Ressource non trouvée";
}
```

**500 Internal Server Error**:
```typescript
{
  success: false;
  error: "Erreur serveur";
}
```

