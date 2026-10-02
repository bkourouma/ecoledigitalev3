# Modèle de données — communications : messagerie interne et annonces (016)

Schéma Postgres `messaging`, migration `apps/api/src/modules/messaging/migrations/1600_messaging_init.sql` (plage 1600-1699). Source de vérité : le DDL ; ce document en explique les choix.

## 1. Principes

- **Une table = `tenant_id uuid NOT NULL REFERENCES kernel.tenants(id)` + RLS forcée (`kernel.enable_tenant_rls`) + `GRANT` à `app_user`.** Aucune table globale (allowlist vide).
- **Aucune clé étrangère vers un autre module** : utilisateurs (identités IAM), élèves, classes, niveaux, campus, établissements sont des UUID vérifiés par les ports. Entre nos tables, clés **composites** `(tenant_id, id)` : une ligne ne peut pas pointer la ligne d'un autre tenant.
- **Immutabilité du contenu** : un message n'est jamais modifié ni supprimé ; son retrait pose `removed_*` (traçabilité de la modération). Les annonces visibles se retirent, ne s'effacent pas (seul un brouillon se supprime).
- **Instants** `timestamptz` UTC ; l'horloge est injectée (`Clock`) et passée explicitement aux requêtes. Ids : UUID v7 (`newId()`).
- **Recherche** : colonne générée `messages.search_text = messaging.normalize_search(body)` (minuscules, sans accents ; fonction `IMMUTABLE`) + index trigramme.

## 2. Tables

### `settings` — paramètres d'établissement (une ligne par tenant, créée à la première modification ; les défauts du code sont identiques à ceux de la table, vérifié par test)

`student_policy` (`DISABLED`, `REPLY_ONLY`, `TEACHERS`, `TEACHERS_AND_ADMIN`), `admin_contact_roles text[]` (clés de rôles RBAC dont les titulaires sont les contacts de l'administration), `attachments_enabled`, `attachment_max_bytes` (≤ 25 Mio), `attachment_max_per_item`, `allowed_attachment_types` (PDF, JPEG, PNG, WebP), `max_messages_per_hour`, `max_new_conversations_per_day`, `max_group_participants`, `max_broadcast_participants`, `message_max_length`, `notification_retention_days`, `updated_by`, `updated_at`.

### `conversations`

| Colonne | Rôle |
|---|---|
| `kind` | `DIRECT`, `GROUP`, `SYSTEM` (une diffusion crée des fils `DIRECT`) |
| `subject`, `priority` (`LOW`..`URGENT`) | objet et priorité initiale |
| `broadcast_id` | rattache les fils privés issus d'un même envoi |
| `created_by` | identité de l'auteur ; `NULL` pour `SYSTEM` (CHECK : `SYSTEM` => sans auteur, sans réponses) |
| `about_student_id`, `classroom_id` | contexte (élève concerné ; classe d'un envoi en bloc) |
| `direct_key` | `<min>:<max>:<élève|->:<objet normalisé>` (DIRECT) ou `system:<utilisateur>` ; `UNIQUE (tenant_id, direct_key)` : un fil par paire / élève / objet, insertion concurrente sûre (`ON CONFLICT DO NOTHING`) |
| `allow_replies`, `closed_at`, `closed_by` | réponses des membres ; fermeture (réservée, aucune route en V1) |
| `last_seq`, `last_message_at`, `last_preview` | tête du fil (aperçu recalculé au retrait d'un message) |

### `conversation_participants` — état PAR UTILISATEUR

PK `(tenant_id, conversation_id, user_id)`. `role` (`OWNER` crée et peut toujours écrire ; `MEMBER`), `display_name` (**nom figé** à l'ajout : l'historique reste lisible si le compte change), `last_read_seq` (non-lus = `last_seq − last_read_seq`), `archived_at`, `muted`, `starred`, `left_at`. Index partiel sur `(tenant_id, user_id) WHERE left_at IS NULL`.

### `messages`

`seq` croissant par fil (`UNIQUE (tenant_id, conversation_id, seq)`, attribué sous verrou de la ligne du fil : sans trou). `kind` (`USER`, `SYSTEM` ; CHECK : `SYSTEM` <=> sans expéditeur). `sender_name` figé. `system_code` + `system_payload`. `client_id` (idempotence d'un réessai : `UNIQUE (tenant_id, conversation_id, sender_id, client_id)` partiel) et `dedupe_key` (idempotence d'un message système : `evt:<id d'événement>`, unique partiel). `broadcast_id` (quota : une diffusion = un envoi). `removed_at`, `removed_by`, `removal_kind` (`SENDER`, `MODERATOR`), `removal_reason` (CHECK de cohérence). Index `(tenant_id, sender_id, created_at DESC)` pour les quotas.

### `attachments`

Dépôt préalable (`message_id` et `announcement_id` nuls, `bound_at` nul) puis liaison unique. `storage_key` (`messaging/<tenant>/<id>.<ext>`), `file_name` assaini, `detected_mime` (type RÉEL), `size_bytes`, `sha256`. CHECK : au plus un parent, `bound_at` <=> parent. Une diffusion avec pièce clone la LIGNE par fil (même objet de stockage). Les pièces non liées plus vieilles que 24 h sont purgées (objet d'abord).

### `announcements`, `announcement_targets`, `announcement_recipients`

- `announcements` : `status` (`DRAFT`, `SCHEDULED`, `PUBLISHED`, `WITHDRAWN`), `priority`, `audiences text[]` (`STUDENTS`, `GUARDIANS`, `STAFF`), `require_ack`, `pinned`, `publish_at`, `expires_at` (expiration **dérivée**), `published_at`, `withdrawn_*`, `recipient_count`, `recipients_truncated`. CHECK : `SCHEDULED` => `publish_at`, retrait <=> `withdrawn_at`, `expires_at > publish_at`.
- `announcement_targets` : `(kind, ref)` — `TENANT` (ref vide), `INSTITUTION`, `CAMPUS`, `LEVEL`, `CLASSROOM` (UUID), `ROLE` (clé de rôle). `ON DELETE CASCADE` (brouillon supprimé).
- `announcement_recipients` : instantané des destinataires + `read_at`, `acknowledged_at` (CHECK : accusé => lu). Index `(tenant_id, user_id, announcement_id)` pour la boîte.

### `notifications`, `notification_preferences`

- `notifications` : `category` (`MESSAGE`, `ANNOUNCEMENT`, `SYSTEM`, `MODERATION`), `title`, `body` (≤ 300 : l'objet, jamais le contenu), `link` (CHECK : chemin **interne**), `dedupe_key` + `occurrences` (**un** enregistrement non lu par clé : index unique partiel `WHERE dedupe_key IS NOT NULL AND read_at IS NULL`), `read_at`.
- `notification_preferences` : PK `(tenant_id, user_id, category)` ; `in_app`, `external_channels` (`EMAIL`, `SMS`, `WHATSAPP`, `PUSH`, mémorisés pour le chantier des canaux externes), `muted_until`.

### `reports`, `restrictions`, `system_templates`

- `reports` : `UNIQUE (tenant_id, message_id, reporter_id)`, `reason`, `status` (`OPEN`, `DISMISSED`, `ACTIONED`), décision (`decided_by`, `decided_at`, `decision_note`, CHECK de cohérence).
- `restrictions` : PK `(tenant_id, user_id)`, `restricted_until` (`NULL` = jusqu'à levée), `reason`, `set_by`, `report_id`.
- `system_templates` : PK `(tenant_id, code)`, surcharge des gabarits par défaut du code (`attendance.absence`, `attendance.late`), `enabled`.

## 3. Requêtes structurantes

| Besoin | Requête |
|---|---|
| Boîte | participants (`user_id`, `left_at IS NULL`, dossier) JOIN conversations, tri `(coalesce(last_message_at, created_at), id)` décroissant, **curseur** (jamais d'`OFFSET`) |
| Pastille | `count(*)` des participations non archivées, non muettes, avec `last_seq > last_read_seq` |
| Dossier « envoyés » | `DISTINCT ON (coalesce(broadcast_id, id))` : une ligne par diffusion |
| Envoi | `SELECT … FOR UPDATE` du fil -> `seq = last_seq + 1` -> insertion -> lecture de l'auteur -> désarchivage des autres -> notifications (`INSERT … ON CONFLICT … DO UPDATE occurrences + 1`) |
| Diffusion | `unnest` : conversations, participants, messages, notifications en **une requête par table** |
| Quotas | `count(DISTINCT coalesce(broadcast_id, id))` sur `messages` (heure) et `conversations` (jour) |
| Boîte d'annonces | recipients JOIN announcements (`PUBLISHED`, non expirée), tri `(pinned, published_at, id)` décroissant, curseur à trois composantes |
| Accusés | `count(*)`, `count(read_at)`, `count(acknowledged_at)` par annonce ; liste filtrable paginée par identifiant d'utilisateur |

## 4. Invariants vérifiés par test

Isolation A/B des treize tables avec de vraies données ; défauts du code = défauts de la table ; seq unique par fil ; message système sans expéditeur ; retrait cohérent ; lien de notification interne ; annonce programmée datée ; accusé implique lecture.
