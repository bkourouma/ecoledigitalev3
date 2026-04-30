# Research: Phase 6 - Gestion Administrative & Documents

**Date**: 2025-01-27  
**Feature**: Phase 6 - Gestion Administrative & Documents (`020-phase`)  
**Phase**: 0 - Research & Technical Decisions

## Overview

This document consolidates research findings and technical decisions for implementing the administrative document management, enterprise client management, data exports, and reporting features. All clarifications from the specification phase have been incorporated.

## Technical Decisions

### Decision 1: Document Storage Strategy

**Decision**: Use existing FileStorageService for PDF document storage with a new `documents` table for metadata tracking.

**Rationale**: 
- FileStorageService already provides tenant-isolated file storage with proper path organization
- Database table needed for document metadata (type, number, generation date, relationships)
- Enables efficient querying and filtering of documents without scanning file system
- Supports document relationships (enrollment, session, enterprise) via foreign keys
- Allows tracking of document generation history and audit trail

**Alternatives Considered**:
- **File system only**: Rejected - no efficient querying, difficult to track relationships and metadata
- **Database only (BLOB)**: Rejected - large PDFs would bloat database, FileStorageService already optimized for file handling
- **Hybrid approach (chosen)**: Preferred - metadata in database, actual files in FileStorageService

**Implementation Notes**:
- Create `documents` table with fields: id, tenant_id, type, numero, inscription_id (nullable), session_id (nullable), entreprise_id (nullable), fichier_url, date_generation, genere_par, metadata (JSONB)
- Use FileStorageService with path structure: `{tenantId}/documents/{type}/{filename}`
- Document types: 'convention', 'attestation_presence', 'attestation_reussite', 'devis', 'facture', 'facture_groupee'

---

### Decision 2: PDF Generation Library

**Decision**: Use existing PDFKit library (already in codebase from invoice generation) for programmatic PDF creation.

**Rationale**:
- PDFKit is already used in `apps/api/src/services/invoice.service.ts` for invoice generation
- Provides fine-grained control over PDF layout and formatting
- Well-suited for structured documents with consistent templates
- Lower-level API allows precise positioning and styling
- No browser dependency (unlike Puppeteer)

**Alternatives Considered**:
- **Puppeteer (HTML-to-PDF)**: Available in codebase but better for complex layouts with React components. For structured documents like conventions/attestations, PDFKit is more appropriate.
- **PDFMake**: Document-based approach, less flexible for complex layouts with images and rich formatting.
- **PDFKit (chosen)**: Already proven in codebase, appropriate for structured administrative documents.

**Implementation Notes**:
- Reuse PDFKit patterns from invoice.service.ts
- Create document templates with consistent styling (headers, fonts, spacing)
- Support French locale formatting (dates, numbers, currency)
- Include Imhotep Data branding (logo, colors) in all documents

---

### Decision 3: Document Numbering Strategy

**Decision**: Generate sequential document numbers per type and year using application-level logic with database uniqueness constraint.

**Rationale**:
- Format: `PREFIX-YYYY-NNNN` (e.g., CONV-2024-0001, ATTP-2024-0001)
- Sequential numbering ensures no gaps and proper audit trail
- Year-based numbering prevents number exhaustion
- Application-level generation allows for retry logic and conflict handling
- Database UNIQUE constraint on (tenant_id, type, numero) ensures uniqueness

**Alternatives Considered**:
- **Database sequence**: Rejected - would require separate sequences per type/year, complex to manage
- **UUID-based**: Rejected - not human-readable, doesn't meet legal requirements for document numbering
- **Application-level sequential (chosen)**: Preferred - simple, readable, meets legal requirements

**Implementation Notes**:
- Query existing documents with matching prefix to get next number
- Use database transaction to prevent race conditions
- Handle concurrent generation attempts with retry logic
- Store full number in `numero` field, prefix extracted from type

---

### Decision 4: Batch Document Generation Strategy

**Decision**: Implement asynchronous batch generation with progress tracking and job queue.

**Rationale**:
- Large batches (50+ documents) would timeout HTTP requests
- Users need progress indication for long-running operations
- Error handling per document prevents single failure from blocking entire batch
- Job queue allows retry of failed documents

**Alternatives Considered**:
- **Synchronous with timeout extension**: Rejected - poor user experience, server resource blocking
- **Background job with polling**: Preferred - scalable, user-friendly, allows progress tracking
- **WebSocket for real-time updates**: Considered but adds complexity; polling sufficient for this use case

**Implementation Notes**:
- Create job record in database with status (pending, processing, completed, failed)
- Process documents sequentially or in small batches (10 at a time)
- Update job progress after each document generation
- Frontend polls job status endpoint every 2 seconds
- Return list of generated documents with success/failure status per document

---

### Decision 5: Enterprise Client SIRET Validation

**Decision**: Validate SIRET format (14 digits) and enforce uniqueness per tenant at application level.

**Rationale**:
- SIRET is French/Ivorian business registration number (14 digits)
- Uniqueness per tenant prevents duplicate enterprise records
- Format validation prevents invalid data entry
- Application-level validation allows for clear error messages

**Alternatives Considered**:
- **Database UNIQUE constraint only**: Rejected - doesn't validate format, error messages less user-friendly
- **External SIRET validation API**: Rejected - external dependency, potential latency, may not be available for Ivorian businesses
- **Application-level validation with database constraint (chosen)**: Preferred - format validation + uniqueness guarantee

**Implementation Notes**:
- Validate SIRET format: exactly 14 digits
- Check uniqueness: `SELECT COUNT(*) FROM entreprises_clientes WHERE tenant_id = $1 AND siret = $2`
- Return clear error message if duplicate or invalid format
- Allow SIRET to be nullable for international clients (if needed)

---

### Decision 6: Export File Format and Library

**Decision**: Use ExcelJS (already in codebase) for Excel exports, with CSV as alternative format.

**Rationale**:
- ExcelJS is already used in `apps/api/src/services/session-pro.service.ts` for session exports
- Supports formatting, multiple sheets, charts, and large datasets
- CSV format for simple exports and compatibility
- Both formats are standard and widely supported

**Alternatives Considered**:
- **XLSX (SheetJS)**: Used in frontend but ExcelJS more feature-rich for server-side generation
- **PDF exports**: Rejected - not suitable for data manipulation, better for reports than exports
- **ExcelJS + CSV (chosen)**: Preferred - already in codebase, supports all required features

**Implementation Notes**:
- Use ExcelJS for Excel exports with formatting (headers, colors, column widths)
- Support multiple sheets for grouped exports
- Include auto-filters on header rows
- CSV export for simple, unformatted data
- Handle large datasets with streaming if needed (10,000+ records)

---

### Decision 7: Reporting Metrics Calculation Strategy

**Decision**: Calculate metrics on-demand from source data with optional caching for frequently accessed periods.

**Rationale**:
- On-demand calculation ensures data accuracy (no stale cache)
- PostgreSQL aggregations are efficient for typical dataset sizes
- Caching can be added later if performance becomes an issue
- Simpler implementation without cache invalidation complexity

**Alternatives Considered**:
- **Pre-calculated metrics table**: Rejected - requires cache invalidation on every enrollment/payment change, complex to maintain
- **Materialized views**: Considered but adds complexity; on-demand calculation sufficient for current scale
- **On-demand with caching (chosen)**: Preferred - accurate, simple, can optimize later if needed

**Implementation Notes**:
- Use PostgreSQL aggregations (COUNT, SUM, GROUP BY) for metrics
- Calculate metrics for requested time period only
- Use database indexes for efficient date range queries
- Consider caching for dashboard metrics (5-minute TTL) if load becomes high

---

### Decision 8: Automatic Document Generation Triggers

**Decision**: Use webhook integration for payment confirmation → convention generation, cron job for session completion → attestation generation.

**Rationale**:
- Payment webhook already exists in Phase 4, can trigger convention generation
- Cron job for session completion checks daily for completed sessions
- Separates concerns: payment flow triggers conventions, session lifecycle triggers attestations
- Cron job allows batch processing of multiple completed sessions

**Alternatives Considered**:
- **All via webhooks**: Rejected - session completion doesn't have a webhook event
- **All via cron jobs**: Rejected - payment confirmation should be immediate, not delayed
- **Hybrid approach (chosen)**: Preferred - immediate for payment-triggered, scheduled for session-triggered

**Implementation Notes**:
- Integrate convention generation into payment confirmation webhook handler
- Create cron job that runs daily at 2 AM to check for sessions completed yesterday
- Generate attestations for all present participants in completed sessions
- Log all automatic generations for audit trail

---

### Decision 9: Quote Expiration Reminder Strategy

**Decision**: Use cron job to check for quotes expiring within 3 days and send email reminders.

**Rationale**:
- Cron job runs daily, checks all active quotes
- Sends reminder 3 days before expiration
- Prevents sending duplicate reminders (check if reminder already sent)
- Simple, reliable, doesn't require complex scheduling

**Alternatives Considered**:
- **Event-driven with scheduled tasks**: Rejected - adds complexity, cron job sufficient
- **Manual reminder system**: Rejected - doesn't meet requirement for automatic reminders
- **Cron job (chosen)**: Preferred - simple, reliable, meets requirements

**Implementation Notes**:
- Cron job runs daily at 9 AM
- Query quotes where `metadata->>'validite_jusqu_au'` is between today and 3 days from now
- Check if reminder already sent (store in metadata or separate flag)
- Send email with quote details and expiration date
- Use existing email service infrastructure

---

### Decision 10: Large Export Handling

**Decision**: Implement asynchronous export generation with job queue and file download link.

**Rationale**:
- Exports of 10,000+ records can take 30+ seconds
- HTTP request timeout would occur for large exports
- User needs notification when export is ready
- File can be stored temporarily and downloaded via link

**Alternatives Considered**:
- **Synchronous with timeout extension**: Rejected - poor user experience, server resource blocking
- **Streaming response**: Considered but complex for Excel format, better for CSV
- **Asynchronous job with download link (chosen)**: Preferred - scalable, user-friendly, supports all formats

**Implementation Notes**:
- Create export job record with status and file URL
- Generate export file asynchronously
- Store file in FileStorageService with temporary path
- Return job ID to frontend
- Frontend polls job status, shows download link when ready
- Clean up temporary files after 7 days

---

## Summary

All technical decisions have been made based on existing codebase patterns, feature requirements, and best practices. The implementation will leverage existing infrastructure (FileStorageService, PDFKit, ExcelJS) while adding new capabilities for document management, enterprise client management, exports, and reporting.

