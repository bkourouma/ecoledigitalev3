# Feature Specification: Emploi du temps et planification (017-scheduling)

**Feature Branch**: `017-scheduling`

**Created**: 2026-10-01

**Status**: Rédigée — prête pour `/speckit.plan`. Module backend `scheduling` (schéma Postgres `scheduling`, migrations 1000-1003). DDL, parité et plan dans le dossier.

**Sources**: `docs/PRD_EcoleDigitale_SaaS.md` §35, §37, §43, §58-59 ; plan §3.7, §4 (tranches 2.3 et 2.7), §7 ; ADR-001, 002, 004, 006, 007 ; `docs/architecture/module-conventions.md` ; `docs/workflow-paie-enseignants.md`, `docs/module-remuneration-portage-nouvelle-stack.md` ; legacy : `session_instances`, assistant `schedule-generation`, `classrooms`, `classroom_reservations`, `academic_calendar_events`, `exam_schedules`, `professional_emploi_temps`, `professional_course_plannings`, `professional_ecue_seances` (cycle `planifiee/realisee/annulee`, validation, durée payée), `professional-seance-validation.service.ts`, `professional-emploi-temps.service.ts` (inventaire exhaustif : `parity.md`).

> Le legacy a trois couches non synchronisées pour le Professional (grille hebdomadaire, planning ponctuel, séance réalisée), un objet daté académique, des salles en texte libre, **aucune détection de conflit à l'écriture** (hors un chevauchement enseignant/classe académique), un assistant de génération dont l'approbation écrit dans des tables supprimées, et une règle de paie qui vit dans les séances. Cette spec unifie le tout en **patrons récurrents → occurrences datées**, avec des conflits **imposés par la base**.

## 1. Objectifs

1. **Un agrégat « séance »** (`session_occurrences`) couvrant cours, examens, réunions, événements, réservations de salle, conseils, avec un cycle explicite `PLANNED → HELD → validée` / `CANCELLED`.
2. **Emplois du temps récurrents** (patrons hebdomadaires, alternance A/B, bornes de validité) qui **génèrent** les occurrences de façon idempotente, en tenant compte du calendrier de l'établissement.
3. **Détection de conflits enseignant, classe, salle et équipement** (PRD §35), à l'écriture, expliquée avant l'enregistrement et imposée par la base ; politique `BLOCK`/`WARN` par ressource ; dépassement motivé et audité.
4. **Salles et équipements** comme données (types, capacité, statut, stock), **fuseau par établissement**, calendrier en **plages** (fériés, vacances, fermetures).
5. **Gestion des remplacements** : l'intervenant réel d'une séance (remplaçant compris) est le bénéficiaire de la paie ; absence ou départ d'un enseignant ⇒ séances signalées « à remplacer ».
6. **Validation pour la paie** et **heures payables** : prédicat unique, durée payée distincte de la durée planifiée, verrous posés par la paie — sans aucune notion de tarif.
7. **Vues et exports** : emploi du temps par classe, enseignant, salle, élève, parent (PRD §36-37), tableau « aujourd'hui » de l'enseignant, export iCalendar.
8. **Aide au placement** (`suggestSlots`) à la place de l'assistant génétique factice du legacy.

## 2. Périmètre

### Inclus

- Salles, types de salle, équipements (stock), grille horaire facultative, événements de calendrier en plage, paramètres (fuseau, mode de disponibilité, ouverture, « quatre yeux »), politiques de conflit.
- Emplois du temps (brouillon, publié, archivé, clonage), patrons, intervenants et équipements de patron, génération d'occurrences, occurrences ad hoc, examens, réservations, séances comptables.
- Constat (`HELD`), annulation, report, changement de salle, remplacement, validation/dévalidation, durée payée, dépassement de conflit, journal.
- Conflits : aperçu, détection validée (rapport de chevauchements), agenda d'occupation, charge hebdomadaire.
- Interface paie : `listPayableHours`, `lockHours`, `releaseHoursLock`.
- Port `ScheduleConflictChecker` pour academic (chevauchement d'horaire d'un apprenant à la carte).
- API `/api/v1/scheduling/*`, contrats, événements, écrans mobile-first.

### Exclu (renvoyé à d'autres specs)

| Sujet | Spec |
|---|---|
| Appel des élèves, justificatifs, présence du personnel et congés | 010 |
| Affectations d'enseignement, disponibilités, compétences | 009 (source de vérité ; ce module les lit) |
| Classes, périodes, offres, inscriptions, curriculum | 004 |
| Taux horaires, bulletins de paie, heures supplémentaires, calcul | 032 |
| Examens nationaux (candidats, centres, épreuves) | 018 (utilise `kind = EXAM`) |
| Classes virtuelles (fournisseurs, replay, présence) | 022/023 (via `virtual_session_ref`) |
| Génération PDF/Word de l'emploi du temps | 024 (le module fournit les données et l'export iCalendar) |
| Notifications de changement d'horaire | 016 (consomme les événements) |
| Solveur de génération complète d'un emploi du temps | hors v1 (question O-05) |

## 3. Acteurs

| Acteur | Rôle |
|---|---|
| Directeur des études / responsable de l'emploi du temps | Crée et publie les emplois du temps, résout les conflits, valide les séances |
| Secrétariat | Consulte, réserve des salles, saisit des événements |
| Enseignant | Consulte son emploi du temps, déclare des séances ponctuelles de ses classes, constate, signale |
| Comptable / paie | Valide les séances comptables et les heures, pose les verrous (`schedule.hours.lock`) |
| Élève / parent | Consultent l'emploi du temps (élève : le sien ; parent : celui de ses enfants) |
| Modules consommateurs | 010 (occurrences), 004 (conflits d'inscription), 032 (heures payables), 016 (notifications), 025 (occupation), 018 (examens) |

## 4. User Stories et critères d'acceptation

### US1 — Construire un emploi du temps sans conflit (P1)

En tant que responsable des études, je veux placer les cours et être averti de tout conflit avant d'enregistrer.

- **AC1.1** `previewConflicts({start, end, staffIds, classroomId, roomId, equipment[], excludeOccurrenceId?})` renvoie les conflits avec explication (qui, quoi, quand) classés `BLOCKING` / `WARNING` ; il couvre enseignant, classe, salle, équipement **et** les avertissements non bloquants (indisponibilité déclarée du personnel, salle trop petite pour le roster, compétence manquante).
- **AC1.2** À l'écriture, la base interdit toute double réservation d'un enseignant, d'une classe ou d'une salle dont la politique est `BLOCK` : deux transactions concurrentes qui placent le même enseignant sur des plages qui se chevauchent → exactement une réussit, l'autre reçoit `409 scheduling.conflict_detected` avec le détail (test de concurrence).
- **AC1.3** Le critère de chevauchement est celui du legacy conservé : mêmes jours, plages semi-ouvertes `[début, fin)` ; deux séances **bout à bout** ne sont pas en conflit.
- **AC1.4** Les conflits que le legacy ne détectait jamais — **cohorte (classe) Professional**, **salle** Professional/Académique/réservation, **enseignant académique ↔ Professional** — sont détectés ; un même enseignant ne peut plus être sur deux séances simultanées de packs différents.
- **AC1.5** Une politique `WARN` pour une ressource autorise l'écriture et marque la réservation non exclusive ; `overrideConflict` (permission **sensible** `schedule.conflict.override`, motif ≥ 5 caractères) permet de dépasser un `BLOCK` pour une occurrence, journalisé (`OVERRIDE`) et publié.
- **AC1.6** Équipement : somme des quantités sur plages chevauchantes ≤ stock de l'article, sérialisée par verrou de ligne ; dépassement = conflit.
- **AC1.7** Une salle `OUT_OF_SERVICE` ou `ARCHIVED` n'est plus réservable ; la mise hors service d'une salle liste les occurrences futures concernées (événement `scheduling.occurrence.replacement_needed` avec raison `room_unavailable`, sans annulation automatique).

### US2 — Patrons récurrents et génération d'occurrences (P1)

- **AC2.1** `upsertTimetableEntry` définit : classe, nœud de curriculum (ou offre), jour ISO (1-7), heures `[début, fin)` **à la minute** (le legacy limitait l'UI aux heures entières), salle, intervenants et rôles, équipements, modèle `EVERY | WEEK_A | WEEK_B`, bornes propres, mode de dispensation ; le placement est contrôlé comme une occurrence type (AC1.1).
- **AC2.2** `generateOccurrences({timetableId, from, to, capByNodeHours?})` crée une occurrence par date correspondante, **hors jours bloquants** du calendrier (`blocks_teaching`), dans l'intersection (bornes du patron, de l'emploi du temps, de la période, de l'offre quand il y en a une, de `max_generation_weeks`), de façon **idempotente** (clé patron + date + heure) ; renvoie un rapport (créées, sautées pour jour bloquant, sautées pour conflit, avertissements) et écrit `generation_runs`.
- **AC2.3** `capByNodeHours` (option) plafonne le cumul généré par nœud et classe au volume horaire du nœud (`curriculum_nodes.hours_total`) — la règle « un cours ne dépasse pas ses heures » du legacy, désormais optionnelle et explicite.
- **AC2.4** Modifier un patron propose `propagate = NONE | FUTURE_PLANNED` : avec `FUTURE_PLANNED`, les occurrences futures `PLANNED` non constatées sont mises à jour (si pas de conflit) ou signalées ; les occurrences `HELD`/validées ne changent jamais. Supprimer un patron déjà utilisé le **termine** (`valid_to` = veille) et annule les occurrences futures `PLANNED` générées (motif `pattern_removed`) ; la suppression physique n'a lieu que sans occurrence.
- **AC2.5** `generateOccurrences` pour 40 classes × 30 patrons × 18 semaines s'exécute en < 60 s (job worker, lots par semaine et par classe).
- **AC2.6** Les occurrences conservent leur `timetable_entry_id` ; deux régénérations successives ne créent aucun doublon ; l'alternance A/B s'appuie sur `week_a_anchor` (un lundi).
- **AC2.7** Le fuseau de l'établissement convertit « lundi 08:00 » en instant UTC ; `occurs_on` est la date civile locale (plus de `Europe/Paris` en dur).

### US3 — Cycle de vie d'une séance (P1)

En tant que gestionnaire, je veux que le constat, l'annulation et la validation soient explicites et traçables.

- **AC3.1** `holdOccurrence` (constat) est déclenché par `attendance.session.submitted` (source `ATTENDANCE`) ou manuellement (`ADMIN`, avec motif) ; idempotent ; une séance annulée n'est pas ressuscitée par un appel tardif.
- **AC3.2** `cancelOccurrence(id, reason)` exige un motif, libère immédiatement les réservations, publie `scheduling.occurrence.cancelled` ; interdit si des heures sont **verrouillées** par la paie ; une occurrence validée doit d'abord être dévalidée.
- **AC3.3** `rescheduleOccurrence` / `changeOccurrenceRoom` / `setOccurrenceStaff` : contrôle des conflits ; interdits sur une occurrence validée ou verrouillée (**le legacy permettait de changer date, horaires et enseignant d'une séance validée ou payée**) ; journalisés automatiquement (qui, avant, après, motif).
- **AC3.4** `restoreOccurrence` (CANCELLED → PLANNED) existe, journalisé, avec contrôle de conflit.
- **AC3.5** Aucune suppression physique d'occurrence ni de journal ; la base la refuse.
- **AC3.6** Le journal `occurrence_changes` restitue 100 % des changements d'horaire, de salle, d'intervenant, de statut, de validation et de dérogation.

### US4 — Remplacement et absence d'enseignant (P1)

- **AC4.1** `substituteStaff({occurrenceId, originalStaffId, substituteStaffId, reason})` supprime la ligne de l'enseignant remplacé (journalisée) et crée une ligne `SUBSTITUTE` portant `replaces_staff_id` ; les conflits du remplaçant sont contrôlés ; le bénéficiaire de la paie est le remplaçant.
- **AC4.2** À `attendance.staff_leave.approved` ou `people.staff.status_changed → LEFT/SUSPENDED` ou `people.teaching_assignment.ended`, les occurrences futures `PLANNED` où l'intéressé est intervenant reçoivent `needs_replacement = true` et un événement `scheduling.occurrence.replacement_needed` (aucune modification automatique).
- **AC4.3** `listPendingReplacements` liste les séances à remplacer, filtrables par classe et par date ; `suggestSlots`-like : `suggestSubstitutes(occurrenceId)` propose des enseignants libres, compétents (matière), disponibles, triés.
- **AC4.4** Un enseignant qui constate une séance dont il n'est pas intervenant déclaré reçoit un **avertissement** et la direction est notifiée (le legacy le laissait faire sans trace).

### US5 — Validation pour la paie et heures payables (P1)

En tant que comptable, je veux valider les séances réalisées et fournir les heures payables à la paie.

- **AC5.1** `validateOccurrence` / `validateOccurrencesBatch` (permission **sensible** `schedule.occurrence.validate`, MFA) : exige une occurrence `HELD`, au moins un intervenant de rôle rémunéré, une durée connue ; le lot applique **partiellement** : les éligibles passent, les autres reviennent dans `rejected[{id, reason}]` (parité AT-064, lot ≤ 500).
- **AC5.2** « Quatre yeux » : le créateur d'une séance comptable (`origin = ACCOUNTING`) ne peut pas la valider tant que `settings.allow_self_validation = false` (le legacy tolérait le cumul, seulement tracé).
- **AC5.3** `setPaidMinutes(occurrenceId, staffId, minutes | null)` (dérogation, 1-1440, auteur et date tracés) n'est possible que sur une occurrence **non validée** (le legacy l'autorisait après validation) ; `null` retire la dérogation.
- **AC5.4** `listPayableHours({from, to, staffIds?})` est le **prédicat unique** : occurrence `HELD` ∧ validée ∧ intervenant de rôle rémunéré ; minutes = dérogation sinon durée de la séance ; chaque ligne porte `locked`/`lockRef`. Les résultats ne dépendent ni de `teaching_assignments` ni d'un appel d'élèves.
- **AC5.5** `lockHours({lines[{occurrenceId, staffId}], lockRef})` (réservé à la paie, `schedule.hours.lock`) est **atomique et exclusif** : une ligne déjà verrouillée sous un autre `lockRef` fait échouer tout le lot (`scheduling.hours_already_locked`) — **une heure ne se paie qu'une fois**, y compris entre deux bulletins de périodes qui se chevauchent (le legacy ne l'assurait que par exclusion de lecture). La paie verrouille dès l'inclusion des heures dans un bulletin non annulé, et appelle `releaseHoursLock(lockRef)` à l'annulation ou au recalcul.
- **AC5.6** Une occurrence dont une ligne est verrouillée est **intégralement gelée** (horaire, statut, validation, intervenants) ; la dévalidation est refusée avec `scheduling.hours_locked` (`DEJA_PAYEE` du legacy, étendu aux bulletins en litige).
- **AC5.7** Une séance « comptable » (`createAccountingOccurrence` : enseignant, date, minutes ou plage) est créée `HELD`, non validée, sans réservation de ressources, avec créateur tracé ; elle ne produit jamais de conflit.
- **AC5.8** `listPendingValidation` (séances `HELD` non validées, tri passé d'abord) et `findValidatedOverlaps` (deux séances validées du même enseignant qui se chevauchent — information, ne bloque pas) remplacent les écrans de rapprochement du legacy.

### US6 — Vues de l'emploi du temps (P1)

- **AC6.1** `listOccurrencesForClassroom|Staff|Room|Student` : fenêtres de dates, pagination ≤ 500 ; p95 < 200 ms pour une semaine de classe. `listOccurrencesForStudent` résout les inscriptions actives (classe ou offres confirmées).
- **AC6.2** Portail enseignant « Aujourd'hui » : séances du jour triées, avec accès rapide à l'appel (`attendance`) et aux notes ; p95 < 150 ms.
- **AC6.3** Portail parent : emploi du temps de chaque enfant via `people.isGuardianOfStudent` ; élève : le sien ; jamais l'emploi du temps d'un autre.
- **AC6.4** `exportTimetableIcs(scope)` produit un iCalendar (VEVENT avec fuseau de l'établissement) pour une classe, un enseignant ou un enfant ; le jeton d'abonnement est révocable et limité en lecture.
- **AC6.5** Seuls les emplois du temps `PUBLISHED` et les occurrences futures sont visibles des portails élèves/parents ; brouillons invisibles.
- **AC6.6** `getRoomOccupancy({campusId, from, to})` renvoie heures occupées et, si `settings.opening_*` est renseigné, le taux d'occupation ; `getStaffWeeklyLoad(staffId, week)` renvoie les heures planifiées (aucune alerte ni seuil).

### US7 — Calendrier de l'établissement (P1)

- **AC7.1** Les événements sont des **plages** de dates (début, fin, heures facultatives) typées (donnée de pack) avec `blocks_teaching` ; la génération saute les jours bloquants ; créer un événement bloquant sur une période déjà générée signale les occurrences `PLANNED` concernées (événement), sans les annuler.
- **AC7.2** Audience (`STAFF`, `STUDENTS`, `GUARDIANS`) pilote la visibilité dans les portails.
- **AC7.3** Les jours fériés officiels ne sont pas codés : l'établissement (ou un référentiel pays validé ultérieurement) les saisit.

### US8 — Séances ponctuelles, examens, réservations (P2)

- **AC8.1** `createOccurrence` couvre les séances ad hoc d'un cours (`LESSON`), les examens (`EXAM`, même contrôle de classe/salle/surveillants `SUPERVISOR`), les réunions, conseils, événements, et les **réservations de salle** (`RESERVATION` sans classe ni nœud) ; le contrôle de conflit est uniforme (fin des trois « systèmes » : séance, réservation, examen).
- **AC8.2** `schedule.occurrence.declare` permet à un enseignant de déclarer une séance ponctuelle **de ses classes affectées** (`people.isStaffAssignedToClassroom`), statut `PLANNED` ou `HELD` ; hors de ses classes : refus. Une réservation de salle par un enseignant exige `schedule.room.book` (le legacy laissait tout utilisateur authentifié réserver).
- **AC8.3** Les offres à la carte planifient leurs occurrences avec `claims_classroom = false` ; `ScheduleConflictChecker.checkStudentOffering` signale, à l'inscription, qu'un apprenant inscrit à deux offres simultanées a un chevauchement (avertissement, jamais blocage).

### US9 — Aide au placement (P2)

- **AC9.1** `suggestSlots({durationMinutes, staffIds, classroomId, roomType?, features?, window, count})` renvoie les N premiers créneaux libres (dans les jours ouvrables, hors jours bloquants, dans l'amplitude d'ouverture, hors conflits `BLOCK`), classés de façon **déterministe** (jour, heure ; préférence aux plages `AVAILABLE` déclarées ; salle ≥ capacité du roster), avec leurs avertissements ; temps de réponse p95 < 800 ms pour un enseignant et une classe sur 4 semaines.
- **AC9.2** C'est une **aide**, pas un solveur : aucune génération automatique d'un emploi du temps complet ; la question de la construction automatique est ouverte (O-05).

## 5. Règles métier

- R1 Une occurrence est une séance **datée** avec `starts_at < ends_at` (instants UTC), `occurs_on` (date civile locale). Les patrons sont hebdomadaires (jour ISO), à la minute, dimanche autorisé.
- R2 États : `PLANNED → HELD | CANCELLED` ; `HELD → CANCELLED | PLANNED` (si non validée et non verrouillée) ; `CANCELLED → PLANNED` ; la validation est un attribut de `HELD`, pas un état (comme dans le legacy : fait pédagogique distinct de l'acte de gestion).
- R3 Une occurrence validée ne change ni d'horaire, ni de statut, ni de salle, ni d'intervenants ; des heures verrouillées gèlent tout.
- R4 Réservations exclusives : `STAFF` (tout intervenant de tout rôle), `CLASSROOM` (la classe si `claims_classroom`, sinon l'**offre** à la carte ; natures `LESSON`/`EXAM`), `ROOM` ; les séances comptables ne réservent rien ; une occurrence annulée libère tout ; `conflict_override` rend les réservations non exclusives.
- R5 Politique de conflit par établissement et par ressource : `BLOCK` (défaut) ou `WARN` ; l'équipement est une quantité.
- R6 Disponibilité du personnel : `UNAVAILABLE` l'emporte ; l'absence de ligne signifie disponible (`OPEN`) ou indisponible (`CLOSED`) selon `settings.staff_availability_mode` ; toujours un **avertissement**, jamais un blocage.
- R7 Rôles d'intervenant : `LEAD`, `CO_TEACHER`, `SUBSTITUTE` (porte `replaces_staff_id`), `SUPERVISOR` ; `is_paid_role` est posé par le cas d'usage (vrai pour `LEAD`/`CO_TEACHER`/`SUBSTITUTE`, faux par défaut pour `SUPERVISOR` — à confirmer avec 032, question O-06).
- R8 Un intervenant sans affectation active produit un avertissement (pas un blocage) ; une affectation ne fonde jamais la paie.
- R9 La nature `EXAM` utilise les mêmes ressources ; la composition des épreuves relève de 018.
- R10 Le fuseau vient de l'établissement ; aucun calcul de date sans fuseau.
- R11 Le calendrier : `blocks_teaching` retire un jour de la génération et signale les occurrences existantes ; il n'annule rien automatiquement.
- R12 Le constat `HELD` n'exige pas que des élèves soient présents (une séance sans élève présent est constatée si l'enseignant a fait l'appel) ; un appel sans élèves (classe vide) n'est pas un constat automatique.
- R13 Aucune constante : les amplitudes, durées par défaut, créneaux standards sont des données d'établissement (`settings`, `time_slots`) ; le legacy codait 12 h × 6 j, créneaux 08-10…, horizon d'un mois, salles fictives.
- R14 Chaque changement d'une occurrence (heure, salle, intervenant, statut, validation, dérogation) est journalisé automatiquement ; les opérations sensibles (validation, dépassement, dérogation après coup) sont auditées.
- R15 Une occurrence rattachée à une offre n'est planifiable que si l'offre est `OPEN`, `FULL` ou `IN_PROGRESS` (parité `SESSION_NOT_OPEN`) et si sa date tombe dans `[starts_on, ends_on]` de l'offre ; un intervenant doit être un membre du personnel `ACTIVE` ou `ON_LEAVE` (vérifié via `people.getStaffByIds` ; l'éligibilité à la paie d'un membre `SUSPENDED`/`LEFT` est décidée par 032, sans exclusion silencieuse).
- R16 Une occurrence porte au plus **une** référence de classe virtuelle (`virtual_session_ref`) ; plusieurs visioconférences pour une séance (0..n dans le legacy) se rattachent côté 022/023 à l'occurrence, pas l'inverse.
- R17 Les durées payées sont des **minutes entières** (1-1440) ; la reprise d'un nombre d'heures décimal (`duree_payee`, `duration_hours` du legacy) s'arrondit à la minute à l'import (031), jamais en base.
- R18 Un patron modifié ne réécrit jamais une occurrence `HELD`, validée ou verrouillée ; `propagate = FUTURE_PLANNED` ne touche que les occurrences `PLANNED` futures sans appel soumis.

## 6. Modèle de données

Voir `data-model.md` (18 tables, DDL testé, migrations **1000-1003**, plage 1000-1099 à inscrire dans `module-conventions.md`).

## 7. Interfaces publiées (`apps/api/src/modules/scheduling/index.ts`)

| Fonction | Usage / consommateurs |
|---|---|
| `listPayableHours(ctx, {from, to, staffIds?})` → lignes `{occurrenceId, staffId, occursOn, minutes, kind, classroomId, nodeId, offeringId, title, locked, lockRef}` | **032 (paie)** — remplace les collecteurs d'heures académique et Professional |
| `lockHours(ctx, {lines, lockRef})` · `releaseHoursLock(ctx, {lockRef})` | **032** uniquement (`schedule.hours.lock`) |
| `getOccurrence`, `listOccurrences`, `listOccurrencesForStaff|Classroom|Room|Student` | 010, 013, portails |
| `holdOccurrence` (consommation de `attendance.session.submitted`), `unholdOccurrence`, `cancelOccurrence`, `restoreOccurrence`, `rescheduleOccurrence`, `changeOccurrenceRoom` | UI, 010 |
| `setOccurrenceStaff`, `substituteStaff`, `setPaidMinutes`, `validateOccurrence`, `validateOccurrencesBatch`, `unvalidateOccurrence`, `createAccountingOccurrence`, `overrideConflict` | gestion, paie |
| `createOccurrence`, `createTimetable`, `cloneTimetable`, `upsertTimetableEntry`, `endTimetableEntry`, `removeTimetableEntry`, `publishTimetable`, `archiveTimetable`, `generateOccurrences` | planification |
| `previewConflicts`, `suggestSlots`, `suggestSubstitutes`, `findValidatedOverlaps`, `listPendingValidation`, `listPendingReplacements`, `listUnrealizedOccurrences` | UI, 025 |
| `getRoomOccupancy`, `getStaffWeeklyLoad`, `exportTimetableIcs` | 025, portails |
| `createRoom`, `updateRoom`, `setRoomStatus`, `createEquipmentItem`, `updateEquipmentItem`, `upsertTimeSlot`, `deactivateTimeSlot`, `createCalendarEvent`, `updateCalendarEvent`, `deleteCalendarEvent`, `upsertConflictPolicy`, `updateSchedulingSettings` + lectures | paramétrage |
| `createScheduleConflictChecker(deps)` → conforme au port `ScheduleConflictChecker` d'academic | câblage |

Ports consommés : `AcademicQuery` (`getClassroom`, `getRoster`, `getOffering`, `getCurriculumNode`, `resolvePeriodForDate`), `PeopleQuery` (`getStaffByIds`, `listAvailabilities`, `listCompetencies`, `isStaffAssignedToClassroom`, `isGuardianOfStudent`), `AttendanceQuery` (facultatif : état de l'appel). Repli : sans `PeopleQuery`, la planification fonctionne sans avertissements de disponibilité ni contrôle d'affectation ; sans `AcademicQuery`, aucune écriture liée à une classe (échec fermé).

## 8. Endpoints (`/api/v1/scheduling`)

| Méthode | Chemin | Description | Permission |
|---|---|---|---|
| GET/POST/PATCH | `/rooms`, `/rooms/:id` ; POST `/rooms/:id/status` | Salles | `schedule.read` / `schedule.room.manage` |
| GET/POST/PATCH | `/equipment`, `/equipment/:id` | Équipements | idem |
| GET/PUT | `/time-slots` | Grille horaire | `schedule.read` / `schedule.manage` |
| GET/POST/PATCH/DELETE | `/calendar-events[/:id]` | Calendrier (plages) | `schedule.read` / `schedule.calendar.manage` |
| GET/POST | `/timetables`, `/timetables/:id` | Emplois du temps | `schedule.read` / `schedule.manage` |
| GET/POST/PATCH/DELETE | `/timetables/:id/entries[/:eid]` | Patrons | `schedule.manage` |
| POST | `/timetables/:id/{publish,archive,clone,generate}` | Cycle et génération | `schedule.publish` / `schedule.manage` |
| GET | `/timetables/:id/conflicts` | Conflits d'un brouillon | `schedule.read` |
| GET/POST | `/occurrences` | Lister / créer (ponctuelle, examen, réservation) | `schedule.read` / `schedule.manage` ; `schedule.occurrence.declare` (enseignant) |
| GET | `/occurrences/:id`, `/occurrences/:id/history` | Détail / journal | `schedule.read` |
| POST | `/occurrences/:id/{reschedule,room,staff,substitute,cancel,restore,hold,unhold,override}` | Modifications | `schedule.manage` ; `override` : `schedule.conflict.override` (sensible) |
| POST | `/occurrences/:id/{validate,unvalidate}`, `/occurrences/validate-batch` | Validation | `schedule.occurrence.validate` (sensible) |
| PUT | `/occurrences/:id/staff/:staffId/paid-minutes` | Durée payée | `schedule.occurrence.validate` |
| POST | `/occurrences/accounting` | Séance comptable | `schedule.accounting.create` |
| GET | `/occurrences/pending-validation`, `/occurrences/unrealized`, `/occurrences/pending-replacements` | Files de travail | `schedule.read` |
| POST | `/conflicts/preview`, `/slots/suggest`, `/occurrences/:id/substitutes/suggest` | Aide | `schedule.read` |
| GET | `/views/{classroom|staff|room|student}/:id?from&to` | Vues | `schedule.read` ; `schedule.own.read` (enseignant) |
| GET | `/me/today`, `/me/timetable`, `/children/:studentId/timetable` | Portails | `schedule.own.read`, `schedule.self.read`, `schedule.child.read` |
| GET | `/reports/{overlaps,room-occupancy,staff-load}` | Rapports | `schedule.read` |
| GET | `/export/timetable.ics?scope&token` | iCalendar | jeton révocable |
| GET/PUT | `/reference/{room-types,calendar-event-kinds,conflict-policies,settings}` | Paramétrage | `schedule.read` / `schedule.manage` |

Les routes de paie (`lockHours`, `releaseHoursLock`) sont **internes** (appel de module) : pas d'endpoint HTTP.

## 9. Écrans

| Écran | Contenu | Rôles |
|---|---|---|
| Constructeur d'emploi du temps | Grille semaine par classe/enseignant/salle, glisser-déposer, conflits en direct (aperçu), alternance A/B, publication | Directeur des études |
| Génération et rapprochement | Choix de période, rapport (créées, sautées), séances non constatées | Direction |
| Salles et équipements | Plan d'occupation, statut, stocks | Direction, secrétariat |
| Calendrier de l'établissement | Fériés, vacances, fermetures, examens, réunions | Direction |
| Aujourd'hui (enseignant) | Séances du jour, appel en un geste, constat, signalements | Enseignant |
| Mon emploi du temps (enseignant, élève, parent) | Semaine/jour, export iCalendar, enfants | Tous |
| Validation des séances | File « à valider », lot, dérogation de durée, chevauchements validés, séances comptables | Comptable, direction |
| Remplacements | Séances à remplacer, suggestions de remplaçants | Direction |
| Paramètres | Fuseau, politique de conflit, ouverture, quatre yeux | Direction |

## 10. Permissions

| Clé | Libellé | Sensible |
|---|---|---|
| `schedule.read` | Consulter les emplois du temps et les séances | |
| `schedule.manage` | Créer et modifier emplois du temps, séances, salles | |
| `schedule.publish` | Publier / archiver un emploi du temps | |
| `schedule.room.manage` / `schedule.room.book` | Gérer / réserver les salles | |
| `schedule.calendar.manage` | Gérer le calendrier | |
| `schedule.occurrence.hold` | Constater manuellement une séance | |
| `schedule.occurrence.declare` | Déclarer une séance ponctuelle de ses classes | |
| `schedule.occurrence.validate` | Valider / dévalider / fixer la durée payée | oui |
| `schedule.accounting.create` | Créer une séance comptable | |
| `schedule.conflict.override` | Dépasser un conflit bloquant | oui |
| `schedule.hours.lock` | Verrouiller les heures (réservée à la paie) | oui |
| `schedule.self.read` / `schedule.child.read` / `schedule.own.read` | Mon / leur emploi du temps ; mes séances (personnel) | |

Alignement avec les rôles système : directeur des études `schedule.*` ; secrétariat, éducateur, enseignant, responsable pédagogique `schedule.read` ; économe : `schedule.occurrence.validate` et `schedule.accounting.create` (à ajouter au modèle de rôle) ; parent `*.child.*` ; élève `*.self.*`. Features : `scheduling.equipment`, `scheduling.generation`, `scheduling.payroll-hours`.

## 11. Événements (outbox, `{ v: 1, … }`)

| Événement | Quand | Consommateurs |
|---|---|---|
| `scheduling.timetable.published` / `archived` | cycle de l'emploi du temps | 016 (annonce), portails |
| `scheduling.occurrence.created` / `rescheduled` / `room_changed` / `staff_changed` | planification | 010, 016 (alertes de changement), portails |
| `scheduling.occurrence.held` / `unheld` | constat | 025, 011 |
| `scheduling.occurrence.cancelled` | annulation | **010 (annule l'appel)**, 016 |
| `scheduling.occurrence.validated` / `unvalidated` | validation | 025 |
| `scheduling.occurrence.replacement_needed` | absence, départ, salle indisponible | 016, UI |
| `scheduling.conflict.overridden` | dépassement motivé | audit, 025 |
| `scheduling.calendar_event.created` / `updated` / `deleted` | calendrier | 016, UI |

Consommés : `attendance.session.submitted` (⇒ `HELD`), `attendance.staff_leave.approved` (⇒ `replacement_needed`), `people.staff.status_changed`, `people.teaching_assignment.ended`, `academic.offering.cancelled` et `academic.classroom.cancelled` (annulation des occurrences futures non validées), `academic.year.closed` (archivage), `tenancy.tenant.provisioned`. Idempotence par `event.id`.

## 12. Tests

- **Unitaires purs** : détection de chevauchement `[)`, génération (récurrence, A/B, bornes, jours bloquants, plafond d'heures, fuseau, passage de minuit refusé), `suggestSlots` (déterminisme), prédicat payable, machine d'états, calcul des minutes, résolution de remplaçants.
- **Intégration** (Postgres) : les 22 comportements de `data-model.md` ; concurrence (deux transactions sur le même enseignant) ; `lockHours` exclusif et atomique ; rejeu de la génération = zéro création ; dévalidation interdite sous verrou ; journal complet.
- **Isolation générique** : 18 tables, allowlist vide.
- **Contrat** : `listPayableHours` consommé par un simulacre de 032 (golden : mêmes heures que `DUREE_PAYEE_SQL`/`SEANCE_PAYABLE_PREDICATE` sur les jeux de la tranche 2.0) ; `ScheduleConflictChecker` ↔ port d'academic ; événements Zod.
- **Caractérisation (tranche 2.0)** : scénarios `seance-constat-realisee.test.ts`, `heures-consommees.test.ts`, détection de conflit `sessions.ts:137-147`.
- **Sécurité** : enseignant restreint à ses classes ; parent ↔ enfant ; aucune injection par noms de colonnes (le legacy construisait du SQL depuis le corps de `PUT /classrooms`) ; aucun jeton iCalendar valide après révocation.
- **Performance** : vue semaine < 200 ms ; génération 40 × 30 × 18 < 60 s ; `suggestSlots` < 800 ms.
- **E2E (Playwright)** : construire, publier, générer, constater par l'appel, valider en lot, verrouiller par la paie simulée, tenter de modifier (refus).

## 13. Cas limites

- Séance à cheval sur minuit (refusée : deux occurrences) ; passage d'heure d'été d'un autre pays (fuseau IANA, calcul à la génération) ; semaine à 53 jours ISO, alternance A/B à la frontière d'année.
- Un enseignant sur deux établissements du groupe au même moment : conflit détecté (les réservations sont par tenant, pas par établissement).
- Cours dont la salle est supprimée ou hors service : avertissement et file « à replacer » ; jamais d'annulation automatique.
- Offre à la carte dont la fenêtre est fermée : plus de génération ; occurrences existantes inchangées ; offre annulée ⇒ occurrences futures non validées annulées par événement.
- Séance constatée par un appel puis annulée par erreur : `unhold`/`restore` journalisés ; sous verrou de paie, impossible.
- Patron avec `valid_from` > `valid_to` ou hors période : refusé à la validation (jamais de 500).
- Jour bloquant créé après génération : occurrences signalées, décision humaine.
- Séance sans intervenant : valide pédagogiquement mais non payable ; la validation est refusée (« aucun intervenant rémunéré »).
- Intervenant `LEFT` encore présent sur des séances passées validées : conservées ; seul le futur est signalé.
- Deux validateurs simultanés sur la même séance : le second reçoit `already_validated` (idempotent).
- Équipement retiré (stock réduit) sous des réservations existantes : les réservations futures sont signalées.
- Calendrier : événement multi-jours qui commence avant l'année : borné à l'établissement.
- Emploi du temps cloné d'une année précédente : `lineage_id` des nœuds permet de retrouver les nœuds équivalents ; les patrons sans nœud cible sont listés.
- Export iCalendar d'un enseignant avec 600 occurrences : pagination par fenêtre de dates.

## 14. Dépendances

- **En amont** : 000 (DB, outbox), 004 (classes, nœuds, périodes, offres, rosters), 009 (affectations, disponibilités, compétences, personnel), 008 (portail enfant), 010 (constat), 002 (RBAC, MFA), 030 (audit).
- **En aval** : 010 (occurrences), 032 (heures payables, verrous), 016, 025, 018, 022/023, 029 (emploi du temps hors-ligne, phase 6).
- **Technique** : PostgreSQL 14+ (`btree_gist`, GiST sur `tstzrange`), Zod, worker (génération, rapprochements), bibliothèque iCalendar.
- **Manifeste** : `key: "scheduling"`, `packs: ["PRIMARY","SECONDARY","HIGHER","VIRTUAL"]`, `dependsOn: ["rbac"]` ; ports pour academic/people/attendance.

## 15. Critères de sortie (mesurables)

1. Migrations 1000-1003 appliquées de zéro ; isolation générique verte sur les 18 tables avec deux tenants.
2. Aucun double-booking possible (enseignant, classe, salle) sous concurrence ; tests des conflits que le legacy ignorait (cohorte Pro, salle Pro, enseignant académique/Pro).
3. Génération idempotente d'un semestre complet depuis des patrons, avec calendrier bloquant et alternance A/B ; fuseau de l'établissement.
4. Parcours bout à bout : appel soumis ⇒ séance `HELD` ⇒ validation (MFA) ⇒ `listPayableHours` ⇒ `lockHours` par la paie simulée ⇒ modification refusée ; `releaseHoursLock` rouvre ; aucune heure payée deux fois (test sur deux périodes chevauchantes).
5. Remplacement : l'intervenant réel est celui payé ; absence/congé signale `replacement_needed` ; suggestions de remplaçants déterministes.
6. Parité Professional : grille hebdomadaire, séances, présences (via 010), chevauchements validés, séances comptables, rapprochement « séances manquantes » couverts ou écartés (`parity.md`).
7. Le legacy remplacé (`session_instances`, `schedule-generation`, `time_slots` clonée, `classrooms`, `classroom_reservations`, `academic_calendar_events`, `exam_schedules` côté planning, `professional_emploi_temps`, `professional_course_plannings`, `professional_ecue_seances`, `professional_ecue_attendance` côté séance) est supprimé dans les tranches 2.3 et 2.7 ; les collecteurs d'heures (`hour-collectors/{academic,professional}`) sont remplacés par `listPayableHours` ; aucune route sans garde de rôle.
