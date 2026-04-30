# Research: Imhotep Data Database Schema

**Date**: 2025-01-27  
**Feature**: 015-imhotep-data-schema  
**Phase**: 0 - Outline & Research

## Overview

This document consolidates research findings and architectural decisions for implementing the Imhotep Data professional training database schema. All technical choices are based on existing codebase patterns and PostgreSQL best practices.

## Research Tasks

### 1. Database Migration Pattern Analysis

**Task**: Understand existing migration patterns and conventions

**Findings**:
- Migrations are numbered sequentially (0001, 0002, etc.) in `infra/scripts/migrations/`
- Latest migration: 0036_attendance_reports.sql
- Next available number: 0037
- All migrations use `CREATE TABLE IF NOT EXISTS` for idempotency
- Migrations include comprehensive comments and documentation

**Decision**: Use migration file `0037_imhotep_data_professional_training.sql`

**Rationale**: Follows established sequential numbering, maintains consistency with existing codebase

**Alternatives Considered**: 
- Custom naming scheme - Rejected: Would break established pattern
- Single large migration vs. multiple smaller ones - Chosen: Single migration for atomic schema creation

---

### 2. Row Level Security (RLS) Policy Pattern

**Task**: Determine RLS policy implementation pattern

**Findings**:
- All tenant-scoped tables use: `tenant_id = current_setting('app.tenant_id', true)::UUID`
- Some migrations use idempotent pattern with `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;`
- RLS is enabled with `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;`
- Policy naming: `<table>_tenant_policy` or `<table>_isolation`

**Decision**: Use pattern `tenant_id = current_setting('app.tenant_id', true)::UUID` with idempotent policy creation

**Rationale**: Matches existing codebase patterns, ensures tenant isolation, idempotent for safe re-runs

**Alternatives Considered**:
- Different RLS policy syntax - Rejected: Would be inconsistent
- No idempotent wrapper - Rejected: Could cause errors on re-runs

---

### 3. ENUM Type Naming and Values

**Task**: Determine ENUM type patterns for status fields and delivery modes

**Findings**:
- Existing ENUMs: `cycle_type`, `cycle_status`, `delivery_mode`, `contract_type`, `teacher_status`, `student_status`
- Status ENUMs typically: `'draft', 'active', 'inactive'` or `'pending', 'confirmed', 'cancelled'`
- Delivery mode: `'presential', 'remote', 'hybrid', 'elearning'` (from existing `delivery_mode` type)

**Decision**: 
- Reuse existing `delivery_mode` ENUM for training sessions
- Create new ENUMs: `session_professional_status`, `enrollment_professional_status`, `payment_professional_status`, `promo_code_reduction_type`
- Use lowercase with underscores for consistency

**Rationale**: Reuses existing types where applicable, maintains naming consistency

**Alternatives Considered**:
- Create all new ENUMs - Rejected: Would duplicate existing `delivery_mode`
- Different naming convention - Rejected: Would break consistency

---

### 4. UUID Primary Key Pattern

**Task**: Verify UUID primary key implementation

**Findings**:
- All tables use `id UUID PRIMARY KEY DEFAULT uuid_generate_v4()`
- Requires `uuid-ossp` extension (enabled in 0001_init.sql)
- No auto-increment integers used

**Decision**: Use `id UUID PRIMARY KEY DEFAULT uuid_generate_v4()` for all new tables

**Rationale**: Matches existing pattern, ensures global uniqueness, supports distributed systems

**Alternatives Considered**: 
- Auto-increment integers - Rejected: Would break consistency, less suitable for multi-tenant

---

### 5. Audit Trail Pattern (created_at, updated_at)

**Task**: Determine timestamp field patterns

**Findings**:
- All tables include: `created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()`
- All tables include: `updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()`
- `updated_at` uses trigger: `update_updated_at_column()` function
- Trigger pattern: `CREATE TRIGGER update_<table>_updated_at BEFORE UPDATE ON <table> FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();`

**Decision**: Include both `created_at` and `updated_at` with trigger for `updated_at` on all new tables

**Rationale**: Maintains audit trail consistency, automatic timestamp updates

**Alternatives Considered**:
- Manual timestamp updates - Rejected: Error-prone, inconsistent
- Only `created_at` - Rejected: Loses update tracking capability

---

### 6. Index Strategy

**Task**: Determine indexing patterns for performance

**Findings**:
- Index naming: `idx_<table>_<column>` or `idx_<table>_<column1>_<column2>` for composite
- Tenant-scoped indexes typically include `tenant_id`: `idx_<table>_tenant_id`
- Composite indexes for common query patterns: `(tenant_id, status)`, `(tenant_id, email)`
- Partial indexes for filtered queries: `WHERE status = 'active'`
- Foreign key columns are indexed for join performance

**Decision**: 
- Index all `tenant_id` columns
- Index all foreign key columns
- Create composite indexes for common query patterns (status, dates, codes)
- Create partial indexes where appropriate (e.g., active records)

**Rationale**: Ensures query performance, supports multi-tenant filtering, follows existing patterns

**Alternatives Considered**:
- Minimal indexing - Rejected: Would cause performance issues with tenant-scoped queries
- Over-indexing - Rejected: Would slow down writes unnecessarily

---

### 7. Foreign Key Constraint Patterns

**Task**: Determine foreign key ON DELETE behavior

**Findings**:
- `tenant_id` always: `ON DELETE CASCADE` (if tenant deleted, all data deleted)
- Parent-child relationships: `ON DELETE CASCADE` (e.g., sessions → enrollments)
- Optional relationships: `ON DELETE SET NULL` (e.g., `created_by` references users)
- Junction tables: `ON DELETE CASCADE` on both sides

**Decision**:
- `tenant_id`: `ON DELETE CASCADE`
- Required relationships (sessions → programs): `ON DELETE CASCADE`
- Optional relationships (enrollments → companies): `ON DELETE SET NULL`
- Junction tables (session_formateurs): `ON DELETE CASCADE` on both foreign keys

**Rationale**: Maintains referential integrity, prevents orphaned records, allows optional relationships

**Alternatives Considered**:
- All CASCADE - Rejected: Too destructive for optional relationships
- All SET NULL - Rejected: Would leave orphaned required relationships

---

### 8. Generated Field Patterns (Enrollment Numbers, Session Codes)

**Task**: Determine pattern for auto-generated identifiers

**Findings**:
- Student numbers use function: `generate_student_number(tenant_uuid UUID)`
- Pattern: `STU + year + sequence` (e.g., `STU2024001`)
- Uses trigger: `BEFORE INSERT` to generate if NULL
- Function uses `COALESCE(MAX(...), 0) + 1` for sequence

**Decision**: 
- Enrollment numbers: `INS-DATA-YYYY-NNN` format (e.g., `INS-DATA-2024-001`)
- Session codes: `DATA-YYYY-NNN` format (e.g., `DATA-2024-001`)
- Use similar trigger pattern with tenant-scoped sequence generation

**Rationale**: Maintains consistency with existing patterns, ensures uniqueness, tenant-scoped

**Alternatives Considered**:
- UUID-based codes - Rejected: Not human-readable, harder for users
- Global sequence - Rejected: Would break tenant isolation

---

### 9. JSON/JSONB Field Usage

**Task**: Determine when to use JSONB vs. structured columns

**Findings**:
- JSONB used for: flexible configuration (`settings_json`), resources (`resources JSONB DEFAULT '{}'`)
- Arrays used for: multiple values (`objectives TEXT[]`, `specialties TEXT[]`)
- Structured columns used for: searchable/filterable data (status, dates, codes)

**Decision**:
- Use JSONB for: `objectives`, `programme_detaille`, `themes`, `specialites`, `metadata`
- Use TEXT[] for: simple arrays that might be queried individually
- Use structured columns for: all searchable/filterable fields

**Rationale**: JSONB for flexible structures, arrays for simple lists, structured for queryable data

**Alternatives Considered**:
- All structured - Rejected: Too rigid, would require schema changes for new fields
- All JSONB - Rejected: Would hurt query performance, lose type safety

---

### 10. Calculated Fields (places_disponibles)

**Task**: Determine approach for calculated/generated columns

**Findings**:
- PostgreSQL supports `GENERATED ALWAYS AS` for computed columns
- Can be stored or virtual (STORED vs. VIRTUAL)
- Example: `places_disponibles INTEGER GENERATED ALWAYS AS (places_totales - places_reservees) STORED`

**Decision**: Use `GENERATED ALWAYS AS ... STORED` for `places_disponibles` in sessions table

**Rationale**: Ensures consistency, automatic calculation, stored for query performance

**Alternatives Considered**:
- Application-level calculation - Rejected: Could get out of sync, more error-prone
- Virtual column - Rejected: Would recalculate on every query, slower

---

### 11. Table Naming Conventions

**Task**: Determine table naming pattern

**Findings**:
- Existing tables: `cycles`, `programmes`, `courses`, `teachers`, `student_profiles`
- Use lowercase with underscores
- Descriptive names (not abbreviated)
- Junction tables: descriptive (e.g., `user_roles`, `course_assignments`)

**Decision**: Use descriptive lowercase names with underscores:
- `formations_professionnelles`
- `sessions_professionnelles`
- `formateurs` (separate from `teachers` for academic)
- `entreprises_clientes`
- `inscriptions_professionnelles`
- `codes_promo`
- `paiements_professionnels`
- `supports_cours`
- `session_formateurs` (junction table)

**Rationale**: Clear, descriptive, follows existing patterns, distinguishes from academic tables

**Alternatives Considered**:
- Abbreviated names - Rejected: Less readable, harder to maintain
- English names - Rejected: Inconsistent with French academic table names

---

### 12. Column Naming Conventions

**Task**: Determine column naming pattern

**Findings**:
- Columns use lowercase with underscores: `first_name`, `created_at`, `tenant_id`
- Foreign keys: `<table>_id` (e.g., `user_id`, `tenant_id`)
- Boolean fields: `is_<property>` or descriptive (e.g., `is_active`, `actif`)
- Status fields: `status` or `<entity>_status`

**Decision**: Follow existing patterns:
- Foreign keys: `<table>_id`
- Booleans: `actif` (consistent with French naming in some tables) or `is_<property>`
- Status: `statut` (French) to match existing pattern
- Timestamps: `created_at`, `updated_at`

**Rationale**: Maintains consistency, follows established conventions

**Alternatives Considered**:
- All English - Rejected: Inconsistent with existing French column names
- All French - Rejected: Some technical terms (created_at) are standard

---

## Summary of Key Decisions

1. **Migration File**: `0037_imhotep_data_professional_training.sql`
2. **RLS Pattern**: `tenant_id = current_setting('app.tenant_id', true)::UUID` with idempotent policies
3. **ENUMs**: Reuse `delivery_mode`, create new status ENUMs
4. **Primary Keys**: UUID with `uuid_generate_v4()`
5. **Audit Trail**: `created_at` and `updated_at` with trigger
6. **Indexes**: Tenant-scoped, foreign keys, composite for common queries
7. **Foreign Keys**: CASCADE for required, SET NULL for optional
8. **Generated Fields**: Trigger-based functions for codes/numbers
9. **JSON/JSONB**: Use for flexible structures, arrays for simple lists
10. **Calculated Fields**: `GENERATED ALWAYS AS ... STORED`
11. **Table Names**: Descriptive French lowercase with underscores
12. **Column Names**: Follow existing patterns (mix of French/English as appropriate)

## No Clarifications Needed

All technical decisions are based on existing codebase patterns. No NEEDS CLARIFICATION markers remain. The schema design is ready for Phase 1 implementation.

