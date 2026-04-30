# Research: Session Management & Calendar - Imhotep Data

**Date**: 2025-01-27  
**Feature**: 017-session-calendar  
**Phase**: 0 - Technical Research

## Research Questions

### 1. Calendar Library Selection

**Question**: Which calendar library should be used for the interactive calendar view?

**Decision**: Use **FullCalendar** (React integration: `@fullcalendar/react`)

**Rationale**:
- Industry standard for calendar UIs with extensive documentation
- Supports multiple view types (month, week, day, list) out of the box
- Built-in event rendering, drag-and-drop (for admin), and date navigation
- Active maintenance and large community
- Works well with React and TypeScript
- Supports localization (French locale available)
- Lightweight compared to building custom calendar from scratch

**Alternatives Considered**:
- **React Big Calendar**: Simpler but less feature-rich, limited customization
- **React Calendar**: Too basic, would require significant custom development
- **Custom Calendar**: Too time-consuming, reinventing the wheel
- **FullCalendar**: Best balance of features, maintainability, and ease of integration

**Implementation Notes**:
- Install: `@fullcalendar/react @fullcalendar/daygrid @fullcalendar/timegrid @fullcalendar/interaction @fullcalendar/core`
- Use French locale: `@fullcalendar/core/locales/fr`
- Custom event rendering for session cards with availability badges
- Disable drag-and-drop for public calendar, enable for admin

---

### 2. Real-Time Availability Updates

**Question**: How should session availability be updated in real-time on the frontend?

**Decision**: Use **Polling with TanStack Query** with 30-second interval

**Rationale**:
- Simpler than WebSocket setup (no additional infrastructure)
- TanStack Query already in use, provides built-in polling support
- 30-second interval balances freshness with server load
- Can be optimized later with WebSocket if needed
- Works well for read-only availability updates
- Automatic retry and error handling via TanStack Query

**Alternatives Considered**:
- **WebSocket**: More complex setup, requires additional server infrastructure, overkill for availability-only updates
- **Server-Sent Events (SSE)**: Simpler than WebSocket but still requires additional setup, polling is sufficient
- **Polling**: Simple, works with existing infrastructure, sufficient for this use case

**Implementation Notes**:
- Use TanStack Query's `refetchInterval: 30000` option
- Only poll when session detail page is visible (use `useIsVisible` or similar)
- Debounce rapid enrollment changes to avoid excessive polling
- Consider WebSocket upgrade if concurrent user count grows significantly

---

### 3. Trainer Availability Conflict Detection

**Question**: How should trainer availability be checked for scheduling conflicts?

**Decision**: **Database query with date range overlap detection** in backend service

**Rationale**:
- Date range overlap logic: `(new_start <= existing_end) AND (new_end >= existing_start)`
- Efficient with proper database indexes on `date_debut` and `date_fin`
- Can be done in a single query per trainer
- Validates against existing sessions excluding cancelled/completed ones
- Returns detailed conflict information for admin feedback

**Alternatives Considered**:
- **In-memory calculation**: Not scalable, requires loading all sessions
- **External calendar API**: Overkill, adds dependency, database is source of truth
- **Database query**: Efficient, accurate, single source of truth

**Implementation Notes**:
- Query `sessions_professionnelles` joined with `session_formateurs` for trainer assignments
- Filter by `statut NOT IN ('annulee', 'terminee')` to exclude inactive sessions
- Exclude current session when updating (use `id != excludeSessionId`)
- Return conflict details: session code, formation title, dates for admin display

---

### 4. Session Code Generation Format

**Question**: What format should be used for automatically generated session codes?

**Decision**: **Format: `{PREFIX}-{YEAR}-{NUMBER}`** (e.g., `DATA-2024-001`)

**Rationale**:
- PREFIX: First 4 uppercase letters of training program slug
- YEAR: Current year (4 digits)
- NUMBER: Sequential 3-digit number (001, 002, etc.) per training per year
- Human-readable and sortable
- Unique per tenant (enforced by database UNIQUE constraint)
- Provides context (training type, year, sequence)

**Alternatives Considered**:
- **UUID**: Not human-readable, poor UX for admins
- **Timestamp-based**: Harder to read, less organized
- **Simple increment**: No context about training or year
- **Format chosen**: Best balance of readability, uniqueness, and information density

**Implementation Notes**:
- Extract prefix from `formations_professionnelles.slug` (first 4 alphanumeric chars, uppercase)
- Count existing sessions for same `formation_id` in current year
- Increment and pad to 3 digits
- Handle edge case: if code exists (unlikely), append timestamp suffix
- Store in `code_session` field with UNIQUE constraint per tenant

---

### 5. Capacity Update Strategy

**Question**: How should session capacity (places_reservees, places_disponibles) be updated?

**Decision**: **Automatic recalculation via database trigger or service method** called after enrollment changes

**Rationale**:
- Database-generated column `places_disponibles` already exists (GENERATED ALWAYS AS)
- `places_reservees` should be updated via service method after enrollment create/update/delete
- Ensures consistency and prevents manual calculation errors
- Can be triggered automatically via database hooks or application-level service calls

**Alternatives Considered**:
- **Manual calculation**: Error-prone, requires careful synchronization
- **Database trigger only**: Less flexible, harder to debug
- **Service method**: More control, easier to test, can include business logic (status changes)
- **Hybrid (chosen)**: Database-generated column for `places_disponibles`, service method for `places_reservees` and status updates

**Implementation Notes**:
- `places_disponibles` is already a generated column (from Phase 1 migration)
- Create service method `updateSessionCapacity(sessionId)` that:
  - Counts confirmed/pending enrollments
  - Updates `places_reservees`
  - Updates `statut` to 'complete' if `places_disponibles = 0`
  - Updates `statut` to 'ouverte' if capacity becomes available
- Call this method after enrollment create/update/delete operations
- Consider database trigger as alternative if performance becomes an issue

---

### 6. Export File Format

**Question**: What format should be used for exporting session and enrollment data?

**Decision**: **Excel format (XLSX)** using `exceljs` library

**Rationale**:
- Standard format for business data (sessions, enrollments)
- Easy to open in Excel, Google Sheets, or other spreadsheet tools
- Supports formatting, multiple sheets, and large datasets
- `exceljs` is well-maintained and works well with Node.js
- Can include multiple sheets (sessions, enrollments) in single file

**Alternatives Considered**:
- **CSV**: Simpler but less formatting options, no multiple sheets
- **PDF**: Harder to manipulate data, better for reports than exports
- **JSON**: Too technical for business users
- **Excel (XLSX)**: Best balance of usability and functionality

**Implementation Notes**:
- Use `exceljs` package for Excel generation
- Include headers with formatting (bold, colored background)
- Support multiple sheets for enrollment exports (one sheet per session or combined)
- Auto-size columns for readability
- Include filters on header row for easy data manipulation

---

### 7. Notification Delivery Mechanism

**Question**: How should participants be notified of session changes (dates, location, cancellation)?

**Decision**: **Email notifications via existing email service** (assumed to exist from dependencies)

**Rationale**:
- Email is standard for business communications
- Non-blocking (async delivery)
- Can include rich content (HTML templates)
- Works for all participants regardless of platform
- Existing email infrastructure should be available (from spec dependencies)

**Alternatives Considered**:
- **In-app notifications**: Requires users to be logged in, less reliable
- **SMS**: More expensive, requires phone numbers, email is sufficient
- **Push notifications**: Requires mobile app or browser permissions
- **Email**: Standard, reliable, cost-effective

**Implementation Notes**:
- Use existing email service (to be confirmed in implementation)
- Create email templates for:
  - Session modified (dates, location, video link changes)
  - Session cancelled
  - Session reminder (future enhancement)
- Include session details, changes summary, contact information
- Send asynchronously to avoid blocking session update operations
- Log notification delivery for audit purposes

---

## Technology Stack Confirmation

Based on existing codebase and constitution:

- **Backend**: Fastify (already in use)
- **Frontend**: Next.js 15, React, TanStack Query (already in use)
- **Database**: PostgreSQL 14+ with RLS (already in use)
- **Validation**: Zod (already in use, required by constitution)
- **Calendar**: FullCalendar React integration (new dependency)
- **Export**: exceljs (new dependency)
- **Email**: Existing email service (assumed available)

## Performance Considerations

1. **Calendar Loading**: 
   - Load sessions for visible date range only (month/week)
   - Use pagination for list view
   - Cache calendar data with TanStack Query

2. **Trainer Availability Checks**:
   - Batch check multiple trainers in single query
   - Cache trainer schedules (with invalidation on session changes)
   - Use database indexes on date fields

3. **Real-Time Updates**:
   - Poll only when page is visible
   - Debounce rapid changes
   - Consider WebSocket upgrade if user count grows

4. **Export Performance**:
   - Stream large exports to avoid memory issues
   - Use database cursors for large datasets
   - Consider background job for very large exports

## Security Considerations

1. **Public Calendar**: Read-only, no authentication required
2. **Session Details**: Public read access, enrollment requires authentication (Phase 4)
3. **Admin Endpoints**: Require authentication + admin role verification
4. **Trainer Information**: Public sessions show trainer names/bios, admin sees full details
5. **Enrollment Data**: Admin-only access, protected by RBAC
6. **Tenant Isolation**: All queries must include tenant_id filtering via RLS

## Dependencies to Add

```json
{
  "dependencies": {
    "@fullcalendar/react": "^6.1.10",
    "@fullcalendar/daygrid": "^6.1.10",
    "@fullcalendar/timegrid": "^6.1.10",
    "@fullcalendar/interaction": "^6.1.10",
    "@fullcalendar/core": "^6.1.10",
    "exceljs": "^4.4.0"
  }
}
```

## Open Questions Resolved

✅ Calendar library: FullCalendar  
✅ Real-time updates: Polling with TanStack Query  
✅ Trainer conflicts: Database query with overlap detection  
✅ Session codes: PREFIX-YEAR-NUMBER format  
✅ Capacity updates: Service method + database generated column  
✅ Export format: Excel (XLSX)  
✅ Notifications: Email via existing service  

**Status**: All research questions resolved. Ready for Phase 1 design.

