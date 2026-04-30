# Quickstart: Parent Profile & Settings

**Date**: 2025-01-27  
**Feature**: Parent Profile & Settings (`011-parent-settings`)

## Overview

This quickstart guide provides a high-level overview of the parent profile and settings feature implementation.

## Feature Summary

Enable parents to view and manage their profile, contact information, emergency contacts, notification preferences, and relationship management through a dedicated settings interface. The feature provides:

1. **Parent Profile**: View and edit profile information (name, email, phone, address, date of birth)
2. **Contact Information**: View and edit contact information (phone, email, address)
3. **Emergency Contacts**: Manage emergency contacts (add, edit, remove)
4. **Notification Preferences**: Configure notification preferences per notification type
5. **Relationship Management**: View linked children and relationship information (read-only)
6. **Change Password**: Change account password

## Key Components

### Backend (`apps/api/src/routes/parent-settings.ts`)

- `GET /api/v1/parent/settings/profile` - Get parent profile
- `PUT /api/v1/parent/settings/profile` - Update parent profile
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

### Frontend (`apps/web/src/app/parent/settings/`)

- `page.tsx` - Main settings page with tabs/sections
- `components/settings/ParentProfile.tsx` - Parent profile view and edit
- `components/settings/ContactInformation.tsx` - Contact information view and edit
- `components/settings/EmergencyContacts.tsx` - Emergency contacts management
- `components/settings/NotificationPreferences.tsx` - Notification preferences configuration
- `components/settings/RelationshipManagement.tsx` - Relationship management view (read-only)
- `components/settings/ChangePassword.tsx` - Password change form

### Hooks (`apps/web/src/lib/hooks/use-parent-settings.ts`)

- `useParentProfile()` - Fetch parent profile
- `useUpdateParentProfile()` - Update parent profile
- `useContactInformation()` - Fetch contact information
- `useUpdateContactInformation()` - Update contact information
- `useEmergencyContacts()` - Fetch emergency contacts
- `useAddEmergencyContact()` - Add emergency contact
- `useUpdateEmergencyContact(contactId)` - Update emergency contact
- `useRemoveEmergencyContact(contactId)` - Remove emergency contact
- `useNotificationPreferences()` - Fetch notification preferences
- `useUpdateNotificationPreferences()` - Update notification preferences
- `useRelationships()` - Fetch relationship management information
- `useChangePassword()` - Change password

## Data Model

### Key Tables

- `users` - Parent user profile information
- `emergency_contacts` - Emergency contacts (may need to be created)
- `notification_preferences` - Notification preferences (may need to be created)
- `student_parents` - Parent-child relationships

### Key Queries

1. **Parent Profile**: Query `users` table filtered by authenticated user ID
2. **Contact Information**: Query `users` table for contact information filtered by authenticated user ID
3. **Emergency Contacts**: Query `emergency_contacts` table filtered by parent_id
4. **Notification Preferences**: Query `notification_preferences` table filtered by parent_id
5. **Relationship Management**: Query `student_parents` table joined with `student_profiles` and `users`, filtered by parent_id

## Implementation Steps

1. **Backend API Endpoints**: Create `parent-settings.ts` route file with all twelve endpoints
2. **Data Access Control**: Verify authenticated user ID matches parent ID for all operations
3. **Validation**: Implement validation for all update operations (email format, phone format, password requirements)
4. **Frontend Hooks**: Create React Query hooks for data fetching and mutations
5. **Frontend Components**: Create components for each settings section (profile, contact, emergency contacts, preferences, relationships, password)
6. **Form Validation**: Implement client-side and server-side validation for all forms
7. **Testing**: Add contract tests, integration tests, and E2E tests

## Testing

- **Contract Tests**: Test all API endpoints with valid authenticated user
- **Integration Tests**: Test validation, access control, and data updates
- **E2E Tests**: Test parent login, navigation, and managing settings in UI

## Security

- All queries filtered by authenticated user ID
- RLS policies enforce tenant isolation at database level
- API endpoints verify user ID before returning data
- Only profile and settings data for authenticated parent is returned
- Password changes require current password verification

