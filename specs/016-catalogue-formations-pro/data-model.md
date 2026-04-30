# Data Model: Catalogue de Formations Professionnelles

**Date**: 2025-11-14  
**Feature**: 016-catalogue-formations-pro  
**Phase**: 1 - Design & Contracts

## Overview

This document defines the data model entities relevant to the professional training catalog feature. The catalog displays information from the `formations_professionnelles` and `sessions_professionnelles` tables created in Phase 1 (Feature 015). This feature is read-only for catalog browsing; training creation and management are handled separately.

## Entities Used

### 1. Formation Professionnelle (Training Program)

**Table**: `formations_professionnelles`  
**Purpose**: Represents a professional training program available in the catalog

**Key Fields for Catalog**:
- `id` (UUID, PK) - Unique identifier
- `tenant_id` (UUID, FK) - Multi-tenant isolation
- `titre` (VARCHAR(255)) - Training title (displayed in catalog)
- `slug` (VARCHAR(255)) - URL-friendly identifier (used in detail page URLs)
- `description_courte` (TEXT) - Short description (displayed in catalog cards)
- `description_complete` (TEXT) - Full description (displayed on detail page)
- `objectifs` (JSONB) - Learning objectives array (displayed on detail page)
- `programme_detaille` (JSONB) - Detailed program content (displayed on detail page)
- `prerequis` (TEXT) - Prerequisites (displayed on detail page)
- `public_cible` (TEXT) - Target audience (displayed on detail page)
- `duree_jours` (INTEGER) - Duration in days (used for filtering and display)
- `duree_heures` (INTEGER) - Duration in hours (used for filtering and display)
- `prix_ht` (DECIMAL(10,2)) - Price excluding tax (used for filtering and display)
- `prix_ttc` (DECIMAL(10,2)) - Price including tax (used for filtering and display)
- `type_certification` (VARCHAR(100)) - Certification type (displayed as badge)
- `nom_certification` (VARCHAR(255)) - Certification name (displayed on detail page)
- `themes` (JSONB) - Categories/themes array (used for filtering and recommendations)
- `niveau` (VARCHAR(50)) - Skill level: 'Débutant', 'Intermédiaire', 'Avancé' (used for filtering)
- `actif` (BOOLEAN) - Active status (only active trainings shown in catalog)

**Relationships**:
- One-to-Many: `sessions_professionnelles` - A training can have multiple scheduled sessions

**Indexes Used**:
- `idx_formations_professionnelles_tenant_id` - Tenant filtering
- `idx_formations_professionnelles_slug` - Detail page lookup
- `idx_formations_professionnelles_actif` - Active status filtering
- `idx_formations_professionnelles_themes` (GIN) - Theme filtering and search

**Full-Text Search Index** (to be created):
- `idx_formations_pro_fts` (GIN) - Full-text search on title and descriptions

---

### 2. Session Professionnelle (Training Session)

**Table**: `sessions_professionnelles`  
**Purpose**: Represents a scheduled instance of a training program

**Key Fields for Catalog**:
- `id` (UUID, PK) - Unique identifier
- `tenant_id` (UUID, FK) - Multi-tenant isolation
- `formation_pro_id` (UUID, FK) - Parent training program
- `code_session` (VARCHAR(50)) - Session code (displayed for reference)
- `date_debut` (DATE) - Start date (used for sorting and filtering)
- `date_fin` (DATE) - End date (displayed on detail page)
- `horaires` (VARCHAR(100)) - Schedule (e.g., "9h-17h") (displayed on detail page)
- `mode_formation` (delivery_mode ENUM) - Delivery mode: 'presentiel', 'distanciel', 'hybride' (used for filtering)
- `lieu` (VARCHAR(500)) - Location (if presentiel) (displayed on detail page)
- `lien_visio` (VARCHAR(500)) - Video link (if distanciel) (displayed on detail page)
- `places_totales` (INTEGER) - Total capacity (displayed on detail page)
- `places_reservees` (INTEGER) - Reserved places (used for availability calculation)
- `places_disponibles` (INTEGER, GENERATED) - Available places (displayed on detail page)
- `prix_ht` (DECIMAL(10,2)) - Session-specific price excluding tax (can differ from base training)
- `prix_ttc` (DECIMAL(10,2)) - Session-specific price including tax
- `statut` (session_professional_status ENUM) - Session status (only 'ouverte' or 'planifiee' shown in catalog)

**ENUM Values**:
- `delivery_mode`: 'presentiel', 'distanciel', 'hybride'
- `session_professional_status`: 'planifiee', 'ouverte', 'complete', 'en_cours', 'terminee', 'annulee'

**Relationships**:
- Many-to-One: `formations_professionnelles` - Each session belongs to one training program

**Indexes Used**:
- `idx_sessions_professionnelles_tenant_id` - Tenant filtering
- `idx_sessions_professionnelles_formation_pro_id` - Lookup sessions for a training
- `idx_sessions_professionnelles_statut` - Status filtering
- `idx_sessions_professionnelles_date_debut` - Date sorting and filtering

**Filtering Rules**:
- Only sessions with `statut IN ('planifiee', 'ouverte')` are shown in catalog
- Only sessions with `date_debut >= CURRENT_DATE` are shown (upcoming sessions only)

---

## Data Access Patterns

### Catalog Listing Query
```sql
SELECT 
  f.id,
  f.titre,
  f.slug,
  f.description_courte,
  f.duree_jours,
  f.duree_heures,
  f.prix_ttc,
  f.niveau,
  f.type_certification,
  f.themes,
  MIN(sp.date_debut) as prochaine_session_date,
  MIN(sp.mode_formation) as prochaine_session_mode
FROM formations_professionnelles f
LEFT JOIN sessions_professionnelles sp ON f.id = sp.formation_pro_id
  AND sp.statut IN ('planifiee', 'ouverte')
  AND sp.date_debut >= CURRENT_DATE
WHERE f.tenant_id = $1
  AND f.actif = true
GROUP BY f.id
ORDER BY prochaine_session_date ASC NULLS LAST, f.titre ASC
```

### Detail Page Query
```sql
SELECT 
  f.*,
  json_agg(
    json_build_object(
      'id', sp.id,
      'code_session', sp.code_session,
      'date_debut', sp.date_debut,
      'date_fin', sp.date_fin,
      'horaires', sp.horaires,
      'mode_formation', sp.mode_formation,
      'lieu', sp.lieu,
      'places_disponibles', sp.places_disponibles,
      'prix_ttc', sp.prix_ttc
    ) ORDER BY sp.date_debut ASC
  ) FILTER (WHERE sp.id IS NOT NULL) as sessions
FROM formations_professionnelles f
LEFT JOIN sessions_professionnelles sp ON f.id = sp.formation_pro_id
  AND sp.statut IN ('planifiee', 'ouverte')
  AND sp.date_debut >= CURRENT_DATE
WHERE f.tenant_id = $1
  AND f.slug = $2
  AND f.actif = true
GROUP BY f.id
```

### Similar Trainings Query (Recommendations)
```sql
WITH current_formation AS (
  SELECT themes, niveau, duree_jours, prix_ttc
  FROM formations_professionnelles
  WHERE id = $1 AND tenant_id = $2
)
SELECT 
  f.id,
  f.titre,
  f.slug,
  f.description_courte,
  f.prix_ttc,
  -- Similarity score calculation
  (
    (SELECT COUNT(*) FROM jsonb_array_elements_text(f.themes) 
     WHERE value = ANY(SELECT jsonb_array_elements_text(cf.themes) FROM current_formation cf)) * 3
  ) +
  (CASE WHEN f.niveau = (SELECT niveau FROM current_formation) THEN 2 ELSE 0 END) +
  (CASE WHEN ABS(f.duree_jours - (SELECT duree_jours FROM current_formation)) <= 2 THEN 1 ELSE 0 END) +
  (CASE WHEN f.prix_ttc BETWEEN 
    (SELECT prix_ttc FROM current_formation) * 0.7 AND 
    (SELECT prix_ttc FROM current_formation) * 1.3 
   THEN 1 ELSE 0 END) as similarity_score
FROM formations_professionnelles f
CROSS JOIN current_formation cf
WHERE f.tenant_id = $2
  AND f.actif = true
  AND f.id != $1
HAVING similarity_score > 0
ORDER BY similarity_score DESC, f.titre ASC
LIMIT 4;
```

---

## Validation Rules

### Catalog Display Rules
1. **Active Only**: Only trainings with `actif = true` are displayed
2. **Upcoming Sessions Only**: Only sessions with `date_debut >= CURRENT_DATE` are shown
3. **Open Sessions Only**: Only sessions with `statut IN ('planifiee', 'ouverte')` are shown
4. **Tenant Isolation**: All queries must filter by `tenant_id` using RLS

### Search and Filter Rules
1. **Search**: Full-text search on `titre`, `description_courte`, `description_complete`
2. **Theme Filter**: Match any theme in the `themes` JSONB array
3. **Price Range**: Filter by `prix_ttc` between min and max
4. **Duration Range**: Filter by `duree_jours` between min and max
5. **Level Filter**: Exact match on `niveau` field
6. **Mode Filter**: Match sessions with `mode_formation` in selected modes
7. **Certification Filter**: Filter by presence of `type_certification` and `nom_certification`

---

## Notes

- **Read-Only Access**: This feature only reads from the database; no writes/modifications
- **Tenant Isolation**: All queries use RLS policies established in Phase 1
- **Performance**: Indexes from Phase 1 support efficient catalog queries
- **Full-Text Search**: Additional GIN index needed for full-text search (see research.md)
- **Sessions Aggregation**: Sessions are aggregated per training for catalog display
- **Future Enhancements**: May add view counts, popularity metrics, or user favorites (out of scope)

---

**Reference**: Complete schema documentation in `specs/015-imhotep-data-schema/data-model.md`

