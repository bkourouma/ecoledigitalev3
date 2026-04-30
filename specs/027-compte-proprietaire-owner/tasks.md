# Tasks: Espace Propriétaire (rôle Owner)

**Input**: `d:\ecoledigitale-main\specs\027-compte-proprietaire-owner\`  
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/owner-openapi.yaml](./contracts/owner-openapi.yaml), [quickstart.md](./quickstart.md)

**Setup script**: `.specify/scripts/powershell/check-prerequisites.ps1` est **absent** de ce dépôt ; le répertoire feature et les docs ont été utilisés directement.

**Tests**: Inclus (spec / plan : matrice 403, routes owner réservées au rôle `owner`).

**Organization**: Phases par user story (US1–US6), tâches numérotées **T001+** dans l’ordre d’exécution recommandé.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Fichiers distincts, pas de dépendance directe entre eux (peut paralléliser).
- **[Story]**: `US1` … `US6` alignés sur [spec.md](./spec.md).

## Path Conventions (monorepo)

- API : `d:\ecoledigitale-main\apps\api\src\`
- Web : `d:\ecoledigitale-main\apps\web\src\`
- Contrats : `d:\ecoledigitale-main\packages\contracts\src\`
- Migrations : `d:\ecoledigitale-main\infra\scripts\migrations\`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Vérifier l’outiling existant ; aucune création de monorepo.

- [ ] **T001** Vérifier que `pnpm install` à la racine `d:\ecoledigitale-main` et les builds/types des packages `apps/api`, `apps/web`, `packages/contracts` passent sur la branche de travail (fumée CI locale).

### Phase 1 — journal de vérification (2026-04-17)

| Étape | Commande (depuis `d:\ecoledigitale-main`) | Résultat |
|--------|--------------------------------------------|----------|
| Dépendances | `npx --yes pnpm@10.14.0 install` | **OK** (lockfile à jour ; `pnpm` absent du PATH → utiliser `npx pnpm@10.14.0`) |
| Contrats | `npx --yes pnpm@10.14.0 --filter @ecoledigitale/contracts run type-check` | **OK** (2026-04-17) — Zod sans `description` dans `RawCreateParams`, import `CalendarQuerySchema` depuis `session.schema`, renommages d’exports en conflit (`SessionProErrorResponseSchema`, formations pro, teacher-students, parent, paiements-pro, inscriptions-pro), dashboard formateur sans doublon `NotificationItem`, `index.ts` : `export type` pour types sessions-pro (`isolatedModules`). |
| API | `npx --yes pnpm@10.14.0 --filter @ecoledigitale/api run build` | **Exit 0** (script inchangé : `tsc … --noEmitOnError false`) |
| Web | `npx --yes pnpm@10.14.0 --filter @ecoledigitale/web run type-check` | **Échec partiel** — corrections ciblées : JSX dans test → `createElement`, `test-payment-periods/page.tsx` (headers / template cassé), `InscriptionCard` (`)}` manquant), `tsconfig` : `target` ES2017, `downlevelIteration`, `include` limité à `src/**`, exclusion `e2e` + `**/*.test.*` + dossiers `__tests__`. Il reste un **volume important** d’erreurs `strict` dans `src/` (implicit any, types académiques, chemins UI, etc.) à traiter par chantiers. |

**T001** reste **ouverte** pour le critère « `web` type-check au vert sur tout `src/` » ; **@ecoledigitale/contracts** est **vert** sur `pnpm --filter @ecoledigitale/contracts run type-check`.

**Script** : `check-prerequisites.ps1` introuvable — pas d’exécution.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Rôle `owner` en base, persistance alertes pilotage, middleware, enregistrement des routes, schémas Zod de base — **bloque toutes les user stories**.

**⚠️ CRITICAL**: Aucune story UI/API métier complète avant la fin de cette phase.

- [x] **T002** **[Foundation]** Créer une migration versionnée `d:\ecoledigitale-main\infra\scripts\migrations\<NNN>_add_owner_role.sql` : pour chaque `tenants.id`, `INSERT INTO roles (tenant_id, key, name)` avec `key = 'owner'` et libellé métier (ex. `Propriétaire`), **idempotent** (`ON CONFLICT (tenant_id, key) DO NOTHING` ou sous-requête `WHERE NOT EXISTS`). Ne pas utiliser de colonne `description` sur `roles` (schéma actuel : `key`, `name` uniquement). → **`0052_add_owner_role.sql`**
- [x] **T003** **[P] [Foundation]** Créer `d:\ecoledigitale-main\infra\scripts\migrations\<NNN>_owner_pilotage_alerts.sql` : table `owner_pilotage_alerts` (colonnes min. `id`, `tenant_id`, `severity`, `message`, `domain`, `created_at`, `acknowledged_at`, `acknowledged_by_user_id`), **RLS** sur `tenant_id`, index `(tenant_id, acknowledged_at)`, `(tenant_id, severity, created_at DESC)` — conforme [data-model.md](./data-model.md). → **`0053_owner_pilotage_alerts.sql`**
- [x] **T004** **[Foundation]** Ajouter `d:\ecoledigitale-main\apps\api\src\middlewares\requireOwner.ts` : si pas de `tenantId` sur la requête → 400 ; si `request.user.roles` ne contient pas `'owner'` → 403 ; réutiliser le typage `AuthenticatedRequest` / pattern des gardes existants (`admin` dans `sessions-pro.ts`, etc.).
- [x] **T005** **[Foundation]** Créer le plugin de routes `d:\ecoledigitale-main\apps\api\src\routes\owner\index.ts` : enregistrer `preHandler` **par route** (ou équivalent) appelant `requireOwner` pour **chaque** handler exposé (pas seulement un hook parent unique sans couverture des sous-routes).
- [x] **T006** **[Foundation]** Enregistrer le plugin dans `d:\ecoledigitale-main\apps\api\src\index.ts` : `fastify.register(ownerRoutes, { prefix: '/api/v1/owner' })` après `authMiddleware` / `tenantContextPlugin` (même ordre que les autres modules).
- [x] **T007** **[P] [Foundation]** Créer `d:\ecoledigitale-main\packages\contracts\src\owner.schema.ts` : schémas Zod pour `OwnerDashboardResponse`, `OwnerAlert`, enums `severity`, query `period` / `format` ; exporter depuis `d:\ecoledigitale-main\packages\contracts\src\index.ts`.
- [x] **T008** **[Foundation]** Vérifier le flux login dans `d:\ecoledigitale-main\apps\api\src\routes\auth.ts` : les rôles proviennent de `roles.key` via `user_roles` — aucun changement code nécessaire si la migration T002 + assignation `user_roles` suffisent ; documenter dans [quickstart.md](./quickstart.md) l’assignation d’un utilisateur test **owner** (relecture / compléter la section existante).

**Checkpoint**: Migration appliquée en local ; `GET /api/v1/owner/...` peut être appelé avec garde owner (même stub) sans erreur de registration.

---

## Phase 3: User Story 1 — Accès espace + pilotage stratégique (P1) 🎯 MVP

**Goal**: Tableau de bord KPI + espace web dédié avec garde de rôle ; pas de modification académique.

**Independent Test**: Compte **uniquement** `owner` sur un tenant → dashboard affiche les familles d’indicateurs (finances, académique synthèse, staff, formations, alertes) ou états vides explicites ; compte sans `owner` → 403 API / redirection ou `/unauthorized` côté web.

### Implementation

- [x] **T009** **[US1]** Implémenter `GET /api/v1/owner/dashboard` avec agrégations SQL — logique dans `d:\ecoledigitale-main\apps\api\src\services\owner-dashboard.service.ts`, appelée depuis `d:\ecoledigitale-main\apps\api\src\routes\owner\index.ts` (revenus mois, recouvrement, cycles, paie enseignants, impayés 60j, effectifs, classes, moyennes, réussite, assiduité 30j, devoirs corrigés, RH, formations pro, alertes).
- [x] **T010** **[US1]** Valider la réponse avec `OwnerDashboardResponseSchema` (Zod) côté service et après fusion alertes dans la route.
- [x] **T011** **[P] [US1]** Créer `d:\ecoledigitale-main\apps\web\src\app\owner\layout.tsx` (préfixe URL `/owner/*` pour éviter conflit avec `app/dashboard`) : sidebar, badge tenant + année active, garde `session` + rôle `owner`, redirection `/login` / `/unauthorized`.
- [x] **T012** **[US1]** Créer `d:\ecoledigitale-main\apps\web\src\app\owner\page.tsx` : redirection vers `/owner/dashboard`.
- [x] **T013** **[P] [US1]** Composants `d:\ecoledigitale-main\apps\web\src\components\owner\` : `KpiGrid`, `RecoveryByCycleChart`, `AlertsPanel`, `AcademicSummaryCard`, `StaffSummaryCard`, `FormationsSummaryCard`.
- [x] **T014** **[US1]** `d:\ecoledigitale-main\apps\web\src\app\owner\dashboard\page.tsx` : assemblage des six blocs (KPI + recouvrement + alertes + 3 cartes). Pages placeholder `/owner/finances`, `academique`, `staff`, `formations`, `alertes`, `acces`.
- [x] **T015** **[US1]** Hook `d:\ecoledigitale-main\apps\web\src\lib\hooks\use-owner-dashboard.ts` (TanStack Query + `createApiHeaders`). Page `d:\ecoledigitale-main\apps\web\src\app\unauthorized\page.tsx`.

**Checkpoint**: MVP démontrable — owner voit le dashboard ; autres rôles refusés.

---

## Phase 4: User Story 2 — Finances + export (P1)

**Goal**: Vue finances (période, cycle, drill-down classe), impayés triés, export PDF/CSV avec minimisation PII.

**Independent Test**: Filtres période ; totaux cohérents avec sources ; export global sans nom complet élève sur lignes agrégées.

### Implementation

- [x] **T016** **[US2]** Implémenter `GET /api/v1/owner/finances` : agrégats dans `apps/api/src/services/owner-finances.service.ts` (échéances `student_tuition_installments` + inscriptions actives, paie `teacher_payments` / `payment_periods`) ; route dans `apps/api/src/routes/owner/index.ts` ; query `period`, `academicYearId`, `cycleId` (alias `cycle`).
- [x] **T017** **[US2]** Implémenter `GET /api/v1/owner/reports/financial?format=pdf|csv` : CSV via `buildOwnerFinancialReportCsv`, PDF via `PDFGenerationService.generatePdfFromHtml` ; PII élève : référence anonymisée (`anonymizeStudentRef`) sur impayés.
- [x] **T018** **[P] [US2]** Étendre `packages/contracts/src/owner.schema.ts` : `OwnerFinancesResponseSchema`, `OwnerFinancialReportQuerySchema`, périodes `month|quarter|year|academic_year`.
- [x] **T019** **[US2]** `apps/web/src/app/owner/finances/page.tsx` : filtres période / année scolaire (UUID) / cycle, tableaux recouvrement par classe, impayés, paie enseignants ; hook `use-owner-finances.ts`.
- [x] **T020** **[US2]** `apps/web/src/app/owner/finances/rapport/page.tsx` : téléchargement PDF/CSV avec les mêmes paramètres (chemins sous `/owner/*`, pas de route group `(owner)` — évite conflit avec `app/dashboard`).

**Checkpoint**: US1 + US2 livrables indépendamment pour la démo finances.

---

## Phase 5: User Story 3 — Validation rémunération enseignant (P2)

**Goal**: `PATCH /owner/payroll/:id/validate` → mise à jour `teacher_payments` + audit (`payment_audit_log`).

**Independent Test**: État éligible → 200 + statut / `approved_by` ; double validation → 409 ou message métier sans corruption.

### Implementation

- [x] **T021** **[US3]** Implémenter `PATCH /api/v1/owner/payroll/:id/validate` : logique `apps/api/src/services/owner-payroll.service.ts` (transition `calculated` → `approved`, `approved_by` / `approved_at`) ; route dans `apps/api/src/routes/owner/index.ts` ; audit via trigger `audit_teacher_payments_trigger` sur `teacher_payments`.
- [x] **T022** **[P] [US3]** Schémas Zod dans `packages/contracts/src/owner.schema.ts` : `OwnerPayrollValidateResponseSchema`, `OwnerPayrollValidateConflictBodySchema`, `OwnerPayrollValidateNotFoundBodySchema`.
- [x] **T023** **[US3]** Bouton « Valider » sur `apps/web/src/app/owner/finances/page.tsx` (lignes `calculated` uniquement) : `PATCH` + `invalidateQueries` sur `owner-finances`.

**Checkpoint**: Validation paie traçable réservée au owner.

---

## Phase 6: User Story 4 — Synthèses académiques (P2)

**Goal**: Moyennes par classe, réussite par programme, assiduité agrégée, devoirs corrigés — **lecture seule** (aucun formulaire de mutation).

**Independent Test**: Tri tableaux ; comparaison semestres ; classes à risque sous seuil paramétrable (config ou constante par défaut documentée).

### Implementation

- [x] **T024** **[US4]** Implémenter `GET /api/v1/owner/academic` : agrégations lecture seule dans `apps/api/src/services/owner-academic.service.ts` (`student_period_course_averages`, `academic_year_periods`, `teacher_attendance_*`, `assignment_submissions`, programmes / classes).
- [x] **T025** **[P] [US4]** Schémas Zod `OwnerAcademicResponseSchema` (+ sous-schémas) dans `packages/contracts/src/owner.schema.ts`.
- [x] **T026** **[US4]** `apps/web/src/app/owner/academique/page.tsx` + `use-owner-academic.ts`, `SemesterAveragesChart.tsx`, `AttendanceHeatmap.tsx` : table triable, comparaison périodes, heatmap assiduité, cartes devoirs + classes à risque (seuil constant `OWNER_ACADEMIC_RISK_GRADE_THRESHOLD = 10` côté API).

**Checkpoint**: Parcours académique sans aucune route owner de mutation pédagogique.

---

## Phase 7: User Story 5 — Rôles utilisateurs + alertes (P3)

**Goal**: Liste utilisateurs du tenant, modification **attributions de rôles** dans les limites métier ; `GET /owner/alerts` + `PATCH /owner/alerts/:id/acknowledge`.

**Independent Test**: Acquittement alerte → plus « en attente » pour ce user ; changement `user_roles` reflété après refresh token / nouvelle session.

### Implementation

- [x] **T027** **[US5]** `GET /api/v1/owner/alerts` + `PATCH /api/v1/owner/alerts/:id/acknowledge` : réponses validées (`OwnerAlertsListResponseSchema`, `OwnerAlertSchema`), messages d’erreur en français.
- [x] **T028** **[US5]** `apps/api/src/services/owner-alerts-feed.service.ts` : `syncOwnerPilotageAlerts` appelé au chargement de `GET /alerts` — insert idempotent par domaine `auto_*` (impayés scolarité &gt; 60 j, cours sans titulaire, paies en attente).
- [x] **T029** **[US5]** `GET /api/v1/owner/roles/assignable`, `GET /api/v1/owner/users`, `PATCH /api/v1/owner/users/:userId/roles` (`owner-users.service.ts`) : rôles gérables `admin|teacher|student|parent|formateur` uniquement ; pas de `owner` ; garde-fou **dernier admin** du tenant.
- [x] **T030** **[P] [US5]** `apps/web/src/app/owner/alertes/page.tsx` + `use-owner-alerts.ts`.
- [x] **T031** **[P] [US5]** `apps/web/src/app/owner/acces/page.tsx` + `use-owner-users.ts` (liste + cases à cocher + `PATCH`).

**Checkpoint**: Gouvernance accès + centre d’alertes opérationnels.

---

## Phase 8: User Story 6 — Personnel + formations (P3)

**Goal**: `GET /owner/staff` et `GET /owner/formations` ; pages web synthèse ; RSO lecture seule.

**Independent Test**: Compteurs alignés avec données de référence tenant ; pas d’action pédagogique sur formations.

### Implementation

- [x] **T032** **[US6]** `GET /api/v1/owner/staff` : `apps/api/src/services/owner-staff.service.ts` — enseignants + heures (`teaching_hours` / `teacher_assignments`), cours sans titulaire (`class_courses`), paies `calculated` ; `activeFormateurs` si `usesSessionBasedProfessionalTraining`.
- [x] **T033** **[US6]** `GET /api/v1/owner/formations` : `owner-formations.service.ts` — agrégats via `getTableName` / `usesSessionBasedProfessionalTraining` (sessions, inscriptions, paiements `valide`, entreprises ; formateurs actifs en mode sessions).
- [x] **T034** **[P] [US6]** `OwnerStaffResponseSchema`, `OwnerFormationsResponseSchema` dans `packages/contracts/src/owner.schema.ts`.
- [x] **T035** **[P] [US6]** `apps/web/src/app/owner/staff/page.tsx` + `formations/page.tsx` + hooks `use-owner-staff.ts`, `use-owner-formations.ts`.

**Checkpoint**: Les six user stories sont couvertes fonctionnellement.

---

## Phase 9: Polish & Cross-Cutting

**Purpose**: Sécurité transverse, tests plan, alignement quickstart.

- [x] **T036** **[P]** Tests Jest sous `apps/api/src/__tests__/` : `require-owner.test.ts` (403 sans `owner`, passes avec `owner`) ; `owner-routes.test.ts` (`GET /dashboard` 403/200 + `PATCH` alerte 403) avec mock `fetchOwnerDashboardKpis` et pool minimal pour la fusion alertes.
- [x] **T037** Commentaire dans `apps/web/middleware.ts` : espace **`/owner/*`** (`app/owner/`), garde rôle côté layout NextAuth (pas d’auth Edge dans ce middleware).
- [x] **T038** [quickstart.md](./quickstart.md) § 6 : checklist étendue (`requireOwner`, jeux 403/200, `PATCH` vs `GET`, blacklist, exports) + § 6.1 inventaire des **PATCH** owner.
- [x] **T039** Test `owner-api-surface.test.ts` (exactement 3 `fastify.patch`, pas de chemins académiques explicites) + inventaire § 6.1 du quickstart.

---

## Dependencies & Execution Order

### Phase Dependencies

```text
Phase 1 (Setup)
    ↓
Phase 2 (Foundation) — bloque tout
    ↓
Phase 3 (US1 MVP)
    ↓
Phase 4–8 (US2–US6) — séquentiel recommandé par priorité P1→P3 ; US4–US6 peuvent être parallélisées entre devs une fois US2–US3 stables si contrats stables
    ↓
Phase 9 (Polish)
```

### User Story Dependencies

| Story | Dépend de | Remarque |
|-------|-----------|----------|
| US1 | Foundation | MVP |
| US2 | Foundation, préf. US1 pour navigation cohérente | Peut être en parallèle API-only avec US1 front si équipes séparées |
| US3 | US2 (UI finances/staff) partiellement | API seule dès Foundation |
| US4–US6 | Foundation | Faible couplage entre US4, US5, US6 |

### Graphe synthétique

```text
T002–T008 (Foundation)
       → US1 (T009–T015)
       → US2 (T016–T020) → US3 (T021–T023)
       → US4 (T024–T026)
       → US5 (T027–T031)
       → US6 (T032–T035)
       → Polish (T036–T039)
```

---

## Parallel Execution Examples

**Après Foundation (T002–T008) — lancer en parallèle sur machines / devs différents :**

- Dev A : T009–T010 (API dashboard) + T015 (hook).
- Dev B : T011–T014 (layout + composants UI owner).

**Après contrats T007 enrichis (US2) :**

- [P] T018 schémas + T019 page finances (front) pendant T016–T017 (back finances + export).

---

## Implementation Strategy

### MVP First (US1 uniquement)

1. Phase 1 → Phase 2 (T002–T008).  
2. Phase 3 complète (T009–T015).  
3. **STOP** : valider [quickstart.md](./quickstart.md) scénarios dashboard + 403.

### Incremental Delivery

1. + Phase 4 (US2) → démo finances.  
2. + Phase 5 (US3) → validation paie.  
3. + Phases 6–8 → couverture spec complète.  
4. Phase 9 → durcissement prod.

---

## Summary (pour `/speckit.implement`)

| Métrique | Valeur |
|----------|--------|
| **Total tâches** | 39 (T001–T039) |
| **Par user story** | US1: 7 · US2: 5 · US3: 3 · US4: 3 · US5: 5 · US6: 4 · Setup: 1 · Foundation: 7 · Polish: 4 |
| **Tâches [P] (parallélisables)** | 12 |
| **MVP suggéré** | Phases 1–3 (T001–T015) après Foundation |

---

## Notes

- Respecter **NEVER USE ROOT** sur serveur : déploiement avec utilisateur `deployer@147.93.44.169` uniquement pour les étapes distantes.  
- Numérotation des fichiers migration `<NNN>_` : prendre le prochain entier disponible dans `d:\ecoledigitale-main\infra\scripts\migrations\` au moment de l’implémentation.  
- Toute nouvelle route owner : **`requireOwner` explicite sur le handler** (exigence spec / plan).
