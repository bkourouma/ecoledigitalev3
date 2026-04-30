# Research: Phase 2 - Gestion des Installations RSO-PFSO

**Feature**: Phase 2 - Gestion des Installations RSO-PFSO  
**Date**: 2025-01-27  
**Status**: Complete

## Research Questions & Decisions

### 1. Installation Code Generation Strategy

**Question**: How should installation codes be generated automatically when not manually provided? Should we use a deterministic algorithm or allow manual override?

**Decision**: Implement a deterministic code generation algorithm based on port name and city, with automatic uniqueness checking and incremental suffix if conflicts occur. Always allow manual override.

**Rationale**:
- **Consistency**: Deterministic generation ensures predictable codes (PAD_XXX for Abidjan, PSP_XXX for San-Pedro)
- **User Control**: Manual override allows administrators to use preferred codes
- **Uniqueness**: Automatic conflict resolution prevents duplicate codes
- **Flexibility**: System accepts any valid format, not just generated patterns

**Algorithm**:
1. Extract city prefix (Abidjan → PAD, San-Pedro → PSP)
2. Take first 3 letters of port name (normalized, uppercase, no accents)
3. Combine: `{PREFIX}_{NAME_ABBREV}`
4. Check uniqueness, increment numeric suffix if needed: `{PREFIX}_{NAME_ABBREV}1`, `{PREFIX}_{NAME_ABBREV}2`, etc.

**Alternatives Considered**:
1. **Fully manual codes only**: Rejected because it increases user burden and potential for inconsistent formats
2. **UUID-based codes**: Rejected because they're not human-readable and don't follow business conventions
3. **Sequential numbering**: Rejected because codes should be meaningful (city + name abbreviation)

**Implementation Notes**:
- Code generation function in `installation-code-generator.ts`
- Real-time validation endpoint: `GET /api/rso/installations/check-code/:code`
- Client-side debounced validation during form input

---

### 2. Year Management: Scheduled Task Implementation

**Question**: What mechanism should be used for automatic year increment on January 1st? Should it be a cron job, database trigger, or application-level scheduled task?

**Decision**: Use node-cron scheduled task within the Fastify application, with database-level validation and manual trigger capability for recovery.

**Rationale**:
- **Reliability**: Application-level task can log errors and send notifications
- **Flexibility**: Can be manually triggered if automatic execution fails
- **Recovery**: Database constraints prevent duplicate years if task runs multiple times
- **Monitoring**: Application logs provide visibility into task execution

**Implementation**:
- Cron expression: `0 1 1 1 *` (January 1st at 01:00)
- Job file: `apps/api/src/jobs/rso/year-increment.job.ts`
- Database constraint: UNIQUE on `annee` column prevents duplicates
- Manual trigger endpoint: `POST /api/rso/annees/increment` (admin only)

**Alternatives Considered**:
1. **Database trigger**: Rejected because it's harder to monitor, log, and recover from failures
2. **External cron script**: Rejected because it requires separate deployment and monitoring infrastructure
3. **Manual-only**: Rejected because it's error-prone and requires administrator intervention every year

**Error Handling**:
- If task fails, log error and send notification to administrators
- Provide manual trigger endpoint for recovery
- Database constraint ensures no duplicate years even if task runs multiple times

---

### 3. Export Functionality: Excel and PDF Libraries

**Question**: Which libraries should be used for Excel and PDF export? Should exports be synchronous or asynchronous?

**Decision**: Use ExcelJS for Excel exports and PDFKit (or Puppeteer for complex layouts) for PDF exports. Implement asynchronous exports for large datasets (>50 installations) with progress tracking.

**Rationale**:
- **ExcelJS**: Industry standard, supports formatting, charts, and large files
- **PDFKit**: Lightweight, good for simple PDFs; Puppeteer for complex layouts with charts
- **Asynchronous**: Prevents request timeouts for large exports
- **Progress tracking**: Improves user experience for long-running exports

**Implementation**:
- Excel export: `exceljs` library with formatting and column widths
- PDF export: `pdfkit` for simple lists, `puppeteer` if charts/graphs needed
- Async exports: Queue job for >50 installations, return job ID, poll for completion
- Progress: WebSocket or polling endpoint for export status

**Alternatives Considered**:
1. **Synchronous exports only**: Rejected because it causes timeouts for large datasets
2. **CSV only**: Rejected because Excel format is required and provides better formatting
3. **External service**: Rejected because it adds complexity and dependency

**Performance Targets**:
- Excel export < 10 seconds for 50 installations (SC-006)
- PDF export < 15 seconds for 50 installations (SC-007)
- Async export with progress for 100+ installations

---

### 4. Year Selection Persistence Strategy

**Question**: How should the selected year be persisted across page navigation? Should it use localStorage, sessionStorage, server-side session, or URL parameters?

**Decision**: Use sessionStorage for year selection with server-side session fallback. URL parameters optional for sharing/bookmarking.

**Rationale**:
- **sessionStorage**: Persists across page navigation within same tab, clears on tab close (good UX)
- **Server-side session**: Backup for cross-device consistency and server-side filtering
- **URL parameters**: Optional for sharing specific year views
- **Priority**: sessionStorage → server session → URL parameter → default (current year)

**Implementation**:
- Client: `YearSelector` component stores in sessionStorage on change
- Server: Middleware reads from sessionStorage or session, sets in request context
- API: All year-dependent endpoints accept `?year=YYYY` parameter
- Default: Current year (active year) if no selection

**Alternatives Considered**:
1. **localStorage only**: Rejected because it persists across sessions, which may confuse users
2. **Server session only**: Rejected because it requires server round-trip on every navigation
3. **URL parameters only**: Rejected because it clutters URLs and requires manual parameter management

---

### 5. Soft Delete vs Hard Delete for Installations

**Question**: Should installations be permanently deleted or soft-deleted (archived)? What happens to related data (Agent PFSO assignments, responsible assignments)?

**Decision**: Implement soft delete (archiving) with `deleted_at` timestamp. Prevent deletion if installations have assigned Agent PFSO users. Maintain referential integrity for responsible assignments (keep history).

**Rationale**:
- **Data Preservation**: Soft delete maintains audit trail and allows recovery
- **Referential Integrity**: Foreign keys prevent orphaned records
- **Business Logic**: Cannot delete installations with active Agent PFSO users (business rule)
- **History**: Responsible assignments maintain complete history even after installation is archived

**Implementation**:
- `deleted_at TIMESTAMP NULL` column in `rso_installations` table
- Default queries exclude archived installations (`WHERE deleted_at IS NULL`)
- Separate archive page shows only archived installations
- Restore functionality sets `deleted_at = NULL`
- Permanent delete (hard delete) only available for archived installations without dependencies

**Cascade Behavior**:
- **Agent PFSO users**: Prevent deletion if any users assigned (FR-041)
- **Responsible assignments**: Keep history, mark as inactive if installation archived
- **Activities** (Phase 3): Reference archived installation, but filter out from active lists

**Alternatives Considered**:
1. **Hard delete only**: Rejected because it loses audit trail and prevents recovery
2. **Cascade delete**: Rejected because it would delete user assignments and history inappropriately
3. **Status flag only**: Rejected because `deleted_at` timestamp provides better audit trail

---

### 6. Real-time Code Uniqueness Validation

**Question**: How should installation code uniqueness be validated in real-time during form input? Should it be debounced, and how frequently should it check?

**Decision**: Implement debounced API endpoint for code uniqueness checking with 500ms delay. Cache recent checks client-side to reduce server load.

**Rationale**:
- **User Experience**: Real-time feedback improves form usability
- **Performance**: Debouncing prevents excessive API calls (one per 500ms max)
- **Server Load**: Caching recent checks reduces redundant validation requests
- **Response Time**: Target < 500ms for validation (SC-003)

**Implementation**:
- Endpoint: `GET /api/rso/installations/check-code/:code`
- Response: `{ exists: boolean, available: boolean }`
- Client: Debounce input with 500ms delay using lodash.debounce or custom hook
- Cache: Store recent checks in component state (last 10 codes checked)

**Alternatives Considered**:
1. **No real-time validation**: Rejected because it leads to form submission errors and poor UX
2. **Synchronous validation on blur**: Rejected because immediate feedback is better UX
3. **Validation on every keystroke**: Rejected because it creates excessive server load

---

### 7. Statistics Calculation: Real-time vs Cached

**Question**: Should installation statistics be calculated in real-time or cached? How should statistics be updated when data changes?

**Decision**: Calculate statistics in real-time with database aggregation queries. Cache results for 5 minutes to improve performance. Invalidate cache on data changes.

**Rationale**:
- **Accuracy**: Real-time calculation ensures statistics are always current
- **Performance**: Caching improves response time for dashboard loads
- **Simplicity**: No complex cache invalidation logic needed (short TTL)
- **Phase 3 Dependency**: Some statistics (activities, incidents) will be placeholders until Phase 3

**Implementation**:
- Statistics endpoint: `GET /api/rso/installations/stats?year=YYYY`
- Cache: In-memory cache with 5-minute TTL (Redis optional for multi-instance)
- Invalidation: Clear cache on installation create/update/delete
- Aggregation: SQL queries with COUNT, GROUP BY for distribution statistics

**Alternatives Considered**:
1. **Always real-time**: Rejected because it's slower for dashboard loads
2. **Long-term caching**: Rejected because statistics need to be relatively current
3. **Materialized views**: Rejected because they add complexity and may not be needed for current scale

---

## Summary of Technical Decisions

1. **Installation Code Generation**: Deterministic algorithm with uniqueness checking and manual override
2. **Year Increment**: node-cron scheduled task with manual trigger capability
3. **Export Libraries**: ExcelJS for Excel, PDFKit/Puppeteer for PDF, async for large datasets
4. **Year Persistence**: sessionStorage primary, server session fallback, URL parameter optional
5. **Soft Delete**: Archive with `deleted_at` timestamp, prevent deletion with dependencies
6. **Code Validation**: Debounced real-time API endpoint (500ms delay)
7. **Statistics**: Real-time calculation with 5-minute cache, invalidate on data changes

All decisions align with existing Phase 1 architecture and maintain consistency with EcoleDigitale codebase patterns.

