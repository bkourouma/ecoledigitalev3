# Module `scheduling` — emploi du temps et planification (spec v2/017)

Un seul agrégat « séance » (`session_occurrences`) pour cours, examens, réunions, réservations de salle et séances comptables ; des **patrons récurrents** qui génèrent des occurrences datées de façon idempotente ; des **conflits (enseignant, classe/offre, salle, équipement) imposés par la base** ; le **constat, la validation et le verrouillage des heures** pour la paie ; les vues par classe / enseignant / salle / élève / parent et l'export iCalendar.

Schéma Postgres `scheduling` (20 tables) · migrations `0950-0956` (plage 0950-0999) · préfixe HTTP `/api/v1/scheduling` · `dependsOn: ["rbac"]`.

## Structure

`domain/` (pur : chevauchement `[)`, récurrence, fuseau, `suggestSlots`, iCalendar, prédicat payable) · `application/` (cas d'usage `(deps, ctx, input) => Result`) · `infrastructure/` (SQL, traduction des erreurs de la base) · `http/` (routes, `requirePermission`) · `migrations/` · `subscribers.ts` / `jobs.ts` (worker) · `ports-registry.ts` · `index.ts` (API publique).

Les classes, offres, nœuds, périodes, personnel et tuteurs ne sont connus que par UUID, via les ports `AcademicQuery`, `PeopleQuery`, `AttendanceQuery` (`application/ports/`, implémentations en mémoire pour les tests). `academic`, `people` et `attendance` les enregistrent par `registerSchedulingPorts`. Sans `academic` : aucune écriture liée à une classe (échec fermé) ; sans `people` : pas d'avertissements de disponibilité ni de contrôle d'affectation.

## Garanties tenues par la base (0953, 0955)

- `resource_claims` (alimentée par déclencheurs `SECURITY DEFINER`, lecture seule pour l'application) + contrainte d'exclusion GiST : pas de double réservation d'un enseignant, d'une classe/offre ou d'une salle, même sous concurrence (`23P01` traduit en `409 scheduling.conflict_detected`). Politique `WARN` ou dépassement motivé ⇒ réservation non exclusive. Stock d'équipement sérialisé par verrou de ligne.
- Machine d'états, identité figée, aucune suppression d'occurrence ni de journal ; séance validée = horaire/statut/salle/intervenants figés ; heures verrouillées par la paie = séance intégralement gelée ; déverrouillage seulement par `releaseHoursLock`.
- Journal `occurrence_changes` automatique (qui, avant, après, motif).
- **0955** : pour les seules INSERTIONS, réservations et journal sont produits par des déclencheurs d'instruction à table de transition (une requête par lot, et non par ligne). Mesuré : 21 600 séances en ~40 s au lieu de ~165 s. Les UPDATE/DELETE gardent les déclencheurs par ligne de 0953.

## Générateur d'emploi du temps (O-05)

Réponse métier O-05 : « générateur complet dès maintenant ». À partir des **besoins** (classe × matière × séances par semaine × durée), des **disponibilités et plafonds des enseignants**, des **salles** (type, équipement, capacité), de la **grille horaire** et des **jours ouvrés**, le module construit une **proposition** d'emploi du temps hebdomadaire. Elle est **toujours un brouillon de calcul** : un humain l'examine, puis l'applique ; rien n'est publié et **aucun emploi du temps publié n'est jamais écrasé**.

Parcours : `POST /autogen/runs` (valide tout de suite, calcule dans la requête si la demande tient en ≤ 250 séances et ≤ 30 s de limite de temps, sinon met en file `QUEUED` et répond `202`) → job `scheduling.process-autogen-runs` (worker, chaque minute, par tenant) → `GET /autogen/runs/:id` (proposition, aperçu, non placés + causes) → `POST /autogen/runs/:id/apply` (acte humain) ou `/discard`. Écrans : `/v2/schedule/generator` (liste), `/new` (lancement et paramètres), `/:id` (aperçu par classe / enseignant / salle, conflits et points d'attention, application). Permissions : `schedule.read` (consulter), `schedule.manage` (lancer, appliquer, abandonner) ; fonctionnalité du plan `scheduling.generation`. Aucune nouvelle permission.

**Domaine pur** (`domain/autogen/`, sans base ni horloge implicite) :

- `engine.ts` — construction gloutonne (besoins les plus contraints d'abord, enseignants candidats en concurrence, salle = la plus petite suffisante comme `suggestSlots`), **réparation par éjection** d'une séance bloquante, puis **amélioration locale par recuit simulé** (déplacements, échanges). Budget en itérations (déterministe) **et** limite de temps (filet de sécurité : `stoppedBy = TIME_LIMIT` si elle coupe le calcul, auquel cas le résultat dépend de la vitesse de la machine).
- `prng.ts` — mulberry32 : **même graine ⇒ même emploi du temps** (à budget d'itérations atteint). La graine est enregistrée dans le run ; « relancer avec une autre graine » la retire.
- `verify.ts` — **vérificateur indépendant** du moteur : recalcule les violations dures et le coût souple depuis les seules séances placées. Il sert d'oracle aux tests de propriété et de **garde-fou avant d'enregistrer** une proposition (une violation fait passer le run en `FAILED`, jamais en `COMPLETED`).
- Contraintes **dures** (jamais violées) : aucune double occupation d'un enseignant, d'une classe ou d'une salle ; cases fermées (établissement, plage, salle) ; indisponibilités déclarées (règles hebdomadaires du personnel, selon le mode `OPEN`/`CLOSED` de l'établissement) ; plafonds de périodes par jour / semaine d'un enseignant ; séances sur périodes **consécutives** (jamais à cheval sur une pause) ; plafond de séances d'un besoin par jour ; salle du type, des équipements et de la capacité demandés ; occupation fixe d'un autre emploi du temps (`fixedTimetableId`).
- Contraintes **souples** pondérées (`weights`, réglables par demande) : trous des classes, trous des enseignants, répartition (même matière le même jour), équilibre des journées, créneaux évités / préférés (déclarations du personnel, heures préférées d'un besoin), changements d'enseignant pour une même matière.
- **Rapport des séances non placées** : par besoin, nombre manquant et causes classées (`CLASS_OVERLOADED`, `CLASS_BUSY`, `TEACHER_UNAVAILABLE`, `TEACHER_BUSY`, `TEACHER_LIMIT`, `NO_ROOM_CANDIDATE`, `ROOM_BUSY`, `SLOT_CLOSED`, `REQUIREMENT_DAY_CAP`, `NO_CONTIGUOUS_PERIODS`).

**Application** (`application/autogen.ts`) : `NEW_DRAFT` crée un nouveau brouillon ; `REPLACE_DRAFT` remplace le contenu d'un **brouillon** existant et exige `confirmReplace` ; un emploi du temps **publié** est refusé (`scheduling.autogen_would_overwrite_published`, même confirmé). Une proposition incomplète exige `acceptUnplaced`. Avant d'écrire : classes, matières, enseignants (statut) et salles sont revérifiés ; après : contrôle des conflits entre patrons. Le brouillon obtenu se publie par `publishTimetable` (acte distinct) ; si un emploi du temps est déjà publié pour la même année / période, il faut d'abord l'archiver (comportement existant de `timetables_one_published`).

**Persistance** (migration `0956`) : `scheduling.autogen_runs` (RLS), machine d'états et **proposition figée** par déclencheur (`QUEUED → RUNNING → COMPLETED → APPLIED | DISCARDED`, `FAILED`), aucune suppression. Événements : `scheduling.autogen_run.completed|failed|applied`. Audit : `scheduling.autogen_run.requested|completed|failed|applied|discarded`.

**Limites assumées** : semaine type unique (pas d'alternance A/B ni de dates : la génération des occurrences datées reste `generateOccurrences`) ; un seul enseignant (LEAD) par séance ; cours de classe entière (les offres à la carte ne sont pas générées) ; disponibilités du personnel lues comme règles **hebdomadaires** (les indisponibilités datées ne se projettent pas sur une semaine type) ; les besoins sont fournis par la demande (le port `AcademicQuery` ne liste pas les volumes horaires d'une classe) ; la proposition ne tient pas compte des salles réservées par des séances ponctuelles. Aucun jour férié, volume horaire ou règle officielle n'est codé : tout vient des paramètres de l'école et de la demande.

**Performance mesurée** (poste de développement, test `test/unit/autogen.test.ts`) : 40 classes × 30 séances (1 200 séances, 62 enseignants à 25 % d'indisponibilité, 40 salles), 150 000 itérations : quelques secondes au plus, quasi toutes les séances placées, aucun conflit dur.

## Interfaces consommées par les autres modules (`index.ts`)

- **Paie (032)** : `listPayableHours` (prédicat unique `HELD ∧ validée ∧ rôle rémunéré`, minutes = dérogation sinon durée), `lockHours` (atomique et exclusif : une ligne déjà verrouillée sous un autre `lockRef` fait échouer tout le lot, `scheduling.hours_already_locked`), `releaseHoursLock`, `createAccountingOccurrence`, `listExpectedWithoutOccurrence`, `holdOccurrence` / `cancelOccurrence` / `createOccurrence` (équivalents des `markHeld` / `markCancelled` / `createAdHocSession` de `011/interfaces-publiees.md` §5.5). Seule la paie appelle `lockHours` (test d'architecture).
- **Présences (010)** : `getOccurrence`, `listOccurrencesForStaff|Classroom`, `holdOccurrence` ; consomme `attendance.session.submitted` (charge `{ occurrenceId }`) ; `attendance` consomme `scheduling.occurrence.cancelled`.
- **Académique (004)** : `createAcademicScheduleConflictChecker(deps)` est **conforme** au port `ScheduleConflictChecker` déclaré par academic (`checkStudentOffering({ enrollmentId, offeringId }) → { conflicts: [{ description }] }`, échec ouvert, jamais bloquant) ; `createScheduleConflictChecker(deps)` est la version riche (`studentId`, `Result`, détails). Un test lit `academic/application/ports.ts` pour détecter toute dérive de signature. `AcademicQuery.getEnrollmentStudentId` résout l'inscription.

## Événements

Publiés : `scheduling.timetable.*`, `scheduling.occurrence.created|rescheduled|room_changed|staff_changed|held|unheld|cancelled|restored|validated|unvalidated|replacement_needed`, `scheduling.conflict.overridden`, `scheduling.calendar_event.*`, `scheduling.generation.completed`, `scheduling.autogen_run.completed|failed|applied` (liste exacte : `domain/events.ts`, vérifiée par test).
Consommés (abonnés `subscribers.ts`, idempotents par construction) : `attendance.session.submitted`, `attendance.staff_leave.approved`, `people.staff.status_changed`, `people.teaching_assignment.ended`, `academic.offering.cancelled`, `academic.classroom.cancelled`, `academic.year.closed`, `tenancy.tenant.provisioned`. Jobs : `scheduling.generate-occurrences` (02:30, par tenant, génération glissante) ; `scheduling.process-autogen-runs` (chaque minute, par tenant : calcule les propositions en file).

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
| `unit/autogen` | générateur : propriété « aucun conflit dur » sur 60 problèmes pseudo-aléatoires, oracle non trivial, déterminisme par graine, rapport des non placés, limite de temps, validation, performance 40 × 30 |
| `integration/autogen` | demande → proposition → application, publié jamais écrasé, confirmations, proposition figée par la base, reproductibilité, tâche asynchrone et job worker, échec / interruption, validations, **RLS A/B** |
| `integration/autogen-http` | routes `/autogen/*` : permissions, fonctionnalité du plan, 201/202, conformité au contrat, refus d'écraser un publié |
| `integration/isolation` | `assertTenantIsolation` sur les 20 tables (fixtures dans `isolation-allowlist.scheduling.ts`) + isolation de bout en bout |
| `integration/performance` | génération 40 × 30 × 18 < 60 s, vue de classe p95 < 200 ms, « Aujourd'hui » p95 < 150 ms, `suggestSlots` p95 < 800 ms ; `ED_PERF_FACTOR=2` relâche les seuils sur une machine lente |

**Statistiques Postgres.** Sur une base fraîchement chargée, sans `ANALYZE`, le planificateur croit les tables minuscules et peut choisir des plans quadratiques. Les déclencheurs de 0955 sont écrits pour ne pas en dépendre ; après un import massif (tranche 031), lancer `ANALYZE scheduling.session_occurrences, scheduling.occurrence_staff, scheduling.resource_claims`.

## Écarts avec la spec 017

- **Numérotation** : migrations `0950-0956` (plage du dépôt) au lieu de `1000-1003` ; **20 tables** (18 + `ics_tokens`, AC6.4 + `autogen_runs`, O-05) ; 0955 ajoute les déclencheurs en lot (performance) ; 0956 le générateur.
- **Unicité de génération** sur `(patron, generated_for)` et non `(patron, date, heure)` : un report n'est pas régénéré à son créneau d'origine (question Q3 de `parity.md`). Colonne `replacement_reason` ajoutée.
- **Noms d'événements** : `scheduling.occurrence.*` (spec 017 §11) et non `scheduling.session.*` (hypothèse de `011/interfaces-publiees.md` §3) : la paie doit s'aligner sur 017. Les charges des événements d'autres modules sont alignées sur leurs producteurs (lecteurs `read*` de `application/consumers.ts`, test de contrat `apps/api/test/events-contracts/scheduling.test.ts`) : p. ex. `people.staff.status_changed` porte le nouveau statut dans `toStatus`.
- **Job « signalement des séances non constatées »** (plan §4) : remplacé par la lecture `listUnrealizedOccurrences` (aucun état à matérialiser).
- **Hors de ce module** (plan T15, T16, e2e Playwright) : suppression du legacy, e2e. Les contrats Zod sont dans `packages/contracts/src/v2/scheduling.ts` ; le générateur a ses écrans sous `apps/web/src/app/v2/schedule/generator`.
- **O-05** : la spec 017 décrivait une aide au placement « pas un solveur » ; la réponse métier O-05 la remplace par le générateur ci-dessus, qui **étend** l'aide existante (`suggestSlots` : même choix de salle, mêmes règles de disponibilité).
