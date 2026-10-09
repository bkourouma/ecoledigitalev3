# Chapitre 1. Plateforme et établissement

Ce chapitre couvre deux espaces :

- la **console de la plateforme** (dossier `app/v2/platform`), réservée à l'opérateur d'EcoleDigitale : connexion, organisations (liste, création, fiche, statut, abonnement, dérogations), plans et catalogue, journal de plateforme ;
- l'**administration de l'établissement par son propriétaire** : accueil (`/v2/home`), profil et marque, établissements et campus, mise en service, abonnement et usage (`app/v2/(admin)/settings`), rôles et attributions (`app/v2/(admin)/access`), journal d'audit (`app/v2/(admin)/audit`). Il couvre aussi les **droits d'accès aux modules selon l'abonnement** (un module hors de l'offre est absent du menu) et la **création d'un rôle personnalisé**.

La connexion des établissements, la double authentification, les comptes et les membres sont dans le chapitre 2.

**URL réelle.** L'adresse du navigateur est `http://localhost:3000/v2/...` : le dossier `apps/web/src/app/v2/` correspond au préfixe `/v2` (aucune réécriture dans `next.config.js`, le `middleware.ts` ne fait que poser des en-têtes) et les groupes de routes `(admin)` et `(console)` ne figurent pas dans l'adresse. L'API écoute sur `http://localhost:4000`. Un refus de droit sur une page d'établissement redirige vers `/unauthorized` (hors préfixe `/v2`), page « Accès refusé ».

## Prérequis

- L'application tourne avec les trois établissements de départ (annexe "Données de départ"). On ne **modifie pas durablement** ces trois établissements : les réglages touchés sont rétablis à la fin du scénario, et tout ce qui ne peut pas être supprimé se fait dans les établissements jetables décrits plus bas.
- **Deux navigateurs (ou une fenêtre normale et une fenêtre privée).** Se connecter à un établissement dans un navigateur efface le jeton d'opérateur de ce même navigateur (voir `LoginFlow.finish`, qui retire `superAdminToken`). Règle : **fenêtre A = comptes d'établissement** (propriétaire, directeur, éducateur…), **fenêtre B (privée) = console de la plateforme**. Une troisième fenêtre privée sert aux comptes qui ne doivent pas se mélanger (éducateur, enseignant).
- **Aucun courrier n'est envoyé ni stocké** dans cet environnement : le serveur d'API n'a pas de transport e-mail (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` absents de `apps/api/.env` et de `.dev-v2/env.local` ; sans eux le notifieur se contente de journaliser "invitation NON envoyée", voir `apps/api/src/platform/account-notifier.ts`). Conséquence : **une personne invitée ou une organisation créée avec un e-mail neuf ne pourra jamais choisir de mot de passe ni se connecter**. Tout ce chapitre est conçu pour ne pas en dépendre (voir les établissements jetables).
- Chaque enregistrement créé porte "test guide" dans son nom ; les identifiants contraints (slug, codes) portent le préfixe `tg-` **en minuscules**, car l'identifiant d'une organisation et les codes n'acceptent que minuscules, chiffres et tirets.
- Ordre conseillé : 1.1 à 1.11 (console), puis 1.12 à 1.19 et 1.23 (établissement), puis 1.20 à 1.22 (établissement jetable avec propriétaire emprunté, facultatif et avancé), puis 1.24, 1.25 et la section "Nettoyage".

## Comptes à utiliser

| Rôle | Établissement | E-mail | MFA |
|---|---|---|---|
| Opérateur de la plateforme | aucun (console) | **fourni par la personne qui exploite l'environnement**, voir ci-dessous | non |
| Propriétaire | Collège Le Baobab (`secondaire-test`) | `direction.generale@secondaire-test.test` | oui |
| Propriétaire | École Les Palmiers (`primaire-test`) | `direction.generale@primaire-test.test` | oui |
| Propriétaire | Université Horizon (`superieur-test`) | `direction.generale@superieur-test.test` | oui |
| Directeur | Collège Le Baobab | `directeur@secondaire-test.test` | oui |
| Secrétariat | Collège Le Baobab | `secretariat@secondaire-test.test` | oui |
| Éducateur | Collège Le Baobab | `educateur@secondaire-test.test` | non |
| Enseignant, Parent, Élève (refus) | Collège Le Baobab | `enseignant@…`, `parent@…`, `eleve@secondaire-test.test` | non |

Pour les comptes d'établissement : ouvrir `http://localhost:3000/login` et cliquer sur le compte dans le panneau de droite (le formulaire se remplit, et pour les comptes à MFA le code du moment est saisi automatiquement ; détails au chapitre 2). Aucun mot de passe n'est écrit dans ce guide.

### Où l'opérateur trouve ses identifiants (sans les écrire)

L'opérateur de la plateforme n'est **pas** dans le panneau de `/v2/login` : le fichier de comptes de test `.dev-v2/credentials.json` ne contient que les 37 comptes des trois établissements. L'opérateur est un compte unique ("super-administrateur") créé ou mis à jour à chaque démarrage de l'API à partir des variables d'environnement `SUPER_ADMIN_EMAIL` et `SUPER_ADMIN_PASSWORD` (fichier `apps/api/.env`, avec une copie dans `apps/web/.env.local`) ; voir `apps/api/src/services/super-admin-bootstrap.service.ts`. Il n'a pas de double authentification. **La personne qui lance l'environnement communique ces deux valeurs au testeur** ; un agent qui ne les a pas reçues dans la conversation note les scénarios 1.1 à 1.11 et 1.20 à 1.22 "non exécutés" et ne cherche jamais le mot de passe ailleurs. Ne jamais recopier l'e-mail ni le mot de passe dans un rapport.

## Droits

Sources : gardes `requirePermission` des `layout.tsx` de `app/v2/(admin)/{settings,access,audit}`, garde côté navigateur de `OperatorShell`, rôles de `apps/api/src/modules/rbac/templates/system-roles.ts`.

| Écran | Garde de la page | Rôles qui y accèdent | Écriture |
|---|---|---|---|
| pages de la console sous `/v2/platform` (sauf la connexion) | jeton d'opérateur dans le navigateur ; sinon redirection vers `/v2/platform/login` | opérateur seul | tout, tracé dans le journal de plateforme |
| `/v2/home` | session ouverte | tous les rôles (le contenu dépend du menu du rôle) | aucune |
| `/v2/settings`, `/v2/settings/institutions`, `/v2/settings/onboarding` | `tenancy.institution.read` | propriétaire, directeur, directeur des études, secrétariat, économe, éducateur, responsable pédagogique, responsable des examens, chargé d'admissions | `tenancy.institution.manage` et `tenancy.campus.manage` : propriétaire et directeur ; les autres voient « Vous pouvez consulter ces informations mais pas les modifier. » |
| `/v2/settings/subscription` | `tenancy.institution.read` pour ouvrir la page, mais les données exigent `entitlements.read` | propriétaire et directeur (les autres rôles qui ouvrent la page reçoivent "Action non autorisée." dans la page) | aucune (l'abonnement est géré par la console) |
| `/v2/access`, `/v2/access/roles`, `/v2/access/roles/<identifiant>`, `/v2/access/roles/new`, `/v2/access/assignments` | `rbac.role.read` | propriétaire et directeur | rôles (créer, cloner, modifier, supprimer) : `rbac.role.manage`, **propriétaire seul** ; attributions : `rbac.assignment.manage` (propriétaire et directeur), action sensible (MFA) |
| `/v2/audit`, `/v2/audit/<identifiant>` | `audit.read` | propriétaire et directeur | export CSV : `audit.export`, sensible (MFA) |

**Adresses à taper à la main qui doivent être refusées** (résultat attendu : redirection vers `/unauthorized`, page « Accès refusé » avec le texte "Vous n'avez pas les droits nécessaires pour afficher cette page.", lien "Retour à l'accueil", aucune donnée de l'établissement) :

| Compte | Adresses |
|---|---|
| Enseignant, Parent, Élève | `/v2/settings`, `/v2/settings/institutions`, `/v2/settings/onboarding`, `/v2/settings/subscription`, `/v2/access/roles`, `/v2/access/assignments`, `/v2/audit` |
| Éducateur | `/v2/access/roles`, `/v2/access/roles/new`, `/v2/access/assignments`, `/v2/audit` (en revanche `/v2/settings` s'ouvre en lecture seule) |
| Secrétariat | `/v2/access`, `/v2/access/roles/new`, `/v2/audit`, `/v2/audit/11111111-1111-4111-8111-111111111111` |
| Directeur | aucune de ces pages n'est refusée ; il voit les rôles mais ni « Nouveau rôle » ni « Cloner » (voir 1.17 et 1.19) |
| Personne non connectée | `/v2/home`, `/v2/settings`, `/v2/access/roles`, `/v2/audit` : redirection vers `/login` |
| Opérateur sans session d'établissement | `/v2/settings`, `/v2/home` : redirection vers `/login` |
| Propriétaire d'établissement (sans jeton d'opérateur) | `/v2/platform/tenants`, `/v2/platform/plans`, `/v2/platform/audit` : redirection vers `/v2/platform/login` |

## Données de départ

Source : `scripts/dev-v2/seed.ts`, `scripts/seed-v2/scenario.ts` (étape 1 : "console : organisation, abonnement PROFESSIONAL"), `scripts/seed-v2/dataset.ts`.

- **Organisations** (console, `/v2/platform/tenants`) : « Collège Le Baobab (démonstration) » (`secondaire-test`), « École primaire Les Palmiers (démonstration) » (`primaire-test`), « Université Horizon (démonstration) » (`superieur-test`), toutes au statut « Active ».
- **Abonnement de chacune** : offre PROFESSIONAL (libellé "Professionnel"), statut ACTIVE (« Actif »), **un seul pack** (celui de l'établissement : Secondaire, Primaire ou Supérieur), tranche d'apprenants vide (illimitée), aucune dérogation. Plans du catalogue : STARTER ("Starter"), PROFESSIONAL ("Professionnel"), ENTERPRISE (« Entreprise ») ; packs PRIMARY, SECONDARY, HIGHER, VIRTUAL (`apps/api/src/modules/entitlements/migrations/0151_entitlements_catalog.sql`).
- **Rôles** : les 14 rôles système existent dans chaque établissement (propriétaire, directeur, directeur des études, secrétariat, économe, enseignant, instituteur, éducateur, responsable pédagogique, responsable des examens, chargé d'admissions, personnel, parent, élève) ; **aucun rôle personnalisé**. Chaque compte de test a une attribution "tout l'établissement".
- **Mise en service** : l'état exact des 11 étapes dépend de la graine ; le relever au scénario 1.15 sans rien modifier.
- **Journal d'audit** : il contient déjà les actions de mise en place (rôles, attributions, accès créés). Les entrées arrivent avec un **léger retard** (quelques secondes) car elles passent par la file de traitement : actualiser avant de conclure à une absence.

## Les deux établissements jetables

La console permet de créer des organisations ; **aucune suppression n'existe** (on les archive à la fin). Deux organisations de test sont utilisées, créées aux scénarios 1.4 et 1.20 :

| | Organisation A | Organisation B |
|---|---|---|
| Nom / identifiant | École jetable test guide / `tg-jetable` | École multi test guide / `tg-multi` |
| Propriétaire invité | e-mail fictif `proprietaire.tgjetable@exemple.test` : **personne ne pourra jamais s'y connecter** (pas de courrier) | e-mail **d'un compte existant** (`direction.generale@primaire-test.test`) : cette personne devient aussi propriétaire de l'organisation B et peut s'y connecter avec ses identifiants habituels |
| Usage | tests de la console seule (statut, abonnement, dérogations, réconciliation) sans aucun risque | tests qui exigent une session dans l'établissement : établissement et campus, mise en service jusqu'à la production, droits selon l'abonnement, suspension, dernier propriétaire, invitation de membres (chapitre 2), changement d'établissement (chapitre 2) |
| Risque | nul | le compte propriétaire du Primaire appartient alors à **deux** établissements : sa prochaine connexion sans sous-domaine ouvre l'établissement utilisé en dernier ; si un autre testeur se connecte à ce compte après un passage dans B, il peut arriver dans B (voir le retour à la normale, scénario 1.22 étape finale) |

---

## Partie A. Console de la plateforme

#### 1.1 Connexion de l'opérateur
Compte : opérateur · Où : fenêtre privée B, `http://localhost:3000/v2/platform/login` (`/v2/platform/login`) · Prérequis : identifiants d'opérateur fournis
1. Ouvrir `/v2/platform/login`. La page affiche le titre « Console plateforme », le texte « Connexion réservée aux opérateurs EcoleDigitale, distincte de la connexion des établissements. », les champs « Adresse e-mail » et « Mot de passe » et le bouton « Se connecter ».
2. Faire d'abord les cas invalides du tableau ci-dessous.
3. Saisir l'adresse e-mail et le mot de passe de l'opérateur, cliquer « Se connecter ».
4. Cliquer « Se déconnecter » (en haut à droite).
5. Rouvrir `/v2/platform/login` après une nouvelle connexion : la page redirige aussitôt vers `/v2/platform/tenants` (déjà connecté).

Résultat attendu : arrivée sur `/v2/platform/tenants`, titre « Organisations » ; menu de la console « Organisations », « Plans et catalogue », « Journal de plateforme » (trois entrées, aucune gestion d'établissement) ; en-tête "Connecté en tant que" suivi de l'e-mail de l'opérateur (masqué sur très petit écran) ; « Se déconnecter » ramène à `/v2/platform/login` et la console n'est plus accessible sans nouvelle connexion. Le bouton affiche « Connexion… » pendant l'envoi.
Cas invalides :

| Saisie | Message attendu |
|---|---|
| Aucun champ rempli, clic sur « Se connecter » | « Ce champ est obligatoire. » sous chacun des deux champs, aucun appel au serveur |
| E-mail de l'opérateur, mot de passe `MotDePasseFaux-TG-2026` | « Identifiants d'opérateur invalides. » |
| `operateur.inconnu@exemple.test`, mot de passe quelconque | le même message « Identifiants d'opérateur invalides. » (aucune indication sur l'existence du compte) |
| `direction.generale@secondaire-test.test` (compte d'établissement), mot de passe quelconque | « Identifiants d'opérateur invalides. » : un compte d'établissement n'ouvre pas la console |
| `pas-un-email`, mot de passe quelconque | « Identifiants d'opérateur invalides. » (l'API refuse le format ; à vérifier en test) |

Note : la route d'API de connexion de l'opérateur (`apps/api/src/routes/super-admin-auth.ts`) ne limite pas les tentatives ; aucun message « Trop de tentatives » n'est attendu ici (à vérifier en test). Le jeton d'opérateur est valable 24 heures.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour un compte d'établissement

#### 1.2 Garde de la console et redirections
Compte : opérateur, puis propriétaire du Collège · Où : barre d'adresse · Prérequis : 1.1
1. Dans une fenêtre privée neuve, **sans** se connecter, ouvrir successivement `/v2/platform/tenants`, `/v2/platform/tenants/new`, `/v2/platform/plans`, `/v2/platform/audit`, `/v2/platform`.
2. Se connecter en opérateur, puis ouvrir `/v2/platform` : redirection vers `/v2/platform/tenants`.
3. Fenêtre A, connecté en **propriétaire du Collège** (panneau de `/v2/login`) : ouvrir `/v2/platform/tenants`.
4. Fenêtre B, connecté en opérateur uniquement : ouvrir `/v2/settings`, `/v2/home`, `/v2/students`.
Résultat attendu : étape 1 et étape 3 : redirection vers `/v2/platform/login`, aucune donnée affichée (un instant de chargement est normal). Étape 4 : redirection vers `/login` (la console ne donne aucune session d'établissement). La console n'affiche jamais d'élève, de note ni de facture.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le propriétaire d'établissement

#### 1.3 Liste des organisations
Compte : opérateur · Où : « Organisations » (`/v2/platform/tenants`) · Prérequis : 1.1
1. Ouvrir « Organisations ». Titre « Organisations », bouton « Nouvelle organisation », formulaire de recherche.
2. Lire le tableau (légende « Organisations ») : colonnes « Nom », « Identifiant », « Statut », « Créée le ». Les trois organisations de départ sont « Active ».
3. Saisir `Baobab` dans « Rechercher » (aide « Par nom ou identifiant. »), cliquer « Filtrer » : une seule ligne.
4. Saisir `primaire-test` (identifiant) : une seule ligne.
5. Saisir `zzz-introuvable` : la liste est remplacée par « Aucune organisation ne correspond. ».
6. Vider la recherche, choisir « Suspendue » dans « Statut » puis « Filtrer » : « Aucune organisation ne correspond. » (tant que rien n'est suspendu). Choisir « Tous les statuts ».
7. Lire le compteur sous le tableau, de la forme « 1 à 3 sur 3 » (plus si des organisations jetables existent déjà) ; « Précédent » est inactif sur la première page ; « Suivant » est inactif quand tout tient sur une page (25 par page).
Résultat attendu : liste cohérente avec l'annexe ; lien « Ouvrir l'organisation Collège Le Baobab (démonstration) » ouvre la fiche (1.6). Sans aucune organisation (cas non rencontré ici), le texte serait « Aucune organisation pour le moment. Provisionnez la première. ».
- [ ] Cas nominal  - [ ] Cas invalide (recherche sans résultat)  - [ ] Droit refusé (1.2)

#### 1.4 Créer l'organisation jetable A
Compte : opérateur · Où : « Organisations » > « Nouvelle organisation » (`/v2/platform/tenants/new`) · Prérequis : 1.3
1. Cliquer « Nouvelle organisation ». Retour possible par « Retour aux organisations ». Titre « Nouvelle organisation ».
2. Remplir le formulaire (taper d'abord le nom : l'identifiant se remplit tout seul, puis le remplacer) :

   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Nom de l'organisation | École jetable test guide | oui |
   | Identifiant (slug) | `tg-jetable` (aide : « 2 à 50 caractères : minuscules, chiffres et tirets. Ne pourra pas être modifié. ») | oui |
   | Pays (code ISO) | `CI` | oui (déjà rempli) |
   | Packs | cocher « Secondaire » (aide : « Un établissement est créé par pack. ») | au moins un |
   | Nom complet (propriétaire) | KONÉ Mariam test guide | oui |
   | Adresse e-mail (propriétaire) | `proprietaire.tgjetable@exemple.test` | oui |
   | Téléphone | +225 07 08 09 10 11 | non |
   | Offre d'essai | laisser « Offre par défaut du serveur » | non |
   | Durée (jours) | 30 | non (aide : « 1 à 365. Vide : durée par défaut du serveur. ») |

3. Cliquer « Provisionner l'organisation » (le bouton affiche « Provisionnement… »).
4. Sur l'écran de réussite, cliquer « Ouvrir l'organisation ».
Résultat attendu : écran « Organisation créée » avec le texte "… est prête. Une invitation a été envoyée à proprietaire.tgjetable@exemple.test." (l'identifiant entre guillemets français en début de phrase) et "1 établissement créé" ; boutons « Ouvrir l'organisation » et « Provisionner une autre organisation » (ce dernier remet le formulaire à vide). La fiche s'ouvre : badge « Active », sous-titre « Identifiant : tg-jetable · Créée le `<date du jour>` », Vue d'ensemble avec la raison sociale, le pays CI, le contact "KONÉ Mariam test guide · proprietaire.tgjetable@exemple.test · +225 07 08 09 10 11" et **un** établissement (pack « Secondaire », statut « Actif » ; le nom de l'établissement vient du modèle de pack : à relever). Section « Abonnement » : offre d'essai du serveur ("Professionnel" dans cet environnement d'après `ENTITLEMENTS_TRIAL_PLAN` de `.dev-v2/env.local` ; "Starter" si l'API a été lancée sans cette variable), statut « Période d'essai », fin = aujourd'hui + 30 jours. Retour à la liste : l'organisation y figure (4 lignes). **Aucun courrier n'est réellement envoyé** : le texte "Une invitation a été envoyée" est inexact dans cet environnement (voir Écarts).
- [ ] Cas nominal  - [ ] Cas invalide (1.5)  - [ ] Droit refusé (1.2)

#### 1.5 Création d'organisation : saisies invalides
Compte : opérateur · Où : `/v2/platform/tenants/new` · Prérequis : 1.4 (l'identifiant `tg-jetable` existe déjà)
Remplir le formulaire comme en 1.4, en changeant **uniquement** le champ indiqué, puis « Provisionner l'organisation ». Dans tous les cas, **aucune organisation n'est créée** (vérifier la liste).

| Saisie | Message attendu |
|---|---|
| Aucun pack coché | « Choisissez au moins un pack. » |
| Identifiant `TG Jetable` (espace) | "Slug de 2 à 50 caractères : minuscules, chiffres et tirets." (les majuscules sont converties en minuscules à la frappe, l'espace reste) |
| Identifiant `a` | le même message |
| Pays `12` | "Code pays ISO 3166-1 alpha-2 attendu (ex. CI)." |
| Téléphone `abc` | "Numéro de téléphone invalide." |
| Nom de l'organisation vide, ou nom du propriétaire vide | message de Zod par défaut (probablement en anglais, du type "String must contain at least 2 character(s)") : à relever en test, voir Écarts |
| Adresse e-mail `pas-un-email` | message de Zod par défaut (probablement "Invalid email") : à relever |
| Durée `0` ou `400` | message de Zod par défaut sur la borne 1 à 365 : à relever |
| Identifiant `secondaire-test` (valide mais déjà pris), nom "École doublon test guide", e-mail `proprietaire.doublon@exemple.test` | message du serveur qui se termine par "est déjà utilisé." (l'identifiant y figure entre guillemets français) ; rien n'est créé |
| Identifiant `admin` (réservé) | message du serveur qui se termine par "est réservé." ; rien n'est créé |

- [ ] Cas nominal (1.4)  - [ ] Cas invalide  - [ ] Droit refusé (1.2)

#### 1.6 Fiche d'une organisation : lecture
Compte : opérateur · Où : « Organisations » > ouvrir une organisation (`/v2/platform/tenants/<identifiant>`) · Prérequis : 1.3
1. Ouvrir « Collège Le Baobab (démonstration) ». Sous-titre « Identifiant : secondaire-test · Créée le … », badge « Active ».
2. Section « Vue d'ensemble » : « Raison sociale », « Pays », « Contact », « Établissements » (nom, pack, statut).
3. Section « Abonnement » : « Offre » (choix "Professionnel"), « Statut » (« Actif »), « Début », « Fin », « Tranche d'apprenants (plafond) » (vide), « Packs » (seul « Secondaire » est coché).
4. Section « Dérogations de fonctionnalités » : « Aucune dérogation. » ; section « Droits effectifs et usage » : « Offre » (la clé technique PROFESSIONAL est affichée telle quelle), « État » (« Abonnement actif. »), "N fonctionnalités accordées", puis « Usage mesuré » (tableau « Indicateur », « Période », « Valeur » ou « Aucun usage mesuré. »).
5. Répéter pour l'École primaire (pack « Primaire ») et l'Université (pack « Supérieur ») : même offre, **le nombre de fonctionnalités diffère** selon le pack.
6. Ne rien modifier sur ces trois fiches.
7. Ouvrir `/v2/platform/tenants/11111111-1111-4111-8111-111111111111` (identifiant bien formé mais inexistant) puis `/v2/platform/tenants/abc`.
Résultat attendu : étapes 1 à 5 conformes ; étape 7 : pour l'identifiant inexistant, « Cette organisation n'existe pas. » ; pour `abc`, une zone d'erreur avec un bouton « Réessayer » (message exact à relever en test). Aucune donnée interne de l'établissement (élèves, notes, factures) n'apparaît.
- [ ] Cas nominal  - [ ] Cas invalide (identifiant inconnu)  - [ ] Droit refusé (1.2)

#### 1.7 Statut d'une organisation : suspendre, réactiver
Compte : opérateur · Où : fiche de l'organisation A (`/v2/platform/tenants/<identifiant>`), section « Statut » · Prérequis : 1.4
1. Lire la section : texte « Une organisation suspendue ou archivée perd l'accès aux fonctionnalités payantes (seul le socle reste disponible). » et les boutons « Suspendre » et « Archiver ».
2. Cliquer « Suspendre » : fenêtre « Suspendre l'organisation ? » avec le texte "L'organisation … passera au statut …" (nom et statut entre guillemets français, statut "Suspendue") et le champ « Motif » (aide « 3 caractères minimum. Conservé dans le journal de plateforme. »).
3. Cas invalides, tableau ci-dessous.
4. Saisir le motif `Suspension d'essai test guide` puis confirmer (bouton « Suspendre »).
5. Descendre à « Droits effectifs et usage » : le champ « État » indique que seules les fonctionnalités de base sont accordées et le nombre de fonctionnalités tombe au socle.
6. Revenir à la liste, filtrer sur « Suspendue » : l'organisation A y figure.
7. Cliquer « Réactiver » (le motif est facultatif ici) et confirmer.
Résultat attendu : message « Statut mis à jour. », badge « Suspendue » (boutons « Réactiver » et « Archiver ») puis, après l'étape 7, badge « Active » (boutons « Suspendre » et « Archiver »). Les deux changements sont tracés au scénario 1.11. **Ne pas archiver maintenant** : l'archivage est fait à la fin (section Nettoyage).
Cas invalides :

| Saisie | Message attendu |
|---|---|
| Motif vide, confirmer | « Indiquez un motif de 3 caractères au moins. » ; la fenêtre reste ouverte |
| Motif `ab` | le même message |
| Clic sur « Annuler » | la fenêtre se ferme, le statut ne change pas |

- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (1.2)

#### 1.8 Abonnement d'une organisation
Compte : opérateur · Où : fiche de l'organisation A, section « Abonnement » · Prérequis : 1.4
1. Passer le « Statut » à « Actif », saisir `250` dans « Tranche d'apprenants (plafond) », cliquer « Enregistrer l'abonnement ».
2. Recharger la page : les valeurs sont conservées.
3. Choisir l'offre "Starter" et enregistrer. Dans « Droits effectifs et usage », relever le nombre de fonctionnalités (il doit changer par rapport à "Professionnel" ; valeur exacte à relever). Remettre l'offre précédente et enregistrer.
4. Cas invalides, tableau ci-dessous.
Résultat attendu : message « Abonnement enregistré. » à chaque enregistrement valide ; le journal de plateforme trace chaque changement (1.11).
Cas invalides :

| Saisie | Message attendu |
|---|---|
| Offre « Choisir une offre » (vide), enregistrer | « Choisissez une offre. » |
| « Fin » antérieure à « Début » | « La fin doit suivre le début. » |
| « Tranche d'apprenants (plafond) » = `-5` ou `0` | « Entier positif attendu. » |
| Aucun pack coché | message du serveur ou de Zod à relever en test (l'écran n'impose pas de pack) |

- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (1.2)

#### 1.9 Dérogations de fonctionnalités et réconciliation
Compte : opérateur · Où : fiche de l'organisation A, sections « Dérogations de fonctionnalités », « Droits effectifs et usage » et « Réconcilier » · Prérequis : 1.4
1. Relever dans « Droits effectifs et usage » le nombre de fonctionnalités accordées (N).
2. Dans « Ajouter une dérogation », remplir :

   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Fonctionnalité | « Choisir une fonctionnalité » puis "Vie scolaire : incidents, mesures, observations (schoollife.core)" | oui |
   | Effet | « Retirer » | oui (par défaut « Accorder ») |
   | Motif | Essai du menu hors plan (test guide) (aide « 5 caractères minimum. ») | oui |
   | Expire le | laisser vide (aide « Facultatif. ») | non |

3. Cliquer « Enregistrer la dérogation ».
4. Constater la ligne dans le tableau « Dérogations » (colonnes « Fonctionnalité », « Effet », « Motif », « Expire le »), l'effet « Retirer » et l'expiration « Jamais ». Dans « Droits effectifs et usage », le nombre devient N − 1.
5. Cliquer l'icône corbeille (nom accessible « Supprimer la dérogation de … ») : fenêtre « Supprimer cette dérogation ? » avec "La fonctionnalité … reviendra au droit défini par l'offre.", confirmer par « Confirmer ».
6. Dans « Réconcilier » (texte "Reprise idempotente : recrée les rôles système et l'abonnement manquants…"), cliquer « Lancer la réconciliation ».
Résultat attendu : messages « Dérogation enregistrée. » puis « Dérogation supprimée. » ; le nombre de fonctionnalités revient à N ; réconciliation : « Réconciliation terminée : 0 rôle(s) créé(s), abonnement inchangé. » (les rôles et l'abonnement existent déjà). Une deuxième dérogation sur la même fonctionnalité remplace la première (une seule par fonctionnalité et par organisation).
Cas invalides :

| Saisie | Message attendu |
|---|---|
| Aucune fonctionnalité choisie, enregistrer | « Choisissez une fonctionnalité. » |
| Motif `abcd` (4 caractères) | message de Zod par défaut sur la longueur minimale 5 (probablement en anglais) : à relever, voir Écarts |
| Motif vide | le même type de message |

- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (1.2)

#### 1.10 Plans et catalogue
Compte : opérateur · Où : « Plans et catalogue » (`/v2/platform/plans`) · Prérequis : 1.1
1. Lire la page : titre « Plans et catalogue », trois blocs « Plans » (cartes Starter, Professionnel, Entreprise avec leur clé, le badge « Actif », "N fonctionnalités · Ordre : 10/20/30"), « Packs » (tableau « Clé », « Libellé », « Actif » : PRIMARY, SECONDARY, HIGHER, VIRTUAL) et « Fonctionnalités » (tableau « Clé », « Libellé », « Module », « Packs » ; badge « Retirée » pour une fonctionnalité sortie du catalogue).
2. **Ne modifier aucun des trois plans de départ** : une modification s'applique à toutes les organisations concernées (les trois établissements de départ comprises).
3. Cliquer « Nouveau plan » et remplir :

   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Clé | `TG_PLAN_TEST` (aide "Majuscules, chiffres et _ (ex. PROFESSIONAL). Non modifiable.") | oui |
   | Libellé | Plan test guide | oui |
   | Description | Plan de démonstration du guide, ne pas vendre | non |
   | Ordre d'affichage | 900 | non |
   | Plan actif (proposé à la vente) | **décocher** | non |

4. Cliquer « Enregistrer » : message « Plan enregistré. », carte "Plan test guide" avec le badge « Inactif ».
5. Icône crayon (« Modifier le plan Plan test guide ») : la clé est en lecture seule ; changer le libellé en `Plan test guide modifié`, « Enregistrer ».
6. Icône liste (« Fonctionnalités du plan Plan test guide ») : fenêtre « Fonctionnalités du plan », champ « Rechercher une fonctionnalité » ; saisir `audit`, cocher la fonctionnalité du module `audit`, puis une seconde ; le compteur indique "2 sélectionnées" ; « Enregistrer les fonctionnalités » → « Fonctionnalités du plan enregistrées. » ; la carte indique "2 fonctionnalités".
7. Sur la fiche de l'organisation A (1.8), le plan "Plan test guide modifié (inactif)" est proposé dans « Offre » : l'enregistrer, constater que « Droits effectifs et usage » compte les fonctionnalités du socle et du pack plus celles du plan, puis remettre l'offre d'origine.
Résultat attendu : étapes conformes ; le plan de test ne peut pas être supprimé (aucune suppression dans l'écran) : il reste, inactif.
Cas invalides :

| Saisie | Message attendu |
|---|---|
| Clé `1PLAN` | "Clé en majuscules (ex. PROFESSIONAL)." |
| Clé vide | le même message |
| Libellé vide ou `A` | message de Zod par défaut (longueur minimale 2) : à relever |
| **Ne jamais saisir une clé existante** (`STARTER`, `PROFESSIONAL`, `ENTERPRISE`) | (le contrat remplace silencieusement le plan existant, voir Écarts) |

- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (1.2)

#### 1.11 Journal de plateforme
Compte : opérateur · Où : « Journal de plateforme » (`/v2/platform/audit`) · Prérequis : 1.4 à 1.10
1. Ouvrir la page : titre « Journal de plateforme », texte « Actions des opérateurs : provisionnement, statuts, plans, abonnements et dérogations. ».
2. Lire le tableau « Entrées du journal de plateforme » (colonnes « Date », « Gravité », « Action », « Entité », « Acteur »), la plus récente en premier.
3. Retrouver vos actes : `platform.tenant.provisioned` (organisation A), `platform.tenant.status_changed` (suspension puis réactivation), `platform.subscription.set`, `platform.override.set`, `platform.override.removed`, `platform.tenant.reconciled`, `platform.plan.upserted`, `platform.plan.features_set`. Les trois organisations de départ ont aussi leur `platform.tenant.provisioned`.
4. Si une page de résultats est pleine, « Charger plus d'entrées » charge la suite.
Résultat attendu : chaque acte est présent, avec l'acteur « Opérateur plateforme », l'identifiant de l'organisation sous l'entité et une gravité (« Notable » par défaut). Aucune entrée n'est modifiable ni supprimable (aucun bouton). Sur un serveur dont l'API n'expose pas la lecture : titre « Le journal de plateforme n'est pas disponible sur ce serveur » (cas non attendu ici). Journal vide : « Aucune entrée dans le journal de plateforme. ».
- [ ] Cas nominal  - [ ] Cas invalide (journal indisponible : non attendu)  - [ ] Droit refusé (1.2)

---

## Partie B. Administration de l'établissement par le propriétaire

#### 1.12 Accueil de gestion et page d'arrivée
Compte : propriétaire du Collège, puis secrétariat, enseignant et propriétaire de l'Université · Où : `/v2/home` et `/v2` · Prérequis : connexion par le panneau de `/v2/login`
1. Connecté en propriétaire du Collège, ouvrir `/v2/home`. Le titre est "Accueil · Collège Le Baobab…" (nom commercial ou raison sociale), avec le texte « Raccourcis vers les modules auxquels votre rôle donne accès. » et une carte par module (par exemple « Pilotage », « Académique », « Finance », « Utilisateurs », « Accès et rôles », « Établissement », « Journal d'audit »). Le titre de chaque carte est un lien ; sous le titre, jusqu'à 8 liens d'écrans.
2. Les cartes propres au pack : « Vie scolaire », « Conseils de classe » et « Affectés de l'État » existent au Collège (pack Secondaire) ; « Pack Primaire » n'y est pas ; « Enseignement supérieur » n'y est pas.
3. Ouvrir `/v2` : redirection vers l'écran d'arrivée du rôle (`/v2/direction` pour le propriétaire).
4. Se déconnecter, se connecter en secrétariat, ouvrir `/v2` : arrivée sur `/v2/students` ; `/v2/home` montre moins de modules (aucune carte « Accès et rôles » ni « Journal d'audit »).
5. Se connecter en enseignant, ouvrir `/v2/home` : la page affiche la liste plate du portail enseignant (carte « Accueil »).
6. Ouvrir `/v2/home` sans être connecté : redirection vers `/login`.
Résultat attendu : chaque carte ne propose que des écrans autorisés pour le rôle (aucun lien mort vers un écran refusé) ; sans module accessible, le texte serait « Aucun module n'est accessible avec votre rôle. Contactez la direction de l'établissement. ». Pendant le chargement : « Chargement des modules… ».
- [ ] Cas nominal  - [ ] Cas invalide (non connecté)  - [ ] Droit refusé pour un rôle sans module

#### 1.13 Profil et marque
Compte : propriétaire du Collège (écriture), secrétariat (lecture) · Où : menu « Établissement » (`/v2/settings`) · Prérequis : relever les valeurs initiales de « Nom commercial », « Couleur principale », « Couleur secondaire » (elles sont probablement vides)
1. Ouvrir « Établissement ». La barre « Sections de l'établissement » propose « Profil et marque », « Établissements et campus », « Mise en service », « Abonnement et usage ». Titre « Profil et marque », texte « Informations légales, contact et identité visuelle de votre organisation. ».
2. Repérer les blocs « Identité » (« Raison sociale », « Nom commercial », « Pays »), « Contact » (« Personne à contacter », « E-mail », « Téléphone », « Adresse »), « Marque » (« Adresse du logo », « Couleur principale », « Couleur secondaire », « Domaine personnalisé ») et « Aperçu » (« Exemple de bouton »). Tant que rien n'est modifié : « Aucune modification à enregistrer. » et les deux boutons sont inactifs.
3. Saisir :

   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Nom commercial | Collège Le Baobab test guide (aide « Affiché dans l'application ; la raison sociale est utilisée sinon. ») | non |
   | Couleur principale | `#1A73E8` (aide « Format #RRGGBB (ex. #1A73E8). ») | non |
   | Couleur secondaire | `#059669` | non |

4. Observer l'« Aperçu » : le bandeau prend la couleur principale et le nom commercial ; « Exemple de bouton » prend la couleur secondaire.
5. Cliquer « Enregistrer le profil » (« Enregistrement… » pendant l'envoi). Recharger : les valeurs sont conservées et l'en-tête de l'application affiche le nom commercial.
6. Modifier « Nom commercial » en `essai`, cliquer « Annuler les modifications » : la valeur précédente revient.
7. **Rétablir** : vider « Nom commercial », « Couleur principale », « Couleur secondaire » (ou remettre les valeurs relevées), « Enregistrer le profil ».
8. Se connecter en secrétariat, ouvrir `/v2/settings`.
Résultat attendu : étape 5 : message « Profil enregistré. » ; étape 8 : bandeau « Vous pouvez consulter ces informations mais pas les modifier. », champs en lecture seule, aucun bouton « Enregistrer le profil ». Ne **pas** renseigner « Domaine personnalisé » ni enregistrer de contact : ces champs concernent une adresse réelle. Le téléversement d'un logo n'existe pas : seul un lien https est possible.
Cas invalides (aucun ne doit être enregistré) :

| Saisie | Message attendu |
|---|---|
| « Raison sociale » vidée, enregistrer | « La raison sociale est obligatoire. » |
| « Téléphone » = `abc` | "Numéro de téléphone invalide." |
| « Couleur principale » = `bleu` | "Couleur hexadécimale attendue (ex. #1A73E8)." |
| « Domaine personnalisé » = `Ecole Test` | "Nom de domaine en minuscules attendu (ex. ecole.example.org)." |
| « E-mail » = `pas-un-email` | message de Zod par défaut (probablement "Invalid email") : à relever |
| « Adresse du logo » = `logo.png` | message de Zod par défaut (adresse invalide) : à relever |
| « Raison sociale » = `A` | message de Zod par défaut (longueur minimale 2) : à relever |

Après les cas invalides, cliquer « Annuler les modifications ».
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'enseignant (1.24)

#### 1.14 Établissements et campus
Compte : propriétaire du Collège (écriture), secrétariat (lecture) · Où : « Établissement » > « Établissements et campus » (`/v2/settings/institutions`) · Prérequis : 1.13
1. Ouvrir la page. Liste « Établissements » : chaque établissement affiche son nom, les badges de pack et de statut (« Secondaire », « Actif ») et une ligne « Code : … · Pays : … · Système éducatif : … ». Le bouton « Nouvel établissement » est visible au propriétaire : **ne pas l'utiliser ici** (un établissement ne se supprime pas ; voir 1.20 dans l'établissement jetable).
2. Cliquer « Campus » (nom accessible "Voir les campus de …"). Le tableau (légende « Campus de … ») liste un campus avec le badge « Par défaut ».
3. Cliquer « Nouveau campus » et remplir :

   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Nom du campus | Campus annexe test guide | oui |
   | Code | `tg-annexe` (aide « Facultatif : dérivé du nom si vide. ») | non |
   | Adresse | Rue des Jardins, Cocody, Abidjan | non |
   | Ville | Abidjan | non |
   | Téléphone | +225 27 22 44 55 66 | non |

4. Cliquer « Enregistrer » : le campus apparaît dans le tableau.
5. Définir le nouveau campus par défaut (icône étoile, nom accessible « Définir Campus annexe test guide comme campus par défaut »), puis **rétablir** l'ancien en cliquant son étoile.
6. Modifier le campus (crayon « Modifier le campus Campus annexe test guide ») : « Ville » = `Yopougon`, « Enregistrer ».
7. Tenter de supprimer le campus **par défaut** (corbeille « Supprimer le campus … ») : fenêtre « Supprimer ce campus ? » avec le texte "… Le campus par défaut ne peut pas être supprimé : désignez-en d'abord un autre.", confirmer par « Confirmer ».
8. Supprimer le campus de test (non par défaut) et confirmer.
9. Se connecter en secrétariat : la page s'ouvre, bandeau « Vous pouvez consulter ces informations mais pas les modifier. », aucun bouton de création, de modification ni de suppression.
Résultat attendu : messages "Campus … créé." (nom entre guillemets français), « Campus par défaut modifié. », « Campus mis à jour. », « Campus supprimé. » ; à l'étape 7 le serveur refuse (message à relever en test) et le campus par défaut reste en place.
Cas invalides :

| Saisie | Message attendu |
|---|---|
| « Nom du campus » vide ou `A`, « Enregistrer » | message de Zod par défaut (longueur minimale 2) : à relever |
| « Code » = `TG ANNEXE` | "Code en minuscules, chiffres et tirets (31 caractères max)." |
| « Téléphone » = `12` | "Numéro de téléphone invalide." |
| « Code » = `tg-annexe` alors qu'un campus de cet établissement l'utilise déjà | refus du serveur (conflit de code), message à relever |

- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'enseignant (1.24)

#### 1.15 Mise en service : lecture
Compte : propriétaire du Collège, puis secrétariat · Où : « Établissement » > « Mise en service » (`/v2/settings/onboarding`) · Prérequis : aucun
1. Ouvrir la page. Bloc de progression : « Mise en service en cours » (ou « Établissement en production »), barre « Progression de la mise en service », texte « Progression : N étape(s) sur 11 », "Prochaine étape : …".
2. Lire la liste « Étapes de la mise en service » : Compte propriétaire, Établissement, Pays et devise, Type d'établissement, Pack, Année académique, Import des élèves, Classes, Enseignants, Finance, Mise en production. Chaque étape porte un statut (« À faire », « Terminée », « Ignorée »), une mention « Obligatoire » ou « Facultative » et, si elle est terminée, « Terminée le `<date>` ». Une étape non disponible affiche « Disponible une fois les étapes précédentes résolues. ».
3. **Ne cliquer ni « Marquer comme terminée », ni « Ignorer », ni « Passer en production »** : ces actions sont définitives sur ces établissements (voir 1.21 dans l'établissement jetable). Noter l'état relevé.
4. Se connecter en secrétariat : la liste est identique mais **sans aucun bouton**.
Résultat attendu : progression et statuts cohérents entre eux ; au minimum les étapes de provisionnement (Compte propriétaire à Pack) sont « Terminée ». L'état des étapes Année académique, Classes et suivantes dépend de la graine : à relever.
- [ ] Cas nominal  - [ ] Cas invalide (non applicable)  - [ ] Droit refusé (lecture seule du secrétariat)

#### 1.16 Abonnement et usage, et modules selon l'offre
Compte : propriétaire du Collège, puis de l'Université et de l'École · Où : « Établissement » > « Abonnement et usage » (`/v2/settings/subscription`), menu « Modules », `/v2/academic/offerings` · Prérequis : aucun
1. Au Collège, ouvrir « Abonnement et usage » : texte « Votre offre, les packs actifs et la consommation mesurée. Les changements d'offre sont gérés par l'équipe EcoleDigitale. ». Lire « Offre » (la clé PROFESSIONAL est affichée telle quelle), « Statut de l'abonnement » (« Actif »), « Packs » (« Secondaire »), « Tranche d'apprenants » (« Illimitée »), éventuellement « Prochain changement automatique ».
2. « Fonctionnalités actives » : le total, puis un bloc dépliable par module (`academic`, `admissions`…) listant les clés de fonctionnalités et leur origine (« Socle », « Offre », « Pack », « Dérogation »). **Aucun bouton de modification** de l'abonnement n'existe côté établissement.
3. « Usage mesuré » : tableau « Compteurs d'usage » (« Apprenants actifs », « Stockage », « SMS envoyés ») ou « Aucun usage mesuré pour le moment. ».
4. **Comparaison entre établissements** (les trois propriétaires, un par navigateur ou à la suite) :
   - dans le bloc `academic` des fonctionnalités actives, `academic.a-la-carte` n'existe qu'à l'Université ; `academic.state-assigned` n'existe qu'au Collège ;
   - dans le menu « Modules » (en haut), au Collège : « Vie scolaire », « Conseils de classe », « Affectés de l'État » ; à l'École : « Pack Primaire » ; à l'Université : « Enseignement supérieur ». Chacun n'a que le sien ;
   - dans le module « Académique », l'entrée de menu « Offres de cours » n'apparaît **qu'à l'Université**.
5. Ouvrir `/v2/academic/offerings` directement au Collège (même si l'entrée de menu n'existe pas).
6. Se connecter en secrétariat et ouvrir `/v2/settings/subscription`.
Résultat attendu : étape 5 : l'écran « Offres de cours » s'ouvre avec l'avis « L'inscription à la carte n'est pas incluse dans l'offre de l'établissement. » et ne permet aucune action ; à l'Université le même écran n'affiche pas cet avis. Étape 6 : la page s'ouvre mais les données sont refusées ("Action non autorisée.").
- [ ] Cas nominal  - [ ] Cas invalide (module hors offre)  - [ ] Droit refusé pour le secrétariat

#### 1.17 Rôles et permissions : lecture et clonage
Compte : propriétaire du Collège, puis directeur · Où : menu « Accès et rôles » > « Rôles et permissions » (`/v2/access/roles`, `/v2/access`) · Prérequis : aucun
1. Ouvrir `/v2/access` : redirection vers `/v2/access/roles`. Titre « Rôles et permissions » ; tableau (légende « Rôles de l'établissement ») : colonnes « Rôle », « Type », « Permissions », « Attributions » ; 14 lignes de type « Système (verrouillé) » ; boutons « Nouveau rôle » et « Cloner » (propriétaire seulement).
2. Ouvrir « Secrétariat » (nom accessible « Ouvrir le rôle Secrétariat »). Page : « Clé : secretariat », badge « Système (verrouillé) », "Attribué 1 fois" (ou plus), bandeau « Rôle système verrouillé » / « Ce rôle ne peut pas être modifié ni supprimé. Clonez-le pour créer une variante. », champs en lecture seule, grille « Permissions du rôle » (recherche « Rechercher une permission », décompte "N permissions sélectionnées", groupes « x sur y »). Aucun bouton « Enregistrer les modifications » ni « Supprimer le rôle ».
3. Retour à la liste, cliquer « Cloner » sur la ligne « Secrétariat ». Fenêtre « Cloner le rôle » :

   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Libellé du nouveau rôle | Secrétariat test guide | oui |
   | Clé technique | `tg_secretariat` (aide "Facultative : dérivée du libellé si vide…") | non |
   | Description | Copie de test du guide | non |

4. Cliquer « Créer le clone ».
5. Se connecter en directeur et ouvrir `/v2/access/roles`.
Résultat attendu : message "Rôle … créé." (nom entre guillemets français), ouverture automatique du nouveau rôle : type « Personnalisé », même nombre de permissions que « Secrétariat », texte « Ce rôle est un clone d'un autre rôle. », boutons « Cloner » et « Supprimer le rôle ». Dans la liste, 15 lignes. Pour le directeur : la liste est lisible mais **sans** « Nouveau rôle» ni « Cloner » (la définition des rôles est réservée au propriétaire).
Cas invalides :

| Saisie | Message attendu |
|---|---|
| « Libellé du nouveau rôle » vide, « Créer le clone » | « obligatoire » sous le champ |
| « Clé technique » = `TG-Secretariat` | refus du serveur : message qui commence par "La clé doit être en minuscules" ; rien n'est créé |
| « Clé technique » = `tg_secretariat` une seconde fois | « Un rôle utilise déjà cette clé. Choisissez-en une autre. » |
| « Clé technique » = `owner` (clé d'un modèle système) | refus du serveur, message qui se termine par "réservée à un modèle système." |

- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le directeur (pas de clonage)

#### 1.18 Créer, modifier et supprimer un rôle personnalisé
Compte : propriétaire du Collège · Où : « Rôles et permissions » > « Nouveau rôle » (`/v2/access/roles/new`), puis fiche du rôle (`/v2/access/roles/<identifiant>`) · Prérequis : 1.17
1. Cliquer « Nouveau rôle ». Titre « Nouveau rôle », texte « Choisissez les permissions du rôle. Vous ne pouvez accorder que des permissions que vous détenez vous-même. ».
2. Remplir :

   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Libellé | Lecteur test guide | oui |
   | Clé technique | `tg_lecteur` (aide « Facultative : dérivée du libellé si vide. ») | non |
   | Description | Lecture du journal d'audit (test guide) | non |

3. Dans la grille « Permissions du rôle », saisir `journal` dans « Rechercher une permission » et cocher "Consulter le journal d'audit". Constater que "Exporter le journal d'audit" porte l'étiquette « Sensible · MFA » : **ne pas la cocher**. Le décompte indique "1 permission sélectionnée".
4. Cliquer « Créer le rôle » (« Création… »).
5. Sur la fiche : cocher en plus "Consulter les utilisateurs" ; le texte "1 permission ajoutée" apparaît ; cliquer « Enregistrer les modifications ». Puis décocher cette permission : "1 permission retirée" ; « Annuler les modifications » remet l'état enregistré.
6. Changer le « Libellé » en `Lecteur test guide v2`, « Enregistrer les modifications ».
7. **Ne pas supprimer maintenant** : le rôle sert au scénario 1.19 ; la suppression est testée à la fin de 1.19.
Résultat attendu : message "Rôle … créé.", arrivée sur la fiche (type « Personnalisé », « Clé : tg_lecteur », "Non attribué") ; « Rôle enregistré. » à chaque enregistrement. Le rôle apparaît dans la liste avec le type « Personnalisé » et le bon nombre de permissions. Une entrée `role.changed` apparaît dans le journal (1.23).
Cas invalides :

| Saisie | Message attendu |
|---|---|
| « Libellé » vide | « Le libellé est obligatoire. » |
| « Clé technique » = `Lecteur Test` | message sur les minuscules, chiffres et tiret bas (2 à 63 caractères, commence par une lettre), texte exact dans `access.form.keyInvalid` de `fr-CI.json` |
| « Clé technique » = `tg_lecteur` alors qu'elle existe | « Un rôle utilise déjà cette clé. Choisissez-en une autre. » |
| Recherche `zzz` dans « Rechercher une permission » | « Aucune permission ne correspond à cette recherche. » |
| Ouvrir `/v2/access/roles/11111111-1111-4111-8111-111111111111` | « Ce rôle n'existe pas dans votre établissement. » |

Droit refusé : le directeur ne voit aucun bouton « Nouveau rôle » ; s'il tape `/v2/access/roles/new`, la page s'ouvre (la garde ne vérifie que la lecture) mais l'enregistrement est refusé par le serveur : comportement à relever (Écarts).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le directeur

#### 1.19 Attributions de rôles
Compte : propriétaire du Collège, puis directeur · Où : « Accès et rôles » > « Attributions de rôles » (`/v2/access/assignments`) · Prérequis : 1.18
1. Ouvrir la page. Bloc « Nouvelle attribution » (« Utilisateur » avec « Choisir un utilisateur », « Rôle » avec « Choisir un rôle », « Périmètre », « Valide à partir du », « Valide jusqu'au », rappel "Anti-escalade…") et tableau « Attributions de rôles » (« Utilisateur », « Rôle », « Périmètre », « Validité », « Statut ») avec les filtres « Filtrer par utilisateur » et « Filtrer par rôle » (valeur « Tous »).
2. Filtrer le rôle sur « Propriétaire » : la ligne du compte `direction.generale@secondaire-test.test` porte le périmètre « Tout l'établissement », la validité « Sans limite » et le statut « Active ». Remettre « Tous ».
3. Remplir « Nouvelle attribution » :

   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Utilisateur | `educateur@secondaire-test.test` | oui |
   | Rôle | Lecteur test guide v2 (ou le libellé actuel) | oui |
   | Périmètre | « Tout l'établissement » | oui |
   | Valide à partir du / Valide jusqu'au | laisser vides (aide « Facultatif. Sans date, l'attribution est immédiate et sans limite. ») | non |

4. Cliquer « Attribuer le rôle ». La ligne apparaît (statut « Active »).
5. Fenêtre B ou C : se connecter en **éducateur**, ouvrir `/v2/audit` : la page s'ouvre (droit "Consulter le journal d'audit"), le bouton « Exporter en CSV » est inactif avec le texte "L'export est réservé aux profils disposant de la permission …". Si la page est encore refusée, se déconnecter, se reconnecter et réessayer (cache de droits, à vérifier en test).
6. Retour au propriétaire : crayon « Modifier la validité de l'attribution de Lecteur test guide v2 » : fenêtre « Modifier la validité » (« Rôle … — laissez vide pour retirer la limite. »), saisir « Valide jusqu'au » = demain, « Enregistrer » → « Validité mise à jour. », la validité devient "jusqu'au `<date>`". Refaire avec une date passée : statut « Expirée » (à vérifier en test). Puis vider la date.
7. Tenter de supprimer le rôle (fiche du rôle, « Supprimer le rôle ») alors qu'il est attribué.
8. Révoquer : icône « Révoquer l'attribution de Lecteur test guide v2 », fenêtre « Révoquer cette attribution ? » ("L'utilisateur perdra les droits du rôle … Le dernier propriétaire ne peut jamais être révoqué."), bouton « Révoquer ». Puis supprimer le rôle (« Supprimer le rôle », fenêtre « Supprimer ce rôle ? », confirmer par « Supprimer le rôle ») et le clone "Secrétariat test guide" de la même façon.
9. **Anti-escalade** : en directeur, ouvrir la page ; dans « Nouvelle attribution », choisir l'utilisateur `educateur@secondaire-test.test` et le rôle « Propriétaire », « Attribuer le rôle ».
Résultat attendu : messages « Rôle attribué. », « Validité mise à jour. », « Attribution révoquée. », « Rôle supprimé. » ; étape 7 : « Ce rôle est encore attribué à des utilisateurs. Retirez d'abord ses attributions. » ; étape 9 : « Action refusée : vous ne pouvez accorder que des permissions que vous détenez vous-même sur ce périmètre. Permissions qui vous manquent : » suivi de la liste, **aucune attribution créée** (liste inchangée) ; après révocation, l'éducateur retrouve « Accès refusé » sur `/v2/audit`. Les actions `assignment.changed` et `role.changed` sont dans le journal (1.23). Pendant le chargement, des messages "non inclus dans l'offre" ou des identifiants à la place des e-mails peuvent apparaître un instant (défaut connu, voir Écarts).
Cas invalides :

| Saisie | Message attendu |
|---|---|
| Rien choisi, « Attribuer le rôle » | « Choisissez un utilisateur. » et « Choisissez un rôle. » |
| Périmètre « Un établissement » sans choix | « Choisissez un établissement. » |
| Périmètre « Un campus » sans choix | « Choisissez un établissement. » et « Choisissez un campus. » |
| « Valide jusqu'au » antérieur à « Valide à partir du » | « La fin de validité doit suivre le début. » |
| Nouvelle attribution (rôle "Secrétariat test guide") avec « Valide jusqu'au » = hier | "La fin de validité est déjà passée." (refus du serveur) |

Le refus du **retrait du dernier propriétaire** (« Action refusée : l'établissement doit toujours conserver au moins un propriétaire. ») se teste dans l'établissement jetable (1.22), pour ne prendre aucun risque sur le compte propriétaire d'un établissement de départ.
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour le directeur (anti-escalade)

---

## Partie C. Établissement jetable avec propriétaire emprunté (avancé, facultatif)

Cette partie sert aux actions qui ne se défont pas ou qui exigent une session dans l'organisation de test. Elle suppose de pouvoir lire le code de double authentification du panneau de `/v2/login` (fenêtre séparée).

#### 1.20 Créer l'organisation B, s'y connecter, créer un établissement et un campus
Compte : opérateur (création), puis propriétaire du Primaire (`direction.generale@primaire-test.test`) · Où : `/v2/platform/tenants/new`, `/login`, `/v2/settings/institutions` · Prérequis : 1.4
1. En opérateur (fenêtre B), créer l'organisation comme en 1.4 avec :

   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Nom de l'organisation | École multi test guide | oui |
   | Identifiant (slug) | `tg-multi` | oui |
   | Pays (code ISO) | `CI` | oui |
   | Packs | « Secondaire » | oui |
   | Nom complet (propriétaire) | Direction générale (emprunt test guide) | oui |
   | Adresse e-mail (propriétaire) | `direction.generale@primaire-test.test` (compte **existant**) | oui |

   Le texte de réussite affiche "Une invitation a été envoyée à …" alors qu'aucune invitation n'est nécessaire (le compte a déjà un mot de passe).
2. En fenêtre A, se connecter **après** cette création avec le propriétaire du Primaire (panneau de `/v2/login`). Il arrive à l'écran d'arrivée du Primaire (dernier établissement utilisé).
3. Menu « Mon compte » > « Changer d'établissement » > "École multi test guide" : l'application ouvre `/v2/account/tenants` et demande "Ce changement demande votre code de vérification en deux étapes.". Saisir le code d'une fenêtre séparée (`/login`, bouton "Afficher le code MFA" du compte `direction.generale@primaire-test.test`) ; **si le code est refusé parce qu'il vient d'être utilisé, attendre le code suivant (30 secondes)**. Le chapitre 2 (2.15) détaille cet écran.
4. Dans l'organisation B, ouvrir `/v2/settings/institutions`. Un établissement de pack « Secondaire » existe déjà. Cliquer « Nouvel établissement » et remplir :

   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Nom de l'établissement | Lycée annexe test guide | oui |
   | Pack | « Secondaire » | oui |
   | Code | `tg-lycee` (aide « Facultatif : dérivé du pack si vide. Minuscules, chiffres et tirets. ») | non |
   | Système éducatif | laisser vide (aide « Facultatif : celui du pays par défaut. ») | non |

5. Cliquer « Créer l'établissement ». Ouvrir « Voir les campus de Lycée annexe test guide » : un campus « Par défaut » a été créé automatiquement (« Un campus par défaut est créé automatiquement. »).
6. Modifier l'établissement (crayon « Modifier Lycée annexe test guide ») : « Nom » = `Lycée annexe test guide 2`, « Enregistrer » ; rouvrir et enregistrer sans rien changer : « Aucune modification. ».
Résultat attendu : étape 5 : message "Établissement … créé." (avec le nom entre guillemets français) ; étape 6 : « Établissement mis à jour. ». L'écran d'arrivée de l'organisation B est celui d'un propriétaire (`/v2/direction`).
Cas invalides :

| Saisie | Message attendu |
|---|---|
| Nom vide ou `A` | message de Zod par défaut : à relever |
| Pack non choisi | message de Zod par défaut (choix invalide) : à relever |
| « Code » = `TG Lycee` | "Code en minuscules, chiffres et tirets (31 caractères max)." |
| « Code » = `tg-lycee` une seconde fois | refus du serveur (code déjà utilisé), message à relever |

- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé (secrétariat : lecture seule, 1.14)

#### 1.21 Mise en service complète, jusqu'à la production
Compte : propriétaire du Primaire connecté à l'organisation B · Où : `/v2/settings/onboarding` · Prérequis : 1.20
1. Ouvrir la page. Résultat de départ attendu : « Progression : 5 étape(s) sur 11 » (Compte propriétaire, Établissement, Pays et devise, Type d'établissement, Pack sont « Terminée » avec leur date), « Prochaine étape : Année académique ».
2. Constater qu'« Année académique » propose « Marquer comme terminée » et que « Classes » affiche « Disponible une fois les étapes précédentes résolues. » (aucun bouton). « Mise en production » n'est pas disponible non plus.
3. Cliquer « Marquer comme terminée » sur « Année académique » → « Étape mise à jour. » ; « Classes » devient disponible : la terminer.
4. « Import des élèves » et « Enseignants » : cliquer « Ignorer » (statut « Ignorée », étape facultative). « Finance » : « Marquer comme terminée ».
5. « Mise en production » devient disponible : cliquer « Passer en production ». Fenêtre « Passer en production ? » : "Cette action est définitive : l'établissement passe en production et la mise en service est close…". Annuler une première fois, puis recommencer et confirmer par « Passer en production ».
Résultat attendu : message « Félicitations, l'établissement est en production. » ; le bloc de progression devient « Établissement en production » avec « La mise en service est terminée. Toutes les fonctionnalités de votre offre sont disponibles. » ; aucun bouton d'action ne reste. Une étape obligatoire ne peut pas être ignorée (aucun bouton « Ignorer » sur Année académique ni Classes).
- [ ] Cas nominal  - [ ] Cas invalide (étapes bloquées)  - [ ] Droit refusé (secrétariat : aucun bouton)

#### 1.22 Droits selon l'abonnement, suspension de l'organisation, dernier propriétaire
Compte : opérateur (fenêtre B) et propriétaire du Primaire dans l'organisation B (fenêtre A) · Où : fiche de l'organisation B dans la console ; menu « Modules », `/v2/settings/subscription`, `/v2/schoollife`, `/v2/access/assignments` · Prérequis : 1.20
1. Fenêtre A (organisation B) : relever, dans le menu « Modules », la présence de « Vie scolaire » ; dans « Abonnement et usage », relever le total des fonctionnalités.
2. Fenêtre B : fiche de l'organisation B, « Ajouter une dérogation » : Fonctionnalité "Vie scolaire : incidents, mesures, observations (schoollife.core)", Effet « Retirer », Motif `Essai du menu hors plan (test guide)`, « Enregistrer la dérogation ».
3. Fenêtre A : attendre 30 secondes (cache des droits) puis recharger. « Vie scolaire » a disparu du menu « Modules » ; ouvrir `/v2/schoollife` (message "non inclus dans l'offre" attendu, texte à relever) ; dans « Abonnement et usage » le total baisse de 1 et la clé `schoollife.core` n'est plus dans le bloc `schoollife`.
4. Fenêtre B : supprimer la dérogation ; fenêtre A : après 30 secondes, « Vie scolaire » revient.
5. Fenêtre B : dans « Abonnement », passer le « Statut » à « Expiré », « Enregistrer l'abonnement » ; fenêtre A (recharger) : bandeau « L'abonnement n'est plus actif : seules les fonctionnalités de base sont accordées. » sur « Abonnement et usage », la plupart des modules disparaissent du menu. Remettre « Actif » (puis recharger : le menu complet revient).
6. Fenêtre A : `/v2/access/assignments`, filtrer le rôle sur « Propriétaire », puis « Révoquer l'attribution de Propriétaire » (ligne du compte `direction.generale@primaire-test.test`) et confirmer : message « Action refusée : l'établissement doit toujours conserver au moins un propriétaire. ». Rien n'est révoqué.
7. Fenêtre B : « Suspendre » l'organisation B (motif `Suspension d'essai test guide`). Fenêtre A (organisation B) : au prochain clic, retour à `/login?expired=1` avec "Votre session a pris fin. Reconnectez-vous.".
8. Fenêtre A : ouvrir `http://tg-multi.localhost:3000/login`, cliquer le compte du Primaire dans le panneau, saisir le code, se connecter : "Aucun accès actif pour cet établissement." (le sous-domaine désigne l'organisation visée ; à vérifier en test sur ce poste).
9. **Retour à la normale** : fenêtre B : « Réactiver » l'organisation B. Fenêtre A : se connecter au Primaire par `http://primaire-test.localhost:3000/login` (ce qui remet le Primaire comme dernier établissement utilisé).
Résultat attendu : conforme aux étapes ; messages « Dérogation enregistrée. », « Dérogation supprimée. », « Abonnement enregistré. », « Statut mis à jour. ». Les changements sont dans le journal d'audit de l'organisation B (action `override.set`, `override.removed`, `tenant.status_changed`…) et dans le journal de plateforme.
- [ ] Cas nominal  - [ ] Cas invalide (dernier propriétaire)  - [ ] Droit refusé (organisation suspendue)

---

## Partie D. Journal d'audit, droits et contrôles transversaux

#### 1.23 Journal d'audit : lire, filtrer, détailler, vérifier, exporter
Compte : propriétaire du Collège (MFA), puis directeur · Où : menu « Journal d'audit » (`/v2/audit`, `/v2/audit/<identifiant>`) · Prérequis : avoir fait 1.17 à 1.19 (il faut des entrées récentes ; attendre quelques secondes)
1. Ouvrir « Journal d'audit ». Titre « Journal d'audit », texte "Historique infalsifiable des actions réalisées dans votre établissement…", bouton « Exporter en CSV » avec l'indication "Export borné : période obligatoire de 31 jours maximum, … lignes au plus.".
2. Formulaire « Filtrer le journal » : « Action » (aide « Exacte (role.changed) ou par préfixe (role.*). »), « Entité » (aide « Ex. role, campus, institution. »), « Identifiant de l'entité », « Acteur (identifiant) » (aide « Identifiant UUID de l'utilisateur à l'origine de l'action. »), « Du », « Au », cases « Information », « Notable », « Avertissement », « Critique ».
3. Saisir `role.*` dans « Action », « Appliquer les filtres » : les créations, modifications et suppressions de rôles de 1.17 à 1.19 apparaissent (action `role.changed`, entité `role`, gravité « Avertissement »). Même chose avec `assignment.*` (entité `role_assignment`), `session.*`, `login.*` (échecs de connexion, gravité « Notable » ou « Avertissement » en cas de verrouillage, voir chapitre 2), `membership.*`, `mfa.*`, `password.*`. Cocher « Avertissement » seul, puis « Réinitialiser ».
4. Tableau « Entrées du journal d'audit » : colonnes « Date », « Gravité », « Action » (lien), « Entité », « Acteur », « Changements » (par exemple "1 champ") ; compteur "N entrées chargées" ; « Charger plus d'entrées » si la liste continue. L'acteur est un identifiant (UUID) précédé de « Utilisateur » ; l'action `login.failed` est de type « Système » (la personne n'est pas authentifiée).
5. Cliquer le lien d'une entrée `role.changed` (nom accessible « Voir le détail de l'entrée role.changed »). Page « Entrée du journal » avec « Retour au journal », « Informations générales » (« Survenue le », « Enregistrée le », « Numéro de séquence », « Entité », « Identifiant de l'entité », « Acteur », « Requête », « Adresse IP »…), « Changements » (« Changements champ par champ » avec « Ajouté », « Retiré » ou « Modifié » et les colonnes « Avant » / « Après » ; ou « Aucun changement de valeur n'est enregistré pour cette entrée. »), blocs repliables « État complet avant », « État complet après », « Métadonnées », et « Empreinte » (« Algorithme », « Empreinte », « Empreinte précédente »). Les valeurs sensibles s'affichent « Valeur masquée ».
6. Bloc « Intégrité de la chaîne » : « Portée de la vérification » = « Toute la chaîne », « Vérifier la chaîne ».
7. Export : renseigner « Du » (hier) et « Au » (maintenant), « Exporter en CSV ». **Le navigateur télécharge un fichier** `audit-AAAA-MM-JJ.csv` : à faire par une personne, ou avec l'accord explicite de la personne qui supervise.
8. Ouvrir `/v2/audit/11111111-1111-4111-8111-111111111111` puis `/v2/audit/abc`.
9. En directeur, ouvrir `/v2/audit` : même accès (lecture, vérification, export).
Résultat attendu : étape 6 : « Chaîne intègre » avec "N entrées vérifiées (séquences a à b). Aucune anomalie." et le point de départ « début de la chaîne… » ; le bouton devient « Vérifier à nouveau ». Étape 7 : message "Export terminé : N lignes dans audit-….csv." ; l'export est lui-même une action sensible tracée (une nouvelle entrée d'export apparaît ensuite). Étape 8 : pour le premier : « Cette entrée n'existe pas ou n'appartient pas à votre établissement. » ; pour `abc` : zone d'erreur (identifiant invalide), message à relever. Aucune entrée n'est modifiable ni supprimable. La connexion **réussie** n'est pas tracée (seuls les échecs, révocations, changements de rôles, d'attributions, d'accès, de mot de passe et de MFA le sont).
Cas invalides :

| Saisie | Message attendu |
|---|---|
| « Acteur (identifiant) » = `abc` | « Saisissez un identifiant UUID valide. » |
| « Entité » = `Role Changed` | message sur les minuscules, chiffres et le tiret bas uniquement (texte exact : `audit.filters.errors.entity`) |
| « Action » = `Role Changed` | « Format attendu : entité.verbe ou entité.* (minuscules). » |
| « Du » postérieur à « Au » | « La fin de période doit suivre le début. » |
| Aucune date, « Exporter en CSV » | « L'export exige une période : renseignez les deux dates. » |
| « Du » et « Au » espacés de 40 jours, « Exporter en CSV » | « La période d'export est limitée à 31 jours. » |
| Filtre sans résultat (`role.zzz`) | « Aucune entrée ne correspond à ces filtres. » |

Droit refusé : un profil qui a "Consulter le journal d'audit" mais pas "Exporter le journal d'audit" (l'éducateur du scénario 1.19, tant que l'attribution existe) voit « Exporter en CSV » inactif. L'enseignant est renvoyé vers « Accès refusé » (1.24).
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'enseignant et pour l'export sans permission

#### 1.24 Droits : adresses interdites
Compte : enseignant, parent, élève, éducateur, secrétariat, personne non connectée · Où : barre d'adresse · Prérequis : aucun
1. Pour chaque ligne du tableau "Adresses à taper à la main qui doivent être refusées" (en tête de chapitre), se connecter avec le compte indiqué (une fenêtre privée par compte) et ouvrir chaque adresse.
2. Pour la personne non connectée, ouvrir les adresses sans session.
Résultat attendu : redirection vers `/unauthorized`, page « Accès refusé » avec "Vous n'avez pas les droits nécessaires pour afficher cette page." et le lien "Retour à l'accueil", **sans le menu** de l'application, sans donnée ; pour la personne non connectée : retour à `/login`. Le propriétaire d'un établissement et l'opérateur ne partagent pas leurs accès : voir 1.2. Les messages « Accès refusé » (page) et "Action non autorisée." (dans une page ouverte) ne se confondent pas : le premier concerne l'ouverture de l'écran, le second un appel refusé par le serveur.
- [ ] Cas nominal (propriétaire accède)  - [ ] Cas invalide (adresses inconnues)  - [ ] Droit refusé pour chaque rôle du tableau

#### 1.25 Contrôles transversaux de l'administration
Compte : propriétaire du Collège, opérateur · Où : écrans des scénarios 1.3 à 1.23 · Prérequis : aucun
1. **Clavier** : avec la touche Tab, parcourir `/v2/platform/login`, la fiche d'une organisation, `/v2/access/roles` et `/v2/audit` : le focus est visible, l'ordre est logique ; les fenêtres (« Cloner le rôle », « Supprimer ce campus ? », « Passer en production ? ») se ferment avec Échap et le focus revient au bouton d'origine ; aucun piège au clavier.
2. **Chargement et erreurs** : à la première ouverture d'une page (mode développement), un état « Chargement en cours… » est normal (jusqu'à plusieurs secondes) ; recharger une fois avant de signaler un défaut. Arrêter l'API (par la personne qui exploite l'environnement) puis recharger `/v2/platform/tenants` : une erreur avec « Réessayer » doit s'afficher, jamais une page blanche.
3. **Français** : aucun libellé anglais ni code technique brut visible hors des clés de fonctionnalités et d'actions déjà signalées en Écarts.
4. **Mobile** : largeur 375 pixels (outils de développement) : les tableaux de la console et des rôles s'affichent en cartes, les boutons font au moins 44 pixels de haut, aucun défilement horizontal de la page.
Résultat attendu : conforme ; écarts à consigner dans le rapport.
- [ ] Cas nominal  - [ ] Cas invalide (API arrêtée)  - [ ] Droit refusé (non applicable)

---

## Nettoyage (à faire en dernier)

1. Console : archiver l'organisation A (« Archiver », motif `Fin des essais test guide`) puis l'organisation B (« Réactiver » si elle est suspendue, puis « Archiver »). Les organisations ne se suppriment pas ; le plan `TG_PLAN_TEST` reste « Inactif ».
2. Collège : profil rétabli (1.13), campus de test supprimé (1.14), rôles "Lecteur test guide v2" et "Secrétariat test guide" supprimés, attribution révoquée (1.19).
3. Le compte propriétaire du Primaire a gardé une attribution dans l'organisation archivée : elle est inerte (une organisation archivée n'est plus proposée à la connexion). Se reconnecter par `http://primaire-test.localhost:3000/login` pour vérifier que l'arrivée se fait bien au Primaire.

## Données créées

| Enregistrement | Où | Remarque |
|---|---|---|
| Organisation "École jetable test guide" (`tg-jetable`) | console | archivée à la fin |
| Organisation "École multi test guide" (`tg-multi`) | console | archivée à la fin ; propriétaire emprunté |
| Établissement Lycée annexe test guide (`tg-lycee`) et son campus par défaut | organisation B | ne se supprime pas |
| Plan "Plan test guide modifié" (`TG_PLAN_TEST`) | catalogue global | inactif, ne se supprime pas |
| Dérogations (A et B), changements de statut et d'abonnement | organisations A et B | rétablis ou archivés |
| Campus Campus annexe test guide (`tg-annexe`) | Collège | supprimé dans le scénario |
| Rôles "Secrétariat test guide" (`tg_secretariat`) et "Lecteur test guide" (`tg_lecteur`) | Collège | supprimés dans 1.19 |
| Attribution du rôle "Lecteur test guide" à `educateur@secondaire-test.test` | Collège | révoquée dans 1.19 |
| Nom commercial et couleurs du profil | Collège | rétablis dans 1.13 |
| Étapes de mise en service de l'organisation B (jusqu'à la production) | organisation B | définitif, sans effet sur les établissements de départ |

## Écarts constatés

| Écran | Constat | Gravité |
|---|---|---|
| `/v2/platform/tenants/new` | Le texte de réussite "Une invitation a été envoyée à …" est affiché même quand aucun courrier ne peut partir (pas de transport e-mail) et même quand le propriétaire est un compte existant (aucune invitation n'est alors émise). | Mineur |
| console `/v2/platform` (formulaires), `/v2/settings` (profil, campus, établissement) | Les formulaires valident avec les schémas des contrats **sans** table de messages français : les contrôles intégrés de Zod (longueur minimale, adresse e-mail, URL, choix, nombre) peuvent s'afficher en anglais ; seuls les messages propres aux contrats (slug, pays, téléphone, couleur, domaine, clé de plan) sont en français. À confirmer en test. | Mineur |
| `/v2/platform/plans` | Créer un plan avec une clé déjà existante (`STARTER`…) remplace silencieusement le plan existant (libellé, ordre, actif) : aucun message "existe déjà". Aucun plan ne se supprime. | Majeur (à confirmer) |
| `/v2/settings/subscription`, `/v2/platform/tenants/<id>` | L'offre est affichée par sa clé technique (`PROFESSIONAL`) et les fonctionnalités par leurs clés (`academic.a-la-carte`…), non par leur libellé français. | Mineur |
| `/v2/audit` | La colonne « Acteur » montre « Utilisateur » et un identifiant UUID au lieu d'un nom ou d'une adresse e-mail ; les actions et entités sont des codes (`role.changed`, `role_assignment`). | Mineur |
| `/v2/access/assignments` | Pendant le chargement, des identifiants à la place des adresses e-mail et des avis "non inclus dans l'offre" apparaissent un instant (rapport QA C-02-03). | Mineur |
| `/v2/access/roles/new` | La page s'ouvre pour un directeur (garde = lecture seule) alors que la création est réservée au propriétaire ; le refus ne vient qu'à l'enregistrement. | Mineur |
| `/v2/settings/subscription` pour un rôle sans `entitlements.read` | La page s'ouvre puis affiche une erreur au lieu de renvoyer vers « Accès refusé ». | Mineur |
| Pages sous `/v2/platform` | La protection de la console est faite côté navigateur (jeton) ; la barrière réelle est l'API. Pas un défaut, à savoir pour les tests de sécurité. | Suggestion |
| Pas d'écran d'impersonation | L'API sait ouvrir une session d'assistance (action d'audit `impersonation.started`, gravité critique, étiquette "Assistance" dans « Mes sessions ») mais aucun écran de la console ne la déclenche. | Suggestion |

## À vérifier en test

- Nom et code de l'établissement créé par défaut pour le pack Secondaire (modèle de pack) à la création d'une organisation.
- Offre d'essai réellement posée par « Offre par défaut du serveur » (Professionnel d'après `ENTITLEMENTS_TRIAL_PLAN` de l'environnement de développement, sinon Starter) et nombre de fonctionnalités de l'offre Starter.
- Message exact de refus quand on supprime le campus par défaut, quand un code de campus ou d'établissement existe déjà, et pour l'identifiant invalide `abc` (fiche d'organisation, rôle, entrée d'audit).
- Texte exact affiché sur `/v2/schoollife` quand la fonctionnalité est retirée (dérogation) ou quand l'abonnement est expiré.
- Délai de prise en compte d'une attribution de rôle, d'une dérogation ou d'un statut d'abonnement côté établissement (cache de droits de 30 secondes pour l'abonnement ; durée du cache des permissions pour les rôles).
- Statut « Expirée » après modification de la validité d'une attribution avec une date passée.
- Comportement de la recherche de la liste des organisations (nom, identifiant, casse).
- Navigation par sous-domaine `*.localhost` (étape 8 de 1.22) sur le poste de test.
- Aucune limite de tentatives n'est attendue sur la connexion de l'opérateur.

## Non couvert / limites connues

- Impersonation (assistance) : aucun écran.
- Passage de l'organisation par tous les statuts d'abonnement « Paiement en retard » et « Résilié » : seuls « Actif », « Période d'essai » et « Expiré » sont éprouvés ; les autres suivent la même règle (socle seul).
- Téléversement d'un logo : n'existe pas (lien https uniquement).
- Création d'un établissement des trois packs « Primaire », « Supérieur », « Virtuel » dans l'organisation B (même formulaire ; seul « Secondaire » est éprouvé).
- Ré-authentification pour action sensible (fenêtre « Confirmez votre identité ») : les sessions des comptes de test à MFA sont déjà à deux facteurs ; la fenêtre n'est pas déclenchable ici (chapitre 2, section "Non couvert").
- Envoi réel d'e-mails d'invitation : impossible dans cet environnement sans transport SMTP.
