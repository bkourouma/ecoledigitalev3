# Plan d'implémentation — 010-attendance

**Entrées** : `spec.md`, `data-model.md`, `parity.md`, `specs/v2/004-academic-core/open-questions.md`. **Phase du plan** : 2, tranche 2.3 (avec 017) ; le hors-ligne se finalise en phase 6 (spec 029). **Taille globale** : L (≈ 24 j·agent). Module : `apps/api/src/modules/attendance/` ; contrats : `packages/contracts/src/v2/attendance.ts` ; migrations **0900-0903** (plage 0900-0999). Ordre global : `specs/v2/004-academic-core/plan.md` §1.

## 1. Tâches

| ID | Tâche | Livrables | Dépend de | Taille |
|---|---|---|---|---|
| 010-T0 | Caractérisation (tranche 2.0) | jeux figés : appel + justification Professional (`basculerSeanceRealisee`, `justifier`), récapitulatif « N heures dont M justifiées », comptages S1/S2 ; seed de présences | — | M |
| 010-T1 | Squelette + migrations 0900-0903 | module `attendance` (manifeste, `index.ts` stubs), SQL identique à `data-model.md`, conformité colonnes↔types, isolation générique | 000 | S |
| 010-T2 | Contrats Zod | `contracts/v2/attendance.ts` : séances, pointages, justificatifs, récapitulatifs, congés, événements `{ v: 1 }`, formats de synchronisation hors-ligne | — | M // |
| 010-T3 | Domaine pur | machines d'états (séance, justificatif, congé) ; application/révocation d'une excuse sur une fenêtre ; comptages par famille de statut ; récapitulatif effectif (surcharge) ; fenêtre d'édition ; résolution de conflits hors-ligne ; contrôle des octets magiques | — | L // |
| 010-T4 | Repositories | séances, pointages (upsert en lot), justificatifs, pièces, récapitulatifs, surcharges, personnel, congés, référentiels ; recalcul SQL `summarize_enrollment` | T1 | M // |
| 010-T5 | Use cases appel | `openAttendanceSession` (idempotent), `markStudentRecords` (roster, statuts, lot), `markWithJustification`, `submit/validate/reopen/cancel`, événements d'absence/retard, `bulkMarkFromExternal`, `syncOfflineAttendance` | T3, T4, ports `AcademicQuery`, `PeopleQuery`, `SchedulingQuery` | L |
| 010-T6 | Use cases justificatifs | dépôt (tuteur/élève/personnel), pièces (`StoragePort`, URL signées), `accept/reject/withdraw/revoke` (réglage `attendance.excuse_apply`), application aux saisies futures | T3, T4 | M |
| 010-T7 | Récapitulatifs et rapports | `getAttendanceSummary`, `getClassroomAttendanceSummary`, surcharge, `recomputeSummaries` (consommateur + job), `listAbsences`, `getCallCompliance`, `getAttendanceCertificateData` | T4, T5 | M |
| 010-T8 | Personnel | `markStaffAttendance`, check-in/out, congés (`request/approve/reject/cancel`), `getStaffAttendanceSummary` | T3, T4 | M |
| 010-T9 | Consommateurs | `scheduling.occurrence.cancelled`, `academic.enrollment.withdrawn|cancelled|transferred`, `academic.period.closed|reopened`, `tenancy.tenant.provisioned` (référentiels) | T5 | S |
| 010-T10 | HTTP + manifeste + permissions | `/api/v1/attendance/*`, `/me`, `/children` ; permissions sensibles (`session.reopen`, `summary.override`, `leave.decide`) ; features `attendance.staff`, `attendance.offline`, `attendance.live-bridge` | T2, T5-T8 | M |
| 010-T11 | Modèle de pack | `statusDefinitions`, `justificationReasons`, `leaveTypes`, `callPolicies`, `settings` + schéma Zod + instanciation idempotente | 004-T10 | S // |
| 010-T12 | Tests | unitaires, intégration (21 comportements SQL, rejeu hors-ligne, décision atomique, verrou), sécurité (pièce médicale, parent/élève, aucun `GET` n'écrit), contrat (`getAttendanceSummary` ↔ 013, `occurrence_id` ↔ 017), performance, e2e mobile | toutes | L |
| 010-T13 | Écrans web mobile-first + squelette PWA | faire l'appel, séances du jour, suivi, justificatifs, récapitulatif de classe, présence du personnel, paramètres ; file hors-ligne (IndexedDB) | T10 ; 029 | L |
| 010-T14 | Suppression du legacy (tranche 2.3) | `attendance_sessions`, `student_attendance`, `teacher_attendance_sessions/records`, `professional_ecue_attendance`, `student_period_attendance_summaries`, `attendance_reports` ; routes `attendance.ts`, `teacher-attendance.ts`, `attendance-reports.ts`, parties présence de `professional.ts` ; DDL à la volée ; pont LiveKit réécrit sur `bulkMarkFromExternal` | T12 vert, 017 branché | M |

## 2. Jalons

| Jalon | Contenu | Critère |
|---|---|---|
| J1 | T1-T4 | Migrations + domaine + repositories ; isolation |
| J2 | T5 + T9 | Appel complet de bout en bout avec un simulacre de scheduling ; événements |
| J3 | T6 + T7 + T8 | Justificatifs, récapitulatifs, personnel ; matrice de sécurité |
| J4 | T10 + T11 | API complète ; modèle de pack ; parité de scénarios |
| J5 | T12 + T13 | E2E mobile ; perf ; revue sécurité |
| J6 | T14 | Legacy supprimé ; inventaire régénéré |

## 3. Interfaces à figer le jour 1

`attendance/index.ts` (stubs typés de la spec §7), DTO `AttendanceSummaryView` (comptages bruts, effectifs), événements (`absence.recorded`, `session.submitted`…), codes `attendance.*`, format de lot de synchronisation. 013 (bulletins) et 017 (HELD) compilent contre ces stubs.

## 4. Câblage

`createAttendanceDeps({ db, clock, audit, ports: { academic, people, scheduling, storage } })` ; `attendancePlugin` ; worker : consommateurs d'événements, job `attendance.recompute-summaries` (reprise complète à la demande), job de rappel « appels non soumis » (événement `attendance.call.overdue` consommé par 016/025 — hors v1 si non demandé).

## 5. Demandes de changement vers d'autres specs

| Cible | Changement |
|---|---|
| 017 | Consommer `attendance.session.submitted` pour `HELD` ; exposer `getOccurrence` ; annuler les appels via `scheduling.occurrence.cancelled` |
| 004 | `getRoster(classroom, onDate, nodeId)` ; événements `academic.enrollment.withdrawn|cancelled|transferred` ; `getAcademicPeriod`/`resolvePeriodForDate` |
| 008 / 009 | `isGuardianOfStudent`, `getStudentsByIds`, `isStaffAssignedToClassroom`, `getStaffByIds` |
| 013 | Lire `getAttendanceSummary` ; invalider sur `attendance.summary.recomputed` ; fournir le texte « N heure(s) d'absence dont M justifiée(s) » côté gabarit |
| 016 | Consommer `attendance.absence.recorded`/`late.recorded` pour les notifications aux tuteurs (canaux, gabarits, journal) |
| 025 | Tous les seuils (20 %, 60 %, 70/40, 85/70…) deviennent des configurations alimentées par `period_summaries` et par les événements |
| 022/023 | Appeler `bulkMarkFromExternal` ; le seuil de présence (50 % du temps) est leur configuration |
| 024 | Remplacer le stockage des pièces par `document_ref` ; antivirus |
| 029 | Contrat de synchronisation hors-ligne |
| 002 | Permissions sensibles et modèles de rôle (`attendance.take` pour l'enseignant…) |
| 032 | Lire les congés approuvés (`listStaffLeaves`) |

## 6. Risques

| Risque | Gravité | Mitigation |
|---|---|---|
| Volumétrie des pointages (5 M/an/établissement) | Moyenne | Index ciblés, partitionnement par `session_date` prévu sans changement de contrat, requêtes de récapitulatif bornées par inscription |
| Perte de saisies hors-ligne / conflits | Haute (confiance) | Idempotence par `clientId`, file de conflits visible, tests de rejeu, ordre causal serveur |
| Pièces médicales exposées | Haute | Permission dédiée, URL signées courtes, octets magiques, aucune pièce dans les événements, audit des lectures |
| Divergence entre statut d'occurrence (017) et appel (010) | Moyenne | Un seul sens : l'appel soumis ⇒ `HELD` par événement idempotent ; annulation d'occurrence ⇒ annulation d'appel ; test de contrat |
| Modification d'une excuse sur appel validé détournée | Moyenne | Réglage `attendance.excuse_apply` posé uniquement par les cas d'usage de décision ; la base refuse tout autre champ (test) |
| Récapitulatifs obsolètes après réinscription/changement de classe | Moyenne | Recalcul à l'événement ; clé (inscription, période) ; `recomputeSummaries` complet |
| Attentes métier de seuils/équivalences logées dans le module | Moyenne | Interdit (R9) ; fournir les données et les événements ; RuleSets/configurations côté consommateurs |

## 7. Garde-fous CI spécifiques

Lint : aucun seuil/constante d'absentéisme ; aucune route sans `requirePermission` ; aucun `GET` qui écrit ; aucun stockage disque ; aucun `x-user-id`. Test d'architecture : toute écriture sensible appelle `audit.record`. Tests de contrat : 013, 016, 017 contre les stubs.

## 8. Définition de terminé

Critères `spec.md` §15 verts ; `parity.md` sans ligne à reproduire non couverte ; quatre systèmes legacy supprimés ; fonctionnement hors-ligne de l'appel démontré (phase 6) ; documentation de câblage publiée.
