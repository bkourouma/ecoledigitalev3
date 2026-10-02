# Feature Specification: Évaluations, notes et résultats (011-assessments-grades)

**Feature Branch**: `011-assessments-grades`

**Created**: 2026-10-01

**Status**: Rédigée — à relire avec le propriétaire du produit (questions métier : `../012-rules-engine/open-questions.md` §B, Q-08 à Q-12, Q-18, Q-23, Q-35, Q-38, Q-39) avant `/speckit.plan`

**Sources**: `docs/PRD_EcoleDigitale_SaaS.md` §17, §18, §45, §46, §50, §63 ; `docs/PLAN_Mise_en_oeuvre_EcoleDigitale_SaaS.md` §3.7, §3.8, §4 (tranche 2.5) ; `docs/adr/ADR-002/003/004/006/007` ; `docs/architecture/module-conventions.md` ; `docs/inventory/legacy-dependents-by-slice.md` (tranche 2.5) ; legacy : `apps/api/src/services/professional-assignments.service.ts`, `professional-results.service.ts`, `professional-cloture-guard.ts`, `professional-bulletin.service.ts` (calcul), `apps/api/src/routes/semester-averages.ts`, `student-grades.ts`, `parent-grades.ts`. Gabarit : `specs/v2/000-platform-foundation/spec.md`.

> **Deux modules, une spec** : `assess` (types d'évaluation, évaluations, notes, workflow, révisions, verrous de période — schéma `assess`) et `results` (résultats calculés de période et d'année, surcharges, décisions, délibérations, clôture — schéma `results`). `results` dépend de `assess` et de `rules` (012) ; `assess` ne dépend d'aucun des deux (décision A-21).
> Les **moyennes ne sont plus saisies** : elles sont **calculées par le Rules Engine** (contrats `credit-semester@1`, `coef-semester@1`, spec 012). Une surcharge manuelle reste possible, avec justification, approbation et audit.
> Identifiants du cœur (spec 004/008/009/010/017), utilisés **par UUID sans clé étrangère** : `academic.enrollments.id`, `academic.curriculum_nodes.id`, `academic.academic_periods.id`, `academic.academic_years.id`, `academic.classrooms.id`, `people.students.id`, `people.staff.id`.

## 1. Objectifs

1. **Saisir les notes une seule fois, dans un circuit contrôlé** : `DRAFT → SUBMITTED → REVIEWED → APPROVED → PUBLISHED`, avec immuabilité après publication appliquée par l'application **et** par un trigger ; toute correction crée une `GradeRevision` (ancienne/nouvelle valeur, auteur, justification, approbateur, date).
2. **Calculer** les résultats (matière/ECUE, UE, période, année, rang, mention, décision) par le Rules Engine à partir des seules notes publiées, de façon **reproductible** (version de règle épinglée, hash d'entrées/sorties) et **explicable** (trace).
3. **Recalculer automatiquement** quand une note publiée ou une surcharge change (`assess.grade.published` → recalcul coalescé), sans jamais toucher une période clôturée.
4. **Clôturer** une période (verrou des notes, délibération, résultats `FINAL` immuables) et fournir aux bulletins (013) et au supérieur (019) un état figé et signé de hash.
5. **Supprimer** les deux piles divergentes de notes (classique : moyennes saisies ; Professional : `professional_ecue_notes/results`) et les doublons de calcul côté web.

## 2. Périmètre

### Inclus

- Types d'évaluation **configurables par tenant** (interrogation, devoir, composition, examen blanc, projet, oral, TP, autre… PRD §17) avec barème, poids, groupe d'agrégation et règle de publication ; modèles par pack seedés au provisioning.
- Évaluations rattachées à un nœud de curriculum (matière / ECUE), une classe, une période, une session (1 normale, 2 rattrapage), un enseignant.
- Saisie des notes (grille web, mobile, saisie en lot idempotente), états d'entrée (noté, absence justifiée, absence non justifiée, dispensé, non évalué), workflow de validation, révisions de notes, verrous de période.
- Lecture par l'élève et le tuteur des **notes publiées** uniquement.
- Résultats calculés par période et année : lignes (ECUE, matière, UE, section), synthèse (moyenne, rang, mention, crédits, décision), versions `DRAFT/FINAL/SUPERSEDED`, trace.
- Orchestration des pipelines des contrats de règles (012), phase individuelle puis phase de cohorte (rang).
- Surcharges justifiées (valeur ou validation), décisions (proposée par la règle, confirmée par le conseil/jury), délibérations, appréciations.
- Clôture, réouverture contrôlée, recalcul (événements, coalescence, jobs), alertes de retard de version de règle.
- Événements consommés par 013 (bulletins), 019 (crédits), 025 (analytique), notifications.

### Exclu (renvoyé)

| Sujet | Spec |
|---|---|
| Langage de règles, RuleSets, gouvernance, simulation | 012 |
| Génération du bulletin, snapshot, PDF, QR | 013 |
| Capitalisation de crédits, rattrapage (inscriptions session 2), diplomation | 019 |
| Conseil de classe complet (primaire/secondaire : participants, discipline, PV) | 005, 006 (réutilisent `results.deliberations/decisions`) |
| Devoirs à rendre, QCM en ligne, corrections IA, supports de cours (`professional_assignment_questions`, `ai_*`, `homework_annotations`) | 022-lms, 026-ai (après V1) |
| Import de notes Excel/CSV | 031-imports (l'API en lot de cette spec est la cible de l'importeur) |
| Présences et justificatifs | 010 |
| Examens nationaux (CEPE, BEPC, BAC, BTS) | 018 |

## 3. Acteurs

| Acteur | Rôle dans cette spec |
|---|---|
| Enseignant | Crée ses évaluations, saisit et soumet ses notes, demande des corrections, saisit des appréciations de matière |
| Responsable pédagogique / directeur des études | Relit, approuve, publie ; approuve les corrections ; verrouille, délibère, clôture ; approuve les surcharges |
| Direction / propriétaire | Consulte résultats et taux de complétion ; rouvre une période (sensible) |
| Conseil de classe / jury | Confirme ou modifie les décisions proposées par la règle |
| Élève, tuteur | Lisent les notes publiées et résultats finalisés visibles |
| Worker | Recalculs coalescés, clôtures en lot, rejeu de reproductibilité, purge des brouillons |
| Module `rules` | Fournit la version épinglée et exécute les règles |
| Module `reportcards` / `higher` | Consomment résultats `FINAL` et événements |

## 4. User Stories et critères d'acceptation

### US1 — Saisir des notes depuis un navigateur ou un téléphone (P1)

En tant qu'enseignant, je saisis les notes d'une évaluation pour ma classe, même avec une connexion faible.

- **AC1.1** Je ne vois et ne saisis que les évaluations des matières et classes qui me sont **affectées** (port `TeachingAssignmentPort` vers 009/004) ; une saisie hors affectation est refusée `403 assess.not_assigned`.
- **AC1.2** Une note doit respecter `0 ≤ score ≤ scale_max` de l'évaluation (contrôle applicatif **et** trigger) ; une absence justifiée ou injustifiée, un dispensé, un non évalué n'ont pas de score (`score IS NULL`).
- **AC1.3** La saisie en lot `PUT /assessments/:id/grades` est **idempotente** (clé d'idempotence) et **concurrente-sûre** (`row_version` par note) : rejouer le même lot n'écrit rien ; deux lots concurrents sur la même note produisent `409 assess.stale_grade` pour le second.
- **AC1.4** Une grille de 60 élèves est enregistrée en **≤ 300 ms p95** côté serveur ; le formulaire mobile fonctionne hors ligne avec file d'attente de mutations (squelette 029) et se resynchronise sans doublon ni écrasement silencieux.
- **AC1.5** Tant que l'évaluation est `DRAFT`, je modifie librement ; l'historique des brouillons n'est pas conservé (seule la valeur courante + horodatage).

### US2 — Faire valider avant publication (P1)

En tant que responsable pédagogique, je relis les feuilles de notes avant que les élèves les voient.

- **AC2.1** Transitions autorisées uniquement : `DRAFT→SUBMITTED`, `SUBMITTED→REVIEWED|DRAFT`, `REVIEWED→APPROVED|DRAFT`, `APPROVED→PUBLISHED|DRAFT`, rien depuis `PUBLISHED`. Toute autre ⇒ `409 assess.invalid_transition` (miroir SQL).
- **AC2.2** Une évaluation vide (aucune note saisie) ne peut pas être soumise ; une évaluation dont des élèves n'ont aucune ligne reçoit à la soumission une ligne `NOT_GRADED` par inscription active (aucun trou).
- **AC2.3** Par défaut, la personne qui **soumet** ne peut pas **relire/approuver/publier** la même évaluation (réglage d'établissement `require_separate_reviewer`, défaut vrai ; si désactivé, la dérogation est **inscrite** sur la transition : `four_eyes_waived = true`, Q-11).
- **AC2.4** Chaque transition enregistre acteur, date, commentaire (obligatoire pour un retour `→ DRAFT`) et écrit une entrée d'audit dans la même transaction (R5 du plan).
- **AC2.5** À la publication, toutes les notes de l'évaluation passent `PUBLISHED` **atomiquement** ; l'événement `assess.grade.published` est émis dans la même transaction (outbox), un par évaluation (et non par note), avec la liste des inscriptions concernées.
- **AC2.6** Le **mode de publication** du type d'évaluation (`MANUAL` / `AUTO_ON_APPROVAL`) est respecté ; une évaluation d'un type dont `visible_to_students = false` (ex. examen blanc interne) est publiée pour le calcul mais **masquée** aux élèves et tuteurs.

### US3 — Corriger une note publiée sans la réécrire en silence (P1)

En tant qu'enseignant, je demande la correction d'une note publiée ; en tant que responsable, je l'approuve.

- **AC3.1** `UPDATE grades SET score = …` sur une note `PUBLISHED` est **refusé par le trigger** pour tout rôle applicatif ; seule `assess.apply_revision(revision_id)` peut la modifier, et seulement si la révision est `APPROVED` (A-24).
- **AC3.2** Une révision contient : ancienne et nouvelle valeur (score et état d'entrée), motif **obligatoire** (≥ 10 caractères), demandeur, approbateur, dates ; l'approbateur ≠ le demandeur (sauf dérogation tracée Q-11).
- **AC3.3** Les types de révision : `CORRECTION`, `ADDITION` (élève absent de la feuille à la publication), `REMOVAL` ; l'annulation d'une évaluation publiée est un lot de `REMOVAL` approuvé en une décision.
- **AC3.4** L'application d'une révision émet `assess.grade.revised` ; le recalcul des résultats `DRAFT` suit ; pour une période **verrouillée**, la révision n'est applicable qu'après réouverture (US6).
- **AC3.5** L'historique complet d'une note (saisie, soumission, relecture, publication, révisions) est consultable par la direction ; l'élève ne voit que la valeur courante et la mention « corrigée le … ».

### US4 — Obtenir des moyennes calculées, jamais saisies (P1)

En tant que responsable, je veux que les moyennes, rangs, mentions et décisions viennent des règles.

- **AC4.1** Aucun endpoint n'accepte la saisie d'une moyenne calculée ; la seule voie manuelle est la **surcharge** (US5) ou le type d'évaluation « moyenne saisie » (Q-35), qui est une **note** soumise au même circuit.
- **AC4.2** Pour une classe, un calcul de période produit pour chaque inscription un en-tête de résultat (version, hash, version de règle) et des lignes par ECUE/matière/UE ; les valeurs sont **exactes** (`numeric`) ; la valeur d'affichage arrondie est distincte.
- **AC4.3** Les résultats `LMD` de la baseline sont **identiques** à ceux du code historique sur les scénarios figés de la tranche 2.0 (golden tests du plan), aux écarts documentés près (ADR-003 : 24 couples de seuil exact ; arrondi en cascade supprimé).
- **AC4.4** Aucun calcul de moyenne, rang ou mention n'existe plus dans le code web (garde-fou : grep CI sur les fonctions `average|rank|mention` dans `apps/web/src`, liste blanche vide).
- **AC4.5** Pour 60 étudiants × 12 matières, le calcul complet d'une période (phase individuelle + rang) s'exécute en **≤ 5 s** (objectif ; moteur ≥ 40 000 évaluations/s).
- **AC4.6** Une note non publiée n'entre **jamais** dans un résultat ; une note `ABSENT_*` / `EXEMPT` / `NOT_GRADED` ne produit pas de zéro implicite (c'est la règle qui décide, Q-10).

### US5 — Surcharger avec justification (P2)

En tant que responsable, je corrige exceptionnellement une valeur calculée ou une validation (jury).

- **AC5.1** Une surcharge cible une valeur précise (inscription × période × nœud × niveau) et porte : valeur d'origine, valeur imposée, justification (≥ 20 caractères), demandeur, approbateur ≠ demandeur, dates.
- **AC5.2** Une surcharge `APPROVED` est **injectée dans le contexte** de l'étape concernée (les étapes en aval utilisent la valeur surchargée) et marquée dans la trace ; elle ne modifie jamais les notes.
- **AC5.3** Une surcharge expire avec la période (liée à `state_id`), peut être révoquée (statut `REVOKED`, motif) ; le recalcul qui suit retire l'effet.
- **AC5.4** Chaque surcharge est auditée (`audit.record`, `severity = warning`) ; le nombre de surcharges par période est exposé au tableau de bord direction.

### US6 — Verrouiller, délibérer, clôturer, rouvrir (P1)

En tant que directeur, je fige les résultats d'une période et je peux la rouvrir de manière tracée.

- **AC6.1** `lock` refuse si des évaluations de la classe et de la période ne sont pas `PUBLISHED`/`CANCELLED` (liste renvoyée) ; un forçage (avec liste d'exceptions et motif) existe pour la direction ; verrouiller pose `assess.period_locks` et interdit toute écriture de note et toute publication pour cette classe × période (trigger).
- **AC6.2** `deliberate` enregistre la délibération (date réelle, type conseil/jury, participants) ; les décisions proposées par les règles sont confirmées ou modifiées (modification ⇒ justification obligatoire) ; le bulletin définitif exige une délibération `HELD` (Q-34).
- **AC6.3** `close` calcule les résultats `FINAL` de tous les inscrits, calcule le **hash de clôture** (agrégat des `outputs_hash`), bascule en `CLOSED` ; les résultats `FINAL` sont immuables (trigger).
- **AC6.4** `reopen` exige `results.period.reopen` (sensible), un motif et l'approbation de la direction ; il libère le verrou, repasse `OPEN`, et la prochaine clôture créera des résultats `FINAL` en **version n+1** (les anciens restent `SUPERSEDED`, consultables) ; 013 marque les bulletins concernés « à rééditer ».
- **AC6.4b** Deux natures de réouverture : `CORRECTION` (ci-dessus, sensible) et `RESIT_SESSION` (planifiée, déclenchée par la fenêtre de rattrapage de 019, sans permission sensible) ; la seconde ne libère que la **session 2** (`locked_sessions = {1}`), les notes de session 1 restent verrouillées, et la période revient `CLOSED` à la reclôture avec des résultats en version `n+1`.
- **AC6.5** La clôture d'un semestre ne dépend pas du statut des cohortes de cours (le legacy faisait passer les cohortes à `termine`) : l'état de période est explicite.

### US7 — Les familles voient leurs notes et résultats (P2)

- **AC7.1** Un élève lit ses notes publiées et visibles ; un tuteur lit celles de ses enfants (lien tuteur/élève vérifié par port `GuardianshipPort`, 008) ; aucun accès aux notes des autres.
- **AC7.2** Les résultats d'une période ne deviennent visibles qu'après clôture (`FINAL`) et, si configuré, après publication du bulletin (013).
- **AC7.3** La réponse ne contient ni détail des surcharges ni commentaires internes.

### US8 — Recalcul automatique et maîtrisé (P1)

- **AC8.1** `assess.grade.published` et `assess.grade.revised` créent ou mettent à jour **une** demande de recalcul par `(classe, période)` avec temporisation de 10 s ; 40 évaluations publiées en rafale produisent **un** calcul.
- **AC8.2** Un recalcul ne crée une nouvelle version de résultat que si `inputs_hash` ou la version de règle a changé (idempotence) ; sinon il ne fait rien.
- **AC8.3** Un recalcul d'une période verrouillée/clôturée est **bloqué** (statut `BLOCKED`) et signalé à la direction ; il ne modifie rien.
- **AC8.4** Un changement de version de règle active (`rules.version.approved`) ne recalcule rien ; les périodes ouvertes en retard de version sont listées avec un bouton « re-pin + recalcul » (simulation préalable).
- **AC8.5** Un étudiant dont le calcul échoue (donnée manquante, budget dépassé) est marqué `ERROR` avec diagnostic ; le reste de la classe est calculé.

## 5. Conception du calcul

### 5.1 Pipeline

`results` implémente les pipelines des contrats de la spec 012 :

| Contrat | Pipeline | Niveaux produits |
|---|---|---|
| `credit-semester@1` | ECUE → UE → semestre → (année/cycle) | `ECUE`, `UE`, `PERIOD`, `YEAR` |
| `coef-semester@1` | matière → section → période → année | `SUBJECT`, `SECTION`, `PERIOD`, `YEAR` |

Phase 1 (par inscription) : constitution du contexte (données publiées + curriculum + surcharges) → évaluations dans l'ordre du contrat → persistance (en-tête + lignes). Phase 2 (par classe × période) : rang de chaque valeur concernée (global, section, matière) à partir des valeurs de phase 1, puis mise à jour des en-têtes (même version si seules les valeurs de rang changent). Phase 3 (clôture) : année/cycle si applicable.

### 5.2 Données lues (ports)

| Port | Fournisseur | Utilisation |
|---|---|---|
| `CurriculumReader` | 004 | arbre de nœuds, crédits, coefficients, `grading_mode`, `resit_allowed`, `counts_in_average`, `category`, ordre ; programme/niveau (`examen_terminal_requis`) |
| `EnrollmentDirectory` | 004/008 | inscriptions actives d'une classe × année, statut, élève |
| `PeriodReader` | 004 | périodes (type, rang, dates), année |
| `TeachingAssignmentPort` | 009/004 | l'enseignant enseigne-t-il ce nœud dans cette classe ? |
| `GuardianshipPort` | 008 | tuteur ↔ élève |
| `AttendanceSummaryPort` | 010 | absences justifiées/non justifiées de la période (pour le bulletin, pas pour le calcul) |

Chaque port est une interface déclarée par le module consommateur et implémentée par l'API publique du module fournisseur ; **aucune requête SQL inter-schéma**. Exigences envers 004 : attributs de nœud `grading_mode` (`COMPOSED|DIRECT`), `resit_allowed`, `counts_in_average`, `category`, `ordre` ; attribut de programme/niveau `terminal_exam_required` ; type et rang des périodes (`second_semestre` n'est plus déduit du nom).

### 5.3 Reproductibilité

Chaque en-tête stocke : `rule_version_id`, `rule_set_code`, `rule_version_no`, `definition_hash`, `engine_version`, `inputs_hash`, `outputs_hash`. Les résultats `FINAL` stockent en plus `inputs` (contexte canonique, sans identité) et la `trace`. Le job de rejeu (012 AC4.3) recalcule et compare. Un `DRAFT` peut être expliqué à la demande par rejeu avec les données courantes.

### 5.4 Recalcul

```
assess.grade.published/revised ─┐
results.override.approved ──────┤
academic.enrollment.* (arrivée/départ, classe) ─┼─►  results.recompute_requests (unique par classe×période, not_before = dernier événement + 10 s)
rules.binding.changed (périodes ouvertes) ──────┤
POST /results/recompute (manuel) ───────────────┘
        │  job worker `results.recompute` (SKIP LOCKED, un seul actif par clé)
        ▼
  période OPEN ? ── non ──► BLOCKED + alerte
        │ oui
  phase 1 pour les inscriptions concernées ; si une valeur a changé → phase 2 (classe entière)
  nouvelle version DRAFT seulement si inputs_hash/version changent ; événement results.period_result.computed
```

### 5.5 États de période

```
OPEN ──lock──► GRADING_LOCKED ──deliberate──► DELIBERATED ──close──► CLOSED
  ▲                                                                      │
  └─────────────────────────────── reopen (motif + approbation) ◄────────┘
```

`assess.period_locks` reflète `GRADING_LOCKED` et au-delà. La délibération peut être sautée si le tenant a désactivé `require_deliberation` (le bulletin porte alors « sans délibération » plutôt qu'une date fausse).

## 6. Règles métier

| # | Règle |
|---|---|
| R-ASS-01 | Une évaluation appartient à **une** classe, **un** nœud de curriculum, **une** période, **une** année, **une** session (1 ou 2), **un** enseignant ; son barème `scale_max > 0`, son poids `≥ 0`. `scale_max`, `weight`, nœud, période sont **figés dès `SUBMITTED`**. |
| R-ASS-02 | Une note par inscription et par évaluation (`UNIQUE (assessment_id, enrollment_id)`). |
| R-ASS-03 | Seul `ENTERED` porte un score ; les autres états d'entrée n'en portent pas. La règle de calcul décide du traitement (zéro, ignoré). |
| R-ASS-04 | `PUBLISHED` est terminal pour les notes ; la seule voie de modification est une `GradeRevision` approuvée appliquée par `assess.apply_revision`. |
| R-ASS-05 | Une note ne peut être créée, modifiée, supprimée que si l'évaluation est `DRAFT` **ou** si une révision `APPROVED` correspondante est appliquée **et** si la période n'est pas verrouillée. |
| R-ASS-06 | Un type d'évaluation ne peut pas être supprimé s'il est utilisé ; il peut être désactivé. Les types « système » (modèles de pack) ne sont pas supprimables, leur libellé et leurs valeurs par défaut sont modifiables. |
| R-ASS-07 | La session 2 (rattrapage) n'est ouverte que pour les nœuds `resit_allowed` et les inscriptions éligibles selon la règle `eligible_rattrapage` (019) ; une évaluation de session 2 est un objet ordinaire du même circuit. |
| R-ASS-08 | Un élève ne voit une note que si l'évaluation est `PUBLISHED` et son type `visible_to_students`. |
| R-RES-01 | Les calculs n'utilisent que des notes `PUBLISHED` (hors type masqué si la règle de contrat l'exclut), des surcharges `APPROVED`, et la version de règle épinglée. |
| R-RES-02 | Un résultat `FINAL` est immuable ; une correction crée une version supérieure (réouverture) et marque l'ancienne `SUPERSEDED`. |
| R-RES-03 | Une période se clôt pour une **classe** ; l'année se clôt quand toutes les périodes requises de la classe sont `CLOSED`. |
| R-RES-04 | Le rang n'est calculé que sur la cohorte de la classe × période (jamais d'une autre classe) et uniquement sur les valeurs non nulles. |
| R-RES-05 | Une décision confirmée différente de la décision proposée exige une justification et est auditée ; elle n'écrase jamais la proposition (les deux sont conservées). |
| R-RES-06 | Une surcharge approuvée s'applique à l'étape ciblée ; le recalcul la rejoue ; elle est tracée dans le bulletin. |
| R-RES-07 | Le libellé d'une mention ou d'une décision n'est jamais comparé : la logique s'appuie sur les **codes** de sortie des règles. |
| R-RES-08 | L'absence d'une règle active pour la classe × période (`rules.resolve = null`) empêche tout calcul et affiche un diagnostic actionnable. |
| R-RES-09 | Les appréciations (matière, conseil) sont modifiables jusqu'à la clôture, figées ensuite ; elles sont copiées dans le snapshot de bulletin. |

## 7. Modèle de données

Voir `data-model.md`. Schémas `assess` (migrations `1100-1199`) et `results` (`1200-1299`), plages proposées.

| Schéma | Tables |
|---|---|
| `assess` | `assessment_types`, `assessments`, `grades`, `grade_revisions`, `period_locks`, `settings` |
| `results` | `period_states`, `period_results` (en-têtes `PERIOD`/`YEAR`), `line_results`, `closures`, `overrides`, `decisions`, `deliberations`, `appreciations`, `recompute_requests` |

## 8. Endpoints

Préfixes `/api/v1/assess` et `/api/v1/results`. Schémas Zod dans `packages/contracts/src/v2/{assess,results}.ts` avant les routes.

### 8.1 `assess`

| Méthode | Chemin | Description | Permission |
|---|---|---|---|
| GET / POST / PATCH | `/assessment-types[/:id]` | Types configurables | `assessment.type.read` / `.manage` |
| GET / POST | `/assessments` | Liste filtrée (classe, période, nœud, statut, enseignant) ; création | `assessment.read` / `assessment.manage` |
| POST | `/assessments/bulk` | Créer la même évaluation pour plusieurs classes | `assessment.manage` |
| GET / PATCH | `/assessments/:id` | Détail ; modification en `DRAFT` | idem |
| GET | `/assessments/:id/grades` | Feuille de notes | `grade.read` |
| PUT | `/assessments/:id/grades` | Saisie en lot idempotente (`Idempotency-Key`, `row_version`) | `grade.enter` |
| POST | `/assessments/:id/transitions` | `{ to, comment }` : soumettre, relire, approuver, publier, retourner | `grade.enter` (soumettre), `grade.review`, `grade.validate`, `grade.publish` |
| POST | `/assessments/:id/cancel` | Demande d'annulation (lot de `REMOVAL`) | `grade.revise.request` |
| POST | `/grades/:id/revisions` | Demande de correction | `grade.revise.request` |
| GET | `/revisions` | Demandes à traiter | `grade.revise.approve` |
| POST | `/revisions/:id/approve` \| `/reject` | Décision | `grade.revise.approve` |
| GET | `/me/grades`, `/children/:studentId/grades` | Notes publiées de l'élève / du tuteur | session élève / tuteur |
| GET / PUT | `/settings` | Réglages d'établissement | `assessment.type.manage` |

### 8.2 `results`

| Méthode | Chemin | Description | Permission |
|---|---|---|---|
| GET | `/classrooms/:classroomId/periods/:periodId` | Matrice des résultats de la classe (lignes, rang, mention, décision, état) | `result.read` |
| GET | `/enrollments/:enrollmentId/periods/:periodId` | Résultats d'un élève (avec détail ECUE/UE) | `result.read` |
| GET | `/enrollments/:enrollmentId/years/:yearId` | Résultats annuels | `result.read` |
| GET | `/results/:resultId/explain` | Trace d'explicabilité | `result.explain` |
| POST | `/recompute` | Recalcul manuel `{ classroomId, periodId, enrollmentIds? }` | `result.recompute` |
| POST | `/classrooms/:classroomId/periods/:periodId/lock` \| `/deliberate` \| `/close` \| `/reopen` | Cycle de période | `period.lock` / `decision.record` / `period.close` / `period.reopen` |
| GET | `/classrooms/:classroomId/periods/:periodId/state` | État, complétion, évaluations en attente, version de règle épinglée, retard de version | `result.read` |
| POST | `/periods/:stateId/repin` | Re-pin sur la version active (période ouverte, simulation jointe) | `period.repin` |
| GET / POST | `/overrides` ; POST `/overrides/:id/approve` \| `/reject` \| `/revoke` | Surcharges | `result.override.request` / `.approve` |
| GET / PUT | `/decisions` ; POST `/decisions/:id/confirm` | Décisions | `decision.record` / `decision.approve` |
| GET / POST / PATCH | `/deliberations` | Séances de conseil / jury | `decision.record` |
| GET / PUT | `/appreciations` | Appréciations de matière et générales | `appreciation.write` |
| GET | `/me/results`, `/children/:studentId/results` | Résultats finalisés visibles | session élève / tuteur |

## 9. Écrans

| Portail | Écran | Contenu |
|---|---|---|
| Enseignant | **Mes évaluations** | Liste par classe/période, statut du circuit, création rapide, duplication vers d'autres classes |
| Enseignant | **Grille de saisie** | Tableau classe × évaluation, raccourcis clavier, pavé numérique mobile, états d'absence, contrôle du barème en direct, file hors ligne, soumission |
| Responsable | **Feuilles à relire** | Écarts par rapport à la moyenne de la classe, valeurs aberrantes, retour motivé à l'enseignant, approbation, publication en lot |
| Responsable | **Corrections** | File des révisions à approuver, comparaison ancienne/nouvelle valeur |
| Direction | **Période : tableau de bord** | Complétion par matière/classe, évaluations manquantes, version de règle épinglée, retard de version, boutons verrouiller / délibérer / clôturer / rouvrir |
| Direction | **Résultats de classe** | Matrice classe : moyennes, rangs, mentions, décisions proposées/confirmées, surcharges ; filtre ERROR |
| Direction | **Délibération** | Ouverture, liste des décisions proposées, confirmation, justification des écarts, procès-verbal |
| Direction | **Pourquoi ce résultat ?** | Trace d'explicabilité d'une valeur (partagée avec 012) |
| Élève / tuteur | **Mes notes**, **Mes résultats** | Notes publiées (valeur, barème, moyenne de classe si activée), résultats finalisés |

Aucune logique métier dans le web : les écrans affichent les valeurs et codes fournis par l'API.

## 10. Permissions

| Clé | Libellé | Sensible |
|---|---|---|
| `assessment.type.read` / `assessment.type.manage` | Consulter / gérer les types d'évaluation et les réglages | non / oui |
| `assessment.read` / `assessment.manage` | Consulter / créer et modifier les évaluations | non |
| `grade.read` | Consulter les notes d'une évaluation | non |
| `grade.enter` | Saisir et soumettre les notes de ses évaluations | non |
| `grade.review` | Relire une feuille de notes soumise | non |
| `grade.validate` | Approuver une feuille de notes | oui |
| `grade.publish` | Publier une feuille de notes | **oui** |
| `grade.revise.request` | Demander la correction d'une note publiée | non |
| `grade.revise.approve` | Approuver une correction | **oui** |
| `result.read` | Consulter les résultats | non |
| `result.explain` | Consulter la trace d'un résultat | non |
| `result.recompute` | Relancer un calcul | non |
| `result.override.request` / `result.override.approve` | Demander / approuver une surcharge | non / **oui** |
| `period.lock` / `period.close` / `period.repin` | Verrouiller / clôturer / re-pinner une période | oui |
| `period.reopen` | Rouvrir une période clôturée | **oui** (MFA) |
| `decision.record` / `decision.approve` | Enregistrer / confirmer les décisions | non / oui |
| `appreciation.write` | Rédiger les appréciations | non |

Un enseignant n'a jamais `grade.validate`/`grade.publish` sur ses propres évaluations sauf dérogation tracée (Q-11). Features (`entitlements`) : `assess.session2` (supérieur), `results.deliberation`, `results.public-visibility`.

## 11. Événements

Publiés (outbox ; `{ v: 1, … }`) :

| Événement | Payload | Consommateurs |
|---|---|---|
| `assess.assessment.created` / `.submitted` / `.reviewed` / `.approved` | `assessmentId, classroomId, periodId, nodeId, status` | notifications, tableau de bord |
| `assess.grade.published` | `assessmentId, classroomId, academicPeriodId, curriculumNodeId, sessionNo, enrollmentIds[], publishedAt` | `results` (recalcul), 025, notifications élèves/tuteurs (selon visibilité) |
| `assess.grade.revised` | `assessmentId, gradeId, enrollmentId, revisionId, kind` | `results`, notifications direction |
| `assess.assessment.cancelled` | `assessmentId, reason` | `results` |
| `assess.period.locked` / `assess.period.unlocked` | `classroomId, academicPeriodId` | `results` |
| `results.period_result.computed` | `enrollmentId, academicPeriodId, resultId, version, status` | 025 |
| `results.period.locked` / `.deliberated` / `.closed` | `classroomId, academicPeriodId, stateId, closureHash, resultsVersion` | `reportcards` (génération proposée), `higher` (capitalisation), notifications |
| `results.period.reopened` | `classroomId, academicPeriodId, reason` | `reportcards` (bulletins « à rééditer »), `higher` |
| `results.decision.confirmed` | `enrollmentId, scope, kind, finalCode, outcome` | `academic` (progression de l'inscription), `higher`, 013 |
| `results.override.approved` / `.revoked` | `overrideId, enrollmentId, periodId` | `results` (recalcul), audit |
| `results.recompute.blocked` | `classroomId, academicPeriodId, reason` | direction |

Consommés : `academic.enrollment.created|transferred|withdrawn` (recalcul/inscriptions), `rules.version.approved|published|retired`, `rules.binding.changed`, `rules.simulation.requested`, `tenancy.tenant.provisioned` (types d'évaluation du pack), `attendance.*` (aucun pour le calcul).

## 12. Tests

- **Golden tests (bloquant)** : scénarios figés de la tranche 2.0 (jeux d'étudiants de `professional-results.test.ts`, `moyennes-semestre.spec.ts`, scénario S17-T côté notes) rejoués sur les contrats ; écarts autorisés listés (E1-E3 de `rulesets-de-depart.md`).
- **Workflow** : table de vérité transitions × acteurs ; séparation des tâches (réglage on/off, dérogation tracée) ; atomicité de la publication ; un événement par évaluation.
- **Immuabilité (bloquant)** : tentative d'`UPDATE`/`DELETE` d'une note `PUBLISHED` par `app_user` ⇒ erreur de trigger ; application d'une révision approuvée ⇒ succès ; révision non approuvée ⇒ échec ; période verrouillée ⇒ échec.
- **Concurrence** : lots concurrents (`row_version`), rejeu idempotent, publication simultanée de deux évaluations de la même classe ⇒ un recalcul.
- **Calcul** : contextes (absence ≠ 0, ordre déterministe, aucune identité), pipelines des deux contrats, surcharges injectées et tracées, phase de rang après phase individuelle, 60 × 12 ≤ 5 s, 1 000 étudiants sans erreur.
- **Reproductibilité** : mêmes (version, hash) ⇒ mêmes sorties ; rejeu d'un échantillon `FINAL` ; modification d'une note après clôture sans réouverture impossible.
- **Isolation** : test générique spec 000 pour les 15 tables ; un tuteur ne lit que ses enfants.
- **Audit (R5)** : `expectAudited` pour chaque transition, révision, surcharge, verrou, clôture, réouverture ; `expectAuditRolledBack`.
- **Architecture** : `dependency-cruiser` (`assess` n'importe ni `results` ni `rules`) ; lint R2 sans constante.
- **Web** : grep CI « aucun calcul de moyenne dans `apps/web/src` » ; Playwright enseignant (saisie, soumission), responsable (relecture, publication, clôture), parent (lecture seule).

## 13. Cas limites

- **Élève ajouté après publication** : ligne créée par `ADDITION` approuvée ; recalcul de la classe.
- **Élève quittant la classe / mutation en cours de période** : ses notes restent attachées à son inscription d'origine ; le résultat de l'inscription d'arrivée n'utilise que ses propres notes (Q-39 pour la reprise éventuelle).
- **Évaluation sans aucune note** : ne se soumet pas ; une évaluation `DRAFT` ancienne est signalée à l'enseignant (job).
- **Barème modifié après saisie** : refusé dès `SUBMITTED` ; en `DRAFT`, les notes hors nouveau barème bloquent la modification.
- **Enseignant remplacé** : l'affectation (009) change ; l'évaluation reste à son auteur ; le remplaçant peut la reprendre (transfert tracé).
- **Période sans aucune évaluation publiée** : résultats `PENDING` (aucune moyenne), jamais 0.
- **Cohorte très grande (> 5 000)** : classement découpé (spec 012 §13).
- **Clôture avec erreurs de calcul** : refusée tant qu'une inscription est `ERROR` (liste), sauf forçage avec exclusion explicite et motif (l'étudiant exclu n'a pas de résultat `FINAL`).
- **Règle indisponible pendant la clôture** : transaction annulée, période inchangée.
- **Réouverture d'une période dont des bulletins sont publiés** : confirmation explicite ; les bulletins publiés restent valides jusqu'à réédition et affichent « une version plus récente peut exister » à la vérification.
- **Absences multiples à une même évaluation (session 2)** : chaque session est une évaluation distincte ; la règle choisit la note retenue.
- **Notes décimales** : saisie à 3 décimales maximum ; stockage `numeric(8,3)` ; aucun arrondi à la saisie.
- **Fuseau** : horodatages UTC ; dates d'évaluation en `date`.
- **Données personnelles de mineurs** : lecture restreinte (RBAC + RLS + port tuteur) ; export contrôlé ; pas de note dans les journaux d'application (l'audit stocke des différences masquées selon la politique du module `audit`).

## 14. Dépendances

- **En amont** : 000, 001 (features), 002 (RBAC, MFA), 003 (périmètres, CountryProfile), 004 (curriculum, périodes, inscriptions, classes — **attributs listés §5.2**), 008 (élèves, tuteurs), 009 (affectations), 012 (rules), 030 (audit). Worker (Phase 1).
- **En aval** : 013 (bulletins), 019 (supérieur), 018/005/006 (examens, conseils), 025 (analytique), 016 (notifications), 029 (hors ligne).
- **Technique** : Postgres 14+, BullMQ, `@ecoledigitale/rules-engine` via `rules`.

## 15. Critères de sortie (mesurables)

1. Un tenant de test saisit, soumet, relit, approuve et publie une feuille de notes ; le recalcul de la période produit des résultats qui égalent les golden tests de la tranche 2.0 (écarts documentés mis à part).
2. `UPDATE` direct d'une note publiée est impossible pour `app_user` (test d'intégration) ; une correction passe par une révision approuvée et crée une entrée d'historique.
3. 40 évaluations publiées en rafale produisent **un** calcul de classe ; l'idempotence est démontrée par rejeu.
4. Une période clôturée est immuable ; sa réouverture crée une version `n+1` et signale les bulletins à rééditer.
5. Aucune moyenne, rang ou mention n'est calculé dans `apps/web/src` (grep CI vert) ; aucune constante de seuil dans `assess`/`results` (lint R2).
6. Les anciens services `professional-assignments`, `professional-results`, `semester-averages` (moyennes), `student_period_course_averages`, `professional_ecue_notes/results` sont supprimés dans la même tranche (règle de sortie du plan §4).
7. Le test d'isolation générique couvre les 15 tables ; les événements sont déclarés dans les manifestes.

## Addendum d'assemblage (additif)

- `assess.isCurriculumNodeInUse` et `results.isCurriculumNodeInResults` : un nœud de curriculum portant une évaluation, une note ou un résultat est « utilisé » ; academic refuse alors un amendement STRUCTUREL d'un curriculum publié (garde `CurriculumUsageGuard`, échec fermé).
- Le rattrapage autorisé est une **donnée** du nœud de curriculum (`resitAllowed`, migration académique 0706) ; la structure de calcul de `results` (contrat, rang de période, crédits, parents) est lue dans academic par `platform/adapters/academic-results.ts`.

## Extensions Phase 4-5 (additif : packs Primaire, Secondaire, Examens)

Livré dans `apps/api/src/modules/results` (migration `1204_results_council.sql`) ; aucun test existant n'a changé de sens.

- **Contrats pris en charge** : `coef-period@1` (pipeline `domain/pipeline/coef-period.ts` : matière → période → rangs → affichage ; à la **dernière période** : moyenne générale annuelle, rang annuel, cas à examiner `BORDERLINE` / `LONG_ABSENCE` / `ALREADY_REPEATED`, proposition `PENDING` / `PROMOTED` / `REPEAT` / `COUNCIL_REVIEW`), `competency-period@1` (pipeline minimal `competency-period.ts` : décision sans moyenne à partir des compteurs de compétences), `secondary-annual@1` (même pipeline que `coef-semester@1`, étape annuelle sur N périodes pondérées). Toute formule et tout seuil restent dans le jeu de règles. Les poids de période (`PeriodFacts.weight`) viennent du calendrier d'academic (`average_weight`), les faits d'assiduité et de redoublement du port facultatif `YearFactsPort` (adaptateur `platform/adapters/results-year-facts.ts` : attendance + academic), les compteurs de compétences du port facultatif `CompetencyCountersPort` (`primary_school`). Fait indisponible : signalé (`yearFacts: "UNAVAILABLE"`), jamais deviné ; compteurs absents à la dernière période : calcul refusé (échec fermé).
- **`COUNCIL_REVIEW` n'est jamais une décision finale** : la proposition reste `PROPOSED`, n'est jamais confirmée d'office par la délibération ni par la clôture, et un code final explicite est exigé (`results.decision_not_final`). Trancher une proposition `COUNCIL_REVIEW` n'est pas un écart à la règle : aucune justification d'écart ; s'écarter d'une proposition ferme exige toujours 20 caractères (R-RES-05). Codes permis pour une décision de fin d'année des contrats du primaire : `PROMOTED`, `REPEAT`.
- **Provenance exposée** : `PeriodView.ruleSourceKind` (`GET …/state` : bandeau « règles de démonstration ») ; le bundle FINAL lu par `reportcards` porte `rules.sourceKind` (`placeholder` ⇒ filigrane, mention imprimée, vérification publique).
- **Port d'ÉCRITURE des conseils** (`application/council-write.ts`, spec 006 §7.3 `ResultsWritePort`) : `openCouncilDeliberation`, `markDeliberationHeld`, `publishYearDecision` (crée ou confirme la décision de portée année ; idempotente), `recordDistinction`, `writeCouncilAppreciation`. Chaque appel porte l'acteur humain (`ctx`), le module appelant (`councils` ou `primary_school`) et la référence **opaque** de l'acte du conseil (`actor.councilRef`) ; tout est audité dans la même transaction (jamais le texte d'une appréciation), l'événement `results.decision.confirmed` est inchangé, une période clôturée refuse l'écriture (`results.state_closed`). Une décision écrite par un conseil sans proposition de règle a `origin = COUNCIL`. Le conseil des maîtres réutilise `results.deliberations` (`kind = COUNCIL`) et `results.decisions` (spec 005 T-P02).
- **Quorum** : `evaluateCouncilQuorum(deps, ctx, { classroomId, academicPeriodId, convoked, present })` évalue la règle `quorum_conseil` de la version épinglée (ou active) ; le résultat porte la provenance.
- **Correction** : `listYearEndDecisions` (lue par la reconduction d'academic) ne lit plus que les décisions `YEAR_END` (une distinction de portée année n'est pas une issue d'inscription).
