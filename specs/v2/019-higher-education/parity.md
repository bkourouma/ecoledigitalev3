# Parité legacy — 019-higher-education

**Périmètre** : le module Professionnel (UE/ECUE) pour ce qui concerne la capitalisation de crédits, les prérequis, le rattrapage, la diplomation, les attestations et les signataires. Le calcul des notes est dans `011/012` ; le rendu et l'authenticité dans `013`.

Statuts : **Conservé**, **Amélioré**, **Abandonné**, **Reporté**. Lignes : état au 2026-10-01 (`feat/v2-phase-0`).

Tables legacy remplacées : `professional_diplomas`, `professional_diploma_requirements`, `student_professional_diplomas`, `student_professional_ue_results`, `professional_ue_prerequisites`, `professional_signataires`. Fichiers supprimés : `professional-diplomas.service.ts`, `professional-attestations.service.ts`, `professional-signataires.service.ts`, `professional-cycle-groups.ts`, la partie rattrapage/UV de `professional-results.service.ts`, les générateurs jsPDF `diplome-pdf.ts`, `attestation-pdf.ts`, `attestation-authenticite-pdf.ts`, `diplome-format.ts`.

## 1. Diplômes — `professional-diplomas.service.ts`

| ID | Fonction (ligne) | Comportement | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| P-HIG-01 | `evaluateDiplomaEligibility` (`:64-109`) | Dédoublonne par UE (obligatoire prioritaire) ; `uv_validees` = Σ nb_uv des UE exigées validées ; éligible si obligatoires validées ET `uv_validees ≥ uv_required` | **Conservé** | Règle `diplome_eligible` (012) + dédoublonnage dans le constructeur de contexte | Table de vérité de parité (≥ 30 cas). |
| P-HIG-02 | `computeDiplomaProgress` (`:131-166`) | UE validées / restantes / obligatoires manquantes, % plafonné à 100 | **Conservé** | Calcul à la demande depuis le registre (US4) | |
| P-HIG-03 | `list` / `getById` / `create` (`:210`, `:240`, `:260`) ; code unique par tenant (`DUPLICATE_DIPLOMA_CODE`) ; `uv_required > 0` | CRUD des définitions rattachées à **une filière** (`filiere_id`) | **Amélioré** | `diploma_definitions` rattachées à un **nœud de cycle** | La filière terminale ne représentait pas le cycle. |
| P-HIG-04 | `listCycleGroups` (`:307`) + `buildCycleGroups` (`professional-cycle-groups.ts:42-81`) ; `GRADE_RE = /^\s*(LICENCE|MASTER)\s+(\d+)\s+(.+?)\s*$/i` (`:29`) | **Cycles reconstitués d'après le NOM** des filières (« LICENCE 1 GENIE LOGICIEL » …) ; spécialité comparée en majuscules | **Abandonné** | Nœud « cycle » explicite du curriculum (004), `grade_code` en donnée | Une filière renommée disparaît de son cycle ; deux spécialités homonymes se confondent. |
| P-HIG-05 | `ensureCycleDiploma` (`:321-391`) : crée `DIP-<code sans chiffres>`, `uv_required` = Σ UV des UE du cycle, remplace **toutes** les exigences (`DELETE` + `INSERT`, `est_obligatoire = true`) | Synchronisation destructive | **Amélioré** | `POST /diplomas/from-curriculum` + `sync` : conserve les surcharges `mandatory`, signale ajouts/retraits | Plus d'effacement des choix de la direction. |
| P-HIG-06 | `update` (`:393`) : libellé, description, `uv_required`, statut | Modification libre | **Conservé** | `PATCH /diplomas/:id` | |
| P-HIG-07 | `delete` (`:426`) : refusé s'il existe un octroi non révoqué (`DIPLOMA_HAS_AWARDS`) | Suppression contrôlée | **Conservé** | Déclencheur `diploma_definitions_no_delete` + application | |
| P-HIG-08 | `getRequirements` / `replaceRequirements` (`:455`, `:467`) | Exigences (UE, obligatoire, ordre) | **Conservé** | `diploma_requirements` | Contrôle « UE du même programme » (`CROSS_PROGRAMME_REQUIREMENT`) conservé. |
| P-HIG-09 | `awardManual` (`:680-747`) : refuse un doublon (`DIPLOMA_ALREADY_AWARDED`) et un étudiant révoqué (`DIPLOMA_REVOKED`) ; non éligible ⇒ `DIPLOMA_NOT_ELIGIBLE` sauf `force` | Octroi manuel et **forcé sans motif** | **Amélioré** | Octroi manuel / forcé (permission sensible, **motif ≥ 20 caractères**, MFA) | Un octroi forcé non motivé n'est pas défendable. |
| P-HIG-10 | `revoke` (`:749-773`) : motif obligatoire, statut `revoque` terminal | Révocation | **Conservé** | `POST /awards/:id/revoke` | Q-22 : la doc du besoin (029) disait « ré-octroi possible », le code l'interdit. |
| P-HIG-11 | `listCandidates` (`:781-867`) ; `listAwarded` (`:869-900`) | Étudiants du cycle (via `resolveCycleGroupFor`) avec progression et état d'octroi | **Conservé** | `GET /diplomas/:id/candidates`, `/awarded` | |
| P-HIG-12 | `recomputeForStudent` (`:906-935`) : à chaque UE validée, réévalue les diplômes **actifs** exigeant cette UE ; `tryAwardEligible` (`:1137-1176`) | Octroi automatique (hook) | **Conservé** | Abonné `higher.credits.capitalized` (isolé de la capitalisation) | Règle 12 : la défaillance du hook ne bloque jamais l'achèvement. |
| P-HIG-13 | `recomputeAllForDiploma` (`:938-974`) | Recalcul de masse d'une définition | **Conservé** | `POST /diplomas/:id/recompute` | |
| P-HIG-14 | `buildSnapshot` (`:1022-1040`) : `requirements_snapshot` JSONB (UE, crédits, obligatoire, ordre, validée) | Snapshot des exigences à l'octroi | **Conservé** | `requirements_snapshot` + sorties de règles + version de règle | |
| P-HIG-15 | `generateReference` (`:1042-1051`) : `DIP-{année}-{count(*) + 1}` sur 6 chiffres, retry (jusqu'à 5) sur collision | Numérotation par **comptage de lignes** | **Amélioré** | Compteur transactionnel (`number_counters`) | Un `count(*)` n'est ni sans trou ni sans doublon sous concurrence (suppressions, révocations). |
| P-HIG-16 | `getOrAssignAuthenticiteReference` (`:1065-1103`) : `AUTH/{année}/{NNN}`, `NNN = nb d'octrois « obtenu » + nb d'attestations déjà numérotées cette année + 1`, 5 tentatives | Numéro d'authenticité attribué une fois, **calculé** en comptant | **Amélioré** | Compteur dédié ; idempotence par index unique (un document vivant par octroi) | Formule fragile (mélange octrois et numérotés). Format conservé (Q-24). |
| P-HIG-17 | `createAward` (`:1105-1135`) | Insertion d'octroi, gestion de `uniq_student_prof_diploma_active` | **Conservé** | Index unique partiel `diploma_awards_active_uq` | |
| P-HIG-18 | `getAttestation` (`:570-676`) : assemble les données du diplôme ; **mention** via `loadMentionForFilieres` ; **année académique = dernière cohorte** ; **signataires** lus en base | Données du diplôme à imprimer | **Conservé** (fond) / **Amélioré** | Snapshot immuable du document ; mention et année figées à l'émission | |
| P-HIG-19 | `getStudentProfileId`, `listStudentDiplomas`, `listChildDiplomas`, `isParentOfChild`, `loadStudentDiplomaSummaries` (`:518`, `:547`, `:556`, `:1239`, `:1257`) | Lecture étudiant / parent | **Conservé** | `GET /me/diplomas`, `/children/:id/diplomas` + `GuardianshipPort` | |
| P-HIG-20 | Enseignant : aucun accès aux diplômes (029) | Contrôle de rôle codé en dur dans les routes | **Amélioré** | Permissions `higher.*` non attribuées au rôle enseignant | RBAC granulaire (plan §3.6). |

## 2. Attestations de réussite — `professional-attestations.service.ts`

| ID | Fonction (ligne) | Comportement | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| P-HIG-30 | `getRoster` (`:44-115`) | Pour une filière (et un nom de classe), liste des étudiants avec UV validées/requises, éligibilité, UE manquantes, année scolaire | **Conservé** | `GET /attestations/roster` | « nom de classe » extrait d'un libellé (`split_part(s.libelle, ' — ', 1)`) remplacé par `classroom_id`. |
| P-HIG-31 | `getStudentAttestation` (`:118-210`) : refus `NO_UE_CONFIGURED` / `NOT_ELIGIBLE` ; `date_obtention` = max des `date_validation`, **à défaut début de session, à défaut `now()`** ; référence `ATT-<matricule>` | Données de l'attestation | **Amélioré** | Émission avec snapshot ; date = dernière acquisition ; référence = compteur `ATTESTATION` | Les replis (`début de session`, `now()`) fabriquaient une date d'obtention. |
| P-HIG-32 | `loadRequiredUe` (`:261-276`) : UE rattachées aux semestres de la filière ; commentaire « une filière compte 3 semestres » | Périmètre des UE | **Amélioré** | UE du nœud « programme » du curriculum (004) | Aucune hypothèse de 3 semestres. |
| P-HIG-33 | `loadAnneeScolaireParEtudiant` (`:219-246`) : année de la **dernière** session ; `anneeScolaireOf` (`professional-annee-scolaire.ts`) | Année scolaire d'après les dates | **Amélioré** | `academic_year_id` de la dernière inscription | |

## 3. Signataires — `professional-signataires.service.ts`

| ID | Fonction (ligne) | Comportement | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| P-HIG-40 | `SIGNATAIRES_DEFAULTS` (`:29-54`) : quatre emplacements (`attestation_reussite`, `diplome_gauche`, `diplome_droite`, `authenticite`) avec **noms, qualités et fonctions de personnes réelles** codés en dur | Repli si l'établissement n'a rien configuré | **Abandonné** | Aucune valeur par défaut ; émission refusée sans signataire valide | Les documents d'un autre établissement portaient la signature de personnes qui n'ont jamais vu ses étudiants (le commentaire du fichier le dit : détection côté owner). |
| P-HIG-41 | `list` (`:61`) / `upsert` (`:76`) : un enregistrement par `(tenant, clé)`, remplacement en place | Édition des signataires | **Amélioré** | Registre des signataires (013) + `official_document_slots` **datés** | Historique des signataires en vigueur ; un document ancien garde son signataire. |
| P-HIG-42 | Détection des valeurs par défaut sur l'écran « Documents officiels » (owner) | Alerte | **Abandonné** | Plus de valeur par défaut à détecter | |

## 4. Capitalisation, prérequis, rattrapage

| ID | Fonction (fichier:ligne) | Comportement | Statut | Cible v2 | Justification |
|---|---|---|---|---|---|
| P-HIG-50 | `evaluateUeValidation` + `upsertUeResult` (`professional-results.service.ts:337`, `:382`) ; `student_professional_ue_results` `UNIQUE (tenant, ue, student)` | Statut `validee/echec/en_cours` et `uv_acquises` ; **écrase** à chaque recalcul ; `date_validation` conservée tant que validée | **Amélioré** | `credit_ledger` (acquisitions immuables, origine, session) + résultats versionnés (011) | Sépare l'acquisition (ledger) de l'état de calcul (résultats). |
| P-HIG-51 | `loadValidatedUeIdsWithConduite`, `loadAllValidatedUeIdsWithConduite` (`professional-cycle-groups.ts:160-225`) : UE « Conduite » validée si note d'examen d'une ECUE repérée par le libellé ≥ 10 | Cas particulier de la conduite hors `student_professional_ue_results` | **Abandonné** | La conduite est une UE ordinaire (`grading_mode = DIRECT`) qui capitalise comme les autres | Plus de second chemin de validation. |
| P-HIG-52 | `loadMentionForFilieres` (`:227-253`) : lit les `data` JSON des bulletins ; pondération par crédits ; seuils 10/12/14/16/18 | Mention de diplôme/attestation | **Amélioré** | Règles `moyenne_annuelle` + `mention_diplome` sur les résultats `FINAL` | Source = résultats, plus le JSON ; seuils = données. |
| P-HIG-53 | `professional_ue_prerequisites` ; `wouldCreateUePrerequisiteCycle` (`professional-ue.service.ts:161-187`) ; `loadUePrerequisites` (`:504`) ; `setUePrerequisites` (`:531-580`) | Graphe de prérequis entre UE, détection de cycle (DFS), remplacement de la liste | **Conservé** | `ue_prerequisites` + déclencheur anti-cycle + `checkPrerequisites` | Défense en profondeur côté base. |
| P-HIG-54 | Rattrapage : `RATTRAPAGE_PREDICATE` (`professional-results.service.ts:57-64`), `listSemestreRattrapages` (`:1101`), `rattrapageRowsForStudent` (`:1305`) | Liste des ECUE à repasser ; états `a_repasser/non_validee/validee` | **Conservé** | Fenêtres + inscriptions de rattrapage ; candidats par règle `eligible_rattrapage` | |
| P-HIG-55 | Session 2 : `professional_ecue_notes.session` (migration `0083`) ; `COALESCE(session, 1)` ; « la note de session 2 remplace celle de session 1 » | Session = entier implicite | **Amélioré** | `assess.assessments.session_no` + règle `note_examen_retenue` (Q-02) | Inventaire : « la notion de session doit être un champ du modèle ». |
| P-HIG-56 | `etat` UE `validee/rattrapage/dette` et `statut_etudiant` (`professional-bulletin.service.ts:1717-1722`, `:1812-1824`) | État LMD | **Conservé** | Règle `etat_ue`, `decision_semestre` | |
| P-HIG-57 | Dette : commentaire « dette (à trancher au niveau ANNÉE selon les crédits) » (`:1814-1817`) — **jamais implémenté** | Décision d'année absente | **Reporté** (Q-01) | `listDebts` + règle optionnelle `annee_validee_par_credits` | Le legacy laissait la dette sans suite. |

## 5. Module « à la carte » (028) — hors périmètre de 019

| ID | Élément legacy | Cible |
|---|---|---|
| P-HIG-60 | `professional_subjects`, `professional_subject_prerequisites`, `professional_subject_sessions` (catalogue à la carte, matière + UV + prix) | Curriculum (004) + frais (014) ; prérequis → `higher.ue_prerequisites` |
| P-HIG-61 | `professional_orders`, `professional_enrollments`, `professional_payments`, panier, reçus `REC-PRO-…` | 014/015 (finance) ; inscriptions → 004 |
| P-HIG-62 | Présences et supports de session | 010 / 022 |
| P-HIG-63 | `professional-inscription-gate.ts` : inscription « confirmée » seulement si les frais d'inscription du lot sont soldés ; toute la scolarité l'ignore tant que non confirmée | Politique d'accès (004/014) ; événement `finance.invoice.paid` → statut d'inscription |

## 6. Défauts du legacy volontairement NON reproduits

1. Cycles, grades, niveaux et spécialités déduits de **noms** de filières par expression régulière.
2. **Signataires par défaut = personnes réelles** inscrites dans le code.
3. Numérotation par `count(*)` (diplômes, authenticité).
4. Octroi **forcé sans motif**.
5. Synchronisation des exigences destructive (`DELETE` + `INSERT`) qui écrase les choix.
6. Dates d'obtention fabriquées (début de session, `now()`).
7. Mention lue dans le JSON des bulletins.
8. Deux chemins de validation d'UE (résultats / « Conduite » par libellé).
9. Rattrapage et session sans champ de modèle.
10. Hypothèses structurelles dans les commentaires (« une filière compte 3 semestres »).
