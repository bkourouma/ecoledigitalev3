# Search API Documentation

**Phase**: Phase 5 - Recherche Avancée et Gestion des Recommandations  
**Base URL**: `/api/v1/rso/search`

## Endpoints

### POST /search

Perform advanced search across activities and recommendations.

**Request Body**:
```json
{
  "query": "évacuation",
  "filters": {
    "annee_id": 1,
    "installation_id": 2,
    "type_activite": "ENTRAINEMENT",
    "statut": "termine",
    "tags": [1, 2],
    "date_debut": "2024-01-01",
    "date_fin": "2024-12-31"
  },
  "sort": {
    "field": "relevance",
    "order": "DESC"
  },
  "page": 1,
  "limit": 20,
  "include_drafts": false,
  "exact_match": false
}
```

**Response** (200 OK):
```json
{
  "results": [
    {
      "id": 123,
      "code_activite": "ACT-2024-PC-ENTRAINEMENT-T1-0001",
      "titre": "Entraînement évacuation d'urgence",
      "type_activite": "ENTRAINEMENT",
      "sous_type": "T1",
      "installation_nom": "Port de commerce",
      "date_activite": "2024-03-15",
      "statut": "termine",
      "tags": [
        {
          "id": 1,
          "nom": "évacuation",
          "couleur": "#e74c3c",
          "icone": "🚨"
        }
      ],
      "excerpt": "...procédures d'évacuation en cas d'urgence ont été testées...",
      "highlights": ["évacuation", "urgence"],
      "relevance_score": 0.95
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 24,
    "totalPages": 2
  },
  "query": "évacuation",
  "filters": { ... }
}
```

### GET /search/suggestions?q={query}

Get search suggestions for auto-completion.

**Query Parameters**:
- `q` (string, required): Search query (min 2 characters)

**Response** (200 OK):
```json
{
  "suggestions": [
    {
      "titre": "Entraînement évacuation d'urgence - T1 2024",
      "type": "Activité",
      "date": "2024-03-15",
      "icon": "🏃",
      "url": "/rso/activites/123"
    }
  ]
}
```

### POST /search/export

Export search results in various formats.

**Request Body**:
```json
{
  "query": { ... },
  "format": "pdf" // or "excel", "csv"
}
```

**Response**: File download (PDF, Excel, or CSV)

---

## Error Responses

**400 Bad Request**: Invalid search query or filters
```json
{
  "error": "Invalid search query",
  "details": { ... }
}
```

**403 Forbidden**: User not authorized to search
```json
{
  "error": "Access denied"
}
```

