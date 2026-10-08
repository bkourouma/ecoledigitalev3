# Chapitre 4. Personnes : élèves, tuteurs, personnel et inscriptions

Ce chapitre couvre les écrans des dossiers permanents et des inscriptions : élèves (liste, création, fiche, « Mes enfants » du parent), tuteurs (liste, fiche), personnel (liste, création, fiche, affectations d'enseignement, « Mon espace ») et inscriptions (liste, assistant, fiche : confirmation, transfert, retrait, financement). Modules API : `apps/api/src/modules/people` (personnes) et `apps/api/src/modules/academic` (inscriptions).

**URL réelle.** Comme au chapitre 3 : `http://localhost:3000/v2/...` (le dossier `app/v2/` de l'application web est le préfixe `/v2`). Un refus de droit redirige vers `/unauthorized` (page « Accès refusé »).

## Prérequis

- Chapitre 3 joué, en particulier 3.9 : classes `TG-6EB` (active), `TG-6EC` (brouillon, capacité 1 bloquante) au secondaire ; `TG-CP1B` et `TG-CP1C` au primaire (**brouillon**) ; `TG-L1B` (active) et `TG-L1C` (brouillon, capacité 1 bloquante) au supérieur. Sans ces classes, les scénarios d'inscription (4.22 à 4.27) ne peuvent pas être joués.
- La politique de confirmation des inscriptions est « Après paiement des frais d'inscription » (donnée de départ) : une nouvelle inscription reste « En attente » tant que les frais ne sont pas payés. Le paiement se fait dans le chapitre Finance, sur l'élève test guide.
- Scénarios durables : 4.17 (statut du personnel), 4.18 (invitation d'un compte), 4.27 (annulation), 4.28 (retrait d'un élève). À jouer en dernier, sur les enregistrements test guide uniquement.
- Les noms du tableau "Données créées" sont **stables** : les chapitres suivants s'y réfèrent.

## Comptes à utiliser

| Rôle | Collège (`secondaire-test`) | École (`primaire-test`) | Université (`superieur-test`) | MFA |
|---|---|---|---|---|
| Secrétariat | `secretariat@secondaire-test.test` | `secretariat@primaire-test.test` | `secretariat@superieur-test.test` | oui |
| Directeur | `directeur@secondaire-test.test` | `directeur@primaire-test.test` | `directeur@superieur-test.test` | oui |
| Directeur des études | `etudes@secondaire-test.test` | `etudes@primaire-test.test` | `etudes@superieur-test.test` | oui |
| Économe (financement) | `econome@secondaire-test.test` | `econome@primaire-test.test` | `econome@superieur-test.test` | oui |
| Éducateur | `educateur@secondaire-test.test` | `educateur@primaire-test.test` | `educateur@superieur-test.test` | non |
| Enseignant (instituteur au primaire) | `enseignant@secondaire-test.test` | `enseignant@primaire-test.test` | `enseignant@superieur-test.test` | non |
| Parent (tuteur n° 1 de la graine) | `parent@secondaire-test.test` | `parent@primaire-test.test` | `parent@superieur-test.test` | non |

## Droits (qui voit quoi)

Source : `apps/api/src/modules/rbac/templates/system-roles.ts` ; gardes de page dans `apps/web/src/app/v2/{students,guardians,staff,enrollments}`.

| Écran | Permission de page | Rôles qui y accèdent | Écriture |
|---|---|---|---|
| `/v2/students` | `student.list` ou `student.class.read` | tous les rôles de gestion sauf admissions ; **enseignant : ses classes seulement** | exporter : `student.export` (secrétariat, direction) |
| `/v2/students/new` | `student.create` | secrétariat, directeur, propriétaire | création |
| `/v2/students/<identifiant>` | `student.read` ou `student.class.read` | idem liste ; **enseignant : fiche réduite** | modifier : `student.update` ; statut : `student.status.update` ; informations sensibles et pièces : `student.sensitive.read` (secrétariat, direction) |
| `/v2/students/children`, `/v2/students/children/<identifiant>` | `student.child.read` | parent | corriger un contact d'urgence : `student.child.update` |
| `/v2/guardians`, `/v2/guardians/<identifiant>` | `guardian.read` | secrétariat, études, économe, éducateur, direction | créer, modifier, lier, inviter : `guardian.manage` (secrétariat, direction) |
| `/v2/staff` | `staff.list` ou `staff.read` | directeur des études, économe, responsable pédagogique, direction | |
| `/v2/staff/new` | `staff.create` | directeur, propriétaire | |
| `/v2/staff/<identifiant>` | `staff.read` | idem liste ; onglet « Contrats » : `staff.contract.read` (direction seulement) | modifier : `staff.update` ; statut : `staff.status.update` ; disponibilités : `staff.availability.manage` (études, direction) |
| `/v2/staff/assignments` | `teaching.read` | directeur des études, responsable pédagogique, direction | affecter : `teaching.assign` (études, direction) |
| `/v2/staff/me` | `staff.own.read` | enseignant, instituteur, éducateur | coordonnées : `staff.own.update` |
| `/v2/enrollments` et `/v2/enrollments/<identifiant>` | `enrollment.read` | direction, études, secrétariat, économe, éducateur, responsable pédagogique, responsable des examens | confirmer, suspendre, transférer : `enrollment.update` (études, secrétariat, direction) ; retirer, annuler : `enrollment.cancel` (secrétariat, direction) ; financement : `enrollment.funding.update` (économe, direction) ; confirmer sans paiement : `enrollment.confirm.override` (direction seulement) |
| `/v2/enrollments/new` | `enrollment.create` | secrétariat, direction | |

**Adresses à taper à la main qui doivent être refusées** (redirection vers `/unauthorized`, page « Accès refusé », aucune donnée) :

| Compte | Adresses |
|---|---|
| Enseignant | `/v2/guardians`, `/v2/students/new`, `/v2/staff`, `/v2/enrollments` |
| Secrétariat | `/v2/staff`, `/v2/staff/new`, `/v2/staff/assignments`, `/v2/students/children` |
| Directeur des études | `/v2/students/new`, `/v2/staff/new`, `/v2/enrollments/new`, `/v2/students/children` |
| Éducateur | `/v2/students/new`, `/v2/staff`, `/v2/enrollments/new` (en revanche `/v2/guardians` s'ouvre en lecture seule) |
| Parent | `/v2/students`, `/v2/guardians`, `/v2/staff/me`, `/v2/enrollments` |

Une fiche d'un autre établissement, d'une autre famille ou hors des classes de l'enseignant ne donne pas « Accès refusé » mais un message d'introuvable du type "Élève introuvable (identifiant)." (voir 4.29).

## Données de départ

Source : `scripts/seed-v2/dataset.ts`, `scripts/seed-v2/scenario.ts` (étape 3), `scripts/seed-v2/demo/*.ts`. Voir l'annexe "Données de départ" pour la liste des 12 élèves (E1 à E12), des 6 tuteurs et des 3 enseignants.

| Donnée | Valeur |
|---|---|
| Élèves de la graine | 12 élèves en deux fratries par tuteur ; Nadia DIABATE (E1, matricule `00001`) et Salimata DIABATE (E2) sont les enfants du compte `parent@` (tuteur DIABATE Séka). Huit inscriptions confirmées, quatre en attente au départ ; la démonstration ajoute des candidats admis (secondaire : ex. ADOU Aïcha, ASSI Brice ; maternelle au primaire) |
| Tuteurs | 6 ; seul DIABATE Séka a un compte de portail (« Compte actif ») ; liens : contact principal, responsable financier, autorité légale, accès au portail |
| Contacts d'urgence | aucun dans la graine (à ajouter par le secrétariat) |
| Personnel enseignant | TRAORE Kouadio (compte `enseignant@`), YAO Fatou, KOUAME Adjoua ; affectés « Toutes les matières » à la classe de démonstration (Responsable ; au primaire Titulaire de classe) ; au primaire, ZOKORA Sylvie (maternelle) et deux fiches du conseil des maîtres |
| Numéros | matricule élève motif `{SEQ:5}` ; matricule personnel `P{SEQ:4}` ; numéro d'inscription `DEMO-<programme>-<niveau>-<n°>` |
| Catégories de personnel | « Enseignant », « Éducateur », "Personnel administratif", « Direction », "Personnel d'appui" |
| Liens de parenté proposés pour un tuteur | "Père", "Mère", « Tuteur légal », "Grand-parent", "Frère ou sœur", "Oncle ou tante" |
| Types de contrat | "Contrat à durée indéterminée", "Contrat à durée déterminée", "Vacation", « Autre » |

## Scénarios

#### 4.1 Liste des élèves : lecture, recherche, filtres
Compte : Secrétariat · Où : menu « Personnes » > "Élèves" (`/v2/students`) · Prérequis : aucun
1. Ouvrez l'écran « Élèves » : colonnes « Élève », « Matricule », « Classe », « Inscription », « Statut ». Les élèves sans classe affichent « Non inscrit ». La barre d'onglets « Élèves et tuteurs » propose « Élèves », « Nouvel élève », « Tuteurs » (et « Mes enfants » seulement pour un parent).
2. Dans « Rechercher un élève » (placeholder "Nom, prénoms, matricule…"), saisissez `diabate` (minuscules) : on retrouve DIABATE Nadia et DIABATE Salimata. Saisissez `Nadia` puis `00001` (matricule) : la fiche correspondante. La recherche ignore la casse et les accents (`kone` retrouve KONÉ).
3. Filtrez par « Statut » (tous les statuts de la liste « Actif », « Inactif », « Suspendu », « Diplômé », « Retiré », « Transféré », « Exclu », « Archivé »), « Année » et « Classe » (liste « Toutes les classes ») ; cochez « Inclure les dossiers archivés ».
4. Saisissez `zzzz` : le message « Aucun élève ne correspond à votre recherche. » s'affiche.
Résultat attendu : au moins 12 élèves ; recherche sans accent et sans casse ; messages vides conformes ; matricules uniques et inchangés d'un affichage à l'autre.
Cas invalides : sans objet (lecture).
- [ ] Cas nominal  - [ ] Cas invalide (sans objet)  - [ ] Droit refusé pour l'enseignant (ne voit que ses classes, voir 4.29)

#### 4.2 Tuteurs : créer le tuteur test guide et signaler un doublon
Compte : Secrétariat · Où : onglet « Tuteurs » (`/v2/guardians`) · Prérequis : aucun
1. Ouvrez l'écran « Tuteurs » : colonnes « Tuteur », « Téléphone », « E-mail », « Enfants », « Portail » (pastilles « Sans compte » ou « Compte actif »). Cherchez `DIABATE` dans « Rechercher un tuteur » (placeholder "Nom, téléphone, e-mail…") : DIABATE Séka, 2 enfants, « Compte actif ».
2. Cliquez sur « Nouveau tuteur » (fenêtre « Créer un tuteur ») et saisissez selon l'établissement :
   | Champ (libellé exact) | Secondaire | Primaire | Supérieur | Obligatoire |
   |---|---|---|---|---|
   | Nom | `KOUASSI` | `TRAORE` | `KONÉ` | oui |
   | Prénoms | `Marcel test guide` | `Moussa test guide` | `Seydou test guide` | oui |
   | Autres noms | (vide) | (vide) | (vide) | non |
   | Sexe | « Masculin » | « Masculin » | « Masculin » | non pour un tuteur |
   | Date de naissance | `03/04/1980` | `18/09/1984` | `25/01/1975` | non |
   | Lieu de naissance | `Abidjan` | `Abobo` | `Bouaké` | non |
   | Nationalité (code pays) | `CI` | `CI` | `CI` | non |
   | Adresse e-mail | `marcel.kouassi.tg@exemple.test` | `moussa.traore.tg@exemple.test` | `seydou.kone.tg@exemple.test` | non |
   | Téléphone | `+225 07 58 12 34 56` | `+225 05 47 20 31 64` | `+225 01 03 45 67 89` | non |
   | Autre téléphone | (vide) | (vide) | (vide) | non |
   | Ville | `Abidjan` | `Abidjan` | `Bouaké` | non |
   | Adresse | `Rue des Jardins, Cocody (fictif)` | `Quartier Anonkoua (fictif)` | `Quartier Commerce (fictif)` | non |
   | Lieu de résidence | `Cocody` | `Abobo` | `Bouaké` | non |
   | Profession | `Commerçant` | `Chauffeur` | `Cadre administratif` | non |
   Cliquez sur « Créer ». Message « Le tuteur KOUASSI Marcel test guide a été créé. » (nom affiché "NOM Prénoms"). Le tuteur apparaît avec "0" enfant et « Sans compte ». Le téléphone peut s'afficher normalisé (sans espaces) : relevez-le.
3. Recréez le même tuteur (mêmes nom et prénoms) et cliquez sur « Créer » : la fenêtre n'est pas fermée ; un encadré signale "1 dossier ressemble à cette personne" avec la mention « Même nom » (date de naissance connue d'un seul côté ou absente) ou « Même nom et même date ». Cochez « Ce n'est pas un doublon : créer quand même » : le champ « Motif de la création » apparaît. **Annulez la fenêtre** sans créer le doublon.
Résultat attendu : tuteur créé et persistant après rechargement ; doublon signalé, jamais bloquant sans motif.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Nom et Prénoms vides, valider | « Ce champ est obligatoire. » sous Nom et sous Prénoms |
| E-mail `marcel.exemple` | "Adresse e-mail invalide." |
| Téléphone `12` | "Téléphone trop court." |
| Téléphone `abcdefgh` | "Numéro de téléphone invalide." |
| Date de naissance dans le futur (`01/01/2040`) | "Date de naissance invraisemblable." |
| Doublon cochée sans motif, valider | message du contrat : "Un motif est requis pour confirmer un doublon possible." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'économe (liste lisible, aucun bouton « Nouveau tuteur »)

#### 4.3 Créer l'élève test guide avec son tuteur (assistant)
Compte : Secrétariat · Où : onglet « Nouvel élève » (`/v2/students/new`) · Prérequis : 4.2 (tuteur test guide) · Crée **trois** dossiers : l'élève test guide principal, un frère ou une sœur (élève 2) pour la fratrie, et rien d'autre
1. Étape « Identité » (« Le sexe est obligatoire : il n'y a aucune valeur par défaut. ») :
   | Champ (libellé exact) | Secondaire | Primaire | Supérieur | Obligatoire |
   |---|---|---|---|---|
   | Nom | `KOUASSI` | `TRAORE` | `KONÉ` | oui |
   | Prénoms | `Aïcha test guide` | `Awa test guide` | `Ibrahim test guide` | oui |
   | Autres noms | (vide) | (vide) | (vide) | non |
   | Sexe | « Féminin » | « Féminin » | « Masculin » | oui (aide : "Obligatoire pour un élève, sans valeur par défaut.") |
   | Date de naissance | `12/05/2014` | `14/03/2019` | `21/07/2005` | non |
   | Lieu de naissance | `Abidjan` | `Abobo` | `Bouaké` | non |
   | Nationalité (code pays) | `CI` | `CI` | `CI` | non |
   | Adresse e-mail | `aicha.kouassi.tg@exemple.test` | `awa.traore.tg@exemple.test` | `ibrahim.kone.tg@exemple.test` | non |
   | Téléphone | `+225 07 58 12 34 57` | `+225 05 47 20 31 65` | `+225 01 03 45 67 90` | non |
   | Ville | `Abidjan` | `Abidjan` | `Bouaké` | non |
   | Adresse | `Rue des Jardins, Cocody (fictif)` | `Quartier Anonkoua (fictif)` | `Quartier Commerce (fictif)` | non |
   Cliquez sur « Suivant » : le serveur contrôle les doublons sans rien écrire. Aucun encadré ne doit apparaître.
2. Étape « Tuteurs » (« Facultatif : ajoutez les tuteurs maintenant ou plus tard depuis la fiche. ») : cliquez sur « Ajouter un tuteur existant ». Dans « Tuteur » (placeholder "Rechercher un tuteur…"), tapez `test guide` et choisissez le tuteur de 4.2. Choisissez « Lien de parenté » : "Père" ("Mère" si vous préférez). Dans « Droits et rôles du tuteur », laissez cochés « Contact principal » (valeur par défaut de l'assistant), « Contact d'urgence » et « Accès au portail parents » ; cochez « Responsable financier » ; laissez décochés « Autorité légale » et « Autorisé à récupérer l'enfant » (faux par défaut). Cliquez sur « Suivant ».
3. Étape « Récapitulatif » : relisez « Élève », « Date de naissance », « Tuteurs à lier » (`1`) et la note « Le matricule est attribué automatiquement à la création. » Cliquez sur « Créer le dossier ».
4. Écran « Dossier créé » : « KOUASSI Aïcha test guide — matricule N. » (relevez le matricule). Boutons « Ouvrir la fiche », « Inscrire maintenant ».
5. **Élève 2** : recommencez avec « Nouvel élève » :
   | Champ | Secondaire | Primaire | Supérieur |
   |---|---|---|---|
   | Nom | `KOUASSI` | `TRAORE` | `KONÉ` |
   | Prénoms | `Brice test guide` | `Issa test guide` | `Rokia test guide` |
   | Sexe | « Masculin » | « Masculin » | « Féminin » |
   | Date de naissance | `27/02/2014` | `22/08/2019` | `02/12/2004` |
   | Lieu de naissance | `Yopougon` | `Abobo` | `Bouaké` |
   À l'étape « Tuteurs », choisissez le **même** tuteur existant, lien "Père", en **décochant** « Contact principal » si vous voulez tester ce drapeau plus tard (sinon laissez coché : le contact principal est propre à chaque élève).
Résultat attendu : deux dossiers créés avec un matricule chacun ; la fiche du tuteur (`/v2/guardians`) compte désormais 2 enfants (fratrie) ; le matricule est inchangé après rechargement.
Cas invalides : voir 4.5 (champs de l'assistant) et 4.4 (doublon).
- [ ] Cas nominal  - [ ] Cas invalide (4.4 et 4.5)  - [ ] Droit refusé pour le directeur des études (adresse `/v2/students/new` refusée)

#### 4.4 Doublon probable d'élève
Compte : Secrétariat · Où : « Nouvel élève » (`/v2/students/new`) · Prérequis : 4.3 · **Ne jamais créer le doublon**
1. À l'étape « Identité », saisissez exactement l'identité de l'élève test guide principal (même Nom, Prénoms, Sexe, Date de naissance) et cliquez sur « Suivant ».
2. L'encadré affiche "1 dossier ressemble à cette personne" avec "Vérifiez qu'il ne s'agit pas de la même personne avant de créer un nouveau dossier.", la mention « Même nom et même date », le matricule, le rôle « Élève » et le lien « Ouvrir la fiche » (s'ouvre dans un nouvel onglet). Le message du pied « Des dossiers similaires existent : confirmez la création avec un motif ou ouvrez le dossier existant. » bloque le passage à l'étape suivante.
3. Remplacez `test guide` par `test guid` dans « Prénoms » (une lettre de moins) : l'encadré annonce « Nom proche » (même date de naissance).
4. Changez la date de naissance (`13/05/2014`) : plus de doublon signalé (les homonymes de dates différentes ne sont pas des doublons).
5. Revenez à la saisie identique, cochez « Ce n'est pas un doublon : créer quand même » : le champ « Motif de la création » apparaît (obligatoire). Saisissez `Jumeaux : essai du guide` puis **quittez la page sans terminer** (menu « Élèves »).
Résultat attendu : doublon signalé, création bloquée sans motif ; avec motif, la création serait permise (jumeaux possibles) mais n'est pas jouée.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Doublon coché, « Motif de la création » vide, « Suivant » | "Un motif est requis pour confirmer un doublon possible." |
| Même nom, date de naissance vide | « Même nom » (une date manque : on ne peut pas départager) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'éducateur (pas d'accès à `/v2/students/new`)

#### 4.5 Saisies invalides de l'assistant élève
Compte : Secrétariat · Où : « Nouvel élève », étape « Identité » · Prérequis : aucun · **Ne rien créer**
1. Partez d'une identité valide (Nom `ESSAI`, Prénoms `Invalide test guide`, Sexe « Féminin ») et appliquez, un à un, les cas du tableau avant de cliquer sur « Suivant ».
Résultat attendu : l'erreur s'affiche sous le champ concerné, l'assistant reste à l'étape « Identité », rien n'est créé.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Nom vide | « Ce champ est obligatoire. » |
| Prénoms vide | « Ce champ est obligatoire. » |
| Sexe laissé sur « Choisir… » | "Le sexe est obligatoire pour un élève." |
| Date de naissance dans le futur (`12/05/2030`) | "Date de naissance invraisemblable." |
| Date de naissance `01/01/1899` | "Date de naissance invraisemblable." |
| Adresse e-mail `aicha.exemple` | "Adresse e-mail invalide." |
| Téléphone `12` | "Téléphone trop court." |
| Téléphone `abcdefgh` | "Numéro de téléphone invalide." |
| Nationalité `1A` | "Code pays ISO 3166-1 alpha-2 attendu (ex. CI)." |
| Nom de 130 lettres | le champ refuse la saisie au-delà de 120 caractères (limite du champ) |
- [ ] Cas nominal (sans objet)  - [ ] Cas invalide  - [ ] Droit refusé pour le directeur des études

#### 4.6 Fiche élève : lire, informations sensibles, modifier
Compte : Secrétariat · Où : liste « Élèves » > fiche de `KOUASSI Aïcha test guide` (`/v2/students/<identifiant>`) · Prérequis : 4.3
1. L'en-tête affiche le nom, "Matricule N", les boutons « Tous les élèves », « Inscrire », « Modifier », « Changer le statut », la pastille « Actif » et « Non inscrit » (pas encore inscrit). Onglets : « Identité », « Tuteurs », « Urgences », « Parcours scolaire », « Statut », « Pièces ».
2. Onglet « Identité » : sections « État civil » (Nom, Prénoms, Autres noms, Sexe, Date de naissance, Lieu de naissance, Nationalité (code pays), « Première inscription », « Compte du portail » = « Aucun compte ») et « Coordonnées ». Les valeurs absentes affichent « — ». La section « Tuteur principal » donne un lien vers la fiche du tuteur avec son lien (code `FATHER` brut, voir Écarts) et son téléphone.
3. Section « Informations sensibles » (« Identifiant national et pièces d'état civil. Chaque consultation est journalisée. ») : cliquez sur « Afficher les informations sensibles » : « Identifiant national », « N° de l'acte de naissance », « Date de l'acte », « Centre d'état civil » sont **vides** (aucun écran ne permet de les saisir, voir Écarts). Cliquez sur « Masquer ».
4. Cliquez sur « Modifier » (fenêtre « Modifier KOUASSI Aïcha test guide ») : changez « Ville » en `Yamoussoukro` et « Lieu de résidence » en `Plateau`, cliquez sur « Enregistrer » : « La fiche a été mise à jour. » Les nouvelles valeurs sont visibles et persistent après rechargement. Rétablissez ensuite `Abidjan` (facultatif).
Résultat attendu : champs sensibles masqués par défaut ; modification enregistrée.
Cas invalides (fenêtre « Modifier ») :
| Saisie | Message attendu |
|---|---|
| Nom vidé | « Ce champ est obligatoire. » |
| Date de naissance dans le futur | "Date de naissance invraisemblable." |
| Adresse e-mail `sans-arobase` | "Adresse e-mail invalide." |
| Aucune modification, « Enregistrer » | la fenêtre se ferme sans envoi |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le directeur des études (pas de bouton « Modifier », pas de section « Informations sensibles »)

#### 4.7 Tuteurs d'un élève : lier, modifier, clôturer, fratrie
Compte : Secrétariat · Où : fiche de `KOUASSI Aïcha test guide`, onglet « Tuteurs » · Prérequis : 4.3
1. L'onglet « Tuteurs » liste le tuteur lié (colonnes « Tuteur », « Lien », « Rôles », « Validité », « Actions ») : lien "Père", rôles « Principal », « Urgence », « Financier », « Portail » ; validité "Depuis le …". La fiche du tuteur (lien "KOUASSI Marcel test guide") affiche 2 enfants liés.
2. Cliquez sur « Lier un tuteur » (fenêtre du même nom). Choisissez « Nouveau tuteur » et remplissez (champs d'identité sans coordonnées) : Nom `KOUASSI`, Prénoms `Adjoua test guide`, Sexe « Féminin », Profession `Couturière` ; « Lien de parenté » "Mère" ; **décochez « Contact principal »** (il existe déjà), laissez « Contact d'urgence » et « Accès au portail parents ». Cliquez sur « Lier un tuteur ». Message « Le tuteur est lié. » (le tuteur est d'abord créé puis lié).
3. Essayez une seconde liaison avec « Tuteur existant » `KOUASSI Marcel test guide` : refus du serveur.
4. Cliquez sur « Modifier » sur la ligne de la mère (fenêtre « Modifier le lien avec KOUASSI Adjoua test guide ») : cochez « Autorité légale » et « Autorisé à récupérer l'enfant » puis « Enregistrer » : « Le lien est mis à jour. » Les pastilles « Autorité » et « Retrait » s'ajoutent.
5. Cochez « Contact principal » sur la mère puis « Enregistrer » : le contact principal passe à la mère (le père perd « Principal »), sans message d'erreur.
6. Cliquez sur « Clôturer le lien » sur la ligne de la mère (fenêtre « Clôturer le lien avec KOUASSI Adjoua test guide » : "Le lien est clos, jamais supprimé : il reste dans l'historique."), laissez « Motif (facultatif) » vide, confirmez : « Le lien est clos. » La ligne affiche « Clos le … » et n'a plus d'actions.
7. Remettez le père comme contact principal (« Modifier » > « Contact principal ») pour que la suite reste cohérente.
Résultat attendu : un seul contact principal par élève ; la clôture conserve l'historique ; la fiche de l'élève 2 est liée au même tuteur (fratrie).
Cas invalides :
| Saisie | Message attendu |
|---|---|
| « Lier un tuteur » sans choisir de tuteur | « Choisissez un tuteur. » |
| Sans « Lien de parenté » | « Choisissez le lien de parenté. » |
| Lier un second tuteur avec « Contact principal » coché alors qu'un contact principal existe | "Cet élève a déjà un contact principal." |
| Relier le même tuteur déjà lié | "Ce tuteur est déjà lié à cet élève." |
| Nouveau tuteur sans Nom | « Ce champ est obligatoire. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'économe (onglet lisible, aucun bouton « Lier un tuteur »)

#### 4.8 Contacts d'urgence : ajout par le secrétariat, correction par le parent
Comptes : Secrétariat puis Parent · Où : fiche de `DIABATE Nadia` (élève de la graine), onglet « Urgences » ; puis `/v2/students/children` · Prérequis : aucun (le contact est ajouté à une fiche de la graine car le parent test connecté ne voit que ses enfants)
1. Secrétariat : ouvrez la fiche de DIABATE Nadia, onglet « Urgences » : « Aucun contact d'urgence. » Cliquez sur « Ajouter un contact » (fenêtre « Ajouter un contact d'urgence ») :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Nom du contact | `BAMBA Oncle test guide` | oui |
   | Lien avec l'élève | `Oncle` | non |
   | Téléphone | `+225 07 12 34 56 78` | oui |
   | Autre téléphone | (vide) | non |
   | Adresse e-mail | `oncle.bamba.tg@exemple.test` | non |
   | Priorité | (vide : le serveur applique 100 ; aide "0 = appelé en premier.") ou `0` | non |
   Validez : « Le contact a été ajouté. » La ligne apparaît (colonnes « Nom », « Lien », « Téléphone », « Priorité »).
2. Parent (`parent@`) : ouvrez `/v2/students/children`, cliquez sur « Ouvrir la fiche » de Nadia DIABATE. Section « Contacts d'urgence » : "Vous pouvez corriger les coordonnées des contacts d'urgence de votre enfant." Cliquez sur « Corriger » (fenêtre « Corriger les coordonnées de BAMBA Oncle test guide ») : changez « Téléphone » en `+225 07 12 34 56 79`, « Enregistrer » : « Les coordonnées ont été mises à jour. » Le parent ne peut modifier ni le lien ni la priorité (champs absents), ni ajouter ni retirer un contact (aucun bouton).
3. Secrétariat : rechargez l'onglet « Urgences » : nouveau numéro. Cliquez sur « Retirer » : « Le contact a été retiré. »
Résultat attendu : le contact appartient à l'élève ; le parent corrige seulement ses coordonnées ; le retrait est réservé au secrétariat.
Cas invalides (fenêtre « Ajouter un contact d'urgence », puis « Corriger ») :
| Saisie | Message attendu |
|---|---|
| Nom du contact vide | « Ce champ est obligatoire. » |
| Téléphone vide | « Ce champ est obligatoire. » |
| Téléphone `12` | "Téléphone trop court." |
| Adresse e-mail `oncle.exemple` | "Adresse e-mail invalide." |
| Priorité `-1` | "La valeur doit être supérieure ou égale à 0." |
| Priorité `5000` | "La valeur doit être inférieure ou égale à 1000." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le parent (aucun bouton « Ajouter un contact » ni « Retirer »)

#### 4.9 Parcours scolaire et antécédents
Compte : Secrétariat · Où : fiche de `KOUASSI Aïcha test guide`, onglet « Parcours scolaire » · Prérequis : 4.3
1. Sections « Inscriptions » (« Aucune inscription. » avant 4.22) et « Antécédents scolaires » (« Aucun antécédent enregistré. »).
2. Cliquez sur « Ajouter un antécédent » (fenêtre « Ajouter un antécédent scolaire ») :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Nature | « Scolarité » | oui |
   | Intitulé | `CM2 test guide` (primaire : `Maternelle test guide` ; supérieur : `Baccalauréat test guide`) | oui |
   | Établissement | `École Les Mimosas (fictive)` | non |
   | Année scolaire | `2025-2026` | non |
   | Niveau | `CM2` | non |
   | Série | (vide) | non |
   | Date d'obtention | (vide) | non |
   Validez avec « Ajouter un antécédent » : « L'antécédent a été ajouté. » Cliquez sur « Retirer » : « L'antécédent a été retiré. »
3. Après 4.22, la section « Inscriptions » liste l'inscription (colonnes « Inscrit le », « Classe », « Programme et niveau », « Statut ») avec le bouton « Ouvrir ».
Résultat attendu : antécédent ajouté puis retiré ; liste des inscriptions fidèle.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Intitulé vide | « Ce champ est obligatoire. » |
| Année scolaire de 25 caractères | la saisie est tronquée à 20 caractères (limite du champ) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'éducateur (onglet lisible, aucun bouton « Ajouter un antécédent »)

#### 4.10 Pièces du dossier
Compte : Secrétariat (MFA) · Où : fiche de `KOUASSI Aïcha test guide`, onglet « Pièces » · Prérequis : 4.3 ; fichiers `docs/guide-test/jeux-de-donnees/04-piece-eleve-test-guide.pdf` et `docs/guide-test/jeux-de-donnees/04-piece-eleve-invalide-test-guide.txt`
1. L'onglet affiche "Chaque consultation de ces pièces est enregistrée dans le journal d'audit de l'établissement." et « Aucune pièce au dossier. » Un compte sans habilitation sensible (directeur des études, économe) voit à la place « Accès restreint ».
2. Cliquez sur « Déposer une pièce » (fenêtre du même nom) :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Type de pièce | « Acte de naissance » | oui |
   | Fichier | `04-piece-eleve-test-guide.pdf` | oui (PDF, JPEG, PNG ou WebP, 8 Mo au plus) |
   | Intitulé | `Acte de naissance test guide` | non (par défaut le nom du fichier) |
   | Date d'émission | `10/06/2014` | non |
   | Date d'expiration | (vide) | non |
   Validez avec « Déposer » : la pièce est déposée (message de dépôt avec son intitulé), « Version 1 » avec la pastille « Sans échéance » et « Active ».
3. Redéposez le même type : le message "Une pièce de ce type est déjà au dossier. Vous pouvez la remplacer : l'ancienne version est conservée dans l'historique." propose « Remplacer la pièce existante » ; remplacez avec le même fichier : « Version 2 ». Cochez « Afficher l'historique des versions » : la version 1 est « Remplacée ».
4. Cliquez sur « Ouvrir » sur la version 2 : le fichier s'ouvre dans un nouvel onglet (lien signé à courte durée ; la consultation est journalisée).
5. Cliquez sur « Retirer » : fenêtre "Retirer la pièce … ?" avec « Motif du retrait » ; saisissez `Pièce de test retirée` puis « Retirer » : la pièce est retirée, l'état « Retirée » apparaît dans l'historique avec le motif.
Résultat attendu : dépôt, remplacement en version 2, consultation et retrait motivé.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Valider sans choisir de fichier | « Choisissez un fichier. » |
| Fichier `04-piece-eleve-invalide-test-guide.txt` | « Format non accepté : PDF, JPEG, PNG ou WebP uniquement. » |
| Fichier de plus de 8 Mo (à fournir par le testeur) | « Le fichier dépasse 8 Mo. » |
| Date d'expiration antérieure à la date d'émission | "L'expiration précède la date d'émission." |
| Retrait avec un motif de 3 caractères | « Le motif doit comporter au moins 5 caractères. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le directeur des études (« Accès restreint »)

#### 4.11 Fiche tuteur : lire, modifier, inviter au portail
Compte : Secrétariat · Où : liste « Tuteurs » > `KOUASSI Marcel test guide` (`/v2/guardians/<identifiant>`) · Prérequis : 4.3
1. La fiche affiche le nom, la profession, les sections « Coordonnées » (Adresse e-mail, Téléphone, Autre téléphone, Ville, Adresse, Employeur, « Compte du portail » = « Aucun compte ») et « Enfants liés » (colonnes « Élève », « Matricule », « Classe » : l'élève test guide principal et l'élève 2).
2. Cliquez sur « Modifier » (fenêtre « Modifier KOUASSI Marcel test guide ») : renseignez « Employeur » = `Entreprise Les Palmiers (fictive)` et changez « Autre téléphone » en `+225 05 11 22 33 44` ; « Enregistrer » : « La fiche a été mise à jour. »
3. Cliquez sur « Inviter au portail » : message « L'invitation a été envoyée. » (aucun e-mail réel n'est expédié ; l'invitation est locale). Le bouton disparaît ; le « Compte du portail » indique un statut (valeur brute possible). **Cette invitation crée un accès fictif non supprimable** : à ne faire que dans cet environnement de test.
Résultat attendu : modification enregistrée ; invitation enregistrée.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Inviter un tuteur sans adresse e-mail (créez-en un sans e-mail pour l'essai, ou videz l'e-mail puis « Inviter au portail ») | "Une adresse e-mail est nécessaire pour inviter la personne." |
| Adresse e-mail invalide dans « Modifier » | "Adresse e-mail invalide." |
| Inviter un tuteur déjà invité | le bouton n'est plus proposé |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'éducateur (fiche lisible, ni « Modifier » ni « Inviter au portail »)

#### 4.12 Exporter la liste des élèves
Compte : Secrétariat · Où : `/v2/students` · Prérequis : aucun
1. Cliquez sur « Exporter (CSV) » (visible seulement avec `student.export`). Le navigateur télécharge `eleves.csv`.
2. Ouvrez le fichier : il reflète les filtres actifs (statut, année, classe) ; la liste est limitée à 5 000 lignes et l'export est journalisé.
Résultat attendu : fichier téléchargé et ouvrable ; bouton absent pour l'éducateur et l'enseignant.
Cas invalides : si plus de 5 000 lignes correspondent, le serveur répond "L'export est limité à 5000 lignes : affinez les filtres." (non joué avec les données de départ).
- [ ] Cas nominal  - [ ] Cas invalide (non joué)  - [ ] Droit refusé pour l'éducateur (aucun bouton « Exporter (CSV) »)

#### 4.13 Parent : « Mes enfants »
Compte : Parent (`parent@`) · Où : `/v2/students/children` (taper l'adresse ; l'entrée « Mes enfants » du menu du portail mène à `/v2/parent`, voir Écarts) · Prérequis : aucun
1. L'écran « Mes enfants » ("Les élèves dont vous êtes le tuteur. Vous ne voyez que vos propres enfants.") liste Nadia et Salimata DIABATE (cartes avec classe, matricule, statut).
2. Cliquez sur « Ouvrir la fiche » de Nadia : section « Résumé » (« Classe », « Date de naissance », « N° d'inscription »), « Tuteurs » (avec « Contact principal »), « Contacts d'urgence » et « Inscriptions ».
3. Copiez l'adresse de la fiche d'un élève **d'une autre famille** (relevée avec le secrétariat : fiche de `KOUASSI Aïcha test guide`, partie `<identifiant>`) et collez-la dans `/v2/students/children/<identifiant>` : l'écran affiche un message d'élève introuvable, aucune donnée.
Résultat attendu : exactement les enfants liés avec accès au portail ; aucun accès aux autres élèves.
Cas invalides : l'identifiant d'un autre élève (ci-dessus) ; l'adresse `/v2/students` (liste complète) est refusée (« Accès refusé »).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le parent sur `/v2/students`

#### 4.14 Liste du personnel : lecture et filtres
Compte : Directeur · Où : menu « Personnes » > "Personnel" (`/v2/staff`) · Prérequis : aucun
1. Colonnes « Nom », « Matricule », « Catégorie », « Fonction », « Charge prévue », « Statut » (« En poste », « En congé », « Suspendu », « Parti »). Boutons du haut : « Affectations d'enseignement », « Nouveau membre ». Si des qualifications arrivent à échéance, un encadré "N qualifications arrivent à échéance" les liste.
2. Cherchez `TRAORE` (« Rechercher un membre du personnel », placeholder "Nom, matricule…") : TRAORE Kouadio. Filtrez par « Catégorie » (« Enseignant »), « Statut » et « Enseigne » (« Peut enseigner » ou « Ne peut pas enseigner »). Choisissez une « Année (charge) » pour trier par charge horaire (aide "Choisissez une année pour trier par charge horaire.").
3. Cliquez sur un nom : la fiche s'ouvre (4.16).
Résultat attendu : les trois enseignants de la graine sont listés (TRAORE Kouadio, YAO Fatou, KOUAME Adjoua) avec statut « En poste ».
Cas invalides : recherche `zzzz` : « Aucun membre ne correspond à votre recherche. »
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat (`/v2/staff` refusé)

#### 4.15 Créer le personnel test guide ; doublon de contact
Compte : Directeur · Où : onglet « Nouveau membre » (`/v2/staff/new`) · Prérequis : aucun
1. Remplissez le formulaire « Nouveau membre du personnel » (identité en haut, puis « Fonction ») :
   | Champ (libellé exact) | Secondaire | Primaire | Supérieur | Obligatoire |
   |---|---|---|---|---|
   | Nom | `OUATTARA` | `OUATTARA` | `OUATTARA` | oui |
   | Prénoms | `Zénon test guide` | `Mariam test guide` | `Seydou test guide` | oui |
   | Sexe | « Masculin » | « Féminin » | « Masculin » | non |
   | Date de naissance | `17/04/1985` | `25/06/1990` | `03/11/1980` | non |
   | Adresse e-mail | `zenon.ouattara.tg@exemple.test` | `mariam.ouattara.tg@exemple.test` | `seydou.ouattara.tg@exemple.test` | non (exigée pour inviter) |
   | Téléphone | `+225 05 66 21 34 78` | `+225 07 70 45 12 90` | `+225 01 22 33 44 55` | non |
   | Ville | `Abidjan` | `Abidjan` | `Bouaké` | non |
   | Catégorie | « Enseignant » | « Enseignant » | « Enseignant » | oui |
   | Intitulé du poste | `Professeur de mathématiques test guide` | `Instituteur titulaire test guide` | `Chargé de cours test guide` | non |
   | Date d'embauche | `01/09/2026` | `01/09/2026` | `01/09/2026` | non |
2. Cliquez sur « Créer la fiche » : écran « Fiche créée » : "OUATTARA Zénon test guide — matricule P00NN." (forme `P` + 4 chiffres, relevez-le), boutons « Ouvrir la fiche » et « Retour à la liste ».
3. **Doublon de contact** : recréez une fiche avec Nom `OUATTARA`, Prénoms `Autre test guide` et **la même adresse e-mail** : à « Créer la fiche », l'encadré de doublon annonce "1 dossier ressemble à cette personne" avec la mention « Même e-mail ». Ne créez pas ce doublon (laissez la case « Ce n'est pas un doublon : créer quand même » décochée et quittez la page).
Résultat attendu : fiche créée avec un matricule ; doublon d'e-mail signalé.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Nom et Prénoms vides | « Ce champ est obligatoire. » |
| Catégorie non choisie | "Choix invalide." ou « Ce champ est obligatoire. » (à relever) |
| E-mail `zenon.exemple` | "Adresse e-mail invalide." |
| Date de naissance dans le futur | "Date de naissance invraisemblable." |
| Doublon coché sans motif | "Un motif est requis pour confirmer un doublon possible." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le directeur des études (`/v2/staff/new` refusé)

#### 4.16 Fiche du personnel : modifier, contrat, qualification, compétence, disponibilité
Compte : Directeur (modification, contrats, qualifications, compétences), Directeur des études (disponibilités) · Où : fiche de `OUATTARA Zénon test guide` (`/v2/staff/<identifiant>`) · Prérequis : 4.15
1. En-tête : "Matricule P00NN — Enseignant — Professeur de mathématiques test guide", boutons « Tout le personnel », « Modifier », « Inviter au portail » (si e-mail), « Changer le statut ». Onglets : « Identité », « Contrats », « Qualifications », « Compétences », « Disponibilités », « Charge horaire », « Historique ».
2. « Modifier » (fenêtre « Modifier OUATTARA Zénon test guide ») : changez « Intitulé du poste » en `Professeur principal test guide`, « Enregistrer » : « La fiche a été mise à jour. »
3. Onglet « Contrats » ("Les contrats ne portent ni tarif ni salaire : la rémunération relève du module Paie.") > « Ajouter un contrat » :
   | Champ (libellé exact) | Valeur | Obligatoire |
   |---|---|---|
   | Type de contrat | "Contrat à durée déterminée" | oui |
   | Statut initial | « En cours » | non |
   | Début | `01/09/2026` | oui |
   | Fin | `31/08/2027` | non |
   | Volume horaire contractuel | `18` | non |
   | Unité | « Par semaine » | non (va avec le volume) |
   | Note | `Contrat de test du guide` | non |
   Validez avec « Ajouter un contrat » : « Le contrat a été ajouté. » La ligne affiche "18 h / semaine", statut « En cours ». Cliquez sur « Terminer » : « Le contrat est terminé. »
4. Onglet « Qualifications » > « Ajouter une qualification » : Nature « Diplôme » ; Intitulé `Licence de mathématiques test guide` ; Délivré par `Université de test (fictive)` ; Date d'obtention `15/07/2010` ; Date d'échéance : une date dans le mois (alerte), par exemple dans 20 jours. « La qualification a été ajoutée. » Sur la liste « Personnel », l'encadré "1 qualification arrive à échéance" apparaît. Cliquez sur « Retirer » : « La qualification a été retirée. »
5. Onglet « Compétences » > « Ajouter une compétence » : Matière = "Mathématiques", Niveaux : cochez un niveau (ou aucun = « Tous niveaux »). « La compétence a été ajoutée. » « Retirer » : « La compétence a été retirée. »
6. Onglet « Disponibilités » (compte études ou direction) > « Ajouter un créneau » : Jour « Lundi », Nature « Indisponible », Début `08:00`, Fin `10:00`, Motif `Réunion de test` : « Les disponibilités sont enregistrées. » « Retirer » supprime le créneau.
7. Onglet « Charge horaire » : sélecteur « Année », « Heures prévues (affectations) », « Volume contractuel par semaine » (`18`), et "Le volume hebdomadaire n'est pas converti en année : le nombre de semaines de l'année n'est pas configuré." ; tableau des affectations (vide avant 4.19).
Résultat attendu : chaque ajout est confirmé par un message ; l'historique reste cohérent.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Contrat sans type | « Ce champ est obligatoire. » |
| Contrat sans date de début | « Ce champ est obligatoire. » |
| Deuxième contrat "à durée déterminée" aux dates qui chevauchent le premier (avant de terminer le premier) | "Un contrat du même type couvre déjà cette période." |
| Qualification sans intitulé | « Ce champ est obligatoire. » |
| Compétence déjà listée | « Cette matière est déjà dans la liste. » |
| Disponibilité dont la fin est avant le début | "La fin doit suivre le début (un créneau ne chevauche pas minuit)." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le directeur des études (ni « Modifier », ni onglet « Contrats »)

#### 4.17 Statut d'un membre du personnel (Attention : à effet durable, personnel test guide seulement)
Compte : Directeur · Où : fiche de `OUATTARA Zénon test guide` · Prérequis : 4.16
1. Cliquez sur « Changer le statut » (fenêtre « Changer le statut de OUATTARA Zénon test guide » : "Le changement est conservé dans l'historique. Un départ met fin aux affectations en cours."). Choisissez « Nouveau statut » = « En congé », « Motif » = `Congé de test`, « Date d'effet » par défaut, « Changer le statut ». Message « Le statut a été modifié. » Revenez à « En poste ».
2. Onglet « Historique » : lignes "En poste → En congé" et "En congé → En poste" avec date d'effet et motif.
3. **À la fin du chapitre** (après 4.19) : « Parti » avec « Date de départ » : les affectations en cours prennent fin ; un retour à « En poste » est possible (motif exigé).
Résultat attendu : chaque changement figure dans l'historique avec son motif ; la fiche n'est jamais supprimée.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Statut « Parti » sans motif | "Un motif est obligatoire (passage de ACTIVE à LEFT)." (codes d'état bruts, voir Écarts) |
| Statut « Suspendu » sans motif | "Un motif est obligatoire (passage de ACTIVE à SUSPENDED)." |
| Valider sans choisir de statut | "Choix invalide." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le directeur des études (aucun bouton « Changer le statut »)

#### 4.18 Rattacher un membre du personnel à un compte (invitation au portail)
Compte : Directeur · Où : fiche de `OUATTARA Zénon test guide` · Prérequis : 4.15 (adresse e-mail renseignée)
1. Dans l'onglet « Identité », « Compte du portail » indique « Aucun compte » ; le bouton « Inviter au portail » est proposé dans l'en-tête.
2. Cliquez sur « Inviter au portail » : message « L'invitation a été envoyée. » Aucun e-mail réel n'est envoyé. Le bouton disparaît ; « Compte du portail » indique un statut (valeur brute possible). Le rôle accordé par défaut est « Enseignant » (catégorie qui peut enseigner) ; au primaire, la graine utilise le rôle « Instituteur », ici le rôle par défaut reste « Enseignant » (à vérifier en test).
3. Dans "Membres" (chapitre Établissement), le compte invité apparaît avec l'adresse e-mail de test (non supprimable : le suspendre en fin de campagne).
Résultat attendu : invitation enregistrée ; l'accès est lié à la fiche (jamais rapproché par e-mail seul).
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Inviter une fiche sans adresse e-mail (retirer l'e-mail puis inviter) | "Une adresse e-mail est nécessaire pour inviter la personne." |
| Réinviter la même personne | le bouton n'est plus proposé |
| Inviter avec une adresse déjà utilisée par un autre accès | "Un accès existe déjà pour cette adresse e-mail : liez la personne à l'identité existante." (aucun écran de liaison manuelle : voir Écarts) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le directeur des études (ni « Modifier » ni « Inviter au portail »)

#### 4.19 Affectations d'enseignement
Compte : Directeur des études · Où : menu « Personnes » > "Affectations" (`/v2/staff/assignments`) · Prérequis : 3.9 (classes test guide) et 4.15 (personnel test guide)
1. Écran « Affectations d'enseignement » ("Qui enseigne quelle matière dans quelle classe. Une matière sans responsable bloque l'ouverture de l'offre correspondante."), onglets « Par classe » et « Par enseignant ». « Année » est préremplie avec l'année courante.
2. Onglet « Par classe » : dans « Classe », cherchez `test guide` et choisissez la classe principale (`6e B test guide`, `CP1 B test guide` ou `Licence 1 B test guide`). Le bandeau indique les matières sans responsable ; la matrice « Matrice matière par rôle d'enseignement » liste les matières (colonnes « Matière », « Responsable », « Co-enseignant », « Suppléant ») et la ligne « Titulaire de classe ».
3. **Primaire** (classe `CP1 B test guide`, encore en brouillon) :
   - cliquez sur « Affecter » sur une matière : refus "La classe est en brouillon : son curriculum n'est pas encore stable." (seul le titulaire est autorisé en brouillon) ;
   - sur la ligne « Titulaire de classe », cliquez sur « Désigner » (fenêtre « Désigner le titulaire de la classe ») : « Enseignant » = `OUATTARA Mariam test guide`, « Rôle » = « Titulaire de classe », « Début » = date du jour (par défaut), cliquez sur « Affecter » : « L'affectation est enregistrée. »
   - **retournez au chapitre 3, scénario 3.9, étape 5** : fiche de `CP1 B test guide` > « Activer » : « La classe CP1 B test guide est active. » (le titulaire existe désormais).
4. **Secondaire** (`6e B test guide`) : sur la ligne `Mathématiques` (ou `MATH`), colonne « Responsable », cliquez sur « Affecter » (fenêtre « Affecter un enseignant à Mathématiques »). Champs : « Enseignant » = `OUATTARA Zénon test guide` ; « Rôle » = « Responsable » ; « Période » = « Toute l'année » ; « Début » = date du jour ; « Fin » vide ; « Heures prévues » = `4` ; « Note » = `Affectation de test`. Cliquez sur « Affecter » : « L'affectation est enregistrée. » Le nom apparaît dans la cellule. Colonne « Co-enseignant » > « Ajouter » : affectez `YAO Fatou` en co-enseignant.
5. **Supérieur** (`Licence 1 B test guide`) : sur la ligne « Titulaire de classe », cliquez sur « Désigner », changez le « Rôle » en « Responsable », cochez « Enseignant généraliste (toutes les matières) » (aide "Pour l'enseignement primaire : un seul enseignant pour toute la classe."), « Enseignant » = `OUATTARA Seydou test guide`, « Affecter ». Retournez au chapitre 3, scénario 3.10, étape 6 (ouverture des offres).
6. Sur la cellule affectée, cliquez sur « Remplacer » (fenêtre « Remplacer OUATTARA … ») : « Nouvel enseignant » = `YAO Fatou`, « Date d'effet » = date du jour, « Motif » = `Remplacement de test` : « Le remplacement est enregistré. » Puis « Terminer » sur la nouvelle affectation (fenêtre « Terminer l'affectation de YAO Fatou » : "L'affectation reste dans l'historique.") : « L'affectation est terminée. » Réaffectez `OUATTARA … test guide` comme responsable pour laisser la classe pourvue.
7. Onglet « Par enseignant » : choisissez `OUATTARA … test guide` : on lit sa « Charge horaire et affectations » (année, heures prévues, affectations).
Résultat attendu : une matière a un seul responsable actif ; l'historique conserve les affectations terminées ; la classe du primaire peut s'activer une fois le titulaire désigné.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Affecter sans choisir d'enseignant | « Choisissez un enseignant. » |
| Deuxième responsable sur la même matière | "Cette matière a déjà un responsable (OUATTARA Zénon test guide) : ajoutez un co-enseignant (CO_TEACHER) ou terminez l'affectation existante." |
| Désigner un second titulaire de la même classe | "Cette classe a déjà un titulaire (…)." |
| Remplacer par le même enseignant | « Choisissez un autre enseignant. » |
| Remplacer sans motif | « Le motif est obligatoire. » |
| Fin avant le début | "La date de fin précède le début." |
| Affecter un membre « Parti » ou « Suspendu » | "Le membre du personnel est LEFT : aucune affectation possible." (code brut) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat (`/v2/staff/assignments` refusé) ; économe : écran refusé aussi (`teaching.read` absent)

#### 4.20 Mon espace (enseignant)
Compte : Enseignant (`enseignant@`) · Où : `/v2/staff/me` (taper l'adresse ; le portail enseignant propose « Mon profil » ailleurs) · Prérequis : aucun
1. L'écran « Mon espace » ("Votre fiche et les classes où vous enseignez.") affiche le nom, la pastille « En poste », « Matricule », « Fonction », « Embauché le » et la section « Mes classes » : la classe de démonstration avec les rôles (« Responsable »/« Titulaire de classe » et « Toutes les matières »).
2. Si l'enseignant n'a aucune affectation : « Vous n'êtes affecté à aucune classe pour le moment. »
Résultat attendu : la fiche et les classes du compte, rien d'autre.
Cas invalides : tapez `/v2/staff` : « Accès refusé ».
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le parent (`/v2/staff/me` refusé)

#### 4.21 Inscriptions : liste, filtres, fiche
Compte : Secrétariat · Où : menu « Académique » > « Inscriptions » (`/v2/enrollments`) · Prérequis : aucun
1. Onglets « Liste des inscriptions » et « Nouvelle inscription ». Colonnes « Élève », « Classe », « N° d'inscription », « Inscrit le », « Financement », « Mode », « Statut » et lien « Ouvrir ».
2. Filtres : « Année », « Classe » (« Toutes les classes »), « Statut » (« En attente », « Active », « Suspendue », « Terminée », « Retirée », « Transférée », « Annulée »), « Financement », « Mode » (« Par classe », « À la carte »), « N° d'inscription » (forme `DEMO-COLLEGE-6E-0003`).
3. Ouvrez une inscription « En attente » de la graine : sections « Résumé » (Élève, Classe, Mode, Inscrit le, Fin d'inscription, Particularités), « Confirmation et frais d'inscription » ("Politique de confirmation : confirmée au paiement des frais d'inscription." puis "L'inscription attend sa confirmation, selon la politique ci-dessus."), « Financement », « Historique des classes », « Historique de l'inscription ». Pour le secrétariat : boutons « Annuler » seulement sur une inscription en attente (pas de « Confirmer » : la confirmation manuelle est une dérogation réservée à la direction).
4. Ouvrez une inscription « Active » : boutons « Suspendre », « Terminer », « Retirer l'élève », « Annuler », « Transférer » ; aucun « Changer le financement » pour le secrétariat.
Résultat attendu : filtres fonctionnels ; statuts conformes (8 actives, 4 en attente au départ, plus les inscriptions issues des admissions) ; la liste est vide avec le message « Aucune inscription ne correspond. » quand aucun filtre ne correspond.
Cas invalides : filtre « N° d'inscription » = `XXXX` : « Aucune inscription ne correspond. »
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'enseignant (`/v2/enrollments` refusé)

#### 4.22 Nouvelle inscription d'un élève existant (assistant)
Compte : Secrétariat · Où : onglet « Nouvelle inscription » (`/v2/enrollments/new`) · Prérequis : 4.3, 3.9 · Ouvre l'inscription de l'élève test guide **principal** (qui restera « En attente » pour le chapitre Finance) puis celle de l'élève 2
1. Étape « Élève » : choisissez « Élève existant », « Élève » = `KOUASSI Aïcha test guide` (recherche par nom ou matricule). (Depuis la fiche de l'élève, le bouton « Inscrire » préremplit cette étape.)
2. Étape « Classe » : « Année » = l'année courante (proposée) ; « Classe » = `6e B test guide` (primaire `CP1 B test guide`, supérieur `Licence 1 B test guide`) ; lisez "Effectif : 0 sur 30. La capacité est indicative." ; « Mode d'inscription » = « Par classe (cursus complet) » (« À la carte » désactivé hors supérieur) ; « Date d'inscription » vide (aujourd'hui) ; « Redoublement » et « Élève venant d'un autre établissement » décochés.
3. Étape « Financement » : « Type de financement » = « Privé » (laisser) ; « Notes » vide.
4. Étape « Récapitulatif » ("Selon la politique de l'établissement, l'inscription peut rester en attente jusqu'au paiement des frais ou à sa confirmation.") : cliquez sur « Inscrire ».
5. Écran « Inscription enregistrée » : "N° d'inscription : DEMO-… Statut : en attente de confirmation." Relevez le numéro. Boutons « Ouvrir l'inscription », « Inscrire un autre élève », « Retour à la liste ».
6. Cliquez sur « Inscrire un autre élève » et recommencez avec `KOUASSI Brice test guide` dans la même classe `6e B test guide` (élève 2).
Résultat attendu : deux inscriptions « En attente » ; l'effectif de la classe passe à 2 / 30 ; l'élève principal reste « En attente » jusqu'au paiement (chapitre Finance).
Cas invalides :
| Saisie | Message attendu |
|---|---|
| « Suivant » sans choisir d'élève | « Choisissez un élève. » |
| « Suivant » sans classe | « Choisissez une classe. » |
| Cocher « Élève venant d'un autre établissement » sans établissement d'origine | « Indiquez l'établissement d'origine. » |
| Réinscrire l'élève principal dans la même classe | avertissement "Cet élève a déjà une inscription en cours cette année. Le serveur refusera un doublon dans la même classe." puis refus "L'apprenant a déjà une inscription vivante dans cette classe." |
| Inscrire le même élève dans une autre classe de la même année | "L'apprenant a déjà une inscription de classe cette année dans cet établissement." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le directeur des études (`/v2/enrollments/new` refusé)

#### 4.23 Inscription conditionnée au paiement : confirmer sans paiement (dérogation de la direction)
Comptes : Secrétariat puis Directeur · Où : fiche de l'inscription de `KOUASSI Brice test guide` (élève 2) · Prérequis : 4.22
1. Secrétariat : sur l'inscription « En attente », la section « Confirmation et frais d'inscription » dit "Politique de confirmation : confirmée au paiement des frais d'inscription." ; seul le bouton « Annuler » est proposé (pas de « Confirmer »).
2. Directeur : ouvrez la même fiche. Le bouton « Confirmer sans paiement » est proposé, ainsi que l'indication "L'inscription sera confirmée automatiquement au paiement. Une personne habilitée peut la confirmer sans paiement, en indiquant un motif." Cliquez dessus : la fenêtre « Confirmer sans paiement (dérogation) » rappelle "Cette inscription attend le paiement des frais. La confirmer à la main est une dérogation de la direction : le motif est obligatoire…". Saisissez le « Motif » `Dérogation de test du guide`, cliquez sur « Confirmer sans paiement ».
3. Message « L'inscription est confirmée par dérogation. » ; statut « Active » ; la section affiche "Mode de confirmation : dérogation de la direction (sans paiement)." et "Motif de la dérogation : Dérogation de test du guide". Une ligne « Changement d'état » apparaît dans « Historique de l'inscription ».
4. L'inscription de l'**élève principal** (`KOUASSI Aïcha test guide`) n'est **pas** confirmée : elle l'est par le paiement des frais (chapitre Finance, facture d'inscription), de façon asynchrone ; après paiement, rechargez la fiche : statut « Active » et "Mode de confirmation : paiement des frais."
Résultat attendu : la dérogation exige la permission dédiée et un motif ; elle est tracée ; le paiement confirme automatiquement.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Motif vide, « Confirmer sans paiement » | « Le motif doit comporter au moins 5 caractères. » |
| Motif de 3 caractères | « Le motif doit comporter au moins 5 caractères. » |
| Confirmer (appel direct) avec un compte sans la permission de dérogation | refus 403 `academic.enrollment_override_required` (aucun bouton pour le secrétariat) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat (pas de bouton de dérogation)

#### 4.24 Suspendre, reprendre, transférer
Compte : Secrétariat · Où : fiche de l'inscription de `KOUASSI Brice test guide` (maintenant « Active ») · Prérequis : 4.23
1. Cliquez sur « Suspendre » (fenêtre « Suspendre l'inscription » : "L'élève n'est plus compté dans les présences et les notes tant que l'inscription est suspendue.") : « Motif » = `Absence prolongée de test`, « Suspendre ». Message « L'inscription est suspendue. » Statut « Suspendue ».
2. Cliquez sur « Reprendre » : « L'inscription est reprise. » (aucun motif demandé). Statut « Active ».
3. Cliquez sur « Transférer » (fenêtre « Transférer vers une autre classe » : "L'élève change de classe ; son historique de placements est conservé."). Champs :
   | Champ (libellé exact) | Valeur | Obligatoire |
   |---|---|---|
   | Classe de destination | `6e C test guide` (primaire `CP1 C test guide`, supérieur `Licence 1 C test guide`) | oui |
   | Date d'effet | (vide : aujourd'hui) | non |
   | Motif | `Transfert de test du guide` | oui (5 caractères au moins) |
   Cliquez sur « Transférer » : message « L'élève est transféré. » La section « Historique des classes » montre deux placements (6e B puis 6e C, "en cours" sur le second) ; la classe `6e C test guide` affiche `1 / 1`.
Résultat attendu : chaque action ajoute une ligne d'historique avec son motif ; le transfert conserve la même inscription et ajoute un placement.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Suspendre sans motif | « Le motif doit comporter au moins 5 caractères. » |
| Transférer sans choisir de classe | « Choisissez la classe de destination. » |
| Transférer vers la classe actuelle | « L'élève est déjà dans cette classe. » |
| Motif de 2 caractères | « Le motif doit comporter au moins 5 caractères. » |
| Transférer l'élève principal (En attente) | le bouton « Transférer » n'est pas proposé (seulement pour « Active » et « Suspendue ») |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le directeur des études (voir 4.29)

#### 4.25 Inscrire un nouvel élève par l'assistant d'inscription ; classe pleine
Compte : Secrétariat · Où : `/v2/enrollments/new` · Prérequis : 4.24 (`6e C test guide` est pleine : 1 / 1) · Crée l'élève 3
1. Étape « Élève » : choisissez « Nouvel élève » et saisissez (identité abrégée) :
   | Champ (libellé exact) | Secondaire | Primaire | Supérieur | Obligatoire |
   |---|---|---|---|---|
   | Nom | `KOUASSI` | `TRAORE` | `KONÉ` | oui |
   | Prénoms | `Cécile test guide` | `Mariam test guide` | `Awa test guide` | oui |
   | Sexe | « Féminin » | « Féminin » | « Féminin » | oui |
   | Date de naissance | `09/09/2014` | `05/11/2019` | `30/03/2005` | non |
   « Suivant » (le serveur contrôle les doublons sans écrire).
2. Étape « Classe » : choisissez la classe pleine `6e C test guide` (capacité 1 bloquante). La note annonce "Effectif : 1 sur 1. La capacité est bloquante." Poursuivez jusqu'à « Inscrire ».
3. Refus : "la classe est complète (1 places)" (message du serveur). Le dossier de l'élève a été créé : l'étape « Élève » affiche "Le dossier de l'élève a été créé ; l'inscription peut être relancée sans le recréer."
4. Revenez à l'étape « Classe », choisissez `6e B test guide` (primaire `CP1 B test guide`, supérieur `Licence 1 B test guide`) et cliquez sur « Inscrire » : « Inscription enregistrée », statut en attente.
Résultat attendu : le dossier n'est créé qu'une fois ; la capacité bloquante refuse l'inscription ; la relance fonctionne sans doublon.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Nouvel élève sans sexe | "Le sexe est obligatoire pour un élève." |
| Nouvel élève au nom d'un élève existant (même date de naissance) | l'encadré de doublon et "Des dossiers similaires existent : confirmez la création avec un motif, ou choisissez « Élève existant »." |
| Inscrire dans une classe annulée ou terminée | "La classe est CANCELLED : elle n'accepte plus d'inscription." (non joué) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'éducateur (`/v2/enrollments/new` refusé)

#### 4.26 Changer le financement d'une inscription
Comptes : Économe ou Directeur · Où : fiche de l'inscription de `KOUASSI Cécile test guide` (élève 3) · Prérequis : 4.25
1. Section « Financement » : "Type Privé". Cliquez sur « Changer le financement » (fenêtre du même nom : "Le changement est journalisé avec son motif.").
2. Champs :
   | Champ (libellé exact) | Valeur | Obligatoire |
   |---|---|---|
   | Type de financement | "Boursier" | oui |
   | Référence d'affectation | (vide) | selon le type |
   | Date de la décision | (vide) | non |
   | Financeur | `Fondation de test (fictive)` | oui pour ce type |
   | Motif | `Bourse de test du guide` | oui |
   Cliquez sur « Enregistrer » : message « Le financement est modifié. » ; la section affiche le type "Bourse" et le financeur ; une ligne « Changement de financement » apparaît dans l'historique.
Résultat attendu : changement tracé avec son motif.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| "Boursier" sans « Financeur » | « Le financeur est obligatoire pour ce financement. » |
| "Affecté par l'État" sans référence (secondaire seulement : le type n'est proposé que dans le pack Secondaire) | « La référence d'affectation est obligatoire pour ce financement. » |
| « Motif » vide | « Ce champ est obligatoire. » ou « Le motif doit comporter au moins 5 caractères. » (à relever) |
| Secrétariat | le bouton « Changer le financement » n'existe pas |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le secrétariat (pas de bouton)

#### 4.27 Annuler une inscription en attente (Attention : définitif)
Compte : Secrétariat · Où : fiche de l'inscription de `KOUASSI Cécile test guide` · Prérequis : 4.26
1. Cliquez sur « Annuler » (fenêtre « Annuler l'inscription » : "L'annulation est définitive : le motif est conservé dans l'historique."), « Motif » = `Annulation de test du guide`, confirmez avec « Annuler ». Message « L'inscription est annulée. » Statut « Annulée ». Aucun bouton d'action ne reste.
2. Vérifiez la classe : l'effectif retombe (la classe `6e B test guide` repasse à son effectif sans l'élève 3).
Résultat attendu : annulation définitive et motivée, tracée dans l'historique ; une annulation ne se défait pas.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| Annuler sans motif | « Le motif doit comporter au moins 5 caractères. » |
| Annuler une inscription déjà active | selon la voie, le serveur peut proposer de la "retirer" : "L'inscription est ACTIVE : seule une inscription en attente s'annule (une inscription confirmée se retire)." (à vérifier selon l'écran) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le directeur des études (le bouton « Annuler » apparaît mais l'API refuse sans `enrollment.cancel`, voir Écarts)

#### 4.28 Retirer une inscription et changer le statut d'un élève (Attention : à effet durable, élèves 2 et 3 seulement)
Compte : Secrétariat · Où : fiche de l'inscription de `KOUASSI Brice test guide` puis fiche de `KOUASSI Cécile test guide` · Prérequis : 4.24, 4.27
1. Inscription de l'élève 2 (« Active ») : cliquez sur « Retirer l'élève » (fenêtre « Retirer l'élève » : "Le retrait met fin à l'inscription : le motif est conservé dans l'historique."), « Motif » = `Retrait de test du guide`, confirmez. Message « L'élève est retiré. » ; statut « Retirée ».
2. Fiche de l'élève 3 (`KOUASSI Cécile test guide`), « Changer le statut » (fenêtre « Changer le statut de KOUASSI Cécile test guide » : "Le changement est conservé dans l'historique avec son auteur et son motif.") :
   - « Nouveau statut » = « Suspendu », « Motif » = `Suspension de test`, « Date d'effet » par défaut : « Le statut a été modifié. » Onglet « Statut » (« Historique des statuts » : « Date d'effet », « Changement », « Motif ») : "Actif → Suspendu".
   - Revenez à « Actif » (aucun motif exigé depuis « Suspendu »).
   - « Retiré » avec « Motif » = `Départ de test` : « Le statut a été modifié. » ; les inscriptions en cours seraient retirées automatiquement (par événement, avec un léger délai) et l'accès au portail suspendu.
3. Onglet « Statut » : trois lignes d'historique (Actif → Suspendu, Suspendu → Actif, Actif → Retiré).
Résultat attendu : chaque changement figure à l'historique avec son auteur et son motif ; aucun dossier n'est supprimé.
Cas invalides :
| Saisie | Message attendu |
|---|---|
| « Retiré » sans motif | "Un motif est obligatoire (passage de ACTIVE à WITHDRAWN)." |
| « Suspendu » sans motif | "Un motif est obligatoire (passage de ACTIVE à SUSPENDED)." |
| « Archivé » depuis « Actif » | "Passage du statut ACTIVE à ARCHIVED interdit." (le statut proposé n'est pas autorisé : codes bruts, voir Écarts) |
| Retirer l'élève sans motif | « Le motif doit comporter au moins 5 caractères. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le directeur des études (aucun bouton « Changer le statut »)

#### 4.29 Droits, périmètres et isolation
Comptes : voir ci-dessous · Prérequis : 4.3, 4.15, 4.19, 4.22
1. **Enseignant** (`enseignant@`) : ouvrez `/v2/students` : seuls les élèves de ses classes (la classe de démonstration) sont listés ; cherchez `test guide` : aucun résultat (l'élève test guide n'est pas dans une classe où il est affecté). Ouvrez la fiche d'un élève de sa classe : bandeau "Fiche réduite : vous voyez les informations nécessaires à votre classe, sans coordonnées ni historique complet." ; onglets limités (« Identité », « Urgences »). Tapez `/v2/guardians` et `/v2/enrollments` : « Accès refusé ». Collez l'adresse de la fiche de l'élève test guide (relevée avec le secrétariat) : message du type "Élève introuvable (identifiant)."
2. **Directeur des études** (`etudes@`) : `/v2/students` et `/v2/guardians` se lisent ; fiche élève sans « Modifier », sans « Changer le statut », sans section « Informations sensibles », onglet « Pièces » = « Accès restreint » ; `/v2/staff` : pas de « Nouveau membre » ni d'onglet « Contrats » ; `/v2/students/new`, `/v2/staff/new`, `/v2/enrollments/new` : « Accès refusé ». Sur une inscription, les boutons « Suspendre », « Transférer » existent ; « Retirer l'élève » et « Annuler » s'affichent aussi mais le serveur refuse l'action (permission `enrollment.cancel` absente : message "Action non autorisée." à relever).
3. **Éducateur** (`educateur@`) : `/v2/students`, la fiche élève et `/v2/enrollments` se lisent sans aucun bouton d'écriture ni « Exporter (CSV) » ; `/v2/staff` et `/v2/students/new` : « Accès refusé ».
4. **Secrétariat** : `/v2/staff`, `/v2/staff/new`, `/v2/staff/assignments` : « Accès refusé ».
5. **Parent** : `/v2/students/children` ne montre que Nadia et Salimata DIABATE ; `/v2/students`, `/v2/guardians`, `/v2/enrollments` : « Accès refusé ».
6. **Isolation entre établissements** : connecté au Collège, copiez les adresses d'une fiche élève, d'une fiche tuteur, d'une fiche personnel et d'une inscription (`/v2/students/<identifiant>`, `/v2/guardians/<identifiant>`, `/v2/staff/<identifiant>`, `/v2/enrollments/<identifiant>`) ; connectez-vous à l'École avec le compte de même rôle et collez chacune : chaque écran affiche un message d'introuvable ("Élève introuvable (…)", "Tuteur introuvable (…)", "Membre du personnel introuvable (…)", "Inscription introuvable (…)"), sans aucune donnée.
Résultat attendu : chaque refus de droit redirige vers « Accès refusé » ; un identifiant hors périmètre répond "introuvable" ; les boutons d'écriture n'apparaissent pas sans le droit.
- [ ] Cas nominal  - [ ] Cas invalide (adresses interdites)  - [ ] Droit refusé pour chacun des rôles ci-dessus

---

## Données créées

**Noms stables utilisés par les autres chapitres.** Tous portent le suffixe "test guide". Les trois établissements reçoivent des données de même forme.

| Objet | Collège Le Baobab | École Les Palmiers | Université Horizon |
|---|---|---|---|
| **Élève test guide (principal)** : Nom, Prénoms | `KOUASSI`, `Aïcha test guide` (affiché "KOUASSI Aïcha test guide"), F, née le 12/05/2014 | `TRAORE`, `Awa test guide` ("TRAORE Awa test guide"), F, née le 14/03/2019 | `KONÉ`, `Ibrahim test guide` ("KONÉ Ibrahim test guide"), M, né le 21/07/2005 |
| Matricule | attribué à la création (à relever en 4.3) | idem | idem |
| **Tuteur test guide** | `KOUASSI Marcel test guide`, père, `marcel.kouassi.tg@exemple.test` | `TRAORE Moussa test guide`, `moussa.traore.tg@exemple.test` | `KONÉ Seydou test guide`, `seydou.kone.tg@exemple.test` |
| **Classe test guide** (inscription du principal) | `TG-6EB` "6e B test guide" (active) | `TG-CP1B` "CP1 B test guide" (active après 4.19) | `TG-L1B` "Licence 1 B test guide" (active) |
| Inscription de l'élève principal | créée en 4.22, **En attente** jusqu'au paiement des frais d'inscription (chapitre Finance) ; numéro `DEMO-<programme>-<niveau>-NNNN` à relever | idem | idem |
| Élève 2 (frère ou sœur) | `KOUASSI Brice test guide` | `TRAORE Issa test guide` | `KONÉ Rokia test guide` |
| Élève 3 (inscription annulée, statut « Retiré ») | `KOUASSI Cécile test guide` | `TRAORE Mariam test guide` | `KONÉ Awa test guide` |
| **Personnel test guide** (enseignant) | `OUATTARA Zénon test guide`, `zenon.ouattara.tg@exemple.test`, responsable de Mathématiques de `TG-6EB` | `OUATTARA Mariam test guide`, `mariam.ouattara.tg@exemple.test`, titulaire de `TG-CP1B` | `OUATTARA Seydou test guide`, `seydou.ouattara.tg@exemple.test`, responsable généraliste de `TG-L1B` |

Précisions : l'élève test guide principal est le seul que les autres chapitres peuvent utiliser (facture « Facture n°1 test guide » dans le chapitre Finance, appels, notes) ; les élèves 2 et 3 sont réservés au chapitre 4. Les comptes invités (tuteur, personnel) existent en local et ne se connectent pas.

Autres enregistrements du chapitre : lien de parenté secondaire `KOUASSI Adjoua test guide` (lien clos), antécédent scolaire (retiré), pièce "Acte de naissance test guide" (retirée), contact d'urgence `BAMBA Oncle test guide` (retiré, sur la fiche DIABATE Nadia), contrat (terminé), qualification (retirée), compétence (retirée), créneau de disponibilité (retiré), historiques de statut, inscriptions et affectations (conservés).

## Écarts constatés

| Écran | Constat | Gravité |
|---|---|---|
| Fiche élève, onglet « Identité » | Aucun écran ne permet de saisir l'identifiant national, le numéro, la date et le centre de l'acte de naissance : « Informations sensibles » ne montre que des valeurs vides (sauf import). | Mineur |
| Création d'un tuteur dans les assistants | L'assistant « Nouvel élève » et la fenêtre « Lier un tuteur » (nouveau tuteur) n'ont ni téléphone ni e-mail pour le tuteur (identité abrégée) ; il faut passer par « Nouveau tuteur » ou « Modifier » (rapport QA C-04-13). | Mineur |
| Téléphones | Aucun contrôle du nombre de chiffres : seule la longueur de 5 caractères est exigée et "aucun chiffre" est refusé ; un numéro ivoirien trop court est accepté. | Mineur |
| Fiche élève, fiche tuteur | Le lien de parenté du tuteur principal (`FATHER`), le « Compte du portail » (statut brut) et les codes d'état dans les messages ("passage de ACTIVE à WITHDRAWN") sont affichés bruts. | Mineur |
| Changer le statut d'un élève / du personnel | La liste propose tous les statuts, y compris ceux que la machine d'états refuse (« Archivé » depuis « Actif ») : le refus vient du serveur. | Suggestion |
| Fiche d'inscription (direction des études) | Les boutons « Retirer l'élève » et « Annuler » apparaissent avec `enrollment.update` alors que l'API exige `enrollment.cancel` (absent du directeur des études) : clic puis refus. | Mineur |
| Navigation famille / enseignant | « Mes enfants » (parent) et « Mon espace » (enseignant) ne sont pas dans le menu de leur portail : l'entrée mène à `/v2/parent` ou au portail enseignant ; les écrans `/v2/students/children` et `/v2/staff/me` ne s'atteignent qu'en tapant l'adresse ou par l'onglet de la barre de leur module. | Mineur |
| Invitation au portail | Aucun écran pour relier une personne à un accès déjà existant (`POST /people/persons/<id>/identity`) ; l'erreur "Un accès existe déjà pour cette adresse e-mail : liez la personne à l'identité existante." n'a donc pas de suite dans l'interface. | Mineur |
| Rôle accordé au personnel du primaire | Le bouton « Inviter au portail » du personnel accorde « Enseignant » par défaut, alors que la graine utilise « Instituteur » au primaire (à vérifier). | Mineur |
| Inscription du secrétariat sous politique liée au paiement | Une inscription en attente ne peut qu'être annulée par le secrétariat (rapport QA C-04-15) : le bouton « Confirmer » n'existe pas, la dérogation est réservée à la direction. Conforme à la décision O-01, mais surprenant. | Suggestion |
| Contacts d'urgence | La priorité vide devient 100 côté serveur alors que l'aide dit « 0 = appelé en premier. » (rapport QA C-04-17). | Mineur |
| Anonymisation d'un dossier archivé | La permission `student.anonymize` n'a aucun écran (spec 008 AC3.6) : ne pas tester. | Mineur |
| Paramètres des personnes | Le menu "Paramètres des personnes" n'a pas d'écran ; les motifs de matricule se règlent dans « Paramètres académiques » > « Numérotation » (chapitre 3). | Mineur |

## À vérifier en test

- Matricule exact attribué (motif `{SEQ:5}`) : il peut dépasser `00016` si des tests précédents ont créé des élèves.
- Forme d'affichage des téléphones après enregistrement (normalisation sans espaces ?).
- Pastille « Compte du portail » après invitation (valeur brute ou libellé).
- Message exact d'élève introuvable pour un identifiant hors périmètre ("Élève introuvable (identifiant)." attendu).
- Stockage des pièces : si le service n'est pas branché, le dépôt répond "Le stockage de fichiers n'est pas disponible." (le message `documentsUnavailable` du web ne s'affiche plus).
- Effet différé d'un statut « Retiré » sur l'inscription en cours (abonné asynchrone).
- Priorité par défaut d'un contact d'urgence (100).
- Boutons proposés au directeur des études sur une inscription (voir Écarts).

## Non couvert / limites connues

- Anonymisation d'un dossier archivé et durée de conservation : aucun écran.
- Fusion de dossiers en double : hors périmètre de cette version (le doublon est un avertissement, jamais une fusion).
- Photo de l'élève : routes API sans écran dans ces pages.
- Inscription à la carte (cours choisis, offres) : réservée au supérieur ; l'ajout d'un cours dans la fiche d'inscription n'est pas joué ici (voir chapitre 3, scénario 3.10).
- Inscriptions en lot : par l'import (chapitre Imports), pas dans ces écrans.
- Édition du statut d'un tuteur (archivage) : aucun écran.
- Les paiements qui confirment une inscription sont joués dans le chapitre Finance.
