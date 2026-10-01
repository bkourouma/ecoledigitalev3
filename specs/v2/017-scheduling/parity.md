# Parité legacy -> v2 — Module `scheduling` (spec 017)

## En-tête

**Objet.** Liste exhaustive des tables, fonctions, endpoints, algorithmes, règles implicites et constantes du legacy en matière d'emploi du temps, de planning, de séances datées, de salles et réservations, de calendrier, d'examens (calendrier) et de séances Professional (grille, planning, séances réalisées, validation pour la paie), avec pour chacun le sort réservé dans le module `scheduling` v2 : **conservé**, **amélioré**, **abandonné** ou **hors module -> spec NNN**.

**Principe v2 rappelé.** Un seul agrégat « séance » : patron récurrent (`timetable_entries`) -> occurrence datée (`session_occurrences`), machine d'états `PLANNED -> HELD (constat) -> validée (validated_at)` et `CANCELLED`. Les trois couches Professional (grille `professional_emploi_temps`, planning ponctuel `professional_course_plannings`, séances `professional_ecue_seances`) et l'unique objet daté de l'académique (`session_instances`) sont fusionnés. Conflits enseignant / classe / salle / équipement imposés par la base (`scheduling.resource_claims`, contrainte `resource_claims_no_overlap`, plages `[)`), politique `BLOCK`/`WARN` par ressource, dépassement motivé (`conflict_override`). Bénéficiaire de la paie = intervenant réel (`occurrence_staff`, `SUBSTITUTE` + `replaces_staff_id`), durée payée = dérogation `paid_minutes`, verrou paie `lockHours`/`releaseHoursLock`. Pas de DELETE physique d'occurrence (annulation motivée). Fuseau par établissement (`scheduling.settings.timezone`), salle = clé (`scheduling.rooms`), calendrier en plages (`calendar_events`).

**Sources.**
- Inventaire legacy : `legacy-scheduling.md` (SC-001..SC-134 ; 102 identifiants effectivement attribués), recoupé avec `legacy-attendance.md` §2.6 et §4 (AT-060..AT-072 : interface paie) et `legacy-pro-enrollment.md` (P-018..P-022).
- Conception cible : brief « Module scheduling » + `attendance` (appel) ; DDL de référence `1000_scheduling_reference.sql`, `1001_scheduling_timetables.sql`, `1002_scheduling_occurrences.sql`, `1003_scheduling_guards.sql` (testé : `test-scheduling.sql`). Plage de migrations du module : 1000-1099.
- Code legacy vérifié par sondage (worktree) : `routes/sessions.ts:137-147`, `routes/schedule-generation.ts:362,813`, `routes/session-instances.ts:205,330`, `routes/simple-schedule.ts:193,288`, `routes/teacher-assignments.ts:622`, `services/SchedulePersistenceService.ts:163`, `services/owner-assiduite.service.ts:33-36`.

**Conventions de références.** Chemins de code relatifs à `apps/api/src/` sauf mention ; migrations `infra/scripts/migrations/<fichier>:<ligne>` ; « baseline » = `apps/api/prisma/migrations/20260403110000_baseline/migration.sql`. Cibles v2 : tables `scheduling.*`, cas d'usage de `modules/scheduling/index.ts`, routes `/api/v1/scheduling/...`, permissions `schedule.*`.

**Légende.**
- **conservé** : règle/fonction reproduite à l'identique.
- **amélioré** : reproduite avec correction ou enrichissement (contrainte DB, audit, configurable, bug corrigé...). Quand l'inventaire donnait un autre verdict, l'écart est signalé « (inventaire : X) ».
- **abandonné** : non reproduite, justification donnée (code mort, faille, doublon, Imhotep, hors produit).
- **hors module -> NNN** : relève d'un autre module (004 academic, 009 people, 010 attendance, 018 examinations, 022/023 lms/virtual-school, 024 documents, 025 analytics, 032 payroll-port, 001 saas-core, 033 web-foundation).
- Verdicts de l'inventaire : **R** reproduire, **T** reproduire en transformant, **A** abandonner.

**Comment lire.** §1 tables (puis correspondance colonne à colonne pour l'import 031-imports) ; §2 fonctions par famille A..L (un ID legacy = une ligne) plus M (nouveautés v2 sans équivalent) ; §3 algorithmes et critères de conflit (SQL legacy -> critère cible) ; §4 règles implicites et défauts P-01..P-22 ; §5 constantes ; §6 synthèse chiffrée ; §7 points à trancher.

---

## 1. Tables legacy -> v2

| Table / objet legacy | Migration:ligne | Statut | Cible v2 | Justification |
|---|---|---|---|---|
| `time_slots` (grille de créneaux du tenant) | `0017_schedule_generation.sql:49-72` ; `0018_time_slots.sql:13-33` (`IF NOT EXISTS`, non appliquée) ; baseline `day_of_week VARCHAR(20)` | amélioré | `scheduling.time_slots` (`code`, `label`, `starts_time`, `ends_time`, `is_break`, `ordinal`, `active`, campus facultatif) | Grille conservée mais facultative (le supérieur planifie en plages libres, conflits calculés sur heures réelles). Ajouts : unicité `(tenant, institution, campus, code)` (le legacy n'avait aucun UNIQUE réel), `CHECK ends_time > starts_time`. Abandonnés : `day_of_week` (le jour est porté par `timetable_entries.weekday`), `priority` et `max_concurrent_sessions` (consommés seulement par l'optimiseur mort / non appliqués). Seeds codés sur le tenant « Imhotep Academy » (`0017:263-290`, `0018:49-97`) supprimés. |
| `session_instances` (cours daté d'une classe, seul objet de planning Académique) | `0027_cleanup_old_schedule_tables.sql:25-58` (= `0026_simplify_schedule_system.sql:27-60`) ; baseline `3101-3151` | amélioré | `scheduling.session_occurrences` (`kind = LESSON`, `origin` AD_HOC/GENERATED/IMPORT) + `occurrence_staff` | Texte libre `classroom` (défaut `'TBD'`) -> `room_id` clé ; `teacher_id` unique -> `occurrence_staff` (multi-intervenants) ; `status` `scheduled/completed/cancelled/rescheduled` (seul `scheduled` écrit) -> `PLANNED/HELD/CANCELLED` réellement alimentés ; `attendance_taken` (jamais écrit) -> dérivé de `attendance.sessions` ; `start_time/end_time/session_date` + `start/end_datetime` redondants -> `starts_at`/`ends_at` + `occurs_on` (date civile du fuseau établissement) + `during` généré ; aucun UNIQUE/EXCLUDE -> `resource_claims_no_overlap` + `occurrences_entry_date`. |
| `classrooms` (salles) | `0009_classrooms.sql:36-53` (enum `classroom_type` `:9-18`, enum `classroom_status`) | amélioré | `scheduling.rooms` + `scheduling.room_types` (donnée de pack) | `type` enum figé -> `room_type_code` (référentiel de pack, FK composite) ; `status` `disponible/occupe/maintenance/hors_service` + `is_active` -> `AVAILABLE/OUT_OF_SERVICE/ARCHIVED` (`occupe` n'était jamais calculé : état dérivé de l'occupation, non stocké ; `maintenance` et `hors_service` fusionnent en `OUT_OF_SERVICE`, détail dans `notes`) ; `code` unique par campus (majuscules normalisées) ; `capacity` sans défaut 30 ; `floor int` -> `floor_label` ; `description` -> `notes` ; `campus_id` obligatoire (spec 003). `equipment text[]` : cf. ligne suivante. Pas de DELETE (archivage). |
| `classrooms.equipment text[]` (libellés d'équipement) | `0009:36-53` ; UI `apps/web/src/components/academic/ClassroomForm.tsx:55-75` (20 libellés) | amélioré | `scheduling.equipment_items` (stock par campus) + `timetable_entry_equipment` / `occurrence_equipment` | Le legacy ne gérait aucune réservation d'équipement. Cible : équipement réservable = stock, conflit = dépassement de quantité (`occurrence_equipment_guard`). Aucune colonne « équipement fixe de la salle » : décision d'import à prendre (§7-Q5). |
| `classroom_reservations` | `0009:56-71` ; `EXCLUDE ... tstzrange '[)' WHERE status != 'cancelled'` `0009:103-109` (invisible dans la baseline Prisma) | amélioré | `session_occurrences` `kind = RESERVATION`, `room_id` obligatoire en pratique ; claims `ROOM` | La réservation de salle devient une occurrence : elle partage le même anti-chevauchement que les cours (le legacy ne voyait pas les séances). `reserved_by` -> `created_by` ; `course_id/class_id` -> `curriculum_node_id/classroom_id` (facultatifs, aucune réservation de classe pour `RESERVATION`). `status` `confirmed/pending/cancelled` (sans CHECK) -> `PLANNED/CANCELLED` (`pending` : pas de workflow d'approbation, §7-Q9). |
| `academic_calendar_events` | `0032_academic_calendar_events.sql:20-32` (enum `:7-14`) ; `UNIQUE (tenant, année, name, event_date)` | amélioré | `scheduling.calendar_events` + `calendar_event_kinds` | Une date -> plage `starts_on..ends_on` (+ heures facultatives, campus, audience STAFF/STUDENTS/GUARDIANS) ; `blocks_teaching` retire les jours de la génération (le legacy ne consommait jamais le calendrier) ; `type` enum -> `kind_code` (pack) ; `semester int` supprimé (période = `academic.academic_periods`, résolue par date) ; types `semester_start/semester_end` abandonnés comme événements (doublon des bornes de période de 004) ; UNIQUE legacy non reproduit (§7-Q7). |
| `exam_schedules` | `0033_exam_schedules.sql:19-33` ; `UNIQUE (tenant, course, name, exam_date)` | amélioré | `session_occurrences` `kind = EXAM` (+ `occurrence_staff` rôle `SUPERVISOR`, `room_id`, `classroom_id`) | Rattaché à un cours (pas à une classe) dans le legacy : l'import doit éclater sur les classes concernées (§7-Q6). Gagne conflits de salle/classe/surveillants. `type` midterm/final/quiz/assignment/other : pas de colonne cible dans le module (nature de l'évaluation = 011/018, §7-Q6). `location` texte libre -> `room_id` si rapprochement, sinon perdu (§7-Q5). `exam_time` et `duration` nullables -> `starts_at/ends_at` obligatoires (§7-Q4). Gestion des épreuves (convocations, surveillance) -> 018 (phase 4). |
| `teacher_attendance_sessions` (heures déclarées par l'enseignant, base de la paie Académique) | `0028_attendance_sessions.sql:11-42` + 0043:27-29 + DDL runtime `routes/teacher-attendance.ts:39-100` | abandonné | Heures payables Académique = `scheduling.payable_hours` sur occurrences `HELD` validées | Source indépendante de `session_instances`, durée **entière en heures**, `time_slot` libre, DDL recréé à l'exécution : tout cela disparaît avec l'agrégat unique. Dépendance à confirmer avec 010/032 (§7-Q12). |
| `attendance_sessions` (appel étudiants) et `classroom_id` (0016) | `0008_attendance.sql:41-74` ; `0016` | hors module -> 010 | `attendance.sessions` (porte `occurrence_id`) | Le pont `session_instances -> attendance_sessions` créé à la volée (SC-033 en §2) disparaît : l'appel s'ouvre sur une occurrence. |
| `live_sessions` (visio) | `0056_live_sessions.sql:17-46` ; `0069_pedagogie_ue_ecue.sql:488-504` (parent `professional_ecue_seance_id`, `CHECK exactly_one_parent` avalé par `EXCEPTION`) | hors module -> 022/023 | Lien : `session_occurrences.virtual_session_ref` (+ `delivery_mode`) | Le module planning ne porte que la référence ; salles LiveKit, jetons, webhooks, enregistrements = 022/023. Cardinalité : legacy 0..n visios par séance Pro, cible 1 référence (§7-Q10). |
| `live_session_recordings`, `live_session_attendances`, `live_session_webhook_events`, `student_attendance.marked_via` | `0056:72-90, 122-142, 168-172, 180` | hors module -> 022/023 (+ 010 pour `bulkMarkFromExternal`) | — | Présence automatique visio : appel externe consolidé par `attendance.bulkMarkFromExternal`. |
| `professional_ue_sessions` (cohorte = UE x dates) | `0069:139-157` (`classroom_id`, `enseignant_id` historiques) | hors module -> 004 | `academic.classroom_offerings` (référencée par `offering_id`) | Le nom de classe n'est plus déduit de `split_part(libelle,' — ',1)` (P-12). `enseignant_id`/`classroom_id` « de session » (modèle historique) : abandonnés comme défauts implicites ; portés par `timetable_entry_staff` / `rooms`. |
| `professional_session_ecue_teachers` (enseignant par (cohorte, ECUE)) | `0070_session_ecue_teachers.sql:13-23` | hors module -> 009 | `people.teaching_assignments` | Scheduling consomme `people.teaching_assignment.ended` et lit `listAssignmentsForClassroom`. |
| `professional_ecue_seances` (occurrence réelle : présence + paie) | `0069:166-180` ; `0103_remuneration_professionnelle.sql:73-103` ; `0104_seance_duree_payee.sql:38-65` ; `0129:53` | amélioré | `session_occurrences` + `occurrence_staff` (`paid_minutes`, `locked_at`, `lock_ref`) + `occurrence_changes` | Correspondance colonne à colonne en §1.1. Horaires nullables et `heure_fin >= heure_debut` -> `ends_at > starts_at` obligatoire ; `duree_payee numeric(5,2)` heures -> `paid_minutes` entiers ; `saisie_comptable` -> `origin = ACCOUNTING` ; FK `RESTRICT` de paie (0105) -> verrou `lockHours`. |
| `professional_ecue_attendance` | `0069:189-200` ; `0100`, `0101` | hors module -> 010 | `attendance.student_records` | Hors périmètre planning. L'appel soumis déclenche `HELD` (`attendance.session.submitted`). |
| `professional_emploi_temps` (grille hebdomadaire) | `0076_emploi_temps.sql:13-27` ; `0077_emploi_temps_dates.sql:5-13` | amélioré | `scheduling.timetables` + `timetable_entries` + `timetable_entry_staff` | `jour` ISO 1..7 -> `weekday` ; `date_debut/date_fin` NULLables -> `valid_from/valid_to` (repli sur l'emploi du temps) ; enseignant/salle -> `timetable_entry_staff` / `room_id` (FK composites ; le legacy n'avait que des FK simples) ; alternance A/B nouvelle ; aucun UNIQUE/EXCLUDE legacy -> conflits vérifiés à l'écriture (domaine) et imposés sur les occurrences. La notion d'« emploi du temps » (regroupement par `(date_debut, date_fin)`) devient une table `timetables` explicite avec statut. |
| `professional_course_plannings` (planning ponctuel) | `0072_course_planning.sql:13-27` ; `0073_course_planning_datetime.sql:12-58` | abandonné | `session_occurrences` `origin = AD_HOC`, `status = PLANNED` | Doublon fonctionnel de la séance et de la grille (aucun lecteur : vues étudiant/parent/owner/paie l'ignorent ; `owner-assiduite.service.ts:11-14`). La couche disparaît, la capacité « créneau daté ponctuel » reste via `createOccurrence`. Données reprises à l'import. |
| `professional_semestres`, `professional_semestre_sessions`, `professional_semestre_ue` | `0071:14,40` ; `0075:14` | hors module -> 004 | `academic.academic_periods` | Double chemin semestre->session (P-11) disparaît : un seul chemin (période académique). |
| `professional_ecue_hourly_rates` | `0103:109-146` | hors module -> 032 | Tarifs et bulletins dans payroll-port | Tarif jamais porté par le planning (aucun montant dans `scheduling`). |
| `payment_hour_details` (`seance_id`, `attendance_session_id`) | `0103:169-250` ; FK `seance_id ON DELETE RESTRICT` `0105_seance_detail_restrict.sql:37-41` | hors module -> 032 (lien : verrou) | `occurrence_staff.locked_at/lock_ref` via `lockHours`/`releaseHoursLock` | La FK RESTRICT brute (suppression -> 500) est remplacée par un verrou métier typé : une ligne verrouillée ne change plus (`scheduling.hours_locked`), l'occurrence ne peut pas bouger (`scheduling.occurrence_locked`). Tables de paie hors module. |
| `schedule_generation_requests` | `0017_schedule_generation.sql` ; `DROP` `0027:18` | abandonné | Remplacée par `scheduling.generation_runs` (journal immuable de `generateOccurrences`) | Encore lue par 3 routes (500 systématique, P-02). La génération est synchrone ; le journal ne contient que `created/skipped_blocked/skipped_conflict/warnings`. |
| `generated_schedules` | `0017` ; `DROP` `0027:17` | abandonné | — | Résultat en mémoire / table morte ; plus de « plan proposé » persistant (les occurrences sont le résultat). |
| `scheduled_sessions` | `0017` ; refaite `0025_schedule_consolidation.sql:87` ; `DROP` `0027:15` | abandonné | `timetable_entries` (patron) | Gabarit hebdomadaire persistant supprimé en 0027 ; remplacé par un patron explicite. |
| `approved_schedules` | `0025:23` ; `DROP` `0027:16` | abandonné | `timetables.status = PUBLISHED` | « Approuver » devient `publishTimetable` (statut + événement), sans table dédiée. |
| ancienne `session_instances` (avec `scheduled_session_id`) | `0025:158` ; recréée `0026:25`, `0027:14,25` | abandonné | — | Version intermédiaire ; schéma actuel = ligne `session_instances` ci-dessus. |
| vue `calendar_sessions` | `0024_calendar_sessions_view.sql:6-30` ; `DROP VIEW` `0027:11` | abandonné | `listOccurrences*` | Plus référencée. |
| enums `schedule_generation_status`, `week_pattern_type` (orphelins), `day_of_week` | `0017` | abandonné | `CHECK` ... `week_pattern IN ('EVERY','WEEK_A','WEEK_B')`, `weekday smallint 1..7` | Référentiels = données de pack ou `CHECK`, plus de types enum Postgres figés. |
| `reservations_temporaires` | `0039_reservations_temporaires.sql:20-31` (`REMOVE:imhotep (D7)`) | abandonné | — | **Pas une réservation de salle** : rétention de place de 15 min à l'inscription Imhotep (`services/inscription-pro.service.ts:308,1858`). Le concept de rétention d'offre relève de 004 (`expirePendingHolds`). |
| `sessions_professionnelles`, `session_formateurs`, `formateur_indisponibilites` | `0037` / `0046` / `0056_restore` / `0040` (`REMOVE:imhotep`) | abandonné | Disponibilités : `people.staff_availabilities` (009) | Calendrier et disponibilité des formateurs Imhotep : hors périmètre produit. |
| `professional_subject_*` | `0062-0068` ; `DROP` `0069:50-52` | abandonné | — | Déjà supprimées (remplacées par UE/ECUE). |
| `classes.classroom_id` (salle par défaut de la classe), `professional_ue_sessions.classroom_id`, `attendance_sessions.classroom_id` | `0015`, `0069`, `0016` | abandonné (scheduling) | `timetable_entries.room_id` / `session_occurrences.room_id` | Salle « par défaut » utilisée par l'assistant mort (`assignClassroom`) ; la salle est désormais portée par chaque patron/occurrence. FK `NO ACTION` sources de 500 (P-14) supprimées. |
| Politiques RLS `app.current_tenant_id` (0017) vs `app.tenant_id` | `0017:213` ; `0018:45` | amélioré | `kernel.enable_tenant_rls(...)` sur toutes les tables | Une seule forme de RLS forcée ; plus de collision de `CREATE POLICY`. |
| Contrats Zod `packages/contracts/src/{classrooms,schedule-generation,sessions}.ts` | — | amélioré | `packages/contracts/src/v2/scheduling.ts` | Les contrats legacy étaient importés sans valider (P-21) ; cible : schémas Zod réellement appliqués par chaque route. |

### 1.1 Correspondance de valeurs et de colonnes (à l'usage de 031-imports)

Les UUID legacy sont conservés comme `id` des occurrences importées pour la traçabilité (`origin = IMPORT`).

| Source legacy | -> Cible v2 |
|---|---|
| `session_instances.class_id` / `course_id` / `teacher_id` | `classroom_id` / `curriculum_node_id` / `occurrence_staff` (`LEAD`), via les correspondances d'import de 004 et 009 |
| `session_instances.start_datetime/end_datetime` | `starts_at/ends_at` (source de vérité, plutôt que `session_date` + heures mixant UTC et heure serveur, P-07) ; `occurs_on` recalculé dans le fuseau établissement |
| `session_instances.classroom` (texte, `'TBD'`) | `room_id` par rapprochement de nom/code, sinon NULL ; `'TBD'` -> NULL |
| `session_instances.status` | `scheduled` -> `PLANNED` ; `cancelled` -> `CANCELLED` (+ motif imposé par `CHECK`, valeur d'import) ; `completed` -> `HELD` ; `rescheduled` -> historique `occurrence_changes` (pas un état) |
| `session_instances.notes`, `classroom_reservations.description` | **pas de colonne `notes` sur `session_occurrences`** (§7-Q5) |
| `professional_ecue_seances.statut` | `planifiee` -> `PLANNED` ; `realisee` -> `HELD` (`held_source` = `ATTENDANCE` si des présences existent, sinon `ADMIN`) ; `annulee` -> `CANCELLED` (+ motif d'import) |
| `statut_modifie_par/le` ; `validated_by/at` ; `cree_par` | `held_by/held_at` ou `cancelled_at` ; `validated_by/validated_at` ; `created_by` |
| `duree_payee` (heures, numeric(5,2)) + `duree_payee_par/le` | `occurrence_staff.paid_minutes = round(h x 60)` + `paid_minutes_by/at` (arrondi à la minute, §7-Q4) |
| `saisie_comptable = true` | `origin = ACCOUNTING` (aucune réservation de ressources) |
| `enseignant_id` (séance ou créneau) | `occurrence_staff` / `timetable_entry_staff` rôle `LEAD` ; NULL -> aucune ligne (jamais payable, comme `SANS_ENSEIGNANT`) |
| `payment_hour_details.seance_id` d'un paiement `approved`/`paid` | `lockHours(lock_ref = identifiant paie)` — import coordonné avec 032 |
| `professional_emploi_temps` groupé par `(semestre/période, date_debut, date_fin)` | une `timetables` par (établissement, année, période, campus) (index `timetables_one_published`) ; les bornes propres à chaque ancien groupe -> `timetable_entries.valid_from/valid_to` |
| `professional_course_plannings` (`date`, `heure_debut`, `heure_fin?`, `titre`) | `session_occurrences` `AD_HOC` `PLANNED` ; `heure_fin` NULL : §7-Q4 |
| `classroom_reservations.status` | `confirmed`, `pending` -> `PLANNED` ; `cancelled` -> `CANCELLED` ; `academic_year_id` déduit de la date (`academic.resolvePeriodForDate`) |
| `exam_schedules` (`exam_date`, `exam_time`, `duration`) | `starts_at` = date + heure (fuseau) ; `ends_at` = + `duration` ; NULL : §7-Q4 |
| `academic_calendar_events.type` | `holiday` -> kind férié (`blocks_teaching_default = true`) ; `break` -> kind vacances (idem) ; `special_event` -> kind événement ; `academic_milestone` -> kind jalon ; `semester_start/_end` -> non importés comme événements (bornes de période de 004). Une ligne par jour fusionnable en plage à l'import (même nom, jours consécutifs). Codes de kinds = données de pack. |
| `classrooms.type` (8 valeurs) / `status` | `room_types` de pack (AMPHITHEATRE, SALLE_COURS, LABORATOIRE, SALLE_INFORMATIQUE, ATELIER, BIBLIOTHEQUE, SALLE_REUNION, AUTRE) / `AVAILABLE` (`disponible`, `occupe`), `OUT_OF_SERVICE` (`maintenance`, `hors_service`), `ARCHIVED` (`is_active = false`) |

---

## 2. Fonctions et endpoints par famille

Statut en 4 valeurs (légende de l'en-tête). « Cible » : cas d'usage du brief, route `/api/v1/scheduling/...`.

### 2.A Créneaux horaires et assistant de génération (Académique)

| ID | Fonction | Fichier:ligne | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| SC-001 | Lister créneaux (`GET /schedule-generation/time-slots`) | `routes/schedule-generation.ts:38` | amélioré | `GET /time-slots` (lecture ; cas d'usage de lecture à nommer, §7-Q15) | Tri par `ordinal, starts_time` (le tri par `day_of_week` était alphabétique si la colonne est VARCHAR, « friday » avant « monday »). Filtres : `active`, campus. `priority` abandonné. (inventaire : T) |
| SC-002 | Créer créneau (`POST /time-slots`) | `schedule-generation.ts:119` | amélioré | `upsertTimeSlot` (`POST/PUT /time-slots`), `deleteTimeSlot` (désactivation : pas de GRANT DELETE sur `time_slots`, §7-Q8) | Unicité par `code` (legacy : doublons libres), `time` natif (le legacy comparait des chaînes `HH:MM:SS`), PUT/DELETE inexistants dans le legacy fournis, permission `schedule.manage` (legacy sans garde de rôle, P-10). `priority`/`maxConcurrentSessions` abandonnés. |
| SC-003 | Options de génération d'une classe | `schedule-generation.ts:202` | abandonné | `suggestSlots` + `academic.listNodesForClassroom` | Assistant supprimé (déc. conception (e)) ; renvoyait tous les cours du tenant (`class_courses` ignoré), `availableClassrooms: []` en dur, 404 si la classe n'avait pas de programme. |
| SC-004 | Générer (`POST /generate`) | `schedule-generation.ts:320` | abandonné | `generateOccurrences` (patron -> dates) + `suggestSlots` | Glouton factice (« génétique » = faux), horizon 1 mois en dur, résultat en `Map` mémoire, `userId` de test codé en dur (`:362`), `conflictsResolved` = conflits détectés. Un solveur complet est une question ouverte (§7-Q1). |
| SC-005 | Statut d'une demande | `schedule-generation.ts:493` | abandonné | `generation_runs` (génération synchrone) | Lisait une table supprimée (500) ; plus de demande asynchrone. |
| SC-006 | Résultat / alternatives | `schedule-generation.ts:593` | abandonné | Résultat de `generateOccurrences` journalisé dans `generation_runs` | Alternatives jamais produites ; tables lues supprimées. |
| SC-007 | Approuver le planning généré | `schedule-generation.ts:714` | abandonné | `publishTimetable` + `generateOccurrences` (transactionnels) | Succès factice : persistance dans des tables supprimées, erreur avalée (`:809-814`, P-01) ; fausse transaction `BEGIN/COMMIT` sur `pool.query`. (inventaire : A « ré-implémenter proprement » -> fait par `publishTimetable`.) |
| SC-008 | Historique des demandes | `schedule-generation.ts:848` | abandonné | `generation_runs` (immuable) ; route de lecture à prévoir (§7-Q15) | 500 systématique (table supprimée). |
| SC-009 | Calendrier d'une classe | `schedule-generation.ts:952` | conservé | `listOccurrencesForClassroom` (`GET /views/classroom/:id?from&to`) | Même service de lecture ; fenêtre `from/to` explicite (défaut legacy = min/max des séances) ; `view` week/month/semester sans effet legacy = choix client. |
| SC-010 | Stats de planning d'une classe | `schedule-generation.ts:1018` | amélioré | Agrégats sur `listOccurrencesForClassroom` (nombre, minutes, `HELD`, `CANCELLED`) ; présentation 025 | `completed`/`cancelled` étaient toujours 0 (statuts jamais écrits) ; désormais réels. (inventaire : T) |

### 2.B Moteur de génération (service)

| ID | Fonction | Fichier:ligne | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| SC-011 | `ScheduleGeneratorService.generateSchedule` (orchestration) | `services/ScheduleGeneratorService.ts:45` | abandonné | `generateOccurrences` + `suggestSlots` | (inventaire : T) Écart assumé : pipeline « validate -> candidates -> optimise -> score » sans substance ; seule l'expansion patron -> dates est reprise (§3.3). |
| SC-012 | `validateGenerationContext` | `ScheduleGeneratorService.ts:86` | abandonné | Faisabilité = absence de conflit (`previewConflicts`) | (inventaire : T) Le contrôle « heures requises vs heures disponibles » ne bloquait rien (simple log). |
| SC-013 | `enrichContext` (enseignant par cours, capacités, salle par défaut) | `ScheduleGeneratorService.ts:113` | hors module -> 009 | `people.listAssignmentsForClassroom` -> `timetable_entry_staff` | (inventaire : T) Affectations sans filtre statut/dates (la dernière gagnait dans la `Map`) : la résolution d'affectation active est portée par 009 ; salle par défaut abandonnée (cf. §1). |
| SC-014 | `generateSessionCandidates` | `ScheduleGeneratorService.ts:170` | abandonné | — | Code mort (résultat inutilisé) coûteux en requêtes `SELECT name FROM courses`. |
| SC-015 | `optimizeSchedule` (glouton) | `ScheduleGeneratorService.ts:235` | abandonné | — (`suggestSlots` pour l'aide au placement) | (inventaire : T) Préférences, `maxSessionsPerWeek`, `preferredSessionDuration`, `balanceWorkload`, `maxDailyHours`, `allowWeekendSessions` ignorés (P-03). |
| SC-016 | `assignClassroom` (salle aléatoire) | `ScheduleGeneratorService.ts:372` | abandonné | `suggestSlots` propose des salles réelles (type, capacité, disponibilité) | Noms fictifs (`Salle A1`, `Lab Info 1`...) tirés au hasard (`:379`). |
| SC-017 | `detectConflicts` / `checkTimeOverlap` | `ScheduleGeneratorService.ts:384` / `:433` | amélioré | `previewConflicts` (domaine) + `scheduling.find_conflicts` (SQL) | (inventaire : T) Recouvrement strict conservé ; ajoute conflits **classe, salle, équipement**, entre plans et avec l'existant ; sévérité high/critical -> politique `BLOCK`/`WARN` ; `room_conflict`/`capacity_exceeded` (déclarés, jamais produits) deviennent réels. |
| SC-018 | `calculateOptimizationScore` | `ScheduleGeneratorService.ts:442` | abandonné | — | Score « sans signification » (manque calculé vs total, alloué = quota hebdo). |

### 2.C Persistance et lecture du planning Académique

| ID | Fonction | Fichier:ligne | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| SC-019 | `SchedulePersistenceService.persistApprovedSchedule` (+ `createApprovedSchedule`, `createScheduledSessions`, `generateSessionInstances`, `generateDateInstances`, `calculateSmartEndDate`, `getDefaultEndDate`) | `services/SchedulePersistenceService.ts:38` (`:65,91,127,174,216,245`) | amélioré | `generateOccurrences` | (inventaire : T) L'expansion « première date >= début de même jour de semaine, pas de +7 jours, fin incluse » est reprise (§3.3) avec : fuseau établissement (le legacy mélangeait `toISOString()` et `setHours` local), jours bloqués du calendrier, détection de conflit à l'écriture, idempotence (`occurrences_entry_date`), bornes réelles de l'emploi du temps. `calculateSmartEndDate` (fin = nb max de séances d'un jour en semaines, P-06) et `getDefaultEndDate` (inutilisé) abandonnés ; `approved_schedules`/`scheduled_sessions` supprimées. |
| SC-020 | `getScheduleCalendar` / `getScheduleStats` | `SchedulePersistenceService.ts:252` / `:326` | amélioré | `listOccurrencesForClassroom` / `listOccurrencesForStaff` | (inventaire : R) Le repli sur `teacher_assignments` valide à la date (LATERAL, ordre active > paused > ended > cancelled) disparaît : l'intervenant réel est stocké dans `occurrence_staff`. `EXTRACT(DOW)` (0 = dimanche) -> `weekday` ISO. |
| SC-021 | `simple-schedule/generate` | `routes/simple-schedule.ts:45` | amélioré | `upsertTimetableEntry` (x N) puis `generateOccurrences` | (inventaire : T) Sélection hebdomadaire jour x créneau x cours x enseignant = exactement un patron. Corrige : aucun conflit contrôlé, pas de transaction, dépassement du `hours_total`, fuseau serveur, `'TBD'`. Le **plafond au volume horaire du cours** (`hours_total`) n'est pas reproduit par la génération (bornée par dates) : §7-Q2. |
| SC-022 | `simple-schedule/calendar/:classId` | `simple-schedule.ts:245` | amélioré | `listOccurrencesForClassroom` | (inventaire : R) Sans filtre de dates dans le legacy -> fenêtre obligatoire/paginée ; enseignant via `occurrence_staff` (plus de double recherche users puis teachers). |
| SC-023 | `generate-missing-sessions` (`POST /teacher-assignments/generate-missing-sessions`, alias `/teacher/assignments/...`) | `routes/teacher-assignments.ts:450` | amélioré | `suggestSlots` + `generateOccurrences` ; affectations : `people.listAssignmentsForClassroom` | (inventaire : T) L'idée « placer une séance par semaine pour chaque affectation sans séance » devient une aide au placement ; grille par défaut codée (`DEFAULT_WEEKLY_SLOTS` lun-ven x 08-10/10-12, `:50-61`), rotation (au plus 10 cours simultanés), `max(hours_total,2)`, saut de conflit par essai-erreur, `x-user-id` abandonnés. Critère de conflit (c) conservé (§3.1). |
| SC-024 | Séances d'un enseignant (`GET /teacher-assignments/scheduled-sessions`) | `teacher-assignments.ts:1272` | amélioré | `listOccurrencesForStaff` (`GET /views/staff/:id`, `/me/today`) | (inventaire : R) Identité depuis le JWT (`people.resolveStaffForIdentity`), plus de confiance dans `x-user-id` (usurpation) ; filtre année = `academicYearId` explicite (plus `x-academic-year-id`). |
| SC-025 | Calendrier enseignant + stats | `teacher-assignments.ts:1416` | amélioré | `listOccurrencesForStaff` ; `getStaffWeeklyLoad` (stats) | (inventaire : R) Mêmes corrections que SC-024 ; `completed/cancelled` désormais réels. |

### 2.D Séances datées Académique

| ID | Fonction | Fichier:ligne | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| SC-026 | Lister mes séances (`GET /sessions?start&end`) | `routes/sessions.ts:7` | amélioré | `listOccurrences` (`schedule.read`), `listOccurrencesForStaff` (`schedule.own.read`), `/me/today` | (inventaire : T) Un admin non-enseignant voyait tout, un admin-enseignant seulement les siennes : le périmètre est explicite par permission (`read` vs `own.read`). Fenêtre : inclusion complète (`start >= start AND end <= end`) -> recouvrement de fenêtre `[from,to)` (§7-Q15). |
| SC-027 | Créer une séance (`POST /sessions`) | `sessions.ts:88` | amélioré | `createOccurrence` (`origin = AD_HOC`) + `setOccurrenceStaff` | (inventaire : T) L'enseignant n'est plus l'appelant (un admin peut planifier pour un tiers, P-09) ; conflit enseignant/classe/salle imposé (§3.1), `cancelled` ne bloque plus ; heures en fuseau établissement (le legacy : `sessionDate` UTC + `toTimeString` local, `:131-133`) ; création par l'enseignant lui-même : permission à préciser (§7-Q11). |
| SC-028 | Modifier une séance (`PATCH /sessions/:id`) | `routes/sessions.update.ts:6` | amélioré | `rescheduleOccurrence`, `changeOccurrenceRoom`, `setOccurrenceStaff`, `substituteStaff` | (inventaire : T) Début/fin modifiés ensemble (le legacy laissait fin/durée incohérentes si seul le début changeait) ; changement d'enseignant/salle désormais possible ; séance validée ou verrouillée = refus DB ; journal `occurrence_changes`. |
| SC-029 | Supprimer une séance | `sessions.ts:182` | amélioré | `cancelOccurrence` (motif obligatoire) | (inventaire : T) Plus de DELETE physique (trigger `occurrences_no_delete`, pas de GRANT DELETE) ; la séance annulée libère ses ressources (`cancel_frees_claims`). |
| SC-030 | Liste pour appel (`GET /attendance/session-instances`) | `routes/session-instances.ts:20` | amélioré | `listOccurrences` (filtres classe, nœud, intervenant, statut, dates ; pagination) | (inventaire : T) `Europe/Paris` en dur (`:202-206`) -> `settings.timezone` (défaut `Africa/Abidjan`) ; l'API rend `starts_at` + `occurs_on`, le client formate. `attendanceTaken` (jamais alimenté) : dérivé côté 010. |
| SC-031 | Détail séance + élèves | `session-instances.ts:226` | amélioré | `getOccurrence` ; élèves : hors module -> 004 (`getRoster`) / 010 | (inventaire : R) Le détail reste dans scheduling ; la liste des élèves actifs (`student_enrollments.status = 'active'`) est portée par 004/010. |
| SC-032 | Supprimer (`DELETE /attendance/session-instances/:id`) | `session-instances.ts:346` | abandonné | — (`cancelOccurrence`) | Doublon de SC-029 (suppression physique). |
| SC-033 | Pont séance -> appel (`POST /attendance/sessions/:sessionId/batch`, branche `session_instance`) | `routes/attendance.ts:865` (pont `:905-1050`) | hors module -> 010 | `attendance.openAttendanceSession(occurrenceId)` ; scheduling consomme `attendance.session.submitted` -> `HELD` | (inventaire : T) Création d'`attendance_sessions` et de `class_courses` « à la volée » supprimée ; `attendance_taken` jamais mis à jour -> remplacé par le constat `HELD`. |
| SC-034 | Emploi du temps élève (`GET /student/courses/schedule`) | `routes/student-courses.ts:833` | amélioré | `listOccurrencesForStudent` (`GET /views/student/:id`, `/me/today`) | (inventaire : R) Rattachement via inscription (`academic`, classe ou offre à la carte) ; fenêtre par défaut −7/+21 j (`:894-895`) = paramètre client ; résolution du tenant par `LOWER(name)` abandonnée (contexte de tenant). Les occurrences `CANCELLED` sont exposées avec leur statut (§7-Q15). |
| SC-035 | Emploi du temps enfant (parent) Acad + Pro fusionnés (`GET /parent/children/:childId/schedule`, `.../upcoming-classes`) | `routes/parent-children.ts:752` / `:1179` (`fetchProfessionalSchedule` `:45`, salle de repli `:65-89`) | amélioré | `listOccurrencesForStudent` via `GET /children/:studentId/timetable` (`schedule.child.read`) | (inventaire : R) La fusion de deux tables et le repli « salle de la grille de même (cohorte, ECUE, ISODOW, heure_debut) » disparaissent (agrégat unique, `room_id` posé à la génération) ; exclusion de la Conduite par `academic is_transversal` et non par libellé ; logs de debug supprimés. |
| SC-036 | Clonage des `time_slots` à la création de tenant | `services/tenant-provisioning.service.ts:46,179,465` | amélioré | Consommation de `tenancy.tenant.provisioned` : référentiels de pack (`room_types`, `calendar_event_kinds`, grille type éventuelle) | (inventaire : R) Plus de clonage depuis un tenant source ni de seed sur un UUID de tenant en dur. |

### 2.E Salles, équipements, réservations

| ID | Fonction | Fichier:ligne | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| SC-040 | Lister salles (`GET /classrooms`) | `routes/classrooms.ts:15` | amélioré | `GET /rooms` (filtres type, statut, bâtiment, campus) ; `includeReservations` -> `listOccurrencesForRoom` | (inventaire : R) Les « réservations » ne sont plus un objet à part : cours, examens et réservations d'une salle sont visibles ensemble ; total de pagination cohérent. |
| SC-041 | Détail salle | `classrooms.ts:177` | amélioré | `GET /rooms/:id` + `listOccurrencesForRoom` | (inventaire : R) Idem SC-040. |
| SC-042 | Créer salle | `classrooms.ts:263` | amélioré | `createRoom` (`schedule.room.manage`) | (inventaire : T) Validation Zod réellement appliquée (le legacy importait `CreateClassroomSchema` sans l'utiliser : type/statut invalides -> 500) ; 23505 -> conflit métier ; type = référentiel de pack. |
| SC-043 | Modifier salle (`PUT /classrooms/:id`) | `classrooms.ts:329` | amélioré | `updateRoom` | (inventaire : T) **Injection SQL / mass-assignment** (colonnes dérivées des clés du body, `:374-382`) supprimée : schéma explicite, tenant jamais modifiable ; `location` (colonne inexistante) disparaît ; longueur de code 50 alignée. |
| SC-044 | Supprimer salle | `classrooms.ts:440` | amélioré | `setRoomStatus` (`OUT_OF_SERVICE` / `ARCHIVED`) | (inventaire : T) Pas de DELETE : le COUNT sans filtre tenant et les FK `NO ACTION` (500, P-14) disparaissent ; une salle non `AVAILABLE` refuse toute nouvelle affectation (`occurrences_guard`, `room_unavailable`). Sort des occurrences futures déjà affectées : §7-Q13. |
| SC-045 | Lister réservations | `routes/classroom-reservations.ts:11` | amélioré | `listOccurrences` (`kind = RESERVATION`) / `listOccurrencesForRoom` | (inventaire : R) Comparaisons date-only vs timestamptz corrigées par `tstzrange`. |
| SC-046 | Créer réservation | `classroom-reservations.ts:216` | amélioré | `createOccurrence` (`kind = RESERVATION`, `room_id`) | (inventaire : T) Anti-chevauchement `[)` conservé (§3.1) mais **vu par les cours** ; salle `OUT_OF_SERVICE` refusée (le legacy acceptait `hors_service`) ; 23P01 mappé en `scheduling.conflict_detected` (plus de 500) ; validation d'entrée. |
| SC-047 | Modifier réservation | `classroom-reservations.ts:295` | amélioré | `rescheduleOccurrence`, `changeOccurrenceRoom` | (inventaire : T) Le conflit est re-testé (le legacy ne s'appuyait que sur l'EXCLUDE, d'où 500 brut) ; mass-assignment de `reserved_by`/`tenant_id`/`status` supprimé. |
| SC-048 | Annuler réservation | `classroom-reservations.ts:393` | amélioré | `cancelOccurrence` | (inventaire : T) Annulation logique conservée, motif obligatoire ; règle « créateur uniquement » remplacée par permissions (`schedule.manage` / créateur, §7-Q9). |

### 2.F Calendrier académique et examens

| ID | Fonction | Fichier:ligne | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| SC-050 | Lister événements | `routes/academic-calendar-events.ts:21` | amélioré | `GET /calendar-events` (plage, kind, campus, année, audience) | (inventaire : R) Filtre `semester` remplacé par la période académique (004) ; en-tête `x-academic-year-id` remplacé par paramètre. |
| SC-051 | Créer événement | `academic-calendar-events.ts:204` | amélioré | `createCalendarEvent` (`schedule.calendar.manage`) ; événement `scheduling.calendar_event.created` | (inventaire : T) Plage de dates (vacances = un événement, non N événements ponctuels), `blocks_teaching`, heures facultatives, rôle contrôlé (le legacy : aucune garde). Année vérifiée via 004. |
| SC-052 | Modifier événement | `academic-calendar-events.ts:356` | amélioré | `updateCalendarEvent` ; `scheduling.calendar_event.updated` | (inventaire : T) `academicYearId` modifiable (ignoré au legacy) ; doublon : 23505 non mappé au legacy -> règle explicite (§7-Q7). |
| SC-053 | Supprimer événement | `academic-calendar-events.ts:542` | conservé | `deleteCalendarEvent` (DELETE autorisé sur `calendar_events`) | Suppression physique conservée (référentiel d'affichage) ; événement `calendar_event.deleted` absent du brief (§7-Q8). |
| SC-054 | Calendrier côté parent | `routes/parent-academic.ts:475` | amélioré | `GET /calendar-events` filtré `audience` contient `GUARDIANS` (`schedule.child.read`) | (inventaire : R) Audience explicite (le legacy renvoyait tous les événements du tenant) ; tolérance « table inexistante -> [] » (reliquat de déploiements partiels) abandonnée. |
| SC-055 | Lister examens | `routes/exam-schedules.ts:23` | amélioré | `listOccurrences` (`kind = EXAM`) | (inventaire : R) Filtres cours -> nœud, année, dates. |
| SC-056 | Créer examen | `exam-schedules.ts:216` | amélioré | `createOccurrence` (`kind = EXAM`) + `setOccurrenceStaff` (`SUPERVISOR`) | (inventaire : T) Gagne conflits classe/salle/surveillant ; `ZodError` hors try/catch (500, `:246`) corrigé ; cours/année validés pour le tenant ; gestion avancée des épreuves -> 018. |
| SC-057 | Modifier / supprimer examen | `exam-schedules.ts:320` ; `:475` | amélioré | `rescheduleOccurrence` / `cancelOccurrence` | (inventaire : R) Suppression physique -> annulation motivée. |
| SC-058 | Examens côté parent | `parent-academic.ts:658` | amélioré | `listOccurrencesForStudent` (`kind = EXAM`) / `GET /children/:studentId/timetable` | (inventaire : R) Les doublons de jointure (plusieurs inscriptions) disparaissent. |

### 2.G Professional — planning daté (`course_plannings`)

| ID | Fonction | Fichier:ligne | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| SC-060 | Sessions planifiables (`GET /professional/planning/sessions`) | `routes/professional.ts:956` ; `services/professional-planning.service.ts:45` | hors module -> 004 | `academic.listOfferings` + garde `OfferingReadinessGuard` | (inventaire : T) Règle legacy : seule la cohorte `ouvert` est planifiable (une cohorte `en_cours` ne l'est plus : défaut). Cible : planifiable tant que l'offre n'est ni terminée ni annulée (§7-Q14). |
| SC-061 | ECUE d'une session | `professional.ts:967` ; planning service `:72` | hors module -> 004 | `academic.listNodesForClassroom` / `listNodesForEnrollment` | (inventaire : R) Sélecteur de nœuds de l'offre. |
| SC-062 | Lister les plannings (`from`/`to`) | `professional.ts:979` ; service `:104` | amélioré | `listOccurrences` / `listOccurrencesForStaff` (`origin = AD_HOC`) | (inventaire : R) Même fenêtre ; portée enseignant par `schedule.own.read`. |
| SC-063 | Créer un planning | `professional.ts:993` ; service `:196` (`resolveSessionEcue` `:155`) | amélioré | `createOccurrence` (`origin = AD_HOC`, `offering_id`, `curriculum_node_id`) | (inventaire : T) Contrôles ECUE ∈ UE (port 004) et enseignant affecté à l'ECUE (port 009) conservés ; ajoute conflits enseignant/classe/salle (aucun au legacy), `ends_at > starts_at` natif (le legacy comparait des chaînes) ; contrôle de la date dans la fenêtre de l'offre : §7-Q14. |
| SC-064 | Modifier / supprimer un planning | `professional.ts:1012, 1032` ; service `:238, :289` | amélioré | `rescheduleOccurrence` / `cancelOccurrence` | (inventaire : T) `enseignant_id` non rafraîchi au legacy -> `setOccurrenceStaff` explicite. |

### 2.H Professional — emploi du temps hebdomadaire (`professional_emploi_temps`)

| ID | Fonction | Fichier:ligne | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| SC-070 | Clause « session encore ouverte » (`OPEN_SESSION_CLAUSE`) | `services/professional-emploi-temps.service.ts:21-22` | abandonné | `timetables.status` / `valid_to` + statut d'offre (004) | (inventaire : T) La clause SQL (`statut NOT IN ('termine','annule') AND date_fin >= CURRENT_DATE`, compensant un statut stocké en retard) n'a plus d'objet : le statut d'offre est piloté par événements `academic.offering.*`. |
| SC-071 | Filières / noms / semestres avec session ouverte | `professional.ts:821, 812, 831` ; service `:25, :49, :67` | hors module -> 004 | `academic.listPrograms` / `listClassrooms` / `listAcademicPeriods` | (inventaire : T) Le nom de classe n'est plus `btrim(split_part(libelle,' — ',1))` (P-12) mais `academic.classrooms.name`. |
| SC-072 | Filières / semestres ayant un EDT | `professional.ts:845, 855` ; service `:87, :104` | amélioré | `GET /timetables` (filtres année, période, classe) | (inventaire : R) Liste des emplois du temps explicites. |
| SC-073 | Options de consultation (+ année scolaire pivot septembre) | `professional.ts:802` ; service `:136` | amélioré | `GET /timetables` + `academic.getCurrentAcademicYear` / `resolvePeriodForDate` | (inventaire : R) Le pivot du 1er septembre (dérivé, non stocké) disparaît : l'année est une entité (`academic.academic_years`). |
| SC-074 | Périodes d'un semestre (un « emploi du temps » = `(date_debut, date_fin)` distincts) | `professional.ts:866` ; service `:166` | amélioré | `timetables` + `valid_from/valid_to` des entrées | (inventaire : T) La notion implicite devient une table avec statut `DRAFT/PUBLISHED/ARCHIVED`, clonage (`cloneTimetable`) et un seul publié par (établissement, année, période, campus). |
| SC-075 | Grille d'un semestre | `professional.ts:877` ; service `:188` | conservé | `GET /timetables/:id/entries` | Lecture de la grille (jour, heures, UE/ECUE, intervenant, salle) ; passe par la période académique (plus par `professional_semestre_sessions`, P-11). |
| SC-076 | ECUE programmables | `professional.ts:892` ; service `:252` | hors module -> 009 | `people.listAssignmentsForClassroom` + `academic.listNodesForClassroom` | (inventaire : R) Croisement offres x nœuds x enseignant affecté : données d'affectation hors scheduling. |
| SC-077 | Créer un créneau | `professional.ts:902` ; service `createSlot :380` | amélioré | `upsertTimetableEntry` (`timetable_entry_staff`, `timetable_entry_equipment`) | (inventaire : T) **Conflits enseignant/salle/cohorte contrôlés à l'écriture** (BLOCK/WARN) — absents du legacy ; enseignant et salle vérifiés (existence, statut, tenant) ; `time` natif ; écriture groupée de N créneaux à rendre atomique (§7-Q16). |
| SC-078 | Modifier un créneau | `professional.ts:924` ; service `updateSlot :415` | amélioré | `upsertTimetableEntry` | (inventaire : T) Revalidation applicative des heures/dates (le legacy laissait les CHECK SQL produire 23514 -> 500). Propagation aux occurrences futures `PLANNED` : §7-Q3. |
| SC-079 | Supprimer un créneau | `professional.ts:943` ; service `:444` | amélioré | `removeTimetableEntry` | (inventaire : R) Légacy sans cascade vers les séances ; ici la FK `timetable_entry_id` sans `ON DELETE` interdit la suppression d'un patron ayant des occurrences : on borne `valid_to` et on annule les futures (§7-Q3). |
| SC-080 | Emploi du temps étudiant (`requireStudent`) | `professional.ts:3342` ; service `:276 / :319` | amélioré | `listOccurrencesForStudent` / `GET /views/student/:id` | (inventaire : T) Fenêtre de dates ajoutée (le legacy renvoyait tous les créneaux, même périmés, P-22) ; doublons si cohorte dans 2 semestres supprimés ; Conduite exclue via `is_transversal` ; inscription via 004 (classe ou à la carte). |
| SC-081 | Emploi du temps enfant (`requireParent`) | `professional.ts:3401` ; service `:296` | amélioré | `GET /children/:studentId/timetable` | (inventaire : R) Lien tuteur vérifié par `people.isGuardianOfStudent`. |
| SC-082 | Emploi du temps enseignant (`requireTeacher`) | `professional.ts:3634` ; `services/professional-teacher.service.ts:235` | amélioré | `listOccurrencesForStaff` / `GET /views/staff/:id` / `/me/today` | (inventaire : T) Basé sur l'intervenant réel (`occurrence_staff`), plus sur l'enseignant du créneau (dérive avec l'affectation). |
| SC-083 | Export Word/PDF de la grille (`emploi-temps-{model,docx,pdf}.ts`) | `apps/web/src/lib/emploi-temps-model.ts:9-10,57-60` | hors module -> 024 | Données : `listOccurrences*` + `exportTimetableIcs` ; rendu : documents | (inventaire : T) En-tête « République de Côte d'Ivoire / Ministère / IPAM » codé en dur -> paramètres d'établissement ; troncature des minutes (`hourOf`) et dimanche invisible = défauts d'export. |

### 2.I Professional — séances, affectations, présences

| ID | Fonction | Fichier:ligne | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| SC-090 | Affecter un enseignant à un ECUE de cohorte (`GET/PUT /ue-sessions/:id/ecue-teachers`) | `professional.ts:1167, 1177` ; `services/professional-ue.service.ts:1042, 1076` | hors module -> 009 | `people.createTeachingAssignment` / `replaceTeachingAssignment` | (inventaire : R) Règle « Conduite jamais affectée » (`CONDUITE_NO_TEACHER`) portée par `is_transversal` (004/009). Scheduling consomme `people.teaching_assignment.ended` (vers `replacement_needed`/signalement). Changer l'affectation ne modifiait ni grille ni séances au legacy : propagation à préciser (§7-Q3). |
| SC-091 | Lister séances d'une cohorte | `professional.ts:1045` ; ue service `:964` | amélioré | `listOccurrences` (filtre `offering_id`) | (inventaire : R) Tri `starts_at`. |
| SC-092 | Créer séance (admin/enseignant générique) | `professional.ts:1055` ; ue service `createSeance :912` | amélioré | `createOccurrence` (`AD_HOC`) / `createAccountingOccurrence` | (inventaire : T) Conflits imposés ; salle et enseignant validés ; scope enseignant corrigé (P-16 : le legacy laissait tout enseignant créer/modifier/supprimer toute séance de toute cohorte) ; `enseignant_id` NULL (séance impayable) -> intervenant explicite. |
| SC-093 | Modifier / supprimer séance (`PATCH/DELETE /seances/:seanceId`) | `professional.ts:1074, 1093` ; ue service `:982, :1025` | amélioré | `rescheduleOccurrence`, `changeOccurrenceRoom`, `setOccurrenceStaff`, `cancelOccurrence` | (inventaire : T) **Modification/suppression d'une séance validée ou payée impossibles (DB)** : `occurrence_validated`, `occurrence_locked`, `hours_locked`, `occurrences_no_delete` ; le legacy ne dévalidait pas et produisait un 500 (FK RESTRICT 0105). |
| SC-094 | Espace enseignant : séances (`GET/POST /teacher/sessions/:id/seances`, `GET/DELETE /teacher/seances/:seanceId`) | `professional.ts:3659, 3687, 3712, 3726` ; `professional-teacher.service.ts:341, 383, 269, 432` | amélioré | `listOccurrencesForStaff` (`schedule.own.read`) ; création/constat : `holdOccurrence` (`schedule.occurrence.hold`) | (inventaire : R) « L'enseignant ne voit/crée/supprime que ses ECUE » (`teacherOwnsSessionEcue`) -> périmètre par permissions et intervenant ; la séance existe d'avance (générée), l'enseignant la constate au lieu de la créer ; suppression -> annulation. Création libre par l'enseignant : §7-Q11. |
| SC-095 | Présences d'une séance (`GET/POST /seances/:seanceId/attendance`, variante `/teacher/...`) + bascule `planifiee -> realisee` | `professional.ts:1197, 1207, 3740, 3754` ; ue service `:1135 / :1177` ; teacher `:485, :514` ; `services/professional-seance-constat.ts:36-53` | hors module -> 010 | Appel : `attendance.markStudentRecords` ; bascule : consommation `attendance.session.submitted` -> `HELD` (`held_source = ATTENDANCE`) | (inventaire : R) Écart : le legacy basculait au **premier enregistrement** de présence, la cible à la **soumission** de l'appel (§7-Q17). Ne ressuscite pas une `CANCELLED`. |
| SC-096 | Justifier une absence / justificatif | `professional.ts:1232, 1266, 1334, 1369` ; ue service `:1234, :1297` | hors module -> 010 | `attendance.submitJustification` / `acceptJustification` | Hors planning. |
| SC-097 | Historique des présences par filière | `professional.ts:1104, 1113, 1142` | hors module -> 010 | `attendance.getAttendanceSummary` / `listAbsences` | Hors planning. |

### 2.J Rémunération — liens séance <-> heures (spec 031 legacy)

| ID | Fonction | Fichier:ligne | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| SC-100 | Prédicat de payabilité (`SEANCE_PAYABLE_PREDICATE`, `SEANCE_PRETE_A_VALIDER_PREDICATE`, `DUREE_PAYEE_SQL`, `computeBlockers`) | `services/professional-seance-validation.service.ts:85 / :66 / :46 / :181` | amélioré | SQL `scheduling.payable_hours` : `HELD` + `validated_at` + `is_paid_role` ; durée = `coalesce(paid_minutes, durée de la séance)` | (inventaire : R) Prédicat unique conservé (§3.2) ; durée en minutes entières ; `HORAIRES_INCOMPLETS` n'existe plus (horaires obligatoires) ; `SANS_ENSEIGNANT` = absence de ligne `occurrence_staff` payée (contrôle du cas d'usage, non imposé par la DB, §7-Q18) ; `DEJA_PAYEE` = `locked_at`. |
| SC-101 | Lister séances (écran de validation) + années + enseignants | `routes/professional-remuneration.ts:202, 218, 229` ; service `:235, :411, :435` | amélioré | `listPendingValidation`, `listOccurrences`, `listPayableHours` | (inventaire : R) Année pivot septembre (`ANNEE_SCOLAIRE_SQL`) remplacée par `academic_year_id`. |
| SC-102 | Changer le statut | `remuneration.ts:238` ; service `setStatut :462` | amélioré | `holdOccurrence`, `unholdOccurrence`, `cancelOccurrence` | (inventaire : R) Le verrou paie couvre **toute** transition (le legacy ne testait que `annulee` : repasser à `planifiee` une séance payée effaçait sa validation, bug AT-063) ; sortir de `HELD` n'efface plus silencieusement la validation : `unvalidateOccurrence` d'abord (§7-Q19). |
| SC-103 | Valider / dévalider en lot | `remuneration.ts:255` ; service `validateBatch :510` | amélioré | `validateOccurrence`, `validateOccurrencesBatch` (application partielle conservée, `rejected[{id, reason}]`), `unvalidateOccurrence` ; `schedule.occurrence.validate` (MFA) | (inventaire : R) Revalider une séance validée ne réécrit plus `validated_by/at` ; dévalidation d'une séance verrouillée refusée par la DB ; journal `occurrence_changes` (le legacy : aucun audit dédié). |
| SC-104 | Dérogation de durée (`PATCH /seances/:id/duree`) | `remuneration.ts:275` ; service `setDureePayee :588` | amélioré | `setPaidMinutes` (`occurrence_staff.paid_minutes`, `paid_minutes_by/at`) | (inventaire : R) Minutes entières (le legacy : `numeric(5,2)` heures, plafond 24 h par contrat) ; interdite si verrouillée **et si la séance est validée** (le legacy l'autorisait après validation, `occurrence_staff_guard`) : §7-Q19. |
| SC-105 | Séance saisie par la comptabilité | `remuneration.ts:293` ; service `createSeanceComptable :646` | amélioré | `createAccountingOccurrence` (`origin = ACCOUNTING`, aucune réservation de ressources) | (inventaire : R) Même règle (ECUE ∈ UE, enseignant existant, créée `HELD` non validée, `created_by` tracé) ; « volume sans horaires » : fenêtre synthétique + `paid_minutes` (§7-Q4) ; cumul créer + valider toujours tracé (séparation des tâches : §7-Q20). |
| SC-106 | Rapprochement grille -> séances manquantes (`GET /seances/manquantes`) ; cf. AT-067 | `remuneration.ts:313` ; service `findSeancesManquantes :726` | amélioré | `listUnrealizedOccurrences` (`GET /occurrences/unrealized`) | (inventaire : T) Le rapprochement par clé `(cohorte, ECUE, date)` (qui confondait deux créneaux le même jour, P-17) et le dépliage de la grille par bornes de **cohorte** sont remplacés par l'identité exacte `(timetable_entry_id, occurs_on, starts_at)` ; fériés exclus ; pagination (le legacy `LIMIT 500`). Détection des dates de patron **sans occurrence générée** : §7-Q21. |
| SC-107 | Chevauchements d'un même enseignant (paie) ; cf. AT-068 | `remuneration.ts:330` ; service `findOverlaps :797` | conservé | `findValidatedOverlaps` (`GET /reports/overlaps`) | Même périmètre : séances `HELD` validées d'un même intervenant dont les plages se chevauchent ; information seulement. Les chevauchements non validés sont désormais traités à l'écriture (BLOCK/WARN). |
| SC-108 | Collecteur d'heures Pro (`ProfessionalHourCollector.collect`) ; cf. AT-071 | `services/hour-collectors/professional-hour-collector.ts:34` | amélioré | `listPayableHours` / `scheduling.payable_hours(from, to, staff[])` (API publique consommée par 032) | (inventaire : R) L'intervenant réel (remplaçant compris) est conservé ; `NOT heureDejaPayeeSQL(...)` est remplacé par le drapeau `locked` + `lock_ref` renvoyés : l'exclusion « une heure ne se paie qu'une fois » est à la charge de la paie (§7-Q22). Le collecteur lui-même (adaptateur) -> 032. |
| SC-109 | Collecteur d'heures Académique (`teacher_attendance_sessions`) | `hour-collectors/academic-hour-collector.ts:32` | abandonné | `scheduling.payable_hours` (source unique) | (inventaire : R) Source indépendante des séances, heures entières : disparaît avec l'agrégat unique (cf. §1) ; dépendance 010/032 : §7-Q12. |
| SC-110 | Heures « consommées » (`heureDejaPayeeSQL`) ; cf. AT-072 | `hour-collectors/heures-consommees.ts:48` | hors module -> 032 | `lockHours` / `releaseHoursLock` (côté scheduling : verrou) | (inventaire : R) Règle de paie : heure exclue si présente au détail d'un bulletin non annulé d'une autre période ; un bulletin annulé relâche ses heures (`releaseHoursLock`). Quels statuts de bulletin posent le verrou : décision 032 (le legacy ne verrouillait que `approved`/`paid`, §7-Q22). |
| SC-111 | Mes séances (enseignant) | `remuneration.ts:454` | amélioré | `listOccurrencesForStaff` (`schedule.own.read`) | (inventaire : R) `teacher_id` toujours dérivé de l'identité (conservé), jamais d'un paramètre. |

### 2.K Vues propriétaire (conflits en lecture, taux d'occupation)

| ID | Fonction | Fichier:ligne | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| SC-120 | Conflits de planning Pro (`fetchOwnerRemplissage`, `OVERLAP_CONDITION`) | `services/owner-remplissage.service.ts:315-355` (`:107-112`) ; `routes/owner/index.ts:507` | amélioré | `previewConflicts`, `GET /timetables/:id/conflicts`, `GET /reports/overlaps` ; imposé à l'écriture | (inventaire : T « déplacer à l'écriture ») Critère conservé (§3.2), enrichi de la **classe** (conflit de cohorte jamais détecté) et de l'alternance A/B ; plus de `LIMIT 100` ni de type unique « salle » masquant l'enseignant. |
| SC-121 | Complétude & couverture (créneaux sans salle/enseignant ; ECUE programmées / attendues) | `owner-remplissage.service.ts:370-448` | hors module -> 025 | Données : entrées de patron (`GET /timetables/:id/entries`) + 004 | (inventaire : R) Calcul de présentation ; l'« attendu » vient de l'académique (offres, nœuds), le « programmé » des patrons. |
| SC-122 | Écart planifié vs tenu | `owner-remplissage.service.ts:450-520` | hors module -> 025 | Données : `listOccurrences` (planifié = non annulé, tenu = `HELD`), `listUnrealizedOccurrences` | (inventaire : R) Le dépliage jour par jour et l'absence de jours fériés retranchés disparaissent : les occurrences générées excluent déjà les jours bloqués. |
| SC-123 | Assiduité / occupation salles / charge enseignant (`/owner/assiduite`) | `services/owner-assiduite.service.ts:97` (constantes `:33-42`) ; `routes/owner/index.ts:844, 1081` | amélioré | `getRoomOccupancy` (minutes exactes par salle/jour), `getStaffWeeklyLoad` (données) ; présentation et export 025 | (inventaire : R) L'occupation par `generate_series` « une ligne par heure entamée » est remplacée par des minutes exactes ; la charge hebdomadaire tient compte des périodes de validité (le legacy sommait les créneaux sans en tenir compte) ; amplitude 12 h x 6 j = 72 h/sem. : §5 et §7-Q23 ; top 20 absents -> 010/025. |

### 2.L Visio (lien séance uniquement)

| ID | Fonction | Fichier:ligne | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| SC-130 | Créer/obtenir la visio d'un parent générique (`POST /live-sessions`, idempotent, notifications) | `routes/live-sessions.ts:123` | hors module -> 022/023 | Lien : `session_occurrences.virtual_session_ref` + `delivery_mode ONLINE/HYBRID` ; notifications -> 016 | (inventaire : R pour `instance`, A pour `professionnelle` = Imhotep). Scheduling stocke la référence ; la salle LiveKit appartient à 022/023. |
| SC-131 | Détail / jeton / fin / muet / exclusion / enregistrements | `live-sessions.ts:231, 256, 328, 376, 413, 450` | hors module -> 022/023 | — | (inventaire : T) « Tout utilisateur du tenant peut obtenir un jeton » et absence de contrôle « séance en cours » : à corriger côté 022/023, avec l'occurrence comme référence d'accès. |
| SC-132 | Webhook LiveKit (présence automatique >= 50 %, `bridgeSchoolAttendance`) | `routes/webhooks/livekit.ts:399` (`:146-205`, `:235-330`) | hors module -> 022/023 | + `attendance.bulkMarkFromExternal` (010) | (inventaire : T) Le pont écrit dans des colonnes inexistantes de `attendance_sessions` (`start_time/end_time`, `:286-293`) ; aucun traitement des visios Pro ; durée prévue = `ends_at - starts_at` de l'occurrence. |
| SC-133 | Lister les visios d'une séance ECUE | `professional.ts:2855` ; `services/professional-live-sessions.service.ts:34` | hors module -> 022/023 | Filtrées par référence d'occurrence | (inventaire : R) Plusieurs visios par séance au legacy, une seule référence en cible (§7-Q10). |
| SC-134 | Créer / jeton / fin visio Pro | `professional.ts:2874, 2894, 2931` ; service `:92, 134, 164` | hors module -> 022/023 | — | (inventaire : T) `getJoinToken` sans contrôle d'accès (P-18), `titre`/`scheduled_at` acceptés et ignorés. |

### 2.M Nouveautés v2 sans équivalent legacy (pour mémoire)

`cloneTimetable`, `publishTimetable` / `archiveTimetable` (cycle de vie, événements `scheduling.timetable.published|archived`), alternance `WEEK_A`/`WEEK_B` (`week_a_anchor`), `substituteStaff` (remplaçant, `replaces_staff_id`), `scheduling.occurrence.replacement_needed` (sur `attendance.staff_leave.approved`), `overrideConflict` (`schedule.conflict.override`, sensible, `scheduling.conflict.overridden`), équipement en stock (`occurrence_equipment_guard`), `occurrence_changes` (journal immuable), `generation_runs`, `setRoomStatus`, `exportTimetableIcs`, `lockHours` / `releaseHoursLock` (`schedule.hours.lock`, réservée à la paie), `conflictChecker` (port `ScheduleConflictChecker` consommé par 004 : conflit d'étudiant à la carte à l'inscription), consommation de `academic.offering.cancelled`, `academic.classroom.cancelled`, `academic.year.closed`, `people.teaching_assignment.ended`.

---

## 3. Algorithmes et critères de conflit

### 3.1 Critères de conflit : SQL legacy -> critère cible

| Critère legacy (SQL / code exact) | Source | Critère cible |
|---|---|---|
| **(a) Création manuelle** : `si.tenant_id=$1 AND (si.teacher_id=$2 OR si.class_id=$3) AND si.session_date=$4 AND ((si.start_time<$5 AND si.end_time>$6) OR (si.start_time>=$6 AND si.start_time<$5))` (2e branche redondante) | `routes/sessions.ts:137-147` | Contrainte d'exclusion `resource_claims_no_overlap` : même `tenant_id`, même `resource_kind`, même `resource_id`, `during &&` (`tstzrange(starts_at, ends_at, '[)')`), `WHERE exclusive`, `DEFERRABLE INITIALLY DEFERRED`. Critère de chevauchement strict **conservé** : deux séances bout à bout sont acceptées (test `back_to_back_ok`). |
| **(b) Modification** : mêmes critères sans 2e branche, `AND si.id <> $2` | `routes/sessions.update.ts:43-50` | Les `resource_claims` d'une occurrence sont recalculés (`sync_occurrence_claims`) ; l'aperçu exclut l'occurrence courante (`p_exclude_occurrence` de `find_conflicts`). |
| **(c) generate-missing** : `session_date=$2 AND status <> 'cancelled' AND (teacher_id=$3 OR class_id=$4) AND start_time < $5 AND end_time > $6` | `teacher-assignments.ts:585-596` | Une occurrence `CANCELLED` ne porte aucune claim (`sync_occurrence_claims` supprime puis ne réinsère pas) : **le filtre `<> 'cancelled'` est généralisé** (le legacy (a)/(b) laissait une séance annulée bloquer). |
| **« Même jour » + heures seules** (`session_date` + `time`, pas de minuit) | (a)(b)(c) | Plage absolue `tstzrange` en `timestamptz` : séance à cheval sur minuit possible ; `occurs_on` = date civile dans `settings.timezone` (`CHECK abs(occurs_on - utc_date) <= 1`). |
| **« Enseignant OU classe »** | (a)(b)(c) | Trois ressources exclusives distinctes : `STAFF` (toute ligne `occurrence_staff`, quel que soit le rôle), `CLASSROOM` (si `classroom_id` et `claims_classroom` et `kind` ∈ LESSON/EXAM — une offre à la carte ne réunit pas la classe), `ROOM`. Ajoute **salle** (jamais contrôlée pour `session_instances` ni Pro) et **équipement** (somme des quantités <= stock, `occurrence_equipment_guard`). |
| **(d) Générateur en mémoire** : même `dayOfWeek`, `s1<e2 && s2<e1` => `time_overlap` (high) ; + même `teacherId` non nul => `teacher_conflict` (critical) | `ScheduleGeneratorService.ts:384-440` | `previewConflicts` renvoie la liste (type de ressource, occurrence en conflit, `exclusive`) ; la gravité devient la **politique par ressource** `BLOCK`/`WARN` (`conflict_policies`, absence de ligne = `BLOCK`). |
| **(e) Réservations de salle** : `EXCLUDE USING gist (tenant_id =, classroom_id =, tstzrange(start,end,'[)') &&) WHERE status != 'cancelled'` + contrôle applicatif `status != 'cancelled' AND tstzrange($3,$4,'[)') && tstzrange(start_datetime,end_datetime,'[)')` | `0009:103-109` ; `classroom-reservations.ts:221-228` | Même sémantique `[)` hors annulées, mais la claim `ROOM` est commune aux cours, examens et réservations (`kind = RESERVATION`). Erreur 23P01 mappée en `scheduling.conflict_detected` après `SET CONSTRAINTS ... IMMEDIATE` (le legacy : 500 brut). |
| **Pro grille (b)** : auto-jointure `professional_emploi_temps` `b.id > a.id AND b.jour = a.jour AND a.heure_debut < b.heure_fin AND b.heure_debut < a.heure_fin AND COALESCE(a.date_debut,'-infinity') <= COALESCE(b.date_fin,'infinity') AND COALESCE(b.date_debut,'-infinity') <= COALESCE(a.date_fin,'infinity') AND ((a.classroom_id IS NOT NULL AND a.classroom_id=b.classroom_id) OR (a.enseignant_id IS NOT NULL AND a.enseignant_id=b.enseignant_id))`, type `'salle'` sinon `'enseignant'` | `services/owner-remplissage.service.ts:107-112, 315-355` | Même logique (jour ISO, `[)`, intersection des validités) sur `timetable_entries`, **calculée par le domaine à l'écriture du patron** (la grille n'est pas dotée d'une contrainte d'exclusion) puis **imposée sur les occurrences générées** ; ajoute la **classe** ; deux patrons `WEEK_A` / `WEEK_B` ne sont jamais en conflit ; `salle` ET `enseignant` rapportés ensemble (plus de masquage). |
| **Pro séances (d)** : même `enseignant_id` non nul, même `date`, `a.id<b.id`, les deux `realisee` et `validated_at IS NOT NULL`, horaires non nuls, `a.heure_debut < b.heure_fin AND b.heure_debut < a.heure_fin` | `professional-seance-validation.service.ts:797-854` | `findValidatedOverlaps` : occurrences `HELD` validées d'un même `occurrence_staff.staff_id` dont les `during` se chevauchent. Restriction aux validées **conservée** (information pour la paie) ; avec politique `BLOCK` les nouveaux cas ne peuvent plus naître. |
| **Jamais détectés** (§3.3(e) legacy) : cohorte/classe Pro, salle Pro vs réservation vs Académique, enseignant Académique vs Pro (deux tables), indisponibilités | — | **Désormais détectés** : classe (`CLASSROOM`), salle (`ROOM`, tous types d'occurrence), enseignant tous types confondus (`STAFF`), équipement. Étudiant à la carte (double inscription à des offres simultanées) : port `conflictChecker` (004). |
| **Disponibilité enseignant** : inexistante (formateurs Imhotep uniquement) | `formateur-availability.service.ts` | `settings.staff_availability_mode` (`OPEN` : disponible sauf indisponibilité ; `CLOSED` : indisponible sauf disponibilité) + `people.staff_availabilities` (009) : évaluée par le domaine (`previewConflicts`, `suggestSlots`, `generateOccurrences`), non imposée par la base ; gravité à préciser (§7-Q24). |
| **Capacité de salle vs effectif** : inexistante (`capacity_exceeded` déclaré, jamais produit) | contrat `schedule-generation` | `rooms.capacity` conservée comme donnée ; contrôle d'effectif = avertissement de domaine (à confirmer, §7-Q24). |
| **Concurrence** : contrôle puis insertion sans verrou (course possible) | (a)(b)(c) | Impossible : contrainte vérifiée au COMMIT, verrou de ligne sur l'équipement ; échange de deux enseignants dans la même transaction permis (contrainte différée). |

### 3.2 Payabilité, durée, verrou

| Critère legacy | Source | Critère cible |
|---|---|---|
| Payable <=> `statut='realisee'` ET `enseignant_id IS NOT NULL` ET (`duree_payee IS NOT NULL` OU horaires complets) ET `validated_at IS NOT NULL` | `professional-seance-validation.service.ts:85,66` | `scheduling.payable_hours` : `o.status = 'HELD' AND o.validated_at IS NOT NULL AND s.is_paid_role`, `occurs_on BETWEEN p_from AND p_to`, filtre optionnel `staff_id = ANY(...)`. L'enseignant payé est la ligne `occurrence_staff` (intervenant réel, remplaçant compris), jamais le titulaire de l'affectation. |
| Durée = `COALESCE(duree_payee::float8, EXTRACT(EPOCH FROM heure_fin - heure_debut)/3600)` (heures) | `:46` | `coalesce(s.paid_minutes, round(extract(epoch FROM ends_at - starts_at)/60)::integer)` (minutes entières). La dérogation l'emporte, la durée planifiée reste intacte. |
| Blocages `STATUT_NON_REALISEE`, `NON_VALIDEE`, `SANS_ENSEIGNANT`, `HORAIRES_INCOMPLETS`, `DEJA_PAYEE` | `computeBlockers :181` | `status <> HELD`, `validated_at IS NULL`, aucune ligne payée, (supprimé : horaires obligatoires), `locked_at IS NOT NULL`. |
| Verrou : paiement `approved`/`paid` (`LOCKING_STATUSES` `:176`) ; FK `RESTRICT` sur `seance_id` (0105) | `:176` ; `0105:37-41` | `locked_at` + `lock_ref` posés par `lockHours`, levés par `releaseHoursLock` (réglage de transaction `scheduling.payroll_unlock`). Ligne verrouillée figée ; occurrence portant une ligne verrouillée immuable (horaire, statut, validation). |
| Validation/dévalidation | `validateBatch :510` | `validated_at/by` ; `CHECK validated_at IS NULL OR status = 'HELD'` ; séance validée : plus de changement d'horaire, de statut, de salle ni d'intervenant tant qu'elle n'est pas dévalidée. |

### 3.3 Génération et expansion de récurrence

| Élément legacy | Source | Cible |
|---|---|---|
| Horizon : `weeks = ceil((startDate + 1 mois − startDate)/7 j)` (5 semaines pour 30/31 j) | `ScheduleGeneratorService.ts:176-179, 247-250` | Bornes réelles : `[max(from demandé, timetable.valid_from, entry.valid_from) ; min(to demandé, timetable.valid_to, entry.valid_to)]` ; garde-fou technique `settings.max_generation_weeks` (60, 1..120). |
| Quota hebdo `requiredHours/weeks`, remplissage séquentiel créneau par créneau, un créneau = un cours pour toute la semaine | idem `:273-358` | Abandonné (§2.B). Le patron dit explicitement « chaque lundi 08:00-10:00, classe X, matière Y, salle Z ». |
| Expansion : première date >= `startDate` dont `getDay()` = jour cible (map lundi=1..dimanche=0), pas de +7 jours, `endDate` incluse ; `start_datetime = date + startTime` via `setHours` local puis `toISOString()` | `SchedulePersistenceService.ts:174-214` | Dates ISO (`weekday` 1..7) ; heure locale -> `timestamptz` via `settings.timezone` ; `occurs_on` civile ; idempotence `UNIQUE (timetable_entry_id, occurs_on, starts_at)`. |
| `simple-schedule` : semaine par semaine (max 52) depuis `startDate`, `daysToAdd = (targetDay+1 − getDay() + 7) % 7`, une séance par sélection tant que `used < hours_total` | `simple-schedule.ts:122` | Même expansion, bornée par les dates ; plafond au volume horaire : §7-Q2. |
| Récurrence Pro : « chaque semaine, jour ISO = `jour`, bornée par les dates de la **cohorte** » (ignore `et.date_debut/date_fin`) | `findSeancesManquantes` | Bornes **du patron** (`valid_from/valid_to`) d'abord, puis de l'emploi du temps ; alternance `EVERY`/`WEEK_A`/`WEEK_B` par rapport à `week_a_anchor` (lundi ISO). |
| Jours fériés / vacances : jamais pris en compte | `academic_calendar_events` non consommé | Les dates couvertes par un `calendar_events.blocks_teaching` (campus et établissement) sont sautées (`generation_runs.skipped_blocked`) ; les occurrences existantes concernées sont signalées. |
| Conflit pendant la génération : saut du créneau, essai suivant (`generate-missing`) | `teacher-assignments.ts:585-596` | Occurrence non créée et comptée (`skipped_conflict`) avec avertissement ; la génération n'échoue pas globalement. |
| Fin par défaut `calculateSmartEndDate` = `startDate + 7 x max(nb sessions/jour) − 1` | `SchedulePersistenceService.ts:216` | Supprimée (P-06). |
| Durée : `duration_minutes` stockée, `CHECK > 0` | `session_instances` | Dérivée de `ends_at − starts_at` ; `paid_minutes` en dérogation. |

### 3.4 Disponibilité, rattrapage, remplacement

Aucune règle legacy de remplacement : le remplaçant d'une séance Pro n'était qu'un `enseignant_id` différent de l'affectation. Cible : `substituteStaff` crée une ligne `SUBSTITUTE` avec `replaces_staff_id` ; l'absence approuvée d'un enseignant (`attendance.staff_leave.approved`) lève `needs_replacement` (événement `scheduling.occurrence.replacement_needed`).

---

## 4. Règles métier implicites et défauts (inventaire §6.1)

| Réf. | Défaut / règle implicite legacy | Traitement v2 |
|---|---|---|
| P-01 | Approbation de l'assistant = succès factice (persistance dans tables supprimées, erreur avalée ; résultats en `Map` mémoire) | **Corrigée** : plus d'assistant ; `generateOccurrences` est synchrone, transactionnelle, journalisée (`generation_runs`), ne masque aucune erreur ; `publishTimetable` explicite. |
| P-02 | `status/result/requests` lisent des tables supprimées (500) | **Corrigée** : endpoints supprimés ; lecture du journal de génération à prévoir (§7-Q15). |
| P-03 | « Génétique » = glouton ; préférences sans effet ; 1 mois en dur ; candidats morts ; score absurde ; salles aléatoires | **Corrigée** : génération = expansion déterministe d'un patron ; `suggestSlots` (aide) ; solveur complet = question ouverte (§7-Q1). |
| P-04 | Aucun conflit de salle Académique ; aucun conflit enseignant inter-classes ; aucune indisponibilité | **Corrigée** : claims `STAFF`/`CLASSROOM`/`ROOM`/équipement ; disponibilités par le domaine (009). |
| P-05 | Aucun contrôle de conflit à l'écriture Pro | **Corrigée** : domaine à l'écriture de patron, base sur les occurrences. |
| P-06 | `calculateSmartEndDate` raccourcit le planning | **Corrigée** : bornes réelles. |
| P-07 | Fuseaux mélangés (`toISOString` vs `toTimeString`/`setHours`) ; `Europe/Paris` en dur | **Corrigée** : `timestamptz` + `settings.timezone` ; `occurs_on` cohérent par `CHECK`. |
| P-08 | Seul `scheduled` écrit ; `attendance_taken` jamais mis à jour ; annulation = DELETE | **Corrigée** : `PLANNED/HELD/CANCELLED` pilotés (appel soumis -> `HELD`), pas de DELETE, `attendance_taken` dérivé. |
| P-09 | `POST /sessions` : enseignant = appelant ; confiance en `x-user-id` | **Corrigée** : intervenant explicite ; identité depuis le jeton. |
| P-10 | Aucun contrôle de rôle sur les routes de planning Académique | **Corrigée** : permissions `schedule.*` (manage, publish, room.manage, calendar.manage, occurrence.hold/validate, conflict.override, hours.lock). |
| P-11 | Double chemin semestre -> session | **Reprise par 004** (une seule période académique). |
| P-12 | Nom de classe Pro déduit de `split_part(libelle, ' — ', 1)` | **Corrigée** : `academic.classrooms.name`, plus de parsing de libellé. |
| P-13 | Injection SQL / mass-assignment des PUT salles et réservations | **Corrigée** : schémas Zod explicites, colonnes jamais dérivées du body. |
| P-14 | Suppression de salle : COUNT sans tenant, FK `NO ACTION` (500), salle `hors_service` réservable, `occupe` jamais calculé | **Corrigée** : archivage, garde `room_unavailable`, occupation dérivée. |
| P-15 | `PUT` réservation sans re-test de conflit ; `DELETE` réservé au créateur ; `pending` bloquant | **Corrigée** : conflit re-testé ; annulation par permission ; pas de statut `pending` (§7-Q9). |
| P-16 | Séances : tout enseignant peut agir sur toute séance ; modifier une séance validée ne dévalide pas | **Corrigée** : permissions + immutabilité DB d'une séance validée/verrouillée. |
| P-17 | `findSeancesManquantes` ignore les bornes du créneau et confond deux créneaux le même jour | **Corrigée** : `listUnrealizedOccurrences` sur identité exacte de l'occurrence. |
| P-18 | Visio Pro : jeton sans contrôle d'accès, `titre`/`scheduled_at` ignorés, pont écrivant dans des colonnes inexistantes | **Reprise par 022/023 et 010** (`bulkMarkFromExternal`). |
| P-19 | UI : heures entières 08-20, lundi-samedi ; l'export tronque les minutes | **Corrigée côté données** : minutes et dimanche permis (`weekday` 1..7, `time`) ; rendu : 033/024. |
| P-20 | `teacher_attendance_sessions.duration_hours` entier ; `time_slot` libre | **Corrigée** : durée en minutes (`paid_minutes`), source unique. |
| P-21 | Contrats Zod non utilisés pour valider ; incohérences de bornes | **Corrigée** : contrats `packages/contracts/src/v2/scheduling.ts` appliqués par les routes. |
| P-22 | Fenêtre de dates : Pro sans fenêtre, Académique −7/+21 j | **Corrigée** : fenêtre `from/to` obligatoire et identique pour toutes les vues ; valeur par défaut = paramètre client. |

---

## 5. Constantes codées en dur (inventaire §6.3) -> destination

| Constante legacy | Valeur / source | Destination v2 |
|---|---|---|
| Horizon de génération | 1 mois = 5 semaines (`ScheduleGeneratorService.ts:176-179,247-250`) | Supprimée : bornes de l'emploi du temps ; garde-fou `settings.max_generation_weeks` = 60 (1..120). |
| Durée de session par défaut / bornes | 120 min, 30..240 (`schedule-generation.ts:337`) | Supprimée : durée = `ends_time − starts_time` du patron ; durée demandée explicitement à `suggestSlots`. |
| Poids de score | priorité x10, +20 matin, aléa 10 ; score 100, −30/cours, +10 si variance < 2 | Supprimés (aucun équivalent). |
| Salles fictives | Salle A1/A2/B1/B2, Lab Info 1/2 (`Generator:379`) | Supprimées ; salles réelles (`rooms`). |
| Créneaux `simple-schedule` | 08-10, 10-12, 14-16, 16-18 (120 min) ; 08-12, 13-17 (240) ; 18-20 (120) (`simple-schedule.ts:29-39`) | Données : `scheduling.time_slots` (grille type fournie par le pack, modifiable). |
| Garde-fous de semaines | 52 (`simple-schedule.ts:122`) ; 80 (`teacher-assignments.ts:572`) | `settings.max_generation_weeks` (60). |
| Créneaux hebdo par défaut | lun-ven x (08-10, 10-12) (`teacher-assignments.ts:50-61`) | Supprimés (`suggestSlots` raisonne sur `time_slots` réels). |
| Heures minimales par affectation | `max(hours_total, 2)` (`:498,566`) | Supprimées ; volume horaire = donnée académique (§7-Q2). |
| Salle par défaut d'instance | `'TBD'` | Supprimée : `room_id` nullable. |
| Créneaux de paie Académique | 08-10, 10-12, 14-16, 16-18, 08-12, 13-17, 18-20 puis regex libre ; durée 1..12 h (`0043:29`, `teacher-attendance.ts:441-443`) | Supprimés : durée de l'occurrence ; `paid_minutes > 0` sans plafond (plafond éventuel = RuleSet 012 / paie 032). |
| Seuil de présence visio | 50 % de la durée prévue (`webhooks/livekit.ts:197`) | 022/023 + RuleSet 012 (le module planning ne porte aucun seuil). |
| Réservation temporaire | 15 min (`inscription-pro.service.ts:1858`) | Hors module : 004 (`expirePendingHolds`, délai configurable). |
| Amplitude d'ouverture / fenêtres | 12 h/jour x 6 j = 72 h/sem. ; 12 semaines ; top 20 ; LIMIT 100/30/50 (`owner-assiduite.service.ts:33-42`, `owner-remplissage:99`) | Paramètres de requête de 025 ; l'amplitude d'ouverture n'a pas de colonne dans `scheduling.settings` (§7-Q23) ; LIMIT -> pagination. |
| Pivot d'année scolaire | 1er septembre -> 31 août (`professional-emploi-temps.service.ts:143-148,332-337`, `seance-validation:96-105`, `owner-remplissage:469-475`, `0118`) | Supprimé : `academic.academic_years` (004). |
| Fenêtre agenda élève | −7 j / +21 j (`student-courses.ts:894-895`) | Paramètre client (033) ; l'API exige `from/to`. |
| Fuseau d'affichage | `Europe/Paris` (`session-instances.ts:206,331`) | `settings.timezone` (défaut `Africa/Abidjan`, copié du CountryProfile). |
| Grille UI Pro | heures 8->20, jours 1-6 (`planning/page.tsx:60-62`, `emploi-temps-model.ts:9-10`) | `time_slots` + UI (033) ; `weekday` 1..7. |
| En-tête d'export EDT | Ministère / République de Côte d'Ivoire / IPAM (`emploi-temps-model.ts:57-60`) | Paramètres d'établissement ; rendu 024. |
| Conduite exclue de l'EDT | `libelle ILIKE 'conduite%' OR code ILIKE '%EC-CON%'` (`emploi-temps.service.ts:356`, `ue.service.ts:1055,1088`, `parent-children.ts:97`) | `academic.curriculum_nodes.is_transversal` (004). |
| Priorité de créneau | ≤ 10 (contrat) / ≤ 3 (0018) | Supprimée avec `priority`. |
| UUID de tenant et d'utilisateur de test | `6eb9c106-...` (migrations), `550e8400-...` (`schedule-generation.ts:362,734`), `634a57fe-...` (`teacher-assignments.ts:947`) | Supprimés (aucun seed de tenant, identité par jeton). |

---

## 6. Synthèse chiffrée par statut

Dénombrement automatique des identifiants de la section 2 (une ligne par identifiant legacy ; 102 identifiants).

**Fonctions et endpoints (§2) — 102 identifiants legacy**

| Statut | Nombre | Part |
|---|---:|---:|
| conservé | 4 | 4 % |
| amélioré | 64 | 63 % |
| abandonné | 15 | 15 % |
| hors module | 19 | 19 % |
| **Total** | **102** | 100 % |

**Par famille**

| Famille | conservé | amélioré | abandonné | hors module | Total |
|---|---:|---:|---:|---:|---:|
| A — Créneaux & assistant de génération | 1 | 3 | 6 | 0 | 10 |
| B — Moteur de génération | 0 | 1 | 6 | 1 | 8 |
| C — Persistance/lecture planning académique | 0 | 7 | 0 | 0 | 7 |
| D — Séances datées | 0 | 9 | 1 | 1 | 11 |
| E — Salles/équipements/réservations | 0 | 9 | 0 | 0 | 9 |
| F — Calendrier/examens | 1 | 8 | 0 | 0 | 9 |
| G — Planning Pro | 0 | 3 | 0 | 2 | 5 |
| H — Emploi du temps Pro | 1 | 9 | 1 | 3 | 14 |
| I — Séances/affectations/présences Pro | 0 | 4 | 0 | 4 | 8 |
| J — Rémunération (liens séance/heures) | 1 | 9 | 1 | 1 | 12 |
| K — Vues owner | 0 | 2 | 0 | 2 | 4 |
| L — Visio | 0 | 0 | 0 | 5 | 5 |

**« Hors module » par spec destinataire** : 022/023 : 5 ; 010 : 4 ; 004 : 3 ; 009 : 3 ; 025 : 2 ; 024 : 1 ; 032 : 1.

**Écarts avec les verdicts de l'inventaire** (R reproduire, T transformer, A abandonner)

| Verdict inventaire | conservé | amélioré | abandonné | hors module | Total |
|---|---:|---:|---:|---:|---:|
| R | 4 | 32 | 1 | 11 | 48 |
| T | 0 | 32 | 5 | 8 | 45 |
| A | 0 | 0 | 9 | 0 | 9 |

Lecture : les verdicts R/T n'indiquaient pas le module propriétaire ; « hors module » regroupe les fonctions qui relèvent de 004, 009, 010, 022/023, 024, 025 ou 032. Seuls les R devenus « abandonné » constituent un vrai écart de décision : SC-109 (collecteur d'heures Académique, source `teacher_attendance_sessions` supprimée). Les T devenus « abandonné » (SC-003, SC-011, SC-012, SC-015, SC-070) découlent de l'abandon de l'assistant de génération. Les A restent tous « abandonné » (SC-004 à SC-008, SC-014, SC-016, SC-018, SC-032) ; SC-007 « ré-implémenter proprement » est couvert par `publishTimetable`.

**Tables et objets (§1) — 33 lignes** : amélioré 11, abandonné 13, hors module 9. Correspondances d'import (§1.1) : 17 lignes.

**Autres sections** : 27 critères/algorithmes de conflit et de génération (§3, tableaux 3.1 à 3.3), 22 défauts P-01 à P-22 (§4 : 20 corrigés dont P-19 côté données seulement, 2 repris par un autre module — P-11 vers 004, P-18 vers 022/023 et 010), 21 constantes (§5), 26 points à trancher (§7).

---

## 7. Points à trancher

- **Q1. Solveur complet.** Aucune génération « optimisée » n'est reprise ; `suggestSlots` n'est qu'une aide. Un solveur (contraintes dures/souples, équilibrage) est une question ouverte de la spec 017.
- **Q2. Plafond au volume horaire.** `simple-schedule` et `generate-missing` s'arrêtent à `courses.hours_total` (`max(hours_total,2)`) ; `generateOccurrences` est borné par dates seulement. Faut-il plafonner au volume du nœud (004) ?
- **Q3. Propagation d'une modification de patron.** Le DDL ne dit rien sur le sort des occurrences futures `PLANNED` quand un patron change (`occurrences_entry_date` créerait de nouvelles occurrences à côté des anciennes). `removeTimetableEntry` est de plus bloqué par la FK `timetable_entry_id` sans `ON DELETE`. Règle à fixer (borner `valid_to` + annuler les futures non validées ?). Idem lors d'un changement d'affectation (`people.teaching_assignment.ended`).
- **Q4. Séances sans horaires / durée nulle.** Legacy : séances Pro à `heure_debut/heure_fin` NULL (blocage `HORAIRES_INCOMPLETS`), plannings sans `heure_fin`, examens sans `exam_time`/`duration`, séances comptables « au volume » (`duree_payee` sans horaires), `heure_fin >= heure_debut` (durée nulle admise). Cible : `starts_at/ends_at` obligatoires, `ends_at > starts_at`. Fenêtre synthétique d'import (début de journée + durée ? durée par défaut ?) à définir, ainsi que l'arrondi `duree_payee` heures -> `paid_minutes`.
- **Q5. Colonnes sans cible.** `session_occurrences` n'a ni `notes` ni `location` (`session_instances.notes`, `classroom_reservations.description`, `exam_schedules.location` texte libre) ; `rooms` n'a pas de description d'équipement fixe (`classrooms.equipment text[]`). Ajouter `notes` ou replier dans `title` ?
- **Q6. Examens.** Rattachés à un cours (pas à une classe) : éclatement sur les classes à l'import. Le `type` (midterm/final/quiz/assignment/other) n'a pas de colonne (nature de l'évaluation = 011/018 ?). Frontière avec 018-examinations (phase 4).
- **Q7. Unicité des événements de calendrier.** `UNIQUE (tenant, année, name, event_date)` legacy non reproduit dans `calendar_events` : contrôle de domaine ou doublons admis ?
- **Q8. Incohérences brief/DDL.** (i) `deleteTimeSlot` est dans la liste des cas d'usage mais `time_slots` n'a pas de GRANT DELETE (donc désactivation) ; (ii) le commentaire de `1000` renvoie la garde « salle hors service » à un fichier `1004` alors qu'elle est dans `1003` (`occurrences_guard`) ; (iii) `deleteCalendarEvent` existe mais aucun événement `scheduling.calendar_event.deleted` n'est publié ; (iv) la transition `CANCELLED -> PLANNED` est permise par la DB sans cas d'usage nommé.
- **Q9. Réservations.** Statut `pending` (approbation) sans équivalent ; qui peut réserver/annuler (le legacy : tout utilisateur, annulation par le créateur) — aucune permission de réservation par un enseignant dans la liste `schedule.*`.
- **Q10. Visio multiples.** Legacy : 0..n visios par séance Pro ; cible : une seule `virtual_session_ref`.
- **Q11. Création par l'enseignant.** Legacy : un enseignant crée des séances (SC-027, SC-094). Cible : `schedule.manage` requis pour `createOccurrence` ; `schedule.own.read` est en lecture seule. Prévoir une permission (rattrapage proposé par l'enseignant) ou réserver à l'administration + constat `schedule.occurrence.hold`.
- **Q12. Paie Académique.** Confirmer avec 010 et 032 que `teacher_attendance_sessions` (déclaration d'heures libre) est supprimée au profit de `payable_hours`.
- **Q13. Salle mise hors service.** La DB n'interdit que les nouvelles affectations ; le sort des occurrences futures déjà affectées (signalement, réaffectation) est une règle de cas d'usage.
- **Q14. Planifiabilité d'une offre.** Legacy : seule la cohorte `ouvert` ; une cohorte `en_cours` n'est plus planifiable (défaut). Statuts d'offre autorisant la création d'occurrences, et contrôle de la date dans la fenêtre de l'offre (non fait au legacy).
- **Q15. Cas d'usage de lecture à nommer.** Les routes `/rooms`, `/equipment`, `/time-slots`, `/calendar-events`, `/timetables`, `/reference/*` et la lecture de `generation_runs` n'ont pas de cas d'usage nommé dans le brief (`listRooms`, `listTimeSlots`, `listCalendarEvents`, `listTimetables`, `getTimetable`...). Fenêtre de lecture : inclusion complète (legacy) vs recouvrement ; occurrences annulées exposées ou non aux portails.
- **Q16. Lot atomique de patrons.** L'UI legacy créait N créneaux par appels successifs non atomiques ; `upsertTimetableEntry` est unitaire.
- **Q17. Déclencheur du constat.** Legacy : la présence enregistrée bascule la séance `realisee` dès le premier appel ; cible : à la soumission (`attendance.session.submitted`). Un appel jamais soumis ne constate plus la séance.
- **Q18. `SANS_ENSEIGNANT`.** La DB n'exige aucun intervenant pour valider (`validated_at` sans condition sur `occurrence_staff`) ; le cas d'usage `validateOccurrence` doit refuser une occurrence sans ligne payée. Plusieurs intervenants payés (`CO_TEACHER`, `SUPERVISOR` : `is_paid_role` vaut `true` par défaut) : paiement par intervenant à confirmer avec 032 (le legacy : un seul enseignant par séance). Sort de la ligne du titulaire lors de `substituteStaff` (retrait pour libérer sa claim `STAFF` ?).
- **Q19. Séance validée.** (i) Le legacy retirait silencieusement la validation en sortant de `realisee` ; la cible exige `unvalidateOccurrence` d'abord. (ii) Le legacy autorisait `setDureePayee` après validation ; `occurrence_staff_guard` l'interdit (séance validée = intervenants gelés) : la dérogation se pose avant validation, sinon dévalider.
- **Q20. Séparation des tâches.** Cumul « créer une séance comptable puis la valider » possible (tracé par `origin`, `created_by`, `validated_by`) ; exiger une personne différente ? (RuleSet / option).
- **Q21. Séances « jamais générées ».** `listUnrealizedOccurrences` couvre les occurrences `PLANNED` passées ; les dates d'un patron sans occurrence générée (génération oubliée) ne sont couvertes que si on ajoute ce rapprochement (équivalent du dépliage de `findSeancesManquantes`).
- **Q22. Verrou et « heure déjà payée ».** Le legacy excluait toute heure figurant au détail d'un bulletin non annulé d'une autre période ; le verrou `lockHours` est posé par la paie : 032 doit le poser dès le calcul (sinon deux bulletins sur des périodes chevauchantes peuvent collecter la même heure) ou conserver son index d'heures consommées. Statuts de bulletin verrouillants (legacy : `approved`/`paid`).
- **Q23. Amplitude d'ouverture.** Dénominateur du taux d'occupation (12 h x 6 j codés) : aucune colonne d'horaires d'ouverture dans `scheduling.settings` ; paramètre de 025 ou ajout au module.
- **Q24. Disponibilités et capacité.** Gravité (refus ou avertissement) des indisponibilités enseignant et du dépassement de capacité : seules les 4 ressources `STAFF/CLASSROOM/ROOM/EQUIPMENT` ont une politique `BLOCK`/`WARN` ; ces contrôles sont évalués par le domaine.
- **Q25. Conflit d'offre à la carte.** `claims_classroom = false` pour une offre à la carte : deux séances de la même offre simultanées ne sont plus détectées (pas de claim d'offre), et un étudiant inscrit à deux offres simultanées n'est détecté que par le port `conflictChecker` à l'inscription.
- **Q26. Numérotation des identifiants.** Le brief cite « SC-001..SC-134 » ; l'inventaire n'attribue que 102 identifiants (trous 037-039, 049, 059, 065-069, 084-089, 098-099, 112-119, 124-129).

---

## 8. Suite donnée aux points à trancher

Les numéros renvoient à la liste de la section 7.

| ID | Suite donnée | Référence |
|---|---|---|
| Q1 | Solveur complet : question métier ouverte ; v1 = aide au placement (`suggestSlots`, aperçu de conflits). | O-05 |
| Q2 | Tranché : plafond d'heures par nœud (`capByNodeHours`) à la génération. | spec 017 |
| Q3 | Tranché : `propagate` explicite et `endTimetableEntry`. | spec 017 |
| Q4 | Tranché : fenêtre synthétique pour les séances comptables ; arrondi à la minute à l'import. | DDL 1002 |
| Q5 | Tranché : colonnes `notes`, `location_label`, `attributes` (occurrences) et `features` (salles) ajoutées. | DDL 1000, 1002 |
| Q6 | Tranché : les examens sont des occurrences de nature `EXAM` rattachées à une classe (éclatement à l'import éventuel) ; la nature de l'évaluation relève de 011/018. | spec 017 |
| Q7 | Tranché : doublon d'événement de calendrier détecté au cas d'usage (avertissement), sans unicité en base. | spec 017 |
| Q8 | Tranché : corrections intégrées (`deactivateTimeSlot`, `calendar_event.deleted`, `restoreOccurrence`). | spec 017 |
| Q9, Q11 | Tranché : permissions `schedule.room.book` et `schedule.occurrence.declare`. | spec 017, O-23 |
| Q10 | Tranché : une seule référence de séance virtuelle (`virtual_session_ref`, R16). | spec 017 |
| Q12 | Tranché : la déclaration libre d'heures du legacy est supprimée au profit de `listPayableHours` (à confirmer avec 010 et 032). | D-15, plan 017 §5 |
| Q13 | Tranché : salle mise hors service = signalement des occurrences futures affectées (règle de cas d'usage), sans blocage. | spec 017 |
| Q14 | Tranché : règle R15. | spec 017 |
| Q15 | Tranché : cas d'usage de lecture nommés dans la spec. | spec 017 |
| Q16 | Tranché : la création de N patrons se fait par une opération de lot atomique côté cas d'usage (tout ou rien). | spec 017 |
| Q17 | Tranché : `HELD` posé à la soumission de l'appel (010). | spec 017, 010 |
| Q18 | Tranché : la validation exige un intervenant rémunéré ; `substituteStaff` supprime la ligne d'origine. | spec 017 |
| Q19 | Tranché : dévalidation avant toute modification. | D-16 |
| Q20 | Tranché : validation à quatre yeux réglable par établissement. | O-21 |
| Q21 | Tranché : `listUnrealizedOccurrences` couvre les occurrences passées non tenues ; les dates de patron sans occurrence sont rattrapées en rejouant la génération (idempotente). | spec 017 |
| Q22 | Tranché : verrou dès l'inclusion dans un bulletin non annulé, exclusif et atomique. | D-15 |
| Q23 | Tranché : horaires d'ouverture dans `settings` (`opening_*`). | DDL 1000 |
| Q24 | Tranché : disponibilités et capacité en avertissement (`WARN`), jamais en blocage. | spec 017 |
| Q25 | Tranché : une séance d'offre à la carte réserve l'**offre** (famille `CLASSROOM`, identifiant = offre) ; le chevauchement d'horaire d'un apprenant inscrit à deux offres est signalé par le port `ScheduleConflictChecker`. | DDL 1003, test « same_offering_overlap_blocked » |
| Q26 | Constat d'inventaire (trous de numérotation) noté ; sans effet sur les cibles. | - |
