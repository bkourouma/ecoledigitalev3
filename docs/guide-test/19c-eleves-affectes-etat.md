# Chapitre 19c. Pack secondaire : élèves affectés par l'État

> Établissement : Collège Le Baobab (démonstration), `secondaire-test`, pack Secondaire uniquement. Adresse du navigateur : `http://localhost:3000`. Durée estimée : 2 h 30 à 3 h.
> Troisième des trois parties du chapitre 19 (19a vie scolaire, 19b conseils de classe, 19c élèves affectés par l'État). Les scénarios sont numérotés 19.54 à 19.72.

## Objectif

Vérifier le cycle d'un élève **affecté par l'État** (financement « Affecté par l'État ») : le secrétariat **enregistre** l'acte d'affectation (dossier « Enregistré ») ; la direction **vérifie** (une autre personne que l'enregistrant : la vérification porte la référence d'affectation sur l'inscription) puis **active** ; l'économe **rapproche** les montants de l'acte avec la facturation (écart = facturé − déclaré, statut calculé, jamais saisi), planifie et suit la **créance sur l'État** (versements attendus, reçus, retards), planifie des **contrôles** réalisés par une personne ; la direction obtient les **états** et exports CSV. La famille ne voit que le statut du dossier de son enfant, jamais les montants de l'État.

Limites à garder en tête : aucune passerelle vers une plateforme de l'État n'existe (saisie 100 % manuelle) ; aucune règle officielle ni barème n'est livré (tolérance à zéro, aucun contrôle exigé, délai de grâce à zéro) ; **le reversement des fonds partagés n'est pas modélisé** (limite connue, voir en fin de fichier).

## Prérequis

- Base de démonstration fraîche, application et API démarrées ; conventions du chapitre 19a (comptes via `/login`, "J" = jour du test, noms "test guide").
- Monnaie : franc CFA, **montants entiers** affichés "120 000 F CFA". Saisir sans décimale ni signe ; les espaces dans "120 000" sont acceptés.
- **Choix des élèves** : le dossier de démonstration concerne ADOU Aïcha. Pour les essais on utilise deux élèves de la graine dont l'inscription est encore "en attente" et qui ne sont liés à aucun compte de test : **N'GUESSAN Aya** (dossier complet, AFF-TG-0001) et **N'GUESSAN Koffi** (dossier rejeté, AFF-TG-0002). La vérification d'un dossier fixe le financement « Affecté par l'État » de l'inscription correspondante : **aucun nettoyage n'existe dans l'application** (réinitialiser la base pour repartir de zéro). Ne pas utiliser DIABATE Nadia ni DIABATE Salimata (comptes parent et élève).

## Comptes à utiliser (établissement `secondaire-test`)

| Rôle | E-mail | MFA | Rôle dans ce chapitre |
|---|---|---|---|
| Secrétariat | `secretariat@secondaire-test.test` | oui | **Enregistre** et corrige un dossier, rattache des pièces. Ne vérifie pas. |
| Directeur | `directeur@secondaire-test.test` | oui | **Vérifie**, rejette, active, suspend, reprend, termine, amende, règle le module. |
| Propriétaire | `direction.generale@secondaire-test.test` | oui | Deuxième personne de direction (vérifie un dossier enregistré ou amendé par le directeur). |
| Économe | `econome@secondaire-test.test` | oui | **Rapproche**, planifie les créances, réalise les contrôles, exporte. |
| Directeur des études | `etudes@secondaire-test.test` | oui | Lecture seule. |
| Parent (DIABATE Séka) | `parent@secondaire-test.test` | non | Vue famille (statut seulement). |
| Enseignant, éducateur, élève | `enseignant@…`, `educateur@…`, `eleve@secondaire-test.test` | non | Aucun accès (contrôle de droit). |

## Droits (qui peut ouvrir quoi)

Source : gardes de page `apps/web/src/app/v2/stateassign/**/page.tsx` (`stateassign/_components/permissions.ts`), manifeste `apps/api/src/modules/stateassign/manifest.ts`, modèles de rôles `rbac/templates/system-roles.ts`.

| Écran | Adresse | Directeur / Propriétaire | Secrétariat | Économe | Dir. études | Parent | Autres |
|---|---|---|---|---|---|---|---|
| Liste des dossiers | `/v2/stateassign` | oui | oui | oui | oui (lecture) | non | non |
| Fiche d'un dossier | `/v2/stateassign/<identifiant>` | oui | oui | oui | oui (lecture) | non | non |
| Vérification | `/v2/stateassign/verification` | oui | non | non | non | non | non |
| Rapprochement | `/v2/stateassign/reconciliation` | oui | oui (lecture) | oui | oui (lecture) | non | non |
| Créances | `/v2/stateassign/receivables` | oui | oui (lecture) | oui | oui (lecture) | non | non |
| États et exports | `/v2/stateassign/reports` | oui | oui (sans export) | oui | oui (sans export) | non | non |
| Paramètres | `/v2/stateassign/settings` | oui | non | non | non | non | non |
| Affectation de mon enfant | `/v2/stateassign/family` | non | non | non | non | oui | non |

Actions : enregistrer et corriger = secrétariat, directeur ; vérifier, rejeter = directeur ; activer, suspendre, reprendre, terminer, transférer = directeur ; amender = directeur ; rapprocher, planifier ou annuler une créance, planifier et réaliser un contrôle, exporter = économe, directeur ; pièces = secrétariat, directeur.

**Adresses à taper à la main, qui doivent être refusées** (page « Accès refusé » avec le texte "Vous n'avez pas les droits nécessaires pour afficher cette page.") :

| Compte | Adresses interdites |
|---|---|
| Secrétariat | `/v2/stateassign/verification`, `/v2/stateassign/settings` |
| Économe | `/v2/stateassign/verification`, `/v2/stateassign/settings` |
| Directeur des études | `/v2/stateassign/verification`, `/v2/stateassign/settings` |
| Parent | `/v2/stateassign`, `/v2/stateassign/receivables`, `/v2/stateassign/reports`, `/v2/stateassign/settings` |
| Enseignant, éducateur, élève | `/v2/stateassign`, `/v2/stateassign/family`, `/v2/stateassign/reconciliation` |

## Données de départ (graine de démonstration)

Source : `scripts/seed-v2/demo/stateassign.ts` (appelé après les admissions) ; l'élève est la première candidate inscrite par la campagne `RENTREE-6E`.

| Élément | Contenu |
|---|---|
| Élève | **ADOU Aïcha**, 6e A (aucun compte de portail) |
| Dossier | référence **`AFF-DEMO-0001`**, version 1, source « Saisie », enregistré par le secrétariat, **« Vérifié »** par le directeur, **pas encore « Actif »** |
| Montants déclarés | part de l'État **120 000 F CFA**, part de la famille **80 000 F CFA** (60 % / 40 % de la scolarité de 200 000 F CFA) |
| Facturation | la facture de scolarité est scindée : 120 000 F CFA à la charge de l'État, 80 000 F CFA à la charge de la famille, plus la facture d'inscription de 25 000 F CFA déjà payée par la famille |
| Rapprochement attendu | « Écart » : la part de la famille rapprochée inclut les frais d'inscription (écart famille de 25 000 F CFA attendu, écart État 0) ; **à vérifier** (rapport QA 05) |
| Créance | une échéance « Versement unique de l'État (démonstration) », 120 000 F CFA attendus, J+45 de la graine, **0 reçu**, statut « À recevoir » |
| Réglages | séparation des tâches active ; tolérance 0 ; aucun contrôle exigé ; délai de grâce 0 jour ; aucun format d'export |
| Contrôles, pièces | aucun |

## Données créées par ce chapitre (résumé ; liste en fin de fichier)

Deux dossiers `AFF-TG-0001` (cycle complet, puis version 2 par avenant, finalement « Terminé ») et `AFF-TG-0002` (« Rejeté »), échéances, contrôles, un format d'export `tg-dossiers` (désactivé à la fin).

---

## Partie A. Lecture

#### 19.54 Liste des dossiers d'affectation
Compte : Secrétariat · Où : menu « Affectés de l'État » > "Élèves affectés" (`/v2/stateassign`) · Prérequis : base intacte.
1. Ouvrir "Élèves affectés". Lire le titre « Élèves affectés par l'État », les onglets « Dossiers », « Vérification » (absent pour le secrétariat), « Rapprochement », « Créances », « États » (« Paramètres » absent).
2. Lire le tableau « Dossiers d'affectation » : colonnes « Référence », « Élève », « Statut », « Part de l'État (acte) », « Part de la famille (acte) », « Rapprochement ».
3. Saisir `DEMO` dans « Référence » (placeholder « Rechercher une référence d'affectation »), puis `ZZZ`.
4. Choisir « Statut » = « Vérifié », puis « Actif », puis « Tous les statuts ». Cocher « Inclure les versions remplacées et les dossiers rejetés ».

Résultat attendu : une ligne `AFF-DEMO-0001` v1, élève ADOU Aïcha, statut « Vérifié », 120 000 F CFA et 80 000 F CFA, rapprochement « Écart » (ou « Conforme » ou « Jamais rapproché » : à relever). Le bouton « Enregistrer un dossier » est visible (droit d'enregistrer). Avec `ZZZ` : « Aucun dossier ne correspond. » et « Enregistrez l'acte d'affectation d'un élève pour ouvrir son dossier. ». Avec « Actif » : même message vide. Le filtre « Vérifié » garde la ligne. La pagination n'apparaît qu'au-delà d'une page.
- [ ] Cas nominal  - [ ] État vide  - [ ] Droit refusé pour l'enseignant (`/v2/stateassign`)

#### 19.55 Fiche du dossier de démonstration (lecture)
Compte : Directeur · Où : liste > `AFF-DEMO-0001` (`/v2/stateassign/<identifiant>`) · Prérequis : base intacte.
1. Ouvrir la fiche. Lire le titre « Dossier AFF-DEMO-0001 (version 1) » et le bouton « Retour à la liste ».
2. Lire la section « Dossier » : « Autorité émettrice », « Date de l'acte », « Source », « Enregistré le », « Vérifié le », « Note de vérification ».
3. Lire la phrase sous le résumé sur l'inscription et les boutons d'actes.
4. Lire « Parts de l'État et de la famille » (tableau « Montants déclarés, facturés et écarts par part »).
5. Lire « Créances sur l'État », « Contrôles », « Pièces du dossier », « Versions et historique ».

Résultat attendu : statut « Vérifié », source « Saisie ». Étape 3 : phrase "L'inscription porte la référence d'affectation de ce dossier" suivie de la référence entre guillemets, et boutons « Activer », « Amender », « Rapprocher avec la facturation », « Rejeter » (le directeur n'a pas « Corriger » : réservé à l'état « Enregistré »). Étape 4 : colonnes « Part », « Déclaré », « Facturé », « Écart » ; ligne « État » 120 000 F CFA déclaré ; ligne « Famille » 80 000 F CFA déclaré ; la phrase "Dernier rapprochement : …" ou « Ce dossier n'a pas encore été rapproché avec la facturation. ». Si le statut est « Écart » : l'avertissement « Les montants facturés ne correspondent pas à l'acte (au-delà de la tolérance de l'établissement) : corrigez la facturation ou créez un avenant si l'acte a changé. ». Étape 5 : une échéance « 1. Versement unique de l'État (démonstration) » 120 000 F CFA attendus, 0 reçu, « À recevoir » ; « Aucun contrôle. » ; « Aucune pièce rattachée. » ; la version 1 et les événements « Dossier créé », « Changement de statut » (Enregistré → Vérifié) avec « par une personne ».
- [ ] Cas nominal  - [ ] Valeurs relevées  - [ ] Droit refusé pour le parent (`/v2/stateassign/<identifiant>`)

---

## Partie B. Enregistrer, corriger, rejeter, vérifier, activer

#### 19.56 Enregistrer un dossier d'affectation (secrétariat)
Compte : Secrétariat · Où : `/v2/stateassign` > « Enregistrer un dossier » · Prérequis : aucun.
1. Cliquer sur « Enregistrer un dossier » (fenêtre « Enregistrer un dossier d'affectation ») et remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Élève | N'GUESSAN Aya (taper `GUESSAN` puis choisir) | oui |
   | Inscription | l'unique inscription proposée (libellé du type "numéro · PENDING · PRIVATE" : codes bruts) | oui |
   | Référence d'affectation | AFF-TG-0001 | oui |
   | Date de l'acte | 1er septembre de l'année scolaire en cours (sélecteur de date) | non |
   | Autorité émettrice | Autorité fictive test guide | non |
   | Part de l'État (montant déclaré) | 120 000 | non |
   | Part de la famille (montant déclaré) | 75 000 (volontairement erroné, corrigé en 19.57) | non |
   | Notes | Dossier test guide | non |
2. Cliquer sur « Enregistrer le dossier ».

Résultat attendu : la page de la fiche s'ouvre : « Dossier AFF-TG-0001 (version 1) », statut « Enregistré », montants 120 000 F CFA / 75 000 F CFA, phrase « Dossier non vérifié : l'inscription ne porte pas encore sa référence d'affectation. ». L'encadré de la fenêtre rappelait que l'enregistrement ne vaut pas vérification. Le secrétariat voit « Corriger » et « Rapprocher… » absent (pas de droit), et **aucun bouton « Vérifier le dossier »**.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Aucune inscription choisie | « Choisissez l'inscription concernée. » |
| Référence vide | « La référence d'affectation est obligatoire. » |
| Part de l'État "12,5" | « Saisissez un nombre entier de francs (sans décimale ni signe). » |
| Part de l'État "-5000" | « Saisissez un nombre entier de francs (sans décimale ni signe). » |
| Part de la famille "abc" | « Saisissez un nombre entier de francs (sans décimale ni signe). » |
| Référence `AFF-DEMO-0001` (déjà portée) | message du serveur "Cette référence d'affectation est déjà portée par un autre dossier de l'établissement pour cette année." |
| Même inscription que le dossier en cours (second dossier pour N'GUESSAN Aya) | message du serveur "Cette inscription a déjà un dossier d'affectation en cours : le corriger, le remplacer par un avenant ou le terminer." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'économe (aucun bouton « Enregistrer un dossier »)

#### 19.57 Corriger un dossier avant vérification
Compte : Secrétariat · Où : fiche de `AFF-TG-0001` > « Corriger » · Prérequis : 19.56.
1. Cliquer sur « Corriger » (fenêtre « Corriger le dossier (avant vérification) »).
2. Mettre « Part de la famille (montant déclaré) » à 80 000 et vider « Référence d'affectation », puis « Enregistrer ».
3. Remettre la référence `AFF-TG-0001` et « Enregistrer ».

Résultat attendu : référence vide refusée avec « La référence d'affectation est obligatoire. » ; ensuite « Dossier corrigé. » et la fiche affiche 80 000 F CFA pour la famille. Après la vérification, « Corriger » disparaît : le fond est figé (voir 19.66, avenant).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Bouton absent hors état « Enregistré »

#### 19.58 Quatre yeux et rejet (dossier AFF-TG-0002)
Compte : Directeur · Où : `/v2/stateassign` · Prérequis : MFA.
1. Directeur : « Enregistrer un dossier » pour **N'GUESSAN Koffi**, référence `AFF-TG-0002`, part de l'État 120 000, part de la famille 80 000, notes "Dossier test guide à rejeter".
2. Sur la fiche, cliquer sur « Vérifier le dossier » (fenêtre « Vérifier le dossier d'affectation »), lire « Vous ne pouvez pas vérifier un dossier que vous avez vous-même enregistré (sauf réglage de l'établissement). », puis cliquer sur « Vérifier ».
3. Cliquer sur « Rejeter », saisir "No" puis valider, puis "Rejet test guide : acte non conforme" et cliquer sur « Rejeter le dossier ».
4. Enregistrer de nouveau la référence `AFF-TG-0002` pour N'GUESSAN Koffi, puis la rejeter de la même façon.

Résultat attendu : étape 2 : refus du serveur "La vérification doit venir d'une autre personne que celle qui a enregistré le dossier." ; le dossier reste « Enregistré ». Étape 3 : motif court refusé avec « Le motif doit comporter au moins 5 caractères. » ; ensuite « Dossier rejeté. », statut « Rejeté », ligne « Motif de rejet ». Étape 4 : la référence redevient disponible (« Le rejet est motivé et définitif pour cette version ; la référence redevient disponible. ») : l'enregistrement est accepté. Les dossiers rejetés n'apparaissent dans la liste qu'avec la case « Inclure les versions remplacées et les dossiers rejetés ».
- [ ] Cas nominal (refus affiché)  - [ ] Cas invalide  - [ ] Rejet possible par le proposant

#### 19.59 Vérifier un dossier (une autre personne que l'enregistrant)
Compte : Directeur · Où : menu « Affectés de l'État » > « Vérification des affectations » (`/v2/stateassign/verification`) · Prérequis : 19.57.
1. Ouvrir « Vérification des affectations ». Lire le texte « Par défaut, vous ne pouvez pas vérifier un dossier que vous avez enregistré vous-même : une deuxième personne est exigée. Aucune vérification n'est jamais automatique. ».
2. Dans « Afficher », garder « À vérifier » : la liste contient `AFF-TG-0001` (le dossier `AFF-TG-0002` rejeté n'y figure plus). Colonnes « Référence », « Élève », « Autorité émettrice », « État / famille (acte) », « Enregistré le », « Statut ».
3. Cliquer sur « Examiner », puis « Vérifier le dossier », saisir la note "Vérification test guide" et cliquer sur « Vérifier ».
4. Dans « Afficher », choisir « Vérifiés, à activer ».

Résultat attendu : « Dossier vérifié : la référence d'affectation est portée sur l'inscription. », statut « Vérifié », phrase "L'inscription porte la référence d'affectation de ce dossier" avec `AFF-TG-0001`. Le dossier est dans « Vérifiés, à activer » ; liste vide : « Aucun dossier n'attend de vérification. » / « Aucun dossier vérifié n'attend son activation. ». Si le rattachement à l'inscription est refusé (inscription en attente, financement), un message du serveur "L'inscription n'a pas pu être rattachée à l'affectation : …" s'affiche : à relever. Le directeur des études et le secrétariat n'ont pas la page (`/v2/stateassign/verification` refusée).
- [ ] Cas nominal  - [ ] État vide  - [ ] Droit refusé pour le secrétariat (`/v2/stateassign/verification`)

#### 19.60 Activer, suspendre, reprendre
Compte : Directeur · Où : fiche de `AFF-TG-0001` · Prérequis : 19.59.
1. Cliquer sur « Activer » : la fenêtre « Activer ce dossier d'affectation ? » rappelle que l'activation rattache la référence à l'inscription. Cliquer sur « Annuler » puis recommencer et confirmer par « Activer le dossier ».
2. Cliquer sur « Suspendre » (fenêtre « Suspendre le dossier »), saisir "No" puis valider, puis "Suspension test guide : pièce manquante" et cliquer sur « Suspendre ».
3. Cliquer sur « Reprendre ».

Résultat attendu : « Dossier activé. », statut « Actif » ; la fenêtre de confirmation décrit « ouvre le suivi de la créance sur l'État » alors que l'activation ne génère ni facture scindée ni échéance (E-19c-2). Étape 2 : motif court refusé avec « Le motif doit comporter au moins 5 caractères. » ; ensuite « Dossier suspendu. », statut « Suspendu », ligne « Motif de suspension ». Étape 3 : « Dossier repris. » (aucune confirmation), statut « Actif ». L'historique ajoute chaque changement de statut.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : le secrétariat et l'économe n'ont pas « Activer »

---

## Partie C. Rapprochement, créances, contrôles

#### 19.61 Rapprochement des affectations
Compte : Économe · Où : menu « Affectés de l'État » > « Rapprochement des affectations » (`/v2/stateassign/reconciliation`) · Prérequis : 19.60 pour le dossier test.
1. Ouvrir la page. Lire le titre « Rapprochement des affectations » et l'encadré "L'écart est facturé moins déclaré. Le statut Conforme ou Écart est calculé avec la tolérance de l'établissement (zéro par défaut) : il ne se saisit pas.".
2. Lire les trois compteurs (« Jamais rapproché », « Conforme », « Écart ») et la liste « Afficher les dossiers » (valeur par défaut « Écart »).
3. Sur la ligne de `AFF-DEMO-0001`, cliquer sur « Rapprocher ».
4. Afficher « Jamais rapproché » : repérer `AFF-TG-0001` et cliquer sur « Rapprocher ».
5. Ouvrir la fiche de `AFF-TG-0001` : cliquer sur « Rapprocher avec la facturation ».

Résultat attendu : compteurs sur base intacte avec la seule graine : « Écart » 1 (`AFF-DEMO-0001`, écart famille 25 000 F CFA attendu, écart État 0) ; avec le dossier test, « Jamais rapproché » 1 avant l'étape 4. Étape 3 : « Dossier AFF-DEMO-0001 rapproché. ». Pour `AFF-TG-0001` : l'élève n'ayant ni facture scindée ni facture de scolarité, la part de l'État facturée est 0 (écart − 120 000 F CFA) et le statut devient « Écart » (valeurs à relever). Étape 5 : « Rapprochement fait : un écart subsiste entre l'acte et la facturation. » (ou « Rapprochement fait : la facturation est conforme à l'acte. » si les montants coïncident). Rapprocher deux fois de suite donne le même état. Le directeur des études et le secrétariat voient la page sans bouton « Rapprocher ». Sous les compteurs, « Contrôles à faire et anomalies » : « Aucun contrôle à faire. » et « Aucune anomalie en cours. » tant qu'aucun contrôle n'est planifié (19.64).
- [ ] Cas nominal  - [ ] Valeurs relevées  - [ ] Droit refusé pour l'enseignant (`/v2/stateassign/reconciliation`)

#### 19.62 Planifier et suivre la créance sur l'État
Compte : Économe · Où : fiche de `AFF-TG-0001` > « Créances sur l'État » · Prérequis : 19.60 (dossier « Actif », part de l'État déclarée 120 000 F CFA).
1. Lire « Aucune échéance planifiée. » et « Planifiez les versements attendus de l'État. Leur total ne peut pas dépasser la part de l'État déclarée. ».
2. Cliquer sur « Planifier une échéance » et remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Libellé | Versement test guide 1 | oui |
   | Date d'échéance | J+30 | oui |
   | Montant attendu | 70 000 | oui (entier supérieur à zéro) |
   Cliquer sur « Planifier ».
3. Planifier une seconde échéance "Versement test guide 2", J+60, 50 000.
4. Tenter une troisième : "Versement test guide 3", J+90, 10 000.
5. Sur l'échéance 1, cliquer sur « Modifier » : passer le montant à 60 000, « Enregistrer ». Cliquer sur « Historique ».
6. Sur l'échéance 2, cliquer sur « Annuler » (fenêtre « Annuler l'échéance »), saisir "No" puis valider, puis "Annulation test guide : versement regroupé" et cliquer sur « Annuler l'échéance ».
7. Replanifier "Versement test guide 3", J+90, 60 000.

Résultat attendu : étape 2 : la ligne "1. Versement test guide 1" 70 000 F CFA, 0 reçu, « À recevoir » ; le résumé affiche « Attendu » 70 000 F CFA, « Reste à recevoir » 70 000 F CFA, « Non planifié » 50 000 F CFA. Étape 3 : attendu 120 000 F CFA. Étape 4 : refus du serveur dont le message commence par "les échéances" et mentionne le montant déclaré à la charge de l'État (somme supérieure à 120 000). Étape 5 : "Historique de l'échéance" suivi du libellé liste « Échéance planifiée » puis « Montant attendu modifié » avec le détail 70 000 → 60 000. Étape 6 : motif court refusé avec « Le motif doit comporter au moins 5 caractères. » ; ensuite l'échéance passe « Annulé » (historique « Échéance annulée ») et son montant libère le plafond. Étape 7 : accepté (60 000 + 60 000 = 120 000).
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Libellé vide | « Le libellé est obligatoire. » |
| Montant 0 | « Saisissez un nombre entier de francs, supérieur à zéro. » |
| Montant "1,5" | « Saisissez un nombre entier de francs, supérieur à zéro. » |
| Date d'échéance vide | « Date invalide (AAAA-MM-JJ). » |
| Planifier sur un dossier « Enregistré » (ex. un nouveau dossier non vérifié) | le bouton « Planifier une échéance » est absent ; le serveur répondrait "Une échéance se planifie sur un dossier vérifié, actif ou suspendu" |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat (aucun bouton « Planifier une échéance »)

#### 19.63 Créances de l'établissement et ancienneté ; versement de l'État
Compte : Économe · Où : menu « Affectés de l'État » > « Créances sur l'État » (`/v2/stateassign/receivables`) · Prérequis : 19.62.
1. Ouvrir « Créances sur l'État ». Lire la section « Ancienneté des créances » (« Situation au … ») : « Attendu », « Reçu », « Reste à recevoir », « En retard », et le tableau « Reste à recevoir par tranche de retard » (« Non échu », « 1 à 30 jours de retard », … « Plus de 90 jours de retard »).
2. Lire le tableau « Échéances des créances sur l'État » (colonnes « Élève », « Dossier », « Échéance », « Date », « Attendu », « Reçu », « Reste », « Statut »). Cliquer sur le nom d'un élève.
3. Filtres : « Statut » (« À recevoir », « Partiellement reçu », « Reçu », « Annulé »), « Échéance à partir du », « Échéance jusqu'au », case « Seulement les échéances en retard ».
4. **Versement de l'État** : dans le chapitre Finance, enregistrer un paiement dont « Qui paie ? » est un financeur pour ADOU Aïcha, montant 120 000, puis revenir ici.

Résultat attendu : toutes les échéances (celle de la graine, 120 000 F CFA attendus, et les échéances test guide) sont listées ; le total « Attendu » est leur somme ; « Non échu » compte les échéances futures ; « En retard » vaut 0 tant qu'aucune échéance n'est dépassée. Le filtre « Seulement les échéances en retard » donne « Aucune échéance ne correspond. » et « Les échéances se planifient sur la fiche de chaque dossier. ». Étape 4 (**à vérifier en test**, hors de ce chapitre) : le montant reçu vient des paiements du financeur enregistrés dans les finances ; le champ « Référence du financeur » attend l'identifiant de la prise en charge (« Identifiant de la bourse ou de la prise en charge. »), pas la référence d'affectation `AFF-DEMO-0001` (écart E-19c-1) ; après un versement rapproché, l'échéance passe « Partiellement reçu » ou « Reçu ». Le reversement des fonds partagés n'est pas modélisé.
- [ ] Cas nominal  - [ ] État vide d'un filtre  - [ ] Droit refusé pour le parent (`/v2/stateassign/receivables`)

#### 19.64 Contrôles d'un dossier
Compte : Économe · Où : fiche de `AFF-TG-0001` > « Contrôles » · Prérequis : 19.60.
1. Lire « Aucun contrôle. » et « Aucun contrôle n'est exigé par défaut : l'établissement choisit les natures et le rythme dans ses paramètres. ».
2. Cliquer sur « Planifier un contrôle » (fenêtre du même nom) : Nature du contrôle = « Identité », Date d'échéance = J+15, « Planifier ».
3. Cliquer sur « Réaliser » : Résultat = « Conforme », « Consigner le résultat ».
4. Planifier « Pièces », J+15 ; cliquer sur « Réaliser » : Résultat = « Anomalie », Constat vide puis "No", puis "Constat test guide : pièce illisible" ; « Consigner le résultat ».
5. Sur l'anomalie, cliquer sur « Résoudre », saisir la résolution "Résolution test guide : pièce fournie" et valider par « Résoudre l'anomalie ».
6. Planifier « Autre », J+20 ; cliquer sur « Dispenser », motif "No" puis "Dispense test guide : sans objet", « Dispenser ».
7. Planifier de nouveau « Identité » avec la même date.
8. Planifier « Présence » sans choisir de période.

Résultat attendu : le contrôle apparaît « À faire » ; après étape 3 « Conforme » ; étape 4 : un constat vide ou de moins de 5 caractères est refusé avec « Un constat de 5 caractères minimum est requis pour une anomalie. » ; ensuite statut « Anomalie » avec le constat ; étape 5 : la résolution s'affiche (« Résolution : … ») ; étape 6 : motif court refusé avec « Le motif doit comporter au moins 5 caractères. », puis statut « Dispensé ». Étape 7 : refus du serveur "Ce contrôle existe déjà pour cette nature et cette période." Étape 8 : « Choisissez la période à contrôler. ». Un contrôle n'est jamais réalisé automatiquement ("L'application planifie, une personne réalise"). Sur `/v2/stateassign/reconciliation`, la section « Contrôles à faire et anomalies » liste les contrôles « À faire » (cocher ou décocher « Seulement les contrôles dont l'échéance est dépassée ») et les anomalies non résolues.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : le secrétariat n'a aucun bouton de contrôle

#### 19.65 Pièces d'un dossier (si le chapitre Documents a créé un document)
Compte : Secrétariat · Où : fiche de `AFF-TG-0001` > « Pièces du dossier » · Prérequis : un document "test guide" lisible par le secrétariat dans la gestion documentaire.
1. Cliquer sur « Rattacher une pièce » (fenêtre du même nom) : Nature de la pièce = « Acte d'affectation », Document = le document test guide, Libellé "Acte test guide", Reçue le = un jour de la semaine passée. « Rattacher ».
2. Rattacher le même document une seconde fois.
3. Cliquer sur « Retirer » en face de la pièce : motif "No" puis "Retrait test guide : mauvais fichier", « Retirer la pièce ».

Résultat attendu : la pièce apparaît avec le badge « Active » ; la seconde tentative est refusée ("Ce document est déjà rattaché au dossier.") ; sans document choisi : « Choisissez un document. » ; après retrait : badge « Retirée » et « Retirée : … ». Si aucun document n'existe, cette étape est à noter "non exécutée".
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'économe (aucun bouton « Rattacher une pièce »)

---

## Partie D. Avenant, fin de dossier, états, paramètres

#### 19.66 Avenant : nouvelle version à vérifier par une autre personne
Compte : Directeur puis Propriétaire · Où : fiche de `AFF-TG-0001` > « Amender » · Prérequis : 19.60 (dossier « Actif »).
1. Cliquer sur « Amender » (fenêtre « Avenant : version 2 »). Lire l'explication : le contenu d'un dossier vérifié ne se modifie pas.
2. Valider sans rien saisir. Puis remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Motif de l'avenant | Avenant test guide : part de la famille corrigée | oui (5 caractères) |
   | Date d'effet | J | oui |
   | Nouvelle référence | laisser vide | non |
   | Part de la famille (nouveau montant déclaré) | 85 000 | non |
   Cliquer sur « Créer l'avenant ».
3. Lire « Versions et historique ».
4. Directeur : tenter « Vérifier le dossier » sur la version 2.
5. Propriétaire (`direction.generale@`) : ouvrir `/v2/stateassign/verification`, « Examiner » la version 2, « Vérifier le dossier », puis le directeur clique sur « Activer ».
6. Tenter un avenant sans changement avec un motif valable.

Résultat attendu : étape 2 : un formulaire incomplet donne « Un motif de 5 caractères minimum est requis. » et « Date invalide (AAAA-MM-JJ). » ; ensuite « Avenant créé : la nouvelle version attend sa vérification. ». La fiche s'ouvre en version 2 « Enregistré » ; la version 1 est « Remplacé » (fin le jour d'effet). L'inscription garde la référence actuelle jusqu'à la vérification de la nouvelle version. Étape 4 : refus du serveur "La vérification doit venir d'une autre personne que celle qui a enregistré le dossier." (l'amendeur est l'enregistrant de la version 2). Étape 5 : "Dossier vérifié : …" puis « Dossier activé. ». Étape 6 : refus du serveur "L'avenant ne change ni la référence, ni l'autorité, ni la date, ni les montants.". Un montant de l'État inférieur aux échéances planifiées est refusé avec "le montant déclaré à la charge de l'État" suivi du total planifié (message à relever).
Cas invalide : part de la famille "85,5" refusée avec « Saisissez un nombre entier de francs (sans décimale ni signe). ».
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Quatre yeux appliqué  - [ ] Droit refusé : « Amender » absent pour le secrétariat

#### 19.67 Terminer un dossier (à faire en dernier)
Compte : Directeur · Où : fiche de `AFF-TG-0001` version 2 · Prérequis : 19.66. **Attention : la fin d'un dossier ne se défait pas.**
1. Cliquer sur « Terminer » (fenêtre « Terminer le dossier » : « La fin d'un dossier est datée et motivée ; elle ne se défait pas. »). Valider sans rien, puis "No" comme motif avec une date, puis une date et "Fin test guide : essai terminé".
2. (Option, sur un autre dossier actif seulement) le bouton « Transférer » ferme le dossier par transfert hors de l'établissement (même formulaire, « Date du transfert »).

Résultat attendu : champs vides : « Date invalide (AAAA-MM-JJ). » et « Un motif de 5 caractères minimum est requis. » ; ensuite « Dossier terminé. », statut « Terminé », « Date de fin » et « Motif de fin » affichés ; plus aucun acte sauf « Rapprocher avec la facturation ». Pour un transfert : « Dossier clos par transfert. », statut « Transféré ».
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'économe (aucun bouton « Terminer »)

#### 19.68 États des affectations et exports CSV
Compte : Économe (puis Secrétariat) · Où : menu « Affectés de l'État » > « États des affectations » (`/v2/stateassign/reports`) · Prérequis : 19.62.
1. Ouvrir « États des affectations ». Lire « Situation au … », « Dossiers par statut », « Total déclaré — État », « Total déclaré — familles », « Créances sur l'État » (« Attendu », « Reçu », « Reste à recevoir », « En retard »), « Suivi » (« Contrôles à faire », « Contrôles en retard », « Anomalies », « Jamais rapproché », « Conforme », « Écart »).
2. Section « Exports » : « Jeu de données » = « Dossiers d'affectation », « Format » = « Format neutre (toutes les colonnes) », cliquer sur « Télécharger le CSV ». Recommencer avec « Créances sur l'État » puis « Contrôles ».
3. Lire la section « Passerelle vers la plateforme publique ».
4. Se connecter en secrétariat et ouvrir la même page.

Résultat attendu : les compteurs de statuts reflètent la base (avec la graine seule : « Vérifié » 1 ; relever les valeurs). Étape 2 : « Fichier téléchargé : N ligne(s). » (N ≥ 1) et un fichier `.csv` dont les montants sont des entiers de francs ; le message "Fichier tronqué : …" n'apparaît que au-delà du plafond. Étape 3 : « Aucune passerelle n'est configurée : la saisie et l'import sont manuels, aucun échange externe n'a lieu. ». Étape 4 : le secrétariat lit les états mais **la section « Exports » est absente** (droit d'exporter réservé à l'économe et à la direction).
- [ ] Cas nominal  - [ ] Fichier CSV ouvrable dans un tableur  - [ ] Droit refusé : « Exports » absent pour le secrétariat

#### 19.69 Paramètres du module et formats d'export
Compte : Directeur · Où : menu « Affectés de l'État » > « Paramètres des affectations » (`/v2/stateassign/settings`) · Prérequis : MFA. **Attention : modifie les réglages de l'établissement ; remettre les valeurs d'origine (case cochée, tolérance 0, aucune nature, délai vide, grâce 0).**
1. Lire le titre « Paramètres des affectations » et l'encadré « Les tolérances, délais et contrôles ci-dessous sont des choix de l'établissement ; ils ne reprennent aucun texte officiel. ».
2. Dans « Réglages », essayer :
   | Saisie | Message attendu |
   |---|---|
   | « Tolérance d'écart (francs) » = -5 | « Saisissez un nombre entier de francs (zéro autorisé). » |
   | « Tolérance d'écart (francs) » = 1,5 | « Saisissez un nombre entier de francs (zéro autorisé). » |
   | « Délai de grâce des créances (jours) » = 400 | « Saisissez un nombre entier de jours (0 à 366). » |
   | cocher la nature « Identité » sans « Délai d'échéance d'un contrôle (jours) » | « Indiquez le délai d'échéance pour que les contrôles choisis soient planifiés. » |
3. Saisir « Tolérance d'écart (francs) » = 30 000 et « Enregistrer les réglages » ; rouvrir `/v2/stateassign/reconciliation` et rapprocher `AFF-DEMO-0001`. Remettre la tolérance à 0.
4. Section « Formats d'export », « Nouveau format » (fenêtre « Nouveau format d'export ») : Code `tg-dossiers`, Libellé "Dossiers test guide", Jeu de données « Dossiers d'affectation », Séparateur « Point-virgule », BOM cochée, Colonnes : cocher deux colonnes et modifier un en-tête. « Créer le format ». Puis sur `/v2/stateassign/reports`, choisir ce format et télécharger.
5. Désactiver le format (« Désactiver »).

Résultat attendu : étape 3 : « Réglages enregistrés. » ; avec la tolérance 30 000, l'écart famille de 25 000 F CFA de `AFF-DEMO-0001` devient « Conforme » après rapprochement (statut calculé par la base). Étape 4 : le format apparaît avec « Actif » et « 2 colonne(s) » ; le CSV contient les colonnes choisies et les en-têtes renommés. Étape 5 : badge « Inactif », format absent de la liste « Format » des exports.
Cas invalides du format :
| Saisie | Message attendu |
|---|---|
| Code `TG` (majuscules) ou `a` | « Code invalide : minuscules, chiffres, tiret et tiret bas. » |
| Libellé vide | « Le libellé est obligatoire. » |
| Aucune colonne cochée | « Choisissez au moins une colonne. » |
| Code `tg-dossiers` déjà utilisé | message du serveur "Un format d'export porte déjà ce code dans l'établissement." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Réglages remis en l'état  - [ ] Droit refusé pour l'économe (`/v2/stateassign/settings`)

---

## Partie E. Vue famille, droits et qualité

#### 19.70 Vue famille : le statut, jamais les montants
Compte : Parent · Où : menu du portail parent « Affectation de mon enfant » (`/v2/stateassign/family`) · Prérequis : base intacte.
1. Ouvrir « Affectation de mon enfant ». Lire « Le statut du dossier d'affectation par l'État de chacun de vos enfants. » et la liste « Enfants ».
2. **Variante (optionnelle, à faire en dernier, modifie les données du parent de démonstration)** : avec le secrétariat enregistrer un dossier `AFF-TG-0003` pour **DIABATE Salimata**, avec le directeur le vérifier ; rouvrir la page du parent.

Résultat attendu : étape 1 : deux blocs "DIABATE Nadia" et "DIABATE Salimata", chacun avec « Aucun dossier d'affectation pour cet enfant. ». Variante : le bloc de Salimata affiche le « Statut » (« Vérifié »), la « Référence » et la « Date de l'acte », et la phrase « Le dossier a été vérifié par l'établissement. » (ou « Le dossier est en attente de vérification par l'établissement. » avant la vérification). **Aucun montant** (ni part de l'État, ni part de la famille, ni écart, ni échéance, ni contrôle) n'est visible. Le parent ne voit pas le dossier d'ADOU Aïcha. Attention à la variante : elle change le financement d'une inscription du compte parent (chapitres Finance et Portails) ; à réserver à une base dédiée ou la noter comme non exécutée.
- [ ] Cas nominal  - [ ] Aucun montant visible  - [ ] Droit refusé pour le parent (`/v2/stateassign`)

#### 19.71 Droits refusés (vérification par rôle)
Compte : chacun des comptes du tableau "Adresses à taper à la main" · Où : barre d'adresse · Prérequis : aucun.
1. Pour chaque ligne, se connecter et taper les adresses.
2. Contrôler en plus : la fiche `/v2/stateassign/<identifiant inconnu valide>` (par exemple `/v2/stateassign/00000000-0000-0000-0000-000000000000`) avec le directeur.

Résultat attendu : « Accès refusé » (texte "Vous n'avez pas les droits nécessaires pour afficher cette page.") sans aucune donnée. Pour l'identifiant inconnu : bloc d'erreur "Dossier d'affectation" introuvable (texte à relever en test), jamais le dossier d'un autre établissement.
- [ ] Secrétariat  - [ ] Économe  - [ ] Dir. études  - [ ] Parent  - [ ] Enseignant, éducateur, élève

#### 19.72 Qualité transversale : chargement, états vides, clavier, téléphone
Compte : Secrétariat et Économe · Où : pages du module · Prérequis : aucun.
1. Chargement : chaque tableau affiche « Chargement des données… » avant les lignes.
2. États vides : « Aucun dossier ne correspond. », « Aucune échéance ne correspond. », « Aucun dossier n'attend de vérification. », « Aucun dossier ne correspond. » (rapprochement : « Aucun dossier dans cet état. »).
3. Pagination : changer « Lignes par page » dans la liste si plus de lignes que la page.
4. Clavier : ouvrir « Enregistrer un dossier » avec Tab et Entrée, parcourir les champs, fermer avec Échap ; le focus reste dans la fenêtre.
5. Téléphone : réduire la fenêtre à environ 375 pixels ; les colonnes secondaires (parts, écarts) se masquent, les onglets défilent, aucune coupure de texte.

Résultat attendu : messages en français, aucun code brut hors celui de la liste d'inscriptions de 19.56 (écart E-19c-3), focus restitué à la fermeture (le rapport QA 05 notait que le focus ne revenait pas au bouton d'origine : à reconfirmer).
- [ ] Chargement  - [ ] États vides  - [ ] Clavier  - [ ] Largeur téléphone

---

## Données créées (pour l'annexe)

| Enregistrement | Où | Détail |
|---|---|---|
| Dossier `AFF-TG-0001` (version 1 « Remplacé », version 2 « Terminé ») | 19.56 à 19.67 | N'GUESSAN Aya ; inscription passée en financement « Affecté par l'État » |
| Dossier `AFF-TG-0002` (deux enregistrements, « Rejeté ») | 19.58 | N'GUESSAN Koffi |
| Échéances "Versement test guide 1" (60 000), 2 (annulée), 3 (60 000) | 19.62 | dossier `AFF-TG-0001` |
| Contrôles Identité (conforme), Pièces (anomalie résolue), Autre (dispensé) | 19.64 | dossier `AFF-TG-0001` |
| Pièce "Acte test guide" (retirée) | 19.65 | optionnel |
| Format d'export `tg-dossiers` (désactivé) | 19.69 | établissement |
| Réglages modifiés puis rétablis | 19.69 | tolérance, nature, délais |
| Dossier `AFF-TG-0003` | 19.70 | variante : DIABATE Salimata (optionnel) |

Actions sur la graine : `AFF-DEMO-0001` rapproché (19.61) ; activé uniquement si l'équipe le décide (non fait ici).

## Écarts constatés

| Réf. | Écran | Constat | Gravité |
|---|---|---|---|
| E-19c-1 | Finance (paiement d'un financeur) | Le champ « Référence du financeur » attend l'identifiant interne de la prise en charge, visible seulement dans le bandeau de la facture du financeur ; le versement de l'État ne se saisit pas avec `AFF-DEMO-0001` (C-05-03, non corrigé). | Majeur |
| E-19c-2 | Fiche dossier | La confirmation d'activation annonce l'ouverture du suivi de la créance, mais ni facture scindée ni échéance n'est créée (la scission vient du rapprochement et des factures émises) (C-11-04). | Mineur |
| E-19c-3 | Enregistrer un dossier | La liste « Inscription » affiche des codes bruts (numéro · `PENDING` · `PRIVATE`). | Mineur |
| E-19c-4 | Rapprochement | Écart famille de 25 000 F CFA sur `AFF-DEMO-0001` : le montant famille rapproché inclut les frais d'inscription ; donnée de démonstration non cohérente avec l'acte (80 000 F CFA seuls). | Mineur |
| E-19c-5 | Vue famille | L'écran affiche aussi la référence et la date de l'acte (et non le seul statut) ; à confirmer comme voulu. | Suggestion |
| E-19c-6 | Fenêtres d'actes | Aucune confirmation avant « Reprendre », « Rejeter », « Terminer » ; seule l'activation en a une (C-11-01, corrigé en partie). | Suggestion |

## À vérifier en test

- 19.54 / 19.61 : statut de rapprochement de `AFF-DEMO-0001` sur la base de départ (Écart attendu, compteurs).
- 19.59 : acceptation du rattachement de l'inscription "en attente" de N'GUESSAN Aya à la vérification.
- 19.61 : valeurs d'écart de `AFF-TG-0001`.
- 19.62 : texte exact du refus de dépassement et du message d'échéance sur un dossier non vérifié.
- 19.63 : paiement de financeur côté Finance (chapitre dédié), passage de l'échéance à « Reçu ».
- 19.65 : disponibilité d'un document de la gestion documentaire.

## Non couvert / limites connues

- **Reversement des fonds partagés** (répartition de sommes reçues entre l'État, l'établissement et d'autres parties) : non modélisé ; le module suit seulement ce que l'État doit verser à l'établissement.
- **Passerelle vers une plateforme publique** : aucune (adaptateur "non configuré") ; saisie et import manuels ; routes API de passerelle réservées sans écran.
- **Alertes automatiques** (créance en retard, contrôle dû, écart) : travaux planifiés de nuit (rapprochement 01:40, retards 07:20, contrôles 06:20 et 07:25) non rejouables dans une séance de test ; aucun écran pour les déclencher.
- **Import en lot** des dossiers : non fourni par ce module (voir le chapitre Imports).
- **Admission en non-valeur d'une créance** : non modélisée (question métier ouverte).
- **Isolation entre établissements** : voir chapitre 01.
