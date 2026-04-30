# Data Model: Phase 6 - Gestion des Incidents

**Feature**: Phase 6 - Gestion des Incidents  
**Date**: 2025-01-27  
**Status**: Complete

## Overview

Phase 6 extends the RSO-PFSO module with comprehensive incident management system. All tables maintain tenant isolation through Row Level Security (RLS) and follow the same patterns established in Phases 1-5. The incident management system supports the complete workflow from detection to closure, with evidence management, measure tracking, and comprehensive audit trails.

## Database Schema

### Table: `rso_incidents`

**Purpose**: Stores security incidents in port facilities. Each incident represents a security event that requires tracking, investigation, and resolution. Incidents follow a strict workflow from creation to closure.

**Schema**:
```sql
CREATE TABLE rso_incidents (
    id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Identification
    code_incident VARCHAR(50) NOT NULL,
    titre VARCHAR(255) NOT NULL,
    
    -- Relations
    installation_id INT NOT NULL REFERENCES rso_installations(id) ON DELETE RESTRICT,
    annee_id INT NOT NULL REFERENCES rso_annees(id) ON DELETE RESTRICT,
    
    -- Classification
    type_incident VARCHAR(50) NOT NULL CHECK (type_incident IN (
        'intrusion', 
        'vol', 
        'vandalisme', 
        'incendie',
        'accident',
        'acces_non_autorise',
        'falsification_documents',
        'equipement_defectueux',
        'violation_procedure',
        'cyber_incident',
        'autre'
    )),
    
    categorie VARCHAR(20) NOT NULL DEFAULT 'modere' CHECK (categorie IN ('mineur', 'modere', 'grave', 'critique')),
    niveau_urgence VARCHAR(20) NOT NULL DEFAULT 'moyen' CHECK (niveau_urgence IN ('bas', 'moyen', 'eleve', 'critique')),
    
    -- Localisation et temporalité
    zone_incident VARCHAR(255) NOT NULL,
    date_incident TIMESTAMP WITH TIME ZONE NOT NULL,
    date_decouverte TIMESTAMP WITH TIME ZONE NULL,
    
    -- Description
    description_courte TEXT NOT NULL,
    description_detaillee LONGTEXT NOT NULL,
    circonstances TEXT NULL,
    
    -- Personnes impliquées (JSON)
    temoins JSONB NULL, -- Array of {nom, fonction, telephone, email}
    suspects JSONB NULL, -- Array of {description, identite?, identifie: boolean}
    victimes JSONB NULL, -- Array of {nom, blessures?, telephone?, email?}
    
    -- Impact
    impact_materiel TEXT NULL,
    impact_operationnel TEXT NULL,
    impact_humain TEXT NULL,
    cout_estime DECIMAL(12,2) NULL,
    
    -- Statut et traitement
    statut VARCHAR(30) NOT NULL DEFAULT 'nouveau' CHECK (statut IN (
        'nouveau',
        'en_investigation',
        'en_traitement',
        'resolu',
        'clos',
        'archive'
    )),
    
    priorite VARCHAR(10) NOT NULL DEFAULT 'P3' CHECK (priorite IN ('P1', 'P2', 'P3', 'P4')),
    
    -- Responsables
    declare_par INT NOT NULL REFERENCES rso_users(id) ON DELETE RESTRICT,
    assigne_a INT NULL REFERENCES rso_users(id) ON DELETE SET NULL,
    valide_par INT NULL REFERENCES rso_users(id) ON DELETE SET NULL,
    
    -- Dates de suivi
    date_prise_en_charge TIMESTAMP WITH TIME ZONE NULL,
    date_resolution TIMESTAMP WITH TIME ZONE NULL,
    date_validation TIMESTAMP WITH TIME ZONE NULL,
    date_cloture TIMESTAMP WITH TIME ZONE NULL,
    
    -- Mesures prises
    mesures_immediates TEXT NULL,
    mesures_correctives TEXT NULL,
    mesures_preventives TEXT NULL,
    
    -- Conformité code ISPS
    conforme_isps BOOLEAN NOT NULL DEFAULT TRUE,
    raison_non_conformite TEXT NULL,
    
    -- Confidentialité
    niveau_confidentialite VARCHAR(20) NOT NULL DEFAULT 'restreint' CHECK (niveau_confidentialite IN ('public', 'restreint', 'confidentiel', 'secret')),
    
    -- Métadonnées
    tags JSONB NULL,
    donnees_supplementaires JSONB NULL,
    
    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE NULL,
    
    CONSTRAINT rso_incidents_code_unique UNIQUE (code_incident),
    CONSTRAINT rso_incidents_tenant_code_unique UNIQUE (tenant_id, code_incident),
    CONSTRAINT rso_incidents_code_format CHECK (
        code_incident ~ '^INC-[0-9]{4}-[A-Z0-9_]+-[0-9]+$'
    ),
    CONSTRAINT rso_incidents_titre_length CHECK (
        LENGTH(TRIM(titre)) >= 5 AND LENGTH(TRIM(titre)) <= 255
    ),
    CONSTRAINT rso_incidents_description_courte_length CHECK (
        LENGTH(TRIM(description_courte)) >= 20
    ),
    CONSTRAINT rso_incidents_date_incident_not_future CHECK (
        date_incident <= CURRENT_TIMESTAMP + INTERVAL '1 day'
    ),
    CONSTRAINT rso_incidents_date_decouverte_after_incident CHECK (
        date_decouverte IS NULL OR date_decouverte >= date_incident
    )
);

-- Indexes
CREATE INDEX idx_rso_incidents_tenant_id ON rso_incidents(tenant_id);
CREATE INDEX idx_rso_incidents_code ON rso_incidents(code_incident);
CREATE INDEX idx_rso_incidents_installation ON rso_incidents(installation_id);
CREATE INDEX idx_rso_incidents_annee ON rso_incidents(annee_id);
CREATE INDEX idx_rso_incidents_type ON rso_incidents(type_incident);
CREATE INDEX idx_rso_incidents_statut ON rso_incidents(statut);
CREATE INDEX idx_rso_incidents_date ON rso_incidents(date_incident);
CREATE INDEX idx_rso_incidents_urgence ON rso_incidents(niveau_urgence);
CREATE INDEX idx_rso_incidents_categorie ON rso_incidents(categorie);
CREATE INDEX idx_rso_incidents_priorite ON rso_incidents(priorite);
CREATE INDEX idx_rso_incidents_declare_par ON rso_incidents(declare_par);
CREATE INDEX idx_rso_incidents_assigne_a ON rso_incidents(assigne_a);
CREATE INDEX idx_rso_incidents_deleted_at ON rso_incidents(deleted_at) WHERE deleted_at IS NULL;

-- Full-text search index
CREATE INDEX idx_rso_incidents_recherche ON rso_incidents USING GIN(
    to_tsvector('french', 
        COALESCE(titre, '') || ' ' || 
        COALESCE(description_courte, '') || ' ' || 
        COALESCE(description_detaillee, '')
    )
);

-- Composite indexes for common queries
CREATE INDEX idx_rso_incidents_installation_statut ON rso_incidents(installation_id, statut);
CREATE INDEX idx_rso_incidents_statut_urgence ON rso_incidents(statut, niveau_urgence);
CREATE INDEX idx_rso_incidents_date_statut ON rso_incidents(date_incident DESC, statut);
```

**Field Descriptions**:
- `id`: Primary key, auto-incrementing integer
- `tenant_id`: Foreign key to `tenants` table (ASPCI tenant only for RSO module)
- `code_incident`: Unique incident code (format: INC-YYYY-CODE_INSTALLATION-XXX)
- `titre`: Incident title (5-255 characters, required)
- `installation_id`: Foreign key to `rso_installations` (where incident occurred)
- `annee_id`: Foreign key to `rso_annees` (year for filtering/organization)
- `type_incident`: Type of incident (11 predefined types)
- `categorie`: Severity category (mineur, modere, grave, critique)
- `niveau_urgence`: Urgency level (bas, moyen, eleve, critique)
- `zone_incident`: Location/zone where incident occurred
- `date_incident`: Date and time when incident occurred
- `date_decouverte`: Date and time when incident was discovered (if different)
- `description_courte`: Short description (minimum 20 characters)
- `description_detaillee`: Detailed description (required)
- `circonstances`: Circumstances surrounding the incident
- `temoins`: JSON array of witnesses with contact information
- `suspects`: JSON array of suspects with descriptions
- `victimes`: JSON array of victims with information
- `impact_materiel`: Material impact description
- `impact_operationnel`: Operational impact description
- `impact_humain`: Human impact description
- `cout_estime`: Estimated cost in FCFA
- `statut`: Current status in workflow (nouveau → en_investigation → en_traitement → resolu → clos → archive)
- `priorite`: Priority level (P1 = highest, P4 = lowest)
- `declare_par`: Foreign key to `rso_users` (agent who created the incident)
- `assigne_a`: Foreign key to `rso_users` (responsible person assigned)
- `valide_par`: Foreign key to `rso_users` (RSO who validated)
- `date_prise_en_charge`: When incident was taken in charge
- `date_resolution`: When incident was resolved
- `date_validation`: When incident was validated
- `date_cloture`: When incident was closed
- `mesures_immediates`: Immediate measures taken
- `mesures_correctives`: Corrective measures
- `mesures_preventives`: Preventive measures
- `conforme_isps`: ISPS code compliance flag
- `raison_non_conformite`: Reason for non-compliance if applicable
- `niveau_confidentialite`: Confidentiality level
- `tags`: JSON array of tags for categorization
- `donnees_supplementaires`: JSON for additional flexible data
- `created_at`: Creation timestamp
- `updated_at`: Last update timestamp (auto-updated via trigger)
- `deleted_at`: Soft delete timestamp (NULL = active, NOT NULL = archived)

**Validation Rules**:
- Code: Format INC-YYYY-CODE_INSTALLATION-XXX, unique across system
- Title: 5-255 characters, trimmed, non-empty
- Description courte: Minimum 20 characters
- Date incident: Cannot be in the future (allows 1 day tolerance for timezone)
- Date decouverte: Must be after or equal to date_incident
- Type: Must be one of 11 allowed types
- Categorie: Must be one of 4 allowed categories
- Niveau urgence: Must be one of 4 allowed levels
- Statut: Must follow workflow progression
- Priorite: Must be P1, P2, P3, or P4

**State Transitions**:
- `statut`: 'nouveau' → 'en_investigation' → 'en_traitement' → 'resolu' → 'clos' → 'archive'
  - Cannot skip statuses
  - Can move backwards in some cases (e.g., resolu → en_traitement if issues found)
  - 'archive' is final state (after 2 years from closure)

**Full-Text Search**:
- GIN index on `titre`, `description_courte`, and `description_detaillee`
- Uses French language for text search optimization
- Supports keyword searches across all description fields

---

### Table: `rso_incidents_medias`

**Purpose**: Stores evidence files (photos, videos, documents) attached to incidents. Files are stored in MinIO/S3 with metadata in the database.

**Schema**:
```sql
CREATE TABLE rso_incidents_medias (
    id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    incident_id INT NOT NULL REFERENCES rso_incidents(id) ON DELETE CASCADE,
    
    type_media VARCHAR(20) NOT NULL CHECK (type_media IN ('image', 'video', 'audio', 'document')),
    nom_fichier VARCHAR(255) NOT NULL,
    nom_original VARCHAR(255) NOT NULL,
    chemin_fichier VARCHAR(500) NOT NULL,
    chemin_thumbnail VARCHAR(500) NULL,
    
    taille_octets BIGINT NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    
    description TEXT NULL,
    est_preuve BOOLEAN NOT NULL DEFAULT FALSE,
    ordre INT NOT NULL DEFAULT 0,
    
    uploaded_by INT NOT NULL REFERENCES rso_users(id) ON DELETE RESTRICT,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    
    CONSTRAINT rso_incidents_medias_taille_check CHECK (taille_octets > 0 AND taille_octets <= 104857600), -- 100 MB max
    CONSTRAINT rso_incidents_medias_mime_type_check CHECK (
        mime_type IN (
            'image/jpeg', 'image/png', 'image/jpg',
            'video/mp4', 'video/quicktime',
            'audio/mpeg', 'audio/wav',
            'application/pdf'
        )
    )
);

-- Indexes
CREATE INDEX idx_rso_incidents_medias_tenant_id ON rso_incidents_medias(tenant_id);
CREATE INDEX idx_rso_incidents_medias_incident ON rso_incidents_medias(incident_id);
CREATE INDEX idx_rso_incidents_medias_type ON rso_incidents_medias(type_media);
CREATE INDEX idx_rso_incidents_medias_uploaded_by ON rso_incidents_medias(uploaded_by);
CREATE INDEX idx_rso_incidents_medias_ordre ON rso_incidents_medias(incident_id, ordre);
```

**Field Descriptions**:
- `id`: Primary key, auto-incrementing integer
- `tenant_id`: Foreign key to `tenants` table
- `incident_id`: Foreign key to `rso_incidents` (cascade delete)
- `type_media`: Type of media (image, video, audio, document)
- `nom_fichier`: Stored filename (UUID-based for uniqueness)
- `nom_original`: Original filename from upload
- `chemin_fichier`: Full path in MinIO/S3 storage
- `chemin_thumbnail`: Path to thumbnail (for images)
- `taille_octets`: File size in bytes (max 100 MB)
- `mime_type`: MIME type of file (validated against allowed types)
- `description`: Optional description of the media
- `est_preuve`: Flag indicating if this is evidence (for PDF reports)
- `ordre`: Display order for media gallery
- `uploaded_by`: Foreign key to `rso_users` (who uploaded)
- `uploaded_at`: Upload timestamp

**Validation Rules**:
- File size: Maximum 100 MB (104857600 bytes)
- MIME types: Only allowed types (JPG, PNG, MP4, PDF, etc.)
- Thumbnail: Required for images, optional for other types

**Storage Path Structure**:
- Original: `rso/incidents/{incident_id}/medias/{media_id}/original/{filename}`
- Thumbnail: `rso/incidents/{incident_id}/medias/{media_id}/thumbnail/{filename}`

---

### Table: `rso_incidents_historique`

**Purpose**: Maintains complete audit trail of all actions performed on incidents. Every status change, assignment, comment, or measure is logged here.

**Schema**:
```sql
CREATE TABLE rso_incidents_historique (
    id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    incident_id INT NOT NULL REFERENCES rso_incidents(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES rso_users(id) ON DELETE RESTRICT,
    
    action VARCHAR(50) NOT NULL CHECK (action IN (
        'creation',
        'modification',
        'changement_statut',
        'assignation',
        'ajout_media',
        'ajout_commentaire',
        'mesure_prise',
        'validation',
        'cloture'
    )),
    
    ancien_statut VARCHAR(30) NULL,
    nouveau_statut VARCHAR(30) NULL,
    
    commentaire TEXT NULL,
    donnees_modifiees JSONB NULL,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    
    CONSTRAINT rso_incidents_historique_statut_transition CHECK (
        (action = 'changement_statut' AND ancien_statut IS NOT NULL AND nouveau_statut IS NOT NULL)
        OR (action != 'changement_statut')
    )
);

-- Indexes
CREATE INDEX idx_rso_incidents_historique_tenant_id ON rso_incidents_historique(tenant_id);
CREATE INDEX idx_rso_incidents_historique_incident ON rso_incidents_historique(incident_id);
CREATE INDEX idx_rso_incidents_historique_action ON rso_incidents_historique(action);
CREATE INDEX idx_rso_incidents_historique_user ON rso_incidents_historique(user_id);
CREATE INDEX idx_rso_incidents_historique_created_at ON rso_incidents_historique(created_at DESC);
CREATE INDEX idx_rso_incidents_historique_incident_created ON rso_incidents_historique(incident_id, created_at DESC);
```

**Field Descriptions**:
- `id`: Primary key, auto-incrementing integer
- `tenant_id`: Foreign key to `tenants` table
- `incident_id`: Foreign key to `rso_incidents` (cascade delete)
- `user_id`: Foreign key to `rso_users` (who performed the action)
- `action`: Type of action performed
- `ancien_statut`: Previous status (for status changes)
- `nouveau_statut`: New status (for status changes)
- `commentaire`: Optional comment about the action
- `donnees_modifiees`: JSON object with details of what was modified
- `created_at`: Timestamp of the action

**Action Types**:
- `creation`: Incident was created
- `modification`: Incident details were modified
- `changement_statut`: Status was changed
- `assignation`: Incident was assigned to a responsible person
- `ajout_media`: Evidence file was added
- `ajout_commentaire`: Comment was added
- `mesure_prise`: Measure was added or updated
- `validation`: Incident was validated by RSO
- `cloture`: Incident was closed

---

### Table: `rso_incidents_commentaires`

**Purpose**: Stores comments and notes added to incidents by users. Supports different comment types and visibility controls.

**Schema**:
```sql
CREATE TABLE rso_incidents_commentaires (
    id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    incident_id INT NOT NULL REFERENCES rso_incidents(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES rso_users(id) ON DELETE RESTRICT,
    
    commentaire TEXT NOT NULL,
    type_commentaire VARCHAR(30) NOT NULL DEFAULT 'general' CHECK (type_commentaire IN ('general', 'investigation', 'mesure', 'interne')),
    
    visible_agents_surete BOOLEAN NOT NULL DEFAULT FALSE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE NULL,
    
    CONSTRAINT rso_incidents_commentaires_commentaire_length CHECK (
        LENGTH(TRIM(commentaire)) >= 1
    )
);

-- Indexes
CREATE INDEX idx_rso_incidents_commentaires_tenant_id ON rso_incidents_commentaires(tenant_id);
CREATE INDEX idx_rso_incidents_commentaires_incident ON rso_incidents_commentaires(incident_id);
CREATE INDEX idx_rso_incidents_commentaires_user ON rso_incidents_commentaires(user_id);
CREATE INDEX idx_rso_incidents_commentaires_type ON rso_incidents_commentaires(type_commentaire);
CREATE INDEX idx_rso_incidents_commentaires_deleted_at ON rso_incidents_commentaires(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_rso_incidents_commentaires_incident_created ON rso_incidents_commentaires(incident_id, created_at DESC);
```

**Field Descriptions**:
- `id`: Primary key, auto-incrementing integer
- `tenant_id`: Foreign key to `tenants` table
- `incident_id`: Foreign key to `rso_incidents` (cascade delete)
- `user_id`: Foreign key to `rso_users` (author of comment)
- `commentaire`: Comment text (required, non-empty)
- `type_commentaire`: Type of comment (general, investigation, mesure, interne)
- `visible_agents_surete`: Whether security agents can see this comment
- `created_at`: Creation timestamp
- `updated_at`: Last update timestamp (auto-updated via trigger)
- `deleted_at`: Soft delete timestamp (NULL = active, NOT NULL = deleted)

**Comment Types**:
- `general`: General comment visible to all authorized users
- `investigation`: Investigation notes (RSO/admin only)
- `mesure`: Comment related to a specific measure
- `interne`: Internal comment (RSO/admin only, not visible to agents)

---

### Table: `rso_incidents_mesures`

**Purpose**: Tracks measures (immediate, corrective, preventive) taken for incidents. Each measure has a responsible person, due date, and status.

**Schema**:
```sql
CREATE TABLE rso_incidents_mesures (
    id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    incident_id INT NOT NULL REFERENCES rso_incidents(id) ON DELETE CASCADE,
    
    type_mesure VARCHAR(30) NOT NULL CHECK (type_mesure IN ('immediate', 'corrective', 'preventive')),
    description TEXT NOT NULL,
    
    responsable_id INT NULL REFERENCES rso_users(id) ON DELETE SET NULL,
    date_echeance DATE NULL,
    
    statut VARCHAR(30) NOT NULL DEFAULT 'planifiee' CHECK (statut IN ('planifiee', 'en_cours', 'terminee', 'annulee')),
    date_realisation DATE NULL,
    
    cout_estime DECIMAL(10,2) NULL,
    cout_reel DECIMAL(10,2) NULL,
    
    efficacite VARCHAR(20) NULL CHECK (efficacite IN ('faible', 'moyenne', 'bonne', 'excellente')),
    commentaire_efficacite TEXT NULL,
    
    created_by INT NOT NULL REFERENCES rso_users(id) ON DELETE RESTRICT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    
    CONSTRAINT rso_incidents_mesures_description_length CHECK (
        LENGTH(TRIM(description)) >= 10
    ),
    CONSTRAINT rso_incidents_mesures_date_realisation_after_creation CHECK (
        date_realisation IS NULL OR date_realisation >= DATE(created_at)
    ),
    CONSTRAINT rso_incidents_mesures_statut_terminee_requires_date CHECK (
        (statut = 'terminee' AND date_realisation IS NOT NULL)
        OR (statut != 'terminee')
    )
);

-- Indexes
CREATE INDEX idx_rso_incidents_mesures_tenant_id ON rso_incidents_mesures(tenant_id);
CREATE INDEX idx_rso_incidents_mesures_incident ON rso_incidents_mesures(incident_id);
CREATE INDEX idx_rso_incidents_mesures_type ON rso_incidents_mesures(type_mesure);
CREATE INDEX idx_rso_incidents_mesures_statut ON rso_incidents_mesures(statut);
CREATE INDEX idx_rso_incidents_mesures_responsable ON rso_incidents_mesures(responsable_id);
CREATE INDEX idx_rso_incidents_mesures_date_echeance ON rso_incidents_mesures(date_echeance) WHERE date_echeance IS NOT NULL;
CREATE INDEX idx_rso_incidents_mesures_incident_type ON rso_incidents_mesures(incident_id, type_mesure);
```

**Field Descriptions**:
- `id`: Primary key, auto-incrementing integer
- `tenant_id`: Foreign key to `tenants` table
- `incident_id`: Foreign key to `rso_incidents` (cascade delete)
- `type_mesure`: Type of measure (immediate, corrective, preventive)
- `description`: Description of the measure (minimum 10 characters)
- `responsable_id`: Foreign key to `rso_users` (responsible person)
- `date_echeance`: Due date for the measure
- `statut`: Current status (planifiee, en_cours, terminee, annulee)
- `date_realisation`: Actual completion date
- `cout_estime`: Estimated cost in FCFA
- `cout_reel`: Actual cost in FCFA
- `efficacite`: Effectiveness rating (faible, moyenne, bonne, excellente)
- `commentaire_efficacite`: Comment on effectiveness
- `created_by`: Foreign key to `rso_users` (who created the measure)
- `created_at`: Creation timestamp
- `updated_at`: Last update timestamp (auto-updated via trigger)

**Validation Rules**:
- Description: Minimum 10 characters
- Date realisation: Must be after creation date
- Statut terminee: Requires date_realisation to be set

---

### Table: `rso_incidents_stats`

**Purpose**: Cached statistics for incidents, aggregated daily for performance. Reduces query load on dashboard and statistics endpoints.

**Schema**:
```sql
CREATE TABLE rso_incidents_stats (
    id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    date_stat DATE NOT NULL,
    installation_id INT NULL REFERENCES rso_installations(id) ON DELETE CASCADE,
    
    total_incidents INT NOT NULL DEFAULT 0,
    incidents_mineurs INT NOT NULL DEFAULT 0,
    incidents_moderes INT NOT NULL DEFAULT 0,
    incidents_graves INT NOT NULL DEFAULT 0,
    incidents_critiques INT NOT NULL DEFAULT 0,
    
    incidents_nouveaux INT NOT NULL DEFAULT 0,
    incidents_en_cours INT NOT NULL DEFAULT 0,
    incidents_resolus INT NOT NULL DEFAULT 0,
    incidents_clos INT NOT NULL DEFAULT 0,
    
    temps_moyen_resolution DECIMAL(10,2) NULL, -- en heures
    
    cout_total DECIMAL(12,2) NOT NULL DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    
    CONSTRAINT rso_incidents_stats_date_installation_unique UNIQUE (tenant_id, date_stat, installation_id),
    CONSTRAINT rso_incidents_stats_totals_check CHECK (
        total_incidents >= incidents_mineurs + incidents_moderes + incidents_graves + incidents_critiques
    )
);

-- Indexes
CREATE INDEX idx_rso_incidents_stats_tenant_id ON rso_incidents_stats(tenant_id);
CREATE INDEX idx_rso_incidents_stats_date ON rso_incidents_stats(date_stat);
CREATE INDEX idx_rso_incidents_stats_installation ON rso_incidents_stats(installation_id);
CREATE INDEX idx_rso_incidents_stats_date_installation ON rso_incidents_stats(date_stat, installation_id);
```

**Field Descriptions**:
- `id`: Primary key, auto-incrementing integer
- `tenant_id`: Foreign key to `tenants` table
- `date_stat`: Date for which statistics are calculated
- `installation_id`: Foreign key to `rso_installations` (NULL = global stats)
- `total_incidents`: Total number of incidents
- `incidents_mineurs`: Count of minor incidents
- `incidents_moderes`: Count of moderate incidents
- `incidents_graves`: Count of grave incidents
- `incidents_critiques`: Count of critical incidents
- `incidents_nouveaux`: Count of new incidents
- `incidents_en_cours`: Count of in-progress incidents
- `incidents_resolus`: Count of resolved incidents
- `incidents_clos`: Count of closed incidents
- `temps_moyen_resolution`: Average resolution time in hours
- `cout_total`: Total estimated cost
- `created_at`: Creation timestamp

**Aggregation Strategy**:
- Statistics are calculated daily at 23:00 via scheduled task
- One row per date per installation (or NULL for global)
- Statistics are recalculated if incidents change significantly
- Cache is used for dashboard performance

---

## Relationships

### Entity Relationship Diagram (Simplified)

```
rso_incidents
├── belongs_to → rso_installations (installation_id)
├── belongs_to → rso_annees (annee_id)
├── belongs_to → rso_users (declare_par, assigne_a, valide_par)
├── has_many → rso_incidents_medias (cascade delete)
├── has_many → rso_incidents_historique (cascade delete)
├── has_many → rso_incidents_commentaires (cascade delete)
└── has_many → rso_incidents_mesures (cascade delete)

rso_incidents_medias
├── belongs_to → rso_incidents (cascade delete)
└── belongs_to → rso_users (uploaded_by)

rso_incidents_historique
├── belongs_to → rso_incidents (cascade delete)
└── belongs_to → rso_users (user_id)

rso_incidents_commentaires
├── belongs_to → rso_incidents (cascade delete)
└── belongs_to → rso_users (user_id)

rso_incidents_mesures
├── belongs_to → rso_incidents (cascade delete)
├── belongs_to → rso_users (responsable_id, created_by)
└── (optional relationships)

rso_incidents_stats
└── belongs_to → rso_installations (optional, NULL for global stats)
```

---

## Data Validation Summary

### Incident Code Generation
- Format: `INC-{YYYY}-{INSTALLATION_CODE}-{SEQUENCE}`
- Example: `INC-2024-PAD_COM-001`
- Uniqueness: Enforced by database constraint
- Generation: Database sequence per installation per year

### File Upload Validation
- Maximum size: 100 MB per file
- Allowed MIME types: image/jpeg, image/png, video/mp4, application/pdf
- Thumbnail generation: Required for images
- Storage: MinIO/S3 with tenant isolation

### Workflow State Transitions
- Strict progression: nouveau → en_investigation → en_traitement → resolu → clos → archive
- Backward transitions: Allowed in some cases (e.g., resolu → en_traitement)
- Final state: archive (after 2 years from closure)

### Access Control
- Agents: Can only create/view incidents for their assigned installation
- RSOs: Can manage incidents for their installations
- Administrators: Full access to all incidents

---

## Performance Considerations

### Indexing Strategy
- Full-text search: GIN index on title and descriptions
- Common queries: Composite indexes on (installation_id, statut), (statut, niveau_urgence)
- Date queries: Index on date_incident DESC for recent incidents
- Statistics: Cached in rso_incidents_stats table

### Query Optimization
- Statistics: Use cached stats table for dashboard (updated daily)
- List queries: Use pagination (default 20 items per page)
- Search: Full-text search with ranking for relevance
- Media: Lazy load thumbnails, full images on demand

### Archiving Strategy
- Automatic archiving: After 2 years from closure date
- Archived incidents: Moved to separate storage, removed from active queries
- Statistics: Historical stats preserved for reporting

---

## Migration Notes

1. **Create tables in order**: Installations and years must exist first
2. **Foreign key constraints**: All foreign keys reference existing tables
3. **Indexes**: Create after table creation for better performance
4. **Full-text search**: GIN indexes require PostgreSQL 9.1+
5. **Statistics table**: Can be populated after incidents exist
6. **RLS policies**: Must be created after tables for tenant isolation

