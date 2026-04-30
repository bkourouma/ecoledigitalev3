# Data Model: Phase 4 - Gestion des Médias et Documents

**Date**: 2025-11-30  
**Feature**: Phase 4 - Gestion des Médias et Documents  
**Plan**: [plan.md](./plan.md)  
**Spec**: [spec.md](./spec.md)

## Overview

This document describes the database schema extensions and new tables for Phase 4 media and document management. Phase 4 extends the `rso_activites_medias` table from Phase 3 with additional fields for comprehensive media management, and adds new tables for document exports and user quota tracking.

## Schema Extensions

### Extended: rso_activites_medias

**Purpose**: Stores media files (images, videos, documents, audio) attached to activities with comprehensive metadata and processing information. Extended from Phase 3 basic structure.

**Changes from Phase 3**:
- Added fields for thumbnail paths, optimized image paths, video metadata, EXIF data
- Added processing status tracking
- Added primary image flag for galleries
- Added soft delete support
- Extended type_media enum to include 'audio'

**Columns**:

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INT | PRIMARY KEY, AUTO_INCREMENT | Unique identifier |
| `activite_id` | INT | NOT NULL, FK → rso_activites(id) ON DELETE CASCADE | Activity reference |
| `type_media` | ENUM | NOT NULL | Type: 'image', 'video', 'document', 'audio' |
| `nom_fichier` | VARCHAR(255) | NOT NULL | Stored filename (UUID-based) |
| `nom_original` | VARCHAR(255) | NOT NULL | Original filename from upload |
| `chemin_fichier` | VARCHAR(500) | NOT NULL | Storage path to original file |
| `chemin_thumbnail` | VARCHAR(500) | NULL | Storage path to thumbnail (for images/videos) |
| `chemin_optimise` | VARCHAR(500) | NULL | Storage path to optimized version (for images) |
| `taille_octets` | BIGINT | NOT NULL | File size in bytes (original) |
| `taille_humaine` | VARCHAR(20) | NOT NULL | Human-readable size (e.g., "2.5 MB") |
| `mime_type` | VARCHAR(100) | NOT NULL | MIME type |
| `extension` | VARCHAR(10) | NOT NULL | File extension (lowercase) |
| `largeur` | INT | NULL | Image/video width in pixels |
| `hauteur` | INT | NULL | Image/video height in pixels |
| `duree_secondes` | INT | NULL | Video/audio duration in seconds |
| `legende` | TEXT | NULL | Caption/description |
| `description` | TEXT | NULL | Extended description |
| `ordre` | INT | NOT NULL, DEFAULT 0 | Display order in gallery |
| `est_principal` | BOOLEAN | NOT NULL, DEFAULT FALSE | Primary image flag for activity gallery |
| `statut` | ENUM | NOT NULL, DEFAULT 'en_cours' | Processing status: 'en_cours', 'traite', 'erreur' |
| `erreur_message` | TEXT | NULL | Error message if processing failed |
| `exif_data` | JSON | NULL | EXIF metadata for images (JSON format) |
| `url_original` | VARCHAR(500) | NULL | Public URL to original file |
| `url_optimise` | VARCHAR(500) | NULL | Public URL to optimized file |
| `url_thumbnail` | VARCHAR(500) | NULL | Public URL to thumbnail |
| `uploaded_by` | INT | NOT NULL, FK → rso_users(id) | Uploader user ID |
| `uploaded_at` | TIMESTAMP | NOT NULL, DEFAULT CURRENT_TIMESTAMP | Upload timestamp |
| `updated_at` | TIMESTAMP | NOT NULL, DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP | Last update timestamp |
| `deleted_at` | TIMESTAMP | NULL | Soft delete timestamp (NULL if not deleted) |

**Indexes**:
- PRIMARY KEY: `id`
- INDEX: `idx_activite` on (`activite_id`)
- INDEX: `idx_type` on (`type_media`)
- INDEX: `idx_ordre` on (`ordre`)
- INDEX: `idx_statut` on (`statut`)
- INDEX: `idx_uploaded_by` on (`uploaded_by`)
- INDEX: `idx_deleted_at` on (`deleted_at`) -- For cleanup queries
- INDEX: `idx_est_principal` on (`activite_id`, `est_principal`) -- For primary image queries

**Validation Rules**:
- `taille_octets` must be positive
- `mime_type` must be valid MIME type
- `chemin_fichier` must be within tenant-specific directory structure (`uploads/aspci/medias/...`)
- Images: max 10MB, types: jpg, jpeg, png, gif, webp, bmp
- Videos: max 100MB, types: mp4, webm, mov, ogg
- Documents: max 20MB, types: pdf, doc, docx, xls, xlsx, ppt, pptx
- `largeur` and `hauteur` must be positive if provided
- `duree_secondes` must be positive if provided
- `est_principal` can only be TRUE for one media per activity (enforced at application level)

**RLS Policy**:
- All queries must filter by `tenant_id = 'aspci'` (via activity relationship)
- Users can only see media for activities they have access to (via activity permissions)
- Media access respects activity permission system from Phase 3

**Storage Path Pattern**:
- Format: `uploads/aspci/medias/{YYYY}/{MM}/{type}/{uuid}.{ext}`
- Example: `uploads/aspci/medias/2024/11/image/a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg`
- Thumbnails: `uploads/aspci/medias/{YYYY}/{MM}/{type}/thumb_{uuid}.{ext}`
- Optimized: `uploads/aspci/medias/{YYYY}/{MM}/{type}/opt_{uuid}.{ext}`

---

## New Tables

### 1. rso_documents_exports

**Purpose**: Tracks generated export documents (PDF, Word, Excel) for activities or activity lists, with expiration and download tracking.

**Columns**:

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INT | PRIMARY KEY, AUTO_INCREMENT | Unique identifier |
| `activite_id` | INT | NULL, FK → rso_activites(id) ON DELETE CASCADE | Activity reference (NULL if list export) |
| `user_id` | INT | NOT NULL, FK → rso_users(id) | User who generated export |
| `type_export` | ENUM | NOT NULL | Export type: 'pdf', 'word', 'excel', 'csv' |
| `nom_fichier` | VARCHAR(255) | NOT NULL | Generated filename |
| `chemin_fichier` | VARCHAR(500) | NOT NULL | Storage path to export file |
| `taille_octets` | BIGINT | NOT NULL | File size in bytes |
| `format_page` | VARCHAR(20) | NULL | Page format: 'A4', 'Letter', etc. |
| `orientation` | VARCHAR(20) | NULL | Orientation: 'portrait', 'landscape' |
| `options_export` | JSON | NULL | Export options (JSON: includeImages, includeRecommendations, watermark, etc.) |
| `statut` | ENUM | NOT NULL, DEFAULT 'en_cours' | Generation status: 'en_cours', 'termine', 'erreur' |
| `erreur_message` | TEXT | NULL | Error message if generation failed |
| `expire_at` | TIMESTAMP | NULL | Expiration timestamp (for auto-cleanup, default: 30 days) |
| `nb_telechargements` | INT | NOT NULL, DEFAULT 0 | Download count |
| `dernier_telechargement` | TIMESTAMP | NULL | Last download timestamp |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT CURRENT_TIMESTAMP | Creation timestamp |

**Indexes**:
- PRIMARY KEY: `id`
- INDEX: `idx_user` on (`user_id`)
- INDEX: `idx_activite` on (`activite_id`)
- INDEX: `idx_statut` on (`statut`)
- INDEX: `idx_expire` on (`expire_at`) -- For cleanup queries
- INDEX: `idx_type_export` on (`type_export`)

**Validation Rules**:
- `taille_octets` must be positive
- `format_page` must be valid if provided ('A4', 'Letter', 'Legal', etc.)
- `orientation` must be 'portrait' or 'landscape' if provided
- `expire_at` must be in the future if provided
- `nb_telechargements` must be non-negative

**RLS Policy**:
- All queries must filter by `tenant_id = 'aspci'` (via user relationship)
- Users can only see their own exports (unless admin)
- Exports are automatically cleaned up after expiration

**Storage Path Pattern**:
- Format: `uploads/aspci/exports/{YYYY}/{MM}/{type_export}/{uuid}.{ext}`
- Example: `uploads/aspci/exports/2024/11/pdf/a1b2c3d4-e5f6-7890-abcd-ef1234567890.pdf`

---

### 2. rso_quotas_utilisateurs

**Purpose**: Tracks storage quota and usage for each user, with per-type limits and file counts.

**Columns**:

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INT | PRIMARY KEY, AUTO_INCREMENT | Unique identifier |
| `user_id` | INT | NOT NULL, UNIQUE, FK → rso_users(id) | User reference (one-to-one) |
| `quota_total_mo` | INT | NOT NULL, DEFAULT 1000 | Total quota in MB (default: 1000 MB = 1 GB) |
| `quota_utilise_mo` | DECIMAL(10,2) | NOT NULL, DEFAULT 0 | Used quota in MB (decimal for precision) |
| `limite_fichier_image_mo` | INT | NOT NULL, DEFAULT 10 | Max file size for images in MB |
| `limite_fichier_video_mo` | INT | NOT NULL, DEFAULT 100 | Max file size for videos in MB |
| `limite_fichier_document_mo` | INT | NOT NULL, DEFAULT 20 | Max file size for documents in MB |
| `nb_total_fichiers` | INT | NOT NULL, DEFAULT 0 | Total file count |
| `nb_images` | INT | NOT NULL, DEFAULT 0 | Image count |
| `nb_videos` | INT | NOT NULL, DEFAULT 0 | Video count |
| `nb_documents` | INT | NOT NULL, DEFAULT 0 | Document count |
| `dernier_upload` | TIMESTAMP | NULL | Last upload timestamp |
| `dernier_nettoyage` | TIMESTAMP | NULL | Last cleanup timestamp |
| `updated_at` | TIMESTAMP | NOT NULL, DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP | Last update timestamp |

**Indexes**:
- PRIMARY KEY: `id`
- UNIQUE: `unique_user` on (`user_id`)
- INDEX: `idx_user` on (`user_id`)
- INDEX: `idx_quota_utilise` on (`quota_utilise_mo`) -- For quota warning queries

**Validation Rules**:
- `quota_total_mo` must be positive
- `quota_utilise_mo` must be non-negative and <= `quota_total_mo`
- `limite_fichier_*_mo` must be positive
- All count fields must be non-negative
- `quota_utilise_mo` is calculated from sum of `taille_octets` in `rso_activites_medias` (maintained by triggers or application logic)

**RLS Policy**:
- All queries must filter by `tenant_id = 'aspci'` (via user relationship)
- Users can only see their own quota (unless admin)
- Administrators can view and modify all quotas

**Initialization**:
- Created automatically when user first uploads media
- Default quota: 1000 MB (1 GB)
- Quota usage calculated from existing media files on initialization

---

## Relationships

### Activity Media → Activity (N:1)
- Each media file belongs to one activity
- Foreign key: `rso_activites_medias.activite_id` → `rso_activites.id`
- Cascade delete: Media deleted when activity deleted (soft delete preserved)

### Activity Media → User (N:1)
- Each media file uploaded by one user
- Foreign key: `rso_activites_medias.uploaded_by` → `rso_users.id`
- Restrict delete: Cannot delete user if they have uploaded media (soft delete user instead)

### Document Export → Activity (N:1, optional)
- Each export optionally belongs to one activity (NULL for list exports)
- Foreign key: `rso_documents_exports.activite_id` → `rso_activites.id`
- Cascade delete: Export deleted when activity deleted

### Document Export → User (N:1)
- Each export generated by one user
- Foreign key: `rso_documents_exports.user_id` → `rso_users.id`
- Restrict delete: Cannot delete user if they have generated exports (soft delete user instead)

### User Quota → User (1:1)
- Each user has exactly one quota record
- Foreign key: `rso_quotas_utilisateurs.user_id` → `rso_users.id`
- Unique constraint ensures one quota per user
- Cascade delete: Quota deleted when user deleted

---

## State Transitions

### Media Processing Status

```
en_cours → traite (success)
en_cours → erreur (failure)
erreur → en_cours (retry)
```

### Export Generation Status

```
en_cours → termine (success)
en_cours → erreur (failure)
erreur → en_cours (retry)
```

---

## Data Integrity

### Quota Consistency

- `quota_utilise_mo` must equal sum of `taille_octets` / (1024 * 1024) for all non-deleted media files uploaded by user
- Maintained by:
  - Application-level calculation on upload/delete
  - Periodic reconciliation job (optional, for data integrity checks)
  - Database triggers (optional, for real-time updates)

### Primary Image Constraint

- Only one media per activity can have `est_principal = TRUE`
- Enforced at application level (not database constraint for flexibility)
- When setting new primary image, previous primary is set to FALSE

### File Path Consistency

- `chemin_fichier` must match actual file system path
- File must exist at path when `statut = 'traite'`
- Cleanup job removes orphaned files (files in database but not on disk, or vice versa)

---

## Migration Notes

### From Phase 3

1. **Extend `rso_activites_medias` table**:
   - Add new columns (nullable initially)
   - Migrate existing data: set `nom_original = nom_fichier`, `statut = 'traite'`
   - Generate thumbnails and optimized versions for existing images in background job

2. **Create new tables**:
   - `rso_documents_exports`
   - `rso_quotas_utilisateurs`

3. **Initialize quotas**:
   - Create quota records for all existing users
   - Calculate initial `quota_utilise_mo` from existing media files
   - Set default `quota_total_mo = 1000`

4. **Data migration**:
   - Update existing media with new fields
   - Generate missing thumbnails and optimized images
   - Set `est_principal = TRUE` for first image of each activity (if any)

---

## Performance Considerations

### Indexing Strategy

- Index on `activite_id` for fast media lookup by activity
- Index on `type_media` for filtering by type
- Index on `ordre` for gallery ordering
- Index on `deleted_at` for cleanup queries
- Composite index on `(activite_id, est_principal)` for primary image queries

### Query Optimization

- Use pagination for media library queries (limit/offset)
- Cache quota values in memory (invalidate on upload/delete)
- Batch quota updates for multiple file uploads
- Use database views for common queries (optional)

### Storage Optimization

- Store optimized images to reduce bandwidth
- Generate thumbnails on-demand or pre-generate (based on usage patterns)
- Clean up expired exports automatically
- Archive old media to cold storage (future enhancement)

---

## Security Considerations

### File Access

- Media files served through API with permission checks (not direct file access)
- Verify user has access to activity before serving media
- Log all media access for audit trail

### Quota Enforcement

- Pre-check quota before upload begins (prevent wasted transfers)
- Atomic quota updates (database transactions)
- Prevent quota overruns (block upload if would exceed quota)

### Export Security

- Verify user permissions before generating exports
- Validate export options (prevent path traversal)
- Clean up exports after expiration
- Rate limit export generation

