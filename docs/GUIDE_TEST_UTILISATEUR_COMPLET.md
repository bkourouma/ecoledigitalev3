# 🧭 Guide de test — EcoleDigitale

Parcours complet, **étape par étape**, de la mise en place d'une école jusqu'aux portails des familles. Chaque étape indique **qui se connecte, quel menu ouvrir, quoi faire, quelles données saisir et ce que l'on doit voir**.

- Application : <http://localhost:3000> (connexion : <http://localhost:3000/v2/login>) · API : <http://localhost:4000>
- Parcours principal : **Collège Le Baobab** (`secondaire-test`), classe **6e A**, année **2026-2027**. Le **primaire** (École Les Palmiers) et le **supérieur** (Université Horizon) ont chacun leur phase (22 et 23).
- Date de référence : **J = jeudi 8 octobre 2026**. Si vous testez un autre jour, gardez les mêmes écarts de dates (séances "du jour", échéances à 20 jours, etc.).
- Le guide compte **24 phases** et **441 étapes**. Chaque phase correspond à un module : suivez-les **dans l'ordre** (les données d'une phase servent aux suivantes), ou jouez une phase isolée si sa ligne "Précondition" est remplie. Les actes **irréversibles** sont signalés "⚠️ Irréversible" et placés en fin de phase.
- Tout est fictif : noms ivoiriens inventés, e-mails en `@exemple.test`, téléphones factices. Aucun e-mail, SMS ni paiement réel n'est émis.
- **Ce guide a été rédigé en lisant le code, sans rejouer chaque scénario.** Un attendu suivi de *(à vérifier)* n'est pas prouvé : notez ce que vous voyez. Les cas fins de chaque module (statuts rares, droits détaillés, qualité transversale) sont dans les chapitres de référence [`docs/guide-test/`](guide-test/README.md), cités en fin de chaque phase ("📚 Pour aller plus loin").

## Sommaire

1. [Connexion, abonnement et rôles (propriétaire)](#phase-1--connexion-abonnement-et-rôles-propriétaire) — étapes 1 à 14
2. [Structure académique](#phase-2--structure-académique) — étapes 15 à 28
3. [Personnes : tuteurs, élèves, personnel, inscriptions et imports](#phase-3--personnes--tuteurs-élèves-personnel-inscriptions-et-imports) — étapes 29 à 53
4. [Admissions : de la candidature à l'élève inscrit](#phase-4--admissions--de-la-candidature-à-lélève-inscrit) — étapes 54 à 73
5. [Finance : frais, facture, encaissements, reçus](#phase-5--finance--frais-facture-encaissements-reçus) — étapes 74 à 89
6. [Emploi du temps](#phase-6--emploi-du-temps) — étapes 90 à 108
7. [Appel et présences](#phase-7--appel-et-présences) — étapes 109 à 127
8. [Évaluations et notes](#phase-8--évaluations-et-notes) — étapes 128 à 145
9. [Règles, résultats et bulletins](#phase-9--règles-résultats-et-bulletins) — étapes 146 à 172
10. [Vie scolaire : de l'incident à l'information de la famille](#phase-10--vie-scolaire--de-lincident-à-linformation-de-la-famille) — étapes 173 à 189
11. [Conseil de classe et procès-verbal](#phase-11--conseil-de-classe-et-procès-verbal) — étapes 190 à 208
12. [Élèves affectés par l'État](#phase-12--élèves-affectés-par-létat) — étapes 209 à 224
13. [Examens : session, candidats, centres, notes, résultats](#phase-13--examens--session-candidats-centres-notes-résultats) — étapes 225 à 253
14. [Paie d'un enseignant](#phase-14--paie-dun-enseignant) — étapes 254 à 272
15. [Documents (GED)](#phase-15--documents-ged) — étapes 273 à 289
16. [Messagerie, annonces et notifications](#phase-16--messagerie-annonces-et-notifications) — étapes 290 à 314
17. [Tableaux de bord et alertes](#phase-17--tableaux-de-bord-et-alertes) — étapes 315 à 331
18. [Portails parent, élève, enseignant ; paiement et remboursement](#phase-18--portails-parent-élève-enseignant--paiement-et-remboursement) — étapes 332 à 351
19. [Sécurité, droits et isolation](#phase-19--sécurité-droits-et-isolation) — étapes 352 à 375
20. [Console de la plateforme (opérateur) et abonnement](#phase-20--console-de-la-plateforme-opérateur-et-abonnement) — étapes 376 à 387
21. [Accessibilité, mobile et hors ligne](#phase-21--accessibilité-mobile-et-hors-ligne) — étapes 388 à 395
22. [École Les Palmiers (primaire) : compétences, conseil des maîtres, bilan annuel](#phase-22--école-les-palmiers-primaire--compétences-conseil-des-maîtres-bilan-annuel) — étapes 396 à 419
23. [Université Horizon (supérieur) : UE/ECUE, relevé, rattrapage, diplôme](#phase-23--université-horizon-supérieur--ueecue-relevé-rattrapage-diplôme) — étapes 420 à 440
24. [Actes de fin de recette (irréversibles)](#phase-24--actes-de-fin-de-recette-irréversibles) — étapes 441 à 441

---

## Avant de commencer

### 1. Lancer l'application

Double-cliquer sur `demarrer-application.bat` (racine du dépôt), ou en ligne de commande :

```bash
pnpm dev:v2:setup
```

*(une seule fois, Docker requis)*

```bash
pnpm dev:v2
```

*(lance l'API, le site web et le worker ; le worker produit les PDF : bulletins, reçus, procès-verbaux)*

```bash
pnpm dev:v2:seed
```

*(crée les trois établissements de test dans la base locale `ecoledigitale_v2` ; sans effet sur un établissement déjà créé. Pour repartir à neuf : supprimer les établissements avec la console de la plateforme ou recréer la base locale `ecoledigitale_v2` puis relancer le seed. Ne touchez à aucune autre base.)*

Deux réglages facultatifs, à poser **avant** de lancer `pnpm dev:v2` :

| Variable | Pour quoi |
| :--- | :--- |
| `NEXT_PUBLIC_FINANCE_SANDBOX=1` | faire apparaître le fournisseur « Paiement simulé (démonstration) » dans le paiement en ligne (phases 5 et 18) |
| `NEXT_PUBLIC_PWA=1` | enregistrer le service worker pour les tests hors ligne (phase 21) |

### 2. Deux fenêtres de navigateur

| Fenêtre | Usage |
| :--- | :--- |
| **A** — normale | comptes de gestion : propriétaire, directeur, directeur des études, responsable pédagogique, secrétariat, économe, chargé d'admissions, responsable des examens |
| **B** — navigation privée | enseignant, éducateur, parent, élève |

On change de compte avec **« Se déconnecter »** (menu du compte, en haut à droite). Attention : deux fenêtres privées d'un même navigateur **partagent** la session.

### 3. Se connecter (aucun mot de passe à retenir)

1. Ouvrir `http://localhost:3000/v2/login`. Attendre quelques secondes : le panneau **« Comptes par tenant »** apparaît à droite (37 comptes, groupés par établissement).
2. Cliquer sur le compte voulu : e-mail et mot de passe se remplissent.
3. Pour un compte marqué **MFA**, cliquer **"Afficher le code MFA"** sous le compte : le code à 6 chiffres s'affiche (il change toutes les 30 secondes et ne sert qu'une fois ; il est aussi proposé à l'étape de vérification). Cliquer **« Se connecter »**, puis valider le code.

> Sur `/login` (ancienne adresse), le panneau des comptes n'apparaissait pas lors de la vérification de ce guide : utilisez `/v2/login`.
>
> **Ne copiez jamais** un mot de passe, un code MFA, un lien d'invitation ou de réinitialisation dans un rapport.

### 4. Comptes du Collège Le Baobab

| Rôle | E-mail | MFA |
| :--- | :--- | :---: |
| Propriétaire | `direction.generale@secondaire-test.test` | oui |
| Directeur | `directeur@secondaire-test.test` | oui |
| Directeur des études | `etudes@secondaire-test.test` | oui |
| Responsable pédagogique | `pedagogie@secondaire-test.test` | oui |
| Secrétariat | `secretariat@secondaire-test.test` | oui |
| Économe | `econome@secondaire-test.test` | oui |
| Enseignant (TRAORE Kouadio) | `enseignant@secondaire-test.test` | non |
| Éducateur | `educateur@secondaire-test.test` | non |
| Responsable des examens | `examens@secondaire-test.test` | non |
| Chargé d'admissions | `admissions@secondaire-test.test` | non |
| Parent (DIABATE Séka : voit Nadia et Salimata) | `parent@secondaire-test.test` | non |
| Élève (DIABATE Nadia) | `eleve@secondaire-test.test` | non |

École Les Palmiers : mêmes rôles en `…@primaire-test.test` (+ `instituteur.maternelle@primaire-test.test`) ; Université Horizon : `…@superieur-test.test`. Le détail (élèves, tuteurs, frais, matières de départ) est dans [`guide-test/annexe-donnees-de-depart.md`](guide-test/annexe-donnees-de-depart.md). L'**opérateur de la plateforme** (phase 20) a un compte distinct : ses identifiants sont communiqués par la personne qui lance l'environnement.

### 5. Fichiers fournis

Dans [`docs/guide-test/jeux-de-donnees/`](guide-test/jeux-de-donnees/README.md) :

| Fichiers | Utilisés dans |
| :--- | :--- |
| `01-students-*.csv`, `.xlsx`, `06-enrollments-*.csv` | phase 3 (imports d'élèves) |
| `17-piece-*` (acte de naissance, bulletin, photo, faux fichiers) | phase 4 (admissions) |
| `justificatif-*` (PDF, image, faux PDF) | phase 7 (justificatifs d'absence) |
| `logo-test-guide.png`, `signature-test-guide.png`, `pdf-etranger-test-guide.pdf` | phase 9 (bulletins) |
| `20-examens-*.csv` | phase 13 (examens) |
| `ged-*`, `ch15-piece-jointe-*` | phases 15 et 16 (documents, messagerie) |

### 6. Comment lire une étape

| Signe | Sens |
| :---: | :--- |
| 👤 | compte à utiliser (rôle, établissement, fenêtre) |
| 📂 | menu à ouvrir et adresse de la page |
| ✅ | ce que l'on doit voir (message exact, ligne de liste, chiffre) |
| ⚠️ *Test d'erreur* | saisie invalide à essayer, avec le message attendu |
| 🔒 *Test de droit* | adresse à taper à la main avec un compte qui n'y a pas droit |
| ⚠️ *Écart connu* | défaut déjà repéré en lisant le code : si vous le voyez, notez-le sans vous bloquer |
| ⚠️ Irréversible | action qui ne se défait pas : à jouer une seule fois |
| 📚 | où trouver les cas fins (chapitres de référence) |
| ☐ OK ☐ KO | à cocher en fin d'étape |

Un texte entre guillemets français (comme **« Créer »**) est un libellé de l'interface ; un texte entre guillemets droits ou en `code` est une valeur à saisir, un nom d'enregistrement ou un message du serveur.

---

## Phase 1 — Connexion, abonnement et rôles (propriétaire)

On ouvre l'application, on se connecte avec et sans double authentification (MFA), puis le propriétaire du Collège Le Baobab parcourt l'administration de son établissement : accueil, profil, campus, abonnement et modules, rôles et attributions. Cette phase crée le rôle personnalisé `tg_secretariat`.

Précondition : application lancée avec la base de départ (trois établissements de démonstration), J = jeudi 8 octobre 2026. Les codes MFA du panneau changent toutes les 30 secondes et ne servent qu'une fois : si un code est refusé parce qu'il vient d'être utilisé, attendre le code suivant.

### Étape 1 — Ouvrir la page de connexion et lire le panneau des comptes
👤 **personne non connectée** · fenêtre **A** · 📂 Adresse `http://localhost:3000/v2/login` (`/v2/login`)

1. Ouvrir l'adresse. À gauche, le formulaire : titre « Connexion », champs « Adresse e-mail » et « Mot de passe », bouton « Se connecter » (inactif tant que les deux champs sont vides).
2. À droite, le panneau « Comptes par tenant » : texte "Cliquez un compte pour remplir le formulaire de connexion.", comptes groupés par établissement (`secondaire-test`, `primaire-test`, `superieur-test`). Chaque bouton montre le rôle, l'e-mail et un badge "MFA" pour les comptes à double authentification.
3. Dans le sélecteur « Établissement » du panneau, choisir `primaire-test` : seuls les 13 comptes de l'École restent. Revenir sur « Tous les établissements ».

✅ Panneau présent, 37 comptes au total (12 au Collège, 13 à l'École, 12 à l'Université). Cliquer un compte remplit l'e-mail et le mot de passe (masqué) ; pour un compte à MFA, un bloc "Afficher le code MFA" apparaît sous le bouton.

⚠️ *Écart connu* : sur `/login` (sans `/v2`) le panneau peut être absent ; toujours utiliser `/v2/login`.

☐ OK ☐ KO

---

### Étape 2 — Essayer de se connecter avec des identifiants invalides
👤 **personne non connectée** · fenêtre **A** · 📂 `/v2/login`

Saisir à la main (ne pas utiliser le panneau) puis cliquer **« Se connecter »** :

| Essai | E-mail | Mot de passe |
| :--- | :--- | :--- |
| 1 | `enseignant@secondaire-test.test` | `MotDePasseFaux-TG-2026` |
| 2 | `inconnu.tg@exemple.test` | `MotDePasseFaux-TG-2026` |

✅ Dans les deux cas le même message : "Identifiants invalides. Vérifiez votre e-mail et votre mot de passe." (rien n'indique si le compte existe). Le champ « Mot de passe » est vidé après chaque essai.

⚠️ *Test d'erreur* : e-mail rempli, mot de passe vide → « Se connecter » reste inactif.

☐ OK ☐ KO

---

### Étape 3 — Connexion sans MFA : l'enseignant, puis un refus de droit
👤 **enseignant** (secondaire-test, `enseignant@secondaire-test.test`, sans MFA) · fenêtre **B** (navigation privée) · 📂 `/v2/login`

1. Cliquer le compte « Enseignant » du Collège dans le panneau (le formulaire se remplit), puis **« Se connecter »**.
2. Ouvrir « Mon compte » (en-tête) : "Rôle actif : Enseignant".
3. Taper à la main `/v2/settings` dans la barre d'adresse.
4. Cliquer **« Se déconnecter »** (en haut à droite).

✅ Étape 1 : arrivée directe sur `/v2/teacher`, sans écran de code. Étape 3 : redirection vers `/unauthorized`, page « Accès refusé » avec le texte "Vous n'avez pas les droits nécessaires pour afficher cette page.", aucune donnée de l'établissement. Étape 4 : retour à `/login`.

🔒 *Test de droit* : en enseignant, taper `/v2/access/roles` et `/v2/audit` → même page « Accès refusé ».

☐ OK ☐ KO

---

### Étape 4 — Connexion avec MFA : le propriétaire
👤 **propriétaire** (secondaire-test, `direction.generale@secondaire-test.test`, **MFA**) · fenêtre **A** · 📂 `/v2/login`

1. Cliquer le compte « Propriétaire » du Collège dans le panneau, puis **« Se connecter »**.
2. L'écran "Vérification en deux étapes" s'affiche : le champ « Code à 6 chiffres » est déjà rempli par le panneau. Cliquer **« Valider »**.

✅ Arrivée sur `/v2/direction` (écran de pilotage du propriétaire), nom de l'établissement dans l'en-tête. La session survit à un rechargement (F5). Cette fenêtre **A** reste connectée au Collège pour la suite.

⚠️ *Test d'erreur* : avant de valider, effacer le code prérempli et saisir `000000`, **« Valider »** → "Code invalide. Vérifiez l'heure de votre téléphone." (l'écran reste ouvert). Cliquer "Recommencer", recliquer le compte, **« Se connecter »**, puis **« Valider »** avec le code prérempli. (Si le code du moment vient d'être utilisé, attendre le suivant.)

☐ OK ☐ KO

---

### Étape 5 — Accueil de gestion et page d'arrivée
👤 **propriétaire** (secondaire-test) · fenêtre **A** · 📂 Adresse `/v2/home`

1. Ouvrir `/v2/home`.
2. Lire les cartes : une par module accessible, le titre de la carte est un lien et, dessous, jusqu'à 8 liens d'écrans.
3. Taper `/v2` dans la barre d'adresse.

✅ Titre "Accueil · Collège Le Baobab…" et texte « Raccourcis vers les modules auxquels votre rôle donne accès. ». Cartes attendues, entre autres : « Pilotage », « Académique », « Finance », « Utilisateurs », « Accès et rôles », « Établissement », « Journal d'audit ». Les cartes propres au pack Secondaire existent (« Vie scolaire », « Conseils de classe », « Affectés de l'État ») ; il n'y a ni « Pack Primaire » ni « Enseignement supérieur ». `/v2` redirige vers `/v2/direction`.

☐ OK ☐ KO

---

### Étape 6 — Profil et marque de l'établissement
👤 **propriétaire** (secondaire-test) · fenêtre **A** · 📂 Menu **« Établissement »** > **« Profil et marque »** (`/v2/settings`)

Attendu au départ : « Nom commercial », « Couleur principale » et « Couleur secondaire » probablement vides (les relever). Texte « Aucune modification à enregistrer. », les deux boutons inactifs.

1. Repérer les blocs « Identité », « Contact », « Marque » et « Aperçu ».
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Nom commercial | `Collège Le Baobab test guide` |
| Couleur principale | `#1A73E8` |
| Couleur secondaire | `#059669` |

3. Observer l'« Aperçu » (bandeau à la couleur principale avec le nom commercial ; « Exemple de bouton » à la couleur secondaire).
4. Cliquer **« Enregistrer le profil »**, puis recharger (F5).
5. **Rétablir** : vider les trois champs (ou remettre les valeurs relevées), **« Enregistrer le profil »**.

✅ Message « Profil enregistré. » ; après rechargement les valeurs sont conservées et l'en-tête affiche le nom commercial. Après l'étape 5, l'en-tête reprend le nom d'origine.

⚠️ *Test d'erreur* : « Couleur principale » = `bleu` → "Couleur hexadécimale attendue (ex. #1A73E8)." ; « Raison sociale » vidée → « La raison sociale est obligatoire. ». Cliquer ensuite **« Annuler les modifications »**.

⚠️ *Écart connu* : ne pas renseigner « Domaine personnalisé » ni de contact (adresses réelles). Plusieurs messages de saisie invalide (e-mail, adresse du logo) sont des messages anglais par défaut : sans gravité pour le guide.

☐ OK ☐ KO

---

### Étape 7 — Campus : créer, modifier, supprimer
👤 **propriétaire** (secondaire-test) · fenêtre **A** · 📂 Menu **« Établissement »** > **« Établissements et campus »** (`/v2/settings/institutions`)

Attendu au départ : un établissement (badges « Secondaire », « Actif »). Ne **pas** utiliser « Nouvel établissement » ici (un établissement ne se supprime pas).

1. Cliquer **« Campus »** sur la ligne de l'établissement : le tableau liste un campus avec le badge « Par défaut ».
2. Cliquer **« Nouveau campus »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Nom du campus | `Campus annexe test guide` |
| Code | `tg-annexe` |
| Adresse | `Rue des Jardins, Cocody, Abidjan` |
| Ville | `Abidjan` |
| Téléphone | `+225 27 22 44 55 66` |

3. Cliquer **« Enregistrer »**.
4. Crayon « Modifier le campus Campus annexe test guide » : « Ville » = `Yopougon`, **« Enregistrer »**.
5. Corbeille du campus **par défaut** : fenêtre « Supprimer ce campus ? », **« Confirmer »**.
6. Corbeille du campus de test (non par défaut), **« Confirmer »**.

✅ Étape 3 : le campus apparaît dans le tableau (message "Campus … créé."). Étape 4 : « Campus mis à jour. ». Étape 5 : refus du serveur (le campus par défaut ne peut pas être supprimé : message à relever), le campus par défaut reste en place. Étape 6 : « Campus supprimé. », il ne reste que le campus d'origine.

⚠️ *Test d'erreur* : « Code » = `TG ANNEXE` → "Code en minuscules, chiffres et tirets (31 caractères max)."

☐ OK ☐ KO

---

### Étape 8 — Abonnement et usage : offre, modules et fonctionnalités
👤 **propriétaire** (secondaire-test) · fenêtre **A** · 📂 Menu **« Établissement »** > **« Abonnement et usage »** (`/v2/settings/subscription`)

1. Lire le texte « Votre offre, les packs actifs et la consommation mesurée. Les changements d'offre sont gérés par l'équipe EcoleDigitale. » et les valeurs : « Offre » (la clé `PROFESSIONAL` est affichée telle quelle), « Statut de l'abonnement » (« Actif »), « Packs » (« Secondaire »), « Tranche d'apprenants » (« Illimitée »).
2. Dans « Fonctionnalités actives », relever le total, puis déplier un module (par exemple `academic`) : chaque clé indique son origine (« Socle », « Offre », « Pack »).
3. Lire « Usage mesuré » (« Apprenants actifs », « Stockage », « SMS envoyés ») ou « Aucun usage mesuré pour le moment. ».
4. Ouvrir le menu « Modules » (en haut) et lire les entrées propres à l'établissement.

✅ Offre `PROFESSIONAL`, statut « Actif », un seul pack « Secondaire », aucune dérogation. Aucun bouton de modification de l'abonnement n'existe côté établissement. Le menu « Modules » montre « Vie scolaire », « Conseils de classe » et « Affectés de l'État » (pas « Pack Primaire » ni « Enseignement supérieur »). Dans le module `academic`, la clé `academic.state-assigned` existe, pas `academic.a-la-carte` (réservée au supérieur).

🔒 *Test de droit* : fenêtre **B**, connecter le **secrétariat** (`secretariat@secondaire-test.test`, MFA) et taper `/v2/settings/subscription` → la page s'ouvre mais les données sont refusées : "Action non autorisée.". Se déconnecter.

☐ OK ☐ KO

---

### Étape 9 — Rôles et permissions : lire un rôle système
👤 **propriétaire** (secondaire-test) · fenêtre **A** · 📂 Menu **« Accès et rôles »** > **« Rôles et permissions »** (`/v2/access/roles`)

Attendu au départ : 14 rôles de type « Système (verrouillé) », aucun rôle personnalisé.

1. Taper `/v2/access` : redirection vers `/v2/access/roles`. Lire le tableau (légende « Rôles de l'établissement ») : colonnes « Rôle », « Type », « Permissions », « Attributions ». Les boutons « Nouveau rôle » et « Cloner » sont visibles.
2. Ouvrir la ligne « Secrétariat ».

✅ Fiche du rôle : « Clé : secretariat », badge « Système (verrouillé) », bandeau « Rôle système verrouillé » / « Ce rôle ne peut pas être modifié ni supprimé. Clonez-le pour créer une variante. », champs en lecture seule, grille « Permissions du rôle » avec « Rechercher une permission ». Aucun bouton « Enregistrer les modifications » ni « Supprimer le rôle ».

☐ OK ☐ KO

---

### Étape 10 — Créer le rôle personnalisé `tg_secretariat` (clone de Secrétariat)
👤 **propriétaire** (secondaire-test) · fenêtre **A** · 📂 **« Rôles et permissions »** (`/v2/access/roles`)

1. Revenir à la liste. Sur la ligne « Secrétariat », cliquer **« Cloner »**. La fenêtre « Cloner le rôle » s'ouvre.
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Libellé du nouveau rôle | `Secrétariat test guide` |
| Clé technique | `tg_secretariat` |
| Description | `Copie de test du guide` |

3. Cliquer **« Créer le clone »**.

✅ Message "Rôle … créé." (nom entre guillemets français) ; ouverture automatique du nouveau rôle : type « Personnalisé », « Clé : tg_secretariat », même nombre de permissions que « Secrétariat », texte « Ce rôle est un clone d'un autre rôle. », boutons « Cloner » et « Supprimer le rôle ». Dans la liste : 15 lignes.

⚠️ *Test d'erreur* : refaire un clonage avec la clé `tg_secretariat` → « Un rôle utilise déjà cette clé. Choisissez-en une autre. » ; clé `owner` → refus du serveur (se termine par "réservée à un modèle système.") ; libellé vide → « obligatoire » sous le champ.

☐ OK ☐ KO

---

### Étape 11 — Ajuster les permissions du rôle personnalisé
👤 **propriétaire** (secondaire-test) · fenêtre **A** · 📂 **« Rôles et permissions »** > ligne "Secrétariat test guide" (`/v2/access/roles`)

1. Ouvrir la fiche du rôle `tg_secretariat`.
2. Dans la grille « Permissions du rôle », saisir `journal` dans « Rechercher une permission », cocher "Consulter le journal d'audit". Constater que "Exporter le journal d'audit" porte l'étiquette « Sensible · MFA » : **ne pas la cocher**.
3. Lire le décompte (le texte "1 permission ajoutée" apparaît), puis cliquer **« Enregistrer les modifications »**.

✅ Message « Rôle enregistré. ». Le rôle a une permission de plus que « Secrétariat » dans la liste. Cette permission sera retirée à la fin de la phase.

⚠️ *Test d'erreur* : saisir `zzz` dans « Rechercher une permission » → « Aucune permission ne correspond à cette recherche. ».

☐ OK ☐ KO

---

### Étape 12 — Attribuer le rôle à l'éducateur et vérifier l'effet
👤 **propriétaire** (secondaire-test) · fenêtre **A** · 📂 Menu **« Accès et rôles »** > **« Attributions de rôles »** (`/v2/access/assignments`)

1. Lire le tableau « Attributions de rôles » ; filtrer « Filtrer par rôle » sur « Propriétaire » : la ligne `direction.generale@secondaire-test.test` porte « Tout l'établissement », « Sans limite », « Active ». Remettre « Tous ».
2. Dans « Nouvelle attribution », saisir :

| Champ | Valeur |
| :--- | :--- |
| Utilisateur | `educateur@secondaire-test.test` |
| Rôle | `Secrétariat test guide` |
| Périmètre | « Tout l'établissement » |
| Valide à partir du / jusqu'au | (vides) |

3. Cliquer **« Attribuer le rôle »**.
4. Fenêtre **B** : se connecter en 👤 **éducateur** (secondaire-test, `educateur@secondaire-test.test`, sans MFA) et ouvrir `/v2/audit`.
5. Fenêtre **A** : ouvrir la fiche du rôle `tg_secretariat`, cliquer **« Supprimer le rôle »**, puis confirmer dans la fenêtre « Supprimer ce rôle ? ».

✅ Étape 3 : message « Rôle attribué. », ligne « Active » dans le tableau. Étape 4 : la page du journal s'ouvre (permission "Consulter le journal d'audit") ; le bouton « Exporter en CSV » est inactif. Si la page est encore refusée, se déconnecter puis se reconnecter (cache de droits, *à vérifier*). Étape 5 : refus « Ce rôle est encore attribué à des utilisateurs. Retirez d'abord ses attributions. » : le rôle n'est pas supprimé.

⚠️ *Test d'erreur* : « Attribuer le rôle » sans rien choisir → « Choisissez un utilisateur. » et « Choisissez un rôle. ».

☐ OK ☐ KO

---

### Étape 13 — Révoquer l'attribution et remettre le rôle en l'état
👤 **propriétaire** (secondaire-test) · fenêtre **A** · 📂 **« Attributions de rôles »** puis fiche du rôle `tg_secretariat`

1. Dans « Attributions de rôles », cliquer l'icône « Révoquer l'attribution de Secrétariat test guide » (ligne de l'éducateur). Dans la fenêtre « Révoquer cette attribution ? », cliquer **« Révoquer »**.
2. Ouvrir la fiche du rôle `tg_secretariat`, rechercher `journal`, **décocher** "Consulter le journal d'audit" ("1 permission retirée"), **« Enregistrer les modifications »**.
3. Fenêtre **B** (éducateur) : recharger `/v2/audit`.

✅ Étape 1 : « Attribution révoquée. ». Étape 2 : « Rôle enregistré. », le rôle retrouve le même nombre de permissions que « Secrétariat ». Étape 3 : « Accès refusé » (au besoin se déconnecter puis se reconnecter). Le rôle `tg_secretariat` reste dans l'application, non attribué.

🔒 *Test de droit* : en éducateur, taper `/v2/access/roles`, `/v2/access/assignments` → « Accès refusé ». Se déconnecter de la fenêtre **B**.

☐ OK ☐ KO

---

### Étape 14 — Le directeur : droits de lecture et anti-escalade
👤 **directeur** (secondaire-test, `directeur@secondaire-test.test`, **MFA**) · fenêtre **A** (après « Se déconnecter » du propriétaire) · 📂 **« Rôles et permissions »** puis **« Attributions de rôles »**

1. Se connecter en directeur (clic sur le compte du panneau, **« Se connecter »**, **« Valider »**).
2. Ouvrir `/v2/access/roles`.
3. Ouvrir `/v2/access/assignments`. Dans « Nouvelle attribution » choisir l'utilisateur `educateur@secondaire-test.test` et le rôle « Propriétaire », périmètre « Tout l'établissement », puis **« Attribuer le rôle »**.

✅ Étape 2 : la liste est lisible (15 lignes) mais **sans** « Nouveau rôle » ni « Cloner » (la définition des rôles est réservée au propriétaire). Étape 3 : refus « Action refusée : vous ne pouvez accorder que des permissions que vous détenez vous-même sur ce périmètre. Permissions qui vous manquent : » suivi de la liste ; **aucune attribution créée** (le tableau est inchangé). Se déconnecter.

☐ OK ☐ KO

---

📚 *Pour aller plus loin* : chapitre 01, scénarios 1.13 à 1.19 (cas invalides de saisie, mise en service en lecture 1.15, validité d'une attribution, suppression d'un rôle) ; chapitre 02, scénarios 2.3 à 2.6 (MFA, code de secours, verrouillage après échecs), 2.10 à 2.16 (sessions, sécurité du compte, membres). La console opérateur est traitée en fin de guide.

**Ce que la phase laisse dans l'application :**
- Rôle personnalisé `tg_secretariat` ("Secrétariat test guide"), clone de « Secrétariat », non attribué (15 rôles au total).
- Rien d'autre de durable : profil et campus d'essai sont rétablis ou supprimés, l'attribution à l'éducateur est révoquée.
- Entrées dans le journal d'audit du Collège (`role.changed`, `assignment.changed`, `login.failed`), conservées.

## Phase 2 — Structure académique

Le directeur des études lit l'année en cours, prépare l'année suivante (`TG-2027-2028`), crée un programme et son curriculum, puis la classe `TG-6EB` ("6e B test guide") qu'il active. Le propriétaire termine par l'aperçu de la reconduction, sans rien écrire.

Précondition : phase précédente terminée (aucune session ouverte dans la fenêtre **A**). Les années, programmes et classes ne se suppriment pas : les noms portent "test guide" ou le préfixe `TG-`.

### Étape 15 — Lire l'année en cours et ses périodes
👤 **directeur des études** (secondaire-test, `etudes@secondaire-test.test`, **MFA**) · fenêtre **A** · 📂 Menu **« Académique »** > **« Années et périodes »** (`/v2/academic/years`)

1. Se connecter (clic sur le compte du panneau, **« Se connecter »**, **« Valider »**).
2. Taper `/v2/academic` : redirection vers `/v2/academic/years`.
3. Lire la ligne "Année scolaire 2026-2027" : colonnes « Année », « Code », « Dates », « État » ; badges « Ouverte » et « Courante ».
4. Cliquer **« Périodes »** en bout de ligne.

✅ Titre « Années académiques », dates du 1er septembre 2026 au 31 août 2027. Panneau « Périodes de Année scolaire 2026-2027 » avec la « Frise de l'année » et le tableau « Période », « Type », « Dates », « État » : 3 trimestres couvrant l'année sans trou (attendu : T1 et T2 « Ouverte », T3 « Planifiée » ; *relever l'état réel*). Le bouton « Nouvelle année » est visible ; pas de bouton « Clôturer » pour ce compte.

☐ OK ☐ KO

---

### Étape 16 — Créer l'année `TG-2027-2028`
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 **« Années et périodes »** > **« Nouvelle année »**

1. Cliquer **« Nouvelle année »**. Faire d'abord l'essai refusé : tout vide, valider → « Ce champ est obligatoire. » sous Code, Libellé et Début.
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Code | `TG-2027-2028` |
| Libellé | `Année test guide 2027-2028` |
| Début | `01/09/2027` |
| Fin | (vide : douze mois pleins par défaut) |

3. Cliquer **« Nouvelle année »** (bouton de validation de la fenêtre).

✅ Message « L'année Année test guide 2027-2028 a été créée. » ; la ligne apparaît à l'état « Brouillon », sans badge « Courante », du 1er septembre 2027 au 31 août 2028 ; boutons « Périodes », « Ouvrir », « Modifier ». Aucun bouton de suppression. Valeur conservée après rechargement.

⚠️ *Test d'erreur* : code `2026-2027`, libellé `Doublon`, début `01/09/2027` → "Ce code d'année existe déjà dans l'établissement." ; code `TG-FIN`, début `01/09/2027`, fin `01/08/2027` → "La fin de l'année doit suivre son début." ; code `TG-CHEV`, début `01/12/2026` → "L'année chevauche une autre année de l'établissement."

☐ OK ☐ KO

---

### Étape 17 — Générer les périodes de l'année test depuis un plan
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 **« Années et périodes »** > **« Périodes »** de la ligne "Année test guide 2027-2028"

1. Cliquer **« Périodes »** : message « Aucune période pour cette année. ».
2. Cliquer **« Générer depuis un plan »**. Cliquer d'abord **« Générer depuis un plan »** sans rien choisir.
3. Choisir dans « Plan de périodes » : "Trois trimestres" (la liste annonce "3 périodes seront créées" et leurs libellés). Valider.

✅ Étape 2 : « Choisissez un plan de périodes. ». Étape 3 : 3 périodes à l'état « Planifiée » couvrant l'année test sans trou ; relever leurs codes et dates. Réappliquer un plan refuse : "L'année a déjà des périodes de ces types : supprimez-les (si elles sont encore planifiées) avant d'appliquer le plan."

☐ OK ☐ KO

---

### Étape 18 — Lire les programmes
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 Menu **« Académique »** > **« Programmes »** (`/v2/academic/programs`)

1. Lire l'« Arborescence des programmes » : `COLLEGE` ("Enseignement secondaire — premier cycle") et `LYCEE` (second cycle).
2. Cliquer `COLLEGE`.

✅ Détail avec « Nature », « Domaine », « Durée (mois) », « Cycle diplômant », « Contrat de calcul des résultats » et « Niveaux couverts » : cases cochées 6e, 5e, 4e, 3e.

☐ OK ☐ KO

---

### Étape 19 — Créer le programme `TG-COL`
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 **« Programmes »** > **« Nouveau programme »**

1. Cliquer **« Nouveau programme »** (fenêtre « Créer un programme ») et saisir :

| Champ | Valeur |
| :--- | :--- |
| Code | `TG-COL` |
| Libellé | `Collège test guide` |
| Niveau d'enseignement | "Premier cycle du secondaire" |
| Programme parent | (laisser « Aucun (programme de premier niveau) ») |
| Cycle diplômant | décoché |
| Description | `Programme de test du guide` |

2. Cliquer **« Nouveau programme »** (validation).
3. Sélectionner le programme créé. Dans « Niveaux couverts », cocher "6e", cliquer **« Enregistrer les niveaux »**.

✅ Étape 2 : « Le programme Collège test guide a été créé. » (le code reste en majuscules). Étape 3 : « Les niveaux couverts ont été enregistrés. » ; valeurs conservées après rechargement.

⚠️ *Test d'erreur* : code `COLLEGE` → "Ce code de programme existe déjà dans l'établissement." ; code `TG COL` (espace) → "Code en majuscules (A-Z, 0-9, _ . -), 40 caractères max." ; code et libellé vides → « Ce champ est obligatoire. ».

☐ OK ☐ KO

---

### Étape 20 — Lire le curriculum de démonstration
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 Menu **« Académique »** > **« Curriculum »** (`/v2/academic/curriculum`)

1. Dans « Programme », choisir "Enseignement secondaire — premier cycle (COLLEGE)" ; dans « Année », "Année scolaire 2026-2027".
2. Cliquer **« Rapport de validation »**.
3. Cliquer un nœud matière (par exemple Français).

✅ « Version du curriculum » avec la pastille « Publiée », "5 nœuds" (un nœud de niveau nommé "6e A" par la graine, puis Français coef. 3, Mathématiques 3, Anglais 2, Histoire-Géographie 2), bandeau « Cette version est publiée : elle ne se modifie plus directement. Un amendement motivé et journalisé est possible. » Aucun bouton « Ajouter à la racine ». Rapport : "Le curriculum est valide (3 avertissements)" (niveaux 5e, 4e, 3e sans nœud, affichés par identifiant).

☐ OK ☐ KO

---

### Étape 21 — Construire le curriculum `TG-COL` (brouillon)
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 **« Curriculum »**

1. Choisir le programme `TG-COL` ("Collège test guide") et l'année "Année scolaire 2026-2027" : message « Aucun curriculum pour ce programme cette année. ». Cliquer **« Créer une version vide »**.
2. Cliquer **« Ajouter à la racine »** et créer le nœud de niveau ; puis, en sélectionnant le nœud `TG-6E` et **« Ajouter un enfant »**, les trois matières (champ « Matière » : taper `Fran`, `Math`, `Ang` et choisir dans la liste) :

| Type de nœud | Code | Libellé | Matière | Niveau | Coefficient |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Niveau | `TG-6E` | `6e test guide` | | 6e | |
| Matière | `TG-FRAN` | `Français test guide` | Français | | `3` |
| Matière | `TG-MATH` | `Mathématiques test guide` | Mathématiques | | `3` |
| Matière | `TG-ANG` | `Anglais test guide` | Anglais | | `2` |

3. Cliquer **« Rapport de validation »**.

✅ Étape 1 : « La version a été créée. » (état « Brouillon », "Aucun nœud"). Chaque ajout : « Le nœud … a été ajouté. ». Étape 3 : "Le curriculum est valide (sans avertissement)." La version reste en brouillon : la publication est faite plus loin (étape *Publier le curriculum TG-COL*).

⚠️ *Test d'erreur* : un second nœud de code `TG-FRAN` sous le même parent → "Ce code existe déjà parmi les nœuds frères." ; coefficient `abc` → "Décimal attendu (ex. 2 ou 2.5)." ; nœud de niveau "5e" → "Le niveau n'est pas couvert par le programme."

⚠️ *Écart connu* : le catalogue de matières ne se crée nulle part dans l'interface : n'utiliser que les matières de la graine.

☐ OK ☐ KO

---

### Étape 22 — Lire la classe de démonstration `6E-A`
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 Menu **« Académique »** > **« Classes »** (`/v2/academic/classrooms`)

1. Lire l'écran « Classes et promotions » : filtres « Année », « Programme », « État » (valeur « Tous ») ; colonnes « Classe », « Code », « Programme », « Niveau », « Effectif », « État ».
2. Cliquer sur le nom `6e A`.

✅ Classe `6E-A` "6e A", capacité 40, effectif `x / 40`, état « Active ». Fiche : « État », « Année », « Effectif », « Capacité », section « Élèves » (« Nom », « Matricule », « N° d'inscription », « Inscription ») et section « Enseignants » (« Enseignant », « Rôle », « Portée », « Période »). Ne pas utiliser « Terminer » ni « Annuler la classe » sur cette classe.

☐ OK ☐ KO

---

### Étape 23 — Créer les classes `TG-6EB` et `TG-6EC`
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 **« Classes »** > **« Nouvelle classe »**

1. Revenir à la liste, cliquer **« Nouvelle classe »** (fenêtre « Créer une classe ») et saisir :

| Champ | Valeur |
| :--- | :--- |
| Année | Année scolaire 2026-2027 |
| Programme | "Enseignement secondaire — premier cycle" |
| Niveau | 6e |
| Curriculum | "Version publiée 1 (5 nœuds)" |
| Code | `TG-6EB` |
| Nom | `6e B test guide` |
| Nature | « Classe » |
| Capacité | `30` |
| Capacité bloquante | décochée |

2. Cliquer **« Nouvelle classe »** (validation).
3. Recréer une seconde classe avec les mêmes valeurs, sauf : « Curriculum » laissé sur « Aucun », Code `TG-6EC`, Nom `6e C test guide`, Capacité `1`, « Capacité bloquante » **cochée**.

✅ Message « La classe 6e B test guide a été créée. » ; la ligne apparaît à l'état « Brouillon », effectif `0 / 30`. La seconde classe sert plus tard (classe pleine, transfert).

⚠️ *Test d'erreur* : code `6E-A` avec le même programme et niveau → "Ce code de classe existe déjà pour ce programme et ce niveau." ; nom `6e A` → "Ce nom de classe existe déjà pour ce programme et ce niveau." ; code `TG 6EB` → "Code en majuscules (A-Z, 0-9, _ . -), 40 caractères max."

☐ OK ☐ KO

---

### Étape 24 — Activer la classe `TG-6EB`
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 **« Classes »** > fiche de `6e B test guide`

1. Ouvrir la fiche de `6e B test guide` (état « Brouillon »).
2. Cliquer **« Activer »**. Dans la fenêtre « Activer 6e B test guide » ("L'activation ouvre la classe aux inscriptions et à la scolarité."), cliquer **« Activer »**.
3. Retourner à la liste, filtrer « Année » = Année scolaire 2026-2027 et « État » = « Active ».

✅ Message « La classe 6e B test guide est active. » ; la classe figure dans la liste filtrée avec l'effectif `0 / 30`.

⚠️ *Test d'erreur* : ouvrir la fiche de `6e C test guide` (sans curriculum) et tenter **« Activer »** → "Choisissez un curriculum avant d'activer la classe." ; la classe reste en « Brouillon » pour toute la suite (une classe en brouillon accepte les inscriptions).

☐ OK ☐ KO

---

### Étape 25 — Offres de cours : fonction réservée au supérieur
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 Adresse `/v2/academic/offerings`

1. Taper `/v2/academic/offerings` (l'entrée « Offres de cours » n'existe pas dans le menu « Académique » du Collège).

✅ L'écran s'ouvre avec l'avis « L'inscription à la carte n'est pas incluse dans l'offre de l'établissement. » et ne permet aucune action : la fonction `academic.a-la-carte` n'existe que pour le pack Supérieur.

☐ OK ☐ KO

---

### Étape 26 — Droits : ce que le directeur des études et l'enseignant ne voient pas
👤 **directeur des études** (secondaire-test) · fenêtre **A**, puis 👤 **enseignant** · fenêtre **B**

1. En directeur des études, taper `/v2/academic/rollover`, puis `/v2/academic/rollover/runs`.
2. Sur `/v2/academic/years`, constater qu'aucune ligne n'a de bouton « Clôturer ».
3. Fenêtre **B**, se connecter en enseignant (`enseignant@secondaire-test.test`) et taper `/v2/academic/years`, `/v2/academic/classrooms`, `/v2/academic/settings`.

✅ Étape 1 : redirection vers `/unauthorized`, « Accès refusé » (la reconduction est réservée au propriétaire et au directeur ; la barre « Cœur académique » n'a pas d'onglet « Reconduction »). Étape 3 : « Accès refusé » à chaque adresse ; le menu de l'enseignant n'a pas de module « Académique ». Se déconnecter de la fenêtre **B**.

🔒 *Test de droit* : fait dans cette étape (deux comptes).

☐ OK ☐ KO

---

### Étape 27 — ⚠️ Irréversible : publier le curriculum `TG-COL`
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 **« Curriculum »**, programme `TG-COL`, année "Année scolaire 2026-2027"

1. Sélectionner la version brouillon construite à l'étape *Construire le curriculum TG-COL*.
2. Cliquer **« Publier »**. La fenêtre « Publier cette version » ("Une version publiée sert de référence aux classes, aux offres et aux notes…") s'ouvre ; cliquer **« Publier »**.

✅ Message « La version est publiée. » ; la mention « Publiée le … » apparaît, la pastille passe à « Publiée » et tous les boutons d'édition disparaissent (la version ne se modifie plus que par amendement motivé, ce qui relève du directeur).

☐ OK ☐ KO

---

### Étape 28 — Reconduction annuelle : aperçu sans écriture
👤 **propriétaire** (secondaire-test, `direction.generale@secondaire-test.test`, **MFA**) · fenêtre **A** (après « Se déconnecter » du directeur des études) · 📂 Menu **« Académique »** > **« Reconduction annuelle »** (`/v2/academic/rollover`)

1. Se connecter en propriétaire. Ouvrir « Reconduction annuelle ».
2. Étape « Années » : cliquer d'abord **« Suivant »** sans rien choisir. Puis « Année source » = "Année scolaire 2026-2027" et « Année cible » = "Année test guide 2027-2028". **« Suivant »**.
3. Étape « Éléments à reconduire » (« Cochez ce que vous voulez copier. Chaque étape peut être refaite sans doublon. ») : laisser tout coché, **« Suivant »**.
4. Étape « Aperçu » : lire les rubriques.
5. Cliquer **« Actualiser l'aperçu »**. **Ne pas passer à l'étape suivante.**
6. Ouvrir « Historique des reconductions » (`/v2/academic/rollover/runs`), « Année source » = Année scolaire 2026-2027.

✅ Étape 2 : « Choisissez l'année source. » et « Choisissez l'année cible. ». Étape 4 : « Aperçu en lecture seule : aucune donnée n'a été modifiée. » ; « Curriculum par programme » avec « Sera cloné » pour `COLLEGE` ; « Classes à créer » avec `6e A`, `6e B test guide` (code et capacité) ; l'avertissement « L'année cible a déjà des périodes » (les périodes de l'année test existent) ; des anomalies « Décision de fin d'année manquante » et l'avertissement « Décisions de passage manquantes » (aucune décision de passage n'est saisie au départ). Le statut de l'année cible dans la liste est « Brouillon » (*à vérifier*). Étape 6 : "Aucune reconduction pour cette année." — rien n'a été créé.

⚠️ *Test d'erreur* : tout décocher à l'étape « Éléments à reconduire », **« Suivant »** → « Retenez au moins une étape. ».

⚠️ *Écart connu* : « Suivant » reste muet tant que l'aperçu n'est pas calculé ; patienter. Ne **pas** lancer la reconduction ici : elle est durable (chapitre 03, scénario 3.13), de même que la clôture de l'année test (3.14), à jouer en fin de guide.

☐ OK ☐ KO

---

📚 *Pour aller plus loin* : chapitre 03, scénarios 3.3 à 3.5 (trou et chevauchement entre années, ajout, suppression et cycle de vie d'une période), 3.6 (paramètres académiques), 3.8 (amendement et clonage du curriculum), 3.10 (offres de cours à la carte, supérieur), 3.11 (calendrier), 3.12 à 3.15 (reconduction réelle, clôture de l'année test, droits et isolation).

**Ce que la phase laisse dans l'application :**
- Année `TG-2027-2028` "Année test guide 2027-2028" à l'état « Brouillon », avec ses 3 périodes « Planifiée » (non ouverte, non clôturée).
- Programme `TG-COL` "Collège test guide" (niveau 6e couvert) avec son curriculum publié 2026-2027 (4 nœuds : `TG-6E`, `TG-FRAN`, `TG-MATH`, `TG-ANG`).
- Classe `TG-6EB` "6e B test guide" (programme `COLLEGE`, niveau 6e, capacité 30, curriculum « Version publiée 1 »), **active**, effectif 0.
- Classe `TG-6EC` "6e C test guide" (capacité 1 bloquante, sans curriculum), en « Brouillon ».
- Aucune reconduction lancée, aucune année clôturée.

---

## Phase 3 — Personnes : tuteurs, élèves, personnel, inscriptions et imports

On crée à la main la famille KOUASSI (tuteur, élève), le premier enseignant du guide et l'inscription de l'élève, puis on remplit la 6e A par des imports (fichier valide, fichier avec erreurs, inscriptions, classeur Excel). À la fin, la 6e A compte **35 élèves sur 40**.

Précondition : phase *Structure académique* jouée, donc les classes `6e B test guide` (code `TG-6EB`, **active**, capacité 30, effectif 0 / 30) et `6e C test guide` (`TG-6EC`, brouillon) existent. La 6e A de la graine compte 12 élèves.

> ⚠️ **Deux élèves "KOUASSI Aïcha test guide" existeront à la fin de la phase** : celle créée à la main (née le **12/05/2014**, classe 6e B, la seule que les phases suivantes utilisent) et celle de l'import (née le **12/03/2014**, matricule d'origine `TG-ELV-S01`, classe 6e A). Ce ne sont pas des doublons (dates de naissance différentes). Dans les listes, distinguez-les par le **matricule** et la **classe**.

> ⚠️ **Les imports écrivent des données définitives** (aucun retour arrière à l'écran). Respectez l'ordre des étapes et **n'exécutez pas** le fichier de démonstration `eleves-demonstration.csv` (la capacité de la 6e A serait dépassée). Gardez l'onglet au premier plan pendant la validation et l'exécution d'un import.

---

### Étape 29 — Lire la liste des élèves de départ
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 Menu **« Personnes »** > **"Élèves"** (`/v2/students`)

Premier passage de ce compte : `secretariat@secondaire-test.test` (**MFA** : le code du moment est proposé sur la page de connexion).

Attendu au départ : au moins 12 élèves (DIABATE Nadia, DIABATE Salimata, BAMBA Aya… ; Nadia porte le matricule `00001`), 8 inscrits en 6e A et 4 « Non inscrit » ou en attente.

1. Lire les colonnes « Élève », « Matricule », « Classe », « Inscription », « Statut » et la barre d'onglets « Élèves », « Nouvel élève », « Tuteurs ».
2. Dans « Rechercher un élève », saisir `diabate` (minuscules).

✅ DIABATE Nadia et DIABATE Salimata sont retrouvées (la recherche ignore casse et accents). `zzzz` affiche « Aucun élève ne correspond à votre recherche. »

☐ OK ☐ KO

---

### Étape 30 — Créer le tuteur KOUASSI Marcel test guide
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 Onglet **« Tuteurs »** (`/v2/guardians`)

1. Cliquer **« Nouveau tuteur »** (fenêtre « Créer un tuteur »).
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Nom | `KOUASSI` |
| Prénoms | `Marcel test guide` |
| Sexe | « Masculin » |
| Date de naissance | `03/04/1980` |
| Lieu de naissance | `Abidjan` |
| Nationalité (code pays) | `CI` |
| Adresse e-mail | `marcel.kouassi.tg@exemple.test` |
| Téléphone | `+225 07 58 12 34 56` |
| Ville | `Abidjan` |
| Adresse | `Rue des Jardins, Cocody (fictif)` |
| Lieu de résidence | `Cocody` |
| Profession | `Commerçant` |

3. Cliquer **« Créer »**.

✅ Message "Le tuteur KOUASSI Marcel test guide a été créé." ; la ligne apparaît avec **0** enfant et la pastille « Sans compte ». Le téléphone peut s'afficher sans espaces.

⚠️ *Test d'erreur* : fenêtre ouverte, Nom et Prénoms vides, « Créer » → « Ce champ est obligatoire. » sous chacun. E-mail `marcel.exemple` → "Adresse e-mail invalide." Téléphone `12` → "Téléphone trop court."

☐ OK ☐ KO

---

### Étape 31 — Signaler un doublon de tuteur
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 Onglet **« Tuteurs »** (`/v2/guardians`)

1. Cliquer **« Nouveau tuteur »** et saisir seulement Nom `KOUASSI` et Prénoms `Marcel test guide`, puis **« Créer »**.
2. Lire l'encadré, puis cocher **« Ce n'est pas un doublon : créer quand même »**.

✅ La fenêtre reste ouverte ; l'encadré annonce "1 dossier ressemble à cette personne" avec la mention « Même nom » (une date de naissance manque d'un côté). Après la case cochée, le champ « Motif de la création » apparaît. **Fermer la fenêtre sans créer** : le tuteur n'existe qu'une fois (recherche `KOUASSI`).

⚠️ *Test d'erreur* : case cochée, « Motif de la création » vide, « Créer » → "Un motif est requis pour confirmer un doublon possible."

☐ OK ☐ KO

---

### Étape 32 — Créer l'élève KOUASSI Aïcha test guide avec son tuteur
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 Onglet **« Nouvel élève »** (`/v2/students/new`)

1. Étape « Identité » : saisir

| Champ | Valeur |
| :--- | :--- |
| Nom | `KOUASSI` |
| Prénoms | `Aïcha test guide` |
| Sexe | « Féminin » |
| Date de naissance | `12/05/2014` |
| Lieu de naissance | `Abidjan` |
| Nationalité (code pays) | `CI` |
| Adresse e-mail | `aicha.kouassi.tg@exemple.test` |
| Téléphone | `+225 07 58 12 34 57` |
| Ville | `Abidjan` |
| Adresse | `Rue des Jardins, Cocody (fictif)` |

   puis **« Suivant »** : aucun encadré de doublon ne doit apparaître.
2. Étape « Tuteurs » : **« Ajouter un tuteur existant »** ; dans « Tuteur » (placeholder "Rechercher un tuteur…") taper `test guide` et choisir KOUASSI Marcel test guide ; « Lien de parenté » = "Père". Laisser cochés « Contact principal », « Contact d'urgence », « Accès au portail parents » ; **cocher « Responsable financier »**. **« Suivant »**.
3. Étape « Récapitulatif » : relire « Tuteurs à lier » (`1`) et la note « Le matricule est attribué automatiquement à la création. » Cliquer **« Créer le dossier »**.

✅ Écran « Dossier créé » : "KOUASSI Aïcha test guide — matricule N." **Relever le matricule N**. Boutons « Ouvrir la fiche » et « Inscrire maintenant ». Sur `/v2/guardians`, KOUASSI Marcel test guide compte maintenant **1** enfant.

⚠️ *Test d'erreur* : (sans rien créer) Sexe laissé sur « Choisir… » puis « Suivant » → "Le sexe est obligatoire pour un élève." Date de naissance `12/05/2030` → "Date de naissance invraisemblable."

🔒 *Test de droit* : en tant que **directeur des études** (`etudes@secondaire-test.test`, MFA), taper `/v2/students/new` → page « Accès refusé ».

☐ OK ☐ KO

---

### Étape 33 — Signaler un doublon d'élève
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 Onglet **« Nouvel élève »** (`/v2/students/new`)

1. Ressaisir l'identité exacte : Nom `KOUASSI`, Prénoms `Aïcha test guide`, Sexe « Féminin », Date de naissance `12/05/2014`, puis **« Suivant »**.

✅ L'encadré affiche "1 dossier ressemble à cette personne" avec « Même nom et même date », le matricule, le rôle « Élève » et le lien « Ouvrir la fiche ». Le passage à l'étape suivante est bloqué.

2. Changer la date en `13/05/2014` : plus de doublon (les homonymes de dates différentes ne sont pas des doublons). Revenir à `12/05/2014`, cocher **« Ce n'est pas un doublon : créer quand même »** : le champ « Motif de la création » apparaît. **Quitter la page sans rien créer** (menu « Élèves »).

⚠️ *Test d'erreur* : case cochée, motif vide, « Suivant » → "Un motif est requis pour confirmer un doublon possible."

☐ OK ☐ KO

---

### Étape 34 — Lire et modifier la fiche élève
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 **"Élèves"** > fiche de `KOUASSI Aïcha test guide` (`/v2/students`)

1. Lire l'en-tête : nom, "Matricule N", pastilles « Actif » et « Non inscrit », boutons « Inscrire », « Modifier », « Changer le statut ». Onglets : « Identité », « Tuteurs », « Urgences », « Parcours scolaire », « Statut », « Pièces ».
2. Onglet « Identité » : « Première inscription » et « Compte du portail » = « Aucun compte » ; les valeurs absentes affichent « — ». La section « Tuteur principal » donne un lien vers KOUASSI Marcel test guide (lien de parenté peut s'afficher en code brut `FATHER`).
3. Section « Informations sensibles » : cliquer **« Afficher les informations sensibles »**, constater que les champs sont vides, puis **« Masquer »**.
   ⚠️ *Écart connu* : aucun écran ne permet de saisir l'identifiant national ni l'acte de naissance, ces champs restent vides.
4. Cliquer **« Modifier »**, changer « Ville » en `Yamoussoukro` et « Lieu de résidence » en `Plateau`, **« Enregistrer »**.

✅ « La fiche a été mise à jour. » Les nouvelles valeurs persistent après rechargement. Remettre « Ville » = `Abidjan` (facultatif).

⚠️ *Test d'erreur* : vider « Nom » puis « Enregistrer » → « Ce champ est obligatoire. »

🔒 *Test de droit* : en tant que **directeur des études**, la même fiche n'a ni « Modifier » ni section « Informations sensibles ».

☐ OK ☐ KO

---

### Étape 35 — Ajouter un contact d'urgence
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 **"Élèves"** > fiche de `DIABATE Nadia` > onglet **« Urgences »**

Le contact est ajouté à une fiche de la graine, car le compte parent du guide ne voit que Nadia et Salimata.

Attendu au départ : « Aucun contact d'urgence. »

1. Cliquer **« Ajouter un contact »** (fenêtre « Ajouter un contact d'urgence »).
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Nom du contact | `BAMBA Oncle test guide` |
| Lien avec l'élève | `Oncle` |
| Téléphone | `+225 07 12 34 56 78` |
| Adresse e-mail | `oncle.bamba.tg@exemple.test` |

3. Valider.

✅ « Le contact a été ajouté. » ; la ligne apparaît (colonnes « Nom », « Lien », « Téléphone », « Priorité »).

⚠️ *Test d'erreur* : Téléphone vide → « Ce champ est obligatoire. » ; Téléphone `12` → "Téléphone trop court."

☐ OK ☐ KO

---

### Étape 36 — Corriger les coordonnées du contact (parent)
👤 **parent** (secondaire-test) · fenêtre **B** · 📂 Taper l'adresse `/v2/students/children`

Premier passage de ce compte : `parent@secondaire-test.test` (pas de MFA). ⚠️ *Écart connu* : « Mes enfants » n'est pas dans le menu du portail, il faut taper l'adresse.

1. Lire « Mes enfants » : seules **DIABATE Nadia** et **DIABATE Salimata** sont listées.
2. Cliquer **« Ouvrir la fiche »** de Nadia. Section « Contacts d'urgence » : cliquer **« Corriger »** sur BAMBA Oncle test guide (fenêtre "Corriger les coordonnées de BAMBA Oncle test guide").
3. Changer « Téléphone » en `+225 07 12 34 56 79`, **« Enregistrer »**.

✅ « Les coordonnées ont été mises à jour. » Le parent ne peut modifier ni le lien ni la priorité et n'a aucun bouton d'ajout ou de retrait.

🔒 *Test de droit* : en tant que **parent**, taper `/v2/students` → « Accès refusé ».

☐ OK ☐ KO

---

### Étape 37 — Retirer le contact d'urgence
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 **"Élèves"** > fiche de `DIABATE Nadia` > onglet **« Urgences »**

1. Recharger l'onglet : le numéro est `+225 07 12 34 56 79` (corrigé par le parent).
2. Cliquer **« Retirer »** sur la ligne.

✅ « Le contact a été retiré. » ; l'onglet affiche de nouveau « Aucun contact d'urgence. »

☐ OK ☐ KO

---

### Étape 38 — Déposer l'acte de naissance de l'élève
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 **"Élèves"** > fiche de `KOUASSI Aïcha test guide` > onglet **« Pièces »**

Fichiers : `docs/guide-test/jeux-de-donnees/04-piece-eleve-test-guide.pdf` et `docs/guide-test/jeux-de-donnees/04-piece-eleve-invalide-test-guide.txt`.

Attendu au départ : « Aucune pièce au dossier. »

1. Cliquer **« Déposer une pièce »**.
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Type de pièce | « Acte de naissance » |
| Fichier | `04-piece-eleve-test-guide.pdf` |
| Intitulé | `Acte de naissance test guide` |
| Date d'émission | `10/06/2014` |

3. Cliquer **« Déposer »**.
4. Cliquer **« Ouvrir »** sur la pièce : le fichier s'ouvre dans un nouvel onglet.
5. Cliquer **« Retirer »**, saisir le « Motif du retrait » `Pièce de test retirée`, confirmer **« Retirer »**.

✅ La pièce apparaît en "Version 1", « Active » ; après le retrait, elle est « Retirée » dans l'historique avec son motif. ⚠️ *Écart connu* : si le stockage de fichiers n'est pas branché, le dépôt répond "Le stockage de fichiers n'est pas disponible." *(à vérifier)*

⚠️ *Test d'erreur* : « Déposer » sans fichier → « Choisissez un fichier. » ; fichier `04-piece-eleve-invalide-test-guide.txt` → « Format non accepté : PDF, JPEG, PNG ou WebP uniquement. » ; motif de retrait de 3 caractères → « Le motif doit comporter au moins 5 caractères. »

🔒 *Test de droit* : en tant que **directeur des études**, l'onglet « Pièces » affiche « Accès restreint ».

☐ OK ☐ KO

---

### Étape 39 — Créer l'enseignant OUATTARA Zénon test guide
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 Menu **« Personnes »** > **"Personnel"** > onglet **« Nouveau membre »** (`/v2/staff/new`)

Premier passage de ce compte : `directeur@secondaire-test.test` (**MFA**). Pour changer de compte : « Se déconnecter » dans la fenêtre A.

Attendu au départ (`/v2/staff`) : TRAORE Kouadio, YAO Fatou et KOUAME Adjoua, statut « En poste ».

1. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Nom | `OUATTARA` |
| Prénoms | `Zénon test guide` |
| Sexe | « Masculin » |
| Date de naissance | `17/04/1985` |
| Adresse e-mail | `zenon.ouattara.tg@exemple.test` |
| Téléphone | `+225 05 66 21 34 78` |
| Ville | `Abidjan` |
| Catégorie | « Enseignant » |
| Intitulé du poste | `Professeur de mathématiques test guide` |
| Date d'embauche | `01/09/2026` |

2. Cliquer **« Créer la fiche »**.

✅ Écran « Fiche créée » : "OUATTARA Zénon test guide — matricule P00NN." (`P` suivi de 4 chiffres : **relever le matricule**). Boutons « Ouvrir la fiche » et « Retour à la liste ».

3. Pour tester le doublon : « Nouveau membre », Nom `OUATTARA`, Prénoms `Autre test guide`, **même adresse e-mail** `zenon.ouattara.tg@exemple.test`, « Créer la fiche » : l'encadré annonce "1 dossier ressemble à cette personne" avec « Même e-mail ». **Ne pas créer** ; quitter la page.

⚠️ *Test d'erreur* : e-mail `zenon.exemple` → "Adresse e-mail invalide." ; Nom et Prénoms vides → « Ce champ est obligatoire. »

🔒 *Test de droit* : en tant que **secrétariat**, taper `/v2/staff` → « Accès refusé ».

☐ OK ☐ KO

---

### Étape 40 — Compléter la fiche du personnel (poste, contrat)
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 **"Personnel"** > fiche de `OUATTARA Zénon test guide` (`/v2/staff`)

1. Lire l'en-tête : "Matricule P00NN — Enseignant — Professeur de mathématiques test guide", boutons « Modifier », « Inviter au portail », « Changer le statut ». Onglets : « Identité », « Contrats », « Qualifications », « Compétences », « Disponibilités », « Charge horaire », « Historique ».
2. **« Modifier »**, changer « Intitulé du poste » en `Professeur principal test guide`, **« Enregistrer »** : « La fiche a été mise à jour. »
3. Onglet « Contrats » > **« Ajouter un contrat »** :

| Champ | Valeur |
| :--- | :--- |
| Type de contrat | "Contrat à durée déterminée" |
| Statut initial | « En cours » |
| Début | `01/09/2026` |
| Fin | `31/08/2027` |
| Volume horaire contractuel | `18` |
| Unité | « Par semaine » |
| Note | `Contrat de test du guide` |

4. Valider avec **« Ajouter un contrat »**, puis cliquer **« Terminer »** sur la ligne.

✅ « Le contrat a été ajouté. » (ligne "18 h / semaine", « En cours »), puis « Le contrat est terminé. »

⚠️ *Test d'erreur* : contrat sans type → « Ce champ est obligatoire. »

> L'invitation au portail (« Inviter au portail ») crée un accès fictif **non supprimable** : elle n'est pas jouée ici (voir le chapitre).

🔒 *Test de droit* : en tant que **directeur des études**, ni « Modifier » ni onglet « Contrats » sur cette fiche.

☐ OK ☐ KO

---

### Étape 41 — Affecter OUATTARA Zénon à l'enseignement des mathématiques
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 Menu **« Personnes »** > **"Affectations"** (`/v2/staff/assignments`)

Premier passage de ce compte : `etudes@secondaire-test.test` (**MFA**).

1. Lire « Affectations d'enseignement » : onglets « Par classe » et « Par enseignant », « Année » préremplie.
2. Onglet « Par classe » : dans « Classe », chercher `test guide` et choisir `6e B test guide`. La matrice « Matrice matière par rôle d'enseignement » liste les matières ; le bandeau signale celles sans responsable.
3. Sur la ligne `Mathématiques`, colonne « Responsable », cliquer **« Affecter »** (fenêtre "Affecter un enseignant à Mathématiques").
4. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Enseignant | `OUATTARA Zénon test guide` |
| Rôle | « Responsable » |
| Période | « Toute l'année » |
| Début | date du jour (par défaut) |
| Heures prévues | `4` |
| Note | `Affectation de test` |

5. Cliquer **« Affecter »**.

✅ « L'affectation est enregistrée. » ; le nom apparaît dans la cellule « Responsable » de Mathématiques. Onglet « Par enseignant » > `OUATTARA Zénon test guide` : « Charge horaire et affectations » liste l'affectation (4 h prévues).

⚠️ *Test d'erreur* : « Affecter » sans choisir d'enseignant → « Choisissez un enseignant. » ; un second responsable sur Mathématiques → "Cette matière a déjà un responsable (OUATTARA Zénon test guide) : ajoutez un co-enseignant (CO_TEACHER) ou terminez l'affectation existante."

🔒 *Test de droit* : en tant que **secrétariat**, taper `/v2/staff/assignments` → « Accès refusé ».

☐ OK ☐ KO

---

### Étape 42 — Inscrire KOUASSI Aïcha en 6e B
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 Menu **« Académique »** > **« Inscriptions »** > onglet **« Nouvelle inscription »** (`/v2/enrollments/new`)

1. Étape « Élève » : choisir « Élève existant » ; dans « Élève », chercher `Aïcha test guide` et choisir celle au **matricule N relevé plus haut**.
2. Étape « Classe » : « Année » = année courante (proposée) ; « Classe » = `6e B test guide` ; lire "Effectif : 0 sur 30. La capacité est indicative." ; « Mode d'inscription » = « Par classe (cursus complet) » ; « Date d'inscription » vide ; « Redoublement » décoché.
3. Étape « Financement » : « Type de financement » = « Privé » (laisser).
4. Étape « Récapitulatif » : cliquer **« Inscrire »**.

✅ Écran « Inscription enregistrée » : "N° d'inscription : DEMO-… Statut : en attente de confirmation." **Relever le numéro d'inscription**. Boutons « Ouvrir l'inscription », « Inscrire un autre élève », « Retour à la liste ».

⚠️ *Test d'erreur* : « Suivant » sans élève → « Choisissez un élève. » ; sans classe → « Choisissez une classe. » ; réinscrire Aïcha dans `6e B test guide` → avertissement "Cet élève a déjà une inscription en cours cette année. Le serveur refusera un doublon dans la même classe." puis refus "L'apprenant a déjà une inscription vivante dans cette classe."

🔒 *Test de droit* : en tant que **directeur des études**, taper `/v2/enrollments/new` → « Accès refusé ».

☐ OK ☐ KO

---

### Étape 43 — Contrôler l'inscription en attente
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 **« Inscriptions »** > onglet **« Liste des inscriptions »** (`/v2/enrollments`)

1. Dans le filtre « Statut », choisir « En attente », puis ouvrir l'inscription de KOUASSI Aïcha test guide (**« Ouvrir »**).
2. Lire la section « Confirmation et frais d'inscription » : "Politique de confirmation : confirmée au paiement des frais d'inscription." puis "L'inscription attend sa confirmation, selon la politique ci-dessus."

✅ Statut « En attente ». Le secrétariat ne voit que le bouton « Annuler » (pas de « Confirmer »). L'effectif de `6e B test guide` est 1 / 30.

3. Se déconnecter, se connecter en **directeur** et ouvrir la même fiche : le bouton **« Confirmer sans paiement »** est proposé. **Ne pas confirmer** (voir le test d'erreur ci-dessous) : l'inscription doit rester « En attente » jusqu'au paiement des frais (facture d'inscription, phase *Finance*).

⚠️ *Test d'erreur* : cliquer **« Confirmer sans paiement »**, laisser « Motif » vide et valider → « Le motif doit comporter au moins 5 caractères. » (vérifier qu'aucune confirmation n'a lieu, puis fermer la fenêtre **sans** saisir de motif valide).

📚 La dérogation, la suspension, le transfert vers `6e C test guide`, l'annulation et le retrait sont des actions à effet durable : voir chapitre 04, scénarios 4.23 à 4.28 (ils utilisent des élèves "2" et "3" qui ne sont pas créés dans ce guide).

☐ OK ☐ KO

---

### Étape 44 — Lire l'historique des imports et l'import de démonstration
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 Menu **"Imports"** > **"Imports Excel / CSV"** (`/v2/imports`)

1. Lire la barre d'onglets : « Historique », « Nouvel import », « Modèles » (pas de « Paramètres » pour ce compte).
2. Lire le tableau « Historique des imports » : ligne `eleves-demonstration.csv`, Données "Élèves", « Prêt à importer », "15 ligne(s)".
3. Cliquer sur le nom du fichier : la fiche s'ouvre à l'étape « 4. Erreurs et aperçu avant import ».

✅ Compteurs « À créer » 0, « En erreur » 15, et le message `La colonne "Classe" exige l'option "Année scolaire des inscriptions".` (15 ×). Le bouton « Lancer l'import » est inactif. ⚠️ *Écart connu* : l'état « Prêt à importer » avec 15 erreurs est un défaut connu de la graine. **Ne rien lancer**, cliquer **« Retour à l'historique »**.

🔒 *Test de droit* : en tant que **éducateur** (`educateur@secondaire-test.test`, fenêtre **B**), taper `/v2/imports` → « Accès refusé ». Idem `/v2/imports/settings` pour le secrétariat.

☐ OK ☐ KO

---

### Étape 45 — Télécharger le gabarit des élèves
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 Onglet **« Nouvel import »** (`/v2/imports/new`)

1. Lire le titre "1. Choisir l'importeur et envoyer le fichier". Les cartes utilisables sont "Élèves", "Parents et tuteurs", "Inscriptions" ; les autres sont grisées avec "Droits manquants : ...".
2. Cliquer la carte **"Élèves"** : la section "Colonnes attendues pour "Élèves"" liste les colonnes (« obligatoire » sur Nom, Prénoms, Sexe).
3. Cliquer **« Télécharger le modèle CSV »** (le navigateur peut demander l'autorisation). Faire de même avec **« Télécharger le modèle Excel »**.
4. Ouvrir `modele-import-students.csv` dans le Bloc-notes.

✅ Fichiers `modele-import-students.csv` et `modele-import-students.xlsx` téléchargés. Le CSV est en `;`, 2 lignes d'exemple fictives (KONE Aminata, TRAORE Ibrahim) et les mêmes en-têtes que ceux des fichiers du dossier `jeux-de-donnees`. L'Excel a une feuille "Données" et une feuille "Aide".

⚠️ *Test d'erreur* : cliquer **« Envoyer et continuer »** sans rien choisir → "Choisissez le type de données à importer." puis, une fois la carte choisie, "Choisissez un fichier .xlsx, .xls, .ods ou .csv."

☐ OK ☐ KO

---

### Étape 46 — Importer 10 élèves (fichier valide)
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 Onglet **« Nouvel import »** (`/v2/imports/new`)

Fichier : `docs/guide-test/jeux-de-donnees/01-students-valide-secondaire.csv` (10 élèves, classe `6E-A`).

1. Carte **"Élèves"** ; « Fichier à importer » = le fichier ; « Feuille (facultatif) » vide ; **« Envoyer et continuer »**.
2. Étape "2. Associer les colonnes du fichier" : "Le fichier compte 18 colonne(s)." Vérifier que les 18 champs sont associés. Options : "Année scolaire des inscriptions" = **l'année courante** ("Année scolaire 2026-2027 (courante)") ; "Doublons probables (même nom et même naissance)" = "Refuser (recommandé)" ; « Si la donnée existe déjà » = « Ignorer les lignes déjà présentes ».
3. Cliquer **« Enregistrer et valider le fichier »** et attendre la barre « Validation des lignes ».

✅ Aperçu : « À créer » **10**, « À mettre à jour » 0, « À ignorer » 0, « En erreur » **0**, « Avertissements » 0, et "Aucune erreur : toutes les lignes sont valides."

4. Mode « Importer les lignes valides seulement » (par défaut). Cocher « J'ai consulté l'aperçu et les erreurs, et je confirme le lancement de l'import. » puis cliquer **« Lancer l'import »**.

⚠️ **Irréversible** : les 10 élèves sont créés définitivement.

✅ Écran « Import en cours » (« En attente de traitement » puis « Import en cours »), puis rapport « Import terminé » : « Créées » **10**, « Mises à jour » 0, « Ignorées » 0, « En erreur » 0. Si la barre reste à 0, vérifier que le worker est démarré et recharger la page.

⚠️ *Test d'erreur* (avant le lancement, à l'étape des colonnes) : associer « Nom » à "— Ne pas importer ce champ —" → "Associez une colonne à ce champ obligatoire." et bandeau "Champs obligatoires sans colonne : Nom." Remettre l'association.

☐ OK ☐ KO

---

### Étape 47 — Contrôler les 10 élèves importés
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 **"Élèves"** (`/v2/students`)

1. Rechercher `test guide`.

✅ On retrouve, outre KOUASSI Aïcha test guide (créée à la main, 6e B, « En attente »), les 10 élèves importés, classe **6e A**, inscription « En attente » : KOUASSI Aïcha test guide, KOUASSI Yves test guide, KONÉ Fanta test guide, TRAORE Mamadou test guide, YAO Adjoua test guide, BAMBA Ismaël test guide, COULIBALY Awa test guide, DIABATE Seydou test guide, BROU Esther test guide, OUATTARA Souleymane test guide.

2. Ouvrir la fiche de l'**Aïcha importée** (classe 6e A) : naissance **12/03/2014**, lieu Abidjan, e-mail `aicha.kouassi.tg@exemple.test`. Ne pas la confondre avec celle du matricule N (12/05/2014, 6e B).
3. Menu **« Académique »** > **"Classes"** (`/v2/academic/classrooms`), fiche de la 6e A : « Effectif » **22 sur 40**.

✅ 10 élèves et 10 inscriptions créés ; la 6e A passe de 12 à **22 / 40** ; `6e B test guide` reste à 1 / 30.

☐ OK ☐ KO

---

### Étape 48 — Importer le fichier avec erreurs (3 lignes valides sur 15)
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 Onglet **« Nouvel import »** (`/v2/imports/new`)

Fichier : `docs/guide-test/jeux-de-donnees/01-students-erreurs-secondaire.csv` (15 lignes). Carte **"Élèves"**, options : année courante, "Refuser (recommandé)", « Ignorer les lignes déjà présentes ».

1. Envoyer le fichier, vérifier l'association des colonnes, **« Enregistrer et valider le fichier »**.

✅ Aperçu : « À créer » **3**, « En erreur » **12**, « Avertissements » **1**. Le numéro de ligne est celui du tableur (en-tête = ligne 1). Les erreurs attendues :

| Ligne | Contenu | Message attendu |
| :-: | :--- | :--- |
| 2 | TG-ERR-01 SANGARE Mariam | valide |
| 3 | sexe vide | Le champ "Sexe" est obligatoire. |
| 4 | sexe `X` | "Sexe" : valeur non reconnue (attendu M ou F) |
| 5 | naissance 31/02/2014 | Date de naissance : "31/02/2014" n'est pas une date valide (attendu JJ/MM/AAAA ou AAAA-MM-JJ). |
| 6 | naissance 01/01/2099 | La date de naissance est dans le futur. |
| 7 | nom vide | Le champ "Nom" est obligatoire. |
| 8 | classe `6E-Z` | Classe "6E-Z" inconnue pour cette année scolaire. |
| 9 | financement `XYZ` | Type de financement "XYZ" inconnu. |
| 10 | e-mail `ange.tiemoko.exemple.test` | E-mail : "ange.tiemoko.exemple.test" n'est pas une adresse e-mail valide. |
| 11 | téléphone `12` | Téléphone : "12" n'est pas un numéro de téléphone valide. |
| 12 | nationalité `CIV` | "Nationalité (code pays)" : code pays à deux lettres attendu (ex. CI) |
| 13 | matricule TG-ERR-01 répété | Cette ligne répète la ligne 2 du fichier (même identifiant) : elle est ignorée. |
| 14 | DIABATE Nadia, 19/01/2014 | Doublon probable avec : DIABATE Nadia (00001). Vérifiez, ou choisissez "créer malgré le doublon". |
| 15 | TG-ERR-13 ZOKORA Léonie | valide |
| 16 | sans matricule d'origine, LOROUGNON | avertissement : "Aucun matricule d'origine : les doublons ne seront détectés que par le nom et la date de naissance." (ligne valide) |

2. Constater que le mode « Tout ou rien » est grisé : "Indisponible tant que le fichier contient des erreurs."
3. Cliquer **« Télécharger les erreurs (CSV) »** : fichier `01-students-erreurs-secondaire-erreurs.csv`, une ligne par problème (Ligne, Colonne du fichier, Champ, Gravité, Code, Message).
4. Mode « Importer les lignes valides seulement », cocher la confirmation, **« Lancer l'import »**.

⚠️ **Irréversible** : 3 élèves sont créés (TG-ERR-01 SANGARE Mariam, TG-ERR-13 ZOKORA Léonie, LOROUGNON Dominique, tous "test guide").

✅ Rapport « Import terminé avec des erreurs » : « Créées » **3**, « En erreur » **12**. La 6e A passe à **25 / 40**.

☐ OK ☐ KO

---

### Étape 49 — Rejouer le fichier valide (aucun doublon)
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 Onglet **« Nouvel import »** (`/v2/imports/new`)

1. Carte **"Élèves"**, envoyer de nouveau `01-students-valide-secondaire.csv`.

✅ Au titre "2. Associer les colonnes du fichier", l'avertissement : "Ce fichier (même contenu) a déjà été importé : les lignes déjà importées seront ignorées, sans doublon."

2. Choisir l'année courante, garder « Ignorer les lignes déjà présentes », **« Enregistrer et valider le fichier »**.

✅ « À ignorer » **10**, « À créer » 0 ; chaque ligne porte "Déjà importée lors d'un import précédent : ligne ignorée (aucun doublon)." ; le message "Aucune ligne à écrire : toutes les lignes sont invalides ou déjà importées." s'affiche et **« Lancer l'import » reste inactif**. Quitter par « Retour à l'historique » (cet import reste « Prêt à importer » et compte dans le quota des imports actifs, sans conséquence ici).

☐ OK ☐ KO

---

### Étape 50 — Importer 6 élèves sans classe
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 Onglet **« Nouvel import »** (`/v2/imports/new`)

Fichier : `docs/guide-test/jeux-de-donnees/01-students-sans-classe-secondaire.csv` (6 élèves `TG-INS-01` à `TG-INS-06`, sans colonne Classe).

1. Carte **"Élèves"**, envoyer le fichier, valider les colonnes (aucune option d'année nécessaire), **« Enregistrer et valider le fichier »**.

✅ « À créer » **6**.

2. Cocher la confirmation, **« Lancer l'import »**.

⚠️ **Irréversible**.

✅ « Créées » **6**. Dans `/v2/students`, chercher `test guide` : ABLE Rachel, BAH Moussa, CAMARA Hawa, DJÉ Armand, EHUI Sylvie, FOFANA Karim existent avec la mention « Non inscrit ». La 6e A reste à 25 / 40.

☐ OK ☐ KO

---

### Étape 51 — Inscrire ces 6 élèves par fichier
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 Onglet **« Nouvel import »** (`/v2/imports/new`)

Fichier : `docs/guide-test/jeux-de-donnees/06-enrollments-valide-secondaire.csv` (6 lignes vers `6E-A`).

1. Carte **"Inscriptions"** ; option "Année scolaire des inscriptions" = année courante ; envoyer le fichier ; **« Enregistrer et valider le fichier »**.

✅ « À créer » **6**. La ligne 5 saisit la classe en minuscules (`6e-a`) avec la date `15/09/2026` : elle est acceptée.

2. Cocher la confirmation, **« Lancer l'import »**.

⚠️ **Irréversible**.

✅ « Créées » **6** ; les 6 élèves ont une inscription « En attente » en 6e A. La 6e A passe à **31 / 40**.

⚠️ *Test d'erreur* : rejouer ce même fichier, l'aperçu doit annoncer « À ignorer » 6 (l'élève est déjà inscrit dans la classe) et rien à écrire.

☐ OK ☐ KO

---

### Étape 52 — Importer un classeur Excel (.xlsx)
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 Onglet **« Nouvel import »** (`/v2/imports/new`)

Fichier : `docs/guide-test/jeux-de-donnees/01-students-formats-secondaire.xlsx` (feuille "Eleves", 5 lignes : 4 valides, 1 avec la date 31/02/2014). **N'importer qu'un seul des quatre formats** (`.csv`, `.xlsx`, `.xls`, `.ods`) : la capacité de la 6e A est comptée avec un seul.

1. Carte **"Élèves"**, « Fichier à importer » = le `.xlsx`, « Feuille (facultatif) » vide, **« Envoyer et continuer »**, année courante, **« Enregistrer et valider le fichier »**.

✅ « À créer » **4**, « En erreur » **1** : ligne 6, Date de naissance : "31/02/2014" n'est pas une date valide (attendu JJ/MM/AAAA ou AAAA-MM-JJ).

2. Mode « Importer les lignes valides seulement », confirmation, **« Lancer l'import »**.

⚠️ **Irréversible**.

✅ « Import terminé avec des erreurs » : « Créées » **4**, « En erreur » 1 (ABONOUAN Judicaël, BINI Francine, COULIBALY Mamadou, DADIÉ Annick, tous "test guide").

⚠️ *Test d'erreur* : fichier `docs/guide-test/jeux-de-donnees/imports-cas-limites/faux-classeur-texte.xlsx` → le bandeau sous « Envoyer et continuer » dit `Le fichier se nomme ".xlsx" mais son contenu est du texte, pas un classeur Excel.` et aucun import n'est créé.

☐ OK ☐ KO

---

### Étape 53 — Contrôler l'effectif final de la 6e A
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 Menu **« Académique »** > **"Classes"** (`/v2/academic/classrooms`)

1. Filtrer l'« Année » sur 2026-2027 et ouvrir la fiche de la 6e A (`6E-A`).
2. Lire « Effectif » et la section « Élèves ».

✅ « Effectif » **35 sur 40** (12 de la graine + 10 + 3 + 6 + 4), « Capacité » « Bloquante » *(à vérifier)*. Les nouveaux inscrits sont « En attente » (confirmés au paiement des frais d'inscription, phase *Finance*). Liste de la 6e A : colonne « Effectif » `35 / 40`.

📚 *Pour aller plus loin* : chapitre 04, scénarios 4.7 (tuteurs d'un élève), 4.9 (antécédents), 4.11 et 4.18 (invitations), 4.16 (qualifications, compétences, disponibilités), 4.17 (statut du personnel), 4.22 à 4.29 (dérogation, suspension, transfert, classe pleine, financement, annulation, retrait, droits et isolation) ; chapitre 05, scénarios 5.4 à 5.11 (modèles, réglages, plafonds, quota), 5.14 à 5.15 (rejeu, mise à jour), 5.16 à 5.32 (primaire et supérieur, tuteurs, personnel, classes, curriculum, notes, soldes d'ouverture, autres formats, annulation d'un import).

☐ OK ☐ KO

---

**Ce que la phase laisse dans l'application :**
- Tuteur `KOUASSI Marcel test guide` (`marcel.kouassi.tg@exemple.test`), père, contact principal et responsable financier d'Aïcha, 1 enfant lié.
- Élève `KOUASSI Aïcha test guide` (née le 12/05/2014, matricule N relevé), inscrite en `6e B test guide` (`TG-6EB`) : inscription **En attente** (numéro d'inscription relevé), à confirmer par le paiement des frais d'inscription dans la phase *Finance*. Pièce "Acte de naissance test guide" déposée puis retirée ; aucun contact d'urgence (celui de DIABATE Nadia a été retiré).
- Personnel `OUATTARA Zénon test guide` (matricule `P00NN` relevé), enseignant, responsable de Mathématiques de `6e B test guide` (4 h), contrat à durée déterminée terminé, sans compte de connexion.
- 6e A : **35 / 40** élèves, dont 23 élèves "test guide" importés : `TG-ELV-S01` à `S10` (dont l'autre KOUASSI Aïcha test guide, 12/03/2014), `TG-ERR-01`, `TG-ERR-13`, LOROUGNON Dominique, `TG-INS-01` à `06` (inscriptions en attente), `TG-FC-01` à `04`. Les `TG-ELV-S01` à `S09` serviront aux soldes d'ouverture et aux tuteurs importés (chapitre 05).
- Historique des imports : 1 import de démonstration inchangé (« Prêt à importer »), 1 rejeu du fichier valide laissé « Prêt à importer », 5 imports exécutés ou terminés avec des erreurs.

---

## Phase 4 — Admissions : de la candidature à l'élève inscrit

Cette phase fait vivre une candidature de bout en bout au Collège Le Baobab : campagne `TG-2027` ouverte par le directeur, candidature d'**Awa COULIBALY test guide** instruite par le chargé d'admissions, décision d'admission prise par le directeur seul, réponse publique de la famille, puis paiement des frais d'inscription par l'économe, qui fait passer le dossier à « Inscrit ».

Précondition : base de démonstration fraîche (graine `pnpm dev:v2:seed`) ; la campagne `RENTREE-6E` et ses neuf dossiers existent déjà. Aucun message réel n'est envoyé (les notifications sont seulement mises en file).

---

### Étape 54 — Lire le pipeline de départ
👤 **chargé d'admissions** (`admissions@secondaire-test.test`, sans MFA) · fenêtre **A** · 📂 Menu **« Admissions »** (`/v2/admissions`)

1. Se connecter (clic sur le compte dans le panneau de `/v2/login`, puis **« Se connecter »**), ouvrir le menu **« Admissions »**.
2. Lire le titre **« Pipeline des candidatures »**, la barre d'onglets (**« Pipeline »**, **« Candidatures »**, **« Listes d'attente »**, **« Prospects »**, **« Campagnes »**, **« Rapports »**) et le bouton **« Nouvelle candidature »**.
3. Dans la liste **« Campagne d'admission »**, la campagne `RENTREE-6E` est présélectionnée.

✅ 12 colonnes (une par étape du workflow) : "Brouillon", "Candidature reçue", "En étude", "Pièces manquantes", "Liste d'attente", "Admis", "Inscription en attente de paiement", "Inscrit", "Refusé", "Retiré par la famille", "Offre expirée", "Dossier en double". Les 9 dossiers de la graine sont répartis un par colonne (Aïcha ADOU "Inscrit", Brice ASSI "Inscription en attente de paiement", Chantal DAGO "Admis", Désiré EKRA "En étude"…). Les onglets « Paramètres » et « Workflow » sont absents pour ce rôle.

☐ OK ☐ KO

---

### Étape 55 — Créer la campagne TG-2027
👤 **directeur** (`directeur@secondaire-test.test`, **MFA**) · fenêtre **A** · 📂 Menu **« Campagnes d'admission »** (`/v2/admissions/campaigns`)

Attendu au départ : une seule campagne, `RENTREE-6E` (pastille « Ouverte », niveau 6E, 13 places).

1. Se déconnecter du chargé, se connecter en directeur (le code MFA du moment est proposé sur la page de connexion).
2. Cliquer **« Nouvelle campagne »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Année scolaire | `2026-2027` (l'année en cours) |
| Workflow publié | "Parcours d'admission standard (v1)" (la seule proposition) |
| Code | `TG-2027` |
| Libellé | `Campagne test guide 2027` |
| Ouverture | `2026-10-08T08:00` |
| Clôture | `2027-03-31T17:00` |

3. Cliquer **« Créer »**.

✅ La campagne apparaît en « Brouillon » avec le texte « Aucune capacité définie. ».

⚠️ *Test d'erreur* : refaire avec Code `TG-2027` → `Ce code de campagne existe déjà dans l'établissement.` ; avec une Clôture au `2026-10-01T08:00` → « La clôture doit suivre l'ouverture. »

☐ OK ☐ KO

---

### Étape 56 — Fixer la capacité (2 places en 6e) et ouvrir la campagne
👤 **directeur** · fenêtre **A** · 📂 `/v2/admissions/campaigns`

1. Sur la ligne `TG-2027`, cliquer **« Capacités »**.
2. Dans **« Ajouter un niveau »** choisir "6e" puis **« Ajouter »** ; saisir :

| Champ | Valeur |
| :--- | :--- |
| Places | `2` |
| Limite de la liste | `5` |

3. Cliquer **« Enregistrer »**, puis **« Ouvrir »** sur la campagne.

✅ Tableau de capacité : 6E, 2 places, 2 libres, liste d'attente 0 / 5. La pastille de la campagne passe à « Ouverte ».

⚠️ *Test d'erreur* : « Places » = `abc` → « Valeurs invalides pour le niveau 6E. »

⚠️ *Écart connu* : une campagne ouverte plus récente peut devenir la campagne présélectionnée dans les écrans. **Choisir toujours `TG-2027` dans « Campagne d'admission »** pour la suite de la phase.

☐ OK ☐ KO

---

### Étape 57 — Publier le texte de consentement et créer le lien public
👤 **directeur** · fenêtre **A** · 📂 Menu **"Paramètres des admissions"** (`/v2/admissions/settings`)

Attendu au départ : l'alerte « Aucun texte de traitement des données n'est désigné : le formulaire public est fermé. » (le texte `v1` de la graine existe mais n'est pas désigné).

1. Section **« Textes de consentement parental »**, sous **« Publier un nouveau texte »**, saisir :

| Champ | Valeur |
| :--- | :--- |
| Nature | « Traitement des données » |
| Version | `tg1` |
| Texte | `Je consens au traitement des données de ma candidature pour la seule gestion des admissions (texte de test guide).` |
| Désigner comme texte en vigueur | cochée |

2. Cliquer **« Publier »**.
3. Section **« Formulaire public »**, cliquer **« Créer le lien public »**. Noter le `<lien>` des deux champs en lecture seule (**« Lien du formulaire »** : `http://localhost:3000/v2/apply/<lien>`, **« Lien de suivi des familles »** : `.../track`).

✅ « Texte publié. » ; pastille « Texte en vigueur » sur la version `tg1` (affichée `vtg1`, préfixe doublé : défaut mineur) ; l'alerte disparaît. Puis « Lien public créé. » et pastille « Lien actif ».

⚠️ *Test d'erreur* : « Texte » de 10 caractères → "Le texte doit comporter au moins 20 caractères."

⚠️ *Écart connu (Majeur, à confirmer)* : en fenêtre privée sans compte, ouvrir `http://localhost:3000/v2/apply/<lien>` : attendu **"Ce formulaire n'est pas disponible."**, malgré le lien actif et le texte désigné. Aucun écran ne pose le réglage d'ouverture du formulaire public : le dépôt par la famille et le suivi par code ne sont donc pas testables ici. Consigner ce que l'on voit, puis continuer : la candidature d'Awa sera saisie par le personnel, et la réponse à l'offre (plus loin) fonctionne, elle, avec ce lien.

☐ OK ☐ KO

---

### Étape 58 — Exiger une pièce : "Acte de naissance test guide"
👤 **directeur** · fenêtre **A** · 📂 `/v2/admissions/settings`, section **« Pièces à fournir »**

1. Cliquer **« Ajouter une pièce »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Code | `TG_ACTE_NAISSANCE` |
| Libellé | `Acte de naissance test guide` |
| Niveau concerné | "6e" |
| Prise en charge concernée | « Toutes » |
| Pièce obligatoire | cochée |

2. Cliquer **« Ajouter »**.

✅ « Pièce enregistrée. » ; la ligne porte la pastille « Obligatoire ». Tant que cette pièce n'est pas acceptée, aucun dossier 6e ne peut passer à "Admis" (la pièce est désactivée à la dernière étape de la phase).

⚠️ *Test d'erreur* : Libellé vide → "Libellé obligatoire." ; Code `TG-ACTE` (tiret) → message commençant par "Code en majuscules, chiffres et".

☐ OK ☐ KO

---

### Étape 59 — Enregistrer un prospect et le marquer contacté
👤 **chargé d'admissions** · fenêtre **A** · 📂 Onglet **« Prospects »** (`/v2/admissions/prospects`)

1. Se déconnecter du directeur, se connecter en chargé. Ouvrir **« Prospects »** : « Aucun prospect. »
2. Cliquer **« Nouveau prospect »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Prénoms | `Mariam` |
| Nom | `COULIBALY test guide` |
| Téléphone | `+225 07 48 12 34 56` |
| Adresse e-mail | `mariam.coulibaly.tg@exemple.test` |
| Niveau visé | "6e" |
| Origine | « Recommandation » |
| Notes | `Recommandée par une famille du quartier (test guide)` |

3. Cliquer **« Enregistrer »**, puis **« Marquer contacté »** sur la ligne.

✅ La ligne apparaît avec la pastille « Nouveau », qui devient « Contacté » (le bouton « Marquer contacté » disparaît).

⚠️ *Test d'erreur* : ni téléphone ni e-mail → "Un moyen de contact (téléphone ou e-mail) est obligatoire." ; e-mail `mariam.coulibaly` → "Adresse e-mail invalide."

🔒 *Test de droit* : en tant que chargé, taper `/v2/admissions/settings` puis `/v2/admissions/settings/workflow` → page « Accès refusé » (redirection vers `/unauthorized`). `/v2/admissions/campaigns` reste lisible mais sans boutons « Nouvelle campagne », « Ouvrir », « Capacités ».

☐ OK ☐ KO

---

### Étape 60 — Convertir le prospect en candidature : Awa COULIBALY test guide
👤 **chargé d'admissions** · fenêtre **A** · 📂 `/v2/admissions/prospects`

1. Sur la ligne de Mariam, cliquer **« Convertir »**.
2. Dans la fenêtre « Convertir Mariam COULIBALY test guide en candidature », saisir :

| Champ | Valeur |
| :--- | :--- |
| Campagne d'admission | "Campagne test guide 2027 (TG-2027)" |
| Prénoms de l'enfant | `Awa` |
| Date de naissance de l'enfant | `2014-06-12` |
| Niveau visé | "6e" |
| Lien de parenté du prospect | "Mère" |

3. Cliquer **« Convertir »**.

✅ Le dossier s'ouvre : **Awa COULIBALY test guide**, étape "Brouillon", tuteur Mariam COULIBALY test guide, numéro de la forme `AAAA-NNNNN`. Retour sur « Prospects » : la ligne est « Converti » avec le lien « Ouvrir le dossier » et plus de bouton « Convertir ».

⚠️ *Test d'erreur* : date de naissance vide → « Date attendue au format AAAA-MM-JJ. »

☐ OK ☐ KO

---

### Étape 61 — Compléter le dossier d'Awa (sexe, lieu de naissance)
👤 **chargé d'admissions** · fenêtre **A** · 📂 Dossier d'Awa COULIBALY test guide (`/v2/admissions/applications`)

Le sexe est exigé plus tard pour créer l'élève : le renseigner maintenant.

1. Sur le dossier d'Awa, cliquer **« Modifier la candidature »**.
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Sexe | « Féminin » |
| Lieu de naissance | `Abobo` |

3. Cliquer **« Enregistrer »**.

✅ « Candidature mise à jour. » ; sexe et lieu apparaissent dans la section « Informations ». Rouvrir la fenêtre puis **« Enregistrer »** sans rien changer → « Aucune modification à enregistrer. »

⚠️ *Test d'erreur* : vider « Prénoms » → "Libellé obligatoire."

☐ OK ☐ KO

---

### Étape 62 — Consigner le consentement parental et passer à « Candidature reçue »
👤 **chargé d'admissions** · fenêtre **A** · 📂 Dossier d'Awa, sections **« Étape et décisions »** et **« Tuteurs et consentement »**

1. Dans « Étape et décisions », cliquer le bouton nommé d'après l'étape visée : **"Candidature reçue"**.
2. Constater le refus (bandeau d'erreur technique `le consentement parental est requis avant l'étape SUBMITTED`) : le dossier reste en "Brouillon".
3. Dans « Tuteurs et consentement », cliquer **« Consigner un consentement »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Tuteur | `Mariam COULIBALY test guide` |
| Version du texte accepté | `tg1` (présélectionnée) |
| Mode de recueil | « Document papier » |
| Référence de la pièce justificative | `REG-TG-2026-001` |

4. Cliquer **« Enregistrer le consentement »**, puis de nouveau **"Candidature reçue"**.

✅ La section affiche « Consentement valide » et une ligne "Traitement des données · vtg1 · Document papier · `<date>`". Message `Dossier passé à l'étape "Candidature reçue".` ; statut « Déposée ». L'historique ajoute "Brouillon → Candidature reçue".

⚠️ *Test d'erreur* : « Référence de la pièce justificative » = `ab` → « Au moins 3 caractères. »

⚠️ *Écart connu* : l'alerte rouge du point 2 peut rester affichée après le succès du point 4 (Mineur) ; recharger la page.

☐ OK ☐ KO

---

### Étape 63 — Déposer, rejeter, remplacer puis accepter la pièce
👤 **chargé d'admissions** · fenêtre **A** · 📂 Dossier d'Awa, section **« Pièces du dossier »** · Fichiers : `docs/guide-test/jeux-de-donnees/17-piece-*`

Attendu au départ : "Acte de naissance test guide (obligatoire)" avec la pastille « Manquante ».

1. Cliquer **« Déposer »** et choisir `17-piece-acte-naissance-test-guide.pdf` : pastille « À contrôler ». **« Consulter »** ouvre le fichier dans un nouvel onglet.
2. Cliquer **« Rejeter »** : dans « Rejeter la pièce : Acte de naissance test guide », « Motif du rejet » = `Copie illisible (test guide)`, bouton **« Rejeter »** → pastille « Rejetée » et texte `Rejetée : Copie illisible (test guide)`.
3. Cliquer **« Remplacer »** et choisir `17-piece-bulletin-precedent-test-guide.pdf` : pastille « À contrôler », compteur "2 dépôts".
4. Cliquer **« Accepter »**.

✅ Pastille « Acceptée » ; le bandeau `Pièces manquantes : …` du haut du dossier disparaît.

⚠️ *Test d'erreur* (sur un dépôt neuf) : `17-piece-vide-test-guide.pdf` → `Le fichier est vide.` ; `17-piece-faux-pdf-test-guide.pdf` (texte renommé en .pdf) → refus du type de fichier (le type est lu dans les octets, pas dans l'extension). Si l'API répond "service indisponible", le stockage de fichiers n'est pas configuré : le consigner. La décision d'admission exige la pièce acceptée ; pour poursuivre malgré tout, le directeur peut désactiver la pièce (voir la dernière étape de la phase) avant de décider.

☐ OK ☐ KO

---

### Étape 64 — Planifier et renseigner l'entretien
👤 **chargé d'admissions** · fenêtre **A** · 📂 Dossier d'Awa, section **« Tests et entretiens »** (visible si la fonction "tests et entretiens" est incluse)

1. Cliquer **« Planifier »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Nature | « Entretien » |
| Date et heure | `2026-10-15T10:00` |
| Lieu | `Bureau du directeur (test guide)` |

2. Cliquer **« Planifier »** (dans la fenêtre) ; l'entretien est « Planifié ».
3. Cliquer **« Renseigner »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Déroulement | « Réalisé » |
| Note | `14` |
| Barème | `20` |
| Résultat | « Admis » |
| Observations | `Candidat attentif (test guide)` |

4. Cliquer **« Enregistrer »**.

✅ La ligne affiche « Note : 14 / 20 » et le résultat « Admis » (c'est le résultat de l'entretien, pas la décision d'admission). Aucune convocation n'est envoyée.

⚠️ *Test d'erreur* : « Déroulement » = « Réalisé » sans « Résultat » → `Un entretien terminé porte son résultat (réussi, échoué, sans objet).` ; « Note » `25` pour « Barème » `20` → `La note exige une échelle et ne la dépasse pas.`

☐ OK ☐ KO

---

### Étape 65 — Passer le dossier « En étude »
👤 **chargé d'admissions** · fenêtre **A** · 📂 Dossier d'Awa, section **« Étape et décisions »**

1. Cliquer **"En étude"**.

✅ Message `Dossier passé à l'étape "En étude".` ; la pastille de statut passe à « À l'étude » ; l'historique garde la trace. Dans le pipeline (`/v2/admissions`, campagne `TG-2027`), la carte d'Awa est dans la colonne "En étude".

☐ OK ☐ KO

---

### Étape 66 — 🔒 Le chargé d'admissions ne peut pas décider
👤 **chargé d'admissions** · fenêtre **A** · 📂 Dossier d'Awa, section **« Étape et décisions »**

1. Lire les boutons proposés.
2. Dans la section « Données personnelles », chercher « Exporter le dossier » et « Anonymiser ».

✅ Seule une action de traitement est proposée ("Pièces manquantes"). **Aucun** bouton "Admis", "Liste d'attente", "Refusé", "Retiré par la famille" ni "Dossier en double" ; ni « Exporter le dossier » ni « Anonymiser ». Le secrétariat a la même limite : la décision appartient au directeur.

🔒 *Test de droit* : taper dans la barre d'adresse `/v2/admissions/settings` → « Accès refusé » (déjà vu : confirme que les réglages sont réservés au directeur).

☐ OK ☐ KO

---

### Étape 67 — Décider l'admission d'Awa
👤 **directeur** · fenêtre **A** · 📂 Dossier d'Awa, section **« Étape et décisions »**

1. Se déconnecter du chargé, se connecter en directeur, ouvrir le dossier d'Awa (« Candidatures » > clic sur son nom). Les boutons visibles portent le nom de l'étape visée : "Admis", "Liste d'attente", "Refusé", "Retiré par la famille", "Dossier en double", "Pièces manquantes".
2. Cliquer **"Admis"** : fenêtre « Acceptation » (« Étape visée : Admis. La décision est journalisée avec son motif et ne peut plus être modifiée. »).
3. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Motif | "Candidature retenue" |
| Conditions de l'acceptation | `Remise de l'acte de naissance original (test guide)` |

4. Cliquer **« Enregistrer : Acceptation »**.

✅ Message `Décision "Acceptation" enregistrée : dossier à l'étape "Admis".` ; statut « Acceptée » ; places restantes de la campagne : 1. Dans « Historique » > « Décisions formelles » : le motif et « Par `<nom du directeur>` ».

⚠️ *Test d'erreur* (variante, sur un dossier sans pièce acceptée) : l'admission est refusée par `pièces non acceptées : …` ; capacité atteinte en politique stricte : `2 places occupées pour 2 (niveau 6E)`.

⚠️ *Irréversible* : une décision formelle ne se modifie plus.

☐ OK ☐ KO

---

### Étape 68 — Émettre l'offre de place
👤 **chargé d'admissions** · fenêtre **A** · 📂 Dossier d'Awa, section **« Offres de place »**

Attendu au départ : « Aucune offre émise. » et le bouton **« Émettre une offre »**.

1. Se déconnecter du directeur, se connecter en chargé, rouvrir le dossier d'Awa. Cliquer **« Émettre une offre »**.
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Classe | `6e A` |
| Conditions | `Remise de l'acte de naissance original (test guide)` |
| Validité en jours | (laisser vide : 14 jours) |

3. Cliquer **« Émettre une offre »**.
4. Dans la fenêtre « Offre émise », cliquer **« Copier »** sur **« Lien de réponse de la famille »** (`http://localhost:3000/v2/apply/<lien>/offer#t=<jeton>`) et **le conserver (LIEN-AWA)** ; cliquer **« Fermer »**.

✅ Le lien "n'est affiché qu'une seule fois" (seule son empreinte est conservée). La section montre l'offre « En attente de réponse », « Échéance : `<date à 14 jours>` » et les boutons « Désigner la classe », « Accepter au nom de la famille », « Retirer l'offre » (ne pas les utiliser). Le dossier reste à l'étape "Admis".

⚠️ *Test d'erreur* : « Validité en jours » = `0` → "La valeur doit être supérieure ou égale à 1." (message de borne) ; le bouton « Émettre une offre » disparaît une fois l'offre en attente.

☐ OK ☐ KO

---

### Étape 69 — La famille répond à l'offre (page publique)
👤 **famille d'Awa, sans compte** · fenêtre **B** (navigation privée) · 📂 LIEN-AWA (`/v2/apply/<lien>/offer#t=<jeton>`)

1. Coller LIEN-AWA dans la barre d'adresse de la fenêtre privée.
2. Lire le titre « Proposition de place à Collège Le Baobab (démonstration) », « Vous pouvez accepter ou décliner cette proposition. », « Niveau », « Classe », « À accepter avant le » et « Conditions ».
3. Cliquer **« Décliner la place »**, puis **« Retour »** dans la confirmation (sans confirmer).
4. Cliquer **« Accepter la place »** ; lire « Confirmez-vous l'acceptation de cette place ? L'établissement vous indiquera les frais d'inscription à régler. » ; cliquer **« Accepter la place »** pour confirmer.

✅ Page « Place acceptée » avec `Merci : votre acceptation est enregistrée. L'établissement vous indiquera les frais d'inscription à régler pour confirmer l'inscription.`

⚠️ *Test d'erreur* : rouvrir LIEN-AWA → « Cette proposition a déjà été acceptée. » (aucun second élève ni seconde facture). Lien tronqué (supprimer `#t=…`) → « Ce lien est incomplet. Utilisez le lien exact reçu de l'établissement. » ; jeton modifié → « Ce lien n'est pas ou plus valide. »

⚠️ *Écart connu* (Mineur à Majeur, à vérifier) : si l'acceptation échoue pour une raison de dossier (classe non désignée, sexe absent, pièces non acceptées), la page affiche quand même "Ce lien n'est pas ou plus valide." Dans ce cas, vérifier dans le dossier que le sexe, la classe et la pièce acceptée sont bien renseignés.

☐ OK ☐ KO

---

### Étape 70 — Constater l'élève créé et la facture d'inscription
👤 **chargé d'admissions** · fenêtre **A** · 📂 Dossier d'Awa

1. Recharger le dossier d'Awa.
2. Lire la section « Offres de place » et la section « Inscription ».

✅ Offre « Acceptée » ; étape "Inscription en attente de paiement" ; « Inscription en attente : elle sera confirmée au règlement des frais d'inscription. » Un élève nommé en capitales (`COULIBALY TEST GUIDE Awa`, affichage exact à relever) est créé, inactif, avec une inscription « En attente » et une facture des frais d'inscription de **25 000 F CFA**. Les liens « Dossier de l'élève » et « Fiche d'inscription » apparaissent comme liens seulement si le rôle a le droit de les ouvrir.

☐ OK ☐ KO

---

### Étape 71 — Payer les frais d'inscription (25 000 F CFA)
👤 **économe** (`econome@secondaire-test.test`, **MFA**) · fenêtre **A** · 📂 Menu **"Encaissements"** > **« Encaisser un paiement »** (`/v2/finance/payments/new`)

1. Se déconnecter du chargé, se connecter en économe.
2. Dans le bloc « Apprenant », chercher et choisir l'élève d'Awa (taper `COULIBALY`) : la zone « Factures ouvertes » liste la facture d'inscription, « Reste dû 25 000 F CFA ».
3. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Montant encaissé | `25000` |
| Mode de paiement | « Virement » |
| Référence | `VIR-TG-AWA-001` |
| Nom du payeur | `COULIBALY Mariam test guide` |
| Qui paie ? | « Famille » |

4. Laisser l'imputation « Automatique », cliquer **« Vérifier et encaisser »**, puis **« Confirmer l'encaissement »**.

✅ Écran « Paiement enregistré » : « Le paiement de 25 000 F CFA a été enregistré. », un reçu, « Imputé » 25 000 F CFA, « Reste dû après paiement » 0.

⚠️ *Test d'erreur* : virement sans « Référence » → `La référence du virement est requise.` (aucun paiement créé).

☐ OK ☐ KO

---

### Étape 72 — Constater « Inscrit »
👤 **chargé d'admissions** · fenêtre **A** · 📂 Dossier d'Awa (attendre quelques secondes, le traitement est en arrière-plan)

1. Se déconnecter de l'économe, se connecter en chargé, recharger le dossier d'Awa.
2. Chercher un bouton qui poserait « Inscrit » à la main.

✅ Étape "Inscrit", statut « Inscrit », « Inscription confirmée le `<date>`. ». Aucun bouton ne permet de poser « Inscrit » manuellement : l'inscription est confirmée par le paiement seul. Dans le pipeline, Awa est dans la colonne "Inscrit" ; dans « Candidatures », le filtre « Statut » = « Inscrit » la montre avec Aïcha ADOU.

⚠️ *Écart connu* : si le dossier reste "Inscription en attente de paiement" au bout d'une minute, le service de tâches de fond (worker) n'est probablement pas démarré : le consigner. Un règlement partiel (par exemple 10 000 F CFA) ne confirme pas l'inscription (*à vérifier*).

☐ OK ☐ KO

---

### Étape 73 — Désactiver la pièce exigée (nettoyage)
👤 **directeur** · fenêtre **A** · 📂 `/v2/admissions/settings`, section **« Pièces à fournir »**

1. Se déconnecter du chargé, se connecter en directeur.
2. Sur la ligne "Acte de naissance test guide", cliquer **« Désactiver »**.

✅ La pièce est inactive : les prochains dossiers 6e ne sont plus bloqués par elle. (Les éléments créés ne se suppriment pas, ils se désactivent.)

☐ OK ☐ KO

📚 *Pour aller plus loin* : chapitre 17, scénarios 17.1 à 17.4 (lecture et filtres), 17.7 (motifs, classes de priorité), 17.10 à 17.11 (autres candidatures, conflit de modification), 17.15 à 17.16 (liste d'attente, refus avec motif), 17.17 (offre retirée), 17.20 à 17.25 (liste d'attente, rapports, workflow, anonymisation, rattachement des pièces au dossier de l'élève, dépassement de capacité), 17.27 (droits), 17.28 et 17.29 (école et université).

**Ce que la phase laisse dans l'application :**
- Campagne `TG-2027` "Campagne test guide 2027", ouverte, 6e : 2 places (1 occupée par Awa), liste d'attente limitée à 5.
- Texte de consentement `tg1` désigné ; lien public actif (formulaire public fermé : écart connu).
- Pièce `TG_ACTE_NAISSANCE` "Acte de naissance test guide" (désactivée).
- Prospect "Mariam COULIBALY test guide" (converti).
- Dossier "Awa COULIBALY test guide" à l'étape "Inscrit" (consentement `REG-TG-2026-001`, pièce acceptée, entretien réalisé 14 / 20, décision d'acceptation, offre acceptée).
- Élève `COULIBALY TEST GUIDE Awa` (6e A) avec sa facture d'inscription de 25 000 F CFA soldée par le virement `VIR-TG-AWA-001`.

---

## Phase 5 — Finance : frais, facture, encaissements, reçus

Cette phase construit le catalogue de l'économe (frais, barème, plan en 3 tranches, remises), émet la **facture n°1 test guide** de 54 000 F CFA au nom de DIABATE Nadia (élève de la graine, 6e A), l'encaisse de cinq manières (virement partiel, espèces, mobile money, paiement en ligne simulé, chèque) et lit les reçus. Les remboursements, le portail famille, le rapprochement et la clôture de caisse sont repris dans une phase suivante, qui suppose l'état laissé ici.

Précondition : l'application tourne avec le fournisseur simulé (« Paiement simulé (démonstration) » apparaît dans l'écran de paiement en ligne) et le service de tâches de fond (worker). Règle du paiement simulé : montant finissant par `001` = en attente, `013` = échec, tout autre montant = réussite. Montants en F CFA entiers, sans virgule.

---

### Étape 74 — Relever la synthèse financière de départ
👤 **économe** (`econome@secondaire-test.test`, **MFA**) · fenêtre **A** · 📂 Menu **"Tableau de bord financier"** (`/v2/finance`)

1. Se connecter en économe (page d'accueil du rôle : `/v2/finance`).
2. Lire le titre « Finance » et le bloc « Synthèse » : huit cartes (« Facturé », « Avoirs », « Facturé net », « Encaissé », « Restant dû », « En retard », « Paiements non imputés », « Taux de recouvrement »).
3. **Noter** « Facturé », « Encaissé » et « Restant dû » : ils servent aux contrôles de fin de chapitre finance.
4. Lire « Accès rapides » (six raccourcis) et cliquer **« Factures en retard »**.

✅ Les huit cartes se remplissent sans erreur (les chiffres dépendent de la base : raisonner en écarts, l'inscription d'Awa a déjà été payée à la phase précédente). Le raccourci mène à `/v2/finance/invoices?status=OVERDUE`, le filtre « Statut » affiche « En retard » et la liste est vide : « Aucune facture ».

🔒 *Test de droit* : en tant que secrétariat (`secretariat@secondaire-test.test`, MFA), `/v2/finance` s'affiche sans cartes de synthèse ; en tant qu'enseignant, `/v2/finance` → « Accès refusé ».

☐ OK ☐ KO

---

### Étape 75 — Créer le frais TG-DIVERS
👤 **économe** · fenêtre **A** · 📂 Barre de sections **« Frais et barèmes »** (`/v2/finance/fees`)

Attendu au départ : "REGISTRATION" "Frais d'inscription" et "TUITION" « Scolarité », tous deux « Actif ».

1. Cliquer **« Nouveau frais »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Code | `TG-DIVERS` |
| Libellé | `Frais divers test guide` |
| Catégorie | « Autres » |
| Description | `Frais de démonstration du guide de test` |

2. Cliquer **« Créer »**.
3. Recommencer avec Code `TG-CANTINE`, Libellé `Frais de cantine test guide`, Catégorie « Cantine » (sans description). Ce second frais n'aura volontairement pas de barème.

✅ Message `Le frais "Frais divers test guide" a été créé.` ; la ligne "TG-DIVERS" apparaît avec « Autres » et « Actif », et reste après rechargement.

⚠️ *Test d'erreur* : Code vide → « Ce champ est obligatoire. » ; Code `TG DIVERS` (espace) → "Code de frais invalide (A-Z, 0-9, _ ou -, 40 caractères max)." ; Code `tg-divers` (déjà pris) → `Le code de frais "TG-DIVERS" existe déjà.`

🔒 *Test de droit* : en tant que secrétariat, taper `/v2/finance/fees` → « Accès refusé ».

☐ OK ☐ KO

---

### Étape 76 — Fixer le barème de TG-DIVERS (60 000 F CFA)
👤 **économe** · fenêtre **A** · 📂 **« Frais et barèmes »** > **« Barèmes »** (`/v2/finance/fees/schedules`)

1. Cliquer **« Nouveau barème »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Frais | Frais divers test guide |
| Année scolaire | `2026-2027` |
| Montant | `60000` |
| En vigueur à partir du | `2026-09-01` |
| Jusqu'au (facultatif) | (vide) |
| Plan d'échéancier par défaut | « Aucun » |

2. Cliquer **« Créer le barème »**.
3. Dans la zone **« Quel montant s'applique ? »**, choisir Frais divers test guide et l'année `2026-2027`, cliquer **« Résoudre »**.

✅ « Le barème a été créé. » ; ligne "Frais divers test guide" · 2026-2027 · « Tous les apprenants » · 60 000 F CFA · « En vigueur ». Résolution : `Montant applicable : 60 000 F CFA (année 2026-2027).` Avec "Frais de cantine test guide" : alerte "Aucun barème ne s'applique à ce frais pour ce périmètre et cette date."

⚠️ *Test d'erreur* : Montant `60 000,5` → « Le montant est un entier en francs : pas de virgule ni de point. » ; Montant `-5` → « Le montant ne peut pas être négatif. »

⚠️ *Écart connu* : aucun bouton ne met un barème hors vigueur ; ne pas créer de second barème chevauchant (il serait refusé : "Un barème actif couvre déjà ce périmètre sur cette période.").

☐ OK ☐ KO

---

### Étape 77 — Créer le plan d'échéancier en 3 tranches
👤 **économe** · fenêtre **A** · 📂 **« Frais et barèmes »** > **« Plans d'échéancier »** (`/v2/finance/fees/plans`)

Attendu au départ : « Aucun plan d'échéancier ». Si « Nouveau plan » est absent (« Les échéanciers ne sont pas inclus dans l'offre de l'établissement. »), consigner l'écart et passer à la remise : la facture n°1 se fera alors sans plan.

1. Cliquer **« Nouveau plan »**, saisir Code `TG-3T` et Libellé `Plan 3 tranches test guide`.
2. Échéance 1 : Libellé `Tranche 1`, Type de part « Pondérée », Poids `1`, « Nombre de jours après la facture » `0`.
3. **« Ajouter une échéance »** deux fois : `Tranche 2` (« Pondérée », poids `1`, 30 jours) et `Tranche 3` (« Pondérée », poids `1`, 60 jours).
4. Cliquer **« Créer le plan »**.

✅ Message `Le plan "Plan 3 tranches test guide" a été créé.` ; carte `TG-3T` avec les lignes "Tranche 1 Poids 1 · échéance à +0 j", "Tranche 2 … +30 j", "Tranche 3 … +60 j".

⚠️ *Test d'erreur* : Code `tg-3t` une seconde fois → `Le code de plan "TG-3T" existe déjà.` ; Poids `0` → "La valeur doit être supérieure ou égale à 1."

☐ OK ☐ KO

---

### Étape 78 — Créer deux remises non cumulables
👤 **économe** · fenêtre **A** · 📂 **« Frais et barèmes »** > **« Remises »** (`/v2/finance/fees/discounts`)

1. Cliquer **« Nouvelle remise »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Code | `TG-REM10` |
| Libellé | `Remise 10 % test guide` |
| Type | « Pourcentage » |
| Pourcentage | `10` |
| Cumulable avec d'autres remises | décochée |

2. Cliquer **« Créer »**. Seconde remise : Code `TG-REM5000`, Libellé `Remise 5 000 F test guide`, Type « Montant fixe », Montant `5000`, « Cumulable avec d'autres remises » décochée.

✅ Messages `La remise "Remise 10 % test guide" a été créée.` puis le même pour la seconde ; valeurs "10,00 %" et "5 000 F CFA", cumulable « Non », statut « Active ».

⚠️ *Test d'erreur* : Pourcentage `150` → « Le pourcentage doit être compris entre 0,01 et 100. » ; Code `TG-REM10` en double → `Le code de remise "TG-REM10" existe déjà.`

☐ OK ☐ KO

---

### Étape 79 — Émettre la facture n°1 test guide (DIABATE Nadia, 54 000 F CFA)
👤 **économe** · fenêtre **A** · 📂 Barre **« Factures »** > **« Nouvelle facture »** (`/v2/finance/invoices/new`)

1. Vérifier le mode « Depuis le catalogue ». Bloc « Apprenant » : Apprenant = "DIABATE Nadia", Inscription = la seule proposée (6e A), Année scolaire `2026-2027`.
2. Bloc « Frais à facturer » : Frais = Frais divers test guide, Quantité `1`.
3. Bloc « Remises et échéancier » : cocher **les deux** remises, Plan d'échéancier = "Plan 3 tranches test guide"; laisser les dates vides.
4. Constater que « Enregistrer en brouillon » et « Émettre la facture » sont désactivés (« Calculez l'aperçu pour pouvoir émettre ou enregistrer la facture. »).
5. Cliquer **« Calculer l'aperçu »**.
6. Décocher "Remise 5 000 F test guide" : le bandeau « Le formulaire a changé depuis l'aperçu : recalculez-le avant d'émettre. » apparaît ; cliquer de nouveau **« Calculer l'aperçu »**.
7. Cliquer **« Émettre la facture »**.

✅ Aperçu : « Sous-total » 60 000 F CFA, « Remises » **6 000 F CFA** (de deux remises non cumulables, seule la plus avantageuse s'applique), « Total » 54 000 F CFA ; trois échéances de 18 000 F CFA ("Tranche 1", "Tranche 2", "Tranche 3"). Après émission : écran « Facture enregistrée » (`1 facture a été enregistrée.`) et lien `FAC-2026-nnnnnn` : **noter ce numéro (facture n°1)**. Dans « Factures » : « Émise », total et reste dû 54 000 F CFA.

⚠️ *Test d'erreur* : Quantité `0` → "La valeur doit être supérieure ou égale à 1." ; Frais = Frais de cantine test guide puis « Calculer l'aperçu » → alerte "Aucun barème ne s'applique à ce frais pour ce périmètre et cette date." (aucune facture créée).

☐ OK ☐ KO

---

### Étape 80 — Lire la fiche de la facture n°1
👤 **économe** · fenêtre **A** · 📂 Barre **« Factures »** > ligne de la facture n°1 (`/v2/finance/invoices`)

1. Filtrer « Apprenant » = "DIABATE Nadia" : trois factures (inscription 25 000 « Payée », scolarité 200 000 « Payée », facture n°1) ; ouvrir la facture n°1.
2. Lire « Montants », « Lignes » et « Échéancier ».

✅ « Sous-total » 60 000, « Remises » 6 000, « Total » 54 000, « Payé » 0, « Reste dû » 54 000 F CFA ; une ligne "Frais divers test guide" (« Autres », 1, 60 000, remise 6 000, total 54 000) ; échéancier "Tranche 1", "Tranche 2", "Tranche 3" de 18 000 F CFA chacune, « À payer ». La section « Correction de la facture » propose « Émettre un avoir » et « Annuler la facture » (non utilisés dans cette phase).

☐ OK ☐ KO

---

### Étape 81 — Créer la caisse et ouvrir une session
👤 **économe** · fenêtre **A** · 📂 `/v2/finance/payments/new`, puis barre **« Caisse »** (`/v2/finance/cash`)

1. Ouvrir `/v2/finance/payments/new` : le mode « Espèces » affiche « Aucune session de caisse ouverte : un paiement en espèces doit être rattaché à votre session. » et « Vérifier et encaisser » est désactivé.
2. Cliquer **« Ouvrir une session de caisse »** (mène à `/v2/finance/cash`), puis **« Nouvelle caisse »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Code | `TG-CAISSE-1` |
| Libellé | `Caisse test guide` |

3. Cliquer **« Créer »**.
4. Sur la ligne "Caisse test guide", cliquer **« Ouvrir une session »**, saisir Fonds de caisse `10000`, cliquer **« Ouvrir la session »**.

✅ « La caisse a été créée. » puis « La session de caisse est ouverte. » ; « Ma session » : pastille « Ouverte », « Fonds de caisse » 10 000 F CFA, « Encaissé » 0, « Nombre d'encaissements » 0, boutons « Clôturer la session » (ne pas l'utiliser ici) et « Encaisser un paiement ».

⚠️ *Test d'erreur* : Fonds de caisse `-100` → « Le montant ne peut pas être négatif. » ; Code `TG CAISSE` → "Code de caisse invalide."

⚠️ *Écart connu* : avant la création, le texte « Un gestionnaire doit d'abord créer une caisse. » est trompeur : l'économe peut la créer.

☐ OK ☐ KO

---

### Étape 82 — Encaisser un virement partiel (10 000 F CFA)
👤 **économe** · fenêtre **A** · 📂 Barre **« Encaissements »** > **« Encaisser un paiement »** (`/v2/finance/payments/new`)

1. Bloc « Apprenant » : "DIABATE Nadia". La zone « Factures ouvertes » liste la facture n°1, reste dû 54 000 F CFA.
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Montant encaissé | `10000` |
| Mode de paiement | « Virement » |
| Référence | `VIR-TG-001` |
| Nom du payeur | `DIABATE Séka` |
| Qui paie ? | « Famille » |

3. Laisser l'imputation « Automatique ». Cliquer **« Vérifier et encaisser »**.
4. Dans « Confirmer l'encaissement », cliquer **deux fois rapidement** sur **« Confirmer l'encaissement »**.

✅ Écran « Paiement enregistré » : « Le paiement de 10 000 F CFA a été enregistré. », un reçu `REC-2026-nnnnnn` (**à noter**), « Imputé » 10 000, « Non imputé » 0, « Reste dû après paiement » **44 000 F CFA**. Un seul paiement existe (une clé d'idempotence évite le doublon) : vérifier dans « Encaissements ». Facture n°1 « Partiellement payée », tranche 1 reste 8 000.

⚠️ *Test d'erreur* : Montant `150,5` → « Le montant est un entier en francs : pas de virgule ni de point. » ; Montant `0` → « Montant invalide : chiffres uniquement, strictement positif. » ; virement sans « Référence » → `La référence du virement est requise.` (aucun paiement créé).

☐ OK ☐ KO

---

### Étape 83 — Encaisser en espèces (8 000 F CFA) sur la session de caisse
👤 **économe** · fenêtre **A** · 📂 `/v2/finance/payments/new`

1. Apprenant "DIABATE Nadia" ; Montant encaissé `8000` ; Mode de paiement « Espèces » ; Nom du payeur `DIABATE Séka` ; imputation « Automatique ».
2. **« Vérifier et encaisser »**, puis **« Confirmer l'encaissement »**.
3. Cliquer **« Fiche du paiement »**, puis **« Voir la session »**.

✅ « Reste dû après paiement » **36 000 F CFA**, tranche 1 « Payée ». La fiche affiche « Session de caisse » avec le lien « Voir la session » (fenêtre « Détail de la session »). Sur `/v2/finance/cash`, « Ma session » : « Encaissé » 8 000 F CFA, « Nombre d'encaissements » 1.

⚠️ *Test d'erreur* : sans session ouverte (cf. étape précédente) le bouton « Vérifier et encaisser » est désactivé.

☐ OK ☐ KO

---

### Étape 84 — Acompte par mobile money (6 000 F CFA), puis imputation du solde
👤 **économe** · fenêtre **A** · 📂 `/v2/finance/payments/new`, puis fiche du paiement

1. Apprenant "DIABATE Nadia" ; Montant encaissé `6000` ; Mode « Mobile money » ; Référence `MM-TG-001` ; Nom du payeur `DIABATE Séka` ; Imputation « Aucune (acompte) ». Confirmer.
2. Sur « Paiement enregistré » : « Imputé » 0, « Non imputé » 6 000 F CFA, « Reste dû après paiement » affiche « — ». Ouvrir **« Voir et imprimer le reçu »** : le reçu indique « Paiement non imputé ».
3. Ouvrir **« Fiche du paiement »**, cliquer **« Imputer le solde »**, laisser « Automatique », cliquer **« Imputer »**.
4. Rouvrir le reçu.

✅ Avant l'imputation, la facture n°1 reste à 36 000 F CFA. Après : « L'imputation a été enregistrée. » ; « Imputé » 6 000, « Non imputé » 0 ; facture n°1 reste dû **30 000 F CFA**, tranche 2 : payé 6 000, reste 12 000. Le reçu est **inchangé** (figé : toujours « Paiement non imputé »).

⚠️ *Test d'erreur* : dans « Imputer le solde », « Manuelle » sans montant → « Saisissez au moins un montant à imputer. »

☐ OK ☐ KO

---

### Étape 85 — Paiement en ligne simulé : réussite, attente, échec
👤 **économe** · fenêtre **A** · 📂 Barre **« Encaissements »** > **« Paiement en ligne »** (`/v2/finance/payments/online`, titre « Initier un paiement en ligne »)

1. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Apprenant | "DIABATE Nadia" |
| Montant | `5000` |
| Fournisseur | « Paiement simulé (démonstration) » |
| Facture visée | la facture n°1 (`FAC-2026-nnnnnn`) |
| Téléphone du payeur | `+225 07 10 20 30 40` |
| Nom du payeur | `DIABATE Séka` |
| Courriel du payeur | `parent@exemple.test` |
| Libellé | `Paiement en ligne test guide` |

2. Cliquer **« Lancer le paiement »** et observer « Suivi du paiement ».
3. Cliquer **« Nouveau paiement en ligne »**, même saisie avec Montant `5001` ; cliquer **« Vérifier maintenant »**.
4. **« Nouveau paiement en ligne »**, même saisie avec Montant `5013`.

✅ Selon les trois derniers chiffres :
- 5 000 : pastille « Confirmé » (« Paiement confirmé par le fournisseur. »), reçu émis ; facture n°1 reste dû **25 000 F CFA** (tranche 2 : reste 7 000).
- 5 001 : pastille « En attente » (« En attente de la confirmation du fournisseur. Cet écran vérifie régulièrement. »), aucun reçu, facture inchangée ; « Vérifier maintenant » ne change rien. **Ne pas ouvrir** le lien `sandbox.invalid`.
- 5 013 : pastille « Échoué » ("Paiement échoué : sandbox_declined", code technique brut), aucun reçu, facture inchangée.

Toujours : « Paiement simulé (environnement de test) : il ne peut pas être confirmé en production. »

⚠️ *Test d'erreur* : Fournisseur « Orange Money », montant 5000 → `Le fournisseur "orange_money" n'est pas configuré pour ce tenant.` (aucun paiement créé) ; Courriel du payeur `abc` → "Adresse électronique invalide."

⚠️ *Écart connu* : si « Paiement simulé (démonstration) » n'est pas proposé, le serveur web a été lancé sans `NEXT_PUBLIC_FINANCE_SANDBOX=1` : le redémarrer et consigner un écart Majeur.

☐ OK ☐ KO

---

### Étape 86 — Facture n°2 test guide : reprise de solde d'ouverture (25 000 F CFA)
👤 **économe** · fenêtre **A** · 📂 Barre **« Factures »** > **« Nouvelle facture »**, mode « Saisie libre » (`/v2/finance/invoices/new`)

1. Choisir le mode « Saisie libre ».
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Apprenant | "DIABATE Nadia" |
| Inscription | 6e A |
| Année scolaire | `2026-2027` |
| Catégorie (ligne) | « Autres » |
| Désignation (ligne) | `Reprise du solde d'ouverture test guide` |
| Quantité (ligne) | `1` |
| Prix unitaire (ligne) | `25000` |

3. Cliquer **« Enregistrer en brouillon »** : fiche « Facture (brouillon) », sans numéro.
4. Cliquer **« Émettre la facture »**.

✅ Message "La facture FAC-2026-nnnnnn a été émise." (**noter : facture n°2**) ; statut « Émise », total et reste dû 25 000 F CFA, une seule échéance.

⚠️ *Test d'erreur* : Prix unitaire vide → « Saisissez un montant. » ; Désignation vide → « Ce champ est obligatoire. »

☐ OK ☐ KO

---

### Étape 87 — Un virement imputé sur deux factures (20 000 F CFA)
👤 **économe** · fenêtre **A** · 📂 `/v2/finance/payments/new`

Attendu au départ : facture n°1 reste dû 25 000 (tranche 2 : 7 000 ; tranche 3 : 18 000) ; facture n°2 reste dû 25 000.

1. Apprenant "DIABATE Nadia" : « Factures ouvertes » liste les deux factures.
2. Saisir Montant encaissé `20000` ; Mode « Virement » ; Référence `VIR-TG-002` ; Nom du payeur `DIABATE Séka`.
3. Imputation « Manuelle » : déplier la facture n°1, saisir `7000` dans « Montant à imputer — Tranche 2 » ; déplier la facture n°2, saisir `13000` dans le champ de son unique échéance.
4. **« Vérifier et encaisser »**, puis **« Confirmer l'encaissement »**.

✅ « Imputé » 20 000 F CFA, « Non imputé » 0, "2 imputations enregistrée(s).", « Reste dû après paiement » **30 000 F CFA** (18 000 + 12 000). Facture n°1 reste dû **18 000** ; facture n°2 reste dû **12 000**, « Partiellement payée ».

⚠️ *Test d'erreur* : montant 20000 avec `20000` imputés sur « Montant à imputer — Tranche 3 » (reste 18 000) → "L'imputation dépasse le reste dû de l'échéance." (aucun paiement créé).

☐ OK ☐ KO

---

### Étape 88 — Paiement supérieur au solde (chèque 15 000 F CFA), puis imputation
👤 **économe** · fenêtre **A** · 📂 `/v2/finance/payments/new`, puis fiche du paiement

1. Apprenant "DIABATE Nadia" ; Montant encaissé `15000` ; Mode « Chèque » ; Référence `CHQ-TG-0001` ; Nom du payeur `DIABATE Séka`.
2. Imputation « Automatique » ; dans « Limiter à certaines factures », cocher uniquement la facture n°2 (reste dû 12 000). Confirmer (aucun avertissement de dépassement avant la confirmation : écart connu, voir le chapitre).
3. Sur la fiche du paiement, cliquer **« Imputer le solde »**, « Automatique », **« Imputer »**.

✅ Après l'étape 2 : « Imputé » 12 000, « Non imputé » **3 000 F CFA**, facture n°2 « Payée ». Après l'étape 3 : « L'imputation a été enregistrée. » ; les 3 000 F CFA vont sur la seule échéance ouverte (tranche 3 de la facture n°1) : facture n°1 reste dû **15 000 F CFA**, paiement entièrement imputé (le bouton « Imputer le solde » disparaît).

⚠️ *Test d'erreur* : chèque sans « Référence » → "Le numéro de chèque est requis."

☐ OK ☐ KO

---

### Étape 89 — Contrôler la liste des encaissements et les reçus
👤 **économe** · fenêtre **A** · 📂 Barre **« Encaissements »** (`/v2/finance/payments`), puis barre **« Reçus »** (`/v2/finance/receipts`)

1. Dans « Encaissements », filtrer « Apprenant » = "DIABATE Nadia" : **10 lignes** (2 de la graine : 25 000 et 200 000 ; puis cette phase : 10 000 `VIR-TG-001`, 8 000 espèces, 6 000 `MM-TG-001`, 5 000 / 5 001 / 5 013 « En ligne », 20 000 `VIR-TG-002`, 15 000 `CHQ-TG-0001`). « Statut » = « En attente » : une ligne (5 001) ; « Échoué » : 5 013 ; « Mode » = « Chèque » : 15 000.
2. Ouvrir la fiche du virement `VIR-TG-001` (clic sur sa date) : titre « Paiement de 10 000 F CFA », « Résumé » (« Confirmé », « Imputé » 10 000, « Non imputé » 0, « Référence » `VIR-TG-001`).
3. Ouvrir la barre « Reçus », filtrer « Apprenant » = "DIABATE Nadia", ouvrir le reçu du virement `VIR-TG-001`.
4. Cliquer **« Imprimer ou enregistrer en PDF »** (boîte d'impression du navigateur, la fermer). Ouvrir ensuite le reçu de `VIR-TG-002`.

✅ **8 reçus** (2 de la graine + 6 de cette phase : 10 000, 8 000, 6 000, 5 000, 20 000, 15 000) ; les paiements 5 001 (en attente) et 5 013 (échoué) n'ont pas de reçu. Reçu `VIR-TG-001` : « Reçu de paiement », imputation FAC-… · Tranche 1 · 10 000, « Reste dû après ce paiement » 44 000 F CFA, « Montant reçu » 10 000 F CFA, pied de page « Reçu émis automatiquement ; il ne peut pas être modifié. » ; reçu `VIR-TG-002` : deux lignes d'imputation et reste dû 30 000 F CFA. Aucun bouton « Modifier » ni « Supprimer » : une erreur se corrige par un avoir ou un remboursement, jamais en changeant le reçu.

⚠️ *Test d'erreur* : `/v2/finance/receipts/00000000-0000-4000-8000-000000000000` → "Reçu introuvable (00000000-0000-4000-8000-000000000000)."

🔒 *Test de droit* : en tant que parent (`parent@secondaire-test.test`), taper `/v2/finance/receipts` puis `/v2/finance/payments` → « Accès refusé » (le parent passe par `/v2/finance/me`). En tant que secrétariat, `/v2/finance/payments/new` et `/v2/finance/cash` → « Accès refusé ».

☐ OK ☐ KO

📚 *Pour aller plus loin* : chapitres 12a (scénarios 12.6, 12.8 à 12.9 : filtres de factures, refus API, brouillon) et 12b (scénario 12.15 : jeux invalides d'encaissement ; 12.20 : export CSV et fiches).

**Ce que la phase laisse dans l'application :**
- Frais `TG-DIVERS` "Frais divers test guide" (barème 60 000 F CFA, 2026-2027) et `TG-CANTINE` "Frais de cantine test guide" (sans barème).
- Plan `TG-3T` "Plan 3 tranches test guide" ; remises `TG-REM10` "Remise 10 % test guide" et `TG-REM5000` "Remise 5 000 F test guide" (non cumulables).
- Facture n°1 test guide (DIABATE Nadia, total 54 000, **reste dû 15 000 F CFA**, tranche 3 ouverte) ; facture n°2 test guide (reprise de solde, 25 000, « Payée »).
- Caisse `TG-CAISSE-1` "Caisse test guide" avec une **session ouverte** (fonds 10 000, 8 000 F CFA d'espèces encaissés : à clôturer dans une phase suivante).
- Paiements de Nadia : `VIR-TG-001` (10 000), espèces (8 000), `MM-TG-001` (6 000), en ligne 5 000 confirmé, 5 001 **en attente** (à rapprocher), 5 013 échoué, `VIR-TG-002` (20 000), `CHQ-TG-0001` (15 000) ; 6 reçus `REC-2026-nnnnnn` créés.
- Relevé à conserver : numéros des factures n°1 et n°2, numéro du reçu de `VIR-TG-001`, synthèse de départ (facturé, encaissé, restant dû).

---

## Phase 6 — Emploi du temps

Objectif : lire l'emploi du temps de la 6e A, créer les salles et les séances "test guide" dont la phase suivante a besoin (les séances d'appel du jour), tester conflits, déplacements, annulation, remplacement, génération, export, puis le générateur. La publication finale (irréversible) est la dernière étape.

Précondition : Collège Le Baobab (`secondaire-test`) ; **J = jeudi 8 octobre 2026**, **H** = mercredi 7 octobre, **W1** = mercredi 14 octobre, **V1** = vendredi 16 octobre 2026. Dates à saisir au format du navigateur (ici `08/10/2026`). Les séances de démonstration générées par la graine (un cours de 08:00 à 10:00 du lundi au jeudi, intervenant TRAORE Kouadio, sans salle) couvrent jusqu'à environ 14 jours après la création de la base.

### Étape 90 — Lire la semaine de la 6e A
👤 **directeur des études** (secondaire-test, `etudes@secondaire-test.test`, MFA) · fenêtre **A** · 📂 Menu **« Emploi du temps »** > **« Emploi du temps »** (`/v2/schedule`)

Attendu au départ : titre « Emploi du temps », pas de sujet choisi : « Choisissez ce que vous voulez consulter ».

1. Dans **« Afficher »**, choisir **« Classe »**, puis la classe `6e A`.
2. Lire « Semaine du … au … » : utiliser **« Semaine précédente »**, **« Semaine suivante »**, **« Aujourd'hui »**, puis passer **« Vue »** à **« Jour »**.
3. Changer **« Afficher »** pour **« Enseignant »** (`TRAORE Kouadio`), puis **« Salle »** (liste vide : aucune salle n'existe encore), puis **« Élève »** (`DIABATE Nadia`).

✅ Pour la semaine courante : quatre cours de 08:00 à 10:00, un par jour du lundi au jeudi (Français, Mathématiques, Anglais, Histoire-Géographie), intervenant TRAORE Kouadio. Une semaine sans séance : « Aucune séance cette semaine. »

⚠️ *Test d'erreur* : choisir « Salle » ou « Élève » sans sujet → rien ne s'affiche tant que le sujet n'est pas choisi.

☐ OK ☐ KO

---

### Étape 91 — Créer les trois salles "test guide"
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« Emploi du temps »** > **« Salles et équipements »** (`/v2/schedule/rooms`)

1. Choisir le **« Campus »** (le premier est présélectionné ; s'il n'y en a aucun, le noter : écart).
2. Cliquer **« Ajouter une salle »**, saisir, puis **« Ajouter »** (trois fois) :

| Champ | Salle 1 | Laboratoire | Petite salle |
| :--- | :--- | :--- | :--- |
| Code | `TG-S1` | `TG-LAB` | `TG-MINI` |
| Nom | `Salle 1 test guide` | `Laboratoire test guide` | `Petite salle test guide` |
| Type de salle | Salle de classe | Laboratoire | Autre |
| Capacité | `40` | `30` | `5` |
| Bâtiment | `Bloc A test guide` | `Bloc B test guide` | `Bloc A test guide` |
| Équipements fixes | `tableau, vidéoprojecteur` | `paillasses, évier` | (vide) |

✅ "Salle enregistrée." ; les trois salles apparaissent sous « Salles du campus » (colonnes « Nom », « Code », « Type », « Capacité », « Bâtiment », « État » = « Disponible ») et persistent après rechargement.

⚠️ *Test d'erreur* : Code `TG S1` (espace) → "Code invalide (lettres, chiffres, . _ -)." ; Capacité `0` → "La valeur doit être supérieure ou égale à 1." ; Code vide → "Ce champ est obligatoire."

🔒 *Test de droit* : avec `educateur@secondaire-test.test` (fenêtre **B**), le bouton « Ajouter une salle » est absent.

☐ OK ☐ KO

---

### Étape 92 — Mettre une salle hors service et ajouter un équipement
👤 **directeur des études** · fenêtre **A** · 📂 **« Salles et équipements »** (`/v2/schedule/rooms`)

1. Sur la ligne `Petite salle test guide`, cliquer **« Mettre hors service »**, saisir « Motif (facultatif) » = `Travaux test guide`, cliquer **« Confirmer »**.
2. Ouvrir la page **« Séances »** > **« Nouvelle séance »** (sans enregistrer) : la liste « Salle » ne propose plus `Petite salle test guide`. Fermer.
3. Revenir, cliquer **« Remettre en service »** puis **« Confirmer »**.
4. Sous « Équipements » (si l'offre l'inclut), **« Ajouter un équipement »** :

| Champ | Valeur |
| :--- | :--- |
| Code | `TG-VP` |
| Libellé | `Vidéoprojecteur test guide` |
| Quantité en stock | `1` |

   Cliquer **« Ajouter »**.

✅ "État de la salle modifié." (deux fois) ; la salle repasse « Disponible » ; "Équipement enregistré." Sinon : "La réservation d'équipements n'est pas incluse dans votre offre." *(à vérifier)*.

⚠️ *Test d'erreur* : Quantité en stock `0` → "La valeur doit être supérieure ou égale à 1."

☐ OK ☐ KO

---

### Étape 93 — Lire le publié et créer deux brouillons
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« Emploi du temps »** > **« Patrons récurrents »** (`/v2/schedule/timetables`)

1. Lire la liste (colonnes « Nom », « Validité », « Semaine A (lundi) », « Publié le », « État »). Ouvrir `Emploi du temps 6E-A` : badge « Publié », un créneau par jour (Lundi à Jeudi) "08:00 – 10:00", message "Seul un brouillon est modifiable.", boutons **« Archiver »** et **« Générer les séances »**, aucun bouton « Ajouter un créneau ». Cliquer **« Retour »**.
2. Cliquer **« Nouvel emploi du temps »** :

| Champ | Valeur |
| :--- | :--- |
| Année scolaire | année en cours (`2026-2027`, présélectionnée) |
| Nom | `Emploi du temps test guide 6e A` |
| Valable du / Valable jusqu'au | valeurs par défaut (début et fin d'année) |
| Premier lundi de la semaine A | `07/09/2026` |

3. Cliquer **« Créer »**. Recommencer avec le nom `Emploi du temps test guide B` et **sans** date de semaine A.

✅ "Emploi du temps créé en brouillon." (deux fois) ; deux lignes à l'état « Brouillon ». La fiche d'un brouillon vide affiche "Ajoutez des créneaux : classe, jour, heures, salle et intervenants."

⚠️ *Test d'erreur* : Nom vide → "Ce champ est obligatoire." ; « Valable jusqu'au » antérieur → "La fin de validité précède son début." ; Premier lundi = `08/09/2026` (un mardi) → "L'ancre de l'alternance A/B est un lundi."

🔒 *Test de droit* : `secretariat@secondaire-test.test` (MFA, fenêtre **B**) : le bouton « Nouvel emploi du temps » est absent.

☐ OK ☐ KO

---

### Étape 94 — Ajouter les créneaux du vendredi
👤 **directeur des études** · fenêtre **A** · 📂 fiche `Emploi du temps test guide 6e A` (`/v2/schedule/timetables`)

1. Cliquer **« Ajouter un créneau »**, saisir, puis **« Enregistrer »** (trois fois) :

| Champ | P1 | P2 | P3 |
| :--- | :--- | :--- | :--- |
| Type | Cours | Cours | Cours |
| Intitulé | `Mathématiques vendredi test guide` | `Anglais vendredi test guide` | `Histoire-Géographie semaine A test guide` |
| Classe | `6e A` | `6e A` | `6e A` |
| Cours (programme) | Mathématiques | Anglais | Histoire-Géographie |
| Jour | Vendredi | Vendredi | Vendredi |
| Début / Fin | `08:00` / `10:00` | `10:00` / `11:00` | `11:00` / `12:00` |
| Salle | `Salle 1 test guide (TG-S1)` | `Laboratoire test guide (TG-LAB)` | Aucune salle |
| Alternance | Chaque semaine | Chaque semaine | Semaine A seulement |
| Intervenant 1 / Rôle | `TRAORE Kouadio` / Responsable | `YAO Fatou` / Responsable | `KOUAME Adjoua` / Responsable |

2. Sur P3, cliquer **« Modifier »** : le champ « Séances déjà générées » apparaît ; changer l'Intitulé en `Histoire-Géographie semaine A test guide (modifié)` et enregistrer.

✅ "Créneau ajouté." (trois fois), "Créneau modifié." ; les trois créneaux sont sous « Vendredi » ; P3 porte le badge « Semaine A » ; P1 (fin 10:00) et P2 (début 10:00) ne sont **pas** en conflit ; « Conflits du brouillon » : "Aucun conflit dans ce brouillon."

⚠️ *Test d'erreur* : Type « Cours » sans classe → "Une classe est obligatoire pour un cours." ; « Fin » = « Début » → "L'heure de fin doit être postérieure à l'heure de début (pas de patron à cheval sur minuit)."

⚠️ *Écart connu* : une « Alternance » « Semaine A seulement » dans le brouillon `Emploi du temps test guide B` (sans date de semaine A) peut échouer sans aucun message ; ne pas le faire ici.

☐ OK ☐ KO

---

### Étape 95 — Provoquer un conflit entre créneaux, publication refusée
👤 **directeur des études** · fenêtre **A** · 📂 fiche `Emploi du temps test guide 6e A`

1. **« Ajouter un créneau »** : Type « Réunion », Intitulé `Réunion test guide`, Jour Vendredi, `09:00` à `10:00`, sans classe, Intervenant 1 = `TRAORE Kouadio`. Cliquer **« Enregistrer »**.
2. Constater le refus (message de l'API, texte exact à relever, du type "… est placé(e) sur deux créneaux qui se chevauchent le vendredi de 09:00 à 10:00.") et la liste « Conflits de planification » (nature « Intervenant »).
3. Saisir « Motif du dépassement » = `Réunion exceptionnelle test guide`, puis **« Enregistrer »** : le créneau est créé malgré le conflit.
4. Cliquer **« Actualiser »** dans « Conflits du brouillon » : le conflit P1 / réunion est listé.
5. Cliquer **« Publier »**.
6. Supprimer la réunion (icône poubelle « Supprimer le créneau de 09:00 »), **« Actualiser »**, puis cliquer **« Publier »** de nouveau.

✅ Étape 5 : "1 conflit(s) entre patrons : corrigez-les avant de publier." ; étape 6 : "Créneau supprimé." puis "Aucun conflit dans ce brouillon." puis refus "Un emploi du temps est déjà publié pour cet établissement, cette année et cette période." Le brouillon reste « Brouillon ».

⚠️ *Test d'erreur* : motif de dépassement `abc` → "Le motif du dépassement doit faire au moins 5 caractères." ; publier `Emploi du temps test guide B` (vide) → "Un emploi du temps vide ne peut pas être publié."

🔒 *Test de droit* : éducateur et secrétariat n'ont pas le bouton « Publier ».

☐ OK ☐ KO

---

### Étape 96 — Créer les séances "test guide"
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« Emploi du temps »** > **« Séances »** (`/v2/schedule/occurrences`)

1. Cliquer **« Nouvelle séance »** et créer, avec **« Créer la séance »** à chaque fois, les sept séances :

| Intitulé | Type | Classe / Cours | Date | Début–Fin | Salle | Intervenant (Responsable) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `Séance d'appel test guide` | Cours | 6e A / Mathématiques | `08/10/2026` | `11:00`–`12:00` | `Salle 1 test guide` | `TRAORE Kouadio` |
| `Séance d'appel 2 test guide` | Cours | 6e A / Anglais | `08/10/2026` | `12:30`–`13:30` | Aucune salle | `TRAORE Kouadio` |
| `Séance d'appel 3 test guide` | Cours | 6e A / Français | `08/10/2026` | `14:00`–`15:00` | Aucune salle | `TRAORE Kouadio` |
| `Séance d'appel 4 test guide` | Cours | 6e A / Histoire-Géographie | `08/10/2026` | `15:30`–`16:30` | Aucune salle | `TRAORE Kouadio` |
| `Séance de remplacement test guide` | Cours | 6e A / Mathématiques | `16/10/2026` | `14:00`–`15:00` | `Laboratoire test guide` | `TRAORE Kouadio` |
| `Réunion de parents test guide` | Réunion | (aucune) | `14/10/2026` | `15:00`–`16:30` | `Salle 1 test guide` | `KOUAME Adjoua` |
| `Réunion passée test guide` | Réunion | (aucune) | `07/10/2026` | `16:00`–`17:00` | Aucune salle | `KOUAME Adjoua` |

2. Dans le formulaire, l'aperçu passe de "Renseignez la date et les heures pour vérifier les conflits." à "Aucun conflit détecté sur ce créneau."
3. Élargir « Du » et « Au » de la liste pour voir `16/10/2026` et `07/10/2026`.

✅ "Séance créée." sept fois ; sept lignes à l'état « Prévue » (colonnes « Date », « Horaire », « Intitulé », « Classe », « Salle », « Intervenants », « État »).

⚠️ *Test d'erreur* : Type « Cours » sans classe → "Une classe est obligatoire pour un cours." ; Fin antérieure au début → "L'heure de fin doit être postérieure à l'heure de début (une séance ne passe pas minuit : créez-en deux)."

☐ OK ☐ KO

---

### Étape 97 — Conflits de séances et dépassement motivé
👤 **directeur des études** · fenêtre **A** · 📂 **« Séances »** > **« Nouvelle séance »**

1. Essai A (intervenant et classe) : Cours, 6e A / Anglais, `08/10/2026`, `11:30`–`12:30`, Intervenant `TRAORE Kouadio` : ne pas enregistrer (ou enregistrer pour constater le refus).
2. Essai B (adjacence) : Réunion, `08/10/2026`, `12:00`–`12:30`, `Salle 1 test guide`, `KOUAME Adjoua`.
3. Essai C (dépassement) :

| Champ | Valeur |
| :--- | :--- |
| Type | Réservation de salle |
| Intitulé | `Réservation test guide` |
| Date / Début–Fin | `08/10/2026` / `11:30`–`12:00` |
| Salle | `Salle 1 test guide` |
| Dépasser les conflits bloquants | coché |
| Motif du dépassement | `Réunion urgente validée` |

   Cliquer **« Créer la séance »**.

✅ Essai A : "2 conflits bloquants" (« Intervenant » et « Classe ») ; essai B : "Aucun conflit détecté sur ce créneau." (12:00 est la fin de l'autre séance) ; essai C : l'aperçu annonce un conflit « Salle », puis "Séance créée." avec le badge « Dérogation » et la zone « Avertissements de planification ».

⚠️ *Test d'erreur* : Réservation de salle sans salle → "Une réservation de salle précise la salle." ; motif `abc` → "Le motif du dépassement doit faire au moins 5 caractères."

☐ OK ☐ KO

---

### Étape 98 — Déplacer une séance et changer sa salle
👤 **directeur des études** · fenêtre **A** · 📂 **« Séances »**

1. Sur `Réunion de parents test guide`, cliquer **« Déplacer »**. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Nouvelle date | `15/10/2026` (jeudi) |
| Début / Fin | `15:00` / `16:30` |
| Motif | `Jeudi plus pratique test guide` |

   Cliquer **« Déplacer »**.
2. Sur la même ligne, cliquer **« Salle »**, choisir `Laboratoire test guide`, Motif `Plus de places test guide`, **« Changer la salle »**.

✅ "Séance déplacée." puis "Salle modifiée." ; la liste affiche le jeudi 15 octobre 2026 et `Laboratoire test guide`.

⚠️ *Test d'erreur* : déplacer `Séance d'appel test guide` vers `08/10/2026` `12:30`–`13:30` (créneau de la séance 2) → conflit bloquant « Intervenant » et « Classe ». Annuler sans enregistrer.

🔒 *Test de droit* : avec l'éducateur, les boutons « Déplacer » et « Salle » sont absents.

☐ OK ☐ KO

---

### Étape 99 — Annuler puis rétablir une séance
👤 **directeur des études** · fenêtre **A** · 📂 **« Séances »**

1. Sur `Réservation test guide`, cliquer **« Annuler »**, saisir « Motif » = `Réservation inutile test guide`, confirmer.
2. Filtrer « État » sur « Annulée » : la séance y figure. Cliquer **« Rétablir »** puis confirmer ("Séance rétablie."), puis l'annuler de nouveau avec le même motif.

✅ "Séance annulée." ; état « Annulée » ; dans `/v2/schedule`, en cochant **« Afficher les séances annulées »**, la séance apparaît avec "Motif : …".

⚠️ *Test d'erreur* : motif `ab` → "Le motif doit comporter au moins 3 caractères."

⚠️ *Écart connu* : la fenêtre porte deux boutons « Annuler » (fermer et confirmer). **Ne pas annuler** `Séance d'appel 4 test guide` ici : la phase suivante en a besoin.

☐ OK ☐ KO

---

### Étape 100 — Remplacer un intervenant
👤 **directeur des études** · fenêtre **A** · 📂 **« Séances »**

1. Sur `Réunion de parents test guide`, cliquer **« Remplacer »**.
2. Cliquer **« Proposer des remplaçants »** (chaque ligne indique « Disponible » ou « Non recommandé », « Compétent » et la charge de la semaine) puis **« Choisir »** sur `YAO Fatou`.
3. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Intervenant remplacé | `KOUAME Adjoua` |
| Remplaçant | `YAO Fatou` |
| Motif du remplacement | `Absence de Mme KOUAME test guide` |

4. Cliquer **« Remplacer »**.

✅ "Remplacement enregistré." ; la séance porte `YAO Fatou` avec le rôle « Remplaçant ».

⚠️ *Test d'erreur* : Remplaçant = intervenant remplacé → "Le remplaçant doit être une autre personne." ; motif `ab` → "Le motif doit faire au moins 3 caractères."

📌 La séance `Séance de remplacement test guide` sera remplacée dans la phase *Appel et présences* (après approbation d'un congé de TRAORE Kouadio).

☐ OK ☐ KO

---

### Étape 101 — Constater une séance passée
👤 **éducateur** (secondaire-test, `educateur@secondaire-test.test`, sans MFA) · fenêtre **B** · 📂 **« Séances »** (`/v2/schedule/occurrences`)

1. Régler **« Du »** sur `07/10/2026`. Repérer `Réunion passée test guide` (« Prévue ») : seul le bouton **« Constater »** est proposé.
2. Cliquer **« Constater »**.

✅ Conforme à la conception : "Séance constatée." et état « Constatée ».

⚠️ *Écart connu* : l'écran envoie la demande sans motif alors que l'API en exige un ; le résultat probable est "Un motif est requis." et la séance reste « Prévue » *(à vérifier, écart Majeur)*. Noter le résultat obtenu.

⚠️ *Test d'erreur* : « Constater » sur `Réunion de parents test guide` (future) → "Une séance qui n'a pas encore commencé ne peut pas être constatée."

☐ OK ☐ KO

---

### Étape 102 — Générer les séances d'un emploi du temps publié
👤 **directeur des études** · fenêtre **A** · 📂 fiche `Emploi du temps 6E-A` (`/v2/schedule/timetables`)

1. Cliquer **« Générer les séances »**. Choisir « Du » = lundi 5 octobre 2026, « Au » = dimanche 11 octobre 2026 (case « Plafonner au volume horaire des cours » décochée), cliquer **« Générer »**.
2. Lire le rapport (« Créées », « Déjà existantes », « Jours bloqués », « En conflit », « Plafonnées »).
3. Relancer la **même période**.
4. Étendre « Au » de 14 jours et relancer.

✅ Étape 3 : « Créées » = 0, « Déjà existantes » = total précédent (aucun doublon) ; étape 4 : « Créées » > 0 pour les semaines au-delà de la graine ; « En conflit » = 0 (les séances "test guide" commencent à 11:00 ou plus tard).

⚠️ *Test d'erreur* : « Au » antérieur à « Du » → "La fin de la fenêtre précède son début."

☐ OK ☐ KO

---

### Étape 103 — L'enseignant voit « Aujourd'hui » et son emploi du temps
👤 **enseignant** (secondaire-test, `enseignant@secondaire-test.test`, TRAORE Kouadio, sans MFA) · fenêtre **B** · 📂 Menu **« Aujourd'hui »** (`/v2/teacher`) puis **« Mon emploi du temps »** (`/v2/teacher/schedule`)

1. Ouvrir **« Aujourd'hui »** (ou `/v2/schedule/today`).
2. Ouvrir **« Mon emploi du temps »** : seul le mode « Mon emploi du temps » est proposé dans « Afficher ». Cocher **« Afficher les séances annulées »**.

✅ Étape 1 : titre « Aujourd'hui », les quatre `Séance d'appel … test guide` (et le cours de démonstration de 08:00 à 10:00 du jeudi) avec « Appel à faire » et le bouton « Faire l'appel ». Étape 2 : uniquement les séances de TRAORE Kouadio. Un jour sans cours : « Aucune séance aujourd'hui. »

🔒 *Test de droit* : en tant qu'enseignant, taper `/v2/schedule/rooms` → page « Accès refusé » ; taper `/v2/schedule/occurrences` → « Accès refusé ». En tant que directeur des études, taper `/v2/schedule/today` → « Accès refusé ».

☐ OK ☐ KO

---

### Étape 104 — Exporter le calendrier (.ics) et créer un lien d'abonnement
👤 **enseignant** · fenêtre **B** · 📂 **« Mon emploi du temps »** > **« Exporter le calendrier »** (`/v2/teacher/schedule/export`)

1. Choisir le **« Sujet de l'export »** : « Mon emploi du temps ».
2. Cliquer **« Télécharger le fichier .ics »** *(demander l'accord de l'utilisateur avant tout téléchargement)* : fichier `emploi-du-temps.ics`.
3. Sous « S'abonner (mise à jour automatique) », saisir « Nom du lien » = `Téléphone test guide`, « Validité (jours) » = `7`, cliquer **« Créer un lien d'abonnement »**, puis **« Copier le lien »**.
4. Dans « Liens d'abonnement », cliquer **« Révoquer »** puis confirmer.

✅ Étape 3 : "Lien créé : copiez-le maintenant." puis "Lien copié." et l'avertissement "Ce lien ne sera plus affiché…" (**ne pas partager le lien**) ; étape 4 : "Lien révoqué." et état « Révoqué ».

⚠️ *Test d'erreur* : sans sujet choisi → "Choisissez le sujet à exporter."

☐ OK ☐ KO

---

### Étape 105 — Les familles et l'élève lisent l'emploi du temps
👤 **parent** (secondaire-test, `parent@secondaire-test.test`, DIABATE Séka, sans MFA) · fenêtre **B** · 📂 `/v2/schedule`

1. Dans « Afficher », choisir **« Mes enfants »**, puis **« Choisir un enfant »** = `DIABATE Nadia`, ensuite `DIABATE Salimata`.
2. Ouvrir **« Export calendrier »** (`/v2/schedule/export`), sujet « Mes enfants » > `DIABATE Nadia` : le fichier `.ics` est proposé (même geste qu'à l'étape précédente, sans le refaire).

✅ La semaine de la 6e A en lecture seule, aucun bouton de modification.

🔒 *Test de droit* : en tant que parent, taper `/v2/schedule/timetables`, `/v2/schedule/rooms`, `/v2/schedule/occurrences`, `/v2/schedule/generator` → page « Accès refusé » pour chacune. Taper `/v2/parent/children/00000000-0000-4000-8000-000000000000/schedule` → introuvable, sans donnée.

☐ OK ☐ KO

---

### Étape 106 — Lancer le générateur d'emploi du temps
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« Emploi du temps »** > **« Générateur »** (`/v2/schedule/generator`) > **« Nouvelle génération »** (`/v2/schedule/generator/new`)

Attendu au départ : "Aucune génération pour le moment." (la fonction `scheduling.generation` doit être incluse dans l'offre *(à vérifier)*).

1. Section « Cadre » :

| Champ | Valeur |
| :--- | :--- |
| Nom de la proposition | `Génération test guide 6e A` |
| Début de la journée / Fin de la journée | `08:00` / `12:00` |
| Durée d'une période (minutes) | `60` |

2. Section « Besoins à placer » : classe `6e A`, cliquer **« Ajouter toutes ses matières »**, puis régler :

| Matière | Séances par semaine | Périodes par séance | Enseignant |
| :--- | :-: | :-: | :--- |
| Français | `2` | `1` | `TRAORE Kouadio` |
| Mathématiques | `2` | `1` | `TRAORE Kouadio` |
| Anglais | `1` | `2` | `YAO Fatou` |
| Histoire-Géographie | `1` | `1` | `KOUAME Adjoua` |

3. Section « Paramètres » : « Jours à planifier » Lun à Ven, « Graine » `graine-test-guide`, « Limite de temps (secondes) » `20`, « Itérations d'amélioration » `5000`.
4. Cliquer **« Lancer le calcul »**.

⚠️ *Écart connu* : une cinquième ligne portant le nom de la classe (`6e A`) peut apparaître dans les besoins : la retirer par **« Retirer »**.

✅ Total annoncé : "4 besoin(s), 6 séance(s) par semaine à placer." Redirection vers `/v2/schedule/generator/<id>` ; état « Proposition prête » ; « Séances demandées » 6, « Séances placées » 6, « Non placées » 0 ; onglet « Aperçu » : « Aperçu de la semaine type » (« Par classe », « Par enseignant », « Par salle ») ; "Aucun conflit enseignant, classe ou salle…".

⚠️ *Test d'erreur* : « Nom de la proposition » vide → "Le nom est requis." (ou "Ce champ est obligatoire.") ; « Durée d'une période (minutes) » `10` → "La valeur doit être supérieure ou égale à 20."

🔒 *Test de droit* : avec l'éducateur, taper `/v2/schedule/generator/new` → page « Accès refusé ».

☐ OK ☐ KO

---

### Étape 107 — Les limites du générateur
👤 **directeur des études** · fenêtre **A** · 📂 `/v2/schedule/generator/new`

1. Lancer une seconde génération : nom `Génération surchargée test guide`, même grille (`08:00`–`12:00`, `60`), Lun à Ven, un seul besoin : Mathématiques, `25` séances par semaine, `1` période, `TRAORE Kouadio`.
2. Ouvrir l'onglet **"Conflits et points d'attention (N)"** de la fiche obtenue.
3. Relancer la génération de l'étape précédente avec exactement les mêmes champs et la graine `graine-test-guide`. Puis, sur la fiche de la première proposition, cliquer **« Relancer avec une autre graine »**.

✅ Étape 2 : au moins 5 séances sous "Séances non placées (N)", cause "La classe demande plus d'heures que la semaine n'en offre" (par exemple "5 sur 25") ; la liste affiche au plus "20 sur 25". Étape 3 : mêmes « Séances placées » et même « Coût des préférences » pour la même graine ; une proposition `Génération test guide 6e A (bis)` avec une autre graine. Dans « Aperçu » : l'Anglais occupe deux périodes consécutives, aucun enseignant ni aucune salle sur deux séances au même créneau. Le message "Un emploi du temps publié existe déjà pour cette année ("Emploi du temps 6E-A"). Il ne sera pas modifié…" apparaît : un publié n'est jamais écrasé.

⚠️ *Limite assumée* : le générateur ne produit qu'une **semaine type** (jamais d'alternance A/B, un seul intervenant par créneau) et ignore les séances ponctuelles déjà réservées (par exemple `Réunion de parents test guide` en salle) ; ce n'est pas un défaut.

☐ OK ☐ KO

---

### Étape 108 — Appliquer et abandonner des propositions
👤 **directeur des études** · fenêtre **A** · 📂 `/v2/schedule/generator/<id>`

1. Sur `Génération test guide 6e A`, cliquer **« Examiner et appliquer »**, destination « Créer un nouveau brouillon », « Nom du brouillon » = `Emploi du temps généré test guide`, dates par défaut, cliquer **« Appliquer »**.
2. Sur le brouillon obtenu, cliquer **« Publier »**.
3. Sur `Génération surchargée test guide`, **« Examiner et appliquer »** : cliquer **« Appliquer »** sans cocher "J'accepte d'appliquer une proposition incomplète…". Puis choisir « Remplacer le contenu d'un brouillon existant », « Brouillon à remplacer » = `Emploi du temps test guide B`, cocher les deux confirmations, **« Appliquer »**.
4. Sur `Génération test guide 6e A (bis)`, cliquer **« Abandonner »**, confirmer.

✅ Étape 1 : redirection vers le nouveau brouillon avec 6 créneaux (Lundi à Vendredi) ; la proposition passe à « Appliquée » avec un lien « Ouvrir l'emploi du temps créé ». Étape 2 : refus "Un emploi du temps est déjà publié pour cet établissement, cette année et cette période." Étape 3 : `Emploi du temps test guide B` contient désormais les créneaux de la proposition surchargée. Étape 4 : "Proposition abandonnée." et état « Abandonnée ».

⚠️ *Test d'erreur* : étape 3 sans la case → "Confirmez que vous acceptez 5 séance(s) non placée(s) pour continuer." ; remplacement sans brouillon choisi → "Choisissez le brouillon à remplacer."

☐ OK ☐ KO

📚 *Pour aller plus loin* : chapitre 07, scénarios 7.1 à 7.21 (vues salle et élève, aide au placement, salle hors service sur des séances, remplacement depuis la page « Remplacements », droits par rôle, qualité transversale).

**Ce que la phase laisse dans l'application :**
- Salles `TG-S1` (Salle 1 test guide, 40), `TG-LAB` (Laboratoire test guide, 30), `TG-MINI` (Petite salle test guide, 5) ; équipement `TG-VP` (Vidéoprojecteur test guide).
- Séances du 8 octobre 2026 (6e A, intervenant TRAORE Kouadio) : `Séance d'appel test guide` (11:00, Salle 1), `Séance d'appel 2 test guide` (12:30), `Séance d'appel 3 test guide` (14:00), `Séance d'appel 4 test guide` (15:30) ; `Séance de remplacement test guide` (16/10/2026, 14:00, Laboratoire) ; `Réunion de parents test guide` (déplacée au 15/10, Laboratoire, YAO Fatou remplaçante) ; `Réunion passée test guide` (07/10, constatée si possible) ; `Réservation test guide` (annulée).
- Brouillons `Emploi du temps test guide B` (contenu généré), `Emploi du temps généré test guide` ; (la publication de `Emploi du temps test guide 6e A` et l'archivage de `Emploi du temps 6E-A` sont reportés à la **dernière phase** du guide).
- Propositions du générateur : `Génération test guide 6e A` (appliquée), `Génération surchargée test guide` (appliquée), `Génération test guide 6e A (bis)` (abandonnée).

---

## Phase 7 — Appel et présences

Objectif : l'enseignant fait l'appel des séances du jour et le soumet, l'éducateur et la direction valident (puis rouvrent), le parent justifie l'absence de DIABATE Nadia, puis on suit l'assiduité (absences, tableau de bord, appels non faits, alertes) et le pointage du personnel. **Règle : au secondaire l'appel se fait par séance ; l'enseignant n'a aucun appel journalier.**

Précondition : les quatre `Séance d'appel … test guide` de la phase *Emploi du temps* existent pour **J = 8 octobre 2026**. Liste d'appel de la 6e A : dix élèves à inscription active (DIABATE Nadia, DIABATE Salimata, BAMBA Aya, BAMBA Fatou, COULIBALY Moussa, COULIBALY Salimata, TOURE Yao, TOURE Jean-Marc, ADOU Aïcha, ASSI Brice) *(à vérifier : dix)*.

### Étape 109 — Lire « Mes appels » (appel par séance)
👤 **enseignant** (secondaire-test, `enseignant@secondaire-test.test`, TRAORE Kouadio, sans MFA) · fenêtre **B** · 📂 Menu **« Mes appels »** (`/v2/teacher/attendance`)

1. Lire le titre « Mes séances à faire » et la rubrique « Aujourd'hui ».
2. Descendre jusqu'à « Mes appels des 30 derniers jours » (attendre la fin du chargement : un faux "Aucun appel sur la période." peut s'afficher quelques secondes).

✅ `Séance d'appel test guide` (et les trois autres) avec « Appel à faire » et le bouton « Faire l'appel ». **Aucune rubrique « Appel de la journée »** : le cycle secondaire ne fait pas d'appel journalier. Les deux appels de démonstration validés figurent dans les 30 derniers jours (BAMBA Aya puis BAMBA Fatou absentes).

🔒 *Test de droit* : en tant qu'enseignant, taper `/v2/attendance/absences` → page « Accès refusé ».

☐ OK ☐ KO

---

### Étape 110 — Faire l'appel d'une séance et le soumettre
👤 **enseignant** · fenêtre **B** · 📂 **« Mes appels »** > **« Faire l'appel »** sur `Séance d'appel test guide`

Attendu au départ : l'ouverture crée l'appel (badge « Appel ouvert ») ; aide "Tout le monde est présent par défaut : touchez uniquement les exceptions." ; « Résumé de l'appel » : "Présent : 10".

1. Toucher la ligne `DIABATE Nadia` : elle passe à « Absent ». Toucher deux fois : retour à « Présent » ; la remettre à « Absent ».
2. Sur `DIABATE Salimata`, toucher le bouton « Autre statut pour DIABATE Salimata » : dans « Statut de DIABATE Salimata », cocher **« En retard »**, « Minutes de retard » = `10`, cliquer **« Appliquer »**.
3. Constater que « Absent justifié » n'est pas proposé à l'enseignant.
4. Cliquer **« Soumettre l'appel »**.

✅ "Appel soumis : 1 absent, 1 retard." (ou "Appel soumis." selon l'offre) ; badge « Appel soumis » ; résumé environ "Présent : 8", "Absent : 1", "En retard : 1" ; ligne de Salimata "En retard 10 min" ; le bouton devient « Enregistrer les corrections ». Dans « Mes appels », la séance porte « Appel soumis » et « Voir l'appel ».

⚠️ *Test d'erreur* : « Minutes de retard » `1500` → "Entrez un nombre entier de minutes entre 1 et 1440."

☐ OK ☐ KO

---

### Étape 111 — Corriger après soumission
👤 **enseignant** · fenêtre **B** · 📂 **« Mes appels »** > **« Voir l'appel »** sur `Séance d'appel test guide`

1. Passer `COULIBALY Moussa` en « Absent » : le pied indique "1 modification à envoyer". Cliquer **« Enregistrer les corrections »**.
2. Le remettre en « Présent » et enregistrer de nouveau (pour garder les chiffres du guide).

✅ "Corrections enregistrées." (deux fois) ; aucun second appel n'est créé pour la même séance.

☐ OK ☐ KO

---

### Étape 112 — Absence justifiée immédiate par la direction
👤 **directeur des études** (secondaire-test, `etudes@secondaire-test.test`, MFA) · fenêtre **A** · 📂 Menu **« Présences »** > **« Suivi des appels »** (`/v2/attendance/sessions`)

Attendu au départ : régler « Du » sur le `01/09/2026` pour voir aussi les deux appels de démonstration (« Validé »). L'appel de `Séance d'appel test guide` est « Soumis ».

1. Sur la ligne de `Séance d'appel test guide`, cliquer **« Ouvrir »**.
2. Sur `TOURE Yao` (présent), toucher « Autre statut pour TOURE Yao » puis **« Enregistrer une absence justifiée… »**.
3. Dans « Absence justifiée : TOURE Yao » :

| Champ | Valeur |
| :--- | :--- |
| Motif | Difficulté de transport |
| Commentaire | `Bus en retard, test guide` |

4. Cliquer **« Enregistrer »**.

✅ "Absence justifiée enregistrée." ; la ligne de `TOURE Yao` passe à « Absent » avec la mention « Justifié ».

⚠️ *Test d'erreur* : valider sans motif → "Choisissez un motif."

🔒 *Test de droit* : le lien « Enregistrer une absence justifiée… » n'existe pas pour l'enseignant.

☐ OK ☐ KO

---

### Étape 113 — Valider l'appel (éducateur)
👤 **éducateur** (secondaire-test, `educateur@secondaire-test.test`, sans MFA) · fenêtre **B** · 📂 Menu **« Présences »** > **« Suivi des appels »** (`/v2/attendance/sessions`)

1. Régler « Du » sur le `01/09/2026`. Repérer, dans la colonne « État », « Validé » (démonstration) et « Soumis » (`Séance d'appel test guide`). Essayer les filtres « État » et « Classe » (6e A).
2. Sur l'appel « Soumis », cliquer **« Valider »** (aucune fenêtre de confirmation).

✅ "Appel validé." ; l'état passe à « Validé » ; les boutons « Valider » et « Annuler » disparaissent de la ligne ; **« Rouvrir » est absent pour l'éducateur**.

☐ OK ☐ KO

---

### Étape 114 — Préparer trois autres appels
👤 **enseignant** · fenêtre **B** · 📂 **« Mes appels »** > **« Faire l'appel »**

1. `Séance d'appel 2 test guide` : `DIABATE Nadia` « Absent », les autres présents, **« Soumettre l'appel »**.
2. `Séance d'appel 3 test guide` : tout le monde présent, **« Soumettre l'appel »**.
3. `Séance d'appel 4 test guide` : cliquer **« Faire l'appel »** pour l'ouvrir, **sans** le soumettre (revenir à « Mes appels »).

✅ Deux appels « Appel soumis », un « Appel ouvert ». Dans `/v2/schedule`, les séances soumises passent à « Constatée » (effet de la soumission).

☐ OK ☐ KO

---

### Étape 115 — Valider par lot et annuler un appel
👤 **directeur des études** · fenêtre **A** · 📂 **« Suivi des appels »**

1. Cocher les appels « Soumis » de `Séance d'appel 2 test guide` et `Séance d'appel 3 test guide` (« Sélectionner l'appel de 6e A du … »), cliquer **"Valider les 2 séances sélectionnées"**.
2. Sur la ligne de `Séance d'appel 4 test guide` (appel « Ouvert »), cliquer **« Annuler »** ; dans « Annuler l'appel », « Motif » = `Appel ouvert par erreur test guide`, confirmer.

✅ "2 appels validés." ; "Appel annulé." ; état « Annulé », plus de bouton « Valider » ni « Annuler » sur cette ligne.

⚠️ *Test d'erreur* : motif de 2 caractères → "Le motif doit comporter au moins 5 caractères."

☐ OK ☐ KO

---

### Étape 116 — Rouvrir un appel validé avec motif
👤 **directeur** (secondaire-test, `directeur@secondaire-test.test`, MFA) · fenêtre **A** · 📂 **« Suivi des appels »**

1. Sur l'appel validé de `Séance d'appel test guide`, cliquer **« Rouvrir »**.
2. Dans « Rouvrir l'appel » ("Acte sensible : l'appel validé repasse en correction…"), saisir « Motif » = `Erreur de saisie test guide`, confirmer (renseigner le code MFA du moment si « Confirmez votre identité » s'affiche).
3. Cliquer **« Ouvrir »**, passer `TOURE Jean-Marc` de « Présent » à « Absent », **« Enregistrer les corrections »**.
4. Revenir à « Suivi des appels » et cliquer **« Valider »**.

✅ "Appel rouvert." puis "Corrections enregistrées." puis "Appel validé." ; l'appel compte maintenant : `DIABATE Nadia` absente, `TOURE Yao` absent justifié, `TOURE Jean-Marc` absent, `DIABATE Salimata` en retard.

⚠️ *Test d'erreur* : motif `abc` → "Le motif doit comporter au moins 5 caractères."

🔒 *Test de droit* : « Rouvrir » est absent pour le directeur des études et pour l'éducateur.

☐ OK ☐ KO

---

### Étape 117 — Le parent dépose un justificatif pour DIABATE Nadia
👤 **parent** (secondaire-test, `parent@secondaire-test.test`, DIABATE Séka, sans MFA) · fenêtre **B** · 📂 `/v2/attendance/children` (titre « Absences de mes enfants »)

1. Cliquer **« Voir les absences »** pour `DIABATE Nadia` : lire le « Récapitulatif » et la ligne d'absence « À justifier ».
2. Cliquer **« Déposer un justificatif »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Premier jour d'absence | `08/10/2026` |
| Dernier jour d'absence | `08/10/2026` |
| Motif | Maladie |
| Commentaire | `Paludisme, consultation du jour, test guide` |
| Pièce jointe (facultative) | `docs/guide-test/jeux-de-donnees/justificatif-maladie-test-guide.pdf` |

3. Cliquer **« Déposer »**.

✅ "Justificatif déposé." ; sous « Justificatifs déposés », état « En attente » et bouton « Retirer ce justificatif » ; l'absence reste « À justifier ». Pour `DIABATE Salimata` : un retard.

⚠️ *Test d'erreur* : « Dernier jour d'absence » antérieur au premier → "La fin de la fenêtre précède son début." ; pièce `justificatif-faux-test-guide.pdf` (texte renommé .pdf) → justificatif déposé mais "Le justificatif est déposé mais la pièce n'a pas pu être jointe : Type de fichier non accepté (contrôlé sur le contenu réel du fichier)."

⚠️ *Écart connu* : « Motif » non choisi affiche le message technique "Code attendu : majuscules, chiffres et _ (40 max)."

🔒 *Test de droit* : en tant que parent, taper `/v2/attendance/justifications` puis `/v2/attendance/call` → page « Accès refusé ».

☐ OK ☐ KO

---

### Étape 118 — Décider sur le justificatif
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« Présences »** > **« Justificatifs »** (`/v2/attendance/justifications`)

1. Filtre « État » sur « En attente » : ligne `DIABATE Nadia`, « Déposé par » = « Parent ». Cliquer le nom, puis **« Ouvrir »** sur la pièce jointe (lien temporaire, journalisé).
2. Cliquer **« Accepter »**, « Note (facultative) » = `Pièce reçue test guide`, confirmer.
3. Vérifier dans **« Absences »** (filtre « Justification » = « Justifiée ») que `DIABATE Nadia` est « Absent justifié ».
4. Revenir sur le justificatif, cliquer **« Révoquer »**, « Motif de la révocation » = `Pièce non conforme test guide`, confirmer.

✅ "Justificatif accepté." (état « Accepté », pointage(s) couvert(s) : un ou deux selon que la séance 2 compte *(à vérifier)*) ; "Justificatif révoqué." (état « Révoqué ») : l'absence de Nadia redevient « À justifier ».

⚠️ *Test d'erreur* : révocation avec motif `abc` → "Le motif doit comporter au moins 5 caractères."

⚠️ *Écart connu* : le motif s'affiche en code brut (`ILLNESS`).

☐ OK ☐ KO

---

### Étape 119 — Dépôt par l'éducateur et rejet
👤 **éducateur** · fenêtre **B** · 📂 **« Justificatifs »** (`/v2/attendance/justifications`)

1. Cliquer **« Déposer un justificatif »** pour `DIABATE Salimata` : jours `08/10/2026`, Motif « Autre », pièce `docs/guide-test/jeux-de-donnees/justificatif-photo-test-guide.png`, **« Déposer »**.
2. Constater que l'éducateur n'a **aucun** bouton « Accepter », « Rejeter », « Révoquer ».
3. 👤 **directeur des études** · fenêtre **A** : sur ce justificatif, **« Rejeter »**, « Motif du rejet » = `Motif insuffisant test guide`, confirmer.

✅ "Justificatif déposé." puis "Justificatif rejeté." ; état « Rejeté » ; aucun bouton « Révoquer » sur un justificatif rejeté.

⚠️ *Test d'erreur* : rejet avec motif `ab` → "Le motif doit comporter au moins 3 caractères."

☐ OK ☐ KO

---

### Étape 120 — Absences et export CSV
👤 **éducateur** · fenêtre **B** · 📂 Menu **« Présences »** > **« Absences »** (`/v2/attendance/absences`)

1. Choisir « Classe » = `6e A`, « Du » = `01/09/2026`, « Justification » = « Tous ».
2. Lire la liste (par défaut « À justifier »), puis essayer « Justification » = « Justifiée ».
3. Cliquer **« Exporter en CSV »** *(demander l'accord de l'utilisateur avant le téléchargement)*.

✅ `DIABATE Nadia` « Absent » « À justifier », `DIABATE Salimata` « En retard » 10 minutes, `TOURE Jean-Marc` « Absent », `TOURE Yao` « Absent » justifié, plus les absences de démonstration (BAMBA Aya, BAMBA Fatou). "Export téléchargé." ; fichier `absences.csv` (séparateur point-virgule, colonnes `date;eleve_id;eleve;classe_id;statut;justifie;minutes;justificatif_id`).

⚠️ *Test d'erreur* : « Du » postérieur à « Au » → « Aucune absence correspondante. »

🔒 *Test de droit* : en tant que parent ou élève, taper `/v2/attendance/absences` → page « Accès refusé ».

☐ OK ☐ KO

---

### Étape 121 — Tableau de bord d'assiduité, recalcul et surcharge
👤 **directeur des études** puis **directeur** · fenêtre **A** · 📂 Menu **« Présences »** > **« Tableau de bord »** (`/v2/attendance`)

1. Choisir « Année scolaire », « Période » = Trimestre 1, « Classe » = `6e A`. Lire les colonnes « Élève », « Séances », « Absences », « Retards », « Départs anticipés », « Non pointés », « Valeur » (« Calculé »).
2. Avec le directeur des études : **« Recalculer la période »**.
3. Avec le directeur : sur la ligne `DIABATE Nadia`, cliquer **« Surcharger »** :

| Champ | Valeur |
| :--- | :--- |
| Minutes d'absence (total) | `120` |
| dont minutes justifiées | `60` |
| Motif de la surcharge | `Correction test guide` |

   Cliquer **« Enregistrer la surcharge »**, puis **« Retirer la surcharge »**.
4. Cliquer le nom `DIABATE Nadia` : fiche « Assiduité de DIABATE Nadia », choisir la période, **« Afficher l'attestation »**.

✅ "Recalcul demandé : les récapitulatifs sont à jour." ; "Surcharge enregistrée (motif et auteur conservés)." (valeur « Surchargé ») puis "Surcharge retirée : la valeur calculée à partir des appels s'applique de nouveau." ; attestation d'assiduité affichée. Sans classe choisie : « Choisissez une classe ».

⚠️ *Test d'erreur* : minutes justifiées `200` pour 120 → "Les minutes justifiées ne peuvent pas dépasser les minutes d'absence." ; motif `abc` → "Le motif doit faire au moins 5 caractères."

🔒 *Test de droit* : le bouton « Surcharger » est absent pour le directeur des études et l'éducateur.

☐ OK ☐ KO

---

### Étape 122 — Appels non faits
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« Présences »** > **« Appels non faits »** (`/v2/attendance/compliance`)

1. Régler « Du » sur le `01/09/2026`. Lire « Attendus », « Faits », « Non faits », « Taux d'appel », « Par enseignant », « Par classe ».
2. Dans « Séances sans appel », cliquer **« Faire l'appel »** sur une séance manquante.

✅ Compteurs cohérents avec les appels faits (seules les séances planifiées passées comptent) ; l'écran d'appel de la séance choisie s'ouvre. Quand rien ne manque : "Tous les appels attendus ont été faits."

🔒 *Test de droit* : en tant qu'enseignant, taper `/v2/attendance/compliance` → page « Accès refusé ».

☐ OK ☐ KO

---

### Étape 123 — Créer la règle d'alerte `TG_ABSENCES_2`
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« Présences »** > **« Alertes »** (`/v2/attendance/alerts`)

Attendu au départ : "Aucune règle d'alerte." et "Sans règle, aucune alerte n'est émise. Ajoutez-en une ci-dessous."

1. Sous « Ajouter une règle » :

| Champ | Valeur |
| :--- | :--- |
| Code de la règle | `TG_ABSENCES_2` |
| Indicateur | Nombre d'absences |
| Seuil | `2` |
| Activer la règle dès sa création | coché |

2. Cliquer **« Ajouter la règle »**, puis **« Désactiver »** et **« Activer »**.
3. Depuis **« Tableau de bord »**, cliquer **« Recalculer la période »** (`DIABATE Nadia` a deux absences : séances 1 et 2).

✅ "Règle ajoutée.", "Règle désactivée.", "Règle activée." ; au franchissement du seuil une notification (simulée) est émise pour le tuteur *(à vérifier)*.

⚠️ *Test d'erreur* : Code `abs 1` → "Code attendu : majuscules, chiffres et _ (40 max)." ; même code une seconde fois → "Une règle porte déjà ce code." ; Seuil `0` → "La valeur doit être supérieure ou égale à 1."

🔒 *Test de droit* : avec l'éducateur, la liste est lisible mais le formulaire et les boutons « Activer », « Désactiver », « Supprimer » sont absents.

☐ OK ☐ KO

---

### Étape 124 — Pointage du personnel et demande de congé
👤 **enseignant** · fenêtre **B** · 📂 Menu **« Mes congés et ma présence »** (`/v2/teacher/leaves`)

1. Cliquer **« Départ »** avant **« Arrivée »**.
2. Cliquer **« Arrivée »**, puis **« Départ »**.
3. Cliquer **« Demander un congé »** :

| Champ | Valeur |
| :--- | :--- |
| Type de congé | Congé annuel |
| Premier jour | `16/10/2026` |
| Dernier jour | `16/10/2026` |
| Motif | `Congé annuel test guide` |

4. Cliquer **« Envoyer la demande »**.

✅ Étape 1 : "Aucune arrivée n'est enregistrée pour ce jour." ; étape 2 : "Arrivée enregistrée." puis "Départ enregistré." (ligne du jour sous « Présences ») ; étape 4 : "Demande de congé envoyée." et état « Demandé ». Aucun bouton « Approuver » ni « Refuser » pour l'enseignant. Si l'offre n'inclut pas la présence du personnel : "La présence du personnel n'est pas incluse dans votre offre." *(à vérifier)*.

⚠️ *Test d'erreur* : « Dernier jour » antérieur → "La fin du congé précède son début."

⚠️ *Écart connu* : le type s'affiche en code brut (`ANNUAL`).

☐ OK ☐ KO

---

### Étape 125 — Décider sur les congés et enregistrer une présence
👤 **directeur des études** (fenêtre **A**), avec le **directeur** pour créer des demandes · 📂 Menu **« Présences »** > **« Personnel »** (`/v2/attendance/staff`)

1. Avec le directeur des études, filtre « État des congés » = « Demandé » : cliquer **« Approuver »** sur la demande de `TRAORE Kouadio`.
2. Avec le **directeur** : **« Demander un congé »** pour `TRAORE Kouadio`, type « Absence autorisée », jour `12/10/2026` ; puis une seconde demande le `13/10/2026`.
3. Avec le directeur des études : **« Refuser »** la première (« Motif du refus » = `Besoin de service test guide`), **« Annuler »** la seconde.
4. Cliquer **« Enregistrer une présence »** :

| Champ | Valeur |
| :--- | :--- |
| Membre du personnel | `YAO Fatou` |
| Jour | `08/10/2026` |
| Statut | En retard |
| Note | `Retard test guide` |

   Cliquer **« Enregistrer »**. Lire le « Récapitulatif ».

✅ "Congé approuvé." ; "Congé refusé." ; "Congé annulé." ; "Présence enregistrée." ; récapitulatif (« Jours », « Par statut », « Minutes de retard », « Jours de congé »).

⚠️ *Test d'erreur* : refus avec motif `ab` → "Le motif doit comporter au moins 3 caractères." ; statut « En congé » pour `YAO Fatou` → "Le statut "en congé" exige un congé approuvé couvrant ce jour."

🔒 *Test de droit* : en tant qu'enseignant, taper `/v2/attendance/staff` → page « Accès refusé ».

☐ OK ☐ KO

---

### Étape 126 — Remplacer l'enseignant en congé
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« Emploi du temps »** > **« Remplacements »** (`/v2/schedule/replacements`)

Attendu au départ : après l'approbation du congé et quelques secondes de traitement, la page affiche `Séance de remplacement test guide` (16/10/2026) avec le badge « À remplacer » (période « Du » / « Au » à élargir jusqu'au 16/10).

1. Cliquer **« Remplacer »**, choisir `YAO Fatou` (ou **« Proposer des remplaçants »** puis **« Choisir »**).
2. « Motif du remplacement » = `Congé de TRAORE test guide`, cliquer **« Remplacer »**.

✅ "Remplacement enregistré." ; la séance perd le badge « À remplacer » et porte `YAO Fatou`.

⚠️ *Écart connu* : la cause s'affiche en code brut (`STAFF_LEAVE`). Si rien n'apparaît après une minute, noter le délai (« Aucune séance à remplacer. »).

🔒 *Test de droit* : en tant qu'éducateur, taper `/v2/schedule/replacements` → page « Accès refusé ».

☐ OK ☐ KO

---

### Étape 127 — La politique d'appel par séance est respectée
👤 **directeur** · fenêtre **A** · 📂 Menu **« Présences »** > **« Faire l'appel »** (`/v2/attendance/call`)

1. Sous « Appel de la journée » (bloc de direction), choisir « Autre classe » = `6e A`, « Date » = `08/10/2026`, « Demi-journée » = « Journée entière », cliquer **« Ouvrir »**.

✅ Refus : "La politique d'appel de ce cycle n'autorise pas l'appel journalier." (rien n'est créé).

🔒 *Test de droit* : en tant que parent, taper `/v2/attendance/call` → page « Accès refusé ».

☐ OK ☐ KO

---

📚 *Pour aller plus loin* : chapitre 06, scénarios 6.1 à 6.25 (appel journalier du primaire et de la maternelle, 6.9 à 6.11 ; justificatif de l'élève, 6.16 et 6.22 ; fichiers refusés ; conflits de synchronisation, 6.19 ; isolation entre établissements, 6.23 ; droits par rôle, 6.24).

**Ce que la phase laisse dans l'application :**
- Appels de la 6e A du 8 octobre 2026 : `Séance d'appel test guide` (validée ; `DIABATE Nadia` absente, `DIABATE Salimata` en retard 10 min, `TOURE Yao` absent justifié, `TOURE Jean-Marc` absent), `Séance d'appel 2 test guide` (validée ; Nadia absente), `Séance d'appel 3 test guide` (validée ; tous présents), `Séance d'appel 4 test guide` (appel annulé).
- Justificatifs : `DIABATE Nadia` (Maladie, pièce PDF, accepté puis révoqué), `DIABATE Salimata` (Autre, pièce PNG, rejeté) ; absence justifiée de `TOURE Yao` (Difficulté de transport).
- Règle d'alerte `TG_ABSENCES_2` (active) ; aucune surcharge d'assiduité restante.
- Congé annuel de `TRAORE Kouadio` le 16/10/2026 (approuvé) ; deux « Absence autorisée » (refusée, annulée) ; pointage du jour de TRAORE Kouadio ; présence « En retard » de `YAO Fatou` ; `Séance de remplacement test guide` remplacée par `YAO Fatou`.

---

## Phase 8 — Évaluations et notes

Le professeur crée et saisit les notes de Mathématiques de la 6e A au Trimestre 3, puis le circuit à quatre yeux (relecture, approbation, publication) les fait publier ; une note publiée est ensuite corrigée par une demande approuvée, et l'élève ne voit que ce qui est publié. Les moyennes, rangs et mentions ne se calculent pas ici : c'est la phase suivante.

Précondition : les phases de structure sont faites (6e A, ses 8 élèves de la graine, TRAORE Kouadio affecté aux quatre matières, Trimestre 3 « Planifié » mais **non verrouillé**). La date à saisir partout est celle du jour du test : `2026-10-08`. Si des phases précédentes ont ajouté des élèves à la 6e A (par exemple KOUASSI Aïcha test guide), la feuille de notes compte quelques lignes de plus : les laisser **vides**, les totaux "sur N élèves notés" s'adaptent.

---

### Étape 128 — Lire les évaluations de la graine
👤 **directeur des études** (secondaire-test) · fenêtre **A** · `etudes@secondaire-test.test` (MFA) · 📂 Barre « Évaluations et notes » > « Évaluations » (`/v2/assessments`)

Attendu au départ : 12 évaluations, toutes « Publiée » (4 "Composition", 4 "Devoir de la période 2", 2 "Premier contrôle", 2 "Premier contrôle (suite)").

1. Lire le titre « Évaluations » et le formulaire « Filtres » (« Classe », « Période », « État », case « Seulement mes évaluations »).
2. Choisir « Classe » = `6e A`, puis « Période » = `Trimestre 2` : 4 lignes ("Devoir de la période 2").
3. Remettre « Période » sur toutes, choisir « État » = « Soumise ».
4. Rouvrir « État » = « Publiée » et cliquer le titre de la "Composition" de Français ; cliquer **« Voir les notes »**.

✅ Étape 3 : état vide « Aucune évaluation. » et « Créez une évaluation ou modifiez les filtres. ». Étape 4 : la fiche montre le badge « Publiée », la barre « Circuit de validation » et « Historique du circuit de validation » ; la feuille compte **8 notes sur 20**, aucune cellule modifiable, et le message "Notes publiées : elles ne se modifient plus. Utilisez « Corriger » pour demander une correction motivée."

⚠️ *Test d'erreur* : ouvrir `/v2/assessments/00000000-0000-4000-8000-000000000000` → erreur "Évaluation introuvable (00000000-0000-4000-8000-000000000000)." *(message à relever)*.

⚠️ *Écart connu* : le barème peut s'afficher « Sur 20,000 » au lieu de « Sur 20 » ; c'est cosmétique.

☐ OK ☐ KO

---

### Étape 129 — Types d'évaluation : lecture seule
👤 **responsable pédagogique** (secondaire-test) · fenêtre **A** · `pedagogie@secondaire-test.test` (MFA) · 📂 Barre « Évaluations et notes » > « Types d'évaluation » (`/v2/assessments/types`)

*(« Se déconnecter » du directeur des études, puis connexion.)*

1. Lire le tableau « Types d'évaluation » : "Devoir" (code `DEVOIR`, `CONTINUOUS`, "/20", « Publication manuelle »), "Composition" (`COMPOSITION`, `EXAM`), « Examen blanc » avec le badge « Masqué aux élèves ». Chaque type porte le badge « Modèle ».
2. Lire la rubrique « Réglages de la saisie » : « Le relecteur doit être une autre personne que le saisissant » (cochée), « L'approbateur doit être une autre personne que le relecteur » (cochée), « Décimales autorisées » (2).

✅ 9 types ; **aucun** bouton « Nouveau type » ni « Modifier » ; cases et liste grisées, note « Vous pouvez consulter ces réglages mais pas les modifier. ».

⚠️ *Écart connu* : le libellé « L'approbateur doit être une autre personne que le relecteur » est trompeur : le serveur ne compare que la personne qui a **soumis** (voir l'étape *Approuver les feuilles de Mathématiques*).

☐ OK ☐ KO

---

### Étape 130 — Créer, désactiver un type d'évaluation
👤 **directeur** (secondaire-test) · fenêtre **A** · `directeur@secondaire-test.test` (MFA) · 📂 Barre « Évaluations et notes » > « Types d'évaluation » (`/v2/assessments/types`)

1. Cliquer **« Nouveau type »** ; la fenêtre « Créer un type d'évaluation » s'ouvre.
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Code | `TG_QUIZ` |
| Libellé | `Quiz test guide` |
| Groupe d'agrégation | `CONTINUOUS` |
| Barème par défaut | `10` |
| Coefficient par défaut | `1` |
| Mode de publication | « Publication manuelle » |
| Visible des élèves et des parents | cochée |

3. Cliquer **« Créer le type »**.
4. Sur la ligne "Quiz test guide" : **« Modifier »** (le code est grisé), « Barème par défaut » = `15`, **« Enregistrer »**.
5. Cliquer **« Désactiver »**, puis **« Activer »**, puis de nouveau **« Désactiver »**.
6. Ne pas toucher aux « Réglages de la saisie » (si vous modifiez « Décimales autorisées », remettre `2`).

✅ « Le type Quiz test guide est enregistré. » ; ligne `TG_QUIZ`, « Barème » "/10" puis "/15" ; messages « Le type Quiz test guide est désactivé. » / « Le type Quiz test guide est activé. » ; état final inactif ; valeurs conservées après F5.

⚠️ *Test d'erreur* : Code `tg quiz` → "Code attendu : majuscules, chiffres et _ (2 à 32 caractères)." ; Libellé vide → « Ce champ est obligatoire. ».

☐ OK ☐ KO

---

### Étape 131 — Créer le Devoir n°1 de Mathématiques
👤 **enseignant** (secondaire-test) · fenêtre **B** · `enseignant@secondaire-test.test` (TRAORE Kouadio, pas de MFA) · 📂 Menu "Mes évaluations" (`/v2/teacher/assessments`) > **« Nouvelle évaluation »** (`/v2/teacher/assessments/new`)

*(Première connexion de la phase : fenêtre privée, page `/v2/login`, clic sur le compte.)*

Attendu au départ : « Mes évaluations » liste les 12 évaluations de la graine, toutes « Publiée » (attendre la fin du chargement).

1. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Type d'évaluation | `Devoir` (l'aide du barème dit « Par défaut : 20 ») |
| Intitulé | `Devoir n°1 Mathématiques test guide` |
| Date de l'évaluation | `2026-10-08` |
| Barème (sur) | *(vide : reprend celui du type)* |
| Coefficient | *(vide)* |
| Classe | `6e A` |
| Cours | `Mathématiques` |
| Période | `Trimestre 3` |

2. Cliquer **« Créer l'évaluation »**.

✅ Page « Évaluation créée », message "1 évaluation créée.", boutons « Saisir les notes » et « Créer une autre évaluation ».

⚠️ *Test d'erreur* : tout vide puis « Créer l'évaluation » → "Choix invalide." sous « Type d'évaluation », « Classe », « Cours », « Période » et « Ce champ est obligatoire. » sous « Intitulé » ; Période `Trimestre 2` → "La période de cette classe est verrouillée pour cette session."

⚠️ *Écart connu* : « Barème (sur) » et « Coefficient » refusent la virgule (`12,5` → "Valeur décimale attendue (3 décimales au plus).") alors que la grille de notes l'accepte ; un faux message "Aucune classe ne vous est affectée…" peut clignoter pendant le chargement.

☐ OK ☐ KO

---

### Étape 132 — Créer l'interrogation de Mathématiques
👤 **enseignant** (secondaire-test) · fenêtre **B** · 📂 Page « Évaluation créée » > **« Créer une autre évaluation »**

1. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Type d'évaluation | `Interrogation` |
| Intitulé | `Interrogation Mathématiques test guide` |
| Date de l'évaluation | `2026-10-08` |
| Barème (sur) | `10` |
| Coefficient | `2` |
| Classe / Cours / Période | `6e A` / `Mathématiques` / `Trimestre 3` |

2. Cliquer **« Créer l'évaluation »**, puis ouvrir « Mes évaluations ».

✅ Les deux évaluations sont « Brouillon » ; sur la fiche de l'interrogation : « Barème » `10` (ou `10,000`), « Coefficient » `2`, « Session » « Session 1 » ; l'historique n'a qu'une ligne « Brouillon ».

☐ OK ☐ KO

---

### Étape 133 — Créer le "Devoir commun" pour deux cours à la fois
👤 **enseignant** (secondaire-test) · fenêtre **B** · 📂 Menu "Mes évaluations" > **« Nouvelle évaluation »**

1. Saisir « Type d'évaluation » = `Devoir`, « Intitulé » = `Devoir commun test guide`, « Date de l'évaluation » = `2026-10-08`.
2. Cocher **« Créer pour plusieurs classes à la fois »** : le groupe « Classes et cours » remplace les champs simples.
3. Ligne 1 : « Classe 1 » = `6e A`, « Cours 1 » = `Français`. Cliquer **« Ajouter une classe »** : « Classe 2 » = `6e A`, « Cours 2 » = `Anglais`.
4. « Période » = `Trimestre 3`, puis **« Créer l'évaluation »**.

✅ Message "2 évaluations créées." avec deux lignes "Devoir commun test guide" ; dans « Mes évaluations » la colonne « Matière » distingue Français et Anglais, les deux en « Brouillon ».

☐ OK ☐ KO

---

### Étape 134 — Saisir les notes du Devoir n°1 (codes, zéro, virgule, point)
👤 **enseignant** (secondaire-test) · fenêtre **B** · 📂 « Mes évaluations » > "Devoir n°1 Mathématiques test guide" > **« Saisir les notes »**

Attendu au départ : badge « Brouillon », badge « Sur 20 », progression « 0 sur 10 élèves notés », « Aucune modification en attente. ». Le panneau « Aide à la saisie » rappelle les codes ABS, ABJ, DISP, NN.

1. Saisir dans la colonne « Note (sur 20) », **Entrée** passant à l'élève suivant :

| Élève | À saisir | État obtenu |
| :--- | :--- | :--- |
| ADOU Aïcha | `14` | Noté |
| ASSI Brice | `9,5` | Noté |
| BAMBA Aya | `ABS` | Absent non justifié |
| BAMBA Fatou | `ABJ` | Absent justifié |
| COULIBALY Moussa | `12,5` (essayer aussi `12.5` : accepté) | Noté |
| COULIBALY Salimata | `16` | Noté |
| DIABATE Nadia | `18` | Noté |
| DIABATE Salimata | `0` (vrai zéro) | Noté |
| TOURE Jean-Marc | `DISP` | Dispensé |
| TOURE Yao | *(laisser vide)* | |

2. Pour DIABATE Nadia, saisir le commentaire `Copie rendue en retard` (colonne « Commentaire »).
3. Attendre environ 6 secondes (enregistrement automatique) ou cliquer **« Enregistrer »** (Ctrl + S). Recharger avec F5.

✅ Progression « 6 sur 10 élèves notés · 2 absents · 1 dispensé » ; message « Enregistré à `<heure>` — 9 créée(s), 0 modifiée(s), 0 inchangée(s). » (TOURE Yao, vide, n'est pas écrit) ; chaque ligne « Enregistrée » ; après F5 tout est identique et le `0` de DIABATE Salimata reste un zéro, distinct d'une absence.

⚠️ *Test d'erreur* : `21` → « La note dépasse le barème (20,000). » (ou "(20)") ; `abc` → « Saisissez un nombre (par exemple 12,5) ou un code : ABS, ABJ, DISP, NN. » ; `12,255` → « Au plus 2 décimale(s). ». Tant qu'une ligne est invalide : "1 ligne invalide à corriger" et **rien n'est enregistré**. Effacer la saisie invalide.

☐ OK ☐ KO

---

### Étape 135 — Saisir l'interrogation sur 10 (bornes du barème)
👤 **enseignant** (secondaire-test) · fenêtre **B** · 📂 « Mes évaluations » > "Interrogation Mathématiques test guide" > **« Saisir les notes »**

1. Vérifier le badge « Sur 10 » et la colonne « Note (sur 10) ».
2. Saisir `11` pour DIABATE Nadia : « La note dépasse le barème (10,000). » ; corriger en `8`.
3. Saisir `7,5` pour COULIBALY Salimata, `3` pour DIABATE Salimata, `6` pour COULIBALY Moussa ; les autres restent vides.
4. Cliquer **« Enregistrer »**.

✅ « 4 sur 10 élèves notés » ; « Enregistré à `<heure>` — 4 créée(s), 0 modifiée(s), 0 inchangée(s). ».

⚠️ *Test d'erreur* : `10,01` → « La note dépasse le barème (10,000). » ; `10` (note maximale) est accepté. Remettre `8` avant d'enregistrer.

☐ OK ☐ KO

---

### Étape 136 — Feuille vide refusée, annuler un doublon
👤 **enseignant** (secondaire-test) · fenêtre **B** · 📂 « Mes évaluations » > "Devoir commun test guide" de l'**Anglais** > « Saisir les notes »

1. Sans rien saisir, cliquer **« Soumettre la feuille »**.
2. Cliquer **« Annuler l'évaluation »** ; dans la fenêtre du même nom, « Motif de l'annulation » = `Doublon, feuille créée par erreur (test guide)`, puis **« Annuler l'évaluation »**.

✅ Étape 1 : "Une évaluation sans aucune note ne peut pas être soumise." (reste « Brouillon »). Étape 2 : « L'évaluation est annulée. », badge « Annulée », feuille non modifiable.

⚠️ *Test d'erreur* : motif `abc` → « Le motif doit comporter au moins 10 caractères. ».

☐ OK ☐ KO

---

### Étape 137 — Saisir et soumettre les trois feuilles
👤 **enseignant** (secondaire-test) · fenêtre **B** · 📂 « Mes évaluations »

1. "Devoir commun test guide" (**Français**) > « Saisir les notes » : `11` pour ADOU Aïcha, `13` pour COULIBALY Moussa, `9,5` pour TOURE Yao ; **« Enregistrer »** ; **« Soumettre la feuille »**.
2. "Devoir n°1 Mathématiques test guide" > **« Soumettre la feuille »**.
3. "Interrogation Mathématiques test guide" > **« Soumettre la feuille »**.
4. Revenir sur la feuille du Devoir n°1.

✅ « La feuille de notes est soumise. » ; état « Soumise » ; message « La feuille est soumise au circuit de validation : elle n'est plus modifiable. » ; cellules en lecture seule. Les élèves restés vides passent à « Non évalué » (TOURE Yao au devoir n°1 ; les 6 autres à l'interrogation). L'historique gagne "Brouillon → Soumise".

⚠️ *Écart connu* : un double-clic sur « Soumettre la feuille » affiche "L'évaluation a été modifiée entre-temps : rechargez-la." alors que la première requête a réussi.

☐ OK ☐ KO

---

### Étape 138 — Relire : renvoyer en brouillon, marquer comme relue
👤 **responsable pédagogique** (secondaire-test) · fenêtre **A** · `pedagogie@secondaire-test.test` (MFA) · 📂 Menu "ÉVALUATIONS" > "Feuilles à relire" (`/v2/assessments?status=SUBMITTED`)

1. Lire la liste (filtrée sur « Soumise ») : 3 lignes, les deux évaluations de Mathématiques et "Devoir commun test guide" (Français).
2. Ouvrir "Devoir commun test guide" (Français) ; le compte voit « Voir les notes », pas « Saisir les notes ». Cliquer **« Renvoyer en brouillon »**.
3. Saisir « Commentaire » = `ok` puis valider.
4. Saisir « Commentaire » = `Barème à revoir pour l'exercice 3 (test guide)` puis valider.
5. Ouvrir "Devoir n°1 Mathématiques test guide", cliquer **« Marquer comme relue »** ; idem pour "Interrogation Mathématiques test guide".

✅ Étape 3 : « Le motif doit comporter au moins 5 caractères. ». Étape 4 : « La feuille est renvoyée en brouillon. » (historique "Soumise → Brouillon" avec le commentaire). Étape 5 : « La feuille de notes est relue. », état « Relue », historique "Soumise → Relue".

🔒 *Test de droit* : en tant que responsable pédagogique, taper `/v2/assessments/new` → page « Accès refusé » (`/unauthorized`).

☐ OK ☐ KO

---

### Étape 139 — L'enseignant reprend la feuille renvoyée
👤 **enseignant** (secondaire-test) · fenêtre **B** · 📂 « Mes évaluations » > "Devoir commun test guide" (Français)

1. Lire l'avertissement « Renvoyée en brouillon : Barème à revoir pour l'exercice 3 (test guide) ».
2. Ouvrir la feuille, remplacer `13` par `13,5` pour COULIBALY Moussa, **« Enregistrer »** ("… 1 modifiée(s) …"), puis **« Soumettre la feuille »**.
3. Ouvrir "Devoir n°1 Mathématiques test guide" (état « Relue »), cliquer **« Renvoyer en brouillon »**, saisir `Essai de refus (test guide)` et valider.

✅ Étape 2 : « La feuille de notes est soumise. », état « Soumise » (cette feuille reste ainsi jusqu'à la phase suivante). Étape 3 : refus "Vous n'avez pas le droit d'effectuer cette étape du circuit de validation." ; la feuille reste « Relue ».

⚠️ *Écart connu* : le bouton « Renvoyer en brouillon » est proposé à l'enseignant sur une feuille déjà relue alors que le serveur le refuse.

☐ OK ☐ KO

---

### Étape 140 — Approuver les feuilles de Mathématiques
👤 **responsable pédagogique** (secondaire-test) · fenêtre **A** · 📂 Menu "ÉVALUATIONS" > "Feuilles à relire" > "Devoir n°1 Mathématiques test guide"

1. Cliquer **« Approuver »** ; lire la fenêtre « Approuver cette feuille de notes ? » (« Cette action est définitive : elle ne pourra pas être annulée depuis cet écran. »), cliquer **« Approuver la feuille »**.
2. Répéter pour "Interrogation Mathématiques test guide". **Ne pas** toucher à "Devoir commun test guide" (Français), qui doit rester « Soumise ».
3. Chercher le bouton « Publier les notes ».

✅ « La feuille de notes est approuvée. », état « Approuvée », historique "Relue → Approuvée". Le bouton « Publier les notes » **n'existe pas** pour ce compte. Le même compte a relu **puis** approuvé : accepté (la séparation ne vise que la personne qui a soumis).

⚠️ *Écart connu* : aucune fenêtre « Confirmez votre identité » à l'approbation ni à la publication ; seule la MFA de la connexion compte.

🔒 *Test de droit* : en tant que responsable pédagogique, taper `/v2/assessments/revisions` → « Accès refusé ».

☐ OK ☐ KO

---

### Étape 141 — Quatre yeux : le soumetteur ne relit pas sa feuille
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 Barre « Évaluations et notes » > « Nouvelle évaluation » (`/v2/assessments/new`)

*(« Se déconnecter » du responsable pédagogique, puis connexion.)*

1. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Type d'évaluation | `Devoir` |
| Intitulé | `Contrôle direction test guide` |
| Date de l'évaluation | `2026-10-08` |
| Classe / Cours / Période | `6e A` / `Anglais` / `Trimestre 3` |
| Enseignant | rechercher `TRAORE`, choisir TRAORE Kouadio |

2. **« Créer l'évaluation »**, puis **« Saisir les notes »** : `10` pour ADOU Aïcha, `12` pour DIABATE Nadia ; **« Enregistrer »** ; **« Soumettre la feuille »**.
3. Cliquer **« Marquer comme relue »** sur sa propre feuille.
4. Cliquer **« Annuler l'évaluation »**, motif `Essai quatre yeux terminé (test guide)`, valider.

✅ Étape 3 : refus "La personne qui a soumis la feuille ne peut pas la relire, l'approuver ni la publier." (état reste « Soumise »). Étape 4 : « L'évaluation est annulée. », état « Annulée ».

⚠️ *Test d'erreur* : « Enseignant » laissé vide → "Indiquez l'enseignant de l'évaluation.".

☐ OK ☐ KO

---

### Étape 142 — ⚠️ Irréversible : publier les notes de Mathématiques
👤 **directeur des études** (secondaire-test) · fenêtre **A** · `etudes@secondaire-test.test` (MFA) · 📂 Barre « Évaluations et notes » > « Évaluations » > "Devoir n°1 Mathématiques test guide"

*(« Se déconnecter » du directeur, puis connexion.)* Une note publiée ne se modifie plus que par une correction approuvée.

1. Statut « Approuvée » : cliquer **« Publier les notes »** ; la fenêtre « Publier les notes ? » rappelle que les notes deviennent immuables et déclenchent le recalcul. Cliquer **« Publier les notes »**.
2. Répéter pour "Interrogation Mathématiques test guide".
3. Sur le devoir n°1, **« Voir les notes »** puis **« Historique »** en face de DIABATE Nadia.

✅ « Les notes sont publiées. », état « Publiée ». Feuille en lecture seule ; ce compte voit « Historique » mais **pas** « Corriger ». La fenêtre « Historique de la note de DIABATE Nadia » : « Valeur actuelle : 18 », circuit Brouillon → Publiée daté, « Aucune correction. ». Le calcul des résultats suit **10 à 30 secondes** plus tard.

⚠️ *Écart connu* : l'auteur d'une étape du circuit peut s'afficher par identifiant (« Par pedagogie »).

☐ OK ☐ KO

---

### Étape 143 — Demander la correction de deux notes publiées
👤 **enseignant** (secondaire-test) · fenêtre **B** · 📂 « Mes évaluations » > "Devoir n°1 Mathématiques test guide" > **« Voir les notes »**

1. Le message « Notes publiées : … » s'affiche ; chaque ligne notée propose **« Corriger »**. Cliquer **« Corriger »** en face de ASSI Brice (« Valeur publiée : 9,5 »).
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Nouvelle valeur | `10,5` |
| Motif de la correction | `Erreur de report de la copie n°4 (test guide)` |

3. Cliquer **« Envoyer la demande »**.
4. Recommencer pour DIABATE Salimata : « Nouvelle valeur » = `20`, « Motif de la correction » = `Demande volontairement discutable (test guide)`.
5. Ouvrir « Corrections de notes » (`/v2/assessments/revisions`) : le compte n'a **aucun** bouton d'approbation.

✅ « La demande de correction est envoyée pour approbation. » ; deux demandes « Demandée ».

⚠️ *Test d'erreur* : « Nouvelle valeur » `abc` ou `25` → « Valeur invalide : une note entre 0 et 20, ou un code d'état. » ; motif de 4 caractères → « Le motif doit faire au moins 10 caractères. » ; une seconde demande sur ASSI Brice → "Une demande de correction est déjà en cours pour cette note."

☐ OK ☐ KO

---

### Étape 144 — Approuver une correction, en rejeter une autre
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 Barre « Évaluations et notes » > « Corrections de notes » (`/v2/assessments/revisions`)

*(La décision est prise par une autre personne que le demandeur : c'est le second regard.)*

1. Pour ASSI Brice ("9,5 → 10,5"), cliquer **« Approuver »** ; « Commentaire (facultatif) » = `Copie vérifiée (test guide)`, **« Approuver »**.
2. Pour DIABATE Salimata, cliquer **« Rejeter »** ; « Motif du rejet » = `Copie non retrouvée, correction injustifiée (test guide)`, **« Rejeter »**.
3. Choisir « État » = « Tous les états », puis revenir sur la feuille du devoir n°1 et ouvrir **« Historique »** de ASSI Brice.

✅ « Correction approuvée et appliquée. » (carte « Appliquée », « Décidée par `<nom>` le `<date>` — Copie vérifiée (test guide) ») ; « La demande de correction est rejetée. » (carte « Rejetée »). La feuille montre `10,5` pour ASSI Brice et toujours `0` pour DIABATE Salimata. L'historique de ASSI Brice : « Valeur actuelle : 10,5 », "9,5 → 10,5".

⚠️ *Test d'erreur* : rejet avec un motif de 2 caractères → « Le motif doit comporter au moins 5 caractères. ».

🔒 *Test de droit* : en tant que directeur des études, taper `/v2/teacher/assessments/new` → « Accès refusé » (il crée par `/v2/assessments/new`).

☐ OK ☐ KO

---

### Étape 145 — Ce que voit l'élève
👤 **élève** (secondaire-test) · fenêtre **B** · `eleve@secondaire-test.test` (DIABATE Nadia, pas de MFA) · 📂 Menu "Mes résultats" (`/v2/student/results`)

*(« Se déconnecter » de l'enseignant, puis connexion.)*

1. Descendre à « Notes des évaluations ».
2. Lire les lignes "Devoir n°1 Mathématiques test guide" et "Interrogation Mathématiques test guide".
3. Chercher une ligne "Devoir commun test guide".

✅ Devoir n°1 : `18 / 20` ; Interrogation : `8 / 10` (poids 1 et 2). Aucun "Devoir commun test guide" (feuille seulement « Soumise »). Les types masqués (« Examen blanc ») ne sont jamais visibles.

🔒 *Test de droit* : en tant qu'élève, taper `/v2/teacher/assessments` → « Accès refusé ».

☐ OK ☐ KO

---

📚 *Pour aller plus loin* : chapitre 08, scénarios 8.3 (cas invalides du type), 8.17 (primaire et supérieur, session de rattrapage), 8.18 (clavier, réseau coupé, période verrouillée), 8.19 (droits refusés et isolation entre établissements).

**Ce que la phase laisse dans l'application :**
- "Devoir n°1 Mathématiques test guide" (6e A, Mathématiques, Trimestre 3, sur 20, coef. 1) : **Publiée** ; 10 lignes (6 notées, 2 absents, 1 dispensé, 1 non évalué) ; ASSI Brice corrigé de `9,5` à `10,5`, DIABATE Salimata toujours `0`.
- "Interrogation Mathématiques test guide" (sur 10, coef. 2) : **Publiée** ; 4 notes (Nadia 8, COULIBALY Salimata 7,5, DIABATE Salimata 3, COULIBALY Moussa 6).
- "Devoir commun test guide" (Français) : **Soumise**, laissée en l'état (la phase suivante en a besoin) ; "Devoir commun test guide" (Anglais) et "Contrôle direction test guide" : **Annulées**.
- Type "Quiz test guide" (`TG_QUIZ`) inactif ; demande de correction ASSI Brice **Appliquée**, demande DIABATE Salimata **Rejetée**.

---

## Phase 9 — Règles, résultats et bulletins

Le directeur lit les règles de démonstration, on contrôle les résultats de la 6e A (valeurs de référence du Trimestre 1, puis Trimestre 3 provisoire), on utilise une dérogation à deux personnes, puis le Trimestre 3 est délibéré et clôturé. La seconde moitié configure l'identité des documents, contrôle les bulletins, les vérifie publiquement par code, et se termine par la réémission, le retrait et la révocation du seul bulletin de TOURE Jean-Marc.

Précondition : la phase précédente est faite, **sans** avoir touché au Trimestre 1 ni au Trimestre 2 de la 6e A. Les règles de ce guide sont des **règles de démonstration** (fictives), sans valeur officielle. Les PDF exigent le worker de fond (Chrome) : si tous restent « PDF en attente » ou « PDF en échec », arrêter les étapes de bulletins et prévenir l'équipe technique.

---

### Étape 146 — Parcourir le catalogue des règles
👤 **directeur** (secondaire-test) · fenêtre **A** · `directeur@secondaire-test.test` (MFA) · 📂 Menu "RÈGLES DE CALCUL" > "Règles de calcul" (`/v2/rules`)

1. Lire le titre « Règles de calcul ». Taper `PLACEHOLDER` dans « Rechercher un jeu de règles » : restent le primaire, le secondaire et "Examens nationaux" ; vider le champ.
2. Choisir « Origine » = « National », puis « Établissement », puis « Toutes les origines ».
3. Dans la carte "Secondaire — jeu de démonstration (fictif)", lire le code `CI-SECONDARY-PLACEHOLDER`, les badges « National » et « Lecture seule » et le tableau des versions.

✅ 6 jeux nationaux ; le secondaire a « Version 1 » (contrat `coef-semester@1`) et « Version 2 » (contrat `secondary-annual@1`), toutes « Publiée » ; avec « Établissement » : « Aucun jeu de règles. » et « Modifiez la recherche ou le filtre. ».

⚠️ *Test d'erreur* : recherche `zzz` → « Aucun jeu de règles. ».

⚠️ *Écart connu* : aucun bandeau « Règles de démonstration » sur cet écran ; seul le nom "(fictif)" prévient.

☐ OK ☐ KO

---

### Étape 147 — Lire une version et tester une règle
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 `/v2/rules` > carte du jeu secondaire > **« Ouvrir »** sur la « Version 2 »

1. Lire `CI-SECONDARY-PLACEHOLDER · version 2` et « Version nationale : en lecture seule. Créez une variante de l'établissement pour adapter des paramètres ou des expressions. ».
2. Onglet « Règles » : 11 règles (`moyenne_matiere`, `moyenne_ponderee`, … `rang`). Ouvrir `mention` : paramètres `excellent` 16, `tres_bien` 14, `bien` 12, `assez_bien` 10, `passable` 8.
3. Cliquer **« Valider la version »**.
4. Sur `moyenne_ponderee`, cliquer **« Tester »** ; dans « Variables (JSON) » saisir :
   ```
   {"matieres":[{"score":"12","coef":"3"},{"score":"14","coef":"2"}]}
   ```
   puis **« Évaluer »**. Refaire avec `{"matieres":[{"score":null,"coef":"3"},{"score":"14","coef":"2"}]}`.
5. Sur `mention`, « Tester » avec `{"moyenne":"14"}`, puis `{"moyenne":null}`.

✅ Étape 3 : « La version est valide : toutes les expressions compilent et respectent le contrat. ». Étape 4 : "Valeur : 12.8" (car (12×3 + 14×2) ÷ 5), puis `14` (la matière sans note est **ignorée**, jamais comptée zéro), avec la « Trace d'évaluation ». Étape 5 : `VERY_GOOD` pour 14, `PENDING` sans moyenne.

⚠️ *Test d'erreur* : Variables `abc` ou `[]` → « Saisissez un objet JSON valide. ».

☐ OK ☐ KO

---

### Étape 148 — Liaisons : lire, ajouter, supprimer
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 Onglet « Liaisons aux programmes » (`/v2/rules/bindings`)

1. Lire la section du contrat `secondary-annual@1` : `CI-SECONDARY-PLACEHOLDER` pour « Niveau : LOWER_SECONDARY » et « Niveau : UPPER_SECONDARY », badge « En vigueur ». Les autres contrats : « Aucune liaison pour ce contrat. ».
2. Cliquer **« Ajouter une liaison »** et saisir (niveau fictif, sans effet sur la 6e A) :

| Champ | Valeur |
| :--- | :--- |
| Contrat de calcul | `Matières à coefficients (coef-semester@1)` |
| Jeu de règles | `Pile classique — moyennes pondérées, mentions, décisions (CI-CLASSIC-SEMESTRE)` |
| Périmètre | « Un niveau » |
| Code du niveau | `TG-NIVEAU` |
| En vigueur à partir du | `2030-09-01` |
| Jusqu'au (inclus) | *(vide)* |

3. **« Enregistrer »**. Sur la ligne (badge « À venir »), **« Modifier »** : « Jusqu'au (inclus) » = `2030-12-31`, **« Enregistrer »**.
4. **« Supprimer »** puis, dans « Supprimer cette liaison ? », **« Supprimer la liaison »**.

✅ « La liaison est créée. » ; « La liaison est enregistrée. » ; « La liaison est supprimée. » ; les résultats existants ne changent pas.

⚠️ *Test d'erreur* : « Un niveau » sans code → « Saisissez le code du niveau. » ; « En vigueur à partir du » vide → « Date attendue au format AAAA-MM-JJ. ».

⚠️ *Écart connu* : le niveau s'affiche en code brut (`LOWER_SECONDARY`).

☐ OK ☐ KO

---

### Étape 149 — État d'une période clôturée (Trimestre 1)
👤 **directeur des études** (secondaire-test) · fenêtre **A** · `etudes@secondaire-test.test` (MFA) · 📂 Menu "RÉSULTATS" > "Périodes : verrouillage et clôture" (`/v2/results`)

*(« Se déconnecter » du directeur, puis connexion.)*

1. Dans « Classe et période » : « Classe » = `6e A`, « Période » = `Trimestre 1`.
2. Lire « État de la période » : badge « Clôturée », « Règle appliquée » `CI-SECONDARY-PLACEHOLDER · v2`, dates « Notes verrouillées le » et « Clôturée le » (« Délibérée le » vide), puis « Résultats de la classe » et la section « Clôtures ».

✅ « Définitifs » = nombre de résultats figés (9 ou 10), « Provisoires » 0, « En erreur » 0 ; ligne « Version 1 — N résultats figés le `<date>` ». **Aucun** bouton « Verrouiller les notes », « Clôturer la période », « Relancer le calcul » ni « Rouvrir la période ».

⚠️ *Test d'erreur* : sans classe ni période → « Choisissez une classe et une période pour voir son état. ».

⚠️ *Écart connu* : dans « Années et périodes » le Trimestre 1 peut apparaître « Ouverte » (état calendaire), ce qui n'est pas contradictoire.

☐ OK ☐ KO

---

### Étape 150 — Lire la matrice des résultats de la 6e A (Trimestre 1)
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 Barre « Résultats » > « Résultats de classe » (`/v2/results/matrix`)

1. Choisir `6e A` et `Trimestre 1` ; lire le badge « Clôturée » et « Règle CI-SECONDARY-PLACEHOLDER v2 — version des résultats 1 ».
2. Comparer le tableau « Résultats des élèves de la classe » (colonnes « Élève », « Moyenne », « Rang », « Mention », « Décision », « État ») aux valeurs de référence :

| Élève | Moyenne | Rang | Mention | Décision |
| :--- | :-: | :-: | :--- | :--- |
| TOURE Yao | 13,5 | 1 | Bien | Periode validee |
| DIABATE Nadia | 13,2 | 2 | Bien | Periode validee |
| COULIBALY Moussa | 12,95 | 3 | Bien | Periode validee |
| BAMBA Fatou | 12,7 | 4 | Bien | Periode validee |
| BAMBA Aya | 12,1 | 5 | Bien | Periode validee |
| DIABATE Salimata | 11,85 | 6 | Assez bien | Periode validee |
| COULIBALY Salimata | 11,6 | 7 | Assez bien | Periode validee |
| TOURE Jean-Marc | 10,5 | 8 | Assez bien | Periode validee |
| ADOU Aïcha, ASSI Brice | — | — | En attente | Notes incompletes |

3. Survoler la moyenne de TOURE Yao : « Valeur exacte : 13,5 ». Passer « Ordre d'affichage » à « Par rang » (TOURE Yao en tête, « 1 sur 8 »).
4. Cocher **« Afficher le détail par cours »** : pour BAMBA Aya, Français 11,25, Mathématiques 11,75, Anglais 12,75, Histoire-Géographie 13,25.
5. Choisir `Trimestre 2` : badge « Notes verrouillées », résultats « Provisoire » avec « Des résultats sont provisoires : ils deviennent officiels à la clôture de la période. ». Moyennes : TOURE Yao 13,9 (rang 1), BAMBA Aya 13,4, COULIBALY Salimata 13,3, TOURE Jean-Marc 12,9, DIABATE Salimata 12,8, BAMBA Fatou 12,4, COULIBALY Moussa 10,4, DIABATE Nadia 9,9. Ne rien modifier sur le Trimestre 2.

✅ Toutes les valeurs correspondent (au zéro final près : `13,2` ou `13,20`) ; badge d'état « Définitif » au Trimestre 1 ; **les moyennes ne sont pas modifiables**. Rang présenté « `<rang>` sur 8 ».

⚠️ *Test d'erreur* : sans sélection → « Choisissez une classe et une période. ».

⚠️ *Écart connu* : libellés de décision sans accents ("Periode validee") ; le menu « Résultats de classe » peut mener à l'écran des périodes et non à la matrice.

☐ OK ☐ KO

---

### Étape 151 — "Pourquoi cette moyenne ?" et résultat annuel
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 Matrice du Trimestre 1 > **« Pourquoi ? »** sur la ligne de BAMBA Aya (`/v2/results/<identifiant>/explain`)

1. Lire « Pourquoi ce résultat ? » : « Résultat définitif : trace enregistrée lors de la clôture. », bloc « Résultat » (« Règle appliquée », « Contrat » `secondary-annual@1`, « Empreinte de la règle », « Moyenne »).
2. Déplier la ligne « Période » : étape `moyenne_ponderee` valeur 12.1 ; ouvrir "Contexte de l'appel" (liste `matieres` avec `score` et `coef`) et "Pas de calcul" (`wavg(matieres.score, matieres.coef)`). Cliquer **« Retour aux résultats »**.
3. Sur la même ligne, cliquer **« Année »** (`/v2/results/year/<inscription>/<année>`).

✅ (11,25×3 + 11,75×3 + 12,75×2 + 13,25×2) ÷ 10 = 12,1, identique à la matrice. Résultat annuel : « Résultat incomplet : une ou plusieurs périodes ne sont pas clôturées. » et « Périodes manquantes : Trimestre 2, Trimestre 3. » ; Trimestre 1 « Définitif » (12,1), les autres « Provisoire ».

☐ OK ☐ KO

---

### Étape 152 — Résultats provisoires du Trimestre 3 et relance du calcul
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 `/v2/results` puis `/v2/results/matrix` (`6e A` / `Trimestre 3`)

Attendre au moins 30 secondes après la publication de la phase précédente.

1. `/v2/results` > `6e A` > `Trimestre 3` : état « Ouverte », « Provisoires » = nombre d'élèves, « Définitifs » 0 ; section « Évaluations non publiées » : "1 évaluation n'est pas encore publiée" (lien "Devoir commun test guide").
2. Cliquer **« Relancer le calcul »** ; « Le calcul est relancé. » ; attendre quelques secondes.
3. Ouvrir la matrice du Trimestre 3 et comparer :

| Élève | Calcul | Moyenne | Rang | Mention | Décision |
| :--- | :--- | :-: | :-: | :--- | :--- |
| DIABATE Nadia | (18×1 + 16×2) ÷ 3 | 16,67 | 1 sur 6 | Excellent | Periode validee |
| COULIBALY Salimata | (16×1 + 15×2) ÷ 3 | 15,33 | 2 | Très bien | Periode validee |
| ADOU Aïcha | 14 | 14 | 3 | Très bien | Periode validee |
| COULIBALY Moussa | (12,5×1 + 12×2) ÷ 3 | 12,17 | 4 | Bien | Periode validee |
| ASSI Brice | 10,5 (après correction) | 10,5 | 5 | Assez bien | Periode validee |
| DIABATE Salimata | (0×1 + 6×2) ÷ 3 | 4 | 6 | Insuffisant | Periode non validee |
| BAMBA Aya, BAMBA Fatou, TOURE Jean-Marc, TOURE Yao | absent / dispensé / non évalué | — | — | En attente | Notes incompletes |

✅ Résultats « Provisoire », badge de période « Ouverte ». Une absence, une dispense, un "non évalué" **ne comptent pas comme zéro** ; seule DIABATE Salimata (vrai `0`) est pénalisée.

⚠️ *Écart connu* : avant la première publication, la page de période peut afficher « État de la période introuvable (…) » ; l'état "SUBMITTED" et les demandes de recalcul s'affichent en code brut ("DONE").

☐ OK ☐ KO

---

### Étape 153 — Demander une surcharge (dérogation)
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 Barre « Résultats » > « Surcharges » (`/v2/results/overrides`)

La surcharge est la seule voie manuelle sur un résultat calculé : justifiée, approuvée par **une autre personne**. Les notes ne sont jamais modifiées.

1. Choisir `6e A` et `Trimestre 3`, cliquer **« Demander une surcharge »**.
2. Saisir (attention : « Niveau » vaut par défaut « Unité d'enseignement ») :

| Champ | Valeur |
| :--- | :--- |
| Élève | `COULIBALY Moussa` |
| Niveau | « Période » |
| Cours | *(vide)* |
| Règle ciblée | `moyenne_ponderee` |
| Nature | « Valeur imposée » |
| Valeur imposée | `14,5` |
| Justification | `Erreur de report constatée sur la copie de l'interrogation, valeur corrigée par la direction (test guide)` |

3. Cliquer **« Envoyer la demande »**. Chercher un bouton « Approuver ».
4. Refaire une demande pour DIABATE Salimata : « Niveau » « Période », règle `moyenne_ponderee`, « Valeur imposée » `5`, justification `Essai de rejet par la direction (test guide, valeur de 5)`.

✅ « La demande de surcharge est enregistrée ; elle doit être approuvée par une autre personne. » ; carte « Surcharge pour COULIBALY Moussa » : `moyenne_ponderee`, « Période », « Demandée », `12,17 → 14,5`. Ce compte n'a **pas** de bouton « Approuver », « Rejeter » ni « Révoquer ».

⚠️ *Test d'erreur* : justification de 10 caractères → « Le motif doit faire au moins 20 caractères. » ; valeur imposée vide → "Une surcharge de valeur exige la valeur imposée." ; « Niveau » « Unité d'enseignement » avec `moyenne_ponderee` → refus du serveur *(message à relever)*.

☐ OK ☐ KO

---

### Étape 154 — Approuver, constater, révoquer, rejeter
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 Barre « Résultats » > « Surcharges » (`6e A` / `Trimestre 3`)

*(« Se déconnecter » du directeur des études, puis connexion en directeur.)*

1. Sur la carte de COULIBALY Moussa, cliquer **« Approuver »**, commentaire `Vérifié (test guide)`, **« Approuver »**.
2. Attendre 30 secondes, ouvrir la matrice du Trimestre 3 puis **« Pourquoi ? »** sur COULIBALY Moussa.
3. Revenir à « Surcharges », **« Révoquer »** : « Motif de la révocation » = `Retour à la valeur calculée (test guide)`, **« Révoquer »**. Attendre 30 secondes et relire la matrice.
4. Sur la carte de DIABATE Salimata, cliquer **« Rejeter »** : « Motif du rejet » = `Pas de justification suffisante (test guide)`, **« Rejeter »**.

✅ « La surcharge est approuvée. » ; matrice : COULIBALY Moussa 14,5, rang 3 (devant ADOU Aïcha, devenue 4), mention « Très bien » ; « Pourquoi ce résultat ? » indique « Surchargée » et « Valeur imposée par une surcharge approuvée (valeur calculée : 12.16666… ). ». Après révocation (« La surcharge est révoquée. ») : retour à 12,17, Bien, rang 4. « La surcharge est rejetée. » pour Salimata (sa moyenne reste 4).

⚠️ *Test d'erreur* : rejet avec 2 caractères → « Le motif doit comporter au moins 5 caractères. ».

☐ OK ☐ KO

---

### Étape 155 — Décisions : retenir une autre décision avec motif
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 Barre « Résultats » > « Décisions et délibérations » (`/v2/results/decisions`)

*(Reconnexion en directeur des études.)*

1. Choisir `6e A`, `Trimestre 1` : onglet « Décisions », tableau « Décisions des élèves » : décisions déjà « Confirmée », sans bouton « Confirmer » (clôture sans délibération).
2. Choisir `Trimestre 3`. Sur DIABATE Salimata, cliquer **« Confirmer »** : « Proposition de la règle : Periode non validee ».
3. Cocher **« Retenir une autre décision »** ; « Décision retenue » = `Renforcement recommande`, « Motif de la décision » = `Élève en progrès constaté sur le dernier devoir (test guide)` ; **« Confirmer la décision »**.

✅ « La décision est confirmée. » ; « Décision retenue » montre le nouveau libellé avec le motif, « Proposée par la règle » **conserve** "Periode non validee".

⚠️ *Test d'erreur* : motif de 10 caractères → « Le motif doit faire au moins 20 caractères. » ; « Retenir une autre décision » sans choix → « Choisissez la décision retenue. ».

⚠️ *Écart connu* : la colonne « Nature » affiche des codes bruts (`COUNCIL`, `YEAR_END`). Si aucune décision n'est « Proposée » : « Aucune décision. » *(à vérifier : les décisions du Trimestre 3 sont proposées dès le calcul)*.

☐ OK ☐ KO

---

### Étape 156 — Délibération tenue et appréciation
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 `/v2/results/decisions` > onglets « Délibérations » puis « Appréciations » (`6e A` / `Trimestre 3`)

1. Onglet « Délibérations » > **« Planifier une délibération »** : « Nature » = « Conseil de classe », « Date de la séance » = `2026-10-08`, « Participant 1 » = rechercher `TRAORE` (TRAORE Kouadio), « Rôle 1 » = `Président` ; **« Planifier »**.
2. Sur la séance, cliquer **« Marquer comme tenue »**.
3. Onglet « Appréciations » > **« Rédiger une appréciation »** : « Élève » = `DIABATE Nadia`, « Auteur » = « Conseil de classe », « Appréciation » = `Excellent travail, à poursuivre (test guide)` ; **« Enregistrer l'appréciation »**.

✅ « La délibération est planifiée. » (badge « Planifiée ») ; « La séance est marquée comme tenue. » (badge « Tenue ») ; « L'appréciation est enregistrée. » et ligne "DIABATE Nadia · Conseil de classe".

⚠️ *Test d'erreur* : appréciation vide → « Ce champ est obligatoire. ».

☐ OK ☐ KO

---

### Étape 157 — Verrouiller les notes du Trimestre 3 : refus, puis forçage motivé
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 `/v2/results` > `6e A` > `Trimestre 3`

Le "Devoir commun test guide" (Français) est toujours « Soumise ». Le verrouillage fige les saisies de la période.

1. Cliquer **« Verrouiller les notes »** : la fenêtre signale « 1 évaluation n'est pas publiée : leurs notes ne seront pas prises en compte. ». Sans cocher la case, cliquer **« Verrouiller »**.
2. Cocher **« Verrouiller malgré les évaluations non publiées »**, « Motif du verrouillage forcé » = `Court`, **« Verrouiller »**.
3. Saisir `Évaluation de test non finalisée (test guide)` et **« Verrouiller »**.

✅ Étape 1 : "Des évaluations de cette classe et de cette période ne sont pas publiées : publiez-les ou forcez le verrouillage avec un motif." Étape 2 : « Le motif doit faire au moins 10 caractères. ». Étape 3 : « Les notes de la période sont verrouillées. », état « Notes verrouillées » ; les actions proposées sont « Enregistrer la délibération », « Clôturer la période » et « Relancer le calcul ».

☐ OK ☐ KO

---

### Étape 158 — ⚠️ Irréversible : délibérer et clôturer le Trimestre 3
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 `/v2/results` > `6e A` > `Trimestre 3`

Les résultats deviennent définitifs ; seule la réouverture motivée (étape suivante) les change.

1. Cliquer **« Enregistrer la délibération »**, cocher « Confirmer d'un coup les décisions proposées par les règles », cliquer **« Enregistrer la délibération »**.
2. Cliquer **« Clôturer la période »** : lire « Les résultats deviennent définitifs. Pour les corriger plus tard, il faudra rouvrir la période avec un motif (nouvelle version des résultats). », cliquer **« Clôturer »**.
3. Ouvrir la matrice du Trimestre 3.

✅ « La délibération est enregistrée. », état « Délibérée » ; « Période clôturée : N résultats figés (version 1), aucune exclusion. » ; état « Clôturée », section « Clôtures » « Version 1 — N résultats figés le `<date>` » ; matrice « Définitif », mêmes valeurs que le tableau du Trimestre 3. Plus de bouton « Relancer le calcul ». « Année » de BAMBA Aya : « Périodes manquantes : Trimestre 2. ».

⚠️ *Test d'erreur* : toute nouvelle surcharge sur ce trimestre → "La période est clôturée : rouvrez-la pour surcharger un résultat."

☐ OK ☐ KO

---

### Étape 159 — Rouvrir le Trimestre 3 puis le reclôturer (facultatif)
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 `/v2/results` > `6e A` > `Trimestre 3`

Acte sensible : ne le faire **que** sur le Trimestre 3, jamais sur le Trimestre 1.

1. Cliquer **« Rouvrir la période »** : « Nature de la réouverture » = « Correction (toutes les notes redeviennent modifiables) ». Motif `Test`, valider ; puis `Réouverture d'essai du guide de test`, valider.
2. *(Reconnexion en directeur des études.)* Ouvrir "Devoir commun test guide" (Français), **« Annuler l'évaluation »**, motif `Évaluation de test abandonnée (test guide)`.
3. Toujours en directeur des études, `/v2/results` : **« Verrouiller les notes »** (sans avertissement), puis **« Clôturer la période »**.

✅ Motif `Test` → « Le motif doit faire au moins 10 caractères. » ; puis « La période est rouverte. », état « Ouverte », « Rouverte une fois. Dernier motif : Réouverture d'essai du guide de test ». Après reclôture : « Période clôturée : N résultats figés (version 2), aucune exclusion. » ; « Clôtures » liste « Version 1 » et « Version 2 » ; chiffres du Trimestre 3 inchangés.

🔒 *Test de droit* : le directeur des études n'a **pas** le bouton « Rouvrir la période ».

☐ OK ☐ KO

---

### Étape 160 — Identité de l'établissement
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 Menu "BULLETINS" > "Identité et signataires" (`/v2/reportcards/identity`)

*(« Se déconnecter » du directeur des études, puis connexion en directeur.)*

1. Lire « Identité de l'établissement et réglages » : "Version 1 enregistrée le …", « Nom officiel » Collège Le Baobab, « Couleur principale » `#14532D`.
2. Compléter :

| Champ | Valeur |
| :--- | :--- |
| Téléphone | `+225 27 21 00 00 00` |
| Adresse électronique | `contact@exemple.test` |
| Site internet | `www.exemple.test` |
| Référence d'agrément | `AGR-TG-0001` |
| Pied de page | `Document de démonstration test guide` |
| Logo | fichier `docs/guide-test/jeux-de-donnees/logo-test-guide.png` |

3. Après « Téléversement… » puis « Téléversé », cliquer **« Enregistrer l'identité »**.

✅ « L'identité est enregistrée (version 2). » ; "Version 2 enregistrée le …" ; le détail « 2 versions de l'identité » donne le badge « En vigueur » à la version 2 ; valeurs conservées après F5. Les bulletins déjà émis ne changent pas.

⚠️ *Test d'erreur* : « Nom officiel » vidé → « Ce champ est obligatoire. » ; « Couleur principale » `vert` → "Couleur attendue au format #RRGGBB." ; « Logo » = `docs/guide-test/jeux-de-donnees/format-invalide-test-guide.txt` → « Format non accepté : PNG, JPEG, WebP ou GIF. ».

⚠️ *Écart connu* : l'entrée de menu "Identité et signataires" mène à la page « Identité et réglages » ; les signataires sont une autre rubrique de la barre.

☐ OK ☐ KO

---

### Étape 161 — Créer un signataire
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 Rubrique « Signataires » (`/v2/reportcards/signatories`)

1. Lire la liste : "Directeur Fictif", badge « Actif », « aucune signature ».
2. Cliquer **« Nouveau signataire »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Nom complet | `KONÉ Mamadou test guide` |
| Qualité | `Le Directeur` |
| Fonction | `Chef d'établissement test guide` |
| Valide à partir du | `2026-09-01` |
| Valide jusqu'au | *(vide)* |
| Signature (image) | fichier `docs/guide-test/jeux-de-donnees/signature-test-guide.png` |

3. Cliquer **« Créer le signataire »**.
4. Sur sa ligne : **« Désactiver »**, puis **« Activer »**.

✅ « Le signataire KONÉ Mamadou test guide est enregistré. » ; ligne « Actif », "Le Directeur", « signature enregistrée » ; « Le signataire KONÉ Mamadou test guide est désactivé. » puis « Le signataire KONÉ Mamadou test guide est activé. » (état final **actif**).

⚠️ *Test d'erreur* : « Nom complet » `K` → "Au moins 2 caractères." ; « Valide jusqu'au » `2026-08-01` → "La fin de mandat précède son début." *(à relever)*.

☐ OK ☐ KO

---

### Étape 162 — Configurer le modèle de bulletin
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 Menu "BULLETINS" > "Modèles de documents" (`/v2/reportcards/templates`)

*(Reconnexion en directeur des études.)*

1. Lire « Configuration de l'établissement » : la carte « Bulletin » (badge « Secondaire », `secondary-bulletin`, « modèle v1, configuration v1 ») et la carte « Relevé de notes » (« Aucune configuration. »).
2. Sur « Bulletin », cliquer **« Aperçu »** : bulletin d'exemple, « Aperçu avec des données d'exemple ; rien n'est émis. ». Fermer.
3. Cliquer **« Configurer »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Niveau d'enseignement | `Secondaire` |
| Modèle | `Bulletin du secondaire (modèle générique)` |
| Options du modèle : `showClassAverage` | cochée |
| Signataires par emplacement : Le Directeur | `KONÉ Mamadou test guide — Le Directeur` |

4. Cliquer **« Enregistrer la configuration »**.

✅ « La configuration est enregistrée. » ; carte « Bulletin » : « modèle v1, configuration v2 ». Les bulletins déjà émis gardent leur configuration d'émission.

⚠️ *Écart connu* : les options du modèle générique s'affichent sous leur nom technique (`showRank`, `showClassAverage`…).

🔒 *Test de droit* : en tant que directeur des études, taper `/v2/reportcards/identity` puis `/v2/reportcards/signatories` → « Accès refusé ».

☐ OK ☐ KO

---

### Étape 163 — Liste des bulletins et filtres
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 Menu "BULLETINS" > "Bulletins — liste" (`/v2/reportcards`)

1. Dans « Classe et période » : « Classe » = `6e A`, « Période » = `Trimestre 1`.
2. Lire le tableau « Bulletins émis » : colonnes « Élève », « Document », « État », « PDF », « Actions ». Sur chaque ligne : "Version 1", « Publié », « PDF prêt », boutons « Télécharger », « Retirer », « Réémettre » (pas « Révoquer »). La case de sélection est désactivée.
3. Filtres : « État » = « Révoqué » ; puis « État » = « Publié » ; « Nature » = « Relevé de notes » ; « Nature » = « Bulletin » ; case « À réémettre » cochée. Remettre « Tous les états » et décocher « À réémettre ».

✅ 8 à 9 lignes (8 élèves notés, plus ADOU Aïcha d'après les rapports : *à relever*) ; « Révoqué », « Relevé de notes » et « À réémettre » donnent « Aucun bulletin. » et « Émettez les bulletins d'une classe dont la période est clôturée. » ; « Publié » et « Bulletin » donnent toutes les lignes.

☐ OK ☐ KO

---

### Étape 164 — Fiche d'un bulletin et PDF
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 `/v2/reportcards` > cliquer le nom "DIABATE Nadia" (`/v2/reportcards/<identifiant>`)

1. Lire « Contenu du bulletin » : « Classe » 6e A, « Période » Trimestre 1, « Moyenne » 13,2, « Rang », « Mention » Bien, « Règle appliquée » `CI-SECONDARY-PLACEHOLDER · v1 (résultats v…)`, « Modèle » `secondary-bulletin · v1`, « Signataires : Directeur Fictif (Le Directeur). » (le signataire figé à l'émission, pas KONÉ Mamadou test guide).
2. Section « Vérification d'authenticité » : lire le « Code de vérification » (26 caractères) et l'« Empreinte du document ». **Noter le code de Nadia** (pour la vérification publique).
3. Cliquer **« Télécharger le PDF »** (autoriser les fenêtres contextuelles si rien ne s'ouvre) et **enregistrer le PDF** sur le poste.
4. Contrôler le PDF : nom de l'établissement, "République de Côte d'Ivoire (démonstration)", couleur verte, moyenne et rang identiques à l'écran, signataire "Directeur Fictif", QR code et même code de vérification, **filigrane** "DÉMONSTRATION" et pied de page "Règles de démonstration — document sans valeur officielle".
5. Cliquer **« Afficher la trace »** dans « Trace d'explicabilité ».

✅ Les valeurs de la fiche viennent du bulletin figé (identiques à la matrice du Trimestre 1) ; le lien de téléchargement est "généré à la demande et valable 5 minutes" ; la trace s'affiche (codes de ligne techniques).

⚠️ *Test d'erreur* : `/v2/reportcards/01a11000-0000-7000-8000-000000000000` → erreur du type "Bulletin introuvable (…)" *(à relever)*.

☐ OK ☐ KO

---

### Étape 165 — Contrôle préalable et émission rejouée
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 Menu "BULLETINS" > "Bulletins — émission" (`/v2/reportcards/issue`)

1. Lire « Émettre les bulletins d'une classe » (« Choisissez une classe et une période. »). Choisir `6e A` / `Trimestre 1` : « Tout est prêt : vous pouvez générer les bulletins. ».
2. Cliquer **« Générer les bulletins »**. Section « Avancement du lot » : badge « Terminé ».
3. Cliquer **« Voir la liste des bulletins »**. **Ne pas** cliquer « Publier le lot aux familles ».
4. Revenir à « Émettre », choisir `Trimestre 2`.

✅ Étape 2 : "9 émis sur 9 — 0 exclus, 0 en échec." (chiffres à relever) : l'émission est idempotente. Étape 3 : toujours le même nombre de lignes « Publié » / « PDF prêt » / "Version 1", **aucun doublon**. Étape 4 : « Au moins un point bloquant empêche l'émission. », badge « Bloquant » "La période n'est pas clôturée pour cette classe : les bulletins définitifs s'émettent à partir de résultats clôturés." ; bouton « Générer les bulletins » **grisé**.

⚠️ *Test d'erreur* : cocher « Réémettre les bulletins dont les résultats ont changé », « Motif de la réémission » `abc` → « Le motif doit faire au moins 5 caractères. » (décocher ensuite).

⚠️ *Écart connu* : après un lot rejoué, l'avancement peut afficher « 0 PDF prêts sur 9 bulletins émis. » et le bouton « Relancer les PDF en échec », alors que tous les PDF sont prêts ; ne pas l'utiliser. Ne pas cocher « Bulletin provisoire » puis générer (irréversible).

☐ OK ☐ KO

---

### Étape 166 — Vérifier un bulletin authentique par son code
👤 **visiteur sans connexion** · fenêtre **B** (navigation privée, hors session) · `http://localhost:3000/v2/verify`

*(Si la fenêtre B est encore connectée, « Se déconnecter » d'abord.)*

1. Lire « Vérification d'un document » et « Vérification par code » : aucun menu ni connexion.
2. Saisir le code de Nadia en **minuscules**, avec un tiret et un espace au milieu, puis **« Vérifier »**.
3. Lire « Résultat de la vérification » ; déplier « Détails techniques ».
4. Essayer les formes `/v2/verify/<code>` et `/v2/verify?code=<code>`.

✅ Badge « Authentique », « Document authentique », phrase "Ce document a été calculé avec des règles de démonstration : il n'a aucune valeur officielle." ; « Établissement » Collège Le Baobab, « Nature du document » Bulletin, « Émis le … ». **Aucun** nom d'élève, note, matricule ni date de naissance. Les adresses directes donnent le même résultat.

*Facultatif* : en fenêtre **A**, directeur, cocher « Afficher la mention sur la page publique de vérification » dans `/v2/reportcards/identity` (« Réglage enregistré. »), relancer la vérification (une ligne « Mention » apparaît), puis **décocher**.

☐ OK ☐ KO

---

### Étape 167 — Codes inconnus ou mal formés
👤 **visiteur sans connexion** · fenêtre **B** · `/v2/verify`

1. Saisir successivement, puis **« Vérifier »** : `ABC123` ; `TESTGUIDEAAAAAAAAAAAAAAAAA` ; `<b>x</b>`.
2. Ouvrir directement `/v2/verify/ABC123`.

✅ Toujours le badge « Inconnu » et « Aucun document ne correspond à ce code. Vérifiez la saisie ; si le code est correct, le document n'est pas authentique. » (même réponse pour un code bien formé mais inexistant) ; aucun HTML interprété.

⚠️ *Écart connu* : champ vide puis « Vérifier » : aucun message.

☐ OK ☐ KO

---

### Étape 168 — Comparer un fichier PDF à l'original
👤 **visiteur sans connexion** · fenêtre **B** · `/v2/verify`, section « Comparer un fichier PDF »

1. Choisir le PDF de Nadia enregistré à l'étape *Fiche d'un bulletin et PDF*.
2. Choisir `docs/guide-test/jeux-de-donnees/pdf-etranger-test-guide.pdf`.
3. Choisir `docs/guide-test/jeux-de-donnees/format-invalide-test-guide.txt` ("Tous les fichiers" dans la fenêtre de sélection).

✅ Étape 1 : « Fichier identique », « Statut du document : Authentique. », établissement et intitulé. Étape 2 : « Fichier non reconnu » et "Ce fichier ne correspond à aucun original émis par un établissement." Étape 3 : « Le fichier doit être au format PDF. » (rien n'est envoyé).

☐ OK ☐ KO

---

### Étape 169 — Ce que voient les familles (élève)
👤 **élève** (secondaire-test) · fenêtre **B** · 📂 Rubrique « Mes bulletins » (`/v2/reportcards/family`)

*(Connexion en élève DIABATE Nadia.)*

1. Lire le titre « Bulletins » : **une seule** section "DIABATE Nadia", avec le titre du document, « Publié le … » et **« Télécharger »**.
2. Cliquer **« Télécharger »** : le PDF s'ouvre dans un nouvel onglet.

✅ Jamais d'autre élève ; note « Chaque téléchargement est journalisé ; le lien est valable 5 minutes. ». Un bulletin retiré, remplacé ou révoqué n'apparaît jamais.

🔒 *Test de droit* : en tant qu'élève, taper `/v2/reportcards` puis `/v2/reportcards/signatories` → « Accès refusé ».

☐ OK ☐ KO

---

### Étape 170 — ⚠️ Irréversible : réémettre le bulletin de TOURE Jean-Marc
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 `/v2/reportcards` (`6e A` / `Trimestre 1`)

*(Reconnexion en directeur des études.)* Seul le bulletin de TOURE Jean-Marc est sacrifié ; ne touchez pas à ceux de DIABATE Nadia et DIABATE Salimata.

1. Ouvrir la fiche de TOURE Jean-Marc, noter son **ancien code de vérification** et télécharger son PDF.
2. Dans la liste, sur sa ligne, cliquer **« Réémettre »** : lire « Une nouvelle version est créée ; l'ancienne reste consultable et sa vérification indique qu'elle est remplacée. ».
3. « Motif » = `abc`, valider ; puis « Motif » = `Correction test guide`, valider (une confirmation d'identité peut s'ouvrir).
4. Attendre « PDF prêt », puis cliquer **« Publier »** sur la ligne.
5. Décocher « Dernière version seulement ».
6. Ouvrir la fiche de la version 2 : noter le **nouveau code**. En fenêtre privée, vérifier l'ancien code, puis le nouveau.

✅ Étape 3 : « Le motif doit comporter au moins 5 caractères. » puis « Le bulletin de TOURE Jean-Marc est réémis. » ; ligne "Version 2", état « Émis », « PDF en attente » puis « PDF prêt ». Étape 4 : « Le bulletin de TOURE Jean-Marc est publié. ». Étape 5 : deux lignes ; la version 1 est « Remplacé », sans « Télécharger », « Publier » ni « Réémettre ». Version 2 : « Signataires : KONÉ Mamadou test guide (Le Directeur). », PDF avec le pied de page "Document de démonstration test guide". Vérification publique : ancien code « Remplacé » ("Document remplacé par une version plus récente"), nouveau code « Authentique ».

☐ OK ☐ KO

---

### Étape 171 — ⚠️ Irréversible : retirer la version 2 de TOURE Jean-Marc
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 `/v2/reportcards` (`6e A` / `Trimestre 1`)

1. Sur la ligne "Version 2" de TOURE Jean-Marc (« Publié »), cliquer **« Retirer »**.
2. Lire la ligne : badge, boutons proposés.
3. Cliquer une seconde fois **« Retirer »**.

✅ Étape 1 : « Le bulletin de TOURE Jean-Marc est retiré de la publication. ». Étape 3 : "Ce bulletin est déjà retiré." *(à relever)*. Aucun compte de famille n'est lié à ce bulletin.

⚠️ *Écart connu* : le serveur garde l'état « Publié » pour un bulletin retiré ; le badge reste « Publié », « Retirer » reste affiché et « Publier » n'apparaît pas. Consigner ce qui s'affiche ; ne **jamais** retirer le bulletin de DIABATE Salimata (sans retour possible).

☐ OK ☐ KO

---

### Étape 172 — ⚠️ Irréversible : révoquer la version 2 de TOURE Jean-Marc
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 `/v2/reportcards` (`6e A` / `Trimestre 1`)

*(« Se déconnecter » du directeur des études, puis connexion en directeur.)*

1. Sur la version 2 de TOURE Jean-Marc, cliquer **« Révoquer »** : lire « Le document disparaît du portail des familles et sa vérification publique indiquera qu'il est révoqué. Cette action est définitive. ».
2. Valider avec « Motif » vide ou `abc`.
3. Saisir « Motif » = `Révocation test guide`, puis **« Révoquer »**.
4. En fenêtre **B**, vérifier le code de la version 2, puis celui de la version 1.

✅ Étape 2 : « Le motif doit comporter au moins 5 caractères. » Étape 3 : « Le bulletin de TOURE Jean-Marc est révoqué. », badge « Révoqué », fiche "Ce bulletin a été révoqué le …", plus aucun bouton d'action. Vérification : version 2 « Révoqué » ("Document révoqué par l'établissement : il ne doit plus être considéré comme valable.") ; version 1 reste « Remplacé ».

🔒 *Test de droit* : le directeur des études n'a **pas** de bouton « Révoquer ».

☐ OK ☐ KO

---

📚 *Pour aller plus loin* : chapitre 09, scénarios 9.5 (variante d'établissement et simulation), 9.6 (éditeur d'expressions), 9.17 à 9.19 (supérieur, rattrapage, droits refusés) ; chapitre 10, scénarios 10.11 à 10.13 (primaire et supérieur), 10.17 (droits de chaque rôle), 10.18 (clavier, mobile).

**Ce que la phase laisse dans l'application :**
- Trimestre 3 de la 6e A : **clôturé** (version 1, ou version 2 si la réouverture facultative a été faite) ; "Devoir commun test guide" (Français) **Annulée** si la réouverture a été faite, sinon toujours « Soumise » ; décision de DIABATE Salimata retenue "Renforcement recommande" ; séance « Conseil de classe » **Tenue** ; appréciation de DIABATE Nadia ; surcharge de COULIBALY Moussa révoquée et surcharge de DIABATE Salimata rejetée ; Trimestre 1 et Trimestre 2 intacts.
- Identité du Collège Le Baobab en **version 2** (pied de page "Document de démonstration test guide", logo `logo-test-guide.png`) ; signataire "KONÉ Mamadou test guide" (actif) ; configuration « Bulletin » **v2**.
- Bulletin de TOURE Jean-Marc : version 1 « Remplacé », version 2 « Révoqué » ; les autres bulletins du Trimestre 1 (dont DIABATE Nadia et DIABATE Salimata) restent « Publié ».

---

## Phase 10 — Vie scolaire : de l'incident à l'information de la famille

Cette phase suit un fait de vie scolaire de bout en bout : l'enseignant signale, l'éducateur propose une mesure, la direction valide (jamais le proposant lui-même pour une exclusion), la famille est notifiée, peut déposer un recours et reçoit une convocation. La machine propose, une personne décide : rien ne change le statut d'un élève sans un acte humain.

Précondition : base de démonstration du Collège Le Baobab (`secondaire-test`), graine de vie scolaire non modifiée (incidents "Bavardage répété…" de DIABATE Salimata et "Retard à la reprise…" de BAMBA Fatou, avertissement de BAMBA Fatou validé, exclusions de TOURE Yao « Proposée » et de DIABATE Salimata « Validée »). Les types, gravités et barèmes sont des **données de démonstration** : aucune sanction officielle n'est livrée. Une note ou une mesure ne se supprime jamais (elle se retire, se rejette, s'annule ou se révoque) : pour repartir de zéro, réinitialiser la base.

### Étape 173 — Lire le tableau de bord de la vie scolaire
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 Menu **« Vie scolaire »** > **« Vie scolaire »** (`/v2/schoollife`)

Compte : `directeur@secondaire-test.test` (MFA : le code du moment est proposé sur la page de connexion).

Attendu au départ (base intacte) :

| Indicateur | Valeur |
| :--- | :-: |
| Incidents ouverts | 2 |
| Mesures à valider | 1 |
| Exclusions en cours | 0 (1 si le test a lieu un ou deux jours après la graine) |
| Convocations à tenir | 0 |
| Effets en attente d'une décision | 1 |

1. Lire les onglets en haut de page : **« Tableau de bord »**, **« Saisie rapide »**, **« Validations »**, **« Convocations »**, **« Paramètres »**.
2. Lire les listes **« Incidents ouverts »**, **« Mesures proposées »** et **« Convocations à venir »**.
3. Cliquer sur l'indicateur **« Mesures à valider »** (il mène à la page de validation), puis revenir en arrière.

✅ Les cinq indicateurs ci-dessus sont affichés. « Incidents ouverts » liste les deux incidents de la graine au statut « Déclaré » ; « Mesures proposées » liste l'exclusion de TOURE Yao ; « Convocations à venir » affiche « Aucune convocation à venir. ». Si la base n'est pas intacte, noter les valeurs réelles.

☐ OK ☐ KO

---

### Étape 174 — L'enseignant déclare un incident
👤 **enseignant** (secondaire-test) · fenêtre **B** · 📂 Menu du portail enseignant **« Saisie vie scolaire »** (`/v2/schoollife/saisie`)

Compte : `enseignant@secondaire-test.test` (TRAORE Kouadio, sans MFA).

1. Lire les trois cartes **« Déclarer un incident »**, **« Encourager un élève »**, **« Noter une observation »**. Cliquer sur **« Déclarer un incident »**.
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Classe | `6e A` |
| Élève | `COULIBALY Moussa` |
| Type | `Incident en classe (démonstration)` |
| Gravité | `Niveau 1 (démonstration)` |
| Date des faits | `08/10/2026` (J) |
| Heure des faits | `10:15` |
| Description des faits | `Incident test guide : bavardage pendant la composition` |
| Lieu | `Salle 6e A test guide` |
| Rôle de l'élève | `Auteur` |

3. Cliquer sur **« Déclarer l'incident »**.

✅ La fenêtre se ferme, message « Incident enregistré. ». Le déclarant est l'utilisateur connecté (aucun champ ne permet de le choisir). Avec le directeur, le tableau de bord affichera 3 incidents ouverts.

⚠️ *Test d'erreur* : description vide → « Ce champ est obligatoire. » ; description `abc` → "La description doit faire au moins 5 caractères."

🔒 *Test de droit* : en tant que **enseignant**, taper `/v2/schoollife` → « Accès refusé » ("Vous n'avez pas les droits nécessaires pour afficher cette page.").

☐ OK ☐ KO

---

### Étape 175 — L'éducateur encourage une élève et note une observation
👤 **éducateur** (secondaire-test) · fenêtre **B** (« Se déconnecter » de l'enseignant) · 📂 `/v2/schoollife/saisie`

Compte : `educateur@secondaire-test.test` (sans MFA). Aucune entrée de menu « Saisie rapide » pour ce rôle : passer par l'onglet **« Saisie rapide »** du tableau de bord (`/v2/schoollife`).

1. Cliquer sur **« Encourager un élève »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Classe | `6e A` |
| Élève | `DIABATE Nadia` |
| Type | `Encouragement (démonstration)` |
| Texte | `Encouragement test guide : très bonne participation en classe` |
| Date | `08/10/2026` |
| Visibilité | `Visible de l'élève et des parents` |

2. Cliquer sur **« Enregistrer »**.
3. Cliquer sur **« Noter une observation »** : classe `6e A`, élève `COULIBALY Salimata`, type `Observation (démonstration)`, texte `Observation test guide : a besoin d'un suivi en lecture`, date `08/10/2026`, visibilité **Personnel seulement** (valeur par défaut). **« Enregistrer »**.

✅ « Encouragement enregistré. » puis « Observation enregistrée. ». L'encouragement de Nadia sera lu par le parent et l'élève plus loin ; l'observation reste invisible des familles.

⚠️ *Test d'erreur* : texte vide → « Ce champ est obligatoire. » sous « Texte ».

🔒 *Test de droit* : en tant qu'**éducateur**, taper `/v2/schoollife/validations` → « Accès refusé ».

☐ OK ☐ KO

---

### Étape 176 — L'éducateur propose une exclusion (il ne la valide pas)
👤 **éducateur** (secondaire-test) · fenêtre **B** · 📂 `/v2/schoollife/saisie` puis `/v2/schoollife`

1. Déclarer un incident (comme à l'étape *L'enseignant déclare un incident*) pour **TOURE Jean-Marc**, classe `6e A` : type `Incident en classe (démonstration)`, gravité `Niveau 2 (démonstration)`, date `08/10/2026`, description `Incident test guide : propos injurieux envers un camarade`, lieu `Cour de récréation test guide`, rôle `Auteur`. « Incident enregistré. ».
2. Ouvrir `/v2/schoollife`, cliquer sur **« Ouvrir le dossier »** en face de cet incident (fiche de TOURE Jean-Marc).
3. Cliquer sur **« Proposer une mesure »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Type | `Exclusion temporaire (démonstration)` |
| Gravité | `Niveau 2 (démonstration)` |
| Motif | `Exclusion test guide : propos injurieux répétés` |
| Premier jour | `15/10/2026` (J+7) |
| Dernier jour | `16/10/2026` (J+8) |

4. Lire le cadre **« Circuit de ce type »** : « Cette mesure se propose, puis se valide. », « Le validateur doit être une autre personne que vous. », « Elle peut faire l'objet d'un recours. », « La famille est notifiée lors de la notification de la mesure. ». Cliquer sur **« Proposer la mesure »**.

✅ « Mesure enregistrée. ». Dans la chronologie, la mesure est « Proposée » et n'a aucun effet ; aucun bouton « Valider » ni « Rejeter » pour l'éducateur. Le tableau de bord du directeur affichera « Mesures à valider » = 2 (Yao et Jean-Marc).

⚠️ *Test d'erreur* : type d'exclusion sans dates → « Ce type de mesure exige des dates de début et de fin. » ; motif `abc` → "Le motif doit faire au moins 5 caractères."

⚠️ *Écart connu* : l'auteur s'affiche sous son identifiant de connexion (`educateur`) et non sous son nom (E-19a-5).

☐ OK ☐ KO

---

### Étape 177 — L'éducateur propose un avertissement (qui sera rejeté)
👤 **éducateur** (secondaire-test) · fenêtre **B** · 📂 `/v2/schoollife` > **« Ouvrir le dossier »** de l'incident de COULIBALY Moussa

1. Sur la fiche de **COULIBALY Moussa**, cliquer sur **« Proposer une mesure »**, type `Avertissement (démonstration)`, motif `Avertissement test guide : retards répétés`.
2. Constater que le cadre « Circuit de ce type » ne mentionne pas « Le validateur doit être une autre personne que vous. » et que « Premier jour » / « Dernier jour » n'apparaissent pas (un avertissement n'exige ni dates ni quatre yeux).
3. Cliquer sur **« Proposer la mesure »**.

✅ « Mesure enregistrée. », mesure « Proposée » pour COULIBALY Moussa. Le tableau de bord du directeur affichera maintenant 3 mesures à valider.

☐ OK ☐ KO

---

### Étape 178 — La direction valide une mesure et en rejette une autre
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 Menu **« Vie scolaire »** > **« Mesures à valider »** (`/v2/schoollife/validations`)

1. Lire la section **« À valider »** : TOURE Yao (graine), TOURE Jean-Marc et COULIBALY Moussa, avec « Proposée par … le … » ; pour les exclusions, « validation par une autre personne exigée ».
2. Sur la mesure de **TOURE Jean-Marc**, cliquer sur **« Valider »**, saisir la note facultative `Validation test guide` puis **« Valider »**.
3. Sur l'avertissement de **COULIBALY Moussa**, cliquer sur **« Rejeter »**, saisir `Rej` puis valider (refus), puis `Rejet test guide : motif insuffisant` et cliquer sur **« Rejeter »**.

✅ « Mesure validée. » : la mesure de Jean-Marc passe dans « Validées : à notifier ou à exécuter » et un effet « Demande de changement de statut de l'élève » apparaît dans « Effets d'exclusion en attente » au statut « En attente d'une décision humaine ». Pour le rejet : le motif `Rej` est refusé avec « Le motif doit comporter au moins 5 caractères. », puis « Mesure rejetée. » et la mesure disparaît de « À valider ». Proposant (éducateur) et validateur (directeur) sont deux personnes différentes.

🔒 *Test de droit* : en tant que **directeur des études**, taper `/v2/schoollife/validations` → « Accès refusé ».

☐ OK ☐ KO

---

### Étape 179 — Quatre yeux : le directeur ne valide pas sa propre proposition
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 `/v2/schoollife/saisie` puis fiche, puis `/v2/schoollife/validations`

1. Dans **« Saisie rapide »**, déclarer un incident pour **COULIBALY Salimata** (classe `6e A`) : type `Incident en classe (démonstration)`, description `Incident test guide : refus d'obéir`, rôle `Auteur`. Ouvrir sa fiche par **« Ouvrir le dossier »**.
2. Cliquer sur **« Proposer une mesure »** : type `Exclusion temporaire (démonstration)`, motif `Exclusion test guide : proposition de la direction`, premier jour `28/10/2026` (J+20), dernier jour `29/10/2026` (J+21). **« Proposer la mesure »**.
3. Aller sur **« Mesures à valider »**, cliquer sur **« Valider »** pour cette mesure puis valider.
4. Fermer la fenêtre, puis cliquer sur **« Rejeter »** avec le motif `Rejet test guide : validation impossible par le proposant`.

✅ À l'étape 3, la fenêtre reste ouverte avec l'erreur du serveur : "La validation doit venir d'une autre personne que le proposant (séparation des tâches)." La mesure reste « Proposée ». Le rejet de l'étape 4 est possible : « Mesure rejetée. ». (Pour qu'une telle exclusion soit validée, il faudrait le compte propriétaire `direction.generale@secondaire-test.test`.)

☐ OK ☐ KO

---

### Étape 180 — La famille ne voit rien avant la notification
👤 **parent** (secondaire-test) · fenêtre **B** (« Se déconnecter » de l'éducateur) · 📂 Menu du portail parent **« Vie scolaire »** (`/v2/schoollife/famille`)

Compte : `parent@secondaire-test.test` (DIABATE Séka, sans MFA ; deux enfants : DIABATE Nadia et DIABATE Salimata).

1. Choisir l'enfant **DIABATE Salimata** dans la liste « Enfant ».
2. Choisir ensuite **DIABATE Nadia**.

✅ Pour Salimata (dont l'exclusion de la graine est validée mais non notifiée), la page affiche « Rien à afficher pour le moment. » avec l'aide « Les informations apparaissent ici une fois notifiées par l'établissement. ». Pour Nadia, le chapitre de référence annonce aussi « Rien à afficher pour le moment. » : l'encouragement saisi plus haut n'apparaît qu'après la notification, à l'étape suivante *(à vérifier ; s'il s'affiche déjà, le noter)*. **Jamais** d'incident, de note du personnel ni d'élément confidentiel.

🔒 *Test de droit* : en tant que **parent**, taper `/v2/schoollife/saisie` puis `/v2/schoollife` → « Accès refusé » (les deux).

☐ OK ☐ KO

---

### Étape 181 — La direction notifie la famille
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 `/v2/schoollife/validations`

1. Dans « Validées : à notifier ou à exécuter », repérer l'exclusion de **DIABATE Salimata** (graine) et cliquer sur **« Notifier la famille »**.
2. Faire de même pour l'exclusion de **TOURE Jean-Marc**.

✅ « Mesure notifiée. » à chaque fois ; les deux mesures passent dans **« Mesures en vigueur »** (« Notifiées ou exécutées : révocables avec un motif. »). L'envoi aux tuteurs est simulé : aucun message réel n'est émis.

⚠️ *Écart connu* : l'écran n'indique pas « Simulée » ni le statut de remise après l'envoi (E-19a-3).

☐ OK ☐ KO

---

### Étape 182 — La famille voit la décision, jamais l'incident
👤 **parent** (secondaire-test) · fenêtre **B** · 📂 **« Vie scolaire »** (`/v2/schoollife/famille`)

1. Rafraîchir la page, choisir l'enfant **DIABATE Salimata**.
2. Choisir ensuite **DIABATE Nadia**.

✅ Salimata : un groupe « Décisions » avec le titre « Exclusion temporaire (démonstration) », le badge « Notifiée », la période « du … au … », le motif de la mesure et le bouton **« Déposer un recours »**. Nadia : sous « Encouragements et observations », "Encouragement test guide : très bonne participation en classe" (titre « Encouragement (démonstration) ») ; l'encouragement de la graine ("Très bonne participation cette semaine.", personnel seulement) n'apparaît pas. La liste « Enfant » ne propose que Nadia et Salimata : la mesure de Jean-Marc est invisible pour ce parent.

☐ OK ☐ KO

---

### Étape 183 — La famille dépose un recours
👤 **parent** (secondaire-test) · fenêtre **B** · 📂 **« Vie scolaire »**, enfant DIABATE Salimata

1. Cliquer sur **« Déposer un recours »**.
2. Saisir le motif `Recours` puis valider (refus).
3. Saisir `Recours test guide : la famille conteste la décision` et cliquer sur **« Déposer le recours »**.

✅ Le motif `Recours` (7 caractères) est refusé avec « Le motif doit comporter au moins 10 caractères. » ; ensuite « Recours déposé. », la ligne affiche « Recours : déposé » et le bouton « Déposer un recours » disparaît.

☐ OK ☐ KO

---

### Étape 184 — La direction tranche le recours
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 `/v2/schoollife/validations`, section « Recours déposés »

1. Lire « Recours de … » avec le motif (« Maintenir ou annuler la mesure, avec une motivation. »).
2. Cliquer sur **« Maintenir la mesure »**, saisir `Court` puis valider (refus), puis `Décision test guide : la mesure est maintenue` et cliquer sur **« Maintenir »**.

✅ `Court` est refusé avec « Le motif doit comporter au moins 10 caractères. » ; ensuite « Recours tranché. » et la mesure revient « Exécutée ». Côté parent (rafraîchir la page de Salimata) : « Recours : rejeté ». (Le bouton « Annuler la mesure » aurait révoqué l'exclusion : ne pas l'utiliser ici.)

☐ OK ☐ KO

---

### Étape 185 — L'éducateur convoque les tuteurs
👤 **éducateur** (secondaire-test) · fenêtre **B** · 📂 Menu **« Vie scolaire »** > **« Convocations »** (`/v2/schoollife/convocations`)

1. Cliquer sur **« Nouvelle convocation »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Classe | `6e A` |
| Élève | `DIABATE Salimata` |
| Nature | `Discipline` |
| Motif | `Convocation test guide : entretien sur le comportement` |
| Date de l'entretien | `11/10/2026` (J+3) |
| Heure | `09:00` |
| Lieu | `Bureau vie scolaire test guide` |

2. Cliquer sur **« Créer la convocation »** : « Convocation créée. », badge « Brouillon ».
3. Cliquer sur **« Envoyer »**. Dans la fenêtre « Envoyer la convocation », les canaux « Application » et « E-mail » sont cochés par défaut (« SMS », « WhatsApp » et « Notification push » ne le sont pas). Cliquer sur **« Envoyer »**.

✅ « Convocation envoyée. », badge « Envoyée ». Le message envoyé ne reprend jamais le motif (il se lit dans le portail). Aucun envoi réel.

⚠️ *Test d'erreur* : date de l'entretien vide → « Ce champ est obligatoire. » ; motif `abc` → "Le motif doit faire au moins 5 caractères."

⚠️ *Écart connu* : un envoi avec le seul canal « Application » peut être refusé par le serveur ("Aucune remise n'a pu être mise en file (consentements, canaux ou coordonnées).") ; garder les canaux par défaut.

☐ OK ☐ KO

---

### Étape 186 — La famille accuse réception, l'entretien est tenu
👤 **parent** (secondaire-test) · fenêtre **B** · 📂 **« Vie scolaire »**, enfant DIABATE Salimata ; puis **éducateur** sur `/v2/schoollife/convocations`

1. Parent : le groupe « Convocations » affiche « Convocation » avec le motif, la date et le lieu, et le bouton **« Accuser réception »**. Cliquer dessus : « Accusé de réception enregistré. ».
2. « Se déconnecter », puis se connecter en **éducateur** (fenêtre **B**) et rouvrir `/v2/schoollife/convocations` : la ligne affiche « accusé de réception le … », badge « Accusée ».
3. Cliquer sur **« Entretien tenu »**, saisir le compte rendu `Compte rendu test guide : entretien tenu`, **« Enregistrer »**.

✅ « Entretien enregistré comme tenu. », badge « Tenue ». Les boutons « Reporter » et « Entretien tenu » n'existent que pour une convocation « Envoyée » ou « Accusée ».

🔒 *Test de droit* : en tant que **parent**, taper `/v2/schoollife/convocations` → « Accès refusé ».

☐ OK ☐ KO

---

### Étape 187 — ⚠️ Irréversible : révoquer une mesure notifiée
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 `/v2/schoollife/validations`, section « Mesures en vigueur »

1. Sur l'exclusion de **TOURE Jean-Marc**, cliquer sur **« Révoquer »**, saisir `Court` puis valider (refus), puis `Révocation test guide : erreur de saisie` et cliquer sur **« Révoquer »**.

✅ `Court` (5 caractères) est refusé avec « Le motif doit comporter au moins 10 caractères. » ; ensuite « Mesure révoquée. ». L'effet « Demande de changement de statut de l'élève » de cette mesure disparaît de « Effets d'exclusion en attente » (il passe à « Écarté » dans l'historique). Aucun bouton « Révoquer » pour l'éducateur.

⚠️ *Écart connu* : la révocation ne demande pas de confirmation explicite (E-19a-6).

☐ OK ☐ KO

---

### Étape 188 — L'éducateur propose une seconde exclusion pour l'application d'un effet
👤 **éducateur** (secondaire-test) · fenêtre **B** · 📂 `/v2/schoollife` > **« Ouvrir le dossier »** de TOURE Jean-Marc

1. Si la fiche de Jean-Marc n'est plus atteignable depuis le tableau de bord, déclarer d'abord un nouvel incident à son nom (`Incident test guide : seconde infraction`, type « Incident en classe (démonstration) »).
2. **« Proposer une mesure »** : type `Exclusion temporaire (démonstration)`, motif `Exclusion test guide : seconde proposition`, premier jour `22/10/2026` (J+14), dernier jour `23/10/2026` (J+15). **« Proposer la mesure »**.

✅ « Mesure enregistrée. », mesure « Proposée ».

⚠️ *Écart connu* : la fiche d'un élève n'est atteignable que s'il a un incident ouvert ou une mesure proposée, ou par son adresse (E-19a-9).

☐ OK ☐ KO

---

### Étape 189 — ⚠️ Irréversible : écarter un effet, puis appliquer l'autre
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 `/v2/schoollife/validations`, section « Effets d'exclusion en attente »

**Attention : « Appliquer » modifie le statut d'un élève dans son dossier. Ne jamais le faire sur DIABATE Nadia ni DIABATE Salimata (comptes du parent et de l'élève).**

1. Valider la mesure de la graine de **TOURE Yao** (« À valider » > **« Valider »**). Un effet « Demande de changement de statut de l'élève » apparaît pour lui.
2. Sur l'effet de Yao, cliquer sur **« Écarter »**, saisir `Non` puis valider (refus), puis `Effet écarté test guide : sanction non retenue` et cliquer sur **« Écarter »**.
3. Valider la seconde exclusion de **TOURE Jean-Marc** (étape précédente). Dans « Effets d'exclusion en attente », cliquer sur **« Appliquer »**.
4. Lire « Appliquer le changement de statut » (« Le statut de l'élève sera modifié dans son dossier, sous votre responsabilité. »), choisir « Nouveau statut de l'élève » = **Suspendu**, cliquer sur **« Appliquer »**.

✅ Étape 2 : `Non` refusé avec « Le motif doit comporter au moins 5 caractères. », puis « Effet écarté. » ; le statut de Yao n'a pas changé. Étape 4 : « Statut de l'élève modifié. », l'effet disparaît de la liste ; le dossier de Jean-Marc dans le module des élèves affiche le statut « Suspendu » (il était « Actif » avant : aucune tâche automatique ne le change). La mesure garde son statut « Validée ». Le statut se rétablit par un autre acte humain dans le module des élèves (pas de bouton "Lever" ici).

📚 *Pour aller plus loin* : chapitre 19a, scénarios 19.3, 19.7, 19.12 (annulation, « Marquer exécutée »), 19.18 (élément confidentiel), 19.19 à 19.24 (paramètres, barème de points de conduite, vue élève, droits, qualité).

☐ OK ☐ KO

---

**Ce que la phase laisse dans l'application :**
- Incidents "Incident test guide : bavardage pendant la composition" (COULIBALY Moussa), "…propos injurieux envers un camarade" (TOURE Jean-Marc), "…refus d'obéir" (COULIBALY Salimata).
- Encouragement "Encouragement test guide : très bonne participation en classe" (DIABATE Nadia, visible famille et élève) ; observation "Observation test guide : a besoin d'un suivi en lecture" (COULIBALY Salimata, personnel seulement).
- Mesures : exclusion "Exclusion test guide : propos injurieux répétés" (Jean-Marc, notifiée puis révoquée) ; avertissement "Avertissement test guide : retards répétés" (Moussa, rejeté) ; "Exclusion test guide : proposition de la direction" (Salimata COULIBALY, rejetée) ; "Exclusion test guide : seconde proposition" (Jean-Marc, validée, effet appliqué, **statut de l'élève « Suspendu »**) ; exclusion de TOURE Yao validée, effet écarté.
- Graine modifiée : exclusion de DIABATE Salimata notifiée, recours "Recours test guide : la famille conteste la décision" tranché "maintenu" (Exécutée).
- Convocation "Convocation test guide : entretien sur le comportement" (DIABATE Salimata, « Tenue »).

---

## Phase 11 — Conseil de classe et procès-verbal

Cette phase prépare un conseil de classe (planifier, composer, préparer, convoquer), délibère sur la séance de démonstration du Trimestre 2 (propositions, décisions humaines), la clôt, génère le procès-verbal, essaie la signature et le déverrouillage motivé, puis montre à la famille ce qui lui est visible. Le module ne calcule aucune moyenne, aucun passage, aucun redoublement : il fige les résultats lus, recueille des propositions et des décisions **humaines**. Le bandeau « Règles de démonstration — non réglementaires » s'affiche partout.

Précondition : base de démonstration du Collège Le Baobab ; résultats du Trimestre 1 **clôturés** et ceux du Trimestre 2 verrouillés (état de la graine) ; séance « Conseil de classe de la période 2 (démonstration) » (classe 6e A) « En séance », avec cinq participants présents. Si une phase précédente a changé l'état des résultats, relever les écarts. Le worker doit tourner pour le PDF du procès-verbal. Comptes : directeur des études, secrétariat et directeur en fenêtre **A** ; enseignant, parent et élève en fenêtre **B**.

⚠️ **Limites à connaître avant de commencer**
- **Une séance du Trimestre 1 ne peut jamais s'ouvrir** : elle se crée, se compose, se prépare et se convoque, mais l'ouverture est refusée par le module des résultats ("La période est clôturée."). La délibération se fait donc sur la séance de démonstration du Trimestre 2.
- **La signature du procès-verbal est impossible avec les comptes de démonstration** (les fiches « Conseil » du président et du secrétaire ne sont liées à aucun compte). Le procès-verbal reste « Généré » et la séance « Clos » ; l'état « Signé », la publication irréversible et les effets "à la signature" ne sont pas démontrables ici.

### Étape 190 — Lire le calendrier des conseils de classe
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 Menu **« Conseils de classe »** > **« Conseils de classe »** (`/v2/councils`)

Compte : `etudes@secondaire-test.test` (MFA : le code du moment est proposé sur la page de connexion).

1. Lire les onglets **« Calendrier des conseils »**, **« Effets des décisions »**, **« Orientation »**, **« Paramètres »** et le tableau « Conseils de classe ».
2. Dans le formulaire « Filtres du calendrier », choisir « Classe » = `6e A`, puis « Statut » = « Clos ».
3. Remettre « Statut » sur tous, lire le bloc **« Synthèse de la classe »**.

✅ Une ligne « Conseil de classe de la période 2 (démonstration) », classe 6e A, période Trimestre 2, statut « En séance », avancement du type « 0 décidé(s) sur 9 · 5 présent(s) sur 5 ». Avec « Clos » : « Aucun conseil » et « Aucune séance ne correspond à ces filtres. ». La synthèse affiche « 0 en attente », « 0 en échec », « 0 à appliquer par un humain ». Le bouton « Planifier un conseil » est visible.

🔒 *Test de droit* : en tant que **parent**, taper `/v2/councils` → « Accès refusé ».

☐ OK ☐ KO

---

### Étape 191 — Lire le dossier de la séance de démonstration
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 `/v2/councils` > titre de la séance (`/v2/councils/<identifiant>`)

1. Cliquer sur le titre « Conseil de classe de la période 2 (démonstration) ». Lire les sous-onglets **« Dossier de classe »**, **« Délibération »**, **« Procès-verbal »**, **« Historique »**.
2. Lire le cadre **« État de la séance »**, le tableau **« Participants et présence »**, puis **« Ordre du jour par élève »**.
3. Lire les boutons : **« Clore la séance »**, **« Modifier »**, **« Annuler la séance »**, **« Passer en mode séance »**, **« Voir les effets »**.

✅ Bandeau de démonstration visible ; statut « En séance », badge « Quorum atteint », ligne « 5 présent(s) — aucun minimum défini ». Cinq participants dont "PRESIDENT Conseil" (Président) et "SECRETAIRE Conseil" (Secrétaire), « Présent ». L'ordre du jour liste environ 9 élèves (dont ADOU Aïcha), « Faits » « Version 1 », statut « À examiner », « Décisions » 0 ; 1 « Propositions à traiter » pour l'élève n° 1.

☐ OK ☐ KO

---

### Étape 192 — Planifier un conseil du Trimestre 1
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 `/v2/councils` > **« Planifier un conseil »**

1. Cliquer sur **« Planifier un conseil »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Classe | `6e A` |
| Type de conseil | `Conseil de classe de période` |
| Année scolaire | l'année courante (présélectionnée) |
| Période | `Trimestre 1` |
| Intitulé (facultatif) | `Conseil de classe T1 test guide` |
| Date prévue | `10/10/2026` (J+2) |
| Heure | `14:00` |
| Lieu | `Salle des professeurs test guide` |

2. Cliquer sur **« Planifier »**, puis sur le lien **« Ouvrir la séance »** du message.

✅ « Séance créée. » ; statut « Planifié », « Aucun participant pour le moment. », « Aucun élève à l'ordre du jour », avertissements "L'ordre du jour n'est pas préparé." et "Aucun président présent : la séance ne peut pas être ouverte."

⚠️ *Test d'erreur* : type « Période » sans période → « Ce type de conseil porte sur une période : choisissez-la. » ; `6e A` + "Conseil de classe de période" + `Trimestre 2` → "Un conseil de ce type existe déjà pour cette classe et cette période."

⚠️ *Écart connu* : l'écran ne prévient pas qu'une séance sur une période clôturée ne pourra jamais s'ouvrir (E-19b-9).

🔒 *Test de droit* : en tant qu'**enseignant**, le bouton « Planifier un conseil » est absent.

☐ OK ☐ KO

---

### Étape 193 — Composer la séance : les participants
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 dossier de la séance "Conseil de classe T1 test guide"

1. Lire **« Participants proposés »** (les trois enseignants de la classe, d'après leurs affectations).
2. Cliquer sur **« Ajouter TRAORE Kouadio »** : Membre du personnel = TRAORE Kouadio, Rôle = `Président du conseil`, Fonction = `Président`. **« Ajouter »**.
3. Même procédure pour **YAO Fatou** : Rôle = `Secrétaire de séance`, Fonction = `Secrétaire`. Puis **KOUAME Adjoua** : Rôle = `Professeur principal`, Fonction = `Aucune`.
4. Cliquer sur **« Modifier »** (« Modifier la séance »), changer le Lieu en `Salle des professeurs test guide, étage 1`, **« Enregistrer »**.

✅ Chaque ajout affiche « Participant ajouté. » et une ligne « Participants et présence » avec la présence « Convoqué » et « Non convoqué » dans « Convocation ». Étape 4 : « Séance mise à jour. ».

⚠️ *Test d'erreur* : ajouter un participant au rôle « Enseignant de la classe » avec la fonction « Président » → "Ce rôle ne peut pas présider la séance." ; un second « Président » → "Cet enregistrement existe déjà."

⚠️ *Écart connu* : « Participants proposés » affiche le code de rôle brut `TEACHER` ; seuls les enseignants de la classe sont proposés (E-19b-2, E-19b-5).

☐ OK ☐ KO

---

### Étape 194 — Préparer l'ordre du jour et convoquer
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 dossier de la séance "Conseil de classe T1 test guide"

1. Cliquer sur **« Préparer la séance »**, lire le tableau « Ordre du jour par élève » (colonnes « N° », « Élève », « Statut », « Faits », « Décisions », « Propositions à traiter »).
2. Cliquer de nouveau sur **« Préparer la séance »** (rejeu).
3. Cliquer sur **« Convoquer »**.

✅ Étape 1 : « Préparation terminée : 9 créé(s), 0 reconstruit(s), 0 inchangé(s), 0 ignoré(s). » (9 = élèves actifs de la classe, à relever) ; « Faits » « Version 1 », statut « À examiner » ; un élève sans résultat de période porte « Résultats manquants » *(probablement ADOU Aïcha, à vérifier)*. Étape 2 : « Préparation terminée : 0 créé(s), 0 reconstruit(s), 9 inchangé(s), 0 ignoré(s). » (rejouable sans doublon). Étape 3 : « Convocation envoyée : 3 convoqué(s), 1 notifié(s). » (seul TRAORE Kouadio a un compte de connexion ; les autres donnent un avertissement du type "Aucune remise n'a pu être mise en file pour …"). Aucun message réel.

🔒 *Test de droit* : se connecter en **secrétariat** (`secretariat@secondaire-test.test`, MFA) : « Convoquer » est visible, « Préparer la séance » est absent.

☐ OK ☐ KO

---

### Étape 195 — Ouvrir la séance : les deux refus attendus
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 dossier de la séance "Conseil de classe T1 test guide"

1. Cliquer sur **« Ouvrir la séance »** sans avoir marqué personne présent (fenêtre « Ouvrir la séance » : « Le quorum est atteint. »), puis **« Ouvrir »**.
2. Fermer. Passer la présence de **TRAORE Kouadio** et de **YAO Fatou** à « Présent » (liste « Présence de … »).
3. Cliquer de nouveau sur **« Ouvrir la séance »**, puis **« Ouvrir »**.

✅ Étape 1 : "Un président présent est nécessaire pour ouvrir la séance." (bandeau « Le président n'est pas présent. »). Étape 3 : les présences sont acceptées mais l'ouverture est refusée par le module des résultats : "La période est clôturée." La séance reste « Planifié ».

⚠️ *Limite connue* : **c'est le comportement attendu pour une séance du Trimestre 1.** Ne pas chercher à contourner (la dérogation de quorum ne contourne pas ce contrôle). Seule la séance du Trimestre 2 s'ouvre et se délibère.

🔒 *Test de droit* : le **secrétariat** n'a pas le bouton « Ouvrir la séance ».

☐ OK ☐ KO

---

### Étape 196 — Annuler la séance du Trimestre 1
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 dossier de la séance "Conseil de classe T1 test guide"

1. Cliquer sur **« Annuler la séance »**, saisir `Non` puis valider (refus), puis `Annulation test guide : essai terminé` et cliquer sur **« Annuler la séance »**.
2. Revenir au calendrier et filtrer sur « Annulé ».

✅ `Non` est refusé avec « Le motif doit comporter au moins 5 caractères. » ; ensuite « Séance annulée. », badge « Annulé », ligne « Motif d'annulation ». Les boutons d'action disparaissent. **Ne pas replanifier** cette séance : elle n'est plus utile.

⚠️ *Écart connu* : les deux boutons nommés « Annuler » de la fenêtre (fermer, confirmer) peuvent prêter à confusion.

☐ OK ☐ KO

---

### Étape 197 — Examiner un élève : faits figés et suggestions
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 séance de démonstration > nom de **DIABATE Nadia** (`/v2/councils/<identifiant>/eleves/<identifiant-ligne>`)

1. Cliquer sur le nom de **DIABATE Nadia** dans « Ordre du jour par élève ».
2. Lire **« Faits du dossier »** (« Faits figés, version 1, empreinte » et une empreinte abrégée, « État du résultat », « Moyenne », « Rang », « Mention », « Assiduité », « Vie scolaire »), puis **« Suggestions des règles »**.
3. Cliquer sur **« Marquer comme examiné »**, puis sur **« Reconstruire les faits »**.

✅ Si l'élève n'a pas de résultat exploitable (Trimestre 2 verrouillé mais non calculé) : « Aucun résultat exploitable pour cet élève : une décision de passage ou de redoublement exige une justification. » et badge « Résultats manquants » *(à relever)*. Suggestions : « Ces suggestions viennent du jeu de règles : ce ne sont pas des décisions. Seul le conseil décide. » puis des lignes « Suggestion » ou « Aucune suggestion des règles pour cet élève. ». Étape 3 : « Élève marqué comme examiné. » (statut « Examiné » dans l'ordre du jour) puis « Faits reconstruits. » (la version reste "1" si rien n'a changé).

☐ OK ☐ KO

---

### Étape 198 — L'enseignant propose
👤 **enseignant** (secondaire-test) · fenêtre **B** · 📂 Menu du portail **« Conseils de classe »** > séance de démonstration > **DIABATE Nadia**

1. Dans « Propositions », cliquer sur **« Ajouter une proposition »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Nature | `Appréciation` |
| Texte | `Appréciation test guide : élève sérieuse et régulière` |

   Cliquer sur **« Ajouter »**.
2. Recommencer avec Nature = `Remarque`, texte `Remarque test guide : à encourager en lecture`.
3. Constater qu'il n'a ni « Accepter », ni « Refuser », ni « Retirer », ni bouton « Enregistrer la décision ».

✅ « Proposition ajoutée. » à chaque fois ; badge « Proposition », statut « Proposée », « Proposée par … ». Côté dossier de la séance, l'enseignant ne voit ni « Clore la séance », ni « Modifier », ni « Annuler la séance », ni « Préparer la séance », et le sous-onglet « Procès-verbal » est absent.

⚠️ *Test d'erreur* : Nature « Appréciation » sans texte → « Ce champ est obligatoire. » sous « Texte ».

🔒 *Test de droit* : en tant qu'**enseignant**, taper `/v2/councils/parametres` puis `/v2/councils/effets` → « Accès refusé » (les deux).

☐ OK ☐ KO

---

### Étape 199 — La direction des études tranche les propositions
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 fiche de **DIABATE Nadia** dans la séance de démonstration

1. Sur la remarque, cliquer sur **« Accepter »**.
2. Sur l'appréciation, cliquer sur **« Refuser »**, saisir la note `Refus test guide`, cliquer sur **« Refuser »**.

✅ « Proposition acceptée. » puis « Proposition refusée. » (statut « Refusée », la note est affichée). **Ne pas accepter l'appréciation** : accepter cette nature crée plus tard un effet qui écrit dans les résultats de la classe. Seule la remarque (sans effet) est acceptée.

☐ OK ☐ KO

---

### Étape 200 — Mode séance : enregistrer des décisions humaines
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 séance de démonstration > **« Passer en mode séance »** (`/v2/councils/<identifiant>/deliberation`)

1. Lire « Mode séance : un élève à la fois. », utiliser « Élève suivant », « Élève précédent » et la liste « Aller à un élève ».
2. Sur **DIABATE Nadia**, dans « Enregistrer une décision », saisir :

| Champ | Valeur |
| :--- | :--- |
| Type de décision | `Avis requis du conseil` |
| Décideur présent | `PRESIDENT Conseil` |
| Mode de décision | `Consensus` |
| Justification | *(vide)* |

   Cliquer sur **« Enregistrer la décision »**.
3. Sur **BAMBA Aya** : Type = `Autre décision`, Décideur = `PRESIDENT Conseil`, Mode = `Vote`, Voix pour `5`, contre `2`, abstentions `1`, Justification `Décision test guide : suivi renforcé demandé par le conseil`. **« Enregistrer la décision »**.

✅ « Décision enregistrée. » ; le panneau « Décisions » liste "Avis requis du conseil" avec les badges « Enregistrée » et « Avis requis » et « Décideur » = PRESIDENT Conseil. Pour Aya : "5 pour, 2 contre, 1 abstention(s)". Dans l'ordre du jour, « Décisions » passe à 1 et le statut à « Décidé ».

⚠️ *Test d'erreur* : « Autre décision » sans justification → « La justification est obligatoire pour cette décision. » ; mode « Vote » sans voix → "Un vote consigne les voix pour, contre et les abstentions."

⚠️ *Écart connu* : la liste propose aussi des types de portée « Année » (passage, redoublement…) que le serveur refuse pour un conseil de période ("Ce type de décision ne s'applique pas à ce type de séance.", E-19b-4). N'enregistrer aucune décision « Exclusion » ni « Réorientation » : elles créent des effets sur le statut ou l'orientation.

☐ OK ☐ KO

---

### Étape 201 — Retirer une décision, verrou du décideur
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 dossier de la séance et fiche de **BAMBA Aya**

1. Dans le dossier de la séance, passer la présence de **PRESIDENT Conseil** à « Absent ».
2. Revenir à « Présent ».
3. Sur la fiche de BAMBA Aya, cliquer sur **« Retirer la décision »**, saisir `No` puis valider (refus), puis `Retrait test guide : décision d'essai` et cliquer sur **« Retirer »**.

✅ Étape 1 : refus du serveur "Ce participant est le décideur de décisions enregistrées : retirez-les d'abord." (la présence reste « Présent »). Étape 3 : `No` refusé avec « Le motif doit comporter au moins 5 caractères. » ; ensuite « Décision retirée. » ; la décision reste visible dans l'historique avec le statut « Retirée » et « Motif du retrait ». **Laisser la décision "Avis requis du conseil" de Nadia en place.**

☐ OK ☐ KO

---

### Étape 202 — ⚠️ Clore la séance
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 dossier de la séance de démonstration

1. Cliquer sur **« Clore la séance »** (« Après la clôture, les décisions ne sont plus modifiables sans déverrouillage motivé. », « Confirmez-vous la clôture de la séance ? »), puis **« Clore »**.
2. Essayer de saisir une décision sur la fiche d'un élève, puis de changer une présence.

✅ « Séance close. », statut « Clos ». Les boutons « Clore la séance », « Modifier », « Annuler la séance », « Passer en mode séance » disparaissent ; la présence ne se modifie plus ; le formulaire de décision affiche « Les décisions s'enregistrent pendant que la séance est ouverte. ». La clôture n'est pas bloquée par les élèves sans décision (ce type de conseil n'en exige pas). Aucun effet n'apparaît (déclencheur : signature du procès-verbal). Le déverrouillage motivé, plus loin, permet de revenir en arrière.

☐ OK ☐ KO

---

### Étape 203 — Générer le procès-verbal et obtenir le PDF
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 séance > **« Procès-verbal »** (`/v2/councils/<identifiant>/pv`)

1. Lire « Aucun procès-verbal » et « Générez le procès-verbal une fois les décisions enregistrées. ». Cliquer sur **« Générer le procès-verbal »**.
2. Lire le tableau **« Versions »** et la section « Procès-verbal, version 1 » (« Statut », « Rendu PDF », « Généré le », « Signé le »). Attendre « PDF prêt » (recharger la page si besoin).
3. Cliquer sur **« Préparer le téléchargement »**, puis sur **« Télécharger le PDF »**. Déplier **« Contenu du procès-verbal »**.
4. Cliquer une seconde fois sur **« Générer le procès-verbal »**.

✅ Étape 1 : « Procès-verbal généré (version 1). », statut « Généré ». Rendu : « Rendu en cours » puis « PDF prêt » ; si le worker est éteint : « Rendu en échec » (à relever). Le lien est valable quelques minutes ("Lien valable jusqu'au …"), le PDF porte la mention "Jeu de règles de démonstration, non réglementaire". Le contenu liste « Décisions par élève » (ex. `REQUIRED_OPINION` pour Nadia). Étape 4 : refus du serveur "Un procès-verbal vivant existe déjà pour cette séance : réouvrez la séance (déverrouillage motivé) pour en produire une nouvelle version."

🔒 *Test de droit* : en tant qu'**enseignant**, taper l'adresse du procès-verbal `/v2/councils/<identifiant>/pv` → « Accès refusé ».

☐ OK ☐ KO

---

### Étape 204 — Essayer de signer (refus attendu)
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 `/v2/councils/<identifiant>/pv`

1. Lire **« Signatures »** (« Aucune signature pour le moment. ») et « Signataires manquants » : PRESIDENT Conseil et SECRETAIRE Conseil, badge « À signer », bouton « Signature papier ».
2. Cliquer sur **« Signer électroniquement »**. Recommencer avec le directeur des études, puis avec le directeur.
3. Cliquer sur **« Signature papier »** en face de PRESIDENT Conseil, choisir le signataire, « Référence de la pièce numérisée » = `TG-pièce-inexistante`, **« Enregistrer »**.

✅ Étape 2, pour les trois comptes : "Votre compte n'est lié à aucune fiche du personnel : vous ne pouvez pas signer en tant que participant." Étape 3 : "La pièce de la signature papier est introuvable dans le stockage." Aucune signature enregistrée ; le procès-verbal reste « Généré » et la séance « Clos ».

⚠️ *Limite connue* : **la signature ne peut pas être démontrée avec les comptes de démonstration** (E-19b-1, à confirmer par cet essai). L'état « Signé », la publication irréversible et le déclenchement des effets "à la signature" sont donc **hors de ce guide**.

☐ OK ☐ KO

---

### Étape 205 — Déverrouillage motivé : demande, quatre yeux, approbation, réouverture
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 `/v2/councils/<identifiant>/pv`, section « Déverrouillage motivé » ; puis **directeur** (`directeur@secondaire-test.test`, MFA)

1. Directeur des études : cliquer sur **« Demander le déverrouillage »**, saisir `Trop court` puis valider (refus), puis `Demande test guide : correction d'une décision saisie par erreur` et cliquer sur **« Envoyer la demande »**.
2. Constater que le directeur des études n'a ni « Approuver » ni « Refuser » dans « Demandes de déverrouillage ».
3. Se connecter en **directeur** : dans la ligne au statut « Demandé », cliquer sur **« Approuver »** (note facultative) puis **« Approuver »**.
4. Lire « Un déverrouillage est approuvé : la séance peut être rouverte. », cliquer sur **« Rouvrir la séance »** puis **« Rouvrir »**.
5. Quatre yeux : clore de nouveau la séance, demander un déverrouillage **avec le directeur lui-même** (`Demande test guide : essai du refus de l'auto-approbation`) et cliquer sur **« Approuver »** sur sa propre demande. Puis **« Refuser »** : `No` (refus), puis `Refus test guide : auto-approbation impossible`.

✅ Étape 1 : `Trop court` est refusé avec « Le motif doit comporter au moins 20 caractères. » ; ensuite « Demande de déverrouillage envoyée. », statut « Demandé ». Étape 3 : « Demande approuvée. », statut « Approuvé ». Étape 4 : « Séance rouverte. », statut « En séance », badge « Rouvert 1 fois », procès-verbal précédent « Remplacé ». Étape 5 : "L'approbation doit venir d'une autre personne que le demandeur (séparation des tâches)." ; le refus donne « Demande refusée. » (`No` refusé avec « Le motif doit comporter au moins 5 caractères. »). Une seconde demande ouverte en parallèle : "Une demande de déverrouillage est déjà ouverte pour cette séance."

⚠️ *Écart connu* : le bouton « Rouvrir la séance » reste visible pour le directeur des études, mais l'API le refuse (E-19b-7). Le journal (onglet « Historique ») garde tout le cycle ; sa colonne « Auteur » affiche `user` et non le nom (E-19b-6).

☐ OK ☐ KO

---

### Étape 206 — Régler les effets "à la clôture" et clore de nouveau
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 `/v2/councils/parametres` puis séance

**Attention : cette variante modifie un réglage d'établissement ; il est remis en l'état à la fin de la phase.**

1. Ouvrir **« Paramètres »**, section « Réglages de l'établissement », **« Modifier »** : « Déclenchement des effets » = **À la clôture de la séance**, **« Enregistrer »**.
2. Dans la séance de démonstration, cliquer sur **« Clore la séance »** puis **« Clore »**.
3. Ouvrir **« Effets des décisions »** (`/v2/councils/effets`).

✅ « Paramètre enregistré. ». Après la clôture, une ligne **« Information des tuteurs »** pour DIABATE Nadia au statut « Appliqué » (ou « En échec » si le port de notification n'est pas prêt : bouton « Relancer », « Relance demandée. ») *(à relever)*. Aucune ligne pour BAMBA Aya (décision retirée) ni pour la remarque acceptée (aucun effet).

🔒 *Test de droit* : en tant que **secrétariat**, taper `/v2/councils/effets` → « Accès refusé ».

☐ OK ☐ KO

---

### Étape 207 — La famille et l'élève voient la décision notifiée
👤 **parent** (secondaire-test) · fenêtre **B** · 📂 Menu du portail parent **« Décisions du conseil »** (`/v2/councils/famille`)

1. Choisir l'enfant **DIABATE Nadia**, puis **DIABATE Salimata**.
2. « Se déconnecter », se connecter en **élève** (`eleve@secondaire-test.test`, DIABATE Nadia, sans MFA) et ouvrir **« Décisions du conseil »** (`/v2/councils/moi`).

✅ Nadia : une carte "Avis requis du conseil" avec le badge « Avis requis » et "Conseil de classe de période · Trimestre 2 · `<date>`". **Jamais** la suggestion de la règle, le vote, la justification interne ni la décision d'un autre élève. Salimata : « Aucune décision à afficher ». Élève : titre « Mes décisions du conseil de classe » et même contenu que le parent pour Nadia. (Avant la notification des tuteurs, les deux pages affichaient « Aucune décision à afficher » et « Aucune décision n'est visible pour le moment. ».)

🔒 *Test de droit* : en tant que **parent**, taper `/v2/councils/moi` → « Accès refusé » ; en tant qu'**élève**, taper `/v2/councils/famille` → « Accès refusé ».

☐ OK ☐ KO

---

### Étape 208 — ⚠️ Annuler l'effet et remettre le réglage
👤 **directeur des études** (secondaire-test) · fenêtre **A** · 📂 `/v2/councils/effets` puis `/v2/councils/parametres`

1. Sur la ligne « Information des tuteurs » de Nadia, cliquer sur **« Annuler l'effet »**, saisir `No` puis valider (refus), puis `Annulation test guide : effet d'essai` et cliquer sur **« Annuler l'effet »**.
2. Dans **« Paramètres »**, remettre « Déclenchement des effets » sur **À la signature du procès-verbal**, **« Enregistrer »**.
3. Rouvrir la séance : **« Demander le déverrouillage »** (motif d'au moins 20 caractères, par exemple `Demande test guide : remise de la séance en état`), approbation par le **directeur**, puis **« Rouvrir la séance »** et **« Rouvrir »**.

✅ `No` refusé avec « Le motif doit comporter au moins 5 caractères. » ; ensuite « Effet annulé. », statut « Annulé ». La décision disparaît de la vue du parent *(à relever)*. Sans l'annulation de l'effet, la réouverture est refusée : "Des effets appliqués doivent d'abord être annulés avant la réouverture." État final : séance « En séance », rouverte plusieurs fois, décision de Nadia conservée.

📚 *Pour aller plus loin* : chapitre 19b, scénarios 19.32 (quorum et dérogation), 19.41 (révocation du procès-verbal), 19.43 (historique), 19.45 (effets humains), 19.46 à 19.49 (orientation, paramètres), 19.51 (orientation vue par la famille).

☐ OK ☐ KO

---

**Ce que la phase laisse dans l'application :**
- Séance "Conseil de classe T1 test guide" (6e A, Trimestre 1) **annulée**, avec participants TRAORE Kouadio (Président), YAO Fatou (Secrétaire), KOUAME Adjoua (Professeur principal).
- Séance « Conseil de classe de la période 2 (démonstration) » **« En séance »**, rouverte plusieurs fois ; procès-verbal version 1 « Remplacé » ; demandes de déverrouillage approuvées et refusée.
- Propositions sur DIABATE Nadia : "Remarque test guide : à encourager en lecture" (acceptée), "Appréciation test guide : élève sérieuse et régulière" (refusée). Décision "Avis requis du conseil" de Nadia conservée ; décision d'Aya "Décision test guide : suivi renforcé demandé par le conseil" retirée.
- Effet « Information des tuteurs » (Nadia) annulé ; réglage « Déclenchement des effets » remis sur « À la signature du procès-verbal ».
- **Rien de signé**, aucun statut d'élève ni orientation modifié par ce module.

---

## Phase 12 — Élèves affectés par l'État

Cette phase suit un élève affecté par l'État : le secrétariat enregistre l'acte d'affectation, la direction le vérifie (une autre personne que l'enregistrant) puis l'active, l'économe rapproche les montants de l'acte avec la facturation et suit la créance sur l'État. La famille voit le statut du dossier de son enfant, jamais les montants. Aucune passerelle vers une plateforme publique n'existe : toute la saisie est manuelle ; aucun barème ni règle officielle n'est livré (tolérance à zéro, aucun contrôle exigé).

Précondition : base de démonstration ; **N'GUESSAN Aya** (dossier complet) et **N'GUESSAN Koffi** (dossier rejeté), élèves de la graine dont l'inscription est encore "en attente" et qui ne sont liés à aucun compte de test. Le dossier de démonstration `AFF-DEMO-0001` concerne ADOU Aïcha. La vérification d'un dossier fixe le financement « Affecté par l'État » de l'inscription correspondante : **rien ne se nettoie** dans l'application. Ne pas utiliser DIABATE Nadia ni DIABATE Salimata (comptes du parent et de l'élève) sauf la variante facultative signalée. Montants en francs CFA entiers, sans décimale ni signe ; les espaces ("120 000") sont acceptés. Comptes : secrétariat, directeur, propriétaire, économe en fenêtre **A** ; parent en fenêtre **B**.

### Étape 209 — Lire la liste des dossiers d'affectation
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 Menu **« Affectés de l'État »** > "Élèves affectés" (`/v2/stateassign`)

Compte : `secretariat@secondaire-test.test` (MFA : le code du moment est proposé sur la page de connexion).

Attendu au départ : une ligne `AFF-DEMO-0001`, version 1, ADOU Aïcha, statut « Vérifié », 120 000 F CFA (État) et 80 000 F CFA (famille), rapprochement « Écart » *(ou « Conforme » ou « Jamais rapproché » : à relever)*.

1. Lire le titre « Élèves affectés par l'État », les onglets **« Dossiers »**, **« Rapprochement »**, **« Créances »**, **« États »** (**« Vérification »** et **« Paramètres »** absents pour ce compte) et le tableau « Dossiers d'affectation ».
2. Saisir `ZZZ` dans la zone « Référence », puis vider. Choisir « Statut » = « Actif », puis « Tous les statuts ».

✅ Avec `ZZZ` ou « Actif » : « Aucun dossier ne correspond. » et « Enregistrez l'acte d'affectation d'un élève pour ouvrir son dossier. ». Le bouton « Enregistrer un dossier » est visible.

🔒 *Test de droit* : en tant que **secrétariat**, taper `/v2/stateassign/verification` → « Accès refusé ».

☐ OK ☐ KO

---

### Étape 210 — Enregistrer le dossier AFF-TG-0001
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 `/v2/stateassign` > **« Enregistrer un dossier »**

1. Cliquer sur **« Enregistrer un dossier »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Élève | `N'GUESSAN Aya` (taper `GUESSAN`, puis choisir) |
| Inscription | l'unique inscription proposée |
| Référence d'affectation | `AFF-TG-0001` |
| Date de l'acte | `01/09/2026` |
| Autorité émettrice | `Autorité fictive test guide` |
| Part de l'État (montant déclaré) | `120 000` |
| Part de la famille (montant déclaré) | `75 000` (volontairement erroné, corrigé à l'étape suivante) |
| Notes | `Dossier test guide` |

2. Cliquer sur **« Enregistrer le dossier »**.

✅ La fiche s'ouvre : « Dossier AFF-TG-0001 (version 1) », statut « Enregistré », montants 120 000 F CFA et 75 000 F CFA, phrase « Dossier non vérifié : l'inscription ne porte pas encore sa référence d'affectation. ». Le secrétariat voit « Corriger » et **aucun bouton « Vérifier le dossier »**.

⚠️ *Test d'erreur* : aucune inscription choisie → « Choisissez l'inscription concernée. » ; référence vide → « La référence d'affectation est obligatoire. » ; part de l'État `12,5` → « Saisissez un nombre entier de francs (sans décimale ni signe). » ; référence `AFF-DEMO-0001` → "Cette référence d'affectation est déjà portée par un autre dossier de l'établissement pour cette année."

⚠️ *Écart connu* : la liste « Inscription » affiche des codes bruts (numéro · `PENDING` · `PRIVATE`, E-19c-3).

☐ OK ☐ KO

---

### Étape 211 — Corriger le dossier avant vérification
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 fiche de `AFF-TG-0001` > **« Corriger »**

1. Cliquer sur **« Corriger »** (fenêtre « Corriger le dossier (avant vérification) »).
2. Mettre « Part de la famille (montant déclaré) » à `80 000` et vider « Référence d'affectation », puis **« Enregistrer »** (refus).
3. Remettre la référence `AFF-TG-0001` et **« Enregistrer »**.

✅ Référence vide refusée avec « La référence d'affectation est obligatoire. » ; ensuite « Dossier corrigé. », la fiche affiche 80 000 F CFA pour la famille. Après la vérification, « Corriger » disparaîtra : le fond est figé (le changement passera par un avenant).

☐ OK ☐ KO

---

### Étape 212 — Quatre yeux et rejet : le dossier AFF-TG-0002
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 `/v2/stateassign` > **« Enregistrer un dossier »**

Compte : `directeur@secondaire-test.test` (MFA).

1. Enregistrer un dossier pour **N'GUESSAN Koffi** : référence `AFF-TG-0002`, part de l'État `120 000`, part de la famille `80 000`, notes `Dossier test guide à rejeter`.
2. Sur la fiche, cliquer sur **« Vérifier le dossier »**, lire « Vous ne pouvez pas vérifier un dossier que vous avez vous-même enregistré (sauf réglage de l'établissement). », puis cliquer sur **« Vérifier »**.
3. Cliquer sur **« Rejeter »**, saisir `No` puis valider (refus), puis `Rejet test guide : acte non conforme` et cliquer sur **« Rejeter le dossier »**.
4. Enregistrer de nouveau la référence `AFF-TG-0002` pour N'GUESSAN Koffi, puis la rejeter de la même façon.

✅ Étape 2 : "La vérification doit venir d'une autre personne que celle qui a enregistré le dossier." ; le dossier reste « Enregistré ». Étape 3 : `No` refusé avec « Le motif doit comporter au moins 5 caractères. » ; ensuite « Dossier rejeté. », statut « Rejeté », ligne « Motif de rejet ». Étape 4 : la référence est de nouveau disponible (« Le rejet est motivé et définitif pour cette version ; la référence redevient disponible. ») : l'enregistrement est accepté. Les dossiers rejetés n'apparaissent dans la liste qu'avec la case « Inclure les versions remplacées et les dossiers rejetés ».

☐ OK ☐ KO

---

### Étape 213 — Vérifier le dossier AFF-TG-0001
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 Menu **« Affectés de l'État »** > **« Vérification des affectations »** (`/v2/stateassign/verification`)

1. Lire « Par défaut, vous ne pouvez pas vérifier un dossier que vous avez enregistré vous-même : une deuxième personne est exigée. Aucune vérification n'est jamais automatique. ».
2. Dans « Afficher », garder « À vérifier » : la liste contient `AFF-TG-0001` (le dossier rejeté `AFF-TG-0002` n'y figure plus).
3. Cliquer sur **« Examiner »**, puis **« Vérifier le dossier »**, saisir la note `Vérification test guide` et cliquer sur **« Vérifier »**.
4. Dans « Afficher », choisir « Vérifiés, à activer ».

✅ « Dossier vérifié : la référence d'affectation est portée sur l'inscription. », statut « Vérifié », phrase "L'inscription porte la référence d'affectation de ce dossier" avec `AFF-TG-0001`. Le dossier figure dans « Vérifiés, à activer ». Si le rattachement à l'inscription "en attente" est refusé, un message "L'inscription n'a pas pu être rattachée à l'affectation : …" s'affiche : le relever *(à vérifier)*.

☐ OK ☐ KO

---

### Étape 214 — Activer, suspendre, reprendre
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 fiche de `AFF-TG-0001`

1. Cliquer sur **« Activer »** : la fenêtre « Activer ce dossier d'affectation ? » s'ouvre. Cliquer sur **« Annuler »**, recommencer, puis confirmer par **« Activer le dossier »**.
2. Cliquer sur **« Suspendre »**, saisir `No` puis valider (refus), puis `Suspension test guide : pièce manquante` et cliquer sur **« Suspendre »**.
3. Cliquer sur **« Reprendre »**.

✅ « Dossier activé. », statut « Actif ». Étape 2 : `No` refusé avec « Le motif doit comporter au moins 5 caractères. » ; ensuite « Dossier suspendu. », statut « Suspendu », ligne « Motif de suspension ». Étape 3 : « Dossier repris. » (sans confirmation), statut « Actif ». L'historique ajoute chaque changement de statut. Le dossier doit être « Actif » pour la suite.

⚠️ *Écart connu* : la confirmation d'activation annonce l'ouverture du suivi de la créance, mais l'activation ne crée ni facture scindée ni échéance (E-19c-2).

🔒 *Test de droit* : le **secrétariat** et l'**économe** n'ont pas le bouton « Activer ».

☐ OK ☐ KO

---

### Étape 215 — Rapprocher l'acte avec la facturation
👤 **économe** (secondaire-test) · fenêtre **A** · 📂 Menu **« Affectés de l'État »** > **« Rapprochement des affectations »** (`/v2/stateassign/reconciliation`)

Compte : `econome@secondaire-test.test` (MFA).

1. Lire « L'écart est facturé moins déclaré. Le statut Conforme ou Écart est calculé avec la tolérance de l'établissement (zéro par défaut) : il ne se saisit pas. » et les trois compteurs (« Jamais rapproché », « Conforme », « Écart »).
2. Sur la ligne de `AFF-DEMO-0001`, cliquer sur **« Rapprocher »**.
3. Afficher « Jamais rapproché », repérer `AFF-TG-0001` et cliquer sur **« Rapprocher »**.
4. Ouvrir la fiche de `AFF-TG-0001` et cliquer sur **« Rapprocher avec la facturation »**.

✅ Étape 2 : « Dossier AFF-DEMO-0001 rapproché. » ; écart attendu de 25 000 F CFA côté famille (écart État 0) *(à vérifier)*. Étape 3 : `AFF-TG-0001` n'a ni facture scindée ni facture de scolarité : part de l'État facturée à 0, écart de − 120 000 F CFA, statut « Écart » *(valeurs à relever)*. Étape 4 : « Rapprochement fait : un écart subsiste entre l'acte et la facturation. ». Rapprocher deux fois donne le même état. « Contrôles à faire et anomalies » : « Aucun contrôle à faire. » tant qu'aucun contrôle n'est planifié.

⚠️ *Écart connu* : l'écart famille de 25 000 F CFA sur `AFF-DEMO-0001` vient des frais d'inscription inclus dans le montant rapproché (donnée de démonstration non cohérente avec l'acte, E-19c-4).

🔒 *Test de droit* : en tant qu'**économe**, taper `/v2/stateassign/verification` ou `/v2/stateassign/settings` → « Accès refusé ».

☐ OK ☐ KO

---

### Étape 216 — Planifier la créance sur l'État
👤 **économe** (secondaire-test) · fenêtre **A** · 📂 fiche de `AFF-TG-0001` > « Créances sur l'État »

1. Lire « Aucune échéance planifiée. » et « Planifiez les versements attendus de l'État. Leur total ne peut pas dépasser la part de l'État déclarée. ».
2. Cliquer sur **« Planifier une échéance »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Libellé | `Versement test guide 1` |
| Date d'échéance | `07/11/2026` (J+30) |
| Montant attendu | `70 000` |

   Cliquer sur **« Planifier »**.
3. Planifier une seconde échéance : `Versement test guide 2`, `07/12/2026` (J+60), `50 000`.
4. Tenter une troisième : `Versement test guide 3`, `06/01/2027` (J+90), `10 000`.

✅ Étape 2 : la ligne "1. Versement test guide 1", 70 000 F CFA attendus, 0 reçu, « À recevoir » ; résumé « Attendu » 70 000 F CFA, « Reste à recevoir » 70 000 F CFA, « Non planifié » 50 000 F CFA. Étape 3 : attendu 120 000 F CFA. Étape 4 : refus du serveur (message commençant par "les échéances" et mentionnant le montant déclaré à la charge de l'État) : le total ne peut pas dépasser 120 000 F CFA.

⚠️ *Test d'erreur* : libellé vide → « Le libellé est obligatoire. » ; montant `0` ou `1,5` → « Saisissez un nombre entier de francs, supérieur à zéro. » ; date vide → « Date invalide (AAAA-MM-JJ). »

🔒 *Test de droit* : le **secrétariat** n'a aucun bouton « Planifier une échéance ».

☐ OK ☐ KO

---

### Étape 217 — Suivre les créances de l'établissement
👤 **économe** (secondaire-test) · fenêtre **A** · 📂 Menu **« Affectés de l'État »** > **« Créances sur l'État »** (`/v2/stateassign/receivables`)

1. Lire **« Ancienneté des créances »** (« Attendu », « Reçu », « Reste à recevoir », « En retard ») et le tableau « Reste à recevoir par tranche de retard » (« Non échu », « 1 à 30 jours de retard », … « Plus de 90 jours de retard »).
2. Lire le tableau « Échéances des créances sur l'État » ; cocher « Seulement les échéances en retard ».

✅ Toutes les échéances sont listées : celle de la graine (« Versement unique de l'État (démonstration) », 120 000 F CFA attendus, 0 reçu, « À recevoir ») et les deux échéances test guide ; « Attendu » est leur somme ; « En retard » vaut 0. Le filtre "en retard" donne « Aucune échéance ne correspond. » et « Les échéances se planifient sur la fiche de chaque dossier. ».

⚠️ *Écart connu* : le **versement de l'État** se saisit comme un paiement d'un financeur dans le module Finance ; le champ « Référence du financeur » attend l'identifiant de la prise en charge (visible dans le bandeau de la facture du financeur), **pas** la référence `AFF-DEMO-0001` (E-19c-1). Le passage de l'échéance à « Partiellement reçu » ou « Reçu » est à vérifier avec la phase Finance. Le reversement des fonds partagés n'est pas modélisé.

☐ OK ☐ KO

---

### Étape 218 — Planifier et réaliser des contrôles
👤 **économe** (secondaire-test) · fenêtre **A** · 📂 fiche de `AFF-TG-0001` > « Contrôles »

1. Lire « Aucun contrôle. » et « Aucun contrôle n'est exigé par défaut : l'établissement choisit les natures et le rythme dans ses paramètres. ».
2. Cliquer sur **« Planifier un contrôle »** : Nature du contrôle = `Identité`, Date d'échéance = `23/10/2026`, **« Planifier »**. Puis **« Réaliser »** : Résultat = `Conforme`, **« Consigner le résultat »**.
3. Planifier `Pièces` (`23/10/2026`) ; **« Réaliser »** : Résultat = `Anomalie`, Constat vide puis `No` (refus), puis `Constat test guide : pièce illisible`, **« Consigner le résultat »**.
4. Sur l'anomalie, cliquer sur **« Résoudre »**, saisir `Résolution test guide : pièce fournie` et valider par **« Résoudre l'anomalie »**.

✅ Le contrôle apparaît « À faire », puis « Conforme ». Constat vide ou trop court refusé avec « Un constat de 5 caractères minimum est requis pour une anomalie. » ; ensuite statut « Anomalie » avec le constat, puis « Résolution : … ». Un contrôle n'est jamais réalisé automatiquement : l'application planifie, une personne réalise.

⚠️ *Test d'erreur* : planifier de nouveau « Identité » avec la même date → "Ce contrôle existe déjà pour cette nature et cette période." ; « Présence » sans période → « Choisissez la période à contrôler. »

☐ OK ☐ KO

---

### Étape 219 — Avenant : une nouvelle version à faire vérifier
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 fiche de `AFF-TG-0001` > **« Amender »**

1. Cliquer sur **« Amender »** (fenêtre « Avenant : version 2 »). Valider sans rien saisir (refus).
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Motif de l'avenant | `Avenant test guide : part de la famille corrigée` |
| Date d'effet | `08/10/2026` (J) |
| Nouvelle référence | *(vide)* |
| Part de la famille (nouveau montant déclaré) | `85 000` |

3. Cliquer sur **« Créer l'avenant »**, lire **« Versions et historique »**.
4. Sur la version 2, essayer **« Vérifier le dossier »** avec le directeur.

✅ Formulaire vide refusé avec « Un motif de 5 caractères minimum est requis. » et « Date invalide (AAAA-MM-JJ). » ; ensuite « Avenant créé : la nouvelle version attend sa vérification. ». La fiche s'ouvre en version 2 « Enregistré » ; la version 1 est « Remplacé ». Étape 4 : "La vérification doit venir d'une autre personne que celle qui a enregistré le dossier." (l'amendeur est l'enregistrant de la version 2).

⚠️ *Test d'erreur* : part de la famille `85,5` → « Saisissez un nombre entier de francs (sans décimale ni signe). » ; avenant sans aucun changement → "L'avenant ne change ni la référence, ni l'autorité, ni la date, ni les montants."

🔒 *Test de droit* : le **secrétariat** n'a pas le bouton « Amender ».

☐ OK ☐ KO

---

### Étape 220 — Le propriétaire vérifie l'avenant, le directeur l'active
👤 **propriétaire** (secondaire-test) · fenêtre **A** · 📂 `/v2/stateassign/verification`

Compte : `direction.generale@secondaire-test.test` (MFA), deuxième personne de direction.

1. Ouvrir **« Vérification des affectations »**, cliquer sur **« Examiner »** pour la version 2 de `AFF-TG-0001`, **« Vérifier le dossier »**, **« Vérifier »**.
2. Se connecter en **directeur**, ouvrir la fiche de `AFF-TG-0001` (version 2) et cliquer sur **« Activer »**, puis **« Activer le dossier »**.

✅ « Dossier vérifié : la référence d'affectation est portée sur l'inscription. » puis « Dossier activé. », la version 2 est « Actif » (part de la famille 85 000 F CFA). Quatre yeux respecté : deux personnes de direction différentes.

☐ OK ☐ KO

---

### Étape 221 — Lire les états et exporter en CSV
👤 **économe** (secondaire-test) · fenêtre **A** · 📂 Menu **« Affectés de l'État »** > **« États des affectations »** (`/v2/stateassign/reports`)

1. Lire « Situation au … », « Dossiers par statut », « Total déclaré — État », « Total déclaré — familles », « Créances sur l'État » (« Attendu », « Reçu », « Reste à recevoir », « En retard »), « Suivi » (« Contrôles à faire », « Contrôles en retard », « Anomalies », « Jamais rapproché », « Conforme », « Écart »).
2. Section « Exports » : « Jeu de données » = « Dossiers d'affectation », « Format » = « Format neutre (toutes les colonnes) », cliquer sur **« Télécharger le CSV »**. Recommencer avec « Créances sur l'État » puis « Contrôles ».
3. Lire la section « Passerelle vers la plateforme publique ».

✅ Compteurs cohérents avec la base *(relever les valeurs)*. « Fichier téléchargé : N ligne(s). » (N ≥ 1) et un fichier `.csv` à ouvrir dans un tableur, montants en entiers de francs. Étape 3 : « Aucune passerelle n'est configurée : la saisie et l'import sont manuels, aucun échange externe n'a lieu. ».

🔒 *Test de droit* : se connecter en **secrétariat** et ouvrir la même page : les états sont lisibles mais la section « Exports » est absente.

☐ OK ☐ KO

---

### Étape 222 — La famille ne voit aucun dossier qui ne la concerne pas
👤 **parent** (secondaire-test) · fenêtre **B** · 📂 Menu du portail parent **« Affectation de mon enfant »** (`/v2/stateassign/family`)

Compte : `parent@secondaire-test.test` (DIABATE Séka, sans MFA).

1. Lire « Le statut du dossier d'affectation par l'État de chacun de vos enfants. » et la liste « Enfants ».

✅ Deux blocs, "DIABATE Nadia" et "DIABATE Salimata", chacun avec « Aucun dossier d'affectation pour cet enfant. ». Le parent ne voit ni le dossier d'ADOU Aïcha ni ceux de N'GUESSAN Aya et Koffi.

🔒 *Test de droit* : en tant que **parent**, taper `/v2/stateassign`, `/v2/stateassign/receivables`, `/v2/stateassign/reports` puis `/v2/stateassign/settings` → « Accès refusé » (chacune).

☐ OK ☐ KO

---

### Étape 223 — Variante facultative : la famille voit le statut, jamais les montants
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 `/v2/stateassign`, puis **directeur** (vérification), puis **parent**

**À réserver à une base dédiée : cette variante change le financement d'une inscription du compte parent de démonstration (impact sur les phases Finance et Portails). Sinon, noter l'étape "non exécutée".**

1. Secrétariat : **« Enregistrer un dossier »** pour **DIABATE Salimata** : référence `AFF-TG-0003`, part de l'État `120 000`, part de la famille `80 000`.
2. Directeur : sur `/v2/stateassign/verification`, **« Examiner »**, **« Vérifier le dossier »**, **« Vérifier »**.
3. Parent : rouvrir **« Affectation de mon enfant »**, enfant Salimata.

✅ Avant la vérification : « Le dossier est en attente de vérification par l'établissement. ». Après : le bloc de Salimata affiche le « Statut » (« Vérifié »), la « Référence » et la « Date de l'acte », et « Le dossier a été vérifié par l'établissement. ». **Aucun montant** (ni part de l'État, ni part de la famille, ni écart, ni échéance, ni contrôle) n'est visible.

☐ OK ☐ KO

---

### Étape 224 — ⚠️ Irréversible : terminer le dossier AFF-TG-0001
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 fiche de `AFF-TG-0001` (version 2)

**La fin d'un dossier ne se défait pas.**

1. Cliquer sur **« Terminer »** (« La fin d'un dossier est datée et motivée ; elle ne se défait pas. »). Valider sans rien saisir (refus), puis `No` comme motif avec une date (refus), puis la date `08/10/2026` et `Fin test guide : essai terminé`.

✅ Champs vides : « Date invalide (AAAA-MM-JJ). » et « Un motif de 5 caractères minimum est requis. » ; `No` refusé avec « Le motif doit comporter au moins 5 caractères. » ; ensuite « Dossier terminé. », statut « Terminé », « Date de fin » et « Motif de fin » affichés ; plus aucun acte possible, sauf « Rapprocher avec la facturation ».

🔒 *Test de droit* : l'**économe** n'a aucun bouton « Terminer ».

📚 *Pour aller plus loin* : chapitre 19c, scénarios 19.55 (fiche de démonstration), 19.62 (modifier ou annuler une échéance), 19.63 (versement de l'État), 19.65 (pièces), 19.67 (transfert), 19.69 (paramètres et formats d'export), 19.71 et 19.72 (droits, qualité).

☐ OK ☐ KO

---

**Ce que la phase laisse dans l'application :**
- Dossier `AFF-TG-0001` (N'GUESSAN Aya) : version 1 « Remplacé », version 2 « Terminé » ; inscription passée en financement « Affecté par l'État ». Échéances "Versement test guide 1" (70 000 F CFA) et "Versement test guide 2" (50 000 F CFA) ; contrôles Identité (conforme) et Pièces (anomalie résolue).
- Dossier `AFF-TG-0002` (N'GUESSAN Koffi) : deux enregistrements, tous deux « Rejeté ».
- `AFF-DEMO-0001` (ADOU Aïcha) rapproché, toujours « Vérifié » (non activé).
- Variante (si exécutée) : dossier `AFF-TG-0003` (DIABATE Salimata) « Vérifié ».

---

## Phase 13 — Examens : session, candidats, centres, notes, résultats

Le responsable des examens du Collège Le Baobab prépare une session "BEPC" de démonstration : type d'examen, centre, session, candidats (élèves de la 6e A et candidats libres), répartition en salles, convocations, notes, résultats, corrections, puis la direction publie. **Règles de démonstration** : aucune règle d'examen officielle n'est livrée (ni BEPC, ni BAC, ni CEPE réel) ; les écrans affichent le bandeau « Règles de démonstration » et les documents portent un filigrane de démonstration. Ne tirez aucune conclusion réglementaire de ce qui s'affiche.

Précondition : graine du collège (classe 6e A avec ses élèves, deux sessions de démonstration `OFF-DEMO` et `BLANC-DEMO`). **Ne publiez ni n'archivez jamais `OFF-DEMO` ni `BLANC-DEMO`** : tout se passe sur les sessions "test guide". Les enregistrements créés ici ne se suppriment pas depuis les écrans.

### Étape 225 — Se connecter et lire l'état de départ du module Examens
👤 **responsable des examens** (secondaire-test, `examens@secondaire-test.test`, sans MFA) · fenêtre **A** · 📂 Menu **« Examens »** (`/v2/examinations`)

Attendu au départ : liste « Sessions d'examen » avec deux lignes, "Session OFF-DEMO" (Officiel, « Inscriptions ouvertes », pastille « Démonstration ») et "Session BLANC-DEMO" (Examen blanc, « Épreuves en cours »). Aucun centre, aucun candidat libre.

1. Se connecter (clic sur le compte dans le panneau de droite de `/v2/login`, puis « Se connecter »).
2. Lire la barre d'onglets : « Sessions », « Candidats », « Répartition », « Centres et salles », « Examens blancs », « Notes et résultats », « Imports », « Corrections », « Statistiques », « Exports et documents », « Types d'examens ». L'onglet « Examen de l'élève » est absent (réservé aux familles).
3. Ouvrir « Types d'examens » (`/v2/examinations/types`) : une seule carte `EXAM_DEMO — Examen de démonstration (6E)`. Aucun type BEPC n'existe encore.

✅ Deux sessions, un seul type, le bouton « Nouvelle session » visible en haut à droite.

☐ OK ☐ KO

---

### Étape 226 — Créer le type d'examen "BEPC test guide"
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 Menu **« Examens »** > **« Types d'examens »** (`/v2/examinations/types`)

1. Cliquer **« Nouveau type »**.
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Code | `TG_BEPC` |
| Libellé | `BEPC test guide (démonstration)` |
| Niveau d'enseignement | `LOWER_SECONDARY` |
| Niveau de classe visé | `6E` |
| Origine des données | « Démonstration (fictif) » |
| Référence de la source | `Guide de test, données fictives` |

3. Cliquer **« Créer le type »**.

✅ La fenêtre se ferme ; la carte `TG_BEPC — BEPC test guide (démonstration)` apparaît avec les pastilles « Démonstration » et « Actif », et reste après rechargement. Le type n'a pas encore d'épreuve.

⚠️ *Test d'erreur* : ouvrir **« Nouveau type »**, saisir le code `TG_BEPC` une seconde fois → "Ce code de type d'examen existe déjà." ; code `TG BEPC` (espace) → "Format invalide.".

☐ OK ☐ KO

---

### Étape 227 — Ajouter une filière et trois épreuves au type
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 **« Types d'examens »** > carte `TG_BEPC` > **« Afficher le détail »**

1. Dans « Filières », cliquer **« Ajouter une filière »**, saisir Code `TGA`, Libellé `Série A test guide`, puis **« Ajouter la filière »**.
2. Dans « Épreuves », cliquer **« Ajouter une épreuve »** trois fois, puis **« Ajouter l'épreuve »** à chaque fois :

| Code | Libellé | Filière | Coefficient | Barème (sur) | Ordre |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `TG_EP1` | `Mathématiques test guide` | (vide) | `2` | `20` | `1` |
| `TG_EP2` | `Français test guide` | (vide) | `1` | `20` | `2` |
| `TG_EP3` | `Épreuve de série A test guide` | `TGA — Série A test guide` | `1` | `10` | `3` |

✅ La pastille `TGA — Série A test guide` apparaît ; le tableau « Épreuves » liste `TG_EP1`, `TG_EP2`, `TG_EP3` (cette dernière suivie de `[TGA]`), coefficients et barèmes en virgule française.

⚠️ *Test d'erreur* : épreuve avec Coefficient `0` → "Le coefficient doit être strictement positif." ; Code `TG_EP1` une seconde fois → "Ce code d'épreuve existe déjà.".

☐ OK ☐ KO

---

### Étape 228 — Créer le centre d'examen et ses salles
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 Menu **« Examens »** > **« Centres et salles »** (`/v2/examinations/centers`)

Attendu au départ : « Aucun centre d'examen ».

1. Cliquer **« Nouveau centre »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Code | `TG-CTR1` |
| Nom | `Centre Cocody test guide` |
| Nature | « Centre propre » |
| Localité | `Cocody, Abidjan` |

2. Cliquer **« Créer le centre »**, puis **« Ajouter une salle »** deux fois (**« Ajouter la salle »** à chaque fois) :

| Code | Libellé | Capacité (places) |
| :--- | :--- | :--- |
| `S1` | `Salle 1 test guide` | `3` |
| `S2` | `Salle 2 test guide` | `2` |

3. Pour la salle `S2`, cliquer **« Désactiver »** (pastille « Inactive »), puis **« Activer »** pour la remettre « Active ».

✅ Carte `TG-CTR1 — Centre Cocody test guide` avec « Centre propre » et « Actif » ; deux salles dans le tableau (colonnes « Code », « Libellé », « Capacité (places) », « État »). Une troisième salle `S3` (2 places) sera ajoutée à l'étape *Répartir automatiquement les candidats*.

⚠️ *Test d'erreur* : salle avec Capacité `0` → "La valeur doit être supérieure ou égale à 1." ; code de centre `TG-CTR1` en double → "Ce code de centre existe déjà.".

☐ OK ☐ KO

---

### Étape 229 — Créer la session officielle et la session d'examen blanc
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 Menu **« Examens »** > **« Sessions »** (`/v2/examinations`)

1. Cliquer **« Nouvelle session »** et saisir la session officielle :

| Champ | Valeur |
| :--- | :--- |
| Type d'examen | `TG_BEPC — BEPC test guide (démonstration)` |
| Nature | « Officiel » |
| Code | `TG-BEPC-2027` |
| Libellé | `Session BEPC test guide` |
| Année de la session | `2027` (remplacer l'année proposée) |
| Début des épreuves | `2027-06-14` |

2. Cliquer **« Créer la session »** : le détail de la session s'ouvre ; revenir par **« Retour aux sessions »**.
3. Recommencer avec la session d'examen blanc :

| Champ | Valeur |
| :--- | :--- |
| Type d'examen | `TG_BEPC — BEPC test guide (démonstration)` |
| Nature | « Examen blanc » |
| Session officielle préparée | "Session BEPC test guide" |
| Code | `TG-BLANC-2027` |
| Libellé | `BEPC blanc test guide` |
| Année de la session | `2027` |
| Début des épreuves | `2027-03-08` |

✅ Deux nouvelles lignes : "Session BEPC test guide" (Officiel, « Planifiée », avancement 0 %, début "14 juin 2027") et "BEPC blanc test guide" (Examen blanc, « Planifiée »).

⚠️ *Test d'erreur* : code `TG-BEPC-2027` une seconde fois → "Ce code de session existe déjà pour cet établissement." ; année `1999` → "La valeur doit être supérieure ou égale à 2000.".

☐ OK ☐ KO

---

### Étape 230 — Figer la définition et ouvrir les inscriptions
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 **« Sessions »** > clic sur "Session BEPC test guide" (`/v2/examinations/sessions/<identifiant>`)

Attendu au départ : état « Planifiée », « Effectifs » tous à 0, « Aucune épreuve », texte "La définition (séries et épreuves) n'est pas encore copiée depuis le type d'examen."

1. Cliquer **« Copier et figer la définition »**.
2. Cliquer **« Passer à : Inscriptions ouvertes »**.
3. Sous « Écrans de la session », lire les liens : « Candidats », « Répartition », « Notes et résultats », « Imports », « Statistiques », « Corrections », « Exports et documents ».

✅ Message « Définition copiée : 3 épreuve(s). » ; le tableau « Épreuves » liste `TG_EP1`, `TG_EP2`, `TG_EP3` ; puis « La session est maintenant : Inscriptions ouvertes. » (avancement 17 %). Seule l'étape « Passer à : Inscriptions closes » est ensuite proposée. La définition figée ne se refige plus (le bouton a disparu).

⚠️ *Test d'erreur* : ouvrir "BEPC blanc test guide" (définition non copiée) → le bouton « Passer à : Inscriptions ouvertes » est désactivé et la liste de points bloquants affiche "La définition (séries, épreuves) n'est pas encore figée : la figer avant d'ouvrir les inscriptions.".

☐ OK ☐ KO

---

### Étape 231 — Ajouter les élèves de la 6e A et évaluer l'éligibilité
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 Menu **« Examens »** > **« Candidats »** (`/v2/examinations/candidates`)

1. Dans « Session d'examen », choisir l'option commençant par `Session BEPC test guide`. Attendu : « Aucun candidat ».
2. Dans le bloc « Ajouter les élèves d'une classe », choisir la « Classe » `6e A` et cliquer **« Ajouter les élèves »**.
3. Recliquer **« Ajouter les élèves »**.
4. Cliquer **« Évaluer l'éligibilité de tous »**.
5. Saisir `DIABATE` dans « Rechercher », puis vider le champ.

✅ Étape 2 : « 9 candidat(s) ajouté(s), 0 déjà présent(s). » (9 au dernier relevé : relever le nombre exact, il sert à la suite). Étape 3 : « 0 candidat(s) ajouté(s), 9 déjà présent(s). ». Étape 4 : « 9 candidat(s) évalué(s) par la règle. » ; tous passent à « Éligible » (colonnes « Inscription » : « Brouillon » ; « Pièces » : « Dossier complet »). Étape 5 : seuls DIABATE Nadia et DIABATE Salimata restent. Le détail de session affiche « Candidats » 9, « Éligibles » 9, « Inscrits » 0.

⚠️ *Test d'erreur* : sans classe choisie, le bouton « Ajouter les élèves » est désactivé.

☐ OK ☐ KO

---

### Étape 232 — Inscrire un candidat, lui donner un identifiant officiel, inscrire en lot
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 **« Candidats »** > clic sur "DIABATE Nadia" (`/v2/examinations/candidates/<identifiant>`)

1. Lire l'en-tête : sous-titre « Numéro de candidat : pas encore attribué », pastilles « Brouillon », « Éligible », « En attente ».
2. Cliquer **« Inscrire le candidat »**.
3. Dans « Identifiants officiels », saisir Type d'identifiant `OFFICIAL_NUMBER`, Valeur `TG-OFF-0001`, puis **« Enregistrer l'identifiant »**.
4. Revenir à la liste (**« Retour aux candidats »**), cocher dans cet ordre **DIABATE Salimata** puis **COULIBALY Moussa**, cliquer **« Inscrire la sélection (2) »**.

✅ Étape 2 : « Candidat inscrit, numéro TG_BEPC2027-00001. » et pastille « Inscrit ». Étape 3 : `OFFICIAL_NUMBER : TG-OFF-0001 (MANUAL)` et « Numéro officiel » de l'état civil = `TG-OFF-0001`. Étape 4 : « 2 candidat(s) inscrit(s). », numéros `TG_BEPC2027-00002` (Salimata) et `TG_BEPC2027-00003` (Moussa) (dans l'ordre de sélection ; sinon relever les numéros réels).

⚠️ *Test d'erreur* : saisir `TG-OFF-0001` sur un autre candidat → "Cet identifiant désigne déjà un autre candidat de la session.".

☐ OK ☐ KO

---

### Étape 233 — Saisir un candidat libre à la main
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 **« Candidats »** (session `Session BEPC test guide`)

Un candidat libre n'est pas un élève de l'établissement : aucun dossier élève n'est créé.

1. Dans le bloc « Candidat libre (sans dossier élève) », cliquer **« Saisir un candidat libre »**.
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Nom | `KOUASSI` |
| Prénoms | `Yves test guide` |
| Date de naissance | `2013-08-19` |
| Lieu de naissance | `Cocody, Abidjan` |
| Sexe | « Masculin » |
| Téléphone | `+225 07 41 22 63 18` |
| Adresse e-mail | `yves.kouassi.tg@exemple.test` |
| Type de pièce | `EXTRAIT_NAISSANCE` |
| Numéro de la pièce | `EN-TG-0100` |
| Nom du tuteur | `KOUASSI Marcel` |
| Lien avec le candidat | `Père` |
| Le candidat est dans la classe de l'examen | coché |
| Nombre de tentatives antérieures à cet examen | `0` |

3. Cliquer **« Enregistrer le candidat »**.
4. Ouvrir la fiche de `KOUASSI Yves test guide`, cliquer **« Évaluer par la règle »**, puis **« Inscrire le candidat »**.

✅ Dans la liste : `KOUASSI Yves test guide`, pastille « Candidat libre », « Brouillon », « Non évaluée ». Étape 4 : « Éligibilité évaluée par la règle. » (pastille « Éligible »), puis « Candidat inscrit, numéro TG_BEPC2027-00004. ».

⚠️ *Test d'erreur* : sans aucun téléphone ni e-mail → "Indiquer au moins un téléphone ou une adresse e-mail (candidat ou tuteur)." ; type de pièce sans numéro → "Le type et le numéro de la pièce vont ensemble.".

☐ OK ☐ KO

---

### Étape 234 — Importer des candidats libres depuis un fichier CSV
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 **« Candidats »** (session `Session BEPC test guide`) > **« Importer un fichier CSV »**

Fichiers : `docs/guide-test/jeux-de-donnees/` (séparateur `;`).

1. Choisir `20-examens-candidats-libres-entetes.csv`.
2. Choisir `20-examens-candidats-libres-erreurs.csv`, puis cliquer **« Importer 2 candidat(s) »**.
3. Choisir `20-examens-candidats-libres.csv`, puis cliquer **« Importer 6 candidat(s) »**.
4. Saisir `test guide` dans « Rechercher ».
5. Ré-importer `20-examens-candidats-libres.csv`.

✅ Étape 1 : "Colonnes obligatoires absentes : classe_examen." et "Colonnes ignorées : remarque." ; aucun bouton d'envoi. Étape 2 : résumé "20-examens-candidats-libres-erreurs.csv : 2 ligne(s) valide(s), 6 ligne(s) à corriger." avec les lignes 3 à 8 expliquées ; résultat "1 candidat(s) libre(s) enregistré(s)." et, sous « Lignes refusées », le doublon d'identité de `SORO Aya test guide`. Étape 3 : résumé "20-examens-candidats-libres.csv : 6 ligne(s) valide(s), 0 ligne(s) à corriger." puis "6 candidat(s) libre(s) enregistré(s)." Étape 4 : les candidats libres (KONE Mariam, TRAORE Seydou, YAO Adjoua, DIABATE Ibrahim, BAMBA Fanta, COULIBALY Karim, KOUASSI Yves, SORO Aya) avec la pastille « Candidat libre ». Étape 5 : "0 candidat(s) libre(s) enregistré(s)." et six lignes refusées pour doublon : aucun doublon créé.

⚠️ *Écart connu* : un fichier vide annonce comme colonnes absentes `nom, prenoms, naissance, lieu, sexe` (liste inexacte, `lieu` est facultatif).

☐ OK ☐ KO

---

### Étape 235 — Inscrire KONE Mariam et lire ses données restreintes
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 **« Candidats »** > recherche `KONE` > clic sur `KONE Mariam test guide`

1. Lire la section « Données personnelles restreintes » : "Accès restreint : chaque consultation est tracée…" ; le « Numéro de pièce » est **masqué**.
2. Cliquer **« Afficher le numéro de pièce en entier »**.
3. Cliquer **« Évaluer par la règle »**, puis **« Inscrire le candidat »**.

✅ Étape 2 : numéro complet `EN-TG-0001` avec la mention "L'affichage complet du numéro de pièce a été tracé.". Étape 3 : « Éligible », puis « Candidat inscrit, numéro TG_BEPC2027-00005. ».

☐ OK ☐ KO

---

### Étape 236 — Éligibilité refusée : le responsable ne peut pas déroger
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 **« Candidats »** > clic sur `BAMBA Fanta test guide` (déclarée hors de la classe de l'examen par le fichier)

1. Cliquer **« Évaluer par la règle »** : pastille « Non éligible » (motif affiché tel quel : `NOT_IN_EXAM_GRADE`).
2. Cliquer **« Inscrire le candidat »**.
3. Cliquer **« Saisir à la main »**, laisser « Éligible », cliquer **« Enregistrer »**, puis **« Annuler »**.
4. Constater l'absence du bouton « Accorder une dérogation » pour ce compte.

✅ Étape 2 : "l'éligibilité doit être établie avant l'inscription (statut INELIGIBLE)". Étape 3 : "Une règle d'éligibilité est épinglée à cette session : l'éligibilité se calcule par la règle (ou se déroge avec un motif)." Le candidat reste « Brouillon ».

⚠️ *Écart connu* : les motifs codés de la règle (`NOT_IN_EXAM_GRADE`) s'affichent bruts.

☐ OK ☐ KO

---

### Étape 237 — Accorder une dérogation (direction, MFA)
👤 **directeur** (secondaire-test, `directeur@secondaire-test.test`, MFA) · fenêtre **A** · 📂 **« Candidats »** > fiche `BAMBA Fanta test guide`

1. Se déconnecter, se connecter en directeur (code MFA proposé), ouvrir la même fiche.
2. Cliquer **« Accorder une dérogation »**.
3. Dans « Motif de la dérogation », saisir `Décision de démonstration du jury de l'établissement.` puis cliquer **« Accorder la dérogation »** (valider la seconde vérification si elle s'ouvre).

✅ Nouvelle ligne d'historique avec la pastille « Dérogation » et "Motif de la dérogation : Décision de démonstration du jury de l'établissement." ; l'éligibilité devient « Éligible » *(à vérifier)*.

⚠️ *Test d'erreur* : motif de 5 caractères → "Le motif doit comporter au moins 10 caractères." ; dérogation sur DIABATE Nadia (déjà éligible) → "Ce candidat est déjà éligible : aucune dérogation nécessaire.".

⚠️ *Écart connu* : le directeur des études (`etudes@secondaire-test.test`) détient le droit de dérogation mais le bouton est masqué pour lui (à confirmer) ; ne pas le tenter ici.

☐ OK ☐ KO

---

### Étape 238 — Inscrire BAMBA Fanta et retirer TRAORE Seydou
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 **« Candidats »**

1. Se reconnecter en responsable des examens. Ouvrir la fiche `BAMBA Fanta test guide`, cliquer **« Inscrire le candidat »**.
2. Ouvrir la fiche `TRAORE Seydou test guide` (« Brouillon »), cliquer **« Retirer le candidat »**.
3. Dans « Motif du retrait », saisir `Désistement de démonstration.` puis cliquer **« Retirer »**.

✅ Étape 1 : « Candidat inscrit, numéro TG_BEPC2027-00006. ». Étape 3 : pastille « Retiré » ; plus de bouton d'inscription ni de retrait ; le détail de session affiche « Retirés » 1. Bilan : **6 candidats « Inscrit »** (00001 Nadia, 00002 Salimata, 00003 Moussa, 00004 Yves, 00005 Mariam, 00006 Fanta) et 1 « Retiré ».

⚠️ *Test d'erreur* : motif de retrait de 3 caractères → "Le motif doit comporter au moins 5 caractères.".

☐ OK ☐ KO

---

### Étape 239 — Anonymiser un candidat libre (direction)
👤 **directeur** (secondaire-test, MFA) · fenêtre **A** · 📂 **« Candidats »** > recherche `COULIBALY Karim` > fiche `COULIBALY Karim test guide` (« Brouillon »)

⚠️ Irréversible : contact, pièce d'identité et tuteur sont effacés ; le numéro, le résultat et l'historique sont conservés.

1. Se connecter en directeur. Cliquer **« Anonymiser le candidat »**.
2. Dans « Motif (demande de la personne, obligation légale…) », saisir `Demande d'effacement du candidat de démonstration.` puis cliquer **« Anonymiser »**.

✅ Pastille « Anonymisé » ; le bloc de données affiche « Ce candidat a été anonymisé : ces données ont été effacées. » ; le bouton « Anonymiser le candidat » disparaît. Avec `examens@`, ce bouton n'existe pas.

⚠️ *Test d'erreur* : motif de 5 caractères → "Le motif doit comporter au moins 10 caractères.".

☐ OK ☐ KO

---

### Étape 240 — Répartir automatiquement les candidats dans les salles
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 Menu **« Examens »** > **« Répartition »** (`/v2/examinations/assignments`), session `Session BEPC test guide`

1. Lire la « Synthèse de la répartition » : « Inscrits » 6, « Placés » 0, « Capacité » 0.
2. Dans « Centres de la session », cocher `TG-CTR1 — Centre Cocody test guide`, cliquer **« Enregistrer les centres »**. « Capacité » passe à 5.
3. Cliquer **« Répartir automatiquement »**.
4. Aller dans **« Centres et salles »** > carte `TG-CTR1` > **« Ajouter une salle »** : Code `S3`, Libellé `Salle 3 test guide`, Capacité (places) `2` > **« Ajouter la salle »**.
5. Revenir à « Répartition », cliquer **« Répartir automatiquement »**.
6. Sur la ligne du candidat 00006 (`BAMBA Fanta test guide`), cliquer **« Changer »**, choisir la salle `S3` et le « Numéro de place » `2`, puis **« Enregistrer »**.
7. Sur la ligne du candidat 00005 (`KONE Mariam test guide`), cliquer **« Retirer la place »** (il servira à l'échec de convocation).

✅ Étape 2 : « Centres de la session enregistrés. ». Étape 3 : erreur "Capacité insuffisante : 6 candidat(s) à placer pour 5 place(s) libre(s) dans les salles actives des centres de la session." (tout ou rien, « Placés » reste à 0). Étape 5 : « 6 candidat(s) placé(s), 0 déjà placé(s). » ; tableau « Places attribuées » : 00001 S1 place 1, 00002 S1 place 2, 00003 S1 place 3, 00004 S2 place 1, 00005 S2 place 2, 00006 S3 place 1. Étape 6 : S3 place 2. Étape 7 : la ligne disparaît, « Sans place » 1. La fiche de DIABATE Nadia affiche "Centre Cocody test guide, salle S1, place 1.".

⚠️ *Test d'erreur* : dans « Changer », salle `S1` place `1` (déjà prise) → "Cette place est déjà attribuée.".

☐ OK ☐ KO

---

### Étape 241 — Clore les inscriptions
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 détail de `Session BEPC test guide`

1. Cliquer **« Passer à : Inscriptions closes »**. (Ne pas encore passer en cours.)
2. Ouvrir la fiche de `DIABATE Ibrahim test guide`, cliquer **« Évaluer par la règle »**, puis **« Inscrire le candidat »**.
3. Ouvrir **« Notes et résultats »** > **« Notes par épreuve »**, saisir `12` pour DIABATE Nadia en `TG_EP1`, cliquer **« Enregistrer les notes modifiées (1) »**, puis **« Annuler les modifications »**.

✅ Étape 1 : « La session est maintenant : Inscriptions closes. » (33 %) ; les deux étapes proposées sont « Passer à : Inscriptions ouvertes » (retour) et « Passer à : Épreuves en cours ». Étape 2 : "les inscriptions ne sont pas ouvertes (session REGISTRATION_CLOSED)". Étape 3 : rapport "0 note(s) enregistrée(s), 0 inchangée(s)." avec la ligne refusée "la saisie des notes n'est ouverte que session en cours ou résultats saisis (session REGISTRATION_CLOSED)" suivie d'un code technique.

⚠️ *Écart connu* : le refus de saisie de notes répond comme un succès (rapport) et affiche un code technique à la suite du message.

☐ OK ☐ KO

---

### Étape 242 — Émettre les convocations (lot, échec, révocation)
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 Menu **« Examens »** > **« Exports et documents »** (`/v2/examinations/exports`), session `Session BEPC test guide`

1. Lire la section « Exports » : « Aucun format publié. » (aucun format n'est livré au collège ; le bouton « Lancer l'export » reste inactif).
2. Dans « Documents », « Document » = « Convocation », cliquer **« Émettre pour tous les candidats concernés »**.
3. Cliquer **« Télécharger »** sur une convocation.
4. Aller dans « Répartition », cliquer **« Répartir automatiquement »** (le candidat 00005 sans place est placé), puis revenir ici et recliquer **« Émettre pour tous les candidats concernés »**.
5. Sur la convocation du candidat 00006, cliquer **« Révoquer »**, saisir le « Motif de la révocation » `Erreur de salle sur la convocation de démonstration.`, cliquer **« Révoquer »**, puis recliquer **« Émettre pour tous les candidats concernés »**.

✅ Étape 2 : "5 document(s) émis, 0 ignoré(s)." avec, sous « Lignes refusées », "La convocation exige une place attribuée au candidat. (examinations.convocation_requires_assignment)" (candidat 00005) ; cinq lignes `Convocation v1 — TG_BEPC2027-0000N` à l'état « Émis ». Étape 3 : PDF `CONVOCATION-<numéro>.pdf` avec nom, centre, salle, place, date des épreuves (14 juin 2027) et filigrane "Données et règles de démonstration (fictives) : aucune valeur officielle." *(à vérifier visuellement)*. Étape 4 : "1 candidat(s) placé(s), 5 déjà placé(s)." puis "1 document(s) émis, 5 ignoré(s)." (cinq lignes « Un document valide existe déjà. »). Étape 5 : la ligne passe à « Révoqué » avec son motif ; le lot suivant émet "1 document(s) émis, 5 ignoré(s)." et la nouvelle ligne est `Convocation v2`.

⚠️ *Test d'erreur* : sur la fiche de DIABATE Nadia, **« Émettre : Attestation de réussite »** → "Ce document exige un résultat officiel publié.".

☐ OK ☐ KO

---

### Étape 243 — Vue famille avant les résultats (parent et élève)
👤 **parent** (secondaire-test, `parent@secondaire-test.test`, sans MFA) · fenêtre **B** · 📂 Menu **« Examens de mes enfants »** (`/v2/examinations/family`)

1. Se connecter en parent. Lire les deux cartes `DIABATE Nadia — BEPC test guide (démonstration) 2027` et `DIABATE Salimata — …`.
2. Se déconnecter, se connecter en **élève** (`eleve@secondaire-test.test`, sans MFA, correspond à DIABATE Nadia) : menu **« Mon examen »**.
3. Cliquer **« Télécharger »** sur la convocation.

✅ Parent : titre « Examen de mon enfant » ; chaque carte montre la pastille « Inscrit », le « Numéro de candidat » (`TG_BEPC2027-00001`, `…-00002`), le « Début des épreuves » (14 juin 2027), la « Place » (`Centre Cocody test guide, salle S1, place 1`, `… place 2`), « Le résultat n'est pas encore publié. » et la convocation avec « Télécharger ». Aucune note, moyenne ni rang ; pas d'inscription à l'examen blanc `BLANC-DEMO` ; aucun autre élève. Élève : titre « Mon examen », une seule carte, celle de Nadia ; le PDF s'ouvre.

🔒 *Test de droit* : en tant que parent, taper `/v2/examinations/results` → page « Accès refusé » ("Vous n'avez pas les droits nécessaires pour afficher cette page.").

☐ OK ☐ KO

---

### Étape 244 — Passer en « Épreuves en cours » et saisir les notes par épreuve
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 détail de session, puis **« Notes et résultats »** (`/v2/examinations/results`) > onglet **« Notes par épreuve »**

1. Sur le détail de session, cliquer **« Passer à : Épreuves en cours »** : la répartition est figée (message « La répartition est figée à ce stade de la session. » dans « Répartition »).
2. Dans « Notes par épreuve », saisir (champs « Note de `<nom>` en `<épreuve>` » ; liste « État de la note de `<nom>` en `<épreuve>` » pour Absent/Excusé) :

| Candidat | `TG_EP1` | `TG_EP2` |
| :--- | :--- | :--- |
| DIABATE Nadia | `13` | `11` |
| DIABATE Salimata | `9` | `8` |
| COULIBALY Moussa | `15` | `12` |
| KOUASSI Yves test guide | `10` | `11` |
| KONE Mariam test guide | état « Absent » | état « Absent » |
| BAMBA Fanta test guide | état « Excusé » | état « Excusé » |

3. Cliquer **« Enregistrer les notes modifiées (12) »**, puis recharger la page.

✅ Étape 1 : « La session est maintenant : Épreuves en cours. » (50 %). Étape 3 : « 12 note(s) enregistrée(s), 0 inchangée(s). » ; les valeurs persistent ; la colonne `TG_EP3 /10` affiche « — » pour tous (aucune filière affectée). La fiche de DIABATE Nadia montre "13 / 20" et "11 / 20", origine « Saisie à la main ».

⚠️ *Test d'erreur* : note `21` pour Nadia en `TG_EP1` → rapport "0 note(s) enregistrée(s)…" avec la ligne refusée "la note 21.000 dépasse le barème 20.000 de l'épreuve (examinations.score_above_scale)" ; puis **« Annuler les modifications »**.

☐ OK ☐ KO

---

### Étape 245 — Saisir les résultats de l'autorité et passer à « Résultats saisis »
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 **« Notes et résultats »** > onglet **« Résultats »**

La plateforme n'invente pas l'admission d'un examen officiel : elle enregistre le résultat communiqué par l'autorité, tel quel (non recalculé à partir des notes).

1. Dans « Saisir un résultat », enregistrer un par un (**« Enregistrer le résultat »**) :

| Candidat | Résultat | Moyenne | Rang | Mention |
| :--- | :--- | :--- | :--- | :--- |
| DIABATE Nadia | Admis | `12,5` | `2` | `AB` |
| DIABATE Salimata | Refusé | `8,75` | `5` | (vide) |
| COULIBALY Moussa | Admis | `14` | `1` | `BIEN` |
| KOUASSI Yves test guide | Admis | `10,25` | `3` | (vide) |
| KONE Mariam test guide | Absent | (vide) | (vide) | (vide) |

2. Sur le détail de session, cliquer **« Passer à : Résultats saisis »**.
3. Constater que « Passer à : Résultats publiés » est désactivé.
4. Revenir dans « Résultats » et saisir : `BAMBA Fanta test guide`, « Différé », sans moyenne. Recharger le détail de session.

✅ Étape 1 : « 1 résultat(s) enregistré(s). » à chaque fois ; cinq lignes, origine « Saisi à la main », publication « Non publié ». Étape 2 : « La session est maintenant : Résultats saisis. » (67 %). Étape 3 : point bloquant "1 candidat(s) inscrit(s) sans résultat : saisir ou importer leur résultat (absent, différé…) avant la publication." Étape 4 : « Avec résultat » 6, plus de point bloquant, « Passer à : Résultats publiés » actif (ne pas encore cliquer). Colonne « Issue » de « Candidats » : « Admis », « Refusé », « Absent », « Différé ».

⚠️ *Test d'erreur* : « Absent » avec Moyenne `10` → "Un absent, exclu ou ajourné n'a ni moyenne, ni rang, ni mention.".

☐ OK ☐ KO

---

### Étape 246 — Corriger une note après la clôture des notes (quatre yeux)
👤 **responsable des examens** (secondaire-test), puis **directeur** (secondaire-test, MFA) · fenêtre **A** · 📂 Menu **« Examens »** > **« Corrections »** (`/v2/examinations/corrections`), session `Session BEPC test guide`

1. Examens : dans « Nouvelle demande de correction », saisir :

| Champ | Valeur |
| :--- | :--- |
| Objet de la correction | « Une note » |
| Candidat | `DIABATE Salimata` |
| Épreuve | `TG_EP1 — Mathématiques test guide` |
| État proposé | « Saisie » |
| Note proposée | `10` |
| Motif | `Erreur de report de la note constatée à la relecture des copies.` |

2. Cliquer **« Envoyer la demande »**. Constater l'absence de « Approuver » / « Rejeter » pour ce compte.
3. Directeur : ouvrir la même page et la même session, cliquer **« Approuver »** sur la carte.
4. Examens : dans « Notes par épreuve », changer la note de DIABATE Nadia en `TG_EP1` de `13` à `14`, cliquer **« Enregistrer les notes modifiées (1) »**, puis **« Annuler les modifications »**.

✅ Étape 2 : « Demande envoyée : une autre personne doit l'approuver. » ; carte "Note — TG_BEPC2027-00002" (« En attente », valeur actuelle 9). Étape 3 : la carte passe à « Approuvée » (filtre « Approuvées ») et « Notes par épreuve » affiche `10` pour Salimata en `TG_EP1`. Étape 4 : "0 note(s) enregistrée(s), 0 inchangée(s)." avec la ligne refusée "une note saisie après clôture ne se corrige que par une révision approuvée (examinations.score_revision_required)".

⚠️ *Test d'erreur* : motif de 5 caractères → "Au moins 10 caractères." ; seconde demande sur la même note tant que la première est en attente → "Une demande de révision est déjà en attente pour cette cible.".

⚠️ *Écart connu* : la valeur proposée peut s'afficher avec des clés techniques (`toStatus`, `toScore`).

☐ OK ☐ KO

---

### Étape 247 — Le demandeur n'approuve pas sa propre demande
👤 **directeur** (secondaire-test, MFA) puis **propriétaire** (secondaire-test, `direction.generale@secondaire-test.test`, MFA) · fenêtre **A** · 📂 **« Corrections »**, session `Session BEPC test guide`

1. Directeur : « Nouvelle demande de correction » > « Une note » > Candidat `KOUASSI Yves test guide`, Épreuve `TG_EP2 — Français test guide`, État « Saisie », Note `12`, Motif `Erreur de report relevée lors du contrôle interne.` > **« Envoyer la demande »**.
2. Directeur : sur la carte, cliquer **« Approuver »**.
3. Directeur : cliquer **« Rejeter »**, saisir un motif d'au moins 5 caractères, cliquer **« Rejeter »**.
4. Propriétaire : se connecter, ouvrir « Corrections », cliquer **« Approuver »** sur cette carte.

✅ Étape 2 : "Une révision est approuvée par une autre personne que celle qui l'a demandée." (la note reste `11`). Étape 3 : "Une demande est décidée par une autre personne que celle qui l'a faite.". Étape 4 : carte « Approuvée » ; « Notes par épreuve » affiche `12` pour Yves en `TG_EP2`.

☐ OK ☐ KO

---

### Étape 248 — Lire les statistiques de la session
👤 **directeur des études** (secondaire-test, `etudes@secondaire-test.test`, MFA) · fenêtre **A** · 📂 Menu **« Examens »** > **« Statistiques »** (`/v2/examinations/statistics`), session `Session BEPC test guide`

1. Avec « Regrouper » = « Ensemble », lire le tableau « Statistiques d'examen ».
2. Choisir « Regrouper » = « Par sexe ».
3. Dans « Comparer avec », choisir « L'examen blanc ».

✅ Ensemble : Inscrits 6, Présents 5, Admis 3, Refusés 1, Absents 1, Exclus 0, Différés 1, Taux 60 % *(forme exacte du pourcentage à relever)*. Par sexe : « Filles » (4 inscrits, 3 présents, 1 admis, 1 refusé, 1 absent, 1 différé, taux voisin de 33,3 %) et « Garçons » (2 inscrits, 2 présents, 2 admis, 100 %), puis « Total ». Comparaison : second tableau "Comparaison : Examen blanc … BEPC blanc test guide" avec compteurs à zéro (tant que l'examen blanc n'est pas inscrit) et taux « — ». Le directeur des études est en lecture seule : pas de bouton d'action.

🔒 *Test de droit* : en tant que directeur des études, taper `/v2/examinations/centers` → page « Accès refusé ».

☐ OK ☐ KO

---

### Étape 249 — Examen blanc : figer, ouvrir, inscrire, refus de liaison
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 détail de `BEPC blanc test guide`, puis **« Candidats »** et **« Examens blancs »** (`/v2/examinations/mock`)

1. Dans le détail de `BEPC blanc test guide`, cliquer **« Copier et figer la définition »** puis **« Passer à : Inscriptions ouvertes »**.
2. Dans « Candidats », session `BEPC blanc test guide` : ajouter les élèves de `6e A` (**« Ajouter les élèves »**), cliquer **« Sélectionner la page »** puis **« Inscrire la sélection (9) »**.
3. Dans « Examens blancs », session `BEPC blanc test guide`, bloc « Lier une évaluation » : Épreuve `TG_EP1 — Mathématiques test guide`, Classe `6e A`, Évaluation `Examen blanc (démonstration)`, puis **« Lier l'évaluation »**.

✅ Étape 1 : « Définition copiée : 3 épreuve(s). ». Étape 2 : un avis remplace le bloc des candidats libres ("Les candidats libres ne concernent que les sessions officielles.") ; « 9 candidat(s) ajouté(s), 0 déjà présent(s). » puis « 9 candidat(s) inscrit(s). » (les numéros repartent de `TG_BEPC2027-00001` : compteur propre à la session ; un examen blanc n'exige ni éligibilité évaluée ni pièces). Étape 3 : refus "Cette évaluation alimente déjà une épreuve." (elle alimente `BLANC-DEMO`).

*(Lecture seule sur `Session BLANC-DEMO` : voir le chapitre pour son recalcul ; ne pas la publier.)*

☐ OK ☐ KO

---

### Étape 250 — Publier les résultats de la session (⚠️ Irréversible)
👤 **responsable des examens** (secondaire-test), puis **directeur** (secondaire-test, MFA) · fenêtre **A** · 📂 détail de `Session BEPC test guide`

1. Examens : cliquer **« Passer à : Résultats publiés »**. Dans la fenêtre « Publier les résultats », cliquer **« Publier »**, puis **« Annuler »**.
2. Directeur : même chemin, cliquer **« Passer à : Résultats publiés »**, puis **« Publier »** (valider la seconde vérification si elle s'ouvre).
3. Ouvrir **« Notes et résultats »** > **« Résultats »**.

✅ Étape 1 : texte "Les résultats de 6 candidat(s) deviennent visibles des familles. Après publication, toute modification passe par une correction approuvée par une autre personne." ; le responsable est refusé : "La publication des résultats exige la permission ‹ exam.result.publish ›." (nom technique affiché tel quel) ; la session reste « Résultats saisis ». Étape 2 : « La session est maintenant : Résultats publiés. » (83 %), « Publiés » 6 ; seule l'étape « Passer à : Archivée » reste. Étape 3 : six lignes « Publié », plus de bouton « Publier ».

☐ OK ☐ KO

---

### Étape 251 — Attestations et relevés, puis correction d'un résultat publié
👤 **responsable des examens** (secondaire-test), puis **directeur** (secondaire-test, MFA) · fenêtre **A** · 📂 **« Exports et documents »** puis **« Corrections »**, session `Session BEPC test guide`

1. Examens : « Document » = « Attestation de réussite » > **« Émettre pour tous les candidats concernés »**.
2. « Document » = « Relevé de notes » > **« Émettre pour tous les candidats concernés »** ; télécharger le relevé de `DIABATE Nadia`.
3. « Corrections » > « Nouvelle demande de correction » : Objet « Un résultat », « Résultat concerné » `DIABATE Nadia — Admis`, « Résultat proposé » « Admis », « Moyenne proposée » `13`, Motif `Moyenne mise à jour après relecture du procès-verbal fictif.` > **« Envoyer la demande »**.
4. Directeur : cliquer **« Approuver »** sur cette demande.
5. Retour à « Exports et documents » : relire la liste « Documents émis », puis réémettre l'attestation et le relevé (**« Émettre pour tous les candidats concernés »**).

✅ Étape 1 : "3 document(s) émis, 0 ignoré(s)." (Nadia, Moussa, Yves) et trois lignes refusées "L'attestation de réussite exige un résultat ADMIS publié. (examinations.attestation_requires_admission)" (Salimata, Mariam, Fanta). Étape 2 : "6 document(s) émis, 0 ignoré(s)." ; le PDF du relevé mentionne les notes 13 et 11 et le filigrane de démonstration *(à vérifier visuellement)*. Étape 5 : "Attestation de réussite v1" et "Relevé de notes v1" de Nadia sont « Révoqué » avec le motif "Résultat corrigé par révision approuvée (demande xxxxxxxx)." ; la convocation de Nadia reste « Émis » ; la réémission donne des documents en version 2 ("1 document(s) émis, 2 ignoré(s)." pour l'attestation, "1 document(s) émis, 5 ignoré(s)." pour le relevé).

⚠️ *Test d'erreur* : fiche de DIABATE Salimata > **« Émettre : Attestation de réussite »** → "L'attestation de réussite exige un résultat ADMIS publié.".

☐ OK ☐ KO

---

### Étape 252 — Vue famille après publication
👤 **parent** (secondaire-test) puis **élève** · fenêtre **B** · 📂 Menu **« Examens de mes enfants »** / **« Mon examen »** (`/v2/examinations/family`)

1. Parent : lire les cartes de Nadia et de Salimata.
2. Élève : lire la carte de Nadia, cliquer **« Télécharger »** sur l'attestation.

✅ Parent : Nadia « Résultat : » pastille « Admis » avec les documents « Convocation », « Attestation de réussite », « Relevé de notes » (versions valides seulement, v1 révoquées absentes) ; Salimata « Résultat : » pastille « Refusé » avec « Convocation » et « Relevé de notes ». Aucune note, moyenne ni rang. Élève : carte de Nadia seule, mêmes informations ; le PDF s'ouvre.

☐ OK ☐ KO

---

### Étape 253 — Archiver la session (⚠️ Irréversible)
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · 📂 détail de `Session BEPC test guide`

1. Cliquer **« Passer à : Archivée »** (aucune confirmation demandée).

✅ « La session est maintenant : Archivée. », avancement 100 %, « Aucune étape suivante possible. ». Les écrans restent consultables ; notes et répartition ne sont plus modifiables.

🔒 *Test de droit* : en tant que responsable des examens, taper `/v2/examinations/family` → page « Accès refusé ».

☐ OK ☐ KO

---

> **Variante primaire (CEPE de démonstration).** À l'École Les Palmiers (`primaire-test`, `examens@primaire-test.test`), aucune donnée d'examen n'est semée. Le bouton **« Charger le pack du primaire (fictif) »** (écran « Types d'examens ») crée le type `CEPE` ; on y crée ensuite un centre `TG-CTRP`, la session `TG-CEPE-2027` "CEPE 2027 test guide", des candidats libres (sans règle liée : éligibilité saisie à la main, pièce « vue sur place »), puis on **importe les résultats communiqués par l'autorité** avec trois fichiers (`20-examens-resultats-cepe-entete-invalide.csv`, `20-examens-resultats-cepe-erreurs.csv`, `20-examens-resultats-cepe.csv`) que la direction applique, avant publication. Toute la variante se déroule dans le chapitre 20, scénarios 20.35 à 20.41 (partie B). Les jeux de règles restent des données de démonstration.

📚 *Pour aller plus loin* : chapitre 20, scénarios 20.30 à 20.33 (examens blancs de démonstration, imports et exports sans format publié), 20.35 à 20.41 (primaire), 20.42 (supérieur : aucun parcours) et 20.43 (adresses interdites, isolation entre établissements, clavier).

**Ce que la phase laisse dans l'application :**
- Type `TG_BEPC` "BEPC test guide (démonstration)", filière `TGA` "Série A test guide", épreuves `TG_EP1` "Mathématiques test guide", `TG_EP2` "Français test guide", `TG_EP3` "Épreuve de série A test guide".
- Centre `TG-CTR1` "Centre Cocody test guide" avec les salles `S1` (3 places), `S2` (2 places), `S3` (2 places).
- Session officielle `TG-BEPC-2027` "Session BEPC test guide" (état « Archivée »), numéros `TG_BEPC2027-00001` à `00006` (Nadia, Salimata, Moussa, Yves, Mariam, Fanta), identifiant officiel `TG-OFF-0001` (Nadia), résultats publiés, convocations, attestations et relevés (dont des v1 révoqués).
- Session `TG-BLANC-2027` "BEPC blanc test guide" (« Inscriptions ouvertes », 9 candidats inscrits).
- Candidats libres "KOUASSI Yves test guide", "SORO Aya test guide", "KONE Mariam test guide", "TRAORE Seydou test guide" (retiré), "YAO Adjoua test guide", "DIABATE Ibrahim test guide", "BAMBA Fanta test guide", "COULIBALY Karim test guide" (anonymisé).
- Demandes de correction : 2 notes (Salimata `TG_EP1` = 10, Yves `TG_EP2` = 12) et 1 résultat (Nadia, moyenne 13) approuvées.

---

## Phase 14 — Paie d'un enseignant

L'économe configure la paie de l'enseignant TRAORE Kouadio, calcule la période "Septembre test guide", ajuste le bulletin ; le directeur arrête le montant, l'économe constate le versement ; l'enseignant consulte son bulletin ; un second cycle (octobre) montre la séparation des tâches, la contestation et la masse salariale.

Précondition : aucune donnée de paie n'est semée (listes vides). Enseignants du collège : **TRAORE Kouadio** (compte `enseignant@secondaire-test.test`, seul à se connecter), YAO Fatou et KOUAME Adjoua (fiches sans compte) ; relire leurs noms dans la liste du personnel. Dates : J = jeudi 8 octobre 2026, la période d'octobre (01/10/2026 au 31/10/2026) contient le jour du pointage. Montants en F CFA entiers, pas de règle officielle de cotisations ou d'impôt.

### Étape 254 — Lire l'état initial des écrans de paie
👤 **économe** (secondaire-test, `econome@secondaire-test.test`, MFA) · fenêtre **A** · 📂 Menu **« Bulletins de paie »** (`/v2/payroll`)

1. Se connecter en économe. Lire le titre « Périodes de paie » et la barre de section (« Périodes », « Bulletins », « Configuration », « Historique », « Rapports »).
2. Ouvrir successivement « Bulletins » (`/v2/payroll/payslips`), « Historique » (`/v2/payroll/history`), « Configuration » (`/v2/payroll/configuration`) et « Rapports » (`/v2/payroll/reports`).

✅ « Aucune période de paie » / « Créez la première période pour calculer les bulletins. » ; « Aucun bulletin » ; « Aucun bulletin arrêté » ; « Aucune configuration » avec "Un enseignant sans configuration est écarté du calcul de la paie." ; « Aucune donnée pour ces filtres ». Aucune erreur. (Si la base a déjà servi, les listes peuvent contenir d'autres lignes.)

☐ OK ☐ KO

---

### Étape 255 — Lire les réglages de la paie (propriétaire)
👤 **propriétaire** (secondaire-test, `direction.generale@secondaire-test.test`, MFA) · fenêtre **A** · 📂 **« Bulletins de paie »** > **« Configuration »** > **« Réglages »** (`/v2/payroll/configuration/settings`)

1. Se connecter en propriétaire. Lire « Devise : XOF » et les valeurs de départ : « Seuil d'heures supplémentaires par défaut (minutes par semaine) » = `2400`, « Majoration par défaut » = `1,5`, « Séparation des tâches » décochée, « Seuil de validation par le propriétaire » vide.
2. Saisir une majoration `6`, cliquer **« Enregistrer les réglages »**.
3. Remettre `1,5`, cliquer **« Enregistrer les réglages »**.

✅ Étape 2 : "Le coefficient doit être compris entre 1 et 5." (rien n'est enregistré). Étape 3 : « Les réglages ont été enregistrés. » ; les valeurs de départ sont conservées après rechargement.

🔒 *Test de droit* : en tant qu'économe (puis directeur), taper `/v2/payroll/configuration/settings` → page « Accès refusé » (les réglages restent au propriétaire).

☐ OK ☐ KO

---

### Étape 256 — Configurer la paie de TRAORE Kouadio et de YAO Fatou
👤 **économe** (secondaire-test) · fenêtre **A** · 📂 **« Configuration »** > **« Configurations »** (`/v2/payroll/configuration`)

1. Cliquer **« Nouvelle configuration »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Enseignant | `TRAORE Kouadio` |
| Type de rémunération | « Mixte » |
| Salaire mensuel | `150000` |
| Tarif horaire par défaut | `3000` |
| Seuil d'heures supplémentaires (minutes par semaine) | `1` |
| Majoration des heures supplémentaires | `2` |
| En vigueur à partir du | `01/08/2026` |

2. Cliquer **« Enregistrer »**.
3. Créer la configuration de **YAO Fatou** : Type « Horaire », Tarif horaire par défaut `3000`, En vigueur à partir du `01/08/2026` > **« Enregistrer »**.
4. Ne pas configurer KOUAME Adjoua. Dans « Situation d'un enseignant », choisir TRAORE Kouadio puis KOUAME Adjoua.

✅ « La configuration a été enregistrée. » à chaque fois. Ligne TRAORE : Type « Mixte », « Salaire mensuel » 150 000 F CFA, « Tarif horaire par défaut » 3 000 F CFA, « Heures supplémentaires » "au-delà de 0 h 01/semaine, ×2" (le seuil de 1 minute est une valeur de test qui produira des heures supplémentaires avec deux minutes de pointage), « Validité » « Depuis le 01/08/2026 ». « Situation d'un enseignant » : « Configuration en cours » pour TRAORE ; « Aucune configuration » pour KOUAME.

⚠️ *Test d'erreur* : seconde configuration de TRAORE débutant le `01/09/2026` → "Une autre configuration de paie couvre déjà ces dates pour cet enseignant." ; Type « Salaire » sans salaire → "Une configuration salariale ou mixte exige un salaire mensuel ou annuel.".

☐ OK ☐ KO

---

### Étape 257 — Définir les tarifs horaires et les simuler
👤 **économe** (secondaire-test) · fenêtre **A** · 📂 **« Configuration »** > **« Tarifs horaires »** (`/v2/payroll/configuration/rates`)

1. Attendu : « Aucun tarif ». Cliquer **« Nouveau tarif »** : Cours "Mathématiques" (de la liste), Enseignant (tarif nominatif) vide, Tarif horaire `4000`, Valide à partir du `01/09/2026`, Notes `Tarif générique test guide` > **« Enregistrer »**.
2. Créer le tarif nominatif : même cours, Enseignant (tarif nominatif) `TRAORE Kouadio`, Tarif horaire `5000`, Valide à partir du `01/09/2026`, Notes `Tarif nominatif test guide` > **« Enregistrer »**.
3. Dans « Simulateur de tarif », cliquer **« Simuler »** pour : (a) TRAORE Kouadio + Mathématiques + aujourd'hui ; (b) YAO Fatou + Mathématiques + aujourd'hui ; (c) KOUAME Adjoua, cours vide.

✅ « Le tarif a été enregistré. » ×2. (a) « Tarif retenu : 5 000 F CFA par heure » (tarif du cours pour cet enseignant) ; (b) « Tarif retenu : 4 000 F CFA par heure » (tarif générique du cours) ; (c) « Aucun tarif applicable. Aucune configuration. ». Un simple pointage d'arrivée et de départ n'a pas de cours : il se paie au tarif par défaut de la configuration (3 000 F CFA).

⚠️ *Test d'erreur* : Tarif horaire `4000,5` → "Le montant est un entier en francs : pas de virgule ni de point.".

☐ OK ☐ KO

---

### Étape 258 — Créer la période "Septembre test guide"
👤 **économe** (secondaire-test) · fenêtre **A** · 📂 **« Périodes »** (`/v2/payroll`) > **« Nouvelle période »**

1. Cliquer **« Nouvelle période »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Nom | `Septembre test guide` |
| Du | `01/09/2026` |
| Au | `30/09/2026` |
| Année scolaire | l'année en cours (2026-2027) |
| Description | `Période de test du guide` |

2. Cliquer **« Créer la période »**.

✅ Bandeau "La période ‹ Septembre test guide › a été créée." ; la ligne affiche « Du 01/09/2026 au 30/09/2026 », « Collective », les badges « Brouillon » et « En attente de calcul » ; un avertissement indique que la période est en attente de calcul (lien « Ouvrir la période ») et le bouton « Nouvelle période » est désactivé.

⚠️ *Test d'erreur* : « Au » = `31/08/2026` avec « Du » = `01/09/2026` → "La date de fin précède la date de début.".

☐ OK ☐ KO

---

### Étape 259 — Aperçu puis calcul de la période
👤 **économe** (secondaire-test) · fenêtre **A** · 📂 clic sur le nom de la période (`/v2/payroll/periods/<identifiant>`)

1. Dans « Calcul de la paie », laisser « Origine des heures » sur « Toutes les origines » et cliquer **« Aperçu (sans enregistrer) »**.
2. Cliquer **« Lancer le calcul »**.
3. Recliquer **« Lancer le calcul »** (sans cocher « Recalculer les bulletins déjà calculés »).

✅ Étape 1 : « Aperçu : aucun bulletin n'a été créé ni modifié. » ; TRAORE Kouadio « Calculé » à 150 000 F CFA (« Salaire » 150 000, aucune ligne d'heures) ; YAO Fatou « Écarté » ("Aucune heure validée sur la période.") ; KOUAME Adjoua « Écarté » ("Aucune configuration de paie valide sur la période."). Étape 2 : « Compte rendu du calcul » avec « Calculés » 1 ; la période passe à « Active » ; « Bulletins de la période » liste TRAORE Kouadio (« Mixte », « Calculé », 150 000 F CFA) ; « Nouvelle période » est de nouveau actif. Étape 3 : TRAORE est « Écarté » avec "Déjà calculé : cochez recalculer pour le reconstruire" (aucun doublon).

⚠️ *Écart connu* : le motif d'écart s'affiche deux fois (libellé puis message de l'API).

☐ OK ☐ KO

---

### Étape 260 — Ajouter une prime et une retenue
👤 **économe** (secondaire-test) · fenêtre **A** · 📂 clic sur le nom de TRAORE Kouadio dans « Bulletins de la période » (`/v2/payroll/payslips/<identifiant>`)

1. Lire « Bulletin de TRAORE Kouadio », badge « Calculé », « Aucune ligne d'heures (bulletin de salaire). ».
2. Dans « Primes et retenues », cliquer **« Ajouter une prime ou une retenue »** :

| Champ | Valeur |
| :--- | :--- |
| Nature | « Prime » |
| Montant | `10000` |
| Libellé | `Prime d'assiduité test guide` |
| Motif | `Assiduité de septembre` |

3. Cliquer **« Ajouter »**. Ajouter ensuite : Nature « Retenue », Montant `2000`, Libellé `Avance sur salaire test guide`.

✅ « L'ajustement a été ajouté. » ; lignes "Prime — Prime d'assiduité test guide" (+ 10 000 F CFA) et "Retenue — Avance sur salaire test guide" (− 2 000 F CFA) ; « Primes » 10 000, « Retenues » 2 000, **Total = 158 000 F CFA** (150 000 + 10 000 − 2 000).

⚠️ *Test d'erreur* : Montant `1500,5` → "Le montant est un entier en francs : pas de virgule ni de point." ; retenue de `999999` → "Les retenues dépassent le montant du bulletin.".

☐ OK ☐ KO

---

### Étape 261 — L'économe ne peut ni arrêter, ni contester, ni annuler
👤 **économe** (secondaire-test) · fenêtre **A** · 📂 fiche du bulletin de TRAORE Kouadio, puis fiche de la période

1. Sur la fiche du bulletin, chercher « Arrêter le montant », « Contester », « Annuler le bulletin ».
2. Sur la fiche de la période, dans « Bulletins de la période », chercher « Arrêter la sélection (0) » et « Tout arrêter ».

✅ Ces cinq boutons sont **absents** pour l'économe ; « Verser la sélection (0) » et « Tout verser » sont présents. L'indication sur la séparation des tâches et le seuil du propriétaire reste affichée.

☐ OK ☐ KO

---

### Étape 262 — L'enseignant ne voit pas un bulletin « Calculé »
👤 **enseignant** (secondaire-test, `enseignant@secondaire-test.test`, sans MFA) · fenêtre **B** · 📂 Menu **« Mes bulletins de paie »** (`/v2/teacher/payslips`)

1. Se connecter en TRAORE Kouadio (enseignant) et ouvrir le menu.

✅ Encart "Vous voyez vos bulletins à partir de l'arrêt du montant : un brouillon calculé reste réservé à la gestion." ; « Aucun bulletin » ; « Vos bulletins apparaîtront ici dès que leur montant sera arrêté. ».

🔒 *Test de droit* : en tant qu'enseignant, taper `/v2/payroll` → page « Accès refusé ».

☐ OK ☐ KO

---

### Étape 263 — Le directeur arrête le montant du bulletin
👤 **directeur** (secondaire-test, `directeur@secondaire-test.test`, MFA) · fenêtre **A** · 📂 **« Bulletins de paie »** > **« Bulletins »** > TRAORE Kouadio

1. Se connecter en directeur. Sur la fiche du bulletin, cliquer **« Arrêter le montant »**.
2. Dans la fenêtre « Arrêter ce bulletin de paie ? » (« Le montant arrêté devient le montant à payer ; il ne pourra plus être recalculé. »), cliquer **« Arrêter le montant »**.

✅ « Le montant du bulletin est arrêté. » ; badge « Arrêté (impayé) » ; « Calculé » par l'économe et « Arrêté » par le directeur ; bloc « Bulletin arrêté » avec le filigrane "NON VERSÉ", « Intégrité vérifiée », Salaire 150 000, Primes 10 000, Retenues 2 000, Total 158 000 F CFA et une « Empreinte SHA-256 : ». Plus de bouton « Ajouter une prime ou une retenue ». Sont proposés : « Constater le versement », « Contester », « Annuler le bulletin », « Envoyer au titulaire ».

☐ OK ☐ KO

---

### Étape 264 — L'enseignant voit son bulletin arrêté
👤 **enseignant** (secondaire-test) · fenêtre **B** · 📂 **« Mes bulletins de paie »** (`/v2/teacher/payslips`)

1. Recharger la page, cliquer la date du bulletin.
2. Lire le bloc « Bulletin arrêté », puis cliquer **« Télécharger le PDF »**.

✅ Une ligne : statut « Arrêté (impayé) », « Primes » 10 000 F CFA, « Retenues » 2 000 F CFA, « Montant » 158 000 F CFA, « Versé le » « Pas encore versé ». Fiche : « Bulletin de paie », « Retour à mes bulletins », « Contester ce bulletin », badge "NON VERSÉ". Le téléchargement échoue avant le versement : "Le PDF officiel n'est disponible qu'une fois le bulletin versé ; utilisez l'aperçu imprimable en attendant.".

⚠️ *Écart connu* : le bouton « Télécharger le PDF » est proposé avant le versement alors que le PDF n'existe qu'après (erreur 409).

☐ OK ☐ KO

---

### Étape 265 — Constater le versement par virement
👤 **économe** (secondaire-test) · fenêtre **A** · 📂 fiche du bulletin de TRAORE Kouadio (« Arrêté (impayé) »)

1. Cliquer **« Constater le versement »**.
2. Saisir « Mode de versement » = « Virement bancaire » et « Référence » = `VIR-TG-001`.
3. Cliquer **« Constater le versement »** dans la fenêtre, puis **« Envoyer au titulaire »**.
4. Enseignant (fenêtre **B**) : recharger `/v2/teacher/payslips`, ouvrir le bulletin, cliquer **« Télécharger le PDF »**.

✅ « Le versement est constaté. » ; badge « Versé » ; mention "Virement bancaire · VIR-TG-001" ; les boutons « Annuler le bulletin » et « Contester » disparaissent (un bulletin versé ne s'annule pas) ; « L'envoi du bulletin à son titulaire a été demandé. » (demande enregistrée, aucun envoi réel). Enseignant : « Versé le » affiche la date, le filigrane "NON VERSÉ" disparaît, « Contester ce bulletin » n'est plus proposé, le PDF scellé se télécharge (sinon « Le document est en cours de préparation. Réessayez dans quelques instants. » *(à vérifier)*).

☐ OK ☐ KO

---

### Étape 266 — Historique et rapports
👤 **économe** (secondaire-test) · fenêtre **A** · 📂 **« Historique »** (`/v2/payroll/history`) puis **« Rapports »** (`/v2/payroll/reports`)

1. Dans « Historique », lire la ligne de TRAORE Kouadio, cliquer **« Exporter en CSV »**.
2. Dans « Rapports », lire « Bulletins par statut », changer « Origine des heures », cliquer **« Exporter en CSV »**.

✅ Historique : statut « Versé », « Arrêté » par le directeur, « Versé » par l'économe (Virement bancaire), « Montant » 158 000 F CFA ; fichier `historique-paie.csv`. Rapports : pour chaque statut, « Présences » + « Séances » + « Hors heures » = « Total » (le salaire est "hors heures") ; fichier `rapport-paie.csv`.

☐ OK ☐ KO

---

### Étape 267 — Pointer son arrivée et son départ (heures de cours d'octobre)
👤 **enseignant** (secondaire-test) · fenêtre **B** · 📂 Menu **« Mes congés et ma présence »** (`/v2/teacher/leaves`)

Précondition : la fonction "présence du personnel" est dans l'offre ; un seul pointage par jour (sinon « La présence du personnel n'est pas incluse dans votre offre. »).

1. Dans « Pointer », cliquer **« Arrivée »**.
2. Attendre **environ deux minutes** (entre 1 min 30 s et 2 min 29 s, la durée est arrondie à la minute).
3. Cliquer **« Départ »**.

✅ « Arrivée enregistrée. » puis « Départ enregistré. » ; la ligne du jour dans « Présences » affiche « Arrivée » et « Départ ». Avec D = 2 minutes et la configuration de test (seuil 1 minute, ×2) : heures = 50 + 100 × (D − 1) = **150 F CFA** ; le bulletin d'octobre vaudra 150 000 + 150 = **150 150 F CFA** (si D ≠ 2, recalculer ce montant : les chiffres des étapes suivantes changent d'autant).

☐ OK ☐ KO

---

### Étape 268 — Créer la période d'octobre et vérifier l'aperçu des présences
👤 **économe** (secondaire-test) · fenêtre **A** · 📂 **« Périodes »** (`/v2/payroll`) > **« Nouvelle période »**

1. Saisir : Nom `Octobre test guide`, Du `01/10/2026`, Au `31/10/2026`, Année scolaire = l'année en cours > **« Créer la période »**.
2. Ouvrir la fiche, choisir « Origine des heures » = « Présences seulement », cliquer **« Aperçu (sans enregistrer) »**. Ne pas lancer le calcul.

✅ TRAORE Kouadio « Calculé » : une ligne d'origine « Présences » au « Tarif par défaut de la configuration » (3 000 F CFA l'heure) ; heures normales 50 F CFA, heures supplémentaires 100 F CFA par minute après la première (150 F CFA pour D = 2).

☐ OK ☐ KO

---

### Étape 269 — Séparation des tâches : le directeur ne peut pas arrêter ce qu'il a calculé
👤 **propriétaire**, puis **directeur**, puis **propriétaire** (secondaire-test, MFA) · fenêtre **A** · 📂 **« Réglages »**, fiche de la période d'octobre, **« Masse salariale »** (`/v2/payroll/owner`)

1. Propriétaire : dans « Réglages », cocher « Séparation des tâches », laisser « Seuil de validation par le propriétaire » vide, **« Enregistrer les réglages »**.
2. Directeur : fiche de "Octobre test guide", cliquer **« Lancer le calcul »**.
3. Directeur : fiche du bulletin de TRAORE Kouadio, cliquer **« Arrêter le montant »**, confirmer **« Arrêter le montant »**.
4. Propriétaire : « Masse salariale » > ligne "Octobre test guide" > **« Bulletins à valider »** > **« Valider »** en face de TRAORE Kouadio.

✅ Étape 2 : TRAORE « Calculé » (150 150 F CFA) ; YAO Fatou et KOUAME Adjoua « Écarté ». Étape 3 : refus "Séparation des tâches : celui qui a calculé le bulletin ne peut pas l'arrêter." ; le bulletin reste « Calculé ». Étape 4 : « Le bulletin est validé. » et le bulletin passe à « Arrêté (impayé) ».

⚠️ *Écart connu* : si « Masse salariale » est absente de l'offre ("La masse salariale et la validation par le propriétaire ne sont pas incluses dans l'offre de l'établissement."), le noter et passer à l'étape suivante.

☐ OK ☐ KO

---

### Étape 270 — L'enseignant conteste son bulletin, le directeur l'annule
👤 **enseignant**, puis **directeur** (secondaire-test) · fenêtres **B** puis **A** · 📂 `/v2/teacher/payslips/<identifiant>` puis fiche du bulletin d'octobre

1. Enseignant : ouvrir le bulletin d'octobre (« Arrêté (impayé) »), cliquer **« Contester ce bulletin »**, saisir « Motif de la contestation » `Heures de pointage à vérifier test guide`, cliquer **« Envoyer la contestation »**.
2. Directeur : sur le bulletin d'octobre, cliquer **« Annuler le bulletin »**, saisir « Motif de l'annulation » `Contestation acceptée test guide`, confirmer **« Annuler le bulletin »**.
3. Enseignant : recharger `/v2/teacher/payslips`.

✅ Étape 1 : « Votre contestation a été transmise à la gestion de la paie. » ; statut « Contesté » ; "Ce bulletin est contesté : la gestion de la paie l'examine.". Étape 2 : « Le bulletin est annulé. » ; statut « Annulé », plus aucun bouton d'action. Étape 3 : seul le bulletin de septembre (« Versé ») est visible ; le bulletin annulé n'apparaît plus.

⚠️ *Test d'erreur* : motif de 1 ou 2 caractères → "Le motif doit comporter au moins 3 caractères.".

☐ OK ☐ KO

---

### Étape 271 — Recalculer octobre, seuil du propriétaire, versement (⚠️ Irréversible)
👤 **économe**, **propriétaire**, **directeur** (secondaire-test, MFA pour les trois) · fenêtre **A** · 📂 fiche de la période "Octobre test guide"

1. Économe : cliquer **« Lancer le calcul »** (sans recalculer) : un nouveau bulletin de TRAORE Kouadio est « Calculé » (150 150 F CFA).
2. Propriétaire : dans « Réglages », « Seuil de validation par le propriétaire » = `100000`, **« Enregistrer les réglages »**.
3. Directeur : bulletin « Calculé » > **« Arrêter le montant »** > confirmer.
4. Propriétaire : « Masse salariale » > "Octobre test guide" > **« Bulletins à valider »** > **« Valider »**.
5. Économe : sur la fiche de la période, cocher la ligne de TRAORE Kouadio, cliquer **« Verser la sélection (1) »**, Mode de versement « Mobile money », Référence `TG-MM-001`, **« Constater le versement »**.
6. Propriétaire : dans « Réglages », vider le seuil, décocher « Séparation des tâches », **« Enregistrer les réglages »** (retour à l'état de départ).

✅ Étape 3 : refus "Ce montant dépasse le seuil : seul le propriétaire peut arrêter ce bulletin.". Étape 4 : « Le bulletin est validé. ». Étape 5 : « Opération de versement terminée. » et « 1 bulletin versé · 0 inchangé(s) · 0 refusé(s). » ; statut « Versé » avec « Mobile money » et `TG-MM-001`. Si le bulletin n'est pas recréé à l'étape 1, le consigner *(à vérifier)*.

☐ OK ☐ KO

---

### Étape 272 — Lire la masse salariale
👤 **propriétaire** (secondaire-test) · fenêtre **A** · 📂 Menu **« Masse salariale »** (`/v2/payroll/owner`)

1. Lire « Masse salariale comptée » et la note de comptage.
2. Pour "Septembre test guide" et "Octobre test guide", lire les montants par statut et la ligne « Compté ».
3. Lire la ligne "À part — annulés : …" d'octobre.

✅ **308 150 F CFA** comptés ("2 bulletins comptés (hors annulés et contestés).") : septembre « Versé » 158 000 F CFA (1), octobre « Versé » 150 150 F CFA (1) ; « À part — annulés : 150 150 F CFA (1) · contestés : 0 F CFA (0). » (pour D = 2).

☐ OK ☐ KO

---

📚 *Pour aller plus loin* : chapitre 13, scénarios 13.18 à 13.21 (une heure et un jour de salaire ne se paient qu'une fois, clôture et archivage d'une période, « Mes bulletins » du salarié, droits et isolation entre établissements).

**Ce que la phase laisse dans l'application :**
- Configurations de paie : TRAORE Kouadio (Mixte, 150 000 F CFA mensuel, 3 000 F CFA l'heure, seuil 1 minute, ×2, depuis le 01/08/2026) ; YAO Fatou (Horaire, 3 000 F CFA, depuis le 01/08/2026).
- Tarifs : générique "Mathématiques" 4 000 F CFA (`Tarif générique test guide`) ; nominatif TRAORE Kouadio 5 000 F CFA (`Tarif nominatif test guide`).
- Périodes `Septembre test guide` (active) et `Octobre test guide`.
- Bulletins : septembre TRAORE Kouadio 158 000 F CFA (versé, `VIR-TG-001`) ; octobre TRAORE Kouadio 150 150 F CFA (un bulletin annulé, un versé `TG-MM-001`).
- Ajustements `Prime d'assiduité test guide` (10 000 F CFA) et `Avance sur salaire test guide` (2 000 F CFA).
- Un pointage « Arrivée »/« Départ » de TRAORE Kouadio du 8 octobre 2026.
- Réglages de la paie remis à l'état de départ.

---

## Phase 15 — Documents (GED)

Objectif : déposer, versionner, chercher, partager et protéger des pièces dans l'explorateur de documents du Collège Le Baobab, en vérifiant les niveaux de confidentialité selon le rôle.

Précondition : le worker tourne (l'indexation du texte des PDF prend 1 à 2 minutes) ; les fichiers d'essai sont dans `docs/guide-test/jeux-de-donnees/` (préfixe `ged-`). La graine ne dépose **aucun document** : l'explorateur est vide. Aucun antivirus n'est branché : les versions portent le badge « Non analysé » (c'est normal). Ne jamais créer de fichier EICAR.

---

### Étape 273 — Découvrir l'explorateur vide
👤 **secrétariat** (secondaire-test, `secretariat@secondaire-test.test`, MFA) · fenêtre **A** · 📂 Menu **« Documents »** (`/v2/documents`)

Attendu au départ : aucun document ; les 17 catégories de départ sont créées à la première lecture.

1. Ouvrir **« Documents »** : lire le titre, la barre de section (**« Documents »**, **« Recherche dans les PDF »**, **« Échéances »**) et les boutons **« Recherche dans le contenu »**, **« Échéances »**, **« Déposer un document »**.
2. Relever les filtres **« Rechercher »**, **« Catégorie »**, **« Type de document »**, **« Portée »**, **« Échéance »**, **« Concerne »** (le filtre **« État »** est absent pour le secrétariat). Ouvrir la liste **« Catégorie »**.

✅ « Aucun document ne correspond. » avec une aide invitant à déposer un premier document ; la liste **« Catégorie »** compte 17 entrées (par exemple "Règlement intérieur et chartes", "Assurances", "Pièces comptables") ; la barre de section ne contient ni « Catégories », ni « Quarantaine », ni « Paramètres ».

☐ OK ☐ KO

---

### Étape 274 — Déposer le règlement intérieur (niveau « Interne »)
👤 **secrétariat** · fenêtre **A** · 📂 **« Documents »** > bouton **« Déposer un document »** (`/v2/documents`)

1. Cliquer **« Déposer un document »**.
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Catégorie | `Règlement intérieur et chartes` |
| Fichier | `ged-document-test-guide-v1.pdf` |
| Titre | `Règlement intérieur test guide` |
| Description | `Document de démonstration` |
| Étiquettes | `test guide, règlement` |
| Date d'expiration | (vide) |
| Visibilité | « Selon la catégorie » |

3. Cliquer **« Déposer »**.

✅ La page du document s'ouvre (`/v2/documents/<identifiant>`). Badges « Établissement », « Interne » et « Texte en cours de lecture » (puis « Texte cherchable » après 1 à 2 minutes et rechargement). « Fichier actuel » = `ged-document-test-guide-v1.pdf`, « Étiquettes » = `test guide, règlement`, « Empreinte SHA-256 » de 64 caractères. Section "1 version" : « Version 1 · version actuelle » avec le badge « Non analysé ». Boutons **« Télécharger »**, **« Nouvelle version »**, **« Modifier »** ; **pas** de bouton « Archiver » (le secrétariat ne peut pas archiver). Section « Partages » : « Ce document n'est partagé avec personne. » ; section « Historique » : « Document déposé ».

⚠️ *Test d'erreur* : déposer une seconde fois `ged-document-test-guide-v1.pdf` dans la même catégorie, sans personne concernée → "Ce fichier existe déjà dans cette catégorie pour cette personne." (et non « Une erreur est survenue. Veuillez réessayer. »). Aucun document n'est créé.

☐ OK ☐ KO

---

### Étape 275 — Refuser les dépôts invalides
👤 **secrétariat** · fenêtre **A** · 📂 **« Documents »** > **« Déposer un document »** (`/v2/documents`)

Pour chaque ligne : ouvrir la fenêtre, saisir, cliquer **« Déposer »** (ou choisir le fichier : certains refus sont immédiats à la sélection). Si le sélecteur n'affiche pas un fichier, choisir "Tous les fichiers".

| Saisie | Message attendu |
| :--- | :--- |
| Aucun fichier choisi | Choisissez un fichier. |
| Aucune catégorie choisie | Choisissez une catégorie. |
| Catégorie `Assurances` sans date d'expiration | La date d'expiration est obligatoire pour cette catégorie. |
| `ged-fichier-vide-test-guide.pdf` | Le fichier ‹ ged-fichier-vide-test-guide.pdf › est vide. |
| `ged-note-word-test-guide.docx` dans `Assurances` | Le fichier ‹ ged-note-word-test-guide.docx › n'a pas un format accepté (pdf, jpg, jpeg, png, webp). |
| `ged-faux-pdf-test-guide.pdf` (texte renommé en .pdf) dans `Règlement intérieur et chartes` | Le contenu du fichier ne correspond pas à l'extension ‹ .pdf › (contenu réel : texte). |
| `ged-facture.exe.pdf` | Nom de fichier refusé (extension intermédiaire dangereuse). |

✅ Chaque refus laisse la liste inchangée (aucun document créé). Le type est contrôlé sur le **contenu réel** : le faux PDF est refusé malgré la bonne extension.

*(Facultatif : un fichier de 30 Mo, créé dans PowerShell par `$f=[IO.File]::Create("ged-trop-lourd-test-guide.pdf"); $f.SetLength(31457280); $f.Close()`, donne "dépasse la taille maximale (15 Mo)" ; le supprimer ensuite.)*

☐ OK ☐ KO

---

### Étape 276 — Déposer une pièce à échéance et lire l'écran des échéances
👤 **secrétariat** · fenêtre **A** · 📂 **« Documents »** > **« Échéances »** (`/v2/documents/expirations`)

1. **« Déposer un document »**, catégorie `Assurances` (le texte « Cette catégorie exige une date d'expiration. » s'affiche) :

| Champ | Valeur |
| :--- | :--- |
| Titre | `Attestation d'assurance test guide` |
| Fichier | `ged-image-test-guide.png` |
| Date d'expiration | `28/10/2026` (J + 20 jours) |

2. Cliquer **« Déposer »**. Puis déposer, dans la même catégorie :

| Champ | Valeur |
| :--- | :--- |
| Titre | `Assurance échue test guide` |
| Fichier | `ged-document-test-guide-v1.pdf` |
| Date d'expiration | `07/10/2026` (la veille de J : une date passée est acceptée) |

3. Ouvrir **« Échéances »** (titre « Échéances des documents »). Relever l'« Horizon » (30 jours) et les onglets **« À échoir »**, **« Échus »**, **« Sans échéance »**.
4. Passer l'« Horizon » à `15 jours`.

✅ Badges "Expire dans 20 jours" (attestation) et « Échu le 07/10/2026 » (assurance échue). Horizon 30 jours : « À échoir sous 30 jours » = 1, « Échus » = 1 ; l'onglet **« À échoir »** liste l'attestation, **« Échus »** l'assurance échue. Horizon 15 jours : compteur 0 et « Aucun document n'arrive à échéance dans cet horizon. ». L'onglet **« Sans échéance »** est vide : « Aucun document sans échéance exigée. ».

⚠️ *Test d'erreur* : voir l'étape précédente (date obligatoire pour `Assurances`).

☐ OK ☐ KO

---

### Étape 277 — Déposer une nouvelle version
👤 **secrétariat** · fenêtre **A** · 📂 **« Documents »** > fiche de "Règlement intérieur test guide"

1. Ouvrir la fiche de "Règlement intérieur test guide" et cliquer **« Nouvelle version »** (fenêtre « Déposer une nouvelle version » : « La version 2 remplacera la version actuelle ; les versions précédentes restent consultables. »).
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Nouveau fichier | `ged-document-test-guide-v2.pdf` |
| Note de version | `Mise à jour test guide` |
| Nouvelle date d'expiration | (vide) |

3. Cliquer **« Déposer la version »**.
4. Cliquer **« Télécharger la version 1 »**, puis **« Télécharger la version 2 »**.

✅ Section "2 versions" : « Version 2 · version actuelle » (avec sa note) et « Version 1 » ; « Fichier actuel » = `ged-document-test-guide-v2.pdf` ; le titre ne change pas ; les deux fichiers se téléchargent ; l'historique ajoute « Nouvelle version déposée (version 2) ». Le texte cherchable de la version 1 est effacé aussitôt (vérifié à l'étape *Rechercher dans l'explorateur et dans le contenu des PDF*).

⚠️ *Test d'erreur* : redéposer `ged-document-test-guide-v2.pdf` → "Ce fichier est identique à la version actuelle." ; aucun fichier puis **« Déposer la version »** → Choisissez un fichier.

☐ OK ☐ KO

---

### Étape 278 — Aperçu, téléchargement et historique
👤 **secrétariat** · fenêtre **A** · 📂 **« Documents »** > fiches de documents

1. Déposer dans `Règlement intérieur et chartes` (catégorie à choisir à chaque fois) trois documents :

| Titre | Fichier |
| :--- | :--- |
| `Image test guide` | `ged-image-test-guide.png` |
| `Note de service test guide` | `ged-note-de-service-test-guide.txt` |
| `Note Word test guide` | `ged-note-word-test-guide.docx` |

2. Sur "Règlement intérieur test guide" : cliquer **« Prévisualiser la version 2 »**, puis **« Prévisualiser la version 1 »**, puis **« Télécharger »**.
3. Sur chacun des trois nouveaux documents : cliquer **« Prévisualiser la version 1 »**.
4. Sur "Règlement intérieur test guide", descendre à **« Historique »**.

✅ PDF : « Aperçu de la version 2 » dans un cadre. Image : l'image 64 x 48 s'affiche. Texte : le contenu dans un bloc. **Word : pas d'aperçu**, message "La prévisualisation des documents Office n'est pas activée : téléchargez le fichier." avec un bouton **« Réessayer »** ; le fichier se télécharge normalement. Historique (le plus récent en premier, avec auteur et date) : « Document déposé », « Nouvelle version déposée », « Prévisualisé », « Téléchargé », « Consulté ».

⚠️ *Écart connu* : l'auteur de l'historique peut s'afficher par identifiant de connexion plutôt que par nom. Le cadre PDF peut être bloqué par le navigateur (à relever).

☐ OK ☐ KO

---

### Étape 279 — Modifier les informations d'un document
👤 **secrétariat** · fenêtre **A** · 📂 **« Documents »** > fiche de "Note de service test guide" > **« Modifier »**

1. Cliquer **« Modifier »** (fenêtre « Modifier le document » : « Modifier les informations ne change pas le fichier : pour le remplacer, déposez une nouvelle version. »).
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Titre | `Note de service modifiée test guide` |
| Étiquettes | `test guide, note` |
| Description | `Texte brut` |

3. Cliquer **« Enregistrer »**.

✅ La fenêtre se ferme (aucun message flash) ; le titre et les étiquettes changent sur la fiche et dans la liste ; l'historique ajoute « Informations modifiées ».

⚠️ *Test d'erreur* : sur "Attestation d'assurance test guide", **« Modifier »**, vider « Date d'expiration », **« Enregistrer »** → Cette catégorie exige une date d'expiration.

☐ OK ☐ KO

---

### Étape 280 — Déposer une pièce confidentielle (propriétaire)
👤 **propriétaire** (secondaire-test, `direction.generale@secondaire-test.test`, MFA) · fenêtre **A** · 📂 **« Documents »** > **« Déposer un document »** (`/v2/documents`)

1. Se déconnecter du secrétariat, se connecter en propriétaire. **« Déposer un document »** :

| Champ | Valeur |
| :--- | :--- |
| Catégorie | `Pièces comptables` |
| Document concernant | « Aucune personne (établissement) » |
| Fichier | `ged-comptable-test-guide.pdf` |
| Titre | `Pièce comptable test guide` |

2. Cliquer **« Déposer »**.
3. Déposer ensuite, dans `Règlement intérieur et chartes`, le titre `Scan sans texte test guide` avec `ged-page-sans-texte-test-guide.pdf` (PDF sans aucun texte, comme un scan).
4. Ouvrir `/v2/documents` avec la « Portée » « Tout ce que je peux voir ».

✅ La liste montre tous les documents déposés depuis le début de la phase, dont "Pièce comptable test guide" avec le badge « Confidentiel ». Le propriétaire (comme le directeur) lit tous les niveaux.

☐ OK ☐ KO

---

### Étape 281 — Vérifier les niveaux de confidentialité selon le rôle
👤 **secrétariat**, puis **enseignant** (TRAORE Kouadio, `enseignant@secondaire-test.test`, sans MFA), puis **parent** (DIABATE Séka, `parent@secondaire-test.test`, sans MFA) · fenêtres **A** (secrétariat) et **B** · 📂 **« Documents »** (`/v2/documents`)

Pour chaque compte : ouvrir `/v2/documents`, « Portée » « Tout ce que je peux voir », et noter ce qui est listé. Le secrétariat ouvre aussi **« Déposer un document »** et lit la liste **« Catégorie »**.

✅

| Compte | Règlement intérieur test guide (Interne) | Attestation d'assurance test guide (Restreint) | Pièce comptable test guide (Confidentiel) |
| :--- | :---: | :---: | :---: |
| Secrétariat | oui | oui | **non** |
| Enseignant | oui | **non** | **non** |
| Parent | **non** | **non** | **non** |

La liste de dépôt du secrétariat ne propose pas "Dossier médical", "Contrats de travail" ni "Pièces comptables" (14 catégories sur 17).

☐ OK ☐ KO

---

### Étape 282 — Rechercher dans l'explorateur et dans le contenu des PDF
👤 **propriétaire**, puis **secrétariat** · fenêtre **A** · 📂 **« Documents »** > **« Recherche dans les PDF »** (`/v2/documents/search`)

Précondition : au moins 2 minutes se sont écoulées depuis le dépôt de "Pièce comptable test guide" et de "Scan sans texte test guide" (sinon, réessayer plus tard).

1. Propriétaire, `/v2/documents` : saisir `guide` dans **« Rechercher »**, puis un nom de fichier, puis une étiquette (`règlement`).
2. Propriétaire, `/v2/documents/search` : saisir successivement `b` (1 caractère), `palmierversion2deux`, `baobabcertif2026`, `piece comptable fictive` (sans accent), `caissecompta2026`.
3. Ouvrir les fiches de "Scan sans texte test guide" et de "Règlement intérieur test guide".
4. Se reconnecter en **secrétariat** et chercher `caissecompta2026`.

✅ `b` : « Saisissez au moins 2 caractères. ». `palmierversion2deux` trouve "Règlement intérieur test guide" avec l'extrait surligné. **`baobabcertif2026` ne trouve plus rien** (« Aucun document ne contient ces mots. » : le texte de la version 1 a été effacé à l'arrivée de la version 2). La recherche ignore accents et majuscules ; `caissecompta2026` trouve la pièce comptable pour le propriétaire. "Scan sans texte test guide" porte le badge « Sans texte » et l'avis « Ce PDF ne contient pas de texte (probablement un scan) : il n'est pas cherchable par son contenu. Il n'y a pas de reconnaissance de caractères. » ; le règlement porte « Texte cherchable ». Pour le **secrétariat**, `caissecompta2026` ne donne **aucun résultat** et aucun indice de l'existence de la pièce.

☐ OK ☐ KO

---

### Étape 283 — Partager un document avec une personne, puis retirer le partage
👤 **secrétariat** puis **enseignant** · fenêtres **A** et **B** · 📂 **« Documents »** > fiche de "Attestation d'assurance test guide" > section « Partages »

1. Secrétariat : dans « Partages », saisir :

| Champ | Valeur |
| :--- | :--- |
| Partager avec | `TRAORE` puis choisir TRAORE Kouadio |
| Droit accordé | « Lecture » |
| Fin du partage | (vide) |
| Note | `Pour information test guide` |

2. Cliquer **« Partager »**.
3. Enseignant : `/v2/documents`, « Portée » « Partagés avec moi » ; ouvrir le document, cliquer **« Télécharger »**, chercher **« Nouvelle version »** et **« Modifier »**.
4. Secrétariat : cliquer **« Retirer le partage de TRAORE Kouadio »**. Enseignant : recharger l'explorateur puis rouvrir l'adresse de la fiche.

✅ « Document partagé avec TRAORE Kouadio. » et la ligne "Lecture · sans date de fin · Pour information test guide". L'enseignant voit le document « Restreint » malgré son niveau « Interne » et peut le télécharger, mais n'a ni « Nouvelle version » ni « Modifier ». Après le retrait, le document disparaît de ses listes et son adresse répond "Document introuvable (`<identifiant>`).". L'historique montre « Partagé » puis « Partage retiré ».

⚠️ *Test d'erreur* : le secrétariat se cherche lui-même → "Vous ne pouvez pas partager un document avec vous-même." ; « Fin du partage » = hier → "La date de fin du partage doit être dans le futur.".

☐ OK ☐ KO

---

### Étape 284 — Parent, élève et enseignant déposent leurs propres pièces
👤 **parent**, **élève** (DIABATE Nadia, `eleve@secondaire-test.test`, sans MFA), **enseignant**, puis **secrétariat** · fenêtre **B** (puis **A**) · 📂 taper `/v2/documents`

⚠️ *Écart connu* : aucune entrée de menu ne mène à `/v2/documents` dans les portails parent, élève et enseignant ; il faut taper l'adresse. Si la liste « Catégorie » propose des catégories du personnel au parent (ou d'élève à l'enseignant), le dépôt échoue : à consigner.

1. Parent : `/v2/documents`, lire les options de « Portée » (« Tout ce que je peux voir », « Mes dépôts », « Partagés avec moi », « Mes enfants »), puis **« Déposer un document »** :

| Champ | Valeur |
| :--- | :--- |
| Catégorie | `Pièces d'identité de l'élève` |
| Fichier | `ged-image-test-guide.png` |
| Enfant concerné | `DIABATE Nadia` (la liste ne propose que Nadia et Salimata) |
| Titre | `Extrait de naissance Nadia test guide` |

2. Élève : déposer dans `Pièces d'identité de l'élève` ("Document concernant : DIABATE Nadia") le fichier `ged-document-test-guide-v1.pdf`, titre `Pièce Nadia déposée par l'élève test guide`.
3. Enseignant : déposer dans `Diplômes et attestations` le fichier `ged-image-test-guide.png`, titre `Diplôme enseignant test guide`, puis ouvrir la « Portée » « Mon dossier de personnel ».
4. Secrétariat (A) : déposer pour `DIABATE Salimata` dans `Dossier d'inscription` le fichier `ged-document-test-guide-v1.pdf`, titre `Pièce élève Salimata test guide`. Filtrer ensuite « Concerne » « Élève », « Personne concernée » `DIABATE Nadia`.
5. Parent : recharger « Mes enfants ».

✅ Le parent ne peut choisir que Nadia ou Salimata ; son document est visible dans « Mes enfants » ; l'élève voit sa pièce et celle du parent ; l'enseignant voit son diplôme dans « Mon dossier de personnel » ; le secrétariat voit les pièces d'élèves (niveau « Restreint ») ; le parent voit la pièce de Salimata déposée par le secrétariat (catégorie « Lisible par les tuteurs »).

⚠️ *Test d'erreur* : la liste « Catégorie » de l'enseignant ne propose pas `Contrats de travail`, celle du parent ne propose pas `Pièces comptables`.

☐ OK ☐ KO

---

### Étape 285 — Restreindre la visibilité d'une pièce
👤 **secrétariat**, **parent**, **économe** (`econome@secondaire-test.test`, MFA) · fenêtres **A** et **B** · 📂 **« Documents »** > fiche de "Pièce élève Salimata test guide" > **« Modifier »**

1. Secrétariat : **« Modifier »**, « Visibilité » « Personnel seulement », **« Enregistrer »** (la fenêtre rappelle : « Modifier la visibilité change aussitôt qui peut voir ce document. »). Parent : recharger « Mes enfants ». Économe : ouvrir l'adresse de la fiche.
2. Secrétariat : « Visibilité » « Privé ». Économe : rouvrir la fiche. Propriétaire : rouvrir la fiche.
3. Secrétariat : revenir à « Selon la catégorie ».

✅ « Personnel seulement » : le parent ne voit plus la pièce, l'économe la voit encore (niveau « Restreint »). « Privé » : l'économe obtient "Document introuvable (`<identifiant>`)." ; le propriétaire la voit. Retour à « Selon la catégorie » : le parent la revoit.

☐ OK ☐ KO

---

### Étape 286 — Créer une catégorie et accorder un droit par personne
👤 **propriétaire**, puis **enseignant** · fenêtres **A** et **B** · 📂 **« Documents »** > **« Catégories »** (`/v2/documents/categories`)

1. Propriétaire : lire les cinq groupes et la note « Changer le niveau de confidentialité d'une catégorie change aussitôt qui peut voir ses documents. ». Cliquer **« Nouvelle catégorie »** :

| Champ | Valeur |
| :--- | :--- |
| Code | `TG_CATEGORIE` |
| Type de document | « Établissement » |
| Libellé | `Catégorie test guide` |
| Description | `Catégorie de test du guide` |
| Niveau de confidentialité | « Confidentiel (direction) » |
| Extensions acceptées | laisser .pdf .jpg .jpeg .png cochées |

2. Cliquer **« Enregistrer »**, puis déposer dans cette catégorie le titre `Pièce de catégorie test guide` avec `ged-image-test-guide.png`.
3. Sur la ligne de la catégorie, **« Droits par personne »** : « Personne » `TRAORE Kouadio`, « Droit accordé » « Lecture », **« Accorder le droit »**. Enseignant : ouvrir `/v2/documents`.
4. Propriétaire : **« Retirer »** (droit de TRAORE Kouadio). Enseignant : recharger.

✅ La catégorie apparaît dans « Établissement » ; l'enseignant voit la pièce (confidentielle) tant que le droit existe, plus rien après « Retirer ». Les champs « Code » et « Type de document » ne sont plus modifiables après création.

⚠️ *Test d'erreur* : code `TG-CAT` → Code invalide : majuscules, chiffres et _ (2 à 40 caractères). ; libellé vide → Le libellé est obligatoire.

☐ OK ☐ KO

---

### Étape 287 — Lire les paramètres de stockage et la quarantaine
👤 **propriétaire** · fenêtre **A** · 📂 **« Documents »** > **« Paramètres »** (`/v2/documents/settings`)

1. Lire « Stockage utilisé » (jauge, compteurs « Documents », « Versions », « Archivés », « En quarantaine ») et « Réglages » : « Taille maximale d'un fichier (Mo) » `15`, « Seuils d'alerte d'expiration (jours) » `30, 7, 1`, « Conservation après archivage (jours) » `0`, « Conservation de la quarantaine (jours) » `30`, « Versions maximales par document » `50`.
2. Mettre « Versions maximales par document » à `2`, cliquer **« Enregistrer »**. Sur "Règlement intérieur test guide" (2 versions), **« Nouvelle version »** avec `ged-comptable-test-guide.pdf`.
3. Remettre `50`, **« Enregistrer »**.
4. Ouvrir **« Quarantaine »** (`/v2/documents/quarantine`) et parcourir les onglets.

✅ « Paramètres enregistrés. » ; refus "Ce document a atteint le nombre maximal de versions (2)." ; réglages remis à 50. Quarantaine : « Aucun fichier. » partout (aucun antivirus).

⚠️ *Test d'erreur* : « Taille maximale d'un fichier (Mo) » = `200` → Taille invalide (100 Mo au plus).

☐ OK ☐ KO

---

### Étape 288 — Contrôler les droits et l'isolation des documents
👤 **enseignant**, **chargé d'admissions** (`admissions@secondaire-test.test`, sans MFA), **parent**, **secrétariat** · fenêtre **B** (puis **A**) · 📂 adresses tapées à la main

1. Enseignant : taper `/v2/documents/categories`, `/v2/documents/quarantine`, `/v2/documents/settings`.
2. Chargé d'admissions : taper `/v2/documents`, `/v2/documents/search`, `/v2/documents/expirations`.
3. Secrétariat (A) : déposer `Pièce élève Aya BAMBA test guide` (`Dossier d'inscription`, élève `BAMBA Aya`, `ged-image-test-guide.png`) et copier l'adresse de la fiche.
4. Parent : coller cette adresse, puis `/v2/documents/00000000-0000-0000-0000-000000000000`.

✅ Étapes 1 et 2 : « Accès refusé » ("Vous n'avez pas les droits nécessaires pour afficher cette page."). Étape 4 : les deux adresses donnent **la même réponse** "Document introuvable (`<identifiant>`).", sans révéler l'existence de la pièce de BAMBA Aya.

☐ OK ☐ KO

---

### Étape 289 — ⚠️ Archiver puis restaurer un document
👤 **directeur des études** (`etudes@secondaire-test.test`, MFA), puis **propriétaire** · fenêtre **A** · 📂 **« Documents »** > fiche de "Image test guide"

⚠️ Action sensible : l'archivage retire le document des listes de tout le monde sauf de la gestion ; il se restaure (propriétaire), mais l'historique garde les deux événements.

1. Constater que le secrétariat n'a pas de bouton « Archiver » (étape *Déposer le règlement intérieur*). Directeur des études : ouvrir la fiche, **« Archiver »** (fenêtre « Archiver ce document »).
2. Saisir « Motif de l'archivage » : `ab`, puis `Doublon de test test guide`, cliquer **« Archiver »**.
3. Propriétaire : filtre « État » « Archivés », ouvrir le document, cliquer **« Restaurer »**.

✅ Motif de 2 caractères : « Le motif doit comporter au moins 3 caractères. » ; ensuite « Document archivé : il n'apparaît plus dans les listes. » ; le document disparaît de la liste « Actifs ». Propriétaire : avis « Ce document est archivé. Motif : Doublon de test test guide » ; après **« Restaurer »** : « Document restauré. » ; l'historique garde « Archivé » et « Restauré ».

📚 *Pour aller plus loin* : chapitre 14, scénarios 14.11 (lecture auditée d'un document confidentiel), 14.15 (archivage d'une catégorie, échéance exigée) et 14.18 (isolation entre établissements).

**Ce que la phase laisse dans l'application :** documents (Collège Le Baobab) `Règlement intérieur test guide` (2 versions), `Image test guide`, `Note de service modifiée test guide`, `Note Word test guide`, `Scan sans texte test guide`, `Attestation d'assurance test guide` (échéance 28/10/2026), `Assurance échue test guide`, `Pièce comptable test guide`, `Extrait de naissance Nadia test guide`, `Pièce Nadia déposée par l'élève test guide`, `Diplôme enseignant test guide`, `Pièce élève Salimata test guide`, `Pièce élève Aya BAMBA test guide`, `Pièce de catégorie test guide` ; catégorie `TG_CATEGORIE` ("Catégorie test guide") ; paramètres remis à l'état de départ (15 Mo, 30/7/1, 0, 30, 50).

---

## Phase 16 — Messagerie, annonces et notifications

Objectif : vérifier la communication de l'établissement — messages directs, de groupe et diffusion, annonces ciblées avec accusé de réception, signalement et modération, puis le module « Notifications » (envois, gabarits, règles, canaux, préférences). **Aucun message réel ne part** : e-mail, SMS, WhatsApp et push sont simulés ou non configurés ; seules les notifications « dans l'application » sont réellement remises.

Précondition : le worker tourne (annonces programmées, remise des notifications toutes les 15 secondes environ). La graine contient deux annonces du directeur ("Rentrée : réunion d'information des parents (démonstration)", publiée, épinglée, avec accusé de réception ; "Brouillon : calendrier des compositions (démonstration)") et **aucune conversation**. Fichiers : `ch15-piece-jointe-*` dans `docs/guide-test/jeux-de-donnees/`.

---

### Étape 290 — Découvrir la boîte de messages vide
👤 **parent** (DIABATE Séka, secondaire-test, `parent@secondaire-test.test`, sans MFA) · fenêtre **B** · 📂 Menu **« Modules »** > **« Communication »** > **« Messages »** (`/v2/messages`)

1. Lire le titre « Messages », le bouton **« Nouveau message »** et la barre d'onglets (**« Messages »**, **« Annonces »**, **« Notifications »**, cloche à droite). Les entrées « Modération » et « Paramètres » n'existent pas pour un parent.
2. Cliquer successivement les dossiers **« Boîte de réception »**, **« Favoris »**, **« Archivés »**, **« Envoyés »**.
3. Dans **« Boîte de réception »**, saisir `zzz` dans la recherche.

✅ « Votre boîte de réception est vide. », « Aucune conversation en favori. », « Aucune conversation archivée. », « Vous n'avez encore rien envoyé. » ; la recherche `zzz` donne « Aucune conversation ne correspond à ce filtre. ».

⚠️ *Test d'erreur* : choisir le bouton radio **« Texte des messages »** et saisir 1 caractère → « Saisissez au moins 2 caractères pour chercher dans vos messages. ».

☐ OK ☐ KO

---

### Étape 291 — Écrire un message direct à l'enseignant
👤 **parent** · fenêtre **B** · 📂 **« Messages »** > **« Nouveau message »** (`/v2/messages/new`)

1. Cliquer **« Nouveau message »**. Vérifier que « Type de message » ne propose que **« Message direct »** (coché) et **« Message de groupe »** : pas de « Diffusion » pour un parent.
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Rechercher une personne | `Kouadio` puis choisir TRAORE Kouadio |
| À propos de l'enfant | `DIABATE Nadia` |
| Objet | `Question sur le devoir test guide` |
| Priorité | « Normale » |
| Message | `Bonjour M. TRAORE, pouvez-vous rappeler le devoir de mathématiques pour lundi ? Merci. (test guide)` |

3. Cliquer **« Envoyer »**.

✅ La page de la conversation s'ouvre (`/v2/messages/<identifiant>`) avec le titre "Question sur le devoir test guide" et la bulle du parent à droite (auteur « Vous »). Dans **« Envoyés »** la conversation figure.

⚠️ *Test d'erreur* : aucun destinataire choisi → "Choisissez au moins un destinataire." ; « Message » vide → "Ce champ est obligatoire.". *Portée limitée* : rechercher `BAMBA` (parent d'une autre famille) ou `Nadia` (son enfant) → « Aucune personne autorisée ne correspond à cette recherche. ».

⚠️ *Écart connu* : le texte d'aide parle de "vos classes" même pour un parent (cosmétique).

☐ OK ☐ KO

---

### Étape 292 — L'enseignant lit et répond, le parent lit la réponse
👤 **enseignant** (TRAORE Kouadio, `enseignant@secondaire-test.test`, sans MFA), puis **parent** · fenêtre **B** · 📂 **« Messages »** (`/v2/messages`)

1. Enseignant : repérer dans **« Boîte de réception »** la ligne "Question sur le devoir test guide" (expéditeur en gras, pastille, badge « 1 non lu(s) »). L'ouvrir, revenir avec **« Retour »** : le badge a disparu.
2. Rouvrir la conversation. Dans **« Répondre »**, champ « Votre réponse » : `Bonjour, le devoir porte sur les fractions, page 42. (test guide)`, puis **« Envoyer »**.
3. Parent : ouvrir **« Messages »**, ouvrir la conversation (en gras avec badge non lu) et lire la réponse. Dans **« Boîte de réception »**, choisir le radio **« Texte des messages »** et saisir `fractions`.

✅ La lecture se fait à l'ouverture (pas au simple affichage de la liste) ; la réponse arrive chez le parent (bulle à gauche, auteur TRAORE Kouadio) ; la recherche dans le texte trouve la ligne avec un extrait. Le bouton **« Envoyer »** reste grisé tant que la réponse est vide.

☐ OK ☐ KO

---

### Étape 293 — Favori, sourdine et archivage
👤 **parent** · fenêtre **B** · 📂 **« Messages »** > conversation "Question sur le devoir test guide"

1. Dans « Actions sur la conversation », cliquer **« Favori »** (le libellé devient « Retirer des favoris »), puis **« Sourdine »** (le libellé devient « Réactiver les notifications »), puis **« Archiver »** : retour automatique à « Messages ».
2. Ouvrir **« Favoris »** (la conversation y figure, badge « En sourdine »), puis **« Archivés »**, ouvrir la conversation et cliquer **« Désarchiver »**.
3. Remettre **« Retirer des favoris »** et **« Réactiver les notifications »**.

✅ Les dossiers « Favoris », « Archivés » et « Boîte de réception » reflètent chaque action ; la conversation retrouve son état normal en fin d'étape.

☐ OK ☐ KO

---

### Étape 294 — Joindre une pièce, puis retirer son message
👤 **parent** · fenêtre **B** · 📂 **« Messages »** > **« Nouveau message »**

1. Nouveau message à TRAORE Kouadio, objet `Pièce jointe test guide`, message `Voir le document joint. (test guide)`.
2. Cliquer **« Joindre un fichier »** et choisir successivement `ch15-piece-jointe-fausse-test-guide.pdf` (texte renommé en .pdf), `ch15-piece-jointe-vide-test-guide.pdf` (0 octet), puis `ch15-piece-jointe-test-guide.pdf` (PDF valide, 673 octets).
3. **« Envoyer »**, puis dans le fil cliquer sur la pièce jointe.
4. Sous la dernière bulle du parent, cliquer **« Retirer »** (sans confirmation). Rouvrir le fil avec le compte enseignant.

✅ Faux PDF : "ch15-piece-jointe-fausse-test-guide.pdf : Type de fichier non accepté (contrôlé sur le contenu réel du fichier)." ; fichier vide : "ch15-piece-jointe-vide-test-guide.pdf : Le fichier est vide." ; la pièce valide apparaît en puce ("673 o") avec une croix pour la retirer. Après envoi, un clic sur la pièce l'ouvre dans un nouvel onglet. Après **« Retirer »**, la bulle devient « Message retiré par son auteur » chez le parent et l'enseignant ; les boutons « Retirer » et « Signaler » disparaissent de cette bulle.

☐ OK ☐ KO

---

### Étape 295 — Diffuser un message aux parents de la 6e A
👤 **directeur** (`directeur@secondaire-test.test`, MFA) · fenêtre **A** · 📂 **« Messages »** > **« Nouveau message »** (`/v2/messages/new`)

1. Choisir « Type de message » **« Diffusion »** (les trois types sont proposés : « Message direct », « Message de groupe », « Diffusion ») ; lire "Le même message envoyé en privé à chaque destinataire : ils ne se voient pas.".
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Classe (bloc « Classes ») | `6E-A` via **« Choisir une classe »** puis **« Ajouter la classe »** |
| Personnes visées dans la classe | cocher « Parents et tuteurs » seulement |
| Objet | `Diffusion 6e A test guide` |
| Priorité | « Élevée » |
| Message | `Chers parents, la réunion de classe aura lieu samedi à 9 h. (test guide)` |

3. Cliquer **« Envoyer »**.
4. Parent (B) : la diffusion est dans **« Boîte de réception »** avec le badge « Élevée » ; répondre `Merci, nous serons présents. (test guide)`.
5. Directeur : dans **« Boîte de réception »**, un fil du parent apparaît (réponse privée).

✅ Dans **« Envoyés »** du directeur : badge « Diffusion : n destinataire(s) » (n compte les comptes joignables, pas les élèves). Chaque parent reçoit un fil **privé** ; la réponse revient au directeur sans être visible des autres parents.

⚠️ *Test d'erreur* : diffusion sans classe → "Choisissez au moins un destinataire." ; sans « Objet » → "Un message de groupe ou de diffusion a un objet.".

☐ OK ☐ KO

---

### Étape 296 — Message de groupe sans réponses, puis quitter le groupe
👤 **directeur**, puis **enseignant** · fenêtres **A** et **B** · 📂 **« Messages »** > **« Nouveau message »**

1. Directeur : type **« Message de groupe »**. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Rechercher une personne | `Kouadio` puis TRAORE Kouadio |
| Écrire aussi à l'administration | coché |
| Objet | `Groupe pédagogique test guide` |
| Message | `Point sur les évaluations de la période. (test guide)` |
| Autoriser les réponses des participants | **décocher** |

2. **« Envoyer »**.
3. Enseignant : ouvrir le fil, puis cliquer **« Quitter le groupe »**.

✅ Le directeur voit le badge "Groupe de n" (3 ou plus selon les contacts d'administration). L'enseignant lit l'avertissement "Les réponses sont désactivées dans cette conversation." à la place du formulaire. **« Quitter le groupe »** le ramène à « Messages » et le fil n'y est plus.

☐ OK ☐ KO

---

### Étape 297 — Publier une annonce ciblée sur la 6e A
👤 **secrétariat** (`secretariat@secondaire-test.test`, MFA) · fenêtre **A** · 📂 Menu **« Modules »** > **« Communication »** > **« Annonces »** > **« Nouvelle annonce »** (`/v2/announcements/new`)

⚠️ Irréversible pour les destinataires déjà notifiés : une annonce publiée ne change plus de contenu (elle se retire).

1. Remplir :

| Champ | Valeur |
| :--- | :--- |
| Titre | `Réunion de classe 6e A test guide` |
| Contenu | `Une réunion de classe aura lieu samedi à 9 h en salle 6e A. Merci de confirmer votre présence. (test guide)` |
| Type de cible | « Classe » puis « Classe » = `6E-A`, puis **« Ajouter la cible »** |
| Personnes visées | « Parents et tuteurs » seulement (décocher « Élèves ») |
| Priorité | « Normale » |
| Publier le / Expire le | (vides) |
| Demander un accusé de réception | coché |
| Épingler en tête de liste | coché |

2. Cliquer **« Compter les destinataires »**, puis **« Enregistrer le brouillon »** (la fiche s'ouvre au statut « Brouillon »), puis **« Publier maintenant »**.
3. Parent (B) : ouvrir **« Annonces »**.

✅ "n destinataire(s)" s'affiche (n = comptes joignables, probablement 1 : le compte Parent). « L'annonce est publiée. », statut « Publiée ». Le parent voit l'annonce en tête, épinglée, avec le badge « Accusé à donner ». Sur la fiche publiée, plus de lien « Modifier » ni de bouton « Supprimer le brouillon ».

⚠️ *Test d'erreur* : titre vide → "Ce champ est obligatoire." ; aucune cible → "Choisissez au moins une cible." ; toutes les audiences décochées → "Choisissez au moins une audience." ; « Publier le » = demain et « Expire le » = aujourd'hui → "L'expiration doit suivre la publication.".

☐ OK ☐ KO

---

### Étape 298 — L'enseignant publie vers ses classes seulement
👤 **enseignant** · fenêtre **B** · 📂 **« Annonces »** > **« Nouvelle annonce »**

1. Constater que « Type de cible » ne propose que **« Classe »** et que la liste ne contient que ses classes.
2. Saisir `Annonce enseignant test guide`, contenu `Rappel : cahier de textes à signer. (test guide)`, cible `6E-A`, personnes visées « Parents et tuteurs », puis **« Publier »**.
3. Refaire une annonce en cochant en plus l'audience « Personnel », **« Publier »**.

✅ L'annonce vers sa classe est publiée. Avec « Personnel » : refus de l'API "Vous ne pouvez viser que les élèves et les tuteurs de vos classes.". Aucune cible « Tout l'établissement », « Campus », « Niveau » ou « Rôle ».

☐ OK ☐ KO

---

### Étape 299 — Annonce destinée aux élèves
👤 **élève** (DIABATE Nadia), puis **secrétariat**, puis **élève** · fenêtres **B** et **A** · 📂 **« Annonces »**

1. Élève : ouvrir **« Annonces »**. Sur une base neuve : « Aucune annonce pour vous pour le moment. » (l'annonce de rentrée vise parents et personnel).
2. Secrétariat : créer `Annonce élèves test guide`, contenu `Rappel pour les élèves : tenue de sport vendredi. (test guide)`, cible « Classe » `6E-A`, personnes visées « Élèves » seulement, **« Publier »**.
3. Élève : rouvrir **« Annonces »**.

✅ L'élève voit `Annonce élèves test guide` sans bouton d'accusé, jamais les annonces « Parents et tuteurs » ni les brouillons ; il n'a ni onglet « Publiées par moi » ni « Nouvelle annonce ».

⚠️ *Écart connu* : sur une base antérieure au correctif C-13-04, l'annonce de rentrée peut être visible de l'élève (donnée de graine périmée, pas une faille).

☐ OK ☐ KO

---

### Étape 300 — Retirer une annonce avec un motif
👤 **secrétariat** · fenêtre **A** · 📂 **« Annonces »** > fiche de `Réunion de classe 6e A test guide` > « Gestion de l'annonce »

1. Cliquer **« Retirer l'annonce »** (fenêtre « Retirer cette annonce ? »).
2. Saisir `a` et confirmer, puis `Annonce publiée par erreur test guide` dans « Motif du retrait » et confirmer par **« Retirer l'annonce »**.
3. Parent : ouvrir **« Annonces »**.

✅ Motif trop court : "Le motif doit comporter au moins 3 caractères." ; ensuite « L'annonce est retirée. », statut « Retirée » ; l'annonce disparaît de la boîte du parent ; plus de « Modifier » ni de « Retirer » sur la fiche.

☐ OK ☐ KO

---

### Étape 301 — Cloche et notifications dans l'application
👤 **parent** · fenêtre **B** · 📂 **« Messages »** > **« Notifications »** (`/v2/messages/notifications`)

Précondition : le parent a reçu la diffusion et au moins une annonce.

1. Repérer la cloche à droite de la barre (nombre rouge si non lues). La cliquer : le panneau « Notifications » liste les cinq dernières ; boutons **« Tout marquer comme lu »** et **« Tout voir »**.
2. Cliquer **« Tout voir »** (page « Notifications », « Mes notifications » avec « Messages », « Annonces », « Alertes automatiques »). Cocher « Non lues seulement », cliquer **« Marquer comme lue »** sur une ligne, puis **« Tout marquer comme lu »**.
3. Dans « Préférences de notification », catégorie « Annonces » : décocher « Notifications dans l'application », cocher « E-mail », **« Enregistrer mes préférences »**. Recharger, puis remettre « Notifications dans l'application » coché, décocher « E-mail », enregistrer.

✅ Le compteur diminue à chaque action jusqu'à zéro (« Aucune notification non lue. » avec le filtre) ; « Vos préférences sont enregistrées. » ; le texte d'aide dit "Les annonces urgentes et les décisions de modération vous sont toujours signalées dans l'application.". La cloche n'existe que dans la section Communication.

☐ OK ☐ KO

---

### Étape 302 — Signaler un message
👤 **parent** (deuxième message), puis **enseignant** · fenêtre **B** · 📂 **« Messages »** > conversation "Question sur le devoir test guide"

1. Parent : dans la conversation, répondre `Deuxième message du parent test guide` et `Troisième message du parent test guide` (deux messages à signaler).
2. Enseignant : ouvrir le fil. Sous un message du parent, cliquer **« Signaler »** (fenêtre « Signaler ce message »).
3. Laisser « Motif » = « Contenu inapproprié », saisir en « Précisions » `Signalement de contrôle test guide`, cliquer **« Signaler »**.
4. Recommencer sur l'autre message avec le motif « Autre motif ».

✅ « Merci : votre signalement a été transmis à la modération. ». Le bouton « Signaler » n'existe pas sur les messages de l'enseignant lui-même.

☐ OK ☐ KO

---

### Étape 303 — Modération : rejeter, puis sanctionner avec restriction d'envoi
👤 **directeur** (code MFA si « Confirmez votre identité » apparaît), puis **parent** · fenêtres **A** et **B** · 📂 Menu **« Modules »** > **« Communication »** > **« Modération des messages »** (`/v2/messages/moderation`)

1. Lire les onglets **« Signalements »**, **« Restrictions »**, **« Supervision »**. Sur la première ligne (« À traiter »), cliquer **« Examiner »**.
2. Choisir **« Rejeter le signalement »**, laisser le motif vide, **« Confirmer la décision »** ; puis saisir `Pas de manquement constaté test guide` et confirmer.
3. Sur la seconde ligne, **« Examiner »** : choisir **« Sanctionner »**, laisser coché « Retirer le message », cocher « Restreindre l'envoi de l'auteur » avec la durée "1 jour", motif `Contenu inapproprié test guide`, **« Confirmer la décision »**.
4. Onglet **« Restrictions »** : le parent y figure. Parent : ouvrir **« Messages »** puis essayer **« Nouveau message »**.
5. Directeur : onglet **« Restrictions »**, cliquer **« Lever la restriction »**.

✅ Motif vide : « Le motif de la décision est obligatoire (3 caractères au moins). » ; « Décision enregistrée. » ; première ligne « Rejeté », seconde « Sanctionné » ; le message sanctionné devient « Message retiré par la modération » chez tout le monde. Parent restreint : « Votre envoi de messages est temporairement restreint par l'établissement. Vous pouvez toujours lire vos messages. ». Après **« Lever la restriction »** : « Aucune restriction en cours. » et le parent peut de nouveau écrire.

☐ OK ☐ KO

---

### Étape 304 — Supervision motivée d'une conversation
👤 **directeur** · fenêtre **A** · 📂 **« Modération des messages »** > onglet **« Supervision »**

1. Saisir `Question sur le devoir` dans la recherche, puis cliquer **« Lire avec un motif »** sur la conversation.
2. Dans « Lire cette conversation », saisir `x` puis valider ; ensuite saisir `Contrôle de la procédure test guide` dans « Motif de la consultation » et cliquer **« Lire la conversation »**.
3. Lire la fenêtre (« Lecture seule : les messages retirés restent visibles pour la supervision. ») et la fermer.

✅ Motif d'un caractère refusé : "Le motif doit comporter au moins 3 caractères." ; avec un motif valable, le contenu s'affiche en lecture seule, **y compris le texte des messages retirés** ; une entrée d'audit est créée (à vérifier dans `/v2/audit`).

☐ OK ☐ KO

---

### Étape 305 — Régler la politique de messagerie des élèves
👤 **propriétaire**, puis **élève** · fenêtres **A** et **B** · 📂 Menu **« Modules »** > **« Communication »** > **« Paramètres de la messagerie »** (`/v2/messages/settings`)

Noter la valeur d'origine de « Messagerie des élèves » (« Ils peuvent écrire à leurs enseignants et à l'administration »).

1. Propriétaire : choisir « Désactivée : les élèves n'écrivent pas », **« Enregistrer les paramètres »**.
2. Élève : ouvrir **« Messages »** puis `/v2/messages/new`.
3. Propriétaire : **remettre** « Ils peuvent écrire à leurs enseignants et à l'administration », **« Enregistrer les paramètres »**.

✅ « Paramètres enregistrés. » à chaque enregistrement. Avec « Désactivée », l'élève n'a plus le bouton **« Nouveau message »** et `/v2/messages/new` affiche « Vous ne pouvez pas envoyer de message pour le moment. ». Les conversations existantes restent lisibles. Réglage rétabli en fin d'étape.

⚠️ *Test d'erreur* : « Taille maximale (Mo) » = `100` → « La taille maximale doit être comprise entre 0,001 et 25 Mo. » (rétablir `5` si modifié).

☐ OK ☐ KO

---

### Étape 306 — Envoyer une convocation (envoi manuel, e-mail simulé)
👤 **secrétariat** · fenêtre **A** · 📂 Menu **« Notifications »** > **« Envoyer »** (`/v2/notifications/send`)

1. Remplir « Envoi d'un message » :

| Champ | Valeur |
| :--- | :--- |
| Type de message | `Convocation` |
| Choisir par | « Élèves (leurs parents et tuteurs) » |
| Ajouter un élève | `Nadia` puis DIABATE Nadia |
| Canaux | « Application » et « E-mail » |
| Stratégie d'envoi | « Tous les canaux choisis » |
| Objet de la convocation | `Entretien avec la direction test guide` |
| Date / Heure | `15/10/2026` / `09:30` |
| Lieu | `Bureau du directeur` |
| Précision | `Merci de vous munir du carnet de correspondance. (test guide)` |

2. Cliquer **« Vérifier avant l'envoi »**, lire la fenêtre « Confirmer l'envoi », puis **« Envoyer maintenant »**.
3. Parent (B) : ouvrir la cloche.

✅ « Message mis en file : 1 destinataire(s), 2 envoi(s), 0 ignoré(s). » (nombres à vérifier selon les coordonnées). Le parent reçoit la notification « Application ». **Aucun e-mail réel n'est reçu.**

⚠️ *Test d'erreur* : aucun canal coché → « Choisissez au moins un canal. » ; aucun élève → « Choisissez au moins un élève. ».

☐ OK ☐ KO

---

### Étape 307 — Avis urgent : réservé à la direction
👤 **propriétaire** puis **secrétariat** · fenêtre **A** · 📂 **« Notifications »** > **« Envoyer »**

⚠️ Action sensible : l'avis urgent ignore les heures calmes et les préférences de catégorie, et il est audité.

1. Propriétaire : type `Avis urgent` (case "Message urgent" visible), élève DIABATE Nadia, canal « Application », « Objet » `Avis urgent test guide`, « Message » `Test de procédure : ne pas tenir compte de cet avis. (test guide)`. **« Vérifier avant l'envoi »** : en rouge « Envoi urgent » ; **« Envoyer maintenant »** (code MFA si demandé).
2. Secrétariat : refaire la même saisie avec le type `Avis urgent`.

✅ Propriétaire : mise en file, badge « Urgent » dans le journal. Secrétariat : la case d'urgence n'est pas affichée mais le type est listé ; l'API refuse : "L'envoi urgent exige une autorisation spécifique.".

☐ OK ☐ KO

---

### Étape 308 — Lire le journal des envois
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Notifications »** > **« Journal des envois »** (`/v2/notifications`)

1. Lire la description (« Chaque message envoyé par e-mail, SMS, WhatsApp, notification push ou dans l'application. Les adresses sont masquées et le contenu des messages n'est pas conservé. »), puis cliquer les boutons "1 j", "7 j", "30 j".
2. Filtrer par « Canal » = « E-mail », « Statut » = « Simulé ».
3. Lire une ligne : badge de statut, « Destinataire : », « Gabarit : » (par exemple "convocation (version 0)"), « Origine : ».

✅ Une ligne « Application » (remise) et une ligne « E-mail » au statut « Simulé » (ou « Non envoyé : » avec la raison si le canal n'est pas configuré) pour la convocation, origine « Envoi manuel » ; la ligne de l'avis urgent porte « Urgent ». Aucune adresse complète, aucun contenu de message ; **aucun statut « Envoyé » ne provient d'un vrai fournisseur**.

⚠️ *Test d'erreur* : filtre « Statut » = « Remis » avec la période du jour → « Aucun envoi ne correspond ».

☐ OK ☐ KO

---

### Étape 309 — Gabarits : aperçu, nouvelle version, retour au gabarit livré
👤 **directeur des études** (lecture), puis **propriétaire** · fenêtre **A** · 📂 **« Notifications »** > **« Gabarits »** (`/v2/notifications/templates`)

1. Directeur des études : dans « Message », choisir `Convocation`, onglet « E-mail » : champs en lecture seule, badge « Gabarit livré », « Activé ». Cliquer **« Aperçu »**.
2. Propriétaire : même écran, `Convocation`, onglet « E-mail ». Saisir :

| Champ | Valeur |
| :--- | :--- |
| Objet | `Convocation : {{subject}} (test guide)` |
| Texte du message | `Bonjour, vous êtes convoqué(e) le {{date}} à {{time}}. Lieu : {{place}}. Objet : {{subject}}. Texte de contrôle test guide.` |
| Note de version | `Version test guide` |

3. Cliquer **« Aperçu »**, puis **« Publier une nouvelle version »**.
4. Cliquer **« Désactiver ce gabarit »**, puis **« Activer ce gabarit »**.
5. Cliquer **« Revenir au gabarit livré »**.

✅ « Version 1 publiée et activée. » (la version 1 porte « Active » dans « Versions », non supprimable) ; « Gabarit désactivé. » puis « Gabarit activé. » ; « Gabarit livré rétabli. » et le badge redevient « Gabarit livré ». Le directeur des études n'a pas **« Publier une nouvelle version »**.

⚠️ *Test d'erreur* : « Texte du message » vide → « Le texte du message est obligatoire. » ; texte `Bonjour {{zzz}}` → "La variable zzz n'existe pas pour ce gabarit.".

☐ OK ☐ KO

---

### Étape 310 — Lire les règles et les canaux d'envoi
👤 **secrétariat** (lecture), puis **propriétaire** · fenêtre **A** · 📂 **« Notifications »** > **« Règles »** (`/v2/notifications/rules`) puis **« Canaux d'envoi »** (`/v2/notifications/channels`)

1. Secrétariat : ouvrir **« Règles »** (« Règles de notification ») : trois familles « Événements », « Alertes », « Relances d'impayés » ; chaque règle porte « Active » ou « Désactivée » et « Livrée » ; aucun bouton **« Modifier »**.
2. Ouvrir **« Canaux d'envoi »** : une carte par canal (« Application », « E-mail », « SMS », « WhatsApp », « Notification push ») avec son état ; formulaire « Réglages de l'établissement » en lecture seule.
3. Propriétaire : sur la carte « Application », cliquer **« Envoyer un essai »**, puis ouvrir le journal.

✅ « Essai en file : 1 message(s), 0 ignoré(s). Consultez le journal des envois. » ; une ligne d'origine « Essai » adressée à soi-même. Les canaux externes non configurés ont leur bouton d'essai grisé ; **vérifier qu'aucun message réel n'arrive**.

⚠️ *Test d'erreur* : sur **« Modifier »** de la règle "Relances d'impayés (J+7, J+21, J+45)" (propriétaire), paliers `10, 5` → « Les paliers doivent être strictement croissants. » (annuler ensuite).

☐ OK ☐ KO

---

### Étape 311 — Préférences de notification du parent
👤 **parent**, puis **secrétariat** · fenêtre **B** · 📂 Menu **« Mon compte »** > **« Mes notifications »** (`/v2/account/notifications`)

1. Parent : lire « Canaux et catégories » ; sur le canal « E-mail », décocher la case de réception : l'étiquette passe à « Désactivé ». Cocher « Activer mes heures calmes », début `21:00`, fin `06:00`, **« Enregistrer les heures calmes »**.
2. Secrétariat (A) : renvoyer la convocation de l'étape *Envoyer une convocation* pour DIABATE Nadia par « E-mail » seulement, puis lire le journal.
3. Parent : rétablir (canal « E-mail » activé, « Utiliser les heures calmes de l'établissement » coché, enregistrer).

✅ « Préférence enregistrée. » à chaque case ; « Heures calmes enregistrées. ». Au journal, la ligne « E-mail » du parent n'est plus « Simulé » mais « Non envoyé : consentement retiré. » ou « Non envoyé : catégorie refusée par la personne. » (motif exact à relever).

⚠️ *Écart connu* : le lien « Mes notifications » est proposé au secrétariat mais mène à « Accès refusé » (pas de droit personnel).

☐ OK ☐ KO

---

### Étape 312 — Désinscription publique par lien signé
👤 **aucun compte** · fenêtre **B** (navigation privée sans session) · 📂 `/v2/notifications/unsubscribe`

1. Ouvrir `http://localhost:3000/v2/notifications/unsubscribe` sans paramètre.
2. Ajouter à la fin de l'adresse `?t=lien-invalide-test-guide`.

✅ Titre « Préférences de notification », aucune navigation ni connexion. Sans paramètre : « Ce lien n'est pas valide. Utilisez le lien reçu dans le message. ». Avec un jeton inventé : "Lien de désinscription invalide ou expiré.". Aucune désinscription n'est appliquée par la simple ouverture.

☐ OK ☐ KO

---

### Étape 313 — Contrôler les droits de communication
👤 **parent**, **élève**, **enseignant**, **économe**, **secrétariat** · fenêtre **B** (puis **A**) · 📂 adresses tapées à la main

| Compte | Adresses à taper | Attendu |
| :--- | :--- | :--- |
| Parent | `/v2/messages/moderation`, `/v2/messages/settings`, `/v2/notifications`, `/v2/notifications/send`, `/v2/announcements/new` | « Accès refusé » |
| Élève | `/v2/announcements/new`, `/v2/notifications/templates` | « Accès refusé » |
| Enseignant | `/v2/messages/settings`, `/v2/notifications/rules` | « Accès refusé » |
| Économe | `/v2/announcements/new`, `/v2/notifications/send` | « Accès refusé » |
| Secrétariat | `/v2/messages/moderation` | « Accès refusé » |
| Parent | l'adresse d'un fil du directeur (copiée depuis son compte) | "introuvable" ou équivalent, aucun message visible |

✅ Page « Accès refusé » (texte "Vous n'avez pas les droits nécessaires pour afficher cette page.") sans contenu de la page cible. Déconnecté, `/v2/messages` renvoie vers `/login`.

☐ OK ☐ KO

---

### Étape 314 — ⚠️ Accuser réception de l'annonce de rentrée
👤 **parent**, puis **directeur** · fenêtres **B** et **A** · 📂 **« Annonces »** (`/v2/announcements`)

⚠️ Irréversible : l'accusé de réception ne peut pas être retiré. Le faire avec un seul compte.

1. Parent : ouvrir **« Annonces »**, repérer "Rentrée : réunion d'information des parents (démonstration)" (épinglée, badge « Accusé à donner »), l'ouvrir et cliquer **« J'ai pris connaissance »**. Recharger. Vérifier que le brouillon "Brouillon : calendrier des compositions (démonstration)" n'est pas dans la liste.
2. Directeur : **« Annonces »** > onglet « Publiées par moi », ouvrir l'annonce de rentrée ; dans « Gestion de l'annonce », lire « Destinataires », « Lus », « Accusés », puis dans « Accusés de lecture » le sélecteur « Afficher » = « Accusés ».

✅ « Merci : votre accusé de réception est enregistré. » ; après rechargement le bouton est remplacé par "Vous avez pris connaissance de cette annonce le …" et le badge a disparu. Chez le directeur, « Accusés » vaut au moins 1 et le parent figure avec la date « Accusé le ».

📚 *Pour aller plus loin* : chapitre 15, scénarios 15.15 (annonce programmée et expirée), 15.19 à 15.25 (plafonds, messages automatiques d'absence), 15.31 à 15.35 (canaux, isolation entre établissements).

**Ce que la phase laisse dans l'application :** conversations `Question sur le devoir test guide` (parent et TRAORE Kouadio, avec message retiré par la modération), `Pièce jointe test guide`, `Diffusion 6e A test guide` (avec réponse du parent), `Groupe pédagogique test guide` ; annonces `Réunion de classe 6e A test guide` (retirée), `Annonce enseignant test guide`, `Annonce élèves test guide` ; accusé de réception de DIABATE Séka sur l'annonce de rentrée ; deux signalements traités ; envois `Entretien avec la direction test guide` (convocation) et `Avis urgent test guide` au journal ; version 1 du gabarit "Convocation" (historique conservé, gabarit livré rétabli) ; politique de messagerie des élèves, préférences du parent et réglages rétablis à leur état de départ.

---

## Phase 17 — Tableaux de bord et alertes

Objectif : vérifier que les chiffres du pilotage de direction recoupent les modules sources (inscriptions, présences, admissions, vie scolaire, résultats, finance), qu'une valeur non mesurée s'affiche « Non mesuré » (jamais un zéro inventé), puis créer une règle d'alerte, la voir se déclencher, l'accuser et la résoudre.

Précondition : le worker tourne (il rafraîchit les tableaux toutes les 30 secondes et **évalue les règles d'alerte toutes les 15 minutes**). Les valeurs de la graine (base neuve) sont citées à titre de repère ; les phases précédentes les ont modifiées (élèves créés, admissions, paiements) : toujours **recouper avec la liste du module source**, ne pas comparer à un nombre figé. Les résultats reposent sur un jeu de règles de démonstration : aucun chiffre pédagogique n'est officiel.

---

### Étape 315 — Lire le tableau de bord de la direction
👤 **propriétaire** (secondaire-test, `direction.generale@secondaire-test.test`, MFA) · fenêtre **A** · 📂 Menu **« Modules »** > **« Pilotage »** > **« Tableau de bord de la direction »** (`/v2/direction`)

1. Lire la ligne de fraîcheur « Données au … » et le bandeau « Règles de démonstration ».
2. Relever dans le tableau suivant les valeurs des cartes **« Élèves en scolarité »** (et son détail "n inscription(s) au total"), **« Présence aujourd'hui »**, **« Moyenne générale »**, **« Taux de validation »**, **« Enseignants et personnel présents »**.
3. Descendre à « Scolarité et créances » : relever **« Scolarité recouvrée »**, **« Encaissé »**, **« Créances (restant dû) »**.
4. Se reconnecter avec `directeur@secondaire-test.test` (MFA) et comparer.

| Carte | Valeur relevée |
| :--- | :--- |
| Élèves en scolarité (N) | |
| Encaissé (E0) | |
| Créances (R0) | |

✅ Les cartes sont renseignées ; une valeur non calculable (aucun appel validé aujourd'hui, aucun pointage du personnel) affiche « Non mesuré », jamais un zéro. Repère graine : 9 élèves en scolarité, détail "14 inscription(s) au total" ; ajouter les élèves inscrits depuis (par exemple KOUASSI Aïcha test guide). Moyenne et taux de validation portent sur la dernière période clôturée (période 1). Le directeur voit exactement les mêmes blocs, y compris le bloc financier.

⚠️ *Écart connu* : pendant le chargement des droits, un message "non inclus dans l'offre" peut s'afficher un instant (défaut connu, sans suite).

☐ OK ☐ KO

---

### Étape 316 — Créer la règle d'alerte "Effectif minimal"
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Pilotage »** > **« Règles d'alerte »** > **« Nouvelle règle »** (`/v2/analytics/alertes/regles`)

À faire tôt : l'évaluation prend jusqu'à 15 minutes ; poursuivre avec les étapes suivantes pendant l'attente.

1. Lire la liste : trois règles de la graine ("Créances en retard élevées", "Taux de recouvrement bas", "Taux de présence bas"). Cliquer **« Nouvelle règle »**.
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Nom de la règle | `Effectif minimal test guide` |
| Indicateur surveillé | « Effectif en scolarité » |
| Seuil d'attention | `1000` |
| Seuil critique | (vide) |
| Fréquence des rappels | « Au plus un rappel par jour » |
| Rôles prévenus | cocher « Directeur » et « Propriétaire » |
| Règle active | cochée |

3. Cliquer **« Enregistrer la règle »**.

✅ « Règle enregistrée. » ; la ligne apparaît avec "Attention : sous 1 000", destinataires "Directeur, Propriétaire", « Active », « Pas encore évaluée ». Les trois règles de la graine n'ont pas le Propriétaire pour destinataire.

⚠️ *Test d'erreur* : nom `ab` → « Le nom doit comporter de 3 à 120 caractères. » ; indicateur « Taux de présence des élèves », attention `85`, critique `90` → « Le seuil critique doit être inférieur ou égal au seuil d'attention. » ; aucun seuil → « Renseignez au moins un seuil (attention ou critique). ». Aucune règle n'est ajoutée par ces essais.

☐ OK ☐ KO

---

### Étape 317 — Recouper les effectifs avec les inscriptions
👤 **propriétaire** · fenêtre **A** · 📂 **« Pilotage »** > **« Effectifs et présences »** (`/v2/direction/effectifs`), puis `/v2/enrollments`

1. Lire « Élèves en scolarité », le détail "n inscription(s) tous statuts confondus", puis « Effectifs par classe » : pour `6E-A`, les colonnes « En scolarité », « Filles », « Garçons », « Inscriptions ».
2. Ouvrir la liste « Inscriptions » (`/v2/enrollments`, année en cours) : compter les lignes en « Active » (puis « Terminée »), puis toutes statuts confondus ; filtrer « Classe » = `6E-A`.
3. Revenir lire « Répartition des inscriptions » (« Par sexe », « Par niveau », « Par type de financement », « Par statut d'inscription »).

✅ « Élèves en scolarité » = nombre d'inscriptions « Active » + « Terminée » ; le total tous statuts = nombre de lignes de la liste sans filtre ; la somme des colonnes « En scolarité » de toutes les classes = « Élèves en scolarité » ; « Filles » + « Garçons » = « En scolarité » pour chaque classe ; chaque répartition totalise le nombre d'**inscriptions**. Un écart doit s'expliquer par le statut d'une inscription (par exemple « En attente »).

⚠️ *Test d'erreur* : filtre de classe sans élève → « Aucune inscription sur ce périmètre. ».

☐ OK ☐ KO

---

### Étape 318 — Recouper les présences
👤 **propriétaire** · fenêtre **A** · 📂 **« Effectifs et présences »** > bloc « Présences et assiduité »

1. Laisser la fenêtre par défaut (30 derniers jours) ou saisir « Du » = `08/09/2026`, « Au » = `08/10/2026`.
2. Lire « Taux de présence » (détail "n présents sur n pointages, du … au …"), « Absences », « Retards », « Séances d'appel » et le tableau « Présence par classe ».

✅ Le taux = présents ÷ pointages affichés dans le détail ; il recoupe les séances d'appel validées au module Présences. Sans appel validé sur la fenêtre : « Aucun appel soumis sur ce périmètre. ». La présence du personnel non mesurée affiche "La présence du personnel n'est pas mesurée sur cette fenêtre.".

⚠️ *Écart connu* : étiquettes de date abrégées dans les graphiques ("10-25", "2026-") : défaut connu, sans suite.

☐ OK ☐ KO

---

### Étape 319 — Recouper l'entonnoir d'admission
👤 **propriétaire** · fenêtre **A** · 📂 **« Pilotage »** > **« Admissions »** (`/v2/analytics/admissions`), puis `/v2/admissions`

1. Lire la note sur le comptage par statut actuel, puis les cartes « Dossiers déposés », « Acceptés (dont inscrits) », « Inscrits », « Taux d'acceptation », « Taux d'inscription », « Places offertes ».
2. Lire « Par statut » (« Brouillon », « Déposé », « En étude », « Pièce manquante », « Accepté », « Refusé », « Liste d'attente », « Inscrit ») et « Campagnes » (`RENTREE-6E`).
3. Ouvrir la liste des candidatures (`/v2/admissions`) et compter par statut.

✅ Chaque statut recoupe le module Admissions ; aucun candidat n'est nommé. Repère graine : 8 déposés (9 dossiers brouillon compris), 3 acceptés dont inscrits, 1 inscrit, 13 places ; ajouter les candidatures créées à la phase Admissions (par exemple Awa COULIBALY test guide).

☐ OK ☐ KO

---

### Étape 320 — Recouper la vie scolaire agrégée
👤 **propriétaire** · fenêtre **A** · 📂 **« Pilotage »** > **« Vie scolaire (agrégée) »** (`/v2/analytics/vie-scolaire`), puis `/v2/schoollife`

1. Lire la note "Comptages uniquement : aucun élève n'est nommé, aucun motif n'est lu…", puis les cartes « Incidents ouverts », « Mesures à valider », « Exclusions en cours », « Convocations à tenir ».
2. Comparer avec le module Vie scolaire (`/v2/schoollife`) : incidents ouverts et mesures proposées.

✅ Les comptages recoupent le module source ; aucun nom, aucun motif. Repère graine : « Mesures à valider » = 1 (l'exclusion proposée), « Exclusions en cours » = 0 (les exclusions commencent demain), « Incidents ouverts » = 2 (à confirmer selon l'état des incidents).

☐ OK ☐ KO

---

### Étape 321 — Recouper la pédagogie
👤 **propriétaire** · fenêtre **A** · 📂 **« Pilotage »** > **« Pédagogie »** (`/v2/owner/pedagogie`), puis `/v2/results`

1. Lire les cartes « Moyenne générale », « Taux de validation », « Résultats clôturés », « Classes clôturées » et le tableau « Résultats par classe » (colonnes « Classe », « Niveau », « Résultats », « Moyenne », « Validation »).
2. Dans « Période », choisir la période 1, puis la période 2 (non clôturée), puis « Classe » = `6E-A`.
3. Comparer la moyenne et le nombre de résultats de `6E-A` avec le module Résultats (`/v2/results`).

✅ Valeurs recoupées avec le module Résultats ; période 2 non clôturée : "Aucun résultat clôturé pour ce périmètre." (jamais un zéro à la place de « Non mesuré »). Les moyennes issues de règles de démonstration sont étiquetées comme telles.

☐ OK ☐ KO

---

### Étape 322 — Recouper la scolarité avec la finance
👤 **propriétaire** · fenêtre **A** · 📂 **« Pilotage »** > **« Scolarité »** (`/v2/owner/scolarite`), puis `/v2/finance/invoices`

1. Lire « Taux de recouvrement », « Facturé », « Avoirs », « Encaissé », « Restant dû », « En retard », « Paiements non imputés ».
2. Dans « Créances », « Regrouper par » = « Classe » puis « Apprenant ».
3. Dans les factures (`/v2/finance/invoices`, année en cours), additionner « Total », « Payé » et « Reste dû ».
4. **Noter** « Encaissé » (E1), « Avoirs » (A1) et « Restant dû » (R1) pour la phase *Portails parent, élève, enseignant ; paiement et remboursement*.

✅ « Facturé » − « Avoirs » = base du taux ; « Encaissé » = somme des paiements imputés ; « Restant dû » = somme des « Reste dû » des factures ; taux = encaissé ÷ facturé net, affiché avec son état (« Bon », « À surveiller », « Critique » selon 80 % / 60 %) — « Critique » probable sur la base de démonstration. Un écart s'explique par des avoirs ou des paiements non imputés.

☐ OK ☐ KO

---

### Étape 323 — Lire la trésorerie
👤 **propriétaire** · fenêtre **A** · 📂 **« Pilotage »** > **« Trésorerie »** (`/v2/owner/tresorerie`)

1. Dans « Encaissements », laisser « Du » / « Au » vides et tester « Regroupement » = « Par jour », « Par semaine », « Par mois ». Lire « Encaissé », « Remboursé », « Net », « Paiements ».
2. Lire « Créances âgées » (« Non échu », « 1 à 30 jours », « 31 à 60 jours », « 61 à 90 jours », « Plus de 90 jours ») et « Écarts de caisse ».
3. Comparer « Encaissé » avec `/v2/finance/payments` (sans les paiements refusés ou en attente).

✅ « Net » = « Encaissé » − « Remboursé » ; les paiements réussis sont comptés, les paiements refusés ou en attente non ; « Écarts de caisse » : "Aucune session de caisse." tant qu'aucune session n'a été clôturée (les sessions de la phase Finance apparaissent sinon).

☐ OK ☐ KO

---

### Étape 324 — Hub des indicateurs, masse salariale et charges
👤 **propriétaire** (code MFA si « Confirmez votre identité » apparaît) · fenêtre **A** · 📂 **« Pilotage »** > **« Indicateurs de direction »** (`/v2/analytics`), **« Masse salariale »** (`/v2/owner/paie`), **« Charges et résultat »** (`/v2/owner/charges`)

1. Hub : parcourir les huit blocs (« Effectifs et inscriptions », « Assiduité », « Résultats par période », « Recouvrement et impayés », « Admissions », « Vie scolaire (agrégée) », « Alertes de direction », « Charge de paie »). Dans « Charge de paie », cliquer **« Afficher la masse salariale »**.
2. Ouvrir « Masse salariale » et lire le tableau « Masse salariale par période de paie ».
3. Ouvrir « Charges et résultat ».

✅ Hub : chaque bloc porte sa fraîcheur, aucune donnée nominative. Masse salariale : donnée sensible (lecture auditée) ; sans période de paie « Aucune période de paie. », sinon les montants recoupent le module Paie. Charges : titre d'avertissement "Module de charges absent" et la liste « Ce qui n'est pas mesuré » ; **aucun montant à zéro inventé**.

⚠️ *Test d'erreur* : code MFA incorrect → "Code invalide. Vérifiez l'heure de votre téléphone, puis attendez le prochain code.".

☐ OK ☐ KO

---

### Étape 325 — Exporter en CSV
👤 **propriétaire**, puis **directeur des études** · fenêtre **A** · 📂 **« Effectifs et présences »** et **« Scolarité »**

1. Propriétaire : sur `/v2/direction/effectifs`, cliquer **« Exporter (CSV) »** dans « Répartition des inscriptions » (`analytics-enrollment-by-classroom.csv`) ; sur `/v2/owner/scolarite`, exporter « Créances » en regroupement « Apprenant » (`analytics-receivables-by-learner.csv`).
2. Ouvrir les fichiers dans un tableur, puis `/v2/audit` pour chercher les exports.
3. Directeur des études : ouvrir `/v2/owner/pedagogie` et chercher « Exporter (CSV) ».

✅ Fichiers séparés par des points-virgules, accents lisibles, première ligne d'en-têtes ; l'export d'effectifs ne contient aucun nom d'élève, **l'export des créances par apprenant en contient** (donnée nominative à manipuler avec précaution) ; chaque export est tracé dans le journal d'audit ; le directeur des études n'a **aucun** bouton d'export.

☐ OK ☐ KO

---

### Étape 326 — Fraîcheur des données et reconstruction
👤 **propriétaire** · fenêtre **A** · 📂 **« Pilotage »** > **« Fraîcheur des données »** (`/v2/owner/fraicheur`)

Noter la valeur d'origine du champ "Donnée ancienne au-delà de (heures)" (24).

1. Lire la file "En file : n · en échec : n · source indisponible : n" et le tableau « État de la lecture des sources » (états « À jour », « Échec », « Source indisponible »).
2. Cliquer **« Reconstruire depuis les sources »**, puis recharger après une minute.
3. Dans « Seuils de lecture et fraîcheur », mettre "Donnée ancienne au-delà de (heures)" à `1`, **« Enregistrer les réglages »**, ouvrir `/v2/direction` et lire la barre de fraîcheur ; puis remettre `24` et enregistrer.

✅ « La reconstruction est en file : elle sera exécutée par le worker. » ; la « Dernière lecture réussie » avance ; « Les réglages sont enregistrés. ». Avec 1 heure, la mention "Ces données datent de plus longtemps que le délai de fraîcheur de l'établissement : elles ne sont peut-être plus à jour." peut apparaître ; **ces réglages ne changent aucun chiffre**. Réglage remis à 24 en fin d'étape.

⚠️ *Test d'erreur* : `500` ou `0` → « Saisissez un nombre entier d'heures entre 1 et 168. ».

☐ OK ☐ KO

---

### Étape 327 — Comparer deux périodes
👤 **propriétaire** · fenêtre **A** · 📂 **« Pilotage »** > **« Comparaisons »** (`/v2/analytics/comparaisons`)

1. Avant tout choix : "Choisissez les deux côtés de la comparaison pour l'afficher.".
2. « Indicateur » = « Résultats » : « Période de référence » = période 1, « Période comparée » = période 2.
3. « Indicateur » = « Assiduité » : référence du `01/09/2026` au `15/09/2026`, comparée du `16/09/2026` au `08/10/2026`.

✅ Tableau "Comparaison" (« Indicateur », « Référence », « Comparée », « Écart », « Variation ») ; un côté sans mesure affiche « Non mesuré » et non zéro ; variation « — » quand la référence est nulle.

☐ OK ☐ KO

---

### Étape 328 — Alerte déclenchée : détails et accusé de réception
👤 **propriétaire** · fenêtre **A** · 📂 **« Pilotage »** > **« Alertes de direction »** (`/v2/analytics/alertes`)

Précondition : 15 minutes au plus se sont écoulées depuis l'étape *Créer la règle d'alerte "Effectif minimal"*. Sinon, recharger plus tard.

1. Lire les cartes « Ouvertes », « Accusées de réception », « Résolues ». Repérer la ligne `Effectif minimal test guide` : gravité « Attention », valeur N, "sous le seuil de 1 000", état « Ouverte ».
2. Cliquer **« Détails »** : « Ouverte le », « Dernière constatation », « Valeur constatée », « Seuil franchi », tableau "Notifications émises pour cette alerte" (« Motif » = « Ouverture »).
3. Cliquer **« Accuser réception »**, saisir la note `Alerte vue lors du test guide`, puis **« Confirmer l'accusé de réception »**.
4. Ouvrir aussi les alertes issues de la graine (par exemple "Taux de recouvrement bas", ouverte dès le premier passage sur une base de démonstration).

✅ « Accusé de réception enregistré. » puis état « Accusée de réception » avec la note ; la valeur de la ligne est égale à N relevé à la première étape. Filtres « Tous les états », « Toutes les gravités », « Tous les indicateurs » combinables ; « Aucune alerte pour ces filtres. » si rien ne correspond.

☐ OK ☐ KO

---

### Étape 329 — Seuil strict et résolution de l'alerte
👤 **propriétaire**, puis **directeur** · fenêtre **A** · 📂 **« Règles d'alerte »** (`/v2/analytics/alertes/regles`) puis **« Alertes de direction »**

1. **« Modifier »** la règle `Effectif minimal test guide`, mettre « Seuil d'attention » à `N` (la valeur exacte de l'effectif relevée), **« Enregistrer la règle »**. Attendre un passage (15 minutes), recharger les alertes.
2. Remettre « Seuil d'attention » à `N+1`, enregistrer, attendre un passage.
3. Directeur : ouvrir la cloche de la section Communication (ou le fil « EcoleDigitale — alertes ») ; propriétaire : même vérification.
4. Fin d'étape : **« Modifier »** la règle, décocher « Règle active », **« Enregistrer la règle »** ; après un passage, l'alerte est « Résolue ».

✅ Franchissement **strict** : avec le seuil `N` l'alerte passe à « Résolue » (« Résolue le », « Valeur au retour à la normale ») ; avec `N+1` une nouvelle alerte s'ouvre. Directeur et propriétaire (rôles cochés) reçoivent une notification, sans nom d'élève. Désactiver une règle résout son alerte ; l'accusé de réception d'un épisode n'empêche pas la résolution.

☐ OK ☐ KO

---

### Étape 330 — Directeur des études : les alertes de son domaine
👤 **directeur des études** (`etudes@secondaire-test.test`, MFA) · fenêtre **A** · 📂 **« Pilotage »** > **« Alertes de direction »**

1. Ouvrir le menu « Pilotage » : seules « Pédagogie », « Admissions », « Vie scolaire (agrégée) », « Alertes de direction », « Règles d'alerte » sont proposées.
2. Ouvrir « Alertes de direction » : seules les alertes de son domaine (présence, validation, vie scolaire) sont listées ; si une est « Ouverte », cliquer **« Accuser réception »**.
3. Ouvrir « Règles d'alerte ».

✅ Aucune alerte financière ni d'effectif ; l'accusé est possible ; pas de bouton « Nouvelle règle » ni « Modifier ».

☐ OK ☐ KO

---

### Étape 331 — Contrôler les droits sur le pilotage
👤 **directeur des études**, **économe**, **chargé d'admissions**, **secrétariat**, **enseignant**, **parent** · fenêtre **A** (gestion) et **B** · 📂 adresses tapées à la main

| Compte | Adresses à taper | Attendu |
| :--- | :--- | :--- |
| Directeur des études | `/v2/direction`, `/v2/analytics`, `/v2/owner/scolarite`, `/v2/owner/paie`, `/v2/owner/fraicheur` | « Accès refusé » |
| Économe (`econome@secondaire-test.test`, MFA) | `/v2/direction`, `/v2/owner/pedagogie`, `/v2/owner/paie`, `/v2/analytics/vie-scolaire` | « Accès refusé » ; `/v2/owner/scolarite` et `/v2/owner/tresorerie` s'ouvrent, sans export |
| Chargé d'admissions | `/v2/direction`, `/v2/owner/scolarite`, `/v2/analytics/alertes` | « Accès refusé » ; `/v2/analytics/admissions` s'ouvre |
| Secrétariat, enseignant, parent | `/v2/direction`, `/v2/analytics/alertes`, `/v2/owner/paie` | « Accès refusé », pas de module « Pilotage » |
| Déconnecté | `/v2/direction` | redirection vers `/login` |

✅ Toute page refusée affiche « Accès refusé » sans donnée avant la redirection ; `/v2/owner` redirige vers `/v2/direction`.

📚 *Pour aller plus loin* : chapitre 16, scénarios 16.16 (les chiffres suivent un paiement), 16.22 (règle à fenêtre glissante sur le taux de présence), 16.28 (isolation et supérieur).

**Ce que la phase laisse dans l'application :** règle d'alerte `Effectif minimal test guide` (désactivée en fin d'étape) ; alertes issues de cette règle (ouverte, accusée avec la note `Alerte vue lors du test guide`, résolue) ; réglage "Donnée ancienne" remis à 24 heures ; fichiers CSV `analytics-*.csv` téléchargés sur le poste ; relevés E0/R0 (tableau de bord) et E1/A1/R1 (Scolarité) à reprendre à la phase suivante.

---

## Phase 18 — Portails parent, élève, enseignant ; paiement et remboursement

Objectif : vérifier ce que voit chaque famille et chaque enseignant (le parent ne voit que ses enfants, l'élève que lui-même, l'enseignant que ses classes), payer en ligne en mode simulé, puis traiter côté gestion l'avoir, la résolution manuelle d'un paiement bloqué, le remboursement à quatre yeux, la clôture de caisse et les rapports.

Précondition : le serveur web a été démarré avec `NEXT_PUBLIC_FINANCE_SANDBOX=1` (valeur par défaut de `pnpm dev:v2`), sinon l'option « Paiement simulé (démonstration) » n'est pas proposée. Les phases Finance ont créé la **facture n°1 test guide** de DIABATE Nadia (reste dû R_F au moins 4 000 F CFA), le virement `VIR-TG-001` (10 000 F CFA), une session de caisse ouverte avec un encaissement en espèces de 8 000 F CFA, et le fournisseur simulé est proposé. Montants de repère (graine) : Nadia est soldée de sa scolarité (225 000 payés), Salimata a payé 125 000 et **reste 100 000 F CFA**.

---

### Étape 332 — Le parent voit ses deux enfants
👤 **parent** (DIABATE Séka, secondaire-test, `parent@secondaire-test.test`, sans MFA) · fenêtre **B** · 📂 `/v2/parent` (page « Mes enfants »)

1. Se connecter ; constater l'atterrissage sur `/v2/parent`, titre « Mes enfants ».
2. Lire les blocs : un par enfant (nom, classe, badge d'état, bouton **« Ouvrir »**) et les quatre cartes (« Dernière moyenne publiée », « Absences », « Scolarité restante », « Prochaines séances »).
3. Cliquer **« Mon compte »** : lire « Rôle actif » = "Parent". Fermer avec Échap. Lire le menu latéral.

✅ **Exactement deux blocs** : "DIABATE Nadia" et "DIABATE Salimata", classe "6e A", aucun autre nom. Repères graine : moyenne de Nadia 13,20, rang 2 sur 8 ; « Scolarité restante » de Salimata 100 000 F CFA. Le menu contient « Mes enfants », « Vie scolaire », « Messages », « Annonces », « Paramètres du compte » ; aucune entrée de finance, de structure ou d'administration.

☐ OK ☐ KO

---

### Étape 333 — Tableau de bord d'un enfant et sélecteur « Enfant »
👤 **parent** · fenêtre **B** · 📂 **« Mes enfants »** > **« Ouvrir »** (`/v2/parent/children/<id Nadia>`)

1. Cliquer **« Ouvrir »** sur le bloc de Nadia.
2. Lire la liste « Enfant » ("DIABATE Nadia — 6e A", "DIABATE Salimata — 6e A") et la rangée « Sections de l'enfant » : « Tableau de bord », « Résultats », « Bulletins », « Absences », « Emploi du temps », « Évaluations à venir », « Scolarité », « Documents », « Dossier et contacts ».
3. Cliquer l'onglet « Résultats », puis choisir "DIABATE Salimata — 6e A" dans « Enfant ».

✅ L'adresse devient `/v2/parent/children/<id Salimata>/results` (la **section est conservée**) et le titre "Résultats de DIABATE Salimata".

☐ OK ☐ KO

---

### Étape 334 — Résultats et bulletins de Nadia
👤 **parent** · fenêtre **B** · 📂 **« Résultats »** puis **« Bulletins »** de Nadia (`/v2/parent/children/<id Nadia>/results`)

1. Onglet « Résultats » : lire « Résultats officiels » (« Moyenne », « Rang » au format "2 sur 8", « Mention »), déplier « Détail par matière (n) », puis « Notes des évaluations » (notes publiées du type "16 / 20").
2. Onglet « Bulletins » : cliquer **« Télécharger le PDF »**, puis **« Vérifier l'authenticité »** : un QR code et un « Code de vérification » de 26 caractères s'affichent. Cliquer **« Ouvrir la page de vérification »**.
3. Ouvrir l'onglet de Salimata : le code de Nadia n'apparaît pas.

✅ Seules des évaluations **publiées** apparaissent (aucun brouillon) ; le rang est « N sur M » sans nom de camarade. Le PDF se télécharge ; la page publique annonce « Document authentique » et rappelle « Cette page n'affiche ni note, ni nom, ni matricule, ni date de naissance : elle confirme seulement l'existence et le statut du document. ».

⚠️ *Écart connu* : pas de bandeau « Règles de démonstration » côté famille ; un libellé de décision peut s'afficher en code brut.

☐ OK ☐ KO

---

### Étape 335 — Déposer un justificatif d'absence
👤 **parent** · fenêtre **B** · 📂 **« Absences »** de Nadia (`/v2/parent/children/<id Nadia>/attendance`)

1. Lire le « Récapitulatif » et la section « Justificatifs déposés ».
2. Cliquer **« Déposer un justificatif »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Premier jour d'absence | `07/10/2026` |
| Dernier jour d'absence | `07/10/2026` |
| Motif | « Maladie » |
| Commentaire | `Rendez-vous médical test guide` |
| Pièce jointe | (vide) |

3. Cliquer **« Déposer »**, puis sur la carte créée **« Retirer ce justificatif »**.

✅ « Justificatif déposé. » ; la carte porte le badge « En attente » et le commentaire ; au retrait « Justificatif retiré. » (la carte passe à « Retiré », à vérifier). Une absence réelle de Nadia, s'il en existe, porte « À justifier » et un bouton « Justifier ».

⚠️ *Test d'erreur* : dernier jour `05/10/2026` avec premier jour `07/10/2026` → "La fin de la fenêtre précède son début." ; dernier jour dans le futur → "Un justificatif ne peut pas couvrir des dates futures.".

⚠️ *Écart connu* : "Motif : ILLNESS" (code brut) et "Élève : …" avec un identifiant au lieu du nom.

☐ OK ☐ KO

---

### Étape 336 — Emploi du temps, évaluations à venir et documents
👤 **parent** · fenêtre **B** · 📂 **« Emploi du temps »**, **« Évaluations à venir »**, **« Documents »** de Nadia

1. « Emploi du temps » : lire "Emploi du temps de DIABATE Nadia", utiliser **« Semaine précédente »**, **« Aujourd'hui »**, **« Semaine suivante »**, puis **« Vue jour »**.
2. « Évaluations à venir » : lire le titre et la note.
3. « Documents » : repérer les sections « Bulletins » (« Télécharger ») et « Reçus de paiement » (« PDF »), et chercher un bouton de dépôt.

✅ Une séance de 08:00 à 10:00 du lundi au jeudi (Français, Mathématiques, Anglais, Histoire-Géographie) jusqu'à J+14 ; au-delà « Aucune séance cette semaine. ». « Aucune évaluation planifiée. » tant qu'aucun examen n'est planifié. **Aucun** bouton de dépôt dans « Documents » (lecture seule).

☐ OK ☐ KO

---

### Étape 337 — Contact d'urgence : ajout par le secrétariat, correction par le parent
👤 **secrétariat**, **parent**, puis **secrétariat** · fenêtres **A** et **B** · 📂 `/v2/students` > fiche de DIABATE Nadia > onglet « Urgences » ; parent : « Dossier et contacts » (`/v2/parent/children/<id Nadia>/emergency`)

1. Parent : ouvrir « Dossier et contacts » : « Responsables » (DIABATE Séka, badge « Contact principal »), « Aucun contact d'urgence. » ; aucun bouton d'ajout.
2. Secrétariat : fiche de Nadia, onglet « Urgences », **« Ajouter un contact »** :

| Champ | Valeur |
| :--- | :--- |
| Nom du contact | `KONÉ Ibrahim test guide` |
| Lien avec l'élève | `Oncle` |
| Téléphone | `+225 07 08 09 10 11` |
| Priorité | `0` |

   Valider : « Le contact a été ajouté. ».
3. Parent : recharger, cliquer **« Modifier »** sur le contact, mettre « Téléphone » = `+225 05 11 22 33 44`, « Adresse e-mail » = `ibrahim.kone@exemple.test`, **« Enregistrer »**.
4. Secrétariat : recharger l'onglet « Urgences », puis cliquer **« Retirer »** pour nettoyer.

✅ « Contact mis à jour. » ; le secrétariat voit le nouveau numéro ; le parent ne peut ni ajouter, ni retirer, ni changer le lien. Retrait : « Le contact a été retiré. ».

⚠️ *Test d'erreur* : téléphone `12` → "Téléphone trop court." ; e-mail `ibrahim.kone` → "Adresse e-mail invalide.".

☐ OK ☐ KO

---

### Étape 338 — Lire la scolarité de Nadia (soldée) et de Salimata (reste dû)
👤 **parent** · fenêtre **B** · 📂 **« Scolarité »** de chaque enfant (`/v2/parent/children/<id>/finance`), ou `/v2/finance/me`

1. Nadia : lire « Situation » (« Facturé », « Avoirs », « Payé », « Reste à payer »), « Prochaines échéances », « Factures », « Paiements », « Reçus ».
2. Salimata (liste « Enfant ») : mêmes sections. Cliquer une facture pour déplier son échéancier.

✅ Nadia : **facture n°1 test guide** de la phase Finance visible (échéance "Tranche 3"), « Reste à payer » = R_F (15 000 F CFA en référence), le brouillon de la phase Finance **absent**, ses paiements dont 5 001 « En attente » et 5 013 « Échoué » si l'économe les a créés. Salimata : Payé 125 000 F CFA, Reste à payer 100 000 F CFA, une échéance à payer et le bouton **« Payer en ligne »**. Montants écrits "100 000 F CFA". Le reçu de Salimata n'apparaît jamais chez Nadia.

☐ OK ☐ KO

---

### Étape 339 — Payer en ligne en mode simulé (5 000, 5 001, 5 013)
👤 **parent** · fenêtre **B** · 📂 **« Scolarité »** de Salimata > **« Payer en ligne »**

⚠️ Les paiements créés ne se suppriment pas depuis l'interface.

1. Cliquer **« Payer en ligne »** (fenêtre « Payer en ligne »). Saisir pour le **premier paiement (réussite)** :

| Champ | Valeur |
| :--- | :--- |
| Facture à payer | la facture de scolarité ("… — reste 100 000 F CFA") |
| Montant (F CFA) | `5000` |
| Moyen de paiement | « Paiement simulé (démonstration) » |
| Numéro de téléphone du payeur | `+225 05 00 00 00 20` |

2. Cliquer **« Payer »**, observer « Suivi du paiement », puis **« Fermer »**. Recharger : relire « Situation », « Paiements », « Reçus ».
3. **Deuxième paiement (attente)** : même saisie avec `5001`. Cliquer **« Vérifier maintenant »**, attendre une dizaine de secondes.
4. **Troisième paiement (échec)** : recharger, refaire avec `5013`, **« Fermer »**.

✅ `5000` : badge « Confirmé », « Paiement confirmé. Votre reçu est disponible ci-dessous. » ; Payé 130 000 F CFA, Reste à payer 95 000 F CFA ; un nouveau reçu (**noter son numéro REC-…**). `5001` : « En attente » et « En attente de confirmation par l'opérateur. Cette page se met à jour toute seule. », qui **reste** après « Vérifier maintenant » (pas de bouton « Fermer » : recharger pour quitter). `5013` : badge « Échoué » et "Le paiement a échoué :" suivi d'un motif. Les paiements en attente ou échoués ne modifient pas le reste à payer. L'onglet de Nadia n'est pas modifié.

⚠️ *Test d'erreur* : montant vide → « Saisissez un montant. » ; `12,5` → « Le montant est un entier en francs : pas de virgule ni de point. » ; `500000` → "Le montant dépasse le reste dû de la facture.".

⚠️ *Écart connu* : l'aide du moyen de paiement rappelle les règles : montant en 001 en attente, montant en 013 refusé. Un autre moyen comme « Orange Money » est refusé avec un code brut (fournisseur non configuré).

☐ OK ☐ KO

---

### Étape 340 — Reçu : détail, PDF et vérification publique
👤 **parent**, puis **visiteur sans compte** · fenêtre **B** · 📂 reçu du paiement de 5 000 (`/v2/parent/children/<id Salimata>/finance/receipts/<id reçu>`), puis `/v2/verify`

1. Cliquer sur le numéro du reçu : lire « Retour à la scolarité », **« Télécharger le PDF »**, **« Imprimer »** et le document « Reçu de paiement » (« Date », « Mode de paiement » = "En ligne", « Montant reçu », « Reste à payer après ce paiement », « Imputation du paiement »).
2. Télécharger le PDF (`recu-REC-…pdf`) ; si « Le document est en cours de préparation. Réessayez dans quelques instants. » s'affiche, patienter. Lire dans le PDF le **code de vérification** (26 caractères) sous le QR.
3. Dans une fenêtre privée sans session, ouvrir `/v2/verify` (page « Vérification d'un document »), saisir le code, **« Vérifier »** ; refaire avec `AAAAAAAAAAAAAAAAAAAAAAAAAA`.

✅ Montant reçu 5 000 F CFA. Page publique : « Authentique », « Nature du document » = « Reçu de paiement », aucune donnée personnelle. Code inventé : « Inconnu » et « Aucun document ne correspond à ce code. Vérifiez la saisie ; si le code est correct, le document n'est pas authentique. ».

⚠️ *Écart connu* : le QR imprimé encode une adresse sans écran en local : saisir le code à la main sur `/v2/verify`.

☐ OK ☐ KO

---

### Étape 341 — Isolation de la famille
👤 **parent** · fenêtre **B** · 📂 adresses tapées à la main

Précondition : relever l'identifiant d'un élève d'une autre famille (en secrétariat : `/v2/students`, ligne de BAMBA Aya, code après `/v2/students/`) et d'un reçu de Salimata.

1. Taper `/v2/parent/children/<id Aya BAMBA>` puis ses sous-pages `/results`, `/finance`, `/documents`.
2. Taper `/v2/parent/children/<id Nadia>/finance/receipts/<id reçu de Salimata>`.
3. Taper `/v2/teacher`, `/v2/student`, `/v2/students`, `/v2/finance`, `/v2/attendance`, `/v2/direction`.

✅ Étape 1 : avertissement « Cet enfant n'est pas rattaché à votre compte (ou le lien a pris fin). Aucune information ne peut être affichée. » et bouton « Retour à mes enfants » ; ni nom, ni note, ni facture. Étape 2 : « Ressource introuvable. » sans contenu du reçu. Étape 3 : « Accès refusé » pour chaque adresse.

☐ OK ☐ KO

---

### Étape 342 — L'élève voit uniquement son dossier
👤 **élève** (DIABATE Nadia, `eleve@secondaire-test.test`, sans MFA) · fenêtre **B** · 📂 `/v2/student` (menu « Mon dossier »)

1. Se connecter : lire le titre (nom de l'élève), les cartes, la liste « Mes inscriptions » et le menu (« Mon dossier », « Mes résultats », « Mes bulletins », « Mon emploi du temps », « Mes absences », « Ma scolarité », « Mes documents »…).
2. Ouvrir « Mes résultats » et comparer moyenne, rang et notes avec ce que le parent voit pour Nadia.
3. Ouvrir « Mes documents » et chercher un bouton de dépôt.

✅ La fiche est celle de **DIABATE Nadia** (6e A) ; mêmes valeurs que dans le portail parent ; aucune liste « Enfant », aucun nom ni note de camarade ; rang de la forme "N sur M". Aucun dépôt dans « Mes documents ». Taper `/v2/parent` ou `/v2/teacher` → « Accès refusé ».

☐ OK ☐ KO

---

### Étape 343 — L'élève règle sa scolarité et ne voit pas sa sœur
👤 **élève** · fenêtre **B** · 📂 **« Ma scolarité »** (`/v2/student/finance`)

1. Lire « Situation » ; cliquer **« Payer en ligne »**, facture n°1 test guide, « Montant (F CFA) » `3013`, moyen simulé, **« Payer »**.
2. Parent : rouvrir « Scolarité » de Nadia et copier l'adresse de l'onglet de Salimata (`/v2/finance/me/<id Salimata>`).
3. Élève : coller `/v2/finance/me/<id Salimata>`, puis `/v2/students/<id Salimata>`, `/v2/finance/invoices`.

✅ `3013` : badge « Échoué », "Le paiement a échoué : sandbox_declined" ; aucun reçu ni changement de solde ; le parent voit aussi ce paiement « Échoué ». Adresse de Salimata : « Accès refusé » avec « Cet apprenant n'est pas rattaché à votre compte : ses informations financières ne peuvent pas être affichées. ». `/v2/students/<id Salimata>` et `/v2/finance/invoices` : « Accès refusé ».

☐ OK ☐ KO

---

### Étape 344 — L'enseignant voit ses séances et ses classes seulement
👤 **enseignant** (TRAORE Kouadio, `enseignant@secondaire-test.test`, sans MFA) · fenêtre **B** · 📂 `/v2/teacher` (menu « Aujourd'hui »), puis **« Mes classes »** (`/v2/teacher/classes`)

1. Se connecter : lire « Aujourd'hui » (compteurs « Séances » et « Appels à faire »), les boutons « Faire l'appel » / « Voir l'appel » et « Saisir les notes ». Un jeudi (J), les séances de la 6e A sont affichées ; un jour sans séance « Aucune séance aujourd'hui. ».
2. Ouvrir **« Mes classes »** : une seule carte, la 6e A (`6E-A`), badge « Responsable ». Cliquer **« Élèves »** : tableau « Élèves de 6e A ».
3. Taper `/v2/parent`, `/v2/student`, `/v2/finance`, `/v2/direction`, `/v2/payroll`.

✅ **Une seule classe** (6e A) avec au moins DIABATE Nadia, DIABATE Salimata, BAMBA Aya… ; le menu ne comporte aucune entrée de finance, de structure ou de paramètres. Les cinq adresses de l'étape 3 donnent « Accès refusé ». Chaque élève liste son statut (« Actif »).

⚠️ *Écart connu* : le bouton « Faire l'appel » est absent au collège (appel par séance).

☐ OK ☐ KO

---

### Étape 345 — Émettre un avoir ; refus d'annuler une facture encaissée
👤 **économe** (secondaire-test, `econome@secondaire-test.test`, MFA) · fenêtre **A** · 📂 Menu **« Finance »** > **« Factures »** > fiche de la facture n°1 test guide (`/v2/finance/invoices/<id>`), section « Correction de la facture »

**Noter** le « Reste dû » avant (R_F) et le montant « Avoirs » (A_F).

1. Cliquer **« Émettre un avoir »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Montant de l'avoir | `3000` |
| Motif | `Geste commercial test guide` |

2. Cliquer **« Émettre l'avoir »** et **noter le numéro d'avoir**.
3. Cliquer **« Annuler la facture »**, saisir le motif `Tentative de test guide` et valider.

✅ "L'avoir AV-2026-nnnnnn a été émis." ; « Avoirs » +3 000 F CFA, « Reste dû » = R_F − 3 000, statut « Partiellement payée ». Refus : "Une facture encaissée ne s'annule pas : remboursez puis émettez un avoir." (facture inchangée).

⚠️ *Test d'erreur* : avoir de montant supérieur au reste dû → "L'avoir dépasse le reste dû de la facture." ; motif `abc` → « Au moins 5 caractères. ».

☐ OK ☐ KO

---

### Étape 346 — Lire les paiements à rapprocher (économe)
👤 **économe** · fenêtre **A** · 📂 Menu **« Finance »** > **« À rapprocher »** (`/v2/finance/payments/pending`)

1. Lire l'encadré « Une seule personne habilitée tranche. Chaque résolution exige une vérification MFA récente, un motif et une preuve ; elle s'applique aussitôt et est journalisée (état avant et après, auteur, motif). » et le tableau (« Reçu le », « Fournisseur », « Montant », « Rapprochement », « Prochaine vérification »).
2. Repérer la ligne 5 001 de Salimata (fournisseur `sandbox`, créée à l'étape *Payer en ligne en mode simulé*), état « Pas encore contrôlé ». Cliquer **« Vérifier maintenant »** sur cette ligne.
3. Constater l'absence de bouton « Résoudre à la main ».

✅ Message `Le fournisseur répond toujours "en attente".` (le fournisseur simulé ne règle jamais seul) ; l'économe n'a **pas** « Résoudre à la main ». Si d'autres paiements 5 001 de la phase Finance sont aussi listés, distinguer par l'heure « Reçu le ».

☐ OK ☐ KO

---

### Étape 347 — Résoudre à la main un paiement bloqué (directeur)
👤 **directeur** (MFA) · fenêtre **A** · 📂 **« Finance »** > **« À rapprocher »** (`/v2/finance/payments/pending`)

1. Sur la ligne 5 001 de Salimata, cliquer **« Résoudre à la main »** (fenêtre « Résoudre un paiement à la main »). Saisir :

| Champ | Valeur |
| :--- | :--- |
| Ce qui s'est réellement passé | « L'argent est arrivé : confirmer le paiement (reçu et imputation) » |
| Motif | `Paiement vérifié sur le relevé de test guide` |
| Preuve | `RELEVE-TG-001` |

2. Cliquer **« Résoudre le paiement »** ; si « Confirmez votre identité » s'ouvre, saisir le code du moment puis **« Confirmer et continuer »**.
3. Ouvrir « Encaissements » (`/v2/finance/payments`) et la scolarité de Salimata.

✅ « La résolution est enregistrée et appliquée. » ; la ligne quitte la liste ; le paiement de 5 001 est « Confirmé » avec un reçu, imputé à la facture de Salimata : Payé 135 001 F CFA, Reste à payer 89 999 F CFA (soit 95 000 − 5 001). La résolution est inscrite au journal d'audit.

⚠️ *Test d'erreur* : motif `court` → « Le motif doit faire au moins 10 caractères. » ; preuve `ab` → « Saisissez la preuve (3 caractères au moins). » ; code `000000` → « Code invalide. Vérifiez l'heure de votre téléphone, puis attendez le prochain code. » (rien n'est modifié).

☐ OK ☐ KO

---

### Étape 348 — Remboursement à quatre yeux
👤 **économe** (demande), **directeur** (approbation) · fenêtres **A** (économe) et **A** après reconnexion · 📂 fiche du paiement `VIR-TG-001` (`/v2/finance/payments`) puis **« Remboursements »** (`/v2/finance/refunds`)

1. Économe : ouvrir la fiche du virement `VIR-TG-001` (10 000 F CFA), cliquer **« Demander un remboursement »** :

| Champ | Valeur |
| :--- | :--- |
| Montant à rembourser | `3000` |
| Motif | `Erreur de saisie lors du test guide` |

   Cliquer **« Envoyer la demande »**.
2. Économe : **« Remboursements »**, ligne 3 000 « Demandé », cliquer **« Approuver »** puis **« Approuver »** dans la fenêtre.
3. Directeur : **« Remboursements »**, même ligne, **« Approuver »** (case « Exécuter immédiatement » cochée), **« Approuver »**.
4. Économe : demande de `2000` sur `VIR-TG-001`, motif `Demande de test guide à refuser`. Directeur : **« Refuser »**, « Motif du refus » `Refus de test guide`, **« Refuser »**.

✅ « La demande de remboursement a été enregistrée ; une autre personne doit l'approuver. » ; statut « Demandé ». Étape 2 : refus "Le demandeur ne peut pas approuver son propre remboursement." et la ligne reste « Demandé ». Étape 3 : « Le remboursement est approuvé et exécuté. », statut « Exécuté » ; fiche du virement : « Remboursé » 3 000 F CFA, « Net » 7 000 ; la facture n°1 test guide revient à un reste dû de R_F − 3 000 + 3 000 = R_F (avoir et remboursement se compensent sur le reste dû). Étape 4 : « Le remboursement est refusé. », statut « Refusé » (définitif).

⚠️ *Test d'erreur* : demande de `11000` sur le virement de 10 000 → "Le remboursement dépasse le montant remboursable." ; paiement échoué ou en attente → pas de bouton « Demander un remboursement ».

☐ OK ☐ KO

---

### Étape 349 — Rapports financiers
👤 **économe** · fenêtre **A** · 📂 Menu **« Finance »** > **« Rapports »** (`/v2/finance/reports`)

1. Lire « Rapports financiers » et les filtres « Année scolaire », « Situation au », « Groupe (classe) ».
2. Relire la « Synthèse » et parcourir « Créances par classe » (la 6e A y figure), « Créances par apprenant » (case « Apprenants avec un restant dû seulement ») et « Balance âgée ».
3. Cliquer un **« Exporter en CSV »**.
4. Pour « Évolution » : « Du » postérieur à « Au ».

✅ Les montants recoupent les factures et paiements ; le CSV se télécharge. Erreur : « La date de début doit précéder la date de fin. » ; période sans encaissement : « Aucun encaissement sur la période ». En secrétariat ou parent, `/v2/finance/reports` donne « Accès refusé ».

☐ OK ☐ KO

---

### Étape 350 — Les tableaux de bord suivent la finance
👤 **propriétaire** · fenêtre **A** · 📂 **« Pilotage »** > **« Scolarité »** (`/v2/owner/scolarite`)

Précondition : une à deux minutes après les étapes de paiement et de remboursement (le rafraîchissement est fait par le worker). Reprendre les relevés E1, A1 et R1 de la phase *Tableaux de bord et alertes*.

1. Recharger « Scolarité » et relire « Encaissé », « Avoirs », « Restant dû ».
2. Recharger `/v2/direction` et relire « Données au … ».

✅ Par rapport aux relevés (si aucune autre opération financière n'a eu lieu entre-temps) : « Encaissé » = E1 + 5 000 + 5 001 − 3 000 ; « Avoirs » = A1 + 3 000 ; « Restant dû » = R1 − 10 001. La date « Données au » avance. Au-delà de deux minutes sans changement : noter l'écart (worker arrêté). *(Chiffres à vérifier en test.)*

⚠️ *Écart connu* : un paiement en ligne `5013` ou `3013` (refusé) ne change aucun chiffre.

☐ OK ☐ KO

---

### Étape 351 — ⚠️ Clôturer la session de caisse
👤 **économe** · fenêtre **A** · 📂 Menu **« Finance »** > **« Caisse »** (`/v2/finance/cash`)

⚠️ Irréversible : la clôture est définitive.

Précondition : la session de caisse de la phase Finance est ouverte (fonds de caisse 10 000 F CFA, un encaissement en espèces de 8 000 F CFA).

1. Dans « Ma session » : « Encaissé » 8 000 F CFA, « Nombre d'encaissements » 1. Cliquer **« Clôturer la session »** (fenêtre « Clôturer la session » : « Saisissez le montant réellement compté. La clôture est définitive. »).
2. Saisir « Montant compté en caisse » = `18000` (fonds compris), « Observation » vide, **« Clôturer »**.
3. Ouvrir **« Détails »** dans « Historique des sessions ».
4. Ouvrir une nouvelle session (**« Ouvrir une session »**, fonds `5000`), puis **« Clôturer la session »** avec « Montant compté en caisse » `4000` sans observation ; puis avec l'observation `Écart de test guide : 1 000 F manquants`.

✅ « La session est clôturée. » ; « Montant attendu » 18 000, « Montant compté » 18 000 F CFA, « Aucun écart : la caisse est juste. ». Session « Clôturée » dans « Historique des sessions ». Nouvelle session : sans observation, refus "Écart de caisse de -1000 XOF : une justification est obligatoire." ; avec observation : « Écart : il manque 1 000 F CFA en caisse. ». Les écarts apparaissent ensuite dans « Écarts de caisse » de `/v2/owner/tresorerie`.

⚠️ *Test d'erreur* : montant compté `-1` → « Le montant ne peut pas être négatif. » ; vide → « Saisissez un montant. ».

📚 *Pour aller plus loin* : chapitre 21, scénarios 21.9 à 21.14, 21.19 à 21.22 ; chapitre 12c, scénarios 12.22 à 12.24, 12.26 à 12.29, 12.33 à 12.35 et 12.38 (droits par adresse).

**Ce que la phase laisse dans l'application :** paiements en ligne simulés de DIABATE Salimata : 5 000 F CFA (confirmé, avec reçu), 5 001 F CFA (confirmé après résolution `RELEVE-TG-001`), 5 013 F CFA (échoué) — reste dû de Salimata : 89 999 F CFA ; paiement échoué de 3 013 F CFA de l'élève Nadia ; avoir de 3 000 F CFA sur la facture n°1 test guide ; remboursements de 3 000 F CFA (exécuté) et 2 000 F CFA (refusé) sur `VIR-TG-001` ; deux sessions de caisse clôturées (dont une avec écart justifié de 1 000 F CFA) ; justificatif d'absence retiré ; contact d'urgence `KONÉ Ibrahim test guide` retiré.

---

## Phase 19 — Sécurité, droits et isolation

Objectif : essayer d'ouvrir ou de faire ce qu'on ne doit pas pouvoir faire, et constater un refus propre (aucune donnée d'autrui, aucun détail technique, aucune page blanche). Un seul cas où l'on voit ce qu'on ne devrait pas voir est un défaut **Bloquant** : prévenir l'équipe tout de suite.

Précondition : les phases précédentes ont été jouées (le journal d'audit en contient les actes, et les « quatre yeux » ont leurs objets : remboursement, feuille de notes, mesure de vie scolaire…). Trois navigateurs distincts sont nécessaires pour l'isolation (voir l'étape *Ouvrir les trois contextes*).

**Refus standard** (utilisé dans toutes les étapes de droits) : l'adresse tapée redirige vers `/unauthorized`, page « Accès refusé » avec le texte "Vous n'avez pas les droits nécessaires pour afficher cette page." et le lien "Retour à l'accueil" ; aucune donnée de l'établissement n'apparaît. Toujours **taper l'adresse complète dans la barre d'adresse puis Entrée** (pas de clic dans le menu).

⚠️ *Écart connu* : la page « Accès refusé » garde l'ancienne mise en page et peut être précédée d'un instant de « Chargement… » ; le critère de réussite est le refus sans donnée, pas l'habillage.

---

### Étape 352 — Propriétaire : la console de la plateforme lui est fermée
👤 **propriétaire** (secondaire-test) · fenêtre **A** · 📂 Atterrissage `/v2/direction`

Compte : `direction.generale@secondaire-test.test` (MFA : le code du moment est proposé dans le panneau de connexion).

1. Se connecter ; vérifier l'arrivée sur `/v2/direction` et que le menu contient « Journal d'audit ».
2. Taper dans la barre d'adresse, une par une :

| Adresse | Résultat attendu |
| :--- | :--- |
| `/v2/platform/tenants` | retour à `/v2/platform/login` ; aucune organisation affichée |
| `/v2/platform/plans` | retour à `/v2/platform/login` |
| `/v2/platform/audit` | retour à `/v2/platform/login` |

✅ Les trois adresses ramènent à la connexion de la console : un propriétaire d'établissement n'est pas un opérateur de la plateforme.

☐ OK ☐ KO

---

### Étape 353 — Directeur : paie du propriétaire et console fermées
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 Atterrissage `/v2/direction`

Compte : `directeur@secondaire-test.test` (MFA).

1. Se connecter (« Se déconnecter » du propriétaire puis connexion par le panneau).
2. Taper :

| Adresse | Résultat attendu |
| :--- | :--- |
| `/v2/payroll/configuration/settings` | Refus standard (« Accès refusé ») : les réglages de paie sont au propriétaire seul |
| `/v2/platform/tenants` | retour à `/v2/platform/login` |
| `/v2/platform/audit` | retour à `/v2/platform/login` |

3. Taper `/v2/settings/subscription` : l'écran s'ouvre en lecture, sans bouton de modification de l'abonnement.

✅ Les trois adresses sont refusées comme indiqué ; l'abonnement n'est que lisible.

⚠️ *Écart connu* : `/v2/access/roles/new` s'ouvre pour le directeur (la garde ne vérifie que la lecture) ; l'enregistrement d'un rôle est refusé par le serveur ("Action non autorisée." ou demande de confirmation d'identité).

☐ OK ☐ KO

---

### Étape 354 — Directeur des études et responsable pédagogique : trois adresses chacun
👤 **directeur des études** (secondaire-test) · fenêtre **A** · puis 👤 **responsable pédagogique** (secondaire-test) · fenêtre **A**

Comptes : `etudes@secondaire-test.test` (MFA) arrive sur `/v2/academic/years` ; `pedagogie@secondaire-test.test` (MFA) arrive sur `/v2/assessments`.

1. Directeur des études, taper :

| Adresse | Résultat attendu |
| :--- | :--- |
| `/v2/finance` | Refus standard |
| `/v2/audit` | Refus standard |
| `/v2/reportcards/identity` | Refus standard |

2. « Se déconnecter », connexion en responsable pédagogique, taper :

| Adresse | Résultat attendu |
| :--- | :--- |
| `/v2/assessments/new` | Refus standard (il relit les feuilles, il n'en crée pas) |
| `/v2/reportcards/issue` | Refus standard |
| `/v2/finance` | Refus standard |

✅ Six refus standard ; aucune donnée financière ni de journal n'apparaît.

☐ OK ☐ KO

---

### Étape 355 — Secrétariat : trois adresses interdites et une page qui s'ouvre
👤 **secrétariat** (secondaire-test) · fenêtre **A** · 📂 Atterrissage `/v2/students`

Compte : `secretariat@secondaire-test.test` (MFA).

1. Se connecter, puis taper :

| Adresse | Résultat attendu |
| :--- | :--- |
| `/v2/admissions/settings` | Refus standard |
| `/v2/finance/payments/new` | Refus standard |
| `/v2/schoollife` | Refus standard |

2. Taper `/v2/finance/refunds` : **la page s'ouvre** (le secrétariat a la lecture des paiements), mais aucune demande ni approbation n'est proposée.

✅ Trois refus standard ; sur les remboursements, liste lisible et aucun bouton d'action.

⚠️ *Écart connu* : l'ancien guide donnait `/v2/finance/refunds` comme refusée : l'attendu correct est "s'ouvre, sans action".

☐ OK ☐ KO

---

### Étape 356 — Économe : trois adresses interdites
👤 **économe** (secondaire-test) · fenêtre **A** · 📂 Atterrissage `/v2/finance`

Compte : `econome@secondaire-test.test` (MFA).

1. Se connecter, puis taper :

| Adresse | Résultat attendu |
| :--- | :--- |
| `/v2/students/new` | Refus standard |
| `/v2/assessments` | Refus standard |
| `/v2/finance/providers` | Refus standard (fournisseurs de paiement réservés à la direction) |

✅ Trois refus standard ; l'économe garde l'accès à `/v2/finance`.

☐ OK ☐ KO

---

### Étape 357 — Enseignant : trois adresses interdites et un écran sans garde
👤 **enseignant** (secondaire-test) · fenêtre **B** · 📂 Atterrissage `/v2/teacher`

Compte : `enseignant@secondaire-test.test` (sans MFA).

1. Se connecter en fenêtre privée, puis taper :

| Adresse | Résultat attendu |
| :--- | :--- |
| `/v2/finance` | Refus standard |
| `/v2/audit` | Refus standard |
| `/v2/settings` | Refus standard |

2. Taper `/v2/admin/members` (écran sans garde de page).

✅ Trois refus standard. Étape 2 : le cadre de l'écran s'ouvre mais la liste ne se charge pas ; message "Action non autorisée." ; aucune ligne de membre. Sur sa feuille de notes, l'enseignant ne voit aucun bouton « Marquer comme relue », « Approuver » ni « Publier les notes ».

⚠️ *Écart connu* : `/v2/admin/members` ouvre l'écran puis affiche une erreur au lieu de rediriger vers « Accès refusé » (Mineur).

☐ OK ☐ KO

---

### Étape 358 — Éducateur : il propose, la direction valide
👤 **éducateur** (secondaire-test) · fenêtre **B** · 📂 Atterrissage `/v2/attendance`

Compte : `educateur@secondaire-test.test` (sans MFA).

1. « Se déconnecter » de l'enseignant, connexion en éducateur, puis taper :

| Adresse | Résultat attendu |
| :--- | :--- |
| `/v2/schoollife/validations` | Refus standard (il propose les mesures, il ne les valide pas) |
| `/v2/finance` | Refus standard |
| `/v2/audit` | Refus standard |

✅ Trois refus standard ; `/v2/settings` s'ouvre en lecture seule (bandeau « Vous pouvez consulter ces informations mais pas les modifier. »).

☐ OK ☐ KO

---

### Étape 359 — Responsable des examens et chargé d'admissions : trois adresses chacun
👤 **responsable des examens** (secondaire-test) · fenêtre **A** · puis 👤 **chargé d'admissions** (secondaire-test) · fenêtre **A**

Comptes : `examens@secondaire-test.test` (arrive sur `/v2/examinations`) et `admissions@secondaire-test.test` (arrive sur `/v2/admissions`), tous deux sans MFA.

1. Responsable des examens, taper :

| Adresse | Résultat attendu |
| :--- | :--- |
| `/v2/finance` | Refus standard |
| `/v2/students/new` | Refus standard |
| `/v2/results/overrides` | Refus standard |

2. Chargé d'admissions, taper :

| Adresse | Résultat attendu |
| :--- | :--- |
| `/v2/finance` | Refus standard |
| `/v2/students` | Refus standard (le dossier élève naît à l'acceptation de l'offre) |
| `/v2/documents` | Refus standard |

✅ Six refus standard.

☐ OK ☐ KO

---

### Étape 360 — Parent et élève : le portail ne s'ouvre pas sur la gestion
👤 **parent** (secondaire-test) · fenêtre **B** · puis 👤 **élève** (secondaire-test) · fenêtre **B**

Comptes : `parent@secondaire-test.test` (DIABATE Séka, arrive sur `/v2/parent`) et `eleve@secondaire-test.test` (DIABATE Nadia, arrive sur `/v2/student`), sans MFA.

1. Parent, taper :

| Adresse | Résultat attendu |
| :--- | :--- |
| `/v2/students` | Refus standard |
| `/v2/finance/invoices` | Refus standard (le parent lit la scolarité de ses enfants, pas les factures de gestion) |
| `/v2/direction` | Refus standard |

2. « Se déconnecter », connexion en élève, taper :

| Adresse | Résultat attendu |
| :--- | :--- |
| `/v2/parent` | Refus standard |
| `/v2/finance` | Refus standard |
| `/v2/attendance` | Refus standard |

✅ Six refus standard.

☐ OK ☐ KO

---

### Étape 361 — Visiteur non connecté : retour à la connexion, pages publiques
👤 **aucun compte** · fenêtre **B** (« Se déconnecter » puis fenêtre privée neuve, aucune session ouverte)

1. Taper `/v2/finance`, `/v2/students`, `/v2/direction`, `/v2/parent`, `/v2/audit`.
2. Taper les pages publiques `/v2/login`, `/v2/forgot-password`, `/v2/verify`.

✅ Étape 1 : chaque adresse ramène à `/login`, sans aucun contenu entrevu. Étape 2 : les trois pages s'ouvrent sans connexion et ne montrent aucune donnée d'établissement.

⚠️ *Écart connu* : une adresse qui n'existe pas (par exemple `/page-inexistante`) ou un identifiant mal formé (`/v2/parent/children/abc`) affiche la page 404 par défaut de Next, vraisemblablement en anglais ("This page could not be found.") et sans habillage (Mineur). Elle ne doit révéler aucune donnée.

☐ OK ☐ KO

---

### Étape 362 — Ouvrir les trois contextes d'établissement
👤 **secrétariat** de chaque établissement · trois navigateurs séparés

Deux fenêtres privées d'un même navigateur partagent la même session : utiliser une fenêtre normale, une fenêtre privée et un second navigateur (ou un autre profil).

| Contexte | Compte | Établissement |
| :--- | :--- | :--- |
| Fenêtre **A** (normale) | `secretariat@secondaire-test.test` | Collège Le Baobab |
| Fenêtre **B** (privée) | `secretariat@primaire-test.test` | École Les Palmiers |
| Troisième navigateur **C** | `secretariat@superieur-test.test` | Université Horizon |

1. Se connecter dans chaque contexte (panneau de `/login`, code MFA proposé).
2. Dans chacun, ouvrir « Mon compte » > « Sécurité du compte » et lire l'établissement affiché.

✅ Trois sessions indépendantes, chacune sur son établissement. Ne jamais se reconnecter dans un contexte avec le compte d'un autre établissement (cela remplace la session).

☐ OK ☐ KO

---

### Étape 363 — Les listes ne mélangent pas les établissements
👤 **secrétariat** · fenêtres **A**, **B** et navigateur **C** · 📂 Menu **« Élèves »** (`/v2/students`), puis **« Classes »** (`/v2/academic/classrooms`)

1. Dans A, relever le nombre d'élèves et le code de classe `6E-A`. Dans B : `CP1-A` et `GS-A`. Dans C : `L1-A`.
2. Dans chaque contexte, ouvrir "Facturation" (`/v2/finance/invoices`) si le menu la propose (lecture) et relever le montant de scolarité d'une facture.

✅ Les noms des élèves de la graine sont **identiques** dans les trois établissements (DIABATE Nadia, BAMBA Aya…) mais ce sont des personnes distinctes ; scolarité 200 000 F CFA au Collège, 120 000 F CFA à l'École, 600 000 F CFA à l'Université ; aucune classe ni aucun montant d'un autre établissement dans les listes ni dans les filtres.

☐ OK ☐ KO

---

### Étape 364 — Un identifiant copié d'un établissement et collé dans l'autre
👤 **secrétariat** · fenêtres **A**, **B** et navigateur **C** · 📂 Fiches de détail

1. Dans A, ouvrir la fiche d'un élève (`/v2/students/<id>`) et **copier l'identifiant** (la suite après le dernier `/`). Faire de même pour une classe (`/v2/academic/classrooms/<id>`) et une inscription (`/v2/enrollments/<id>`).
2. Dans B, puis dans C, taper la **même adresse** avec l'identifiant copié, pour chacun des trois objets.
3. Répéter dans le sens inverse (B vers A, C vers A).
4. Dans une fenêtre sans connexion, coller la même adresse.

✅ Étapes 2 et 3 : la page s'ouvre **sans donnée** et affiche un message de type "introuvable" propre à l'écran (par exemple "Ressource introuvable." ou "Élève introuvable"). Jamais « Accès refusé », jamais le nom de l'élève, jamais "cet élève appartient à un autre établissement". Étape 4 : retour à `/login`.

⚠️ *Test d'erreur* : taper `/v2/students/11111111-1111-4111-8111-111111111111` (identifiant bien formé mais inexistant) : réponse **indiscernable** de celle d'un objet d'un autre établissement (c'est le critère d'isolation). Un identifiant tronqué (`/v2/students/abc`) donne la page 404.

☐ OK ☐ KO

---

### Étape 365 — Même test directement sur l'API
👤 **secrétariat** · fenêtre **B** (École) · 📂 Outils de développement (F12) > Console, sur `http://localhost:3000`, onglet connecté

Ne jamais afficher ni recopier le jeton.

1. Dans A (Collège), copier l'identifiant d'un élève (`<id-A>`).
2. Dans B (École), exécuter, en remplaçant `<id-A>` :

```js
const r = await fetch('/api/v1/people/students/<id-A>');
console.log(r.status, await r.text());
```

3. Toujours dans B, exécuter la même requête **sans jeton** vers l'API directe :

```js
const r = await fetch('http://localhost:4000/api/v1/people/students/<id-A>', { headers: { 'X-Tenant': 'secondaire-test' } });
console.log(r.status);
```

✅ Étape 2 : statut **404**, corps JSON du type `people.student_not_found` avec le message "Élève introuvable (`<id-A>`)." (l'identifiant reflété est celui que vous avez saisi), jamais 403 ni 200. Étape 3 : statut **401** (un en-tête `X-Tenant` ne remplace jamais une session).

⚠️ *Test d'erreur* : `.../students/xyz` (non valide) : 400 ou 404, jamais 500 ni trace technique.

☐ OK ☐ KO

---

### Étape 366 — À l'intérieur du Collège : parent, élève et enseignant cloisonnés
👤 **secrétariat** (copie des identifiants) · fenêtre **A** ; 👤 **parent**, **élève** · fenêtre **B**

1. Secrétariat (A) : sur `/v2/students`, ouvrir la fiche de **BAMBA Aya** (autre tuteur) et copier son identifiant.
2. Parent (`parent@secondaire-test.test`, B) : taper `/v2/parent/children/<id d'Aya>`, puis la même adresse suivie de `/results`, `/finance`, `/reportcards`, `/attendance`.
3. Élève (`eleve@secondaire-test.test`, B) : taper `/v2/students/<id d'Aya>`. Puis, si un reçu de DIABATE Salimata existe (phase des encaissements), copier son identifiant côté économe et taper `/v2/student/finance/receipts/<id du reçu>`.

✅ Étape 2 : aucune donnée d'Aya, message neutre de type introuvable ; jamais "vous n'avez pas accès à cet enfant" (révèlerait l'existence : défaut Majeur). Étape 3 : `/v2/students/<id>` donne « Accès refusé » ; le reçu de la sœur donne "Ressource introuvable.".

☐ OK ☐ KO

---

### Étape 367 — Quatre yeux : remboursement, notes, corrections et surcharges
👤 **économe**, **directeur**, **propriétaire**, **directeur des études**, **enseignant** · fenêtres **A** et **B**

Principe : la même personne ne peut pas faire les deux gestes d'un circuit ; le serveur compare l'utilisateur au demandeur. Pour chaque circuit, l'objet a été créé dans une phase précédente : rejouer seulement le geste interdit. Si l'objet n'existe pas, jouer d'abord l'étape qui le crée.

1. **Remboursement** (phase finance : l'économe a demandé un remboursement). Économe (A) : `/v2/finance/refunds`, cliquer **« Approuver »** sur **sa propre** demande, confirmer.
2. Rejouer le même geste dans chaque ligne du tableau :

| Circuit (étape déjà jouée) | Qui tente | Geste | Message exact attendu |
| :--- | :--- | :--- | :--- |
| Remboursement | économe | « Approuver » sa demande | "Le demandeur ne peut pas approuver son propre remboursement." |
| Feuille de notes soumise (phase notes) | directeur qui a soumis | « Marquer comme relue », puis « Approuver », puis « Publier les notes » | "La personne qui a soumis la feuille ne peut pas la relire, l'approuver ni la publier." |
| Correction d'une note publiée | directeur des études | demander puis « Approuver » sa propre demande | "Le demandeur d'une correction ne peut pas l'approuver lui-même." |
| Surcharge de résultat | directeur | demander puis « Approuver » sa propre demande | "Le demandeur d'une surcharge ne peut pas l'approuver lui-même." |

3. Contrôle de rôle : l'enseignant n'a, sur sa feuille de notes, aucun bouton de relecture, d'approbation ni de publication.

✅ Chaque refus affiche le message exact ci-dessus ; l'objet reste dans son état ("en attente", « Soumise »…). L'approbation par une **autre** personne (propriétaire pour le remboursement et la surcharge, directeur des études pour la correction) réussit.

⚠️ *Écart connu* : le circuit de paie (le directeur calcule puis tente d'arrêter le bulletin : "Séparation des tâches : celui qui a calculé le bulletin ne peut pas l'arrêter.") n'est actif que si le propriétaire a **coché** « Séparation des tâches » dans les réglages de paie (décoché par défaut) ; à rétablir ensuite.

☐ OK ☐ KO

---

### Étape 368 — Quatre yeux : vie scolaire, conseil, affectation d'État
👤 **éducateur**, **directeur**, **propriétaire**, **directeur des études**, **secrétariat** · fenêtres **A** et **B**

| Circuit (étape déjà jouée) | Qui tente | Geste | Message exact attendu |
| :--- | :--- | :--- | :--- |
| Mesure « Exclusion temporaire (démonstration) » proposée (phase vie scolaire) | directeur qui l'a proposée | valider sa propre proposition | "La validation doit venir d'une autre personne que le proposant (séparation des tâches)." |
| Déverrouillage d'un conseil de classe (phase conseils) | directeur des études qui a demandé | approuver sa propre demande | "L'approbation doit venir d'une autre personne que le demandeur (séparation des tâches)." |
| Dossier d'élève affecté par l'État (phase affectés) | enregistreur du dossier | « Vérifier » son propre dossier | "La vérification doit venir d'une autre personne que celle qui a enregistré le dossier." |
| Séance comptable (phase emploi du temps) | directeur qui l'a créée | la valider pour la paie | "Validation "à quatre yeux" : celui qui a saisi une séance comptable ne peut pas la valider." |

1. Rejouer chaque ligne avec le compte indiqué ; une **autre** personne de la direction réussit ensuite le même geste.
2. L'éducateur n'a ni `/v2/schoollife/validations` ni bouton « Valider » (étape *Éducateur*) ; le secrétariat n'ouvre pas `/v2/stateassign/verification` (« Accès refusé »).

✅ Messages exacts ci-dessus ; la mesure reste « Proposée » ; le dossier reste « Enregistré ».

⚠️ *Test d'erreur* : un avertissement sans case « quatre yeux » (« Avertissement (démonstration) ») peut être validé par son proposant : la séparation dépend du **type** de mesure, ce n'est pas un défaut.

☐ OK ☐ KO

---

### Étape 369 — Anti-escalade : le directeur ne s'octroie pas le rôle de propriétaire
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 Menu **« Attributions de rôles »** (`/v2/access/assignments`)

1. Dans **« Nouvelle attribution »**, choisir l'utilisateur `educateur@secondaire-test.test` et le rôle **« Propriétaire »**, périmètre **« Tout l'établissement »**.
2. Cliquer **« Attribuer le rôle »**.

✅ Refus : « Action refusée : vous ne pouvez accorder que des permissions que vous détenez vous-même sur ce périmètre. Permissions qui vous manquent : » suivi de la liste ; **aucune attribution** n'est créée (la liste est inchangée). Si l'attribution réussit, c'est un défaut **Bloquant** : prévenir l'équipe.

⚠️ *Test d'erreur* : tenter de modifier un rôle système (ouvrir « Secrétariat ») : "Ce rôle système est verrouillé. Clonez-le pour créer une variante modifiable." Ne jamais tenter de révoquer le dernier propriétaire d'un établissement de départ (ce test se fait dans une organisation jetable).

☐ OK ☐ KO

---

### Étape 370 — MFA : faux code, puis rejeu d'un code déjà utilisé
👤 **économe** puis **directeur** (secondaire-test) · fenêtre **A** · 📂 Page `/login`

1. « Se déconnecter » ; sur `/login`, cliquer le compte `econome@secondaire-test.test` dans le panneau. L'écran de vérification en deux étapes demande le code à 6 chiffres.
2. Effacer le code proposé et saisir `000000`.
3. Saisir ensuite le code du moment proposé : connexion réussie.
4. « Se déconnecter », se connecter en `directeur@secondaire-test.test` avec le code du moment, puis « Se déconnecter » aussitôt.
5. Se reconnecter en directeur en saisissant **le même code** que celui de l'étape 4.
6. Attendre le code suivant (30 secondes) : connexion réussie.

✅ Étape 2 : "Code invalide. Vérifiez l'heure de votre téléphone et réessayez." ; on reste sur l'écran du code. Étape 5 : le même message (un code ne sert qu'une fois, même dans sa fenêtre de 30 secondes). Étapes 3 et 6 : connexion réussie.

⚠️ *Test d'erreur* : un code de 5 chiffres laisse le bouton inactif. Ne pas saisir cinq faux codes de suite (verrou).

☐ OK ☐ KO

---

### Étape 371 — Sessions : révocation immédiate depuis un autre appareil
👤 **enseignant** (secondaire-test) · fenêtre **B** et troisième navigateur **C** · 📂 Menu **« Mon compte »** > **« Mes sessions »** (`/v2/account/sessions`)

1. Se connecter avec `enseignant@secondaire-test.test` dans B **et** dans C (navigateur différent).
2. Dans B, ouvrir « Mes sessions » : deux lignes, la courante porte « Cet appareil ».
3. Dans B, cliquer **« Révoquer »** sur l'autre session.
4. Dans C, recharger la page ou cliquer sur un lien.
5. Dans B, cliquer **"Déconnecter tous mes appareils"**.

✅ Étape 3 : "Session révoquée." ; B reste connecté. Étape 4 : C est renvoyé à `/login` immédiatement (message "Votre session a pris fin. Reconnectez-vous." ou « Votre session a expiré. Veuillez vous reconnecter. »). Étape 5 : B revient aussi à `/login`.

⚠️ *Test d'erreur* : après la déconnexion de B, le bouton « Précédent » du navigateur ne doit réafficher aucune donnée privée *(à vérifier)*.

☐ OK ☐ KO

---

### Étape 372 — Verrouillage après des échecs, et réponse neutre au mot de passe oublié
👤 **élève de l'École** (primaire-test) · fenêtre **B** · 📂 Page `/login`

Compte peu sensible : `eleve@primaire-test.test` (sans MFA). Aucune autre session de ce compte à préserver.

1. Saisir l'e-mail à la main et le mot de passe volontairement faux `Mauvais-mot-de-passe-test-guide`, cinq fois de suite.
2. Au 6e essai, cliquer le compte dans le panneau (**bon** mot de passe).
3. Attendre 1 minute, puis se reconnecter par le panneau.
4. Ouvrir `/v2/forgot-password`, saisir `eleve@primaire-test.test`, valider ; recommencer avec `inconnu@exemple.test`.

✅ Étape 1 : à chaque fois "Identifiants invalides. Vérifiez votre e-mail et votre mot de passe." (même message pour un e-mail inexistant : pas d'énumération). Étape 2 : "Trop de tentatives. Réessayez dans 1 minute." même avec le bon mot de passe. Étape 3 : connexion réussie. Étape 4 : **même** message dans les deux cas, "Si un compte existe pour cette adresse, un e-mail vient d'être envoyé. Pensez à vérifier vos courriers indésirables." (aucun e-mail n'est réellement envoyé).

⚠️ Ces échecs laissent des entrées `login.failed` dans le journal d'audit (non supprimables) : elles servent à l'étape suivante.

☐ OK ☐ KO

---

### Étape 373 — Journal d'audit : retrouver les actes des phases précédentes
👤 **propriétaire** (secondaire-test) · fenêtre **A** · 📂 Menu **« Journal d'audit »** (`/v2/audit`)

Attendre une minute après les étapes précédentes (les événements d'identité arrivent avec quelques secondes de délai).

1. Dans le formulaire **« Filtrer le journal »**, champ **« Action »**, saisir `login.failed`, cliquer **« Appliquer les filtres »**.
2. Remplacer par `session.revoked`, puis `role.*`, puis `assignment.*`, puis `finance.*`.
3. Filtrer ensuite sur les actes des phases précédentes qui ont été jouées : `grade.published`, `reportcard.*`, `payroll.*`, `assess.revision.*`.
4. Cliquer **« Réinitialiser »**, ouvrir le lien d'une entrée (par exemple une entrée `session.revoked`).

✅ Étape 1 : les cinq échecs de l'étape *Verrouillage* (acteur « Système », gravité « Notable », « Avertissement » pour le verrouillage). Étape 2 : la révocation de l'étape *Sessions* avec son acteur ; `finance.refund.requested` et `finance.refund.approved` portent des acteurs **distincts**. Étape 3 : une ligne par acte joué (publication de notes, émission de bulletins…). Étape 4 : page « Entrée du journal » avec « Informations générales » (« Numéro de séquence », « Empreinte », « Empreinte précédente », « Algorithme »). Une connexion réussie n'est **pas** tracée (normal).

⚠️ *Test d'erreur* : saisir « Du » postérieur à « Au » : « La fin de période doit suivre le début. » ; « Action » = `Role Changed` : « Format attendu : entité.verbe ou entité.* (minuscules). » ; filtre `role.zzz` : « Aucune entrée ne correspond à ces filtres. »

☐ OK ☐ KO

---

### Étape 374 — Journal d'audit : vérifier la chaîne, lecture réservée
👤 **propriétaire** (secondaire-test) · fenêtre **A** ; 👤 **directeur des études** · fenêtre **A** · 📂 `/v2/audit`

1. Propriétaire : dans le bloc **« Intégrité de la chaîne »**, portée « Toute la chaîne », cliquer **« Vérifier la chaîne »**.
2. Constater qu'aucune commande « Modifier » ni « Supprimer » n'existe sur la liste ni sur une entrée.
3. « Se déconnecter », connexion en directeur des études, taper `/v2/audit`, puis ouvrir la Console (F12) et exécuter `await fetch('/api/v1/audit/logs')`.

✅ Étape 1 : « Chaîne intègre » avec "N entrées vérifiées (séquences X à Y). Aucune anomalie." ; le bouton devient « Vérifier à nouveau ». Une « Chaîne altérée » (liste « Empreinte incohérente », « Chaînage rompu », « Trou dans la séquence ») est un défaut **Bloquant**. Étape 3 : « Accès refusé » et, en console, statut 403 avec "Action non autorisée.".

☐ OK ☐ KO

---

### Étape 375 — ⚠️ Irréversible : exporter le journal d'audit
👤 **directeur** (secondaire-test) · fenêtre **A** · 📂 `/v2/audit`, bouton **« Exporter en CSV »**

Le navigateur télécharge un fichier `audit-AAAA-MM-JJ.csv` : à faire par une personne, ou avec l'accord de la personne qui supervise.

1. Sans date, cliquer **« Exporter en CSV »**.
2. Saisir « Du » = il y a 40 jours et « Au » = aujourd'hui, **« Exporter en CSV »**.
3. Saisir « Du » = hier et « Au » = maintenant, **« Exporter en CSV »** (code MFA demandé si la session n'est plus récente).
4. Rechercher ensuite l'action `audit_log.exported` dans le filtre.

✅ Étape 1 : « L'export exige une période : renseignez les deux dates. » Étape 2 : « La période d'export est limitée à 31 jours. » Étape 3 : "Export terminé : N lignes dans audit-….csv." Étape 4 : l'export est lui-même journalisé (nouvelle entrée, non supprimable). Les comptes sans la permission d'export (directeur des études, économe…) ne voient pas le bouton actif.

📚 *Pour aller plus loin* : chapitre 24, scénarios 24.1 à 24.17 (droits des 15 rôles), 24.19 à 24.24 (isolation, API, base), 24.25 à 24.34 (dix circuits « quatre yeux »), 24.36 à 24.47 (MFA, codes de secours, jetons à usage unique, mot de passe), 24.48 à 24.54 (audit, en-têtes, fichiers protégés).

☐ OK ☐ KO

**Ce que la phase laisse dans l'application :** aucun enregistrement métier. Effets de bord : des entrées de journal non supprimables (`login.failed`, `session.revoked`, `audit_log.exported`) ; le compte `eleve@primaire-test.test` a été verrouillé 1 minute ; des sessions ouvertes dans les trois établissements (à fermer par « Se déconnecter ») ; si le réglage « Séparation des tâches » de la paie a été coché, le remettre à son état d'origine.

---

## Phase 20 — Console de la plateforme (opérateur) et abonnement

Objectif : jouer le rôle de l'opérateur d'EcoleDigitale dans la console : créer une organisation jetable `tg-jetable`, en changer le statut, l'abonnement et les dérogations, lire le catalogue des plans, retrouver tous ces actes au journal de plateforme, puis voir côté propriétaire l'abonnement du Collège.

Précondition : **l'opérateur n'est pas dans le panneau de `/v2/login`**. Son e-mail et son mot de passe sont communiqués par la personne qui lance l'environnement ; ne jamais les recopier dans un rapport. Sans ces identifiants, noter les étapes de console "non exécutées" et ne pas les chercher ailleurs. La console se joue en fenêtre **B** (privée) : se connecter à un établissement dans un navigateur efface le jeton d'opérateur de ce navigateur.

---

### Étape 376 — Connexion de l'opérateur
👤 **opérateur de la plateforme** · fenêtre **B** · 📂 Page `http://localhost:3000/v2/platform/login` (`/v2/platform/login`)

1. Ouvrir `/v2/platform/login` : titre « Console plateforme » et champs « Adresse e-mail » et « Mot de passe ».
2. Cliquer **« Se connecter »** sans rien saisir.
3. Saisir l'e-mail et le mot de passe de l'opérateur (fournis par la personne qui lance l'environnement), cliquer **« Se connecter »**.

✅ Étape 2 : « Ce champ est obligatoire. » sous chaque champ. Étape 3 : arrivée sur `/v2/platform/tenants`, titre « Organisations » ; le menu de la console ne propose que « Organisations », « Plans et catalogue » et « Journal de plateforme » ; l'en-tête indique "Connecté en tant que" suivi de l'e-mail.

⚠️ *Test d'erreur* : l'e-mail d'un compte d'établissement (`direction.generale@secondaire-test.test`) avec un mot de passe quelconque : « Identifiants d'opérateur invalides. » (même message pour un e-mail inconnu : aucun indice sur l'existence du compte).

☐ OK ☐ KO

---

### Étape 377 — Garde de la console
👤 **opérateur** (fenêtre **B**) puis **propriétaire** (secondaire-test) · fenêtre **A** · 📂 Barre d'adresse

1. Dans une fenêtre privée neuve **sans** connexion, taper `/v2/platform/tenants`, `/v2/platform/plans` et `/v2/platform/audit`.
2. Fenêtre A, connecté en propriétaire du Collège, taper `/v2/platform/tenants`.
3. Fenêtre B, connecté en opérateur seulement, taper `/v2/settings` puis `/v2/students`.

✅ Étapes 1 et 2 : retour à `/v2/platform/login`, aucune organisation affichée. Étape 3 : retour à `/login` (la console ne donne aucune session d'établissement) ; l'opérateur ne voit jamais d'élève, de note ni de facture.

☐ OK ☐ KO

---

### Étape 378 — Lire et filtrer la liste des organisations
👤 **opérateur** · fenêtre **B** · 📂 Menu **« Organisations »** (`/v2/platform/tenants`)

Attendu au départ : trois organisations « Active » : Collège Le Baobab (`secondaire-test`), École primaire Les Palmiers (`primaire-test`), Université Horizon (`superieur-test`).

1. Lire le tableau « Organisations » (colonnes « Nom », « Identifiant », « Statut », « Créée le »).
2. Saisir `Baobab` dans **« Rechercher »**, cliquer **« Filtrer »**.
3. Saisir `zzz-introuvable`, **« Filtrer »**.
4. Vider la recherche, choisir **« Suspendue »** dans « Statut », **« Filtrer »**, puis revenir à « Tous les statuts ».

✅ Étape 2 : une seule ligne. Étape 3 : « Aucune organisation ne correspond. » Étape 4 : même message tant que rien n'est suspendu.

☐ OK ☐ KO

---

### Étape 379 — Créer l'organisation jetable `tg-jetable`
👤 **opérateur** · fenêtre **B** · 📂 **« Organisations »** > **« Nouvelle organisation »** (`/v2/platform/tenants/new`)

1. Cliquer **« Nouvelle organisation »** et saisir (taper d'abord le nom : l'identifiant se remplit seul, puis le remplacer) :

| Champ | Valeur |
| :--- | :--- |
| Nom de l'organisation | `École jetable test guide` |
| Identifiant (slug) | `tg-jetable` |
| Pays (code ISO) | `CI` |
| Packs | cocher « Secondaire » |
| Nom complet (propriétaire) | `KONÉ Mariam test guide` |
| Adresse e-mail (propriétaire) | `proprietaire.tgjetable@exemple.test` |
| Téléphone | `+225 07 08 09 10 11` |
| Durée (jours) | `30` |

2. Cliquer **« Provisionner l'organisation »**.
3. Sur l'écran de réussite, cliquer **« Ouvrir l'organisation »**.

✅ Écran « Organisation créée » avec "1 établissement créé" et les boutons « Ouvrir l'organisation » et « Provisionner une autre organisation ». La fiche s'ouvre : badge « Active », sous-titre « Identifiant : tg-jetable · Créée le … », un établissement de pack « Secondaire », section « Abonnement » au statut « Période d'essai » (fin = aujourd'hui + 30 jours). La liste compte maintenant 4 organisations.

⚠️ *Écart connu* : le texte "Une invitation a été envoyée à …" est affiché alors qu'aucun courrier ne part dans cet environnement : **personne ne pourra jamais se connecter à `tg-jetable`**, c'est voulu (organisation de console seulement).

⚠️ *Test d'erreur* : refaire la saisie avec le pack décoché : « Choisissez au moins un pack. » ; avec l'identifiant `secondaire-test` : message du serveur se terminant par "est déjà utilisé." ; avec `admin` : "est réservé." Rien n'est créé.

☐ OK ☐ KO

---

### Étape 380 — Fiche d'une organisation de départ : lecture seule
👤 **opérateur** · fenêtre **B** · 📂 **« Organisations »** > ouvrir « Collège Le Baobab (démonstration) » (`/v2/platform/tenants/<identifiant>`)

1. Lire « Vue d'ensemble » (raison sociale, pays, établissement de pack « Secondaire »).
2. Lire « Abonnement » : offre "Professionnel", statut « Actif », tranche d'apprenants vide, seul le pack « Secondaire » coché.
3. Lire « Dérogations de fonctionnalités » et « Droits effectifs et usage ».
4. Ouvrir ensuite l'École et l'Université et comparer le nombre de fonctionnalités accordées. **Ne rien modifier** sur ces trois fiches.

✅ « Aucune dérogation. » ; "N fonctionnalités accordées" ; le nombre diffère selon le pack. Aucune donnée interne (élève, note, facture) n'est affichée.

⚠️ *Test d'erreur* : taper `/v2/platform/tenants/11111111-1111-4111-8111-111111111111` : « Cette organisation n'existe pas. »

☐ OK ☐ KO

---

### Étape 381 — Suspendre puis réactiver `tg-jetable`
👤 **opérateur** · fenêtre **B** · 📂 Fiche de `tg-jetable`, section **« Statut »**

1. Cliquer **« Suspendre »** : fenêtre « Suspendre l'organisation ? » avec le champ **« Motif »**.
2. Confirmer sans motif.
3. Saisir le motif `Suspension d'essai test guide` et confirmer (bouton « Suspendre »).
4. Descendre à « Droits effectifs et usage », puis revenir à la liste et filtrer sur « Suspendue ».
5. Rouvrir la fiche, cliquer **« Réactiver »** et confirmer.

✅ Étape 2 : « Indiquez un motif de 3 caractères au moins. » (la fenêtre reste ouverte). Étape 3 : « Statut mis à jour. », badge « Suspendue ». Étape 4 : seules les fonctionnalités de base restent accordées ; l'organisation figure dans le filtre « Suspendue ». Étape 5 : badge « Active ». Ne pas archiver maintenant.

☐ OK ☐ KO

---

### Étape 382 — Abonnement de `tg-jetable`
👤 **opérateur** · fenêtre **B** · 📂 Fiche de `tg-jetable`, section **« Abonnement »**

1. Passer « Statut » à « Actif », saisir `250` dans **« Tranche d'apprenants (plafond) »**, cliquer **« Enregistrer l'abonnement »**.
2. Recharger la page.
3. Choisir l'offre "Starter", enregistrer, relever le nombre de fonctionnalités dans « Droits effectifs et usage », puis remettre l'offre d'origine et enregistrer.

✅ « Abonnement enregistré. » à chaque enregistrement valide ; les valeurs sont conservées au rechargement ; le nombre de fonctionnalités change avec l'offre (valeur de Starter à relever).

⚠️ *Test d'erreur* : « Fin » antérieure à « Début » : « La fin doit suivre le début. » ; plafond `0` : « Entier positif attendu. » ; offre vide : « Choisissez une offre. »

☐ OK ☐ KO

---

### Étape 383 — Dérogation de fonctionnalité et réconciliation
👤 **opérateur** · fenêtre **B** · 📂 Fiche de `tg-jetable`, sections **« Dérogations de fonctionnalités »** et **« Réconcilier »**

1. Relever dans « Droits effectifs et usage » le nombre de fonctionnalités accordées (N).
2. Dans **« Ajouter une dérogation »**, saisir :

| Champ | Valeur |
| :--- | :--- |
| Fonctionnalité | "Vie scolaire : incidents, mesures, observations (schoollife.core)" |
| Effet | « Retirer » |
| Motif | `Essai du menu hors plan (test guide)` |

3. Cliquer **« Enregistrer la dérogation »**.
4. Cliquer l'icône corbeille de la ligne, confirmer par **« Confirmer »**.
5. Dans « Réconcilier », cliquer **« Lancer la réconciliation »**.

✅ « Dérogation enregistrée. » ; la ligne apparaît (effet « Retirer », expiration « Jamais ») et le nombre devient N − 1. « Dérogation supprimée. » : retour à N. Réconciliation : « Réconciliation terminée : 0 rôle(s) créé(s), abonnement inchangé. »

⚠️ *Test d'erreur* : aucune fonctionnalité choisie : « Choisissez une fonctionnalité. »

☐ OK ☐ KO

---

### Étape 384 — Plans et catalogue : lire, puis créer un plan inactif
👤 **opérateur** · fenêtre **B** · 📂 Menu **« Plans et catalogue »** (`/v2/platform/plans`)

Ne modifier aucun des trois plans de départ (une modification s'applique à toutes les organisations concernées).

1. Lire les blocs « Plans » (Starter, Professionnel, Entreprise), « Packs » (PRIMARY, SECONDARY, HIGHER, VIRTUAL) et « Fonctionnalités ».
2. Cliquer **« Nouveau plan »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Clé | `TG_PLAN_TEST` |
| Libellé | `Plan test guide` |
| Description | `Plan de démonstration du guide, ne pas vendre` |
| Ordre d'affichage | `900` |
| Plan actif (proposé à la vente) | décocher |

3. Cliquer **« Enregistrer »**.
4. Cliquer le crayon du plan, changer le libellé en `Plan test guide modifié`, **« Enregistrer »**.

✅ « Plan enregistré. », carte "Plan test guide" avec le badge « Inactif », puis libellé modifié. La clé est en lecture seule. Le plan ne peut pas être supprimé (aucune commande) : il reste, inactif.

⚠️ *Test d'erreur* : clé `1PLAN` : "Clé en majuscules (ex. PROFESSIONAL)."

⚠️ *Écart connu* : saisir une clé **déjà existante** (`STARTER`, `PROFESSIONAL`, `ENTERPRISE`) remplace silencieusement le plan existant (Majeur, à confirmer) : ne jamais le tenter.

☐ OK ☐ KO

---

### Étape 385 — Côté propriétaire : abonnement et usage du Collège
👤 **propriétaire** (secondaire-test) · fenêtre **A** · 📂 Menu **« Établissement »** > **« Abonnement et usage »** (`/v2/settings/subscription`)

1. Lire « Offre », « Statut de l'abonnement » (« Actif »), « Packs » (« Secondaire »), « Tranche d'apprenants » (« Illimitée »).
2. Lire « Fonctionnalités actives » (total, puis un bloc par module avec l'origine « Socle », « Offre », « Pack » ou « Dérogation ») et « Usage mesuré ».
3. Taper `/v2/academic/offerings` (l'entrée de menu n'existe qu'à l'Université).
4. Se connecter en secrétariat (`secretariat@secondaire-test.test`) et taper `/v2/settings/subscription`.

✅ Aucun bouton de modification de l'abonnement n'existe côté établissement (les changements viennent de la console). Étape 3 : l'écran s'ouvre avec l'avis « L'inscription à la carte n'est pas incluse dans l'offre de l'établissement. » et ne permet aucune action. Étape 4 : la page s'ouvre mais les données sont refusées ("Action non autorisée.").

⚠️ *Écart connu* : l'offre s'affiche par sa clé technique (`PROFESSIONAL`) et les fonctionnalités par leurs clés (Mineur).

☐ OK ☐ KO

---

### Étape 386 — Journal de plateforme
👤 **opérateur** · fenêtre **B** · 📂 Menu **« Journal de plateforme »** (`/v2/platform/audit`)

1. Lire le tableau « Entrées du journal de plateforme » (colonnes « Date », « Gravité », « Action », « Entité », « Acteur »), la plus récente en premier.
2. Retrouver les actes des étapes précédentes : `platform.tenant.provisioned` (`tg-jetable`), `platform.tenant.status_changed` (suspension puis réactivation), `platform.subscription.set`, `platform.override.set`, `platform.override.removed`, `platform.tenant.reconciled`, `platform.plan.upserted`.

✅ Chaque acte est présent, acteur « Opérateur plateforme », identifiant de l'organisation sous l'entité. Aucune entrée n'est modifiable ni supprimable (aucun bouton). « Charger plus d'entrées » charge la suite si la page est pleine.

☐ OK ☐ KO

---

### Étape 387 — ⚠️ Irréversible : archiver l'organisation jetable
👤 **opérateur** · fenêtre **B** · 📂 Fiche de `tg-jetable`, section **« Statut »**

1. Cliquer **« Archiver »**, saisir le motif `Fin des essais test guide`, confirmer.
2. Revenir à la liste : l'organisation figure avec le statut archivé.

✅ « Statut mis à jour. » ; l'organisation archivée perd l'accès aux fonctionnalités payantes. Les organisations ne se suppriment pas : `tg-jetable` et le plan `TG_PLAN_TEST` restent dans la console.

📚 *Pour aller plus loin* : chapitre 01, scénarios 1.1 à 1.11 (console), 1.16 (modules selon l'offre), 1.20 à 1.22 (organisation avec propriétaire emprunté, mise en service, suspension vue de l'établissement).

☐ OK ☐ KO

**Ce que la phase laisse dans l'application :** l'organisation "École jetable test guide" (`tg-jetable`, archivée, inutilisable car son propriétaire n'a jamais reçu d'invitation) ; le plan "Plan test guide modifié" (`TG_PLAN_TEST`, inactif, non supprimable) ; les entrées correspondantes du journal de plateforme. Les trois établissements de départ n'ont pas été modifiés.

---

## Phase 21 — Accessibilité, mobile et hors ligne

Objectif : contrôler à la main ce que les outils automatiques ne savent pas vérifier : clavier, petit écran, états vides, formats français de Côte d'Ivoire, application installable et saisie hors ligne.

Précondition : navigateur Chrome ou Edge avec les outils de développement (**F12**) ; mode appareil (**Ctrl+Maj+M**) pour les largeurs 375 px et 320 px. Les identifiants d'enfants se prennent en cliquant **« Ouvrir »** sur la carte de l'enfant (ne pas les taper à la main).

---

### Étape 388 — Lien d'évitement et focus au clavier
👤 **parent** (secondaire-test) · fenêtre **B** · 📂 `/v2/parent`

Compte : `parent@secondaire-test.test` (sans MFA). Largeur d'environ 1280 px ; ne pas toucher la souris pour les points 1 à 3.

1. Recharger la page, puis appuyer une fois sur **Tab**.
2. Appuyer sur **Entrée**.
3. Appuyer à nouveau sur **Tab**.
4. À la souris, cliquer sur « Paramètres du compte » dans le menu, puis, sans toucher la souris, lancer dans la console (F12) `document.activeElement.id`.

✅ Point 1 : un lien « Aller au contenu » apparaît en haut à gauche, bien visible. Point 2 : le focus passe dans la zone principale (`#v2-main`). Point 3 : le focus va sur le premier élément du contenu (par exemple « Ouvrir » du premier enfant). Point 4 : la console répond `"v2-main"` : à chaque nouvelle page le focus est placé sur le contenu. Chaque élément focalisé a un contour ou un anneau visible.

☐ OK ☐ KO

---

### Étape 389 — Fenêtre de dialogue au clavier : focus piégé, Échap
👤 **parent** (secondaire-test) · fenêtre **B** · 📂 Fiche de DIABATE Nadia > section **« Absences »** (`/v2/parent/children/<id>/attendance`)

1. Atteindre **« Déposer un justificatif »** avec **Tab** et l'activer avec **Entrée**.
2. Dans la fenêtre, appuyer au moins dix fois sur **Tab**, puis sur **Maj+Tab**.
3. Appuyer sur **Échap**.
4. Rouvrir la fenêtre, cliquer **« Annuler »**.

✅ À l'ouverture le focus entre dans la fenêtre ; **Tab** boucle entre les champs et les boutons sans en sortir ; le menu en arrière-plan ne reçoit pas le focus. **Échap** et « Annuler » ferment la fenêtre et rendent le focus au bouton « Déposer un justificatif ». Ne rien déposer.

☐ OK ☐ KO

---

### Étape 390 — Menu mobile à 375 px
👤 **parent** (secondaire-test) · fenêtre **B** · 📂 `/v2/parent` en mode appareil 375 × 812, page rechargée

1. Atteindre **« Ouvrir le menu »** avec **Tab** et l'activer avec **Entrée**.
2. Appuyer sur **Tab** plusieurs fois, puis sur **Échap**.
3. Rouvrir le menu, cliquer sur « Paramètres du compte ».
4. Ouvrir la fiche de DIABATE Nadia et faire défiler la rangée « Sections de l'enfant ».
5. Dans la console, lancer `(() => { const m = document.getElementById('v2-main'); return m.scrollWidth - m.clientWidth; })()`.

✅ Le menu latéral est remplacé par « Ouvrir le menu » ; le tiroir reçoit le focus à l'ouverture ; **Échap** le ferme et rend le focus au bouton ; menu fermé, ses liens ne reçoivent pas le focus. Les quatre cartes sont empilées ; la rangée d'onglets défile **dans son cadre** ; la valeur de la console est inférieure ou égale à 1 (aucun défilement horizontal de la page). Les boutons principaux font 44 px de haut.

☐ OK ☐ KO

---

### Étape 391 — Tableaux et formulaires à 320 px
👤 **parent** (secondaire-test) · fenêtre **B** · 📂 Fiche de DIABATE Salimata > **« Scolarité »** (`/v2/parent/children/<id>/finance`) ; fiche de Nadia > résultats (`/v2/parent/children/<id>/results`)

1. Mode appareil, largeur **320 px** (hauteur 640), relancer la mesure de l'étape précédente.
2. Comparer l'affichage des tableaux à 375 px, 768 px et 1280 px.
3. Régler le zoom du navigateur à 200 % (Ctrl et +) à 1280 px et parcourir la page.

✅ Valeur de la mesure inférieure ou égale à 1 ; seuls les tableaux défilent dans leur cadre ; sous 640 px certaines colonnes secondaires sont masquées (l'échéance, le montant d'une facture dépliée), mais le statut et le reste dû restent visibles. À 200 %, rien n'est coupé ni superposé.

⚠️ *Écart connu* : à 375 px la colonne « Matière » des notes publiées est masquée : une note apparaît sans sa matière (Suggestion).

☐ OK ☐ KO

---

### Étape 392 — États vides lisibles
👤 **parent** (secondaire-test) puis **secrétariat** · fenêtres **B** et **A**

1. Parent : fiche de Nadia > contacts d'urgence (`/v2/parent/children/<id>/emergency`, avant tout ajout) ; scolarité de Nadia ; évaluations à venir (`/v2/parent/children/<id>/upcoming`).
2. Secrétariat : `/v2/students`, saisir `ZZZ` dans la recherche.

✅ Chaque état vide est un message français explicite, jamais une page blanche, un tableau sans explication ni "undefined" / "null" : « Aucun contact d'urgence. » ; « Aucune échéance à payer. » ; « Aucune évaluation planifiée. » ; « Aucun élève ne correspond à votre recherche. »

☐ OK ☐ KO

---

### Étape 393 — Formats de date, de nombre et de montant (fr-CI)
👤 **parent** (secondaire-test) · fenêtre **B** · 📂 Scolarité de DIABATE Salimata et résultats de DIABATE Nadia

1. Sur la scolarité de Salimata, relever un montant, une date limite, la date d'un paiement.
2. Sur les résultats de Nadia, relever une moyenne, un rang, une note.
3. Dans F12 > "Sensors" > "Location" > "Timezone ID", choisir `Pacific/Auckland`, recharger `/v2/parent`, relire la date et les horaires, puis remettre le réglage par défaut.

✅ Montants entiers avec espace de milliers et "F CFA" ("100 000 F CFA", jamais de décimale) ; dates courtes du type "7 oct. 2026" ; heures sur 24 h ("08:00") ; décimales avec virgule ("13,20", jamais "13.20") ; rangs du type "2 sur 8". Étape 3 : les dates et horaires **ne changent pas** (le fuseau de l'établissement est `Africa/Abidjan`).

☐ OK ☐ KO

---

### Étape 394 — Application installable et page hors ligne
👤 **enseignant** (secondaire-test) · fenêtre **B** · 📂 `/manifest.webmanifest` puis `/offline`

Le service worker n'est actif qu'avec la variable d'environnement. Arrêter l'application puis la relancer (par la personne qui exploite l'environnement) avec `$env:NEXT_PUBLIC_PWA = "1"; pnpm dev:v2` (PowerShell) ; ne pas utiliser `pnpm dev:v2:seed`.

1. Ouvrir `/manifest.webmanifest` : lire nom, `display`, `start_url`, couleurs et quatre icônes.
2. Se connecter en enseignant (`enseignant@secondaire-test.test`), ouvrir `/v2/teacher` puis recharger.
3. F12 > « Application » > Service Workers, puis dans la console `for (const n of await caches.keys()) console.log(n, (await (await caches.open(n)).keys()).map(r => new URL(r.url).pathname))`.
4. Dans "Réseau", choisir "Hors connexion" et taper `/v2/teacher/classes` dans la barre d'adresse.
5. Ouvrir `/offline?from=//exemple.test` réseau actif et lire l'adresse du lien.

✅ Étape 1 : nom "EcoleDigitale", `standalone`, `start_url` `/`, couleur `#2563eb`, quatre icônes qui se chargent. Étape 3 : un service worker actif sur `/sw.js`, deux caches `ed-shell-v2` et `ed-static-v2` ; **aucune** adresse `/api/` ni page privée (`/v2/...`) dans les caches. Étape 4 : redirection vers `/offline` (« Vous êtes hors ligne »), **aucune donnée** de la page privée. Étape 5 : le lien « Réessayer la connexion » pointe vers `/` (seul un chemin interne est accepté).

⚠️ *Écart connu* : sans la variable (mode par défaut), aucun service worker n'est enregistré et la coupure réseau affiche la page d'erreur du navigateur. Les textes d'installation (« Installer l'application ») n'ont pas de composant d'affichage ; c'est le navigateur qui propose l'installation. Pour revenir au mode normal, relancer une fois avec `NEXT_PUBLIC_PWA=0`.

☐ OK ☐ KO

---

### Étape 395 — Appel hors ligne et rejeu au retour du réseau
👤 **enseignant** (secondaire-test) · fenêtre **B** · 📂 Menu **« Mes appels »** (`/v2/teacher/attendance`)

Attendu au départ : une séance du jour (jeudi 8 octobre, jour de cours) sans appel.

1. Ouvrir « Mes appels » (titre « Mes séances à faire »), cliquer **« Faire l'appel »** sur la séance du jour et attendre le chargement de la liste de la classe.
2. Dans "Réseau", choisir "Hors connexion".
3. Marquer **COULIBALY Moussa** absent (toucher sa ligne), puis cliquer **« Soumettre l'appel »**.
4. Rétablir le réseau et attendre.
5. Revenir à « Mes appels », section « Sur cet appareil » et historique.
6. Avec l'éducateur (`educateur@secondaire-test.test`, fenêtre privée), vérifier dans le suivi des appels que l'appel est « Soumis » **une seule fois**.

✅ Avant la coupure : « En ligne : tout est à jour. » Hors ligne : « Hors ligne : vous pouvez continuer, les pointages seront envoyés à la reconnexion. » Après la soumission : « Appel enregistré sur cet appareil. Il sera envoyé automatiquement dès que le réseau reviendra. » Au retour du réseau : « Synchronisation en cours… » puis "En ligne : synchronisé à …" ; l'appel passe à « Envoyé » ; aucun doublon côté éducateur.

⚠️ *Test d'erreur* : ouvrir hors ligne une séance **jamais consultée** : « Vous êtes hors ligne : la liste de la classe ne peut pas être chargée. Rouvrez cet appel dès que le réseau revient ; les pointages déjà saisis sur cet appareil sont conservés. »

📚 *Pour aller plus loin* : chapitre 22, scénarios 22.2 à 22.7 (clavier détaillé), 22.9 à 22.13 (lecteur d'écran, pages publiques), 22.14 à 22.18 (thème, espacement, impression), 22.28, 22.30 et 22.31 (emploi du temps, notes et conflit de notes hors ligne), 22.32 à 22.39 (déconnexion, chargement, erreurs, français sans code technique).

☐ OK ☐ KO

**Ce que la phase laisse dans l'application :** un appel soumis hors ligne pour la séance du jeudi 8 octobre de la classe 6e A, avec COULIBALY Moussa absent (à rouvrir ou annuler par la direction) ; dans le navigateur, un service worker, deux caches et la base locale `ed-offline` ("Clear site data" et désinscription du service worker pour revenir au mode normal).

---

## Phase 22 — École Les Palmiers (primaire) : compétences, conseil des maîtres, bilan annuel

Objectif : suivre une classe de primaire (CP1 A) et une classe de maternelle (Grande Section A) de l'appel du jour jusqu'au bilan annuel scellé, sans note chiffrée pour les compétences. Précondition : base de départ de `pnpm dev:v2:seed` ; cette phase est indépendante du collège (établissement **École Les Palmiers**, `primaire-test`) et peut se jouer seule. Les règles du pack sont des **règles de démonstration** (bandeau « Règles de démonstration » sur chaque écran) : n'en tirer aucune conclusion réglementaire. Les gestes irréversibles (signature, scellement, réémission) sont en fin de phase.

Rappel des classes de départ : **CP1 A** (8 élèves : DIABATE Nadia, DIABATE Salimata, BAMBA Aya, BAMBA Fatou, COULIBALY Moussa, COULIBALY Salimata, TOURE Yao, TOURE Jean-Marc ; titulaire TRAORE Kouadio ; semestre 1 clôturé, **aucune compétence saisie**) et **Grande Section A** (5 enfants : ADOU Aïcha, ASSI Brice, DAGO Chantal, EKRA Désiré, FOFANA Estelle ; titulaire ZOKORA Sylvie ; deux semestres clos, conseil tenu, 5 bilans dont 3 scellés).

### Étape 396 — Lire les 5 inscrits de la maternelle dans les admissions
👤 **chargé d'admissions** (primaire-test) `admissions@primaire-test.test` (pas de MFA) · fenêtre **A** · 📂 Menu **« Admissions »** (`/v2/admissions`)

1. Lire le titre « Pipeline des candidatures » et choisir la campagne `RENTREE-MATERNELLE` dans « Campagne d'admission ».
2. Regarder la colonne « Inscrit ».

✅ 13 dossiers au total, dont **5 inscrits** : ADOU Aïcha, ASSI Brice, DAGO Chantal, EKRA Désiré, FOFANA Estelle (ce sont les 5 enfants de la Grande Section A). Autres colonnes : Fabrice GUEI « Inscription en attente de paiement », Grâce HIEN « Admis », Lazare OKOU « Refusé »… *(détail à relever en test)*.

☐ OK ☐ KO

---

### Étape 397 — Avancement des classes (direction)
👤 **directeur** (primaire-test) `directeur@primaire-test.test` (**MFA** : le code du moment est proposé sur la page de connexion) · fenêtre **A** · 📂 Menu **« Pack Primaire »** (`/v2/primary/direction`)

1. Lire le titre « Avancement des classes » et le bandeau « Règles de démonstration ».
2. Barre « Accès rapides » : « Conseil des maîtres », « Bilans annuels », « Archives », « États », « Paramètres » (les cinq).
3. Lire le tableau « Avancement par classe et par période ».

✅ Quatre lignes (N = effectif du CP1 A = 8) :

| Classe | Période | État | Saisies / Validées | Bilans scellés | Période |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CP1 A | semestre 1 | « Rien de saisi » (rouge) | `0 sur 8` / `0 sur 8` | `0 sur 0` | « Verrouillée » |
| CP1 A | semestre 2 | « Rien de saisi » | `0 sur 8` / `0 sur 8` | `0 sur 0` | « Ouverte » *(à vérifier)* |
| Grande Section A | semestre 1 | « En cours » (orange) | `14 sur 15` / `14 sur 15` | `3 sur 5` | « Verrouillée » |
| Grande Section A | semestre 2 | « En cours » (orange) | `14 sur 15` / `14 sur 15` | `3 sur 5` | « Verrouillée » |

La règle d'affichage est lue au bas : « Rouge : rien n'est saisi. Vert : tout est saisi et validé, et les bilans existants sont scellés. Orange : le reste. Règle d'affichage, sans valeur réglementaire. »

⚠️ *Écart connu* : la Grande Section reste orange (« En cours ») parce qu'une compétence de FOFANA Estelle n'a jamais été évaluée.

🔒 *Test de droit* : connecté plus tard en instituteur, taper `/v2/primary/direction` → "Accès refusé".

☐ OK ☐ KO

---

### Étape 398 — Ma classe de la maternelle et appel du jour (Grande Section A)
👤 **instituteur de maternelle** (primaire-test) `instituteur.maternelle@primaire-test.test` (pas de MFA) · fenêtre **B** · 📂 Menu **« Ma classe »** (`/v2/primary/classe`)

1. Lire la phrase « Vos classes, leurs périodes et les gestes du quotidien : appel du jour, compétences, conseil. » : une seule carte **Grande Section A**, "5 élèves", pastille « Titulaire », les deux semestres « verrouillée ». **Ne pas utiliser « Marquer … prête » sur cette classe.**
2. Cliquer **« Appel du jour »** sur la carte. Deux cas selon l'âge de la base :
   - **Base créée aujourd'hui (jeudi 8 octobre 2026)** : l'appel de la graine existe (ASSI Brice absent, DAGO Chantal en retard de 10 minutes) et il est validé : lecture seule.
   - **Base plus ancienne** : un nouvel appel s'ouvre. Toucher la ligne **« Marquer EKRA Désiré absent »** (compteur « 4 présents · 1 absents »), puis cliquer **« Transmettre l'appel »**.
3. Cliquer **« Fermer l'appel »**.

✅ Nouvel appel : « Appel transmis : 1 absent. » ; en rouvrant : « L'appel du jour est déjà transmis : vous pouvez encore corriger un élève. » (« Marquer EKRA Désiré présent » puis « Enregistrer les corrections » → « Corrections enregistrées. »). Appel de la graine : aucune modification possible.

⚠️ *Test d'erreur* : sur l'appel déjà validé, tenter de corriger un élève → « L'appel de ce jour ne peut plus être modifié (validé, annulé ou délai de correction dépassé). »

📚 Variante maternelle : un seul appel par jour ; l'appel du matin est refusé ("La politique d'appel de ce cycle prévoit un seul appel par jour…") : chapitre 06, scénarios 6.10 et 6.11.

☐ OK ☐ KO

---

### Étape 399 — Ma classe du CP1 A et appels du matin et de l'après-midi
👤 **instituteur CP1 A** (primaire-test) `enseignant@primaire-test.test` (pas de MFA) · fenêtre **B** · 📂 Menu **« Ma classe »** (`/v2/primary/classe`) puis **« Mes appels »** (`/v2/teacher/attendance`)

1. Sur « Ma classe » : une seule carte **CP1 A**, code `CP1`, pastille d'effectif (8 élèves), pastille « Titulaire ». Sous « Périodes » : le semestre 1 avec « verrouillée », le semestre 2 avec « ouverte » *(à vérifier)* ; chaque période a son bouton « Marquer … prête ». Boutons de la carte : « Appel du jour », « Compétences », « Conseil ».
2. Ouvrir **« Mes appels »** : rubrique « Appel de la journée », deux lignes pour le CP1 A : « Matin » avec **« Appel du matin »** et « Après-midi » avec **« Appel de l'après-midi »**.
3. Cliquer « Appel du matin », marquer **BAMBA Fatou** « Absent », soumettre. Revenir à « Mes appels » : la ligne « Matin » porte « Appel soumis ».
4. Cliquer « Appel de l'après-midi », tout le monde présent, soumettre. Rouvrir « Appel du matin » : c'est le **même** appel (pas de doublon).

✅ Deux appels distincts par jour et par classe (type "Journalier · Matin" et "Journalier · Après-midi"), aucune notion de séance.

⚠️ *Écart connu* : si la base est antérieure à la décision Q-P17, « Mes appels » propose un seul « Appel du jour » au lieu des deux demi-journées : le noter. Le bouton « Appel du jour » de la carte « Ma classe » du CP1 A peut être refusé par la politique d'appel (deux appels par jour) *(à vérifier)*.

🔒 *Test de droit* : en instituteur, taper `/v2/primary/etats` → "Accès refusé".

☐ OK ☐ KO

---

### Étape 400 — Valider les appels du jour
👤 **directeur** (primaire-test) · fenêtre **A** · 📂 Menu **« Présences »** > **« Suivi des appels »** (`/v2/attendance/sessions`)

1. Régler le filtre « Du » sur le 1er septembre si besoin. Repérer les appels « Soumis » (CP1 A matin et après-midi, éventuellement Grande Section A).
2. Cliquer **« Valider »** sur chacun (aucune fenêtre de confirmation).

✅ « Appel validé. » ; l'état passe à « Validé ». L'instituteur ne valide jamais ses propres appels.

📚 Détail : chapitre 06, scénarios 6.5, 6.9 à 6.11.

☐ OK ☐ KO

---

### Étape 401 — Lire la grille de compétences de la maternelle (aucune note)
👤 **instituteur de maternelle** · fenêtre **B** · 📂 Menu **« Compétences »** (`/v2/primary/competences`)

1. Lire la phrase « Évaluez le niveau de maîtrise de chaque compétence, par élève et par période. Une compétence non saisie reste « non évaluée ». ». La classe Grande Section A est présélectionnée ; choisir la période du **semestre 1** (libellé "Semestre 1 (verrouillée)").
2. Bandeau : « La saisie est arrêtée pour cette classe et cette période : la grille est en lecture seule. » ; référentiel « Compétences de la maternelle (démonstration) ».
3. Vue « Fiche élève », élève **ADOU Aïcha** : boutons désactivés ; `Compétence 1.1 (démonstration)` au niveau N4 avec la pastille « Validée ».
4. Élève **FOFANA Estelle** : « 2 sur 3 compétences renseignées · élève 5 sur 5 » ; pour `Compétence 2.1 (démonstration)` aucun niveau n'est sélectionné, pastille « Non évaluée » (jamais zéro).
5. Lire « Complétude de la saisie » puis cliquer **« Tableau »**.

✅ « 14 sur 15 compétences renseignées · aucune saisie en attente · 14 validées » ; dans le tableau, la cellule de FOFANA Estelle pour `D2.1` indique « Non évaluée ». Aucun chiffre, aucune moyenne, aucun pourcentage. Les boutons « Valider la grille » et « Enregistrer » sont inactifs ou absents.

☐ OK ☐ KO

---

### Étape 402 — Saisir les compétences du CP1 A (brouillon, sans note)
👤 **instituteur CP1 A** · fenêtre **B** · 📂 Menu **« Compétences »** (`/v2/primary/competences`)

Précondition : période du semestre 2 saisissable. Si elle s'affiche "(verrouillée)" ou si l'enregistrement est refusé, demander à la direction de l'ouvrir (`/v2/academic/years`) et noter le constat.

1. Classe **CP1 A** présélectionnée, choisir la période du **semestre 2**. Référentiel « Compétences du primaire (démonstration) » ; compteur "0 sur 8 compétences renseignées".
2. Vue « Fiche élève », élève **DIABATE Nadia** : pour `Compétence 1.1 (démonstration)` cliquer **"N3 Acquis"** (pastille « À enregistrer », "1 saisie en attente").
3. Élève suivant **DIABATE Salimata** : "N2 En cours d'acquisition" ; puis **BAMBA Aya** : "N4 Acquis avec aisance". Laisser les 5 autres élèves **sans saisie**.
4. Cliquer **« Enregistrer »**.

✅ « Enregistré le … » ; pastilles « Enregistrée » ; compteur "3 sur 8 compétences renseignées". Les 5 autres restent « Non évaluée ».

⚠️ *Test d'erreur* : choisir la période du semestre 1 → « La saisie est arrêtée pour cette classe et cette période : la grille est en lecture seule. »

🔒 *Test de droit* : le secrétariat (`secretariat@primaire-test.test`, MFA) ouvre la grille en lecture seule : « Vous pouvez consulter la grille, mais pas la modifier. »

📚 Cas fins (annuler une saisie, « Tous au niveau… sauf », conflit de deux onglets, hors ligne) : chapitre 18, scénario 18.6.

☐ OK ☐ KO

---

### Étape 403 — Marquer la période "prête" (gel de la saisie)
👤 **instituteur CP1 A** · fenêtre **B** · 📂 Menu **« Ma classe »** (`/v2/primary/classe`)

1. Cliquer **« Marquer … prête »** à côté du semestre 2. Dans la fenêtre « Marquer … prête ? » ("Les parents et les élèves verront les compétences saisies et le rang provisoire de cette période. La saisie sera gelée tant que le marquage n'est pas retiré. …"), cliquer **« Marquer prête »**.
2. Retourner dans « Compétences » (semestre 2), changer le niveau d'un élève en brouillon et cliquer « Enregistrer ». Recharger ensuite la page pour abandonner cette saisie refusée.

✅ Message « … : marquée prête, les familles voient désormais les compétences et le rang provisoire. » ; badge « Prête pour les familles ». Étape 2 : refus "La classe et la période sont marquées prêtes : retirer le marquage avant de modifier la saisie." (la saisie reste affichée).

☐ OK ☐ KO

---

### Étape 404 — Ce que voit le parent d'une période "prête"
👤 **parent** (primaire-test) `parent@primaire-test.test` (pas de MFA) · fenêtre **B** · 📂 Menu **« Bulletin et compétences »** (`/v2/primary/mon-enfant`)

1. Dans « Enfant », choisir **DIABATE Nadia — CP1 A**.
2. Lire la section « Compétences des périodes prêtes ou validées ».

✅ Un compteur par domaine et par niveau ("Acquis" : 1 pour Nadia) ; aucune moyenne. Section « Bilans annuels » : « Aucun bilan annuel publié pour le moment. »

☐ OK ☐ KO

---

### Étape 405 — Retirer le marquage "prête" (avec motif)
👤 **instituteur CP1 A** · fenêtre **B** · 📂 Menu **« Ma classe »** (`/v2/primary/classe`)

1. Cliquer **« Retirer le marquage de … »** (semestre 2).
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Motif du retrait | `court` |

3. Cliquer « Retirer le marquage » : refus. Remplacer par `Erreur de marquage constatée (test guide)` et cliquer **« Retirer le marquage »**.

✅ « … : marquage retiré, les familles ne voient plus que les périodes validées ou publiées. » ; le badge disparaît ; côté parent le bloc de compétences est de nouveau vide.

⚠️ *Test d'erreur* : motif `court` → « Au moins 10 caractères. »

☐ OK ☐ KO

---

### Étape 406 — Valider la grille du CP1 A
👤 **instituteur CP1 A** · fenêtre **B** · 📂 Menu **« Compétences »** (`/v2/primary/competences`, CP1 A, semestre 2)

1. Cliquer **« Valider la grille »** (actif seulement sans saisie en attente).
2. Lire la fenêtre « Valider la grille de compétences » : « Les compétences saisies seront figées : seule une révision motivée pourra ensuite les corriger. » et "5 compétences restent non évaluées : elles le resteront." Confirmer **« Valider la grille »**.

✅ « Grille validée : 3 compétences validées, 5 restées non évaluées. » ; les trois cases passent à « Validée » ; les 5 autres élèves restent « Non évaluée ». Aucun bouton « Réviser » pour l'instituteur.

☐ OK ☐ KO

---

### Étape 407 — Réviser une compétence validée (direction)
👤 **directeur** (primaire-test) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Compétences »** (`/v2/primary/competences`, CP1 A, semestre 2)

1. Sur la case validée de **DIABATE Nadia**, cliquer **« Réviser »** (fenêtre « Réviser une compétence validée »).
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Nouveau niveau | `N4 — Acquis avec aisance` |
| Motif de la révision | `Correction après relecture du cahier de classe (test guide)` |

3. Cliquer **« Réviser »**, puis rouvrir « Réviser » pour lire l'historique.

✅ La case affiche N4 ; « Historique des révisions » : "N3 vers N4 le … : Correction après relecture du cahier de classe (test guide)". Acte sensible tracé, réservé à la direction.

⚠️ *Test d'erreur* : motif de moins de 10 caractères → "Le motif compte au moins 10 caractères."

⚠️ *Écart connu* : sur la Grande Section A (périodes closes) le bouton « Réviser » n'est pas proposé : c'est normal.

☐ OK ☐ KO

---

### Étape 408 — Banque d'appréciations : lire et rédiger
👤 **instituteur CP1 A** · fenêtre **B** · 📂 Menu **« Appréciations »** (`/v2/primary/appreciations`)

1. Lire « Banque de phrases pour rédiger vos appréciations. Une phrase propose du texte : elle n'est jamais appliquée seule. » et la liste « Phrases de la banque » : 3 phrases de démonstration. Pas de bouton « Nouvelle phrase » ni « Désactiver » (« Vous pouvez consulter la banque ; sa gestion est réservée à la direction. »).
2. Filtre « Portée » = « Année » : une seule phrase. Revenir à « Tous ».
3. Sur la phrase `PERIOD_N3`, cliquer **« Ajouter à ma rédaction »**, cocher **« J'ai relu et je valide ce texte »**, cliquer **« Copier le texte validé »**.

✅ « Texte copié : collez-le dans l'appréciation du bulletin. » ; note « Ce texte n'est enregistré nulle part ici. L'appréciation générale s'écrit dans le module Résultats (appréciations de la période). »

☐ OK ☐ KO

---

### Étape 409 — Créer une phrase de la banque (direction des études)
👤 **directeur des études** (primaire-test) `etudes@primaire-test.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Pack Primaire »** > **« Appréciations »** (`/v2/primary/appreciations`)

1. Cliquer **« Nouvelle phrase »**. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Code | `TG_PHRASE_LECTURE` |
| Portée | `Période` |
| Texte de la phrase | `Lecture fluide en progrès constant (test guide).` |
| Niveau de maîtrise | `N3` |
| Niveau de classe | `CP1` |

2. Cliquer **« Créer la phrase »**.
3. Cliquer **« Désactiver »** sur cette phrase, cocher « Afficher aussi les phrases désactivées », puis **« Activer »** et de nouveau **« Désactiver »**.

✅ « Phrase créée. » (sans pastille « Démonstration ») ; une fois désactivée : pastille « Désactivée » et « Ajouter à ma rédaction » inactif.

⚠️ *Test d'erreur* : code `tg-phrase` (tiret, minuscules) → "Code attendu : majuscules, chiffres et _ (2 à 60)."

🔒 *Test de droit* : le secrétariat tape `/v2/primary/appreciations` → "Accès refusé".

☐ OK ☐ KO

---

### Étape 410 — Lire le conseil des maîtres tenu (Grande Section A)
👤 **directeur** (primaire-test) · fenêtre **A** · 📂 Menu **« Conseil des maîtres »** (`/v2/primary/conseil`)

1. Lire « Préparation, présence, dossiers élève par élève, décisions et procès-verbal. La règle propose, le conseil confirme. ». Dans « Mes conseils », la ligne **Grande Section A** : « 5 dossiers · 0 à examiner · 5 décidés ». Cliquer **« Ouvrir »**.
2. « Feuille de présence » : ZOKORA Sylvie « Titulaire de la classe » (présente, « Signée le … »), `DIRECTEUR Conseil` (président, présent, non signé), `SECRETAIRE Conseil` (secrétaire, présente, non signée) ; quorum "Aucun quorum bloquant : 3 convoqués, 3 présents.".
3. « Dossiers, un par un » : parcourir les 5 dossiers.
4. Section « Procès-verbal » : « Un procès-verbal a déjà été demandé pour ce conseil. »

✅ ADOU Aïcha, ASSI Brice, DAGO Chantal, EKRA Désiré : « Passage en classe supérieure » ; **FOFANA Estelle : « Redoublement »**, justification "Une compétence jamais évaluée de l'année : maintien décidé par le conseil (démonstration).". Les 5 dossiers sont « Décidé ».

🔒 *Test de droit* : l'instituteur de maternelle ouvre ce même conseil en lecture : « La feuille de présence est tenue par la présidence du conseil. », ni « Confirmer la décision » ni « Demander le procès-verbal ».

☐ OK ☐ KO

---

### Étape 411 — Conseil du CP1 A : préparer et proposer (instituteur)
👤 **instituteur CP1 A** · fenêtre **B** · 📂 Menu **« Conseil des maîtres »** (`/v2/primary/conseil`) > « Préparer un conseil »

1. Choisir la classe **CP1 A** et la période 1 (close, avec résultats), laisser la date vide, cliquer **« Préparer le conseil »**.
2. Si le conseil est préparé : ouvrir-le, section « Ma proposition » sur un dossier : choisir `Redoublement`, saisir « Notes et observations » = `Lecture non acquise (test guide)`, cliquer **« Enregistrer ma proposition »**. Cliquer ensuite « Reporter ce dossier » puis « Remettre à l'examen ».

✅ « Conseil préparé : un dossier par élève a été créé. » puis « Proposition enregistrée. ». La proposition de l'instituteur ne vaut pas décision.

⚠️ *Écart connu* : la préparation peut être refusée faute d'état de résultats pour la classe et la période ; relever le message exact, marquer l'étape "bloquée" et passer à la suivante (le conseil de la Grande Section A suffit pour la suite).

☐ OK ☐ KO

---

### Étape 412 — Conseil du CP1 A : présence, décision et procès-verbal (direction)
👤 **directeur** (primaire-test) · fenêtre **A** · 📂 Menu **« Conseil des maîtres »** (`/v2/primary/conseil`) > conseil du CP1 A

Précondition : étape précédente réussie (sinon passer à *Bilans annuels*).

1. Dans « Feuille de présence » : au moins un « Président » et un « Secrétaire » « Présent », puis **« Enregistrer la feuille de présence »** (sans cocher de signature).
2. Sur un dossier, section « Décision du conseil » : « Confirmer la proposition de la règle » si elle existe, sinon « Retenir un autre code » avec « Décision retenue » = `Passage en classe supérieure` et « Justification » = `Décision de test guide prise en séance pour un cas limite`. Cliquer **« Confirmer la décision »**.
3. Saisir « Date réelle de la séance » = `2026-10-08` et cliquer **« Demander le procès-verbal »**.

✅ « Feuille de présence enregistrée. » ; « Décision enregistrée : Passage en classe supérieure. » (avec « Elle diffère de la proposition de la règle ; la justification est conservée. » en cas d'écart) ; « Procès-verbal demandé : il sera disponible dans les documents officiels. » (si au moins une décision existe).

⚠️ *Test d'erreur* : justification de 5 caractères pour un écart → « La justification compte au moins 20 caractères. »

⚠️ *Écart connu* : sans résultats calculés, la décision est refusée : `La règle n'a produit aucune proposition pour cet élève : les résultats de la période ne sont pas calculés.` (à relever).

☐ OK ☐ KO

---

### Étape 413 — Bilans annuels : lire et préparer les brouillons
👤 **directeur des études** (primaire-test) · fenêtre **A** · 📂 Menu **« Bilans annuels »** (`/v2/primary/bilans`)

1. Lire « Préparez, scellez et réémettez les bilans annuels d'une classe. Un bilan scellé est immuable. ». Choisir « Année » = 2026-2027 et « Classe » = Grande Section A.
2. Lire le tableau « Bilans annuels de la classe » (colonnes « Élève », « Version », « Statut », « Décision », « Empreinte », « Règles »).
3. Cliquer **« Préparer les brouillons »**.
4. Choisir la classe CP1 A, cliquer de nouveau « Préparer les brouillons ».

✅ 5 lignes « Version 1 » : **3 « Scellé »** (avec « Scellé le … » et une empreinte tronquée à 12 caractères) et **2 « Prêt à sceller »** (bouton « Sceller » visible à droite de ces deux seules lignes) ; décision « Passage en classe supérieure » sauf FOFANA Estelle « Redoublement » ; colonne « Règles » : « Règles de démonstration ». Étape 3 : message du type « Brouillons préparés : 0 créés, 2 actualisés, 3 scellés laissés intacts. » (valeurs à relever ; **noter lesquels sont « Prêt à sceller »**). Étape 4 : « Aucun bilan pour cette classe et cette année. » puis refus de préparation (pas de résultat d'année final ni de conseil) : relever le message.

🔒 *Test de droit* : ce compte prépare mais n'a ni « Sceller » ni « Réémettre » (réservés au directeur de l'école).

☐ OK ☐ KO

---

### Étape 414 — États du primaire
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« États du primaire »** (`/v2/primary/etats`)

1. Lire le bandeau « Règles de démonstration » et la liste « Rapport » (sept rapports).
2. Choisir **« Liste de classe »**, « Classe » = Grande Section A, cliquer **« Afficher l'aperçu »**.
3. Choisir **« Couverture des compétences »**, « Classe » = Grande Section A, « Période » = semestre 1, **« Afficher l'aperçu »**.
4. Choisir **« Dossier du conseil des maîtres »**, « Conseil » = celui de la Grande Section A, **« Afficher l'aperçu »**.
5. Cliquer **« Exporter en CSV »** (le fichier est téléchargé ; séparateur point-virgule).

✅ Liste de classe : colonnes `N°`, `Élève`, `Redoublant`, 5 lignes, titre "Liste de classe — Grande Section A". Couverture : FOFANA Estelle `3, 2, 2, 1` (attendues, saisies, validées, non évaluées), les quatre autres `3, 3, 3, 0`. Dossier du conseil : 5 lignes toutes décidées. L'export reproduit l'aperçu.

⚠️ *Test d'erreur* : « Liste de classe » sans classe → « Renseignez les paramètres obligatoires pour produire ce rapport. » (boutons inactifs).

🔒 *Test de droit* : en tant que directeur des études, taper `/v2/primary/parametres` → "Accès refusé" (seule page refusée).

☐ OK ☐ KO

---

### Étape 415 — Archive d'année (préparation, jamais de gel)
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« Archives d'année »** (`/v2/primary/archives`)

1. Choisir l'année 2026-2027 (« Choisir une année »). Cliquer **« Préparer l'archive »**.
2. Lire la carte « Archive : En préparation » et la liste « Ce qui empêche le gel : ».

✅ « Archive préparée. » ; "3 bilans scellés sur 5" ; empêchements attendus : `L'année académique n'est pas clôturée.`, `2 bilan(s) non scellé(s).`, `8 inscription(s) sans bilan annuel.` *(chiffres à relever)*. Aucun bouton « Geler l'archive ».

⚠️ *Écart connu* : l'archive ne peut pas devenir « Prête à geler » dans la démonstration (année non close, élèves du CP1 A sans bilan). **Ne pas chercher à geler** : le gel est irréversible pour toute l'école.

☐ OK ☐ KO

---

### Étape 416 — Espace famille : le parent et l'élève
👤 **parent** puis **élève** (`eleve@primaire-test.test`, pas de MFA) · fenêtre **B** · 📂 Menu **« Bulletin et compétences »** (`/v2/primary/mon-enfant`)

1. Parent : la liste « Enfant » propose **DIABATE Nadia — CP1 A** et **DIABATE Salimata — CP1 A** (aucun enfant de la Grande Section). Choisir Nadia : section « Compétences des périodes prêtes ou validées » avec le compteur du semestre 2 ("Acquis avec aisance" : 1 après la révision) ; « Bilans annuels » : « Aucun bilan annuel publié pour le moment. ».
2. Choisir Salimata : compteurs propres ("En cours d'acquisition" : 1), aucune donnée de Nadia.
3. Élève : titre « Mon bilan et mes compétences », mêmes sections pour Nadia seulement, sans liste d'enfants.

✅ Le parent ne voit que ses enfants ; compteurs seulement, jamais de moyenne ni de saisie brouillon.

🔒 *Test de droit* : parent puis élève tapent `/v2/primary/classe`, `/v2/primary/bilans` → "Accès refusé".

☐ OK ☐ KO

---

### Étape 417 — ⚠️ Irréversible : signer la feuille de présence du conseil
👤 **directeur** (primaire-test) · fenêtre **A** · 📂 Menu **« Conseil des maîtres »** (`/v2/primary/conseil`) > conseil de la Grande Section A

⚠️ Irréversible : une présence signée est figée.

1. Sur `SECRETAIRE Conseil`, régler « Présence de SECRETAIRE Conseil » sur « Absent » : la case « Signature de SECRETAIRE Conseil » devient inactive. Remettre « Présent ».
2. Cocher la signature, cliquer **« Enregistrer la feuille de présence »**.
3. Essayer de modifier cette ligne.

✅ « Feuille de présence enregistrée. » ; « Signée le … » ; la ligne est verrouillée (« Une présence signée est figée : elle ne peut plus être modifiée. »). La ligne de ZOKORA Sylvie (déjà signée) n'a jamais été modifiable.

⚠️ *Test d'erreur* : signature cochée alors que la personne est « Absent » → « Une signature exige que la personne soit marquée présente. »

☐ OK ☐ KO

---

### Étape 418 — ⚠️ Irréversible : sceller un bilan annuel
👤 **directeur** (primaire-test) · fenêtre **A** · 📂 Menu **« Bilans annuels »** (`/v2/primary/bilans`, Grande Section A)

⚠️ Irréversible : un bilan scellé devient immuable (contenu, décision, empreinte). **Une seule fois**, sur un seul bilan.

1. Sur un bilan « Prêt à sceller » (noté à l'étape *Bilans annuels : lire et préparer les brouillons*), cliquer **« Sceller »**.
2. Lire la fenêtre « Sceller ce bilan » et confirmer **« Sceller le bilan »**.
3. Retourner dans « Archives d'année » et cliquer « Préparer l'archive ».

✅ « Bilan de … scellé. » ; statut « Scellé », empreinte et « Scellé le … » visibles, le bouton « Sceller » disparaît (PDF produit en arrière-plan). L'archive affiche "4 bilans scellés sur 5" ; les deux autres empêchements demeurent.

⚠️ *Test d'erreur* : sceller sans décision du conseil confirmée → « La décision du conseil des maîtres doit être confirmée avant de sceller. » (non atteignable sur la Grande Section : toutes les décisions sont prises).

🔒 *Test de droit* : le directeur des études n'a pas « Sceller » (étape déjà constatée) ; l'instituteur ouvre `/v2/primary/bilans` en lecture seule, sans bouton.

☐ OK ☐ KO

---

### Étape 419 — ⚠️ Irréversible : réémettre un bilan scellé
👤 **directeur** (primaire-test) · fenêtre **A** · 📂 Menu **« Bilans annuels »** (`/v2/primary/bilans`, Grande Section A)

1. Sur un bilan « Scellé » (de préférence celui scellé à l'étape précédente), cliquer **« Réémettre »**.
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Motif de la réémission | `Correction de la décision de passage (test guide)` |

3. Cliquer **« Réémettre »**.

✅ « Nouvelle version du bilan de … créée : elle doit être scellée à son tour. » ; la version 2 est en brouillon, la version 1 « Remplacé par une version plus récente ». Resceller la version 2 si on veut rétablir la visibilité familiale (nouvelle empreinte).

⚠️ *Test d'erreur* : motif de moins de 10 caractères → « Le motif doit comporter au moins 10 caractères. »

☐ OK ☐ KO

---

📚 *Pour aller plus loin* : chapitre 18, scénarios 18.5 à 18.8 (cas fins de la grille, conflit, hors ligne), 18.9 (filtres de la banque), 18.11 (rôles et doublons de la feuille de présence), 18.17 (Paramètres : réglages, modèle de pack, échelles, référentiels), 18.19 (vérification publique d'un bilan scellé sur `/v2/verify`), 18.20 à 18.22 (droits, autres établissements, qualité). Appels : chapitre 06, scénarios 6.9 à 6.11. Admissions de la maternelle : chapitre 17, scénario 17.28.

**Ce que la phase laisse dans l'application :**
- Appels du jour : CP1 A (matin avec BAMBA Fatou absente, après-midi) et Grande Section A (éventuellement EKRA Désiré absent), validés par le directeur.
- CP1 A, semestre 2 : compétences de DIABATE Nadia (N4 après révision `Correction après relecture du cahier de classe (test guide)`), DIABATE Salimata (N2), BAMBA Aya (N4), **grille validée** ; 5 élèves « Non évaluée ». Marquage "prête" posé puis retiré (`Erreur de marquage constatée (test guide)`).
- Phrase `TG_PHRASE_LECTURE` (`Lecture fluide en progrès constant (test guide).`), désactivée.
- Conseil du CP1 A (si préparé) : proposition `Lecture non acquise (test guide)`, décision et justification de test, procès-verbal éventuel.
- Grande Section A : `SECRETAIRE Conseil` présente et **signée** ; **4 bilans scellés sur 5** (dont un réémis en version 2 en brouillon) ; archive d'année « En préparation » (non gelée).

---

## Phase 23 — Université Horizon (supérieur) : UE/ECUE, relevé, rattrapage, diplôme

Objectif : lire la structure UE/ECUE et la règle "un semestre n'est validé que si toutes les UE le sont", gérer prérequis, dispense et rattrapage (la note de session 2 **remplace** celle de session 1), puis créer, octroyer, émettre, publier, vérifier et révoquer un diplôme. Précondition : base de départ de `pnpm dev:v2:seed` ; établissement **Université Horizon** (`superieur-test`), classe **Licence 1 A** (8 étudiants notés : DIABATE Nadia et Salimata, BAMBA Aya et Fatou, COULIBALY Moussa et Salimata, TOURE Yao et Jean-Marc), programme Informatique, semestre 1 clôturé avec le jeu `CI-HIGHER-LMD`. Aucun diplôme, document, dispense ni fenêtre de rattrapage n'existe au départ. Les notes se saisissent ici une seule fois (examen de session 2) ; le détail de la saisie est au chapitre 08.

### Étape 420 — Lire la structure UE / ECUE du curriculum
👤 **directeur des études** (superieur-test) `etudes@superieur-test.test` (**MFA** : le code du moment est proposé sur la page de connexion) · fenêtre **A** · 📂 Menu **« Académique »** > **« Curriculum »** (`/v2/academic/curriculum`)

1. Choisir le programme Informatique et l'année en cours ; lire la version publiée.
2. Déplier "Licence 1 A" > "Semestre 1" > "UE 1" et "UE 2".

✅ 2 UE de 6 crédits (total **12**) : `UE1` = ECUE `E11` Algorithmique (3 crédits, coef. 2) + `E12` Programmation (3 ; 1,5) ; `UE2` = `E21` Mathématiques (4 ; 2) + `E22` Statistiques (2 ; 1). Le rattrapage est autorisé sur chaque ECUE.

☐ OK ☐ KO

---

### Étape 421 — Semestre validé seulement si TOUTES les UE le sont
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« Résultats »** > **« Résultats de classe »** (`/v2/results/matrix`)

Règle (décision métier du 2026-10-01) : pas de compensation entre UE ; une UE est validée si sa moyenne atteint 10 sans ECUE inférieure à 5.

1. Choisir "Licence 1 A" et "Semestre 1" ; lire l'en-tête (règle `CI-HIGHER-LMD`, version 1).
2. Cocher « Afficher le détail par cours ».
3. Pour TOURE Jean-Marc, cliquer **« Pourquoi ? »** et déplier les lignes d'UE et d'ECUE.

✅ Valeurs calculées d'après la graine *(écart d'arrondi possible, à vérifier)* :

| Étudiant | Moyenne UE 1 / UE 2 | Moyenne semestre | Rang | Décision | Crédits |
| :--- | :--- | :--- | :-: | :--- | :--- |
| DIABATE Nadia | 13,5 / 14,1 | 13,8 | 1 | Admis | 12 / 12 |
| TOURE Yao | 13 / 12,9 | 12,95 | 2 | Admis | 12 / 12 |
| COULIBALY Moussa | 13 / 12,43 | 12,72 | 3 | Admis | 12 / 12 |
| BAMBA Fatou | 13,8 / 10,8 | 12,3 | 4 (ex æquo) | Admis | 12 / 12 |
| COULIBALY Salimata | 11,6 / 13 | 12,3 | 4 (ex æquo) | Admis | 12 / 12 |
| BAMBA Aya | 11,3 / 12,83 | 12,07 | 6 | Admis | 12 / 12 |
| DIABATE Salimata | 12,1 / 10,33 | 11,22 | 7 | Admis | 12 / 12 |
| **TOURE Jean-Marc** | **9,4** / 11,73 | 10,57 | 8 | **Rattrapage** | **6 / 12** |

**TOURE Jean-Marc a plus de 10 de moyenne de semestre mais le semestre est « Non validé »** : sa bonne UE 2 ne compense pas l'UE 1 à 9,4. DIABATE Salimata a une ECUE à 8 (Mathématiques) mais son UE 2 est validée à 10,33.

☐ OK ☐ KO

---

### Étape 422 — Relevé de notes à crédits
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« Bulletins »** (`/v2/reportcards`)

1. Choisir "Licence 1 A" et "Semestre 1" ; ouvrir la fiche de DIABATE Nadia puis celle de TOURE Jean-Marc.

✅ Lignes « Publié », « PDF prêt » ; la ligne « Crédits » affiche `12 / 12` (Nadia) et `6 / 12` (Jean-Marc), identiques à la matrice ; règle appliquée `CI-HIGHER-LMD · v1`, modèle `higher-bulletin-credits · v1`. Pas de filigrane de démonstration attendu *(à vérifier)*.

📚 Détail : chapitre 10, scénario 10.13.

☐ OK ☐ KO

---

### Étape 423 — Crédits et dettes d'UE (avant rattrapage)
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« Enseignement supérieur »** > **« Crédits et dettes »** (`/v2/higher/credits`)

1. Dans « Étudiant » (« Rechercher un étudiant… »), choisir **DIABATE Nadia**.
2. Lire la « Synthèse » et le « Registre des crédits ».
3. Choisir **TOURE Jean-Marc**, puis **SORO Elie** (étudiant sans note).
4. Section « Durée de validité des crédits » : saisir `60` dans « Validité des crédits (mois) », cliquer **« Enregistrer »**, puis vider le champ et « Enregistrer » à nouveau.

✅ Nadia : 12 crédits acquis, 2 UE acquises, « Aucune dette d'UE. » ; chaque UE est désignée par un identifiant court "UE xxxxxxxx". Jean-Marc : 6 crédits et **une dette d'UE « Ouverte »**. SORO Elie : « Aucun crédit enregistré. ». Réglage : « Le réglage est enregistré. » (deux fois).

⚠️ *Test d'erreur* : `abc`, `0` ou `12,5` dans « Validité des crédits (mois) » → « Saisissez un nombre de mois entier (1 à 1200), ou laissez vide. »

⚠️ *Écart connu* : UE et cours sont affichés par identifiant court, pas par code (défaut d'affichage, mineur).

🔒 *Test de droit* : le secrétariat (`secretariat@superieur-test.test`, MFA) tape `/v2/higher/credits` → "Accès refusé".

☐ OK ☐ KO

---

### Étape 424 — Prérequis entre UE
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« Enseignement supérieur »** > **« Prérequis »** (`/v2/higher/prerequisites`)

1. Titre « Prérequis entre UE ». « Programme » = Informatique, « Année » = année en cours ; dans « UE du programme » choisir la ligne `UE2` ("UE 2").
2. Lire « Cette UE n'a aucun prérequis. » puis cliquer **« Ajouter un prérequis »**. Saisir :

| Champ | Valeur |
| :--- | :--- |
| UE prérequise | `UE1 — UE 1` |
| Condition | `UE validée — l'étudiant a acquis l'UE` |

3. Cliquer **« Enregistrer les prérequis »**.
4. Section « Un étudiant satisfait-il les prérequis ? » : choisir DIABATE Nadia, puis TOURE Jean-Marc.
5. Cliquer « Retirer ce prérequis » puis « Enregistrer les prérequis ».

✅ « Les prérequis de UE 2 sont enregistrés. » ; Nadia : « Prérequis satisfaits » ; Jean-Marc : « Prérequis non satisfaits » avec « Prérequis manquants » (« UE non acquise »). Étape 5 : retour à « Cette UE n'a aucun prérequis. »

⚠️ *Écart connu (probable, majeur)* : l'écran envoie l'identifiant du nœud de l'UE alors que l'API attend sa lignée ; l'enregistrement peut être refusé avec un message du type "UE introuvable (…)". Si c'est le cas : consigner le texte exact, marquer l'étape "bloquée par l'écart" et passer à la suivante.

⚠️ *Test d'erreur* : condition « Moyenne minimale » = `25` → "La valeur doit être inférieure ou égale à 20."

☐ OK ☐ KO

---

### Étape 425 — Accorder une dispense d'UE (direction)
👤 **directeur** (superieur-test) `directeur@superieur-test.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Enseignement supérieur »** > **« Dispenses d'UE »** (`/v2/higher/exemptions`)

1. Lire « Effet d'une dispense sur les crédits » : politique « Enregistrer seulement » (la dispense est tracée mais ne change ni crédits ni validation). Cliquer **« Accorder une dispense »**.
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Étudiant | `COULIBALY Moussa` |
| Inscription | la seule inscription active proposée |
| UE dispensée | `UE2 — UE 2` |
| Semestre de rattachement | `Semestre 1` |
| Motif de la dispense | `Dispense accordée pour test guide (équivalence)` |

3. Cliquer **« Accorder la dispense »**.

✅ « La dispense est accordée. » ; ligne avec "Aucun effet sur les crédits", badge « Accordée » ; le registre de crédits de COULIBALY Moussa n'a **pas** de ligne « Dispense ».

⚠️ *Test d'erreur* : motif `court` → "Au moins 10 caractères." ; même étudiant et même UE une seconde fois → "Cet étudiant est déjà dispensé de cette UE."

🔒 *Test de droit* : le directeur des études voit la liste mais **aucun** bouton « Accorder une dispense » ; le secrétariat est en lecture seule.

☐ OK ☐ KO

---

### Étape 426 — Révoquer la dispense
👤 **directeur** (superieur-test) · fenêtre **A** · 📂 Menu **« Enseignement supérieur »** > **« Dispenses d'UE »** (`/v2/higher/exemptions`)

1. Sur la ligne de la dispense, cliquer **« Révoquer »** (fenêtre « Révoquer la dispense »).
2. Saisir `abc` dans « Motif » : refus. Remplacer par `Révocation de la dispense test guide` et valider.

✅ « La dispense est révoquée. » ; badge « Révoquée ».

⚠️ *Test d'erreur* : `abc` → « Le motif doit comporter au moins 10 caractères. »

📚 Variante « Inscrire les crédits de l'UE » : chapitre 11, scénario 11.5, étape 4.

☐ OK ☐ KO

---

### Étape 427 — Rattrapage : lire les candidats et ouvrir la fenêtre
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« Enseignement supérieur »** > **« Rattrapages »** (`/v2/higher/resit`)

Règle (2026-10-01) : la note de session 2 **remplace toujours** celle de session 1, même si elle est plus faible. Ouvrir une fenêtre rouvre la période pour la seule session 2.

1. Lire « Rattrapages (session 2) » ; choisir « Classe » = Licence 1 A et « Période » = Semestre 1.
2. Lire « Candidats au rattrapage » (« Étudiant », « Cours à repasser », « Moyenne session 1 »).
3. Cliquer **« Ouvrir une fenêtre »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Ouverture | `2026-10-08` |
| Fermeture | `2026-10-22` |

4. Cliquer **« Ouvrir la fenêtre »** puis le bouton **« Inscrits »**.

✅ Candidats attendus (calcul à la main, *à vérifier*) : COULIBALY Moussa (Algorithmique 9,5), COULIBALY Salimata (Programmation 9 et Statistiques 9), DIABATE Salimata (Mathématiques 8), TOURE Jean-Marc (Programmation 6,8), soit 5 lignes. « Fenêtre ouverte : 5 inscriptions créées, 0 déjà inscrits. » ; la fenêtre apparaît "Du … au …" avec le badge « Ouverte ».

⚠️ *Test d'erreur* : « Fermeture » = `2026-10-05` (avant l'ouverture) → "La fin de la fenêtre précède son début." ; ouvrir une seconde fenêtre sur la même classe et période → "Une fenêtre de rattrapage est déjà ouverte pour cette classe et cette période."

🔒 *Test de droit* : l'enseignant (`enseignant@superieur-test.test`) et le secrétariat tapent `/v2/higher/resit` → "Accès refusé".

☐ OK ☐ KO

---

### Étape 428 — Saisir les notes de session 2 (enseignant)
👤 **enseignant** (superieur-test) `enseignant@superieur-test.test` (pas de MFA) · fenêtre **B** · 📂 Menu **« Mes évaluations »** > **« Nouvelle évaluation »** (`/v2/teacher/assessments/new`)

1. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Type d'évaluation | `Examen` |
| Session | `Session 2 (rattrapage)` |
| Intitulé | `Examen Programmation session 2 test guide` |
| Date de l'évaluation | `2026-10-08` |
| Classe | `Licence 1 A` |
| Cours | `Programmation` |
| Période | `Semestre 1` |

2. Cliquer **« Créer l'évaluation »**, puis **« Saisir les notes »** (badge « Session 2 »).
3. Saisir `14` pour TOURE Jean-Marc et `4` pour COULIBALY Salimata ; laisser les autres vides.
4. Cliquer **« Enregistrer »**, puis **« Soumettre la feuille »**.

✅ « La feuille de notes est soumise. » ; état « Soumise » ; les cellules vides passent à « Non évalué ».

⚠️ *Test d'erreur* : sans fenêtre de rattrapage ouverte, la création est refusée → "La période de cette classe est verrouillée pour cette session."

📚 Chapitre 08, scénario 8.17 (création d'un examen de session 2).

☐ OK ☐ KO

---

### Étape 429 — Relire et approuver la feuille de session 2
👤 **responsable pédagogique** (superieur-test) `pedagogie@superieur-test.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Évaluations »** > feuilles à relire (`/v2/assessments`, filtre « Soumise »)

1. Ouvrir "Examen Programmation session 2 test guide" ; cliquer **« Marquer comme relue »**.
2. Cliquer **« Approuver »**, lire « Approuver cette feuille de notes ? » et confirmer **« Approuver la feuille »**.

✅ « La feuille de notes est relue. » puis « La feuille de notes est approuvée. » ; état « Approuvée » ; ce compte n'a **pas** de bouton « Publier les notes ».

☐ OK ☐ KO

---

### Étape 430 — Publier, clôturer la fenêtre et reclôturer le semestre
👤 **directeur des études** · fenêtre **A** · 📂 Fiche de l'évaluation puis **« Rattrapages »** (`/v2/higher/resit`) puis **« Résultats »** (`/v2/results`)

⚠️ Séquence exacte de clôture *(à vérifier en test)*. Cette étape produit une **version 2** des résultats du semestre 1.

1. Fiche de l'examen : cliquer **« Publier les notes »**, confirmer dans « Publier les notes ? » ("Les notes publiées deviennent immuables…").
2. Dans « Rattrapages », cliquer **« Clôturer la fenêtre »**, cocher « Confirmer la clôture » puis **« Clôturer la fenêtre »**.
3. Dans `/v2/results` (Licence 1 A, Semestre 1) : **« Verrouiller les notes »** puis **« Clôturer la période »** si ces actions sont proposées.
4. Relire la matrice (`/v2/results/matrix`) et **« Pourquoi ? »** de TOURE Jean-Marc, ECUE Programmation.

✅ « Les notes sont publiées. » ; « La fenêtre de rattrapage est clôturée. » (badge « Clôturée ») ; « Période clôturée : N résultats figés (version 2)… ». Attendu : **TOURE Jean-Marc** Programmation = 8×0,4 + 14×0,6 = **11,6** (au lieu de 6,8), UE 1 = 11,8 validée, semestre **Admis**, 12 / 12 crédits. **COULIBALY Salimata** : Programmation passe de 9 à **6,0** (la session 2, plus faible, **remplace** quand même la session 1) ; UE 1 = 10,1 reste validée. La trace de l'ECUE montre `note_examen_retenue` avec la session 2.

☐ OK ☐ KO

---

### Étape 431 — Contrôler les crédits après rattrapage
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« Enseignement supérieur »** > **« Crédits et dettes »** (`/v2/higher/credits`)

1. Choisir **TOURE Jean-Marc**.

✅ 12 crédits acquis ; l'UE 1 porte « Rattrapage » dans la colonne « Acquisition » ; la dette d'UE n'est plus « Ouverte ». **À partir de là, tous les étudiants notés sont éligibles au diplôme** (voir étape *Octroyer le diplôme à deux étudiants*).

☐ OK ☐ KO

---

### Étape 432 — Affecter les signataires datés des documents officiels
👤 **directeur** (superieur-test) · fenêtre **A** · 📂 Menu **« Enseignement supérieur »** > **« Signataires datés »** (`/v2/higher/signatories`)

1. Lire les quatre sections : « Diplôme — signature de gauche », « Diplôme — signature de droite », « Attestation de réussite », « Attestation d'authenticité » (« Aucun signataire affecté. »).
2. Pour chacune, cliquer **« Affecter un signataire »** et saisir :

| Champ | Valeur |
| :--- | :--- |
| Signataire | `Directeur Fictif — Chef d'établissement` |
| Valide à partir du | `2026-09-01` |
| Valide jusqu'au | *(vide)* |

3. Cliquer **« Affecter »** (quatre fois).

✅ « Le signataire est affecté. » ; ligne "Du 1 septembre 2026 au sans fin" avec le badge « En vigueur » sur les quatre emplacements. Sans ces affectations, toute émission est refusée ("Aucun signataire n'est en vigueur pour l'emplacement …").

⚠️ *Test d'erreur* : « Valide jusqu'au » = `2026-08-01` avec début `2026-09-01` → "La fin de validité précède son début."

🔒 *Test de droit* : le directeur des études tape `/v2/higher/signatories` → "Accès refusé" (réservé à la direction).

☐ OK ☐ KO

---

### Étape 433 — Créer le diplôme TG-LIC-INFO
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« Enseignement supérieur »** > **« Diplômes »** (`/v2/higher/diplomas`)

1. Lire « Aucun diplôme. » puis cliquer **« Nouveau diplôme »**. Dans l'encadré « Cycle du curriculum » : « Programme » = Informatique, « Année académique » = année en cours, « Nœud du curriculum » = "L1 — Licence 1 A".
2. Saisir :

| Champ | Valeur |
| :--- | :--- |
| Code du grade | `LICENCE` |
| Code du diplôme | `TG-LIC-INFO` |
| Intitulé | `Licence Informatique test guide` |
| UV requises | `12` |
| Description | `Diplôme de test guide` |
| Octroi automatique | décochée |

3. Cliquer **« Créer le diplôme »**, puis ouvrir le diplôme (clic sur son intitulé).

✅ « Le diplôme Licence Informatique test guide est créé. » ; ligne `TG-LIC-INFO`, LICENCE, 12, « Manuel », badge « Actif ». Fiche : "TG-LIC-INFO · LICENCE · 12 UV requises (12 listées)", « Exigences » = UE 1 et UE 2 (« Obligatoire », "6 crédits"), « 0 octrois, dont 0 en vigueur. »

⚠️ *Écart connu (probable, **bloquant**)* : le sélecteur « Nœud du curriculum » envoie un identifiant de nœud alors que l'API attend celui du programme ; la création peut être refusée avec "Nœud du curriculum introuvable (…)". Dans ce cas : consigner le message exact, cocher "Bloqué" et **sauter les étapes dépendantes** (octroi, émission, publication, vérification, « Mes documents », révocation) ; ne pas contourner par une requête directe.

⚠️ *Test d'erreur* : « Code du grade » vide → "Code de grade attendu : majuscules, chiffres et _ (2 à 32)." ; recréer le code `TG-LIC-INFO` → "Le code "TG-LIC-INFO" est déjà utilisé."

📚 Modifier, synchroniser, supprimer un diplôme : chapitre 11, scénario 11.8.

☐ OK ☐ KO

---

### Étape 434 — Octroyer le diplôme à deux étudiants
👤 **directeur des études** · fenêtre **A** · 📂 Fiche du diplôme `TG-LIC-INFO` > rubrique « Candidats »

1. Cliquer **« Réévaluer les candidats »**.
2. Lire le tableau « Candidats au diplôme » ; pour DIABATE Nadia, cliquer **« Progression »**.
3. Sur la ligne **DIABATE Nadia** (étudiant A), cliquer **« Octroyer »** puis, dans la fenêtre, **« Octroyer »**.
4. Sur la ligne **TOURE Jean-Marc** (étudiant B), faire de même.
5. Ouvrir la rubrique « Octrois ».

✅ « Recalcul terminé : 8 évalués, 0 octroyés, 0 en échec. » *(nombre à relever)* ; Nadia "12 UV validées sur 12 (100 %)", « Éligible », "Règle CI-HIGHER-LMD, version 1". Message « Diplôme octroyé à DIABATE Nadia (DIP-AAAA-NNNNNN). » (puis "Diplôme octroyé à TOURE Jean-Marc (DIP-AAAA-NNNNNN).") ; badges « Obtenu » et « Octroi manuel », « Crédits » = 12, « Règle appliquée » = `CI-HIGHER-LMD · v1` ; « 2 octrois, dont 2 en vigueur. » Le bouton « Octroyer » disparaît pour ces deux étudiants. La mention reste `PENDING` tant qu'un semestre du cycle manque.

⚠️ *Écart au chapitre 11* : le rattrapage rend TOURE Jean-Marc éligible ; **l'octroi forcé n'est donc plus testable sur lui**. Si le rattrapage n'a pas abouti (Jean-Marc « Non éligible »), le **directeur** (MFA) utilise **« Octroi forcé »** : motif `court` → « Le motif doit faire au moins 20 caractères. », puis `Octroi forcé pour test guide (décision de la direction)` → badge « Octroi forcé ».

🔒 *Test de droit* : sur un candidat « Non éligible », le directeur des études n'a pas « Octroi forcé ».

☐ OK ☐ KO

---

### Étape 435 — Émettre le diplôme, l'attestation d'authenticité et le duplicata
👤 **directeur des études** · fenêtre **A** · 📂 Fiche du diplôme `TG-LIC-INFO` > rubrique « Octrois »

1. Sur la carte de l'octroi de **DIABATE Nadia**, cliquer **« Émettre le diplôme »** ; cliquer de nouveau (idempotent).
2. Cliquer **« Documents émis »** (dépliage), attendre « PDF prêt », puis **« Télécharger le PDF »**.
3. Cliquer **« Attestation d'authenticité »**.
4. Cliquer **« Duplicata »**.
5. Sur la carte de l'octroi de **TOURE Jean-Marc**, cliquer **« Émettre le diplôme »** (document qui sera révoqué à la fin).

✅ « Document émis : DIP-AAAA-NNNNNN. » ; second clic : "Le document existe déjà : …". PDF : nom, référence, deux signatures datées, QR code, **code de vérification (le noter)**. « Document émis : AUTH/AAAA/NNN. » ; duplicata « Document émis : DIP-AAAA-NNNNNN/D1. » (version 2) et l'original passe « Remplacé ».

⚠️ *Écart connu* : le refus faute de signataire cite le nom technique de l'emplacement (`DIPLOMA_LEFT`) ; pendant la préparation le texte « Le PDF est en préparation (scellement puis mise en page). Cette page se met à jour toute seule. » s'affiche.

☐ OK ☐ KO

---

### Étape 436 — Attestation de réussite (facultatif)
👤 **directeur des études** · fenêtre **A** · 📂 Menu **« Enseignement supérieur »** > **« Attestations »** (`/v2/higher/attestations`)

1. Choisir Informatique, l'année en cours et le nœud "L1 — Licence 1 A" ; « Classe (facultatif) » = Licence 1 A.
2. Lire « Étudiants et éligibilité aux attestations » (colonnes « UE » `2 / 2`, « Crédits », « État »).
3. Pour DIABATE Nadia, cliquer **« Émettre »**.

✅ « Attestation émise pour DIABATE Nadia (ATT-AAAA-NNNNNN). » ; la ligne affiche ensuite la référence.

⚠️ *Écart connu (probable)* : même défaut de sélecteur que pour le diplôme ("Programme introuvable (…)") : noter le message et passer.

☐ OK ☐ KO

---

### Étape 437 — Publier les documents (secrétariat)
👤 **secrétariat** (superieur-test) `secretariat@superieur-test.test` (**MFA**) · fenêtre **A** · 📂 Menu **« Enseignement supérieur »** > **« Documents émis »** (`/v2/higher/documents`)

1. Lire « Documents officiels émis » (filtres « Nature », « État »). Cliquer **« Détail »** sur le diplôme de Nadia : « Référence », « Code de vérification », « Empreinte ».
2. Cliquer **« Publier »** sur le **diplôme** et sur l'**attestation d'authenticité** de DIABATE Nadia (pas sur le duplicata, ni sur les documents de TOURE Jean-Marc).

✅ « Le document DIP-AAAA-NNNNNN est publié. » ; badge « Publié ». Pas de bouton « Révoquer » pour ce compte.

🔒 *Test de droit* : le secrétariat tape `/v2/higher/diplomas` → "Accès refusé" (il n'a pas la permission de lecture des diplômes).

☐ OK ☐ KO

---

### Étape 438 — Vérification publique d'un diplôme
👤 **aucun compte** (page publique) · fenêtre **B** (navigation privée, non connectée) · 📂 `/v2/verify`

1. Saisir le code de vérification du diplôme de DIABATE Nadia dans « Code de vérification » et cliquer **« Vérifier »**.
2. Cliquer « Comparer un fichier PDF » et choisir le PDF téléchargé.

✅ Badge « Authentique », « Document authentique », « Nature du document » = « Diplôme », établissement Université Horizon, « Émis le … ». Aucun nom d'étudiant, aucune note. PDF : « Fichier identique », « Statut du document : Authentique. ».

☐ OK ☐ KO

---

### Étape 439 — « Mes documents » : l'étudiant et le parent
👤 **élève** (étudiant DIABATE Nadia) `eleve@superieur-test.test` puis **parent** (DIABATE Séka) `parent@superieur-test.test` (pas de MFA) · fenêtre **B** · 📂 Menu **« Mes documents »** (`/v2/higher/me/documents`)

1. Étudiant : titre « Mes documents officiels » ; une carte par document **publié** (diplôme et attestation d'authenticité), lien « Page de vérification publique », bouton **« Télécharger le PDF »**.
2. Parent : sections « Documents de DIABATE Nadia » et « Documents de DIABATE Salimata ».

✅ Étudiant : uniquement les 2 documents publiés (ni le duplicata, ni rien de TOURE Jean-Marc). Parent : les mêmes documents pour Nadia ; pour Salimata « Aucun document publié. »

🔒 *Test de droit* : étudiant puis parent tapent `/v2/higher/diplomas`, `/v2/higher/documents`, `/v2/higher/credits` → "Accès refusé".

☐ OK ☐ KO

---

### Étape 440 — ⚠️ Irréversible : révoquer le diplôme de TOURE Jean-Marc
👤 **directeur** (superieur-test) · fenêtre **A** · 📂 Fiche du diplôme `TG-LIC-INFO` > rubrique « Octrois »

⚠️ Irréversible : la révocation est un acte terminal. **Ne jamais révoquer l'octroi de DIABATE Nadia** (les portails famille en dépendent).

1. Sur l'octroi « Obtenu » de **TOURE Jean-Marc**, cliquer **« Révoquer »** (fenêtre « Révoquer le diplôme de TOURE Jean-Marc »).
2. Saisir `court` dans « Motif de la révocation » : refus. Remplacer par `Révocation de test guide (octroi normal)` et valider.
3. Ouvrir `/v2/higher/documents` : le diplôme de TOURE Jean-Marc. Puis, en fenêtre privée, saisir son code sur `/v2/verify`.

✅ « Le diplôme est révoqué. » ; carte "Révoqué par … le … : …" avec le badge « Révoqué » ; le document passe « Révoqué » (« Document révoqué : le PDF n'est plus fourni. ») ; la vérification publique répond « Révoqué » ("Ce document a été révoqué le …"). Dans « Candidats », le bouton devient « Ré-octroyer ». Un second « Révoquer » n'est plus proposé.

⚠️ *Test d'erreur* : motif `court` → « Le motif doit comporter au moins 10 caractères. »

🔒 *Test de droit* : le directeur des études n'a pas le bouton « Révoquer ».

☐ OK ☐ KO

---

📚 *Pour aller plus loin* : chapitre 11, scénarios 11.3 (cas invalides), 11.4 (cycle de prérequis), 11.5 (politique « Inscrire les crédits de l'UE »), 11.6 (UE annuelles, **à faire après le rattrapage et à retirer aussitôt**), 11.8 (modifier, synchroniser, supprimer un diplôme), 11.10 (octroi forcé et ré-octroi), 11.11 (historique des signataires), 11.13 (révocation d'un document), 11.18 et 11.19 (droits, qualité). Résultats et session 2 : chapitre 09, scénarios 9.17 et 9.18. Admissions de l'université : chapitre 17, scénario 17.29.

**Ce que la phase laisse dans l'application :**
- Semestre 1 de Licence 1 A **reclôturé en version 2** : TOURE Jean-Marc admis (12 / 12, UE 1 acquise par « Rattrapage »), COULIBALY Salimata Programmation à 6,0 ; examen `Examen Programmation session 2 test guide` publié ; fenêtre de rattrapage `2026-10-08` au `2026-10-22` clôturée.
- Dispense de COULIBALY Moussa (UE 2) accordée puis révoquée (motifs `… test guide`) ; durée de validité des crédits remise à vide.
- Quatre emplacements de signature affectés à "Directeur Fictif" dès le `2026-09-01` (non supprimables).
- Diplôme `TG-LIC-INFO` (grade `LICENCE`, "Licence Informatique test guide"), si la création n'a pas été bloquée.
- Octroi manuel à **DIABATE Nadia** (à conserver) : diplôme, attestation d'authenticité (publiés), duplicata `/D1` (non publié), attestation de réussite éventuelle ; octroi à TOURE Jean-Marc **révoqué** avec son document « Révoqué ».

---

## Phase 24 — Actes de fin de recette (irréversibles)

Dernière phase : l'acte irréversible reporté depuis la phase « Emploi du temps ». À ne jouer qu'une fois, quand tout le reste est terminé.

Précondition : phases « Emploi du temps » et "Appel et présences" terminées.

### Étape 441 — Archiver l'emploi du temps de démonstration et publier le vôtre
👤 **directeur** (secondaire-test, `directeur@secondaire-test.test`, MFA) · fenêtre **A** · 📂 fiche `Emploi du temps 6E-A` puis `Emploi du temps test guide 6e A` (`/v2/schedule/timetables`)

> ⚠️ Irréversible. Un emploi du temps archivé ne se republie jamais. C'est pourquoi cette étape est placée **tout à la fin** du guide : les phases précédentes lisent l'emploi du temps de démonstration `6E-A`.

1. Sur `Emploi du temps 6E-A` (publié), cliquer **« Archiver »** et confirmer.
2. Ouvrir `Emploi du temps test guide 6e A` (aucun conflit, voir l'étape *Provoquer un conflit entre créneaux*) et cliquer **« Publier »**.
3. Cliquer **« Générer les séances »** sur une période d'un mois (à partir de `12/10/2026`).

✅ "Emploi du temps archivé." (état « Archivé », lecture seule) ; "Emploi du temps publié." (badge « Publié », "Seul un brouillon est modifiable.") ; génération : « Créées » = vendredis × 2 créneaux hebdomadaires (P1 et P2) + P3 un vendredi sur deux ; « Déjà existantes » = 0. Les séances ponctuelles `Séance de remplacement test guide` (14:00) ne gênent pas.

⚠️ *Test d'erreur* : publier un second brouillon (`Emploi du temps test guide B`) → "Un emploi du temps est déjà publié pour cet établissement, cette année et cette période."

☐ OK ☐ KO

---

**Ce que la phase laisse dans l'application :** `Emploi du temps test guide 6e A` publié ; `Emploi du temps 6E-A` archivé ; séances générées à partir du 12/10/2026.

---

## Bilan de la recette

### Synthèse à remplir

| Phase | Module | Étapes OK | Étapes KO | Remarques |
| :--- | :--- | :---: | :---: | :--- |
| 1-2 | Connexion, abonnement, rôles, structure | | | |
| 3 | Personnes et imports | | | |
| 4-5 | Admissions, finance | | | |
| 6-7 | Emploi du temps, appel | | | |
| 8-9 | Notes, résultats, bulletins | | | |
| 10-12 | Vie scolaire, conseil de classe, élèves affectés | | | |
| 13-14 | Examens, paie | | | |
| 15-18 | Documents, messagerie, tableaux de bord, portails | | | |
| 19-21 | Sécurité, console, accessibilité | | | |
| 22-23 | Primaire, supérieur | | | |
| 24 | Actes de fin de recette | | | |

### Consigner une anomalie

| Rubrique | Contenu |
| :--- | :--- |
| Étape | numéro et titre (ex. étape 87) |
| Gravité | **Bloquant** (parcours inutilisable, fuite de données, faille de droits) · **Majeur** (fonction qui échoue ou résultat faux, contournable) · **Mineur** (affichage, libellé anglais ou technique, message peu clair) · **Suggestion** |
| Compte / fenêtre | rôle, établissement |
| Résultat obtenu | message recopié mot pour mot |
| Résultat attendu | ce que dit l'étape |
| Console / réseau | erreurs de console ; requêtes en 4xx/5xx (méthode, adresse, code) |
| Reproductible | à chaque fois / parfois / une fois |

Un refus de droit attendu (« Accès refusé », "introuvable") n'est **pas** une anomalie ; une erreur 500 n'est jamais attendue. La première visite d'une page peut être lente en mode développement : rechargez une fois avant de signaler.

### Pour aller plus loin

- Les **chapitres de référence** par module (tous les écrans, cas invalides, droits, écarts constatés) : [`docs/guide-test/README.md`](guide-test/README.md).
- L'**inventaire des 301 écrans** : [`guide-test/00-inventaire-ecrans.md`](guide-test/00-inventaire-ecrans.md).
- L'**index de toutes les données fictives créées** (pour le nettoyage) : [`guide-test/jeux-de-donnees/annexe-donnees.md`](guide-test/jeux-de-donnees/annexe-donnees.md).
- Contrôle automatique des routes et libellés cités : `node scripts/check-guide-test.mjs`.
