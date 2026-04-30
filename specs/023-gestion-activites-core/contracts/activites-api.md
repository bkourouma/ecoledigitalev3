# Activités API Contract

**Feature**: Phase 3 - Gestion des Activités (CORE)  
**Date**: 2025-11-30  
**Status**: Draft

## Base URL

All endpoints are prefixed with `/api/v1/rso/`

## Authentication

All endpoints require RSO authentication token (JWT) in Authorization header:
```
Authorization: Bearer <token>
```

All endpoints require tenant header:
```
X-Tenant: aspci
```

---

## Activity Management Endpoints (Formateur RSO)

### POST /api/v1/rso/formateur/activites

Create a new activity.

**Request Body**:
```json
{
  "installationId": 1,
  "typeActivite": "ENTRAINEMENT",
  "sousType": "T1",
  "titre": "Entraînement évacuation d'urgence - T1 2024",
  "dateActivite": "2024-03-15",
  "dureeMinutes": 120,
  "lieu": "Salle de formation, Port de commerce",
  "nombreParticipants": 25,
  "plateformeVisio": "zoom",
  "lienVisio": "https://zoom.us/j/123456789",
  "visibleTousPfso": true,
  "pfsoAgentsIds": []
}
```

**Response**: `201 Created`
```json
{
  "id": 1,
  "codeActivite": "ACT-2024-PAD_COM-ENT-T1-001",
  "titre": "Entraînement évacuation d'urgence - T1 2024",
  "installationId": 1,
  "installation": {
    "id": 1,
    "nomPort": "Port de commerce",
    "codeInstallation": "PAD_COM"
  },
  "typeActivite": "ENTRAINEMENT",
  "sousType": "T1",
  "dateActivite": "2024-03-15",
  "dureeMinutes": 120,
  "lieu": "Salle de formation, Port de commerce",
  "nombreParticipants": 25,
  "plateformeVisio": "zoom",
  "lienVisio": "https://zoom.us/j/123456789",
  "statut": "brouillon",
  "visibleTousPfso": true,
  "createdBy": {
    "id": 2,
    "nom": "DIALLO",
    "prenoms": "Aminata"
  },
  "createdAt": "2024-03-15T14:30:00Z"
}
```

**Permissions**: Formateur RSO, Admin

---

### GET /api/v1/rso/formateur/activites

List activities created by the current user (or all if admin).

**Query Parameters**:
- `page` (number, optional): Page number (default: 1)
- `limit` (number, optional): Items per page (default: 20, max: 100)
- `installationId` (number, optional): Filter by installation
- `typeActivite` (string, optional): Filter by activity type
- `statut` (string, optional): Filter by status ('brouillon', 'en_cours', 'termine', 'valide', 'archive')
- `anneeId` (number, optional): Filter by year (default: selected year from session)
- `search` (string, optional): Search in title and content

**Response**: `200 OK`
```json
{
  "activites": [
    {
      "id": 1,
      "codeActivite": "ACT-2024-PAD_COM-ENT-T1-001",
      "titre": "Entraînement évacuation d'urgence - T1 2024",
      "installation": {
        "id": 1,
        "nomPort": "Port de commerce"
      },
      "typeActivite": "ENTRAINEMENT",
      "sousType": "T1",
      "dateActivite": "2024-03-15",
      "dureeMinutes": 120,
      "nombreParticipants": 25,
      "statut": "termine",
      "createdAt": "2024-03-15T14:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3
  }
}
```

**Permissions**: Formateur RSO (own activities), Admin (all activities)

---

### GET /api/v1/rso/formateur/activites/:id

Get activity details by ID.

**Response**: `200 OK`
```json
{
  "id": 1,
  "codeActivite": "ACT-2024-PAD_COM-ENT-T1-001",
  "titre": "Entraînement évacuation d'urgence - T1 2024",
  "annee": {
    "id": 1,
    "annee": 2024
  },
  "installation": {
    "id": 1,
    "nomPort": "Port de commerce",
    "codeInstallation": "PAD_COM"
  },
  "typeActivite": "ENTRAINEMENT",
  "sousType": "T1",
  "contenuHtml": "<h1>Objectifs</h1><p>...</p>",
  "dateActivite": "2024-03-15",
  "dureeMinutes": 120,
  "lieu": "Salle de formation, Port de commerce",
  "nombreParticipants": 25,
  "plateformeVisio": "zoom",
  "lienVisio": "https://zoom.us/j/123456789",
  "statut": "termine",
  "dateValidation": null,
  "validePar": null,
  "visibleTousPfso": true,
  "pfsoAgents": [],
  "recommandations": [
    {
      "id": 1,
      "titre": "Améliorer la signalétique d'évacuation",
      "priorite": "haute",
      "statut": "en_cours",
      "dateEcheance": "2024-04-30"
    }
  ],
  "createdBy": {
    "id": 2,
    "nom": "DIALLO",
    "prenoms": "Aminata"
  },
  "createdAt": "2024-03-15T14:30:00Z",
  "updatedAt": "2024-03-16T10:15:00Z",
  "updatedBy": {
    "id": 2,
    "nom": "DIALLO",
    "prenoms": "Aminata"
  }
}
```

**Permissions**: Formateur RSO (own activities), Admin (all activities)

---

### PUT /api/v1/rso/formateur/activites/:id

Update an activity.

**Request Body**:
```json
{
  "titre": "Entraînement évacuation d'urgence - T1 2024 (mise à jour)",
  "dateActivite": "2024-03-15",
  "dureeMinutes": 120,
  "lieu": "Salle de formation, Port de commerce",
  "nombreParticipants": 25,
  "plateformeVisio": "zoom",
  "lienVisio": "https://zoom.us/j/123456789",
  "statut": "en_cours"
}
```

**Response**: `200 OK` (same structure as GET)

**Permissions**: Formateur RSO (own activities), Admin (all activities)

---

### PATCH /api/v1/rso/formateur/activites/:id/draft

Auto-save activity content (draft).

**Request Body**:
```json
{
  "contenuHtml": "<h1>Objectifs</h1><p>Contenu en cours de rédaction...</p>"
}
```

**Response**: `200 OK`
```json
{
  "id": 1,
  "contenuHtml": "<h1>Objectifs</h1><p>Contenu en cours de rédaction...</p>",
  "updatedAt": "2024-03-15T14:35:00Z"
}
```

**Permissions**: Formateur RSO (own activities), Admin (all activities)

---

### PATCH /api/v1/rso/formateur/activites/:id/contenu

Update activity content (final save).

**Request Body**:
```json
{
  "contenuHtml": "<h1>Objectifs</h1><p>Contenu final...</p>"
}
```

**Response**: `200 OK` (same structure as GET)

**Permissions**: Formateur RSO (own activities), Admin (all activities)

---

### PATCH /api/v1/rso/formateur/activites/:id/statut

Change activity status.

**Request Body**:
```json
{
  "statut": "termine"
}
```

**Response**: `200 OK`
```json
{
  "id": 1,
  "statut": "termine",
  "updatedAt": "2024-03-16T10:15:00Z"
}
```

**Permissions**: 
- Formateur RSO: Can change to 'en_cours', 'termine'
- Admin: Can change to any status including 'valide', 'archive'

---

### DELETE /api/v1/rso/formateur/activites/:id

Soft delete an activity.

**Response**: `204 No Content`

**Permissions**: Formateur RSO (own activities), Admin (all activities)

---

### POST /api/v1/rso/formateur/activites/:id/permissions

Update activity permissions.

**Request Body**:
```json
{
  "visibleTousPfso": false,
  "pfsoAgentsIds": [5, 7]
}
```

**Response**: `200 OK`
```json
{
  "id": 1,
  "visibleTousPfso": false,
  "pfsoAgents": [
    {
      "id": 5,
      "nom": "TOURE",
      "prenoms": "Mamadou",
      "grantedAt": "2024-03-15T14:30:00Z"
    },
    {
      "id": 7,
      "nom": "DIALLO",
      "prenoms": "Fatou",
      "grantedAt": "2024-03-15T14:30:00Z"
    }
  ]
}
```

**Permissions**: Formateur RSO (own activities), Admin (all activities)

---

### POST /api/v1/rso/formateur/activites/upload-image

Upload image for rich text editor.

**Request**: `multipart/form-data`
- `file`: Image file (max 5MB, types: jpg, jpeg, png, gif, webp)
- `activiteId` (optional): Activity ID if uploading for existing activity

**Response**: `200 OK`
```json
{
  "url": "https://example.com/uploads/aspci/activites/2024/1/image-123456.jpg",
  "filename": "image-123456.jpg",
  "size": 245678,
  "mimeType": "image/jpeg"
}
```

**Permissions**: Formateur RSO, Admin

---

## Activity Consultation Endpoints (PFSO Agent)

### GET /api/v1/rso/pfso/activites

List activities visible to the current PFSO agent.

**Query Parameters**:
- `page` (number, optional): Page number (default: 1)
- `limit` (number, optional): Items per page (default: 20, max: 100)
- `anneeId` (number, optional): Filter by year (default: selected year from session)
- `typeActivite` (string, optional): Filter by activity type
- `search` (string, optional): Search in title and content

**Response**: `200 OK` (same structure as formateur list, but read-only)

**Permissions**: PFSO Agent (only activities with permission)

---

### GET /api/v1/rso/pfso/activites/:id

Get activity details (read-only).

**Response**: `200 OK` (same structure as formateur GET, but read-only)

**Permissions**: PFSO Agent (only if has permission)

**Error**: `403 Forbidden` if no permission
```json
{
  "error": "Forbidden",
  "message": "Vous n'avez pas l'autorisation de consulter cette activité",
  "code": "PERMISSION_DENIED"
}
```

---

## Activity Types Endpoints

### GET /api/v1/rso/types-activites

Get hierarchical list of activity types.

**Response**: `200 OK`
```json
{
  "types": [
    {
      "id": 1,
      "code": "ENTRAINEMENT",
      "libelle": "Entraînements",
      "description": "Entraînements trimestriels du personnel",
      "parentId": null,
      "ordre": 2,
      "icone": "🏃",
      "couleur": "#2ecc71",
      "actif": true,
      "sousTypes": [
        {
          "id": 2,
          "code": "ENTRAINEMENT_T1",
          "libelle": "Trimestre 1",
          "description": "Entraînement du 1er trimestre (Jan-Mar)",
          "parentId": 1,
          "ordre": 1,
          "icone": "1️⃣",
          "couleur": "#27ae60",
          "actif": true
        }
      ]
    }
  ]
}
```

**Permissions**: All authenticated users

---

## Recommendation Endpoints

### GET /api/v1/rso/formateur/activites/:activiteId/recommandations

List recommendations for an activity.

**Response**: `200 OK`
```json
{
  "recommandations": [
    {
      "id": 1,
      "activiteId": 1,
      "titre": "Améliorer la signalétique d'évacuation",
      "description": "Les panneaux d'évacuation sont peu visibles...",
      "priorite": "haute",
      "statut": "en_cours",
      "dateEcheance": "2024-04-30",
      "responsable": {
        "id": 5,
        "nom": "TOURE",
        "prenoms": "Mamadou"
      },
      "dateResolution": null,
      "actionsPrises": null,
      "resoluPar": null,
      "createdBy": {
        "id": 2,
        "nom": "DIALLO",
        "prenoms": "Aminata"
      },
      "createdAt": "2024-03-15T15:00:00Z",
      "updatedAt": "2024-03-20T10:00:00Z"
    }
  ]
}
```

**Permissions**: Formateur RSO, Admin, PFSO Agent (for activities with permission)

---

### POST /api/v1/rso/formateur/activites/:activiteId/recommandations

Create a recommendation.

**Request Body**:
```json
{
  "titre": "Améliorer la signalétique d'évacuation",
  "description": "Les panneaux d'évacuation sont peu visibles dans certaines zones du port. Il est recommandé d'installer des panneaux plus grands et mieux éclairés.",
  "priorite": "haute",
  "responsableId": 5,
  "dateEcheance": "2024-04-30"
}
```

**Response**: `201 Created` (same structure as GET item)

**Permissions**: Formateur RSO, Admin

---

### PUT /api/v1/rso/formateur/recommandations/:id

Update a recommendation.

**Request Body**:
```json
{
  "titre": "Améliorer la signalétique d'évacuation (mise à jour)",
  "description": "Description mise à jour...",
  "priorite": "critique",
  "dateEcheance": "2024-04-15"
}
```

**Response**: `200 OK` (same structure as GET item)

**Permissions**: Formateur RSO (own recommendations), Admin (all)

---

### PATCH /api/v1/rso/formateur/recommandations/:id/statut

Update recommendation status.

**Request Body**:
```json
{
  "statut": "terminee",
  "actionsPrises": "Panneaux installés dans les zones identifiées",
  "dateResolution": "2024-04-25"
}
```

**Response**: `200 OK` (same structure as GET item)

**Permissions**: 
- Responsible person: Can change to 'en_cours', 'terminee'
- Formateur RSO/Admin: Can change to any status including 'validee', 'annulee'

---

### DELETE /api/v1/rso/formateur/recommandations/:id

Delete a recommendation.

**Response**: `204 No Content`

**Permissions**: Formateur RSO (own recommendations), Admin (all)

---

### GET /api/v1/rso/formateur/recommandations

List all recommendations with filters.

**Query Parameters**:
- `page` (number, optional): Page number (default: 1)
- `limit` (number, optional): Items per page (default: 20, max: 100)
- `statut` (string, optional): Filter by status
- `priorite` (string, optional): Filter by priority
- `installationId` (number, optional): Filter by installation
- `responsableId` (number, optional): Filter by responsible person
- `enRetard` (boolean, optional): Filter overdue recommendations

**Response**: `200 OK` (same structure as activity list with recommendations array)

**Permissions**: Formateur RSO, Admin

---

### GET /api/v1/rso/formateur/recommandations/stats

Get recommendation statistics.

**Response**: `200 OK`
```json
{
  "total": 45,
  "enAttente": 12,
  "enCours": 18,
  "terminees": 10,
  "validees": 5,
  "enRetard": 3
}
```

**Permissions**: Formateur RSO, Admin

---

## Search Endpoints

### GET /api/v1/rso/recherche/activites

Advanced search for activities.

**Query Parameters**:
- `q` (string, required): Search query (full-text)
- `anneeId` (number, optional): Filter by year
- `installationId` (number, optional): Filter by installation
- `typeActivite` (string, optional): Filter by activity type
- `statut` (string, optional): Filter by status
- `dateDebut` (date, optional): Start date filter
- `dateFin` (date, optional): End date filter
- `tri` (string, optional): Sort by ('pertinence', 'date_desc', 'date_asc', 'titre_asc') (default: 'pertinence')
- `page` (number, optional): Page number (default: 1)
- `limit` (number, optional): Items per page (default: 20, max: 100)

**Response**: `200 OK`
```json
{
  "resultats": [
    {
      "id": 1,
      "codeActivite": "ACT-2024-PAD_COM-ENT-T1-001",
      "titre": "Entraînement évacuation d'urgence - T1 2024",
      "extrait": "...procédures d'<mark>évacuation</mark> en cas d'urgence...",
      "installation": {
        "id": 1,
        "nomPort": "Port de commerce"
      },
      "typeActivite": "ENTRAINEMENT",
      "dateActivite": "2024-03-15",
      "pertinence": 0.95
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 8,
    "totalPages": 1
  }
}
```

**Permissions**: 
- Formateur RSO: All activities they created
- Admin: All activities
- PFSO Agent: Only activities with permission

---

## Export Endpoints

### GET /api/v1/rso/formateur/activites/:id/export/pdf

Export activity to PDF.

**Response**: `200 OK` (PDF file)
- Content-Type: `application/pdf`
- Content-Disposition: `attachment; filename="ACT-2024-PAD_COM-ENT-T1-001.pdf"`

**Permissions**: Formateur RSO (own activities), Admin (all activities), PFSO Agent (activities with permission)

---

## Error Responses

### 400 Bad Request
```json
{
  "error": "Bad Request",
  "message": "Validation error",
  "code": "VALIDATION_ERROR",
  "details": [
    {
      "field": "titre",
      "message": "Le titre doit contenir au moins 10 caractères"
    }
  ]
}
```

### 401 Unauthorized
```json
{
  "error": "Unauthorized",
  "message": "Authentication required",
  "code": "TOKEN_MISSING"
}
```

### 403 Forbidden
```json
{
  "error": "Forbidden",
  "message": "Vous n'avez pas l'autorisation d'accéder à cette ressource",
  "code": "PERMISSION_DENIED"
}
```

### 404 Not Found
```json
{
  "error": "Not Found",
  "message": "Activité non trouvée",
  "code": "ACTIVITE_NOT_FOUND"
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal Server Error",
  "message": "Une erreur est survenue",
  "code": "INTERNAL_ERROR"
}
```

