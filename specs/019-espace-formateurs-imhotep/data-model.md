# Data Model: Trainer Space (Espace Formateurs) - Imhotep Data

**Date**: 2025-11-20  
**Feature**: 019-espace-formateurs-imhotep  
**Phase**: 1 - Design

## Overview

This document describes the data model for the trainer space feature. It includes both existing tables (from previous phases) and new tables required for trainer functionality. The database schema maintains multi-tenant isolation and follows existing patterns.

## Entity Relationship Diagram

```
formateurs (existing)
    │
    ├── session_formateurs (existing) ──→ sessions_professionnelles (existing)
    │                                           │
    │                                           ├── inscriptions_professionnelles (existing)
    │                                           │       └── session_attendance (NEW)
    │                                           │
    │                                           ├── supports_cours (existing)
    │                                           │       ├── support_session_associations (NEW)
    │                                           │       └── support_telechargements (NEW)
    │                                           │
    │                                           └── notes_formateur (field in sessions_professionnelles)
    │
    ├── formateur_indisponibilites (NEW)
    │
    ├── supports_cours (existing)
    │       ├── support_session_associations (NEW)
    │       └── support_telechargements (NEW)
    │
    └── notifications_formateurs (NEW)
```

## Existing Entities (Referenced)

### 1. Formateur (Trainer)

**Table**: `formateurs` (from Phase 1)  
**Purpose**: Professional training instructors

**Key Fields** (relevant to trainer space):
- `id` (UUID, PK)
- `tenant_id` (UUID, FK → tenants.id, NOT NULL)
- `user_id` (UUID, FK → users.id, nullable) - Links to user account for authentication
- `nom`, `prenom` (VARCHAR) - Name
- `email` (VARCHAR, UNIQUE) - Email
- `telephone` (VARCHAR) - Phone
- `specialites` (JSONB) - Areas of expertise
- `bio` (TEXT) - Biography
- `cv_url` (VARCHAR) - CV file URL
- `photo_url` (VARCHAR) - Photo URL
- `linkedin_url` (VARCHAR) - LinkedIn profile
- `actif` (BOOLEAN) - Active status

**Relationships**:
- **Many-to-Many**: `sessions_professionnelles` (via `session_formateurs`)
- **One-to-Many**: `supports_cours` (formateur_id)
- **One-to-Many**: `formateur_indisponibilites` (formateur_id)
- **One-to-Many**: `notifications_formateurs` (formateur_id)

---

### 2. Session Professionnelle (Training Session)

**Table**: `sessions_professionnelles` (from Phase 3)  
**Purpose**: Scheduled training sessions

**Key Fields** (relevant to trainer space):
- `id` (UUID, PK)
- `tenant_id` (UUID, FK)
- `formation_pro_id` (UUID, FK) - Training program
- `code_session` (VARCHAR) - Session code
- `date_debut`, `date_fin` (DATE) - Session dates
- `horaires` (VARCHAR) - Schedule
- `mode_formation` (ENUM) - Delivery mode
- `lieu` (VARCHAR) - Location
- `lien_visio` (VARCHAR) - Video link
- `statut` (ENUM) - Session status
- `notes_formateur` (TEXT, nullable) - **NEW**: Trainer notes (private)
- `notes_updated_at` (TIMESTAMP, nullable) - **NEW**: Last notes update

**Relationships**:
- **Many-to-Many**: `formateurs` (via `session_formateurs`)
- **One-to-Many**: `inscriptions_professionnelles` (session_id)
- **One-to-Many**: `session_attendance` (session_id)
- **Many-to-Many**: `supports_cours` (via `support_session_associations`)

---

### 3. Session Formateur Assignment

**Table**: `session_formateurs` (from Phase 3)  
**Purpose**: Many-to-many relationship between sessions and trainers

**Key Fields**:
- `id` (UUID, PK)
- `tenant_id` (UUID, FK)
- `session_id` (UUID, FK → sessions_professionnelles.id)
- `formateur_id` (UUID, FK → formateurs.id)
- `role` (ENUM) - Trainer role: 'principal', 'assistant', 'intervenant'

**Usage**: Used to verify trainer access to sessions

---

### 4. Inscription Professionnelle (Enrollment)

**Table**: `inscriptions_professionnelles` (from Phase 4)  
**Purpose**: Participant enrollments in sessions

**Key Fields** (relevant to trainer space):
- `id` (UUID, PK)
- `session_id` (UUID, FK)
- `apprenant_id` (UUID, FK) - Learner reference
- `statut` (ENUM) - Enrollment status
- `apprenant_nom`, `apprenant_prenom` (VARCHAR) - Learner name
- `apprenant_email` (VARCHAR) - Learner email
- `apprenant_telephone` (VARCHAR) - Learner phone

**Relationships**:
- **One-to-One**: `session_attendance` (inscription_id)

---

## New Entities

### 5. Session Attendance

**Table**: `session_attendance`  
**Purpose**: Track learner attendance for sessions

**Key Fields**:
- `id` (UUID, PK) - Primary key
- `tenant_id` (UUID, FK → tenants.id, NOT NULL) - Multi-tenant isolation
- `session_id` (UUID, FK → sessions_professionnelles.id, NOT NULL) - Session reference
- `inscription_id` (UUID, FK → inscriptions_professionnelles.id, NOT NULL) - Enrollment reference
- `present` (BOOLEAN, NOT NULL) - Attendance status (true = present, false = absent)
- `marked_by` (UUID, FK → formateurs.id, NOT NULL) - Trainer who marked attendance
- `marked_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW()) - When attendance was marked
- `updated_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW()) - Last update timestamp

**Validation Rules**:
- Unique combination of (session_id, inscription_id) - one attendance record per enrollment
- `present` must be explicitly set (NOT NULL)
- Attendance can only be marked for sessions with status 'en_cours' or 'terminee'

**Relationships**:
- **Many-to-One**: `sessions_professionnelles` (session_id)
- **Many-to-One**: `inscriptions_professionnelles` (inscription_id)
- **Many-to-One**: `formateurs` (marked_by)

**Indexes**:
- `idx_session_attendance_tenant_id` ON (tenant_id)
- `idx_session_attendance_session_id` ON (session_id)
- `idx_session_attendance_inscription_id` ON (inscription_id)
- `idx_session_attendance_marked_by` ON (marked_by)
- UNIQUE constraint on (tenant_id, session_id, inscription_id)

**RLS Policy**: `tenant_id = current_setting('app.tenant_id', true)::UUID`

---

### 6. Support de Cours (Course Material)

**Table**: `supports_cours` (from Phase 1, extended)  
**Purpose**: Course materials uploaded by trainers

**Key Fields**:
- `id` (UUID, PK)
- `tenant_id` (UUID, FK)
- `formateur_id` (UUID, FK → formateurs.id, NOT NULL) - Trainer who uploaded
- `formation_id` (UUID, FK → formations_professionnelles.id, nullable) - Training program association
- `session_id` (UUID, FK → sessions_professionnelles.id, nullable) - Direct session association (legacy)
- `titre` (VARCHAR(255), NOT NULL) - Material title
- `description` (TEXT) - Material description
- `type_fichier` (VARCHAR(50)) - File type: 'PDF', 'PPT', 'DOC', 'ZIP', 'Video', 'Autre'
- `fichier_url` (VARCHAR(500), NOT NULL) - File storage URL/path
- `taille_fichier` (BIGINT) - File size in bytes
- `visible_apprenants` (BOOLEAN, DEFAULT true) - Visibility to learners
- `created_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())
- `updated_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())

**Relationships**:
- **Many-to-One**: `formateurs` (formateur_id)
- **Many-to-One**: `formations_professionnelles` (formation_id, optional)
- **Many-to-Many**: `sessions_professionnelles` (via `support_session_associations`)
- **One-to-Many**: `support_telechargements` (support_id)

**Indexes**:
- `idx_supports_cours_tenant_id` ON (tenant_id)
- `idx_supports_cours_formateur_id` ON (formateur_id)
- `idx_supports_cours_formation_id` ON (formation_id)
- `idx_supports_cours_session_id` ON (session_id)

**RLS Policy**: `tenant_id = current_setting('app.tenant_id', true)::UUID`

---

### 7. Support Session Association

**Table**: `support_session_associations`  
**Purpose**: Many-to-many relationship between course materials and sessions

**Key Fields**:
- `id` (UUID, PK) - Primary key
- `tenant_id` (UUID, FK → tenants.id, NOT NULL) - Multi-tenant isolation
- `support_id` (UUID, FK → supports_cours.id, NOT NULL) - Course material reference
- `session_id` (UUID, FK → sessions_professionnelles.id, NOT NULL) - Session reference
- `created_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())

**Validation Rules**:
- Unique combination of (support_id, session_id) - prevent duplicate associations
- Support must belong to same tenant as session

**Relationships**:
- **Many-to-One**: `supports_cours` (support_id)
- **Many-to-One**: `sessions_professionnelles` (session_id)

**Indexes**:
- `idx_support_session_assoc_tenant_id` ON (tenant_id)
- `idx_support_session_assoc_support_id` ON (support_id)
- `idx_support_session_assoc_session_id` ON (session_id)
- UNIQUE constraint on (tenant_id, support_id, session_id)

**RLS Policy**: `tenant_id = current_setting('app.tenant_id', true)::UUID`

---

### 8. Support Téléchargement (Material Download)

**Table**: `support_telechargements`  
**Purpose**: Track course material downloads for statistics

**Key Fields**:
- `id` (UUID, PK) - Primary key
- `tenant_id` (UUID, FK → tenants.id, NOT NULL) - Multi-tenant isolation
- `support_id` (UUID, FK → supports_cours.id, NOT NULL) - Course material reference
- `apprenant_id` (UUID, FK → apprenants.id, nullable) - Learner who downloaded (if authenticated)
- `session_id` (UUID, FK → sessions_professionnelles.id, nullable) - Session context (if applicable)
- `downloaded_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW()) - Download timestamp

**Relationships**:
- **Many-to-One**: `supports_cours` (support_id)
- **Many-to-One**: `apprenants` (apprenant_id, optional)
- **Many-to-One**: `sessions_professionnelles` (session_id, optional)

**Indexes**:
- `idx_support_telechargements_tenant_id` ON (tenant_id)
- `idx_support_telechargements_support_id` ON (support_id)
- `idx_support_telechargements_apprenant_id` ON (apprenant_id)
- `idx_support_telechargements_session_id` ON (session_id)
- `idx_support_telechargements_downloaded_at` ON (downloaded_at) - For statistics queries

**RLS Policy**: `tenant_id = current_setting('app.tenant_id', true)::UUID`

---

### 9. Formateur Indisponibilité (Trainer Unavailability)

**Table**: `formateur_indisponibilites`  
**Purpose**: Periods when trainers are unavailable

**Key Fields**:
- `id` (UUID, PK) - Primary key
- `tenant_id` (UUID, FK → tenants.id, NOT NULL) - Multi-tenant isolation
- `formateur_id` (UUID, FK → formateurs.id, NOT NULL) - Trainer reference
- `date_debut` (DATE, NOT NULL) - Start date of unavailability
- `date_fin` (DATE, NOT NULL) - End date of unavailability
- `raison` (TEXT) - Reason for unavailability
- `created_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())

**Validation Rules**:
- `date_fin >= date_debut` (enforced by CHECK constraint)
- Date ranges can overlap (trainer can have multiple unavailability periods)

**Relationships**:
- **Many-to-One**: `formateurs` (formateur_id)

**Indexes**:
- `idx_formateur_indispo_tenant_id` ON (tenant_id)
- `idx_formateur_indispo_formateur_id` ON (formateur_id)
- `idx_formateur_indispo_dates` ON (tenant_id, formateur_id, date_debut, date_fin) - For range queries

**RLS Policy**: `tenant_id = current_setting('app.tenant_id', true)::UUID`

---

### 10. Notification Formateur (Trainer Notification)

**Table**: `notifications_formateurs`  
**Purpose**: In-app notifications for trainers

**Key Fields**:
- `id` (UUID, PK) - Primary key
- `tenant_id` (UUID, FK → tenants.id, NOT NULL) - Multi-tenant isolation
- `formateur_id` (UUID, FK → formateurs.id, NOT NULL) - Trainer reference
- `type` (VARCHAR(50), NOT NULL) - Notification type: 'nouvelle_inscription', 'session_modifiee', 'session_annulee', 'message_admin', 'rappel_session'
- `titre` (VARCHAR(255), NOT NULL) - Notification title
- `message` (TEXT) - Notification message
- `metadata` (JSONB) - Additional data (session_id, enrollment_id, etc.)
- `lue` (BOOLEAN, DEFAULT false) - Read status
- `lue_at` (TIMESTAMP WITH TIME ZONE, nullable) - When notification was read
- `created_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())

**Relationships**:
- **Many-to-One**: `formateurs` (formateur_id)

**Indexes**:
- `idx_notifications_formateurs_tenant_id` ON (tenant_id)
- `idx_notifications_formateurs_formateur_id` ON (formateur_id)
- `idx_notifications_formateurs_lue` ON (tenant_id, formateur_id, lue) - For unread count queries
- `idx_notifications_formateurs_created_at` ON (tenant_id, formateur_id, created_at DESC) - For recent notifications

**RLS Policy**: `tenant_id = current_setting('app.tenant_id', true)::UUID`

---

## Schema Updates

### Updates to Existing Tables

#### sessions_professionnelles

**New Fields**:
- `notes_formateur` (TEXT, nullable) - Private notes added by trainers
- `notes_updated_at` (TIMESTAMP WITH TIME ZONE, nullable) - Last notes update timestamp

**Migration SQL**:
```sql
ALTER TABLE sessions_professionnelles
  ADD COLUMN IF NOT EXISTS notes_formateur TEXT,
  ADD COLUMN IF NOT EXISTS notes_updated_at TIMESTAMP WITH TIME ZONE;
```

---

## Data Validation Rules

### Attendance Marking

1. **Eligibility**:
   - Session status must be 'en_cours' or 'terminee'
   - Trainer must be assigned to the session (verified via `session_formateurs`)
   - Enrollment must exist and be confirmed

2. **Uniqueness**:
   - One attendance record per enrollment per session
   - Updates replace existing record (update `present`, `marked_by`, `marked_at`, `updated_at`)

### Course Material Upload

1. **File Validation**:
   - File size: max 100MB for course materials, 5MB for photos, 10MB for CVs
   - File types: PDF, PPT, PPTX, DOC, DOCX, ZIP, MP4, AVI for materials; JPG, PNG for photos; PDF for CVs
   - File must be uploaded successfully before creating database record

2. **Association Rules**:
   - Material can be associated with training program OR specific sessions OR both
   - If associated with training program, available to all sessions of that program
   - If associated with specific sessions, only available to those sessions

### Unavailability Management

1. **Date Validation**:
   - `date_fin >= date_debut`
   - Dates can be in past, present, or future
   - Overlapping unavailability periods are allowed (trainer can have multiple reasons)

2. **Conflict Detection**:
   - Unavailability periods are informational (for trainer calendar)
   - Administrators should check unavailability when assigning sessions (separate feature)

### Notification Creation

1. **Trigger Events**:
   - New enrollment: `type = 'nouvelle_inscription'`, metadata includes `session_id`, `enrollment_id`
   - Session modified: `type = 'session_modifiee'`, metadata includes `session_id`, `changes`
   - Session cancelled: `type = 'session_annulee'`, metadata includes `session_id`
   - Admin message: `type = 'message_admin'`, metadata includes `admin_id`, `message`
   - Session reminder: `type = 'rappel_session'`, metadata includes `session_id`, `days_until`

---

## Multi-Tenant Isolation

All queries must include tenant filtering:

1. **RLS Policies**: Automatically enforced at database level for all new tables
2. **Application-Level**: All service methods must include `tenant_id` in WHERE clauses
3. **API Routes**: Tenant context extracted from request (header or subdomain)

**Example Query Pattern**:
```sql
SELECT * FROM session_attendance
WHERE tenant_id = $tenant_id
  AND formateur_id = $formateur_id
  AND session_id = $session_id
```

---

## Indexes for Performance

### Query Patterns

1. **Trainer Dashboard**:
   - Filter by: `tenant_id`, `formateur_id`, session status, date ranges
   - Indexes: `idx_session_formateurs_formateur_id`, `idx_sessions_professionnelles_statut`, `idx_sessions_professionnelles_date_debut`

2. **Trainer Schedule**:
   - Filter by: `tenant_id`, `formateur_id`, date range
   - Join: `session_formateurs` + `sessions_professionnelles` + `formateur_indisponibilites`
   - Indexes: `idx_session_formateurs_formateur_id`, `idx_formateur_indispo_formateur_id`, `idx_formateur_indispo_dates`

3. **Session Attendance**:
   - Filter by: `tenant_id`, `session_id`
   - Index: `idx_session_attendance_session_id`

4. **Course Materials**:
   - Filter by: `tenant_id`, `formateur_id`, `formation_id`, `session_id` (via associations)
   - Indexes: `idx_supports_cours_formateur_id`, `idx_supports_cours_formation_id`, `idx_support_session_assoc_support_id`

5. **Download Statistics**:
   - Group by: `support_id`, `session_id`
   - Filter by: `downloaded_at` (date range)
   - Index: `idx_support_telechargements_support_id`, `idx_support_telechargements_downloaded_at`

6. **Notifications**:
   - Filter by: `tenant_id`, `formateur_id`, `lue = false`
   - Order by: `created_at DESC`
   - Index: `idx_notifications_formateurs_lue`

---

## Data Migration Notes

### New Tables to Create

1. `session_attendance` - Attendance tracking
2. `support_session_associations` - Material-session associations
3. `support_telechargements` - Download tracking
4. `formateur_indisponibilites` - Unavailability periods
5. `notifications_formateurs` - Trainer notifications

### Existing Tables to Update

1. `sessions_professionnelles` - Add `notes_formateur` and `notes_updated_at` fields

### Migration Order

1. Add new fields to `sessions_professionnelles`
2. Create `formateur_indisponibilites` table
3. Create `session_attendance` table
4. Create `support_session_associations` table
5. Create `support_telechargements` table
6. Create `notifications_formateurs` table
7. Create all indexes
8. Enable RLS policies
9. Create triggers for `updated_at` fields

