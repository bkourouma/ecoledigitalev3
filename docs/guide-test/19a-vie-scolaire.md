# Chapitre 19a. Pack secondaire : vie scolaire

> Établissement : Collège Le Baobab (démonstration), `secondaire-test`, pack Secondaire uniquement (le module n'existe ni au primaire ni au supérieur). Adresse du navigateur : `http://localhost:3000` (API `http://localhost:4000`). Durée estimée : 3 h à 3 h 30, en deux séances.
> Ce fichier est la première des trois parties du chapitre 19 (19a vie scolaire, 19b conseils de classe, 19c élèves affectés par l'État). Les scénarios sont numérotés 19.1 à 19.24.

## Objectif

Vérifier le cycle de la vie scolaire : l'éducateur ou l'enseignant **saisit** un incident, un encouragement ou une observation ; l'éducateur **propose** une mesure ; la direction **valide** (séparation des tâches "à quatre yeux" : le validateur n'est jamais le proposant pour une exclusion) ; la famille est **informée** (notification), peut accuser réception d'une convocation et déposer un recours ; la direction tranche ; l'effet d'une exclusion sur le statut de l'élève n'est jamais automatique : **un humain habilité l'applique ou l'écarte**.

Fil rouge à contrôler partout : la machine propose, une personne décide. Les types de faits (incident, avertissement, exclusion…), les gravités et les barèmes sont des **données de démonstration** : aucun catalogue de fautes ni aucune sanction officielle ivoirienne n'est livré.

## Prérequis

- Base de démonstration fraîche (`pnpm dev:v2:seed`), application et API démarrées. Le worker est utile (notifications), mais aucun envoi réel n'a lieu : tout est simulé.
- Se connecter par la page `/login` en cliquant sur le compte voulu dans le panneau de droite (les mots de passe et codes MFA ne figurent jamais dans ce guide ; voir chapitre 02 pour la double authentification).
- Notation des dates : **J** = le jour où vous faites le test. "J+7" = dans sept jours. Les champs de date sont des sélecteurs natifs du navigateur.
- Conserver les noms "test guide" exactement : les chapitres suivants et l'annexe s'y réfèrent.

## Comptes à utiliser (établissement `secondaire-test`)

| Rôle | E-mail | MFA | Rôle dans ce chapitre |
|---|---|---|---|
| Éducateur | `educateur@secondaire-test.test` | non | Déclare, note, **propose** les mesures, convoque. Ne valide rien. |
| Enseignant (TRAORE Kouadio) | `enseignant@secondaire-test.test` | non | Signale un incident, écrit des notes dans ses classes. |
| Directeur | `directeur@secondaire-test.test` | oui | Valide, notifie, révoque, tranche un recours, applique l'effet d'une exclusion, lit le confidentiel, règle les paramètres. |
| Propriétaire | `direction.generale@secondaire-test.test` | oui | Mêmes droits que le directeur (deuxième personne de direction). |
| Directeur des études | `etudes@secondaire-test.test` | oui | Lecture générale du tableau de bord seulement. |
| Parent (DIABATE Séka) | `parent@secondaire-test.test` | non | Voit ses deux enfants Nadia et Salimata DIABATE. |
| Élève (DIABATE Nadia) | `eleve@secondaire-test.test` | non | Voit sa propre vie scolaire partageable. |
| Secrétariat | `secretariat@secondaire-test.test` | oui | Aucun accès à la vie scolaire (contrôle de droit). |
| Économe | `econome@secondaire-test.test` | oui | Aucun accès à la vie scolaire (contrôle de droit). |

## Droits (qui peut ouvrir quoi)

Source : gardes de page `apps/web/src/app/v2/schoollife/**/page.tsx` et modèles de rôles `apps/api/src/modules/rbac/templates/system-roles.ts`.

| Écran | Adresse | Directeur / Propriétaire | Directeur des études | Éducateur | Enseignant | Parent | Élève | Secrétariat / Économe |
|---|---|---|---|---|---|---|---|---|
| Tableau de bord | `/v2/schoollife` | oui | oui | oui | non | non | non | non |
| Saisie rapide | `/v2/schoollife/saisie` | oui | non (voir écart E-19a-1) | oui | oui | non | non | non |
| Fiche d'un élève | `/v2/schoollife/eleves/<identifiant>` | oui | non (voir écart E-19a-1) | oui | oui, **ses classes seulement** | non | non | non |
| Mesures à valider | `/v2/schoollife/validations` | oui | non | non | non | non | non | non |
| Convocations | `/v2/schoollife/convocations` | oui | non | oui | non | non | non | non |
| Paramètres | `/v2/schoollife/parametres` | oui | non | non | non | non | non | non |
| Vie scolaire de mes enfants | `/v2/schoollife/famille` | non | non | non | non | oui | non | non |
| Ma vie scolaire | `/v2/schoollife/moi` | non | non | non | non | non | oui | non |

Un refus de page renvoie vers `/unauthorized` : page « Accès refusé » avec le texte "Vous n'avez pas les droits nécessaires pour afficher cette page." (aucune donnée n'est chargée).

**Adresses à taper à la main, qui doivent être refusées :**

| Compte | Adresses interdites | Résultat attendu |
|---|---|---|
| Éducateur | `/v2/schoollife/validations`, `/v2/schoollife/parametres`, `/v2/schoollife/famille`, `/v2/schoollife/moi` | « Accès refusé » |
| Enseignant | `/v2/schoollife`, `/v2/schoollife/validations`, `/v2/schoollife/convocations`, `/v2/schoollife/parametres` | « Accès refusé » |
| Parent | `/v2/schoollife`, `/v2/schoollife/saisie`, `/v2/schoollife/validations`, `/v2/schoollife/moi` | « Accès refusé » |
| Élève | `/v2/schoollife`, `/v2/schoollife/saisie`, `/v2/schoollife/famille`, `/v2/schoollife/convocations` | « Accès refusé » |
| Secrétariat, économe | `/v2/schoollife`, `/v2/schoollife/saisie`, `/v2/schoollife/convocations`, `/v2/schoollife/eleves/<identifiant>` | « Accès refusé » |

## Données de départ (graine de démonstration)

Source : `scripts/seed-v2/demo/schoollife.ts` (appelé pour le pack Secondaire). Les élèves sont ceux de la classe 6e A (annexe, section 3). "J" est ici le jour de la création de la base.

| Élément | Contenu |
|---|---|
| Niveaux de gravité | « Niveau 1 (démonstration) » (rang 1), « Niveau 2 (démonstration) » (rang 2) |
| Types d'événements (tous marqués « Démonstration ») | « Incident en classe (démonstration) » ; « Avertissement (démonstration) » (validation exigée, famille notifiée) ; « Exclusion temporaire (démonstration) » (validation exigée, quatre yeux, dates exigées, famille notifiée, recours possible) ; « Encouragement (démonstration) » ; « Observation (démonstration) » |
| Incidents | "Bavardage répété pendant le cours (incident de démonstration)." concernant **DIABATE Salimata** (déclaré par l'enseignant) ; "Retard à la reprise après la récréation (incident de démonstration)." concernant **BAMBA Fatou** (déclaré par l'éducateur). Les deux « Déclaré ». |
| Notes | Encouragement "Très bonne participation cette semaine." pour **DIABATE Nadia** (personnel seulement) ; observation "Besoin d'un accompagnement en lecture." pour **BAMBA Aya** (personnel seulement) |
| Mesure 1 | Avertissement de **BAMBA Fatou**, proposé par l'éducateur, **validé** par la direction (non notifié) |
| Mesure 2 | Exclusion temporaire de **TOURE Yao**, **Proposée** (J+1 à J+3), en attente de validation |
| Mesure 3 | Exclusion temporaire de **DIABATE Salimata**, **Validée** (J+1 à J+2) ; son effet sur le statut de l'élève est « En attente d'une décision humaine » |
| Convocations, recours, barèmes de conduite | aucun |

Valeurs attendues du tableau de bord sur une base intacte : incidents ouverts 2, mesures à valider 1, exclusions en cours 0 (les dates commencent le lendemain de la graine ; la valeur peut être 1 si le test a lieu un ou deux jours après la graine), convocations à tenir 0, effets en attente 1. Si d'autres chapitres ont déjà agi sur ces données, relever les valeurs réelles.

## Données créées par ce chapitre (résumé ; liste complète en fin de fichier)

Incidents, notes, mesures, convocations, un niveau de gravité, un type d'événement et, en option, un barème, tous suffixés "test guide" ou préfixés `TG-` / `TG_`. **Aucune suppression n'existe dans le module** : une note se retire, une mesure se rejette, s'annule ou se révoque, une convocation s'annule, un type se désactive. Pour repartir de zéro, réinitialiser la base de démonstration.

---

## Partie A. Lecture : tableaux de bord et fiche élève

#### 19.1 Tableau de bord de la vie scolaire (direction)
Compte : Directeur (Collège Le Baobab) · Où : menu « Vie scolaire » > « Vie scolaire » (`/v2/schoollife`) · Prérequis : base intacte.
1. Se connecter en directeur (MFA) puis ouvrir le menu « Vie scolaire » et l'entrée « Vie scolaire ». La barre d'onglets en haut de page propose « Tableau de bord », « Saisie rapide », « Validations », « Convocations », « Paramètres ».
2. Lire les cinq indicateurs de la liste « Indicateurs de la vie scolaire » : « Incidents ouverts », « Mesures à valider », « Exclusions en cours », « Convocations à tenir », « Effets en attente d'une décision ».
3. Lire les trois listes : « Incidents ouverts », « Mesures proposées », « Convocations à venir ».
4. Cliquer sur l'indicateur « Mesures à valider » : retour ensuite (flèche du navigateur) et cliquer sur « Ouvrir le dossier » en face du premier incident.

Résultat attendu : indicateurs de la section "Données de départ" ; « Incidents ouverts » liste les deux incidents de démonstration avec leur statut « Déclaré », la date, le nom du déclarant et le nom de l'élève ; « Mesures proposées » liste l'exclusion de TOURE Yao ; « Convocations à venir » affiche « Aucune convocation à venir. ». L'indicateur « Mesures à valider » mène à `/v2/schoollife/validations` ; « Ouvrir le dossier » mène à `/v2/schoollife/eleves/<identifiant>`. Le bouton « Saisie rapide » en haut à droite mène à `/v2/schoollife/saisie`. Un élément confidentiel n'apparaît que sous la forme « Élément confidentiel (masqué) » (voir 19.17).
- [ ] Cas nominal  - [ ] Valeurs relevées si la base n'est pas intacte  - [ ] Droit refusé pour l'enseignant (`/v2/schoollife`)

#### 19.2 Tableau de bord vu par l'éducateur
Compte : Éducateur · Où : `/v2/schoollife` (aucune entrée « Vie scolaire » dans le menu de gestion si l'éducateur ne la voit pas : taper l'adresse) · Prérequis : aucun.
1. Se connecter en éducateur (sans MFA) et ouvrir `/v2/schoollife`.
2. Observer les onglets : « Tableau de bord », « Saisie rapide », « Convocations » doivent être présents ; « Validations » et « Paramètres » doivent être absents.
3. Cliquer sur l'indicateur « Mesures à valider ».

Résultat attendu : le tableau de bord affiche les mêmes cinq indicateurs que 19.1. Le clic sur « Mesures à valider » ouvre la page « Accès refusé » (le lien existe mais l'éducateur n'a pas le droit de valider : écart E-19a-2). Retour au tableau de bord par la flèche du navigateur.
- [ ] Cas nominal  - [ ] Onglets « Validations » et « Paramètres » absents  - [ ] Droit refusé pour `/v2/schoollife/validations`

#### 19.3 Directeur des études : tableau de bord oui, fiche élève à vérifier
Compte : Directeur des études (Collège Le Baobab) · Où : `/v2/schoollife` · Prérequis : MFA.
1. Se connecter en directeur des études, ouvrir `/v2/schoollife`.
2. Cliquer sur « Ouvrir le dossier » en face d'un incident.

Résultat attendu (déduit du code, **à vérifier en test**) : le tableau de bord s'affiche (le rôle porte `schoollife.read.all`). Le clic sur « Ouvrir le dossier » mène à « Accès refusé », car la page de la fiche élève exige `schoollife.read` que ce rôle ne porte pas (écart E-19a-1). Si la fiche s'ouvre, relever son contenu : le niveau d'accès affiché doit être « Standard ».
- [ ] Constat relevé  - [ ] Droit refusé pour `/v2/schoollife/saisie` et `/v2/schoollife/validations`

#### 19.4 Fiche de vie scolaire d'un élève (lecture)
Compte : Directeur · Où : tableau de bord > « Ouvrir le dossier » en face de l'incident "Bavardage répété…" (`/v2/schoollife/eleves/<identifiant>`) · Prérequis : base intacte.
1. Ouvrir la fiche de **DIABATE Salimata**. Le titre est le nom de l'élève, la description « Chronologie des faits, mesures, notes et convocations visibles avec votre niveau d'habilitation. ».
2. Lire la ligne « Votre niveau d'accès : » : le badge doit être « Confidentiel » suivi du texte « Les éléments confidentiels sont masqués : leur lecture est journalisée avec un motif. ».
3. Lire les boutons d'action : « Déclarer un incident », « Encourager », « Observation », « Proposer une mesure », « Convoquer ».
4. Lire la section « Chronologie » (du plus récent au plus ancien).
5. Lire la section « Retards et absences » (lecture seule) puis « Historique ».

Résultat attendu : la chronologie contient au moins l'incident « Incident » « Déclaré » (« Déclaré par … ») et la mesure « Mesure » « Exclusion temporaire » « Validée » avec la période « du … au … » et « Proposée par … » ; l'identifiant technique de connexion de l'éducateur s'affiche à la place de son nom (écart connu E-19a-5). La section « Retards et absences » affiche soit un résumé du type « 0 absence(s), dont 0 justifiée(s) ; 0 retard(s). » avec « Aucun retard ni absence enregistré. », soit « Les présences ne sont pas disponibles pour le moment. ». L'« Historique » liste "Incident créé", "Mesure créé" avec l'auteur. **La section « Points de conduite » n'apparaît pas** tant que l'option n'est pas activée (voir 19.21).
- [ ] Cas nominal  - [ ] Historique lisible  - [ ] Droit refusé pour le parent (`/v2/schoollife/eleves/<identifiant>`)

---

## Partie B. Saisie : incident, encouragement, observation

#### 19.5 Saisie rapide d'un incident par l'enseignant
Compte : Enseignant (TRAORE Kouadio) · Où : menu du portail enseignant « Saisie vie scolaire » (`/v2/schoollife/saisie`) · Prérequis : aucun.
1. Se connecter en enseignant. Ouvrir « Saisie vie scolaire ». La page « Saisie rapide » propose trois cartes : « Déclarer un incident », « Encourager un élève », « Noter une observation ». Sous elles, l'encadré rappelle que retards et absences se saisissent dans l'appel (lien « Ouvrir l'appel »).
2. Cliquer sur « Déclarer un incident » et remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Classe | 6e A | oui |
   | Élève | COULIBALY Moussa | oui |
   | Type | Incident en classe (démonstration) | oui |
   | Gravité | Niveau 1 (démonstration) (ou laisser « Selon le type ») | non |
   | Date des faits | J | oui |
   | Heure des faits | 10:15 | non |
   | Description des faits | Incident test guide : bavardage pendant la composition | oui (5 caractères au moins) |
   | Lieu | Salle 6e A test guide | non |
   | Rôle de l'élève | Auteur | oui |
   | Confidentialité | laisser « Selon le type » | non |
   | Déclaration de l'élève | laisser vide | non |
3. Cliquer sur « Déclarer l'incident ».

Résultat attendu : la fenêtre se ferme, message « Incident enregistré. ». Le déclarant est l'utilisateur connecté (aucun champ ne permet de le choisir). Avec le directeur, le tableau de bord affiche 3 incidents ouverts dont le nouveau.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Description vide | « Ce champ est obligatoire. » sous « Description des faits » |
| Description "abc" | "La description doit faire au moins 5 caractères." |
| Type non choisi | « Ce champ est obligatoire. » sous « Type » |
| Aucun élève choisi (classe laissée vide) | "Désignez au moins un élève impliqué, ou précisez l'établissement et l'année." sous « Élève » |
| Élève dont l'inscription est en attente (SORO Elie) | message du serveur "Cette inscription n'est plus active : aucun enregistrement de vie scolaire n'y est accepté." (texte inexact pour une inscription "pas encore active" : écart E-19a-4) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le parent (`/v2/schoollife/saisie`)

#### 19.6 Encouragement partageable et observation réservée au personnel (éducateur)
Compte : Éducateur · Où : `/v2/schoollife/saisie` (onglet « Saisie rapide ») · Prérequis : aucun.
1. Cliquer sur « Encourager un élève » et remplir :
   | Champ | Valeur | Obligatoire |
   |---|---|---|
   | Classe | 6e A | oui |
   | Élève | DIABATE Nadia | oui |
   | Type | Encouragement (démonstration) | oui |
   | Texte | Encouragement test guide : très bonne participation en classe | oui |
   | Date | J | oui |
   | Visibilité | Visible de l'élève et des parents | oui |
   | Confidentialité | laisser « Selon le type » | non |
   Cliquer sur « Enregistrer ». Message « Encouragement enregistré. ».
2. Cliquer sur « Noter une observation » et remplir : classe 6e A, élève **COULIBALY Salimata**, type « Observation (démonstration) », texte "Observation test guide : a besoin d'un suivi en lecture", date J, visibilité **Personnel seulement** (valeur par défaut). « Enregistrer ». Message « Observation enregistrée. ».
3. Ouvrir la liste « Visibilité » : les trois choix « Personnel seulement », « Visible des parents », « Visible de l'élève et des parents » sont proposés.

Résultat attendu : les deux messages ci-dessus. Les notes figurent dans la chronologie de la fiche de chaque élève (ouvrir la fiche par le tableau de bord : un élève sans incident ni mesure ouverts n'est pas listé ; l'enseignant ou l'éducateur peut aussi retrouver l'élève par `/v2/schoollife/eleves/<identifiant>` si l'identifiant est connu). L'encouragement de Nadia sera lu par le parent et l'élève en 19.14 et 19.22 ; l'observation reste invisible des familles.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Texte vide | « Ce champ est obligatoire. » sous « Texte » |
| Type non choisi | « Ce champ est obligatoire. » sous « Type » |
| Élève non choisi | « Ce champ est obligatoire. » sous « Élève » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat (`/v2/schoollife/saisie`)

#### 19.7 Retirer une note (jamais supprimer)
Compte : Éducateur · Où : fiche de l'élève concerné (`/v2/schoollife/eleves/<identifiant>`) · Prérequis : 19.6 (observation de COULIBALY Salimata), fiche accessible depuis le tableau de bord (voir remarque).
Remarque : une note n'ouvre pas de lien dans le tableau de bord. Pour atteindre la fiche de COULIBALY Salimata, déclarer d'abord un incident à son nom ("Incident test guide : oubli de matériel") par « Saisie rapide » (même procédure que 19.5), puis utiliser « Ouvrir le dossier » depuis le tableau de bord.
1. Dans la chronologie de la fiche, repérer l'observation "Observation test guide : a besoin d'un suivi en lecture" et cliquer sur « Retirer la note ».
2. Saisir un motif de 2 caractères ("ok") puis valider.
3. Saisir le motif "Retrait test guide : note saisie par erreur" puis cliquer sur « Retirer ».

Résultat attendu : la fenêtre « Retirer la note » (« Une note ne se supprime jamais : elle est retirée avec un motif et reste dans l'historique. ») refuse le motif trop court avec « Le motif doit comporter au moins 5 caractères. ». Après le retrait, la note porte le badge « Retirée » et le bouton « Retirer la note » disparaît ; la note reste dans la chronologie et dans l'« Historique ».
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Le texte de la note reste visible du personnel

---

## Partie C. Mesures : proposition, validation à quatre yeux, information de la famille

#### 19.8 L'éducateur propose une exclusion (il ne la valide pas)
Compte : Éducateur · Où : `/v2/schoollife/saisie` puis tableau de bord puis fiche · Prérequis : aucun.
1. Déclarer un incident pour **TOURE Jean-Marc** (classe 6e A) : type « Incident en classe (démonstration) », gravité « Niveau 2 (démonstration) », date J, description "Incident test guide : propos injurieux envers un camarade", lieu "Cour de récréation test guide", rôle « Auteur ». Message « Incident enregistré. ».
2. Ouvrir `/v2/schoollife`, cliquer sur « Ouvrir le dossier » en face de cet incident : fiche de TOURE Jean-Marc.
3. Cliquer sur « Proposer une mesure » et remplir :
   | Champ | Valeur | Obligatoire |
   |---|---|---|
   | Type | Exclusion temporaire (démonstration) | oui |
   | Gravité | Niveau 2 (démonstration) | non |
   | Motif | Exclusion test guide : propos injurieux répétés | oui (5 caractères au moins) |
   | Premier jour | J+7 | oui (type exigeant des dates) |
   | Dernier jour | J+8 | oui |
   | Confidentialité | laisser « Selon le type » | non |
4. Avant de valider, lire le cadre « Circuit de ce type » : « Cette mesure se propose, puis se valide. », « Le validateur doit être une autre personne que vous. », « Elle peut faire l'objet d'un recours. », « La famille est notifiée lors de la notification de la mesure. ». Cliquer sur « Proposer la mesure ».

Résultat attendu : message « Mesure enregistrée. ». Dans la chronologie, la mesure est « Proposée » et n'a aucun effet. L'éducateur ne voit aucun bouton « Valider » ni « Rejeter ». Le tableau de bord du directeur affiche 2 mesures proposées (« Mesures à valider » = 2).
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Motif "abc" | "Le motif doit faire au moins 5 caractères." |
| Motif vide | « Ce champ est obligatoire. » sous « Motif » |
| Type d'exclusion sans date de début ou de fin | « Ce type de mesure exige des dates de début et de fin. » |
| Type non choisi | « Ce champ est obligatoire. » sous « Type » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'éducateur (`/v2/schoollife/validations`)

#### 19.9 Avertissement proposé par l'éducateur (pour le rejet)
Compte : Éducateur · Où : fiche de COULIBALY Moussa (tableau de bord > incident de 19.5 > « Ouvrir le dossier ») · Prérequis : 19.5.
1. Cliquer sur « Proposer une mesure », type « Avertissement (démonstration) », motif "Avertissement test guide : retards répétés". Le cadre « Circuit de ce type » ne mentionne pas « Le validateur doit être une autre personne que vous. » (le type avertissement n'exige pas les quatre yeux), les champs « Premier jour » et « Dernier jour » n'apparaissent pas.
2. Cliquer sur « Proposer la mesure ».

Résultat attendu : « Mesure enregistrée. » ; la mesure est « Proposée » (Moussa COULIBALY). Elle servira à 19.10 (rejet) et, en seconde occurrence, à 19.12 (annulation).
- [ ] Cas nominal  - [ ] Pas de champs de dates pour ce type

#### 19.10 La direction valide une mesure et en rejette une autre
Compte : Directeur · Où : menu « Vie scolaire » > « Mesures à valider » (`/v2/schoollife/validations`) · Prérequis : 19.8 et 19.9.
1. Ouvrir la page « Validation des mesures ». Lire la section « À valider » : les mesures proposées (TOURE Yao, TOURE Jean-Marc, COULIBALY Moussa) avec « Proposée par … le … » et, pour les exclusions, « validation par une autre personne exigée ».
2. Sur la mesure de **TOURE Jean-Marc**, cliquer sur « Valider », saisir la note facultative "Validation test guide" puis cliquer sur « Valider ».
3. Sur la mesure d'avertissement de **COULIBALY Moussa**, cliquer sur « Rejeter », saisir "Rej" (3 caractères) puis valider, puis saisir "Rejet test guide : motif insuffisant" et cliquer sur « Rejeter ».

Résultat attendu : « Mesure validée. » ; la mesure de Jean-Marc passe dans la section « Validées : à notifier ou à exécuter » et un effet « Demande de changement de statut de l'élève » apparaît dans « Effets d'exclusion en attente » (statut « En attente d'une décision humaine »). Pour le rejet : le motif trop court est refusé avec « Le motif doit comporter au moins 5 caractères. » ; le motif correct donne « Mesure rejetée. » et la mesure disparaît de « À valider ». Le proposant (éducateur) et le validateur (directeur) sont deux personnes différentes.
Cas invalide : valider avec une note de plus de 2000 caractères n'est pas à tester (zone limitée à 2000).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le directeur des études (`/v2/schoollife/validations`)

#### 19.11 Quatre yeux : le directeur ne valide pas sa propre proposition
Compte : Directeur · Où : `/v2/schoollife/saisie` puis fiche puis `/v2/schoollife/validations` · Prérequis : MFA.
1. Avec le directeur, déclarer par « Saisie rapide » un incident pour **COULIBALY Salimata** (classe 6e A) : type « Incident en classe (démonstration) », description "Incident test guide : refus d'obéir", rôle « Auteur ». Ouvrir sa fiche (tableau de bord > « Ouvrir le dossier »).
2. Cliquer sur « Proposer une mesure » : type « Exclusion temporaire (démonstration) », motif "Exclusion test guide : proposition de la direction", Premier jour J+20, Dernier jour J+21. « Proposer la mesure ».
3. Aller sur « Mesures à valider », cliquer sur « Valider » pour cette mesure puis valider.
4. Fermer la fenêtre, puis cliquer sur « Rejeter » avec le motif "Rejet test guide : validation impossible par le proposant".

Résultat attendu : à l'étape 3, la fenêtre reste ouverte et affiche une erreur du serveur : "La validation doit venir d'une autre personne que le proposant (séparation des tâches)." La mesure reste « Proposée ». Le rejet (étape 4) est possible : « Mesure rejetée. ». Pour que cette exclusion soit validée, il faudrait le compte Propriétaire (`direction.generale@secondaire-test.test`).
- [ ] Cas nominal (refus affiché)  - [ ] Rejet possible  - [ ] Le propriétaire peut valider (optionnel)

#### 19.12 Notifier la famille, annuler, marquer exécutée, révoquer
Compte : Directeur · Où : `/v2/schoollife/validations` · Prérequis : 19.10 (mesure validée de TOURE Jean-Marc, appelée M-A), mesure d'avertissement de COULIBALY Moussa à reproposer.
1. Dans « Validées : à notifier ou à exécuter », sur la mesure de **TOURE Jean-Marc** : cliquer sur « Notifier la famille ».
2. La mesure passe dans la section « Mesures en vigueur » (« Notifiées ou exécutées : révocables avec un motif. »). Cliquer sur « Révoquer », saisir "Court" (5 caractères, mais moins de 10) puis valider, puis saisir "Révocation test guide : erreur de saisie" et cliquer sur « Révoquer ».
3. Annulation : avec l'éducateur, reproposer un avertissement « Avertissement (démonstration) » pour COULIBALY Moussa (motif "Avertissement test guide : à annuler") ; avec le directeur, le valider, puis dans « Validées : à notifier ou à exécuter » cliquer sur « Annuler », saisir "Annulation test guide : proposition retirée" et cliquer sur « Annuler la mesure ».
4. « Marquer exécutée » : sur l'avertissement validé de **BAMBA Fatou** (mesure 1 de la graine, section « Validées »), cliquer sur « Marquer exécutée ».

Résultat attendu : étape 1 « Mesure notifiée. » (l'envoi aux tuteurs est simulé : aucun message réel). Étape 2 : motif de 5 caractères refusé avec « Le motif doit comporter au moins 10 caractères. » ; ensuite « Mesure révoquée. » ; l'effet « Demande de changement de statut de l'élève » de cette mesure disparaît de « Effets d'exclusion en attente » (il passe à « Écarté » dans l'historique). Étape 3 : « Mesure annulée. ». Étape 4 : « Mesure marquée exécutée. » (aucune fenêtre de confirmation : écart E-19a-6) ; la mesure quitte « Validées » et rejoint « Mesures en vigueur ».
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'éducateur (aucun bouton « Révoquer »)

#### 19.13 La famille ne voit rien avant la notification, puis voit la décision
Compte : Directeur puis Parent · Où : directeur `/v2/schoollife/validations` ; parent menu du portail parent « Vie scolaire » (`/v2/schoollife/famille`) · Prérequis : graine intacte (mesure 3 de DIABATE Salimata « Validée », non notifiée).
1. Connecté en parent, ouvrir « Vie scolaire ». Choisir l'enfant **DIABATE Salimata** dans la liste « Enfant » (la liste n'apparaît que s'il y a plusieurs enfants).
2. Lire la page, puis choisir **DIABATE Nadia**.
3. Se connecter en directeur, ouvrir « Mesures à valider », dans « Validées : à notifier ou à exécuter » repérer l'exclusion de **DIABATE Salimata** et cliquer sur « Notifier la famille ».
4. Reconnecter le parent, rouvrir « Vie scolaire » et choisir Salimata.

Résultat attendu : avant l'étape 3, la page affiche « Rien à afficher pour le moment. » avec l'aide « Les informations apparaissent ici une fois notifiées par l'établissement. » pour Salimata comme pour Nadia (l'encouragement de Nadia créé en 19.6 sera lui visible : voir 19.14). Après la notification : un groupe « Décisions » apparaît avec le titre « Exclusion temporaire (démonstration) », le badge « Notifiée », la période « du … au … », le motif de la mesure, le bouton « Déposer un recours ». **Jamais** l'incident, les notes du personnel ni un élément confidentiel. Le parent ne voit pas d'autre élève que Nadia et Salimata (la liste « Enfant » ne propose qu'eux).
- [ ] Cas nominal  - [ ] Rien avant notification  - [ ] Droit refusé pour le parent (`/v2/schoollife`)

#### 19.14 Recours de la famille et décision de la direction
Compte : Parent puis Directeur · Où : parent `/v2/schoollife/famille` ; directeur `/v2/schoollife/validations` · Prérequis : 19.13 (exclusion de Salimata « Notifiée »).
1. Parent, enfant Salimata : cliquer sur « Déposer un recours ». Saisir le motif "Recours" (7 caractères) puis valider, puis "Recours test guide : la famille conteste la décision" et cliquer sur « Déposer le recours ».
2. Parent : choisir l'enfant Nadia ; lire le groupe « Encouragements et observations ».
3. Directeur : dans la section « Recours déposés » (« Maintenir ou annuler la mesure, avec une motivation. »), lire « Recours de … » avec le motif. Cliquer sur « Maintenir la mesure », saisir "Court" (5 caractères) puis valider, puis "Décision test guide : la mesure est maintenue" et cliquer sur « Maintenir ».
4. Parent : rouvrir la page de Salimata.

Résultat attendu : étape 1 : motif court refusé avec « Le motif doit comporter au moins 10 caractères. » ; ensuite « Recours déposé. » ; la ligne affiche « Recours : déposé » et le bouton « Déposer un recours » disparaît. Étape 2 : l'encouragement "Encouragement test guide : très bonne participation en classe" apparaît (titre « Encouragement (démonstration) ») ; l'encouragement de la graine (personnel seulement) n'apparaît pas. Étape 3 : même règle (10 caractères au moins) puis « Recours tranché. » ; la mesure revient « Exécutée » (la décision est maintenue). Étape 4 : « Recours : rejeté ». Le bouton « Annuler la mesure » aurait révoqué la mesure (non testé ici pour conserver la donnée de la graine).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Seul le directeur peut trancher (l'éducateur n'a pas la page)

---

## Partie D. Convocations des tuteurs

#### 19.15 Créer, envoyer, accuser réception, tenir un entretien
Compte : Éducateur puis Parent · Où : éducateur `/v2/schoollife/convocations` (menu « Vie scolaire » > « Convocations ») ; parent `/v2/schoollife/famille` · Prérequis : aucun.
1. Éducateur : ouvrir « Convocations » (page « Convocations »), cliquer sur « Nouvelle convocation » et remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Classe | 6e A | oui |
   | Élève | DIABATE Salimata | oui |
   | Nature | Discipline | oui |
   | Motif (visible dans le portail une fois la convocation envoyée) | Convocation test guide : entretien sur le comportement | oui (5 caractères au moins) |
   | Date de l'entretien | J+3 | oui |
   | Heure | 09:00 | oui |
   | Lieu | Bureau vie scolaire test guide | non |
   Cliquer sur « Créer la convocation » : « Convocation créée. ». La ligne apparaît avec le badge « Brouillon ».
2. Cliquer sur « Envoyer » : la fenêtre « Envoyer la convocation » propose les « Canaux d'envoi » : « Application » et « E-mail » cochés par défaut ; « SMS », « WhatsApp » et « Notification push » non cochés. Cliquer sur « Envoyer » : « Convocation envoyée. », badge « Envoyée ».
3. Parent, enfant Salimata : le groupe « Convocations » affiche « Convocation » avec le motif, la date et le lieu, bouton « Accuser réception ». Cliquer dessus : « Accusé de réception enregistré. ».
4. Éducateur : la ligne affiche « accusé de réception le … », badge « Accusée ». Cliquer sur « Entretien tenu », saisir le compte rendu facultatif "Compte rendu test guide : entretien tenu" et cliquer sur « Enregistrer ».

Résultat attendu : messages ci-dessus ; en dernier « Entretien enregistré comme tenu. » et badge « Tenue ». Le message envoyé par e-mail ou par application ne reprend jamais le motif (le motif se lit dans le portail une fois la convocation envoyée). Aucun envoi réel n'est fait ; l'écran n'indique pas « Simulée » (écart E-19a-3). Un envoi avec le seul canal « Application » est refusé par le serveur avec le message "Aucune remise n'a pu être mise en file (consentements, canaux ou coordonnées)." (cas relevé en session éducateur, à reconfirmer).
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Date de l'entretien vide | « Ce champ est obligatoire. » sous « Date de l'entretien » |
| Motif "abc" | "Le motif doit faire au moins 5 caractères." |
| Élève non choisi | « Ce champ est obligatoire. » sous « Élève » |
| Aucun canal coché dans « Envoyer la convocation » | à relever en test (le serveur impose au moins un canal) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le parent (`/v2/schoollife/convocations`)

#### 19.16 Reporter, annuler, constater une absence
Compte : Éducateur · Où : `/v2/schoollife/convocations` · Prérequis : 19.15.
1. Créer une seconde convocation pour **DIABATE Nadia** (nature « Absences », motif "Convocation test guide : absences répétées", J+5, 10:00, lieu "Bureau vie scolaire test guide") puis l'envoyer (canaux par défaut).
2. Cliquer sur « Reporter », laisser la date vide et valider, puis choisir la date J+10, heure 11:00 et cliquer sur « Reporter ».
3. Sur le nouveau brouillon créé, cliquer sur « Annuler », saisir "No" (2 caractères) puis valider, puis saisir "Annulation test guide : report annulé" et cliquer sur « Annuler la convocation ».
4. Créer une troisième convocation pour **DIABATE Salimata** (nature « Santé », motif "Convocation test guide : suivi santé", J+6, 14:00), l'envoyer, puis cliquer sur « Absent » et « Enregistrer ».
5. Filtrer la liste avec la liste « Statut » : choisir « Reportée », puis « Annulée », puis « Absent », puis « Tous les statuts ».

Résultat attendu : étape 2 : date vide refusée avec « Choisissez une date. » ; ensuite « Convocation reportée : un nouveau brouillon a été créé. » ; l'originale passe « Reportée » et un nouveau brouillon la référence. Étape 3 : motif trop court refusé avec « Le motif doit comporter au moins 5 caractères. » ; ensuite « Convocation annulée. ». Étape 4 : « Absence enregistrée. », badge « Absent ». Étape 5 : le filtre ne montre que les convocations du statut choisi ; un filtre sans résultat affiche « Aucune convocation. » et « Créez une convocation pour inviter les tuteurs d'un élève. ». Les boutons « Reporter » et « Entretien tenu » n'apparaissent que pour une convocation « Envoyée » ou « Accusée ».
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] État vide du filtre

---

## Partie E. Effets d'une exclusion sur le statut de l'élève

#### 19.17 L'effet attend un humain : écarter, puis appliquer
Compte : Directeur · Où : `/v2/schoollife/validations`, section « Effets d'exclusion en attente » · Prérequis : 19.10 (mesure de TOURE Jean-Marc validée, M-C à reproduire), mesure de TOURE Yao de la graine.
**Attention : « Appliquer » modifie le statut d'un élève dans son dossier. À faire en dernier ; ne jamais le faire sur DIABATE Nadia ou DIABATE Salimata (comptes du parent et de l'élève de démonstration).**
1. Valider la mesure de la graine de **TOURE Yao** (section « À valider » > « Valider »). Un effet « Demande de changement de statut de l'élève » apparaît pour lui.
2. Sur l'effet de Yao, cliquer sur « Écarter », saisir "Non" puis valider (refus), puis "Effet écarté test guide : sanction non retenue" et cliquer sur « Écarter ».
3. Reproduire 19.8 pour **TOURE Jean-Marc** avec de nouvelles dates (J+14 et J+15) et le motif "Exclusion test guide : seconde proposition", puis la valider (19.10). Dans « Effets d'exclusion en attente », cliquer sur « Appliquer ».
4. Lire « Appliquer le changement de statut » : « Le statut de l'élève sera modifié dans son dossier, sous votre responsabilité. » Choisir « Nouveau statut de l'élève » = **Suspendu** (l'aide dit « Une suspension se lève ensuite par un acte humain. »), cliquer sur « Appliquer ».
5. Ouvrir la fiche élève de Jean-Marc dans le module des élèves (chapitre sur les élèves) et lire son statut.

Résultat attendu : étape 2 : motif trop court refusé avec « Le motif doit comporter au moins 5 caractères. » ; ensuite « Effet écarté. » et l'effet disparaît de la liste ; le statut de Yao n'a pas changé. Étape 4 : « Statut de l'élève modifié. » ; l'effet disparaît de la liste. Avant l'étape 4, le statut de Jean-Marc était « Actif » : aucune tâche automatique ne le change. Après, le dossier de Jean-Marc affiche le statut choisi. Le statut se rétablit par un autre acte humain dans le module des élèves ; l'écran n'offre pas de bouton "Lever". La mesure garde son statut « Validée » (le statut de la mesure n'est pas celui de l'élève ; la date d'effet n'est pas affichée : écart E-19a-7).
- [ ] Cas nominal (écarter)  - [ ] Cas nominal (appliquer)  - [ ] Cas invalide  - [ ] Droit refusé : l'éducateur ne voit pas la section

---

## Partie F. Confidentialité

#### 19.18 Élément confidentiel : masqué, lisible par la direction avec motif
Compte : Éducateur, Directeur, Directeur des études, Parent · Où : `/v2/schoollife/saisie` puis fiche · Prérequis : aucun.
1. Éducateur : « Déclarer un incident » pour **TOURE Jean-Marc** : type « Incident en classe (démonstration) », description "Incident test guide : fait confidentiel", **Confidentialité = Confidentiel** (l'aide dit « Jamais inférieure à celle du type ; elle ne s'abaisse plus ensuite. »). Message « Incident enregistré. ».
2. Éducateur : ouvrir le tableau de bord puis la fiche de Jean-Marc. Lire le niveau d'accès.
3. Directeur : ouvrir `/v2/schoollife`. L'incident apparaît sous la forme « Élément confidentiel (masqué) ». Ouvrir la fiche de Jean-Marc.
4. Directeur, fiche : l'élément porte le badge « Confidentiel » et le texte « Élément confidentiel : le contenu est masqué. » avec le bouton « Lire (motif exigé) ». Cliquer dessus, saisir "Lec" puis valider (refus), puis le motif "Lecture test guide : contrôle de la direction" et cliquer sur « Lire ».
5. Lire la fenêtre « Contenu confidentiel » (« Ce contenu n'est pas conservé sur cet appareil : fermez cette fenêtre après lecture. ») puis cliquer sur « Fermer ».
6. Parent : ouvrir la page de chaque enfant (19.13).

Résultat attendu : étape 2 : niveau d'accès « Standard » (« Les éléments restreints et confidentiels ne vous sont pas montrés. ») ; l'incident confidentiel n'est pas listé pour l'éducateur. Étape 4 : motif trop court refusé avec « Le motif doit comporter au moins 5 caractères. » ; ensuite la fenêtre affiche le type, la description, le lieu, le contexte et la déclaration de l'élève. La lecture est journalisée au nom du directeur avec son motif (consultable via le journal d'audit, chapitre audit). Étape 6 : jamais d'élément confidentiel pour la famille. Pour le directeur des études (si la fiche s'ouvre) : même niveau « Standard », aucun bouton « Lire (motif exigé) ».
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : aucun bouton « Lire (motif exigé) » pour l'éducateur

---

## Partie G. Paramètres de la vie scolaire

#### 19.19 Réglages par établissement
Compte : Directeur · Où : menu « Vie scolaire » > "Paramètres de vie scolaire" (`/v2/schoollife/parametres`) · Prérequis : MFA.
1. Ouvrir la page « Paramètres de la vie scolaire ». Lire l'encadré « Aucune valeur n'est fournie par défaut : types, gravités et barèmes sont à définir par votre établissement. ».
2. Dans « Réglages par établissement », lire la carte « Collège Le Baobab (démonstration) » : cases « Activer les points de conduite » (décochée), « Exiger un motif pour lire un élément confidentiel » (cochée), champ « Durée de conservation (jours) » (vide).
3. Saisir "0" dans « Durée de conservation (jours) » et cliquer sur « Enregistrer ». Puis saisir "365" et « Enregistrer ». Puis vider le champ et « Enregistrer ».

Résultat attendu : avec "0" : « Saisissez un nombre entier de jours supérieur à 0, ou laissez vide. » ; avec "365" : « Paramètre enregistré. » ; valeur conservée après rechargement (`F5`). Avec le champ vide : « Paramètre enregistré. » (durée non définie : aucune durée légale n'est codée). Remettre la case "Exiger un motif…" cochée à la fin.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'éducateur (`/v2/schoollife/parametres`)

#### 19.20 Niveau de gravité et type d'événement de l'établissement
Compte : Directeur · Où : `/v2/schoollife/parametres` · Prérequis : 19.19 ouvert.
1. Dans « Niveaux de gravité », lire les deux niveaux « Niveau 1 (démonstration) » et « Niveau 2 (démonstration) ». Cliquer sur « Ajouter un niveau » (fenêtre « Nouveau niveau de gravité ») et remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Code | TG_GRAVITE | oui (majuscules, chiffres et _) |
   | Libellé | Gravité test guide | oui |
   | Rang | 3 | oui (1 = le moins grave) |
   | Niveau actif | cochée | non |
   Cliquer sur « Enregistrer » : « Paramètre enregistré. ».
2. Dans « Types d'événements », cliquer sur « Ajouter un type » (fenêtre « Nouveau type d'événement ») et remplir : Code `TG_PERTURBATION`, Libellé "Perturbation test guide", Famille « Incident », Gravité par défaut "Gravité test guide", Confidentialité minimale « Standard », cases « Partageable avec la famille » cochée, « Type actif » cochée. « Enregistrer ».
3. Déclarer un incident (19.5) avec le type "Perturbation test guide" et la gravité "Gravité test guide" pour **BAMBA Aya** (description "Incident test guide : perturbation du cours").
4. Modifier le type : « Modifier » en face de "Perturbation test guide", décocher « Type actif », « Enregistrer ». Rouvrir la déclaration d'incident : le type n'est plus proposé.

Résultat attendu : le niveau apparaît dans la liste avec son rang ; le type affiche les étiquettes de circuit (ex. « directement en vigueur », « partageable avec la famille ») ; une fois désactivé, le type reçoit le badge « Inactif ». Le champ « Code » est en lecture seule en modification ; la « Famille » aussi pour un type déjà utilisé.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Code `1TG` (commence par un chiffre) | "Code attendu : majuscules, chiffres et _ (40 max)." |
| Libellé vide | « Ce champ est obligatoire. » |
| Rang vide | « Ce champ est obligatoire. » |
| Rang 0 | "La valeur doit être supérieure ou égale à 1." |
| Code déjà utilisé (`TG_GRAVITE` recréé) | le serveur met à jour le niveau existant (création ou mise à jour par code) : aucune erreur de doublon |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'éducateur

#### 19.21 Barème de points de conduite (optionnel, à faire en dernier)
Compte : Directeur · Où : `/v2/schoollife/parametres` · Prérequis : 19.19. **Attention : activer les points de conduite change le réglage de l'établissement et les faits montrés aux conseils de classe (chapitre 19b). À remettre en état ensuite.**
1. Cocher « Activer les points de conduite » dans la carte de l'établissement, « Enregistrer ». Ouvrir la fiche de DIABATE Nadia (via un incident à son nom si besoin) : la section « Points de conduite » apparaît avec le texte "Aucun barème actif ne s'applique à cet élève." et l'aide « Le solde est une aide dérivée du barème et du registre : la note de conduite du bulletin reste une saisie humaine. ».
2. Si la section « Barèmes de points de conduite » est visible (fonctionnalité incluse dans l'offre et droit de gestion), cliquer sur « Nouveau barème » et remplir : Établissement « Collège Le Baobab (démonstration) », Code `TG_BAREME`, Libellé "Barème test guide", Points initiaux 20, En vigueur à partir du (premier jour de l'année scolaire), Minimum 0, Maximum 20, Remise à zéro « par année », Origine « Démonstration (non réglementaire) ». « Créer le barème ».
3. Sur le barème (statut « Brouillon »), cliquer sur « Valeurs par type », saisir −2 pour « Avertissement (démonstration) », −5 pour « Exclusion temporaire (démonstration) », 1 pour « Encouragement (démonstration) », « Enregistrer les valeurs ». Puis « Activer ».
4. Rouvrir la fiche de Nadia, puis cliquer sur « Retirer » le barème et décocher « Activer les points de conduite ».

Résultat attendu : le badge « Démonstration » signale le barème ; le résumé indique « Points initiaux 20 (min 0, max 20) · remise à zéro : par année · depuis le … ». Un barème actif ne se modifie plus ; la valeur 0 pour un type est refusée par « Chaque valeur est un entier non nul. ». Le solde affiché n'est qu'une aide : aucune note de bulletin n'est calculée. Les valeurs exactes du solde sont à relever en test (non prouvées ici).
- [ ] Cas nominal  - [ ] Section absente avant activation  - [ ] État remis en l'état

---

## Partie H. Vue élève, droits et qualité

#### 19.22 L'élève voit sa propre vie scolaire partageable
Compte : Élève (DIABATE Nadia) · Où : menu du portail élève « Ma vie scolaire » (`/v2/schoollife/moi`) · Prérequis : 19.6 (encouragement visible de l'élève).
1. Ouvrir « Ma vie scolaire ».
2. Comparer avec la vue du parent (19.14).

Résultat attendu : titre « Ma vie scolaire », description « Ce que l'établissement partage avec vous : décisions notifiées et encouragements. ». Sous « Encouragements et observations » : l'encouragement test guide. L'encouragement de la graine ("Très bonne participation cette semaine.") n'est pas visible (personnel seulement). Aucune mesure n'est visible tant qu'aucune mesure notifiée ne concerne Nadia. Aucun bouton « Déposer un recours » sans mesure notifiée. Sans rien à afficher : « Rien à afficher pour le moment. ».
- [ ] Cas nominal  - [ ] Pas de donnée du personnel  - [ ] Droit refusé pour l'élève (`/v2/schoollife/famille`)

#### 19.23 Droits refusés (vérification par rôle)
Compte : chacun des comptes du tableau "Droits" · Où : adresses tapées à la main · Prérequis : aucun.
1. Pour chaque ligne du tableau "Adresses à taper à la main", se connecter avec le compte indiqué et taper l'adresse.
2. Contrôler aussi que, pour l'enseignant, la fiche d'un élève d'une autre classe n'est pas accessible (non testable avec une seule classe : à vérifier en test si un second enseignant existe).

Résultat attendu : page « Accès refusé » avec le texte "Vous n'avez pas les droits nécessaires pour afficher cette page.", sans aucune donnée de vie scolaire visible, y compris dans le code de la page. Aucune boucle de redirection.
- [ ] Éducateur  - [ ] Enseignant  - [ ] Parent  - [ ] Élève  - [ ] Secrétariat et économe

#### 19.24 Qualité transversale : états vides, chargement, clavier, téléphone
Compte : Éducateur et Parent · Où : `/v2/schoollife/convocations`, `/v2/schoollife/saisie`, `/v2/schoollife/famille` · Prérequis : aucun.
1. Chargement : à l'ouverture d'une page, un indicateur de chargement doit précéder les données (un bref message "Établissement inconnu" peut s'afficher quelques secondes en mode développement : écart connu du rapport QA 08).
2. États vides : filtre de convocations sans résultat (« Aucune convocation. ») ; page parent sans rien (« Rien à afficher pour le moment. »).
3. Clavier : ouvrir « Nouvelle convocation » avec Tab et Entrée ; parcourir les champs avec Tab ; fermer avec Échap ; le focus doit rester dans la fenêtre pendant qu'elle est ouverte.
4. Téléphone : réduire la fenêtre à environ 375 pixels de large ; les trois cartes de « Saisie rapide » et la liste des convocations doivent rester lisibles sans défilement horizontal de la page (les boutons de « Saisie rapide » se chevauchaient à 894 px dans une version antérieure : à reconfirmer).

Résultat attendu : aucun texte brut technique (codes en capitales, identifiants) hors ceux listés dans les écarts ; messages en français.
- [ ] Chargement  - [ ] États vides  - [ ] Clavier  - [ ] Largeur téléphone

---

## Données créées (pour l'annexe)

| Enregistrement | Où | Détail |
|---|---|---|
| Incident "Incident test guide : bavardage pendant la composition" | 19.5 | COULIBALY Moussa, déclaré par l'enseignant |
| Encouragement "Encouragement test guide : très bonne participation en classe" | 19.6 | DIABATE Nadia, visible de l'élève et des parents |
| Observation "Observation test guide : a besoin d'un suivi en lecture" | 19.6, 19.7 | COULIBALY Salimata, retirée en 19.7 |
| Incident "Incident test guide : oubli de matériel" | 19.7 | COULIBALY Salimata |
| Incident "Incident test guide : propos injurieux envers un camarade" | 19.8 | TOURE Jean-Marc, niveau 2 |
| Mesure M-A "Exclusion test guide : propos injurieux répétés" | 19.8, 19.10, 19.12 | TOURE Jean-Marc, validée, notifiée puis révoquée |
| Mesure M-B "Avertissement test guide : retards répétés" | 19.9, 19.10 | COULIBALY Moussa, rejetée |
| Incident "Incident test guide : refus d'obéir" et mesure "Exclusion test guide : proposition de la direction" | 19.11 | COULIBALY Salimata, mesure rejetée |
| Mesure "Avertissement test guide : à annuler" | 19.12 | COULIBALY Moussa, validée puis annulée |
| Mesure M-C "Exclusion test guide : seconde proposition" | 19.17 | TOURE Jean-Marc, validée, effet appliqué « Suspendu » |
| Recours "Recours test guide : la famille conteste la décision" | 19.14 | DIABATE Salimata, tranché "maintenu" |
| Incident "Incident test guide : fait confidentiel" | 19.18 | TOURE Jean-Marc, confidentiel |
| Convocations "Convocation test guide : …" (3, plus 1 brouillon annulé) | 19.15, 19.16 | DIABATE Salimata et DIABATE Nadia |
| Niveau de gravité `TG_GRAVITE`, type `TG_PERTURBATION` (inactif) | 19.20 | établissement |
| Barème `TG_BAREME` (retiré) | 19.21 | optionnel |
| Incident "Incident test guide : perturbation du cours" | 19.20 | BAMBA Aya |

Actions de la graine modifiées : mesure de TOURE Yao validée puis son effet écarté (19.17) ; mesure de BAMBA Fatou « Marquer exécutée » (19.12) ; mesure de DIABATE Salimata notifiée, recours maintenu (19.13, 19.14).

## Écarts constatés

| Réf. | Écran | Constat | Gravité |
|---|---|---|---|
| E-19a-1 | Tableau de bord et fiche élève (directeur des études) | Le rôle porte `schoollife.read.all` (tableau de bord autorisé) mais pas `schoollife.read`, que la garde de la page de la fiche (`eleves/[studentId]`) et de la saisie rapide exige : « Ouvrir le dossier » mène à « Accès refusé ». À confirmer en test (19.3). | Majeur (à confirmer) |
| E-19a-2 | Tableau de bord (éducateur, directeur des études) | Les indicateurs « Mesures à valider » et « Effets en attente d'une décision » sont des liens vers `/v2/schoollife/validations`, refusée à ces rôles. | Mineur |
| E-19a-3 | Convocations (envoi) | Aucune mention « Simulée » ni du statut de remise après l'envoi (rapport QA 08, C-08-03, reconnu, à faire). | Majeur |
| E-19a-4 | Saisie rapide | Les élèves à inscription "en attente" sont proposés puis refusés avec un texte inexact ("n'est plus active") (C-08-05). | Mineur |
| E-19a-5 | Fiche, validations, convocations | L'auteur est l'identifiant de connexion ("educateur") et non le nom de la personne (C-08-08). | Mineur |
| E-19a-6 | Mesures à valider | « Marquer exécutée » (et la révocation) ne demandent pas de confirmation explicite ; des fenêtres de confirmation existent pour d'autres actes irréversibles (C-11-01, partiellement corrigé). | Mineur |
| E-19a-7 | Mesures / fiche élève | Après une exclusion validée et appliquée, la date d'effet n'est pas affichée ; le statut de l'élève ne change qu'à l'acte « Appliquer » (conforme à la règle, C-11-05). | Suggestion |
| E-19a-8 | Menu de gestion | Aucune entrée de menu « Saisie rapide » pour l'éducateur (entrée rattachée au portail enseignant) : accès par l'onglet ou le bouton du tableau de bord. | Suggestion |
| E-19a-9 | Fiche élève | Le tableau de bord ne liste que les élèves ayant un incident ouvert ou une mesure proposée ; pas de recherche d'élève dans le module : une fiche sans incident n'est atteignable que par l'adresse. | Mineur |

## À vérifier en test

- 19.3 : accès du directeur des études à la fiche élève (E-19a-1).
- 19.15 : message exact quand aucun canal n'est coché ; envoi avec le seul canal « Application ».
- 19.18 : l'incident confidentiel déclaré par l'éducateur disparaît bien de sa propre chronologie.
- 19.21 : disponibilité de la fonctionnalité "points de conduite" dans l'offre de démonstration ; valeurs du solde.
- Valeurs exactes des indicateurs du tableau de bord si la base n'est pas intacte.

## Non couvert / limites connues

- **Hors ligne** : la saisie rapide rejouable (clé d'idempotence) existe côté API mais aucun mode hors ligne n'est implémenté côté web (spec 006, AC12.5).
- **Rappels automatiques** : le rappel de convocation et les avis de début et de fin d'exclusion sont des travaux planifiés éteints par défaut (aucun écran pour les régler) ; non testables ici.
- **Absences pendant une exclusion** : leur qualification (justifiée, non comptée) n'est pas modélisée (question métier ouverte Q6-19).
- **Instruction d'un incident** (examiner, confirmer, écarter, clore) : routes API présentes, aucun écran dans l'interface web.
- **Note de conduite du bulletin** : saisie humaine dans le module des évaluations, jamais calculée par la vie scolaire.
- **Isolation entre établissements** : testée dans le chapitre 01 (aucun accès à la vie scolaire depuis l'école primaire ou l'université).
