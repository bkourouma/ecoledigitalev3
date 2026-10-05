# Module `messaging` — messagerie interne, annonces ciblées, notifications in-app

Spec : `specs/v2/016-communications/` (`spec.md`, `data-model.md`, `plan.md`, `parity.md`, `open-questions.md`). Schéma Postgres `messaging`, migrations **1700-1799** (1700 livrée). Packs PRIMARY, SECONDARY, HIGHER, VIRTUAL. `dependsOn: []` : les liens (tutelle, affectation, rôles) arrivent par des **ports**. Les canaux externes (e-mail, SMS, WhatsApp, push) sont un autre chantier : seul le port `NotificationChannel` est déclaré.

## Ce que fait le module

| Domaine | Fonctions |
|---|---|
| Conversations | directes (1-1), de groupe (fil partagé), **diffusions** (un fil privé par destinataire), fil système d'alertes ; lecture par participant (`last_read_seq`), archivage / sourdine / favori par utilisateur, départ d'un groupe, retrait de son message, recherche, pagination par curseur |
| Autorisation | permissions RBAC **et** liens : un parent n'écrit qu'aux personnes liées à SES enfants et à l'administration — **et, pendant une fenêtre configurable (Q-05), aux enseignants de l'ANNÉE PRÉCÉDENTE de ses enfants** (voir « Année précédente ») ; un enseignant à ses classes ; un élève selon `student_policy` ; l'administration à tous (`domain/policy.ts`, pur) |
| Annonces | brouillon -> programmée -> publiée -> retirée ; cibles établissement / établissement scolaire / campus / niveau / classe / rôle ; audiences élèves / tuteurs / personnel ; expiration dérivée, épinglage, priorité, pièces ; destinataires figés ; accusés de lecture et de réception ; job de publication |
| Pièces jointes | `StoragePort` ; type RÉEL sur les octets (PDF, JPEG, PNG, WebP), taille et types paramétrables, SHA-256, URL signée courte, purge des non liées |
| Notifications | in-app avec compteur d'occurrences par fil, préférences appliquées, `GET /me/unread` (cloche), purge |
| Modération | signalement, décision (retrait / restriction), lecture de contexte et supervision **motivées et auditées** |
| Messages système | gabarits par tenant ; `attendance.absence.recorded` -> tous les tuteurs joignables ; `late` désactivé par défaut |
| Garde-fous | quotas en base (envois / heure — **120 par défaut** depuis Q-06, conversations / jour, plafonds de participants), limiteur HTTP, aucune donnée de message dans événements / audit / notifications |

## Année précédente (Q-05) et plafond d'envois (Q-06)

* **Fenêtre** : `settings.previous_year_window_days` (0 à 366, **défaut 90**, 0 = fermée). Choix le plus simple : une durée en jours, sans lecture de l'état de clôture. Elle court de la date d'ancrage — le **début de l'année qui suit l'année précédente** ou, tant que celle-ci n'est pas créée, la **fin de l'année précédente** — jusqu'à N jours plus tard (bornes incluses). Les « 3 premiers mois de l'année suivante » = 90 jours.
* **Qui** : règle R3 seulement (tuteurs, `messaging.child.send`). Il faut que l'enfant ait suivi une classe de l'année précédente (inscription `ACTIVE` ou `COMPLETED`) ET que l'enseignant y ait été affecté (affectation terminée comprise). Rien pour le personnel ni les élèves ; répondre dans un fil existant n'a jamais exigé de lien.
* **Échec fermé** : sans année précédente connue, sans horloge ou à 0 jour, la fenêtre est fermée. L'ancrage est calculé par l'adaptateur `platform/adapters/people-messaging.ts` (academic + people), jamais fourni par le client ; le sélecteur de destinataires (recherche, classe de l'an dernier, contacts naturels) applique la même règle (`previousYearOpen`).
* **Q-06** : `max_messages_per_hour` vaut **120** par défaut (code et colonne SQL) ; les lignes de réglages qui portaient encore l'ancien défaut (60) sont passées à 120 par la migration 1701, un autre choix de l'établissement n'est pas modifié. Autres plafonds inchangés.

## Arborescence

```
manifest.ts          permissions, menus, événements publiés / consommés
index.ts             API publique (seul point d'import pour les autres modules)
migrations/          1700_messaging_init.sql, 1701_messaging_previous_year_and_rate.sql
domain/              policy (autorisation), announcements, text, magic-bytes, system-templates, errors, events, types — purs
application/         conversations, announcements, attachments, notifications, moderation, recipients, settings, consumers (cas d'usage)
                     ports.ts, port-registry.ts, deps.ts (transaction, outbox, audit), views.ts, support.ts
infrastructure/      *-repository.ts (SQL via Tx), audit-adapter.ts, in-memory-ports.ts
http/                plugin.ts (routes /api/v1/messaging, sans préfixe), guards.ts (RBAC)
subscribers.ts       messages système sur attendance.absence|late.recorded
jobs.ts              publication des annonces programmées (chaque minute), purge quotidienne
test/                unit (56), integration (RLS A/B, matrice, HTTP)
```

## Routes (`/api/v1/messaging`)

`GET /me/{audience,unread,preferences}` · `PUT /me/preferences` · `GET|POST /conversations` · `GET /conversations/:id[/messages]` · `POST /conversations/:id/{messages,read,leave}` · `PATCH /conversations/:id/me` · `GET /search` · `DELETE /messages/:id` · `POST /messages/:id/report` · `GET /recipients` · `POST /attachments` · `GET /attachments/:id/url` · `GET|POST /announcements` · `POST /announcements/audience-preview` · `GET|PATCH|DELETE /announcements/:id` · `POST /announcements/:id/{publish,withdraw,read,acknowledge}` · `GET /announcements/:id/receipts` · `GET /notifications` · `POST /notifications/{read-all,:id/read}` · `GET /moderation/{reports,restrictions,conversations}` · `GET /moderation/reports/:id` · `POST /moderation/reports/:id/decide` · `POST /moderation/restrictions` · `DELETE /moderation/restrictions/:id` · `GET /moderation/conversations/:id/messages` · `GET|PUT /settings` · `GET /templates` · `PUT /templates/:code`.

## Permissions

`messaging.read`, `.send`, `.send.any` (administration), `.child.read|send` (parent), `.self.read|send` (élève), `.announcement.publish|publish_class|manage`, `.moderation.read|manage|supervise` (**sensibles**, MFA), `.settings.manage`.

> **À faire dans le module rbac (hors périmètre de cette livraison)** : accorder aux modèles de rôles `messaging.read` + `messaging.send` (`enseignant`, `educateur`, `secretariat`, `directeur_etudes`, `personnel`), `messaging.announcement.publish_class` (`enseignant`), `messaging.announcement.publish` (`secretariat`, `directeur_etudes`). `owner` / `directeur` (`*`), `parent` (`*.child.*`) et `eleve` (`*.self.*`) fonctionnent déjà par convention. Un test de rbac vérifie que `parent` / `eleve` reçoivent EXACTEMENT les permissions `child` / `self` du catalogue.

## Événements

Publiés (`{ v: 1, … }`, jamais de texte) : `messaging.conversation.created`, `message.sent`, `message.removed`, `message.reported`, `report.decided`, `user.restricted`, `user.unrestricted`, `announcement.published`, `announcement.withdrawn`, `announcement.acknowledged`. Consommés : `attendance.absence.recorded`, `attendance.late.recorded` (abonnés `messaging.system-message-on-absence|late`, idempotents).

## Ports (`application/ports.ts`) et adaptateurs

| Port | Fournisseur (adaptateur `platform/adapters`) |
|---|---|
| `PeopleDirectory` (profils, personnes d'une classe, recherche, titulaires de rôles, tuteurs d'un élève, noms) | `people-messaging.ts` : people (`resolveStudentForIdentity`, `listChildrenOfIdentity`, `resolveStaffForIdentity`, `listAssignmentsFor*`, `listAudienceOfStudents`, `searchAudienceIdentities`) + academic (classes, inscriptions) + rbac (rôles) + iam (e-mail de repli du nom) |
| `AudienceDirectory` (cibles d'annonce) | `academic-messaging.ts` |
| `StoragePort` | `storage.ts` (`asMessagingStorage`) |
| `AuditPort` | `infrastructure/audit-adapter.ts` (`runtime.auditPort`) |
| `NotificationChannel` | **contrat seul** : implémenté par le chantier « canaux externes » |

Registre : `app.messagingPorts` (API, `registerMessagingPorts`) ; `setMessagingWorkerPorts` (worker). Port absent = échec fermé `messaging.port_unavailable`. Appels aux ports **séquentiels** (connexion de transaction partagée).

## Extensions additives d'autres modules

`people` : `listAudienceOfStudents`, `searchAudienceIdentities` (`application/audience.ts`, lectures seules, aucune coordonnée).

## Tests

```bash
pnpm --filter @ecoledigitale/api exec vitest run src/modules/messaging                         # unitaires
ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --root apps/api src/modules/messaging   # + intégration
ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --root apps/api test/adapters/messaging.integration.test.ts   # adaptateurs réels
```

## Limites connues

Voir `specs/v2/016-communications/open-questions.md` : rôles système (Q-01), conservation (Q-02), antivirus / filtre de contenu (Q-07, Q-08), évolution d'un groupe (Q-11), canaux externes (Q-10).
