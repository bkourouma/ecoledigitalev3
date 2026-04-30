# Quick Start Guide: Phase 6 - Gestion Administrative & Documents

**Feature**: Phase 6 - Gestion Administrative & Documents (`020-phase`)  
**Date**: 2025-01-27

## Overview

This guide provides quick examples for using the administrative document management, enterprise client management, data export, and reporting features.

## Document Generation

### Generate a Convention

```typescript
// POST /api/v1/admin/documents/convention/generer
const response = await fetch('/api/v1/admin/documents/convention/generer', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    inscription_id: '123e4567-e89b-12d3-a456-426614174000'
  })
});

const { document_url, document_id, numero } = await response.json();
// document_url: "/api/v1/files/{tenantId}/documents/conventions/convention-CONV-2024-0001.pdf"
// numero: "CONV-2024-0001"
```

### Generate Attestations in Batch

```typescript
// POST /api/v1/admin/documents/batch-generate
const response = await fetch('/api/v1/admin/documents/batch-generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    type: 'attestation_presence',
    session_id: '123e4567-e89b-12d3-a456-426614174000'
  })
});

const { nb_generes, documents } = await response.json();
// nb_generes: 25
// documents: [{ inscription_id, apprenant, document_url, document_id, numero }, ...]
```

### List Documents with Filters

```typescript
// GET /api/v1/admin/documents?type=convention&session_id=...&page=1&limit=20
const response = await fetch('/api/v1/admin/documents?type=convention&page=1&limit=20');
const { documents, total, page, totalPages } = await response.json();
```

## Enterprise Client Management

### Create Enterprise

```typescript
// POST /api/v1/admin/entreprises
const response = await fetch('/api/v1/admin/entreprises', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    raison_sociale: 'ACME SARL',
    siret: '12345678901234',
    forme_juridique: 'SARL',
    adresse: '123 Rue Example',
    code_postal: '01 BP 1234',
    ville: 'Abidjan',
    pays: 'Côte d\'Ivoire',
    contact_nom: 'Dupont',
    contact_prenom: 'Jean',
    contact_email: 'j.dupont@acme.ci',
    contact_telephone: '+225 01 23 45 67 89',
    secteur_activite: 'Technologie',
    nombre_employes: 50
  })
});

const entreprise = await response.json();
```

### Get Enterprise with Statistics

```typescript
// GET /api/v1/admin/entreprises/:id
const response = await fetch('/api/v1/admin/entreprises/123e4567-e89b-12d3-a456-426614174000');
const { entreprise, inscriptions, statistiques } = await response.json();
// statistiques: { nb_inscriptions: 12, nb_apprenants: 8, ca_total: 1800000, formations_suivies: [...] }
```

### Generate Grouped Invoice

```typescript
// POST /api/v1/admin/entreprises/:id/facturation-groupee
const response = await fetch('/api/v1/admin/entreprises/123e4567-e89b-12d3-a456-426614174000/facturation-groupee', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    inscription_ids: [
      '123e4567-e89b-12d3-a456-426614174001',
      '123e4567-e89b-12d3-a456-426614174002'
    ],
    date_echeance: '2024-12-31T23:59:59Z'
  })
});

const { facture_url, numero_facture } = await response.json();
// numero_facture: "FACTG-2024-0001"
```

## Data Exports

### Export Enrollments

```typescript
// POST /api/v1/admin/exports/inscriptions
const response = await fetch('/api/v1/admin/exports/inscriptions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    filters: {
      date_debut: '2024-01-01T00:00:00Z',
      date_fin: '2024-12-31T23:59:59Z',
      statut: 'confirmee'
    },
    format: 'xlsx',
    colonnes: ['nom', 'prenom', 'email', 'formation', 'montant_ttc', 'statut']
  })
});

// Returns job_id for async processing
const { job_id } = await response.json();

// Poll job status
const jobResponse = await fetch(`/api/v1/admin/exports/jobs/${job_id}`);
const { status, progress, fichier_url } = await jobResponse.json();
// When status === 'completed', download from fichier_url
```

### Export Payments with Grouping

```typescript
// POST /api/v1/admin/exports/paiements
const response = await fetch('/api/v1/admin/exports/paiements', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    filters: {
      date_debut: '2024-01-01T00:00:00Z',
      date_fin: '2024-12-31T23:59:59Z'
    },
    format: 'xlsx',
    grouper_par: 'methode'
  })
});
```

## Reporting

### Get Dashboard Metrics

```typescript
// GET /api/v1/admin/reporting/dashboard?periode=mois
const response = await fetch('/api/v1/admin/reporting/dashboard?periode=mois');
const {
  inscriptions: { total: 45, evolution: '+12%' },
  ca: { total: 6750000, evolution: '+8%' },
  sessions: { total: 12, taux_remplissage: '85%' },
  top_formations: [...],
  top_entreprises: [...]
} = await response.json();
```

### Get Revenue Forecast

```typescript
// GET /api/v1/admin/reporting/ca-previsionnel?annee=2024
const response = await fetch('/api/v1/admin/reporting/ca-previsionnel?annee=2024');
const {
  ca_realise: 5000000,
  ca_previsionnel: 3000000,
  ca_potentiel: 1000000,
  ca_total_estime: 9000000,
  par_mois: [...],
  par_formation: [...]
} = await response.json();
```

### Get Conversion Rates

```typescript
// GET /api/v1/admin/reporting/taux-conversion
const response = await fetch('/api/v1/admin/reporting/taux-conversion');
const {
  taux_global: '85.5%',
  par_formation: [...],
  par_methode_paiement: [...],
  par_mois: [...]
} = await response.json();
```

## Frontend Usage Examples

### Using TanStack Query

```typescript
import { useQuery, useMutation } from '@tanstack/react-query';

// Generate document
const generateConvention = useMutation({
  mutationFn: async (inscriptionId: string) => {
    const res = await fetch('/api/v1/admin/documents/convention/generer', {
      method: 'POST',
      body: JSON.stringify({ inscription_id: inscriptionId })
    });
    return res.json();
  }
});

// List documents
const { data: documents } = useQuery({
  queryKey: ['documents', { type: 'convention', page: 1 }],
  queryFn: async () => {
    const res = await fetch('/api/v1/admin/documents?type=convention&page=1');
    return res.json();
  }
});

// Get dashboard metrics
const { data: metrics } = useQuery({
  queryKey: ['dashboard', 'mois'],
  queryFn: async () => {
    const res = await fetch('/api/v1/admin/reporting/dashboard?periode=mois');
    return res.json();
  }
});
```

## Error Handling

All endpoints return standard error responses:

```typescript
// Error response format
{
  error: "Error message",
  code?: "ERROR_CODE",
  details?: { ... }
}

// Example: SIRET duplicate
{
  error: "Une entreprise avec ce SIRET existe déjà",
  code: "SIRET_DUPLICATE"
}

// Example: Document generation failed
{
  error: "Erreur lors de la génération du document",
  code: "PDF_GENERATION_FAILED",
  details: { inscription_id: "..." }
}
```

## Authentication

All admin endpoints require:
- Valid authentication token (JWT or session)
- Admin role verification
- Tenant context (from header or subdomain)

```typescript
// Headers required
{
  'Authorization': 'Bearer <token>',
  'X-Tenant': 'imhotepdata'
}
```

## Next Steps

1. Review the [data model](./data-model.md) for database schema details
2. Check [contracts](./contracts/) for full API schemas
3. See [plan.md](./plan.md) for implementation structure
4. Wait for [tasks.md](./tasks.md) for detailed implementation tasks

