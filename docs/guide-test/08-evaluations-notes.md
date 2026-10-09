# Chapitre 8. Évaluations et notes

> Établissement principal : **Collège Le Baobab (démonstration)** (pack Secondaire, classe 6e A, trimestres). Variantes courtes à l'**École primaire Les Palmiers** (CP1 A) et à l'**Université Horizon** (Licence 1 A) au scénario 8.17.
> Durée estimée : 2 h 30 à 3 h (circuit complet sur quatre comptes). Les évaluations créées ici (noms "test guide") sont **réutilisées au chapitre 9** (résultats, surcharge, clôture de période) ; les bulletins du chapitre 10 s'appuieront sur elles. **Ne les supprimez pas, ne les modifiez pas en dehors de ce chapitre.**

Ce chapitre couvre toute la chaîne d'une feuille de notes : création, saisie, soumission, relecture, approbation, publication, séparation des tâches (« quatre yeux »), correction après publication, annulation. Les moyennes, rangs, mentions et décisions ne sont **jamais** calculés dans ces écrans : ils le sont par les règles de calcul (chapitre 9).

## Prérequis

- Environnement de départ de `pnpm dev:v2:seed` (annexe `annexe-donnees-de-depart.md`), jamais touché par un autre testeur sur la 6e A, **Trimestre 3** (période « Planifiée » dans le calendrier académique, non verrouillée : les saisies y sont acceptées).
- Les chapitres précédents ne sont pas nécessaires, mais les comptes du tableau ci-dessous doivent exister.
- Une base **déjà utilisée** par d'anciennes séances de test peut contenir des évaluations "test QA" : elles n'ont pas de conséquence, mais le **nombre de lignes** et les moyennes du chapitre 9 seront alors différents.
- Date à saisir pour « Date de l'évaluation » : la **date du jour du test** au format `AAAA-MM-JJ` (exemple : `2026-10-08`). Aucun contrôle n'impose qu'elle tombe dans le trimestre.

## Comptes à utiliser

Connexion : page `/login`, cliquer sur le compte dans le panneau de droite ; pour un compte "MFA", saisir le code du moment proposé (jamais écrit ici).

| Rôle | Établissement | E-mail | MFA | Sert à |
|---|---|---|---|---|
| Enseignant (TRAORE Kouadio) | Collège Le Baobab | `enseignant@secondaire-test.test` | non | créer, saisir, soumettre, demander une correction |
| Responsable pédagogique | Collège Le Baobab | `pedagogie@secondaire-test.test` | oui | relire, approuver (jamais publier) |
| Directeur des études | Collège Le Baobab | `etudes@secondaire-test.test` | oui | superviser, publier, approuver une correction |
| Directeur | Collège Le Baobab | `directeur@secondaire-test.test` | oui | types, réglages, séparation des tâches, annuler |
| Élève (DIABATE Nadia) | Collège Le Baobab | `eleve@secondaire-test.test` | non | vérifier ce que voit l'élève |
| Parent | Collège Le Baobab | `parent@secondaire-test.test` | non | droits refusés |
| Secrétariat | Collège Le Baobab | `secretariat@secondaire-test.test` | oui | droits refusés |
| Instituteur (CP1 A) | École Les Palmiers | `enseignant@primaire-test.test` | non | 8.17 |
| Enseignant (L1 A) | Université Horizon | `enseignant@superieur-test.test` | non | 8.17 |
| Directeur | École Les Palmiers | `directeur@primaire-test.test` | oui | isolation entre établissements |

## Droits

| Écran | Adresse | Qui y accède (permission de page) |
|---|---|---|
| Liste des évaluations | `/v2/assessments` | enseignant et instituteur, responsable pédagogique, directeur des études, directeur, propriétaire, responsable des examens (lecture) : `assessment.read` ou `grade.read` ou `grade.enter` |
| Nouvelle évaluation | `/v2/assessments/new` | enseignant, instituteur (`assessment.create`) ; directeur des études, directeur, propriétaire (`assessment.manage`) |
| Types d'évaluation et réglages | `/v2/assessments/types` | lecture : enseignant, responsable pédagogique, directeur des études, directeur ; **modification : directeur et propriétaire seulement** (`assessment.type.manage`, sensible) |
| Corrections de notes | `/v2/assessments/revisions` | demande : enseignant (`grade.revise.request`) ; décision : directeur des études, directeur, propriétaire (`grade.revise.approve`, sensible) |
| Fiche d'une évaluation | `/v2/assessments/<identifiant>` | comme la liste |
| Feuille de notes | `/v2/assessments/<identifiant>/grades` | `grade.read` ou `grade.enter` : enseignant, responsable pédagogique, directeur des études, directeur, propriétaire |
| Portail enseignant | `/v2/teacher/assessments`, `/v2/teacher/assessments/new`, `/v2/teacher/assessments/<identifiant>`, `/v2/teacher/assessments/<identifiant>/grades` | mêmes permissions ; la création exige `assessment.create` (donc **pas** le directeur des études) |

Qui fait quoi dans le circuit (permission de l'étape ; l'API revérifie) :

| Étape | Permission | Rôles qui l'ont |
|---|---|---|
| Saisir, soumettre | `grade.enter` | enseignant, instituteur, directeur, propriétaire |
| « Marquer comme relue » | `grade.review` | responsable pédagogique, directeur des études, directeur, propriétaire |
| « Approuver » | `grade.validate` (sensible) | responsable pédagogique, directeur des études, directeur, propriétaire |
| « Publier les notes » | `grade.publish` (sensible) | **directeur des études**, directeur, propriétaire (**pas** le responsable pédagogique) |
| Demander une correction après publication | `grade.revise.request` | enseignant, instituteur, directeur, propriétaire |
| Approuver / rejeter une correction | `grade.revise.approve` (sensible) | directeur des études, directeur, propriétaire |

**Adresses à taper à la main qui doivent être refusées** (résultat attendu : redirection vers la page « Accès refusé » `/unauthorized`, texte "Vous n'avez pas les droits nécessaires pour afficher cette page.", aucune donnée) :

| Compte | Adresse | Pourquoi |
|---|---|---|
| Parent | `/v2/assessments` | aucune permission d'évaluation |
| Parent | `/v2/assessments/types` | idem |
| Élève | `/v2/teacher/assessments` | idem |
| Secrétariat | `/v2/assessments/revisions` | pas de droit de correction |
| Responsable pédagogique | `/v2/assessments/new` | il ne crée pas d'évaluation |
| Responsable pédagogique | `/v2/assessments/revisions` | il ne demande ni n'approuve de correction |
| Directeur des études | `/v2/teacher/assessments/new` | `assessment.create` absent (il crée par `/v2/assessments/new` avec `assessment.manage`) |

Une adresse dont l'identifiant n'est pas un UUID (par exemple `/v2/assessments/abc`) donne la page 404 standard de Next.js (en anglais : "This page could not be found.", voir Écarts). Un UUID inexistant ou d'un autre établissement affiche l'erreur "Évaluation introuvable (…)" (à relever en test).

## Données de départ (seed)

Fichiers sources : `scripts/seed-v2/scenario.ts` (étape "évaluations"), `scripts/seed-v2/demo/results.ts` (notes complètes).

- **Collège Le Baobab, 6e A** : 12 évaluations, toutes « Publiée », chacune notée sur 20, coefficient 1, pour **8 élèves** (DIABATE Nadia, DIABATE Salimata, BAMBA Aya, BAMBA Fatou, COULIBALY Moussa, COULIBALY Salimata, TOURE Yao, TOURE Jean-Marc) :
  - "Premier contrôle" en Français et en Mathématiques (type "Devoir") ;
  - "Premier contrôle (suite)" en Anglais et en Histoire-Géographie (type "Devoir") ;
  - "Composition" dans les quatre matières (type "Composition") ;
  - "Devoir de la période 2" dans les quatre matières, période "Trimestre 2".
  Circuit de la graine : saisie et soumission par l'enseignant, relecture et approbation par le responsable pédagogique, publication par le directeur.
- Le **Trimestre 1** est clôturé (résultats définitifs) et le **Trimestre 2** verrouillé : toute saisie ou création dans ces périodes est refusée (voir 8.5 et 8.18). Utilisez **Trimestre 3**.
- Deux élèves inscrits plus tard par le circuit d'admission (ADOU Aïcha, ASSI Brice) sont actifs mais **sans note** dans les feuilles de la graine ; la feuille d'une nouvelle évaluation compte donc environ **10 lignes** (les inscriptions actives). Si votre base a d'autres élèves, les noms et les totaux de ce chapitre sont à adapter ("à vérifier en test").
- 9 types d'évaluation : "Interrogation", "Devoir", "Composition", « Examen blanc » (masqué aux élèves), "Projet", "Oral", « Travaux pratiques », « Autre », "Moyenne saisie". Barème par défaut 20, coefficient 1 pour tous.
- Réglages de saisie par défaut : séparation des tâches cochée (« Le relecteur doit être une autre personne que le saisissant » et « L'approbateur doit être une autre personne que le relecteur »), **2 décimales** autorisées.

## Données de test de ce chapitre

Toutes dans **6e A**, **Trimestre 3**, enseignant TRAORE Kouadio.

| Évaluation | Matière | Type | Barème | Coef. | Sort final |
|---|---|---|---|---|---|
| Devoir n°1 Mathématiques test guide | Mathématiques | Devoir | 20 | 1 | Publiée |
| Interrogation Mathématiques test guide | Mathématiques | Interrogation | 10 | 2 | Publiée |
| Devoir commun test guide | Français | Devoir | 20 | 1 | **Soumise** (laissée en l'état, utilisée au chapitre 9) |
| Devoir commun test guide | Anglais | Devoir | 20 | 1 | Annulée |
| Contrôle direction test guide | Anglais | Devoir | 20 | 1 | Annulée |

Notes de la feuille "Devoir n°1 Mathématiques test guide" (ordre alphabétique de la grille) :

| Élève | Valeur à saisir | État obtenu |
|---|---|---|
| ADOU Aïcha | `14` | Noté |
| ASSI Brice | `9,5` | Noté |
| BAMBA Aya | `ABS` | Absent non justifié |
| BAMBA Fatou | `ABJ` | Absent justifié |
| COULIBALY Moussa | `12,5` | Noté |
| COULIBALY Salimata | `16` | Noté |
| DIABATE Nadia | `18` | Noté |
| DIABATE Salimata | `0` | Noté (vrai zéro) |
| TOURE Jean-Marc | `DISP` | Dispensé |
| TOURE Yao | (laisser vide) | Non évalué après la soumission |

Notes de "Interrogation Mathématiques test guide" (sur 10) : DIABATE Nadia `8`, COULIBALY Salimata `7,5`, DIABATE Salimata `3`, COULIBALY Moussa `6` ; tous les autres élèves restent vides.

---

## Scénarios

#### 8.1 Lire les évaluations de la graine (supervision)
Compte : Directeur des études (`etudes@secondaire-test.test`, MFA) · Où : menu ÉVALUATIONS > "Feuilles à relire", puis la barre « Évaluations et notes » > « Évaluations » (`/v2/assessments`) · Prérequis : seed seul.
1. Ouvrir « Évaluations » : titre « Évaluations », description « Devoirs, compositions et examens : saisie des notes, relecture, approbation et publication. ».
2. Lire le formulaire « Filtres » : « Classe », « Période », « État » (valeur « Tous les états »), case « Seulement mes évaluations » (visible parce que ce compte a `assessment.manage`).
3. Choisir « Classe » = `6e A`, puis « État » = « Publiée ». Lire les colonnes « Évaluation », « Classe », « Type », « Date », « Barème », « État ».
4. Choisir « Période » = `Trimestre 2` : seules les "Devoir de la période 2" restent (4 lignes).
5. Revenir à « Tous les états » puis choisir « Soumise » : le tableau est vide (état vide « Aucune évaluation. », aide « Créez une évaluation ou modifiez les filtres. »).
6. Ouvrir l'évaluation "Composition" (Français) par son titre.
7. Lire la fiche : titre, description "6e A · Français", badge « Publiée », bouton « Voir les notes » (ce compte ne saisit pas), barre « Circuit de validation » ("Brouillon › Soumise › Relue › Approuvée › Publiée"), puis les champs « Type », « Date », « Période », « Barème », « Coefficient », « Session ».
8. Lire la section « Historique du circuit de validation » : une ligne par étape (Brouillon, puis "Brouillon → Soumise", "Soumise → Relue", "Relue → Approuvée", "Approuvée → Publiée"), chacune avec « Par `<nom>` le `<date>` ».
9. Cliquer « Voir les notes » : la feuille s'ouvre en lecture seule.
Résultat attendu : 12 évaluations de la graine, toutes « Publiée » (4 "Composition", 4 "Devoir de la période 2", 2 "Premier contrôle", 2 "Premier contrôle (suite)"). La feuille de "Composition" montre **8 notes sur 20** (1 note par élève du seed), les 2 élèves plus récents sans note, et le message "Notes publiées : elles ne se modifient plus. Utilisez « Corriger » pour demander une correction motivée." ; aucune cellule n'est modifiable. Le titre de la page peut afficher « Sur 20 » ou « Sur 20,000 » (voir Écarts).
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Ouvrir `/v2/assessments/abc` | page 404 standard de Next.js (pas de page v2) |
| Ouvrir `/v2/assessments/00000000-0000-4000-8000-000000000000` | erreur "Évaluation introuvable (00000000-0000-4000-8000-000000000000)." (message à relever en test) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (voir 8.19)

#### 8.2 Types d'évaluation et réglages : lecture seule (rôle sans droit de gestion)
Compte : Responsable pédagogique (`pedagogie@secondaire-test.test`, MFA) · Où : barre « Évaluations et notes » > « Types d'évaluation » (`/v2/assessments/types`) ou menu ÉVALUATIONS > "Types d'évaluation" · Prérequis : seed seul.
1. Ouvrir « Types d'évaluation ». Lire le tableau « Types d'évaluation » : colonnes « Type », « Code », « Groupe », « Barème », « Coef. », « Publication », « État ».
2. Repérer "Devoir" (code `DEVOIR`, groupe `CONTINUOUS`, "/20", « Publication manuelle »), "Composition" (`COMPOSITION`, `EXAM`) et « Examen blanc » (badge « Masqué aux élèves »). Chaque type du seed porte le badge « Modèle ».
3. Lire la rubrique « Réglages de la saisie » : cases « Le relecteur doit être une autre personne que le saisissant » (aide « Recommandé pour les examens. »), « L'approbateur doit être une autre personne que le relecteur » (aide « Quatre yeux avant publication. »), liste « Décimales autorisées » (aide « Nombre maximal de décimales d'une note (0 à 3). »).
Résultat attendu : 9 types ; **aucun** bouton « Nouveau type », « Modifier », « Désactiver » ; les deux cases et la liste sont désactivées et la note « Vous pouvez consulter ces réglages mais pas les modifier. » s'affiche. Le groupe d'agrégation (`CONTINUOUS`, `EXAM`…) est la donnée que lisent les règles de calcul du chapitre 9.
- [ ] Cas nominal  - [ ] Droit refusé pour la modification (aucun bouton)

#### 8.3 Créer, modifier, désactiver un type d'évaluation ; réglage des décimales
Compte : Directeur (`directeur@secondaire-test.test`, MFA) · Où : `/v2/assessments/types` · Prérequis : 8.2 lu.
1. Cliquer « Nouveau type » : la fenêtre « Créer un type d'évaluation » s'ouvre (« Le code ne change plus après la création. »).
2. Remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Code | `TG_QUIZ` (aide : « Majuscules, chiffres et _ (2 à 32 caractères). ») | oui |
   | Libellé | `Quiz test guide` | oui |
   | Groupe d'agrégation | `CONTINUOUS` (aide : « Par exemple CONTINUOUS ou EXAM : lu par les règles de calcul. ») | oui |
   | Barème par défaut | `10` (laisser `20` ailleurs : voir ci-dessous) | non (défaut 20) |
   | Coefficient par défaut | `1` | non (défaut 1) |
   | Mode de publication | « Publication manuelle » | non |
   | Visible des élèves et des parents | cochée | non |
   | Autorise la session de rattrapage | décochée | non |
3. Cliquer « Créer le type ».
4. Sur la ligne "Quiz test guide", cliquer « Modifier » : le code est grisé ; changer « Barème par défaut » en `15`, cliquer « Enregistrer ».
5. Cliquer « Désactiver » sur la ligne "Quiz test guide", puis « Activer », puis de nouveau « Désactiver » (état final : inactif).
6. Rubrique « Réglages de la saisie » : ne **rien** changer sauf si vous le souhaitez pour un test local ; si vous modifiez « Décimales autorisées », **remettre la valeur d'origine (2)** avant de quitter.
Résultat attendu : message « Le type Quiz test guide est enregistré. » ; ligne visible avec « Code » `TG_QUIZ`, « Barème » "/10" puis "/15", badge « Actif » ; messages « Le type Quiz test guide est désactivé. » puis « Le type Quiz test guide est activé. » puis de nouveau "… désactivé." ; le type inactif n'est plus proposé dans « Type d'évaluation » du formulaire de création. Valeurs persistées après rechargement de la page. Un type déjà utilisé par une évaluation ne change plus de groupe ("Le groupe d'agrégation d'un type déjà utilisé ne change plus.").
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Code `tg quiz` (minuscules, espace) | "Code attendu : majuscules, chiffres et _ (2 à 32 caractères)." |
| Code vide | « Ce champ est obligatoire. » |
| Libellé vide | « Ce champ est obligatoire. » |
| Groupe d'agrégation `continu` | "Code attendu : majuscules, chiffres et _ (2 à 32 caractères)." |
| Barème par défaut `abc` | "Valeur décimale attendue (3 décimales au plus)." |
| Code `TG_QUIZ` une seconde fois | Le code TG_QUIZ (entre guillemets dans le message) est déjà utilisé par un type d'évaluation (message du serveur) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le responsable pédagogique (8.2)

#### 8.4 « Mes évaluations » côté enseignant
Compte : Enseignant (`enseignant@secondaire-test.test`) · Où : portail enseignant, menu « Mes évaluations » (`/v2/teacher/assessments`) · Prérequis : seed seul.
1. Ouvrir « Mes évaluations » : titre « Mes évaluations », description « Évaluations de vos classes : créez, saisissez les notes et suivez le circuit de validation. ». Attendre la fin du chargement (un faux message "Aucune classe ne vous est affectée…" peut apparaître quelques secondes : voir Écarts).
2. Lire les colonnes « Évaluation », « Classe », « Matière », « Type », « Date », « État » et le bouton « Voir les notes » de chaque ligne (les évaluations de la graine sont publiées).
3. Filtres : « Classe » = « Toutes mes classes » puis `6e A` ; « État » = « Publiée » puis « Brouillon » (vide).
4. Cliquer sur le titre d'une évaluation : la fiche `/v2/teacher/assessments/<identifiant>` s'ouvre.
Résultat attendu : les 12 évaluations de la graine, toutes « Publiée » ; avec « Brouillon », le message « Aucune évaluation. ». Les quatre "Composition" (ou les quatre "Devoir de la période 2") ont le même titre : la colonne « Matière » permet de les distinguer. Le bouton « Nouvelle évaluation » est visible.
- [ ] Cas nominal  - [ ] État vide

#### 8.5 Créer une évaluation
Compte : Enseignant (`enseignant@secondaire-test.test`) · Où : « Mes évaluations » > « Nouvelle évaluation » (`/v2/teacher/assessments/new`) · Prérequis : 8.4.
1. Cliquer « Nouvelle évaluation » : le formulaire « Nouvelle évaluation » s'ouvre (« Le barème et le coefficient par défaut viennent du type d'évaluation ; vous pouvez les adapter. »).
2. Créer la **première** évaluation :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Type d'évaluation | "Devoir" (l'aide du barème affiche « Par défaut : 20 » ou « Par défaut : 20,000 ») | oui |
   | Intitulé | `Devoir n°1 Mathématiques test guide` | oui |
   | Date de l'évaluation | date du jour (`AAAA-MM-JJ`) | oui |
   | Barème (sur) | (laisser vide : reprend celui du type) | non |
   | Coefficient | (laisser vide : reprend celui du type) | non |
   | Classe | `6e A` | oui |
   | Cours | `Mathématiques` | oui |
   | Période | `Trimestre 3` | oui |
   La case « Créer pour plusieurs classes à la fois » reste décochée ; il n'y a pas de champ « Enseignant » pour ce compte.
3. Cliquer « Créer l'évaluation ».
4. Cliquer « Créer une autre évaluation », puis créer la **seconde** :
   | Champ | Valeur |
   |---|---|
   | Type d'évaluation | "Interrogation" |
   | Intitulé | `Interrogation Mathématiques test guide` |
   | Date de l'évaluation | date du jour |
   | Barème (sur) | `10` |
   | Coefficient | `2` |
   | Classe / Cours / Période | `6e A` / `Mathématiques` / `Trimestre 3` |
5. Cliquer « Créer l'évaluation ».
6. Ouvrir « Mes évaluations » : les deux évaluations sont à l'état « Brouillon ».
Résultat attendu : page « Évaluation créée » avec le message "1 évaluation créée.", le bouton « Saisir les notes » (adresse `/v2/teacher/assessments/<identifiant>/grades`) et le bouton « Créer une autre évaluation ». Dans la liste (`/v2/assessments` ou « Mes évaluations ») : badge « Brouillon ». Sur la fiche : « Barème » `20` (ou `20,000`) et « Coefficient » `1` pour la première ; « Barème » `10` (ou `10,000`) et « Coefficient » `2` pour la seconde ; « Session » « Session 1 ». L'historique du circuit contient une seule ligne « Brouillon ».
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Tout vide, cliquer « Créer l'évaluation » | "Choix invalide." sous « Type d'évaluation », « Ce champ est obligatoire. » sous « Intitulé », « Date attendue au format AAAA-MM-JJ. » sous « Date de l'évaluation », "Choix invalide." sous « Classe », « Cours » et « Période » |
| Barème (sur) `abc` | "Valeur décimale attendue (3 décimales au plus)." |
| Barème (sur) `12,5` (virgule) | "Valeur décimale attendue (3 décimales au plus)." : **ce champ n'accepte que le point** (`12.5`), contrairement à la grille de notes (voir Écarts) |
| Barème (sur) `0` | "Le barème doit être strictement positif." (message du serveur) |
| Coefficient `-1` | "Valeur décimale attendue (3 décimales au plus)." |
| Intitulé de plus de 160 caractères | le champ est limité à 160 caractères à la frappe |
| Période `Trimestre 2` ou `Trimestre 1` (verrouillées) | "La période de cette classe est verrouillée pour cette session." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le responsable pédagogique (`/v2/assessments/new`, 8.19)

#### 8.6 Création pour plusieurs classes ou cours à la fois
Compte : Enseignant · Où : `/v2/teacher/assessments/new` · Prérequis : 8.5.
1. Remplir le haut du formulaire : « Type d'évaluation » = "Devoir", « Intitulé » = `Devoir commun test guide`, « Date de l'évaluation » = date du jour.
2. Cocher « Créer pour plusieurs classes à la fois » (aide « Même type, intitulé, date et période pour chaque classe et cours choisis. ») : les champs « Classe », « Cours » et « Période » simples sont remplacés par le groupe « Classes et cours ».
3. Ligne 1 : « Classe 1 » = `6e A`, « Cours 1 » = `Français`. Cliquer « Ajouter une classe » : ligne 2 : « Classe 2 » = `6e A`, « Cours 2 » = `Anglais`.
4. « Période » (aide « Les périodes sont celles de la première classe. ») = `Trimestre 3`.
5. Cliquer « Créer l'évaluation ».
Résultat attendu : « Évaluation créée », message "2 évaluations créées.", deux lignes "Devoir commun test guide" chacune avec son bouton « Saisir les notes ». Les deux évaluations sont « Brouillon » (Français et Anglais) : visibles par la colonne « Matière » de « Mes évaluations ».
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Une seule ligne, « Classe 1 » et « Cours 1 » vides | message sous « Classes et cours » (au moins une cible) ; le bouton « Retirer » est grisé tant qu'il n'y a qu'une ligne |
| Ligne 2 avec « Classe 2 » sans « Cours 2 » | erreur "Choix invalide." sur la ligne 2 |
- [ ] Cas nominal  - [ ] Cas invalide

#### 8.7 Saisir les notes : codes, zéro, vide, virgule et point, enregistrement
Compte : Enseignant · Où : « Mes évaluations » > "Devoir n°1 Mathématiques test guide" > « Saisir les notes » (`/v2/teacher/assessments/<identifiant>/grades`) · Prérequis : 8.5.
1. Lire l'en-tête : titre de l'évaluation, description "6e A · Mathématiques · Devoir", badge « Brouillon », badge « Sur 20 » (ou « Sur 20,000 »), ligne « Évaluation du `<date>` ». La barre « Circuit de validation » propose « Soumettre la feuille » et « Annuler l'évaluation ».
2. Ouvrir le panneau « Aide à la saisie » (ligne « Entrée ou flèche bas : élève suivant. Maj + Entrée ou flèche haut : élève précédent. Ctrl + S : enregistrer. » ; codes ABS, ABJ, DISP, NN ; « Une absence ou une dispense n'est pas un zéro : saisissez 0 seulement pour une note de zéro. »).
3. Lire la ligne de progression : « 0 sur 10 élèves notés » (le total est le nombre de lignes) et l'indicateur « Aucune modification en attente. ».
4. Saisir dans la colonne « Note (sur 20) » (dans l'ordre alphabétique, **Entrée** passe à l'élève suivant) : voir le tableau "Données de test" ci-dessus : `14`, `9,5`, `ABS`, `ABJ`, `12,5`, `16`, `18`, `0`, `DISP`, et laisser **TOURE Yao** vide. Pour tester le point, saisir pour COULIBALY Moussa `12.5` au lieu de `12,5` : la cellule le reconnaît.
5. Observer, ligne par ligne, la marque « Modifiée », la liste déroulante de la colonne « État » (« Noté », « Absent non justifié », « Absent justifié », « Dispensé », « Non évalué ») qui se met à jour toute seule, et la ligne de progression.
6. Attendre environ 6 secondes sans rien taper : l'enregistrement automatique (case « Enregistrement automatique » cochée) se déclenche. Sinon, cliquer « Enregistrer » ou presser **Ctrl + S**.
7. Recharger la page avec F5.
Résultat attendu : progression « 6 sur 10 élèves notés · 2 absents · 1 dispensé » (6 notes : 14, 9,5, 12,5, 16, 18, 0). Message « Enregistré à `<heure>` — 9 créée(s), 0 modifiée(s), 0 inchangée(s). » (9 lignes écrites : TOURE Yao, resté vide, n'est pas écrit). Chaque ligne enregistrée affiche « Enregistrée ». Après rechargement, les valeurs sont identiques ; "ABS" devient l'état « Absent non justifié » ; **la note `0` de DIABATE Salimata reste un zéro, distinct d'une absence** (état « Noté », valeur 0). Le commentaire facultatif (colonne « Commentaire », 500 caractères) peut recevoir `Copie rendue en retard` pour un élève : il est conservé.
Cas invalides :
| Saisie | Message attendu (sous la cellule, en rouge) |
|---|---|
| `21` sur une feuille sur 20 | « La note dépasse le barème (20,000). » (ou "(20)" selon l'affichage du barème) |
| `abc` | « Saisissez un nombre (par exemple 12,5) ou un code : ABS, ABJ, DISP, NN. » |
| `-3` | même message de format |
| `12,255` (3 décimales, réglage à 2) | « Au plus 2 décimale(s). » |
| `1 2` ou `12,5,5` | même message de format |
| Un code en minuscules `abj` | accepté (devient « Absent justifié ») ; les abréviations `A`, `J`, `D`, `N` sont aussi acceptées |
Quand au moins une ligne est invalide : l'indicateur affiche "1 ligne invalide à corriger" et **rien n'est enregistré** (ni automatiquement, ni par « Enregistrer ») jusqu'à correction. Une ligne restée vide n'est pas un zéro.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : un compte sans `grade.enter` voit la feuille en lecture seule avec « Vous pouvez consulter cette feuille mais pas saisir de notes. » (compte responsable pédagogique)

#### 8.8 Saisir une évaluation sur 10 : bornes du barème
Compte : Enseignant · Où : "Interrogation Mathématiques test guide" > « Saisir les notes » · Prérequis : 8.5.
1. Vérifier le badge « Sur 10 » (ou « Sur 10,000 ») et la colonne « Note (sur 10) ».
2. Saisir `11` pour DIABATE Nadia : le message « La note dépasse le barème (10,000). » apparaît ; corriger en `8`.
3. Saisir `7,5` pour COULIBALY Salimata, `3` pour DIABATE Salimata, `6` pour COULIBALY Moussa. Laisser les autres vides.
4. Cliquer « Enregistrer ».
Résultat attendu : progression « 4 sur 10 élèves notés » ; message « Enregistré à `<heure>` — 4 créée(s), 0 modifiée(s), 0 inchangée(s). ». Une note égale au barème (`10`) est acceptée ; `10,5` est refusée. Reprendre la même grille en modifiant une note puis « Enregistrer » donne "… 1 modifiée(s) …".
Cas invalides :
| Saisie | Message attendu |
|---|---|
| `10,01` | « La note dépasse le barème (10,000). » |
| `10` | accepté (note maximale) |
- [ ] Cas nominal  - [ ] Cas invalide

#### 8.9 Soumettre une feuille ; feuille vide refusée ; annuler un brouillon
Compte : Enseignant · Où : barre « Circuit de validation » de chaque évaluation · Prérequis : 8.6, 8.7, 8.8.
1. **Feuille vide** : ouvrir "Devoir commun test guide" (Anglais) > « Saisir les notes », ne rien saisir, cliquer « Soumettre la feuille ». Résultat : "Une évaluation sans aucune note ne peut pas être soumise." ; l'évaluation reste « Brouillon ».
2. **Annuler ce brouillon** : cliquer « Annuler l'évaluation » ; dans la fenêtre « Annuler l'évaluation » (« L'évaluation sort du circuit ; ses notes ne seront plus prises en compte. ») saisir « Motif de l'annulation » = `Doublon, feuille créée par erreur (test guide)` puis cliquer « Annuler l'évaluation ». Résultat : « L'évaluation est annulée. » ; badge « Annulée » ; message "Évaluation annulée." avec le motif ; la feuille n'est plus modifiable.
3. Ouvrir "Devoir commun test guide" (**Français**) > « Saisir les notes » et saisir `11` pour ADOU Aïcha, `13` pour COULIBALY Moussa, `9,5` pour TOURE Yao ; « Enregistrer » ; cliquer « Soumettre la feuille ».
4. Ouvrir "Devoir n°1 Mathématiques test guide" > « Soumettre la feuille ».
5. Ouvrir "Interrogation Mathématiques test guide" > « Soumettre la feuille ».
6. Revenir sur la feuille "Devoir n°1 Mathématiques test guide".
Résultat attendu : message « La feuille de notes est soumise. » ; état « Soumise » ; la barre affiche « Soumise » en surbrillance ; message « La feuille est soumise au circuit de validation : elle n'est plus modifiable. » ; les cellules sont en lecture seule. **Les élèves restés vides reçoivent automatiquement l'état « Non évalué »** (TOURE Yao dans le devoir n°1 ; les 6 élèves sans note dans l'interrogation) : aucune cellule vide ne subsiste. L'historique du circuit gagne la ligne "Brouillon → Soumise". Si vous soumettez deux fois en double-cliquant, la seconde requête peut afficher "L'évaluation a été modifiée entre-temps : rechargez-la." alors que la première a réussi (voir Écarts).
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Annulation avec un motif de 3 caractères | « Le motif doit comporter au moins 10 caractères. » |
| Soumettre pendant qu'une ligne est invalide | l'enregistrement préalable est refusé, la soumission n'a pas lieu |
- [ ] Cas nominal  - [ ] Cas invalide

#### 8.10 Relecture : feuilles à relire, retour en brouillon avec commentaire
Compte : Responsable pédagogique (`pedagogie@secondaire-test.test`, MFA) · Où : menu ÉVALUATIONS > "Feuilles à relire" (`/v2/assessments?status=SUBMITTED`) · Prérequis : 8.9.
1. Ouvrir "Feuilles à relire" : la liste est filtrée sur l'état « Soumise ». Attendre 3 lignes : les deux évaluations de Mathématiques et "Devoir commun test guide" (Français).
2. Ouvrir "Devoir commun test guide" (Français). Le compte n'a pas de bouton « Saisir les notes » : c'est « Voir les notes ».
3. Cliquer « Renvoyer en brouillon » : la fenêtre « Renvoyer en brouillon » (« Indiquez ce qui doit être corrigé : le commentaire est conservé dans l'historique. ») s'ouvre.
4. Saisir `ok` (2 caractères) dans « Commentaire » et valider : message d'erreur.
5. Saisir `Barème à revoir pour l'exercice 3 (test guide)` et valider.
6. Ouvrir "Devoir n°1 Mathématiques test guide" et "Interrogation Mathématiques test guide" : pour chacune, cliquer « Marquer comme relue ».
Résultat attendu : étape 4 : « Le motif doit comporter au moins 5 caractères. » (le champ s'appelle « Commentaire ») ; étape 5 : « La feuille est renvoyée en brouillon. » et l'état redevient « Brouillon » ; l'historique contient "Soumise → Brouillon" avec le commentaire. Étape 6 : « La feuille de notes est relue. » ; état « Relue » ; l'historique affiche "Soumise → Relue". Le responsable pédagogique voit « Approuver » mais jamais « Publier les notes ».
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Commentaire vide | « Le motif doit comporter au moins 5 caractères. » |
| Ouvrir la même feuille « Soumise » dans deux onglets, relire dans le premier puis dans le second | "L'évaluation a été modifiée entre-temps : rechargez-la." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (aucun bouton « Publier les notes »)

#### 8.11 L'enseignant reprend sa feuille renvoyée ; boutons proposés à tort
Compte : Enseignant · Où : « Mes évaluations » · Prérequis : 8.10.
1. Ouvrir "Devoir commun test guide" (Français) : l'avertissement « Renvoyée en brouillon : Barème à revoir pour l'exercice 3 (test guide) » s'affiche sur la fiche et sur la feuille (« Feuille renvoyée en brouillon : … »).
2. Modifier une note : `13` devient `13,5` pour COULIBALY Moussa ; « Enregistrer » ("… 1 modifiée(s)").
3. Cliquer « Soumettre la feuille » : l'état redevient « Soumise ».
4. Ouvrir "Devoir n°1 Mathématiques test guide" (état « Relue ») : constater les boutons proposés (« Renvoyer en brouillon » et « Annuler l'évaluation » sont visibles) ; cliquer « Renvoyer en brouillon », saisir un commentaire de 10 caractères au moins (`Essai de refus (test guide)`) et valider.
Résultat attendu : étape 3 : « La feuille de notes est soumise. ». Étape 4 : le serveur refuse : "Vous n'avez pas le droit d'effectuer cette étape du circuit de validation." (l'enseignant ne peut reprendre que sa feuille **soumise**, pas une feuille déjà relue ou approuvée) ; la feuille reste « Relue ». Le bouton est cependant proposé à tort (voir Écarts).
- [ ] Cas nominal  - [ ] Cas invalide

#### 8.12 Approuver (confirmation) ; absence de bouton « Publier » ; relecteur = approbateur
Compte : Responsable pédagogique (`pedagogie@secondaire-test.test`) · Où : fiche de chaque évaluation de Mathématiques · Prérequis : 8.11.
1. Ouvrir "Devoir n°1 Mathématiques test guide" (« Relue »). Cliquer « Approuver ».
2. Lire la fenêtre de confirmation « Approuver cette feuille de notes ? » : « L'approbation est un acte sensible. Après approbation, la feuille ne peut plus être modifiée par l'enseignant et peut être publiée. » et « Cette action est définitive : elle ne pourra pas être annulée depuis cet écran. ». Cliquer « Approuver la feuille ».
3. Répéter pour "Interrogation Mathématiques test guide".
4. Chercher le bouton « Publier les notes » sur la fiche.
Résultat attendu : message « La feuille de notes est approuvée. » ; état « Approuvée ». **Aucune fenêtre « Confirmez votre identité » (code à 6 chiffres) n'est demandée** à l'approbation ni à la publication : la preuve MFA est celle de la connexion (compte MFA connecté avec son code). Le bouton « Publier les notes » **n'existe pas** pour ce compte. **Le même compte a relu puis approuvé** la feuille : c'est accepté, car la séparation des tâches porte sur la personne qui a **soumis** (l'enseignant), pas sur le relecteur (décision du développeur, voir Écarts). L'historique contient "Relue → Approuvée".
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Compte non MFA, ou connecté sans MFA, qui tente d'approuver | "Authentification forte (MFA) requise pour cette action." (affiché sous la barre) : cas à relever en test |
- [ ] Cas nominal  - [ ] Droit refusé (pas de bouton « Publier les notes »)

#### 8.13 Publier les notes (irréversible) et lire l'historique
Compte : Directeur des études (`etudes@secondaire-test.test`, MFA) · Où : fiche de l'évaluation · Prérequis : 8.12.
**Attention : action irréversible.** Une note publiée ne se modifie plus que par une correction approuvée (8.15).
1. Ouvrir "Devoir n°1 Mathématiques test guide" (« Approuvée »). Cliquer « Publier les notes ».
2. Lire la fenêtre « Publier les notes ? » : « Les notes publiées deviennent immuables et déclenchent le recalcul des résultats. Une correction ne sera possible que par une demande approuvée. ». Cliquer « Publier les notes ».
3. Répéter pour "Interrogation Mathématiques test guide".
4. Ouvrir « Voir les notes » du devoir n°1.
5. Cliquer « Historique » en face de DIABATE Nadia.
Résultat attendu : message « Les notes sont publiées. » ; état « Publiée » ; texte « Les notes publiées ne se modifient plus : demandez une correction motivée, à faire approuver. ». Feuille en lecture seule avec le message "Notes publiées : elles ne se modifient plus. Utilisez « Corriger » pour demander une correction motivée." ; ce compte voit « Historique » mais pas « Corriger » (il ne demande pas de correction). La fenêtre « Historique de la note de DIABATE Nadia » affiche « Valeur actuelle : 18 », la rubrique « Circuit de validation » (Brouillon, Soumise, Relue, Approuvée, Publiée avec les dates) et « Aucune correction. ». Le calcul des résultats suit **de 10 à quelques dizaines de secondes plus tard** (chapitre 9). La section « Corrections de notes » apparaît au bas de la fiche (« Aucune demande de correction. »).
- [ ] Cas nominal  - [ ] Droit refusé (le responsable pédagogique n'a pas le bouton, 8.12)

#### 8.14 Séparation des tâches : celui qui soumet ne relit pas sa propre feuille
Compte : Directeur (`directeur@secondaire-test.test`, MFA) · Où : barre « Évaluations et notes » > « Nouvelle évaluation » (`/v2/assessments/new`) · Prérequis : seed seul ; réglage « Le relecteur doit être une autre personne que le saisissant » coché (valeur d'origine).
1. Créer l'évaluation :
   | Champ | Valeur |
   |---|---|
   | Type d'évaluation | "Devoir" |
   | Intitulé | `Contrôle direction test guide` |
   | Date de l'évaluation | date du jour |
   | Classe / Cours / Période | `6e A` / `Anglais` / `Trimestre 3` |
   | Enseignant | rechercher `TRAORE` et choisir TRAORE Kouadio (le directeur n'a pas de fiche d'enseignant : sans ce champ, "Indiquez l'enseignant de l'évaluation.") |
2. Cliquer « Créer l'évaluation » puis « Saisir les notes ». Saisir `10` pour ADOU Aïcha et `12` pour DIABATE Nadia ; « Enregistrer » ; « Soumettre la feuille ».
3. Cliquer « Marquer comme relue » sur sa propre feuille.
4. Cliquer « Annuler l'évaluation », saisir `Essai quatre yeux terminé (test guide)`, valider.
Résultat attendu : étape 3 : refus "La personne qui a soumis la feuille ne peut pas la relire, l'approuver ni la publier." (affiché sous la barre) ; l'état reste « Soumise ». Un autre compte (responsable pédagogique) pourrait la relire : ne pas le faire. Étape 4 : « L'évaluation est annulée. », état « Annulée ». Les mêmes refus s'appliqueraient à « Approuver » et à « Publier les notes » pour le soumetteur.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Enseignant laissé vide | "Indiquez l'enseignant de l'évaluation." (champ « Enseignant ») |
| Enseignant non affecté à la matière (par exemple YAO Fatou si elle n'est pas affectée) | "L'enseignant n'est pas affecté à cette matière dans cette classe." (selon les affectations de votre base) |
- [ ] Cas nominal  - [ ] Cas invalide

#### 8.15 Corriger une note publiée : demande, rejet, approbation, historique
Comptes : Enseignant (demande), Directeur des études (décision) · Où : feuille d'une évaluation publiée, puis « Corrections de notes » (`/v2/assessments/revisions`) · Prérequis : 8.13 (période Trimestre 3 **non** verrouillée).
Partie A : l'enseignant demande deux corrections.
1. Compte `enseignant@secondaire-test.test` : "Devoir n°1 Mathématiques test guide" > « Voir les notes ». Le message « Notes publiées : … » s'affiche ; chaque ligne notée propose « Corriger ».2. Cliquer « Corriger » en face de ASSI Brice : la fenêtre « Corriger la note de ASSI Brice » affiche « Valeur publiée : 9,5 ». Remplir :
   | Champ | Valeur | Obligatoire |
   |---|---|---|
   | Nouvelle valeur | `10,5` (aide : « Une note (sur 20) ou un code : ABS, ABJ, DISP, NN. ») | oui |
   | Motif de la correction | `Erreur de report de la copie n°4 (test guide)` (aide : « 10 caractères au moins. ») | oui |
   Cliquer « Envoyer la demande ». Message : « La demande de correction est envoyée pour approbation. »
3. Recommencer pour DIABATE Salimata : « Nouvelle valeur » = `20`, « Motif de la correction » = `Demande volontairement discutable (test guide)`.
4. Ouvrir « Corrections de notes » : les deux demandes sont « Demandée » (filtre « État » = « Demandée » par défaut) ; ce compte n'a **aucun** bouton d'approbation.
Partie B : la direction des études décide.
5. Compte `etudes@secondaire-test.test` : « Corrections de notes ». Pour ASSI Brice ("9,5 → 10,5"), cliquer « Approuver » : fenêtre « Approuver la correction de ASSI Brice » (« La note publiée sera modifiée et la modification sera tracée. »), « Commentaire (facultatif) » = `Copie vérifiée (test guide)`, bouton « Approuver ».
6. Pour DIABATE Salimata, cliquer « Rejeter » : fenêtre « Rejeter la correction de DIABATE Salimata », « Motif du rejet » = `Copie non retrouvée, correction injustifiée (test guide)`, bouton « Rejeter ».
7. Revenir à la feuille du devoir n°1 (compte directeur des études) : « Historique » en face de ASSI Brice, puis de DIABATE Salimata.
Résultat attendu : étape 5 : « Correction approuvée et appliquée. » (la période n'est pas verrouillée) ; pour retrouver la carte, choisir « Tous les états » : elle passe à « Approuvée » puis « Appliquée » avec « Décidée par `<nom>` le `<date>` — Copie vérifiée (test guide) » et « Appliquée le `<date>` ». Étape 6 : « La demande de correction est rejetée. », carte « Rejetée ». La feuille montre `10,5` pour ASSI Brice et toujours `0` pour DIABATE Salimata. Fenêtre « Historique de la note de ASSI Brice » : « Valeur actuelle : 10,5 », liste « Corrections » avec "9,5 → 10,5", badge, « Demandée par `<nom>` le `<date>` », le motif, « Décidée par … ». Le recalcul des résultats suit (chapitre 9 : ASSI Brice passe à 10,5).
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Nouvelle valeur vide | « Indiquez la nouvelle valeur. » |
| Nouvelle valeur `abc` ou `25` | « Valeur invalide : une note entre 0 et 20, ou un code d'état. » |
| Motif de 4 caractères | « Le motif doit faire au moins 10 caractères. » |
| Même valeur que la note publiée (par exemple `0` pour DIABATE Salimata) | "La nouvelle valeur est identique à la valeur publiée." (serveur) |
| Seconde demande sur une note déjà en attente | "Une demande de correction est déjà en cours pour cette note." |
| Rejet sans motif ou avec 2 caractères | « Le motif doit comporter au moins 5 caractères. » |
| Directeur des études cherche « Corriger » sur la feuille | absent (il ne demande pas de corrections) |
Remarque : sur une note de la **graine** (période 1 ou 2 verrouillée), l'approbation donne « Correction approuvée ; elle sera appliquée à la levée du verrou de période. » et la demande reste « Approuvée » avec « Approuvée : elle sera appliquée à la levée du verrou de période. » et un bouton « Appliquer maintenant » : **ne pas le faire** sur les données de la graine.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (enseignant sans bouton d'approbation)

#### 8.16 Ce que voit l'élève : seules les notes publiées
Compte : Élève (`eleve@secondaire-test.test`, DIABATE Nadia) · Où : portail élève, « Mes résultats » (`/v2/student/results`) · Prérequis : 8.13.
1. Ouvrir « Mes résultats » et descendre à « Notes des évaluations ».
2. Lire la ligne "Devoir n°1 Mathématiques test guide" et "Interrogation Mathématiques test guide".
3. Vérifier qu'aucune ligne "Devoir commun test guide" n'apparaît (feuille seulement « Soumise »).
Résultat attendu : "Devoir n°1 Mathématiques test guide" : note `18 / 20` ; "Interrogation Mathématiques test guide" : `8 / 10` ; poids visibles (1 et 2). Les évaluations non publiées sont invisibles. Pour un élève absent le tableau affiche un badge d'état (par exemple « Absent non justifié ») au lieu d'une note ; le texte d'aide « Une absence ou une dispense n'est jamais comptée comme un zéro. » est prévu sous le tableau (à vérifier). Les types masqués (« Examen blanc ») ne sont jamais visibles. Détail de l'écran : chapitre élève.
- [ ] Cas nominal

#### 8.17 Primaire et supérieur : mêmes gestes, session de rattrapage
Partie A : primaire. Compte : Instituteur (`enseignant@primaire-test.test`) · Où : `/v2/teacher/assessments/new`.
1. Créer `Devoir Français test guide` : « Type d'évaluation » = "Devoir", date du jour, « Classe » = `CP1 A`, « Cours » = `Français`, « Période » = la **dernière** période de l'année proposée (non verrouillée), puis « Créer l'évaluation ».
2. Vérifier la fiche, puis « Annuler l'évaluation » avec le motif `Essai primaire terminé (test guide)`.
Résultat attendu : mêmes écrans et mêmes messages qu'en 8.5 et 8.9 ; état final « Annulée ». Les notes sont sur 20 ; l'évaluation par **compétences** (maternelle) ne passe pas par ces écrans (voir "Non couvert").
Partie B : supérieur. Compte : Enseignant (`enseignant@superieur-test.test`) · Où : `/v2/teacher/assessments/new`.
3. Choisir « Type d'évaluation » = "Devoir" : le champ « Session » n'apparaît pas. Choisir « Examen » : le champ « Session » apparaît (si l'offre de l'établissement inclut le rattrapage) avec « Session 1 » et « Session 2 (rattrapage) ».
4. Créer `Devoir Algorithmique test guide` : « Type d'évaluation » = "Devoir", date du jour, « Classe » = `Licence 1 A`, « Cours » = `Algorithmique`, « Période » = `Semestre 2`, puis l'annuler comme en 8.9.
5. Tester le refus : « Période » = `Semestre 1` (clôturé), « Type d'évaluation » = "Devoir", « Session 1 ».
Résultat attendu : étape 3 : liste « Session 1 », « Session 2 (rattrapage) » ; étape 5 : "La période de cette classe est verrouillée pour cette session.". La création d'un examen en **Session 2** sur le Semestre 1 n'est possible qu'après l'ouverture d'une fenêtre de rattrapage : voir 9.18 (chapitre 9).
Cas invalides :
| Saisie | Message attendu |
|---|---|
| « Session 2 (rattrapage) » avec un type qui n'autorise pas le rattrapage | "Ce type d'évaluation n'autorise pas de session de rattrapage." (champ masqué dans l'écran ; message de l'API) |
- [ ] Cas nominal  - [ ] Cas invalide

#### 8.18 Qualité transversale : états, erreurs, clavier, période verrouillée
Compte : Enseignant · Où : feuille d'une évaluation du Trimestre 1 (graine).
1. Ouvrir « Mes évaluations » > une évaluation du Trimestre 1 (graine) > « Voir les notes » : constater le message "Notes publiées : elles ne se modifient plus…" et les cellules en lecture seule.
2. Tenter de créer une évaluation en "Trimestre 1" (8.5, cas invalide) : refus "La période de cette classe est verrouillée pour cette session.". **Le message reste affiché si l'on change ensuite de période** tant que l'on n'a pas recliqué sur « Créer l'évaluation » (voir Écarts).
3. Clavier : sur la feuille d'une évaluation en brouillon, Tab traverse les cellules ; **Entrée** et la flèche bas passent à l'élève suivant, **Maj + Entrée** et la flèche haut à l'élève précédent, **Ctrl + S** enregistre.
4. Réseau : arrêter l'API ou couper le réseau pendant un enregistrement : l'indicateur affiche « Envoi interrompu : vos saisies sont conservées, réessayez. » et le bouton devient « Réessayer l'enregistrement » (aucun doublon à la reprise : la même clé de lot est rejouée, « (lot déjà enregistré, rien n'a été doublé) »).
5. Recharger la feuille avec « Recharger la feuille » après une modification non enregistrée : une confirmation « Des modifications non enregistrées seront perdues. Recharger la feuille ? » est demandée.
Résultat attendu : chaque écran a un état de chargement, un état vide ou une erreur lisible en français ; aucune adresse brute n'est affichée sauf les cas listés en Écarts.
- [ ] Cas nominal

#### 8.19 Droits refusés
Comptes : voir le tableau "Droits". Pour chaque ligne, saisir l'adresse à la main après connexion.
1. Parent : `/v2/assessments`, `/v2/assessments/types`.
2. Élève : `/v2/teacher/assessments`.
3. Secrétariat : `/v2/assessments/revisions`.
4. Responsable pédagogique : `/v2/assessments/new`, `/v2/assessments/revisions`.
5. Directeur des études : `/v2/teacher/assessments/new`.
6. Isolation : copier l'adresse de la fiche "Devoir n°1 Mathématiques test guide" (`/v2/assessments/<identifiant>`), se déconnecter, se connecter avec `directeur@primaire-test.test` et ouvrir la même adresse.
Résultat attendu : étapes 1 à 5 : page « Accès refusé » (`/unauthorized`) sans donnée. Étape 6 : l'évaluation est introuvable ("Évaluation introuvable (…)") : aucune donnée d'un autre établissement n'apparaît.
- [ ] Parent refusé  - [ ] Élève refusé  - [ ] Secrétariat refusé  - [ ] Responsable pédagogique refusé  - [ ] Directeur des études refusé  - [ ] Isolation entre établissements

---

## Données créées

| Enregistrement | Type | Scénario | Établissement |
|---|---|---|---|
| Devoir n°1 Mathématiques test guide | Évaluation (Publiée) | 8.5 à 8.13, 8.15 | Collège Le Baobab |
| Interrogation Mathématiques test guide | Évaluation (Publiée) | 8.5 à 8.13 | Collège Le Baobab |
| Devoir commun test guide (Français) | Évaluation (Soumise, laissée en l'état) | 8.6, 8.9 à 8.11 | Collège Le Baobab |
| Devoir commun test guide (Anglais) | Évaluation (Annulée) | 8.6, 8.9 | Collège Le Baobab |
| Contrôle direction test guide | Évaluation (Annulée) | 8.14 | Collège Le Baobab |
| Quiz test guide (`TG_QUIZ`) | Type d'évaluation (inactif) | 8.3 | Collège Le Baobab |
| Correction ASSI Brice 9,5 → 10,5 | Demande de correction (Appliquée) | 8.15 | Collège Le Baobab |
| Correction DIABATE Salimata 0 → 20 | Demande de correction (Rejetée) | 8.15 | Collège Le Baobab |
| Devoir Français test guide | Évaluation (Annulée) | 8.17 | École Les Palmiers |
| Devoir Algorithmique test guide | Évaluation (Annulée) | 8.17 | Université Horizon |

Notes et états durables : 10 lignes dans "Devoir n°1 Mathématiques test guide" (6 notées, 2 absents, 1 dispensé, 1 non évalué) et 10 lignes dans "Interrogation …" (4 notées, 6 non évaluées).

## Écarts constatés

| Écran | Constat | Gravité |
|---|---|---|
| Réglages de saisie (`/v2/assessments/types`) | Le libellé « L'approbateur doit être une autre personne que le relecteur » laisse croire que l'approbation par le relecteur est refusée ; le code ne compare que la personne qui a **soumis** (voir `apps/api/src/modules/assess/domain/workflow.ts`, `planTransition`). Constat QA C-09-01, décision du développeur : conforme à la spécification, nom du réglage à clarifier ; décision métier en attente (exiger relecteur ≠ approbateur ?) | Majeur (libellé trompeur) |
| Approuver / Publier | Pas de fenêtre « Confirmez votre identité » (step-up MFA) ; seule la MFA de la session compte. QA C-09-02 : décision en attente (MFA récente exigée ou non) | Mineur (décision ouverte) |
| Fiche d'une évaluation depuis `/v2/teacher/assessments/<id>` | Le bouton « Saisir les notes » / « Voir les notes » pointe en dur vers `/v2/assessments/<id>/grades` (habillage de gestion) au lieu de `/v2/teacher/assessments/<id>/grades` | Mineur |
| Barre du circuit | « Renvoyer en brouillon » est proposé à l'enseignant sur une feuille « Relue » ou « Approuvée » alors que l'API le refuse (QA C-07-10) | Mineur |
| Création d'une évaluation | « Barème (sur) » et « Coefficient » refusent la virgule alors que la grille de notes l'accepte | Mineur |
| Affichage du barème | « Sur 20,000 », « Par défaut : 20,000 », « La note dépasse le barème (20,000). » (QA C-07-19) | Suggestion |
| Soumission en double-clic | « La feuille de notes est soumise. » puis "L'évaluation a été modifiée entre-temps : rechargez-la." (QA C-07-11) | Mineur |
| Formulaire d'évaluation | Message "La période de cette classe est verrouillée…" ou "Le motif doit faire…" périmé après correction de la saisie (QA C-07-16) | Mineur |
| Mes évaluations | Faux état vide "Aucune classe ne vous est affectée…" pendant le chargement (QA C-07-01) ; quatre évaluations de même titre (QA C-07-02, résolu par la colonne « Matière ») | Mineur |
| Fiche d'une évaluation | Auteur d'une étape affiché par identifiant de compte pour certains rôles (« Par pedagogie », QA C-09-05) | Mineur |
| Adresse avec identifiant non UUID | 404 standard de Next.js en anglais | Mineur |
| Mise à jour de la page | Erreur d'hydratation React sur « Mes évaluations » (QA C-07-06, corrigée selon le développeur : à revérifier) | Mineur |

## À vérifier en test

- Nombre exact de lignes de la feuille (10 attendu) et noms des élèves récents (ADOU Aïcha, ASSI Brice) sur votre base.
- Affichage du barème ("20" ou "20,000").
- Message exact d'une évaluation inconnue (`/v2/assessments/00000000-0000-4000-8000-000000000000`).
- Message "Authentification forte (MFA) requise pour cette action." lors d'une approbation avec un compte connecté sans MFA.
- Messages "L'enseignant n'est pas affecté à cette matière dans cette classe." (selon les affectations).
- Délai du recalcul des résultats après la publication (10 à 30 secondes).
- Présence du champ « Session » pour le type « Examen » au supérieur (dépend de l'offre de l'établissement).

## Non couvert / limites connues

- Notes par **compétences** (maternelle, `competency-period`) : saisie dans le module primaire (`/v2/primary/competences`), chapitre consacré au primaire.
- Annulation d'une évaluation **publiée** (demande de retrait approuvée en une décision) et ajout d'un élève absent d'une feuille publiée (« Ajouter ») : non exécutés pour ne pas altérer les évaluations réutilisées au chapitre 9.
- Saisie hors ligne et résolution de conflit (« Notes modifiées par quelqu'un d'autre ») : chapitre PWA / hors ligne.
- Collage de colonnes depuis un tableur dans la grille (matricule + note) et import Excel / CSV des notes (chapitre imports).
- Édition d'une évaluation en brouillon (titre, barème, coefficient) : aucun écran n'expose cette modification (l'API le permet).
- Publication automatique (« Publication automatique à l'approbation ») : à tester en créant un type avec ce mode ; non exécuté ici.

## Notes d'audit de l'ancien guide (`docs/GUIDE_UTILISATEUR_TEST.md`, chapitre 8)

- La fenêtre « Confirmez votre identité » à l'approbation et à la publication n'existe plus à cet endroit : ce sont des fenêtres de confirmation « Approuver cette feuille de notes ? » et « Publier les notes ? ».
- L'enregistrement automatique part après environ 6 secondes d'inactivité ; l'ancien guide ne le précisait pas. Le réglage par défaut est de **2** décimales (l'ancien attendu "Au plus 1 décimale(s)" supposait un réglage modifié).
- La séparation des tâches n'empêche pas le relecteur d'approuver ; l'ancien cas C08.N1 reste valable pour le **soumetteur** (le directeur).
- L'ancien guide supposait un "Trimestre 3" ouvert ; il est « Planifié » dans le calendrier mais accepte la saisie.
