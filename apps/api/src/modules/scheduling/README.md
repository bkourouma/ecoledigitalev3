# Module `scheduling` — emploi du temps et planification (spec v2/017)

Un seul agrégat « séance » (`session_occurrences`) pour cours, examens, réunions, réservations de salle et séances comptables ; des **patrons récurrents** qui génèrent des occurrences datées de façon idempotente ; des **conflits (enseignant, classe/offre, salle, équipement) imposés par la base** ; le **constat, la validation et le verrouillage des heures** pour la paie ; les vues par classe / enseignant / salle / élève / parent et l'export iCalendar.

Schéma Postgres `scheduling` (19 tables) · migrations `0950-0955` (plage 0950-0999) · préfixe HTTP `/api/v1/scheduling` · `dependsOn: ["rbac"]`.

## Structure

`domain/` (pur : chevauchement `[)`, récurrence, fuseau, `suggestSlots`, iCalendar, prédicat payable) · `application/` (cas d'usage `(deps, ctx, input) => Result`) · `infrastructure/` (SQL, traduction des erreurs de la base) · `http/` (routes, `requirePermission`) · `migrations/` · `subscribers.ts` / `jobs.ts` (worker) · `ports-registry.ts` · `index.ts` (API publique).

Les classes, offres, nœuds, périodes, personnel et tuteurs ne sont connus que par UUID, via les ports `AcademicQuery`, `PeopleQuery`, `AttendanceQuery` (`application/ports/`, implémentations en mémoire pour les tests). `academic`, `people` et `attendance` les enregistrent par `registerSchedulingPorts`. Sans `academic` : aucune écriture liée à une classe (échec fermé) ; sans `people` : pas d'avertissements de disponibilité ni de contrôle d'affectation.

## Garanties tenues par la base (0953, 0955)

- `resource_claims` (alimentée par déclencheurs `SECURITY DEFINER`, lecture seule pour l'application) + contrainte d'exclusion GiST : pas de double réservation d'un enseignant, d'une classe/offre ou d'une salle, même sous concurrence (`23P01` traduit en `409 scheduling.conflict_detected`). Politique `WARN` ou dépassement motivé ⇒ réservation non exclusive. Stock d'équipement sérialisé par verrou de ligne.
- Machine d'états, identité figée, aucune suppression d'occurrence ni de journal ; séance validée = horaire/statut/salle/intervenants figés ; heures verrouillées par la paie = séance intégralement gelée ; déverrouillage seulement par `releaseHoursLock`.
- Journal `occurrence_changes` automatique (qui, avant, après, motif).
- **0955** : pour les seules INSERTIONS, réservations et journal sont produits par des déclencheurs d'instruction à table de transition (une requête par lot, et non par ligne). Mesuré : 21 600 séances en ~40 s au lieu de ~165 s. Les UPDATE/DELETE gardent les déclencheurs par ligne de 0953.

## Interfaces consommées par les autres modules (`index.ts`)

- **Paie (032)** : `listPayableHours` (prédicat unique `HELD ∧ validée ∧ rôle rémunéré`, minutes = dérogation sinon durée), `lockHours` (atomique et exclusif : une ligne déjà verrouillée sous un autre `lockRef` fait échouer tout le lot, `scheduling.hours_already_locked`), `releaseHoursLock`, `createAccountingOccurrence`, `listExpectedWithoutOccurrence`, `holdOccurrence` / `cancelOccurrence` / `createOccurrence` (équivalents des `markHeld` / `markCancelled` / `createAdHocSession` de `011/interfaces-publiees.md` §5.5). Seule la paie appelle `lockHours` (test d'architecture).
- **Présences (010)** : `getOccurrence`, `listOccurrencesForStaff|Classroom`, `holdOccurrence` ; consomme `attendance.session.submitted` (charge `{ occurrenceId }`) ; `attendance` consomme `scheduling.occurrence.cancelled`.
- **Académique (004)** : `createAcademicScheduleConflictChecker(deps)` est **conforme** au port `ScheduleConflictChecker` déclaré par academic (`checkStudentOffering({ enrollmentId, offeringId }) → { conflicts: [{ description }] }`, échec ouvert, jamais bloquant) ; `createScheduleConflictChecker(deps)` est la version riche (`studentId`, `Result`, détails). Un test lit `academic/application/ports.ts` pour détecter toute dérive de signature. `AcademicQuery.getEnrollmentStudentId` résout l'inscription.

## Événements

Publiés : `scheduling.timetable.*`, `scheduling.occurrence.created|rescheduled|room_changed|staff_changed|held|unheld|cancelled|restored|validated|unvalidated|replacement_needed`, `scheduling.conflict.overridden`, `scheduling.calendar_event.*`, `scheduling.generation.completed` (liste exacte : `domain/events.ts`, vérifiée par test).
Consommés (abonnés `subscribers.ts`, idempotents par construction) : `attendance.session.submitted`, `attendance.staff_leave.approved`, `people.staff.status_changed`, `people.teaching_assignment.ended`, `academic.offering.cancelled`, `academic.classroom.cancelled`, `academic.year.closed`, `tenancy.tenant.provisioned`. Job : `scheduling.generate-occurrences` (02:30, par tenant, génération glissante).

## Tests

```bash
# unitaires (sans base)
pnpm exec vitest run --config apps/api/src/modules/scheduling/vitest.config.ts test/unit
# + intégration sur Postgres éphémère (Docker) — toute la suite (≈ 5 min, dont ≈ 1 min de performance)
ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --config apps/api/src/modules/scheduling/vitest.config.ts
# un seul fichier
ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --config apps/api/src/modules/scheduling/vitest.config.ts test/integration/payroll.integration.test.ts
pnpm --filter @ecoledigitale/api type-check:v2
```

| Fichier | Couvre |
|---|---|
| `unit/*` | chevauchement `[)`, récurrence A/B, fuseau et changements d'heure, `suggestSlots`, iCalendar, prédicat payable, contrat du module (manifeste, événements, garde-fous du code) |
| `integration/sql-guards` | les garanties de la base (conflits, équipement, états, validation, verrous, RLS) |
| `integration/occurrences` | création, conflits expliqués et imposés, **concurrence**, aperçu, report, remplacement, constat/annulation, déclaration par l'enseignant |
| `integration/generation` | patrons, publication, génération idempotente, jours bloquants, A/B, changement d'heure, plafond d'heures, propagation, clonage |
| `integration/payroll` | validation (lot partiel, quatre yeux), durée payée, heures payables, `lockHours` exclusif sur périodes qui se chevauchent |
| `integration/events-ports` | consommateurs, abonnés, job, `ScheduleConflictChecker` (riche et conforme à academic) |
| `integration/http` | routes, permissions, accès élève/parent/enseignant, iCalendar |
| `integration/isolation` | `assertTenantIsolation` sur les 19 tables (fixtures dans `isolation-allowlist.scheduling.ts`) + isolation de bout en bout |
| `integration/performance` | génération 40 × 30 × 18 < 60 s, vue de classe p95 < 200 ms, « Aujourd'hui » p95 < 150 ms, `suggestSlots` p95 < 800 ms ; `ED_PERF_FACTOR=2` relâche les seuils sur une machine lente |

**Statistiques Postgres.** Sur une base fraîchement chargée, sans `ANALYZE`, le planificateur croit les tables minuscules et peut choisir des plans quadratiques. Les déclencheurs de 0955 sont écrits pour ne pas en dépendre ; après un import massif (tranche 031), lancer `ANALYZE scheduling.session_occurrences, scheduling.occurrence_staff, scheduling.resource_claims`.

## Écarts avec la spec 017

- **Numérotation** : migrations `0950-0955` (plage du dépôt) au lieu de `1000-1003` ; **19 tables** (18 + `ics_tokens`, AC6.4) ; 0955 ajoute les déclencheurs en lot (performance).
- **Unicité de génération** sur `(patron, generated_for)` et non `(patron, date, heure)` : un report n'est pas régénéré à son créneau d'origine (question Q3 de `parity.md`). Colonne `replacement_reason` ajoutée.
- **Noms d'événements** : `scheduling.occurrence.*` (spec 017 §11) et non `scheduling.session.*` (hypothèse de `011/interfaces-publiees.md` §3) : la paie doit s'aligner sur 017. Les charges des événements d'autres modules sont alignées sur leurs producteurs (lecteurs `read*` de `application/consumers.ts`, test de contrat `apps/api/test/events-contracts/scheduling.test.ts`) : p. ex. `people.staff.status_changed` porte le nouveau statut dans `toStatus`.
- **Job « signalement des séances non constatées »** (plan §4) : remplacé par la lecture `listUnrealizedOccurrences` (aucun état à matérialiser).
- **Hors de ce module** (plan T15, T16, e2e Playwright) : écrans web, suppression du legacy, e2e. Les contrats Zod sont dans `packages/contracts/src/v2/scheduling.ts`.
