# Research: Trainer Space (Espace Formateurs) - Imhotep Data

**Date**: 2025-11-20  
**Feature**: 019-espace-formateurs-imhotep  
**Phase**: 0 - Technical Research

## Research Questions

### 1. Calendar Library for Trainer Schedule

**Question**: Which calendar library should be used for the trainer schedule view?

**Decision**: Use **FullCalendar** (React integration: `@fullcalendar/react`)

**Rationale**:
- Already used in Phase 3 (017-session-calendar) for public session calendar
- Consistent UI/UX across the application
- Supports multiple view types (month, week, day, list) out of the box
- Built-in event rendering and date navigation
- Active maintenance and large community
- Works well with React and TypeScript
- Supports localization (French locale available)
- Can display both sessions and unavailability periods with different styling

**Alternatives Considered**:
- **React Big Calendar**: Simpler but less feature-rich, would require additional setup
- **React Calendar**: Too basic, would require significant custom development
- **Custom Calendar**: Too time-consuming, reinventing the wheel
- **FullCalendar**: Best balance of features, maintainability, and consistency with existing codebase

**Implementation Notes**:
- Reuse existing FullCalendar setup from Phase 3
- Install: `@fullcalendar/react @fullcalendar/daygrid @fullcalendar/timegrid @fullcalendar/interaction @fullcalendar/core`
- Use French locale: `@fullcalendar/core/locales/fr`
- Custom event rendering for sessions (blue) vs unavailability periods (gray)
- Click events to show session details or unavailability management

---

### 2. File Upload Service for Course Materials

**Question**: How should course materials, photos, and CVs be uploaded and stored?

**Decision**: Use existing **FileStorageService** with local file system storage

**Rationale**:
- FileStorageService already exists and is used throughout the application
- Supports tenant-scoped file organization
- Handles file validation, size limits, and metadata storage
- No additional infrastructure required
- Consistent with existing file upload patterns (assignments, materials)
- Can be extended to support cloud storage (S3) in future if needed

**Alternatives Considered**:
- **AWS S3**: More scalable but requires additional setup and costs, not needed for current scale
- **MinIO**: Object storage but adds complexity, local file system is sufficient
- **Database BLOB**: Not suitable for large files, impacts database performance
- **FileStorageService**: Already proven, consistent with codebase, sufficient for requirements

**Implementation Notes**:
- Reuse `apps/api/src/services/fileStorage.ts` FileStorageService
- File organization: `uploads/{tenantId}/formateurs/{formateurId}/supports/{materialId}/`
- For photos: `uploads/{tenantId}/formateurs/{formateurId}/photos/`
- For CVs: `uploads/{tenantId}/formateurs/{formateurId}/cv/`
- File size limits: 100MB for course materials, 5MB for photos, 10MB for CVs
- File type validation: PDF, PPT, PPTX, DOC, DOCX, ZIP, MP4, AVI for materials; JPG, PNG for photos; PDF for CVs

---

### 3. Group Messaging Implementation

**Question**: How should trainers send group messages to enrolled learners via email and SMS?

**Decision**: Use existing **EmailService** and **SMSService** with batch sending

**Rationale**:
- EmailService and SMSService already exist and are used for enrollment confirmations
- Supports both email and SMS sending
- Handles error cases and logging
- No additional infrastructure required
- Consistent with existing notification patterns
- Can send to multiple recipients in batch

**Alternatives Considered**:
- **Third-party messaging service**: Adds dependency and cost, existing services are sufficient
- **Queue-based system**: More complex, not needed for current scale
- **Direct API calls**: Less maintainable, existing services provide abstraction
- **EmailService + SMSService**: Already proven, consistent with codebase, sufficient for requirements

**Implementation Notes**:
- Reuse `apps/api/src/services/email.service.ts` EmailService
- Reuse `apps/api/src/services/sms.service.ts` SMSService
- Batch sending: Loop through enrolled learners and send individually
- Filter recipients by attendance status (all, present, absent) before sending
- Log all sent messages in database for trainer reference
- Handle missing email/phone gracefully (skip and log)
- Use async sending to avoid blocking request

---

### 4. Attendance Tracking Data Model

**Question**: How should attendance records be stored and tracked?

**Decision**: Create new `session_attendance` table with session_id, learner_id, present boolean, and audit fields

**Rationale**:
- Separate table allows flexible querying and reporting
- Can track attendance history and changes
- Supports audit trail (who marked, when)
- Allows multiple trainers to mark attendance for same session
- Can be extended for partial attendance or time-based tracking in future
- Clear separation of concerns from enrollment table

**Alternatives Considered**:
- **Add to inscriptions_professionnelles**: Mixes enrollment and attendance concerns, less flexible
- **JSONB column**: Less queryable, harder to report on
- **Separate table**: Clean separation, flexible, supports audit trail

**Implementation Notes**:
- Table: `session_attendance`
- Fields: `id`, `tenant_id`, `session_id`, `inscription_id` (FK to inscriptions_professionnelles), `present` (boolean), `marked_by` (formateur_id), `marked_at` (timestamp), `updated_at` (timestamp)
- Unique constraint on (session_id, inscription_id) to prevent duplicates
- RLS policy for tenant isolation
- Indexes on (session_id), (formateur_id), (tenant_id, session_id)

---

### 5. Course Material Download Tracking

**Question**: How should course material downloads be tracked for statistics?

**Decision**: Create new `support_telechargements` table to log each download event

**Rationale**:
- Separate table allows detailed analytics and reporting
- Can track who downloaded, when, and from which session
- Supports download statistics per material and per session
- Can be used for usage analytics and material effectiveness
- Clear audit trail for downloads

**Alternatives Considered**:
- **Counter field**: Less detailed, can't track who/when
- **JSONB array**: Less queryable, harder to report on
- **Separate table**: Detailed tracking, supports analytics, flexible

**Implementation Notes**:
- Table: `support_telechargements`
- Fields: `id`, `tenant_id`, `support_id` (FK to supports_cours), `apprenant_id` (FK to apprenants), `session_id` (FK, nullable), `downloaded_at` (timestamp)
- Indexes on (support_id), (apprenant_id), (tenant_id, support_id)
- RLS policy for tenant isolation
- Track downloads when learners access material download endpoint

---

### 6. Trainer Unavailability Management

**Question**: How should trainer unavailability periods be stored and managed?

**Decision**: Create new `formateur_indisponibilites` table with date ranges and reason

**Rationale**:
- Separate table allows flexible querying and calendar integration
- Can track reason for unavailability (vacation, sick, other)
- Supports date range queries for conflict detection
- Can be used by administrators for scheduling
- Clear separation from session assignments

**Alternatives Considered**:
- **JSONB column in formateurs**: Less queryable, harder to manage
- **Calendar integration only**: No persistence, lost on refresh
- **Separate table**: Flexible, queryable, supports admin visibility

**Implementation Notes**:
- Table: `formateur_indisponibilites`
- Fields: `id`, `tenant_id`, `formateur_id` (FK to formateurs), `date_debut` (date), `date_fin` (date), `raison` (text), `created_at` (timestamp)
- Validation: `date_fin >= date_debut`
- Indexes on (formateur_id), (tenant_id, formateur_id, date_debut, date_fin) for range queries
- RLS policy for tenant isolation
- Used in calendar view and admin scheduling conflict detection

---

### 7. Session Notes Storage

**Question**: How should trainer session notes be stored?

**Decision**: Add `notes_formateur` and `notes_updated_at` fields to `sessions_professionnelles` table

**Rationale**:
- Simple addition to existing session table
- One note per session per trainer (or shared notes if multiple trainers)
- No need for complex versioning or history for MVP
- Easy to query and display with session details
- Can be extended to separate table if versioning needed later

**Alternatives Considered**:
- **Separate table**: More flexible but adds complexity, not needed for MVP
- **JSONB field**: Less structured, harder to query
- **Add to session table**: Simple, sufficient for requirements, easy to extend

**Implementation Notes**:
- Add `notes_formateur` (TEXT, nullable) to `sessions_professionnelles`
- Add `notes_updated_at` (TIMESTAMP, nullable) to track last update
- Notes are private to trainers (not visible to learners or other trainers unless shared)
- Can be extended to `session_notes` table if multiple trainers need separate notes

---

### 8. Trainer Notification System

**Question**: How should notifications for trainers be stored and delivered?

**Decision**: Create new `notifications_formateurs` table with notification types and read status

**Rationale**:
- Separate table allows flexible notification types and filtering
- Supports read/unread status and notification history
- Can be extended for different notification channels (in-app, email, SMS)
- Consistent with existing notification patterns in the application
- Supports notification preferences in future

**Alternatives Considered**:
- **Reuse existing notifications table**: May have different structure, trainer-specific needs
- **Email/SMS only**: No in-app notification history
- **Separate table**: Flexible, supports in-app notifications, consistent with patterns

**Implementation Notes**:
- Table: `notifications_formateurs`
- Fields: `id`, `tenant_id`, `formateur_id` (FK to formateurs), `type` (enum: nouvelle_inscription, session_modifiee, session_annulee, message_admin, rappel_session), `titre` (text), `message` (text), `metadata` (JSONB), `lue` (boolean, default false), `lue_at` (timestamp, nullable), `created_at` (timestamp)
- Indexes on (formateur_id, lue), (tenant_id, formateur_id)
- RLS policy for tenant isolation
- Trigger notifications on: new enrollment, session changes, admin messages, session reminders

---

### 9. Course Material Association with Sessions

**Question**: How should course materials be associated with sessions and training programs?

**Decision**: Support both direct session association and training program association, with many-to-many relationship for sessions

**Rationale**:
- Materials can be reused across multiple sessions of the same training program
- Some materials are session-specific
- Flexible association supports both use cases
- Can associate material with multiple sessions for reuse
- Training program association allows default materials for all sessions

**Alternatives Considered**:
- **Session-only**: Less flexible, can't reuse materials
- **Training program only**: Can't have session-specific materials
- **Both with many-to-many**: Most flexible, supports all use cases

**Implementation Notes**:
- `supports_cours` table has: `formation_id` (FK, nullable) for training program association
- Create `support_session_associations` junction table for many-to-many session association
- Junction table: `id`, `tenant_id`, `support_id` (FK), `session_id` (FK), `created_at`
- When material is associated with training program, it's available to all sessions of that program
- When material is associated with specific sessions, it's only available to those sessions
- Can have both: material associated with program AND specific sessions (for override)

---

### 10. Trainer Authentication and Authorization

**Question**: How should trainer authentication and session access control be implemented?

**Decision**: Use existing authentication system with trainer role check and session assignment verification

**Rationale**:
- Existing authentication system (NextAuth.js) already supports role-based access
- Can extend to check if user is a trainer (formateur record exists)
- Session access verified by checking `session_formateurs` table
- Consistent with existing admin and user authentication patterns
- No need for separate authentication system

**Alternatives Considered**:
- **Separate trainer authentication**: Adds complexity, not needed
- **Admin-only access**: Too restrictive, trainers need their own space
- **Existing auth with trainer role**: Consistent, sufficient, leverages existing infrastructure

**Implementation Notes**:
- Middleware: `formateurAuthMiddleware` checks:
  1. User is authenticated (existing auth check)
  2. User has formateur record (formateurs.user_id = user.id)
  3. Formateur is active (formateurs.actif = true)
- Session access: Verify `session_formateurs` table has record for (session_id, formateur_id)
- All trainer endpoints require this middleware
- Return 403 if trainer tries to access non-assigned session

---

## Summary

All technical questions have been resolved with decisions that:
- Leverage existing infrastructure and patterns
- Maintain consistency with codebase
- Support scalability and future extensions
- Follow constitution principles (multi-tenant, security-first, API-first)
- Minimize additional dependencies and complexity

