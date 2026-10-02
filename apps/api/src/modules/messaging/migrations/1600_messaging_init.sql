-- =============================================================================
-- 1600 — Module messaging : conversations, messages, pièces jointes, annonces, notifications in-app
-- =============================================================================
-- Spec v2/016-communications (partie messagerie interne et annonces). Plage 1600-1699.
-- Règles du module :
--   - un schéma `messaging` ; toute table de tenant : tenant_id + RLS forcée + GRANT app_user ;
--   - AUCUNE clé étrangère vers un autre module : utilisateurs (identités IAM), élèves, classes, niveaux, campus
--     sont des UUID vérifiés par les ports (annuaires de `people`, `academic`, `rbac`) ;
--   - clés composites (tenant_id, id) entre nos propres tables : une ligne ne peut pas pointer un autre tenant ;
--   - messages immuables dans leur contenu : retrait = marqueur (removed_*), jamais DELETE (traçabilité de modération).
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS messaging;
REVOKE ALL ON SCHEMA messaging FROM PUBLIC;
GRANT USAGE ON SCHEMA messaging TO app_user;

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- Clé de recherche normalisée (minuscules, sans accents) ; IMMUABLE pour servir de colonne générée.
CREATE FUNCTION messaging.normalize_search(p_text text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT lower(public.unaccent('public.unaccent'::regdictionary, coalesce(p_text, '')))
$$;

-- -----------------------------------------------------------------------------
-- Paramètres d'établissement (une ligne par tenant, créée à la première modification ; défauts = ceux du code)
-- -----------------------------------------------------------------------------
CREATE TABLE messaging.settings (
  tenant_id                 uuid PRIMARY KEY REFERENCES kernel.tenants (id),
  -- Politique des élèves : DISABLED (aucun envoi), REPLY_ONLY (réponse aux conversations ouvertes par le personnel),
  -- TEACHERS (peut écrire à ses enseignants), TEACHERS_AND_ADMIN (+ contacts de l'administration).
  student_policy            text NOT NULL DEFAULT 'TEACHERS_AND_ADMIN'
    CHECK (student_policy IN ('DISABLED', 'REPLY_ONLY', 'TEACHERS', 'TEACHERS_AND_ADMIN')),
  -- Clés de rôles RBAC dont les titulaires sont les « contacts de l'administration » (parents, élèves).
  admin_contact_roles       text[] NOT NULL DEFAULT ARRAY['directeur', 'secretariat']::text[],
  attachments_enabled       boolean NOT NULL DEFAULT true,
  attachment_max_bytes      integer NOT NULL DEFAULT 5242880 CHECK (attachment_max_bytes BETWEEN 1 AND 26214400),
  attachment_max_per_item   smallint NOT NULL DEFAULT 5 CHECK (attachment_max_per_item BETWEEN 1 AND 20),
  allowed_attachment_types  text[] NOT NULL DEFAULT ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[]
    CHECK (allowed_attachment_types <@ ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[]),
  max_messages_per_hour     integer NOT NULL DEFAULT 60 CHECK (max_messages_per_hour BETWEEN 1 AND 10000),
  max_new_conversations_per_day integer NOT NULL DEFAULT 30 CHECK (max_new_conversations_per_day BETWEEN 1 AND 10000),
  max_group_participants    integer NOT NULL DEFAULT 200 CHECK (max_group_participants BETWEEN 2 AND 5000),
  max_broadcast_participants integer NOT NULL DEFAULT 5000 CHECK (max_broadcast_participants BETWEEN 2 AND 20000),
  message_max_length        integer NOT NULL DEFAULT 5000 CHECK (message_max_length BETWEEN 100 AND 20000),
  notification_retention_days integer NOT NULL DEFAULT 90 CHECK (notification_retention_days BETWEEN 7 AND 3650),
  updated_by                uuid,
  updated_at                timestamptz NOT NULL DEFAULT now()
);
SELECT kernel.enable_tenant_rls('messaging.settings');
GRANT SELECT, INSERT, UPDATE ON messaging.settings TO app_user;

-- -----------------------------------------------------------------------------
-- Conversations
-- -----------------------------------------------------------------------------
CREATE TABLE messaging.conversations (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  kind             text NOT NULL CHECK (kind IN ('DIRECT', 'GROUP', 'SYSTEM')),
  subject          text CHECK (subject IS NULL OR length(btrim(subject)) BETWEEN 1 AND 200),
  priority         text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  broadcast_id     uuid,                                  -- diffusion : fils privés issus du même envoi
  created_by       uuid,                                  -- identité IAM ; NULL = système
  about_student_id uuid,                                  -- élève concerné (contexte parent <-> enseignant), sans FK
  classroom_id     uuid,                                  -- classe concernée (groupe de classe), sans FK
  -- DIRECT : « <id mineur>:<id majeur>:<élève|->:<sujet normalisé> » (un fil par paire, élève et sujet) ;
  -- SYSTEM : « system:<utilisateur> » (un fil d'alertes par destinataire).
  direct_key       text,
  allow_replies    boolean NOT NULL DEFAULT true,
  closed_at        timestamptz,
  closed_by        uuid,
  last_seq         bigint NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  last_message_at  timestamptz,
  last_preview     text,                                   -- aperçu (160 car.) du dernier message non retiré
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, direct_key),
  CHECK (kind <> 'SYSTEM' OR (created_by IS NULL AND allow_replies = false))
);
SELECT kernel.enable_tenant_rls('messaging.conversations');
GRANT SELECT, INSERT, UPDATE ON messaging.conversations TO app_user;

CREATE INDEX conversations_last_message_idx ON messaging.conversations (tenant_id, last_message_at DESC NULLS LAST);
CREATE INDEX conversations_broadcast_idx ON messaging.conversations (tenant_id, broadcast_id) WHERE broadcast_id IS NOT NULL;

-- Participants : état PAR UTILISATEUR (lecture, archivage, sourdine, favori, départ).
CREATE TABLE messaging.conversation_participants (
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  conversation_id  uuid NOT NULL,
  user_id          uuid NOT NULL,                          -- identité IAM, sans FK
  role             text NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('OWNER', 'MEMBER')),
  display_name     text NOT NULL CHECK (length(btrim(display_name)) > 0),   -- nom figé à l'ajout (affichage, historique)
  added_at         timestamptz NOT NULL DEFAULT now(),
  last_read_seq    bigint NOT NULL DEFAULT 0 CHECK (last_read_seq >= 0),
  last_read_at     timestamptz,
  archived_at      timestamptz,
  muted            boolean NOT NULL DEFAULT false,
  starred          boolean NOT NULL DEFAULT false,
  left_at          timestamptz,
  PRIMARY KEY (tenant_id, conversation_id, user_id),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES messaging.conversations (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('messaging.conversation_participants');
GRANT SELECT, INSERT, UPDATE ON messaging.conversation_participants TO app_user;

CREATE INDEX participants_user_idx ON messaging.conversation_participants (tenant_id, user_id) WHERE left_at IS NULL;

-- Messages
CREATE TABLE messaging.messages (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  conversation_id  uuid NOT NULL,
  seq              bigint NOT NULL CHECK (seq > 0),
  kind             text NOT NULL DEFAULT 'USER' CHECK (kind IN ('USER', 'SYSTEM')),
  sender_id        uuid,                                   -- NULL = système
  sender_name      text,
  body             text NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  system_code      text CHECK (system_code IS NULL OR system_code ~ '^[a-z][a-z0-9_.]{1,59}$'),
  system_payload   jsonb CHECK (system_payload IS NULL OR jsonb_typeof(system_payload) = 'object'),
  broadcast_id     uuid,                                   -- diffusion : un envoi = N messages (quota compté une fois)
  client_id        uuid,                                   -- idempotence d'un envoi (réessai du client)
  dedupe_key       text,                                   -- idempotence d'un message système (événement source)
  search_text      text GENERATED ALWAYS AS (messaging.normalize_search(body)) STORED,
  created_at       timestamptz NOT NULL DEFAULT now(),
  removed_at       timestamptz,
  removed_by       uuid,
  removal_kind     text CHECK (removal_kind IN ('SENDER', 'MODERATOR')),
  removal_reason   text,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, conversation_id, seq),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES messaging.conversations (tenant_id, id),
  CHECK ((kind = 'SYSTEM') = (sender_id IS NULL)),
  CHECK ((removed_at IS NULL) = (removal_kind IS NULL))
);
SELECT kernel.enable_tenant_rls('messaging.messages');
GRANT SELECT, INSERT, UPDATE ON messaging.messages TO app_user;

CREATE UNIQUE INDEX messages_client_id_uq ON messaging.messages (tenant_id, conversation_id, sender_id, client_id) WHERE client_id IS NOT NULL;
CREATE UNIQUE INDEX messages_dedupe_uq ON messaging.messages (tenant_id, conversation_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX messages_sender_rate_idx ON messaging.messages (tenant_id, sender_id, created_at DESC) WHERE sender_id IS NOT NULL;
CREATE INDEX messages_search_trgm ON messaging.messages USING gin (search_text gin_trgm_ops);

-- Pièces jointes : déposées par l'utilisateur (message_id / announcement_id NULL), puis liées à un message ou une annonce.
CREATE TABLE messaging.attachments (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  uploaded_by      uuid NOT NULL,
  message_id       uuid,
  announcement_id  uuid,
  storage_key      text NOT NULL CHECK (length(storage_key) BETWEEN 1 AND 300),
  file_name        text NOT NULL CHECK (length(btrim(file_name)) BETWEEN 1 AND 255),
  detected_mime    text NOT NULL CHECK (detected_mime IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes       integer NOT NULL CHECK (size_bytes > 0),
  sha256           text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_at      timestamptz NOT NULL DEFAULT now(),
  bound_at         timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, message_id) REFERENCES messaging.messages (tenant_id, id),
  CHECK (NOT (message_id IS NOT NULL AND announcement_id IS NOT NULL)),
  CHECK ((bound_at IS NULL) = (message_id IS NULL AND announcement_id IS NULL))
);
SELECT kernel.enable_tenant_rls('messaging.attachments');
GRANT SELECT, INSERT, UPDATE, DELETE ON messaging.attachments TO app_user;

CREATE INDEX attachments_message_idx ON messaging.attachments (tenant_id, message_id) WHERE message_id IS NOT NULL;
CREATE INDEX attachments_announcement_idx ON messaging.attachments (tenant_id, announcement_id) WHERE announcement_id IS NOT NULL;
CREATE INDEX attachments_orphans_idx ON messaging.attachments (uploaded_at) WHERE bound_at IS NULL;

-- -----------------------------------------------------------------------------
-- Annonces ciblées
-- -----------------------------------------------------------------------------
CREATE TABLE messaging.announcements (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  title            text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  body             text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 20000),
  priority         text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  status           text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'WITHDRAWN')),
  author_id        uuid NOT NULL,
  author_name      text NOT NULL,
  -- Qui, parmi les cibles : élèves, tuteurs, personnel (ignoré pour une cible de type ROLE).
  audiences        text[] NOT NULL DEFAULT ARRAY['STUDENTS', 'GUARDIANS', 'STAFF']::text[]
    CHECK (cardinality(audiences) >= 1 AND audiences <@ ARRAY['STUDENTS', 'GUARDIANS', 'STAFF']::text[]),
  require_ack      boolean NOT NULL DEFAULT false,         -- accusé de réception explicite demandé
  pinned           boolean NOT NULL DEFAULT false,
  publish_at       timestamptz,                            -- NULL = dès la publication
  expires_at       timestamptz,
  published_at     timestamptz,
  withdrawn_at     timestamptz,
  withdrawn_by     uuid,
  withdrawal_reason text,
  recipient_count  integer NOT NULL DEFAULT 0 CHECK (recipient_count >= 0),
  recipients_truncated boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (expires_at IS NULL OR publish_at IS NULL OR expires_at > publish_at),
  CHECK (status <> 'SCHEDULED' OR publish_at IS NOT NULL),
  CHECK ((status = 'WITHDRAWN') = (withdrawn_at IS NOT NULL))
);
SELECT kernel.enable_tenant_rls('messaging.announcements');
GRANT SELECT, INSERT, UPDATE, DELETE ON messaging.announcements TO app_user;

CREATE INDEX announcements_status_idx ON messaging.announcements (tenant_id, status, publish_at);

ALTER TABLE messaging.attachments
  ADD CONSTRAINT attachments_announcement_fk FOREIGN KEY (tenant_id, announcement_id) REFERENCES messaging.announcements (tenant_id, id);

CREATE TABLE messaging.announcement_targets (
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  announcement_id  uuid NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('TENANT', 'INSTITUTION', 'CAMPUS', 'LEVEL', 'CLASSROOM', 'ROLE')),
  -- UUID (établissement, campus, niveau, classe), clé de rôle (ROLE) ou chaîne vide (TENANT).
  ref              text NOT NULL DEFAULT '' CHECK (length(ref) <= 100),
  PRIMARY KEY (tenant_id, announcement_id, kind, ref),
  FOREIGN KEY (tenant_id, announcement_id) REFERENCES messaging.announcements (tenant_id, id) ON DELETE CASCADE,
  CHECK ((kind = 'TENANT') = (ref = ''))
);
SELECT kernel.enable_tenant_rls('messaging.announcement_targets');
GRANT SELECT, INSERT, DELETE ON messaging.announcement_targets TO app_user;

-- Destinataires résolus à la publication (instantané) + accusés de lecture et de réception.
CREATE TABLE messaging.announcement_recipients (
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  announcement_id  uuid NOT NULL,
  user_id          uuid NOT NULL,
  delivered_at     timestamptz NOT NULL DEFAULT now(),
  read_at          timestamptz,
  acknowledged_at  timestamptz,
  PRIMARY KEY (tenant_id, announcement_id, user_id),
  FOREIGN KEY (tenant_id, announcement_id) REFERENCES messaging.announcements (tenant_id, id) ON DELETE CASCADE,
  CHECK (acknowledged_at IS NULL OR read_at IS NOT NULL)
);
SELECT kernel.enable_tenant_rls('messaging.announcement_recipients');
GRANT SELECT, INSERT, UPDATE, DELETE ON messaging.announcement_recipients TO app_user;

CREATE INDEX announcement_recipients_user_idx ON messaging.announcement_recipients (tenant_id, user_id, announcement_id);

-- -----------------------------------------------------------------------------
-- Notifications in-app et préférences
-- -----------------------------------------------------------------------------
CREATE TABLE messaging.notifications (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  user_id          uuid NOT NULL,
  category         text NOT NULL CHECK (category IN ('MESSAGE', 'ANNOUNCEMENT', 'SYSTEM', 'MODERATION')),
  title            text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  body             text CHECK (body IS NULL OR length(body) <= 300),
  link             text CHECK (link IS NULL OR link ~ '^/[A-Za-z0-9/_?=&.-]{0,200}$'),   -- chemin INTERNE uniquement
  entity_type      text,
  entity_id        uuid,
  dedupe_key       text,                                   -- une notification NON LUE par clé (compteur d'occurrences)
  occurrences      integer NOT NULL DEFAULT 1 CHECK (occurrences >= 1),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  read_at          timestamptz
);
SELECT kernel.enable_tenant_rls('messaging.notifications');
GRANT SELECT, INSERT, UPDATE, DELETE ON messaging.notifications TO app_user;

CREATE UNIQUE INDEX notifications_unread_dedupe_uq ON messaging.notifications (tenant_id, user_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND read_at IS NULL;
CREATE INDEX notifications_user_idx ON messaging.notifications (tenant_id, user_id, updated_at DESC);
CREATE INDEX notifications_unread_idx ON messaging.notifications (tenant_id, user_id) WHERE read_at IS NULL;

CREATE TABLE messaging.notification_preferences (
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  user_id          uuid NOT NULL,
  category         text NOT NULL CHECK (category IN ('MESSAGE', 'ANNOUNCEMENT', 'SYSTEM')),
  in_app           boolean NOT NULL DEFAULT true,
  -- Canaux externes autorisés (EMAIL, SMS, WHATSAPP, PUSH) : lus par le chantier « canaux externes » (port NotificationChannel).
  external_channels text[] NOT NULL DEFAULT ARRAY['EMAIL', 'SMS', 'WHATSAPP', 'PUSH']::text[]
    CHECK (external_channels <@ ARRAY['EMAIL', 'SMS', 'WHATSAPP', 'PUSH']::text[]),
  muted_until      timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, category)
);
SELECT kernel.enable_tenant_rls('messaging.notification_preferences');
GRANT SELECT, INSERT, UPDATE ON messaging.notification_preferences TO app_user;

-- -----------------------------------------------------------------------------
-- Modération : signalements, restrictions d'envoi
-- -----------------------------------------------------------------------------
CREATE TABLE messaging.reports (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  message_id       uuid NOT NULL,
  conversation_id  uuid NOT NULL,
  reporter_id      uuid NOT NULL,
  reason           text NOT NULL CHECK (reason IN ('SPAM', 'HARASSMENT', 'INAPPROPRIATE', 'PRIVACY', 'OTHER')),
  details          text CHECK (details IS NULL OR length(details) <= 1000),
  status           text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'DISMISSED', 'ACTIONED')),
  decided_by       uuid,
  decided_at       timestamptz,
  decision_note    text CHECK (decision_note IS NULL OR length(decision_note) <= 1000),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, message_id, reporter_id),
  FOREIGN KEY (tenant_id, message_id) REFERENCES messaging.messages (tenant_id, id),
  CHECK ((status = 'OPEN') = (decided_at IS NULL))
);
SELECT kernel.enable_tenant_rls('messaging.reports');
GRANT SELECT, INSERT, UPDATE ON messaging.reports TO app_user;

CREATE INDEX reports_status_idx ON messaging.reports (tenant_id, status, created_at DESC);

CREATE TABLE messaging.restrictions (
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  user_id          uuid NOT NULL,
  restricted_until timestamptz,                            -- NULL = jusqu'à levée explicite
  reason           text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
  set_by           uuid NOT NULL,
  set_at           timestamptz NOT NULL DEFAULT now(),
  report_id        uuid,
  PRIMARY KEY (tenant_id, user_id)
);
SELECT kernel.enable_tenant_rls('messaging.restrictions');
GRANT SELECT, INSERT, UPDATE, DELETE ON messaging.restrictions TO app_user;

-- -----------------------------------------------------------------------------
-- Modèles de messages système (publiés par les événements d'autres modules)
-- -----------------------------------------------------------------------------
CREATE TABLE messaging.system_templates (
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  code             text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_.]{1,59}$'),
  title            text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  body             text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),   -- variables {{nom}}
  enabled          boolean NOT NULL DEFAULT true,
  updated_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('messaging.system_templates');
GRANT SELECT, INSERT, UPDATE ON messaging.system_templates TO app_user;
