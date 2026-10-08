# Chapitre 6. Présences et appel

> Établissements : Collège Le Baobab (`secondaire-test`, appel **par séance**) et École Les Palmiers (`primaire-test`, appel **journalier**, matin et après-midi au primaire, une fois par jour en maternelle). Le supérieur (`superieur-test`) se comporte comme le secondaire (mêmes gestes, niveau "Licence").
> Adresse de l'application : `http://localhost:3000` (API `http://localhost:4000`). **Adresses des écrans : le dossier `app/v2/` donne directement le préfixe `/v2`** (ni `next.config.js` ni `middleware.ts` ne réécrivent ces routes) ; l'adresse tapée dans le navigateur est donc `http://localhost:3000/v2/attendance/...`.
> Durée estimée : 2 h à 2 h 30. Les scénarios s'enchaînent : faire dans l'ordre.

## Prérequis

1. L'environnement est celui de l'annexe (`annexe-donnees-de-depart.md`), sans autre test préalable sur les présences.
2. **Les séances d'appel de test existent** : quatre cours de la classe 6e A créés **aujourd'hui** avec le compte Directeur des études, intervenant TRAORE Kouadio, au scénario **7.7 du chapitre 07** : "Séance d'appel test guide" (11:00 à 12:00), "Séance d'appel 2 test guide" (12:30 à 13:30), "Séance d'appel 3 test guide" (14:00 à 15:00), "Séance d'appel 4 test guide" (15:30 à 16:30). Sans elles, les scénarios de la partie A et B n'ont pas de séance du jour à pointer. Si le jour du test est du lundi au jeudi, la séance de démonstration de 8 h à 10 h peut servir de secours, mais les données (élèves absents) ne seront pas celles de ce chapitre.
3. Pour les congés (6.20 et 6.21), la séance "Séance de remplacement test guide" (vendredi V1 de la semaine prochaine, scénario 7.7) rend l'effet sur l'emploi du temps visible au chapitre 07.
5. Téléchargements (export CSV, pièces) : un agent "Claude web" doit **demander l'accord de l'utilisateur** avant chaque téléchargement.
6. Les fichiers de pièces se trouvent dans `docs/guide-test/jeux-de-donnees/` : `justificatif-maladie-test-guide.pdf` (PDF valide), `justificatif-photo-test-guide.png` (image valide), `justificatif-faux-test-guide.pdf` (texte renommé en .pdf), et un fichier `justificatif-trop-lourd-test-guide.pdf` **à fabriquer sur le poste** (non versionné, 5,6 Mo, au-dessus de la limite de 5 120 Ko) : dans PowerShell, `$f=[IO.File]::Create("justificatif-trop-lourd-test-guide.pdf"); $f.SetLength(5900000); $f.Close()`, puis le supprimer après le test.

## Comptes à utiliser

| Rôle | E-mail | MFA | Sert à |
|---|---|---|---|
| Enseignant (secondaire) | `enseignant@secondaire-test.test` (TRAORE Kouadio) | non | faire l'appel, congés et pointage personnel |
| Éducateur | `educateur@secondaire-test.test` | non | suivre, valider, déposer un justificatif |
| Directeur des études | `etudes@secondaire-test.test` | oui | décider des justificatifs et des congés, règles d'alerte |
| Directeur | `directeur@secondaire-test.test` | oui | rouvrir un appel, surcharger, congés |
| Secrétariat | `secretariat@secondaire-test.test` | oui | consultation, dépôt de justificatif |
| Responsable pédagogique | `pedagogie@secondaire-test.test` | oui | lecture seule |
| Parent (tuteur 1, DIABATE Séka) | `parent@secondaire-test.test` | non | absences de Nadia et Salimata, dépôt |
| Élève (Nadia) | `eleve@secondaire-test.test` | non | « Mes absences » |
| Économe | `econome@secondaire-test.test` | oui | contrôle de refus |
| Instituteur CP1 A (primaire) | `enseignant@primaire-test.test` | non | appel journalier du matin et de l'après-midi |
| Instituteur de maternelle | `instituteur.maternelle@primaire-test.test` | non | appel journalier de la Grande Section A |
| Directeur (primaire) | `directeur@primaire-test.test` | oui | validation des appels journaliers |

Aucun mot de passe ni code MFA n'est écrit ici : cliquer sur le compte dans le panneau de droite de `/v2/login` ; pour un compte MFA, la page propose le code du moment.

## Les règles d'appel réelles (à lire avant de tester)

Ces règles sont lues dans le code (`apps/api/src/modules/attendance`, `README.md` du module) ; elles expliquent la plupart des "refus" que verra le testeur.

1. **Un seul modèle d'appel**, cinq statuts : « Présent », « Absent », « En retard », « Absent justifié », « Départ anticipé » (et « En congé » pour le personnel). Un appel passe par les états « Ouvert », « Soumis », « Validé », « Annulé ».
2. **Politique d'appel par cycle** (donnée d'établissement, modèle de pack) :
   - **secondaire et supérieur** : appel **par séance** de l'emploi du temps (portée « Par séance »). L'appel journalier est **refusé** : "La politique d'appel de ce cycle n'autorise pas l'appel journalier." L'enseignant du secondaire **n'a donc aucune rubrique d'appel journalier** ;
   - **primaire** : appel **journalier**, **deux par jour** (le matin et l'après-midi) : la demi-journée est obligatoire ; l'appel « Journée entière » est refusé ; l'appel par séance est refusé ("Dans votre cycle, l'appel se fait une fois par jour pour la classe, et non séance par séance." est affiché à la place des séances) ;
   - **maternelle** : appel journalier **unique** (une fois par jour).
3. **Qui fait l'appel** : la direction (droit "gérer"), le remplaçant désigné, un intervenant de la séance ou un membre du personnel affecté à la classe. Une personne sans fiche de personnel n'a aucun droit d'enseignant : message "Vous n'êtes pas intervenant de cette séance ni affecté à cette classe : l'appel est réservé." (cas du secrétariat, qui a le droit de saisie mais pas l'affectation).
4. **Tout le monde est présent par défaut** : on touche seulement les exceptions. À la soumission, les élèves non pointés reçoivent « Présent ». Seuls les élèves dont l'**inscription est active** à la date de la séance figurent dans la liste (les inscriptions "en attente" n'y sont pas : ce n'est pas un défaut de données, constat de la session QA 07).
5. **Qui soumet, qui valide, qui rouvre** : l'enseignant soumet son appel ; **valider** appartient à l'éducateur, au directeur des études et à la direction (droit "valider") ; **rouvrir** un appel validé n'appartient qu'à la direction (droit sensible, motif de 5 caractères au moins, audité) ; le directeur des études et l'éducateur **ne rouvrent pas**.
6. **Correction et verrouillage** : après soumission, l'enseignant peut corriger pendant le **délai de correction** (120 minutes dans le modèle de démonstration du secondaire) ; passé ce délai, seule une personne qui gère les présences corrige. Un appel **validé** est figé (message « Cet appel est validé : il ne peut plus être modifié ici. La direction peut le rouvrir avec un motif. ») ; un appel **annulé** aussi.
7. **Justification** : un justificatif couvre une **période** (premier et dernier jour) et pas un seul pointage. Il peut être déposé par le tuteur lié (parent), l'élève lui-même ou le personnel habilité (éducateur, secrétariat, direction). **Décider** (accepter, rejeter, révoquer) n'appartient qu'au directeur des études et à la direction. Accepter marque « Absent justifié » toutes les absences de l'élève dans la période et recalcule les récapitulatifs ; révoquer restaure les statuts d'origine. Aucun justificatif ne peut couvrir une date future ni sortir de l'année scolaire de l'inscription.
8. **Aucun seuil officiel** : le logiciel ne fixe ni "3 retards = 1 absence" ni seuil d'alerte. Les règles d'alerte sont des paramètres de l'établissement, vides au départ.
9. Les récapitulatifs par période sont **dérivés** des appels (« Calculé ») ; seule la direction peut les **surcharger** (motif obligatoire, « Surchargé »).

## Droits

| Écran | Adresse | Qui y accède (droit exigé) |
|---|---|---|
| Faire l'appel (liste) | `/v2/attendance/call` | enseignant, instituteur, éducateur, secrétariat, directeur des études, direction (`attendance.take` ou `attendance.manage`) |
| Appel d'une séance / d'une classe | `/v2/attendance/call/<kind>/<id>` | idem ; l'API vérifie en plus l'affectation |
| Tableau de bord, Suivi des appels, Alertes, fiche d'élève | `/v2/attendance`, `/v2/attendance/sessions`, `/v2/attendance/alerts`, `/v2/attendance/student/<id>` | `attendance.read` : enseignant, instituteur, éducateur, secrétariat, responsable pédagogique, directeur des études, direction |
| Absences, Appels non faits | `/v2/attendance/absences`, `/v2/attendance/compliance` | `attendance.report.read` : éducateur, secrétariat, responsable pédagogique, directeur des études, direction (pas l'enseignant) |
| Justificatifs | `/v2/attendance/justifications` | `attendance.justification.read` : éducateur, secrétariat, directeur des études, direction |
| Conflits de synchronisation | `/v2/attendance/conflicts` | `attendance.manage` : éducateur, directeur des études, direction |
| Personnel | `/v2/attendance/staff` | `attendance.staff.read` : directeur des études, direction |
| Ma présence | `/v2/attendance/staff/me` | `attendance.own.*` ou demande de congé : enseignant, instituteur, éducateur, personnel, direction (pas le directeur des études) |
| Mes enfants / Mes absences | `/v2/attendance/children`, `/v2/attendance/children/<id>`, `/v2/attendance/me` | parent (`attendance.child.read`) ; élève (`attendance.self.read`) |
| Mes appels (portail) | `/v2/teacher/attendance` | `attendance.take` ou `attendance.manage` |

Un droit manquant mène à la page « Accès refusé » (`/unauthorized`, titre « Accès refusé », texte "Vous n'avez pas les droits nécessaires pour afficher cette page."). Une adresse malformée (identifiant qui n'est pas un UUID, ou autre mot que `occurrence` / `daily`) donne la page introuvable de Next ("404", en anglais : écart connu).

**Adresses à taper à la main qui doivent être refusées** (voir le scénario 6.24) :
- avec `parent@secondaire-test.test` : `/v2/attendance/sessions`, `/v2/attendance/justifications`, `/v2/attendance/call` ;
- avec `eleve@secondaire-test.test` : `/v2/attendance/children`, `/v2/attendance/absences`, `/v2/attendance/staff` ;
- avec `enseignant@secondaire-test.test` : `/v2/attendance/absences`, `/v2/attendance/justifications`, `/v2/attendance/conflicts`, `/v2/attendance/staff`, `/v2/attendance/compliance` ;
- avec `econome@secondaire-test.test` : toute adresse `/v2/attendance/...` et `/v2/teacher/attendance`.

## Données de départ

Source : `scripts/seed-v2/scenario.ts` (section "appels"), `scripts/seed-v2/demo/primary.ts`, modèle de pack `apps/api/src/modules/attendance/domain/reference-pack.ts` et `templates/CI/primary.json`.

- **Collège Le Baobab, classe 6e A** : deux appels par séance déjà **validés** (les deux premières séances passées de l'année, pointées par TRAORE Kouadio). Premier appel : BAMBA Aya absente ; deuxième : BAMBA Fatou absente ; dans les deux : COULIBALY Salimata en retard de 10 minutes ; les autres présents. Les dates dépendent du jour de génération de la base : élargir le filtre « Du » du suivi des appels.
- **Liste d'appel de la 6e A** : les élèves à inscription active (dix d'après le rapport de session 07 : DIABATE Nadia, DIABATE Salimata, BAMBA Aya, BAMBA Fatou, COULIBALY Moussa, COULIBALY Salimata, TOURE Yao, TOURE Jean-Marc, ADOU Aïcha, ASSI Brice). Les élèves SORO, N'GUESSAN et KOUASSI à inscription "en attente" n'y figurent pas.
- **École Les Palmiers** : aucun appel pour CP1 A ; un appel journalier de la Grande Section A (maternelle) est déjà validé le jour de génération de la base (le deuxième enfant absent, le troisième en retard de 10 minutes).
- **Aucun** justificatif, congé, présence du personnel, conflit de synchronisation ni règle d'alerte n'existe au départ.
- **Référentiels de pack** : motifs « Maladie », « Événement familial », « Difficulté de transport », « Activité officielle », « Autre » ; types de congé « Congé annuel », « Congé maladie », « Congé de maternité », « Congé sans solde », « Absence autorisée » ; pièces acceptées : PDF, JPEG, PNG, 5 242 880 octets au plus.

## Scénarios

### A. Faire l'appel

#### 6.1 Lire « Mes appels » selon le cycle
Compte : Enseignant (Collège Le Baobab), puis Instituteur CP1 A, puis Instituteur de maternelle (École Les Palmiers) · Où : portail enseignant, menu « Mes appels » (`/v2/teacher/attendance`) · Prérequis : "Séance d'appel test guide" créée (7.7).
1. Se connecter avec `enseignant@secondaire-test.test`, ouvrir « Mes appels ».
2. Lire le titre « Mes séances à faire », puis la rubrique « Aujourd'hui » : la "Séance d'appel test guide" apparaît avec l'état « Appel à faire » et le bouton « Faire l'appel ». Si le jour est du lundi au jeudi, la séance de démonstration de 8 h à 10 h y est aussi.
3. Constater qu'**aucune rubrique « Appel de la journée » n'est proposée** (cycle à appel par séance).
4. Descendre : la rubrique « Mes appels des 30 derniers jours » liste l'historique (les deux appels de démonstration y figurent s'ils ont moins de 30 jours). Attendre la fin du chargement : un faux état vide « Aucun appel sur la période. » peut s'afficher quelques secondes (écart connu C-07-01).
5. Se déconnecter, se connecter avec `enseignant@primaire-test.test` : ouvrir « Mes appels ».
6. Lire la rubrique « Appel de la journée » et la phrase "Pour les classes à appel journalier (une seule fois par jour)." : pour la classe CP1 A, **deux lignes** : « Matin » avec le bouton « Appel du matin », « Après-midi » avec « Appel de l'après-midi » (et "Cette classe fait l'appel le matin et l'après-midi."). Aucune séance ne propose « Faire l'appel » : message "Dans votre cycle, l'appel se fait une fois par jour pour la classe, et non séance par séance." ou « Aucune séance prévue aujourd'hui. ».
7. Se connecter avec `instituteur.maternelle@primaire-test.test` : la rubrique « Appel de la journée » propose un seul bouton « Appel du jour » pour la Grande Section A.
8. Taper à la main `/v2/teacher/attendance/call` (avec un compte enseignant) : la page n'a pas de contenu propre et **redirige** vers « Mes appels » (`/v2/teacher/attendance`).
Résultat attendu : secondaire = séances seulement ; primaire = deux appels par jour ; maternelle = un appel par jour. Si le primaire affiche « Appel du jour » au lieu des deux demi-journées, la politique de la base est celle d'avant la décision Q-P17 : le noter (à vérifier en test).
- [ ] Cas nominal  - [ ] Pas d'appel journalier pour l'enseignant du secondaire  - [ ] Libellés en français

#### 6.2 Faire l'appel d'une séance et le soumettre (secondaire)
Compte : Enseignant (Collège Le Baobab) · Où : « Mes appels » > « Faire l'appel » (`/v2/teacher/attendance/call/occurrence/<id-seance>`) · Prérequis : 6.1.
1. Sur "Séance d'appel test guide", cliquer « Faire l'appel ». L'écran « Faire l'appel » s'ouvre (« Ouverture de l'appel… » puis la liste) : **l'ouverture crée l'appel en base** (une écriture dès l'ouverture). Le titre rappelle la classe et la date ; l'état est « Appel ouvert ».
2. Lire l'aide "Tout le monde est présent par défaut : touchez uniquement les exceptions." et le résumé « Résumé de l'appel » (par exemple "Présent : 10").
3. Toucher la ligne **DIABATE Nadia** : elle passe à « Absent ». Toucher deux fois : retour à « Présent » ; la remettre à « Absent ».
4. Pour **DIABATE Salimata**, toucher le bouton à trois points (« Autre statut pour DIABATE Salimata »). Dans la fenêtre « Statut de DIABATE Salimata » :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Statut (cases à cocher) | En retard | oui |
   | Minutes de retard | 10 | non (facultatif selon la politique) |
   Cliquer « Appliquer ».
5. Constater que « Absent justifié » n'est **pas** proposé dans la liste des statuts de l'enseignant ; le texte "Une absence se justifie par un justificatif accepté (ou par la direction, en ligne)." l'explique.
6. Cliquer « Soumettre l'appel ».
Résultat attendu : message "Appel soumis : 1 absent, 1 retard." (ou seulement "Appel soumis." quand la fonction d'appel hors ligne est active) ; badge « Appel soumis » ; le résumé affiche environ "Présent : 8", "Absent : 1", "En retard : 1" ; la ligne de Salimata affiche "En retard 10 min" ; le bouton devient « Enregistrer les corrections » (inactif tant qu'on ne modifie rien). Revenir à « Mes appels » : la séance porte « Appel soumis » et le bouton « Voir l'appel ». Dans l'emploi du temps (chapitre 07), la séance passe à « Constatée » (effet de la soumission).
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Statut « En retard », minutes `0` ou `1500` ou `abc` | "Entrez un nombre entier de minutes entre 1 et 1440." (sous « Minutes de retard ») |
| Statut « En retard », minutes `90` sur une séance d'une heure | à la soumission : "Le retard dépasse la durée de la séance." (message de l'API, à relever en test) |
| Ouvrir l'adresse avec un identifiant non UUID : `/v2/teacher/attendance/call/occurrence/abc` | page introuvable (404) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le parent (`/v2/attendance/call`)

#### 6.3 Corriger après soumission, soumettre deux fois, rouvrir l'écran
Compte : Enseignant · Où : « Mes appels » > « Voir l'appel » · Prérequis : 6.2.
1. Ouvrir « Voir l'appel » de la séance soumise. Constater que les lignes restent modifiables (délai de correction).
2. Passer **COULIBALY Moussa** en « Absent » : le texte du pied indique "1 modification à envoyer". Cliquer « Enregistrer les corrections ».
3. Remettre COULIBALY Moussa en « Présent » et enregistrer de nouveau (pour garder les chiffres du scénario).
4. Ouvrir la même séance dans un second onglet et cliquer « Soumettre l'appel » si le bouton existe : le texte "Appel déjà soumis." s'affiche, aucun doublon.
Résultat attendu : « Corrections enregistrées. » ; les récapitulatifs sont recalculés ; aucun second appel n'est créé pour la même séance (l'ouverture renvoie l'appel existant).
- [ ] Cas nominal  - [ ] Aucun doublon d'appel  - [ ] Délai de correction dépassé : voir "Non couvert"

#### 6.4 Absence justifiée immédiate par la direction
Compte : Directeur des études (Collège Le Baobab) · Où : « Suivi des appels » > « Ouvrir » (`/v2/attendance/call/occurrence/<id>`) · Prérequis : 6.2 (appel soumis).
1. Ouvrir l'appel de "Séance d'appel test guide" depuis « Suivi des appels » (le directeur des études gère les présences).
2. Sur **TOURE Yao** (présent), toucher le bouton à trois points (« Autre statut pour TOURE Yao ») : un lien « Enregistrer une absence justifiée… » est proposé (droit de décision, en ligne).
3. L'utiliser : fenêtre « Absence justifiée : TOURE Yao » :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Motif | Difficulté de transport | oui |
   | Commentaire | "Bus en retard, test guide" | non |
   Cliquer « Enregistrer ».
Cas invalide : valider sans choisir de motif : "Choisissez un motif."
Résultat attendu : "Absence justifiée enregistrée." ; la ligne de TOURE Yao passe à « Absent » avec la mention « Justifié » (l'outil pointe l'absence puis crée et accepte un justificatif d'un jour, en une seule opération) ; ce justificatif est visible dans « Justificatifs d'absence » avec l'état « Accepté ».
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Lien absent pour l'enseignant

### B. Suivre, valider, rouvrir

#### 6.5 Suivre les appels et valider (éducateur)
Compte : Éducateur (Collège Le Baobab) · Où : module Présences, « Suivi des appels » (`/v2/attendance/sessions`) · Prérequis : 6.2.
1. Ouvrir « Suivi des appels ». Les filtres « Du » (6 jours avant aujourd'hui par défaut) et « Au » (aujourd'hui) limitent la liste ; régler « Du » sur le 1er septembre pour voir les deux appels de démonstration.
2. Repérer la colonne « État » : « Validé » (démonstration), « Soumis » (6.2). Tester les filtres « État » (« Ouvert », « Soumis », « Validé », « Annulé ») et « Classe » (« Toutes les classes » puis 6e A).
3. Sur l'appel « Soumis », cliquer « Valider ». **Aucune fenêtre de confirmation** n'est demandée (constat de la session QA 08 : l'action est immédiate).
Résultat attendu : "Appel validé." ; l'état passe à « Validé » ; les boutons « Valider » et « Annuler » disparaissent de la ligne ; « Rouvrir » **n'apparaît pas** pour l'éducateur. Valider un appel déjà validé ne change rien.
Cas invalide : aucun (pas de formulaire).
- [ ] Cas nominal  - [ ] Filtres corrects  - [ ] « Rouvrir » absent pour l'éducateur

#### 6.6 Validation par lot
Compte : Directeur des études · Où : « Suivi des appels » · Prérequis : deux appels « Soumis ». Avec le compte enseignant, faire l'appel de "Séance d'appel 2 test guide" (DIABATE Nadia « Absent », les autres présents) et de "Séance d'appel 3 test guide" (tout le monde présent) et soumettre les deux, sans les valider.
1. Cocher la case de chaque appel « Soumis » (« Sélectionner l'appel de 6e A du … »).
2. Cliquer "Valider les 2 séances sélectionnées".
Résultat attendu : "2 appels validés." Chaque échec éventuel est listé sous "1 appel n'a pas pu être validé" sans bloquer les autres.
- [ ] Cas nominal  - [ ] Cas invalide (appel déjà validé : sans effet)  - [ ] Case de sélection absente pour l'enseignant

#### 6.7 Rouvrir un appel validé avec un motif, corriger, revalider
Compte : Directeur (Collège Le Baobab, MFA) · Où : « Suivi des appels » · Prérequis : 6.5 (appel validé de test).
1. Sur l'appel validé de "Séance d'appel test guide", cliquer « Rouvrir ».
2. La fenêtre « Rouvrir l'appel » rappelle : "Acte sensible : l'appel validé repasse en correction. Le motif est conservé et l'action est auditée."
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Motif | "Erreur de saisie test guide" | oui (5 à 500 caractères) |
3. Confirmer (« Rouvrir »). Une fenêtre « Confirmez votre identité » peut demander le code MFA du moment.
4. L'appel repasse à « Soumis ». Cliquer « Ouvrir », passer **TOURE Jean-Marc** de « Présent » à « Absent », « Enregistrer les corrections ». (Cette absence reste dans les données du chapitre.)
5. Revenir à « Suivi des appels » et cliquer « Valider ».
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Motif vide, ou `abc` (3 caractères) | "Le motif doit comporter au moins 5 caractères." |
| Un appel « Soumis » (pas validé) : bouton « Rouvrir » | absent (seul un appel validé se rouvre) |
Résultat attendu : "Appel rouvert." puis "Corrections enregistrées." puis "Appel validé." ; le récapitulatif de la classe est recalculé (voir 6.13).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] « Rouvrir » absent pour le directeur des études

#### 6.8 Annuler un appel avec motif
Compte : Directeur des études · Où : « Suivi des appels » · Prérequis : un appel « Ouvert » : avec le compte enseignant, ouvrir l'appel de "Séance d'appel 4 test guide" (bouton « Faire l'appel ») sans le soumettre.
1. Dans « Suivi des appels », cliquer « Annuler » sur la ligne de "Séance d'appel 4 test guide" (fenêtre « Annuler l'appel » : "L'appel annulé ne compte plus dans les récapitulatifs. Le motif est conservé.").
2. Saisir « Motif » : "Appel ouvert par erreur test guide". Confirmer.
Cas invalide : motif de 2 caractères : "Le motif doit comporter au moins 5 caractères."
Résultat attendu : "Appel annulé." ; état « Annulé » ; la ligne ne propose plus ni « Valider » ni « Annuler » ; un appel annulé est figé (« Cet appel est annulé. »). Un appel « Validé » ne s'annule qu'après réouverture.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Annulation d'un appel validé impossible directement

### C. Appel journalier (primaire et maternelle)

#### 6.9 Appel du matin et de l'après-midi du CP1 A
Compte : Instituteur CP1 A (École Les Palmiers) · Où : « Mes appels » > « Appel de la journée » (`/v2/teacher/attendance/call/daily/<id-classe>?date=AAAA-MM-JJ&part=MORNING`) · Prérequis : 6.1.
1. Cliquer « Appel du matin » pour la classe CP1 A. L'écran s'ouvre (titre avec la classe, la date et « Matin »).
2. Marquer un élève « Absent » (une exception), soumettre.
3. Revenir à « Mes appels » : la ligne « Matin » porte « Appel soumis ».
4. Cliquer « Appel de l'après-midi » : faire l'appel (tout le monde présent) et soumettre. Constater que l'appel du matin n'est pas modifié.
5. Cliquer de nouveau « Appel du matin » : l'écran ouvre **le même appel** (pas de doublon).
Résultat attendu : deux appels distincts par jour et par classe (colonne « Type » du suivi des appels : "Journalier · Matin" et "Journalier · Après-midi"). Aucune notion de séance ni d'heure.
Cas invalide (direction, scénario 6.10) : l'appel de la journée entière est refusé.
- [ ] Cas nominal  - [ ] Pas de doublon  - [ ] Droit refusé pour l'enseignant du secondaire (pas de rubrique journalière)

#### 6.10 La politique d'appel est respectée
Compte : Directeur (Collège Le Baobab) puis Instituteur CP1 A · Où : « Faire l'appel » (`/v2/attendance/call`) · Prérequis : aucun.
1. Avec le directeur, ouvrir « Faire l'appel » (`/v2/attendance/call`). Sous « Appel de la journée », le bloc de direction propose « Autre classe », « Date », « Demi-journée » (« Journée entière », « Matin », « Après-midi »).
2. Choisir la classe 6e A, la date du jour, « Journée entière », cliquer « Ouvrir ».
3. Résultat : un message d'erreur de l'API : "La politique d'appel de ce cycle n'autorise pas l'appel journalier." (rien n'est créé).
4. Avec le directeur du primaire (`directeur@primaire-test.test`), faire la même chose pour CP1 A en « Journée entière » : refus "La politique d'appel de ce cycle demande deux appels par jour (matin et après-midi) : l'appel de la journée entière n'est pas autorisé." ; avec « Matin » : l'appel s'ouvre. Pour la Grande Section A, « Matin » est refusé : "La politique d'appel de ce cycle prévoit un seul appel par jour : l'appel du matin ou de l'après-midi n'est pas autorisé."
Résultat attendu : les messages ci-dessus ; la page « Faire l'appel » ne crée jamais un type d'appel interdit par la politique.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (bloc de direction absent pour l'enseignant)

#### 6.11 Maternelle : appel du jour déjà validé (lecture seule)
Compte : Instituteur de maternelle (École Les Palmiers) · Où : « Mes appels » > « Appel du jour » · Prérequis : base créée le jour même (sinon un nouvel appel s'ouvre).
1. Cliquer « Appel du jour » pour la Grande Section A.
2. Lire le bandeau et les statuts.
Résultat attendu : si l'appel date du jour de génération, il est « Appel validé » : bandeau "Cet appel est validé : il ne peut plus être modifié ici. La direction peut le rouvrir avec un motif.", le bouton de soumission est inactif, un enfant « Absent », un autre "En retard 10 min". Un autre jour, un nouvel appel s'ouvre (« Appel ouvert ») : le faire comme en 6.9, puis le valider avec le directeur du primaire (6.5).
- [ ] Cas nominal  - [ ] Cas invalide (modification impossible)  - [ ] Droit refusé : validation impossible pour l'instituteur

### D. Rapports et récapitulatifs

#### 6.12 Absences et retards, export CSV
Compte : Éducateur · Où : « Absences » (`/v2/attendance/absences`) · Prérequis : 6.2.
1. Ouvrir « Absences ». Les filtres « Année scolaire » et « Classe » sont proposés, puis « Du », « Au », « Justification » (par défaut « À justifier »), « Statut » (« Absent », « En retard », « Départ anticipé », « Absent justifié »).
2. Choisir la classe 6e A : les noms s'affichent (sans classe choisie, l'identifiant abrégé s'affiche). Lire : DIABATE Nadia « Absent » « À justifier », DIABATE Salimata « En retard » 10 minutes, ainsi que les absences de démonstration.
3. Remplacer « Justification » par « Justifiée » puis « Tous ».
4. Cliquer « Exporter en CSV » (le texte rappelle "L'export CSV est limité à 5 000 lignes et journalisé."). Le fichier `absences.csv` utilise le séparateur point-virgule et les colonnes `date;eleve_id;eleve;classe_id;statut;justifie;minutes;justificatif_id`.
Résultat attendu : "Export téléchargé." ; chaque ligne affichée est dans le fichier ; un export est tracé dans le journal d'audit (chapitre sur l'audit).
Cas invalide : « Du » postérieur à « Au » → liste vide « Aucune absence correspondante. »
- [ ] Cas nominal  - [ ] Cas invalide (liste vide)  - [ ] Droit refusé pour l'enseignant (`/v2/attendance/absences`)

#### 6.13 Tableau de bord d'assiduité, recalcul et surcharge
Compte : Directeur (surcharge) ; Directeur des études (recalcul) ; Éducateur (lecture) · Où : « Tableau de bord » (`/v2/attendance`) · Prérequis : 6.2.
1. Ouvrir « Tableau de bord » (titre « Assiduité par classe »). Choisir l'« Année scolaire », la « Période » (Trimestre 1) et la « Classe » 6e A. Sans classe : « Choisissez une classe ».
2. Lire les colonnes « Élève », « Séances », « Absences » (affichage "1 dont 0 justifiée(s)"), « Retards », « Départs anticipés », « Non pointés », « Absence » (en heures), « Valeur » (« Calculé »).
3. Avec le directeur des études, cliquer « Recalculer la période » : "Recalcul demandé : les récapitulatifs sont à jour." sans changement de chiffres.
4. Avec le directeur, sur la ligne de DIABATE Nadia, cliquer « Surcharger » :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Minutes d'absence (total) | 120 | oui |
   | dont minutes justifiées | 60 | oui (ne peut pas dépasser le total) |
   | Motif de la surcharge | "Correction test guide" | oui (5 caractères au moins) |
   Cliquer « Enregistrer la surcharge » : "Surcharge enregistrée (motif et auteur conservés)." et la valeur passe à « Surchargé ».
5. Cliquer « Retirer la surcharge » (fenêtre sur l'historique conservé) : "Surcharge retirée : la valeur calculée à partir des appels s'applique de nouveau."
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Motif `abc` | "Le motif doit faire au moins 5 caractères." |
| dont minutes justifiées `200` pour 120 d'absence | "Les minutes justifiées ne peuvent pas dépasser les minutes d'absence." |
| Minutes d'absence négatives `-5` | "La valeur doit être supérieure ou égale à 0." (à relever en test) |
Résultat attendu : valeurs persistées après rechargement ; « Surcharger » est absent pour le directeur des études et l'éducateur.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le directeur des études (« Surcharger » absent)

#### 6.14 Fiche d'absences d'un élève et attestation
Compte : Directeur des études · Où : clic sur le nom d'un élève dans « Tableau de bord » ou « Absences » (`/v2/attendance/student/<id-eleve>?periodId=<id-periode>`) · Prérequis : 6.13.
1. Ouvrir la fiche de DIABATE Nadia : titre « Assiduité de DIABATE Nadia ». Choisir la « Période » (Trimestre 1) pour voir le « Récapitulatif ».
2. Lire « Pointages », « Justificatifs ».
3. Cliquer « Afficher l'attestation » (réservé à qui lit les rapports) : bloc « Attestation d'assiduité » avec la période et les compteurs ; le texte précise que le document officiel est produit par la génération documentaire. « Imprimer » ouvre l'impression du navigateur.
Résultat attendu : données cohérentes avec le tableau de bord ; sans période choisie : « Choisissez une période pour voir le récapitulatif. »
- [ ] Cas nominal  - [ ] Cas invalide (sans période)  - [ ] Droit refusé pour l'économe

### E. Justificatifs

#### 6.15 Le parent dépose un justificatif
Compte : Parent (DIABATE Séka, `parent@secondaire-test.test`) · Où : portail parent « Mes enfants » > DIABATE Nadia > absences (`/v2/parent/children/<id-enfant>/attendance`, même écran que `/v2/attendance/children/<id>`) · Prérequis : 6.2 (Nadia absente).
1. Ouvrir la liste `/v2/attendance/children` (titre « Absences de mes enfants ») ou passer par « Mes enfants » ; cliquer « Voir les absences » pour DIABATE Nadia.
2. Lire le « Récapitulatif » (« Séances », « Absences », « dont justifiées », « Retards », « Départs anticipés ») et la ligne d'absence « À justifier ». Pour DIABATE Salimata : un retard.
3. Cliquer « Déposer un justificatif » (ou « Justifier » sur la ligne) :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Premier jour d'absence | la date du jour (celle de la séance d'appel) | oui |
   | Dernier jour d'absence | la même date | oui |
   | Motif | Maladie | oui |
   | Commentaire | "Paludisme, consultation du jour, test guide" | non |
   | Pièce jointe (facultative) | `docs/guide-test/jeux-de-donnees/justificatif-maladie-test-guide.pdf` | non |
   Cliquer « Déposer ».
4. Le justificatif apparaît sous « Justificatifs déposés » avec l'état « En attente » et le bouton « Retirer ce justificatif ».
Résultat attendu : "Justificatif déposé." ; l'absence reste « À justifier » tant que la décision n'est pas prise (conforme à la conception). Déposer deux fois exactement la même demande ne crée **pas** de doublon (l'API renvoie la demande en attente).
Cas invalides :
| Saisie | Message attendu |
|---|---|
| « Motif » non choisi | "Code attendu : majuscules, chiffres et _ (40 max)." (message technique du contrat : écart Mineur) |
| « Dernier jour d'absence » antérieur au premier | "La fin de la fenêtre précède son début." |
| « Premier jour d'absence » vide | "Date attendue au format AAAA-MM-JJ." |
| Dernier jour dans le futur | à l'envoi : "Un justificatif ne peut pas couvrir des dates futures." |
| Premier jour avant la rentrée | à l'envoi : "La fenêtre commence avant l'année scolaire de l'inscription." |
| Pièce `justificatif-faux-test-guide.pdf` | justificatif déposé, puis "Le justificatif est déposé mais la pièce n'a pas pu être jointe : Type de fichier non accepté (contrôlé sur le contenu réel du fichier)." |
| Pièce `justificatif-trop-lourd-test-guide.pdf` | "Le fichier dépasse la taille autorisée (5120 Ko)." (sous « Pièce jointe (facultative) ») ; rien n'est créé |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : le parent n'a pas `/v2/attendance/justifications`

#### 6.16 Décision sur un justificatif : accepter, rejeter, révoquer, retirer
Compte : Directeur des études (décision) ; Éducateur (lecture) ; Parent (retrait) · Où : « Justificatifs d'absence » (`/v2/attendance/justifications`) · Prérequis : 6.15.
1. Avec le directeur des études, ouvrir « Justificatifs d'absence » : filtre « État » sur « En attente » par défaut ; colonnes « Élève », « Période », « Motif » (affiché en code brut `ILLNESS`, écart connu), « Déposé par » (« Parent »), « Pièces », « État ».
2. Cliquer le nom DIABATE Nadia : fenêtre « Justificatif d'absence ». Dans « Pièces jointes », cliquer « Ouvrir » (l'ouverture est journalisée ; "Le lien est temporaire.").
3. Cliquer « Accepter » : fenêtre « Accepter le justificatif » avec « Note (facultative) » : "Pièce reçue test guide". Confirmer.
4. Vérifier : état « Accepté », "1 pointage couvert" ; dans « Absences » (filtre « Justification » = « Justifiée »), DIABATE Nadia est « Absent justifié » ; le tableau de bord affiche "1 dont 1 justifiée(s)".
5. Cliquer « Révoquer » : fenêtre « Révoquer le justificatif », « Motif de la révocation » : "Pièce non conforme test guide". Confirmer : état « Révoqué », l'absence redevient « À justifier ».
6. Deuxième justificatif : avec l'éducateur, « Déposer un justificatif » (bouton visible : l'éducateur a le droit de dépôt) pour **DIABATE Salimata** (premier et dernier jour = la date du jour, « Motif » = Autre, pièce `justificatif-photo-test-guide.png`). Avec le directeur des études, « Rejeter » : « Motif du rejet » : "Motif insuffisant test guide" → état « Rejeté ». Vérifier que l'éducateur n'a **aucun** bouton « Accepter », « Rejeter », « Révoquer ».
7. Troisième : avec `eleve@secondaire-test.test`, « Mes absences » (`/v2/attendance/me`) > « Déposer un justificatif » pour soi, puis « Retirer ce justificatif » : état « Retiré ».
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Rejet avec motif `ab` | "Le motif doit comporter au moins 3 caractères." |
| Révocation avec motif `abc` | "Le motif doit comporter au moins 5 caractères." |
| Révoquer un justificatif « Rejeté » | bouton absent (seul un justificatif accepté se révoque) |
| Accepter un justificatif déjà accepté (deux onglets) | message de transition interdite de l'API (à relever en test) |
Résultat attendu : messages "Justificatif accepté.", "Justificatif rejeté.", "Justificatif révoqué.", "Justificatif retiré." ; les récapitulatifs sont recalculés à chaque décision.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'éducateur (pas de boutons de décision)

### F. Alertes, conformité, synchronisation

#### 6.17 Appels non faits
Compte : Directeur des études · Où : « Appels non faits » (`/v2/attendance/compliance`) · Prérequis : aucun.
1. Ouvrir la page. La période par défaut est des 6 derniers jours ; élargir « Du » au 1er septembre.
2. Lire les compteurs « Attendus », « Faits », « Non faits », « Taux d'appel », puis « Par enseignant » et « Par classe ».
3. Dans « Séances sans appel », cliquer « Faire l'appel » sur une séance manquante : l'écran d'appel de cette séance s'ouvre.
Résultat attendu : seules les séances **planifiées** passées comptent (pas les appels journaliers) ; "Tous les appels attendus ont été faits." quand rien ne manque ; « Sans objet » quand aucune séance n'était attendue ; l'enseignant sans nom connu peut apparaître sous la forme d'un identifiant abrégé (écart connu). Aucun seuil officiel n'est affiché.
Cas invalide : « Du » postérieur à « Au » → « Aucune séance attendue sur cette période. »
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'enseignant

#### 6.18 Règles d'alerte
Compte : Directeur des études (peut ajouter) ; Éducateur (lecture seule) · Où : « Alertes » (`/v2/attendance/alerts`) · Prérequis : aucun.
1. Ouvrir « Alertes » : "Aucune règle d'alerte." et "Sans règle, aucune alerte n'est émise. Ajoutez-en une ci-dessous." Le texte d'information rappelle qu'aucun seuil n'est imposé.
2. Sous « Ajouter une règle » :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Code de la règle | `TG_ABSENCES_2` | oui (majuscules, chiffres et _) |
   | Indicateur | Nombre d'absences | oui |
   | Seuil | `2` | oui (entier, 1 au moins) |
   | Activer la règle dès sa création | coché | non |
   Cliquer « Ajouter la règle » : "Règle ajoutée."
3. « Désactiver » ("Règle désactivée.") puis « Activer » ("Règle activée."). Ne pas supprimer encore.
4. Déclencher (facultatif) : DIABATE Nadia est déjà « Absent » dans "Séance d'appel test guide" (6.2) et dans "Séance d'appel 2 test guide" (6.6) : si l'une des deux a été corrigée, la remettre « Absent » (appel rouvert par le directeur), puis « Recalculer la période » (6.13). L'alerte est émise au franchissement du seuil ; l'effet visible est une notification (simulée, aucun envoi réel) pour le tuteur : à vérifier en test.
5. Avec l'éducateur : la liste des règles est lisible mais le formulaire et les boutons « Activer », « Désactiver », « Supprimer » sont absents.
6. Pour terminer, « Supprimer » : "Règle supprimée."
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Code `abs 1` | "Code attendu : majuscules, chiffres et _ (40 max)." |
| Code `TG_ABSENCES_2` une seconde fois | "Une règle porte déjà ce code." |
| Indicateur non choisi | "Choix invalide." |
| Seuil vide ou `0` | "La valeur doit être supérieure ou égale à 1." |
| Indicateur « Taux d'absence » | l'aide "En points de base : 2 000 = 20 %." apparaît sous « Seuil » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'éducateur (formulaire absent)

#### 6.19 Conflits de synchronisation
Compte : Directeur des études · Où : « Conflits de synchronisation » (`/v2/attendance/conflicts`) · Prérequis : aucun.
1. Ouvrir la page. Si la fonction d'appel hors ligne n'est pas incluse dans l'offre : "La synchronisation hors ligne n'est pas incluse dans votre offre."
2. Sinon, le sélecteur « Afficher » propose « À arbitrer » et « Arbitrés » ; sur une base neuve : « Aucun conflit à arbitrer. » puis « Aucun conflit arbitré. »
Résultat attendu : aucun conflit n'existe au départ. Le cas où un conflit apparaît (appel annulé ou validé pendant que l'appareil est hors ligne) n'est pas reproductible dans l'environnement de test (voir "Non couvert").
- [ ] Cas nominal (état vide)  - [ ] Cas invalide (sans objet)  - [ ] Droit refusé pour l'enseignant (`/v2/attendance/conflicts`)

### G. Personnel

#### 6.20 Pointage personnel et demande de congé
Compte : Enseignant (Collège Le Baobab) · Où : portail « Mes congés et ma présence » (`/v2/teacher/leaves`, même écran que `/v2/attendance/staff/me`, titre « Ma présence ») · Prérequis : la fonction "présence du personnel" est incluse dans l'offre (sinon "La présence du personnel n'est pas incluse dans votre offre.").
1. Cliquer « Départ » **avant** « Arrivée » : message d'erreur de l'API "Aucune arrivée n'est enregistrée pour ce jour."
2. Cliquer « Arrivée » : "Arrivée enregistrée." puis « Départ » : "Départ enregistré." Une ligne du jour apparaît sous « Présences ».
3. Cliquer « Demander un congé » :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Type de congé | Congé annuel | oui |
   | Premier jour | le vendredi de la semaine prochaine (jour "V1") | oui |
   | Dernier jour | le même vendredi | oui |
   | Demi-journée le premier jour / Demi-journée le dernier jour | décochées | non |
   | Motif | "Congé annuel test guide" | non |
   Cliquer « Envoyer la demande » : "Demande de congé envoyée." ; état « Demandé » dans « Congés ». Dans la colonne « Type », le code brut `ANNUAL` peut s'afficher (écart connu).
Cas invalides :
| Saisie | Message attendu |
|---|---|
| « Type de congé » non choisi | "Code attendu : majuscules, chiffres et _ (40 max)." |
| « Dernier jour » antérieur au « Premier jour » | "La fin du congé précède son début." |
| « Premier jour » vide | "Date attendue au format AAAA-MM-JJ." |
Résultat attendu : l'enseignant n'a **aucun** bouton « Approuver » ni « Refuser » ; il peut « Annuler » sa propre demande tant qu'elle est « Demandé ».
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : pas de décision pour l'enseignant

#### 6.21 Décision sur les congés et présence du personnel (direction)
Compte : Directeur des études (décisions), Directeur (demandes et pointage) · Où : « Présence du personnel » (`/v2/attendance/staff`, nav « Personnel ») · Prérequis : 6.20.
1. Ouvrir la page. Le filtre « État des congés » est sur « Demandé ». Dans « Congés », la demande de TRAORE Kouadio est visible.
2. Cliquer « Approuver » : "Congé approuvé." (état « Approuvé »). Effet sur l'emploi du temps : les séances futures de TRAORE ce jour-là passent à « À remplacer » (voir 7.11, quelques secondes de délai).
3. Avec le **directeur** (seul à porter le droit de demander un congé pour autrui), créer deux autres demandes avec le bouton « Demander un congé » de cette page (liste « Membre du personnel » : TRAORE Kouadio ; type « Absence autorisée » ; dates : le lundi puis le mardi de la semaine suivante), puis, avec le directeur des études :
   - sur la première, « Refuser » : fenêtre « Refuser le congé », « Motif du refus » : "Besoin de service test guide" → "Congé refusé." ;
   - sur la seconde, « Annuler » → "Congé annulé."
4. Cliquer « Enregistrer une présence » :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Membre du personnel | YAO Fatou | oui |
   | Jour | la date du jour | oui |
   | Statut | En retard | oui |
   | Note | "Retard test guide" | non |
   | Corriger un jour de congé approuvé | décochée | non |
   Cliquer « Enregistrer » : "Présence enregistrée."
5. Lire « Récapitulatif » (« Jours », « Par statut », « Minutes de retard », « Jours de congé ») sur la période du filtre.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Refus avec motif `ab` | "Le motif doit comporter au moins 3 caractères." |
| Champs « Membre du personnel » ou « Statut » vides | "Ce champ est obligatoire." |
| Membre YAO Fatou, jour = date du jour, statut « En congé » (aucun congé approuvé) | "Le statut "en congé" exige un congé approuvé couvrant ce jour." |
| Membre TRAORE Kouadio, jour = V1 (congé approuvé), statut « Présent », case « Corriger un jour de congé approuvé » décochée | "Ce jour est couvert par un congé approuvé : le statut "en congé" s'applique (correction explicite requise)." |
| Approuver un « Congé maladie » | "Ce type de congé exige un justificatif avant l'approbation." (aucune pièce n'est joignable depuis l'écran : écart) |
Résultat attendu : état des congés mis à jour ; décisions par un autre compte que le demandeur ; l'enseignant ne voit pas cette page.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'enseignant (`/v2/attendance/staff`)

### H. Vues élève et parent

#### 6.22 L'élève consulte ses absences
Compte : Élève (`eleve@secondaire-test.test`, Nadia) · Où : portail élève « Mes absences » (`/v2/student/attendance`, même écran que `/v2/attendance/me`) · Prérequis : 6.2.
1. Ouvrir « Mes absences » (titre identique).
2. Lire le « Récapitulatif » et la liste « Absences et retards » : la présence de Nadia « Absent » est signalée « À justifier » (ou « Justifiée » si 6.16 a laissé un justificatif accepté).
3. « Déposer un justificatif » pour soi (voir 6.16, étape 7).
Résultat attendu : l'élève ne voit que ses propres données ; "Aucune absence ni retard." et "Tout est en règle." quand rien n'est à signaler. Si le compte n'a pas de profil d'élève, l'API répond "Aucun profil d'élève n'est lié à votre compte." (utiliser le compte de l'annexe).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'élève (`/v2/attendance/children`)

#### 6.23 Le parent ne voit que ses enfants
Compte : Parent · Où : `/v2/attendance/children` · Prérequis : aucun.
1. Ouvrir la liste : DIABATE Nadia et DIABATE Salimata uniquement.
2. Taper à la main `/v2/attendance/children/00000000-0000-4000-8000-000000000000` (identifiant inventé) puis, avec un autre établissement, l'identifiant d'un enfant du primaire.
Résultat attendu : la page répond comme si l'enfant n'existait pas (message d'erreur "introuvable" de l'API, aucune donnée) ; message de la liste vide pour un compte sans enfant : « Aucun enfant n'est lié à votre compte. »
- [ ] Cas nominal  - [ ] Cas invalide (enfant inconnu)  - [ ] Isolation entre établissements

### I. Droits

#### 6.24 Adresses interdites et séparation des tâches
Compte : voir ci-dessous · Où : adresses saisies à la main · Prérequis : aucun.
| Compte | Adresse tapée | Résultat attendu |
|---|---|---|
| Parent | `/v2/attendance/sessions` | page « Accès refusé » |
| Parent | `/v2/attendance/justifications` | page « Accès refusé » |
| Parent | `/v2/attendance/call` | page « Accès refusé » |
| Élève | `/v2/attendance/children` | page « Accès refusé » |
| Élève | `/v2/attendance/absences` | page « Accès refusé » |
| Enseignant | `/v2/attendance/absences` | page « Accès refusé » |
| Enseignant | `/v2/attendance/justifications` | page « Accès refusé » |
| Enseignant | `/v2/attendance/conflicts` | page « Accès refusé » |
| Enseignant | `/v2/attendance/staff` | page « Accès refusé » |
| Directeur des études | `/v2/attendance/staff/me` | page « Accès refusé » (pas de droit personnel) |
| Économe | `/v2/attendance` | page « Accès refusé » |
| Secrétariat | `/v2/attendance/conflicts` | page « Accès refusé » |
| Secrétariat | `/v2/attendance/staff` | page « Accès refusé » |
Séparation des tâches à contrôler : l'enseignant n'a pas « Valider » ; l'éducateur et le directeur des études n'ont pas « Rouvrir » ; l'éducateur n'a pas « Accepter » ; seul le directeur a « Surcharger » ; le secrétariat ne fait pas l'appel d'une classe qui n'est pas la sienne ("Vous n'êtes pas intervenant de cette séance ni affecté à cette classe : l'appel est réservé.").
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour chaque compte du tableau

#### 6.25 Qualité transversale
Compte : au choix · Où : tous les écrans ci-dessus.
1. États vides : « Aucun appel sur cette période. » (suivi), « Aucun justificatif. », « Aucune absence correspondante. », « Aucun congé. » : phrase claire, indication d'élargir les filtres.
2. Chargement : « Chargement… » ne doit pas laisser un faux état vide au-delà de quelques secondes (écart connu C-07-01, C-08-12).
3. Clavier : Tab parcourt les lignes de l'appel (chaque élève est un bouton) ; Échap ferme les fenêtres ; Entrée valide les formulaires.
4. Français : aucun code brut visible sauf les écarts connus (motifs `ILLNESS`, types de congé `ANNUAL`).
5. Téléphone (fenêtre étroite 375 px) : l'appel se fait en un geste par élève, le pied de page reste visible.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (sans objet)

## Données créées

| Enregistrement | Où |
|---|---|
| Appel "Séance d'appel test guide" (6e A, aujourd'hui 11:00 à 12:00) : DIABATE Nadia absente, DIABATE Salimata en retard 10 min, TOURE Yao absent justifié, TOURE Jean-Marc absent (après réouverture) ; soumis puis validé | 6.2, 6.4, 6.5, 6.7 |
| Appels "Séance d'appel 2 test guide" (Nadia absente) et "Séance d'appel 3 test guide" (tous présents), soumis puis validés par lot | 6.6 |
| Appel "Séance d'appel 4 test guide", ouvert puis annulé | 6.8 |
| Appels journaliers CP1 A du jour : matin et après-midi | 6.9 |
| Absence justifiée immédiate de TOURE Yao (motif « Difficulté de transport ») | 6.4 |
| Justificatif de DIABATE Nadia déposé par le parent (Maladie, pièce PDF), accepté puis révoqué | 6.15, 6.16 |
| Justificatif de DIABATE Salimata déposé par l'éducateur (Autre, pièce PNG), rejeté | 6.16 |
| Justificatif de DIABATE Nadia déposé par l'élève, retiré | 6.16 |
| Règle d'alerte `TG_ABSENCES_2` (créée puis supprimée) | 6.18 |
| Congés de TRAORE Kouadio : « Congé annuel » du vendredi V1 (approuvé), deux « Absence autorisée » (refusé, annulé) | 6.20, 6.21 |
| Pointage personnel du jour (arrivée, départ) de TRAORE Kouadio ; présence « En retard » de YAO Fatou | 6.20, 6.21 |
| Surcharge d'assiduité de DIABATE Nadia (créée puis retirée) | 6.13 |

## Écarts constatés

| Écran | Constat | Gravité |
|---|---|---|
| Déposer un justificatif (`JustificationForm`) | Le motif non choisi affiche le message technique du contrat "Code attendu : majuscules, chiffres et _ (40 max)." au lieu d'un message lisible (le libellé « Choisissez un motif. » n'existe que dans la fenêtre d'absence justifiée de l'appel). Même défaut pour « Type de congé » (demande de congé). | Mineur |
| Justificatifs, fiche parent, congés | Le motif (`ILLNESS`) et le type de congé (`ANNUAL`) s'affichent en code brut (QA C-08-14, C-07-12). | Mineur |
| Suivi des appels | « Valider » agit sans fenêtre de confirmation (QA C-08-07, non corrigé dans le code lu). | Mineur |
| Suivi des appels | Le bouton « Annuler » est montré à tous sur les appels ouverts ou soumis ; l'API refuse pour qui n'est pas affecté (incohérence d'affichage). | Suggestion |
| Congé maladie | Approuver un « Congé maladie » exige un justificatif (`documentRef`) mais l'écran de demande ne permet de joindre aucun document : approbation impossible depuis l'interface. | Majeur (à confirmer) |
| Motif « Maladie » | La décision O-20 ("pièce obligatoire pour maladie", `specs/v2/REPONSES-METIER.md`) n'est pas reprise par le modèle de pack : `ILLNESS` est livré avec `requiresAttachment: false` (accepter sans pièce réussit). | Majeur (décision métier à trancher) |
| Fiche d'absences d'un élève | La route `GET /api/v1/attendance/students/:id/records` n'exige que `attendance.read` (détenu par l'enseignant) et ne montre aucun contrôle d'appartenance à ses classes : un enseignant peut ouvrir la fiche de n'importe quel élève par son adresse. | Majeur (à confirmer) |
| Secrétariat | Le rôle porte `attendance.take` ("saisie") mais l'API exige l'affectation à la classe : le secrétariat ne peut en pratique pas faire d'appel, alors que la page « Faire l'appel » lui est ouverte. | Mineur |
| Paramétrage | L'entrée de menu "Paramètres de présence" (statuts, motifs, types de congé, politiques d'appel, pièces acceptées) n'a pas d'écran v2 : ces référentiels ne se modifient que par l'API. Seules les règles d'alerte ont un écran. | Mineur (connu) |
| Absences sans classe | Sans classe choisie, la liste affiche des identifiants abrégés au lieu des noms (QA C-08-02, faux "Aucune absence" signalé). | Mineur |
| Page 404 | Une adresse inexistante affiche "This page could not be found." en anglais, et « Accès refusé » garde l'ancien habillage (QA C-03-09). | Mineur (connu) |

## À vérifier en test

- Le texte exact des erreurs de l'API (retard supérieur à la durée, transition de justificatif interdite, enfant introuvable) : à relever.
- Si « Appel soumis. » ou "Appel soumis : 1 absent, 1 retard." est affiché (dépend de l'activation de l'appel hors ligne dans l'offre).
- Sur la base de test, CP1 A propose-t-il bien « Appel du matin » et « Appel de l'après-midi » (politique `HALF_DAYS`) ?
- La fenêtre « Confirmez votre identité » à la réouverture d'un appel (droit sensible).
- La notification d'alerte d'assiduité (6.18, étape 4) et son caractère simulé.
- Le nombre d'élèves de la liste d'appel de la 6e A (dix attendus).
- L'accès d'un enseignant à la fiche d'un élève d'une autre classe (voir écarts).

## Non couvert / limites connues

- **Appel hors ligne** et file locale de l'appareil : aucun service worker en développement (QA session 07) ; les conflits de synchronisation ne sont donc pas reproductibles. L'écran `/v2/attendance/conflicts` n'est testé qu'à vide.
- **Délai de correction dépassé** (120 minutes) : demande d'attendre deux heures après une soumission ; à faire une fois par un développeur ou avec une horloge réglée.
- **Pont de présence des classes virtuelles** (`attendance.live-bridge`, route d'API seule) : aucun écran.
- **Paramétrage des statuts, motifs, types de congé, politiques d'appel** : API seulement.
- Tâche de nuit "recalcul des récapitulatifs" (02:50) : non testable à la main.
- Le supérieur n'est pas rejoué scénario par scénario ; mêmes gestes que le secondaire (`enseignant@superieur-test.test`).
- Les écrans parent et élève sous `/v2/parent/children/<id>/attendance` et `/v2/student/attendance` relèvent du chapitre des portails ; ils sont vus ici par leur contenu.
