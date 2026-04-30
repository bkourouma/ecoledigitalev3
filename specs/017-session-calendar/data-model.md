# Data Model: Session Management & Calendar

**Date**: 2025-01-27  
**Feature**: 017-session-calendar  
**Phase**: 1 - Design

## Overview

This document describes the data model for the session management and calendar feature. The database schema was created in Phase 1 (migration 0037), and this document focuses on the entities, relationships, and validation rules relevant to session management operations.

## Core Entities

### 1. Session Professionnelle (Training Session)

**Table**: `sessions_professionnelles`  
**Purpose**: Represents a scheduled instance of a professional training program

**Key Fields**:
- `id` (UUID, PK) - Primary key
- `tenant_id` (UUID, FK → tenants.id, NOT NULL) - Multi-tenant isolation
- `formation_pro_id` (UUID, FK → formations_professionnelles.id, NOT NULL) - Training program
- `code_session` (VARCHAR(50), UNIQUE per tenant) - Auto-generated session code (e.g., "DATA-2024-001")
- `date_debut` (DATE, NOT NULL) - Start date
- `date_fin` (DATE, NOT NULL) - End date
- `horaires` (VARCHAR(100)) - Schedule (e.g., "9h-17h")
- `mode_formation` (delivery_mode ENUM, NOT NULL) - Delivery mode: 'presentiel', 'distanciel', 'hybride'
- `lieu` (VARCHAR(500)) - Location (required if mode_formation = 'presentiel')
- `lien_visio` (VARCHAR(500)) - Video link (required if mode_formation = 'distanciel' or 'hybride')
- `places_totales` (INTEGER, NOT NULL) - Total capacity (must be > 0)
- `places_reservees` (INTEGER, DEFAULT 0) - Reserved places (updated via service method)
- `places_disponibles` (INTEGER, GENERATED) - Available places (calculated: places_totales - places_reservees)
- `prix_ht` (DECIMAL(10,2)) - Price excluding tax (can differ from base training price)
- `prix_ttc` (DECIMAL(10,2)) - Price including tax (typically prix_ht * 1.18 for 18% VAT)
- `statut` (session_professional_status ENUM, DEFAULT 'planifiee') - Session status
- `notes_internes` (TEXT, nullable) - Internal notes (admin only, not visible publicly)
- `created_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())
- `updated_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())

**ENUM Type**: `session_professional_status`
- `planifiee` - Session is planned but not yet open for enrollment
- `ouverte` - Session is open for enrollment
- `complete` - Session is full (no more places available)
- `en_cours` - Session is currently in progress
- `terminee` - Session has been completed
- `annulee` - Session has been cancelled

**Validation Rules**:
- `date_fin >= date_debut` (enforced by CHECK constraint)
- `places_totales > 0` (enforced by CHECK constraint)
- `places_reservees >= 0 AND places_reservees <= places_totales` (enforced by CHECK constraint)
- `code_session` must be unique per tenant (enforced by UNIQUE constraint)
- If `mode_formation = 'presentiel'`, then `lieu` is required
- If `mode_formation = 'distanciel'` or `'hybride'`, then `lien_visio` is required
- `prix_ttc >= prix_ht` (enforced by application logic)

**State Transitions**:
- `planifiee` → `ouverte` (admin publishes session)
- `ouverte` → `complete` (automatic when places_disponibles = 0)
- `complete` → `ouverte` (automatic when places become available)
- `ouverte` → `en_cours` (admin marks as started)
- `en_cours` → `terminee` (admin marks as completed)
- Any status → `annulee` (admin cancels, triggers notifications)

**Relationships**:
- **Many-to-One**: `formations_professionnelles` (formation_pro_id) - A session belongs to one training program
- **One-to-Many**: `inscriptions_professionnelles` (session_id) - A session has many enrollments
- **Many-to-Many**: `formateurs` (via `session_formateurs`) - A session has many trainers
- **One-to-Many**: `supports_cours` (session_id, optional) - A session may have course materials

**Indexes**:
- `idx_sessions_professionnelles_tenant_id` ON (tenant_id) - Tenant filtering
- `idx_sessions_professionnelles_formation_pro_id` ON (formation_pro_id) - Training program lookup
- `idx_sessions_professionnelles_code_session` ON (tenant_id, code_session) - Code lookup
- `idx_sessions_professionnelles_statut` ON (tenant_id, statut) - Status filtering
- `idx_sessions_professionnelles_date_debut` ON (tenant_id, date_debut) - Date range queries

**RLS Policy**: `tenant_id = current_setting('app.tenant_id', true)::UUID`

---

### 2. Session Formateur Assignment

**Table**: `session_formateurs`  
**Purpose**: Many-to-many relationship between sessions and trainers

**Key Fields**:
- `id` (UUID, PK) - Primary key
- `session_id` (UUID, FK → sessions_professionnelles.id, NOT NULL) - Session reference
- `formateur_id` (UUID, FK → formateurs.id, NOT NULL) - Trainer reference
- `role` (formateur_role ENUM) - Trainer role: 'principal', 'assistant', 'intervenant'
- `created_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())

**ENUM Type**: `formateur_role`
- `principal` - Primary trainer for the session
- `assistant` - Assistant trainer
- `intervenant` - Guest speaker/intervenant

**Validation Rules**:
- At least one trainer must be assigned per session (enforced by application logic)
- Trainer must be available for session dates (checked via availability service)
- Unique combination of session_id + formateur_id (enforced by UNIQUE constraint)

**Relationships**:
- **Many-to-One**: `sessions_professionnelles` (session_id)
- **Many-to-One**: `formateurs` (formateur_id)

**Indexes**:
- `idx_session_formateurs_session_id` ON (session_id) - Session lookup
- `idx_session_formateurs_formateur_id` ON (formateur_id) - Trainer lookup
- Composite index on (session_id, formateur_id) for uniqueness

---

### 3. Formation Professionnelle (Training Program)

**Table**: `formations_professionnelles`  
**Purpose**: Training program template (created in Phase 2)

**Key Fields** (relevant to sessions):
- `id` (UUID, PK) - Primary key
- `tenant_id` (UUID, FK) - Multi-tenant isolation
- `slug` (VARCHAR(255)) - URL-friendly identifier (used for session code prefix)
- `titre` (VARCHAR(255)) - Training title
- `prix_ht` (DECIMAL(10,2)) - Base price excluding tax
- `prix_ttc` (DECIMAL(10,2)) - Base price including tax

**Relationships**:
- **One-to-Many**: `sessions_professionnelles` (formation_pro_id) - A training program has many sessions

**Usage in Session Management**:
- Session code prefix extracted from `slug` (first 4 uppercase alphanumeric chars)
- Base pricing used as default when creating sessions (can be overridden)

---

### 4. Formateur (Trainer)

**Table**: `formateurs`  
**Purpose**: Professional training instructors

**Key Fields** (relevant to sessions):
- `id` (UUID, PK) - Primary key
- `tenant_id` (UUID, FK) - Multi-tenant isolation
- `nom` (VARCHAR(255)) - Last name
- `prenom` (VARCHAR(255)) - First name
- `bio` (TEXT) - Biography
- `photo` (VARCHAR(500)) - Photo URL
- `specialites` (JSONB) - Specialties array

**Relationships**:
- **Many-to-Many**: `sessions_professionnelles` (via `session_formateurs`) - A trainer can be assigned to many sessions

**Usage in Session Management**:
- Trainer availability checked before session creation/update
- Trainer information displayed on public session detail pages
- Full trainer details visible to admins

---

### 5. Inscription Professionnelle (Enrollment)

**Table**: `inscriptions_professionnelles`  
**Purpose**: Participant enrollments in sessions (Phase 4, referenced here for capacity calculations)

**Key Fields** (relevant to sessions):
- `id` (UUID, PK) - Primary key
- `session_id` (UUID, FK → sessions_professionnelles.id, NOT NULL) - Session reference
- `statut` (enrollment_status ENUM) - Enrollment status: 'confirmee', 'en_attente', 'annulee'
- `created_at` (TIMESTAMP WITH TIME ZONE) - Enrollment date

**Relationships**:
- **Many-to-One**: `sessions_professionnelles` (session_id) - An enrollment belongs to one session

**Usage in Session Management**:
- Count of enrollments with `statut IN ('confirmee', 'en_attente')` determines `places_reservees`
- Used for capacity calculations and status updates
- Enrollment details visible to admins in session detail view

---

## Derived/Computed Fields

### places_disponibles (Available Places)

**Type**: INTEGER (GENERATED ALWAYS AS)  
**Calculation**: `places_totales - places_reservees`  
**Update Mechanism**: 
- Automatically calculated by database (generated column)
- `places_reservees` updated via service method after enrollment changes
- No manual updates required

### Session Status Auto-Updates

**Trigger Conditions**:
- When `places_disponibles = 0` and `statut = 'ouverte'` → automatically set `statut = 'complete'`
- When `places_disponibles > 0` and `statut = 'complete'` → automatically set `statut = 'ouverte'`
- Manual status changes (en_cours, terminee, annulee) require admin action

**Implementation**: Service method `updateSessionCapacity()` handles status transitions

---

## Data Validation Rules

### Session Creation

1. **Required Fields**:
   - `formation_pro_id` (must exist in formations_professionnelles)
   - `date_debut`, `date_fin` (date_fin > date_debut)
   - `mode_formation` (must be valid ENUM value)
   - `places_totales` (must be > 0)
   - At least one `formateur_id` in session_formateurs

2. **Conditional Requirements**:
   - If `mode_formation = 'presentiel'`: `lieu` is required
   - If `mode_formation = 'distanciel'` or `'hybride'`: `lien_visio` is required

3. **Business Rules**:
   - Trainer availability must be validated (no conflicts with existing sessions)
   - `code_session` is auto-generated (format: PREFIX-YEAR-NUMBER)
   - `prix_ttc >= prix_ht` (if both provided)
   - `statut` defaults to 'planifiee' unless explicitly set to 'ouverte'

### Session Updates

1. **Restricted Updates** (when session has enrollments):
   - Cannot reduce `places_totales` below current `places_reservees`
   - Cannot change `statut` from 'en_cours' or 'terminee' to other statuses (except 'annulee')

2. **Validation on Update**:
   - If dates change: re-validate trainer availability
   - If trainers change: check availability for new trainers
   - If capacity reduced: ensure places_reservees <= new places_totales

3. **Notifications**:
   - If dates, location, or video link change: notify enrolled participants
   - If status changes to 'annulee': notify enrolled participants and initiate refunds if applicable

### Trainer Availability Checks

**Conflict Detection Logic**:
```sql
-- Check if trainer has conflicting sessions
SELECT COUNT(*) FROM sessions_professionnelles s
JOIN session_formateurs sf ON s.id = sf.session_id
WHERE sf.formateur_id = $formateur_id
  AND s.id != $exclude_session_id  -- Exclude current session when updating
  AND s.statut NOT IN ('annulee', 'terminee')
  AND (
    (s.date_debut <= $new_date_fin) AND (s.date_fin >= $new_date_debut)
  )
```

**Result**: If count > 0, trainer has a scheduling conflict

---

## Multi-Tenant Isolation

All queries must include tenant filtering:

1. **RLS Policies**: Automatically enforced at database level
2. **Application-Level**: All service methods must include `tenant_id` in WHERE clauses
3. **API Routes**: Tenant context extracted from request (header or subdomain)

**Example Query Pattern**:
```sql
SELECT * FROM sessions_professionnelles
WHERE tenant_id = $tenant_id
  AND [additional filters]
```

---

## Indexes for Performance

### Query Patterns

1. **Calendar View** (month/week):
   - Filter by: `tenant_id`, `date_debut` (range), `statut` (exclude 'annulee')
   - Index: `idx_sessions_professionnelles_date_debut` (tenant_id, date_debut)

2. **Session List** (admin):
   - Filter by: `tenant_id`, `statut`, `formation_pro_id`, date range
   - Indexes: `idx_sessions_professionnelles_statut`, `idx_sessions_professionnelles_formation_pro_id`

3. **Trainer Availability**:
   - Join: `sessions_professionnelles` + `session_formateurs` on `formateur_id`
   - Filter by: date range overlap
   - Indexes: `idx_session_formateurs_formateur_id`, `idx_sessions_professionnelles_date_debut`

4. **Session Lookup** (by code):
   - Filter by: `tenant_id`, `code_session`
   - Index: `idx_sessions_professionnelles_code_session` (tenant_id, code_session)

---

## Data Migration Notes

The database schema was created in Phase 1 (migration 0037). No additional migrations required for this feature.

**Existing Tables Used**:
- `sessions_professionnelles` - Already exists
- `session_formateurs` - Already exists
- `formations_professionnelles` - Already exists (from Phase 2)
- `formateurs` - Already exists
- `inscriptions_professionnelles` - Already exists (enrollments handled in Phase 4)

**No Schema Changes Required**: This feature uses existing schema and adds application logic only.

---

## Summary

The data model leverages the existing database schema from Phase 1. Key operations:

1. **Session CRUD**: Create, read, update sessions with validation
2. **Trainer Assignment**: Assign trainers with availability checks
3. **Capacity Management**: Automatic calculation of available places
4. **Status Management**: Automatic status transitions based on capacity
5. **Multi-Tenant**: All operations scoped to tenant via RLS

All business logic implemented in service layer (`apps/api/src/services/session-pro.service.ts`).

