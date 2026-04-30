# Installations API Contract

**Feature**: Phase 2 - Gestion des Installations RSO-PFSO  
**Date**: 2025-01-27  
**Status**: Draft

## Base URL

All endpoints are prefixed with `/api/rso/installations`

## Authentication

All endpoints require RSO authentication token (JWT) in Authorization header:
```
Authorization: Bearer <token>
```

## Endpoints

### GET /api/rso/installations

List all installations with optional filters and pagination.

**Query Parameters**:
- `page` (number, optional): Page number (default: 1)
- `limit` (number, optional): Items per page (default: 20, max: 100)
- `search` (string, optional): Search by name or code
- `ville` (string, optional): Filter by city ('Abidjan' or 'San-Pedro')
- `type` (string, optional): Filter by type ('port_commerce', 'terminal_conteneurs', 'terminal_petrolier', 'terminal_mineranier', 'autre')
- `statut` (string, optional): Filter by status ('actif', 'inactif', 'en_maintenance')
- `includeArchived` (boolean, optional): Include archived installations (default: false)

**Response**: `200 OK`
```json
{
  "installations": [
    {
      "id": 1,
      "nomPort": "Port de commerce",
      "codeInstallation": "PAD_COM",
      "typeInstallation": "port_commerce",
      "ville": "Abidjan",
      "statut": "actif",
      "adresse": "Boulevard de la République, Abidjan",
      "contactNom": "Jean KOUAME",
      "contactTelephone": "+225 07 00 00 00 01",
      "contactEmail": "contact@port-commerce.ci",
      "commentaire": null,
      "createdBy": {
        "id": 1,
        "nom": "Admin",
        "prenoms": "RSO"
      },
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-03-20T14:15:00Z",
      "deletedAt": null
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 19,
    "totalPages": 1
  }
}
```

**Permissions**:
- Administrateur: Can see all installations
- RSO Formateur: Can see all installations
- Agent PFSO: Can see only their assigned installation
- Agent Sûreté: No access

---

### GET /api/rso/installations/:id

Get installation details by ID.

**Response**: `200 OK`
```json
{
  "id": 1,
  "nomPort": "Port de commerce",
  "codeInstallation": "PAD_COM",
  "typeInstallation": "port_commerce",
  "ville": "Abidjan",
  "statut": "actif",
  "adresse": "Boulevard de la République, Abidjan",
  "contactNom": "Jean KOUAME",
  "contactTelephone": "+225 07 00 00 00 01",
  "contactEmail": "contact@port-commerce.ci",
  "commentaire": null,
  "createdBy": {
    "id": 1,
    "nom": "Admin",
    "prenoms": "RSO"
  },
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-03-20T14:15:00Z",
  "deletedAt": null,
  "responsables": [
    {
      "id": 1,
      "user": {
        "id": 5,
        "nom": "TOURE",
        "prenoms": "Mamadou"
      },
      "typeResponsable": "pfso_principal",
      "dateDebut": "2024-01-15",
      "dateFin": null,
      "statut": "actif"
    }
  ],
  "statistics": {
    "totalActivities": 45,
    "totalIncidents": 3,
    "lastActivityDate": "2024-11-25"
  }
}
```

**Error Responses**:
- `404 Not Found`: Installation not found
- `403 Forbidden`: User doesn't have access to this installation

---

### POST /api/rso/installations

Create a new installation.

**Request Body**:
```json
{
  "nomPort": "Nouvelle Installation",
  "codeInstallation": "PAD_NEW",
  "typeInstallation": "terminal_conteneurs",
  "ville": "Abidjan",
  "statut": "actif",
  "adresse": "Zone industrielle, Vridi",
  "contactNom": "Contact Name",
  "contactTelephone": "+225 07 00 00 00 02",
  "contactEmail": "contact@new-installation.ci",
  "commentaire": "Optional comments"
}
```

**Response**: `201 Created`
```json
{
  "id": 20,
  "nomPort": "Nouvelle Installation",
  "codeInstallation": "PAD_NEW",
  "typeInstallation": "terminal_conteneurs",
  "ville": "Abidjan",
  "statut": "actif",
  "createdBy": {
    "id": 2,
    "nom": "Formateur",
    "prenoms": "RSO"
  },
  "createdAt": "2025-01-27T10:00:00Z",
  "updatedAt": "2025-01-27T10:00:00Z"
}
```

**Error Responses**:
- `400 Bad Request`: Validation errors
- `409 Conflict`: Code installation already exists
- `403 Forbidden`: User doesn't have permission to create

**Permissions**:
- Administrateur: ✅ Can create
- RSO Formateur: ✅ Can create
- Agent PFSO: ❌ Cannot create
- Agent Sûreté: ❌ Cannot create

---

### PUT /api/rso/installations/:id

Update an existing installation.

**Request Body** (all fields optional):
```json
{
  "nomPort": "Updated Name",
  "typeInstallation": "port_commerce",
  "statut": "inactif",
  "contactNom": "New Contact",
  "commentaire": "Updated comments"
}
```

**Response**: `200 OK`
```json
{
  "id": 1,
  "nomPort": "Updated Name",
  "codeInstallation": "PAD_COM",
  "typeInstallation": "port_commerce",
  "ville": "Abidjan",
  "statut": "inactif",
  "updatedAt": "2025-01-27T11:00:00Z"
}
```

**Error Responses**:
- `404 Not Found`: Installation not found
- `400 Bad Request`: Validation errors
- `403 Forbidden`: User doesn't have permission to update (RSO Formateur can only update their own)

**Permissions**:
- Administrateur: ✅ Can update any
- RSO Formateur: ✅ Can update only installations they created
- Agent PFSO: ❌ Cannot update
- Agent Sûreté: ❌ Cannot update

---

### DELETE /api/rso/installations/:id

Soft delete (archive) an installation.

**Response**: `200 OK`
```json
{
  "message": "Installation archived successfully",
  "id": 1
}
```

**Error Responses**:
- `404 Not Found`: Installation not found
- `400 Bad Request`: Installation has assigned Agent PFSO users
- `403 Forbidden`: User doesn't have permission to delete

**Permissions**:
- Administrateur: ✅ Can delete
- RSO Formateur: ❌ Cannot delete
- Agent PFSO: ❌ Cannot delete
- Agent Sûreté: ❌ Cannot delete

---

### POST /api/rso/installations/:id/restore

Restore an archived installation.

**Response**: `200 OK`
```json
{
  "message": "Installation restored successfully",
  "id": 1
}
```

**Permissions**: Administrateur only

---

### GET /api/rso/installations/check-code/:code

Check if an installation code is available (real-time validation).

**Response**: `200 OK`
```json
{
  "code": "PAD_NEW",
  "exists": false,
  "available": true
}
```

**Response** (if code exists): `200 OK`
```json
{
  "code": "PAD_COM",
  "exists": true,
  "available": false
}
```

---

### GET /api/rso/installations/archives

List archived installations.

**Query Parameters**: Same as GET /api/rso/installations

**Response**: Same format as GET /api/rso/installations

**Permissions**: Administrateur only

---

### GET /api/rso/installations/stats

Get global installation statistics.

**Query Parameters**:
- `year` (number, optional): Filter by year (default: current active year)

**Response**: `200 OK`
```json
{
  "total": 19,
  "active": 15,
  "inactive": 3,
  "maintenance": 1,
  "byVille": {
    "Abidjan": 16,
    "San-Pedro": 3
  },
  "byType": {
    "port_commerce": 3,
    "terminal_conteneurs": 4,
    "terminal_petrolier": 7,
    "terminal_mineranier": 3,
    "autre": 2
  }
}
```

---

### GET /api/rso/installations/:id/stats

Get statistics for a specific installation.

**Query Parameters**:
- `year` (number, optional): Filter by year (default: current active year)

**Response**: `200 OK`
```json
{
  "installationId": 1,
  "year": 2024,
  "totalActivities": 45,
  "totalIncidents": 3,
  "lastActivityDate": "2024-11-25",
  "activitiesByMonth": {
    "2024-01": 5,
    "2024-02": 4,
    "2024-03": 6
  }
}
```

**Note**: Activity statistics will be placeholders until Phase 3 implementation.

---

### GET /api/rso/installations/export/excel

Export installations to Excel format.

**Query Parameters**: Same filters as GET /api/rso/installations

**Response**: `200 OK` (Excel file download)
- Content-Type: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- Content-Disposition: `attachment; filename="installations-YYYY-MM-DD.xlsx"`

**Permissions**: Administrateur, RSO Formateur

---

### GET /api/rso/installations/export/pdf

Export installations to PDF format.

**Query Parameters**: Same filters as GET /api/rso/installations

**Response**: `200 OK` (PDF file download)
- Content-Type: `application/pdf`
- Content-Disposition: `attachment; filename="installations-YYYY-MM-DD.pdf"`

**Permissions**: Administrateur, RSO Formateur

---

## Responsible Person Management

### GET /api/rso/installations/:id/responsables

Get responsible persons for an installation.

**Response**: `200 OK`
```json
{
  "installationId": 1,
  "responsables": [
    {
      "id": 1,
      "user": {
        "id": 5,
        "nom": "TOURE",
        "prenoms": "Mamadou",
        "email": "mamadou.toure@aspci.ci"
      },
      "typeResponsable": "pfso_principal",
      "dateDebut": "2024-01-15",
      "dateFin": null,
      "statut": "actif"
    }
  ]
}
```

---

### POST /api/rso/installations/:id/responsables

Add a responsible person to an installation.

**Request Body**:
```json
{
  "userId": 5,
  "typeResponsable": "pfso_principal",
  "dateDebut": "2024-01-15",
  "dateFin": null
}
```

**Response**: `201 Created`
```json
{
  "id": 1,
  "installationId": 1,
  "userId": 5,
  "typeResponsable": "pfso_principal",
  "dateDebut": "2024-01-15",
  "dateFin": null,
  "statut": "actif"
}
```

**Error Responses**:
- `400 Bad Request`: Validation errors (e.g., only one active PFSO Principal allowed)
- `404 Not Found`: Installation or user not found
- `403 Forbidden`: User doesn't have permission

**Permissions**: Administrateur, RSO Formateur

---

### PUT /api/rso/installations/:id/responsables/:responsableId

Update a responsible person assignment.

**Request Body**:
```json
{
  "typeResponsable": "pfso_adjoint",
  "dateFin": "2024-12-31"
}
```

**Response**: `200 OK` (same format as POST)

**Permissions**: Administrateur, RSO Formateur

---

### DELETE /api/rso/installations/:id/responsables/:responsableId

Remove a responsible person (set date_fin and mark inactive).

**Response**: `200 OK`
```json
{
  "message": "Responsible person assignment ended",
  "id": 1
}
```

**Permissions**: Administrateur, RSO Formateur

