# Textes officiels et exemples à obtenir — QUESTION MÉTIER (006-secondary)

**Statut** : liste de collecte, à transmettre au propriétaire du produit (plan §8, point ouvert n°5). Elle **complète** `012-rules-engine/regulatory-sources-needed.md` (§3 enseignement secondaire, §4 examens nationaux, §6 documents officiels) pour tout ce que le pack Secondary ajoute : conseil de classe, orientation, vie scolaire, élèves affectés par l'État. **Aucune règle réglementaire ivoirienne officielle n'est écrite dans les specs** (composition ni quorum du conseil, MGA, passage, redoublement, orientation, exclusion, barème de conduite, BEPC, BAC, affectation) : le pack livre un **mécanisme** et un jeu **fictif** marqué `placeholder` (spec §6.4). Les valeurs viendront de textes que ni l'équipe technique ni cette spec ne détiennent.

Pour chaque ligne : le texte exact, sa date de publication et de validité, son numéro, l'autorité émettrice, et si possible un **exemple chiffré ou un document réel anonymisé** servant de **cas d'or** aux tests. Sans exemple validé, aucun RuleSet `regulation` n'est publié et aucune donnée de pack ne porte de valeur « officielle » : les champs concernés restent `NULL` ou vides.

> Désignation : le PRD (§51) cite l'autorité « MENAET » pour l'enseignement général ; l'appellation et les compétences exactes du ministère en charge de chaque ordre d'enseignement (enseignement général, technique, professionnel) à la date de chaque texte sont à confirmer par le propriétaire.

## 1. Principes de collecte

1. **Texte, puis exemple** : pour chaque règle, le texte (arrêté, décret, circulaire, note de service, règlement type) **et** 3 à 10 situations réelles avec le résultat attendu.
2. **Version et date** : chaque texte fixe une période d'application ; les versions de règle portent `effective_from/to` et `source.reference`.
3. **Personne de référence** : une personne désignée (inspection, chef d'établissement pilote, conseiller d'orientation) valide chaque texte transcrit avant publication.
4. **Rien d'implicite** : si un texte est muet (égalité, absence d'un membre, délai), la décision est posée comme **question** (`open-questions.md`), jamais comme défaut caché.
5. **Distinguer règlement et pratique** : un texte national, un règlement intérieur d'établissement et une habitude locale sont trois sources différentes ; le pack les range respectivement dans `regulation`, `institution` (variante du tenant) et les valeurs de démonstration `placeholder`.

## 2. Conseil de classe (PRD §19)

| # | Sujet | Ce que le mécanisme attend | Documents / exemples à obtenir |
|---|---|---|---|
| 2.1 | Existence, périodicité et nature des conseils (conseil de période, conseil de fin d'année, conseil exceptionnel) | `council_types` : portée (période ou année), état minimal des résultats | Texte organisant le conseil de classe ; calendrier type d'une année |
| 2.2 | **Composition** : qui siège (professeur principal, enseignants, éducateur, conseiller d'orientation, délégués des élèves, délégués des parents, direction) et qui préside | `participant_roles` (vote, quorum, signature), `council_types.required_role_codes` | Texte ; liste type de convocation |
| 2.3 | **Quorum** : existe-t-il un minimum de présents ? lequel ? | `council_types.min_participants` (`NULL` = aucun contrôle) | Texte précisant le quorum, ou confirmation de son absence |
| 2.4 | **Décisions possibles** et leur portée (passage, redoublement, orientation, réorientation, exclusion, avis, distinctions) ; vote ou consensus ; voix prépondérante | `decision_types`, `decision_mode`, votes | Texte ; 3 PV réels anonymisés de conseils de fin d'année |
| 2.5 | **Procès-verbal** : mentions obligatoires, modèle, signataires, conservation | Snapshot `council-minutes/1`, gabarit `council-minutes`, `signer_functions` / `signer_role_codes` | Modèle officiel de PV ; règle de conservation |
| 2.6 | Valeur d'une **signature électronique** (accusé daté et haché) et exigence éventuelle de signature manuscrite | Signature `ELECTRONIC` ou `SCANNED_PAPER` | Avis juridique (documents électroniques, preuve) — voir §9 |
| 2.7 | Communication de la décision aux familles : délai, forme, accusé de réception, voies de recours | `guardian_visibility`, notifications | Texte sur la notification des décisions de passage et d'orientation |
| 2.8 | Réouverture d'une décision après signature (rectification d'erreur matérielle) | Déverrouillage motivé, approbateur, délai | Texte ou pratique administrative |

## 3. Passage, redoublement, orientation, exclusion

| # | Sujet | Ce que le mécanisme attend | Documents / exemples à obtenir |
|---|---|---|---|
| 3.1 | **Passage en classe supérieure** : seuils, rôle du conseil, dérogations, cas particuliers | RuleSet `regulation` (contrat `secondary-annual@1` ou `coef-semester@1`) : code `decision_fin_annee` | Texte ; 5 à 10 dossiers chiffrés (moyennes, décision attendue) |
| 3.2 | **Redoublement** : conditions, nombre maximal, cas d'exclusion de l'établissement, possibilité de dérogation | Règle + contrôle humain | Texte ; exemples |
| 3.3 | **Orientation** à la fin du collège et en cours de lycée (choix de série) : critères, rôle du conseil, voeux des familles, accord des parents, affectation par l'administration | `orientation_paths`, dossier d'orientation, accord de la famille | Textes sur l'orientation et l'affectation en second cycle ; tableaux de passage entre séries |
| 3.4 | **Réorientation** et changement de série en cours de cycle : autorisé ? à quelles conditions ? par qui ? | `series_transfers`, dérogation motivée | Texte |
| 3.5 | **Exclusion** : temporaire, définitive ; instance compétente (conseil de classe, conseil de discipline) ; procédure contradictoire ; droits de recours | `decision_types` (famille `EXCLUSION`, application humaine), mesures `TEMP_EXCLUSION`, recours | Règlement des établissements ; texte sur la discipline des élèves |
| 3.6 | **Mentions et distinctions** (tableau d'honneur, encouragements, félicitations, avertissements, blâme) : seuils, appellations, qui les attribue | Règle `distinction`, propositions `DISTINCTION` | Texte ou règlement type |

## 4. Séries, options, langues, coefficients

| # | Sujet | Ce que le mécanisme attend | Documents / exemples à obtenir |
|---|---|---|---|
| 4.1 | **Liste des séries** générales, techniques et professionnelles, par cycle | Programmes enfants (`academic`) ; **aucune liste en code** | Arrêtés / tableaux officiels |
| 4.2 | **Matières par série**, volumes horaires, **coefficients par matière et par série** | `curriculum_nodes.coefficient` (donnée) | Tableaux officiels de coefficients (par niveau et par série) |
| 4.3 | **Options** et **langues** (LV1, LV2, option…) : obligatoire / facultatif, choix {min, max}, modifiable ? | Nœuds `GROUP` à choix, sélections `OPTION` | Texte ; grille horaire |
| 4.4 | **Parcours autorisés** d'une série ou d'un niveau vers une autre série ou un autre niveau, avec conditions (avis du conseil, accord de la famille) | `orientation_paths` (vide par défaut) | Tableaux de passage officiels ; exemples de refus et d'acceptation |
| 4.5 | Niveaux qui conduisent à un **examen national** (le PRD cite 3e → BEPC et Terminale → BAC) | `terminal_exam_required` par niveau (004) | Confirmation et textes ; autres diplômes éventuels |

## 5. Évaluation et calcul des moyennes

| # | Sujet | Ce que le mécanisme attend | Documents / exemples à obtenir |
|---|---|---|---|
| 5.1 | **Nombre de périodes** de l'année (trimestres ou semestres) et pondération des périodes dans la moyenne annuelle | Contrat `secondary-annual@1` (N périodes, `poids_periodes`) | Texte ; calendrier |
| 5.2 | **Moyenne de matière** à partir des types d'évaluation (interrogation, devoir, composition…) : pondérations, traitement des absences | Règle `moyenne_matiere`, groupes d'agrégation | Texte ; exemples |
| 5.3 | **Moyenne générale et annuelle (MGA secondaire)**, malus / bonus éventuels, arrondis, égalités, rangs | Règles `moyenne_ponderee`, `moyenne_annuelle`, `arrondi_affichage`, `rang` | Texte ; 5 à 10 cas chiffrés complets |
| 5.4 | **Note de conduite** : nature (note /20 ?), pondération, lien éventuel avec les sanctions ou les points | Nœud transversal `DIRECT` (saisie humaine) | Texte ; bulletin type |
| 5.5 | Bulletin : rubriques, mentions légales, signatures, cachets, mention « affecté(e) » | Gabarit `secondary-bulletin` (013) | Modèle officiel de bulletin ; sens exact de « Affecté(e) » (Q6-23) |

## 6. Discipline et vie scolaire (PRD §34)

| # | Sujet | Ce que le mécanisme attend | Documents / exemples à obtenir |
|---|---|---|---|
| 6.1 | **Règlement intérieur type** : catalogue des fautes, des sanctions, des avertissements, des encouragements | `event_types`, `severity_levels` (aucun type livré) | Règlement type ou règlements d'établissements pilotes |
| 6.2 | **Qui valide quoi** : sanction ou exclusion par le surveillant général, le chef d'établissement, un conseil de discipline | `approver_permission`, `requires_four_eyes` | Texte ; organigramme |
| 6.3 | **Durée maximale** d'une exclusion temporaire, conditions, procédure | `requires_dates` ; contrôle de durée (paramètre du type, hors V1) | Texte |
| 6.4 | **Droit de recours** : existence, délais, instance | `appealable`, `measure_appeals` | Texte |
| 6.5 | **Convocation des parents** : délai, forme, accusé de réception, conséquences d'une absence | `convocations` | Texte ; modèle de convocation |
| 6.6 | **Barème de points de conduite** (s'il existe) : points initiaux, retraits par faute, bonifications, bornes, remise à zéro | `conduct_scales` (aucun livré) | Barème officiel ou barèmes d'établissements |
| 6.7 | **Absences et retards** : qualification pendant une exclusion, seuils déclenchant une convocation ou une sanction | Alertes `attendance` paramétrables ; Q6-19, Q6-21 | Règlement |
| 6.8 | **Confidentialité** des sanctions : ce que les parents et l'élève voient ; transmission au nouvel établissement | `audience_may_see`, niveaux de confidentialité | Texte ; pratique |

## 7. Élèves affectés par l'État (PRD §20)

| # | Sujet | Ce que le mécanisme attend | Documents / exemples à obtenir |
|---|---|---|---|
| 7.1 | **Processus d'affectation** : qui délivre l'acte, quand, avec quelle **référence** (format), à quel établissement | `assignments` (référence, autorité, date) | Acte d'affectation type (anonymisé) ; texte |
| 7.2 | **Montants** : part de l'État, part de la famille, base de calcul, périodicité de paiement, **délai de versement** | `declared_state_amount`, `declared_parent_amount`, rapprochement | Barème ; exemples chiffrés |
| 7.3 | **Contrôles exigés** par l'État : présence (certificat), identité, pièces ; fréquence ; sanctions en cas d'écart | `controls`, `required_control_kinds` (vide par défaut) | Texte ; modèle de certificat de présence |
| 7.4 | **Cumul** affectation + bourse ou autre prise en charge | Question O-04 de 004 | Texte |
| 7.5 | **Changement** d'établissement, de classe, redoublement ou exclusion d'un affecté : conséquences sur l'affectation | Fin / transfert de dossier ; avenant | Texte |
| 7.6 | **Plateforme publique** (API, fichiers d'échange) : existence, date, spécification | Port `StateAssignmentGateway` (`NotConfigured` en V1) | Spécification technique officielle le moment venu |

## 8. Examens nationaux : BEPC et BAC (spec 018)

Voir `012-rules-engine/regulatory-sources-needed.md` §4. Éléments propres au pack : conditions de présentation tenant compte de la discipline et de l'assiduité (le cas échéant), rôle de la moyenne de classe, examens blancs, centres, numéros de table, pièces ; **faits** que le pack doit fournir à 018 (§US11 de la spec).

## 9. Documents officiels, données personnelles, conservation

| # | Sujet | Documents à obtenir |
|---|---|---|
| 9.1 | **Valeur probante** d'un PV et d'un bulletin numériques signés et hachés ; signature électronique ; archivage | Avis juridique (documents électroniques) |
| 9.2 | **Protection des données** des mineurs (données disciplinaires, de santé hors périmètre) : consentement, durée de conservation, droit d'accès et d'effacement, transfert | Texte sur la protection des données personnelles applicable ; avis juridique |
| 9.3 | **Durée de conservation** des dossiers disciplinaires, des PV, des décisions d'orientation, des dossiers d'affectation | Texte ou directive ; sinon décision du propriétaire (`retention_days`) |
| 9.4 | Calendrier scolaire (début, fin, périodes, dates des conseils) | Calendrier officiel de chaque année |

## 10. Processus de réception d'un texte

1. Dépôt du texte et des exemples dans un dossier partagé **hors dépôt de code** (données potentiellement personnelles à anonymiser : PV, bulletins, actes d'affectation, dossiers disciplinaires).
2. **Note d'interprétation** d'une page, signée du référent : seuils, arrondis, égalités, absences, rôle exact de chaque instance.
3. Transcription **en données** (`regulation`) — jeu de règles, `decision_types`, parcours d'orientation, barèmes — et golden tests **avant** simulation ; jamais en code.
4. Revue croisée par le référent ; publication nationale par le super-admin (012, gouvernance D5).
5. Archivage du texte, de la note et du hash de la version publiée.
