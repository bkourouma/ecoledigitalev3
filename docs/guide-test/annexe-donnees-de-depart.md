# Annexe : données de départ de l'environnement de test

Ce document décrit ce que contient l'application **avant** le premier test : trois établissements de démonstration créés par `pnpm dev:v2:seed` (script `scripts/dev-v2/seed.ts`, jeu de données `scripts/seed-v2/dataset.ts` et prolongement `scripts/seed-v2/demo/*.ts`). Toutes les personnes, adresses et montants sont **fictifs**. Aucun mot de passe ni code MFA n'est écrit ici : on se connecte en cliquant sur un compte dans le panneau de droite de la page `/v2/login`.

> Dates : l'année scolaire de départ commence le **1er septembre de l'année scolaire en cours** (donc 2026-2027 pour une base créée en octobre 2026). Si votre base a été créée une autre année, les années des dates de naissance et des périodes sont décalées d'autant ; les noms, codes et montants restent identiques (jeu de données déterministe).

## 1. Les trois établissements

| Établissement (nom affiché) | Identifiant (`slug`) | Pack | Plan de périodes | Classe de départ | Frais d'inscription | Scolarité |
|---|---|---|---|---|---|---|
| Collège Le Baobab (démonstration) | `secondaire-test` | Secondaire | 3 trimestres | 6e A (`6E-A`), niveau 6E, programme Collège | 25 000 F CFA | 200 000 F CFA |
| École primaire Les Palmiers (démonstration) | `primaire-test` | Primaire | 3 trimestres (le seed force « deux semestres » pour le plan, voir note) | CP1 A (`CP1-A`), niveau CP1, programme Primaire | 15 000 F CFA | 120 000 F CFA |
| Université Horizon (démonstration) | `superieur-test` | Supérieur (LMD) | 2 semestres | Licence 1 A (`L1-A`), niveau L1, programme Informatique (`INFO`) | 50 000 F CFA | 600 000 F CFA |

Note : le fichier `scripts/dev-v2/seed.ts` impose `periodPlan = "TWO_SEMESTERS"` pour le primaire, alors que le jeu de données annonce 3 trimestres. Le plan réellement présent est à lire dans "Structure académique" > « Années » (à vérifier en test).

Matières de départ (code, libellé, coefficient, crédits) :

- Secondaire : `FRAN` Français (3), `MATH` Mathématiques (3), `ANG` Anglais (2), `HG` Histoire-Géographie (2).
- Primaire : `FRAN` Français (3), `MATH` Mathématiques (3), `EVEI` Éveil (1), `EPS` Éducation physique (1).
- Supérieur : `ALGO` Algorithmique (coef. 2, 3 crédits), `PROG` Programmation (1,5 ; 3), `MATH` Mathématiques (2 ; 4), `STAT` Statistiques (1 ; 2), regroupées en deux unités d'enseignement (UE) de deux éléments constitutifs (ECUE).

Huit élèves sur douze ont réglé l'inscription au départ (leur inscription est confirmée) ; les quatre autres sont à inscrire ou à confirmer.

## 2. Comptes de test (e-mails seulement)

Mots de passe et codes MFA : **jamais dans le guide**. Dans `/v2/login`, cliquer sur le compte dans le panneau de droite remplit le formulaire ; pour les comptes marqués "MFA", la page propose le code du moment (un code ne sert qu'une fois, il change toutes les 30 secondes).

| Rôle | Collège Le Baobab | École Les Palmiers | Université Horizon | MFA |
|---|---|---|---|---|
| Propriétaire | `direction.generale@secondaire-test.test` | `direction.generale@primaire-test.test` | `direction.generale@superieur-test.test` | oui |
| Directeur | `directeur@secondaire-test.test` | `directeur@primaire-test.test` | `directeur@superieur-test.test` | oui |
| Directeur des études | `etudes@secondaire-test.test` | `etudes@primaire-test.test` | `etudes@superieur-test.test` | oui |
| Responsable pédagogique | `pedagogie@secondaire-test.test` | `pedagogie@primaire-test.test` | `pedagogie@superieur-test.test` | oui |
| Secrétariat | `secretariat@secondaire-test.test` | `secretariat@primaire-test.test` | `secretariat@superieur-test.test` | oui |
| Économe | `econome@secondaire-test.test` | `econome@primaire-test.test` | `econome@superieur-test.test` | oui |
| Enseignant (secondaire, supérieur) / Instituteur (primaire) | `enseignant@secondaire-test.test` | `enseignant@primaire-test.test` | `enseignant@superieur-test.test` | non |
| Instituteur de maternelle | — | `instituteur.maternelle@primaire-test.test` | — | non |
| Éducateur | `educateur@secondaire-test.test` | `educateur@primaire-test.test` | `educateur@superieur-test.test` | non |
| Responsable des examens | `examens@secondaire-test.test` | `examens@primaire-test.test` | `examens@superieur-test.test` | non |
| Chargé d'admissions | `admissions@secondaire-test.test` | `admissions@primaire-test.test` | `admissions@superieur-test.test` | non |
| Parent (tuteur n° 1) | `parent@secondaire-test.test` | `parent@primaire-test.test` | `parent@superieur-test.test` | non |
| Élève | `eleve@secondaire-test.test` | `eleve@primaire-test.test` | `eleve@superieur-test.test` | non |

Total : 12 comptes au secondaire, 13 au primaire, 12 au supérieur = **37 comptes**. L'opérateur de la plateforme (console `/platform`) est un compte distinct, hors de ces trois établissements (voir le chapitre 01).

## 3. Élèves, tuteurs et enseignants de départ

Les noms sont les mêmes dans les trois établissements ; seuls les âges (dates de naissance) changent avec le niveau. Dates ci-dessous pour le **secondaire** (6e) ; au primaire, l'année de naissance est 2019 ou 2018 ; au supérieur 2005, 2004 ou 2003 (jour et mois identiques sauf exceptions de la graine ; pour la date exacte, lire la fiche de l'élève).

| N° | Élève | Sexe | Naissance (secondaire) | Lieu | Tuteur |
|---|---|---|---|---|---|
| E1 | DIABATE Nadia | F | 2014-01-19 | Daloa | T1 |
| E2 | DIABATE Salimata | F | 2014-03-11 | Korhogo | T1 |
| E3 | BAMBA Aya | F | 2014-10-03 | Bouaké | T2 |
| E4 | BAMBA Fatou | F | 2014-09-21 | Abidjan | T2 |
| E5 | COULIBALY Moussa | M | 2014-08-06 | Abidjan | T3 |
| E6 | COULIBALY Salimata | F | 2014-03-18 | Yamoussoukro | T3 |
| E7 | TOURE Yao | M | 2013-12-10 | Korhogo | T4 |
| E8 | TOURE Jean-Marc | M | 2013-12-25 | Bouaké | T4 |
| E9 | SORO Elie | M | 2013-10-04 | Yamoussoukro | T5 |
| E10 | SORO Aya | F | 2013-09-28 | Bouaké | T5 |
| E11 | N'GUESSAN Koffi | M | 2014-10-27 | Bouaké | T6 |
| E12 | N'GUESSAN Aya | F | 2013-12-03 | Korhogo | T6 |

| Tuteur | Nom | E-mail (le `.test` est remplacé par le slug de l'établissement) | Téléphone |
|---|---|---|---|
| T1 | DIABATE Séka | `parent@<slug>.test` | +225 07 10 20 30 40 |
| T2 | BAMBA Elie | `tuteur2@<slug>.test` | +225 07 11 23 35 41 |
| T3 | COULIBALY Mariam | `tuteur3@<slug>.test` | +225 07 12 26 40 42 |
| T4 | TOURE Elie | `tuteur4@<slug>.test` | +225 07 13 29 45 43 |
| T5 | SORO Ibrahim | `tuteur5@<slug>.test` | +225 07 14 32 50 44 |
| T6 | N'GUESSAN Salimata | `tuteur6@<slug>.test` | +225 07 15 35 55 45 |

Enseignants de départ : TRAORE Kouadio (`enseignant@<slug>.test`, c'est le compte « Enseignant »), YAO Fatou (`enseignant2@<slug>.test`), KOUAME Adjoua (`enseignant3@<slug>.test`).

Deux enfants par tuteur (fratries) : le compte **Parent** (T1, DIABATE Séka) voit **Nadia et Salimata** ; le compte **Élève** correspond à **Nadia** (à confirmer par chapitre 20).

## 4. Prolongement de démonstration (`scripts/seed-v2/demo/*.ts`)

Le seed ajoute des données réparties par module : admissions, factures et paiements, présences, évaluations et notes, résultats, bulletins, vie scolaire, conseils, élève affecté par l'État, examens, annonces, imports, personnel et paie, et, au primaire, des compétences, un conseil des maîtres et des bilans. Le détail exact (noms, états, montants) est donné **dans le chapitre du module concerné**, section "Données de départ", avec le fichier source du seed.

## 5. Règles de démonstration et paiement simulé

- Les jeux de règles de calcul (moyennes, passage, BEPC, BAC, CEPE, etc.) sont des **règles de démonstration** : bandeau et filigrane l'indiquent. Aucune règle officielle ivoirienne n'est livrée : n'en tirer aucune conclusion réglementaire. Le supérieur utilise le jeu de la plateforme `CI-HIGHER-LMD`.
- Le fournisseur de paiement est le **« Paiement simulé (démonstration) »** : un montant dont les trois derniers chiffres sont `001` reste **en attente**, `013` **échoue**, tout autre montant **réussit**. Aucun effet externe réel (e-mail, SMS, paiement).
