# Feature Specification: Enseignement supérieur — crédits, rattrapage, diplômes et attestations (019-higher-education)

**Feature Branch**: `019-higher-education`

**Created**: 2026-10-01

**Status**: Rédigée — **backend implémenté** (module `higher`, migrations 1400-1409, voir `apps/api/src/modules/higher/README.md`) ; à relire avec le propriétaire du produit (questions : `../012-rules-engine/open-questions.md` §B, Q-01 à Q-05, Q-21, Q-22, Q-24, Q-25, Q-26)

> **Corrections de la spec à l'implémentation (2026-10-01)** — décisions métier validées (`../DECISIONS-METIER.md`) appliquées : la session 2 **remplace** la session 1 (aucune logique de note dans `higher`), un semestre est validé si **toutes** les UE le sont (les règles « 20 crédits » / « > 48 crédits » ne sont pas reprises). Incohérences levées :
> - **Données** : voir l'encadré en tête de `data-model.md` (table de dettes `ue_debts`, durée de validité des crédits et statut `EXPIRED`, unicité des inscriptions de rattrapage par période, octroi forcé sans acquisition, scellement postérieur des documents, duplicata `/Dn`, `reaward_decision`).
> - **§9 Permissions** : ajout de `higher.self.read` (étudiant), `higher.child.read` (parent) et `higher.settings.manage` (durée de validité des crédits). `higher.award.create` et `higher.document.issue` sont sensibles ; `higher.award.revoke` est sensible et sert aussi à révoquer un document (attestation de réussite sans octroi) ; le **ré-octroi** exige `higher.award.force` + une décision écrite référencée (Q-22).
> - **§10 Événements** : ajout de `higher.credits.expired` et `higher.credits.revocation_blocked` (AC1.4 : « signalé à la direction »). Consommés réellement : `results.period.closed` (capitalisation, dettes, issue des rattrapages) et `higher.credits.capitalized` (éligibilité, abonné distinct). `results.period.reopened` n'a pas d'effet propre : la **reclôture** (version n+1) traite révocation et recapitalisation ; les compteurs sont créés à la demande (`tenancy.tenant.provisioned` inutile) ; `results.decision.confirmed` et `reportcards.report_card.rendered` ne sont pas consommés (le rendu écrit lui-même le scellement par l'API publique `recordDocumentSeal` / `recordDocumentRender`).
> - **§7 Endpoints** : ajouts `DELETE /diplomas/:id`, `GET /diplomas/:id/students/:studentId/progress`, `GET /awards/:id`, `POST /documents/:id/publish|revoke`, `GET /documents`, `GET /students/:id/pathway`, `GET /me/pathway|documents`, `GET /children/:studentId/pathway|documents`, `GET|PUT /settings` ; l'émission d'un duplicata passe par `POST /awards/:id/documents { duplicate: true }`.
> - **AC6.2** : la mention `PENDING` fait attendre l'octroi **automatique** ; un octroi manuel ou forcé s'enregistre avec la mention `PENDING`.
> - **AC4.5 / §12** : une exigence retirée du curriculum n'est plus exigée de qui ne l'a pas acquise, mais compte pour qui l'a acquise.

**Sources**: `docs/PRD_EcoleDigitale_SaaS.md` §22, §23, §24 ; `docs/PLAN_Mise_en_oeuvre_EcoleDigitale_SaaS.md` §3.7, §3.8, §4 (tranches 2.5 et 2.6), §5 ; `docs/module-professionnel-overview.md`, `module-professionnel-requirements.md`, `module-professionnel-diplomes-requirements.md` ; `docs/inventory/legacy-dependents-by-slice.md` ; ADR-002/003/004/006/007 ; legacy : `apps/api/src/services/professional-diplomas.service.ts`, `professional-attestations.service.ts`, `professional-signataires.service.ts`, `professional-cycle-groups.ts`, `professional-results.service.ts` (UE, rattrapage), `professional-ue.service.ts` (prérequis), migrations `0064`, `0083`, `0087`, `0089`. Gabarit : `specs/v2/000-platform-foundation/spec.md`.

> **Parité** avec le module Professionnel actuel (crédits UE/ECUE, validation, compensation, session 2, dettes, diplômes, attestations de réussite et d'authenticité, signataires) **sur le nouveau cœur académique**. Le calcul (notes → UE → semestre) est celui de 011/012 ; cette spec porte ce qui est propre au supérieur : **capitalisation**, **prérequis**, **rattrapage**, **diplomation**, **documents officiels**.
> Références du cœur par **UUID sans clé étrangère** : `academic.curriculum_nodes.id`, `academic.enrollments.id`, `academic.academic_periods.id`, `academic.academic_years.id`, `academic.classrooms.id`, `people.students.id`, `people.staff.id`.

## 1. Objectifs

1. **Capitaliser** : tenir un registre exact des crédits (UV) acquis par étudiant et par UE, alimenté automatiquement par les résultats `FINAL` (011), sans doublon ni perte, avec son origine (direct, rattrapage, jury).
2. **Appliquer les prérequis entre UE** et fournir à l'inscription (004) la vérification « cet étudiant peut-il s'inscrire à cette UE ? ».
3. **Organiser le rattrapage (session 2)** : fenêtre, candidats déterminés par la règle `eligible_rattrapage`, notes de session 2 saisies dans le circuit ordinaire (011), nouvelle décision.
4. **Diplômer** : définitions de diplômes rattachées à un cycle du curriculum (plus de reconstitution par le nom), éligibilité par la règle `diplome_eligible`, octroi automatique/manuel/forcé, révocation, références **sans trou ni doublon**.
5. **Délivrer les documents officiels** : diplôme, attestation de réussite, attestation d'authenticité, avec signataires datés, snapshot immuable, signature et QR (rendu via 013).
6. **Supprimer** les défauts du module actuel : cycles reconstitués par expression régulière sur le nom des filières, signataires par défaut portant des noms de personnes réelles, numérotation par comptage de lignes, octroi forcé sans motif.

## 2. Périmètre

### Inclus

- Module backend `higher` (schéma `higher`, pack `HIGHER`) : définitions de diplômes et exigences, registre de crédits (capitalisation), prérequis entre UE, fenêtres et inscriptions de rattrapage, octrois, révocations, documents officiels (snapshots), compteurs de numérotation, affectation des emplacements de signature.
- Cas d'usage déclenchés par événements : capitalisation (`results.period.closed`), détection de dette, évaluation d'éligibilité aux diplômes.
- API pour les écrans administration, étudiant et parent ; API publique du module (`higher/index.ts`) : `checkPrerequisites`, `getCreditSummary`, `listDebts`.
- Parité fonctionnelle complète avec `professional_diplomas`, `professional_diploma_requirements`, `student_professional_diplomas`, `student_professional_ue_results`, `professional_ue_prerequisites`, `professional_signataires`, attestations et authenticité.

### Exclu (renvoyé)

| Sujet | Spec |
|---|---|
| Calcul des moyennes d'ECUE, d'UE, de semestre ; crédits d'UE ; compensation interne à l'UE ; décisions de semestre | 011 / 012 (contrat `credit-semester@1`) |
| Structure du curriculum (programme → diplôme → niveau → semestre → UE → ECUE), inscriptions, classes, catalogue/panier/commande à la carte | 004, 014 |
| Rendu PDF, signature et vérification publique des documents | 013 (port `DocumentRenderer`) |
| Stages, rapports, soutenances, jury de BTS | 020, 021 (après V1) |
| Équivalences, dispenses, transferts de crédits entre établissements | non couvert par le legacy ; extension future (`acquired_via` prévu) |
| Frais de rattrapage, facturation des UE | 014 (événements `higher.resit.registered`) |
| Relevé cumulé (`TRANSCRIPT`) | 013 (lit le registre de crédits via l'API publique) |

## 3. Acteurs

| Acteur | Rôle |
|---|---|
| Directeur des études / responsable pédagogique | Définit les diplômes, exigences, prérequis, fenêtres de rattrapage ; octroie, révoque ; signe via les emplacements |
| Secrétariat / scolarité | Consulte progressions et candidats, imprime les documents, gère les demandes d'attestation |
| Enseignant | Saisit les notes de session 2 (circuit 011) |
| Étudiant | Consulte crédits, dettes, rattrapages, diplômes, progression ; télécharge ses documents publiés |
| Parent / tuteur | Lecture seule des diplômes et de la progression de l'enfant |
| Employeur / tiers | Vérifie un document par QR (013) |
| Worker | Capitalisation, évaluations d'éligibilité, numérotation, génération de documents |

## 4. User Stories et critères d'acceptation

### US1 — Capitaliser automatiquement les crédits (P1)

À la clôture d'une période, chaque UE validée par un étudiant est inscrite à son registre de crédits.

- **AC1.1** Sur `results.period.closed`, le registre reçoit une écriture `ACQUIRED` pour chaque ligne UE `validated = true` de résultats `FINAL`, avec : étudiant, UE, année, crédits **tels que figés au résultat**, moyenne exacte, session d'obtention (1 ou 2), origine (`DIRECT`, `RESIT`, `JURY_OVERRIDE`), référence du résultat, date.
- **AC1.2** Idempotence : rejouer l'événement n'ajoute aucune écriture ; **une seule** écriture `ACQUIRED` par `(étudiant, UE)` (contrainte d'unicité partielle) — une UE déjà acquise n'est jamais recapitalisée ni écrasée.
- **AC1.3** Délai : pour une classe de 100 étudiants, 100 % des écritures sont créées en ≤ **30 s p95** après l'événement.
- **AC1.4** Une UE rendue non validée par une réouverture et reclôture (résultats `n+1`) **révoque** l'écriture issue de la version précédente (`REVOKED`, motif « résultat remplacé », référence de la version) **si** aucun diplôme octroyé ne s'appuie sur elle ; sinon l'opération est bloquée et signalée à la direction (la révocation du diplôme doit précéder).
- **AC1.5** Les crédits d'une écriture ne changent jamais si les crédits de l'UE sont modifiés ensuite dans le curriculum.
- **AC1.6** Les UE sans crédits (crédits = 0, ex. conduite sans crédit) peuvent figurer au registre avec `credits = 0` ; elles comptent comme validées pour les exigences obligatoires mais n'ajoutent rien au total.

### US2 — Prérequis entre UE (P1)

- **AC2.1** La direction définit les prérequis d'une UE (0..n UE de la même filière/programme) ; sont refusés : un prérequis sur elle-même, vers un programme différent, un **cycle** (détection en transaction et par vérification en base) — messages `higher.prerequisite_self`, `.cross_program`, `.cycle`.
- **AC2.2** `checkPrerequisites(studentId, ueNodeId)` renvoie `{ satisfied, missing[] }` : un prérequis est satisfait si une écriture `ACQUIRED` existe pour l'UE prérequise (mode par défaut `VALIDATED`, Q-26) ; appel utilisé par 004 à l'inscription et par le parcours à la carte.
- **AC2.3** Les prérequis sont vérifiés **côté serveur** à chaque inscription ; l'interface ne fait que les afficher (une UE verrouillée affiche les prérequis manquants).
- **AC2.4** Modifier les prérequis n'affecte pas les inscriptions existantes ; un avertissement liste les inscrits qui ne les satisferaient plus.

### US3 — Organiser le rattrapage (session 2) (P1)

- **AC3.1** Les candidats d'une classe × période sont les lignes d'ECUE `resit_eligible = true` des résultats `FINAL` (règle `eligible_rattrapage` : non validée, notée, nœud rattrapable, session 2 non tentée) ; la liste est fournie par l'API publique de `results`, jamais recalculée ici.
- **AC3.2** Ouvrir une fenêtre de rattrapage (période, dates, ECUE concernées) : crée une inscription de rattrapage par candidat, autorise la création d'évaluations `session_no = 2` pour ces ECUE, et **déverrouille uniquement la session 2** de la période (`assess.period_locks.locked_sessions = {1}`) ; les notes de session 1 restent verrouillées.
- **AC3.3** Les notes de session 2 suivent le circuit ordinaire de 011 (soumission, relecture, approbation, publication) ; la note retenue pour l'examen est choisie par la règle `note_examen_retenue` (Q-02).
- **AC3.4** Après la fenêtre, la reclôture de la période produit des résultats `FINAL` en version supérieure ; les UE validées en session 2 sont capitalisées avec `session_obtained = 2` ; les UE encore non validées passent à l'état `DEBT` (règle `etat_ue`).
- **AC3.5** L'étudiant et le tuteur voient les ECUE à repasser, la date de la fenêtre, leur note de session 2 et l'issue (`a_repasser`, `non_validee`, `validee`).
- **AC3.6** Un étudiant ne peut pas être inscrit deux fois au rattrapage de la même ECUE et de la même période ; une ECUE `resit_allowed = false` n'est jamais proposée.

### US4 — Définir et suivre les diplômes (P1)

- **AC4.1** Une définition de diplôme est rattachée à un **nœud de cycle** du curriculum (ex. « Licence — Génie logiciel », qui couvre les niveaux 1 à 3) ; plus aucune reconstitution par expression régulière sur le nom du programme.
- **AC4.2** `POST /diplomas/from-curriculum` crée la définition et **synchronise** ses exigences depuis les UE du cycle (toutes obligatoires par défaut), avec le total de crédits requis ; rejouer la synchronisation conserve les surcharges manuelles (`mandatory`) et signale les UE ajoutées/retirées.
- **AC4.3** `uv_required` est une donnée > 0 de la définition ; le code de la définition est unique par établissement ; une définition ne peut être supprimée s'il existe un octroi non révoqué (désactivation sinon).
- **AC4.4** La progression d'un étudiant (UE validées, UV cumulées, % d'avancement plafonné à 100, UE obligatoires manquantes) est calculée à la demande à partir du registre de crédits ; aucune ligne d'octroi n'existe tant que le diplôme n'est pas obtenu.
- **AC4.5** L'éligibilité est évaluée par la **règle `diplome_eligible`** : toutes les exigences obligatoires validées **et** Σ crédits des exigences validées ≥ `uv_requises` ; chaque UE est comptée une fois.

### US5 — Octroyer, forcer, révoquer (P1)

- **AC5.1** Octroi **automatique** : sur `higher.credits.capitalized`, les définitions actives et exigeant cette UE sont évaluées ; un étudiant éligible reçoit un octroi `OBTAINED` (référence `DIP-AAAA-NNNNNN` sans trou ni doublon) si aucun octroi non révoqué n'existe.
- **AC5.2** L'évaluation d'éligibilité s'exécute dans un **abonné distinct** (transaction propre) : sa défaillance ne bloque ni n'annule jamais la capitalisation (règle 12 du besoin 029) ; elle est rejouée (retry/DLQ).
- **AC5.3** Octroi **manuel** : possible si l'étudiant est éligible ; **forcé** (non éligible) : permission sensible `higher.award.force`, motif obligatoire (≥ 20 caractères), mention « octroi forcé » conservée sur l'octroi et affichée à la vérification interne ; audité.
- **AC5.4** L'octroi fige un **snapshot** des exigences (UE, crédits, obligatoire, validée), les sorties de règles (éligibilité, moyenne de cycle, mention) et la version de règle ; modifier ensuite la définition ou le curriculum ne modifie pas les octrois existants.
- **AC5.5** **Révocation** : permission sensible, motif obligatoire (≥ 10 caractères) ; l'octroi passe `REVOKED` ; ses documents passent `REVOKED` (vérification publique « révoqué ») ; le ré-octroi est régi par Q-22 (par défaut : interdit sauf décision écrite du directeur général, avec référence à la révocation).
- **AC5.6** Une définition `INACTIVE` n'octroie plus automatiquement ; les octrois existants restent valides.
- **AC5.7** Un étudiant ne peut jamais avoir deux octrois non révoqués pour la même définition (contrainte).
- **AC5.8** 1 000 octrois simultanés (test de charge) produisent 1 000 références distinctes et continues par année.

### US6 — Mention du diplôme (P1)

- **AC6.1** La mention est donnée par la règle `mention_diplome` appliquée à la **moyenne de cycle** (règle `moyenne_annuelle` sur les semestres `FINAL` du cycle, pondérée par les crédits de semestre) ; la valeur exacte et le code de mention sont figés dans l'octroi.
- **AC6.2** Si un semestre du cycle est sans résultat `FINAL`, la mention est `PENDING` (« en attente ») et l'octroi automatique attend ; l'octroi forcé peut se faire sans mention avec motif.

### US7 — Documents officiels (P1)

- **AC7.1** Trois natures de documents : **diplôme**, **attestation de réussite** (programme complet), **attestation d'authenticité** ; chacun est un snapshot immuable signé, avec QR de vérification, rendu par 013.
- **AC7.2** L'**attestation de réussite** est délivrable lorsque toutes les UE du programme (filière) demandé sont acquises ; elle indique la date d'obtention = date de la **dernière acquisition** (jamais « aujourd'hui » ni la date de début de session) et l'année académique de la dernière cohorte.
- **AC7.3** L'**attestation d'authenticité** porte un numéro `AUTH/AAAA/NNN` attribué **une seule fois** par octroi (régénérer le PDF renvoie le même numéro), séquentiel sans trou par établissement et par année de génération ; compteur initial 1 sur base neuve (Q-24).
- **AC7.3b (Q-24, décision du propriétaire)** Le **format** des références (diplôme, attestation d'authenticité, attestation de réussite) est un **motif libre par établissement** (préfixe, année, séquence : `DIP-{YYYY}-{SEQ:6}` par défaut) ; l'unicité est garantie par contrainte quel que soit le motif ; la garantie **« sans trou » est un réglage** (activée par défaut, donc inchangée pour les établissements qui ne touchent à rien) : désactivée, l'établissement peut avancer le compteur (reprise d'un registre papier), jamais le reculer ; les références déjà émises ne changent jamais. Voir `apps/api/src/modules/higher/README.md` § « Numérotation libre ».
- **AC7.4** Les **emplacements de signature** (`DIPLOMA_LEFT`, `DIPLOMA_RIGHT`, `ATTESTATION_SUCCESS`, `AUTHENTICITY`) sont affectés à des signataires du registre de 013 avec **dates de validité** ; le document imprimé conserve le signataire en vigueur à l'émission ; **aucune valeur par défaut** n'existe : sans signataire valide pour un emplacement obligatoire, l'émission est refusée (Q-21).
- **AC7.5** L'étudiant ne télécharge que ses documents publiés, via URL signée ; un tuteur lié les consulte en lecture seule.
- **AC7.6** Tout document reste **rejouable** : le même snapshot produit le même rendu (013).
- **AC7.7** L'émission d'un document est auditée, avec le signataire et la version de gabarit.

### US8 — Les étudiants et familles suivent leur parcours (P2)

- **AC8.1** « Mon parcours » : crédits acquis / requis par semestre, année et diplôme, UE acquises, UE en dette, UE en rattrapage, diplômes obtenus, barre de progression, compteur « X / Y UV ».
- **AC8.2** Aucun accès aux données d'un autre étudiant ; tuteur lié uniquement (port 008).

### US9 — Dettes et suivi (P2)

- **AC9.1** `listDebts(studentId)` renvoie les UE rattachées au cursus de l'étudiant, non acquises, dont la session 2 a été tentée ou la période est close ; utilisé par 004 pour proposer l'inscription de rattrapage d'une UE l'année suivante (aucune inscription automatique, Q-01).
- **AC9.2** Le tableau de bord direction (025) lit les agrégats via événements : taux de capitalisation par UE, nombre de dettes, diplômés par année.

## 5. Règles métier

| # | Règle |
|---|---|
| R-HIG-01 | Le registre de crédits ne contient que des **acquisitions**. L'état « en cours / échec » d'une UE est un **résultat** (011), pas une écriture du registre. |
| R-HIG-02 | Une UE est acquise **au plus une fois** par étudiant. Une UE acquise n'est pas ré-inscriptible à la validation (le curriculum 004 peut la proposer en consultation). |
| R-HIG-03 | Les crédits d'une écriture sont ceux **figés** au résultat ; les crédits cumulés d'un diplôme sont la somme des crédits **des exigences validées** (une fois par UE). |
| R-HIG-04 | L'éligibilité à un diplôme, l'éligibilité au rattrapage, l'état d'UE (`VALIDATED / RESIT / DEBT`), la mention et la moyenne de cycle sont des **règles** (012) ; ce module ne contient aucune constante réglementaire. |
| R-HIG-05 | Un octroi est unique par `(définition, étudiant)` tant qu'il n'est pas révoqué ; la révocation est définitive (Q-22). |
| R-HIG-06 | L'octroi, la révocation, les surcharges de validation et les documents sont **audités** (`audit.record`, même transaction). |
| R-HIG-07 | Les références `DIP-AAAA-NNNNNN` et `AUTH/AAAA/NNN` sont attribuées par un compteur transactionnel (`higher.number_counters`) : pas de `count(*)`, pas de collision, pas de trou sauf transaction annulée (le compteur est dans la transaction de l'octroi : une annulation ne consomme pas de numéro). |
| R-HIG-08 | Les emplacements de signature n'ont pas de valeur par défaut ; un signataire désactivé ne peut plus être affecté mais reste imprimé sur les documents déjà émis. |
| R-HIG-09 | La date d'obtention d'un diplôme / d'une attestation est celle de la dernière acquisition nécessaire ; l'année académique est celle de la dernière inscription du cycle (champ `academic_year_id`), non déduite du jour de génération. |
| R-HIG-10 | La capitalisation ne dépend d'aucune évaluation de diplôme ; la défaillance de l'une n'affecte pas l'autre. |
| R-HIG-11 | Les prérequis forment un graphe acyclique entre UE d'un même programme ; la satisfaction est évaluée à partir du registre (mode `VALIDATED` par défaut). |
| R-HIG-12 | Un document officiel émis est immuable ; la correction passe par révocation et réémission (nouvelle référence), jamais par modification. |
| R-HIG-13 | Le rattrapage ne porte que sur les ECUE `resit_allowed`, à raison d'une tentative de session 2 par ECUE et par période (borne issue de la règle `eligible_rattrapage`). |
| R-HIG-14 | Le calcul de la compensation reste interne à l'UE (règles `ue_validee`, `statut_ecue`) ; la compensation entre UE, si elle est décidée (Q-03), s'ajoute par règle optionnelle sans changement de ce module. |

## 6. Modèle de données

Voir `data-model.md`. Schéma `higher` (migrations `1400-1499`, plage proposée) :

| Table | Rôle |
|---|---|
| `diploma_definitions`, `diploma_requirements` | Diplômes et exigences (remplace `professional_diplomas`, `professional_diploma_requirements`) |
| `credit_ledger` | Registre de capitalisation (remplace `student_professional_ue_results`) |
| `ue_prerequisites` | Graphe de prérequis (remplace `professional_ue_prerequisites`) |
| `resit_windows`, `resit_registrations` | Fenêtres et inscriptions de rattrapage |
| `diploma_awards` | Octrois (remplace `student_professional_diplomas`) |
| `official_documents` | Snapshots immuables des documents officiels |
| `official_document_slots` | Emplacements de signature → signataire (registre de 013), avec validité (remplace `professional_signataires`) |
| `number_counters` | Compteurs de références (année 0 = séquence continue) ; sans trou sauf réglage contraire (Q-24) |
| `numbering_settings` | Motif de numérotation et réglage « sans trou » par établissement et par nature de document (Q-24, migration 1409) |

## 7. Endpoints

Préfixe `/api/v1/higher` (pack `HIGHER`, `requireFeature`). Contrats Zod avant routes.

| Méthode | Chemin | Description | Permission |
|---|---|---|---|
| GET / POST | `/diplomas` | Liste ; création libre | `higher.diploma.read` / `.manage` |
| POST | `/diplomas/from-curriculum` | Créer depuis un nœud de cycle + synchroniser | `higher.diploma.manage` |
| GET / PATCH | `/diplomas/:id` | Détail ; modification (libellé, `uv_required`, statut) | idem |
| GET / PUT | `/diplomas/:id/requirements` | Lire / remplacer les exigences | `higher.diploma.manage` |
| POST | `/diplomas/:id/sync` | Resynchroniser depuis le curriculum | `higher.diploma.manage` |
| GET | `/diplomas/:id/candidates` | Étudiants du cycle avec progression, éligibilité, octroi | `higher.diploma.read` |
| GET | `/diplomas/:id/awarded` | Octrois | `higher.award.read` |
| POST | `/diplomas/:id/awards` | Octroi manuel `{ studentId, force?, reason? }` | `higher.award.create` / `higher.award.force` |
| POST | `/diplomas/:id/recompute` | Réévaluation de masse | `higher.award.create` |
| POST | `/awards/:id/revoke` | Révocation `{ reason }` | `higher.award.revoke` |
| POST | `/awards/:id/documents` | Émettre `DIPLOMA` ou `ATTESTATION_AUTHENTICITY` | `higher.document.issue` |
| GET | `/attestations/roster` | Progression des étudiants d'un programme (éligibles à l'attestation) | `higher.diploma.read` |
| POST | `/attestations` | Émettre une attestation de réussite `{ studentId, programNodeId }` | `higher.document.issue` |
| GET | `/documents/:id` | Détail / URL signée (via 013) | `higher.document.read` / session étudiant |
| GET | `/students/:id/credits` | Registre, synthèse, dettes | `higher.credits.read` |
| GET | `/students/:id/diplomas` | Progression et diplômes | `higher.diploma.read` / session |
| GET / PUT | `/ue/:nodeId/prerequisites` | Prérequis d'une UE | `higher.prerequisite.manage` |
| GET | `/students/:id/prerequisites-check?nodeId=` | Vérification | `higher.credits.read` |
| GET / POST | `/resit-windows` ; POST `/resit-windows/:id/close` | Fenêtres de rattrapage | `higher.resit.manage` |
| GET | `/resit-candidates?classroomId&periodId` | Candidats | `higher.resit.manage` |
| GET | `/me/credits`, `/me/diplomas`, `/me/resits`, `/children/:studentId/…` | Étudiant / tuteur | session |
| GET / PUT | `/document-slots` | Emplacements de signature | `higher.slot.manage` |

## 8. Écrans

| Portail | Écran | Contenu |
|---|---|---|
| Admin | **Diplômes** | Liste (filtres programme, statut), création depuis le curriculum, éditeur d'exigences (total d'UV en direct, obligatoires), synchronisation |
| Admin | **Candidats & éligibilité** | Progression par étudiant, UE manquantes, octroi (automatique / manuel / forcé avec motif), révocation |
| Admin | **Documents officiels** | Émission diplôme / authenticité / attestation, impression par lot, état de rendu, signataires en vigueur |
| Admin | **Crédits d'un étudiant** | Registre, origine, session, dettes, prérequis manquants |
| Admin | **Rattrapages** | Fenêtre, candidats par classe, évaluations de session 2, suivi |
| Admin | **Prérequis** | Graphe d'une UE, détection de cycle |
| Admin | **Signataires & emplacements** | Affectation et dates de validité |
| Étudiant | **Mon parcours** / **Mes rattrapages** / **Mes diplômes** | Progression, crédits, dettes, documents |
| Parent | **Parcours de l'enfant** | Lecture seule |

## 9. Permissions

| Clé | Libellé | Sensible |
|---|---|---|
| `higher.diploma.read` / `higher.diploma.manage` | Consulter / gérer les définitions de diplômes | non / non |
| `higher.award.read` | Consulter les octrois | non |
| `higher.award.create` | Octroyer un diplôme à un étudiant éligible, relancer l'évaluation | oui |
| `higher.award.force` | Octroyer un diplôme à un étudiant non éligible | **oui** (MFA) |
| `higher.award.revoke` | Révoquer un diplôme | **oui** (MFA) |
| `higher.document.issue` | Émettre diplômes et attestations | oui |
| `higher.document.read` | Consulter les documents officiels | non |
| `higher.credits.read` | Consulter le registre de crédits et les dettes | non |
| `higher.prerequisite.manage` | Gérer les prérequis entre UE | non |
| `higher.resit.manage` | Gérer les fenêtres et candidats de rattrapage | non |
| `higher.slot.manage` | Affecter les signataires des documents officiels | **oui** |

Features : `higher.diplomas`, `higher.session2`, `higher.prerequisites`, `higher.attestations` (pack `HIGHER`). L'enseignant n'a **aucun** accès aux diplômes (parité 029).

## 10. Événements

Publiés :

| Événement | Payload | Consommateurs |
|---|---|---|
| `higher.credits.capitalized` | `studentId, ueNodeId, credits, yearId, via, sessionObtained, ledgerId` | `higher` (éligibilité), 025, notifications |
| `higher.credits.revoked` | `ledgerId, studentId, ueNodeId, reason` | `higher` |
| `higher.ue.debt_detected` | `studentId, ueNodeId, periodId` | 004 (proposition de ré-inscription), notifications |
| `higher.resit.window_opened` / `.closed` | `windowId, classroomId, periodId, nodeIds[]` | `assess` (déverrouillage de session 2), notifications, 014 |
| `higher.resit.registered` | `registrationId, enrollmentId, nodeId, periodId` | 014 (frais éventuels) |
| `higher.diploma.eligible` | `studentId, definitionId` | notifications (si octroi non automatique) |
| `higher.diploma.awarded` | `awardId, studentId, definitionId, reference, via` | 013 (document), notifications, 025 |
| `higher.diploma.revoked` | `awardId, reason` | 013 (documents `REVOKED`) |
| `higher.document.issued` | `documentId, kind, awardId?` | audit, notifications |

Consommés : `results.period.closed` / `.reopened` / `results.decision.confirmed`, `academic.enrollment.*`, `reportcards.report_card.rendered` (documents), `rules.version.*` (réévaluation facultative), `tenancy.tenant.provisioned` (compteurs).

## 11. Tests

- **Golden de parité (bloquant)** : table de vérité d'`evaluateDiplomaEligibility` (obligatoires × cumul d'UV × dédoublonnage) rejouée sur la règle `diplome_eligible` ; scénarios de `professional-diplomas` (progression, octroi automatique, forcé, révocation, ré-octroi) ; mentions de cycle (10/12/14/16/18) ; session d'obtention.
- **Capitalisation** : idempotence, unicité, ordre des événements (clôture avant/après rejeu), réouverture, blocage si diplôme octroyé, crédits figés.
- **Prérequis** : cycles (profondeur), auto-référence, programme croisé, vérification d'inscription.
- **Rattrapage** : fenêtre, déverrouillage de la seule session 2, note retenue, nouvelle décision, dette.
- **Octroi** : concurrence (1 000 octrois), unicité, numérotation sans trou ni doublon, annulation de transaction sans consommer de numéro, isolation de panne capitalisation/éligibilité.
- **Documents** : snapshot immuable, signataire daté, absence de signataire par défaut, authenticité idempotente, rendu via 013, vérification publique (révoqué/remplacé).
- **Isolation** : test générique spec 000 sur toutes les tables ; accès étudiant/tuteur ; enseignant refusé.
- **Audit (R5)** et **architecture** (aucun import interne de `results`/`academic`, ports uniquement ; lint R2).

## 12. Cas limites

- **UE ajoutée au curriculum après l'octroi** : l'octroi garde son snapshot ; les étudiants non diplômés sont réévalués (`sync`, `recompute`).
- **UE retirée du curriculum alors que des étudiants l'ont acquise** : l'écriture reste ; l'exigence est marquée « retirée », signalée à la synchronisation.
- **Étudiant ayant changé de programme** : le registre est par étudiant et par UE ; les exigences ne retiennent que les UE du cycle du diplôme.
- **UE validée dans deux années (double inscription)** : la seconde validation ne recapitalise pas (R-HIG-02) ; alerte « inscription inutile ».
- **Compensation et jury** : une validation par jury (surcharge 011) capitalise avec `via = JURY_OVERRIDE` et la justification est liée.
- **Réouverture après octroi** : si une UE support est révoquée, la révocation de l'octroi est un acte distinct (motif), jamais automatique.
- **Définition modifiée après des octrois** : sans effet sur eux ; les octrois futurs suivent la nouvelle définition.
- **Cycle sans semestre `FINAL`** : mention `PENDING`, octroi automatique en attente.
- **Doublon d'événement / événement tardif** : tous les abonnés sont idempotents (`kernel.processed_events`).
- **Étudiant sans matricule** : le document n'est pas bloqué (le matricule est une donnée de 008) ; la référence est celle du compteur.
- **Changement de signataire entre l'octroi et l'impression** : le document imprime le signataire en vigueur à la **date d'émission du document**, jamais celui du jour de réimpression d'un duplicata (un duplicata est une nouvelle émission liée à l'originale, Q-24).
- **Données personnelles** : un diplôme est une donnée personnelle durable ; export de portabilité et effacement soumis aux règles de conservation légales (non effaçable pendant la durée de conservation).

## 13. Dépendances

- **En amont** : 000, 001 (features `higher.*`), 002 (RBAC, MFA), 003, 004 (curriculum, inscriptions, **registre d'inscriptions aux cours/UE** et attributs de nœuds), 008 (étudiants, tuteurs), 011 (résultats `FINAL`, verrous de session, ré-ouverture de type rattrapage), 012 (contrat `credit-semester@1`, règles), 013 (rendu, signature, vérification, registre des signataires), 030 (audit), worker.
- **Exigences envers 004** (à confirmer avec son architecte) : (a) registre d'inscriptions aux UE/ECUE (régulières, rattrapage, électives) avec API `registerCourse`/`listRegistrations` ; (b) nœud de type « cycle/diplôme » racine d'un ensemble de niveaux ; (c) attributs de nœud : `credits`, `category`, `ordre`, `resit_allowed`, `grading_mode` ; (d) API `listUeOfCycle(nodeId)`.
- **Exigences envers 011** : `results.openResitSession(stateId)` (réouverture de type `RESIT_SESSION`, sans motif de correction, qui ne libère que la session 2) ; `results.listResitCandidates(classroomId, periodId)` ; `results.getFinalLines(...)` en lecture.
- **En aval** : 013 (relevé cumulé), 014 (frais de rattrapage), 016 (notifications), 025, 020/021 (BTS, stages).

## 14. Critères de sortie (mesurables)

1. Un tenant de test clôture un semestre : le registre se remplit, un étudiant éligible reçoit **automatiquement** son diplôme (référence continue), le document est rendu, signé, vérifiable par QR.
2. La table de vérité de parité de l'éligibilité (≥ 30 cas) donne le même résultat que `evaluateDiplomaEligibility`.
3. 1 000 octrois concurrents : 1 000 références distinctes et continues ; une transaction annulée ne consomme pas de numéro.
4. La défaillance injectée de l'évaluation d'éligibilité ne bloque pas la capitalisation (test).
5. Le rattrapage de bout en bout (fenêtre, notes de session 2, reclôture) produit la capitalisation `session_obtained = 2` et la dette pour les UE non validées.
6. Aucun nom de personne ni valeur de signataire par défaut dans le code (grep CI) ; l'émission sans signataire valide est refusée.
7. `professional_diplomas*`, `student_professional_diplomas`, `student_professional_ue_results`, `professional_ue_prerequisites`, `professional_signataires`, `professional-cycle-groups.ts`, `professional-diplomas.service.ts`, `professional-attestations.service.ts`, `professional-signataires.service.ts` et les générateurs jsPDF de diplômes sont supprimés dans la même tranche.
