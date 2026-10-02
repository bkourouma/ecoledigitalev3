# Feature Specification: Présences (010-attendance)

**Feature Branch**: `010-attendance`

**Created**: 2026-10-01

**Status**: Rédigée — prête pour `/speckit.plan`. Module backend `attendance` (schéma Postgres `attendance`, migrations 0900-0904 dans la plage 0900-0949). Implémenté : voir l'addendum §16. DDL, parité et plan dans le dossier.

**Sources**: `docs/PRD_EcoleDigitale_SaaS.md` §33, §34, §37, §43, §58-59 ; plan §3.7, §4 (tranche 2.3), §7 ; ADR-001, 002, 004, 006, 007 ; `docs/architecture/module-conventions.md` ; `rbac/templates/system-roles.ts` (`attendance.*`, `*.child.*`, `*.self.*`) ; legacy : `attendance_sessions` + `student_attendance`, `teacher_attendance_*`, `professional_ecue_attendance` (justificatifs 0100/0101), `student_period_attendance_summaries`, `attendance_reports`, `routes/attendance.ts`, `teacher-attendance.ts`, `semester-averages.ts`, `webhooks/livekit.ts`, `professional-seance-validation.service.ts`, `professional-seance-constat.ts` (inventaire exhaustif : `parity.md`).

> Le legacy contient **quatre systèmes de présence** indépendants, des récapitulatifs saisis à la main, aucune notification d'absence, aucune présence du personnel, aucun garde de rôle et une identité forgeable (`x-user-id`). Cette spec les remplace par **un modèle d'appel unique**. Elle ne calcule ni seuil ni équivalence : elle fournit des **comptages bruts** et des **événements**.

## 1. Objectifs

1. **Un seul modèle d'appel** : séance d'appel → pointages par inscription, pour l'appel journalier du primaire comme pour l'appel par séance du secondaire et du supérieur (y compris l'appel d'une offre à la carte).
2. **Justificatifs structurés** : motif codé, pièce contrôlée, **décision** (qui, quand, pourquoi), couvrant une fenêtre de dates ; l'absence justifiée n'existe plus sans justificatif accepté.
3. **Récapitulatifs dérivés** par inscription et par période (heures d'absence dont justifiées…), avec surcharge tracée — fin de la saisie libre.
4. **Présence et congés du personnel** (PRD §33, absents du legacy).
5. **Verrou et historique** : fenêtre d'édition, validation, réouverture motivée, journal de chaque changement de statut.
6. **Hors-ligne d'abord pour l'appel** (PRD §59) : synchronisation idempotente.
7. **Événements** pour les parents, la direction et le planning (notifications d'absence, constat de séance réalisée) — sans aucun seuil dans le module.

## 2. Périmètre

### Inclus

- Séances d'appel (`DAILY`, `SESSION`), pointages, statuts pilotés par données, justificatifs et pièces, récapitulatifs et surcharges, politique d'appel par cycle, paramètres de pièces jointes.
- Présence quotidienne du personnel, congés (demande, décision), statuts de personnel.
- Synchronisation hors-ligne, pont de présence externe (visio) sans écrasement des pointages manuels.
- Rapports : absences, conformité de l'appel (séances sans appel), données d'attestation de fréquentation.
- API `/api/v1/attendance/*`, contrats, événements, écrans mobile-first.

### Exclu (renvoyé à d'autres specs)

| Sujet | Spec |
|---|---|
| Constat « séance réalisée » (statut `HELD`), validation pour la paie, durée payée, heures payables | 017 (consomme `attendance.session.submitted`) |
| Rémunération, bulletins de paie | 032 |
| Calcul de conduite, déductions, équivalences retards/absences, avertissements | 012 (RuleSets) / 006 vie scolaire |
| Vie scolaire : incidents, sanctions, convocations | 006 (Phase 5) |
| Notifications aux parents (canaux, gabarits, journal d'envoi) | 016 (consomme les événements) |
| Tableaux de bord, alertes de seuil (20 %, 60 %…) | 025 |
| Attestation de fréquentation (PDF) | 013 / 024 (le module fournit les données) |
| Classes virtuelles (mesure du temps de connexion, seuil de présence) | 022/023 (appellent `bulkMarkFromExternal`) |
| Pointage biométrique, QR, badge | extensions futures (`source`) |

## 3. Acteurs

| Acteur | Rôle |
|---|---|
| Enseignant | Fait l'appel de ses séances (`attendance.take`), corrige dans la fenêtre |
| Instituteur (primaire) | Appel journalier de sa classe |
| Éducateur / vie scolaire | Appel, suivi, saisie de justificatifs, validation |
| Directeur des études / direction | Valide, rouvre (sensible), consulte les rapports, surcharge les récapitulatifs |
| Secrétariat | Enregistre les justificatifs reçus au bureau, décide |
| Parent / tuteur | Consulte les absences de ses enfants ; **dépose** un justificatif |
| Élève / étudiant | Consulte ses absences ; dépose un justificatif (si l'âge/la politique le permet) |
| Personnel | Consulte sa présence ; demande un congé ; (selon politique) pointe |
| Modules consommateurs | 017 (HELD), 013 (absences au bulletin), 016 (notifications), 025 (indicateurs), 032 (congés payés), 011 |

## 4. User Stories et critères d'acceptation

### US1 — Faire l'appel d'une séance (P1)

En tant qu'enseignant, je veux faire l'appel de ma séance en moins d'une minute, y compris depuis un téléphone.

- **AC1.1** `openAttendanceSession({occurrenceId})` crée la séance d'appel (ou renvoie l'existante : **idempotent**), copie classe, nœud, offre, date, durée de l'occurrence ; refuse si l'enseignant n'est pas un intervenant de l'occurrence ou affecté à la classe (`people.isStaffAssignedToClassroom`) et ne possède pas `attendance.manage`. Une seule séance d'appel par occurrence (contrainte).
- **AC1.2** Le roster provient de `academic.getRoster(classroom, onDate, nodeId)` (inscriptions `ACTIVE` + sélections `CONFIRMED`) ; un pointage pour un apprenant hors roster est refusé (`attendance.student_not_in_roster`) — le legacy ne vérifiait pas l'appartenance.
- **AC1.3** `markStudentRecords(sessionId, entries[])` enregistre en lot ; un statut inconnu ou désactivé est refusé ; `LATE` accepte `minutesLate` ; `EXCUSED` ne s'enregistre **pas** directement : il résulte d'un justificatif accepté (§US3), sauf `markWithJustification` par un rôle `attendance.justification.decide` (création + acceptation atomiques).
- **AC1.4** `submitAttendanceSession(sessionId, {defaultStatus:'PRESENT'})` exige que chaque membre du roster ait un pointage ; les non marqués reçoivent `defaultStatus` (parcours « tous présents sauf »). Il passe la séance à `SUBMITTED`, publie `attendance.session.submitted` et, pour chaque absent/retard, `attendance.absence.recorded` / `attendance.late.recorded` (une fois par pointage ; les corrections ultérieures republient avec `correction: true`).
- **AC1.5** Un appel sur un téléphone d'entrée de gamme : la requête de marquage de 60 élèves pèse < 20 Ko et p95 < 300 ms ; l'écran fonctionne hors-ligne (US6).
- **AC1.6** La séance d'une occurrence `CANCELLED` ne peut pas être ouverte ; l'annulation d'une occurrence annule la séance d'appel non validée (consommation de `scheduling.occurrence.cancelled`), et une séance déjà `VALIDATED` est annulée par réouverture motivée automatique (`reason = occurrence_cancelled`).

### US2 — Appel journalier du primaire (P1)

- **AC2.1** `openAttendanceSession({classroomId, date, scope:'DAILY'})` : une seule séance journalière par classe et par jour (contrainte) ; pas d'occurrence ni de nœud ; la politique d'appel du cycle (`call_policies`) détermine si l'appel est journalier, par séance, ou les deux.
- **AC2.2** `call_policies.daily_minutes` (donnée) convertit une absence journalière en minutes ; s'il est absent, `counted_minutes` reste nul et les récapitulatifs ne comptent que des jours.
- **AC2.3** L'instituteur (`HOMEROOM` de la classe) peut faire l'appel ; un remplaçant occasionnel désigné par la direction (`takenByStaffId`) aussi, avec traçabilité.

### US3 — Justifier une absence (P1)

En tant que parent, je veux justifier l'absence de mon enfant depuis mon téléphone.

- **AC3.1** `submitJustification({studentId, fromDate, toDate, reasonCode, comment?})` par un tuteur lié (`people.isGuardianOfStudent`), l'élève ou le personnel habilité ; la fenêtre ne peut pas dépasser l'année de l'inscription ni le futur au-delà de la date du jour (absences prévues : `attendance.justification.submit` avec `futureAllowed` de la politique).
- **AC3.2** `attachJustificationDocument` : type réel contrôlé par **octets magiques**, taille ≤ `settings.attachmentMaxBytes`, types ∈ `allowedAttachmentTypes`, empreinte SHA-256 conservée, stockage objet (jamais disque local) ; l'exigence de pièce (`requires_attachment` du motif) est vérifiée à la décision. Le téléchargement exige `attendance.justification.read` (+ être le déposant, un tuteur lié ou un rôle habilité) et passe par une URL signée courte.
- **AC3.3** `acceptJustification(id, note?)` (rôle `attendance.justification.decide`) applique l'excuse à tous les pointages `ABSENT`, `LATE`, `EARLY_LEAVE` de l'élève dans la fenêtre : `ABSENT → EXCUSED` (statut d'origine conservé), `LATE`/`EARLY_LEAVE` gardent leur statut avec `excused = true` ; la liste des pointages couverts est conservée ; les récapitulatifs concernés sont recalculés ; événement `attendance.justification.accepted`.
- **AC3.4** `rejectJustification(id, note obligatoire)` ; `withdrawJustification` par le déposant tant qu'il est `PENDING` ; `revokeJustification(id, motif)` restaure les statuts d'origine. Toute décision écrit auteur, date et note ; une décision ne s'efface pas.
- **AC3.5** Un pointage `ABSENT` saisi **après** l'acceptation d'un justificatif qui couvre sa date est excusé automatiquement (la fenêtre s'applique aux saisies futures) ; la couverture est visible dans le pointage.
- **AC3.6** Un élève/parent voit le **motif et la décision** (le legacy n'exposait ni motif ni pièce) ; le personnel enseignant ne voit que le statut (pas la pièce médicale) sauf `attendance.justification.read`.
- **AC3.7** Le legacy plantait (HTTP 500) si l'on changeait un pointage justifié : ce chemin est supprimé (contrainte `EXCUSED ⇒ justificatif accepté`, cas d'usage de révocation).

### US4 — Verrou, validation, correction (P1)

- **AC4.1** `validateAttendanceSession` (`attendance.validate`) fige la séance : plus aucun pointage modifiable (déclencheur) ; la fenêtre de correction d'une séance `SUBMITTED` est `call_policies.edit_window_minutes` (nulle = jusqu'à validation) ; passé le délai, seule une personne `attendance.manage` corrige.
- **AC4.2** `reopenAttendanceSession(id, reason)` (`attendance.session.reopen`, **sensible**, MFA) repasse en `SUBMITTED`, incrémente `reopened_count`, journalise et republie ; sans la permission, le réglage de transaction qui lève le verrou n'est pas posé et la base refuse.
- **AC4.3** Chaque changement de statut d'un pointage écrit `record_history` (auteur, avant/après) automatiquement : 100 % des changements sont retrouvés par `GET /sessions/:id/records/:rid/history`.
- **AC4.4** Aucun pointage ne peut être supprimé après soumission ; la suppression d'une séance d'appel n'existe pas (annulation motivée).

### US5 — Récapitulatifs dérivés et surcharge (P1)

- **AC5.1** `getAttendanceSummary({enrollmentId, periodId})` renvoie le **dérivé** (comptages : séances, présents, absences totales, dont justifiées, retards, retards justifiés, départs anticipés, non pointés ; minutes d'absence totales, dont justifiées, de retard) et, s'il existe, la **surcharge** `summary_overrides` avec son motif ; la valeur **effective** = surcharge sinon dérivé. Le texte « N heure(s) d'absence dont M justifiée(s) » du bulletin s'obtient sans calcul supplémentaire.
- **AC5.2** Le recalcul est idempotent : `recomputeSummaries` rejoué n'altère aucune valeur ; après `attendance.session.submitted|validated|reopened` ou un justificatif accepté/révoqué, le couple (inscription, période) concerné est à jour en < 5 s.
- **AC5.3** `setSummaryOverride` exige un motif ≥ 5 caractères, `attendance.summary.override`, vérifie `excused ≤ absent`, journalise (auteur, date) et publie `attendance.summary.recomputed` ; elle est retirée par `removeSummaryOverride` sans effacer l'historique.
- **AC5.4** Les périodes imbriquées (semestre > session) : le récapitulatif d'une période parente agrège ses dates ; aucune double comptabilisation.
- **AC5.5** `getClassroomAttendanceSummary({classroomId, periodId})` renvoie le tableau de toute la classe en une requête (p95 < 400 ms pour 60 inscrits).

### US6 — Hors-ligne et synchronisation (P2 — squelette en phase 2, finalisé en phase 6)

- **AC6.1** `syncOfflineAttendance(batch)` accepte des séances et pointages portant un `clientId` (UUID) ; rejouer un lot ne crée aucun doublon ; un pointage tardif sur une séance déjà `VALIDATED` est placé en **file de conflits** (liste pour arbitrage), jamais écrit.
- **AC6.2** Résolution : dernier arrivé gagne par pointage tant que la séance est `OPEN`/`SUBMITTED` ; le pointage manuel prime sur le pointage externe.
- **AC6.3** Le contrat de synchronisation (formats, versions, erreurs) est publié avec la spec 029 ; ce module garantit l'idempotence et l'ordre causal par `clientId` + horodatage appareil.

### US7 — Présence et congés du personnel (P2)

- **AC7.1** `markStaffAttendance` / `checkInStaff` / `checkOutStaff` : une ligne par (membre du personnel, jour) ; statuts `PRESENT`, `ABSENT`, `LATE`, `ON_LEAVE` (données) ; `ON_LEAVE` exige un congé approuvé.
- **AC7.2** `requestStaffLeave` → `approveStaffLeave` / `rejectStaffLeave` / `cancelStaffLeave` ; deux congés **approuvés** d'un même membre ne se chevauchent pas (contrainte) ; la décision est tracée ; événement `attendance.staff_leave.approved` consommé par 017 (séances de la période → `replacement_needed`).
- **AC7.3** Le statut du personnel (`ON_LEAVE`) n'est jamais modifié automatiquement par un congé (décision explicite côté 009) ; l'approbation publie l'événement seulement.
- **AC7.4** Le personnel consulte sa propre présence (`attendance.own.read`) ; la direction l'agrège (`attendance.staff.read`).

### US8 — Pont de présence externe (visio) (P2)

- **AC8.1** `bulkMarkFromExternal(sessionId, entries[{studentId, status, evidence}])` pour la visio (modules 022/023) : n'écrase **jamais** un pointage saisi par un humain ; `source = LIVE_CLASS` ; le seuil de présence (le legacy codait 50 % du temps connecté) est une **configuration du module visio**, pas d'ici.

### US9 — Rapports et conformité de l'appel (P2)

- **AC9.1** `getCallCompliance({from, to, institutionId?, staffId?})` : séances **planifiées passées sans appel soumis** par enseignant et par classe (taux d'appel) — donnée brute ; le seuil « enseignant sous appel » est de la configuration de 025.
- **AC9.2** `listAbsences(filters)` : liste paginée (≤ 200) par élève, classe, période, statut, justifié ou non ; export CSV limité à 5 000 lignes, audité (`report.export`).
- **AC9.3** `getAttendanceCertificateData(studentId, periodId)` fournit les données de l'attestation de fréquentation (nom, classe, période, comptages effectifs) à 013/024 ; le PDF n'est pas produit ici.

## 5. Règles métier

- R1 Statuts = données (`status_definitions`) : PRESENT, ABSENT, LATE, EXCUSED, EARLY_LEAVE (élèves) ; PRESENT, ABSENT, LATE, ON_LEAVE (personnel) ; un tenant peut ajouter, pas modifier la sémantique des statuts système. Le retard est une **présence** (il ne compte pas comme absence) ; l'absence justifiée **est** une absence (justifiée).
- R2 Un pointage appartient à une **inscription** (pas à une personne seule) : un changement de classe garde les pointages passés rattachés à l'inscription et à la séance ; l'élève nouvellement arrivé n'est pas compté « non pointé » avant son placement.
- R3 `EXCUSED` n'existe que par un justificatif accepté ; `excused` (booléen) l'indique pour un retard ou un départ anticipé justifié.
- R4 Un justificatif couvre une **fenêtre** ; sa décision est définitive sauf révocation motivée ; le déposant peut le retirer tant qu'il est en attente.
- R5 Une séance d'appel est unique par occurrence, ou par classe et par jour pour l'appel journalier.
- R6 Cycle : `OPEN → SUBMITTED → VALIDATED` ; correction `SUBMITTED → OPEN` ; réouverture `VALIDATED → SUBMITTED` (sensible) ; `CANCELLED`.
- R7 `counted_minutes` : durée de la séance pour une absence (ou `daily_minutes`), minutes de retard, minutes manquées pour un départ anticipé ; nul si inconnu (les comptages restent exacts).
- R8 Le récapitulatif ne compte que les séances `SUBMITTED` ou `VALIDATED` (une séance `OPEN` ne produit aucune absence).
- R9 Aucune règle de seuil, d'équivalence (« 3 retards = 1 absence »), de déduction ou de sanction dans le module ; ce sont des RuleSets/configurations des consommateurs.
- R10 Un pointage ne s'écrit que si l'élève est dans le roster à la date de la séance (inscription `ACTIVE`/sélection confirmée, selon `getRoster`).
- R11 Toute lecture « enfant » passe par `people.isGuardianOfStudent` ; « moi » par l'identité courante ; aucune confiance dans un en-tête client.
- R12 La visibilité des justificatifs est restreinte (pièce médicale) : déposant, tuteurs liés, rôles `attendance.justification.read`.
- R13 Le personnel : une présence par jour (sans séance) et, facultativement, par occurrence ; les congés approuvés ne se chevauchent pas ; `ON_LEAVE` exige un congé approuvé.
- R14 Toute opération sensible (réouverture, surcharge de récapitulatif, décision de justificatif, approbation de congé) est auditée dans la même transaction.

## 6. Modèle de données

Voir `data-model.md` (18 tables : 15 du DDL de référence + 3 de la migration 0904 ; migrations **0900-0904**, plage 0900-0949 inscrite dans `module-conventions.md`).

## 7. Interfaces publiées (`apps/api/src/modules/attendance/index.ts`)

| Fonction | Usage / consommateurs |
|---|---|
| `getAttendanceSummary(ctx, {enrollmentId, periodId})` → comptages bruts (dérivés + surcharge → effectif) | **013** (absences au bulletin), 011, portails |
| `getClassroomAttendanceSummary(ctx, {classroomId, periodId})` | 013, direction |
| `listAbsences`, `getCallCompliance`, `getAttendanceCertificateData`, `getStaffAttendanceSummary` | 025, 013, 024 |
| `openAttendanceSession`, `getAttendanceSession`, `listAttendanceSessions`, `markStudentRecords`, `markWithJustification`, `submitAttendanceSession`, `validateAttendanceSession`, `reopenAttendanceSession`, `cancelAttendanceSession`, `getRecordHistory` | UI, API |
| `syncOfflineAttendance`, `bulkMarkFromExternal` | PWA (029), visio (022/023) |
| `submitJustification`, `listJustifications`, `getJustification`, `attachJustificationDocument`, `getJustificationAttachmentUrl`, `removeJustificationAttachment`, `acceptJustification`, `rejectJustification`, `withdrawJustification`, `revokeJustification` | UI, portails |
| `setSummaryOverride`, `removeSummaryOverride` | direction |
| `markStaffAttendance`, `checkInStaff`, `checkOutStaff`, `requestStaffLeave`, `approveStaffLeave`, `rejectStaffLeave`, `cancelStaffLeave`, `listStaffLeaves` | UI, 032 (lecture des congés approuvés) |
| `upsertCallPolicy`, `upsertAttendanceSettings`, `upsertStatusDefinition`, `upsertJustificationReason`, `upsertLeaveType` + lectures | paramétrage |
| `recomputeSummaries(ctx, {enrollmentId?, periodId?})` (job/consommateur) | exploitation |

Ports consommés : `AcademicQuery` (`getRoster`, `getEnrollment`, `getAcademicPeriod`, `resolvePeriodForDate`), `PeopleQuery` (`getStudentsByIds`, `isGuardianOfStudent`, `isStaffAssignedToClassroom`, `getStaffByIds`), `SchedulingQuery` (`getOccurrence`), `StoragePort`. Repli : sans `SchedulingQuery`, seuls les appels `DAILY` et `SESSION` sans occurrence sont possibles ; sans `AcademicQuery`, aucune écriture (échec fermé).

## 8. Endpoints (`/api/v1/attendance`)

| Méthode | Chemin | Description | Permission |
|---|---|---|---|
| GET | `/sessions` | Séances d'appel filtrées (classe, date, statut, enseignant) | `attendance.read` |
| POST | `/sessions` | Ouvrir (occurrence ou journalier) | `attendance.take` |
| GET | `/sessions/:id` | Séance + roster + pointages | `attendance.read` / `attendance.take` |
| PUT | `/sessions/:id/records` | Marquer en lot | `attendance.take` |
| GET | `/sessions/:id/records/:rid/history` | Historique d'un pointage | `attendance.read` |
| POST | `/sessions/:id/{submit,validate,cancel}` | Cycle | `attendance.take` / `attendance.validate` |
| POST | `/sessions/:id/reopen` | Réouverture motivée | `attendance.session.reopen` (sensible) |
| POST | `/sync` | Synchronisation hors-ligne | `attendance.take` |
| POST | `/external-marks` | Pont visio | `attendance.manage` (service) |
| GET | `/students/:id/records`, `/students/:id/summary?periodId` | Pointages / récapitulatif | `attendance.read` |
| GET | `/classrooms/:id/summary?periodId` | Tableau de classe | `attendance.read` |
| PUT/DELETE | `/summary-overrides` | Surcharge tracée | `attendance.summary.override` |
| GET/POST | `/justifications` | Lister / déposer | `attendance.justification.read` / `.submit` |
| GET | `/justifications/:id` | Détail | idem |
| POST | `/justifications/:id/{accept,reject,revoke}` | Décision | `attendance.justification.decide` |
| POST | `/justifications/:id/withdraw` | Retrait par le déposant | `attendance.justification.submit` |
| POST/GET/DELETE | `/justifications/:id/attachments[/:aid]` | Pièces (URL signée en lecture) | `attendance.justification.submit` / `.read` |
| GET | `/staff/records` ; PUT `/staff/records` ; POST `/staff/check-in`, `/staff/check-out` | Présence du personnel | `attendance.staff.read` / `.record` |
| GET/POST | `/staff/leaves` ; POST `/staff/leaves/:id/{approve,reject,cancel}` | Congés | `attendance.leave.request` / `attendance.leave.decide` |
| GET | `/reports/absences`, `/reports/call-compliance`, `/reports/staff-summary` | Rapports | `attendance.report.read` |
| GET | `/me/attendance`, `/children/:studentId/attendance`, `/me/staff-attendance` | Portails | `attendance.self.read`, `.child.read`, `.own.read` |
| GET/PUT | `/reference/{status-definitions,justification-reasons,leave-types,call-policies,settings}` | Paramétrage | `attendance.read` / `attendance.settings.manage` |

Conventions : erreurs `attendance.*` stables ; entrées `strict` ; pagination ≤ 200 ; aucun `GET` n'écrit ; routes gardées par `requirePermission` (jamais par un rôle codé en dur).

## 9. Écrans

| Écran | Contenu | Rôles |
|---|---|---|
| Faire l'appel (mobile first) | Liste de la classe avec photos, bascule rapide Présent / Absent / Retard, « tous présents sauf », soumission, mode hors-ligne | Enseignant, instituteur |
| Mes séances à faire (tableau du jour) | Séances du jour sans appel, rappels | Enseignant |
| Suivi des appels | Séances non soumises/non validées, validation en lot, conformité | Direction, vie scolaire |
| Fiche d'absences d'un élève | Pointages, justificatifs, récapitulatif par période | Vie scolaire, parent, élève |
| Justificatifs | Dépôt (parent/élève), file de décision, pièce jointe, historique | Parent, secrétariat, direction |
| Récapitulatif de classe | Tableau par période, surcharge tracée | Direction des études |
| Présence du personnel | Pointage du jour, congés, calendrier des absences | RH, direction |
| Paramètres | Statuts, motifs, types de congé, politique d'appel, pièces acceptées | Direction |

## 10. Permissions

| Clé | Libellé | Sensible |
|---|---|---|
| `attendance.read` | Consulter les appels et les absences | |
| `attendance.take` | Faire l'appel (ses classes) | |
| `attendance.manage` | Corriger tout appel, ouvrir pour un tiers | |
| `attendance.validate` | Valider un appel | |
| `attendance.session.reopen` | Rouvrir un appel validé | oui |
| `attendance.justification.submit` | Déposer / retirer un justificatif | |
| `attendance.justification.read` | Lire justificatifs et pièces | |
| `attendance.justification.decide` | Accepter, rejeter, révoquer | |
| `attendance.summary.override` | Surcharger un récapitulatif | oui |
| `attendance.staff.read` / `attendance.staff.record` | Présence du personnel | |
| `attendance.leave.request` / `attendance.leave.decide` | Congés | `decide` : oui |
| `attendance.report.read` | Rapports | |
| `attendance.settings.manage` | Paramètres et référentiels | |
| `attendance.self.read` / `attendance.child.read` / `attendance.own.read` | Mes absences / celles de mes enfants / ma présence (personnel) | |
| `attendance.child.justify` / `attendance.self.justify` | **Ajoutées** : déposer un justificatif pour son enfant / pour soi (le rôle « parent » n'a que `*.child.*` : sans elles il ne pouvait pas déposer) | |
| `attendance.own.record` | **Ajoutée** : pointer sa propre présence (personnel) | |

Alignement avec les rôles système : enseignant `attendance.read`, `attendance.take` ; éducateur `attendance.*` ; directeur des études `attendance.*` ; responsable pédagogique `attendance.read` ; parent `*.child.*` ; élève `*.self.*`.

Features : `attendance.staff` (présence du personnel), `attendance.offline` (synchronisation, phase 6), `attendance.live-bridge` (pont visio). Les routes sont gardées par `requireFeature`. Les rôles système de rbac ne donnent pas encore `attendance.own.*` / `attendance.leave.request` au personnel : à ajouter au modèle de rôles (point à arbitrer).

## 11. Événements (outbox, `{ v: 1, … }`)

| Événement | Quand | Consommateurs |
|---|---|---|
| `attendance.session.opened` / `submitted` / `validated` / `reopened` / `cancelled` | cycle de la séance | **017 (`submitted` ⇒ occurrence `HELD`)**, 013, 025 |
| `attendance.absence.recorded` | par absent à la soumission (et correction) | **016 (notification aux tuteurs)**, 025 |
| `attendance.late.recorded` | par retard | 016, 025 |
| `attendance.justification.submitted` / `accepted` / `rejected` / `revoked` | décisions | 016, 013 |
| `attendance.staff_leave.requested` / `approved` / `rejected` / `cancelled` | congés | 017 (`approved` ⇒ séances à remplacer), 032 |
| `attendance.staff_absence.recorded` | absence du personnel | 017, 016 |
| `attendance.summary.recomputed` | recalcul d'un couple | 013 (invalidation), 025 |

Payloads sans donnée sensible (identifiants, statuts, dates ; jamais le motif médical ni la pièce). Consommés : `scheduling.occurrence.cancelled`, `academic.enrollment.withdrawn|cancelled|transferred`, `academic.period.closed|reopened` (verrou des récapitulatifs), `tenancy.tenant.provisioned` (référentiels). Idempotence par `event.id`.

## 12. Tests

- **Unitaires** : machine d'états (séance, justificatif, congé), application de l'excuse sur une fenêtre, comptages par famille de statut, récapitulatif effectif (surcharge), fenêtre d'édition, idempotence de la synchronisation.
- **Intégration** (Postgres) : les 21 comportements de `data-model.md` ; appel concurrent du même roster ; rejeu d'un lot hors-ligne ; recalcul idempotent ; décision de justificatif atomique ; verrou de validation ; congés non chevauchants.
- **Isolation générique** : 15 tables, allowlist vide.
- **Sécurité** : matrice parent/élève/enseignant × endpoints ; pièce médicale illisible par un enseignant sans `attendance.justification.read` ; faux type MIME refusé (octets magiques) ; aucun `x-user-id` pris en compte ; aucun `GET` n'écrit.
- **Contrat** : `occurrence_id` ↔ `scheduling.getOccurrence` ; événements validés par Zod ; `getAttendanceSummary` consommé par un simulacre de 013.
- **Parité** : scénarios figés du legacy (appel d'une séance Professional puis justification administrative, récapitulatif « N heures dont M justifiées ») rejoués.
- **Performance** : 60 pointages en lot p95 < 300 ms ; récapitulatif de classe p95 < 400 ms ; recalcul de 1 500 inscriptions < 30 s.
- **E2E (Playwright mobile)** : appel hors-ligne puis synchronisation ; parent justifie, direction accepte, l'absence passe « justifiée » ; réouverture sensible refusée sans MFA.

## 13. Cas limites

- Élève inscrit en cours de journée (roster à la date) ; élève qui change de classe entre deux séances ; élève `SUSPENDED` (reste dans le roster, politique de l'établissement).
- Occurrence déplacée après l'ouverture de l'appel : l'appel suit l'occurrence ; occurrence annulée après soumission : séance annulée (motif) et récapitulatifs recalculés.
- Deux enseignants ouvrent l'appel de la même séance : le second reçoit la séance existante ; les pointages se fusionnent par élève (dernier gagne tant que non validée).
- Justificatif décidé **après** la validation de l'appel : la séance validée reste figée, sauf une exception étroite — l'application ou la révocation d'une excuse (`ABSENT ⇄ EXCUSED`, drapeau `excused`) par `acceptJustification` / `revokeJustification`, qui posent le réglage de transaction `attendance.excuse_apply = on` ; tout autre champ (minutes, notes, heures) reste verrouillé (test dédié). Les récapitulatifs concernés sont recalculés.
- Fenêtre de justificatif qui chevauche une période académique `CLOSED` : l'excuse s'applique (l'assiduité n'est pas une note) et le récapitulatif est recalculé et republié (`attendance.summary.recomputed`) ; les consommateurs (013) décident s'ils régénèrent un bulletin — le récapitulatif d'un bulletin déjà figé est un instantané, il ne change pas.
- Justificatif rejeté puis redéposé pour la même fenêtre : nouvelle demande (l'historique garde la première).
- Appel sans aucun élève (classe vide) : soumission autorisée avec `allPresent: true`.
- Appareil avec horloge fausse : `clientId` + horodatage serveur à la réception ; l'ordre causal repose sur le serveur.
- Pièce jointe infectée/illisible : refus à l'upload ; hook antivirus (spec 024).
- Personnel qui pointe pour un jour de congé approuvé : statut `ON_LEAVE` imposé ; correction explicite.
- Tenant qui n'a ni appel ni outil : les récapitulatifs restent `unmarked`/vides ; la surcharge permet la saisie manuelle tracée.

## 14. Dépendances

- **En amont** : 000 (DB, outbox), 004 (roster, inscriptions, périodes), 008/009 (élèves, tuteurs, personnel, affectations), 017 (occurrences), 002 (RBAC, périmètres), 030 (audit), 024 (documents, ultérieur ; interim `StoragePort`).
- **En aval** : 013, 011, 016, 017, 025, 029, 032, 022/023.
- **Technique** : PostgreSQL 14+ (`btree_gist`), Zod, S3/MinIO, worker (recalcul, synchronisation), PWA (029).
- **Manifeste** : `key: "attendance"`, `packs: ["PRIMARY","SECONDARY","HIGHER","VIRTUAL"]`, `dependsOn: ["rbac"]` ; ports pour academic/people/scheduling (pas de cycle de manifeste).

## 15. Critères de sortie (mesurables)

1. Migrations 0900-0903 appliquées de zéro ; isolation générique verte sur les 15 tables avec deux tenants.
2. Appel complet d'une séance (ouverture → pointage → soumission → validation) : l'occurrence passe `HELD` dans scheduling (test de contrat), les absences sont notifiables (événements) ; réouverture refusée sans permission sensible.
3. Justificatif déposé par un tuteur, décidé par la vie scolaire : absence `EXCUSED`, récapitulatif « dont justifiées » exact, révocation restaure ; aucun `500` sur la séquence changement de statut / pièce jointe du legacy.
4. Récapitulatif d'une classe de 60 inscrits cohérent avec les pointages (comparaison SQL ↔ domaine) ; surcharge tracée.
5. Synchronisation hors-ligne : rejeu d'un lot = aucun doublon ; conflit sur séance validée en file.
6. Les quatre systèmes legacy (`attendance_sessions`/`student_attendance`, `teacher_attendance_*`, `professional_ecue_attendance`, `student_period_attendance_summaries`/`attendance_reports`) et leurs routes sont supprimés dans la tranche 2.3, avec ceux de scheduling ; aucune route sans garde de rôle ne subsiste.
7. Aucun seuil ni constante réglementaire dans `modules/attendance/**` (lint) ; couverture ≥ 90 % du domaine.

## 16. Addendum d'implémentation (2026-10-01) — corrections et précisions

Corrections d'incohérences de la spec par l'implémentation :

1. **Plage de migrations** : 0900-0949 (et non 0900-0999, 0950+ appartient à scheduling). Ajout de `0904_attendance_sync_alerts.sql` : tables `sync_ops` (registre d'idempotence), `sync_conflicts` (file de conflits), `alert_states` ; colonnes `student_records.client_marked_at`, `settings.allow_future_justifications`, `settings.alert_rules`, `summary_overrides.removed_by`, `justifications.revoked_by/at/reason`, `record_history.seq` (ordre total fiable : `changed_at` = début de transaction).
2. **Révocation d'un justificatif** : la décision d'acceptation (auteur, date, note) n'est plus réécrite ; la révocation est tracée à part (« une décision ne s'efface pas »).
3. **Permissions** : `attendance.child.justify`, `attendance.self.justify`, `attendance.own.record` ajoutées (voir §10).
4. **AC1.4 / E-16** : la soumission exige un pointage pour chaque élève du roster ; les non-marqués reçoivent `defaultStatus` (ou `allPresent`), sinon `attendance.unmarked_students`. Roster vide : soumission libre.
5. **Politique d'appel absente** : tout est permis (`BOTH`), aucune fenêtre de correction. Le modèle de pack par défaut ne crée de politiques que pour les établissements fournis à l'amorçage.
6. **Événements `academic.period.closed|reopened`** : la spec parlait de « verrou des récapitulatifs » alors que §13 exige qu'une excuse acceptée après clôture s'applique. Retenu : AUCUN verrou ; les récapitulatifs de la période sont rejoués.
7. **`unmarked_count`** : colonne conservée, toujours 0 (la soumission couvre tout le roster ; un élève inscrit après la séance n'est pas « non pointé », R2).
8. **Alertes** : R9 inchangée (aucun seuil dans le module), mais le module évalue des RÈGLES FOURNIES par l'établissement/le pack (`settings.alert_rules`, indicateurs `ABSENT_COUNT`, `UNEXCUSED_ABSENT_COUNT`, `LATE_COUNT`, `ABSENT_MINUTES`, `UNEXCUSED_ABSENT_MINUTES`, `ABSENCE_RATE_BPS`) via `AlertPolicyPort` et publie `attendance.alert.triggered|cleared` au franchissement seulement (état `alert_states`). Vide par défaut.
9. **Événements ajoutés** : `attendance.alert.triggered|cleared`, `attendance.sync.conflict_recorded`.
10. **Hors-ligne (AC6)** : contrat précisé — `clientId` par séance et par pointage (registre `sync_ops`), `clientMarkedAt` + `clockOffsetMs` ; conflits `SESSION_LOCKED`, `WINDOW_CLOSED`, `STALE` (pointage plus ancien que celui d'un autre auteur) ; arbitrage par `attendance.manage`.
11. **Endpoints ajoutés** : `POST /sessions/:id/records/with-justification`, `GET /sync/conflicts`, `POST /sync/conflicts/:id/resolve`, `POST /summaries/recompute`, `GET /enrollments/:id/summary`, `GET /students/:id/certificate-data`, `PUT` des référentiels sous `/reference/*`.
12. **Ports** : `EnrollmentRosterPort` (`getClassroom`, `getRoster`, `getEnrollment`, `findEnrollmentsOfStudent`), `OccurrencePort` (`getOccurrence`, `listExpectedOccurrences`), `PeriodPort`, `PeoplePort`, `StoragePort`, `AlertPolicyPort` — enregistrés par `registerAttendancePorts(app, ports)` ; sans port : échec fermé.
13. **Pièces** : envoi en JSON base64 (plafond de transport 12 Mio ; taille métier = paramètres d'établissement) ; lecture par URL signée de 120 s, auditée.
14. **Assemblage (additif)** (voir aussi §17) : `listCompletedStaffPresence` (présences du personnel terminées : durée du pointage, séance liée) alimente l'origine ATTENDANCE de la paie ; les ports d'`academic` (`getClassroom`, `getRoster`) sont appelés **en séquence** dans la transaction du module (chaque appel de port ouvre un SAVEPOINT sur la connexion partagée : des appels entrelacés échouaient avec `savepoint "ed_sp_n" does not exist` dès que les ports sont réels). Adaptateurs : `apps/api/src/platform/adapters/` (`docs/architecture/platform-assembly.md` §11).

## 17. Extensions Phase 4-5 (2026-10-02) — demandes de la spec 005 §14.2 (« 010 »)

Extensions **additives**, sans migration ni changement d'un comportement existant.

1. **Politique d'appel `DAILY` dans le modèle de pack PRIMARY** : `attendance/templates/CI/primary.json` (mécanisme de modèle de la spec 005 `pack-template.md` §3, chargé par `templates/index.ts` : un fichier par système éducatif et pack, validé au chargement, **hérite de la base** `DEFAULT_ATTENDANCE_PACK` pour les statuts, motifs, types de congé et paramètres de pièces) :
   `{ "code": "PRIMARY_DAILY", "label": "Appel journalier", "scope": "DAILY", "educationLevels": ["PRESCHOOL", "PRIMARY"], "dailyMinutes": null }`.
   `dailyMinutes = null` : aucune conversion en minutes supposée (AC2.2) ; aucune valeur réglementaire. Les packs `SECONDARY` et `HIGHER` n'ont pas de fichier (ils utilisent la base : appel par séance, fenêtre de correction de 120 min).
   - `validatePackTemplate` accepte désormais **deux formes** de politique d'appel et les normalise en une ligne par niveau : la forme déclarative ci-dessus (`scope` + `educationLevels` + `code` + `label`) et la forme historique (`callScope` + `educationLevel`). Refus : portée inconnue, niveaux vides ou en double, `dailyMinutes` non entier positif (ou non `null`), `editWindowMinutes` négatif.
   - `onTenantProvisioned(deps, ctx, { institutionIds, packs?, educationSystem? })` instancie le modèle de **chaque pack** de `tenancy.tenant.provisioned` (`packs`, `countryCode` → système éducatif) ; sans pack connu, la base (comportement antérieur). Idempotent et non destructif (la première politique posée pour un niveau l'emporte).
   - Exports : `getAttendancePackTemplate(educationSystem, pack)`, `defaultAttendanceTemplates()`, `buildAttendanceTemplates(raw[])`, `attendanceTemplateKey`, `normalizeCallPolicies`, `readProvisionedPacks`, `readProvisionedEducationSystem`, type `PackCallPolicyDeclaration`.
2. **Moteur d'appel en mode `DAILY`** (vérifié, rien à corriger) : une séance par classe et par jour (`openAttendanceSession({ kind: "daily", classroomId, date })`, index `sessions_one_daily`), appel refusé par séance sur un niveau `DAILY` (`attendance.call_scope_not_allowed`), `counted_minutes` nul sans `daily_minutes`, récapitulatifs `getAttendanceSummary` en **comptes de séances = journées** (`absentMinutes = 0`).
3. **Absences en journées et jours ouverts d'une inscription** (entrées `absences_journees` / `jours_ouverts` de la règle `cas_absences` de la spec 005, `rule-contract.md`) — lecture seule, sans aucun seuil :
   - `getAttendanceDays(deps, ctx, { enrollmentId, periodId | from + to, openDays?, excludeExcused? })` et `getAttendanceDaysForEnrollments(deps, ctx, { enrollmentIds[≤ 500], … })` (une requête, une entrée par inscription demandée, zéros si aucun appel) ;
   - seuls les appels `scope = 'DAILY'` **soumis ou validés** comptent ; une date n'est comptée qu'une fois (changement de classe) ;
   - réponse `AttendanceDays` : `openDays` (jours d'appel tenus, `openDaysSource: "CALLED_DAYS"`, **ou** valeur du calendrier fournie par l'appelant, `"CALLER"`), `absentDays` (justifiées comprises), `excusedAbsentDays`, `unexcusedAbsentDays`, `lateDays`, `presentDays` et `ruleInputs: { absences_journees, jours_ouverts }` (`excludeExcused: true` : seules les absences non justifiées) ;
   - erreurs : `attendance.invalid_input` (fenêtre ou période manquante, fin avant début, `openDays` négatif ou non entier, plus de 500 inscriptions), `attendance.period_not_found`.
   - **Hypothèse documentée** : sans calendrier, « jours ouverts » = jours où un appel journalier a été tenu pour la classe de l'élève ; un calendrier d'établissement (jours fériés, vacances) se transmet par `openDays` (lecture d'`academic` par l'appelant : le module n'a pas de port « calendrier »).
   - Pur : `buildAttendanceDays(enrollmentId, window, counts, options?)`, `EMPTY_DAY_COUNTS` ; exports : `ATTENDANCE_DAYS_MAX_ENROLLMENTS`.
4. **Tests** : `test/unit/primary-template.test.ts` (modèle, normalisation, refus, domaine pur), `test/integration/daily-days.integration.test.ts` (politique instanciée, appel journalier unique, comptes exacts sur 5 jours dont un appel non soumis, lot, validations, justificatif accepté, cohérence avec `getAttendanceSummary`).
