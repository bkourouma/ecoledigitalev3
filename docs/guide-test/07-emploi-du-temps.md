# Chapitre 7. Emploi du temps

> Établissement principal : Collège Le Baobab (`secondaire-test`, classe 6e A). Mêmes écrans à l'École Les Palmiers (CP1 A) et à l'Université Horizon (Licence 1 A).
> Adresse de l'application : `http://localhost:3000`. **Le dossier `app/v2/` donne directement le préfixe `/v2`** (aucune réécriture dans `next.config.js` ni `middleware.ts`) : les écrans s'ouvrent à `http://localhost:3000/v2/schedule/...`.
> Durée estimée : 2 h 30 à 3 h. Les scénarios s'enchaînent ; les données "test guide" créées ici sont **réutilisées par le chapitre 06** (séances d'appel du jour, séance de remplacement).

## Prérequis

1. Environnement de l'annexe, base neuve de préférence. Ne **pas** exécuter 7.20 avant d'avoir terminé tous les chapitres qui s'appuient sur l'emploi du temps de démonstration (il archive celui-ci).
2. Les repères de date utilisés dans ce chapitre : **J** = aujourd'hui ; **V1** = le vendredi de la semaine prochaine ; **W1** = le mercredi de la semaine prochaine ; **H** = hier. À adapter selon le jour du test.
3. Le campus : le Collège Le Baobab possède un campus créé à la mise en service (« Campus principal » par défaut). S'il n'apparaît pas dans « Campus » (écran des salles), le signaler (écart).
4. Téléchargements (fichier `.ics`) : l'agent doit demander l'accord de l'utilisateur.

## Comptes à utiliser

| Rôle | E-mail | MFA | Sert à |
|---|---|---|---|
| Directeur des études | `etudes@secondaire-test.test` | oui | concevoir (créneaux, salles, séances, remplacements, générateur) et publier |
| Directeur | `directeur@secondaire-test.test` | oui | tout, dont la publication finale |
| Éducateur | `educateur@secondaire-test.test` | non | lecture et « Constater » |
| Secrétariat | `secretariat@secondaire-test.test` | oui | lecture seule |
| Responsable pédagogique | `pedagogie@secondaire-test.test` | oui | lecture seule |
| Enseignant (TRAORE Kouadio) | `enseignant@secondaire-test.test` | non | « Aujourd'hui », « Mon emploi du temps », export |
| Instituteur CP1 A | `enseignant@primaire-test.test` | non | mêmes écrans au primaire |
| Parent (DIABATE Séka) | `parent@secondaire-test.test` | non | emploi du temps de Nadia et Salimata, export |
| Élève (Nadia) | `eleve@secondaire-test.test` | non | « Mon emploi du temps » |
| Économe | `econome@secondaire-test.test` | oui | contrôle de refus |

Aucun mot de passe ni code MFA n'est écrit ici : cliquer sur le compte dans le panneau de droite de `/v2/login`.

## Droits

| Écran | Adresse | Droit exigé et rôles concernés |
|---|---|---|
| Emploi du temps (semaine ou jour) | `/v2/schedule` | `schedule.read` ou `schedule.own.read` ou `schedule.self.read` ou `schedule.child.read` : direction, directeur des études, éducateur, secrétariat, responsable pédagogique, enseignant, instituteur, parent, élève |
| Aujourd'hui | `/v2/schedule/today` | `schedule.own.read` : enseignant, instituteur, personnel, direction (pas le directeur des études, l'éducateur, le secrétariat) |
| Séances | `/v2/schedule/occurrences` | `schedule.read` : direction, directeur des études, éducateur, secrétariat, responsable pédagogique. Créer : `schedule.manage` ou réservation de salle ou déclaration. Déplacer, salle, remplacer, annuler, rétablir : `schedule.manage`. Constater : `schedule.occurrence.hold` (éducateur, direction) |
| Patrons récurrents, fiche d'un emploi du temps | `/v2/schedule/timetables`, `/v2/schedule/timetables/<id>` | lecture `schedule.read` ; créer, modifier, générer : `schedule.manage` ; publier, archiver : `schedule.publish` |
| Salles et équipements | `/v2/schedule/rooms` | lecture `schedule.read` ; créer, changer l'état : `schedule.room.manage` (directeur des études, direction) |
| Remplacements | `/v2/schedule/replacements` | `schedule.manage` : directeur des études, direction |
| Générateur | `/v2/schedule/generator` (liste, fiche), `/v2/schedule/generator/new` | liste et fiche : `schedule.read` ; lancer, appliquer, abandonner : `schedule.manage` et fonction `scheduling.generation` du plan |
| Export calendrier | `/v2/schedule/export`, `/v2/teacher/schedule/export` | `schedule.read`, `.own.read`, `.self.read` ou `.child.read` ; la version portail exige `schedule.own.read` |
| Mon emploi du temps (portail) | `/v2/teacher/schedule` | `schedule.own.read` : enseignant, instituteur, personnel |

Dépasser un conflit bloquant : droit sensible `schedule.conflict.override` (directeur des études, direction). Valider les séances pour la paie : droit `schedule.occurrence.validate`, **sans écran** (voir "Non couvert").

Un droit manquant mène à la page « Accès refusé » (`/unauthorized`). **Adresses à taper à la main qui doivent être refusées** :
- `parent@secondaire-test.test` : `/v2/schedule/timetables`, `/v2/schedule/rooms`, `/v2/schedule/occurrences`, `/v2/schedule/generator` ;
- `enseignant@secondaire-test.test` : `/v2/schedule/timetables`, `/v2/schedule/rooms`, `/v2/schedule/replacements`, `/v2/schedule/generator`, `/v2/schedule/occurrences` ;
- `educateur@secondaire-test.test` : `/v2/schedule/replacements`, `/v2/schedule/generator/new`, `/v2/schedule/today` ;
- `secretariat@secondaire-test.test` : `/v2/schedule/replacements`, `/v2/schedule/generator/new`, `/v2/schedule/today` ;
- `eleve@secondaire-test.test` : `/v2/schedule/today`, `/v2/schedule/rooms` ;
- `econome@secondaire-test.test` : `/v2/schedule` et toutes les adresses ci-dessus.

## Données de départ

Source : `scripts/seed-v2/scenario.ts` (section "emploi du temps"), `apps/api/src/modules/scheduling/templates/reference-defaults.ts`.

- Un emploi du temps **publié** "Emploi du temps 6E-A" (primaire : "Emploi du temps CP1-A", supérieur : "Emploi du temps L1-A"), valable toute l'année, avec **un cours par matière, du lundi au jeudi, de 08:00 à 10:00**, intervenant TRAORE Kouadio (Responsable) : Français (lundi), Mathématiques (mardi), Anglais (mercredi), Histoire-Géographie (jeudi). Aucune salle affectée.
- Séances datées générées du début de l'année jusqu'à 14 jours après la génération de la base. Au-delà : « Aucune séance cette semaine. »
- Types de salle : "Salle de classe", "Laboratoire", "Amphithéâtre", "Atelier", "Salle de sport", « Autre ». Aucune salle, aucun équipement, aucune grille horaire ni heure d'ouverture, aucun jour férié au départ.
- Enseignants disponibles pour les listes : TRAORE Kouadio (compte `enseignant@`), YAO Fatou, KOUAME Adjoua.
- Règles de conflit : par défaut **bloquant** ("BLOCK") pour l'intervenant, la classe, la salle ; l'équipement aussi.

## Règles à connaître

1. **Chevauchement `[)`** : deux créneaux dont l'un finit à 10:00 et l'autre commence à 10:00 ne se chevauchent pas.
2. Trois ressources sont exclusives : un **intervenant**, une **classe**, une **salle** ne peuvent être sur deux séances au même moment. L'aperçu des conflits est calculé en direct dans le formulaire ; la base de données refuse en dernier recours (même en cas de saisie simultanée).
3. Entre **patrons** (créneaux d'un emploi du temps), les conflits sont recherchés **dans le même emploi du temps** seulement ; les conflits avec les séances déjà datées apparaissent à la génération (« En conflit ») ou à la création d'une séance ponctuelle.
4. Un **brouillon** est modifiable ; un emploi du temps **publié** ne l'est plus ; il n'existe **qu'un emploi du temps publié** par établissement, année et période ; un emploi du temps **archivé** ne se republie jamais.
5. **Générateur** : il calcule une **semaine type unique** (jours et heures, sans dates, sans alternance A/B), toujours en **proposition** ; il n'écrase jamais un emploi du temps publié ; un humain l'applique dans un brouillon, puis publie.
6. Une séance **validée pour la paie** est figée ; l'annulation d'une séance exige un motif de 3 caractères ; le dépassement de conflit exige un motif de 5 caractères et est audité.

## Scénarios

### A. Lire l'emploi du temps

#### 7.1 Lire la semaine d'une classe
Compte : Directeur des études (Collège Le Baobab) · Où : module Emploi du temps, nav « Emploi du temps » (`/v2/schedule`) · Prérequis : aucun.
1. Ouvrir la page : titre « Emploi du temps ». Dans « Afficher », choisir « Classe », puis la classe 6e A (« Choisir une classe »).
2. Lire « Semaine du … au … » : sur grand écran une colonne par jour ; sur téléphone la liste « Séances par jour ».
3. Utiliser « Semaine précédente », « Semaine suivante », « Aujourd'hui ». Passer « Vue » à « Jour », puis « Jour précédent », « Jour suivant ».
4. Changer « Afficher » pour « Enseignant » (TRAORE Kouadio), puis « Salle » (liste vide tant qu'aucune salle n'existe), puis « Élève » (DIABATE Nadia).
5. Cocher « Afficher les séances annulées ».
Résultat attendu : pour la semaine courante (jusqu'à 14 jours après la génération de la base), quatre cours de 08:00 à 10:00, un par jour du lundi au jeudi, avec l'intitulé de la matière et l'intervenant TRAORE Kouadio ; ailleurs « Aucune séance cette semaine. » avec « Changez de période ou de sujet. » ; sans sujet choisi : « Choisissez ce que vous voulez consulter ». Le message "La liste est tronquée : réduisez la période." apparaît si plus de séances que la limite.
Cas invalide : aucun formulaire ; vérifier que les vues « Salle » et « Élève » demandent d'abord un choix.
- [ ] Cas nominal  - [ ] Cas invalide (sujet non choisi)  - [ ] Droit refusé pour le parent (`/v2/schedule/rooms`)

### B. Salles et équipements

#### 7.2 Créer les salles "test guide"
Compte : Directeur des études · Où : nav « Salles et équipements » (`/v2/schedule/rooms`) · Prérequis : aucun.
1. Ouvrir l'écran. Choisir le « Campus » (le premier est présélectionné ; « Établissement » n'apparaît que s'il y en a plusieurs).
2. Cliquer « Ajouter une salle » et créer trois salles :
   | Champ (libellé exact) | Salle 1 | Laboratoire | Petite salle | Obligatoire |
   |---|---|---|---|---|
   | Code | `TG-S1` | `TG-LAB` | `TG-MINI` | oui |
   | Nom | Salle 1 test guide | Laboratoire test guide | Petite salle test guide | oui |
   | Type de salle | Salle de classe | Laboratoire | Autre | oui |
   | Capacité | 40 | 30 | 5 | non (entier 1 au moins) |
   | Bâtiment | Bloc A test guide | Bloc B test guide | Bloc A test guide | non |
   | Équipements fixes | tableau, vidéoprojecteur | paillasses, évier | (vide) | non |
3. Cliquer « Ajouter » à chaque fois.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Code vide | "Ce champ est obligatoire." |
| Nom vide | "Ce champ est obligatoire." |
| Type de salle non choisi | "Ce champ est obligatoire." |
| Capacité `0` | "La valeur doit être supérieure ou égale à 1." |
| Code `TG S1` (espace) | "Code invalide (lettres, chiffres, . _ -)." |
| Code `tg-s1` déjà existant (les codes sont mis en majuscules) | "Cet enregistrement existe déjà." (à relever en test) |
Résultat attendu : "Salle enregistrée." ; les trois salles apparaissent sous « Salles du campus » (colonnes « Nom », « Code », « Type », « Capacité », « Bâtiment », « État » = « Disponible ») ; elles persistent après rechargement ; elles sont aussi proposées dans les listes « Salle » des autres écrans.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : le bouton « Ajouter une salle » est absent pour l'éducateur

#### 7.3 État d'une salle, occupation et équipements
Compte : Directeur des études · Où : « Salles et équipements » · Prérequis : 7.2.
1. Sur la ligne "Petite salle test guide", cliquer « Mettre hors service » : fenêtre "Petite salle test guide : passer à « Hors service »" ; description "La salle n'est plus réservable. Les séances futures concernées sont signalées "à remplacer", sans annulation automatique." Champ « Motif (facultatif) » : "Travaux test guide". Cliquer « Confirmer » : "État de la salle modifié."
2. Dans « Séances », ouvrir « Nouvelle séance » (sans l'enregistrer) : la liste « Salle » **n'inclut plus** "Petite salle test guide" (seules les salles « Disponible » sont proposées).
3. Revenir et cliquer « Remettre en service » puis « Confirmer ». (L'effet d'une salle hors service sur des séances déjà placées est vu au scénario 7.11, étape 5.)
4. Lire « Occupation de la semaine » : "Heures occupées" et "Taux d'occupation" ; sans horaires d'ouverture renseignés : « Horaires d'ouverture non renseignés ».
5. Sous « Équipements » : si l'option est incluse dans l'offre, « Ajouter un équipement » :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Code | `TG-VP` | oui |
   | Libellé | Vidéoprojecteur test guide | oui |
   | Quantité en stock | 1 | oui (entier 1 au moins) |
   Cliquer « Ajouter » : "Équipement enregistré." ; « Modifier » permet de changer libellé, quantité, état. Sinon : "La réservation d'équipements n'est pas incluse dans votre offre."
Cas invalides : « Quantité en stock » `0` → "La valeur doit être supérieure ou égale à 1." ; code vide → "Ce champ est obligatoire."
Résultat attendu : états « Disponible », « Hors service », « Archivée » visibles ; les actions proposées sur chaque ligne sont les deux autres états.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'éducateur (aucune action d'état)

### C. Emplois du temps et créneaux

#### 7.4 Lire la liste, ouvrir le publié, créer un brouillon
Compte : Directeur des études · Où : menu « Emplois du temps » puis nav « Patrons récurrents » (`/v2/schedule/timetables`) · Prérequis : aucun.
1. Lire la liste : colonnes « Nom », « Validité », « Semaine A (lundi) », « Publié le », « État ». Filtrer par « État » : « Brouillon », « Publié », « Archivé ».
2. Ouvrir "Emploi du temps 6E-A" (`/v2/schedule/timetables/<id>`) : badge « Publié » ; section « Créneaux récurrents » : un créneau par jour (Lundi à Jeudi) "08:00 – 10:00" ; message "Seul un brouillon est modifiable." ; boutons « Archiver » et « Générer les séances » ; aucun bouton « Ajouter un créneau ». Dans « Conflits du brouillon » : "Aucun conflit dans ce brouillon."
3. Retour (« Retour »). Cliquer « Nouvel emploi du temps » :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Année scolaire | l'année en cours (présélectionnée) | oui |
   | Nom | Emploi du temps test guide 6e A | oui |
   | Valable du | début de l'année (rempli par défaut) | oui |
   | Valable jusqu'au | fin de l'année (rempli par défaut) | oui |
   | Premier lundi de la semaine A | un lundi de septembre (par exemple le 7 septembre 2026) | non |
   Cliquer « Créer ».
4. Créer un second brouillon "Emploi du temps test guide B" **sans** date de semaine A.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Nom vide | "Ce champ est obligatoire." |
| « Valable jusqu'au » antérieur à « Valable du » | "La fin de validité précède son début." |
| « Premier lundi de la semaine A » = un mardi (par exemple le 8 septembre 2026) | "L'ancre de l'alternance A/B est un lundi." |
Résultat attendu : "Emploi du temps créé en brouillon." ; les deux brouillons apparaissent avec l'état « Brouillon » ; la fiche d'un brouillon affiche "Ajoutez des créneaux : classe, jour, heures, salle et intervenants." (« Aucun créneau. »).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : « Nouvel emploi du temps » absent pour le secrétariat

#### 7.5 Ajouter des créneaux récurrents
Compte : Directeur des études · Où : fiche "Emploi du temps test guide 6e A" · Prérequis : 7.2 et 7.4.
1. Cliquer « Ajouter un créneau » et saisir le premier :
   | Champ (libellé exact) | Créneau P1 | Créneau P2 | Créneau P3 | Obligatoire |
   |---|---|---|---|---|
   | Type | Cours | Cours | Cours | oui |
   | Intitulé | Mathématiques vendredi test guide | Anglais vendredi test guide | Histoire-Géographie semaine A test guide | non |
   | Classe | 6e A | 6e A | 6e A | oui pour un cours |
   | Cours (programme) | Mathématiques | Anglais | Histoire-Géographie | oui pour un cours (exigé par l'API) |
   | Jour | Vendredi | Vendredi | Vendredi | oui |
   | Début | 08:00 | 10:00 | 11:00 | oui |
   | Fin | 10:00 | 11:00 | 12:00 | oui |
   | Salle | Salle 1 test guide (TG-S1) | Laboratoire test guide (TG-LAB) | Aucune salle | non |
   | Alternance | Chaque semaine | Chaque semaine | Semaine A seulement | non |
   | Intervenant 1 / Rôle | TRAORE Kouadio / Responsable | YAO Fatou / Responsable | KOUAME Adjoua / Responsable | non |
   Cliquer « Enregistrer » à chaque fois.
2. Constater : P2 commence à 10:00 pile quand P1 finit : **aucun conflit** (chevauchement `[)`), bien que la classe soit la même.
3. Cliquer « Modifier » sur P3 : le champ « Séances déjà générées » (options « Ne pas modifier » ou « Mettre à jour les séances futures prévues ») apparaît ; changer l'« Intitulé » en "Histoire-Géographie semaine A test guide (modifié)" puis enregistrer : "Créneau modifié."
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Type « Cours », classe vide | "Une classe est obligatoire pour un cours." |
| Type « Cours » avec classe mais « Cours (programme) » vide | "Un cours exige une classe et un nœud de curriculum." (sous « Classe ») |
| « Fin » = « Début » (08:00 et 08:00) | "L'heure de fin doit être postérieure à l'heure de début (pas de patron à cheval sur minuit)." |
| « Fin » 07:00 pour « Début » 09:00 | même message |
| Alternance « Semaine A seulement » dans l'emploi du temps **B** (sans date de semaine A) | message de l'API "Une alternance A/B exige l'ancre (lundi d'une semaine A) sur l'emploi du temps." (le champ « Alternance » n'affiche pas de message d'erreur : possible échec silencieux, à vérifier en test) |
| « Valable à partir du » postérieur à « Valable jusqu'au » | "La fin de validité du patron précède son début." |
Résultat attendu : "Créneau ajouté." ; les trois créneaux apparaissent sous « Vendredi » avec leurs heures, classe, salle, intervenants ; P3 porte le badge « Semaine A » ; la zone « Conflits du brouillon » reste "Aucun conflit dans ce brouillon." ; persiste après rechargement.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : « Ajouter un créneau » absent pour l'éducateur

#### 7.6 Conflits entre créneaux et publication refusée
Compte : Directeur des études · Où : fiche "Emploi du temps test guide 6e A" · Prérequis : 7.5.
1. Tenter d'ajouter trois créneaux **qui doivent être refusés** (chacun « Enregistrer » une fois) :
   | Essai | Saisie | Conflit attendu |
   |---|---|---|
   | C1 intervenant | Type « Réunion », Intitulé "Réunion test guide", Jour Vendredi, 09:00 à 10:00, sans classe, Intervenant 1 = TRAORE Kouadio | l'intervenant TRAORE est « placé sur deux créneaux qui se chevauchent le vendredi » |
   | C2 salle | Type « Réunion », Vendredi 09:00 à 10:00, Salle 1 test guide, Intervenant 1 = KOUAME Adjoua | la salle "Salle 1 test guide" est placée sur deux créneaux |
   | C3 classe | Type « Cours », classe 6e A, Cours "Histoire-Géographie", Vendredi 09:00 à 10:00, sans salle, KOUAME Adjoua | la classe 6e A est placée sur deux créneaux |
   Le message d'erreur en tête de fenêtre est celui de l'API : "<Nom> est placé(e) sur deux créneaux qui se chevauchent le vendredi de 09:00 à 10:00." (le nom est celui de l'enseignant, de la salle ou de la classe ; texte exact à relever en test) ; avec plusieurs conflits, "N conflits de planification : …". Sous le message, la liste « Conflits de planification » indique chaque conflit avec sa nature (« Intervenant », « Salle », « Classe »).
2. Pour C1, le formulaire propose « Motif du dépassement » (réservé aux personnes habilitées, ce qui est le cas du directeur des études) : saisir "Réunion exceptionnelle test guide" puis « Enregistrer » : le créneau est **créé malgré le conflit**.
3. Cliquer « Actualiser » dans « Conflits du brouillon » : le conflit entre P1 et la réunion est listé.
4. Cliquer « Publier » : **refus** : "1 conflit(s) entre patrons : corrigez-les avant de publier."
5. Supprimer la réunion (icône poubelle « Supprimer le créneau de 09:00 ») : "Créneau supprimé." ; « Actualiser » : "Aucun conflit dans ce brouillon."
6. Cliquer « Publier » : **nouveau refus** : "Un emploi du temps est déjà publié pour cet établissement, cette année et cette période." (l'emploi du temps de démonstration est publié). Le brouillon reste « Brouillon » (la publication positive est le scénario 7.20).
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Motif du dépassement de 3 caractères (`abc`) | "Le motif du dépassement doit faire au moins 5 caractères." |
| Publier un emploi du temps vide ("Emploi du temps test guide B") | "Un emploi du temps vide ne peut pas être publié." |
Résultat attendu : aucun créneau conflictuel n'est créé sans motif ; le dépassement est enregistré avec son motif (audit) ; la publication est refusée tant qu'un conflit demeure puis tant qu'un autre emploi du temps est publié.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : « Publier » absent pour l'éducateur et le secrétariat

### D. Séances ponctuelles

#### 7.7 Créer les séances "test guide" et voir les conflits
Compte : Directeur des études · Où : nav « Séances » (`/v2/schedule/occurrences`), bouton « Nouvelle séance » · Prérequis : 7.2.
1. Créer les séances suivantes (une fenêtre « Nouvelle séance » chacune ; champs : « Type », « Intitulé », « Classe », « Cours (programme) », « Date », « Début », « Fin », « Salle », « Intervenants », « Notes ») :
   | Nom (Intitulé) | Type | Classe / Cours | Date | Début | Fin | Salle | Intervenant (Rôle) |
   |---|---|---|---|---|---|---|---|
   | Séance d'appel test guide | Cours | 6e A / Mathématiques | J | 11:00 | 12:00 | Salle 1 test guide | TRAORE Kouadio (Responsable) |
   | Séance d'appel 2 test guide | Cours | 6e A / Anglais | J | 12:30 | 13:30 | Aucune salle | TRAORE Kouadio (Responsable) |
   | Séance d'appel 3 test guide | Cours | 6e A / Français | J | 14:00 | 15:00 | Aucune salle | TRAORE Kouadio (Responsable) |
   | Séance d'appel 4 test guide | Cours | 6e A / Histoire-Géographie | J | 15:30 | 16:30 | Aucune salle | TRAORE Kouadio (Responsable) |
   | Séance de remplacement test guide | Cours | 6e A / Mathématiques | V1 | 14:00 | 15:00 | Laboratoire test guide | TRAORE Kouadio (Responsable) |
   | Réunion de parents test guide | Réunion | (aucune) | W1 | 15:00 | 16:30 | Salle 1 test guide | KOUAME Adjoua (Responsable) |
   | Réunion passée test guide | Réunion | (aucune) | H | 16:00 | 17:00 | Aucune salle | KOUAME Adjoua (Responsable) |
   Cliquer « Créer la séance » à chaque fois. Dans le formulaire, l'aperçu indique d'abord "Renseignez la date et les heures pour vérifier les conflits.", puis "Vérification des conflits…", puis "Aucun conflit détecté sur ce créneau."
2. **Conflits à provoquer** (ne pas enregistrer, ou enregistrer pour constater le refus) : avec la séance "Séance d'appel test guide" existante :
   | Essai | Saisie | Aperçu et refus attendus |
   |---|---|---|
   | Intervenant et classe | Cours, 6e A / Anglais, J, 11:30 à 12:30, TRAORE Kouadio | "2 conflits bloquants" : « Intervenant » et « Classe » ; message "Ce créneau est en conflit : choisissez-en un autre ou demandez un dépassement motivé à une personne habilitée." pour qui n'a pas le droit de dépasser ; à la création : refus 409 |
   | Salle | Réunion, J, 11:00 à 12:00, Salle 1 test guide, KOUAME Adjoua | "1 conflit bloquant" : « Salle » |
   | Adjacence | Réunion, J, 12:00 à 12:30, Salle 1 test guide, KOUAME Adjoua | "Aucun conflit détecté sur ce créneau." (12:00 est la fin de l'autre séance) |
3. **Dépassement motivé** : Type « Réservation de salle », Intitulé "Réservation test guide", J, 11:30 à 12:00, Salle 1 test guide : l'aperçu annonce un conflit bloquant « Salle » ; cocher « Dépasser les conflits bloquants » (aide : "Réservé aux personnes habilitées : le dépassement est motivé, journalisé et audité.") et saisir « Motif du dépassement » : "Réunion urgente validée" ; « Créer la séance ». Résultat : "Séance créée." ; la séance porte le badge « Dérogation » et la zone « Avertissements de planification » liste la réservation non exclusive.
4. **Aide au placement** : dans « Nouvelle séance », avec Intervenant 1 = TRAORE Kouadio et Classe 6e A, section « Aide au placement » : « Durée (minutes) » 60, « À partir du » J, « Jusqu'au » J + 14, cliquer « Chercher des créneaux » ; chaque proposition affiche date, heures et salle ; « Utiliser ce créneau » remplit la date et les heures ; sans résultat : « Aucun créneau libre sur cette période. »
Cas invalides :
| Saisie | Message attendu |
|---|---|
| « Date », « Début » ou « Fin » vides à l'envoi | "Ce champ est obligatoire." |
| Type « Cours » sans classe | "Une classe est obligatoire pour un cours." |
| Type « Cours », classe 6e A, « Cours (programme) » vide | "Une séance de cours exige une classe et un nœud de curriculum." |
| Type « Réservation de salle » sans salle | "Une réservation de salle précise la salle." (en tête de fenêtre) |
| Type « Réservation de salle » avec une classe | "Une réservation de salle ne vise ni classe ni nœud de curriculum." |
| « Fin » antérieure à « Début » | "L'heure de fin doit être postérieure à l'heure de début (une séance ne passe pas minuit : créez-en deux)." |
| Dépassement coché avec motif `abc` | "Le motif du dépassement doit faire au moins 5 caractères." |
| Aide au placement : durée `3` | "La durée doit être un nombre entier de minutes entre 5 et 1440." |
Résultat attendu : "Séance créée." à chaque création ; les séances apparaissent dans la liste (colonnes « Date », « Horaire », « Intitulé », « Classe », « Salle », « Intervenants », « État » = « Prévue ») ; élargir « Du » et « Au » (par défaut aujourd'hui + 13 jours) pour retrouver V1/W1 et H.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : « Nouvelle séance » absent pour le secrétariat

#### 7.8 Déplacer une séance et changer sa salle
Compte : Directeur des études · Où : « Séances » · Prérequis : 7.7.
1. Sur "Réunion de parents test guide", cliquer « Déplacer » : fenêtre « Déplacer la séance » :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Nouvelle date | W1 + 1 jour (le jeudi) | oui |
   | Début | 15:00 | oui |
   | Fin | 16:30 | oui |
   | Motif | "Jeudi plus pratique test guide" | non |
   Cliquer « Déplacer » : "Séance déplacée."
2. Cliquer « Salle » sur la même séance : fenêtre « Changer de salle » ; choisir "Laboratoire test guide" et le motif "Plus de places test guide" ; « Changer la salle » : "Salle modifiée."
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Début ou Fin vide | "Renseignez la date et les heures." |
| Déplacer "Séance d'appel test guide" vers J 12:30 à 13:30 (occupé par "Séance d'appel 2 test guide") | conflit bloquant "Intervenant" et "Classe" avec message de l'API |
| Salle déjà occupée sur ce créneau | conflit bloquant « Salle » |
Résultat attendu : la liste montre la nouvelle date et la nouvelle salle ; l'historique de la séance garde l'ancienne valeur (journal automatique).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : boutons « Déplacer » et « Salle » absents pour l'éducateur

#### 7.9 Annuler et rétablir une séance, effet sur l'appel
Compte : Directeur des études ; Enseignant pour l'effet sur l'appel · Où : « Séances » · Prérequis : 7.7 ; si le chapitre 06 est joué, faire ce scénario **après** 6.8.
1. Sur "Réservation test guide" : « Annuler » : fenêtre « Annuler la séance » ("Le créneau est libéré. Le motif est conservé et communiqué.") :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Motif | "Réservation inutile test guide" | oui (3 caractères au moins) |
   Confirmer « Annuler » : "Séance annulée." ; état « Annulée ». Remarque : la fenêtre porte deux boutons « Annuler » (fermer et confirmer) : écart connu.
2. « Rétablir » : fenêtre « Rétablir la séance » ("La séance annulée redevient prévue, sous réserve de l'absence de conflit.") ; « Motif (facultatif) » vide possible ; "Séance rétablie." Puis l'annuler de nouveau.
3. Sur "Séance d'appel 4 test guide" : « Annuler » avec le motif "Séance supprimée test guide". Avec `enseignant@secondaire-test.test`, ouvrir « Mes appels » > « Faire l'appel » sur cette séance : message de l'API "La séance planifiée est annulée : l'appel ne peut pas être ouvert."
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Motif `ab` | "Le motif doit comporter au moins 3 caractères." |
| Rétablir une séance dont le créneau est maintenant occupé | conflit bloquant, séance non rétablie |
Résultat attendu : filtre « État » = « Annulée » retrouve les séances ; la séance annulée affiche le motif ("Motif : …") dans l'emploi du temps avec « Afficher les séances annulées » coché.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : « Annuler » et « Rétablir » absents pour l'éducateur

#### 7.10 Constater une séance
Compte : Éducateur · Où : « Séances » (régler « Du » sur H) · Prérequis : 7.7.
1. Repérer "Réunion passée test guide" (état « Prévue ») : seul le bouton « Constater » est proposé à l'éducateur (pas « Déplacer », « Salle », « Remplacer », « Annuler »).
2. Cliquer « Constater ».
Résultat attendu selon le code lu : l'écran envoie la demande **sans motif**, alors que l'API exige un motif de 3 caractères pour un constat manuel : le résultat probable est un message d'erreur "Un motif est requis." et la séance reste « Prévue » (écart Majeur, à confirmer). Résultat conforme à la conception : "Séance constatée." et état « Constatée ». Une séance dont l'appel est soumis passe à « Constatée » automatiquement (voir chapitre 06, 6.2).
Cas invalide : « Constater » une séance future (par exemple "Réunion de parents test guide") → "Une séance qui n'a pas encore commencé ne peut pas être constatée." (le bouton reste proposé).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : « Constater » absent pour le secrétariat

### E. Remplacements

#### 7.11 Remplacer un intervenant
Compte : Directeur des études (avec un congé approuvé de TRAORE Kouadio pour le vendredi V1, chapitre 06, 6.20 et 6.21) · Où : nav « Remplacements » (`/v2/schedule/replacements`) · Prérequis : 7.7.
1. **Depuis la liste des séances** (sans congé) : sur "Réunion de parents test guide", cliquer « Remplacer » : fenêtre « Remplacer un intervenant ».
2. Cliquer « Proposer des remplaçants » : la liste « Remplaçants proposés » indique pour chaque enseignant « Disponible » ou « Non recommandé », « Compétent » et "Charge de la semaine : N h" ; cliquer « Choisir » sur YAO Fatou (renseigne « Remplaçant »).
3. Saisir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Intervenant remplacé | KOUAME Adjoua | oui |
   | Remplaçant | YAO Fatou | oui |
   | Motif du remplacement | "Absence de Mme KOUAME test guide" | oui (3 caractères au moins) |
   Cliquer « Remplacer » : "Remplacement enregistré." ; la séance porte YAO Fatou (rôle « Remplaçant »).
4. **Depuis la page « Remplacements »** : après l'approbation du congé de TRAORE Kouadio (V1) et quelques secondes (traitement asynchrone), la page affiche "Séance de remplacement test guide" avec le badge « À remplacer » et la ligne "Cause : …" (le code de la cause, par exemple `STAFF_LEAVE`, s'affiche tel quel : écart connu). Choisir la période « Du » / « Au » pour inclure V1. Cliquer « Remplacer », choisir YAO Fatou ou KOUAME Adjoua, motif "Congé de TRAORE test guide".
5. Variante salle : dans « Salles et équipements » (7.3), mettre "Laboratoire test guide" hors service (la réunion y a été placée en 7.8, la séance de remplacement aussi) : les séances futures qui l'utilisent deviennent « À remplacer » (cause de salle indisponible) ; « Remettre en service » retire ce signalement-là seulement (jamais celui d'un congé).
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Remplaçant non choisi | "Ce champ est obligatoire." |
| Motif `ab` | "Le motif doit faire au moins 3 caractères." |
| Remplaçant = intervenant remplacé | "Le remplaçant doit être une autre personne." |
| Remplaçant déjà intervenant de la séance | "Le remplaçant est déjà intervenant de cette séance." |
| Remplaçant déjà occupé sur ce créneau | conflit bloquant « Intervenant » |
| Aucune séance à remplacer | page vide « Aucune séance à remplacer. » avec « Les séances à remplacer apparaissent ici. » |
Résultat attendu : la séance remplacée perd le badge « À remplacer » lorsque la cause était l'intervenant ; l'historique conserve l'ancien intervenant ; la paie va au remplaçant.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'éducateur (`/v2/schedule/replacements`)

### F. Génération des séances d'un emploi du temps publié

#### 7.12 Générer les séances (rejouable)
Compte : Directeur des études · Où : fiche "Emploi du temps 6E-A" (publié) · Prérequis : la fonction "génération des occurrences" est incluse dans l'offre (sinon le bouton est absent).
1. Cliquer « Générer les séances » (fenêtre « Générer les séances »). Choisir « Du » = lundi de la semaine courante, « Au » = dimanche suivant ; laisser « Plafonner au volume horaire des cours » décoché ; « Générer ».
2. Lire le rapport « Génération du … au … » : « Créées », « Déjà existantes », « Jours bloqués », « En conflit », « Plafonnées ».
3. Relancer **la même période** : « Créées » 0, « Déjà existantes » égal au total précédent (aucun doublon).
4. Étendre « Au » de 14 jours : « Créées » > 0 pour les séances au-delà de la génération de départ.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| « Au » antérieur à « Du » | "La fin de la fenêtre précède son début." |
| Fenêtre hors de la validité de l'emploi du temps | "La fenêtre est hors de la validité de l'emploi du temps." |
| Fenêtre de plus de N semaines | "La fenêtre dépasse le garde-fou de N semaines (paramètre de l'établissement)." |
| Générer depuis un **brouillon** ("Emploi du temps test guide 6e A") | le bouton « Générer les séances » est absent ; l'API répondrait "Seul un emploi du temps publié génère des occurrences." |
Résultat attendu : séances créées visibles dans « Séances » ; relance sans doublon ; « En conflit » > 0 uniquement si une séance ponctuelle occupe déjà le créneau d'un cours (ce n'est pas le cas avec les séances "test guide" de 11:00 et plus).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : bouton absent pour l'éducateur

### G. Enseignant, export, vues par rôle

#### 7.13 « Aujourd'hui » et « Mon emploi du temps » de l'enseignant
Compte : Enseignant (TRAORE Kouadio) · Où : portail enseignant, menus « Aujourd'hui » (`/v2/teacher`) et « Mon emploi du temps » (`/v2/teacher/schedule`) ; la liste du jour existe aussi dans l'habillage de l'emploi du temps (`/v2/schedule/today`) · Prérequis : 7.7.
1. Ouvrir `/v2/schedule/today` (ou `/v2/teacher`) : titre « Aujourd'hui », "Vos séances du …". Les quatre "Séance d'appel … test guide" du jour apparaissent, chacune avec « Appel à faire » et le bouton « Faire l'appel » (devient « Voir l'appel » une fois l'appel soumis) ; « Saisir les notes » est proposé si l'enseignant a le droit de saisie.
2. Ouvrir « Mon emploi du temps » (`/v2/teacher/schedule`) : uniquement le mode « Mon emploi du temps » dans « Afficher » ; la semaine ; « Jour » ; le lien « Exporter le calendrier » mène à `/v2/teacher/schedule/export`.
3. Cocher « Afficher les séances annulées » : la séance annulée en 7.9 apparaît barrée avec son motif.
4. Se rendre avec `enseignant@primaire-test.test` sur les mêmes écrans : les séances du CP1 A. Au primaire, « Faire l'appel » sur une séance du jour est refusé par l'API (appel journalier : voir chapitre 06, 6.1 et 6.10).
Résultat attendu : seules les séances de l'enseignant apparaissent ; un jour sans cours : « Aucune séance aujourd'hui. » avec "Votre emploi du temps du jour est vide. Consultez la semaine dans « Mon emploi du temps »." Un compte sans profil d'enseignant (propriétaire) voit des refus attendus (écart connu).
Cas invalide : taper `/v2/schedule/rooms` → page « Accès refusé ».
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le directeur des études (`/v2/schedule/today`)

#### 7.14 Exporter le calendrier (fichier .ics et lien d'abonnement)
Compte : Enseignant, puis Parent · Où : « Exporter le calendrier » (`/v2/teacher/schedule/export` pour l'enseignant, `/v2/schedule/export` pour les autres) · Prérequis : 7.7.
1. Choisir le « Sujet de l'export » : « Mon emploi du temps » (enseignant), « Mes enfants » puis DIABATE Nadia (parent).
2. Cliquer « Télécharger le fichier .ics » (demander l'accord avant le téléchargement) : fichier `emploi-du-temps.ics` des 4 prochains mois, à importer une fois (il ne se met pas à jour).
3. Sous « S'abonner (mise à jour automatique) » :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Nom du lien | "Téléphone test guide" | non |
   | Validité (jours) | 7 | non (1 à 3650 ; vide : sans expiration) |
   Cliquer « Créer un lien d'abonnement » : bandeau "Lien créé : copiez-le maintenant." avec le lien ; « Copier le lien » : "Lien copié." ; avertissement "Ce lien ne sera plus affiché. S'il est perdu ou partagé par erreur, révoquez-le et créez-en un autre." **Ne pas partager le lien.**
4. Dans « Liens d'abonnement » (colonnes « Nom », « Créé le », « Expire le », « Dernière utilisation », « État »), cliquer « Révoquer » puis confirmer dans « Révoquer ce lien » : "Lien révoqué." ; état « Révoqué ».
5. Avec le directeur des études, les sources « Classe », « Enseignant », « Élève », « Salle » sont proposées en plus.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Validité `4000` (au-delà de 3650 jours) | refus de l'API (message à relever en test) |
| Avant d'avoir choisi un sujet | "Choisissez le sujet à exporter." |
Résultat attendu : le lien est secret, en lecture seule, limité à un seul sujet ; après révocation l'état passe à « Révoqué ».
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'économe (`/v2/schedule/export` : « Accès refusé »)

#### 7.15 Vues des autres rôles
Compte : Éducateur, Secrétariat, Parent, Élève · Où : `/v2/schedule` · Prérequis : 7.7.
1. **Éducateur et secrétariat** : « Afficher » propose « Classe », « Enseignant », « Salle », « Élève » ; lecture seule. Éducateur : « Constater » dans « Séances » seulement. Secrétariat : aucun bouton de modification dans « Séances », « Patrons récurrents », « Salles et équipements ».
2. **Parent** : `/v2/schedule` propose « Mes enfants » : « Choisir un enfant » → DIABATE Nadia, DIABATE Salimata ; la semaine de la 6e A en lecture seule. Le même contenu existe sous `/v2/parent/children/<id-enfant>/schedule`.
3. **Élève** : « Mon emploi du temps » (`/v2/student/schedule`) : la semaine de sa classe.
Résultat attendu : chaque famille ne voit que ses enfants ; aucune action de modification.
Cas invalide : parent, taper `/v2/parent/children/00000000-0000-4000-8000-000000000000/schedule` → introuvable, sans donnée.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le parent (`/v2/schedule/occurrences`)

### H. Générateur d'emploi du temps

#### 7.16 Lancer une génération (cas nominal)
Compte : Directeur des études · Où : nav « Générateur » (`/v2/schedule/generator`), « Nouvelle génération » (`/v2/schedule/generator/new`) · Prérequis : 7.2 (salles). La fonction `scheduling.generation` du plan doit être active.
1. Ouvrir la liste : "Aucune génération pour le moment." avec « Lancez une génération pour obtenir une première proposition. » ; le texte rappelle qu'une proposition n'est qu'un brouillon de calcul. Cliquer « Nouvelle génération ».
2. Section « Cadre » :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Année scolaire | l'année en cours | oui |
   | Nom de la proposition | Génération test guide 6e A | oui |
   | Valable du / Valable jusqu'au | début et fin de l'année (par défaut) | oui |
   | Début de la journée | 08:00 | oui (si aucune grille n'est enregistrée) |
   | Fin de la journée | 12:00 | oui (idem) |
   | Durée d'une période (minutes) | 60 | oui, entre 20 et 240 |
   L'avertissement "Aucune grille horaire n'est enregistrée pour l'établissement : indiquez ci-dessous le début et la fin de la journée et la durée d'une période pour ce calcul." explique ces trois champs.
3. Section « Besoins à placer » : choisir la classe 6e A, cliquer « Ajouter toutes ses matières » (quatre matières ; **si une cinquième ligne porte le nom de la classe "6e A" elle-même, la retirer par « Retirer » : écart connu**). Régler pour chaque ligne :
   | Matière | Séances par semaine | Périodes par séance | Enseignant |
   |---|---|---|---|
   | Français | 2 | 1 | TRAORE Kouadio |
   | Mathématiques | 2 | 1 | TRAORE Kouadio |
   | Anglais | 1 | 2 | YAO Fatou |
   | Histoire-Géographie | 1 | 1 | KOUAME Adjoua |
   Le total affiché : "4 besoin(s), 6 séance(s) par semaine à placer."
4. Section « Paramètres » : cocher « Jours à planifier » Lun, Mar, Mer, Jeu, Ven ; « Graine » `graine-test-guide` ; « Limite de temps (secondes) » 20 ; « Itérations d'amélioration » 5000. Laisser les « Importance des préférences » vides.
5. Cliquer « Lancer le calcul ».
Résultat attendu : redirection vers `/v2/schedule/generator/<id>` ; état « Proposition prête » (calcul immédiat pour 250 séances ou moins) ; « Résumé du calcul » : « Séances demandées » 6, « Séances placées » 6, « Non placées » 0 ; onglet « Aperçu » : « Aperçu de la semaine type » avec « Par classe » (6e A), « Par enseignant », « Par salle » ; **aucun conflit** : "Aucun conflit enseignant, classe ou salle : la proposition a été vérifiée séance par séance avant d'être enregistrée." ; salle choisie : la plus petite salle suffisante. De retour dans la liste, la proposition porte l'état « Proposition prête » avec "6 sur 6".
Cas invalides :
| Saisie | Message attendu |
|---|---|
| « Nom de la proposition » vide | "Le nom est requis." (ou "Ce champ est obligatoire.") |
| Aucun besoin | le bouton « Lancer le calcul » reste inactif ; texte "Aucun besoin pour le moment : ajoutez les matières d'une classe." |
| Aucun jour coché (après les avoir tous décochés) | "Sélectionnez au moins un élément." |
| « Durée d'une période (minutes) » `10` | "La valeur doit être supérieure ou égale à 20." (ou message de l'API) |
| « Séances par semaine » `0` | "La valeur doit être supérieure ou égale à 1." |
| Une séance de 5 périodes pour une journée de 4 périodes | "Une séance de 5 périodes ne tient pas dans une journée de 4 périodes." |
| "Limite de temps" `0` | "La valeur doit être supérieure ou égale à 1." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : « Nouvelle génération » absent pour l'éducateur

#### 7.17 Les limites du générateur : semaine type, séances non placées, graine
Compte : Directeur des études · Où : `/v2/schedule/generator/new` · Prérequis : 7.16.
1. **Semaine type unique** : dans l'aperçu de 7.16, lire le titre « Aperçu de la semaine type » : les séances sont placées par **jour de semaine et heure**, sans date. Appliquer la proposition (7.18) puis ouvrir le brouillon : tous les créneaux sont « Chaque semaine » (jamais « Semaine A » ni « Semaine B ») et portent **un seul intervenant**. Aucune alternance A/B ni date particulière n'est générée.
2. **Séances non placées** : lancer une seconde génération "Génération surchargée test guide" avec la même grille (08:00 à 12:00, 60 minutes) et jours Lun à Ven, mais un seul besoin : Mathématiques, **25 séances par semaine**, 1 période, TRAORE Kouadio. La semaine n'offre que 4 × 5 = 20 périodes : l'onglet « Conflits et points d'attention (N) » liste sous « Séances non placées (N) » au moins 5 séances avec la cause "La classe demande plus d'heures que la semaine n'en offre" (tableau « Besoin », « Manque », « Pourquoi », par exemple "5 sur 25"). La liste affiche l'état « Proposition prête » avec au plus "20 sur 25" et une colonne « Non placées » d'au moins 5 (valeurs exactes à relever).
3. **Déterminisme** : relancer la génération de 7.16 avec exactement les mêmes champs et la même « Graine » `graine-test-guide` : mêmes « Séances placées » et même « Coût des préférences » (à budget d'itérations égal). Puis, sur la fiche de la première proposition, cliquer « Relancer avec une autre graine » : une proposition "Génération test guide 6e A (bis)" est calculée avec une autre graine ("Graine : …" différente).
4. **Contraintes dures** : vérifier dans l'aperçu « Par enseignant » que TRAORE Kouadio n'a jamais deux séances au même créneau, et « Par salle » qu'aucune salle n'est utilisée deux fois au même créneau ; l'Anglais (2 périodes) occupe **deux périodes consécutives**.
5. **Un publié n'est jamais écrasé** : dans "Conflits et points d'attention", le message "Un emploi du temps publié existe déjà pour cette année ("Emploi du temps 6E-A"). Il ne sera pas modifié ; pour publier le brouillon obtenu, archivez d'abord l'emploi du temps publié." est affiché (le nom exact est celui de l'emploi du temps publié).
Résultat attendu : toutes les propriétés ci-dessus ; le générateur ne tient pas compte des séances ponctuelles déjà réservées (par exemple "Réunion de parents test guide" dans la salle TG-S1) ni des indisponibilités datées du personnel (limites assumées du module).
- [ ] Cas nominal  - [ ] Cas invalide (cause des séances non placées)  - [ ] Droit refusé pour l'éducateur

#### 7.18 Appliquer, abandonner une proposition
Compte : Directeur des études · Où : `/v2/schedule/generator/<id>` · Prérequis : 7.16 et 7.17.
1. Sur "Génération test guide 6e A", cliquer « Examiner et appliquer » : fenêtre « Appliquer la proposition » ("La proposition est enregistrée dans un brouillon que vous pourrez encore modifier avant de le publier.").
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Destination | Créer un nouveau brouillon | oui |
   | Nom du brouillon | Emploi du temps généré test guide | oui |
   | Valable du / Valable jusqu'au | par défaut | oui |
   Cliquer « Appliquer » : redirection vers `/v2/schedule/timetables/<id>` : un nouveau brouillon avec les 6 créneaux (Lundi à Vendredi). Revenir à la proposition : état « Appliquée » ; lien « Ouvrir l'emploi du temps créé ».
2. Essayer « Publier » sur ce brouillon : refus "Un emploi du temps est déjà publié pour cet établissement, cette année et cette période."
3. Sur la proposition surchargée (7.17, 2) : « Examiner et appliquer » ; la case « J'accepte d'appliquer une proposition incomplète (5 séance(s) non placée(s)) » est présente : cliquer « Appliquer » **sans** la cocher.
4. Changer « Destination » en « Remplacer le contenu d'un brouillon existant » : choisir « Brouillon à remplacer » = "Emploi du temps test guide B" (seuls les brouillons sont listés), cocher « Je confirme le remplacement du contenu de ce brouillon » et la case des séances non placées, « Appliquer ».
5. Sur la seconde proposition "Génération test guide 6e A (bis)" : « Abandonner » : fenêtre « Abandonner cette proposition ? » avec « Motif (facultatif) » ; confirmer : "Proposition abandonnée." ; état « Abandonnée ».
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Étape 3 sans la case "J'accepte…" | "Confirmez que vous acceptez 5 séance(s) non placée(s) pour continuer." |
| Remplacement sans choisir le brouillon | "Choisissez le brouillon à remplacer." |
| Remplacement sans cocher la confirmation | "Confirmez le remplacement du brouillon pour continuer." |
| Appliquer une proposition déjà appliquée | bouton « Examiner et appliquer » absent (état « Appliquée ») |
Résultat attendu : rien n'est publié ; le brouillon "Emploi du temps test guide B" contient désormais les créneaux de la proposition surchargée (20 mathématiques) ; les anciens créneaux du brouillon sont supprimés.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : « Examiner et appliquer » absent pour l'éducateur

### I. Droits et publication

#### 7.19 Adresses interdites et séparation des tâches
Compte : voir le tableau · Où : adresses saisies à la main · Prérequis : aucun.
| Compte | Adresse tapée | Résultat attendu |
|---|---|---|
| Parent | `/v2/schedule/timetables` | page « Accès refusé » |
| Parent | `/v2/schedule/rooms` | page « Accès refusé » |
| Parent | `/v2/schedule/generator` | page « Accès refusé » |
| Enseignant | `/v2/schedule/timetables` | page « Accès refusé » |
| Enseignant | `/v2/schedule/occurrences` | page « Accès refusé » |
| Enseignant | `/v2/schedule/replacements` | page « Accès refusé » |
| Éducateur | `/v2/schedule/replacements` | page « Accès refusé » |
| Éducateur | `/v2/schedule/generator/new` | page « Accès refusé » |
| Secrétariat | `/v2/schedule/today` | page « Accès refusé » |
| Élève | `/v2/schedule/today` | page « Accès refusé » |
| Directeur des études | `/v2/teacher/schedule` | page « Accès refusé » |
| Économe | `/v2/schedule` | page « Accès refusé » |
Contrôler aussi : seul le directeur des études ou la direction publie ; l'éducateur et le secrétariat n'ont ni « Publier » ni « Archiver ».
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour chaque compte du tableau

#### 7.20 Publier un emploi du temps de test (final et irréversible)
Compte : Directeur ou Directeur des études · Où : fiche d'un brouillon · Prérequis : **tous les autres chapitres terminés** ; décision de l'équipe d'archiver l'emploi du temps de démonstration. Le faire de préférence sur l'établissement `superieur-test` ou sur une base que l'on peut remettre à zéro.
1. Archiver l'emploi du temps de démonstration : « Archiver » sur "Emploi du temps 6E-A" : "Emploi du temps archivé." ; il devient lecture seule et ne se republie jamais ("Un emploi du temps archivé ne se publie plus.").
2. Ouvrir "Emploi du temps test guide 6e A" (sans conflit : 7.6) : « Publier » : "Emploi du temps publié." ; badge « Publié » ; plus aucun bouton de modification ; message "Seul un brouillon est modifiable."
3. « Générer les séances » sur cette fiche, sur une période d'un mois : « Créées » = nombre de vendredis × 2 créneaux hebdomadaires (P1, P2) + le créneau « Semaine A seulement » (P3) un vendredi sur deux ; « Déjà existantes » 0. Les séances de remplacement ponctuelles ("Séance de remplacement test guide", 14:00) ne gênent pas (autre heure).
Résultat attendu : un seul emploi du temps publié par année ; l'ancien reste consultable en « Archivé » ; les séances de démonstration déjà générées restent en place.
Cas invalide : publier un second brouillon → "Un emploi du temps est déjà publié pour cet établissement, cette année et cette période."
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : « Publier » absent pour l'éducateur

#### 7.21 Qualité transversale
Compte : au choix · Où : tous les écrans.
1. États vides : « Aucun emploi du temps. », « Aucune séance sur cette période. », « Aucune salle. », « Aucune séance à remplacer. » : phrases claires avec une suggestion.
2. Chargement : pas de faux état vide prolongé ("Aucun emploi du temps n'est accessible avec votre profil" pendant quelques secondes : écart connu C-07-01).
3. Clavier : Tab parcourt les champs et les boutons, Échap ferme les fenêtres, Entrée valide.
4. Téléphone (375 px) : la semaine devient la liste « Séances par jour » ; le tableau des séances reste lisible.
5. Aucun code technique visible hors écarts connus (code de cause d'un remplacement, rôle `LEAD`).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (sans objet)

## Données créées

| Enregistrement | Où |
|---|---|
| Salles : Salle 1 test guide (`TG-S1`, 40), Laboratoire test guide (`TG-LAB`, 30), Petite salle test guide (`TG-MINI`, 5) ; équipement Vidéoprojecteur test guide (`TG-VP`, 1) | 7.2, 7.3 |
| Brouillons "Emploi du temps test guide 6e A" (avec ancre de semaine A) et "Emploi du temps test guide B" | 7.4 |
| Créneaux P1 "Mathématiques vendredi test guide", P2 "Anglais vendredi test guide", P3 "Histoire-Géographie semaine A test guide" (vendredi) ; réunion en conflit créée par dépassement puis supprimée | 7.5, 7.6 |
| Séances : "Séance d'appel test guide", "Séance d'appel 2 test guide", "Séance d'appel 3 test guide", "Séance d'appel 4 test guide" (J), "Séance de remplacement test guide" (V1), "Réunion de parents test guide" (W1, puis déplacée), "Réunion passée test guide" (H), "Réservation test guide" (J, dérogation, annulée) | 7.7 à 7.10 |
| Remplacements : YAO Fatou sur "Réunion de parents test guide" ; remplaçant sur "Séance de remplacement test guide" | 7.11 |
| Séances générées de la semaine courante et de la suivante pour "Emploi du temps 6E-A" (génération rejouée) | 7.12 |
| Liens d'abonnement iCalendar "Téléphone test guide" (révoqués) | 7.14 |
| Propositions du générateur : "Génération test guide 6e A" (appliquée), "Génération test guide 6e A" rejouée à l'identique, "Génération test guide 6e A (bis)" (abandonnée), "Génération surchargée test guide" (appliquée dans le brouillon B) | 7.16 à 7.18 |
| Brouillon "Emploi du temps généré test guide" | 7.18 |
| Emploi du temps de démonstration archivé et "Emploi du temps test guide 6e A" publié (irréversible) | 7.20 |

## Écarts constatés

| Écran | Constat | Gravité |
|---|---|---|
| Séances (« Constater ») | Le bouton envoie la demande sans motif alors que l'API exige 3 caractères pour un constat manuel : le constat semble impossible depuis l'écran ("Un motif est requis."). | Majeur (à confirmer) |
| Fiche d'un emploi du temps (créneau) | Les erreurs de l'API portant sur « Alternance » (ancre A/B absente), l'offre ou d'autres champs non listés ne sont pas affichées : la fenêtre ne montre aucun message (échec silencieux). | Majeur (à confirmer) |
| Séances | Un enseignant ne peut pas déclarer une séance ponctuelle : la page « Séances » exige `schedule.read`, qu'il n'a pas (QA C-07-07). | Mineur (connu) |
| Remplacements | La cause s'affiche en code brut (`STAFF_LEAVE`, `ROOM_UNAVAILABLE`) ; le rôle `LEAD` apparaît dans certains en-têtes (QA C-03-11 : un créneau récurrent affiche « Cours » et non la matière). | Mineur |
| Annuler une séance | Deux boutons « Annuler » dans la même fenêtre (fermer, confirmer) ; la phrase "communiqué" ne dit pas à qui (QA C-03-10). | Mineur |
| Générateur | Le niveau "6e A" du curriculum est traité comme une matière (ligne parasite "6e A — 6e A", QA C-03-05, non corrigé dans le code lu). | Mineur |
| Salles et équipements | Le menu « Salles et équipements » est caché à l'éducateur et au secrétariat (droit de gestion) mais l'onglet de la page reste visible et l'écran accessible en lecture. | Suggestion |
| Calendrier de l'établissement, validation des séances | Entrées de menu "Calendrier de l'établissement" et « Validation des séances » sans écran (masquées) : les jours fériés, vacances et fermetures ne se saisissent pas dans l'emploi du temps ; la validation des heures pour la paie n'a pas d'interface. | Majeur (connu) |
| Paramètres de l'emploi du temps | Pas d'écran pour la grille horaire, les jours ouvrés, les politiques de conflit, le fuseau : le générateur redemande la grille à chaque lancement ; la garde `maxGenerationWeeks` n'est pas modifiable. | Mineur |
| Pages d'erreur | « Accès refusé » à l'ancienne mise en page, page 404 en anglais (QA C-03-09). | Mineur (connu) |

## À vérifier en test

- Texte exact des messages de conflit de l'API ("… est déjà occupé(e) …", "… est déjà réservée …", "… a déjà une séance …") : à relever.
- « Constater » réussit-il avec l'éducateur ? (voir écarts).
- Le campus par défaut est-il proposé dans « Salles et équipements » ?
- Le champ « Alternance » affiche-t-il un message pour une alternance A/B sans date de semaine A ?
- L'offre du Collège Le Baobab inclut-elle `scheduling.generation` et `scheduling.equipment` ?
- Le délai (quelques secondes) du signalement « À remplacer » après approbation d'un congé (traitement par abonnement d'événement).
- Le nombre maximal de semaines accepté par « Générer les séances » (garde-fou).

## Non couvert / limites connues

- **Validation des séances pour la paie** et **calendrier de l'établissement** : aucun écran (API seulement).
- **Séance comptable**, **verrouillage des heures de paie** : réservés à la paie, sans écran.
- **Alternance A/B** : testée dans le constructeur de créneaux ; le générateur ne la produit pas (semaine type unique).
- **Générateur** : un seul intervenant par séance, cours de classe entière uniquement, indisponibilités du personnel lues comme règles hebdomadaires (aucun écran pour les saisir), aucune prise en compte des salles réservées par des séances ponctuelles, plafond de 8 000 séances par demande (au-delà de 250 séances, calcul asynchrone par une tâche de fond chaque minute).
- **Génération automatique de nuit** (02:30) : non testable à la main.
- **Hors ligne** : « Mon emploi du temps » se lit depuis une copie locale (chapitre sur le hors-ligne).
- **Abonnement iCalendar** : le test vérifie la création et la révocation du lien, pas la synchronisation d'un agenda externe.
- Le supérieur n'est pas rejoué scénario par scénario (mêmes gestes).
