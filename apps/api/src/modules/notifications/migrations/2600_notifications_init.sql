-- =============================================================================
-- 2600 — Module notifications : canaux externes, gabarits versionnés, journal d'envoi, consentement
-- =============================================================================
-- Plage de numéros réservée au module : 2600-2699 (docs/architecture/module-conventions.md).
-- Spec : specs/v2/016-communications (data-model.md §notifications).
--
-- Principes :
--   - un module = un schéma ; TOUTE table porte tenant_id + RLS forcée (kernel.enable_tenant_rls) + droits app_user ;
--   - aucune clé étrangère vers un autre module (utilisateurs, élèves, factures sont des UUID vérifiés par des ports) ;
--   - clés composites (tenant_id, id) entre nos tables : une ligne ne peut pas pointer la ligne d'un autre tenant ;
--   - le journal (`deliveries`) est la file d'envoi ET la trace : l'adresse complète n'y reste que le temps de l'envoi
--     (effacée à l'état terminal) ; le contenu rendu est effacé après un envoi réussi ;
--   - aucune table globale : les gabarits et règles LIVRÉS sont des DONNÉES du code (domain/default-*.ts), surchargées ici.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS notifications;
REVOKE ALL ON SCHEMA notifications FROM PUBLIC;
GRANT USAGE ON SCHEMA notifications TO app_user;

-- -----------------------------------------------------------------------------
-- Paramètres d'établissement (une ligne par tenant, créée à la première modification)
-- -----------------------------------------------------------------------------
CREATE TABLE notifications.settings (
  tenant_id                     uuid PRIMARY KEY REFERENCES kernel.tenants (id),
  enabled_channels              text[] NOT NULL DEFAULT ARRAY['IN_APP','EMAIL','SMS','WHATSAPP','PUSH'],
  sender_name                   text CHECK (sender_name IS NULL OR length(btrim(sender_name)) BETWEEN 1 AND 80),
  reply_to                      text CHECK (reply_to IS NULL OR length(reply_to) <= 200),
  timezone                      text NOT NULL DEFAULT 'Africa/Abidjan',
  default_dial_code             text NOT NULL DEFAULT '225' CHECK (default_dial_code ~ '^[0-9]{1,4}$'),
  quiet_hours_enabled           boolean NOT NULL DEFAULT true,
  quiet_start                   time NOT NULL DEFAULT '20:00',
  quiet_end                     time NOT NULL DEFAULT '07:00',
  daily_caps                    jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(daily_caps) = 'object'),
  per_recipient_daily_cap       integer NOT NULL DEFAULT 10 CHECK (per_recipient_daily_cap BETWEEN 1 AND 500),
  consent_models                jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(consent_models) = 'object'),
  urgent_bypasses_revocations   boolean NOT NULL DEFAULT false,
  max_attempts                  integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
  journal_retention_days        integer NOT NULL DEFAULT 365 CHECK (journal_retention_days BETWEEN 7 AND 3650),
  legal_footer                  text CHECK (legal_footer IS NULL OR length(legal_footer) <= 500),
  updated_by                    uuid,
  updated_at                    timestamptz NOT NULL DEFAULT now()
);
SELECT kernel.enable_tenant_rls('notifications.settings');
GRANT SELECT, INSERT, UPDATE ON notifications.settings TO app_user;

-- -----------------------------------------------------------------------------
-- Gabarits : versions immuables + pointeur de version active
-- -----------------------------------------------------------------------------
CREATE TABLE notifications.template_versions (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES kernel.tenants (id),
  code        text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{1,59}$'),
  channel     text NOT NULL CHECK (channel IN ('IN_APP','EMAIL','SMS','WHATSAPP','PUSH')),
  locale      text NOT NULL DEFAULT 'fr-CI',
  version     integer NOT NULL CHECK (version >= 1),
  subject     text CHECK (subject IS NULL OR length(subject) <= 200),
  body        text NOT NULL CHECK (length(btrim(body)) > 0 AND length(body) <= 4000),
  variables   text[] NOT NULL DEFAULT '{}',
  note        text CHECK (note IS NULL OR length(note) <= 300),
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code, channel, locale, version)
);
SELECT kernel.enable_tenant_rls('notifications.template_versions');
-- Une version publiée ne se modifie ni ne se supprime : correction = nouvelle version (traçabilité du journal).
GRANT SELECT, INSERT ON notifications.template_versions TO app_user;

CREATE TABLE notifications.templates (
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  code            text NOT NULL,
  channel         text NOT NULL CHECK (channel IN ('IN_APP','EMAIL','SMS','WHATSAPP','PUSH')),
  locale          text NOT NULL DEFAULT 'fr-CI',
  -- NULL : gabarit LIVRÉ (aucune version propre à l'établissement active).
  active_version  integer,
  enabled         boolean NOT NULL DEFAULT true,
  updated_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, code, channel, locale),
  FOREIGN KEY (tenant_id, code, channel, locale, active_version)
    REFERENCES notifications.template_versions (tenant_id, code, channel, locale, version)
);
SELECT kernel.enable_tenant_rls('notifications.templates');
GRANT SELECT, INSERT, UPDATE ON notifications.templates TO app_user;

-- -----------------------------------------------------------------------------
-- Règles (surcharges des règles livrées + règles personnalisées)
-- -----------------------------------------------------------------------------
CREATE TABLE notifications.rules (
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  key            text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_.-]{1,59}$'),
  label          text CHECK (label IS NULL OR length(label) <= 120),
  kind           text NOT NULL CHECK (kind IN ('EVENT','ALERT','DUNNING')),
  trigger_type   text NOT NULL CHECK (length(trigger_type) BETWEEN 3 AND 80),
  custom         boolean NOT NULL DEFAULT false,
  enabled        boolean NOT NULL,
  template_code  text NOT NULL,
  audience       jsonb NOT NULL CHECK (jsonb_typeof(audience) = 'object'),
  channels       text[] NOT NULL CHECK (cardinality(channels) BETWEEN 1 AND 5),
  strategy       text NOT NULL CHECK (strategy IN ('ALL','FIRST_REACHABLE')),
  urgent         boolean NOT NULL DEFAULT false,
  conditions     jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(conditions) = 'object'),
  updated_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);
SELECT kernel.enable_tenant_rls('notifications.rules');
CREATE INDEX rules_by_trigger ON notifications.rules (tenant_id, trigger_type) WHERE enabled;
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications.rules TO app_user;

-- -----------------------------------------------------------------------------
-- Journal d'envoi = file d'envoi : UNE ligne par (destinataire, canal, notification)
-- -----------------------------------------------------------------------------
CREATE TABLE notifications.deliveries (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  created_at         timestamptz NOT NULL,
  updated_at         timestamptz NOT NULL,
  -- Idempotence : un événement / palier / alerte ne produit jamais deux fois la même remise.
  dedupe_key         text NOT NULL CHECK (length(dedupe_key) BETWEEN 1 AND 300),
  -- Regroupement pour l'arrêt (ex. `dunning:<facture>`) : annule les remises en attente d'un même sujet.
  group_key          text CHECK (group_key IS NULL OR length(group_key) <= 200),
  source_kind        text NOT NULL CHECK (source_kind IN ('EVENT','ALERT','DUNNING','MANUAL','TEST')),
  source_event_id    uuid,
  rule_key           text,
  template_code      text NOT NULL,
  template_version   integer NOT NULL DEFAULT 0 CHECK (template_version >= 0),
  locale             text NOT NULL DEFAULT 'fr-CI',
  category           text NOT NULL CHECK (category IN ('ATTENDANCE','FINANCE','RESULTS','SCHEDULE','ANNOUNCEMENT','ALERT','URGENT')),
  urgent             boolean NOT NULL DEFAULT false,
  channel            text NOT NULL CHECK (channel IN ('IN_APP','EMAIL','SMS','WHATSAPP','PUSH')),
  -- Destinataire : clé de personne (`user:<id>` ou `person:<id>`), compte éventuel, adresse MASQUÉE (affichage).
  subject_key        text NOT NULL,
  alias_keys         text[] NOT NULL DEFAULT '{}',
  recipient_user_id  uuid,
  recipient_masked   text NOT NULL,
  -- Adresse complète : effacée dès que la remise est terminale (minimisation).
  recipient_address  text,
  -- Empreinte salée de l'adresse (liste de suppression sur rebond différé, sans conserver l'adresse).
  address_hash       text CHECK (address_hash IS NULL OR address_hash ~ '^[0-9a-f]{64}$'),
  -- Contenu rendu au moment de la mise en file (version de gabarit figée) ; effacé après un envoi réussi.
  content            jsonb,
  context            jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(context) = 'object'),
  status             text NOT NULL CHECK (status IN ('PENDING','SENDING','SENT','DELIVERED','FAILED','BOUNCED','SKIPPED','CANCELLED','SIMULATED')),
  skip_reason        text,
  attempts           integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts       integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
  available_at       timestamptz NOT NULL,
  locked_until       timestamptz,
  provider_id        text,
  cost_amount        bigint CHECK (cost_amount IS NULL OR cost_amount >= 0),
  cost_currency      text,
  last_error_code    text,
  last_error         text CHECK (last_error IS NULL OR length(last_error) <= 500),
  sent_at            timestamptz,
  delivered_at       timestamptz,
  created_by         uuid,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, dedupe_key),
  CHECK ((status = 'SKIPPED') = (skip_reason IS NOT NULL) OR status = 'CANCELLED')
);
SELECT kernel.enable_tenant_rls('notifications.deliveries');
-- File : les remises à envoyer, urgentes d'abord.
CREATE INDEX deliveries_queue ON notifications.deliveries (tenant_id, available_at)
  WHERE status IN ('PENDING','SENDING');
CREATE INDEX deliveries_journal ON notifications.deliveries (tenant_id, created_at DESC, id DESC);
CREATE INDEX deliveries_by_user ON notifications.deliveries (tenant_id, recipient_user_id, created_at DESC) WHERE recipient_user_id IS NOT NULL;
CREATE INDEX deliveries_by_group ON notifications.deliveries (tenant_id, group_key) WHERE group_key IS NOT NULL AND status = 'PENDING';
CREATE INDEX deliveries_by_provider ON notifications.deliveries (tenant_id, provider_id) WHERE provider_id IS NOT NULL;
-- Plafonds journaliers : comptage par canal et par destinataire sur une fenêtre de temps.
CREATE INDEX deliveries_cap_channel ON notifications.deliveries (tenant_id, channel, updated_at) WHERE status IN ('SENDING','SENT','DELIVERED','BOUNCED','SIMULATED');
CREATE INDEX deliveries_cap_subject ON notifications.deliveries (tenant_id, subject_key, channel, created_at) WHERE status NOT IN ('SKIPPED','CANCELLED');
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications.deliveries TO app_user;

-- -----------------------------------------------------------------------------
-- Préférences et consentement par personne et canal
-- -----------------------------------------------------------------------------
-- `category = '*'` : tout le canal ; sinon une catégorie. La préférence la plus précise l'emporte.
CREATE TABLE notifications.channel_preferences (
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants (id),
  subject_key  text NOT NULL,
  channel      text NOT NULL CHECK (channel IN ('IN_APP','EMAIL','SMS','WHATSAPP','PUSH')),
  category     text NOT NULL CHECK (category = '*' OR category IN ('ATTENDANCE','FINANCE','RESULTS','SCHEDULE','ANNOUNCEMENT','ALERT','URGENT')),
  enabled      boolean NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, subject_key, channel, category)
);
SELECT kernel.enable_tenant_rls('notifications.channel_preferences');
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications.channel_preferences TO app_user;

CREATE TABLE notifications.subject_preferences (
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  subject_key    text NOT NULL,
  quiet_enabled  boolean,
  quiet_start    time,
  quiet_end      time,
  language       text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, subject_key)
);
SELECT kernel.enable_tenant_rls('notifications.subject_preferences');
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications.subject_preferences TO app_user;

-- Journal de consentement (preuve) : append-only.
CREATE TABLE notifications.consent_log (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  at             timestamptz NOT NULL,
  subject_key    text NOT NULL,
  user_id        uuid,
  channel        text NOT NULL CHECK (channel IN ('IN_APP','EMAIL','SMS','WHATSAPP','PUSH')),
  category       text NOT NULL,
  enabled        boolean NOT NULL,
  source         text NOT NULL CHECK (source IN ('SELF','ADMIN','UNSUBSCRIBE_LINK','BOUNCE','IMPORT')),
  actor_user_id  uuid,
  note           text CHECK (note IS NULL OR length(note) <= 300),
  UNIQUE (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('notifications.consent_log');
CREATE INDEX consent_log_by_user ON notifications.consent_log (tenant_id, user_id, at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX consent_log_by_subject ON notifications.consent_log (tenant_id, subject_key, at DESC);
GRANT SELECT, INSERT ON notifications.consent_log TO app_user;

-- -----------------------------------------------------------------------------
-- Liste de suppression (rebonds définitifs, plaintes) : plus aucun envoi à cette adresse sur ce canal
-- -----------------------------------------------------------------------------
CREATE TABLE notifications.suppressions (
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  channel         text NOT NULL CHECK (channel IN ('EMAIL','SMS','WHATSAPP')),
  address_hash    text NOT NULL CHECK (address_hash ~ '^[0-9a-f]{64}$'),
  address_masked  text NOT NULL,
  reason          text NOT NULL CHECK (reason IN ('HARD_BOUNCE','COMPLAINT','INVALID','MANUAL')),
  created_at      timestamptz NOT NULL,
  delivery_id     uuid,
  PRIMARY KEY (tenant_id, channel, address_hash)
);
SELECT kernel.enable_tenant_rls('notifications.suppressions');
GRANT SELECT, INSERT, DELETE ON notifications.suppressions TO app_user;

-- -----------------------------------------------------------------------------
-- Abonnements Web Push (un par appareil)
-- -----------------------------------------------------------------------------
CREATE TABLE notifications.push_subscriptions (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  user_id       uuid NOT NULL,
  endpoint      text NOT NULL CHECK (length(endpoint) <= 2000),
  p256dh        text NOT NULL,
  auth          text NOT NULL,
  device_label  text CHECK (device_label IS NULL OR length(device_label) <= 80),
  user_agent    text CHECK (user_agent IS NULL OR length(user_agent) <= 300),
  created_at    timestamptz NOT NULL,
  last_used_at  timestamptz,
  failure_count integer NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, endpoint)
);
SELECT kernel.enable_tenant_rls('notifications.push_subscriptions');
CREATE INDEX push_subscriptions_by_user ON notifications.push_subscriptions (tenant_id, user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications.push_subscriptions TO app_user;

-- -----------------------------------------------------------------------------
-- Relances d'impayés : registre des paliers atteints (jamais deux fois le même palier)
-- -----------------------------------------------------------------------------
CREATE TABLE notifications.dunning_steps (
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  installment_id  uuid NOT NULL,
  stage_days      integer NOT NULL CHECK (stage_days >= 1),
  invoice_id      uuid NOT NULL,
  learner_id      uuid NOT NULL,
  due_date        date NOT NULL,
  -- Le palier a donné lieu à des remises (le plus haut atteint) ; les paliers inférieurs rattrapés sont consignés sans envoi.
  notified        boolean NOT NULL,
  created_at      timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, installment_id, stage_days)
);
SELECT kernel.enable_tenant_rls('notifications.dunning_steps');
CREATE INDEX dunning_steps_by_invoice ON notifications.dunning_steps (tenant_id, invoice_id);
GRANT SELECT, INSERT, DELETE ON notifications.dunning_steps TO app_user;
