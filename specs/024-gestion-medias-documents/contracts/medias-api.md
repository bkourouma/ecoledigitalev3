# Médias API Contract

**Feature**: Phase 4 - Gestion des Médias et Documents  
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

## Media Upload Endpoints

### POST /api/v1/rso/formateur/medias/upload

Upload one or more media files (images, videos, documents).

**Request**: `multipart/form-data`
- `files` (File[]): One or more files to upload (max 10 files)
- `activiteId` (number, optional): Associate media with activity immediately
- `legende` (string, optional): Caption for media (applies to all files if single value)

**Response**: `201 Created`
```json
{
  "medias": [
    {
      "id": 1,
      "typeMedia": "image",
      "nomOriginal": "photo_formation.jpg",
      "nomFichier": "a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg",
      "cheminFichier": "uploads/aspci/medias/2024/11/image/a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg",
      "cheminThumbnail": "uploads/aspci/medias/2024/11/image/thumb_a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg",
      "cheminOptimise": "uploads/aspci/medias/2024/11/image/opt_a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg",
      "tailleOctets": 2621440,
      "tailleHumaine": "2.5 MB",
      "mimeType": "image/jpeg",
      "extension": ".jpg",
      "largeur": 1920,
      "hauteur": 1080,
      "statut": "traite",
      "urlOriginal": "/api/v1/rso/medias/1/original",
      "urlOptimise": "/api/v1/rso/medias/1/optimise",
      "urlThumbnail": "/api/v1/rso/medias/1/thumbnail",
      "uploadedBy": {
        "id": 2,
        "nom": "DIALLO",
        "prenoms": "Aminata"
      },
      "uploadedAt": "2024-11-15T14:30:00Z"
    }
  ],
  "quota": {
    "quotaTotalMo": 1000,
    "quotaUtiliseMo": 456.5,
    "quotaUtilisePourcent": 45.65
  }
}
```

**Error Responses**:
- `400 Bad Request`: Invalid file type, file too large, quota exceeded
- `413 Payload Too Large`: Total upload size exceeds limits
- `500 Internal Server Error`: Processing error

**Permissions**: Formateur RSO, Admin

---

### POST /api/v1/rso/formateur/activites/:id/medias/upload

Upload media files directly to an activity.

**Request**: `multipart/form-data`
- `files` (File[]): One or more files to upload (max 10 files)
- `legende` (string, optional): Caption for media

**Response**: `201 Created` (same as above)

**Permissions**: Formateur RSO (owner of activity), Admin

---

## Media Management Endpoints

### GET /api/v1/rso/formateur/medias

List all media files for the current user (media library).

**Query Parameters**:
- `page` (number, optional): Page number (default: 1)
- `limit` (number, optional): Items per page (default: 20, max: 100)
- `typeMedia` (string, optional): Filter by type ('image', 'video', 'document', 'audio')
- `activiteId` (number, optional): Filter by activity
- `dateDebut` (string, optional): Filter by upload date (ISO format)
- `dateFin` (string, optional): Filter by upload date (ISO format)
- `search` (string, optional): Search in filename and caption
- `view` (string, optional): View mode ('grid', 'list', default: 'grid')

**Response**: `200 OK`
```json
{
  "medias": [
    {
      "id": 1,
      "typeMedia": "image",
      "nomOriginal": "photo_formation.jpg",
      "tailleHumaine": "2.5 MB",
      "largeur": 1920,
      "hauteur": 1080,
      "legende": "Photo de la formation",
      "activite": {
        "id": 5,
        "codeActivite": "ACT-2024-PAD_COM-ENT-T1-001",
        "titre": "Entraînement évacuation"
      },
      "urlThumbnail": "/api/v1/rso/medias/1/thumbnail",
      "uploadedAt": "2024-11-15T14:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 155,
    "totalPages": 8
  },
  "quota": {
    "quotaTotalMo": 1000,
    "quotaUtiliseMo": 456.5,
    "quotaUtilisePourcent": 45.65,
    "repartition": {
      "images": { "tailleMo": 234.2, "nbFichiers": 128 },
      "videos": { "tailleMo": 198.3, "nbFichiers": 12 },
      "documents": { "tailleMo": 24.0, "nbFichiers": 15 }
    }
  }
}
```

**Permissions**: Formateur RSO, Admin

---

### GET /api/v1/rso/formateur/medias/:id

Get details of a specific media file.

**Response**: `200 OK`
```json
{
  "id": 1,
  "activiteId": 5,
  "typeMedia": "image",
  "nomOriginal": "photo_formation.jpg",
  "nomFichier": "a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg",
  "cheminFichier": "uploads/aspci/medias/2024/11/image/a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg",
  "tailleOctets": 2621440,
  "tailleHumaine": "2.5 MB",
  "mimeType": "image/jpeg",
  "extension": ".jpg",
  "largeur": 1920,
  "hauteur": 1080,
  "legende": "Photo de la formation",
  "description": null,
  "ordre": 1,
  "estPrincipal": true,
  "statut": "traite",
  "exifData": {
    "camera": "Canon EOS 5D",
    "datePrise": "2024-11-15T14:25:00Z",
    "iso": 400,
    "ouverture": "f/2.8",
    "vitesse": "1/125"
  },
  "urlOriginal": "/api/v1/rso/medias/1/original",
  "urlOptimise": "/api/v1/rso/medias/1/optimise",
  "urlThumbnail": "/api/v1/rso/medias/1/thumbnail",
  "activite": {
    "id": 5,
    "codeActivite": "ACT-2024-PAD_COM-ENT-T1-001",
    "titre": "Entraînement évacuation"
  },
  "uploadedBy": {
    "id": 2,
    "nom": "DIALLO",
    "prenoms": "Aminata"
  },
  "uploadedAt": "2024-11-15T14:30:00Z",
  "updatedAt": "2024-11-15T14:30:00Z"
}
```

**Permissions**: Formateur RSO (owner), Admin

---

### PUT /api/v1/rso/formateur/medias/:id

Update media metadata (caption, description, order).

**Request Body**:
```json
{
  "legende": "Nouvelle légende",
  "description": "Description détaillée",
  "ordre": 2
}
```

**Response**: `200 OK` (updated media object)

**Permissions**: Formateur RSO (owner), Admin

---

### PATCH /api/v1/rso/formateur/medias/:id/ordre

Update display order of media in gallery.

**Request Body**:
```json
{
  "ordre": 3
}
```

**Response**: `200 OK`

**Permissions**: Formateur RSO (owner), Admin

---

### PATCH /api/v1/rso/formateur/activites/:id/medias/:mediaId/principal

Set media as primary image for activity gallery.

**Response**: `200 OK`
```json
{
  "message": "Image principale mise à jour",
  "mediaPrincipal": {
    "id": 1,
    "nomOriginal": "photo_formation.jpg",
    "urlThumbnail": "/api/v1/rso/medias/1/thumbnail"
  }
}
```

**Permissions**: Formateur RSO (owner of activity), Admin

---

### DELETE /api/v1/rso/formateur/medias/:id

Delete a media file (soft delete).

**Response**: `200 OK`
```json
{
  "message": "Média supprimé",
  "quota": {
    "quotaTotalMo": 1000,
    "quotaUtiliseMo": 454.0,
    "quotaUtilisePourcent": 45.4
  }
}
```

**Permissions**: Formateur RSO (owner), Admin

---

## Activity Media Gallery Endpoints

### GET /api/v1/rso/formateur/activites/:id/medias

Get all media files for an activity (gallery).

**Query Parameters**:
- `typeMedia` (string, optional): Filter by type

**Response**: `200 OK`
```json
{
  "activiteId": 5,
  "medias": [
    {
      "id": 1,
      "typeMedia": "image",
      "nomOriginal": "photo_formation.jpg",
      "legende": "Photo de la formation",
      "ordre": 1,
      "estPrincipal": true,
      "largeur": 1920,
      "hauteur": 1080,
      "urlOriginal": "/api/v1/rso/medias/1/original",
      "urlOptimise": "/api/v1/rso/medias/1/optimise",
      "urlThumbnail": "/api/v1/rso/medias/1/thumbnail"
    }
  ],
  "imagePrincipale": {
    "id": 1,
    "urlThumbnail": "/api/v1/rso/medias/1/thumbnail"
  }
}
```

**Permissions**: Formateur RSO (owner), Admin, PFSO (if has permission to view activity)

---

### POST /api/v1/rso/formateur/activites/:id/medias

Associate existing media files with an activity.

**Request Body**:
```json
{
  "mediaIds": [1, 2, 3],
  "ordre": [1, 2, 3]
}
```

**Response**: `200 OK`

**Permissions**: Formateur RSO (owner of activity), Admin

---

### DELETE /api/v1/rso/formateur/activites/:id/medias/:mediaId

Remove media from activity gallery (does not delete media file).

**Response**: `200 OK`

**Permissions**: Formateur RSO (owner of activity), Admin

---

## Media File Serving Endpoints

### GET /api/v1/rso/medias/:id/original

Serve original media file.

**Response**: `200 OK` (file stream with appropriate Content-Type)

**Permissions**: Formateur RSO (owner), Admin, PFSO (if has permission to view associated activity)

---

### GET /api/v1/rso/medias/:id/optimise

Serve optimized media file (for images).

**Response**: `200 OK` (file stream)

**Permissions**: Same as original

---

### GET /api/v1/rso/medias/:id/thumbnail

Serve thumbnail file.

**Response**: `200 OK` (file stream)

**Permissions**: Same as original

---

### GET /api/v1/rso/medias/:id/download

Download media file.

**Response**: `200 OK` (file download with Content-Disposition header)

**Permissions**: Same as original

---

## Export Endpoints

### POST /api/v1/rso/formateur/activites/:id/export/pdf

Generate PDF export of activity.

**Request Body**:
```json
{
  "formatPage": "A4",
  "orientation": "portrait",
  "includeImages": true,
  "includeRecommendations": true,
  "watermark": false
}
```

**Response**: `200 OK` (PDF file stream with Content-Type: application/pdf)

**Permissions**: Formateur RSO (owner), Admin, PFSO (if has permission to view activity)

---

### POST /api/v1/rso/formateur/activites/:id/export/word

Generate Word (DOCX) export of activity.

**Request Body**:
```json
{
  "includeImages": true,
  "includeRecommendations": true
}
```

**Response**: `200 OK` (DOCX file stream with Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document)

**Permissions**: Same as PDF

---

### POST /api/v1/rso/formateur/activites/export/excel

Generate Excel (XLSX) export of activity list.

**Request Body**:
```json
{
  "filters": {
    "installationId": 1,
    "typeActivite": "ENTRAINEMENT",
    "anneeId": 2024
  }
}
```

**Response**: `200 OK` (XLSX file stream with Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet)

**Permissions**: Formateur RSO, Admin

---

### GET /api/v1/rso/formateur/exports/:id

Download a previously generated export.

**Response**: `200 OK` (file stream)

**Permissions**: Formateur RSO (owner), Admin

---

## Quota Management Endpoints

### GET /api/v1/rso/formateur/medias/quota

Get current user's quota information.

**Response**: `200 OK`
```json
{
  "quotaTotalMo": 1000,
  "quotaUtiliseMo": 456.5,
  "quotaUtilisePourcent": 45.65,
  "quotaRestantMo": 543.5,
  "repartition": {
    "images": {
      "tailleMo": 234.2,
      "nbFichiers": 128,
      "pourcent": 23.42
    },
    "videos": {
      "tailleMo": 198.3,
      "nbFichiers": 12,
      "pourcent": 19.83
    },
    "documents": {
      "tailleMo": 24.0,
      "nbFichiers": 15,
      "pourcent": 2.4
    }
  },
  "limites": {
    "fichierImageMo": 10,
    "fichierVideoMo": 100,
    "fichierDocumentMo": 20
  },
  "avertissement": null
}
```

**Permissions**: Formateur RSO, Admin

---

### GET /api/v1/rso/formateur/medias/stats

Get detailed statistics on media usage.

**Response**: `200 OK`
```json
{
  "totalFichiers": 155,
  "totalTailleMo": 456.5,
  "repartitionParType": {
    "images": { "nb": 128, "tailleMo": 234.2 },
    "videos": { "nb": 12, "tailleMo": 198.3 },
    "documents": { "nb": 15, "tailleMo": 24.0 }
  },
  "evolution": [
    { "mois": "2024-09", "tailleMo": 320.5 },
    { "mois": "2024-10", "tailleMo": 398.2 },
    { "mois": "2024-11", "tailleMo": 456.5 }
  ],
  "activitesPlusConsommatrices": [
    {
      "activiteId": 5,
      "codeActivite": "ACT-2024-PAD_COM-ENT-T1-001",
      "tailleMo": 45.2,
      "nbFichiers": 12
    }
  ]
}
```

**Permissions**: Formateur RSO, Admin

---

## Admin Quota Management Endpoints

### GET /api/v1/rso/admin/quotas

List all user quotas (admin only).

**Query Parameters**:
- `page` (number, optional): Page number
- `limit` (number, optional): Items per page
- `search` (string, optional): Search by user name

**Response**: `200 OK`
```json
{
  "quotas": [
    {
      "userId": 2,
      "user": {
        "id": 2,
        "nom": "DIALLO",
        "prenoms": "Aminata",
        "email": "aminata.diallo@example.com"
      },
      "quotaTotalMo": 1000,
      "quotaUtiliseMo": 456.5,
      "quotaUtilisePourcent": 45.65,
      "nbTotalFichiers": 155,
      "dernierUpload": "2024-11-15T14:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 25,
    "totalPages": 2
  }
}
```

**Permissions**: Admin only

---

### PUT /api/v1/rso/admin/quotas/:userId

Update user quota (admin only).

**Request Body**:
```json
{
  "quotaTotalMo": 2000
}
```

**Response**: `200 OK`
```json
{
  "message": "Quota mis à jour",
  "quota": {
    "userId": 2,
    "quotaTotalMo": 2000,
    "quotaUtiliseMo": 456.5,
    "quotaUtilisePourcent": 22.825
  }
}
```

**Permissions**: Admin only

---

## Error Responses

All endpoints may return the following error responses:

### 400 Bad Request
```json
{
  "error": "Validation error",
  "message": "File type not allowed",
  "details": {
    "field": "files",
    "reason": "Only jpg, jpeg, png, gif, webp are allowed"
  }
}
```

### 403 Forbidden
```json
{
  "error": "Permission denied",
  "message": "You do not have permission to access this media"
}
```

### 404 Not Found
```json
{
  "error": "Not found",
  "message": "Media file not found"
}
```

### 413 Payload Too Large
```json
{
  "error": "File too large",
  "message": "File size exceeds 10MB limit for images",
  "maxSize": "10MB"
}
```

### 429 Too Many Requests
```json
{
  "error": "Quota exceeded",
  "message": "Storage quota would be exceeded",
  "quotaTotalMo": 1000,
  "quotaUtiliseMo": 995,
  "requiredMo": 10
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal server error",
  "message": "Failed to process media file"
}
```

---

## Rate Limiting

- Upload endpoints: 10 requests per minute per user
- Export endpoints: 5 requests per minute per user
- Other endpoints: 60 requests per minute per user

---

## Notes

- All file sizes are in bytes in the database, but API returns human-readable format
- Media files are soft-deleted (30-day retention)
- Quota is calculated in real-time from media file sizes
- Export files expire after 30 days (auto-cleanup)
- Media processing (compression, thumbnails) happens asynchronously
- File serving endpoints verify permissions before serving files

