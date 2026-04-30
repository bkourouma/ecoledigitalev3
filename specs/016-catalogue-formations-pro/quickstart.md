# Quickstart: Professional Training Catalog API

**Date**: 2025-11-14  
**Feature**: 016-catalogue-formations-pro  
**Base URL**: `http://localhost:8011/api/v1/formations-pro` (development)  
**Production**: `https://ecoledigitale.engage-360.net/api/v1/formations-pro`

## Overview

This guide provides quick examples for using the professional training catalog API. All endpoints are publicly accessible (no authentication required for browsing).

---

## 1. List Training Programs

### Basic Request

```bash
GET /api/v1/formations-pro?page=1&limit=20
```

### With Search

```bash
GET /api/v1/formations-pro?search=python&page=1&limit=20
```

### With Filters

```bash
GET /api/v1/formations-pro?themes=data-science,analytics&prix_min=100000&prix_max=500000&niveau=Intermédiaire&page=1&limit=20
```

### With Sorting

```bash
GET /api/v1/formations-pro?sort=prix_asc&page=1&limit=20
```

### Complete Example (cURL)

```bash
curl -X GET "http://localhost:8011/api/v1/formations-pro?search=python&themes=data-science&prix_min=100000&sort=prix_asc&page=1&limit=20" \
  -H "X-Tenant: imhotepdata"
```

### Response Example

```json
{
  "success": true,
  "data": {
    "formations": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "titre": "Formation Python pour la Data Science",
        "slug": "formation-python-data-science",
        "description_courte": "Maîtrisez Python pour l'analyse de données et le machine learning",
        "duree_jours": 5,
        "duree_heures": 35,
        "prix_ttc": 250000,
        "niveau": "Intermédiaire",
        "type_certification": "Certificat",
        "themes": ["data-science", "python", "analytics"],
        "prochaine_session": {
          "date_debut": "2025-12-15",
          "mode_formation": "hybride"
        }
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 45,
      "totalPages": 3
    }
  }
}
```

---

## 2. Get Training Detail

### Request

```bash
GET /api/v1/formations-pro/formation-python-data-science
```

### Complete Example (cURL)

```bash
curl -X GET "http://localhost:8011/api/v1/formations-pro/formation-python-data-science" \
  -H "X-Tenant: imhotepdata"
```

### Response Example

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "titre": "Formation Python pour la Data Science",
    "slug": "formation-python-data-science",
    "description_courte": "Maîtrisez Python pour l'analyse de données et le machine learning",
    "description_complete": "Cette formation complète vous permettra de maîtriser Python pour la data science...",
    "objectifs": [
      "Maîtriser les bases de Python",
      "Utiliser pandas pour l'analyse de données",
      "Implémenter des modèles de machine learning"
    ],
    "programme_detaille": {
      "modules": [
        {
          "titre": "Module 1: Introduction à Python",
          "duree": "1 jour",
          "contenu": [
            "Syntaxe Python",
            "Structures de données",
            "Fonctions et classes"
          ]
        },
        {
          "titre": "Module 2: Pandas et NumPy",
          "duree": "2 jours",
          "contenu": [
            "Manipulation de DataFrames",
            "Opérations sur les arrays",
            "Traitement des données manquantes"
          ]
        }
      ]
    },
    "prerequis": "Connaissances de base en programmation",
    "public_cible": "Data analysts, développeurs, étudiants",
    "duree_jours": 5,
    "duree_heures": 35,
    "prix_ht": 208333,
    "prix_ttc": 250000,
    "type_certification": "Certificat",
    "nom_certification": "Certificat Python Data Science",
    "themes": ["data-science", "python", "analytics"],
    "niveau": "Intermédiaire",
    "sessions": [
      {
        "id": "660e8400-e29b-41d4-a716-446655440001",
        "code_session": "DATA-2025-001",
        "date_debut": "2025-12-15",
        "date_fin": "2025-12-19",
        "horaires": "9h-17h",
        "mode_formation": "hybride",
        "lieu": "Imhotep Data, Abidjan",
        "places_disponibles": 12,
        "prix_ttc": 250000
      },
      {
        "id": "770e8400-e29b-41d4-a716-446655440002",
        "code_session": "DATA-2026-001",
        "date_debut": "2026-01-20",
        "date_fin": "2026-01-24",
        "horaires": "9h-17h",
        "mode_formation": "presentiel",
        "lieu": "Imhotep Data, Abidjan",
        "places_disponibles": 20,
        "prix_ttc": 250000
      }
    ]
  }
}
```

---

## 3. Get Training Sessions

### Request

```bash
GET /api/v1/formations-pro/{id}/sessions?limit=50
```

### Complete Example (cURL)

```bash
curl -X GET "http://localhost:8011/api/v1/formations-pro/550e8400-e29b-41d4-a716-446655440000/sessions?limit=50" \
  -H "X-Tenant: imhotepdata"
```

### Response Example

```json
{
  "success": true,
  "data": {
    "sessions": [
      {
        "id": "660e8400-e29b-41d4-a716-446655440001",
        "code_session": "DATA-2025-001",
        "date_debut": "2025-12-15",
        "date_fin": "2025-12-19",
        "horaires": "9h-17h",
        "mode_formation": "hybride",
        "lieu": "Imhotep Data, Abidjan",
        "places_disponibles": 12,
        "prix_ttc": 250000
      }
    ],
    "total": 1
  }
}
```

---

## 4. Get Similar Trainings

### Request

```bash
GET /api/v1/formations-pro/{id}/similaires
```

### Complete Example (cURL)

```bash
curl -X GET "http://localhost:8011/api/v1/formations-pro/550e8400-e29b-41d4-a716-446655440000/similaires" \
  -H "X-Tenant: imhotepdata"
```

### Response Example

```json
{
  "success": true,
  "data": {
    "formations": [
      {
        "id": "880e8400-e29b-41d4-a716-446655440003",
        "titre": "Formation R pour la Data Science",
        "slug": "formation-r-data-science",
        "description_courte": "Maîtrisez R pour l'analyse statistique",
        "duree_jours": 5,
        "duree_heures": 35,
        "prix_ttc": 240000,
        "niveau": "Intermédiaire",
        "type_certification": "Certificat",
        "themes": ["data-science", "analytics"],
        "prochaine_session": {
          "date_debut": "2026-01-10",
          "mode_formation": "presentiel"
        }
      }
    ]
  }
}
```

---

## 5. Download Training PDF

### Request

```bash
GET /api/v1/formations-pro/{id}/programme-pdf
```

### Complete Example (cURL)

```bash
curl -X GET "http://localhost:8011/api/v1/formations-pro/550e8400-e29b-41d4-a716-446655440000/programme-pdf" \
  -H "X-Tenant: imhotepdata" \
  --output programme-python-data-science.pdf
```

### Response

- Content-Type: `application/pdf`
- Content-Disposition: `attachment; filename="programme-formation-python-data-science.pdf"`
- Body: PDF binary data

**Note**: PDF generation may take up to 5 seconds. Consider showing a loading indicator in the UI.

---

## 6. Get Available Themes

### Request

```bash
GET /api/v1/formations-pro/themes
```

### Complete Example (cURL)

```bash
curl -X GET "http://localhost:8011/api/v1/formations-pro/themes" \
  -H "X-Tenant: imhotepdata"
```

### Response Example

```json
{
  "success": true,
  "data": {
    "themes": [
      {
        "value": "data-science",
        "label": "Data Science",
        "count": 15
      },
      {
        "value": "python",
        "label": "Python",
        "count": 8
      },
      {
        "value": "analytics",
        "label": "Analytics",
        "count": 12
      }
    ]
  }
}
```

---

## 7. Get Filter Statistics

### Request

```bash
GET /api/v1/formations-pro/stats
```

### Complete Example (cURL)

```bash
curl -X GET "http://localhost:8011/api/v1/formations-pro/stats" \
  -H "X-Tenant: imhotepdata"
```

### Response Example

```json
{
  "success": true,
  "data": {
    "prix": {
      "min": 50000,
      "max": 1000000
    },
    "duree": {
      "min": 1,
      "max": 30
    },
    "total_formations": 45,
    "total_sessions": 120
  }
}
```

---

## Frontend Usage Examples

### React with TanStack Query

```typescript
import { useQuery } from "@tanstack/react-query";
import { FormationListQuery, FormationListResponse } from "@ecoledigitale/contracts";

// List trainings with filters
function useFormations(filters: FormationListQuery) {
  return useQuery<FormationListResponse>({
    queryKey: ["formations", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.search) params.append("search", filters.search);
      if (filters.themes?.length) params.append("themes", filters.themes.join(","));
      if (filters.prix_min) params.append("prix_min", filters.prix_min.toString());
      // ... other filters
      params.append("page", filters.page?.toString() || "1");
      params.append("limit", filters.limit?.toString() || "20");

      const response = await fetch(`/api/v1/formations-pro?${params}`);
      if (!response.ok) throw new Error("Failed to fetch formations");
      return response.json();
    },
  });
}

// Get training detail
function useFormationDetail(slug: string) {
  return useQuery({
    queryKey: ["formation", slug],
    queryFn: async () => {
      const response = await fetch(`/api/v1/formations-pro/${slug}`);
      if (!response.ok) throw new Error("Training not found");
      return response.json();
    },
  });
}

// Download PDF
async function downloadPDF(formationId: string, slug: string) {
  const response = await fetch(`/api/v1/formations-pro/${formationId}/programme-pdf`);
  if (!response.ok) throw new Error("Failed to generate PDF");
  
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `programme-${slug}.pdf`;
  a.click();
  window.URL.revokeObjectURL(url);
}
```

---

## Error Handling

### Example Error Response

```json
{
  "success": false,
  "error": "NOT_FOUND",
  "message": "Training not found or inactive"
}
```

### Common Error Codes

- `NOT_FOUND` (404): Training not found or inactive
- `VALIDATION_ERROR` (400): Invalid query parameters
- `INTERNAL_ERROR` (500): Server error
- `SERVICE_UNAVAILABLE` (503): PDF generation timeout

---

## Notes

- **Tenant Header**: Include `X-Tenant: imhotepdata` header in all requests (or use subdomain-based resolution)
- **Pagination**: Default page size is 20, maximum is 100
- **Search**: Full-text search on title and descriptions (French language)
- **Filters**: Multiple filters are combined with AND logic
- **Sorting**: Default is "pertinence" (relevance when searching, otherwise by next session date)
- **Sessions**: Only upcoming sessions (`date_debut >= today`) with status 'planifiee' or 'ouverte' are returned
- **Active Only**: Only trainings with `actif = true` are returned

---

**Next Steps**: See `plan.md` for implementation details and `data-model.md` for database structure.

