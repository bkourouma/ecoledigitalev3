# Research: Parent Payments & Finances Feature

**Date**: 2025-01-27  
**Feature**: Parent Payments & Finances (`009-parent-payments`)

## Overview

This document consolidates research findings and technical decisions for implementing the parent payments and finances feature. All clarifications from the specification phase have been incorporated.

## Technical Decisions

### Decision 1: Data Access Pattern

**Decision**: Use existing `student_parents` table relationships and `payment_transactions`, `student_tuition_installments`, `tuition_payment_schedules`, `payment_receipts` tables to query payment data for children linked to authenticated parent user.

**Rationale**: 
- The `student_parents` table already exists with proper RLS policies
- Provides parent-child relationship data with appropriate access control
- `payment_transactions` table contains all payment transactions
- `student_tuition_installments` table contains tuition installment data
- `tuition_payment_schedules` table contains payment schedule information
- `payment_receipts` table contains receipt information
- Supports multiple relationship types (parent, guardian, emergency_contact)

**Alternatives Considered**:
- Creating a new parent-payments view: Rejected - unnecessary duplication
- Direct queries to payment tables: Rejected - lacks relationship context and access control

**Implementation Notes**:
- Query joins `student_parents` with `student_profiles` to get linked children
- Join `payment_transactions` with `student_enrollments` to get payment data
- Join `student_tuition_installments` with `tuition_payment_schedules` to get installment data
- Filter by `parent_id` matching authenticated user ID
- Verify parent-child relationship before returning data

### Decision 2: Outstanding Balance Calculation

**Decision**: Calculate outstanding balances from unpaid installments and fees using existing payment transaction data.

**Rationale**:
- Existing `payment_transactions` table contains payment data with status
- Existing `student_tuition_installments` table contains installment data with status
- Balance calculation patterns already established in payment system
- Can reuse existing calculation logic for consistency

**Alternatives Considered**:
- Creating new balance calculation service: Rejected - would duplicate existing logic
- Direct database aggregation: Rejected - better to reuse existing validated patterns

**Implementation Notes**:
- Calculate outstanding balance: sum of unpaid installments + unpaid fees - paid amounts
- Group by fee type (tuition, inscription, annexes, autres)
- Support filtering by child and fee type
- Calculate amount paid: sum of completed transactions for each fee type
- Calculate amount due: total amount - amount paid

### Decision 3: Receipt Generation and Access

**Decision**: Use existing receipt generation system and provide download/view capability for parents.

**Rationale**:
- Existing `payment_receipts` table contains receipt information
- Receipt generation system already exists in the codebase
- Parents need access to receipts for record-keeping
- PDF generation already implemented

**Alternatives Considered**:
- Creating new receipt generation: Rejected - would duplicate existing functionality
- View-only receipts: Rejected - specification requires download capability

**Implementation Notes**:
- Query `payment_receipts` table for receipt data
- Use existing receipt URL for viewing/downloading
- Support filtering by child, fee type, and date range
- Provide both view (browser) and download (PDF) options

### Decision 4: Payment Method Display

**Decision**: Display saved payment methods from existing payment method storage (if available).

**Rationale**:
- Payment methods may be stored in the system or payment gateway
- Parents need to see their available payment options
- Display-only functionality matches specification requirement

**Alternatives Considered**:
- Creating new payment method storage: Rejected - out of scope for this feature
- Full payment method management: Rejected - specification limits to view-only

**Implementation Notes**:
- Query payment methods from existing storage (if available)
- Display method type, last 4 digits (for cards), expiration date (for cards), default status
- Support view-only functionality (no add/modify)

### Decision 5: API Endpoint Structure

**Decision**: Create `/api/v1/parent/payments` route group following existing pattern.

**Rationale**:
- Follows existing route organization (e.g., `/api/v1/parent/children`, `/api/v1/parent/homework`, `/api/v1/parent/grades`)
- Provides clear namespace for parent-specific payments endpoints
- Maintains consistency with codebase patterns

**Alternatives Considered**:
- Add to existing `/api/v1/parent/children` routes: Rejected - payments is separate concern
- Create `/api/v1/parent/finances` routes: Rejected - payments is more specific and matches specification

**Implementation Notes**:
- Endpoints:
  - `GET /api/v1/parent/payments/history` - List payment transactions (filterable by child, fee type, date range, status)
  - `GET /api/v1/parent/payments/installments` - Get tuition installments (filterable by child)
  - `GET /api/v1/parent/payments/schedules` - Get payment schedules (filterable by child)
  - `GET /api/v1/parent/payments/balances` - Get outstanding balances (filterable by child, fee type)
  - `GET /api/v1/parent/payments/receipts` - Get receipts (filterable by child, fee type, date range)
  - `GET /api/v1/parent/payments/methods` - Get payment methods

### Decision 6: Frontend Route Structure

**Decision**: Create `/parent/payments` route in Next.js app directory.

**Rationale**:
- Follows existing Next.js 15 app directory structure
- Matches API endpoint naming for consistency
- Provides dedicated page for payments functionality

**Alternatives Considered**:
- Add to existing `/parent/children` page: Rejected - payments is separate concern
- Nested under `/parent/children/:childId/payments`: Rejected - would require child selection first, limiting flexibility

**Implementation Notes**:
- Routes:
  - `/parent/payments` - Main payments page with tabs/sections for different views
- Components:
  - `PaymentHistory.tsx` - List of payment transactions with filters
  - `TuitionInstallments.tsx` - List of tuition installments
  - `PaymentSchedules.tsx` - List of payment schedules
  - `OutstandingBalances.tsx` - Outstanding balances by fee type
  - `Receipts.tsx` - List of receipts with download/view
  - `PaymentMethods.tsx` - List of payment methods

### Decision 7: Data Access Control

**Decision**: Enforce parent-child relationship check at API level using RLS and query filters.

**Rationale**:
- Specification requires: "Parents can only access payment information for children explicitly linked to their account"
- Existing RLS policies on `student_parents` provide database-level security
- Additional application-level check ensures correctness

**Alternatives Considered**:
- RLS only: Rejected - need explicit validation in API for clear error messages
- Application-level only: Rejected - defense in depth with RLS provides stronger security

**Implementation Notes**:
- Query filter: `WHERE student_parents.parent_id = $authenticated_user_id`
- Verify relationship exists before returning payment data
- Return 403 Forbidden if parent tries to access unlinked child's payments
- RLS policies automatically filter by tenant_id

## Dependencies

### Existing Dependencies
- `student_parents` table with RLS policies
- `student_profiles` table with student information
- `payment_transactions` table for payment transactions
- `student_tuition_installments` table for tuition installments
- `tuition_payment_schedules` table for payment schedules
- `payment_receipts` table for receipts
- `student_enrollments` table for enrollment information

### No New Dependencies Required
- All required database tables and relationships already exist
- Existing authentication and tenant context plugins can be reused
- No new external services or libraries needed

## Integration Points

### Backend Integration
- Reuse existing `tenantContextPlugin` for tenant isolation
- Reuse existing `authMiddleware` for authentication
- Extend existing query patterns from `student-payments.ts`
- Follow existing error handling and response patterns

### Frontend Integration
- Reuse existing TanStack Query hooks pattern from `use-parent-homework.ts`, `use-parent-grades.ts`
- Reuse existing UI components from `packages/ui`
- Follow existing page layout patterns from parent pages
- Use existing authentication session handling

## Performance Considerations

### Database Queries
- Use existing indexes on `student_parents(parent_id)`, `payment_transactions(student_id)`, `student_tuition_installments(student_id)`
- Pagination for payment history (20 per page) prevents large result sets
- Outstanding balance queries use aggregation for efficiency
- Receipt queries use date range filters for efficiency

### Caching Strategy
- Use TanStack Query with 5-minute stale time for payment data (similar to existing parent hooks)
- Cache outstanding balances with shorter stale time (2 minutes) for freshness
- Receipts not cached due to download/view requirements

## Security Considerations

### Access Control
- All queries filtered by parent-child relationship via `student_parents` table
- RLS policies enforce tenant isolation at database level
- API endpoints verify parent relationship before returning data
- No direct database access from frontend

### Data Privacy
- Only return payment data for children linked to authenticated parent
- No PII exposure beyond what's required for feature
- Receipt access restricted to parent account

## Testing Strategy

### Contract Tests
- Test all API endpoints with valid parent-child relationships
- Test access control (403 for unlinked children)
- Test balance calculations accuracy
- Test filtering by child, fee type, date range, status

### Integration Tests
- Test parent can view all their linked children's payments
- Test outstanding balance calculations accuracy
- Test receipt download/view functionality
- Test filtering and aggregation

### E2E Tests
- Test parent login and navigation to payments page
- Test viewing payment history with filters
- Test viewing tuition installments
- Test viewing outstanding balances
- Test downloading receipts

