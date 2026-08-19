---
description: "Task list — Rémunération des enseignants, Module Professionnel"
---

# Tasks: Rémunération des enseignants — Module Professionnel

**Input**: Design documents from `specs/031-remuneration-professionnelle/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: inclus — SC-005 (idempotence), SC-007 (invariant des totaux) et
SC-009 (non-régression du chemin académique) ne sont vérifiables que par des
tests automatisés.

**Organization**: par user story (US1–US5) pour livraison incrémentale.

## Format: `[ID] [P?] [Story] Description`

- **[P]** : parallélisable (fichiers différents, sans dépendance bloquante)
- **[Story]** : US1..US5 (phases user story uniquement)

## Path Conventions

- DB : `infra/scripts/migrations/`, runners et scripts de constat `scripts/`
- Contrats : `packages/contracts/src/`
- API : `apps/api/src/routes|services`, tests `apps/api/src/__tests__`
- Web : `apps/web/src/app|components`

---

## Phase 0: Constat préalable (Blocking)

**Purpose**: la forme de la migration dépend de l'état réel des bases (E4/E5).

- [X] T001 Écrire `scripts/check-payment-hour-details-fk.js` : rapporte la FK `payment_hour_details_teaching_hours_id_fkey`, la nullabilité de `teaching_hours_id`, `payment_periods.academic_year_id`, le défaut de devise, les contraintes EXCLUDE/UNIQUE des tables de paie, les prérequis de `0103` et un verdict actionnable. **Lecture seule.**
- [~] T002 Exécuter T001 sur **dev ET prod**, consigner dans `_constat.txt`.
      **DEV FAIT** : E4 confirmé (FK présente, NOT NULL, 0 ligne de détail, 0 paiement → le chemin horaire académique n'a jamais abouti) ; E5 présente sur dev mais toujours absente du versionné ; E6 non avéré sur dev (`_fixed` déclare déjà `'XOF'`) ; **E7/E8/E9 découverts** (voir T002b) ; 570 séances toutes candidates → D-R12 validée.
      **PROD RESTE À FAIRE** — T002 ne peut être clos avant.
- [ ] T002b Arbitrer **E9** avec l'équipe : `0011_teacher_remuneration.sql` et `0011_teacher_remuneration_fixed.sql` divergent (idempotence, devise, contraintes) et **la base ne correspond exactement à aucun des deux**. Décider lequel fait foi. Le nettoyage des deux fichiers est un chantier distinct de cette feature, mais la décision conditionne la rédaction de `0103`

---

## Phase 1: Foundational (Blocking Prerequisites)

**Purpose**: schéma DB + contrats Zod. **BLOQUE toutes les user stories.**

**⚠️ CRITICAL**: aucune US ne peut démarrer avant cette phase.

### Base de données — `0103_remuneration_professionnelle.sql`

- [X] T003 En-tête de migration (pourquoi/quoi/rollback, style `0100`) + `CREATE EXTENSION IF NOT EXISTS btree_gist`
- [X] T004 Créer `professional_ecue_hourly_rates` : colonnes de `data-model.md` §1, `CHECK` de plage, contrainte `EXCLUDE USING gist` avec `COALESCE(enseignant_id, …)`, 3 index, RLS + policy `professional_ecue_hourly_rates_tenant_isolation`
- [X] T005 Altérer `professional_ecue_seances` : `ADD COLUMN IF NOT EXISTS` pour `statut` (défaut `'planifiee'` + `CHECK`), `statut_modifie_par`, `statut_modifie_le`, `validated_by`, `validated_at` ; index `(tenant_id, statut, date)` et index partiel de couverture paie. **Aucun backfill** (D-R12)
- [X] T006 Altérer `payment_hour_details` dans l'ordre impératif de `data-model.md` §3 : `DROP CONSTRAINT IF EXISTS unique_teaching_hour_per_payment` → `DROP CONSTRAINT IF EXISTS payment_hour_details_teaching_hours_id_fkey` → `ALTER COLUMN teaching_hours_id DROP NOT NULL` → recréer la FK → `ADD COLUMN` `source`/`attendance_session_id`/`seance_id` → `CHECK` d'exclusivité → 3 index uniques partiels + 2 index de filtre
- [X] T007 Altérer `payment_periods` : `ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES academic_years(id) ON DELETE SET NULL` + index `(tenant_id, academic_year_id)` (E5)
- [X] T008 Altérer `teacher_payments` : `ALTER COLUMN currency SET DEFAULT 'XOF'` — **sans** réécrire les lignes existantes (D-R9). No-op sur les bases issues de `0011_…_fixed`
- [X] T008a **[ajouté par le constat — E7]** Recréer `unique_teacher_payment_per_period (tenant_id, teacher_id, payment_period_id, payment_type)` sur `teacher_payments` : bloc `DO $$` de détection des doublons avec `RAISE EXCEPTION` actionnable, puis `ADD CONSTRAINT` conditionné à son absence (`data-model.md` §5)
- [X] T008b **[ajouté par le constat — E8]** Recréer `payment_periods_no_overlap` (EXCLUDE `WHERE status <> 'archived'`) sur `payment_periods` : bloc `DO $$` de détection des chevauchements avec `RAISE EXCEPTION`, puis `ADD CONSTRAINT` conditionné (`data-model.md` §5bis). **Sans ce garde-fou, une séance validée tombant dans deux périodes qui se recouvrent est payée deux fois**
- [X] T009 Créer la vue `v_payment_hour_details_enriched` (`data-model.md` §6)
- [X] T010 Runner `scripts/apply-migration-0103-remuneration-pro.js` + exécution en dev ; vérifier la rejouabilité (double passage sans erreur)

### Contrats partagés

- [X] T011 [P] `packages/contracts/src/payments.ts` : `HourSourceSchema` (`academique`|`professionnel`), `PaymentHourDetailSchema` (+`source`, `attendanceSessionId`, `seanceId`, `teachingHoursId` optionnel), `PaymentCalculationRequestSchema` (+`scope`), `PaymentCalculationSkipReasonSchema`, enrichissement de `PaymentReportQuerySchema` (+`source`)
- [X] T012 [P] `packages/contracts/src/professional-remuneration.ts` (NOUVEAU) : `SeanceStatutSchema`, `SeanceValidationRequestSchema`/`…ResponseSchema`, `ProfessionalEcueHourlyRateSchema`, `Create…`/`Update…`, `EcueRateResolutionSchema`
- [X] T013 `packages/contracts/src/index.ts` : barrel `export *` ; `pnpm --filter @ecoledigitale/contracts type-check` sans erreur

**Checkpoint**: schéma et contrats en place — les US peuvent démarrer.

---

## Phase 2: US1 — Distinguer une séance planifiée d'une séance faite (P1)

**Goal**: rendre la source d'heures professionnelle fiable.

**Independent Test**: 3 séances (réalisée / annulée / planifiée) → seule la réalisée **et** validée est payable.

- [X] T014 [US1] `apps/api/src/services/professional-seance-validation.service.ts` : `listSeances()` (filtres du contrat §1, calcul de `dureeHeures`, prédicat `payable` + `blockers`, comptage `presencesSaisies`, rattachement au paiement éventuel)
- [X] T015 [US1] Même service : `setStatut()` — refuse le passage à `annulee` si la séance figure dans un paiement `approved`/`paid` (`SEANCE_ALREADY_PAID`, FR-006) ; renseigne `statut_modifie_par/_le`
- [X] T016 [US1] Même service : `validateBatch()` — application **partielle**, retour `{updated, rejected[{seanceId, reason}]}` (FR-005) ; motifs `STATUT_NON_REALISEE`, `HORAIRES_INCOMPLETS`, `SANS_ENSEIGNANT`, `DEJA_PAYEE`
- [X] T017 [US1] Même service : `findOverlaps()` — séances d'un même enseignant aux créneaux recoupés sur un intervalle (FR-007)
- [X] T018 [US1] `apps/api/src/routes/professional-remuneration.ts` (NOUVEAU) : `GET /seances`, `PATCH /seances/:id/statut`, `POST /seances/validate`, `GET /seances/overlaps` ; gardes admin via `professional-guards.ts` ; enregistrement dans `apps/api/src/index.ts` sous `/api/v1/professional/remuneration`
- [X] T019 [US1] `apps/web/src/app/professionnel/admin/remuneration/seances/page.tsx` : tableau filtrable (enseignant, cohorte, ECUE, dates, statut, payable, `hasAttendance`), sélection multiple, actions de statut et de validation en lot, affichage des `blockers` et du bandeau de chevauchements
- [X] T020 [US1] `apps/web/src/components/layout/Sidebar.tsx` : sous-menu `Rémunération` du Module Professionnel (entrées « Validation des séances » et « Tarifs horaires ECUE »), soumis au filtrage `canSeeAdmin` existant (FR-051)
- [X] T021 [P] [US1] `apps/api/src/__tests__/professional-seance-validation.test.ts` : payabilité (5 scénarios d'acceptation US1), verrou paiement, lot partiel, chevauchements

**Checkpoint**: la source d'heures professionnelle est fiable et auditable — indépendamment de tout calcul.

---

## Phase 3: US2 — Rémunérer sur les heures professionnelles (P1)

**Goal**: le montant devient juste. **Cœur de la feature.**

**Independent Test**: enseignant horaire + 2 séances validées → montant = heures × tarif, détail citant les séances.

### Socle : collecteurs d'heures

- [X] T022 [US2] `apps/api/src/services/hour-collectors/types.ts` : interface `HourCollector` (`collect(tenantId, periodStart, periodEnd, teacherIds?) → HourRecord[]`) et type `HourRecord` (`source`, `teacherId`, `sessionDate`, `hours`, refs d'origine, libellés)
- [X] T023 [US2] `apps/api/src/services/hour-collectors/academic-hour-collector.ts` : déplacer la requête actuelle (`payment-calculator.ts:464-482`) **sans en changer la sémantique**, mais en **une seule requête par période** au lieu d'une par enseignant (SC-006)
- [X] T024 [US2] `apps/api/src/services/hour-collectors/professional-hour-collector.ts` : requête de `data-model.md` §7 (séances payables uniquement)
- [X] T025 [US2] `apps/api/src/services/professional-ecue-rates.service.ts` : `resolveRate(ecueId, enseignantId, date)` selon l'ordre D-R6, avec préchargement en lot des tarifs de la période (éviter le N+1)

### Calculateur

- [X] T026 [US2] `payment-calculator.ts` : consommer la **concaténation** des collecteurs selon `scope`, trier par date, conserver intact le calcul horaire/salarial/mixte et le regroupement hebdomadaire des heures sup sur le **cumul** (FR-020, FR-021)
- [X] T027 [US2] `payment-calculator.ts` : produire des `hourDetails` portant `source` + la bonne référence d'origine ; historiser `hoursCount`/`hourlyRate` (FR-022, FR-023)
- [X] T028 [US2] `payment-calculator.ts` : compte rendu enrichi — `skipReason` (`NO_CONFIG`, `NO_HOURS`, `OUT_OF_SCOPE`, `PAYMENT_LOCKED`, `NO_RATE_RESOLVED`), `hoursBySource`, et **`teacherName` réellement renseigné** (aujourd'hui codé en dur à `"Unknown"`, cf. `teacher-payments.ts:777,873,893`)
- [X] T029 [US2] `apps/api/src/routes/teacher-payments.ts` : accepter `scope` (défaut `all`) ; **refuser** d'écraser un paiement `approved`/`paid`/`cancelled` lors d'un recalcul (FR-025) ; renseigner `currency` depuis le tenant (D-R9) ; garantir la reconstruction complète du détail sans doublon (FR-024)
- [X] T030 [US2] `apps/web/src/app/payments/calculate/page.tsx` : sélecteur de périmètre (Tous / Académique / Professionnel), affichage des motifs d'exclusion et de la ventilation `hoursBySource`
- [X] T031 [P] [US2] `apps/api/src/__tests__/payment-calculator-academic.test.ts` : **non-régression** du chemin académique après T023 et après la correction de FK (SC-009)
- [X] T032 [P] [US2] `apps/api/src/__tests__/payment-calculator-professional.test.ts` : seules les séances payables comptent (SC-004) ; montant = heures × tarif (SC-001)
- [X] T033 [P] [US2] `apps/api/src/__tests__/payment-calculator-mixed.test.ts` : un seul paiement, total = somme des origines (SC-002) ; seuil d'heures sup franchi par le **cumul** (FR-021)
- [ ] T034 [P] [US2] `apps/api/src/__tests__/payment-calculator-idempotence.test.ts` : double recalcul → résultat identique, aucun doublon de détail (SC-005) ; recalcul sur paiement approuvé → `PAYMENT_LOCKED`

**Checkpoint**: un enseignant professionnel est payé juste — MVP de la feature.

---

## Phase 4: US3 — Tarifer l'heure par ECUE (P2)

**Goal**: passer du tarif unique par défaut à une tarification exploitable en établissement.

**Independent Test**: tarif posé sur une ECUE → appliqué ; tarif retiré → repli sur le défaut de l'enseignant.

- [X] T035 [US3] `professional-ecue-rates.service.ts` : CRUD complet ; traduire la violation de la contrainte `EXCLUDE` en `RATE_OVERLAP` 409 (FR-011) ; valider la plage (`INVALID_RANGE`)
- [X] T036 [US3] `routes/professional-remuneration.ts` : `GET|POST /ecue-rates`, `GET|PUT|DELETE /ecue-rates/:id`, `GET /ecue-rates/resolve` (contrat §2)
- [X] T037 [US3] `payment-calculator.ts` : si aucun tarif ni défaut n'est résoluble pour une heure payable → `skipReason: NO_RATE_RESOLVED` sur l'enseignant, **jamais un montant nul silencieux** (FR-013)
- [X] T038 [US3] `apps/web/src/app/professionnel/admin/remuneration/tarifs/page.tsx` : liste + création/édition (ECUE, enseignant optionnel, montant, devise, plage), message dédié au chevauchement, outil « simuler la résolution »
- [X] T039 [P] [US3] `apps/api/src/__tests__/professional-ecue-rates.test.ts` : chevauchement refusé (générique et nominatif distincts), ordre nominatif > générique > défaut, anomalie si rien de résoluble, tarif modifié après approbation sans effet sur le paiement (SC-008)

**Checkpoint**: tarification fine opérationnelle.

---

## Phase 5: US4 — Suivi, justification et rapports (P2)

**Goal**: rendre chaque montant opposable.

**Independent Test**: filtre « Professionnel » → totaux limités à cette origine ; bulletin mixte listant les deux.

- [X] T040 [US4] `apps/api/src/routes/payment-reports.ts` : paramètre `source` sur `/summary`, `/teacher/:teacherId`, `/period/:periodId`, `/list`, `/export/:format` ; filtrage au niveau du **détail**, jamais du paiement (FR-030)
- [X] T041 [US4] `apps/api/src/routes/teacher-payments.ts` — `GET /:id` : exposer le détail enrichi via `v_payment_hour_details_enriched` (`source`, `sessionDate`, `intitule`, `code`, `cohorteLibelle`, `seanceId`) (contrat §5)
- [X] T042 [P] [US4] `apps/web/src/app/payments/reports/page.tsx` : filtre d'origine, totaux ventilés, colonne Origine dans l'export
- [X] T043 [P] [US4] `apps/web/src/app/payments/manage/[id]/page.tsx` : colonne Origine + libellé de cohorte dans le détail horaire
- [X] T044 [P] [US4] `apps/web/src/app/api/teacher-payments/[id]/pdf/route.ts` et `[id]/statement/route.ts` : colonne Origine, libellé ECUE/cours, cohorte (FR-031)
- [X] T045 [P] [US4] Test d'invariant : `total(academique) + total(professionnel) === total(all)` sur un jeu mixte (SC-007)

**Checkpoint**: traçabilité complète, du calcul au PDF.

---

## Phase 6: US5 — Espace enseignant (P3)

**Goal**: transparence côté enseignant.

**Independent Test**: un enseignant ne voit que ses propres séances et paiements.

- [X] T046 [US5] `routes/professional-remuneration.ts` : `GET /my/seances`, `GET /my/payments` — `teacher_id` **dérivé du jeton**, aucun paramètre d'enseignant accepté (FR-032)
- [X] T047 [US5] `apps/web/src/app/professionnel/…` (espace enseignant) : écran « Mes Rémunérations » — séances validées de la période, valorisation, état du paiement (provisoire tant que non approuvé)
- [ ] T048 [P] [US5] Test d'isolation : un enseignant A ne peut pas lire les séances ni les paiements d'un enseignant B, même en forgeant la requête

**Checkpoint**: boucle complète, administration et enseignant.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T049 [P] `scripts/seed-remuneration-professionnelle.js` : 3 enseignants (horaire, salarié, mixte), 6 séances dont une annulée / une sans horaires / deux non validées, 2 tarifs (générique + nominatif), 1 période couvrante
- [ ] T050 Comparer un calcul **avant/après** `0103` sur une période de référence et documenter l'écart attendu (le chemin horaire académique aboutit désormais, cf. E4) — consigner dans `quickstart.md`
- [ ] T051 [P] Documenter la feature (`docs/`) et écrire la mémoire projet [[remuneration-professionnelle-031]] ; relier [[payment-hour-details-fk-defect]]
- [ ] T052 Exécuter le parcours complet de `quickstart.md` et `pnpm --filter @ecoledigitale/api test -- payment` (toutes suites vertes — SC-009)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 0** : bloquante — T006/T008a/T008b dépendent du constat T002 (état réel des contraintes) et T003–T010 de l'arbitrage T002b (quel `0011` fait foi).
- **Phase 1** : dépend de Phase 0. La DB (T003–T010) précède les services ; les contrats (T011–T013) précèdent l'API. **BLOQUE toutes les US.**
- **US1 (Ph2)** : après Ph1. Indépendante du calcul.
- **US2 (Ph3)** : après Ph1 **et** US1 — sans validation de séance, le collecteur professionnel ne renvoie rien.
- **US3 (Ph4)** : après US2 (T025 est amorcé en US2 avec le seul repli sur le tarif par défaut ; US3 complète la résolution et le CRUD).
- **US4 (Ph5)** : après US2 (il faut des paiements à restituer).
- **US5 (Ph6)** : après US2 ; indépendante de US3/US4.
- **Polish (Ph7)** : après les US visées.

### Within Each User Story

- Services avant routes ; routes avant écrans web ; tests en fin de story.

### Parallel Opportunities

- T011/T012 (contrats) ; T031–T034 (tests de calcul) ; T042/T043/T044 (écrans et PDF) ; T021, T039, T045, T048 (tests) — tous parallélisables.

---

## Implementation Strategy

### MVP (US1 + US2)

1. Phase 0 constat → Phase 1 DB + contrats — **critique**.
2. US1 (validation des séances) → valider : la source d'heures est fiable.
3. US2 (calcul unifié) → valider : **un enseignant professionnel est payé**.

À ce stade la feature tient sa promesse ; tout le reste est du raffinement.

### Incrémental

US3 (tarification fine), puis US4 (traçabilité et rapports), puis US5 (espace
enseignant), chacune testable seule, puis Polish.

---

## Notes

- **Migration `0103` additive et idempotente** — rejouable, aucun `DROP TABLE`.
  Réversible **avant** le premier calcul, irréversible après (des lignes de
  détail professionnelles sans `teaching_hours_id` existent alors).
- **Défauts préexistants corrigés** : E4 (FK inopérante), E5 (colonne hors schéma
  versionné), E6 (devise), plus **E7 et E8 découverts au constat** (contraintes
  d'unicité et d'anti-chevauchement déclarées par `0011` mais absentes en base).
  Documenter le changement de montants académiques attendu (T050).
- **E9 non tranché** : deux fichiers `0011_*` divergents, aucun ne décrivant
  l'état réel de la base (T002b).
- **Changement de comportement** : `/teacher-payments/calculate` sans `scope`
  inclut désormais le professionnel. `scope: "academique"` restaure l'ancien.
- **Aucun backfill** : les séances existantes restent `planifiee`, non validées.
