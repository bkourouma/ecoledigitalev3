# Parité legacy -> cœur académique v2 (spec 004-academic-core)

## 0. En-tête

**Objet.** Liste exhaustive des tables, fonctions, endpoints, règles métier et constantes du legacy qui relèvent du cœur académique (pile « classique » : cycles, programmes, classes, cours, années ; pile « Professional / Higher » : filière-classe, UE, ECUE, prérequis, cohortes, semestres, inscriptions à la carte, panier, porte d'entrée, cycle groups, année scolaire, matricule) avec, pour chacune, un statut de parité et sa cible dans le module `academic` v2. Ce fichier est le garde-fou de l'objectif 5 de `spec.md` (« Parité Higher/Professional ») : **tout est couvert ou explicitement écarté**. Il alimente aussi les golden tests de la tranche 2.0 (voir §3.1).

**Sources (inventaires et DDL).**

| Réf. | Fichier |
|---|---|
| INV-A | `scratchpad/legacy-academic.md` : tables T-01 à T-31, fonctions A-001 à A-217, constantes (§3), arbre pro (§4), anomalies (§5) |
| INV-P | `scratchpad/legacy-pro-enrollment.md` : tables (§1), fonctions P-001 à P-092 (§2), machines à états (§3), semestres / cycle groups / année scolaire (§5), codes d'erreur (§6), bugs et constantes (§7) |
| INV-S | `scratchpad/legacy-students.md` §2.6 : routes `student_enrollments` S-060 à S-066 (**référence croisée uniquement**, voir §2.10 ; le périmètre ID de ce fichier reste INV-A + INV-P) |
| BRIEF | `scratchpad/aca-brief.md` (noms de tables, cas d'usage, routes, événements, permissions : AUTORITAIRES) |
| DDL | `scratchpad/aca-src/academic/0700..0704` (identique à `data-model.md` §5) |
| SPEC | `specs/v2/004-academic-core/spec.md` et `data-model.md` (règles R1-R28, AC1.1-AC8.2) |
| Docs | `docs/PLAN_Mise_en_oeuvre_EcoleDigitale_SaaS.md` §3.7 et §4 Phase 2 (tranches 2.0-2.2, D8 « aucune donnée de prod à préserver ») ; `docs/module-professionnel-overview.md` (modèle 028, obsolète depuis MIG 0069) ; `docs/PRD-restructuration-pedagogique-filiere-ue-ecue.md` |

**Abréviations de chemins.** `MIG` = `infra/scripts/migrations` ; `PR` = `apps/api/prisma/migrations` ; `RT` = `apps/api/src/routes` ; `SVC` = `apps/api/src/services` ; `CT` = `packages/contracts/src` (legacy) ; `SE` = `SVC/professional-enrollment.service.ts` ; `SU` = `SVC/professional-ue.service.ts` ; `SS` = `SVC/professional-semestre.service.ts` ; `SP` = `SVC/professional-planning.service.ts` ; `SC` = `SVC/professional-catalog.service.ts` ; `GATE` = `SVC/professional-inscription-gate.ts` ; `GUARD` = `SVC/professional-cloture-guard.ts` ; `CG` = `SVC/professional-cycle-groups.ts` ; `PAY` = `SVC/professional-payment.service.ts` ; `RTP` = `RT/professional.ts`. Les références `fichier:ligne` sont reprises des inventaires ; elles ont été vérifiées par échantillonnage sur le worktree (par exemple `SU:35` table des transitions de cohorte, `SS:552` libellé `« {nom} — {code UE} »`, `GATE:57` tolérance 0,5, `CG:28` regex de grade, `GUARD:27` garde de clôture, `professional-annee-scolaire.ts:11` pivot) ; les lignes de routes dans `RTP` peuvent différer de ±1 selon que l'inventaire cite le décorateur ou le handler.

**Légende des statuts.**

| Statut | Sens |
|---|---|
| **conservé** | Règle reproduite à l'identique (même comportement, même ordre, mêmes bornes). |
| **amélioré** | Règle ou fonction reproduite avec une correction ou un enrichissement, nommé dans la justification (bug corrigé, contrainte DB, audit, configurable, historique, etc.). |
| **abandonné** | Non reproduite, avec justification (dead code, hors produit, insécurité, doublon, structure par chaîne de caractères, suppression physique remplacée par un état, etc.). |
| **hors module -> NNN** | Relève d'un autre module/spec : 007 admissions, 008/009 people, 010 attendance, 011 évaluations-notes, 012 rules-engine, 013 bulletins, 014/015 finance et paiements, 016 communications, 017 scheduling, 019 higher-education, 022 LMS, 024 documents, 025 analytics, 031 imports, 032 payroll-port. |

**Comment lire.** §1 : tables (état final reconstitué du legacy) -> tables v2. §2 : un tableau par famille de fonctions ; la colonne « ID legacy » contient un ou plusieurs IDs (`A-xxx` = INV-A, `P-xxx` = INV-P) ; lorsqu'une même fonction est décrite dans les deux inventaires (par exemple `A-130 ; P-001`), les deux IDs sont dans la même ligne. Un script de contrôle (voir §5) vérifie que chaque ID de INV-A et INV-P apparaît **exactement une fois** dans §2. §3 : règles implicites, bugs et la manière dont la cible les évite. §4 : constantes codées en dur et leur destination. §5 : synthèse chiffrée. §6 : écarts brief / legacy / DDL / spec que le concepteur doit trancher (identifiants `Q-01` et suivants, repris par `open-questions.md`).

**Vocabulaire à ne pas reproduire (INV-A §0.3, INV-P §0).** Depuis MIG 0116 : la table `programmes` porte la **classe** (« MASTER 2 AUDIT ET CONTROLE DE GESTION »), la table `filieres` porte la **filière** (« AUDIT ET CONTROLE DE GESTION ») ; les tables `professional_*` nomment pourtant `filiere_id` une FK vers `programmes` (la classe). Transposition v2 utilisée dans tout ce document :

| Legacy | v2 |
|---|---|
| `cycles` (Licence, Master, BTS, BBA…) | `education_levels` (cycle d'enseignement, donnée de pack) |
| niveau (L1, M2, BTS2) : jamais modélisé, encodé dans le **nom** de la classe | `grade_levels` (avec `next_grade_level_id`, `is_final`) + `program_grade_levels` |
| `filieres` (le domaine d'étude) | `programs` (filière / série / parcours ; parent -> spécialité) |
| `programmes` (= CLASSE pro, ex. « MASTER 2 ACG ») | (programme, niveau) + `curriculum_versions` (structure par année) + `classrooms` (instance de l'année) |
| `classes` (programme x année, mode scolaire) | `classrooms` |
| `courses` (matières du mode scolaire) | `subjects` (catalogue) + `curriculum_nodes` de type `SUBJECT` |
| `professional_ue` / `professional_ecue` | `curriculum_nodes` de type `UE` / `ECUE` ; ECUE réutilisable = `subjects` référencé par plusieurs nœuds |
| `professional_semestres` (+ `semestre_ue`) | `curriculum_nodes` de type `PERIOD` (`period_type_code` + `period_ordinal`) + `academic_periods` (dates, états) |
| cohorte / « session d'UE » / « ouverture » | `classroom_offerings` (classe x nœud) |
| « nom de classe » (préfixe du libellé de cohorte) + `professional_classe_noms` | `classrooms.name` (colonne, unique par année, programme, niveau) |
| lot (étudiant x classe) / `professional_enrollments` (étudiant x cohorte) | `enrollments` (`mode = A_LA_CARTE`) / `enrollment_courses` (`source = A_LA_CARTE`) |
| `student_enrollments` (élève x année x classe) | `enrollments` (`mode = CLASS`) |
| matricule `IPAM-<CODE>-<NNNN>` | `enrollments.registration_number` (motif configurable de `institution_settings`) |
| année scolaire = f(`date_debut` de la 1re cohorte), pivot 1er septembre | `academic_years` (entité unique) ; l'année d'une classe est `classrooms.academic_year_id` |

**Reprise de données.** D8 du plan : aucune donnée de production à préserver ; les tables remplacées sont supprimées par tranche (2.1 et 2.2) et les environnements sont reconstruits par seeds issus des modèles de pack (`data-model.md` §10). Les statuts ci-dessous parlent donc de **parité fonctionnelle**, pas de migration de lignes ; les conversions de format utiles à un import futur (031) sont signalées dans la justification quand elles existent (par exemple « année déduite du pivot », « matricule existant »).

---

## 1. Tables legacy -> tables v2

Statut = traitement de la table (ou du concept qu'elle porte). Les migrations/lignes viennent d'INV-A §1 et INV-P §1.

### 1.1 Mode scolaire / structure académique (INV-A §1.1)

| Table legacy | Migration:ligne | Statut | Cible v2 | Justification |
|---|---|---|---|---|
| T-01 `cycles` | MIG/0002:15-28 ; seeds MIG/0005:236-243, 0006:17-33 | amélioré | `academic.education_levels` (`code`, `label`, `ordinal`, `pack`, `active`) | Le cycle d'enseignement devient une **donnée de pack** (PRESCHOOL, PRIMARY, LICENCE, MASTER, BTS…) instanciée par `instantiatePackReferenceData` ; les seeds avec UUID de tenant en dur (`6eb9c106-…`, slug `imhotepacademy`) disparaissent ; `type` (academic/professional/short/certification), `duration_months` et `certification_level` (« bac+2 » en texte libre) ne sont pas repris (jamais exploités par un calcul ; la durée = niveaux couverts par le programme, voir §6 Q-12) ; `status draft/active/archived` -> `active` booléen. |
| T-02 `programmes` (= CLASSE) | MIG/0002:31-48, 0082:11, 0116:36 ; PR:1329-1347 | amélioré (éclaté) | `academic.grade_levels` + `academic.programs` + `academic.program_grade_levels` + `academic.curriculum_versions` + `academic.classrooms` | La table mélangeait trois notions : le niveau (encodé dans `name` : « LICENCE 1 … », parsé par regex `CG:28`), la structure pédagogique (UE, semestres, prix) et la classe ouverte. Découpage : niveau = `grade_levels` ; structure = `curriculum_versions` (programme x année) ; instance = `classrooms`. `version '1.0'` + `UNIQUE (code, version)` -> `UNIQUE (program, année)` des versions ; `academic_year` varchar -> FK `academic_years` ; `ects_credits`, `objectives TEXT[]` (jamais lus) abandonnés ; `domaine` -> `programs.domain_code` ; `status draft/review/approved/active/archived` -> `curriculum_versions.status DRAFT/PUBLISHED/LOCKED/ARCHIVED` + `programs.status ACTIVE/ARCHIVED` ; `approved_by/at` -> `published_by/at` ; `filiere_id` -> `classrooms.program_id`. |
| T-03 `filieres` | MIG/0116:12-20 | amélioré | `academic.programs` (`kind_code`, `domain_code`, `parent_program_id`) | La filière devient le programme ; `domaine` n'a plus qu'**une** source (`programs.domain_code`, dupliqué dans `programmes` et `filieres` en legacy) ; unicité sur `code` (regex majuscules) par établissement : la divergence DB sensible à la casse / API `LOWER(name)` disparaît ; reprise « filière = nom amputé du préfixe cycle » (MIG/0116:43-63) abandonnée (D8) ; série > spécialité sur 2 niveaux (nouveau). |
| T-04 `courses` | MIG/0002:65-83 -> 0022:21-39, 0023:7-8 ; PR:600-625 ; 0047:2-7, 0054:2-4 | amélioré | `academic.subjects` + `academic.curriculum_nodes` (`SUBJECT`) | Le cours est scindé : identité réutilisable (`subjects`) et rattachement (nœud avec `coefficient`, `is_mandatory`, `hours_*`, `category_code`). `coef` `NUMERIC(8,2)` -> `coefficient numeric(7,3)` (décimal exact, chaîne dans les DTO) ; `cm/td/tp/vhh` (CHAÎNES) -> `hours_total/lecture/practical` numériques (le TD n'a plus de colonne propre : Q-11) ; `bilan_type_id NOT NULL` abandonné (rubrique de bulletin -> 013, `category_code` optionnel) ; `prerequisites TEXT[]` (texte libre) -> `curriculum_prerequisites` typé ; `delivery_mode`, `evaluation_methods`, `resources` : hors cœur (011/022) ; unicité (programme, code) qui n'existait qu'en API -> index `curriculum_nodes_sibling_code` + `UNIQUE (tenant, code)` du catalogue. |
| T-05 `academic_years` | MIG/0005:34-46, 0050:4-9, 0118:44-69 ; PR:184-195 | amélioré | `academic.academic_years` | `EXCLUDE` d'une année active par tenant -> index unique partiel `academic_years_one_current` **par établissement** ; règle « sans trou / sans chevauchement » qui n'était qu'une migration de données (0118) -> `EXCLUDE ... daterange` + vérification de `createAcademicYear` + `find_year_gaps()` ; dates `NOT NULL` + `CHECK (ends_on > starts_on)` (elles étaient NULLables depuis 0050) ; `status DRAFT/OPEN/CLOSED/ARCHIVED` (cycle de vie qui n'existait pas). |
| T-06 `academic_year_periods` | MIG/0048:4-15 | amélioré | `academic.academic_periods` + `academic.period_types` | Le type (semestre/trimestre) n'était pas stocké (déduit du nom « SEMESTRE 2 », `semester-averages.ts:1105-1112`) : `period_type_code` + `ordinal` ; `sort_order` sans contrainte -> `ordinal` unique par parent et type ; ajout de l'inclusion dans l'année et le parent (trigger), du non-chevauchement des sœurs (`EXCLUDE`), de l'arbre (semestre > session) et des états `PLANNED/OPEN/GRADING_CLOSED/CLOSED`. |
| T-07 `classes` | MIG/0005:49-62, 0015:3-4 ; PR:431-444 | amélioré | `academic.classrooms` | `max_students DEFAULT 30` -> `capacity` nullable + `capacity_is_hard` ; `UNIQUE (code, année)` + aucune unicité de nom -> `UNIQUE (année, programme, niveau, code)` **et** `UNIQUE (…, name)` ; code généré avec entier aléatoire (`classes.ts:39-50`) -> code explicite (regex) ; `classroom_id` (salle principale) -> hors cœur (la salle est une ressource de `scheduling`) ; ajout `grade_level_id`, `curriculum_version_id`, `kind CLASS/COHORT`, `status`, dates, établissement, campus. |
| T-08 `class_courses` | MIG/0005:83-91 ; PR:419-428 | abandonné | `classrooms.curriculum_version_id` + `curriculum_nodes.is_mandatory` + `enrollment_courses.source = OPTION` | Table « facultative de fait » (les moyennes l'ignoraient, `semester-averages.ts:87-120` ; repli silencieux `classes.ts:636-654`) : la liste des matières d'une classe est le **curriculum** de sa version ; `is_required` -> `is_mandatory` ; une matière à option -> sélection `OPTION`. |
| T-09 `classrooms` (salles) | MIG/0009:36-53 ; PR:466-483 | hors module -> 017 | `scheduling.rooms`, `room_types` | Le mot « classroom » change de sens : en v2 `academic.classrooms` est la classe, la salle est `scheduling.rooms`. |
| T-10 `classroom_reservations` | MIG/0009:56-71, 103-109 | hors module -> 017 | `scheduling.resource_claims` (`resource_claims_no_overlap`), `session_occurrences` | Conflit de salle imposé par exclusion DEFERRABLE ; les séances pro ne passaient pas par cette table (aucun contrôle côté pro). |
| T-11 `academic_calendar_events` | MIG/0032:20-32 ; PR:153-166 | hors module -> 017 | `scheduling.calendar_events`, `calendar_event_kinds` | Les types `semester_start/semester_end` sont redondants avec `academic_periods` (événements `academic.period.opened`) ; `semester INT 1..8` sans FK abandonné. |
| T-12 `cycles_frais` | MIG/0014:5-17, 0121:17-71 ; PR:645-658 | hors module -> 014 | barèmes de frais finance (dimensions programme/niveau/nœud) | `cycle_id` redondant avec `programme_id` supprimé par construction (le niveau porte le cycle) ; academic fournit `listNodesForClassroom` pour la « scolarité calculée » (A-102) et publie `academic.enrollment.created` (spec 004 §7.4). |
| T-13 `student_period_course_averages` | MIG/0049:3-14 ; PR:1619 | hors module -> 011 / 013 | `assess` (résultats de période, calculés) | Les moyennes ne sont plus saisies (plan §3.7). La clé legacy ne contenait pas `class_id` (un changement de classe réécrivait la ligne) : en v2 les résultats portent `enrollment_id`, stable (`enrollment_placements`). |
| T-14 `student_period_attendance_summaries` | PR/20260408123000:3-15 | hors module -> 010 | `attendance.period_summaries` (dérivé + `summary_overrides`) | Piste Prisma seulement ; saisie libre abandonnée au profit du dérivé tracé. |
| T-15 `bilan_types` | PR/20260403120000_add_bilan_types:2-11 | hors module -> 013 | rubriques de bulletin (gabarit) ; structure : `curriculum_nodes.category_code` | Rubrique de regroupement de bulletin ; table créée uniquement côté Prisma (piste de migration double). Le regroupement **structurel** d'affichage reste `category_code`. |
| T-16 `student_enrollments` | MIG/0005:94-106 ; MIG/0059:9-18 ; PR:1587-1592 | amélioré | `academic.enrollments` (`mode CLASS`), `enrollment_history`, `enrollment_placements` | `UNIQUE (élève, année)` -> index uniques partiels (une vivante par classe, une `CLASS` par année et établissement) ; statuts `active/suspended/completed/dropped/transferred` -> `ACTIVE/SUSPENDED/COMPLETED/WITHDRAWN/TRANSFERRED_OUT` (+ `PENDING`, `CANCELLED`) ; `fees JSONB` + trigger -> finance ; `CHECK enrollment_date <= CURRENT_DATE` non repris (pré-inscription possible) ; 10 champs administratifs (`origin_school`, `is_repeating`, `is_transfer`, `scholarship_level`, `affectation_*`, `cepe_code`…) -> `origin_school`, `is_repeating`, `is_transfer_in`, `funding_type` + `assignment_reference`, `funder_label` (le type de financement remplace `scholarship_level` / `affectation_status`) ; suppression physique avec CASCADE des paiements -> interdite par trigger. |
| T-16 `teacher_assignments` | MIG/0005:67-81, 162-169 | hors module -> 009 | `people.teaching_assignments` | Le chevauchement d'affectation devient une contrainte de 009. |
| T-16 `course_assignments`, `teaching_hours` | MIG/0005:6-8 (dropped) ; PR:540, 1981 | abandonné | n/a (heures payables : 017 `payable_hours`) | Modèle d'heures de l'ancien schéma, routes encore enregistrées (`index.ts:249-251`) bien que les tables soient supprimées en migrations. |

### 1.2 Mode professionnel (INV-A §1.2, INV-P §1)

| Table legacy | Migration:ligne | Statut | Cible v2 | Justification |
|---|---|---|---|---|
| T-20 `professional_ecue` | MIG/0069:58-69, 0074:7-8 | amélioré | `subjects` (identité) + `curriculum_nodes` type `ECUE` (rattachement, `credits`, `coefficient`) | Mutualisation conservée (une matière dans plusieurs UE) ; les **crédits** passent du global à l'attribut **par rattachement** (INV-A §4.2 point 2) ; `statut actif/inactif` -> `status ACTIVE/INACTIVE` ; `bilan_type_id` -> 013 / `category_code`. |
| T-21 `professional_ue` | MIG/0069:78-93, 0080:6-8 | amélioré | `curriculum_nodes` type `UE` (`credits`, `category_code`, `status`) ; prix -> 014 | `filiere_id` figé -> `version_id` immuable (`node_identity_immutable`) ; `nb_uv` et Σ `ecue.credits` divergents -> **une** source (`credits` de l'UE = Σ ECUE, contrôlé à la publication) ; `categorie` -> `category_code` (donnée de pack) ; `prix`/`devise` -> hors module (014) ; `UNIQUE (tenant, code)` -> code unique **parmi les frères** (plus de préfixe `M2ACG-S2-UE3`). |
| T-22 `professional_ue_ecue` | MIG/0069:102-112 | amélioré | nœuds `ECUE` enfants d'un nœud `UE` (`ordinal`, `is_mandatory`, `coefficient`) | `coefficient` stocké mais jamais utilisé en legacy (pondération = `ecue.credits`) : devient une **donnée** lue par le RuleSet (012), jamais interprétée par academic. |
| T-23 `professional_ue_prerequisites` | MIG/0069:121-130 | amélioré | `curriculum_prerequisites` (cible = `required_lineage_id`) | Auto-référence et cycle imposés par trigger (récursif, profondeur 32) en plus du DFS ; « même classe » assoupli (même établissement, programmes différents admis, valable d'une année à l'autre via la lignée) ; voir §3.3. |
| T-24 `professional_ue_sessions` | MIG/0069:139-161 | amélioré | `academic.classroom_offerings` | `libelle` (porteur du nom de classe) -> `label` libre + `classroom_id` ; fenêtre `NOT NULL` -> `registration_opens_at/closes_at` nullable ensemble (Q-06) ; `capacite_max` -> `capacity` ; `enseignant_id` (modèle précédent) abandonné -> 009 ; `classroom_id` (salle) -> 017 ; statuts `brouillon/ouvert/complet/en_cours/termine/annule` -> `DRAFT/OPEN/FULL/IN_PROGRESS/COMPLETED/CANCELLED` ; **`UNIQUE (classe, nœud)`** (aucune unicité en legacy). |
| T-25 `professional_semestres` | MIG/0071:14-24, 0115:43-69 | amélioré | nœud `PERIOD` (`period_type_code`, `period_ordinal`) + `academic_periods` + `classroom_period_states` | Le semestre n'avait ni date, ni ordre, ni année : il en a trois (lien période). `bulletins_clotures_at/par` -> état `CLOSED` (`closed_at/by`) de la période ou de la classe ; clôture des notes -> `GRADING_CLOSED`. |
| T-26 `professional_semestre_ue` | MIG/0075:14-21 | amélioré | `curriculum_nodes.parent_id` (UE sous PERIOD) | Un seul chemin de rattachement. Une UE n'a qu'un parent : « une UE dans plusieurs semestres » est abandonné (§3.2 E-14). |
| T-27 `professional_semestre_sessions` | MIG/0071:40-47 | abandonné | n/a | Chemin « legacy » encore alimenté qui imposait des `OR` partout (INV-P §5.1) ; l'offre se rattache à son nœud (donc à son semestre) par `curriculum_node_id`. |
| T-28 `professional_classe_noms` | MIG/0117:15-27, 0128:31 | amélioré (promu en entité) | `academic.classrooms.name` | Le « nom de classe » devient une colonne unique par (année, programme, niveau) ; la **portée** `semestre_ids UUID[]` sans FK disparaît : la portée d'une classe = les offres existantes. |
| T-29 `professional_session_ecue_teachers` | MIG/0070:13-23 | hors module -> 009 | `people.teaching_assignments` ; garde `OfferingReadinessGuard` | 1 enseignant par (cohorte, ECUE) ; le garde « enseignant par ECUE obligatoire avant ouverture » reste côté academic (port). |
| T-30 `professional_ecue_seances`, `professional_course_plannings`, `professional_emploi_temps` | MIG/0069:166-180 ; 0072:13 ; 0076:13 | hors module -> 017 | `scheduling.session_occurrences`, `timetable_entries` | |
| T-30 `professional_ecue_attendance` | MIG/0069:189 | hors module -> 010 | `attendance.sessions`, `student_records` | |
| T-30 `professional_ecue_materials`, `professional_assignments` | MIG/0069:207, 241-341 | hors module -> 011 (devoirs) / 022 (supports) | `assess.*` ; LMS | |
| T-30 `professional_ecue_results`, `professional_ecue_notes`, `student_professional_ue_results` | MIG/0069:347-361, 464 ; 0083:14-26 | hors module -> 011 / 019 | `assess.*` ; `CompletionLookup.hasValidated` | `UNIQUE (ue, étudiant)` écrasé à chaque recalcul = perte de prérequis (bug 14, §3.9) : en v2 les résultats portent l'`enrollment_id`. |
| T-30 `professional_enrollments` | MIG/0069:371-392 | amélioré | `academic.enrollment_courses` (`source A_LA_CARTE`) sous un `enrollments` (`mode A_LA_CARTE`) | Voir P§1.9. |
| T-30 `professional_diplomas`, `professional_diploma_requirements`, `student_professional_diplomas` | MIG/0069:397-452 | hors module -> 019 / 013 | diplômes de cycle ; `lineage_id` comme ancre | |
| T-30 `professional_orders.programme_id` | MIG/0122:36 | hors module -> 014 | commandes/lots finance (`groupKey = classroomId`) | |
| T-31 tables supprimées (`teaching_units`, `teaching_hours`, `course_assignments`, `professional_subject*`) | MIG/0005:6-8 ; 0069:29-52 | abandonné | n/a | Aucune reprise (décision D13 du PRD de restructuration, D8 du plan). |

### 1.3 Tables du périmètre inscription (INV-P §1)

| Table legacy | Migration:ligne | Statut | Cible v2 | Justification |
|---|---|---|---|---|
| P§1.8 `professional_orders` (panier, commande de frais, `uniq_prof_order_cart`, `uniq_prof_order_frais`) | MIG/0061:89-105 ; 0122:26-51 ; 0123:28-37 | hors module -> 014 / 015 | factures, lignes, lots (étudiant x classe) | academic ne porte ni prix, ni panier, ni commande. La partie « siège réservé » du panier devient `enrollment_courses` `PENDING` + `hold_expires_at`. |
| P§1.9 `professional_enrollments` (`uniq_prof_enroll_active`, prix figé, statuts `en_attente_paiement/confirmee/terminee/annulee`) | MIG/0069:371-392 | amélioré | `enrollment_courses` (+ `enrollments` parent) | Index unique `(étudiant, cohorte)` -> `enrollment_courses_one_live (enrollment, nœud)` ; statuts -> `PENDING/CONFIRMED/COMPLETED/CANCELLED` ; `prix_unitaire` figé -> ligne de facture (finance) via `academic.enrollment_course.requested` ; capacité = `count(*)` sans verrou -> `enforce_offering_capacity` (verrou de ligne). |
| P§1.10 trigger `9999_update_session_capacity_trigger.sql` | MIG/9999 (cible `inscriptions_professionnelles`) | abandonné | n/a | Ne s'appliquait pas au module Professionnel (autre module « formations professionnelles »). La capacité v2 est imposée par `enforce_classroom_capacity` / `enforce_offering_capacity`. |
| P§1.11 `professional_student_matricules` (+ `student_profiles.sequence_number`) | MIG/0086:17 ; 0093 ; 0094:22-98 | amélioré | `enrollments.registration_number` + `institution_settings.registration_number_prefix/pattern` ; numéro d'ordre : `people.students` via `StudentDirectory.sequenceNumber` | Voir §3.8 (motif, unicité, idempotence). Le numéro d'ordre figé par tenant (trigger `assign_student_sequence_number`, verrou advisory) relève de 008 (`people.next_number`). |
| P§1.7 `professional_bulletins` (`bulletins_clotures_*`, MIG/0083:28, 0115, 0130) | MIG/0083_lmd:28 ; 0115:43-69 ; 0130 | hors module -> 013 | `reportcards` (snapshots immuables) | La RLS ajoutée tardivement (0130) est remplacée par `kernel.enable_tenant_rls` sur toutes les tables. |
| P§1.12 `cycles_frais` (lecture par `ensureBaremeOrders`) | MIG/0014:5 ; 0121:17-71 | hors module -> 014 | barèmes | Voir T-12. |
| P§1.12 correctifs de DONNÉES `MIG/0083_fix_m2acg_s2_credits`, `0084`, `0085` | MIG/0083-0085 | abandonné (remplacé par une validation) | `validateCurriculum` (`credits_must_equal_children`) | L'invariant implicite « Σ crédits ECUE = crédits UE » devient un contrôle de publication, pas un data-fix par code de classe. |
| P§1.12 scripts hors migrations (`seed-professional-frais.sql`, `fix-conduite-non-payante.sql`, `seed-cycles-frais-tarifs.sql`) | `infra/scripts/*.sql` (cités par 0122:19, 0123:17) | abandonné | seeds par modèles de pack ; prix : barèmes tenant (014) | Scripts destructifs (tarifs 100 000 / 50 000 / 0 écrasés sur toutes les classes) ; la Conduite non facturable devient `is_transversal` (aucune ligne de facture). |

---

## 2. Fonctions et endpoints (un tableau par famille)

Colonnes : **ID legacy** (INV-A `A-xxx`, INV-P `P-xxx`, `;` = même fonction décrite dans les deux inventaires) | **fonction legacy** | **référence** | **statut** | **cible v2** (cas d'usage de `modules/academic/index.ts`, route sous `/api/v1/academic`, ou table) | **justification / règle** (corrigée ou conservée).

### 2.1 Années académiques

| ID legacy | Fonction legacy | Référence | Statut | Cible v2 | Justification / règle |
|---|---|---|---|---|---|
| A-001 | Lister les années (`GET /academic-years`, `includeStats`) | RT/academic-years.ts:38-196 | amélioré | `listAcademicYears` ; `GET /years` | Tri `starts_on DESC` (index `academic_years_by_institution`) au lieu de `created_at` ; filtre établissement explicite ; `classCount/studentCount` retirés de la liste (le dénombrement passe par `listClassrooms` / `listEnrollments` filtrés par année, ou 025) ; pagination `pageSize <= 200`. |
| A-002 | Année active (`GET /academic-years/active`) et override par en-tête `x-academic-year-id` | RT/academic-years.ts:199-277 ; classes.ts:160 ; academic-calendar-events.ts:91 | amélioré | `getCurrentAcademicYear(ctx, institutionId)` ; `GET /years/current?institutionId=` | Une année courante par **établissement** (index `academic_years_one_current`) ; absence d'année courante = erreur explicite (`academic.no_current_year`) et non 404 ambigu ; l'en-tête d'override implicite est abandonné au profit d'un paramètre explicite `yearId`. |
| A-007 | Créer une année (`POST /academic-years`) | RT/academic-years.ts:608-726 ; CT/academic-year.ts:44-50 | amélioré | `createAcademicYear` ; `POST /years` | Contrat unique Zod strict (le Zod inline du handler ne validait que `name` et lisait les dates dans le body brut : contrat divergent supprimé) ; dates obligatoires, `ends_on > starts_on` ; **non-chevauchement imposé par la base** (`EXCLUDE`) ; **absence de trou** vérifiée par le cas d'usage (`409 academic.year_gap`) ; code unique par établissement ; statut initial `DRAFT`. |
| A-008 | Activer une année (`POST /academic-years/:id/set-active`) | RT/academic-years.ts:729-830 | amélioré | `openAcademicYear` puis `setCurrentAcademicYear` ; `POST /years/:id/open`, `POST /years/:id/set-current` | Bascule atomique (un seul `is_current` par établissement, `CHECK (NOT is_current OR status = 'OPEN')`) ; plus de `UPDATE` global du tenant ; `updated_at` maintenu ; événement `academic.year.opened`. |
| A-009 | Modifier une année (`PUT /academic-years/:id`) | RT/academic-years.ts:834-954 | amélioré | `updateAcademicYear` ; `PATCH /years/:id` | **Bug corrigé** : dates acceptées par le schéma Fastify mais ignorées par Zod (non modifiables) ; dates modifiables tant que `DRAFT`/`OPEN` et sans période close ; rechevauchement refusé par la base. |
| A-010 | Supprimer une année (`DELETE /academic-years/:id`) | RT/academic-years.ts:956-1036 | abandonné | `closeAcademicYear` (`POST /years/:id/close`, sensible) puis `archiveAcademicYear` (`POST /years/:id/archive`) | La suppression physique (autorisée même sur l'année ACTIVE, sans contrôle des inscriptions, événements, périodes en cascade) est remplacée par le cycle `CLOSED -> ARCHIVED` ; pas de `GRANT DELETE`. La clôture exige toutes les périodes `CLOSED` et aucune offre `OPEN` (AC7.4). |
| A-011 | Règle « année sans trou / 12 mois pleins » (migration de données) | MIG/0118_annees_scolaires_sans_trou.sql:44-69 | amélioré | `createAcademicYear` (`academic.year_gap`) ; `findYearGaps` / `academic.find_year_gaps()` ; `EXCLUDE daterange` | Passe de donnée de migration à **invariant** : chevauchement interdit par la base, trou refusé par le cas d'usage et contrôlable en exploitation. « 12 mois pleins » = valeur **par défaut** (`ends_on = starts_on + 1 an - 1 jour`, R1), non imposée (année charnière ou décalée d'octobre possible). Cause d'origine (juillet-août hors de toute année : 102 M FCFA « au mois en cours », 0 sur chaque année) éliminée par la continuité. |

### 2.2 Périodes, clôtures et garde de clôture

| ID legacy | Fonction legacy | Référence | Statut | Cible v2 | Justification / règle |
|---|---|---|---|---|---|
| A-003 | Lister les périodes d'une année | RT/academic-years.ts:305-377 | amélioré | `listAcademicPeriods` ; `GET /years/:id/periods` | Arbre année > période > sous-période ; tri `starts_on, ordinal` ; 404 de l'année conservé. |
| A-004 | Créer une période (`sort_order = MAX+1` hors verrou) | RT/academic-years.ts:380-456 | amélioré | `createAcademicPeriod`, `applyPeriodPlan` ; `POST /years/:id/periods`, `POST /years/:id/period-plan` | Type obligatoire (`period_types`, donnée) ; inclusion dans l'année et le parent (`academic_periods_guard`, qui remplace `assertPeriodWithinYear` no-op) ; chevauchement des sœurs de même type interdit (`EXCLUDE`) ; `ordinal` unique (index) au lieu de `MAX+1` concurrent ; `applyPeriodPlan` (THREE_TERMS, TWO_SEMESTERS…) répartit sans trou (AC1.3). |
| A-005 | Modifier une période | RT/academic-years.ts:459-568 (schéma `additionalProperties:false` `:469-475`) | amélioré | `updateAcademicPeriod` ; `PATCH /periods/:id` | **Bug corrigé** : les dates étaient supprimées avant le handler (AJV `removeAdditional`) ; dates et `ordinal` modifiables tant que `PLANNED`/`OPEN` ; figées dès `GRADING_CLOSED` (`academic.period_closed_dates`) ; année et type immuables. |
| A-006 | Supprimer une période (physique, cascade sur moyennes) | RT/academic-years.ts:571-605 | amélioré | `deleteAcademicPeriod` ; `DELETE /periods/:id` | Autorisée **uniquement `PLANNED`** (trigger `academic_periods_no_delete`) ; plus de cascade vers des notes (les autres modules citent la période par UUID sans FK). |
| P-084 | `semestreClotureDeSession` : premier semestre clôturé d'une cohorte (deux chemins) | GUARD:27-58 | amélioré | `getEffectivePeriodState(classroomId, periodId)` ; SQL `academic.effective_period_status` | État effectif = état explicite de la classe dans la période s'il existe, sinon celui de la période (la classe surcharge, R4) ; un seul chemin de rattachement ; scope par **classe** (R4). |
| P-085 | `semestreClotureDeEvaluation` : refus de corriger une copie si semestre clôturé | GUARD:81-115 | hors module -> 011 | `assess` appelle `getEffectivePeriodState` avant toute écriture de note/correction | Contrat testé côté 011 (AC6.4) ; la période d'une évaluation est celle de son nœud, plus de recherche « toutes les cohortes ». |
| P-086 | `messageCloture` et code `SEMESTRE_CLOTURE` (aucune réouverture par API) | GUARD:60-70 ; MIG/0115:29-32 | amélioré | code stable `academic.period_closed` (nom à fixer au plan) ; `reopenPeriod`, `reopenClassroomPeriod` | Message i18n fr-CI ; **réouverture par API** motivée (permission sensible `academic.period.reopen`, MFA, audit, `reopened_count`) à la place du SQL manuel documenté. |
| P-087 | Emplacements du verrou de clôture (résultats, notes manuelles, copies, bulletins ; NON appliqué à inscription, override de validation, appel, séances, `reopenSessions`, `updateSemestre`, `deleteSemestre`) | results.service:113,482,572,639 ; assignments.service:1237,1314 ; bulletin.service:1223 | amélioré | `getEffectivePeriodState` consommé par 010/011/013 + `PeriodClosureGuard` ; triggers `academic_periods_guard`, `curriculum_versions_guard` | Trous du garde legacy fermés pour la structure (bornes figées, suppression `PLANNED` seulement, curriculum `LOCKED` à la clôture de l'année) ; l'application aux **inscriptions** d'une période close n'est pas tranchée (Q-15) ; l'application aux appels/overrides relève de 010/011. |

### 2.3 Cycles (cycles d'enseignement) et niveaux

Le legacy ne modélise **aucun niveau** (L1, M2, 6e) : il est encodé dans le nom de la classe (voir A-204). Les niveaux sont une création v2 (`grade_levels`).

| ID legacy | Fonction legacy | Référence | Statut | Cible v2 | Justification / règle |
|---|---|---|---|---|---|
| A-020 | Lister les cycles (filtres statut, type) | RT/cycles.ts:32-159 | amélioré | `listEducationLevels`, `listGradeLevels` ; `GET /reference/education-levels`, `/reference/grade-levels` | Référentiel de pack ; filtre `type` abandonné (Q-12). |
| A-021 | Créer un cycle (code auto, durée 12 par défaut, statut `active`) | RT/cycles.ts:162-296 | amélioré | `upsertReferenceData` ; `PUT /reference/education-levels` | Code explicite (regex `^[A-Z][A-Z0-9_]{0,39}$`) au lieu du slug tronqué à 20 caractères ; défaut « 12 mois » supprimé ; **fuite de transaction** (`return reply` avant `ROLLBACK`, `:219,240`) disparaît avec `TenantDb` ; ligne `is_system`/personnalisée protégée au ré-application du modèle. |
| A-022 | Lire un cycle | RT/cycles.ts:299-389 | conservé | `listEducationLevels` (filtre `code`) | Lecture simple. |
| A-023 | Modifier un cycle (mapping clé -> colonne à la main) | RT/cycles.ts:392-547 | amélioré | `upsertReferenceData` | Schéma Zod strict ; plus de mapping manuel ; mêmes fuites de transaction supprimées. |
| A-024 | Supprimer un cycle (409 si programmes ; `cycles_frais` cascade) | RT/cycles.ts:550-643 | abandonné | désactivation `active = false` via `upsertReferenceData` | Pas de suppression d'un référentiel référencé par `grade_levels` / `programs` (FK) ; le barème `cycles_frais` n'est plus en cascade (014). |

### 2.4 Filières et programmes

Rappel : `programmes` legacy = classe (+ niveau + structure) ; `filieres` legacy = `programs` v2.

| ID legacy | Fonction legacy | Référence | Statut | Cible v2 | Justification / règle |
|---|---|---|---|---|---|
| A-030 | Lister les « programmes » (= classes) avec cycle et filière | RT/programmes.ts:93-221 | amélioré | `listPrograms` + `listGradeLevels` (+ `listClassrooms`) ; `GET /programs`, `GET /classrooms` | Les filtres `cycleId`, `filiereId`, `academicYear` deviennent `educationLevelId`, `programId`, `yearId` ; `filiereId` n'est plus lu hors contrat ; `set_config(false)` + RESET remplacé par le contexte tenant de la plateforme. |
| A-031 | Créer un programme / une classe (statut `active` par défaut, `version '1.0'`) | RT/programmes.ts:223-392 | amélioré (éclaté) | `createProgram` + `setProgramGradeLevels` (structure) ; `createCurriculumVersion` ; `createClassroom` | Un seul POST faisait structure + instance. Unicité `(code, version)` -> `UNIQUE (établissement, code)` (programme) et `UNIQUE (programme, année)` (version) ; `ects_credits`, `objectives`, `academic_year` texte libre morts abandonnés ; défaut `status` aligné (`ACTIVE`, version `DRAFT`). |
| A-032 | Lire un programme | RT/programmes.ts:394-472 | conservé | `getProgram` ; `GET /programs/:id` | |
| A-033 | Modifier un programme (changement de `cycleId` sans mise à jour de `cycles_frais`) | RT/programmes.ts:474-735 | amélioré | `updateProgram` ; `PATCH /programs/:id` | `institution_id` immuable ; le niveau de cycle est porté par `education_level_id` ; le barème n'a plus de `cycle_id` redondant (014). |
| A-034 | Approuver un programme (`review -> approved`, `approvedBy` pris dans le body) | RT/programmes.ts:737-827 | amélioré | `publishCurriculumVersion` ; `POST /curriculum-versions/:id/publish` (`curriculum.publish`) | Seule transition appliquée en legacy ; v2 : `DRAFT -> PUBLISHED` après `validateCurriculum` sans `ERROR` ; l'auteur vient du **jeton**, pas du body ; machine d'états complète imposée par `curriculum_versions_guard` ; l'étape intermédiaire `review` n'est pas reprise (Q-20). |
| A-035 | Supprimer un programme (409 si cours/classes ; FK NO ACTION -> 500 sur UE, semestres, diplômes) | RT/programmes.ts:829-935 | abandonné | `archiveProgram` ; `PATCH /programs/:id` | Pas de suppression physique ; l'archivage d'un programme avec classes ouvertes est un cas limite géré (spec §13) ; plus aucun `500` générique sur FK. |
| A-040 | Lister les filières (+ `class_count`) | RT/filieres.ts:53-99 | amélioré | `listPrograms` | `class_count` = comptage de classes via `listClassrooms`. |
| A-041 | Lire une filière | RT/filieres.ts:102-162 | conservé | `getProgram` | |
| A-042 | Créer une filière (unicité `LOWER(name)` API vs index sensible à la casse) | RT/filieres.ts:165-224 | amélioré | `createProgram` | Unicité sur `code` normalisé (majuscules) : la divergence API/DB disparaît. |
| A-043 | Modifier une filière (`domaine` non répercuté sur `programmes.domaine`) | RT/filieres.ts:227-331 | amélioré | `updateProgram` | `domain_code` à **source unique** (`programs`) ; `subjects.domain_code` pour le catalogue. |
| A-044 | Supprimer une filière (409 si classes) | RT/filieres.ts:334-393 | abandonné | `archiveProgram` | Voir A-035. |

### 2.5 Classes (mode scolaire : programme x année)

| ID legacy | Fonction legacy | Référence | Statut | Cible v2 | Justification / règle |
|---|---|---|---|---|---|
| A-050 | Lister les classes (`includeDetails`, `studentCount`) | RT/classes.ts:54-348 | amélioré | `listClassrooms` ; `GET /classrooms` | **Incohérence corrigée** : `studentCount` de la liste ne filtrait pas `status = 'active'` alors que le détail le faisait (`:226-231` vs `:465-470`) ; une seule définition (inscriptions `ACTIVE` mode `CLASS` + sélections `CONFIRMED`) via `getRoster` ; l'en-tête d'année devient un paramètre. |
| A-051 | Lire une classe (+ dates de l'année, cours) | RT/classes.ts:351-548 | amélioré | `getClassroom` ; `GET /classrooms/:id` | Dates de l'année par jointure explicite ; cours = `listNodesForClassroom`. |
| A-052 | Cours d'une classe, avec **repli** sur tous les cours actifs du programme si `class_courses` est vide | RT/classes.ts:551-683 (`:636-654`) | amélioré | `listNodesForClassroom` ; `GET /curriculum-versions/:id` | Repli silencieux supprimé : une classe sans version de curriculum renvoie une erreur explicite et ne peut pas être `ACTIVE` (voir Q-07 pour le trou de la base). |
| A-053 | Cours disponibles d'un programme (`credits` = `hours_total`) | RT/classes.ts:686-757 | amélioré | `listCurriculumNodes` ; `GET /curriculum-versions/:id` | Mapping trompeur « crédits = heures » supprimé : `credits` et `hours_*` sont deux attributs distincts. |
| A-054 | Créer une classe (code aléatoire, cours dans `class_courses`, `maxStudents` 30) | RT/classes.ts:760-955 | amélioré | `createClassroom` ; `POST /classrooms` | Impose niveau couvert par le programme, version du même programme et de la même année, établissement cohérent avec l'année (`classrooms_guard`) ; **unicité du nom et du code** par (année, programme, niveau) ; code explicite (plus d'entier aléatoire ni de régénération silencieuse non transactionnelle) ; `classroomId` (salle) non repris ; `console.log` et `Promise.all` sur un seul client disparaissent. |
| A-055 | Modifier une classe (remplace tout `class_courses`) | RT/classes.ts:958-1149 | amélioré | `updateClassroom` ; `PATCH /classrooms/:id` | Établissement, année, programme et niveau **figés** (trigger) ; le choix des matières = `curriculum_version_id` (publié) ; l'erreur 23505 est mappée en `409 academic.duplicate_code` (message exact : unicité par année et niveau). |
| A-056 | Supprimer une classe (409 si cours ou inscriptions) | RT/classes.ts:1152-1232 | abandonné | `cancelClassroom` / `completeClassroom` ; `POST /classrooms/:id/{cancel,complete}` | `classrooms_no_delete` ; annuler une classe = statut `CANCELLED` (inscriptions gérées par leur machine d'états). |

### 2.6 Cours, matières, UE, ECUE et composition

| ID legacy | Fonction legacy | Référence | Statut | Cible v2 | Justification / règle |
|---|---|---|---|---|---|
| A-060 | Lister les cours (JOIN internes programme + bilan) | RT/courses.ts:82-201 | amélioré | `listSubjects`, `listCurriculumNodes` ; `GET /subjects`, `GET /curriculum-versions/:id` | **Cours orphelins invisibles** (JOIN internes) : plus d'orphelin possible (FK + grammaire) ; `bilan_types` non requis. |
| A-061 | Créer un cours (programme et bilan obligatoires, `hoursTotal = 1`, `coef` « 1,5 », `status active`) | RT/courses.ts:203-377 | amélioré | `createSubject` + `addCurriculumNode` (`SUBJECT`) ; `POST /subjects`, `POST /curriculum-versions/:id/nodes` | Défauts bidons supprimés (`hoursTotal = 1`, `delivery_mode`) ; `coef` en chaîne décimale exacte (Zod) ; **`coef` NULL n'est plus traité comme 1** (`COALESCE(coef, 1)`) : NULL = « pas de coefficient », la lecture est affaire du RuleSet ; unicité du code : `subjects (tenant, code)` + `curriculum_nodes_sibling_code` ; erreur 500 exposant `error.message` -> `toErrorBody`. |
| A-062 | Lire un cours | RT/courses.ts:379-430 | conservé | `getSubject`, `getCurriculumNode` | |
| A-063 | Modifier un cours (changement de programme sans contrôle des `class_courses`) | RT/courses.ts:432-633 | amélioré | `updateSubject`, `updateCurriculumNode` | Un nœud ne change jamais de version ni de type (`node_identity_immutable`) ; déplacement = `moveCurriculumNode` dans la **même** version. |
| A-064 | Supprimer un cours (n'était pas bloqué par les moyennes : perte de notes en CASCADE) | RT/courses.ts:635-706 | amélioré | `removeCurriculumNode` (`DRAFT` seulement) ; `DELETE /curriculum-nodes/:id` ; matière : `status INACTIVE` | Suppression d'une matière du catalogue **refusée** tant qu'un nœud la référence (AC2.6) ; plus aucune cascade vers des notes (`CurriculumUsageGuard`). |
| A-070 | Retrouver un lien classe-cours | RT/class-courses.ts:5-104 | abandonné | `classrooms.curriculum_version_id` | Table `class_courses` supprimée (voir T-08). |
| A-071 | Créer un lien classe-cours (idempotent, **aucune validation**) | RT/class-courses.ts:107-183 | abandonné | idem ; option -> `addEnrollmentCourse` (`OPTION`) | Le lien n'était validé ni pour le tenant ni pour l'appartenance au programme ; en v2 le trigger de grammaire et la version unique de la classe garantissent la cohérence. |
| A-072 | Lire un lien classe-cours | RT/class-courses.ts:186-256 | abandonné | idem | |
| A-120 ; P-006 | Lister les ECUE ; CRUD ECUE complet (`GET/POST /ecue`, `GET/PATCH/DELETE /ecue/:id`) | RT:226 -> SC:66-113 ; RTP:226-288 -> SC:31-232 | amélioré | `listSubjects` ; `GET /subjects` ; UE mutualisantes : `listCurriculumNodes` filtrés par `subjectId` | Le catalogue `subjects` remplace le référentiel ECUE ; pageSize <= 200 (1000 en legacy) ; `ECUE_STILL_LINKED`/`deactivateEcue` (code mort, désactivation par PATCH) -> `status INACTIVE` ; suppression refusée si référencée. |
| A-121 | Créer une ECUE (`ON CONFLICT DO NOTHING` -> `DUPLICATE_CODE`) | SC:31-64 | amélioré | `createSubject` ; `POST /subjects` | Conflit explicite `409 academic.duplicate_code` ; les **crédits** se portent sur le nœud `ECUE` (par rattachement) et non plus sur l'ECUE globale. |
| A-122 | Lire une ECUE (+ UE liées) | SC:115-125 | conservé | `getSubject` | UE liées = nœuds référençant la matière. |
| A-123 | Modifier une ECUE (`credits` modifiable : bouge rétroactivement les moyennes pondérées) | SC:140-186 | amélioré | `updateSubject` ; crédits : `updateCurriculumNode` / `amendPublishedCurriculum` | **Plus de modification rétroactive sans trace** : crédits/coefficients d'un curriculum publié ne changent que par amendement motivé journalisé (`curriculum_amendments`, événement `academic.curriculum.amended`, signal de recalcul pour 011/012). |
| A-124 | Supprimer une ECUE (refusée si rattachée) | SC:204-233 | amélioré | `updateSubject` (`INACTIVE`) | Désactiver plutôt que supprimer. |
| A-130 ; P-001 | Créer une UE (`filiere_id` requis, `prix`, `devise`, `nb_uv`, `categorie`) | SU:212-251 ; RTP:316 | amélioré | `addCurriculumNode` (type `UE`, parent `PERIOD`) ; `POST /curriculum-versions/:id/nodes` | UE = nœud de l'arbre ; code unique parmi les frères (plus de préfixe de classe `M2ACG-S2-UE3`) ; `nb_uv` -> `credits` ; `categorie` -> `category_code` ; **prix et devise -> 014** (dimension nœud/lignée du barème) ; conflit -> `409 academic.duplicate_code`. |
| A-131 ; P-002 | Lister les UE (filtres classe, statut, q) | SU:253-285 ; RTP:300 | amélioré | `listCurriculumNodes` ; `GET /curriculum-versions/:id` | Filtre `nodeType`, `status`, `q`. |
| A-132 ; P-003 | Lire une UE (+ ECUE + prérequis) | SU:287-298 ; RTP:338 | conservé | `getCurriculumNode`, `getCurriculumTree` | |
| A-133 ; P-004 | Modifier une UE (`filiere_id` figé ; changer `prix` ne propage rien) | SU:300-341 ; RTP:348 | amélioré | `updateCurriculumNode` / `amendPublishedCurriculum` | Version et parent immuables ; le prix est figé à la demande côté finance (ligne de facture) ; désactiver = `status INACTIVE` (`deactivateUe` : code mort). |
| A-134 ; P-005 | Supprimer une UE (refusée si inscription ; cascade sur cohortes, séances, notes sans inscription) | SU:355-376 ; RTP:367 | amélioré | `removeCurriculumNode` (`DRAFT`) | Aucune cascade : FK `classroom_offerings.curriculum_node_id` sans cascade + `CurriculumUsageGuard` (011/019). |
| A-140 | Lister la composition d'une UE | SU:394-403 | conservé | `getCurriculumTree` (enfants de l'UE, tri `ordinal`) | |
| A-141 ; P-007 | Ajouter une ECUE à une UE (`coefficient > 0`, `ordre`, `est_obligatoire`) ; P-007 couvre la composition entière (A-140 à A-143) | SU:405-448 ; RTP:379-427 | amélioré | `addCurriculumNode` (type `ECUE`, parent `UE`, `subjectId`, `credits`, `coefficient`, `isMandatory`, `ordinal`) | **Contrôle ajouté** : crédits de l'UE = Σ crédits des ECUE (`credits_must_equal_children`, vérifié par `validateCurriculum` à la publication) ; legacy : aucun contrôle ; `UE_ECUE_LINK_EXISTS` -> `UNIQUE (parent, code)` ; aucun verrou legacy si cohortes existantes : le curriculum publié est gelé. |
| A-142 | Modifier le lien UE-ECUE | SU:450-481 | amélioré | `updateCurriculumNode` | `coefficient` n'est plus « sans effet » : c'est une donnée publiée (`getRuleContext`) lue par le RuleSet. |
| A-143 | Retirer l'ECUE d'une UE (sans vérifier séances/notes) | SU:483-497 | amélioré | `removeCurriculumNode` ; sur publié : `amendPublishedCurriculum` + `CurriculumUsageGuard` | Retrait refusé si des notes ou des inscriptions dépendent du nœud. |

### 2.7 Semestres (regroupements d'UE par classe)

| ID legacy | Fonction legacy | Référence | Statut | Cible v2 | Justification / règle |
|---|---|---|---|---|---|
| A-170 ; P-030 | UE éligibles à un semestre (`GET /semestres/eligible-ue`) | SS:25-38 ; RTP:604 | amélioré | `listCurriculumNodes` (type `UE`, version de la classe) | Les UE `INACTIVE` ne sont plus proposées (legacy : « toutes y compris inactives »). |
| A-171 ; P-033 | Lister les semestres (`nb_ue`, `nb_uv`, `nb_sessions` par 2 chemins, `bulletins_clotures_at`) | SS:41-80 ; RTP:644 | amélioré | `listCurriculumNodes` (type `PERIOD`) + `listAcademicPeriods` + `getEffectivePeriodState` | Tri par `period_ordinal` (plus par `created_at`, ni ordre alphabétique) ; `nb_uv` = Σ `credits` des UE (source unique) ; nombre d'offres via `listOfferings`. |
| A-172 ; P-034 | Détail d'un semestre (UE, ECUE, `is_conduite` par texte, `nb_uv` vs `nb_credits_ecue`) | SS:83-144 ; RTP:747 | amélioré | `getCurriculumTree` (sous-arbre `PERIOD`) | `is_conduite` (`ILIKE`) -> `is_transversal` ; fin de la divergence `nb_uv` / crédits ECUE. |
| A-173 ; P-031 | Créer un semestre (libellé + >= 1 UE, `DUPLICATE_SEMESTRE`) | SS:191-228 ; RTP:725 | amélioré | `addCurriculumNode` (type `PERIOD`, `periodTypeCode`, `periodOrdinal`) + UE enfants | UE de la même classe par construction (enfants de la version) ; libellé unique -> `(period_type_code, ordinal)` + code unique parmi les frères ; le nœud pointe l'`academic_periods` du même type et ordinal (**dates et année** enfin portées). |
| A-174 ; P-032 | Créer plusieurs semestres en lot | SS:231-275 ; RTP:622 | amélioré | `cloneCurriculumVersion` (reprise d'une année) ; insertion en lot par transaction de l'import 031 | Transactionnel conservé ; pas de cas d'usage dédié (le lot est un enchaînement de `addCurriculumNode`). |
| A-175 ; P-035 | Modifier un semestre (remplacement total de la liste d'UE ; n'actualise pas les cohortes) | SS:277-335 ; RTP:757 | amélioré | `updateCurriculumNode`, `moveCurriculumNode`, `removeCurriculumNode` ; sur publié `amendPublishedCurriculum` | Opérations unitaires, plus de DELETE+INSERT global ; retirer une UE ayant des offres est refusé (legacy : les cohortes sortaient silencieusement du semestre). |
| A-176 ; P-036 | Supprimer un semestre (CASCADE sur `professional_bulletins` clôturés) | SS:640-649 ; RTP:788 | amélioré | `removeCurriculumNode` (`DRAFT`) | Jamais de cascade vers des bulletins : ce sont des snapshots immuables (013) ; interdit sur curriculum publié. |
| A-177 ; P-038 | **Ouvrir une classe** : créer une cohorte par UE du semestre (`« {libellé} — {code UE} »`), liens `semestre_sessions`, affectations ECUE | SS:495-602 ; RTP:704 | amélioré | `openOfferingsForPeriod(classroom, periodNodeId, dates, window, capacity)` ; `POST /classrooms/:id/offerings/open-period` | **Idempotent** (`UNIQUE (classe, nœud)` : plus de doublons à l'identique) ; dates/fenêtre incohérentes -> `422` explicite (legacy : 500 sur CHECK 23514, aucun refine Zod) ; statut demandé `DRAFT` ou `OPEN`, `OPEN` soumis à `OfferingReadinessGuard` (legacy : contournait la garde enseignants) ; nœud `INACTIVE` ou transversal ignoré ; affectations d'enseignants -> 009. |
| A-178 ; P-037 | Clôturer les NOTES du semestre : toutes les cohortes `-> termine` (y compris `brouillon`, tous noms de classe) | SS:614-638 ; RTP:778 | amélioré | `closePeriodGrading` (`POST /periods/:id/close-grading`) ; `closeClassroomPeriodGrading` (`POST /classrooms/:id/periods/:periodId/close-grading`) | **Divergence assumée D4 (§3.1)** : la clôture est **par classe** ; elle n'altère plus des offres `DRAFT` ni les offres d'autres classes partageant la même UE ; la réouverture existe (`reopenClassroomPeriod`). Le lien avec le passage des offres en `COMPLETED` n'est pas tranché (Q-05). |
| P-040 | Génération et clôture des bulletins d'un semestre | professional-bulletin.service.ts:1218, 1557 ; RTP:1661-1674, 1817 | hors module -> 013 | 013 génère les snapshots puis appelle `closePeriod` / `closeClassroomPeriod` | `bulletins_clotures_at` -> état `CLOSED`. |

### 2.8 Prérequis

| ID legacy | Fonction legacy | Référence | Statut | Cible v2 | Justification / règle |
|---|---|---|---|---|---|
| A-150 ; P-008 | Lire les prérequis d'une UE | SU:513-522 ; RTP:439 | conservé | `getCurriculumNode` (prérequis inclus) ; `getNodePrerequisiteStatus(studentId, nodeId)` | |
| A-151 ; P-009 | Remplacer les prérequis (`PUT`, transaction : auto-référence, **même classe**, cycle DFS) | SU:528-582 (DFS `:164-187`) ; RTP:449 | amélioré | `setNodePrerequisites` ; `PUT /curriculum-nodes/:id/prerequisites` | Auto-référence et cycle **imposés par trigger** (`curriculum_prerequisites_guard`, récursif profondeur 32) en plus du DFS ; la cible est une **lignée** (valable d'une année à l'autre) ; la contrainte « même classe » (`UE_PREREQ_NOT_SAME_FILIERE`) est **assouplie** : même établissement, programmes/niveaux différents admis (prérequis inter-niveaux L1 -> L2 enfin possibles) ; ET conservé (voir §3.3, Q-09). |

### 2.9 Cohortes / sessions d'UE (offres), noms de classe, éligibilité et capacité

| ID legacy | Fonction legacy | Référence | Statut | Cible v2 | Justification / règle |
|---|---|---|---|---|---|
| A-160 ; P-010 | Créer une cohorte (statut `ouvert` forcé ; UE inactive refusée) | SU:586-632 ; RTP:484 | amélioré | `createOffering` (`DRAFT`) puis `transitionOffering(open)` ; `POST /classrooms/:id/offerings`, `POST /offerings/:id/open` | **Bug corrigé** : la création directe ne contourne plus la garde « enseignant par ECUE obligatoire » (AC3.4) ; dates/fenêtre validées (Zod + CHECK + 422, comparaisons de dates et non de chaînes) ; nœud `INACTIVE` / non inscriptible / transversal refusé par `classroom_offerings_guard`. |
| A-161 ; P-011 | Lister les cohortes d'une UE | SU:634-643 ; RTP:474 | amélioré | `listOfferings` ; `GET /classrooms/:id/offerings` | Filtres classe, nœud, statut. |
| A-162 ; P-012 | Liste admin des cohortes **avec auto-finalisation à la lecture** (`UPDATE ... termine WHERE date_fin < CURRENT_DATE`) ; filtre semestre sur un seul des deux chemins | SU:830-908 (`:839-845`, `:858-865`) ; RTP:522 | amélioré | `listOfferings` (lecture pure) + job `finalizeEndedOfferings` | **Divergence assumée D3 (§3.1)** : plus aucun `GET` n'écrit (AC3.5) ; filtre semestre cohérent (nœud parent `PERIOD`) ; inscrits actifs = places réservées ; le job est planifié et horodaté (dates civiles, jamais `CURRENT_DATE` du serveur ; périmètre exact : Q-05). |
| A-163 ; P-013 | Lire une cohorte (+ semestre, classe, `nb_inscriptions_actives`) | SU:645-682 ; RTP:538 | conservé | `getOffering` ; `GET /offerings/:id` | |
| A-164 ; P-014 | Modifier une cohorte (aucun contrôle capacité < inscrits, pas de resync de statut) | SU:684-730 ; RTP:548 | amélioré | `updateOffering` ; `PATCH /offerings/:id` | Règle cible : `capacity` >= places réservées, resynchronisation `FULL`/`OPEN` après changement (à acter, Q-24) ; renommer le libellé ne casse plus rien (le nom de classe est `classrooms.name`) ; le statut n'est modifiable que par `transitionOffering`. |
| A-165 ; P-015 | Transition de statut (`UE_SESSION_STATUS_TRANSITIONS`, `complet` jamais manuel, garde enseignants vers `ouvert`) | SU:732-780 (matrice `:35-45`) ; RTP:567 | amélioré | `transitionOffering` ; `POST /offerings/:id/{open,start,complete,cancel}` | Matrice reprise et imposée par trigger (`DRAFT -> OPEN\|CANCELLED` ; `OPEN -> DRAFT\|FULL\|IN_PROGRESS\|COMPLETED\|CANCELLED` ; `FULL -> OPEN\|IN_PROGRESS\|COMPLETED\|CANCELLED` ; `IN_PROGRESS -> COMPLETED\|CANCELLED`) ; `FULL` posé automatiquement ; `en_cours`, « obsolète » en legacy, devient `IN_PROGRESS` effectif (`start`) ; `OfferingReadinessGuard` sur **toute** ouverture ; `from === to` n'est plus un no-op toléré. |
| A-166 ; P-016 | Supprimer une cohorte (refusée si inscriptions, séances/notes en cascade) | SU:782-801 ; RTP:590 | abandonné | `transitionOffering(cancel)` ; `POST /offerings/:id/cancel` | Aucun `GRANT DELETE` sur `classroom_offerings` ; annuler -> événement `academic.offering.cancelled` (017 annule les séances) ; plus de cascade silencieuse. |
| A-167 ; P-017 | Rouvrir un lot de cohortes (`date_fin` nouvelle, fenêtre fermée à 23:59:59 heure serveur, `statut = ouvert` même depuis `annule`) | SU:808-828 ; RTP:504 | abandonné (en l'état) | prolongation par `updateOffering` tant que `OPEN`/`FULL`/`IN_PROGRESS` | Les états `COMPLETED` / `CANCELLED` sont terminaux en v2 et `UNIQUE (classe, nœud)` interdit de recréer l'offre : **le besoin « rouvrir » n'est pas couvert** (Q-04) ; heure serveur et `fermee < ouverte` (23514 -> 500) disparaissent (dates civiles, 422). |
| A-179 ; P-039 | Noms de classe d'une classe (dérivés par `split_part(libelle, ' — ', 1)`, portée, ouverts, restants, `complet`) | SS:351-431 ; RTP:667 | amélioré | `listClassrooms` / `getClassroom` (`name`) + `listOfferings` | Le nom est une **colonne** unique par (année, programme, niveau) : fin de la reconstruction par chaîne et des variantes de tirets (`—`, `–`, `-`) ; ouverts/restants/complet = comptage des offres (statuts) de la classe. |
| A-180 | Portées déclarées (tenant) (`GET /classe-noms`) | SS:437-453 ; RTP:657 | abandonné | n/a | Table de portée `semestre_ids UUID[]` sans FK supprimée : la portée d'une classe est l'ensemble de ses offres. |
| A-181 | Déclarer la portée d'un nom (appelée « juste après » la création d'ouverture : non transactionnelle) | SS:459-493 ; RTP:678 | abandonné | n/a | Remplacé par `openOfferingsForPeriod` (transactionnel). |
| A-152 | Éligibilité à une cohorte : `evaluateSessionEligibility` / `evaluatePrerequisites` / `computeSessionCapacityStatus` (ordre statut > fenêtre > doublon > capacité > prérequis) | SE:32-68, 96-102, 76-90 | amélioré | `checkOfferingEligibility` ; `GET /offerings/:id/eligibility` ; fonctions pures du domaine | Voir P-080, P-082, P-083 pour le détail ; contrôles désormais **communs** à tous les chemins d'inscription et doublés par triggers. |
| P-080 | `evaluateSessionEligibility` : statut `ouvert` -> fenêtre `[ouverte_le, fermee_le]` bornes incluses -> doublon actif -> capacité -> prérequis (codes `SESSION_NOT_ENROLLABLE`, `DUPLICATE_ENROLLMENT`, `SESSION_FULL`, `UE_PREREQ_NOT_VALIDATED`) | SE:32-68 | conservé | `checkOfferingEligibility` | **Ordre et bornes reproduits** (AC5.1) ; codes unifiés `academic.offering_not_open`, `academic.registration_window_closed`, `academic.duplicate_enrollment`, `academic.offering_full`, `academic.prerequisites_unmet` (fin du double code `ALREADY_ENROLLED` / `DUPLICATE_ENROLLMENT` ; statuts HTTP explicites au lieu du 400 par défaut) ; golden test de caractérisation. |
| P-082 | `syncSessionCapacity` / `computeSessionCapacityStatus` : bascule `ouvert <-> complet` après chaque écriture, `FOR UPDATE` puis `count(*)` | SE:225-249, 76-90 | amélioré | `enforce_offering_capacity` / `enforce_classroom_capacity` (triggers, verrou de ligne) ; transitions `OPEN <-> FULL` par cas d'usage (`academic.offering.full\|reopened`) | Capacité **imposée par la base** pour tous les chemins (legacy : verrou pris par certaines routes seulement, admin pouvait dépasser) ; retour à `OPEN` seulement si la fenêtre est valide (AC3.3, reproduit) ; la capacité d'une classe est dure seulement si `capacity_is_hard` (Q-13). |
| P-083 | `evaluatePrerequisites` + `getPrerequisitesStatus` + `getValidatedUeIds` (ET ; « validé » = `student_professional_ue_results.statut = 'validee'`, tous cycles confondus) | SE:96, 209, 252 | amélioré | `CompletionLookup.hasValidated(studentId, lineageId)` (011/019 ; repli : sélections `COMPLETED`) ; `getNodePrerequisiteStatus` -> `{satisfied, missing[]}` | ET conservé ; satisfaction par **lignée** (capitalisation inter-annuelle) ; plus d'upsert unique `(UE, étudiant)` écrasable (bug 14, §3.9) ; prérequis évalués directement (non transitifs), comme en legacy. |
| P-019 | Séances d'ECUE d'une cohorte (CRUD `/ue-sessions/:id/seances`, `/seances/:id`) | SU:912-1025 ; RTP:1045-1093 | hors module -> 017 | `session_occurrences` (généré depuis `timetable_entries`) | |
| P-020 | Planning des cours (admin/enseignant ; seules les cohortes `ouvert` planifiables : `SESSION_NOT_OPEN`) | SP:45-289 ; RTP:956-1032 | hors module -> 017 | `timetable_entries`, `generateOccurrences` | Le consommateur 017 réagit à `academic.offering.opened\|cancelled`. |
| P-021 | Présences (appel, justification, historique) d'une cohorte | SU:1135-1545 ; RTP:1104-1369 | hors module -> 010 | `attendance.sessions`, `student_records`, `justifications` | L'appel porte sur les sélections `CONFIRMED`/`COMPLETED` (AC5.6). |
| P-022 | Emploi du temps hebdomadaire pro (`/emploi-temps/*`) | professional-emploi-temps.service.ts ; RTP:802-943 | hors module -> 017 | `timetables`, `timetable_entries` | |

### 2.10 Inscriptions classiques (mode scolaire)

Le périmètre ID de ce fichier (INV-A + INV-P) n'inclut pas les routes `student_enrollments` : elles sont inventoriées dans INV-S §2.6 (S-060 à S-066, analyse « élèves »). Elles sont reprises ici en **référence croisée** pour éviter un trou de parité côté `academic.enrollments` ; la parité des fiches élèves, tuteurs et du matricule d'ordre reste au `parity.md` de la spec 008. Ces lignes ne sont pas comptées dans les totaux de §5.

| ID (INV-S) | Fonction legacy | Référence | Statut | Cible v2 | Justification / règle |
|---|---|---|---|---|---|
| S-060 | Lister les inscriptions classiques | RT/enrollments.ts:37-290 | amélioré | `listEnrollments` ; `GET /enrollments` | INNER JOIN invisibles (inscriptions sans année) impossibles ; en-tête d'année -> paramètre. |
| S-061 | Élèves disponibles (exclut ceux inscrits dans l'année, pas dans la classe) | RT/enrollments.ts:293-395 | amélioré | `people.searchStudents` + `listEnrollments(yearId)` | Recherche paginée (LIMIT 50 fixe supprimé). |
| S-062 | Créer une inscription (capacité `COUNT(active) >= max_students`, frais depuis `cycles_frais`) | RT/enrollments.ts:398-745 | amélioré | `enrollStudent` ; `POST /enrollments` | Doublon (classe) **et** unicité année -> `409` explicites (legacy : 500 sur `UNIQUE (élève, année)`) ; capacité verrouillée si `capacity_is_hard` (legacy : course) ; frais -> 014 (événement `academic.enrollment.created`) ; classe/année cohérentes (`enrollments_guard`). |
| S-063 | Inscription en lot (année DOIT être active ; transaction avortée au 1er 23505) | RT/enrollments.ts:748-1078 | amélioré | `enrollStudentsBulk` ; `POST /enrollments/bulk` | Rapport `{created, skipped, errors}` honnête (legacy : 201 annoncé alors que rien n'était persisté) ; une transaction par apprenant. |
| S-064 | Modifier / changer de classe (`UPDATE class_id`, sans historique ni contrôle) | RT/enrollments.ts:1081-1341 | amélioré | `transferEnrollment` ; `POST /enrollments/:id/transfer` | Même `enrollment_id`, `enrollment_placements` + `enrollment_history`, capacité revérifiée, événement `academic.enrollment.transferred`. |
| S-065 | Supprimer une inscription (cascade sur paiements et échéances) | RT/enrollments.ts:1344-1415 | abandonné | `cancelEnrollment` ; `POST /enrollments/:id/cancel` | `enrollments_no_delete` ; aucune perte financière. |
| S-066 | « Fix fees » (réécrit les frais vides ; endpoint temporaire sans rôle) | RT/enrollments.ts:1418-1490 | abandonné | n/a (finance) | Endpoint de rattrapage. |

### 2.11 Inscriptions à la carte, panier, porte d'entrée, matricule

Rappel : prix, commande, panier monétaire, paiement, échéancier et reçu relèvent de 014/015 ; academic porte l'inscription, la sélection (siège réservé) et la confirmation.

| ID legacy | Fonction legacy | Référence | Statut | Cible v2 | Justification / règle |
|---|---|---|---|---|---|
| P-050 | **Inscrire un étudiant (admin)** à une cohorte : verrou cohorte, matricule, commande `en_attente_paiement`, `confirmerSiInscriptionSoldee` ; **aucun contrôle** de statut, fenêtre, capacité, prérequis, UE inactive, Conduite | RTP:2944 -> SE:636 | amélioré | `enrollStudent` (mode `A_LA_CARTE`) + `addEnrollmentCourse` ; `POST /enrollments`, `POST /enrollments/:id/courses` | Mêmes contrôles que l'étudiant (`checkOfferingEligibility`) ; capacité non dépassable (trigger) ; nœud transversal refusé (la Conduite ne crée plus de commande facturable) ; matricule dans la **même transaction** (legacy : persisté même en cas d'échec ultérieur) ; commande/barème -> 014 sur `academic.enrollment_course.requested` ; dérogations motivées de l'admin : Q-01. |
| P-051 | Inscription en lot N cohortes x M étudiants (1 transaction par couple, `skipped`) | RTP:2968 -> SE:726 | amélioré | `enrollStudentsBulk` ; `POST /enrollments/bulk` | Rapport `{created, skipped, errors}` conservé ; mêmes contrôles que l'unitaire. |
| P-052 | Lister les inscriptions (filtres classe, cohorte, UE, étudiant, statut ; matricule, semestre, montant payé) | RTP:3107 -> SE:1262 | amélioré | `listEnrollments` ; `GET /enrollments` | `pageSize <= 200` (500 en legacy) ; montant payé non porté par academic (014) ; matricule = `registration_number`. |
| P-053 | Détail d'une inscription | RTP:2991 -> SE:1354 | conservé | `getEnrollment` ; `GET /enrollments/:id` | |
| P-054 | **Changer le statut** (`PATCH`, aucune machine à états ; `confirmee` -> commande `payee` sans paiement ; `annulee` annule toute la commande ; 23505 -> 500 à la réactivation) | RTP:3002 -> SE:1388 | amélioré | `confirmEnrollment`, `suspendEnrollment`, `resumeEnrollment`, `withdrawEnrollment`, `cancelEnrollment`, `reopenEnrollment`, `confirmEnrollmentCourse`, `cancelEnrollmentCourse` | **Machine d'états imposée par la base** (`enrollments_guard`, `enrollment_courses_guard`) ; changer un statut **n'altère aucun paiement** (AC4.4) ; l'annulation d'une sélection n'annule pas les autres lignes ; conflits d'unicité -> codes `academic.*`. |
| P-055 | Supprimer une inscription (DELETE physique, suppression de la commande vide et des paiements en CASCADE) | RTP:3026 -> SE:1418 | abandonné | `cancelEnrollment` / `cancelEnrollmentCourse` (motif obligatoire) | Aucune suppression (`enrollments_no_delete`, `enrollment_courses_no_delete`) ; historique `enrollment_history` ; aucune perte de paiement. |
| P-056 | Marquer « terminée » (depuis `confirmee`, hook best-effort `recomputeSessionResults` + `recomputeForStudent` à erreurs avalées) | RTP:3125 -> SE:1232 | amélioré | `completeEnrollment`, `completeEnrollmentCourse` ; `POST /enrollments/:id/complete`, `POST /enrollment-courses/:id/complete` | Depuis `ACTIVE`/`CONFIRMED` seulement (reproduit) ; le recalcul des résultats et des diplômes devient la **consommation d'événements** (`academic.enrollment.completed`, `academic.enrollment_course.completed`) par 011/019 : plus d'erreur avalée ; `completeEnrollmentCourse` est appelé par 011/019 quand l'UE est validée. |
| P-057 | Lots de scolarité (liste, détail, paiement de lot) | RTP:3043-3105 -> PAY | hors module -> 014 / 015 | lots étudiant x classe regroupés par `groupKey = classroomId` | |
| P-060 | Classes ayant une offre (`GET /student/programmes`, UE actives non-Conduite avec cohorte `ouvert`) | RTP:3157 -> SE:267 | amélioré | `GET /catalog?institutionId&programId` (filtre programmes avec offres `OPEN`) | Conduite exclue par `is_transversal` (plus de `ILIKE 'conduite%'`) ; fenêtre et capacité maintenant prises en compte. |
| P-061 | **Catalogue** (UE actives, ECUE, TOUTES les cohortes de tous statuts, `inscriptible`, `places_restantes`, `deja_inscrit`, `prerequisites_status`, `verrouille`) | RTP:3166 -> SE:290 | amélioré | `GET /catalog` (offres ouvertes + `checkOfferingEligibility` + `getNodePrerequisiteStatus`) | Verrouillage + liste des manquants **conservés** ; chaque offre appartient à une **classe nommée** et une année : plus de mélange « tous noms, toutes années » ; places restantes calculées sur les places réservées. |
| P-062 | ECUE débloquées d'une cohorte (inscription `confirmee`/`terminee` exigée, Conduite exclue) | RTP:3189 -> SE:415 | amélioré | `listNodesForEnrollment` (nœuds suivis : sélections confirmées et leurs enfants) | Seuls les statuts confirmés ouvrent le contenu (AC5.6) ; traitement des nœuds transversaux : Q-21. |
| P-063 | Lire le panier (commande `brouillon`, lignes `<> annulee`) | RTP:3203 -> SE:830 | amélioré | `GET /enrollments/:id/courses` (sélections `PENDING`) ; panier monétaire -> 014 | Le « panier » d'academic = ensemble de sélections `PENDING` (siège réservé) ; total et commande -> 014. |
| P-064 | **Ajouter au panier** : verrou, `UE_INACTIVE`, éligibilité, matricule, `ensureDraftOrder`, prix figé, `syncSessionCapacity` ; siège réservé sans expiration | RTP:3212 -> SE:839 | amélioré | `addEnrollmentCourse` (`source A_LA_CARTE`, `PENDING`, `hold_expires_at`) ; `POST /enrollments/:id/courses` | Siège réservé avec **durée** (`pending_hold_minutes`) et job `expirePendingHolds` (bug 7, §3.9) ; événement `academic.enrollment_course.requested` (nœud, lignée, crédits) -> finance fige le prix ; décompte de capacité **excluant ses propres lignes** et les réservations expirées (AC5.2). |
| P-065 | Retirer du panier (DELETE physique de la ligne ; resync capacité) | RTP:3257 -> SE:1016 | amélioré | `cancelEnrollmentCourse` ; `POST /enrollment-courses/:id/cancel` | `CANCELLED` + motif + historique au lieu d'une suppression sans trace ; la place est libérée (`OPEN` si la fenêtre l'autorise). |
| P-066 | **Valider le panier** : revérifie chaque ligne (`activeEnrollmentCount` hors commande), prérequis, matricule, commande -> `en_attente_paiement` | RTP:3271 -> SE:1044 | amélioré | revérification par `checkOfferingEligibility` à la confirmation (`confirmEnrollmentCourse`) ; commande/facture -> 014 | **Divergence assumée D1 (§3.1)** : la dernière place détenue par l'étudiant ne bloque plus sa propre validation (bug 1) ; qui rappelle l'éligibilité au moment du checkout reste à acter (Q-10). |
| P-067 | Auto-inscription directe sans panier (ignore fenêtre, statut `ouvert`, **prérequis** ; n'appelle pas la porte d'entrée) | RTP:3235 -> SE:924 | abandonné | chemin unique `addEnrollmentCourse` | **Un seul chemin** d'inscription avec tous les contrôles (bugs 3 et 4, §3.9) ; la confirmation suit la politique de l'établissement (`AUTO` ou `ON_REGISTRATION_FEE_PAID` avec « aucun frais » signalé par finance). |
| P-068 | Mes commandes / détail | RTP:3283-3292 -> SE:1132-1146 | hors module -> 014 / 015 | factures de l'apprenant | |
| P-069 | Mes inscriptions (classe, année scolaire, semestre, commande, payé ; Conduite exclue) | RTP:3330 -> SE:1175 | amélioré | `listEnrollmentsByStudent` ; `GET /me/enrollments` | `classe_nom` = `classrooms.name`, année = `academic_years.code`, semestre = nœud `PERIOD` : plus de `split_part` ni de pivot ; commande/payé -> 014. |
| P-070 | Payer une commande (effet : `confirmerSiInscriptionSoldee`) | RTP:3306 -> PAY:238 | hors module -> 015 | `finance.invoice.paid` consommé par academic | Voir P-081. |
| P-071 | Vues parent / élève (inscriptions, reçus, paiements) | RTP:3388-3559, 3374, 3358 -> SE:1456-1645 | amélioré | `GET /me/enrollments`, `GET /children/:studentId/enrollments` (`enrollment.child.read` + `people.isGuardianOfStudent`) | Isolation parent via `people` ; reçus et paiements -> 014/015. |
| P-081 | **Porte d'entrée** `inscriptionSoldee` / `confirmerSiInscriptionSoldee` : `en_attente_paiement` -> `confirmee` si frais d'inscription de (étudiant, classe) soldés (écart <= 0,5) ou absents ; confirme TOUTES les inscriptions en attente du lot, **toutes classes si `programmeId` NULL** | GATE:38-87 ; appelée par SE (P-050), PAY:335, 415, 709 | amélioré | `institution_settings.enrollment_confirmation_policy = ON_REGISTRATION_FEE_PAID` ; consommation de `finance.invoice.paid` -> `confirmEnrollment` ; politiques `AUTO`, `ON_FULL_PAYMENT`, `MANUAL` | **Divergence assumée D2 (§3.1)** : la confirmation cible **l'inscription visée** (AC5.5) et jamais toutes celles de l'étudiant ; « classe sans frais d'inscription » (correction 0127) = règle de la politique + signal de finance ; la tolérance 0,5 est une règle de **finance** (jamais dans academic) ; seules les inscriptions `ACTIVE`/`COMPLETED` et les sélections `CONFIRMED`/`COMPLETED` ouvrent présences, notes, bulletins (R25). Niveau de confirmation (inscription / sélection) : Q-02. |
| P-088 | Matricule professionnel `IPAM-<CODE>-<NNNN>` : `cleanFiliereCode`, `formatProfessionalMatricule`, `ensureProfessionalMatricule` (idempotent, `null` si pas de numéro d'ordre) | SE:122-193 | amélioré | génération de `enrollments.registration_number` par `enrollStudent` (motif `institution_settings.registration_number_pattern`, `{STUDENT_SEQ:n}` via `StudentDirectory`) | Préfixe configurable (plus de `IPAM` en dur), idempotent, unique par établissement ; voir §3.8 (le motif ne contient pas de jeton « niveau », et l'unicité pose un problème de ré-inscription : Q-03). |
| P-089 | `ensureDraftOrder` / `createOrderWithRef` / `ensureBaremeOrders` / `recomputeOrderTotal` (références `PRO-AAAA-NNNNNN`, `FRAIS-…`) | SE:448, 584, 511, 789 | hors module -> 014 | factures, lignes, barèmes | « Finance déguisée dans le module d'inscription » : sort d'academic ; academic ne fait qu'émettre `…requested`. |
| P-090 | Résultats d'UE (prérequis amont) : `evaluateUeValidation`, upsert unique `(UE, étudiant)` | results.service:337-406 ; bulletin-calc.ts:99-163 | hors module -> 011 / 012 / 019 | `assess` + RuleSet ; `CompletionLookup` | Voir A-213 ; la perte de prérequis par ré-inscription (bug 14) est évitée par des résultats rattachés à l'inscription et à la lignée. |

### 2.12 Année scolaire dérivée et nom de classe dérivé

| ID legacy | Fonction legacy | Référence | Statut | Cible v2 | Justification / règle |
|---|---|---|---|---|---|
| A-200 ; P-091 | `anneeScolaireOf` (pivot 1er septembre, `getMonth() >= 8`) ; dupliquée 7 fois dans le front et >= 8 fois en SQL | professional-annee-scolaire.ts:6-12 ; SE:1187, 1577 ; SU:1400 ; bulletin.service:1836 | abandonné | `academic_years` ; `resolvePeriodForDate` ; `getCurrentAcademicYear` | Source unique ; **fuseau** (minuit UTC -> 31/08) et duplications éliminés ; lint AC1.6 (aucun littéral `09-01` / `'septembre'` dans `modules/academic/**`). Pour une éventuelle conversion de seeds : `année = f(date)` via les années définies, jamais via un pivot. |
| A-201 | `anneeDe(expr)` : même règle en SQL (owner, finances, pulse, payroll, stats, payslip) ; variante fenêtre financière | owner-pro-annee.sql.ts:174-182 ; owner-pedagogie.service.ts:90-93 ; owner-finances.service.ts:124-130 ; owner-pulse.service.ts:124-144 ; owner-payroll-mass.service.ts:116-125 ; owner-stats-filters.service.ts:123 ; teacher-payslip.service.ts:94 | abandonné | jointure sur `academic_year_id` / événements ; 025 | Les consommateurs lisent l'année explicite (événements, projections). |
| A-202 | `NOM_DE_CLASSE_SQL` / `CLE_NOM_DE_CLASSE_SQL` (retire le suffixe code UE et les tirets, clé composée filiere_id et nom) | owner-pro-annee.sql.ts:155-165 | abandonné | `classrooms.name` + `classroom_id` | Réplique « au caractère près » du JS front supprimée. |
| A-203 | Date métier d'une commande (`PRO_ORDER_DATES_CTE`, 5 replis, `PRO_DATE_NIVEAU_MESURE = 3`) | owner-pro-annee.sql.ts:75-136 | hors module -> 014 / 025 | `enrollments.enrolled_on` (date civile figée) exposée par `getEnrollment` | `created_at` non fiable (import de masse) : academic fournit une date d'inscription explicite et immuable (`enrollment_identity_immutable`). |

### 2.13 Cycle groups et cursus (Licence 1 -> 3, Master 1 -> 2)

| ID legacy | Fonction legacy | Référence | Statut | Cible v2 | Justification / règle |
|---|---|---|---|---|---|
| A-204 ; P-092 | `buildCycleGroups` / `loadCycleGroups` / `resolveCycleGroupFor` : regroupe des CLASSES par regex `^\s*(LICENCE\|MASTER)\s+(\d+)\s+(.+?)\s*$` ; groupe identifié par la classe terminale ; classe hors motif = grade « LICENCE » par défaut ; BTS non géré | CG:41-127 (regex `:28`, défaut `:112`) | amélioré | `programs` + `program_grade_levels` (ordre) + `grade_levels.next_grade_level_id` / `is_final` ; `getRuleContext` (cycle, niveau et rang, `isFinal`) | **Structure déduite d'un nom** remplacée par un vrai modèle : un cursus = un programme couvrant des niveaux ordonnés (L1, L2, L3) ; le passage de niveau est une **donnée** (`next_grade_level_id`) ; BTS et DUT sont des programmes comme les autres ; grade par défaut « LICENCE » (bug) impossible. |
| A-205 | `loadRequiredUeForCycle` : union des UE des semestres de toutes les classes du groupe | CG:139-158 | hors module -> 019 | 019 lit `getCurriculumTree` / `listCurriculumNodes` par programme (nœuds `UE` sous chaque `LEVEL`), ancrés sur `lineage_id` | Exigences de diplôme = module diplôme ; academic fournit l'arbre et les lignées. |
| A-206 | UE validées y compris Conduite (`student_professional_ue_results.statut = 'validee'` OU note d'examen de l'ECUE Conduite >= 10 ; heuristique `ILIKE 'conduite%' OR code ILIKE '%EC-CON%'`) | CG:169-234 | hors module -> 019 / 011 | `CompletionLookup` ; `is_transversal` | Heuristique texte supprimée ; seuil 10 -> RuleSet (012). |
| A-207 | Mention d'un cursus (moyenne des `moyenne_session` pondérée par `credits_total` ; barème <10 / 12 / 14 / 16 / 18) | CG:243-274 | hors module -> 012 / 013 | RuleSet de mention | Deux échelles de mention divergentes (A-116 vs A-207) : barèmes = données de RuleSet. |

### 2.14 Hors module : finance (014 / 015)

Ces fonctions n'appartiennent pas à academic ; le point de contact est l'événement `academic.enrollment_course.requested` / `academic.enrollment.created`, le port `EnrollmentDirectory` (`createEnrollmentDirectory`) et la consommation de `finance.invoice.paid` / `finance.payment.completed`.

| ID legacy | Fonction legacy | Référence | Statut | Cible v2 | Justification / règle |
|---|---|---|---|---|---|
| A-100 | Lister les barèmes de frais (pagination « curseur » dont `hasMore` est toujours faux) | RT/cycle-fees.ts:20-151 | hors module -> 014 | barèmes de frais | Bug de pagination non reproduit côté 014. |
| A-101 | Upsert d'un barème par (cycle, programme) ; `cycleId` redondant | RT/cycle-fees.ts:154-265 | hors module -> 014 | barème par programme/niveau | Redondance `cycle_id` supprimée par le modèle (le niveau porte le cycle). |
| A-102 | Scolarité calculée d'une filière (Σ `prix` des UE des semestres de chaque classe ; devise `MIN`) | RT/cycle-fees.ts:277-439 | hors module -> 014 | prix d'un nœud (dimension lignée du barème, spec 004 §7.4) ; academic fournit `listNodesForClassroom` | Couplage facturation / structure pro (UE) géré par un contrat explicite, plus par jointure ; devise par défaut `XOF` en dur supprimée (donnée tenant). |

### 2.15 Hors module : évaluations, notes, résultats, bulletins, diplômes, rangs (011 / 012 / 013 / 019)

| ID legacy | Fonction legacy | Référence | Statut | Cible v2 | Justification / règle |
|---|---|---|---|---|---|
| A-105 à A-108 | CRUD `bilan-types` (rubriques de bulletin ; unicité insensible à la casse ; table créée côté Prisma uniquement) | RT/bilan-types.ts:15, 91, 154, 248 | hors module -> 013 | gabarit de bulletin ; structure : `category_code` | Voir T-15. |
| A-110 | `assertClassPeriodAlignment` : la période doit appartenir à l'année de la classe | RT/semester-averages.ts:55-72 | hors module -> 011 | `getAcademicPeriod` + `getClassroom` (année) | La base ne vérifie pas cette cohérence pour `classroom_period_states` (Q-08). |
| A-111 | Matières de la matrice (`fetchMatrixCourses` / `fetchAllowedCourseIds`, ignore `class_courses`) | RT/semester-averages.ts:87-120 | hors module -> 011 | `listNodesForClassroom` | Une seule définition des matières d'une classe. |
| A-112 | Saisie manuelle d'une moyenne par matière (`GET/PUT /semester-averages/manual`) | RT/semester-averages.ts:389-513 | hors module -> 011 | notes + surcharge motivée et auditée | Les moyennes sont calculées (plan §3.7). |
| A-113 | Matrice classe x période (moyennes + absences) | RT/semester-averages.ts:516-713 | hors module -> 011 / 010 | résultats de période ; `attendance.period_summaries` | |
| A-114 | Rangs ex aequo `computeCompetitionRanks` (tolérance 1e-4) | RT/semester-averages.ts:147-169 | hors module -> 012 | fonction `rank` du DSL | |
| A-115 | Moyenne pondérée `computeWeightedStats` (matière non notée ignorée, `coef` NULL = 1) | RT/semester-averages.ts:363-386 | hors module -> 012 | RuleSet (`wavg`) | Le traitement de `coef` NULL et des manquants devient explicite dans le RuleSet. |
| A-116 | Décisions de conseil, mentions, distinctions, appréciations (barèmes en dur) | RT/semester-averages.ts:171-237 | hors module -> 012 / 013 | RuleSets | Voir §4. |
| A-117 | Bulletins PDF, certificats d'assiduité, `pdf-html` ; moyenne annuelle (S1 + 2 x S2)/3 ; S1 reconnu par texte | RT/semester-averages.ts:716-1283 | hors module -> 013 / 024 | snapshot + rendu serveur | `period_types` + `ordinal` remplacent la reconnaissance par libellé. |
| A-210 | `noteEcue` : 0,4 x devoirs + 0,6 x examen | SVC/bulletin-calc.ts:90-94 | hors module -> 012 | RuleSet | |
| A-211 | `evaluerEcue` : éliminatoire < 5, validée >= 10 ou manuellement | bulletin-calc.ts:99-110 | hors module -> 012 | RuleSet | |
| A-212 | `moyenneUe` pondérée par `ecue.credits` | bulletin-calc.ts:118-129 | hors module -> 012 | RuleSet (poids = `credits` des nœuds ECUE fournis par `getRuleContext`) | |
| A-213 | `evaluerUe` (validée si moyenne >= 10 ET aucun éliminatoire ET tout noté) | bulletin-calc.ts:136-163 | hors module -> 012 / 011 | RuleSet | Alimente `CompletionLookup`. |
| A-214 | `moyenneSession`, `creditsValides`, `creditsTotal`, `semestreValide`, `peutPasserAnneeSuperieure` | bulletin-calc.ts:174-205 | hors module -> 012 | RuleSet | `semestreValide` (20) et `peutPasserAnneeSuperieure` (48) sont du **code mort** dans le legacy (§4). |
| A-215 | Décision de semestre (`every(validee)` -> `admis` / `rattrapage` / `ajourne`) | professional-bulletin.service.ts:1812-1824 | hors module -> 012 / 013 | RuleSet + `recordEnrollmentOutcome` | Règle réelle ≠ `semestreValide(credits >= 20)` ; aucune compensation entre UE. |
| A-216 | Catégories d'UE au bulletin (ordre figé `fondamentale`, `specialite`, `culture_generale`, `_autres`) | professional-bulletin.service.ts:1848-1867 | hors module -> 013 | gabarit ; academic fournit `category_code` | |
| A-217 | Année académique du bulletin (1re `date_debut` des cohortes, pivot) ; référence `REL-<an>-<code>-<matricule>` | professional-bulletin.service.ts:1826-1871 | hors module -> 013 | `getRuleContext` (année explicite), `registration_number` | |
| §2.7 INV-P | Diplômes (liste de fonctions `professional-diplomas.service.ts` : `evaluateDiplomaEligibility`, `computeDiplomaProgress`, `ensureCycleDiploma`, `awardManual`, `revoke`, etc. ; routes `/diplomas`, `/cycle-groups`, `/signataires`) | professional-diplomas.service.ts:64-1225 ; RTP:3790-4127 | hors module -> 019 / 013 | diplômes de cycle ancrés sur `lineage_id` | Pas d'ID dans l'inventaire ; règle des crédits capitalisés (toutes les UE obligatoires validées ET Σ `nb_uv` >= `uv_required`) -> 019 ; l'octroi automatique ne se déclenche plus sur la seule route `complete` mais sur l'événement de validation. |

### 2.16 Hors module : salles, réservations, calendrier (017)

| ID legacy | Fonction legacy | Référence | Statut | Cible v2 | Justification / règle |
|---|---|---|---|---|---|
| A-080 | Lister les salles (filtres, réservations futures) | RT/classrooms.ts:15-174 | hors module -> 017 | `rooms` ; `GET /api/v1/scheduling/rooms` | |
| A-081 | Lire une salle | RT/classrooms.ts:177-260 | hors module -> 017 | `rooms` | |
| A-082 | Créer une salle (aucune validation ; Zod importés mais inutilisés) | RT/classrooms.ts:263-326 | hors module -> 017 | `createRoom` | |
| A-083 | Modifier une salle (clés du body **interpolées dans le `SET` : injection SQL**) | RT/classrooms.ts:329-437 | hors module -> 017 | `updateRoom` | Défaut de sécurité à ne pas reproduire. |
| A-084 | Supprimer une salle (contrôle non filtré par tenant) | RT/classrooms.ts:440-487 | hors module -> 017 | `setRoomStatus` | |
| A-085 | Lister les réservations | RT/classroom-reservations.ts:11-213 | hors module -> 017 | `getRoomOccupancy`, `listOccurrencesForRoom` | |
| A-086 | Créer une réservation (conflit `tstzrange` + `EXCLUDE`, TOCTOU -> 500) | RT/classroom-reservations.ts:216-292 | hors module -> 017 | `createOccurrence`, `overrideConflict` | Conflit imposé par la base (`resource_claims_no_overlap`). |
| A-087 | Modifier une réservation (propriétaire ou admin ; injection par clés dynamiques) | RT/classroom-reservations.ts:295-390 | hors module -> 017 | `rescheduleOccurrence`, `changeOccurrenceRoom` | |
| A-088 | Annuler une réservation (propriétaire seulement, asymétrique avec le PUT) | RT/classroom-reservations.ts:393-430 | hors module -> 017 | `cancelOccurrence` | |
| A-090 | Lister les événements du calendrier | RT/academic-calendar-events.ts:21-201 | hors module -> 017 | `calendar_events` | `set_config(true)` hors transaction (inopérant) disparaît. |
| A-091 | Créer un événement (ponctuel, 6 types, `semester` libre) | RT/academic-calendar-events.ts:204-353 | hors module -> 017 | `createCalendarEvent` | Pas de lien avec les périodes en legacy ; en v2 les périodes sont dans academic. |
| A-092 | Modifier un événement (`academicYearId` non modifiable) | RT/academic-calendar-events.ts:356-539 | hors module -> 017 | `updateCalendarEvent` | |
| A-093 | Supprimer un événement | RT/academic-calendar-events.ts:542-612 | hors module -> 017 | `deleteCalendarEvent` | |

### 2.17 Hors module : enseignants (008 / 009)

| ID legacy | Fonction legacy | Référence | Statut | Cible v2 | Justification / règle |
|---|---|---|---|---|---|
| A-168 ; P-018 | Affectation d'un enseignant **par ECUE et par cohorte** (`GET/PUT /ue-sessions/:id/ecue-teachers`, `CONDUITE_NO_TEACHER`, `ECUE_NOT_IN_UE`) | SU:1042-1127 ; RTP:1166-1177 | hors module -> 009 | `createTeachingAssignment`, `replaceTeachingAssignment`, `listAssignmentsForClassroom` ; garde `createOfferingReadinessGuard` | La **garde d'ouverture** (un responsable par nœud obligatoire non transversal) reste déclenchée par academic via le port ; « la Conduite n'a jamais d'enseignant » = `is_transversal`, vérifié par 009 (Q-21). |

### 2.18 Hors module : lectures « propriétaire » (analytique sur la structure)

Cette section de INV-A (§2.18) n'a pas d'ID. Elle est incluse pour l'exhaustivité.

| Réf. | Fonction legacy | Référence | Statut | Cible v2 | Justification / règle |
|---|---|---|---|---|---|
| §2.18-a | `owner/programme`, `/academic`, `/pedagogie`, `/referentiel` : détectent des incohérences du modèle (écart `nb_uv` ≠ Σ crédits ECUE ; UE vendable à prix 0 hors Conduite ; ECUE obligatoire sans enseignant sur cohorte ouverte ; semestre sans session ; cours orphelins) | RT/owner/index.ts:355, 681, 730, 806 -> SVC/owner-*.service.ts | amélioré | `validateCurriculum` (rapport `ERROR`/`WARN` avant publication) + contraintes de grammaire ; garde `OfferingReadinessGuard` | **Chaque invariant détecté devient une contrainte ou une validation préventive** (crédits UE = Σ ECUE, nœud sans parent impossible, ECUE obligatoire sans responsable = refus d'ouverture, orphelin impossible par FK). |
| §2.18-b | Tableaux de bord owner : seuils d'analyse (cohorte min 5, top 15, risque < 10), `/stats/filters` (sélecteur d'années dérivé des sessions) | owner-pedagogie.service.ts:33-36 ; owner-academic.service.ts:6 ; owner-stats-filters.service.ts:123 | hors module -> 025 | modèles de lecture sur événements `academic.*` ; sélecteur = `listAcademicYears` | |

---

## 3. Règles métier implicites et défauts

Pour chaque règle : **reproduite** (identique), **corrigée** (avec la correction) ou **écartée**, et par quoi elle est garantie (DB = trigger/contrainte, UC = cas d'usage, RS = RuleSet, PORT = module tiers). Les références `Rxx` et `ACx.y` renvoient à `spec.md`.

### 3.1 Divergences assumées (golden tests de la tranche 2.0)

La spec (§12 et §15, critère 7) annonce « 4 divergences assumées (bugs corrigés) » sur les scénarios de caractérisation (éligibilité, capacité, prérequis, garde de clôture). Les quatre retenues ici sont celles où le comportement figé du legacy **est faux** et où le golden test doit être réécrit :

| ID | Comportement legacy figé | Comportement v2 attendu | Réf. legacy | Garantie / test |
|---|---|---|---|---|
| D1 | **Dernière place -> panier bloqué** : `addToCart` fait basculer la cohorte en `complet` dès que la ligne de l'étudiant atteint la capacité ; `validateOrder` réévalue avec `sessionStatut = 'complet'` et renvoie `SESSION_NOT_ENROLLABLE` alors que l'étudiant détient lui-même le siège | Le siège d'un apprenant n'est pas compté contre lui ; la confirmation d'une sélection `PENDING` ne ré-évalue pas le statut `OPEN` de l'offre ; une réservation expirée libère la place | INV-P §7.1 bug 1 ; SE:911, 1086 | UC `checkOfferingEligibility` (décompte hors propres lignes) + trigger `enforce_offering_capacity` (ne revérifie pas une ligne déjà comptée) ; AC5.2 ; cas limite « dernière place » (spec §13) |
| D2 | **Porte d'entrée sur tout** : `confirmerSiInscriptionSoldee(…, null)` confirme toutes les inscriptions `en_attente_paiement` de l'étudiant, toutes classes confondues, sans lire le barème (panier sans `programme_id`) ; a contrario un paiement de lot ne confirme jamais les lignes du panier | La confirmation vise **l'inscription portée par la facture payée** ; « classe sans frais d'inscription » = règle de politique, pas de contournement | INV-P §7.1 bug 2 ; GATE:69-87 | UC `confirmEnrollment` sur `finance.invoice.paid` (`sourceRef` -> `enrollmentCourseId` / `enrollmentId`) ; AC5.5 |
| D3 | **Lecture avec effet d'écriture** : `GET /ue-sessions` passe en `termine` toute cohorte dont `date_fin < CURRENT_DATE` (y compris `brouillon`, fuseau du serveur DB) | Lecture pure ; job `finalizeEndedOfferings` planifié ; jamais de `brouillon` -> terminé | INV-P §7.1 bug 9 ; SU:839-845 | AC3.5 ; test d'architecture « aucun `GET` n'écrit » |
| D4 | **Clôture de semestre = toutes les cohortes de l'UE**, tous noms de classe et toutes années confondus (périmètre `ue_id IN semestre_ue`), y compris `brouillon` ; deux « classes nommées » d'un même semestre sont clôturées ensemble | Clôture **par classe** (`classroom_period_states`) ; état effectif = max(période, classe) ; réouverture motivée | INV-P §7.1 bug 10 ; SS:614-638 ; GUARD:27-58 | AC6.1, AC6.2 ; `effective_period_status` |

Les autres bugs (§3.9) ne sont pas couverts par un golden test legacy (la couverture legacy est de la logique pure, INV-P §7.1 bug 19) : ils sont couverts par les 28 comportements de `data-model.md`, la concurrence 200/100 et les tests d'intégration.

### 3.2 Éligibilité, capacité, réservation

| ID | Règle legacy | Source | Traitement v2 | Garantie |
|---|---|---|---|---|
| E-01 | Ordre d'évaluation : statut `ouvert` -> fenêtre -> doublon -> capacité -> prérequis ; premier échec renvoyé | SE:32-68 | **Reproduite** (AC5.1) ; codes stables `academic.*` | UC + fonction pure ; golden test |
| E-02 | Bornes de la fenêtre incluses (`ouverte_le <= now <= fermee_le`) | SE:32-68 | **Reproduite** | UC ; golden test |
| E-03 | Fenêtre d'inscription `NOT NULL` (legacy) | MIG/0069:139-157 | **Modifiée** : les deux bornes sont nullables ensemble (`CHECK ((opens IS NULL) = (closes IS NULL))`). Sémantique de « sans fenêtre » à acter : aucune restriction (Q-06) | DB (CHECK) + UC |
| E-04 | `capacite_max NULL` = illimité | SE:76-90 | **Reproduite** (R16) | DB + UC |
| E-05 | `complet <-> ouvert` automatique, jamais manuel ; retour à `ouvert` seulement dans la fenêtre | SE:76-90 | **Reproduite** (AC3.3) ; `FULL` dérivé de la capacité | UC + événements `academic.offering.full\|reopened` |
| E-06 | Une place est réservée par toute inscription `<> annulee`, **y compris panier non validé**, sans expiration | SE:225-249 | **Corrigée** : `PENDING` non expiré, `CONFIRMED`, `COMPLETED` (R17) ; durée `pending_hold_minutes` ; `NULL` = sans expiration (choix d'établissement) | DB (décompte ignorant `hold_expires_at` dépassé) + job `expirePendingHolds` |
| E-07 | Le décompte des places exclut les lignes de l'étudiant lui-même (`othersCount`), mais pas le statut `complet` | SE:911, 1086 | **Corrigée** (D1) | UC + trigger |
| E-08 | Verrou `FOR UPDATE` sur la cohorte à l'inscription (pris par certaines routes seulement ; l'admin dépassait la capacité) | SE:225-249, 636 | **Corrigée** : verrou de ligne dans le trigger pour **tous** les chemins ; une capacité d'offre est toujours dure | DB (`enforce_offering_capacity`) ; test de concurrence 200/100 |
| E-09 | Une inscription active par (étudiant, cohorte) ; aucune règle par (étudiant, UE) | MIG/0069:390 | **Étendue** : une sélection vivante par (inscription, nœud) ; deux offres simultanées du même nœud pour le même apprenant refusées (AC5.7) | DB (`enrollment_courses_one_live`) + UC (la règle inter-inscriptions n'a pas d'index : Q-26) |
| E-10 | Aucune règle contre la ré-inscription à une UE déjà validée | INV-P §7.1 bug 14 | **Ajoutée** : avertissement `academic.already_completed`, `override` motivé requis (AC5.7) | UC |
| E-11 | UE inactive refusée (`UE_INACTIVE`) | SE:839 | **Reproduite** : nœud ou matière `INACTIVE` non offrable | UC + `classroom_offerings_guard` |
| E-12 | Conduite non inscriptible (`CONDUITE_NO_ENROLL`, test `libelle ILIKE 'conduite%'`) | SE:951 | **Corrigée** : `is_transversal` ; ni offre, ni achat à la carte, ni enseignant (R18) | DB (`classroom_offerings_guard`, `enrollment_courses_guard`) |
| E-13 | Capacité de classe (classique) : `COUNT(active) >= max_students` -> 409, non verrouillé ; absente en lot | RT/enrollments.ts (S-062, S-063) | **Reproduite** si `capacity_is_hard`, **indicative** sinon (défaut `false` : Q-13) ; verrou de ligne | DB (`enforce_classroom_capacity`) |
| E-14 | Une UE peut figurer dans plusieurs semestres d'une classe (résolution ambiguë par ordre alphabétique du libellé) | SE:1207-1219 | **Écartée** : un nœud n'a qu'un parent (Q-18) | DB (`parent_id`) |
| E-15 | Prix figé à l'ajout, montant commande = Σ prix figés | SE:839 | **Hors module -> 014** : la ligne de facture issue de `…requested` fige le prix | finance |
| E-16 | Un panier `brouillon` par étudiant ; vider le panier = annulation sans trace | MIG/0061:105 | **Hors module -> 014** pour le panier ; côté academic : `cancelEnrollmentCourse` avec trace | finance + `enrollment_history` |
| E-17 | Annulation après validation réservée à l'admin | INV-P §9.5 | **Reproduite** : `cancelEnrollment` exige `enrollment.cancel` | RBAC |

### 3.3 Prérequis

| ID | Règle legacy | Source | Traitement v2 | Garantie |
|---|---|---|---|---|
| PQ-1 | Logique ET (tous les prérequis) | SE:92-102 | **Reproduite** (R10) | UC `getNodePrerequisiteStatus` |
| PQ-2 | Pas d'auto-référence, **pas de cycle** (DFS) | SU:164-187 | **Reproduite et renforcée** : trigger récursif (profondeur 32) | DB (`curriculum_prerequisites_guard`) + DFS |
| PQ-3 | **Même classe** (`UE_PREREQ_NOT_SAME_FILIERE`) | SU:528-582 | **Assouplie** : même établissement ; programmes et niveaux différents admis (R10). Écart volontaire : permet L1 -> L2 | DB (existence de la lignée dans l'établissement) |
| PQ-4 | « Validé » = `student_professional_ue_results.statut = 'validee'`, toutes cohortes et classes confondues, sans péremption | SE:209, 252 | **Reproduite** via `CompletionLookup.hasValidated(student, lineage)` ; défaut : sélection `COMPLETED` ; pas de péremption (à confirmer) | PORT 011/019 |
| PQ-5 | Évaluation directe des prérequis immédiats (non transitive) | SE:96 | **Reproduite** | UC |
| PQ-6 | `PUT` remplace tout (DELETE + INSERT, transaction) | SU:528-582 | **Reproduite** (`setNodePrerequisites`) | UC |
| PQ-7 | Prérequis sans verrou une fois les cohortes ouvertes | SU:528 | **Partiellement corrigée** : le curriculum `LOCKED`/`ARCHIVED` est gelé ; sur `PUBLISHED` le trigger de prérequis n'interdit rien et le journal d'amendements n'a pas de `kind` dédié (Q-09) | DB (partiel) |
| PQ-8 | Ré-inscription = perte de prérequis (upsert unique `(UE, étudiant)` écrase la validation) | INV-P §7.1 bug 14 | **Corrigée** : résultats rattachés à l'`enrollment_id`/la lignée (011/019), jamais d'upsert global ; `COMPLETED` d'une sélection est définitif | PORT + DB (`enrollment_courses` `COMPLETED` terminal) |

### 3.4 Porte d'entrée et statuts d'inscription

| ID | Règle legacy | Source | Traitement v2 | Garantie |
|---|---|---|---|---|
| G-01 | L'inscription naît `en_attente_paiement` | SE:636, 839, 924 | **Reproduite** : naît `PENDING`, sauf politique `AUTO` (naît `ACTIVE`) | UC (politique) |
| G-02 | `confirmee` seulement si frais d'inscription de (étudiant, classe) soldés (écart <= 0,5) ou inexistants ; évaluée à la création ET à chaque encaissement | GATE:38-87 | **Reproduite par politique** `ON_REGISTRATION_FEE_PAID` : à la création (si finance signale « aucun frais ») et à `finance.invoice.paid`. La **tolérance de solde** et la notion de « soldé » restent chez finance | UC + événement ; AC5.5 |
| G-03 | `confirmer…` confirme TOUTES les inscriptions en attente du lot (étudiant x classe) | GATE:69-87 | **Reproduite au niveau du lot** (= `enrollments`) mais jamais au-delà (D2). Cascade vers les sélections `PENDING` du lot : Q-02 | UC |
| G-04 | Seuls `confirmee`/`terminee` ouvrent présences, notes, conduite, bulletins, attestations, diplômes (`INSCRIPTION_STATUTS_SCOLARITE`, redéfini en littéral dans de nombreuses requêtes) | GATE:26 | **Reproduite** (R25, AC5.6) : `ACTIVE`/`COMPLETED` (inscription), `CONFIRMED`/`COMPLETED` (sélection) ; ensemble défini une seule fois dans le domaine et exposé par `getRoster` / `listNodesForEnrollment` | UC + lint |
| G-05 | `PATCH` du statut sans machine à états ; `confirmee` -> commande `payee` sans paiement | SE:1388 | **Corrigée** : matrice `PENDING -> ACTIVE\|CANCELLED\|WITHDRAWN`, `ACTIVE -> SUSPENDED\|COMPLETED\|WITHDRAWN\|TRANSFERRED_OUT\|CANCELLED`, `SUSPENDED -> ACTIVE\|WITHDRAWN\|TRANSFERRED_OUT`, `COMPLETED -> ACTIVE` (réouverture auditée) ; aucun effet financier (AC4.4) | DB (`enrollments_guard`) |
| G-06 | Suppression physique d'une inscription avec cascade sur les paiements | SE:1418 | **Écartée** : jamais de suppression | DB (`enrollments_no_delete`) |
| G-07 | Auto-inscription directe qui n'appelle pas la porte | SE:924 | **Corrigée** : chemin unique | UC |
| G-08 | Confirmation d'une sélection : légacy = confirmation du lot par les frais d'**inscription**, indépendamment du prix de l'UE | GATE:69-87 | À trancher : par facture de la sélection ou par la confirmation de l'inscription (Q-02) | à acter |

### 3.5 Cohortes / offres, ouverture de classe, clôture

| ID | Règle legacy | Source | Traitement v2 | Garantie |
|---|---|---|---|---|
| O-01 | Machine d'états de cohorte `brouillon -> {ouvert, annule}` ; `ouvert -> {brouillon, termine, annule}` ; `complet -> {ouvert, termine, annule}` ; `en_cours -> {termine, annule}` ; `termine`/`annule` terminaux | SU:35-45 | **Reproduite** + `IN_PROGRESS` effectif + `ouvert -> complet` automatique | DB (`classroom_offerings_guard`) |
| O-02 | Passage à `ouvert` exige un enseignant par ECUE obligatoire non-Conduite (`SESSION_ECUE_TEACHERS_MISSING`), mais la création directe et `by-semestre` naissent `ouvert` sans garde | SU:749-771, 606 | **Reproduite et étendue à tous les chemins** (AC3.4) | UC + PORT `OfferingReadinessGuard` (009) |
| O-03 | Auto-finalisation `date_fin < CURRENT_DATE` (à la lecture) | SU:839-845 | **Corrigée** (D3) | job `finalizeEndedOfferings` |
| O-04 | Dates et fenêtre cohérentes (CHECK 23514 -> 500 sur `by-semestre`) | CT:196-204, 262-287 | **Corrigée** : Zod + CHECK + `422` | UC + DB |
| O-05 | Aucune unicité (UE, libellé) : doublons à l'identique possibles | MIG/0069:139-161 | **Corrigée** : `UNIQUE (classe, nœud)` ; `openOfferingsForPeriod` idempotent (AC3.2) | DB |
| O-06 | « Rouvrir un lot » force `ouvert` depuis `annule`/`termine` | SU:808-828 | **Écartée** en l'état (états terminaux) -> Q-04 | DB (matrice) |
| O-07 | Le « nom de classe » est un préfixe de libellé (`split_part(libelle, ' — ', 1)`) + portée `professional_classe_noms` | SS:370 | **Remplacée** par `classrooms.name` unique (R13) | DB (`UNIQUE (… name)`) |
| O-08 | Une seule cohorte-enseignant par (cohorte, ECUE) ; `enseignant_id` de cohorte lu en cascade | MIG/0070 ; SU:119-123 | **Hors module -> 009** | people |
| O-09 | Clôture des NOTES (cohortes `termine`) distincte de la clôture des BULLETINS (`bulletins_clotures_at`) ; ordre voulu : notes -> bulletins -> clôture bulletins | INV-P §3.4 ; MIG/0115:24-32 | **Reproduite en deux temps** : `GRADING_CLOSED` puis `CLOSED` (R3), **par classe** (D4) ; réouverture d'un pas motivée (nouveau) | DB (`academic_periods_guard`) |
| O-10 | Réouverture d'un semestre clôturé : aucune route (SQL manuel) | GUARD:60-66 | **Ajoutée** (`reopenPeriod`, sensible) | UC + audit |
| O-11 | `deleteSemestre` détruit les bulletins clôturés ; `deleteUe` détruit cohortes/séances/notes | SS:640 ; SU:355 | **Corrigée** : aucune cascade inter-modules ; suppression seulement en `DRAFT` | DB + `CurriculumUsageGuard` |
| O-12 | Seules les cohortes `ouvert` sont planifiables | SP:167 | **Hors module -> 017** | scheduling |

### 3.6 Année, périodes, pivot

| ID | Règle legacy | Source | Traitement v2 | Garantie |
|---|---|---|---|---|
| Y-01 | Années sans chevauchement et sans trou | MIG/0118 | **Reproduite et rendue invariante** (R1) | DB (`EXCLUDE`) + UC + `find_year_gaps()` |
| Y-02 | Une seule année active par tenant | MIG/0005:45 | **Corrigée** : une courante par **établissement** | DB (index partiel) |
| Y-03 | Pivot 1er septembre (mois >= 9), dupliqué 7 x TS et >= 8 x SQL, fuseau serveur | professional-annee-scolaire.ts:11 | **Écartée** : l'année est une entité (R1) ; lint AC1.6 | `academic_years` |
| Y-04 | Année = 12 mois pleins | MIG/0118:44-49 | **Valeur par défaut** (`ends_on = starts_on + 1 an - 1 jour`), non imposée | UC |
| Y-05 | Année pro = année de `date_debut` de la 1re cohorte (aucune table) | owner-pulse.service.ts:108-113 | **Remplacée** par `classrooms.academic_year_id` explicite. La cohérence entre dates d'une offre et année de la classe n'est pas imposée par la base (Q-14) | UC (à compléter) |
| Y-06 | Période hors année, chevauchement, doublon de nom non contrôlés (`assertPeriodWithinYear` no-op) | RT/academic-years.ts:293-302 | **Corrigée** | DB (`academic_periods_guard`, `EXCLUDE`) |
| Y-07 | Deux notions non reliées de « semestre » (`academic_year_periods` avec dates / `professional_semestres` sans date) | INV-A §4.2 pt 5 | **Unifiées** : nœud `PERIOD` (structure) + `academic_periods` (calendrier), liés par (type, ordinal) | DB + UC `validateCurriculum` |
| Y-08 | Type de période (semestre / trimestre) déduit du texte du nom | semester-averages.ts:1105-1112 | **Écartée** : `period_type_code` + `ordinal` (donnée) | DB (FK `period_types`) |

### 3.7 Structure (curriculum)

| ID | Règle legacy | Source | Traitement v2 | Garantie |
|---|---|---|---|---|
| ST-01 | **Conduite** : UE + ECUE spéciales repérées par texte ; jamais d'enseignant, jamais inscrite, prix 0 imposé par script, notée par l'administration, exclue des stats mais comptée au bulletin (2 crédits) | INV-A §3 et §4.2 pt 7 | **Remplacée** par `is_transversal` (jamais offerte/achetée à la carte) ; « jamais d'enseignant » vérifié par 009 ; « jamais facturée » = pas de ligne de facture (014) ; « comptée au bulletin » = `listNodesForEnrollment` + RuleSet | DB (gardes) + PORT |
| ST-02 | Crédits : `nb_uv` (UE), `ecue.credits`, `ects_credits` (mort) ; invariant implicite Σ crédits ECUE = crédits UE | MIG/0083-0085 | **Unifiés** : `credits` sur UE et ECUE ; égalité contrôlée à la publication si le type la déclare | `validateCurriculum` |
| ST-03 | « 20 crédits par semestre » et « > 48 crédits pour passer » (`SEMESTRE_CREDITS_REQUIS`, `ANNEE_SUP_CREDITS`), dont le second est du code mort | bulletin-calc.ts:28-29, 198-205 | **Écartées du module** (R8 : aucune somme imposée) ; avertissement éventuel fourni par un RuleSet (Q-19) | RS |
| ST-04 | Catégorie d'UE `fondamentale / specialite / culture_generale` : regroupement d'affichage | MIG/0080:6-8 | **Reprise** en `category_code` (donnée de pack) | donnée |
| ST-05 | `coefficient` de liaison UE-ECUE stocké mais jamais utilisé (pondération par `ecue.credits`) | MIG/0069:102-112 | **Reprise comme donnée** ; l'usage (par coefficient, par crédits) est du RuleSet (R8) | RS |
| ST-06 | Code UE/ECUE unique par tenant, imposant des préfixes de classe | MIG/0069:94-97 | **Corrigée** : unique parmi les frères | DB (`curriculum_nodes_sibling_code`) |
| ST-07 | Hiérarchie cycle -> filière -> classe -> semestre -> UE -> ECUE codée en dur dans les tables | INV-A §4.1 | **Remplacée** par la grammaire `curriculum_node_types` (donnée) ; `LEVEL > [GROUP] > SUBJECT` pour primaire/secondaire | DB (`curriculum_nodes_guard`) |
| ST-08 | Cursus (Licence 1 -> 3) reconstruit par regex sur le nom | CG:28 | **Remplacé** par `program_grade_levels` + `next_grade_level_id` | DB |
| ST-09 | `domaine` dupliqué (`programmes` et `filieres`) ; trois domaines figés par suffixe de code (MIG/0082) | MIG/0082:14-30 | **Source unique** `programs.domain_code` ; valeurs = donnée de pack | donnée |
| ST-10 | Volumes horaires `cm/td/tp/vhh` en chaînes ; aucun volume en pro | INV-A §4.2 pt 12 | **Numériques** `hours_total/lecture/practical` (Q-11) | DB (CHECK) |
| ST-11 | Statuts de programme `draft/review/approved/active/archived`, seule `review -> approved` appliquée | RT/programmes.ts:789-795 | **Machine d'états complète** sur la version : `DRAFT -> PUBLISHED -> LOCKED -> ARCHIVED` (+ `PUBLISHED -> DRAFT`) ; `review` écarté (Q-20) | DB (`curriculum_versions_guard`) |
| ST-12 | Modifier crédits/coefficients après coup bouge les moyennes rétroactivement | A-123 | **Corrigée** : amendement motivé, journalisé, signalé aux moteurs de résultats | UC + `curriculum_amendments` |
| ST-13 | Tarif porté par l'UE (`prix`, `devise`) | MIG/0069:78 | **Hors module -> 014** | finance |

### 3.8 Matricule et numérotation

| ID | Règle legacy | Source | Traitement v2 | Garantie |
|---|---|---|---|---|
| M-01 | Format `IPAM-<CODE CLASSE nettoyé A-Z0-9, défaut XXX>-<NNNN>` (ex. `IPAM-L1GL-0001`, `IPAM-M1TL-0001`) | SE:116-137 ; MIG/0093 | **Reproduit par motif configurable** `{PREFIX}-{PROGRAM}-{STUDENT_SEQ:4}` (R23) ; préfixe `registration_number_prefix` (plus de `IPAM` en dur). Le jeton `{PROGRAM}` est le code du **programme** : le **niveau** (L1, M2) qui faisait partie du code de classe n'a pas de jeton (Q-03) | `institution_settings` |
| M-02 | `NNNN` = `student_profiles.sequence_number`, figé par tenant, jamais recalculé (trigger `assign_student_sequence_number`, verrou advisory) | MIG/0094:22-98 | **Reproduit** via `StudentDirectory.getStudent().sequenceNumber` (008, `people.next_number`) | PORT |
| M-03 | Attribué idempotemment (`ON CONFLICT DO NOTHING`) à la 1re mise au panier / inscription ; `UNIQUE (étudiant, classe)` et `UNIQUE (classe, seq)` | MIG/0086:17 | **Reproduit** (R23) ; l'unicité DB est `UNIQUE (établissement, registration_number)` sur `enrollments` : voir le conflit possible à la ré-inscription (Q-03) | DB + UC |
| M-04 | Le matricule est attribué **avant** le test de doublon et persisté même si l'inscription échoue (`withTenantTx` COMMIT sur `fail`) | S-070 (INV-S) | **Corrigé** : généré dans la même transaction que l'inscription | UC |
| M-05 | Un matricule par (étudiant, classe) à vie | MIG/0086 | **Modifié** : un numéro par inscription annuelle (`enrollments`) ; reprise du numéro précédent via `previous_enrollment_id` à trancher (Q-03) ; reprise des matricules existants (INV-P §9.9) en tension avec D8 (Q-17) | UC |
| M-06 | Le bulletin lit `sp.student_number` au lieu du matricule pro (incohérence d'affichage) | bulletin.service:1231 | **Corrigée** : 013 lit `registration_number` (champ à exposer par `getEnrollment`, absent de `EnrollmentDirectory` : Q-16) | PORT |

### 3.9 Bugs et dettes listés dans les inventaires -> comment la cible les évite

**INV-P §7.1 (bugs probables, 19 entrées)**

| N° | Bug / dette | Réf. | Évité par |
|---|---|---|---|
| 1 | Dernière place -> panier bloqué | SE:911, 1086 | D1 (UC éligibilité + trigger) |
| 2 | Commande de panier sans `programme_id` (invisible des lots, porte d'entrée sur toutes les classes, lot jamais confirmé) | SE:476-481 | D2 ; une inscription = (apprenant, classe, année) : le « lot » est l'`enrollments` lui-même, `groupKey = classroomId` (014) |
| 3 | `studentSelfEnroll` n'appelle pas la porte d'entrée | SE:924-1014 | chemin unique `addEnrollmentCourse` + politique de confirmation |
| 4 | `studentSelfEnroll` contourne prérequis, fenêtre, statut `ouvert` ; `adminEnrollStudent` n'a aucun contrôle (capacité dépassable, cohorte annulée, Conduite facturable) | SE:636, 924 | mêmes contrôles pour tous les chemins ; capacité par trigger ; `is_transversal` par trigger (dérogations admin : Q-01) |
| 5 | `PATCH /enrollments/:id` : pas de machine à états, `confirmee` -> `payee` sans paiement, réactivation -> 23505 -> 500 | SE:1388 | machine d'états en base ; aucun effet financier ; codes `academic.*` |
| 6 | `DELETE /enrollments/:id` supprime paiements en cascade | MIG/0061:141 | pas de suppression (`enrollments_no_delete`) |
| 7 | Panier = siège réservé sans expiration | SE:839 | `hold_expires_at`, `pending_hold_minutes`, job `expirePendingHolds` |
| 8 | Course sur `uniq_prof_order_cart` (2 onglets) -> 500 | SE:461-490 | panier = finance ; côté academic l'index unique partiel donne `academic.duplicate_enrollment` (spec §13) |
| 9 | `GET /ue-sessions` écrit | SU:839 | D3 |
| 10 | `cloturerSemestre` ferme aussi `brouillon` et toutes les cohortes de l'UE | SS:630-631 | D4 |
| 11 | `reopenSessions` : fenêtre `23:59:59` heure serveur, `fermee < ouverte`, remet `ouvert` une cohorte annulée | SU:808-828 | dates civiles, 422, matrice d'états (Q-04 pour le besoin) |
| 12 | `createSessionsBySemestre` : 500 sur CHECK, pas d'anti-doublon, `ouvert` sans garde enseignants, `UE.statut` ignoré | SS:495-602 | A-177 : idempotence (`UNIQUE`), 422, `OfferingReadinessGuard`, nœud `INACTIVE` refusé |
| 13 | Garde de clôture incomplet (inscription, override de validation, appel, `updateSemestre`, `deleteSemestre`) | GUARD ; INV-P §7.1 | P-087 ; reste à trancher pour l'inscription dans une période close (Q-15) |
| 14 | Ré-inscription = perte de prérequis ; réinscription possible à une UE validée ; plusieurs cohortes simultanées d'une même UE | results.service:337-406 | PQ-8 ; AC5.7 |
| 15 | Compensation `scolarite` périmée (rejouée seulement à l'inscription directe) | SE:511 | hors module -> 014 (recalcul sur événements) |
| 16 | Bulletin lit `student_number` au lieu du matricule pro | bulletin.service:1231 | M-06 |
| 17 | `deactivateUe` / `deactivateEcue` sans route | SU:343 ; SC:188 | `status INACTIVE` via la mise à jour |
| 18 | JSDoc / contrats / docs 028 périmés (`CT:221-224`, `CT:332`, `docs/module-professionnel-*.md`) | INV-P §8 | la spec 004 fait foi ; les docs 028 sont obsolètes (modèle matières/sessions supprimé par MIG 0069) |
| 19 | Couverture de tests partielle (logique pure uniquement) | INV-P §7.1 | golden 2.0 + 28 comportements de `data-model.md` + concurrence 200/100 + isolation générique |

**INV-A §5 et §0 (anomalies transverses)**

| N° | Anomalie | Évitée par |
|---|---|---|
| A-1 | Structure encodée dans des chaînes (nom de classe `LICENCE n …`, libellé de cohorte `{nom} — {UE}`, nom de période `SEMESTRE 2`, nom BTS, Conduite par `ILIKE`) | colonnes typées : `grade_levels`, `classrooms.name`, `period_type_code` + `ordinal`, `is_transversal` ; lint AC1.6 |
| A-2 | Année scolaire non modélisée côté pro, modélisée côté scolaire avec règles incompatibles | entité unique `academic_years` + `EXCLUDE` |
| A-3 | Jointures cassées par défaut : cours orphelins invisibles, `class_courses` ignorée, `semestre_ids UUID[]` sans FK | FK composites, grammaire, une seule source des matières d'une classe |
| A-4 | Doubles sources : `domaine` x2, `cycle_id` redondant dans `cycles_frais`, `nb_uv` vs crédits ECUE, `ects_credits`, `semestre_sessions` vs `semestre_ue`, `enseignant_id` de cohorte vs affectation par ECUE | une source par fait (voir §1) |
| A-5 | Suppressions dangereuses (semestre -> bulletins, UE -> cohortes, période -> notes, année active, programme avec UE -> 500) | aucune suppression physique des entités métier ; états |
| A-6 | GET avec effet de bord, fuites de transaction (`return` avant `ROLLBACK`), injection SQL par clés de body, contrats Zod non branchés, `console.log` en production | `TenantDb` transactionnel, Zod `strict`, lint, test d'architecture ; l'injection SQL relève de 017 (salles, réservations) |
| A-7 | Seeds mêlés aux migrations (UUID de tenant en dur, slug `imhotepacademy`, data-fix par code de classe), scripts destructifs | modèles de pack (`instantiatePackReferenceData`), seeds déterministes séparés |
| A-8 | Deux pistes de migrations qui ne se recouvrent pas (`MIG` vs Prisma), `0005` non rejouable | un seul schéma v2 : migrations 0700-0704 rejouables de zéro |
| A-9 | RLS effective douteuse (GUC non posé, `set_config` hors transaction, rôle propriétaire) | `kernel.enable_tenant_rls` forcée + FK composites `(tenant_id, id)` + test d'isolation générique (24 tables, allowlist vide) |

---

## 4. Constantes et seuils codés en dur -> destination

Légende des destinations : **RuleSet** (012, version publiée) ; **pack** (donnée de modèle de pack, `tenancy/templates`) ; **établissement** (`institution_settings` ou configuration de l'établissement) ; **supprimée** ; **autre module** (avec spec).

| ID | Constante | Valeur legacy | Réf. | Destination |
|---|---|---|---|---|
| K-01 | Poids devoirs / examen d'une ECUE | 0,4 / 0,6 | bulletin-calc.ts:24-25 | RuleSet (012) |
| K-02 | Seuil de validation ECUE/UE | 10/20 (3 copies) | bulletin-calc.ts:26 ; CG:192,227 ; bulletin.service:1768 | RuleSet (012) |
| K-03 | Seuil éliminatoire, non compensable | 5/20 strict | bulletin-calc.ts:27, 101 | RuleSet (012) |
| K-04 | Crédits requis par semestre | 20 | bulletin-calc.ts:28, 198-200 | RuleSet (012) ; jamais une contrainte d'academic (R8) |
| K-05 | Passage en année supérieure | > 48 crédits (**code mort** : `peutPasserAnneeSuperieure` non appelée) | bulletin-calc.ts:29, 203-205 | RuleSet (012) ou supprimée |
| K-06 | Sessions LMD 1 (normale) / 2 (rattrapage, la S2 remplace la S1) | CHECK `session IN (1,2)` | MIG/0083_lmd:14-26 | pack : `period_types` `NORMAL_SESSION` / `MAKEUP_SESSION` (`kind EXAM_SESSION`) ; règle de remplacement -> RuleSet (012) / 011 |
| K-07 | Échelle de notes /20, `note_max` 20 | `NUMERIC(5,2)`, défaut 20 | MIG/0049:10 ; 0069:250 | RuleSet (012) / configuration 011 |
| K-08 | Mentions du bulletin scolaire | >= 16 Excellent … < 8 Insuffisant | semester-averages.ts:171-179 | RuleSet (012) |
| K-09 | Mentions du cursus pro (échelle **différente** de K-08) | < 10 … >= 18 | CG:268-273 | RuleSet (012) ; les deux échelles deviennent deux RuleSets |
| K-10 | Décision de conseil | >= 10 validée ; >= 8 renforcement ; sinon non validée | semester-averages.ts:181-186 | RuleSet (012) |
| K-11 | Décision de fin d'année / redoublement ; BTS 2 reconnu par regex sur le nom | >= 10 admis ; « Redouble en cas d'échec au BTS » | semester-averages.ts:188-207 | RuleSet (012) ; BTS 2 reconnu par `grade_levels.is_final` / code de niveau (`getRuleContext`) |
| K-12 | Moyenne annuelle | (S1 + 2 x S2) / 3 | semester-averages.ts:1151 | RuleSet (012) ; période par `period_type` + `ordinal` |
| K-13 | Distinctions et appréciations du conseil | >= 17 / 15 / 12 ; < 8 … >= 18 | semester-averages.ts:220-237 | RuleSet (012) / textes 013 |
| K-14 | Reconnaissance Semestre 1 / 2 par sous-chaîne du nom | « SEMESTRE 1 » / « DEUXIEME SEMESTRE » | semester-averages.ts:1105-1112 | supprimée (`period_type_code` + `ordinal`) |
| K-15 | Reconnaissance de la Conduite | `libelle ILIKE 'conduite%'` ou `code ILIKE '%EC-CON%'` (>= 12 emplacements) | SS:114, 574 ; SU:761, 1055, 1088 ; CG:191, 226 ; SE:275, 304, 438, 951 ; MIG/0123:53 | supprimée -> `curriculum_nodes.is_transversal` |
| K-16 | Pivot d'année scolaire | 1er septembre (mois >= 9 ; JS index >= 8) | professional-annee-scolaire.ts:11 ; owner-pro-annee.sql.ts:174-181 | supprimée (`academic_years`) |
| K-17 | Année = 12 mois pleins | `start + 1 an - 1 jour` | MIG/0118:44-49 | défaut de `createAcademicYear` (R1), non imposé |
| K-18 | Capacité par défaut d'une classe / d'une salle | 30 | classes.ts:770, 808 ; MIG/0005:57 ; 0009:42 | supprimée : `classrooms.capacity` nullable ; `capacity_is_hard` par établissement (Q-13) ; salle -> 017 |
| K-19 | Durée de cycle par défaut | 12 mois | cycles.ts:10 | supprimée |
| K-20 | Défauts de cours | `presential`, `hours_total = 1`, théorie/pratique 0, `status active` | courses.ts:8-11, 338 | supprimés |
| K-21 | Devise | `XOF` en dur | MIG/0014:13 ; 0005:100 ; 0069:86 ; cycle-fees.ts:13, 388 | autre module : devise du tenant / de l'établissement (014) ; academic ne porte aucun montant |
| K-22 | Format du code de classe auto | slug + `-` + 3 chiffres aléatoires | classes.ts:39-50 | supprimé : code explicite validé par regex |
| K-23 | Pagination | 20 / 100 (scolaire) ; 1000 (UE/ECUE) ; 500 (sessions, inscriptions) | divers | convention plateforme : `page` / `pageSize <= 200` |
| K-24 | Préfixe de matricule et nombre de chiffres | `IPAM` + 4 | SE:116, 119 | établissement : `registration_number_prefix` et `registration_number_pattern` (`{STUDENT_SEQ:4}`) |
| K-25 | Seuils analytiques (cohorte min 5, top échecs 15, risque < 10, limites 50 / 200) | divers | owner-pedagogie.service.ts:33, 36 ; owner-academic.service.ts:6 ; owner-referentiel.service.ts:29 ; owner-programme.service.ts:43 | autre module : 025 (configuration) |
| K-26 | Tarifs d'établissement (inscription 100 000, annexes 50 000, autres 0 XOF) | décision du 11/09/2026 | infra/scripts/seed-cycles-frais-tarifs.sql:21-26 | autre module : barèmes tenant (014), jamais en seed destructif |
| K-27 | Références `PRO-AAAA-NNNNNN`, `FRAIS-{student}-{programme}-{nature}`, `DIP-…`, `REL-…` | divers | SE:462, 569, 593 ; diplomas.service:339 ; bulletin.service:1871 | autres modules : 014 (factures), 019 (diplômes), 013 (relevés) |
| K-28 | Tolérance de solde | 0,5 (porte d'entrée), 0,001 (paiements) | GATE:57 ; MIG/0127:53 ; PAY | autre module : finance (014/015) ; jamais dans academic |
| K-29 | Statuts « ouvrant la scolarité » | `('confirmee','terminee')` exporté puis réécrit en littéral | GATE:26-29 ; CG:87 ; bulletin:1236 ; SU:144, 1169, 1545 ; SE:425, 1688 | une constante de domaine typée (`ACTIVE`/`COMPLETED`, `CONFIRMED`/`COMPLETED`) ; lint |
| K-30 | Séparateur du libellé de cohorte | `' — '` (tiret cadratin, `chr(8212)`) | SS:370 ; SE:1186, 1578 ; SU:1397, 1445 | supprimée (`classrooms.name`) |
| K-31 | Regex de grade (BTS, DUT, CERTIFICAT, BAC connus de MIG/0116 mais pas des cycle groups) | `LICENCE\|MASTER` | CG:28 ; MIG/0116:49, 73 | supprimée : cycles et niveaux = données de pack |
| K-32 | Rôles administrateurs (dupliqués) | `admin\|super_admin\|administrateur` | middlewares/professional-guards.ts:51 ; RTP:211 | supprimée : permissions RBAC (`requirePermission`) |
| K-33 | Catégories d'UE et leur ordre figé | `CAT_ORDER` : fondamentale, specialite, culture_generale | bulletin.service:1849 | pack (`category_code`, libellés, ordre) ; mise en page -> 013 |
| K-34 | Convention de codes UE / ECUE | `CLASSE-Sn-UEk`, `CLASSE-EC-XXX` | MIG/0083:16 | supprimée (code unique parmi les frères) |
| K-35 | Domaines figés par suffixe de code de classe | 3 domaines | MIG/0082:14-30 | pack (`domain_code`) |
| K-36 | Statut de cohorte `en_cours` « obsolète » | présent dans l'enum, retiré du flux | SU:27-33 | conservé comme `IN_PROGRESS` effectif (`start`) |
| K-37 | Racine des identifiants d'élèves (re-résolution à chaque service) | `student_profiles.id` != `users.id` | INV-P §7.2 | autre module : `StudentDirectory` (008) |
| K-38 | Durée de réservation d'une place | aucune (illimitée) | SE:839 | établissement : `pending_hold_minutes` (nouveau) |
| K-39 | Politique de confirmation d'inscription | codée : frais d'inscription soldés | GATE:38-87 | établissement : `enrollment_confirmation_policy` (`AUTO`, `ON_REGISTRATION_FEE_PAID`, `ON_FULL_PAYMENT`, `MANUAL`) |

---

## 5. Synthèse chiffrée

Chiffres produits par le script de contrôle `parity-check.mjs` (parse des tableaux de ce fichier ; 190 IDs attendus = 124 `A-xxx` + 66 `P-xxx`, chacun présent exactement une fois dans §2, 0 manquant, 0 doublon, 0 ID inconnu).

**§2 : lignes de tableau (une ligne peut regrouper plusieurs IDs)**

| Statut | Lignes | IDs couverts |
|---|---|---|
| conservé | 11 | 14 |
| amélioré | 80 | 103 |
| abandonné | 17 | 20 |
| hors module (014/015, 011/012/013/019, 017, 009, 025…) | 49 | 53 |
| **Total** | **157** | **190** |

Lecture : 117 IDs sur 190 (62 %) sont reproduits (conservés ou améliorés) dans academic ; 20 sont abandonnés avec justification ; 53 relèvent d'un autre module.

**§2 : lignes complémentaires hors totaux ci-dessus** (sans ID dans INV-A / INV-P ou hors périmètre ID)

| Nature | Lignes | Détail |
|---|---|---|
| Références croisées INV-S (S-060 à S-066, §2.10) | 7 | 5 améliorées, 2 abandonnées |
| Sections sans ID d'INV-A / INV-P (diplômes §2.7 d'INV-P, owner §2.18-a et §2.18-b d'INV-A) | 3 | 1 améliorée, 2 hors module (019 / 013, 025) |

**§1 : tables (44 lignes)** : 19 améliorées (dont T-02 éclatée et T-28 promue en entité), 7 abandonnées (T-08, T-16 `course_assignments`/`teaching_hours`, T-27, T-31, P§1.10, P§1.12 data-fix, P§1.12 scripts), 18 hors module (T-09, T-10, T-11, T-12, T-13, T-14, T-15, T-16 `teacher_assignments`, T-29, T-30 x 6 lignes, P§1.7, P§1.8, P§1.12 `cycles_frais`, selon le détail du tableau). Aucune table « conservée » telle quelle : toute table legacy est soit transformée, soit supprimée, soit renvoyée.

**§3 / §4** : 4 divergences assumées (D1-D4), 17 règles d'éligibilité/capacité (E-01 à E-17), 8 de prérequis (PQ-1 à PQ-8), 8 de porte d'entrée (G-01 à G-08), 12 de cohortes/clôture (O-01 à O-12), 8 d'année (Y-01 à Y-08), 13 de structure (ST-01 à ST-13), 6 de matricule (M-01 à M-06), 19 + 9 bugs/anomalies, 39 constantes (K-01 à K-39 : K-01 à K-13 vers RuleSet ; K-06, K-33 et K-35 aussi en donnée de pack ; K-24, K-38 et K-39 en configuration d'établissement ; K-14 à K-16, K-19 à K-20, K-22, K-30 à K-32 et K-34 supprimées ; K-21, K-25 à K-28 et K-37 vers d'autres modules).

---

## 6. Points à trancher par le concepteur (écarts brief / legacy / DDL / spec)

Ces points sont des **écarts ou trous constatés** en croisant les inventaires, le brief, le DDL 0700-0704 et `spec.md`. Chaque entrée porte l'identifiant `Q-nn` référencé plus haut ; ils sont à reprendre dans `open-questions.md`.

| ID | Sujet | Constat | Décision attendue |
|---|---|---|---|
| Q-01 | Dérogations de l'administrateur (P-050) | Le legacy ne contrôlait rien à l'inscription admin (statut, fenêtre, prérequis, UE inactive) ; la spec veut les mêmes contrôles pour tous. La capacité ne peut plus être dépassée par personne (trigger). | Une dérogation motivée (fenêtre, prérequis, statut) avec permission dédiée ? Ou aucune ? |
| Q-02 | Niveau de confirmation | Legacy : les frais d'**inscription** soldés confirment toutes les lignes UE du lot, même si le prix de l'UE n'est pas payé. Spec : `finance.invoice.paid` confirme « l'inscription visée » ; `7.4(b)` rappelle des `sourceRef` = sélection. Non dit : une politique `ON_REGISTRATION_FEE_PAID` fait-elle passer les sélections `PENDING` du lot en `CONFIRMED` ? Et que signifie `ON_FULL_PAYMENT` pour une sélection ? | Préciser cascade inscription -> sélections et correspondance politique / facture. |
| Q-03 | Numéro d'inscription | (a) `enrollments_registration_number` est unique par (établissement, numéro) alors que R23 le veut idempotent : un redoublant ou un étudiant ré-inscrit au même programme l'année suivante reçoit le même numéro et viole l'index ; (b) le motif n'a pas de jeton **niveau** : le legacy `IPAM-L1GL-0001` / `IPAM-M1TL-0001` devient `PREFIX-GL-0001` pour tous les niveaux ; (c) legacy : un matricule par (étudiant, classe) à vie, v2 : par inscription annuelle. | Reprendre le numéro via `previous_enrollment_id` (index à adapter) ou registre dédié ; ajouter `{LEVEL}` / `{GRADE}`. |
| Q-04 | Réouverture d'offre | `UNIQUE (classe, nœud)` + états `COMPLETED` / `CANCELLED` terminaux interdisent à la fois de rouvrir (P-017 / A-167) et de recréer l'offre dans la même classe. | Autoriser `COMPLETED -> OPEN` / `CANCELLED -> DRAFT` motivés, ou rendre l'unicité partielle (`WHERE status <> 'CANCELLED'`). |
| Q-05 | Périmètre de `finalizeEndedOfferings` et lien clôture de période / offres | Spec : `IN_PROGRESS -> COMPLETED` à `ends_on`. Mais une offre jamais « démarrée » reste `OPEN`/`FULL` ; une offre `DRAFT` échue ? Le legacy fermait les cohortes à la clôture du semestre (P-037) ; en v2 la clôture de notes d'une classe ne touche pas les offres. Fuseau de l'établissement pour « aujourd'hui ». | Définir les transitions du job (OPEN/FULL -> COMPLETED ? DRAFT échue -> CANCELLED ?) et l'effet éventuel de `closePeriod` sur les offres. |
| Q-06 | Fenêtre d'inscription NULL | Legacy : fenêtre `NOT NULL`. DDL : les deux bornes nullables ensemble. Aucune règle ne dit que « sans fenêtre » = ouvert sans restriction de date. | Acter le sens (recommandé : aucune restriction) ou imposer `NOT NULL` pour l'inscription à la carte. |
| Q-07 | Classe `ACTIVE` sans curriculum | AC3.1 exige une version `PUBLISHED` pour activer ; `classrooms_guard` ne teste ce statut que si `curriculum_version_id` n'est pas NULL : une classe `ACTIVE` sans version passe. | Ajouter le contrôle en base (ou limiter à `kind` concerné). |
| Q-08 | `classroom_period_states` | Aucun contrôle en base que la période appartient à l'année de la classe (A-110 le faisait en application) ni de trigger de transition ; la règle `max(période, classe)` empêche de rouvrir **une seule** classe si la période est déjà `CLOSED` globalement. | Trigger d'année + de transition ; préciser la réouverture par classe après clôture globale. |
| Q-09 | Prérequis d'un curriculum publié | Le trigger ne bloque que `LOCKED`/`ARCHIVED` : on peut modifier les prérequis d'une version `PUBLISHED` sans amendement ; `curriculum_amendments.kind` n'a pas de valeur `PREREQUISITE`. | Considérer les prérequis comme structurels (amendement) ou ajouter un `kind`. |
| Q-10 | Revalidation au checkout et expiration | Le legacy revérifie l'éligibilité à la validation du panier (P-066). La spec ne dit pas qui rappelle `checkOfferingEligibility` au moment de la facture, ni ce qui se passe si `finance.invoice.paid` arrive pour une sélection déjà `CANCELLED` (`hold_expired`). | Prolongation de réservation à la facturation ? Re-confirmation sous réserve de place + remboursement signalé ? |
| Q-11 | Volumes horaires | Legacy : `cm`, `td`, `tp`, `vhh`. DDL : `hours_total`, `hours_lecture`, `hours_practical` (pas de colonne TD). | Ajouter `hours_tutorial` ou ranger TD dans `attributes`. |
| Q-12 | Cycles : `type`, `duration_months`, `certification_level` | Non repris (`education_levels` n'a que `pack`). `programs.kind_code` pourrait porter « professionnel / court / certification ». | Confirmer l'abandon ou mapper vers `kind_code` / donnée de pack. |
| Q-13 | Capacité de classe | Legacy : capacité 30 appliquée à la création unitaire (409). DDL : `capacity_is_hard` par défaut `false` (indicative). | Défaut `true` pour les packs Primary/Secondary ? Valeur des modèles de pack. |
| Q-14 | Dates d'offre vs année / période | Rien n'impose que `starts_on`/`ends_on` d'une offre tiennent dans l'année de la classe ni dans la période du nœud `PERIOD`. | Contrôle en base ou en cas d'usage ; effet sur le job de finalisation. |
| Q-15 | Inscription dans une période close | Le legacy ne verrouillait pas l'inscription (P-087). L'ordre d'éligibilité de la spec (AC5.1) ne contient pas l'état de période. | Ajouter un contrôle (offre dont la période est `CLOSED` pour la classe) ? |
| Q-16 | Matricule : module propriétaire et exposition | Brief : « matricule IPAM facturation -> finance » ; DDL / spec : `registration_number` dans `academic.enrollments`. De plus `EnrollmentDirectory` ne renvoie pas le numéro alors que 013 en a besoin (bug 16 : le bulletin lit `student_number`). | Confirmer le propriétaire (academic) et exposer le numéro via `getEnrollment`. |
| Q-17 | Reprise des matricules existants | INV-P §9.9 demande la reprise ; D8 du plan dit « aucune donnée de production ». | Import 031 avec numéro explicite, ou aucune reprise. |
| Q-18 | UE dans plusieurs semestres | Possible en legacy (aucune contrainte), impossible en v2 (un seul parent). | Confirmer qu'aucun tenant ne l'utilise ; sinon dupliquer les nœuds (lignées distinctes) et traiter les prérequis. |
| Q-19 | « 20 crédits par semestre » | Invariant implicite du legacy (data-fix 0083-0085), refusé par R8 dans academic. | `validateCurriculum` peut-il émettre un `WARN` à partir d'un seuil fourni par un RuleSet ? |
| Q-20 | Étape `review` des programmes | Legacy : `draft -> review -> approved`. v2 : `DRAFT -> PUBLISHED` direct. | Besoin d'un double regard (état supplémentaire ou 4-yeux sur `curriculum.publish`) ? |
| Q-21 | Matières transversales | `is_transversal` interdit offre et achat ; « jamais d'enseignant » n'est vérifiable que par 009 (aucune FK inter-schémas) ; la Conduite est **comptée** au bulletin (legacy), donc doit rester dans `listNodesForEnrollment` pour la notation mais pas dans le catalogue. | Fixer le contrat de `listNodesForEnrollment` / `/catalog` pour les nœuds transversaux, et le contrôle côté 009. |
| Q-22 | Qui crée l'inscription `A_LA_CARTE` ? | Les sélections exigent une inscription parente par classe (trigger : l'offre doit appartenir à la classe de l'inscription). Le catalogue pro du legacy montre toutes les cohortes de la filière : l'étudiant devra choisir une **classe** ; création implicite de l'inscription au premier panier ? Les étudiants pro n'avaient aucune `student_enrollments`. | Décrire le parcours self-service (création implicite, statut initial, politique de confirmation). |
| Q-23 | Les « 4 divergences assumées » | `spec.md` (§12, §15) les annonce sans les nommer. | Valider D1-D4 de §3.1 ou en désigner d'autres (prérequis perdus par ré-inscription, bug 14 ?). |
| Q-24 | Capacité modifiée sous le nombre de places réservées | Legacy : aucun contrôle (P-014). Cible proposée : refus + resynchronisation `FULL`/`OPEN`. | Acter. |
| Q-25 | Passage à `FULL` | Le brief et le DDL parlent de « déclencheur + cas d'usage » ; 0704 ne contient que des trigger de **refus** (aucun trigger ne pose `FULL`). | Confirmer que `FULL`/`OPEN` est posé uniquement par le cas d'usage (et que les chemins hors cas d'usage n'existent pas). |
| Q-26 | Doublon inter-inscriptions | AC5.7 (« deux offres simultanées du même nœud pour le même apprenant ») n'a pas d'index : deux inscriptions de deux classes d'un même programme partagent les mêmes nœuds. | Contrôle de cas d'usage uniquement, ou index de lecture + test de concurrence. |
| Q-27 | Rubriques de bulletin (`bilan_types`) | Les cours scolaires étaient classés par `bilan_type_id` obligatoire ; en v2 seul `category_code` (optionnel) existe côté nœud. | Dire si les rubriques de bulletin scolaire sont des `category_code` du pack ou un gabarit 013. |

---

## 7. Suite donnée aux points à trancher

Statut après arbitrage. « Tranché » renvoie à `spec.md` (AC/R), à `data-model.md` (DDL testé) ou à `open-questions.md` (décision `D-nn`, question métier `O-nn`).

| ID | Suite donnée | Référence |
|---|---|---|
| Q-01 | Tranché : dérogation motivée et tracée, permission dédiée `academic.enrollment.override` ; sans elle, l'administrateur subit les mêmes contrôles que tous. La capacité reste dure pour tous (déclencheur). | spec AC5.1, R4 |
| Q-02 | Tranché : confirmation à deux niveaux. `finance.invoice.paid` confirme **l'inscription visée** (politique `ON_REGISTRATION_FEE_PAID` / `ON_FULL_PAYMENT`) mais ne confirme plus en bloc les sélections ; une sélection est confirmée par sa propre ligne de facture (`ON_LINE_PAID`). | D-10, spec AC5.5, O-01 |
| Q-03 | Tranché : registre `registration_numbers` (un numéro par apprenant, programme, niveau, stable aux réinscriptions) ; jetons de motif distincts, dont le niveau. | D-18, spec R23, O-13 |
| Q-04 | Tranché : `reopenOffering` (COMPLETED vers OPEN/IN_PROGRESS, CANCELLED vers DRAFT), motivé, avec garde en base. | spec AC3.5, DDL 0703 |
| Q-05 | Tranché : le job ne traite que les offres `OPEN`/`FULL`/`IN_PROGRESS` échues ; `DRAFT` et `CANCELLED` exclues ; fuseau de l'établissement ; la clôture de période n'agit pas sur les offres. | spec AC3.5, D-24 |
| Q-06 | Tranché : fenêtre facultative ; sans fenêtre, l'offre est inscriptible tant qu'elle est `OPEN`. | spec AC5.1 |
| Q-07 | Tranché : une classe `ACTIVE` exige une version de curriculum, contrôlé en base. | DDL 0703 |
| Q-08 | Tranché : garde d'appartenance à l'année et de transition ; l'état effectif est l'état explicite de la classe, sinon celui de la période. | DDL 0704 (`effective_period_status`), D-07 |
| Q-09 | Tranché : les prérequis d'une version publiée sont structurels ; modification par amendement de nature `PREREQUISITE`. | DDL 0702 |
| Q-10 | Tranché : la validation finale rappelle `checkOfferingEligibility` ; la réservation expirée est annulée (`hold_expired`) et finance est informée par l'événement `expired` ; durée de réservation configurable. | spec AC5.2, AC5.4, D-09, O-17 |
| Q-11 | Tranché : colonne `hours_tutorial` ajoutée (cours, TD, TP). | DDL 0702 |
| Q-12 | Tranché : `duration_months` et `attributes` ajoutés au programme ; le type de cycle est porté par `kind_code` (donnée de pack). | DDL 0702 |
| Q-13 | Tranché : `capacity_is_hard` vaut `true` par défaut. | D-08 |
| Q-14 | Tranché : garde en base (dates d'offre dans l'année de la classe). | DDL 0703 |
| Q-15 | Tranché : contrôle `academic.period_closed` ajouté à l'ordre d'éligibilité. | spec AC5.1 |
| Q-16 | Tranché : `academic` est propriétaire du numéro ; `EnrollmentDirectory.getEnrollment` l'expose (`registrationNumber`), demande transmise à finance. | spec §interfaces, D-18 |
| Q-17 | Tranché : aucune reprise de données de production (D8 du plan) ; import éventuel par 031 avec numéro explicite. | B-11 |
| Q-18 | Question métier ouverte : une UE n'a qu'un parent ; dupliquer le nœud si besoin (lignées distinctes). | O-11 |
| Q-19 | Tranché : aucune somme de crédits imposée par le module ; le seuil par semestre est un paramètre de RuleSet. | spec R8, O-18 |
| Q-20 | Tranché : pas d'état `review` ; un double regard éventuel relève d'une exigence sur la permission sensible de publication. | D-06 |
| Q-21 | Tranché : `listNodesForEnrollment` inclut les nœuds transversaux (`isTransversal = true`) pour la notation ; catalogue et offres les excluent ; le contrôle « jamais d'enseignant » est porté par 009. | spec AC2.7, §12 |
| Q-22 | Tranché : `selfEnrollToOffering` crée ou réutilise l'inscription `A_LA_CARTE` de l'apprenant dans la classe de l'offre. | spec AC5.1c |
| Q-23 | Tranché : les quatre divergences sont nommées D1 à D4 dans la spec. | spec §12 |
| Q-24 | Tranché : refus de réduire la capacité sous les places réservées ; resynchronisation `FULL`/`OPEN`. | DDL 0704 |
| Q-25 | Tranché : `FULL`/`OPEN` posés par déclencheur de base (`sync_offering_fullness`). | D-08 |
| Q-26 | Tranché : contrôle de doublon au cas d'usage, renforcé par la garde « même nœud, même année » sur les sélections. | DDL 0704 |
| Q-27 | Tranché : les rubriques de bulletin sont des `category_code` de pack ; le gabarit de bulletin relève de 013. | spec §12 |
