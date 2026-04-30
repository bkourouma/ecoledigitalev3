# Data Model: Phase 2 - Gestion des Installations RSO-PFSO

**Feature**: Phase 2 - Gestion des Installations RSO-PFSO  
**Date**: 2025-01-27  
**Status**: Complete

## Overview

Phase 2 extends the RSO-PFSO module with port facility installation management, year management, and responsible person assignments. All tables maintain tenant isolation through Row Level Security (RLS) and follow the same patterns established in Phase 1.

## Database Schema

### Table: `rso_installations`

**Purpose**: Stores port facility installations where security activities are conducted. Each installation represents a physical location (Abidjan or San-Pedro) with contact information and operational status.

**Schema**:
```sql
CREATE TABLE rso_installations (
    id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    nom_port VARCHAR(150) NOT NULL,
    code_installation VARCHAR(20) NOT NULL,
    type_installation VARCHAR(50) NOT NULL CHECK (type_installation IN ('port_commerce', 'terminal_conteneurs', 'terminal_petrolier', 'terminal_mineranier', 'autre')),
    ville VARCHAR(100) NOT NULL CHECK (ville IN ('Abidjan', 'San-Pedro')),
    commentaire TEXT,
    statut VARCHAR(20) NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'inactif', 'en_maintenance')),
    adresse TEXT,
    contact_nom VARCHAR(100),
    contact_telephone VARCHAR(20),
    contact_email VARCHAR(150),
    created_by INT NOT NULL REFERENCES rso_users(id) ON DELETE RESTRICT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE NULL,
    
    CONSTRAINT rso_installations_code_unique UNIQUE (code_installation),
    CONSTRAINT rso_installations_tenant_code_unique UNIQUE (tenant_id, code_installation),
    CONSTRAINT rso_installations_code_format CHECK (
        code_installation ~ '^[A-Z0-9_]{3,20}$'
    ),
    CONSTRAINT rso_installations_nom_length CHECK (
        LENGTH(TRIM(nom_port)) >= 3 AND LENGTH(TRIM(nom_port)) <= 150
    )
);

-- Indexes
CREATE INDEX idx_rso_installations_tenant_id ON rso_installations(tenant_id);
CREATE INDEX idx_rso_installations_code ON rso_installations(code_installation);
CREATE INDEX idx_rso_installations_ville ON rso_installations(ville);
CREATE INDEX idx_rso_installations_type ON rso_installations(type_installation);
CREATE INDEX idx_rso_installations_statut ON rso_installations(statut);
CREATE INDEX idx_rso_installations_created_by ON rso_installations(created_by);
CREATE INDEX idx_rso_installations_deleted_at ON rso_installations(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_rso_installations_search ON rso_installations USING GIN(to_tsvector('french', nom_port || ' ' || COALESCE(commentaire, '')));
```

**Field Descriptions**:
- `id`: Primary key, auto-incrementing integer
- `tenant_id`: Foreign key to `tenants` table (ASPCI tenant only for RSO module)
- `nom_port`: Installation name (3-150 characters, required)
- `code_installation`: Unique installation code (3-20 characters, uppercase letters, numbers, underscores only)
- `type_installation`: Installation type enum (port_commerce, terminal_conteneurs, terminal_petrolier, terminal_mineranier, autre)
- `ville`: City location (Abidjan or San-Pedro only)
- `commentaire`: Optional comments/notes (TEXT)
- `statut`: Installation status (actif, inactif, en_maintenance)
- `adresse`: Optional full address (TEXT)
- `contact_nom`: Optional contact person name
- `contact_telephone`: Optional contact phone (format: +225 XX XX XX XX XX)
- `contact_email`: Optional contact email (validated format)
- `created_by`: Foreign key to `rso_users.id` (who created this installation)
- `created_at`: Creation timestamp
- `updated_at`: Last update timestamp (auto-updated via trigger)
- `deleted_at`: Soft delete timestamp (NULL = active, NOT NULL = archived)

**Validation Rules**:
- Code: 3-20 characters, uppercase letters, numbers, underscores only, unique across system
- Name: 3-150 characters, trimmed, non-empty
- Type: Must be one of the 5 allowed types
- City: Must be 'Abidjan' or 'San-Pedro'
- Status: Must be one of the 3 allowed statuses
- Contact phone: If provided, must match format +225 followed by 10 digits
- Contact email: If provided, must be valid email format

**State Transitions**:
- `statut`: 'actif' ↔ 'inactif' ↔ 'en_maintenance' (admin can change)
- `deleted_at`: NULL (active) → (timestamp) (archived) → NULL (restored)

**Full-Text Search**:
- GIN index on `nom_port` and `commentaire` for fast text search
- Uses French language for text search optimization

---

### Table: `rso_annees`

**Purpose**: Manages calendar years for organizing and filtering data (activities, statistics, reports). Years are pre-loaded from 2004 to current year, with automatic increment on January 1st.

**Schema**:
```sql
CREATE TABLE rso_annees (
    id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    annee INT NOT NULL,
    statut VARCHAR(20) NOT NULL DEFAULT 'archive' CHECK (statut IN ('active', 'archive')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    
    CONSTRAINT rso_annees_annee_unique UNIQUE (annee),
    CONSTRAINT rso_annees_annee_range CHECK (annee >= 2004 AND annee <= 2100)
);

-- Indexes
CREATE INDEX idx_rso_annees_annee ON rso_annees(annee);
CREATE INDEX idx_rso_annees_statut ON rso_annees(statut);
CREATE INDEX idx_rso_annees_active ON rso_annees(statut, annee DESC) WHERE statut = 'active';
```

**Field Descriptions**:
- `id`: Primary key, auto-incrementing integer
- `annee`: Year number (2004 to 2100, unique)
- `statut`: Year status (active = current year, archive = past years)
- `created_at`: Creation timestamp

**Validation Rules**:
- Year: Must be between 2004 and 2100
- Year: Must be unique (only one record per year)
- Status: Only one year can be 'active' at a time (enforced by application logic)

**State Transitions**:
- `statut`: 'archive' → 'active' (when year becomes current, or manual admin change)
- `statut`: 'active' → 'archive' (when new year is added, previous year is archived)

**Business Rules**:
- Current year (year of system date) is automatically set to 'active'
- All past years are set to 'archive'
- Only one year can be 'active' at a time
- Years are pre-loaded from 2004 to current year during migration

---

### Table: `rso_installation_responsables`

**Purpose**: Tracks responsible person assignments to installations (PFSO Principal, PFSO Adjoint, RSO Référent). Maintains complete history even after assignments end.

**Schema**:
```sql
CREATE TABLE rso_installation_responsables (
    id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    installation_id INT NOT NULL REFERENCES rso_installations(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES rso_users(id) ON DELETE CASCADE,
    type_responsable VARCHAR(50) NOT NULL CHECK (type_responsable IN ('pfso_principal', 'pfso_adjoint', 'rso_referent')),
    date_debut DATE NOT NULL,
    date_fin DATE NULL,
    statut VARCHAR(20) NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'inactif')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    
    CONSTRAINT rso_responsables_dates_valid CHECK (
        date_fin IS NULL OR date_fin >= date_debut
    ),
    CONSTRAINT rso_responsables_unique_active CHECK (
        -- Only one active PFSO Principal per installation at a time
        (type_responsable != 'pfso_principal' OR statut != 'actif') OR
        NOT EXISTS (
            SELECT 1 FROM rso_installation_responsables r2
            WHERE r2.installation_id = rso_installation_responsables.installation_id
            AND r2.type_responsable = 'pfso_principal'
            AND r2.statut = 'actif'
            AND r2.id != rso_installation_responsables.id
        )
    )
);

-- Indexes
CREATE INDEX idx_rso_responsables_installation_id ON rso_installation_responsables(installation_id);
CREATE INDEX idx_rso_responsables_user_id ON rso_installation_responsables(user_id);
CREATE INDEX idx_rso_responsables_type ON rso_installation_responsables(type_responsable);
CREATE INDEX idx_rso_responsables_statut ON rso_installation_responsables(statut);
CREATE INDEX idx_rso_responsables_active ON rso_installation_responsables(installation_id, statut) WHERE statut = 'actif';
CREATE INDEX idx_rso_responsables_dates ON rso_installation_responsables(date_debut, date_fin);
```

**Field Descriptions**:
- `id`: Primary key, auto-incrementing integer
- `installation_id`: Foreign key to `rso_installations` (which installation)
- `user_id`: Foreign key to `rso_users` (who is responsible)
- `type_responsable`: Type of responsibility (pfso_principal, pfso_adjoint, rso_referent)
- `date_debut`: Start date of assignment (required)
- `date_fin`: End date of assignment (NULL = ongoing, set when assignment ends)
- `statut`: Assignment status (actif = current, inactif = ended)
- `created_at`: Creation timestamp

**Validation Rules**:
- Type: Must be one of the 3 allowed types
- Dates: `date_fin` must be >= `date_debut` if provided
- Uniqueness: Only one active PFSO Principal per installation (enforced by constraint)
- Multiple Adjoints: Multiple PFSO Adjoints can be active simultaneously
- Multiple Referents: Multiple RSO Referents can be active simultaneously

**State Transitions**:
- `statut`: 'actif' → 'inactif' (when `date_fin` is set or manually ended)
- `date_fin`: NULL (ongoing) → (date) (ended)

**Business Rules**:
- Only one PFSO Principal can be active per installation at a time
- Multiple PFSO Adjoints and RSO Referents can be active simultaneously
- Historical records are never deleted (complete audit trail)
- When installation is archived, responsible assignments remain but are marked inactive

---

### Table Modification: `rso_users`

**Purpose**: Add foreign key constraint for `installation_id` field (already exists from Phase 1, but constraint was deferred).

**Migration**:
```sql
-- Add foreign key constraint if not exists (Phase 2)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'rso_users_installation_id_fkey'
    ) THEN
        ALTER TABLE rso_users
        ADD CONSTRAINT rso_users_installation_id_fkey
        FOREIGN KEY (installation_id) 
        REFERENCES rso_installations(id) 
        ON DELETE RESTRICT;
    END IF;
END $$;

-- Add index if not exists
CREATE INDEX IF NOT EXISTS idx_rso_users_installation_id ON rso_users(installation_id);
```

**Note**: The `installation_id` column already exists in Phase 1 schema, but the foreign key constraint is added in Phase 2 after `rso_installations` table is created.

---

## Entity Relationships

```
tenants (existing)
    ↓ (1:N)
rso_installations
    ├── (1:N) → rso_users (via installation_id)
    ├── (1:N) → rso_installation_responsables
    └── (will have 1:N) → rso_activites (Phase 3)
    └── (will have 1:N) → rso_incidents (Phase 4)

rso_users (Phase 1)
    ├── (N:1) → rso_installations (via installation_id, Phase 2)
    └── (1:N) → rso_installation_responsables (as responsible person)

rso_annees (standalone, referenced by year-dependent queries)
    └── Used for filtering: activities, statistics, reports (Phase 3+)
```

## Row Level Security (RLS) Policies

All Phase 2 tables must have RLS enabled to enforce tenant isolation:

```sql
-- Enable RLS on Phase 2 tables
ALTER TABLE rso_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE rso_annees ENABLE ROW LEVEL SECURITY;
ALTER TABLE rso_installation_responsables ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Installations isolated by tenant
CREATE POLICY rso_installations_tenant_isolation ON rso_installations
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- RLS Policy: Years are global but can be filtered by tenant context if needed
-- (Currently years are shared, but RLS is enabled for future tenant-specific years)
CREATE POLICY rso_annees_tenant_isolation ON rso_annees
    FOR ALL
    USING (TRUE);  -- Years are global, but RLS enabled for consistency

-- RLS Policy: Responsible assignments isolated by installation's tenant
CREATE POLICY rso_responsables_tenant_isolation ON rso_installation_responsables
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM rso_installations
            WHERE rso_installations.id = rso_installation_responsables.installation_id
            AND rso_installations.tenant_id = current_setting('app.tenant_id')::UUID
        )
    );
```

## Data Validation Rules

### Installation Creation
1. **Code**: 3-20 characters, uppercase letters, numbers, underscores only, unique across system
2. **Name**: 3-150 characters, trimmed, non-empty, no dangerous special characters
3. **Type**: Must be one of: 'port_commerce', 'terminal_conteneurs', 'terminal_petrolier', 'terminal_mineranier', 'autre'
4. **City**: Must be 'Abidjan' or 'San-Pedro'
5. **Status**: Must be one of: 'actif', 'inactif', 'en_maintenance'
6. **Contact Phone**: If provided, must match format +225 followed by 10 digits
7. **Contact Email**: If provided, must be valid email format

### Installation Deletion
1. **Soft Delete**: Set `deleted_at` timestamp instead of permanent deletion
2. **Dependency Check**: Cannot delete if installation has assigned Agent PFSO users (FR-041)
3. **Restoration**: Set `deleted_at = NULL` to restore archived installation
4. **Permanent Delete**: Only allowed for archived installations without dependencies

### Year Management
1. **Year Range**: 2004 to 2100
2. **Uniqueness**: Only one record per year
3. **Active Status**: Only one year can be 'active' at a time (enforced by application logic)
4. **Auto-Increment**: New year added automatically on January 1st via scheduled task

### Responsible Assignment
1. **Type**: Must be one of: 'pfso_principal', 'pfso_adjoint', 'rso_referent'
2. **Dates**: `date_fin` must be >= `date_debut` if provided
3. **Uniqueness**: Only one active PFSO Principal per installation
4. **Multiple Assignments**: Multiple Adjoints and Referents allowed simultaneously

## Migration Strategy

### Phase 2 Migration Steps

1. **Create tables**: Run migration to create `rso_installations`, `rso_annees`, `rso_installation_responsables`
2. **Add foreign key**: Add constraint on `rso_users.installation_id` → `rso_installations.id`
3. **Enable RLS**: Apply RLS policies for tenant isolation
4. **Seed years**: Insert years from 2004 to current year (current = active, others = archive)
5. **Seed installations**: Insert 19 predefined installations
6. **Update permissions**: Add 'gestion_installations' module permissions to `rso_permissions` table
7. **Verify**: Test tenant isolation, foreign keys, and constraints

### Predefined Installations Seed Data

The 19 installations will be inserted during migration:
- Port de commerce (PAD_COM)
- Abidjan Terminal (PAD_ABT)
- Terminal Freetier (PAD_FRT)
- Port Terminal à Pêche (PAD_PTP)
- Côte d'Ivoire Terminal (PAD_CIT)
- Terminal Mineranier (PAD_MIN)
- Pétro Sea Logistique (PAD_PSL)
- Carena (PAD_CAR)
- Yara (PAD_YAR)
- SIAP (PAD_SIA)
- Terra (PAD_TER)
- Solevo (PAD_SOL)
- Oil and Gas (PAD_OGS)
- Pétroci Soute (PAD_PTS)
- Pétroci Appontement (PAD_PTA)
- Puma Énergie (PAD_PUM)
- Port de San-Pedro (PSP_COM)
- Plateforme Shore Bélier (PSP_SHB)
- Terminal à Compteur de San-Pedro (PSP_TAC)

## Indexes Summary

**Performance-Critical Indexes**:
- `rso_installations`: tenant_id, code_installation, ville, type_installation, statut, deleted_at (partial)
- `rso_annees`: annee, statut, active (partial composite)
- `rso_installation_responsables`: installation_id, user_id, statut, active (partial composite)

**Query Optimization**:
- Installation lookup by code: `idx_rso_installations_code`
- Active installations: `idx_rso_installations_deleted_at` (partial index on NULL)
- Full-text search: GIN index on `nom_port` and `commentaire`
- Active year lookup: `idx_rso_annees_active` (partial composite)
- Active responsible assignments: `idx_rso_responsables_active` (partial composite)

## Triggers

### Auto-update `updated_at` timestamp

```sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER rso_installations_updated_at
    BEFORE UPDATE ON rso_installations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

## Comments

```sql
COMMENT ON TABLE rso_installations IS 'Port facility installations where security activities are conducted';
COMMENT ON TABLE rso_annees IS 'Calendar years for organizing and filtering data (2004 to current)';
COMMENT ON TABLE rso_installation_responsables IS 'Responsible person assignments to installations (PFSO Principal, Adjoint, RSO Référent)';
```

