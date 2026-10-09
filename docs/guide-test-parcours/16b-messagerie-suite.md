[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](16a-messagerie.md) · [Suivant →](17-tableaux-de-bord.md)

# Phase 16 (suite) — Messagerie, annonces et notifications

*Suite de la phase 16 : reprise à l'étape 303.*

---

## Étape 303 — Modération : rejeter, puis sanctionner avec restriction d'envoi
👤 **directeur** (code MFA si « Confirmez votre identité » apparaît), puis **parent** · fenêtres **A** et **B** · 📂 Menu **« Modules »** > **« Communication »** > **« Modération des messages »** (`/v2/messages/moderation`)

1. Lire les onglets **« Signalements »**, **« Restrictions »**, **« Supervision »**. Sur la première ligne (« À traiter »), cliquer **« Examiner »**.
2. Choisir **« Rejeter le signalement »**, laisser le motif vide, **« Confirmer la décision »** ; puis saisir `Pas de manquement constaté test guide` et confirmer.
3. Sur la seconde ligne, **« Examiner »** : choisir **« Sanctionner »**, laisser coché « Retirer le message », cocher « Restreindre l'envoi de l'auteur » avec la durée "1 jour", motif `Contenu inapproprié test guide`, **« Confirmer la décision »**.
4. Onglet **« Restrictions »** : le parent y figure. Parent : ouvrir **« Messages »** puis essayer **« Nouveau message »**.
5. Directeur : onglet **« Restrictions »**, cliquer **« Lever la restriction »**.

✅ Motif vide : « Le motif de la décision est obligatoire (3 caractères au moins). » ; « Décision enregistrée. » ; première ligne « Rejeté », seconde « Sanctionné » ; le message sanctionné devient « Message retiré par la modération » chez tout le monde. Parent restreint : « Votre envoi de messages est temporairement restreint par l'établissement. Vous pouvez toujours lire vos messages. ». Après **« Lever la restriction »** : « Aucune restriction en cours. » et le parent peut de nouveau écrire.

☐ OK ☐ KO

---

## Étape 304 — Supervision motivée d'une conversation
👤 **directeur** · fenêtre **A** · 📂 **« Modération des messages »** > onglet **« Supervision »**

1. Saisir `Question sur le devoir` dans la recherche, puis cliquer **« Lire avec un motif »** sur la conversation.
2. Dans « Lire cette conversation », saisir `x` puis valider ; ensuite saisir `Contrôle de la procédure test guide` dans « Motif de la consultation » et cliquer **« Lire la conversation »**.
3. Lire la fenêtre (« Lecture seule : les messages retirés restent visibles pour la supervision. ») et la fermer.

✅ Motif d'un caractère refusé : "Le motif doit comporter au moins 3 caractères." ; avec un motif valable, le contenu s'affiche en lecture seule, **y compris le texte des messages retirés** ; une entrée d'audit est créée (à vérifier dans `/v2/audit`).

☐ OK ☐ KO

---

## Étape 305 — Régler la politique de messagerie des élèves
👤 **propriétaire**, puis **élève** · fenêtres **A** et **B** · 📂 Menu **« Modules »** > **« Communication »** > **« Paramètres de la messagerie »** (`/v2/messages/settings`)

Noter la valeur d'origine de « Messagerie des élèves » (« Ils peuvent écrire à leurs enseignants et à l'administration »).

1. Propriétaire : choisir « Désactivée : les élèves n'écrivent pas », **« Enregistrer les paramètres »**.
2. Élève : ouvrir **« Messages »** puis `/v2/messages/new`.
3. Propriétaire : **remettre** « Ils peuvent écrire à leurs enseignants et à l'administration », **« Enregistrer les paramètres »**.

✅ « Paramètres enregistrés. » à chaque enregistrement. Avec « Désactivée », l'élève n'a plus le bouton **« Nouveau message »** et `/v2/messages/new` affiche « Vous ne pouvez pas envoyer de message pour le moment. ». Les conversations existantes restent lisibles. Réglage rétabli en fin d'étape.

⚠️ *Test d'erreur* : « Taille maximale (Mo) » = `100` → « La taille maximale doit être comprise entre 0,001 et 25 Mo. » (rétablir `5` si modifié).

☐ OK ☐ KO

---

## Étape 306 — Envoyer une convocation (envoi manuel, e-mail simulé)
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

## Étape 307 — Avis urgent : réservé à la direction
👤 **propriétaire** puis **secrétariat** · fenêtre **A** · 📂 **« Notifications »** > **« Envoyer »**

⚠️ Action sensible : l'avis urgent ignore les heures calmes et les préférences de catégorie, et il est audité.

1. Propriétaire : type `Avis urgent` (case "Message urgent" visible), élève DIABATE Nadia, canal « Application », « Objet » `Avis urgent test guide`, « Message » `Test de procédure : ne pas tenir compte de cet avis. (test guide)`. **« Vérifier avant l'envoi »** : en rouge « Envoi urgent » ; **« Envoyer maintenant »** (code MFA si demandé).
2. Secrétariat : refaire la même saisie avec le type `Avis urgent`.

✅ Propriétaire : mise en file, badge « Urgent » dans le journal. Secrétariat : la case d'urgence n'est pas affichée mais le type est listé ; l'API refuse : "L'envoi urgent exige une autorisation spécifique.".

☐ OK ☐ KO

---

## Étape 308 — Lire le journal des envois
👤 **propriétaire** · fenêtre **A** · 📂 Menu **« Notifications »** > **« Journal des envois »** (`/v2/notifications`)

1. Lire la description (« Chaque message envoyé par e-mail, SMS, WhatsApp, notification push ou dans l'application. Les adresses sont masquées et le contenu des messages n'est pas conservé. »), puis cliquer les boutons "1 j", "7 j", "30 j".
2. Filtrer par « Canal » = « E-mail », « Statut » = « Simulé ».
3. Lire une ligne : badge de statut, « Destinataire : », « Gabarit : » (par exemple "convocation (version 0)"), « Origine : ».

✅ Une ligne « Application » (remise) et une ligne « E-mail » au statut « Simulé » (ou « Non envoyé : » avec la raison si le canal n'est pas configuré) pour la convocation, origine « Envoi manuel » ; la ligne de l'avis urgent porte « Urgent ». Aucune adresse complète, aucun contenu de message ; **aucun statut « Envoyé » ne provient d'un vrai fournisseur**.

⚠️ *Test d'erreur* : filtre « Statut » = « Remis » avec la période du jour → « Aucun envoi ne correspond ».

☐ OK ☐ KO

---

## Étape 309 — Gabarits : aperçu, nouvelle version, retour au gabarit livré
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

## Étape 310 — Lire les règles et les canaux d'envoi
👤 **secrétariat** (lecture), puis **propriétaire** · fenêtre **A** · 📂 **« Notifications »** > **« Règles »** (`/v2/notifications/rules`) puis **« Canaux d'envoi »** (`/v2/notifications/channels`)

1. Secrétariat : ouvrir **« Règles »** (« Règles de notification ») : trois familles « Événements », « Alertes », « Relances d'impayés » ; chaque règle porte « Active » ou « Désactivée » et « Livrée » ; aucun bouton **« Modifier »**.
2. Ouvrir **« Canaux d'envoi »** : une carte par canal (« Application », « E-mail », « SMS », « WhatsApp », « Notification push ») avec son état ; formulaire « Réglages de l'établissement » en lecture seule.
3. Propriétaire : sur la carte « Application », cliquer **« Envoyer un essai »**, puis ouvrir le journal.

✅ « Essai en file : 1 message(s), 0 ignoré(s). Consultez le journal des envois. » ; une ligne d'origine « Essai » adressée à soi-même. Les canaux externes non configurés ont leur bouton d'essai grisé ; **vérifier qu'aucun message réel n'arrive**.

⚠️ *Test d'erreur* : sur **« Modifier »** de la règle "Relances d'impayés (J+7, J+21, J+45)" (propriétaire), paliers `10, 5` → « Les paliers doivent être strictement croissants. » (annuler ensuite).

☐ OK ☐ KO

---

## Étape 311 — Préférences de notification du parent
👤 **parent**, puis **secrétariat** · fenêtre **B** · 📂 Menu **« Mon compte »** > **« Mes notifications »** (`/v2/account/notifications`)

1. Parent : lire « Canaux et catégories » ; sur le canal « E-mail », décocher la case de réception : l'étiquette passe à « Désactivé ». Cocher « Activer mes heures calmes », début `21:00`, fin `06:00`, **« Enregistrer les heures calmes »**.
2. Secrétariat (A) : renvoyer la convocation de l'étape *Envoyer une convocation* pour DIABATE Nadia par « E-mail » seulement, puis lire le journal.
3. Parent : rétablir (canal « E-mail » activé, « Utiliser les heures calmes de l'établissement » coché, enregistrer).

✅ « Préférence enregistrée. » à chaque case ; « Heures calmes enregistrées. ». Au journal, la ligne « E-mail » du parent n'est plus « Simulé » mais « Non envoyé : consentement retiré. » ou « Non envoyé : catégorie refusée par la personne. » (motif exact à relever).

⚠️ *Écart connu* : le lien « Mes notifications » est proposé au secrétariat mais mène à « Accès refusé » (pas de droit personnel).

☐ OK ☐ KO

---

## Étape 312 — Désinscription publique par lien signé
👤 **aucun compte** · fenêtre **B** (navigation privée sans session) · 📂 `/v2/notifications/unsubscribe`

1. Ouvrir `http://localhost:3000/v2/notifications/unsubscribe` sans paramètre.
2. Ajouter à la fin de l'adresse `?t=lien-invalide-test-guide`.

✅ Titre « Préférences de notification », aucune navigation ni connexion. Sans paramètre : « Ce lien n'est pas valide. Utilisez le lien reçu dans le message. ». Avec un jeton inventé : "Lien de désinscription invalide ou expiré.". Aucune désinscription n'est appliquée par la simple ouverture.

☐ OK ☐ KO

---

## Étape 313 — Contrôler les droits de communication
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

## Étape 314 — ⚠️ Accuser réception de l'annonce de rentrée
👤 **parent**, puis **directeur** · fenêtres **B** et **A** · 📂 **« Annonces »** (`/v2/announcements`)

⚠️ Irréversible : l'accusé de réception ne peut pas être retiré. Le faire avec un seul compte.

1. Parent : ouvrir **« Annonces »**, repérer "Rentrée : réunion d'information des parents (démonstration)" (épinglée, badge « Accusé à donner »), l'ouvrir et cliquer **« J'ai pris connaissance »**. Recharger. Vérifier que le brouillon "Brouillon : calendrier des compositions (démonstration)" n'est pas dans la liste.
2. Directeur : **« Annonces »** > onglet « Publiées par moi », ouvrir l'annonce de rentrée ; dans « Gestion de l'annonce », lire « Destinataires », « Lus », « Accusés », puis dans « Accusés de lecture » le sélecteur « Afficher » = « Accusés ».

✅ « Merci : votre accusé de réception est enregistré. » ; après rechargement le bouton est remplacé par "Vous avez pris connaissance de cette annonce le …" et le badge a disparu. Chez le directeur, « Accusés » vaut au moins 1 et le parent figure avec la date « Accusé le ».

📚 *Pour aller plus loin* : chapitre 15, scénarios 15.15 (annonce programmée et expirée), 15.19 à 15.25 (plafonds, messages automatiques d'absence), 15.31 à 15.35 (canaux, isolation entre établissements).

**Ce que la phase laisse dans l'application :** conversations `Question sur le devoir test guide` (parent et TRAORE Kouadio, avec message retiré par la modération), `Pièce jointe test guide`, `Diffusion 6e A test guide` (avec réponse du parent), `Groupe pédagogique test guide` ; annonces `Réunion de classe 6e A test guide` (retirée), `Annonce enseignant test guide`, `Annonce élèves test guide` ; accusé de réception de DIABATE Séka sur l'annonce de rentrée ; deux signalements traités ; envois `Entretien avec la direction test guide` (convocation) et `Avis urgent test guide` au journal ; version 1 du gabarit "Convocation" (historique conservé, gabarit livré rétabli) ; politique de messagerie des élèves, préférences du parent et réglages rétablis à leur état de départ.

---

[⬅ Sommaire](../GUIDE_TEST_UTILISATEUR_COMPLET.md) · [← Précédent](16a-messagerie.md) · [Suivant →](17-tableaux-de-bord.md)
