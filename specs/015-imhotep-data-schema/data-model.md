# Data Model: Imhotep Data Professional Training

**Date**: 2025-01-27  
**Feature**: 015-imhotep-data-schema  
**Phase**: 1 - Design & Contracts

## Overview

This document defines the complete data model for the Imhotep Data professional training module. The schema includes 9 tables with proper relationships, constraints, indexes, and Row Level Security (RLS) policies, maintaining complete isolation from existing Imhotep Academy academic tables.

## Entity Relationship Diagram

```
tenants (existing)
    │
    ├── formations_professionnelles
    │       │
    │       ├── sessions_professionnelles
    │       │       │
    │       │       ├── inscriptions_professionnelles
    │       │       │       ├── paiements_professionnels
    │       │       │       └── codes_promo (via application)
    │       │       │
    │       │       ├── session_formateurs (junction)
    │       │       │       └── formateurs
    │       │       │
    │       │       └── supports_cours
    │       │
    │       └── supports_cours
    │
    ├── entreprises_clientes
    │       └── inscriptions_professionnelles
    │
    ├── formateurs
    │       ├── session_formateurs (junction)
    │       └── supports_cours
    │
    └── users (existing)
            ├── inscriptions_professionnelles (as apprenant_id)
            └── formateurs (optional user_id)
```

## Entities

### 1. formations_professionnelles

**Purpose**: Professional training program catalog

**Fields**:
- `id` (UUID, PK) - Primary key
- `tenant_id` (UUID, FK → tenants.id, NOT NULL) - Multi-tenant isolation
- `titre` (VARCHAR(255), NOT NULL) - Training title
- `slug` (VARCHAR(255), UNIQUE) - URL-friendly identifier
- `description_courte` (TEXT) - Short description
- `description_complete` (TEXT) - Full description
- `objectifs` (JSONB) - Learning objectives (structured)
- `programme_detaille` (JSONB) - Detailed program content
- `prerequis` (TEXT) - Prerequisites
- `public_cible` (TEXT) - Target audience
- `duree_jours` (INTEGER) - Duration in days
- `duree_heures` (INTEGER) - Duration in hours
- `prix_ht` (DECIMAL(10,2)) - Price excluding tax
- `prix_ttc` (DECIMAL(10,2)) - Price including tax
- `type_certification` (VARCHAR(100)) - Certification type (Attestation, Certificat, Diplôme)
- `nom_certification` (VARCHAR(255)) - Certification name (nullable)
- `brochure_pdf_url` (VARCHAR(500)) - PDF brochure URL (nullable)
- `themes` (JSONB) - Categories/themes
- `niveau` (VARCHAR(50)) - Level (Débutant, Intermédiaire, Avancé)
- `actif` (BOOLEAN, DEFAULT true) - Active status
- `created_by` (UUID, FK → users.id, nullable) - Creator reference
- `created_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())
- `updated_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())

**Constraints**:
- UNIQUE(tenant_id, slug)
- CHECK(duree_jours > 0 OR duree_heures > 0)
- CHECK(prix_ht >= 0 AND prix_ttc >= 0)

**Relationships**:
- One-to-Many: `sessions_professionnelles` (formation_pro_id)
- One-to-Many: `supports_cours` (formation_id, optional)

**Indexes**:
- `idx_formations_professionnelles_tenant_id` ON (tenant_id)
- `idx_formations_professionnelles_slug` ON (tenant_id, slug)
- `idx_formations_professionnelles_actif` ON (tenant_id, actif)
- `idx_formations_professionnelles_themes` ON (tenant_id, themes) USING GIN

**RLS Policy**: `tenant_id = current_setting('app.tenant_id', true)::UUID`

---

### 2. sessions_professionnelles

**Purpose**: Scheduled training sessions

**Fields**:
- `id` (UUID, PK) - Primary key
- `tenant_id` (UUID, FK → tenants.id, NOT NULL) - Multi-tenant isolation
- `formation_pro_id` (UUID, FK → formations_professionnelles.id, NOT NULL) - Training program
- `code_session` (VARCHAR(50), UNIQUE) - Session code (e.g., "DATA-2024-001")
- `date_debut` (DATE, NOT NULL) - Start date
- `date_fin` (DATE, NOT NULL) - End date
- `horaires` (VARCHAR(100)) - Schedule (e.g., "9h-17h")
- `mode_formation` (delivery_mode, NOT NULL) - Delivery mode (reuse existing ENUM)
- `lieu` (VARCHAR(500)) - Location (if presentiel)
- `lien_visio` (VARCHAR(500)) - Video link (if distanciel)
- `places_totales` (INTEGER, NOT NULL) - Total capacity
- `places_reservees` (INTEGER, DEFAULT 0) - Reserved places
- `places_disponibles` (INTEGER, GENERATED ALWAYS AS (places_totales - places_reservees) STORED) - Available places
- `prix_ht` (DECIMAL(10,2)) - Price excluding tax (can differ from base training)
- `prix_ttc` (DECIMAL(10,2)) - Price including tax
- `statut` (session_professional_status, DEFAULT 'planifiee') - Session status
- `notes_internes` (TEXT) - Internal notes (nullable)
- `created_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())
- `updated_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())

**ENUM Type**: `session_professional_status AS ENUM ('planifiee', 'ouverte', 'complete', 'en_cours', 'terminee', 'annulee')`

**Constraints**:
- UNIQUE(tenant_id, code_session)
- CHECK(date_fin >= date_debut)
- CHECK(places_totales > 0)
- CHECK(places_reservees >= 0 AND places_reservees <= places_totales)

**Relationships**:
- Many-to-One: `formations_professionnelles` (formation_pro_id)
- One-to-Many: `inscriptions_professionnelles` (session_id)
- Many-to-Many: `formateurs` (via `session_formateurs`)
- One-to-Many: `supports_cours` (session_id, optional)

**Indexes**:
- `idx_sessions_professionnelles_tenant_id` ON (tenant_id)
- `idx_sessions_professionnelles_formation_pro_id` ON (formation_pro_id)
- `idx_sessions_professionnelles_code_session` ON (tenant_id, code_session)
- `idx_sessions_professionnelles_statut` ON (tenant_id, statut)
- `idx_sessions_professionnelles_date_debut` ON (tenant_id, date_debut)

**RLS Policy**: `tenant_id = current_setting('app.tenant_id', true)::UUID`

---

### 3. formateurs

**Purpose**: Professional training instructors

**Fields**:
- `id` (UUID, PK) - Primary key
- `tenant_id` (UUID, FK → tenants.id, NOT NULL) - Multi-tenant isolation
- `user_id` (UUID, FK → users.id, nullable) - Optional user account link
- `civilite` (VARCHAR(20)) - Title (M., Mme, etc.)
- `nom` (VARCHAR(100), NOT NULL) - Last name
- `prenom` (VARCHAR(100), NOT NULL) - First name
- `email` (VARCHAR(255), UNIQUE, NOT NULL) - Email address
- `telephone` (VARCHAR(20)) - Phone number
- `specialites` (JSONB) - Areas of expertise
- `bio` (TEXT) - Biography
- `cv_url` (VARCHAR(500)) - CV URL (nullable)
- `photo_url` (VARCHAR(500)) - Photo URL (nullable)
- `linkedin_url` (VARCHAR(500)) - LinkedIn URL (nullable)
- `tarif_journalier` (DECIMAL(10,2)) - Daily rate (nullable)
- `actif` (BOOLEAN, DEFAULT true) - Active status
- `created_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())
- `updated_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())

**Constraints**:
- UNIQUE(tenant_id, email)
- CHECK(tarif_journalier >= 0 OR tarif_journalier IS NULL)

**Relationships**:
- Many-to-Many: `sessions_professionnelles` (via `session_formateurs`)
- One-to-Many: `supports_cours` (formateur_id)
- Optional: `users` (user_id)

**Indexes**:
- `idx_formateurs_tenant_id` ON (tenant_id)
- `idx_formateurs_email` ON (tenant_id, email)
- `idx_formateurs_actif` ON (tenant_id, actif)
- `idx_formateurs_specialites` ON (tenant_id, specialites) USING GIN

**RLS Policy**: `tenant_id = current_setting('app.tenant_id', true)::UUID`

---

### 4. session_formateurs

**Purpose**: Junction table for trainers assigned to sessions

**Fields**:
- `id` (UUID, PK) - Primary key
- `tenant_id` (UUID, FK → tenants.id, NOT NULL) - Multi-tenant isolation
- `session_id` (UUID, FK → sessions_professionnelles.id, NOT NULL) - Training session
- `formateur_id` (UUID, FK → formateurs.id, NOT NULL) - Trainer
- `role` (VARCHAR(50)) - Role (Principal, Assistant, Intervenant)
- `created_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())

**Constraints**:
- UNIQUE(tenant_id, session_id, formateur_id)

**Relationships**:
- Many-to-One: `sessions_professionnelles` (session_id)
- Many-to-One: `formateurs` (formateur_id)

**Indexes**:
- `idx_session_formateurs_tenant_id` ON (tenant_id)
- `idx_session_formateurs_session_id` ON (session_id)
- `idx_session_formateurs_formateur_id` ON (formateur_id)

**RLS Policy**: `tenant_id = current_setting('app.tenant_id', true)::UUID`

---

### 5. entreprises_clientes

**Purpose**: Company clients for enterprise training

**Fields**:
- `id` (UUID, PK) - Primary key
- `tenant_id` (UUID, FK → tenants.id, NOT NULL) - Multi-tenant isolation
- `raison_sociale` (VARCHAR(255), NOT NULL) - Company name
- `siret` (VARCHAR(14), UNIQUE) - SIRET number
- `forme_juridique` (VARCHAR(50)) - Legal form (SARL, SAS, etc.)
- `adresse` (TEXT) - Address
- `code_postal` (VARCHAR(10)) - Postal code
- `ville` (VARCHAR(100)) - City
- `pays` (VARCHAR(100), DEFAULT 'Côte d''Ivoire') - Country
- `contact_nom` (VARCHAR(100)) - Contact last name
- `contact_prenom` (VARCHAR(100)) - Contact first name
- `contact_email` (VARCHAR(255)) - Contact email
- `contact_telephone` (VARCHAR(20)) - Contact phone
- `secteur_activite` (VARCHAR(100)) - Business sector
- `nombre_employes` (INTEGER) - Number of employees (nullable)
- `notes` (TEXT) - Additional notes (nullable)
- `actif` (BOOLEAN, DEFAULT true) - Active status
- `created_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())
- `updated_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())

**Constraints**:
- UNIQUE(tenant_id, siret)

**Relationships**:
- One-to-Many: `inscriptions_professionnelles` (entreprise_id, optional)

**Indexes**:
- `idx_entreprises_clientes_tenant_id` ON (tenant_id)
- `idx_entreprises_clientes_siret` ON (tenant_id, siret)
- `idx_entreprises_clientes_raison_sociale` ON (tenant_id, raison_sociale)
- `idx_entreprises_clientes_actif` ON (tenant_id, actif)

**RLS Policy**: `tenant_id = current_setting('app.tenant_id', true)::UUID`

---

### 6. inscriptions_professionnelles

**Purpose**: Participant enrollments in training sessions

**Fields**:
- `id` (UUID, PK) - Primary key
- `tenant_id` (UUID, FK → tenants.id, NOT NULL) - Multi-tenant isolation
- `numero_inscription` (VARCHAR(50), UNIQUE) - Enrollment number (e.g., "INS-DATA-2024-001")
- `session_id` (UUID, FK → sessions_professionnelles.id, NOT NULL) - Training session
- `apprenant_id` (UUID, FK → users.id, NOT NULL) - Participant (user)
- `entreprise_id` (UUID, FK → entreprises_clientes.id, nullable) - Company client (if company enrollment)
- `type_inscription` (enrollment_type, NOT NULL) - Enrollment type
- `statut` (enrollment_professional_status, DEFAULT 'en_attente') - Enrollment status
- `montant_ht` (DECIMAL(10,2), NOT NULL) - Amount excluding tax
- `montant_ttc` (DECIMAL(10,2), NOT NULL) - Amount including tax
- `code_promo_utilise` (VARCHAR(50)) - Promotional code used (nullable)
- `reduction_appliquee` (DECIMAL(10,2), DEFAULT 0) - Discount applied
- `date_inscription` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW()) - Enrollment date
- `notes` (TEXT) - Additional notes (nullable)
- `created_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())
- `updated_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())

**ENUM Types**:
- `enrollment_type AS ENUM ('individuelle', 'entreprise')`
- `enrollment_professional_status AS ENUM ('en_attente', 'confirmee', 'annulee', 'terminee')`

**Constraints**:
- UNIQUE(tenant_id, numero_inscription)
- CHECK(montant_ht >= 0 AND montant_ttc >= 0)
- CHECK(reduction_appliquee >= 0)
- CHECK((type_inscription = 'entreprise' AND entreprise_id IS NOT NULL) OR (type_inscription = 'individuelle' AND entreprise_id IS NULL))

**Relationships**:
- Many-to-One: `sessions_professionnelles` (session_id)
- Many-to-One: `users` (apprenant_id)
- Many-to-One: `entreprises_clientes` (entreprise_id, optional)
- One-to-Many: `paiements_professionnels` (inscription_id)

**Indexes**:
- `idx_inscriptions_professionnelles_tenant_id` ON (tenant_id)
- `idx_inscriptions_professionnelles_numero_inscription` ON (tenant_id, numero_inscription)
- `idx_inscriptions_professionnelles_session_id` ON (session_id)
- `idx_inscriptions_professionnelles_apprenant_id` ON (apprenant_id)
- `idx_inscriptions_professionnelles_entreprise_id` ON (entreprise_id)
- `idx_inscriptions_professionnelles_statut` ON (tenant_id, statut)

**RLS Policy**: `tenant_id = current_setting('app.tenant_id', true)::UUID`

---

### 7. codes_promo

**Purpose**: Promotional codes for discounts

**Fields**:
- `id` (UUID, PK) - Primary key
- `tenant_id` (UUID, FK → tenants.id, NOT NULL) - Multi-tenant isolation
- `code` (VARCHAR(50), UNIQUE, NOT NULL) - Promotional code
- `description` (TEXT) - Code description
- `type_reduction` (promo_code_reduction_type, NOT NULL) - Discount type
- `valeur_reduction` (DECIMAL(10,2), NOT NULL) - Discount value (% or fixed amount)
- `date_debut` (DATE, NOT NULL) - Start date
- `date_fin` (DATE, NOT NULL) - End date
- `utilisations_max` (INTEGER) - Maximum uses (nullable = unlimited)
- `utilisations_actuelles` (INTEGER, DEFAULT 0) - Current usage count
- `formations_applicables` (JSONB) - Applicable training IDs (nullable = all trainings)
- `actif` (BOOLEAN, DEFAULT true) - Active status
- `created_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())
- `updated_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())

**ENUM Type**: `promo_code_reduction_type AS ENUM ('pourcentage', 'montant_fixe')`

**Constraints**:
- UNIQUE(tenant_id, code)
- CHECK(date_fin >= date_debut)
- CHECK(valeur_reduction > 0)
- CHECK((type_reduction = 'pourcentage' AND valeur_reduction <= 100) OR type_reduction = 'montant_fixe')
- CHECK(utilisations_max IS NULL OR utilisations_max > 0)
- CHECK(utilisations_actuelles >= 0)
- CHECK(utilisations_max IS NULL OR utilisations_actuelles <= utilisations_max)

**Relationships**:
- Referenced by: `inscriptions_professionnelles` (code_promo_utilise, via application logic)

**Indexes**:
- `idx_codes_promo_tenant_id` ON (tenant_id)
- `idx_codes_promo_code` ON (tenant_id, code)
- `idx_codes_promo_actif` ON (tenant_id, actif)
- `idx_codes_promo_dates` ON (tenant_id, date_debut, date_fin)

**RLS Policy**: `tenant_id = current_setting('app.tenant_id', true)::UUID`

---

### 8. paiements_professionnels

**Purpose**: Payment transactions for enrollments

**Fields**:
- `id` (UUID, PK) - Primary key
- `tenant_id` (UUID, FK → tenants.id, NOT NULL) - Multi-tenant isolation
- `inscription_id` (UUID, FK → inscriptions_professionnelles.id, NOT NULL) - Enrollment
- `numero_transaction` (VARCHAR(100), UNIQUE) - Transaction number
- `montant` (DECIMAL(10,2), NOT NULL) - Payment amount
- `methode_paiement` (payment_method, NOT NULL) - Payment method
- `statut` (payment_professional_status, DEFAULT 'en_attente') - Payment status
- `reference_externe` (VARCHAR(255)) - External provider reference (nullable)
- `date_paiement` (TIMESTAMP WITH TIME ZONE) - Payment date (nullable)
- `metadata` (JSONB) - Additional provider metadata (nullable)
- `created_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())
- `updated_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())

**ENUM Types**:
- `payment_method AS ENUM ('orange_money', 'mtn_money', 'wave', 'carte_bancaire', 'tresorpay', 'virement', 'cheque')`
- `payment_professional_status AS ENUM ('en_attente', 'valide', 'echoue', 'rembourse', 'annule')`

**Constraints**:
- UNIQUE(tenant_id, numero_transaction)
- CHECK(montant > 0)

**Relationships**:
- Many-to-One: `inscriptions_professionnelles` (inscription_id)

**Indexes**:
- `idx_paiements_professionnels_tenant_id` ON (tenant_id)
- `idx_paiements_professionnels_inscription_id` ON (inscription_id)
- `idx_paiements_professionnels_numero_transaction` ON (tenant_id, numero_transaction)
- `idx_paiements_professionnels_statut` ON (tenant_id, statut)
- `idx_paiements_professionnels_methode_paiement` ON (tenant_id, methode_paiement)

**RLS Policy**: `tenant_id = current_setting('app.tenant_id', true)::UUID`

---

### 9. supports_cours

**Purpose**: Training materials and resources

**Fields**:
- `id` (UUID, PK) - Primary key
- `tenant_id` (UUID, FK → tenants.id, NOT NULL) - Multi-tenant isolation
- `formateur_id` (UUID, FK → formateurs.id, NOT NULL) - Trainer who uploaded
- `session_id` (UUID, FK → sessions_professionnelles.id, nullable) - Associated session (optional)
- `formation_id` (UUID, FK → formations_professionnelles.id, nullable) - Associated training (optional)
- `titre` (VARCHAR(255), NOT NULL) - Material title
- `description` (TEXT) - Description (nullable)
- `type_fichier` (VARCHAR(50)) - File type (PDF, PPT, Video, ZIP, etc.)
- `fichier_url` (VARCHAR(500), NOT NULL) - File URL (MinIO/S3)
- `taille_fichier` (BIGINT) - File size in bytes
- `visible_apprenants` (BOOLEAN, DEFAULT true) - Visible to participants
- `created_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())
- `updated_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())

**Constraints**:
- CHECK(session_id IS NOT NULL OR formation_id IS NOT NULL) - Must be associated with session or training
- CHECK(taille_fichier >= 0 OR taille_fichier IS NULL)

**Relationships**:
- Many-to-One: `formateurs` (formateur_id)
- Many-to-One: `sessions_professionnelles` (session_id, optional)
- Many-to-One: `formations_professionnelles` (formation_id, optional)

**Indexes**:
- `idx_supports_cours_tenant_id` ON (tenant_id)
- `idx_supports_cours_formateur_id` ON (formateur_id)
- `idx_supports_cours_session_id` ON (session_id)
- `idx_supports_cours_formation_id` ON (formation_id)
- `idx_supports_cours_visible_apprenants` ON (tenant_id, visible_apprenants)

**RLS Policy**: `tenant_id = current_setting('app.tenant_id', true)::UUID`

---

## Generated Fields

### Enrollment Numbers

**Function**: `generate_enrollment_number(tenant_uuid UUID)`
**Pattern**: `INS-DATA-YYYY-NNN` (e.g., `INS-DATA-2024-001`)
**Trigger**: `BEFORE INSERT` on `inscriptions_professionnelles`

### Session Codes

**Function**: `generate_session_code(tenant_uuid UUID, formation_id UUID)`
**Pattern**: `DATA-YYYY-NNN` (e.g., `DATA-2024-001`)
**Trigger**: `BEFORE INSERT` on `sessions_professionnelles` (if code_session is NULL)

## Validation Rules

### Business Rules (Application Layer)

1. **Enrollment Capacity**: Cannot enroll if `places_disponibles <= 0`
2. **Promotional Code**: Must be valid (active, within dates, usage limit not exceeded, applicable to training)
3. **Payment Status**: Enrollment status may update based on payment status
4. **Session Status**: Auto-update based on dates and enrollment capacity

### Database Constraints

1. **Referential Integrity**: All foreign keys with appropriate CASCADE/SET NULL
2. **Data Validation**: CHECK constraints on dates, amounts, counts
3. **Uniqueness**: UNIQUE constraints on codes, emails, SIRET
4. **Calculated Fields**: `places_disponibles` automatically calculated

## State Transitions

### Session Status
```
planifiee → ouverte → en_cours → terminee
                ↓
            complete (if full capacity)
                ↓
            annulee (can occur from any state)
```

### Enrollment Status
```
en_attente → confirmee → terminee
        ↓
    annulee (can occur from any state)
```

### Payment Status
```
en_attente → valide
        ↓
    echoue
        ↓
    rembourse (from valide)
        ↓
    annule (from en_attente)
```

## Notes

- All tables include `tenant_id` for multi-tenant isolation
- RLS policies ensure tenant-scoped data access
- Audit trails maintained with `created_at` and `updated_at`
- Generated fields use triggers for automatic population
- JSONB fields provide flexibility for structured data
- Foreign key constraints maintain referential integrity
- Indexes optimized for common query patterns

