# Data Model: Parent Emergency Contacts & Authorization Feature

**Date**: 2025-01-27  
**Feature**: Parent Emergency Contacts & Authorization (`014-parent-emergency`)

## Overview

This document defines the data model for the parent emergency contacts and authorization feature. The feature leverages existing database tables and relationships, with no new tables required.

## Entities

### Emergency Contact

**Source Table**: `emergency_contacts`

**Purpose**: Represents an emergency contact for a parent, used for displaying and managing emergency contacts.

**Key Attributes**:
- `id` (UUID) - Primary key
- `tenant_id` (UUID) - Multi-tenant isolation
- `parent_id` (UUID) - References `users.id` (parent)
- `contact_name` (VARCHAR) - Contact name
- `relationship` (VARCHAR) - Relationship to parent (e.g., "spouse", "sibling", "friend")
- `phone` (VARCHAR) - Phone number
- `email` (VARCHAR) - Email address
- `created_at` (TIMESTAMPTZ) - Creation timestamp
- `updated_at` (TIMESTAMPTZ) - Last update timestamp

**Relationships**:
- Many-to-one with `users` (via `parent_id`)
- Many-to-one with `tenants` (via `tenant_id`)

**Query Pattern for Emergency Contacts**:
```sql
SELECT 
  ec.id as contact_id,
  ec.parent_id,
  ec.contact_name,
  ec.relationship,
  ec.phone,
  ec.email,
  ec.created_at,
  ec.updated_at
FROM emergency_contacts ec
WHERE ec.parent_id = $parent_id
  AND ec.tenant_id = $tenant_id
ORDER BY ec.created_at ASC
```

### Parent-Child Relationship

**Source Table**: `student_parents`

**Purpose**: Represents the link between a parent user account and a student profile, used for displaying and managing relationship types and pickup authorization.

**Key Attributes**:
- `id` (UUID) - Primary key
- `tenant_id` (UUID) - Multi-tenant isolation
- `student_id` (UUID) - References `student_profiles.id`
- `parent_id` (UUID) - References `users.id` (parent)
- `relationship_type` (ENUM) - 'parent', 'guardian', 'emergency_contact'
- `is_primary_contact` (BOOLEAN) - Primary contact flag
- `emergency_contact` (BOOLEAN) - Emergency contact flag
- `can_pickup` (BOOLEAN) - Pickup authorization
- `notes` (TEXT) - Additional notes
- `created_at` (TIMESTAMPTZ) - Creation timestamp

**Relationships**:
- Many-to-one with `student_profiles` (via `student_id`)
- Many-to-one with `users` (via `parent_id`)
- Many-to-one with `tenants` (via `tenant_id`)

**Query Pattern for Parent-Child Relationships**:
```sql
SELECT 
  sp_rel.id as relationship_id,
  sp_rel.student_id,
  sp_rel.parent_id,
  sp_rel.relationship_type,
  sp_rel.is_primary_contact,
  sp_rel.emergency_contact,
  sp_rel.can_pickup,
  sp_rel.notes,
  sp.id as child_id,
  COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name
FROM student_parents sp_rel
JOIN student_profiles sp ON sp_rel.student_id = sp.id
JOIN users u ON sp.user_id = u.id
WHERE sp_rel.parent_id = $parent_id
  AND sp_rel.tenant_id = $tenant_id
ORDER BY sp_rel.created_at ASC
```

### Data Access

**Source**: Derived from `student_parents` relationship and relationship type

**Purpose**: Represents the data access permissions for a parent-child relationship, used for displaying data access information.

**Key Attributes**:
- `relationshipId` (UUID) - Relationship ID
- `childId` (UUID) - Child (student) ID
- `childName` (VARCHAR) - Child name
- `relationshipType` (ENUM) - 'parent', 'guardian', 'emergency_contact'
- `canPickup` (BOOLEAN) - Pickup authorization
- `accessLevel` (VARCHAR) - Access level (full, limited, view-only)
- `accessibleDataTypes` (JSONB) - Accessible data types (grades, attendance, payments, etc.)

**Relationships**:
- Derived from `student_parents` relationship
- Many-to-one with `student_profiles` (via `student_id`)
- Many-to-one with `users` (via `parent_id`)

**Query Pattern for Data Access**:
```sql
SELECT 
  sp_rel.id as relationship_id,
  sp.id as child_id,
  COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name,
  sp_rel.relationship_type,
  sp_rel.can_pickup,
  CASE 
    WHEN sp_rel.relationship_type = 'parent' THEN 'full'
    WHEN sp_rel.relationship_type = 'guardian' THEN 'limited'
    WHEN sp_rel.relationship_type = 'emergency_contact' THEN 'view-only'
  END as access_level,
  CASE 
    WHEN sp_rel.relationship_type = 'parent' THEN '["grades", "attendance", "payments", "homework", "messages", "academic", "documents"]'::jsonb
    WHEN sp_rel.relationship_type = 'guardian' THEN '["grades", "attendance", "homework", "messages"]'::jsonb
    WHEN sp_rel.relationship_type = 'emergency_contact' THEN '["messages"]'::jsonb
  END as accessible_data_types
FROM student_parents sp_rel
JOIN student_profiles sp ON sp_rel.student_id = sp.id
JOIN users u ON sp.user_id = u.id
WHERE sp_rel.parent_id = $parent_id
  AND sp_rel.tenant_id = $tenant_id
ORDER BY sp_rel.created_at ASC
```

## Validation Rules

### Emergency Contacts
- Must have valid `parent_id` referencing authenticated user
- Must have valid `tenant_id` matching authenticated tenant
- Contact name must not be empty
- Phone must be valid phone format (if provided)
- Email must be valid email format (if provided)
- At least one contact method (phone or email) must be provided
- Emergency contact operations must verify authenticated user ID matches parent ID

### Parent-Child Relationships
- Must have valid `parent_id` referencing authenticated user
- Must have valid `student_id` referencing existing student profile
- Must have valid `tenant_id` matching authenticated tenant
- Relationship type must be valid enum value ('parent', 'guardian', 'emergency_contact')
- Pickup authorization updates must verify authenticated user ID matches parent ID
- Relationship type updates must verify authenticated user ID matches parent ID
- Relationship type updates may require administrative approval

### Data Access
- Must have valid `parent_id` referencing authenticated user
- Must have valid `student_id` referencing existing student profile
- Must have valid `tenant_id` matching authenticated tenant
- Data access is derived from relationship type and authorization status
- Data access is view-only (cannot be modified directly)
- Data access changes require relationship type or authorization changes



