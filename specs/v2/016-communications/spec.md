# Feature Specification: Communications — messagerie interne et annonces (016-communications)

**Feature Branch**: `016-communications`

**Created**: 2026-10-02

**Status**: Rédigée et implémentée en deux parties. **Partie A** (§1 à §16) : **messagerie interne, annonces et notifications in-app** (module `messaging`, schéma Postgres `messaging`, migration `1700_messaging_init.sql`, plage 1700-1799). **Partie B** (§17 à §30) : **canaux externes** — e-mail SMTP, SMS (adaptateur HTTP générique), WhatsApp (WaSender), Web Push (VAPID) et in-app via `messaging` —, gabarits par établissement versionnés, journal de CHAQUE envoi, préférences et consentement, règles configurables, relances d'impayés et alertes (module `notifications`, schéma Postgres `notifications`, migration `2600_notifications_init.sql`, plage 2600-2699). Le port `NotificationChannel` déclaré en §11 est réalisé par la partie B. DDL : `data-model.md` ; plan : `plan.md` ; parité : `parity.md` ; décisions à arbitrer : `open-questions.md`.

**Sources**: `docs/PRD_EcoleDigitale_SaaS.md` §37-38 ; plan §3.11, §4 (phase 3) ; ADR-001, 002, 004, 006, 007 ; `docs/architecture/module-conventions.md`, `new-module-guide.md`, `platform-assembly.md` ; legacy : `routes/{parent,admin,teacher,student}-messages.ts`, `teacher-conversations.ts`, `admin-announcements.ts`, `admin-email.ts`, `notifications-inbox.ts`, `services/{message-delivery,message-email-definitions,notifications-dispatch.service}.ts` (inventaire : `parity.md`).

> Le legacy n'a **pas** de messagerie : huit mécanismes isolés, dont trois en écriture seule (le destinataire ne peut pas lire), des annonces non ciblées sans expiration ni accusé, des accusés de lecture inopérants, un étudiant qui lit les messages écrits à ses parents, un seul parent destinataire (`LIMIT 1`), des tables créées à la volée par les routes, aucune limitation de débit. Cette spec les remplace par **un modèle unique** : conversations (directes, de groupe, diffusions) → messages → pièces jointes ; annonces ciblées avec accusés ; notifications in-app ; modération.

## 1. Objectifs

1. **Une seule messagerie** pour tous les acteurs : parent ↔ enseignant / administration, enseignant ↔ classe, administration → tous, élève ↔ enseignants (selon la politique du tenant). Tout message est lisible par son destinataire.
2. **Autorisation fine, pilotée par les permissions et par les LIENS** : un parent n'écrit qu'aux personnes liées à SES enfants ; un enseignant à ses classes ; un élève selon la politique de l'établissement ; l'administration à tous. Aucun rôle codé en dur, aucune identité lue dans un en-tête client.
3. **Annonces ciblées** (établissement, établissement scolaire, campus, niveau, classe, rôle) avec brouillon, programmation, expiration, épinglage, priorité, pièces jointes, **accusés de lecture et de réception** réels.
4. **Notifications in-app** (cloche, compteur de non-lus) avec **préférences par utilisateur appliquées** à l'envoi.
5. **Pièces jointes** via `StoragePort` : type réel contrôlé sur les octets, taille et types selon les paramètres d'établissement, URL signées courtes.
6. **Recherche, archivage, sourdine, favoris**, pagination par curseur.
7. **Modération** : signalement par tout participant, décision tracée (retrait, restriction d'envoi), supervision administrative **motivée et auditée**.
8. **Anti-spam** : quotas par utilisateur (messages / heure, nouvelles conversations / jour) et limiteur de débit HTTP.
9. **Messages système** publiés par d'autres modules via événements consommés (ex. `attendance.absence.recorded` → message au tuteur), gabarits par tenant en table.
10. **Isolation tenant** (RLS), aucune FK inter-schémas, références par UUID via des ports.

## 2. Périmètre

### Inclus

- Conversations `DIRECT` (1-1), `GROUP` (fil partagé), `BROADCAST` (un fil privé par destinataire, « publipostage »), `SYSTEM` (fil d'alertes d'un destinataire).
- Destinataires : individus autorisés, classes (élèves / tuteurs / enseignants), diffusion par cibles (administration), « l'administration » (contacts paramétrés).
- Messages, retrait par l'auteur, pièces jointes, lecture, archivage, sourdine, favori, départ d'un groupe, recherche.
- Annonces (cycle de vie `DRAFT → SCHEDULED → PUBLISHED → WITHDRAWN`, expiration dérivée), cibles, destinataires figés à la publication, accusés.
- Notifications in-app, préférences (catégories `MESSAGE`, `ANNOUNCEMENT`, `SYSTEM` ; canaux externes mémorisés pour le chantier voisin).
- Signalements, décisions, restrictions d'envoi, supervision motivée.
- Paramètres d'établissement ; gabarits de messages système.
- API `/api/v1/messaging/*`, contrats, événements, écrans `/v2/messages/*` et `/v2/announcements/*`, cloche.

### Exclu (renvoyé)

| Sujet | Renvoi |
|---|---|
| E-mail, SMS, WhatsApp, push : envoi, gabarits, journal des envois, relances, fournisseur SMS | **partie B de cette spec** (module `notifications`, §17 à §30) |
| Invitations à des événements et RSVP (création côté établissement) | à spécifier avec le calendrier (017 / 024) ; non repris |
| Rappels de paiement, impayés | 014 / 015 (publieront des messages système via événements une fois leurs événements disponibles) |
| Mots interdits / filtre automatique de contenu, antivirus des pièces | hors V1 (`open-questions.md`) |
| Chiffrement de bout en bout | hors périmètre (supervision motivée exigée par l'établissement) |
| Ajout de participants à un groupe existant, synchronisation avec l'évolution d'une classe | hors V1 (le groupe est un instantané) |

## 3. Acteurs et permissions

Permissions déclarées dans `manifest.ts` (convention `<ressource>.child.*` pour le parent, `<ressource>.self.*` pour l'élève : les rôles système `parent` et `eleve` les reçoivent automatiquement).

| Permission | Qui | Effet |
|---|---|---|
| `messaging.child.read` / `messaging.child.send` | parent | lire sa boîte, ses annonces, ses notifications / écrire aux personnes liées à ses enfants |
| `messaging.self.read` / `messaging.self.send` | élève | idem, **selon `student_policy`** |
| `messaging.read` / `messaging.send` | personnel (enseignant, éducateur, secrétariat…) | lire / écrire dans son périmètre : ses classes (enseignant), tout le personnel, l'administration |
| `messaging.send.any` | administration | écrire à tout utilisateur actif, toute classe, toute audience ciblée, en diffusion |
| `messaging.announcement.publish` | administration | publier une annonce vers n'importe quelle cible |
| `messaging.announcement.publish_class` | enseignant | publier vers SES classes (élèves, tuteurs) |
| `messaging.announcement.manage` | administration | modifier, retirer toute annonce, voir les accusés |
| `messaging.moderation.read` (**sensible**, MFA) | modérateur | lister les signalements ; lire le contexte d'un signalement (audité) |
| `messaging.moderation.manage` (**sensible**) | modérateur | décider d'un signalement, retirer un message, restreindre un utilisateur |
| `messaging.moderation.supervise` (**sensible**) | direction | parcourir les fils de l'établissement ; lire un fil avec un **motif obligatoire** (audité) |
| `messaging.settings.manage` | direction | paramètres et gabarits système |

**Modèles de rôles système** (module `rbac`, hors périmètre de cette livraison) : `enseignant`, `educateur`, `secretariat`, `directeur_etudes`, `personnel` doivent recevoir `messaging.read` + `messaging.send` (+ `messaging.announcement.publish_class` pour l'enseignant) ; `secretariat` / `directeur_etudes` : `messaging.announcement.publish` ; `owner` / `directeur` (`*`) reçoivent tout. La demande est consignée dans le README du module et dans `open-questions.md` (Q-01) ; tant qu'elle n'est pas appliquée, seules la direction, les parents et les élèves ont accès.

## 4. Règles d'autorisation (cœur de la spec — `domain/policy.ts`, pur)

Les droits RBAC disent **quel type** d'action ; le module décide **vis-à-vis de qui**. Le profil de l'acteur est résolu par le port `PeopleDirectory` (élève de ce compte ; enfants de ce tuteur ; membre du personnel et classes où il est affecté **aujourd'hui**), jamais par le client.

### 4.1 Créer une conversation (au moins une règle applicable doit autoriser CHAQUE destinataire)

| Règle | Détenteur de | Destinataires autorisés |
|---|---|---|
| R1 | `send.any` | tout utilisateur actif du tenant ; toute classe ; audience par cibles ; « administration » |
| R2 | `send` + profil personnel | tout membre du personnel ; les **élèves** inscrits dans une classe où il est affecté ; les **tuteurs** d'un élève de ces classes ; ses classes en bloc (élèves / tuteurs / autres enseignants) ; l'administration |
| R3 | `child.send` + tuteur lié | le personnel affecté à une classe d'un de SES enfants ; les contacts de l'administration ; `aboutStudentId` doit être l'un de SES enfants |
| R4 | `self.send` + élève | selon `student_policy` : `DISABLED` aucun ; `REPLY_ONLY` aucun (réponse seulement) ; `TEACHERS` les enseignants de sa classe ; `TEACHERS_AND_ADMIN` + contacts de l'administration |

Interdits structurels : parent → parent, élève → élève, parent / élève → classe entière, diffusion et audience pour tout autre que R1/R2 (classes), utilisateur inactif ou inconnu du tenant (refus 403 IDENTIQUE à celui d un destinataire interdit : l existence d un compte n est jamais révélée, sauf à `send.any`), utilisateur restreint (`messaging.sender_restricted`).

### 4.2 Répondre dans un fil

Participant non parti ; fil non fermé ; `allow_replies` vrai (ou participant `OWNER`) ; auteur détenteur d'une permission d'envoi ; non restreint ; un élève avec `student_policy = DISABLED` ne répond pas. **Répondre n'exige pas de lien** (le fil existe) : un parent répond à l'enseignant d'un fil ouvert même si l'enseignant n'est plus affecté.

### 4.3 Lire

Seuls les participants non partis lisent un fil ; les modérateurs lisent via les routes de modération (audit). Un message retiré n'est plus restitué (`body: null`) aux participants. Annonces : destinataires (instantané à la publication) et gestionnaires.

### 4.4 Quotas

`max_messages_per_hour`, `max_new_conversations_per_day` (une diffusion compte pour une conversation et pour un envoi), `max_group_participants` (R2/R3/R4), `max_broadcast_participants` (R1/R2), 50 destinataires explicites, 10 classes par message. Dépassement : 429 `messaging.rate_limited` + `Retry-After`. Limiteur HTTP supplémentaire (`runtime.rateLimiter`) par utilisateur.

## 5. Conversations et messages

- **DIRECT** : clé de dédoublonnage `<min>:<max>:<élève|->:<objet normalisé>` : un second message à la même personne, sur le même sujet, rejoint le fil existant (`reused: true`).
- **GROUP** : fil partagé ; participants figés à la création ; `OWNER` = créateur ; départ possible (`left_at`) ; réponses selon `allow_replies`.
- **BROADCAST** : un fil DIRECT **privé** par destinataire (les destinataires ne se voient pas), même `broadcast_id`, même message ; l'expéditeur ne reçoit pas N fils dans sa boîte : ses fils sont archivés à la création et **ressortent à la première réponse** ; le dossier « envoyés » les regroupe (une ligne par diffusion).
- **SYSTEM** : un fil `system:<utilisateur>` par destinataire ; sans expéditeur, sans réponse ; chaque message porte `system_code` et une clé d'idempotence (`dedupe_key` = événement source).
- **Message** : `seq` croissant par fil (verrou de ligne du fil), `client_id` (idempotence d'un réessai), corps ≤ `message_max_length`. Retrait par l'auteur ou la modération = marqueur (`removed_*`), jamais `DELETE`. L'aperçu du fil est recalculé.
- **Lecture** : `last_read_seq` par participant ; non-lus d'un fil = `last_seq − last_read_seq` ; envoyer un message marque le fil lu pour l'auteur ; un nouveau message **désarchive** le fil des autres participants.
- **Pièces jointes** : dépôt préalable (`POST /attachments`, base64) → liaison à un message ou une annonce par identifiant. Type détecté sur les octets (PDF, JPEG, PNG, WebP), taille et types selon `settings`, empreinte SHA-256, clé de stockage `messaging/<tenant>/…`. Pièces non liées purgées après 24 h.
- **Recherche** : `GET /search?q=` sur les fils du demandeur (sans accents, sous-chaîne), jamais sur les fils d'autrui.

## 6. Annonces

- Champs : titre, corps, priorité (`LOW`, `NORMAL`, `HIGH`, `URGENT`), cibles, audiences (`STUDENTS`, `GUARDIANS`, `STAFF`), accusé demandé, épinglage, `publish_at`, `expires_at`, pièces.
- **Cibles** : `TENANT`, `INSTITUTION`, `CAMPUS`, `LEVEL` (niveau scolaire), `CLASSROOM`, `ROLE` (clé de rôle RBAC ; ignore `audiences`). Résolues par le port `AudienceDirectory` (academic : classes, niveaux, campus ; people : élèves, tuteurs, enseignants ; rbac : titulaires d'un rôle).
- **Cycle de vie** : `DRAFT` (modifiable, supprimable) → `SCHEDULED` (si `publish_at` futur ; modifiable) → `PUBLISHED` (publiée : destinataires figés, notifications émises, événement) → `WITHDRAWN` (retrait motivé ; invisible des destinataires). **L'expiration est dérivée** (`expires_at ≤ now`) : une annonce expirée disparaît de la boîte et reste dans l'historique (`includeExpired`).
- **Destinataires figés** à la publication (ou à la programmation, rejouée par le job à l'échéance sans résolution) : plafonnés par `max_broadcast_participants` (`recipients_truncated` si dépassé). Zéro destinataire ⇒ `messaging.audience_empty`.
- **Accusés** : `POST /announcements/:id/read` (idempotent) et `POST /announcements/:id/acknowledge` (si `require_ack`). Aucun `GET` n'écrit. Les gestionnaires voient les chiffres (destinataires / lus / accusés) et la liste détaillée filtrable (« en attente d'accusé »).
- **Droits** : `publish` (toute cible) ; `publish_class` (SES classes, élèves et tuteurs) ; `manage` (toute annonce) ; l'auteur gère la sienne.
- **Après publication** seuls `expires_at` et `pinned` sont modifiables (le contenu reçu ne change pas sous les yeux des destinataires) ; correction = retrait + nouvelle annonce.

## 7. Notifications in-app et préférences

- Table `notifications` : une notification **non lue** par clé (`dedupe_key`) avec compteur d'occurrences (dix messages d'un même fil = une notification « 10 nouveaux messages »). Lien **interne** uniquement (`/v2/messages/<id>`).
- Création dans la transaction de l'action : message (hors expéditeur, hors fils en sourdine), annonce publiée, message système, décision de modération. Pas de contenu de message dans la notification (objet seulement).
- **Préférences** par utilisateur et catégorie : `in_app`, canaux externes autorisés, sourdine temporaire. Appliquées à l'insertion (une annonce `URGENT` ignore `in_app = false`). Les canaux externes sont **mémorisés** pour le chantier voisin ; ce module ne les lit pas.
- Compteurs : `GET /me/unread` → `{ conversations, announcements, notifications }` (cloche). Lecture : `POST /notifications/:id/read`, `POST /notifications/read-all`. Lire un fil / une annonce marque sa notification lue. Purge des notifications lues après `notification_retention_days` (job quotidien).

## 8. Modération et audit

- **Signalement** : tout participant, une fois par message (`messaging.already_reported`) ; motif codé + détails. Le message signalé reste visible jusqu'à décision.
- **Décision** (`moderation.manage`, MFA) : `DISMISS`, ou `ACTION` = retirer le message et/ou **restreindre l'auteur** (jusqu'à N jours ou levée explicite). Un utilisateur restreint ne peut ni initier ni répondre. Notification `MODERATION` à l'auteur du message retiré.
- **Lecture du contexte** d'un signalement (`moderation.read`, MFA) : message signalé + 10 voisins ; **chaque lecture est auditée**.
- **Supervision** (`moderation.supervise`, MFA) : liste des fils (objet, participants, dates — sans contenu) ; lecture du contenu **avec motif obligatoire**, auditée (`messaging.supervision.read`, motif conservé). Reprend la « vue admin » du legacy sans en faire une porte dérobée silencieuse.
- **Audit** (`auditPort.record`, même transaction, en dernier) : création de conversation de groupe / diffusion, retrait de message, décision, restriction / levée, lecture de contexte, supervision, publication / retrait / modification d'annonce, modification des paramètres et des gabarits.

## 9. Messages système

Abonnés du worker (idempotents) sur `attendance.absence.recorded` et `attendance.late.recorded` : pour l'élève de l'événement, **tous** les tuteurs joignables (lien vivant, accès portail) reçoivent un message dans leur fil système, rendu depuis le gabarit du tenant (`system_templates`, variables `{{studentName}}`, `{{date}}`…). Gabarits par défaut dans le code (`attendance.absence` actif ; `attendance.late` **désactivé** par défaut), surchargeables et désactivables par tenant. Une absence déjà **excusée** ou une **correction** n'émet rien. Clé d'idempotence : `evt:<identifiant de l'événement>`.

## 10. API (préfixe `/api/v1/messaging`)

| Famille | Routes |
|---|---|
| Moi | `GET /me/audience`, `GET /me/unread`, `GET\|PUT /me/preferences` |
| Conversations | `GET /conversations`, `POST /conversations`, `GET /conversations/:id`, `GET /conversations/:id/messages`, `POST /conversations/:id/messages`, `POST /conversations/:id/read`, `PATCH /conversations/:id/me`, `POST /conversations/:id/leave`, `GET /search` |
| Messages | `DELETE /messages/:id`, `POST /messages/:id/report` |
| Destinataires | `GET /recipients` (sélecteur : uniquement les personnes que l'appelant a le droit d'écrire) |
| Pièces jointes | `POST /attachments`, `GET /attachments/:id/url` |
| Annonces | `GET /announcements`, `POST /announcements`, `GET /announcements/:id`, `PATCH /announcements/:id`, `DELETE /announcements/:id` (brouillon), `POST /announcements/:id/{publish,withdraw,read,acknowledge}`, `GET /announcements/:id/receipts`, `POST /announcements/audience-preview` |
| Notifications | `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all` |
| Modération | `GET /moderation/reports`, `GET /moderation/reports/:id`, `POST /moderation/reports/:id/decide`, `GET\|POST /moderation/restrictions`, `DELETE /moderation/restrictions/:userId`, `GET /moderation/conversations`, `GET /moderation/conversations/:id/messages` |
| Paramètres | `GET\|PUT /settings`, `GET /templates`, `PUT /templates/:code` |

Erreurs `messaging.*` stables (`packages/contracts/src/v2/messaging.ts`). Réponses `Cache-Control: no-store`. Aucune identité lue d'un en-tête client.

## 11. Port `NotificationChannel` (réalisé par la partie B)

`application/ports.ts` déclare l'interface (`channel`, `deliver(notification)`), la forme `OutboundNotification` (tenant, destinataire, catégorie, titre, texte court, lien interne, clé de déduplication) et le résultat. Ce module **ne l'appelle pas** : le module `notifications` (partie B) consomme les événements `messaging.*` (jamais de contenu dedans) et réalise le port par `ChannelAdapter` (§19), plus riche (adresse résolue, contenu rendu, clé d'idempotence, issue classée) ; `toMessagingChannel` fait le pont vers ce contrat. Les événements portent assez d'identifiants (`announcementId`) pour que `notifications` relise les destinataires par l'API publique `readAnnouncementForDelivery` (extension additive de `messaging`, lecture seule). **Source de vérité du consentement aux canaux externes : `notifications`** (§22) ; la colonne `notification_preferences.external_channels` de `messaging` n'est plus lue (Q-10, Q-19).

## 12. Événements publiés (`{ v: 1, … }`, jamais de texte de message)

`messaging.conversation.created`, `messaging.message.sent`, `messaging.message.removed`, `messaging.message.reported`, `messaging.report.decided`, `messaging.user.restricted`, `messaging.user.unrestricted`, `messaging.announcement.published`, `messaging.announcement.withdrawn`, `messaging.announcement.acknowledged`. Consommés : `attendance.absence.recorded`, `attendance.late.recorded`.

## 13. Écrans (`/v2/messages/*`, `/v2/announcements/*`, cloche)

Boîte de réception (dossiers, recherche, non-lus), fil de conversation (lecture, réponse, pièces, signalement, archivage, sourdine), composition avec **sélecteur de destinataires autorisés** (individus, classes, administration, diffusion), annonces (liste, lecture avec accusé, publication avec ciblage et programmation, accusés détaillés), notifications et préférences, modération (signalements, restrictions), paramètres. i18n fr-CI `v2Messaging*`, mobile-first, états chargement / erreur / vide, accessibilité (`aria-live` pour les nouveaux messages, focus, cibles ≥ 44 px).

## 14. Critères d'acceptation

1. Un parent ne peut écrire qu'au personnel d'une classe de ses enfants et à l'administration ; écrire à un autre parent ou à un enseignant d'une autre classe est refusé (testé en intégration avec les liens réels).
2. Un enseignant écrit aux élèves et tuteurs de SES classes seulement ; plusieurs tuteurs reçoivent le message (legacy : un seul).
3. Un élève : refus / autorisation selon `student_policy`.
4. Une diffusion crée un fil privé par destinataire ; un destinataire ne voit jamais les autres.
5. Une annonce ciblée n'apparaît qu'aux destinataires résolus ; expirée ou retirée, elle disparaît de leur boîte ; les accusés se comptent exactement.
6. Une pièce déguisée (extension `.pdf`, contenu exécutable) est refusée ; hors taille est refusée.
7. Isolation A/B : un tenant ne voit jamais ni conversation, ni annonce, ni notification d'un autre.
8. Le dépassement de quota renvoie 429 ; l'audit écrit la modération et la supervision.
9. Les écrans respectent états vide / erreur / chargement et sont utilisables à 375 px.

## 15. Cas limites

Tuteur sans compte (aucune remise : signalé au composeur par un compte de destinataires inférieur à l'attendu) ; élève sans compte ; utilisateur qui change de rôle (les droits sont relus à chaque requête) ; fil dont l'enseignant n'est plus affecté (réponse possible, nouvelle initiative non) ; annonce programmée dont les destinataires ont changé (instantané — `open-questions.md` Q-08) ; double envoi (client_id) ; message retiré dernier du fil (aperçu recalculé) ; groupe quitté par tous ; utilisateur restreint pendant une diffusion en cours (vérifié au début).

## 16. Dépendances

`rbac` (permissions, rôles des contacts), `audit`, `people` (tutelle, comptes, affectations), `academic` (classes, niveaux, campus), `reportcards` (`StoragePort`, via l'adaptateur de stockage), `attendance` (événements consommés). Aucune importation directe : adaptateurs `apps/api/src/platform/adapters/{people,academic,rbac}-messaging.ts` et `storage.ts`.

---

# Partie B — Canaux externes, gabarits, journal, consentement, règles, relances et alertes (module `notifications`)

> Le legacy a deux services de notification étroits (`notification.service.ts` : relances de paiement par e-mail et un SMS **factice** ; `notifications-dispatch.service.ts` : fan-out in-app / e-mail / WhatsApp), un client WaSender, un composeur d'e-mail par profil (16 modèles) et un journal `app_whatsapp_delivery_log` créé à la volée. Pas de consentement, pas d'heures calmes, pas de désinscription, pas de reprise, pas de relance automatique, pas de plafond, un SMS simulé en silence. Cette partie remplace tout cela par **un circuit unique** : événement -> règle -> destinataires -> **journal (file d'envoi)** -> envoi par canal -> issue classée -> reprise. Inventaire et sort de chaque élément : `parity.md` §6.

## 17. Objectifs

1. **Canaux externes derrière un port** : e-mail SMTP, SMS par adaptateur HTTP **générique** configurable (fournisseur non choisi, Q-18), WhatsApp (WaSender comme le legacy), Web Push (VAPID, un abonnement par appareil), in-app (délégué à `messaging`).
2. **Gabarits par établissement versionnés** en base (variables TYPÉES validées, aperçu, langue fr-CI, repli sur gabarits livrés en DONNÉES) pour : absence, retard, paiement reçu, facture émise, impayé / relance, bulletin publié, convocation, annonce, urgence (+ seuil d'absences, changement d'horaire, alertes internes, bulletin de paie).
3. **Journal de chaque envoi** : destinataire masqué, canal, gabarit et version, statut, tentatives, erreur, identifiant fournisseur, coût si connu ; reprise avec backoff ; dédoublonnage par clé d'événement.
4. **Préférences et consentement** par personne et canal (opt-out, heures calmes, urgences qui contournent) ; conformité (désinscription signée, mentions).
5. **Règles configurables par établissement** (qui est notifié, par quel canal, avec quel gabarit, quels seuils) appliquées aux événements des modules.
6. **Relances d'impayés automatiques** par paliers (J+7, J+21, J+45 configurables) : jamais deux fois le même palier, arrêt dès paiement. **Alertes** configurables : absences, retard de paiement, baisse de résultats, charge d'enseignement, document expirant.
7. **Administration** : routes `/api/v1/notifications/*`, écrans `/v2/notifications/*` et `/v2/account/notifications`, gardes serveur, i18n fr-CI `v2Notifications*`, mobile-first.
8. **Sécurité** : aucun envoi réel en test ; secrets par variables d'environnement ; jamais d'adresse complète dans les journaux d'exécution ni dans le journal restitué ; quotas ; un canal non configuré échoue EXPLICITEMENT (jamais de simulation silencieuse).

## 18. Périmètre

### Inclus

Canaux (§19), gabarits (§20), règles et déclencheurs (§21), consentement et préférences (§22), journal et file d'envoi (§23), relances (§24), alertes (§25), envoi manuel (§26), API et écrans (§27), sécurité et anti-abus (§28), événements et jobs (§29).

### Exclu (renvoyé)

| Sujet | Renvoi |
|---|---|
| Choix du fournisseur SMS, accord d'expéditeur (sender ID), coûts | Q-18 |
| Notification externe d'un MESSAGE direct (non lu après N heures) | Q-10 / Q-20 : l'établissement l'obtient par une règle personnalisée quand l'événement `messaging.message.sent` sera relayé avec un seuil de non-lecture ; non livré |
| Rebonds asynchrones lus dans une boîte (DSN) | accusés signés `POST /webhooks/:tenant/delivery-status` seulement (Q-21) |
| Gabarits riches (HTML, images) par établissement | texte brut + enveloppe HTML produite par la plateforme, toujours échappée (aucun HTML dans un gabarit : pas d'injection) ; langues autres que fr-CI (Q-22) |
| Fil de discussion e-mail entrant, réponses | hors périmètre |
| Application mobile native (FCM / APNs) | Web Push uniquement |

## 19. Canaux et port `ChannelAdapter`

Réalisation concrète du port `NotificationChannel` de la §11 : `status()` (configuré ? variables manquantes — jamais leurs valeurs), `deliver(message)` -> issue classée :

| Issue | Sens | Effet sur le journal |
|---|---|---|
| `SENT` (+ identifiant fournisseur, coût) | accepté par le fournisseur | `SENT`, adresse et contenu EFFACÉS |
| `RETRY` (+ délai suggéré) | panne passagère (4xx SMTP, 429, 5xx, coupure, délai, session WhatsApp déconnectée) | `PENDING` + backoff exponentiel (1 min, 2, 4… plafond 1 h, +20 % de gigue) ; après `max_attempts` : `FAILED` |
| `FAILED` | échec définitif (numéro invalide, contenu refusé, canal non configuré) | `FAILED` + événement `notifications.delivery.failed` |
| `BOUNCED` | rebond définitif (boîte inconnue) | `BOUNCED`, adresse en **liste de suppression** (par empreinte salée), événement |
| `SKIPPED` | rien à remettre (aucun abonnement push vivant) | `SKIPPED` + raison |
| `SIMULATED` | simulation EXPLICITE (`NOTIFICATIONS_SIMULATE=1`, jamais en production) | `SIMULATED` (jamais confondu avec un envoi) |

| Canal | Fournisseur | Particularités |
|---|---|---|
| `EMAIL` | SMTP via nodemailer (`SMTP_*` identiques à l'e-mail de comptes) | multipart texte + HTML produit et ÉCHAPPÉ par la plateforme, pied de page de conformité (mentions de l'établissement, désinscription), `List-Unsubscribe` + one-click, `Message-ID` dérivé de la remise ; REBONDS : 550 / 551 / 553 sur le destinataire = rebond définitif, 4xx = reprise ; authentification en échec = reprise (le canal revient quand l'accès est corrigé) |
| `SMS` | **adaptateur HTTP générique** (`SMS_HTTP_*`) : URL, méthode, en-têtes, corps JSON ou formulaire avec jetons `{{to}}`, `{{toDigits}}`, `{{text}}`, `{{sender}}`, `{{reference}}`, lecture de la réponse (critère de succès, identifiant, coût, message d'erreur) ; profil de référence `africastalking` à valider | 429 / 5xx / délai = reprise (`Retry-After` respecté) ; 4xx ou critère de succès non satisfait = échec définitif |
| `WHATSAPP` | WaSender (`WASENDER_*`, comme le legacy) | contrôle de la session avant l'envoi ; lien de désinscription ajouté ; mêmes classes d'issue |
| `PUSH` | Web Push + VAPID (`NOTIFICATIONS_VAPID_*`) | un abonnement par appareil ; requête chiffrée (RFC 8291) ; 404 / 410 = abonnement expiré **supprimé** ; nettoyage périodique des abonnements en échec répété ou inutilisés |
| `IN_APP` | module `messaging` (`postSystemMessages`) | fil d'alertes + cloche, idempotent (`notif:<remise>`) |

**Numéros** : normalisés E.164 ; le plan de numérotation ivoirien (depuis 2021) **conserve le 0 initial** (`+225 07 …`), les autres pays le retirent ; un numéro à 8 chiffres (ancien plan) est refusé (préfixe opérateur inconnu).

## 20. Gabarits

- **Catalogue** (code) : catégorie (granularité des préférences), variables typées `string | text | number | date | money | url` (obligatoire ou non, exemple pour l'aperçu), utilisable en envoi manuel ou non. Variables intégrées : `schoolName`, `appUrl`.
- **Livrés en données** (`domain/default-templates.ts`) : un gabarit par (code, canal) en fr-CI, dérivé de trois textes (objet, court, long). Repli quand l'établissement n'a rien publié (version 0, source `SHIPPED`).
- **Par établissement, versionnés** : chaque publication crée une version IMMUABLE numérotée (`template_versions`) et la rend active ; retour arrière = changer le pointeur (version 0 = gabarit livré) ; activation / désactivation par canal. La remise **fige** la version utilisée (le journal la porte).
- **Syntaxe** : `{{variable}}` et `{{#variable}}…{{/variable}}` (bloc conditionnel). Aucun HTML, aucun code. Validation à l'enregistrement : syntaxe, variables **du catalogue**, objet exigé (e-mail, push, in-app) ou interdit (SMS, WhatsApp), taille.
- **Rendu** : valeurs validées par TYPE (date AAAA-MM-JJ valide -> `jj/mm/aaaa` ; montant entier en unités mineures + devise connue -> `25 000 F CFA` ; chemin interne résolu sur `V2_APP_BASE_URL`, https seulement) ; une variable obligatoire manquante est une **erreur** (remise `FAILED` explicite), jamais un message à trous ; une valeur n'est jamais ré-interprétée comme balise.
- **Aperçu** : texte, HTML d'e-mail avec pied de page, nombre de segments SMS (GSM-7 / UCS-2) et avertissements ; brouillon sans enregistrement.

## 21. Règles et déclencheurs

Une règle = (déclencheur, audience, canaux ordonnés, stratégie, gabarit, urgence, seuils). Les règles LIVRÉES sont des données ; l'établissement les surcharge par clé ou crée des règles `custom.*`.

| Déclencheur | Audience par défaut | Canaux (stratégie) |
|---|---|---|
| `finance.invoice.issued` | responsables financiers (repli : élève) | in-app, e-mail, push (tous) |
| `finance.payment.completed` | idem | in-app, e-mail, push |
| `finance.invoice.overdue` | idem — **désactivée** (les relances couvrent) | e-mail, WhatsApp |
| `attendance.absence.recorded` (hors excusée, hors correction) | tuteurs | push, WhatsApp, SMS, e-mail (**premier canal joignable**) |
| `attendance.late.recorded` — **désactivée** (parité avec la messagerie interne) | tuteurs | idem |
| `attendance.alert.triggered` (seuil d'absences : indicateurs et `minValue` de la règle) | tuteurs | idem |
| `reportcards.report_card.published` | tuteurs ; élève | in-app, e-mail, push ; in-app, push |
| `scheduling.occurrence.cancelled` (séance sans classe : ignorée) | familles et élèves de la classe | in-app, push, e-mail |
| `messaging.announcement.published` | destinataires figés de l'annonce | `HIGH` : e-mail, push ; `URGENT` : tous canaux, **urgent** |
| `people.staff_qualification.expiring` (préavis 30 j) | l'intéressé ; ressources humaines (`secretariat`) | in-app, e-mail |
| `payroll.payslip.notification_requested` | le titulaire | in-app, e-mail, push |
| relance `dunning` | responsables financiers (repli : élève) | in-app, e-mail, WhatsApp |
| alertes `OVERDUE_DAYS`, `GRADE_DROP`, `TEACHING_LOAD` | économat ; enseignants de la classe ; direction des études | in-app, e-mail |

- **Stratégies** : `ALL` (un envoi par canal) ; `FIRST_REACHABLE` (le premier canal joignable ET consenti ; les canaux écartés avant lui sont consignés avec leur raison).
- **Validation** : le déclencheur existe, l'audience lui convient, le gabarit n'exige **aucune variable que le déclencheur ne fournit pas**, un gabarit d'alerte interne n'est jamais adressé à une famille, paliers strictement croissants, seuil présent pour une alerte.
- **Idempotence** : clé de remise = `<événement ou fait source>|<règle>|<personne>|<canal>` ; un événement rejoué, ou un fait republié (même enregistrement d'appel, même version de bulletin), ne double jamais l'envoi.
- **Entités inconnues** (élève supprimé, annonce retirée) : événement bénin, consigné, non rejoué ; port indisponible : échec, le worker rejoue.

## 22. Consentement, préférences, heures calmes, conformité

- **Clé de personne** : `user:<identité IAM>` si la personne a un compte actif, sinon `person:<fiche>`. L'autre clé reste en **alias** : un refus exprimé avant la création du compte continue de valoir.
- **Préférences** : par (canal, catégorie) avec `*` = tout le canal ; la plus **précise** l'emporte ; un refus sur une clé de la personne vaut pour toutes. **Modèle de l'établissement** par canal : `IMPLIED` (envoyé sauf refus ; défaut) ou `EXPLICIT` (envoyé seulement si accordé ; Q-19).
- **Heures calmes** (SMS, WhatsApp, push) : plage de l'établissement (20:00-07:00, fuseau configurable) ou de la personne ; la remise est **reportée** à la fin de la plage, jamais perdue ; l'e-mail et l'in-app n'en dépendent pas.
- **Urgence** : contourne heures calmes et refus de catégorie ; contourne la **révocation du canal** seulement si l'établissement l'a décidé (`urgent_bypasses_revocations`, faux par défaut) ; ne crée jamais un consentement absent sous le modèle `EXPLICIT` ; **ne contourne jamais** la liste de suppression ni un canal désactivé.
- **Preuve** : chaque changement (soi-même, personnel habilité, lien de désinscription) écrit une ligne immuable du journal de consentement (qui, quand, comment) et publie `notifications.consent.changed`.
- **Désinscription** : lien SIGNÉ (HMAC-SHA256, établissement + personne + canal ; sans expiration : il doit marcher dans un vieil e-mail) vers `/v2/notifications/unsubscribe?t=…` ; `GET` n'écrit pas, `POST` applique, idempotent. En-têtes `List-Unsubscribe` ; en production le secret est exigé (sinon e-mail non configuré).
- **Relu à l'envoi** : consentement, canal actif, suppression et heures calmes sont revérifiés AU MOMENT de l'envoi.
- **Mentions** : pied de page d'e-mail (établissement, mentions légales configurables, désinscription) ; ligne de désinscription WhatsApp ; texte SMS sans pied de page par défaut (longueur).

## 23. Journal et file d'envoi

`deliveries` est à la fois la **file** et la **trace**. Statuts : `PENDING`, `SENDING` (bail), `SENT`, `DELIVERED` (accusé), `FAILED`, `BOUNCED`, `SKIPPED` (raison), `CANCELLED`, `SIMULATED`.

- **Envoi** (job `notifications.dispatch`, toutes les 15 s) : réclamation `FOR UPDATE SKIP LOCKED` (plusieurs workers sans doublon), urgentes d'abord, par canal dans la limite du **plafond journalier restant** ; l'envoi réseau se fait **hors transaction** ; issue consignée dans une transaction courte. Au moins une fois : un worker tué laisse un bail qui expire, la remise est reprise (le fournisseur reçoit la même clé d'idempotence).
- **Minimisation** : l'adresse complète et le contenu rendu sont **effacés** dès l'état terminal ; le journal ne garde que le masque (`a***@gmail.com`, `+225 ** ** ** 34`), l'empreinte salée (suppression), le gabarit et sa version.
- **Restitution** : jamais d'adresse complète ni de contenu ; messages d'erreur des fournisseurs **épurés** d'adresses et de numéros.
- **Lecture** : filtres (canal, statut, catégorie, gabarit, origine, règle, utilisateur, période), pagination par curseur, statistiques.
- **Entretien** (job quotidien) : purge du journal terminal au-delà de la rétention de l'établissement (365 j par défaut), jamais une remise en attente ; abonnements push expirés.

## 24. Relances d'impayés

Job quotidien (07:00) par établissement. Source : port `OverdueSource` (finance : échéances dont le reste dû est > 0, facture émise, payeur = apprenant ; aucun calcul de montant ici).

- **Paliers** configurables (`conditions.stages`, défaut `[7, 21, 45]` (Q-26 : décision du propriétaire, anciennement J+3 / J+10 / J+30)) : pour une échéance en retard de *d* jours, seul le palier le plus haut atteint donne lieu à un message (un job en retard n'envoie pas J+7 ET J+21) ; tous les paliers atteints sont consignés (`dunning_steps`, clé primaire (échéance, palier)) : **jamais deux fois le même palier**, même job rejoué ou lancé deux fois.
- **Arrêt dès paiement** : (1) l'échéance est relue au moment de l'envoi (`isInstallmentStillOverdue` : sinon `CANCELLED / paid`) ; (2) `finance.invoice.paid` annule les remises en attente de la facture ; (3) une échéance soldée n'est plus remontée.
- Famille injoignable : le palier n'est pas consommé (nouvel essai à la passe suivante). Une seule règle de relance active par établissement.

## 25. Alertes intelligentes

| Alerte | Source | Dédoublonnage |
|---|---|---|
| absences >= seuil -> parents | `attendance.alert.triggered` (seuils d'assiduité = règles d'alerte du module `attendance` ; `minValue` de la règle ajoute un seuil propre) | par événement |
| retard de paiement >= X jours -> économat | port finance (échéances) | une alerte par échéance |
| baisse de résultats >= seuil -> enseignants de la classe | port `results` : deux résultats **FINAL** consécutifs LUS (aucune formule ici) ; désactivée par défaut (échelle des moyennes propre à l'établissement) | par élève et par période |
| charge d'enseignement > seuil -> direction des études | port `people` : heures planifiées de l'année en cours (unité de planification de l'établissement ; défaut 800 h à ajuster) | par enseignant et par mois |
| document expirant -> RH et intéressé | `people.staff_qualification.expiring` (préavis configurable) | par échéance |

Un port d'alerte indisponible n'arrête pas les autres alertes : l'erreur est rapportée et le job signalé en échec.

## 26. Envoi manuel

`POST /send` : gabarits marqués manuels (convocation, annonce, avis urgent), audience (comptes, tuteurs d'élèves, classes, rôles), variables validées par type **avant** toute mise en file, plafond de 2 000 destinataires, idempotence par `clientKey`. L'**urgence** exige la permission sensible `notifications.send.urgent` (MFA, audit, événement `notifications.urgent.sent`) ; `urgent_notice` est toujours urgent.

## 27. API et écrans

Préfixe `/api/v1/notifications` (réponses `Cache-Control: no-store`, erreurs `notifications.*` stables).

| Famille | Routes |
|---|---|
| Catalogue | `GET /catalog`, `GET /triggers` |
| Gabarits | `GET /templates`, `GET /templates/:code/versions`, `POST /templates/:code` (publier), `POST /templates/:code/{activate,enable,preview}` |
| Règles | `GET /rules`, `PUT /rules/:key`, `DELETE /rules/:key` |
| Paramètres, canaux | `GET\|PUT /settings`, `GET /channels` (santé), `POST /channels/test` |
| Journal | `GET /deliveries`, `GET /deliveries/stats` |
| Envoi | `POST /send` |
| Consentement | `POST /consent`, `GET /consent/log` |
| Moi | `GET\|PUT /me/preferences`, `GET /me/push/{vapid-key,devices}`, `POST /me/push/{subscriptions,unsubscribe}`, `DELETE /me/push/devices/:id` |
| Public (signé) | `GET\|POST /public/unsubscribe?t=…`, `POST /webhooks/:tenantId/delivery-status` |

Permissions : `notifications.read`, `.templates.manage`, `.rules.manage`, `.settings.manage`, `.send`, `.send.urgent` (**sensible**), `.consent.manage`, `.own.manage` (personnel), `.child.manage` (parent), `.self.manage` (élève).

Écrans : `/v2/notifications` (journal, filtres), `/v2/notifications/templates` (liste, éditeur avec aperçu, versions, retour arrière), `/v2/notifications/rules` (règles, relances, alertes), `/v2/notifications/channels` (état de santé, essai, plafonds, heures calmes, mentions), `/v2/notifications/unsubscribe` (public), `/v2/account/notifications` (préférences personnelles, heures calmes, appareils push). i18n fr-CI `v2Notifications*`, mobile-first, états chargement / erreur / vide.

## 28. Sécurité et anti-abus

- Secrets par environnement (placeholders documentés) ; **jamais** d'adresse complète dans les journaux d'exécution, le journal restitué, les événements ou l'audit ; contenu absent des événements.
- **Quotas** : plafond journalier par canal (plateforme, surchargé par établissement) appliqué à l'envoi (l'excédent attend), plafond par destinataire sur 24 h (sauf urgence), file maximale par établissement, 2 000 destinataires par envoi manuel, limiteur de débit sur les routes publiques.
- Canal non configuré : échec explicite ; simulation seulement si demandée, hors production.
- Routes publiques : jeton HMAC / corps HMAC à temps constant, établissement dans le jeton ou l'URL, aucune écriture avant vérification, aucun `GET` n'écrit.
- Isolation : RLS sur les 11 tables, clés composites, aucune FK inter-modules, aucune table globale.

## 29. Événements et jobs

Publiés (`{ v: 1, … }`, sans contenu) : `notifications.delivery.failed`, `.delivery.bounced`, `.consent.changed`, `.template.published`, `.rule.updated`, `.urgent.sent`. Consommés : `finance.invoice.issued|overdue|paid`, `finance.payment.completed`, `attendance.absence.recorded|late.recorded|alert.triggered`, `reportcards.report_card.published`, `scheduling.occurrence.cancelled`, `messaging.announcement.published`, `people.staff_qualification.expiring`, `payroll.payslip.notification_requested`.

Abonnés : `notifications.on.<événement>` (un par déclencheur) et `notifications.stop-dunning-on-invoice-paid`. Jobs : `notifications.dispatch` (15 s), `notifications.run-dunning` (07:00), `notifications.evaluate-alerts` (07:30), `notifications.housekeeping` (04:15).

## 30. Critères d'acceptation

1. Un événement `attendance.absence.recorded` produit un message par tuteur par le premier canal joignable, journalisé (écartés avec raison), rendu avec nom et date ; rejoué, rien n'est doublé.
2. Un opt-out WhatsApp écarte ce canal (consigné) et le message part par SMS ; relu à l'envoi.
3. Un SMS de nuit est reporté à 07:00 puis envoyé ; une urgence part tout de suite ; la liste de suppression n'est jamais contournée.
4. Une panne du canal est reprise avec backoff (1, 2, 4 min…) sans perte ni doublon ; épuisement = `FAILED` + événement ; rebond = `BOUNCED` + suppression ; un worker tué est repris à l'expiration du bail.
5. Une échéance en retard reçoit J+7, J+21, J+45 une seule fois chacun ; un job en retard n'envoie que le palier le plus récent ; un paiement arrête les relances (y compris en attente).
6. Chaque gabarit livré se rend sans variable résiduelle ; une variable inconnue, mal typée ou manquante est refusée ; les versions sont immuables et le journal porte la version utilisée.
7. Le journal ne contient ni adresse complète ni contenu une fois terminal ; l'API ne restitue que le masque.
8. Isolation A/B sur les 11 tables avec de vraies données.
9. Les écrans sont utilisables à 375 px, états vide / erreur / chargement.
