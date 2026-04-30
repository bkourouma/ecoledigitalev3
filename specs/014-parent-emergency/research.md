# Research: Parent Emergency Contacts & Authorization Feature

**Date**: 2025-01-27  
**Feature**: Parent Emergency Contacts & Authorization (`014-parent-emergency`)

## Overview

This document consolidates research findings and technical decisions for implementing the parent emergency contacts and authorization feature. All clarifications from the specification phase have been incorporated.

## Technical Decisions

### Decision 1: Data Access Pattern

**Decision**: Use existing `emergency_contacts` table for parent emergency contacts and `student_parents` table for parent-child relationships. Query through parent-child relationships via `student_parents` table.

**Rationale**: 
- The `emergency_contacts` table already exists with parent emergency contact data
- The `student_parents` table already exists with parent-child relationship data including relationship types and pickup authorization
- Supports multi-tenant RLS policies
- Parent-child relationships via `student_parents` enable proper access control

**Alternatives Considered**:
- Creating new tables for emergency contacts: Rejected - `emergency_contacts` table already exists
- Creating new tables for relationships: Rejected - `student_parents` table already exists with all necessary fields

**Implementation Notes**:
- Query `emergency_contacts` table for parent's emergency contacts filtered by parent ID
- Query `student_parents` table for parent-child relationships filtered by parent ID
- Verify authenticated user ID matches parent ID for all operations
- Support CRUD operations for emergency contacts
- Support update operations for relationship types and pickup authorization

### Decision 2: Emergency Contacts Management

**Decision**: Allow parents to add, edit, and remove emergency contacts through the emergency contacts interface.

**Rationale**:
- Specification requires full CRUD operations for emergency contacts
- Parents need to maintain accurate emergency contact information
- Emergency contacts are critical for school safety

**Alternatives Considered**:
- View-only emergency contacts: Rejected - specification requires add/edit/remove functionality
- Administrative approval required: Rejected - specification allows direct parent management

**Implementation Notes**:
- Query `emergency_contacts` table for parent's emergency contacts
- Support add, edit, remove operations
- Validate contact information before saving (phone format, email format, contact name required)
- Require confirmation before removing contacts

### Decision 3: Pickup Authorization Management

**Decision**: Allow parents to update pickup authorization for their linked children through the pickup authorization interface.

**Rationale**:
- Specification requires ability to update pickup authorization
- Pickup authorization is critical for school safety
- Parents need to control who can pick up their children

**Alternatives Considered**:
- View-only pickup authorization: Rejected - specification requires update functionality
- Administrative approval required for all changes: Rejected - specification allows direct parent updates

**Implementation Notes**:
- Query `student_parents` table for parent-child relationships
- Support update operations for `can_pickup` field
- Require confirmation before disabling pickup authorization
- Update `can_pickup` field in `student_parents` table

### Decision 4: Relationship Types Management

**Decision**: Allow parents to update relationship types for their linked children through the relationship types interface. Changes may require administrative approval.

**Rationale**:
- Specification requires ability to update relationship types
- Relationship types help schools understand the nature of relationships
- Parents need to maintain accurate relationship information

**Alternatives Considered**:
- View-only relationship types: Rejected - specification requires update functionality
- Administrative approval required for all changes: Preferred - relationship type changes may require approval

**Implementation Notes**:
- Query `student_parents` table for parent-child relationships
- Support update operations for `relationship_type` field
- May require administrative approval for relationship type changes
- Update `relationship_type` field in `student_parents` table
- Display message that relationship type changes may require administrative approval

### Decision 5: Data Access Visibility

**Decision**: Display data access information for each linked child based on relationship type and authorization status. Data access is view-only (cannot be modified directly).

**Rationale**:
- Specification requires visibility into data access permissions
- Data access is derived from relationship types and authorization status
- Parents need to understand what data they can access

**Alternatives Considered**:
- No data access display: Rejected - specification requires data access visibility
- Allow direct modification of data access: Rejected - data access is derived from relationship types and authorization status

**Implementation Notes**:
- Query `student_parents` table for parent-child relationships
- Derive data access permissions from relationship type and authorization status
- Display data access information for each child
- Show what data types are accessible (grades, attendance, payments, etc.)
- Display message that data access changes require relationship type or authorization changes

### Decision 6: API Endpoint Structure

**Decision**: Create `/api/v1/parent/emergency` route group following existing pattern.

**Rationale**:
- Follows existing route organization (e.g., `/api/v1/parent/children`, `/api/v1/parent/homework`, `/api/v1/parent/grades`, `/api/v1/parent/payments`, `/api/v1/parent/messages`, `/api/v1/parent/settings`, `/api/v1/parent/academic`, `/api/v1/parent/documents`)
- Provides clear namespace for parent-specific emergency contacts endpoints
- Maintains consistency with codebase patterns

**Alternatives Considered**:
- Add to existing `/api/v1/parent/settings` routes: Rejected - emergency contacts is separate concern and includes more than just emergency contacts
- Create `/api/v1/parent/relationships` routes: Rejected - emergency contacts is more comprehensive and includes emergency contacts management

**Implementation Notes**:
- Endpoints:
  - `GET /api/v1/parent/emergency/contacts` - Get emergency contacts for parent
  - `POST /api/v1/parent/emergency/contacts` - Add emergency contact
  - `PUT /api/v1/parent/emergency/contacts/:contactId` - Update emergency contact
  - `DELETE /api/v1/parent/emergency/contacts/:contactId` - Remove emergency contact
  - `GET /api/v1/parent/emergency/pickup-authorization` - Get pickup authorization for parent's children
  - `PUT /api/v1/parent/emergency/pickup-authorization/:relationshipId` - Update pickup authorization
  - `GET /api/v1/parent/emergency/relationship-types` - Get relationship types for parent's children
  - `PUT /api/v1/parent/emergency/relationship-types/:relationshipId` - Update relationship type
  - `GET /api/v1/parent/emergency/data-access` - Get data access information for parent's children

### Decision 7: Frontend Route Structure

**Decision**: Create `/parent/emergency` route in Next.js app directory.

**Rationale**:
- Follows existing Next.js 15 app directory structure
- Matches API endpoint naming for consistency
- Provides dedicated page for emergency contacts functionality

**Alternatives Considered**:
- Add to existing `/parent/settings` page: Rejected - emergency contacts is separate concern and includes more than just emergency contacts
- Nested under `/parent/relationships`: Rejected - emergency contacts is more comprehensive

**Implementation Notes**:
- Routes:
  - `/parent/emergency` - Main emergency contacts page with tabs/sections for different functionality
- Components:
  - `EmergencyContacts.tsx` - Emergency contacts management (add, edit, remove)
  - `PickupAuthorization.tsx` - Pickup authorization management (view, update)
  - `RelationshipTypes.tsx` - Relationship types management (view, update)
  - `DataAccess.tsx` - Data access visibility (view-only)

### Decision 8: Data Access Control

**Decision**: Enforce parent user ID check at API level using authentication and query filters through `student_parents` relationship.

**Rationale**:
- Specification requires: "Parents can only view and manage emergency contacts and relationships for their own account and their own linked children"
- Authentication provides user ID
- `student_parents` relationship provides parent-child link
- Additional query filters ensure correctness

**Alternatives Considered**:
- RLS only: Rejected - need explicit validation in API for clear error messages
- Application-level only: Rejected - defense in depth with RLS provides stronger security

**Implementation Notes**:
- Query filter: `WHERE emergency_contacts.parent_id = $authenticated_user_id` for emergency contacts
- Query filter: Join with `student_parents` table and filter by `parent_id = $authenticated_user_id` for relationships
- Verify authenticated user ID matches parent ID for all operations
- Return 403 Forbidden if parent tries to access another parent's information
- RLS policies automatically filter by tenant_id

### Decision 9: Relationship Type and Pickup Authorization Updates

**Decision**: Allow parents to update relationship types and pickup authorization directly, but may require administrative approval for relationship type changes.

**Rationale**:
- Specification requires ability to update relationship types and pickup authorization
- Pickup authorization changes can be immediate (safety concern)
- Relationship type changes may require administrative approval (data access implications)

**Alternatives Considered**:
- Require administrative approval for all changes: Rejected - pickup authorization changes should be immediate
- Allow all changes without approval: Rejected - relationship type changes may have data access implications

**Implementation Notes**:
- Update `can_pickup` field in `student_parents` table immediately
- Update `relationship_type` field in `student_parents` table (may require approval workflow)
- Display message that relationship type changes may require administrative approval
- Log all changes for audit purposes

## Dependencies

### Existing Dependencies
- `emergency_contacts` table with parent emergency contact data
- `student_parents` table with parent-child relationship data
- `student_profiles` table with student information
- `users` table with user information
- Authentication system for user ID verification

### New Dependencies
- May need to create approval workflow for relationship type changes (if required)
- Validation library (zod) for client and server-side validation

## Integration Points

### Backend Integration
- Reuse existing `tenantContextPlugin` for tenant isolation
- Reuse existing `authMiddleware` for authentication
- Extend existing query patterns from other parent routes
- Follow existing error handling and response patterns
- Use existing validation patterns

### Frontend Integration
- Reuse existing TanStack Query hooks pattern from other parent hooks
- Reuse existing UI components from `packages/ui`
- Follow existing page layout patterns from parent pages
- Use existing authentication session handling
- Use existing form validation patterns

## Performance Considerations

### Database Queries
- Use existing indexes on `emergency_contacts(parent_id)`, `student_parents(parent_id)`
- Emergency contacts queries are parent-specific and should be fast
- Relationship queries are parent-specific and should be fast

### Caching Strategy
- Use TanStack Query with 5-minute stale time for emergency contacts and relationships data
- Invalidate cache on emergency contacts or relationship updates

## Security Considerations

### Access Control
- All queries filtered by authenticated user ID
- RLS policies enforce tenant isolation at database level
- API endpoints verify user ID before returning data
- No direct database access from frontend

### Data Privacy
- Only return emergency contacts and relationships for authenticated parent
- No PII exposure beyond what's required for feature
- Relationship type and pickup authorization changes logged for audit

## Testing Strategy

### Contract Tests
- Test all API endpoints with valid authenticated user
- Test access control (403 for other users' information)
- Test validation for all update operations
- Test emergency contacts CRUD operations
- Test relationship type and pickup authorization updates

### Integration Tests
- Test parent can view and manage their own emergency contacts
- Test parent can update pickup authorization for their linked children
- Test parent can update relationship types for their linked children
- Test parent can view data access information for their linked children

### E2E Tests
- Test parent login and navigation to emergency contacts page
- Test viewing and managing emergency contacts
- Test updating pickup authorization
- Test updating relationship types
- Test viewing data access information



