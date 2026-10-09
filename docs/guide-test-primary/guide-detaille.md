# 🧭 Guide de test — Pack Primaire (École Primaire Les Flamboyants)

Parcours **étape par étape** pour tester **uniquement le pack Primaire** d'EcoleDigitale, sur une **école neuve et vide** : on la configure de A à Z, puis on suit une classe jusqu'au bilan annuel. Chaque étape indique **qui se connecte, quel menu ouvrir, quoi saisir et ce que l'on doit voir**.

- Application : <http://localhost:3000> (connexion : <http://localhost:3000/v2/login>) · API : <http://localhost:4000>
- École de test : **École Primaire Les Flamboyants** (`ecole-flamboyants`), pack **Primaire**, abonnement Professional. Elle est **vide** : ni année, ni classe, ni élève, ni personnel.
- **Un seul compte existe pour l'instant** : le **propriétaire** de l'école, `direction.generale@ecole-flamboyants.test` (avec code MFA). Les phases 1 à 18 (**partie 1**) se jouent avec lui. Les gestes qui exigent un autre rôle (instituteur, parent, directeur…) sont regroupés dans la phase 19 (**partie 2**), à jouer quand ces comptes auront été ajoutés.
- Date de référence : **J = vendredi 9 octobre 2026**. Année scolaire créée : **2026-2027**.
- Tout est fictif : noms ivoiriens inventés, e-mails en `@ecole-flamboyants.test`, téléphones factices (`+225 07 00 00 00 NN`). Aucun e-mail, SMS ni paiement réel n'est émis.
- **Ce guide a été rédigé en lisant le code, sans rejouer chaque scénario.** Un attendu suivi de *(à vérifier)* n'est pas prouvé : notez ce que vous voyez. Les défauts déjà repérés sont signalés "⚠️ *Écart connu*".
- Les règles du pack sont des **règles de démonstration** (bandeau « Règles de démonstration » sur les écrans) : n'en tirez aucune conclusion réglementaire.

## Sommaire

Le guide compte **20 phases** et **107 étapes**.

1. [Première connexion et visite de l'école vide](#phase-1--première-connexion-et-visite-de-lécole-vide)  — étapes 1 à 11
2. [Structure académique de l'école](#phase-2--structure-académique-de-lécole)  — étapes 12 à 24
3. [Pack Primaire : réglages, modèle de pack, échelles et référentiels de compétences](#phase-3--pack-primaire--réglages-modèle-de-pack-échelles-et-référentiels-de-compétences)  — étapes 25 à 39
4. [Banque d'appréciations (phrases)](#phase-4--banque-dappréciations-phrases)  — étapes 40 à 43
5. [États du primaire (lecture)](#phase-5--états-du-primaire-lecture)  — étapes 44 à 45
6. [Personnel de l'école](#phase-6--personnel-de-lécole)  — étapes 46 à 49
7. [Réglages d'inscription](#phase-7--réglages-dinscription)  — étapes 50 à 51
8. [Tuteurs et élèves saisis à la main](#phase-8--tuteurs-et-élèves-saisis-à-la-main)  — étapes 52 à 58
9. [Inscriptions dans les classes](#phase-9--inscriptions-dans-les-classes)  — étapes 59 à 63
10. [Import des trois derniers élèves](#phase-10--import-des-trois-derniers-élèves)  — étapes 64 à 68
11. [Titulaires et activation des classes](#phase-11--titulaires-et-activation-des-classes)  — étapes 69 à 72
12. [Appel du jour par demi-journée](#phase-12--appel-du-jour-par-demi-journée)  — étapes 73 à 77
13. [Compétences : lire la grille, période « prête »](#phase-13--compétences--lire-la-grille-période--prête)  — étapes 78 à 80
14. [Banque d'appréciations](#phase-14--banque-dappréciations)  — étapes 81 à 82
15. [Conseil des maîtres](#phase-15--conseil-des-maîtres)  — étapes 83 à 86
16. [Bilans annuels et archive](#phase-16--bilans-annuels-et-archive)  — étapes 87 à 89
17. [Avancement, états et espace famille](#phase-17--avancement-états-et-espace-famille)  — étapes 90 à 93
18. [Actes de fin de recette](#phase-18--actes-de-fin-de-recette)  — étapes 94 à 96
19. [Partie 2 — à jouer quand les autres comptes existeront](#phase-19--partie-2--à-jouer-quand-les-autres-comptes-existeront)  — étapes 97 à 107
20. [Bilan de la recette](#phase-20--bilan-de-la-recette) 

---

## Avant de commencer

### 1. Lancer l'application

```bash
pnpm dev:v2
```

*(lance l'API, le site web et le worker ; le worker produit les PDF : bulletins, procès-verbaux, bilans)*

L'école a déjà été créée dans la base locale `ecoledigitale_v2`. Pour la recréer (par exemple sur une base neuve), la commande suivante crée l'école vide et son seul compte, sans aucune donnée à l'intérieur. Elle ne fait rien si l'école existe déjà, et ne touche à aucune autre base :

```bash
pnpm dev:v2:new-school
```

*(variables facultatives `DEVV2_SCHOOL_NAME` et `DEVV2_SCHOOL_SLUG` pour un autre nom ou identifiant.)*

### 2. Se connecter avec le propriétaire (aucun mot de passe à retenir)

1. Ouvrir `http://localhost:3000/v2/login`. Attendre quelques secondes : le panneau **« Comptes par tenant »** apparaît à droite.
2. Dans la liste **« Établissement »**, choisir `ecole-flamboyants` (ou descendre jusqu'au groupe `ECOLE-FLAMBOYANTS`).
3. Cliquer le compte **Propriétaire** : l'e-mail et le mot de passe se remplissent.
4. Cliquer **« Se connecter »**. L'écran **« Vérification en deux étapes »** s'affiche.
5. Dans le panneau, cliquer **« Afficher le code MFA »** sous le compte : le code à 6 chiffres s'affiche (il change toutes les 30 secondes et ne sert qu'une fois). Le saisir dans « Code à 6 chiffres », puis **« Valider »**.
6. On arrive sur « Tableau de bord de la direction » (`/v2/direction`).

> Sur `/login` (ancienne adresse), le panneau des comptes n'apparaît pas : utilisez `/v2/login`.
>
> **Ne copiez jamais** un mot de passe ou un code MFA dans un rapport.
>
> **Chargement des pages** : juste après l'ouverture d'une page, un message transitoire peut s'afficher (« Établissement inconnu… » ou "Cette fonctionnalité n'est pas incluse dans l'offre de votre établissement"). Attendre 3 à 4 secondes avant de juger : c'est un état de chargement, qui doit disparaître.

### 3. Une seule fenêtre

Toute la partie 1 se joue dans **une seule fenêtre de navigateur (fenêtre A)**, connectée en propriétaire. La partie 2 indiquera, à chaque étape, le compte à utiliser et la fenêtre (A ou B, en navigation privée).

### 4. Comment lire une étape

| Signe | Sens |
| :---: | :--- |
| 👤 | compte à utiliser (rôle, établissement, fenêtre) |
| 🔑 | **compte à utiliser** : à chaque changement de compte, e-mail exact, fenêtre et MFA éventuelle |
| 📂 | menu à ouvrir et adresse de la page |
| ✅ | ce que l'on doit voir (message exact, ligne de liste, chiffre) |
| ⚠️ *Test d'erreur* | saisie invalide à essayer, avec le message attendu |
| 🔒 *Test de droit* | accès à tenter avec un compte qui n'y a pas droit |
| 🕓 | geste **différé** : à jouer quand le compte du rôle indiqué existera |
| ⚠️ *Écart connu* | défaut déjà repéré en lisant le code : si vous le voyez, notez-le sans vous bloquer |
| ⚠️ Irréversible | action qui ne se défait pas : à jouer une seule fois, en fin de recette |
| ☐ OK ☐ KO | à cocher en fin d'étape |

Un texte entre guillemets français (comme **« Créer »**) est un libellé de l'interface ; un texte entre guillemets droits ou en `code` est une valeur à saisir, un nom d'enregistrement ou un message du serveur.

### 5. Données du jeu de test

| Élément | Valeur |
| :--- | :--- |
| École | École Primaire Les Flamboyants — Abidjan, Cocody (fictif) |
| Année | 2026-2027, début 2026-09-07 |
| Classes | Grande Section A, CP1 A, CM2 A |
| Personnel | KOFFI Adjoua (CP1 A), BAMBA Séraphin (CM2 A), ZOKORA Sylvie (Grande Section A) |
| Élèves | 3 par classe, soit 9 au total (détail et tuteurs dans la phase « Personnes ») |

Fichiers d'import fournis : dossier [`docs/guide-test-primary/jeux-de-donnees/`](guide-test-primary/jeux-de-donnees/).

---

## Phase 1 — Première connexion et visite de l'école vide

Objectif : se connecter avec l'unique compte de l'école (le **propriétaire**, avec MFA), constater que l'école est bien vide, repérer ce que son menu propose, vérifier l'identité de l'école, son pack et son abonnement, puis éprouver la connexion (erreurs, déconnexion, reconnexion).

Précondition : application lancée (`pnpm dev:v2`), école créée par `pnpm dev:v2:new-school` (École Primaire Les Flamboyants, slug `ecole-flamboyants`, pack `PRIMARY`, abonnement `PROFESSIONAL`), aucune session ouverte dans la fenêtre **A**. Date de référence : J = vendredi 9 octobre 2026. Un seul compte existe : `direction.generale@ecole-flamboyants.test` (propriétaire, **MFA**).

> **Chargement transitoire (à connaître avant de juger quoi que ce soit).** Juste après une connexion ou un rechargement, certains écrans affichent brièvement « Établissement inconnu. Ouvrez l'adresse de votre établissement ou contactez l'assistance. » ou « Cette fonctionnalité n'est pas incluse dans l'offre de votre établissement. » (ou « Le pilotage de la direction n'est pas inclus dans l'offre de votre établissement. »). C'est le temps que la session et les droits de l'école se chargent : **attendre 3 à 4 secondes** avant de conclure. Si le message est encore là après 10 secondes, recharger la page (F5) ; s'il persiste, noter KO avec l'adresse de la page.
>
> **Textes des écrans de connexion et de compte.** Les libellés des écrans « Connexion », « Vérification en deux étapes », « Sécurité du compte », « Mes sessions » et « Membres de l'établissement » sont écrits directement dans les composants (pas dans le fichier de traductions) ; ils sont cités ici tels quels. Les libellés des entrées du menu latéral viennent des modules de l'API.

### Étape 1 — Ouvrir la page de connexion et lire le panneau des comptes
👤 **personne non connectée** · fenêtre **A** · 📂 Adresse `http://localhost:3000/v2/login` (`/v2/login`)

1. Ouvrir l'adresse. À gauche, le formulaire : titre « Connexion », texte « Accédez à votre espace éducatif. », champs « Adresse e-mail » et « Mot de passe », bouton « Se connecter » (inactif tant que les deux champs sont vides), liens « Mot de passe oublié ? » et "S'inscrire en ligne".
2. Attendre 2 à 3 secondes : à droite, le panneau **« Comptes par tenant »** (pastille « Test uniquement », texte « Cliquez un compte pour remplir le formulaire de connexion. »).
3. Repérer le groupe `ecole-flamboyants`. Si d'autres écoles existent aussi dans la base, un sélecteur « Établissement » apparaît au-dessus de la liste : choisir `ecole-flamboyants` (sinon descendre jusqu'au groupe `ECOLE-FLAMBOYANTS`).
4. Lire le seul compte de l'école : libellé « Propriétaire », badge du rôle `proprietaire`, badge **MFA**, et sous le compte le bouton « Afficher le code MFA ».

✅ Le groupe `ecole-flamboyants` ne contient **qu'un seul compte** (le propriétaire). Aucun mot de passe ni code n'est affiché tant qu'on ne clique pas.

⚠️ *Écart connu* : sur `/login` (sans `/v2`) le panneau est absent ; après chaque « Se déconnecter » l'application renvoie vers `/login` : retaper alors `/v2/login`.

☐ OK ☐ KO

### Étape 2 — Essayer de se connecter avec un mauvais mot de passe
👤 **personne non connectée** · fenêtre **A** · 📂 `/v2/login`

1. Cliquer sur le compte « Propriétaire » du panneau : l'e-mail et le mot de passe (masqué) se remplissent.
2. Effacer le champ « Mot de passe » et y saisir une valeur fausse : `MotDePasseFaux-2026`.
3. Cliquer **« Se connecter »**.
4. Refaire l'essai avec une adresse inconnue : `inconnu@ecole-flamboyants.test` et le même mot de passe faux.

✅ Aux étapes 3 et 4, le **même** message : « Identifiants invalides. Vérifiez votre e-mail et votre mot de passe. » (rien n'indique si le compte existe). Le champ « Mot de passe » est vidé après chaque essai ; aucun écran de code n'apparaît.

⚠️ *Test d'erreur* : e-mail rempli et mot de passe vide : « Se connecter » reste inactif.

⚠️ À ne faire qu'**une ou deux fois** : au bout de 5 échecs rapprochés pour le même compte, l'API verrouille la connexion pendant environ une minute (message "Trop de tentatives. Réessayez dans 1 minute."). Si cela arrive, attendre.

☐ OK ☐ KO

### Étape 3 — Se connecter en propriétaire (avec MFA)
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 `/v2/login`
🔑 **Connexion** : fenêtre **A** : ouvrir `/v2/login`, choisir l'établissement `ecole-flamboyants`, cliquer sur le compte **propriétaire** — `direction.generale@ecole-flamboyants.test` — **avec code MFA** (bouton "Afficher le code MFA", puis « Valider »), puis **Se connecter**.

1. Cliquer sur le compte « Propriétaire » du panneau (e-mail et mot de passe se remplissent).
2. Cliquer **« Afficher le code MFA »** sous le compte : un code à 6 chiffres s'affiche avec "expire dans N s". Ne pas le recopier ailleurs.
3. Cliquer **« Se connecter »**. L'écran « Vérification en deux étapes » s'ouvre (« Saisissez le code à 6 chiffres de votre application d'authentification. »).
4. Faire d'abord l'essai refusé : effacer le champ « Code à 6 chiffres » (le panneau l'a rempli tout seul), saisir `000000`, cliquer **« Valider »**.
5. Cliquer **« Recommencer »**, recliquer le compte « Propriétaire » du panneau, **« Se connecter »**, puis **« Valider »** avec le code prérempli (si le code vient d'être utilisé, attendre le suivant).

✅ Étape 4 : message « Code invalide. Vérifiez l'heure de votre téléphone. » ; l'écran du code reste ouvert. Étape 5 : arrivée sur `/v2/direction`, page « Tableau de bord de la direction ». Le nom de l'école ("École Primaire Les Flamboyants") est en haut à gauche ; à droite, « Modules », « Mon compte » et « Se déconnecter ». Un rechargement (F5) garde la session.

⚠️ *Test d'erreur* : un code erroné compte comme un échec ; au bout de 5 échecs le défi est bloqué et il faut recommencer la connexion. Ne pas insister.

🕓 À jouer quand d'autres comptes existeront : un compte **sans** MFA (instituteur, parent, élève) arrive directement sur son espace, sans écran de code.

☐ OK ☐ KO

### Étape 4 — Lire le tableau de bord de la direction (école vide)
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 `/v2/direction` (arrivée de la connexion)

1. Attendre que les chargements se terminent (voir la remarque "Chargement transitoire" au début de la phase).
2. Lire l'en-tête : titre « Tableau de bord de la direction » et texte « L'essentiel de l'établissement : effectifs, présence, résultats, enseignants, scolarité et créances. ».
3. Lire la barre d'onglets du pilotage (« Tableau de bord », « Indicateurs de direction », « Effectifs et présences », « Admissions », « Vie scolaire », « Pédagogie », « Scolarité », « Trésorerie », « Masse salariale », « Charges et résultat », « Comparaisons », « Alertes », « Fraîcheur des données ») et le filtre « Année scolaire » (valeur « Année en cours »).
4. Lire les cartes d'indicateurs (zone « Indicateurs de la direction ») : « Élèves en scolarité », « Présence aujourd'hui », « Moyenne générale », « Taux de validation », « Enseignants et personnel présents ».
5. Lire la section « Scolarité et créances » (« Scolarité recouvrée », « Encaissé », « Créances (restant dû) ») et la section « Aller plus loin » (six liens : « Effectifs et présences », « Pédagogie », « Scolarité », « Trésorerie », « Masse salariale », « Charges et résultat »).

✅ « Élèves en scolarité » = `0` avec le détail « 0 inscription(s) au total · 0 classe(s) ». Les autres indicateurs, faute de données, affichent « Non mesuré » ou `0` *(relever ce qui s'affiche)* ; aucun chiffre inventé, aucune erreur rouge. Un bandeau « Données au … » ou « Aucune donnée n'a encore été calculée pour cet écran. » peut apparaître *(à vérifier)*. Les six liens de « Aller plus loin » sont présents (le propriétaire détient toutes les permissions de pilotage).

⚠️ *Écart connu (à vérifier)* : l'onglet « Vie scolaire » du pilotage est proposé alors que le module « Vie scolaire » n'appartient pas au pack Primaire ; il s'agit du pilotage agrégé (« Vie scolaire (agrégée) » dans le menu), pas du module.

☐ OK ☐ KO

### Étape 5 — Parcourir les écrans de l'école : tous vides, un seul membre
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menus **« Personnes »**, **« Académique »** et **« Utilisateurs »** (`/v2/students`, `/v2/guardians`, `/v2/staff`, `/v2/enrollments`, `/v2/academic/classrooms`, `/v2/admin/members`)

1. Ouvrir « Élèves » (`/v2/students`), « Parents et tuteurs » (`/v2/guardians`) et « Personnel » (`/v2/staff`) dans le module « Personnes », puis « Inscriptions » (`/v2/enrollments`) et « Classes » (`/v2/academic/classrooms`) dans le module « Académique ». Pour chacun, attendre la fin du chargement et lire l'état vide.
2. Ouvrir « Utilisateurs » (`/v2/admin/members`) : lire la liste « Membres ».

✅ « Élèves » : « Aucun élève pour le moment. » avec "Créez le premier dossier avec « Nouvel élève ». " ; « Tuteurs » : « Aucun tuteur enregistré. » ; « Personnel » : « Aucun membre du personnel. » ; « Inscriptions » : « Aucune inscription ne correspond. » ; « Classes et promotions » : « Aucune classe ne correspond. ». « Membres de l'établissement » : **une seule ligne**, `direction.generale@ecole-flamboyants.test`, rôle affiché par sa clé (`owner` ou `proprietaire`, à relever), mention « · 2 étapes », avec les boutons « Révoquer les sessions » et « Réinitialiser la MFA ». Le formulaire « Adresse e-mail à inviter » est présent (il sert plus tard à créer les autres comptes).

⚠️ Ne cliquer ni sur « Suspendre », ni sur « Révoquer les sessions », ni sur « Réinitialiser la MFA » sur cette ligne : ce serait se couper l'accès au seul compte de l'école.

☐ OK ☐ KO

### Étape 6 — Repérer ce que le menu propose au propriétaire
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu latéral et bouton **« Modules »** (en-tête)

Le menu est calculé par l'API : une entrée n'apparaît que si le rôle détient la permission **et** si l'offre de l'école inclut la fonctionnalité. Le propriétaire détient toutes les permissions ; seul le pack `PRIMARY` limite donc ce qu'il voit.

1. Dans le menu latéral (groupé par module, un groupe repliable par module ; le groupe de la page courante est ouvert), déplier les groupes un à un et relever les entrées.
2. Cliquer **« Modules »** dans l'en-tête : la liste des modules accessibles s'ouvre (le module courant est en gras).
3. Comparer avec la liste ci-dessous.

| Module (groupe du menu) | Entrées attendues |
| :--- | :--- |
| Pilotage | « Tableau de bord de la direction », « Indicateurs de direction », « Effectifs et présences », « Admissions », « Vie scolaire (agrégée) », « Pédagogie », « Scolarité », « Trésorerie », « Masse salariale », « Charges et résultat », « Comparaisons », « Alertes de direction », « Règles d'alerte » |
| Utilisateurs | « Utilisateurs » |
| Académique | « Années et périodes », « Programmes et niveaux », « Curriculum », « Classes », « Inscriptions », « Reconduction annuelle », « Paramètres académiques » |
| Personnes | « Élèves », « Parents et tuteurs », « Personnel », « Affectations » |
| Paie | « Masse salariale », « Bulletins de paie », « Configuration de la paie », « Historique des paiements », « Rapports de paie » |
| Emploi du temps | « Emplois du temps », « Salles et équipements », « Remplacements » |
| Pack Primaire | « Pack Primaire », « Conseil des maîtres », « Bilans annuels », « Archives d'année », « États du primaire » |
| Présences | « Suivi des appels », « Justificatifs d'absence », « Présence du personnel » |
| Bulletins | « Bulletins — émission », « Bulletins — liste », « Identité et signataires », « Modèles de documents » |
| Finance | « Facturation », « Encaissements », « Paiements en ligne », « Fournisseurs de paiement », « Paiements à rapprocher », « Webhooks en échec », « Caisse », « Frais et barèmes », « Tableau de bord financier » |
| Évaluations | « Feuilles à relire », « Corrections de notes », « Types d'évaluation » |
| Résultats | « Résultats de classe », « Périodes : verrouillage et clôture », « Délibérations » |
| Examens | « Examens », « Candidats aux examens », « Centres et salles », « Examens blancs », « Résultats d'examen », « Statistiques d'examen », « Exports d'examen », « Corrections d'examen » |
| Admissions | « Admissions », « Candidatures », « Prospects », « Listes d'attente », « Campagnes d'admission », « Parcours d'admission », « Recrutement : tableaux de bord », « Paramètres des admissions » |
| Communication | « Messages », « Annonces », « Modération des messages », « Paramètres de la messagerie » |
| Règles de calcul | « Règles de calcul » |
| Notifications | « Journal des notifications », « Gabarits de notification », « Règles et alertes », « Canaux d'envoi », « Mes notifications » |
| Documents | « Documents », « Documents à échéance », « Catégories de documents », « Quarantaine des documents », « Paramètres des documents » |
| Établissement | « Établissement » |
| Imports | « Imports Excel / CSV » |
| Journal d'audit | « Journal d'audit » |
| Accès et rôles | « Rôles et permissions », « Attributions de rôles » |

✅ Environ **96 entrées** dans **22 modules** *(le décompte exact et l'ordre des groupes sont à relever : l'ordre suit l'ordre de tri du menu, pas l'ordre alphabétique)*. Le module « Pack Primaire » est présent. **Absents** (parce que réservés à d'autres packs) : « Conseils de classe », « Vie scolaire » (module), « Affectés de l'État », « Enseignement supérieur ». Dans « Académique », il n'y a **pas** d'entrée « Offres de cours » (inscription à la carte, pack Supérieur). Quatre entrées déclarées par l'API sont volontairement masquées faute d'écran (« Paramètres de présence », « Paramètres des personnes », « Calendrier de l'établissement », « Validation des séances »).

⚠️ *Écart connu* : dans l'écran « Académique », la barre d'onglets « Cœur académique » propose quand même « Offres de cours » ; cet onglet mène à « L'inscription à la carte n'est pas incluse dans l'offre de l'établissement. » (attendu pour le pack Primaire).

📝 Les modules « Pack Primaire » (paramètres, compétences, conseil des maîtres, bilans) sont testés dans la partie dédiée au pack Primaire ; « Personnes » dans la partie « Personnes ».

☐ OK ☐ KO

### Étape 7 — Lire l'accueil de gestion (`/v2/home`) et tenter une page réservée à la plateforme
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Adresse `/v2/home`

1. Ouvrir `/v2/home`. Lire le titre, le texte, puis les cartes (une par module, le titre de la carte est un lien ; sous le titre, au plus 8 liens d'écrans).
2. Taper `/v2` dans la barre d'adresse.
3. Taper `/v2/platform/tenants` (console des opérateurs de la plateforme).

✅ Étape 1 : titre "Accueil · École Primaire Les Flamboyants" (nom de l'école), texte « Raccourcis vers les modules auxquels votre rôle donne accès. », 22 cartes environ ; la carte « Pilotage » montre 8 liens sur ses 13 entrées. Étape 2 : redirection vers `/v2/direction`. Étape 3 : redirection vers `/v2/platform/login` (connexion de la console plateforme) *(à vérifier)* ; **ne pas** s'y connecter : la console n'est pas accessible avec un compte d'école. Revenir ensuite à `/v2/home`.

🔒 *Test de droit* : le propriétaire d'une école n'est pas un opérateur de la plateforme (la permission de gestion des règles nationales lui est explicitement retirée).

☐ OK ☐ KO

### Étape 8 — Vérifier l'identité de l'école : profil, établissement et campus
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Établissement »** (`/v2/settings`)

1. Ouvrir « Établissement » : onglets « Profil et marque », « Établissements et campus », « Mise en service », « Abonnement et usage ». Lire « Profil et marque » : blocs « Identité », « Contact », « Marque », « Aperçu ».
2. Relever « Raison sociale », « Nom commercial », « Pays », « Personne à contacter », « E-mail », « Téléphone ».
3. Compléter l'adresse et la couleur de marque :

| Champ | Valeur à saisir |
| :--- | :--- |
| Adresse | `Cocody, Abidjan (adresse fictive)` |
| Couleur principale | `#B45309` |

4. Observer l'« Aperçu » (bandeau à la couleur principale avec le nom de l'école ; « Exemple de bouton »), cliquer **« Enregistrer le profil »**, puis recharger (F5).
5. Ouvrir l'onglet « Établissements et campus ».

✅ « Raison sociale » = `École Primaire Les Flamboyants` ; pays Côte d'Ivoire (CI) ; contact "Direction générale" avec l'e-mail du propriétaire *(valeurs reprises de la création de l'école, à confirmer)*. Message « Profil enregistré. » ; après rechargement, adresse et couleur sont conservées et l'en-tête prend la couleur. « Établissements et campus » : **un seul** établissement, `École Primaire Les Flamboyants`, badges "Primaire" et « Actif », texte « Code : primary · Pays : CI · Système éducatif : CI » ; en dépliant « Voir les campus de École Primaire Les Flamboyants » : un campus "Campus principal" avec le badge « Par défaut ».

⚠️ *Test d'erreur* : « Couleur principale » = `orange` → "Couleur hexadécimale attendue (ex. #1A73E8)." ; « Raison sociale » vidée puis **« Enregistrer le profil »** → « La raison sociale est obligatoire. ». Cliquer ensuite **« Annuler les modifications »**.

⚠️ Ne pas utiliser « Nouvel établissement » (un établissement ne se supprime pas) ni renseigner « Domaine personnalisé ».

☐ OK ☐ KO

### Étape 9 — Vérifier le pack et l'abonnement visibles pour le propriétaire
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Établissement »** > onglet **« Abonnement et usage »** (`/v2/settings/subscription`)

1. Lire le texte « Votre offre, les packs actifs et la consommation mesurée. Les changements d'offre sont gérés par l'équipe EcoleDigitale. » et le bloc de valeurs : « Offre », « Statut de l'abonnement », « Packs », « Tranche d'apprenants ».
2. Dans « Fonctionnalités actives », relever le total, puis déplier les modules `primary`, `analytics`, `academic` (chaque clé indique son origine : « Socle », « Offre » ou « Pack »).
3. Lire « Usage mesuré ».
4. Ouvrir l'onglet « Mise en service » (`/v2/settings/onboarding`) et lire la progression (sans rien modifier).

✅ « Offre » = `PROFESSIONAL` (clé affichée telle quelle) ; « Statut de l'abonnement » = « Actif » ; « Packs » = un seul badge "Primaire" ; « Tranche d'apprenants » = « Illimitée ». Aucun bouton de modification de l'abonnement n'existe côté école. Le module `primary` contient des clés comme `primary.competencies`, `primary.council`, `primary.annual-review`, `primary.year-archive`, `primary.reports` (origine « Pack ») ; `academic.rollover` est présent, mais `academic.a-la-carte` et `academic.state-assigned` sont absents ; il n'y a pas de module `councils`, `schoollife`, `stateassign` ni `higher`. « Usage mesuré » : « Aucun usage mesuré pour le moment. ». « Mise en service » : titre « Mise en service en cours », « Progression : 5 étape(s) sur 11 » ; les étapes « Compte propriétaire », « Établissement », « Pays et devise », « Type d'établissement », « Pack » sont « Terminée » ; « Année académique » est « À faire » (prochaine étape) ; « Import des élèves », « Enseignants » et « Finance » sont « Facultative » ; « Classes » et « Mise en production » affichent « Disponible une fois les étapes précédentes résolues. ».

⚠️ **Ne pas** cliquer sur « Passer en production » : l'action est définitive.

🕓 À jouer quand le compte **secrétariat** (ou tout autre rôle de gestion) existera : en ouvrant `/v2/settings/subscription`, la page s'ouvre mais les données sont refusées ("Action non autorisée.") ; l'abonnement est réservé au propriétaire.

☐ OK ☐ KO

### Étape 10 — Lire la sécurité du compte et les sessions
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 En-tête **« Mon compte »** > **« Sécurité du compte »** (`/v2/account/security`)

1. Cliquer **« Mon compte »** (en-tête) : lire le nom, l'e-mail et la ligne « Rôle actif : ».
2. Cliquer **« Sécurité du compte »**. Lire les deux blocs : « Mot de passe » et « Vérification en deux étapes ».
3. Revenir au menu « Mon compte » et cliquer **« Mes sessions »** (`/v2/account/sessions`).

✅ Étape 1 : « Rôle actif : Propriétaire » ; le menu propose « Sécurité du compte », « Mes sessions », « Mes notifications » mais **pas** « Mes établissements » (l'utilisateur n'a qu'une école) ni de changement de rôle. Étape 2 : le texte d'état dit « Activée : un code de votre application d'authentification est demandé à chaque connexion. » ; il n'y a pas de bouton « Activer », seulement « Désactiver… » ; le bloc « Mot de passe » a les champs « Mot de passe actuel », « Nouveau mot de passe » (indication « 12 caractères minimum, différent de l'ancien. »), « Confirmer le nouveau mot de passe », et le bouton « Changer le mot de passe » est inactif tant qu'ils sont vides. Étape 3 : « Mes sessions actives » liste au moins une session avec la mention « Cet appareil » et le bouton « Me déconnecter » ; un bouton « Déconnecter tous mes appareils » est présent.

⚠️ Ne pas cliquer sur « Désactiver… » ni changer le mot de passe : le mot de passe et le secret MFA de ce compte de test sont gérés par le script de création de l'école.

☐ OK ☐ KO

### Étape 11 — Se déconnecter puis se reconnecter
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 En-tête **« Se déconnecter »**, puis `/v2/login`

1. Cliquer **« Se déconnecter »** (en haut à droite).
2. Observer l'adresse affichée, puis taper à la main `/v2/direction`.
3. Taper `/v2/login`, cliquer le compte « Propriétaire » du panneau, **« Afficher le code MFA »**, **« Se connecter »**, puis **« Valider »**.
4. Une fois sur le tableau de bord, ouvrir un second onglet sur `/v2/academic/years`, puis revenir au premier onglet.

✅ Étape 1 : retour sur `/login` (sans panneau de comptes). Étape 2 : redirection vers la page de connexion (`/login`) ; aucune donnée de l'école n'est visible. Étape 3 : arrivée sur `/v2/direction`. Étape 4 : le second onglet partage la session et s'ouvre directement (page « Années académiques »).

⚠️ *Test d'erreur* : après une déconnexion, le bouton « Précédent » du navigateur ne doit pas réafficher de données de l'école sans reconnexion *(à vérifier)*.

☐ OK ☐ KO

## Phase 2 — Structure académique de l'école

Objectif : poser le squelette scolaire de l'école avec le seul compte propriétaire : réglages académiques, année **2026-2027** (créée, ouverte, courante), plan de périodes et première période ouverte, programmes et niveaux du pack Primaire, matières et curriculum, puis les trois classes (`Grande Section A`, `CP1 A`, `CM2 A`).

Précondition : phase *Première connexion et visite de l'école vide* jouée, propriétaire connecté dans la fenêtre **A**. Les années, programmes et classes ne se suppriment pas : on ne crée que ce qui est prévu. Ne **pas** traiter ici l'affectation des instituteurs titulaires (partie « Personnes ») ni les paramètres du pack Primaire (partie « Pack Primaire »).

Ce que le pack Primaire a déjà posé (modèle de pack `CI` / `PRIMARY`, instancié à la création de l'école) : deux cycles ("Maternelle", "Primaire"), neuf niveaux (Petite Section, Moyenne Section, Grande Section, puis CP1, CP2, CE1, CE2, CM1, CM2), deux programmes (`MATERNELLE` "Enseignement préscolaire" et `PRIMAIRE` "Enseignement primaire"), les types de périodes, deux plans de périodes ("Trois trimestres", "Deux semestres"), les financements, les issues de fin d'année et une politique d'inscription « Automatique ». **Aucune matière, aucune année, aucun curriculum, aucune classe.**

### Étape 12 — Lire les paramètres académiques posés par le pack
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Académique »** > **« Paramètres académiques »** (`/v2/academic/settings`)

1. Ouvrir « Paramètres académiques » (titre de l'écran : « Paramètres académiques »). Lire les rubriques : « Périodes », « Niveaux », « Statuts et financements », « Inscriptions », « Numérotation », « Calendrier ».
2. Rubrique « Périodes » : lire « Types de périodes » puis « Plans de périodes ».
3. Rubrique « Niveaux » : lire « Cycles d'enseignement » puis « Niveaux ».
4. Rubrique « Inscriptions » : lire « Confirmation des inscriptions ».
5. Rubrique « Numérotation » : lire « Numéro d'inscription » (champs « Motif du numéro d'inscription » et « Préfixe »).
6. Rubrique « Calendrier » : lire le message de la rubrique.

✅ Étape 2 : types "Trimestre", "Semestre", "Composition", "Module", "Session normale", "Session de rattrapage" ; plans "Trois trimestres" (3 périodes) et "Deux semestres" (2 périodes). Étape 3 : cycles "Maternelle" et "Primaire" ; niveaux "Petite Section", "Moyenne Section", "Grande Section", "CP1", "CP2", "CE1", "CE2", "CM1", "CM2" ("CM2" porte « Niveau final »). Étape 4 : l'option « Automatique » est choisie (une inscription est confirmée dès sa création, sans condition de paiement). Étape 5 : champs vides (le serveur applique sa numérotation par défaut). Étape 6 : « Aucune année académique. » et "Créez d'abord une année dans « Années et périodes ». " (l'année n'existe pas encore).

⚠️ *Test d'erreur* (sans enregistrer) : dans « Numérotation », saisir le motif `{FOO}` : l'aperçu signale « Jeton inconnu » et « Le motif contient un jeton inconnu ou une accolade isolée : le serveur le refusera. » ; vider le champ ensuite. Ne rien enregistrer ici.

📝 Pourquoi on ne change rien : la politique « Automatique » convient au test (les inscriptions saisies plus tard sont confirmées tout de suite).

☐ OK ☐ KO

### Étape 13 — Lire la liste vide des années puis créer l'année 2026-2027
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Académique »** > **« Années et périodes »** (`/v2/academic/years`)

1. Ouvrir « Années et périodes » : titre « Années académiques ». Lire l'état vide, puis la barre d'onglets « Cœur académique ».
2. Cliquer **« Nouvelle année »**. Faire d'abord l'essai refusé : tout vide, cliquer **« Nouvelle année »** (bouton de validation de la fenêtre « Créer une année académique »).
3. Saisir :

| Champ | Valeur à saisir |
| :--- | :--- |
| Code | `2026-2027` |
| Libellé | `Année scolaire 2026-2027` |
| Début | `07/09/2026` |
| Fin | (laisser vide : douze mois pleins par défaut) |

4. Cliquer **« Nouvelle année »** (validation).
5. Recharger la page (F5).

✅ Étape 1 : « Aucune année académique. » avec « Créez la première année pour pouvoir définir ses périodes, ses classes et ses inscriptions. » ; onglets « Années et périodes », « Programmes », « Curriculum », « Classes », « Offres de cours », « Reconduction », « Paramètres ». Étape 2 : « Ce champ est obligatoire. » sous Code, Libellé et Début (le champ « Établissement » est masqué : l'école n'a qu'un établissement). Étape 4 : message « L'année Année scolaire 2026-2027 a été créée. » ; une ligne apparaît : "Année scolaire 2026-2027", code `2026-2027`, du 7 septembre 2026 au 6 septembre 2027, état « Brouillon », sans badge « Courante » ; boutons « Périodes », « Ouvrir », « Modifier ». Aucun bouton de suppression. Étape 5 : la ligne est conservée.

⚠️ *Test d'erreur* : rouvrir « Nouvelle année » puis tester : code `2026-2027`, libellé `Doublon`, début `07/09/2027` → "Ce code d'année existe déjà dans l'établissement." ; code `TEST-TROU`, libellé `Avec un trou`, début `01/10/2027` → "L'année laisse un trou de 24 jour(s) avec l'année précédente." ; code `TEST-FIN`, libellé `Fin avant début`, début `07/09/2027`, fin `01/09/2027` → "La fin de l'année doit suivre son début." ; code `TEST-CHEV`, libellé `Chevauchement`, début `01/12/2026` → "L'année chevauche une autre année de l'établissement.". Annuler à chaque fois (aucune de ces années ne doit être créée).

📝 Choix de la date de fin : on laisse « Fin » vide, l'année dure alors douze mois pleins (jusqu'au 6 septembre 2027). Le système interdit les trous et les chevauchements entre années : l'année suivante devra donc commencer le 7 septembre 2027. Les dates d'une année se modifient avec « Modifier » tant qu'elle n'est pas close, si l'on veut un calendrier plus réaliste (ne pas le faire ici : les dates des périodes ci-dessous en dépendent).

🕓 À jouer quand le compte **directeur des études** existera : il voit les mêmes écrans (années, programmes, curriculum, classes) mais pas « Reconduction » ; l'**instituteur** reçoit « Accès refusé » sur `/v2/academic/years`.

☐ OK ☐ KO

### Étape 14 — Générer les périodes de l'année depuis un plan (trimestres)
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 **« Années et périodes »** > bouton **« Périodes »** de la ligne "Année scolaire 2026-2027"

Choix du plan : le modèle de pack Primaire propose deux plans, "Trois trimestres" (`THREE_TERMS`) et "Deux semestres" (`TWO_SEMESTERS`), tous deux à poids égaux. On retient **"Trois trimestres"** : c'est le découpage de l'école primaire ivoirienne (bulletin et conseil des maîtres par trimestre) ; le contrat de calcul du primaire (`coef-period@1`) pèse les périodes par les poids du plan.

1. Cliquer **« Périodes »** sur la ligne de l'année : le panneau « Périodes de Année scolaire 2026-2027 » s'ouvre. Lire l'état vide.
2. Cliquer **« Générer depuis un plan »**. Cliquer d'abord **« Générer depuis un plan »** (bouton de la fenêtre) sans rien choisir.
3. Choisir dans « Plan de périodes » : "Trois trimestres" ; lire l'encadré qui annonce les périodes ; cliquer **« Générer depuis un plan »**.
4. Lire la « Frise de l'année » et le tableau.
5. Refaire l'opération (plan "Trois trimestres" une seconde fois).

✅ Étape 1 : « Aucune période pour cette année. » avec « Ajoutez les périodes une à une ou générez-les depuis un plan. ». Étape 2 : « Choisissez un plan de périodes. ». Étape 3 : l'encadré dit "3 périodes seront créées :" (Trimestre 1, Trimestre 2, Trimestre 3) ; message "3 périodes ont été générées.". Étape 4 : trois périodes de type "Trimestre" à l'état « Planifiée », sans trou :

| Période | Dates attendues |
| :--- | :--- |
| Trimestre 1 | du 7 septembre 2026 au 5 janvier 2027 |
| Trimestre 2 | du 6 janvier au 7 mai 2027 |
| Trimestre 3 | du 8 mai au 6 septembre 2027 |

(répartition en trois parts égales de 365 jours : 121, 122 et 122 jours ; relever les dates affichées en cas de différence). Étape 5 : refus "L'année a déjà des périodes de ces types : supprimez-les (si elles sont encore planifiées) avant d'appliquer le plan.".

📝 Le plan "Deux semestres" donnerait 7 septembre 2026 → 7 mars 2027 puis 8 mars → 6 septembre 2027 ; ne pas l'appliquer ici.

☐ OK ☐ KO

### Étape 15 — Ouvrir l'année, la définir comme courante, ouvrir la première période
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 **« Années et périodes »** (`/v2/academic/years`)

1. Sur la ligne "Année scolaire 2026-2027" (état « Brouillon »), cliquer **« Périodes »**. Faire d'abord l'essai refusé : sur la ligne "Trimestre 1", cliquer **« Ouvrir »**.
2. Sur la ligne de l'année, cliquer **« Ouvrir »**.
3. Sur la ligne de l'année (état « Ouverte »), cliquer **« Définir comme courante »**.
4. Dans le panneau des périodes, ligne "Trimestre 1" : cliquer **« Ouvrir »**.
5. Relire la liste des années et le tableau des périodes ; recharger (F5).

✅ Étape 1 : refus "Ouvrez l'année avant d'ouvrir ses périodes." (la période reste « Planifiée »). Étape 2 : message « L'année Année scolaire 2026-2027 est ouverte. » ; état « Ouverte ». Étape 3 : message « L'année Année scolaire 2026-2027 est désormais l'année courante. » ; badge « Courante » à côté de « Ouverte ». Étape 4 : message « La période Trimestre 1 est ouverte. » ; "Trimestre 1" passe à « Ouverte » (frise colorée en vert), "Trimestre 2" et "Trimestre 3" restent « Planifiée ». Étape 5 : états conservés ; pour "Trimestre 1", les boutons proposés sont « Clore les notes » et « Clore » (**ne pas cliquer** : la clôture d'une période se joue en fin de parcours).

📝 Le bouton « Clôturer » de l'année (réservé au propriétaire et à la direction) n'est affiché que sur une année ouverte : ne **pas** l'utiliser.

☐ OK ☐ KO

### Étape 16 — Lire les programmes et les niveaux du pack Primaire
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Académique »** > **« Programmes et niveaux »** (`/v2/academic/programs`)

1. Lire l'écran « Programmes et séries » : bloc « Arborescence des programmes ».
2. Cliquer le programme `MATERNELLE`, lire le détail et la liste « Niveaux couverts ».
3. Cliquer le programme `PRIMAIRE`, lire le détail et la liste « Niveaux couverts ».

✅ Deux programmes de premier niveau : "Enseignement préscolaire" (`MATERNELLE`) et "Enseignement primaire" (`PRIMAIRE`). Détail `MATERNELLE` : « Nature » `PROGRAM`, « Cycle diplômant » = « Non », « Contrat de calcul des résultats » = « Hérité du niveau d'enseignement : competency-period@1 » ; « Niveaux couverts » : cases cochées "Petite Section" (PS), "Moyenne Section" (MS), "Grande Section" (GS). Détail `PRIMAIRE` : contrat « Hérité du niveau d'enseignement : coef-period@1 » ; niveaux cochés "CP1", "CP2", "CE1", "CE2", "CM1", "CM2". Les trois classes du jeu de données utiliseront `GS` (programme `MATERNELLE`) et `CP1`, `CM2` (programme `PRIMAIRE`) : **tous trois existent**, aucun écart avec le brief.

⚠️ *Test d'erreur* : cliquer **« Nouveau programme »**, ne rien saisir et cliquer **« Nouveau programme »** (validation) → « Ce champ est obligatoire. » sous Code, Libellé et Niveau d'enseignement ; puis code `MATERNELLE`, libellé `Doublon`, niveau d'enseignement "Maternelle" → "Ce code de programme existe déjà dans l'établissement.". Fermer la fenêtre sans créer de programme.

☐ OK ☐ KO

### Étape 17 — Créer les versions de curriculum (brouillons) des deux programmes
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Académique »** > **« Curriculum »** (`/v2/academic/curriculum`)

1. Ouvrir « Curriculum » (titre « Éditeur de curriculum »). Avant tout choix : lire « Choisissez un programme et une année pour afficher son curriculum. ».
2. Dans « Programme », choisir "Enseignement primaire (PRIMAIRE)" ; dans « Année », "Année scolaire 2026-2027". Cliquer **« Créer une version vide »**.
3. Cliquer **« Rapport de validation »**.
4. Dans « Programme », choisir "Enseignement préscolaire (MATERNELLE)" (année inchangée). Cliquer **« Créer une version vide »**.

✅ Étape 2 : « Aucun curriculum pour ce programme cette année. » avec « Créez une version vierge ou clonez celle d'une autre année depuis un curriculum existant. » ; puis « La version a été créée. », bloc « Version du curriculum » avec la pastille « Brouillon » et "Aucun nœud", arbre vide (« Le curriculum est vide : ajoutez un premier nœud à la racine. ») et bouton « Ajouter à la racine ». Étape 3 : rapport « 1 erreur et 6 avertissements à corriger avant publication. » avec, parmi les lignes, l'erreur "Le curriculum ne contient aucun nœud." (les 6 avertissements sont les six niveaux couverts par le programme, qui n'ont encore aucun nœud). Étape 4 : même constat pour le programme préscolaire (rapport éventuel : 1 erreur et 3 avertissements).

☐ OK ☐ KO

### Étape 18 — Constater qu'aucun écran ne permet de créer une matière
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 **« Curriculum »**, programme "Enseignement préscolaire (MATERNELLE)", année "Année scolaire 2026-2027"

Les matières (Français, Mathématiques…) forment un catalogue propre à l'école, vide au départ. Le code fournit le service de création (`POST /api/v1/academic/subjects`) mais **aucun écran ne l'appelle** ; la seule voie par l'interface est l'**import "Matières et curriculum"** (étapes suivantes).

1. Cliquer **« Ajouter à la racine »**. Dans la fenêtre « Ajouter à la racine », « Type de nœud » : le seul choix doit être « Niveau ».
2. Saisir :

| Champ | Valeur à saisir |
| :--- | :--- |
| Type de nœud | Niveau |
| Code | `GS` |
| Libellé | `Grande Section` |
| Niveau | Grande Section |

3. Cliquer **« Ajouter »**.
4. Le nœud `GS` étant sélectionné, cliquer **« Ajouter un enfant »** (fenêtre « Ajouter sous Grande Section »). Choisir « Type de nœud » = « Matière » : un champ « Matière » (recherche) apparaît. Taper `Fran` dans « Matière ».
5. Sans choisir de matière, saisir Code `GS-TEST`, Libellé `Test` et cliquer **« Ajouter »**.
6. Fermer la fenêtre.

✅ Étape 3 : message « Le nœud Grande Section a été ajouté. » ; l'arbre montre « Niveau Grande Section GS ». Étape 4 : la recherche `Fran` ne propose **aucune matière** (catalogue vide) *(texte exact de la liste vide : à relever)*. Étape 5 : refus (message du serveur, à relever) ; aucun nœud `GS-TEST` n'est créé.

⚠️ *Écart connu* : il n'existe aucun écran « Matières » (création, modification, désactivation) dans l'interface ; sans l'import, un curriculum primaire ne peut pas contenir de matière.

☐ OK ☐ KO

### Étape 19 — Importer les matières et le curriculum du programme Enseignement primaire
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Imports »** > **« Imports Excel / CSV »** (`/v2/imports`)

Préparer d'abord le fichier : dans un éditeur de texte, créer `flamboyants-matieres-primaire.csv` (encodage UTF-8) avec exactement ces lignes. Les coefficients sont des valeurs de test.

```
Code du noeud,Libellé,Type de noeud (code),Code du parent,Code de la matière,Niveau (code),Coefficient,Ordre d'affichage,Obligatoire
CP1,CP1,LEVEL,,,CP1,,1,oui
CP1-FRANC,Français,SUBJECT,CP1,FRANC,,4,1,oui
CP1-MATHS,Mathématiques,SUBJECT,CP1,MATHS,,4,2,oui
CP1-EVEIL,Éveil / Sciences,SUBJECT,CP1,EVEIL,,2,3,oui
CP1-EPS,Éducation physique et sportive,SUBJECT,CP1,EPS,,1,4,oui
CM2,CM2,LEVEL,,,CM2,,2,oui
CM2-FRANC,Français,SUBJECT,CM2,FRANC,,4,1,oui
CM2-MATHS,Mathématiques,SUBJECT,CM2,MATHS,,4,2,oui
CM2-EVEIL,Éveil / Sciences,SUBJECT,CM2,EVEIL,,2,3,oui
CM2-EPS,Éducation physique et sportive,SUBJECT,CM2,EPS,,1,4,oui
```

1. Ouvrir « Imports Excel / CSV » puis l'onglet « Nouvel import » (`/v2/imports/new`, titre « Importer des données »). Cliquer d'abord **« Envoyer et continuer »** sans rien choisir.
2. Étape « Fichier » : choisir l'importeur **"Matières et curriculum"** (lire le bloc "Colonnes attendues pour Matières et curriculum"), choisir le fichier `flamboyants-matieres-primaire.csv`, cliquer **« Envoyer et continuer »**.
3. Étape « Colonnes » : vérifier que chaque colonne du fichier est associée au champ du même nom (la proposition automatique doit être complète). Dans « Options de l'import », choisir "Version de curriculum (brouillon)" = la version "Enseignement primaire — brouillon (0 noeud(s))". Laisser « Ignorer les lignes déjà présentes ». Cliquer **« Enregistrer et valider le fichier »**.
4. Étape « Validation » puis « Aperçu » : attendre la fin (quelques secondes ; le travail est fait en tâche de fond par le worker). Lire les décomptes.
5. Cocher « J'ai consulté l'aperçu et les erreurs, et je confirme le lancement de l'import. » (mode « Importer les lignes valides seulement »), cliquer **« Lancer l'import »**.
6. Étape « Import » puis « Rapport » : lire le rapport.
7. Revenir dans « Curriculum » (programme "Enseignement primaire (PRIMAIRE)", année "Année scolaire 2026-2027") et déplier l'arbre.

✅ Étape 1 : « Choisissez le type de données à importer. » et « Choisissez un fichier .xlsx, .xls, .ods ou .csv. ». Étape 3 : si l'option "Version de curriculum (brouillon)" est laissée vide, « Cette option est obligatoire. ». Étape 4 : « À créer » = 10, « À mettre à jour » = 0, « À ignorer » = 0, « En erreur » = 0, « Avertissements » = 8 *(un par ligne de type SUBJECT, avec le texte "La matière « FRANC » n'existe pas : elle sera créée à partir du libellé." ; les décomptes exacts sont à relever)* ; « Aucune erreur : toutes les lignes sont valides. ». Étape 6 : « Import terminé » avec 10 lignes créées. Étape 7 : version « Brouillon », "10 nœuds" ; deux nœuds « Niveau » (`CP1`, `CM2`) ayant chacun quatre nœuds « Matière » (Français coef. 4, Mathématiques coef. 4, Éveil / Sciences coef. 2, Éducation physique et sportive coef. 1). Quatre matières ont été créées dans le catalogue (`FRANC`, `MATHS`, `EVEIL`, `EPS`).

⚠️ *Test d'erreur (facultatif)* : rejouer le même fichier (nouvel import) avec « Ignorer les lignes déjà présentes » : l'aperçu annonce « À ignorer » = 10 et le bouton « Lancer l'import » reste inactif (rien à écrire) *(à vérifier)*.

📝 Le worker doit tourner (`pnpm dev:v2` le lance). Si l'étape « Validation » ne se termine pas au bout d'une minute, vérifier la console du worker.

☐ OK ☐ KO

### Étape 20 — Importer les matières de la Grande Section et compléter le curriculum à la main
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 **« Imports Excel / CSV »** (`/v2/imports/new`), puis **« Curriculum »**

Fichier `flamboyants-matieres-gs.csv` (UTF-8) : le nœud `GS` existe déjà (créé à l'étape précédente), les lignes s'y rattachent par `GS`. `EVEIL` existe déjà dans le catalogue ; `LANGAGE` est nouvelle.

```
Code du noeud,Libellé,Type de noeud (code),Code du parent,Code de la matière,Niveau (code),Coefficient,Ordre d'affichage,Obligatoire
GS-LANGAGE,Langage oral,SUBJECT,GS,LANGAGE,,1,1,oui
GS-EVEIL,Éveil / Sciences,SUBJECT,GS,EVEIL,,1,2,oui
```

1. Refaire l'import comme à l'étape *Importer les matières et le curriculum du programme Enseignement primaire* (importeur "Matières et curriculum", fichier `flamboyants-matieres-gs.csv`) avec, dans "Version de curriculum (brouillon)", la version "Enseignement préscolaire — brouillon (1 noeud(s))".
2. Lire l'aperçu, confirmer, lancer, lire le rapport.
3. Dans « Curriculum » (programme "Enseignement préscolaire (MATERNELLE)", année "Année scolaire 2026-2027"), sélectionner le nœud `GS`, cliquer **« Ajouter un enfant »** et saisir :

| Champ | Valeur à saisir |
| :--- | :--- |
| Type de nœud | Matière |
| Code | `GS-EPS` |
| Libellé | `Éducation physique et sportive` |
| Matière | taper `physique`, choisir "Éducation physique et sportive" (code `EPS`) |
| Coefficient | `1` |

4. Cliquer **« Ajouter »**.
5. Cliquer **« Rapport de validation »**.

✅ Étape 2 : « À créer » = 2, « Avertissements » = 1 (seule `LANGAGE` est inconnue) ; rapport « Import terminé ». Étape 3 : la recherche de matière propose maintenant les matières du catalogue. Étape 4 : message « Le nœud Éducation physique et sportive a été ajouté. ». Étape 5 : « Le curriculum est valide (2 avertissements). » (les niveaux "Petite Section" et "Moyenne Section", couverts par le programme, n'ont aucun nœud). Arbre final : "4 nœuds" (`GS` et ses trois matières).

⚠️ *Test d'erreur* : ajouter un second nœud de code `GS-EPS` sous `GS` → "Ce code existe déjà parmi les nœuds frères." ; coefficient `abc` → "Décimal attendu (ex. 2 ou 2.5).". Fermer sans créer.

☐ OK ☐ KO

### Étape 21 — ⚠️ Irréversible : valider et publier les deux curriculums
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 **« Curriculum »** (`/v2/academic/curriculum`)

1. Programme "Enseignement primaire (PRIMAIRE)", année "Année scolaire 2026-2027" : cliquer **« Rapport de validation »**.
2. Cliquer **« Publier »** ; dans la fenêtre « Publier cette version » (« Une version publiée sert de référence aux classes, aux offres et aux notes. Elle ne pourra plus être modifiée que par amendement motivé. »), cliquer **« Publier »**.
3. Refaire les points 1 et 2 pour "Enseignement préscolaire (MATERNELLE)".
4. Pour chaque version publiée, sélectionner un nœud et constater que les boutons d'édition ont disparu.

✅ Étape 1 : « Le curriculum est valide (4 avertissements). » (CP2, CE1, CE2 et CM1, couverts par le programme, n'ont pas de nœud ; ils sont affichés par identifiant). Étape 2 : « La version est publiée. » ; mention « Publiée le … », pastille « Publiée » et texte « Cette version est publiée : elle ne se modifie plus directement. Un amendement motivé et journalisé est possible. ». Étape 3 : même résultat avec « Le curriculum est valide (2 avertissements). ». Étape 4 : plus de « Ajouter un enfant » ni de « Ajouter à la racine » ; l'historique « Historique des amendements » indique « Aucun amendement. ».

☐ OK ☐ KO

### Étape 22 — Créer les trois classes : Grande Section A, CP1 A, CM2 A
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Académique »** > **« Classes »** (`/v2/academic/classrooms`)

1. Ouvrir « Classes ». Cliquer **« Nouvelle classe »** (fenêtre « Créer une classe »). Faire d'abord l'essai refusé : ne rien saisir et cliquer **« Nouvelle classe »** (validation).
2. Créer la première classe :

| Champ | Valeur à saisir |
| :--- | :--- |
| Année | Année scolaire 2026-2027 |
| Programme | Enseignement préscolaire |
| Niveau | Grande Section |
| Curriculum | Version publiée 1 (4 nœuds) |
| Code | `GS-A` |
| Nom | `Grande Section A` |
| Nature | Classe |
| Capacité | `25` |
| Capacité bloquante | décochée |

3. Cliquer **« Nouvelle classe »** (validation). Recommencer pour les deux autres classes :

| Champ | CP1 A | CM2 A |
| :--- | :--- | :--- |
| Année | Année scolaire 2026-2027 | Année scolaire 2026-2027 |
| Programme | Enseignement primaire | Enseignement primaire |
| Niveau | CP1 | CM2 |
| Curriculum | Version publiée 1 (10 nœuds) | Version publiée 1 (10 nœuds) |
| Code | `CP1-A` | `CM2-A` |
| Nom | `CP1 A` | `CM2 A` |
| Capacité | `35` | `40` |

4. Lire la liste, puis filtrer « Année » = "Année scolaire 2026-2027" et « Programme » = "Enseignement primaire".

✅ Étape 1 : « Ce champ est obligatoire. » sous Année, Programme, Niveau, Code et Nom. Chaque création : message « La classe Grande Section A a été créée. » (puis « La classe CP1 A a été créée. », « La classe CM2 A a été créée. »). Liste « Classes et promotions » : trois lignes à l'état **« Brouillon »**, colonnes « Classe », « Code », « Programme », « Niveau », « Effectif » : `Grande Section A` / `GS-A` / Enseignement préscolaire / Grande Section / `0 / 25` ; `CP1 A` / `CP1-A` / `0 / 35` ; `CM2 A` / `CM2-A` / `0 / 40`. Avec le filtre « Programme » = "Enseignement primaire", seules `CP1 A` et `CM2 A` restent. Le niveau proposé dépend du programme choisi : "Enseignement préscolaire" ne propose que Petite, Moyenne et Grande Section.

⚠️ *Test d'erreur* : refaire une création "Enseignement primaire" / "CP1" avec le code `CP1-A` et le nom `Autre` → "Ce code de classe existe déjà pour ce programme et ce niveau." ; avec le code `CP1-B` et le nom `CP1 A` → "Ce nom de classe existe déjà pour ce programme et ce niveau." ; avec le code `CP1 B` (espace) → "Code en majuscules (A-Z, 0-9, _ . -), 40 caractères max.". Annuler à chaque fois.

☐ OK ☐ KO

### Étape 23 — Ouvrir une classe et tenter de l'activer sans titulaire
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 **« Classes »** > fiche de `CP1 A`

1. Cliquer le nom `CP1 A` dans la liste.
2. Lire la fiche : en-tête, bloc d'état, sections « Élèves » et « Enseignants ».
3. Cliquer **« Activer »**. Dans la fenêtre « Activer CP1 A » (« L'activation ouvre la classe aux inscriptions et à la scolarité. »), cliquer **« Activer »**.
4. Fermer la fenêtre (« Annuler »), vérifier l'état de la classe.

✅ Étape 2 : sous-titre "CP1-A — Enseignement primaire — CP1" ; « État » = « Brouillon » ; « Année » = "Année scolaire 2026-2027" ; « Effectif » = « 0 sur 35 » ; « Capacité » = « Indicative » ; « Élèves » : « Aucun élève inscrit dans cette classe. » (bouton « Inscrire un élève ») ; « Enseignants » : « Aucune affectation d'enseignement. » (bouton « Gérer les affectations »). Boutons d'action : « Activer » et « Annuler la classe ». Étape 3 : **refus** avec le message "Une classe du primaire ne s'active qu'avec un instituteur titulaire : affectez-en un d'abord.". Étape 4 : la classe reste « Brouillon ».

⚠️ *Écart possible à signaler* : si la classe devient « Active » sans titulaire, la garde du pack Primaire n'est pas appliquée (réglage de l'établissement exigeant un titulaire désactivé ?) : noter KO avec le message affiché.

📝 Les trois classes restent en « Brouillon » jusqu'à la partie « Personnes » : elles seront activées **après** l'affectation de chaque instituteur titulaire (KOFFI Adjoua en `CP1 A`, BAMBA Séraphin en `CM2 A`, ZOKORA Sylvie en `Grande Section A`). Une classe en brouillon accepte déjà les inscriptions.

🕓 À jouer quand le compte **instituteur** (ou institutrice de maternelle) existera : « Ma classe » affichera la classe dont il est titulaire (voir la partie « Pack Primaire »).

☐ OK ☐ KO

### Étape 24 — Marquer les étapes de mise en service « Année académique » et « Classes »
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Établissement »** > onglet **« Mise en service »** (`/v2/settings/onboarding`)

Ces deux étapes ne se cochent pas toutes seules : le propriétaire les marque à la main une fois le travail fait.

1. Ouvrir « Mise en service ». Sur la ligne « Année académique », cliquer **« Marquer comme terminée »**.
2. Sur la ligne « Classes » (désormais disponible), cliquer **« Marquer comme terminée »**.
3. Lire la progression.

✅ Étape 1 : message « Étape mise à jour. » ; « Année académique » passe à « Terminée » avec « Terminée le … ». Étape 2 : « Classes » passe à « Terminée ». Étape 3 : « Progression : 7 étape(s) sur 11 » ; "Prochaine étape :" reste sur une étape facultative ou « Mise en production » selon l'ordre *(relever)*. « Passer en production » reste à ne **pas** utiliser tant que la recette n'est pas terminée (action définitive).

📝 Les étapes « Import des élèves » et « Enseignants » se complètent d'elles-mêmes à la fin d'un import réussi d'élèves ou d'enseignants (parties suivantes).

☐ OK ☐ KO

**Ce que la phase laisse dans l'application :**
- Année `2026-2027` "Année scolaire 2026-2027" (7 septembre 2026 → 6 septembre 2027), **ouverte** et **courante**, avec trois trimestres : "Trimestre 1" **ouverte**, "Trimestre 2" et "Trimestre 3" planifiées.
- Catalogue de matières : `FRANC`, `MATHS`, `EVEIL`, `EPS`, `LANGAGE`.
- Curriculum `PRIMAIRE` (10 nœuds : `CP1`, `CM2` et leurs quatre matières) et curriculum `MATERNELLE` (4 nœuds : `GS` et trois matières), tous deux **publiés** pour 2026-2027.
- Classes `Grande Section A` (`GS-A`, capacité 25), `CP1 A` (`CP1-A`, 35) et `CM2 A` (`CM2-A`, 40), toutes en « Brouillon », sans élève ni titulaire.
- Mise en service : « Année académique » et « Classes » terminées.
- Profil de l'école : adresse `Cocody, Abidjan (adresse fictive)` et couleur principale `#B45309`.

## Phase 3 — Pack Primaire : réglages, modèle de pack, échelles et référentiels de compétences

Objectif : configurer le pack Primaire de l'**École Primaire Les Flamboyants** avec le seul compte **propriétaire**, sur l'écran « Paramètres du pack Primaire » (`/v2/primary/parametres`) : réglages de l'établissement, modèle de pack, échelle d'appréciation personnalisée, référentiel de compétences (brouillon, structure, publication, nouvelle version). Le propriétaire détient toutes les permissions `primary.*` (son rôle porte le droit « tout », sauf la console plateforme) : aucune étape de cette phase n'est refusée à ce compte. Les gestes **sensibles** (modèle de pack, publication) exigent une session MFA, ce que le propriétaire a. Si un refus de type « authentification forte requise » apparaît, noter son texte exact.

Précondition : le compte propriétaire est connecté (voir l'étape de connexion de la partie 1). Cette phase peut se jouer **avant** la création de l'année et des classes : seules l'étape *Effet du réglage « titulaire » sur l'activation d'une classe* et, plus loin, les filtres « Niveau de classe » des appréciations exigent que les classes existent. À savoir : les pages affichent brièvement « Établissement inconnu » ou « Cette fonctionnalité n'est pas incluse dans l'offre de votre établissement. » pendant le chargement ; **attendre 3 à 4 secondes** avant de juger. Les bandeaux « Règles de démonstration » ne s'affichent que si l'établissement a des classes liées à un jeu de règles fictif : sur une école encore vide, leur absence n'est pas un défaut.

### Étape 25 — Ouvrir « Paramètres du pack Primaire » et lire l'état de départ
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > onglet **« Paramètres »** (`/v2/primary/parametres`)

1. Dans le menu, ouvrir **« Pack Primaire »** (page « Avancement des classes »). Lire la barre d'onglets « Pack Primaire » : le propriétaire voit les onglets « Ma classe », « Compétences », « Appréciations », « Conseil des maîtres », « Avancement », « Bilans annuels », « Archives », « États », « Paramètres » (et, car il détient tout, « Bulletin et compétences » *(à vérifier)*).
2. Cliquer l'onglet **« Paramètres »** et attendre 3 à 4 secondes.
3. Lire le titre « Paramètres du pack Primaire » et sa phrase « Réglages de l'établissement, modèle de pack, échelles d'appréciation et référentiels de compétences. ».
4. Lire la section **« Réglages de l'établissement »** et noter l'état des cases et champs.

| Réglage | État attendu au départ |
| :--- | :--- |
| « Exiger un titulaire pour activer une classe » | cochée (aide : « Si vous désactivez cette règle, l'action est auditée. ») |
| « Exiger la décision du conseil pour sceller un bilan » | cochée (aide : « Le bilan ne se scelle qu'avec la décision confirmée du conseil des maîtres. ») |
| « Activer la banque d'appréciations » | cochée |
| « Échelle d'appréciation par défaut » | « Aucune » ou "Niveaux de maîtrise (échelle de démonstration)" *(à relever : dépend de la façon dont l'école a été créée)* |
| « Durée de conservation des archives (années) » | vide (aide : « Laissez vide tant que la durée n'est pas fixée : aucune purge n'a alors lieu. ») |

5. Descendre : sections « Modèle de pack » (bouton « Appliquer le modèle de pack »), « Échelles d'appréciation » (bouton « Nouvelle échelle ») et « Référentiels de compétences » (bouton « Nouveau référentiel »).

✅ Les quatre sections sont présentes, avec leurs boutons (le propriétaire gère les réglages, le modèle, les échelles et les référentiels). Les valeurs du tableau sont celles par défaut du modèle de pack.

☐ OK ☐ KO

### Étape 26 — Enregistrer la durée de conservation des archives
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > onglet **« Paramètres »** (`/v2/primary/parametres`)

1. Dans « Durée de conservation des archives (années) », saisir `10`.
2. Cliquer **« Enregistrer les réglages »** (le bouton affiche « Enregistrement… » un instant).
3. Recharger la page (F5), attendre 3 à 4 secondes, relire le champ.
4. Vider le champ puis cliquer **« Enregistrer les réglages »** à nouveau (vide = durée non fixée, aucune purge).

✅ Au 2 : « Réglages enregistrés. ». Au 3 : le champ affiche `10`. Au 4 : « Réglages enregistrés. » ; après rechargement le champ est vide. (Dans le code, cette durée n'est qu'un réglage mémorisé : aucune purge d'archive n'existe encore.)

⚠️ *Test d'erreur* (cliquer « Enregistrer les réglages » à chaque saisie, puis vider le champ) :

| Saisie | Message attendu |
| :--- | :--- |
| `0` | "La valeur doit être supérieure ou égale à 0." *(texte exact à relever : message générique de borne)* |
| `201` | "La valeur doit être inférieure ou égale à 200." |
| `2.5` | « Valeur invalide. » *(à vérifier)* |

Aucun réglage n'est enregistré lors d'un refus.

☐ OK ☐ KO

### Étape 27 — Choisir l'échelle d'appréciation par défaut
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > onglet **« Paramètres »** (`/v2/primary/parametres`)

1. Ouvrir la liste **« Échelle d'appréciation par défaut »** : elle propose « Aucune » et les échelles actives (au départ, seulement "Niveaux de maîtrise (échelle de démonstration)").
2. Choisir "Niveaux de maîtrise (échelle de démonstration)" puis cliquer **« Enregistrer les réglages »**.
3. Recharger la page et relire la liste.
4. Choisir « Aucune », enregistrer, puis rechoisir "Niveaux de maîtrise (échelle de démonstration)" et enregistrer de nouveau (état de départ rétabli).

✅ « Réglages enregistrés. » à chaque enregistrement ; le choix survit au rechargement.

⚠️ *Écart connu* : dans le code, l'échelle par défaut n'est lue par aucun autre écran (ni la grille de compétences, ni la création de référentiel, qui demande toujours de choisir une échelle). Aucun effet visible ailleurs n'est donc attendu ; si vous en voyez un, le noter.

☐ OK ☐ KO

### Étape 28 — Essayer "Exiger la décision du conseil" et « Activer la banque d'appréciations »
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > onglet **« Paramètres »** (`/v2/primary/parametres`)

1. Décocher **« Exiger la décision du conseil pour sceller un bilan »**, cliquer **« Enregistrer les réglages »**, recharger : la case reste décochée.
2. Recocher la case, enregistrer, recharger : elle est cochée.
3. Décocher **« Activer la banque d'appréciations »**, enregistrer, recharger : la case reste décochée.
4. Ouvrir l'onglet **« Appréciations »** et noter si la banque de phrases est toujours affichée ; revenir sur **« Paramètres »**.
5. Recocher « Activer la banque d'appréciations » et enregistrer (état de départ rétabli).

✅ « Réglages enregistrés. » à chaque enregistrement. Au 4 : la banque reste affichée *(à vérifier)*.

⚠️ *Écart connu* : le code ne lit le réglage « Activer la banque d'appréciations » nulle part ailleurs que dans cet écran ; décocher la case ne masque donc rien *(à vérifier en observant l'étape 4)*.

🕓 À jouer en **fin d'année**, quand un bilan annuel sera prêt à sceller (acte réservé à un compte qui détient `primary.bilan.seal` : direction, ou le propriétaire) : case "Exiger la décision du conseil" cochée → le scellement est refusé tant que la décision du conseil n'est pas confirmée (« La décision du conseil des maîtres doit être confirmée avant de sceller. ») ; case décochée → ce manque n'empêche plus le scellement.

☐ OK ☐ KO

### Étape 29 — Désactiver puis rétablir « Exiger un titulaire pour activer une classe »
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > onglet **« Paramètres »** (`/v2/primary/parametres`)

1. Décocher **« Exiger un titulaire pour activer une classe »** et cliquer **« Enregistrer les réglages »**.
2. Recharger : la case reste décochée.
3. Recocher la case, enregistrer, recharger : elle est cochée.

✅ « Réglages enregistrés. » à chaque enregistrement. (Décocher cette règle est un acte **audité** à un niveau supérieur ; l'écran du journal d'audit n'est pas couvert par ce guide.)

☐ OK ☐ KO

### Étape 30 — Effet du réglage « titulaire » sur l'activation d'une classe
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Classes et promotions »** (`/v2/academic/classrooms`)

Précondition : une classe de maternelle ou de primaire (Grande Section A, CP1 A ou CM2 A) est encore en état « Brouillon », avec un curriculum publié choisi, et **aucun titulaire** affecté. Si les trois classes sont déjà actives, noter "non jouable" : l'effet est alors prouvé par l'ordre des étapes de la partie 1 (voir la note ci-dessous) et cette étape ne se rejoue que sur une classe supplémentaire.

1. Vérifier que, sous **« Paramètres »**, la case « Exiger un titulaire pour activer une classe » est **cochée**.
2. Ouvrir la classe en brouillon (liste « Classes et promotions », clic sur la ligne) et cliquer **« Activer »**, puis confirmer en cliquant de nouveau **« Activer »** dans la fenêtre qui s'ouvre (titre « Activer » suivi du nom de la classe).
3. Noter le message affiché dans la fenêtre.
4. Retourner sous **« Paramètres »**, décocher « Exiger un titulaire pour activer une classe », enregistrer (« Réglages enregistrés. »).
5. Rouvrir la classe, cliquer **« Activer »** et confirmer avec **« Activer »**.
6. Retourner sous **« Paramètres »**, recocher la case et enregistrer.

✅ Au 3 : refus « Une classe du primaire ne s'active qu'avec un instituteur titulaire : affectez-en un d'abord. » ; la classe reste « Brouillon ». Au 5 : « La classe {nom} est active. » (sans titulaire, dérogation assumée et auditée). Cette règle ne vise que les classes des cycles Maternelle et Primaire.

*Note pour le déroulé complet* : avec la règle cochée, **chaque classe du primaire doit avoir son titulaire (fiche du personnel puis affectation « Titulaire de classe ») avant d'être activée**. Soit on affecte les trois titulaires avant d'activer les trois classes, soit on décoche temporairement la règle comme ci-dessus.

🕓 Même refus, côté instituteur : sans objet (un instituteur ne peut pas activer de classe).

☐ OK ☐ KO

### Étape 31 — Appliquer le modèle de pack (première exécution)
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > onglet **« Paramètres »** (`/v2/primary/parametres`)

1. Lire la section **« Modèle de pack »** : « Crée les échelles, référentiels de démonstration et phrases du pack. Ne remplace jamais une donnée que vous avez personnalisée. ».
2. Cliquer **« Appliquer le modèle de pack »**. Lire la fenêtre « Appliquer le modèle de pack » : « Cette action sensible instancie les données de démonstration du pack Primaire pour votre établissement. ».
3. Cliquer **« Annuler »** : la fenêtre se ferme, aucun message n'apparaît.
4. Cliquer de nouveau « Appliquer le modèle de pack », puis **« Appliquer le modèle »**.

✅ Au 4 : sous le bouton, le message « Le modèle était déjà appliqué : rien n'a été modifié. » (le modèle est instancié à la création de l'école, ce que prouve la présence de l'échelle `MASTERY_4`). Seule autre issue possible si le modèle n'avait jamais été instancié : « Modèle appliqué : 1 échelles, 2 référentiels et 3 phrases créés. ».

Ce que crée le modèle (système éducatif CI, version 1 du modèle, **jeu fictif** marqué « Démonstration ») :

| Élément | Contenu |
| :--- | :--- |
| 1 échelle | `MASTERY_4` "Niveaux de maîtrise (échelle de démonstration)" : N1 "Non acquis", N2 « En cours d'acquisition », N3 « Acquis », N4 "Acquis avec aisance" (N3 et N4 : attendu atteint) |
| 2 référentiels (publiés) | `PRESCHOOL_DEMO` « Compétences de la maternelle (démonstration) » (niveaux PS, MS, GS ; domaines D1 : D1.1 et D1.2, D2 : D2.1) ; `PRIMARY_DEMO` « Compétences du primaire (démonstration) » (niveaux CP1 à CM2 ; domaine D1 : D1.1) |
| 3 phrases | `PERIOD_N1`, `PERIOD_N3` (portée Période), `YEAR_GENERIC` (portée Année) |
| Réglages | titulaire exigé, décision du conseil exigée, banque active, conservation vide, échelle par défaut = `MASTERY_4` (uniquement si aucun réglage n'existait déjà) |

☐ OK ☐ KO

### Étape 32 — Lire l'échelle et les référentiels de démonstration
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > onglet **« Paramètres »** (`/v2/primary/parametres`)

1. Dans **« Échelles d'appréciation »** (« Niveaux de maîtrise utilisés par les référentiels. Une échelle employée par un référentiel publié ne se modifie plus. »), lire la carte de `MASTERY_4`.
2. Dans **« Référentiels de compétences »**, repérer les deux lignes de démonstration, puis cliquer **« Ouvrir »** sur « Compétences de la maternelle (démonstration) ».
3. Lire le détail, puis cliquer **« Fermer »**. Ne pas cliquer « Créer une nouvelle version » sur un référentiel de démonstration.

✅ Au 1 : `MASTERY_4` avec les pastilles « Démonstration » et « Verrouillée » (un référentiel publié l'emploie) ; niveaux "N1 Non acquis" … "N3 Acquis (attendu atteint)", "N4 Acquis avec aisance (attendu atteint)". Au 2 : "Compétences de la maternelle (démonstration) version 1" avec « Publié », « Démonstration », "3 compétences" ; "Compétences du primaire (démonstration) version 1" avec « Publié », « Démonstration », « 1 compétence ». Au 3 : lignes « D1 — Domaine 1 (démonstration) » (sous-lignes « D1.1 — Compétence 1.1 (démonstration) », "D1.2 — …"), « D2 — Domaine 2 (démonstration) » ; « Niveaux de l'échelle : N1, N2, N3, N4 » ; « Référentiel publié : immuable. Créez une nouvelle version pour le modifier. ». Les seuls boutons du détail sont « Créer une nouvelle version » : ni « Modifier la structure », ni « Publier », ni « Supprimer le brouillon ».

⚠️ *Limite de l'écran* : les niveaux de classe auxquels un référentiel s'applique (PS, MS, GS pour la maternelle ; CP1 à CM2 pour le primaire) ne sont **pas affichés** dans le détail. Le lien référentiel ↔ classe se joue sur le **niveau de classe** de chaque classe (GS, CP1, CM2) : voir l'étape *Publier le référentiel* et la note qui la suit.

☐ OK ☐ KO

### Étape 33 — Refuser des échelles invalides
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > onglet **« Paramètres »** (`/v2/primary/parametres`)

1. Dans « Échelles d'appréciation », cliquer **« Nouvelle échelle »** (fenêtre « Nouvelle échelle »). Lire les aides : « Majuscules, chiffres et _ (2 à 40 caractères). » pour le code, « Niveaux, du plus faible au plus élevé » pour les niveaux (l'ordre de saisie fixe l'ordre des niveaux).
2. Constater que la fenêtre propose deux niveaux ; que **« Retirer le dernier niveau »** est inactif à deux niveaux et que **« Ajouter un niveau »** devient inactif à douze.
3. Pour chaque ligne du tableau, remplir la fenêtre comme indiqué (les autres champs étant valides : code `ESSAI_ECHELLE`, libellé `Essai`, niveaux `A` « Un » et `B` « Deux »), cliquer **« Créer l'échelle »** et lire le message.
4. Fermer avec **« Annuler »**.

| Saisie | Message attendu |
| :--- | :--- |
| « Code de l'échelle » = `echelle-3` (le tiret est refusé ; l'interface passe les lettres en majuscules) ou `E` | « Code attendu : majuscules, chiffres et _ (2 à 40). » |
| « Libellé » vide | « Ce champ est obligatoire. » |
| « Code du niveau 1 » vide | « Code attendu : majuscules, chiffres et _ (1 à 40). » |
| « Libellé du niveau 1 » vide | « Ce champ est obligatoire. » |
| « Code du niveau 1 » = `A` et « Code du niveau 2 » = `A` | "Code de niveau en double : A." (message du serveur, en haut de la fenêtre) |
| « Code de l'échelle » = `MASTERY_4` | "Une échelle de code `MASTERY_4` existe déjà." (message du serveur) |

✅ Aucun refus ne crée d'échelle : la liste ne change pas.

☐ OK ☐ KO

### Étape 34 — Créer l'échelle d'appréciation personnalisée
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > onglet **« Paramètres »** (`/v2/primary/parametres`)

1. Cliquer **« Nouvelle échelle »**.
2. Remplir le code et le libellé, puis les deux niveaux proposés.
3. Cliquer **« Ajouter un niveau »** et remplir le niveau 3.
4. Cocher « Attendu atteint » sur le niveau 3 uniquement.
5. Cliquer **« Créer l'échelle »**.
6. Dans « Échelle d'appréciation par défaut » (cadre « Réglages de l'établissement »), ouvrir la liste sans rien changer, puis la refermer.

| Champ | Valeur à saisir |
| :--- | :--- |
| Code de l'échelle | `FLAMBOYANTS_3` |
| Libellé | `Échelle des Flamboyants (3 niveaux)` |
| Code du niveau 1 / Libellé du niveau 1 | `NA` / `Non acquis` |
| Code du niveau 2 / Libellé du niveau 2 | `EA` / `En cours d'acquisition` |
| Code du niveau 3 / Libellé du niveau 3 | `AC` / `Acquis` (case « Attendu atteint » cochée) |

✅ « Échelle créée. » La carte `FLAMBOYANTS_3` apparaît avec "NA Non acquis", "EA En cours d'acquisition", "AC Acquis (attendu atteint)", **sans** pastille « Démonstration » (origine « établissement ») et **sans** « Verrouillée » (aucun référentiel publié ne l'emploie encore). Au 6, la liste de l'échelle par défaut propose maintenant aussi "Échelle des Flamboyants (3 niveaux)" ; laisser le choix actuel inchangé.

⚠️ *Limite de l'écran* : on ne peut pas modifier ni archiver une échelle depuis l'écran (seule la création existe). La règle « une échelle employée par un référentiel publié ne se modifie plus » se constate donc par la pastille « Verrouillée » (voir l'étape *Publier le référentiel*) ; la modification de niveaux elle-même n'est refusée que côté serveur (« L'échelle est employée par un référentiel publié : créer une nouvelle échelle. »), non atteignable à l'écran.

☐ OK ☐ KO

### Étape 35 — Créer un référentiel de compétences en brouillon
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > onglet **« Paramètres »** (`/v2/primary/parametres`)

Choix du niveau `CE1` : le jeu de données de l'école n'a **aucune classe CE1**, donc ce référentiel d'essai ne modifie la grille d'aucune des trois classes (Grande Section A, CP1 A, CM2 A). Le référentiel proposé par défaut à une classe est le premier, par ordre alphabétique de code, parmi les référentiels publiés de son niveau *(à vérifier côté instituteur)* ; ne pas lui donner les niveaux `GS`, `CP1` ou `CM2`.

1. Dans « Référentiels de compétences », cliquer **« Nouveau référentiel »** (fenêtre « Nouveau référentiel »). Lire les aides : « Majuscules, chiffres et _ (2 à 40 caractères). » et « Codes séparés par des virgules, par exemple CP1, CP2. ».
2. Remplir les champs du tableau.
3. Cliquer **« Créer le brouillon »**.

| Champ | Valeur à saisir |
| :--- | :--- |
| Code du référentiel | `FLAMBOYANTS_CE1` |
| Libellé | `Français et mathématiques CE1 (Flamboyants)` |
| Échelle d'appréciation | "Échelle des Flamboyants (3 niveaux)" |
| Niveaux de classe concernés | `CE1` |

✅ « Référentiel créé en brouillon. » La ligne "Français et mathématiques CE1 (Flamboyants) version 1" apparaît avec la pastille « Brouillon » et « Aucune compétence », et son détail s'ouvre seul : bloc « Ce qui empêche la publication : » avec « Ajoutez au moins une compétence. » ; ligne « Niveaux de l'échelle : NA, EA, AC » ; boutons « Modifier la structure », « Publier », « Supprimer le brouillon ».

⚠️ *Test d'erreur* (rouvrir « Nouveau référentiel » et cliquer « Créer le brouillon ») :

| Saisie | Message attendu |
| :--- | :--- |
| « Code du référentiel » = `ce1-francais` | « Code attendu : majuscules, chiffres et _ (2 à 40). » |
| « Libellé » vide | « Ce champ est obligatoire. » |
| « Échelle d'appréciation » non choisie | « Choix invalide. » |

⚠️ Ne pas réutiliser le code d'un référentiel existant (par exemple `PRESCHOOL_DEMO`) : le serveur crée alors la **version suivante** en brouillon au lieu de refuser.

☐ OK ☐ KO

### Étape 36 — Refuser la publication d'un brouillon incomplet, puis le supprimer
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > onglet **« Paramètres »** (`/v2/primary/parametres`)

1. Cliquer **« Nouveau référentiel »** et créer un brouillon **sans** niveau de classe : code `BROUILLON_VIDE`, libellé `Brouillon vide (essai)`, échelle "Échelle des Flamboyants (3 niveaux)", « Niveaux de classe concernés » **vide**. Cliquer « Créer le brouillon ».
2. Lire le bloc « Ce qui empêche la publication : » du détail qui s'ouvre.
3. Cliquer **« Publier »**. Dans la fenêtre « Publier le référentiel » (« Une fois publié, le référentiel devient immuable : il ne pourra plus être modifié. »), constater que le bouton « Publier » de la fenêtre est **inactif**, cocher **« Je comprends que la publication est définitive »**, puis cliquer **« Publier »**.
4. Lire l'erreur affichée dans la fenêtre, puis cliquer **« Annuler »**.
5. Cliquer **« Supprimer le brouillon »** (fenêtre « Supprimer le brouillon » : « Le brouillon sera supprimé définitivement. ») puis **« Supprimer »**.

✅ Au 2 : deux manques, « Ajoutez au moins une compétence. » et « Indiquez au moins un niveau d'application. ». Au 4 : « Le référentiel n'est pas publiable. » suivi de « Points à corriger avant de continuer : » et des deux mêmes manques ; le référentiel reste « Brouillon ». Au 5 : « Brouillon supprimé. » ; la ligne `BROUILLON_VIDE` disparaît.

(C'est ainsi que se prouve le lien référentiel ↔ niveaux : un référentiel **sans niveau de classe** ne se publie pas.)

☐ OK ☐ KO

### Étape 37 — Saisir la structure du référentiel (domaines et compétences)
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > onglet **« Paramètres »** (`/v2/primary/parametres`)

1. Sur la ligne "Français et mathématiques CE1 (Flamboyants) version 1", cliquer **« Ouvrir »** si le détail est fermé, puis **« Modifier la structure »** (fenêtre « Structure du référentiel » : « Domaines et compétences du brouillon. »).
2. Cliquer **« Ajouter un domaine »** : un « Domaine 1 » apparaît avec une première compétence vide. Remplir « Code du domaine 1 », « Libellé du domaine 1 », « Code de la compétence 1.1 », « Libellé de la compétence 1.1 », puis cliquer **« Ajouter une compétence »** pour la 1.2 et la remplir.
3. Répéter pour les domaines 2, 3 et 4 (champs « Code du domaine 2 », « Code de la compétence 2.1 », etc.).
4. Cliquer **« Enregistrer la structure »**.

| Domaine (code / libellé) | Compétence (code / libellé) |
| :--- | :--- |
| `LO` / `Langage oral` | `LO.1` / `S'exprime en phrases complètes` |
| | `LO.2` / `Raconte un événement vécu en respectant l'ordre des faits` |
| `LECT` / `Lecture` | `LECT.1` / `Lit à voix haute un texte court en respectant la ponctuation` |
| | `LECT.2` / `Répond à des questions sur un texte lu` |
| `ECR` / `Écriture` | `ECR.1` / `Copie un texte court sans erreur` |
| | `ECR.2` / `Écrit une phrase simple sous dictée` |
| `MATH` / `Mathématiques` | `MATH.1` / `Dénombre, compare et range les nombres jusqu'à 1 000` |
| | `MATH.2` / `Résout un problème simple d'addition ou de soustraction` |

✅ « Structure enregistrée. » ; la fenêtre se ferme ; le détail liste "LO — Langage oral" avec "LO.1 — S'exprime en phrases complètes" et "LO.2 — …", puis les trois autres domaines ; la ligne du référentiel indique "8 compétences" ; le bloc « Ce qui empêche la publication : » a disparu.

⚠️ *Test d'erreur* (avant d'enregistrer le tableau ci-dessus, ou en rouvrant « Modifier la structure » puis en fermant par « Annuler » ; seule la **première** erreur est affichée, en rouge, en haut de la fenêtre) :

| Saisie | Message attendu |
| :--- | :--- |
| « Code du domaine 1 » vide | « Code attendu : majuscules, chiffres, . - et _ (1 à 40). » |
| « Libellé du domaine 1 » vide | « Ce champ est obligatoire. » |
| « Code de la compétence 1.1 » = `lo 1` (espace refusé) | « Code attendu : majuscules, chiffres, . - et _ (1 à 40). » |
| deux domaines avec le même code `LO` | "Code de domaine en double : LO." (message du serveur) |
| compétence `LO.1` répétée dans un autre domaine | "Code de compétence en double : LO.1." (message du serveur) |

☐ OK ☐ KO

### Étape 38 — Publier le référentiel : immuabilité et verrouillage de l'échelle
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > onglet **« Paramètres »** (`/v2/primary/parametres`)

1. Sur "Français et mathématiques CE1 (Flamboyants) version 1" (détail ouvert), cliquer **« Publier »**.
2. Dans la fenêtre « Publier le référentiel », cocher **« Je comprends que la publication est définitive »**, puis cliquer **« Publier »**.
3. Relire le détail du référentiel.
4. Remonter à « Échelles d'appréciation » et relire la carte `FLAMBOYANTS_3`.

✅ « Référentiel publié. » La pastille passe à « Publié » ; le détail affiche « Référentiel publié : immuable. Créez une nouvelle version pour le modifier. » ; les boutons « Modifier la structure », « Publier » et « Supprimer le brouillon » ont disparu, il reste « Créer une nouvelle version ». Au 4 : `FLAMBOYANTS_3` porte maintenant la pastille « Verrouillée ».

*Note* : une classe du niveau CE1 afficherait ce référentiel dans « Compétences » côté instituteur. Aucune classe CE1 n'existe, donc rien ne change pour Grande Section A, CP1 A et CM2 A.

🕓 À jouer quand le compte **instituteur** existera : dans « Compétences », le référentiel proposé à une classe est celui des référentiels publiés dont les niveaux contiennent le niveau de la classe (GS : « Compétences de la maternelle (démonstration) » ; CP1 et CM2 : « Compétences du primaire (démonstration) »).

☐ OK ☐ KO

### Étape 39 — Créer une nouvelle version d'un référentiel publié, puis la publier
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > onglet **« Paramètres »** (`/v2/primary/parametres`)

1. Sur la version 1 (détail ouvert), cliquer **« Créer une nouvelle version »**.
2. Constater l'apparition de la version 2 ; rouvrir la version 1 (« Ouvrir ») et cliquer de nouveau « Créer une nouvelle version » : lire l'erreur.
3. Ouvrir la version 2, cliquer **« Modifier la structure »**, ajouter à "Langage oral" une troisième compétence (**« Ajouter une compétence »** sous le domaine 1) puis **« Enregistrer la structure »**.
4. Cliquer **« Publier »**, cocher la case de confirmation, cliquer « Publier ».
5. Relire les deux lignes du référentiel.

| Champ | Valeur à saisir |
| :--- | :--- |
| Code de la compétence 1.3 | `LO.3` |
| Libellé de la compétence 1.3 | `Participe à un échange en respectant le tour de parole` |

✅ Au 1 : « Version 2 créée en brouillon. » ; la version 2 s'ouvre seule, avec la pastille « Brouillon » et "8 compétences" (copie de la version 1) ; la version 1 reste « Publié ». Au 2 : « Une version brouillon de ce référentiel existe déjà : la terminer ou la supprimer. » Au 3 : « Structure enregistrée. » (9 compétences). Au 4 : « Référentiel publié. » Au 5 : version 2 « Publié », version 1 « Retiré » (une seule version publiée par code ; les saisies déjà faites sur la version 1, s'il y en avait, la gardent).

☐ OK ☐ KO

## Phase 4 — Banque d'appréciations (phrases)

Objectif : utiliser l'écran « Appréciations » (`/v2/primary/appreciations`) en propriétaire : lire la banque, se composer un texte, créer des phrases, en désactiver et en réactiver, puis vérifier que rejouer le modèle de pack ne remplace rien de ce qui a été personnalisé. Précondition : la phase précédente est faite (l'échelle `FLAMBOYANTS_3` alimente la liste « Niveau de maîtrise »). Les classes Grande Section A, CP1 A et CM2 A alimentent la liste « Niveau de classe » ; sans classe, cette liste ne propose que « Tous ». Le propriétaire détient `primary.phrase.read` et `primary.phrase.manage` : il lit **et** gère la banque. Une phrase propose du texte, elle n'est jamais appliquée seule.

### Étape 40 — Lire la banque et se composer un texte
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > onglet **« Appréciations »** (`/v2/primary/appreciations`)

1. Attendre 3 à 4 secondes puis lire le titre « Appréciations » et « Banque de phrases pour rédiger vos appréciations. Une phrase propose du texte : elle n'est jamais appliquée seule. ». Lire la liste « Phrases de la banque ».
2. Constater le bouton **« Nouvelle phrase »** en haut de page et la case « Afficher aussi les phrases désactivées » dans le cadre « Filtres ».
3. Dans « Filtres », choisir « Portée » = « Année » ; puis revenir à « Tous » et choisir « Niveau de maîtrise » = `N1` ; revenir à « Tous ».
4. Dans « Ma rédaction », constater que la case « J'ai relu et je valide ce texte » et le bouton « Copier le texte validé » sont inactifs tant que le champ « Texte de l'appréciation » est vide.
5. Sur la phrase du niveau N3 ("Le travail est satisfaisant. (phrase de démonstration)"), cliquer **« Ajouter à ma rédaction »**, puis sur la phrase `YEAR_GENERIC` (« Appréciation de fin d'année à compléter par l'instituteur. (phrase de démonstration) »), cliquer **« Ajouter à ma rédaction »**.
6. Modifier un mot du texte : la case « J'ai relu et je valide ce texte » reste décochée. La cocher, puis cliquer **« Copier le texte validé »**.
7. Cliquer **« Effacer »**.

✅ Au 1 : 3 phrases de démonstration, chacune avec les pastilles « Démonstration » et sa portée : « Période » + « Niveau N1 » (`PERIOD_N1`, "Des difficultés persistent ; un soutien est conseillé. (phrase de démonstration)"), « Période » + « Niveau N3 » (`PERIOD_N3`), « Année » (`YEAR_GENERIC`). Pas de texte « Vous pouvez consulter la banque ; sa gestion est réservée à la direction. » (réservé aux profils qui ne gèrent pas la banque). Au 3 : « Année » → 1 phrase ; « N1 » → 2 phrases (`PERIOD_N1`, et `YEAR_GENERIC` qui n'est liée à aucun niveau de maîtrise). Au 5 : les deux textes se suivent dans le champ. Au 6 : « Texte copié : collez-le dans l'appréciation du bulletin. » (ou, si le navigateur refuse l'accès au presse-papiers, « La copie a échoué : sélectionnez le texte et copiez-le manuellement. »). Au 7 : le champ est vide. Sous le cadre : « Ce texte n'est enregistré nulle part ici. L'appréciation générale s'écrit dans le module Résultats (appréciations de la période). ».

☐ OK ☐ KO

### Étape 41 — Créer des phrases dans la banque
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > onglet **« Appréciations »** (`/v2/primary/appreciations`)

1. Cliquer **« Nouvelle phrase »** (fenêtre « Nouvelle phrase »). Lire les aides : « Majuscules, chiffres et _ (2 à 60 caractères). » et « 300 caractères au plus. ».
2. Remplir la première phrase du tableau puis cliquer **« Créer la phrase »**.
3. Répéter pour les deux autres lignes. Pour « Niveau de classe », choisir le code de la classe indiqué (`CM2`, `CP1`) ; si la liste ne propose que « Tous » (classes pas encore créées), laisser « Tous ».

| Code | Portée | Texte de la phrase | Niveau de maîtrise | Niveau de classe |
| :--- | :--- | :--- | :--- | :--- |
| `PERIOD_N2_ENCOURAGEMENT` | Période | `Des progrès sont visibles : poursuivez vos efforts avec régularité.` | `N2` | Tous |
| `YEAR_CM2_TRAVAIL` | Année | `Année de travail sérieuse : l'élève a fourni des efforts constants.` | Tous | `CM2` |
| `COMP_LECTURE_AISANCE` | Compétence | `Lit à voix haute avec aisance et en respectant la ponctuation.` | `AC` | `CP1` |

✅ « Phrase créée. » à chaque fois ; les phrases apparaissent dans la liste, **sans** pastille « Démonstration », avec « Période »/« Année »/« Compétence », « Niveau N2 », « Classe CM2 », « Niveau AC », « Classe CP1 ». Filtre « Niveau de classe » = `CM2` : `YEAR_CM2_TRAVAIL` et toutes les phrases sans niveau de classe s'affichent, pas `COMP_LECTURE_AISANCE`. (Le niveau `AC` n'est proposé que parce que l'échelle `FLAMBOYANTS_3` existe.)

⚠️ *Test d'erreur* (fenêtre « Nouvelle phrase », bouton « Créer la phrase ») :

| Saisie | Message attendu |
| :--- | :--- |
| « Code » = `periode-2` ou vide | « Code attendu : majuscules, chiffres et _ (2 à 60). » |
| « Texte de la phrase » vide | « Ce champ est obligatoire. » |
| « Code » = `PERIOD_N1` (déjà utilisé) | "Une phrase de code `PERIOD_N1` existe déjà." (message du serveur) |

⚠️ *Limite de l'écran* : on ne peut ni modifier le texte d'une phrase existante, ni la supprimer ; seules la création et la désactivation/réactivation existent (voir l'étape suivante).

☐ OK ☐ KO

### Étape 42 — Désactiver et réactiver une phrase (archivage)
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > onglet **« Appréciations »** (`/v2/primary/appreciations`)

1. Sur la phrase de démonstration `PERIOD_N1` ("Des difficultés persistent…"), cliquer **« Désactiver »**.
2. Constater qu'elle quitte la liste. Cocher **« Afficher aussi les phrases désactivées »**.
3. Sur la phrase réapparue, constater la pastille et l'état des boutons, **sans** la réactiver.
4. Décocher « Afficher aussi les phrases désactivées » : la phrase disparaît de nouveau. **Laisser `PERIOD_N1` désactivée** pour l'étape suivante.

✅ Au 2 : la phrase disparaît de la liste (les phrases désactivées sont masquées par défaut), puis réapparaît case cochée. Au 3 : pastille « Désactivée », bouton « Ajouter à ma rédaction » inactif, bouton **« Activer »** à la place de « Désactiver ». Aucun message de confirmation n'apparaît pour ces deux gestes.

🕓 À jouer quand le compte **instituteur** existera : l'instituteur voit la banque en lecture seule (« Vous pouvez consulter la banque ; sa gestion est réservée à la direction. »), sans bouton « Nouvelle phrase » ni « Désactiver » ; une phrase désactivée ne lui est pas proposée.

☐ OK ☐ KO

### Étape 43 — Rejouer le modèle de pack après personnalisation (idempotence)
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > onglet **« Paramètres »** (`/v2/primary/parametres`)

Données personnalisées en place : échelle `FLAMBOYANTS_3` ; référentiel `FLAMBOYANTS_CE1` (version 1 « Retiré », version 2 « Publié ») ; phrases créées et `PERIOD_N1` désactivée.

1. Dans « Réglages de l'établissement », saisir `7` dans « Durée de conservation des archives (années) » et cliquer **« Enregistrer les réglages »** (« Réglages enregistrés. »).
2. Compter, sans rien modifier : les cartes de « Échelles d'appréciation » (2), les lignes de « Référentiels de compétences » (4 : `PRESCHOOL_DEMO` version 1, `PRIMARY_DEMO` version 1, `FLAMBOYANTS_CE1` versions 1 et 2).
3. Cliquer **« Appliquer le modèle de pack »**, puis **« Appliquer le modèle »**.
4. Recharger la page, attendre 3 à 4 secondes, et relire les réglages, les échelles et les référentiels comme au 1 et au 2.
5. Ouvrir l'onglet **« Appréciations »** et cocher « Afficher aussi les phrases désactivées » : relire `PERIOD_N1`.
6. **Rétablir l'état de départ** : sur `PERIOD_N1`, cliquer **« Activer »** ; décocher « Afficher aussi les phrases désactivées » ; revenir sous **« Paramètres »**, vider le champ « Durée de conservation des archives (années) » et enregistrer.

✅ Au 3 : « Le modèle était déjà appliqué : rien n'a été modifié. » Au 4 : durée toujours à `7`, 2 échelles, 4 lignes de référentiels (la version 1 de `FLAMBOYANTS_CE1` toujours « Retiré », la version 2 « Publié »), aucune carte ni ligne recréée. Au 5 : `PERIOD_N1` toujours « Désactivée » : le modèle n'a pas rétabli la phrase. Au 6 : « Réglages enregistrés. » ; la phrase de nouveau active.

*Note* : dans le code, même lorsqu'une version plus récente du modèle sera livrée, le modèle ne crée que les codes absents ; un code déjà présent (échelle, référentiel, phrase) est conservé tel que l'établissement l'a laissé, et rien n'est supprimé. Ce cas (nouvelle version du modèle) n'est pas rejouable depuis l'écran.

☐ OK ☐ KO

## Phase 5 — États du primaire (lecture)

Objectif : ouvrir l'écran « États du primaire » (`/v2/primary/etats`) en propriétaire et produire les états disponibles. Le propriétaire détient `primary.report.read` et `primary.class.read_all` : il voit les **sept** rapports, dont les trois réservés à la direction. Précondition : aucune obligatoire ; les résultats dépendent de l'avancement du déroulé (classes créées ou non, élèves inscrits ou non). Le tableau ci-dessous donne ce qui se voit **sur une école sans élève** ; les lignes évoluent quand la partie « Personnes » est jouée.

### Étape 44 — Lire l'écran « États » et les paramètres de chaque rapport
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > onglet **« États »** (`/v2/primary/etats`)

1. Attendre 3 à 4 secondes (l'écran vérifie que l'offre inclut les états ; si le texte « Cette fonctionnalité n'est pas incluse dans l'offre de votre établissement. » **reste** après ce délai, le noter : ce n'est plus un simple chargement).
2. Lire le titre « États du primaire » et « Aperçu en tableau et export CSV. Les paramètres du rapport sont rappelés avec le résultat. ». Lire le message « Choisissez un rapport puis affichez l'aperçu. ».
3. Dans la légende « Rapport à produire », ouvrir la liste **« Rapport »**.
4. Choisir « Liste de classe » : constater les champs affichés et l'état des boutons « Afficher l'aperçu » et « Exporter en CSV ».
5. Choisir successivement chacun des autres rapports et noter les champs demandés.

✅ Au 3 : sept choix, « Liste de classe », « Effectifs par niveau et par classe », « Registre d'appel mensuel », « Redoublants », « Couverture des compétences », « Dossier du conseil des maîtres », « Avancement des classes ». Au 4 : champ « Classe » (obligatoire), boutons **inactifs**, texte « Renseignez les paramètres obligatoires pour produire ce rapport. ». Au 5 :

| Rapport | Champs demandés |
| :--- | :--- |
| Liste de classe | « Classe » (obligatoire) |
| Effectifs par niveau et par classe | « Année » (facultatif, « Année en cours » par défaut) |
| Registre d'appel mensuel | « Classe » et « Mois » (obligatoires ; aide « Au format AAAA-MM. ») |
| Redoublants | « Année » (facultatif) |
| Couverture des compétences | « Classe » et « Période » (obligatoires ; « Période » reste inactive tant qu'aucune classe n'est choisie) |
| Dossier du conseil des maîtres | « Conseil » (obligatoire) |
| Avancement des classes | « Année » (facultatif) |

(Les classes proposées sont celles que renvoie l'API au propriétaire ; si une classe créée manque, vérifier qu'elle n'est pas encore en « Brouillon ».)

🕓 À jouer quand le compte **instituteur** existera : il ne voit que quatre rapports (« Liste de classe », « Registre d'appel mensuel », « Couverture des compétences », « Dossier du conseil des maîtres ») ; « Effectifs par niveau et par classe », « Redoublants » et « Avancement des classes » lui sont masqués. Le secrétariat, lui, voit les sept.

☐ OK ☐ KO

### Étape 45 — Produire les états sans données
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > onglet **« États »** (`/v2/primary/etats`)

1. Pour chaque ligne du tableau, choisir le rapport et les paramètres indiqués, cliquer **« Afficher l'aperçu »**, et lire le titre, la ligne « Produit le … », la liste « Paramètres du rapport » et le tableau.
2. Pour « Effectifs par niveau et par classe », cliquer aussi **« Exporter en CSV »** : le navigateur télécharge `enrollment-stats.csv` (séparateur `;`, ouvrable dans Excel). *Demander l'accord du testeur avant de télécharger ; l'export est facultatif.*

| Rapport et paramètres | Résultat attendu sur une école sans élève |
| :--- | :--- |
| « Effectifs par niveau et par classe » | titre « Effectifs par niveau et par classe » ; colonnes Niveau, Classe, Élèves, Redoublants ; une ligne par classe avec `0` élève (Grande Section A, CP1 A, CM2 A) ; sans classe : « Ce rapport ne contient aucune ligne. » |
| « Redoublants » | colonnes Niveau, Classe, Élève ; « Ce rapport ne contient aucune ligne. » |
| « Avancement des classes » | titre « Avancement des classes » ; colonnes Classe, Période verrouillée, Élèves, Compétences attendues, Saisies, Validées, Bilans scellés, Bilans ; une ligne par classe *(par classe et par période, à vérifier)*, compteurs à `0` |
| « Liste de classe » avec « Classe » = Grande Section A | titre "Liste de classe — Grande Section A" ; colonnes N°, Élève, Redoublant ; « Ce rapport ne contient aucune ligne. » tant que la classe n'a aucun élève inscrit |
| « Registre d'appel mensuel » avec « Classe » = Grande Section A, « Mois » = `2026-10` | titre "Registre d'appel — 2026-10" ; colonne Élève ; aucune ligne |
| « Couverture des compétences » avec « Classe » = Grande Section A, « Période » = une période de l'année | titre « Couverture des compétences » ; colonnes Élève, Attendues, Saisies, Validées, Non évaluées ; aucune ligne tant qu'aucun élève n'est inscrit (avec élèves : « Attendues » = 3 pour la maternelle, 1 pour CP1 et CM2, selon les référentiels de démonstration) |
| « Dossier du conseil des maîtres » | liste « Conseil » vide : aucun conseil n'a encore été préparé |

✅ Dans « Paramètres du rapport », seuls les paramètres renseignés apparaissent (par exemple « Classe », « Mois »). L'aperçu et le CSV contiennent les mêmes lignes.

⚠️ *Test d'erreur* : « Registre d'appel mensuel » avec « Mois » = `10/2026` → « Mois attendu au format AAAA-MM. » (message du serveur, bandeau rouge) ; aucun tableau n'est affiché.

🕓 « Dossier du conseil des maîtres » : à jouer quand un conseil des maîtres aura été préparé (compte **directeur** ou propriétaire, après saisie des compétences par l'**instituteur**) ; « Couverture des compétences » et « Liste de classe » avec élèves : à rejouer après l'inscription des élèves et la saisie des compétences par l'instituteur.

☐ OK ☐ KO

## Phase 6 — Personnel de l'école

Objectif : créer les trois fiches de personnel (sans compte de connexion pour l'instant), les relire, et savoir exactement ce que ferait l'invitation d'un compte. Précondition : parties précédentes jouées (année 2026-2027 créée, classes `Grande Section A` (code `GS-A`), `CP1 A` (code `CP1-A`) et `CM2 A` (code `CM2-A`) créées et **encore en « Brouillon »** : elles seront activées en fin de partie, une fois leur titulaire désigné).

Le **propriétaire** détient toutes les permissions du module des personnes (modèle de rôle « Propriétaire » : tous les droits, sauf la console de la plateforme) : toutes les actions de cette partie lui sont ouvertes. Pour les droits dits « sensibles » (statut d'un membre du personnel, contrats, informations sensibles d'un élève, confirmation sans paiement), le serveur exige la MFA : si une fenêtre « Confirmez votre identité » s'affiche, saisir le code à 6 chiffres du moment dans « Code à 6 chiffres », puis « Confirmer et continuer ».

*Saisie des dates* : les champs de date suivent le format du navigateur (jj/mm/aaaa en français). Taper les chiffres sans les barres (par exemple `14032021` pour le 14/03/2021) ; le serveur reçoit `2021-03-14`. Les téléphones sont enregistrés sans espaces (`+2250700000011`) : c'est normal.

### Étape 46 — Lire la liste du personnel (vide) et créer la fiche de KOFFI Adjoua
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Personnes »** > **"Personnel"** (`/v2/staff`)

1. Ouvrir la page et attendre 3 à 4 secondes (un message de chargement peut s'afficher brièvement). Lire le titre « Personnel » et la barre d'onglets : « Personnel », « Nouveau membre », « Affectations », « Mon espace » (ne pas ouvrir « Mon espace » : le propriétaire n'a pas de fiche de personnel).
2. Lire le tableau « Liste du personnel », puis ouvrir la liste déroulante « Catégorie » des filtres.
3. Cliquer l'onglet **« Nouveau membre »** (`/v2/staff/new`) : titre « Nouveau membre du personnel ». Sans rien saisir, cliquer **« Créer la fiche »** (test d'erreur ci-dessous), puis saisir :

| Champ | Valeur à saisir |
| :--- | :--- |
| Nom | `KOFFI` |
| Prénoms | `Adjoua` |
| Sexe | « Féminin » |
| Date de naissance | `12/04/1988` |
| Lieu de naissance | `Abidjan` |
| Nationalité (code pays) | `CI` |
| Adresse e-mail | `adjoua.koffi@ecole-flamboyants.test` |
| Téléphone | `+225 07 00 00 00 21` |
| Ville | `Abidjan` |
| Catégorie | « Enseignant » |
| Intitulé du poste | `Institutrice titulaire` |
| Date d'embauche | `01/09/2022` |

4. Cliquer **« Créer la fiche »**.

✅ Action 2 : « Aucun membre du personnel. » et "Créez la première fiche avec « Nouveau membre ». " ; le filtre « Catégorie » propose les cinq catégories du modèle : « Enseignant », « Éducateur », « Personnel administratif », « Direction », « Personnel d'appui ». Seule la catégorie « Enseignant » peut recevoir une affectation de titulaire de classe. Action 4 : écran « Fiche créée » avec « KOFFI Adjoua — matricule P0001. » et les boutons « Ouvrir la fiche » et « Retour à la liste ». Les fonctions du jeu de test sont saisies dans « Intitulé du poste » (texte libre), pas dans un rôle.

⚠️ *Test d'erreur* (avant le dernier clic sur « Créer la fiche ») :
- formulaire vide : « Ce champ est obligatoire. » sous « Nom » et sous « Prénoms ». Sous « Catégorie », le message affiché est `Code en majuscules, chiffres et « _ » (40 max).` (message technique du contrat, faute de mieux) ;
- e-mail `adjoua.koffi.exemple.test` : « Adresse e-mail invalide. » ;
- téléphone `12` : « Téléphone trop court. » ; téléphone `abcdefg` (7 caractères, aucun chiffre) : refus du serveur « Numéro de téléphone invalide. » *(emplacement exact du message à relever)*.

☐ OK ☐ KO

### Étape 47 — Créer les fiches de BAMBA Séraphin et ZOKORA Sylvie
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Onglet **« Nouveau membre »** (`/v2/staff/new`)

1. Depuis l'écran « Fiche créée » de l'étape précédente, cliquer **« Retour à la liste »**, puis l'onglet **« Nouveau membre »**. Saisir la fiche de BAMBA, puis **« Créer la fiche »** ; recommencer pour ZOKORA.

| Champ | BAMBA | ZOKORA |
| :--- | :--- | :--- |
| Nom | `BAMBA` | `ZOKORA` |
| Prénoms | `Séraphin` | `Sylvie` |
| Sexe | « Masculin » | « Féminin » |
| Date de naissance | `03/09/1981` | `25/01/1990` |
| Lieu de naissance | `Abidjan` | `Abidjan` |
| Nationalité (code pays) | `CI` | `CI` |
| Adresse e-mail | `seraphin.bamba@ecole-flamboyants.test` | `sylvie.zokora@ecole-flamboyants.test` |
| Téléphone | `+225 07 00 00 00 22` | `+225 07 00 00 00 23` |
| Ville | `Abidjan` | `Abidjan` |
| Catégorie | « Enseignant » | « Enseignant » |
| Intitulé du poste | `Instituteur titulaire` | `Institutrice de maternelle titulaire` |
| Date d'embauche | `01/09/2015` | `01/09/2019` |

2. Test du doublon : cliquer **« Nouveau membre »**, saisir Nom `KOFFI`, Prénoms `Adjoua`, Adresse e-mail `adjoua.koffi@ecole-flamboyants.test`, Catégorie « Enseignant », puis **« Créer la fiche »**. **Ne pas créer** : ne pas cocher la case, quitter la page.

✅ Fiches créées : « BAMBA Séraphin — matricule P0002. » puis « ZOKORA Sylvie — matricule P0003. » (motif `P{SEQ:4}` du modèle). Au test du doublon, un encadré annonce « 1 dossier ressemble à cette personne » avec la mention « Même e-mail » et le rôle « Personnel » ; la fiche de KOFFI n'est pas dupliquée.

⚠️ *Test d'erreur* : dans l'encadré du doublon, cocher « Ce n'est pas un doublon : créer quand même » fait apparaître « Motif de la création » ; avec ce champ vide, « Créer la fiche » donne « Un motif est requis pour confirmer un doublon possible. » (décocher ensuite, ne rien créer).

☐ OK ☐ KO

### Étape 48 — Relire la liste, ouvrir une fiche et la modifier
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Personnes »** > **"Personnel"** (`/v2/staff`)

1. Lire le tableau : trois lignes, colonnes « Nom », « Matricule », « Catégorie », « Fonction », « Charge prévue » (« — » pour l'instant), « Statut » (« En poste »). Dans « Rechercher un membre du personnel », saisir `bamba` : une ligne ; saisir `zzzz` : « Aucun membre ne correspond à votre recherche. » ; effacer.
2. Dans le filtre « Catégorie », choisir « Éducateur » : « Aucun membre du personnel. » ; remettre « Tous ».
3. Cliquer le nom **KOFFI Adjoua**. Lire l'en-tête : « Matricule P0001 — Enseignant — Institutrice titulaire », boutons « Tout le personnel », « Modifier », « Inviter au portail », « Changer le statut », et les onglets « Identité », « Contrats », « Qualifications », « Compétences », « Disponibilités », « Charge horaire », « Historique ».
4. Onglet « Identité » : « Compte du portail » = « Aucun compte » ; « Établissements » : « Aucun établissement de rattachement. ». Onglet « Charge horaire » : « Aucune affectation cette année. » (avant la désignation des titulaires). Onglet « Historique » : « Aucun changement de statut. ». **Ne pas créer de contrat** : la rémunération relève du module Paie.
5. Cliquer **« Modifier »**, changer « Intitulé du poste » en `Institutrice titulaire du CP1`, **« Enregistrer »**. Rouvrir « Modifier », remettre `Institutrice titulaire`, **« Enregistrer »**.

✅ « La fiche a été mise à jour. » après chaque enregistrement ; la valeur d'origine est rétablie à la fin.

⚠️ *Test d'erreur* : dans « Modifier », vider « Nom » puis « Enregistrer » : « Ce champ est obligatoire. » ; fermer sans enregistrer.

🕓 *Test de droit* : à jouer quand le compte **secrétariat** existera : taper `/v2/staff` doit afficher « Accès refusé » (le modèle de rôle du secrétariat n'a aucune permission sur le personnel).

☐ OK ☐ KO

### Étape 49 — 🕓 Inviter un compte depuis la fiche (étape différée, ne pas jouer maintenant)
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Fiche d'un membre du personnel (`/v2/staff`)

🕓 **À jouer plus tard**, quand l'utilisateur ajoutera les comptes des titulaires. **Ne pas cliquer « Inviter au portail » maintenant** : l'invitation crée un accès réel dans l'établissement, que l'interface ne permet pas de supprimer. Voici, lu dans le code, ce qui se passera :

1. Le bouton **« Inviter au portail »** n'est affiché que si « Compte du portail » vaut « Aucun compte » et que l'utilisateur a le droit de modifier une fiche de personnel (le propriétaire l'a). Sans adresse e-mail sur la fiche, le serveur refuse : « Une adresse e-mail est nécessaire pour inviter la personne. » Si cette adresse a déjà un accès : « Un accès existe déjà pour cette adresse e-mail : liez la personne à l'identité existante. »
2. Au clic, le serveur crée l'identité et l'accès à l'établissement, lui attribue un rôle système, lie l'identité à la fiche, puis demande l'envoi d'une invitation par e-mail. L'écran affiche « L'invitation a été envoyée. » ; le bouton disparaît et « Compte du portail » affiche le statut brut de l'accès (`active`, valeur non traduite).
3. **En développement, aucun e-mail n'est réellement envoyé** tant qu'aucun serveur SMTP n'est configuré (cas du mode développement par défaut *(à vérifier dans l'environnement local)*) : le journal de l'API note seulement « invitation NON envoyée », sans le jeton. Le propriétaire ne voit donc **aucun lien d'invitation** nulle part, et la personne ne peut pas choisir son mot de passe par ce chemin. Pour obtenir un compte utilisable, l'utilisateur devra définir le mot de passe par un moyen hors interface (par exemple son script d'amorçage).
4. Le rôle accordé est choisi par le serveur d'après la catégorie : « Enseignant » donne le rôle système `enseignant`, **pas** `instituteur`. L'écran n'offre pas de choix de rôle. Or seul le rôle `instituteur` porte les droits du pack Primaire (compétences, conseil des maîtres). Il faudra donc attribuer le rôle « Instituteur » au compte (menu « Accès et rôles » > « Attributions de rôles »).
5. Une fiche n'est liée à un compte que par cette invitation : l'écran ne permet pas de rattacher après coup un compte créé autrement. Un compte créé hors de la fiche ne verra pas « Ma classe », même titulaire sur le papier. *(déduit du code : à vérifier lors du jeu de la partie 2)*

✅ Ce qu'il faudra constater à ce moment-là : message « L'invitation a été envoyée. », disparition du bouton, « Compte du portail » renseigné, puis connexion possible du titulaire une fois le mot de passe défini.

☐ OK ☐ KO

## Phase 7 — Réglages d'inscription

Objectif : lire la politique de confirmation des inscriptions (valeur par défaut d'une école neuve) et fixer le numéro d'inscription **avant** la première inscription (le numéro est attribué une fois pour toutes à la première inscription de l'élève). Précondition : phase précédente jouée ; l'école n'a aucun frais d'inscription configuré (module Finance vide).

### Étape 50 — Lire la politique de confirmation des inscriptions
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Académique »** > **"Paramètres académiques"** (`/v2/academic/settings`)

1. Lire le titre « Paramètres académiques ». Cliquer l'onglet **« Inscriptions »** (liste de rubriques « Rubriques des paramètres » : « Périodes », « Niveaux », « Statuts et financements », « Inscriptions », « Numérotation », « Calendrier »).
2. Lire « Politiques d'inscription » et le groupe **« Confirmation des inscriptions »** : quatre choix. Noter celui qui est coché.
3. Lire le groupe « Confirmation des cours à la carte » et le champ « Durée de réservation (minutes) ». **Ne rien modifier.**

✅ Le choix coché est **« Automatique »** (« L'inscription est confirmée dès sa création, sans condition de paiement. »), valeur du modèle de pack primaire ; « Durée de réservation (minutes) » est vide. Les quatre politiques se comportent ainsi dans cette école sans frais :

| Politique | Statut à l'inscription | Ce qui débloque la confirmation |
| :--- | :--- | :--- |
| « Automatique » | Active tout de suite | rien à faire |
| « Après paiement des frais d'inscription » | Active tout de suite **si aucun frais d'inscription n'est dû** (cas de cette école) ; sinon en attente | paiement de la facture d'inscription (module Finance), ou « Confirmer sans paiement » (dérogation motivée) |
| « Après paiement intégral » | En attente | paiement intégral de la facture, ou « Confirmer sans paiement » (dérogation motivée) |
| « Manuelle » | En attente | bouton « Confirmer » sur la fiche de l'inscription |

Une inscription en attente n'apparaît pas dans l'effectif de la classe pour les appels et les compétences : seules les inscriptions « Active » (ou terminées) comptent. Les politiques "Après paiement…" sont jouées plus loin, aux étapes *Essayer la politique « Après paiement des frais d'inscription » (aucun frais configuré)* et *Essayer la politique « Après paiement intégral » et confirmer sans paiement* ; la politique « Manuelle » n'est pas jouée.

☐ OK ☐ KO

### Étape 51 — Fixer le motif du numéro d'inscription
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Académique »** > **"Paramètres académiques"** (`/v2/academic/settings`), onglet **« Numérotation »**

1. Cliquer l'onglet **« Numérotation »**. Lire la section « Numéro d'inscription » : « Motif du numéro d'inscription » et « Préfixe » sont vides ; sans motif, aucune inscription n'a de numéro (« — » dans les listes).
2. Lire la section « Matricules et dossiers » : « Motif du matricule élève » = `{SEQ:5}` (matricules `00001`, `00002`…) et « Motif du matricule du personnel » = `P{SEQ:4}` (déjà utilisé : `P0001`…). **Ne pas les modifier.**
3. Test d'erreur d'abord : dans « Motif du numéro d'inscription », saisir `FLAM-{YEAR}`, lire l'« Aperçu de forme du motif », puis cliquer **« Enregistrer »**.
4. Remplacer par les valeurs suivantes, puis **« Enregistrer »** (le préfixe et le motif dans le même enregistrement) :

| Champ | Valeur à saisir |
| :--- | :--- |
| Motif du numéro d'inscription | `{PREFIX}-{YEAR}-{LEVEL}-{STUDENT_SEQ:4}` |
| Préfixe | `FLAM` |

✅ Action 3 : l'aperçu signale « Le jeton {STUDENT_SEQ:n} manque : sans lui, deux numéros pourraient être identiques. » et l'enregistrement est refusé avec `Le motif doit contenir {STUDENT_SEQ:n} : sans lui deux apprenants pourraient partager un numéro.` Action 4 : « La numérotation des inscriptions est enregistrée. » Les numéros attendus plus loin sont de la forme `FLAM-2026-GS-0001` (préfixe, année de début, code du niveau, numéro d'ordre du dossier de l'élève).

⚠️ Ne pas enregistrer un motif avec `{PREFIX}` sans renseigner « Préfixe » : l'enregistrement passe, mais la première inscription est refusée (« Le motif utilise {PREFIX} mais l'établissement n'a pas de préfixe. ») *(lu dans le code)*.

☐ OK ☐ KO

## Phase 8 — Tuteurs et élèves saisis à la main

Objectif : saisir à la main les six premiers tuteurs et élèves du jeu de test (les deux premiers de chaque classe), lier chaque élève à son tuteur, et vérifier les contrôles de saisie. Les trois autres (DAGO Chantal, TRAORE Fatoumata, TANOH Marie-Ange et leurs tuteurs) arrivent par **import** (phase *Import des trois derniers élèves*). Précondition : phase précédente jouée.

| Classe | Élève (saisi à la main) | Tuteur (créé avant l'élève) | Lien |
| :--- | :--- | :--- | :--- |
| Grande Section A | ADOU Aïcha, F, 14/03/2021 | ADOU Roland, `+225 07 00 00 00 11` | Père |
| Grande Section A | ASSI Brice, M, 02/07/2021 | ASSI Carine, `+225 07 00 00 00 12` | Mère |
| CP1 A | KOUASSI Aya, F, 09/05/2020 | KOUASSI Hervé, `+225 07 00 00 00 14` | Père |
| CP1 A | YAO Konan Éric, M, 30/01/2020 | YAO Mariam, `+225 07 00 00 00 15` | Mère |
| CM2 A | COULIBALY Ibrahim, M, 11/04/2015 | COULIBALY Awa, `+225 07 00 00 00 17` | Mère |
| CM2 A | N'GUESSAN Kouamé, M, 05/12/2015 | N'GUESSAN Berthe, `+225 07 00 00 00 18` | Mère |

*Pourquoi les tuteurs d'abord* : l'assistant « Nouvel élève » permet de créer un tuteur à la volée, mais sans téléphone ni e-mail (seule l'identité est demandée). Pour conserver les numéros de téléphone, on crée donc chaque tuteur depuis « Tuteurs », puis on le choisit comme "tuteur existant".

Les matricules attendus (`00001` à `00006`) supposent que ces six fiches sont créées dans l'ordre ci-dessus et qu'aucun autre élève n'a été créé avant.

### Étape 52 — Lire les listes vides et créer le tuteur ADOU Roland
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Personnes »** > **"Élèves"** (`/v2/students`), puis onglet **« Tuteurs »** (`/v2/guardians`)

1. Ouvrir le menu **"Élèves"** (`/v2/students`) : titre « Élèves », onglets « Élèves », « Nouvel élève », « Tuteurs » (et « Mes enfants », sans objet pour le propriétaire). Lire « Aucun élève pour le moment. » et "Créez le premier dossier avec « Nouvel élève ». ", les boutons « Exporter (CSV) » et « Nouvel élève », et les filtres « Statut », « Année », « Classe ».
2. Cliquer l'onglet **« Tuteurs »** (`/v2/guardians`) : titre « Tuteurs », « Aucun tuteur enregistré. ». Cliquer **« Nouveau tuteur »** (fenêtre « Créer un tuteur »).
3. Cliquer **« Créer »** sans rien saisir (test d'erreur ci-dessous), puis saisir :

| Champ | Valeur à saisir |
| :--- | :--- |
| Nom | `ADOU` |
| Prénoms | `Roland` |
| Sexe | « Masculin » |
| Téléphone | `+225 07 00 00 00 11` |
| Ville | `Abidjan` |
| Profession | `Commerçant` |

4. Cliquer **« Créer »**.
5. Test du doublon : cliquer **« Nouveau tuteur »**, saisir seulement Nom `ADOU` et Prénoms `Roland`, **« Créer »**, lire l'encadré, cocher « Ce n'est pas un doublon : créer quand même », puis **« Créer »** avec « Motif de la création » vide. Fermer la fenêtre sans créer.

✅ Action 4 : « Le tuteur ADOU Roland a été créé. » ; la ligne apparaît avec le téléphone `+2250700000011`, **0** enfant et la pastille « Sans compte ». Action 5 : l'encadré annonce « 1 dossier ressemble à cette personne » avec « Même nom » et « date de naissance inconnue », rôle « Tuteur » ; le tuteur n'existe qu'une fois (recherche `adou`).

⚠️ *Test d'erreur* :
- formulaire vide : « Ce champ est obligatoire. » sous « Nom » et sous « Prénoms » ;
- e-mail `roland.adou.exemple.test` : « Adresse e-mail invalide. » ;
- téléphone `12` : « Téléphone trop court. » ; téléphone `abcdefg` : refus du serveur « Numéro de téléphone invalide. » ;
- doublon confirmé sans motif : « Un motif est requis pour confirmer un doublon possible. »

☐ OK ☐ KO

### Étape 53 — Créer les cinq autres tuteurs
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Onglet **« Tuteurs »** (`/v2/guardians`)

1. Pour chaque ligne du tableau : **« Nouveau tuteur »**, saisir les champs, **« Créer »**.

| Nom | Prénoms | Sexe | Téléphone | Ville |
| :--- | :--- | :--- | :--- | :--- |
| `ASSI` | `Carine` | « Féminin » | `+225 07 00 00 00 12` | `Abidjan` |
| `KOUASSI` | `Hervé` | « Masculin » | `+225 07 00 00 00 14` | `Abidjan` |
| `YAO` | `Mariam` | « Féminin » | `+225 07 00 00 00 15` | `Abidjan` |
| `COULIBALY` | `Awa` | « Féminin » | `+225 07 00 00 00 17` | `Abidjan` |
| `N'GUESSAN` | `Berthe` | « Féminin » | `+225 07 00 00 00 18` | `Abidjan` |

2. Dans « Rechercher un tuteur », saisir `kouassi` : une ligne. Saisir `zzzz` : « Aucun tuteur ne correspond à votre recherche. ».

✅ Messages « Le tuteur … a été créé. » (un par fiche) ; la liste compte **6 tuteurs**, tous avec **0** enfant et « Sans compte ». Aucun encadré de doublon (noms et téléphones tous différents).

☐ OK ☐ KO

### Étape 54 — Créer l'élève ADOU Aïcha avec son tuteur
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Onglet **« Nouvel élève »** (`/v2/students/new`)

1. Étape « Identité » : saisir

| Champ | Valeur à saisir |
| :--- | :--- |
| Nom | `ADOU` |
| Prénoms | `Aïcha` |
| Sexe | « Féminin » |
| Date de naissance | `14/03/2021` |
| Lieu de naissance | `Abidjan` |
| Nationalité (code pays) | `CI` |
| Ville | `Abidjan` |
| Adresse | `Cocody, Riviera (fictif)` |
| Lieu de résidence | `Cocody` |

   puis **« Suivant »** : aucun encadré de doublon.
2. Étape « Tuteurs » : cliquer **« Ajouter un tuteur existant »** (fieldset « Tuteur 1 »). Cliquer d'abord **« Suivant »** sans rien choisir (test d'erreur). Puis, dans « Tuteur », taper `ADOU` et choisir ADOU Roland ; « Lien de parenté » = « Père ». Laisser cochés « Contact principal », « Contact d'urgence » et « Accès au portail parents » ; **cocher « Responsable financier » et « Autorité légale »**. **« Suivant »**.
3. Étape « Récapitulatif » : lire « Élève », « Date de naissance », « Tuteurs à lier » (`1`) et la note « Le matricule est attribué automatiquement à la création. » Cliquer **« Créer le dossier »**.

✅ Écran « Dossier créé » : « ADOU Aïcha — matricule 00001. » (relever le matricule) avec « Ouvrir la fiche » et « Inscrire maintenant ». Dans `/v2/guardians`, ADOU Roland compte maintenant **1** enfant. L'élève est « Actif » et « Non inscrit » dans `/v2/students`.

⚠️ *Test d'erreur* (avant « Créer le dossier ») :
- étape « Identité », « Sexe » laissé sur « Choisir… » puis « Suivant » : « Le sexe est obligatoire pour un élève. » ; « Nom » vide : « Ce champ est obligatoire. » ;
- étape « Identité », date de naissance `12/05/2030` puis « Suivant » : « Date de naissance invraisemblable. » (refus du serveur, la date est dans le futur) ; remettre `14/03/2021` ;
- étape « Tuteurs », entrée sans tuteur choisi : « Choisissez un tuteur. » ; sans lien : « Choisissez le lien de parenté. »

L'écran « Dossier créé » n'a pas de bouton "créer un autre" : pour saisir l'élève suivant, ouvrir l'onglet « Élèves » puis « Nouvel élève » (ou recharger la page `/v2/students/new`).

🕓 *Test de droit* : à jouer quand le compte **instituteur** existera : taper `/v2/students/new` doit afficher « Accès refusé » (un instituteur ne crée pas de dossier élève).

☐ OK ☐ KO

### Étape 55 — Signaler un doublon d'élève
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Onglet **« Nouvel élève »** (`/v2/students/new`)

1. Ouvrir l'onglet « Élèves » puis « Nouvel élève » (ou recharger la page). Ressaisir l'identité exacte : Nom `ADOU`, Prénoms `Aïcha`, Sexe « Féminin », Date de naissance `14/03/2021`, puis **« Suivant »**.
2. Changer la date en `15/03/2021`, **« Suivant »** : plus de doublon. Revenir en arrière avec **« Précédent »**, remettre `14/03/2021`.
3. Cliquer de nouveau **« Suivant »** (l'encadré du doublon réapparaît), cocher « Ce n'est pas un doublon : créer quand même » (le champ « Motif de la création » apparaît), laisser ce champ vide, **« Suivant »**. **Quitter la page sans rien créer** (onglet « Élèves »).

✅ Action 1 : l'encadré affiche « 1 dossier ressemble à cette personne », « Même nom et même date », le matricule `00001`, le rôle « Élève » et le lien « Ouvrir la fiche » ; le passage à l'étape suivante est bloqué par « Des dossiers similaires existent : confirmez la création avec un motif ou ouvrez le dossier existant. » Action 2 : deux homonymes de dates différentes ne sont pas des doublons. Action 3 : « Un motif est requis pour confirmer un doublon possible. »

☐ OK ☐ KO

### Étape 56 — Créer les cinq autres élèves saisis à la main
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Onglet **« Nouvel élève »** (`/v2/students/new`)

1. Pour chaque ligne, dans cet ordre (revenir à « Nouvel élève » entre deux élèves, voir l'étape précédente) : étape « Identité » (champs du tableau, plus « Lieu de naissance » = `Abidjan`, « Nationalité (code pays) » = `CI`, « Ville » = `Abidjan`), **« Suivant »** ; étape « Tuteurs » : **« Ajouter un tuteur existant »**, choisir le tuteur, « Lien de parenté », cocher « Responsable financier » et « Autorité légale » (les trois cases par défaut restent cochées) ; **« Suivant »** ; **« Créer le dossier »**.

| Nom | Prénoms | Sexe | Date de naissance | Tuteur | Lien de parenté | Matricule attendu |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `ASSI` | `Brice` | « Masculin » | `02/07/2021` | ASSI Carine | « Mère » | `00002` |
| `KOUASSI` | `Aya` | « Féminin » | `09/05/2020` | KOUASSI Hervé | « Père » | `00003` |
| `YAO` | `Konan Éric` | « Masculin » | `30/01/2020` | YAO Mariam | « Mère » | `00004` |
| `COULIBALY` | `Ibrahim` | « Masculin » | `11/04/2015` | COULIBALY Awa | « Mère » | `00005` |
| `N'GUESSAN` | `Kouamé` | « Masculin » | `05/12/2015` | N'GUESSAN Berthe | « Mère » | `00006` |

2. Ouvrir `/v2/students` : lire la liste.

✅ Après chaque création : « Dossier créé » avec « NOM Prénoms — matricule 0000N. ». La liste `/v2/students` compte **6 élèves**, tous « Actif » et « Non inscrit » ; la liste des tuteurs montre **1 enfant** pour chacun des six tuteurs. Aucun encadré de doublon (les noms de famille sont partagés entre élève et tuteur, mais pas les prénoms).

☐ OK ☐ KO

### Étape 57 — Lire la fiche d'un élève, la modifier, lier un tuteur
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Personnes »** > **"Élèves"** > fiche de ADOU Aïcha (`/v2/students`)

1. Dans « Rechercher un élève », saisir `adou`, ouvrir la fiche. Lire l'en-tête : « Matricule 00001 », pastilles « Actif » et « Non inscrit », boutons « Tous les élèves », « Inscrire », « Modifier », « Changer le statut », et les onglets « Identité », « Tuteurs », « Urgences », « Parcours scolaire », « Statut », « Pièces ».
2. Onglet « Identité » : section « État civil » (« Compte du portail » = « Aucun compte »), section « Coordonnées », puis « Tuteur principal » (ADOU Roland, lien Père). Section « Informations sensibles » : cliquer **« Afficher les informations sensibles »**, constater que les champs sont vides, puis **« Masquer »**.
3. Cliquer **« Modifier »**, changer « Lieu de résidence » en `Plateau`, **« Enregistrer »**. Rouvrir, remettre `Cocody`, **« Enregistrer »**.
4. Onglet « Tuteurs » : une ligne ADOU Roland (téléphone sous le nom), lien « Père », pastilles « Principal », « Urgence », « Financier », « Autorité », « Portail », colonne « Validité » « Depuis le … ». **Ne pas cliquer « Inviter au portail »** (même remarque que pour le personnel : accès réel, aucun e-mail envoyé en développement).
5. Cliquer **« Lier un tuteur »** (fenêtre « Lier un tuteur ») : « Tuteur existant », choisir ADOU Roland, « Lien de parenté » = « Père », **« Lier un tuteur »**. Fermer la fenêtre, la rouvrir, choisir ASSI Carine, « Lien de parenté » = « Mère », cocher « Contact principal », **« Lier un tuteur »**.

✅ Action 3 : « La fiche a été mise à jour. » (deux fois). Action 5, premier essai : refus « Ce tuteur est déjà lié à cet élève. » Second essai : refus « Cet élève a déjà un contact principal. » (message du serveur ; la règle « un seul contact principal par élève » figure aussi dans l'aide de la case). *(si le lien ASSI Carine est tout de même créé, le clôturer avec « Clôturer le lien » et le noter)*

⚠️ *Test d'erreur* : « Modifier » avec « Nom » vidé : « Ce champ est obligatoire. » ; « Lier un tuteur » sans choisir de tuteur : « Choisissez un tuteur. »

☐ OK ☐ KO

### Étape 58 — Déposer une pièce au dossier de l'élève
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Fiche de ADOU Aïcha > onglet **« Pièces »**

Fichiers : `docs/guide-test/jeux-de-donnees/04-piece-eleve-test-guide.pdf` (valide) et `docs/guide-test/jeux-de-donnees/04-piece-eleve-invalide-test-guide.txt` (refusé).

1. Ouvrir l'onglet « Pièces » : « Chaque consultation de ces pièces est enregistrée dans le journal d'audit de l'établissement. » et « Aucune pièce au dossier. ». (Si une fenêtre « Confirmez votre identité » s'affiche, saisir le code MFA du moment.)
2. Cliquer **« Déposer une pièce »** et saisir :

| Champ | Valeur à saisir |
| :--- | :--- |
| Type de pièce | « Acte de naissance » |
| Fichier | `04-piece-eleve-test-guide.pdf` |
| Intitulé | `Acte de naissance d'Aïcha (fictif)` |
| Date d'émission | `20/03/2021` |

3. Cliquer **« Déposer »**. Puis **« Ouvrir »** sur la pièce (elle s'ouvre dans un nouvel onglet).
4. Cliquer **« Retirer »**, saisir « Motif du retrait » `Pièce de test retirée`, confirmer **« Retirer »**.

✅ "La pièce "Acte de naissance d'Aïcha (fictif)" est déposée. » ; la pièce apparaît « Version 1 » et « Active », puis, après le retrait, elle est « Retirée » dans l'historique (case « Afficher l'historique des versions »). ⚠️ *Écart connu* : si le stockage de fichiers n'est pas branché sur l'environnement local, le dépôt répond « Le stockage de fichiers n'est pas disponible. » : noter le constat et passer.

⚠️ *Test d'erreur* : « Déposer » sans fichier : « Choisissez un fichier. » ; fichier `04-piece-eleve-invalide-test-guide.txt` : « Format non accepté : PDF, JPEG, PNG ou WebP uniquement. » ; motif de retrait de 3 caractères : « Le motif doit comporter au moins 5 caractères. »

☐ OK ☐ KO

## Phase 9 — Inscriptions dans les classes

Objectif : inscrire les six élèves saisis à la main dans leur classe, observer les numéros d'inscription et ce que fait chaque politique de confirmation, puis contrôler les effectifs. Précondition : phases précédentes jouées ; les classes sont encore en « Brouillon » (une classe en brouillon accepte les inscriptions). Les trois autres élèves seront inscrits par l'import.

### Étape 59 — Inscrire ADOU Aïcha en Grande Section A
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Académique »** > **"Inscriptions"** > onglet **« Nouvelle inscription »** (`/v2/enrollments/new`)

1. Étape « Élève » : laisser « Élève existant » ; cliquer d'abord **« Suivant »** sans élève (test d'erreur), puis, dans « Élève », taper `ADOU` et choisir ADOU Aïcha. **« Suivant »**.
2. Étape « Classe » : « Année » = 2026-2027 (présélectionnée si l'année est courante ou ouverte, sinon la choisir) ; cliquer **« Suivant »** sans classe (test d'erreur), puis « Classe » = `Grande Section A`. Lire l'effectif affiché (« Effectif actuel : 0. Pas de capacité définie. » ou « Effectif : 0 sur N. La capacité est indicative. », selon la capacité saisie à la création de la classe). « Mode d'inscription » = « Par classe (cursus complet) » ; « Date d'inscription » vide (aujourd'hui) ; « Redoublement » décoché. **« Suivant »**.
3. Étape « Financement » : « Type de financement » = « Privé » (laisser). **« Suivant »**.
4. Étape « Récapitulatif » : lire « Élève », « Classe », « Mode », « Financement » et la note « Selon la politique de l'établissement, l'inscription peut rester en attente jusqu'au paiement des frais ou à sa confirmation. » Cliquer **« Inscrire »**.

✅ Écran « Inscription enregistrée » : « N° d'inscription : FLAM-2026-GS-0001. Statut : active. » (politique « Automatique » : aucune attente). Boutons « Ouvrir l'inscription », « Inscrire un autre élève », « Retour à la liste ». Relever le numéro : si « — » s'affiche à la place, le motif de l'étape *Fixer le motif du numéro d'inscription* n'a pas été enregistré.

⚠️ *Test d'erreur* : à l'étape 1, « Suivant » sans élève : « Choisissez un élève. » ; à l'étape 2, sans classe : « Choisissez une classe. » Puis réinscrire ADOU Aïcha dans `Grande Section A` (« Inscrire un autre élève ») : avertissement « Cet élève a déjà une inscription en cours cette année. Le serveur refusera un doublon dans la même classe. » à l'étape « Classe », puis refus de « Inscrire » : « L'apprenant a déjà une inscription vivante dans cette classe. »

🕓 *Test de droit* : à jouer quand le compte **instituteur** existera : taper `/v2/enrollments/new` doit afficher « Accès refusé ».

☐ OK ☐ KO

### Étape 60 — Inscrire ASSI Brice, KOUASSI Aya et YAO Konan Éric (politique « Automatique »)
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Onglet **« Nouvelle inscription »** (`/v2/enrollments/new`)

1. Depuis l'écran « Inscription enregistrée », cliquer **« Inscrire un autre élève »**, ou rouvrir l'onglet « Nouvelle inscription ». Pour chaque ligne : choisir l'élève, la classe, laisser « Par classe (cursus complet) » et « Privé », **« Suivant »** trois fois, **« Inscrire »**.

| Élève | Classe | N° d'inscription attendu |
| :--- | :--- | :--- |
| ASSI Brice | `Grande Section A` | `FLAM-2026-GS-0002` |
| KOUASSI Aya | `CP1 A` | `FLAM-2026-CP1-0003` |
| YAO Konan Éric | `CP1 A` | `FLAM-2026-CP1-0004` |

✅ Chaque inscription : "Statut : active." et un numéro de la forme `FLAM-2026-<niveau>-<numéro d'ordre du dossier sur 4 chiffres>`. Le numéro d'ordre est celui du matricule de l'élève (`00002` donne `0002`) : il ne dépend pas de l'ordre des inscriptions. Les valeurs attendues ci-dessus supposent les matricules `00001` à `00006` de la phase précédente.

☐ OK ☐ KO

### Étape 61 — Essayer la politique « Après paiement des frais d'inscription » (aucun frais configuré)
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Académique »** > **"Paramètres académiques"** (`/v2/academic/settings`), onglet **« Inscriptions »**, puis **"Inscriptions"** > **« Nouvelle inscription »**

1. Dans l'onglet « Inscriptions », choisir le choix **« Après paiement des frais d'inscription »** (« L'inscription reste en attente jusqu'au paiement des frais d'inscription. »), puis **« Enregistrer »**.
2. Inscrire **COULIBALY Ibrahim** en `CM2 A` (mode « Par classe », financement « Privé »).
3. Ouvrir l'inscription (**« Ouvrir l'inscription »**) et lire la section « Confirmation et frais d'inscription ».

✅ Action 1 : « Les politiques d'inscription sont enregistrées. » Action 2 : « N° d'inscription : FLAM-2026-CM2-0005. Statut : active. » : la politique attend un paiement **seulement quand des frais d'inscription sont dus** ; l'école n'en a défini aucun, donc rien ne bloque. Action 3 : « Politique de confirmation : confirmée au paiement des frais d'inscription. » et statut « Active » ; pas de message d'attente. *(à vérifier : si le statut est "En attente de confirmation", le module Finance n'a pas répondu "aucun frais dû" ; le noter, puis confirmer avec « Confirmer sans paiement » comme à l'étape suivante.)*

☐ OK ☐ KO

### Étape 62 — Essayer la politique « Après paiement intégral » et confirmer sans paiement
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Académique »** > **"Paramètres académiques"** (`/v2/academic/settings`), onglet **« Inscriptions »**, puis **"Inscriptions"**

1. Dans l'onglet « Inscriptions », choisir **« Après paiement intégral »** (« L'inscription reste en attente jusqu'au paiement de la totalité des frais. »), **« Enregistrer »**.
2. Inscrire **N'GUESSAN Kouamé** en `CM2 A` (mode « Par classe », financement « Privé »).
3. Ouvrir l'inscription (**« Ouvrir l'inscription »**). Lire le statut et la section « Confirmation et frais d'inscription ». Repérer les boutons de l'en-tête.
4. Cliquer **« Confirmer sans paiement »** (fenêtre « Confirmer sans paiement (dérogation) »). Saisir d'abord le motif `abc`, valider, puis remplacer par `Test du guide : politique de paiement intégral` et cliquer **« Confirmer sans paiement »**.
5. Dans l'onglet « Inscriptions » des paramètres, remettre le choix **« Automatique »**, **« Enregistrer »**.

✅ Action 2 : « N° d'inscription : FLAM-2026-CM2-0006. Statut : en attente de confirmation. » Action 3 : statut « En attente » ; « Politique de confirmation : confirmée au paiement intégral. » ; « L'inscription attend sa confirmation, selon la politique ci-dessus. » ; « L'inscription sera confirmée automatiquement au paiement. Une personne habilitée peut la confirmer sans paiement, en indiquant un motif. » ; boutons « Confirmer sans paiement » et « Annuler » (le propriétaire détient la permission de dérogation). Action 4 : motif `abc` refusé par « Le motif doit comporter au moins 5 caractères. » ; ensuite « L'inscription est confirmée par dérogation. », statut « Active », et les lignes « Mode de confirmation : dérogation de la direction (sans paiement). » et « Motif de la dérogation : Test du guide : politique de paiement intégral ». Action 5 : « Les politiques d'inscription sont enregistrées. » ; **la politique « Automatique » est rétablie pour la suite.**

Pour mémoire (non joué) : sous « Manuelle », l'inscription reste en attente et le bouton s'appelle simplement « Confirmer » (aucun motif demandé).

🕓 *Test de droit* : à jouer quand le compte **secrétariat** existera : sous « Après paiement intégral », ce compte ne voit que « Annuler » (pas de « Confirmer sans paiement » : la dérogation est réservée à la direction) ; le directeur la voit.

☐ OK ☐ KO

### Étape 63 — Contrôler les inscriptions et les effectifs
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Académique »** > **"Inscriptions"** > onglet **« Liste des inscriptions »** (`/v2/enrollments`)

1. Lire le tableau « Liste des inscriptions » : colonnes « Élève », « Classe », « N° d'inscription », « Inscrit le », « Financement », « Mode », « Statut », « Actions ». Filtrer sur « Statut » = « Active », puis sur « Classe » = `CM2 A`.
2. Saisir `FLAM-2026-CM2-0005` dans « N° d'inscription » (filtre) : une ligne.
3. Ouvrir le menu **"Classes"** (`/v2/academic/classrooms`), puis la classe `CM2 A` : lire « Effectif » et la liste « Élèves ».

✅ **6 inscriptions**, toutes « Active », financement « Privé », mode « Par classe », deux par classe. La fiche de `CM2 A` indique un effectif de 2 (ou « 2 sur N » si une capacité est définie) ; les élèves sont listés avec leur matricule et leur numéro d'inscription (`FLAM-2026-CM2-0005`, `FLAM-2026-CM2-0006`). ⚠️ *Écart connu* : la colonne « Inscription » de cette liste affiche le code brut du statut (`ACTIVE`) au lieu d'un libellé français. Dans `/v2/students`, la colonne « Inscription » affiche « Active ».

☐ OK ☐ KO

## Phase 10 — Import des trois derniers élèves

Objectif : importer DAGO Chantal, TRAORE Fatoumata et TANOH Marie-Ange (un par classe, avec inscription) puis leurs tuteurs, et observer les rapports d'erreurs. Précondition : phases précédentes jouées (6 élèves saisis, politique « Automatique » rétablie, classes de codes `GS-A`, `CP1-A`, `CM2-A`). Les fichiers sont dans `docs/guide-test-primary/jeux-de-donnees/` (UTF-8 avec BOM, séparateur `;`, mêmes en-têtes que les modèles de l'application) :

| Fichier | Données | Résultat attendu |
| :--- | :--- | :--- |
| `01-eleves-colonne-manquante-primaire.csv` | Élèves | colonne « Sexe » absente : import bloqué à l'association des colonnes |
| `01-eleves-valide-primaire.csv` | Élèves | 3 lignes : 3 à créer (et à inscrire), 0 erreur |
| `02-tuteurs-valide-primaire.csv` | Parents et tuteurs | 3 lignes : 3 liens, 0 erreur |
| `01-eleves-erreurs-primaire.csv` | Élèves | 9 lignes : 0 à créer, 1 à ignorer, 8 en erreur |
| `02-tuteurs-erreurs-primaire.csv` | Parents et tuteurs | 6 lignes : 0 à créer, 1 à ignorer, 5 en erreur |

Si les codes de vos classes ne sont pas `GS-A`, `CP1-A` et `CM2-A`, remplacer la colonne « Classe (code) » des fichiers d'élèves avant de commencer. **Les imports valides écrivent des données définitives** : ne les jouer qu'une fois. **Les fichiers d'essai laissent chacun un import « actif »** (état « Fichier reçu » ou « Prêt à importer » sans lancement) : l'établissement accepte 5 imports actifs au plus, et le worker annule les brouillons abandonnés chaque nuit (tâche `imports.purge`, 04:25) ; ne pas rejouer ces essais plusieurs fois de suite. Garder l'onglet au premier plan pendant la validation et l'exécution.

### Étape 64 — Lire l'historique des imports et le modèle « Élèves »
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Imports »** > **"Imports Excel / CSV"** (`/v2/imports`)

1. Lire la barre d'onglets : « Historique », « Nouvel import », « Modèles », « Paramètres » (le propriétaire voit les quatre). Lire « Aucun import pour le moment. » et « Lancez un premier import pour intégrer vos élèves ou vos enseignants. »
2. Cliquer **« Nouvel import »** (`/v2/imports/new`) : titre « 1. Choisir l'importeur et envoyer le fichier ». Cliquer **« Envoyer et continuer »** sans rien choisir, puis choisir la carte **"Élèves"** et recliquer.
3. Lire la section des colonnes attendues pour « Élèves » : « obligatoire » sur Nom, Prénoms et Sexe. Cliquer **« Télécharger le modèle CSV »** et ouvrir `modele-import-students.csv` dans le Bloc-notes.

✅ Action 1 : l'historique est vide. Action 2 : « Choisissez le type de données à importer. » puis, une fois la carte choisie, « Choisissez un fichier .xlsx, .xls, .ods ou .csv. » Action 3 : les 18 en-têtes du modèle (de « Matricule d'origine » à « Référence d'affectation ») sont exactement ceux des fichiers fournis ; le séparateur est `;`.

☐ OK ☐ KO

### Étape 65 — Fichier à colonne manquante (« Sexe »)
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Onglet **« Nouvel import »** (`/v2/imports/new`)

Fichier : `docs/guide-test-primary/jeux-de-donnees/01-eleves-colonne-manquante-primaire.csv` (17 colonnes : celle du « Sexe » a été retirée).

1. Carte **"Élèves"** ; « Fichier à importer » = le fichier ; **« Envoyer et continuer »**.
2. Titre « 2. Associer les colonnes du fichier » : lire "Le fichier compte 17 colonne(s).". Repérer le champ « Sexe » (obligatoire) : aucune colonne ne lui est proposée.
3. Cliquer **« Enregistrer et valider le fichier »** sans rien changer.
4. Ouvrir l'onglet **« Historique »**.

✅ Action 3 : sous le champ « Sexe » : « Associez une colonne à ce champ obligatoire. » et bandeau « Champs obligatoires sans colonne : Sexe. » ; la validation ne démarre pas. Action 4 : une ligne `01-eleves-colonne-manquante-primaire.csv`, Données « Élèves », état « Fichier reçu ». Ne pas la reprendre : elle sera abandonnée par la tâche de nuit.

☐ OK ☐ KO

### Étape 66 — Importer DAGO Chantal, TRAORE Fatoumata et TANOH Marie-Ange (fichier valide)
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Onglet **« Nouvel import »** (`/v2/imports/new`)

Fichier : `docs/guide-test-primary/jeux-de-donnees/01-eleves-valide-primaire.csv`.

1. Carte **"Élèves"** ; fichier ci-dessus ; **« Envoyer et continuer »**.
2. Étape « 2. Associer les colonnes du fichier » : "Le fichier compte 18 colonne(s)." ; vérifier que les 18 champs sont associés. Options : laisser d'abord « Année scolaire des inscriptions » **vide** ; « Doublons probables (même nom et même naissance) » = « Refuser (recommandé) » ; « Si la donnée existe déjà » = « Ignorer les lignes déjà présentes ». Cliquer **« Enregistrer et valider le fichier »** et attendre la barre « Validation des lignes ».
3. Étape « 4. Erreurs et aperçu avant import » : lire les décomptes et les messages, puis cliquer **« Modifier les colonnes »**, choisir « Année scolaire des inscriptions » = **2026-2027** (la mention « (courante) » s'ajoute si l'année est courante), et refaire **« Enregistrer et valider le fichier »**.
4. Aperçu : lire les décomptes, ouvrir « Lignes qui seront créées ». Mode « Importer les lignes valides seulement » (par défaut). Cocher « J'ai consulté l'aperçu et les erreurs, et je confirme le lancement de l'import. », puis **« Lancer l'import »**.
5. Attendre « Import en cours », puis le rapport.

✅ Après l'action 2 (année vide) : « En erreur » **3**, chaque ligne avec `La colonne « Classe » exige l'option « Année scolaire des inscriptions ».` ; « Lancer l'import » est inactif. Après l'action 3 (année choisie) : « À créer » **3**, « À mettre à jour » 0, « À ignorer » 0, « En erreur » 0, « Avertissements » 0 et « Aucune erreur : toutes les lignes sont valides. » ⚠️ **Irréversible** : les 3 élèves sont créés et inscrits. Action 5 : rapport « Import terminé », « Décomptes de l'import » : « Créées » **3**, « Mises à jour » 0, « Ignorées » 0, « En erreur » 0 ; « Détails de l'import » : Fichier, Données « Élèves », Auteur, Mode « Lignes valides seulement ». Si la barre reste à 0, vérifier que le worker est démarré et recharger la page.

Contrôle : `/v2/students` compte **9 élèves** ; DAGO Chantal (`00007`, `Grande Section A`), TRAORE Fatoumata (`00008`, `CP1 A`), TANOH Marie-Ange (`00009`, `CM2 A`), tous « Actif » avec l'inscription « Active » (politique « Automatique »). Dans `/v2/enrollments`, leurs numéros sont `FLAM-2026-GS-0007`, `FLAM-2026-CP1-0008` et `FLAM-2026-CM2-0009`. Ils n'ont pas encore de tuteur (« Aucun tuteur lié. » dans l'onglet « Tuteurs »).

☐ OK ☐ KO

### Étape 67 — Importer les trois tuteurs, puis essayer le fichier d'erreurs des tuteurs
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Onglet **« Nouvel import »** (`/v2/imports/new`)

Fichiers : `docs/guide-test-primary/jeux-de-donnees/02-tuteurs-valide-primaire.csv`, puis `02-tuteurs-erreurs-primaire.csv`. Prérequis : l'étape précédente est exécutée (le fichier désigne les élèves par leur « Matricule d'origine » `FLA-ELV-007` à `009`).

1. Carte **"Parents et tuteurs"** ; fichier valide ; **« Envoyer et continuer »**. Étape des colonnes : "Le fichier compte 18 colonne(s).", option « Doublons probables (même nom, même téléphone) » = « Refuser (recommandé) ». **« Enregistrer et valider le fichier »**.
2. Aperçu puis **« Lancer l'import »** (case de confirmation cochée). Lire le rapport.
3. Ouvrir `/v2/guardians`, puis la fiche de **TRAORE Issouf**, puis la fiche de l'élève TRAORE Fatoumata, onglet « Tuteurs ».
4. Nouvel import avec le fichier d'erreurs, mêmes options. Lire l'aperçu et le tableau « Erreurs du fichier ». **Ne pas lancer** (le bouton est inactif).

✅ Action 1 : « À créer » **3**, « En erreur » 0. Action 2 : « Import terminé », « Créées » **3**. Action 3 : la liste compte **9 tuteurs** ; TRAORE Issouf a **1** enfant (TRAORE Fatoumata) ; dans l'onglet « Tuteurs » de l'élève : lien « Père », pastilles « Principal », « Urgence », « Financier », « Autorité », « Portail » (pas « Retrait »). Action 4 : « À créer » 0, « À ignorer » 1, « En erreur » **5**, avec ces messages par ligne du tableur :

| Ligne | Contenu | Message attendu |
| :--- | :--- | :--- |
| 2 | élève `FLA-ELV-X99` | `Aucun élève avec le matricule "FLA-ELV-X99" (importez d'abord les élèves).` |
| 3 | lien `Cousin` | `Lien de parenté "Cousin" inconnu (liens : …)` (liste des liens à relever) |
| 4 | nom du tuteur vide | `Le champ « Nom du tuteur » est obligatoire.` |
| 5 | téléphone `07-AB` | `Téléphone : "07-AB" n'est pas un numéro de téléphone valide.` |
| 6 | Contact principal `peut-être` | `Contact principal : « peut-être » n'est pas une valeur oui / non.` |
| 7 | lien déjà importé (DAGO Prosper) | ligne ignorée : `Déjà importée lors d'un import précédent : ligne ignorée (aucun doublon).` |

Blocage affiché : « Aucune ligne à écrire : toutes les lignes sont invalides ou déjà importées. »

☐ OK ☐ KO

### Étape 68 — Fichier d'élèves avec erreurs : date invalide, doublons, rapport d'erreurs
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Onglet **« Nouvel import »** (`/v2/imports/new`)

Fichier : `docs/guide-test-primary/jeux-de-donnees/01-eleves-erreurs-primaire.csv` (9 lignes de données). Prérequis : les trois élèves valides sont déjà importés et ADOU Aïcha existe (saisie à la main).

1. Carte **"Élèves"** ; fichier ci-dessus ; **« Envoyer et continuer »**. Colonnes : les 18 champs sont associés ; options : « Année scolaire des inscriptions » = **2026-2027**, « Doublons probables (même nom et même naissance) » = « Refuser (recommandé) », « Ignorer les lignes déjà présentes ». **« Enregistrer et valider le fichier »**.
2. Aperçu : lire les décomptes, « Problèmes les plus fréquents » et le tableau « Erreurs du fichier ». Ouvrir « Lignes qui seront ignorées ».
3. Constater que le mode **« Tout ou rien »** est grisé et que **« Lancer l'import »** est inactif.
4. Cliquer **« Télécharger les erreurs (CSV) »** (puis, si l'on veut, « Télécharger les erreurs (Excel) »).

✅ « À créer » **0**, « À ignorer » **1**, « En erreur » **8** (lignes 3 à 10). Messages attendus, par ligne du tableur (ligne 1 = en-têtes) :

| Ligne | Contenu | Message attendu |
| :--- | :--- | :--- |
| 2 | DAGO Chantal, `FLA-ELV-007` | ignorée : `Déjà importée lors d'un import précédent : ligne ignorée (aucun doublon).` (avertissement) |
| 3 | même matricule `FLA-ELV-007` | `Cette ligne répète la ligne 2 du fichier (même identifiant) : elle est ignorée.` |
| 4 | naissance `31/02/2021` | `Date de naissance : "31/02/2021" n'est pas une date valide (attendu JJ/MM/AAAA ou AAAA-MM-JJ).` |
| 5 | sexe vide | `Le champ « Sexe » est obligatoire.` |
| 6 | ADOU Aïcha, `14/03/2021` | `Doublon probable avec : ADOU Aïcha (00001). Vérifiez, ou choisissez « créer malgré le doublon ».` |
| 7 | classe `CE2-Z` | `Classe "CE2-Z" inconnue pour cette année scolaire.` |
| 8 | nom vide | `Le champ « Nom » est obligatoire.` |
| 9 | naissance `01/01/2099` | `La date de naissance est dans le futur.` |
| 10 | e-mail `rita.zadi.exemple.test` | `E-mail : "rita.zadi.exemple.test" n'est pas une adresse e-mail valide.` |

Action 3 : « Indisponible tant que le fichier contient des erreurs. » sous « Tout ou rien » ; ligne de blocage « Aucune ligne à écrire : toutes les lignes sont invalides ou déjà importées. » Action 4 : le navigateur télécharge `01-eleves-erreurs-primaire-erreurs.csv` (une ligne par problème : ligne, colonne du fichier, champ, gravité, code, message, puis les valeurs du fichier). Le nombre exact d'« Avertissements » (au moins 1, la ligne 2) est à relever. **Ne rien lancer** : aucun élève ne doit être créé ; `/v2/students` compte toujours 9 élèves. ⚠️ Si l'on choisit « Créer malgré le doublon » pour la ligne 6, une seconde ADOU Aïcha serait créée : ne pas le faire.

☐ OK ☐ KO

## Phase 11 — Titulaires et activation des classes

Objectif : vérifier la règle « Exiger un titulaire pour activer une classe », désigner KOFFI Adjoua (CP1 A), BAMBA Séraphin (CM2 A) et ZOKORA Sylvie (Grande Section A), activer les trois classes, puis lire l'effet sur « Avancement des classes » et « Ma classe ». Précondition : les phases précédentes sont jouées (3 élèves inscrits par classe) ; chaque classe a un curriculum **publié** rattaché (partie précédente) : l'activation vérifie d'abord le curriculum, puis le titulaire.

### Étape 69 — Lire la règle du titulaire et constater le refus d'activation
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** (`/v2/primary/direction`), accès rapide **« Paramètres »** (`/v2/primary/parametres`), puis **"Classes"** (`/v2/academic/classrooms`)

1. Ouvrir `/v2/primary/direction` (« Avancement des classes ») : attendre 3 à 4 secondes. Lire le tableau « Avancement par classe et par période » et la règle d'affichage. Cliquer l'accès rapide **« Paramètres »**.
2. Page « Paramètres du pack Primaire » : section « Réglages de l'établissement » ; lire la case **« Exiger un titulaire pour activer une classe »** et son aide « Si vous désactivez cette règle, l'action est auditée. ». **Ne pas la décocher.**
3. Ouvrir `/v2/academic/classrooms`, cliquer la classe `Grande Section A`. Lire l'état, la section « Élèves » (3 élèves) et la section « Enseignants » (« Aucune affectation d'enseignement. »). Cliquer **« Activer »** (fenêtre « Activer Grande Section A »), puis **« Activer »** dans la fenêtre.
4. Fermer la fenêtre (« Annuler » ou touche Échap).

✅ Action 1 : selon l'état de l'année, soit « Aucune classe n'est ouverte pour cette année. » (année encore en « Brouillon »), soit une ligne par classe et par période d'enseignement, avec la colonne « Élèves » à **3** par classe (seules les inscriptions « Active » comptent) et un état « Sans objet » (aucune compétence attendue tant qu'aucun référentiel n'est publié pour le niveau) ou « Rien de saisi ». L'écran n'affiche jamais le titulaire. Action 2 : la case est **cochée** (valeur par défaut d'une école neuve). Action 3 : état « Brouillon » ; au clic final, refus dans la fenêtre : `Une classe du primaire ne s'active qu'avec un instituteur titulaire : affectez-en un d'abord.` La classe reste en « Brouillon ». *(si le message parle plutôt de curriculum — « Choisissez un curriculum avant d'activer la classe. » ou « Le curriculum doit être publié avant d'activer la classe. » — la partie sur le curriculum est incomplète : la terminer, puis revenir ici.)*

Pour mémoire (non joué) : si le propriétaire décochait la règle, une classe sans titulaire pourrait être activée, et ce choix est consigné comme dérogation sensible dans le journal d'audit ; la règle ne concerne que les classes de maternelle et de primaire.

☐ OK ☐ KO

### Étape 70 — Désigner les trois titulaires
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Personnes »** > **"Affectations"** (`/v2/staff/assignments`)

1. Lire le titre « Affectations d'enseignement » et les onglets « Par classe » et « Par enseignant ». Dans l'onglet « Par classe », « Année » est présélectionnée ; lire « Choisissez une classe pour afficher sa matrice d'affectations. »
2. Dans « Classe », taper `Grande Section` et choisir `Grande Section A`. Lire « Affectations de Grande Section A » et la ligne **« Titulaire de classe »** (« Aucun »). Cliquer **« Désigner »** (fenêtre « Désigner le titulaire de la classe »). Cliquer d'abord **« Affecter »** sans enseignant (test d'erreur), puis saisir :

| Champ | Valeur à saisir |
| :--- | :--- |
| Enseignant | `ZOKORA Sylvie` (taper `ZOKORA`, choisir la proposition) |
| Rôle | « Titulaire de classe » (déjà choisi) |
| Période | « Toute l'année » |
| Début | `07/09/2026` |
| Fin, Heures prévues, Note | (vides) |

3. Cliquer **« Affecter »**.
4. Test du second titulaire : sur la même classe, cliquer de nouveau **« Désigner »** (le bouton reste proposé même si un titulaire existe), choisir `BAMBA Séraphin` comme « Enseignant », garder le reste, **« Affecter »**. Fermer la fenêtre.
5. Recommencer les actions 2 et 3 pour `CP1 A` avec **KOFFI Adjoua**, puis pour `CM2 A` avec **BAMBA Séraphin** (même début `07/09/2026`).
6. Ouvrir l'onglet « Par enseignant », choisir `KOFFI Adjoua` ; ouvrir aussi la fiche `/v2/staff` de KOFFI, onglet « Charge horaire ».

✅ Action 3 : « L'affectation est enregistrée. » ; un encadré d'avertissement affiche `Aucun contrat actif ne couvre le début de cette affectation (la paie décide).` (aucun contrat n'a été créé : l'affectation est enregistrée quand même) ; la ligne « Titulaire de classe » affiche une pastille "ZOKORA Sylvie" avec « Remplacer » et « Terminer ». Si la classe n'a pas encore de curriculum rattaché, la matrice indique aussi « Aucune matière dans le curriculum de cette classe. » (sans effet sur le titulaire). Action 4 : refus `Cette classe a déjà un titulaire (ZOKORA Sylvie).` ; rien n'est créé. Action 6 : l'onglet « Par enseignant » liste l'affectation de KOFFI (« CP1 A », rôle « Titulaire de classe »). La fiche de KOFFI n'affiche aucune heure prévue (aucune saisie).

⚠️ *Test d'erreur* : « Affecter » sans enseignant : « Choisissez un enseignant. »

🕓 *Test de droit* : à jouer quand le compte **instituteur** existera : taper `/v2/staff/assignments` doit afficher « Accès refusé ».

☐ OK ☐ KO

### Étape 71 — Activer les trois classes (et, au besoin, poser l'enseignant généraliste)
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Académique »** > **"Classes"** (`/v2/academic/classrooms`)

1. Ouvrir `Grande Section A`. Lire la section « Enseignants » : ZOKORA Sylvie, rôle « Titulaire de classe ». Cliquer **« Activer »**, puis **« Activer »** dans la fenêtre « Activer Grande Section A ».
2. Recommencer pour `CP1 A` et `CM2 A`.
3. Dans la liste des classes, lire la colonne « État ».
4. *(Facultatif, recommandé avant les scénarios de la partie 2)* Pour que le titulaire soit aussi responsable de **toutes les matières** de sa classe : ouvrir `/v2/staff/assignments`, onglet « Par classe », choisir la classe, cliquer **« Désigner »** sur la ligne « Titulaire de classe », choisir le même enseignant, passer « Rôle » à « Responsable » : la case **« Enseignant généraliste (toutes les matières) »** apparaît (aide « Pour l'enseignement primaire : un seul enseignant pour toute la classe. »). La cocher, laisser « Toute l'année », « Début » = `07/09/2026`, puis **« Affecter »**.

✅ Action 1 : « La classe Grande Section A est active. » ; état « Active » (le garde accepte la classe : un titulaire existe). Action 3 : les trois classes sont « Active ». Action 4 : « L'affectation est enregistrée. » ; une ligne « Enseignant généraliste » apparaît dans la matrice avec le nom de l'enseignant. ⚠️ *Écart connu* : l'écran ne permet pas de cocher « toutes les matières » sur le rôle « Titulaire de classe » lui-même (la case n'existe que pour « Responsable »), alors que le modèle du pack prévoit un titulaire généraliste unique ; l'étape 4 en est le substitut. Elle est refusée tant que la classe est en « Brouillon » (« La classe est en brouillon : son curriculum n'est pas encore stable. »), d'où l'ordre : désigner, activer, puis compléter. *(l'utilité réelle de cette seconde affectation pour les droits du titulaire est à vérifier en partie 2)*

☐ OK ☐ KO

### Étape 72 — Lire « Avancement des classes » et « Ma classe » après l'affectation
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** (`/v2/primary/direction`), puis `/v2/primary/classe`

1. Ouvrir `/v2/primary/direction` (« Avancement des classes ») et attendre 3 à 4 secondes. Lire le tableau.
2. Ouvrir `/v2/primary/classe` (« Ma classe ») et lire les cartes.
3. Ouvrir `/v2/primary/competences` et lire le message ou la liste.

✅ Action 1 : une ligne par classe et par période d'enseignement de l'année (`Grande Section A`, `CP1 A`, `CM2 A`), colonne « Élèves » = **3**, « Saisies » et « Validées » en `0 sur N` (ou `0 sur 0` tant qu'aucun référentiel n'est publié), « Bilans scellés » `0 sur 0` ; l'écran ne montre jamais le titulaire : l'affectation et l'activation n'y changent rien (les classes en brouillon y figurent déjà si l'année est ouverte). Action 2 : comme le propriétaire détient le droit d'accès à toutes les classes du primaire, « Ma classe » liste **les trois classes** (effectif "3 élèves", périodes « verrouillée » ou « ouverte ») avec la pastille **« Non titulaire »** : le propriétaire n'est titulaire d'aucune. « Aucune classe ne vous est affectée. » ne s'affiche que si aucune classe d'une année ouverte n'existe (cas d'une année encore en « Brouillon »). *(lu dans le code : à vérifier à l'écran)* Action 3 : de même, la grille des compétences devrait lister les classes accessibles au propriétaire (au lieu de « Aucune classe ne vous est accessible. », qui reste le message d'un compte sans classe) *(à vérifier à l'écran)*.

🕓 *À jouer quand le compte **instituteur** existera* (partie 2, rôle `instituteur`, fiche liée par invitation) : `/v2/primary/classe` ne doit montrer **que** sa classe, avec la pastille **« Titulaire »** et "3 élèves" ; KOFFI Adjoua voit `CP1 A`, BAMBA Séraphin voit `CM2 A`, ZOKORA Sylvie voit `Grande Section A`. Ce même compte ne doit pas voir `/v2/primary/direction` (« Accès refusé »).

Récapitulatif des données à ce stade : 3 fiches de personnel (P0001 à P0003), 9 tuteurs, 9 élèves (`00001` à `00009`), 9 inscriptions « Active » (3 par classe), 3 titulaires désignés et 3 classes « Active ».

☐ OK ☐ KO

## Phase 12 — Appel du jour par demi-journée

Objectif : faire l'appel du vendredi 9 octobre 2026 pour les trois classes (un seul appel pour la maternelle, deux — matin et après-midi — pour le primaire), puis valider ces appels. Précondition : phases de configuration terminées (année 2026-2027 ouverte, classes Grande Section A, CP1 A et CM2 A avec leurs 3 élèves et leurs titulaires, modèle de pack appliqué).

**Ce que le propriétaire peut faire seul (établi en lisant le code).** Son rôle porte tous les droits sauf la console plateforme : il détient donc tous les droits `primary.*` et `attendance.*`. Il voit **toutes** les classes (droit `primary.class.read_all`) ; il peut faire et valider l'appel de n'importe quelle classe (`attendance.manage`), marquer une période « prête », rédiger la banque d'appréciations, préparer et présider le conseil des maîtres, préparer les bilans et l'archive, lire les états. En revanche il **ne peut pas saisir une compétence** : l'API exige que le compte soit relié à une fiche de personnel (l'auteur de chaque saisie est tracé). L'interface n'offre aucun moyen de relier un compte existant à une fiche : l'invitation crée un *nouveau* compte et est refusée pour l'e-mail du propriétaire. Il n'existe donc pas de contournement acceptable par l'interface pour "devenir titulaire" (l'affecter comme titulaire ne changerait d'ailleurs rien, le blocage venant de la fiche manquante). Les gestes qui exigent un instituteur ou une famille sont écrits dans la phase *Partie 2 — à jouer quand les autres comptes existeront*.

Dans cette partie, « la première période » désigne la première période de l'année 2026-2027, dont le libellé dépend du plan de périodes retenu (`Trimestre 1` ou `Semestre 1`). Les pages peuvent afficher un message transitoire pendant le chargement : attendre 3 à 4 secondes avant de juger.

### Étape 73 — Voir les trois classes dans « Ma classe »
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Ma classe »** (`/v2/primary/classe`)

1. Lire le titre « Ma classe » et la phrase « Vos classes, leurs périodes et les gestes du quotidien : appel du jour, compétences, conseil. ». Un bandeau « Règles de démonstration » peut s'afficher au-dessus.
2. Regarder la liste « Mes classes ».

✅ Trois cartes : **Grande Section A** (code `GS`, "3 élèves"), **CP1 A** (`CP1`, "3 élèves"), **CM2 A** (`CM2`, "3 élèves"). Chacune porte la pastille « Non titulaire » (le propriétaire n'est affecté à aucune classe mais les voit toutes), une rubrique « Périodes » avec les périodes de l'année (« ouverte » ou « verrouillée ») et les boutons « Appel du jour », « Compétences » et « Conseil ». Le message « Aucune classe ne vous est affectée. » (école vide) ne doit plus apparaître.

⚠️ *Écart possible* : si ce message s'affiche alors que les classes existent, vérifier que l'année 2026-2027 est bien ouverte (seules les classes des années ouvertes sont listées) *(à vérifier)*.

☐ OK ☐ KO

### Étape 74 — Appel unique de la Grande Section A (maternelle)
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Présences »** > **« Faire l'appel »** (`/v2/attendance/call`)

1. Lire le titre « Mes séances à faire ». La rubrique « Aujourd'hui » peut indiquer qu'il n'y a pas de séance (le propriétaire n'a pas d'emploi du temps) : l'ignorer.
2. Descendre à la rubrique « Appel de la journée » : le bloc « Autre classe » est proposé parce que le propriétaire détient le droit de gérer les présences. Renseigner :

| Champ | Valeur à saisir |
| :--- | :--- |
| Autre classe | `Grande Section A` (liste « Choisir une classe ») |
| Date | `2026-10-09` |
| Demi-journée | `Journée entière` |

3. Cliquer **« Ouvrir »**. Sur la page « Faire l'appel », tous les élèves sont « Présent » par défaut.
4. Toucher la ligne **ASSI Brice** : elle passe à « Absent ». Cliquer **« Soumettre l'appel »**.

✅ Message « Appel soumis. » ou « Appel soumis : 1 absent, aucun retard. » (selon que la file hors ligne est active) ; pastille « Appel soumis » ; en bas : « Appel déjà soumis. ». Les pastilles de synthèse indiquent Présent : 2 et Absent : 1.

⚠️ *Test d'erreur* : revenir (« Mes séances »), choisir de nouveau `Grande Section A`, la même date et `Matin`, cliquer « Ouvrir » → refus "La politique d'appel de ce cycle prévoit un seul appel par jour : l'appel du matin ou de l'après-midi n'est pas autorisé." (la maternelle n'a qu'un appel par jour).

☐ OK ☐ KO

### Étape 75 — Appels du matin et de l'après-midi du CP1 A (primaire)
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Présences »** > **« Faire l'appel »** (`/v2/attendance/call`)

1. Dans « Appel de la journée » > « Autre classe » : classe `CP1 A`, date `2026-10-09`, demi-journée `Matin`, puis **« Ouvrir »**. Le titre de la page rappelle le matin.
2. Toucher **KOUASSI Aya** (« Absent »), cliquer **« Soumettre l'appel »**.
3. Cliquer **« Mes séances »** pour revenir, puis refaire l'ouverture avec `CP1 A`, `2026-10-09`, demi-journée `Après-midi`. Toucher **TRAORE Fatoumata** (« Absent »), cliquer **« Soumettre l'appel »**.
4. Revenir et rouvrir `CP1 A` au `Matin`.

✅ Deux appels distincts le même jour pour la même classe. Le matin rouvert est **le même** appel (pastille « Appel soumis », KOUASSI Aya toujours « Absent »), pas de doublon.

⚠️ *Test d'erreur* : ouvrir `CP1 A` avec la demi-journée `Journée entière` → refus "La politique d'appel de ce cycle demande deux appels par jour (matin et après-midi) : l'appel de la journée entière n'est pas autorisé." Si l'application accepte la journée entière pour le CP1 A, c'est que la politique d'appel du primaire n'a pas été installée avec le pack : le noter *(à vérifier)*.

☐ OK ☐ KO

### Étape 76 — Le bouton « Appel du jour » de « Ma classe »
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Ma classe »** (`/v2/primary/classe`)

1. Sur la carte **Grande Section A**, cliquer **« Appel du jour »**. Un panneau « Appel du 2026-10-09 » s'ouvre.
2. Lire « L'appel du jour est déjà transmis : vous pouvez encore corriger un élève. » et le compteur « 2 présents · 1 absents ».
3. Toucher « Marquer DAGO Chantal absent » (compteur « 1 présents · 2 absents »), puis cliquer **« Enregistrer les corrections »**, puis **« Fermer l'appel »**.
4. Sur la carte **CP1 A**, cliquer **« Appel du jour »**.

✅ Étape 3 : « Corrections enregistrées. ». Étape 4 : le panneau affiche un refus "Précisez la demi-journée de l'appel : matin ou après-midi." avec un bouton « Réessayer ».

⚠️ *Écart connu* : pour une classe du primaire (deux appels par jour), ce bouton n'offre pas le choix de la demi-journée et échoue toujours ; il faut passer par « Faire l'appel » (étape précédente).

☐ OK ☐ KO

### Étape 77 — Valider les appels du jour
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Présences »** > **« Suivi des appels »** (`/v2/attendance/sessions`)

1. Vérifier que les filtres « Du » et « Au » encadrent le 9 octobre 2026 (par défaut : les 7 derniers jours).
2. Repérer trois lignes à l'état « Soumis » : Grande Section A (type « Journalier »), CP1 A ("Journalier · Matin") et CP1 A ("Journalier · Après-midi").
3. Cliquer **« Valider »** sur chacune (aucune fenêtre de confirmation).

✅ « Appel validé. » à chaque clic ; les trois lignes passent à « Validé ». Un appel validé peut être rouvert ensuite avec un motif (bouton « Rouvrir ») : la validation n'est pas irréversible.

📌 Le propriétaire a ici pris puis validé les mêmes appels, ce qu'une vraie école séparerait (instituteur / direction) ; rien dans le code ne l'en empêche *(à vérifier)*.

☐ OK ☐ KO

## Phase 13 — Compétences : lire la grille, période « prête »

Objectif : lire la grille de compétences de chaque classe (échelle de démonstration à quatre niveaux N1 à N4, « Non évaluée » tant que rien n'est saisi, jamais de zéro ni de moyenne), constater ce que le propriétaire ne peut pas faire, et utiliser le marquage « prête » (réversible). Précondition : la page « Paramètres » montre l'échelle et les deux référentiels de démonstration (maternelle et primaire) au statut « Publié » ; sinon appliquer le modèle de pack dans la phase de configuration. La saisie réelle, la validation de la grille et la révision sont dans la phase *Partie 2*.

### Étape 78 — Lire la grille de la maternelle (aucune saisie)
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Compétences »** (`/v2/primary/competences`)

1. Lire la phrase « Évaluez le niveau de maîtrise de chaque compétence, par élève et par période. Une compétence non saisie reste « non évaluée ». ».
2. Dans « Classe, période et référentiel » : « Classe » = `Grande Section A`, « Période » = la première période. (Le message « Aucune classe ne vous est accessible. » ne doit plus s'afficher.)
3. Lire le bandeau de référentiel : `Compétences de la maternelle (démonstration)` (le mot « démonstration » peut apparaître deux fois).
4. Lire « Complétude de la saisie ». Vue « Fiche élève » : choisir l'élève **ADOU Aïcha**. Lire les domaines `D1 — Domaine 1 (démonstration)` et `D2 — Domaine 2 (démonstration)` et, sous chaque compétence, les quatre boutons de niveau (N1 `Non acquis`, N2 `En cours d'acquisition`, N3 `Acquis`, N4 `Acquis avec aisance`).
5. Cliquer **« Tableau »**.
6. Descendre à « Synthèse par compteurs », choisir l'élève ADOU Aïcha dans « Élève à synthétiser ».
7. Remplacer la classe par `CP1 A`, puis par `CM2 A` (même période).

✅ Maternelle : « 0 sur 9 compétences renseignées · aucune saisie en attente · aucune validée » et "9 compétences restent « non évaluées » (ni zéro, ni niveau par défaut). ». Fiche d'ADOU Aïcha : « 0 sur 3 compétences renseignées · élève 1 sur 3 » ; pastille « Non évaluée » partout. Tableau : 3 lignes (élèves) × 3 colonnes `D1.1`, `D1.2`, `D2.1`, cellules « Non évaluée ». Synthèse : « Aucune compétence validée à afficher pour le moment. ». CP1 A et CM2 A (référentiel du primaire, une seule compétence `D1.1`) : « 0 sur 3 compétences renseignées ». Aucun chiffre, aucune moyenne, aucun pourcentage.

☐ OK ☐ KO

### Étape 79 — Constater que le propriétaire ne peut pas saisir
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Compétences »** (`/v2/primary/competences`)

1. Choisir `Grande Section A` et la première période ; vue « Fiche élève », élève **ADOU Aïcha**.
2. Pour `Compétence 1.1 (démonstration)`, cliquer le niveau **N3 Acquis** : la pastille passe à « À enregistrer » et le compteur indique « 1 saisie en attente ».
3. Cliquer **« Enregistrer »** (sans quoi l'enregistrement automatique part de lui-même après 5 secondes).
4. Cliquer **« Annuler ma saisie non enregistrée »**.

✅ Une alerte rouge affiche le refus "Un compte sans fiche de personnel ne saisit pas d'évaluation (l'auteur de la saisie est tracé)." suivi de "Aucune ligne n'a été enregistrée (tout ou rien). Les lignes en erreur sont signalées dans la grille." ; la saisie reste « À enregistrer ». Après l'annulation, la cellule redevient « Non évaluée ». Le bouton « Valider la grille » reste inactif (rien n'est enregistré).

🕓 La saisie réelle se joue avec le compte instituteur : voir l'étape *Saisir les compétences du CP1 A* de la phase *Partie 2*.

☐ OK ☐ KO

### Étape 80 — Marquer la période « prête » puis retirer le marquage (CM2 A)
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Ma classe »** (`/v2/primary/classe`)

1. Sur la carte **CM2 A**, sous « Périodes », cliquer le bouton **« Marquer Trimestre 1 prête »** (ou « Marquer Semestre 1 prête » selon le plan).
2. Dans la fenêtre « Marquer Trimestre 1 prête ? » ("Les parents et les élèves verront les compétences saisies et le rang provisoire de cette période. La saisie sera gelée tant que le marquage n'est pas retiré. …"), cliquer **« Marquer prête »**.
3. Cliquer le bouton devenu **« Retirer le marquage de Trimestre 1 »**.
4. Saisir dans « Motif du retrait » :

| Champ | Valeur à saisir |
| :--- | :--- |
| Motif du retrait | `court` |

5. Cliquer **« Retirer le marquage »** : refus. Remplacer le motif par `Marquage posé pour la recette, à retirer` et cliquer de nouveau **« Retirer le marquage »**.

✅ Étape 2 : message « Trimestre 1 : marquée prête, les familles voient désormais les compétences et le rang provisoire. » et pastille « Prête pour les familles » sur la période. Étape 5 : « Trimestre 1 : marquage retiré, les familles ne voient plus que les périodes validées ou publiées. » ; la pastille disparaît et le bouton redevient « Marquer … prête ».

⚠️ *Test d'erreur* : motif `court` → "Au moins 10 caractères." sous le champ.

🕓 Ce que voit la famille et le gel de la saisie pendant le marquage se testent avec les comptes instituteur et parent : phase *Partie 2*.

☐ OK ☐ KO

## Phase 14 — Banque d'appréciations

Objectif : lire la banque de phrases (démonstration), composer un texte, puis créer, désactiver et réactiver une phrase. Le propriétaire détient le droit de gérer la banque (« Nouvelle phrase », « Désactiver »), que l'instituteur n'a pas.

### Étape 81 — Lire la banque et composer un texte
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Appréciations »** (`/v2/primary/appreciations`)

1. Lire « Banque de phrases pour rédiger vos appréciations. Une phrase propose du texte : elle n'est jamais appliquée seule. » et la liste « Phrases de la banque ».
2. Filtre « Portée » = `Année` : une seule phrase reste. Revenir à « Tous ».
3. Filtre « Niveau de maîtrise » = `N3` : une seule phrase reste. Revenir à « Tous ».
4. Sur la phrase de niveau N3, cliquer **« Ajouter à ma rédaction »** : le texte apparaît dans « Texte de l'appréciation » (rubrique « Ma rédaction »).
5. Cocher **« J'ai relu et je valide ce texte »**, puis cliquer **« Copier le texte validé »**.

✅ Trois phrases de démonstration au départ, chacune avec la pastille « Démonstration » (niveau N1, niveau N3, portée « Année »). Après l'étape 5 : « Texte copié : collez-le dans l'appréciation du bulletin. » et la note « Ce texte n'est enregistré nulle part ici. L'appréciation générale s'écrit dans le module Résultats (appréciations de la période). ». Le bouton « Copier le texte validé » est inactif tant que la case n'est pas cochée.

☐ OK ☐ KO

### Étape 82 — Créer une phrase, la désactiver, la réactiver
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Appréciations »** (`/v2/primary/appreciations`)

1. Cliquer **« Nouvelle phrase »** et renseigner :

| Champ | Valeur à saisir |
| :--- | :--- |
| Code | `RECETTE_LECTURE` |
| Portée | `Période` |
| Texte de la phrase | `Lecture fluide en progrès constant (phrase de recette).` |
| Niveau de maîtrise | `N3` |
| Niveau de classe | `CP1` |

2. Cliquer **« Créer la phrase »**.
3. Sur la nouvelle phrase, cliquer **« Désactiver »**, cocher **« Afficher aussi les phrases désactivées »**, cliquer **« Activer »** puis de nouveau **« Désactiver »**.

✅ « Phrase créée. » (sans pastille « Démonstration ») ; une fois désactivée : pastille « Désactivée » et « Ajouter à ma rédaction » inactif ; la phrase disparaît de la liste quand la case « Afficher aussi les phrases désactivées » est décochée.

⚠️ *Test d'erreur* : code `recette-lecture` (tiret) → "Code attendu : majuscules, chiffres et _ (2 à 60)." Texte de la phrase laissé vide → "Ce champ est obligatoire."

☐ OK ☐ KO

## Phase 15 — Conseil des maîtres

Objectif : préparer le conseil de la CM2 A, tenir la feuille de présence, traiter les dossiers un par un, tenter une décision et demander le procès-verbal. Précondition : la CM2 A a ses 3 élèves et son titulaire BAMBA Séraphin affecté ; les fiches de KOFFI Adjoua et ZOKORA Sylvie existent. La règle « propose », le conseil « confirme » : dans une école neuve, aucun résultat de période n'est calculé, donc les décisions risquent d'être refusées (voir plus bas) ; le relever sans se bloquer. La signature de la feuille de présence est irréversible : elle est dans la phase *Actes de fin de recette*.

### Étape 83 — Préparer le conseil de la CM2 A
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Conseil des maîtres »** (`/v2/primary/conseil`)

1. Lire « Préparation, présence, dossiers élève par élève, décisions et procès-verbal. La règle propose, le conseil confirme. » ; la liste « Mes conseils » indique « Aucun conseil n'a encore été préparé. ».
2. Dans « Préparer un conseil » : « Classe » = `CM2 A`, « Période » = la première période, laisser « Date de la séance (facultative) » vide.
3. Cliquer **« Préparer le conseil »**.
4. Lire la séance qui s'ouvre, puis cliquer **« Retour à la liste des conseils »**.

✅ « Conseil préparé : un dossier par élève a été créé. » ; la séance affiche « 3 dossiers : 3 à examiner, 0 décidés, 0 reportés. » ; la « Feuille de présence » contient BAMBA Séraphin, rôle « Titulaire de la classe », convoqué, présence « Non renseignée ». Dans la liste : `CM2 A · Trimestre 1` avec « 3 dossiers · 3 à examiner · 0 décidés » et un bouton « Ouvrir ».

⚠️ *Écart possible* : la préparation peut être refusée si l'état de résultats de la classe et de la période n'existe pas encore (message du type « État de la période introuvable ») *(à vérifier)*. Relever le message exact, marquer cette étape et les trois suivantes « bloquées », puis passer à la phase *Bilans annuels et archive*.

☐ OK ☐ KO

### Étape 84 — Feuille de présence du conseil (sans signer)
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Conseil des maîtres »** (`/v2/primary/conseil`) > « Ouvrir » sur le conseil de la CM2 A

1. Dans « Feuille de présence », rubrique « Ajouter un participant » : choisir `KOFFI Adjoua`, « Rôle » = `Président`, cliquer **« Ajouter »** ; puis `ZOKORA Sylvie`, « Rôle » = `Secrétaire`, **« Ajouter »**.
2. Pour chacun des trois participants, régler « Présence de … » sur **« Présent »** ; laisser « … est convoqué » coché ; **ne cocher aucune « Signature de … »**.
3. Cliquer **« Enregistrer la feuille de présence »**.

✅ « Feuille de présence enregistrée. » ; ligne de quorum « Aucun quorum bloquant : 3 convoqués, 3 présents. » (ou « Quorum atteint selon la règle : 3 présents sur 3 convoqués. » si une règle de quorum est liée *(à vérifier)*) ; en bas : « Une présence signée est figée : elle ne peut plus être modifiée. ».

📌 Les rôles « Président » et « Secrétaire » sont attribués ici à des fiches de personnel à titre d'essai ; l'ordre de grandeur important est le nombre de présents.

☐ OK ☐ KO

### Étape 85 — Dossiers : proposition, report, remise à l'examen
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Conseil des maîtres »** (`/v2/primary/conseil`) > conseil de la CM2 A

1. Sous « Dossiers, un par un », lire « Dossier 1 sur 3 », la liste « Dossier » (par exemple `COULIBALY Ibrahim — À examiner`), les « Motifs d'examen », puis les deux cadres « Proposition de la règle » et « Décision du conseil ».
2. Dans « Ma proposition » : choisir `Passage en classe supérieure`, saisir dans « Notes et observations » `Élève à l'aise en lecture (recette)`, cliquer **« Enregistrer ma proposition »**.
3. Cliquer **« Reporter ce dossier »**, lire la pastille, puis **« Remettre à l'examen »**.
4. Cliquer la flèche « Dossier suivant ».

✅ « Proposition enregistrée. » ; le dossier reporté porte la pastille « Reporté » (le résumé de la séance compte alors "1 reportés"), puis redevient « À examiner ». « Proposition de la règle » : « Aucune proposition » ou « En attente de calcul » ; « Décision du conseil » : « Pas encore décidé ». La proposition de l'instituteur (ou ici du propriétaire) ne vaut pas décision.

☐ OK ☐ KO

### Étape 86 — Décision du conseil et procès-verbal
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Conseil des maîtres »** (`/v2/primary/conseil`) > conseil de la CM2 A

⚠️ Une décision confirmée est définitive pour le dossier (« Décidé ») : n'en prendre qu'une, sur le dossier de COULIBALY Ibrahim.

1. Dans « Procès-verbal », saisir « Date réelle de la séance » = `2026-10-09` et cliquer **« Demander le procès-verbal »** (avant toute décision).
2. Sur le dossier de COULIBALY Ibrahim, bloc « Décision du conseil » : si « Confirmer la proposition de la règle » est grisé (« La règle ne tranche pas : choisissez une décision. »), choisir **« Retenir un autre code »**.
3. « Décision retenue » = `Passage en classe supérieure`, « Justification » = `court`, cliquer **« Confirmer la décision »**.
4. Remplacer la justification par `Décision de recette prise en séance pour un cas limite` et cliquer **« Confirmer la décision »**.
5. Si la décision est enregistrée, redemander le procès-verbal (date `2026-10-09`), puis une seconde fois.

✅ Étape 1 : refus "Aucune décision n'est encore confirmée." avec la piste « Complétez la feuille de présence, la date de séance et au moins une décision avant de demander le procès-verbal. ». Étape 3 : « La justification compte au moins 20 caractères. ». Étape 4, deux issues possibles : « Décision enregistrée : Passage en classe supérieure. » (avec « Elle diffère de la proposition de la règle ; la justification est conservée. ») et pastille « Décidé » ; **ou**, dans une école neuve sans résultats calculés, refus "La règle n'a produit aucune proposition pour cet élève : les résultats de la période ne sont pas calculés." (à relever, c'est l'écart connu de la préparation). Étape 5 (seulement si une décision existe) : « Procès-verbal demandé : il sera disponible dans les documents officiels. » (ou "… le document est en cours de préparation."), puis « Un procès-verbal a déjà été demandé pour ce conseil. ».

⚠️ *Test d'erreur* : « Date réelle de la séance » vide → « Indiquez la date réelle de la séance. ».

☐ OK ☐ KO

## Phase 16 — Bilans annuels et archive

Objectif : préparer les brouillons de bilan de la CM2 A, constater qu'ils ne se scellent pas en octobre, puis préparer (sans geler) l'archive de l'année. Rien d'irréversible ici : le scellement réel est dans la phase *Actes de fin de recette*.

### Étape 87 — Préparer les brouillons de bilan de la CM2 A
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Bilans annuels »** (`/v2/primary/bilans`)

1. Lire « Préparez, scellez et réémettez les bilans annuels d'une classe. Un bilan scellé est immuable. ».
2. Dans « Année et classe » : « Année » = `2026-2027` (choisie d'office s'il n'y en a qu'une), « Classe » = `CM2 A`.
3. Lire « Aucun bilan pour cette classe et cette année. » puis cliquer **« Préparer les brouillons »**.
4. Cliquer une seconde fois **« Préparer les brouillons »**.

✅ Étape 3 : message « Brouillons préparés : 3 créés, 0 actualisés, 0 scellés laissés intacts. ». Le tableau « Bilans annuels de la classe » (colonnes « Élève », « Version », « Statut », « Décision », « Empreinte », « Règles ») montre 3 lignes : « Version 1 », statut « Brouillon », décision et empreinte « — », et le bouton « Sceller » à droite. Étape 4 : "0 créés, 3 actualisés, 0 scellés laissés intacts.". Une pastille « Règles de démonstration » peut apparaître dans la colonne « Règles ».

⚠️ *Écart possible* : la préparation peut être refusée si les ports de résultats ou de présence ne répondent pas ; relever le message exact *(à vérifier)*.

☐ OK ☐ KO

### Étape 88 — Sceller un bilan : les manques sont affichés (refus attendu)
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Bilans annuels »** (`/v2/primary/bilans`, CM2 A)

1. Cliquer **« Sceller »** sur la ligne d'un élève (par exemple COULIBALY Ibrahim).
2. Lire la fenêtre « Sceller ce bilan » (« Le bilan devient immuable : contenu, décision et empreinte ne pourront plus changer. Une correction créera une nouvelle version. »).
3. Cliquer **« Sceller le bilan »**.
4. Fermer la fenêtre avec « Annuler ».

✅ Refus dans la fenêtre : "Toutes les périodes de l'année ne sont pas clôturées." suivi de « Points à corriger avant de continuer : » avec la liste des manques (en plus, "Le résultat d'année FINAL n'est pas disponible." et "La décision du conseil des maîtres n'est pas confirmée."). Le bilan reste « Brouillon ». Si, contre toute attente, le bilan se scelle, c'est un acte irréversible : le noter.

☐ OK ☐ KO

### Étape 89 — Préparer l'archive de l'année (sans geler)
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Archives »** (`/v2/primary/archives`)

1. Lire « Préparez l'archive d'une année, vérifiez son manifeste puis gelez-la. Rien n'est déplacé ni supprimé : c'est un gel logique. ». Choisir « Année » = `2026-2027` (le libellé peut s'afficher sous forme d'identifiant court).
2. Lire « Aucune archive pour cette année. » puis cliquer **« Préparer l'archive »**.
3. Lire la carte et la liste « Ce qui empêche le gel : ».

✅ « Archive préparée. » ; carte « Archive : En préparation » ; « 0 bilans scellés sur 3 » (les 3 brouillons de la CM2 A) ; empêchements attendus : "L'année académique n'est pas clôturée.", "3 bilan(s) non scellé(s).", "6 inscription(s) sans bilan annuel." *(chiffres à relever)*. Aucun bouton « Geler l'archive » (il n'apparaît que pour une archive « Prête à geler »).

⚠️ **Ne jamais geler l'archive pendant la recette** : le gel est irréversible pour toute l'école (plus aucun bilan de l'année ne peut être écrit). Il n'est d'ailleurs pas atteignable avant la clôture de l'année.

☐ OK ☐ KO

## Phase 17 — Avancement, états et espace famille

Objectif : lire l'avancement des classes côté direction, produire les états du primaire (aperçu et CSV) et constater ce que le propriétaire voit dans l'espace "Mon enfant".

### Étape 90 — Avancement des classes
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Avancement »** (`/v2/primary/direction`)

1. Ouvrir l'adresse `/v2/primary` : l'application redirige vers `/v2/primary/direction` (profil direction).
2. Lire le titre « Avancement des classes », le bandeau « Règles de démonstration » et la barre « Accès rapides ».
3. Lire le tableau « Avancement par classe et par période » (« Année » = « Année en cours »).
4. Lire la règle d'affichage au-dessus du tableau.

✅ Barre « Accès rapides » : « Conseil des maîtres », « Bilans annuels », « Archives », « États », « Paramètres » (les cinq). Tableau (colonnes « Classe », « Période », « État », « Élèves », « Saisies », « Validées », « Bilans scellés », « Période ») : une ligne par classe et par période de l'année, toutes à l'état « Rien de saisi » (rouge) ; Grande Section A : « 0 sur 9 » / « 0 sur 9 » et bilans « 0 sur 0 » ; CP1 A : « 0 sur 3 » / « 0 sur 3 » et « 0 sur 0 » ; CM2 A : « 0 sur 3 » / « 0 sur 3 » et « 0 sur 3 » (les trois brouillons de bilan préparés). La dernière colonne indique « Ouverte » ou « Verrouillée » selon l'état de la période. Règle lue : « Rouge : rien n'est saisi. Vert : tout est saisi et validé, et les bilans existants sont scellés. Orange : le reste. Règle d'affichage, sans valeur réglementaire. ».

☐ OK ☐ KO

### Étape 91 — États du primaire : liste de classe, effectifs, couverture
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« États »** (`/v2/primary/etats`)

1. Lire « Aperçu en tableau et export CSV. Les paramètres du rapport sont rappelés avec le résultat. » et ouvrir la liste « Rapport ».
2. Choisir **« Liste de classe »** : le bouton « Afficher l'aperçu » reste inactif et la mention « Renseignez les paramètres obligatoires pour produire ce rapport. » s'affiche. Choisir « Classe » = `Grande Section A`, puis cliquer **« Afficher l'aperçu »**.
3. Choisir **« Effectifs par niveau et par classe »**, cliquer **« Afficher l'aperçu »**.
4. Choisir **« Couverture des compétences »**, « Classe » = `CM2 A`, « Période » = la première période, **« Afficher l'aperçu »**.
5. Choisir **« Redoublants »**, **« Afficher l'aperçu »**.

✅ La liste contient les sept rapports (« Liste de classe », « Effectifs par niveau et par classe », « Registre d'appel mensuel », « Redoublants », « Couverture des compétences », « Dossier du conseil des maîtres », « Avancement des classes »). Liste de classe : titre "Liste de classe — Grande Section A", colonnes `N°`, `Élève`, `Redoublant`, 3 lignes (ADOU Aïcha, ASSI Brice, DAGO Chantal), `Redoublant` = `Non`. Effectifs : colonnes `Niveau`, `Classe`, `Élèves`, `Redoublants` ; 3 lignes (GS, CP1, CM2) à 3 élèves et 0 redoublant. Couverture : colonnes `Élève`, `Attendues`, `Saisies`, `Validées`, `Non évaluées` ; chaque élève de la CM2 A à `1, 0, 0, 1`. Redoublants : « Ce rapport ne contient aucune ligne. ». Chaque aperçu rappelle « Produit le … » et les paramètres du rapport.

☐ OK ☐ KO

### Étape 92 — États du primaire : registre d'appel, dossier du conseil, export CSV
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« États »** (`/v2/primary/etats`)

1. Choisir **« Registre d'appel mensuel »**, « Classe » = `CP1 A`, « Mois » = `2026-10` (format « AAAA-MM »), **« Afficher l'aperçu »**.
2. Refaire avec « Classe » = `Grande Section A`.
3. Choisir **« Dossier du conseil des maîtres »**, « Conseil » = celui de la CM2 A, **« Afficher l'aperçu »**.
4. Revenir au registre du CP1 A et cliquer **« Exporter en CSV »**.

✅ Registre du CP1 A : titre "Registre d'appel — 2026-10", colonnes `Élève`, `09 matin`, `09 après-midi` ; KOUASSI Aya en absence le matin, TRAORE Fatoumata en absence l'après-midi (les cellules affichent les codes de statut, par exemple `ABSENT` / `PRESENT`). Grande Section A : une seule colonne `09` ; ASSI Brice et DAGO Chantal absents. Dossier du conseil (seulement si le conseil a pu être préparé) : colonnes `Élève`, `Motifs d'examen`, `Proposition de la règle`, `Proposition de l'instituteur`, `Statut`, `Décision`, 3 lignes. Export : le navigateur télécharge `attendance-register.csv` (séparateur point-virgule, mêmes lignes que l'aperçu).

⚠️ *Test d'erreur* : « Registre d'appel mensuel » sans « Mois » → boutons « Afficher l'aperçu » et « Exporter en CSV » inactifs et « Renseignez les paramètres obligatoires pour produire ce rapport. ».

☐ OK ☐ KO

### Étape 93 — « Bulletin et compétences » vu par le propriétaire
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Bulletin et compétences »** (`/v2/primary/mon-enfant`)

1. Ouvrir la page et lire le titre.

✅ Titre « Bulletin et compétences de mon enfant » et message « Aucun enfant n'est lié à votre compte. » avec « Contactez l'établissement pour lier votre compte à celui de votre enfant. » : le propriétaire n'est le tuteur d'aucun élève, il ne voit donc aucun bilan (la page n'affiche que les enfants dont le compte est tuteur, jamais tous les élèves).

🕓 La vue réelle d'un parent et d'un élève est dans la phase *Partie 2*.

☐ OK ☐ KO

## Phase 18 — Actes de fin de recette

Objectif : les gestes **irréversibles** du pack, à jouer **une seule fois, à la toute fin**, après tout le reste (y compris la phase *Partie 2* si elle est jouée). Ne les jouer que sur le propriétaire.

### Étape 94 — ⚠️ Irréversible : signer la feuille de présence du conseil
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Conseil des maîtres »** (`/v2/primary/conseil`) > conseil de la CM2 A

⚠️ Irréversible : une présence signée est figée (aucun retour possible). Précondition : l'étape *Feuille de présence du conseil (sans signer)* a été jouée.

1. Sur la ligne de **BAMBA Séraphin**, régler « Présence de BAMBA Séraphin » sur « Absent » : la case « Signature de BAMBA Séraphin » devient inactive. Remettre « Présent ».
2. Cocher « Signature de BAMBA Séraphin », puis cliquer **« Enregistrer la feuille de présence »**.
3. Essayer de modifier cette ligne.

✅ « Feuille de présence enregistrée. » ; « Signée le … » ; la ligne est verrouillée (« Une présence signée est figée : elle ne peut plus être modifiée. »). Les lignes de KOFFI Adjoua et ZOKORA Sylvie restent modifiables.

⚠️ *Test d'erreur* : une signature exige la présence ; l'interface empêche de cocher la case si la personne n'est pas « Présent » (message serveur de repli : « Une signature exige que la personne soit marquée présente. »).

☐ OK ☐ KO

### Étape 95 — ⚠️ Irréversible : sceller un bilan annuel
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Bilans annuels »** (`/v2/primary/bilans`, CM2 A)

⚠️ Irréversible : un bilan scellé devient immuable (contenu, décision, empreinte). **Une seule fois, sur un seul bilan.** Précondition : toutes les périodes de l'année closes, résultat d'année définitif et décision du conseil confirmée. Dans une école neuve en octobre, ce n'est pas le cas : si l'étape *Sceller un bilan : les manques sont affichés (refus attendu)* a été refusée, marquer cette étape et la suivante "non jouables (année non close)" et passer à la phase suivante.

1. Cliquer **« Préparer les brouillons »** pour actualiser : les lignes sans manque passent à « Prêt à sceller ».
2. Sur un bilan « Prêt à sceller », cliquer **« Sceller »**, lire la fenêtre « Sceller ce bilan », confirmer **« Sceller le bilan »**.
3. Retourner dans « Archives » et cliquer « Préparer l'archive ».

✅ « Bilan de … scellé. » ; statut « Scellé », empreinte tronquée et « Scellé le … » visibles, le bouton « Sceller » disparaît (le PDF est produit en arrière-plan par le worker). L'archive affiche « 1 bilans scellés sur 3 » ; les autres empêchements demeurent.

⚠️ *Test d'erreur* : sceller sans décision du conseil confirmée → "La décision du conseil des maîtres doit être confirmée avant de sceller." (ou "La décision du conseil des maîtres n'est pas confirmée.").

☐ OK ☐ KO

### Étape 96 — ⚠️ Irréversible : réémettre un bilan scellé
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Bilans annuels »** (`/v2/primary/bilans`, CM2 A)

⚠️ Irréversible : l'ancienne version est remplacée. Précondition : un bilan « Scellé » (étape précédente jouée) ; sinon marquer "non jouable".

1. Sur le bilan « Scellé », cliquer **« Réémettre »** (fenêtre « Réémettre le bilan »).
2. Saisir le motif `court` : le message d'aide devient rouge. Remplacer par `Correction de la décision de passage (recette)`.
3. Cliquer **« Réémettre »**.

✅ Étape 2 : « Le motif doit comporter au moins 10 caractères. ». Étape 3 : « Nouvelle version du bilan de … créée : elle doit être scellée à son tour. » ; la version 2 apparaît en « Brouillon » (la version 1, « Remplacé par une version plus récente », n'est plus la version vivante *(à vérifier si elle reste listée)*). Resceller la version 2 rétablit la visibilité pour la famille.

📌 À ne jamais faire pendant la recette : « Geler l'archive » (irréversible pour toute l'école).

☐ OK ☐ KO

## Phase 19 — Partie 2 — à jouer quand les autres comptes existeront

🕓 Cette phase n'est **pas jouable aujourd'hui** : elle exige des comptes qui n'existent pas encore. Chaque étape indique le rôle, l'e-mail attendu et ce qu'elle vérifie. Préconditions : les phases précédentes jouées ; les comptes suivants créés (par l'invitation de portail depuis la fiche de personnel / la fiche tuteur / la fiche élève, ou selon la méthode de l'équipe) et **reliés à la bonne fiche** : `enseignant@ecole-flamboyants.test` (rôle instituteur) relié à la fiche de KOFFI Adjoua, titulaire du CP1 A ; `instituteur.maternelle@ecole-flamboyants.test` (rôle instituteur) relié à ZOKORA Sylvie, titulaire de la Grande Section A ; `parent@ecole-flamboyants.test` relié à KOUASSI Hervé, père de KOUASSI Aya (CP1 A) ; `eleve@ecole-flamboyants.test` relié à KOUASSI Aya ; `directeur@ecole-flamboyants.test` (rôle directeur). Si les comptes sont créés avec les e-mails des fiches (par exemple `adjoua.koffi@ecole-flamboyants.test`), utiliser ces adresses à la place. Les étapes sont écrites pour un jour de recette **postérieur au 9 octobre 2026** (l'appel du jour du 9 octobre est déjà fait et validé). Les fenêtres A et B doivent être des navigateurs différents (ou privé) pour garder deux sessions.

### Étape 97 — Ma classe et appels du matin et de l'après-midi (instituteur du CP1 A)
👤 **instituteur** (ecole-flamboyants) `enseignant@ecole-flamboyants.test` (pas de MFA) · fenêtre **B** · 📂 Menu **« Ma classe (primaire) »** (`/v2/primary/classe`) puis **« Mes appels »** (`/v2/teacher/attendance`)
🔑 **Connexion** : fenêtre **B** : ouvrir `/v2/login`, choisir l'établissement `ecole-flamboyants`, cliquer sur le compte **instituteur** — `enseignant@ecole-flamboyants.test` — sans MFA, puis **Se connecter**.

1. Sur « Ma classe » : une seule carte **CP1 A** (`CP1`, "3 élèves"), pastille « Titulaire », périodes avec « ouverte » / « verrouillée » et un bouton « Marquer … prête » par période ; boutons « Appel du jour », « Compétences », « Conseil ».
2. Ouvrir « Mes appels » : rubrique « Appel de la journée », deux lignes pour CP1 A : « Matin » avec **« Appel du matin »** et « Après-midi » avec **« Appel de l'après-midi »**.
3. Cliquer « Appel du matin », toucher **YAO Konan Éric** (« Absent »), « Soumettre l'appel ». Revenir : la ligne « Matin » porte « Appel soumis ». Faire « Appel de l'après-midi » avec tout le monde présent.

✅ Deux appels distincts par jour, aucune notion de séance planifiée. 🔒 Le propriétaire (ou le directeur) valide ensuite ces deux appels dans « Suivi des appels » (étape *Valider les appels du jour*). ⚠️ *Écart connu* : le bouton « Appel du jour » de la carte « Ma classe » du CP1 A est refusé ("Précisez la demi-journée de l'appel : matin ou après-midi.").

☐ OK ☐ KO

### Étape 98 — Appel unique de la maternelle (instituteur de maternelle)
👤 **instituteur de maternelle** (ecole-flamboyants) `instituteur.maternelle@ecole-flamboyants.test` (pas de MFA) · fenêtre **B** · 📂 Menu **« Ma classe (primaire) »** (`/v2/primary/classe`)
🔑 **Connexion** : fenêtre **B** : se déconnecter de `enseignant@ecole-flamboyants.test` (menu du compte > Se déconnecter), puis ouvrir `/v2/login`, choisir l'établissement `ecole-flamboyants`, cliquer sur le compte **instituteur de maternelle** — `instituteur.maternelle@ecole-flamboyants.test` — sans MFA, puis **Se connecter**.

1. Lire la carte unique **Grande Section A** ("3 élèves", pastille « Titulaire ») : aucune autre classe n'est listée.
2. Cliquer **« Appel du jour »**, toucher « Marquer DAGO Chantal absent », cliquer **« Transmettre l'appel »**, puis **« Fermer l'appel »**.
3. Rouvrir « Appel du jour ».

✅ « Appel transmis : 1 absent. » ; en rouvrant : « L'appel du jour est déjà transmis : vous pouvez encore corriger un élève. ». 🔒 Taper `/v2/primary/competences?classe=` suivi de l'identifiant d'une autre classe n'ouvre pas la classe (message neutre « Cet élément est introuvable ou hors de votre périmètre. »).

☐ OK ☐ KO

### Étape 99 — Saisir les compétences du CP1 A
👤 **instituteur** (ecole-flamboyants) `enseignant@ecole-flamboyants.test` (pas de MFA) · fenêtre **B** · 📂 Menu **« Compétences »** (`/v2/primary/competences`)
🔑 **Connexion** : fenêtre **B** : se déconnecter de `instituteur.maternelle@ecole-flamboyants.test` (menu du compte > Se déconnecter), puis ouvrir `/v2/login`, choisir l'établissement `ecole-flamboyants`, cliquer sur le compte **instituteur** — `enseignant@ecole-flamboyants.test` — sans MFA, puis **Se connecter**.

1. « Classe » = CP1 A (présélectionnée), « Période » = la première période ; compteur « 0 sur 3 compétences renseignées ».
2. Vue « Fiche élève », élève **KOUASSI Aya** : pour `Compétence 1.1 (démonstration)`, cliquer **"N3 Acquis"** (pastille « À enregistrer »).
3. Élève suivant **YAO Konan Éric** : **"N2 En cours d'acquisition"**. Laisser **TRAORE Fatoumata** sans saisie.
4. Cliquer **« Enregistrer »**.

✅ « Enregistré le … » ; pastilles « Enregistrée » ; compteur « 2 sur 3 compétences renseignées » ; TRAORE Fatoumata reste « Non évaluée » (jamais zéro).

⚠️ *Test d'erreur* : si une période de la liste porte « (verrouillée) », la choisir → « La saisie est arrêtée pour cette classe et cette période : la grille est en lecture seule. ».

☐ OK ☐ KO

### Étape 100 — Marquer la période « prête » et vérifier le gel de la saisie
👤 **instituteur** (ecole-flamboyants) `enseignant@ecole-flamboyants.test` (pas de MFA) · fenêtre **B** · 📂 Menu **« Ma classe (primaire) »** (`/v2/primary/classe`)

1. Cliquer **« Marquer … prête »** à côté de la première période, puis **« Marquer prête »** dans la fenêtre.
2. Retourner dans « Compétences » (même période), changer le niveau de YAO Konan Éric en **N3**, cliquer **« Enregistrer »**. Recharger ensuite la page pour abandonner cette saisie.

✅ « … : marquée prête, les familles voient désormais les compétences et le rang provisoire. » et pastille « Prête pour les familles ». Étape 2 : refus "La classe et la période sont marquées prêtes : retirer le marquage avant de modifier la saisie."

☐ OK ☐ KO

### Étape 101 — Ce que voit le parent d'une période « prête »
👤 **parent** (ecole-flamboyants) `parent@ecole-flamboyants.test` (pas de MFA) · fenêtre **B** · 📂 Menu **« Bulletin et compétences »** (`/v2/primary/mon-enfant`)
🔑 **Connexion** : fenêtre **B** : se déconnecter de `enseignant@ecole-flamboyants.test` (menu du compte > Se déconnecter), puis ouvrir `/v2/login`, choisir l'établissement `ecole-flamboyants`, cliquer sur le compte **parent** — `parent@ecole-flamboyants.test` — sans MFA, puis **Se connecter**.

1. Dans « Enfant », choisir **KOUASSI Aya — CP1 A** (seul enfant proposé, aucun élève de la maternelle ni de la CM2 A).
2. Lire la section « Compétences des périodes prêtes ou validées » puis « Bilans annuels ».

✅ Tableau de compteurs par domaine et niveau : pour `Domaine 1 (démonstration)`, N3 = 1 ; aucune moyenne, aucun détail des autres élèves. « Bilans annuels » : « Aucun bilan annuel publié pour le moment. ».

🔒 *Test de droit* : taper `/v2/primary/classe` puis `/v2/primary/bilans` → « Accès refusé ».

☐ OK ☐ KO

### Étape 102 — Retirer le marquage « prête » puis valider la grille
👤 **instituteur** (ecole-flamboyants) `enseignant@ecole-flamboyants.test` (pas de MFA) · fenêtre **B** · 📂 Menu **« Ma classe (primaire) »** (`/v2/primary/classe`) puis **« Compétences »**
🔑 **Connexion** : fenêtre **B** : se déconnecter de `parent@ecole-flamboyants.test` (menu du compte > Se déconnecter), puis ouvrir `/v2/login`, choisir l'établissement `ecole-flamboyants`, cliquer sur le compte **instituteur** — `enseignant@ecole-flamboyants.test` — sans MFA, puis **Se connecter**.

1. Cliquer **« Retirer le marquage de … »**, saisir le motif `court` puis **« Retirer le marquage »** : refus. Remplacer par `Erreur de marquage constatée (recette)` et recommencer.
2. Dans « Compétences » (CP1 A, première période) : cliquer **« Valider la grille »** (actif seulement sans saisie en attente). Lire la fenêtre « Valider la grille de compétences » (« Les compétences saisies seront figées : seule une révision motivée pourra ensuite les corriger. » et "1 compétence reste non évaluée : elle le restera."), confirmer **« Valider la grille »**.

✅ Étape 1 : "Au moins 10 caractères." puis marquage retiré (le parent ne voit plus le bloc de compétences tant que la grille n'est pas validée). Étape 2 : « Grille validée : 2 compétences validées, 1 restée non évaluée. » ; les cases passent à « Validée » ; aucun bouton « Réviser » pour l'instituteur.

☐ OK ☐ KO

### Étape 103 — Réviser une compétence validée (propriétaire)
👤 **propriétaire** (ecole-flamboyants) `direction.generale@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Compétences »** (`/v2/primary/competences`, CP1 A, première période)

1. Sur la case validée de **KOUASSI Aya**, cliquer **« Réviser »** (fenêtre « Réviser une compétence validée »).
2. Saisir « Nouveau niveau » = `N4 — Acquis avec aisance` et « Motif de la révision » = `court`, cliquer **« Réviser »** : refus. Remplacer le motif par `Correction après relecture du cahier de classe (recette)` et cliquer **« Réviser »**.
3. Rouvrir « Réviser » pour lire « Historique des révisions ».

✅ Étape 2 : "Le motif compte au moins 10 caractères." puis la case affiche N4. Historique : "N3 vers N4 le … : Correction après relecture du cahier de classe (recette)". Acte sensible, tracé (une authentification forte récente peut être demandée : se reconnecter avec le code MFA *(à vérifier)*).

☐ OK ☐ KO

### Étape 104 — Appréciations et conseil vus par l'instituteur
👤 **instituteur** (ecole-flamboyants) `enseignant@ecole-flamboyants.test` (pas de MFA) · fenêtre **B** · 📂 Menu **« Appréciations »** (`/v2/primary/appreciations`) puis **« Conseil des maîtres »** (`/v2/primary/conseil`)

1. Appréciations : lire la banque ; aucun bouton « Nouvelle phrase » ni « Désactiver » ; la note « Vous pouvez consulter la banque ; sa gestion est réservée à la direction. » ; « Ajouter à ma rédaction » fonctionne.
2. Conseil : « Préparer un conseil », classe `CP1 A`, première période, **« Préparer le conseil »** ; ouvrir un dossier, section « Ma proposition » : `Redoublement`, « Notes et observations » = `Lecture non acquise (recette)`, **« Enregistrer ma proposition »**.
3. Lire la séance en tant que lecteur.

✅ « Conseil préparé : un dossier par élève a été créé. » (ou refus à relever, comme pour la CM2 A) puis « Proposition enregistrée. ». Dans la séance : « La feuille de présence est tenue par la présidence du conseil. » ; ni « Confirmer la décision » ni « Demander le procès-verbal ».

☐ OK ☐ KO

### Étape 105 — Droits de l'instituteur
👤 **instituteur** (ecole-flamboyants) `enseignant@ecole-flamboyants.test` (pas de MFA) · fenêtre **B** · 📂 Menu **« Ma classe (primaire) »** (`/v2/primary/classe`)

1. Taper successivement `/v2/primary/etats`, `/v2/primary/direction` et `/v2/primary/parametres`.
2. Ouvrir `/v2/primary/bilans` et `/v2/primary/archives`.

✅ Étape 1 : « Accès refusé » pour les trois. Étape 2 : pages ouvertes en lecture seule : ni « Préparer les brouillons », ni « Sceller », ni « Préparer l'archive ».

☐ OK ☐ KO

### Étape 106 — Espace de l'élève
👤 **élève** (ecole-flamboyants) `eleve@ecole-flamboyants.test` (pas de MFA) · fenêtre **B** · 📂 Menu **« Bulletin et compétences »** (`/v2/primary/mon-enfant`)
🔑 **Connexion** : fenêtre **B** : se déconnecter de `enseignant@ecole-flamboyants.test` (menu du compte > Se déconnecter), puis ouvrir `/v2/login`, choisir l'établissement `ecole-flamboyants`, cliquer sur le compte **élève** — `eleve@ecole-flamboyants.test` — sans MFA, puis **Se connecter**.

1. Lire le titre et les sections.

✅ Titre « Mon bilan et mes compétences » ; pas de liste d'enfants ; compteurs de KOUASSI Aya seulement ; « Aucun bilan annuel publié pour le moment. ». 🔒 `/v2/primary/classe` et `/v2/primary/bilans` → « Accès refusé ».

☐ OK ☐ KO

### Étape 107 — Avancement vu par le directeur
👤 **directeur** (ecole-flamboyants) `directeur@ecole-flamboyants.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Avancement »** (`/v2/primary/direction`)
🔑 **Connexion** : fenêtre **A** : se déconnecter de `direction.generale@ecole-flamboyants.test` (menu du compte > Se déconnecter), puis ouvrir `/v2/login`, choisir l'établissement `ecole-flamboyants`, cliquer sur le compte **directeur** — `directeur@ecole-flamboyants.test` — **avec code MFA** (bouton "Afficher le code MFA", puis « Valider »), puis **Se connecter**.

1. Lire la ligne du CP1 A pour la première période.
2. Ouvrir « Compétences » (CP1 A) : le bouton « Réviser » est proposé sur les cases validées.

✅ CP1 A : état « En cours » (orange), « 2 sur 3 » / « 2 sur 3 » ; Grande Section A et CM2 A restent « Rien de saisi ». Le directeur peut tout ce que fait le propriétaire dans le pack Primaire (révision, scellement, archive) ; il n'a pas l'abonnement ni la définition des rôles.

☐ OK ☐ KO

## Phase 20 — Bilan de la recette

Objectif : récapituler, à la fin du parcours, le résultat de chaque phase du pack Primaire sur l'école École Primaire Les Flamboyants. Cocher une seule case par ligne et noter les anomalies (numéro d'étape, message exact, capture si possible).

| Phase | OK | KO | Anomalies observées |
| :--- | :---: | :---: | :--- |
| Appel du jour par demi-journée | ☐ | ☐ | |
| Compétences : lire la grille, période « prête » | ☐ | ☐ | |
| Banque d'appréciations | ☐ | ☐ | |
| Conseil des maîtres | ☐ | ☐ | |
| Bilans annuels et archive | ☐ | ☐ | |
| Avancement, états et espace famille | ☐ | ☐ | |
| Partie 2 — comptes instituteur, parent, élève, directeur | ☐ | ☐ | |
| Actes de fin de recette | ☐ | ☐ | |

Points connus à ne pas compter comme anomalies nouvelles : le bouton « Appel du jour » de « Ma classe » refusé pour une classe du primaire ; la décision du conseil et le scellement refusés tant que les périodes ne sont pas closes et que les résultats ne sont pas calculés ; le propriétaire qui ne peut pas saisir de compétence faute de fiche de personnel.

Signature de la recette : ____________________ Date : ____________________
