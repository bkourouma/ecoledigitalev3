# Data Model: Parent Communications & Messages Feature

**Date**: 2025-01-27  
**Feature**: Parent Communications & Messages (`010-parent-messages`)

## Overview

This document defines the data model for the parent communications and messages feature. The feature leverages existing database tables and relationships, with potential new tables required for communication functionality.

## Entities

### Parent-Child Relationship

**Source Table**: `student_parents`

**Purpose**: Links parent user accounts to student profiles, establishing the relationship that enables parent access to child's communication data.

**Key Attributes**:
- `id` (UUID) - Primary key
- `tenant_id` (UUID) - Multi-tenant isolation
- `student_id` (UUID) - References `student_profiles.id`
- `parent_id` (UUID) - References `users.id` (authenticated parent user)
- `relationship_type` (ENUM) - 'parent', 'guardian', 'emergency_contact'
- `is_primary_contact` (BOOLEAN) - Primary contact flag
- `emergency_contact` (BOOLEAN) - Emergency contact flag
- `can_pickup` (BOOLEAN) - Pickup authorization
- `notes` (TEXT) - Additional notes
- `created_at` (TIMESTAMP) - Creation timestamp

**Relationships**:
- Many-to-one with `student_profiles` (via `student_id`)
- Many-to-one with `users` (via `parent_id`)
- Many-to-one with `tenants` (via `tenant_id`)

**Query Pattern**: 
```sql
SELECT sp.*, u.first_name, u.last_name, u.email
FROM student_parents sp_rel
JOIN student_profiles sp ON sp_rel.student_id = sp.id
JOIN users u ON sp.user_id = u.id
WHERE sp_rel.parent_id = $parent_id
  AND sp_rel.tenant_id = $tenant_id
```

### Teacher Message

**Source Table**: `teacher_messages` or `messages` (may need to be created or extended)

**Purpose**: Represents a message from a teacher to a parent about a student, used for displaying messages from teachers.

**Key Attributes**:
- `id` (UUID) - Primary key
- `tenant_id` (UUID) - Multi-tenant isolation
- `teacher_id` (UUID) - References `users.id` (teacher)
- `student_id` (UUID) - References `student_profiles.id`
- `parent_id` (UUID) - References `users.id` (parent)
- `subject` (VARCHAR) - Message subject
- `content` (TEXT) - Message content
- `priority_level` (ENUM) - 'low', 'normal', 'high', 'urgent' (optional)
- `sent_at` (TIMESTAMPTZ) - When message was sent
- `created_at` (TIMESTAMPTZ) - Creation timestamp
- `updated_at` (TIMESTAMPTZ) - Last update timestamp

**Relationships**:
- Many-to-one with `users` (via `teacher_id`)
- Many-to-one with `student_profiles` (via `student_id`)
- Many-to-one with `users` (via `parent_id`)

**Query Pattern for Teacher Messages**:
```sql
SELECT 
  tm.id as message_id,
  tm.teacher_id,
  tm.student_id,
  tm.parent_id,
  tm.subject,
  tm.content,
  tm.priority_level,
  tm.sent_at,
  t.first_name || ' ' || t.last_name as teacher_name,
  sp.id as child_id,
  COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name
FROM teacher_messages tm
JOIN users t ON tm.teacher_id = t.id
JOIN student_profiles sp ON tm.student_id = sp.id
JOIN users u ON sp.user_id = u.id
WHERE tm.parent_id = $parent_id
  AND tm.tenant_id = $tenant_id
ORDER BY tm.sent_at DESC
```

### School Announcement

**Source Table**: `school_announcements` or `announcements` (may need to be created or extended)

**Purpose**: Represents a school-wide announcement visible to all parents in the same tenant/school.

**Key Attributes**:
- `id` (UUID) - Primary key
- `tenant_id` (UUID) - Multi-tenant isolation
- `author_id` (UUID) - References `users.id` (school administrator or teacher)
- `title` (VARCHAR) - Announcement title
- `content` (TEXT) - Announcement content
- `priority_level` (ENUM) - 'low', 'normal', 'high', 'urgent' (optional)
- `posted_at` (TIMESTAMPTZ) - When announcement was posted
- `created_at` (TIMESTAMPTZ) - Creation timestamp
- `updated_at` (TIMESTAMPTZ) - Last update timestamp

**Relationships**:
- Many-to-one with `users` (via `author_id`)
- Many-to-one with `tenants` (via `tenant_id`)

**Query Pattern for School Announcements**:
```sql
SELECT 
  sa.id as announcement_id,
  sa.author_id,
  sa.title,
  sa.content,
  sa.priority_level,
  sa.posted_at,
  a.first_name || ' ' || a.last_name as author_name
FROM school_announcements sa
JOIN users a ON sa.author_id = a.id
WHERE sa.tenant_id = $tenant_id
ORDER BY sa.posted_at DESC
```

### Parent-Teacher Conversation

**Source Table**: `parent_teacher_conversations` or `conversations` (may need to be created or extended)

**Purpose**: Represents a conversation thread between a parent and a teacher about a student.

**Key Attributes**:
- `id` (UUID) - Primary key (conversation_id)
- `tenant_id` (UUID) - Multi-tenant isolation
- `parent_id` (UUID) - References `users.id` (parent)
- `teacher_id` (UUID) - References `users.id` (teacher)
- `student_id` (UUID) - References `student_profiles.id`
- `subject` (VARCHAR) - Conversation subject
- `status` (ENUM) - 'active', 'archived', 'closed'
- `created_at` (TIMESTAMPTZ) - Creation timestamp
- `updated_at` (TIMESTAMPTZ) - Last update timestamp

**Relationships**:
- Many-to-one with `users` (via `parent_id`)
- Many-to-one with `users` (via `teacher_id`)
- Many-to-one with `student_profiles` (via `student_id`)
- One-to-many with `conversation_messages` (via `conversation_id`)

**Query Pattern for Parent-Teacher Conversations**:
```sql
SELECT 
  ptc.id as conversation_id,
  ptc.parent_id,
  ptc.teacher_id,
  ptc.student_id,
  ptc.subject,
  ptc.status,
  ptc.updated_at as last_message_date,
  t.first_name || ' ' || t.last_name as teacher_name,
  sp.id as child_id,
  COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name,
  (SELECT COUNT(*) FROM conversation_messages cm 
   WHERE cm.conversation_id = ptc.id 
   AND cm.read_at IS NULL 
   AND cm.sender_id != $parent_id) as unread_count,
  (SELECT content FROM conversation_messages cm 
   WHERE cm.conversation_id = ptc.id 
   ORDER BY cm.sent_at DESC LIMIT 1) as last_message_preview
FROM parent_teacher_conversations ptc
JOIN users t ON ptc.teacher_id = t.id
JOIN student_profiles sp ON ptc.student_id = sp.id
JOIN users u ON sp.user_id = u.id
WHERE ptc.parent_id = $parent_id
  AND ptc.tenant_id = $tenant_id
ORDER BY ptc.updated_at DESC
```

### Conversation Message

**Source Table**: `conversation_messages` or `messages` (may need to be created or extended)

**Purpose**: Represents a message within a parent-teacher conversation thread.

**Key Attributes**:
- `id` (UUID) - Primary key
- `tenant_id` (UUID) - Multi-tenant isolation
- `conversation_id` (UUID) - References `parent_teacher_conversations.id`
- `sender_id` (UUID) - References `users.id` (parent or teacher)
- `content` (TEXT) - Message content
- `sent_at` (TIMESTAMPTZ) - When message was sent
- `read_at` (TIMESTAMPTZ) - When message was read (NULL if unread)
- `created_at` (TIMESTAMPTZ) - Creation timestamp

**Relationships**:
- Many-to-one with `parent_teacher_conversations` (via `conversation_id`)
- Many-to-one with `users` (via `sender_id`)

**Query Pattern for Conversation Messages**:
```sql
SELECT 
  cm.id as message_id,
  cm.conversation_id,
  cm.sender_id,
  cm.content,
  cm.sent_at,
  cm.read_at,
  s.first_name || ' ' || s.last_name as sender_name
FROM conversation_messages cm
JOIN users s ON cm.sender_id = s.id
WHERE cm.conversation_id = $conversation_id
  AND cm.tenant_id = $tenant_id
ORDER BY cm.sent_at ASC
```

### Notification

**Source Table**: `notifications` (may need to be created or extended)

**Purpose**: Represents a notification about important events, messages, and updates.

**Key Attributes**:
- `id` (UUID) - Primary key
- `tenant_id` (UUID) - Multi-tenant isolation
- `parent_id` (UUID) - References `users.id` (parent)
- `notification_type` (ENUM) - 'message', 'announcement', 'event', 'grade', 'payment', 'other'
- `title` (VARCHAR) - Notification title
- `content` (TEXT) - Notification content
- `action_link` (TEXT) - Link to related content (optional)
- `read_at` (TIMESTAMPTZ) - When notification was read (NULL if unread)
- `created_at` (TIMESTAMPTZ) - Creation timestamp

**Relationships**:
- Many-to-one with `users` (via `parent_id`)

**Query Pattern for Notifications**:
```sql
SELECT 
  n.id as notification_id,
  n.parent_id,
  n.notification_type,
  n.title,
  n.content,
  n.action_link,
  n.read_at,
  n.created_at
FROM notifications n
WHERE n.parent_id = $parent_id
  AND n.tenant_id = $tenant_id
ORDER BY n.created_at DESC
```

### Event Invitation

**Source Table**: `event_invitations` or `invitations` (may need to be created or extended)

**Purpose**: Represents an invitation to a school event, parent-teacher conference, or other activity.

**Key Attributes**:
- `id` (UUID) - Primary key
- `tenant_id` (UUID) - Multi-tenant isolation
- `event_id` (UUID) - References `events.id` (if events table exists)
- `parent_id` (UUID) - References `users.id` (parent)
- `student_id` (UUID) - References `student_profiles.id` (optional)
- `event_name` (VARCHAR) - Event name
- `event_description` (TEXT) - Event description
- `event_date` (TIMESTAMPTZ) - Event date and time
- `event_location` (VARCHAR) - Event location
- `organizer_id` (UUID) - References `users.id` (organizer)
- `rsvp_status` (ENUM) - 'pending', 'accepted', 'declined', 'tentative'
- `rsvp_deadline` (DATE) - RSVP deadline
- `rsvp_response_at` (TIMESTAMPTZ) - When RSVP was submitted
- `created_at` (TIMESTAMPTZ) - Creation timestamp
- `updated_at` (TIMESTAMPTZ) - Last update timestamp

**Relationships**:
- Many-to-one with `users` (via `parent_id`)
- Many-to-one with `student_profiles` (via `student_id`, optional)
- Many-to-one with `users` (via `organizer_id`)

**Query Pattern for Event Invitations**:
```sql
SELECT 
  ei.id as invitation_id,
  ei.event_id,
  ei.parent_id,
  ei.student_id,
  ei.event_name,
  ei.event_description,
  ei.event_date,
  ei.event_location,
  ei.organizer_id,
  ei.rsvp_status,
  ei.rsvp_deadline,
  ei.rsvp_response_at,
  o.first_name || ' ' || o.last_name as organizer_name,
  sp.id as child_id,
  COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name
FROM event_invitations ei
JOIN users o ON ei.organizer_id = o.id
LEFT JOIN student_profiles sp ON ei.student_id = sp.id
LEFT JOIN users u ON sp.user_id = u.id
WHERE ei.parent_id = $parent_id
  AND ei.tenant_id = $tenant_id
ORDER BY ei.event_date ASC
```

## Validation Rules

### Parent-Child Relationship
- Must have valid `parent_id` referencing authenticated user
- Must have valid `student_id` referencing existing student profile
- Must have valid `tenant_id` matching authenticated tenant
- Relationship must exist in `student_parents` table for data access

### Teacher Messages
- Only include messages for children linked to authenticated parent
- Support filtering by child_id, teacher_id, date range, read/unread status
- Order by `sent_at DESC` (most recent first)
- Track read/unread status for each message

### School Announcements
- Only include announcements for authenticated parent's tenant/school
- Support filtering by date range, priority level, read/unread status
- Order by `posted_at DESC` (most recent first)
- Track read/unread status for each announcement

### Parent-Teacher Conversations
- Only include conversations for children linked to authenticated parent
- Support filtering by child_id, teacher_id, conversation status
- Order by `updated_at DESC` (most recent first)
- Calculate unread message count for each conversation
- Display last message preview for each conversation

### Conversation Messages
- Only include messages for conversations accessible to authenticated parent
- Display messages in chronological order (oldest first)
- Track read/unread status for each message
- Support reply functionality to add messages to thread

### Notifications
- Only include notifications for authenticated parent
- Support filtering by notification_type, date range, read/unread status
- Order by `created_at DESC` (most recent first)
- Track read/unread status for each notification
- Provide action link to navigate to related content

### Event Invitations
- Only include invitations for children linked to authenticated parent (if student_id is set)
- Support filtering by child_id, event_type, date range, RSVP status
- Order by `event_date ASC` (soonest first)
- Track RSVP status (pending, accepted, declined, tentative)
- Support RSVP deadline enforcement
- Update RSVP status when parent responds

