# Data Model: Inscriptions & Paiements en Ligne - Module Imhotep Data

**Date**: 2025-11-20  
**Feature**: 018-inscriptions-paiements-ligne  
**Phase**: 1 - Design & Contracts

## Overview

This document defines the data model extensions and usage patterns for the online enrollment and payment system. The base schema was created in Phase 1 (Feature 015), and this feature extends it with additional tables, relationships, and business logic for enrollment processing, payment handling, and temporary reservations.

## Entity Relationship Diagram

```
tenants (existing)
    │
    ├── sessions_professionnelles (existing)
    │       │
    │       ├── inscriptions_professionnelles (existing)
    │       │       ├── paiements_professionnels (existing)
    │       │       └── reservations_temporaires (new)
    │       │
    │       └── codes_promo (existing, referenced)
    │
    ├── entreprises_clientes (existing)
    │       └── inscriptions_professionnelles
    │
    └── users (existing)
            └── inscriptions_professionnelles (as apprenant_id)
```

## Existing Entities (from Phase 1)

### inscriptions_professionnelles

**Purpose**: Participant enrollments in training sessions

**Key Fields for This Feature**:
- `id` (UUID, PK)
- `numero_inscription` (VARCHAR(50), UNIQUE) - Format: INS-DATA-YYYYMMDD-XXX
- `session_id` (UUID, FK → sessions_professionnelles.id)
- `apprenant_id` (UUID, FK → users.id)
- `entreprise_id` (UUID, FK → entreprises_clientes.id, nullable)
- `type_inscription` (enrollment_type) - 'individuelle' | 'entreprise'
- `statut` (enrollment_professional_status) - 'en_attente' | 'confirmee' | 'annulee' | 'terminee'
- `montant_ht` (DECIMAL(10,2))
- `montant_ttc` (DECIMAL(10,2))
- `code_promo_utilise` (VARCHAR(50), nullable)
- `reduction_appliquee` (DECIMAL(10,2), DEFAULT 0)
- `date_inscription` (TIMESTAMP WITH TIME ZONE)
- `facture_numero` (VARCHAR(50), nullable) - Format: FACT-YYYY-NNNN
- `facture_url` (VARCHAR(500), nullable) - PDF file URL

**State Transitions**:
```
en_attente → confirmee → terminee
        ↓
    annulee (can occur from any state)
```

**Business Rules**:
- Cannot create enrollment if `session.places_disponibles <= 0`
- Cannot create enrollment if `session.statut != 'ouverte'`
- `montant_ttc` must match payment amount
- `code_promo_utilise` must reference valid active promotional code
- `facture_numero` and `facture_url` populated when enrollment confirmed

### paiements_professionnels

**Purpose**: Payment transactions for enrollments

**Key Fields for This Feature**:
- `id` (UUID, PK)
- `inscription_id` (UUID, FK → inscriptions_professionnelles.id)
- `numero_transaction` (VARCHAR(100), UNIQUE) - Format: TXN-YYYYMMDDHHMMSS-XXXXX
- `montant` (DECIMAL(10,2))
- `methode_paiement` (payment_method) - 'orange_money' | 'mtn_money' | 'wave' | 'carte_bancaire' | 'tresorpay'
- `statut` (payment_professional_status) - 'en_attente' | 'valide' | 'echoue' | 'rembourse' | 'annule'
- `reference_externe` (VARCHAR(255), nullable) - Provider transaction ID
- `date_paiement` (TIMESTAMP WITH TIME ZONE, nullable)
- `metadata` (JSONB, nullable) - Provider-specific data, webhook payloads, etc.

**State Transitions**:
```
en_attente → valide
        ↓
    echoue
        ↓
    rembourse (from valide)
        ↓
    annule (from en_attente)
```

**Business Rules**:
- `montant` must match `inscription.montant_ttc`
- Only one payment with `statut='valide'` per enrollment
- `reference_externe` populated when payment initiated with provider
- `date_paiement` set when `statut` changes to 'valide'
- `metadata` stores: provider response, webhook payload, IP address, user agent, etc.

### codes_promo

**Purpose**: Promotional codes for discounts

**Key Fields for This Feature**:
- `id` (UUID, PK)
- `code` (VARCHAR(50), UNIQUE) - Promotional code (uppercase)
- `type_reduction` (promo_code_reduction_type) - 'pourcentage' | 'montant_fixe'
- `valeur_reduction` (DECIMAL(10,2))
- `date_debut` (DATE)
- `date_fin` (DATE)
- `utilisations_max` (INTEGER, nullable) - NULL = unlimited
- `utilisations_actuelles` (INTEGER, DEFAULT 0)
- `formations_applicables` (JSONB, nullable) - Array of formation IDs, NULL = all formations
- `actif` (BOOLEAN, DEFAULT true)

**Business Rules**:
- Code must be active (`actif = true`)
- Current date must be between `date_debut` and `date_fin`
- `utilisations_actuelles < utilisations_max` (if limit set)
- Training ID must be in `formations_applicables` (if specified)
- Increment `utilisations_actuelles` when code applied

### entreprises_clientes

**Purpose**: Company clients for enterprise enrollments

**Key Fields for This Feature**:
- `id` (UUID, PK)
- `raison_sociale` (VARCHAR(255))
- `siret` (VARCHAR(14), UNIQUE)
- `adresse` (TEXT)
- `code_postal` (VARCHAR(10))
- `ville` (VARCHAR(100))
- `contact_nom` (VARCHAR(100))
- `contact_prenom` (VARCHAR(100))
- `contact_email` (VARCHAR(255))
- `contact_telephone` (VARCHAR(20))

**Business Rules**:
- SIRET must be unique per tenant
- Used for company enrollment type
- Searchable by `raison_sociale` and `siret`

## New Entities

### reservations_temporaires

**Purpose**: Temporary place reservations during enrollment process (15-minute expiration)

**Fields**:
- `id` (UUID, PK) - Primary key
- `tenant_id` (UUID, FK → tenants.id, NOT NULL) - Multi-tenant isolation
- `inscription_id` (UUID, FK → inscriptions_professionnelles.id, NOT NULL) - Enrollment
- `session_id` (UUID, FK → sessions_professionnelles.id, NOT NULL) - Training session
- `expire_at` (TIMESTAMP WITH TIME ZONE, NOT NULL) - Expiration timestamp
- `created_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())

**Constraints**:
- UNIQUE(tenant_id, inscription_id)
- CHECK(expire_at > created_at)

**Relationships**:
- Many-to-One: `inscriptions_professionnelles` (inscription_id)
- Many-to-One: `sessions_professionnelles` (session_id)

**Indexes**:
- `idx_reservations_temporaires_tenant_id` ON (tenant_id)
- `idx_reservations_temporaires_inscription_id` ON (inscription_id)
- `idx_reservations_temporaires_session_id` ON (session_id)
- `idx_reservations_temporaires_expire_at` ON (expire_at) - For cleanup job

**RLS Policy**: `tenant_id = current_setting('app.tenant_id', true)::UUID`

**Business Rules**:
- Created when enrollment form submitted (status='en_attente')
- Expires 15 minutes after creation
- Automatically cleaned up by background job
- If expired and no payment: enrollment cancelled, place released
- If payment completed: reservation can be deleted (enrollment confirmed)

**Cleanup Logic**:
```sql
-- Find expired reservations with no validated payment
SELECT r.*
FROM reservations_temporaires r
JOIN inscriptions_professionnelles i ON r.inscription_id = i.id
LEFT JOIN paiements_professionnels p ON p.inscription_id = i.id AND p.statut = 'valide'
WHERE r.expire_at < NOW()
  AND i.statut = 'en_attente'
  AND p.id IS NULL;
```

## Query Patterns

### Check Session Availability

```sql
SELECT 
  s.id,
  s.places_totales,
  s.places_reservees,
  s.places_disponibles,
  s.statut,
  CASE 
    WHEN s.places_disponibles <= 0 THEN false
    WHEN s.statut != 'ouverte' THEN false
    ELSE true
  END as disponible
FROM sessions_professionnelles s
WHERE s.id = $1
  AND s.tenant_id = current_setting('app.tenant_id', true)::UUID;
```

### Create Enrollment with Reservation

```sql
BEGIN;

-- Lock session row to prevent concurrent enrollments
SELECT * FROM sessions_professionnelles 
WHERE id = $1 AND tenant_id = current_setting('app.tenant_id', true)::UUID
FOR UPDATE;

-- Check availability
SELECT places_disponibles, statut 
FROM sessions_professionnelles 
WHERE id = $1;

-- If available, create enrollment
INSERT INTO inscriptions_professionnelles (
  tenant_id, numero_inscription, session_id, apprenant_id, 
  entreprise_id, type_inscription, statut, montant_ht, montant_ttc,
  code_promo_utilise, reduction_appliquee, date_inscription
) VALUES (...)
RETURNING id, numero_inscription;

-- Create temporary reservation
INSERT INTO reservations_temporaires (
  tenant_id, inscription_id, session_id, expire_at
) VALUES (
  current_setting('app.tenant_id', true)::UUID,
  $inscription_id,
  $session_id,
  NOW() + INTERVAL '15 minutes'
);

-- Update session places (increment places_reservees)
UPDATE sessions_professionnelles
SET places_reservees = places_reservees + 1,
    updated_at = NOW()
WHERE id = $session_id;

COMMIT;
```

### Validate Promotional Code

```sql
SELECT 
  id, code, type_reduction, valeur_reduction,
  date_debut, date_fin, utilisations_max, utilisations_actuelles,
  formations_applicables, actif
FROM codes_promo
WHERE code = UPPER($1)
  AND tenant_id = current_setting('app.tenant_id', true)::UUID
  AND actif = true
  AND date_debut <= CURRENT_DATE
  AND date_fin >= CURRENT_DATE
  AND (utilisations_max IS NULL OR utilisations_actuelles < utilisations_max)
  AND (formations_applicables IS NULL OR $formation_id = ANY(formations_applicables));
```

### Find Payment by Transaction Number

```sql
SELECT 
  p.*,
  i.numero_inscription,
  i.statut as inscription_statut
FROM paiements_professionnels p
JOIN inscriptions_professionnelles i ON p.inscription_id = i.id
WHERE p.numero_transaction = $1
  AND p.tenant_id = current_setting('app.tenant_id', true)::UUID;
```

### Get User Enrollment History

```sql
SELECT 
  i.*,
  s.code_session,
  s.date_debut,
  s.date_fin,
  f.titre as formation_titre,
  p.statut as paiement_statut,
  p.methode_paiement
FROM inscriptions_professionnelles i
JOIN sessions_professionnelles s ON i.session_id = s.id
JOIN formations_professionnelles f ON s.formation_pro_id = f.id
LEFT JOIN paiements_professionnels p ON p.inscription_id = i.id AND p.statut = 'valide'
WHERE i.apprenant_id = $1
  AND i.tenant_id = current_setting('app.tenant_id', true)::UUID
ORDER BY i.date_inscription DESC;
```

### Search Companies

```sql
SELECT 
  id, raison_sociale, siret, adresse, code_postal, ville,
  contact_nom, contact_prenom, contact_email, contact_telephone
FROM entreprises_clientes
WHERE tenant_id = current_setting('app.tenant_id', true)::UUID
  AND (
    raison_sociale ILIKE '%' || $1 || '%'
    OR siret = $1
  )
  AND actif = true
ORDER BY raison_sociale
LIMIT 10;
```

## Database Functions

### Generate Enrollment Number

```sql
CREATE OR REPLACE FUNCTION generate_enrollment_number(tenant_uuid UUID)
RETURNS VARCHAR(50) AS $$
DECLARE
  today VARCHAR(8);
  prefix VARCHAR(20);
  count_num INTEGER;
  numero VARCHAR(50);
BEGIN
  today := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
  prefix := 'INS-DATA-' || today || '-';
  
  SELECT COALESCE(MAX(CAST(SUBSTRING(numero_inscription FROM LENGTH(prefix) + 1) AS INTEGER)), 0) + 1
  INTO count_num
  FROM inscriptions_professionnelles
  WHERE tenant_id = tenant_uuid
    AND numero_inscription LIKE prefix || '%';
  
  numero := prefix || LPAD(count_num::TEXT, 3, '0');
  RETURN numero;
END;
$$ LANGUAGE plpgsql;
```

### Generate Invoice Number

```sql
CREATE OR REPLACE FUNCTION generate_invoice_number(tenant_uuid UUID)
RETURNS VARCHAR(50) AS $$
DECLARE
  year VARCHAR(4);
  prefix VARCHAR(20);
  count_num INTEGER;
  numero VARCHAR(50);
BEGIN
  year := TO_CHAR(CURRENT_DATE, 'YYYY');
  prefix := 'FACT-' || year || '-';
  
  SELECT COALESCE(MAX(CAST(SUBSTRING(facture_numero FROM LENGTH(prefix) + 1) AS INTEGER)), 0) + 1
  INTO count_num
  FROM inscriptions_professionnelles
  WHERE tenant_id = tenant_uuid
    AND facture_numero LIKE prefix || '%'
    AND facture_numero IS NOT NULL;
  
  numero := prefix || LPAD(count_num::TEXT, 4, '0');
  RETURN numero;
END;
$$ LANGUAGE plpgsql;
```

## State Management

### Enrollment Status Updates

**When Payment Validated**:
```sql
UPDATE inscriptions_professionnelles
SET statut = 'confirmee',
    facture_numero = generate_invoice_number(tenant_id),
    updated_at = NOW()
WHERE id = $inscription_id;

UPDATE sessions_professionnelles
SET places_reservees = places_reservees - 1,  -- Release reservation
    updated_at = NOW()
WHERE id = $session_id;

DELETE FROM reservations_temporaires
WHERE inscription_id = $inscription_id;
```

**When Enrollment Cancelled**:
```sql
UPDATE inscriptions_professionnelles
SET statut = 'annulee',
    updated_at = NOW()
WHERE id = $inscription_id;

UPDATE sessions_professionnelles
SET places_reservees = GREATEST(places_reservees - 1, 0),
    updated_at = NOW()
WHERE id = $session_id;

DELETE FROM reservations_temporaires
WHERE inscription_id = $inscription_id;
```

## Indexes for Performance

**Additional indexes for enrollment queries**:
- `idx_inscriptions_professionnelles_date_inscription` ON (tenant_id, date_inscription DESC)
- `idx_inscriptions_professionnelles_code_promo` ON (code_promo_utilise) WHERE code_promo_utilise IS NOT NULL
- `idx_paiements_professionnels_reference_externe` ON (reference_externe) WHERE reference_externe IS NOT NULL
- `idx_paiements_professionnels_date_paiement` ON (date_paiement) WHERE date_paiement IS NOT NULL
- `idx_entreprises_clientes_raison_sociale_fts` - Full-text search index on raison_sociale

## Notes

- All tables include `tenant_id` for multi-tenant isolation
- RLS policies ensure tenant-scoped data access
- Audit trails maintained with `created_at` and `updated_at`
- JSONB fields (`metadata`, `formations_applicables`) provide flexibility
- Foreign key constraints maintain referential integrity
- Indexes optimized for common query patterns (availability checks, user history, company search)
- Temporary reservations automatically cleaned up by background job
- Enrollment numbers and invoice numbers generated with date prefixes for chronological organization

