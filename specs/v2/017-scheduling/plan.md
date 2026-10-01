# Plan d'implémentation — 017-scheduling

**Entrées** : `spec.md`, `data-model.md`, `parity.md`, `specs/v2/004-academic-core/open-questions.md`. **Phase du plan** : 2, tranche 2.3 (planning, conflits) puis 2.7 (heures payables pour la paie). **Taille globale** : XL (≈ 32 j·agent). Module : `apps/api/src/modules/scheduling/` ; contrats : `packages/contracts/src/v2/scheduling.ts` ; migrations **1000-1003** (plage 1000-1099). Ordre global : `specs/v2/004-academic-core/plan.md` §1.

## 1. Tâches

| ID | Tâche | Livrables | Dépend de | Taille |
|---|---|---|---|---|
| 017-T0 | Caractérisation (tranche 2.0) | jeux figés : `DUREE_PAYEE_SQL` / `SEANCE_PAYABLE_PREDICATE`, `heures-consommees`, détection de conflit `sessions.ts:137-147`, rapprochement « séances manquantes », chevauchements validés | — | M |
| 017-T1 | Squelette + migrations 1000-1003 | module `scheduling`, SQL identique à `data-model.md`, conformité colonnes↔types, isolation, test des conflits en base | 000 | S |
| 017-T2 | Contrats Zod | `contracts/v2/scheduling.ts` : salles, équipements, patrons, occurrences, conflits (aperçu), heures payables, événements `{ v: 1 }` | — | M // |
| 017-T3 | Domaine pur | détection de chevauchement `[)` ; génération (récurrence EVERY/WEEK_A/WEEK_B, bornes, jours bloquants, plafond d'heures, fuseau) ; `suggestSlots` déterministe ; `suggestSubstitutes` ; machine d'états ; prédicat payable ; calcul des minutes ; explication des conflits ; export iCalendar | — | L // |
| 017-T4 | Repositories | salles, équipements, grille, calendrier, emplois du temps, patrons, occurrences (+ intervenants, équipements, journal), `find_conflicts`, `payable_hours` ; traduction du 23P01 (`resource_claims_no_overlap`) en erreur métier avec détail | T1 | M // |
| 017-T5 | Use cases référentiels | salles (statut), équipements, grille, calendrier, politiques de conflit, paramètres (fuseau, ouverture, quatre yeux) | T3, T4 | M |
| 017-T6 | Use cases emploi du temps | brouillon/publication/archivage/clonage, patrons (+ propagation), `generateOccurrences` (job, lots par semaine et classe, `generation_runs`), rapprochement `listUnrealizedOccurrences` | T3, T4, ports `AcademicQuery`, `PeopleQuery` | L |
| 017-T7 | Use cases occurrences | création (ponctuelle, examen, réservation, comptable), report, salle, intervenants, remplacement, constat/annulation/restauration, `previewConflicts`, `overrideConflict`, aide au placement, déclaration par l'enseignant | T3, T4 | L |
| 017-T8 | Validation et heures payables | `validateOccurrence(s)` (lot partiel), `unvalidate`, `setPaidMinutes`, `listPendingValidation`, `findValidatedOverlaps`, `listPayableHours`, `lockHours` / `releaseHoursLock` (atomique, exclusif) | T7 | M |
| 017-T9 | Vues et rapports | classe/enseignant/salle/élève/parent, « aujourd'hui », `getRoomOccupancy`, `getStaffWeeklyLoad`, `exportTimetableIcs` (jetons révocables) | T4, T7 | M |
| 017-T10 | Consommateurs d'événements | `attendance.session.submitted` (⇒ HELD), `attendance.staff_leave.approved`, `people.*` (remplacement nécessaire), `academic.offering.cancelled`, `academic.classroom.cancelled`, `academic.year.closed` | T7 | S |
| 017-T11 | Port pour academic | `createScheduleConflictChecker` (conflit d'horaire d'un apprenant à la carte) | T7 | S |
| 017-T12 | HTTP + manifeste + permissions | `/api/v1/scheduling/*` ; permissions sensibles (`occurrence.validate`, `conflict.override`, `hours.lock`) ; features | T2, T5-T9 | M |
| 017-T13 | Modèle de pack | `roomTypes`, `calendarEventKinds`, `conflictPolicies`, `settings` + schéma Zod + instanciation idempotente | 004-T10 | S // |
| 017-T14 | Tests | unitaires, intégration (22 comportements SQL, concurrence enseignant, `lockHours` exclusif sur deux périodes chevauchantes, génération idempotente), contrat (`listPayableHours` ↔ golden T0, ports), sécurité (SQL injection impossible, jetons iCal), performance, e2e | toutes | L |
| 017-T15 | Écrans web | constructeur d'emploi du temps (glisser-déposer, conflits en direct), génération, salles/équipements, calendrier, aujourd'hui, validation, remplacements, paramètres | T12 | L |
| 017-T16 | Remplacement du legacy (2.3, 2.7) | suppression de `session_instances`, `schedule-generation` (routes, services, contrats), `time_slots` clonée, `classrooms`, `classroom_reservations`, `academic_calendar_events`, `exam_schedules` (planning), `professional_emploi_temps`, `professional_course_plannings`, `professional_ecue_seances` (côté séance) ; `hour-collectors/{academic,professional}` remplacés par `listPayableHours` ; exports jsPDF → 024 | T14 vert, 032 branché | M |

## 2. Jalons

| Jalon | Contenu | Critère |
|---|---|---|
| J1 | T1-T4 | Migrations, domaine, repositories ; conflits imposés par la base testés |
| J2 | T5-T7 | Constructeur côté API ; génération idempotente ; occurrences et remplacement |
| J3 | T8 + T10 | Parcours « appel ⇒ HELD ⇒ validation ⇒ heures payables ⇒ verrou » avec simulacres de 010 et 032 |
| J4 | T9 + T11-T13 | Vues, ICS, port academic, API complète, modèle de pack |
| J5 | T14 + T15 | Golden verts ; e2e ; performance |
| J6 | T16 | Legacy supprimé ; paie sur `listPayableHours` |

## 3. Interfaces à figer le jour 1

`scheduling/index.ts` (stubs typés de la spec §7, **notamment** `listPayableHours`, `lockHours`, `releaseHoursLock`, `getOccurrence`, `previewConflicts`), DTO `OccurrenceView`, `PayableHourLine`, `ConflictView`, événements, codes `scheduling.*`. 010 et 032 compilent contre ces stubs dès la vague 3.

## 4. Câblage

`createSchedulingDeps({ db, clock, audit, ports: { academic, people, attendance? } })` ; worker : `scheduling.generate-occurrences` (à la demande), job quotidien `scheduling.flag-unrealized`, consommateurs d'événements ; `createScheduleConflictChecker` branché dans `createAcademicDeps` ; la paie (032) reçoit `listPayableHours`/`lockHours`/`releaseHoursLock` via l'`index.ts`, avec la permission `schedule.hours.lock` portée par un acteur `system`/rôle paie.

## 5. Demandes de changement vers d'autres specs

| Cible | Changement |
|---|---|
| 032-payroll-port | Verrouiller dès l'inclusion des heures dans un bulletin non annulé (pas seulement `approved`/`paid`) ; `releaseHoursLock` à l'annulation/au recalcul ; ne plus lire `teacher_attendance_sessions`, `professional_ecue_seances`, `payment_hour_details.seance_id` ; décider de `is_paid_role` des `SUPERVISOR` (O-06) |
| 010 | `attendance.session.submitted` doit porter `occurrenceId` ; consommer `scheduling.occurrence.cancelled` |
| 004 | `getRoster`, `getOffering`, `resolvePeriodForDate`, `getCurriculumNode` ; port `ScheduleConflictChecker` ; événements `academic.offering.cancelled`, `academic.classroom.cancelled`, `academic.year.closed` |
| 009 | `listAvailabilities`, `listCompetencies`, `isStaffAssignedToClassroom`, `getStaffByIds` |
| 002 | Permissions sensibles et modèles de rôle (économe : `schedule.occurrence.validate`, `schedule.accounting.create`) ; jeton d'abonnement iCalendar |
| 024 | Exports PDF/Word de l'emploi du temps depuis les vues de données |
| 022/023 | `virtual_session_ref` ; une séance ↔ 0..n classes virtuelles côté LMS |
| 003 | `CountryProfile.timezone` copié dans `settings.timezone` à la création de l'établissement |

## 6. Risques

| Risque | Gravité | Mitigation |
|---|---|---|
| Contrainte d'exclusion différée : erreurs tardives, verrous longs en génération massive | Haute | `SET CONSTRAINTS … IMMEDIATE` dans les cas d'usage ; lots par semaine et classe ; test de charge ; traduction du 23P01 |
| Double paiement d'une heure entre périodes chevauchantes | Haute | Verrou exclusif atomique `lockHours` ; test sur deux périodes ; contrat avec 032 |
| Modification d'une séance validée par un chemin oublié | Haute | Garde en base (déclencheurs) + tests ; journal automatique |
| Complexité du solveur attendue par les utilisateurs | Moyenne | `suggestSlots` + aperçu ; question O-05 ; périmètre explicite |
| Fuseau et dates (UTC vs local) | Moyenne | `settings.timezone`, tests de bornes (minuit, changements d'heure d'autres pays), `occurs_on` calculé côté domaine |
| Cohérence patrons ↔ occurrences après modification | Moyenne | `propagate` explicite, occurrences `HELD`/validées jamais réécrites, rapport de génération |
| Dépendances croisées (010 ↔ 017 ↔ 032) | Moyenne | Événements idempotents, stubs gelés, tests de contrat bilatéraux |
| Perte de fonctions Professional (grille Word/PDF, rapprochement) | Moyenne | `parity.md` ; exports → 024 ; `listUnrealizedOccurrences` |

## 7. Garde-fous CI spécifiques

Lint : aucun `Europe/Paris`/fuseau en dur, aucun créneau en dur, aucun SQL construit depuis des clés du corps, aucune route sans `requirePermission` ; test d'architecture : seul le rôle paie appelle `lockHours` ; test de non-régression « aucune séance validée modifiable » ; test de concurrence en CI.

## 8. Définition de terminé

Critères `spec.md` §15 verts ; `parity.md` sans ligne à reproduire non couverte ; paie (032) alimentée par `listPayableHours` ; legacy supprimé ; documentation de câblage et de contrat de paie publiée.
