# Quickstart: Parent Emergency Contacts & Authorization

**Date**: 2025-01-27  
**Feature**: Parent Emergency Contacts & Authorization (`014-parent-emergency`)

## Overview

This quickstart guide provides a high-level overview of the parent emergency contacts and authorization feature implementation.

## Feature Summary

Enable parents to manage emergency contacts for themselves and manage pickup authorization, relationship types, and view data access for their linked children. The feature provides:

1. **Emergency Contacts**: View, add, edit, and remove emergency contacts for the parent (contact name, relationship, phone number, email address)
2. **Pickup Authorization**: View and update pickup authorization for linked children (child name, relationship type, pickup authorization status)
3. **Relationship Types**: View and update relationship types for linked children (child name, relationship type: parent, guardian, emergency_contact)
4. **Data Access**: View data access information for linked children (child name, relationship type, access level, accessible data types)

## Key Components

### Backend (`apps/api/src/routes/parent-emergency.ts`)

- `GET /api/v1/parent/emergency/contacts` - Get emergency contacts for parent
- `POST /api/v1/parent/emergency/contacts` - Add emergency contact
- `PUT /api/v1/parent/emergency/contacts/:contactId` - Update emergency contact
- `DELETE /api/v1/parent/emergency/contacts/:contactId` - Remove emergency contact
- `GET /api/v1/parent/emergency/pickup-authorization` - Get pickup authorization for parent's children
- `PUT /api/v1/parent/emergency/pickup-authorization/:relationshipId` - Update pickup authorization
- `GET /api/v1/parent/emergency/relationship-types` - Get relationship types for parent's children
- `PUT /api/v1/parent/emergency/relationship-types/:relationshipId` - Update relationship type
- `GET /api/v1/parent/emergency/data-access` - Get data access information for parent's children

### Frontend (`apps/web/src/app/parent/emergency/`)

- `page.tsx` - Main emergency contacts page with tabs/sections
- `components/emergency/EmergencyContacts.tsx` - Emergency contacts management (add, edit, remove)
- `components/emergency/PickupAuthorization.tsx` - Pickup authorization management (view, update)
- `components/emergency/RelationshipTypes.tsx` - Relationship types management (view, update)
- `components/emergency/DataAccess.tsx` - Data access visibility (view-only)

### Hooks (`apps/web/src/lib/hooks/use-parent-emergency.ts`)

- `useEmergencyContacts()` - Fetch emergency contacts
- `useAddEmergencyContact()` - Add emergency contact
- `useUpdateEmergencyContact(contactId)` - Update emergency contact
- `useRemoveEmergencyContact(contactId)` - Remove emergency contact
- `usePickupAuthorization()` - Fetch pickup authorization
- `useUpdatePickupAuthorization(relationshipId)` - Update pickup authorization
- `useRelationshipTypes()` - Fetch relationship types
- `useUpdateRelationshipType(relationshipId)` - Update relationship type
- `useDataAccess()` - Fetch data access information

## Data Model

### Key Tables

- `emergency_contacts` - Parent emergency contacts (already exists)
- `student_parents` - Parent-child relationships (already exists)
- `student_profiles` - Student information (already exists)
- `users` - User information (already exists)

### Key Queries

1. **Emergency Contacts**: Query `emergency_contacts` table filtered by parent ID
2. **Pickup Authorization**: Query `student_parents` table filtered by parent ID
3. **Relationship Types**: Query `student_parents` table filtered by parent ID
4. **Data Access**: Query `student_parents` table filtered by parent ID and derive data access from relationship type

## Implementation Steps

1. **Backend API Endpoints**: Create `parent-emergency.ts` route file with all nine endpoints
2. **Data Access Control**: Verify authenticated user ID matches parent ID for all operations
3. **Validation**: Implement validation for all update operations (phone format, email format, relationship type validation)
4. **Frontend Hooks**: Create React Query hooks for data fetching and mutations
5. **Frontend Components**: Create components for each section (emergency contacts, pickup authorization, relationship types, data access)
6. **Form Validation**: Implement client-side and server-side validation for all forms
7. **Testing**: Add contract tests, integration tests, and E2E tests

## Testing

- **Contract Tests**: Test all API endpoints with valid authenticated user
- **Integration Tests**: Test validation, access control, and data updates
- **E2E Tests**: Test parent login, navigation, and managing emergency contacts and relationships in UI

## Security

- All queries filtered by authenticated user ID
- RLS policies enforce tenant isolation at database level
- API endpoints verify user ID before returning data
- Only emergency contacts and relationships for authenticated parent is returned
- Relationship type and pickup authorization changes logged for audit



