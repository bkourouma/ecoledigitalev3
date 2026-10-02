# Feature Specification: Communications — messagerie interne et annonces (016-communications)

**Feature Branch**: `016-communications`

**Created**: 2026-10-02

**Status**: Rédigée et implémentée pour la partie **messagerie interne, annonces et notifications in-app** (module backend `messaging`, schéma Postgres `messaging`, migration `1700_messaging_init.sql` dans la plage 1700-1799). Les **canaux externes** (e-mail, SMS, WhatsApp, push), leurs gabarits et leur journal d'envoi relèvent d'un autre chantier : cette spec ne prévoit que le port `NotificationChannel` (§11). DDL : `data-model.md` ; plan : `plan.md` ; parité : `parity.md` ; décisions à arbitrer : `open-questions.md`.

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
| E-mail, SMS, WhatsApp, push : envoi, gabarits HTML, journal des envois, relances, fournisseur SMS | autre chantier « canaux externes » (port `NotificationChannel`, §11) |
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

## 11. Port `NotificationChannel` (non implémenté ici)

`application/ports.ts` déclare l'interface que le chantier « canaux externes » implémentera (`id`, `channel`, `deliver(notification)`), la forme `OutboundNotification` (tenant, destinataire, catégorie, titre, texte court, lien interne, clé de déduplication) et le résultat. Ce module **ne l'appelle pas** : le chantier voisin consommera les événements `messaging.*` (jamais de contenu dedans) et lira `notification_preferences.external_channels`. Les événements portent assez d'identifiants (`conversationId`, `messageId`, `announcementId`) pour qu'il relise les destinataires par l'API publique du module.

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
