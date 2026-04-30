# Data Model: Parent Payments & Finances Feature

**Date**: 2025-01-27  
**Feature**: Parent Payments & Finances (`009-parent-payments`)

## Overview

This document defines the data model for the parent payments and finances feature. The feature leverages existing database tables and relationships, with no new tables required.

## Entities

### Parent-Child Relationship

**Source Table**: `student_parents`

**Purpose**: Links parent user accounts to student profiles, establishing the relationship that enables parent access to child's payment data.

**Key Attributes**:
- `id` (UUID) - Primary key
- `tenant_id` (UUID) - Multi-tenant isolation
- `student_id` (UUID) - References `student_profiles.id`
- `parent_id` (UUID) - References `users.id` (authenticated parent user)
- `relationship_type` (ENUM) - 'parent', 'guardian', 'emergency_contact'
- `is_primary_contact` (BOOLEAN) - Primary contact flag
- `emergency_contact` (BOOLEAN) - Emergency contact flag
- `can_pickup` (BOOLEAN) - Pickup authorization
- `notes` (TEXT) - Additional notes
- `created_at` (TIMESTAMP) - Creation timestamp

**Relationships**:
- Many-to-one with `student_profiles` (via `student_id`)
- Many-to-one with `users` (via `parent_id`)
- Many-to-one with `tenants` (via `tenant_id`)

**Query Pattern**: 
```sql
SELECT sp.*, u.first_name, u.last_name, u.email
FROM student_parents sp_rel
JOIN student_profiles sp ON sp_rel.student_id = sp.id
JOIN users u ON sp.user_id = u.id
WHERE sp_rel.parent_id = $parent_id
  AND sp_rel.tenant_id = $tenant_id
```

### Payment Transaction

**Source Table**: `payment_transactions`

**Purpose**: Represents a payment transaction for a student, used for displaying payment history.

**Key Attributes**:
- `id` (UUID) - Primary key (transaction_id)
- `tenant_id` (UUID) - Multi-tenant isolation
- `student_id` (UUID) - References `student_profiles.id`
- `enrollment_id` (UUID) - References `student_enrollments.id`
- `tuition_installment_id` (UUID) - References `student_tuition_installments.id` (NULL for non-tuition fees)
- `fee_type` (ENUM) - 'tuition', 'inscription', 'annexes', 'autres'
- `external_transaction_id` (VARCHAR) - External transaction ID (e.g., TresorPay)
- `amount` (DECIMAL) - Payment amount
- `currency` (VARCHAR) - Currency code (default 'XOF')
- `payment_method` (ENUM) - Payment method type
- `status` (ENUM) - 'pending', 'completed', 'failed', 'cancelled'
- `gateway_response` (JSONB) - Gateway response data
- `receipt_url` (TEXT) - URL to generated receipt PDF
- `processed_at` (TIMESTAMPTZ) - When payment was processed
- `created_by` (UUID) - References `users.id` (who initiated the payment)
- `created_at` (TIMESTAMPTZ) - Creation timestamp
- `updated_at` (TIMESTAMPTZ) - Last update timestamp

**Relationships**:
- Many-to-one with `student_profiles` (via `student_id`)
- Many-to-one with `student_enrollments` (via `enrollment_id`)
- Many-to-one with `student_tuition_installments` (via `tuition_installment_id`, nullable)
- Many-to-one with `users` (via `created_by`)

**Query Pattern for Payment History**:
```sql
SELECT 
  pt.id as transaction_id,
  pt.student_id,
  pt.enrollment_id,
  pt.tuition_installment_id,
  pt.fee_type,
  pt.amount,
  pt.currency,
  pt.payment_method,
  pt.status,
  pt.receipt_url,
  pt.processed_at,
  pt.created_at,
  sp.id as child_id,
  COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name
FROM payment_transactions pt
JOIN student_profiles sp ON pt.student_id = sp.id
JOIN users u ON sp.user_id = u.id
WHERE pt.student_id IN (
  SELECT student_id FROM student_parents WHERE parent_id = $parent_id AND tenant_id = $tenant_id
)
AND pt.tenant_id = $tenant_id
ORDER BY pt.created_at DESC
```

### Tuition Installment

**Source Table**: `student_tuition_installments`

**Purpose**: Represents a tuition installment for a student, used for displaying installments and calculating outstanding balances.

**Key Attributes**:
- `id` (UUID) - Primary key
- `tenant_id` (UUID) - Multi-tenant isolation
- `student_id` (UUID) - References `student_profiles.id`
- `enrollment_id` (UUID) - References `student_enrollments.id`
- `schedule_id` (UUID) - References `tuition_payment_schedules.id`
- `installment_number` (INTEGER) - Installment number (1, 2, 3, etc.)
- `installment_label` (VARCHAR) - Installment label (e.g., "September 2024")
- `amount` (DECIMAL) - Installment amount
- `due_date` (DATE) - Due date for installment
- `status` (ENUM) - 'pending', 'paid', 'overdue', 'partial'
- `amount_paid` (DECIMAL) - Amount paid so far
- `late_fee` (DECIMAL) - Late fee (if applicable)
- `created_at` (TIMESTAMPTZ) - Creation timestamp
- `updated_at` (TIMESTAMPTZ) - Last update timestamp

**Relationships**:
- Many-to-one with `student_profiles` (via `student_id`)
- Many-to-one with `student_enrollments` (via `enrollment_id`)
- Many-to-one with `tuition_payment_schedules` (via `schedule_id`)

**Query Pattern for Tuition Installments**:
```sql
SELECT 
  sti.id as installment_id,
  sti.student_id,
  sti.enrollment_id,
  sti.schedule_id,
  sti.installment_number,
  sti.installment_label,
  sti.amount,
  sti.due_date,
  sti.status,
  sti.amount_paid,
  sti.late_fee,
  sp.id as child_id,
  COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name
FROM student_tuition_installments sti
JOIN student_profiles sp ON sti.student_id = sp.id
JOIN users u ON sp.user_id = u.id
WHERE sti.student_id IN (
  SELECT student_id FROM student_parents WHERE parent_id = $parent_id AND tenant_id = $tenant_id
)
AND sti.tenant_id = $tenant_id
ORDER BY sti.due_date ASC
```

### Payment Schedule

**Source Table**: `tuition_payment_schedules`

**Purpose**: Represents a payment schedule for tuition, used for displaying payment schedules.

**Key Attributes**:
- `id` (UUID) - Primary key (schedule_id)
- `tenant_id` (UUID) - Multi-tenant isolation
- `student_id` (UUID) - References `student_profiles.id`
- `enrollment_id` (UUID) - References `student_enrollments.id`
- `schedule_name` (VARCHAR) - Schedule name (e.g., "2024-2025 Academic Year")
- `academic_year` (VARCHAR) - Academic year (e.g., "2024-2025")
- `total_tuition` (DECIMAL) - Total tuition amount
- `number_of_installments` (INTEGER) - Number of installments
- `installment_percentage` (JSONB) - Percentage for each installment
- `created_at` (TIMESTAMPTZ) - Creation timestamp
- `updated_at` (TIMESTAMPTZ) - Last update timestamp

**Relationships**:
- Many-to-one with `student_profiles` (via `student_id`)
- Many-to-one with `student_enrollments` (via `enrollment_id`)
- One-to-many with `student_tuition_installments` (via `schedule_id`)

**Query Pattern for Payment Schedules**:
```sql
SELECT 
  tps.id as schedule_id,
  tps.student_id,
  tps.enrollment_id,
  tps.schedule_name,
  tps.academic_year,
  tps.total_tuition,
  tps.number_of_installments,
  tps.installment_percentage,
  sp.id as child_id,
  COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name
FROM tuition_payment_schedules tps
JOIN student_profiles sp ON tps.student_id = sp.id
JOIN users u ON sp.user_id = u.id
WHERE tps.student_id IN (
  SELECT student_id FROM student_parents WHERE parent_id = $parent_id AND tenant_id = $tenant_id
)
AND tps.tenant_id = $tenant_id
ORDER BY tps.academic_year DESC
```

### Outstanding Balance

**Source Table**: Aggregated from `student_tuition_installments` and `payment_transactions`

**Purpose**: Represents outstanding balances for a student, calculated from unpaid installments and fees.

**Key Attributes**:
- `student_id` (UUID) - References `student_profiles.id`
- `fee_type` (ENUM) - 'tuition', 'inscription', 'annexes', 'autres'
- `total_outstanding` (DECIMAL) - Total outstanding amount
- `amount_paid` (DECIMAL) - Amount paid so far
- `amount_due` (DECIMAL) - Amount due (total - paid)

**Relationships**:
- Aggregated from `student_tuition_installments` and `payment_transactions` via `student_id`

**Query Pattern for Outstanding Balances**:
```sql
-- For tuition fees
SELECT 
  sti.student_id,
  'tuition' as fee_type,
  SUM(sti.amount - sti.amount_paid) as total_outstanding,
  SUM(sti.amount_paid) as amount_paid,
  SUM(sti.amount) as total_amount
FROM student_tuition_installments sti
WHERE sti.student_id IN (
  SELECT student_id FROM student_parents WHERE parent_id = $parent_id AND tenant_id = $tenant_id
)
AND sti.tenant_id = $tenant_id
AND sti.status IN ('pending', 'overdue', 'partial')
GROUP BY sti.student_id

-- For other fees (inscription, annexes, autres)
SELECT 
  pt.student_id,
  pt.fee_type,
  SUM(pt.amount) FILTER (WHERE pt.status = 'completed') as amount_paid,
  -- Calculate outstanding from enrollment fees configuration
  -- This requires joining with student_enrollments to get fee configuration
FROM payment_transactions pt
WHERE pt.student_id IN (
  SELECT student_id FROM student_parents WHERE parent_id = $parent_id AND tenant_id = $tenant_id
)
AND pt.tenant_id = $tenant_id
AND pt.fee_type IN ('inscription', 'annexes', 'autres')
GROUP BY pt.student_id, pt.fee_type
```

### Payment Receipt

**Source Table**: `payment_receipts`

**Purpose**: Represents a payment receipt for a transaction, used for displaying and downloading receipts.

**Key Attributes**:
- `id` (UUID) - Primary key
- `tenant_id` (UUID) - Multi-tenant isolation
- `transaction_id` (UUID) - References `payment_transactions.id`
- `receipt_number` (VARCHAR) - Receipt number
- `receipt_url` (TEXT) - URL to generated receipt PDF
- `generated_at` (TIMESTAMPTZ) - When receipt was generated
- `created_at` (TIMESTAMPTZ) - Creation timestamp

**Relationships**:
- Many-to-one with `payment_transactions` (via `transaction_id`)

**Query Pattern for Receipts**:
```sql
SELECT 
  pr.id as receipt_id,
  pr.transaction_id,
  pr.receipt_number,
  pr.receipt_url,
  pr.generated_at,
  pt.student_id,
  pt.fee_type,
  pt.amount,
  pt.payment_method,
  pt.processed_at,
  sp.id as child_id,
  COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name
FROM payment_receipts pr
JOIN payment_transactions pt ON pr.transaction_id = pt.id
JOIN student_profiles sp ON pt.student_id = sp.id
JOIN users u ON sp.user_id = u.id
WHERE pt.student_id IN (
  SELECT student_id FROM student_parents WHERE parent_id = $parent_id AND tenant_id = $tenant_id
)
AND pr.tenant_id = $tenant_id
ORDER BY pr.generated_at DESC
```

### Payment Method

**Source Table**: Payment methods may be stored in the system or payment gateway (implementation-dependent)

**Purpose**: Represents a saved payment method for a parent, used for displaying payment options.

**Key Attributes**:
- `id` (UUID) - Primary key (if stored in system)
- `parent_id` (UUID) - References `users.id` (authenticated parent user)
- `method_type` (ENUM) - Payment method type (card, bank_transfer, mobile_money, etc.)
- `last_4_digits` (VARCHAR) - Last 4 digits of card (if applicable)
- `expiration_date` (DATE) - Expiration date (if applicable)
- `is_default` (BOOLEAN) - Default payment method flag
- `created_at` (TIMESTAMPTZ) - Creation timestamp

**Relationships**:
- Many-to-one with `users` (via `parent_id`)

**Note**: Payment method storage may vary by implementation. This feature only requires display functionality.

## Validation Rules

### Parent-Child Relationship
- Must have valid `parent_id` referencing authenticated user
- Must have valid `student_id` referencing existing student profile
- Must have valid `tenant_id` matching authenticated tenant
- Relationship must exist in `student_parents` table for data access

### Payment Transactions
- Only include transactions for children linked to authenticated parent
- Support filtering by child_id, fee_type, date range, status
- Order by `created_at DESC` (most recent first) or `processed_at DESC`
- Calculate outstanding balances from unpaid installments and fees

### Tuition Installments
- Only include installments for children linked to authenticated parent
- Support filtering by child_id
- Order by `due_date ASC` (soonest first)
- Calculate status based on due date and amount paid

### Payment Schedules
- Only include schedules for children linked to authenticated parent
- Support filtering by child_id
- Order by `academic_year DESC` (most recent first)
- Display schedule name, academic year, total tuition, number of installments

### Outstanding Balances
- Calculate outstanding balances from unpaid installments and fees
- Group by fee type (tuition, inscription, annexes, autres)
- Support filtering by child_id and fee_type
- Calculate amount paid: sum of completed transactions for each fee type
- Calculate amount due: total amount - amount paid

### Payment Receipts
- Only include receipts for transactions of children linked to authenticated parent
- Support filtering by child_id, fee_type, date range
- Order by `generated_at DESC` (most recent first)
- Provide both view (browser) and download (PDF) options

### Payment Methods
- Only display payment methods for authenticated parent account
- Display method type, last 4 digits (for cards), expiration date (for cards), default status
- View-only functionality (no add/modify)

