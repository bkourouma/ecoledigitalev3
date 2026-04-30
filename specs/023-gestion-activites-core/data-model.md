# Data Model: Phase 3 - Gestion des Activités (CORE)

**Date**: 2025-11-30  
**Feature**: Phase 3 - Gestion des Activités (CORE)  
**Branch**: `023-gestion-activites-core`

## Overview

This document defines the database schema for the activity management system, including activities, activity types, recommendations, permissions, and media attachments. All tables are tenant-scoped (ASPCI tenant) and use Row Level Security (RLS) for data isolation.

---

## Entity Relationship Diagram

```
rso_annees (Phase 2)
    │
    │ 1:N
    ▼
rso_activites ──┐
    │            │
    │ N:1        │ N:1
    │            │
    ▼            ▼
rso_installations  rso_types_activites
    │ (Phase 2)      │
    │                │ 1:N (self-referential)
    │                ▼
    │          rso_types_activites (parent)
    │
    │ N:1
    ▼
rso_users (Phase 1)
    │
    │ N:1 (created_by, valide_par, updated_by)
    │
    ▼
rso_activites
    │
    │ 1:N
    ├──► rso_recommandations
    ├──► rso_activites_pfso_access
    └──► rso_activites_medias
```

---

## Tables

### 1. rso_activites

**Purpose**: Stores security activity reports, exercises, training, audits, and evaluations created by formateurs RSO.

**Columns**:

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INT | PRIMARY KEY, AUTO_INCREMENT | Unique identifier |
| `code_activite` | VARCHAR(50) | UNIQUE, NOT NULL | Auto-generated code: ACT-YYYY-CODE_INSTALLATION-TYPE-SOUS_TYPE-NNNN |
| `titre` | VARCHAR(255) | NOT NULL | Activity title (min 10 characters) |
| `annee_id` | INT | NOT NULL, FK → rso_annees(id) | Year reference (from Phase 2) |
| `installation_id` | INT | NOT NULL, FK → rso_installations(id) | Installation reference (from Phase 2) |
| `type_activite` | VARCHAR(50) | NOT NULL, FK → rso_types_activites(code) | Activity type code |
| `sous_type` | VARCHAR(50) | NULL | Sub-type code (e.g., T1, T2, T3, T4 for trimesters) |
| `contenu_html` | LONGTEXT | NOT NULL | Rich HTML content from editor (sanitized) |
| `contenu_texte` | TEXT | NULL | Plain text version for full-text search |
| `date_activite` | DATE | NOT NULL | Activity date (must be within selected year) |
| `duree_minutes` | INT | NULL, CHECK (duree_minutes > 0) | Duration in minutes |
| `lieu` | VARCHAR(255) | NULL | Location of activity |
| `nombre_participants` | INT | NULL, CHECK (nombre_participants >= 0) | Number of participants |
| `lien_visio` | VARCHAR(500) | NULL | Video conference link (URL format) |
| `plateforme_visio` | ENUM | NULL | Platform: 'zoom', 'teams', 'meet', 'autre' |
| `statut` | ENUM | NOT NULL, DEFAULT 'brouillon' | Status: 'brouillon', 'en_cours', 'termine', 'valide', 'archive' |
| `date_validation` | DATETIME | NULL | Validation timestamp |
| `valide_par` | INT | NULL, FK → rso_users(id) | User who validated (admin only) |
| `visible_tous_pfso` | BOOLEAN | NOT NULL, DEFAULT FALSE | Visible to all PFSO agents of installation |
| `created_by` | INT | NOT NULL, FK → rso_users(id) | Creator (formateur RSO) |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT CURRENT_TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | NOT NULL, DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP | Last update timestamp |
| `updated_by` | INT | NULL, FK → rso_users(id) | Last updater |
| `deleted_at` | TIMESTAMP | NULL | Soft delete timestamp |

**Indexes**:
- PRIMARY KEY: `id`
- UNIQUE: `code_activite`
- INDEX: `idx_type_activite` on (`type_activite`, `sous_type`)
- INDEX: `idx_date` on (`date_activite`)
- INDEX: `idx_installation` on (`installation_id`)
- INDEX: `idx_annee` on (`annee_id`)
- INDEX: `idx_statut` on (`statut`)
- FULLTEXT: `idx_recherche` on (`titre`, `contenu_texte`) using GIN

**Validation Rules**:
- `titre` must be at least 10 characters
- `date_activite` must be within the year specified by `annee_id`
- `duree_minutes` must be positive if provided
- `nombre_participants` must be non-negative if provided
- `lien_visio` must be valid URL if `plateforme_visio` is set
- `code_activite` must be unique across all activities
- `contenu_html` must be sanitized before storage (XSS prevention)

**State Transitions**:
- `brouillon` → `en_cours` (formateur RSO)
- `en_cours` → `termine` (formateur RSO)
- `termine` → `valide` (admin only)
- Any → `archive` (admin only)

**RLS Policy**:
- All queries must filter by `tenant_id = 'aspci'`
- Formateurs RSO can only see their own activities (unless admin)
- PFSO agents can only see activities with permission (visible_tous_pfso OR individual permission)

---

### 2. rso_types_activites

**Purpose**: Hierarchical classification of activity types according to ISPS code.

**Columns**:

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INT | PRIMARY KEY, AUTO_INCREMENT | Unique identifier |
| `code` | VARCHAR(50) | UNIQUE, NOT NULL | Type code (e.g., 'ENTRAINEMENT', 'ENTRAINEMENT_T1') |
| `libelle` | VARCHAR(100) | NOT NULL | Display label |
| `description` | TEXT | NULL | Type description |
| `parent_id` | INT | NULL, FK → rso_types_activites(id) | Parent type (for hierarchy) |
| `ordre` | INT | NOT NULL, DEFAULT 0 | Display order |
| `icone` | VARCHAR(50) | NULL | Icon identifier (emoji or CSS class) |
| `couleur` | VARCHAR(7) | NULL | Hex color code |
| `actif` | BOOLEAN | NOT NULL, DEFAULT TRUE | Active status |

**Indexes**:
- PRIMARY KEY: `id`
- UNIQUE: `code`
- INDEX: `idx_parent` on (`parent_id`)
- INDEX: `idx_ordre` on (`ordre`)

**Validation Rules**:
- `code` must be unique
- `parent_id` must reference existing type (or NULL for root types)
- Circular references in hierarchy are prevented by application logic
- `ordre` determines display order within same parent level

**Hierarchy Structure**:
```
Root Types:
├── CARTOGRAPHIE (no sub-types)
├── ENTRAINEMENT
│   ├── ENTRAINEMENT_T1 (Trimestre 1)
│   ├── ENTRAINEMENT_T2 (Trimestre 2)
│   ├── ENTRAINEMENT_T3 (Trimestre 3)
│   └── ENTRAINEMENT_T4 (Trimestre 4)
├── EXERCICE_ANNUEL
│   ├── EXERCICE_SEMINAIRE
│   ├── EXERCICE_SUR_TABLE
│   └── EXERCICE_GRANDEUR_NATURE
├── FORMATION_SURETE (no sub-types)
├── AUDIT_SURETE
│   ├── AUDIT_SEMESTRE_1
│   └── AUDIT_SEMESTRE_2
└── EVALUATION_SURETE (no sub-types)
```

**RLS Policy**:
- All queries must filter by `tenant_id = 'aspci'`
- Activity types are shared across all users (no user-specific filtering)

---

### 3. rso_recommandations

**Purpose**: Tracks improvement points identified during activities, with assignment, status tracking, and resolution.

**Columns**:

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INT | PRIMARY KEY, AUTO_INCREMENT | Unique identifier |
| `activite_id` | INT | NOT NULL, FK → rso_activites(id) ON DELETE CASCADE | Related activity |
| `titre` | VARCHAR(255) | NOT NULL | Recommendation title (min 10 characters) |
| `description` | TEXT | NOT NULL | Detailed description (min 150 characters) |
| `priorite` | ENUM | NOT NULL, DEFAULT 'moyenne' | Priority: 'basse', 'moyenne', 'haute', 'critique' |
| `statut` | ENUM | NOT NULL, DEFAULT 'en_attente' | Status: 'en_attente', 'en_cours', 'terminee', 'validee', 'annulee' |
| `date_echeance` | DATE | NULL | Due date |
| `responsable_id` | INT | NULL, FK → rso_users(id) | Assigned responsible person |
| `date_resolution` | DATE | NULL | Resolution date |
| `actions_prises` | TEXT | NULL | Actions taken (required when status = 'terminee') |
| `resolu_par` | INT | NULL, FK → rso_users(id) | User who marked as resolved |
| `created_by` | INT | NOT NULL, FK → rso_users(id) | Creator (formateur RSO) |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT CURRENT_TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | NOT NULL, DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP | Last update timestamp |

**Indexes**:
- PRIMARY KEY: `id`
- INDEX: `idx_activite` on (`activite_id`)
- INDEX: `idx_statut` on (`statut`)
- INDEX: `idx_priorite` on (`priorite`)
- INDEX: `idx_responsable` on (`responsable_id`)
- INDEX: `idx_date_echeance` on (`date_echeance`)

**Validation Rules**:
- `titre` must be at least 10 characters
- `description` must be at least 150 characters
- `date_echeance` can be in the past (with warning)
- `actions_prises` required when `statut = 'terminee'`
- `date_resolution` required when `statut = 'terminee'`

**State Transitions**:
- `en_attente` → `en_cours` (by responsable)
- `en_cours` → `terminee` (by responsable, requires `actions_prises` and `date_resolution`)
- `terminee` → `validee` (by formateur RSO or admin)
- Any → `annulee` (by formateur RSO or admin)

**Overdue Calculation**:
- Overdue if: `date_echeance < CURRENT_DATE AND statut IN ('en_attente', 'en_cours')`
- Days overdue: `CURRENT_DATE - date_echeance`

**RLS Policy**:
- All queries must filter by `tenant_id = 'aspci'`
- Users can only see recommendations for activities they have access to

---

### 4. rso_activites_pfso_access

**Purpose**: Junction table for individual PFSO agent permissions to view specific activities.

**Columns**:

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INT | PRIMARY KEY, AUTO_INCREMENT | Unique identifier |
| `activite_id` | INT | NOT NULL, FK → rso_activites(id) ON DELETE CASCADE | Activity reference |
| `user_id` | INT | NOT NULL, FK → rso_users(id) | PFSO agent user ID |
| `granted_by` | INT | NOT NULL, FK → rso_users(id) | RSO who granted access |
| `granted_at` | TIMESTAMP | NOT NULL, DEFAULT CURRENT_TIMESTAMP | Permission grant timestamp |

**Indexes**:
- PRIMARY KEY: `id`
- UNIQUE: `unique_access` on (`activite_id`, `user_id`)
- INDEX: `idx_activite` on (`activite_id`)
- INDEX: `idx_user` on (`user_id`)

**Validation Rules**:
- `user_id` must be a PFSO agent (role = 'pfso')
- `granted_by` must be a formateur RSO or admin
- Unique constraint prevents duplicate permissions

**RLS Policy**:
- All queries must filter by `tenant_id = 'aspci'`
- Users can only see permissions for activities they have access to

---

### 5. rso_activites_medias

**Purpose**: Stores media files (images, videos, documents) attached to activities. Prepared for Phase 4 full media management.

**Columns**:

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INT | PRIMARY KEY, AUTO_INCREMENT | Unique identifier |
| `activite_id` | INT | NOT NULL, FK → rso_activites(id) ON DELETE CASCADE | Activity reference |
| `type_media` | ENUM | NOT NULL | Type: 'image', 'video', 'document' |
| `nom_fichier` | VARCHAR(255) | NOT NULL | Original filename |
| `chemin_fichier` | VARCHAR(500) | NOT NULL | Storage path |
| `taille_octets` | BIGINT | NOT NULL | File size in bytes |
| `mime_type` | VARCHAR(100) | NOT NULL | MIME type |
| `legende` | TEXT | NULL | Caption/description |
| `ordre` | INT | NOT NULL, DEFAULT 0 | Display order |
| `uploaded_by` | INT | NOT NULL, FK → rso_users(id) | Uploader |
| `uploaded_at` | TIMESTAMP | NOT NULL, DEFAULT CURRENT_TIMESTAMP | Upload timestamp |

**Indexes**:
- PRIMARY KEY: `id`
- INDEX: `idx_activite` on (`activite_id`)
- INDEX: `idx_type` on (`type_media`)
- INDEX: `idx_ordre` on (`ordre`)

**Validation Rules**:
- `taille_octets` must be positive
- `mime_type` must be valid MIME type
- `chemin_fichier` must be within tenant-specific directory structure
- Images: max 5MB, types: jpg, jpeg, png, gif, webp

**RLS Policy**:
- All queries must filter by `tenant_id = 'aspci'`
- Users can only see media for activities they have access to

---

## Relationships

### Activity → Year (N:1)
- Each activity belongs to one year
- Foreign key: `rso_activites.annee_id` → `rso_annees.id`
- Cascade: Prevent deletion of year if activities exist (application-level check)

### Activity → Installation (N:1)
- Each activity belongs to one installation
- Foreign key: `rso_activites.installation_id` → `rso_installations.id`
- Cascade: Prevent deletion of installation if activities exist (soft delete installation instead)

### Activity → Activity Type (N:1)
- Each activity has one type
- Foreign key: `rso_activites.type_activite` → `rso_types_activites.code`
- Sub-type stored in `sous_type` column (references same table)

### Activity Type → Parent Type (N:1, self-referential)
- Activity types form a hierarchy
- Foreign key: `rso_types_activites.parent_id` → `rso_types_activites.id`
- Root types have `parent_id = NULL`

### Activity → Creator (N:1)
- Each activity created by one user
- Foreign key: `rso_activites.created_by` → `rso_users.id`
- User must be formateur RSO or admin

### Activity → Validator (N:1, optional)
- Activities can be validated by admin
- Foreign key: `rso_activites.valide_par` → `rso_users.id`
- Only admin can validate

### Activity → Recommendations (1:N)
- Each activity can have multiple recommendations
- Foreign key: `rso_recommandations.activite_id` → `rso_activites.id`
- Cascade delete: Recommendations deleted when activity deleted

### Activity → PFSO Access Permissions (1:N)
- Each activity can have multiple PFSO agent permissions
- Foreign key: `rso_activites_pfso_access.activite_id` → `rso_activites.id`
- Cascade delete: Permissions deleted when activity deleted

### Activity → Media Files (1:N)
- Each activity can have multiple media files
- Foreign key: `rso_activites_medias.activite_id` → `rso_activites.id`
- Cascade delete: Media deleted when activity deleted

### Recommendation → Responsible (N:1, optional)
- Each recommendation can be assigned to one user
- Foreign key: `rso_recommandations.responsable_id` → `rso_users.id`
- User can be PFSO agent or formateur RSO

---

## Data Integrity Rules

1. **Activity Code Uniqueness**: `code_activite` must be unique across all activities
2. **Date Validation**: `date_activite` must be within the year specified by `annee_id`
3. **Sub-type Requirement**: If activity type has sub-types, `sous_type` must be provided
4. **Video Conference Link**: If `plateforme_visio` is set, `lien_visio` must be provided and valid URL
5. **Permission Logic**: Either `visible_tous_pfso = true` OR at least one individual permission in `rso_activites_pfso_access`
6. **Recommendation Resolution**: When `statut = 'terminee'`, `actions_prises` and `date_resolution` must be provided
7. **Soft Delete**: Activities with `deleted_at IS NOT NULL` are hidden from main queries but preserved for audit

---

## Migration Strategy

1. **Create Tables**: Create all 5 new tables with indexes and foreign keys
2. **Seed Activity Types**: Insert 6 root types and 10 sub-types with hierarchy
3. **Add RLS Policies**: Configure Row Level Security for all tables (tenant_id = 'aspci')
4. **Create Full-Text Index**: Create GIN index on `rso_activites` for search
5. **Data Migration**: No existing data to migrate (new feature)

---

## Performance Considerations

1. **Full-Text Search**: GIN index on `titre` and `contenu_texte` enables fast searches
2. **Permission Queries**: Index on `visible_tous_pfso` and junction table indexes optimize permission checks
3. **Activity List**: Indexes on `installation_id`, `annee_id`, `statut`, `type_activite` optimize filtering
4. **Recommendation Queries**: Indexes on `statut`, `priorite`, `date_echeance` optimize tracking queries
5. **Cascade Deletes**: Foreign key constraints with CASCADE ensure data consistency

---

## Security Considerations

1. **RLS Enforcement**: All tables enforce tenant isolation via RLS policies
2. **HTML Sanitization**: `contenu_html` sanitized before storage (XSS prevention)
3. **Permission Enforcement**: Permission checks at database query level, not just UI
4. **Soft Delete**: Deleted activities preserved for audit but hidden from normal queries
5. **Audit Trail**: `created_by`, `updated_by`, `granted_by` track all user actions

