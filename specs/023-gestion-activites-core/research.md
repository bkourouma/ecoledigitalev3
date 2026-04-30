# Research: Phase 3 - Gestion des Activités (CORE)

**Date**: 2025-11-30  
**Feature**: Phase 3 - Gestion des Activités (CORE)  
**Branch**: `023-gestion-activites-core`

## Research Objectives

This research document resolves all technical decisions and clarifications needed for implementing the activity management system, including rich text editor selection, PDF generation approach, full-text search implementation, image upload handling, and permission management patterns.

---

## 1. Rich Text Editor Selection

### Decision: Use TinyMCE 6.x or 7.x

**Rationale**:
- **Professional features**: TinyMCE provides comprehensive features required for activity reports (tables, images, videos, maps, galleries)
- **Mature ecosystem**: Well-documented, actively maintained, large community
- **Customization**: Extensive plugin system allows for custom buttons (Google Maps, image gallery)
- **Mobile support**: Responsive design works well on tablets and mobile devices
- **French localization**: Full French language support available
- **Integration**: Easy integration with React/Next.js via `@tinymce/tinymce-react`
- **Auto-save**: Built-in autosave plugin supports periodic saving
- **Content sanitization**: Can be configured with DOMPurify for XSS prevention
- **Performance**: Loads quickly (< 2 seconds) and handles large content efficiently

**Alternatives Considered**:
- **Quill.js**: 
  - ✅ Pros: Lightweight, modern API, good React integration
  - ❌ Cons: Less feature-rich out of the box, requires more custom development for advanced features (maps, galleries), smaller plugin ecosystem
  - **Decision**: Rejected - TinyMCE better matches requirements for professional document editing

- **CKEditor 5**:
  - ✅ Pros: Modern architecture, good React integration
  - ❌ Cons: More complex setup, steeper learning curve, less mature plugin ecosystem
  - **Decision**: Rejected - TinyMCE has better documentation and community support

**Implementation Notes**:
- Use `@tinymce/tinymce-react` package for React integration
- Configure with French locale (`language: 'fr_FR'`)
- Enable plugins: `advlist`, `autolink`, `lists`, `link`, `image`, `charmap`, `preview`, `anchor`, `searchreplace`, `visualblocks`, `code`, `fullscreen`, `insertdatetime`, `media`, `table`, `help`, `wordcount`, `save`, `autosave`, `codesample`
- Custom buttons for Google Maps and image gallery
- Configure image upload handler to POST to `/api/v1/rso/activites/upload-image`
- Set autosave interval to 30 seconds
- Integrate DOMPurify for content sanitization before saving

---

## 2. PDF Generation Approach

### Decision: Use Puppeteer for PDF Generation

**Rationale**:
- **HTML to PDF**: Puppeteer renders HTML content (from rich text editor) accurately to PDF
- **Professional output**: High-quality PDFs with proper formatting, images, tables, and styling
- **Flexibility**: Can customize headers, footers, page breaks, margins
- **Performance**: Generates PDFs in < 5 seconds for typical activity content (SC-005)
- **Existing infrastructure**: Project already uses Puppeteer (seen in Phase 6 - Document Generation)
- **Error handling**: Robust error handling and timeout management
- **Template support**: Can use HTML templates with activity data for consistent formatting

**Alternatives Considered**:
- **PDFKit**:
  - ✅ Pros: Lightweight, programmatic PDF creation
  - ❌ Cons: Requires manual layout programming, doesn't render HTML directly, more complex for rich content
  - **Decision**: Rejected - Puppeteer better handles HTML content from rich text editor

- **html-pdf-node**:
  - ✅ Pros: Simple API
  - ❌ Cons: Less maintained, fewer features, performance issues with complex content
  - **Decision**: Rejected - Puppeteer is more reliable and feature-rich

**Implementation Notes**:
- Create HTML template with activity data (title, metadata, content, recommendations)
- Use Puppeteer to render HTML to PDF with A4 format
- Configure margins: top/bottom 20mm, left/right 15mm
- Include logo, headers, footers, page numbers
- Handle large content with proper page breaks
- Implement timeout (30 seconds) and error handling
- Store generated PDFs temporarily or stream directly to response
- Clean up temporary files after generation

---

## 3. Full-Text Search Implementation

### Decision: Use PostgreSQL Full-Text Search with GIN Indexes

**Rationale**:
- **Native support**: PostgreSQL provides built-in full-text search capabilities
- **Performance**: GIN indexes enable fast searches (< 1 second for 1000 activities, SC-004)
- **Relevance ranking**: Built-in ranking algorithms (ts_rank, ts_rank_cd) for result ordering
- **No external dependencies**: No need for Elasticsearch or other search engines
- **Permission-aware**: Can combine full-text search with permission filters in single query
- **French language support**: PostgreSQL supports French text search with proper stemming
- **Scalability**: Handles expected scale (1000+ activities per year per installation)

**Alternatives Considered**:
- **Elasticsearch**:
  - ✅ Pros: Advanced search features, excellent scalability
  - ❌ Cons: Additional infrastructure, complexity, overkill for current scale
  - **Decision**: Rejected - PostgreSQL full-text search sufficient for requirements

- **pg_trgm (trigram)**:
  - ✅ Pros: Good for fuzzy matching
  - ❌ Cons: Less efficient for exact phrase matching, requires additional extension
  - **Decision**: Rejected - Standard full-text search better for activity content search

**Implementation Notes**:
- Create FULLTEXT index on `rso_activites.titre` and `rso_activites.contenu_texte`
- Use `to_tsvector('french', ...)` for French language processing
- Use `ts_rank()` or `ts_rank_cd()` for relevance scoring
- Combine with permission filters in WHERE clause
- Support phrase search with `phraseto_tsquery()`
- Highlight search terms in results using `ts_headline()`
- Implement pagination for large result sets

---

## 4. Image Upload Handling

### Decision: Direct Upload to File Storage with Validation

**Rationale**:
- **Security**: Server-side validation prevents malicious file uploads
- **Performance**: Direct upload avoids base64 encoding overhead
- **Storage**: Use existing MinIO/S3 compatible storage or local filesystem
- **Validation**: Validate file type (images only: jpg, jpeg, png, gif, webp), size (max 5MB), and content
- **Organization**: Store in tenant-specific directories: `uploads/aspci/activites/{year}/{activity_id}/`
- **URL generation**: Generate accessible URLs for rich text editor insertion

**Alternatives Considered**:
- **Base64 encoding**:
  - ✅ Pros: Simple, no separate upload endpoint
  - ❌ Cons: Increases payload size by ~33%, database bloat, performance issues
  - **Decision**: Rejected - Direct upload more efficient and scalable

- **Third-party CDN (Cloudinary, Imgur)**:
  - ✅ Pros: Automatic optimization, CDN delivery
  - ❌ Cons: Additional cost, external dependency, data privacy concerns
  - **Decision**: Rejected - Use existing file storage infrastructure

**Implementation Notes**:
- Create upload endpoint: `POST /api/v1/rso/activites/upload-image`
- Validate file: MIME type, file extension, file size (max 5MB)
- Scan for malicious content (optional but recommended)
- Generate unique filename to prevent collisions
- Store in tenant-specific directory structure
- Return URL for TinyMCE insertion: `{baseUrl}/uploads/aspci/activites/{year}/{activity_id}/{filename}`
- Handle errors gracefully with user-friendly messages
- Implement rate limiting to prevent abuse

---

## 5. HTML Content Sanitization

### Decision: Use DOMPurify for HTML Sanitization

**Rationale**:
- **Security**: Prevents XSS attacks by sanitizing HTML content from rich text editor
- **Performance**: Fast sanitization (< 100ms for typical content)
- **Configurability**: Can whitelist allowed tags and attributes
- **Maintenance**: Well-maintained, regularly updated for security
- **Server-side**: Run on backend before storing in database
- **Preserves formatting**: Maintains legitimate formatting while removing dangerous content

**Alternatives Considered**:
- **Manual regex sanitization**:
  - ✅ Pros: Full control
  - ❌ Cons: Error-prone, difficult to maintain, security risks
  - **Decision**: Rejected - DOMPurify is battle-tested and secure

- **xss library**:
  - ✅ Pros: Lightweight
  - ❌ Cons: Less feature-rich, less maintained
  - **Decision**: Rejected - DOMPurify has better documentation and community

**Implementation Notes**:
- Install `isomorphic-dompurify` for server-side sanitization
- Configure whitelist: allow common formatting tags (p, h1-h6, strong, em, ul, ol, li, table, img, a, etc.)
- Allow safe attributes: href, src, alt, title, class, style (with CSS sanitization)
- Sanitize before saving to database
- Also sanitize when displaying content (defense in depth)
- Log sanitization actions for audit purposes

---

## 6. Activity Code Generation

### Decision: Sequential Numbering with Format ACT-YYYY-CODE_INSTALLATION-TYPE-SOUS_TYPE-NNNN

**Rationale**:
- **Uniqueness**: Format ensures uniqueness across all activities
- **Readability**: Human-readable codes that convey meaning (year, installation, type)
- **Collision prevention**: Sequential numbering per combination prevents duplicates
- **Database constraint**: UNIQUE constraint on `code_activite` column enforces uniqueness
- **Generation logic**: Query max sequence number for combination, increment, format

**Implementation Notes**:
- Format: `ACT-{YYYY}-{INSTALLATION_CODE}-{TYPE_CODE}-{SOUS_TYPE_CODE}-{NNNN}`
- Example: `ACT-2024-PAD_COM-ENT-T1-001`
- Query: `SELECT MAX(CAST(SUBSTRING(code_activite FROM '(\d+)$') AS INTEGER)) FROM rso_activites WHERE code_activite LIKE 'ACT-{year}-{installation}-{type}-{subtype}-%'`
- Increment and pad with zeros: `001`, `002`, etc.
- Handle edge case: If no existing code, start at `001`
- Transaction-safe: Generate within database transaction to prevent race conditions

---

## 7. Permission Management Pattern

### Decision: Hybrid Approach (Visible to All OR Individual Permissions)

**Rationale**:
- **Flexibility**: Supports both broad sharing (all PFSO agents) and granular control (specific agents)
- **Performance**: Efficient querying with boolean flag (`visible_tous_pfso`) and junction table (`rso_activites_pfso_access`)
- **Simplicity**: Clear permission model easy to understand and maintain
- **ISPS compliance**: Allows sensitive activities to be restricted to specific agents

**Implementation Notes**:
- `rso_activites.visible_tous_pfso` boolean flag for "visible to all" permission
- `rso_activites_pfso_access` junction table for individual permissions
- Query logic: `WHERE (visible_tous_pfso = true AND installation_id = user_installation_id) OR (id IN (SELECT activite_id FROM rso_activites_pfso_access WHERE user_id = current_user_id))`
- When "visible to all" is checked, clear individual permissions (or ignore them)
- When "visible to all" is unchecked, require at least one individual permission
- Log all permission changes for audit trail
- Enforce at database query level, not just UI level

---

## 8. Auto-Save Implementation

### Decision: Client-Side Auto-Save with Server-Side Persistence

**Rationale**:
- **User experience**: Saves automatically without user action, prevents data loss
- **Performance**: Client-side debouncing reduces server load
- **Recovery**: Can recover drafts if user loses connection
- **TinyMCE integration**: TinyMCE autosave plugin handles client-side logic
- **Server endpoint**: Dedicated endpoint for draft saves (`PATCH /api/v1/rso/activites/:id/draft`)

**Implementation Notes**:
- Use TinyMCE autosave plugin with 30-second interval
- Save to localStorage as backup (client-side)
- POST to server every 30 seconds: `PATCH /api/v1/rso/activites/:id/draft` with content
- Store draft in `rso_activites.contenu_html` with `statut = 'brouillon'`
- On page load, restore from server (latest saved version)
- Show "Last saved: X minutes ago" indicator
- Warn user before leaving page if unsaved changes (TinyMCE `onbeforeunload` hook)
- Handle network errors gracefully (retry, show error message)

---

## 9. Google Maps Integration

### Decision: Embed Google Maps via iframe with API Key

**Rationale**:
- **User experience**: Users can search for addresses and insert maps visually
- **Professional output**: Maps display correctly in activity content and PDF exports
- **Implementation**: Simple iframe embedding with Google Maps Embed API
- **Cost**: Free tier sufficient for expected usage

**Implementation Notes**:
- Create modal in TinyMCE custom button for map insertion
- Use Google Maps Places Autocomplete for address search
- Generate embed URL: `https://www.google.com/maps/embed/v1/place?key={API_KEY}&q={address}`
- Insert iframe in editor: `<iframe src="{embed_url}" width="100%" height="400" style="border:0;"></iframe>`
- Store API key in environment variable: `GOOGLE_MAPS_API_KEY`
- Handle API key errors gracefully
- Maps display in both editor and final activity view
- PDF generation: Maps may not render in PDF (limitation), show placeholder or static image

---

## 10. Recommendation Status Workflow

### Decision: Linear Status Progression with Validation

**Rationale**:
- **Clear workflow**: Statuses progress logically: `en_attente` → `en_cours` → `terminee` → `validee`
- **Flexibility**: Can cancel recommendations (`annulee` status)
- **Audit trail**: Status changes logged with timestamps and user information
- **Business logic**: Only responsible person or formateur can update status

**Implementation Notes**:
- Status enum: `en_attente`, `en_cours`, `terminee`, `validee`, `annulee`
- Valid transitions:
  - `en_attente` → `en_cours` (by responsible person)
  - `en_cours` → `terminee` (by responsible person, requires `actions_prises` and `date_resolution`)
  - `terminee` → `validee` (by formateur RSO or admin)
  - Any → `annulee` (by formateur RSO or admin)
- Validate transitions in service layer
- Log status changes in audit table or activity log
- Calculate overdue: `date_echeance < CURRENT_DATE AND statut IN ('en_attente', 'en_cours')`
- Display overdue count in statistics

---

## 11. Database Full-Text Index Configuration

### Decision: Create GIN Index on titre and contenu_texte Columns

**Rationale**:
- **Performance**: GIN indexes provide fast full-text search
- **French language**: Configure with French text search configuration
- **Maintenance**: Automatic index updates on INSERT/UPDATE
- **Storage**: GIN indexes are larger but provide better query performance

**Implementation Notes**:
- Create index: `CREATE INDEX idx_activites_recherche ON rso_activites USING GIN (to_tsvector('french', titre || ' ' || COALESCE(contenu_texte, '')));`
- Use `french` text search configuration for proper stemming
- Query: `WHERE to_tsvector('french', titre || ' ' || COALESCE(contenu_texte, '')) @@ to_tsquery('french', ?)`
- Combine with permission filters in WHERE clause
- Use `ts_rank()` for relevance scoring
- Support phrase search with `phraseto_tsquery()`
- Highlight matches with `ts_headline()`

---

## Summary of Technical Decisions

| Decision Area | Chosen Solution | Rationale |
|---------------|----------------|-----------|
| Rich Text Editor | TinyMCE 6.x/7.x | Professional features, good React integration, French support |
| PDF Generation | Puppeteer | Accurate HTML rendering, professional output, existing infrastructure |
| Full-Text Search | PostgreSQL GIN indexes | Native support, performance, no external dependencies |
| Image Upload | Direct upload with validation | Security, performance, uses existing storage |
| HTML Sanitization | DOMPurify | Security, performance, well-maintained |
| Code Generation | Sequential with format | Uniqueness, readability, collision prevention |
| Permissions | Hybrid (visible all OR individual) | Flexibility, performance, ISPS compliance |
| Auto-Save | Client + Server | User experience, data loss prevention |
| Google Maps | iframe embed | User experience, professional output |
| Recommendation Workflow | Linear progression | Clear workflow, audit trail |

All technical decisions align with project architecture, performance requirements, and security standards. No unresolved clarifications remain.

