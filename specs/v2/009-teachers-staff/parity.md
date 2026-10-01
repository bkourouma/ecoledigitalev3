# Parité legacy -> v2 — 009 teachers-staff (module `people`, volet personnel)

## 0. En-tête

**Objet.** Lister EXHAUSTIVEMENT ce que le legacy EcoleDigitale fait pour les enseignants, le personnel, les affectations d'enseignement et les heures déclarées/validées (côté données fournies à la paie), et dire pour chaque élément : conservé / amélioré / abandonné (avec justification) ou hors module (avec la spec porteuse), avec la cible v2 exacte (table, cas d'usage, route, événement).

**Module cible.** `people` (specs 008 élèves/tuteurs + 009 personnel/enseignants, un seul schéma `people`, migrations 0800-0804, préfixe HTTP `/api/v1/people`). Tables 009 : `staff_categories`, `contract_types`, `staff`, `staff_affiliations`, `staff_contracts`, `staff_qualifications`, `staff_competencies`, `staff_availabilities`, `staff_status_history`, `teaching_assignments`, `teaching_assignment_history` (+ `persons`, `settings`, `number_sequences` partagées avec 008).

**Sources.**
- Brief de conception cible (noms autoritaires) : `scratchpad/aca-brief.md` (module people 009, interfaces attendance/scheduling, principes).
- DDL de référence : `people/0800` (référentiels, `persons`, `settings`, `next_number`), `0802` (personnel), `0803` (affectations), `0804` (gardes, `expiring_qualifications`) ; `scheduling/1002` (`session_occurrences`, `occurrence_staff`), `1003` (`scheduling.payable_hours`) ; `attendance/0902` (`staff_leaves`, `staff_records`).
- Inventaire legacy : `scratchpad/legacy-teachers.md` (T-001..T-133, interface paie P-01..P-13, §4 personnel non enseignant, §5 dette) ; recoupements `legacy-attendance.md` (§4 interface paie, §5 présence du personnel) et `legacy-scheduling.md` (§4 modèle Pro). Vérifications ponctuelles dans le worktree (routes, migrations, `docs/workflow-paie-enseignants.md`).

**Abréviations de chemins legacy.** `R/` = `apps/api/src/routes/` ; `S/` = `apps/api/src/services/` ; `M/` = `infra/scripts/migrations/` ; `B:` = `apps/api/prisma/migrations/20260403110000_baseline/migration.sql` (état RÉEL de la base : le schéma versionné `M/` ne la décrit pas, cf. `legacy-teachers.md` §0).

**Légende des statuts** (premier mot de la colonne « Statut », utilisé pour les comptages du §6).
- **conservé** : règle reproduite à l'identique.
- **amélioré** : reproduite avec correction/enrichissement (le texte dit lequel : contrainte DB, audit, bug corrigé, configurable…).
- **abandonné** : non reproduite (dead code, insécurité, doublon, hors produit, Imhotep) ; la justification est obligatoire.
- **hors module -> NNN** : relève d'une autre spec (002 auth-rbac/iam, 004 academic-core, 010 attendance, 011 assessments-grades, 016 communications, 017 scheduling, 022 lms, 024 documents, 025 analytics, 031 imports, 032 payroll-port, 033 web-foundation). Pour ces lignes, la colonne « cible » nomme le cas d'usage v2 du module porteur et ce que `people` fournit éventuellement.
- **nouveau** : fonction v2 sans équivalent legacy (listée pour que le périmètre 009 soit complet ; non comptée comme parité).

**Comment lire.** §1 = tables et colonnes ; §2 = fonctions/endpoints, UNE ligne par ID de l'inventaire (T-xxx, P-xx), regroupée par famille ; les renvois `cf. T-xxx` des §3-§5 ne sont pas des lignes de parité. Les identifiants `TB-xx` (§1) et `N-xx` (§2.K) sont propres à ce document. Principes transverses appliqués partout : (1) une seule entité `staff` (l'enseignant est un membre du personnel dont la catégorie a `can_teach`) ; (2) l'affectation dit QUI est responsable de QUOI, elle n'est PAS le bénéficiaire de la paie (la paie lit `scheduling.occurrence_staff`) ; (3) aucune suppression physique ; (4) l'identité vient du jeton, jamais d'un en-tête ; (5) aucun montant, tarif, taux ou bulletin dans `people` ; (6) aucun seuil réglementaire codé en dur.

---

## 1. Tables legacy -> v2

| ID | Table / colonne legacy | Migration:ligne | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| TB-01 | `teachers` (identité enseignant, partagée Classique + Pro) | M/0002:86-105 ; B:1958-1978 | amélioré | `people.persons` (état civil, contact) + `people.staff` (0802) ; une ligne `staff` pour TOUT le personnel | Fiche à plat sans catégorie, sans contrat daté, sans personnel administratif ; éclatée en personne + dossier de personnel + contrats/qualifications/compétences |
| TB-02 | `teachers.id` | B:1958 | amélioré | `people.staff.id` (UUID stable publié) ; l'ancien id conservé en `staff.external_ref` (import, UNIQUE partiel par tenant) | Identifiant consommé par scheduling, attendance, paie, assess ; traçabilité de l'import (031) |
| TB-03 | `teachers.tenant_id` (FK `tenants` ON DELETE CASCADE, B:4376) | B:4376 | amélioré | `staff.tenant_id` FK `kernel.tenants` SANS cascade ; RLS forcée `kernel.enable_tenant_rls` | Le CASCADE effaçait tout le tenant ; FK composites `(tenant_id,id)` en v2 |
| TB-04 | `teachers.user_id` (NULL, FK `users`, PAS d'UNIQUE) | B:1958 ; B:4379 | amélioré | `persons.identity_id` (iam, UNIQUE partiel `persons_identity_unique`) ; `staff.person_id` UNIQUE par tenant ; compte via `provisionStaffAccount` ; `resolveStaffForIdentity` | Corrige 1 user <-> N fiches (code défensif `teacher-assignments.ts:1193`, `teacher-attendance.ts:329-338`) ; fiche sans compte reste autorisée (`identity_id` NULL), mais explicite |
| TB-05 | `teachers.employee_number` VARCHAR(20), libre, non unique, jamais généré | B:1958 | amélioré | `staff.staff_number` généré par `people.next_number('STAFF')` selon `settings.staff_number_pattern` (défaut `P{SEQ:4}`), UNIQUE `(tenant_id,staff_number)`, immuable (`staff_guard`) | Numéro de matricule fiable pour la paie (P-08, P-09) ; à l'import, valeur legacy conservée si non vide et unique, sinon générée et l'ancienne valeur copiée dans `external_ref`/`attributes` (voir §7-E13) |
| TB-06 | `teachers.first_name`, `last_name` NOT NULL (doublon de `users`) | B:1958 | amélioré | `persons.first_name`, `persons.last_name`, `other_names`, `search_key` (recherche sans accents, trigram) | Une seule source du nom (legacy : `users` d'abord ou `teachers` seulement selon l'écran, cf. §5.2-20) |
| TB-07 | `teachers.email` + `UNIQUE(tenant_id,email)` (idx B:3455) | B:3455 | amélioré | `persons.email` (format contrôlé, index `persons_email`) ; l'email de CONNEXION appartient à iam | L'unicité de l'email de contact n'est pas imposée par la base v2 (une même adresse peut servir à plusieurs personnes d'une famille) ; contrôle de doublon au niveau use case (voir §7-E12) |
| TB-08 | `teachers.phone` VARCHAR(20) | B:1958 | amélioré | `persons.phone`, `persons.phone_alt` (5..40 car.) | Longueur 20 trop courte pour le format E.164 + indicatif |
| TB-09 | `teachers.specialties TEXT[]` (texte libre) | B:1958 | amélioré | `people.staff_competencies(subject_id, grade_level_codes[])` UNIQUE `(staff,subject)` ; `setCompetencies` | Référentiel de matières (`academic.subjects`) au lieu de texte libre ; information de planification (avertissement, jamais blocage). Texte non rapprochable conservé dans `staff.attributes.legacy_specialties` (voir §7-E16) |
| TB-10 | `teachers.bio` TEXT | B:1958 | amélioré | `staff.attributes.bio` (jsonb objet) | Pas de colonne dédiée (rarement structurant) ; modifiable en self-service restreint (`/me/staff`) |
| TB-11 | `teachers.qualifications TEXT[]` (texte libre) | B:1958 | amélioré | `people.staff_qualifications(kind DIPLOMA/CERTIFICATION/AUTHORIZATION/OTHER, label, issuer, obtained_on, expires_on, document_ref)` ; `addQualification/updateQualification/removeQualification` ; alerte `people.staff_qualification.expiring` | Diplôme structuré, pièce jointe (documents 024), expiration + job d'alerte (`people.expiring_qualifications`, `settings.expiry_alert_days` défaut 60) |
| TB-12 | `teachers.hire_date` DATE | B:1958 | amélioré | `staff.hired_on` + `staff.left_on` (CHECK `left_on >= hired_on`, `LEFT` exige `left_on`) | Ancienneté (T-131) ; le départ est désormais daté |
| TB-13 | `teachers.contract_type` enum `permanent/temporary/freelance` (NOT NULL) | M/0002:10 ; B:30 | amélioré | `people.contract_types` (données de pack : `kind` PERMANENT/FIXED_TERM/CASUAL/OTHER) + `people.staff_contracts` DATÉS (`starts_on/ends_on`, `committed_hours` + unité PER_WEEK/PER_YEAR, `status`, `document_ref`) ; mapping import : permanent->PERMANENT, temporary->FIXED_TERM, freelance->CASUAL | Le legacy n'avait aucune durée ni historique (§4 « Contrat daté : NON ») ; types de contrat en DONNÉES (CDI, CDD, vacation…), plus d'enum codé en dur ; exclusion de chevauchement par `(staff, type)` |
| TB-14 | `teachers.hourly_rate` DECIMAL(8,2) « taux vacataire » | B:1958 | abandonné | hors `people` : taux/tarifs = `032-payroll-port` (import éventuel comme tarif par défaut du bénéficiaire) | Lu seulement en repli d'affichage (`R/teacher-attendance.ts:347`), jamais par le calculateur (P-06/P-07) ; aucun montant dans `people` (principe v2) |
| TB-15 | `teachers.status` enum `active/inactive/suspended` (seul `active` a un effet : filtre du calculateur `payment-calculator.ts:443`) | M/0002:11 ; B:147 | amélioré | `staff.status` ACTIVE/ON_LEAVE/SUSPENDED/LEFT + `people.staff_status_history` (immuable) ; `changeStaffStatus` ; garde `staff_guard` (transitions) ; mapping import : active->ACTIVE, suspended->SUSPENDED, inactive->LEFT (`left_on` = date d'import, à confirmer §7-E3) | Sémantique explicite, transitions légales imposées par la base, historique daté avec motif ; événement `people.staff.status_changed` |
| TB-16 | `teachers.created_at`, `updated_at` + trigger `update_updated_at_column` | M/0002:232-234 | conservé | `staff.created_at/updated_at` | Inchangé |
| TB-17 | Index `idx_teachers_{tenant_id,email,status,contract_type}` ; policy RLS `teachers_tenant_policy` (non tracée par la baseline) | M/0002:166-169, 201-204 ; B:3440-3452 | amélioré | `staff_by_status (tenant_id,status,category_code)`, `staff_external_ref_unique` ; RLS FORCÉE sur toutes les tables du module | État réel des policies du legacy invérifiable ; v2 : RLS + tests d'isolation |
| TB-18 | Suppression PHYSIQUE d'une fiche enseignant (`DELETE /teachers/:id`, cascade évaluations, affectations, bulletins, tarifs, configs) | `legacy-teachers.md` §1.10 | abandonné | trigger `staff_no_delete` (`forbid_mutation`) ; sortie = `changeStaffStatus(LEFT)` | Perte de données irréversible et silencieuse (cf. T-009) |
| TB-19 | `users` (comptes) | B:2082-2099 | hors module -> 002 | `iam` (identités, memberships) ; `persons.identity_id` relie la personne | Authentification = iam (ADR-008) |
| TB-20 | `users.initial_password` VARCHAR(255) — mot de passe EN CLAIR | B:2082-2099 | abandonné | aucun ; activation par invitation à usage unique (`provisionStaffAccount` -> port `AccountProvisioner` -> iam) | Mot de passe en clair visible des admins, généré par `Math.random` : inacceptable |
| TB-21 | `users.first_name/last_name/computed_name` (doublon des noms) | B:2082-2099 ; Prisma `20260515093000` | hors module -> 002 | le nom d'affichage vient de `persons` | Une seule source du nom |
| TB-22 | `roles` (global depuis 0055), `user_roles` (rôle `teacher` créé à la volée par `teachers.ts:368-379`) | M/0055:3,77,173 | hors module -> 002 | RBAC v2 (rôles/permissions `staff.*`, `teaching.*`) ; accès « enseignant » résolu par `resolveStaffForIdentity` | Dérive 0055 (global) vs seed Prisma (re-tenanté) ; plus de création de rôle à la volée |
| TB-23 | `admin_roles`, `admin_role_menus`, `user_admin_roles` (rôles admin custom limitant les menus du sidebar, PAS l'API) | M/0091:25-69 | hors module -> 002 | rôles/permissions RBAC appliqués côté API | Le contrôle d'accès « réel » du legacy est le sidebar + `X-User-Id` |
| TB-24 | `teacher_assignments` (affectation académique enseignant <-> cours de classe) | M/0005:67-81 ; B:1801-1819 | amélioré | `people.teaching_assignments` (0803) | Unifie classique (`teacher_assignments`), Pro (`professional_session_ecue_teachers`) et titulaire de classe ; l'affectation n'est pas le bénéficiaire de la paie |
| TB-25 | `teacher_assignments.class_course_id` (FK `class_courses` CASCADE ; un couple classe x cours) | B:4298 | amélioré | `classroom_id` + `curriculum_node_id` (nœud MATIÈRE/ECUE/UE de `academic.curriculum_nodes`, sans FK) + `academic_year_id` + `period_id` optionnel | `class_courses` disparaît : classe x cours = classroom x nœud ; la période permet les titulaires successifs |
| TB-26 | `teacher_assignments.teacher_id` (FK CASCADE) | B:4301 | amélioré | `staff_id` FK composite `(tenant_id,staff_id)` sans cascade, immuable (`teaching_assignments_guard`) | Pour changer d'enseignant : `replaceTeachingAssignment` (historique REPLACED) |
| TB-27 | `teacher_assignments.contract_type` enum `salarie/vacataire` (axe distinct de `teachers.contract_type`) | B:12 | abandonné | le régime de travail = `staff_contracts` (kind PERMANENT/FIXED_TERM/CASUAL) ; le régime de paie = 032 | Trois axes de contrat sans lien ni validation croisée (§4) ; l'affectation dit QUI est responsable de QUOI, pas COMMENT il est payé |
| TB-28 | `teacher_assignments.datebut/datefin` NOT NULL + CHECK `datefin >= datebut` ; bornée à l'année par l'API | M/0005:80 | amélioré | `starts_on NOT NULL`, `ends_on` NULLABLE (affectation ouverte), CHECK `ends_on >= starts_on` conservé ; année portée par `academic_year_id` | Une affectation sans date de fin est la norme ; bornes à l'année vérifiées par le use case via `academic.getAcademicYear` |
| TB-29 | `teacher_assignments.course_amount` DECIMAL(10,2) (forfait vacataire, obligatoire à la création, JAMAIS payé) | B:1801-1819 | abandonné | aucun montant dans `people` ; si un forfait doit exister : tarif du bénéficiaire en 032 | Champ inerte (§5.3-24) ; refuse la 2e source de vérité de rémunération |
| TB-30 | `teacher_assignments.status` enum `active/paused/ended/cancelled` (transitions libres) | B:15 | amélioré | `status` ACTIVE/ENDED/CANCELLED ; une affectation terminée ne se réactive pas (garde) ; `paused` -> ENDED à l'import (voir §7-E4) | Machine à états explicite |
| TB-31 | `teacher_assignments.notes` | B:1801-1819 | conservé | `teaching_assignments.note` | Inchangé |
| TB-32 | `teacher_assignments.hours_validated`, `validated_by`, `validated_at` (colonnes Prisma-only, écrites par `POST /validate`) | B:1801-1819 | abandonné | heures validées = occurrences validées : `scheduling.session_occurrences.validated_at/validated_by`, `occurrence_staff` | Volume saisi à la main, jamais lu par la paie (§5.2-14) ; remplacé par l'événement réel (séance tenue + validée) |
| TB-33 | Contrainte `EXCLUDE gist (tenant, class_course, teacher, daterange)` déclarée mais ABSENTE de la base réelle ; contrôle API désactivé (`teacher-assignments.ts:232,257,868,886`) | M/0005:162-169 | amélioré | index uniques partiels `teaching_assignments_one_lead` (1 LEAD vivant par classe x nœud x période), `_one_homeroom` (1 titulaire vivant par classe), `_no_dup` (même personne/objet/rôle) | La règle existe enfin en base ; CO_TEACHER libre (co-enseignement explicite) |
| TB-34 | Index tenant/teacher/class_course/(tenant,status)/(tenant,datebut,datefin) ; policy RLS | M/0005:109-113, 129-132 ; B:3353-3365 | amélioré | `teaching_assignments_by_staff`, `_by_classroom`, `_by_node` ; RLS forcée | Inchangé dans l'esprit |
| TB-35 | `teacher_assignments_audit` + trigger `log_teacher_assignments_audit` (jamais lue ; `app.user_id` jamais positionné) | M/0006:4-53 ; B:1822-1833 | amélioré | `people.teaching_assignment_history` (kind CREATED/UPDATED/ENDED/CANCELLED/REPLACED, `from_value/to_value`, `reason`, `actor_id`) immuable (trigger) | Journal réellement alimenté par le use case avec l'acteur et le motif ; UUID unique (BIGSERIAL vs UUID divergents) |
| TB-36 | `course_assignments` (cours x enseignant x année x semestre ; alimentée par effet de bord de `POST /validate`) | B:540-557 ; M/0002:108-121 puis DROP M/0005:7 | abandonné | aucune ; volume prévu = `teaching_assignments.planned_hours` ; heures réelles = occurrences validées (017) | Journal d'agrégat artificiel (semestre forcé à 1, `hours_assigned` = 40 par défaut), sans FK vers `courses` en base réelle |
| TB-37 | `teaching_hours` (heures enseignées validées, `hours_taught` DECIMAL(4,2), `session_type` 8 valeurs) | B:1981-1994 ; M/0002:124-135 | abandonné | `scheduling.session_occurrences` (HELD + `validated_at`) + `occurrence_staff` ; durée = minutes | Table « Prisma-only » jamais lue par la paie (`academic-hour-collector.ts:24-28`), vide en production (`owner-payroll-mass.service.ts:38`), sans unicité, overflow >99,99 |
| TB-38 | `teacher_attendance_sessions` (VRAIE source des heures académiques : séance déclarée par l'enseignant, `duration_hours` INTEGER, statut draft/pending/completed) | M/0028:11-42 ; M/0043:27-29 ; DDL runtime `R/teacher-attendance.ts:39-163` | hors module -> 017 | `scheduling.session_occurrences` + `occurrence_staff` (intervenant réel) ; `status` PLANNED/HELD/CANCELLED + `validated_at/by` ; durée en minutes (`paid_minutes` dérogation) | Heures entières, validation non tracée, DDL à chaque requête ; remplacée par l'agrégat séance unique |
| TB-39 | `teacher_attendance_records` (appel des étudiants rattaché à la séance de paie) | M/0028:70-82 | hors module -> 010 | `attendance.sessions` / `attendance.student_records` ; `submitAttendanceSession` fait passer l'occurrence à HELD | Un seul modèle d'appel (010) |
| TB-40 | `professional_session_ecue_teachers` (UN enseignant par (cohorte, ECUE), UNIQUE `(tenant,ue_session,ecue)`, backfill 0070:42-48) | M/0070:13-27, 42-48 | amélioré | `teaching_assignments` role `LEAD` sur le nœud ECUE (`curriculum_node_id`) de la classe (la cohorte = classe x nœud UE = offre) ; backfill = une affectation LEAD par ECUE | Même règle « un responsable par ECUE » (index `one_lead`) + co-enseignement (CO_TEACHER) + période + historique + contrôle du statut du personnel |
| TB-41 | `professional_ue_sessions.enseignant_id` (titulaire de cohorte, « modèle précédent ») | M/0069:149 | abandonné | aucune colonne ; la responsabilité vit dans `teaching_assignments` | Une des 5 sources concurrentes ; n'alimente plus aucun contrôle d'accès (T-082) |
| TB-42 | `professional_ecue_seances.enseignant_id` + colonnes validation/paie (`statut`, `statut_modifie_par/le`, `validated_by/at`, `duree_payee` NUMERIC(5,2) + auteur/date, `saisie_comptable`, `cree_par`) | M/0069:166-180 ; M/0103:73-83 ; M/0104:38-48 | hors module -> 017 | `session_occurrences` (status, `held_*`, `validated_*`, origin ACCOUNTING) + `occurrence_staff` (`staff_id` = intervenant réel, `paid_minutes/by/at`, `locked_at/lock_ref`) ; prédicat payable = `scheduling.payable_hours` | « Intervenant réel, remplaçant compris » = `occurrence_staff` ; durée payée en minutes entières |
| TB-43 | `professional_emploi_temps.enseignant_id` (créneau hebdo récurrent, SET NULL) | M/0076:18 ; M/0077:5-7 | hors module -> 017 | `scheduling.timetable_entries` + `timetable_entry_staff` | Conflits enseignant imposés par la base en v2 (aucun contrôle en legacy) |
| TB-44 | `professional_course_plannings.enseignant_id` (planning daté ponctuel, SET NULL) | M/0072:19 ; M/0073 | hors module -> 017 | `session_occurrences` (origin AD_HOC) | Trois objets calendaires (planning / emploi du temps / séance) fusionnés en un agrégat |
| TB-45 | `professional_subject_sessions.enseignant_id` (ancien modèle « matière ») | M/0061:72 ; DROP M/0069:51 | abandonné | aucune | Table déjà supprimée dans le legacy |
| TB-46 | `session_instances.teacher_id` (cours daté Classique, SET NULL) | M/0017, 0025-0027 | hors module -> 017 | `session_occurrences` + `occurrence_staff` | Planning Classique |
| TB-47 | `assignments.teacher_id` (CASCADE, M/0009:17), `assignment_instances.teacher_id` (CASCADE, M/0018:16) — évaluations | M/0009:17 ; M/0018:16 | hors module -> 011 | `assess` référence `people.staff.id` par UUID (pas de FK) ; `getStaffByIds` pour l'affichage | Le CASCADE supprimait les évaluations avec l'enseignant (§1.10) : impossible en v2 (aucune suppression physique) |
| TB-48 | `attendance_sessions.teacher_id` (CASCADE, M/0008:45) | M/0008:45 | hors module -> 010 | `attendance.sessions` (UUID `staff_id`) | Idem |
| TB-49 | `teacher_payment_configs` (teacher_id CASCADE) | M/0011_fixed:51-75 ; M/0113:28 | hors module -> 032 | configuration de paie du bénéficiaire (032) ; `people.getStaffByIds` pour l'identité | Tarifs/configs hors `people` |
| TB-50 | `teacher_payments`, `payment_hour_details` (colonnes `teaching_hours_id`, `attendance_session_id`, `seance_id`), `payment_period_teachers` (RESTRICT) | M/0011_fixed:78-109 ; M/0106:61-70 ; M/0103:169-253 ; M/0105 ; M/0107:31-48 | hors module -> 032 | bulletins/lignes/périmètre de période de la paie ; références vers `scheduling.occurrence_staff` (lock_ref) au lieu de `seance_id` | Une heure ne se paie qu'une fois : ledger côté paie (voir §7-E10) |
| TB-51 | `course_hourly_rates` (teacher_id NULL) et `professional_ecue_hourly_rates` (enseignant_id NULL, EXCLUDE sans chevauchement) | M/0011_fixed:129-148 ; M/0103:109-125, 133-146 | hors module -> 032 | tarification (032) ; bug de parité corrigé là-bas (tarif nominatif appliqué à tous, P-07) | Hors `people` |
| TB-52 | `formateurs`, `session_formateurs`, `notifications_formateurs`, `session_attendance` (formations professionnelles Imhotep, REMOVE:imhotep D7) | B:904-924 ; M/0056:21-43 | abandonné | aucune ; formateur éventuel = `staff` (catégorie `can_teach`) | Module formations-pro supprimé (décision D7) |
| TB-53 | `formateur_indisponibilites` (SEUL modèle de disponibilités du legacy) | M/0056:112-129 | abandonné | concept recréé en `people.staff_availabilities` (voir N-06) | Table supprimée avec Imhotep ; v2 introduit la fonction pour tous les enseignants |
| TB-54 | `tenants.settings_json -> teacherCredentialsEmail` (modèle d'email d'identifiants) | `S/teacher-credentials-email.ts:194,216` | abandonné | invitation d'activation via 016 communications / iam | Le modèle embarque `{{password}}` en clair |
| TB-55 | Enums `teacher_status`, `contract_type`, `assignment_contract_type`, `assignment_status`, `session_type` (8 valeurs, Zod à 4) | M/0002:10-11 ; B:12,15,30,138,147 ; `packages/contracts/src/academic.ts:11` | amélioré | statuts = CHECK/machine à états ; types de contrat/catégories = données de pack ; `session_type` -> `session_occurrences.kind` (017) | Plus d'enum divergent entre base et contrat Zod |
| TB-56 | Absence : personnel administratif/RH, contrats datés, historique de statut, charge contractuelle, disponibilités, compétences, documents, congés, pointage (§1.12, §4) | — | nouveau | `staff_categories` (+`can_teach`/`can_supervise`), `contract_types`, `staff_contracts`, `staff_status_history`, `staff_availabilities`, `staff_competencies`, `staff_qualifications`, `staff_affiliations` ; congés/pointage -> `attendance.staff_leaves/staff_records` (010) | Cf. §2.K |

---

## 2. Fonctions et endpoints par famille

Le legacy n'applique AUCUNE garde de rôle sur la quasi-totalité des routes teachers/affectations/heures (seuls `reset-password`, `teacher-payments.ts:1521,1581` et le module Pro) ; l'identité vient de `X-User-Id` (falsifiable). Toutes les cibles v2 sont protégées par permission (`staff.*`, `teaching.*`, `schedule.*`, `attendance.*`) et l'identité vient du jeton.

### 2.A Fiche enseignant et comptes — `/api/v1/teachers` (`R/teachers.ts`, `index.ts:201`) ; comptes : T-003..T-006, T-012..T-014

| ID | Fonction | Fichier:ligne | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| T-001 | Lister les enseignants (filtres statut/contrat/email, pagination 20/100, LEFT JOIN users pour `initial_password`) | R/teachers.ts:88 (handler 143-227) | amélioré | `GET /api/v1/people/staff` (`listStaff`, perm `staff.list`) : filtres `status`, `category`, `canTeach`, `contractKind`, `institution`, `q` (recherche texte via `search_key`) ; sans mot de passe | Le legacy n'a pas de recherche texte ; plus de `initial_password` exposé |
| T-002 | Créer enseignant (+ compte `users` + `user_roles` + email d'identifiants, rôle `teacher` créé à la volée) | R/teachers.ts:231 (handler 290-519) | amélioré | `POST /staff` (`createStaff`, perm `staff.create`) : personne + dossier `staff` (n° généré) + contrat initial + affiliations, en une transaction ; compte optionnel via `provisionStaffAccount` (invitation) ; événement `people.staff.created` | Corrige : mot de passe fourni/renvoyé en clair, email unique inter-tenants révélé, création de rôle à la volée, transaction partielle ; un enseignant sans email reste possible (fiche sans compte) |
| T-003 | Lire le modèle d'email d'identifiants | R/teachers.ts:523 | abandonné | — (invitations : 016 + iam) | Le modèle contient le mot de passe en clair ; plus de mot de passe initial |
| T-004 | Enregistrer le modèle d'email d'identifiants | R/teachers.ts:560 | abandonné | — (idem T-003) | Idem |
| T-005 | (Ré)envoyer les identifiants (régénère un mot de passe si vide, `Math.random`) | R/teachers.ts:588 | abandonné | renvoi d'invitation = iam/016 (`provisionStaffAccount` idempotent) | Mot de passe en clair ré-envoyé ; `JOIN users` sans filtre tenant |
| T-006 | Réinitialiser le mot de passe (seule route à garde admin ; renvoie le clair) | R/teachers.ts:690 | hors module -> 002 | flux « mot de passe oublié »/réinitialisation iam, jamais de mot de passe renvoyé | Authentification = iam |
| T-007 | Détail d'un enseignant | R/teachers.ts:764 | amélioré | `GET /staff/:id` (`getStaff`, perm `staff.read`) ; contrats/qualifications selon permission ; `GET /me/staff` pour son propre dossier (`staff.own.read`) | Pas de `GET /teachers/me` en legacy : la web paginait (limit 20) et ratait l'enseignant au-delà du 20e (§2.E) |
| T-008 | Modifier l'enseignant (update dynamique, y compris `hourlyRate/contractType/status` ; auto-rattrapage du compte ; 404/409 sans ROLLBACK) | R/teachers.ts:856 (handler 923-1208) | amélioré | `PUT /staff/:id` (`updateStaff`, perm `staff.update`) pour l'identité/contact ; statut = `POST /staff/:id/status` ; contrat = `/staff/:id/contracts` (perm sensible `staff.contract.manage`) ; auto-édition limitée au contact/bio via `/me/staff` ; compte = action explicite `provisionStaffAccount` | Corrige : l'enseignant ne peut plus modifier sa rémunération/contrat/statut, transactions refermées, plus d'auto-création silencieuse de compte, email non propagé (iam possède l'email de connexion) |
| T-009 | Supprimer l'enseignant (DELETE physique, cascade massive) | R/teachers.ts:1212 | abandonné | `changeStaffStatus(LEFT, left_on, motif)` ; `staff_no_delete` | Cascade sur évaluations/affectations/bulletins/tarifs/configs (TB-18) |
| T-010 | Mes classes (portail) via `X-User-Id` | R/teachers.ts:1295 | amélioré | `GET /api/v1/people/me/classes` : affectations ACTIVE (à la date, année courante) du jeton, avec classe et nœud | Filtre statut ET dates (legacy ne filtre ni l'un ni l'autre, §5.3-29) ; identité du jeton |
| T-011 | Helpers : `generateTemporaryPassword`, `serializeTeacherRow`, `isUniqueViolation`, `canViewInitialPassword/maskInitialPassword` | R/teachers.ts:28,55,82 ; middlewares/credentials-visibility.ts:24,35 | abandonné | DTO Zod `packages/contracts` ; mapping d'erreurs standard ; plus de mot de passe clair | PRNG non cryptographique ; masquage de rôle devenu sans objet |
| T-012 | Créer un utilisateur nu (`POST /api/v1/users`, aucun rôle, ouvert à tout authentifié) | R/users.ts:6 | hors module -> 002 | iam (création de membership/identité sous permission) | Hors périmètre `people` ; ouverture sans garde à corriger là-bas |
| T-013 | Lister comptes / gérer rôles propriétaire (donner `teacher` sans fiche -> 404 sur le portail) | R/owner/index.ts:1300,1310 ; S/owner-users.service.ts:20,60 | hors module -> 002 | rôles iam ; l'accès « enseignant » exige une ligne `staff` liée (`resolveStaffForIdentity`) et une 404 explicite sinon | Incohérence rôle sans fiche corrigée par résolution unique ; l'inverse (fiche sans compte) reste supporté |
| T-014 | Rôles admin custom (CRUD rôles + menus + affectation) | S/admin-roles.service.ts (654 l.) | hors module -> 002 | RBAC v2 | Hors périmètre |

### 2.B Affectations d'enseignement classiques — `/api/v1/teacher-assignments` ET alias `/api/v1/teacher/assignments` (`R/teacher-assignments.ts`, enregistré 2x `index.ts:217,279`)

| ID | Fonction | Fichier:ligne | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| T-020 | Créer une affectation (teacherId, contrat salarie/vacataire, dates, montant ; crée `class_courses` à la volée ; pas de contrôle de chevauchement) | R/teacher-assignments.ts:85 (handler 104-267) | amélioré | `POST /teaching-assignments` (`createTeachingAssignment`, perm `teaching.assign`) : `staff_id`, `classroom_id`, `curriculum_node_id` OU `covers_all_subjects` OU HOMEROOM, `role_code`, `period_id?`, `starts_on/ends_on`, `planned_hours?` ; événement `people.teaching_assignment.created` | Garde DB : personnel ACTIF/ON_LEAVE et catégorie `can_teach` (`teaching_assignments_guard`), 1 LEAD par (classe, nœud, période) ; use case : nœud appartenant au curriculum de la classe, jamais un nœud transversal, dates dans l'année ; abandon de `contractType`/`courseAmount` (TB-27/29) et de la création implicite de `class_courses` |
| T-021 | Lister les affectations (filtres teacher/classe/cours/année/statut/dates/validated/`showAll`, restreint par `X-User-Id`) | R/teacher-assignments.ts:271 (handler 290-446) | amélioré | `GET /staff/:id/assignments` (`listAssignmentsForStaff`), `GET /classrooms/:id/assignments` (`listAssignmentsForClassroom`), filtres année/statut/rôle/date ; l'enseignant ne voit que les siennes via `/me/classes` | Supprime `showAll` (contournement trivial) et la restriction par en-tête ; le filtre `validated` disparaît (TB-32) ; sémantique dates clarifiée (« actif à la date » au lieu de « contient la période ») |
| T-022 | Détail d'une affectation (restreint si `X-User-Id` = enseignant) | R/teacher-assignments.ts:677 | amélioré | `GET /teaching-assignments/:id` (perm `teaching.read`, ou propriétaire via jeton) | Idem T-021 (spoofing) |
| T-023 | Modifier une affectation (payload brut, statut libre, `classId/courseId` ignorés) | R/teacher-assignments.ts:786 | amélioré | `PATCH /teaching-assignments/:id` limité à `note`, `planned_hours`, `ends_on` ; changement de responsable = `POST /:id/replace` (`replaceTeachingAssignment`) ; `POST /:id/end` ; identité (staff, classe, nœud, rôle) immuable | Corrige : payload non validé, pas de contrôle teacher, transitions libres ; l'historique REPLACED remplace l'écrasement |
| T-024 | Supprimer une affectation (DELETE physique, cascade `teacher_attendance_sessions`) | R/teacher-assignments.ts:899 | abandonné | `POST /teaching-assignments/:id/end` (`endTeachingAssignment`, motif, `ends_on`) ou CANCELLED ; `teaching_assignments_no_delete` ; événement `people.teaching_assignment.ended` (-> scheduling : occurrences futures `replacement_needed`) | La cascade détruisait les heures déclarées/validées |
| T-025 | Valider des heures d'affectations (`hours_validated` + upsert `course_assignments` + `teaching_hours` ; validateur UUID codé en dur ; `hoursAssigned` toujours 40) | R/teacher-assignments.ts:921 (handler 941-1063, userId l.947, hoursAssigned l.982) | abandonné | validation d'heures = `scheduling.validateOccurrence`/`validateOccurrencesBatch` (017) | Trois « heures validées » concurrentes saisies à la main ; faux validateur ; overflow ; voir §4 |
| T-026 | Générer les créneaux manquants (grille 2 h fixe, salle `TBD`, 1/semaine) | R/teacher-assignments.ts:450 (handler 463-673) | hors module -> 017 | `generateOccurrences` / `suggestSlots` (patron `timetable_entry` + `time_slots` en données) ; `source = 'TIMETABLE'` possible sur l'affectation | Constantes en dur abandonnées (§5) ; conflits imposés par la base |
| T-027 | Étudiants d'une affectation (accepte teacher.id ou user.id ; tolère 2 tenant_id ; matricule `STU<année><ROW_NUMBER>` recalculé) | R/teacher-assignments.ts:1069 | hors module -> 004 | `GET /academic/classrooms/:id/roster` (`getRoster`) ; droit d'accès de l'enseignant = affectation ACTIVE (preuve fournie par `listAssignmentsForStaff`) ; matricule = `students.student_number` immuable (008) | Contournement de bug de tenant et matricule instable abandonnés ; règle d'accès à trancher (§7-E8) |
| T-028 | Sessions planifiées de l'enseignant (`session_instances`) | R/teacher-assignments.ts:1272 | hors module -> 017 | `listOccurrencesForStaff`, `GET /views/staff/:id`, `GET /me/today` | Planning = 017 ; ambiguïté user.id/teacher.id levée (jeton) |
| T-029 | Calendrier de l'enseignant + stats (`view` week/month/semester) | R/teacher-assignments.ts:1416 | hors module -> 017 | `GET /views/staff/:id`, `getStaffWeeklyLoad` (017) ; charge prévue : `people.getTeachingLoad` | Réparti : planning réel = 017, charge prévue/contractuelle = people |
| T-030 | Audit d'affectation (trigger `log_teacher_assignments_audit`) | M/0006_teacher_assignments_audit.sql:22-53 | amélioré | `teaching_assignment_history` (TB-35) | Réellement alimenté (acteur, motif), append-only |

### 2.C Affectations Professional (titulaire par ECUE / cohorte) — module pro (admin) et espace enseignant pro

| ID | Fonction | Fichier:ligne | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| T-080 | Lister les enseignants par ECUE d'une cohorte (flag `is_conduite`, nom via `users`) | R/professional.ts:1167 ; S/professional-ue.service.ts:1042 | amélioré | `GET /classrooms/:id/assignments` (`listAssignmentsForClassroom`, filtre nœud) ; nom via `persons` ; `is_transversal` du nœud (academic) à la place de la détection par libellé | Fiche sans compte affichable (legacy : nom vide) |
| T-081 | Affecter / retirer un enseignant à un ECUE (ECUE∈UE, pas de Conduite, 1 enseignant par ECUE/cohorte, upsert, `null` = suppression) | R/professional.ts:1177 ; S/professional-ue.service.ts:1076 (ECUE∈UE l.1076-1127 ; Conduite l.1055,1088) | amélioré | `createTeachingAssignment` (LEAD, nœud ECUE de la classe) / `replaceTeachingAssignment` / `endTeachingAssignment` ; événements `people.teaching_assignment.created/replaced/ended` | Reproduit : ECUE ∈ UE de l'offre (vérifié via academic), Conduite sans enseignant (`is_transversal`), un LEAD par ECUE (index `one_lead`). Corrigé : statut du personnel contrôlé (trigger), compétence signalée (avertissement), retrait = fin d'affectation tracée, co-enseignement possible (CO_TEACHER) |
| T-082 | Titulaire de cohorte (ancien modèle, `enseignant_id` sur la cohorte) | S/professional-ue.service.ts:586,684 | abandonné | aucun (responsabilité = `teaching_assignments`) | Source concurrente sans effet (TB-41) |
| T-083 | CRUD des séances pro (admin/teacher ; update/delete sans contrôle de verrou) | R/professional.ts:1045-1101 ; S/professional-ue.service.ts:912,964,982,1025 | hors module -> 017 | `createOccurrence`, `rescheduleOccurrence`, `setOccurrenceStaff`, `cancelOccurrence` ; refus si `locked_at`/validée | Séance validée modifiable en legacy ; ici verrou `occurrence_staff.locked_at` |
| T-084 | Planning daté pro (admin = toutes sessions ouvertes ; enseignant = ses ECUE) | R/professional.ts:953-1041 ; S/professional-planning.service.ts:45,72,104,155,196,238,289 | hors module -> 017 | `session_occurrences` (origin AD_HOC) ; visibilité enseignant par `occurrence_staff`/affectation | Trois objets calendaires -> un seul |
| T-085 | Emploi du temps hebdomadaire pro (`/emploi-temps/*`, `enseignant_id` indépendant de l'affectation, aucun contrôle de conflit) | R/professional.ts:803-944 ; S/professional-emploi-temps.service.ts:380,415 | hors module -> 017 | `timetables` / `timetable_entries` + `timetable_entry_staff` ; conflits enseignant/classe/salle imposés (`resource_claims_no_overlap`) ; `people` fournit disponibilités/compétences (avertissements) | Conflits désormais impossibles en base |
| T-086 | Présence par séance (admin/teacher) + `basculerSeanceRealisee` côté admin | R/professional.ts:1197-1229 | hors module -> 010 | `markStudentRecords` ; constat HELD via 017 | Un seul modèle d'appel |
| T-090 | Mes cohortes (pro) : cohortes où j'ai ≥1 ECUE, nb inscrits | R/professional.ts:3583 ; S/professional-teacher.service.ts:79 | amélioré | `GET /me/classes` (affectations + offre/classe) ; effectifs depuis academic (`getRoster`/offerings) | Même source que le classique |
| T-091 | Mes étudiants (étudiant x cohorte des inscrits confirmés) | R/professional.ts:3596 ; S/…teacher.service.ts:108 | hors module -> 004 | `getRoster` limité aux classes où j'ai une affectation ACTIVE | Roster = academic |
| T-092 | Historique d'appels de mes ECUE | R/professional.ts:3609 ; S/…:141 | hors module -> 010 | `getClassroomAttendanceSummary` / `listAbsences` | Présence = 010 |
| T-093 | Mes évaluations (ECUE affectés) | R/professional.ts:3622 ; S/…:186 | hors module -> 011 | assess : évaluations filtrées par `listAssignmentsForStaff` | Évaluations = 011 |
| T-094 | Mon emploi du temps (`professional_emploi_temps.enseignant_id = moi`, ≠ affectation) | R/professional.ts:3635 ; S/…:235 | hors module -> 017 | `GET /views/staff/:id`, `GET /me/today` (basés sur `occurrence_staff`) | Intervenant réel, remplaçant compris |
| T-095 | Mes ECUE (affectés, nb inscrits, nb séances) | R/professional.ts:3648 ; S/…:311 | amélioré | `GET /me/classes` (nœuds), effectifs academic, séances 017 | Idem T-090 |
| T-096 | Séances d'une cohorte (403 si cohorte non affectée) | R/professional.ts:3660 ; S/…:341 | hors module -> 017 | `listOccurrencesForStaff` filtré classe/nœud ; droit = affectation ACTIVE OU présence dans `occurrence_staff` | Un remplaçant sans affectation doit voir sa séance |
| T-097 | ECUE de la cohorte (les miens) | R/professional.ts:3674 ; S/…:456 | amélioré | `listAssignmentsForStaff(staffId, {classroomId})` | Même donnée |
| T-098 | Créer une séance (exige l'affectation ; créée `planifiee`) | R/professional.ts:3688 ; S/…:383 | hors module -> 017 | `createOccurrence` (AD_HOC), sous permission à définir (§7-E7) | Auto-déclaration d'une séance non planifiée : droit à trancher |
| T-099 | Détail d'une séance | R/professional.ts:3713 ; S/…:269 | hors module -> 017 | `getOccurrence` | — |
| T-100 | Supprimer une séance (même validée non payée) | R/professional.ts:3727 ; S/…:432 | hors module -> 017 | `cancelOccurrence` (motif obligatoire, refus si validée/verrouillée) ; suppression physique abandonnée | Une séance validée ne se supprime plus |
| T-101 | Liste d'appel (inscrits `confirmee/terminee` + statut) | R/professional.ts:3741 ; S/…:485 | hors module -> 010 | `openAttendanceSession` (feuille d'appel par inscription) | — |
| T-102 | Faire l'appel (upsert, fait passer la séance `planifiee`->`realisee`) | R/professional.ts:3755 ; S/…:514 | hors module -> 010 | `markStudentRecords` + `submitAttendanceSession` -> événement `attendance.session.submitted` -> occurrence HELD (017) | Constat de réalisation consommé par scheduling |
| T-103 | Constat de réalisation `basculerSeanceRealisee` (`planifiee->realisee`, `annulee` jamais ressuscitée) | S/professional-seance-constat.ts:36-53 | hors module -> 017 | `holdOccurrence` (held_source ATTENDANCE/ADMIN/AUTO) | Machine PLANNED->HELD, CANCELLED terminal |

### 2.D Heures d'enseignement déclarées / validées (source de la paie, hors calcul)

| ID | Fonction | Fichier:ligne | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| T-040 | Lister `course-assignments` (UNION ALL avec affectations « converties », `hours_assigned = (fin-début)*2`) | R/course-assignments.ts:19 | abandonné | `listAssignmentsForStaff` + `planned_hours` ; heures réelles = 017 | Heuristique « 2 h/jour » absurde ; filtres appliqués à une seule branche |
| T-041 | Valider `course-assignments` (validateur UUID en dur, upsert `teaching_hours`) | R/course-assignments.ts:119 (l.140-142) | abandonné | `validateOccurrence` (017) | Validateur codé en dur ; table abandonnée (TB-36) |
| T-042 | Lister `teaching-hours` (pagination factice, `z.coerce.boolean`) | R/teaching-hours.ts:21 | abandonné | `listOccurrences` / `listPayableHours` (017) | Table abandonnée (TB-37) |
| T-043 | (Dé)valider en lot `teaching-hours` (crée `validator-<ts>@example.com` / `testpassword123`, ROLLBACK sur une autre connexion) | R/teaching-hours.ts:102 (l.130-141,163) | abandonné | `validateOccurrencesBatch` / `unvalidateOccurrence` (017, permission `schedule.occurrence.validate` sensible, MFA) | Faille de sécurité (compte de test à mot de passe codé) |
| T-044 | Créer des heures depuis les affectations (`from-assignments`, validées immédiatement, doublons non contrôlés) | R/teaching-hours-batch.ts:14 (l.34-43) | abandonné | si un rattrapage comptable est nécessaire : `createAccountingOccurrence` (017, origin ACCOUNTING, non validée) | Fabrication d'heures sans séance ; même compte de test |
| T-050 | Lister les séances d'un enseignant + totaux (`amount = durée x taux` ≠ montants payés ; `sessionType` forcé `theory`) | R/teacher-attendance.ts:167 (handler 188-428) | hors module -> 017 | `listOccurrencesForStaff` + `listPayableHours` ; estimation de montant = 032 (un seul calculateur) | Montants affichés ≠ payés (ignore `course_hourly_rates`) |
| T-051 | Enregistrer une séance + appel (`durationHours` entier 1..12, créneau libre, upsert par (affectation,date,créneau)) | R/teacher-attendance.ts:432 (handler 471-673) | hors module -> 017 | occurrence planifiée/AD_HOC (017) + appel (010) ; durée en minutes | Heures entières et plafond 12 h abandonnés ; droit d'auto-déclarer à trancher (§7-E7) |
| T-052 | Historique d'une affectation (séances + appel) | R/teacher-attendance.ts:677 | hors module -> 017 | `listOccurrences` filtré (classe, nœud, intervenant) | — |
| T-053 | Soumettre à validation (`draft->pending`) | R/teacher-attendance.ts:861 (handler 883-974) | hors module -> 010 | `submitAttendanceSession` (soumission de l'appel) -> HELD | La « soumission » devient le constat de tenue |
| T-054 | Valider les heures (admin ; `pending/draft->completed` ; sans garde de rôle ; sans `validated_by/at`) | R/teacher-attendance.ts:978 (handler 994-1069, TODO l.1013) | hors module -> 017 | `validateOccurrence` / `validateOccurrencesBatch` (permission sensible, `validated_by/at` NOT NULL ensemble, journal `occurrence_changes`) | Validation tracée, dé-validation motivée (impossible si `locked_at`) |
| T-055 | DDL runtime `ensureTeacherAttendanceTables` | R/teacher-attendance.ts:39-163 | abandonné | migrations versionnées 1000-1099 | Schéma statique requis |

#### 2.D bis Validation des séances pour la paie — `/api/v1/professional/remuneration` (`R/professional-remuneration.ts`, `requireAdmin` sauf `my/*`) — frontière [PAIE]

Ces fonctions sont le pendant « enseignement » de la paie : elles décrivent l'état des heures qui alimente la paie. En v2 elles appartiennent à `scheduling` (une seule machine d'états PLANNED -> HELD -> validée) ; `people` n'y fournit que l'identité (`getStaffByIds`).

| ID | Fonction | Fichier:ligne (route / service) | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| T-110 | Lister les séances avec payabilité et motifs (`computeBlockers`), filtres enseignant/cohorte/ECUE/dates/année/statut/validées/payables, agrégats serveur | R/professional-remuneration.ts:201 / S/professional-seance-validation.service.ts:235 (blockers l.181-191) | hors module -> 017 | `listOccurrences`, `listPendingValidation`, `listPayableHours` (blockers exposés par 017) | Un prédicat unique côté SQL |
| T-111 | Années scolaires disponibles (options de filtre, pivot septembre) | R/professional-remuneration.ts:217 / S/…:411 (pivot l.96-105) | hors module -> 004 | `listAcademicYears` | Années = academic, pivot codé en dur abandonné |
| T-112 | Enseignants « à traiter » (≥1 séance réalisée non validée) | R/professional-remuneration.ts:228 / S/…:435 | hors module -> 017 | `listPendingValidation` regroupé par `staff_id` ; identité via `getStaffByIds` | — |
| T-113 | Changer le statut de réalisation (`planifiee/realisee/annulee`, refus si paiement approuvé/payé, sortir de `realisee` retire la validation) | R/professional-remuneration.ts:237 / S/…:462 (`LOCKING_STATUSES` l.176) | hors module -> 017 | `holdOccurrence` / `unholdOccurrence` / `cancelOccurrence` ; refus si `occurrence_staff.locked_at` | Verrou posé par la paie (`lockHours`) |
| T-114 | (Dé)valider en lot (≤500, application partielle, motifs de rejet, `DEJA_PAYEE`) | R/professional-remuneration.ts:254 / S/…:510 | hors module -> 017 | `validateOccurrencesBatch`, `unvalidateOccurrence` (permission sensible, MFA) | Partiel avec motifs conservé |
| T-115 | Dérogation de volume (`duree_payee` ∈ (0,24] ou null, trace auteur/date) | R/professional-remuneration.ts:274 / S/…:588 | hors module -> 017 | `setPaidMinutes` (`occurrence_staff.paid_minutes/by/at`) | Minutes entières ; plafond à trancher (§7-E11) |
| T-116 | Séance « de saisie comptable » (réalisée, non validée, `saisie_comptable=true`) | R/professional-remuneration.ts:292 / S/…:646 | hors module -> 017 | `createAccountingOccurrence` (origin ACCOUNTING) | — |
| T-117 | Séances manquantes (rapprochement emploi du temps <-> séances) | R/professional-remuneration.ts:312 / S/…:726 | hors module -> 017 | `listUnrealizedOccurrences` | — |
| T-118 | Chevauchements d'un enseignant (séances réalisées ET validées) | R/professional-remuneration.ts:329 / S/…:797 | hors module -> 017 | `findValidatedOverlaps` (+ exclusion en base pour les nouvelles séances) | Le double-booking devient impossible |
| T-119 | Fiche séance (contexte, présences, lignes de paiement) | R/professional-remuneration.ts:348 / S/…:375 | hors module -> 017 | `getOccurrence` (+ présences 010, lignes 032) | — |
| T-120 | Prédicats centralisés `SEANCE_PRETE_A_VALIDER_PREDICATE`, `SEANCE_PAYABLE_PREDICATE`, `DUREE_PAYEE_SQL` | S/professional-seance-validation.service.ts:46,66,85 | hors module -> 017 | SQL `scheduling.payable_hours` (HELD + `validated_at` + `is_paid_role`, durée = `paid_minutes` sinon durée de séance) | Prédicat unique partagé avec la paie |
| T-121 | Tarifs ECUE (CRUD, résolution ECUE+enseignant > générique > défaut, EXCLUDE) | R/professional-remuneration.ts:359-429 / S/professional-ecue-rates.service.ts:55-230 | hors module -> 032 | tarification (032) | Tarifs hors `people` |
| T-122 | Espace « my » (`/my/seances`, `/my/payments`, `/my/configuration`, `/my/historique`) avec `teacher_id` dérivé du jeton | R/professional-remuneration.ts:438-451 (resolveOwnTeacherId), 453, 473, 520, 568 | hors module -> 032 | vues « moi » de la paie ; identité par `resolveStaffForIdentity` (jeton, jamais un paramètre) | Principe conservé : seul endroit du legacy où l'identité vient du jeton |
| T-123 | Vue d'ensemble bulletins de TOUS les enseignants + `periode-en-attente`, `periodes`, `historique`, `archiver`, `verser` | R/professional-remuneration.ts:93-197 / S/teacher-payroll-overview.service.ts:40-187 | hors module -> 032 | paie (032) | Paie |

### 2.E Portail enseignant

| ID | Fonction | Fichier:ligne | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| T-060 | Mes cours (affectations + supports + statut dérivé des dates + montants) | R/teacher-courses.ts:18 | amélioré | `GET /me/classes` (affectations, rôle, période, statut dérivé) ; supports -> 022 ; heures -> 017 ; montants supprimés | Plus de `courseAmount`/`contractType` exposés |
| T-061 | Détail d'un cours (= une affectation) | R/teacher-courses.ts:174 | amélioré | `GET /teaching-assignments/:id` (propriétaire via jeton) | — |
| T-062 | Modifier une affectation par l'enseignant (`courseAmount`, `contractType` ; `UPDATE` sans `tenant_id`) | R/teacher-courses.ts:341 (l.431-436) | abandonné | aucun chemin d'écriture enseignant sur l'affectation | Faille métier : auto-modification de la rémunération |
| T-063 | Mes classes + effectif | R/teacher-students.ts:38 | hors module -> 004 | `/me/classes` (people) + effectif `getRoster` (academic) | Effectif = academic |
| T-064 | Mes étudiants (toutes classes ayant une affectation, même `cancelled/ended`) | R/teacher-students.ts:166 | hors module -> 004 | `getRoster` conditionné à l'affectation ACTIVE (corrige §5.3-29) ; moyenne/présence -> 011/010 | Accès après fin d'affectation interdit |
| T-065 | Performance des classes | R/teacher-students.ts:359 | hors module -> 011 | assess/analytics (025) | Notes = 011 |
| T-066 | Progression | R/teacher-students.ts:512 | hors module -> 011 | idem | — |
| T-067 | Copies à corriger | R/teacher-corrections.ts:67 | hors module -> 011 | assess | — |
| T-068 | Classes (corrections) | R/teacher-corrections.ts:329 | abandonné | `GET /me/classes` | Doublon de T-010/T-063 |
| T-069 | Messagerie enseignant (`/teacher/messages/*`, `/teacher/conversations/*`) | R/teacher-messages.ts ; R/teacher-conversations.ts | hors module -> 016 | communications | — |
| T-070 | Pages web du portail enseignant (dashboard, courses, students, attendance, hours, payments, remuneration, professional-seances, schedule, reports, grades, corrections, communications, profile, settings, specialties, config, content, evaluations, assignments, student-tracking) | apps/web/src/app/teacher/* | hors module -> 033 | portail v2 par module : `profile/settings/specialties` -> `/me/staff` (people, champs de contact seulement) ; `courses/students` -> `/me/classes` ; `attendance` -> 010 ; `hours/schedule/professional-seances` -> 017 ; `payments/remuneration` -> 032 ; `grades/corrections/evaluations/assignments` -> 011 ; `communications` -> 016 ; `reports/dashboard` -> 025 ; `content` -> 022 | `profile/settings/specialties` écrivaient via `PUT /teachers/:id` (auto-modification de la rémunération) |

### 2.F Personnel non enseignant (absent du legacy)

Le legacy n'a aucun modèle de personnel administratif (§4 : seulement `users` + rôles `admin`/`owner` + rôles admin custom limitant les menus). Aucun ID legacy ; fonctions v2 listées en §2.K (N-01..N-04).

### 2.G Interface paie (données lues par le calculateur et les collecteurs)

| ID | Donnée / fonction legacy | Fichier:ligne | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| P-01 | Enseignants du périmètre : nom `COALESCE(users, teachers, email)`, `teachers.status='active'`, restriction `teacherIds` ; non-actifs ignorés silencieusement | S/payment-calculator.ts:435-446, 489 | amélioré | `people.getStaffByIds(ids)` / `listStaff` : `displayName` (persons), `status`, `categoryCode`, contrat actif (kind) ; la paie décide de l'éligibilité et SIGNALE les exclus | Le statut est exposé avec sémantique ; l'exclusion silencieuse disparaît (règle d'éligibilité = 032, §7-E3) |
| P-02 | Périmètre de période ciblée `payment_period_teachers` (FK RESTRICT) | M/0107:31-48 ; S/teacher-payroll-overview.service.ts:124-129,341 | hors module -> 032 | périmètre porté par 032 (UUID `staff_id`, pas de FK) | La suppression physique n'existe plus : la RESTRICT devient sans objet |
| P-03 | Heures académiques : `teacher_attendance_sessions` `completed`, enseignant payé = `ta.teacher_id` (affectation), exclusion des heures déjà consommées | S/hour-collectors/academic-hour-collector.ts:35-63 ; heures-consommees.ts:48-62 | hors module -> 017 | `scheduling.listPayableHours(from, to, staffIds)` = `scheduling.payable_hours` ; bénéficiaire = `occurrence_staff.staff_id` (intervenant réel) ; `locked`/`lock_ref` pour « consommée » | Bénéficiaire = intervenant réel, plus l'affectation |
| P-04 | Heures professionnelles : `professional_ecue_seances` payables (`SEANCE_PAYABLE_PREDICATE`, `DUREE_PAYEE_SQL`), enseignant = `se.enseignant_id` (réel, PAS l'affectation) | S/hour-collectors/professional-hour-collector.ts:37-65 | hors module -> 017 | idem P-03 (un seul collecteur : HELD + `validated_at` + `is_paid_role`, durée = `paid_minutes` sinon durée de séance) | Prédicat unique en SQL |
| P-05 | Champs de séance consommés : `statut`, `validated_*`, `enseignant_id`, `heure_debut/fin`, `duree_payee`, `date`, `ecue_id`, `ue_session_id` | S/professional-seance-validation.service.ts:46-88,181 | hors module -> 017 | colonnes de `payable_hours` : `occurrence_id, staff_id, occurs_on, minutes, kind, classroom_id, curriculum_node_id, offering_id, title, locked, lock_ref` | Rattachement tarifaire par nœud/classe/offre |
| P-06 | Configuration de paie par enseignant (`teacher_payment_configs`, aucune dépendance à `contract_type`/`hourly_rate`) | S/payment-calculator.ts:501-509 | hors module -> 032 | config de paie (032) ; `people` n'expose que le contrat daté (kind, committed_hours) comme information | Tarifs/configs hors `people` |
| P-07 | Tarifs (ECUE x enseignant > ECUE générique > défaut ; académique par `course_id` SEUL = bug) | S/payment-calculator.ts:615-658 ; S/professional-ecue-rates.service.ts:265-380 | hors module -> 032 | tarification (032) ; clé = (nœud/offre, `staff_id`) | Bug « tarif nominatif appliqué à tous les enseignants du cours » à corriger en 032 |
| P-08 | Vue d'ensemble paie : nom, email, `employee_number` (matricule), `status`, `contract_type`, config, séances Pro, bulletin ; heures académiques absentes | S/teacher-payroll-overview.service.ts:40-187 | hors module -> 032 | 032 lit `getStaffByIds` : `staffNumber`, `displayName`, `email`, `status`, contrat actif (kind) ; heures via 017 (académique ET Pro) | Vue unifiée (corrige §5.3-26) |
| P-09 | Bulletin PDF : matricule, noms, email ; contrôle « le bulletin appartient à l'utilisateur » via `teachers.user_id` | S/teacher-payslip.service.ts:55-68,111-115 | hors module -> 032 | 032 + 024 documents ; propriétaire résolu par `resolveStaffForIdentity` (jeton) | Identité du jeton |
| P-10 | Jointures `teachers t` (nom/email) dans listes, rapports, configs ; existence du teacher avant création de config | R/teacher-payments.ts:170,298 ; R/payment-reports.ts:262,429,741,944,1084,1110 ; R/teacher-payment-configs.ts:143,261,554 ; S/owner-payroll-mass.service.ts:242,351,390,437,513 | hors module -> 032 | résolution des noms par `getStaffByIds` (aucune jointure inter-schéma) ; existence vérifiée par la même API | Isolation des schémas |
| P-11 | Lacunes d'affectation : `class_courses` sans `teacher_assignments` active | S/owner-payroll-mass.service.ts:463-495 ; S/owner-staff.service.ts:69-79 | amélioré | `OfferingReadinessGuard` (`createOfferingReadinessGuard`) bloque l'ouverture d'une offre sans LEAD ; liste « nœuds sans titulaire » = academic `listNodesForClassroom` x `listAssignmentsForClassroom` (rapport à compléter, §7-E9) | La lacune devient un blocage préventif plus un rapport |
| P-12 | Jointures héritées mortes `payment_hour_details.teaching_hours_id -> teaching_hours -> course_assignments` (toujours NULL) | R/payment-reports.ts:280-281,537-538,775-776 | abandonné | aucune | Tables abandonnées (TB-36/37) |
| P-13 | Montants provisoires (taux de la config couvrant la date de tous les `teachers` partageant le `user_id`, sinon `teachers.hourly_rate`) | R/teacher-attendance.ts:324-349 | abandonné | estimation éventuelle = 032 (même calculateur que la paie) | Montants affichés ≠ payés ; code défensif multi-fiches |

### 2.H Lectures « propriétaire » sur le personnel (`requireOwner`)

| ID | Fonction | Fichier:ligne | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| T-130 | Personnel enseignant (statut, heures `teaching_hours` totales/validées via jointure ERRONÉE, `class_courses` sans titulaire, bulletins non approuvés, nb formateurs) | R/owner/index.ts:1250 ; S/owner-staff.service.ts:22-155 | hors module -> 025 | tableau de bord 025 alimenté par `listStaff`, `getTeachingLoad`, `listAssignmentsForClassroom` et heures 017 (`getStaffWeeklyLoad`, `listPayableHours`) ; formateurs Imhotep supprimés | Jointure `th.assignment_id -> teacher_assignments.id` fausse (§5.2-22) non reproduite |
| T-131 | Personnes (démographie : enseignants actifs par contrat, ancienneté, nb ECUE/filières, sans compte, sans affectation) | R/owner/index.ts:882,1112 ; S/owner-personnes.service.ts:168-195,333-387,496-530 | hors module -> 025 | rapports 025 sur `listStaff` (catégorie, contrat actif, `hired_on`, `identity_id` null = sans compte) et affectations | LIMIT 200/100 codés en dur remplacés par pagination standard |
| T-132 | Charge enseignante hebdo (créneaux `professional_emploi_temps`) / ECUE obligatoires sans enseignant | S/owner-assiduite.service.ts:330-360,407-439 | hors module -> 025 | charge : `getStaffWeeklyLoad` (017) + `getTeachingLoad` (people) ; nœuds sans titulaire : voir P-11/§7-E9 | Charge dérivée des occurrences réelles |
| T-133 | Masse salariale / lacunes (`class_courses` orphelins, enseignants avec/sans config) ; validation de masse | R/owner/index.ts:1213,1410 ; S/owner-payroll-mass.service.ts:463-495,513 | hors module -> 032 | paie (032) + rapport de lacunes (025) | Paie |

### 2.I Seeds / scripts

| ID | Fonction | Fichier:ligne | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| — | `assign-teacher-to-mds.js`, `get-teacher-assignments.js`, `seed-remuneration-professionnelle.js`, `verify-remuneration-031.js` (25 invariants), `resoudre-doublons-bulletins.js` | `legacy-teachers.md` §2.J | abandonné | seeds de pack (`tenancy/templates`) et tests d'intégration 009/032 ; import = 031-imports | Scripts ponctuels liés au tenant Imhotep ; non comptés dans les IDs |

### 2.J Fonctions du legacy dont la v2 change le propriétaire (rappel des principes)

- Déclaration/validation des heures, constat de réalisation, durée payée, séance comptable, séances manquantes, chevauchements : **017 scheduling** (agrégat `session_occurrences`, `occurrence_staff`).
- Appel des étudiants : **010 attendance** ; présence/congés du personnel : **010** (`staff_records`, `staff_leaves`).
- Tarifs, taux, configs de paie, heures supplémentaires, bulletins, collecteurs d'heures : **032 payroll-port** (et jamais `people`).

### 2.K Fonctions v2 sans équivalent legacy (non-parité)

| ID | Fonction v2 | Source | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| N-01 | Personnel administratif et d'appui (catégories `staff_categories` : enseignant, éducateur, administratif, direction, appui ; `can_teach`/`can_supervise`) | brief 009 ; DDL 0800 | nouveau | `staff_categories`, `createStaff` ; routes `/reference/staff-categories` ; permissions `staff.*` | Absent du legacy (§4) : un non-enseignant n'était qu'un `users` + rôle |
| N-02 | Contrats datés et types de contrat en données ; charge contractuelle `committed_hours` | DDL 0802 | nouveau | `staff_contracts`, `contract_types` ; `addContract/updateContract/endContract` ; événements `people.staff_contract.created/ended` | Pas d'historique ni de charge en legacy |
| N-03 | Qualifications avec expiration + job d'alerte ; compétences d'enseignement | DDL 0802, 0804 | nouveau | `staff_qualifications`, `people.expiring_qualifications`, `listExpiringQualifications`, `setCompetencies` ; événement `people.staff_qualification.expiring` (-> 016/025) | Texte libre en legacy |
| N-04 | Affiliations établissement/campus ; historique de statut ; numérotation du personnel | DDL 0800, 0802 | nouveau | `staff_affiliations`, `setAffiliations`, `staff_status_history`, `people.next_number('STAFF')` | Multi-établissements et audit des changements de statut |
| N-05 | Titulaire de classe (HOMEROOM), généraliste (`covers_all_subjects`), SUBSTITUTE/SUPERVISOR, `planned_hours`, `source` (MANUAL/IMPORT/TIMETABLE/ROLLOVER) | DDL 0803 | nouveau | `teaching_assignments` ; `getTeachingLoad` | HOMEROOM absent du legacy (primaire, spec 005) ; rôles élargis |
| N-06 | Disponibilités hebdomadaires (AVAILABLE/UNAVAILABLE, validité) | DDL 0802 | nouveau | `staff_availabilities`, `setAvailabilities`, `listAvailabilities` consommées par 017 (avertissements) | Seul précédent : `formateur_indisponibilites` (supprimé, TB-53) |
| N-07 | Auto-service enseignant limité | brief 009 | nouveau | `GET /me/staff`, `GET /me/classes` (`staff.own.read`) ; mise à jour de contact limitée (permission à créer, §7-E17) | Remplace l'auto-modification dangereuse (T-008/T-062) |
| N-08 | Provisionnement de compte par invitation | brief 009 | nouveau | `provisionStaffAccount` (port `AccountProvisioner` -> iam) | Remplace T-002/T-005/T-006 |

---

## 3. Données que `people` doit exposer (et comment chaque besoin legacy est servi)

Les consommateurs n'accèdent JAMAIS aux tables `people.*` (aucune FK ni jointure inter-schéma) : ils passent par l'API publique `apps/api/src/modules/people/index.ts` et par les événements.

### 3.1 API publique et champs

| Fonction publique (index.ts) | Champs / contenu |
|---|---|
| `getStaffByIds(ids[])`, `getStaff(id)` | `id`, `staffNumber`, `displayName` (nom d'usage unique issu de `persons`), `lastName`, `firstName`, `email`, `phone`, `categoryCode`, `canTeach`, `canSupervise`, `status` (ACTIVE/ON_LEAVE/SUSPENDED/LEFT), `hiredOn`, `leftOn`, `identityId` (nullable), contrat actif (`contractTypeCode`, `kind`, `startsOn`, `endsOn`, `committedHours`, `unit`) ; contrats/qualifications détaillés sous permission `staff.contract.manage` / `staff.qualification.manage` |
| `listStaff({ids, status, categoryCode, canTeach, q, institutionId})` | liste paginée ; filtrable par ids (période ciblée) et par tenant (RLS) ; vue « tous, configurés ou non » |
| `resolveStaffForIdentity(identityId)` | `staffId` du jeton (0..1 par identité, UNIQUE) ; 404 explicite sinon |
| `listAssignmentsForClassroom(classroomId, {asOf, periodId})`, `listAssignmentsForStaff(staffId, {academicYearId, asOf, classroomId})` | `id`, `staffId`, `academicYearId`, `classroomId`, `curriculumNodeId`, `periodId`, `roleCode`, `coversAllSubjects`, `plannedHours`, `startsOn`, `endsOn`, `status`, `source` |
| `getTeachingLoad(staffId, academicYearId)` | charge prévue (somme des `planned_hours` ACTIVE) vs `committed_hours` du contrat ; heures réelles par appel à l'API de 017 (pas de lecture de `scheduling.*`) |
| `listAvailabilities(staffId, {from,to})`, compétences via `getStaff` | disponibilités (UNAVAILABLE l'emporte) et `staff_competencies` pour les avertissements de planification |
| `createOfferingReadinessGuard()` | implémente `OfferingReadinessGuard` (port academic) : une offre ne démarre pas sans LEAD sur ses nœuds enseignables (hors transversaux) |
| Événements | `people.staff.created/updated/status_changed`, `people.staff_contract.created/ended`, `people.staff_qualification.expiring`, `people.teaching_assignment.created/ended/replaced` |

### 3.2 Paie (032) — reprise de l'interface P-01..P-13

| Besoin legacy (renvoi) | Fourniture v2 |
|---|---|
| Identité et nom unique (cf. P-01, P-08, P-09, P-10) | `getStaffByIds` : `displayName`, `email`, `staffNumber` (matricule du bulletin), `status`, contrat actif (kind). Plus de double source `users`/`teachers` |
| Statut « payable » (cf. P-01) | `status` + historique daté ; règle d'éligibilité (ACTIVE seulement ? ON_LEAVE ?) = 032 ; `people` ne filtre pas en silence |
| Heures à payer, bénéficiaire, durée, verrou (cf. P-03, P-04, P-05) | `scheduling.listPayableHours` (SQL `payable_hours`) : bénéficiaire = `occurrence_staff.staff_id` ; la paie ne lit JAMAIS `teaching_assignments` pour savoir qui payer ; `lockHours`/`releaseHoursLock` (permission `schedule.hours.lock`) |
| Périmètre de période, config, tarifs (cf. P-02, P-06, P-07) | 032 uniquement ; clés = `staff_id` UUID |
| Lacunes d'affectation (cf. P-11) | `listAssignmentsForClassroom` + `OfferingReadinessGuard` |
| Contrat | `kind` (PERMANENT/FIXED_TERM/CASUAL/OTHER) et `committed_hours` comme INFORMATION ; aucune valeur ne déclenche un montant ou un seuil dans `people` (heures supplémentaires = RuleSet/032) |
| Événements utiles | `people.staff.status_changed` (départ/suspension) ; `people.teaching_assignment.ended` ; côté scheduling : dé-validation refusée si `locked_at` |

### 3.3 Évaluations (assess, 011)

- Identité de l'enseignant auteur/responsable d'une évaluation : `staff_id` (UUID) ; affichage par `getStaffByIds`.
- Droit de saisir/corriger pour un (classe, nœud) : `listAssignmentsForStaff` (LEAD, CO_TEACHER, HOMEROOM avec `covers_all_subjects`) ; un remplaçant est reconnu par `occurrence_staff`/affectation SUBSTITUTE.
- Plus de CASCADE de la suppression d'un enseignant sur ses évaluations (impossible en v2).

### 3.4 Emploi du temps (017) et présence (010)

- Pour `setOccurrenceStaff`/`substituteStaff`/timetable : existence, statut (ACTIVE/ON_LEAVE acceptés, SUSPENDED/LEFT à refuser côté 017), `canTeach`, disponibilités (`listAvailabilities`), compétences (avertissement) et affectations (titulaire attendu, pré-remplissage).
- `people.teaching_assignment.ended` -> 017 marque les occurrences futures `needs_replacement` ; `attendance.staff_leave.approved` -> 017 `replacement_needed`.
- `attendance.staff_records` / `staff_leaves` référencent `staff_id` ; le statut `ON_LEAVE` de `staff` (congé long) n'est pas posé automatiquement par 010 (§7-E15).
- Qualifications expirantes : `people.staff_qualification.expiring` -> 016 (notification) / 025 (tableau de bord).

---

## 4. Règles métier implicites et défauts

| # | Règle / défaut legacy | Traitement v2 |
|---|---|---|
| R-01 | Unicité d'affectation (classe x cours x enseignant) : aucune ; EXCLUDE gist déclarée mais absente (TB-33) | corrigée : `teaching_assignments_no_dup` (même personne/classe/rôle/nœud/période vivante) |
| R-02 | Chevauchement d'affectations AUTORISÉ (contrôle désactivé `teacher-assignments.ts:232,257,868,886`) | corrigée : 1 seul LEAD vivant par (classe, nœud, période) ; CO_TEACHER libre ; successifs = fin + remplacement (REPLACED) ou `period_id` distinct |
| R-03 | Pro : UN enseignant par (cohorte, ECUE), pas de co-enseignement (`UNIQUE(tenant,ue_session,ecue)`) | reproduite comme LEAD unique (`one_lead`) + CO_TEACHER libre pour le co-enseignement |
| R-04 | Pro : ECUE doit appartenir à l'UE de la cohorte (`ECUE_NOT_IN_UE`) | reproduite : vérifiée via academic (nœud sous le curriculum de la classe) dans `createTeachingAssignment` |
| R-05 | La Conduite n'a jamais d'enseignant (`CONDUITE_NO_TEACHER`, détection par libellé `ILIKE 'conduite%'`/code `%EC-CON%`) | corrigée : drapeau `is_transversal` du nœud (academic) ; contrôle dans le use case (aucune FK ni trigger ne peut le faire entre schémas) ; test d'intégration obligatoire (§7-E2) |
| R-06 | Vacataire => `courseAmount > 0` (Zod l.24-29) alors que le montant n'est jamais payé | abandonnée : aucun montant dans `people` |
| R-07 | Dates d'affectation bornées à l'année académique de la classe ; le contrôle « classe hors année active » ne se déclenchait jamais (`academic_year_id` non sélectionné) | corrigée : `academic_year_id` obligatoire, bornes vérifiées via `academic.getAcademicYear` |
| R-08 | `datefin >= datebut` | reproduite (`ends_on >= starts_on`, `ends_on` nullable) |
| R-09 | `teacher ∈ tenant` (T-020) | corrigée : RLS + FK composite `(tenant_id, staff_id)` |
| R-10 | Statut de l'enseignant non contrôlé à l'affectation/ECUE/saisie d'heures ; seule la paie filtre `active` (silencieusement) | corrigée : trigger `teaching_assignments_guard` (ACTIVE/ON_LEAVE + `can_teach`) ; contrôle à la saisie d'intervenant côté 017 ; éligibilité paie = 032 avec signalement |
| R-11 | Transitions de statut d'affectation libres (`paused`...) | corrigée : ACTIVE->ENDED/CANCELLED seulement ; réactivation interdite |
| R-12 | Transitions de statut du personnel libres | corrigée : `staff_guard` (ACTIVE<->ON_LEAVE<->SUSPENDED, *->LEFT, LEFT->ACTIVE = réembauche) + historique |
| R-13 | `teachers.user_id` non unique ; 1 user <-> N fiches toléré (code défensif) | corrigée : `persons.identity_id` UNIQUE, `staff.person_id` UNIQUE |
| R-14 | Email enseignant : `UNIQUE(tenant,email)` sensible à la casse ; normalisation `LOWER(TRIM)` seulement à la création ; refus inter-tenants | corrigée : `persons_email` indexé `lower(email)` ; l'unicité de l'email de connexion appartient à iam par tenant ; règle de doublon de fiche à trancher (§7-E12) |
| R-15 | Trois axes de contrat sans lien (`teachers.contract_type`, `teacher_assignments.contract_type`, `teacher_payment_configs.config_type`) | corrigée : contrat de travail = `staff_contracts` (people) ; régime de paie = 032 ; l'affectation ne porte aucun contrat |
| R-16 | Suppression physique d'un enseignant ou d'une affectation en cascade | corrigée : `staff_no_delete`, `teaching_assignments_no_delete`, `staff_contracts_no_delete` ; fin = statut |
| R-17 | Heures « validées » concurrentes (`hours_validated` x2, `teaching_hours`, séances `completed`) ; seule la dernière était payée | corrigée : un seul journal (occurrences HELD + validées), 017 |
| R-18 | Validation académique non tracée (`teacher_attendance_sessions` sans `validated_by/at`), pas de rejet ni de dé-validation, `rejected/cancelled` jamais posés | corrigée (017) : `validated_at/by` NOT NULL ensemble, `unvalidateOccurrence` motivé, journal `occurrence_changes` |
| R-19 | Heures entières, plafond 12 h par séance, créneau libre non contrôlé | corrigée : minutes, conflits enseignant imposés par la base (`resource_claims_no_overlap`) ; plafond de dérogation à définir (§7-E11) |
| R-20 | Saisie d'heures sans contrôle de l'affectation (`cancelled`/échue acceptée) | corrigée en partie : l'intervenant d'une occurrence n'est pas lié par la base à une affectation (SUBSTITUTE légitime) ; avertissement si aucune affectation ACTIVE (§7-E7) |
| R-21 | Remplacement implicite (changer `enseignant_id`, sans motif ni titulaire remplacé) | corrigée : `occurrence_staff` role SUBSTITUTE + `replaces_staff_id` obligatoire ; journal des changements |
| R-22 | Intervenant réel (et non titulaire) rémunéré — Pro uniquement ; Classique payait `ta.teacher_id` (affectation) | corrigée : intervenant réel pour tous (`payable_hours`) |
| R-23 | Auto-modification de la rémunération par l'enseignant (T-008, T-062) | corrigée : aucune écriture enseignant sur contrat/statut/affectation ; `/me/staff` limité au contact |
| R-24 | Identité par `X-User-Id` falsifiable (teacher-assignments:296,693,1096,1289 ; teacher-attendance:205,479,892,1003 ; teacher-courses:55-56 ; teacher-students:81,210) | corrigée : jeton uniquement ; `resolveStaffForIdentity` |
| R-25 | Accès portail aux élèves/classes après fin ou annulation de l'affectation (§5.3-29) | corrigée : affectation ACTIVE à la date (T-010, T-064) |
| R-26 | `GET /teacher-assignments?showAll=true` contourne le filtre | corrigée : paramètre supprimé |
| R-27 | `employee_number` libre, non unique, jamais généré | corrigée : `staff_number` généré, unique, immuable |
| R-28 | Noms dupliqués users/teachers non synchronisés ; email de fiche non propagé au compte | corrigée : nom = `persons` ; email de connexion = iam |
| R-29 | Rôle `teacher` attribuable sans fiche ; fiche sans compte supportée | reproduite pour le second cas (`identity_id` NULL) ; premier cas corrigé (404 explicite, T-013) |
| R-30 | Comptes de test auto-créés (`validator-<ts>@example.com` / `testpassword123`) dans 7 fichiers (`teaching-hours.ts:135`, `teaching-hours-batch.ts:36`, `payment-periods.ts:370`, `simple-payment-periods.ts:72`, `teacher-payment-configs.ts:597`, `teacher-payments.ts:631`, `tuition-schedules.ts:319`) ; validateur UUID codé en dur (`teacher-assignments.ts:947`, `course-assignments.ts:141`, `teacher-payments.ts:1451`) | corrigée : abandonnées (aucun compte créé hors `provisionStaffAccount`) ; acteur = jeton |
| R-31 | Volume prévu : `hoursAssigned = (datefin-datebut)*2` ou 40 ; `courses.hours_total` | corrigée : `planned_hours` explicite, `NULL` si inconnu |
| R-32 | Audit d'affectation jamais lu, `changed_by` NULL | corrigée : `teaching_assignment_history` avec `actor_id` et `reason` |
| R-33 | Co-enseignement : de fait en Classique (plusieurs affectations par cours, sans règle), interdit en Pro | reproduite explicitement : CO_TEACHER libre, un seul LEAD |
| R-34 | Statut d'un cours dérivé des dates (`pending/active/completed`, T-060) ignorant `teacher_assignments.status` | corrigée : statut stocké (ACTIVE/ENDED/CANCELLED) ; état temporel dérivé affiché séparément |
| R-35 | Transactions laissées ouvertes (`teachers.ts:965,985`) ; ROLLBACK sur nouvelle connexion | corrigée : use cases transactionnels (RLS par transaction) |
| R-36 | Ordre de routes critique (`/credentials-template`, `/me/classes` avant `/:id`) | corrigée : routes statiques définies avant paramétriques et couvertes par test de routage |
| R-37 | Résolution de « l'enseignant courant » par liste paginée (limit 20) | corrigée : `GET /me/staff` direct |
| R-38 | Remplissage automatique du compte à la modification (auto-rattrapage T-008) | abandonnée : `provisionStaffAccount` explicite |

---

## 5. Constantes codées en dur -> destination

| Constante legacy | Fichier:ligne | Destination v2 |
|---|---|---|
| Grille `DEFAULT_WEEKLY_SLOTS` (lun-ven 08-10 / 10-12), durée 120 min, salle `"TBD"`, `weekCount<80`, durée mini 2 h | R/teacher-assignments.ts:50-61,566,572,622 | abandonnées ; `scheduling.time_slots` (données du tenant) et salle = clé `rooms` (017) |
| Validateur UUID `634a57fe-2007-4ecb-ae5b-f9e3152a24fb` | R/teacher-assignments.ts:947 ; R/course-assignments.ts:141 ; R/teacher-payments.ts:1451 | abandonné (acteur = jeton) |
| `hoursAssigned` : x2 h/jour, défaut 40, semestre 1 | R/teacher-assignments.ts:981-982 ; R/course-assignments.ts:68-74,177-181 | abandonnés ; `teaching_assignments.planned_hours` explicite |
| Mot de passe temporaire (12 car., alphabet, `Math.random`), bcrypt 10/12, min 8 | R/teachers.ts:28-44,381,644,734 | abandonnés ; politique de mot de passe/hachage = iam (002) |
| URL de connexion par défaut `https://ecoledigitale.engage-360.net/login`, rôle `teacher`/« Enseignant » | R/teachers.ts:21-26,372-376 | tenancy (URL du tenant) et rôles système RBAC (`rbac/templates/system-roles.ts`) |
| Regex `HH:MM[-HH:MM]`, `durationHours` 1..12, 7 créneaux historiques, `time_slot VARCHAR(20)` | R/teacher-attendance.ts:50,441-443 ; M/0043:29 | abandonnés ; `starts_at/ends_at` horodatés + minutes (017) |
| Heures supplémentaires : seuil 40 h/sem, multiplicateur 1,5 ; devise `XOF` | `teacher_payment_configs` (défauts) | RuleSet (012) / 032 ; devise = finance (jamais `people`) |
| Pivot d'année scolaire = septembre | S/professional-seance-validation.service.ts:96-105 | `academic.academic_years` (données) |
| Détection de la Conduite par libellé/code | S/professional-ue.service.ts:1055,1088 | `curriculum_nodes.is_transversal` (academic) |
| `LIMIT` 200/100/50/30 (owner), validation en lot ≤ 500, `duree_payee` ≤ 24 h | S/owner-*.service.ts ; S/professional-seance-validation | pagination standard ; plafonds de lot/dérogation = paramètres/politique 017 (§7-E11) |
| Mot de passe de test `testpassword123`, e-mails `validator-<ts>@example.com` | 7 fichiers (R-30) | abandonnés |
| `session_type` forcé `theory` | R/teacher-attendance.ts (T-050) | `session_occurrences.kind` (LESSON/EXAM/MEETING/…) |
| Tenant Imhotep en dur dans le seed | M/0005 (INSERT l.238+) | abandonné ; seeds de pack |
| Délai d'alerte d'expiration des qualifications | nouveau | `people.settings.expiry_alert_days` (défaut 60, 1..365) |
| Motif de numérotation du personnel | nouveau | `people.settings.staff_number_pattern` (défaut `P{SEQ:4}`) |
| Types de contrat, catégories de personnel | `enum contract_type` (legacy) | données de pack `tenancy/templates` -> `contract_types`, `staff_categories` |
| Statuts du personnel/affectation, rôles d'affectation | enums legacy | états de domaine (CHECK + machine à états), non réglementaires donc conservés en code |

---

## 6. Synthèse chiffrée par statut

Comptage automatique des lignes des tableaux §1 (TB-xx) et §2 (T-xxx, P-xx ; hors lignes `—` des scripts, hors N-xx « nouveau »).

| Périmètre | conservé | amélioré | abandonné | hors module | total |
|---|---|---|---|---|---|
| §1 Tables/colonnes (TB-xx) | 2 | 25 | 13 | 15 | 55 (+ 1 nouveau) |
| §2 Fonctions legacy (T-xxx, P-xx) | 0 | 19 | 18 | 62 | 99 |
| **Total parité** | **2** | **44** | **31** | **77** | **154** |
| Part du total | 1 % | 29 % | 20 % | 50 % | 100 % |

Fonctions nouvelles sans équivalent legacy (§2.K, N-xx, non comptées) : 8.

Répartition des lignes « hors module » (§1 + §2) par spec porteuse : 002 : 8 ; 004 : 5 ; 010 : 7 ; 011 : 5 ; 016 : 1 ; 017 : 34 ; 025 : 3 ; 032 : 13 ; 033 : 1.

Lignes de parité (§1 + §2) : 155 lignes de tableau (+ 1 ligne « seeds/scripts » §2.I sans ID, abandonnée, + 8 lignes N-xx), dont 154 comptées (hors 1 ligne « nouveau » de §1) ; IDs d'inventaire couverts : 99/99 (T-001..T-133 : 86 ; P-01..P-13 : 13).

---

## 7. Points à trancher (écarts entre le brief cible et le legacy)

- **E1 — Rôles d'affectation.** Brief : LEAD / CO_TEACHER / HOMEROOM ; DDL 0803 : aussi SUBSTITUTE et SUPERVISOR (et `occurrence_staff` impose `replaces_staff_id` pour SUBSTITUTE). Définir ce qu'est une affectation SUBSTITUTE (suppléance longue durée ?) par rapport à l'intervenant SUBSTITUTE d'une occurrence.
- **E2 — Conduite sans enseignant.** Le brief dit « jamais d'enseignant » ; la base ne peut pas l'imposer (cross-schéma : `is_transversal` est dans academic). Règle à porter par `createTeachingAssignment` + test ; préciser le cas d'un généraliste `covers_all_subjects` (couvre-t-il les nœuds transversaux ?).
- **E3 — Statuts du personnel.** Legacy `active|inactive|suspended` vs v2 `ACTIVE|ON_LEAVE|SUSPENDED|LEFT`. `inactive` -> `LEFT` impose `left_on` (inconnu en legacy). La paie legacy ne paie que `active` ; en v2 la paie lit `occurrence_staff`, donc un `SUSPENDED/LEFT` aurait des heures encore payables si 032 ne filtre pas ; `occurrence_staff` n'a pas de garde sur le statut (cross-schéma) : 017 doit refuser SUSPENDED/LEFT. Qui tranche l'éligibilité (032) et à quelle date de statut ?
- **E4 — Mapping des affectations classiques.** `class_courses` (classe x cours) -> (classroom, nœud) dépend de l'import des cours en nœuds (004/019/031). `contract_type` (salarie/vacataire) et `course_amount` n'ont aucune cible ; `paused` n'a pas d'équivalent (-> ENDED proposé).
- **E5 — Unicité du LEAD sans dates.** `one_lead` est fondé sur le statut, pas sur les dates : le legacy autorisait des affectations successives/chevauchantes (contrôle désactivé) ; l'import produira des doublons à résoudre (extras -> CO_TEACHER ou périodes distinctes).
- **E6 — Cohorte Pro et offre.** L'affectation porte `classroom_id` + nœud, pas `offering_id` : deux offres d'une même UE dans la même classe (cohortes successives) partageraient un LEAD, alors que le legacy donnait un enseignant par cohorte (`ue_session`). Utiliser `period_id` ou une classe par cohorte.
- **E7 — Auto-déclaration de séances.** Le legacy permet à l'enseignant de déclarer/créer/supprimer ses séances (T-051, T-098, T-100) ; le brief 017 ne donne aucune permission d'auto-création d'occurrence AD_HOC par l'enseignant (`schedule.occurrence.hold`, `schedule.own.read`). À décider ; décider aussi si un intervenant sans affectation ACTIVE (hors SUBSTITUTE) déclenche un avertissement.
- **E8 — Accès enseignant aux élèves.** Legacy : « voir les élèves des classes où j'ai une affectation ». Brief : pas de permission/scope explicite (roster = academic `classroom.read`). Définir le scope RBAC fondé sur `listAssignmentsForStaff` (002/004/011).
- **E9 — Rapport « nœuds sans titulaire ».** Utilisé par T-132/T-133/P-11 ; absent de la liste des use cases 009 (seul `OfferingReadinessGuard` bloque une offre). Ajouter `listUnstaffedNodes` ou le déléguer à 025.
- **E10 — Verrou vs « heure consommée ».** Le brief verrouille `occurrence_staff` seulement pour bulletin approuvé/payé ; le legacy excluait toute heure portée par un bulletin non annulé (calculated/disputed/unpaid inclus, `heures-consommees.ts:128-143`), nécessaire depuis 0112 (périodes chevauchantes). Risque de double paiement entre bulletins calculés : ledger côté 032.
- **E11 — Durées et plafonds.** Legacy `duree_payee` NUMERIC(5,2) heures ∈ (0,24], `duration_hours` entier 1..12 ; v2 `paid_minutes > 0` sans plafond et conversion décimal->minutes (arrondi) à définir.
- **E12 — Doublon de fiche et email.** Le brief détecte les doublons pour les élèves seulement ; le legacy refusait un email d'enseignant déjà pris (409). `persons.email` n'est pas unique : fixer la règle de détection de doublon du personnel.
- **E13 — Matricule.** `employee_number` legacy libre/non unique vs `staff_number` généré/immuable : stratégie d'import (conserver si unique, sinon générer + `external_ref`).
- **E14 — Taux et type de contrat.** `teachers.hourly_rate` et `contract_type` n'ont plus de support dans `people` hors `staff_contracts.kind` ; prévoir l'import vers 032.
- **E15 — Congés et statut ON_LEAVE.** Rien ne dit qui bascule `staff.status` en ON_LEAVE à l'approbation d'un congé (`attendance.staff_leaves`) ; proposition : jamais automatique (congé court = 010 seulement, congé long = changement de statut manuel).
- **E16 — Spécialités et bio en texte libre.** Pas de colonne `bio` ; `staff_competencies` exige un `subject_id` : les spécialités libres ne se rapprochent pas automatiquement (conservées dans `attributes`).
- **E17 — Permissions manquantes.** `staff.own.read` existe, mais aucune permission d'édition de son propre contact (`staff.own.update`) ni de lecture des contrats (`staff.contract.read`) distincte de `staff.contract.manage`.
- **E18 — Dépendance circulaire potentielle.** `getTeachingLoad` (people) voudrait les heures réelles de scheduling alors que scheduling lit déjà people (`getStaffByIds`) : n'exposer côté people que le prévu/contractuel et laisser 017 (`getStaffWeeklyLoad`) fournir le réel.
- **E19 — Titulaire de classe (HOMEROOM) et paie.** Notion absente du legacy ; sa rémunération éventuelle (prime de titulaire) relève de 032 et ne doit pas se déduire de l'affectation.

---

## 8. Suite donnée aux points à trancher

| ID | Suite donnée | Référence |
|---|---|---|
| E1 | Tranché : SUBSTITUTE = suppléance longue durée, liée par `replaces_assignment_id` à l'affectation remplacée ; l'intervenant SUBSTITUTE d'une occurrence reste un remplacement ponctuel (017). | DDL 0803, `replaceTeachingAssignment` |
| E2 | Tranché : `createTeachingAssignment` refuse un nœud transversal (vérification via academic) ; un généraliste ne couvre pas les nœuds transversaux. | spec 009 AC2.1, R5 |
| E3 | Tranché : statuts `ACTIVE/ON_LEAVE/SUSPENDED/LEFT` avec historique daté ; 017 refuse un intervenant SUSPENDED/LEFT ; l'éligibilité à la paie relève de 032 à la date de l'occurrence. | spec 009 AC1.3, DDL 0802 |
| E4 | Tranché : pas de reprise de données (D8) ; type de contrat porté par `staff_contracts.kind`, montant par 032 ; `paused` devient `ENDED`. | spec 009 |
| E5 | Tranché : un seul `LEAD` actif par (classe, nœud, période), imposé par index unique ; chevauchement de dates interdit. | spec 009 AC2.2, AC2.6 |
| E6 | Tranché : l'unicité inclut la période ; pour deux cohortes d'une même UE dans une même classe, une classe par cohorte ou une période distincte. | spec 009 AC2.2 |
| E7 | Tranché : permission `schedule.occurrence.declare` (017) pour la déclaration de séances ponctuelles par l'enseignant ; avertissement hors affectation. | spec 017, O-23 |
| E8 | Tranché : `isStaffAssignedToClassroom` et `listAssignmentsForStaff` fondent le scope RBAC de l'enseignant. | spec 009 interfaces |
| E9 | Tranché : `listUnstaffedNodes` ajouté. | spec 009 |
| E10 | Tranché : verrou exclusif `lockHours` dès l'inclusion dans un bulletin non annulé. | D-15, spec 017 |
| E11 | Tranché : `paid_minutes` entre 1 et 1440 ; arrondi à la minute à l'import. | DDL 1002 |
| E12 | Tranché : détection de doublons du personnel (clé de recherche normalisée) avec avertissement ; pas de fusion en v1. | D-30, O-07 |
| E13 | Tranché : `staff_number` généré et immuable ; l'ancien numéro peut être gardé dans `external_ref`. | D-19 |
| E14 | Tranché : taux et rémunération relèvent de 032 ; `people` ne conserve que le type de contrat. | spec 009 |
| E15 | Tranché : le congé n'a pas d'effet automatique sur le statut ; congé long = changement de statut manuel. | spec 009 |
| E16 | Tranché : la spécialité libre reste dans `attributes` ; les compétences exigent une matière du catalogue. | DDL 0802 |
| E17 | Tranché : `staff.own.update` ajoutée ; lecture des contrats distincte de leur gestion. | spec 009 |
| E18 | Tranché : `getTeachingLoad` ne renvoie que le prévu et le contractuel ; le réel vient de `scheduling.getStaffWeeklyLoad`. | spec 009 |
| E19 | Tranché : aucune prime déduite de l'affectation HOMEROOM ; relève de 032. | spec 009 |
