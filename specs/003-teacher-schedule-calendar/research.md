# Research: Teacher Schedule Calendar Upgrade

## Decisions

- Decision: Single-instance editing only for recurring sessions (no series operations)
  - Rationale: Matches owner choice (Q1 A); reduces complexity and scope
  - Alternatives considered: Edit this+future, edit entire series (higher complexity, series modeling required)

- Decision: Lock past sessions after 24h (no edits/deletes)
  - Rationale: Matches owner choice (Q2 A); preserves audit integrity and avoids retroactive changes
  - Alternatives considered: 7-day window; unlimited edits with audit trail (greater complexity/compliance impact)

- Decision: Ignore room/resource conflicts initially
  - Rationale: Matches owner choice (Q3 A); accelerates delivery; can add later as enhancement
  - Alternatives considered: Warn-only; hard-block (require additional data models and UI)

## Best Practices and Patterns

- Calendar UX: 15-min grid, keyboard navigation, clear visual feedback on drag/resize, optimistic UI with server validation fallback.
- Conflict Handling: Perform pre-check in UI when possible; authoritative validation server-side with precise messages.
- Cascading selects: Fetch teacher-assigned classes first; upon class select, fetch courses for class; disable course until class picked.
- Accessibility: Ensure focus management for dialogs; ARIA labels for events; keyboard resize/move alternatives.
- Testing: Contract tests for overlaps; E2E for drag/drop, resize, add with cascade, edit/delete.

## Integrations

- Frontend: Next 15, React 18; use existing component libs (AntD/Radix) where suitable.
- Backend: Fastify + PostgreSQL via `pg`; validation via zod; reuse auth middleware.

## Open Questions (Resolved)

- Recurring edit scope → Resolved: single-instance only.
- Past edit window → Resolved: 24h lock.
- Room/resource collisions → Resolved: ignored for now.
