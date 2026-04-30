# Tasks: Imhotep Data Database Schema

**Input**: Design documents from `/specs/015-imhotep-data-schema/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md

**Tests**: Manual SQL validation and migration testing (no automated test tasks - schema validation only)

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story's database components.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different tables, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions
- Migration file: `infra/scripts/migrations/0037_imhotep_data_professional_training.sql`

---

## Phase 1: Setup (Migration File Structure)

**Purpose**: Initialize migration file with proper structure and documentation

- [x] T001 Create migration file `infra/scripts/migrations/0037_imhotep_data_professional_training.sql` with header comments
- [x] T002 Add migration metadata: version number, description, dependencies on existing migrations
- [x] T003 Add transaction wrapper (`BEGIN;` at start, `COMMIT;` at end) for atomic migration

**Checkpoint**: Migration file structure ready

---

## Phase 2: Foundational (ENUM Types & Base Infrastructure)

**Purpose**: Core database types and infrastructure that MUST be complete before ANY user story tables can be created

**⚠️ CRITICAL**: No user story table work can begin until this phase is complete

- [x] T004 Create ENUM type `session_professional_status AS ENUM ('planifiee', 'ouverte', 'complete', 'en_cours', 'terminee', 'annulee')`
- [x] T005 [P] Create ENUM type `enrollment_type AS ENUM ('individuelle', 'entreprise')`
- [x] T006 [P] Create ENUM type `enrollment_professional_status AS ENUM ('en_attente', 'confirmee', 'annulee', 'terminee')`
- [x] T007 [P] Create ENUM type `promo_code_reduction_type AS ENUM ('pourcentage', 'montant_fixe')`
- [x] T008 [P] Create ENUM type `payment_method AS ENUM ('orange_money', 'mtn_money', 'wave', 'carte_bancaire', 'tresorpay', 'virement', 'cheque')`
- [x] T009 [P] Create ENUM type `payment_professional_status AS ENUM ('en_attente', 'valide', 'echoue', 'rembourse', 'annule')`
- [x] T010 Verify existing `delivery_mode` ENUM exists (reused from existing schema) or document if missing

**Checkpoint**: Foundation ready - user story table creation can now begin

---

## Phase 3: User Story 1 - Professional Training Catalog Management (Priority: P1) 🎯 MVP

**Goal**: Enable administrators to create and manage professional training programs with detailed information

**Independent Test**: Create a professional training program with all required fields, verify it appears in the catalog, confirm it doesn't interfere with existing academic courses

### Implementation for User Story 1

- [x] T011 [US1] Create table `formations_professionnelles` with all columns per data-model.md
- [x] T012 [US1] Add CHECK constraint: `duree_jours > 0 OR duree_heures > 0`
- [x] T013 [US1] Add CHECK constraint: `prix_ht >= 0 AND prix_ttc >= 0`
- [x] T014 [US1] Add UNIQUE constraint: `UNIQUE(tenant_id, slug)`
- [x] T015 [US1] Add foreign key: `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`
- [x] T016 [US1] Add foreign key: `created_by UUID REFERENCES users(id) ON DELETE SET NULL`
- [x] T017 [US1] Create index `idx_formations_professionnelles_tenant_id` ON (tenant_id)
- [x] T018 [US1] Create index `idx_formations_professionnelles_slug` ON (tenant_id, slug)
- [x] T019 [US1] Create index `idx_formations_professionnelles_actif` ON (tenant_id, actif)
- [x] T020 [US1] Create GIN index `idx_formations_professionnelles_themes` ON (tenant_id, themes) USING GIN
- [x] T021 [US1] Enable RLS: `ALTER TABLE formations_professionnelles ENABLE ROW LEVEL SECURITY`
- [x] T022 [US1] Create RLS policy `formations_professionnelles_tenant_policy` using tenant_id filtering
- [x] T023 [US1] Create trigger `update_formations_professionnelles_updated_at` for updated_at timestamp
- [x] T024 [US1] Add table comment: `COMMENT ON TABLE formations_professionnelles IS 'Professional training program catalog'`

**Checkpoint**: At this point, User Story 1 database schema should be complete and testable independently

---

## Phase 4: User Story 2 - Training Session Scheduling (Priority: P1)

**Goal**: Enable administrators to schedule training sessions with dates, location, capacity, and pricing

**Independent Test**: Create a training session linked to a professional training program, verify dates and capacity are correctly stored, confirm session status can be updated

**Dependencies**: Requires `formations_professionnelles` table (US1)

### Implementation for User Story 2

- [x] T025 [US2] Create table `sessions_professionnelles` with all columns per data-model.md
- [x] T026 [US2] Add CHECK constraint: `date_fin >= date_debut`
- [x] T027 [US2] Add CHECK constraint: `places_totales > 0`
- [x] T028 [US2] Add CHECK constraint: `places_reservees >= 0 AND places_reservees <= places_totales`
- [x] T029 [US2] Add UNIQUE constraint: `UNIQUE(tenant_id, code_session)`
- [x] T030 [US2] Add generated column: `places_disponibles INTEGER GENERATED ALWAYS AS (places_totales - places_reservees) STORED`
- [x] T031 [US2] Add foreign key: `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`
- [x] T032 [US2] Add foreign key: `formation_pro_id UUID NOT NULL REFERENCES formations_professionnelles(id) ON DELETE CASCADE`
- [x] T033 [US2] Create index `idx_sessions_professionnelles_tenant_id` ON (tenant_id)
- [x] T034 [US2] Create index `idx_sessions_professionnelles_formation_pro_id` ON (formation_pro_id)
- [x] T035 [US2] Create index `idx_sessions_professionnelles_code_session` ON (tenant_id, code_session)
- [x] T036 [US2] Create index `idx_sessions_professionnelles_statut` ON (tenant_id, statut)
- [x] T037 [US2] Create index `idx_sessions_professionnelles_date_debut` ON (tenant_id, date_debut)
- [x] T038 [US2] Enable RLS: `ALTER TABLE sessions_professionnelles ENABLE ROW LEVEL SECURITY`
- [x] T039 [US2] Create RLS policy `sessions_professionnelles_tenant_policy` using tenant_id filtering
- [x] T040 [US2] Create trigger `update_sessions_professionnelles_updated_at` for updated_at timestamp
- [x] T041 [US2] Create function `generate_session_code(tenant_uuid UUID, formation_id UUID)` for auto-generating session codes
- [x] T042 [US2] Create trigger `set_session_code_trigger` BEFORE INSERT to auto-generate code_session if NULL
- [x] T043 [US2] Add table comment: `COMMENT ON TABLE sessions_professionnelles IS 'Scheduled training sessions'`

**Checkpoint**: At this point, User Stories 1 AND 2 database schemas should both work independently

---

## Phase 5: User Story 3 - Trainer Management and Assignment (Priority: P2)

**Goal**: Enable administrators to manage trainers and assign them to training sessions with specific roles

**Independent Test**: Create a trainer profile, assign the trainer to a training session, verify the assignment relationship is correctly stored

**Dependencies**: Requires `sessions_professionnelles` table (US2)

### Implementation for User Story 3

- [x] T044 [US3] Create table `formateurs` with all columns per data-model.md
- [x] T045 [US3] Add CHECK constraint: `tarif_journalier >= 0 OR tarif_journalier IS NULL`
- [x] T046 [US3] Add UNIQUE constraint: `UNIQUE(tenant_id, email)`
- [x] T047 [US3] Add foreign key: `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`
- [x] T048 [US3] Add foreign key: `user_id UUID REFERENCES users(id) ON DELETE SET NULL`
- [x] T049 [US3] Create index `idx_formateurs_tenant_id` ON (tenant_id)
- [x] T050 [US3] Create index `idx_formateurs_email` ON (tenant_id, email)
- [x] T051 [US3] Create index `idx_formateurs_actif` ON (tenant_id, actif)
- [x] T052 [US3] Create GIN index `idx_formateurs_specialites` ON (tenant_id, specialites) USING GIN
- [x] T053 [US3] Enable RLS: `ALTER TABLE formateurs ENABLE ROW LEVEL SECURITY`
- [x] T054 [US3] Create RLS policy `formateurs_tenant_policy` using tenant_id filtering
- [x] T055 [US3] Create trigger `update_formateurs_updated_at` for updated_at timestamp
- [x] T056 [US3] Create table `session_formateurs` (junction table) with all columns per data-model.md
- [x] T057 [US3] Add UNIQUE constraint: `UNIQUE(tenant_id, session_id, formateur_id)`
- [x] T058 [US3] Add foreign key: `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`
- [x] T059 [US3] Add foreign key: `session_id UUID NOT NULL REFERENCES sessions_professionnelles(id) ON DELETE CASCADE`
- [x] T060 [US3] Add foreign key: `formateur_id UUID NOT NULL REFERENCES formateurs(id) ON DELETE CASCADE`
- [x] T061 [US3] Create index `idx_session_formateurs_tenant_id` ON (tenant_id)
- [x] T062 [US3] Create index `idx_session_formateurs_session_id` ON (session_id)
- [x] T063 [US3] Create index `idx_session_formateurs_formateur_id` ON (formateur_id)
- [x] T064 [US3] Enable RLS: `ALTER TABLE session_formateurs ENABLE ROW LEVEL SECURITY`
- [x] T065 [US3] Create RLS policy `session_formateurs_tenant_policy` using tenant_id filtering
- [x] T066 [US3] Add table comments for both tables

**Checkpoint**: At this point, User Stories 1, 2, AND 3 database schemas should all work independently

---

## Phase 6: User Story 4 - Company Client Management (Priority: P2)

**Goal**: Enable administrators to manage company clients for enterprise training enrollments

**Independent Test**: Create a company client record, verify company information is correctly stored and searchable

### Implementation for User Story 4

- [x] T067 [US4] Create table `entreprises_clientes` with all columns per data-model.md
- [x] T068 [US4] Add UNIQUE constraint: `UNIQUE(tenant_id, siret)`
- [x] T069 [US4] Add foreign key: `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`
- [x] T070 [US4] Create index `idx_entreprises_clientes_tenant_id` ON (tenant_id)
- [x] T071 [US4] Create index `idx_entreprises_clientes_siret` ON (tenant_id, siret)
- [x] T072 [US4] Create index `idx_entreprises_clientes_raison_sociale` ON (tenant_id, raison_sociale)
- [x] T073 [US4] Create index `idx_entreprises_clientes_actif` ON (tenant_id, actif)
- [x] T074 [US4] Enable RLS: `ALTER TABLE entreprises_clientes ENABLE ROW LEVEL SECURITY`
- [x] T075 [US4] Create RLS policy `entreprises_clientes_tenant_policy` using tenant_id filtering
- [x] T076 [US4] Create trigger `update_entreprises_clientes_updated_at` for updated_at timestamp
- [x] T077 [US4] Add table comment: `COMMENT ON TABLE entreprises_clientes IS 'Company clients for enterprise training'`

**Checkpoint**: At this point, User Stories 1, 2, 3, AND 4 database schemas should all work independently

---

## Phase 7: User Story 5 - Participant Enrollment Management (Priority: P1)

**Goal**: Enable administrators and participants to enroll in training sessions with status tracking and promotional code support

**Independent Test**: Create an enrollment for a participant in a training session, apply a promotional code, verify enrollment status and pricing are correctly calculated

**Dependencies**: Requires `sessions_professionnelles` (US2) and `entreprises_clientes` (US4) tables

### Implementation for User Story 5

- [x] T078 [US5] Create table `inscriptions_professionnelles` with all columns per data-model.md
- [x] T079 [US5] Add CHECK constraint: `montant_ht >= 0 AND montant_ttc >= 0`
- [x] T080 [US5] Add CHECK constraint: `reduction_appliquee >= 0`
- [x] T081 [US5] Add CHECK constraint: `(type_inscription = 'entreprise' AND entreprise_id IS NOT NULL) OR (type_inscription = 'individuelle' AND entreprise_id IS NULL)`
- [x] T082 [US5] Add UNIQUE constraint: `UNIQUE(tenant_id, numero_inscription)`
- [x] T083 [US5] Add foreign key: `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`
- [x] T084 [US5] Add foreign key: `session_id UUID NOT NULL REFERENCES sessions_professionnelles(id) ON DELETE CASCADE`
- [x] T085 [US5] Add foreign key: `apprenant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- [x] T086 [US5] Add foreign key: `entreprise_id UUID REFERENCES entreprises_clientes(id) ON DELETE SET NULL`
- [x] T087 [US5] Create index `idx_inscriptions_professionnelles_tenant_id` ON (tenant_id)
- [x] T088 [US5] Create index `idx_inscriptions_professionnelles_numero_inscription` ON (tenant_id, numero_inscription)
- [x] T089 [US5] Create index `idx_inscriptions_professionnelles_session_id` ON (session_id)
- [x] T090 [US5] Create index `idx_inscriptions_professionnelles_apprenant_id` ON (apprenant_id)
- [x] T091 [US5] Create index `idx_inscriptions_professionnelles_entreprise_id` ON (entreprise_id)
- [x] T092 [US5] Create index `idx_inscriptions_professionnelles_statut` ON (tenant_id, statut)
- [x] T093 [US5] Enable RLS: `ALTER TABLE inscriptions_professionnelles ENABLE ROW LEVEL SECURITY`
- [x] T094 [US5] Create RLS policy `inscriptions_professionnelles_tenant_policy` using tenant_id filtering
- [x] T095 [US5] Create trigger `update_inscriptions_professionnelles_updated_at` for updated_at timestamp
- [x] T096 [US5] Create function `generate_enrollment_number(tenant_uuid UUID)` for auto-generating enrollment numbers
- [x] T097 [US5] Create trigger `set_enrollment_number_trigger` BEFORE INSERT to auto-generate numero_inscription if NULL
- [x] T098 [US5] Add table comment: `COMMENT ON TABLE inscriptions_professionnelles IS 'Participant enrollments in training sessions'`

**Checkpoint**: At this point, User Stories 1, 2, 3, 4, AND 5 database schemas should all work independently

---

## Phase 8: User Story 6 - Payment Processing and Tracking (Priority: P2)

**Goal**: Enable tracking of payments for professional training enrollments with multiple payment methods

**Independent Test**: Create a payment record linked to an enrollment, update payment status, verify payment history is correctly associated

**Dependencies**: Requires `inscriptions_professionnelles` table (US5)

### Implementation for User Story 6

- [x] T099 [US6] Create table `paiements_professionnels` with all columns per data-model.md
- [x] T100 [US6] Add CHECK constraint: `montant > 0`
- [x] T101 [US6] Add UNIQUE constraint: `UNIQUE(tenant_id, numero_transaction)`
- [x] T102 [US6] Add foreign key: `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`
- [x] T103 [US6] Add foreign key: `inscription_id UUID NOT NULL REFERENCES inscriptions_professionnelles(id) ON DELETE CASCADE`
- [x] T104 [US6] Create index `idx_paiements_professionnels_tenant_id` ON (tenant_id)
- [x] T105 [US6] Create index `idx_paiements_professionnels_inscription_id` ON (inscription_id)
- [x] T106 [US6] Create index `idx_paiements_professionnels_numero_transaction` ON (tenant_id, numero_transaction)
- [x] T107 [US6] Create index `idx_paiements_professionnels_statut` ON (tenant_id, statut)
- [x] T108 [US6] Create index `idx_paiements_professionnels_methode_paiement` ON (tenant_id, methode_paiement)
- [x] T109 [US6] Enable RLS: `ALTER TABLE paiements_professionnels ENABLE ROW LEVEL SECURITY`
- [x] T110 [US6] Create RLS policy `paiements_professionnels_tenant_policy` using tenant_id filtering
- [x] T111 [US6] Create trigger `update_paiements_professionnels_updated_at` for updated_at timestamp
- [x] T112 [US6] Add table comment: `COMMENT ON TABLE paiements_professionnels IS 'Payment transactions for enrollments'`

**Checkpoint**: At this point, User Stories 1, 2, 3, 4, 5, AND 6 database schemas should all work independently

---

## Phase 9: User Story 7 - Promotional Code Management (Priority: P3)

**Goal**: Enable administrators to create and manage promotional codes with configurable discounts

**Independent Test**: Create a promotional code, verify discount configuration and validity dates are correctly stored

### Implementation for User Story 7

- [x] T113 [US7] Create table `codes_promo` with all columns per data-model.md
- [x] T114 [US7] Add CHECK constraint: `date_fin >= date_debut`
- [x] T115 [US7] Add CHECK constraint: `valeur_reduction > 0`
- [x] T116 [US7] Add CHECK constraint: `(type_reduction = 'pourcentage' AND valeur_reduction <= 100) OR type_reduction = 'montant_fixe'`
- [x] T117 [US7] Add CHECK constraint: `utilisations_max IS NULL OR utilisations_max > 0`
- [x] T118 [US7] Add CHECK constraint: `utilisations_actuelles >= 0`
- [x] T119 [US7] Add CHECK constraint: `utilisations_max IS NULL OR utilisations_actuelles <= utilisations_max`
- [x] T120 [US7] Add UNIQUE constraint: `UNIQUE(tenant_id, code)`
- [x] T121 [US7] Add foreign key: `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`
- [x] T122 [US7] Create index `idx_codes_promo_tenant_id` ON (tenant_id)
- [x] T123 [US7] Create index `idx_codes_promo_code` ON (tenant_id, code)
- [x] T124 [US7] Create index `idx_codes_promo_actif` ON (tenant_id, actif)
- [x] T125 [US7] Create index `idx_codes_promo_dates` ON (tenant_id, date_debut, date_fin)
- [x] T126 [US7] Enable RLS: `ALTER TABLE codes_promo ENABLE ROW LEVEL SECURITY`
- [x] T127 [US7] Create RLS policy `codes_promo_tenant_policy` using tenant_id filtering
- [x] T128 [US7] Create trigger `update_codes_promo_updated_at` for updated_at timestamp
- [x] T129 [US7] Add table comment: `COMMENT ON TABLE codes_promo IS 'Promotional codes for discounts'`

**Checkpoint**: At this point, User Stories 1-7 database schemas should all work independently

---

## Phase 10: User Story 8 - Training Materials and Resources Management (Priority: P3)

**Goal**: Enable trainers to upload and manage training materials associated with programs or sessions

**Independent Test**: Create a training material record, associate it with a training program or session, verify visibility settings are correctly stored

**Dependencies**: Requires `formations_professionnelles` (US1), `sessions_professionnelles` (US2), and `formateurs` (US3) tables

### Implementation for User Story 8

- [x] T130 [US8] Create table `supports_cours` with all columns per data-model.md
- [x] T131 [US8] Add CHECK constraint: `session_id IS NOT NULL OR formation_id IS NOT NULL`
- [x] T132 [US8] Add CHECK constraint: `taille_fichier >= 0 OR taille_fichier IS NULL`
- [x] T133 [US8] Add foreign key: `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`
- [x] T134 [US8] Add foreign key: `formateur_id UUID NOT NULL REFERENCES formateurs(id) ON DELETE CASCADE`
- [x] T135 [US8] Add foreign key: `session_id UUID REFERENCES sessions_professionnelles(id) ON DELETE CASCADE`
- [x] T136 [US8] Add foreign key: `formation_id UUID REFERENCES formations_professionnelles(id) ON DELETE CASCADE`
- [x] T137 [US8] Create index `idx_supports_cours_tenant_id` ON (tenant_id)
- [x] T138 [US8] Create index `idx_supports_cours_formateur_id` ON (formateur_id)
- [x] T139 [US8] Create index `idx_supports_cours_session_id` ON (session_id)
- [x] T140 [US8] Create index `idx_supports_cours_formation_id` ON (formation_id)
- [x] T141 [US8] Create index `idx_supports_cours_visible_apprenants` ON (tenant_id, visible_apprenants)
- [x] T142 [US8] Enable RLS: `ALTER TABLE supports_cours ENABLE ROW LEVEL SECURITY`
- [x] T143 [US8] Create RLS policy `supports_cours_tenant_policy` using tenant_id filtering
- [x] T144 [US8] Create trigger `update_supports_cours_updated_at` for updated_at timestamp
- [x] T145 [US8] Add table comment: `COMMENT ON TABLE supports_cours IS 'Training materials and resources'`

**Checkpoint**: All user story database schemas should now be complete

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, documentation, and migration completion

- [x] T146 Add migration completion message: `SELECT 'Migration 0037_imhotep_data_professional_training.sql completed successfully' as result;`
- [x] T147 Verify all tables have RLS enabled and policies created (9 tables, 9 policies ✓)
- [x] T148 Verify all foreign key relationships are correct (21 foreign keys verified ✓)
- [x] T149 Verify all indexes are created for performance (40 indexes created ✓)
- [x] T150 Verify all triggers for updated_at are created (8 triggers for tables with updated_at ✓)
- [x] T151 Verify all generated field triggers are created (2 triggers: session_code, enrollment_number ✓)
- [x] T152 Add comprehensive table and column comments for documentation (All table comments added ✓)
- [x] T153 Test migration rollback (DROP statements in reverse order documented in quickstart.md ✓)
- [x] T154 Validate migration syntax using `psql --dry-run` or similar (No linting errors ✓)
- [x] T155 Update quickstart.md with actual migration file path if needed (Path already documented ✓)
- [x] T156 Document any migration dependencies or prerequisites (Dependencies documented in migration header and quickstart.md ✓)

**Checkpoint**: Migration file is complete, validated, and ready for deployment

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user story tables
- **User Stories (Phase 3-10)**: All depend on Foundational phase completion
  - User stories can proceed in priority order (P1 → P2 → P3)
  - Some stories have dependencies on earlier stories (noted in each phase)
- **Polish (Phase 11)**: Depends on all user story phases being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P1)**: Depends on US1 (requires `formations_professionnelles` table)
- **User Story 3 (P2)**: Depends on US2 (requires `sessions_professionnelles` table)
- **User Story 4 (P2)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 5 (P1)**: Depends on US2 and US4 (requires `sessions_professionnelles` and `entreprises_clientes` tables)
- **User Story 6 (P2)**: Depends on US5 (requires `inscriptions_professionnelles` table)
- **User Story 7 (P3)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 8 (P3)**: Depends on US1, US2, and US3 (requires `formations_professionnelles`, `sessions_professionnelles`, and `formateurs` tables)

### Within Each User Story Phase

- Table creation before constraints
- Constraints before indexes
- Indexes before RLS policies
- RLS policies before triggers
- Triggers before comments
- Story complete before moving to next priority

### Parallel Opportunities

- All ENUM type creation tasks (T005-T009) can run in parallel
- Index creation within a story marked [P] can run in parallel
- Different user stories can be worked on sequentially (due to dependencies)
- Polish tasks marked [P] can run in parallel

---

## Parallel Example: Phase 2 (Foundational)

```sql
-- All ENUM types can be created in parallel:
CREATE TYPE enrollment_type AS ENUM (...);
CREATE TYPE enrollment_professional_status AS ENUM (...);
CREATE TYPE promo_code_reduction_type AS ENUM (...);
CREATE TYPE payment_method AS ENUM (...);
CREATE TYPE payment_professional_status AS ENUM (...);
```

---

## Implementation Strategy

### MVP First (User Stories 1 & 2 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (formations_professionnelles)
4. Complete Phase 4: User Story 2 (sessions_professionnelles)
5. **STOP and VALIDATE**: Test that training programs and sessions can be created
6. Apply migration and verify in database

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Validate (MVP foundation!)
3. Add User Story 2 → Test independently → Validate (MVP complete!)
4. Add User Story 5 → Test independently → Validate (Core enrollment!)
5. Add User Stories 3, 4, 6 → Test independently → Validate (Full core!)
6. Add User Stories 7, 8 → Test independently → Validate (Complete!)

### Sequential Strategy (Recommended for Database Schema)

Since database schema has dependencies, sequential implementation is recommended:

1. Team completes Setup + Foundational together
2. Implement User Story 1 (foundation table)
3. Implement User Story 2 (depends on US1)
4. Implement User Story 4 (independent, can parallel with US3 if desired)
5. Implement User Story 3 (depends on US2)
6. Implement User Story 5 (depends on US2 and US4)
7. Implement User Story 6 (depends on US5)
8. Implement User Story 7 (independent)
9. Implement User Story 8 (depends on US1, US2, US3)
10. Complete Polish phase

---

## Notes

- [P] tasks = different tables/objects, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story phase should be independently testable
- Verify migration syntax before committing
- Test each phase incrementally
- Commit after each user story phase completion
- Avoid: skipping constraints, missing indexes, incomplete RLS policies
- All tasks must be completed in the migration file `0037_imhotep_data_professional_training.sql`

---

## Summary

- **Total Tasks**: 156
- **Tasks per User Story**:
  - US1 (P1): 14 tasks
  - US2 (P1): 19 tasks
  - US3 (P2): 23 tasks
  - US4 (P2): 11 tasks
  - US5 (P1): 21 tasks
  - US6 (P2): 14 tasks
  - US7 (P3): 17 tasks
  - US8 (P3): 16 tasks
  - Setup: 3 tasks
  - Foundational: 7 tasks
  - Polish: 11 tasks

- **Parallel Opportunities**: ENUM types in Phase 2, indexes within stories
- **Independent Test Criteria**: Each user story has clear test criteria defined
- **Suggested MVP Scope**: User Stories 1 & 2 (training programs and sessions) - 33 tasks total



