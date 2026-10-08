# Chapitre 21 : Portails parent, élève et enseignant

> Adresses : l'arborescence `apps/web/src/app/v2/` donne directement `/v2/...` dans le navigateur (aucun préfixe en plus, aucune réécriture dans `next.config.js`, le fichier `middleware.ts` n'ajoute que des en-têtes de sécurité). Les pages de connexion et de refus (`/login`, `/unauthorized`) et la page hors ligne (`/offline`) sont, elles, à la racine. Base de test : `http://localhost:3000`.
>
> Les numéros de chapitres cités (06 présences, 07 emploi du temps, 08 évaluations et notes, 13 paie) sont ceux de la consigne ; pour les autres modules, le chapitre est nommé par son module.

Ce chapitre vérifie, écran par écran, trois espaces simples (parent, élève, enseignant) et surtout **qui voit quoi** : le parent ne voit que ses enfants, l'élève que lui-même, l'enseignant que ses classes. Il couvre aussi le paiement en ligne simulé depuis le portail, la justification d'absence par le parent, la correction d'un contact d'urgence et la mise à jour de ses coordonnées. La qualité transversale (clavier, mobile, hors ligne) est au chapitre 22.

## Prérequis

- Application lancée (web `http://localhost:3000`, API `http://localhost:4000`) et graine de démonstration chargée (annexe de départ).
- **Paiement simulé** : le serveur web doit avoir été démarré avec `NEXT_PUBLIC_FINANCE_SANDBOX=1` (c'est la valeur que `pnpm dev:v2` lit dans `.dev-v2/env.local`, et sa valeur par défaut). Sans elle, l'option « Paiement simulé (démonstration) » n'est pas proposée et le scénario 21.9 est impossible (rapport QA 12, constat C-12-01, corrigé en dev : le serveur web doit être redémarré).
- Établissement principal : **Collège Le Baobab** (`secondaire-test`). Les variantes primaire et supérieur sont au 21.29 et 21.31.
- Pour le scénario 21.12 (contact d'urgence) : un compte de secrétariat (avec code MFA proposé par la page de connexion).
- Pour les scénarios d'isolation (21.14, 21.22, 21.26) : relever des identifiants (le long code qui suit l'adresse). Méthode : se connecter en secrétariat, ouvrir `/v2/students`, chercher le nom, cliquer sur la ligne, copier le code dans la barre d'adresse après `/v2/students/`. Notation dans ce chapitre : `<id Nadia>`, `<id Salimata>`, `<id Aya BAMBA>`, `<id reçu de Salimata>`, `<id Grande Section A>`.

## Comptes (e-mails seulement ; on se connecte par le panneau de droite de `/v2/login`)

| Rôle | Établissement | E-mail | MFA | Atterrissage |
|---|---|---|---|---|
| Parent (DIABATE Séka, tuteur n° 1 de Nadia et Salimata) | Collège Le Baobab | `parent@secondaire-test.test` | non | `/v2/parent` |
| Élève (DIABATE Nadia) | Collège Le Baobab | `eleve@secondaire-test.test` | non | `/v2/student` |
| Enseignant (TRAORE Kouadio, responsable de la 6e A) | Collège Le Baobab | `enseignant@secondaire-test.test` | non | `/v2/teacher` |
| Secrétariat (relever des identifiants, ajouter un contact) | Collège Le Baobab | `secretariat@secondaire-test.test` | oui | `/v2/students` |
| Économe (facture ouverte de Nadia, 21.19) | Collège Le Baobab | `econome@secondaire-test.test` | oui | `/v2/finance` |
| Instituteur (titulaire du CP1 A) | École Les Palmiers | `enseignant@primaire-test.test` | non | `/v2/primary` |
| Institutrice de maternelle (ZOKORA Sylvie, Grande Section A) | École Les Palmiers | `instituteur.maternelle@primaire-test.test` | non | `/v2/primary` |
| Directeur (relever l'identifiant de Grande Section A) | École Les Palmiers | `directeur@primaire-test.test` | oui | `/v2/direction` |
| Parent, élève, enseignant | Université Horizon | `parent@superieur-test.test`, `eleve@superieur-test.test`, `enseignant@superieur-test.test` | non | `/v2/parent`, `/v2/student`, `/v2/teacher` |
| Parent, élève | École Les Palmiers | `parent@primaire-test.test`, `eleve@primaire-test.test` | non | `/v2/parent`, `/v2/student` |

## Droits

| Portail | Rôle | Droit d'entrée (garde du `layout.tsx`) | Ce qui n'est jamais accordé |
|---|---|---|---|
| `/v2/parent` et ses sous-pages | Parent | `student.child.read` (puis une permission par page, lien de tutelle relu par l'API à chaque lecture) | tout écran de gestion ; toute donnée d'un enfant non lié |
| `/v2/student` et ses sous-pages | Élève | `student.self.read` (aucun identifiant dans l'adresse : l'élève est celui du compte) | tout écran de gestion ; toute donnée d'un autre élève |
| `/v2/teacher` et ses sous-pages | Enseignant, Instituteur (et Personnel) | `staff.own.read` ou `schedule.own.read` ; périmètre "mes classes" appliqué par l'API | finance, paie des autres, direction, structure académique |

Source : `apps/api/src/modules/rbac/templates/system-roles.ts` (rôles `parent`, `eleve`, `enseignant`, `instituteur`), `apps/web/src/platform/portal/menus.ts`.

**Adresses à taper à la main qui doivent être refusées** (résultat : redirection vers `/unauthorized`, page de titre « Accès refusé », texte "Vous n'avez pas les droits nécessaires pour afficher cette page.", lien "Retour à l'accueil" ; aucune donnée) :

| Compte | Adresses refusées |
|---|---|
| Parent | `/v2/teacher`, `/v2/student`, `/v2/students`, `/v2/finance`, `/v2/attendance`, `/v2/direction` |
| Élève | `/v2/parent`, `/v2/teacher`, `/v2/students`, `/v2/finance`, `/v2/attendance` |
| Enseignant | `/v2/parent`, `/v2/student`, `/v2/finance`, `/v2/direction`, `/v2/payroll` |

(Sans session, toute adresse de ce chapitre renvoie vers `/login` : scénario 21.32.)

## Données de départ

Source : `scripts/seed-v2/scenario.ts`, `scripts/seed-v2/dataset.ts`, `scripts/seed-v2/demo/finance.ts`, `results.ts`, `reportcards.ts`, `comms.ts`, `primary.ts`.

| Donnée | Valeur de départ |
|---|---|
| Fratrie | Le parent voit **DIABATE Nadia** (E1) et **DIABATE Salimata** (E2), toutes deux en 6e A (`6E-A`). Les 10 autres élèves appartiennent à d'autres familles. |
| Scolarité | Nadia : 225 000 F CFA payés (25 000 d'inscription + 200 000 de scolarité par virement), **reste 0**. Salimata : 125 000 payés (inscription + moitié de la scolarité par mobile money), **reste 100 000 F CFA** (relevé du rapport QA 12 du 8 oct. 2026 ; à reconfirmer). |
| Notes publiées (période 1) | Évaluations "Premier contrôle", "Premier contrôle (suite)" et "Composition" ; période 2 : "Devoir de la période 2". Résultats de période 1 calculés avec le jeu de règles de **démonstration**. Nadia (rapport QA 13) : moyenne 13,20, rang 2 sur 8. |
| Bulletins | 9 bulletins publiés de la période 1 (dont ceux de Nadia et Salimata). |
| Emploi du temps | Un cours par matière du lundi au jeudi, 08:00 à 10:00 (Français, Mathématiques, Anglais, Histoire-Géographie), occurrences générées de la rentrée à J+14. |
| Appels | Deux séances passées pointées par l'enseignant ; les absents de la graine sont des élèves de rang 3 et 4 de la liste (BAMBA Aya, BAMBA Fatou), un retard au rang 6. **Nadia et Salimata n'ont a priori aucune absence** (à vérifier en test). |
| Contacts d'urgence | **Aucun** dans la graine. |
| Annonces | "Rentrée : réunion d'information des parents (démonstration)" visant parents et personnel (depuis le commit `32c53a91`) ; un brouillon "Brouillon : calendrier des compositions (démonstration)" non publié. |
| Enseignants | TRAORE Kouadio (compte), YAO Fatou et KOUAME Adjoua (sans compte de portail), tous affectés à la 6e A pour toutes les matières. Au primaire : l'instituteur du CP1 A est titulaire de classe ; ZOKORA Sylvie est titulaire de la Grande Section A. |

## Ce que voit un parent, un élève, un enseignant (matrice)

| Domaine | Parent | Élève | Enseignant / instituteur | Testé dans |
|---|---|---|---|---|
| Fiche et contacts | `/v2/parent/children/<id>/emergency`, `/v2/students/children` | `/v2/student`, `/v2/student/me`, `/v2/student/profile` | élèves de ses classes : `/v2/teacher/classes/<id>` puis fiche réduite `/v2/students/<id>` | 21.12, 21.16, 21.21, 21.25 ; chapitre « Personnes » |
| Présences | `/v2/parent/children/<id>/attendance`, `/v2/attendance/children`, `/v2/attendance/children/<id>` | `/v2/student/attendance`, `/v2/attendance/me` | `/v2/teacher/attendance` (appel) | 21.6, 21.18 ; chapitre 06 |
| Emploi du temps | `/v2/parent/children/<id>/schedule`, `.../upcoming` | `/v2/student/schedule`, `/v2/student/upcoming` | `/v2/teacher`, `/v2/teacher/schedule` | 21.7, 21.17, 21.24 ; chapitre 07 |
| Notes et résultats | `/v2/parent/children/<id>/results` | `/v2/student/results` | `/v2/teacher/assessments` (saisie) ; aucune lecture de résultats officiels | 21.4, 21.17 ; chapitre 08 |
| Bulletins | `/v2/parent/children/<id>/reportcards`, `/v2/reportcards/family` | `/v2/student/reportcards`, `/v2/reportcards/family` | aucun accès (l'instituteur a `reportcard.read` en lecture de sa classe) | 21.5, 21.17 ; chapitre « Bulletins » |
| Finance | `/v2/parent/children/<id>/finance`, `/v2/finance/me`, `/v2/finance/me/<id>` | `/v2/student/finance`, `/v2/finance/me` | aucun accès | 21.8 à 21.10, 21.19 ; chapitre "Finance et paiements" |
| Documents | `/v2/parent/children/<id>/documents` (lecture seule), `/v2/higher/me/documents` | `/v2/student/documents` (lecture seule), `/v2/higher/me/documents` | aucun accès | 21.11, 21.20 |
| Vie scolaire | `/v2/schoollife/famille` | `/v2/schoollife/moi` | `/v2/schoollife/saisie` | chapitre "Pack secondaire" |
| Conseils de classe | `/v2/councils/famille` | `/v2/councils/moi` | `/v2/councils` (ses classes) | chapitre "Pack secondaire" |
| Affectation de l'État | `/v2/stateassign/family` | non | non | chapitre "Pack secondaire" |
| Examens | `/v2/examinations/family` | `/v2/examinations/family` | non | chapitre "Pack secondaire" |
| Primaire | `/v2/primary/mon-enfant` | `/v2/primary/mon-enfant` | `/v2/primary/classe`, `/v2/primary/conseil` | 21.29, 21.31 ; chapitre "Pack primaire" |
| Messages et annonces | `/v2/messages`, `/v2/announcements` | `/v2/messages`, `/v2/announcements` | `/v2/messages`, `/v2/announcements` | 21.23 ; chapitre "Messagerie" |
| Paie et congés | non | non | `/v2/teacher/payslips` (chapitre 13), `/v2/teacher/leaves` | 21.27 ; chapitre 13 |
| Compte | `/v2/parent/account` | `/v2/student/profile` | `/v2/teacher/profile` | 21.13, 21.21, 21.28 |

---

## A. Portail parent

#### 21.1 Accueil du parent : la fratrie
Compte : Parent (Collège Le Baobab) · Où : `/login` puis atterrissage `/v2/parent`, menu « Mes enfants » · Prérequis : aucun
1. Sur `/login`, cliquer sur le compte « Parent » du panneau de droite, puis se connecter (pas de MFA).
2. Constater l'atterrissage sur `/v2/parent` : titre « Mes enfants ».
3. Lire les blocs : un par enfant, avec le nom en titre, la classe en dessous, un badge d'état et un bouton « Ouvrir ».
4. Lire les quatre cartes de chaque bloc : « Dernière moyenne publiée », « Absences », « Scolarité restante », « Prochaines séances ».
Résultat attendu : **exactement deux blocs**, "DIABATE Nadia" et "DIABATE Salimata", chacun avec la classe "6e A". Aucun nom d'un autre élève (BAMBA, COULIBALY, TOURE, SORO, N'GUESSAN). La carte « Dernière moyenne publiée » de Nadia affiche une moyenne et un rang du type "rang 2 sur 8" (valeurs de la graine, à comparer) ; la carte « Scolarité restante » de Nadia affiche 0 et celle de Salimata 100 000 F CFA. Une carte dont la lecture est refusée affiche « Information indisponible pour le moment. » sans casser la page.
Cas invalides : sans objet (lecture seule). Aucun enfant lié (compte sans tutelle) : message « Aucun enfant n'est rattaché à votre compte. » (non testable avec la graine).
- [ ] Cas nominal  - [ ] Deux enfants exactement  - [ ] Droit refusé pour l'élève (`/v2/parent` → « Accès refusé »)

#### 21.2 Coque du portail parent : menu, compte, déconnexion
Compte : Parent · Où : n'importe quelle page de `/v2/parent` · Prérequis : 21.1
1. Lire la barre du haut : nom de l'établissement ("Collège Le Baobab (démonstration)") et, dessous, « Espace parent ».
2. Lire le menu latéral (navigation nommée « Navigation de l'espace parent »).
3. Cliquer sur « Mon compte » : lire le nom, l'e-mail, la ligne « Rôle actif » avec la valeur "Parent", puis les liens « Sécurité du compte », « Mes sessions », « Mes notifications ».
4. Appuyer sur Échap : le panneau se ferme et le focus revient sur « Mon compte ».
5. Cliquer sur « Se déconnecter » : retour à la page de connexion.
Résultat attendu : le menu contient « Mes enfants », « Vie scolaire », « Décisions du conseil », « Affectation de mon enfant », « Examens de mes enfants », « Messages », « Annonces », « Paramètres du compte » (les entrées soumises à une fonction de l'offre n'apparaissent que si la fonction est incluse ; « Bulletin et compétences (primaire) » est absent au collège, à vérifier). Aucune entrée de finance, de structure ou d'administration. Le fil d'Ariane (nommé « Fil d'Ariane ») commence par « Espace parent ».
Cas invalides : menu qui ne charge pas : bandeau "Le menu n'a pas pu être chargé. Les pages restent accessibles par leur adresse." (non testable sans panne).
- [ ] Cas nominal  - [ ] Pas d'entrée de gestion  - [ ] Droit refusé : `/v2/finance` → « Accès refusé »

#### 21.3 Tableau de bord d'un enfant et sélecteur « Enfant »
Compte : Parent · Où : `/v2/parent` > « Ouvrir » (`/v2/parent/children/<id Nadia>`) · Prérequis : 21.1
1. Cliquer sur « Ouvrir » dans le bloc de Nadia (le lien s'annonce "Ouvrir — DIABATE Nadia").
2. Lire la liste « Enfant » (visible parce que le parent a plusieurs enfants) : options "DIABATE Nadia — 6e A" et "DIABATE Salimata — 6e A".
3. Lire la rangée « Sections de l'enfant » : « Tableau de bord », « Résultats », « Bulletins », « Absences », « Emploi du temps », « Évaluations à venir », « Scolarité », « Documents », « Dossier et contacts ». L'onglet courant est « Tableau de bord ».
4. Lire sous le titre les quatre cartes et la carte « Annonces » avec le bouton « Ouvrir les annonces ».
5. Cliquer sur l'onglet « Résultats », puis choisir "DIABATE Salimata — 6e A" dans « Enfant ».
6. Ouvrir ensuite un reçu de Salimata (onglet « Scolarité », 21.8) et changer d'enfant depuis la page du reçu.
Résultat attendu : à l'étape 5, l'adresse devient `/v2/parent/children/<id Salimata>/results` (la **section est conservée**) et le titre devient "Résultats de DIABATE Salimata". À l'étape 6, le changement d'enfant ramène à `/v2/parent/children/<id Nadia>/finance` (un reçu n'a de sens que pour l'enfant d'origine). Les onglets visibles dépendent des droits ; un onglet n'est jamais affiché sans droit.
Cas invalides : choisir l'entrée vide « Choisir un enfant » (visible seulement quand l'adresse désigne un enfant non lié, 21.14) ne change rien.
- [ ] Cas nominal  - [ ] Section conservée au changement d'enfant  - [ ] Droit refusé : un parent sans `student.child.read` n'entre pas (non testable avec la graine)

#### 21.4 Résultats officiels et notes publiées (Nadia)
Compte : Parent · Où : onglet « Résultats » (`/v2/parent/children/<id Nadia>/results`) · Prérequis : 21.3
1. Lire le titre "Résultats de DIABATE Nadia" et la section « Résultats officiels » : une fiche par période clôturée, avec « Moyenne », « Rang » (au format "2 sur 8"), « Crédits », « Mention », les badges (« Validé » ou « Non validé », la décision) et la ligne "Résultat arrêté le …".
2. Déplier « Détail par matière (n) » : tableau « Matière », « Note », « Coef. », « État ».
3. Descendre à « Notes des évaluations » : lire la phrase « Seules les notes publiées par l'établissement sont visibles ici. », le tableau de caption « Notes publiées » (colonnes « Évaluation », « Matière », « Type », « Date », « Note », « Poids » ; certaines colonnes sont masquées sur petit écran) et la note « Une absence ou une dispense n'est jamais comptée comme un zéro. ».
4. Si la liste « Période » est proposée, choisir une période, puis « Toutes les périodes ».
5. Si le bouton « Afficher plus » est proposé, le cliquer.
6. Comparer avec le compte Élève (21.17) : mêmes valeurs.
Résultat attendu : les notes affichées sont de la forme "16 / 20" ; seules des évaluations **publiées** apparaissent (aucun brouillon, aucune feuille en cours de validation) ; pas de bandeau « Règles de démonstration » (absence signalée par le QA, constat C-13-02, voir Écarts). Le rang est « N sur M » sans nom de camarade. Une ligne peut afficher "Décision : <code>" avec un code brut (voir Écarts).
Cas invalides : sans objet (lecture seule) ; période sans note : « Aucune note publiée. » avec l'aide « Les notes apparaissent ici une fois publiées par l'établissement. ».
- [ ] Cas nominal  - [ ] Aucun brouillon visible  - [ ] Droit refusé : enfant d'une autre famille (21.14)

#### 21.5 Bulletins : téléchargement et vérification d'authenticité
Compte : Parent · Où : onglet « Bulletins » (`/v2/parent/children/<id Nadia>/reportcards`) · Prérequis : 21.3
1. Lire le titre "Bulletins de DIABATE Nadia", puis une carte par bulletin : intitulé, période · nom, ligne "Publié le …", éventuel badge « Provisoire ».
2. Cliquer sur « Télécharger le PDF » : le bouton passe par « Préparation… » puis le fichier se télécharge.
3. Cliquer sur « Vérifier l'authenticité » : un bloc apparaît avec un QR code (« QR code de vérification du bulletin »), le « Code de vérification » (26 caractères) et le lien « Ouvrir la page de vérification ».
4. Cliquer sur « Ouvrir la page de vérification » (adresse `/v2/verify/<code>`).
5. Revenir, ouvrir l'onglet de Salimata, constater qu'on ne retrouve **pas** le code de Nadia.
Résultat attendu : le PDF se télécharge (nom donné par le serveur) ; le texte « Le lien de téléchargement est valable quelques minutes et n'est jamais affiché. » est visible sous la liste ; la page de vérification, publique, annonce « Document authentique » et rappelle « Cette page n'affiche ni note, ni nom, ni matricule, ni date de naissance : elle confirme seulement l'existence et le statut du document. ». Le PDF doit porter la mention de démonstration (le texte du PDF est compressé : lecture non faite par le QA, à vérifier à l'œil dans le lecteur de PDF). Si le rendu n'est pas prêt : « Le document est en cours de préparation. Réessayez dans quelques instants. ».
Cas invalides : un code de vérification modifié d'un caractère dans `/v2/verify/<code>` → document "inconnu" (chapitre « Bulletins »).
- [ ] Cas nominal  - [ ] PDF téléchargé  - [ ] Vérification publique sans donnée personnelle

#### 21.6 Absences et justification d'absence par le parent
Compte : Parent · Où : onglet « Absences » (`/v2/parent/children/<id Nadia>/attendance`) · Prérequis : 21.3 ; connaître une date de jour d'école déjà passée (par exemple la veille du test, à adapter ; la date doit être dans l'année scolaire en cours, qui débute le 1er septembre, et ne pas être future)
1. Lire le titre « Absences de l'enfant », le « Récapitulatif » (« Séances », « Absences », « dont justifiées », « Retards », « Départs anticipés »), le tableau « Absences et retards » (ou « Aucune absence ni retard. » avec « Tout est en règle. »), la section « Justificatifs déposés ».
2. Cliquer sur « Déposer un justificatif » (en haut à droite). La fenêtre « Déposer un justificatif » s'ouvre.
3. Remplir le formulaire :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Premier jour d'absence | `2026-10-07` (la veille du test) | oui |
   | Dernier jour d'absence | `2026-10-07` | oui |
   | Motif | « Maladie » (liste de repli : « Maladie », « Événement familial », « Difficulté de transport », « Activité officielle », « Autre ») | oui |
   | Commentaire | `Rendez-vous médical test guide` | non |
   | Pièce jointe (facultative) | laisser vide (PDF, JPEG, PNG ou WebP si l'on veut en joindre une) | non |
4. Cliquer sur « Déposer ».
5. Constater la carte ajoutée dans « Justificatifs déposés », puis cliquer sur « Retirer ce justificatif ».
Résultat attendu : la fenêtre se ferme et le message « Justificatif déposé. » s'affiche. La carte montre la date (au format "7 oct. 2026"), le badge « En attente », la ligne "Motif : ILLNESS" (code brut, voir Écarts), le commentaire saisi et le bouton « Retirer ce justificatif ». Au retrait : « Justificatif retiré. » et la carte passe à « Retiré » (à vérifier). Dans la fenêtre, la ligne "Élève : …" affiche un identifiant au lieu du nom (voir Écarts). Un second dépôt identique pendant que le premier est en attente ne crée pas de doublon (renvoie la demande existante, à vérifier). Si une absence de Nadia existe (par exemple pointée au chapitre 06), sa ligne porte « À justifier » et un bouton « Justifier » qui ouvre la même fenêtre avec les dates préremplies ; après acceptation par l'éducateur la ligne devient « Justifiée ».
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Dernier jour `2026-10-05` avec premier jour `2026-10-07` | "La fin de la fenêtre précède son début." sous « Dernier jour d'absence » |
| Motif non choisi | message du contrat, formulé techniquement : "Code attendu : majuscules, chiffres et _ (40 max)." (à relever, voir Écarts) |
| Premier jour vidé | "Date attendue au format AAAA-MM-JJ." |
| Dernier jour dans le futur (demain) | refus du serveur : "Un justificatif ne peut pas couvrir des dates futures." |
| Premier jour `2026-08-20` (avant la rentrée) | refus du serveur : "La fenêtre commence avant l'année scolaire de l'inscription." |
| Pièce jointe plus grande que la limite | « Le fichier dépasse la taille autorisée ({max} Ko). » (la limite vient des paramètres de présence) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : sur `/v2/parent/children/<id Aya BAMBA>/attendance` aucun bouton de dépôt (21.14)

#### 21.7 Emploi du temps et évaluations à venir
Compte : Parent · Où : onglets « Emploi du temps » (`/v2/parent/children/<id Nadia>/schedule`) et « Évaluations à venir » (`/v2/parent/children/<id Nadia>/upcoming`) · Prérequis : 21.3
1. Dans « Emploi du temps » : titre "Emploi du temps de DIABATE Nadia" ; lire l'intitulé de la semaine ("Du … au …").
2. Utiliser « Semaine précédente », « Aujourd'hui », « Semaine suivante » (boutons à icône, nommés pour le lecteur d'écran).
3. Cliquer sur « Vue jour », constater le passage à un seul jour (le bouton devient « Vue semaine »), naviguer d'un jour (« Jour précédent », « Jour suivant »).
4. Cocher « Afficher les séances annulées » puis la décocher.
5. Avancer de plusieurs semaines (au-delà de J+14 des occurrences générées) pour voir l'état vide.
6. Ouvrir « Évaluations à venir » : titre "Évaluations à venir de DIABATE Nadia".
Résultat attendu : de la rentrée à J+14, une séance de 08:00 à 10:00 du lundi au jeudi (matière nommée : Français, Mathématiques, Anglais, Histoire-Géographie ; classe "6e A") ; au-delà, « Aucune séance cette semaine. » avec « Changez de semaine avec les flèches. » ; en vue jour sans séance, « Aucune séance ce jour. ». Sur écran large la semaine est une grille de 7 colonnes ; sur mobile, une liste par jour (22.21). Les « Évaluations à venir » affichent « Aucune évaluation planifiée. » tant qu'aucune séance de type examen n'est planifiée (chapitre 07), avec toujours la note « Seules les évaluations planifiées à l'emploi du temps sont annoncées ici ; les devoirs à rendre ne sont pas encore disponibles dans cet espace. ». Si le chapitre 07 a planifié un examen dans les 30 jours, il apparaît ici avec son jour en toutes lettres.
Cas invalides : sans objet (lecture seule).
- [ ] Cas nominal  - [ ] État vide lisible  - [ ] Droit refusé : emploi du temps d'un enfant non lié (21.14)

#### 21.8 Scolarité : lecture (Nadia soldée, Salimata avec reste)
Compte : Parent · Où : onglet « Scolarité » (`/v2/parent/children/<id>/finance`) pour chaque enfant · Prérequis : 21.3
1. Pour **Nadia** : lire le titre "Scolarité de DIABATE Nadia", la section « Situation » (« Facturé », « Avoirs », « Payé », « Reste à payer »), « Prochaines échéances », « Factures », « Paiements », « Reçus ».
2. Pour **Salimata** (changer d'enfant avec « Enfant ») : lire les mêmes sections.
3. Dans « Factures », cliquer sur la ligne d'une facture (ligne dépliable : numéro, badge d'état, "Reste à payer : …") pour afficher son échéancier : tableau de légende "Échéances de la facture …" (colonnes « Échéance », « Date limite », « Montant », « Reste dû », « Statut »).
4. Dans « Paiements » (tableau « Paiements effectués » : « Date », « Montant », « Statut »), lire les lignes.
5. Dans « Reçus », lire les numéros (liens), la date, le montant et le bouton « PDF » de chaque reçu.
Résultat attendu : **Nadia** : Payé 225 000 F CFA, Reste à payer 0 F CFA, « Aucune échéance à payer. », **aucun bouton « Payer en ligne »** (aucune facture ouverte). **Salimata** : Payé 125 000 F CFA, Reste à payer 100 000 F CFA, une échéance à payer, le bouton « Payer en ligne » en haut à droite. Les montants s'écrivent "100 000 F CFA" (espaces insécables, sans décimale). Les numéros de reçus sont de la forme REC-AAAA-NNNNNN (rapport QA : REC-2026-000010 et REC-2026-000001 pour Nadia, REC-2026-000011 et REC-2026-000002 pour Salimata ; numéros variables selon la base). Le reçu de Salimata n'apparaît jamais dans l'onglet de Nadia.
Cas invalides : un enfant sans facture : « Aucune facture émise. », « Aucun paiement. », « Aucun reçu. ».
- [ ] Cas nominal  - [ ] Pas de bouton de paiement pour Nadia  - [ ] Droit refusé : scolarité d'un enfant non lié (21.14)

#### 21.9 Paiement en ligne simulé (Salimata)
Compte : Parent · Où : onglet « Scolarité » de Salimata > « Payer en ligne » · Prérequis : 21.8 ; web démarré avec le paiement simulé (voir Prérequis). Effet durable : les paiements créés ne se suppriment pas depuis l'interface (voir Données créées)
1. Cliquer sur « Payer en ligne » : la fenêtre « Payer en ligne » s'ouvre (texte : « Le paiement est initié auprès de votre opérateur ; confirmez-le sur votre téléphone. Le montant ne peut pas dépasser le reste dû de la facture. »).
2. Premier paiement, qui doit **réussir** :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Facture à payer | la facture de scolarité ("… — reste 100 000 F CFA") | oui |
   | Montant (F CFA) | `20000` (remplacer la valeur préremplie, qui est le reste dû) | oui |
   | Moyen de paiement | « Paiement simulé (démonstration) » (premier choix, présélectionné) | oui |
   | Numéro de téléphone du payeur | `+225 05 00 00 00 20` | non |
   Sous le moyen de paiement, lire l'aide « Paiement simulé : aucun argent réel n'est débité. Un montant se terminant par 001 reste en attente, un montant se terminant par 013 échoue, tout autre montant réussit. »
3. Cliquer sur « Payer ».
4. Observer le bloc « Suivi du paiement », puis cliquer sur « Fermer ».
5. Recharger la page et relire « Situation », « Paiements » et « Reçus ».
6. Deuxième paiement, **en attente** : refaire avec le montant `5001`. Observer le bloc, cliquer sur « Vérifier maintenant », attendre une dizaine de secondes (la page vérifie seule toutes les 5 secondes).
7. Troisième paiement, **échec** : recharger la page, refaire avec le montant `5013`. Cliquer sur « Fermer ».
Résultat attendu : (4) le bloc « Suivi du paiement » porte le badge « Confirmé », la ligne "Montant : 20 000 F CFA" et le message « Paiement confirmé. Votre reçu est disponible ci-dessous. » ; (5) Payé 145 000 F CFA, Reste à payer 80 000 F CFA, une ligne « Confirmé » de 20 000 F CFA dans « Paiements », un nouveau reçu dans « Reçus » ; (6) badge « En attente » et message « En attente de confirmation par l'opérateur. Cette page se met à jour toute seule. », qui **reste** après « Vérifier maintenant » (le fournisseur simulé laisse les montants en 001 en attente) ; aucun bouton « Fermer » tant que le paiement est en attente (recharger la page pour quitter) ; (7) badge « Échoué » et message "Le paiement a échoué :" suivi d'un motif (texte à relever). Les paiements « En attente » et « Échoué » ne modifient pas le reste à payer (à vérifier). L'onglet de Nadia n'est pas modifié.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Montant vide | « Saisissez un montant. » |
| Montant `12,5` | « Le montant est un entier en francs : pas de virgule ni de point. » (affiché dès la saisie) |
| Montant `-1000` | « Le montant ne peut pas être négatif. » |
| Montant `abc` ou `0` | « Montant invalide : chiffres uniquement, strictement positif. » |
| Montant `500000` (supérieur au reste dû) | refus du serveur : "Le montant dépasse le reste dû de la facture." |
| Double clic rapide sur « Payer » | une seule ligne ajoutée dans « Paiements » (clé d'idempotence ; à vérifier) |
- [ ] Cas nominal (réussite, reçu)  - [ ] En attente (001) et échec (013)  - [ ] Cas invalide  - [ ] Droit refusé : aucun bouton « Payer en ligne » pour Nadia

#### 21.10 Reçu : détail, PDF, impression
Compte : Parent · Où : onglet « Scolarité » de Salimata > clic sur le numéro du reçu créé au 21.9 (`/v2/parent/children/<id Salimata>/finance/receipts/<id reçu>`) · Prérequis : 21.9
1. Lire le titre « Reçu REC-… » (numéro en toutes lettres), les boutons « Retour à la scolarité », « Télécharger le PDF », « Imprimer ».
2. Lire le document intitulé « Reçu de paiement » : « Date », « Mode de paiement » (valeur "En ligne" suivie de la référence), « Montant reçu », « Reste à payer après ce paiement », « Imputation du paiement » (lignes "numéro de facture · échéance", montant).
3. Cliquer sur « Télécharger le PDF ».
4. Appuyer sur Ctrl+P (ou « Imprimer ») : l'aperçu ne doit montrer que le document (barre, menu et fil d'Ariane masqués).
5. Cliquer sur « Retour à la scolarité ».
6. Dans la barre d'adresse, remplacer l'identifiant du reçu par `abc`, puis par `00000000-0000-4000-8000-000000000002`.
Résultat attendu : le montant reçu est 20 000 F CFA ; le PDF se télécharge ; à l'étape 6, `abc` donne la page d'erreur 404 de Next (identifiant mal formé), l'identifiant inconnu donne le message « Ressource introuvable. » et le bouton « Retour à la scolarité ». Le reçu ne porte pas la mention "simulé" (constat QA C-12-02, voir Écarts).
Cas invalides : reçu d'un autre apprenant (21.14).
- [ ] Cas nominal  - [ ] Impression propre  - [ ] Droit refusé : reçu d'un autre enfant

#### 21.11 Documents (lecture seule)
Compte : Parent · Où : onglet « Documents » (`/v2/parent/children/<id Nadia>/documents`) · Prérequis : 21.3
1. Lire le titre "Documents de DIABATE Nadia" et la phrase « Bulletins, reçus, diplômes et attestations publiés. ».
2. Repérer les sections « Bulletins » (avec « Télécharger ») et « Reçus de paiement » (avec « PDF »). La section « Diplômes et attestations » n'apparaît que s'il en existe (supérieur).
3. Chercher un bouton ou une zone de dépôt de fichier.
Résultat attendu : les bulletins et reçus sont ceux des onglets « Bulletins » et « Scolarité » ; **aucun** bouton de dépôt n'existe dans cet onglet (le rapport QA 12 avait attendu à tort un dépôt de document par le parent ; la vérification dans le code confirme une page en lecture seule). Sans aucun droit de lecture : « Aucun document accessible. ».
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Aucun dépôt possible  - [ ] Droit refusé : documents d'un enfant non lié (21.14)

#### 21.12 Dossier de l'enfant et contact d'urgence (ajout par le secrétariat, correction par le parent)
Comptes : Secrétariat puis Parent puis Secrétariat · Où : secrétariat `/v2/students` > fiche de DIABATE Nadia > onglet « Urgences » ; parent onglet « Dossier et contacts » (`/v2/parent/children/<id Nadia>/emergency`) · Prérequis : aucun contact d'urgence dans la graine
1. Parent : ouvrir « Dossier et contacts » et lire « Dossier » (« Classe », « Date de naissance », « Numéro d'inscription »), « Responsables » (DIABATE Séka avec le badge « Contact principal »), « Contacts d'urgence » et « Inscriptions ». Constater « Aucun contact d'urgence. ». Il n'existe **aucun** bouton d'ajout pour le parent.
2. Secrétariat : ouvrir `/v2/students`, chercher "DIABATE", ouvrir la fiche de Nadia, onglet « Urgences », cliquer sur « Ajouter un contact » (fenêtre « Ajouter un contact d'urgence ») et remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Nom du contact | `KONÉ Ibrahim test guide` | oui |
   | Lien avec l'élève | `Oncle` | non |
   | Téléphone | `+225 07 08 09 10 11` | oui |
   | Autre téléphone | (vide) | non |
   | Adresse e-mail | (vide) | non |
   | Priorité | `0` (0 = appelé en premier) | non |
   Valider : message « Le contact a été ajouté. ».
3. Parent : recharger « Dossier et contacts ». Lire le tableau « Contacts d'urgence » (colonnes « Nom », « Téléphone » sous forme de lien d'appel, « Lien » masquée sur petit écran, bouton « Modifier »). La phrase d'aide est « Ces personnes sont jointes en cas d'urgence. Vous pouvez corriger leurs coordonnées. ».
4. Cliquer sur « Modifier » (nom accessible "Modifier — KONÉ Ibrahim test guide") : fenêtre « Modifier KONÉ Ibrahim test guide ». Remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Nom | `KONÉ Ibrahim test guide` (inchangé) | oui |
   | Téléphone | `+225 05 11 22 33 44` | oui |
   | Autre téléphone | `+225 01 02 03 04 05` | non |
   | Adresse e-mail | `ibrahim.kone@exemple.test` | non |
5. Cliquer sur « Enregistrer ».
6. Secrétariat : recharger l'onglet « Urgences » de Nadia, puis cliquer sur « Retirer » pour nettoyer.
Résultat attendu : à l'étape 5 la fenêtre se ferme, le message « Contact mis à jour. » s'affiche et le tableau montre le nouveau téléphone ; le secrétariat voit le même numéro. Le parent ne peut ni ajouter, ni retirer, ni changer le lien ou la priorité (aucun champ ni bouton correspondant). Le retrait donne « Le contact a été retiré. ». Les contacts de Salimata sont distincts de ceux de Nadia.
Cas invalides :
| Saisie (fenêtre « Modifier ») | Message attendu |
|---|---|
| Téléphone `12` | "Téléphone trop court." |
| Adresse e-mail `ibrahim.kone` | "Adresse e-mail invalide." |
| Nom vidé | "Ce champ est obligatoire." |
| Aucune modification puis « Enregistrer » | la fenêtre se ferme sans message |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : l'élève n'a pas cet écran ; un parent sans `student.child.update` verrait le tableau sans « Modifier » (non testable avec la graine)

#### 21.13 Paramètres du compte du parent : mes coordonnées
Compte : Parent · Où : menu « Paramètres du compte » (`/v2/parent/account`) · Prérequis : aucun
1. Lire le titre « Paramètres du compte » et la description « Vos coordonnées et la sécurité de votre compte. ».
2. Section « Identité » : « Nom » et « Adresse de connexion » (en lecture seule), avec « Votre identité est gérée par l'établissement ; pour la corriger, contactez le secrétariat. ».
3. Section « Mes coordonnées » : lire « Les champs sont vides : seuls ceux que vous renseignez seront modifiés. » puis remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Adresse e-mail | (vide) | non |
   | Téléphone | `+225 07 10 20 30 99` | non |
   | Autre téléphone | `+225 05 40 50 60 70` | non |
   | Adresse | (vide) | non |
   | Ville | `Abidjan` | non |
   | Quartier / résidence | `Cocody Riviera test guide` | non |
4. Cliquer sur « Enregistrer ».
5. Recharger la page.
6. Rétablir le téléphone d'origine : saisir `+225 07 10 20 30 40` dans « Téléphone », « Enregistrer ».
7. Section « Sécurité et établissements » (affichée si l'authentification v2 est active) : ouvrir « Mot de passe et double authentification », « Mes sessions », « Mes établissements » (chapitre 02).
Résultat attendu : « Coordonnées enregistrées. » ; après rechargement les champs sont de nouveau vides (le formulaire ne relit pas la valeur actuelle d'un tuteur) ; l'identité ne se modifie pas (aucun champ). Le secrétariat voit les nouvelles coordonnées dans la fiche du tuteur DIABATE Séka (chapitre « Personnes »).
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Tous les champs vides puis « Enregistrer » | « Aucune modification à enregistrer. » |
| Adresse e-mail `pas-un-email` | "Adresse e-mail invalide." |
| Téléphone `123` | "Téléphone trop court." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : l'élève ouvrant `/v2/parent/account` → « Accès refusé »

#### 21.14 Isolation du parent : enfants et reçus d'autres familles
Compte : Parent · Où : adresses saisies à la main · Prérequis : `<id Aya BAMBA>` et `<id reçu de Salimata>` relevés (voir Prérequis)
1. Ouvrir `/v2/parent/children/<id Aya BAMBA>`.
2. Ouvrir successivement `/v2/parent/children/<id Aya BAMBA>/results`, `/reportcards`, `/attendance`, `/schedule`, `/upcoming`, `/finance`, `/documents`, `/emergency` (même préfixe).
3. Ouvrir `/v2/parent/children/abc`.
4. Ouvrir `/v2/parent/children/<id Nadia>/finance/receipts/<id reçu de Salimata>`.
5. Ouvrir `/v2/parent/children/<id Nadia>/finance/receipts/abc`.
6. Dans l'onglet Réseau des outils de développement (F12), constater qu'aucune requête de données ne part vers l'identifiant d'Aya BAMBA.
Résultat attendu : étapes 1 et 2 : un message d'avertissement « Cet enfant n'est pas rattaché à votre compte (ou le lien a pris fin). Aucune information ne peut être affichée. » et le bouton « Retour à mes enfants » ; ni onglets, ni nom, ni note, ni facture ; la liste « Enfant » propose « Choisir un enfant » puis seulement Nadia et Salimata. Étape 3 et 5 : page d'erreur 404 de Next (identifiant mal formé ; voir Écarts). Étape 4 : message d'erreur du serveur, par exemple « Ressource introuvable. », sans contenu du reçu.
Cas invalides : un identifiant bien formé mais inconnu (par exemple `00000000-0000-4000-8000-000000000001`) donne le même avertissement qu'au 1.
- [ ] Cas nominal  - [ ] Aucune donnée d'un autre enfant  - [ ] Droit refusé : même test côté élève (21.22)

#### 21.15 Le parent n'accède à aucune page de gestion
Compte : Parent · Où : adresses saisies à la main · Prérequis : 21.1
1. Ouvrir, une par une : `/v2/teacher`, `/v2/student`, `/v2/students`, `/v2/finance`, `/v2/attendance`, `/v2/direction`.
2. Ouvrir ensuite `/v2/parent/children/<id Nadia>` pour vérifier que la navigation normale fonctionne toujours.
Résultat attendu : chaque adresse de l'étape 1 redirige vers `/unauthorized` (titre « Accès refusé », texte "Vous n'avez pas les droits nécessaires pour afficher cette page.", lien "Retour à l'accueil") ; aucune donnée n'est affichée avant la redirection. La page de refus est en pleine page, sans la coque du portail (constat QA C-12-08 "ancienne mise en page").
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Six adresses refusées  - [ ] Navigation normale intacte

## B. Portail élève

#### 21.16 Mon dossier : accueil de l'élève
Compte : Élève (DIABATE Nadia, Collège Le Baobab) · Où : `/login` puis `/v2/student`, menu « Mon dossier » · Prérequis : aucun
1. Se connecter avec le compte « Élève » (pas de MFA).
2. Lire le titre (le nom de l'élève), la description « Matricule … » et le bouton « Mon profil ».
3. Lire la section « Mon dossier » (badge d'état, « Classe », « Numéro d'inscription », « Date de naissance »), les quatre cartes, la liste « Mes inscriptions » et la carte « Annonces ».
4. Lire le menu latéral et la barre du haut (« Espace élève »).
Résultat attendu : la fiche est celle de **DIABATE Nadia** (matricule 00001 d'après le rapport QA 13, classe "6e A", naissance "19 janv. 2014"). Les cartes sont les mêmes que celles que le parent voit pour Nadia. Le menu contient « Mon dossier », « Mes résultats », « Mes bulletins », « Mon emploi du temps », « Évaluations à venir », « Mes absences », « Ma scolarité », « Mes documents », « Ma vie scolaire », « Décisions du conseil », « Mon examen », « Messages », « Annonces », « Mon profil ». Il n'y a ni liste « Enfant », ni nom d'un autre élève, ni identifiant dans les adresses.
Cas invalides : compte sans fiche élève : « Aucun dossier d'élève n'est lié à votre compte. Contactez le secrétariat de l'établissement. » (non testable avec la graine).
- [ ] Cas nominal  - [ ] Seule Nadia apparaît  - [ ] Droit refusé : l'élève ouvrant `/v2/parent` → « Accès refusé »

#### 21.17 Résultats, bulletins, emploi du temps, évaluations à venir (élève)
Compte : Élève · Où : menu « Mes résultats », « Mes bulletins », « Mon emploi du temps », « Évaluations à venir » (`/v2/student/results`, `/v2/student/reportcards`, `/v2/student/schedule`, `/v2/student/upcoming`) · Prérequis : 21.16
1. Ouvrir chaque écran et refaire les lectures des scénarios 21.4, 21.5 et 21.7 (titres : « Mes résultats », « Mes bulletins », « Mon emploi du temps », « Évaluations à venir »).
2. Sur « Mes résultats », comparer moyenne, rang et notes avec ce que le parent voit pour Nadia.
3. Sur « Mes bulletins », télécharger le PDF et ouvrir « Vérifier l'authenticité ».
4. Chercher dans chaque écran un nom, une note ou un rang de camarade.
Résultat attendu : mêmes valeurs que dans le portail parent. Aucune note, moyenne ni nom de camarade ; le rang est de la forme "N sur M". Pas de bandeau « Règles de démonstration » (constat QA C-13-02, voir Écarts). Aucune écriture possible sur ces écrans.
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Valeurs identiques à la vue du parent  - [ ] Droit refusé : `/v2/student/results` pour le parent → « Accès refusé »

#### 21.18 Mes absences : justification déposée par l'élève
Compte : Élève · Où : menu « Mes absences » (`/v2/student/attendance`) · Prérequis : 21.16
1. Lire le titre « Mes absences » et le « Récapitulatif ».
2. Cliquer sur « Déposer un justificatif » et remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Premier jour d'absence | `2026-10-07` | oui |
   | Dernier jour d'absence | `2026-10-07` | oui |
   | Motif | « Maladie » | oui |
   | Commentaire | `Malaise passager test guide` | non |
3. Cliquer sur « Déposer ».
4. Constater la carte (« En attente »), puis cliquer sur « Retirer ce justificatif ».
5. Se reconnecter en parent et regarder si ce justificatif apparaît dans l'onglet « Absences » de Nadia.
Résultat attendu : « Justificatif déposé. » puis « Justificatif retiré. » (même fenêtre qu'au 21.6, avec la même ligne "Élève : …" à identifiant). Les cas invalides sont ceux du 21.6. Le rapport QA 13 note que l'absence reste « À justifier » tant que le justificatif est « En attente » (conforme à la conception : le justificatif attend une décision de l'éducateur, chapitre 06). La visibilité du justificatif de l'élève chez le parent est à relever.
Cas invalides : voir 21.6 (fin avant début ; date future ; motif non choisi).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : `/v2/attendance/children/<id Nadia>` pour l'élève → « Accès refusé »

#### 21.19 Ma scolarité et paiement en ligne simulé par l'élève
Comptes : Élève ; Économe pour le prérequis · Où : menu « Ma scolarité » (`/v2/student/finance`) · Prérequis : Nadia n'a **aucune facture ouverte** dans la graine (reste 0) ; pour tester le paiement, l'économe émet d'abord une facture d'un montant de 10 000 F CFA au nom de DIABATE Nadia (chapitre "Finance et paiements", émission d'une facture, libellé `Frais divers test guide`)
1. Élève : lire « Situation » (Payé 225 000 F CFA, Reste à payer 0 F CFA), « Factures », « Paiements », « Reçus ». Constater l'absence du bouton « Payer en ligne ».
2. Cliquer sur le numéro d'un reçu : adresse `/v2/student/finance/receipts/<id>`, mêmes lectures qu'au 21.10 ; « Retour à la scolarité ».
3. Après l'émission de la facture de 10 000 F CFA par l'économe : recharger « Ma scolarité » ; le bouton « Payer en ligne » apparaît.
4. Payer avec le formulaire du 21.9 :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Facture à payer | la facture "Frais divers test guide" ("… — reste 10 000 F CFA") | oui |
   | Montant (F CFA) | `3000` | oui |
   | Moyen de paiement | « Paiement simulé (démonstration) » | oui |
   | Numéro de téléphone du payeur | `+225 05 00 00 00 21` | non |
5. Cliquer sur « Payer », lire le suivi, « Fermer ». Refaire avec `3001` (en attente), puis `3013` (échec) après rechargement.
Résultat attendu : étapes 1 et 2 : lecture seule sans paiement ; étape 5 : « Paiement confirmé. Votre reçu est disponible ci-dessous. » puis Reste à payer 7 000 F CFA ; `3001` : « En attente de confirmation par l'opérateur. Cette page se met à jour toute seule. » ; `3013` : "Le paiement a échoué :" et un motif. Le parent voit les mêmes paiements dans l'onglet « Scolarité » de Nadia.
Cas invalides : ceux du 21.9 (montant vide, décimal, négatif, supérieur au reste dû).
- [ ] Cas nominal  - [ ] Paiement simulé réussi, en attente, échoué  - [ ] Droit refusé : `/v2/finance` pour l'élève → « Accès refusé »

#### 21.20 Mes documents (élève)
Compte : Élève · Où : menu « Mes documents » (`/v2/student/documents`) · Prérequis : 21.16
1. Lire le titre « Mes documents » : bulletins (« Télécharger »), reçus de paiement (« PDF »).
2. Télécharger un bulletin et un reçu.
3. Chercher un bouton de dépôt de fichier.
Résultat attendu : mêmes documents que dans « Mes bulletins » et « Ma scolarité » ; aucun dépôt (le rapport QA 13 le confirme : "aucun bouton de dépôt").
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Aucun dépôt  - [ ] Droit refusé : documents d'un autre élève impossibles (aucun identifiant dans l'adresse)

#### 21.21 Profil et dossier de l'élève : coordonnées
Compte : Élève · Où : menu « Mon profil » (`/v2/student/profile`) puis adresse `/v2/student/me` (aucun lien de menu ne mène à `/v2/student/me`) · Prérequis : noter les valeurs actuelles avant modification
1. `/v2/student/profile` : lire « Mon profil » et « Votre fiche et vos coordonnées. ». Section « Identité » : « Nom », « Prénom », « Matricule », « Date de naissance », « Classe », avec « Votre identité est gérée par l'établissement ; pour la corriger, contactez le secrétariat. ». Section « Mes coordonnées » (formulaire prérempli) :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Adresse e-mail | **ne pas modifier** (c'est l'adresse du compte de test) | non |
   | Téléphone | `+225 07 22 33 44 55` | non |
   | Autre téléphone | (inchangé) | non |
   | Adresse | (inchangé) | non |
   | Ville | `Abidjan` | non |
   | Quartier / résidence | `Cocody Danga test guide` | non |
2. Cliquer sur « Enregistrer » : message « Coordonnées enregistrées. ».
3. Rétablir les anciennes valeurs (téléphone, ville, quartier) et « Enregistrer ».
4. Ouvrir `/v2/student/me` : titre « Mon dossier » ; blocs d'identité (« Matricule », « Autres prénoms », « Sexe » valeur "Féminin", « Date de naissance », « Lieu de naissance » valeur "Daloa", « Nationalité », « Première inscription »), « Ma classe » (« Classe », « Numéro d'inscription », « État de l'inscription »), « Mes coordonnées », « Mon tuteur principal » (« Nom » DIABATE Séka, « Téléphone »), « Mes inscriptions ».
5. Cliquer sur « Mettre à jour mes coordonnées » : fenêtre du même nom (aide : « Seules vos coordonnées de contact sont modifiables ici. Laissez un champ vide pour l'effacer. »). Modifier « Téléphone » en `+225 07 22 33 44 56`, « Enregistrer ».
6. Rétablir le téléphone d'origine par la même fenêtre.
Résultat attendu : étape 2 : « Coordonnées enregistrées. » ; étape 5 : fenêtre fermée et « Vos coordonnées ont été mises à jour. » ; l'identité n'est modifiable nulle part. Pour les champs vides, la valeur affichée est « Non renseigné ».
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Adresse e-mail `eleve-sans-arobase` | "Adresse e-mail invalide." |
| Téléphone `123` | "Téléphone trop court." |
| Aucune modification puis « Enregistrer » (profil) | « Aucune modification à enregistrer. » |
| Aucune modification puis « Enregistrer » (fenêtre de `/v2/student/me`) | la fenêtre se ferme sans message |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : un parent ouvrant `/v2/student/profile` → « Accès refusé »

#### 21.22 Isolation de l'élève : sa sœur, les reçus et les pages de gestion
Compte : Élève (Nadia) · Où : adresses saisies à la main · Prérequis : `<id Salimata>` et `<id reçu de Salimata>` relevés
1. Ouvrir `/v2/student/finance/receipts/<id reçu de Salimata>`.
2. Ouvrir `/v2/students/<id Salimata>`.
3. Ouvrir `/v2/parent`, `/v2/teacher`, `/v2/finance`, `/v2/attendance`, `/v2/students`.
4. Ouvrir `/v2/student/finance/receipts/abc`.
5. Relire « Mes résultats » : aucun classement nominatif.
Résultat attendu : (1) message « Ressource introuvable. » (rapport QA 13) ; (2) « Accès refusé » ; (3) « Accès refusé » pour chacune ; (4) page 404 de Next ; (5) seulement le rang et la moyenne propres à Nadia. Aucune donnée de Salimata dans aucun cas.
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Aucune donnée de la sœur  - [ ] Cinq adresses refusées

#### 21.23 Annonces et messages depuis les portails
Comptes : Parent puis Élève · Où : carte « Annonces » > « Ouvrir les annonces » (`/v2/announcements`), menu « Messages » (`/v2/messages`) · Prérequis : 21.3 et 21.16 ; détail du module au chapitre "Messagerie"
1. Parent : sur le tableau de bord de Nadia, cliquer sur « Ouvrir les annonces » ; lire la liste.
2. Élève : sur « Mon dossier », cliquer sur « Ouvrir les annonces » ; lire la liste.
3. Dans les deux comptes, ouvrir « Messages » et chercher un destinataire sans lien avec la famille (par exemple le nom d'un élève d'une autre famille).
Résultat attendu : le parent voit "Rentrée : réunion d'information des parents (démonstration)" (publiée) et **pas** le brouillon "Brouillon : calendrier des compositions (démonstration)". L'élève ne voit **pas** l'annonce de rentrée sur une base créée après le commit `32c53a91` (audience parents et personnel) ; sur une base plus ancienne elle est visible (donnée de graine périmée, pas une faille). Aucun élève d'une autre famille ne peut être trouvé comme destinataire (rapport QA 12 : recherche "ASSI" vide). Sans la permission de messagerie, la carte « Annonces » et l'entrée de menu n'apparaissent pas.
Cas invalides : sans objet ici.
- [ ] Cas nominal  - [ ] Brouillon invisible  - [ ] Droit refusé : élève et annonce réservée aux parents

## C. Portail enseignant et instituteur

#### 21.24 Aujourd'hui : les séances du jour
Compte : Enseignant (TRAORE Kouadio, Collège Le Baobab) · Où : `/login` puis `/v2/teacher`, menu « Aujourd'hui » · Prérequis : le jour du test est un lundi, mardi, mercredi ou jeudi (jours de cours de la graine) pour voir une séance
1. Se connecter (pas de MFA) ; atterrissage sur `/v2/teacher`.
2. Lire le titre « Aujourd'hui », la description "Vos séances du …" (date du jour) et les deux compteurs « Séances » et « Appels à faire ».
3. Lire chaque séance : matière, classe, horaires, badge (« Appel à faire » ou l'état de l'appel), boutons « Faire l'appel » (ou « Voir l'appel » quand l'appel est soumis) et « Saisir les notes ».
4. Cliquer sur « Faire l'appel » (le déroulé de l'appel est au chapitre 06) puis revenir.
5. Lire le menu latéral et la barre du haut (« Espace enseignant »).
Résultat attendu : séances de la 6e A du jour (08:00 à 10:00). Un jour sans séance : « Aucune séance aujourd'hui. » avec l'aide "Votre emploi du temps du jour est vide. Consultez la semaine dans Mon emploi du temps." Le menu contient « Aujourd'hui », « Mes classes », « Mes évaluations », « Mes appels », « Mon emploi du temps », « Saisie vie scolaire », « Conseils de classe », « Mes bulletins de paie », « Mes congés et ma présence », « Messages », « Annonces », « Mon profil » ; aucune entrée de finance, de structure ou de paramètres.
Cas invalides : erreur de l'API : message du serveur avec le bouton « Réessayer ».
- [ ] Cas nominal  - [ ] Jour vide lisible  - [ ] Droit refusé : `/v2/finance` pour l'enseignant → « Accès refusé »

#### 21.25 Mes classes et élèves d'une classe
Compte : Enseignant · Où : menu « Mes classes » (`/v2/teacher/classes`) puis `/v2/teacher/classes/<id 6e A>` · Prérequis : 21.24
1. Lire le titre « Mes classes » et la description « Les classes où vous êtes affecté aujourd'hui, avec vos matières. ».
2. Lire la carte de la 6e A : nom, code `6E-A`, badge du rôle, matières ("Toutes les matières" pour un généraliste), boutons « Élèves » et « Évaluations ».
3. Cliquer sur « Élèves ».
4. Lire le tableau de légende "Élèves de 6e A" : colonnes « Élève », « Matricule » (masquée sur petit écran), « Statut », et le compteur sous le titre.
5. Cliquer sur le nom d'un élève (ouvre `/v2/students/<id>`, fiche réduite).
6. Revenir avec « Retour à mes classes ».
Résultat attendu : **une seule classe**, la 6e A, avec le badge « Responsable » (rôle LEAD de la graine). Le bouton « Faire l'appel » est **absent** au collège (la politique du cycle est l'appel par séance) et présent au primaire. La liste contient au moins DIABATE Nadia, DIABATE Salimata, BAMBA Aya, … (8 élèves actifs, jusqu'à 12 inscrits : à compter en test). Chaque ligne a un statut en toutes lettres (« Actif »). Si la liste dépasse 200 lignes : "{shown} élèves affichés sur {total}." (non atteint ici). La fiche d'élève ouverte par le nom est la fiche réduite autorisée aux enseignants de la classe (à vérifier : aucun champ sensible du dossier).
Cas invalides : classe sans élève : « Aucun élève inscrit. » avec « Les élèves apparaissent ici dès que leur inscription est confirmée. ».
- [ ] Cas nominal  - [ ] Une seule classe  - [ ] Droit refusé : voir 21.26

#### 21.26 Isolation de l'enseignant : une classe qui n'est pas la sienne
Comptes : Directeur (primaire) pour relever l'identifiant ; Instituteur du CP1 A pour le test · Où : `/v2/teacher/classes/<id Grande Section A>` · Prérequis : le directeur de l'École Les Palmiers ouvre `/v2/academic/classrooms`, clique sur la classe "Grande Section A" et copie l'identifiant de l'adresse
1. Se connecter avec `enseignant@primaire-test.test` (instituteur du CP1 A). Ouvrir « Mes classes » : une seule carte, "CP1 A".
2. Ouvrir `/v2/teacher/classes/<id Grande Section A>`.
3. Ouvrir `/v2/teacher/classes/abc`.
4. Ouvrir `/v2/students` : seuls les élèves du CP1 A sont listés.
5. Se connecter avec `instituteur.maternelle@primaire-test.test` : « Mes classes » ne montre que "Grande Section A".
Résultat attendu : (2) avertissement « Cette classe ne fait pas partie de vos classes. Aucune information ne peut être affichée. » et bouton « Retour à mes classes » ; aucun nom d'élève ; aucune requête de liste d'élèves dans l'onglet Réseau ; (3) page 404 de Next ; (4) liste limitée aux élèves de la classe de l'instituteur (à vérifier) ; (5) la maternelle ne voit pas le CP1 A. Au collège, le même test se fait avec une seconde classe créée au chapitre "Structure académique" ; l'enseignant TRAORE Kouadio n'en est pas titulaire.
Cas invalides : un identifiant bien formé mais inconnu donne le même avertissement.
- [ ] Cas nominal  - [ ] Aucun élève de l'autre classe  - [ ] Droit refusé (404 sur identifiant mal formé)

#### 21.27 Mes congés et ma présence
Compte : Enseignant · Où : menu « Mes congés et ma présence » (`/v2/teacher/leaves`) · Prérequis : fonction "présence du personnel" incluse dans l'offre (sinon « La présence du personnel n'est pas incluse dans votre offre. »)
1. Lire le titre « Ma présence » et la description « Votre pointage, vos congés et leur état. ».
2. Dans « Pointer », cliquer sur « Arrivée » : message « Arrivée enregistrée. » ; plus tard « Départ » : « Départ enregistré. » (crée un pointage réel du jour).
3. Cliquer sur « Demander un congé » : fenêtre « Demander un congé » (aide : « Le congé est soumis à décision. »). Remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Type de congé | le premier type de la liste (par exemple « Congé annuel ») | oui |
   | Premier jour | `2026-10-26` | oui |
   | Dernier jour | `2026-10-28` | oui |
   | Demi-journée le premier jour | décoché | non |
   | Demi-journée le dernier jour | décoché | non |
   | Motif | `Congé test guide` | non |
4. Cliquer sur « Envoyer la demande ».
5. Dans le tableau « Congés », constater la ligne, puis cliquer sur « Annuler ».
Résultat attendu : « Demande de congé envoyée. » ; la ligne affiche le type, la période "du … au …" et le badge « Demandé » ; « Annuler » donne « Congé annulé. » et le badge « Annulé ». La direction des études décide (« Approuver » / « Refuser » côté gestion, chapitre 06) ; l'enseignant ne voit pas ces boutons.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Premier jour `2026-10-28` et dernier jour `2026-10-26` | "La fin du congé précède son début." |
| Type non choisi | message du contrat, formulé techniquement : "Code attendu : majuscules, chiffres et _ (40 max)." (à relever) |
| Premier jour vidé | "Date attendue au format AAAA-MM-JJ." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : `/v2/attendance/staff` (gestion) pour l'enseignant → « Accès refusé » (à vérifier)

#### 21.28 Mon profil d'enseignant : fiche, affectations, coordonnées
Compte : Enseignant · Où : menu « Mon profil » (`/v2/teacher/profile`) · Prérequis : noter les valeurs actuelles
1. Lire le titre « Mon profil » et « Votre fiche et vos coordonnées. ».
2. Lire la fiche (nom, badge « En poste », « Matricule », « Fonction », « Date d'embauche » : "1 sept. 2020" d'après la graine) et « Mes affectations » (6e A, "Toutes les matières").
3. Dans « Mes coordonnées » (formulaire prérempli), modifier :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Adresse e-mail | **ne pas modifier** | non |
   | Téléphone | `+225 07 55 44 33 22` | non |
   | Ville | `Abidjan` | non |
4. Cliquer sur « Enregistrer ».
5. Rétablir les valeurs d'origine.
Résultat attendu : « Coordonnées enregistrées. ». Le formulaire n'a pas de champ « Quartier / résidence » (réservé aux élèves et tuteurs). Aucune modification de la fonction ni de la date d'embauche possible.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Téléphone `123` | "Téléphone trop court." |
| Adresse e-mail `kouadio` | "Adresse e-mail invalide." |
| Aucun champ modifié puis « Enregistrer » | « Aucune modification à enregistrer. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : `/v2/staff` (gestion) pour l'enseignant → « Accès refusé »

#### 21.29 Variantes par établissement : instituteur du primaire, maternelle, supérieur
Comptes : `enseignant@primaire-test.test`, `instituteur.maternelle@primaire-test.test`, `enseignant@superieur-test.test` · Où : `/v2/teacher/classes`, menu · Prérequis : 21.24
1. Instituteur du CP1 A : l'atterrissage est `/v2/primary` (pas `/v2/teacher`). Ouvrir `/v2/teacher/classes` : carte "CP1 A", badge « Titulaire de classe ».
2. Lire le menu : en plus des entrées du 21.24, « Ma classe (primaire) » et « Conseil des maîtres ».
3. Sur la carte de la classe, repérer les boutons d'appel : « Faire l'appel » (un seul par jour) ou un bouton par demi-journée si le cycle en a deux (libellés de `v2AttendanceHalfDays`).
4. Institutrice de maternelle : « Mes classes » ne montre que "Grande Section A".
5. Enseignant du supérieur : carte "Licence 1 A" ; pas d'entrées du pack primaire.
Résultat attendu : le parcours pédagogique du primaire est traité au chapitre "Pack primaire" ; ici on contrôle seulement que le portail s'adapte au cycle (rôle, entrées de menu, politique d'appel) et que chaque titulaire ne voit que sa classe.
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Menu adapté au primaire  - [ ] Droit refusé : 21.26

#### 21.30 Écrans du portail enseignant couverts par d'autres chapitres : câblage du menu
Compte : Enseignant · Où : menu du portail · Prérequis : 21.24
1. Cliquer sur « Mes évaluations » : `/v2/teacher/assessments` (chapitre 08).
2. Cliquer sur « Mes appels » : `/v2/teacher/attendance` (chapitre 06).
3. Cliquer sur « Mon emploi du temps » : `/v2/teacher/schedule` (chapitre 07).
4. Cliquer sur « Mes bulletins de paie » : `/v2/teacher/payslips` (chapitre 13).
5. À chaque page, lire le début du fil d'Ariane.
Résultat attendu : chaque écran s'ouvre **dans la coque du portail enseignant** (le fil d'Ariane commence par « Espace enseignant », le menu reste celui du portail) ; le détail fonctionnel est testé dans les chapitres indiqués. Les adresses `/v2/teacher/assessments/new`, `/v2/teacher/assessments/<id>`, `/v2/teacher/assessments/<id>/grades`, `/v2/teacher/attendance/call`, `/v2/teacher/attendance/call/<kind>/<id>`, `/v2/teacher/schedule/export` et `/v2/teacher/payslips/<id>` appartiennent aux mêmes chapitres.
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Coque du portail conservée  - [ ] Droit refusé : élève ouvrant `/v2/teacher/assessments` → « Accès refusé »

## D. Variantes et gardes communes

#### 21.31 Variantes du parent par établissement : primaire et supérieur
Comptes : `parent@primaire-test.test`, `parent@superieur-test.test` · Où : `/v2/parent` · Prérequis : 21.1
1. Parent du primaire : ouvrir le menu ; si l'entrée « Bulletin et compétences (primaire) » est proposée, l'ouvrir (`/v2/primary/mon-enfant`).
2. Onglet « Absences » d'un enfant du primaire : lire les lignes ; une journée à deux appels distingue le matin et l'après-midi (libellés de `v2AttendanceHalfDays.sessionPart`).
3. Parent du supérieur : onglet « Résultats » d'un étudiant ; repérer « Crédits » ("{acquis} sur {requis}").
4. Onglet « Documents » : la section « Diplômes et attestations » n'apparaît que si des documents sont publiés.
Résultat attendu : mêmes règles d'isolation qu'au collège (seuls les enfants liés). Les rubriques propres au pack (compétences, crédits, diplômes) n'apparaissent qu'avec leur fonction d'offre ; une fonction absente est masquée sans message d'erreur. Contenu précis à relever en test (voir les chapitres de pack).
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Rubriques de pack masquées si absentes  - [ ] Droit refusé : 21.14 dans chaque établissement

#### 21.32 Garde de session, déconnexion et retour arrière
Compte : aucun puis Parent · Où : fenêtre de navigation privée · Prérequis : aucune session ouverte
1. Sans être connecté, ouvrir `/v2/parent`, puis `/v2/student`, puis `/v2/teacher`, puis `/v2/parent/children/00000000-0000-4000-8000-000000000001`.
2. Se connecter en parent, ouvrir un onglet d'enfant, cliquer sur « Se déconnecter ».
3. Utiliser le bouton « Précédent » du navigateur.
4. Dans un second onglet resté connecté avant la déconnexion, recharger une page du portail.
Résultat attendu : étape 1 : redirection immédiate vers `/login`, sans aucune donnée et sans appel de données (le test automatique `e2e/portals-v2.spec.ts` vérifie ces deux points, à 375 px comme sur bureau). Étapes 2 à 4 : retour à la connexion ; aucune donnée privée ne reste affichée ; l'autre onglet est renvoyé vers la connexion (à vérifier).
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Quatre adresses renvoyées vers `/login`  - [ ] Aucune donnée après déconnexion

#### 21.33 Cohérence entre les trois portails : une note n'est visible qu'après publication
Comptes : Enseignant, Parent, Élève · Où : `/v2/teacher/assessments`, `/v2/parent/children/<id Nadia>/results`, `/v2/student/results` · Prérequis : une évaluation de la 6e A créée au chapitre 08 (nom conseillé : `Contrôle test guide`), notes saisies, **non encore publiées**
1. Parent et Élève : vérifier que l'évaluation `Contrôle test guide` et ses notes n'apparaissent pas.
2. Suivre au chapitre 08 le circuit jusqu'à la publication par la direction.
3. Parent et Élève : recharger « Notes publiées ».
Résultat attendu : avant publication, aucune trace (ni titre, ni note, ni absence) ; après publication, la ligne apparaît, avec la même note, chez le parent de Nadia et chez l'élève Nadia, et seulement chez eux pour leurs propres notes. L'enseignant ne voit pas les résultats officiels (moyenne, rang) dans son portail.
Cas invalides : sans objet.
- [ ] Cas nominal  - [ ] Rien avant publication  - [ ] Droit refusé : l'enseignant n'a pas d'écran de résultats officiels

---

## Données créées

| Enregistrement | Scénario | Remarque |
|---|---|---|
| Justificatif d'absence "Rendez-vous médical test guide" (Nadia, 1 jour) | 21.6 | retiré en fin de scénario |
| Justificatif d'absence "Malaise passager test guide" (Nadia, déposé par l'élève) | 21.18 | retiré en fin de scénario |
| Paiements en ligne simulés de Salimata : 20 000 F CFA (confirmé, reçu), 5 001 F CFA (en attente), 5 013 F CFA (échoué) | 21.9 | non supprimables ; le reste dû de Salimata passe à 80 000 F CFA |
| Facture `Frais divers test guide` (10 000 F CFA, Nadia) et paiements 3 000 (confirmé), 3 001 (en attente), 3 013 (échoué) | 21.19 | facture émise par l'économe (chapitre Finance) |
| Contact d'urgence `KONÉ Ibrahim test guide` (Nadia) | 21.12 | retiré en fin de scénario par le secrétariat |
| Coordonnées modifiées puis rétablies : tuteur DIABATE Séka, élève Nadia, enseignant TRAORE Kouadio | 21.13, 21.21, 21.28 | rétablir les valeurs d'origine |
| Demande de congé `Congé test guide` (TRAORE Kouadio, 26 au 28 oct. 2026) | 21.27 | annulée en fin de scénario |
| Pointage « Arrivée » / « Départ » de TRAORE Kouadio (jour du test) | 21.27 | facultatif ; corrigeable par la direction |

## Écarts constatés

| Écran | Constat | Gravité |
|---|---|---|
| `/v2/parent/children/<id>/attendance`, `/v2/student/attendance` (fenêtre « Déposer un justificatif ») | La ligne "Élève : …" affiche l'identifiant (UUID) de l'élève au lieu de son nom : `PortalScreen` ne transmet pas `studentLabel`. | Mineur |
| mêmes écrans, cartes de justificatifs | "Motif : ILLNESS" : code brut au lieu du libellé « Maladie » (constat QA C-12-03 et C-13-03). | Mineur |
| mêmes écrans, motif non choisi | Message du contrat formulé techniquement : "Code attendu : majuscules, chiffres et _ (40 max)." (aussi pour le type de congé de `/v2/teacher/leaves`). | Mineur |
| `/v2/teacher/leaves` | Colonne « Type » : code brut du type de congé affiché tel quel. | Mineur |
| `/v2/parent/children/<id>/emergency` | Liste des responsables : le code de la relation (`relationshipCode`) est affiché brut. | Mineur |
| `/v2/parent/children/<id>/results`, `/v2/student/results` | "Décision : <code>" et état de ligne affichés en code quand le libellé n'est pas connu des familles (point à arbitrer dans `apps/web/docs/v2-portals.md`) ; aucun bandeau « Règles de démonstration » (QA C-13-02). | Mineur |
| `/v2/parent/children/<id>/finance/receipts/<id>` | Le reçu ne porte pas la mention de paiement simulé (QA C-12-02, "reçu : à faire"). | Suggestion |
| `/v2/parent/children/abc`, `/v2/student/finance/receipts/abc`, `/v2/teacher/classes/abc` | Un identifiant mal formé produit la page 404 par défaut de Next, sans habillage ni message en français (aucun `not-found.tsx` dans `apps/web/src/app`). | Mineur |
| `/v2/parent/children/<id>/documents` | Le rôle Parent détient `documents.child.upload` mais l'onglet est en lecture seule : le dépôt de document par le parent n'a aucun écran dans le portail (QA C-12-06 ; texte d'aide de l'état vide à adapter). | Suggestion |
| `/v2/student/me` | Écran sans lien de menu (accessible seulement par adresse) ; fait doublon partiel avec `/v2/student/profile`. | Suggestion |
| `/v2/finance/me/<id>` et onglet « Scolarité » | Deux écrans différents pour la même fonction de paiement, avec des libellés différents (« Payer en ligne » / « Lancer le paiement », « Facture à payer » / « Facture à régler »). | Suggestion |
| `/v2/parent/children/<id>/attendance` | L'absence reste « À justifier » après dépôt, le justificatif étant listé à part (QA C-12-05, C-13-05). | Suggestion |

## À vérifier en test

- Le pointage d'une absence pour Nadia ou Salimata dans la graine (lignes « À justifier » au 21.6).
- Le texte du motif de l'échec "013" (« Le paiement a échoué : … »).
- Le comportement du reste à payer après un paiement « En attente » (001).
- L'entrée « Bulletin et compétences (primaire) » au collège (absente ?) et l'accès de l'éducateur à `/v2/teacher/profile` (il détient `staff.own.read`).
- Le nombre exact d'élèves de la liste de classe de la 6e A (8 ou 12).
- La visibilité chez le parent d'un justificatif déposé par l'élève.
- Le libellé et la présence de « Retiré » après retrait d'un justificatif.
- Le PDF des bulletins porte-t-il la mention de démonstration (texte compressé, non lu par le QA) ?
- L'offre du Collège Le Baobab inclut-elle la présence du personnel (`attendance.staff`) pour le 21.27 ?

## Non couvert / limites connues

- Écrans `/v2/teacher/assessments` et ses sous-pages, `/v2/teacher/attendance`, `/v2/teacher/schedule`, `/v2/teacher/payslips` et ses sous-pages : chapitres 08, 06, 07 et 13 (câblage du menu au 21.30).
- Routes famille d'autres modules (`/v2/finance/me`, `/v2/attendance/children`, `/v2/reportcards/family`, `/v2/councils/famille`, `/v2/schoollife/famille`, `/v2/examinations/family`, `/v2/stateassign/family`, `/v2/primary/mon-enfant`, `/v2/higher/me/documents`, `/v2/students/children`) : listées dans la matrice, testées dans leurs chapitres.
- Devoirs à rendre, supports de cours, visioconférence : absents de la nouvelle plateforme (`apps/web/docs/v2-portals.md`, "Parité avec le legacy").
- Parcours détaillé de l'étudiant du supérieur (`useFamilyPathway`) : écran non livré.
- Aucun sélecteur de langue ni de thème dans les portails (le thème suit le système, voir chapitre 22).
- Dépôt de pièce jointe d'un justificatif : la fenêtre le permet, mais aucun fichier de test n'est fourni ici (le stockage dépend de la configuration).
