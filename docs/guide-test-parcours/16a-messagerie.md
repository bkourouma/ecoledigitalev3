[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](15-documents-ged.md) · [Suivant →](16b-messagerie-suite.md)

# Phase 16 — Messagerie, annonces et notifications

Objectif : vérifier la communication de l'établissement — messages directs, de groupe et diffusion, annonces ciblées avec accusé de réception, signalement et modération, puis le module « Notifications » (envois, gabarits, règles, canaux, préférences). **Aucun message réel ne part** : e-mail, SMS, WhatsApp et push sont simulés ou non configurés ; seules les notifications « dans l'application » sont réellement remises.

Précondition : le worker tourne (annonces programmées, remise des notifications toutes les 15 secondes environ). La graine contient deux annonces du directeur ("Rentrée : réunion d'information des parents (démonstration)", publiée, épinglée, avec accusé de réception ; "Brouillon : calendrier des compositions (démonstration)") et **aucune conversation**. Fichiers : `ch15-piece-jointe-*` dans `docs/guide-test/jeux-de-donnees/`.

---

## Étape 290 — Découvrir la boîte de messages vide
👤 **parent** (DIABATE Séka, secondaire-test, `parent@secondaire-test.test`, sans MFA) · fenêtre **B** · 📂 Menu **« Modules »** > **« Communication »** > **« Messages »** (`/v2/messages`)

1. Lire le titre « Messages », le bouton **« Nouveau message »** et la barre d'onglets (**« Messages »**, **« Annonces »**, **« Notifications »**, cloche à droite). Les entrées « Modération » et « Paramètres » n'existent pas pour un parent.
2. Cliquer successivement les dossiers **« Boîte de réception »**, **« Favoris »**, **« Archivés »**, **« Envoyés »**.
3. Dans **« Boîte de réception »**, saisir `zzz` dans la recherche.

✅ « Votre boîte de réception est vide. », « Aucune conversation en favori. », « Aucune conversation archivée. », « Vous n'avez encore rien envoyé. » ; la recherche `zzz` donne « Aucune conversation ne correspond à ce filtre. ».

⚠️ *Test d'erreur* : choisir le bouton radio **« Texte des messages »** et saisir 1 caractère → « Saisissez au moins 2 caractères pour chercher dans vos messages. ».

☐ OK ☐ KO

---

## Étape 291 — Écrire un message direct à l'enseignant
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

## Étape 292 — L'enseignant lit et répond, le parent lit la réponse
👤 **enseignant** (TRAORE Kouadio, `enseignant@secondaire-test.test`, sans MFA), puis **parent** · fenêtre **B** · 📂 **« Messages »** (`/v2/messages`)

1. Enseignant : repérer dans **« Boîte de réception »** la ligne "Question sur le devoir test guide" (expéditeur en gras, pastille, badge « 1 non lu(s) »). L'ouvrir, revenir avec **« Retour »** : le badge a disparu.
2. Rouvrir la conversation. Dans **« Répondre »**, champ « Votre réponse » : `Bonjour, le devoir porte sur les fractions, page 42. (test guide)`, puis **« Envoyer »**.
3. Parent : ouvrir **« Messages »**, ouvrir la conversation (en gras avec badge non lu) et lire la réponse. Dans **« Boîte de réception »**, choisir le radio **« Texte des messages »** et saisir `fractions`.

✅ La lecture se fait à l'ouverture (pas au simple affichage de la liste) ; la réponse arrive chez le parent (bulle à gauche, auteur TRAORE Kouadio) ; la recherche dans le texte trouve la ligne avec un extrait. Le bouton **« Envoyer »** reste grisé tant que la réponse est vide.

☐ OK ☐ KO

---

## Étape 293 — Favori, sourdine et archivage
👤 **parent** · fenêtre **B** · 📂 **« Messages »** > conversation "Question sur le devoir test guide"

1. Dans « Actions sur la conversation », cliquer **« Favori »** (le libellé devient « Retirer des favoris »), puis **« Sourdine »** (le libellé devient « Réactiver les notifications »), puis **« Archiver »** : retour automatique à « Messages ».
2. Ouvrir **« Favoris »** (la conversation y figure, badge « En sourdine »), puis **« Archivés »**, ouvrir la conversation et cliquer **« Désarchiver »**.
3. Remettre **« Retirer des favoris »** et **« Réactiver les notifications »**.

✅ Les dossiers « Favoris », « Archivés » et « Boîte de réception » reflètent chaque action ; la conversation retrouve son état normal en fin d'étape.

☐ OK ☐ KO

---

## Étape 294 — Joindre une pièce, puis retirer son message
👤 **parent** · fenêtre **B** · 📂 **« Messages »** > **« Nouveau message »**

1. Nouveau message à TRAORE Kouadio, objet `Pièce jointe test guide`, message `Voir le document joint. (test guide)`.
2. Cliquer **« Joindre un fichier »** et choisir successivement `ch15-piece-jointe-fausse-test-guide.pdf` (texte renommé en .pdf), `ch15-piece-jointe-vide-test-guide.pdf` (0 octet), puis `ch15-piece-jointe-test-guide.pdf` (PDF valide, 673 octets).
3. **« Envoyer »**, puis dans le fil cliquer sur la pièce jointe.
4. Sous la dernière bulle du parent, cliquer **« Retirer »** (sans confirmation). Rouvrir le fil avec le compte enseignant.

✅ Faux PDF : "ch15-piece-jointe-fausse-test-guide.pdf : Type de fichier non accepté (contrôlé sur le contenu réel du fichier)." ; fichier vide : "ch15-piece-jointe-vide-test-guide.pdf : Le fichier est vide." ; la pièce valide apparaît en puce ("673 o") avec une croix pour la retirer. Après envoi, un clic sur la pièce l'ouvre dans un nouvel onglet. Après **« Retirer »**, la bulle devient « Message retiré par son auteur » chez le parent et l'enseignant ; les boutons « Retirer » et « Signaler » disparaissent de cette bulle.

☐ OK ☐ KO

---

## Étape 295 — Diffuser un message aux parents de la 6e A
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

## Étape 296 — Message de groupe sans réponses, puis quitter le groupe
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

## Étape 297 — Publier une annonce ciblée sur la 6e A
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

## Étape 298 — L'enseignant publie vers ses classes seulement
👤 **enseignant** · fenêtre **B** · 📂 **« Annonces »** > **« Nouvelle annonce »**

1. Constater que « Type de cible » ne propose que **« Classe »** et que la liste ne contient que ses classes.
2. Saisir `Annonce enseignant test guide`, contenu `Rappel : cahier de textes à signer. (test guide)`, cible `6E-A`, personnes visées « Parents et tuteurs », puis **« Publier »**.
3. Refaire une annonce en cochant en plus l'audience « Personnel », **« Publier »**.

✅ L'annonce vers sa classe est publiée. Avec « Personnel » : refus de l'API "Vous ne pouvez viser que les élèves et les tuteurs de vos classes.". Aucune cible « Tout l'établissement », « Campus », « Niveau » ou « Rôle ».

☐ OK ☐ KO

---

## Étape 299 — Annonce destinée aux élèves
👤 **élève** (DIABATE Nadia), puis **secrétariat**, puis **élève** · fenêtres **B** et **A** · 📂 **« Annonces »**

1. Élève : ouvrir **« Annonces »**. Sur une base neuve : « Aucune annonce pour vous pour le moment. » (l'annonce de rentrée vise parents et personnel).
2. Secrétariat : créer `Annonce élèves test guide`, contenu `Rappel pour les élèves : tenue de sport vendredi. (test guide)`, cible « Classe » `6E-A`, personnes visées « Élèves » seulement, **« Publier »**.
3. Élève : rouvrir **« Annonces »**.

✅ L'élève voit `Annonce élèves test guide` sans bouton d'accusé, jamais les annonces « Parents et tuteurs » ni les brouillons ; il n'a ni onglet « Publiées par moi » ni « Nouvelle annonce ».

⚠️ *Écart connu* : sur une base antérieure au correctif C-13-04, l'annonce de rentrée peut être visible de l'élève (donnée de graine périmée, pas une faille).

☐ OK ☐ KO

---

## Étape 300 — Retirer une annonce avec un motif
👤 **secrétariat** · fenêtre **A** · 📂 **« Annonces »** > fiche de `Réunion de classe 6e A test guide` > « Gestion de l'annonce »

1. Cliquer **« Retirer l'annonce »** (fenêtre « Retirer cette annonce ? »).
2. Saisir `a` et confirmer, puis `Annonce publiée par erreur test guide` dans « Motif du retrait » et confirmer par **« Retirer l'annonce »**.
3. Parent : ouvrir **« Annonces »**.

✅ Motif trop court : "Le motif doit comporter au moins 3 caractères." ; ensuite « L'annonce est retirée. », statut « Retirée » ; l'annonce disparaît de la boîte du parent ; plus de « Modifier » ni de « Retirer » sur la fiche.

☐ OK ☐ KO

---

## Étape 301 — Cloche et notifications dans l'application
👤 **parent** · fenêtre **B** · 📂 **« Messages »** > **« Notifications »** (`/v2/messages/notifications`)

Précondition : le parent a reçu la diffusion et au moins une annonce.

1. Repérer la cloche à droite de la barre (nombre rouge si non lues). La cliquer : le panneau « Notifications » liste les cinq dernières ; boutons **« Tout marquer comme lu »** et **« Tout voir »**.
2. Cliquer **« Tout voir »** (page « Notifications », « Mes notifications » avec « Messages », « Annonces », « Alertes automatiques »). Cocher « Non lues seulement », cliquer **« Marquer comme lue »** sur une ligne, puis **« Tout marquer comme lu »**.
3. Dans « Préférences de notification », catégorie « Annonces » : décocher « Notifications dans l'application », cocher « E-mail », **« Enregistrer mes préférences »**. Recharger, puis remettre « Notifications dans l'application » coché, décocher « E-mail », enregistrer.

✅ Le compteur diminue à chaque action jusqu'à zéro (« Aucune notification non lue. » avec le filtre) ; « Vos préférences sont enregistrées. » ; le texte d'aide dit "Les annonces urgentes et les décisions de modération vous sont toujours signalées dans l'application.". La cloche n'existe que dans la section Communication.

☐ OK ☐ KO

---

## Étape 302 — Signaler un message
👤 **parent** (deuxième message), puis **enseignant** · fenêtre **B** · 📂 **« Messages »** > conversation "Question sur le devoir test guide"

1. Parent : dans la conversation, répondre `Deuxième message du parent test guide` et `Troisième message du parent test guide` (deux messages à signaler).
2. Enseignant : ouvrir le fil. Sous un message du parent, cliquer **« Signaler »** (fenêtre « Signaler ce message »).
3. Laisser « Motif » = « Contenu inapproprié », saisir en « Précisions » `Signalement de contrôle test guide`, cliquer **« Signaler »**.
4. Recommencer sur l'autre message avec le motif « Autre motif ».

✅ « Merci : votre signalement a été transmis à la modération. ». Le bouton « Signaler » n'existe pas sur les messages de l'enseignant lui-même.

☐ OK ☐ KO

---

[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](15-documents-ged.md) · [Suivant →](16b-messagerie-suite.md)
