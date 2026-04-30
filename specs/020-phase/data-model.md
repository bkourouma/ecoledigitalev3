# Data Model: Phase 6 - Gestion Administrative & Documents

**Date**: 2025-01-27  
**Feature**: Phase 6 - Gestion Administrative & Documents (`020-phase`)  
**Phase**: 1 - Design

## Overview

This document describes the data model for the administrative document management, enterprise client management, data exports, and reporting features. The database schema extends existing tables from previous phases and introduces new tables for document metadata tracking and export job management.

## New Entities

### 1. Document (Administrative Document)

**Table**: `documents`  
**Purpose**: Stores metadata for all generated administrative documents (conventions, attestations, quotes, invoices)

**Key Fields**:
- `id` (UUID, PK) - Primary key
- `tenant_id` (UUID, FK → tenants.id, NOT NULL) - Multi-tenant isolation
- `type` (document_type ENUM, NOT NULL) - Document type
- `numero` (VARCHAR(50), NOT NULL) - Unique document number (format: PREFIX-YYYY-NNNN)
- `inscription_id` (UUID, FK → inscriptions_professionnelles.id, nullable) - Related enrollment (for conventions, attestations)
- `session_id` (UUID, FK → sessions_professionnelles.id, nullable) - Related session (for attestations, quotes)
- `entreprise_id` (UUID, FK → entreprises_clientes.id, nullable) - Related enterprise (for grouped invoices)
- `fichier_url` (VARCHAR(500), NOT NULL) - File path in FileStorageService
- `date_generation` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW()) - Generation timestamp
- `genere_par` (UUID, FK → users.id, nullable) - User who generated (or 'system' for automatic)
- `metadata` (JSONB, nullable) - Additional document-specific data (client info for quotes, note for success certificates, validity date for quotes)
- `created_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())
- `updated_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())

**ENUM Type**: `document_type`
- `convention` - Training convention document
- `attestation_presence` - Attendance certificate
- `attestation_reussite` - Success certificate
- `devis` - Quote/estimate
- `facture` - Individual invoice
- `facture_groupee` - Grouped invoice for enterprise

**Validation Rules**:
- `numero` must be unique per tenant and type (enforced by UNIQUE constraint)
- At least one relationship must exist: `inscription_id`, `session_id`, or `entreprise_id` (enforced by CHECK constraint)
- `fichier_url` must be a valid path (enforced by application logic)
- `metadata` structure varies by type:
  - `devis`: `{ client: {...}, validite_jusqu_au: Date }`
  - `attestation_reussite`: `{ note: number }` (optional)
  - `facture_groupee`: `{ inscription_ids: UUID[], date_echeance: Date }`

**Relationships**:
- **Many-to-One**: `inscriptions_professionnelles` (inscription_id, optional) - Document related to enrollment
- **Many-to-One**: `sessions_professionnelles` (session_id, optional) - Document related to session
- **Many-to-One**: `entreprises_clientes` (entreprise_id, optional) - Document related to enterprise
- **Many-to-One**: `users` (genere_par, optional) - User who generated document

**Indexes**:
- `idx_documents_tenant_id` ON (tenant_id) - Tenant filtering
- `idx_documents_type` ON (tenant_id, type) - Type filtering
- `idx_documents_numero` ON (tenant_id, type, numero) - Number lookup and uniqueness
- `idx_documents_inscription_id` ON (inscription_id) - Enrollment lookup
- `idx_documents_session_id` ON (session_id) - Session lookup
- `idx_documents_entreprise_id` ON (entreprise_id) - Enterprise lookup
- `idx_documents_date_generation` ON (tenant_id, date_generation DESC) - Date filtering

**RLS Policy**: `tenant_id = current_setting('app.tenant_id', true)::UUID`

---

### 2. Export Job

**Table**: `export_jobs`  
**Purpose**: Tracks asynchronous export generation jobs for large datasets

**Key Fields**:
- `id` (UUID, PK) - Primary key
- `tenant_id` (UUID, FK → tenants.id, NOT NULL) - Multi-tenant isolation
- `type` (export_type ENUM, NOT NULL) - Export type
- `status` (job_status ENUM, DEFAULT 'pending') - Job status
- `fichier_url` (VARCHAR(500), nullable) - Generated file path (when completed)
- `progress` (INTEGER, DEFAULT 0) - Progress percentage (0-100)
- `total_items` (INTEGER, nullable) - Total items to process
- `processed_items` (INTEGER, DEFAULT 0) - Items processed so far
- `config` (JSONB, NOT NULL) - Export configuration (filters, columns, format, grouping)
- `error_message` (TEXT, nullable) - Error message if job failed
- `created_by` (UUID, FK → users.id, NOT NULL) - User who initiated export
- `created_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())
- `updated_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())
- `completed_at` (TIMESTAMP WITH TIME ZONE, nullable) - Completion timestamp

**ENUM Types**:
- `export_type`: 'inscriptions', 'paiements', 'presences', 'ca_formation', 'personnalise'
- `job_status`: 'pending', 'processing', 'completed', 'failed', 'cancelled'

**Validation Rules**:
- `progress` must be between 0 and 100 (enforced by CHECK constraint)
- `processed_items <= total_items` (enforced by CHECK constraint)
- `fichier_url` required when `status = 'completed'` (enforced by application logic)

**Relationships**:
- **Many-to-One**: `users` (created_by) - User who initiated export

**Indexes**:
- `idx_export_jobs_tenant_id` ON (tenant_id) - Tenant filtering
- `idx_export_jobs_status` ON (tenant_id, status) - Status filtering
- `idx_export_jobs_created_by` ON (created_by) - User lookup
- `idx_export_jobs_created_at` ON (tenant_id, created_at DESC) - Recent jobs

**RLS Policy**: `tenant_id = current_setting('app.tenant_id', true)::UUID`

---

## Extended Entities

### 3. Entreprise Cliente (Enterprise Client) - Extended

**Table**: `entreprises_clientes` (existing from Phase 1)  
**Purpose**: B2B client companies for enterprise training

**Existing Fields** (from Phase 1 migration):
- `id`, `tenant_id`, `raison_sociale`, `siret`, `forme_juridique`, `adresse`, `code_postal`, `ville`, `pays`, `contact_nom`, `contact_prenom`, `contact_email`, `contact_telephone`, `secteur_activite`, `nombre_employes`, `actif`, `notes`, `created_at`, `updated_at`

**New Fields** (if needed):
- None - existing schema sufficient

**Validation Rules** (enhanced):
- `siret` must be unique per tenant (enforced by UNIQUE constraint)
- `siret` format validation: exactly 14 digits (enforced by application logic)
- `actif` defaults to `true` for new enterprises

**Relationships**:
- **One-to-Many**: `inscriptions_professionnelles` (entreprise_id) - Enterprise has many enrollments
- **One-to-Many**: `documents` (entreprise_id) - Enterprise has many documents (grouped invoices)

**Derived/Computed Fields** (calculated on-demand):
- `nb_inscriptions`: Count of enrollments with `statut = 'confirmee'`
- `nb_apprenants`: Count of distinct `apprenant_id` in enrollments
- `ca_total`: Sum of `montant_ttc` from confirmed enrollments
- `formations_suivies`: Array of distinct formation titles from enrollments

---

## Derived/Computed Data

### Document Statistics (calculated on-demand)

**Purpose**: Aggregate statistics for document management dashboard

**Calculation**:
- Total documents by type: `SELECT type, COUNT(*) FROM documents WHERE tenant_id = $1 GROUP BY type`
- Documents generated today: `SELECT COUNT(*) FROM documents WHERE tenant_id = $1 AND date_generation >= CURRENT_DATE`
- Documents by session: `SELECT session_id, COUNT(*) FROM documents WHERE tenant_id = $1 AND session_id IS NOT NULL GROUP BY session_id`

### Enterprise Statistics (calculated on-demand)

**Purpose**: Aggregate statistics for enterprise detail pages

**Calculation**:
- `nb_inscriptions`: `SELECT COUNT(*) FROM inscriptions_professionnelles WHERE entreprise_id = $1 AND statut = 'confirmee'`
- `nb_apprenants`: `SELECT COUNT(DISTINCT apprenant_id) FROM inscriptions_professionnelles WHERE entreprise_id = $1 AND statut = 'confirmee'`
- `ca_total`: `SELECT SUM(montant_ttc) FROM inscriptions_professionnelles WHERE entreprise_id = $1 AND statut = 'confirmee'`
- `formations_suivies`: `SELECT DISTINCT f.titre FROM inscriptions_professionnelles i JOIN sessions_professionnelles s ON i.session_id = s.id JOIN formations_professionnelles f ON s.formation_pro_id = f.id WHERE i.entreprise_id = $1 AND i.statut = 'confirmee'`

### Reporting Metrics (calculated on-demand)

**Purpose**: Dashboard and reporting metrics

**Calculation**:
- Enrollment counts: `SELECT COUNT(*) FROM inscriptions_professionnelles WHERE tenant_id = $1 AND date_inscription BETWEEN $2 AND $3`
- Revenue totals: `SELECT SUM(montant_ttc) FROM inscriptions_professionnelles WHERE tenant_id = $1 AND statut = 'confirmee' AND date_inscription BETWEEN $2 AND $3`
- Session fill rate: `SELECT AVG(places_reservees::float / places_totales * 100) FROM sessions_professionnelles WHERE tenant_id = $1 AND date_debut BETWEEN $2 AND $3`
- Top formations: `SELECT f.titre, COUNT(*) as nb FROM inscriptions_professionnelles i JOIN sessions_professionnelles s ON i.session_id = s.id JOIN formations_professionnelles f ON s.formation_pro_id = f.id WHERE i.tenant_id = $1 AND i.date_inscription BETWEEN $2 AND $3 GROUP BY f.titre ORDER BY nb DESC LIMIT 5`
- Top enterprises: `SELECT e.raison_sociale, SUM(i.montant_ttc) as ca FROM inscriptions_professionnelles i JOIN entreprises_clientes e ON i.entreprise_id = e.id WHERE i.tenant_id = $1 AND i.date_inscription BETWEEN $2 AND $3 AND i.statut = 'confirmee' GROUP BY e.id, e.raison_sociale ORDER BY ca DESC LIMIT 5`

---

## State Transitions

### Document Generation Flow

1. **Request received** → Validate input (enrollment/session exists, permissions)
2. **Check existing** → Query for existing document of same type for enrollment/session
3. **Generate number** → Query existing documents with same prefix, calculate next number
4. **Generate PDF** → Call PDF generation service, save to FileStorageService
5. **Save metadata** → Insert record in `documents` table with file URL
6. **Return result** → Return document URL and metadata to client

### Export Job Flow

1. **Job created** → Insert record in `export_jobs` with status 'pending'
2. **Job processing** → Update status to 'processing', set `total_items`
3. **Progress updates** → Update `processed_items` and `progress` as items are processed
4. **Job completion** → Update status to 'completed', set `fichier_url`, set `completed_at`
5. **Job failure** → Update status to 'failed', set `error_message`

---

## Database Migration

**Migration File**: `infra/scripts/migrations/0040_documents_export_jobs.sql`

**Changes**:
1. Create `document_type` ENUM
2. Create `documents` table with all fields, constraints, indexes, RLS
3. Create `export_type` and `job_status` ENUMs
4. Create `export_jobs` table with all fields, constraints, indexes, RLS
5. Add any missing indexes to `entreprises_clientes` if needed

**Rollback**: Drop tables and ENUMs in reverse order

---

## Data Integrity

### Foreign Key Constraints
- `documents.inscription_id` → `inscriptions_professionnelles.id` (ON DELETE SET NULL)
- `documents.session_id` → `sessions_professionnelles.id` (ON DELETE SET NULL)
- `documents.entreprise_id` → `entreprises_clientes.id` (ON DELETE SET NULL)
- `export_jobs.created_by` → `users.id` (ON DELETE RESTRICT)

### Check Constraints
- `documents`: At least one of `inscription_id`, `session_id`, or `entreprise_id` must be NOT NULL
- `export_jobs`: `progress` BETWEEN 0 AND 100
- `export_jobs`: `processed_items <= total_items` OR `total_items IS NULL`

### Unique Constraints
- `documents`: UNIQUE(tenant_id, type, numero) - Ensures document numbers are unique per type
- `entreprises_clientes`: UNIQUE(tenant_id, siret) - Ensures SIRET uniqueness per tenant (existing)

---

## Notes

- Document files are stored in FileStorageService, not in database
- Document metadata in database enables efficient querying and filtering
- Export jobs are temporary - completed jobs can be cleaned up after 7 days
- All statistics are calculated on-demand for accuracy (no pre-calculated aggregates)
- RLS policies ensure complete tenant isolation for all new tables

