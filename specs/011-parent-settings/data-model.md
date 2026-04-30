# Data Model: Parent Profile & Settings Feature

**Date**: 2025-01-27  
**Feature**: Parent Profile & Settings (`011-parent-settings`)

## Overview

This document defines the data model for the parent profile and settings feature. The feature leverages existing database tables and relationships, with potential new tables required for emergency contacts and notification preferences.

## Entities

### Parent User Profile

**Source Table**: `users`

**Purpose**: Represents a parent user's profile information, used for displaying and editing profile information.

**Key Attributes**:
- `id` (UUID) - Primary key
- `tenant_id` (UUID) - Multi-tenant isolation
- `email` (VARCHAR) - Email address
- `first_name` (VARCHAR) - First name
- `last_name` (VARCHAR) - Last name
- `name` (VARCHAR) - Full name (if separate from first_name/last_name)
- `password_hash` (VARCHAR) - Hashed password
- `created_at` (TIMESTAMPTZ) - Creation timestamp
- `updated_at` (TIMESTAMPTZ) - Last update timestamp

**Relationships**:
- Many-to-one with `tenants` (via `tenant_id`)
- One-to-many with `student_parents` (via `parent_id`)

**Query Pattern for Parent Profile**:
```sql
SELECT 
  u.id,
  u.tenant_id,
  u.email,
  u.first_name,
  u.last_name,
  u.name,
  u.created_at,
  u.updated_at
FROM users u
WHERE u.id = $parent_id
  AND u.tenant_id = $tenant_id
```

### Contact Information

**Source Table**: `users` (extended) or separate `user_contact_info` table (may need to be created)

**Purpose**: Represents a parent's contact information including phone number, email address, and mailing address.

**Key Attributes**:
- `user_id` (UUID) - References `users.id`
- `phone` (VARCHAR) - Phone number
- `email` (VARCHAR) - Email address (from users table)
- `address` (TEXT) - Mailing address
- `updated_at` (TIMESTAMPTZ) - Last update timestamp

**Relationships**:
- Many-to-one with `users` (via `user_id`)

**Query Pattern for Contact Information**:
```sql
SELECT 
  u.id as user_id,
  u.email,
  u.phone,
  u.address
FROM users u
WHERE u.id = $parent_id
  AND u.tenant_id = $tenant_id
```

### Emergency Contact

**Source Table**: `emergency_contacts` (may need to be created)

**Purpose**: Represents an emergency contact for a parent.

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

### Notification Preferences

**Source Table**: `notification_preferences` (may need to be created)

**Purpose**: Represents a parent's notification preferences for different notification types.

**Key Attributes**:
- `id` (UUID) - Primary key
- `tenant_id` (UUID) - Multi-tenant isolation
- `parent_id` (UUID) - References `users.id` (parent)
- `notification_type` (ENUM) - 'message', 'announcement', 'event', 'grade', 'payment', 'other'
- `enabled` (BOOLEAN) - Whether notifications are enabled for this type
- `delivery_methods` (JSONB) - Delivery methods (email, in-app, SMS) as array
- `created_at` (TIMESTAMPTZ) - Creation timestamp
- `updated_at` (TIMESTAMPTZ) - Last update timestamp

**Relationships**:
- Many-to-one with `users` (via `parent_id`)
- Many-to-one with `tenants` (via `tenant_id`)

**Query Pattern for Notification Preferences**:
```sql
SELECT 
  np.id as preference_id,
  np.parent_id,
  np.notification_type,
  np.enabled,
  np.delivery_methods,
  np.created_at,
  np.updated_at
FROM notification_preferences np
WHERE np.parent_id = $parent_id
  AND np.tenant_id = $tenant_id
ORDER BY np.notification_type ASC
```

### Parent-Child Relationship

**Source Table**: `student_parents`

**Purpose**: Represents the link between a parent user account and a student profile, used for displaying relationship management information.

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

**Query Pattern for Relationship Management**:
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

## Validation Rules

### Parent Profile
- Must have valid `parent_id` referencing authenticated user
- Must have valid `tenant_id` matching authenticated tenant
- Email must be valid email format
- First name and last name must not be empty
- Profile updates must verify authenticated user ID matches parent ID

### Contact Information
- Must have valid `parent_id` referencing authenticated user
- Email must be valid email format (if provided)
- Phone must be valid phone format (if provided)
- Address must not exceed maximum length (if provided)
- Contact updates must verify authenticated user ID matches parent ID

### Emergency Contacts
- Must have valid `parent_id` referencing authenticated user
- Must have valid `tenant_id` matching authenticated tenant
- Contact name must not be empty
- Phone must be valid phone format (if provided)
- Email must be valid email format (if provided)
- At least one contact method (phone or email) must be provided
- Emergency contact operations must verify authenticated user ID matches parent ID

### Notification Preferences
- Must have valid `parent_id` referencing authenticated user
- Must have valid `tenant_id` matching authenticated tenant
- Notification type must be valid enum value
- Delivery methods must be valid array of methods (email, in-app, SMS)
- Preference updates must verify authenticated user ID matches parent ID

### Parent-Child Relationship
- Must have valid `parent_id` referencing authenticated user
- Must have valid `student_id` referencing existing student profile
- Must have valid `tenant_id` matching authenticated tenant
- Relationship type must be valid enum value
- Relationship view must verify authenticated user ID matches parent ID
- No add/remove functionality (view-only)

### Password Change
- Must have valid `parent_id` referencing authenticated user
- Current password must be correct
- New password must meet security requirements (minimum length, complexity)
- New password and confirm password must match
- Password change must verify authenticated user ID matches parent ID
- New password must be hashed before storing

