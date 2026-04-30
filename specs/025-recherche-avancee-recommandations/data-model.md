# Data Model: Phase 5 - Recherche Avancée et Gestion des Recommandations

**Date**: 2025-01-27  
**Feature**: Phase 5 - Recherche Avancée et Gestion des Recommandations  
**Branch**: `025-phase`

## Overview

This document defines the database schema for the advanced search and recommendation management system, including tags, notifications, saved searches, scheduled reports, and recommendation history. All tables are tenant-scoped (ASPCI tenant) and use Row Level Security (RLS) for data isolation.

This phase extends the existing Phase 3 schema with new tables and enhancements to the `rso_recommandations` table.

---

## Entity Relationship Diagram

```
rso_activites (Phase 3)
    │
    │ N:M
    ▼
rso_activites_tags ──► rso_tags
    │
    │ N:1
    ▼
rso_users (Phase 1)
    │
    │ 1:N
    ├──► rso_recherches_enregistrees
    ├──► rso_notifications
    └──► rso_rapports_planifies

rso_recommandations (Phase 3, enhanced)
    │
    │ 1:N
    ├──► rso_recommandations_historique
    └──► rso_notifications (via entite_id)
```

---

## New Tables

### 1. rso_tags

**Purpose**: Stores tags (keywords/labels) used to categorize activities. Tags are organized by categories and can be associated with multiple activities.

**Columns**:

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INT | PRIMARY KEY, AUTO_INCREMENT | Unique identifier |
| `nom` | VARCHAR(50) | UNIQUE, NOT NULL | Tag name (unique) |
| `slug` | VARCHAR(50) | UNIQUE, NOT NULL | URL-friendly identifier (lowercase, hyphens) |
| `description` | TEXT | NULL | Optional description |
| `couleur` | VARCHAR(7) | NOT NULL, DEFAULT '#3498db' | Hex color code (e.g., #3498db) |
| `icone` | VARCHAR(50) | NULL | Emoji or CSS class name |
| `categorie` | ENUM | NOT NULL, DEFAULT 'autre' | Category: 'theme', 'priorite', 'type_incident', 'equipement', 'zone', 'autre' |
| `nb_utilisations` | INT | NOT NULL, DEFAULT 0 | Usage count (number of activities using this tag) |
| `actif` | BOOLEAN | NOT NULL, DEFAULT TRUE | Active status (inactive tags don't appear in selection) |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT CURRENT_TIMESTAMP | Creation timestamp |

**Indexes**:
- PRIMARY KEY: `id`
- UNIQUE: `nom`, `slug`
- INDEX: `idx_categorie` on (`categorie`)
- INDEX: `idx_actif` on (`actif`)

**Validation Rules**:
- `nom` must be unique
- `slug` must be unique and URL-friendly (lowercase, hyphens, no spaces)
- `couleur` must be valid hex color code (format: #RRGGBB)
- `nb_utilisations` must be non-negative
- Tags cannot be deleted if `nb_utilisations > 0` (must be deactivated instead)

**RLS Policy**:
- All queries must filter by `tenant_id = 'aspci'` (implicit via application logic, tags are shared within tenant)

---

### 2. rso_activites_tags

**Purpose**: Junction table linking activities to tags (many-to-many relationship).

**Columns**:

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INT | PRIMARY KEY, AUTO_INCREMENT | Unique identifier |
| `activite_id` | INT | NOT NULL, FK → rso_activites(id) ON DELETE CASCADE | Activity reference |
| `tag_id` | INT | NOT NULL, FK → rso_tags(id) ON DELETE CASCADE | Tag reference |
| `ajout_par` | INT | NOT NULL, FK → rso_users(id) | User who added the tag |
| `ajout_le` | TIMESTAMP | NOT NULL, DEFAULT CURRENT_TIMESTAMP | Addition timestamp |

**Indexes**:
- PRIMARY KEY: `id`
- UNIQUE: `unique_tag` on (`activite_id`, `tag_id`)
- INDEX: `idx_activite` on (`activite_id`)
- INDEX: `idx_tag` on (`tag_id`)

**Validation Rules**:
- Same tag cannot be associated with same activity twice (enforced by UNIQUE constraint)
- When tag is added, increment `nb_utilisations` in `rso_tags`
- When tag is removed, decrement `nb_utilisations` in `rso_tags`

**RLS Policy**:
- All queries must filter by tenant context via `activite_id` (activities are tenant-scoped)

---

### 3. rso_recherches_enregistrees

**Purpose**: Stores user's saved search criteria for future reuse and automated alerts.

**Columns**:

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INT | PRIMARY KEY, AUTO_INCREMENT | Unique identifier |
| `user_id` | INT | NOT NULL, FK → rso_users(id) | Owner of the saved search |
| `nom` | VARCHAR(100) | NOT NULL | Custom name for the search |
| `description` | TEXT | NULL | Optional description |
| `criteres` | JSON | NOT NULL | Search criteria (structured data: query, filters, etc.) |
| `notification_active` | BOOLEAN | NOT NULL, DEFAULT FALSE | Whether alerts are enabled |
| `frequence_notification` | ENUM | NOT NULL, DEFAULT 'quotidien' | Alert frequency: 'immediate', 'quotidien', 'hebdomadaire' |
| `derniere_notification` | TIMESTAMP | NULL | Last notification timestamp |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT CURRENT_TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | NOT NULL, DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP | Last update timestamp |

**Indexes**:
- PRIMARY KEY: `id`
- INDEX: `idx_user` on (`user_id`)
- INDEX: `idx_notification` on (`notification_active`, `frequence_notification`)

**Validation Rules**:
- `criteres` must be valid JSON
- `nom` must be unique per user (enforced by application logic)
- `frequence_notification` must be valid enum value

**RLS Policy**:
- All queries must filter by `user_id` (users are tenant-scoped)
- Users can only access their own saved searches

**JSON Structure for `criteres`**:
```json
{
  "query": "string or null",
  "filters": {
    "annee_id": "number or null",
    "installation_id": "number or null",
    "type_activite": "string or null",
    "statut": "string or null",
    "tags": ["array of tag IDs"],
    "date_debut": "ISO date string or null",
    "date_fin": "ISO date string or null",
    "created_by": "number or null"
  },
  "sort": {
    "field": "string",
    "order": "ASC or DESC"
  }
}
```

---

### 4. rso_notifications

**Purpose**: Stores notifications for users about important events (recommendation deadlines, new activities, etc.).

**Columns**:

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INT | PRIMARY KEY, AUTO_INCREMENT | Unique identifier |
| `user_id` | INT | NOT NULL, FK → rso_users(id) | Recipient user |
| `type` | ENUM | NOT NULL | Type: 'recommandation_nouvelle', 'recommandation_echeance', 'recommandation_retard', 'activite_nouvelle', 'activite_modifiee', 'commentaire', 'validation', 'autre' |
| `titre` | VARCHAR(255) | NOT NULL | Notification title |
| `message` | TEXT | NOT NULL | Notification message |
| `entite_type` | VARCHAR(50) | NULL | Related entity type: 'activite', 'recommandation', etc. |
| `entite_id` | INT | NULL | Related entity ID |
| `url` | VARCHAR(500) | NULL | Direct link to related entity |
| `lue` | BOOLEAN | NOT NULL, DEFAULT FALSE | Read status |
| `lue_le` | TIMESTAMP | NULL | Read timestamp |
| `priorite` | ENUM | NOT NULL, DEFAULT 'normale' | Priority: 'basse', 'normale', 'haute', 'urgente' |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT CURRENT_TIMESTAMP | Creation timestamp |
| `expire_le` | TIMESTAMP | NULL | Expiration timestamp (auto-cleanup after 30 days if not set) |

**Indexes**:
- PRIMARY KEY: `id`
- INDEX: `idx_user_lue` on (`user_id`, `lue`)
- INDEX: `idx_type` on (`type`)
- INDEX: `idx_priorite` on (`priorite`)
- INDEX: `idx_created_at` on (`created_at`)

**Validation Rules**:
- `titre` and `message` must not be empty
- `expire_le` defaults to 30 days from creation if not set
- `lue_le` is set automatically when `lue` changes to TRUE

**RLS Policy**:
- All queries must filter by `user_id` (users are tenant-scoped)
- Users can only access their own notifications

---

### 5. rso_rapports_planifies

**Purpose**: Stores scheduled report configurations that execute automatically at specified intervals.

**Columns**:

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INT | PRIMARY KEY, AUTO_INCREMENT | Unique identifier |
| `user_id` | INT | NOT NULL, FK → rso_users(id) | Creator/owner of the scheduled report |
| `nom` | VARCHAR(100) | NOT NULL | Report name |
| `description` | TEXT | NULL | Optional description |
| `type_rapport` | ENUM | NOT NULL | Report type: 'activites', 'recommandations', 'statistiques', 'personnalise' |
| `parametres` | JSON | NOT NULL | Report parameters (filters, time period, etc.) |
| `frequence` | ENUM | NOT NULL | Frequency: 'quotidien', 'hebdomadaire', 'mensuel', 'trimestriel' |
| `jour_semaine` | INT | NULL | Day of week (1=Monday, 7=Sunday) for weekly frequency |
| `jour_mois` | INT | NULL | Day of month (1-31) for monthly/quarterly frequency |
| `heure` | TIME | NOT NULL, DEFAULT '08:00:00' | Execution time |
| `format` | ENUM | NOT NULL | Output format: 'pdf', 'excel', 'csv', 'email' |
| `email_destinataires` | TEXT | NULL | JSON array of email addresses |
| `actif` | BOOLEAN | NOT NULL, DEFAULT TRUE | Active status |
| `derniere_execution` | TIMESTAMP | NULL | Last execution timestamp |
| `prochaine_execution` | TIMESTAMP | NULL | Next execution timestamp (calculated) |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT CURRENT_TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | NOT NULL, DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP | Last update timestamp |

**Indexes**:
- PRIMARY KEY: `id`
- INDEX: `idx_user` on (`user_id`)
- INDEX: `idx_prochaine_execution` on (`prochaine_execution`, `actif`)

**Validation Rules**:
- `jour_semaine` must be 1-7 if `frequence` is 'hebdomadaire'
- `jour_mois` must be 1-31 if `frequence` is 'mensuel' or 'trimestriel'
- `email_destinataires` must be valid JSON array if `format` is 'email'
- `parametres` must be valid JSON
- `prochaine_execution` is calculated automatically based on frequency and current time

**RLS Policy**:
- All queries must filter by `user_id` (users are tenant-scoped)
- Users can only access their own scheduled reports

**JSON Structure for `parametres`**:
```json
{
  "filters": {
    "annee_id": "number or null",
    "installation_id": "number or null",
    "type_activite": "string or null",
    "statut": "string or null",
    "date_debut": "ISO date string or null",
    "date_fin": "ISO date string or null"
  },
  "include_details": "boolean",
  "group_by": "string or null"
}
```

---

### 6. rso_recommandations_historique

**Purpose**: Tracks all changes and events related to recommendations for audit trail and history viewing.

**Columns**:

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INT | PRIMARY KEY, AUTO_INCREMENT | Unique identifier |
| `recommandation_id` | INT | NOT NULL, FK → rso_recommandations(id) ON DELETE CASCADE | Recommendation reference |
| `user_id` | INT | NOT NULL, FK → rso_users(id) | User who performed the action |
| `action` | ENUM | NOT NULL | Action type: 'creation', 'modification', 'changement_statut', 'commentaire', 'validation', 'cloture' |
| `ancien_statut` | VARCHAR(50) | NULL | Previous status (if status change) |
| `nouveau_statut` | VARCHAR(50) | NULL | New status (if status change) |
| `commentaire` | TEXT | NULL | Optional comment |
| `donnees_modifiees` | JSON | NULL | Modified data (structured, for detailed tracking) |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT CURRENT_TIMESTAMP | Action timestamp |

**Indexes**:
- PRIMARY KEY: `id`
- INDEX: `idx_recommandation` on (`recommandation_id`)
- INDEX: `idx_action` on (`action`)
- INDEX: `idx_created_at` on (`created_at`)

**Validation Rules**:
- `action` must be valid enum value
- `ancien_statut` and `nouveau_statut` must be provided if `action` is 'changement_statut'
- `donnees_modifiees` must be valid JSON if provided

**RLS Policy**:
- All queries must filter by tenant context via `recommandation_id` (recommendations are tenant-scoped)

**JSON Structure for `donnees_modifiees`**:
```json
{
  "field_name": {
    "old": "old value",
    "new": "new value"
  },
  "another_field": {
    "old": "old value",
    "new": "new value"
  }
}
```

---

## Enhanced Tables

### 7. rso_recommandations (Enhanced)

**Purpose**: Extended with additional fields for enhanced recommendation management.

**New Columns** (added to existing Phase 3 table):

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `categorie` | VARCHAR(50) | NULL | Recommendation category |
| `impact` | ENUM | NOT NULL, DEFAULT 'moyen' | Impact level: 'faible', 'moyen', 'eleve', 'critique' |
| `cout_estime` | DECIMAL(10,2) | NULL | Estimated cost |
| `delai_jours` | INT | NULL | Estimated duration in days |
| `piece_jointe` | VARCHAR(500) | NULL | Attachment file path |
| `validation_requise` | BOOLEAN | NOT NULL, DEFAULT FALSE | Whether validation is required |
| `validee_par` | INT | NULL, FK → rso_users(id) | User who validated |
| `date_validation` | TIMESTAMP | NULL | Validation timestamp |
| `commentaire_validation` | TEXT | NULL | Validation comment |

**New Indexes**:
- INDEX: `idx_impact` on (`impact`)
- INDEX: `idx_validation_requise` on (`validation_requise`)
- INDEX: `idx_date_echeance` on (`date_echeance`) (for deadline queries)

**Validation Rules**:
- `cout_estime` must be non-negative if provided
- `delai_jours` must be positive if provided
- `validee_par` and `date_validation` must be set together if `validation_requise` is TRUE
- `commentaire_validation` is required if validation is performed

---

## Full-Text Search Configuration

### PostgreSQL Full-Text Search Setup

**Indexes for Search**:

```sql
-- Full-text search index on activities
CREATE INDEX idx_activites_recherche ON rso_activites 
USING GIN (to_tsvector('french', COALESCE(titre, '') || ' ' || COALESCE(contenu_texte, '')));

-- Full-text search index on recommendations
CREATE INDEX idx_recommandations_recherche ON rso_recommandations 
USING GIN (to_tsvector('french', COALESCE(titre, '') || ' ' || COALESCE(description, '')));
```

**French Language Configuration**:

- Use `'french'` text search configuration for `to_tsvector` and `to_tsquery`
- Ensure French language dictionary is installed in PostgreSQL
- Configure stop words for French language

---

## Migration Notes

1. **Create new tables** in order: rso_tags, rso_activites_tags, rso_recherches_enregistrees, rso_notifications, rso_rapports_planifies, rso_recommandations_historique
2. **Alter rso_recommandations** table to add new columns
3. **Create indexes** for performance (full-text, foreign keys, common queries)
4. **Set up RLS policies** for all new tables
5. **Create full-text search indexes** on existing tables
6. **Populate initial tags** if needed (optional seed data)

---

## Data Relationships Summary

- **Tags ↔ Activities**: Many-to-many via `rso_activites_tags`
- **Users ↔ Saved Searches**: One-to-many (users have many saved searches)
- **Users ↔ Notifications**: One-to-many (users receive many notifications)
- **Users ↔ Scheduled Reports**: One-to-many (users create many scheduled reports)
- **Recommendations ↔ History**: One-to-many (recommendations have many history entries)
- **Activities/Recommendations ↔ Notifications**: One-to-many (entities can generate many notifications)

All relationships respect tenant isolation through user/activity/recommendation tenant scoping.

