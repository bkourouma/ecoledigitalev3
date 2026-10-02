# Feature Specification: Cœur académique (004-academic-core)

**Feature Branch**: `004-academic-core`

**Created**: 2026-10-01

**Status**: Rédigée — prête pour `/speckit.plan` (plan, DDL et parité fournis dans le dossier ; questions ouvertes dans `open-questions.md`)

**Sources**: `docs/PRD_EcoleDigitale_SaaS.md` §10, §11, §16, §20, §22-23, §50 ; `docs/PLAN_Mise_en_oeuvre_EcoleDigitale_SaaS.md` §3.4, §3.7, §4 (Phase 2, tranches 2.0-2.2) ; ADR-001, 002, 003, 004, 006, 007, 008 ; `docs/architecture/module-conventions.md` ; `specs/v2/000-platform-foundation/spec.md` (gabarit) ; legacy : `docs/module-professionnel-overview.md`, `docs/modele-donnees-pedagogique-matiere.md`, `docs/PRD-restructuration-pedagogique-filiere-ue-ecue.md`, migrations 0002, 0005, 0048, 0049, 0054, 0059, 0069-0083, 0116-0118, 0121, 0127, services `professional-{ue,enrollment,semestre,planning,cycle-groups,cloture-guard,inscription-gate}`. Les décisions D1-D9 du plan font foi. Compagnons : `data-model.md` (DDL testé), `plan.md`, `parity.md`, `open-questions.md`.

> Cette spec gouverne la Phase 2. Elle fournit aux specs 011 (évaluations-notes), 012 (rules-engine), 013 (bulletins), 019 (higher-education), 014/015 (finance) et 032 (paie) des **identifiants stables** et des **interfaces** (§7) ; elle ne contient **aucune** formule ni seuil réglementaire.

## 1. Objectifs

1. **Un seul cœur académique pour les quatre packs.** Années, périodes typées, programmes, curriculum, classes, inscriptions : un modèle unique remplace la pile « classique » (cycles, programmes, classes, cours) et la pile « Professional » (filière → UE → ECUE, cohortes, semestres).
2. **Curriculum polymorphe et versionné** : un arbre `curriculum_nodes` (programme → niveau → période → [UE → ECUE] ou [matière]) porte `node_type`, `coefficient` et `credits` optionnels ; il exprime le primaire/secondaire (matières + coefficients) comme le supérieur (UE/ECUE + crédits), versionné par année académique.
3. **Périodes typées et configurables** (composition, trimestre, semestre, session, module…), sans aucune périodicité codée en dur ; une seule source de vérité pour « l'année » (fin des cinq dérivations par pivot au 1er septembre).
4. **Inscription qui historise** : un changement de classe ou d'année ne crée jamais un nouvel élève ; `Enrollment` porte le type de financement (PRD §20), l'historique de placements et d'états, et couvre l'inscription de classe **et** l'inscription à la carte (offres, prérequis, capacité, fenêtre).
5. **Parité Higher/Professional** : inscriptions à la carte, cohortes/sessions d'UE, semestres, prérequis, clôture de période, matricule d'inscription — chaque fonction du legacy est reproduite, améliorée ou explicitement écartée (`parity.md`).
6. **Zéro règle réglementaire dans le module** : les modules fournissent des **données** (coefficients, crédits, périodes, niveaux, drapeaux) et des **événements** ; seuils et formules sont des RuleSets (ADR-003).
7. **Interfaces explicites** pour les consommateurs : `EnrollmentDirectory` (finance), contexte de règles (`getRuleContext`), listes de nœuds par inscription, états de période, événements.

## 2. Périmètre

### Inclus

- Référentiels pilotés par les modèles de pack : cycles (`education_levels`), niveaux (`grade_levels`, avec niveau suivant), types de périodes, types de financement, issues d'inscription, grammaire du curriculum (`curriculum_node_types`).
- Années académiques (cycle de vie, année courante, absence de chevauchement et de trou), périodes typées arborescentes (`academic_periods`), plan de périodes, clôture en deux temps (notes puis résultats) et **clôture par classe**.
- Programmes (filière, série, spécialité, parcours — arbre à deux niveaux), niveaux couverts, catalogue de matières réutilisables.
- Curriculum versionné par (programme, année) : arbre polymorphe, prérequis par lignée, validation, publication, amendements journalisés, clonage annuel, verrouillage.
- Classes / promotions (`classrooms`), offres de nœuds à une classe (`classroom_offerings`, ex-cohortes d'UE), ouverture d'une classe depuis un semestre.
- Inscriptions (`enrollments`), sélections de cours (options, à la carte, reprise), placements, historique, financement et référence d'affectation, issue de fin d'année, reconduction annuelle.
- Éligibilité à une offre (statut, fenêtre, doublon, capacité, prérequis), réservation de place avec expiration, politique de confirmation d'inscription.
- Annuaire `EnrollmentDirectory` pour finance ; port `StudentDirectory` vers people ; ports de garde (`PeriodClosureGuard`, `CurriculumUsageGuard`, `OfferingReadinessGuard`, `CompletionLookup`, `ScheduleConflictChecker`).
- API HTTP `/api/v1/academic/*`, contrats Zod, événements, écrans d'administration et de consultation.

### Exclu (renvoyé à d'autres specs)

| Sujet | Spec |
|---|---|
| Dossier permanent de l'élève, tuteurs, personnel, affectations d'enseignement | 008, 009 (module `people`) |
| Présences et justificatifs | 010 |
| Emploi du temps, salles, séances, heures payables | 017 |
| Évaluations, notes, workflow, résultats d'UE, validation, rattrapage | 011 |
| Formules, seuils, mentions, décisions, passage/redoublement (calcul) | 012 (RuleSets) |
| Bulletins, relevés, diplômes, attestations | 013 |
| Capitalisation de crédits, compensation, diplomation, BTS complet | 019 (020 après V1) |
| Prix, barèmes, commandes, paiements, reçus, échéanciers (`cycles_frais`, `professional_orders`…) | 014, 015 |
| Admissions (candidature → inscription), demandes d'inscription publiques | 007 |
| Examens nationaux (CEPE, BEPC, BAC, BTS) | 018 |
| Imports d'élèves, de classes, de matières | 031 (imports) |
| Console de provisioning, packs/entitlements | 001, 003 |

### Hors périmètre du plan

Un solveur de constitution automatique des classes ; l'équivalence de crédits entre programmes ; les dispenses d'UE (VAE) — signalés en `open-questions.md`.

## 3. Acteurs

| Acteur | Rôle vis-à-vis de cette spec |
|---|---|
| Directeur / Directeur des études | Définit années, périodes, programmes, curriculum ; ouvre/clôt les périodes ; décide les issues |
| Responsable pédagogique | Compose et amende le curriculum, ouvre les offres |
| Secrétariat | Inscrit les apprenants, gère placements, financements, confirmations |
| Économe | Lit les inscriptions et leur financement (via finance) ; confirme selon la politique |
| Enseignant | Lit ses classes, ses effectifs (rosters) |
| Parent / Tuteur | Consulte les inscriptions de ses enfants (`enrollment.child.read`) |
| Élève / Étudiant | Consulte ses inscriptions ; choisit des offres à la carte si ouvert |
| Super-admin plateforme | Applique/ré-applique un modèle de pack (acte audité) |
| Modules consommateurs | 011, 013, 019 (nœuds, périodes, états) ; 014 (annuaire) ; 007 (création d'inscription) ; 016/025 (événements) |

## 4. User Stories et critères d'acceptation

### US1 — Calendrier académique unique et typé (P1)

En tant que directeur, je veux définir l'année et ses périodes (trimestres, semestres, sessions…) sans aucune périodicité imposée.

- **AC1.1** Créer une année qui chevauche une année du même établissement est refusé (`409 academic.year_overlap`) ; la base le garantit (contrainte d'exclusion). Test d'intégration avec deux années concurrentes : une seule est acceptée.
- **AC1.2** Créer une année qui laisse un trou avec l'année précédente (ni contiguë ni première) est refusé (`409 academic.year_gap`) ; `find_year_gaps()` retourne 0 ligne sur la base de test.
- **AC1.3** `applyPeriodPlan(year, "THREE_TERMS")` crée 3 périodes `TRIMESTER` couvrant exactement l'année, sans trou ni chevauchement ; `TWO_SEMESTERS` produit 2 périodes ; les dates restent modifiables tant que la période est `PLANNED` ou `OPEN`.
- **AC1.4** Une période hors de son année ou de son parent, ou chevauchant une sœur de même type, est refusée (code `academic.period_*`). Une session (`NORMAL_SESSION`) peut être posée sous un semestre.
- **AC1.5** Une seule année `is_current` par établissement ; `setCurrentAcademicYear` bascule atomiquement ; `resolvePeriodForDate` renvoie, pour une date et un type, exactement 0 ou 1 période.
- **AC1.6** Aucun littéral `09-01`, `'septembre'`, `'semestre'`, `'trimestre'` n'existe dans `modules/academic/**` hors fichiers de test (garde-fou lint R2 de la spec 000).

### US2 — Curriculum polymorphe versionné (P1)

En tant que responsable pédagogique, je veux composer un curriculum pour mon programme et mon année, quel que soit le pack.

- **AC2.1** Un programme du pack Higher (`LEVEL > PERIOD > UE > ECUE`) et un programme du pack Primary (`LEVEL > SUBJECT`) se créent avec le **même** code, la même table et le même endpoint ; seule la grammaire (données) diffère.
- **AC2.2** Le déclencheur rejette : un `ECUE` sous un `LEVEL` (`academic.node_bad_parent`), un `SUBJECT` sans matière, des crédits sur un `GROUP`, un déplacement créant un cycle. 100 % des cas du tableau de grammaire sont couverts par des tests.
- **AC2.3** `validateCurriculum` renvoie un rapport complet (erreurs `ERROR`, avertissements `WARN`) en une passe : nœud orphelin, `UE` dont les crédits diffèrent de la somme de ses `ECUE` (si `credits_must_equal_children`), prérequis vers une lignée inconnue, niveau absent du programme. Publier avec une `ERROR` est refusé.
- **AC2.4** `cloneCurriculumVersion` d'une version publiée produit une version `DRAFT` pour l'année cible avec les **mêmes `lineage_id`** et de nouveaux `id` ; les prérequis sont recréés ; 3 000 nœuds clonés en < 2 s (objectif mesuré en CI de performance).
- **AC2.5** Après publication, ajouter/supprimer/déplacer un nœud est refusé (`academic.curriculum_published`) ; modifier un coefficient ou des crédits n'est possible que par `amendPublishedCurriculum` (motif ≥ 5 caractères, journal `curriculum_amendments`, événement `academic.curriculum.amended`, permission sensible `curriculum.amend`).
- **AC2.6** Une même matière apparaît dans deux nœuds `ECUE` de deux `UE` avec des coefficients différents (mutualisation) ; supprimer la matière du catalogue est refusé tant qu'un nœud la référence.
- **AC2.7** Un nœud `is_transversal` (ex. conduite) ne peut faire l'objet ni d'une offre ni d'un achat à la carte, et n'exige aucune affectation d'enseignant ; aucun traitement ne détecte la conduite par libellé.

### US3 — Classes, offres et ouverture d'une classe (P1)

En tant que secrétariat / responsable pédagogique, je veux créer les classes de l'année et ouvrir les offres d'un semestre.

- **AC3.1** `createClassroom` impose : niveau couvert par le programme, version de curriculum du même programme et de la même année, établissement cohérent avec l'année ; une classe `ACTIVE` exige une version `PUBLISHED`.
- **AC3.2** `openOfferingsForPeriod(classroom, periodNodeId, dates, window, capacity)` crée **une offre par UE inscriptible** du nœud `PERIOD`, avec les mêmes dates, fenêtre et capacité, de façon **idempotente** (la contrainte `UNIQUE (classroom, node)` interdit les doublons du legacy) et rejette des dates incohérentes avec un `422` explicite (jamais de `500`).
- **AC3.3** Une offre passe `OPEN → FULL` automatiquement quand la capacité est atteinte et revient `FULL → OPEN` quand une place se libère **si la fenêtre est encore valide** ; `FULL` n'est jamais posé à la main : il est dérivé par un déclencheur de base (`sync_offering_fullness`) qui s'exécute à chaque écriture de sélection, y compris l'expiration d'une réservation.
- **AC3.4** L'ouverture d'une offre (`OPEN`) est soumise à `OfferingReadinessGuard` (people : un responsable d'enseignement pour chaque nœud obligatoire non transversal) ; la création directe d'une offre `OPEN` ne contourne plus ce garde (bug legacy P-010).
- **AC3.5** Le passage à `COMPLETED` à `ends_on` se fait par un **job planifié** (`finalizeEndedOfferings`), jamais dans un `GET` (bug legacy : `GET /ue-sessions` écrivait). Périmètre : offres dont `ends_on` est passée (date civile de l'établissement) et dont le statut est `OPEN`, `FULL` ou `IN_PROGRESS` ; les offres `DRAFT` et `CANCELLED` sont **exclues** (le legacy « terminait » aussi les brouillons). `reopenOffering` (COMPLETED → OPEN/IN_PROGRESS, CANCELLED → DRAFT) exige un motif, de nouvelles dates cohérentes (dans l'année de la classe) et la permission `academic.classroom.manage` ; il remplace le « rouvrir un lot » du legacy (qui forçait `ouvert` sans contrôle).
- **AC3.5b** Une offre ne peut pas être modifiée pour une capacité inférieure aux places réservées (`academic.capacity_below_reserved`) ; ses dates restent dans l'année de la classe (`academic.offering_outside_year`).
- **AC3.6** `getRoster(classroom, onDate)` renvoie les inscriptions `ACTIVE` de mode `CLASS` + les sélections `CONFIRMED` des offres de la classe ; p95 < 150 ms pour 60 inscrits.

### US4 — Inscription d'un apprenant avec historique (P1)

En tant que secrétariat, je veux inscrire un élève dans une classe et suivre son parcours.

- **AC4.1** `enrollStudent` vérifie l'apprenant (port `StudentDirectory`, statut inscriptible), la classe (`ACTIVE`/`DRAFT` selon politique), l'unicité (une inscription vivante par classe ; une inscription de classe par année et établissement), la capacité dure ; chaque refus renvoie un code `academic.*` stable (jamais un `500` sur violation d'unicité — bug legacy).
- **AC4.2** Un changement de classe (`transferEnrollment`) conserve le même `enrollment_id`, clôt le placement courant, ouvre un nouveau placement, journalise `enrollment_history` et publie `academic.enrollment.transferred` ; **aucun nouvel élève** n'est créé (vérifié : `count(people.students)` constant).
- **AC4.3** Le type de financement est porté par l'inscription : `STATE_ASSIGNED` sans `assignment_reference` est refusé par la base et par le cas d'usage ; `changeEnrollmentFunding` journalise l'ancien et le nouveau couple (type, référence) et publie `academic.enrollment.funding_changed`.
- **AC4.4** Les transitions d'état (PENDING → ACTIVE → SUSPENDED/COMPLETED/WITHDRAWN/TRANSFERRED_OUT/CANCELLED) sont imposées par la base (`enrollments_guard`) ; passer à `ACTIVE` n'altère aucun paiement (le legacy marquait la commande « payée » sans paiement).
- **AC4.5** 200 inscriptions concurrentes dans une classe de capacité dure 100 : exactement 100 réussissent, 100 reçoivent `academic.classroom_full` (test de concurrence).
- **AC4.6** Aucune suppression physique : `DELETE` sur `enrollments`, `classrooms` est refusé par la base ; annuler = `CANCELLED` + motif + historique.
- **AC4.7** `getEnrollmentHistory` restitue, dans l'ordre, création, statuts, financement, placements et sélections, avec acteur et motif pour 100 % des événements.

### US5 — Inscription à la carte, prérequis, capacité (P1)

En tant qu'étudiant (ou secrétariat), je veux m'inscrire à des UE offertes, sous contrôle serveur.

- **AC5.1** `checkOfferingEligibility` évalue dans cet ordre et renvoie le premier échec : offre non `OPEN` → période de l'offre close (état effectif ≥ `GRADING_CLOSED`) → fenêtre `[opens, closes]` (bornes incluses ; **fenêtre facultative** : absente, l'offre est inscriptible tant qu'elle est `OPEN`) → doublon vivant (même nœud, même année, toute classe) → capacité → prérequis non validés (liste des manquants). Les codes sont `academic.offering_not_open`, `academic.period_closed`, `academic.registration_window_closed`, `academic.duplicate_enrollment`, `academic.offering_full`, `academic.prerequisites_unmet`. Le résultat est le même pour le catalogue, la création par un administrateur (qui n'est plus exempté de tout contrôle comme dans le legacy) et la validation finale.
- **AC5.1b** Un administrateur qui doit déroger (inscription hors fenêtre, au-delà de la capacité, prérequis non validés) utilise `override` : permission **sensible** `enrollment.override`, motif ≥ 5 caractères, audit, journal d'historique ; le dépassement de capacité dure reste refusé par la base (la capacité se relève d'abord, par un cas d'usage motivé).
- **AC5.1c** Le libre-service : `selfEnrollToOffering({offeringId})` (permission `enrollment.self.create`) crée ou réutilise l'inscription `A_LA_CARTE` de l'apprenant dans la **classe de l'offre**, ajoute la sélection, applique AC5.1 et AC5.2 ; l'inscription est une par (apprenant, classe), la sélection une par offre.
- **AC5.2** `addEnrollmentCourse(source=A_LA_CARTE)` réserve la place (`PENDING`, `hold_expires_at = now + pending_hold_minutes` si configuré) et publie `academic.enrollment_course.requested` avec `enrollmentCourseId`, nœud, lignée et crédits (consommé par finance pour facturer) ; le décompte de capacité **exclut les propres lignes** de l'apprenant et les réservations expirées (le bug « dernière place → panier bloqué » ne se reproduit pas).
- **AC5.3** Un prérequis est satisfait si `CompletionLookup.hasValidated(student, lineageId)` répond vrai (implémenté par 011/019 ; en attendant, par un adaptateur lisant les sélections `COMPLETED`). Logique ET ; un prérequis hors établissement, auto-référent ou circulaire est refusé à la définition.
- **AC5.4** Le job `expirePendingHolds` passe les sélections `PENDING` expirées en `CANCELLED` (motif `hold_expired`), libère la place, republie `academic.enrollment_course.expired`.
- **AC5.5** Deux niveaux de confirmation, indépendants. (a) **Inscription** (`PENDING → ACTIVE`) selon `institution_settings.enrollment_confirmation_policy` : `AUTO` à la création ; `ON_REGISTRATION_FEE_PAID` / `ON_FULL_PAYMENT` à la réception de `finance.invoice.paid` **pour l'inscription visée** (et non pour toutes les inscriptions en attente de l'étudiant — bug legacy P-081/P-089) ; `MANUAL` par `confirmEnrollment`. L'équivalent de la correction 0127 (classe sans frais d'inscription → confirmation immédiate) est `ON_REGISTRATION_FEE_PAID` avec « aucun frais d'inscription » signalé par finance. (b) **Sélection de cours** (`PENDING → CONFIRMED`) selon `course_confirmation_policy` : `AUTO` ; `ON_LINE_PAID` (défaut) quand la **ligne de facture de cette sélection** est soldée (`sourceRef = enrollmentCourseId`) ; `MANUAL`. Une sélection ne peut être `CONFIRMED` que si son inscription est `ACTIVE` (imposé par la base) : la confirmation de l'inscription précède celle des cours, comme la « porte d'entrée » du legacy, mais ne confirme plus en bloc des UE non payées.
- **AC5.6** Seules les sélections `CONFIRMED`/`COMPLETED` (et les inscriptions `ACTIVE`/`COMPLETED`) ouvrent présences, notes, bulletins : `getRoster`, `listNodesForEnrollment` n'exposent que cet ensemble.
- **AC5.7** Se réinscrire à une UE déjà validée émet l'avertissement `academic.already_completed` (non bloquant, `override` motivé requis pour confirmer) ; deux offres simultanées du même nœud pour le même apprenant sont refusées.

### US6 — Clôture de période en deux temps, par classe (P1)

En tant que directeur des études, je veux arrêter la saisie des notes puis figer les résultats, par période et par classe.

- **AC6.1** `closePeriodGrading` (OPEN → GRADING_CLOSED) puis `closePeriod` (→ CLOSED) ; `PeriodClosureGuard` des modules 011/013 peut refuser (ex. notes non toutes publiées) ; l'état effectif d'une classe est son état explicite s'il existe, sinon celui de la période (`getEffectivePeriodState`, règle R4).
- **AC6.2** Clore la période d'une classe ne clôt pas celle d'une autre classe (le legacy clôturait toutes les cohortes d'une UE, tous noms de classe confondus).
- **AC6.3** `reopenPeriod` (un pas en arrière) exige `academic.period.reopen` (sensible, MFA), un motif et écrit l'audit + `academic.period.reopened` ; `reopened_count` s'incrémente.
- **AC6.4** Les consommateurs reçoivent `academic.period.grading_closed|closed|reopened` (et les variantes `academic.classroom_period.*`) ; le module 011 refuse toute écriture de note quand l'état effectif ≠ `OPEN` (contrat testé côté 011).

### US7 — Reconduction annuelle (P2)

En tant que directeur, je veux préparer l'année suivante depuis les décisions de fin d'année.

- **AC7.1** `previewRollover(fromYear, toYear)` retourne, sans écrire, les classes à créer, les inscriptions à créer par issue (ADVANCE → niveau suivant `next_grade_level_id`, REPEAT → même niveau, REDIRECT → cible fournie par la décision, EXIT → aucune), et la liste des **anomalies** (issue manquante, niveau suivant absent, programme sans curriculum publié pour l'année cible, financement à re-confirmer).
- **AC7.2** `rolloverAcademicYear` est **idempotent** (rejeu = aucune création en double, vérifié par `previous_enrollment_id`) et s'exécute en job pour > 500 inscriptions ; 1 500 inscriptions en < 60 s (objectif).
- **AC7.3** Les inscriptions créées ont `previous_enrollment_id`, `is_repeating = true` pour REPEAT, `source_kind = ROLLOVER` ; les financements dont le type exige une référence ne sont **pas** reportés (listés dans le rapport).
- **AC7.4** `closeAcademicYear` exige : toutes les périodes `CLOSED`, tous les curriculums `PUBLISHED`→`LOCKED` à la clôture, aucune offre `OPEN` ; il pose `academic.year.closed`.

### US8 — Annuaire pour la finance et contexte pour les règles (P1)

En tant que module consommateur, je veux des vues stables sans dépendre des tables.

- **AC8.1** `createEnrollmentDirectory(deps)` renvoie un objet structurellement conforme au port `EnrollmentDirectory` de finance : `getEnrollment(ctx, id) → { enrollmentId, learnerId, academicYear (code), groupKey (classroomId), groupLabel (nom de la classe), institutionId, campusId, levelKey (code du niveau), trackKey (code du programme), learnerType (code du financement) }` ; un test de conformité compile le port finance contre l'adaptateur. **Sens des clés libres des barèmes de finance (fixé ici, éprouvé par `apps/api/test/adapters/fee-scope.integration.test.ts`)** : `levelKey` = code du niveau (`grade level`) de la classe ; `trackKey` = code du PROGRAMME de la classe ; `learnerType` = code du type de FINANCEMENT de l'inscription (`PRIVATE`, `STATE_ASSIGNED`, `SCHOLARSHIP`, `COMPANY`, `STAFF_CHILD`, `OTHER`, même vocabulaire que finance) ; `groupKey` = identifiant de la classe ; `academicYear` = code de l'année. La sonde `RegistrationFeeProbe` dérive le même périmètre que la facturation.
- **AC8.2** `getRuleContext(enrollmentId, periodId?)` renvoie les **faits** pour le moteur de règles (cycle, niveau et rang, `isFinal`, type et rang de période, famille de programme, nœuds avec coefficients et crédits en chaînes décimales exactes) : aucun traitement de nom (`/licence\s*[12]\b/i`, « SEMESTRE 2 », « BTS 2 ») n'est nécessaire.

## 5. Règles métier

### 5.1 Calendrier

- R1 Une année appartient à un établissement ; `[starts_on, ends_on]` non vides, sans chevauchement ; **sans trou** avec l'année précédente (héritage 0118, désormais une règle du cas d'usage et un contrôle d'exploitation, plus une migration de données). Par défaut, une année couvre douze mois pleins (`ends_on = starts_on + 1 an − 1 jour`).
- R2 Les périodes forment un arbre (≤ 3 niveaux : année > période > sous-période). Types et libellés sont des données.
- R3 États de période : `PLANNED → OPEN → GRADING_CLOSED → CLOSED` ; seul un pas en arrière est permis, motivé, sensible, audité. Les bornes d'une période close sont figées.
- R4 L'état effectif pour une classe = l'état **explicite** de la classe dans la période (`classroom_period_states`) s'il existe, sinon celui de la période : l'état d'une classe **surcharge** celui de la période, ce qui permet de clore une seule classe ou d'en rouvrir une seule après une clôture globale (permission `academic.period.reopen`). Clore la période entière aligne en une opération les états explicites existants.
- R5 Une année ne passe `CLOSED` que si ses périodes sont `CLOSED` ; `ARCHIVED` ensuite (lecture seule).

### 5.2 Curriculum

- R6 Un curriculum = (programme, année) ; états `DRAFT → PUBLISHED → LOCKED → ARCHIVED`. Verrouillé à la clôture de l'année.
- R7 La grammaire (parents admis, attributs exigés/interdits) vient de `curriculum_node_types`. Types livrés : `LEVEL`, `PERIOD`, `GROUP`, `UE`, `ECUE`, `SUBJECT` ; un tenant peut en ajouter, pas modifier un type `is_system`.
- R8 `coefficient > 0` et `credits ≥ 0` sont des **données** (décimaux exacts) ; leur emploi (moyenne pondérée par coefficient, par crédits, compensation) est décidé par le RuleSet, jamais ici. Aucune somme n'est imposée (ni « 20 crédits par semestre », ni « 48 par an ») ; seule l'égalité `crédits(UE) = Σ crédits(ECUE)` est contrôlable, si le type la déclare.
- R9 Une matière du catalogue peut être référencée par plusieurs nœuds ; chaque nœud porte sa propre lignée, son coefficient, son caractère obligatoire.
- R10 Prérequis : ET logique ; cible = lignée ; même établissement ; programmes différents admis ; acyclique (déclencheur + DFS).
- R11 `lineage_id` est immuable ; les clones annuels le conservent ; il est l'ancre de la capitalisation inter-annuelle (019).
- R12 Un curriculum `PUBLISHED` est modifiable numériquement par amendement motivé ; sa structure ne l'est que par `amendPublishedCurriculum` si `CurriculumUsageGuard` confirme qu'aucune note/inscription ne dépend du nœud.

### 5.3 Classes et offres

- R13 `Classroom` = classe ou promotion de l'année ; nom unique par (année, programme, niveau). Le nom de la classe est une colonne, plus un préfixe de libellé de cohorte.
- R14 Une offre est unique par (classe, nœud) ; états `DRAFT → OPEN ⇄ FULL → IN_PROGRESS → COMPLETED`, `CANCELLED` terminal ; `FULL` est dérivé de la capacité.
- R15 Une offre est inscriptible si `OPEN`, dans sa fenêtre, non pleine, sans doublon, prérequis satisfaits (ordre §4 US5).
- R16 La capacité d'une classe est **dure** uniquement si `capacity_is_hard` (sinon indicative) ; celle d'une offre est toujours dure ; `capacity NULL` = illimité.
- R17 Une place est réservée par toute sélection `PENDING` non expirée, `CONFIRMED` ou `COMPLETED`.
- R18 Un nœud transversal n'a ni offre, ni achat à la carte, ni enseignant.

### 5.4 Inscriptions

- R19 `Enrollment` = (apprenant, année, classe) ; `mode` `CLASS` (suit le curriculum obligatoire de la classe) ou `A_LA_CARTE` (suit les sélections).
- R20 Une inscription vivante par (apprenant, classe) ; une inscription `CLASS` vivante par (apprenant, année, établissement). Un apprenant peut être inscrit en même temps dans plusieurs classes à la carte ou dans deux établissements du groupe.
- R21 États : `PENDING`, `ACTIVE`, `SUSPENDED`, `COMPLETED`, `WITHDRAWN`, `TRANSFERRED_OUT`, `CANCELLED` ; transitions §data-model ; pas de suppression.
- R22 Financement : `funding_type` ∈ types du tenant ; `requires_reference` ⇒ `assignment_reference` ; les montants (part État / part parent) sont dans finance.
- R23 Le numéro d'inscription (`registration_number`, ex. matricule professionnel `IPAM-<CODE>-<NNNN>`) est attribué **une fois** par (apprenant, programme, niveau) à la première inscription, par le motif configuré (`{PREFIX}-{PROGRAM}-{LEVEL}-{STUDENT_SEQ:4}` ; jetons `{PREFIX}`, `{PROGRAM}`, `{LEVEL}`, `{YEAR}`, `{STUDENT_SEQ:n}` = numéro d'ordre figé du dossier, spec 008) ; il reste identique aux réinscriptions (redoublement) ; deux apprenants ne partagent jamais un numéro dans un établissement (registre `registration_numbers`, unicité par établissement) ; le préfixe (« IPAM » en dur dans le legacy) est une donnée d'établissement.
- R24 L'issue de fin d'année (`outcome_code`) est **fournie** par le module de décisions (013) via `recordEnrollmentOutcome` ; academic n'en calcule aucune.
- R25 Confirmation selon la politique de l'établissement (§AC5.5) ; seules les inscriptions confirmées ouvrent présences, notes, bulletins.

### 5.5 Sécurité et périmètre

- R26 Toute lecture est filtrée par le périmètre du contexte (`ctx.institutionId`, `ctx.campusId`) en plus de la RLS tenant.
- R27 Un parent ne lit que les inscriptions de ses enfants (`people.isGuardianOfStudent`) ; un élève que les siennes.
- R28 Opérations sensibles (MFA + audit) : réouverture de période, amendement de curriculum publié, changement de financement `STATE_ASSIGNED`, application d'un modèle de pack, reconduction annuelle.

## 6. Modèle de données

Voir `data-model.md` (25 tables, DDL testé). Résumé : référentiels (`education_levels`, `grade_levels`, `period_types`, `funding_types`, `enrollment_outcomes`, `curriculum_node_types`, `institution_settings`, `template_applications`) ; calendrier (`academic_years`, `academic_periods`) ; structure (`programs`, `program_grade_levels`, `subjects`, `curriculum_versions`, `curriculum_nodes`, `curriculum_prerequisites`, `curriculum_amendments`) ; classes et inscriptions (`classrooms`, `classroom_period_states`, `classroom_offerings`, `enrollments`, `enrollment_courses`, `enrollment_placements`, `enrollment_history`, `registration_numbers`). Migrations **0700-0704** (plage 0700-0799 à inscrire dans `module-conventions.md`).

### 6.1 Comment l'arbre exprime les quatre packs

| Pack | Arbre type (par programme et année) | Où sont les nombres |
|---|---|---|
| Primary (CI) | `LEVEL(CP1) > SUBJECT(Lecture), SUBJECT(Calcul)…` ou `LEVEL > GROUP(Français) > SUBJECT(Dictée)…` | `coefficient` sur `SUBJECT` (données ; valeurs officielles non inventées) |
| Secondary | `LEVEL(2nde) > SUBJECT…` par programme-série ; options : `GROUP` (choix {min,max} dans `attributes`) > `SUBJECT is_mandatory=false` | `coefficient` sur `SUBJECT` ; les séries (A, C, D…) = programmes enfants d'un programme « Lycée » |
| Higher (LMD) | `LEVEL(L1) > PERIOD(S1) > UE(UE1) > ECUE(Algorithmique)…` | `credits` sur `UE` (= Σ `ECUE`) et `ECUE` ; `coefficient` sur `ECUE` ; `category_code` (fondamentale/spécialité/culture générale) ; `is_transversal` pour la conduite |
| Higher (BTS) | `LEVEL(BTS1) > PERIOD(S1) > UE > ECUE` ; cycle `BTS` dans `education_levels` | idem ; la formule annuelle `(S1 + 2×S2)/3` est un RuleSet qui lit `period_type`/`ordinal` via `getRuleContext` |
| Virtual | `LEVEL > MODULE(type ajouté) > SUBJECT` si nécessaire ; le contenu LMS reste dans 022/023 | idem |

Le même moteur de notes (011) et le même moteur de règles (012) servent les quatre packs : ils consomment `getRuleContext` et `listNodesForEnrollment`, jamais une table.

## 7. Interfaces publiées (contrat de stabilité)

Tout appel inter-modules passe par `apps/api/src/modules/academic/index.ts` ; les DTO sont dans `packages/contracts/src/v2/academic.ts`. Les signatures sont conceptuelles (`(ctx, input) → Result<T, AppError>`) ; **les noms ci-dessous sont figés** pour les specs 011, 012, 013, 019, 014 et 032.

### 7.1 Identifiants stables

`academic.enrollments.id` (EnrollmentId) · `academic.curriculum_nodes.id` (NodeId) et `lineage_id` · `academic.academic_periods.id` (PeriodId) · `academic.classrooms.id` (ClassroomId) · `academic.classroom_offerings.id` (OfferingId) · `academic.academic_years.id` · `academic.programs.id` · `academic.subjects.id`. Ils ne changent jamais pour une même chose (un changement de classe garde l'`EnrollmentId`).

### 7.2 Fonctions exportées

| Fonction | Usage / consommateurs |
|---|---|
| `getAcademicYear`, `getCurrentAcademicYear(ctx, institutionId)`, `listAcademicYears` | tous |
| `getAcademicPeriod`, `listAcademicPeriods(ctx, yearId)`, `resolvePeriodForDate(ctx, {institutionId, date, typeCode?})` | 010, 011, 013, 017 |
| `getEffectivePeriodState(ctx, {classroomId, periodId})` → `PLANNED\|OPEN\|GRADING_CLOSED\|CLOSED` | 011 (verrou de saisie), 013 |
| `closePeriodGrading`, `closePeriod`, `reopenPeriod`, `closeClassroomPeriodGrading`, `closeClassroomPeriod`, `reopenClassroomPeriod` | UI direction ; 013 appelle `closePeriod` après génération |
| `getCurriculumTree(ctx, {versionId \| classroomId \| enrollmentId})`, `listCurriculumNodes`, `getCurriculumNode(ctx, nodeId)` | 011, 012, 013, 019 |
| `listNodesForClassroom(ctx, classroomId, {periodId?})`, `listNodesForEnrollment(ctx, enrollmentId, {periodId?})` → nœuds suivis (obligatoires de la classe + sélections confirmées), avec `coefficient`, `credits` (chaînes décimales), `isMandatory`, `isTransversal`, `lineageId`, `subjectId`, `categoryCode` | 011 (quoi noter), 013 (lignes de bulletin), 019 |
| `getRuleContext(ctx, {enrollmentId, periodId?})` → faits pour les RuleSets | 012, 013 |
| `getNodePrerequisiteStatus(ctx, {studentId, nodeId})` → `{satisfied, missing[]}` | 019, UI |
| `getClassroom`, `listClassrooms`, `getRoster(ctx, classroomId, {onDate?, nodeId?})` | 010, 011, 013, 017 |
| `getOffering`, `listOfferings`, `checkOfferingEligibility(ctx, {offeringId, studentId})` | UI, 007 |
| `getEnrollment`, `listEnrollments(ctx, filters)`, `listEnrollmentsByStudent(ctx, studentId)`, `getEnrollmentHistory` | tous |
| `enrollStudent(ctx, input)` (appelé par 007 à `ENROLLED`) · `enrollStudentsBulk` (031 imports) | 007, 031 |
| `recordEnrollmentOutcome(ctx, {enrollmentId, outcomeCode, decisionRef, targetGradeLevelId?, targetProgramId?})` | 013 (décision publiée) |
| `confirmEnrollmentCourse`, `completeEnrollmentCourse(ctx, {enrollmentCourseId, completedAt, outcomeRef})` | 011/019 (UE validée ⇒ sélection terminée) ; finance (via événement) |
| `createEnrollmentDirectory(deps)` → `{ getEnrollment }` conforme à `EnrollmentDirectory` | 014 (adaptateur de câblage) |
| `selfEnrollToOffering(ctx, {offeringId})` · `reopenOffering` | libre-service étudiant ; direction |
| `previewRollover`, `rolloverAcademicYear` | UI direction |
| `instantiatePackReferenceData(ctx, institutionId)` | 003 (onboarding), super-admin |

### 7.3 Ports définis par academic (implémentés ailleurs, branchés au câblage)

| Port | Implémenté par | Rôle |
|---|---|---|
| `StudentDirectory.getStudent(ctx, studentId) → {studentId, status, displayName, studentNumber, sequenceNumber}` | people (`createStudentDirectory`) | valider l'apprenant à l'inscription ; numéro d'ordre pour le numéro d'inscription |
| `PeriodClosureGuard.canClose(ctx, {periodId, classroomId?, to}) → Result<void, {code, reason}>` | 011, 013 | refuser une clôture prématurée |
| `CurriculumUsageGuard.isNodeInUse(ctx, nodeId) → boolean` | 011 (notes/évaluations), 019 (résultats) | interdire un amendement structurel |
| `OfferingReadinessGuard.check(ctx, offeringId) → Result<void, {missing[]}>` | people (`createOfferingReadinessGuard`) | « enseignant par ECUE obligatoire » avant `OPEN` |
| `CompletionLookup.hasValidated(ctx, {studentId, lineageId}) → boolean` | 011/019 (UE validée) ; défaut : sélection `COMPLETED` | prérequis |
| `ScheduleConflictChecker.checkStudentOffering(ctx, {enrollmentId, offeringId}) → {conflicts[]}` | scheduling | avertir d'un chevauchement d'horaires (non bloquant) |
| `TemplateProvider.getSection(pack, educationSystem, 'academic')` | tenancy | lire le modèle de pack |

Un port non câblé a un **comportement de repli explicite et sûr** (`StudentDirectory` : refus ; gardes : aucun refus ; `CompletionLookup` : sélections `COMPLETED`) documenté dans `plan.md`.

### 7.4 Interfaces demandées aux autres specs (à acter)

- **014-finance** : (a) `EnrollmentRef` gagne `fundingType?`, `fundingReference?` et `registrationNumber?` (additif ; le numéro d'inscription figure sur les reçus et les bulletins) ; (b) la ligne de facture issue d'une sélection à la carte porte `sourceRef = enrollmentCourseId`, et `finance.invoice.paid` rappelle les `sourceRef` payés ; (c) la dimension « nœud de curriculum (lignée) » d'un barème de frais (prix d'une UE) ; (d) `finance.invoice.paid` indique si la facture contient des frais de catégorie `REGISTRATION`.
- **011-assessments-grades** : refuse toute écriture quand `getEffectivePeriodState ≠ OPEN` ; implémente `CurriculumUsageGuard` et `PeriodClosureGuard` ; rattache les évaluations à `curriculum_node_id` (+ `subject_id` pour la mutualisation).
- **013-report-cards** : appelle `recordEnrollmentOutcome` à la publication d'une décision ; implémente `PeriodClosureGuard`.
- **019-higher-education** : implémente `CompletionLookup` ; consomme `lineage_id` pour la capitalisation.
- **003-organization-campus** : expose `getPackTemplateSection` et publie `tenancy.tenant.provisioned` / `tenancy.institution.created` ; le schéma de modèle de pack accepte des sections par module.
- **032-payroll-port** : n'utilise pas academic directement (voir 017 `listPayableHours`).

### 7.5 Extension d'assemblage (migration `0706`, faits pour results / higher / attendance / scheduling)

Ajout ADDITIF (aucune colonne existante modifiée, valeurs par défaut = comportement antérieur) pour que les adaptateurs de `apps/api/src/platform/adapters` puissent servir les ports de `results` et `higher` sans rien deviner par un libellé :

| Donnée | Où | Rôle |
|---|---|---|
| `grading_mode` (`COMPOSED` / `DIRECT`), `resit_allowed`, `counts_in_average`, `section_key` | `curriculum_nodes` (création, modification en brouillon, **amendement journalisé** `OTHER` sur un curriculum publié) | structure de calcul de `results` (mode de saisie, session 2, nœud compté dans la moyenne, section de bilan) ; `resit_allowed` lu aussi par `assess` |
| `calculation_contract` | `programs` (prioritaire) et `education_levels` (défaut du modèle de pack : `credit-semester@1` pour Licence / Master, `coef-semester@1` pour BTS, primaire et secondaire) | contrat de calcul des résultats ; **aucune valeur par défaut** : sans contrat, `results` échoue fermé |
| `terminal_exam_required` | `grade_levels` (PUT `/reference/grade-levels`, modèle de pack : faux partout) | drapeau d'examen terminal (règle `decision_fin_annee`) ; à renseigner par l'établissement |
| `is_cycle` | `programs` | « nœud de cycle » de `higher` : un programme qui conduit à un diplôme et couvre plusieurs niveaux ; **l'identifiant de cycle de `higher` est l'id du programme**, celui d'une UE est sa **lignée** (`lineage_id`, stable d'une année à l'autre — les nœuds sont recréés par le clonage) |

Lectures publiées (`index.ts`, sans effet de bord, périmètre du contexte, 404 hors périmètre) : `getResultsStructure({classroomId, periodId})` (nœuds UE / ECUE / SUBJECT suivis en mode classe pour la période, avec crédits, coefficients, faits de rang de période — « dernière période » = dernier semestre d'enseignement d'une année qui en compte au moins deux, jamais le libellé —, contrat effectif, examen terminal), `getClassroomFacts`, `listClassroomEnrollments` (actives ou non), `getCycleFacts`, `listProgramUe`, `getUeFacts`, `listCycleEnrollments`, `getLastEnrollmentInProgram`, `listUeRegistrants`, `hasAttendedUe`, `listStudentPlacements`.

Limites : la structure de calcul couvre le mode « classe » (tronc commun) ; les sélections à la carte d'une inscription ne sont pas reflétées dans la structure de classe (à traiter avec l'issue Q-39 des mutations de classe).

## 8. Endpoints (`/api/v1/academic`, plugin Fastify, schémas Zod de `packages/contracts/src/v2/academic.ts`)

| Méthode | Chemin | Description | Permission |
|---|---|---|---|
| GET | `/years`, `/years/:id`, `/years/current?institutionId=` | Lire | `academic.year.read` |
| POST/PATCH | `/years`, `/years/:id` | Créer / modifier (dates tant que `DRAFT`/`OPEN` sans période close) | `academic.year.manage` |
| POST | `/years/:id/open`, `/years/:id/set-current`, `/years/:id/archive` | Cycle de vie | `academic.year.manage` |
| POST | `/years/:id/close` | Clôture de l'année | `academic.year.close` (sensible) |
| GET | `/years/gaps` | Contrôle d'exploitation | `academic.year.read` |
| GET/POST | `/years/:id/periods`, `/years/:id/period-plan` | Lister / créer / appliquer un plan | `academic.period.read` / `.manage` |
| PATCH/DELETE | `/periods/:id` | Modifier / supprimer (PLANNED) | `academic.period.manage` |
| POST | `/periods/:id/open`, `/periods/:id/close-grading`, `/periods/:id/close` | Cycle | `academic.period.close` |
| POST | `/periods/:id/reopen` | Réouverture motivée | `academic.period.reopen` (sensible) |
| GET | `/periods/resolve?institutionId&date&type` | Période d'une date | `academic.period.read` |
| GET/PUT | `/reference/{education-levels,grade-levels,period-types,funding-types,enrollment-outcomes,node-types}` | Référentiels | `academic.read` / `academic.settings.manage` |
| GET/PUT | `/institutions/:id/settings` | Politique de confirmation, réservation, motif | `academic.settings.manage` |
| POST | `/institutions/:id/apply-template` | Appliquer un modèle de pack | `academic.template.apply` (sensible) |
| GET/POST/PATCH | `/programs`, `/programs/:id` ; PUT `/programs/:id/grade-levels` | Programmes | `academic.program.read` / `.manage` |
| GET/POST/PATCH | `/subjects`, `/subjects/:id` | Catalogue de matières | `curriculum.read` / `curriculum.manage` |
| GET | `/curriculum-versions?programId&yearId`, `/curriculum-versions/:id` | Versions et arbre | `curriculum.read` |
| POST | `/curriculum-versions` (vide ou `cloneFrom`), `/curriculum-versions/:id/clone` | Créer / cloner | `curriculum.manage` |
| POST/PATCH/DELETE | `/curriculum-versions/:id/nodes`, `/curriculum-nodes/:id` ; POST `/curriculum-nodes/:id/move` | Éditer l'arbre (DRAFT) | `curriculum.manage` |
| PUT | `/curriculum-nodes/:id/prerequisites` | Remplacer les prérequis | `curriculum.manage` |
| GET | `/curriculum-versions/:id/validate` | Rapport de validation | `curriculum.read` |
| POST | `/curriculum-versions/:id/publish` | Publier | `curriculum.publish` |
| POST | `/curriculum-versions/:id/amend` | Amender une version publiée | `curriculum.amend` (sensible) |
| GET | `/curriculum-versions/:id/amendments` | Journal | `curriculum.read` |
| GET/POST/PATCH | `/classrooms`, `/classrooms/:id` | Classes | `academic.classroom.read` / `.manage` |
| POST | `/classrooms/:id/{activate,complete,cancel}` | Cycle de la classe | `academic.classroom.manage` |
| GET | `/classrooms/:id/roster?onDate&nodeId` | Effectif | `enrollment.read` |
| POST | `/classrooms/:id/periods/:periodId/{close-grading,close,reopen}` | Clôture par classe | `academic.period.close` / `.reopen` |
| GET/POST | `/classrooms/:id/offerings`, `/classrooms/:id/offerings/open-period` | Offres / ouvrir un semestre | `academic.classroom.manage` |
| PATCH/POST | `/offerings/:id`, `/offerings/:id/{open,start,complete,cancel,reopen}` | Cycle d'une offre | `academic.classroom.manage` |
| POST | `/offerings/:id/enroll` | Libre-service : s'inscrire à l'offre (crée l'inscription de la classe si besoin) | `enrollment.self.create` |
| GET | `/offerings/:id/eligibility?studentId` | Éligibilité | `enrollment.read` |
| GET | `/catalog?institutionId&programId` | Catalogue à la carte (offres ouvertes, éligibilité, prérequis, places restantes) | `enrollment.read` ou `enrollment.self.read` |
| GET/POST | `/enrollments`, `/enrollments/bulk` | Lister / inscrire | `enrollment.read` / `.create` |
| GET | `/enrollments/:id`, `/enrollments/:id/history` | Détail / historique | `enrollment.read` |
| POST | `/enrollments/:id/{confirm,suspend,resume,withdraw,cancel,complete,reopen,transfer}` | Actions d'état | `enrollment.update` / `enrollment.cancel` |
| PATCH | `/enrollments/:id/funding` | Financement | `enrollment.funding.update` |
| POST | `/enrollments/:id/outcome` | Issue de fin d'année | `enrollment.outcome.record` |
| GET/POST | `/enrollments/:id/courses` ; POST `/enrollment-courses/:id/{confirm,cancel,complete}` | Sélections | `enrollment.course.manage` (self : `enrollment.self.read` + règle) |
| GET | `/me/enrollments`, `/children/:studentId/enrollments` | Portails | `enrollment.self.read` / `enrollment.child.read` |
| GET | `/me/labels`, `/children/:studentId/labels` | Portails : libellés (classes, périodes, matières des inscriptions de l'élève) pour nommer les identifiants des notes, résultats, présences et séances ; lecture seule, sans donnée de gestion (extension additive, portails 033) | `enrollment.self.read` / `enrollment.child.read` + lien de tutelle (404 hors lien) |
| GET/POST | `/years/:id/rollover/preview`, `/years/:id/rollover` | Reconduction | `academic.year.manage` (sensible) |

Conventions : erreurs `{ status, code, kind, message, issues?, requestId }` (`toErrorBody`) ; codes `academic.*` stables ; pagination `page/pageSize ≤ 200` ; aucun `500` pour une violation d'unicité ou de CHECK prévisible ; entrées `strict` (champs inconnus refusés).

## 9. Écrans

Portail admin (`/admin/academique/*`, route group `(admin)` de la spec 033) ; menus générés depuis le manifeste.

| Écran | Contenu | Rôles |
|---|---|---|
| Années et périodes | Frise de l'année, périodes typées, plan de périodes, états et clôtures, réouverture motivée | Direction, directeur des études |
| Programmes et niveaux | Arbre filière/série/spécialité, niveaux couverts | Direction |
| Éditeur de curriculum | Arbre par programme et année, édition par glisser-déposer, prérequis, rapport de validation, publication, amendements, clonage vers l'année suivante | Responsable pédagogique |
| Classes | Liste filtrable (année, programme, niveau, statut), fiche de classe (effectif, offres, titulaire via people), clôture par classe | Directeur des études, secrétariat |
| Offres (ouverture d'une classe) | Assistant « ouvrir un semestre » (nom, dates, fenêtre, capacité, responsables d'enseignement), suivi des remplissages | Responsable pédagogique |
| Inscriptions | Recherche, création unitaire/en lot, fiche d'inscription (placements, financement, sélections, historique), actions d'état | Secrétariat |
| Catalogue à la carte (étudiant) | Offres ouvertes, prérequis (verrouillé + manquants), places restantes, réservation | Étudiant |
| Mes inscriptions / inscriptions de mon enfant | Lecture seule | Élève, parent |
| Reconduction annuelle | Aperçu par issue, anomalies, lancement, rapport | Direction |
| Paramètres académiques | Politique de confirmation, durée de réservation, motif de numéro d'inscription, référentiels | Direction |

Accessibilité et mobile : tables à défilement, actions principales utilisables sur smartphone ; textes via catalogues i18n `fr-CI`.

### 9.1 Assistant de reconduction (`/v2/academic/rollover`) et paramètres (livrés)

Routes ajoutées (feature `academic.rollover`, permission `academic.year.rollover`) : `GET /years/:id/rollover/plan` (aperçu avec avertissements, sans écriture), `POST /years/:id/rollover/runs` (crée l'exécution et publie `academic.rollover.requested`), `GET /years/:id/rollover/runs`, `GET /rollover/runs/:id` (progression par étape et rapport), `POST /rollover/runs/:id/retry`. Calendrier d'établissement : `GET|POST /holidays`, `PATCH|DELETE /holidays/:id` (`academic.settings.manage`).

Exécution : un abonné du worker (`academic.run-rollover`) rejoue les étapes dans l'ordre, chacune idempotente — calendrier et périodes (dates décalées d'un an), curriculum publié -> brouillon de l'année cible, classes (clé programme + niveau + code), offres (hors de l'année cible : ignorées et listées), jours fériés, puis réinscription en lot des élèves promus. La décision de passage n'est JAMAIS calculée par academic : elle est lue dans `results` par le port `PromotionDecisionPort` (adaptateur `results-academic` : décision d'année confirmée PROMOTED/ADMITTED -> ADVANCE, REPEAT -> REPEAT ; contrat à crédits : année validée -> ADVANCE `YEAR_VALIDATED`, sinon aucune décision, signalée). Une exécution RUNNING sans signe de vie depuis 10 minutes est reprise ; le rejeu ne crée rien en double. Migrations `0707` (exécutions) et `0708` (jours fériés).

## 10. Permissions (déclarées dans `manifest.ts`)

| Clé | Libellé | Sensible |
|---|---|---|
| `academic.read` | Consulter les référentiels et la structure académique | |
| `academic.year.read` / `academic.year.manage` | Consulter / gérer les années | |
| `academic.year.close` | Clôturer une année | oui |
| `academic.period.read` / `academic.period.manage` | Consulter / gérer les périodes | |
| `academic.period.close` | Clore les notes ou les résultats d'une période | |
| `academic.period.reopen` | Rouvrir une période close | oui |
| `academic.program.read` / `academic.program.manage` | Programmes et niveaux | |
| `academic.classroom.read` / `academic.classroom.manage` | Classes et offres | |
| `academic.settings.manage` | Paramètres et référentiels | |
| `academic.template.apply` | Appliquer un modèle de pack | oui |
| `curriculum.read` / `curriculum.manage` / `curriculum.publish` | Lire / éditer / publier un curriculum | |
| `curriculum.amend` | Amender un curriculum publié | oui |
| `enrollment.read` / `enrollment.create` / `enrollment.update` / `enrollment.cancel` | Inscriptions | |
| `enrollment.override` | Déroger à l'éligibilité (fenêtre, prérequis) avec motif | oui |
| `enrollment.self.create` | S'inscrire soi-même à une offre ouverte (libre-service) | |
| `enrollment.funding.update` | Changer le financement | oui |
| `enrollment.outcome.record` | Enregistrer l'issue de fin d'année | |
| `enrollment.course.manage` | Gérer les sélections de cours | |
| `enrollment.self.read` / `enrollment.child.read` | Mes inscriptions / celles de mes enfants | |

Alignement avec les modèles de rôles système (`rbac/templates/system-roles.ts`) : `directeur_etudes` (`academic.*`, `curriculum.*`, `enrollment.read`), `secretariat` (`enrollment.*`, `academic.read`), `responsable_pedagogique` (`academic.read`, `curriculum.*`), `parent` (`*.child.*`), `eleve` (`*.self.*`). Le module n'exige **aucun contrôle de rôle codé en dur**.

Features (`manifest.features`) : `academic.a-la-carte` (packs `HIGHER`), `academic.state-assigned` (pack `SECONDARY`, comme `finance.state-assigned` ; question O-04), `academic.rollover` (tous). Les routes à la carte sont gardées par `requireFeature("academic.a-la-carte")` et la saisie d'un financement `STATE_ASSIGNED` par `requireFeature("academic.state-assigned")`.

## 11. Événements (outbox, `{ v: 1, … }`)

| Événement | Producteur (cas d'usage) | Consommateurs prévus |
|---|---|---|
| `academic.year.opened` / `closed` / `archived` | `openAcademicYear`… | 017 (archive les emplois du temps), 025 |
| `academic.period.opened` / `grading_closed` / `closed` / `reopened` | cycle de période | 011, 013, 010 (recalcul), 025 |
| `academic.classroom_period.grading_closed` / `closed` / `reopened` | clôture par classe | 011, 013 |
| `academic.curriculum.published` / `amended` / `locked` | curriculum | 011, 012 (invalidation), 013, 019 |
| `academic.classroom.created` / `activated` / `completed` / `cancelled` | classes | 017, 010, 016 |
| `academic.offering.opened` / `full` / `reopened` / `started` / `completed` / `cancelled` | offres | 017 (annule les séances), 016 |
| `academic.enrollment.created` / `confirmed` / `suspended` / `resumed` / `withdrawn` / `cancelled` / `transferred` / `completed` / `reopened` | inscriptions | people (projection), 010, 011, 014, 016, 025 |
| `academic.enrollment.funding_changed` | `changeEnrollmentFunding` | 014 (compte de l'apprenant), 025 |
| `academic.enrollment.outcome_recorded` | `recordEnrollmentOutcome` | 025, UI reconduction |
| `academic.enrollment_course.requested` / `confirmed` / `completed` / `cancelled` / `expired` | sélections | 014 (facturer, annuler), 016, 011 |
| `academic.rollover.completed` | reconduction | 016, 025 |

Payloads minimaux versionnés (schémas Zod dans `contracts/v2/academic.ts`) : tous portent `enrollmentId`/`classroomId`/`periodId`… plus `studentId`, `academicYearId`, `institutionId`. **Consommés** : `tenancy.tenant.provisioned` et `tenancy.institution.created` (instanciation des référentiels), `finance.invoice.paid` (confirmation, voir AC5.5), `finance.payment.completed` (information), `people.student.status_changed` (retrait automatique si `WITHDRAWN`/`EXCLUDED`/`TRANSFERRED_OUT`, avec motif).

Tous les consommateurs sont **idempotents** par `event.id` (ADR-004).

## 12. Tests

- **Unitaires purs** (Vitest) : machine d'états d'inscription, d'offre, de période, de classe ; éligibilité (ordre des codes, bornes incluses) ; capacité ; plan de périodes (répartition sans trou) ; génération du numéro d'inscription ; grammaire du curriculum ; clonage (lignées conservées) ; reconduction (matrice issue × niveau suivant) ; `getRuleContext`.
- **Intégration** (Postgres jetable, `TEST_DATABASE_URL`) : les 38 comportements de `data-model.md` (exclusion d'années, grammaire, publication, prérequis d'un curriculum publié, capacité de classe et d'offre, `FULL` dérivé, réservation expirée, doublon de nœud, placements, historique immuable, surcharge d'état de classe, RLS inter-tenants), **plus** concurrence (200 inscriptions / capacité 100), idempotence du rollover, `enrollStudent` ↔ `StudentDirectory` simulé.
- **Isolation générique** (spec 000, bloquant) : 25 tables du module ; allowlist vide.
- **Contrat** : le port `EnrollmentDirectory` de finance est compilé contre `createEnrollmentDirectory` ; les payloads d'événements sont validés par leurs schémas Zod.
- **Golden / caractérisation** (tranche 2.0) : scénarios figés de l'ancien code — éligibilité (`professional-eligibility/capacity/prerequisites/completion/cart.test.ts`), garde de clôture (`professional-gardes.test.ts`) — rejoués sur le nouveau cas d'usage ; les **quatre divergences assumées** (bugs corrigés, listées dans `parity.md` §3) : D1 la dernière place n'est plus refusée à son propre détenteur (éligibilité recalculée en excluant ses propres lignes et les réservations expirées) ; D2 la « porte d'entrée » ne confirme plus en bloc toutes les inscriptions en attente de l'étudiant mais celle visée ; D3 aucune lecture n'écrit (la finalisation d'offre est un job) ; D4 la clôture d'une période ne ferme plus les cohortes de toutes les classes qui partagent l'UE (clôture par classe).
- **Audit** : test d'architecture — chaque cas d'usage sensible (§Permissions) écrit dans `audit_log`.
- **Lint** : pas de littéral de période/niveau/seuil ; pas de SQL hors `infrastructure/` ; pas de `new Date()` direct.
- **Performance** (CI dédiée) : `getCurriculumTree` 3 000 nœuds p95 < 300 ms ; `getRoster` 60 inscrits p95 < 150 ms ; rollover 1 500 inscriptions < 60 s.
- **E2E (Playwright)** : parcours « définir l'année → publier le curriculum → créer la classe → inscrire un élève → changer de classe » et parcours à la carte « étudiant → catalogue → réservation → paiement sandbox → confirmation ».

## 13. Cas limites

- Année chevauchante ou avec trou, périodes hors année ; année dont le premier jour tombe un 29 février ; fuseau : dates civiles (`date`), jamais d'heure locale.
- Curriculum : suppression d'un nœud référencé par un prérequis (cascade contrôlée) ; clone vers une année sans curriculum source ; publication avec crédits UE ≠ Σ ECUE ; deux nœuds au même `code` sous le même parent ; programme archivé avec classes ouvertes.
- Matière mutualisée dans deux UE d'une même année : une note unique alimente deux lignes de bulletin (responsabilité de 011/013, documentée).
- Lignée d'un prérequis absente d'une année cible : l'amendement est refusé à la publication (`WARN` → `ERROR` si le tenant l'exige).
- Dernière place : un apprenant détient la dernière place `PENDING` puis confirme — son propre siège n'est pas compté contre lui ; réservation expirée entre deux écrans → message clair et ré-essai.
- Deux inscriptions simultanées du même apprenant sur la même offre (double clic, deux onglets) : l'index unique partiel transforme la seconde en `academic.duplicate_enrollment`.
- Étudiant inscrit à la carte dans deux classes de programmes différents (le « panier multi-classes » du legacy) : deux inscriptions, une par classe ; finance regroupe par `groupKey`.
- Changement de classe après des notes saisies : même `enrollment_id`, placement historisé ; 011/013 décident du rattachement des notes passées (par `enrollment_id`).
- Apprenant `WITHDRAWN` côté people alors qu'il a des inscriptions vivantes : retrait automatique via l'événement, motif « statut apprenant » ; l'inverse (réinscription) est une action explicite.
- Redoublement : nouvelle inscription, `is_repeating = true`, `previous_enrollment_id`, notes de l'année précédente intactes.
- Clôture d'une période sans notes : possible (rien à vérifier côté 011) ; clôture d'une classe annulée : ignorée.
- Rôle sans périmètre sur un établissement : 404 (pas 403) pour ne pas révéler l'existence.
- Paiement reçu pour une sélection déjà **annulée par expiration** de sa réservation : le consommateur de `finance.invoice.paid` tente de la rétablir (`PENDING → CONFIRMED`) si la place existe encore ; sinon il publie `academic.enrollment_course.payment_orphan` (remboursement ou réaffectation décidés par finance) — jamais d'encaissement silencieusement perdu.
- Le contrat de `listNodesForEnrollment` inclut les nœuds **transversaux** (la conduite est notée au bulletin) avec `isTransversal = true` ; le catalogue à la carte et les offres les excluent.
- Une UE présente dans deux semestres d'une même classe (possible dans le legacy) se modélise par deux nœuds (lignées distinctes) ; un nœud n'a qu'un parent (question O-11).
- Restauration depuis sauvegarde : les files d'événements sont rejouées ; les consommateurs idempotents n'altèrent rien.
- Modèle de pack ré-appliqué après personnalisation par le tenant : lignes personnalisées conservées, rapport des écarts.
- Tenant avec plusieurs établissements de packs différents : référentiels partagés par `code`, curriculums et années par établissement.

## 14. Dépendances

- **En amont** : 000 (kernel, `TenantDb`, outbox), 001/003 (tenant, établissement, campus, modèles de pack, onboarding), 002 (RBAC : `requirePermission`, périmètres, portails), 030 (audit). Dépend de `rbac` et de `tenancy` au niveau du manifeste (`dependsOn: ["rbac", "tenancy"]`), **pas** de `people` (port).
- **En aval** : 005/006/007 (packs), 008-009 (people : projection d'inscriptions, affectations), 010, 011, 012, 013, 014/015 (annuaire), 016, 017, 018, 019, 025, 031.
- **Technique** : PostgreSQL 14+ (`btree_gist`), Zod, `@ecoledigitale/kernel|database`, worker (jobs `expirePendingHolds`, `finalizeEndedOfferings`, `rolloverAcademicYear`), Redis (indirect).
- **Points ouverts du plan (§8)** : n°5 (textes réglementaires et validateur des RuleSets Primary/Secondary) conditionne les valeurs de coefficients des modèles de pack — voir `open-questions.md`.

## 15. Critères de sortie (mesurables)

La spec est terminée lorsque :

1. Les migrations 0700-0704 s'appliquent de zéro avec `migrator` ; le test d'isolation générique passe sur les 25 tables avec deux tenants (zéro fuite) ; l'allowlist du module est vide.
2. Un tenant provisionné pour chacun des quatre packs reçoit ses référentiels par `instantiatePackReferenceData` sans intervention de développeur, et une année + une classe + un curriculum se créent via l'API.
3. Un curriculum Primary (`LEVEL > SUBJECT`) et un curriculum Higher (`LEVEL > PERIOD > UE > ECUE`) sont publiés par le même code ; `getRuleContext` et `listNodesForEnrollment` les restituent sans traitement de nom.
4. Le scénario à la carte (offre → éligibilité → réservation → facture → confirmation sur `finance.invoice.paid`) passe en intégration avec la sandbox de paiement ; la concurrence 200/100 donne exactement 100 réussites.
5. La clôture en deux temps par classe et la réouverture motivée sont couvertes ; le module 011 (ou son simulacre de contrat) refuse l'écriture hors `OPEN`.
6. La reconduction annuelle d'un jeu de 1 500 inscriptions est idempotente et sous 60 s.
7. Les golden tests de caractérisation du legacy (éligibilité, capacité, prérequis, garde de clôture) passent ; les divergences assumées sont toutes listées dans `parity.md`.
8. Aucune constante réglementaire dans `modules/academic/**` (lint) ; aucun SQL hors `infrastructure/` ; aucun `new Date()` ; couverture des cas d'usage ≥ 90 % des lignes du domaine.
9. L'ancien code et les anciennes tables remplacés (tranches 2.1 et 2.2 : `cycles`, `filieres`, `programmes`, `classes`, `academic_years`, `academic_year_periods`, `courses`, `class_courses`, `professional_ue*`, `professional_ecue*`, `professional_semestre*`, `professional_classe_noms`, `student_enrollments`, `professional_enrollments`) sont supprimés dans la même tranche, et aucun accès web ne calcule de moyenne, de rang ou de mention.
