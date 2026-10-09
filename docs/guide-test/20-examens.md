# Chapitre 20. Examens : types, sessions, candidats, centres, répartition, notes, résultats, corrections, exports, vue famille

> Écrans couverts : `/v2/examinations` (sessions), `/v2/examinations/sessions/<id>`, `/v2/examinations/candidates`, `/v2/examinations/candidates/<id>`, `/v2/examinations/assignments`, `/v2/examinations/centers`, `/v2/examinations/mock`, `/v2/examinations/results`, `/v2/examinations/imports`, `/v2/examinations/corrections`, `/v2/examinations/statistics`, `/v2/examinations/exports`, `/v2/examinations/types`, `/v2/examinations/family` (14 routes). Module API : `apps/api/src/modules/examinations`.
>
> **URL réelle** : le dossier `app/v2` fait bien partie de l'adresse dans le navigateur (`http://localhost:3000/v2/examinations/...`). Aucun préfixe ni réécriture n'est ajouté (`apps/web/next.config.js` n'a pas de réécriture pour `/v2`, `apps/web/middleware.ts` ne fait que poser des en-têtes).

## Ce qu'il faut savoir avant de commencer

**Règles de démonstration.** Aucune règle d'examen officielle n'est livrée : ni BEPC, ni BAC, ni CEPE réel. Le type "CEPE" du primaire et le type "Examen de démonstration (6E)" du collège sont des **données fictives** ; la règle d'éligibilité et de calcul des examens blancs (`CI-EXAM-PLACEHOLDER`) est une règle de démonstration. Les écrans affichent le bandeau « Règles de démonstration » et les documents scellés portent un filigrane de démonstration. N'en tirez aucune conclusion réglementaire. Pour un examen **officiel**, la plateforme n'invente jamais l'admission : elle **enregistre** le résultat que l'autorité communique (saisie ou fichier) ; seul l'examen **blanc** est calculé par la règle.

**Cycle d'une session** (une session ne revient en arrière que pour deux retours prévus) :
type d'examen (épreuves, filières) > session (définition copiée puis figée) > candidats (élèves d'une classe ou candidats libres) > éligibilité (règle) > inscription (numéro de candidat) > centres, salles et répartition > clôture des inscriptions > convocations > épreuves en cours > notes et résultats > résultats saisis > corrections à quatre yeux > publication (direction) > attestations, relevés, exports > archivage.

Les sept états d'une session, dans l'ordre : « Planifiée », « Inscriptions ouvertes », « Inscriptions closes », « Épreuves en cours », « Résultats saisis », « Résultats publiés », « Archivée ». Retours possibles : « Inscriptions closes » vers « Inscriptions ouvertes » ; « Résultats saisis » vers « Épreuves en cours » (source : `apps/api/src/modules/examinations/domain/lifecycle.ts`).

**Qui fait quoi (séparation des tâches).** Le responsable des examens prépare et saisit ; il ne publie pas, n'applique pas un fichier officiel, n'approuve pas une correction, n'accorde pas de dérogation et n'anonymise pas. La direction (directeur ou propriétaire, avec seconde vérification MFA) publie, applique, approuve, déroge et anonymise. Le directeur des études publie les résultats et approuve les dérogations, mais ne gère rien d'autre (source : `apps/api/src/modules/rbac/templates/system-roles.ts`, rôles `responsable_examens`, `directeur_etudes`, `directeur`).

**Choix de la session.** Les écrans « Candidats », « Répartition », « Examens blancs », « Notes et résultats », « Imports », « Corrections », « Statistiques » et « Exports et documents » commencent par une liste « Session d'examen » (valeur « Choisir une session »). Chaque option s'écrit `<libellé> — <code du type> <année> (<nature>, <état>)`, par exemple `Session OFF-DEMO — EXAM_DEMO 2027 (Officiel, Inscriptions ouvertes)`. Le choix se retrouve dans l'adresse (`?session=<identifiant>`) et survit au rechargement. S'il n'existe qu'une seule session, elle est choisie d'office. Les écrans « Examens blancs » et « Imports » ne proposent que les sessions de leur nature (blanches, ou officielles).

**Actions qui ne se défont pas** (à faire en dernier, dans l'ordre du chapitre) : « Passer à : Résultats publiés », « Publier » sur un résultat, « Appliquer l'import », « Anonymiser », l'émission d'un document scellé (il se révoque mais reste conservé), « Passer à : Archivée ». Les enregistrements créés par ce chapitre ne se suppriment pas depuis les écrans (voir "Données créées"). Ne **publiez ni n'archivez jamais** les sessions de démonstration `OFF-DEMO` et `BLANC-DEMO` : travaillez sur vos sessions "test guide".

## Prérequis

- Environnement de démonstration initialisé (`pnpm dev:v2:seed` puis prolongement `scripts/seed-v2/demo/*.ts`), application sur `http://localhost:3000`.
- Chapitres antérieurs utiles : 01 (connexion, MFA), élèves et inscriptions (la classe "6e A" existe, 8 inscriptions confirmées au départ), évaluations (l'évaluation « Examen blanc (démonstration) » est déjà publiée par la graine).
- Les scénarios de la partie A se jouent dans l'ordre (les numéros de candidat, les capacités de salle et les états de session s'enchaînent). La partie B (primaire) et la partie C (supérieur) sont indépendantes.
- Année de départ : 2026-2027 pour une base créée en octobre 2026. Les sessions du guide utilisent l'**année de session 2027** (le formulaire propose l'année civile courante : la changer en 2027).

## Comptes (e-mails du tableau de l'annexe `annexe-donnees-de-depart.md`)

| Rôle | Collège Le Baobab | École Les Palmiers | Université Horizon | MFA |
|---|---|---|---|---|
| Responsable des examens | `examens@secondaire-test.test` | `examens@primaire-test.test` | `examens@superieur-test.test` | non |
| Directeur | `directeur@secondaire-test.test` | `directeur@primaire-test.test` | `directeur@superieur-test.test` | oui |
| Directeur des études | `etudes@secondaire-test.test` | - | - | oui |
| Propriétaire | `direction.generale@secondaire-test.test` | - | - | oui |
| Parent (tuteur n° 1, voit Nadia et Salimata) | `parent@secondaire-test.test` | `parent@primaire-test.test` | - | non |
| Élève (correspond à DIABATE Nadia) | `eleve@secondaire-test.test` | - | - | non |
| Sans droit d'examen (refus) | `enseignant@secondaire-test.test`, `secretariat@secondaire-test.test`, `econome@secondaire-test.test`, `educateur@secondaire-test.test` | - | - | selon le rôle |

Aucun mot de passe ni code MFA n'est écrit ici : cliquer sur le compte dans le panneau de la page `/v2/login` ; pour les comptes MFA, la page propose le code du moment. Le compte **Élève** est bien celui de DIABATE Nadia : le scénario de la graine (`scripts/seed-v2/scenario.ts`) rattache l'adresse `eleve@` au premier élève créé (`students[0]`), qui est DIABATE Nadia.

## Droits

| Écran | Permission exigée par la page | Qui l'a (système) |
|---|---|---|
| Sessions (`/v2/examinations`), détail de session | `exam.session.read` | examens, directeur, études, propriétaire |
| Candidats, fiche candidat | `exam.candidate.read` ou `exam.candidate.manage` | examens, directeur, études, propriétaire |
| Répartition | `exam.center.manage` ou `exam.session.read` | examens, directeur, études, propriétaire (lecture seule pour les études) |
| Centres et salles | `exam.center.manage` | examens, directeur, propriétaire |
| Examens blancs | `exam.mock.manage` | examens, directeur, propriétaire |
| Notes et résultats | `exam.result.read`, `exam.result.enter` ou `exam.score.enter` | examens, directeur, études, propriétaire |
| Imports | `exam.import.manage` | examens, directeur, propriétaire |
| Corrections | `exam.result.read` ou `exam.result.revise` | examens, directeur, études, propriétaire |
| Statistiques | `exam.statistics.read` | examens, directeur, études, propriétaire |
| Exports et documents | `exam.export.run` ou `exam.document.issue` | examens, directeur, propriétaire |
| Types d'examens | `exam.type.read` | examens, directeur, études, propriétaire |
| Examen de l'élève (`/v2/examinations/family`) | `exam.document.child.read` (parent) ou `exam.document.self.read` (élève) | parent, élève |

Actions réservées à la direction : publier (`exam.result.publish`, aussi au directeur des études), appliquer un fichier officiel (`exam.result.release`), approuver ou rejeter une correction (`exam.result.revise`), accorder une dérogation (`exam.eligibility.override`), anonymiser un candidat libre (`exam.external.anonymize`), gérer le barème des frais d'examen (`exam.fee.manage`).

**Refus attendu** : une page interdite redirige côté serveur vers `/unauthorized`, page « Accès refusé » avec le texte "Vous n'avez pas les droits nécessaires pour afficher cette page." (source : `apps/web/src/app/unauthorized/page.tsx`, garde `requirePermission` / `requireAnyPermission`). Aucune donnée d'examen n'est affichée. Adresses à taper à la main (détaillées au scénario 20.43) :

- `enseignant@secondaire-test.test` : `/v2/examinations`, `/v2/examinations/types`, `/v2/examinations/candidates`.
- `parent@secondaire-test.test` : `/v2/examinations/results`, `/v2/examinations/centers`, `/v2/examinations/candidates`.
- `etudes@secondaire-test.test` : `/v2/examinations/centers`, `/v2/examinations/imports`, `/v2/examinations/mock`, `/v2/examinations/exports`.
- `examens@secondaire-test.test` : `/v2/examinations/family`.

## Données de départ (graine)

Source : `scripts/seed-v2/demo/exams.ts`, appelé par `scripts/seed-v2/demo/index.ts` **uniquement pour le pack Secondaire**.

**Collège Le Baobab (`secondaire-test`)** :

| Élément | Valeur |
|---|---|
| Type d'examen | `EXAM_DEMO`, libellé "Examen de démonstration (6E)", niveau d'enseignement `LOWER_SECONDARY`, classe visée `6E`, origine « Démonstration (fictif) », motif de numéro `{TYPE}{YEAR}-{SEQ:5}` |
| Épreuve du type | `EP1` « Épreuve 1 (démonstration) », coefficient 1, barème 20 (aucune filière, aucune pièce exigée) |
| Session officielle | code `OFF-DEMO`, libellé "Session OFF-DEMO", année 2027, état « Inscriptions ouvertes », définition figée, candidats créés depuis la classe 6e A (9 au dernier relevé QA, aucun inscrit, tous éligibles) |
| Session d'examen blanc | code `BLANC-DEMO`, libellé "Session BLANC-DEMO", reliée à OFF-DEMO, état « Épreuves en cours », 9 candidats inscrits, épreuve EP1 liée à l'évaluation publiée « Examen blanc (démonstration) », 9 résultats calculés par la règle (non publiés) |
| Notes de l'évaluation liée | DIABATE Nadia 5, DIABATE Salimata 8, BAMBA Aya 11, BAMBA Fatou 14, COULIBALY Moussa 17, COULIBALY Salimata 6, TOURE Yao 9, TOURE Jean-Marc 12 (sur 20) ; le neuvième candidat n'a pas de note |
| Résultats de l'examen blanc (relevé QA 10, à recompter) | Admis 4 (Aya 11, Fatou 14, Moussa 17, Jean-Marc 12), Refusé 4, Absent 1 ; présents 8 ; taux 50 % ; rangs 1 à 8 : 17, 14, 12, 11, 9, 8, 6, 5 |
| Absents de la graine | centre d'examen, salle, format d'export, format d'import, document émis, demande de correction, barème de frais, candidat libre |

**École primaire Les Palmiers** et **Université Horizon** : **aucune donnée d'examen** (ni type, ni session, ni centre). Au primaire, le type CEPE (fictif) se charge depuis l'écran « Types d'examens » (partie B).

---

## Partie A. Collège Le Baobab (secondaire) : BEPC et BAC blancs et session

Noms créés dans cette partie (voir "Données créées") : type `TG_BEPC` « BEPC test guide (démonstration) » ; centre `TG-CTR1` "Centre Cocody test guide" ; sessions `TG-BEPC-2027` "Session BEPC test guide" (officielle) et `TG-BLANC-2027` "BEPC blanc test guide" (examen blanc) ; candidats libres "KOUASSI Yves test guide", "KONE Mariam test guide", "BAMBA Fanta test guide" (et les autres lignes du fichier CSV).

### A.1 Entrer dans le module et lire l'état de départ

#### 20.1 Ouvrir « Examens » et lire les deux sessions de démonstration
Compte : responsable des examens (Collège Le Baobab) · Où : après connexion, page d'accueil du rôle `/v2/examinations` (menu « Examens ») · Prérequis : graine du collège.
1. Se connecter avec `examens@secondaire-test.test` : l'écran d'accueil est la liste « Sessions d'examen » (description "Sessions officielles (CEPE, BEPC, BAC, BTS…) et examens blancs de l'établissement.").
2. Lire la barre d'onglets « Examens » : « Sessions », « Candidats », « Répartition », « Centres et salles », « Examens blancs », « Notes et résultats », « Imports », « Corrections », « Statistiques », « Exports et documents », « Types d'examens ». L'onglet « Examen de l'élève » est absent (réservé aux familles).
3. Dans le tableau (légende « Sessions d'examen »), repérer deux lignes : "Session OFF-DEMO" (nature « Officiel », état « Inscriptions ouvertes », pastille « Démonstration » dans la colonne « Données ») et "Session BLANC-DEMO" (nature « Examen blanc », état « Épreuves en cours »). Colonnes : « Session », « Examen », « Nature », « État », « Avancement », « Début des épreuves », « Données ».
4. Utiliser les filtres « État » (valeur « Inscriptions ouvertes ») puis « Nature » (valeur « Examen blanc ») : le tableau se restreint ; remettre « Tous ».
5. Ouvrir "Session OFF-DEMO" : voir 20.8 pour le détail.
Résultat attendu : deux sessions ; colonne « Examen » = `EXAM_DEMO 2027` ; « Avancement » 17 % pour OFF-DEMO (index 1 sur 6) et 50 % pour BLANC-DEMO ; bandeau « Règles de démonstration » sur le détail ; le bouton « Nouvelle session » est visible en haut à droite pour ce compte.
Cas invalides : sans objet (lecture).
- [ ] Cas nominal  - [ ] Cas invalide (sans objet)  - [ ] Droit refusé pour enseignant (voir 20.43)

#### 20.2 Types d'examens : lire le type de démonstration
Compte : responsable des examens · Où : onglet « Types d'examens » (`/v2/examinations/types`).
1. Lire la carte `EXAM_DEMO — Examen de démonstration (6E)` avec les pastilles « Démonstration » et « Actif », puis la ligne « Démonstration (fictif) » (origine).
2. Cliquer « Afficher le détail » (le bouton devient « Masquer le détail »). Le détail montre : « Contrat de résultat » `exam-national@1`, « Modèle du numéro de candidat » `{TYPE}{YEAR}-{SEQ:5}`, « Niveau d'enseignement » `LOWER_SECONDARY`, « Source » « Démonstration (fictif) ».
3. Sections du détail : « Filières » (« Aucune filière. »), « Épreuves » (tableau : `EP1`, « Épreuve 1 (démonstration) », coefficient 1, barème 20, source « Démonstration (fictif) »), « Pièces à fournir » (« Aucune pièce exigée. »), « Transmission aux admissions » (case « Transmettre le résultat et la moyenne aux admissions » décochée), « Frais d'examen (barème) » (« Aucun frais d'examen : les inscriptions ne sont pas facturées. »).
4. Constater qu'**aucun type BEPC ni BAC** n'existe : les boutons « Charger le pack du primaire (fictif) » et « Nouveau type » sont visibles pour ce compte.
Résultat attendu : un seul type ; bandeau « Règles de démonstration » en tête du détail.
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Droit refusé pour enseignant, parent (voir 20.43)

#### 20.3 Créer le type « BEPC test guide (démonstration) »
Compte : responsable des examens · Où : « Types d'examens » > « Nouveau type » (`/v2/examinations/types`) · Prérequis : aucun.
1. Cliquer « Nouveau type » : la fenêtre « Nouveau type d'examen » s'ouvre (description "Le type décrit l'examen ; ses épreuves et filières s'ajoutent ensuite.").
2. Remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Code | `TG_BEPC` (lettres majuscules, chiffres et `_`, 2 à 20 caractères, commence par une lettre ; la saisie est mise en majuscules à l'envoi) | oui |
   | Libellé | `BEPC test guide (démonstration)` | oui |
   | Niveau d'enseignement | `LOWER_SECONDARY` (aide : "Code du niveau (ex. PRIMARY).") | oui |
   | Niveau de classe visé | `6E` (la seule classe du collège de démonstration est la 6e A : la règle de démonstration déclare "éligible" l'élève qui est dans la classe visée) | non |
   | Origine des données | « Démonstration (fictif) » (valeurs possibles : « Réglementation », « Établissement », « Plateforme », « Démonstration (fictif) » ; défaut « Établissement ») | non |
   | Référence de la source | `Guide de test, données fictives` | non |
3. Cliquer « Créer le type ».
Résultat attendu : la fenêtre se ferme ; la carte `TG_BEPC — BEPC test guide (démonstration)` apparaît avec « Démonstration » et « Actif » ; après rechargement la carte est toujours là. Le type n'a encore **aucune épreuve** : la création d'une session le refuserait (voir 20.8).
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Code vide, ou `T` seul (1 caractère), ou `TG BEPC` (espace) | "Format invalide." sous le champ Code |
| Libellé vide | "Ce champ est obligatoire." |
| Niveau d'enseignement vide | "Format invalide." |
| Code `TG_BEPC` une seconde fois | "Ce code de type d'examen existe déjà." (bandeau d'erreur dans la fenêtre) |
| Origine « Réglementation » avec Référence de la source vide | "Un type "réglementaire" cite son texte (référence obligatoire)." sous le champ Référence de la source |
Sources : `packages/contracts/src/v2/examinations.ts` (`examCreateTypeBodySchema`), `apps/api/src/modules/examinations/application/reference.ts`, `domain/errors.ts`, `apps/web/src/platform/ui/validation.ts`.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : le bouton « Nouveau type » est absent pour `etudes@` (lecture seule)

#### 20.4 Ajouter une filière et des épreuves au type
Compte : responsable des examens · Où : « Types d'examens » > carte `TG_BEPC` > « Afficher le détail » · Prérequis : 20.3.
1. Dans « Filières », cliquer « Ajouter une filière » : fenêtre « Nouvelle filière ».
   | Champ | Valeur | Obligatoire |
   |---|---|---|
   | Code | `TGA` | oui |
   | Libellé | `Série A test guide` | oui |
   Cliquer « Ajouter la filière » : la pastille `TGA — Série A test guide` apparaît.
2. Dans « Épreuves », cliquer « Ajouter une épreuve » : fenêtre « Nouvelle épreuve », trois fois :
   | Code | Libellé | Filière | Coefficient | Barème (sur) | Ordre | Épreuve facultative |
   |---|---|---|---|---|---|---|
   | `TG_EP1` | `Mathématiques test guide` | (vide : « Toutes les filières ») | `2` | `20` | `1` | non |
   | `TG_EP2` | `Français test guide` | (vide) | `1` | `20` | `2` | non |
   | `TG_EP3` | `Épreuve de série A test guide` | `TGA — Série A test guide` | `1` | `10` | `3` | non |
   À chaque fois cliquer « Ajouter l'épreuve ». Les champs Coefficient, Barème et Ordre sont prérenseignés (1, 20, rang suivant) ; la virgule décimale est acceptée (`1,5`).
Résultat attendu : le tableau « Épreuves » liste `TG_EP1`, `TG_EP2`, `TG_EP3` (cette dernière avec la mention `[TGA]` après le libellé) avec coefficient et barème en virgule française, source « Établissement ».
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Épreuve : Coefficient `0` | "Le coefficient doit être strictement positif." |
| Épreuve : Coefficient `abc` | "Nombre décimal attendu (ex. 14.5)." |
| Épreuve : Barème `0` | "Le barème doit être strictement positif." |
| Épreuve : Ordre `0` | "La valeur doit être supérieure ou égale à 1." |
| Épreuve : Code `TG_EP1` une seconde fois | "Ce code d'épreuve existe déjà." |
| Filière : Code `TGA` une seconde fois | "Ce code de série existe déjà." |
| Filière : Libellé vide | "Ce champ est obligatoire." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : boutons « Ajouter une filière » et « Ajouter une épreuve » absents pour `etudes@`

#### 20.5 Paramètre de transmission aux admissions et barème de frais (lecture)
Compte : responsable des examens, puis directeur · Où : « Types d'examens » > détail du type `TG_BEPC`.
1. Dans « Transmission aux admissions », lire le texte "Pour un examen qui conditionne l'admission (CEPE vers la 6e) : …". Cocher « Transmettre le résultat et la moyenne aux admissions » : le message « Paramètre enregistré. » apparaît ; recharger la page : la case reste cochée. La décocher : même message, case décochée (valeur d'origine pour un type créé à la main : décochée).
2. Dans « Frais d'examen (barème) », lire « Aucun frais d'examen : les inscriptions ne sont pas facturées. ». Avec `examens@` (lecture seule pour le barème), aucune liste « Ajouter un frais du catalogue » n'est proposée. Avec `directeur@` (permission de gestion du barème) : la liste « Ajouter un frais du catalogue » propose les frais de la catégorie « Examens » de la comptabilité ; si le catalogue est **indisponible**, la liste affiche « Catalogue indisponible » et l'avis "Le catalogue des frais d'examen de la comptabilité est indisponible : le barème ne peut pas être modifié pour l'instant." apparaît ; si le catalogue ne contient aucun frais de catégorie « Examens » (cas de la graine, à vérifier en test), la liste est simplement vide. Ne rien ajouter à ce stade (voir "Non couvert").
Résultat attendu : la case de transmission se met à jour sans bouton d'enregistrement ; le barème reste vide.
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Droit refusé : pour `etudes@` la case est remplacée par le texte « Aucune transmission aux admissions »

### A.2 Centres et salles

#### 20.6 Créer un centre d'examen et des salles
Compte : responsable des examens · Où : onglet « Centres et salles » (`/v2/examinations/centers`) · Prérequis : aucun centre dans la graine.
1. L'écran affiche « Aucun centre d'examen » et « Ajoutez un centre puis ses salles pour pouvoir placer les candidats. ». Cliquer « Nouveau centre » : fenêtre « Nouveau centre d'examen ».
   | Champ | Valeur | Obligatoire |
   |---|---|---|
   | Code | `TG-CTR1` (majuscules, chiffres, `_`, `.`, `-`, 1 à 30 caractères) | oui |
   | Nom | `Centre Cocody test guide` | oui |
   | Nature | « Centre propre » (autre valeur : « Centre d'accueil ») | oui |
   | Code attribué par l'autorité | (laisser vide) | non |
   | Localité | `Cocody, Abidjan` | non |
2. Cliquer « Créer le centre » : la carte `TG-CTR1 — Centre Cocody test guide` apparaît avec les pastilles « Centre propre » et « Actif », la localité et le texte « Aucune salle. ».
3. Cliquer « Ajouter une salle » : fenêtre « Nouvelle salle du centre Centre Cocody test guide », deux fois :
   | Code | Libellé | Capacité (places) |
   |---|---|---|
   | `S1` | `Salle 1 test guide` | `3` |
   | `S2` | `Salle 2 test guide` | `2` |
   puis « Ajouter la salle ». (La troisième salle, `S3` de 2 places, sera ajoutée au scénario 20.15.)
4. Dans la carte, pour la salle `S2`, cliquer « Désactiver » : la pastille passe à « Inactive » et le bouton à « Activer » ; cliquer « Activer » pour la remettre « Active ».
5. Cliquer « Désactiver le centre » : pastille « Inactif », bouton « Activer le centre » ; cliquer « Activer le centre » pour revenir à « Actif ».
Résultat attendu : tableau des salles (colonnes « Code », « Libellé », « Capacité (places) », « État », actions) ; état persistant après rechargement.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Centre : Code `tg ctr` (espace) ou vide | "Format invalide." |
| Centre : Nom vide | "Ce champ est obligatoire." |
| Centre : Code `TG-CTR1` une seconde fois | "Ce code de centre existe déjà." |
| Salle : Capacité `0` | "La valeur doit être supérieure ou égale à 1." |
| Salle : Capacité `5001` | "La valeur doit être inférieure ou égale à 5000." |
| Salle : Code `S1` une seconde fois | "Ce code de salle existe déjà dans ce centre." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour `etudes@` (adresse `/v2/examinations/centers` : « Accès refusé »)

### A.3 Sessions

#### 20.7 Créer une session officielle et une session d'examen blanc
Compte : responsable des examens · Où : « Sessions » > « Nouvelle session » (`/v2/examinations`) · Prérequis : 20.3 et 20.4.
1. Cliquer « Nouvelle session » : fenêtre « Nouvelle session d'examen » (description "La définition du type est copiée puis figée à l'ouverture des inscriptions.").
2. **Session officielle** :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Type d'examen | `TG_BEPC — BEPC test guide (démonstration)` (seuls les types « Actif » sont proposés) | oui |
   | Établissement | (champ absent : un seul établissement) | - |
   | Nature | « Officiel » | oui |
   | Code | `TG-BEPC-2027` (aide : "Lettres majuscules, chiffres, tirets (ex. CEPE-2027).") | oui |
   | Libellé | `Session BEPC test guide` | oui |
   | Année de la session | `2027` (le champ propose l'année courante) | oui |
   | Début des épreuves | `2027-06-14` (aide : "Facultatif.") | non |
   Cliquer « Créer la session ».
3. L'application ouvre directement le détail `/v2/examinations/sessions/<id>` (voir 20.8). Revenir à la liste par « Retour aux sessions ».
4. Recommencer avec **Nature** « Examen blanc » : le champ « Session officielle préparée » (aide "Facultatif : relie l'examen blanc à la session officielle qu'il prépare.", valeur par défaut « Aucune ») apparaît ; choisir "Session BEPC test guide". Code `TG-BLANC-2027`, Libellé `BEPC blanc test guide`, Année `2027`, Début des épreuves `2027-03-08`. « Créer la session ».
Résultat attendu : deux nouvelles lignes dans la liste : "Session BEPC test guide" (Officiel, « Planifiée », avancement 0 %, début des épreuves "14 juin 2027") et "BEPC blanc test guide" (Examen blanc, « Planifiée »). La pastille « Démonstration » apparaît dans la colonne « Données » si la règle liée ou le type est fictif (ici le type est « Démonstration (fictif) »).
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Type d'examen non choisi | "Choix invalide." |
| Code `tg bepc 2027` (espaces) ou vide | "Format invalide." |
| Libellé vide | "Ce champ est obligatoire." |
| Année `1999` | "La valeur doit être supérieure ou égale à 2000." |
| Code `TG-BEPC-2027` une seconde fois | "Ce code de session existe déjà pour cet établissement." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : bouton « Nouvelle session » absent pour `etudes@`

#### 20.8 Détail d'une session : copier et figer la définition, ouvrir les inscriptions
Compte : responsable des examens · Où : `/v2/examinations/sessions/<id>` (clic sur "Session BEPC test guide") · Prérequis : 20.7.
1. Lire l'en-tête (titre `Session BEPC test guide`, sous-titre `BEPC test guide (démonstration) 2027 — Officiel`), le bandeau « Règles de démonstration », la pastille d'état « Planifiée », le parcours « Parcours de la session » (étape courante soulignée, annoncée comme étape courante aux lecteurs d'écran), « Effectifs » (Candidats, Inscrits, Retirés, Éligibles, Placés, Avec résultat, Publiés : tous à 0), « Dates », « Actions », « Épreuves ».
2. Sous « Actions » : texte « La définition (séries et épreuves) n'est pas encore copiée depuis le type d'examen. » et bouton « Copier et figer la définition ». Dans « Épreuves » : « Aucune épreuve » avec « Copiez la définition du type d'examen pour obtenir les épreuves. ».
3. Cliquer « Copier et figer la définition ».
4. Message « Définition copiée : 3 épreuve(s). » ; le texte devient « Définition figée le `<date et heure>`. » ; le tableau « Épreuves » liste `TG_EP1`, `TG_EP2`, `TG_EP3` (filière `TGA` pour la troisième).
5. Les boutons d'étape apparaissent : « Passer à : Inscriptions ouvertes » (seule étape possible). Cliquer dessus.
6. Message « La session est maintenant : Inscriptions ouvertes. » ; l'étape courante du parcours change ; l'avancement passe à 17 %. Seule l'étape suivante est proposée : « Passer à : Inscriptions closes ».
7. Sous « Écrans de la session », lire les liens : « Candidats », « Répartition », « Notes et résultats », « Imports » (session officielle seulement), « Statistiques », « Corrections », « Exports et documents » (le lien « Examen blanc » n'apparaît que pour une session blanche). Chaque lien ouvre l'écran avec `?session=<id>`.
Résultat attendu : définition figée de façon irréversible (le bouton disparaît) ; états et pourcentages comme ci-dessus.
Cas invalides :
| Action | Message attendu |
|---|---|
| Ouvrir le détail de la session "BEPC blanc test guide" (définition **non** copiée) : le bouton « Passer à : Inscriptions ouvertes » | il est désactivé ; sous lui, la liste "Points bloquants pour &laquo; Inscriptions ouvertes &raquo;" affiche "La définition (séries, épreuves) n'est pas encore figée : la figer avant d'ouvrir les inscriptions." |
Source : `domain/lifecycle.ts` (`transitionBlockers`), migration `2001_examinations_sessions_candidates.sql`. Cette session blanche est figée et ouverte plus tard (scénario 20.34).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : section « Actions » absente pour `etudes@` (lecture seule)

### A.4 Candidats

#### 20.9 Ajouter les élèves d'une classe et évaluer l'éligibilité
Compte : responsable des examens · Où : onglet « Candidats » (`/v2/examinations/candidates`) · Prérequis : 20.8 (session « Inscriptions ouvertes »).
1. Choisir dans « Session d'examen » l'option commençant par `Session BEPC test guide`. La liste affiche « Aucun candidat » et « Ajoutez les élèves d'une classe pour constituer la liste des candidats. ». Le bandeau « Règles de démonstration » est affiché ainsi que la note "Les règles d'éligibilité de cette session sont des règles de démonstration.".
2. Dans le bloc « Ajouter les élèves d'une classe » (aide : "Chaque élève de la classe devient candidat ; ceux qui le sont déjà sont ignorés."), choisir la « Classe » `6e A` (code `6E-A`) puis cliquer « Ajouter les élèves ».
3. Message attendu : « 9 candidat(s) ajouté(s), 0 déjà présent(s). » (9 au dernier relevé : les élèves de la 6e A dont l'inscription est **en cours**, c'est-à-dire confirmée ; les quatre élèves non réglés n'en font pas partie ; relever le nombre exact et l'utiliser pour la suite). Recliquer « Ajouter les élèves » : « 0 candidat(s) ajouté(s), 9 déjà présent(s). ».
4. Colonnes du tableau « Candidats de la session » : « Candidat » (lien vers la fiche), « Numéro » (« — » avant inscription), « Filière », « Inscription » (« Brouillon »), « Éligibilité » (« Non évaluée »), « Pièces » (« Dossier complet »), « Issue » (« En attente »).
5. Cliquer « Évaluer l'éligibilité de tous » : message « 9 candidat(s) évalué(s) par la règle. ». Tous passent à « Éligible » (le type vise la classe 6E et aucune pièce n'est exigée).
6. Filtres : saisir `DIABATE` dans « Rechercher » (la liste se restreint à DIABATE Nadia et DIABATE Salimata) ; régler « Éligibilité » sur « Éligible », « Inscription » sur « Brouillon ». Remettre « Tous ».
Résultat attendu : chaque candidat porte l'état civil de l'annuaire (nom en majuscules suivi du prénom). Le détail de session montre « Candidats » 9, « Éligibles » 9, « Inscrits » 0.
Cas invalides :
| Action | Message attendu |
|---|---|
| Cliquer « Ajouter les élèves » sans classe | le bouton est désactivé |
| « Évaluer l'éligibilité de tous » sur une session sans règle liée (cas du primaire, partie B) | "Aucune version de la règle d'éligibilité n'est épinglée à cette session : évaluation automatique impossible (saisie manuelle de l'éligibilité avec auteur, ou nouvelle session une fois la règle liée)." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : blocs d'ajout et bouton « Évaluer l'éligibilité de tous » absents pour `etudes@`

#### 20.10 Fiche d'un candidat, inscription, identifiant officiel
Compte : responsable des examens · Où : clic sur "DIABATE Nadia" (`/v2/examinations/candidates/<id>`).
1. Lire l'en-tête : titre `DIABATE Nadia`, sous-titre « Numéro de candidat : pas encore attribué », pastilles « Brouillon », « Éligible », « En attente ». Sections : « État civil » (Nom, Prénoms, Date de naissance, Lieu de naissance, Sexe, Filière, Niveau, Numéro officiel), « Éligibilité » (historique d'une évaluation « Évaluée par la règle »), « Pièces du dossier » (« Aucune pièce exigée pour ce type d'examen. »), « Identifiants officiels » (« Aucun identifiant enregistré. »), « Place attribuée » (« Aucune place attribuée. »), « Notes et résultat » (« Aucune note. »), « Documents », « Historique ».
2. Cliquer « Inscrire le candidat » : message « Candidat inscrit, numéro TG_BEPC2027-00001. » ; la pastille devient « Inscrit » ; le sous-titre affiche le numéro. Le numéro est attribué à l'inscription par un compteur **propre à la session, sans trou** et jamais réutilisé après un retrait.
3. Section « Identifiants officiels » : « Type d'identifiant » `OFFICIAL_NUMBER`, « Valeur » `TG-OFF-0001`, « Enregistrer l'identifiant » : la liste affiche `OFFICIAL_NUMBER : TG-OFF-0001 (MANUAL)` et « Numéro officiel » de l'état civil affiche `TG-OFF-0001`.
4. Retour à la liste (« Retour aux candidats »). **Inscription en lot** : cocher DIABATE Salimata puis COULIBALY Moussa **dans cet ordre** (cases « Sélectionner DIABATE Salimata », « Sélectionner COULIBALY Moussa ») et cliquer « Inscrire la sélection (2) » : « 2 candidat(s) inscrit(s). ». Numéros attendus `TG_BEPC2027-00002` et `TG_BEPC2027-00003` (dans l'ordre de sélection ; sinon relever les numéros réels pour la suite).
5. « Sélectionner la page » coche toutes les lignes de la page (le bouton devient « Désélectionner la page »).
Résultat attendu : 3 candidats « Inscrit » avec numéros 00001 à 00003. La section « Frais d'examen » (visible pour une session officielle et un candidat inscrit) indique l'absence de frais (pastille « Aucun frais » ou texte « Aucun frais d'examen pour ce candidat. », à vérifier en test ; le barème du type est vide).
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Identifiant `TG-OFF-0001` saisi sur un autre candidat | "Cet identifiant désigne déjà un autre candidat de la session." |
| Identifiant : Valeur vide | le bouton « Enregistrer l'identifiant » est désactivé |
| Inscrire un candidat dont l'éligibilité est « Non évaluée » ou « Non éligible » | "l'éligibilité doit être établie avant l'inscription (statut NOT_EVALUATED)" (ou `INELIGIBLE`) ; dans le rapport d'une inscription en lot, le code technique `(examinations.not_eligible)` est affiché à la suite du message (écart connu, voir "Écarts constatés") |
| Inscrire quand la session n'est plus « Inscriptions ouvertes » | "les inscriptions ne sont pas ouvertes (session REGISTRATION_CLOSED)" |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : boutons « Inscrire le candidat » et « Retirer le candidat » absents pour `etudes@`

#### 20.11 Saisir un candidat libre à la main
Compte : responsable des examens · Où : « Candidats » (`/v2/examinations/candidates`), session `Session BEPC test guide` · Prérequis : 20.8 (« Inscriptions ouvertes »). Un candidat libre n'est pas un élève de l'établissement : aucun dossier élève n'est créé ; il n'existe que dans une session **officielle** (ce bloc est remplacé par un avis sur une session blanche, voir 20.34).
1. Dans le bloc « Candidat libre (sans dossier élève) » (texte : "Inscrire à cette session une personne qui n'est pas élève de l'établissement : …"), cliquer « Saisir un candidat libre » : fenêtre « Nouveau candidat libre ».
2. Remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Nom | `KOUASSI` | oui |
   | Prénoms | `Yves test guide` | oui |
   | Date de naissance | `2013-08-19` | oui |
   | Lieu de naissance | `Cocody, Abidjan` | non |
   | Sexe | « Masculin » (liste « Choisir » : « Féminin », « Masculin ») | oui |
   | Téléphone | `+225 07 41 22 63 18` | non (voir règle de contact) |
   | Adresse e-mail | `yves.kouassi.tg@exemple.test` | non |
   | Adresse | `Riviera Palmeraie, Abidjan` | non |
   | Type de pièce | `EXTRAIT_NAISSANCE` (aide : "Par exemple CNI, PASSEPORT, EXTRAIT_NAISSANCE.") | non |
   | Numéro de la pièce | `EN-TG-0100` | non (va avec le type) |
   | Nom du tuteur | `KOUASSI Marcel` | non |
   | Lien avec le candidat | `Père` | non |
   | Téléphone du tuteur | `+225 07 41 22 63 19` | non |
   | E-mail du tuteur | `marcel.kouassi.tg@exemple.test` | non |
   | Le candidat est dans la classe de l'examen | coché | - |
   | Nombre de tentatives antérieures à cet examen | `0` | - |
   Règle de contact : "Au moins un moyen de contact (le candidat ou son tuteur) est requis pour la convocation."
3. Cliquer « Enregistrer le candidat ».
4. Dans la liste, `KOUASSI Yves test guide` apparaît avec la pastille « Candidat libre », « Brouillon » et « Non évaluée ». Ouvrir sa fiche : « Évaluer par la règle » (message « Éligibilité évaluée par la règle. », pastille « Éligible » : la règle de démonstration lit les faits **saisis** "classe de l'examen" et "pièces complètes") puis « Inscrire le candidat » : « Candidat inscrit, numéro TG_BEPC2027-00004. ».
Résultat attendu : la fenêtre se ferme ; numéro `TG_BEPC2027-00004` (quatrième inscription de la session) ; contact et pièce ne figurent pas dans la liste (données restreintes).
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Nom ou Prénoms vide | "Ce champ est obligatoire." |
| Date de naissance vide | "Date attendue au format AAAA-MM-JJ." |
| Sexe non choisi | "Ce champ est obligatoire." |
| Aucun téléphone, e-mail, ni contact du tuteur | "Indiquer au moins un téléphone ou une adresse e-mail (candidat ou tuteur)." (sous Téléphone) |
| Type de pièce sans numéro (ou l'inverse) | "Le type et le numéro de la pièce vont ensemble." (sous Numéro de la pièce) |
| Même identité (nom, prénoms, naissance) saisie une seconde fois, sans pièce | "Ce candidat libre (même nom, mêmes prénoms, même naissance) est déjà inscrit dans la session." (bandeau dans la fenêtre) |
| Même numéro de pièce `EN-TG-0100` sur une autre personne | "Cette pièce d'identité désigne déjà un autre candidat libre de la session." |
Sources : `apps/web/src/app/v2/examinations/_components/ExternalCandidatePanel.tsx`, `apps/api/src/modules/examinations/domain/errors.ts` (table `UNIQUE_CODES`), `application/external-candidates.ts`.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : bloc absent pour `etudes@`

#### 20.12 Importer un fichier CSV de candidats libres
Compte : responsable des examens · Où : « Candidats » > « Importer un fichier CSV » · Prérequis : 20.11. Fichiers dans `docs/guide-test/jeux-de-donnees/` (descriptions et résultats attendus en fin de chapitre).
1. Cliquer « Importer un fichier CSV » : le bloc s'ouvre avec l'aide "Fichier CSV avec en-tête (séparateur ; ou ,). Colonnes : nom, prenoms, naissance (AAAA-MM-JJ), lieu, sexe (F ou M), telephone, email, adresse, piece_type, piece_numero, tuteur, lien_tuteur, tel_tuteur, email_tuteur, classe_examen (oui ou non), tentatives" et le champ « Fichier CSV des candidats libres ».
2. Choisir `20-examens-candidats-libres-entetes.csv` : message d'erreur "Colonnes obligatoires absentes : classe_examen." et information "Colonnes ignorées : remarque." ; aucun bouton d'envoi.
3. Choisir `20-examens-candidats-libres-erreurs.csv` : résumé "20-examens-candidats-libres-erreurs.csv : 2 ligne(s) valide(s), 6 ligne(s) à corriger." puis la liste en rouge :
   - "Ligne 3 : champ obligatoire absent (nom)"
   - "Ligne 4 : date invalide (naissance)"
   - "Ligne 5 : sexe invalide (F ou M) (sexe)"
   - "Ligne 6 : valeur oui ou non attendue (classe_examen)"
   - "Ligne 7 : nombre invalide (tentatives)"
   - "Ligne 8 : aucun moyen de contact (telephone)"
   Cliquer « Importer 2 candidat(s) ». Résultat : "1 candidat(s) libre(s) enregistré(s)." et, sous « Lignes refusées », la ligne "Ce candidat libre (même nom, mêmes prénoms, même naissance) est déjà inscrit dans la session. (examinations.candidate_duplicate)" (la ligne 9 du fichier reprend l'identité de la ligne 2). `SORO Aya test guide` est créée en « Brouillon ».
4. Choisir `20-examens-candidats-libres.csv` : résumé "20-examens-candidats-libres.csv : 6 ligne(s) valide(s), 0 ligne(s) à corriger." ; cliquer « Importer 6 candidat(s) » : "6 candidat(s) libre(s) enregistré(s)."
5. Saisir `test guide` dans « Rechercher » : les candidats libres apparaissent avec la pastille « Candidat libre » (KONE Mariam, TRAORE Seydou, YAO Adjoua, DIABATE Ibrahim, BAMBA Fanta, COULIBALY Karim, KOUASSI Yves, SORO Aya).
6. Ré-importer `20-examens-candidats-libres.csv` : "0 candidat(s) libre(s) enregistré(s)." et six lignes refusées (même message de doublon).
Résultat attendu : 8 candidats libres au total (1 saisi, 1 de l'import d'erreurs, 6 du fichier valide) en plus des 9 élèves ; aucun doublon créé.
Cas invalides : un fichier vide (0 octet) donne "Colonnes obligatoires absentes : nom, prenoms, naissance, lieu, sexe." (la liste inclut `lieu`, qui est pourtant facultatif : voir "Écarts constatés").
Source : `_components/external-csv.ts` (analyse côté écran, ordre libre des colonnes, séparateur `;` ou `,`) ; l'API revalide chaque ligne.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : bouton absent pour `etudes@`

#### 20.13 Fiche d'un candidat libre : données restreintes, inscription, anonymisation
Compte : responsable des examens, puis directeur · Où : « Candidats » > recherche `KONE` > clic sur `KONE Mariam test guide`.
1. Examens : la fiche affiche les pastilles « Candidat libre » et « Brouillon ». Section « Données personnelles restreintes » avec le texte "Accès restreint : chaque consultation est tracée. Ces données ne figurent ni dans les listes, ni dans les exports, ni dans les événements." et les champs « Téléphone » (`+225 07 55 20 41 01`), « E-mail » (—), « Adresse », « Type de pièce » (`EXTRAIT_NAISSANCE`), « Numéro de pièce » (**masqué** : valeur partielle), « Tuteur » (`KONE Issouf`), « Lien » (`Père`), « Téléphone du tuteur », « E-mail du tuteur », « Dans la classe de l'examen (déclaré) » (Oui), « Tentatives antérieures (déclarées) » (0), « Origine de la saisie » (Importé).
2. Cliquer « Afficher le numéro de pièce en entier » : le numéro complet `EN-TG-0001` s'affiche avec la mention "L'affichage complet du numéro de pièce a été tracé." (lecture auditée).
3. « Évaluer par la règle » : « Éligible » ; « Inscrire le candidat » : « Candidat inscrit, numéro TG_BEPC2027-00005. ».
4. Section « Pièces du dossier » : « Aucune pièce exigée pour ce type d'examen. » (le type `TG_BEPC` n'a pas de pièce ; la pièce « vue sur place » se teste au primaire, scénario 20.37).
5. **Anonymisation** (directeur) : se connecter avec `directeur@secondaire-test.test`, ouvrir la fiche de `COULIBALY Karim test guide` (en « Brouillon ») ; cliquer « Anonymiser le candidat » : fenêtre « Anonymiser le candidat libre », texte "Irréversible : contact, pièce d'identité et tuteur sont effacés, l'identité devient neutre. Le numéro de candidat, le résultat et l'historique sont conservés.", champ « Motif (demande de la personne, obligation légale…) », bouton « Anonymiser ». Saisir `Demande d'effacement du candidat de démonstration.` puis « Anonymiser ».
Résultat attendu : pastille « Anonymisé » ; le bloc de données affiche « Ce candidat a été anonymisé : ces données ont été effacées. » ; le bouton « Anonymiser le candidat » disparaît et le bouton « Pièce vue sur place » (s'il existait) est désactivé. Avec `examens@`, le bouton « Anonymiser le candidat » est **absent**.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Motif de 5 caractères (`Motif`) | "Le motif doit comporter au moins 10 caractères." (sous le champ ; la fenêtre reste ouverte) |
| « Inscrire le candidat » sur le candidat anonymisé | "Ce candidat est anonymisé : il ne peut plus être inscrit." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : « Anonymiser le candidat » absent pour `examens@` ; section « Données personnelles restreintes » absente pour `etudes@` (pas de droit de lecture des données personnelles)

#### 20.14 Éligibilité refusée, dérogation de la direction, retrait d'un candidat
Compte : responsable des examens, puis directeur (MFA), puis responsable des examens · Où : fiche de `BAMBA Fanta test guide` · Prérequis : 20.12 (la ligne du fichier porte "classe de l'examen : non").
1. Examens : ouvrir la fiche (« Brouillon », « Non évaluée »). Cliquer « Évaluer par la règle » : pastille « Non éligible » ; dans « Éligibilité », l'historique montre une évaluation « Évaluée par la règle » avec le motif `NOT_IN_EXAM_GRADE` (le code est affiché tel quel : écart connu).
2. Cliquer « Inscrire le candidat » : bandeau d'erreur "l'éligibilité doit être établie avant l'inscription (statut INELIGIBLE)".
3. Cliquer « Saisir à la main » : fenêtre « Saisie manuelle de l'éligibilité » (texte "Possible seulement si aucune règle n'est épinglée à la session ; l'auteur est enregistré."), laisser « Éligible », cliquer « Enregistrer » : bandeau d'erreur "Une règle d'éligibilité est épinglée à cette session : l'éligibilité se calcule par la règle (ou se déroge avec un motif)." Fermer par « Annuler ». Le bouton « Accorder une dérogation » est **absent** pour ce compte.
4. Direction : se connecter avec `directeur@secondaire-test.test` (MFA), ouvrir la même fiche, cliquer « Accorder une dérogation » : fenêtre « Dérogation à l'éligibilité » (texte "La dérogation rend le candidat éligible malgré la règle ; elle est motivée et journalisée."), champ « Motif de la dérogation ». Saisir `Décision de démonstration du jury de l'établissement.` puis « Accorder la dérogation ». Si une fenêtre de seconde vérification (MFA récente) s'ouvre, la valider avec le code du moment (à vérifier en test).
5. Résultat côté fiche : nouvelle ligne d'historique avec la pastille « Dérogation » et "Motif de la dérogation : Décision de démonstration du jury de l'établissement." ; l'éligibilité devient « Éligible » (à vérifier en test).
6. Examens : « Inscrire le candidat » : « Candidat inscrit, numéro TG_BEPC2027-00006. ».
7. **Retrait** : fiche de `TRAORE Seydou test guide` (« Brouillon ») > « Retirer le candidat » : fenêtre « Retirer le candidat » (texte "Le retrait est conservé dans l'historique ; le numéro attribué n'est jamais réutilisé."), champ « Motif du retrait » : `Désistement de démonstration.` > « Retirer ». Pastille « Retiré » ; les boutons d'inscription et de retrait disparaissent ; le détail de session affiche « Retirés » 1.
Résultat attendu : 6 candidats « Inscrit » (numéros 00001 à 00006 : Nadia, Salimata, Moussa, Yves, Mariam, Fanta) ; 1 « Retiré ».
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Dérogation : motif de 5 caractères | "Le motif doit comporter au moins 10 caractères." |
| Dérogation sur un candidat « Non évaluée » (par exemple `DIABATE Ibrahim test guide` avant toute évaluation) | "Évaluer l'éligibilité avant d'accorder une dérogation." |
| Dérogation sur un candidat déjà « Éligible » (`DIABATE Nadia`) | "Ce candidat est déjà éligible : aucune dérogation nécessaire." |
| Retrait : motif de 3 caractères | "Le motif doit comporter au moins 5 caractères." |
Sources : `application/eligibility.ts`, `application/candidates.ts`, `migrations/2001_examinations_sessions_candidates.sql`.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : « Accorder une dérogation » absent pour `examens@` (voir aussi l'écart sur `etudes@`)

### A.5 Répartition dans les salles

#### 20.15 Choisir les centres, répartir automatiquement, ajuster les places
Compte : responsable des examens · Où : « Répartition » (`/v2/examinations/assignments`), session `Session BEPC test guide` · Prérequis : 6 candidats inscrits (20.14), centre `TG-CTR1` avec `S1` (3 places) et `S2` (2 places) (20.6).
1. Lire le résumé « Synthèse de la répartition » : « Inscrits » 6, « Sans place » 6, « Capacité » 0, « Placés » 0, avec l'avertissement "Capacité insuffisante : il manque 6 place(s)." (à vérifier en test). Le centre actif créé en 20.6 est déjà **proposé** dans « Centres de la session » (case `TG-CTR1 — Centre Cocody test guide`) sans rattachement préalable (défaut corrigé le 2026-10-07, rapport QA 10, constat C-10-01 : la répartition propose tous les centres actifs). « Salles » indique "Aucune salle disponible." tant que le centre n'est pas rattaché.
2. Cocher `TG-CTR1 — Centre Cocody test guide`, cliquer « Enregistrer les centres » : « Centres de la session enregistrés. ». « Salles » liste `Centre Cocody test guide — S1` ("0 / 3 places occupées") et `… — S2` ("0 / 2 places occupées") ; « Capacité » passe à 5 ; l'avertissement devient "Capacité insuffisante : il manque 1 place(s)."
3. Cliquer « Répartir automatiquement » (case « Tout replacer » décochée) : erreur "Capacité insuffisante : 6 candidat(s) à placer pour 5 place(s) libre(s) dans les salles actives des centres de la session." La répartition est **tout ou rien** : « Placés » reste à 0.
4. « Centres et salles » > carte `TG-CTR1` > « Ajouter une salle » : Code `S3`, Libellé `Salle 3 test guide`, Capacité (places) `2`. Revenir à « Répartition » : « Capacité » 7, plus d'avertissement.
5. « Répartir automatiquement » : « 6 candidat(s) placé(s), 0 déjà placé(s). ». Le tableau « Places attribuées » (colonnes « Numéro », « Candidat », « Centre », « Salle », « Place ») se remplit dans l'ordre des numéros et des codes de salle (ordre déterministe annoncé par le code) : 00001 > S1 place 1, 00002 > S1 place 2, 00003 > S1 place 3, 00004 > S2 place 1, 00005 > S2 place 2, 00006 > S3 place 1.
6. Ligne du candidat 00006 (`BAMBA Fanta test guide`) : cliquer « Changer » : fenêtre « Changer la place de BAMBA Fanta test guide », champ « Salle » (choix `Centre Cocody test guide — S3 (1/2)`), champ « Numéro de place » (aide "Laissez vide pour la première place libre."). Choisir S3, place `2`, « Enregistrer » : le tableau affiche S3 place 2.
7. Ligne du candidat 00005 (`KONE Mariam test guide`) : cliquer « Retirer la place » : la ligne disparaît ; « Sans place » 1. (Ce candidat servira à l'échec de convocation du scénario 20.17.)
8. La fiche d'un candidat placé (par exemple `DIABATE Nadia`) affiche dans « Place attribuée » : "Centre Cocody test guide, salle S1, place 1."
Résultat attendu : toutes les valeurs ci-dessus ; les modifications persistent après rechargement ; la fiche et la vue famille relisent la même place.
Cas invalides (dans la fenêtre « Changer ») :
| Saisie | Message attendu |
|---|---|
| Salle `S1`, place `1` (déjà prise par le candidat 00001) | "Cette place est déjà attribuée." |
| Salle `S1`, place `9` (capacité 3) | "la place 9 dépasse la capacité de la salle (3)" |
| Salle `S2` sans numéro de place alors que la salle est pleine | "Cette salle est complète." |
| Aucune salle choisie | rien n'est envoyé (la fenêtre ne se ferme pas) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : pour `etudes@`, l'écran est en lecture (pas de « Centres de la session », ni de « Répartition automatique », ni de boutons « Changer » / « Retirer la place »)

### A.6 Clôture des inscriptions, convocations, vue des familles

#### 20.16 Clore les inscriptions
Compte : responsable des examens · Où : détail de la session (`/v2/examinations/sessions/<id>`) · Prérequis : 20.15.
1. Cliquer « Passer à : Inscriptions closes » : « La session est maintenant : Inscriptions closes. » (avancement 33 %). Deux étapes sont alors proposées : « Passer à : Inscriptions ouvertes » (retour) et « Passer à : Épreuves en cours ». **Ne pas encore passer en cours.**
2. « Candidats » : ouvrir la fiche de `DIABATE Ibrahim test guide` (candidat libre « Brouillon »), « Évaluer par la règle » puis « Inscrire le candidat » : "les inscriptions ne sont pas ouvertes (session REGISTRATION_CLOSED)".
3. « Notes et résultats » > « Notes par épreuve » : saisir `12` pour DIABATE Nadia en `TG_EP1` puis « Enregistrer les notes modifiées (1) » : rapport "0 note(s) enregistrée(s), 0 inchangée(s)." avec, sous « Lignes refusées », "la saisie des notes n'est ouverte que session en cours ou résultats saisis (session REGISTRATION_CLOSED) (examinations.scores_closed)" (le message est suivi d'un code technique et la requête répond 200 : écart connu C-10-03). Cliquer « Annuler les modifications ».
4. Même contrôle côté résultats : « Résultats » > « Saisir un résultat », candidat Nadia, « Admis », « Enregistrer le résultat » : "0 résultat(s) enregistré(s)." et ligne refusée "la saisie des résultats exige une session en cours ou à résultats saisis (session REGISTRATION_CLOSED)".
5. « Répartition » : la session est « Inscriptions closes » : la répartition reste **modifiable** (pas d'avis de répartition figée).
Résultat attendu : états et messages ci-dessus ; aucune note ni résultat enregistré.
Cas invalides : voir les étapes 2 à 4.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : section « Actions » absente pour `etudes@`

#### 20.17 Émettre les convocations (lot, individuel, échec, révocation)
Compte : responsable des examens · Où : « Exports et documents » (`/v2/examinations/exports`), session `Session BEPC test guide` · Prérequis : 20.16 (5 candidats placés, 1 sans place).
1. Lire la section « Exports » : texte "Les colonnes d'un export viennent d'une liste de champs autorisés ; les cellules de texte qui ressembleraient à une formule sont neutralisées.", champ « Format d'export » avec l'aide « Aucun format publié. » : aucun format n'est livré au collège (voir 20.33). Bouton « Lancer l'export » inactif ; « Aucun export » / « Choisissez un format puis lancez l'export. ».
2. Section « Documents » : texte "L'émission produit des documents scellés ; un document révoqué reste conservé avec son motif.", champ « Document » (défaut « Convocation » ; autres valeurs « Attestation de réussite », « Relevé de notes »). Cliquer « Émettre pour tous les candidats concernés ».
3. Rapport attendu : "5 document(s) émis, 0 ignoré(s)." et, sous « Lignes refusées », "La convocation exige une place attribuée au candidat. (examinations.convocation_requires_assignment)" (candidat 00005 sans place). La liste « Documents émis » montre cinq lignes `Convocation v1 — TG_BEPC2027-0000N` avec l'état « Émis », un bouton « Télécharger » et un bouton « Révoquer ».
4. Cliquer « Télécharger » sur une convocation : un PDF s'ouvre ou se télécharge (fichier `CONVOCATION-<numéro>.pdf`) ; il porte le nom du candidat, le centre, la salle, la place, la date des épreuves (14 juin 2027) et le filigrane de démonstration "Données et règles de démonstration (fictives) : aucune valeur officielle." (à vérifier visuellement).
5. « Répartition » > « Répartir automatiquement » : « 1 candidat(s) placé(s), 5 déjà placé(s). ». Retour à « Exports et documents » > « Émettre pour tous les candidats concernés » : "1 document(s) émis, 5 ignoré(s)." avec cinq lignes « Un document valide existe déjà. »
6. Cliquer « Révoquer » sur la convocation du candidat 00006 : fenêtre « Révoquer le document » (texte "Le document n'est plus valable ; un nouveau pourra être émis."), champ « Motif de la révocation » : `Erreur de salle sur la convocation de démonstration.` > « Révoquer ». La ligne passe à « Révoqué » avec le motif et perd ses boutons. Relancer « Émettre pour tous les candidats concernés » : "1 document(s) émis, 5 ignoré(s)." ; la nouvelle ligne est `Convocation v2`.
7. Fiche d'un candidat (`DIABATE Nadia`), section « Documents » : boutons « Émettre : Convocation », « Émettre : Attestation de réussite », « Émettre : Relevé de notes ». Cliquer « Émettre : Attestation de réussite » : bandeau d'erreur "Ce document exige un résultat officiel publié."
Résultat attendu : comptes et messages ci-dessus ; un document émis ne se remplace que par révocation motivée puis nouvelle émission (version suivante).
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Révocation : motif de 5 caractères | "Le motif doit comporter au moins 10 caractères." |
| Convocation individuelle sur un candidat qui a déjà une convocation valide (« Émettre : Convocation » sur la fiche de Nadia) | "Ce candidat a déjà un document vivant de cette nature : le révoquer (avec motif) avant d'en émettre un nouveau." |
| Convocation pour un candidat sans place | "La convocation exige une place attribuée au candidat." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : écran « Exports et documents » refusé pour `etudes@`

#### 20.18 Vue famille avant les résultats (parent et élève)
Comptes : parent (`parent@secondaire-test.test`) puis élève (`eleve@secondaire-test.test`) · Où : menu « Examens de mes enfants » (parent) ou « Mon examen » (élève), adresse `/v2/examinations/family` · Prérequis : 20.17.
1. Parent : titre « Examen de mon enfant » (description "Inscription, place, résultat publié et documents."). Deux cartes : `DIABATE Nadia — BEPC test guide (démonstration) 2027` et `DIABATE Salimata — …`, chacune avec la pastille « Inscrit », le bandeau « Règles de démonstration », la ligne `Session BEPC test guide (Officiel)`, « Numéro de candidat » (`TG_BEPC2027-00001`, `…-00002`), « Début des épreuves » (14 juin 2027), « Place » (`Centre Cocody test guide, salle S1, place 1`, `… place 2`), le texte « Le résultat n'est pas encore publié. » et la liste « Documents » avec « Convocation » et un bouton « Télécharger ».
2. Constater qu'**aucune note, moyenne ni rang** n'apparaît ; que l'inscription de Nadia à la session d'**examen blanc** `BLANC-DEMO` (élèves inscrits par la graine) n'apparaît **pas** (seules les sessions officielles sont montrées aux familles) ; qu'aucun autre élève (COULIBALY Moussa, etc.) n'apparaît.
3. Élève : titre « Mon examen » ; une seule carte, celle de `DIABATE Nadia`.
4. Cliquer « Télécharger » sur la convocation : le PDF s'ouvre (la lecture est journalisée côté API).
Résultat attendu : valeurs ci-dessus. (Avant le scénario 20.10, les deux comptes voyaient « Aucun examen » avec « Aucune inscription à un examen n'est enregistrée. ».)
Cas invalides : sans objet (écran en lecture).
- [ ] Cas nominal  - [ ] Cas invalide (sans objet)  - [ ] Droit refusé : un parent ouvrant `/v2/examinations/results` est redirigé vers "Accès refusé" (voir 20.43)

### A.7 Épreuves, notes, résultats, corrections, statistiques, publication

#### 20.19 Passer en « Épreuves en cours » : la répartition est figée
Compte : responsable des examens · Où : détail de la session · Prérequis : 20.17.
1. Cliquer « Passer à : Épreuves en cours » : « La session est maintenant : Épreuves en cours. » (avancement 50 %). Seule l'étape « Passer à : Résultats saisis » est proposée.
2. « Répartition » : message « La répartition est figée à ce stade de la session. » ; les boutons « Enregistrer les centres », « Répartir automatiquement », « Changer » et « Retirer la place » sont désactivés.
3. « Candidats » : l'ajout d'une classe est refusé pour chaque élève par la base (message de la base à relever en test, du type "la session est IN_PROGRESS ; plus de nouveau candidat").
Résultat attendu : répartition figée, notes ouvertes.
Cas invalides : par appel direct de l'API (non testable depuis l'écran), « Répartir automatiquement » répond "La répartition est figée (session IN_PROGRESS)."
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : section « Actions » absente pour `etudes@`

#### 20.20 Saisir les notes par épreuve
Compte : responsable des examens · Où : « Notes et résultats » (`/v2/examinations/results`) > onglet « Notes par épreuve », session `Session BEPC test guide` · Prérequis : 20.19.
1. La page montre deux onglets, « Résultats » (ouvert par défaut) et « Notes par épreuve » (liste d'onglets « Notes ou résultats »). Ouvrir « Notes par épreuve » : tableau « Notes par candidat et par épreuve » avec les 6 candidats **inscrits** et trois colonnes `TG_EP1 /20`, `TG_EP2 /20`, `TG_EP3 /10`. La colonne `TG_EP3` (réservée à la filière `TGA`) affiche « — » pour tous : aucun candidat n'a de filière (l'écran n'offre pas d'affectation de filière à un candidat).
2. Saisir (champs « Note de `<nom>` en `<épreuve>` » et listes « État de la note de `<nom>` en `<épreuve>` » ; la virgule décimale est acceptée) :
   | Candidat | `TG_EP1` | `TG_EP2` |
   |---|---|---|
   | DIABATE Nadia | `13` | `11` |
   | DIABATE Salimata | `9` | `8` |
   | COULIBALY Moussa | `15` | `12` |
   | KOUASSI Yves test guide | `10` | `11` |
   | KONE Mariam test guide | état « Absent » | état « Absent » |
   | BAMBA Fanta test guide | état « Excusé » | état « Excusé » |
   (États proposés : « Saisie », « Absent », « Excusé », « Fraude » ; un état autre que « Saisie » efface la note.)
3. Le bouton affiche « Enregistrer les notes modifiées (12) » : cliquer. Message « 12 note(s) enregistrée(s), 0 inchangée(s). ». Recharger : les valeurs persistent. La fiche de `DIABATE Nadia` affiche dans « Notes et résultat » : "13 / 20" et "11 / 20" avec l'origine « Saisie à la main ».
Résultat attendu : douze notes (huit valeurs et quatre états) enregistrées.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Note `abc` ou `-3` | bandeau "Nombre décimal attendu (ex. 14.5)." (rien n'est envoyé) |
| Note `21` pour Nadia en `TG_EP1` | rapport "0 note(s) enregistrée(s), 0 inchangée(s)." et ligne refusée "la note 21.000 dépasse le barème 20.000 de l'épreuve (examinations.score_above_scale)" (forme numérique à relever en test) |
| Cliquer « Annuler les modifications » | toutes les cellules modifiées reviennent à leur valeur enregistrée |
Source : `apps/web/src/app/v2/examinations/_components/ResultsScreen.tsx`, `migrations/2002_examinations_results_exports.sql`.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : avec `etudes@`, les notes s'affichent en texte (pas de champs ni de bouton d'enregistrement)

#### 20.21 Saisir les résultats de l'autorité, passer à « Résultats saisis », lever le blocage de publication
Compte : responsable des examens · Où : « Notes et résultats » > onglet « Résultats » · Prérequis : 20.20.
1. Lire le bloc « Saisir un résultat » : texte "Résultat communiqué par l'autorité, saisi tel quel : la plateforme ne le calcule pas." Champs « Candidat » (liste « Choisir un candidat » : `DIABATE Nadia (TG_BEPC2027-00001)`…), « Résultat » (défaut « Admis » ; « Refusé », « Absent », « Exclu », « Différé »), « Moyenne », « Rang », « Mention » (aide "Code de mention fourni par l'autorité (facultatif).").
2. Enregistrer **cinq** résultats (un à la fois, « Enregistrer le résultat » ; message « 1 résultat(s) enregistré(s). ») :
   | Candidat | Résultat | Moyenne | Rang | Mention |
   |---|---|---|---|---|
   | DIABATE Nadia | Admis | `12,5` | `2` | `AB` |
   | DIABATE Salimata | Refusé | `8,75` | `5` | (vide) |
   | COULIBALY Moussa | Admis | `14` | `1` | `BIEN` |
   | KOUASSI Yves test guide | Admis | `10,25` | `3` | (vide) |
   | KONE Mariam test guide | Absent | (vide) | (vide) | (vide) |
   Ces valeurs sont saisies telles quelles : elles ne sont **pas** recalculées à partir des notes de 20.20.
3. Le tableau « Résultats des candidats » (colonnes « Numéro », « Candidat », « Résultat », « Moyenne », « Rang », « Mention », « Origine », « Publication ») affiche cinq lignes, origine « Saisi à la main », publication « Non publié ». Les filtres « Résultat » et « Publication » restreignent la liste.
4. Détail de la session : « Avec résultat » 5. Cliquer « Passer à : Résultats saisis » : « La session est maintenant : Résultats saisis. » (avancement 67 %). Sont alors proposés : « Passer à : Épreuves en cours » (retour) et « Passer à : Résultats publiés » (rouge) **désactivé**, avec sous lui la liste intitulée "Points bloquants pour « Résultats publiés »" : "1 candidat(s) inscrit(s) sans résultat : saisir ou importer leur résultat (absent, différé…) avant la publication."
5. Revenir à « Notes et résultats » > « Résultats » et saisir le sixième résultat : `BAMBA Fanta test guide`, « Différé », sans moyenne. Recharger le détail de la session : « Avec résultat » 6, plus de point bloquant, bouton « Passer à : Résultats publiés » actif (ne pas encore cliquer).
Résultat attendu : 6 résultats « Non publié » ; l'issue de chaque candidat suit son résultat (colonne « Issue » de « Candidats » : « Admis », « Refusé », « Absent », « Différé »).
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Aucun candidat choisi | "Choix invalide." (sous « Candidat ») |
| Moyenne `abc` | "Format invalide." |
| « Absent » avec Moyenne `10` | "Un absent, exclu ou ajourné n'a ni moyenne, ni rang, ni mention." (sous « Résultat ») |
| Rang `0` | "La valeur doit être supérieure ou égale à 1." |
| Mention `b` (1 caractère) | "Format invalide." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : bloc « Saisir un résultat » absent pour `etudes@`

#### 20.22 Corriger une note après la clôture des notes (demande puis approbation)
Comptes : responsable des examens, puis directeur · Où : « Corrections » (`/v2/examinations/corrections`), session `Session BEPC test guide` · Prérequis : 20.21 (session « Résultats saisis »).
1. Examens : lire l'avis "Règle des quatre yeux : la demande est approuvée par une AUTRE personne que celle qui l'a faite ; la valeur d'origine reste dans l'historique." et la liste filtrée sur « En attente » (« Aucune demande de correction » / « Les demandes apparaissent ici. »).
2. Dans « Nouvelle demande de correction » (texte "Choisissez la note ou le résultat à corriger et indiquez le motif.") :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Objet de la correction | « Une note » | oui |
   | Candidat | `DIABATE Salimata` | oui |
   | Épreuve | `TG_EP1 — Mathématiques test guide` | oui |
   | État proposé | « Saisie » | oui |
   | Note proposée | `10` | oui si « Saisie » |
   | Motif | `Erreur de report de la note constatée à la relecture des copies.` (aide "10 caractères au minimum.") | oui |
3. Cliquer « Envoyer la demande » : « Demande envoyée : une autre personne doit l'approuver. ». Une carte "Note — TG_BEPC2027-00002" apparaît avec la pastille « En attente », « Valeur actuelle » (« État de la note : Saisie », « Note : 9 »), « Valeur proposée » et « Motif : … ». Pour ce compte, aucun bouton « Approuver » / « Rejeter » n'est affiché. Envoyer aussitôt une seconde demande sur la même note : voir "Cas invalides".
4. Direction : avec `directeur@secondaire-test.test`, ouvrir la même page et la même session : la carte porte « Approuver » et « Rejeter » et le rappel « Vous ne pouvez pas approuver votre propre demande. » (affiché en permanence ; ici le demandeur est une autre personne). Cliquer « Approuver » : la carte quitte le filtre « En attente » ; choisir « Approuvées » pour la revoir (pastille « Approuvée »).
5. « Notes et résultats » > « Notes par épreuve » : DIABATE Salimata affiche `10` en `TG_EP1`.
6. **Correction directe interdite** : avec `examens@`, changer la note de DIABATE Nadia en `TG_EP1` de `13` à `14` puis « Enregistrer les notes modifiées (1) » : rapport "0 note(s) enregistrée(s), 0 inchangée(s)." avec la ligne refusée "une note saisie après clôture ne se corrige que par une révision approuvée (examinations.score_revision_required)". Cliquer « Annuler les modifications ».
Résultat attendu : la note est corrigée uniquement après approbation par une autre personne ; l'ancienne valeur reste dans l'historique de la révision.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Motif de 5 caractères | "Au moins 10 caractères." (sous « Motif ») |
| Note proposée `9` pour Salimata avant l'approbation (valeur identique) | "La valeur proposée est identique à la valeur actuelle." |
| Candidat ou épreuve non choisi | "Choisissez un candidat et une épreuve ayant déjà une note." |
| Seconde demande sur la même note tant que la première est en attente | "Une demande de révision est déjà en attente pour cette cible." |
Note de présentation : la valeur proposée peut s'afficher avec des clés techniques (`toStatus`, `toScore`), voir "Écarts constatés".
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : boutons « Approuver » / « Rejeter » absents pour `examens@` et `etudes@`

#### 20.23 Publier un résultat, puis le corriger (rejet, doublon, approbation)
Comptes : directeur, responsable des examens, directeur · Où : « Notes et résultats » > « Résultats » puis « Corrections » · Prérequis : 20.22 (session toujours « Résultats saisis »).
1. Direction : dans « Résultats », ligne `COULIBALY Moussa` : cliquer « Publier » (nom accessible « Publier le résultat de COULIBALY Moussa ») : la publication passe à « Publié ». Aucune fenêtre de confirmation n'est affichée pour la publication d'une ligne (la publication de la session est au scénario 20.26).
2. Examens : ressaisir le résultat de Moussa (« Admis », moyenne `15`) via « Saisir un résultat » : rapport "0 résultat(s) enregistré(s)." avec la ligne "Ce résultat est publié : sa correction passe par une révision approuvée par une autre personne. (examinations.result_revision_required)".
3. Examens : « Corrections » > « Nouvelle demande de correction » : Objet « Un résultat », « Résultat concerné » `COULIBALY Moussa — Admis`, « Résultat proposé » « Admis », « Moyenne proposée » `14,5`, Motif `Moyenne recalculée après vérification du procès-verbal fictif.` > « Envoyer la demande » : « Demande envoyée : une autre personne doit l'approuver. »
4. Examens : renvoyer aussitôt une seconde demande sur Moussa : "Une demande de révision est déjà en attente pour cette cible."
5. Direction : sur la carte de la demande, cliquer « Rejeter » : fenêtre « Rejeter la demande », champ « Motif du rejet », bouton « Rejeter ». Saisir `Moyenne conforme au procès-verbal.` > « Rejeter ». La carte passe à « Rejetée » avec « Décision : » suivi du motif (filtre « Rejetées »).
6. Examens : refaire une demande (Admis, `14,5`, Motif `Correction après seconde vérification du procès-verbal fictif.`) ; direction : « Approuver ». La carte passe à « Approuvée » ; « Notes et résultats » affiche `14,5` pour Moussa, toujours « Publié ».
Résultat attendu : un résultat publié ne change que par une correction approuvée ; chaque décision est visible dans les filtres « Approuvées » / « Rejetées ».
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Demande sur un résultat **non publié** (par exemple `DIABATE Nadia`) | "Un résultat non publié se saisit directement : aucune révision nécessaire." |
| Demande identique à la valeur actuelle (Admis, `14`) | "La valeur proposée est identique à la valeur actuelle." |
| Résultat « Absent » avec une moyenne proposée | "Un absent, exclu ou ajourné n'a pas de moyenne." |
| Résultat non choisi | "Choisissez un résultat." |
| Rejet : motif de 3 caractères | "Le motif doit comporter au moins 5 caractères." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : bouton « Publier » absent pour `examens@`

#### 20.24 Règle des quatre yeux : on n'approuve pas sa propre demande
Comptes : directeur, puis propriétaire · Où : « Corrections », session `Session BEPC test guide`.
1. Direction (`directeur@`) : « Nouvelle demande de correction » > « Une note » > Candidat `KOUASSI Yves test guide`, Épreuve `TG_EP2 — Français test guide`, État « Saisie », Note `12`, Motif `Erreur de report relevée lors du contrôle interne.` > « Envoyer la demande ».
2. Sur la carte (« En attente »), cliquer « Approuver » : bandeau d'erreur "Une révision est approuvée par une autre personne que celle qui l'a demandée." La note de Yves reste `11`. Cliquer « Rejeter » : dans la fenêtre, saisir un motif d'au moins 5 caractères puis « Rejeter » : erreur "Une demande est décidée par une autre personne que celle qui l'a faite."
3. Propriétaire : se connecter avec `direction.generale@secondaire-test.test` (MFA), ouvrir « Corrections » : cliquer « Approuver » sur cette même carte : « Approuvée ». « Notes par épreuve » : Yves affiche `12` en `TG_EP2`.
Résultat attendu : le demandeur est toujours distinct de l'approbateur (contrôle côté serveur : l'approbateur est l'utilisateur connecté, aucun champ ne permet d'en désigner un autre).
Cas invalides : étape 2.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : un compte sans droit de révision ne voit pas « Approuver »

#### 20.25 Statistiques de la session
Comptes : responsable des examens, directeur des études · Où : « Statistiques » (`/v2/examinations/statistics`), session `Session BEPC test guide` · Prérequis : 20.21 à 20.24.
1. Lire le tableau (légende « Statistiques d'examen ») avec les colonnes « Groupe », « Inscrits », « Présents », « Admis », « Refusés », « Absents », « Exclus », « Différés », « Taux ». Avec « Regrouper » = « Ensemble » :
   | Groupe | Inscrits | Présents | Admis | Refusés | Absents | Exclus | Différés | Taux |
   |---|---|---|---|---|---|---|---|---|
   | Ensemble | 6 | 5 | 3 | 1 | 1 | 0 | 1 | 60 % |
   (Présents = admis + refusés + exclus + différés ; le taux de la règle de démonstration est "admis / présents" ; forme exacte du pourcentage à relever en test.)
2. « Regrouper » = « Par sexe » : ligne « Filles » (4 inscrits, 3 présents, 1 admis, 1 refusé, 1 absent, 1 différé, taux voisin de 33,3 %) et « Garçons » (2 inscrits, 2 présents, 2 admis, taux 100 %), puis « Total ». Autres regroupements : « Par établissement », « Par filière », « Par niveau » (libellés de groupe à relever).
3. « Comparer avec » : « L'année précédente » (aucun tableau : il n'existe pas d'édition antérieure de ce type) ; « L'examen blanc » : un second tableau dont le titre commence par "Comparaison : Examen blanc" suivi du libellé de la session blanche `BEPC blanc test guide` (compteurs à zéro tant que 20.34 n'est pas fait ; taux « — »).
4. Textes affichés : "Le taux de réussite est calculé par la règle de l'examen ; le dénominateur est un paramètre de cette règle." et le bandeau « Règles de démonstration » (qui peut apparaître deux fois : écart connu C-10-07).
Résultat attendu : valeurs de l'étape 1 ; les chiffres se recoupent avec l'onglet « Candidats » (colonne « Issue »).
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Cas invalide (sans objet)  - [ ] Droit refusé : un parent ouvrant `/v2/examinations/statistics` est redirigé vers "Accès refusé"

#### 20.26 Publier les résultats de la session (refus du responsable, publication de la direction)
Comptes : responsable des examens, puis directeur · Où : détail de la session · Prérequis : 20.21 (6 résultats) et 20.25. **Irréversible** : ne jamais le faire sur `OFF-DEMO`.
1. Examens : cliquer « Passer à : Résultats publiés » : fenêtre « Publier les résultats » avec le texte « Les résultats de 6 candidat(s) deviennent visibles des familles. Après publication, toute modification passe par une correction approuvée par une autre personne. » et les boutons « Annuler » et « Publier ». Cliquer « Publier » : bandeau d'erreur dans la fenêtre "La publication des résultats exige la permission &laquo; exam.result.publish &raquo;." La session reste « Résultats saisis » (le nom de la permission s'affiche tel quel : écart de présentation). Cliquer « Annuler ».
2. Direction : avec `directeur@secondaire-test.test` (MFA), même chemin ; cliquer « Publier ». Si une fenêtre de seconde vérification apparaît, la valider (à vérifier en test). Message « La session est maintenant : Résultats publiés. » ; avancement 83 % ; « Publiés » 6. Seule l'étape « Passer à : Archivée » reste possible.
3. « Notes et résultats » > « Résultats » : les six lignes affichent « Publié » ; il n'y a plus de bouton « Publier ».
Résultat attendu : tous les brouillons sont publiés en une opération ; les familles voient désormais l'issue (20.28). Pour un type dont la transmission aux admissions est activée (CEPE du primaire), la publication transmet aussi la moyenne aux admissions (lecture côté admissions : autre chapitre).
Cas invalides : étape 1 (permission manquante). Publier avec un candidat inscrit sans résultat : le bouton est désactivé (20.21 étape 4).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : `examens@` (étape 1) ; `etudes@` n'a pas la gestion de session (voir "Écarts constatés")

#### 20.27 Attestations et relevés ; une correction après publication révoque les documents
Comptes : responsable des examens, directeur · Où : « Exports et documents » puis « Corrections » · Prérequis : 20.26.
1. Examens : « Document » = « Attestation de réussite » > « Émettre pour tous les candidats concernés » : "3 document(s) émis, 0 ignoré(s)." (Nadia, Moussa, Yves : résultats « Admis » publiés) et, sous « Lignes refusées », trois lignes "L'attestation de réussite exige un résultat ADMIS publié. (examinations.attestation_requires_admission)" (Salimata, Mariam, Fanta).
2. « Document » = « Relevé de notes » > « Émettre pour tous les candidats concernés » : "6 document(s) émis, 0 ignoré(s)." Relancer : "0 document(s) émis, 6 ignoré(s)." avec six lignes « Un document valide existe déjà. »
3. Télécharger le relevé de `DIABATE Nadia` : le PDF mentionne ses notes (13 et 11), sa moyenne saisie et le filigrane de démonstration (à vérifier visuellement).
4. Correction : examens, « Corrections » > « Un résultat » > `DIABATE Nadia — Admis`, « Résultat proposé » « Admis », « Moyenne proposée » `13`, Motif `Moyenne mise à jour après relecture du procès-verbal fictif.` ; direction : « Approuver ».
5. Retour à « Exports et documents » : "Attestation de réussite v1 — TG_BEPC2027-00001" et "Relevé de notes v1 — TG_BEPC2027-00001" sont à l'état « Révoqué » avec le motif "Résultat corrigé par révision approuvée (demande xxxxxxxx)." ; la convocation de Nadia reste « Émis ».
6. Réémettre : « Attestation de réussite » > lot : "1 document(s) émis, 2 ignoré(s)." (+ trois lignes refusées, comme à l'étape 1) ; « Relevé de notes » > lot : "1 document(s) émis, 5 ignoré(s)." ; les nouveaux documents portent la version 2.
Résultat attendu : un document dépendant d'un résultat corrigé est automatiquement révoqué puis réémis en version suivante.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Attestation individuelle pour un candidat « Refusé » (fiche de `DIABATE Salimata` > « Émettre : Attestation de réussite ») | "L'attestation de réussite exige un résultat ADMIS publié." |
| Émission individuelle d'un document déjà valide | "Ce candidat a déjà un document vivant de cette nature : le révoquer (avec motif) avant d'en émettre un nouveau." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : `parent@` ne voit pas l'écran ; `etudes@` non plus

#### 20.28 Vue famille après publication
Comptes : parent puis élève · Où : `/v2/examinations/family` · Prérequis : 20.27.
1. Parent : carte de `DIABATE Nadia` : « Résultat : » suivi de la pastille « Admis » ; documents « Convocation », « Attestation de réussite », « Relevé de notes » (versions valides seulement, chacune avec « Télécharger ») ; carte de `DIABATE Salimata` : « Résultat : » pastille « Refusé » ; documents « Convocation » et « Relevé de notes ». Aucune note, moyenne ni rang n'est affichée.
2. Élève : carte de `DIABATE Nadia` seule, mêmes informations.
3. Télécharger l'attestation : le PDF s'ouvre.
Résultat attendu : issue visible seulement après publication ; les documents révoqués (v1) ne sont plus listés.
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Cas invalide (sans objet)  - [ ] Droit refusé : `/v2/examinations/candidates` refusé pour le parent et l'élève

#### 20.29 Archiver la session
Compte : responsable des examens · Où : détail de la session · Prérequis : 20.26. **Irréversible.**
1. Cliquer « Passer à : Archivée » : « La session est maintenant : Archivée. » ; avancement 100 % ; « Aucune étape suivante possible. »
2. Constater que les écrans de la session restent consultables et que « Notes par épreuve » et la répartition ne permettent plus de modification (messages de la base à relever en test ; la base annonce "une session archivée est figée" pour les écritures sur la session).
Résultat attendu : session en lecture seule.
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Cas invalide (sans objet)  - [ ] Droit refusé : section « Actions » absente pour `etudes@`

### A.8 Examens blancs et sessions de démonstration

#### 20.30 Examen blanc de démonstration : relire et recalculer
Compte : responsable des examens · Où : « Examens blancs » (`/v2/examinations/mock`), session `Session BLANC-DEMO` · Prérequis : graine du collège.
1. La liste « Session d'examen » ne propose que les sessions blanches (`Session BLANC-DEMO — EXAM_DEMO 2027 (Examen blanc, Épreuves en cours)` et `BEPC blanc test guide`). Choisir `Session BLANC-DEMO`.
2. Lire l'avis "Un examen blanc n'est jamais un résultat officiel : sa moyenne est calculée par la règle, avec la version de règle et l'empreinte des données tracées." et « Évaluations liées » : une ligne "Épreuve 1 (démonstration) ← évaluation <8 premiers caractères d'un identifiant>" avec le bouton « Délier » (**ne pas cliquer**).
3. Section « Calcul » (texte "Reprenez d'abord les notes, puis lancez le calcul par la règle.") : cliquer « Reprendre les notes des évaluations » : "0 note(s) reprise(s), 8 inchangée(s), 0 sans candidat." (les notes **publiées** de l'évaluation « Examen blanc (démonstration) » étaient déjà reprises ; huit élèves notés). Cliquer « Calculer par la règle » : "9 résultat(s) calculé(s), 0 déjà publié(s) ignoré(s)." puis "Règle CI-EXAM-PLACEHOLDER, version `<identifiant>`." et l'avis « Le calcul a utilisé des règles de démonstration. »
4. Relancer les deux boutons : mêmes comptes (calcul reproductible, aucun doublon).
Résultat attendu : le calcul est rejouable tant que rien n'est publié ; la version de règle et l'empreinte sont tracées.
Cas invalides :
| Action | Message attendu |
|---|---|
| « Calculer par la règle » sur `BEPC blanc test guide` tant qu'elle n'est pas « Épreuves en cours » | "Le calcul exige une session en cours ou à résultats saisis (session PLANNED)." (ou `REGISTRATION_OPEN` selon l'avancement) |
| « Reprendre les notes des évaluations » sur la même session | "La saisie des notes n'est ouverte que session en cours ou résultats saisis (session PLANNED)." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : écran refusé pour `etudes@` (adresse `/v2/examinations/mock`)

#### 20.31 Résultats d'un examen blanc : calculés, jamais saisis ni documentés
Compte : responsable des examens · Où : « Notes et résultats » (session `Session BLANC-DEMO`), puis « Exports et documents ».
1. Onglet « Résultats » : 9 lignes, origine « Calculé par règle (examen blanc) », publication « Non publié ». Recompter à la main : Admis 4 (BAMBA Aya 11, BAMBA Fatou 14, COULIBALY Moussa 17, TOURE Jean-Marc 12), Refusé 4, Absent 1 ; rangs 1 à 8 selon les moyennes 17, 14, 12, 11, 9, 8, 6, 5 (relevé QA 10, à recompter). La note de chaque élève est celle de l'évaluation (5, 8, 11, 14, 17, 6, 9, 12) ; la moyenne d'une épreuve unique sur 20 est égale à la note.
2. Dans « Saisir un résultat », choisir un candidat, « Admis » > « Enregistrer le résultat » : bandeau d'erreur "Les résultats d'un examen blanc sont calculés par la règle, jamais saisis." **Ne pas utiliser « Publier »** sur un résultat d'examen blanc.
3. Sur la fiche d'un candidat de l'examen blanc, les notes portent l'origine « Évaluations (assess) ».
4. « Exports et documents » > `Session BLANC-DEMO` : dans « Documents », le message « Un examen blanc ne donne lieu à aucun document officiel. » remplace les boutons d'émission.
Résultat attendu : aucun document officiel, aucune saisie manuelle de résultat pour un examen blanc.
Cas invalides : étape 2.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : bouton « Publier » absent pour `examens@`

#### 20.32 Statistiques des sessions de démonstration et comparaison avec l'examen blanc
Compte : responsable des examens · Où : « Statistiques », sessions `Session BLANC-DEMO` puis `Session OFF-DEMO`.
1. `Session BLANC-DEMO`, « Regrouper » = « Ensemble » : Inscrits 9, Présents 8, Admis 4, Refusés 4, Absents 1, Exclus 0, Différés 0, Taux `50 %` (4 admis sur 8 présents). L'option « Comparer avec » n'offre que « L'année précédente » (« L'examen blanc » est réservé aux sessions officielles).
2. `Session OFF-DEMO` : tous les compteurs à 0 (aucun inscrit, aucun résultat) ; « Comparer avec » = « L'examen blanc » : second tableau dont le titre commence par "Comparaison : Examen blanc" suivi de `Session BLANC-DEMO`, avec les chiffres de l'étape 1.
3. « Regrouper » = « Par sexe » sur BLANC-DEMO : lignes « Filles » et « Garçons » dont la somme redonne l'ensemble (garçons attendus : COULIBALY Moussa, TOURE Yao, TOURE Jean-Marc, soit 3 inscrits, 3 présents, 2 admis, taux voisin de 66,7 % ; filles à recompter).
Résultat attendu : chiffres identiques à ceux recomptés au scénario 20.31.
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Cas invalide (sans objet)  - [ ] Droit refusé : statistiques refusées pour parent et élève

#### 20.33 Imports et exports sans format publié (collège)
Compte : responsable des examens · Où : « Imports » (`/v2/examinations/imports`) et « Exports et documents » · Prérequis : graine du collège (aucun format).
1. « Imports » : la liste « Session d'examen » ne propose que les sessions **officielles** (`Session OFF-DEMO`, `Session BEPC test guide`). Après choix de `Session OFF-DEMO` : avis "Un import est analysé ligne par ligne avant d'être appliqué ; l'application est atomique et le fichier d'origine est conservé avec son empreinte.", bloc « Déposer un fichier » avec « Contenu du fichier » (défaut « Résultats » ; « Numéros officiels », « Notes ») et « Format du fichier » (liste « Choisir un format », aide « Aucun format publié pour ce contenu. »), texte « Choisissez d'abord le format du fichier. » et zone de dépôt inactive ; « Fichiers déposés » : « Aucun fichier déposé » / « Déposez le premier fichier de la session. ».
2. « Exports et documents » (session OFF-DEMO) : « Aucun format publié. ».
Résultat attendu : les écrans se chargent mais ne sont pas exploitables au collège : aucun format d'import ou d'export n'est livré et aucun écran ne permet d'en créer (voir "Écarts constatés"). Les fonctions d'import et d'export se testent au primaire (partie B) grâce au pack CEPE.
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Cas invalide (sans objet)  - [ ] Droit refusé : `/v2/examinations/imports` refusé pour `etudes@`

#### 20.34 Session d'examen blanc créée par le guide : figer, ouvrir, inscrire, lier une évaluation
Compte : responsable des examens · Où : détail de `BEPC blanc test guide`, « Candidats », « Examens blancs » · Prérequis : 20.7 (session blanche en « Planifiée »).
1. Détail de `BEPC blanc test guide` : constater le point bloquant du scénario 20.8, cliquer « Copier et figer la définition » (« Définition copiée : 3 épreuve(s). ») puis « Passer à : Inscriptions ouvertes ». Les liens « Écrans de la session » incluent « Examen blanc » et ne comprennent pas « Imports ».
2. « Candidats », session `BEPC blanc test guide` : un avis remplace le bloc des candidats libres ("Les candidats libres ne concernent que les sessions officielles."). « Ajouter les élèves d'une classe » > `6e A` > « Ajouter les élèves » : « 9 candidat(s) ajouté(s), 0 déjà présent(s). ». Cliquer « Sélectionner la page » puis « Inscrire la sélection (9) » : « 9 candidat(s) inscrit(s). » (un examen blanc n'exige ni éligibilité évaluée ni pièces). Les numéros repartent de `TG_BEPC2027-00001` (compteur propre à la session).
3. « Examens blancs » > `BEPC blanc test guide` : « Aucune évaluation liée » / « Liez une évaluation de classe à chaque épreuve de l'examen blanc. ». Bloc « Lier une évaluation » : « Épreuve » `TG_EP1 — Mathématiques test guide`, « Classe » `6e A`, « Évaluation » (aide "Évaluations de la classe choisie.") : option `Examen blanc (démonstration) — <date> (/20)`. Cliquer « Lier l'évaluation » : bandeau d'erreur "Cette évaluation alimente déjà une épreuve." (elle alimente `Session BLANC-DEMO`).
4. Choisir l'épreuve `TG_EP3 — Épreuve de série A test guide` (barème 10) avec la même évaluation (barème 20) : "Le barème de l'évaluation (…) diffère de celui de l'épreuve (…) : aucune conversion silencieuse." (valeurs numériques à relever).
5. Choisir une évaluation d'un autre type que celui d'examen blanc (par exemple une composition de la 6e A) : "Seule une évaluation de type &laquo; examen blanc &raquo; (non visible des élèves) se lie à une épreuve d'examen blanc."
6. Lier une évaluation valide : non couvert ici (voir "Non couvert / limites connues").
Résultat attendu : session blanche inscrite, trois refus de liaison lisibles. La comparaison de 20.25 (« L'examen blanc ») affiche désormais 9 inscrits pour cette session.
Cas invalides : étapes 3 à 5.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : écran « Examens blancs » refusé pour `etudes@`

---

## Partie B. École primaire Les Palmiers : type CEPE (fictif), candidats libres, import des résultats de l'autorité

Établissement : `primaire-test`. Comptes : `examens@primaire-test.test` (sans MFA), `directeur@primaire-test.test` (MFA), `parent@primaire-test.test`. La graine ne crée **aucune donnée d'examen** au primaire. Aucune règle d'éligibilité ni de calcul n'est liée à ce pack (la liaison `CI-EXAM-PLACEHOLDER` n'est posée que pour le pack Secondaire, source : `apps/api/src/modules/rules/subscribers.ts`) : l'éligibilité se **saisit à la main** (avec l'auteur), le "taux de réussite" n'est pas calculé et il n'existe aucun examen blanc calculable. Noms créés : centre `TG-CTRP` "Centre Les Palmiers test guide", session `TG-CEPE-2027` "CEPE 2027 test guide", candidats libres du fichier CSV (suffixe "test guide").

#### 20.35 Charger le type CEPE fictif
Compte : responsable des examens (École Les Palmiers) · Où : « Sessions » puis « Types d'examens » (`/v2/examinations/types`).
1. Ouvrir `/v2/examinations` : « Aucune session d'examen » avec « Créez une session à partir d'un type d'examen. ».
2. Ouvrir « Types d'examens » : « Aucun type d'examen » avec « Chargez le pack du primaire ou créez un type. ».
3. Cliquer « Charger le pack du primaire (fictif) » : « Pack chargé : 1 type(s) créé(s), 0 déjà présent(s). » et un avis d'alerte "Données et règles de démonstration (fictives) : aucune valeur officielle."
4. Carte `CEPE — CEPE (données fictives de démonstration)` avec « Démonstration » et « Actif ». « Afficher le détail » : « Contrat de résultat » `exam-national@1`, « Modèle du numéro de candidat » `{TYPE}{YEAR}-{SEQ:5}`, « Niveau d'enseignement » `PRIMARY`, « Source » « Démonstration (fictif) » ; « Filières » (« Aucune filière. ») ; « Épreuves » : `EP1` "Épreuve 1 (fictive)" coefficient 1 barème 20, `EP2` "Épreuve 2 (fictive)" coefficient 2 barème 20, `EP3` "Épreuve 3 (fictive)" coefficient 1 barème 10 ; « Pièces à fournir » : "Acte de naissance (pièce fictive)" (obligatoire) ; « Transmission aux admissions » : case « Transmettre le résultat et la moyenne aux admissions » **cochée** (activée dans le modèle du pack).
5. Cliquer de nouveau « Charger le pack du primaire (fictif) » : « Pack chargé : 0 type(s) créé(s), 1 déjà présent(s). » (idempotent, le type n'est pas dupliqué).
Résultat attendu : un type CEPE avec ses trois épreuves, sa pièce et deux formats d'export + un format d'import fictifs (vérifiés aux scénarios 20.39 et 20.40).
Cas invalides : sans objet. Le type n'est pas modifiable par ce bouton une fois créé.
- [ ] Cas nominal  - [ ] Cas invalide (sans objet)  - [ ] Droit refusé : `parent@primaire-test.test` sur `/v2/examinations/types` : "Accès refusé"

#### 20.36 Créer le centre et la session CEPE
Compte : responsable des examens · Où : « Centres et salles » puis « Sessions » > « Nouvelle session » · Prérequis : 20.35.
1. « Centres et salles » > « Nouveau centre » : Code `TG-CTRP`, Nom `Centre Les Palmiers test guide`, Nature « Centre propre », Localité `Yopougon, Abidjan` > « Créer le centre ». Puis « Ajouter une salle » deux fois : `P1` / `Salle P1 test guide` / `4` et `P2` / `Salle P2 test guide` / `2`.
2. « Sessions » > « Nouvelle session » : Type d'examen `CEPE — CEPE (données fictives de démonstration)`, Nature « Officiel », Code `TG-CEPE-2027`, Libellé `CEPE 2027 test guide`, Année de la session `2027`, Début des épreuves `2027-06-02` > « Créer la session ».
3. Détail : sous-titre `CEPE (données fictives de démonstration) 2027 — Officiel`, bandeau « Règles de démonstration ». « Copier et figer la définition » : « Définition copiée : 3 épreuve(s). ». « Passer à : Inscriptions ouvertes ».
Résultat attendu : session « Inscriptions ouvertes », trois épreuves `EP1`, `EP2`, `EP3`.
Cas invalides : mêmes que 20.6 et 20.7 (formats de code, doublons). Code de session en doublon : "Ce code de session existe déjà pour cet établissement."
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : `/v2/examinations/centers` refusé pour `parent@primaire-test.test`

#### 20.37 Candidats du CEPE : refus des élèves sans règle, candidats libres, pièce vue sur place, inscription
Compte : responsable des examens · Où : « Candidats » (`/v2/examinations/candidates`), session `CEPE 2027 test guide` · Prérequis : 20.36.
*A. Garde-fous pour un élève (sans règle liée).*
1. « Ajouter les élèves d'une classe » > `CP1 A` > « Ajouter les élèves » (les élèves du CP1 ne sont pas la cible naturelle d'un CEPE : l'essai sert à lire les garde-fous) : « `<n>` candidat(s) ajouté(s), 0 déjà présent(s). ».
2. « Évaluer l'éligibilité de tous » : bandeau d'erreur "Aucune version de la règle d'éligibilité n'est épinglée à cette session : évaluation automatique impossible (saisie manuelle de l'éligibilité avec auteur, ou nouvelle session une fois la règle liée)."
3. Fiche d'un élève (par exemple `DIABATE Nadia`) : « Inscrire le candidat » : "l'éligibilité doit être établie avant l'inscription (statut NOT_EVALUATED)". « Saisir à la main » : Résultat « Éligible », Motifs vide, « Enregistrer » : l'historique affiche « Saisie à la main » et la pastille « Éligible ». « Inscrire le candidat » : "pièces non acceptées : …" (la pièce exigée n'est pas acceptée). « Joindre un document » ouvre la fenêtre de dépôt de la pièce (aide "Le document est choisi parmi les documents de l'établissement.") ; un document appartenant à l'élève est requis : non couvert ici.
*B. Candidats libres (parcours complet).*
4. « Importer un fichier CSV » > `20-examens-candidats-libres.csv` > « Importer 6 candidat(s) » : "6 candidat(s) libre(s) enregistré(s)." (ce fichier est valable ici : les candidats libres existent en session officielle du primaire).
5. Pour **chacun des quatre candidats suivants, dans cet ordre** : `KONE Mariam test guide`, `TRAORE Seydou test guide`, `YAO Adjoua test guide`, `DIABATE Ibrahim test guide` : ouvrir la fiche et
   - « Saisir à la main » > Résultat « Éligible » > « Enregistrer » (pas de règle liée : la saisie manuelle est autorisée) ;
   - section « Pièces du dossier » : la pièce "Acte de naissance (pièce fictive)" (obligatoire) est « Manquante » ; au premier candidat, essayer « Inscrire le candidat » : "pièces non acceptées : …" ;
   - cliquer « Pièce vue sur place » : l'état devient "Déposée (vue sur place)" avec les boutons « Accepter » et « Refuser » ; cliquer « Accepter » : "Acceptée (vue sur place)" ;
   - « Inscrire le candidat » : « Candidat inscrit, numéro CEPE2027-0000N. » avec N = 1, 2, 3, 4 dans l'ordre ci-dessus (compteur propre à la session).
6. Fiche de `BAMBA Fanta test guide` : « Saisir à la main » > « Éligible » ; « Pièce vue sur place » puis « Refuser » : fenêtre « Refuser la pièce » (titre contenant le nom de la pièce), champ « Motif du refus », bouton « Refuser la pièce » ; saisir `Pièce illisible, à représenter` : l'état devient "Refusée (vue sur place) — Pièce illisible, à représenter" ; « Inscrire le candidat » est refusé ("pièces non acceptées : …"). Cette candidate reste « Brouillon ».
Résultat attendu : 4 candidats libres « Inscrit » (numéros `CEPE2027-00001` à `00004`) ; les 2 autres du fichier (`BAMBA Fanta`, `COULIBALY Karim`) et les élèves du CP1 restent « Brouillon » ; le détail de session affiche « Inscrits » 4.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Refus de pièce : motif de 2 caractères | "Le motif doit comporter au moins 3 caractères." |
| « Accepter » une pièce « Manquante » | le bouton n'est proposé que pour une pièce « Déposée » |
| Importer un élève CP1 sans pièce acceptée | "pièces non acceptées : …" |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : boutons « Pièce vue sur place », « Accepter », « Refuser » absents pour un compte sans `exam.candidate.manage` (par exemple `etudes@`, collège)

#### 20.38 Répartir les candidats du CEPE et émettre les convocations
Compte : responsable des examens · Où : « Répartition », puis détail de session, puis « Exports et documents » · Prérequis : 20.37.
1. « Répartition » (session CEPE) : « Inscrits » 4, « Capacité » 0 avant rattachement. Cocher `TG-CTRP — Centre Les Palmiers test guide` > « Enregistrer les centres » ; « Capacité » 6 ; « Répartir automatiquement » : « 4 candidat(s) placé(s), 0 déjà placé(s). » (salle `P1`, places 1 à 4).
2. Détail de session : « Passer à : Inscriptions closes ».
3. « Exports et documents » > « Document » « Convocation » > « Émettre pour tous les candidats concernés » : "4 document(s) émis, 0 ignoré(s)." Télécharger une convocation : PDF avec le filigrane de démonstration (à vérifier).
Résultat attendu : quatre convocations « Émis ».
Cas invalides : voir 20.15 (capacité) et 20.17 (échec de convocation sans place).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : sans objet

#### 20.39 Importer les résultats communiqués par l'autorité (trois fichiers)
Comptes : responsable des examens, puis directeur (MFA), puis responsable des examens, puis directeur · Où : « Imports » (`/v2/examinations/imports`), session `CEPE 2027 test guide` · Prérequis : 20.38 (4 candidats inscrits n° 00001 à 00004). Fichiers : `20-examens-resultats-cepe-entete-invalide.csv`, `20-examens-resultats-cepe-erreurs.csv`, `20-examens-resultats-cepe.csv` (descriptions en fin de chapitre). Si les numéros relevés au scénario 20.37 diffèrent de `CEPE2027-00001` à `00004`, remplacer la colonne NUMERO dans un tableur avant l'envoi.
1. Choisir la session (la liste ne propose que les sessions officielles). Bloc « Déposer un fichier » : « Contenu du fichier » = « Résultats » ; « Format du fichier » = `Résultats de l'autorité (format fictif) (v1) — démonstration`. La zone de dépôt affiche "Glissez un fichier ici, ou appuyez sur Entrée pour le choisir" avec "Formats : csv, txt, xlsx." et "Taille maximale : 5 Mio.". Sans format choisi, elle est inactive.
2. **Fichier à l'en-tête invalide** : déposer `20-examens-resultats-cepe-entete-invalide.csv`. Un lot "20-examens-resultats-cepe-entete-invalide.csv" apparaît dans « Fichiers déposés » (état « Déposé ») et son détail s'ouvre : "0 ligne(s) : 0 valide(s), 0 en erreur." et l'empreinte SHA-256. Cliquer « Analyser le fichier » : avis d'erreur "La colonne "DECISION" est absente de l'en-tête du fichier." (texte de l'API, avec ses guillemets) ; état « Rejeté » ; aucune ligne.
3. **Fichier avec des erreurs** : déposer `20-examens-resultats-cepe-erreurs.csv`, « Analyser le fichier » : état « Rejeté » ; "7 ligne(s) : 1 valide(s), 6 en erreur." ; « Erreurs par nature » : "Code de résultat inconnu. : 1", "Moyenne invalide. : 1", "Candidat inconnu dans cette session. : 1", "Clé présente plusieurs fois dans le fichier. : 1", "Une valeur est donnée alors que le résultat n'en admet pas. : 1", "Clé d'identification manquante. : 1" ; tableau « Lignes en erreur » (colonnes « Ligne », « Erreur », « Candidat ») avec les lignes 3 à 8. Aucun bouton « Appliquer l'import » n'est proposé pour un lot rejeté.
4. **Fichier valide** : déposer `20-examens-resultats-cepe.csv`, « Analyser le fichier » : état « Analysé » ; "4 ligne(s) : 4 valide(s), 0 en erreur." ; avis "Colonnes ignorées : OBSERVATION." Pour ce compte, aucun bouton « Appliquer l'import » (réservé à la direction).
5. Redéposer le même fichier valide : bandeau d'erreur sous la zone de dépôt "Ce fichier a déjà été importé pour cette session."
6. Direction : se connecter avec `directeur@primaire-test.test`, ouvrir « Imports », session CEPE, lot valide (« Ouvrir ») : bouton « Appliquer l'import ». Le cliquer **maintenant** (session « Inscriptions closes ») : bandeau d'erreur "L'application exige une session en cours ou à résultats saisis (session REGISTRATION_CLOSED)."
7. Examens : détail de session > « Passer à : Épreuves en cours ». Direction : « Appliquer l'import » : « Import appliqué. » ; le lot passe à « Appliqué » et ne propose plus aucune action. (Action sensible : une fenêtre de seconde vérification peut s'ouvrir, à vérifier en test.)
8. « Notes et résultats » > « Résultats » (session CEPE) : quatre lignes, origine « Importé de l'autorité », publication « Non publié » :
   | Numéro | Candidat | Résultat | Moyenne |
   |---|---|---|---|
   | CEPE2027-00001 | KONE Mariam test guide | Admis | 14,5 |
   | CEPE2027-00002 | TRAORE Seydou test guide | Admis | 11,25 |
   | CEPE2027-00003 | YAO Adjoua test guide | Refusé | 8,75 |
   | CEPE2027-00004 | DIABATE Ibrahim test guide | Absent | — |
Résultat attendu : l'application est atomique (tout ou rien) ; un lot en erreur ne s'applique jamais ; l'admission est celle du fichier de l'autorité (aucun calcul).
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Fichier à l'en-tête invalide | "La colonne &laquo; DECISION &raquo; est absente de l'en-tête du fichier." |
| Fichier avec erreurs | lot « Rejeté », 6 erreurs listées (étape 3) |
| Même fichier redéposé | "Ce fichier a déjà été importé pour cette session." |
| Application hors des états « Épreuves en cours » ou « Résultats saisis » | "L'application exige une session en cours ou à résultats saisis (session REGISTRATION_CLOSED)." |
| Fichier de 0 octet | message de la zone de dépôt "Le fichier "`<nom>`" est vide." (aucun envoi) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : « Appliquer l'import » absent pour `examens@` ; `/v2/examinations/imports` refusé pour un compte sans `exam.import.manage`

#### 20.40 Exports du CEPE avec les formats fictifs
Compte : responsable des examens · Où : « Exports et documents » (session CEPE) · Prérequis : 20.39.
1. Section « Exports » : « Format d'export » propose `Liste des candidats (format fictif) (CSV, v1) — démonstration` et `Résultats (format fictif) (CSV, v1) — démonstration`.
2. Choisir le premier format > « Lancer l'export » : une ligne `LISTE_CANDIDATS_FICTIF v1` apparaît dans « Exports réalisés » avec l'état « Terminé », le nombre de lignes ("`<n>` ligne(s)"), l'empreinte SHA-256 et un bouton « Télécharger » (un nouvel onglet s'ouvre sur un lien signé de courte durée ; à vérifier : le stockage d'objets doit être branché). Le bouton « Actualiser la liste » relit la liste.
3. Contenu attendu du fichier : en-tête `NUMERO;NOM;PRENOMS;NAISSANCE;LIEU_NAISSANCE;SEXE;CODE_CEPE` ; le nom en **majuscules** (`KONE`), la naissance au format jour/mois/année (`12/03/2014`), le sexe `F` ou `M`, `CODE_CEPE` vide ; une ligne par candidat exporté (liste des candidats inscrits, brouillons inclus ou non : à relever).
4. Second format > « Lancer l'export » : en-tête `NUMERO;NUMERO_OFFICIEL;DECISION;MOYENNE;EP1;EP2;EP3`, quatre lignes (candidats ayant un résultat), `DECISION` en code (`ADMITTED`, `FAILED`, `ABSENT`), moyenne avec virgule décimale (`14,5`), colonnes de notes vides (aucune note d'épreuve n'a été saisie ici).
Résultat attendu : aucune cellule de texte commençant par `=`, `+`, `-` ou `@` n'est exécutable (neutralisation de formule) ; empreinte et effectif tracés.
Cas invalides :
| Action | Message attendu |
|---|---|
| « Lancer l'export » sans format | le bouton est désactivé |
| Export sur une session d'un autre type que celui du format | non proposé (le format n'est listé que pour son type) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : section « Exports » absente pour un compte ayant seulement l'émission de documents

#### 20.41 Publier le CEPE, statistiques sans taux, attestations
Comptes : responsable des examens, directeur · Où : détail de session, « Statistiques », « Exports et documents » · Prérequis : 20.39 (4 résultats non publiés). **Irréversible.**
1. Examens : « Passer à : Résultats saisis » (aucun point bloquant : 4 inscrits, 4 résultats).
2. « Statistiques » : avis d'alerte "Aucune version de la règle &laquo; taux de réussite &raquo; n'est épinglée à cette session : seuls les compteurs sont fournis." ; ligne « Ensemble » : Inscrits 4, Présents 3, Admis 2, Refusés 1, Absents 1, Exclus 0, Différés 0, Taux « — ». Le bandeau « Règles de démonstration » est présent.
3. Direction : « Passer à : Résultats publiés » > fenêtre « Publier les résultats » (texte "Les résultats de 4 candidat(s) deviennent visibles des familles. …") > « Publier ».
4. Examens : « Attestation de réussite » > lot : "2 document(s) émis, 0 ignoré(s)." avec deux lignes refusées ("L'attestation de réussite exige un résultat ADMIS publié.") pour YAO Adjoua (Refusé) et DIABATE Ibrahim (Absent) ; « Relevé de notes » > lot : "4 document(s) émis, 0 ignoré(s)."
5. Transmission aux admissions : le type CEPE transmet "admis / non admis" et la moyenne aux admissions à la publication, **uniquement pour les élèves** ("ni examen blanc, ni candidat libre" d'après le module) ; ici les quatre candidats sont libres : rien n'est transmis. La lecture côté admissions est au chapitre des admissions (écran « Résultat d'examen (CEPE vers l'admission en 6e) »).
6. `parent@primaire-test.test` : `/v2/examinations/family` affiche « Aucun examen » (« Aucune inscription à un examen n'est enregistrée. ») : aucun élève de la famille n'est candidat inscrit.
Résultat attendu : valeurs ci-dessus ; session « Résultats publiés ».
Cas invalides : étape 1 de 20.26 (le responsable ne peut pas publier).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : `examens@` ne publie pas

---

## Partie C. Université Horizon (supérieur)

#### 20.42 Le supérieur n'a pas de parcours d'examen
Comptes : `examens@superieur-test.test`, `directeur@superieur-test.test` · Où : `/v2/examinations`, `/v2/examinations/types`, `/v2/examinations/centers` · Vérifié dans le code : le module est déclaré pour les trois packs (`examinations.core`, `.mock`, `.exports` incluent `HIGHER`, source : `apps/api/src/modules/examinations/manifest.ts`), mais **aucune donnée d'examen n'est livrée** (la graine `scripts/seed-v2/demo/index.ts` n'appelle `seedExams` que pour le Secondaire), **aucun type** BTS, licence ou LMD n'existe (le BTS est renvoyé aux spécifications 020 et 021, après la première version) et **aucune règle d'examen n'est liée** au pack supérieur. Les évaluations semestrielles et les rattrapages du supérieur relèvent des chapitres résultats et supérieur, pas de ce module.
1. Se connecter avec `examens@superieur-test.test`, ouvrir `/v2/examinations` : « Aucune session d'examen » avec « Créez une session à partir d'un type d'examen. » (l'entrée de menu « Examens » doit exister ; à vérifier en test selon l'abonnement du supérieur).
2. « Types d'examens » : « Aucun type d'examen » ; « Centres et salles » : « Aucun centre d'examen ». Les boutons de création sont proposés mais le module n'a pas de parcours documenté au supérieur : ne rien créer. Le bouton « Charger le pack du primaire (fictif) » est proposé aussi à l'université (écart de présentation, voir "Écarts constatés").
3. Parent et élève du supérieur : `/v2/examinations/family` affiche « Aucun examen ».
Résultat attendu : écrans vides sans erreur ; aucune erreur de serveur (code 500) dans la console.
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Cas invalide (sans objet)  - [ ] Droit refusé : sans objet

---

## Partie D. Droits, isolation et qualité transversale

#### 20.43 Adresses interdites, isolation entre établissements, clavier et états
Comptes : voir le tableau · Où : barre d'adresse du navigateur, après connexion.
1. Pour chaque ligne : se connecter avec le compte, taper l'adresse complète (`http://localhost:3000` + chemin). Résultat attendu pour toutes : redirection vers `/unauthorized`, page "Accès refusé" avec "Vous n'avez pas les droits nécessaires pour afficher cette page." et un lien vers l'accueil ; aucune donnée d'examen visible, aucune erreur 500 dans la console (un 403 sur des requêtes annexes du menu est possible).
   | Compte | Adresses à taper |
   |---|---|
   | `enseignant@secondaire-test.test` | `/v2/examinations`, `/v2/examinations/types`, `/v2/examinations/candidates`, `/v2/examinations/family` |
   | `secretariat@secondaire-test.test` | `/v2/examinations`, `/v2/examinations/results`, `/v2/examinations/exports` |
   | `econome@secondaire-test.test` (n'a que la lecture des frais d'examen) | `/v2/examinations`, `/v2/examinations/candidates` |
   | `parent@secondaire-test.test` | `/v2/examinations`, `/v2/examinations/results`, `/v2/examinations/centers`, `/v2/examinations/candidates`, `/v2/examinations/statistics` |
   | `eleve@secondaire-test.test` | `/v2/examinations/types`, `/v2/examinations/corrections`, `/v2/examinations/mock` |
   | `etudes@secondaire-test.test` | `/v2/examinations/centers`, `/v2/examinations/imports`, `/v2/examinations/mock`, `/v2/examinations/exports`, `/v2/examinations/family` |
   | `examens@secondaire-test.test` | `/v2/examinations/family` |
   | (aucun compte connecté) | `/v2/examinations` : redirection vers `/login` |
2. **Isolation entre établissements** : copier l'identifiant de la session `Session BEPC test guide` depuis son adresse (`/v2/examinations/sessions/<id>`) et celui d'une fiche candidat du collège (`/v2/examinations/candidates/<id>`). Connecté en `directeur@primaire-test.test`, ouvrir `/v2/examinations/sessions/<id du collège>` : bandeau d'erreur "Session d'examen introuvable (`<id>`)." ; ouvrir `/v2/examinations/candidates/<id du collège>` : "Candidat introuvable (`<id>`)." (le message exact reste à relever en test ; aucune donnée du collège n'est visible).
3. **Menus** (entrées de menu fournies par l'API, selon le droit) : `examens@` voit « Examens », "Candidats aux examens", « Centres et salles », « Examens blancs », "Résultats d'examen", "Statistiques d'examen", "Exports d'examen", "Corrections d'examen" ; `etudes@` ne voit ni « Centres et salles », ni « Examens blancs », ni "Exports d'examen" ; le parent voit « Examens de mes enfants » ; l'élève voit « Mon examen ». Les enseignants, le secrétariat, l'économe n'ont aucune entrée d'examen.
4. **Clavier** : sur « Candidats », « Répartition » et la fiche d'un candidat, atteindre au clavier (touche Tab) les boutons, les cases à cocher, les listes ; ouvrir une fenêtre (« Nouveau centre », « Retirer le candidat ») et la fermer avec Échap ; le focus reste dans la fenêtre tant qu'elle est ouverte ; les tableaux défilants sont atteignables au clavier.
5. **États** : pendant le chargement le texte « Chargement… » s'affiche (la première visite d'un écran d'examen peut durer une vingtaine de secondes en mode développement) ; une liste vide affiche un titre et une aide en français ; une erreur serveur affiche un bandeau avec le bouton « Réessayer ».
Résultat attendu : tous les refus ci-dessus ; isolation stricte ; libellés en français (hors codes signalés dans "Écarts constatés").
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Cas invalide (sans objet)  - [ ] Droit refusé (c'est l'objet du scénario)

---

## Fichiers d'import fournis (`docs/guide-test/jeux-de-donnees/`)

Tous en UTF-8, séparateur `;`, données fictives. Les contrôles "attendus" ont été recoupés avec le code d'analyse (`external-csv.ts` côté écran, `domain/import-parse.ts` côté API et le format `RESULTATS_IMPORT_FICTIF` du pack CEPE).

| Fichier | Où l'utiliser | Contenu | Résultat attendu |
|---|---|---|---|
| `20-examens-candidats-libres.csv` | Scénarios 20.12 et 20.37 (« Importer un fichier CSV ») | 6 lignes valides, en-tête complet de 16 colonnes : KONE Mariam (pièce `EXTRAIT_NAISSANCE` n° `EN-TG-0001`, tuteur, né le 2014-03-12), TRAORE Seydou, YAO Adjoua (contact par le tuteur seulement), DIABATE Ibrahim, BAMBA Fanta (`classe_examen` = non, 2 tentatives), COULIBALY Karim | "20-examens-candidats-libres.csv : 6 ligne(s) valide(s), 0 ligne(s) à corriger." puis "6 candidat(s) libre(s) enregistré(s)." ; avec la règle du collège, BAMBA Fanta est « Non éligible » (motif `NOT_IN_EXAM_GRADE`) et les cinq autres « Éligible » ; les prénoms se terminent par "test guide" |
| `20-examens-candidats-libres-erreurs.csv` | Scénario 20.12 | 8 lignes : 2 valides (lignes 2 et 9, **même identité** SORO Aya) et 6 lignes fautives, une par motif (nom absent, date `12/03/2014`, sexe `X`, classe d'examen `peut-être`, tentatives `abc`, aucun contact) | Résumé "2 ligne(s) valide(s), 6 ligne(s) à corriger." avec les lignes 3 à 8 expliquées ; envoi de 2 : 1 créée, 1 refusée comme doublon d'identité |
| `20-examens-candidats-libres-entetes.csv` | Scénario 20.12 | Une ligne de données, colonnes `nom;prenoms;naissance;sexe;remarque` (sans `classe_examen`) | "Colonnes obligatoires absentes : classe_examen." et "Colonnes ignorées : remarque." ; aucun envoi possible |
| `20-examens-resultats-cepe.csv` | Scénario 20.39 (« Imports », format `Résultats de l'autorité (format fictif)`) | En-tête `NUMERO;DECISION;MOYENNE;OBSERVATION`, 4 lignes : `CEPE2027-00001` ADMIS 14,50 ; `00002` ADMIS 11,25 ; `00003` AJOURNE 8,75 ; `00004` ABSENT sans moyenne | Après « Analyser le fichier » : état « Analysé », "4 ligne(s) : 4 valide(s), 0 en erreur.", "Colonnes ignorées : OBSERVATION." ; après application par la direction : Admis 14,5 / Admis 11,25 / Refusé 8,75 / Absent (voir 20.39) |
| `20-examens-resultats-cepe-erreurs.csv` | Scénario 20.39 | 7 lignes sur `NUMERO;DECISION;MOYENNE` : 1 valide, puis décision `REUSSI`, moyenne `abc`, numéro inconnu `CEPE2027-00099`, clé en double, valeur donnée à un ABSENT, clé vide | Lot « Rejeté » : "7 ligne(s) : 1 valide(s), 6 en erreur." ; six natures d'erreur listées ; jamais appliqué |
| `20-examens-resultats-cepe-entete-invalide.csv` | Scénario 20.39 | En-tête `NUMERO;RESULTAT;MOYENNE` (la colonne `DECISION` attendue par le format est absente), 2 lignes | « Rejeté » dès l'analyse : "La colonne &laquo; DECISION &raquo; est absente de l'en-tête du fichier." |

Aucun format d'import ou d'export n'est livré pour le collège : seuls ces fichiers du primaire (CEPE) s'importent. Le module n'a pas d'import de notes ni de numéros officiels prêt à l'emploi (aucun format publié pour ces natures).

---

## Données créées

(Reprises dans `docs/guide-test/_annexe-fragments/20-examens.md`.)

**Collège Le Baobab** : type `TG_BEPC` « BEPC test guide (démonstration) » (filière `TGA` "Série A test guide" ; épreuves `TG_EP1` "Mathématiques test guide", `TG_EP2` "Français test guide", `TG_EP3` "Épreuve de série A test guide") ; centre `TG-CTR1` "Centre Cocody test guide" (salles `S1` 3 places, `S2` 2 places, `S3` 2 places) ; sessions `TG-BEPC-2027` "Session BEPC test guide" (officielle, jusqu'à « Archivée ») et `TG-BLANC-2027` "BEPC blanc test guide" (examen blanc, « Inscriptions ouvertes », 9 candidats inscrits) ; candidats libres "KOUASSI Yves test guide", "SORO Aya test guide" et ceux du fichier CSV (KONE Mariam, TRAORE Seydou [retiré], YAO Adjoua, DIABATE Ibrahim, BAMBA Fanta, COULIBALY Karim [anonymisé]) ; candidats élèves de la 6e A dans les deux sessions ; numéros `TG_BEPC2027-00001` à `00006` (session officielle : Nadia, Salimata, Moussa, Yves, Mariam, Fanta) ; identifiant officiel `TG-OFF-0001` (Nadia) ; convocations, attestations, relevés (certains révoqués) ; demandes de correction (3 approuvées, 1 rejetée, 1 refusée comme doublon non créée) ; places attribuées.

**École Les Palmiers** : type `CEPE` (pack fictif) ; centre `TG-CTRP` "Centre Les Palmiers test guide" (salles `P1` 4 places, `P2` 2 places) ; session `TG-CEPE-2027` "CEPE 2027 test guide" (jusqu'à « Résultats publiés ») ; candidats élèves du CP1 A (brouillons) et six candidats libres ; numéros `CEPE2027-00001` à `00004` ; lots d'import (un « Rejeté » pour l'en-tête, un « Rejeté » pour erreurs, un « Appliqué ») ; exports et documents émis.

Nettoyage : aucun de ces enregistrements ne se supprime depuis les écrans (types, sessions, candidats, documents et lots sont conservés pour l'historique) ; `pnpm demo:reset` remet la démonstration à zéro.

## Écarts constatés

Constats issus de la lecture du code, des messages `fr-CI.json` et des rapports QA ; à confirmer à l'écran quand c'est indiqué.

| Écran | Constat | Gravité |
|---|---|---|
| Imports, Exports et documents (collège) | La graine ne livre aucun format d'export ni d'import (`scripts/seed-v2/demo/exams.ts`) et aucun écran ne permet de créer ou publier un format (API seulement) : au collège ces fonctions sont inutilisables (constat C-10-05 du rapport QA 10, toujours ouvert dans la graine). Seul le pack CEPE du primaire fournit des formats. | Majeur |
| Fiche candidat (directeur des études) | Le rôle `directeur_etudes` détient `exam.eligibility.override` mais pas `exam.eligibility.evaluate` ; or le bouton « Accorder une dérogation » est imbriqué dans le bloc réservé à `exam.eligibility.evaluate` (`CandidateDetailScreen.tsx`). La dérogation n'est donc atteignable que par le directeur ou le propriétaire (à confirmer à l'écran avec `etudes@`). | Majeur |
| Détail de session (directeur des études) | Le directeur des études a le droit de publier mais pas `exam.session.manage` : la section « Actions » lui est masquée, il ne peut publier qu'un résultat à la fois (bouton « Publier » d'une ligne), pas la session. | Mineur |
| Fiche candidat, éligibilité | Les motifs codés de la règle (`NOT_IN_EXAM_GRADE`, `DOCUMENTS_MISSING`…) sont affichés tels quels : le catalogue ne traduit que `ALREADY_LIVE` et `ALREADY_CANDIDATE`. | Mineur |
| Corrections | Les valeurs "actuelle" et "proposée" d'une demande portent des clés techniques (`code`, `toCode`, `toAverage`, `toStatus`, `toScore`) que l'écran n'associe pas à ses libellés (à confirmer à l'écran). | Mineur |
| Rapports d'opérations en lot | Les lignes refusées affichent un code technique à la suite du message (`(examinations.not_eligible)`, `(examinations.scores_closed)`…) ; la saisie de notes refusée répond par un rapport 200 sans désactiver les champs hors état « Épreuves en cours » (C-10-02, C-10-03). | Mineur |
| Fiche candidat, historique et identifiants | Le type d'événement de l'historique et l'origine d'un identifiant (`MANUAL`, `IMPORT`) sont affichés bruts. | Mineur |
| Examens blancs | « Épreuve 1 (démonstration) ← évaluation 01a110ef » et « Règle CI-EXAM-PLACEHOLDER, version `<identifiant>` » montrent des identifiants tronqués ou entiers (C-10-06). | Mineur |
| Candidats libres, import CSV | Un fichier vide annonce comme colonnes obligatoires absentes `nom, prenoms, naissance, lieu, sexe` : la liste contient `lieu` (facultatif) et oublie `classe_examen` (obligatoire). | Mineur |
| Détail de session, publication | Le refus d'un responsable affiche le nom technique de la permission (`exam.result.publish`). | Mineur |
| Détail de session | Seule la publication demande une confirmation ; « Passer à : Archivée » (irréversible) et les autres changements d'état s'exécutent en un clic (reste du constat C-11-01). | Mineur |
| Types d'examens | Pas d'écran pour ajouter une pièce exigée à un type, ni pour affecter une filière à un candidat, ni pour créer un format : fonctions de l'API sans écran. | Suggestion |
| Types d'examens | Le bouton « Charger le pack du primaire (fictif) » est proposé aussi au collège et à l'université. | Suggestion |
| Statistiques, Imports, Corrections, Répartition | Bandeau de démonstration en double et « Chargement… » répété (C-10-07). | Mineur |

## À vérifier en test

- Nombre exact de candidats ajoutés par la classe 6e A (9 au dernier relevé) et identité du neuvième élève sans note.
- Capacité et avertissement du résumé de la répartition avant le rattachement du centre (20.15).
- Ordre exact d'attribution des places par la répartition automatique (20.15, étape 5).
- Statut d'éligibilité après une dérogation (« Éligible » attendu) et fenêtre de seconde vérification (MFA récente) à la dérogation, à la publication, à l'application d'un import (20.14, 20.26, 20.39).
- Forme exacte du taux (60 %, 33,3 %…), libellés des groupes « Par établissement », « Par filière », « Par niveau » (20.25).
- Libellé de la pastille « Frais d'examen » pour un candidat sans barème (20.10).
- Messages exacts de la base pour un ajout de candidat après la clôture des inscriptions, pour une écriture sur une session « Archivée », pour un identifiant ou une session inconnus (20.19, 20.29, 20.43).
- Téléchargement des exports et des PDF (stockage d'objets branché ?), présence visuelle du filigrane de démonstration (20.17, 20.27, 20.40).
- Présence de l'entrée de menu « Examens » à l'université (20.42).
- Contenu exact du fichier d'export "liste des candidats" (brouillons inclus ou non, 20.40).
- Reprise exacte des numéros de candidat si les inscriptions ne se font pas dans l'ordre indiqué (20.10, 20.37).

## Non couvert / limites connues

- **Frais d'examen intégrés à l'inscription** (barème par type à partir du catalogue de la comptabilité, facture demandée à l'inscription, facture à établir à la main pour un candidat libre, remboursement manuel confirmé) : les écrans (« Frais d'examen (barème) », « Frais d'examen » sur la fiche) ne sont lus qu'à vide ; la gestion exige le droit de la direction et un frais de catégorie « Examens » dans la comptabilité, non livré par la graine.
- **Transmission aux admissions** (résultat et moyenne du CEPE vers l'admission en 6e) : seul le paramètre est testé (20.5) ; la lecture côté admissions relève du chapitre des admissions.
- **Pièce d'un élève** (« Joindre un document » depuis les documents de l'établissement, acceptation, refus) : exige un document appartenant à l'élève (chapitre Documents) ; seule la pièce « vue sur place » d'un candidat libre est parcourue.
- **Évaluation « Examen blanc » valide à lier** : demande de créer et publier une évaluation de ce type (chapitre Évaluations) ; seuls les refus de liaison sont couverts.
- **Formats d'import de notes et de numéros officiels, création de formats** (API uniquement) ; export d'un autre type (XLSX, largeur fixe, JSON) : aucun format livré.
- **Affectation d'une filière à un candidat** : absente de l'écran ; la colonne `TG_EP3` reste inutilisable.
- **Famille d'un autre élève** (parent d'une autre famille) : un seul compte parent par établissement dans la graine ; le 404 "hors périmètre" du module n'est pas démontrable par l'écran.
- **Appels directs de l'API, journal d'audit et événements** (aucune note, moyenne ni identité d'élève dans les événements) : hors périmètre du guide utilisateur.
- **Examens du supérieur** (BTS, licence, rattrapage) : aucun parcours livré (20.42).
- **Hors ligne, impression, mobile** : non vérifiés pour ce module.
