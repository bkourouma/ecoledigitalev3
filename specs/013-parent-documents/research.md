# Research: Parent Reports & Documents Feature

**Date**: 2025-01-27  
**Feature**: Parent Reports & Documents (`013-parent-documents`)

## Overview

This document consolidates research findings and technical decisions for implementing the parent reports and documents feature. All clarifications from the specification phase have been incorporated.

## Technical Decisions

### Decision 1: Data Access Pattern

**Decision**: Use existing `assignment_submissions`, `attendance_records`, `payment_receipts`, and `payment_transactions` tables. Query through parent-child relationships via `student_parents` table. Reports may be stored in separate tables or generated on-demand.

**Rationale**: 
- The `assignment_submissions` table already exists with grades and feedback data for report cards and transcripts
- The `attendance_records` table already exists with attendance data for attendance reports
- The `payment_receipts` table already exists with payment receipt data
- The `payment_transactions` table already exists with payment transaction data
- Reports may be stored in separate tables (e.g., `report_cards`, `transcripts`, `attendance_reports`) or generated on-demand from source data
- Supports multi-tenant RLS policies
- Parent-child relationships via `student_parents` enable proper access control

**Alternatives Considered**:
- Creating new tables for all reports: Rejected - would duplicate existing data, reports can be generated from source data
- Generating all reports on-demand: Rejected - performance concerns, better to store generated reports
- Hybrid approach: Preferred - generate reports on-demand or from stored reports if available

**Implementation Notes**:
- Query report cards from `report_cards` table (may need to be created) or generate from `assignment_submissions` and grades data
- Query transcripts from `transcripts` table (may need to be created) or generate from completed courses and grades data
- Query attendance reports from `attendance_reports` table (may need to be created) or generate from `attendance_records` data
- Query payment receipts from `payment_receipts` table (already exists)
- Verify authenticated user ID matches parent ID through `student_parents` relationship

### Decision 2: Report Cards Query Pattern

**Decision**: Query report cards from `report_cards` table (may need to be created) or generate from `assignment_submissions` and grades data joined with `student_profiles`, `student_parents`, and `academic_years`.

**Rationale**:
- Specification requires displaying child name, academic year, semester, report date, overall grade, and download/view capability
- Report cards may be pre-generated and stored, or generated on-demand
- Parent-child relationship verification ensures proper access control

**Alternatives Considered**:
- Always generate on-demand: Rejected - performance concerns for large datasets
- Always use stored reports: Rejected - reports may not exist for all periods
- Hybrid approach: Preferred - use stored reports if available, generate on-demand if not

**Implementation Notes**:
- Query `report_cards` table joined with `student_profiles`, `student_parents`, and `academic_years`
- Filter by child enrollment and parent-child relationship
- Support filtering by child, academic year, and semester
- Support download/view capability (PDF, HTML)

### Decision 3: Transcripts Query Pattern

**Decision**: Query transcripts from `transcripts` table (may need to be created) or generate from completed courses and grades data joined with `student_profiles`, `student_parents`, and `academic_years`.

**Rationale**:
- Specification requires displaying child name, academic year, transcript date, total credits, GPA, and download/view capability
- Transcripts may be pre-generated and stored, or generated on-demand
- Parent-child relationship verification ensures proper access control

**Alternatives Considered**:
- Always generate on-demand: Rejected - performance concerns for large datasets
- Always use stored transcripts: Rejected - transcripts may not exist for all periods
- Hybrid approach: Preferred - use stored transcripts if available, generate on-demand if not

**Implementation Notes**:
- Query `transcripts` table joined with `student_profiles`, `student_parents`, and `academic_years`
- Filter by child enrollment and parent-child relationship
- Support filtering by child and academic year
- Support download/view capability (PDF, HTML)

### Decision 4: Attendance Reports Query Pattern

**Decision**: Query attendance reports from `attendance_reports` table (may need to be created) or generate from `attendance_records` data joined with `student_profiles`, `student_parents`, and `academic_years`.

**Rationale**:
- Specification requires displaying child name, academic year, report period, report date, attendance rate, total days, present days, absent days, and download/view capability
- Attendance reports may be pre-generated and stored, or generated on-demand from attendance records
- Parent-child relationship verification ensures proper access control

**Alternatives Considered**:
- Always generate on-demand: Rejected - performance concerns for large datasets
- Always use stored reports: Rejected - reports may not exist for all periods
- Hybrid approach: Preferred - use stored reports if available, generate on-demand if not

**Implementation Notes**:
- Query `attendance_reports` table joined with `student_profiles`, `student_parents`, and `academic_years`
- Filter by child enrollment and parent-child relationship
- Support filtering by child, academic year, and date range
- Support download/view capability (PDF, HTML)

### Decision 5: Payment Receipts Query Pattern

**Decision**: Query payment receipts from existing `payment_receipts` table joined with `payment_transactions`, `student_profiles`, `student_parents`, and `academic_years`.

**Rationale**:
- Specification requires displaying child name, receipt number, payment date, amount, payment method, fee type, academic year, and download/view capability
- Payment receipts already exist in `payment_receipts` table
- Parent-child relationship verification ensures proper access control

**Alternatives Considered**:
- Generate receipts on-demand: Rejected - receipts are already generated and stored
- Use existing receipts table: Preferred - receipts already exist, just need to query them

**Implementation Notes**:
- Query `payment_receipts` table joined with `payment_transactions`, `student_profiles`, `student_parents`, and `academic_years`
- Filter by child enrollment and parent-child relationship
- Support filtering by child, academic year, and date range
- Support download/view capability (PDF, HTML)

### Decision 6: Report Generation Strategy

**Decision**: Support both stored reports and on-demand generation. Prefer stored reports if available, generate on-demand if not.

**Rationale**:
- Stored reports provide better performance and consistency
- On-demand generation ensures reports are always available even if not pre-generated
- Hybrid approach provides best of both worlds

**Alternatives Considered**:
- Always generate on-demand: Rejected - performance concerns for large datasets
- Always use stored reports: Rejected - reports may not exist for all periods
- Hybrid approach: Preferred - use stored reports if available, generate on-demand if not

**Implementation Notes**:
- Check for stored reports first
- If stored report exists, return it
- If stored report doesn't exist, generate on-demand
- Cache generated reports for future requests
- Support report generation in background jobs for better performance

### Decision 7: API Endpoint Structure

**Decision**: Create `/api/v1/parent/documents` route group following existing pattern.

**Rationale**:
- Follows existing route organization (e.g., `/api/v1/parent/children`, `/api/v1/parent/homework`, `/api/v1/parent/grades`, `/api/v1/parent/payments`, `/api/v1/parent/messages`, `/api/v1/parent/settings`, `/api/v1/parent/academic`)
- Provides clear namespace for parent-specific documents endpoints
- Maintains consistency with codebase patterns

**Alternatives Considered**:
- Add to existing `/api/v1/parent/payments` routes: Rejected - documents is separate concern and includes more than just payment receipts
- Create `/api/v1/parent/reports` routes: Rejected - documents is more comprehensive and includes receipts

**Implementation Notes**:
- Endpoints:
  - `GET /api/v1/parent/documents/report-cards` - Get report cards for parent's children
  - `GET /api/v1/parent/documents/transcripts` - Get transcripts for parent's children
  - `GET /api/v1/parent/documents/attendance-reports` - Get attendance reports for parent's children
  - `GET /api/v1/parent/documents/payment-receipts` - Get payment receipts for parent's children

### Decision 8: Frontend Route Structure

**Decision**: Create `/parent/documents` route in Next.js app directory.

**Rationale**:
- Follows existing Next.js 15 app directory structure
- Matches API endpoint naming for consistency
- Provides dedicated page for documents functionality

**Alternatives Considered**:
- Add to existing `/parent/payments` page: Rejected - documents is separate concern and includes more than just payment receipts
- Nested under `/parent/reports`: Rejected - documents is more comprehensive

**Implementation Notes**:
- Routes:
  - `/parent/documents` - Main documents page with tabs/sections for different document types
- Components:
  - `ReportCards.tsx` - Report cards view with filtering
  - `Transcripts.tsx` - Transcripts view with filtering
  - `AttendanceReports.tsx` - Attendance reports view with filtering
  - `PaymentReceipts.tsx` - Payment receipts view with filtering

### Decision 9: Data Access Control

**Decision**: Enforce parent user ID check at API level using authentication and query filters through `student_parents` relationship.

**Rationale**:
- Specification requires: "Parents can only view reports for their own linked children"
- Authentication provides user ID
- `student_parents` relationship provides parent-child link
- Additional query filters ensure correctness

**Alternatives Considered**:
- RLS only: Rejected - need explicit validation in API for clear error messages
- Application-level only: Rejected - defense in depth with RLS provides stronger security

**Implementation Notes**:
- Query filter: Join with `student_parents` table and filter by `parent_id = $authenticated_user_id`
- Verify authenticated user ID matches parent ID through `student_parents` relationship
- Return 403 Forbidden if parent tries to access another parent's children's reports
- RLS policies automatically filter by tenant_id

## Dependencies

### Existing Dependencies
- `assignment_submissions` table with grades and feedback data
- `attendance_records` table with attendance data
- `payment_receipts` table with payment receipt data
- `payment_transactions` table with payment transaction data
- `student_profiles` table with student information
- `student_parents` table with parent-child relationship data
- `academic_years` table with academic year information
- Authentication system for user ID verification
- Report generation service (may need to be created or extended)

### New Dependencies
- May need to create `report_cards` table if reports are stored
- May need to create `transcripts` table if transcripts are stored
- May need to create `attendance_reports` table if reports are stored
- Report generation service for on-demand report generation
- PDF generation library for report downloads

## Integration Points

### Backend Integration
- Reuse existing `tenantContextPlugin` for tenant isolation
- Reuse existing `authMiddleware` for authentication
- Extend existing query patterns from other parent routes
- Follow existing error handling and response patterns
- Use existing report generation service (if available) or create new one
- Use existing PDF generation utilities (if available)

### Frontend Integration
- Reuse existing TanStack Query hooks pattern from other parent hooks
- Reuse existing UI components from `packages/ui`
- Follow existing page layout patterns from parent pages
- Use existing authentication session handling
- Use existing filtering and pagination patterns
- Use existing PDF viewer component (if available)

## Performance Considerations

### Database Queries
- Use existing indexes on `student_parents(parent_id)`, `payment_receipts(transaction_id)`, `attendance_records(student_id)`, `assignment_submissions(student_id)`
- Report queries are parent-specific and should be fast with proper indexes
- Consider caching generated reports to avoid regeneration
- Use pagination for large result sets

### Caching Strategy
- Use TanStack Query with 5-minute stale time for documents data
- Cache generated reports with longer stale time (10 minutes) unless updated
- Invalidate cache on new report generation or updates

## Security Considerations

### Access Control
- All queries filtered by authenticated user ID through `student_parents` relationship
- RLS policies enforce tenant isolation at database level
- API endpoints verify parent-child relationship before returning data
- No direct database access from frontend

### Data Privacy
- Only return reports for authenticated parent's linked children
- No PII exposure beyond what's required for feature
- Report downloads should be secured with proper authentication
- Report URLs should be time-limited or require authentication

## Testing Strategy

### Contract Tests
- Test all API endpoints with valid authenticated user
- Test access control (403 for other users' children's reports)
- Test filtering functionality for all endpoints
- Test report download/view functionality

### Integration Tests
- Test parent can view report cards for their linked children
- Test parent can view transcripts for their linked children
- Test parent can view attendance reports for their linked children
- Test parent can view payment receipts for their linked children
- Test report generation (if on-demand generation is implemented)

### E2E Tests
- Test parent login and navigation to documents page
- Test viewing report cards with filtering
- Test viewing transcripts with filtering
- Test viewing attendance reports with filtering
- Test viewing payment receipts with filtering
- Test report download/view functionality

