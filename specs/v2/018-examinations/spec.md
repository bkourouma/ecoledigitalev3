# Feature Specification: Examens nationaux (018-examinations)

**Feature Branch**: `018-examinations`

**Created**: 2026-10-02

**Status**: Rédigée — DDL de référence exécuté et testé (166 tests de comportement dont essais de concurrence réels, `ddl/`), prête pour `/speckit.plan`

**Sources**: `docs/PRD_EcoleDigitale_SaaS.md` §14 (CEPE), §21 (examens nationaux), §15–§19 (BEPC, BAC), §22–§24 (BTS), §47, §57 ; `docs/PLAN_Mise_en_oeuvre_EcoleDigitale_SaaS.md` §3.7, §3.8, §4 (Phases 4 et 5), §8 ; `specs/v2/012-rules-engine/regulatory-sources-needed.md` §4 et `rule-contracts.md` §5 (contrat annoncé `exam-national@1`) ; `docs/architecture/module-conventions.md` ; specs `004` (inscriptions, classes d'examen), `008` (élèves), `011` (évaluations d'examens blancs), `013` (documents scellés), `005`, `007` ; legacy : `student_enrollments.cepe_code` (`MIG/0059`), `exam_schedules` (`MIG/0033`).

> **Aucune règle d'examen officielle n'est inventée.** Éligibilité, épreuves, coefficients, seuil d'admission, mentions, définition du taux de réussite, formats d'échange avec l'autorité : **inconnus** (`regulatory-sources-needed.md`, `open-questions.md`). Le module est un **mécanisme générique** ; le CEPE en est la **première instance**, avec des **données fictives** marquées `source_kind = placeholder`. L'admission d'un examen **officiel** est celle que l'autorité prononce : le module l'enregistre, il ne la calcule jamais.

## 1. Principe : un moteur générique, des types d'examens en données

`ExaminationManagement` (PRD §21) sert CEPE, BEPC, BAC, BTS **sans code propre à chacun** : un **type d'examen** est une ligne de données (code, cycle, niveau d'examen, contrat de règles, motif de numéro de candidat, séries, épreuves, pièces exigées, formats d'export). Le pack Primary instancie `CEPE` ; le pack Secondary instanciera `BEPC` et `BAC` (006) ; le supérieur `BTS` (020). Ajouter un examen = ajouter des lignes et un RuleSet, pas du code.

| Besoin du PRD §14 / §21 | Comment il est couvert | Propriétaire |
|---|---|---|
| Candidats | Sélection depuis les inscriptions de la classe d'examen ; identité figée à l'inscription | `examinations.candidates` ; élèves = `people` ; inscriptions = `academic` |
| Éligibilité | **Règle** `eligibilite` (jamais en dur) ; journal des évaluations ; dérogation motivée | `rules` (contrat `exam-national@1`) + `eligibility_checks` |
| Inscriptions aux examens | Cycle `DRAFT → PRE_REGISTERED → REGISTERED` (ou `WITHDRAWN`), ouverte/fermée par la session | `candidates`, `sessions` |
| Pièces | Pièces exigées par type d'examen, relecture, état des manques | `document_requirements`, `candidate_documents` ; stockage = `DocumentStore` |
| Numéro de candidat | **Compteur transactionnel sans trou** + motif en donnée ; **numéro officiel** attribué par l'autorité (identifiant importé) | `candidates.candidate_number`, `candidate_identifiers` |
| Centres et salles | Centres (propre / d'accueil), salles, répartition (centre, salle, place) | `centers`, `rooms`, `session_centers`, `seat_assignments` |
| Examens blancs | Sessions `MOCK` liées à des évaluations `assess` ; moyenne et issue **calculées par règle** | `sessions.session_kind`, `paper_assessment_links`, `candidate_results` (`COMPUTED`) |
| Résultats | Saisie ou **import** des résultats officiels ; notes d'épreuves ; publication ; révisions tracées | `paper_scores`, `candidate_results`, `import_batches` |
| Admission | Issue `ADMITTED`/`FAILED`/`ABSENT`/`EXCLUDED`/`DEFERRED`, dérivée du résultat | `candidate_results` → `candidates.outcome` |
| Statistiques | Compteurs par établissement / série / sexe / niveau ; taux par **règle** | `result_counts()` + `taux_reussite` |
| Exports | Formats **en données** (colonnes, encodage, séparateur) ; exécution tracée | `export_formats`, `export_runs` |
| Documents | Convocation, attestation de réussite, relevé de notes — scellés, QR | `issued_documents` + `reportcards.requestOfficialDocument` |
| Historique | Création, statut, éligibilité, issue, affectation | `candidate_history` (ajout seul) |

## 2. Objectifs

1. Un **moteur d'examens générique** : types, séries, épreuves, pièces, formats = **données**.
2. Une **définition d'examen figée par session** : une session passée ne change jamais, même si le modèle du type évolue.
3. Des **candidats traçables** : numéro sans trou, identité figée, éligibilité par règle journalisée, pièces, historique.
4. Des **résultats officiels reproduits fidèlement** (import ou saisie, jamais calculés), publiés puis **corrigés seulement par révision approuvée**.
5. Des **examens blancs** réellement utiles : notes issues d'`assess`, moyenne et issue par règle, tracées (version de règle, empreinte).
6. Des **exports officiels paramétrables** sans code, des **statistiques** dont les taux sont des règles.
7. Le **CEPE comme première instance**, avec données fictives clairement marquées, prêt à recevoir les textes officiels.

## 3. Périmètre

### Inclus

Types d'examens, séries, épreuves, pièces exigées, formats d'export ; sessions officielles et blanches (définition figée, cycle de vie) ; candidats (identité figée, éligibilité par règle, pièces, numéro, identifiants officiels) ; centres, salles, répartition ; notes d'épreuves ; lots d'import ; résultats (officiels importés ou saisis, blancs calculés) ; révisions ; statistiques ; exports ; documents (convocation, attestation de réussite, relevé) ; historique ; liens avec `assess` ; CEPE fictif.

### Exclu (renvoyé)

| Sujet | Spec |
|---|---|
| Règles officielles (conditions, épreuves, coefficients, barèmes, mentions) | attendent les textes (`regulatory-sources-needed.md`) |
| Types BEPC, BAC (séries, épreuves) | 006 (utilise ce moteur) |
| BTS : admissibilité, stage, soutenance, jury | 020, 021 (après V1) |
| Intégration technique avec une plateforme publique d'examens (PRD §20 : « lorsqu'une interface officielle existe ») | futur : le port d'échange est le **format d'export/import** en données |
| Délibération du jury **national** (l'autorité) | hors périmètre : on enregistre ses résultats |
| Emploi du temps des épreuves, surveillance | 017 (`kind = EXAM`) — voir §14 |
| Frais d'inscription à l'examen | 014 : les montants et les factures restent dans `finance` ; ce module porte le **barème** (quels frais pour quel type) et l'**obligation** de chaque candidat (décision Q-E13 : frais intégrés à l'inscription) |
| Orientation / admission en 6e à partir du CEPE | 006 / 007 (consomment le résultat) |
| Import générique de fichiers (colonnes, mapping, rapport) | 031 (le module livre le **lot** et ses lignes ; l'analyse de fichier peut passer par 031) |

## 4. Acteurs

| Acteur | Rôle |
|---|---|
| Chef d'établissement / directeur | Ouvre et ferme les inscriptions, valide la liste, publie les résultats, approuve les révisions |
| Responsable des examens / secrétariat | Prépare la session, inscrit les candidats, gère pièces, centres, convocations, imports et exports |
| Enseignant / instituteur | Saisit les notes des **examens blancs** (via `assess`), consulte ses candidats |
| Famille / candidat | Reçoit la convocation et l'attestation (portail parent, 013) ; ne saisit rien |
| Autorité d'examen (externe) | Fournit numéros officiels, calendrier, résultats (fichiers) |
| Super-administrateur | Publie les RuleSets officiels et les formats d'export de plateforme |

## 5. User stories et critères d'acceptation

### US1 — Types d'examens en données (P1)

- **AC1.1** Un type (`exam_types`) a un code (`CEPE`, `BEPC`, `BAC`, `BTS`…), un cycle, un niveau d'examen facultatif (ex. `CM2`), un contrat de règles (`exam-national@1`), un **motif de numéro** de candidat (`{TYPE}{YEAR}-{SEQ:5}` par défaut, jetons `{TYPE}`, `{YEAR}`, `{SEQ:n}`, compteur obligatoire), une origine (`source_kind` : un type `regulation` cite sa référence — contrainte).
- **AC1.2** Séries (`exam_tracks`) et épreuves (`exam_papers`) sont des données du type : coefficient > 0, barème > 0, facultative ou non, commune ou propre à une série ; **aucune** épreuve ni coefficient n'est dans le code.
- **AC1.3** Les pièces exigées (`document_requirements`) et les **formats d'export** (§US9) sont aussi des données.
- **AC1.4** Le pack Primary instancie **un seul** type, `CEPE`, avec trois épreuves **fictives** (`EP1`, `EP2`, `EP3`, `placeholder`) ; aucune épreuve, aucun coefficient officiel n'y figure.

### US2 — Sessions et définition figée (P1)

- **AC2.1** Une session (`sessions`) vise un type, un établissement, une année de session ; elle est **officielle** (participation à une édition de l'autorité) ou **blanche** (examen blanc, qui prépare une session officielle **du même type**).
- **AC2.2** `instantiate_session_definition` **copie** séries et épreuves **actives** du type dans la session puis la **fige** (`definition_locked_at`, inaltérable) ; une épreuve inactive n'est jamais copiée ; modifier le modèle du type **ne change pas** la session ; une copie sans épreuve est refusée ; une seconde copie est refusée.
- **AC2.3** Cycle : `PLANNED → REGISTRATION_OPEN → REGISTRATION_CLOSED → IN_PROGRESS → RESULTS_ENTERED → PUBLISHED → ARCHIVED` ; retour permis `REGISTRATION_CLOSED → REGISTRATION_OPEN` et `RESULTS_ENTERED → IN_PROGRESS` ; ouvrir les inscriptions exige la définition figée ; **publier exige un résultat pour chaque candidat inscrit** (`results_incomplete`) ; type, établissement, nature, année et code sont figés ; une session archivée est figée.

### US3 — Candidats, éligibilité, pièces (P1)

- **AC3.1** Un candidat naît `DRAFT`, dans une session `PLANNED`/`REGISTRATION_OPEN`, pour un **élève** (`studentId`) de l'établissement de la session ; **un seul candidat vivant par élève et par session** ; la série du candidat appartient à la session.
- **AC3.2** **Éligibilité** : `eligibility_status` est **dérivé** du journal `eligibility_checks` (ajout seul : version de règle, résultat `ELIGIBLE/INELIGIBLE/NEEDS_REVIEW`, motifs, empreinte d'entrées ou auteur) ; une **dérogation** (motif ≥ 10 caractères, auteur) vaut éligible ; personne ne pose le statut à la main (`eligibility_derived`).
- **AC3.3** **Inscription** (`REGISTERED`) d'une session officielle : session `REGISTRATION_OPEN`, éligibilité `ELIGIBLE`, **toutes les pièces obligatoires acceptées** (la liste des manques est citée), identité (nom, prénom, naissance, sexe) **figée** à cet instant (`snapshot_taken_at`) ; une session **blanche** n'exige ni éligibilité ni pièces.
- **AC3.4** Un retrait exige un motif ≥ 5 caractères ; il est impossible une fois les résultats saisis (`withdraw_after_results`) ; un candidat retiré ne change plus.
- **AC3.5** Identité figée après inscription ; élève, session, établissement figés ; l'**issue** (`outcome`) est **dérivée** du résultat (`outcome_derived`).

### US4 — Numéro de candidat et identifiants officiels (P1)

- **AC4.1** Le **numéro de candidat** est attribué à l'inscription par un **compteur transactionnel sans trou** par session : une inscription annulée ne consomme aucun numéro ; un candidat retiré **garde** son numéro, qui n'est **jamais réattribué** ; le numéro est **immuable**, unique par session (`CEPE2027-00001`…).
- **AC4.2** **Concurrence** : 4 sessions Postgres inscrivant 20 candidats en parallèle obtiennent 20 numéros **distincts**, de `00001` à `00020` (test à sessions réelles).
- **AC4.3** Les identifiants attribués par l'autorité (numéro officiel, numéro de table, identifiant national, **code CEPE du legacy**) sont des `candidate_identifiers` : un par nature et par candidat, **unique par session et nature** (un identifiant ne désigne qu'un candidat).

### US5 — Centres, salles, répartition, convocations (P2)

- **AC5.1** Centres (`OWN`/`HOST`, code officiel facultatif), salles (code unique par centre, capacité > 0), centres de la session ; une place = (centre de la session, salle **du centre**, numéro ≤ capacité).
- **AC5.2** Un candidat inscrit a **une** place par session ; une place n'a **qu'un** candidat ; un candidat non inscrit ou retiré n'en reçoit pas ; la répartition est **figée** dès que la session est `IN_PROGRESS`.
- **AC5.3** Une **convocation** n'est émise que pour un candidat ayant une place ; elle est scellée par `reportcards` (QR) ; une version révoquée se remplace par une version suivante.

### US6 — Examens blancs (P1)

- **AC6.1** Une session `MOCK` lie ses épreuves à des **évaluations `assess`** d'une classe (`paper_assessment_links`, une évaluation n'alimente qu'une épreuve) ; les liens ne concernent **que** les examens blancs et sont figés une fois les résultats saisis.
- **AC6.2** Les notes importées d'`assess` (publiées seulement) deviennent des `paper_scores` (`source = ASSESS`, avec la référence de l'évaluation) ; les résultats de l'examen blanc sont **calculés par la règle** (`COMPUTED`) avec **version de règle et empreinte d'entrées obligatoires** (contrainte) ; un résultat d'examen blanc ne peut pas être « importé ».
- **AC6.3** Les résultats d'un examen blanc ne servent **jamais** de document officiel (convocation et attestation exigent un résultat officiel publié).

### US7 — Notes et résultats officiels (P1)

- **AC7.1** Les notes d'épreuves (`paper_scores`) ne se saisissent que pour un candidat **inscrit**, session `IN_PROGRESS`/`RESULTS_ENTERED`, épreuve de **la** session et de la série du candidat, note ≤ barème de l'épreuve ; `ENTERED` exige une valeur, `ABSENT`/`EXCUSED`/`MALPRACTICE` n'en ont pas ; une note par candidat et par épreuve.
- **AC7.2** Les **résultats officiels** sont `IMPORTED` (lot d'import obligatoire) ou `ENTERED` (auteur obligatoire), **jamais** `COMPUTED` (`official_not_computed`) ; un absent, exclu ou ajourné n'a ni moyenne, ni rang, ni mention ; un résultat naît `DRAFT`, la publication est une étape distincte.
- **AC7.3** **Lots d'import** : un fichier (empreinte SHA-256) ne s'importe **qu'une fois** par session et nature ; un lot en erreur ne s'applique pas ; un lot appliqué est immuable ; les lignes sont en ajout seul et ne contiennent ni nom ni adresse.
- **AC7.4** Une fois la session `RESULTS_ENTERED`, une note ou un résultat publié ne se corrige que par une **révision approuvée par une autre personne** (motif ≥ 10 caractères) insérée **dans la même transaction** ; la révision d'une transaction antérieure ne couvre pas une nouvelle correction ; les révisions sont en ajout seul.
- **AC7.5** L'issue du candidat (`ADMITTED`…) suit son résultat (mise à jour imbriquée) et est journalisée dans l'historique.

### US8 — Statistiques (P2)

- **AC8.1** `result_counts(session, groupe)` fournit des **compteurs** (inscrits, présents, admis, ajournés, absents, exclus, différés) par établissement, série, sexe, niveau ou global ; un regroupement inconnu ne renvoie **aucune ligne** (liste blanche) ; lecture sous la RLS de l'appelant.
- **AC8.2** Le **taux de réussite** est une **règle** (`taux_reussite`) dont le dénominateur (présents ou inscrits) est un **paramètre** de la version de règle ; sa définition officielle est une question métier ; dénominateur nul ⇒ valeur absente (jamais 100 %).
- **AC8.3** Statistiques par établissement, série et **sexe** (PRD §21) ; comparaison avec l'année précédente et avec l'examen blanc de la même édition ; export CSV.

### US9 — Exports officiels paramétrables (P1)

- **AC9.1** Un **format d'export** (`export_formats`) décrit : nature (liste de candidats, répartition, résultats, statistiques), format de fichier (CSV, XLSX, largeur fixe, JSON), encodage, séparateur, **colonnes** (en-tête, **champ source de la liste blanche**, transformation de la liste blanche, épreuve visée) — **aucune** expression libre, aucune interpolation ; il est versionné (`DRAFT → PUBLISHED → RETIRED`) et **figé une fois publié** ; un seul publié par code.
- **AC9.2** Un export ne s'exécute qu'avec un format **publié** ; la version utilisée est enregistrée (valeur fournie ignorée) ; l'exécution termine par une empreinte du fichier, son stockage et son effectif ; elle est **immuable** ensuite.
- **AC9.3** Les formats **officiels** (fichiers échangés avec l'autorité) sont **inconnus** : le module livre des formats **fictifs** (`placeholder`) et le mécanisme ; chaque format officiel obtenu s'ajoute comme **donnée**.

### US10 — Documents (P2)

- **AC10.1** Documents : `CONVOCATION`, `ATTESTATION_REUSSITE`, `RELEVE_NOTES` ; scellés par `reportcards.requestOfficialDocument` (nouvelles natures, demande de changement 013) avec QR de vérification ; un seul document **vivant** par candidat et nature ; réémission = version suivante après **révocation motivée** (≥ 10 caractères).
- **AC10.2** L'**attestation de réussite** n'est émise que pour un résultat **ADMIS publié** ; la **convocation** que pour un candidat avec place ; un candidat non inscrit n'en reçoit aucun ; un document émis ne change plus.
- **AC10.3** Les familles consultent les documents de leurs enfants **liés** ; accès journalisé (013).

### US11 — Historique et audit (P1)

- **AC11.1** `candidate_history` (ajout seul, alimenté par déclencheur) restitue création, changements de statut, d'éligibilité et d'issue avec acteur et horodatage.
- **AC11.2** Les opérations sensibles (`publish`, `revise`, `apply import`, `override eligibility`, `release results`) appellent `audit.record(tx, …)` ; **aucune** note ni identité dans l'audit ni dans les événements.

### US12 — CEPE, première instance (P1)

- **AC12.1** Le pack Primary fournit : type `CEPE` fictif, 3 épreuves fictives, pièce exigée fictive (« acte de naissance »), RuleSet `CI-EXAM-PLACEHOLDER`, 2 formats d'export fictifs, **jeux de démonstration** (une session blanche et une session officielle de 40 candidats).
- **AC12.2** Parcours E2E : une classe de CM2 → candidats → éligibilité → pièces → inscription → numéros → centres → convocations → examen blanc (notes `assess`) → clôture → **import de résultats officiels fictifs** → publication → attestations → statistiques → export, **sans Excel**.
- **AC12.3** Le `cepe_code` du legacy est repris comme identifiant `CEPE_CODE` d'un candidat (parité) ; l'**affectation** et l'admission en 6e **consomment** le résultat publié (006/007), elles n'en font pas partie.

## 6. Règles métier

- **R-EXA-01** Aucune épreuve, aucun coefficient, aucun seuil, aucune condition d'éligibilité, aucun taux n'est en code : types, épreuves et formats sont des **données**, le reste est une **règle** (`exam-national@1`).
- **R-EXA-02** L'admission d'un examen **officiel** est enregistrée, jamais calculée (`official_not_computed`) ; celle d'un examen **blanc** est calculée et **tracée** (version de règle + empreinte).
- **R-EXA-03** La définition d'une session est **figée** à la préparation ; le modèle du type n'a aucun effet rétroactif.
- **R-EXA-04** Le numéro de candidat est **sans trou**, **immuable**, **jamais réattribué** ; le numéro officiel de l'autorité est un identifiant distinct.
- **R-EXA-05** L'identité d'un candidat est **figée** à l'inscription (listes officielles reproductibles).
- **R-EXA-06** Un statut dérivé (éligibilité, issue) ne se pose **jamais** à la main : il vient de son journal ou de son résultat.
- **R-EXA-07** Toute correction après saisie des résultats passe par une **révision approuvée** par une autre personne, dans la même transaction que la trace.
- **R-EXA-08** Un résultat **publié** ne se dépublie pas ; seule la révision le corrige.
- **R-EXA-09** Un fichier d'import ne s'applique **qu'une fois** et **sans erreur** ; il ne transporte ni nom ni adresse en base.
- **R-EXA-10** Un export n'utilise qu'un format **publié** et **figé** ; les colonnes ne citent que des champs de la **liste blanche**.
- **R-EXA-11** Un document officiel n'est jamais produit à partir d'un résultat **calculé** (examen blanc).
- **R-EXA-12** Isolation tenant par RLS ; aucune donnée personnelle dans événements, audit ni logs.

## 7. Contrat de règles et RuleSet fictif

Voir `rule-contract.md` : contrat `exam-national@1` (éligibilité, moyenne et issue d'un candidat d'examen blanc, mention, rang, taux de réussite, arrondi), RuleSet fictif `CI-EXAM-PLACEHOLDER`, golden tests de mécanisme G1–G14.

## 8. Modèle de données

Voir `data-model.md` (DDL de référence **exécuté et testé** sur PostgreSQL 17 : 166 tests, dont concurrence réelle). Schéma `examinations`, migrations `2000`–`2002` (plage `2000–2099`).

| Table | Rôle |
|---|---|
| `exam_types`, `exam_tracks`, `exam_papers`, `document_requirements`, `export_formats` | Types d'examens et leurs données |
| `centers`, `rooms` | Centres et salles |
| `sessions`, `session_tracks`, `session_papers`, `session_centers` | Sessions et définition figée |
| `candidates`, `candidate_identifiers`, `eligibility_checks`, `candidate_documents`, `seat_assignments`, `candidate_history` | Candidats |
| `paper_scores`, `score_revisions`, `candidate_results`, `result_revisions`, `import_batches`, `import_rows`, `paper_assessment_links` | Notes, résultats, imports, examens blancs |
| `export_runs`, `issued_documents` | Exports, documents |
| `number_sequences` | Numérotation sans trou |

Toutes les tables portent `tenant_id` + RLS forcée ; **allowlist d'isolation vide** (aucune table globale).

## 9. Endpoints (`/api/v1/examinations`)

Schémas Zod dans `packages/contracts/src/v2/examinations.ts`. Erreurs `examinations.*` stables.

| Méthode | Chemin | Description | Permission |
|---|---|---|---|
| GET/POST/PATCH | `/exam-types`, `/exam-types/:id` ; `/exam-types/:id/tracks`, `/papers`, `/document-requirements` | Types et leurs données | `exam.type.read` / `exam.type.manage` |
| GET/POST/PATCH | `/centers`, `/centers/:id/rooms` | Centres et salles | `exam.center.manage` |
| GET/POST/PATCH | `/sessions`, `/sessions/:id` | Sessions | `exam.session.read` / `.manage` |
| POST | `/sessions/:id/instantiate` | Copie et fige la définition | `exam.session.manage` |
| POST | `/sessions/:id/transition` | Changer de statut (ouvrir, clore, démarrer, saisir, publier, archiver) | `exam.session.manage` ; `exam.result.publish` (**sensible**) pour `PUBLISHED` |
| GET/POST | `/sessions/:id/candidates` ; POST `/sessions/:id/candidates/from-classroom` | Candidats (sélection d'une classe d'examen) | `exam.candidate.manage` |
| GET/PATCH | `/candidates/:id` ; POST `/candidates/:id/register`, `/withdraw` | Fiche, inscription, retrait | `exam.candidate.manage` |
| POST | `/candidates/:id/eligibility` | Évaluer (règle) ou déroger (motif) | `exam.eligibility.evaluate` ; `exam.eligibility.override` (**sensible**) |
| GET/PUT | `/candidates/:id/documents[/:reqId]` | Pièces | `exam.candidate.manage` |
| PUT | `/candidates/:id/identifiers` | Numéro officiel, code CEPE… | `exam.candidate.manage` |
| PUT | `/sessions/:id/centers` ; POST `/sessions/:id/assignments/auto`, PUT `/assignments/:candidateId` | Centres de la session, répartition | `exam.center.manage` |
| PUT | `/sessions/:id/scores/bulk` | Notes d'épreuves (lot idempotent) | `exam.score.enter` |
| POST | `/sessions/:id/mock/link`, `/mock/import-from-assess`, `/mock/compute` | Liens `assess`, import des notes publiées, calcul par règle | `exam.mock.manage` |
| POST/GET | `/sessions/:id/imports` ; POST `/imports/:id/validate`, `/apply` | Lots d'import | `exam.import.manage` ; `/apply` : `exam.result.release` (**sensible**) |
| PUT/POST | `/sessions/:id/results`, `/results/:id/publish` ; POST `/results/:id/revisions` | Résultats, publication, révision (approbateur ≠ demandeur) | `exam.result.enter` ; `exam.result.publish` ; `exam.result.revise` (**sensible**) |
| POST | `/scores/:id/revisions` | Révision d'une note | `exam.result.revise` |
| GET | `/sessions/:id/statistics?groupBy=` | Compteurs + taux (règle) | `exam.statistics.read` |
| GET/POST | `/export-formats[/:id]`, `/export-formats/:id/publish` | Formats | `exam.export.manage` |
| POST/GET | `/sessions/:id/exports`, `/exports/:id` | Exécution et téléchargement | `exam.export.run` |
| POST | `/candidates/:id/documents/issue`, `/issued-documents/:id/revoke` | Convocation, attestation, relevé | `exam.document.issue` |
| GET | `/me/exam-documents`, `/children/:studentId/exam-documents` | Famille | `exam.document.self.read` / `.child.read` |

## 10. Écrans

**Responsable des examens** : « Examens » (types et sessions, avancement en phases), session (définition figée, calendrier), **liste des candidats** (sélection d'une classe d'examen, éligibilité, pièces manquantes, numéro), centres et salles (plan de répartition, glisser-déposer), convocations en lot, examens blancs (liaison aux évaluations, calcul, comparaison), import des résultats (aperçu, erreurs ligne à ligne, application), publication, révisions, statistiques par établissement/série/sexe, exports. **Parent** : convocation, attestation. Bandeau « Règles de démonstration » tant qu'un RuleSet fictif sert.

## 11. Permissions (déclarées dans `manifest.ts`)

`exam.type.read|manage`, `exam.center.manage`, `exam.session.read|manage`, `exam.candidate.manage`, `exam.eligibility.evaluate`, `exam.eligibility.override` (**sensible**), `exam.score.enter`, `exam.mock.manage`, `exam.import.manage`, `exam.result.enter`, `exam.result.publish` (**sensible**), `exam.result.release` (**sensible**), `exam.result.revise` (**sensible**), `exam.statistics.read`, `exam.export.manage|run`, `exam.document.issue`, `exam.document.self.read`, `exam.document.child.read`. Features : `examinations.core`, `examinations.mock`, `examinations.exports`. Modèles de rôles : `responsable_examens` ; `directeur` (tout) ; `parent` (`*.child.read`). Le calcul d'un examen blanc exige `exam.mock.manage` ; l'approbation d'une révision exige un utilisateur **différent** du demandeur (contrainte SQL).

## 12. Événements (outbox, `{ v: 1, … }`, **sans note ni identité**)

| Événement | Producteur | Consommateurs |
|---|---|---|
| `examinations.session.opened` / `.registration_closed` / `.results_published` / `.archived` | session | 016, 025 |
| `examinations.candidate.registered` / `.withdrawn` | candidat | 016, 025 |
| `examinations.eligibility.evaluated` (`result`, `reasonCodes`) | éligibilité | 016 |
| `examinations.result.published` (candidat, issue — **sans note ni moyenne**) | publication | 006/007 (admission en 6e), 013, 016, 025 |
| `examinations.result.revised` | révision | audit, 016 |
| `examinations.import.applied` | import | audit |
| `examinations.document.issued` / `.revoked` | documents | 016 |
| `examinations.export.completed` | export | audit |

**Consommés** : `tenancy.institution.created` (types fictifs du pack, formats), `academic.enrollment.*` (retrait automatique d'un candidat dont l'inscription est retirée, avec motif), `assess.grade.published` (notes d'examens blancs liés), `reportcards.official_document.rendered` (renseigne `official_document_id`), `people.student.status_changed`. Consommateurs idempotents par `event.id`.

## 13. Ports consommés

| Port | Fourni par | Repli |
|---|---|---|
| `EligibilityFacts` (appartenance à la classe d'examen, âge, tentatives) | academic + people | **échec fermé** : pas d'évaluation sans faits |
| `RulesPort` (`exam-national@1`) | rules | pas de calcul d'examen blanc ni d'éligibilité automatique ; saisie manuelle de l'éligibilité avec auteur |
| `AssessPort` (notes publiées liées) | assess | examen blanc : saisie manuelle des notes |
| `DocumentStore` | documents (024) ; repli `StoragePort` | refus des dépôts |
| `OfficialDocumentPort` (`requestOfficialDocument`) | reportcards (013) | documents indisponibles |
| `StoragePort` (fichiers d'import et d'export) | plateforme | refus |

## 14. Tests

- **DDL** (livrés) : 195 tests de comportement (§18) dont **concurrence réelle** (4 sessions : 20 numéros de candidat sans trou ni doublon).
- **Unitaires** : formatage de numéro (`format_number`), validation de colonnes d'export (liste blanche), transformations, schémas Zod, calcul d'avancement.
- **Golden de mécanisme** : `golden-exam-mechanism` G1–G14 (`rule-contract.md` §5).
- **Intégration** : parcours CEPE complet sur modules réels (éligibilité par règle, pièces, inscription, numéro, centres, convocation, examen blanc, import officiel, publication, révisions, attestation, statistiques, export) ; refus de calculer un résultat officiel ; refus d'importer un résultat d'examen blanc ; isolation A/B de chaque table ; reprise après échec d'import (aucune application partielle).
- **Sécurité** : parent ne lit que les documents de ses enfants liés ; aucune note ni identité dans événements/audit/logs ; un format ne peut citer un champ hors liste blanche ; approbateur ≠ demandeur.
- **E2E** (Playwright) : « de la classe de CM2 à l'attestation et à l'export », données fictives.

## 15. Cas limites

- **Candidat libre** (non inscrit dans l'établissement) : géré (décision Q-E15). Il n'a **pas de dossier élève** : identité saisie ou importée, profil restreint à part, faits d'éligibilité saisis, pièces « vues sur place », aucun accès famille, anonymisation sur demande ; uniquement en session **officielle**.
- **Élève redoublant de CM2** : deux sessions successives, deux candidats ; `nombre_tentatives` (règle) lit les candidatures antérieures.
- **Retrait d'une inscription** (élève quitte l'établissement) avant l'examen : candidat retiré avec motif, numéro conservé.
- **Épreuve facultative / options** : épreuve `is_optional` ; règle d'agrégation fournie ; question Q-E05.
- **Deux sessions pour un même type et une même année** (normale et de rattrapage) : `attempt_kind` ; codes distincts.
- **Fichier de résultats incomplet ou en double** : lot refusé (erreur ligne à ligne) ; même fichier rejoué : refusé (empreinte).
- **Correction d'un résultat déjà transmis** : révision approuvée, nouvelle version du document (ancien révoqué avec motif).
- **Examen blanc sans notes publiées** : `moyenne_candidat = null` → `ABSENT` par la règle fictive (jamais 0).
- **Série du candidat différente de l'épreuve** : note refusée (`paper_not_for_track`).
- **Centre d'accueil sans salle active** : place refusée (`room_inactive`).
- **Publication partielle** : impossible (`results_incomplete`) ; un candidat sans résultat se traite (absent, différé) avant.
- **Élève passé au statut « retiré »** après le résultat : le résultat reste ; l'attestation reste valide.
- **Changement de type de règle en cours de session** : la version de règle est **épinglée** à la session (`rule_version_ref`) ; un changement exige une nouvelle session.

## 16. Dépendances et demandes de changement

**En amont** : 000–004, 008, 011, 013 ; 012 (contrat) ; 005 (classe de CM2), 006 (BEPC/BAC).
**En aval** : 006/007 (admission en 6e), 025 (statistiques de direction), 020 (BTS).

| Spec | Demande (additive) |
|---|---|
| 012 | Contrat `exam-national@1` (voir `rule-contract.md`) ; `placeholder` dans `source_kind` ; seed `CI-EXAM-PLACEHOLDER` ; refus de liaison d'un fictif en production sans accusé |
| 013 | Natures de document officiel `EXAM_CONVOCATION`, `EXAM_SUCCESS_CERTIFICATE`, `EXAM_TRANSCRIPT` ; gabarits génériques ; résolveur de statut de vérification publique |
| 004 | Faits d'éligibilité : `getEligibilityFacts(enrollmentId)` (niveau, redoublements) ; niveau d'examen d'un type (`terminal_exam_required` informatif, jamais décisionnel) |
| 008 | Âge à une date de référence ; identifiant national facultatif |
| 011 | `assess.listPublishedGrades` par évaluation (déjà prévu) pour l'import d'examen blanc |
| 003 | Section de modèle de pack `examinations` (types, épreuves fictives, formats fictifs) |
| 017 | Occurrences `kind = EXAM` rattachables à une session d'examen (facultatif) |
| 031 | Importeur « résultats d'examen » (analyse de fichier → lot) |
| `module-conventions.md` | Plage `2000–2099` pour `examinations` |

## 17. Critères de sortie (mesurables)

La spec est terminée lorsque :

1. Les migrations `2000`–`2004` s'appliquent sur base vide, les **195** tests de comportement passent (166 initiaux + 29 de `ddl/tests/40_corrections_imports.sql`, voir §18), l'allowlist d'isolation du module est **vide** et le test d'isolation générique passe avec deux tenants.
2. Le parcours E2E CEPE fictif (classe de CM2 → attestation → export) passe sans intervention manuelle hors décisions.
3. 20 inscriptions concurrentes donnent 20 numéros distincts sans trou ; aucun résultat officiel n'est jamais calculé ; aucune note ni identité dans événements, audit, logs.
4. Aucune épreuve, coefficient, seuil, condition d'éligibilité ou taux dans le code du module (lint R2 vert).
5. Les demandes de changement du §16 sont acceptées ou refusées par écrit ; `regulatory-sources-needed.md` et Q-E01 à Q-E18 sont transmis au propriétaire du produit ; **aucun RuleSet officiel d'examen n'est publié** tant que les textes manquent.

## 18. Précisions et corrections issues de l'implémentation (V1)

Écarts constatés entre cette spec et le module livré (`apps/api/src/modules/examinations`, écrans `apps/web/src/app/v2/examinations`) ; le code et ce paragraphe font foi.

**Données (migrations `2003` et `2004`, ajoutées à `2000`–`2002`)**
- `2003_examinations_corrections.sql` : table `revision_requests` (demande de correction d'une note ou d'un résultat arrêté : valeur actuelle, valeur proposée, motif, demandeur ; décision, approbateur, note) ; l'approbation par la même personne que le demandeur est refusée **par la base** (`revision_same_person`) ; la valeur n'est modifiable que dans la transaction qui approuve une demande (garde `candidate_results_guard` remplacée) ; la liste blanche des colonnes d'export accepte les champs `stat.*` (statistiques).
- `2004_examinations_import_formats.sql` : table `import_formats` (formats de fichiers d'autorité = DONNÉES : encodage, séparateurs, colonnes, table de valeurs) avec la même discipline que les formats d'export (liste blanche des cibles d'import identique en SQL et en TypeScript, format publié immuable).
- Tests DDL : 195 (`ddl/tests/40_corrections_imports.sql` : 29 tests).

**Permissions** : au-delà du §11, le module déclare les lectures `exam.candidate.read` et `exam.result.read`, ce qui permet un rôle de consultation sans droit de gestion. La publication d'un résultat exige `exam.result.publish`, l'application d'un import `exam.result.release`, l'approbation ou le rejet d'une correction `exam.result.revise` ; la demande de correction est ouverte à `exam.result.enter` ou `exam.result.revise`.

**Documents** : natures `CONVOCATION`, `ATTESTATION_REUSSITE`, `RELEVE_NOTES` (portées par les natures officielles `EXAM_CONVOCATION`, `EXAM_SUCCESS_CERTIFICATE`, `EXAM_TRANSCRIPT` de `reportcards`). Un examen blanc **ne donne lieu à aucun document officiel** (`mock_no_official_document`). L'attestation exige une issue « admis » publiée ; la convocation exige une place attribuée.

**Routes de lecture familiale** : `GET /me/exams`, `GET /family/exams`, `GET /family/exam-documents/:id/file` remplacent `GET /children/:studentId/exam-documents` : la liaison parent-élève est revérifiée à chaque appel et la réponse ne porte **jamais** de note ni de moyenne, seulement l'issue une fois publiée.

**Examens blancs** : la moyenne et l'issue sont calculées par la règle épinglée, avec trace de la version de règle et empreinte des données d'entrée ; l'import de notes depuis `assess` ne reprend que des évaluations de type `EXAMEN_BLANC` d'une classe liée à l'épreuve, de même barème.

**Écrans (`/v2/examinations/*`)** : sessions et détail, types (chargement du pack fictif), centres et salles, candidats et dossier, répartition, examens blancs, notes et résultats, imports, corrections (quatre yeux), statistiques, exports et documents, vue famille. Détails et permissions : `apps/web/docs/v2-examinations.md`.

**Non livré en V1** : jeu de démonstration (session blanche et session officielle de 40 candidats) qui dépend du seed v2 des autres modules ; création et édition d'un format d'export ou d'import depuis l'écran (disponibles par l'API) ; plan de répartition par glisser-déposer (remplacé par une répartition automatique suivie d'un changement de salle). Les interfaces attendues des autres modules (`exam-national@1`, `getEligibilityFacts`, natures de `reportcards`) sont décrites dans le `README.md` du module ; tant qu'elles manquent, les adaptateurs échouent fermé avec `examinations.port_unavailable`.
