# Data Model: Parent Reports & Documents Feature

**Date**: 2025-01-27  
**Feature**: Parent Reports & Documents (`013-parent-documents`)

## Overview

This document defines the data model for the parent reports and documents feature. The feature leverages existing database tables and relationships, with potential new tables required for stored reports.

## Entities

### Report Card

**Source Tables**: `report_cards` (may need to be created) or generated from `assignment_submissions`, `student_profiles`, `student_parents`, `academic_years`

**Purpose**: Represents a report card for a child, used for displaying report cards to parents.

**Key Attributes**:
- `reportCardId` (UUID) - Report card ID
- `childId` (UUID) - Child (student) ID
- `childName` (VARCHAR) - Child name
- `academicYearId` (UUID) - Academic year ID
- `academicYearName` (VARCHAR) - Academic year name
- `semester` (INTEGER) - Semester number
- `reportDate` (DATE) - Report date
- `overallGrade` (DECIMAL) - Overall grade
- `reportUrl` (VARCHAR) - Report URL for download/view
- `downloadable` (BOOLEAN) - Whether report can be downloaded
- `viewable` (BOOLEAN) - Whether report can be viewed in browser

**Relationships**:
- Many-to-one with `student_profiles` (via `student_id`)
- Many-to-one with `student_parents` (via `student_id` and `parent_id`)
- Many-to-one with `academic_years` (via `academic_year_id`)

**Query Pattern for Report Cards**:
```sql
SELECT 
  rc.id as report_card_id,
  sp.id as child_id,
  COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name,
  ay.id as academic_year_id,
  ay.name as academic_year_name,
  rc.semester,
  rc.report_date,
  rc.overall_grade,
  rc.report_url,
  rc.downloadable,
  rc.viewable
FROM report_cards rc
JOIN student_profiles sp ON rc.student_id = sp.id
JOIN users u ON sp.user_id = u.id
JOIN academic_years ay ON rc.academic_year_id = ay.id
JOIN student_parents sp_rel ON sp.id = sp_rel.student_id
WHERE sp_rel.parent_id = $parent_id
  AND rc.tenant_id = $tenant_id
  AND ($child_id IS NULL OR sp.id = $child_id)
  AND ($academic_year_id IS NULL OR rc.academic_year_id = $academic_year_id)
  AND ($semester IS NULL OR rc.semester = $semester)
ORDER BY rc.report_date DESC
```

### Transcript

**Source Tables**: `transcripts` (may need to be created) or generated from completed courses and grades data, `student_profiles`, `student_parents`, `academic_years`

**Purpose**: Represents a transcript for a child, used for displaying transcripts to parents.

**Key Attributes**:
- `transcriptId` (UUID) - Transcript ID
- `childId` (UUID) - Child (student) ID
- `childName` (VARCHAR) - Child name
- `academicYearId` (UUID) - Academic year ID
- `academicYearName` (VARCHAR) - Academic year name
- `transcriptDate` (DATE) - Transcript date
- `totalCredits` (INTEGER) - Total credits
- `gpa` (DECIMAL) - Grade point average
- `transcriptUrl` (VARCHAR) - Transcript URL for download/view
- `downloadable` (BOOLEAN) - Whether transcript can be downloaded
- `viewable` (BOOLEAN) - Whether transcript can be viewed in browser

**Relationships**:
- Many-to-one with `student_profiles` (via `student_id`)
- Many-to-one with `student_parents` (via `student_id` and `parent_id`)
- Many-to-one with `academic_years` (via `academic_year_id`)

**Query Pattern for Transcripts**:
```sql
SELECT 
  t.id as transcript_id,
  sp.id as child_id,
  COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name,
  ay.id as academic_year_id,
  ay.name as academic_year_name,
  t.transcript_date,
  t.total_credits,
  t.gpa,
  t.transcript_url,
  t.downloadable,
  t.viewable
FROM transcripts t
JOIN student_profiles sp ON t.student_id = sp.id
JOIN users u ON sp.user_id = u.id
JOIN academic_years ay ON t.academic_year_id = ay.id
JOIN student_parents sp_rel ON sp.id = sp_rel.student_id
WHERE sp_rel.parent_id = $parent_id
  AND t.tenant_id = $tenant_id
  AND ($child_id IS NULL OR sp.id = $child_id)
  AND ($academic_year_id IS NULL OR t.academic_year_id = $academic_year_id)
ORDER BY t.transcript_date DESC
```

### Attendance Report

**Source Tables**: `attendance_reports` (may need to be created) or generated from `attendance_records`, `student_profiles`, `student_parents`, `academic_years`

**Purpose**: Represents an attendance report for a child, used for displaying attendance reports to parents.

**Key Attributes**:
- `reportId` (UUID) - Report ID
- `childId` (UUID) - Child (student) ID
- `childName` (VARCHAR) - Child name
- `academicYearId` (UUID) - Academic year ID
- `academicYearName` (VARCHAR) - Academic year name
- `reportPeriod` (VARCHAR) - Report period (e.g., "Q1 2024", "Semester 1")
- `reportDate` (DATE) - Report date
- `attendanceRate` (DECIMAL) - Attendance rate (percentage)
- `totalDays` (INTEGER) - Total days
- `presentDays` (INTEGER) - Present days
- `absentDays` (INTEGER) - Absent days
- `reportUrl` (VARCHAR) - Report URL for download/view
- `downloadable` (BOOLEAN) - Whether report can be downloaded
- `viewable` (BOOLEAN) - Whether report can be viewed in browser

**Relationships**:
- Many-to-one with `student_profiles` (via `student_id`)
- Many-to-one with `student_parents` (via `student_id` and `parent_id`)
- Many-to-one with `academic_years` (via `academic_year_id`)

**Query Pattern for Attendance Reports**:
```sql
SELECT 
  ar.id as report_id,
  sp.id as child_id,
  COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name,
  ay.id as academic_year_id,
  ay.name as academic_year_name,
  ar.report_period,
  ar.report_date,
  ar.attendance_rate,
  ar.total_days,
  ar.present_days,
  ar.absent_days,
  ar.report_url,
  ar.downloadable,
  ar.viewable
FROM attendance_reports ar
JOIN student_profiles sp ON ar.student_id = sp.id
JOIN users u ON sp.user_id = u.id
JOIN academic_years ay ON ar.academic_year_id = ay.id
JOIN student_parents sp_rel ON sp.id = sp_rel.student_id
WHERE sp_rel.parent_id = $parent_id
  AND ar.tenant_id = $tenant_id
  AND ($child_id IS NULL OR sp.id = $child_id)
  AND ($academic_year_id IS NULL OR ar.academic_year_id = $academic_year_id)
  AND ($start_date IS NULL OR ar.report_date >= $start_date)
  AND ($end_date IS NULL OR ar.report_date <= $end_date)
ORDER BY ar.report_date DESC
```

### Payment Receipt

**Source Tables**: `payment_receipts`, `payment_transactions`, `student_profiles`, `student_parents`, `academic_years`

**Purpose**: Represents a payment receipt for a child's payment, used for displaying payment receipts to parents.

**Key Attributes**:
- `receiptId` (UUID) - Receipt ID
- `childId` (UUID) - Child (student) ID
- `childName` (VARCHAR) - Child name
- `receiptNumber` (VARCHAR) - Receipt number
- `paymentDate` (DATE) - Payment date
- `amount` (DECIMAL) - Payment amount
- `currency` (VARCHAR) - Currency code
- `paymentMethod` (ENUM) - Payment method type
- `feeType` (ENUM) - Fee type (tuition, inscription, annexes, autres)
- `academicYearId` (UUID) - Academic year ID
- `academicYearName` (VARCHAR) - Academic year name
- `receiptUrl` (VARCHAR) - Receipt URL for download/view
- `downloadable` (BOOLEAN) - Whether receipt can be downloaded
- `viewable` (BOOLEAN) - Whether receipt can be viewed in browser

**Relationships**:
- Many-to-one with `payment_transactions` (via `transaction_id`)
- Many-to-one with `student_profiles` (via `student_id` through transaction)
- Many-to-one with `student_parents` (via `student_id` and `parent_id`)
- Many-to-one with `academic_years` (via `academic_year_id` through enrollment)

**Query Pattern for Payment Receipts**:
```sql
SELECT 
  pr.id as receipt_id,
  sp.id as child_id,
  COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name,
  pr.receipt_number,
  pt.processed_at::DATE as payment_date,
  pt.amount,
  pt.currency,
  pt.payment_method,
  pt.fee_type,
  se.academic_year_id,
  ay.name as academic_year_name,
  pr.receipt_url,
  true as downloadable,
  true as viewable
FROM payment_receipts pr
JOIN payment_transactions pt ON pr.transaction_id = pt.id
JOIN student_profiles sp ON pt.student_id = sp.id
JOIN users u ON sp.user_id = u.id
JOIN student_enrollments se ON pt.enrollment_id = se.id
JOIN academic_years ay ON se.academic_year_id = ay.id
JOIN student_parents sp_rel ON sp.id = sp_rel.student_id
WHERE sp_rel.parent_id = $parent_id
  AND pr.tenant_id = $tenant_id
  AND ($child_id IS NULL OR sp.id = $child_id)
  AND ($academic_year_id IS NULL OR se.academic_year_id = $academic_year_id)
  AND ($start_date IS NULL OR pt.processed_at::DATE >= $start_date)
  AND ($end_date IS NULL OR pt.processed_at::DATE <= $end_date)
ORDER BY pt.processed_at DESC
```

## Validation Rules

### Report Cards
- Must have valid `parent_id` referencing authenticated user
- Must have valid `student_id` referencing child linked to parent through `student_parents`
- Must have valid `tenant_id` matching authenticated tenant
- Only report cards for enrolled children should be returned
- Report card information must be complete (child name, academic year, semester, report date, overall grade, etc.)

### Transcripts
- Must have valid `parent_id` referencing authenticated user
- Must have valid `student_id` referencing child linked to parent through `student_parents`
- Must have valid `tenant_id` matching authenticated tenant
- Only transcripts for enrolled children should be returned
- Transcript information must be complete (child name, academic year, transcript date, total credits, GPA, etc.)

### Attendance Reports
- Must have valid `parent_id` referencing authenticated user
- Must have valid `student_id` referencing child linked to parent through `student_parents`
- Must have valid `tenant_id` matching authenticated tenant
- Only attendance reports for enrolled children should be returned
- Attendance report information must be complete (child name, academic year, report period, report date, attendance rate, etc.)

### Payment Receipts
- Must have valid `parent_id` referencing authenticated user
- Must have valid `student_id` referencing child linked to parent through `student_parents`
- Must have valid `tenant_id` matching authenticated tenant
- Only payment receipts for enrolled children should be returned
- Payment receipt information must be complete (child name, receipt number, payment date, amount, payment method, fee type, etc.)

