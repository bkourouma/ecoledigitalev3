# Tasks: Catalogue de Formations Professionnelles - Module Imhotep Data

**Input**: Design documents from `/specs/016-catalogue-formations-pro/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are OPTIONAL - not explicitly requested in the feature specification, so test tasks are not included. Focus on implementation tasks.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions
- **Backend**: `apps/api/src/`
- **Frontend**: `apps/web/src/`
- **Contracts**: `packages/contracts/src/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Create API contracts file `packages/contracts/src/formations-pro.ts` with Zod schemas from contracts/formations-pro.ts
- [x] T002 [P] Export formations-pro schemas from `packages/contracts/src/index.ts`
- [x] T003 [P] Install Puppeteer dependency: `pnpm add puppeteer@^21.0.0` in `apps/api/`
- [x] T004 [P] Create directory structure: `apps/web/src/components/formations-pro/`
- [x] T005 [P] Create directory structure: `apps/web/src/app/formations-professionnelles/catalogue/`
- [x] T006 [P] Create directory structure: `apps/web/src/lib/hooks/` (if not exists)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T007 Create database migration for full-text search index: `infra/scripts/migrations/0038_add_formations_pro_fts_index.sql` with GIN index on `formations_professionnelles` for full-text search (see research.md for SQL pattern)
- [X] T008 Create base service file `apps/api/src/services/formation-pro.service.ts` with class structure and tenant context setup
- [X] T009 Create base PDF service file `apps/api/src/services/pdf-generation.service.ts` with Puppeteer initialization
- [X] T010 Create API route file `apps/api/src/routes/formations-pro.ts` with Fastify route structure and tenant context plugin registration
- [X] T011 Register formations-pro routes in `apps/api/src/index.ts` with prefix `/api/v1/formations-pro`
- [X] T012 Create TanStack Query hooks file `apps/web/src/lib/hooks/use-formations-pro.ts` with base hook structure

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Browse and Search Training Catalog (Priority: P1) 🎯 MVP

**Goal**: Enable users to browse the training catalog and search for training programs by keywords

**Independent Test**: Display a list of active professional training programs, allow users to search by keywords, and verify that search results match the query terms in training titles and descriptions.

### Implementation for User Story 1

- [X] T013 [US1] Implement `searchFormations` method in `apps/api/src/services/formation-pro.service.ts` with PostgreSQL full-text search query (see data-model.md for query pattern)
- [X] T014 [US1] Implement `GET /api/v1/formations-pro` endpoint in `apps/api/src/routes/formations-pro.ts` with search parameter handling, pagination, and response formatting
- [X] T015 [US1] Add Fastify schema validation for list endpoint using `FormationListQuerySchema` from contracts
- [X] T016 [US1] Create `useFormations` hook in `apps/web/src/lib/hooks/use-formations-pro.ts` for fetching training list with TanStack Query
- [X] T017 [US1] Create `SearchBar` component in `apps/web/src/components/formations-pro/SearchBar.tsx` with debounced search input (300ms delay)
- [X] T018 [US1] Create `FormationCard` component in `apps/web/src/components/formations-pro/FormationCard.tsx` to display training information (title, description, duration, price, level badge)
- [X] T019 [US1] Create `CatalogueFormationsPro` component in `apps/web/src/components/formations-pro/CatalogueFormationsPro.tsx` as main catalog component with search bar and results grid
- [X] T020 [US1] Create catalog page `apps/web/src/app/formations-professionnelles/catalogue/page.tsx` that uses `CatalogueFormationsPro` component
- [X] T021 [US1] Add loading states and skeleton loaders in catalog components
- [X] T022 [US1] Add empty state message component when no trainings match search criteria
- [X] T023 [US1] Implement URL parameter synchronization for search query (use Next.js `useSearchParams`)

**Checkpoint**: At this point, User Story 1 should be fully functional - users can browse catalog and search for trainings

---

## Phase 4: User Story 2 - Filter Training Programs by Criteria (Priority: P1)

**Goal**: Enable users to filter the training catalog by theme, duration, price range, skill level, delivery mode, and certification availability

**Independent Test**: Apply various filter combinations (theme, price, duration, level), verify that only trainings matching all selected criteria are displayed, and confirm that filter state persists during navigation.

### Implementation for User Story 2

- [X] T024 [US2] Implement `getThemes` method in `apps/api/src/services/formation-pro.service.ts` to return all available themes with counts
- [X] T025 [US2] Implement `getStats` method in `apps/api/src/services/formation-pro.service.ts` to return price and duration ranges for filter initialization
- [X] T026 [US2] Implement `GET /api/v1/formations-pro/themes` endpoint in `apps/api/src/routes/formations-pro.ts`
- [X] T027 [US2] Implement `GET /api/v1/formations-pro/stats` endpoint in `apps/api/src/routes/formations-pro.ts`
- [X] T028 [US2] Update `searchFormations` method in `apps/api/src/services/formation-pro.service.ts` to handle filter parameters (themes, duree_min/max, prix_min/max, niveau, mode, certification)
- [X] T029 [US2] Update `GET /api/v1/formations-pro` endpoint to accept and validate all filter query parameters
- [X] T030 [US2] Create `useThemes` hook in `apps/web/src/lib/hooks/use-formations-pro.ts` for fetching available themes
- [X] T031 [US2] Create `useFormationStats` hook in `apps/web/src/lib/hooks/use-formations-pro.ts` for fetching filter statistics
- [X] T032 [US2] Create `FiltersSidebar` component in `apps/web/src/components/formations-pro/FiltersSidebar.tsx` with filter controls (themes checkboxes, duration range, price range, level radio, mode checkboxes, certification toggle)
- [X] T033 [US2] Update `CatalogueFormationsPro` component to include `FiltersSidebar` and apply filters to API calls
- [X] T034 [US2] Add "Reset filters" button functionality in `FiltersSidebar`
- [X] T035 [US2] Add active filter count indicator in `FiltersSidebar`
- [X] T036 [US2] Update URL parameter synchronization to include all filter parameters
- [X] T037 [US2] Add session storage fallback for complex filter states (see research.md)

**Checkpoint**: At this point, User Stories 1 AND 2 should both work - users can search and filter trainings

---

## Phase 5: User Story 3 - View Detailed Training Information (Priority: P1)

**Goal**: Enable users to view comprehensive information about a specific training program including objectives, program content, prerequisites, target audience, certification details, and upcoming session dates

**Independent Test**: Navigate to a training detail page, verify all training information sections are displayed correctly, and confirm that upcoming sessions are shown with dates and availability.

### Implementation for User Story 3

- [X] T038 [US3] Implement `getFormationBySlug` method in `apps/api/src/services/formation-pro.service.ts` to fetch training by slug with all details
- [X] T039 [US3] Implement `getFormationSessions` method in `apps/api/src/services/formation-pro.service.ts` to fetch upcoming sessions for a training (filter by date_debut >= CURRENT_DATE and statut IN ('planifiee', 'ouverte'))
- [X] T040 [US3] Implement `GET /api/v1/formations-pro/:slug` endpoint in `apps/api/src/routes/formations-pro.ts` with slug parameter validation
- [X] T041 [US3] Implement `GET /api/v1/formations-pro/:id/sessions` endpoint in `apps/api/src/routes/formations-pro.ts` (optional, for separate sessions endpoint)
- [X] T042 [US3] Add Fastify schema validation for detail endpoint using `FormationDetailResponseSchema` from contracts
- [X] T043 [US3] Create `useFormationDetail` hook in `apps/web/src/lib/hooks/use-formations-pro.ts` for fetching training detail by slug
- [X] T044 [US3] Create `SessionCardMini` component in `apps/web/src/components/formations-pro/SessionCardMini.tsx` to display session information (date, mode, places available)
- [X] T045 [US3] Create `FormationDetail` component in `apps/web/src/components/formations-pro/FormationDetail.tsx` with sections: description, objectives, programme détaillé, prérequis, public cible, certification, sessions list
- [X] T046 [US3] Create detail page `apps/web/src/app/formations-professionnelles/catalogue/[slug]/page.tsx` that uses `FormationDetail` component
- [X] T047 [US3] Add breadcrumb navigation in detail page (Accueil > Catalogue > [Titre])
- [X] T048 [US3] Add loading state and error handling for detail page
- [X] T049 [US3] Add message display when training has no upcoming sessions
- [X] T050 [US3] Update `FormationCard` component to link to detail page using slug

**Checkpoint**: At this point, User Stories 1, 2, AND 3 should all work - users can browse, search, filter, and view training details

---

## Phase 6: User Story 4 - Download Training Program PDF (Priority: P2)

**Goal**: Enable users to download a professional PDF document containing complete training program information

**Independent Test**: Click the download PDF button on a training detail page, verify that a PDF file is generated and downloaded containing all key training information in a professional format.

### Implementation for User Story 4

- [X] T051 [US4] Implement `generateProgrammePDF` method in `apps/api/src/services/pdf-generation.service.ts` using Puppeteer to generate PDF from HTML template
- [X] T052 [US4] Create PDF HTML template in `apps/api/src/services/pdf-generation.service.ts` with Imhotep Data logo, training title, description, objectives, programme détaillé, prérequis, pricing, and contact information
- [X] T053 [US4] Implement `GET /api/v1/formations-pro/:id/programme-pdf` endpoint in `apps/api/src/routes/formations-pro.ts` with PDF response headers (Content-Type: application/pdf, Content-Disposition: attachment)
- [X] T054 [US4] Add error handling for PDF generation failures (timeout, Puppeteer errors) with user-friendly error messages
- [X] T055 [US4] Add rate limiting consideration for PDF endpoint (document in code comments, implement if needed)
- [X] T056 [US4] Create `downloadPDF` function in `apps/web/src/lib/hooks/use-formations-pro.ts` or utility file for handling PDF download
- [X] T057 [US4] Add "Download PDF" button in `FormationDetail` component
- [X] T058 [US4] Add loading indicator during PDF generation
- [X] T059 [US4] Add success notification after PDF download completes
- [X] T060 [US4] Add error toast notification if PDF download fails

**Checkpoint**: At this point, User Stories 1-4 should all work - users can browse, search, filter, view details, and download PDFs

---

## Phase 7: User Story 5 - View Similar Training Recommendations (Priority: P2)

**Goal**: Display recommendations for similar trainings based on shared themes and characteristics

**Independent Test**: View a training detail page, verify that a "Similar Trainings" section appears with related programs, and confirm that recommendations are based on shared themes and similar characteristics.

### Implementation for User Story 5

- [X] T061 [US5] Implement `getSimilarFormations` method in `apps/api/src/services/formation-pro.service.ts` with similarity scoring algorithm (see research.md and data-model.md for SQL pattern)
- [X] T062 [US5] Implement `GET /api/v1/formations-pro/:id/similaires` endpoint in `apps/api/src/routes/formations-pro.ts` with ID parameter validation
- [X] T063 [US5] Add Fastify schema validation for similar formations endpoint using `SimilarFormationsResponseSchema` from contracts
- [X] T064 [US5] Create `useSimilarFormations` hook in `apps/web/src/lib/hooks/use-formations-pro.ts` for fetching similar trainings
- [X] T065 [US5] Create `SimilarFormations` component in `apps/web/src/components/formations-pro/SimilarFormations.tsx` to display recommended trainings using `FormationCard` components
- [X] T066 [US5] Add `SimilarFormations` section to `FormationDetail` component at the bottom of the page
- [X] T067 [US5] Add loading state for similar formations section
- [X] T068 [US5] Handle case when no similar formations are found (hide section or show message)

**Checkpoint**: At this point, User Stories 1-5 should all work - users can browse, search, filter, view details, download PDFs, and see recommendations

---

## Phase 8: User Story 6 - Sort Training Results (Priority: P2)

**Goal**: Enable users to sort training catalog results by price, title, or next available session date

**Independent Test**: Apply different sort options (price ascending/descending, title A-Z, next session date), verify that results are reordered according to the selected criteria.

### Implementation for User Story 6

- [X] T069 [US6] Update `searchFormations` method in `apps/api/src/services/formation-pro.service.ts` to handle sort parameter (pertinence, prix_asc, prix_desc, titre_asc, date_asc)
- [X] T070 [US6] Update `GET /api/v1/formations-pro` endpoint to accept and validate sort query parameter
- [X] T071 [US6] Create `SortDropdown` component in `apps/web/src/components/formations-pro/SortDropdown.tsx` with sort options (Pertinence, Prix croissant, Prix décroissant, Titre A-Z, Prochaine session)
- [X] T072 [US6] Update `CatalogueFormationsPro` component to include `SortDropdown` and apply sort to API calls
- [X] T073 [US6] Update URL parameter synchronization to include sort parameter
- [X] T074 [US6] Ensure "pertinence" sort is used when search is active, otherwise default to "date_asc"

**Checkpoint**: At this point, all User Stories 1-6 should be complete and functional

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T075 [P] Add responsive design breakpoints for mobile (320px+), tablet (768px+), and desktop (1024px+) across all components
- [X] T076 [P] Add error boundary component for catalog pages to handle React errors gracefully
- [X] T077 [P] Add pagination component `apps/web/src/components/formations-pro/Pagination.tsx` with page numbers, previous/next buttons, and result count display
- [X] T078 [P] Integrate pagination component into `CatalogueFormationsPro` component
- [X] T079 [P] Add accessibility improvements (ARIA labels, keyboard navigation, focus management) across all components
- [ ] T080 [P] Add analytics tracking for search queries, filter usage, and PDF downloads (if analytics system exists) - **OPTIONAL: Requires analytics system**
- [ ] T081 [P] Optimize images and add lazy loading for training card images - **OPTIONAL: No images in current implementation**
- [X] T082 [P] Add caching strategy for API responses using TanStack Query staleTime configuration (5 minutes for catalog listings)
- [ ] T083 [P] Add performance monitoring and logging for slow queries (search, filters, PDF generation) - **OPTIONAL: Requires monitoring system**
- [ ] T084 [P] Update documentation in README or feature docs with catalog usage instructions - **TODO: Add documentation**
- [ ] T085 [P] Run quickstart.md validation to ensure all API endpoints work as documented - **TODO: Manual validation**
- [X] T086 [P] Code cleanup and refactoring - ensure consistent error handling patterns across all endpoints
- [X] T087 [P] Add comprehensive error messages for all error scenarios (404, 500, validation errors, PDF generation failures)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-8)**: All depend on Foundational phase completion
  - User stories can then proceed sequentially in priority order (P1 → P2)
  - US1, US2, US3 (all P1) can potentially be worked on in parallel after foundational
  - US4, US5, US6 (all P2) can be worked on in parallel after P1 stories complete
- **Polish (Phase 9)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P1)**: Can start after Foundational (Phase 2) - Integrates with US1 (shares same endpoint, adds filters)
- **User Story 3 (P1)**: Can start after Foundational (Phase 2) - Uses US1's `FormationCard` component for navigation
- **User Story 4 (P2)**: Depends on US3 (detail page) - Adds PDF download to detail page
- **User Story 5 (P2)**: Depends on US3 (detail page) - Adds recommendations section to detail page
- **User Story 6 (P2)**: Can start after Foundational (Phase 2) - Integrates with US1/US2 (adds sorting to list endpoint)

### Within Each User Story

- Services before endpoints
- Endpoints before frontend hooks
- Hooks before components
- Components before pages
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- **Phase 1**: T002, T003, T004, T005, T006 can run in parallel
- **Phase 2**: T007, T008, T009, T010, T012 can run in parallel (T011 depends on T010)
- **Phase 3 (US1)**: T016, T017, T018 can run in parallel (different components)
- **Phase 4 (US2)**: T024, T025, T030, T031 can run in parallel (different methods/hooks)
- **Phase 5 (US3)**: T038, T039, T044 can run in parallel (different methods/components)
- **Phase 6 (US4)**: T051, T052 can run in parallel (service method and template)
- **Phase 7 (US5)**: T061, T064, T065 can run in parallel (service, hook, component)
- **Phase 8 (US6)**: T069, T071 can run in parallel (service update and component)
- **Phase 9**: All tasks marked [P] can run in parallel

---

## Parallel Example: User Story 1

```bash
# Launch all components for User Story 1 together:
Task: "Create SearchBar component in apps/web/src/components/formations-pro/SearchBar.tsx"
Task: "Create FormationCard component in apps/web/src/components/formations-pro/FormationCard.tsx"
Task: "Create CatalogueFormationsPro component in apps/web/src/components/formations-pro/CatalogueFormationsPro.tsx"
```

---

## Parallel Example: User Story 2

```bash
# Launch all API methods for User Story 2 together:
Task: "Implement getThemes method in apps/api/src/services/formation-pro.service.ts"
Task: "Implement getStats method in apps/api/src/services/formation-pro.service.ts"
Task: "Create useThemes hook in apps/web/src/lib/hooks/use-formations-pro.ts"
Task: "Create useFormationStats hook in apps/web/src/lib/hooks/use-formations-pro.ts"
```

---

## Implementation Strategy

### MVP First (User Stories 1-3 Only - All P1)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (Browse and Search)
4. Complete Phase 4: User Story 2 (Filters)
5. Complete Phase 5: User Story 3 (Detail Page)
6. **STOP and VALIDATE**: Test all three P1 stories independently
7. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (Basic catalog!)
3. Add User Story 2 → Test independently → Deploy/Demo (With filters!)
4. Add User Story 3 → Test independently → Deploy/Demo (Complete browsing!)
5. Add User Story 4 → Test independently → Deploy/Demo (PDF downloads!)
6. Add User Story 5 → Test independently → Deploy/Demo (Recommendations!)
7. Add User Story 6 → Test independently → Deploy/Demo (Sorting!)
8. Add Polish → Final polish and optimization

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (Browse and Search)
   - Developer B: User Story 2 (Filters) - can start after US1 endpoint exists
   - Developer C: User Story 3 (Detail Page) - can start after US1 components exist
3. After P1 stories complete:
   - Developer A: User Story 4 (PDF)
   - Developer B: User Story 5 (Recommendations)
   - Developer C: User Story 6 (Sorting)
4. All developers: Polish phase tasks

---

## Task Summary

**Total Tasks**: 87 tasks

**Tasks by Phase**:
- Phase 1 (Setup): 6 tasks
- Phase 2 (Foundational): 6 tasks
- Phase 3 (US1 - Browse/Search): 11 tasks
- Phase 4 (US2 - Filters): 14 tasks
- Phase 5 (US3 - Detail): 13 tasks
- Phase 6 (US4 - PDF): 10 tasks
- Phase 7 (US5 - Recommendations): 8 tasks
- Phase 8 (US6 - Sort): 6 tasks
- Phase 9 (Polish): 13 tasks

**Tasks by User Story**:
- User Story 1 (P1): 11 tasks
- User Story 2 (P1): 14 tasks
- User Story 3 (P1): 13 tasks
- User Story 4 (P2): 10 tasks
- User Story 5 (P2): 8 tasks
- User Story 6 (P2): 6 tasks

**Parallel Opportunities**: Many tasks marked [P] can be executed in parallel within each phase

**Suggested MVP Scope**: User Stories 1-3 (all P1) = 38 tasks + Setup + Foundational = 50 tasks total for MVP

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Database schema already exists from Phase 1 (Feature 015) - no schema creation needed
- All endpoints are public (no authentication required) per research.md
- PDF generation uses Puppeteer (server-side) per research.md
- Full-text search uses PostgreSQL FTS with GIN index per research.md

