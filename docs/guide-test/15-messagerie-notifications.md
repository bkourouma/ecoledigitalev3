# Chapitre 15 : Messagerie, annonces et notifications

Ce chapitre vérifie la communication de l'établissement : conversations (message direct, message de groupe, diffusion), annonces ciblées avec accusé de réception, signalement et modération, réglages de la messagerie, cloche et notifications dans l'application, puis le module « Notifications » (journal des envois, envoi manuel, gabarits avec variables, règles, canaux, préférences personnelles, désinscription). **Aucun message réel ne doit partir** : les canaux externes (e-mail, SMS, WhatsApp, notification sur le téléphone) sont simulés ou non configurés ; seules les notifications « dans l'application » sont réellement remises.

> **Adresses.** L'application tourne sur `http://localhost:3000` (API `http://localhost:4000`). Les écrans de ce chapitre sont sous `apps/web/src/app/v2/...` et **aucun préfixe supplémentaire** n'est ajouté par `next.config.js` ni par le middleware : l'adresse du navigateur est donc `/v2/...` telle qu'écrite ici.
> **Page d'accès refusé.** Toutes les gardes de page de ce chapitre redirigent vers `/unauthorized` : page « Accès refusé », texte "Vous n'avez pas les droits nécessaires pour afficher cette page." et lien "Retour à l'accueil". Un utilisateur non connecté est renvoyé vers `/login`.
> **Typographie.** Un libellé entre guillemets français est copié de l'interface (`fr-CI.json`). Les libellés qui viennent de données (nom d'un gabarit ou d'une règle de notification, libellés du menu fournis par l'API) et les messages d'erreur de l'API sont écrits entre guillemets droits "…".

## Prérequis

- Les trois établissements de démonstration sont créés (voir l'annexe) ; ce chapitre se déroule sur **Collège Le Baobab** (`secondaire-test`, connexion par `/login`), sauf les scénarios 15.35 (primaire).
- Le **worker** tourne (il publie les annonces programmées toutes les minutes, remet les notifications toutes les 15 secondes environ, évalue les alertes). Sans lui, les scénarios d’annonce programmée, de journal des envois et de cloche ne se terminent pas.
- Ordre conseillé : 15.1 à 15.9, puis annonces 15.12 à 15.19, puis 15.20, puis modération 15.21 à 15.25 (qui modifient des réglages et restreignent un compte : à faire en dernier), puis notifications 15.26 à 15.35.
- Les scénarios qui créent des données sont indépendants des données du seed autant que possible. Les actions **irréversibles** sont signalées : l'accusé de réception d'une annonce ne peut pas être retiré (15.12), un message envoyé ne se supprime pas (il se retire), chaque version de gabarit publiée reste dans l'historique (15.29).

## Comptes

Mots de passe et codes MFA : jamais dans ce guide (voir l'annexe : cliquer sur le compte dans le panneau de droite de `/v2/login`).

| Rôle | E-mail | MFA | Rôle dans ce chapitre |
|---|---|---|---|
| Propriétaire | `direction.generale@secondaire-test.test` | oui | Réglages, avis urgent, gabarits, règles, canaux |
| Directeur | `directeur@secondaire-test.test` | oui | Auteur des annonces du seed ; diffusion, groupe, modération, supervision |
| Directeur des études | `etudes@secondaire-test.test` | oui | Écrit à tout le monde, publie et gère les annonces ; lit les notifications |
| Secrétariat | `secretariat@secondaire-test.test` | oui | Publie des annonces, envoie des convocations ; pas de modération |
| Économe | `econome@secondaire-test.test` | oui | Contrôle de droits (journal en lecture seule) |
| Enseignant (TRAORE Kouadio) | `enseignant@secondaire-test.test` | non | Reçoit, répond, signale ; annonces vers ses classes |
| Éducateur | `educateur@secondaire-test.test` | non | Contrôle de droits |
| Parent (DIABATE Séka) | `parent@secondaire-test.test` | non | Écrit à l'enseignant, accuse réception, règle ses préférences |
| Élève | `eleve@secondaire-test.test` | non | Politique de messagerie des élèves |
| Parent du primaire | `parent@primaire-test.test` | non | Isolation entre établissements (15.35) |

## Droits (qui voit quoi)

Source : `apps/api/src/modules/rbac/templates/system-roles.ts`, gardes de page `apps/web/src/app/v2/{messages,announcements,notifications,account}/**/page.tsx`.

| Écran | Permission requise (une des) | Rôles qui l'ont dans le seed |
|---|---|---|
| `/v2/messages`, `/v2/messages/{id}`, `/v2/messages/notifications` | `messaging.read`, `messaging.child.read`, `messaging.self.read` | tous les rôles du tableau ci-dessus (parent : `child`, élève : `self`) |
| `/v2/messages/new` | `messaging.send`, `messaging.send.any`, `messaging.child.send`, `messaging.self.send` | idem ; mais la **portée** d'envoi est calculée à part (tableau 15.10) |
| `/v2/messages/moderation` | `messaging.moderation.read` | Propriétaire, Directeur seulement |
| `/v2/messages/settings` | `messaging.settings.manage` | Propriétaire, Directeur seulement |
| `/v2/announcements`, `/v2/announcements/{id}` | lecture de la messagerie, ou une permission de publication | tous ; la gestion (statistiques, accusés, retrait) est réservée à l'auteur ou à `messaging.announcement.manage` (Propriétaire, Directeur, Directeur des études) |
| `/v2/announcements/new`, `/v2/announcements/{id}/edit` | `messaging.announcement.publish`, `.publish_class`, `.manage` | Propriétaire, Directeur, Directeur des études, Secrétariat (toute cible) ; Enseignant, Éducateur (vers leurs classes) |
| `/v2/notifications` (journal), `/v2/notifications/channels`, `/rules`, `/templates` | `notifications.read` (ou gestion des gabarits / règles / réglages) | Propriétaire, Directeur, Directeur des études, Secrétariat, Économe, Responsable des examens (lecture) |
| `/v2/notifications/send` | `notifications.send` ou `notifications.send.urgent` | Propriétaire, Directeur, Directeur des études, Secrétariat ; l'**urgence** : Propriétaire, Directeur seulement |
| Modifier gabarits, règles, canaux (et « Envoyer un essai ») | `notifications.templates.manage`, `.rules.manage`, `.settings.manage` | Propriétaire, Directeur seulement |
| `/v2/account/notifications` | `notifications.own.manage`, `.child.manage`, `.self.manage` | Propriétaire, Directeur, Enseignant, Éducateur, Parent, Élève ; **pas** Secrétariat, Économe, Directeur des études, Responsable des examens |
| `/v2/notifications/unsubscribe` | aucune (page publique par lien signé) | tout le monde |

**Adresses à taper à la main qui doivent être refusées** (résultat attendu : page « Accès refusé » après redirection vers `/unauthorized`) :

| Rôle | Adresses refusées |
|---|---|
| Parent | `/v2/messages/moderation`, `/v2/messages/settings`, `/v2/announcements/new`, `/v2/notifications`, `/v2/notifications/send` |
| Élève | `/v2/announcements/new`, `/v2/messages/moderation`, `/v2/notifications/templates`, `/v2/notifications/channels` |
| Enseignant | `/v2/messages/moderation`, `/v2/messages/settings`, `/v2/notifications`, `/v2/notifications/send`, `/v2/notifications/rules` |
| Secrétariat | `/v2/messages/moderation`, `/v2/messages/settings`, `/v2/account/notifications` (à vérifier, voir Écarts) |
| Économe | `/v2/announcements/new`, `/v2/notifications/send`, `/v2/messages/moderation` |
| Directeur des études | `/v2/messages/moderation`, `/v2/messages/settings` |

## Données de départ

Source : `scripts/seed-v2/demo/comms.ts` (appelé pour chaque établissement), `scripts/seed-v2/dataset.ts`.

- **Deux annonces**, publiées par le compte Directeur :
  - "Rentrée : réunion d'information des parents (démonstration)" : **publiée**, **épinglée**, **accusé de réception demandé**, cible « Tout l'établissement », audiences « Parents et tuteurs » et « Personnel » (le seed a retiré l'audience « Élèves », car le texte s'adresse aux parents ; une base créée avant ce correctif peut encore l'envoyer aux élèves, voir 15.19).
  - "Brouillon : calendrier des compositions (démonstration)" : **brouillon**, cible « Tout l'établissement », audience « Parents et tuteurs ».
- **Aucune conversation** n'est créée par le seed. La boîte de chaque compte est vide, sauf un éventuel fil système d'alertes (« EcoleDigitale — alertes ») si des absences ont été saisies par un autre chapitre.
- Le **journal des envois** (`/v2/notifications`) peut contenir des lignes issues d'événements du seed (candidatures, factures, alertes de direction…) : leur nombre et leur statut ne sont pas garantis. Les gabarits, règles et réglages de canaux sont ceux **livrés** par la plateforme (version 0, aucune version propre à l'établissement).
- Le tuteur n° 1 (DIABATE Séka, compte `parent@…`) est tuteur de **DIABATE Nadia** et **DIABATE Salimata**, élèves de la classe 6e A (`6E-A`). L'enseignant TRAORE Kouadio est affecté à `6E-A` (à confirmer à l'écran : le message du parent à TRAORE Kouadio a été accepté lors des tests de recette, rapport 12).
- Règles d'alerte de direction (3) : voir le chapitre 16.

## Portée d'envoi : qui peut écrire à qui

Source : `apps/api/src/modules/messaging/domain/policy.ts` et `README.md` du module.

| Qui écrit | Peut écrire à | Remarques |
|---|---|---|
| Propriétaire, Directeur, Directeur des études (`messaging.send.any`) | Tout utilisateur actif, toute classe, « Toute l'école » avec choix des audiences | Seuls à voir le bloc « Toute l'école » |
| Personnel avec fiche de personnel et `messaging.send` (Enseignant, Éducateur…) | Autre personnel, contacts de l'administration (rôles `directeur` et `secretariat` par défaut, 30 au plus), élèves et tuteurs **de ses classes** | Diffusion et groupe vers **ses** classes seulement |
| Compte `messaging.send` **sans fiche de personnel** (Secrétariat, Économe, Responsable des examens, Chargé d'admissions… selon le seed) | Rien à l'ouverture d'une conversation : écran « Vous ne pouvez pas envoyer de message pour le moment. » ; il peut en revanche **répondre** aux fils existants | Constaté en recette (rapport 04, C-04-05, verdict "à instruire") ; à vérifier en test |
| Parent | Personnel affecté aux classes de ses enfants + contacts de l'administration ; en plus, les enseignants de l'**année précédente** de ses enfants pendant la fenêtre réglée par "Parents : écrire aux enseignants de l'année précédente pendant (jours, 0 = fermé)" (90 jours par défaut) | Jamais un autre parent, jamais un élève ; types « Message direct » et « Message de groupe » seulement |
| Élève | Selon « Messagerie des élèves » (défaut : ses enseignants **et** l'administration) | Réponse possible tant que la messagerie n'est pas désactivée |
| Enseignant habilité à toute famille (`messaging.send.any_family`) | Tuteurs de toute famille de l'établissement, envois hors portée audités | Réservé à un rôle personnalisé accordé par la direction ; **non couvert** ici (voir Non couvert) |

Plafonds par défaut : 120 messages par heure et par utilisateur, 30 nouvelles conversations par jour, groupe de 200 participants, diffusion ou annonce de 5 000 destinataires, message de 5 000 caractères, 5 pièces jointes de 5 Mo (PDF, JPEG, PNG, WebP).

## Scénarios : messagerie

#### 15.1 Découvrir la boîte de messages (états vides, dossiers, recherche)
Compte : Parent (Collège Le Baobab) · Où : menu « Modules » > « Communication » > « Messages » (`/v2/messages`) · Prérequis : aucune conversation encore créée par ce chapitre.
1. Se connecter avec `parent@secondaire-test.test` et ouvrir « Messages ». Lire le titre « Messages » et la phrase "Vos conversations avec les enseignants, l'administration et les familles."
2. Vérifier le bouton « Nouveau message » en haut à droite et la barre d'onglets : liens « Messages », « Annonces », « Notifications » à gauche, la cloche à droite. Les entrées « Modération » et « Paramètres » ne doivent **pas** apparaître.
3. Cliquer successivement les quatre dossiers « Boîte de réception », « Favoris », « Archivés », « Envoyés ».
4. Dans « Boîte de réception », saisir `zzz` dans le champ de recherche (placeholder "Rechercher par objet ou par personne").
5. Cocher « Non lus seulement » ; décocher. Choisir le bouton radio « Texte des messages » : la boîte affiche « Saisissez au moins 2 caractères pour chercher dans vos messages. ».
6. Ouvrir « Favoris » : le bouton radio « Texte des messages » est désactivé (la recherche dans le texte ne porte que sur la boîte de réception).
Résultat attendu : les quatre dossiers affichent respectivement « Votre boîte de réception est vide. », « Aucune conversation en favori. », « Aucune conversation archivée. », « Vous n'avez encore rien envoyé. » (avec la phrase « Les nouveaux messages apparaissent ici dès leur réception. ») ; la recherche `zzz` affiche « Aucune conversation ne correspond à ce filtre. » ; aucune erreur.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Recherche dans le texte avec 1 seul caractère | « Saisissez au moins 2 caractères pour chercher dans vos messages. » |
| Recherche dans le texte avec `zzzzzz` (2 caractères ou plus, introuvable) | « Aucun message ne correspond à cette recherche. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : un parent n'a ni « Modération » ni « Paramètres » dans la navigation

#### 15.2 Parent : écrire un message direct à l'enseignant
Compte : Parent · Où : « Messages » > « Nouveau message » (`/v2/messages/new`) · Prérequis : 15.1.
1. Cliquer « Nouveau message » : le titre est « Nouveau message ». Noter le texte d'aide "Vous ne pouvez écrire qu'aux personnes proposées : celles qui sont liées à vos enfants, à vos classes ou à l'administration." (il parle de "vos classes" même pour un parent : voir Écarts).
2. Vérifier la zone « Type de message » : deux choix seulement, « Message direct » (coché) et « Message de groupe ». Il n'y a **pas** de « Diffusion » pour un parent.
3. Dans « Destinataires », la liste « Personnes proposées » montre sans saisie les contacts naturels (enseignants de la classe de l'enfant, contacts de l'administration). Dans « Rechercher une personne », saisir `Kouadio`, puis cliquer sur la personne TRAORE Kouadio.
4. Remplir le formulaire :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Rechercher une personne | `Kouadio` puis choisir TRAORE Kouadio | oui (un seul destinataire pour un message direct) |
   | À propos de l'enfant | `DIABATE Nadia` (liste : « Aucun enfant précisé », DIABATE Nadia, DIABATE Salimata) | non |
   | Objet | `Question sur le devoir test guide` | non (obligatoire pour un groupe ou une diffusion) |
   | Priorité | « Normale » (liste : « Basse », « Normale », « Élevée », « Urgente ») | oui (défaut « Normale ») |
   | Message | `Bonjour M. TRAORE, pouvez-vous rappeler le devoir de mathématiques pour lundi ? Merci. (test guide)` | oui |
5. Cliquer « Envoyer ».
Résultat attendu : le bouton passe un instant à « Envoi en cours… », puis la page `/v2/messages/{id}` de la conversation s'ouvre avec le titre "Question sur le devoir test guide", le nom du destinataire sous le titre et la bulle du parent à droite (auteur « Vous »). Dans « Messages » > « Envoyés », la conversation figure. Valeur persistée après rechargement.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Aucun destinataire choisi, corps rempli | "Choisissez au moins un destinataire." sous la zone Destinataires |
| Destinataire choisi, champ « Message » vide | "Ce champ est obligatoire." sous « Message » |
| Passer en « Message de groupe » sans « Objet » | "Un message de groupe ou de diffusion a un objet." sous « Objet » (le libellé « Objet » reçoit l'astérisque obligatoire) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : un parent ne voit pas le type « Diffusion »

#### 15.3 Parent : la portée d'envoi est limitée (personnes introuvables)
Compte : Parent · Où : « Messages » > « Nouveau message » · Prérequis : 15.2.
1. Ouvrir « Nouveau message » en « Message direct ».
2. Dans « Rechercher une personne », saisir `BAMBA` (parent d'un autre élève : tuteur T2, BAMBA Elie).
3. Saisir `COULIBALY` (autre famille), puis `Nadia` (son propre enfant : un élève, jamais proposé), puis `YAO` (enseignante YAO Fatou qui n'enseigne pas à ses enfants, à vérifier selon les affectations du seed).
4. Vider la recherche : la liste revient aux contacts naturels.
Résultat attendu : pour `BAMBA`, `COULIBALY` et `Nadia` : « Aucune personne autorisée ne correspond à cette recherche. » Seuls les enseignants des classes des enfants et les contacts de l'administration (`directeur`, `secretariat`) sont proposés. `YAO` n'est proposé que si cette enseignante est affectée à la classe d'un enfant. Aucun message d'erreur technique.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Recherche sans résultat | « Aucune personne autorisée ne correspond à cette recherche. » |
| Aucune saisie et aucun contact naturel | « Aucune suggestion : recherchez une personne par son nom. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : aucun autre parent ni élève n'est proposé

#### 15.4 Enseignant : lire (non lu puis lu) et répondre ; le parent lit la réponse
Compte : Enseignant puis Parent · Où : « Messages » (`/v2/messages`) · Prérequis : 15.2.
1. Se connecter avec `enseignant@secondaire-test.test`. Ouvrir « Messages ».
2. Repérer dans « Boîte de réception » la ligne "Question sur le devoir test guide" : nom de l'expéditeur en gras, pastille ronde, badge « 1 non lu(s) ».
3. Cliquer sur la ligne : la conversation s'ouvre. Revenir (lien « Retour ») : le badge "non lu" a disparu.
4. Rouvrir la conversation. Dans le formulaire « Répondre », champ « Votre réponse », saisir `Bonjour, le devoir porte sur les fractions, page 42. (test guide)` puis cliquer « Envoyer ».
5. Se reconnecter en Parent, ouvrir « Messages » : la conversation est en gras avec un badge non lu. L'ouvrir et lire la réponse (bulle à gauche, auteur TRAORE Kouadio). Laisser la page ouverte 20 secondes : le fil se relit tout seul.
Résultat attendu : la lecture se fait à l'ouverture (un envoi explicite, aucune lecture au simple affichage de la liste) ; la réponse revient chez le parent ; le bouton « Envoyer » reste grisé tant que la réponse est vide.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Réponse vide ou espaces | Le bouton « Envoyer » reste désactivé, rien n'est envoyé |
| Réponse dans un fil de groupe dont les réponses sont désactivées (voir 15.9) | Pas de formulaire : avertissement "Les réponses sont désactivées dans cette conversation." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : un tiers ne peut pas ouvrir le fil (voir 15.34, ligne du fil d'un autre utilisateur)

#### 15.5 Favori, sourdine, archivage et recherche dans le texte
Compte : Parent · Où : conversation "Question sur le devoir test guide" (`/v2/messages/{id}`) · Prérequis : 15.4.
1. Dans la barre « Actions sur la conversation », cliquer « Favori » : le libellé devient « Retirer des favoris » et l'étoile se remplit.
2. Cliquer « Sourdine » : le libellé devient « Réactiver les notifications ».
3. Cliquer « Archiver » : retour automatique à « Messages ».
4. Ouvrir « Favoris » : la conversation y figure avec une étoile et le badge « En sourdine ».
5. Ouvrir « Archivés » : la conversation y figure. L'ouvrir et cliquer « Désarchiver ».
6. Retour à « Boîte de réception ». Choisir le bouton radio « Texte des messages » et saisir `fractions` : la ligne de résultat montre l'objet, l'expéditeur et un extrait.
Résultat attendu : les dossiers « Favoris », « Archivés » et « Boîte de réception » reflètent chaque action ; la recherche dans le texte trouve le mot de la réponse de l'enseignant. Remettre « Retirer des favoris » et « Réactiver les notifications » en fin de scénario.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Recherche dans le texte : `a` | « Saisissez au moins 2 caractères pour chercher dans vos messages. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : sans objet

#### 15.6 Pièces jointes d'un message
Compte : Parent · Où : « Messages » > « Nouveau message » · Prérequis : 15.2. Fichiers : `docs/guide-test/jeux-de-donnees/ch15-piece-jointe-test-guide.pdf` (PDF valide, 673 octets), `ch15-piece-jointe-fausse-test-guide.pdf` (texte renommé en .pdf), `ch15-piece-jointe-vide-test-guide.pdf` (0 octet), et, si présent, `justificatif-trop-lourd-test-guide.pdf` (5,6 Mo, au-dessus des 5 Mo par défaut).
1. Ouvrir « Nouveau message », choisir TRAORE Kouadio, objet `Pièce jointe test guide`, message `Voir le document joint. (test guide)`.
2. Cliquer « Joindre un fichier » (aide : "PDF, JPEG, PNG ou WebP ; la taille maximale est fixée par l'établissement.") et choisir le PDF valide.
3. Répéter avec le faux PDF, puis le fichier vide, puis le fichier trop lourd.
4. Envoyer le message avec la seule pièce valide. Dans le fil, cliquer sur la pièce jointe (bouton avec le nom et la taille).
Résultat attendu : la pièce valide apparaît sous le bouton sous forme de puce avec son nom et sa taille ("673 o") et une croix pour la retirer ; chaque refus affiche sous le bouton, en rouge, le nom du fichier suivi du motif ; après envoi, un clic sur la pièce ouvre le document dans un nouvel onglet (lien signé de courte durée). Le type est détecté sur le contenu réel (octets), jamais sur l'extension.
Cas invalides (le texte exact peut différer légèrement du texte de l'API cité) : | Saisie | Message attendu |
|---|---|
| Faux PDF (texte renommé) | "ch15-piece-jointe-fausse-test-guide.pdf : Type de fichier non accepté (contrôlé sur le contenu réel du fichier)." |
| Fichier vide | "ch15-piece-jointe-vide-test-guide.pdf : Le fichier est vide." |
| Fichier de plus de 5 Mo | "justificatif-trop-lourd-test-guide.pdf : Le fichier dépasse la taille maximale autorisée (5242880 octets)." (nombre d'octets de l'établissement) |
| 6 fichiers valides à la suite | « Au plus 5 pièces jointes. » (le sélecteur interne plafonne à 5) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : sans objet

#### 15.7 Retirer son propre message
Compte : Parent · Où : le fil créé en 15.6 · Prérequis : 15.6.
1. Dans le fil, sous la bulle du parent (la dernière), cliquer « Retirer » (aucune fenêtre de confirmation).
2. Ouvrir le même fil avec le compte Enseignant.
Résultat attendu : la bulle est remplacée par « Message retiré par son auteur » (en italique) chez les deux ; le bouton « Retirer » et le bouton « Signaler » disparaissent de cette bulle. À vérifier : ce que deviennent les pièces jointes d'un message retiré (le code les affiche encore tant que l'API les renvoie).
Cas invalides : | Saisie | Message attendu |
|---|---|
| Chercher « Retirer » sur le message de l'autre personne | Absent : on ne voit « Signaler » que sur les messages des autres |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : « Retirer » n'existe que sur ses propres messages

#### 15.8 Directeur : diffusion à une classe, réponse privée du parent
Compte : Directeur puis Parent · Où : « Messages » > « Nouveau message » · Prérequis : aucun.
1. Se connecter avec `directeur@secondaire-test.test` (code MFA). Ouvrir « Nouveau message ».
2. Vérifier les trois choix de « Type de message » : « Message direct », « Message de groupe », « Diffusion ». Choisir « Diffusion » et lire "Le même message envoyé en privé à chaque destinataire : ils ne se voient pas." puis "Chaque destinataire reçoit un fil privé. Leurs réponses reviennent dans votre boîte de réception."
3. Remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Classe (dans le bloc « Classes ») | `6E-A` via « Choisir une classe » puis « Ajouter la classe » | oui (une cible au moins) |
   | Personnes visées dans la classe | cocher « Parents et tuteurs » seulement | oui (une catégorie au moins) |
   | Objet | `Diffusion 6e A test guide` | oui pour une diffusion |
   | Priorité | « Élevée » | oui |
   | Message | `Chers parents, la réunion de classe aura lieu samedi à 9 h. (test guide)` | oui |
4. Cliquer « Envoyer ». La page revient sur `/v2/messages` dans le dossier « Envoyés ».
5. Se connecter en Parent : la diffusion est dans « Boîte de réception » avec le badge « Élevée ». Répondre `Merci, nous serons présents. (test guide)`.
6. Revenir au Directeur : dans « Boîte de réception », un fil du parent apparaît (réponse privée).
Résultat attendu : « Envoyés » du directeur montre la diffusion avec le badge « Diffusion : n destinataire(s) » ; chaque parent reçoit un fil **privé** (il ne voit pas les autres destinataires) ; la réponse revient dans la boîte du directeur sans être visible des autres parents. Le nombre n compte les comptes qui peuvent se connecter (tuteurs ayant un compte), pas les élèves.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Diffusion sans classe ni destinataire | "Choisissez au moins un destinataire." |
| Diffusion sans « Objet » | "Un message de groupe ou de diffusion a un objet." |
| Décocher toutes les catégories de personnes visées puis « Ajouter la classe » | Le bouton « Ajouter la classe » reste désactivé |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : un parent et un élève n'ont pas le type « Diffusion »

#### 15.9 Directeur : message de groupe sans réponses, puis quitter le groupe
Compte : Directeur puis Enseignant · Où : « Messages » > « Nouveau message » · Prérequis : aucun.
1. Directeur : « Nouveau message », type « Message de groupe ».
2. Remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Rechercher une personne | `Kouadio` puis TRAORE Kouadio (ajouter ; les destinataires choisis s'affichent en pastilles avec une croix « Retirer … ») | oui |
   | Écrire aussi à l'administration | coché (les contacts d'administration rejoignent le fil) | non |
   | Objet | `Groupe pédagogique test guide` | oui |
   | Message | `Point sur les évaluations de la période. (test guide)` | oui |
   | Autoriser les réponses des participants | **décocher** | non |
3. « Envoyer ».
4. Enseignant : ouvrir le fil. Le formulaire de réponse est remplacé par un avertissement. Cliquer « Quitter le groupe ».
Résultat attendu : le directeur voit le badge « Groupe de 3 » (ou plus selon les contacts d'administration) ; l'enseignant lit un avertissement "Les réponses sont désactivées dans cette conversation." (le directeur, propriétaire du fil, peut répondre) ; « Quitter le groupe » ramène à « Messages » et le fil n'y est plus.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Groupe sans « Objet » | "Un message de groupe ou de diffusion a un objet." |
| Retirer le seul destinataire puis « Envoyer » avec « Écrire aussi à l'administration » décoché | "Choisissez au moins un destinataire." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : « Quitter le groupe » n'existe que pour un fil de type groupe

#### 15.10 Portée d'envoi selon le rôle (enseignant, élève, comptes sans fiche de personnel)
Compte : Enseignant, Élève, Secrétariat, Directeur des études · Où : « Messages » > « Nouveau message » · Prérequis : aucun.
1. Enseignant : « Nouveau message » en « Diffusion » : le bloc « Classes » propose une **liste fermée** de ses classes (pas de recherche sur toute l'école) ; le bloc « Toute l'école » n'existe pas. Rechercher `DIABATE` : les tuteurs/élèves de ses classes sont proposés.
2. Élève : « Messages » > « Nouveau message » : deux types (« Message direct », « Message de groupe ») ; la recherche `Kouadio` propose l'enseignant ; la recherche `Nadia` ou un autre élève ne propose personne.
3. Secrétariat : ouvrir « Messages » puis `/v2/messages/new`.
4. Directeur des études : « Nouveau message » en « Diffusion » : cocher « Toute l'école » et choisir les audiences « Élèves », « Parents et tuteurs », « Personnel » (ne pas envoyer).
Résultat attendu : l'enseignant ne voit que ses classes ; l'élève ne peut écrire qu'à ses enseignants et à l'administration ; le Secrétariat (sans fiche de personnel) voit, selon le seed, soit le bouton « Nouveau message », soit l'avertissement « Vous ne pouvez pas envoyer de message pour le moment. » et aucun bouton (comportement constaté en recette ; **à vérifier en test** et à signaler s'il est différent) ; le Directeur des études voit le bloc « Toute l'école » avec les cases « Élèves », « Parents et tuteurs », « Personnel ».
Cas invalides : | Saisie | Message attendu |
|---|---|
| Élève : rechercher `Nadia` (un autre élève) | « Aucune personne autorisée ne correspond à cette recherche. » |
| Enseignant : rechercher le nom d'un parent d'une autre classe (famille d'un élève hors de ses classes) | « Aucune personne autorisée ne correspond à cette recherche. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : portée différente par rôle

#### 15.11 Message système d'absence (fil d'alertes automatiques)
Compte : Parent · Où : « Messages » (`/v2/messages`) · Prérequis : une absence de DIABATE Nadia a été saisie et validée (chapitre Présences, saisie d'un appel) ; le worker tourne.
1. Après la saisie de l'absence, attendre une minute puis ouvrir « Messages » en Parent.
2. Repérer la ligne dont l'expéditeur est « EcoleDigitale — alertes » (icône de haut-parleur). L'ouvrir.
3. Chercher le formulaire de réponse.
Résultat attendu : un fil système avec un message "Absence de … " au texte du gabarit « Absence d'un élève » ; à la place du formulaire de réponse : « Ce fil rassemble les alertes automatiques de l'établissement : on n'y répond pas. » Une absence déjà excusée ou une correction ne produit pas de message. Le message « Retard d'un élève » est désactivé par défaut (aucun message de retard).
Cas invalides : | Saisie | Message attendu |
|---|---|
| Répondre dans le fil système | Impossible : aucun formulaire (le serveur répond "Les réponses sont désactivées dans cette conversation.") |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : sans objet

## Scénarios : annonces

#### 15.12 Parent : lire l'annonce épinglée et accuser réception (irréversible)
Compte : Parent · Où : menu « Modules » > « Communication » > « Annonces » (`/v2/announcements`) · Prérequis : seed intact. **Faire cet accusé avec un seul compte : il ne peut pas être retiré.**
1. Ouvrir « Annonces » : titre « Annonces », description "Les informations de l'établissement destinées à vos classes, à vos enfants ou à votre fonction." Les cases « Non lues seulement » et « Afficher les annonces expirées » sont proposées ; il n'y a **pas** d'onglets « Reçues » / « Publiées par moi » (réservés aux publieurs).
2. Repérer "Rentrée : réunion d'information des parents (démonstration)" en tête : icône « Épinglée », pastille de lecture, badge « Accusé à donner ».
3. Ouvrir l'annonce : lire le titre, l'auteur, la date, le texte et le bloc « Accusé de réception demandé » avec "L'établissement vous demande de confirmer que vous avez pris connaissance de cette annonce."
4. Cliquer « J'ai pris connaissance ».
5. Recharger la page.
6. Vérifier que le brouillon "Brouillon : calendrier des compositions (démonstration)" **n'est pas** dans la liste.
Résultat attendu : après le clic, « Merci : votre accusé de réception est enregistré. » ; après rechargement, le bouton est remplacé par "Vous avez pris connaissance de cette annonce le …" (date et heure) ; dans la liste, le badge « Accusé à donner » a disparu ; le brouillon reste invisible du parent.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Accuser réception une seconde fois (ancien onglet ouvert avant le clic) | Aucun doublon : le bouton n'est plus proposé après rechargement ; l'API refuse ou ignore le second accusé (message à relever en test) |
| Ouvrir `/v2/announcements/00000000-0000-0000-0000-000000000000` | Message d'annonce introuvable ("Annonce introuvable" ou équivalent, à relever en test), aucune donnée |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : brouillon invisible du parent

#### 15.13 Directeur : suivre les accusés de réception
Compte : Directeur · Où : « Annonces » (`/v2/announcements`) · Prérequis : 15.12.
1. Se connecter avec `directeur@secondaire-test.test`. Ouvrir « Annonces » : les onglets « Reçues » et « Publiées par moi » sont affichés. Choisir « Publiées par moi ».
2. Lire la ligne de l'annonce de rentrée : "n destinataire(s), n lu(s), n accusé(s)" ; le sélecteur « Statut » propose « Tous », « Brouillon », « Programmée », « Publiée », « Retirée ».
3. Ouvrir l'annonce. Dans le bloc « Gestion de l'annonce », lire les trois compteurs « Destinataires », « Lus », « Accusés » et la ligne « Ciblage ».
4. Dans « Accusés de lecture », utiliser le sélecteur « Afficher » : « Tous les destinataires », « Non lus », « Lus », « Accusés », « Accusé en attente ».
Résultat attendu : le compteur « Accusés » vaut au moins 1 (le parent de 15.12) ; la personne figure dans le filtre « Accusés » avec la date « Accusé le » ; les autres comptes destinataires (personnel) sont « Accusé en attente » ou « Non lus » ; l'auteur n'est pas lui-même destinataire. Les tableaux ont les colonnes « Personne », « Reçue le », « Lue le », « Accusé le ». Le « Ciblage » affiche "Tout l'établissement" (les cibles de type classe s'affichent par un identifiant partiel, voir Écarts).
Cas invalides : | Saisie | Message attendu |
|---|---|
| Filtre « Accusés » quand personne n'a accusé | « Aucun destinataire dans cette liste. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : un Parent n'a ni onglet « Publiées par moi » ni bloc « Gestion de l'annonce »

#### 15.14 Secrétariat : créer une annonce ciblée sur une classe (brouillon puis publication)
Compte : Secrétariat · Où : « Annonces » > « Nouvelle annonce » (`/v2/announcements/new`) · Prérequis : aucun.
1. Se connecter avec `secretariat@secondaire-test.test` (code MFA). Ouvrir « Annonces » puis « Nouvelle annonce » (titre « Nouvelle annonce », description "Choisissez les destinataires, puis enregistrez un brouillon ou publiez. Les destinataires sont figés à la publication.").
2. Remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Titre | `Réunion de classe 6e A test guide` | oui |
   | Contenu | `Une réunion de classe aura lieu samedi à 9 h en salle 6e A. Merci de confirmer votre présence. (test guide)` | oui |
   | Type de cible | « Classe » puis « Classe » = `6E-A` puis « Ajouter la cible » (la cible apparaît sous « Cibles choisies ») | oui (une cible au moins) |
   | Personnes visées | cocher « Parents et tuteurs » seulement (décocher « Élèves ») | oui (une audience au moins) |
   | Priorité | « Normale » | oui |
   | Publier le | laisser vide (publication immédiate) | non |
   | Expire le | laisser vide | non |
   | Demander un accusé de réception | coché | non |
   | Épingler en tête de liste | coché | non |
3. Cliquer « Compter les destinataires ».
4. Cliquer « Enregistrer le brouillon ». La fiche de l'annonce s'ouvre avec le statut « Brouillon ».
5. Cliquer « Publier maintenant ».
6. Se connecter en Parent : l'annonce est en tête de « Annonces », épinglée, avec « Accusé à donner ».
Résultat attendu : "n destinataire(s)" s'affiche à côté du bouton (n est le nombre de **comptes** joignables, donc petit : probablement 1, le compte Parent ; à vérifier) ; « L'annonce est publiée. » après la publication, statut « Publiée » ; le parent voit l'annonce ; l'élève ne la voit pas (audience « Parents et tuteurs » seulement).
Cas invalides : | Saisie | Message attendu |
|---|---|
| « Titre » vide, puis « Enregistrer le brouillon » | "Ce champ est obligatoire." sous « Titre » |
| « Contenu » vide | "Ce champ est obligatoire." sous « Contenu » |
| Aucune cible ajoutée | "Choisissez au moins une cible." (zone des cibles ; texte d'aide « Aucune cible choisie. ») |
| Décocher toutes les « Personnes visées » | "Choisissez au moins une audience." |
| « Publier le » = demain, « Expire le » = aujourd'hui | "L'expiration doit suivre la publication." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : un Économe tapant `/v2/announcements/new` arrive sur « Accès refusé »

#### 15.15 Programmer une annonce puis la voir expirer (attente de quelques minutes)
Compte : Secrétariat puis Parent · Où : `/v2/announcements/new` · Prérequis : le worker tourne. Heure locale de l'ordinateur utilisée par les champs date-heure.
1. « Nouvelle annonce ». Titre `Annonce programmée test guide`, contenu `Annonce de contrôle de la programmation. (test guide)`, cible « Classe » `6E-A`, personnes visées « Parents et tuteurs ». « Publier le » = dans 3 minutes ; « Expire le » = dans 8 minutes.
2. Le bouton principal s'appelle maintenant « Programmer la publication ». Le cliquer.
3. Sur la fiche, vérifier le statut « Programmée ».
4. Attendre l'heure de publication (+ 1 minute) et recharger : le statut devient « Publiée ». En Parent, l'annonce est visible.
5. Attendre l'heure d'expiration, recharger côté Parent : elle disparaît ; cocher « Afficher les annonces expirées » : elle réapparaît avec le badge « Expirée ».
Résultat attendu : statut « Programmée » puis « Publiée » (tâche exécutée chaque minute) ; l'expiration est dérivée de la date (aucune tâche n'est nécessaire) ; la fiche indique "Expire le …" tant qu'elle n'est pas expirée. Nettoyage : retirer l'annonce au besoin (15.18).
Cas invalides : | Saisie | Message attendu |
|---|---|
| « Expire le » antérieur à « Publier le » | "L'expiration doit suivre la publication." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : sans objet

#### 15.16 Modifier un brouillon, supprimer un brouillon, contenu figé après publication
Compte : Secrétariat · Où : fiche d'une annonce · Prérequis : 15.14.
1. Créer une annonce brouillon (comme 15.14, sans publier) : titre `Brouillon à modifier test guide`.
2. Sur sa fiche, « Modifier » : changer le titre en `Brouillon modifié test guide` et enregistrer (« Enregistrer le brouillon »).
3. Cliquer « Supprimer le brouillon ».
4. Ouvrir la fiche de l'annonce de 15.14 (publiée) : vérifier l'absence du lien « Modifier » et du bouton « Supprimer le brouillon ».
5. Taper à la main `/v2/announcements/{id}/edit` avec l'identifiant de l'annonce publiée.
Résultat attendu : le brouillon se modifie et se supprime ; sur une annonce publiée, seuls « Retirer l'annonce » et les accusés sont proposés ; l'ouverture directe de la page de modification affiche le formulaire mais l'enregistrement est refusé par l'API : "Une annonce publiée ne change plus de contenu : seuls l'expiration et l'épinglage sont modifiables. Retirez-la et publiez-en une nouvelle."
Cas invalides : | Saisie | Message attendu |
|---|---|
| Enregistrer l'annonce publiée depuis la page de modification (changer le titre) | "Une annonce publiée ne change plus de contenu : seuls l'expiration et l'épinglage sont modifiables. Retirez-la et publiez-en une nouvelle." |
| Secrétariat : ouvrir la page de modification de l'annonce du Directeur et enregistrer | Refus : annonce introuvable pour ce compte (il n'en est ni l'auteur ni gestionnaire) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : un Secrétariat ne modifie pas l'annonce du Directeur

#### 15.17 Enseignant : publier uniquement vers ses classes
Compte : Enseignant · Où : « Annonces » > « Nouvelle annonce » · Prérequis : aucun.
1. Se connecter avec `enseignant@secondaire-test.test`. Ouvrir « Annonces » : l'onglet « Publiées par moi » existe, le bouton « Nouvelle annonce » aussi.
2. « Nouvelle annonce » : dans « Type de cible », vérifier qu'il n'y a qu'un choix, « Classe » ; la liste « Classe » ne contient que ses classes.
3. Titre `Annonce enseignant test guide`, contenu `Rappel : cahier de textes à signer. (test guide)`, cible `6E-A`, personnes visées « Parents et tuteurs », puis « Publier ».
4. Retourner sur le formulaire (nouvelle annonce), cocher en plus l'audience « Personnel », « Publier ».
Résultat attendu : l'annonce vers sa classe et aux parents est publiée ; avec l'audience « Personnel », refus de l'API : "Vous ne pouvez viser que les élèves et les tuteurs de vos classes." Aucune cible « Tout l'établissement », « Campus », « Niveau » ou « Rôle » n'est offerte.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Audience « Personnel » cochée | "Vous ne pouvez viser que les élèves et les tuteurs de vos classes." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : parent et élève sur `/v2/announcements/new` arrivent sur « Accès refusé »

#### 15.18 Retirer une annonce avec un motif
Compte : Secrétariat · Où : fiche de l'annonce `Réunion de classe 6e A test guide` (15.14) · Prérequis : 15.14.
1. Dans « Gestion de l'annonce », cliquer « Retirer l'annonce ». La fenêtre « Retirer cette annonce ? » s'ouvre avec "Elle disparaîtra de la boîte des destinataires. Le retrait est tracé avec son motif."
2. Saisir un motif de 1 ou 2 caractères (`a`) et confirmer.
3. Saisir `Annonce publiée par erreur test guide` dans « Motif du retrait » et confirmer par « Retirer l'annonce ».
4. En Parent, ouvrir « Annonces ».
Résultat attendu : le motif trop court est refusé avec "Le motif doit comporter au moins 3 caractères." ; avec un motif valable, « L'annonce est retirée. » et le statut passe à « Retirée » ; l'annonce disparaît de la boîte du parent ; le bloc de gestion n'offre plus ni « Modifier » ni « Retirer ».
Cas invalides : | Saisie | Message attendu |
|---|---|
| Motif vide | "Le motif doit comporter au moins 3 caractères." |
| Retirer une annonce déjà retirée (second onglet) | "Seule une annonce publiée ou programmée peut être retirée." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : sans objet

#### 15.19 Élève : voir les annonces ciblées « Élèves »
Compte : Secrétariat puis Élève · Où : `/v2/announcements/new` puis « Annonces » · Prérequis : l'élève du compte est inscrit en 6e A (à confirmer, voir l'annexe).
1. Élève : ouvrir « Annonces » avant tout : sur une base neuve, « Aucune annonce pour vous pour le moment. » (le seed vise « Parents et tuteurs » et « Personnel »). Si l'annonce de rentrée apparaît, la base est antérieure au correctif (rapport 13, C-13-04) : le noter.
2. Secrétariat : créer `Annonce élèves test guide` (contenu `Rappel pour les élèves : tenue de sport vendredi. (test guide)`), cible « Classe » `6E-A`, personnes visées « Élèves » seulement, « Publier ».
3. Élève : rouvrir « Annonces ».
Résultat attendu : l'élève voit l'annonce destinée aux élèves de sa classe, sans bouton d'accusé (non demandé) ; il ne voit jamais les annonces « Parents et tuteurs » ni les brouillons ; il n'a ni onglet « Publiées par moi » ni « Nouvelle annonce ».
Cas invalides : | Saisie | Message attendu |
|---|---|
| Élève : `/v2/announcements/new` | Page « Accès refusé » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé pour l'Élève sur la création

## Scénarios : cloche et notifications dans l'application

#### 15.20 Cloche, page Notifications et préférences par catégorie
Compte : Parent · Où : cloche à droite de la barre « Messagerie et annonces », puis « Notifications » (`/v2/messages/notifications`) · Prérequis : 15.8, 15.14 effectués (le parent a reçu une diffusion et une annonce).
1. Sur une page de la section Communication, repérer la cloche à droite des onglets (bouton rond avec un nombre rouge s'il y a des notifications non lues). Son nom accessible est "Ouvrir les notifications — N notification(s) non lue(s)".
2. Cliquer la cloche : le panneau « Notifications » liste les cinq dernières ; boutons « Tout marquer comme lu » (si N > 0) et « Tout voir ». Sans notification : « Aucune notification. »
3. Cliquer « Tout voir » : la page « Notifications » (description "Les alertes de votre messagerie : nouveaux messages, annonces, informations de l'établissement.") affiche « Mes notifications » avec les catégories « Messages », « Annonces », « Alertes automatiques ».
4. Cocher « Non lues seulement » ; cliquer « Marquer comme lue » sur une ligne ; puis « Tout marquer comme lu ».
5. Dans « Préférences de notification », pour la catégorie « Annonces » : décocher « Notifications dans l'application », cocher « E-mail », renseigner « Ne pas me notifier avant le » avec la date de demain, puis « Enregistrer mes préférences ».
6. Recharger : les valeurs sont conservées. Remettre « Notifications dans l'application » coché, vider la date, enregistrer.
Résultat attendu : le compteur diminue à chaque action et atteint zéro ; « Aucune notification non lue. » avec le filtre ; « Vos préférences sont enregistrées. » après enregistrement ; le texte d'aide dit "Les annonces urgentes et les décisions de modération vous sont toujours signalées dans l'application." La cloche se rafraîchit toutes les 30 secondes environ. **La cloche n'existe que dans la section Communication** (pas dans l'en-tête des autres modules).
Cas invalides : | Saisie | Message attendu |
|---|---|
| Page sans aucune notification | « Aucune notification. » |
| Filtre « Non lues seulement » sans notification non lue | « Aucune notification non lue. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : un compte sans droit de lecture de la messagerie ne voit pas la cloche

## Scénarios : signalement, modération et réglages

#### 15.21 Signaler un message
Compte : Enseignant · Où : fil "Question sur le devoir test guide" · Prérequis : 15.4 ; il faut un message du **parent** (créer au besoin `Deuxième message du parent test guide` depuis le compte Parent dans ce fil).
1. Enseignant : ouvrir le fil. Sous le message du parent, cliquer « Signaler ».
2. Dans la fenêtre « Signaler ce message » (rappel : "La modération de l'établissement examinera ce message. L'auteur n'est pas informé de votre signalement."), laisser « Motif » = « Contenu inapproprié » ou choisir « Message indésirable ».
3. Dans « Précisions » (1 000 caractères au plus), saisir `Signalement de contrôle test guide`.
4. Cliquer « Signaler ».
5. Recommencer sur un second message du parent avec le motif « Autre motif ».
Résultat attendu : « Merci : votre signalement a été transmis à la modération. » ; le bouton « Signaler » n'existe pas sur les messages de l'enseignant lui-même. Les cinq motifs proposés sont « Message indésirable », « Harcèlement ou propos injurieux », « Contenu inapproprié », « Atteinte à la vie privée », « Autre motif ».
Cas invalides : | Saisie | Message attendu |
|---|---|
| Signaler deux fois le même message | Message d'erreur de l'API sous le formulaire (code `messaging.already_reported`, texte à relever en test) |
| « Précisions » de plus de 1 000 caractères | Saisie plafonnée par le champ |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : « Signaler » absent sur son propre message

#### 15.22 Directeur : traiter les signalements (rejeter, puis sanctionner avec restriction d'envoi)
Compte : Directeur · Où : menu « Modules » > « Communication » > « Modération des messages » (`/v2/messages/moderation`) · Prérequis : 15.21 (deux signalements). Si une fenêtre « Confirmez votre identité » s'affiche, saisir le code du moment (voir l'annexe) ; un code déjà utilisé est refusé.
1. Ouvrir « Modération des messages » (description "Signalements des participants, restrictions d'envoi et supervision motivée des conversations."). Trois onglets : « Signalements », « Restrictions », « Supervision ». La case « Signalements à traiter seulement » est cochée.
2. Sur la première ligne (« Message indésirable » ou le motif choisi, badge « À traiter »), cliquer « Examiner ». La fenêtre « Examen d'un signalement » affiche le message signalé et ses voisins avec leur contenu réel ("Cette lecture est tracée.").
3. Choisir « Rejeter le signalement » ; laisser le motif vide ; cliquer « Confirmer la décision » ; puis saisir `Pas de manquement constaté test guide` et confirmer.
4. Sur la seconde ligne, « Examiner » : choisir « Sanctionner », cocher « Retirer le message » (déjà coché) et « Restreindre l'envoi de l'auteur » avec la durée "1 jour" ; motif `Contenu inapproprié test guide` ; « Confirmer la décision ».
5. Onglet « Restrictions » : le parent y figure avec "Jusqu'au …".
6. En Parent : ouvrir « Messages » ; essayer « Nouveau message ».
7. Retour au Directeur, onglet « Restrictions » : cliquer « Lever la restriction ».
Résultat attendu : motif vide refusé avec « Le motif de la décision est obligatoire (3 caractères au moins). » ; « Décision enregistrée. » ; la première ligne passe à « Rejeté », la seconde à « Sanctionné » ; dans le fil, le message sanctionné devient « Message retiré par la modération » chez tout le monde ; le parent restreint voit « Votre envoi de messages est temporairement restreint par l'établissement. Vous pouvez toujours lire vos messages. » et l'écran « Nouveau message » le répète ; après « Lever la restriction », tout redevient normal et l'onglet affiche « Aucune restriction en cours. ». L'auteur n'est jamais informé du signalement.
Cas invalides : | Saisie | Message attendu |
|---|---|
| « Confirmer la décision » sans motif | « Le motif de la décision est obligatoire (3 caractères au moins). » |
| « Sanctionner » en décochant « Retirer le message » et « Restreindre l'envoi de l'auteur » | « Précisez l'action : retirer le message et/ou restreindre l'auteur. » |
| Ouvrir avec « Consulter » un signalement déjà traité (case « Signalements à traiter seulement » décochée) | Pas de formulaire de décision : le texte "Signalement déjà traité." suivi de la note saisie |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : un Enseignant ou un Parent tapant `/v2/messages/moderation` arrive sur « Accès refusé »

#### 15.23 Directeur : supervision motivée d'une conversation
Compte : Directeur · Où : « Modération des messages » > « Supervision » · Prérequis : 15.4.
1. Onglet « Supervision » : lire "La lecture du contenu d'une conversation exige un motif ; chaque lecture est enregistrée dans le journal d'audit."
2. Dans le champ "Rechercher par objet ou par personne", saisir `Question sur le devoir`.
3. Cliquer « Lire avec un motif » sur la conversation. Dans la fenêtre « Lire cette conversation », saisir `x` puis valider.
4. Saisir `Contrôle de la procédure test guide` dans « Motif de la consultation » et cliquer « Lire la conversation ».
5. Lire la fenêtre (description « Lecture seule : les messages retirés restent visibles pour la supervision. »), la fermer.
6. Ouvrir le journal d'audit (`/v2/audit`) et chercher la lecture.
Résultat attendu : le motif d'un caractère est refusé ("Le motif doit comporter au moins 3 caractères.") ; avec un motif valable, le contenu s'affiche en lecture seule avec le texte réel des messages retirés ; une entrée d'audit est créée (à vérifier dans le journal du chapitre Journal d'audit).
Cas invalides : | Saisie | Message attendu |
|---|---|
| Recherche sans résultat | « Aucune conversation. » |
| Motif de 2 caractères | "Le motif doit comporter au moins 3 caractères." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : seul le Directeur et le Propriétaire voient l'onglet « Supervision »

#### 15.24 Réglages : politique de messagerie des élèves
Compte : Propriétaire puis Élève · Où : menu « Modules » > « Communication » > « Paramètres de la messagerie » (`/v2/messages/settings`) · Prérequis : aucun. Noter la valeur d'origine pour la rétablir.
1. Propriétaire : ouvrir « Paramètres de la messagerie » (description "Règles d'usage de la messagerie de l'établissement : élèves, contacts de l'administration, pièces jointes, limites d'envoi."). Lire « Messagerie des élèves » (défaut : « Ils peuvent écrire à leurs enseignants et à l'administration »).
2. Choisir « Désactivée : les élèves n'écrivent pas » et cliquer « Enregistrer les paramètres » : « Paramètres enregistrés. »
3. Élève : ouvrir « Messages » (les conversations existantes restent lisibles), puis « Nouveau message ».
4. Propriétaire : choisir « Réponses seulement : ils répondent à ceux qui leur écrivent », enregistrer. Élève : constater qu'il ne peut toujours pas ouvrir de conversation mais peut répondre à un fil où un enseignant lui a écrit (si un tel fil existe).
5. Propriétaire : choisir « Ils peuvent écrire à leurs enseignants » puis, en fin de scénario, remettre « Ils peuvent écrire à leurs enseignants et à l'administration » et enregistrer.
Résultat attendu : avec « Désactivée », l'élève n'a plus le bouton « Nouveau message » et `/v2/messages/new` affiche « Vous ne pouvez pas envoyer de message pour le moment. » ; il ne peut plus répondre ("La messagerie des élèves est désactivée par l'établissement.") ; avec "Réponses seulement : ils répondent à ceux qui leur écrivent", il répond mais n'ouvre pas de conversation ; avec « Ils peuvent écrire à leurs enseignants », seuls les enseignants sont proposés. Chaque enregistrement affiche « Paramètres enregistrés. ».
Cas invalides : | Saisie | Message attendu |
|---|---|
| Élève, politique « Désactivée », tentative d'écrire | « Vous ne pouvez pas envoyer de message pour le moment. » |
| Élève, politique « Désactivée », réponse dans un fil | "La messagerie des élèves est désactivée par l'établissement." |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : Directeur des études et Secrétariat arrivent sur « Accès refusé » à `/v2/messages/settings`

#### 15.25 Réglages : plafonds, pièces jointes, contacts d'administration et messages automatiques
Compte : Propriétaire · Où : `/v2/messages/settings` · Prérequis : 15.24. Noter toutes les valeurs d'origine.
1. Remplir (puis rétablir) :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Rôles des contacts de l'administration | `directeur, secretariat` (clés séparées par des virgules ; valeur d'origine) | non |
   | Autoriser les pièces jointes | coché | non |
   | Taille maximale (Mo) | `2` | oui |
   | Messages par heure et par utilisateur | `120` (bornes 1 à 10000) | oui |
   | Nouvelles conversations par jour et par utilisateur | `30` (1 à 10000) | oui |
   | Participants d'un message de groupe | `200` (2 à 5000) | oui |
   | Destinataires d'une diffusion ou d'une annonce | `5000` (2 à 20000) | oui |
   | Longueur maximale d'un message (caractères) | `5000` (100 à 20000) | oui |
   | Pièces jointes par message | `5` (1 à 20) | oui |
   | Conservation des notifications lues (jours) | `90` (7 à 3650) | oui |
   | Parents : écrire aux enseignants de l'année précédente pendant (jours, 0 = fermé) | `90` (0 à 366) | oui |
2. Cliquer « Enregistrer les paramètres » ; recharger : valeurs conservées.
3. Dans la zone « Messages automatiques », carte « Absence d'un élève » : décocher puis cocher « Envoyer ce message automatiquement » ; modifier « Titre » en `Absence de {{studentName}} test guide` ; garder les variables `{{studentName}}` et `{{date}}` (aide sous « Texte » : "Variables disponibles : {{studentName}} {{date}}") ; cliquer « Enregistrer ce message » : « Message enregistré. » et badge « Personnalisé ». Remettre le titre d'origine `Absence de {{studentName}}`. La carte « Retard d'un élève » est désactivée par défaut.
4. Rétablir la taille maximale d'origine (`5`).
Résultat attendu : « Paramètres enregistrés. » ; le plafond de taille s'applique aussitôt aux pièces jointes (essayer le fichier de 15.6 avec une limite inférieure à 673 octets est impossible : la plus petite taille permise est 0,001 Mo, soit environ 1 Ko).
Cas invalides : | Saisie | Message attendu |
|---|---|
| Taille maximale `100` | « La taille maximale doit être comprise entre 0,001 et 25 Mo. » |
| Participants d'un groupe `300` avec destinataires d'une diffusion `200` | « Le plafond d'un groupe ne peut pas dépasser celui d'une diffusion. » |
| Taille maximale vide ou `abc` | « La taille maximale doit être comprise entre 0,001 et 25 Mo. » |
| Messages par heure `0` | Refus de l'API (message de bornes à relever en test) ; la case reçoit l'indication « Entre 1 et 10000. » |
| Texte d'un message automatique vidé | Refus de l'API (texte 1 à 2000 caractères ; message à relever en test) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : seul Propriétaire et Directeur ouvrent la page

## Scénarios : module Notifications

#### 15.26 Journal des envois : lecture, statistiques et filtres
Compte : Propriétaire (ou Directeur) · Où : menu « Notifications » > "Journal des notifications" (`/v2/notifications`), onglet « Journal des envois » · Prérequis : le seed a produit des envois (candidatures, alertes…). Ouvrir après 15.27 pour voir les lignes créées.
1. Ouvrir « Journal des envois » (description : "Chaque message envoyé par e-mail, SMS, WhatsApp, notification push ou dans l'application. Les adresses sont masquées et le contenu des messages n'est pas conservé.").
2. Au-dessus de la liste, cliquer les boutons "1 j", "7 j", "30 j" : la répartition par statut (puces « Envoyé », « Simulé », « Échec », « Non envoyé »…) et par canal change.
3. Avec les filtres : choisir « Canal » = « E-mail », « Statut » = « Simulé » (ou « Échec »), « Catégorie » = « Annonces », puis les dates « Du » / « Au » (aujourd'hui).
4. Lire une ligne : badge de statut, canal, date ; « Destinataire : » (adresse masquée) ; « Gabarit : » code et version (par exemple convocation (version 0)) ; « Origine : » ; « Tentatives : » ; « Non envoyé : » avec la raison quand le statut est « Non envoyé ».
5. Charger la suite avec « Voir plus ».
6. Lien avec les annonces (facultatif) : en Secrétariat, créer comme en 15.14 l'annonce `Annonce importante test guide` (cible `6E-A`, « Parents et tuteurs », **priorité « Élevée »**) et la publier ; au bout d'une minute, chercher dans le journal une ligne d'origine « Événement » (règle livrée "Annonce importante : relayer par e-mail et push", gabarit "announcement", canaux « E-mail » et « Notification push »). Ne pas utiliser la priorité « Urgente » : elle déclenche aussi SMS et WhatsApp et ignore les heures calmes.
Résultat attendu : aucune adresse complète ni numéro complet n'est visible ; aucun contenu de message ; les statuts possibles sont « En attente », « En cours d'envoi », « Envoyé », « Remis », « Échec », « Rejeté », « Non envoyé », « Annulé », « Simulé » ; les envois sans coordonnée sont « Non envoyé : aucune coordonnée. » ; **aucun statut « Envoyé » ne doit provenir d'un vrai fournisseur** (voir 15.31). Une erreur de gabarit "template_error" sur le gabarit `analytics_alert` (variable `appUrl` refusée) était un défaut corrigé (rapport 02, C-02-02) : elle ne doit plus apparaître sur les nouvelles alertes.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Filtres sans résultat (statut « Remis » avec la période du jour) | « Aucun envoi ne correspond » avec l'invitation à modifier ou retirer des filtres |
| Aucun envoi du tout (établissement neuf) | « Aucun envoi pour le moment » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : Parent et Enseignant tapant `/v2/notifications` arrivent sur « Accès refusé »

#### 15.27 Envoyer une convocation (envoi manuel, statut « Simulé »)
Compte : Secrétariat · Où : onglet « Envoyer » (`/v2/notifications/send`) · Prérequis : aucun. Date de rendez-vous : une date future (par exemple `2026-10-15`).
1. Se connecter avec `secretariat@secondaire-test.test`. Ouvrir « Envoyer » (titre « Envoyer un message »).
2. Remplir le formulaire « Envoi d'un message » :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Type de message | "Convocation" (liste : "Convocation", "Annonce", "Avis urgent", "Convocation (vie scolaire)", "Décision de vie scolaire notifiée") | oui |
   | Choisir par | « Élèves (leurs parents et tuteurs) » | oui |
   | Ajouter un élève | `Nadia` puis choisir DIABATE Nadia (puce sous « Élèves choisis ») | oui (un élève au moins) |
   | Responsables financiers d'abord | décoché | non |
   | Canaux | cocher « Application » et « E-mail » (un canal marqué « indisponible » ne se coche pas) | oui (un canal au moins) |
   | Stratégie d'envoi | « Tous les canaux choisis » (autre choix : « Premier canal joignable ») | oui |
   | Objet de la convocation | `Entretien avec la direction test guide` | oui |
   | Date | `2026-10-15` | oui |
   | Heure | `09:30` | oui |
   | Lieu | `Bureau du directeur` | oui |
   | Élève concerné | laisser vide (rempli automatiquement avec le nom de l'élève) | non |
   | Précision | `Merci de vous munir du carnet de correspondance. (test guide)` | non |
3. Cliquer « Vérifier avant l'envoi ». Dans la fenêtre « Confirmer l'envoi », lire : "Message : …", "Canaux : Application, E-mail", "Destinataires : les parents et tuteurs des élèves choisis" ; cliquer « Envoyer maintenant ».
4. Ouvrir « Journal des envois » après quelques secondes (jusqu'à une minute) et recharger.
Résultat attendu : « Message mis en file : 1 destinataire(s), 2 envoi(s), 0 ignoré(s). » (les nombres exacts dépendent des coordonnées et canaux disponibles : à vérifier) ; dans le journal : une ligne « Application » (envoi réel dans l'application, visible à la cloche du parent, catégorie « Annonces ») et une ligne « E-mail » au statut « Simulé » (ou « Échec » / « Non envoyé : » si le canal n'est pas configuré), origine « Envoi manuel », gabarit "convocation" version 0. **Aucun e-mail réel n'est reçu.** Un envoi urgent est impossible ici (15.28).
Cas invalides : | Saisie | Message attendu |
|---|---|
| Aucun canal coché | « Choisissez au moins un canal. » |
| Aucun élève choisi | « Choisissez au moins un élève. » |
| Champ "Objet de la convocation" vide | Renseignez "Objet de la convocation". (dans l'écran, le nom du champ est entouré de guillemets français) |
| « Date » vide | Renseignez "Date". |
| Audience « Rôles du personnel » avec `Secrétariat` (majuscule, accent) | « Indiquez au moins un rôle valide : minuscules, chiffres et tirets bas. » |
| Audience « Classes » sans classe ajoutée | « Choisissez au moins une classe. » |
| Audience « Classes » avec la classe `6E-A` mais toutes les cases (« Parents et tuteurs », « Élèves », « Enseignants ») décochées | « Choisissez au moins une catégorie de destinataires. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : Économe et Enseignant tapant `/v2/notifications/send` arrivent sur « Accès refusé »

#### 15.28 Avis urgent : réservé à la direction
Compte : Propriétaire puis Secrétariat · Où : `/v2/notifications/send` · Prérequis : 15.27. **Action sensible** : l'avis urgent ignore les heures calmes et les préférences de catégorie des destinataires ; il est audité.
1. Propriétaire : « Envoyer ». Choisir "Avis urgent" dans « Type de message ». Lire la case "Message urgent : ignore les heures calmes et les préférences de catégorie. À réserver aux situations qui l'exigent." (visible pour Propriétaire et Directeur seulement).
2. « Choisir par » = « Élèves (leurs parents et tuteurs) » ; élève DIABATE Nadia ; canal « Application » ; « Objet » = `Avis urgent test guide` ; « Message » = `Test de procédure : ne pas tenir compte de cet avis. (test guide)`.
3. « Vérifier avant l'envoi » : la fenêtre « Confirmer l'envoi » affiche en rouge « Envoi urgent » et la phrase « Message urgent : il ignore les heures calmes et les préférences des destinataires. ». Si « Confirmez votre identité » apparaît, saisir le code du moment. « Envoyer maintenant ».
4. Journal : la ligne porte le badge « Urgent ». Parent : la cloche reçoit l'alerte même avec des heures calmes actives.
5. Secrétariat : « Envoyer » ; choisir "Avis urgent" ; remplir les mêmes champs ; « Vérifier avant l'envoi » puis « Envoyer maintenant ».
Résultat attendu : pour le Propriétaire, message de mise en file et badge « Urgent » dans le journal ; pour le Secrétariat, la case d'urgence n'est **pas** affichée mais le type "Avis urgent" est listé ; l'envoi est refusé par l'API : "L'envoi urgent exige une autorisation spécifique." (le type d'avis urgent est toujours urgent).
Cas invalides : | Saisie | Message attendu |
|---|---|
| Secrétariat, type "Avis urgent" | "L'envoi urgent exige une autorisation spécifique." |
| Avis urgent sans « Message » | Renseignez "Message". |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : Secrétariat, Directeur des études, Économe sans case d'urgence

#### 15.29 Gabarits : aperçu, variables, nouvelle version, désactivation, retour au gabarit livré
Compte : Directeur des études (lecture) puis Propriétaire (édition) · Où : onglet « Gabarits » (`/v2/notifications/templates`) · Prérequis : aucun. **Chaque publication crée une version immuable : nettoyer par « Revenir au gabarit livré ».**
1. Directeur des études : ouvrir « Gabarits » (titre « Gabarits de messages »). Choisir dans la liste « Message » l'entrée "Convocation", onglet « E-mail » : les champs sont grisés (lecture seule), le badge dit « Gabarit livré », « Activé ». Cliquer « Aperçu » : le cadre "Aperçu avec des valeurs d'exemple" apparaît ; passer à l'onglet « SMS » et cliquer « Aperçu » : "Estimation : n segment(s) SMS."
2. Propriétaire : même écran, "Convocation", onglet « E-mail ». Remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Objet | `Convocation : {{subject}} (test guide)` | oui pour e-mail, notification sur le téléphone, application ; interdit pour SMS et WhatsApp |
   | Texte du message | `Bonjour, vous êtes convoqué(e) le {{date}} à {{time}}. Lieu : {{place}}. Objet : {{subject}}. Texte de contrôle test guide.` | oui |
   | Note de version | `Version test guide` | non |
   Pour insérer une variable à la position du curseur, cliquer son bouton dans « Variables » (`{{subject}}*`, `{{date}}*`, `{{time}}*`, `{{place}}*`, `{{studentName}}`, `{{note}}` ; l'astérisque marque une variable toujours renseignée ; `{{schoolName}}` et `{{appUrl}}` sont fournies par la plateforme).
3. Cliquer « Aperçu » (valeurs d'exemple), puis « Publier une nouvelle version » : « Version 1 publiée et activée. » Dans « Versions », la version 1 porte « Active ».
4. Cliquer « Désactiver ce gabarit » : « Gabarit désactivé. » et l'avertissement "Ce gabarit est désactivé : aucun message de ce type n'est envoyé sur ce canal." ; puis « Activer ce gabarit » : « Gabarit activé. ».
5. Cliquer « Revenir au gabarit livré » : « Gabarit livré rétabli. » ; le badge redevient « Gabarit livré ».
Résultat attendu : les messages ci-dessus ; l'historique conserve la version 1 (non supprimable) ; l'aperçu e-mail est affiché dans un cadre isolé (aucun script) avec un pied de page de conformité.
Cas invalides : | Saisie | Message attendu |
|---|---|
| « Texte du message » vide | « Le texte du message est obligatoire. » |
| « Objet » vide sur le canal « E-mail » | « L'objet est obligatoire pour ce canal. » |
| Variable inconnue : `Bonjour {{zzz}}` | "La variable zzz n'existe pas pour ce gabarit." (le message réel entoure le nom de guillemets français) |
| Accolades non fermées : `Bonjour {{date` | "Gabarit (corps) : …" suivi d'une explication de syntaxe (texte à relever en test) |
| Objet saisi sur « SMS » | Le champ « Objet » n'existe pas pour ce canal |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : Directeur des études voit le formulaire désactivé et sans « Publier une nouvelle version »

#### 15.30 Règles de notification : lire, modifier, rétablir
Compte : Directeur des études (lecture) puis Propriétaire · Où : onglet « Règles » (`/v2/notifications/rules`) · Prérequis : aucun. **Restaurer à la fin.**
1. Directeur des études : ouvrir « Règles » (titre « Règles de notification »). Repérer les trois familles « Événements », « Alertes », « Relances d'impayés » avec leurs aides, et pour chaque règle : badges « Active » ou « Désactivée », « Livrée », éventuellement « Urgente » ; lignes « Destinataires : », « Canaux : », « Gabarit : », « Seuils : ». Aucun bouton « Modifier » n'est proposé.
2. Propriétaire : sur la règle "Relances d'impayés (J+7, J+21, J+45)", cliquer « Modifier » (fenêtre « Modifier la règle »).
3. Dans la zone « Seuils », champ « Paliers de relance (jours de retard) », saisir successivement `10, 5`, `abc`, `5, 10, 20, 30, 40, 50, 60`, en cliquant « Enregistrer la règle » à chaque fois, puis `7, 21, 45` (valeur d'origine) sans rien changer d'autre.
4. Sur la règle "Cours annulé : prévenir les enseignants de la classe" (désactivée par défaut), « Modifier », cocher « Règle active », « Enregistrer la règle » : « Règle enregistrée. » ; le badge devient « Modifiée » ; rouvrir « Modifier » et cliquer « Rétablir la règle livrée » : « Règle livrée rétablie. ».
Résultat attendu : les messages ci-dessous pour les saisies invalides ; « Règle enregistrée. » pour une saisie valide ; la règle rétablie redevient « Livrée » et « Désactivée ». Les règles de vie scolaire et d'admission sont désactivées par défaut (choix documenté : elles doubleraient d'autres messages).
Cas invalides : | Saisie | Message attendu |
|---|---|
| Paliers `10, 5` | « Les paliers doivent être strictement croissants. » |
| Paliers `abc` | « Indiquez un à six paliers, en nombres entiers de jours. » |
| Sept paliers | « Indiquez un à six paliers, en nombres entiers de jours. » |
| Aucun canal coché | « Choisissez au moins un canal. » |
| Paliers vides | « Indiquez un à six paliers, en nombres entiers de jours. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : Directeur des études sans bouton « Modifier »

#### 15.31 Canaux d'envoi : état, essai, réglages
Compte : Secrétariat (lecture) puis Propriétaire · Où : menu « Notifications » > « Canaux d'envoi » (`/v2/notifications/channels`) · Prérequis : aucun. **Noter les valeurs d'origine ; restaurer.**
1. Secrétariat : ouvrir « Canaux d'envoi » (titre « Canaux d'envoi »). Lire, dans « État des canaux », une carte par canal : « Application », « E-mail », « SMS », « WhatsApp », « Notification push » avec le badge « Opérationnel », « Dégradé », « Non configuré » ou « Désactivé », « Fournisseur : … » ou « Aucun fournisseur branché. », « 24 dernières heures », « En attente », « Plafond du jour ». Lire s'il existe le bandeau "Mode simulation actif : aucun message n'est réellement envoyé. Ce mode est réservé au développement." Le formulaire « Réglages de l'établissement » est en lecture seule avec "Vous pouvez consulter ces réglages ; leur modification demande une autre permission."
2. Propriétaire : sur la carte d'un canal opérationnel (au moins « Application »), cliquer « Envoyer un essai ». Ouvrir le journal.
3. Dans « Réglages de l'établissement », remplir :
   | Champ (libellé exact) | Valeur à saisir | Obligatoire |
   |---|---|---|
   | Canaux activés | laisser tels quels | oui |
   | Nom de l'expéditeur | `Collège Le Baobab test guide` | non |
   | Adresse de réponse | `contact@exemple.test` | non |
   | Fuseau horaire | laisser | oui |
   | Indicatif téléphonique par défaut | `225` | oui |
   | Heures calmes | cocher « Ne pas envoyer de SMS, WhatsApp ni notification push la nuit », « Début » `20:00`, « Fin » `07:00` | non |
   | Plafond SMS (Plafond …) | `500` | non |
   | Messages par destinataire et par jour | `10` | oui |
   | Consentement SMS | « Implicite » | oui |
   | Tentatives d'envoi | `5` | oui |
   | Conservation du journal (jours) | `90` | oui |
   | Mention légale des e-mails | `Message de test guide.` | non |
4. « Enregistrer les réglages » : « Réglages enregistrés. » Puis remettre « Nom de l'expéditeur », « Adresse de réponse » et la mention légale à leur valeur d'origine (vide).
Résultat attendu : « Essai en file : 1 message(s), 0 ignoré(s). Consultez le journal des envois. » ; dans le journal, une ligne d'origine « Essai » adressée à soi-même ; si tous les canaux externes sont non configurés, le bouton « Envoyer un essai » est grisé pour eux ; **vérifier qu'aucun message réel n'arrive** ; « Réglages enregistrés. »
Cas invalides : | Saisie | Message attendu |
|---|---|
| Indicatif `22a5` | « L'indicatif doit comporter de 1 à 4 chiffres. » |
| Heures calmes : « Début » vide | « Les heures doivent être au format HH:MM. » |
| Adresse de réponse `pas-un-mail` | « L'adresse de réponse n'est pas valide. » |
| Plafond SMS `-5` | « Un plafond doit être un nombre entier positif. » |
| Messages par destinataire `0` | « Le plafond par destinataire doit être compris entre 1 et 500. » |
| Tentatives `11` | « Le nombre de tentatives doit être compris entre 1 et 10. » |
| Conservation `3` | « La conservation doit être comprise entre 7 et 3650 jours. » |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : Parent tapant `/v2/notifications/channels` arrive sur « Accès refusé »

#### 15.32 Mes notifications : canaux, catégories, heures calmes, effet sur un envoi
Compte : Parent puis Secrétariat · Où : menu « Mon compte » > « Mes notifications » (`/v2/account/notifications`), ou onglet « Mes préférences » · Prérequis : 15.27.
1. Parent : lire « Canaux et catégories » ("Chaque case est enregistrée dès que vous la modifiez."). Pour chaque canal, un badge « Actif par défaut » ou « Sur accord » ; un canal non proposé affiche "Ce canal n'est pas disponible dans votre établissement."
2. Sur le canal « SMS » (ou « E-mail »), décocher la case "Recevoir des messages par SMS" : l'étiquette passe à « Désactivé » et la liste des catégories disparaît ; recocher : « Activé » et les catégories reviennent (« Présences », « Finances », « Résultats », « Emploi du temps », « Annonces », « Alertes », « Urgences »). À chaque changement : « Préférence enregistrée. »
3. Dans « Heures calmes » : décocher « Utiliser les heures calmes de l'établissement », cocher « Activer mes heures calmes », « Début » `21:00`, « Fin » `06:00`, puis « Enregistrer les heures calmes ».
4. Lire le texte "Heures calmes de l'établissement : de … à …." quand la case héritée est cochée, et la mention sur les messages urgents.
5. Lire « Appareils pour les notifications push » : "Les notifications push ne sont pas encore activées pour cet établissement." (si la clé n'est pas configurée) ou le bouton « Activer sur cet appareil ». Ne pas activer.
6. Désactiver le canal « E-mail » du parent. Secrétariat : renvoyer la convocation de 15.27 pour DIABATE Nadia par « E-mail », puis ouvrir le journal.
7. Rétablir : canal « E-mail » activé, « Utiliser les heures calmes de l'établissement » coché, « Enregistrer les heures calmes ».
Résultat attendu : « Préférence enregistrée. » à chaque case ; « Heures calmes enregistrées. » ; à l'envoi, la ligne « E-mail » du parent n'est pas « Simulé » mais « Non envoyé : consentement retiré. » ou « Non envoyé : catégorie refusée par la personne. » (motif exact à relever) ; la ligne « Application » reste remise.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Heures calmes avec « Début » vidé | « Les heures doivent être au format HH:MM. » |
| Secrétariat tapant `/v2/account/notifications` | Page « Accès refusé » (absence de droit personnel, voir Écarts) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : Secrétariat, Économe, Directeur des études sans « Mes préférences »

#### 15.33 Désinscription publique par lien signé
Compte : aucun (page publique, aucune connexion) · Où : `/v2/notifications/unsubscribe` · Prérequis : navigateur sans session ou fenêtre privée.
1. Ouvrir `http://localhost:3000/v2/notifications/unsubscribe` sans aucun paramètre.
2. Ouvrir la même adresse avec un paramètre inventé : `?t=lien-invalide-test-guide` ajouté à la fin.
3. Vérifier la page : titre « Préférences de notification », aucune navigation, aucune connexion demandée.
Résultat attendu : étape 1 : « Ce lien n'est pas valide. Utilisez le lien reçu dans le message. » ; étape 2 : un message d'erreur de l'API ("Lien de désinscription invalide ou expiré.") ; **aucune désinscription n'est appliquée** par la simple ouverture d'un lien (le bouton « Me désinscrire » n'existe que pour un lien signé valide). Un lien valide demande "Voulez-vous ne plus recevoir de messages par e-mail ?" (le canal est nommé) avec la note "Vous pourrez vous réabonner à tout moment depuis votre compte. Les avis urgents peuvent encore vous parvenir.", puis confirme par "C'est fait : vous ne recevrez plus de messages par e-mail." (non testable ici).
Cas invalides : | Saisie | Message attendu |
|---|---|
| Aucun paramètre `t` | « Ce lien n'est pas valide. Utilisez le lien reçu dans le message. » |
| Paramètre `t` falsifié | "Lien de désinscription invalide ou expiré." (à relever) |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : sans objet (page publique)

#### 15.34 Droits : adresses tapées à la main par rôle
Compte : voir chaque ligne · Où : barre d'adresse · Prérequis : sessions ouvertes séparément (une fenêtre privée par compte).
1. Pour chaque ligne, se connecter puis taper l'adresse.
   | Compte | Adresse | Résultat attendu |
   |---|---|---|
   | Parent | `/v2/messages/moderation` | « Accès refusé » |
   | Parent | `/v2/messages/settings` | « Accès refusé » |
   | Parent | `/v2/notifications` | « Accès refusé » |
   | Parent | `/v2/notifications/send` | « Accès refusé » |
   | Parent | `/v2/announcements/new` | « Accès refusé » |
   | Élève | `/v2/notifications/templates` | « Accès refusé » |
   | Élève | `/v2/announcements/new` | « Accès refusé » |
   | Enseignant | `/v2/messages/settings` | « Accès refusé » |
   | Enseignant | `/v2/notifications/rules` | « Accès refusé » |
   | Économe | `/v2/notifications/send` | « Accès refusé » |
   | Économe | `/v2/announcements/new` | « Accès refusé » |
   | Secrétariat | `/v2/messages/moderation` | « Accès refusé » |
   | Directeur des études | `/v2/messages/settings` | « Accès refusé » |
   | Parent | conversation d'un autre (identifiant d'un fil du Directeur) `/v2/messages/{id}` | Message d'erreur "introuvable" ou équivalent, aucune donnée visible (à relever) |
   | Aucun (déconnecté) | `/v2/messages` | Redirection vers `/login` |
Résultat attendu : toutes les lignes de pages de gestion arrivent sur « Accès refusé » (texte "Vous n'avez pas les droits nécessaires pour afficher cette page.") sans contenu de la page cible ; la ligne du fil d'un autre utilisateur n'affiche aucun message du fil.
Cas invalides : | Saisie | Message attendu |
|---|---|
| `/v2/messages/pas-un-identifiant` | Erreur de chargement lisible (message à relever) ; aucune donnée |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : toutes les lignes ci-dessus

#### 15.35 Isolation entre établissements
Compte : Parent du primaire · Où : `/v2/announcements` · Prérequis : 15.12 effectué côté secondaire.
1. Se connecter sur l'établissement École primaire Les Palmiers avec `parent@primaire-test.test`. Ouvrir « Annonces ».
2. Repérer "Rentrée : réunion d'information des parents (démonstration)" de **cet** établissement : badge « Accusé à donner » toujours présent (l'accusé de 15.12 n'a été donné que dans le Collège Le Baobab).
3. Ouvrir « Messages » : la boîte ne contient aucune conversation du Collège Le Baobab.
Résultat attendu : annonces, messages, accusés et notifications sont propres à chaque établissement ; aucune donnée croisée.
Cas invalides : | Saisie | Message attendu |
|---|---|
| Ouvrir avec la session du primaire l'adresse d'une conversation du secondaire | Erreur "introuvable" ou refus, aucune donnée |
- [ ] Cas nominal  - [ ] Cas invalide  - [ ] Droit refusé : accès croisé impossible

## Données créées

(Aussi reprises dans `_annexe-fragments/15-messagerie.md`.)

| Enregistrement | Type | Scénario | Établissement |
|---|---|---|---|
| Conversation "Question sur le devoir test guide" (parent ↔ TRAORE Kouadio) + réponse | Message direct | 15.2, 15.4 | Collège Le Baobab |
| Conversation "Pièce jointe test guide" (+ pièce `ch15-piece-jointe-test-guide.pdf`) | Message direct | 15.6, 15.7 | Collège Le Baobab |
| "Diffusion 6e A test guide" (+ réponse du parent) | Diffusion | 15.8 | Collège Le Baobab |
| "Groupe pédagogique test guide" | Message de groupe | 15.9 | Collège Le Baobab |
| Annonces "Réunion de classe 6e A test guide", "Annonce programmée test guide", "Brouillon à modifier test guide" (supprimé), "Annonce enseignant test guide", "Annonce élèves test guide", "Annonce importante test guide" | Annonces | 15.14 à 15.19, 15.26 | Collège Le Baobab |
| Accusé de réception de DIABATE Séka sur "Rentrée : réunion d'information des parents (démonstration)" | Accusé (irréversible) | 15.12 | Collège Le Baobab |
| Signalements de messages du parent (2) et décisions | Modération | 15.21, 15.22 | Collège Le Baobab |
| Restriction d'envoi du parent (levée) | Restriction | 15.22 | Collège Le Baobab |
| Envois "Entretien avec la direction test guide" (convocation) et "Avis urgent test guide" | Notifications du journal | 15.27, 15.28 | Collège Le Baobab |
| Version 1 du gabarit "Convocation" e-mail (note "Version test guide") | Version de gabarit | 15.29 | Collège Le Baobab |

## Écarts constatés

| Écran | Constat | Gravité |
|---|---|---|
| `/v2/messages/new` | Les comptes d'administration sans fiche de personnel (Secrétariat, Économe, Responsable des examens, Chargé d'admissions) ne peuvent pas ouvrir de conversation : message "Vous ne pouvez pas envoyer de message pour le moment." sans dire pourquoi. Rapport 04, C-04-05, verdict "à instruire" (cadrage Q-13 / règles de portée). Lecture du code : la règle R2 exige une fiche de personnel. | Majeur (décision métier en attente) |
| `/v2/messages/new` | Le texte d'aide dit toujours "…à vos enfants, à vos classes ou à l'administration", y compris pour un enseignant ou un élève (rapports 07 C-07-18, 13 C-13-06). Vérifié dans `fr-CI.json`. | Mineur |
| `/v2/announcements/{id}` et édition | Les cibles de type classe, campus, niveau ou établissement scolaire sont affichées par un identifiant partiel ("Classe (01a110ee…)") au lieu du nom (rapport 02, C-02-08, verdict "à planifier"). Vérifié dans le code (`slice(0, 8)`). | Mineur |
| `/v2/announcements` | L'auteur d'une annonce est affiché par son identifiant de connexion ("direction.generale"), pas par son nom (rapport 12, C-12-03). | Mineur |
| `/v2/account/notifications` | Le lien « Mes notifications » est toujours proposé dans le menu « Mon compte », mais les rôles sans permission `notifications.*.manage` (Secrétariat, Économe, Directeur des études, Responsable des examens, Instituteur, Responsable pédagogique) arrivent sur « Accès refusé ». | Mineur |
| `/v2/notifications/send` | Un compte qui peut envoyer mais pas l'urgent voit quand même le type "Avis urgent" dans la liste et n'apprend le refus qu'à l'envoi ("L'envoi urgent exige une autorisation spécifique."). Lecture du code : tous les gabarits "manuels" du catalogue sont proposés. | Mineur |
| Messagerie et notifications | Deux écrans de préférences distincts et incohérents : « Préférences de notification » (`/v2/messages/notifications`, catégories Messages / Annonces / Alertes automatiques, un horodatage de silence) et « Mes notifications » (`/v2/account/notifications`, canaux, catégories Présences / Finances / Résultats…, heures calmes). | Suggestion |
| Cloche | La cloche de notifications n'existe que dans la section Communication de la version 2 (pas dans l'en-tête des autres modules) ; l'ancien guide la plaçait "dans l'en-tête". | Suggestion |
| `/v2/messages/notifications`, cloche | Rapport 07, C-07-17 : page "Aucune notification non lue" alors que la cloche affichait 1. Non reproductible par lecture du code ; à re-tester. | Mineur (à vérifier) |
| Écrans à chargement lent | Messages "non inclus dans l'offre" ou "Établissement inconnu" affichés pendant le chargement des droits sur certains écrans (rapport 02, C-02-03, verdict "à planifier"). | Mineur |
| Annonces | Le nombre de destinataires d'une annonce compte les **comptes** de connexion, pas les élèves de la classe (2 pour une classe de 9 élèves en recette, rapport 02, C-02-08) : à expliquer à l'écran. | Mineur |

## À vérifier en test

- Format exact des adresses masquées dans le journal (par exemple `p***@…`), et libellé du filtre « Catégorie » pour une annonce relayée.
- 15.2 : nom affiché des enfants dans « À propos de l'enfant » (ordre "NOM Prénom" ou "Prénom NOM").
- 15.8 : nombre de destinataires de la diffusion à `6E-A` (comptes parents joignables).
- 15.9 : libellé exact du badge de groupe ("Groupe de n"), le nombre de contacts d'administration selon les rôles `directeur` et `secretariat` présents.
- 15.10 : le Secrétariat peut-il écrire ? (fiche de personnel ou non dans le seed).
- 15.11 : fil système créé par une absence (dépend du chapitre Présences).
- 15.12 : message du second accusé de réception (la route renvoie le conflit ou ignore).
- 15.19 : annonce de rentrée visible ou non par l'élève selon l'âge de la base.
- 15.22 : la décision de modération exige-t-elle le code MFA (fenêtre « Confirmez votre identité ») ?
- 15.24 : comportement exact du choix "Réponses seulement" pour un élève.
- 15.27, 15.28, 15.31 : statuts réels des canaux externes (« Simulé », « Non envoyé », « Échec ») selon la configuration locale ; le bandeau "Mode simulation actif…" n'apparaît que si la simulation est demandée.
- 15.26 (étape 6) : une annonce de priorité Élevée déclenche la règle livrée "Annonce importante : relayer par e-mail et push" (journal, gabarit "announcement") ; "Urgente" déclenche aussi SMS et WhatsApp et ignore les heures calmes : ne pas tester l'urgence d'une annonce sans contrôle des canaux.
- 15.33 : aucun lien signé valide n'est affiché par l'interface en simulation.

## Non couvert / limites connues

- **Écriture à toute famille** (`messaging.send.any_family`, règle R5) : nécessite un rôle personnalisé accordé à un enseignant (chapitre Accès et rôles). À tester : un envoi hors de ses classes est audité (`messaging.message.sent_out_of_scope`), ses classes ne le sont pas. Non couvert ici.
- **Fenêtre "année précédente"** (parents → enseignants de l'année précédente) : exige une année terminée et une inscription précédente ; non couvert.
- **Plafonds d'envoi** (120 messages par heure, 30 nouvelles conversations par jour) : demandent des dizaines d'envois ; non couvert (message de refus à relever si atteint).
- **Notifications push** : exigent des clés VAPID et un navigateur autorisé ; seul l'état « Non configuré » est contrôlé.
- **Canaux réels** (SMTP, Orange SMS, WhatsApp) : jamais testés ; l'objectif est de vérifier qu'aucun envoi réel ne part.
- **Liens signés de désinscription** valides : non obtenables par l'interface ; seul le cas "lien absent ou invalide" est testé.
- **Pièces jointes** : l'ouverture d'un PDF minimal dépend du lecteur du navigateur ; seul le dépôt (type réel, taille, nombre) est contrôlé.
- **Rétention** des messages et notifications (purge quotidienne) : aucune purge visible pendant les tests.
