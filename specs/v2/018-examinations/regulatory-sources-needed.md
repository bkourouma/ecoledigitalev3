# Textes officiels et exemples à obtenir — Examens nationaux (018-examinations)

**Statut** : liste de collecte, à transmettre au propriétaire du produit (plan §8, point ouvert n°5). Elle **précise** `specs/v2/012-rules-engine/regulatory-sources-needed.md` §4 (4.1 CEPE, 4.2 BEPC, 4.3 BAC, 4.4 BTS, 4.5 examens blancs) et complète `specs/v2/005-primary/regulatory-sources-needed.md` §2.7 (qui renvoie ici pour le CEPE).

**Aucune règle d'examen n'est inventée dans les specs** : le moteur d'examens est générique ; le CEPE est livré avec des **données fictives** (`source_kind = placeholder`). Tant que les éléments ci-dessous ne sont pas fournis, **aucun RuleSet ni type d'examen « réglementaire » ne sera publié**.

Pour chaque ligne : le texte exact (ou à défaut la description de la pratique), sa date et son autorité émettrice, et si possible **3 à 10 situations réelles anonymisées** avec le calcul complet et le résultat attendu.

## 1. Comment répondre (sans connaissance technique)

- Une photo ou un scan lisible suffit ; indiquer l'origine (ministère, direction régionale, inspection, établissement) et la date.
- Pour un **fichier échangé** avec l'autorité (liste de candidats, résultats), fournir un **exemplaire réel** dont les noms sont masqués : la plateforme lit sa structure (colonnes, séparateur, encodage) pour construire le « format » ; elle n'a pas besoin des identités.
- Si la pratique diffère d'un établissement ou d'une année à l'autre, le dire : c'est la preuve que la règle est un **réglage**.

## 2. CEPE (première instance)

| # | Sujet | Ce que le moteur attend | Documents / exemples à obtenir | Où cela s'ajoute |
|---|---|---|---|---|
| 2.1 | **Conditions d'éligibilité** | Qui peut être candidat (classe, âge, nombre de tentatives, certificat de scolarité…) | Texte d'organisation de l'examen ; la liste des pièces demandées aux candidats | Règle `eligibilite` (+ `motif_eligibilite`) ; pièces exigées |
| 2.2 | **Épreuves, barèmes, coefficients, durée** | Liste des épreuves, note maximale, coefficient, épreuves facultatives | Texte ; un exemple de relevé de notes complet | `exam_papers` du type `CEPE` (aujourd'hui **3 épreuves fictives**) |
| 2.3 | **Seuil d'admission et délibération** | Moyenne ou nombre de points requis, notes éliminatoires, repêchage, qui délibère, quand | Texte ; **au moins 5 exemples chiffrés** (admis, ajourné, limite, absent, épreuve éliminatoire) | Règle `resultat_candidat` (`seuil_admission`…) — **uniquement pour les examens blancs** : l'admission **officielle** est celle que prononce l'autorité |
| 2.4 | **Mentions** | Existe-t-il des mentions ? seuils et noms | Texte ; exemple | Règle `mention_examen` (optionnelle, inactive) |
| 2.5 | **Numéro de candidat** | Qui l'attribue (école ou autorité), format, moment (pré-inscription, inscription) | Texte ou note de service ; exemple de numéro, de numéro de table | Motif `candidate_number_pattern` ; identifiants `OFFICIAL_NUMBER` |
| 2.6 | **Centres d'examen** | L'école est-elle centre ? rattachée à un centre d'accueil ? qui décide ? règles de répartition (capacités, séparation des établissements) | Texte ; liste des centres et de leurs codes | `centers`, répartition |
| 2.7 | **Calendrier** | Dates d'ouverture et de clôture des inscriptions, dates des épreuves, publication des résultats, **session de rattrapage** éventuelle | Calendriers officiels des trois dernières années | Dates de session, `attempt_kind` |
| 2.8 | **Fichiers échangés avec l'autorité** | Liste de candidats **à transmettre** (colonnes, support, portail), fichier de **résultats reçu** (colonnes, encodage), formats de numéros | **Un exemplaire réel de chaque fichier** (noms masqués), consigne de remplissage | `export_formats` / lots d'import (données) |
| 2.9 | **Documents** | Convocation, attestation de réussite, relevé de notes : mentions obligatoires, signataires, cachets, durée de validité | **Modèles officiels** (un exemplaire rempli, anonymisé) | Gabarits `reportcards` (013) |
| 2.10 | **Taux de réussite** | Définition officielle : admis ÷ présents ou admis ÷ inscrits ? arrondi ? statistiques à publier (par établissement, série, sexe) | Texte ; un tableau de statistiques officielles | Règle `taux_reussite` (`denominateur`) |
| 2.11 | **Corrections après publication** | Procédure de rectification d'un résultat, délais, qui autorise | Texte ; exemple de décision de rectification | Révision approuvée (`result_revisions`) |
| 2.12 | **Lien avec l'admission en 6e et l'affectation** | Quelles informations du CEPE servent à l'admission ou à l'affectation, par qui, quand | Texte ; exemple de décision d'affectation | Consommation de `examinations.result.published` par 006/007 |
| 2.13 | **Conservation et données personnelles** | Durée de conservation des listes, résultats, attestations ; droits des familles | Texte applicable ; avis juridique | Paramètres de conservation |

## 3. BEPC, BAC, BTS (pour 006 et 020, hors CEPE)

| # | Examen | Ce qu'il faut en plus du CEPE | Documents / exemples |
|---|---|---|---|
| 3.1 | **BEPC** | Épreuves, coefficients, **prise en compte éventuelle de la moyenne de classe**, séries éventuelles | Texte ; exemples chiffrés ; modèle de relevé |
| 3.2 | **BAC** (séries) | Séries et épreuves par série, **épreuves de rattrapage / second groupe**, options, notes éliminatoires, mentions | Textes par série ; exemples chiffrés ; modèle de relevé |
| 3.3 | **BTS** | Admissibilité, examen, **stage**, **soutenance**, jury (voir 020 et 021) | Textes d'organisation ; modèle de relevé et de diplôme |

## 4. Examens blancs

Aucun texte officiel n'est attendu : ce sont des **pratiques d'établissement**. À préciser par l'établissement : nombre et calendrier, épreuves reprises de l'examen officiel (ou non), règle d'admission « pour de faux » (mêmes seuils que l'officiel ou barème interne), usage des résultats (information des familles, orientation, aucun effet officiel).

## 5. Exemples chiffrés attendus (« cas d'or »)

Ce sont les tests de conformité du futur RuleSet **officiel** (le jeu fictif n'en a pas). Pour chacun : notes de chaque épreuve (barème, coefficient), moyenne, rang éventuel, résultat attendu, **et qui a prononcé le résultat**.

| Cas | Pourquoi il est utile |
|---|---|
| Un candidat nettement admis ; un nettement ajourné | Cas nominal |
| Un candidat **à un dixième** du seuil (de part et d'autre) | Arrondi, comparaison |
| Un candidat **absent** à une épreuve ; un absent à toutes | Traitement d'une épreuve absente |
| Un candidat avec une **épreuve éliminatoire** échouée | Règle éliminatoire |
| Un candidat avec une **épreuve facultative** | Options |
| Un **ex æquo** au classement | Convention de classement |
| Un candidat **exclu** (fraude) | Issue `EXCLUDED` |

## 6. Processus de réception d'un texte

Identique à `012/regulatory-sources-needed.md` §8 : dépôt hors dépôt de code → note d'interprétation d'une page signée du validateur désigné → RuleSet brouillon et golden tests **avant** simulation → revue croisée → publication nationale → archivage du texte et de l'empreinte de la RuleVersion. Pour un **format de fichier**, la note décrit les colonnes et leur sens ; le format est créé en **brouillon**, testé sur le fichier d'exemple, puis **publié** (figé) par le super-administrateur.

## 7. Questions non techniques correspondantes

Voir `open-questions.md` partie B (Q-E01 à Q-E18) : options et **valeur par défaut** pour chaque question.
