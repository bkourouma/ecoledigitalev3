# Research: Parent Communications & Messages Feature

**Date**: 2025-01-27  
**Feature**: Parent Communications & Messages (`010-parent-messages`)

## Overview

This document consolidates research findings and technical decisions for implementing the parent communications and messages feature. All clarifications from the specification phase have been incorporated.

## Technical Decisions

### Decision 1: Data Access Pattern

**Decision**: Use existing `student_parents` table relationships and communication tables (messages, announcements, conversations, notifications, event_invitations) to query communication data for children linked to authenticated parent user.

**Rationale**: 
- The `student_parents` table already exists with proper RLS policies
- Provides parent-child relationship data with appropriate access control
- Communication tables may exist or need to be created based on existing system
- Supports multiple relationship types (parent, guardian, emergency_contact)

**Alternatives Considered**:
- Creating a new parent-communications view: Rejected - unnecessary duplication
- Direct queries to communication tables: Rejected - lacks relationship context and access control

**Implementation Notes**:
- Query joins `student_parents` with `student_profiles` to get linked children
- Join communication tables with `student_profiles` and `users` to get communication data
- Filter by `parent_id` matching authenticated user ID
- Verify parent-child relationship before returning data

### Decision 2: Message Threading

**Decision**: Display parent-teacher messages as conversation threads showing message exchange in chronological order.

**Rationale**:
- Specification requires conversation thread view
- Threading helps parents maintain context in ongoing discussions
- Chronological order provides clear message history

**Alternatives Considered**:
- Individual message list: Rejected - does not meet specification requirement for conversation threads
- Grouped by subject: Rejected - threading provides better context

**Implementation Notes**:
- Group messages by conversation thread (parent-teacher-student combination)
- Display messages in chronological order within each thread
- Show last message preview, date of last message, unread message count
- Support reply functionality to add messages to thread

### Decision 3: Read/Unread Status Tracking

**Decision**: Track read/unread status for messages, announcements, notifications, and event invitations.

**Rationale**:
- Specification requires read/unread status for all communication types
- Helps parents prioritize and manage their attention
- Status tracking is essential for notification counts

**Alternatives Considered**:
- No status tracking: Rejected - specification requires read/unread status
- Status tracking only for messages: Rejected - specification requires status for all types

**Implementation Notes**:
- Track read/unread status in communication tables or separate read_status table
- Update status when parent views content
- Support bulk mark as read functionality
- Calculate unread counts for display

### Decision 4: Event RSVP Functionality

**Decision**: Implement RSVP functionality for event invitations allowing parents to accept, decline, or indicate tentative attendance.

**Rationale**:
- Specification requires RSVP functionality
- Helps schools plan events and track attendance
- Provides value to both parents and schools

**Alternatives Considered**:
- View-only invitations: Rejected - specification requires RSVP functionality
- Simple accept/decline: Rejected - specification requires tentative option

**Implementation Notes**:
- Store RSVP status (accepted, declined, tentative, pending) in event_invitations table
- Update RSVP status when parent responds
- Support RSVP deadline enforcement
- Display RSVP status in invitation list

### Decision 5: API Endpoint Structure

**Decision**: Create `/api/v1/parent/messages` route group following existing pattern.

**Rationale**:
- Follows existing route organization (e.g., `/api/v1/parent/children`, `/api/v1/parent/homework`, `/api/v1/parent/grades`, `/api/v1/parent/payments`)
- Provides clear namespace for parent-specific messages endpoints
- Maintains consistency with codebase patterns

**Alternatives Considered**:
- Add to existing `/api/v1/parent/children` routes: Rejected - messages is separate concern
- Create `/api/v1/parent/communications` routes: Rejected - messages is more specific and matches specification

**Implementation Notes**:
- Endpoints:
  - `GET /api/v1/parent/messages/teacher-messages` - List messages from teachers (filterable by child, teacher, date range, read/unread status)
  - `GET /api/v1/parent/messages/announcements` - List school announcements (filterable by date range, priority level, read/unread status)
  - `GET /api/v1/parent/messages/conversations` - List parent-teacher conversation threads (filterable by child, teacher, conversation status)
  - `GET /api/v1/parent/messages/conversations/:conversationId` - Get conversation thread with messages
  - `POST /api/v1/parent/messages/conversations/:conversationId/reply` - Reply to conversation thread
  - `GET /api/v1/parent/messages/notifications` - List notifications (filterable by type, date range, read/unread status)
  - `POST /api/v1/parent/messages/notifications/:notificationId/read` - Mark notification as read
  - `GET /api/v1/parent/messages/event-invitations` - List event invitations (filterable by child, event type, date range, RSVP status)
  - `POST /api/v1/parent/messages/event-invitations/:invitationId/rsvp` - Respond to event invitation

### Decision 6: Frontend Route Structure

**Decision**: Create `/parent/messages` route in Next.js app directory.

**Rationale**:
- Follows existing Next.js 15 app directory structure
- Matches API endpoint naming for consistency
- Provides dedicated page for messages functionality

**Alternatives Considered**:
- Add to existing `/parent/children` page: Rejected - messages is separate concern
- Nested under `/parent/children/:childId/messages`: Rejected - would require child selection first, limiting flexibility

**Implementation Notes**:
- Routes:
  - `/parent/messages` - Main messages page with tabs/sections for different views
- Components:
  - `TeacherMessages.tsx` - List of messages from teachers with filters
  - `SchoolAnnouncements.tsx` - List of school announcements with filters
  - `ParentTeacherMessages.tsx` - List of conversation threads with reply functionality
  - `Notifications.tsx` - List of notifications with mark as read functionality
  - `EventInvitations.tsx` - List of event invitations with RSVP functionality

### Decision 7: Data Access Control

**Decision**: Enforce parent-child relationship check at API level using RLS and query filters.

**Rationale**:
- Specification requires: "Parents can only access communication information for children explicitly linked to their account"
- Existing RLS policies on `student_parents` provide database-level security
- Additional application-level check ensures correctness

**Alternatives Considered**:
- RLS only: Rejected - need explicit validation in API for clear error messages
- Application-level only: Rejected - defense in depth with RLS provides stronger security

**Implementation Notes**:
- Query filter: `WHERE student_parents.parent_id = $authenticated_user_id`
- Verify relationship exists before returning communication data
- Return 403 Forbidden if parent tries to access unlinked child's communications
- RLS policies automatically filter by tenant_id

## Dependencies

### Existing Dependencies
- `student_parents` table with RLS policies
- `student_profiles` table with student information
- Communication tables (messages, announcements, conversations, notifications, event_invitations) - may need to be created or extended
- `users` table for teacher and parent information
- `student_enrollments` table for enrollment information

### New Dependencies
- May need to create or extend communication tables if they don't exist
- May need to create read_status tracking table for read/unread status
- May need to create RSVP tracking table for event invitations

## Integration Points

### Backend Integration
- Reuse existing `tenantContextPlugin` for tenant isolation
- Reuse existing `authMiddleware` for authentication
- Extend existing query patterns from other parent routes
- Follow existing error handling and response patterns

### Frontend Integration
- Reuse existing TanStack Query hooks pattern from other parent hooks
- Reuse existing UI components from `packages/ui`
- Follow existing page layout patterns from parent pages
- Use existing authentication session handling

## Performance Considerations

### Database Queries
- Use existing indexes on `student_parents(parent_id)`, communication tables
- Pagination for messages, announcements, notifications, invitations (20 per page) prevents large result sets
- Conversation threads use efficient querying for message history
- Read/unread status queries use efficient indexing

### Caching Strategy
- Use TanStack Query with 5-minute stale time for messages data (similar to existing parent hooks)
- Cache notifications with shorter stale time (1 minute) for freshness
- Conversation threads not cached due to frequent updates
- Event invitations cached with longer stale time (10 minutes) unless RSVP deadline is approaching

## Security Considerations

### Access Control
- All queries filtered by parent-child relationship via `student_parents` table
- RLS policies enforce tenant isolation at database level
- API endpoints verify parent relationship before returning data
- No direct database access from frontend

### Data Privacy
- Only return communication data for children linked to authenticated parent
- No PII exposure beyond what's required for feature
- Message content restricted to authorized participants only

## Testing Strategy

### Contract Tests
- Test all API endpoints with valid parent-child relationships
- Test access control (403 for unlinked children)
- Test read/unread status updates
- Test RSVP functionality
- Test filtering by child, teacher, date range, status

### Integration Tests
- Test parent can view all their linked children's communications
- Test conversation thread display and reply functionality
- Test notification read status updates
- Test event invitation RSVP functionality
- Test filtering and aggregation

### E2E Tests
- Test parent login and navigation to messages page
- Test viewing messages from teachers with filters
- Test viewing school announcements
- Test viewing and replying to parent-teacher conversations
- Test viewing and marking notifications as read
- Test viewing and responding to event invitations

