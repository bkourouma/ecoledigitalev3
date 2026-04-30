# Quickstart: Parent Communications & Messages

**Date**: 2025-01-27  
**Feature**: Parent Communications & Messages (`010-parent-messages`)

## Overview

This quickstart guide provides a high-level overview of the parent communications and messages feature implementation.

## Feature Summary

Enable parents to view and manage their communications with teachers and school through a dedicated messages interface. The feature provides:

1. **Messages from Teachers**: List of messages from teachers with filters
2. **School Announcements**: List of school announcements with filters
3. **Parent-Teacher Messages**: Conversation threads with reply functionality
4. **Notifications**: List of notifications with mark as read functionality
5. **Event Invitations**: List of event invitations with RSVP functionality

## Key Components

### Backend (`apps/api/src/routes/parent-messages.ts`)

- `GET /api/v1/parent/messages/teacher-messages` - List messages from teachers
- `GET /api/v1/parent/messages/announcements` - List school announcements
- `GET /api/v1/parent/messages/conversations` - List conversation threads
- `GET /api/v1/parent/messages/conversations/:conversationId` - Get conversation thread with messages
- `POST /api/v1/parent/messages/conversations/:conversationId/reply` - Reply to conversation thread
- `GET /api/v1/parent/messages/notifications` - List notifications
- `POST /api/v1/parent/messages/notifications/:notificationId/read` - Mark notification as read
- `GET /api/v1/parent/messages/event-invitations` - List event invitations
- `POST /api/v1/parent/messages/event-invitations/:invitationId/rsvp` - Respond to event invitation

### Frontend (`apps/web/src/app/parent/messages/`)

- `page.tsx` - Main messages page with tabs/sections
- `components/messages/TeacherMessages.tsx` - Messages from teachers component
- `components/messages/SchoolAnnouncements.tsx` - School announcements component
- `components/messages/ParentTeacherMessages.tsx` - Parent-teacher conversations component
- `components/messages/Notifications.tsx` - Notifications component
- `components/messages/EventInvitations.tsx` - Event invitations component

### Hooks (`apps/web/src/lib/hooks/use-parent-messages.ts`)

- `useTeacherMessages(childId, filters, page)` - Fetch messages from teachers
- `useSchoolAnnouncements(filters, page)` - Fetch school announcements
- `useParentTeacherConversations(childId, filters)` - Fetch conversation threads
- `useConversationThread(conversationId)` - Fetch conversation thread with messages
- `useReplyToConversation(conversationId)` - Reply to conversation thread
- `useNotifications(filters, page)` - Fetch notifications
- `useMarkNotificationRead(notificationId)` - Mark notification as read
- `useEventInvitations(childId, filters)` - Fetch event invitations
- `useRespondToInvitation(invitationId)` - Respond to event invitation

## Data Model

### Key Tables

- `student_parents` - Parent-child relationships
- `teacher_messages` or `messages` - Messages from teachers (may need to be created or extended)
- `school_announcements` or `announcements` - School announcements (may need to be created or extended)
- `parent_teacher_conversations` or `conversations` - Conversation threads (may need to be created or extended)
- `conversation_messages` or `messages` - Messages within conversations (may need to be created or extended)
- `notifications` - Notifications (may need to be created or extended)
- `event_invitations` or `invitations` - Event invitations (may need to be created or extended)

### Key Queries

1. **Messages from Teachers**: Query `teacher_messages` joined with `student_profiles` and `users`, filtered by parent-child relationship
2. **School Announcements**: Query `school_announcements` joined with `users`, filtered by tenant
3. **Parent-Teacher Conversations**: Query `parent_teacher_conversations` joined with `student_profiles` and `users`, filtered by parent-child relationship
4. **Conversation Messages**: Query `conversation_messages` for a specific conversation thread
5. **Notifications**: Query `notifications` filtered by parent_id
6. **Event Invitations**: Query `event_invitations` joined with `student_profiles` and `users`, filtered by parent-child relationship

## Implementation Steps

1. **Backend API Endpoints**: Create `parent-messages.ts` route file with all nine endpoints
2. **Data Access Control**: Verify parent-child relationship for all queries
3. **Read/Unread Status Tracking**: Implement read/unread status tracking for messages, announcements, notifications
4. **Conversation Threading**: Implement conversation thread display and reply functionality
5. **RSVP Functionality**: Implement RSVP functionality for event invitations
6. **Frontend Hooks**: Create React Query hooks for data fetching
7. **Frontend Components**: Create components for each view (teacher messages, announcements, conversations, notifications, invitations)
8. **Testing**: Add contract tests, integration tests, and E2E tests

## Testing

- **Contract Tests**: Test all API endpoints with valid parent-child relationships
- **Integration Tests**: Test read/unread status updates, conversation reply functionality, RSVP functionality
- **E2E Tests**: Test parent login, navigation, and viewing messages in UI

## Security

- All queries filtered by parent-child relationship via `student_parents` table
- RLS policies enforce tenant isolation at database level
- API endpoints verify parent relationship before returning data
- Only communication data for children linked to authenticated parent is returned

