# Interfaces publiées et exigences croisées (specs 011, 012, 013, 019, 032)

**Statut** : Rédigé. Ce document rassemble, pour les architectes des specs **004, 008, 009, 010, 014/015, 017** et pour le **worker** / la **plateforme**, (1) ce que les modules `assess`, `results`, `rules`, `reportcards`, `higher`, `payroll` **publient** (API publique `index.ts`, événements, jobs, ports) et (2) ce qu'ils **exigent** de leurs voisins. Les noms d'événements des autres modules sont des **hypothèses de travail** (marquées ⚠) à aligner avec leurs specs.

Conventions : références inter-modules par **UUID sans clé étrangère** (hors `kernel.tenants`) ; événements `<module>.<entité>.<verbe-passé>`, payload `{ v: 1, … }` écrit dans l'outbox (ADR-004) ; abonnés idempotents (`idempotent()` du worker SDK) ; plages de migrations proposées : `rules` 1000-1099, `assess` 1100-1199, `results` 1200-1299, `reportcards` 1300-1399, `higher` 1400-1499, `payroll` 1500-1599 (à inscrire dans `module-conventions.md`).

## 1. API publique des modules (consommée par d'autres modules)

| Module | Fonctions publiques (sélection) | Consommateurs |
|---|---|---|
| `rules` | `resolve`, `loadVersion`, `evaluate`, `evaluateMany`, `getContract`, `requestSimulation`, `recordSimulationReport` | `results`, `higher` (jamais le moteur directement) |
| `assess` | `lockPeriodGrades(tx, { classroomId, periodId, sessions })`, `releaseSessionLock`, `listPublishedGrades({ classroomId, periodId, nodeIds?, sessionNo? })`, `listPendingAssessments(classroomId, periodId)` | `results`, `higher` (déverrouillage session 2) |
| `results` | `getFinalResult(enrollmentId, periodId)`, `listFinalLines(stateId, level?)`, `getYearResult`, `listResitCandidates(classroomId, periodId)`, `openResitSession(stateId)`, `closePeriod`, `explain(resultId)`, `getDeliberation(stateId)`, `getAppreciations(stateId, enrollmentId)` | `reportcards`, `higher`, tableaux de bord (025/owner) |
| `reportcards` | `DocumentSealer.seal({ kind, snapshot })`, `DocumentRenderer.render(...)`, `registerVerification`, `getSignatory`, `getBranding`, `listPublishedForStudent` | `higher` (documents officiels), `payroll` (bulletin de paie), 024 |
| `higher` | `checkPrerequisites(studentId, ueNodeId)`, `getCreditSummary(studentId)`, `listDebts(studentId)`, `listAcquiredUe(studentId)` | 004 (inscriptions), `reportcards` (relevé cumulé), 025 |
| `payroll` | `isPayable`, `retainedMinutes` (prédicat unique), `getPayslipSummaryForOwner` | tableaux de bord owner, 014 |

## 2. Événements publiés

| Événement | Producteur | Payload (extrait) | Consommateurs attendus |
|---|---|---|---|
| `assess.assessment.created/submitted/reviewed/approved/cancelled` | assess | `assessmentId, classroomId, periodId, nodeId, status` | notifications (016), tableau de bord |
| **`assess.grade.published`** | assess | `assessmentId, classroomId, academicPeriodId, curriculumNodeId, sessionNo, enrollmentIds[]` (aucune note) | **`results` (recalcul coalescé)**, 016 (famille), 025 |
| `assess.grade.revised` | assess | `assessmentId, gradeId, enrollmentId, revisionId, kind` | `results`, 016 |
| `assess.period.locked/unlocked` | assess | `classroomId, academicPeriodId, lockedSessions` | `results` |
| `results.period_result.computed` | results | `enrollmentId, academicPeriodId, resultId, version, status` | 025 |
| `results.period.locked/deliberated/closed/reopened` | results | `classroomId, academicPeriodId, stateId, closureHash, resultsVersion, reopenKind?` | `reportcards`, `higher`, 016, 025 |
| `results.decision.confirmed` | results | `enrollmentId, scope, kind, finalCode, outcome` | **004 (progression : passe / redouble)**, `higher`, `reportcards` |
| `results.override.approved/revoked` | results | `overrideId, enrollmentId, periodId` | `results`, audit |
| `rules.version.proposed/approved/published/retired/rejected` | rules | `ruleVersionId, ruleSetCode, effectiveFrom, origin` | console super-admin, `results` (alerte de retard de version) |
| `rules.simulation.requested/completed` | rules | `simulationId, versionId, dataset` | `results` |
| `rules.binding.changed`, `rules.replay.mismatch` | rules | … | `results`, exploitation |
| `reportcards.report_card.issued/rendered/published/superseded/revoked` | reportcards | `reportCardId, enrollmentId, studentId, periodId, kind, version` | 016 (notification famille), 025, audit |
| `reportcards.batch.completed`, `reportcards.integrity.mismatch` | reportcards | … | direction, exploitation |
| `higher.credits.capitalized/revoked` | higher | `studentId, ueNodeId, credits, yearId, via, sessionObtained` | `higher` (éligibilité), 025, 016 |
| `higher.ue.debt_detected` | higher | `studentId, ueNodeId, periodId` | **004 (proposition de ré-inscription)**, 016 |
| `higher.resit.window_opened/closed/registered` | higher | `windowId, classroomId, periodId, nodeIds[]` / `registrationId, enrollmentId, nodeId` | `assess`, **014 (frais de rattrapage éventuels)**, 016 |
| `higher.diploma.eligible/awarded/revoked`, `higher.document.issued` | higher | `awardId, studentId, definitionId, reference, via` | `reportcards` (rendu), 016, 025 |
| `payroll.period.*`, `payroll.run.completed`, `payroll.payslip.calculated/approved/disputed/cancelled` | payroll | `payslipId, staffId, periodId, amount, currency` | 016, owner |
| **`payroll.payslip.paid`** | payroll | `payslipId, staffId, amount, currency, paidAt, method, reference` | **014/015 (décaissement, dépense, trésorerie)**, 016, 025 |
| `payroll.claim.source_changed`, `payroll.session.validated/unvalidated` | payroll | `sourceKind, sourceRefId` | gestion (alerte) |

## 3. Événements consommés (⚠ à confirmer avec leurs producteurs)

| Événement ⚠ | Producteur | Consommé par | Usage |
|---|---|---|---|
| `academic.enrollment.created/transferred/withdrawn` | 004 | `results`, `higher` | recalcul de classe, périmètre de lot, étudiants du cycle |
| `academic.academic_year.closed` | 004 | `payroll` | clôture des périodes de paie de l'année |
| `scheduling.session.cancelled/updated/deleted` | 017 | `payroll` | invalider une validation non réclamée ; alerter si réclamée |
| `attendance.teacher_session.completed/updated` | 010 | `payroll` | information de rafraîchissement (la lecture reste par port) |
| `people.staff.deactivated` | 009 | `payroll` | indicateur d'enseignant inactif |
| `people.student.guardian_changed` | 008 | `reportcards`, `assess` | invalidation des accès tuteurs (les droits sont revérifiés à chaque lecture) |
| `finance.invoice.paid` / `finance.invoice.overdue` | 014 | `reportcards` (option « bloquer si impayé » via port de lecture du solde) | politique d'accès au bulletin (Q-13) |
| `tenancy.tenant.provisioned` | tenancy | `assess` (types du pack), `results`, `rules` (liaisons par défaut), `payroll` (réglages), `reportcards` (gabarits par défaut), `higher` (compteurs) | amorçage par pack |

## 4. Ports déclarés par les modules (implémentés par les modules voisins)

| Port (déclaré par) | Contrat minimal | Fournisseur |
|---|---|---|
| `CurriculumReader` (`results`, `higher`) | Arbre de nœuds par programme/niveau/période ; attributs : type de nœud, parent, code, libellé, `credits`, `coefficient`, `grading_mode` (`COMPOSED`/`DIRECT`), `resit_allowed`, `counts_in_average`, `category`, `ordre`, `terminal_exam_required` (programme/niveau) | **004** |
| `PeriodReader` (`results`) | Période : type, rang dans l'année, dates, année | **004** |
| `EnrollmentDirectory` (`results`, `higher`, `reportcards`) | Inscriptions actives d'une classe × année ; élève ; statut ; classe ; niveau | **004 / 008** |
| `CourseRegistrationReader` (`results`) / `registerCourse` (`higher`) | UE/ECUE effectivement suivies par une inscription (régulières, rattrapage, électives, à la carte) ; création d'une inscription de rattrapage/dette | **004** (registre d'inscriptions aux cours) |
| `TeachingAssignmentPort` (`assess`) | L'enseignant enseigne-t-il ce nœud dans cette classe ? | **009 / 004** |
| `GuardianshipPort` (`assess`, `results`, `reportcards`, `higher`) | Un utilisateur est-il tuteur (lié, non révoqué) d'un élève ? | **008** |
| `AttendanceSummaryPort` (`reportcards`) | Absences justifiées / non justifiées d'un élève sur une période (minutes ou heures) | **010** |
| `SessionHoursPort` (`payroll`) | Séances d'une période : `sessionId`, enseignant réel, date, début/fin, statut (`PLANNED/HELD/CANCELLED`), nœud, classe + libellés, pack, `source` (`PLANNED/ACCOUNTING`) ; commandes `markHeld`, `markCancelled`, `createAdHocSession` ; `listExpectedWithoutSession(from, to)` | **017** |
| `TeacherAttendancePort` (`payroll`) | Présences enseignants `COMPLETED` : `attendanceId`, `sessionId?`, enseignant, date, durée en minutes, nœud, classe, pack | **010** |
| `StaffDirectoryPort` (`payroll`) | Personnel payable : id, nom, matricule, e-mail, statut, `userId` ; `getStaffByUserId` | **009** |
| `LearnerStandingPort` (`reportcards`) | Solde / état d'impayé d'un élève (sans détail) | **014** |
| `StoragePort` (`reportcards`, `higher`, `payroll`) | `put/get/exists/signedUrl` S3/MinIO, chiffré au repos | **000 / 024** (sinon livré par 013 : T-STORAGE) |
| `DocumentRenderer` / `DocumentSealer` (`higher`, `payroll`) | Rendu PDF, scellement, QR, index de vérification | **013** |

## 5. Exigences consolidées par spec voisine

### 5.1 Pour 004 (academic-core)
1. Attributs de nœud : `grading_mode`, `resit_allowed`, `counts_in_average`, `category`, `ordre`, `credits`, `coefficient` ; attribut de programme/niveau `terminal_exam_required` ; **nœud « cycle / diplôme »** racine de plusieurs niveaux (remplace la reconstitution par nom).
2. **Type et rang des périodes** (`second_semestre`, `semestre`, `trimestre`, `session`) sans lecture de libellé.
3. **Registre d'inscriptions aux cours/UE** (`academic.course_registrations`) : régulières, rattrapage, dette, électives, à la carte ; API `registerCourse`, `listRegistrations`.
4. Événements `academic.enrollment.*` et `academic.academic_year.closed`.
5. Consommation de `results.decision.confirmed` (progression) et de `higher.ue.debt_detected`.
6. Règles de **mutation de classe** en cours de période (Q-39).

### 5.2 Pour 008 (students-guardians)
`GuardianshipPort` ; identité d'impression (nom, prénoms, matricule, date et lieu de naissance, genre) ; matricule par programme/établissement si requis ; événement de changement de tutelle.

### 5.3 Pour 009 (teachers-staff)
`TeachingAssignmentPort` (qui enseigne quoi dans quelle classe) ; `StaffDirectoryPort` ; événement de désactivation ; lien compte ↔ membre du personnel.

### 5.4 Pour 010 (attendance)
`TeacherAttendancePort` (présences enseignants `COMPLETED`, durée en minutes, lien éventuel vers la séance) ; `AttendanceSummaryPort` (absences élèves par période) ; **identifiants stables**.

### 5.5 Pour 017 (scheduling)
Séance avec **identifiant stable** (un changement d'id ferait repayer des heures), `status` (`PLANNED/HELD/CANCELLED`), enseignant réel (remplacement compris), heures de début/fin nullables, nœud, classe, marqueur `source` ; API `markHeld/markCancelled/createAdHocSession` ; liste des créneaux attendus sans séance ; événements `scheduling.session.*`.

### 5.6 Pour 014/015 (finance, payments)
Consommer `payroll.payslip.paid` (décaissement / dépense) ; consommer `higher.resit.registered` (frais éventuels) ; exposer `LearnerStandingPort` ; **le paiement des frais d'inscription ne bloque plus la scolarité par masquage** (le legacy rendait l'inscription non soldée invisible de toute la scolarité) : la politique d'accès devient une configuration (Q-13).

### 5.7 Pour le worker / la plateforme
- **Jobs** : `results.recompute` (file coalescée, SKIP LOCKED), `results.close-batch`, `results.simulate-on-request`, `rules.replay` (échantillon nocturne), `reportcards.render` (Puppeteer, file équitable par tenant), `reportcards.integrity-check` (nocturne), `reportcards.snapshot-batch`, `higher.capitalize`, `higher.evaluate-diplomas` (abonné isolé), `payroll.calculate` (calcul volumineux), `payroll.render-payslip`, purges (`rules.evaluation_failures` 90 j, `results.recompute_requests` 30 j, anciens brouillons 90 j).
- **Image worker** : Chromium + polices embarquées pour Puppeteer ; conteneur sans route sortante pour le rendu ; secret `REPORTCARDS_SIGNING_KEY` (Ed25519) via secret d'exploitation.
- **Extensions Postgres** : `btree_gist` (contraintes d'exclusion `rules`, `higher`, `payroll`) — création par `migrator`.
- **Entitlements / features à déclarer** : `rules.variants`, `rules.expression-editor`, `rules.simulation`, `assess.session2`, `results.deliberation`, `results.public-visibility`, `reportcard.transcript`, `reportcard.public-verification`, `reportcard.block-unpaid`, `higher.diplomas`, `higher.session2`, `higher.prerequisites`, `higher.attestations`, `payroll.core`, `payroll.owner-validation`, `payroll.attendance-source`, `payroll.session-source`.
- **Allowlist d'isolation** (tables globales, justifications dans les `data-model.md`) : `rules.national_rule_sets/_versions/_definitions/_version_events`, `rules.platform_settings`, `reportcards.platform_templates`, `reportcards.signing_keys`, `reportcards.verification_index`.

### 5.8 Pour les specs 005, 006, 018 (primaire, secondaire, examens)
Réutiliser `assess` (types d'évaluation par pack, circuit de validation), `results` (états de période, décisions, délibérations — base du conseil de classe et du conseil des maîtres), `rules` (nouveaux contrats `coef-period@1` etc. **après obtention des textes officiels**, `012/regulatory-sources-needed.md`) et `reportcards` (gabarits primaire/secondaire génériques, à remplacer par les modèles officiels).
