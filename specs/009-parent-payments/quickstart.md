# Quickstart: Parent Payments & Finances

**Date**: 2025-01-27  
**Feature**: Parent Payments & Finances (`009-parent-payments`)

## Overview

This quickstart guide provides a high-level overview of the parent payments and finances feature implementation.

## Feature Summary

Enable parents to view and track their children's payment history, tuition installments, payment schedules, outstanding balances, receipts, and payment methods through a dedicated payments interface. The feature provides:

1. **Payment History**: List of all payment transactions with filters
2. **Tuition Installments**: List of tuition installments with due dates and status
3. **Payment Schedules**: Payment schedules with installment information
4. **Outstanding Balances**: Outstanding balances by fee type
5. **Receipts**: Payment receipts with download/view capability
6. **Payment Methods**: Saved payment methods (view-only)

## Key Components

### Backend (`apps/api/src/routes/parent-payments.ts`)

- `GET /api/v1/parent/payments/history` - List payment transactions
- `GET /api/v1/parent/payments/installments` - Get tuition installments
- `GET /api/v1/parent/payments/schedules` - Get payment schedules
- `GET /api/v1/parent/payments/balances` - Get outstanding balances
- `GET /api/v1/parent/payments/receipts` - Get receipts
- `GET /api/v1/parent/payments/methods` - Get payment methods

### Frontend (`apps/web/src/app/parent/payments/`)

- `page.tsx` - Main payments page with tabs/sections
- `components/payments/PaymentHistory.tsx` - Payment history component
- `components/payments/TuitionInstallments.tsx` - Tuition installments component
- `components/payments/PaymentSchedules.tsx` - Payment schedules component
- `components/payments/OutstandingBalances.tsx` - Outstanding balances component
- `components/payments/Receipts.tsx` - Receipts component
- `components/payments/PaymentMethods.tsx` - Payment methods component

### Hooks (`apps/web/src/lib/hooks/use-parent-payments.ts`)

- `usePaymentHistory(childId, filters, page)` - Fetch payment history
- `useTuitionInstallments(childId)` - Fetch tuition installments
- `usePaymentSchedules(childId)` - Fetch payment schedules
- `useOutstandingBalances(childId, filters)` - Fetch outstanding balances
- `useReceipts(childId, filters, page)` - Fetch receipts
- `usePaymentMethods()` - Fetch payment methods

## Data Model

### Key Tables

- `student_parents` - Parent-child relationships
- `payment_transactions` - Payment transactions
- `student_tuition_installments` - Tuition installments
- `tuition_payment_schedules` - Payment schedules
- `payment_receipts` - Payment receipts
- `student_enrollments` - Enrollment information

### Key Queries

1. **Payment History**: Query `payment_transactions` joined with `student_profiles`, filtered by parent-child relationship
2. **Tuition Installments**: Query `student_tuition_installments` joined with `tuition_payment_schedules`, filtered by parent-child relationship
3. **Payment Schedules**: Query `tuition_payment_schedules` joined with `student_profiles`, filtered by parent-child relationship
4. **Outstanding Balances**: Aggregate from `student_tuition_installments` and `payment_transactions`, grouped by fee type
5. **Receipts**: Query `payment_receipts` joined with `payment_transactions` and `student_profiles`, filtered by parent-child relationship
6. **Payment Methods**: Query payment methods from existing storage (if available)

## Implementation Steps

1. **Backend API Endpoints**: Create `parent-payments.ts` route file with all six endpoints
2. **Data Access Control**: Verify parent-child relationship for all queries
3. **Balance Calculations**: Implement outstanding balance calculations from unpaid installments and fees
4. **Frontend Hooks**: Create React Query hooks for data fetching
5. **Frontend Components**: Create components for each view (history, installments, schedules, balances, receipts, methods)
6. **Receipt Download/View**: Integrate receipt viewing and downloading functionality
7. **Testing**: Add contract tests, integration tests, and E2E tests

## Testing

- **Contract Tests**: Test all API endpoints with valid parent-child relationships
- **Integration Tests**: Test balance calculations accuracy and filtering
- **E2E Tests**: Test parent login, navigation, and viewing payments in UI

## Security

- All queries filtered by parent-child relationship via `student_parents` table
- RLS policies enforce tenant isolation at database level
- API endpoints verify parent relationship before returning data
- Only payment data for children linked to authenticated parent is returned

