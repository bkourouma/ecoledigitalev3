# Feature Specification: Pack Secondary — collège et lycée (006-secondary)

**Feature Branch**: `006-secondary`

**Created**: 2026-10-02

**Status**: Rédigée — DDL de référence exécuté et testé (`data-model.md`, 85 tests) ; plan, parité, questions ouvertes et sources réglementaires à obtenir dans le dossier. À relire avec le propriétaire du produit (questions : `open-questions.md` §A, Q6-01 à Q6-32) avant `/speckit.plan`.

**Sources**: `docs/PRD_EcoleDigitale_SaaS.md` §15-21 (pack Secondary, séries, évaluations, calculs, conseil de classe, élèves affectés, examens), §34 (vie scolaire), §41 (l'IA ne décide jamais), §45-46, §66 ; `docs/PLAN_Mise_en_oeuvre_EcoleDigitale_SaaS.md` §3.7-3.8, §3.11-3.12, §4 (Phase 5), §8 ; décisions D1-D9 ; `specs/v2/DECISIONS-METIER.md` ; ADR-001, 002, 003, 004, 006, 007 ; `docs/architecture/module-conventions.md`, `platform-assembly.md`, `new-module-guide.md` ; specs réutilisées : 004 (cœur académique), 008-009 (people), 010 (présences), 011 (évaluations, notes, résultats), 012 (moteur de règles, `regulatory-sources-needed.md`, `rulesets-de-depart.md`), 013 (bulletins), 014 (finance), 016 (communications), 018 (examens, en cours de rédaction) ; legacy : `apps/api/src/routes/semester-averages.ts` (bulletin « classique » : décision de période, décision de fin d'année, distinctions, appréciation du conseil, absences), `docs/menus-et-fonctionnalites-par-profil.md`. Les décisions D1-D9 du plan font foi. Compagnons : `data-model.md` (DDL testé), `plan.md`, `parity.md`, `open-questions.md`, `regulatory-sources-needed.md`.

> **Principe directeur.** Le pack Secondary **n'est pas un nouveau moteur** : c'est une **composition** de modules déjà spécifiés (`academic`, `people`, `attendance`, `assess`, `results`, `rules`, `reportcards`, `finance`, `messaging`, `examinations`) plus **trois petits modules qui comblent ce qui manque** : `councils` (conseil de classe et orientation), `schoollife` (vie scolaire), `stateassign` (élèves affectés par l'État). Aucune formule, aucun seuil, aucune règle de passage, de redoublement, d'orientation, de BEPC ou de BAC n'est écrite ici : le pack fournit des **mécanismes** et un **jeu de règles FICTIF** marqué `source.kind = placeholder` (§6.4). Les textes officiels sont une **question métier** (`regulatory-sources-needed.md`).
>
> **L'application ne décide jamais seule d'un acte réglementaire.** Passage, redoublement, orientation, exclusion, sanction, vérification d'une affectation : une **personne identifiée** décide, la base de données refuse toute décision venant d'un job, d'une règle ou d'un acteur « système » (§5.1, R-C1). Les propositions des règles sont des **suggestions**.

## 1. Objectifs

1. **Conseil de classe complet** (PRD §19) : séance par classe et par période (ou bilan de fin d'année), participants et quorum configurables, ordre du jour par élève avec un **instantané figé** des résultats (lus dans `results`), absences (`attendance`) et discipline (`schoollife`), propositions (appréciations par matière et générale, distinctions, décisions), **décisions humaines** (passage, redoublement, orientation, réorientation, exclusion, avis requis, autre — types configurables), **procès-verbal** généré automatiquement (snapshot immuable, hash, PDF par le worker, signatures datées), **verrouillage** à la clôture et **déverrouillage motivé**.
2. **Vie scolaire** (PRD §34) : incidents, avertissements, sanctions, exclusions temporaires, encouragements, observations, convocations des parents (via `messaging`), recours, **barèmes de points de conduite en paramètres**, historisation obligatoire, audit des actions sensibles, circuits de validation définis par le type, confidentialité (« qui voit quoi » imposée à un seul endroit). Les retards et absences restent dans `attendance` (vue, pas de copie).
3. **Orientation et affectation** (PRD §16, §20) : séries, options et langues **configurables en données** (programmes, nœuds `GROUP`, matières d'`academic`), **parcours autorisés** d'une série à l'autre en données (vides par défaut), dossier d'orientation avec vœux de la famille, passage d'une série à l'autre par une décision humaine ; **élèves affectés par l'État** (`STATE_ASSIGNED`) : dossier versionné et vérifié par un humain, montants déclarés vs facturés (rapprochement), contrôles périodiques, créances (via `finance`), documents, **couche d'intégration future derrière un port**.
4. **Examens nationaux** (PRD §21) : le pack **fournit les faits** (niveau terminal, série, décisions du conseil, absences, discipline) et **consomme** `examinations` (018) pour BEPC et BAC par port ; il ne calcule aucune éligibilité.
5. **Zéro règle officielle inventée** : mécanisme + jeu fictif `placeholder` ; tout nombre de contrôle (quorum, durée, barème, tolérance) est une donnée NULLable.
6. **Égaler le legacy** (bulletin « classique » : décision de période, décision de fin d'année, distinctions, appréciation, absences) **sans** reproduire ses défauts (moyennes saisies à la main, décisions détectées par texte, indicateur « Affecté(e) » confondu avec « admis », calcul dans la route) : `parity.md`.
7. **Un établissement standard (collège et/ou lycée) opérationnel sans développeur** : modèle de pack, onboarding, aucune liste figée dans le code (garde-fou lint, §12).

## 2. Périmètre

### Inclus

- Modules **`councils`** (schéma `councils`, migrations 1800-1804), **`schoollife`** (schéma `schoollife`, 1900-1902), **`stateassign`** (schéma `stateassign`, 2000-2001) : 37 tables, DDL et gardes de `data-model.md`.
- Modèles de pack `SECONDARY` pour les sections `councils` et `schoollife` (génériques, marqués de démonstration), RuleSet `CI-SECONDARY-PLACEHOLDER` (§6.4), exigences vers `academic`, `results`, `rules`, `reportcards`, `people`, `messaging`, `rbac`, `tenancy` (§7.4).
- API `/api/v1/councils`, `/api/v1/schoollife`, `/api/v1/stateassign` (contrats Zod `packages/contracts/src/v2/{councils,schoollife,stateassign}.ts`), écrans (portails admin, enseignant, éducateur, parent, élève), événements, abonnés et jobs, permissions et features.
- Ports : lecture des résultats / absences / discipline, écriture des effets (`results`, `academic`, `people`), notifications, rendu de documents, finance, passerelle État (§7.3).
- Intégration `examinations` (BEPC, BAC) : faits fournis, événements consommés (§4 US11).

### Exclu (renvoyé à d'autres specs)

| Sujet | Spec |
|---|---|
| Années, périodes, programmes (séries), curriculum, classes, inscriptions, issues d'inscription, reconduction | 004 (déjà réutilisés : modèle de pack `CI/secondary.json`) |
| Dossier de l'élève, tuteurs, personnel, affectations d'enseignement (`HOMEROOM`, `LEAD`) | 008, 009 |
| Appel, justificatifs, récapitulatifs d'absences et de retards | 010 (le pack en publie une **vue** ; aucune copie) |
| Types d'évaluation, saisie, circuit de notes, révisions | 011 (`assess`, pack `classic` : interrogation, devoir, composition, examen blanc, projet, oral, TP, autre, moyenne saisie) |
| Formules, seuils, mentions, décisions proposées, RuleSets, gouvernance | 012 |
| Bulletin et relevé, rendu PDF, signatures de document, QR de vérification | 013 (le PV du conseil **réutilise** son port de rendu) |
| Factures, bourses, parts État / famille, paiements, créances | 014, 015 |
| Notifications internes, annonces, canaux e-mail / SMS / WhatsApp | 016 |
| Emploi du temps, salles (planification d'une séance de conseil : lien optionnel) | 017 |
| Moteur d'examens, candidats, éligibilité, résultats, exports BEPC / BAC | 018 |
| Pièces jointes, GED, antivirus | 024 |
| Import Excel (élèves, notes, sanctions historiques) | 031 |
| Statistiques de direction (taux de redoublement, sanctions par classe…) | 025 (consomme les événements du pack) |
| Classes virtuelles, LMS | 022/023 |

### Hors périmètre du plan

Conseil de discipline en tant qu'instance distincte du conseil de classe (voir Q6-04 : le modèle de types de conseil permet de l'ajouter par la donnée, sans code) ; intégration technique réelle avec une plateforme publique d'affectation (port seulement, PRD §20) ; signature électronique qualifiée juridiquement (la signature du pack est un **accusé daté et haché**, sa valeur légale est une question juridique, `regulatory-sources-needed.md` §6) ; santé de l'élève (infirmerie) ; transport, cantine.

### 2.1 Composition : ce qui existe, ce que le pack ajoute

| Besoin du PRD | Module qui le fournit | Ce que le pack Secondary ajoute |
|---|---|---|
| Collège 6e-3e (BEPC), lycée 2nde-Tle (BAC) (§15) | `academic` : cycles `LOWER_SECONDARY` / `UPPER_SECONDARY`, niveaux `6E…TLE` (`academic/templates/CI/secondary.json`), drapeau `terminal_exam_required` par niveau | Renseigne `terminalExamRequired` sur le niveau **dont le PRD dit qu'il conduit à un examen** (3e → BEPC, Terminale → BAC), à **confirmer** (Q6-27) ; rien d'autre |
| Séries générales / techniques / professionnelles, options, langues (§16) | `academic` : programmes enfants d'un programme « lycée », nœuds `GROUP` à choix `{min,max}`, matières du catalogue | **Aucune liste dans le code.** Écrans de configuration ; `orientation_paths` (parcours autorisés, **vide par défaut**) ; tests « une série ajoutée par la donnée » |
| Types d'évaluation (§17) | `assess` : types `INTERROGATION`, `DEVOIR`, `COMPOSITION`, `EXAMEN_BLANC`, `PROJET`, `ORAL`, `TP`, `AUTRE`, `MOYENNE_SAISIE` (modèle `classic`, coefficient, barème, poids, publication) | Rien (réutilisé tel quel) |
| Note → matière → période → année → décision (§18) | `results` + `rules` (contrat `coef-semester@1`) | RuleSet **fictif** `CI-SECONDARY-PLACEHOLDER` ; contrat demandé `secondary-annual@1` (N périodes) ; lecture des suggestions de décision |
| Conseil de classe (§19) | `results.deliberations/decisions/appreciations` (011) fournissent la délibération, la décision proposée→confirmée, l'appréciation | **`councils`** : séance, participants, quorum, ordre du jour figé, propositions, décisions humaines, PV, signatures, verrouillage, effets |
| Absences et retards (§33) | `attendance` | **Vue** dans le dossier de conseil et de vie scolaire (aucune copie) |
| Vie scolaire (§34) | rien | **`schoollife`** |
| Élèves affectés par l'État (§20) | `academic.enrollments.funding_type` + référence ; `finance` (bourses, factures liées, créances) | **`stateassign`** : dossier, vérification, contrôles, rapprochement, port |
| Examens nationaux (§21) | `examinations` (018) | Faits fournis ; événements consommés |
| Bulletin | `reportcards` : gabarit `secondary-bulletin` (générique) | Données du bulletin issues du conseil (appréciation générale, distinctions, décision) ; « Affecté(e) » = financement `STATE_ASSIGNED` (correction du legacy) ; gabarit `council-minutes` |
| Communication aux familles (§38) | `messaging` | Gabarits `council.convocation`, `schoollife.convocation`, `schoollife.measure.notified` |

## 3. Acteurs

| Acteur | Rôle vis-à-vis de cette spec |
|---|---|
| Chef d'établissement / Directeur | Préside le conseil par défaut ; valide exclusions et sanctions lourdes ; approuve un déverrouillage ; vérifie des affectations |
| Directeur des études | Planifie les conseils, prépare l'ordre du jour, suit les effets, pilote l'orientation |
| Professeur principal (`HOMEROOM`) | Présente la classe et chaque élève, propose appréciations et distinctions, rédige la synthèse |
| Enseignant | Participe au conseil ; propose des appréciations ; déclare un incident ; consigne un encouragement ou une observation |
| Éducateur / vie scolaire | Déclare incidents, propose avertissements et sanctions, convoque les parents, gère les retards et absences (via `attendance`) |
| Conseiller d'orientation (rôle de participant) | Collecte les vœux, rend un avis, suit le dossier d'orientation |
| Secrétariat | Enregistre convocations et présences, génère et fait signer le PV, enregistre les affectations |
| Économe / Comptable | Rapproche les montants des affectations avec la facturation, suit les créances de l'État |
| Délégués des élèves et des parents | Participants externes du conseil (lecture de leur partie, signature si le type l'exige) |
| Parent / Tuteur | Reçoit les convocations ; consulte les décisions et mesures **partageables** de son enfant ; dépose un recours ; exprime des vœux d'orientation ; donne son accord quand le parcours l'exige |
| Élève | Consulte ses décisions et mesures partageables selon la politique de l'établissement ; exprime ses vœux |
| Super-admin plateforme | Applique le modèle de pack ; publie les RuleSets réglementaires ; ne décide jamais d'un acte d'élève |
| Worker | Rendu PDF du PV, propagation des effets, rapprochements, rappels de convocations, planification des contrôles |
| Modules consommateurs | `results`, `academic`, `people` (effets) ; `reportcards` (PV, bulletin) ; `examinations` (faits) ; `analytics` (événements) |

## 4. User Stories et critères d'acceptation

Les valeurs chiffrées de performance sont des **objectifs** mesurés en CI de performance ; les autres critères sont **bloquants**.

### US1 — Préparer un conseil sur des données figées (priorité P1)

En tant que directeur des études, je prépare le conseil d'une classe : chaque élève arrive avec ses résultats, ses absences et sa vie scolaire, tels qu'ils étaient au moment de la préparation.

- **AC1.1** `createCouncil` refuse un conseil dont l'état de résultats (`results.getStateView`) est inférieur au minimum du type (`min_results_status`, défaut `GRADING_LOCKED`) : `409 councils.results_not_ready` avec l'état constaté ; refuse une classe non `ACTIVE`, un type inactif, un type de portée différente ; un seul conseil vivant par (classe, type, période) (index unique ; test de concurrence : deux créations simultanées → une seule réussit).
- **AC1.2** `prepareCouncil` crée **un élément d'ordre du jour par inscription active** de la classe (`academic.getRoster`), avec un instantané `council-facts/1` (résultats, absences, discipline, appréciations, financement, redoublant) : **p95 ≤ 3 s pour 60 élèves** (objectif). Relancer est idempotent : la version de l'instantané (`facts_version`) n'augmente que si le hash change.
- **AC1.3** Hash et version sont **posés par la base** (`facts_hash = minutes_hash(facts)`, `facts_version`) ; une valeur fournie par le client est ignorée (test). Reconstruire l'instantané d'un élève **est refusé** dès qu'une décision enregistrée s'appuie sur lui (`councils.facts_locked_by_decision`).
- **AC1.4** L'instantané ne contient **que** des chaînes, entiers, booléens et `null` (jamais de flottant ; moyennes en chaînes décimales exactes lues de `results`) ; **aucune valeur n'est calculée par `councils`** (aucune moyenne, aucun rang, aucune mention : garde-fou lint « aucune arithmétique sur les résultats », R2 de la spec 000).
- **AC1.5** Un élève sans résultat exploitable (`ERROR`, aucune note publiée) apparaît avec l'indicateur `missingResults = true` ; une décision de la famille `PASSAGE` ou `REPEAT` pour cet élève exige une justification (≥ 20 caractères).
- **AC1.6** Les suggestions des règles (`results.decisions` au statut `PROPOSED`, `appreciation_conseil`, `distinction`) deviennent des **propositions `RULE_SUGGESTION`** portant la référence de la version de règle ; elles ne sont **jamais** acceptées automatiquement (AC3.1).
- **AC1.7** Minimisation : l'instantané n'embarque de la vie scolaire que des **comptages et des codes** (mesures par famille et gravité, jours d'exclusion, points de conduite si activés), jamais un texte libre, une déclaration d'élève ni un élément `CONFIDENTIAL` (test sur le schéma du contrat).

### US2 — Convoquer, composer le conseil, l'ouvrir avec quorum (P1)

En tant que secrétariat, je convoque les participants, j'enregistre leur présence et le président ouvre la séance.

- **AC2.1** Les participants proposés viennent de `people.listAssignmentsForClassroom` (professeur principal = rôle `HOMEROOM_TEACHER`, enseignants `LEAD` = rôle `TEACHER`) et des fonctions par défaut de l'établissement ; le secrétariat ajoute des participants externes (délégués) ; le **nom de chaque participant est figé** à la convocation (il figure au PV même si la fiche change).
- **AC2.2** `convokeCouncil` envoie **une** notification par participant via `messaging` (`notification_ref` conservée) ; rejouer n'en envoie pas une seconde (idempotence par participant et par séance).
- **AC2.3** L'ouverture (`PLANNED → OPEN`) est **imposée par la base** : un **président PRÉSENT** est requis (`councils.president_required`) ; le quorum (`min_participants`, présents comptant pour le quorum) et les rôles exigés (`required_role_codes`, au moins un présent chacun) sont contrôlés quand ils sont renseignés (`NULL` = aucun contrôle) ; sinon `councils.quorum_not_met` indique présents, seuil et rôles manquants.
- **AC2.4** Ouvrir **sans quorum** est possible seulement si le réglage d'établissement l'autorise (`allow_quorum_waiver`) et avec un **motif d'au moins 10 caractères** ; la dérogation est journalisée (événement `OPENED` avec le motif) et publiée (`councils.quorum.waived`).
- **AC2.5** Les actes d'ouverture, de clôture et d'annulation exigent un utilisateur identifié ; un job ou un acteur système est refusé (`councils.human_decision_required`, test sur acteurs `system` et `superAdmin`).
- **AC2.6** À l'ouverture, `councils` ouvre ou lie la délibération de `results` (`results_deliberation_id`, type `COUNCIL`) ; à la clôture elle est marquée **tenue** (`HELD`, puis `SIGNED` à la signature complète du PV) avec la date réelle de la séance (la date imprimée sur le bulletin est celle-là, jamais la date du jour d'impression : R-RC-11 de 013).
- **AC2.7** Annuler une séance exige un motif (≥ 5 caractères) ; une séance annulée libère la place (un nouveau conseil du même type est possible).

### US3 — Proposer, puis décider : l'humain décide (P1)

En tant que professeur principal, je propose une appréciation et une décision ; en tant que président, le conseil enregistre sa décision.

- **AC3.1** **Aucune suggestion de règle n'a de valeur sans humain** : une proposition `RULE_SUGGESTION` n'a pas d'auteur, ne passe `ACCEPTED`/`REJECTED` que par un utilisateur identifié (`resolved_by` = utilisateur de la session, posé par la base) ; une proposition traitée ne change plus ; son contenu ne change jamais (en créer une nouvelle).
- **AC3.2** Une **décision** (`councils.decisions`) exige : séance `OPEN` ; utilisateur de session (acteur `user`) ; **décideur = participant `PRESENT` dont le rôle porte `can_decide`** ; type actif applicable à la portée du conseil ; justification si le type l'exige (≥ 10 caractères), vote complet (`votes_for/against/abstain`) si le type exige un vote ; cible (`target_program_id`/`target_grade_level_id`) si le type l'exige (orientation, réorientation). Code, famille et groupe exclusif sont **recopiés du type par la base** (non falsifiables).
- **AC3.3** Une décision qui **s'écarte de la suggestion** de la règle porte `differs_from_suggestion = true` et une **justification d'au moins 20 caractères** (contrainte de table) ; la suggestion (`suggested_code`, `suggestion_ref`) et la décision sont conservées côte à côte, jamais écrasées (parité avec R-RES-05 de 011).
- **AC3.4** Deux décisions d'un même groupe exclusif (`exclusive_group`, ex. `YEAR_OUTCOME` : passage, redoublement, orientation) ne coexistent pas pour un élève et une séance (index unique) ; pour en changer, la première est **retirée avec un motif** (≥ 5 caractères) et la nouvelle porte `supersedes_id`.
- **AC3.5** L'élément d'ordre du jour passe `DECIDED` **par la base** dès qu'une décision est enregistrée et revient `REVIEWED` quand la dernière est retirée ; il n'est jamais « décidé » à la main.
- **AC3.6** Chaque décision référence la version de l'instantané sur laquelle elle est prise (`facts_version`, `facts_hash`) : on peut prouver ce que le conseil avait sous les yeux.
- **AC3.7** Les **appréciations** : l'appréciation de matière est celle du professeur (`results.appreciations`, `author_role = TEACHER`, lue dans l'instantané) ; l'**appréciation générale du conseil** est une proposition `APPRECIATION` (texte 1 à 1 000 caractères, libre ou préremplie par la suggestion de règle) ; acceptée par un humain, elle produit l'effet `RESULTS_APPRECIATION` qui l'écrit dans `results.appreciations` (`author_role = COUNCIL`). Les **distinctions** (tableau d'honneur, encouragements, félicitations, blâme… libellés en données) suivent le même chemin (`RESULTS_DISTINCTION`).
- **AC3.8** L'IA (spec 026, après V1) ne peut ni proposer d'appréciation automatiquement acceptée ni décider : elle est un assistant de rédaction dont le texte reste une proposition `HUMAN`.

### US4 — Clôturer, générer le procès-verbal, faire signer (P1)

En tant que secrétariat, à la fin de la séance je clos, le PV est généré, les participants le signent.

- **AC4.1** La clôture (`OPEN → CLOSED`) est refusée si le type exige une décision par élève (`requires_decision_per_student`) et qu'un élève n'en a pas : `councils.undecided_students` (nombre). Elle **verrouille** participants, ordre du jour, propositions, décisions (gardes de la base).
- **AC4.2** `generateMinutes` produit un **snapshot** `council-minutes/1` : identité de l'établissement, classe, période, date réelle, lieu, participants (nom figé, rôle, présence), pour chaque élève : faits utilisés, **suggestion de la règle**, décision, justification, vote, appréciation et distinctions, mesures de vie scolaire (comptages), signataires attendus, références (version de règle, `facts_hash`) et la **mention « jeu de règles de démonstration, non réglementaire »** si le RuleSet épinglé est `placeholder`. Le snapshot ne contient que chaînes, entiers, booléens, `null`.
- **AC4.3** Le **hash** (`snapshot_hash`, SHA-256) est **calculé par la base** ; le snapshot, le hash et la version sont immuables (`UPDATE`/`DELETE` refusés, test) ; une seule version vivante par séance.
- **AC4.4** Le rendu PDF est demandé au worker par `reportcards` (`DocumentRenderer`, type `COUNCIL_MINUTES`) **depuis le snapshot seul** ; le hash et la clé de stockage du PDF sont conservés ; un rendu en échec est repris 3 fois puis signalé ; 40 PV de classe en ≤ 120 s sur un worker 2 vCPU (objectif, lot de fin de période).
- **AC4.5** **Signatures datées** : un participant **présent** et **exigé** par le type de conseil (fonctions `PRESIDENT`/`SECRETARY` et/ou rôles listés ; au moins un signataire exigé, contrainte de table) signe **le hash** du PV ; la base refuse un hash différent, un participant non exigé, une signature faite au nom d'un autre utilisateur ; chaque signature porte sa date posée par la base (`signed_at`) ; une signature papier numérisée exige sa pièce (`evidence_object_key`).
- **AC4.6** Quand **toutes** les signatures exigées sont recueillies, **la base** passe le PV puis la séance à `SIGNED` (aucune étape manuelle) ; deux signataires qui signent **simultanément** produisent bien l'état `SIGNED` (signatures sérialisées par verrou de ligne, test de concurrence).
- **AC4.7** `GET /minutes/:id/pdf` renvoie une URL signée (≤ 5 min) après contrôle de permission ; un PV `SUPERSEDED` reste téléchargeable par la gestion ; `revoke` (sensible, motif ≥ 10 caractères) est audité.

### US5 — Verrouiller, déverrouiller avec motif (P1)

En tant que directeur, je peux rouvrir un conseil signé si une erreur est découverte, de façon tracée.

- **AC5.1** `CLOSED` et `SIGNED` sont les états **verrouillés** : aucune écriture sur la séance, ses participants, son ordre du jour, ses propositions, ses décisions (gardes de la base, valables pour tout rôle).
- **AC5.2** Le **déverrouillage** (`CLOSED|SIGNED → OPEN`) exige une **demande motivée** (`unlock_requests`, motif ≥ 20 caractères) **approuvée** par un utilisateur ; si `require_separate_unlocker` (défaut vrai) l'approbateur est **une autre personne** que le demandeur (contrainte de table ; la dérogation `four_eyes_waived` est refusée quand le réglage l'impose) ; la demande est **consommée** par **une** réouverture ; une seule demande ouverte à la fois.
- **AC5.3** La réouverture est **refusée tant qu'un effet est `APPLIED`** (il doit d'abord être annulé, `REVERTED`, ou il est irréversible : `councils.effect_irreversible`) ; les effets non appliqués sont écartés (`SKIPPED`) ; le PV précédent passe `SUPERSEDED` ; `reopen_count` s'incrémente ; l'événement `REOPENED` porte le motif.
- **AC5.4** La reclôture produit la **version n+1** du PV (`supersedes_id`), conserve l'ancienne consultable, et recommence le cycle de signatures.
- **AC5.5** Le déverrouillage est une **opération sensible** (`council.unlock.approve`, MFA, audit) ; il est publié (`councils.council.reopened`) pour que `reportcards` marque les bulletins concernés « à rééditer ».
- **AC5.6** Si `results` rouvre la période (`results.period.reopened`) alors qu'un conseil est `SIGNED`, une alerte « conseil à revoir » est adressée à la direction ; `councils` ne rouvre jamais un conseil de lui-même.

### US6 — Appliquer les décisions : effets idempotents, exclusion = acte humain (P1)

En tant que direction, une fois le PV signé, les décisions produisent leurs effets sans ressaisie, sans jamais appliquer une exclusion automatiquement.

- **AC6.1** À l'état configuré (`effects_trigger` : `SIGNED` par défaut, ou `CLOSED`), chaque décision crée ses **effets** : `RESULTS_DECISION` (familles `PASSAGE`, `REPEAT` : décision confirmée dans `results.decisions`, portée année, avec le code final du type), `ENROLLMENT_OUTCOME` (issue d'inscription `academic.recordEnrollmentOutcome`, avec cible pour les issues de redirection), `ORIENTATION_FILE`, `SERIES_TRANSFER`, `NOTIFY_GUARDIANS` ; chaque proposition acceptée d'appréciation / distinction crée `RESULTS_APPRECIATION` / `RESULTS_DISTINCTION`. Les effets naissent **avant l'état voulu → refus** (`councils.effects_too_early`).
- **AC6.2** Un effet est **unique par (décision ou proposition, nature)** tant qu'il est vivant (index unique) ; la file est **idempotente** : l'abonné `councils.apply-effects` rejoue sans doublon ; un échec passe `FAILED` (tentatives, dernière erreur) et est repris (backoff) ; l'effet `APPLIED` mémorise la référence créée (`external_ref`) ; un effet marqué `irreversible` ne peut plus être annulé.
- **AC6.3** **Exclusion** : toute décision dont le type porte `needs_human_application` (famille `EXCLUSION`, contrainte de table) ne produit que des effets **`AWAITING_HUMAN`** (hors notification) ; le passage à `APPLIED` est un **acte d'un utilisateur habilité** (`student.status.update` de `people`, sensible), jamais d'un job ; `applied_by` est posé par la base à l'utilisateur de la session (non falsifiable). Test : un acteur système tentant d'appliquer l'effet est refusé.
- **AC6.4** La décision propagée vers `results` respecte les **codes permis par le contrat de règles** du RuleSet épinglé ; un code non permis est refusé **avant** le conseil (validation à la configuration du type de décision) et à l'application (effet `FAILED` avec diagnostic).
- **AC6.5** La reconduction annuelle de `academic` (US7 de 004) lit la décision d'année **confirmée** dans `results` : les décisions de passage et de redoublement du conseil sont donc les seules sources du passage ; `councils` ne crée jamais d'inscription pour l'année suivante (c'est `academic`).
- **AC6.6** `GET /councils/:id/effects` montre, par décision, l'état de chaque effet ; les effets `FAILED` ou `AWAITING_HUMAN` sont visibles dans la file de la direction (compteur de la cloche).

### US7 — Orientation, séries, options, passage d'une série à l'autre (P2)

En tant que directeur des études, je pilote l'orientation de fin de cycle et les changements de série, avec la famille.

- **AC7.1** **Aucune série, option ni langue n'est figée dans le code** : un tenant crée une série (programme enfant), une option (nœud `GROUP` {min,max}) ou une langue (matière) par la donnée, et elle apparaît dans l'orientation sans livraison (test d'intégration : série ajoutée par l'API, utilisée dans un parcours et une décision). Garde-fou lint : aucune liste de séries (« A », « C », « D », « G1 »…), de langues ou de coefficients dans `modules/{councils,schoollife,stateassign}/**`.
- **AC7.2** `orientation_paths` (parcours autorisés : de niveau/série vers niveau/série, avis du conseil requis ou non, accord de la famille requis ou non) est **vide par défaut** : aucun parcours officiel n'est livré. Un transfert hors parcours exige une **dérogation motivée** (≥ 20 caractères) de l'utilisateur de la session, journalisée (permission sensible `council.orientation.override`).
- **AC7.3** Le **dossier d'orientation** est unique par inscription ; les **vœux** (famille, élève, personnel, conseiller) sont classés (un par rang) et ne portent que des identifiants de série et d'options ; un vœu peut être retiré, pas supprimé.
- **AC7.4** Un **transfert de série** n'existe que par une **décision humaine** : décision du conseil dont la cible (série, niveau) est exactement celle du transfert, **ou** acte de la direction avec **référence d'acte** et signataire ; un transfert par an et par inscription ; il s'applique à `academic` (issue `REDIRECT` avec cible pour l'année suivante, ou transfert de classe en cours d'année) ; un échec passe `FAILED` et se reprend.
- **AC7.5** Si le parcours exige l'**accord de la famille**, le dossier ne passe pas `APPLIED` tant que l'accord n'est pas `GIVEN`, avec qui l'a enregistré et quand (contrainte de table) ; un refus (`REFUSED`) bloque l'application et alerte la direction.
- **AC7.6** Les choix d'options (LV2, option…) sont des sélections `OPTION` d'`academic.enrollment_courses` créées par l'application de la décision ou de l'inscription ; `councils` ne duplique aucune sélection.

### US8 — Vie scolaire : incidents, mesures, observations, convocations, recours (P1)

En tant qu'éducateur, je déclare un incident, je propose une mesure ; en tant que direction, je la valide ; la famille est informée.

- **AC8.1** **Tout acte exige un utilisateur identifié** (déclarer, proposer, valider, notifier, révoquer, rédiger, convoquer) : un acteur système est refusé (`schoollife.human_actor_required`) ; la personne enregistrée (déclarant, proposant, auteur, validateur, notifieur) est toujours **l'utilisateur de la session**, recopié par la base.
- **AC8.2** **Le type porte le circuit** : `requires_validation`, `requires_four_eyes`, `approver_permission`, `notify_guardians`, `visible_to_guardians`, `appealable`, confidentialité plancher, `requires_dates`. Une sanction ou une exclusion temporaire se **propose** (`PROPOSED`) puis se **valide** ; si `requires_four_eyes`, **le validateur n'est pas le proposant** (`schoollife.four_eyes_required`). Une **exclusion temporaire exige toujours une validation** et des dates (contraintes de table). Un avertissement (`requires_validation = false`) est directement en vigueur.
- **AC8.3** Machine à états des mesures : `PROPOSED → VALIDATED | REJECTED | CANCELLED` ; `VALIDATED → NOTIFIED | EXECUTED | CANCELLED` ; `NOTIFIED → EXECUTED | APPEALED | REVOKED` ; `EXECUTED → APPEALED | REVOKED` ; `APPEALED → EXECUTED | REVOKED` ; états finaux `REJECTED`, `CANCELLED`, `REVOKED`. Le rejet exige un motif (≥ 5), la révocation un motif (≥ 10), l'annulation un motif (≥ 5). Le **motif, la gravité et le type ne changent plus après validation** ; les dates ne changent plus après notification.
- **AC8.4** Deux **exclusions temporaires** vivantes (validées, notifiées, exécutées, en recours) du même élève **ne se chevauchent jamais** (contrainte d'exclusion de la base) ; deux exclusions proposées peuvent se chevaucher tant qu'aucune n'est validée.
- **AC8.5** **Recours** : déposable sur une mesure `NOTIFIED` ou `EXECUTED` dont le type est `appealable` ; la mesure passe `APPEALED` ; issue `UPHELD`/`WITHDRAWN` → mesure `EXECUTED` ; `OVERTURNED` → mesure `REVOKED` avec le motif de la décision (≥ 10 caractères) ; un seul recours ouvert par mesure ; la décision est celle de l'utilisateur de la session.
- **AC8.6** **Incidents** : `DECLARED → UNDER_REVIEW → CONFIRMED | DISMISSED → CLOSED` ; un incident écarté ou clos exige une note de résolution (≥ 5) ; la **description ne change plus** après l'ouverture de l'instruction ; une mesure liée à un incident ne vise qu'un élève désigné **auteur** de cet incident.
- **AC8.7** **Notes** (encouragements, observations) : immuables, retirées avec un motif (jamais supprimées) ; la visibilité (`STAFF_ONLY`, `GUARDIANS`, `STUDENT_AND_GUARDIANS`) ne peut pas dépasser ce que le type autorise ; une note `CONFIDENTIAL` est `STAFF_ONLY`.
- **AC8.8** **Convocations** : `DRAFT → SENT → ACKNOWLEDGED → HELD` (ou `NO_SHOW`, `CANCELLED`, `RESCHEDULED`) ; l'envoi passe par `messaging` (`notification_ref`) ; l'accusé de réception vient d'un **tuteur convoqué** (`acknowledged_by_guardian_id` ∈ destinataires) ; destinataires et motif sont figés après l'envoi ; un report crée une nouvelle convocation qui référence l'ancienne ; un rappel (job) est envoyé avant l'échéance si le tenant l'a activé.
- **AC8.9** **Historique** : chaque création et chaque changement de statut écrit une ligne de `life_events` **par la base** (acteur, motif), en ajout seul ; la lecture d'un élément `CONFIDENTIAL` écrit une ligne de `confidential_reads` (lecteur = utilisateur de la session, motif ≥ 5 caractères) **avant** de renvoyer le contenu.
- **AC8.10** **Aucun seuil ni équivalence** (« 3 retards = 1 absence ») n'est codé : des comptages et des alertes **paramétrables** (`attendance.alert.triggered` peut proposer une convocation que l'éducateur confirme) ; le pack n'invente aucune sanction automatique.
- **AC8.11** Les **retards et absences** sont affichés dans la fiche de vie scolaire par **lecture** d'`attendance` (`getAttendanceSummary`, `listAbsences`) ; le pack ne les stocke pas.

### US9 — Points de conduite : barèmes en paramètres (P2)

En tant que direction, je définis le barème de points de conduite de l'établissement (s'il en utilise un) sans livraison de code.

- **AC9.1** `conduct_points_enabled` est faux par défaut ; aucun barème n'est livré ; la création d'un mouvement est refusée tant que l'établissement n'a pas activé les points (`schoollife.conduct_disabled`).
- **AC9.2** Un barème se crée en **brouillon**, reçoit des valeurs (points en moins pour une sanction, en plus pour un encouragement ; ni incident ni observation), s'**active** par un utilisateur (au moins une valeur), puis est **figé** ; on le **retire** (RETIRED) et on en crée un nouveau. **Un seul barème ACTIF** par établissement, niveau (ou « tous niveaux ») et période d'effet (contrainte d'exclusion).
- **AC9.3** Le **solde est dérivé** (`conduct_balance` : points initiaux + mouvements du périmètre de remise à zéro `PERIOD`/`YEAR`/`NEVER`, borné par `min_points`/`max_points`) ; le registre `conduct_movements` est en **ajout seul** ; chaque mouvement issu d'une mesure ou d'une note **égale la valeur du barème** pour le type de l'événement source (une écriture par source) ; une correction est un **mouvement inverse exact** ; un ajustement manuel est motivé et audité (`schoollife.conduct.adjust`, sensible).
- **AC9.4** La **note de conduite du bulletin** n'est **jamais** calculée automatiquement : `schoollife` publie le solde (`getConductPoints`) comme **aide** ; la note est saisie par un humain dans `assess` sur le nœud transversal `DIRECT` (circuit de validation de 011). Un barème `placeholder` est signalé comme tel à l'écran.
- **AC9.5** Le jeu de démonstration (`source_kind = placeholder`) est marqué à l'écran ; aucune valeur de barème n'est reprise du code legacy (il n'en existe pas).

### US10 — Élèves affectés par l'État : dossier, vérification, rapprochement, contrôles (P1 pour le dossier, P2 pour les contrôles)

En tant que secrétariat et économe, je gère les élèves affectés (`STATE_ASSIGNED`) avec leurs références, leurs montants, leurs contrôles et leurs créances.

- **AC10.1** `recordAssignment` crée un **dossier** (`RECEIVED`) par inscription (un seul dossier vivant), avec référence d'affectation (unique par établissement et année, hors dossiers rejetés ou remplacés), autorité émettrice (libellé libre), date, montants **déclarés** État et famille (entiers, unités mineures) ; l'enregistrant est l'utilisateur de la session (source `MANUAL`) ; un import ou la future passerelle écrit sous l'acteur système avec la source `IMPORT`/`GATEWAY` (et l'empreinte de l'échange), jamais la vérification.
- **AC10.2** La **vérification** est un **acte humain** : `RECEIVED → VERIFIED` par un utilisateur **autre que l'enregistrant** (réglage `require_separate_verifier`, défaut vrai) ; la base pose le vérificateur et la date ; à la vérification, `stateassign` appelle `academic.changeEnrollmentFunding(STATE_ASSIGNED, référence)` : **la référence d'affectation n'a qu'une source**.
- **AC10.3** **Cycle de vie** : `VERIFIED → ACTIVE` ; `ACTIVE ⇄ SUSPENDED` (motif ≥ 5) ; `→ ENDED` ou `→ TRANSFERRED` (date et motif de fin) ; `REJECTED` motivé ; états finals immuables. Référence, autorité et montants déclarés sont **figés après vérification**.
- **AC10.4** **Avenant** : un changement de référence ou de montants **remplace** le dossier (`SUPERSEDED`, date et motif) puis crée la **version n+1** (`supersedes_id`, même inscription, même année) qui repart à `RECEIVED` ; l'historique des versions est conservé.
- **AC10.5** **Rapprochement** avec `finance` : un job calcule les écarts entre montants déclarés et montants facturés (part de l'État : facture liée de la bourse `STATE` ; part de la famille) et les enregistre ; **la base calcule le statut** (`BALANCED` si les deux écarts sont ≤ la tolérance de l'établissement, sinon `DISCREPANCY`) ; un statut saisi est ignoré ; un écart alerte l'économe (`stateassign.reconciliation.discrepancy`) ; les créances de l'État restent dans `finance` (reporting « créances par type de financement »).
- **AC10.6** **Contrôles** périodiques (présence, identité, rapprochement financier, pièces) : planifiés (par un humain ou par un job selon `required_control_kinds`, vide par défaut), **réalisés par un humain** (`OK`, `ANOMALY` avec constat, `WAIVED` avec motif) ; une anomalie se résout avec un motif ; un contrôle par nature et par période ; les faits constatés (comptages d'absences) sont lus d'`attendance` au moment du contrôle.
- **AC10.7** **Documents** : références (jamais le fichier) vers la GED ou le dossier de l'élève : acte d'affectation, attestation de présence, reçu, courrier ; retrait motivé.
- **AC10.8** **Passerelle future** : le port `StateAssignmentGateway` (`fetchAssignment`, `pushAttendanceCertificate`) a un adaptateur par défaut `NotConfigured` qui répond « non disponible » ; aucun appel externe n'existe en V1 ; `source = GATEWAY` et `external_payload_hash` tracent un futur échange sans stocker la donnée brute.
- **AC10.9** Un élève affecté se **distingue sur le bulletin** par le **type de financement de son inscription** (donnée de `academic`), **jamais** par la décision de fin d'année (correction du legacy, `parity.md` P-S-05).
- **AC10.10** **Créances sur l'État** : l'établissement planifie les **échéances attendues** de chaque dossier (libellé, date, montant entier ; total ≤ part de l'État déclarée) ; le **montant reçu** de chaque échéance est écrit par le rapprochement (versements du financeur dans `finance`, affectés dans l'ordre des échéances ; surplus « non affecté » visible) ; le **statut** est calculé par la base ; le **retard** est dérivé (échéance + délai de grâce de l'établissement) et signalé une seule fois (`stateassign.receivable.overdue`) ; une échéance reçue ne s'annule pas ; historique en ajout seul ; ancienneté et totaux par tranche.
- **AC10.11** **Exports** : états et exports CSV pour l'administration, **formats en données** par établissement (aucun format officiel livré, format neutre en repli), cellules texte neutralisées contre l'injection de formule, troncature signalée ; chaque export est audité.
- **AC10.12** **Vue famille** : le parent lié voit le **statut** du dossier de son enfant, jamais les montants de l'État, les échéances, les écarts ni les contrôles (`GET /children/:studentId/assignment`, lien relu à chaque requête).

### US11 — Examens nationaux BEPC et BAC (P2)

En tant que directeur des études, je prépare les candidats BEPC et BAC avec le moteur d'examens.

- **AC11.1** Le pack publie les **faits** d'un élève pour 018 : `getExamEligibilityFacts(enrollmentId)` → niveau et cycle, drapeau `terminal_exam_required` du niveau, série (programme), redoublant, décisions du conseil (codes et familles), type de financement, comptages d'absences et de discipline de l'année (jamais de détail) ; **aucune éligibilité n'est calculée** par le pack.
- **AC11.2** Le pack **consomme** les événements d'inscription et de résultat de 018 (`examinations.candidate.registered`, `examinations.result.published` ⚠ noms à aligner avec 018) pour les afficher au dossier et au conseil ; **les examens blancs** sont des évaluations `EXAMEN_BLANC` de `assess` (publiées pour le calcul, masquées aux familles selon le type), jamais un second objet.
- **AC11.3** Une décision `EXAM_REFERRAL` de `results` est affichée comme **suggestion** ; la présentation à l'examen reste une inscription de 018 faite par un humain.

### US12 — Portails : parents, élèves, enseignants ; confidentialité (P1)

- **AC12.1** **Source unique de « qui voit quoi »** : la fonction SQL `schoollife.audience_may_see` (testée sur une table de vérité de 19 cas) est celle des lectures de portail : jamais un élément `CONFIDENTIAL` ; jamais un incident brut ; une mesure est visible **après notification** si l'événement est partageable ; une note selon la visibilité choisie par son auteur ; une convocation une fois envoyée ; un élève ne voit que ce que la politique de l'établissement lui ouvre.
- **AC12.2** Le tuteur voit les **décisions du conseil de son enfant** selon `guardian_visibility` (`NEVER`, `AFTER_SIGNATURE`, `AFTER_NOTIFICATION` : défaut) : jamais le détail des autres élèves, jamais les suggestions de règles, jamais les justifications internes ni les votes.
- **AC12.3** Un **enseignant** voit la vie scolaire des élèves de **ses classes** (lien d'affectation vérifié par `people`, comme `student.class.read`), au niveau `STANDARD` ; `RESTRICTED` et `CONFIDENTIAL` exigent des permissions dédiées (`schoollife.restricted.read`, `schoollife.confidential.read` sensible, journalisée).
- **AC12.4** Le tuteur lit uniquement les données des enfants avec lesquels il a un lien vivant (`people.isGuardianOfStudent`, revérifié à chaque lecture) ; hors lien : `404`, jamais `403`.
- **AC12.5** Tous les écrans sont utilisables sur smartphone (saisie d'une observation, déclaration d'un incident, consultation d'une convocation) ; la saisie d'une observation et la déclaration d'un incident sont conçues pour le **hors-ligne** (file de mutations idempotentes, squelette 029), sans jamais afficher un élément confidentiel hors ligne.

### US13 — Un établissement standard opérationnel sans développeur (P1)

- **AC13.1** Un tenant `SECONDARY` provisionné reçoit **par abonné idempotent** les sections `councils` et `schoollife` du modèle de pack (génériques) et la section `academic` (cycles, niveaux, périodes) ; une année, une classe, un curriculum, un conseil de test se créent **par l'API** sans intervention de développeur.
- **AC13.2** Le jeu de règles `CI-SECONDARY-PLACEHOLDER` est lié par défaut au pack (§6.4) ; chaque résultat, PV et bulletin produit sous ce jeu porte la mention « jeu de démonstration, non réglementaire » ; l'établissement le **remplace** par une variante `institution` (D5) ou par le jeu réglementaire quand il existe.
- **AC13.3** **Aucune valeur réglementaire par défaut** : test sur les modèles de pack livrés (`minParticipants = null`, `orientationPaths = []`, `conductScales = []`, `retentionDays = null`, `requiredControlKinds = []`).

## 5. Règles métier

### 5.1 Conseil de classe

- **R-C1 (l'humain décide).** Décision, résolution de proposition, signature, ouverture, clôture, annulation, déverrouillage : session d'utilisateur identifié obligatoire, vérifiée **en base** (acteur `user` + identifiant). Le super-administrateur n'exerce jamais ces actes pour un établissement.
- **R-C2.** Une suggestion de règle (`RULE_SUGGESTION`) est une **information** : elle est conservée avec la décision, jamais appliquée seule ; s'en écarter exige une justification.
- **R-C3.** Le décideur est un participant **présent** habilité (`can_decide`) ; le président est présent à l'ouverture.
- **R-C4.** Le quorum, les rôles exigés, les signataires sont des **données du type de conseil** ; `NULL` = pas de contrôle ; aucune valeur par défaut « officielle ».
- **R-C5.** Les faits d'un élève sont un **instantané** (hashé, versionné) ; une décision référence la version ; l'instantané ne se reconstruit plus sous une décision.
- **R-C6.** `CLOSED` et `SIGNED` verrouillent ; déverrouiller = demande motivée approuvée, consommée une fois ; jamais avec un effet appliqué restant.
- **R-C7.** Le PV est un snapshot immuable au hash calculé par la base ; les signatures portent ce hash ; la signature complète passe PV et séance à `SIGNED` ; une réouverture remplace le PV (version n+1) sans l'effacer.
- **R-C8.** Les décisions des familles `PASSAGE` et `REPEAT` sont **propagées** à `results` (seule source lue par `academic` et `reportcards`) ; les autres restent dans `councils` et produisent leurs effets propres ; une décision d'exclusion n'est **jamais appliquée automatiquement**.
- **R-C9.** Les appréciations et distinctions acceptées sont écrites dans `results` (jamais dupliquées) ; le texte figé figure au PV.
- **R-C10.** Un élève ne figure qu'une fois par séance ; une séance ne se supprime pas (annulation motivée) ; les participants ne se retirent que d'une séance planifiée.

### 5.2 Vie scolaire

- **R-V1.** Aucune suppression ; correction = transition motivée ou nouvelle ligne ; historique automatique en ajout seul.
- **R-V2.** Le **type** (donnée) porte validation, séparation des tâches, partage aux familles, confidentialité plancher, recours, dates ; la **famille** (`INCIDENT`, `SANCTION`, `WARNING`, `ENCOURAGEMENT`, `TEMP_EXCLUSION`, `OBSERVATION`) est une énumération (elle pilote les tables) ; aucun type n'est comparé par libellé.
- **R-V3.** La confidentialité (`STANDARD` < `RESTRICTED` < `CONFIDENTIAL`) ne s'**abaisse** jamais ; un élément `CONFIDENTIAL` n'est jamais visible d'une famille ; sa lecture est **journalisée avec un motif**.
- **R-V4.** La famille d'un type utilisé ne change plus (on désactive et on crée).
- **R-V5.** Barème de conduite = **paramètre** versionné et figé ; solde dérivé ; registre en ajout seul ; la note de bulletin reste une saisie humaine.
- **R-V6.** Les retards et absences vivent dans `attendance` ; aucune équivalence retards/absences n'est codée.
- **R-V7.** Une exclusion temporaire est une mesure validée avec dates ; son application au **statut de l'élève** (`SUSPENDED`) et à l'**assiduité** est un acte explicite (port `people`, événement pour `attendance`, Q6-19) ; une **exclusion définitive** est un changement de statut `EXCLUDED` par un humain habilité, après décision du conseil ou de l'instance de discipline.
- **R-V8.** Aucune durée légale n'est codée : la conservation est un paramètre (`retention_days`, NULL = non défini) ; au terme, anonymisation de l'élève plutôt que suppression des comptages.

### 5.3 Orientation

- **R-O1.** Séries, options, langues = données d'`academic` ; `orientation_paths` = données du tenant, **vides par défaut**.
- **R-O2.** Un transfert de série n'existe que par une décision humaine et un parcours autorisé (ou une dérogation motivée).
- **R-O3.** Le dossier d'orientation ne s'applique pas sans l'accord de la famille quand le parcours l'exige.
- **R-O4.** Les options choisies sont des sélections `OPTION` d'`academic`.

### 5.4 Affectation par l'État

- **R-A1.** Un dossier vivant par inscription ; référence unique par établissement et année ; contenu figé à la vérification ; avenant = nouvelle version.
- **R-A2.** Vérification, activation, rejet, suspension, fin sont des **actes humains** ; l'enregistrant ne vérifie pas son propre dossier (réglage).
- **R-A3.** Les montants déclarés (acte) et facturés (`finance`) sont **distincts** ; leur écart se calcule et se qualifie en base selon la tolérance d'établissement.
- **R-A4.** La référence d'affectation de `academic.enrollments` provient du dossier **vérifié** : une seule source.
- **R-A5.** L'intégration avec une plateforme publique passe par un **port** ; aucun appel externe en V1.
- **R-A6.** Les créances, reçus, paiements de l'État sont ceux de `finance` ; `stateassign` n'écrit aucun montant facturé.

### 5.5 Sécurité et périmètre

- **R-X1.** Toute lecture est filtrée par le périmètre du contexte (`institutionId`, `campusId`) en plus de la RLS ; 404 hors périmètre.
- **R-X2.** Opérations sensibles (MFA + audit) : décision du conseil, signature du PV, déverrouillage (approbation), application d'une exclusion, validation d'une sanction ou d'une exclusion temporaire, révocation d'une mesure, décision de recours, lecture d'un élément confidentiel, activation d'un barème, ajustement de points, vérification et avenant d'une affectation, dérogation de parcours.
- **R-X3.** Données de mineurs : `Cache-Control: no-store`, aucune donnée disciplinaire ni note dans les journaux d'application ni dans les événements (identifiants et codes seulement), export contrôlé et audité.

## 6. Modèle de données

Voir `data-model.md` (37 tables, DDL testé). Plages de migrations : `councils` 1800-1804 et `schoollife` 1900-1902 (proposées) ; **`stateassign` : 2300-2303** (plage 2300-2399 attribuée, les numéros 2000-2001 sont obsolètes). `stateassign` compte 8 tables (voir `data-model.md` §5.11).

| Schéma | Tables |
|---|---|
| `councils` (18) | `participant_roles`, `council_types`, `decision_types`, `settings`, `councils`, `participants`, `agenda_items`, `proposals`, `decisions`, `effects`, `minutes`, `minute_signatures`, `unlock_requests`, `events`, `orientation_paths`, `orientation_files`, `orientation_wishes`, `series_transfers` |
| `schoollife` (14) | `settings`, `severity_levels`, `event_types`, `conduct_scales`, `conduct_scale_items`, `incidents`, `incident_involvements`, `measures`, `measure_appeals`, `notes`, `convocations`, `conduct_movements`, `life_events`, `confidential_reads` |
| `stateassign` (8) | `settings`, `assignments`, `controls`, `documents`, `assignment_events`, `receivables`, `receivable_events`, `export_formats` |

### 6.1 Cycle de vie d'une séance

```
PLANNED ──ouverture (président présent, quorum ou dérogation)──► OPEN ──clôture──► CLOSED ──toutes signatures──► SIGNED
   │                                                                │  ▲                                            │
   └──annulation motivée──► CANCELLED ◄─────────────────────────────┘  └──── déverrouillage motivé approuvé ◄────────┘
```

### 6.2 Cycle de vie d'une mesure

```
PROPOSED ─validation (autre personne si quatre yeux)─► VALIDATED ─► NOTIFIED ─► EXECUTED ─┐
   │ ╲rejet / annulation                                  │ ╲annulation          │ ╲recours déposé      │
   ▼                                                      ▼                      ▼  ▼                    ▼
REJECTED / CANCELLED                                  CANCELLED               APPEALED ──maintenu──► EXECUTED
                                                                                  └──annulé──► REVOKED (motif)
```

### 6.3 Comment le pack exprime les trois cycles de vie « affectation »

```
RECEIVED ─vérification humaine (autre que l'enregistrant)─► VERIFIED ─► ACTIVE ⇄ SUSPENDED
   │                          │                                │             └──► ENDED | TRANSFERRED (date, motif)
   └──► REJECTED              └──► REJECTED          avenant : toute version non finale ─► SUPERSEDED, puis version n+1 (RECEIVED)
```

### 6.4 Moteur de règles du pack : mécanisme et jeu FICTIF

| Élément | Décision |
|---|---|
| Contrat utilisé | **`coef-semester@1`** (existant : `moyenne_matiere`, `moyenne_ponderee`, `moyenne_section`, `moyenne_annuelle`, `mention`, `decision_conseil`, `decision_fin_annee`, `distinction`, `appreciation_conseil`, `arrondi_affichage`, `rang`) pour les établissements à **deux périodes** ; le modèle de pack `academic` l'associe déjà aux deux cycles du secondaire. |
| Contrat demandé à 012 | **`secondary-annual@1`** : même pipeline pour **un nombre quelconque de périodes** (trimestres ou semestres) avec poids de période en paramètres (`poids_periodes`), sans `second_semestre` déduit ; nécessaire si l'établissement a trois trimestres (Q6-01). Aucune valeur n'est écrite ici : le contrat est une **structure**. |
| Jeu de règles livré | **`CI-SECONDARY-PLACEHOLDER` v1**, `educationSystem = SECONDARY`, `scope = national`, `source_kind = placeholder`, `source_reference = « Jeu de démonstration du pack Secondary — non réglementaire »`. Il **copie la forme et les valeurs de démonstration** de `CI-CLASSIC-SEMESTRE` v1 (pratique d'établissement du legacy, `012/rulesets-de-depart.md` §3) **à titre d'exemple fonctionnel uniquement**. Il **n'invente aucune règle officielle** (MGA, passage, redoublement, orientation, BEPC, BAC) et **ne contient aucune règle d'orientation** (la décision d'orientation est humaine, sans suggestion). |
| Garde-fous du `placeholder` | (1) Un jeu `placeholder` n'est **jamais publié comme règlement** et ne porte pas `regulation` ; (2) la mention « jeu de démonstration, non réglementaire » est **imprimée** sur tout PV, résultat de classe et bulletin issus de ce jeu et affichée dans les écrans de conseil ; (3) un tenant le **remplace** par une variante `institution` (gouvernance D5 : simulation, validation du super-admin) ou par le jeu `regulation` ; (4) le provisionneur n'active pas de conseil « officiel » sans choix explicite d'un jeu par la direction (un avertissement bloquant à la première ouverture de séance sous `placeholder`, désactivable par la direction avec trace). |
| Changement demandé à 012 | Ajouter la valeur `placeholder` aux `source_kind` des RuleSets / versions nationales (`regulation`, `institution`, `platform` aujourd'hui) et l'exposer dans `resolve` ; refuser sa publication nationale sous le type `regulation`. |
| Source des valeurs officielles | `regulatory-sources-needed.md` ; sans texte et sans exemple chiffré validé, **aucun** RuleSet `regulation` n'est écrit (processus de réception : 012 §8 des sources). |

## 7. Interfaces publiées et ports

Tout appel inter-modules passe par l'`index.ts` public du module ; DTO dans `packages/contracts/src/v2/*`. Signatures conceptuelles `(ctx, input) → Result<T, AppError>` ; **les noms ci-dessous sont figés** pour les specs voisines.

### 7.1 Identifiants stables

`councils.councils.id` (CouncilId) · `councils.decisions.id` (DecisionId) · `councils.minutes.id` (MinutesId) · `schoollife.measures.id` (MeasureId) · `schoollife.incidents.id` · `stateassign.assignments.id` (AssignmentId, une version par ligne). Références vers `academic`/`people` : UUID sans FK.

### 7.2 Fonctions exportées

| Module | Fonctions | Consommateurs |
|---|---|---|
| `councils` | `getCouncil`, `listCouncils`, `getCouncilDecisionsForEnrollment(ctx, {enrollmentId, yearId})`, `getOrientationFile(ctx, enrollmentId)`, `getCouncilSummaryForClassroom` | 013 (bulletin : appréciation, distinctions, décision), 018, 025, portails |
| `schoollife` | `getStudentLifeSummary(ctx, {studentId, yearId})` (comptages), `getClassroomLifeSummary(ctx, {classroomId, periodId})`, `getConductPoints(ctx, {enrollmentId, periodId})`, `getDisciplineFacts(ctx, {enrollmentId})`, `audienceMaySee` (règle de visibilité), `isStudentExcludedOn(ctx, {enrollmentId, date})` | `councils`, 013, 018, 010 (exclusion), 025 |
| `stateassign` | `getAssignmentFacts(ctx, {enrollmentId})` (statut, référence présente, vérifiée), `listAssignmentsByStatus`, `getAssignment` | 013 (indicateur « Affecté(e) »), 014 (reporting), 018, 025 |

### 7.3 Ports déclarés par les modules du pack (implémentés par les voisins, branchés dans `platform/adapters`)

| Port (déclaré par) | Contrat minimal | Fournisseur |
|---|---|---|
| `ResultsReadPort` (councils) | `getStateView(classroomId, periodId)`, `getClassMatrix`, `listDecisions({stateId, status:'PROPOSED'})`, `listAppreciations`, `getFinalResult` | `results` |
| `ResultsWritePort` (councils) | `openDeliberation(stateId, kind:'COUNCIL')`, `markDeliberationHeld(id, heldOn)`, `publishYearDecision(enrollmentId, finalCode, deliberationId, justification?)` (crée ou confirme la décision de portée année), `writeAppreciation(role:'COUNCIL')`, `recordDistinction` | `results` (demande §7.4) |
| `AttendanceSummaryPort` (councils, schoollife, stateassign) | `getClassroomAttendanceSummary`, `getAttendanceSummary`, `listAbsences` | `attendance` |
| `RosterPort`, `EnrollmentPort` (councils, schoollife, stateassign) | `getRoster`, `getEnrollment` (élève, classe, programme, niveau, financement) | `academic` |
| `EnrollmentOutcomePort` (councils) | `recordEnrollmentOutcome({outcomeCode, targetProgramId?, targetGradeLevelId?})`, `transferEnrollment` | `academic` |
| `EnrollmentFundingPort` (stateassign) | `changeEnrollmentFunding(STATE_ASSIGNED, reference)` | `academic` |
| `StaffAssignmentPort` (councils) | `listAssignmentsForClassroom` (HOMEROOM, LEAD, SUPERVISOR) | `people` |
| `PersonDirectory`, `GuardianshipPort` (tous) | noms figés, `isGuardianOfStudent`, `listGuardiansOfStudent` | `people` |
| `StudentStatusPort` (councils, schoollife) | `changeStudentStatus(SUSPENDED \| EXCLUDED, reason)` — appelé **uniquement** par un acte d'utilisateur habilité | `people` |
| `NotificationPort` (councils, schoollife, stateassign) | `notify({template, recipients, data})` → `notificationRef` | `messaging` (`NotificationChannel`) |
| `DocumentRenderPort` (councils) | `render({kind:'COUNCIL_MINUTES', snapshot, templateKey})` → objet PDF scellé | `reportcards` (`DocumentRenderer`) |
| `StoragePort` (councils) | URL signée de dépôt (signatures papier) et de lecture | plateforme |
| `FinancePort` (stateassign) | `getLearnerStanding`, `getLinkedInvoicesTotals(scholarshipId)`, `getBilledAmounts({enrollmentId})` | `finance` |
| `StateAssignmentGateway` (stateassign) | `fetchAssignment(reference)`, `pushAttendanceCertificate(...)` — **adaptateur par défaut `NotConfigured`** | futur (PRD §20, P3) |
| `AuditPort` (tous) | `record(tx, …)` | `audit` |

Un port non câblé a un **comportement de repli sûr et explicite** (échec fermé `*.port_unavailable` pour toute écriture ; lectures optionnelles dégradées avec avertissement) documenté dans `plan.md`.

### 7.4 Interfaces demandées aux autres specs (à acter)

- **012-rules-engine** : valeur `placeholder` de `source_kind` ; contrat `secondary-annual@1` ; exposition du `label_map` des codes de suggestion pour préremplir l'appréciation.
- **011-assessments-grades** : port d'écriture `ResultsWritePort` (§7.3) ; accepter qu'une délibération soit ouverte et marquée `HELD` par `councils` ; autoriser `author_role = COUNCIL` via le port ; autoriser une décision de portée année créée par `councils` pour un code permis par le contrat ; événement `results.decision.confirmed` inchangé.
- **013-report-cards** : type de document `COUNCIL_MINUTES` (schéma `council-minutes/1`, gabarit plateforme `council-minutes`) ; le snapshot de bulletin lit `councils.getCouncilDecisionsForEnrollment` (appréciation générale, distinctions) et le type de financement pour « Affecté(e) » ; mention `placeholder` imprimée.
- **004-academic-core** : `terminalExamRequired` sur `3E` et `TLE` du modèle de pack (à confirmer, Q6-27) ; transfert d'un élève entre programmes d'un même niveau en cours d'année ; `changeEnrollmentFunding` appelable par `stateassign` ; sections `councils`/`schoollife` du modèle de pack via `tenancy.getPackTemplateSection`.
- **008/009-people** : statuts `SUSPENDED`/`EXCLUDED` appelés par un acte humain ; `listAssignmentsForClassroom` ; rôle `HOMEROOM`.
- **010-attendance** : consommer `schoollife.measure.validated` (famille `TEMP_EXCLUSION`) pour qualifier les absences de la période d'exclusion (motif configurable, Q6-19) ; `attendance.alert.triggered` peut ouvrir une **suggestion** de convocation.
- **016-communications** : gabarits `council.convocation`, `schoollife.convocation`, `schoollife.measure.notified`, rappels ; canaux externes à venir.
- **018-examinations** : consomme `getExamEligibilityFacts` et `getDisciplineFacts` ; publie `examinations.candidate.registered`, `examinations.result.published` (⚠ à aligner).
- **002-auth-rbac** : permissions (§10), rôles système (`educateur` : `schoollife.*` de saisie ; `directeur_etudes` : `council.*` ; `enseignant` : `council.proposal.write`, `schoollife.incident.write`, `schoollife.note.write`, `schoollife.read` limité à ses classes ; `parent`/`eleve` : `*.child.*`/`*.self.*`).
- **001/003-tenancy** : sections `councils` et `schoollife` du modèle de pack ; entitlements `councils.core`, `schoollife.core`, `stateassign.core`.

## 8. Endpoints

Préfixes `/api/v1/councils`, `/api/v1/schoollife`, `/api/v1/stateassign` (plugins Fastify, routes sans préfixe, schémas Zod de `packages/contracts/src/v2/*`). Conventions : erreurs `{ status, code, kind, message, issues?, requestId }`, codes `councils.*` / `schoollife.*` / `stateassign.*` stables, entrées strictes, pagination `page/pageSize ≤ 200`, aucun `500` pour une violation de contrainte prévisible (les messages de la base sont traduits en codes), `Cache-Control: no-store`.

### 8.1 `councils`

| Méthode | Chemin | Description | Permission |
|---|---|---|---|
| GET / PUT | `/participant-roles`, `/council-types`, `/decision-types`, `/settings` | Référentiels et réglages | `council.read` / `council.settings.manage` |
| GET / POST | `/councils` | Lister / créer un conseil (classe, période, type, date) | `council.read` / `council.manage` |
| GET / PATCH | `/councils/:id` | Détail / modifier (planifié) | idem |
| POST | `/councils/:id/{prepare,convoke,open,close,cancel}` | Cycle de la séance | `council.manage` ; `open`/`close` : `council.session.run` |
| GET / POST / PATCH / DELETE | `/councils/:id/participants` ; POST `/participants/:pid/presence` | Participants, présence | `council.manage` |
| GET | `/councils/:id/agenda`, `/agenda/:itemId` | Ordre du jour et fiche élève (faits figés) | `council.read` |
| POST | `/agenda/:itemId/{rebuild,review}` | Reconstruire l'instantané (refusé sous décision) / marquer examiné | `council.prepare` |
| GET / POST | `/agenda/:itemId/proposals` ; POST `/proposals/:id/{accept,reject,withdraw}` | Propositions et leur résolution humaine | `council.proposal.write` ; résolution : `council.decision.record` |
| GET / POST | `/agenda/:itemId/decisions` ; POST `/decisions/:id/withdraw` | Décisions (acte humain) | `council.decision.record` (sensible) |
| POST / GET | `/councils/:id/minutes` ; `/minutes/:id` ; `/minutes/:id/pdf` | Générer / lire / URL signée du PDF | `council.minutes.generate` / `council.minutes.read` |
| POST | `/minutes/:id/sign` ; `/minutes/:id/signatures/paper` ; `/minutes/:id/revoke` | Signer, déposer une signature papier, révoquer | `council.minutes.sign` (sensible) ; `council.minutes.revoke` (sensible) |
| POST | `/councils/:id/unlock-requests` ; `/unlock-requests/:id/{approve,reject}` ; `/councils/:id/reopen` | Déverrouillage motivé | `council.unlock.request` ; `council.unlock.approve` (sensible, MFA) ; `council.unlock.approve` |
| GET / POST | `/councils/:id/effects` ; `/effects/:id/{retry,apply,revert}` | File d'effets ; application humaine de l'exclusion | `council.effect.manage` ; `apply` d'une exclusion : `council.exclusion.apply` (sensible) |
| GET | `/councils/:id/events` | Journal de séance | `council.read` |
| GET / PUT | `/orientation-paths` | Parcours autorisés | `council.orientation.read` / `.manage` |
| GET / POST | `/orientation-files` ; POST `/orientation-files/:id/{wishes,consent}` | Dossier, vœux, accord de la famille | `council.orientation.read` / `.manage` ; vœux : `council.child.read` + lien |
| POST | `/series-transfers` ; `/series-transfers/:id/{apply,cancel}` | Transfert de série | `council.orientation.manage` ; dérogation : `council.orientation.override` (sensible) |
| GET | `/classrooms/:id/council-summary` | Synthèse pour la direction | `council.read` |
| GET | `/me/decisions`, `/children/:studentId/decisions` | Portails (selon `guardian_visibility`) | `council.self.read` / `council.child.read` + lien (404 hors lien) |

### 8.2 `schoollife`

| Méthode | Chemin | Description | Permission |
|---|---|---|---|
| GET / PUT | `/settings`, `/severity-levels`, `/event-types` | Paramètres | `schoollife.read` / `schoollife.settings.manage` |
| GET / POST | `/incidents` ; GET `/incidents/:id` ; POST `/incidents/:id/{review,confirm,dismiss,close,involvements}` | Incidents | `schoollife.incident.write` ; instruction : `schoollife.incident.review` |
| GET / POST | `/measures` ; POST `/measures/:id/{validate,reject,cancel,notify,execute,revoke}` | Mesures | `schoollife.measure.propose` ; `validate` : `schoollife.measure.validate` ou `schoollife.exclusion.validate` (sensibles) ; `revoke` : `schoollife.measure.revoke` (sensible) |
| POST | `/measures/:id/appeals` ; `/appeals/:id/{uphold,overturn,withdraw}` | Recours | `schoollife.appeal.file` ; `schoollife.appeal.decide` (sensible) |
| GET / POST | `/notes` ; POST `/notes/:id/withdraw` | Encouragements, observations | `schoollife.note.write` |
| GET / POST | `/convocations` ; POST `/convocations/:id/{send,acknowledge,hold,no-show,cancel,reschedule}` | Convocations | `schoollife.convocation.manage` ; accusé : tuteur (`schoollife.child.read` + lien) |
| GET / POST | `/conduct-scales` ; PUT `/conduct-scales/:id/items` ; POST `/conduct-scales/:id/{activate,retire}` | Barèmes | `schoollife.conduct.manage` (activation sensible) |
| GET / POST | `/students/:id/conduct` ; `/conduct-movements` | Solde dérivé ; ajustement manuel | `schoollife.read` ; `schoollife.conduct.adjust` (sensible) |
| GET | `/students/:id/life`, `/classrooms/:id/summary`, `/students/:id/absences` | Fiche de vie scolaire (avec **vue** d'`attendance`), synthèse de classe | `schoollife.read` (périmètre de classe pour un enseignant) |
| GET | `/me/life`, `/children/:studentId/life` | Portails (règle `audience_may_see`) | `schoollife.self.read` / `schoollife.child.read` + lien |

### 8.3 `stateassign`

| Méthode | Chemin | Description | Permission |
|---|---|---|---|
| GET / PUT | `/settings` | Réglages | `stateassign.read` / `stateassign.settings.manage` |
| GET / POST | `/assignments` ; GET `/assignments/:id` | Dossiers | `stateassign.read` / `stateassign.record` |
| POST | `/assignments/:id/{verify,reject,activate,suspend,resume,end,transfer-out}` | Cycle de vie (actes humains) | `stateassign.verify` / `stateassign.manage` (sensibles) |
| POST | `/assignments/:id/amend` | Avenant : remplace puis crée la version n+1 | `stateassign.amend` (sensible) |
| POST | `/assignments/:id/reconcile` | Rapprochement (aussi par job) | `stateassign.reconcile` |
| GET / POST | `/assignments/:id/controls` ; POST `/controls/:id/{complete,waive,resolve}` | Contrôles | `stateassign.control.perform` |
| GET / POST | `/assignments/:id/documents` ; POST `/documents/:id/withdraw` | Références de pièces | `stateassign.document.manage` |
| GET | `/reports/reconciliation`, `/reports/controls-due` | États de suivi | `stateassign.read` |
| GET | `/children/:studentId/assignment` | Portail parent (statut seulement, jamais les montants de l'État) | `stateassign.child.read` + lien |

## 9. Écrans

Portail admin (`/admin/conseils/*`, `/admin/vie-scolaire/*`, `/admin/affectes/*`, route group `(admin)` de 033) ; portail enseignant ; portail parent ; portail élève. Menus générés depuis les manifestes ; **aucune logique métier dans le web** (les écrans affichent valeurs et codes de l'API).

| Écran | Contenu | Rôles |
|---|---|---|
| **Conseils — planning** | Calendrier des séances par classe et période, état (planifié / ouvert / clos / signé), état des résultats de la classe, alerte « conseil à revoir » | Directeur des études, direction |
| **Conseil — préparation** | Participants proposés et convocations, rôles, présence ; ordre du jour par élève avec résultats, absences, vie scolaire (comptages), suggestions de règles **clairement étiquetées « suggestion »**, mention « jeu de démonstration » si applicable | Secrétariat, professeur principal |
| **Conseil — séance** | Fiche élève (faits figés, version), propositions (appréciation, distinction, décision), saisie de la décision avec décideur, mode (consensus / vote), justification en cas d'écart, retrait motivé ; bandeau quorum ; mode mobile | Président, secrétaire, professeur principal |
| **Conseil — clôture et PV** | Contrôles de clôture, génération du PV, aperçu, signatures (électronique / papier), état des signataires, téléchargement | Secrétariat, président |
| **Conseil — déverrouillage** | Demande motivée, approbation, historique des réouvertures | Direction |
| **Conseil — effets** | File des effets par décision (`PENDING`, `FAILED`, `AWAITING_HUMAN`, `APPLIED`), reprise, application humaine d'une exclusion (avec confirmation) | Direction, directeur des études |
| **Orientation** | Parcours autorisés, dossiers par niveau de fin de cycle, vœux, accord de la famille, avis du conseil, transferts de série, dérogations | Directeur des études, conseiller d'orientation |
| **Vie scolaire — tableau de bord** | Incidents ouverts, mesures à valider, exclusions en cours, convocations à tenir, anomalies ; filtres classe / niveau | Éducateur, direction |
| **Fiche vie scolaire d'un élève** | Chronologie (incidents, mesures, notes, convocations), absences et retards (vue d'`attendance`), points de conduite, historique ; éléments `CONFIDENTIAL` masqués avec bouton « lire (motif) » journalisé | Éducateur, direction, enseignant (sa classe, niveau standard) |
| **Déclarer un incident / saisir une observation** | Formulaires courts (mobile, hors-ligne) | Enseignant, éducateur |
| **Mesures — validation** | File de validation, comparaison proposant / validateur, notification aux familles, recours | Direction |
| **Convocations** | Création, envoi, accusés, comptes rendus, rappels | Éducateur, secrétariat |
| **Barèmes de conduite** | Brouillon, valeurs par type, activation, retrait, solde par élève, marquage « démonstration » | Direction |
| **Affectés par l'État — dossiers** | Liste par statut, fiche (référence, autorité, montants déclarés vs facturés, écart, contrôles, documents, historique des versions), avenant, vérification | Secrétariat, économe, direction |
| **Affectés — contrôles et rapprochement** | Contrôles à faire, anomalies, écarts par dossier, tolérance | Économe |
| **Parent / élève** | « Décisions du conseil », « Vie scolaire » (selon `audience_may_see`), convocations (accusé de réception), recours, vœux d'orientation, accord de la famille | Parent, élève |

Accessibilité et mobile : tables à défilement, actions principales utilisables sur smartphone ; textes via catalogues i18n `fr-CI` ; contraste et navigation clavier ; aucune donnée confidentielle en cache hors ligne.

## 10. Permissions (déclarées dans les `manifest.ts`)

| Clé | Libellé | Sensible |
|---|---|---|
| `council.read` | Consulter conseils, ordres du jour, décisions | |
| `council.manage` | Planifier, convoquer, composer, annuler un conseil | |
| `council.prepare` | Préparer l'ordre du jour, reconstruire un instantané | |
| `council.session.run` | Ouvrir et clore une séance | oui |
| `council.proposal.write` | Proposer appréciations, distinctions, décisions | |
| `council.decision.record` | Enregistrer et retirer une décision, résoudre une proposition | **oui** |
| `council.minutes.generate` / `council.minutes.read` | Générer / lire les procès-verbaux | non / non |
| `council.minutes.sign` | Signer un procès-verbal | **oui** |
| `council.minutes.revoke` | Révoquer un procès-verbal | **oui** |
| `council.unlock.request` / `council.unlock.approve` | Demander / approuver un déverrouillage | non / **oui** (MFA) |
| `council.effect.manage` | Suivre et relancer les effets | |
| `council.exclusion.apply` | Appliquer l'effet d'une décision d'exclusion (avec `student.status.update`) | **oui** |
| `council.settings.manage` | Types de conseil, rôles, types de décision, réglages | oui |
| `council.orientation.read` / `council.orientation.manage` | Orientation : lire / gérer dossiers et transferts | non |
| `council.orientation.override` | Déroger à un parcours autorisé | **oui** |
| `council.self.read` / `council.child.read` | Décisions de l'élève / de ses enfants | |
| `schoollife.read` | Lire la vie scolaire (niveau standard ; classes de l'enseignant) | |
| `schoollife.restricted.read` | Lire le niveau restreint | oui |
| `schoollife.confidential.read` | Lire un élément confidentiel (journalisé, motif) | **oui** (MFA) |
| `schoollife.incident.write` / `schoollife.incident.review` | Déclarer / instruire un incident | non |
| `schoollife.measure.propose` | Proposer une mesure | |
| `schoollife.measure.validate` / `schoollife.exclusion.validate` | Valider une sanction / une exclusion temporaire | **oui** |
| `schoollife.measure.revoke` | Révoquer une mesure | **oui** |
| `schoollife.appeal.file` / `schoollife.appeal.decide` | Déposer / trancher un recours | non / **oui** |
| `schoollife.note.write` | Rédiger encouragements et observations | |
| `schoollife.convocation.manage` | Convoquer les tuteurs | |
| `schoollife.conduct.manage` | Gérer les barèmes (activation sensible) | oui |
| `schoollife.conduct.adjust` | Ajustement manuel de points | **oui** |
| `schoollife.settings.manage` | Types d'événements, gravités, réglages | oui |
| `schoollife.self.read` / `schoollife.child.read` | Vie scolaire partageable de l'élève / de ses enfants | |
| `stateassign.read` | Consulter les dossiers d'affectation | |
| `stateassign.record` | Enregistrer un dossier | |
| `stateassign.verify` | Vérifier ou rejeter un dossier | **oui** |
| `stateassign.manage` | Activer, suspendre, terminer, transférer | **oui** |
| `stateassign.amend` | Avenant (nouvelle version) | **oui** |
| `stateassign.reconcile` | Rapprocher avec la facturation | |
| `stateassign.control.perform` | Réaliser un contrôle | |
| `stateassign.document.manage` | Gérer les références de pièces | |
| `stateassign.settings.manage` | Réglages | oui |
| `stateassign.child.read` | Statut de l'affectation de son enfant | |

Alignement avec les modèles de rôles système : `directeur_etudes` (`council.*` hors approbation de déverrouillage, `schoollife.read`, `stateassign.read`), `directeur` / `owner` (`*`), `secretariat` (`council.manage`, `council.minutes.*`, `stateassign.record`, `stateassign.document.manage`), `educateur` (`schoollife.*` de saisie, `schoollife.convocation.manage`, **sans** validation), `enseignant` (`council.proposal.write`, `schoollife.incident.write`, `schoollife.note.write`, `schoollife.read` limité à ses classes), `econome` (`stateassign.read`, `stateassign.reconcile`, `stateassign.control.perform`), `parent` (`*.child.*`), `eleve` (`*.self.*`). **Aucun contrôle de rôle codé en dur.**

Features (`manifest.features`, packs `SECONDARY`) : `councils.core`, `councils.orientation`, `schoollife.core`, `schoollife.conduct-points`, `schoollife.convocations`, `stateassign.core` (même logique que `finance.state-assigned` et `academic.state-assigned`), `stateassign.gateway` (réservée, désactivée en V1). Les modules sont déclarés `packs: ["SECONDARY"]` ; `councils` et `schoollife` sont **agnostiques du pack** (types en données) et pourront être ouverts au pack `PRIMARY` (conseil des maîtres, spec 005) sans changement de schéma.

## 11. Événements (outbox, `{ v: 1, … }`, sans note, texte libre ni donnée confidentielle)

| Événement | Producteur | Consommateurs prévus |
|---|---|---|
| `councils.council.created` / `convoked` / `opened` / `closed` / `signed` / `reopened` / `cancelled` | séance | `results` (délibération tenue), 013 (bulletins à rééditer après réouverture), 016, 025 |
| `councils.quorum.waived` | ouverture sans quorum | direction, audit |
| `councils.decision.recorded` / `withdrawn` | décisions | 025, 018 (faits) |
| `councils.minutes.generated` / `rendered` / `signed` / `superseded` / `revoked` | PV | worker (rendu), 016, audit |
| `councils.unlock.requested` / `approved` / `rejected` | déverrouillage | direction (cloche), audit |
| `councils.effect.applied` / `failed` / `reverted` / `awaiting_human` | effets | direction (cloche), `academic`, `people` |
| `councils.orientation.file_decided` / `councils.series_transfer.planned` / `applied` / `cancelled` | orientation | `academic`, 016 |
| `schoollife.incident.declared` / `status_changed` | incidents | direction, 025 |
| `schoollife.measure.proposed` / `validated` / `notified` / `executed` / `revoked` / `rejected` / `cancelled` | mesures | 016 (famille), 010 (exclusion), 025, `councils` (information) |
| `schoollife.appeal.filed` / `decided` | recours | direction, 016 |
| `schoollife.note.created` / `withdrawn` | notes | 025 |
| `schoollife.convocation.sent` / `acknowledged` / `held` / `no_show` / `cancelled` | convocations | 016, direction |
| `schoollife.conduct.movement_recorded` | points | 025 |
| `stateassign.assignment.received` / `verified` / `activated` / `suspended` / `ended` / `superseded` / `rejected` | dossiers | 014, `academic` (financement), 016, 025 |
| `stateassign.control.due` / `performed` / `anomaly_detected` | contrôles | économe, direction |
| `stateassign.reconciliation.discrepancy` | rapprochement | économe |

Consommés : `results.period.locked|deliberated|closed|reopened` (alerte « conseil à revoir » si la période est rouverte sous un conseil signé), `results.decision.confirmed` (rapprochement avec les décisions du conseil), `academic.enrollment.created|transferred|withdrawn|cancelled` (ordre du jour à reconstruire avant ouverture, dossier d'affectation à clôturer), `academic.enrollment.funding_changed`, `people.student.status_changed`, `people.staff.deactivated` (participants), `attendance.alert.triggered` (suggestion de convocation), `finance.invoice.paid|overdue` (rapprochement), `examinations.candidate.registered|result.published` ⚠, `tenancy.tenant.provisioned` (modèles de pack). **Consommateurs idempotents** par `event.id` (ADR-004). Jobs : `councils.apply-effects` (30 s), `councils.render-minutes` (worker, à `councils.minutes.generated`), `councils.expire-unlock-requests` (quotidien, motif `EXPIRED` au-delà du délai paramétré), `schoollife.remind-convocations` (horaire), `schoollife.exclusion-boundaries` (quotidien : notifie début et fin d'exclusion), `stateassign.plan-controls` (quotidien), `stateassign.reconcile` (nocturne ou à `finance.invoice.paid`).

## 12. Tests

- **Comportement du DDL (exécuté)** : `ddl-test/` — 85 tests sur PostgreSQL 17 (acteur humain, quorum, signatures, déverrouillage, séparation des tâches, exclusions sans chevauchement, barèmes, rapprochement, RLS, concurrence). Bloquant.
- **Isolation générique (spec 000, bloquant)** : 37 tables, trois allowlists vides.
- **Unitaires purs (Vitest)** : machines d'états (séance, mesure, recours, convocation, barème, affectation, effets) en miroir de la base (test de parité SQL ↔ domaine), règle `audience_may_see`, calcul de solde de conduite (miroir de `conduct_balance`), construction de l'instantané `council-facts/1` (aucun flottant ; aucun calcul), construction du PV (snapshot déterministe, aucun flottant, mention `placeholder`), mapping décision → effets, validation des types de décision (codes permis par le contrat), génération des participants proposés.
- **Intégration (Postgres jetable, `TEST_DATABASE_URL`)** : parcours complet **préparer → convoquer → ouvrir → décider → clore → PV → signer → effets → réouverture motivée → reclôture (version 2)** ; concurrence (deux signataires, deux créations de conseil, deux validations d'exclusions chevauchantes) ; adaptateurs réels `results`, `academic`, `people`, `attendance`.
- **Contrat de ports** : `ResultsWritePort`, `EnrollmentOutcomePort`, `FinancePort`, `NotificationPort`, `DocumentRenderPort` compilés contre les adaptateurs ; schémas Zod des événements.
- **Garde-fous de contenu (bloquant)** : (1) lint R2 : aucune constante de seuil dans `modules/{councils,schoollife,stateassign}/**` ; (2) lint « aucune liste de séries, langues, coefficients, types de sanction » dans le code ; (3) test « aucune valeur réglementaire par défaut » sur les modèles de pack (§AC13.3) ; (4) lint « aucune arithmétique sur les résultats » dans `councils` ; (5) `dependency-cruiser` : aucun import d'un autre module hors `index.ts`.
- **Golden / parité** : scénarios figés `classique-terminale`, `classique-nommage-periodes` de `tests/characterization` rejoués jusqu'à la décision de fin d'année pour établir que le conseil confirme **exactement** la suggestion lorsqu'il n'y déroge pas (`parity.md`).
- **Audit** : `expectAudited` pour décision, résolution, signature, ouverture/clôture, déverrouillage, application d'exclusion, validation de mesure, révocation, décision de recours, lecture confidentielle, activation de barème, ajustement de points, vérification et avenant d'affectation, dérogation de parcours ; `expectAuditRolledBack`.
- **Sécurité** : matrice d'autorisation (direction, directeur des études, secrétariat, professeur principal, enseignant de la classe, enseignant d'une autre classe, éducateur, économe, tuteur lié, tuteur non lié, élève, autre tenant) × (lecture, écriture, élément confidentiel, PV, effets) ; aucune donnée disciplinaire ni note dans les logs et événements ; URL signée expirée refusée.
- **Performance (CI dédiée)** : `prepareCouncil` 60 élèves p95 ≤ 3 s ; génération du PV 60 élèves ≤ 1 s ; fiche vie scolaire d'un élève p95 ≤ 200 ms (1 000 événements) ; 40 PV rendus ≤ 120 s.
- **E2E (Playwright)** : parcours « conseil de fin de période : de la préparation à la signature » (président, secrétaire), « incident → sanction proposée → validée par un autre → notifiée → recours », « affecté : enregistrement → vérification → rapprochement → contrôle » ; parent : lecture des décisions et convocations.

## 13. Cas limites

- **Classe de moins de deux enseignants présents** ou président absent : l'ouverture est refusée ; un président suppléant se désigne avant l'ouverture (changement de fonction), jamais pendant une décision en cours.
- **Élève inscrit après la préparation** ou quittant la classe : l'ordre du jour se reconstruit **avant** l'ouverture ; après l'ouverture, un élève ajouté tardivement l'est par un élément supplémentaire créé en séance (autorisé tant qu'aucune décision ne repose sur la classe entière), sinon réouverture motivée.
- **Mutation de classe en cours de période** : un élément par **inscription** (un élève peut figurer dans deux conseils) ; ses faits ne reprennent que les résultats de l'inscription concernée (Q-39 de 012).
- **Élève redoublant** : l'instantané porte le drapeau issu des inscriptions (`academic`), jamais d'un texte.
- **Résultats rouverts après signature** : alerte, réouverture explicite du conseil (demande motivée), effet appliqué à annuler d'abord ; un bulletin déjà publié est réédité par 013.
- **Décision de redoublement dont l'effet a déjà alimenté la reconduction de l'année suivante** : effet `irreversible` → déverrouillage refusé (`councils.effect_irreversible`) ; correction par une décision de direction hors conseil, tracée (`DIRECTOR_ACT`).
- **Participant dont la fiche change après la convocation** : le PV garde le nom figé.
- **Signataire absent** : un PV ne se signe que par des participants **présents** ; si un signataire exigé est absent, l'absence est consignée et le type de conseil doit prévoir un suppléant (rôle) ; sinon déverrouillage motivé pour corriger la présence.
- **Deux sessions simultanées** sur la même séance : verrous de ligne et `row_version` ; la seconde échoue proprement.
- **Webhooks / jobs en panne** : les effets restent `PENDING`/`FAILED` et sont repris ; aucun effet n'est perdu ni appliqué deux fois (clé unique).
- **Exclusion décidée par le conseil mais non appliquée** : l'effet reste `AWAITING_HUMAN` ; alerte quotidienne ; aucune application automatique, jamais.
- **Exclusion temporaire pendant une évaluation** : l'absence est qualifiée par la règle de l'établissement (Q6-19) ; aucune note n'est générée automatiquement.
- **Mesure sur un élève d'une classe annulée** : la mesure reste attachée à l'inscription ; lecture seule.
- **Famille sans accès portail** : la convocation est imprimable ; l'accusé de réception se saisit par le secrétariat (`ACKNOWLEDGED` par un utilisateur, référence du tuteur).
- **Élément confidentiel et transfert d'élève vers un autre établissement du groupe** : la confidentialité s'applique à l'établissement d'origine ; aucun transfert de données disciplinaires sans demande explicite (Q6-17).
- **Affecté qui change de classe** : le dossier suit l'**inscription** ; un changement d'inscription (autre année) crée un nouveau dossier (la référence peut être reportée par l'humain).
- **Affecté dont la référence est refusée à la vérification** : `REJECTED` motivé ; l'inscription reste `PRIVATE` jusqu'à la vérification d'un nouveau dossier.
- **Rapprochement sans facture liée** : écart = montant déclaré ; statut `DISCREPANCY` ; alerte économe.
- **Données de mineurs, droit à l'effacement** : anonymisation de l'élève (`people`) ; les comptages et décisions restent sans identité ; le PV signé conserve les noms figés (valeur probante) — **arbitrage juridique** (Q6-17).
- **Fuseau** : instants en UTC, dates civiles de séance et d'exclusion en `date` d'établissement ; affichage `Africa/Abidjan`.
- **Établissement avec collège et lycée** : deux établissements (ou deux programmes) de même tenant ; un conseil par classe ; une même personne peut présider les deux.

## 14. Dépendances

- **En amont** : 000 (kernel, `TenantDb`, outbox), 001/003 (tenant, établissement, modèles de pack), 002 (RBAC, MFA, périmètres), 030 (audit), 004 (classes, périodes, inscriptions, issues, financement), 008/009 (élèves, tuteurs, affectations d'enseignement), 010 (présences), 011 (résultats, délibérations, décisions, appréciations), 012 (RuleSets, contrats ; **demandes §7.4**), 013 (rendu, signatures de document ; **demandes §7.4**), 014 (finance : bourses, factures liées, créances), 016 (notifications), worker (rendu, effets, rappels).
- **En aval** : 013 (bulletins : appréciation, distinctions, décision, « Affecté(e) »), 018 (faits), 025 (indicateurs), 005 (réutilisation de `councils` pour le conseil des maîtres), 029 (hors-ligne), 026 (assistant de rédaction, après V1).
- **Technique** : PostgreSQL 14+ (`btree_gist`, `sha256`), Zod, `@ecoledigitale/kernel|database`, worker, Redis (indirect), Puppeteer (via 013).
- **Points ouverts du plan (§8)** : n°5 (source des textes réglementaires et validateur des RuleSets Secondary) conditionne tout RuleSet `regulation` ; n°2 (fournisseur SMS) conditionne les convocations par SMS ; aucun autre bloquant.

## 15. Critères de sortie (mesurables)

La spec est terminée lorsque :

1. Les migrations 1800-1804, 1900-1902, 2000-2001 s'appliquent de zéro avec `migrator` ; le test d'isolation générique passe sur les **37 tables** avec deux tenants (zéro fuite) ; les trois allowlists sont vides ; les **85 tests de comportement** passent.
2. Un conseil de test parcourt **préparation → convocation → ouverture → décisions → clôture → PV → signatures → effets** : la décision de passage ou de redoublement apparaît dans `results.decisions`, l'issue dans `academic`, l'appréciation générale dans `results.appreciations` ; un acteur système ne peut ni décider, ni signer, ni appliquer une exclusion (tests sur les trois).
3. Un conseil signé est rouvert par une demande motivée approuvée par une autre personne ; le PV est remplacé (version 2) ; un effet appliqué bloque la réouverture tant qu'il n'est pas annulé.
4. Le PV est rendu par le worker depuis son snapshot ; le hash recalculé par la base égale le hash stocké pour 100 % des PV de test ; deux signatures simultanées donnent `SIGNED`.
5. Un incident → mesure proposée → validée par une autre personne → notifiée → recours (maintenu / annulé) est couvert ; deux exclusions temporaires validées ne se chevauchent pas ; un élément `CONFIDENTIAL` n'est jamais visible d'un parent ni d'un élève et sa lecture est journalisée.
6. Un barème de conduite se crée, s'active, se fige ; le solde dérivé égale la somme bornée des mouvements ; aucune note de conduite n'est calculée automatiquement.
7. Un dossier d'affectation est enregistré, vérifié par une autre personne, rapproché (statut calculé par la base), contrôlé ; un avenant produit la version 2 ; la référence d'affectation de `academic` provient du dossier vérifié.
8. Aucune série, langue, coefficient, type de sanction, barème, quorum, parcours d'orientation, durée de conservation n'est codé (lint + test des modèles de pack) ; le jeu de règles `placeholder` est marqué sur PV, résultats et bulletins.
9. Les demandes aux specs 004, 010, 011, 012, 013, 016, 018, 002 (§7.4) sont acceptées ou renvoyées en questions ouvertes ; aucune question réglementaire bloquante n'est résolue par une valeur inventée.
10. Le bulletin « classique » de référence (`tests/characterization`) est reproduit jusqu'à la décision de fin d'année ; les écarts assumés (indicateur « Affecté(e) », décisions par texte, moyennes saisies) figurent tous dans `parity.md`.
