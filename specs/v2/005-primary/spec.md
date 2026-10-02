# Feature Specification: Pack Primary — maternelle et primaire (005-primary)

**Feature Branch**: `005-primary`

**Created**: 2026-10-02

**Status**: Rédigée — DDL de référence exécuté et testé (118 tests de comportement, `ddl/`), prête pour `/speckit.plan`

**Sources**: `docs/PRD_EcoleDigitale_SaaS.md` §11, §12, §13, §14 (renvoyé à 018), §20 ; `docs/PLAN_Mise_en_oeuvre_EcoleDigitale_SaaS.md` §3.7, §3.8, §4 (Phase 4), §8 ; `specs/v2/DECISIONS-METIER.md` ; `docs/architecture/module-conventions.md` ; specs `004`, `008`, `009`, `010`, `011`, `012` (+ `regulatory-sources-needed.md`, `rulesets-de-depart.md`, `rule-contracts.md`), `013`, `014`, `016` ; READMEs des modules `academic`, `people`, `results`, `rules`, `reportcards`, `tenancy` ; `docs/inventory/`.

> **Règle absolue de cette spec.** Aucune règle réglementaire ivoirienne officielle n'est écrite ici : ni MGA, ni seuil de passage, ni condition de redoublement, ni composition du conseil des maîtres, ni quorum, ni coefficient officiel, ni référentiel de compétences officiel. Cette spec livre un **mécanisme** (modèle de pack en données, contrat de règles, tables, flux) et un **jeu FICTIF** (`source.kind = placeholder`), visible comme tel partout où il sert. Les textes à obtenir et les questions au propriétaire du produit sont dans `regulatory-sources-needed.md` et `open-questions.md`.

## 1. Principe : le pack Primary est une COMPOSITION, pas un moteur

Le legacy n'a **aucun** modèle primaire (plan D1 : « à créer de zéro »). La v2 n'ajoute pourtant pas un cinquième moteur : le primaire **assemble** les briques génériques déjà spécifiées, et ne construit que ce qui lui manque.

| Besoin du primaire | Brique réutilisée (spec / module) | Ce que 005 ajoute |
|---|---|---|
| Niveaux PS/MS/GS, CP1…CM2, périodes, programmes, classes, inscriptions, financement, reconduction annuelle, clôture et archivage de l'année | `academic` (004) : modèle de pack JSON `academic/templates/CI/primary.json`, `rollover`, `closeAcademicYear`, `archiveAcademicYear` | Compléments du modèle de pack (contrat de calcul, drapeaux) ; garde « classe active ⇒ titulaire » |
| Évaluations chiffrées (devoirs, interrogations, compositions), circuit de validation, publication | `assess` (011) : types de pack `classic` (`INTERROGATION`, `DEVOIR`, `COMPOSITION`…) | Rien (types de départ réutilisés tels quels) |
| Moyennes de matière et de période, rangs, mentions, décisions proposées, délibérations, clôture de période, résultats FINAL immuables, recalcul | `results` (011) + `rules` (012) | **Contrat de règles `coef-period@1`** (et `competency-period@1` pour la maternelle) + RuleSet **fictif** `CI-PRIMARY-PLACEHOLDER` ; aucune formule en code |
| Bulletin PDF signé, QR, versions, relevés | `reportcards` (013) | Gabarit « bulletin primaire » et « bilan annuel » (données), nature de document `COUNCIL_MINUTES`, filigrane « règles non officielles » |
| Appel **journalier**, justificatifs, récapitulatifs | `attendance` (010) : séances `DAILY`, `call_policies` | Politique d'appel du cycle (donnée du modèle de pack) |
| Instituteur, classe à titulaire unique | `people` (009) : `teaching_assignments` `HOMEROOM` + `covers_all_subjects` ; `rbac` | Rôle système `instituteur` (modèle de rôle), garde d'activation de classe |
| Frais d'inscription et de scolarité par niveau | `finance` (014) | Rien (barèmes = données du tenant) |
| Messages aux familles | `messaging` (016) | Rien |
| **Évaluation par compétences** (non chiffrée), échelles d'appréciation, banque d'appréciations | — (`assess` est numérique) | **Module `primary_school`** : référentiels de compétences versionnés, appréciations, révisions |
| **Conseil des maîtres** (dossier de séance, présence, procès-verbal) | `results.deliberations` (`kind = COUNCIL`) et `results.decisions` | Dossier de séance par élève, feuille de présence, génération du PV |
| **Bilan annuel** par élève, **archivage** de l'année | `results` (résultat d'année FINAL), `reportcards`, `academic` | Instantané scellé, versions, archive d'année gelée avec manifeste |
| États et rapports du primaire | lectures des modules ci-dessus | Catalogue de rapports (lecture seule, exports) |

**Conséquence de conception.** `primary_school` ne calcule rien (ni moyenne, ni rang, ni décision) ; il porte des **données pédagogiques** (compétences, appréciations), des **journaux** (révisions, présence au conseil) et des **instantanés** (bilan, archive). Son code ne contient aucun nombre issu d'un texte réglementaire (garde-fou R2 de la spec 000).

## 2. Objectifs

1. Un établissement du primaire est **opérationnel sans développeur** : à l'activation du pack, niveaux, périodes, types de financement, issues d'année, politique d'appel, types d'évaluation, rôle d'instituteur et gabarits sont instanciés **depuis des données** (§6).
2. L'instituteur gère **sa classe seul** : appel du jour, évaluations de toutes les matières, appréciations, compétences, dossier du conseil — depuis un smartphone.
3. L'évaluation **chiffrée** et l'évaluation **par compétences** coexistent (la maternelle n'a que la seconde, le primaire a les deux).
4. Les décisions de fin d'année passent par un **conseil des maîtres** tracé : la règle propose, le conseil confirme, la justification d'un écart est conservée (comportement de `results`).
5. Chaque élève reçoit un **bilan annuel** immuable, vérifiable (QR), et l'année est **archivée** de façon vérifiable.
6. Le **mécanisme** MGA / passage / redoublement existe et est testé de bout en bout avec un RuleSet **fictif** ; il suffira de publier le RuleSet officiel (donnée) pour passer en production réglementaire.

## 3. Périmètre

### Inclus

- Modèle de pack Primary complet en données (§6, `pack-template.md`).
- Module `primary_school` : échelles d'appréciation, référentiels de compétences versionnés, évaluation par compétences (saisie en lot idempotente, validation, révisions), banque d'appréciations, dossier et présence du conseil des maîtres, bilan annuel, archivage d'année, rapports.
- Contrats de règles `coef-period@1` et `competency-period@1`, RuleSet fictif `CI-PRIMARY-PLACEHOLDER`, jeux de golden tests **de mécanisme** (`rule-contract.md`).
- Rôle `instituteur`, garde « classe du primaire active ⇒ titulaire », usage de l'appel journalier.
- Gabarits de bulletin primaire et de bilan annuel (génériques), filigrane des règles non officielles.
- Portails : instituteur, direction, parent (lecture du bilan et des compétences publiés).

### Exclu (renvoyé)

| Sujet | Spec |
|---|---|
| Admissions, candidatures, liste d'attente | 007 |
| CEPE : candidats, éligibilité, numéro de candidat, centres, résultats, attestations, exports | 018 (CEPE = première instance) |
| Élèves affectés par l'État (`STATE_ASSIGNED`) : l'inscription porte déjà le type de financement (004) ; la fonction `academic.state-assigned` est déclarée pour le pack `SECONDARY` (question O-04 de 004) ; **non activée par défaut pour PRIMARY** | 004 / 014 (voir `open-questions.md` Q-P16) |
| Conseil de classe du secondaire | 006 (réutilise aussi `results.deliberations`) |
| Cantine, transport, bibliothèque | hors V1 |
| Règles officielles (MGA, passage, redoublement, quorum, coefficients, programmes officiels) | **attendent les textes** (`regulatory-sources-needed.md`) |
| Classes multigrades (plusieurs niveaux dans une classe) | question Q-P10 ; non supportées en V1 |
| Application mobile hors-ligne complète | 029 (le contrat de saisie en lot idempotent est prévu ici) |

## 4. Acteurs

| Acteur | Rôle |
|---|---|
| Instituteur (titulaire) | Appel du jour ; crée et saisit ses évaluations, toutes matières ; compétences et appréciations ; prépare le dossier du conseil de sa classe ; consulte son bilan de classe |
| Instituteur spécialiste / intervenant | Saisit les évaluations des matières qui lui sont affectées (`LEAD` sur un nœud) |
| Directeur / directrice | Active les classes, affecte les titulaires, valide les évaluations, préside le conseil, scelle les bilans, archive l'année |
| Secrétariat | Inscriptions, listes, états, impression |
| Parent / tuteur | Consulte bulletins, compétences, bilan annuel publiés, absences |
| Inspection / administration (hors système) | Destinataire d'états (voir Q-P12) |
| Super-administrateur plateforme | Publie le RuleSet officiel ; approuve les variantes ; marque les gabarits |

## 5. User stories et critères d'acceptation

Les critères sont **mesurables** et seront des tests (section 12).

### US1 — Activation du pack Primary par les données (P1)

En tant que propriétaire, je veux qu'un établissement du primaire soit prêt à l'emploi dès l'activation du pack.

- **AC1.1** À `tenancy.institution.created` (pack `PRIMARY`, système `CI`), `instantiatePrimaryReferenceData` instancie en une transaction idempotente : niveaux PS, MS, GS, CP1…CM2 (004), plans de périodes `THREE_TERMS` et `TWO_SEMESTERS`, politique d'appel `DAILY`, échelle et référentiels de démonstration (`placeholder`), banque d'appréciations, paramètres `primary_school.settings`, liaison de règle `coef-period@1`. Rejouée, elle ne crée **aucune** ligne ni ne modifie une ligne personnalisée (compteurs de `template_applications`).
- **AC1.2** Un test de cohérence des modèles vérifie que le modèle `primary_school` ne définit **aucun** nombre réglementaire : seuls `source_kind = placeholder` ou `institution` apparaissent, et tout `regulation` exige `source_reference` (contrainte SQL).
- **AC1.3** Le modèle se charge via `tenancy.getPackTemplateSection('PRIMARY', 'CI', 'primary_school')` ; sans ce port, `primary_school` échoue fermé (`primary_school.template_unavailable`), sans repli silencieux.
- **AC1.4** Temps d'activation d'un établissement vide : ≤ 5 s (mesuré en intégration).

### US2 — Classe à titulaire unique (P1)

En tant que directeur, je veux qu'une classe du primaire ait un instituteur titulaire, qui voit et saisit tout dans sa classe.

- **AC2.1** Le rôle système `instituteur` (modèle de rôle) accorde : `attendance.take`, `assessment.create|update`, `grade.enter`, `primary.competency.record`, `primary.phrase.read`, `primary.council.prepare`, `student.class.read`, `messaging.read|send`, `reportcard.read` (sa classe). Aucune permission financière, aucune permission de clôture ni de scellement.
- **AC2.2** Avec `require_homeroom_for_activation = true` (défaut), `academic.activateClassroom` d'une classe du cycle `PRIMARY`/`PRESCHOOL` sans `HOMEROOM` actif est refusée (`primary_school.homeroom_required`) via le port `ClassroomActivationGuard` (§14.2). Un établissement qui désactive la règle l'assume : l'action est auditée.
- **AC2.3** Un titulaire `covers_all_subjects` peut créer une évaluation sur **tout** nœud non transversal de sa classe (résolveur `getResponsibleForNode` de 009) ; un remplaçant désigné par la direction hérite des droits à la date d'effet, l'ancien titulaire les perd le même jour (test de bascule).
- **AC2.4** Un instituteur n'accède jamais à une autre classe que les siennes (RLS + vérification d'affectation côté API : 404 sinon).

### US3 — Appel journalier (P1)

- **AC3.1** L'appel du jour utilise `attendance.openAttendanceSession({ classroomId, date, scope: 'DAILY' })` (010) : une séance par classe et par jour, faite par le titulaire ; la politique d'appel du pack est `DAILY` (aucune séance horaire).
- **AC3.2** Le registre d'appel mensuel (rapport R3, §9) est reconstitué à 100 % depuis les pointages ; l'exportation CSV d'une classe de 60 élèves sur un mois prend ≤ 2 s.
- **AC3.3** Le récapitulatif d'absences d'une période, transmis au bulletin, provient d'`attendance` (récapitulatif dérivé + surcharge tracée) ; `primary_school` ne le recalcule pas.

### US4 — Évaluations chiffrées et résultats (P1)

- **AC4.1** Un instituteur crée des évaluations (types `INTERROGATION`, `DEVOIR`, `COMPOSITION`, données du tenant), les soumet, la direction les valide et les publie (circuit de 011). Aucune formule dans `primary_school`.
- **AC4.2** Les résultats de période (moyennes de matière, de période, rangs, mention, décision proposée) sont calculés par `results` avec le contrat `coef-period@1` du RuleSet lié ; la version de règle est épinglée à la période (011).
- **AC4.3** Si le RuleSet lié est de `source_kind = placeholder`, tout résultat, bulletin et bilan porte la mention **« Règles de démonstration — document sans valeur officielle »** (filigrane du gabarit + champ `ruleSourceKind` dans le snapshot) ; un tenant `PRODUCTION` ne peut **pas** lier un RuleSet placeholder sans l'avoir accepté explicitement (`rules.placeholder_requires_ack`, demande de changement 012).
- **AC4.4** Un changement de coefficient d'une matière est un amendement journalisé du curriculum (004) ; il n'altère pas un résultat FINAL.

### US5 — Évaluation par compétences (P1)

En tant qu'instituteur (maternelle ou primaire), je veux évaluer le niveau de maîtrise de chaque compétence par élève et par période.

- **AC5.1** Un référentiel (`competency_frameworks`) a un code, une version, une échelle et des niveaux d'application ; il se publie seulement s'il compte ≥ 1 compétence, ≥ 1 niveau d'application et une échelle d'au moins 2 niveaux ; **publié, il est immuable** (créer la version suivante par copie). Vérifié par déclencheurs SQL (tests 10_reference).
- **AC5.2** `PUT /competency-assessments/bulk` est idempotent (`Idempotency-Key`), « tout ou rien », par lot de ≤ 500 lignes ; une ligne existante dont la valeur diffère exige `rowVersion` (verrou optimiste, comme 011). *Implémentation : idempotence par CONVERGENCE (rejouer un lot identique = `unchanged`, rien n'est écrit) ; l'en-tête `Idempotency-Key` n'est pas stocké (pas de table de reçus).*
- **AC5.3** Une appréciation ne s'écrit que pour un référentiel `PUBLISHED`, un niveau de **l'échelle du référentiel** et une classe × période **non verrouillée** (`period_locks`) ; trois refus distincts : `primary_school.framework_not_published`, `primary_school.scale_mismatch`, `primary_school.period_locked`.
- **AC5.4** `validate` (instituteur ou direction) fige la ligne ; ensuite seule une **révision** (motif ≥ 10 caractères, droit sensible `primary.competency.revise`) la corrige, dans la même transaction que sa trace (`competency_revisions`, append-only). Aucune suppression d'une appréciation validée.
- **AC5.5** La synthèse d'un élève (`summarize_competencies`) renvoie des **compteurs** `{domaine: {niveau: n}}` sur les seules lignes validées ; **aucune moyenne, aucun seuil**. p95 < 100 ms pour 40 compétences × 3 périodes.
- **AC5.6** Les compétences visibles par les familles sont celles des périodes dont le bulletin est publié.

### US6 — Appréciations (P2)

- **AC6.1** L'appréciation générale et par matière d'une période est écrite dans `results.appreciations` (auteur `TEACHER` / `DIRECTOR` / `COUNCIL`, ≤ 1000 caractères, figée à la clôture) ; la **banque de phrases** (`appreciation_phrases`, données du tenant, ≤ 300 caractères) propose du texte, **jamais appliqué sans validation** par l'instituteur.
- **AC6.2** Les phrases se filtrent par portée (`PERIOD`, `YEAR`, `COMPETENCY`), niveau de maîtrise et niveau de classe ; une phrase `placeholder` est étiquetée dans l'interface.

### US7 — Bulletin primaire (P1)

- **AC7.1** `reportcards` émet, pour une classe et une période, un bulletin par inscription (lot idempotent, 013) à partir du gabarit « bulletin primaire » : identité de l'établissement, élève, période, tableau des matières (note, appréciation, rang selon réglage), bloc compétences (si cycle concerné), assiduité, appréciation générale, signatures. Les rubriques officielles exactes sont **à fournir** (`regulatory-sources-needed.md` §2.6) ; le gabarit est générique et versionné.
- **AC7.2** Pré-vérification (`preflight`) : manques listés avec lien de correction (titulaire absent, période non close, signataire absent, compétences non validées).
- **AC7.3** 100 bulletins en ≤ 120 s sur 2 vCPU (objectif 013).

### US8 — Conseil des maîtres (P1)

- **AC8.1** `prepareCouncil({ classroomId, periodId | yearId })` crée la délibération (`results.createDeliberation`, `kind = COUNCIL`) puis un **dossier par élève** (`council_cases`) dont `reason_codes` vient des règles booléennes `cas_limite`, `cas_absences`, `cas_deja_redoublant` (contrat `coef-period@1`) ; l'instituteur ajoute sa proposition (`proposal_code`, note ≤ 1000 caractères).
- **AC8.2** La feuille de présence (`council_attendance`) ne comporte qu'un président et un secrétaire ; le **quorum** est évalué par la règle `quorum_conseil` (donnée) — jamais par une constante ; une signature exige la présence ; une présence signée est figée.
- **AC8.3** Une décision confirmée différente de la proposition de la règle exige une justification ≥ 20 caractères ; proposition et décision sont conservées (R-RES-05 de 011) ; `council_cases.status = DECIDED` n'est possible qu'avec la référence de la décision.
- **AC8.4** Le **procès-verbal** est généré par `reportcards.requestOfficialDocument` (nature `COUNCIL_MINUTES`, demande de changement 013) à partir d'un contenu figé : date réelle de séance, participants et signataires, décisions, justifications. Aucun nom de signataire par défaut.
- **AC8.5** La décision confirmée alimente `academic.recordEnrollmentOutcome` (issue `PROMOTED`, `REPEATED`…) — sans intervention manuelle ; la reconduction annuelle (004) lit ces issues.

### US9 — Bilan annuel (P1)

- **AC9.1** `prepareAnnualReviews({ classroomId, academicYearId })` crée un brouillon par inscription active avec : référence du résultat d'année FINAL (`results.getYearResult`), synthèse de compétences (compteurs), résumé d'assiduité, décision du conseil.
- **AC9.2** `seal` (permission sensible `primary.bilan.seal`, MFA) exige : toutes les périodes de l'année `CLOSED`, un résultat d'année FINAL, et — si `council_required_for_bilan` — la décision confirmée du conseil. Sinon `primary_school.review_needs_results` / `review_needs_decision`. Le scellement calcule l'empreinte canonique et fige la ligne (déclencheur).
- **AC9.3** Un bilan scellé est **immuable** (contenu, empreinte, décision) ; seul l'identifiant du PDF émis se renseigne, une seule fois. Une correction crée la **version n+1** (motif ≥ 10 caractères), l'ancienne passe `SUPERSEDED` dans la même transaction (une seule version vivante par inscription et par année).
- **AC9.4** Le PDF du bilan est rendu par `reportcards` depuis l'instantané, avec QR de vérification ; les familles ne voient que les bilans scellés et publiés. *Implémentation : « publié » = scellé ET PDF émis (`reportcard_id` renseigné par l'événement de rendu `reportcards.official_document.rendered`, nature `ANNUAL_REVIEW`) ; le PDF est demandé par un abonné du worker à `primary_school.annual_review.sealed` : le scellement ne dépend jamais du rendu.*
- **AC9.5** 1 000 bilans préparés en ≤ 60 s (job).

### US10 — Passage, redoublement, reconduction (P1)

- **AC10.1** La proposition de la règle (`decision_fin_annee`) ∈ `{PENDING, PROMOTED, REPEAT, COUNCIL_REVIEW}` (codes, jamais des libellés) ; `COUNCIL_REVIEW` signifie « la règle ne tranche pas : le conseil décide ».
- **AC10.2** À la confirmation, l'issue de l'inscription est enregistrée (`recordEnrollmentOutcome`) ; `previewRollover` (004) liste classes et inscriptions de l'année suivante ; `PROMOTED` → niveau suivant (`next_grade_level_id`), `REPEATED` → même niveau (`is_repeating = true`).
- **AC10.3** Un élève de **CM2 promu** n'a pas de niveau suivant (`is_final`) : la reconduction le signale (« fin de cycle primaire ») ; l'admission en 6e relève de 007/006 et du résultat du CEPE (018), jamais de ce module.

### US11 — Archivage de l'année (P2)

- **AC11.1** `prepareYearArchive` exige `academic.closeAcademicYear` accompli ; il dénombre `reviews_total` / `reviews_sealed` et produit un **manifeste** (classes, effectifs, hashes des bilans) dont l'empreinte est stockée.
- **AC11.2** `READY` exige 100 % des bilans scellés ; `FROZEN` est irréversible : plus aucun bilan de cet établissement et de cette année ne peut être écrit (déclencheur), l'archive n'est pas supprimable. *Implémentation : `READY` exige aussi que chaque inscription ait son bilan et que chaque bilan scellé ait son PDF émis (l'identifiant du PDF ne se renseigne plus une fois l'année gelée).*
- **AC11.3** Les données archivées restent lisibles (bilans, compétences) pour la direction et les familles concernées ; l'archivage est un **gel logique**, aucune donnée n'est déplacée ni purgée.
- **AC11.4** La durée de conservation est une donnée de l'établissement (`archive_retention_years`, **vide par défaut** : question métier Q-P11) ; aucune purge n'existe tant qu'elle n'est pas fixée.

### US12 — États et rapports (P2)

Rapports en lecture seule (écran, CSV, PDF) : R1 liste de classe ; R2 effectifs par niveau/classe/sexe/âge/financement ; R3 registre d'appel mensuel ; R4 redoublants et nouveaux arrivants ; R5 couverture des compétences (saisies vs attendues par classe et période) ; R6 dossier de conseil (une classe) ; R7 suivi d'avancement (évaluations non publiées, périodes à clore, bilans à sceller) ; R8 états destinés à l'administration (**formats officiels inconnus**, Q-P12 : colonnes configurables par format d'export de données, sans engagement). Chaque rapport est reproductible (paramètres journalisés) et respecte le périmètre du demandeur.

### US13 — RuleSets : mécanisme et jeu fictif (P1)

- **AC13.1** Les contrats `coef-period@1` et `competency-period@1` sont publiés dans `rules` (`rule-contract.md`) ; une RuleVersion qui ne les satisfait pas ne peut pas être proposée.
- **AC13.2** Le RuleSet `CI-PRIMARY-PLACEHOLDER` (`source_kind = placeholder`, nom et libellés « (fictif) ») permet de parcourir le flux complet : évaluations → moyennes → MGA → proposition → conseil → bilan. Ses golden tests (`golden-primary-mechanism`) prouvent le **mécanisme** (arrondi décimal exact, rang à égalité, valeur absente ≠ 0), **pas** la conformité réglementaire.
- **AC13.3** Remplacer le RuleSet fictif par un RuleSet officiel = publier une nouvelle RuleVersion (donnée), sans livraison de code, tant que le contrat est respecté. Si le texte officiel exige une variable absente du contrat, c'est un `coef-period@2` (livraison de code), décidé à la réception des textes.

## 6. Modèle de pack Primary (en données)

Le détail (JSON de référence, source de chaque section, propriétaire) est dans `pack-template.md`. Résumé :

| Section | Propriétaire | Contenu pour `PRIMARY` / `CI` | Nature des valeurs |
|---|---|---|---|
| `academic` | 004 | Cycles `PRESCHOOL`/`PRIMARY`, niveaux PS…CM2, `next`, `isFinal` (CM2), types de périodes, plans `THREE_TERMS` / `TWO_SEMESTERS`, types de financement, issues, programmes `MATERNELLE`/`PRIMAIRE`, `calculationContract` | Libellés du PRD §12 ; **aucune règle** |
| `assess` | 011 | Types `classic` (interrogation, devoir, composition, examen blanc…) | Données du tenant, barème 20 par défaut (modifiable) |
| `attendance` | 010 | Politique d'appel `DAILY`, statuts d'appel | Données |
| `results` | 011 | Réglages (séparation des tâches, délai de recalcul) ; liaison `coef-period@1` → `CI-PRIMARY-PLACEHOLDER` | Liaison de règle ; **placeholder** |
| `primary_school` | 005 | Échelle et référentiels de démonstration, banque d'appréciations, paramètres | **placeholder** |
| `reportcards` | 013 | Gabarits « bulletin primaire », « bilan annuel », PV de conseil | Gabarits génériques versionnés |
| `rbac` | 002 | Rôle `instituteur` + permissions `primary.*` | Modèle de rôle |
| `finance` | 014 | Catégories de frais (inscription, scolarité) | Libellés ; **aucun montant** |

Un **jeu de démonstration** (seeds déterministes, jamais en production) ajoute : disciplines fictives « Matière 1 (fictive) »…, un curriculum par niveau, un RuleSet fictif lié, 2 classes, 40 élèves. Il sert aux golden tests, aux e2e et aux démos.

## 7. Modèle de données

Voir `data-model.md` (DDL de référence **exécuté et testé** sur PostgreSQL 17, 118 tests). Schéma `primary_school`, migrations `1900`–`1902` (plage `1900–1999`, à inscrire dans `module-conventions.md`).

| Table | Rôle |
|---|---|
| `rating_scales`, `rating_levels` | Échelles d'appréciation (niveaux de maîtrise) |
| `competency_frameworks`, `framework_grade_levels`, `competency_domains`, `competencies` | Référentiels versionnés, immuables une fois publiés |
| `competency_assessments`, `competency_revisions`, `period_locks` | Évaluation par compétences, révisions (ajout seul), verrou de période |
| `appreciation_phrases` | Banque d'appréciations |
| `council_cases`, `council_attendance` | Dossier et présence du conseil des maîtres |
| `annual_reviews`, `year_archives` | Bilan annuel scellé (versionné), archive d'année gelable |
| `settings`, `template_applications` | Paramètres d'établissement, idempotence de l'instanciation |

Toutes les tables portent `tenant_id` + RLS forcée ; l'allowlist d'isolation du module est **vide**. Aucune FK vers un autre schéma (UUID et **codes** de niveau).

## 8. Endpoints (`/api/v1/primary_school`)

Schémas Zod dans `packages/contracts/src/v2/primary-school.ts`. Les erreurs ont un code `primary_school.*` stable.

| Méthode | Chemin | Description | Permission |
|---|---|---|---|
| GET/PUT | `/settings` | Paramètres de l'établissement | `primary.settings.manage` |
| GET/POST/PATCH | `/rating-scales`, `/rating-scales/:id/levels` | Échelles (modifiables tant qu'aucun référentiel publié ne les emploie) | `primary.scale.manage` |
| GET/POST | `/frameworks`, `/frameworks/:id` ; PUT `/frameworks/:id/structure` (brouillon) | Référentiels | `primary.framework.read` / `.manage` |
| POST | `/frameworks/:id/publish`, `/frameworks/:id/new-version` | Publication ; copie en brouillon | `primary.framework.publish` |
| GET | `/classrooms/:id/competency-sheet?periodId=` | Grille élèves × compétences | `primary.competency.read` |
| PUT | `/competency-assessments/bulk` | Saisie en lot idempotente | `primary.competency.record` |
| POST | `/classrooms/:id/periods/:pid/competencies/validate` | Validation de la grille | `primary.competency.validate` |
| POST | `/competency-assessments/:id/revisions` | Correction d'une ligne validée | `primary.competency.revise` (**sensible**) |
| GET | `/enrollments/:id/competency-summary?periodIds=` | Compteurs par domaine et niveau | `primary.competency.read` ; `primary.competency.child.read` / `.self.read` |
| GET/POST/PATCH | `/phrases` | Banque d'appréciations | `primary.phrase.read` / `.manage` |
| POST | `/councils/prepare` | Crée délibération + dossiers | `primary.council.prepare` |
| GET/PATCH | `/councils/:deliberationId/cases[/:id]` | Dossiers de séance | `primary.council.read` / `.prepare` |
| PUT | `/councils/:deliberationId/attendance` | Feuille de présence | `primary.council.manage` |
| POST | `/councils/:deliberationId/minutes` | Demande le PV (document scellé) | `primary.council.manage` |
| POST | `/annual-reviews/prepare` | Brouillons de bilan d'une classe | `primary.bilan.prepare` |
| GET | `/annual-reviews?classroomId=&yearId=` ; `/annual-reviews/:id` | Lecture | `primary.bilan.read` |
| POST | `/annual-reviews/:id/seal` ; `/annual-reviews/:id/reissue` | Scellement ; version n+1 | `primary.bilan.seal` / `primary.bilan.reissue` (**sensibles**) |
| GET | `/me/annual-reviews`, `/children/:studentId/annual-reviews` | Famille (scellés et publiés seulement) | `primary.bilan.self.read` / `.child.read` |
| POST/GET | `/year-archives/prepare`, `/year-archives`, `/year-archives/:id` | Préparation, lecture | `primary.archive.prepare` |
| POST | `/year-archives/:id/freeze` | Gel irréversible | `primary.archive.freeze` (**sensible**) |
| GET | `/reports/{class-list,enrollment-stats,attendance-register,repeaters,competency-coverage,council-pack,progress}` | Rapports (`?format=csv|pdf`) | `primary.report.read` |
| POST | `/template/apply` | (Ré)instancie le modèle de pack | `primary.template.apply` (**sensible**) |

## 9. Écrans

Portail **instituteur** (mobile d'abord) : « Ma classe » (liste, appel du jour en 2 gestes, absents à justifier) ; « Évaluations » (créer, saisir, soumettre) ; « Compétences » (grille avec bascule rapide par niveau, « tous au niveau X sauf… », indicateur de complétude) ; « Appréciations » (banque de phrases) ; « Conseil » (mes dossiers) ; « Mes bulletins ». Portail **direction** : activation des classes et titulaires, avancement de période (feux vert/orange/rouge), validation des évaluations, séance du conseil (présence, dossiers un par un, décision, PV), bilans (préparer, sceller, réémettre), archivage, rapports. Portail **parent** : bulletins et bilans publiés, compétences par domaine, absences. Bandeau permanent **« Règles de démonstration »** tant que le RuleSet lié est `placeholder`.

## 10. Permissions (déclarées dans `manifest.ts`)

`primary.settings.manage`, `primary.scale.manage`, `primary.framework.read|manage|publish`, `primary.competency.read|record|validate|revise` (**revise sensible**), `primary.competency.child.read`, `primary.competency.self.read`, `primary.phrase.read|manage`, `primary.council.read|prepare|manage`, `primary.bilan.read|prepare|seal|reissue` (**seal et reissue sensibles**), `primary.bilan.child.read`, `primary.bilan.self.read`, `primary.archive.prepare|freeze` (**freeze sensible**), `primary.report.read`, `primary.template.apply` (**sensible**), **`primary.class.read_all`** (ajout de l'implémentation : sans elle, un instituteur n'accède qu'aux classes auxquelles il est affecté ; direction et secrétariat la portent). Features : `primary.competencies` (packs `PRIMARY`), `primary.council`, `primary.annual-review`, `primary.year-archive`, `primary.reports`. Modèles de rôles : `instituteur` (US2), `directeur` (tout), `secretariat` (rapports, lecture), `parent` (`*.child.read`).

## 11. Événements (outbox, `{ v: 1, … }`, aucune donnée d'appréciation ni de note)

| Événement | Producteur | Consommateurs prévus |
|---|---|---|
| `primary_school.template.applied` | instanciation | 025 |
| `primary_school.framework.published` | publication | UI, 025 |
| `primary_school.competency.validated` | validation d'une grille (classe × période) | 013 (préflight), 025 |
| `primary_school.competency.revised` | révision | audit, 016 |
| `primary_school.council.prepared` / `.minutes_requested` | conseil | 016, 013 |
| `primary_school.annual_review.sealed` / `.superseded` | bilan | 013 (rendu), 016, 025 |
| `primary_school.year_archive.ready` / `.frozen` | archive | 025 |

**Consommés** : `tenancy.institution.created` (instanciation), `academic.classroom_period.grading_closed|closed|reopened` et `academic.period.*` (verrous `period_locks`), `results.decision.confirmed` (alimente le dossier et `recordEnrollmentOutcome`), `results.period.closed` (compteur d'avancement), `academic.year.closed|archived`, `reportcards.official_document.rendered` (nature `ANNUAL_REVIEW` : renseigne `reportcard_id`), `primary_school.annual_review.sealed` (demande du PDF). Consommateurs idempotents par `event.id`.

## 12. Tests

- **DDL** (livrés) : 118 tests de comportement sur PostgreSQL 17 (`ddl/run.mjs`) : publication des référentiels, immuabilité, FK composites, verrou de période, révisions à trace obligatoire, synthèse par compteurs, bilan scellé et versions, archive gelée, RLS A/B.
- **Unitaires** (Vitest) : schémas Zod, `summarize` côté TypeScript (parité avec la fonction SQL), banque de phrases (filtre), calcul d'avancement.
- **Golden tests de mécanisme** : `golden-primary-mechanism` (contrat `coef-period@1`, RuleSet fictif) — cas : note absente ≠ 0, arrondi `round_half_up` exact, rang à égalité (4 décimales), MGA sur 2 et 3 périodes, `COUNCIL_REVIEW` dans la marge, élève sans note de période.
- **Intégration** : activation du pack idempotente ; classe sans titulaire refusée ; flux complet évaluations → clôture → conseil → bilan → archive avec RuleSet fictif ; interdiction de lier un placeholder en production sans accusé ; isolation tenant A/B sur chaque table.
- **E2E** (Playwright, portails instituteur/direction/parent) : « une classe de 40 élèves sur une année simulée, sans Excel ».
- **Sécurité** : un parent ne lit que les bilans scellés et publiés de ses enfants liés ; un instituteur n'accède pas à une classe non affectée ; aucune donnée d'appréciation dans les événements ni l'audit.

## 13. Cas limites

- Élève inscrit en cours d'année (arrivée) : périodes déjà closes sans notes → « non noté » (≠ 0) ; bilan marqué « inscrit le … » ; la règle décide avec les périodes notées (`periodes_notees < periodes_attendues` est une entrée de règle).
- Changement de classe en cours d'année (`enrollment_placements`) : les compétences restent rattachées à l'**inscription** ; le bilan lit tous les placements.
- Instituteur remplacé : les appréciations gardent leur auteur (identité figée) ; le nouveau titulaire ne réécrit pas les anciennes.
- Période rouverte après validation des compétences : `period_locks` repasse `OPEN` ; les lignes validées restent figées (révision obligatoire).
- Référentiel republié (version suivante) en cours d'année : les lignes déjà saisies gardent leur version ; la grille n'affiche qu'**une** version par classe et par période (choix de la direction avant ouverture de la période).
- Redoublant : `is_repeating` posé par la reconduction ; la règle `cas_deja_redoublant` reçoit le nombre de redoublements du cycle (donnée `academic`).
- Élève de CM2 : fin de cycle ; le bilan indique le résultat de l'année, **jamais** le résultat du CEPE (018).
- Archive gelée puis découverte d'une erreur : création d'une version n+1 impossible (déclencheur `year_frozen`) → procédure de **dégel exceptionnel** (super-admin, motif, audit, nouvelle archive), à décider (Q-P11).
- Règle placeholder en production : accusé explicite du propriétaire et filigrane ; sinon refus.
- Établissement avec trimestres **et** semestres : un seul plan de périodes actif par année ; `coef-period@1` lit les poids dans le plan.

## 14. Dépendances et demandes de changement

### 14.1 Dépendances

- **En amont** : 000 (socle), 001–003 (tenants, modèle de pack, `getPackTemplateSection`), 004, 008, 009, 010, 011, 012, 013, 014 (frais), 016.
- **En aval** : 007 (admissions vers PS/CP1…), 018 (candidats CEPE issus des classes de CM2), 025 (indicateurs), 006 (patrons réutilisés pour le conseil de classe).

### 14.2 Demandes de changement (additives, à acter par les propriétaires de specs)

| Spec | Demande |
|---|---|
| 012 | (a) `source_kind` accepte `placeholder` (`CHECK` des tables `national_rule_versions` et `rule_versions`) ; (b) publier les contrats `coef-period@1` et `competency-period@1` (voir `rule-contract.md`) ; (c) refuser la liaison d'une version `placeholder` à un tenant dont le mode est `PRODUCTION` sans accusé (`rules.placeholder_requires_ack`) ; (d) seed du RuleSet `CI-PRIMARY-PLACEHOLDER` |
| 011 (`results`) | (a) pipeline minimal `competency-period@1` (décision sans moyenne) ; (b) exposer `ruleSourceKind` dans le bundle FINAL lu par `reportcards` ; (c) `createDeliberation` accepte un `kind = COUNCIL` avec `participants` fournis par `primary_school` |
| 013 | Gabarits « bulletin primaire », « bilan annuel primaire », « PV du conseil des maîtres » ; nature de document `COUNCIL_MINUTES` et `ANNUAL_REVIEW` ; filigrane conditionnel `ruleSourceKind = placeholder` |
| 004 | (a) modèle CI/PRIMARY : `calculationContract: "coef-period@1"` pour `PRIMARY`, `"competency-period@1"` pour `PRESCHOOL` ; (b) port `ClassroomActivationGuard.check(ctx, classroomId) → Result<void, {code}>` appelé par `activateClassroom` ; (c) `terminal_exam_required` du niveau `CM2` renseigné **seulement** si la question Q-P09 le tranche |
| 009 / 002 | Modèle de rôle système `instituteur` (permissions US2) ; `getResponsibleForNode` documente le cas généraliste |
| 003 | Sections de modèle de pack par module : `primary_school` |
| 010 | Politique d'appel `DAILY` dans le modèle de pack PRIMARY |
| `module-conventions.md` | Plage `1900–1999` pour `primary_school` (la ligne ouverte devient `2000+`) |

## 15. Critères de sortie (mesurables)

La spec est terminée lorsque :

1. Les migrations `1900`–`1902` s'appliquent sur base vide et les 118 tests de comportement passent ; l'allowlist d'isolation du module est vide et le test d'isolation générique passe avec deux tenants.
2. Un établissement `PRIMARY` créé par le provisioning contient, sans intervention, niveaux, périodes, rôle d'instituteur, politique d'appel, types d'évaluation, échelle et référentiels de démonstration ; la ré-exécution ne change rien.
3. Le flux « une classe, une année » (évaluations, compétences, appel, clôture des trois périodes, conseil, bilans scellés, archive gelée) passe en intégration avec le RuleSet **fictif**, bulletins marqués « règles de démonstration ».
4. Aucune constante de seuil, coefficient ou formule dans `apps/api/src/modules/primary_school/**` (lint R2 vert) ; aucun libellé affiché n'est comparé en logique.
5. Les demandes de changement du §14.2 sont acceptées ou refusées par écrit par les propriétaires de specs.
6. `regulatory-sources-needed.md` est transmis au propriétaire du produit ; tant que les textes ne sont pas fournis, **aucun RuleSet `regulation` n'est publié** pour le primaire.

## 16. État d'implémentation et écarts constatés (module `primary_school`, écrans `/v2/primary/*`)

Livré : module `apps/api/src/modules/primary_school` (migrations 1900-1903, domaine, cas d'usage, HTTP, abonnés, job), contrats `packages/contracts/src/v2/primary_school.ts`, adaptateurs de plateforme
(`academic-primary`, `people-primary`, `results-primary`, `attendance-primary`, `reportcards-primary`), écrans web (voir `apps/web/docs/v2-primary.md`). Détail, ports et interfaces attendues : `apps/api/src/modules/primary_school/README.md`.

**Écarts avec les sections précédentes (la présente section prévaut) :**

| Sujet | Spec initiale | Implémentation |
|---|---|---|
| Plage de migrations | `1800–1899` | **`1900–1999`** (`imports` a pris `1800` ; le générateur refuse la plage) ; DDL de la spec renommé en miroir (`ddl/migrations/1900…1903`) |
| Tables | 16 | **17** : `council_minutes` (procès-verbal FIGÉ : contenu, empreinte, version, document émis une fois) et `council_cases.academic_period_id` (migration `1903`, `ddl/tests/40_council_minutes.sql`, **118** tests de comportement au total) |
| Permissions | §10 | + `primary.class.read_all` (direction, secrétariat) ; un instituteur doit pouvoir **lire les bilans de sa classe** (`primary.bilan.read` au modèle de rôle `instituteur`, absent de `pack-template.md` §7) |
| Routes ajoutées | §8 | `GET /my-classrooms`, `GET /rule-banner`, `GET /progress`, `GET /councils`, `POST /councils/:id/cases/:caseId/decide`, `GET /children/:studentId/enrollments/:id/competency-summary`, `GET /competency-assessments/:id/revisions`, `DELETE /frameworks/:id` (brouillon) |
| Idempotence de la saisie en lot (AC5.2) | `Idempotency-Key` | par convergence (rejeu identique = `unchanged`), sans table de reçus |
| Famille (AC9.4) | « scellés et publiés » | scellés ET PDF émis |
| Archive (AC11.2) | tous les bilans scellés | + chaque inscription a son bilan + chaque PDF est émis (le gel interdit ensuite d'écrire `reportcard_id`) |
| Événement de rendu consommé | `reportcards.report_card.rendered` | `reportcards.official_document.rendered` (natures de documents officiels, source = bilan) |
| Calendrier d'un conseil | non précisé | **le conseil se tient AVANT la clôture de la période** : `results` refuse de créer une délibération ou de confirmer une décision sur une période `CLOSED` ; le bilan se scelle APRÈS la clôture de toutes les périodes |
| Réémission d'un bilan | version n+1 | l'index « une seule version vivante » impose de remplacer l'ancienne version dans la même transaction : entre la réémission et le nouveau scellement, la famille ne voit pas le bilan |
| R2 du rapport (effectifs) | sexe, âge, financement | niveau, classe, effectif, redoublants (le sexe, l'âge et le financement attendent un port de statistiques d'inscription) |
| R8 (états pour l'administration) | colonnes configurables | non livré (formats officiels inconnus, Q-P12) |
| Quorum | règle `quorum_conseil` | évalué par la règle du RuleSet lié ; **sans règle liée : aucun quorum bloquant** (présence comptée et affichée) |
| Motifs d'examen | règles booléennes | `cas_limite`, `cas_absences`, `cas_deja_redoublant` si le contrat est publié ; sinon `RULE_REVIEW` quand la règle de fin d'année propose `COUNCIL_REVIEW` ; `redoublements_cycle` = nombre d'inscriptions `is_repeating` de l'élève (approximation de « cycle ») |

**Non branché tant que les demandes de changement du §14.2 ne sont pas livrées** (l'adaptateur échoue fermé, `primary_school.port_unavailable`, rien n'est écrit) : contrats `coef-period@1` / `competency-period@1` et RuleSet `CI-PRIMARY-PLACEHOLDER` (012) ; pipeline `results` correspondant et `ruleSourceKind` (011) ;
natures `COUNCIL_MINUTES` / `ANNUAL_REVIEW` et filigrane (013) ; `ClassroomActivationGuard` (004, la règle `checkHomeroomForActivation` existe et est testée) ; rôle système `instituteur` (002) ; `calculationContract` du modèle `academic` (004).
Les parties du modèle de pack qui appartiennent à d'autres modules (plans de périodes, politique d'appel `DAILY`, liaison de règle, rôle) restent à leurs propriétaires : `primary_school` n'instancie que SA section (échelle, référentiels de démonstration, phrases, paramètres).
