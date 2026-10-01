# Parité legacy -> v2 — Spec 008 « students-guardians » (module `people`, volet élèves et tuteurs)

> Statut : brouillon de conception, rédigé le 2026-10-01. Document de travail de la spec 008 ; il alimente `spec.md`, `data-model.md` et `contracts/`.

## 0. En-tête

### 0.1 Objet

Lister **exhaustivement** ce que le legacy EcoleDigitale fait aujourd'hui autour des élèves, des tuteurs/parents, des comptes liés, des inscriptions (vue élève), des matricules et des historiques, et dire pour chaque fonction, table, colonne et règle : **conservé**, **amélioré**, **abandonné** (avec justification) ou **hors module -> spec NNN**, avec la cible v2 (cas d'usage de `people/index.ts`, route, table).

Périmètre du module cible : `people` (schéma Postgres `people`, préfixe HTTP `/api/v1/people`, migrations 0800-0804). Cette spec (008) couvre les élèves et les tuteurs ; la spec 009 couvre le personnel (tables 0802/0803, non traitées ici). Les inscriptions, le curriculum, les classes sont dans `academic` (004) ; les comptes et rôles dans `iam` (002) ; les montants dans `finance` (014/015).

### 0.2 Sources

| Source | Usage |
|---|---|
| Brief de conception cible (`aca-brief.md`, section « Module people — 008 ») | Noms AUTORITAIRES : tables, cas d'usage, routes, événements, permissions. |
| DDL de référence `people/0800`, `0801`, `0804` (0802/0803 = spec 009) et `academic/0703` | Colonnes, contraintes, déclencheurs cibles (testés sur Postgres 17). |
| Inventaire legacy `legacy-students.md` (IDs S-001 à S-124, tables, matricules, dossier permanent, PII/dette) | Liste de référence : chaque ID S-xxx apparaît **une fois** en §2. |
| `legacy-pro-enrollment.md` (IDs P-xxx, matricule pro P-088, inscription pro) | Recoupement pour les inscriptions Professional et le matricule IPAM. |
| Code legacy du worktree (vérifications ponctuelles) | `apps/api/src/routes/students.ts` (2699 l.), `parents.ts` (1458), `registration-requests.ts` (813), `enrollments.ts` (1491), migrations 0003, 0030, 0042, 0059, 0060, 0079, 0081, 0086, 0088, 0093, 0094, 0099, 0120, 0124. Les 37 déclarations de routes de ces cinq fichiers (`students` 16, `parents` 7, `registration-requests` 6, `enrollments` 7, `users` 1) ont été recomptées : chacune correspond à un ID de l'inventaire. |
| `docs/PRD_EcoleDigitale_SaaS.md` §10 | « Un changement de classe ou d'année ne crée jamais un nouvel élève » ; contenu du dossier permanent. |

Abréviations de chemins (legacy) : `R/` = `apps/api/src/routes/` ; `S/` = `apps/api/src/services/` ; `M/` = `infra/scripts/migrations/` ; `P/` = `apps/api/prisma/migrations/20260403110000_baseline/migration.sql` ; `C/` = `packages/contracts/src/` ; `MW/` = `apps/api/src/middlewares/` ; `PL/` = `apps/api/src/plugins/` ; `SE` = `S/professional-enrollment.service.ts`. Références de la forme `fichier:ligne` ou `fichier:début-fin`.

### 0.3 Légende des statuts

| Statut | Sens |
|---|---|
| **conservé** | Reproduit à l'identique (règle ou donnée maintenue, éventuellement renommée). |
| **amélioré** | Reproduit avec une correction ou un enrichissement (bug corrigé, contrainte en base, audit, permission, configurable…). La colonne justification dit lequel. |
| **abandonné** | Non reproduit : code mort, insécurité, doublon, hors périmètre produit. Justification obligatoire. |
| **hors module -> NNN** | Relève d'un autre module/spec : 002 auth-rbac, 004 academic-core, 007 admissions, 010 attendance, 011 assessments-grades, 013 report-cards, 014 finance, 015 payments, 016 communications, 017 scheduling, 024 documents, 025 analytics, 030 security-audit, 031 imports, « hors plan » (prospection). La cible indique le cas d'usage ou la table qui l'accueille. |

### 0.4 Comment lire

- §1 : tables et colonnes legacy -> tables et colonnes v2. §2 : fonctions et endpoints, par famille ; **88 identifiants S-xxx** (l'inventaire parle de « S-001..S-124 » mais numérote avec des trous) + 4 lignes « SI-n » pour des éléments listés par l'inventaire sans ID (code mort, défauts du portail élève). §3 : règles implicites et défauts. §4 : PII. §5 : constantes. §6 : synthèse chiffrée. §7 : décisions et écarts à trancher (brief cible contre legacy contre DDL).
- Les cas d'usage cités sont ceux de `people/index.ts` du brief ; les routes sont relatives à `/api/v1/people` sauf mention contraire. Les permissions sont celles du brief : `student.{read,list,create,update,status.update,sensitive.read,self.read,child.read}`, `guardian.{read,manage}`, `people.settings.manage`.
- Principes de conception appliqués partout : (a) fin de « un parent = un utilisateur » ; (b) un seul générateur de matricule, immuable ; (c) le dossier permanent ne porte aucune donnée d'année ; (d) historique de statut avec motif et auteur, création historisée ; (e) aucune suppression physique ; (f) plus de mot de passe en clair, de rôle inféré, d'`x-user-id` ; (g) demandes d'inscription et provenance hors module ; (h) accès parent/enfant = règle de domaine `isGuardianOfStudent` + permissions `*.child.*` ; (i) détection de doublons sans fusion en v1 ; (j) PII sensibles derrière `student.sensitive.read`, fichiers via StoragePort/documents.

---

## 1. Tables legacy -> tables v2

Colonnes : table ou colonne legacy | migration:ligne | statut | cible v2 | justification.

### 1.1 Tables (vue d'ensemble)

| Table legacy | Migration:ligne | Statut | Cible v2 | Justification |
|---|---|---|---|---|
| `student_profiles` (fiche élève = « dossier permanent » de fait) | M/0003:9-28 ; 0042:5-9 ; 0079:7-9 ; 0081:10-18 ; 0088:25-44 ; 0094:22-57 ; P/:1634-1675 | amélioré | `people.persons` (identité) + `people.students` (dossier permanent) + `people.student_prior_education` + `people.student_emergency_contacts` ; détail colonne par colonne en §1.2 | Éclatement personne / élève / historique scolaire. Plus aucune donnée d'année sur le dossier. Plus de compte obligatoire. Aucune suppression physique (triggers `students_no_delete`, `persons_no_delete`). |
| `student_enrollments` | M/0005:92-115 (DDL cassé : CREATE INDEX au milieu du CREATE TABLE) ; M/0059:9-18 ; P/:1587-1592 | hors module -> 004 | `academic.enrollments` (+ `enrollment_courses`, `enrollment_placements`, `enrollment_history`) ; vue lecture côté people : `people.student_enrollment_summaries` | L'inscription annuelle historise (placements, statut, financement). Table VIDE sur la base de référence (S/owner-personnes.service.ts:20-31), donc migration de données minimale. Colonnes en §1.6. |
| `student_parents` | M/0003:31-43 ; P/:1603-1616 | amélioré | `people.student_guardians` (+ `people.guardians` + `people.persons`) | Fin de « parent = utilisateur » ; un seul contact principal garanti par index partiel ; validité datée ; drapeaux modifiables par le seul personnel. Colonnes en §1.3. |
| `emergency_contacts` (rattachés au PARENT) | M/0030:10-20 ; P/:699-711 | amélioré | `people.student_emergency_contacts` (rattachés à l'ÉLÈVE) | Un contact d'urgence est une donnée de l'élève, pas du compte du parent. Colonnes en §1.4. |
| `registration_requests` | M/0060:12-64 | hors module -> 007 | `admissions` (candidature, décision) ; appelle `createStudent`/`createGuardian`/`linkGuardian` de people | Table absente du déploiement Prisma (S/owner-scolarite.service.ts:359-363). Workflow d'admission = spec 007 ; people ne reçoit que le résultat. |
| `student_status_history` | M/0099:24-97 | amélioré | `people.student_status_history` | Append-only (trigger `student_status_history_immutable`), motif + auteur + date d'effet renseignés, création historisée. Colonnes en §1.5. |
| `professional_student_matricules` | M/0086:17-29 ; 0093 ; 0094:109-121 | hors module -> 004 | `academic.enrollments.registration_number` + `academic.institution_settings.registration_number_pattern` | Le matricule « IPAM-CODE-NNNN » devient un numéro d'inscription généré par motif de données (jetons `{PREFIX}`, `{PROGRAM}`, `{STUDENT_SEQ:n}`, `{YEAR}`), pas un second générateur. |
| `student_provenances` | M/0120:60-95 ; 0124:20-31 | hors module -> 007 | Canal d'acquisition de la candidature (admissions) | Donnée commerciale, pas d'identité. 1 par élève dans le legacy (pas par inscription). |
| `commerciaux`, `commissions_versements` | M/0120:26-41, 120-138 | hors module -> hors plan | Prospection hors plan v2 (si reprise : 014/015) | Commissions calculées sur paiements de scolarité : finance, pas people. |
| `professional_orders`, `professional_payments` | M/0061:89-107, 138-162 ; 0122:26-36 ; 0123:25-39 | hors module -> 014 | `finance` (factures, paiements) | Aucun montant dans people/academic. |
| `professional_enrollments` | M/0069:371-392 | hors module -> 004 | `academic.enrollment_courses` (`source='A_LA_CARTE'`, `offering_id`) | Inscription à la carte (élève x cohorte d'UE) = sélection de cours d'une inscription ; prix figé -> finance. |
| `professional_ue_sessions` (cohortes) | M/0069:139 | hors module -> 004 | `academic.classroom_offerings` | Pour mémoire (cible des inscriptions pro). |
| `programmes`, `filieres`, `classes` | M/0116:12-39 ; M/0005:57 ; P/:438 | hors module -> 004 | `academic.programs`, `grade_levels`, `classrooms` | Piège de nommage legacy : `filiere_id` des tables `professional_*` désigne la CLASSE (`programmes`). |
| `inscriptions_professionnelles` (formations courtes, apprenant = `users.id`, sans fiche élève) | P/:1029-1048 | abandonné | — (voir §7, point 17) | Module distinct, sans dossier élève, aucun équivalent dans le plan v2 ; non migré par défaut. |
| `student_dashboard_configs`, `dashboard_widgets`, `dashboard_templates` | M/0001_student_dashboard_tables | abandonné | — | Routes jamais enregistrées (index.ts:122, 366-367 commentés) ; confusion `user_id`/`student_id`. |
| `users` (colonnes d'identité) | M/0001:29-38 ; 0004:12-14,64-69 ; 0051:2 ; 0055:209-215 ; P/:2082-2099 | hors module -> 002 | `iam` (identité, authentification) ; people ne garde que `persons.identity_id` | Détail des colonnes en §1.7. |
| `roles`, `user_roles` | M/0001:18-47 ; 0055:75-86,173-189,321-336 | hors module -> 002 | `iam` (rôles, memberships) | Rôles explicites ; l'inférence de rôle par existence de lignes disparaît (S-006). |
| `notification_preferences` (par parent) | M/0031 | hors module -> 016 | `communications` | Préférences de canal. |
| Tables dépendantes de `student_profiles` par FK ON DELETE CASCADE : `payment_transactions`, `student_tuition_installments`, `student_attendance`, `report_cards`, `student_period_course_averages`, `admin_student_messages`, `teacher_messages`, `parent_school_*` | P/:3560-4226 | hors module -> 010 / 011 / 013 / 014 / 015 / 016 | Chaque module garde son historique, FK = UUID sans cascade | Le legacy supprimait notes, présences, paiements, échéances avec la fiche (S-016). Cascade abandonnée : aucune suppression physique. |
| Fichiers `uploads/students/<id>/diploma/` | R/students.ts:1611-1666 | hors module -> 024 | `documents` (objet + métadonnées) ; `student_prior_education.document_ref` | Disque local, non cloisonné, non sauvegardé. |
| Politique RLS d'origine (`tenant_id = app.tenant_id`, 0003:50-57) puis uniforme (0055:740-760) | M/0003:50-57 ; M/0055:740-760 | amélioré | `kernel.enable_tenant_rls(...)` sur chaque table people (RLS forcée), FK composites `(tenant_id, id)` | Isolation par la base, plus par `WHERE tenant_id` manuel ; rôle `app_user` sans DELETE sur persons/students/guardians. |

### 1.2 `student_profiles` : où va chaque colonne

| Colonne legacy | Migration:ligne | Statut | Cible v2 | Justification |
|---|---|---|---|---|
| `id` | 0003:10 | conservé | `people.students.id` (réutilisation de l'UUID legacy, décision de migration 031) | Les autres modules référencent l'élève par UUID ; garder l'UUID évite de réécrire les références. |
| `tenant_id` | 0003:11 | conservé | `people.students.tenant_id` / `persons.tenant_id` | RLS forcée. |
| `user_id` (NOT NULL, compte obligatoire) | 0003:12 | amélioré | `people.persons.identity_id` (NULL autorisé ; unique partiel par tenant) | Un élève peut exister sans compte (mineur, sans e-mail). Fin des adresses factices `eleve.<matricule>@<slug>.local` (S-052). |
| `student_number` (VARCHAR 50, rang d'ancienneté 10001+) | 0003:13 | amélioré | `people.students.student_number` (immuable, motif configurable `settings.student_number_pattern`) | Plus de réécriture à la lecture (S-022). Voir §3.1 et §7 (valeurs migrées). |
| `current_year` (1..10 saisi à la main, jamais incrémenté) | 0003:14 | abandonné | `academic.enrollments` -> `classrooms.grade_level_id` (niveau de l'année) ; projection `student_enrollment_summaries.grade_level_*` | Donnée d'année : n'a pas sa place sur le dossier permanent. |
| `status` (enum `active, graduated, suspended, dropped, transfer`) | 0003:5,15 | amélioré | `people.students.status` (`ACTIVE, INACTIVE, GRADUATED, WITHDRAWN, TRANSFERRED_OUT, EXCLUDED, ARCHIVED`) | Correspondance en §3.2 ; transitions imposées par `students_guard`. |
| `bio` | 0003:16 | conservé | `people.students.attributes` (clé `bio`) | Texte libre rarement utilisé ; extension JSON plutôt qu'une colonne. |
| `date_of_birth` | 0003:17 | conservé | `people.persons.birth_date` | CHECK 1900-2100 ; contrôle « pas dans le futur » côté domaine. |
| `place_of_birth` | 0003:18 | conservé | `people.persons.birth_place` | — |
| `nationality` (texte libre 100) | 0003:19 | amélioré | `people.persons.nationality` (code ISO 3166-1 alpha-2, CHECK `^[A-Z]{2}$`) | Normalisation des libellés (« Guinéenne » -> `GN`) à la migration ; valeur non reconnue conservée dans `persons.attributes.nationality_raw`. |
| `address` | 0003:20 | conservé | `people.persons.address_line` (+ `city`) | — |
| `phone` (VARCHAR 20) | 0003:21 | amélioré | `people.persons.phone` (5 à 40 caractères) | La limite de 20 faisait échouer l'approbation d'une demande dont le téléphone en comptait jusqu'à 40 (S-052). |
| `emergency_phone` | 0003:22 | amélioré | `people.student_emergency_contacts` (une ligne `contact_name` = « Contact d'urgence (migré) », `phone`) | Un numéro brut devient un vrai contact avec nom, priorité. |
| `is_active` (jamais écrite, toujours true) | 0003:23 | abandonné | — (`students.status` fait foi ; l'accès au portail = `iam`) | Colonne morte. |
| `created_at`, `updated_at` | 0003:24-25 | conservé | `created_at`, `updated_at` | — |
| `gender` (enum `gender_type` NOT NULL défaut 'masculin' OU TEXT CHECK, selon l'ordre 0042/0079) | 0042:5-9 ; 0079:7-9 | amélioré | `people.persons.sex` (`M`/`F`, NULL autorisé) | Le défaut `masculin` fabriquait une donnée fausse (R/students.ts:572 ; R/registration-requests.ts:185). Lignes à défaut non distinguables des saisies réelles : voir §7. |
| `father_name`, `mother_name` | add-student-admin-fields.js ; P/:1651-1652 | conservé | `people.students.attributes` (clés `father_name`, `mother_name`) | Filiation d'état civil (acte de naissance), distincte des tuteurs légaux ; ne crée pas de `guardians`. Voir §7 (colonnes dédiées ?). |
| `birth_certificate_number` | idem ; P/:1653 | conservé | `people.students.birth_certificate_number` | PII sensible (§4). |
| `birth_certificate_date` | idem | conservé | `people.students.birth_certificate_date` | idem. |
| `civil_registry_office` | idem | conservé | `people.students.civil_registry_office` | idem. |
| `sub_prefecture` | idem | conservé | `people.students.attributes` (clé `sub_prefecture`) | Subdivision administrative propre à un pays : donnée de pack, pas une colonne du noyau. |
| `residence` | idem | conservé | `people.persons.residence` | — |
| `origin_school` (copie obsolète sur la fiche) | idem ; M/0059:9 | hors module -> 004 | `academic.enrollments.origin_school` ; à défaut d'inscription, `student_prior_education` (`kind='SCHOOL'`, `institution_name`) | Provenance scolaire d'une année d'entrée : donnée d'inscription. |
| `is_repeating` | idem ; M/0059:12 | hors module -> 004 | `academic.enrollments.is_repeating` ; issue `enrollment_outcomes.kind='REPEAT'` | Redoublement = fait d'année. |
| `lv2` | idem ; M/0059:10 | hors module -> 004 | `academic.enrollment_courses` (`source='OPTION'`, nœud de curriculum de la LV2) | Option choisie pour l'année. |
| `scholarship_level` (oui/non) | idem ; M/0059:11 | hors module -> 004 | `academic.enrollments.funding_type = 'SCHOLARSHIP'` | Boursier = type de financement de l'année (montants -> finance). Conflit avec l'affectation d'État : voir §7. |
| `is_transfer` | idem ; M/0059:13 | hors module -> 004 | `academic.enrollments.is_transfer_in` | Arrivée d'un autre établissement cette année. |
| `transfer_decision` | idem ; M/0059:15 | hors module -> 004 | `academic.enrollment_history` (`kind='NOTE'`, `reason`) | Texte de décision, rattaché à l'inscription concernée. |
| `affectation_status` (`affecte`, `non_affecte`, `prise_en_charge`) | idem ; M/0059:16 | hors module -> 004 | `academic.enrollments.funding_type` : `affecte` -> `STATE_ASSIGNED` ; `non_affecte` -> `PRIVATE` ; `prise_en_charge` -> `OTHER` ou `COMPANY` (à trancher) | Aucune logique legacy n'en dépendait ; le type de financement est désormais une donnée structurée. |
| `affectation_decision` | idem ; M/0059:17 | hors module -> 004 | `academic.enrollments.assignment_reference` (+ `assignment_issued_on`) | Numéro de décision d'affectation ; CHECK : interdit si `funding_type = 'PRIVATE'`. |
| `cepe_code` | idem ; M/0059:18 | amélioré | `people.student_prior_education` (`kind='CERTIFICATE'`, label « CEPE », code en `note`) | Examen d'entrée = historique scolaire permanent, pas une donnée d'année. La cible n'a pas de colonne « numéro de diplôme » : voir §7. |
| `is_inscribed` (défaut true) | idem ; M/0059:14 | abandonné | — (`academic.enrollments.status`) | Redondant avec le statut d'inscription. |
| `inscription_date` (jamais écrite) | idem | amélioré | `people.students.first_enrolled_on` | Alimentée désormais par l'événement `academic.enrollment.created` (première inscription). |
| `establishment_matricule` | idem | abandonné | — | Miroir de `student_number` (R/students.ts:2054-2063) : deux colonnes pour un seul numéro. |
| `dsps_matricule` | idem | conservé | `people.students.national_student_id` (unique partiel par tenant) | Matricule de la tutelle = « matricule national éventuel » du PRD §10. Aucune unicité legacy : dédoublonnage à la migration. |
| `dsps_previous_matricule` | idem | conservé | `people.students.attributes` (clé `previous_national_student_id`) | Historique d'un identifiant externe. |
| `initial_password` (clair) | idem ; P/:1666 | abandonné | — (purge ; jamais migré) | Mot de passe en clair. Les comptes migrés sont réinitialisés par lien d'activation (iam). |
| `bac_obtention_date`, `bac_series` | 0081:10-13 | amélioré | `people.student_prior_education` (`kind='DIPLOMA'`, label « Baccalauréat », `obtained_on`, `series_label`) | Éditables après création (legacy : figés, absents de `PUT`, S-015). |
| `last_diploma` (URL TEXT de fichier) | 0081:13,17-18 | amélioré | `people.student_prior_education.document_ref` -> `documents.documents.id` (024) | Fichier migré vers le stockage objet ; le contrat legacy `max(255)` incohérent avec TEXT disparaît. |
| `student_matricule` (saisi, libre, unique partiel) | 0088:25-44 | amélioré | `people.students.external_ref` (unique partiel par tenant) | Identifiant externe saisi ; plus obligatoire à la création. Sensibilité à la casse : voir §3.1 et §7. |
| `sequence_number` (n° d'ordre figé) | 0094:22-57, 73-98 | amélioré | `people.students.sequence_number` (NOT NULL, unique, immuable) | Posé par `people.next_number('STUDENT')` (compteur verrouillé) ; conservé tel quel à la migration (base du matricule d'inscription). |
| (nouveau, aucune colonne legacy) photo | — | amélioré | `people.persons.photo_object_key` + `uploadStudentPhoto` (StoragePort) | Le legacy n'avait pas de photo d'élève (`profilePictureUrl` renvoyait `null`, S-118). |

### 1.3 `student_parents` -> `student_guardians`

| Colonne legacy | Migration:ligne | Statut | Cible v2 | Justification |
|---|---|---|---|---|
| `id`, `tenant_id`, `student_id` | 0003:32-34 | conservé | `student_guardians.id`, `tenant_id`, `student_id` | FK composites `(tenant_id, student_id)`. |
| `parent_id` (-> `users.id`) | 0003:35 | amélioré | `student_guardians.guardian_id` (-> `people.guardians`, qui pointe une `persons` ± `identity_id`) | Tuteur = personne, avec ou sans compte. À la migration : un `persons` + un `guardians` par parent, `identity_id` = identité iam du `users` migré. |
| `relationship_type` (enum `parent, guardian, emergency_contact`, défaut `parent`) | 0003:6,36 | amélioré | `student_guardians.relationship_code` -> `people.relationship_types.code` (données de pack : FATHER, MOTHER, LEGAL_GUARDIAN…) | Référentiel extensible. Correspondance de migration : `parent` -> code générique (ex. `PARENT`) ; `guardian` -> `LEGAL_GUARDIAN` avec `has_legal_custody=true` ; `emergency_contact` -> code de `kind='EMERGENCY'`, `is_emergency_contact=true`, `portal_access=false`. |
| `is_primary_contact` | 0003:37 | amélioré | `student_guardians.is_primary_contact` | Index unique partiel `student_guardians_one_primary` : un seul principal vivant par élève (le legacy n'imposait rien, index non unique 0003:70). Dédoublonnage à la migration : le lien le plus ancien reste principal. |
| `emergency_contact` | 0003:38 | conservé | `student_guardians.is_emergency_contact` | Renommage. |
| `can_pickup` (défaut **true**) | 0003:39 | amélioré | `student_guardians.can_pickup` (défaut **false**) | Autorisation de retrait explicite et décidée par l'école ; valeurs migrées conservées telles quelles. |
| `notes` | 0003:40 | conservé | `student_guardians.notes` | — |
| `created_at` | 0003:41 | conservé | `created_at` ; `valid_from` = `created_at::date` | — |
| (absent : `updated_at`) | — | amélioré | `student_guardians.updated_at` | Son absence faisait échouer en 500 `PUT /parent/emergency/...` (R/parent-emergency.ts:902-905, 1177-1180). |
| (nouveau) | — | amélioré | `is_financial_responsible`, `has_legal_custody`, `portal_access`, `priority`, `valid_from`, `valid_to` | Répondant financier et garde légale explicites ; `portal_access` pilote l'accès parent (remplace le « niveau d'accès » purement décoratif, S-117) ; validité datée = historique du lien. |
| UNIQUE `(tenant_id, student_id, parent_id)` | 0003:42 | conservé | UNIQUE `(tenant_id, student_id, guardian_id)` | — |

### 1.4 `emergency_contacts` -> `student_emergency_contacts`

| Colonne legacy | Migration:ligne | Statut | Cible v2 | Justification |
|---|---|---|---|---|
| `parent_id` (-> `users.id`) | 0030:13 | amélioré | `student_id` (une copie du contact **par enfant lié** au parent) | Le legacy partageait implicitement le contact entre tous les enfants du parent. |
| `contact_name` | 0030:14 | conservé | `contact_name` | — |
| `relationship` (texte libre) | 0030:15 | conservé | `relationship_label` | — |
| `phone` (VARCHAR 50) | 0030:16 | amélioré | `phone` (5 à 40 caractères, CHECK) | Valeurs plus longues à nettoyer à la migration. |
| `email` | 0030:17 | abandonné | — | La cible n'a pas de colonne e-mail (`phone`, `phone_alt` seulement) : écart signalé en §7. |
| `created_at`, `updated_at` | 0030:18-19 | conservé | idem + `priority` (nouveau) | — |

### 1.5 `student_status_history`

| Colonne legacy | Migration:ligne | Statut | Cible v2 | Justification |
|---|---|---|---|---|
| `id`, `tenant_id`, `student_id` | 0099:25-27 | conservé | idem (FK composite) | — |
| `old_status` / `new_status` (TEXT) | 0099:28-29 | amélioré | `from_status` / `to_status` (valeurs `students.status` v2) | Correspondance §3.2. |
| `reason_code`, `reason_text` (jamais renseignés par le code) | 0099:31-32 | amélioré | `reason_code`, `reason_text` obligatoires pour les changements manuels | Le motif devient une saisie du cas d'usage `changeStudentStatus`. |
| `changed_by` (jamais renseigné) | 0099:33 | amélioré | `changed_by` (identité de l'acteur) | Auteur tracé. |
| `changed_at` | 0099:34 | conservé | `changed_at` (+ `effective_on` nouveau) | Date de saisie et date d'effet distinguées. |
| Ligne « baseline » `reason_code='baseline_0099'` | 0099:92-97 | conservé | importée telle quelle | Seul passé reconstituable. |
| Absence de trigger INSERT (création non historisée) | 0099:83-87 | amélioré | `createStudent` écrit la ligne `NULL -> ACTIVE` | « Création historisée ». |

### 1.6 `student_enrollments` (colonnes hors champs administratifs, déjà traités en §1.2)

| Colonne legacy | Migration:ligne | Statut | Cible v2 | Justification |
|---|---|---|---|---|
| `student_id`, `class_id`, `academic_year_id` | 0005:97-99 | hors module -> 004 | `academic.enrollments.student_id`, `classroom_id`, `academic_year_id` | UNIQUE legacy `(tenant, élève, année)` remplacé par deux index partiels (un exemplaire vivant par classe ; une inscription « de classe » par année). Corrige S-062 (doublon testé par classe, unicité réelle par année). |
| `fees` (JSONB figé : inscription, scolarité, annexes, autres, total, XOF) | 0005:100 ; 193-215 | hors module -> 014 | `finance` : facture générée à l'événement `academic.enrollment.created` | Aucun montant dans academic. |
| `enrollment_date` (défaut CURRENT_DATE ; CHECK <= CURRENT_DATE absent de la baseline Prisma) | 0005:101,106 | hors module -> 004 | `academic.enrollments.enrolled_on` | — |
| `status` (`active, suspended, completed, dropped, transferred`) | 0005:28 | hors module -> 004 | `academic.enrollments.status` : `active` -> `ACTIVE`, `suspended` -> `SUSPENDED`, `completed` -> `COMPLETED`, `dropped` -> `WITHDRAWN`, `transferred` -> `TRANSFERRED_OUT` (+ `PENDING`, `CANCELLED` nouveaux) | Trois vocabulaires legacy (élève, inscription, inscription pro) unifiés. |
| Changement de classe = UPDATE de `class_id` | R/enrollments.ts:1081-1341 | hors module -> 004 | `enrollment_placements` + `transferEnrollment` | Historique du placement. |

### 1.7 `users` et enums

| Élément legacy | Migration:ligne | Statut | Cible v2 | Justification |
|---|---|---|---|---|
| `users.email`, `first_name`, `last_name`, `name` | 0001:29-38 ; 0004 | hors module -> 002 | Identité `iam` ; copie utile dans `people.persons.email/first_name/last_name` | `name` legacy (doublon) non reconduit. |
| `users.password_hash`, `is_active`, `role_updated_at`, `active_role_key`, `is_technical_account` | 0001, 0055:209-215 | hors module -> 002 | `iam` | — |
| `users.initial_password` (clair, parents) | 0051:2 | abandonné | — (purge) | Mot de passe en clair. |
| enum `student_status` | 0003:5 | amélioré | `students.status` (CHECK à 7 valeurs) | Correspondance §3.2. |
| enum `enrollment_status` | 0005:28 | hors module -> 004 | `enrollments.status` | — |
| enum `parent_relationship` | 0003:6 | amélioré | table `people.relationship_types` (données de pack) | Extensible par tenant. |
| enum `gender_type` / TEXT CHECK | 0042:5 ; 0079:7 | amélioré | `persons.sex` (`M`, `F`) | Voir §1.2. |
| `affectation_status` (3 valeurs) | add-student-admin-fields.js | hors module -> 004 | `academic.funding_types` | Voir §1.2. |
| `registration_requests.status`, `account_type` | 0060 | hors module -> 007 | — | — |

### 1.8 Fonctions et déclencheurs legacy

| Objet | Migration:ligne | Statut | Cible v2 | Justification |
|---|---|---|---|---|
| `generate_student_number(tenant)` + `set_student_number_trigger` (« STU<année><NNN> », dormant et bugué) | 0003:77-115 | abandonné | `people.next_number('STUDENT')` | Le `SUBSTRING ... '[0-9]+$'` capture l'année : `STU20262026002` puis dépassement INTEGER. Jamais déclenché (les routes fournissent le numéro). |
| `assign_student_sequence_number()` (SECURITY DEFINER, verrou consultatif, `MAX+1`) | 0094:73-98 | amélioré | `people.next_number` (compteur `people.number_sequences`, ligne verrouillée jusqu'au COMMIT, pas d'avance de plus de 1) | Plus de réutilisation d'un numéro après suppression du maximum (il n'y a plus de suppression). |
| `trg_student_status_history()` (EXCEPTION WHEN OTHERS avalée) | 0099:65-87 | amélioré | écriture applicative dans la même transaction que le changement + trigger `students_guard` | Un échec d'historique n'est plus silencieux. |
| `update_student_profiles_updated_at` | 0003:73-75 | conservé | `updated_at` géré par le domaine | — |
| `update_enrollment_fees_total` | 0005:193-215 | hors module -> 014 | — | Montants hors academic. |

### 1.9 Tables v2 sans équivalent legacy

| Table v2 | Statut | Rôle | Ce qu'elle remplace |
|---|---|---|---|
| `people.relationship_types` | amélioré | Référentiel des liens de parenté (code, libellé, `kind` GUARDIAN/EMERGENCY/OTHER) | L'enum `parent_relationship` |
| `people.settings` | amélioré | Motifs de numérotation, `duplicate_check_enabled`, préfixe | Constantes codées en dur (§5) |
| `people.number_sequences` + `people.next_number` | amélioré | Compteurs gapless par tenant et genre | Six numérotations legacy (§3.1) |
| `people.persons` | amélioré | État civil commun élève/tuteur/personnel | « Un parent = un utilisateur » |
| `people.student_prior_education` | amélioré | Historique scolaire d'entrée, diplômes | Colonnes `bac_*`, `last_diploma`, `cepe_code` |
| `people.student_enrollment_summaries` | amélioré | Projection de lecture alimentée par `academic.enrollment.*` | Jointures SQL inter-modules des écrans élèves |

---

## 2. Fonctions et endpoints

Colonnes : ID legacy | fonction | référence fichier:ligne | statut | cible v2 | justification. Les familles A à K regroupent les 88 IDs de l'inventaire ; les lignes « SI-n » sont des éléments de l'inventaire sans ID.

### 2.A Comptes et authentification liés aux élèves et parents

| ID | Fonction | Référence | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| S-001 | Inscription libre (compte seul) `POST /auth/register` | R/auth.ts:108-188 | hors module -> 002 | `iam` : auto-inscription (si autorisée par le tenant) ; lien identité-personne via `resolveStudentForIdentity` | Le « compte élève fantôme » (rôle `student` sans fiche, sans matricule) n'est pas reproduit : un `students` n'existe que par `createStudent`. |
| S-003 | Connexion sociale `POST /auth/social-login` | R/auth.ts:356-446 | hors module -> 002 | `iam` (OIDC avec jeton vérifié) | Le legacy ne vérifie aucun jeton Google : n'importe quel e-mail existant est usurpable. À ne pas reproduire. |
| S-004 | Login (recherche globale par e-mail, JWT 24 h) | R/auth.ts:448-514 ; S/user-auth.service.ts:102-248 | hors module -> 002 | `iam` ; blocage éventuel du portail sur `people.student.status_changed` : décision en §7 | Le statut `dropped`/`suspended` n'empêchait pas la connexion dans le legacy. |
| S-005 | Changement de rôle actif `POST /auth/switch-role` | R/auth.ts:516 | hors module -> 002 | `iam` (contexte de membership) ; people fournit `listChildrenOfIdentity` et `resolveStudentForIdentity` pour qu'un même compte soit élève et tuteur | — |
| S-006 | Inférence de rôles `inferAdditionalRoles` (student si fiche, parent si lien) | S/user-auth.service.ts:55-100 | abandonné | Rôles = permissions iam explicites ; `isGuardianOfStudent` est une règle d'accès aux données, pas un rôle | Créer un lien ou une fiche donnait un rôle sans écrire `user_roles` ; supprimer le dernier lien ne le retirait pas ; incohérent avec `POST /students/:id/parents`. |
| S-007 | Création d'utilisateur nu `POST /users` | R/users.ts:5-84 | hors module -> 002 | `iam` : création d'identité sous permission + invitation | Aucun contrôle de rôle dans le legacy ; doublon testé par tenant alors que l'unicité est globale (23505 -> 500). |
| S-017 | Reset du mot de passe d'un élève `POST /students/:id/reset-password` | R/students.ts:607-707 | hors module -> 002 | `iam` : réinitialisation par lien ; `provisionPortalAccount` pour relancer l'invitation | Le legacy générait un mot de passe (`Math.random`), l'écrivait en clair dans `users` et `student_profiles` et le renvoyait ; sessions non invalidées ; `owner` exclu. |
| S-018 | Modèle d'e-mail d'identifiants `GET/PUT /students/credentials-template` | R/students.ts:1447-1509 ; S/student-credentials-email.ts | hors module -> 016 | `communications` : modèle de message d'invitation, sous permission dédiée | Aucun contrôle de rôle (tout utilisateur pouvait réécrire l'e-mail envoyé aux élèves). Plus de variable `{{password}}`. |
| S-019 | (Ré)envoi d'identifiants `POST /students/:id/send-credentials` | R/students.ts:1512-1608 | amélioré | `provisionPortalAccount` (port `AccountProvisioner` -> iam) : invitation par lien d'activation à usage unique | Le legacy réinitialisait silencieusement le mot de passe si aucun n'était stocké ; n'importe quel utilisateur pouvait le déclencher. Permission explicite, aucune valeur secrète en clair. |
| S-024 | Générateurs de mot de passe (`generateTemporaryPassword` x3 + une 4e dans S/inscription-pro.service.ts:251-259) | R/students.ts:39-58 ; R/parents.ts:42-58 ; R/registration-requests.ts:37-54 | abandonné | Aucun mot de passe généré, affiché ou stocké par people ; secrets éventuels = CSPRNG côté iam | `Math.random` non cryptographique ; quatre copies divergentes. |

### 2.B Fiche élève (`/students`), historique de statut, dossier permanent

| ID | Fonction | Référence | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| S-010 | Mon profil élève `GET /students/me` | R/students.ts:104-223 | amélioré | `GET /me/student` -> `resolveStudentForIdentity` ; permission `student.self.read` | Identité tirée du seul JWT (plus de `x-user-id`) ; plus de repli sur « la fiche la plus récente » ni sur l'en-tête `x-academic-year-id` (année en paramètre explicite) ; 404 explicite si aucune fiche ; renvoie la projection d'inscription de l'année. |
| S-011 | Liste des élèves `GET /students` (filtres, recherche, pagination) | R/students.ts:226-604 | amélioré | `GET /students` -> `listStudents`, `searchStudents` ; `student.list` ; filtres : statut, année/classe/programme via `student_enrollment_summaries`, `enrolled=false`, recherche (`search_key` sans accents + trigrammes, numéro, `external_ref`, `national_student_id`, `registration_number`) | Aucun contrôle de rôle dans le legacy (tout utilisateur lisait toutes les fiches) ; lecture sans écriture (fin de `enforceSequentialMatricules`) ; champs sensibles masqués sans `student.sensitive.read` ; `initialPassword` supprimé ; filtre `withoutActiveProfessionalEnrollment` -> `enrolled=false` (inscriptions PENDING/ACTIVE/SUSPENDED) ; plus de requête `information_schema` à chaque appel. |
| S-012 | Détail élève `GET /students/:id` | R/students.ts:710-873 | amélioré | `GET /students/:id` -> `getStudent` ; `student.read` (+ `student.sensitive.read` pour le bloc sensible ; `student.self.read` / `student.child.read` via `isGuardianOfStudent`) | Mêmes corrections que S-011 ; bloc sensible séparé. |
| S-013 | Créer le profil d'un compte existant `POST /students` | R/students.ts:876-1092 | amélioré | `createStudent` (option `identityId` pour lier un compte existant) ; `student.create` | Transaction unique ; numéro pris par `people.next_number` (fin de la course `MAX+1` -> 500) ; détection de doublons ; ligne d'historique `NULL -> ACTIVE` ; `gender` non défaulté. |
| S-014 | Créer compte + fiche `POST /students/with-user` | R/students.ts:1095-1444 | amélioré | `createStudent` puis, en option, `provisionPortalAccount` | Plus de mot de passe (ni saisi, ni renvoyé en 201, ni stocké) ; e-mail facultatif ; `studentMatricule` plus obligatoire (devient `external_ref` facultatif) ; plus de rôle silencieusement omis quand `roles.student` manque ; e-mail normalisé en minuscules ; pas de `error.message` brut en 500. |
| S-015 | Modifier un élève `PUT /students/:id` | R/students.ts:1709-2175 | amélioré | `PATCH /students/:id` -> `updateStudent` (`student.update`) ; statut via `changeStudentStatus` (`student.status.update`) ; événement `people.student.updated` | `student_number`/`sequence_number`/`person_id` immuables (trigger `students_guard`) ; champs d'année retirés ; bac/diplôme éditables (prior education) ; transaction propre (le legacy faisait des retours anticipés avec `BEGIN` ouvert, sans ROLLBACK : connexions « idle in transaction ») ; changement de statut avec motif ; handler de 400 lignes de `if` remplacé. |
| S-016 | Supprimer un élève `DELETE /students/:id` | R/students.ts:2179-2259 | abandonné | `changeStudentStatus` -> `ARCHIVED` (triggers `students_no_delete`, `persons_no_delete`) | Suppression en cascade (17 FK) de notes, présences, paiements, échéances, inscriptions, messages, sans audit ; compte `users` orphelin. Effacement RGPD = anonymisation, à spécifier (§7). |
| S-020 | Upload du dernier diplôme `POST /students/:id/diploma` | R/students.ts:1611-1666 | amélioré | `POST /students/:id/prior-education` (`addPriorEducation`/`updatePriorEducation`), fichier via documents (024) -> `document_ref` | Stockage objet cloisonné par tenant, contrôle de permission, vérification de l'existence AVANT écriture, types et taille de fichier configurables ; ancien fichier versionné. Dépendance à 024 (`document_ref` NULL tant qu'absent) : §7. |
| S-021 | Servir le diplôme `GET /students/:id/diploma/:filename` | R/students.ts:1669-1706 | hors module -> 024 | `documents` : téléchargement par URL signée courte, sous `student.sensitive.read` | Lisible par tout utilisateur du tenant dans le legacy ; lecture intégrale en mémoire. |
| S-100 | Historisation du statut (trigger) | M/0099:65-87 | amélioré | `changeStudentStatus` + `GET /students/:id/history` ; table `student_status_history` | Auteur, motif, date d'effet renseignés ; création historisée ; table immuable ; transitions légales imposées en base. |
| S-101 | Lecture « historique disponible depuis… » (`MIN(changed_at)`) | S/owner-economie.service.ts:179 | hors module -> 025 | `analytics` (lit les événements `people.student.status_changed`) | Lecture décisionnelle propriétaire ; les courbes de survie annoncées par 0099 n'ont jamais été implémentées. |

### 2.C Liens parent-élève côté administration

| ID | Fonction | Référence | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| S-030 | Rattacher un parent `POST /students/:studentId/parents` | R/students.ts:2262-2459 | amélioré | `POST /students/:id/guardians` -> `linkGuardian` ; `guardian.manage` ; événement `people.guardian.linked` | Plus d'exigence de « rôle parent » (le tuteur est une personne) ; un seul contact principal garanti par index ; `relationship_code` issu d'un référentiel ; retour anticipé sans ROLLBACK corrigé ; drapeaux nouveaux (responsable financier, garde légale, accès portail, validité). |
| S-031 | Lister les parents d'un élève `GET /students/:studentId/parents` | R/students.ts:2462-2599 | amélioré | `GET /students/:id/guardians` -> `listGuardiansOfStudent` ; `student.read` + `guardian.read` | Aucun contrôle de rôle dans le legacy (e-mails de parents lisibles par tous) ; tri « principal puis nom » conservé ; liens expirés exclus par défaut. |
| S-032 | Détacher un parent `DELETE /students/:studentId/parents/:parentId` | R/students.ts:2602-2696 | amélioré | `DELETE /students/:id/guardians/:linkId` -> `unlinkGuardian` (clôture du lien par `valid_to`) ; événement `people.guardian.unlinked` | Historique du lien conservé ; BEGIN sans ROLLBACK corrigé ; arbitrage « dernier tuteur » et DELETE physique : §7. |
| S-033 | Mise à jour d'un lien : **n'existe pas** côté admin (contrat orphelin `UpdateStudentParentSchema`, C/student.ts:195) | C/student.ts:195 | amélioré | `PATCH /students/:id/guardians/:linkId` -> `updateGuardianLink` ; `guardian.manage` ; événement `people.guardian.link_changed` | Comble le manque (le legacy imposait de supprimer/recréer) ; seul le personnel modifie les drapeaux. |

### 2.D Parents : administration (`/parents`)

| ID | Fonction | Référence | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| S-040 | Liste des parents `GET /parents` | R/parents.ts:61-275 | amélioré | `GET /guardians` (use case `listGuardians`, à ajouter au brief : §7) ; `guardian.read` ; filtre `portalAccount` (remplace S-054) ; filtre année via projection | Parents = `guardians`, plus « users avec rôle parent » ; compteurs d'enfants calculés sur la projection ; mot de passe supprimé ; filtre année inclut désormais tous types d'inscription (le legacy ignorait les élèves pro). |
| S-041 | Détail d'un parent `GET /parents/:id` | R/parents.ts:408-548 | amélioré | `GET /guardians/:id` (`getGuardian`, à ajouter au brief) ; `guardian.read` | Inclut les liens (enfants). |
| S-042 | Créer un parent `POST /parents` | R/parents.ts:551-914 | amélioré | `POST /guardians` -> `createGuardian` ; `guardian.manage` ; événement `people.guardian.created` ; compte optionnel via `provisionPortalAccount` | Pas de mot de passe ; `phone` enfin persisté (acceptée mais jetée dans le legacy) ; détection de doublon par e-mail/téléphone/nom ; les 4 cas legacy (compte orphelin recyclé, promotion silencieuse d'un élève/enseignant/admin en parent, doublon 409) sont remplacés par : personne existante -> lien d'identité explicite et audité. |
| S-043 | Modifier un parent `PUT /parents/:id` | R/parents.ts:917-1131 | amélioré | `PATCH /guardians/:id` -> `updateGuardian` ; `guardian.manage` | Noms/téléphone/adresse/profession dans `persons`/`guardians` ; e-mail normalisé ; doublon testé dans le tenant ; plus de `name` désynchronisé de `first_name last_name`. |
| S-044 | Supprimer un parent `DELETE /parents/:id` | R/parents.ts:1134-1294 | amélioré | `updateGuardian` (statut `ARCHIVED`) ; trigger `guardians_no_delete` | Le garde-fou legacy (409 si enfants liés) est conservé : archivage refusé tant qu'un lien est vivant ; plus de `DELETE FROM users` ni de cascade. |
| S-045 | Enfants d'un parent `GET /parents/:id/children` | R/parents.ts:1297-1457 | amélioré | `GET /guardians/:id` (liens) ; côté parent : `GET /children` (`listChildrenOfIdentity`) | `studentNumber` stable ; projection d'inscription pour classe/niveau. |
| S-046 | Reset du mot de passe d'un parent `POST /parents/:id/reset-password` | R/parents.ts:278-405 | hors module -> 002 | `iam` (réinitialisation par lien) ; e-mail via 016 | Mot de passe en clair renvoyé et stocké ; modèle « reset » non éditable. |

### 2.E Demandes d'inscription publiques (`registration_requests`)

| ID | Fonction | Référence | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| S-002 | Soumettre une demande `POST /auth/register-request` | R/auth.ts:192-354 | hors module -> 007 | `admissions` (candidature publique, protégée anti-bot) | Défauts à ne pas reproduire : date de naissance non validée (500 avec `error.message` brut), pas de rate-limit/CAPTCHA, e-mail d'enfant obligatoire dans le schéma. |
| S-050 | Lister les demandes `GET /registration-requests` | R/registration-requests.ts:231-302 | hors module -> 007 | `admissions` (liste des candidatures) | — |
| S-051 | Détail d'une demande `GET /registration-requests/:id` | R/registration-requests.ts:305-322 | hors module -> 007 | `admissions` | — |
| S-052 | Approuver une demande (élève seul / parent seul / famille) `POST .../:id/approve` | R/registration-requests.ts:325-576 | hors module -> 007 | `admissions` orchestre : `createStudent`, `createGuardian`, `linkGuardian` (API publique people), inscription via 004, invitation via 002 | Défauts à corriger côté 007 : `relationship`/`profession` de la demande perdus ; lien « parent seul » par `childMatricule` ignoré sans retour d'erreur ; élèves créés sans matricule saisi ni sexe réel ; mots de passe en clair renvoyés ; `phone` > 20 faisait échouer tout l'approve. people apporte : détection de doublons, numéro unique, liens à drapeaux. |
| S-053 | Rejeter une demande `POST .../:id/reject` | R/registration-requests.ts:579-626 | hors module -> 007 | `admissions` (décision avec motif structuré) | Motif libre seulement dans le legacy. |
| S-054 | Comptes éligibles à l'envoi d'identifiants `GET .../accounts` | R/registration-requests.ts:629-693 | amélioré | Filtre `portalAccount` (=`identity_id` NULL ou non) de `listStudents` / `listGuardians` | Fonction détournée de son nom (« registration ») ; devient un simple filtre des listes. |
| S-055 | Envoi groupé d'identifiants `POST .../send-credentials` | R/registration-requests.ts:696-812 | hors module -> 002 | `iam` : invitations en lot (+ 016 pour l'e-mail), appelées avec les identifiants listés par people | Le legacy réinitialisait en silence les mots de passe et les envoyait en clair. |
| S-056 | `createStudentWithProfile` (interne, 3e copie de la logique de S-014) | R/registration-requests.ts:94-196 | abandonné | `createStudent` (une seule implémentation) | Duplication ; e-mail factice `eleve.<matricule>@<slug>.local` ; genre 'masculin' par défaut. |

### 2.F Inscriptions classiques (`/enrollments`, table `student_enrollments`), vue élève

| ID | Fonction | Référence | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| S-060 | Lister les inscriptions `GET /enrollments` | R/enrollments.ts:37-290 | hors module -> 004 | `listEnrollments` `GET /academic/enrollments` ; vue par élève côté people : `GET /students/:id/enrollments` (projection) | Aucun contrôle de rôle dans le legacy ; jointures INNER rendaient invisibles les inscriptions sans année. |
| S-061 | Élèves disponibles pour une inscription `GET /enrollments/available-students` | R/enrollments.ts:293-395 | amélioré | `listStudents` avec `enrolled=false&academicYearId=...` ; port `StudentDirectory` (`createStudentDirectory`) | S'appuie sur la projection (pas de jointure inter-schémas) ; pagination (le legacy fixait LIMIT 50) ; le filtre porte sur l'année, pas sur la classe. |
| S-062 | Créer une inscription `POST /enrollments` | R/enrollments.ts:398-745 | hors module -> 004 | `enrollStudent` `POST /academic/enrollments` | Corrige : doublon testé par (élève, classe, année) alors que l'unicité est (élève, année) -> 500 ; capacité non verrouillée ; classe sans contrôle d'année ; frais copiés depuis le barème (-> 014). |
| S-063 | Inscription en lot `POST /enrollments/bulk` | R/enrollments.ts:748-1078 | hors module -> 004 | `enrollStudentsBulk` | Corrige : une erreur SQL avortait toute la transaction (pas de SAVEPOINT) tout en annonçant 201 ; pas de contrôle de capacité ; champs administratifs non renseignés. |
| S-064 | Modifier une inscription (classe, statut, frais) `PUT /enrollments/:id` | R/enrollments.ts:1081-1341 | hors module -> 004 | `transferEnrollment` (changement de classe + `enrollment_placements`), `changeEnrollmentFunding`, `suspendEnrollment`/`resumeEnrollment`/`withdrawEnrollment`, `recordEnrollmentOutcome` | Le legacy changeait `class_id` sans historique ni contrôle (tenant, année, capacité). |
| S-065 | Supprimer une inscription `DELETE /enrollments/:id` | R/enrollments.ts:1344-1415 | hors module -> 004 | `cancelEnrollment` (statut `CANCELLED`, jamais de suppression) | Le DELETE cascadait sur `payment_transactions` et `student_tuition_installments` (perte de l'historique financier). |
| S-066 | « Fix fees » `POST /enrollments/fix-fees` | R/enrollments.ts:1418-1490 | abandonné | — | Rattrapage « temporary » laissé en production, sans rôle ; les frais n'existent plus dans l'inscription. |

### 2.G Inscriptions Professional (côté élève) : `/professional/...`, `professional_enrollments`

Toute cette famille relève de `academic` (inscription à la carte, mode `A_LA_CARTE`) et de `finance` (commande, paiement). Côté people ne subsistent que : la projection `student_enrollment_summaries` (inscriptions visibles dans la fiche élève) et la règle `isGuardianOfStudent` pour les vues parent.

| ID | Fonction | Référence | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| S-070 | Inscription directe par un admin `POST /professional/ue-sessions/:id/enrollments` (`adminEnrollStudent`) | R/professional.ts:2944-2965 ; SE:636-720 (P-050) | hors module -> 004 | `enrollStudent` (`mode='A_LA_CARTE'`) + `addEnrollmentCourse` (offre) ; facture via événement `academic.enrollment_course.requested` (014) | Contrôles manquants du legacy (statut de cohorte, fenêtre, capacité, prérequis, UE inactive) = `checkOfferingEligibility` ; `withTenantTx` COMMIT sur échec n'existe plus. |
| S-071 | Inscription en lot N x M (`adminEnrollBulk`) | R/professional.ts:2968-2988 ; SE:726-787 (P-051) | hors module -> 004 | `enrollStudentsBulk` | Borne explicite du lot. |
| S-072 | Détail d'une inscription `GET /professional/enrollments/:id` | R/professional.ts:2991 ; SE:1354 (P-053) | hors module -> 004 | `getEnrollment` | — |
| S-073 | Changer le statut `PATCH /professional/enrollments/:id` (`adminUpdateEnrollment`) | R/professional.ts:3002 ; SE:1388-1415 (P-054) | hors module -> 004 | `suspend/resume/withdraw/cancel/completeEnrollmentCourse` avec machine à états | Le legacy autorisait toute transition, marquait la commande « payée » sans paiement, annulait toute la commande. Le lien avec la facture passe par événements (014). |
| S-074 | Supprimer une inscription `DELETE /professional/enrollments/:id` | R/professional.ts:3026 ; SE:1418 (P-055) | hors module -> 004 | `cancelEnrollmentCourse` (jamais de DELETE) | Cascade sur les paiements du legacy. |
| S-075 | Lister (admin) `GET /professional/enrollments` | R/professional.ts:3107 ; SE:1262-1351 (P-052) | hors module -> 004 | `listEnrollments` | Le legacy exposait le téléphone de l'élève (`sp.phone`) : plus dans cette liste. |
| S-076 | Marquer « terminée » `POST /professional/enrollments/:id/complete` | R/professional.ts:3125 ; SE:1232 (P-056) | hors module -> 004 | `completeEnrollmentCourse` ; permission `enrollment.course.manage` ; recalcul des résultats par événement (011/019) | Un enseignant pouvait clore n'importe quelle inscription du tenant. |
| S-077 | Catalogue étudiant `GET /professional/student/programmes`, `/student/catalog` | R/professional.ts:3157-3175 ; SE:267-412 (P-060, P-061) | hors module -> 004 | `GET /academic/catalog` (éligibilité, places, prérequis) | La « Conduite » est détectée par libellé `ILIKE 'conduite%'` : remplacée par `curriculum_nodes.is_transversal`. |
| S-078 | Panier et commande (`addToCart`, `validateOrder`, `GET /student/cart`, `/student/orders`) | R/professional.ts:3203-3300 ; SE:830-1172 (P-063 à P-066) | hors module -> 014 | `finance` (commande) ; réservation de place : `academic.enrollment_courses.hold_expires_at` (`pending_hold_minutes`) | Le legacy réservait un siège dès le panier sans expiration ; bug « dernière place » (bug 1 du §7.1 de `legacy-pro-enrollment.md`). |
| S-079 | Auto-inscription directe `POST /student/enroll` (`studentSelfEnroll`) | R/professional.ts:3235 ; SE:924-1014 (P-067) | hors module -> 004 | `enrollStudent` avec `source_kind='ONLINE'` et la même éligibilité que le catalogue | Le legacy ignorait fenêtre et prérequis ici (≠ `addToCart`). |
| S-080 | Mes inscriptions, ECUE débloquées, reçus, emploi du temps, paiements | R/professional.ts:3331-3384 ; SE:415-444,1175-1227,1508 | hors module -> 004 | `GET /academic/me/enrollments` ; reçus/paiements : 015 ; emploi du temps : 017 | « Année scolaire » et « nom de classe » dérivés d'un libellé (pivot septembre, tiret cadratin) : remplacés par `academic_year_id` et `classrooms.name`. |
| S-081 | Porte de la scolarité (`inscriptionSoldee`, `confirmerSiInscriptionSoldee`) | S/professional-inscription-gate.ts:26-87 (P-081) | hors module -> 004 | `institution_settings.enrollment_confirmation_policy = 'ON_REGISTRATION_FEE_PAID'` ; confirmation sur `finance.invoice.paid` | La tolérance 0,5 et l'évaluation à la création et à chaque encaissement passent en politique d'établissement. |
| S-082 | Barème de classe en commandes (`ensureBaremeOrders`) | SE:511-575 (P-089) | hors module -> 014 | `finance` (grille de frais, factures) | Finance déguisée dans le service d'inscription. |
| S-083 | Capacité de cohorte (`syncSessionCapacity`, `computeSessionCapacityStatus`) | SE:76-90, 225-249 (P-082) | hors module -> 004 | `classroom_offerings.status` OPEN/FULL dérivé de la capacité (job et déclencheur) | — |
| S-084 | Vues parent du module pro (`/professional/parent/*`) et contrôle `isParentOfChild` | R/professional.ts:3388-3530 ; SE:1440-1498,1628 (P-071) | hors module -> 004 | `GET /children/:studentId/...` de chaque module ; contrôle = `people.isGuardianOfStudent` (008) | Le contrôle legacy ne regardait ni `relationship_type`, ni `can_pickup`, ni `is_primary_contact`. |

### 2.H Matricules et numérotation

| ID | Fonction | Référence | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| S-022 | `enforceSequentialMatricules` (réécriture de `student_number` et `establishment_matricule` par rang d'ancienneté à CHAQUE `GET /students`) | R/students.ts:60-85 | abandonné | — (numéro immuable) | Lecture avec effet de bord massif ; identifiant instable (supprimer un élève décalait tous les suivants) ; risque de collision UNIQUE transitoire -> 500 ; matricules imprimés sur bulletins invalidés. |
| S-023 | `getNextEstablishmentMatricule` (2 copies : R/students.ts:87-101 ; R/registration-requests.ts:57-70) | R/students.ts:87-101 | amélioré | `people.next_number('STUDENT')` + `settings.student_number_pattern` (défaut `{SEQ:5}`) ; réglage `people.settings.manage` | Compteur verrouillé (pas de course `MAX+1`) ; motif configurable (fin de `10000` et de `^[0-9]{5}$` codés en dur, plafond de 89 999) ; un seul générateur. |
| S-090 | `cleanFiliereCode` (code de classe nettoyé, défaut `XXX`) | SE:122-124 (P-088) | hors module -> 004 | jeton `{PROGRAM}` de `registration_number_pattern` ; `academic.programs.code` déjà normalisé | — |
| S-091 | `formatProfessionalMatricule` (`IPAM-<CODE>-<NNNN>`) | SE:131-137 (P-088) | hors module -> 004 | `institution_settings.registration_number_prefix` = `IPAM`, `registration_number_pattern` = `{PREFIX}-{PROGRAM}-{STUDENT_SEQ:4}` | Le préfixe d'un établissement unique (« IPAM ») n'est plus dans le code. |
| S-092 | `ensureProfessionalMatricule` (attribution idempotente à la 1re mise au panier/inscription) | SE:157-193 (P-088) | hors module -> 004 | généré par `enrollStudent` à partir de `students.sequence_number` (via `StudentDirectory`) ; unique `(tenant, institution, registration_number)` | Le legacy retournait `null` sans erreur si `sequence_number` manquait ; ici NOT NULL. |
| S-093 | Numéro d'ordre figé (trigger `assign_student_sequence_number`) | M/0094:73-98 | amélioré | `students.sequence_number` posé par `people.next_number` (gapless, verrouillé jusqu'au COMMIT), immuable | Corrige la réutilisation d'un numéro après suppression du maximum (`MAX+1`). |
| S-094 | Matricule numérique automatique (= S-022 + S-023, mêmes fonctions) | R/students.ts:60-101 | amélioré | voir S-023 (génération reconduite, corrigée) ; la réécriture S-022 est abandonnée | Entrée d'inventaire redondante avec S-022 et S-023, conservée pour exhaustivité. |
| S-095 | Ancien générateur SQL `generate_student_number` (« STU<année><NNN> ») | M/0003:77-115 | abandonné | — | Dormant et bugué (§1.8). |
| S-096 | Numéro d'inscription « formations courtes » (`generate_enrollment_number`, repli `INS-DATA-AAAAMMJJ-NNN`) | S/inscription-pro.service.ts:264-305 | abandonné | — (voir §7, point 17) | Module formations courtes sans spec v2 ; numérotation propre à ce module. |

### 2.I Portails parent et élève (côté lecture des liens), vues enseignant

| ID | Fonction | Référence | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| S-110 | Mes enfants `GET /parent/children` | R/parent-children.ts:131-356 | amélioré | `GET /children` -> `listChildrenOfIdentity` ; permission `student.child.read` ; classe/niveau via projection | Un seul contrôle de lien (`isGuardianOfStudent`) au lieu de 6 copies ; plus de N+1 requêtes ; toutes inscriptions prises en compte ; moyenne et assiduité fournies par 011/010 via `/children/:studentId/...`. |
| S-111 | Détail d'un enfant `GET /parent/children/:childId` | R/parent-children.ts:359-545 | amélioré | `GET /students/:id` sous `student.child.read` + règle `isGuardianOfStudent` | Règle de domaine (lien vivant, `portal_access`) et non simple existence d'une ligne. |
| S-112 | Synthèses enfant : notes, emploi du temps, prochains cours, assiduité, historique d'absences | R/parent-children.ts:547,752,1179,1439,1689 | hors module -> 011 | `/children/:studentId/...` de 011/013 (notes), 017 (emploi du temps), 010 (assiduité) | Le contrôle de lien appelle `isGuardianOfStudent`. |
| S-113 | Autres routes parent (`/parent/academic`, `documents`, `grades`, `homework`, `messages`, `payments`) | R/parent-academic.ts, parent-documents.ts, parent-grades.ts, parent-homework.ts, parent-messages.ts, parent-payments.ts | hors module -> 004 | 004/011/013/014/015/016/024 (permissions `*.child.*` de chaque module) | Tous dépendent de `student_parents` : le point commun est `isGuardianOfStudent`. Détail de chaque route : parités de ces modules. |
| S-114 | Contacts d'urgence du parent (`/parent/emergency/contacts` et doublon `/parent/settings/emergency-contacts`) | R/parent-emergency.ts:78,181,349,585 ; R/parent-settings.ts:656,777,982,1227 | amélioré | `GET/POST /students/:id/emergency-contacts` (`upsertEmergencyContact`, `removeEmergencyContact`) ; `student.update` | Contacts rattachés à l'élève ; doublon de routes supprimé ; édition par le tuteur depuis le portail : décision en §7. |
| S-115 | Autorisation de retrait modifiable par le parent (`PUT /parent/emergency/pickup-authorization/:id`) | R/parent-emergency.ts:680,782 | abandonné | `updateGuardianLink` (`can_pickup`) réservé au personnel ; lecture dans `GET /children` | Un parent s'auto-autorisait ; l'école n'avait pas la main ; PUT en 500 (`updated_at` absent). |
| S-116 | Changement du type de relation par le parent (`PUT /parent/emergency/relationship-types/:id`) | R/parent-emergency.ts:944,1055 | abandonné | `updateGuardianLink` (`relationship_code`) réservé au personnel | « Nécessite une approbation » annoncée mais aucun workflow n'existe ; PUT en 500. |
| S-117 | Niveau d'accès aux données (`full` / `limited` / `view-only`) `GET /parent/emergency/data-access` | R/parent-emergency.ts:1223-1337 | amélioré | `student_guardians.portal_access` + `relationship_types.kind` + `isGuardianOfStudent` | Purement informatif dans le legacy (aucune route ne filtrait selon `relationship_type`) ; devient une règle réellement appliquée. Les 3 niveaux ne sont pas repris tels quels : §7. |
| S-118 | Réglages du parent (profil, contact, préférences de notification, relations, mot de passe) | R/parent-settings.ts:70,196,388,492,1344,1495,1721,1842 | hors module -> 002 | profil/mot de passe : `iam` ; préférences : 016 ; coordonnées du tuteur (téléphone, adresse) : `persons` | Téléphone/adresse/date de naissance renvoyaient toujours `null` (colonnes inexistantes) ; `change-password` n'actualisait pas `initial_password` ; route d'auto-édition des coordonnées du tuteur absente du brief : §7. |
| S-120 | Classes de l'enseignant `GET /teacher/students/classes` (identité par `x-user-id`) | R/teacher-students.ts:38-163 | hors module -> 009 | `GET /me/classes` (009) | Identité forgeable par en-tête. |
| S-121 | Élèves de l'enseignant `GET /teacher/students` | R/teacher-students.ts:166-356 | hors module -> 004 | `getRoster` (`GET /academic/classrooms/:id/roster`) filtré par `teaching_assignments` (009) | Exposait le téléphone ; pagination et COUNT divergents. |
| S-122 | Performance et progression par classe (`/teacher/students/classes/performance`, `/progress`) | R/teacher-students.ts:359,512 | abandonné | — | Métriques `average`/`attendance` jamais implémentées (TODO) ; les vraies viennent de 011/010/025. |
| (§2.13-a) SI-1 | Résolution de l'élève du portail (`student_profiles WHERE user_id`, ~25 occurrences) | R/student-courses.ts, student-assignments.ts, student-grades.ts, student-messages.ts, student-payments.ts | amélioré | `resolveStudentForIdentity` (identité -> `persons.identity_id` -> `students`) ; `student.self.read` | Une seule résolution, sans repli. |
| (§2.13-b) SI-2 | Défauts du portail élève : utilisateur par défaut codé en dur `6d9dd979-...`, `student_id`/`x-student-id` fournis par le client (IDOR), repli sur « n'importe quel élève » | R/student-courses.ts:103,112-137,325,744 ; R/student-assignments.ts:422 ; R/student-payments.ts:236 | abandonné | — | Failles d'autorisation ; remplacées par `*.self.*` + résolution d'identité. |
| (§2.13-c) SI-3 | Routes du portail élève (`/student/courses`, `assignments`, `grades`, `messages`, `/student-payments`) | R/student-courses.ts:45,286,712,833 ; R/student-assignments.ts:53,371 ; R/student-grades.ts:61 ; R/student-messages.ts ; R/student-payments.ts | hors module -> 011 | 004/011/014/015/016/022 (`/me/...` de chaque module) | Hors périmètre élève/tuteur ; point commun = `resolveStudentForIdentity`. |

### 2.J Imports et exports, lectures décisionnelles

Le legacy n'a **aucune fonction d'import d'élèves** (vérifié : pas de route d'import dans `students.ts` ni `enrollments.ts`). La reprise de données legacy -> v2 relève de la spec 031 (imports) ; les règles de mapping sont ici en §1 et §7.

| ID | Fonction | Référence | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| S-123 | Démographie propriétaire et export CSV (`GET /owner/personnes`, `/owner/personnes/export`) | R/owner/index.ts:882,1112 ; S/owner-personnes.service.ts | hors module -> 025 | `analytics` ; export de la liste d'élèves sous permission + audit : absent du brief 008 (§7) | Évitait volontairement `GET /students` à cause de S-022 ; pyramide des âges, nationalités = analytics. |
| S-124 | Autres lectures propriétaire (`/owner/pulse`, `risque`, `economie`, `recrutement`, `prospection`) | S/owner-pulse.service.ts:430-485 ; owner-economie ; owner-recrutement | hors module -> 025 | `analytics` (consomme `people.student.*` et `academic.enrollment.*`) | Ne s'appuyaient pas sur `student_status_history`. |

### 2.K Divers : code mort, provenance

| ID | Fonction | Référence | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| S-099 | Tableaux de bord étudiant (`/students/dashboards`, widgets, templates) | R/student-dashboard.ts (820 l.) ; C/student-dashboard.ts ; M/0001_student_dashboard_tables.sql | abandonné | — | Non enregistré (index.ts:122, 366-367 commentés) ; confond `request.userId` et `student_id`. |
| (§2.10) SI-4 | Endpoints de debug en production (`/test-materials`, `/debug-student-data` avec tenant et élève codés en dur, `/check-table-structure`, `/create-test-materials`) | R/student-courses.ts:463,503,577,610 | abandonné | — | Actifs en production, sans contrôle de rôle, avec identifiants réels codés en dur. |
| S-102 | Provenance d'un élève (`/prospection/provenances`, bulk) | R/prospection.ts:125-208 ; S/prospection.service.ts:282-518 | hors module -> 007 | `admissions` (canal d'acquisition de la candidature) | Donnée commerciale liée à l'acquisition, pas au dossier permanent ; 1 par élève dans le legacy. |
| S-103 | Commerciaux et commissions (`/prospection/commerciaux`, `/commissions/*`, `/versements`, `/dashboard`) | R/prospection.ts:81-276 | hors module -> hors plan | Prospection hors plan v2 (si reprise : 014/015) | Commission recalculée sur paiements de scolarité : finance. |

---

## 3. Règles métier implicites et défauts

« Reproduite comme » = règle maintenue (forme v2) ; « corrigée » = défaut legacy supprimé.

### 3.1 Algorithmes de matricule : formats, génération, collisions

| # | Identifiant legacy | Format et génération (réf.) | Collisions / défauts | Sort en v2 |
|---|---|---|---|---|
| 1 | `student_number` | `^[0-9]{5}$`, ex. `10001`. Création : `MAX(establishment_matricule)+1` sur `^[0-9]{5}$`, défaut 10000 (R/students.ts:87-101) ; puis **réécrit à chaque `GET /students`** par `ROW_NUMBER() OVER (ORDER BY created_at, id) + 10000` (R/students.ts:60-85, appel :364) | Aucun verrou : deux créations simultanées lisent le même MAX -> UNIQUE violée -> 500 ; rang d'ancienneté, donc instable ; collision transitoire de l'UPDATE sur UNIQUE non différable ; plafond 89 999 (6 chiffres hors regex) ; `PUT` accepte une valeur écrasée au listing suivant | **corrigée** : `students.student_number` rendu à partir de `settings.student_number_pattern` (jetons `{SEQ:n}`, `{YYYY}`, `{YY}`, `{PREFIX}`), valeur du compteur gapless `people.next_number('STUDENT')`, **immuable** (trigger) |
| 2 | `establishment_matricule` | Miroir de `student_number` maintenu à la main (R/students.ts:2054-2063) | Deux colonnes pour un numéro ; conflits testés sur `(student_number = X OR establishment_matricule = X)` | **abandonnée** (fusionnée dans `student_number`) |
| 3 | `student_matricule` | Texte libre trim, 1 à 50 car., unique par tenant (index partiel M/0088:38-40) ; obligatoire à `with-user`, facultatif ailleurs, NULL pour les élèves venus d'une demande | Comparaison sensible à la casse (`A1` ≠ `a1`) alors que l'index de recherche est sur `lower()` ; conflit détecté par SELECT préalable (course) | **corrigée** : `students.external_ref`, unique partiel par tenant, facultatif ; normalisation de casse à trancher (§7) |
| 4 | `sequence_number` | Trigger BEFORE INSERT, verrou consultatif par tenant, `MAX+1` (M/0094:73-98) ; backfill par ancienneté | Un numéro est **réattribué** si l'élève de numéro maximal est supprimé : un matricule imprimé peut désigner une autre personne | **corrigée** : `students.sequence_number` = valeur du compteur, NOT NULL, unique, immuable ; plus de suppression ; conservé tel quel à la migration |
| 5 | Matricule pro IPAM | `IPAM-<CODE>-<NNNN>` ; `CODE` = code de la classe nettoyé (`upper`, `[^A-Z0-9]` retirés, défaut `XXX`) ; `NNNN` = `sequence_number`, pad 4 minimum ; un même élève garde le même NNNN dans toutes ses classes (SE:122-137, 157-193 ; M/0093) | Jamais recalculé si le code de classe change ; préfixe d'un établissement unique codé en dur ; unicité `(tenant, classe, seq)` ; histoire de 3 formats (0086, 0093, 0094) ; élève sans `sequence_number` -> aucun matricule, sans erreur | **reproduite comme** donnée : `academic.enrollments.registration_number`, motif `{PREFIX}-{PROGRAM}-{STUDENT_SEQ:4}` (004) ; matricules imprimés migrés tels quels (031) |
| 6 | `generate_student_number` (« STU<année><NNN> ») | Fonction + trigger BEFORE INSERT (M/0003:77-115) | Bug : `SUBSTRING ... '[0-9]+$'` capture `2026001` -> `STU20262026002` puis débordement INTEGER ; jamais déclenché | **abandonnée** |
| 7 | `dsps_matricule`, `dsps_previous_matricule` | Saisis, sans contrainte | Doublons possibles | **reproduite comme** `students.national_student_id` (unique partiel) et `attributes.previous_national_student_id` |
| — | Numéros de documents : `PRO-<AAAA>-NNNNNN`, `FRAIS-<student>-<prog>-<nature>`, `ATT-<matricule>`, `INS-DATA-AAAAMMJJ-NNN`, `receipt_number` | SE:448-491 ; professional-attestations.service.ts:190 | `MAX+1` + 5 essais SAVEPOINT | hors module (014/015/024) ou abandonnés |

Algorithme v2 (cible) : dans **une seule transaction** `createStudent` : (1) `people.next_number('STUDENT')` insère ou incrémente la ligne `(tenant, 'STUDENT', '')` de `number_sequences` ; la ligne reste verrouillée jusqu'au COMMIT, un ROLLBACK restitue le numéro ; le trigger `number_sequences_guard` interdit tout pas différent de +1 ; (2) `student_number` = rendu du motif ; (3) insertion de `persons` puis `students` (`sequence_number` = valeur) ; (4) ligne d'historique `NULL -> ACTIVE` ; (5) trigger `students_guard` : `student_number`, `sequence_number`, `person_id` figés. Collisions possibles : uniquement à la migration (reprise des compteurs : `last_value` doit être initialisé au-dessus du plus grand `sequence_number` importé, sinon violation UNIQUE `(tenant_id, sequence_number)`).

### 3.2 Statuts

| Règle legacy | Réf. | Sort en v2 |
|---|---|---|
| Statut élève : `active, graduated, suspended, dropped, transfer`, **toute valeur acceptée par `PUT`** sans matrice de transitions, sans motif | M/0003:5 ; R/students.ts (champ `status` de S-015) | **corrigée** : `ACTIVE, INACTIVE, GRADUATED, WITHDRAWN, TRANSFERRED_OUT, EXCLUDED, ARCHIVED` ; transitions imposées par `students_guard` : `ACTIVE <-> INACTIVE` ; `ACTIVE`/`INACTIVE` -> `GRADUATED`, `WITHDRAWN`, `TRANSFERRED_OUT`, `EXCLUDED` ; statuts finaux -> `ARCHIVED` ou `ACTIVE` (réinscription, levée de sanction avec motif côté domaine) ; `ARCHIVED` -> `ACTIVE` ; `ACTIVE` -> `ARCHIVED` interdit |
| Correspondance de migration | — | `active` -> `ACTIVE` ; `graduated` -> `GRADUATED` ; `suspended` -> `INACTIVE` (perte de nuance « suspendu » : §7) ; `dropped` -> `WITHDRAWN` ; `transfer` -> `TRANSFERRED_OUT` |
| Statut de la fiche et statut des inscriptions **découplés** (changer l'un ne touche pas l'autre ; `graduated` jamais posé automatiquement ; `transfer` ≠ `transferred`) | §4.2, §6.3 n°18 de l'inventaire | **corrigée** : sens unique documenté : `academic` consomme `people.student.status_changed` (brief) ; `people` consomme `academic.enrollment.*` pour la projection seulement ; qui bascule `GRADUATED`/`WITHDRAWN` : §7 |
| Statut d'élève n'empêche pas la connexion (S-004) | R/auth.ts | **à trancher** (iam sur événement ?) : §7 |
| Historique : trigger sur UPDATE seulement, `changed_by`/motif jamais renseignés, erreurs avalées | M/0099:65-87 | **corrigée** (§1.5) |
| Statut d'inscription : `active/suspended/completed/dropped/transferred` ; pro : `en_attente_paiement/confirmee/terminee/annulee`, transitions libres | M/0005:28 ; M/0069 | hors module -> 004 : machine à états `PENDING -> ACTIVE -> COMPLETED`, `SUSPENDED`, `WITHDRAWN`, `TRANSFERRED_OUT`, `CANCELLED` |

### 3.3 Doublons

| Règle legacy | Réf. | Sort en v2 |
|---|---|---|
| Aucune détection de doublon de **personne** (nom + date de naissance). Seuls : e-mail du compte (exact par tenant dans S-014/S-015/S-042/S-007 ; `LOWER()` dans S-001/S-002/S-052/S-056 ; unicité globale en base côté SQL, par tenant côté Prisma) et `student_matricule` | M/0055:301 ; P/:3539 | **corrigée** : `createStudent` appelle `findDuplicateStudents` (sonde `persons_duplicate_probe` sur `(tenant, search_key, birth_date)` + e-mail + téléphone + `external_ref` + `national_student_id`), réglage `settings.duplicate_check_enabled` ; la création renvoie les candidats et n'aboutit qu'avec confirmation explicite (forme exacte à fixer dans la spec) ; `GET /students/duplicates` |
| Pas de fusion, nulle part | — | **pas de fusion en v1** (décision à signaler) : les doublons restent deux dossiers ; la migration (031) les signale sans les fusionner ; conséquence : le dossier doublon est archivé (`ARCHIVED`) plutôt que supprimé |
| Un seul compte par e-mail dans toute la plateforme ; frères et sœurs ne peuvent pas partager l'e-mail du parent | §5 de l'inventaire | **corrigée** : l'e-mail d'une personne n'est plus une clé de compte ; un élève peut n'avoir ni e-mail ni compte ; plusieurs personnes peuvent partager un e-mail de contact (non unique dans `persons`) |
| Demande d'inscription : une seule demande `pending` par e-mail (index unique partiel) | M/0060:48-56 | hors module -> 007 (règle à reproduire dans admissions) |

### 3.4 Droits par rôle (ce que le legacy vérifiait réellement)

| Famille de routes | Contrôle legacy | v2 |
|---|---|---|
| `GET/POST/PUT/DELETE /students*`, `GET /students/:id/parents`, diplôme (upload/lecture), `credentials-template`, `send-credentials`, `POST /users`, `/enrollments*` | **Aucun** (authentification + tenant seulement) | `student.read/list/create/update/status.update/sensitive.read` ; `guardian.read/manage` ; `enrollment.*` (004) |
| `POST /students/:id/reset-password`, `POST/DELETE /students/:id/parents` | `admin` ou `super_admin` (rôle actif) | iam (reset) ; `guardian.manage` |
| `/parents*` | `admin` ou `super_admin` (pas `owner`) | `guardian.read/manage` |
| `/registration-requests*` | `ensureAdmin` : `admin|owner|super_admin` cherchés aussi dans `availableRoles` (escalade possible) | permissions de 007 ; plus de lecture des rôles non actifs |
| `/professional/...` inscriptions | `requireAdmin` (`admin|super_admin|administrateur`), `requireStudent`, `requireParent`, `requireAdminOrTeacher` (MW/professional-guards.ts:51-69) | `enrollment.read/create/update/cancel`, `enrollment.course.manage`, `enrollment.self.read`, `enrollment.child.read` (004) |
| `/parent/*` | `roles.includes('parent')` + existence d'une ligne `student_parents` ; repli sur l'en-tête `x-user-id` (136 occurrences dans src) | `*.child.read` + `isGuardianOfStudent` ; identité = JWT uniquement |
| `/student/*` (portail) | Aucun contrôle de propriété (IDOR) | `*.self.read` + `resolveStudentForIdentity` |
| `/teacher/students` | Identité par `x-user-id` | 009 : `/me/classes`, `teaching.read` |
| Visibilité du mot de passe en clair | `owner/admin/super_admin/administrateur` (MW/credentials-visibility.ts:22-41) | **abandonnée** : plus de mot de passe stocké |
| Rôles admin personnalisés (`admin_roles`, M/0091) | Menus du sidebar uniquement | RBAC iam (002) |
| Audit | Aucun (hors journal super-admin) | Audit transverse (030) : écritures de `people`, lectures du bloc sensible |

### 3.5 Liens parent-élève

| Règle legacy | Réf. | Sort en v2 |
|---|---|---|
| Le parent doit détenir le rôle `parent` dans `user_roles` pour être rattaché ; un parent « inféré » est refusé | R/students.ts:2262-2459 | **corrigée** : un tuteur est une personne ; `provisionPortalAccount` donne l'accès portail |
| Aucune contrainte sur le nombre de contacts principaux | M/0003:70 | **corrigée** : index unique partiel `student_guardians_one_primary` |
| `can_pickup` défaut `true` ; modifiable par le parent lui-même | M/0003:39 ; R/parent-emergency.ts | **corrigée** : défaut `false` ; seul le personnel modifie |
| Le lien est vérifié par simple existence de ligne, dans 6 copies | R/parent-*.ts | **corrigée** : règle unique `isGuardianOfStudent(identité, élève)` : lien vivant (`valid_to` NULL ou futur), `portal_access = true` |
| Suppression d'un parent refusée s'il a des enfants | R/parents.ts:1134-1294 | **reproduite comme** : archivage refusé tant qu'un lien est vivant |
| Contacts d'urgence propres au parent, partagés par ses enfants | M/0030 | **corrigée** : par élève |
| Le « type de relation » ne conditionnait aucun droit (`full`/`limited`/`view-only` purement informatif) | R/parent-emergency.ts:1223-1337 | **corrigée** : `portal_access` + type de lien `kind` ; périmètre exact de `isGuardianOfStudent` pour les liens `EMERGENCY` : §7 |

### 3.6 Autres défauts à ne pas reproduire

| Défaut legacy | Réf. | Statut |
|---|---|---|
| Lecture avec écriture massive (`GET /students`) | R/students.ts:364 | corrigée |
| `BEGIN` sans `ROLLBACK` sur retours anticipés (`PUT /students` x6, POST/DELETE parents) | R/students.ts:1824-2094, 2367-2668 | corrigée (une transaction par cas d'usage) |
| Course sur le prochain matricule, absence de transaction | R/students.ts:922, 1202 | corrigée |
| Hard delete en cascade (élève, inscription) | R/students.ts:2179 ; R/enrollments.ts:1344 | corrigée (aucune suppression physique) |
| Compte `users` laissé orphelin après suppression d'un élève ; e-mail non réutilisable | S-016 | corrigée (le dossier est archivé, l'identité relève d'iam) |
| Genre défaut `masculin`, bourse défaut `non`, affectation défaut `affecte`, `is_inscribed` true | R/students.ts:572 ; R/enrollments.ts | corrigée (aucun défaut inventé) |
| `phone` 20 car. vs 40 dans la demande | M/0003:21 ; M/0060 | corrigée (5 à 40) |
| Erreurs 500 renvoyant `error.message` brut ; piles d'erreur en `console.error` ; identifiants dans les logs | R/auth.ts:345-349 ; R/students.ts:1433-1439 | corrigée (erreurs typées, aucun PII dans les logs) |
| Deux pistes de migrations (SQL et Prisma) qui ne se recouvrent pas ; `gender` testé via `information_schema` à chaque appel | §0 de l'inventaire | corrigée (une seule suite de migrations 0800-0899, RLS forcée) |
| Nom `filiere_id` = classe ; séparateur « — » et libellés `conduite%` comme clés | R/professional | hors module -> 004 |

---

## 4. Données personnelles sensibles

Politique cible : lecture des champs « sensibles » sous `student.sensitive.read` ; tout accès au bloc sensible et toute écriture sont audités (030) ; stockage de fichiers uniquement par `StoragePort`/documents (024) ; RLS forcée ; aucune PII dans les URL, les logs ni les messages d'erreur. Le classement des colonnes entre `student.read` et `student.sensitive.read` ci-dessous est une **proposition** à valider dans la spec 008.

| Donnée | Colonne legacy | Exposition legacy | Cible v2 | Permission / audit / stockage |
|---|---|---|---|---|
| Identité (nom, prénoms, sexe) | `users.first_name/last_name`, `gender` | tout utilisateur du tenant | `persons.last_name/first_name/other_names/sex` | `student.read` ; écriture auditée |
| Naissance (date, lieu), nationalité | `date_of_birth`, `place_of_birth`, `nationality` | tout utilisateur du tenant | `persons.birth_date/birth_place/nationality` | `student.read` (la date de naissance sert à la détection de doublons) |
| Coordonnées (téléphone, e-mail, adresse, résidence) | `phone`, `address`, `residence`, `users.email` | tout utilisateur du tenant (liste enseignant incluse) | `persons.phone/phone_alt/email/address_line/city/residence` | `student.read` ; jamais dans les listes enseignants (009 n'accorde pas `student.read`) |
| État civil officiel | `birth_certificate_number/date`, `civil_registry_office`, `sub_prefecture` | tout utilisateur du tenant | `students.birth_certificate_*`, `civil_registry_office`, `attributes.sub_prefecture` | **`student.sensitive.read`** ; lecture auditée |
| Identifiant national (tutelle) | `dsps_matricule`, `dsps_previous_matricule` | tout utilisateur du tenant | `students.national_student_id`, `attributes.previous_national_student_id` | **`student.sensitive.read`** ; lecture auditée |
| Filiation | `father_name`, `mother_name` | tout utilisateur du tenant | `students.attributes` | **`student.sensitive.read`** |
| Historique scolaire et diplômes (dont bac, dernier diplôme, CEPE) | `bac_*`, `last_diploma`, `cepe_code`, `origin_school` | tout utilisateur du tenant (fichier lisible sans rôle, S-021) | `student_prior_education` + `document_ref` (024) | **`student.sensitive.read`** ; fichier : stockage objet chiffré, URL signée courte, lecture auditée |
| Photo | (aucune) | — | `persons.photo_object_key` via `uploadStudentPhoto` | Clé d'objet par tenant, URL signée ; `student.update` pour écrire ; jamais d'URL publique |
| Contacts d'urgence (tiers) | `emergency_contacts.*`, `emergency_phone` | parent propriétaire + tout utilisateur via la fiche | `student_emergency_contacts` | **`student.sensitive.read`** (PII de tiers) ; écriture `student.update` |
| Tuteurs : coordonnées, profession | `users.*`, rôle parent | admin | `persons` + `guardians.occupation/employer` | `guardian.read` ; écriture `guardian.manage` |
| Autorisation de retrait, garde légale, responsabilité financière | `student_parents.can_pickup` | modifiable par le parent | `student_guardians.can_pickup/has_legal_custody/is_financial_responsible` | `guardian.read` ; écriture `guardian.manage` (personnel seul) |
| Statut, motif de sortie ou d'exclusion | `status`, `student_status_history.reason_text` | tout utilisateur | `students.status`, `student_status_history.reason_*` | statut : `student.read` ; **motif : `student.sensitive.read`** ; écriture `student.status.update` |
| Mots de passe | `users.initial_password`, `student_profiles.initial_password`, e-mails d'identifiants | en clair, renvoyés, listés aux rôles owner/admin | **aucun** | Purgés, jamais migrés ; activation par lien (iam) |
| Provenance commerciale, commissions | `student_provenances`, `commerciaux` | admin | hors module (007 / hors plan) | — |
| Demandes d'inscription (PII de non-clients) | `registration_requests` | admin ; jamais purgée ; aucun consentement tracé | hors module -> 007 | Durée de conservation et base légale à définir en 007 |
| Export de listes | `/owner/personnes/export` (CSV) | `requireOwner` | hors module -> 025 | Permission dédiée + audit de l'export |
| Effacement / anonymisation (droit d'effacement) | `DELETE` physique | cascade destructrice | Anonymisation par UPDATE des colonnes d'identité (la suppression est interdite par triggers) | Procédure à spécifier (030) ; l'historique d'inscription et financier est conservé pour obligations légales |
| Journalisation | `console.error`, `fastify.log.info` d'identifiants | PII et mots de passe dans les logs | — | Aucun PII en clair dans les logs |

---

## 5. Constantes et valeurs par défaut codées en dur

| Constante legacy | Où | Destination v2 |
|---|---|---|
| `10000` (base du matricule) et regex `^[0-9]{5}$` (89 999 max) | R/students.ts:60-101 | `people.settings.student_number_pattern` (défaut `{SEQ:5}`), compteur `people.number_sequences` |
| Préfixe `IPAM` + 4 chiffres | SE:116-137 | `academic.institution_settings.registration_number_prefix/pattern` (004) |
| `STU` + année + 3 chiffres | M/0003:77-115 | abandonné |
| `PRO-<AAAA>-NNNNNN`, `FRAIS-...`, `ATT-...`, `DIP-...`, `INS-DATA-...` | SE:462,593,569 ; autres services | numérotations des modules documents/finance (014/015/024) ; `INS-DATA` abandonné |
| Devise `XOF` par défaut | colonnes `fees`, `devise` ; SE:571 | `tenancy` / `finance` (devise du tenant) ; pas dans people |
| Tolérance de solde 0,5 | S/professional-inscription-gate.ts:57 ; M/0127:53 | politique `enrollment_confirmation_policy` (004) + règles d'arrondi finance (014) |
| Pivot d'année scolaire au 1er septembre ; séparateur de libellé « — » (tiret cadratin) | SE:1187-1192 ; S/owner-pro-annee.sql.ts:155-182 | `academic.academic_years` (dates), `classrooms.name` (données) |
| `current_year` 1..10 | schéma Fastify | `academic.grade_levels` (données de pack) |
| Mot de passe de 12 caractères, `Math.random`, bcrypt coût 10 ou 12 | R/students.ts:39-58 ; R/parents.ts:42-58 | `iam` (politique de mot de passe, hachage) ; aucun mot de passe généré par people |
| JWT 24 h | S/user-auth.service.ts:246 | `iam` |
| `LOGIN_URL` par défaut `https://ecoledigitale.engage-360.net/login`, slug de référence `ecoledigitale` | R/students.ts:31-36 ; R/parents.ts:18-23 ; R/registration-requests.ts:7-12 | domaine du tenant (`tenancy`), gabarits 016 |
| E-mails factices `<role>@<slug>.local`, `eleve.<matricule>@<slug>.local` | S/tenant-provisioning.service.ts:198-310 ; R/registration-requests.ts | abandonné (un élève peut ne pas avoir d'e-mail) |
| UUID codés en dur : utilisateur `6d9dd979-...`, tenant `6eb9c106-...`, élève `528ffa5a-...` | R/student-courses.ts:103,325,503,744 ; R/student-assignments.ts:422 | abandonné |
| Valeurs par défaut `gender='masculin'`, `scholarship_level='non'`, `affectation_status='affecte'`, `is_inscribed=true` | R/students.ts:572 ; R/enrollments.ts | supprimées ; défaut d'inscription `funding_type = 'PRIVATE'` (004) |
| Plafonds de pagination 1000 / 500 / 100 selon l'endpoint ; `LIMIT 50` fixe | R/students.ts ; R/parents.ts ; R/enrollments.ts | convention d'API unique (plafond commun, à fixer dans `module-conventions.md`) |
| Limites de colonnes `phone` 20, `emergency_contacts.phone` 50, `registration_requests.phone` 40 | M/0003:21 ; M/0030:15 ; M/0060 | `persons.phone` 5 à 40 caractères |
| Types de fichier du diplôme (`pdf/png/jpeg/jpg/webp`), taille globale 1 Go | R/students.ts:1611 ; index.ts:171 | politique de `documents` (024), paramétrable par tenant ; photo : limites du StoragePort |
| Fenêtre d'assiduité 30 jours et seuil 20 % d'absences/retards | R/parent-children.ts:312 | RuleSet (012) / attendance (010) |
| Réservation temporaire de 15 minutes (formations courtes) | S/inscription-pro.service.ts | `institution_settings.pending_hold_minutes` (004) |
| Rôles « voyeurs de mots de passe » `owner/admin/super_admin/administrateur` | MW/credentials-visibility.ts:22-41 | abandonné |
| Liste de codes de lien `parent/guardian/emergency_contact` | enum `parent_relationship` | `people.relationship_types` (données de pack JSON) |
| Nouveaux réglages v2 | — | `people.settings` : `student_number_pattern` (`{SEQ:5}`), `number_prefix`, `duplicate_check_enabled` (true) ; `expiry_alert_days` (60) relève de 009 |

---

## 6. Synthèse chiffrée par statut

Les décomptes ci-dessous ont été calculés par script sur les tableaux de ce document (colonne « Statut »).

### 6.1 Fonctions et endpoints (§2) : 92 lignes de parité = 88 IDs S-xxx + 4 lignes SI-n

| Statut | IDs S-xxx (88) | + lignes SI-n (4) | Total (92) |
|---|---|---|---|
| conservé | 0 | 0 | 0 |
| amélioré | 28 | 1 (SI-1) | 29 |
| abandonné | 12 | 2 (SI-2, SI-4) | 14 |
| hors module | 48 | 1 (SI-3) | 49 |
| **Total** | **88** | **4** | **92** |

Aucune fonction n'est reproduite à l'identique : toutes sont corrigées (permission, transaction, historique, fin des mots de passe en clair) ou déplacées. « Conservé » ne concerne que des colonnes et des règles de données (§1, §3).

Répartition des 49 lignes « hors module » : 004 academic-core 23 ; 002 auth-rbac 9 ; 007 admissions 6 ; 025 analytics 3 ; 014 finance 2 ; 011 assessments-grades 2 ; 009 teachers-staff 1 ; 016 communications 1 ; 024 documents 1 ; hors plan (prospection) 1.

Répartition par famille :

| Famille | Lignes | amélioré | abandonné | hors module |
|---|---|---|---|---|
| A. Comptes et authentification liés | 10 | 1 | 2 | 7 |
| B. Fiche élève, historique de statut | 11 | 8 | 1 | 2 |
| C. Liens parent-élève | 4 | 4 | 0 | 0 |
| D. Parents (administration) | 7 | 6 | 0 | 1 |
| E. Demandes d'inscription | 8 | 1 | 1 | 6 |
| F. Inscriptions classiques | 7 | 1 | 1 | 5 |
| G. Inscriptions Professional (côté élève) | 15 | 0 | 0 | 15 |
| H. Matricules | 9 | 3 | 3 | 3 |
| I. Portails parent/élève, vues enseignant (dont SI-1 à SI-3) | 15 | 5 | 4 | 6 |
| J. Imports/exports, lectures décisionnelles | 2 | 0 | 0 | 2 |
| K. Divers (dont SI-4) | 4 | 0 | 2 | 2 |
| **Total** | **92** | **29** | **14** | **49** |

Ce que le module `people` porte réellement (statut « amélioré ») : 29 lignes ; 18 d'entre elles sont dans les familles B, C et D (le coeur du module : fiche, liens, tuteurs).

### 6.2 Tables et colonnes (§1) : 112 lignes

| Statut | Lignes |
|---|---|
| conservé | 27 |
| amélioré | 42 |
| abandonné | 10 |
| hors module | 33 (004 : 19 ; 002 : 4 ; 007 : 3 ; 014 : 3 ; 016 : 1 ; 024 : 1 ; hors plan : 1 ; 010/011/013/014/015/016 : 1) |
| **Total** | **112** |

Détail : §1.1 tables 21 lignes ; §1.2 colonnes de `student_profiles` 42 ; §1.3 `student_parents` 11 ; §1.4 `emergency_contacts` 6 ; §1.5 historique de statut 7 ; §1.6 `student_enrollments` 5 ; §1.7 `users` et enums 9 ; §1.8 fonctions et déclencheurs 5 ; §1.9 tables v2 sans équivalent 6.

### 6.3 Règles (§3)

46 lignes de règles et défauts : 23 corrigées, 3 reproduites (IPAM comme donnée, `dsps_matricule`, refus d'archivage d'un tuteur ayant des liens vivants), 3 abandonnées (miroir `establishment_matricule`, générateur `STU`, mots de passe visibles), 4 hors module, 13 correspondances de droits ou décisions à trancher (§3.4 et renvois au §7).

### 6.4 Total général

**92 lignes de fonctions + 112 lignes de tables/colonnes = 204 lignes de parité** (hors §3 à §5 : règles 46, PII 18, constantes 22).

---

## 7. Décisions et écarts à trancher

Écarts entre le **brief cible**, le **DDL** de référence et le **legacy**, et décisions à porter dans la spec 008.

1. **Fusion de doublons** : le brief ne prévoit que la détection (`findDuplicateStudents`, `GET /students/duplicates`) ; le legacy n'avait ni détection de personne ni fusion. Décision à signaler : **pas de fusion en v1** ; migration (031) signale les doublons sans les fusionner.
2. **Valeur migrée de `student_number`** : legacy `10001 + rang` ; motif par défaut v2 `{SEQ:5}` -> `00001`. Choisir entre conserver le numéro legacy des élèves existants (puis compteur reprenant au-dessus de `sequence_number`) ou renuméroter ; dans tous les cas `sequence_number` legacy est conservé (il fonde les matricules d'inscription).
3. **Un seul générateur contre le numéro d'inscription** : le brief annonce « un seul générateur » (`people.next_number`), mais `academic.enrollments.registration_number` suit un second motif (`institution_settings`, jetons `{PREFIX}`, `{PROGRAM}`, `{STUDENT_SEQ:n}`, `{YEAR}`). Les vocabulaires de jetons diffèrent de `people.settings` (`{SEQ:n}`, `{YYYY}`, `{YY}`, `{PREFIX}`). Confirmer que `registration_number` n'a pas de compteur propre (il dérive de `sequence_number`) et harmoniser les jetons.
4. **Unicité du numéro d'inscription par établissement** : le matricule legacy IPAM est unique par (élève, classe) et identique à chaque réinscription dans la même classe ; v2 impose l'unicité `(tenant, institution, registration_number)` par inscription (et par année). Sans jeton `{YEAR}`, un redoublement dans la même classe produirait un doublon : prévoir la règle (réutiliser le numéro de l'inscription précédente `previous_enrollment_id` ?).
5. **Matricule saisi** (`student_matricule`) : devient `external_ref` ; l'index unique n'est pas insensible à la casse (le legacy avait déjà ce défaut). Décider de la normalisation (trim + majuscules) ou d'un index sur `lower()`.
6. **Suppression d'un lien tuteur** : le brief liste `unlinkGuardian` et l'événement `people.guardian.unlinked` ; la DDL accorde `DELETE` sur `student_guardians` sans trigger d'interdiction (contrairement à persons/students/guardians). Trancher : clôture par `valid_to` (recommandé, conforme à l'historique) ou suppression physique ; envisager un trigger d'interdiction.
7. **Cas d'usage manquants au brief** : `GET /guardians` et `GET /guardians/:id` existent en routes mais pas en cas d'usage (`listGuardians`, `getGuardian`) ; les sous-routes de lien `/students/:id/guardians/:linkId` (PATCH/DELETE) et `/students/:id/emergency-contacts/:contactId` sont implicites ; aucune route d'export CSV de la liste d'élèves ; aucune route d'auto-édition des coordonnées d'un tuteur (`/me/guardian`) alors que le legacy offrait `PUT /parent/settings/contact` (S-118).
8. **`isGuardianOfStudent` : périmètre exact** : lien vivant et `portal_access` ; faut-il exclure les liens de type `EMERGENCY` ? Le legacy ne distinguait rien ; les trois « niveaux d'accès » (`full`, `limited`, `view-only`) du legacy n'étaient pas appliqués : le brief les remplace par un booléen `portal_access`. Confirmer l'abandon des niveaux intermédiaires.
9. **Contacts d'urgence édités par le tuteur** : legacy = le parent gère ses contacts ; v2 = rattachés à l'élève, écriture `student.update` (personnel). Décider si un tuteur ayant `portal_access` peut les proposer ou les modifier depuis le portail (aucune permission `student.child.update` au brief). L'e-mail du contact d'urgence est perdu (pas de colonne cible).
10. **Statut `suspended` legacy** : n'a pas d'équivalent exact ; migré en `INACTIVE` (le statut `EXCLUDED` est disciplinaire). Confirmer.
11. **Qui bascule le statut du dossier** (`GRADUATED`, `WITHDRAWN`, `TRANSFERRED_OUT`) : le legacy ne le faisait jamais automatiquement ; le brief fait consommer `people.student.status_changed` par academic mais pas l'inverse. Confirmer que le changement de statut reste une action manuelle (`changeStudentStatus`) et que la boucle événementielle n'est pas bidirectionnelle.
12. **Blocage de connexion selon le statut** (S-004) : à confier à iam via événement, ou politique de portail : à décider avec 002.
13. **Sexe** : `persons.sex` est nullable ; le contrat legacy le rendait obligatoire. Décider du caractère obligatoire à la création (réglable par pack ?). Le défaut legacy `masculin` empêche de distinguer à la migration les valeurs saisies des valeurs défaut : décision de migration.
14. **Numéro de diplôme/certificat** : `student_prior_education` n'a pas de colonne « numéro » (besoin : `cepe_code`, numéro de bac, matricules d'examen). Utiliser `note`/`attributes` ou ajouter `reference_number`. Idem filiation (`father_name`, `mother_name`) : `attributes` (adopté ici) ou colonnes dédiées ; et `sub_prefecture`.
15. **Conflit boursier / affecté** : `scholarship_level='oui'` et `affectation_status='affecte'` coexistent dans le legacy ; le financement v2 est mono-valeur (`funding_type`). Règle de priorité de migration à fixer ; mapping de `prise_en_charge` (`COMPANY` ou `OTHER`).
16. **Diplôme et documents avant la spec 024** : le brief place `document_ref` à NULL tant que 024 n'existe pas, alors que le legacy permettait l'upload du diplôme. Décider d'une brique de stockage temporaire (StoragePort) ou d'un trou fonctionnel en V1 initiale ; la photo, elle, passe par StoragePort.
17. **Formations courtes** (`inscriptions_professionnelles`, S-096) : sans spec v2 ni dossier élève ; marquées « abandonné » par défaut. Si le produit les conserve, elles passeraient par `academic` (à la carte) et `finance` ; à confirmer.
18. **Comptage des numérotations** : le brief parle de **6** numérotations supprimées ; l'inventaire dénombre **7** identifiants « matricule-like » (`student_number`, `establishment_matricule`, `student_matricule`, `sequence_number`, IPAM, `dsps_matricule`, `STU...`). Rapprochement retenu ici : 6 supprimées ou fusionnées (1 à 6 du tableau §3.1) et `dsps_matricule` conservé en `national_student_id`.
19. **Erreurs d'inventaire** : S-033 renvoie à « S-112/S-113 » pour la modification d'un lien par le parent, alors que ce sont S-115/S-116 ; le doc pro (`legacy-pro-enrollment.md`, P-050) cite « P-092 » pour le matricule alors que c'est P-088 ; S-094 est un doublon de S-022 + S-023. Aucun impact sur la parité (traités tels quels).
20. **Effacement RGPD** : les triggers interdisent tout DELETE ; l'anonymisation (UPDATE des colonnes d'identité) doit être spécifiée (030) sans casser les obligations de conservation financière.
21. **Reprise des UUID** : réutiliser `student_profiles.id` comme `students.id` (recommandé) ; `users.id` d'un parent comme `identity_id` ; les `students` migrés dont `user_id` est partagé (rôle cumulé élève/parent/enseignant) donnent une seule `persons` si l'identité coïncide (dédoublonnage par `identity_id` unique).

---

## 8. Suite donnée aux points à trancher

Les numéros renvoient à la liste de la section 7 ; « Tranché » renvoie à `spec.md`, `data-model.md` (DDL testé) ou `open-questions.md`.

| N° | Suite donnée | Référence |
|---|---|---|
| 1 | Tranché : pas de fusion de dossiers en v1 ; détection de doublons avec avertissement (clé de recherche normalisée). | D-30, O-07 |
| 2 | Tranché : aucune reprise de données de production (D8) ; la numérotation et la réutilisation d'UUID sont sans objet pour la livraison. | B-11 |
| 3 | Tranché : numéro d'inscription par registre `academic.registration_numbers` (004) ; matricule élève gapless et immuable ; deux motifs aux jetons distincts. | D-18, D-19, O-13 |
| 4 | Tranché : `external_ref` sensible à la casse, normalisé par suppression des blancs à la saisie. | spec 008 |
| 5 | Tranché : rupture d'un lien tuteur par `valid_to` ; aucune suppression (aucun droit DELETE). | DDL 0801, 0804 |
| 6 | Tranché : cas d'usage de lecture manquants ajoutés (`listGuardians`, `getGuardian`, `exportStudents`, `/me/guardian`). | spec 008 |
| 7 | Tranché : un lien `EMERGENCY` n'ouvre jamais l'accès au portail. | spec 008 |
| 8 | Tranché : le tuteur modifie les contacts d'urgence par les routes de l'enfant, avec champs limités. | spec 008 |
| 9 | Tranché : l'ancien statut `suspended` devient `SUSPENDED`. | DDL 0801 |
| 10 | Tranché : statut de l'élève changé manuellement ; `iam` consomme `people.student.status_changed`. | spec 008 |
| 11 | Tranché : sexe facultatif sur la personne, obligatoire à la création d'un élève, sans valeur par défaut. | D-28 |
| 12 | Tranché : colonnes `reference_number`, `attachment_object_key` (antécédents) et `email` (contacts d'urgence) ajoutées. | DDL 0801 |
| 13 | Tranché : un seul financement par inscription, porté par 004. | D-04, O-04 |
| 14 | Tranché : stockage des pièces par le port `StoragePort` provisoire jusqu'à 024. | spec 008 |
| 15 | Tranché : les formations courtes sont abandonnées (statut « abandonné »). | parity 008 |
| 16 | Tranché : suite donnée en 14 (diplômes et pièces). | spec 008 |
| 17 | Tranché : formations courtes, voir 15. | parity 008 |
| 18 | Constat de comptage (7 identifiants au lieu de 6) intégré à la parité ; une seule numérotation `people.next_number`. | D-19 |
| 19 | Erreurs d'inventaire corrigées dans la parité. | - |
| 20 | Tranché : `anonymizeStudent` ajouté (UPDATE des colonnes d'identité, conservation des liens financiers) ; durée de conservation en question O-15. | spec 008, O-15 |
| 21 | Tranché : sans objet (aucune reprise de données). | B-11 |
