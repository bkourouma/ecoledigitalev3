# Quickstart: Parent Reports & Documents

**Date**: 2025-01-27  
**Feature**: Parent Reports & Documents (`013-parent-documents`)

## Overview

This quickstart guide provides a high-level overview of the parent reports and documents feature implementation.

## Feature Summary

Enable parents to view and download reports and documents for their children including report cards, transcripts, attendance reports, and payment receipts. The feature provides:

1. **Report Cards**: View and download report cards for their children (child name, academic year, semester, report date, overall grade)
2. **Transcripts**: View and download transcripts for their children (child name, academic year, transcript date, total credits, GPA)
3. **Attendance Reports**: View and download attendance reports for their children (child name, academic year, report period, report date, attendance rate, total days, present days, absent days)
4. **Payment Receipts**: View and download payment receipts for their children's payments (child name, receipt number, payment date, amount, payment method, fee type, academic year)

## Key Components

### Backend (`apps/api/src/routes/parent-documents.ts`)

- `GET /api/v1/parent/documents/report-cards` - Get report cards for parent's children
- `GET /api/v1/parent/documents/transcripts` - Get transcripts for parent's children
- `GET /api/v1/parent/documents/attendance-reports` - Get attendance reports for parent's children
- `GET /api/v1/parent/documents/payment-receipts` - Get payment receipts for parent's children

### Frontend (`apps/web/src/app/parent/documents/`)

- `page.tsx` - Main documents page with tabs/sections
- `components/documents/ReportCards.tsx` - Report cards view with filtering
- `components/documents/Transcripts.tsx` - Transcripts view with filtering
- `components/documents/AttendanceReports.tsx` - Attendance reports view with filtering
- `components/documents/PaymentReceipts.tsx` - Payment receipts view with filtering

### Hooks (`apps/web/src/lib/hooks/use-parent-documents.ts`)

- `useReportCards(childId?, academicYearId?, semester?)` - Fetch report cards
- `useTranscripts(childId?, academicYearId?)` - Fetch transcripts
- `useAttendanceReports(childId?, academicYearId?, startDate?, endDate?)` - Fetch attendance reports
- `usePaymentReceipts(childId?, academicYearId?, startDate?, endDate?)` - Fetch payment receipts

## Data Model

### Key Tables

- `report_cards` - Report cards (may need to be created)
- `transcripts` - Transcripts (may need to be created)
- `attendance_reports` - Attendance reports (may need to be created)
- `payment_receipts` - Payment receipts (already exists)
- `payment_transactions` - Payment transactions (already exists)
- `assignment_submissions` - Assignment submissions with grades (already exists)
- `attendance_records` - Attendance records (already exists)
- `student_parents` - Parent-child relationships (already exists)
- `academic_years` - Academic year information (already exists)

### Key Queries

1. **Report Cards**: Query `report_cards` table (or generate from `assignment_submissions`) joined with `student_profiles`, `student_parents`, and `academic_years` filtered by parent ID
2. **Transcripts**: Query `transcripts` table (or generate from completed courses and grades) joined with `student_profiles`, `student_parents`, and `academic_years` filtered by parent ID
3. **Attendance Reports**: Query `attendance_reports` table (or generate from `attendance_records`) joined with `student_profiles`, `student_parents`, and `academic_years` filtered by parent ID
4. **Payment Receipts**: Query `payment_receipts` table joined with `payment_transactions`, `student_profiles`, `student_parents`, and `academic_years` filtered by parent ID

## Implementation Steps

1. **Backend API Endpoints**: Create `parent-documents.ts` route file with all four endpoints
2. **Data Access Control**: Verify authenticated user ID matches parent ID through `student_parents` relationship for all operations
3. **Filtering**: Implement filtering for all endpoints (child, academic year, semester, date range, etc.)
4. **Report Generation**: Implement report generation service (if on-demand generation is needed) or query stored reports
5. **Frontend Hooks**: Create React Query hooks for data fetching with filtering support
6. **Frontend Components**: Create components for each document type (report cards, transcripts, attendance reports, payment receipts)
7. **PDF Download/View**: Implement PDF download/view capability for all document types
8. **Testing**: Add contract tests, integration tests, and E2E tests

## Testing

- **Contract Tests**: Test all API endpoints with valid authenticated user
- **Integration Tests**: Test filtering, access control, and data retrieval
- **E2E Tests**: Test parent login, navigation, and viewing/downloading documents in UI

## Security

- All queries filtered by authenticated user ID through `student_parents` relationship
- RLS policies enforce tenant isolation at database level
- API endpoints verify parent-child relationship before returning data
- Only reports and documents for authenticated parent's linked children is returned
- Report downloads should be secured with proper authentication

