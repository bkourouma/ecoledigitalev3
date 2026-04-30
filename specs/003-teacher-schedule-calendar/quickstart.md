# Quickstart: Teacher Schedule Calendar Upgrade

## Prerequisites
- pnpm installed
- PostgreSQL running with project DB
- Repo setup: `pnpm install`

## Run Dev
- API: `pnpm dev:api`
- Web: `pnpm dev:web` then open `/teacher/schedule`

## Implementation Steps
- Update calendar UI to support drag, drop, resize with 15-min grid
- Add Add-Session dialog with class (assigned) → course (filtered) cascade
- Wire to API contracts in `contracts/openapi.yaml`
- Implement conflict checks on API for teacher and class overlaps
- Add edit/delete actions with confirmation and server validation

## Testing
- Contract tests for create/update/delete and conflict cases
- Playwright E2E for drag, resize, add cascade, edit/delete

## Accessibility
- Keyboard navigation for calendar and dialogs
- Announce errors/success via screen-reader friendly alerts
