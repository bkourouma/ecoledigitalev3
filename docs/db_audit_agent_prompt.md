You are an autonomous coding agent working on a school & e-learning web app. Your mission is to **audit every page** (for each role: Admin, Teacher), **verify every control that touches the database**, **fix any issues you find**, and **document** the results to a file called `Actual_ReadMe.md` in the repo root.

### Context (fill these placeholders before you start)
- **Repo location**: `<path or git URL>`
- **App base URL (dev)**: `<http://localhost:3000>` (or the correct URL)
- **Tech stack (adjust if different)**: Frontend (React/Next.js + TS), Backend (Node/Express or NestJS + Prisma), DB (PostgreSQL), Auth (JWT or session).
- **Environment variables**: Provide `.env` entries for DB URL, API base URL, and test logins.
- **Test accounts**:
  - **Admin**: `<email>` / `<password>`
  - **Teacher**: `<email>` / `<password>`
- **Sidebar/menu entry points**: The app has a left sidebar navigation; iterate **all** top-level and nested menu links.

### High-level goals
1. **Crawl & verify**: For **each role** (Admin, Teacher) log in, visit **every page reachable from the sidebar/menu**, and enumerate all DB-connected controls: grids/tables, buttons, selects, toggles, forms, imports/exports, etc.
2. **Runtime & static verification**:
   - Runtime: Use browser automation (e.g., Playwright/Puppeteer) or Chrome DevTools to confirm each control loads data and actions succeed (no console errors; **200/2xx** responses; expected DB mutations).
   - Static: Grep/trace code to map each control to **API endpoint(s)** and **tables/columns** (Prisma models, SQL queries, ORM entities).
3. **Fix** any broken flows: mismatch of schema/columns, wrong endpoint, payload shape, missing migrations, validation errors, auth/permission issues, CORS, etc.
4. **Document** each page/control in `Actual_ReadMe.md` using the exact structure below.
5. **Ask me only when blocked** (e.g., missing credentials, truly ambiguous business rules, destructive operation risk). Otherwise, proceed autonomously.

### Output required: `Actual_ReadMe.md`
Create or update `Actual_ReadMe.md` in the repo root. For **each role** and **each visited page URL**, append an entry like this (use real values):

```
Admin Account
PageUrl: /admin/courses
  - Action or Control: "Courses grid – load"
      - What it does: Fetches paginated list of courses
      - Table and colonnes used or affected: courses(id, title, code, teacher_id, created_at)
      - Endpoint: GET /api/courses?skip=0&take=25

  - Action or Control: "Create course – submit button"
      - What it does: Creates a new course
      - Table and colonnes used or affected: courses(title, code, teacher_id)
      - Endpoint: POST /api/courses

PageUrl: /admin/students
  - Action or Control: "Students grid – export CSV"
      - What it does: Exports current filtered list
      - Table and colonnes used or affected: students(id, first_name, last_name, email)
      - Endpoint: GET /api/students/export?format=csv
```

Repeat the same structure under **Teacher Account** for all teacher-visible pages.

### Methodology & rules
- **Navigation coverage**
  - Log in as the specified role.
  - Programmatically enumerate all visible sidebar/menu links (including nested items) and visit them.
  - Detect lazy-loaded content or tabbed panels; visit each tab/step within a page.
- **Detect DB-connected controls**
  - At runtime: observe network calls and UI state changes on interaction; record endpoints and payloads.
  - In code: search for associated hooks/clients (`fetch`, `axios`, `trpc`, `react-query`), service functions, Prisma queries, repository calls.
  - Map endpoints to ORM/SQL to derive **tables and columns** used or mutated.
- **Verification checklist (each control)**
  - Data loads without 4xx/5xx; empty states handled.
  - Sorting/paging/filtering work as expected (verify params and server behavior).
  - Create/Update/Delete perform correct mutations; optimistic updates reconciled; errors surfaced to users.
  - Correct payload shapes (types, enums, dates, IDs).
  - Auth/role guards applied correctly (403 where appropriate).
  - **Schema/API/UI alignment**: field names/types consistent across DB schema, API DTOs, and frontend forms.
- **If broken → fix it**
  - For **schema mismatches**: adjust Prisma schema/ORM entities; add migrations; update API DTOs/validators; sync frontend field names.
  - For **endpoint issues**: correct routes, controllers/handlers, query builders; add missing indexes; paginate safely.
  - For **frontend issues**: fix component props, form bindings, react-query keys, stale cache invalidation, zod/yup schema.
  - For **auth/permissions**: ensure role checks on server; sanitize inputs; protect sensitive endpoints.
  - For **CORS/CSRF**: configure server middleware appropriately in dev.
- **Migrations & safety**
  - Create new git branch: `fix/audit-sync-<date>`.
  - Generate DB migrations (Prisma: `prisma migrate dev` or SQL scripts). Never drop columns with data; use additive changes and backfills.
  - Include data backfill scripts when needed.
- **Testing**
  - Add/extend integration tests for endpoints touched.
  - Add basic Playwright tests for critical flows (load grid, create, edit, delete).
- **Documentation discipline**
  - After each page is fully verified and fixed, **append** a section to `Actual_ReadMe.md` in the exact format.
  - Commit after each page completion with message: `docs(readme): audit <role> <PageUrl> + fixes`.
- **Only interrupt me when**:
  - Credentials or base URLs are missing/invalid.
  - A destructive migration is unavoidable without business confirmation.
  - Ambiguous domain rules (e.g., required fields not defined anywhere).

### Tools you may use inside Cursor
- Terminal for running app, tests, and migrations.
- File search to trace code paths.
- (Optional) Playwright or Puppeteer for scripted page traversal and interaction.
- (Optional) Chrome DevTools MCP for network/console tracing while navigating pages.
- Git for branching and incremental commits.

### Acceptance criteria
- All sidebar pages for **Admin** and **Teacher** have been visited, verified, and fixed if needed.
- `Actual_ReadMe.md` contains a **complete, role-segmented inventory** with **every DB-connected control** documented (what it does, precise tables/columns, and exact endpoints).
- CI/test suite passes locally.
- No 4xx/5xx or console errors during the audited flows.

**Begin now. If a required secret or URL is missing, pause and ask me for that only; otherwise proceed autonomously.**