# Chapitre 3. Structure académique

Ce chapitre couvre l'espace Académique (dossier `app/v2/academic` de l'application web) : années et périodes, paramètres académiques, programmes (filières, séries), curriculum, classes (et fiche de classe), offres de cours (enseignement supérieur), reconduction annuelle et historique des exécutions. Il suit l'ordre de travail d'une école : l'année et ses périodes, les niveaux et les référentiels, les programmes, les matières et le curriculum, les classes, puis la reconduction et la clôture de l'année.

Module API : `apps/api/src/modules/academic`. Les inscriptions (`/v2/enrollments/**`) sont dans le chapitre 4.

**URL réelle.** L'adresse du navigateur est exactement `http://localhost:3000/v2/...` : le dossier `apps/web/src/app/v2/` correspond au préfixe `/v2` (aucune réécriture dans `next.config.js` ni dans `middleware.ts`, qui ne fait que poser des en-têtes). Un refus de droit redirige vers `/unauthorized`, page « Accès refusé » en dehors du préfixe `/v2`.

## Prérequis

- Les trois établissements de démonstration existent (annexe "Données de départ"). On travaille sur l'**année en cours** (2026-2027 pour une base créée en octobre 2026) : si votre base a été créée une autre année, décalez toutes les dates de ce chapitre d'autant.
- Ce chapitre se déroule dans l'ordre. Les scénarios 3.12 à 3.14 sont durables (reconduction, clôture d'une année test) : un seul compte, en dernier.
- Les enregistrements créés portent le suffixe "test guide" ou le préfixe `TG-` ; une année, un programme ou une classe ne se **supprime pas** (voir "Données créées").
- Les menus de gestion s'affichent après la connexion : module « Académique » dans le menu latéral ; en haut de chaque écran, la barre « Cœur académique » reprend les onglets visibles selon vos droits.

## Comptes à utiliser

| Rôle | Collège Le Baobab (`secondaire-test`) | École Les Palmiers (`primaire-test`) | Université Horizon (`superieur-test`) | MFA |
|---|---|---|---|---|
| Directeur des études | `etudes@secondaire-test.test` | `etudes@primaire-test.test` | `etudes@superieur-test.test` | oui |
| Directeur | `directeur@secondaire-test.test` | `directeur@primaire-test.test` | `directeur@superieur-test.test` | oui |
| Propriétaire | `direction.generale@secondaire-test.test` | `direction.generale@primaire-test.test` | `direction.generale@superieur-test.test` | oui |
| Secrétariat (lecture seule ici) | `secretariat@secondaire-test.test` | `secretariat@primaire-test.test` | `secretariat@superieur-test.test` | oui |
| Éducateur (lecture partielle) | `educateur@secondaire-test.test` | `educateur@primaire-test.test` | `educateur@superieur-test.test` | non |
| Enseignant (refus) | `enseignant@secondaire-test.test` | `enseignant@primaire-test.test` | `enseignant@superieur-test.test` | non |

Pour se connecter : `/login`, cliquer sur le compte dans le panneau de droite (aucun mot de passe n'est écrit dans ce guide).

## Droits

Source : `apps/api/src/modules/rbac/templates/system-roles.ts` et gardes de page `requirePermission` dans les fichiers `page.tsx` du dossier `apps/web/src/app/v2/academic`.

| Écran | Permission exigée par la page | Rôles qui y accèdent | Actions d'écriture |
|---|---|---|---|
| `/v2/academic/years` | `academic.year.read` | propriétaire, directeur, directeur des études, secrétariat, économe, éducateur, responsable pédagogique, responsable des examens | créer, modifier, ouvrir : `academic.year.manage` (propriétaire, directeur, études) ; clôturer : `academic.year.close` (propriétaire, directeur) ; périodes : `academic.period.manage` (études), clore : `academic.period.close` (études), rouvrir : `academic.period.reopen` (propriétaire, directeur) |
| `/v2/academic/programs` | `academic.program.read` | idem sauf éducateur | `academic.program.manage` (propriétaire, directeur, études) |
| `/v2/academic/curriculum` | `curriculum.read` | propriétaire, directeur, études, secrétariat, responsable pédagogique | éditer : `curriculum.manage` (études, responsable pédagogique) ; publier : `curriculum.publish` (études) ; amender : `curriculum.amend` (propriétaire, directeur) |
| `/v2/academic/classrooms` et `/v2/academic/classrooms/<identifiant>` | `academic.classroom.read` | propriétaire, directeur, études, secrétariat, économe, éducateur, responsable pédagogique, responsable des examens | créer, activer, terminer, annuler : `academic.classroom.manage` (propriétaire, directeur, études) |
| `/v2/academic/offerings` | `academic.classroom.read` ; fonction "à la carte" de l'offre (supérieur seulement) | mêmes rôles ; ouvrir un semestre : `academic.classroom.manage` | idem |
| `/v2/academic/rollover`, `/v2/academic/rollover/runs`, `/v2/academic/rollover/runs/<identifiant>` | `academic.year.rollover` ; fonction `academic.rollover` de l'offre | propriétaire et directeur seulement | lancer, relancer |
| `/v2/academic/settings` | `academic.read` | propriétaire, directeur, études, secrétariat, économe, responsable pédagogique, responsable des examens (pas l'éducateur) | modifier : `academic.settings.manage` (propriétaire, directeur, études) ; sinon bandeau « Lecture seule » |

**Adresses à taper à la main qui doivent être refusées** (résultat attendu : redirection vers `/unauthorized`, page « Accès refusé » avec le texte "Vous n'avez pas les droits nécessaires pour afficher cette page.", aucune donnée affichée) :

| Compte | Adresses |
|---|---|
| Enseignant | `/v2/academic/years`, `/v2/academic/classrooms`, `/v2/academic/settings`, `/v2/enrollments` |
| Directeur des études | `/v2/academic/rollover`, `/v2/academic/rollover/runs` |
| Secrétariat | `/v2/academic/rollover`, `/v2/academic/rollover/runs`, `/v2/academic/rollover/runs/<identifiant>` (en revanche `/v2/academic/offerings` s'ouvre en lecture, sans aucun bouton d'écriture) |
| Éducateur | `/v2/academic/programs`, `/v2/academic/curriculum`, `/v2/academic/settings`, `/v2/academic/rollover` |

Sur `/v2/academic/classrooms/<identifiant>`, un identifiant inconnu ou d'un autre établissement n'est pas un refus de droit : l'écran affiche le message du serveur du type « Classe introuvable (identifiant). » (texte exact à relever en test).

## Données de départ

Source : `scripts/seed-v2/dataset.ts`, `scripts/seed-v2/scenario.ts` (étape 2), `scripts/dev-v2/seed.ts` et `scripts/seed-v2/demo/primary.ts`. Modèles de pack : `apps/api/src/modules/academic/templates/CI/{primary,secondary,higher}.json`.

| | Collège Le Baobab | École Les Palmiers | Université Horizon |
|---|---|---|---|
| Année | "Année scolaire 2026-2027", code `2026-2027`, 1er septembre 2026 au 31 août 2027, ouverte, courante | idem | idem |
| Périodes | 3 trimestres. Attendu : T1 et T2 « Ouverte » (T2 ouverte par la démonstration), T3 « Planifiée » | 2 semestres (le script de développement force `TWO_SEMESTERS`, voir annexe). Attendu : S1 et S2 « Ouverte » (S2 ouverte par la démonstration de la maternelle) | 2 semestres. Attendu : S1 « Ouverte », S2 « Planifiée » |
| Programmes | `COLLEGE` (libellé du modèle de pack : "Enseignement secondaire — premier cycle") et `LYCEE` (second cycle) | `MATERNELLE` ("Enseignement préscolaire") et `PRIMAIRE` ("Enseignement primaire") | `INFO` "Informatique" (créé par la graine) |
| Curriculum 2026-2027 | version 1 publiée, 5 nœuds : un nœud de niveau (nommé "6e A" par la graine) et 4 matières Français (coef. 3), Mathématiques (3), Anglais (2), Histoire-Géographie (2) | nœud de niveau + Français (3), Mathématiques (3), Éveil (1), Éducation physique (1) ; curriculum de maternelle (Grande Section) à part | niveau, semestre 1, 2 UE, 4 ECUE (Algorithmique 3 crédits coef. 2 ; Programmation 3 ; coef. 1,5 ; Mathématiques 4 ; coef. 2 ; Statistiques 2 ; coef. 1) |
| Classes | `6E-A` "6e A", capacité 40, active | `CP1-A` "CP1 A" capacité 40, active ; `GS-A` "Grande Section A" capacité 25, active | `L1-A` "Licence 1 A" capacité 40, active |
| Politique d'inscription | « Après paiement des frais d'inscription » dans les trois (réglée par la graine) | idem | idem |
| Numéro d'inscription | motif `{PREFIX}-{PROGRAM}-{LEVEL}-{STUDENT_SEQ:4}`, préfixe `DEMO` (ex. `DEMO-COLLEGE-6E-0015`) | idem | idem |
| Matières du catalogue | `FRAN`, `MATH`, `ANG`, `HG` | `FRAN`, `MATH`, `EVEI`, `EPS` | `ALGO`, `PROG`, `MATH`, `STAT` |

Les états exacts des périodes et les effectifs dépendent de l'avancement de la démonstration et des tests déjà joués : **notez ce que vous constatez** avant de commencer.

## Scénarios

#### 3.1 Parcourir l'espace et lire l'année en cours
Compte : Directeur des études (tout établissement) · Où : menu « Académique » > « Années et périodes » (`/v2/academic/years`) · Prérequis : aucun
1. Tapez `/v2/academic` : la page redirige vers `/v2/academic/years`.
2. Repérez le titre « Années académiques » et la ligne "Année scolaire 2026-2027" : colonnes « Année », « Code », « Dates », « État ». Badges « Ouverte » et « Courante ».
3. Cliquez sur « Périodes » en bout de ligne. Le panneau « Périodes de Année scolaire 2026-2027 » s'affiche avec la « Frise de l'année » (légende « Les périodes sont positionnées selon leurs dates sur la durée de l'année. ») et le tableau « Période », « Type », « Dates », « État ».
4. Notez le nombre de périodes et l'état de chacune (« Planifiée », « Ouverte », « Notes closes », « Close »).
5. Constatez que le bouton « Nouvelle année » est visible en haut de page pour ce compte.
Résultat attendu : 3 périodes (secondaire) ou 2 (primaire, supérieur) couvrant l'année sans trou ; les largeurs de la frise suivent les dates du tableau ; une seule année porte « Courante ». Boutons de ligne pour l'année ouverte : « Définir comme courante », « Modifier » (pas de « Clôturer » pour ce compte).
Cas invalides : sans objet (lecture).
- [ ] Cas nominal  - [ ] Cas invalide (sans objet)  - [ ] Droit refusé pour l'enseignant (voir 3.15)

#### 3.2 Créer l'année test guide (avec refus préalables)
Compte : Directeur des études · Où : « Années et périodes » > « Nouvelle année » · Prérequis : 3.1
1. Cliquez sur « Nouvelle année ». La fenêtre « Créer une année académique » s'ouvre. Faites d'abord les **trois essais refusés** du tableau "Cas invalides" (un à un, sans fermer la fenêtre si possible).
2. Puis saisissez le cas nominal :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Code | `TG-2027-2028` | oui (20 caractères au plus, ex. 2026-2027) |
   | Libellé | `Année test guide 2027-2028` | oui |
   | Début | `01/09/2027` (ou `2027-09-01` selon la langue du navigateur) | oui |
   | Fin | (laisser vide) | non (par défaut : douze mois pleins après le début) |
3. Cliquez sur « Nouvelle année » (bouton de validation).
Résultat attendu : message « L'année Année test guide 2027-2028 a été créée. » ; la ligne apparaît avec l'état « Brouillon », sans badge « Courante », dates 1er septembre 2027 au 31 août 2028 ; boutons « Périodes », « Ouvrir », « Modifier ». Il n'existe aucun bouton de suppression d'année. Valeur persistée après rechargement.
Cas invalides (à jouer avant le cas nominal, sauf la dernière ligne) :
| Saisie | Message attendu |
|---|---|
| Tout vide, valider | « Ce champ est obligatoire. » sous Code, Libellé et Début |
| Code `ANNEE 2027!` (espace et point d'exclamation), libellé et début remplis | "Code d'année (ex. 2026-2027), 20 caractères max." |
| Code `2026-2027`, libellé `Doublon`, début `01/09/2027` | "Ce code d'année existe déjà dans l'établissement." |
| Code `TG-FIN`, début `01/09/2027`, fin `01/08/2027` | "La fin de l'année doit suivre son début." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat (aucun bouton « Nouvelle année »)

#### 3.3 Trou et chevauchement entre années
Compte : Directeur des études · Où : « Années et périodes » > « Nouvelle année » · Prérequis : 3.2
1. Ouvrez « Nouvelle année », puis saisissez les deux cas ci-dessous, un à un, en laissant « Libellé » à `Essai test guide`.
Résultat attendu : le message du serveur s'affiche dans la fenêtre, aucune année n'est créée.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Code `TG-TROU`, début `01/09/2029` | "L'année laisse un trou de N jour(s) avec l'année précédente." (N à relever) |
| Code `TG-CHEV`, début `01/12/2026` | "L'année chevauche une autre année de l'établissement." |
- [ ] Cas nominal (sans objet)  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat

#### 3.4 Générer les périodes depuis un plan, modifier, supprimer, ajouter
Compte : Directeur des études · Où : « Années et périodes » > « Périodes » de la ligne "Année test guide 2027-2028" · Prérequis : 3.2
1. Cliquez sur « Périodes » de la ligne de l'année test. Le message « Aucune période pour cette année. » s'affiche, avec « Ajoutez les périodes une à une ou générez-les depuis un plan. »
2. Cliquez sur « Générer depuis un plan ». La fenêtre « Générer les périodes de Année test guide 2027-2028 » s'ouvre.
3. Cliquez d'abord sur « Générer depuis un plan » **sans rien choisir** : le message « Choisissez un plan de périodes. » s'affiche.
4. Choisissez dans « Plan de périodes » : secondaire : "Trois trimestres" ; primaire et supérieur : "Deux semestres". La liste annonce le nombre de périodes ("3 périodes seront créées" ou "2 périodes seront créées") et leurs libellés. Validez.
5. Les périodes sont créées à l'état « Planifiée » et couvrent l'année test sans trou. Relevez les dates et les codes proposés.
6. Sur la **dernière** période : cliquez sur « Modifier ». Changez « Libellé » en `Dernière période test guide`, ne touchez pas aux dates, « Enregistrer ». Message « La période a été mise à jour. »
7. Sur la même période : cliquez sur « Supprimer » (aucune confirmation n'est demandée). Message « La période Dernière période test guide a été supprimée. »
8. Cliquez sur « Ajouter une période » (fenêtre « Ajouter une période à Année test guide 2027-2028 ») et recréez-la :
   | Champ (libellé exact) | Valeur à saisir (secondaire / primaire et supérieur) | Obligatoire |
   |---|---|---|
   | Type de période | Trimestre / Semestre | oui |
   | Numéro d'ordre | `3` / `2` | oui |
   | Code | le code de la période supprimée (voir étape 5), par exemple `T3` / `S2` | oui |
   | Libellé | `Trimestre 3 test guide` / `Semestre 2 test guide` | oui |
   | Période parente | (laisser « Aucune (période de premier niveau) ») | non |
   | Début, Fin | les dates de la période supprimée, relevées à l'étape 5 | oui |
   Validez avec « Ajouter une période ». Message « La période Trimestre 3 test guide a été ajoutée. » (ou "Semestre 2 test guide").
Résultat attendu : le plan est appliqué, la suppression n'est proposée que sur une période « Planifiée », la période recréée retrouve exactement la place de l'ancienne (la frise est recomplétée).
Cas invalides (fenêtre « Ajouter une période ») :
| Saisie | Message attendu |
|---|---|
| Code vide | « Ce champ est obligatoire. » |
| Même type et même numéro d'ordre qu'une période existante | "Ce numéro d'ordre est déjà pris parmi les périodes sœurs de même type." |
| Même code qu'une période existante, autre numéro d'ordre | "Ce code de période existe déjà dans l'année." |
| Fin avant début | "La fin de la période précède son début." |
| Début `31/08/2027` (avant l'année) | "La période dépasse son année." |
| Chevauchement avec une période du même type (autre numéro d'ordre, dates incluses dans T1) | "La période chevauche une période sœur de même type." |
| Réappliquer un plan alors que les périodes existent (« Générer depuis un plan ») | "L'année a déjà des périodes de ces types : supprimez-les (si elles sont encore planifiées) avant d'appliquer le plan." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat (aucun bouton « Générer depuis un plan »)

#### 3.5 Cycle de vie d'une période : ouvrir, clore les notes, clore, rouvrir
Compte : Directeur des études puis Directeur · Où : « Périodes » de l'année test guide · Prérequis : 3.4 · Attention : jamais sur les périodes de 2026-2027
1. Compte études : sur la première période de l'année test, cliquez sur « Ouvrir ». Message attendu : "Ouvrez l'année avant d'ouvrir ses périodes." (l'année est encore « Brouillon »).
2. Dans la liste des années, cliquez sur « Ouvrir » de la ligne de l'année test. Message « L'année Année test guide 2027-2028 est ouverte. » État « Ouverte ».
3. Rouvrez le panneau « Périodes » et cliquez sur « Ouvrir » de la première période : « La période Trimestre 1 est ouverte. » (le libellé affiché est celui du plan, relevez-le).
4. Sur une période « Ouverte », deux boutons sont proposés : « Clore les notes » et « Clore ». Cliquez sur « Clore les notes » : « Les notes de la période … sont closes. », état « Notes closes ». Puis « Clore » : « La période … est close. », état « Close ». **Aucune fenêtre de confirmation n'est demandée avant ces clics.** Le compte études n'a aucun bouton « Rouvrir ».
5. Reconnectez-vous en Directeur. Sur la période close, cliquez sur « Rouvrir » : la fenêtre « Rouvrir la période … » demande un « Motif » (la fenêtre rappelle : "La réouverture d'une période close est sensible : le motif est conservé dans l'historique."). Saisissez `Essai de réouverture test guide` puis « Rouvrir ».
Résultat attendu : « La période … est rouverte. » ; la période revient à « Notes closes » (un pas en arrière). Un motif de moins de 5 caractères (`abc`) donne « Le motif doit comporter au moins 5 caractères. » (ReasonDialog).
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Ouvrir une période alors que l'année est « Brouillon » | "Ouvrez l'année avant d'ouvrir ses périodes." |
| Sur une autre période « Ouverte » (ouvrez-en une seconde), cliquer « Clore » sans passer par « Clore les notes » | "La période est OPEN : seule une période aux notes closes peut être clôturée." (le code d'état est affiché brut, voir Écarts) |
| Rouvrir avec un motif trop court | « Le motif doit comporter au moins 5 caractères. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le directeur des études (pas de « Rouvrir »)

#### 3.6 Paramètres académiques : niveaux, périodes, financements (lecture et un ajout réversible)
Compte : Directeur des études · Où : menu « Académique » > « Paramètres académiques » (`/v2/academic/settings`) · Prérequis : aucun
1. Ouvrez l'écran « Paramètres académiques ». Les rubriques sont des onglets (flèches gauche/droite, Début, Fin au clavier) : « Périodes », « Niveaux », « Statuts et financements », « Inscriptions », « Numérotation », « Calendrier ». Pour un compte sans droit d'écriture (secrétariat), le bandeau « Lecture seule : vous pouvez consulter ces paramètres mais pas les modifier. » s'affiche et les boutons d'ajout disparaissent.
2. Onglet « Périodes » : sections « Types de périodes » (Trimestre, Semestre, Composition, Module, Session normale, Session de rattrapage) et « Plans de périodes » ("Trois trimestres", « Deux semestres » avec le nombre de périodes).
3. Onglet « Niveaux » : sections « Cycles d'enseignement » (ex. secondaire : "Premier cycle du secondaire", "Second cycle du secondaire") et « Niveaux » (ordre, niveau suivant, mentions « Niveau final » et « Examen terminal »). Relevez le niveau suivant du premier niveau (attendu : 5e pour 6e au secondaire, CP2 pour CP1 au primaire, Licence 2 pour Licence 1 au supérieur).
4. Onglet « Statuts et financements » : « Types de financement » (6 types, « Référence exigée » sur « Affecté par l'État », « Financeur exigé » sur Boursier et Pris en charge par une entreprise), « Issues de fin d'année » (Passage, Redoublement, Orientation, Réorientation, Exclusion, Diplômé) et « États gérés par le serveur » (lecture seule).
5. Ajout réversible : onglet « Périodes » > « Ajouter un type » (fenêtre « Ajouter un type de période »). Saisissez :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Code | `TG_MODULE` | oui (majuscules, chiffres et _, 40 caractères au plus, non modifiable ensuite) |
   | Libellé | `Module test guide` | oui |
   | Nature | « Période d'enseignement » | oui |
   Validez : message de confirmation indiquant que le type Module test guide est enregistré (le libellé est encadré de guillemets français dans le message). Le type apparaît dans la liste. Cliquez sur « Désactiver » sur ce type : message de désactivation, le type reste listé comme inactif. **Les référentiels ne se suppriment jamais.**
Résultat attendu : tous les onglets se lisent sans erreur ; l'ajout crée un type actif puis inactif ; aucune suppression n'est proposée.
Cas invalides (même fenêtre) :
| Saisie | Message attendu |
|---|---|
| Code `module test` (minuscules, espace) | "Code en majuscules (A-Z, 0-9, _), 40 caractères max." (message du contrat ; à relever en test) |
| Libellé vide | « Ce champ est obligatoire. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat (lecture seule) et pour l'éducateur (`/v2/academic/settings` refusé)

#### 3.7 Programmes et niveaux couverts
Compte : Directeur des études · Où : onglet « Programmes » (`/v2/academic/programs`) · Prérequis : aucun
1. Ouvrez l'écran « Programmes et séries ». L'arborescence « Arborescence des programmes » liste les programmes avec leur code. Cliquez sur le programme du modèle (secondaire : "Enseignement secondaire — premier cycle" ; primaire : "Enseignement primaire" ; supérieur : "Informatique"). Le détail affiche « Nature », « Domaine », « Durée (mois) », « Cycle diplômant », « Contrat de calcul des résultats » et « Niveaux couverts » (cases cochées : secondaire 6e, 5e, 4e, 3e ; primaire CP1 à CM2 ; supérieur Licence 1).
2. Cliquez sur « Nouveau programme » (fenêtre « Créer un programme ») et saisissez selon l'établissement :
   | Champ (libellé exact) | Secondaire | Primaire | Supérieur | Obligatoire |
   |---|---|---|---|---|
   | Code | `TG-COL` | `TG-PRI` | `TG-LIC` | oui |
   | Libellé | `Collège test guide` | `Primaire test guide` | `Licence test guide` | oui |
   | Niveau d'enseignement | "Premier cycle du secondaire" | « Primaire » | "Licence" | oui |
   | Programme parent | (laisser « Aucun (programme de premier niveau) ») | idem | idem | non |
   | Nature, Domaine | vide | vide | vide | non |
   | Durée (mois) | vide | vide | `36` | non |
   | Contrat de calcul des résultats | vide (hérité) | vide | `credit-semester@1` | non |
   | Cycle diplômant | décoché | décoché | coché | non |
   | Description | `Programme de test du guide` | idem | idem | non |
   Validez avec « Nouveau programme ». Message « Le programme Collège test guide a été créé. » (ou le libellé choisi).
3. Sélectionnez le nouveau programme. Dans « Niveaux couverts », cochez "6e" (secondaire), "CP1" (primaire) ou "Licence 1" (supérieur), puis cliquez sur « Enregistrer les niveaux » : « Les niveaux couverts ont été enregistrés. »
4. Cliquez sur « Modifier » : changez la « Description » en `Programme de test du guide (modifié)` puis « Enregistrer » : « Le programme a été mis à jour. » (le code n'est plus modifiable).
5. Cliquez sur « Archiver » : « Le programme est archivé. » (badge « Archivé »). Cliquez sur « Réactiver » : « Le programme est réactivé. »
Résultat attendu : programme créé, niveaux enregistrés, valeurs persistées après rechargement ; le code reste en majuscules (le champ force la casse).
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Code et Libellé vides | « Ce champ est obligatoire. » (et "Choix invalide." ou « Ce champ est obligatoire. » sous Niveau d'enseignement, à relever) |
| Code `TG COL` (espace) | "Code en majuscules (A-Z, 0-9, _ . -), 40 caractères max." |
| Code `COLLEGE` (déjà pris, secondaire) / `PRIMAIRE` (primaire) / `INFO` (supérieur) | "Ce code de programme existe déjà dans l'établissement." |
| Contrat de calcul `credit` (sans @version) | « Contrat de calcul « code@version » attendu. » |
| Enregistrer les niveaux avec toutes les cases décochées | le bouton « Enregistrer les niveaux » reste inactif (au moins un niveau est exigé) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat (aucun bouton « Nouveau programme »)

#### 3.8 Curriculum : lire, créer, valider, publier, amender, cloner
Compte : Directeur des études (publication), Directeur (amendement) · Où : onglet « Curriculum » (`/v2/academic/curriculum`) · Prérequis : 3.7 (programme `TG-COL` / `TG-PRI` / `TG-LIC` avec son niveau couvert)

*Lecture du curriculum de démonstration*
1. Choisissez dans « Programme » le programme du modèle ("Enseignement secondaire — premier cycle (COLLEGE)", etc.) et dans « Année » "Année scolaire 2026-2027". Constatez « Version du curriculum », la pastille « Publiée », "5 nœuds" (secondaire), la mention « Publiée le … » et le bandeau « Cette version est publiée : elle ne se modifie plus directement. Un amendement motivé et journalisé est possible. » Aucun bouton « Ajouter à la racine ».
2. Cliquez sur « Rapport de validation » : "Le curriculum est valide (3 avertissements)" au secondaire (niveaux couverts sans nœud : 5e, 4e, 3e, affichés par identifiant, voir Écarts). Cliquez sur un nœud : coefficient ou crédits conformes aux données de départ.

*Création d'un curriculum de test*
3. Choisissez le programme test (`TG-COL`, `TG-PRI` ou `TG-LIC`) et l'année "Année scolaire 2026-2027". Le message « Aucun curriculum pour ce programme cette année. » s'affiche avec « Créez une version vierge ou clonez celle d'une autre année depuis un curriculum existant. » Cliquez sur « Créer une version vide » : « La version a été créée. » (état « Brouillon », "Aucun nœud").
4. Cliquez sur « Ajouter à la racine » (fenêtre « Ajouter à la racine ») et créez le nœud de niveau puis les autres nœuds du tableau de l'établissement (les types proposés dépendent de l'emplacement : sous la racine seul « Niveau » est possible). Pour une matière, le champ « Matière » est une recherche dans le catalogue : tapez le nom (ex. `Fran`) et choisissez dans la liste.

   Secondaire (parent : « Niveau »)
   | Type de nœud | Code | Libellé | Matière | Niveau | Coefficient |
   |---|---|---|---|---|---|
   | Niveau | `TG-6E` | `6e test guide` | | 6e | |
   | Matière | `TG-FRAN` | `Français test guide` | Français | | `3` |
   | Matière | `TG-MATH` | `Mathématiques test guide` | Mathématiques | | `3` |
   | Matière | `TG-ANG` | `Anglais test guide` | Anglais | | `2` |

   Primaire (parent : « Niveau »)
   | Type de nœud | Code | Libellé | Matière | Niveau | Coefficient |
   |---|---|---|---|---|---|
   | Niveau | `TG-CP1` | `CP1 test guide` | | CP1 | |
   | Matière | `TG-FRAN` | `Français test guide` | Français | | `3` |
   | Matière | `TG-MATH` | `Mathématiques test guide` | Mathématiques | | `3` |
   | Matière | `TG-EVEI` | `Éveil test guide` | Éveil | | `1` |

   Supérieur (hiérarchie : Niveau > Période > Unité d'enseignement > Élément constitutif)
   | Type de nœud | Parent | Code | Libellé | Matière | Niveau / Période | Crédits | Coefficient |
   |---|---|---|---|---|---|---|---|
   | Niveau | racine | `TG-L1` | `Licence 1 test guide` | | Licence 1 | | |
   | Période | TG-L1 | `TG-S1` | `Semestre 1 test guide` | | Type de période : Semestre ; Rang de la période : `1` | | |
   | Unité d'enseignement | TG-S1 | `TG-UE1` | `UE 1 test guide` | | | `6` | |
   | Élément constitutif d'unité d'enseignement | TG-UE1 | `TG-E11` | `Algorithmique test guide` | Algorithmique | | `3` | `2` |
   | Élément constitutif d'unité d'enseignement | TG-UE1 | `TG-E12` | `Programmation test guide` | Programmation | | `3` | `1,5` (la virgule est acceptée) |

   Pour ajouter un enfant : sélectionnez le nœud parent dans l'arbre puis « Ajouter un enfant ». Chaque ajout affiche « Le nœud … a été ajouté. »
5. Sélectionnez un nœud, cliquez sur « Modifier » puis changez son « Libellé » ; « Enregistrer » : « Le nœud a été mis à jour. » Essayez « Monter » / « Descendre » (réordonne) et « Déplacer » (fenêtre « Déplacer … » avec « Nouveau parent »).
6. Cliquez sur « Rapport de validation » : "Le curriculum est valide (sans avertissement)." (pour le supérieur, un avertissement du type "Aucune période du calendrier ne correspond à TG-S1 (SEMESTER n° 1)." est possible si le calendrier de l'année n'a pas de semestre 1 : relevez-le).
7. Cliquez sur « Publier » (fenêtre « Publier cette version » : "Une version publiée sert de référence aux classes, aux offres et aux notes…"), puis « Publier » : « La version est publiée. » La mention « Publiée le … » apparaît, tous les boutons d'édition disparaissent.
8. Compte **Directeur** : sur la version publiée, sélectionnez la matière `TG-FRAN` (ou `TG-E11`) et cliquez sur « Amender » (fenêtre « Amender … ») : changez le « Coefficient » à `4`, « Continuer », saisissez le motif `Ajustement du coefficient test guide`, « Amender » : « L'amendement a été enregistré. » Cliquez sur « Historique des amendements » : une ligne « Coefficient modifié » avec le motif.
9. Cliquez sur « Cloner vers une autre année » : fenêtre « Cloner vers une autre année », « Année de destination » = "Année test guide 2027-2028". L'aperçu annonce "4 nœuds seront copiés" (secondaire ; 4 pour le primaire ; 5 pour le supérieur) avec le détail par type. Cliquez sur « Cloner » : « Le curriculum a été cloné : la nouvelle version est un brouillon. » (l'écran bascule sur l'année test).
Résultat attendu : version vide créée, nœuds ajoutés, validation sans erreur, publication, amendement tracé, clone en brouillon sur l'année test.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Matière sans choisir de matière, puis « Ajouter » | "Un nœud SUBJECT exige une matière." (code de type brut, voir Écarts) sous « Type de nœud » |
| Deuxième nœud avec le code `TG-FRAN` sous le même parent | "Ce code existe déjà parmi les nœuds frères." |
| Coefficient `abc` ou `-2` | "Décimal attendu (ex. 2 ou 2.5)." |
| Nœud de niveau avec un niveau non couvert par le programme (ex. "5e" pour `TG-COL`) | "Le niveau n'est pas couvert par le programme." |
| Supérieur : `TG-UE1` avec crédits `5` (au lieu de 6) puis « Rapport de validation » | "Les crédits de "TG-UE1" (5) diffèrent de la somme de ses éléments (6)." ; "1 erreur et aucun avertissement à corriger avant publication." ; « Publier » > "Publication refusée : 1 erreur(s) dans le curriculum." |
| Amender avec un motif de 3 caractères | « Le motif doit comporter au moins 5 caractères. » |
| Cloner vers une année qui a déjà une version du programme | avertissement "L'année de destination a déjà une version de ce programme : le clonage sera probablement refusé." puis refus du serveur |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat (lecture seule : ni « Créer une version vide », ni « Publier »)

#### 3.9 Classes : lire, créer, ouvrir la fiche, activer
Compte : Directeur des études · Où : onglet « Classes » (`/v2/academic/classrooms`) · Prérequis : 3.7 ; secondaire et supérieur : programme du modèle avec un curriculum publié 2026-2027 (présent au départ)

*Lire la classe de démonstration*
1. L'écran « Classes et promotions » liste les classes avec les filtres « Année », « Programme », « État » (valeur « Tous »). Colonnes « Classe », « Code », « Programme », « Niveau », « Effectif » (format `x / 40`), « État ». Repérez la classe de démonstration (`6E-A`, `CP1-A` ou `L1-A`), état « Active ».
2. Cliquez sur son nom : la fiche affiche « État », « Année », « Effectif » (`x sur 40`), « Capacité » (« Bloquante » ou « Indicative »), la section « Élèves » (« Nom », « Matricule », « N° d'inscription », « Inscription ») et la section « Enseignants » (« Enseignant », « Rôle », « Portée », « Période ») : Responsable (ou Titulaire de classe au primaire) et Co-enseignants, portée « Toutes les matières ». Boutons du haut : « Toutes les classes », « Terminer », « Annuler la classe » (jamais sur la classe de démonstration).

*Créer les classes test guide*
3. Cliquez sur « Nouvelle classe » (fenêtre « Créer une classe ») et saisissez :
   | Champ (libellé exact) | Secondaire | Primaire | Supérieur | Obligatoire |
   |---|---|---|---|---|
   | Année | Année scolaire 2026-2027 | idem | idem | oui |
   | Programme | "Enseignement secondaire — premier cycle" | "Enseignement primaire" | "Informatique" | oui |
   | Niveau | 6e | CP1 | Licence 1 | oui (seuls les niveaux couverts par le programme sont proposés) |
   | Curriculum | "Version publiée 1 (5 nœuds)" | "Version publiée 1 (5 nœuds)" | "Version publiée 1 (8 nœuds)" | non (obligatoire pour activer) |
   | Code | `TG-6EB` | `TG-CP1B` | `TG-L1B` | oui |
   | Nom | `6e B test guide` | `CP1 B test guide` | `Licence 1 B test guide` | oui |
   | Nature | « Classe » | « Classe » | « Promotion » ou « Classe » | non |
   | Capacité | `30` | `30` | `30` | non |
   | Capacité bloquante | décochée | décochée | décochée | non (visible seulement si une capacité est saisie) |
   | Début, Fin | vides | vides | vides | non |
   Validez avec « Nouvelle classe ». Message « La classe 6e B test guide a été créée. » ; la ligne apparaît à l'état « Brouillon », effectif `0 / 30`.
4. Créez une seconde classe de capacité 1 bloquante, qui servira au chapitre 4 (classe pleine, transfert) : mêmes valeurs mais **Curriculum laissé sur « Aucun »**, Code `TG-6EC` / `TG-CP1C` / `TG-L1C`, Nom `6e C test guide` / `CP1 C test guide` / `Licence 1 C test guide`, Capacité `1`, **Capacité bloquante cochée** (case « Capacité bloquante » : « Refuse toute inscription au-delà de la capacité (sinon simple avertissement). »).
5. Ouvrez la fiche de `6e B test guide` : état « Brouillon ». Cliquez sur « Activer » (fenêtre « Activer 6e B test guide » : "L'activation ouvre la classe aux inscriptions et à la scolarité.") puis « Activer » :
   - secondaire et supérieur : « La classe 6e B test guide est active. » ;
   - **primaire** : refus "Une classe du primaire ne s'active qu'avec un instituteur titulaire : affectez-en un d'abord." (garde du pack primaire). Laissez la classe en « Brouillon » : l'activation sera faite au chapitre 4 (scénario 4.19, Affectations d'enseignement) une fois l'instituteur titulaire désigné, puis revenez ici cliquer sur « Activer ».
   Tentez ensuite d'activer la classe `TG-6EC` / `TG-CP1C` / `TG-L1C` : elle n'a pas de curriculum, le serveur répond "Choisissez un curriculum avant d'activer la classe." (la fiche d'une classe ne se modifie pas : cette classe reste en « Brouillon » pour toute la suite ; une classe en brouillon accepte les inscriptions).
6. Retournez à la liste : filtrez « Année » = Année scolaire 2026-2027 et « État » = « Active » ; la classe active apparaît avec son effectif.
Résultat attendu : classes créées, listées, fiche lisible, activation conforme au pack.
Cas invalides (fenêtre « Créer une classe ») :
| Saisie | Message attendu |
|---|---|
| Tout vide, valider | « Ce champ est obligatoire. » sous Année, Programme, Niveau, Code, Nom |
| Code `TG 6EB` (espace) | "Code en majuscules (A-Z, 0-9, _ . -), 40 caractères max." |
| Code `6E-A` (secondaire) / `CP1-A` / `L1-A` avec le programme du modèle et le niveau de la classe de démonstration | "Ce code de classe existe déjà pour ce programme et ce niveau." |
| Nom `6e A` (secondaire) / `CP1 A` / `Licence 1 A`, code nouveau | "Ce nom de classe existe déjà pour ce programme et ce niveau." |
| Fin `01/09/2026` avec début `01/10/2026` | "La fin de la classe précède son début." |
| Début `01/01/2026` (avant l'année) | "Les dates de la classe dépassent l'année." |
| Capacité `0` | message à relever en test (la capacité doit être strictement positive) |
| Activer `TG-6EC` (classe créée sans curriculum) | "Choisissez un curriculum avant d'activer la classe." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat (aucun bouton « Nouvelle classe »)  - [ ] Isolation : l'adresse d'une classe d'un autre établissement répond "introuvable"

#### 3.10 Offres de cours à la carte (supérieur seulement)
Compte : Directeur des études (`etudes@superieur-test.test`) · Où : onglet « Offres de cours » (`/v2/academic/offerings`) · Prérequis : 3.9 (classe `Licence 1 B test guide`)
1. Dans le Collège et l'École : ouvrez l'adresse. L'écran affiche l'avis « L'inscription à la carte n'est pas incluse dans l'offre de l'établissement. » (la fonction `academic.a-la-carte` n'existe que pour le pack Supérieur). Constatez-le sur `secondaire-test` et `primaire-test`.
2. Dans l'Université : choisissez dans « Classe ou promotion » (recherche) la classe `Licence 1 B test guide`. Le message « Aucune offre dans cette classe. » s'affiche avec "Utilisez « Ouvrir un semestre » pour créer les offres d'une période." (le bouton « Ouvrir un semestre » apparaît en haut).
3. Cliquez sur « Ouvrir un semestre » (assistant, étapes « Période », « Dates et inscriptions », « Récapitulatif ») :
   | Étape | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|---|
   | Période | Période du curriculum | "Semestre 1 (S1)" (nœud de période du curriculum de la classe) | oui |
   | Dates et inscriptions | Début de la période | `15/09/2026` | oui |
   | | Fin de la période | `18/12/2026` | oui |
   | | Ouverture des inscriptions | `01/09/2026` | non (les deux bornes vont ensemble) |
   | | Clôture des inscriptions | `31/10/2026` | non |
   | | Capacité par offre | `25` | non |
   | Récapitulatif | Ouvrir immédiatement les offres | **décochée** | non |
   Cliquez sur « Ouvrir ».
4. Message "2 offres créées ; aucune déjà existante" (une offre par UE inscriptible du semestre ; nombre à relever). Les offres s'affichent avec les colonnes « Offre », « Dates », « Fenêtre d'inscription », « Places prises » (`0 / 25`), « État » (« Brouillon »).
5. Sur une offre, cliquez sur « Ouvrir » : refus "Un responsable d'enseignement est requis pour chaque unité obligatoire avant l'ouverture." (aucun enseignant n'est affecté à `Licence 1 B test guide`).
6. Chapitre 4, scénario 4.19 (Affectations d'enseignement) : affectez un responsable (généraliste) à la classe `TG-L1B`, puis revenez ici : « Ouvrir » donne "L'offre … a été ouverte." (message « L'offre {label} est ouverte. »), puis « Démarrer » (« L'offre … a démarré. ») et, sur une autre offre, « Annuler » (motif obligatoire) : « L'offre … est annulée. »
Résultat attendu : les offres se créent en brouillon ; l'ouverture est conditionnée à l'affectation d'un responsable ; rejouer l'assistant ne crée pas de doublon ("0 offre créée ; 2 déjà existantes").
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Étape « Période » sans rien choisir, « Suivant » | « Choisissez une période. » |
| Fin de la période avant le début | message du contrat ou du serveur : "La date de fin précède la date de début." |
| Dates hors de l'année (début `01/01/2026`) | "Les dates de l'offre dépassent l'année (2026-09-01 -> 2027-08-31)." |
| Une seule borne de fenêtre renseignée | message non visible attendu (le contrat porte sur l'objet entier) : à vérifier en test, voir Écarts |
| Classe sans curriculum rattaché | « Cette classe n'a pas de curriculum rattaché : rattachez-lui une version publiée avant d'ouvrir des offres. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'enseignant (adresse refusée) ; secrétariat : lecture sans bouton « Ouvrir un semestre »

#### 3.11 Paramètres académiques : politique d'inscription, numérotation, calendrier
Compte : Directeur des études (calendrier) puis Directeur (matricules) · Où : « Paramètres académiques » (`/v2/academic/settings`) · Prérequis : aucun · **Ne pas enregistrer les politiques ni la numérotation** (elles pilotent les chapitres suivants)
1. Onglet « Inscriptions » (section « Politiques d'inscription ») : relevez « Confirmation des inscriptions » = « Après paiement des frais d'inscription » (aide : "L'inscription reste en attente jusqu'au paiement des frais d'inscription.") et « Confirmation des cours à la carte ». Ne modifiez rien (le bouton d'enregistrement n'est pas utilisé).
2. Onglet « Numérotation » > « Numéro d'inscription » : relevez « Motif du numéro d'inscription » (`{PREFIX}-{PROGRAM}-{LEVEL}-{STUDENT_SEQ:4}`) et « Préfixe » (`DEMO`). Dans « Motif du numéro d'inscription », saisissez sans enregistrer :
   | Saisie | Aperçu attendu (« Aperçu de forme du motif ») |
   |---|---|
   | `{PREFIX}-{YEAR}` | le jeton "n° d'ordre" est signalé manquant : "Le jeton {STUDENT_SEQ:n} manque : sans lui, deux numéros pourraient être identiques." |
   | `{FOO}-{STUDENT_SEQ:4}` | « Le motif contient un jeton inconnu ou une accolade isolée : le serveur le refusera. » |
   Puis rechargez la page pour abandonner la saisie. Les numéros réels sont attribués par le serveur (mention « Cet aperçu ne montre que la forme du motif. Les numéros réels sont attribués par le serveur. »).
3. Même onglet > « Matricules et dossiers » (compte Directeur) : relevez le motif du matricule élève (attendu `{SEQ:5}`) et la case « Rechercher les doublons à la création » (cochée). Pour un compte sans le droit de gérer les personnes, la section affiche « Les matricules et la conservation des dossiers relèvent d'une autre permission (paramètres des personnes). »
4. Onglet « Calendrier » : lisez le bloc « Jours fériés nationaux » (avertissement "Ces dates sont des valeurs de démonstration à confirmer…", pastilles « À confirmer » et « Activé »/« Désactivé »). Ne désactivez aucun jour (ou rétablissez-le aussitôt par « Activer »).
5. Même onglet, « Jours fériés, vacances et fermetures » : choisissez dans « Année » "Année test guide 2027-2028", cliquez sur « Ajouter une date » (fenêtre « Ajouter une date à l'année Année test guide 2027-2028 ») :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Libellé | `Fête de l'école test guide` | oui |
   | Nature | « Jour férié » | oui |
   | Premier jour | `12/12/2027` | oui |
   | Dernier jour | (vide : un seul jour) | non |
   | Se répète chaque année à la même date | cochée | non |
   | Les cours sont suspendus ce jour-là | décochée | non |
   « Enregistrer ». La date apparaît avec « Jour férié », « Se répète chaque année » et « Les cours ne sont pas suspendus. »
6. Cliquez sur « Modifier » de cette date, changez le « Dernier jour » en `13/12/2027`, « Enregistrer ». Cliquez sur « Supprimer » : fenêtre de confirmation, bouton « Supprimer cette date ». La date disparaît.
Résultat attendu : lecture sans erreur ; aucune politique ni numérotation modifiée ; la date de test est ajoutée, modifiée puis supprimée (la suppression d'une date de calendrier est possible, contrairement aux référentiels).
Cas invalides (fenêtre « Ajouter une date ») :
| Saisie | Message attendu |
|---|---|
| Libellé vide | « Ce champ est obligatoire. » |
| Dernier jour avant le premier | "La fin précède le début." |
| Même libellé et mêmes dates saisis deux fois | "Ce jour férié existe déjà dans le calendrier de l'établissement." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat (aucun bouton d'ajout, bandeau « Lecture seule »)

#### 3.12 Reconduction annuelle : aperçu sans écriture
Compte : Directeur (ou Propriétaire) · Où : menu « Académique » > « Reconduction annuelle » (`/v2/academic/rollover`) · Prérequis : 3.2 à 3.9 (année test guide avec périodes, programme et classes test guide)
1. Avant la création de l'année test (si vous lisez ce scénario en premier) : le sélecteur « Année cible » est vide et le message "Aucune année cible possible : créez d'abord l'année suivante (brouillon) dans « Années et périodes »." apparaît.
2. Étape « Années » : « Année source » = "Année scolaire 2026-2027 (Ouverte, … → …)". « Année cible » (aide "Une année en brouillon ou ouverte, postérieure à l'année source.") = "Année test guide 2027-2028 (Ouverte, …)". Cliquez sur « Suivant ».
3. Étape « Éléments à reconduire » (« Cochez ce que vous voulez copier. Chaque étape peut être refaite sans doublon. ») : cases « Calendrier et périodes », « Jours fériés et vacances », « Curriculum des programmes », « Classes », « Offres de cours à la carte » (visible **uniquement au supérieur**), « Réinscriptions des élèves », puis l'option « Créer les classes de destination qui manquent ». Laissez tout coché. « Suivant ».
4. Étape « Aperçu » : « Aperçu en lecture seule : aucune donnée n'a été modifiée. » Relevez les rubriques :
   - « Périodes à créer » / « Déjà présents » : les périodes de l'année test existent déjà (3.4) ; l'avertissement « L'année cible a déjà des périodes » est attendu ;
   - jours fériés : les dates marquées « Se répète chaque année » seront reportées ; les autres sont comptées « Non répétés (à ressaisir) » ;
   - « Curriculum par programme » : colonnes « Programme », « Version source », « Éléments », « Action » avec « Sera cloné » (programme du modèle), « Existe déjà » (programme test, cloné en 3.8) ou « Aucune source » ;
   - « Classes à créer » : `6e A` (ou `CP1 A`, `Licence 1 A`), `6e B test guide`… avec code et capacité ;
   - réinscriptions : « Réinscriptions à créer », « Déjà reconduites », « Anomalies » et « Répartition par issue de fin d'année » (Passage, Redoublement, Réorientation, Sortie). Des anomalies « Décision de fin d'année manquante » (avec liens « Ouvrir l'inscription ») sont attendues, aucune décision de passage n'étant saisie au départ ; l'avertissement « Décisions de passage manquantes » aussi.
5. Cliquez sur « Actualiser l'aperçu » : le contenu est identique. **Ne passez pas à l'étape suivante.** Ouvrez « Historique des reconductions » (lien en haut de page, `/v2/academic/rollover/runs`) : choisissez « Année source » = Année scolaire 2026-2027 ; le message "Aucune reconduction pour cette année." s'affiche avec « Lancez-en une avec l'assistant. »
Résultat attendu : aucune donnée créée ; avertissements et anomalies lisibles ; historique vide avant tout lancement.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| « Suivant » à l'étape « Années » sans rien choisir | « Choisissez l'année source. » et « Choisissez l'année cible. » |
| Tout décocher à l'étape « Éléments à reconduire », « Suivant » | « Retenez au moins une étape. » |
| « Année source » = Année test guide 2027-2028 | « Année cible » n'a aucune option (aucune année postérieure en brouillon ou ouverte) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le directeur des études et le secrétariat (voir 3.15)

#### 3.13 Lancer la reconduction (Attention : action durable, un seul compte, en dernier)
Compte : Directeur · Où : « Reconduction annuelle » · Prérequis : 3.12 · À faire **dans le Collège (`secondaire-test`) seulement** ; dans les deux autres établissements, arrêtez-vous à l'aperçu
1. Reprenez l'assistant : « Année source » = Année scolaire 2026-2027, « Année cible » = Année test guide 2027-2028.
2. Étape « Éléments à reconduire » : **décochez « Calendrier et périodes » et « Réinscriptions des élèves »** ; laissez cochés « Jours fériés et vacances », « Curriculum des programmes » et « Classes ». (Les périodes de l'année test existent déjà ; décocher les réinscriptions évite de toucher aux élèves de démonstration.)
3. Étape « Aperçu » : vérifiez les rubriques restantes, puis « Suivant ».
4. Étape « Confirmation » (« Relisez le récapitulatif avant de lancer l'exécution. ») : relisez « Année source », « Année cible », « Étapes retenues ». Cliquez d'abord sur « Lancer la reconduction » **sans cocher** : le message « Confirmez que vous avez vérifié l'aperçu. » s'affiche. Cochez « J'ai vérifié l'aperçu » (aide "La reconduction crée des données dans l'année cible…") puis « Lancer la reconduction ».
5. L'écran « Suivi de la reconduction » (`/v2/academic/rollover/runs/<identifiant>`) s'ouvre : sous-titre "De Année scolaire 2026-2027 vers Année test guide 2027-2028", état « En attente du worker » (message sur l'attente du worker), puis « En cours » puis « Terminée ». L'état est relu toutes les 2 secondes (« Actualiser » force la lecture). La section « Progression par étape » montre chaque étape : « En attente », « En cours », « Terminée ».
6. Lisez le « Rapport de reconduction » : éléments créés par étape, "N anomalies à traiter" ou « Aucune anomalie. »
7. Vérifiez le résultat : dans « Classes », filtre « Année » = Année test guide 2027-2028 : les classes de l'année source y figurent (`6e A`, `6e B test guide`, `6e C test guide`) à l'état « Brouillon ». Dans « Curriculum », programme du modèle + année test : une version brouillon.
8. Relancez l'assistant avec les mêmes choix : l'aperçu indique « Déjà présents » pour ce qui existe, aucun doublon n'est créé.
9. Ouvrez « Historique des reconductions » : la ligne de l'exécution (colonnes « Demandée », « Année cible », « État », « Étapes », « Tentatives ») avec le bouton « Ouvrir ».
Résultat attendu : exécution terminée, rapport affiché, rejeu sans doublon, historique alimenté.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Lancer sans cocher « J'ai vérifié l'aperçu » | « Confirmez que vous avez vérifié l'aperçu. » |
| Lancer une seconde reconduction pendant qu'une est « En attente du worker » ou « En cours » | l'aperçu signale "Une reconduction est déjà en attente ou en cours pour ces deux années." avec « Reprendre son suivi » ; le lancement reprend la même exécution |
| Exécution en échec (si le worker s'arrête) | titre "La reconduction s'est arrêtée sur une erreur." et bouton « Relancer » (reprise sans doublon) ; à ne provoquer que si vous maîtrisez l'environnement |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le directeur des études (adresse refusée)

#### 3.14 Clôturer une année (Attention : action irréversible, année test guide seulement)
Comptes : Directeur des études (périodes) puis Directeur (clôture de l'année) · Où : « Années et périodes » · Prérequis : 3.13 terminé
1. Compte Directeur : sur la ligne de l'année test, cliquez sur « Clôturer ». La fenêtre « Clôturer l'année Année test guide 2027-2028 » rappelle : "La clôture d'une année est une opération sensible : elle est journalisée et ne peut pas être annulée depuis cet écran." Laissez le « Motif (facultatif) » vide et cliquez sur « Clôturer ».
2. Refus attendu : "L'année ne peut pas être clôturée : 3 période(s) non clôturée(s) : T1, T2, T3." (secondaire ; codes à relever ; au primaire et au supérieur 2 périodes). L'année reste « Ouverte ».
3. Clôturez maintenant toutes les périodes de l'année test, en repassant au compte Directeur des études : pour chaque période encore « Planifiée » ou « Notes closes » : « Ouvrir » (si planifiée), « Clore les notes », « Clore ». Pour la première période (rouverte en 3.5), « Clore » seulement.
4. Compte Directeur : « Clôturer », motif `Fin des essais du guide test guide`, « Clôturer ». Message « L'année Année test guide 2027-2028 est clôturée. » État « Clôturée » ; les curriculums publiés de l'année passent à « Verrouillée » ; la ligne propose désormais « Archiver » (n'archivez pas : laissez l'année clôturée).
Résultat attendu : refus tant que des périodes ne sont pas closes, clôture possible ensuite, journalisée ; plus de création de classe ni de période dans cette année ("L'année est close : on n'y crée plus de classe.").
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Clôturer avec des périodes non closes | "L'année ne peut pas être clôturée : N période(s) non clôturée(s) : …" |
| Clôturer avec un motif de 3 caractères | « Le motif doit comporter au moins 5 caractères. » (motif facultatif mais, s'il est saisi, il doit faire 5 caractères) |
| Compte Directeur des études sur l'année ouverte | aucun bouton « Clôturer » |
| Créer une classe dans l'année clôturée | "L'année est close : on n'y crée plus de classe." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le directeur des études (pas de « Clôturer »)

#### 3.15 Droits, lecture seule et isolation
Comptes : voir tableau "Droits" · Prérequis : 3.1 à 3.11
1. Compte Enseignant : tapez chacune des adresses `/v2/academic/years`, `/v2/academic/classrooms`, `/v2/academic/settings` et `/v2/enrollments`. Résultat : redirection vers `/unauthorized`, page « Accès refusé », aucune donnée de structure affichée ; le menu n'a pas de module « Académique ».
2. Compte Directeur des études : tapez `/v2/academic/rollover` et `/v2/academic/rollover/runs` : « Accès refusé ». Sur `/v2/academic/years`, aucun bouton « Clôturer » ; sur une période close, aucun « Rouvrir ». La barre « Cœur académique » ne contient pas d'onglet « Reconduction ».
3. Compte Secrétariat : ouvrez `/v2/academic/years`, `/v2/academic/programs`, `/v2/academic/curriculum`, `/v2/academic/classrooms`, `/v2/academic/settings` : tout se lit ; aucun bouton « Nouvelle année », « Générer depuis un plan », « Nouveau programme », « Créer une version vide », « Nouvelle classe » ; le bandeau « Lecture seule : vous pouvez consulter ces paramètres mais pas les modifier. » est présent dans les paramètres. Tapez `/v2/academic/rollover` : « Accès refusé ».
4. Compte Éducateur : `/v2/academic/years` et `/v2/academic/classrooms` s'ouvrent ; `/v2/academic/programs`, `/v2/academic/curriculum`, `/v2/academic/settings`, `/v2/academic/rollover` : « Accès refusé ».
5. Isolation : connecté au Collège, copiez l'adresse d'une fiche de classe `/v2/academic/classrooms/<identifiant>`, puis connectez-vous à l'École (autre établissement) et collez cette adresse : un message du type « Classe introuvable (identifiant). » s'affiche, aucune donnée du Collège n'apparaît.
Résultat attendu : chaque refus redirige vers la page « Accès refusé » ; les boutons d'écriture n'apparaissent pas ; aucune fuite entre établissements.
- [ ] Cas nominal  - [ ] Cas invalide (adresses interdites)  - [ ] Droit refusé pour chacun des rôles ci-dessus

---

## Données créées

**Noms stables utilisés par les autres chapitres** (identiques dans leur forme pour les trois établissements) :

| Objet | Collège Le Baobab | École Les Palmiers | Université Horizon |
|---|---|---|---|
| Année test guide | `TG-2027-2028` "Année test guide 2027-2028" (clôturée en 3.14) | idem | idem |
| Classe test guide (principale) | `TG-6EB` "6e B test guide", programme du modèle `COLLEGE`, niveau 6e, capacité 30, curriculum « Version publiée 1 » ; **active** | `TG-CP1B` "CP1 B test guide", programme `PRIMAIRE`, niveau CP1, capacité 30 ; **brouillon** jusqu'à la désignation d'un titulaire (chapitre 4), puis active | `TG-L1B` "Licence 1 B test guide", programme `INFO`, niveau Licence 1, capacité 30 ; **active** |
| Classe test guide (capacité 1 bloquante) | `TG-6EC` "6e C test guide" | `TG-CP1C` "CP1 C test guide" | `TG-L1C` "Licence 1 C test guide" |
| Programme test guide | `TG-COL` "Collège test guide" | `TG-PRI` "Primaire test guide" | `TG-LIC` "Licence test guide" |
| Élève test guide, tuteur test guide | voir chapitre 4 | voir chapitre 4 | voir chapitre 4 |

Les autres chapitres qui ont besoin d'une classe y inscrivent l'élève test guide (chapitre 4) : `TG-6EB`, `TG-CP1B` (une fois activée) ou `TG-L1B`.

Autres enregistrements : type de période `TG_MODULE` (désactivé), curriculums des programmes test (publiés puis, pour l'année test, clonés puis verrouillés), classes `6E-A`/`6e B test guide`… reconduites en brouillon dans l'année test (secondaire), offres de cours du supérieur, date de calendrier `Fête de l'école test guide` (supprimée).

## Écarts constatés

| Écran | Constat | Gravité |
|---|---|---|
| Matières (`/v2/academic/curriculum`) | Le catalogue de matières ne se crée nulle part dans l'interface (le crochet `useCreateSubject` n'est branché sur aucun écran) : on ne peut qu'utiliser les matières de la graine ou de l'import "Matières et curriculum". Impossible de créer une matière "Informatique test guide". | Majeur |
| Curriculum de démonstration | Le nœud de niveau du curriculum de la graine porte le libellé de la classe ("6e A"), et le rapport de validation affiche les niveaux sans nœud par identifiant (rapport QA C-03-05, C-03-06). | Mineur |
| Messages du serveur | Plusieurs messages exposent des codes bruts : "Transition interdite pour l'année : DRAFT -> OPEN.", "Un nœud SUBJECT exige une matière.", sélecteur de version du curriculum affichant "— DRAFT" lorsque plusieurs versions existent. | Mineur |
| Périodes | « Clore les notes », « Clore » et « Supprimer » une période n'ont pas de fenêtre de confirmation ; seule la clôture de l'année en a une. | Mineur |
| Années | Le bouton « Définir comme courante » reste proposé sur l'année déjà courante. | Suggestion |
| Offres de cours | Une fenêtre d'inscription avec une seule borne ne montre peut-être aucun message sous un champ (l'erreur du contrat porte sur l'objet, pas sur un champ). | Mineur (à vérifier) |
| Années et périodes / Résultats | L'état d'une période du calendrier et l'état de clôture des résultats sont deux états distincts (rapport QA C-03-04, traité comme "par construction mais mal libellé"). | Mineur |
| Reconduction | Le bouton « Suivant » de l'étape « Aperçu » reste muet tant que l'aperçu n'est pas calculé (aucun message). | Suggestion |
| Navigation | Des entrées de menu fournies par le serveur ("Programmes et niveaux", "Reconduction annuelle", "Paramètres académiques") ne sont pas dans les fichiers de messages du web. | Suggestion |

## À vérifier en test

- États réels des périodes de départ (secondaire : T2 ouverte ; primaire : S2 ouverte ?).
- Libellé exact et valeur de N du message de trou entre années ("laisse un trou de N jour(s)").
- Nombre d'offres créées à l'étape « Ouvrir un semestre » (une par UE inscriptible du semestre).
- Message de capacité `0` dans « Créer une classe ».
- Exécution de la reconduction : nécessite un worker en marche ; sinon l'état reste « En attente du worker ».
- Classes reconduites : curriculum rattaché ou non à la classe créée dans l'année test.
- Message exact des libellés de plan ("Trois trimestres", "Deux semestres") : donnée du modèle de pack.
- Clôture des périodes de l'année test (3.14) : les gardes des modules Notes et Résultats peuvent refuser une clôture ; relever le message.
- Classes créées par la reconduction : rattachement ou non d'un curriculum.
- Message à la désactivation d'un type de période (confirmation et type inactif).

## Non couvert / limites connues

- Rattrapage / issues de fin d'année par élève (`enrollment.outcome.record`) : pas d'écran dans l'espace Académique ; les décisions viennent du module Résultats.
- Clôture par classe d'une période (état explicite d'une classe) : aucun écran dans la fiche de classe (spec 004 §9).
- Création de matières (voir Écarts) et édition des types de nœud du curriculum : pas d'écran.
- Édition des niveaux, cycles, plans de périodes, types de financement et issues (onglets « Niveaux » et « Statuts et financements ») : lus seulement, pour ne pas modifier les référentiels partagés.
- Modification des politiques d'inscription et de la numérotation : lecture et aperçu seulement.
- Inscriptions (liste, assistant, fiche) : chapitre 4.
