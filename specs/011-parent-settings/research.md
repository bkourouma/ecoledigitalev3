# Research: Parent Profile & Settings Feature

**Date**: 2025-01-27  
**Feature**: Parent Profile & Settings (`011-parent-settings`)

## Overview

This document consolidates research findings and technical decisions for implementing the parent profile and settings feature. All clarifications from the specification phase have been incorporated.

## Technical Decisions

### Decision 1: Data Access Pattern

**Decision**: Use existing `users` table for parent profile information and `student_parents` table for relationship management. Create or extend tables for emergency contacts and notification preferences.

**Rationale**: 
- The `users` table already exists with user profile information (name, email, etc.)
- The `student_parents` table already exists with parent-child relationship data
- Emergency contacts and notification preferences may need new tables or extensions
- Supports multi-tenant RLS policies

**Alternatives Considered**:
- Creating a new parent_profile table: Rejected - would duplicate existing user data
- Direct queries to users table: Rejected - need proper access control and validation

**Implementation Notes**:
- Query `users` table for parent profile information
- Query `student_parents` table for relationship management
- Create or extend `emergency_contacts` table for emergency contacts
- Create or extend `notification_preferences` table for notification preferences
- Verify authenticated user ID matches parent ID for all operations

### Decision 2: Profile Update Validation

**Decision**: Implement client-side and server-side validation for all profile and settings updates.

**Rationale**:
- Specification requires validation for all updates (email format, phone format, etc.)
- Client-side validation provides immediate feedback
- Server-side validation ensures data integrity and security

**Alternatives Considered**:
- Client-side only: Rejected - security risk, data integrity not guaranteed
- Server-side only: Rejected - poor user experience, no immediate feedback

**Implementation Notes**:
- Use zod schemas for validation on both client and server
- Validate email format, phone number format, address format
- Validate password requirements (minimum length, complexity)
- Return clear validation error messages

### Decision 3: Emergency Contacts Management

**Decision**: Allow parents to add, edit, and remove emergency contacts through the settings interface.

**Rationale**:
- Specification requires full CRUD operations for emergency contacts
- Parents need to maintain accurate emergency contact information
- Emergency contacts are critical for school safety

**Alternatives Considered**:
- View-only emergency contacts: Rejected - specification requires add/edit/remove functionality
- Administrative approval required: Rejected - specification allows direct parent management

**Implementation Notes**:
- Create `emergency_contacts` table if it doesn't exist
- Support add, edit, remove operations
- Validate contact information before saving
- Require confirmation before removing contacts

### Decision 4: Notification Preferences Storage

**Decision**: Store notification preferences in a separate `notification_preferences` table or as JSONB in the user profile.

**Rationale**:
- Notification preferences need to be queryable and filterable
- Separate table provides better structure and queryability
- JSONB in user profile provides simpler structure but less queryability

**Alternatives Considered**:
- JSONB in user profile: Rejected - less queryable, harder to manage
- Separate table: Preferred - better structure, easier to query and manage

**Implementation Notes**:
- Create `notification_preferences` table with user_id, notification_type, enabled, delivery_methods
- Support per-notification-type preferences
- Support multiple delivery methods (email, in-app, SMS if available)
- Default preferences if none exist

### Decision 5: Relationship Management View-Only

**Decision**: Display relationship management information as view-only, with no add/remove functionality.

**Rationale**:
- Specification clarifies: "Parents should be able to view their linked children, but adding or removing children may require administrative approval (out of scope for this feature - view-only for relationship management)"
- Relationship changes require administrative oversight
- View-only provides transparency without security risks

**Alternatives Considered**:
- Full CRUD for relationships: Rejected - specification limits to view-only
- No relationship display: Rejected - specification requires relationship management view

**Implementation Notes**:
- Query `student_parents` table for relationship information
- Display relationship type, primary contact status, emergency contact status, pickup authorization
- No add/remove functionality in this feature
- Display clear message that relationship changes require administrative approval

### Decision 6: Password Change Functionality

**Decision**: Implement password change functionality through the settings page with current password verification.

**Rationale**:
- Specification requires password change functionality
- Current password verification ensures security
- Password validation ensures strong passwords

**Alternatives Considered**:
- No password change: Rejected - specification requires password change
- Password reset only: Rejected - specification requires password change through settings

**Implementation Notes**:
- Verify current password before allowing change
- Validate new password meets security requirements (minimum length, complexity)
- Validate new password and confirm password match
- Hash new password before storing
- Update password_hash in users table

### Decision 7: API Endpoint Structure

**Decision**: Create `/api/v1/parent/settings` route group following existing pattern.

**Rationale**:
- Follows existing route organization (e.g., `/api/v1/parent/children`, `/api/v1/parent/homework`, `/api/v1/parent/grades`, `/api/v1/parent/payments`, `/api/v1/parent/messages`)
- Provides clear namespace for parent-specific settings endpoints
- Maintains consistency with codebase patterns

**Alternatives Considered**:
- Add to existing `/api/v1/parent/children` routes: Rejected - settings is separate concern
- Create `/api/v1/parent/profile` routes: Rejected - settings is more comprehensive and matches specification

**Implementation Notes**:
- Endpoints:
  - `GET /api/v1/parent/settings/profile` - Get parent profile information
  - `PUT /api/v1/parent/settings/profile` - Update parent profile information
  - `GET /api/v1/parent/settings/contact` - Get contact information
  - `PUT /api/v1/parent/settings/contact` - Update contact information
  - `GET /api/v1/parent/settings/emergency-contacts` - Get emergency contacts
  - `POST /api/v1/parent/settings/emergency-contacts` - Add emergency contact
  - `PUT /api/v1/parent/settings/emergency-contacts/:contactId` - Update emergency contact
  - `DELETE /api/v1/parent/settings/emergency-contacts/:contactId` - Remove emergency contact
  - `GET /api/v1/parent/settings/notification-preferences` - Get notification preferences
  - `PUT /api/v1/parent/settings/notification-preferences` - Update notification preferences
  - `GET /api/v1/parent/settings/relationships` - Get relationship management information
  - `POST /api/v1/parent/settings/change-password` - Change password

### Decision 8: Frontend Route Structure

**Decision**: Create `/parent/settings` route in Next.js app directory.

**Rationale**:
- Follows existing Next.js 15 app directory structure
- Matches API endpoint naming for consistency
- Provides dedicated page for settings functionality

**Alternatives Considered**:
- Add to existing `/parent/children` page: Rejected - settings is separate concern
- Nested under `/parent/profile`: Rejected - settings is more comprehensive

**Implementation Notes**:
- Routes:
  - `/parent/settings` - Main settings page with tabs/sections for different settings
- Components:
  - `ParentProfile.tsx` - Parent profile view and edit
  - `ContactInformation.tsx` - Contact information view and edit
  - `EmergencyContacts.tsx` - Emergency contacts management
  - `NotificationPreferences.tsx` - Notification preferences configuration
  - `RelationshipManagement.tsx` - Relationship management view (read-only)
  - `ChangePassword.tsx` - Password change form

### Decision 9: Data Access Control

**Decision**: Enforce parent user ID check at API level using authentication and query filters.

**Rationale**:
- Specification requires: "Parents can only view and edit their own profile and settings"
- Authentication provides user ID
- Additional query filters ensure correctness

**Alternatives Considered**:
- RLS only: Rejected - need explicit validation in API for clear error messages
- Application-level only: Rejected - defense in depth with RLS provides stronger security

**Implementation Notes**:
- Query filter: `WHERE users.id = $authenticated_user_id`
- Verify authenticated user ID matches parent ID for all operations
- Return 403 Forbidden if parent tries to access another parent's settings
- RLS policies automatically filter by tenant_id

## Dependencies

### Existing Dependencies
- `users` table with user profile information
- `student_parents` table with parent-child relationship data
- Authentication system for user ID verification
- Password hashing system (bcrypt)

### New Dependencies
- May need to create `emergency_contacts` table if it doesn't exist
- May need to create `notification_preferences` table if it doesn't exist
- Validation library (zod) for client and server-side validation

## Integration Points

### Backend Integration
- Reuse existing `tenantContextPlugin` for tenant isolation
- Reuse existing `authMiddleware` for authentication
- Extend existing query patterns from other parent routes
- Follow existing error handling and response patterns
- Use existing password hashing utilities

### Frontend Integration
- Reuse existing TanStack Query hooks pattern from other parent hooks
- Reuse existing UI components from `packages/ui`
- Follow existing page layout patterns from parent pages
- Use existing authentication session handling
- Use existing form validation patterns

## Performance Considerations

### Database Queries
- Use existing indexes on `users(id)`, `student_parents(parent_id)`
- Profile and settings queries are user-specific and should be fast
- Emergency contacts queries are user-specific and should be fast
- Notification preferences queries are user-specific and should be fast

### Caching Strategy
- Use TanStack Query with 5-minute stale time for profile and settings data
- Cache notification preferences with longer stale time (10 minutes) unless updated
- Invalidate cache on profile/settings updates

## Security Considerations

### Access Control
- All queries filtered by authenticated user ID
- RLS policies enforce tenant isolation at database level
- API endpoints verify user ID before returning data
- No direct database access from frontend

### Data Privacy
- Only return profile and settings data for authenticated parent
- No PII exposure beyond what's required for feature
- Password changes require current password verification
- Profile and settings updates require validation

### Password Security
- Current password verification before allowing change
- Password hashing using bcrypt
- Password validation (minimum length, complexity)
- Password confirmation matching

## Testing Strategy

### Contract Tests
- Test all API endpoints with valid authenticated user
- Test access control (403 for other users' settings)
- Test validation for all update operations
- Test password change functionality

### Integration Tests
- Test parent can view and edit their own profile
- Test emergency contacts CRUD operations
- Test notification preferences updates
- Test password change with correct and incorrect current password

### E2E Tests
- Test parent login and navigation to settings page
- Test viewing and editing profile information
- Test managing emergency contacts
- Test configuring notification preferences
- Test viewing relationship management
- Test changing password

