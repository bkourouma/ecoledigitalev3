-- =============================================================================
-- 1601 — analytics : indicateurs transverses de direction + alertes configurables (spec v2/025, partie B)
-- =============================================================================
-- Plage 1600-1699. Même principe que 1600 : instantanés DÉRIVÉS, sans clé étrangère vers un autre module (seul
-- kernel.tenants est référencé), RLS forcée sur chaque table, GRANT app_user.
--
--   1. provenance des règles d'une période de résultats (bandeau « règles de démonstration »)
--   2. entonnoir d'admission (campagnes + répartition par étape) — comptages, aucune candidature, aucun nom
--   3. vie scolaire AGRÉGÉE (quatre comptages, éléments de confidentialité STANDARD seulement) — aucun élève
--   4. alertes : règles par établissement, alertes (épisodes de dépassement) et notifications émises (anti-doublon)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Nouveaux genres de rafraîchissement
-- -----------------------------------------------------------------------------

ALTER TABLE analytics.refresh_requests DROP CONSTRAINT refresh_requests_kind_check;
ALTER TABLE analytics.refresh_requests ADD CONSTRAINT refresh_requests_kind_check CHECK (kind IN
  ('REBUILD','CALENDAR','ENROLLMENT','RESULTS','ATTENDANCE','STAFF_PRESENCE','FINANCE','COLLECTIONS','CASH','PAYROLL','TEACHING_LOAD','ADMISSIONS','SCHOOLLIFE'));

-- -----------------------------------------------------------------------------
-- 1. Provenance des règles des résultats FINAL
-- -----------------------------------------------------------------------------

-- `placeholder` = jeu de règles de DÉMONSTRATION (rules/results) : tout chiffre qui en dérive porte un bandeau. `NULL` : non lisible.
ALTER TABLE analytics.result_scopes
  ADD COLUMN rules_source_kind text CHECK (rules_source_kind IN ('regulation','institution','platform','placeholder'));

-- -----------------------------------------------------------------------------
-- 2. Entonnoir d'admission
-- -----------------------------------------------------------------------------

CREATE TABLE analytics.admissions_campaign_facts (
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants(id),
  campaign_id    uuid NOT NULL,
  institution_id uuid NOT NULL,
  year_id        uuid,
  code           text NOT NULL,
  label          text NOT NULL,
  status         text NOT NULL,
  -- Places offertes (somme des capacités) et places restantes ; NULL si la source ne les donne pas.
  seats          integer CHECK (seats >= 0),
  seats_left     integer,
  refreshed_at   timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, campaign_id)
);

-- Répartition des dossiers par ÉTAPE du workflow de la campagne (comptage seulement).
CREATE TABLE analytics.admissions_stage_facts (
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants(id),
  campaign_id      uuid NOT NULL,
  stage_code       text NOT NULL,
  stage_label      text NOT NULL,
  canonical_status text NOT NULL,
  ordinal          integer NOT NULL,
  is_terminal      boolean NOT NULL DEFAULT false,
  applications     integer NOT NULL CHECK (applications >= 0),
  refreshed_at     timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, campaign_id, stage_code)
);
CREATE INDEX admissions_stage_facts_status_ix ON analytics.admissions_stage_facts (tenant_id, canonical_status);

-- -----------------------------------------------------------------------------
-- 3. Vie scolaire agrégée
-- -----------------------------------------------------------------------------

-- Quatre comptages par établissement (`institution_key` = identifiant ou '*' pour tout le tenant). Ni élève, ni texte libre,
-- ni élément restreint ou confidentiel : le port source ne compte que la confidentialité STANDARD.
CREATE TABLE analytics.schoollife_facts (
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants(id),
  institution_key text NOT NULL,
  indicator       text NOT NULL CHECK (indicator IN ('OPEN_INCIDENTS','MEASURES_TO_VALIDATE','ACTIVE_EXCLUSIONS','CONVOCATIONS_TO_HOLD')),
  value           integer NOT NULL CHECK (value >= 0),
  refreshed_at    timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, institution_key, indicator)
);

-- -----------------------------------------------------------------------------
-- 4. Alertes configurables
-- -----------------------------------------------------------------------------

-- Règle d'alerte d'un établissement : un indicateur du catalogue (domain/alert-metrics.ts), deux seuils (attention, critique)
-- exprimés dans l'UNITÉ de l'indicateur (points de base, unités mineures de la monnaie, nombre), un périmètre facultatif,
-- les RÔLES destinataires et la fréquence maximale de rappel. La règle ne calcule rien : elle lit les read-models.
CREATE TABLE analytics.alert_rules (
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants(id),
  id                uuid NOT NULL,
  label             text NOT NULL CHECK (length(label) BETWEEN 3 AND 120),
  metric            text NOT NULL CHECK (metric ~ '^[A-Z][A-Z0-9_]{2,59}$'),
  warning_value     bigint,
  critical_value    bigint,
  window_days       integer CHECK (window_days BETWEEN 1 AND 365),
  institution_id    uuid,
  campus_id         uuid,
  recipient_roles   text[] NOT NULL CHECK (cardinality(recipient_roles) BETWEEN 1 AND 8),
  frequency         text NOT NULL CHECK (frequency IN ('HOURLY','DAILY','WEEKLY','MONTHLY')),
  enabled           boolean NOT NULL DEFAULT true,
  row_version       integer NOT NULL DEFAULT 1,
  last_evaluated_at timestamptz,
  last_outcome      text CHECK (last_outcome IN ('OK','WARNING','CRITICAL','NOT_MEASURED','SOURCE_UNAVAILABLE')),
  last_value        bigint,
  created_by        uuid,
  created_at        timestamptz NOT NULL,
  updated_by        uuid,
  updated_at        timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CHECK (warning_value IS NOT NULL OR critical_value IS NOT NULL)
);
CREATE INDEX alert_rules_enabled_ix ON analytics.alert_rules (tenant_id, enabled);

-- Alerte = épisode de dépassement d'une règle (de l'ouverture au retour à la normale). Une SEULE alerte active par règle.
CREATE TABLE analytics.alert_events (
  tenant_id            uuid NOT NULL REFERENCES kernel.tenants(id),
  id                   uuid NOT NULL,
  rule_id              uuid NOT NULL,
  metric               text NOT NULL,
  severity             text NOT NULL CHECK (severity IN ('WARNING','CRITICAL')),
  status               text NOT NULL CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
  value                bigint NOT NULL,
  threshold            bigint NOT NULL,
  currency             text,
  institution_id       uuid,
  campus_id            uuid,
  year_id              uuid,
  period_id            uuid,
  raised_at            timestamptz NOT NULL,
  last_seen_at         timestamptz NOT NULL,
  as_of                timestamptz,
  notify_count         integer NOT NULL DEFAULT 0,
  last_notified_at     timestamptz,
  acknowledged_by      uuid,
  acknowledged_at      timestamptz,
  acknowledgement_note text CHECK (acknowledgement_note IS NULL OR length(acknowledgement_note) <= 500),
  resolved_at          timestamptz,
  resolved_value       bigint,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, rule_id) REFERENCES analytics.alert_rules (tenant_id, id),
  CHECK (status <> 'ACKNOWLEDGED' OR acknowledged_at IS NOT NULL),
  CHECK (status <> 'RESOLVED' OR resolved_at IS NOT NULL)
);
CREATE UNIQUE INDEX alert_events_active_uq ON analytics.alert_events (tenant_id, rule_id) WHERE status IN ('OPEN','ACKNOWLEDGED');
CREATE INDEX alert_events_listing_ix ON analytics.alert_events (tenant_id, status, raised_at DESC);
CREATE INDEX alert_events_rule_ix ON analytics.alert_events (tenant_id, rule_id, raised_at DESC);

-- Notifications ÉMISES (historique + anti-doublon) : la clé de dédoublonnage (règle, alerte, gravité, créneau de fréquence)
-- est UNIQUE : deux évaluations simultanées ou rejouées n'émettent jamais deux fois le même créneau.
CREATE TABLE analytics.alert_notifications (
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants(id),
  id              uuid NOT NULL,
  alert_id        uuid NOT NULL,
  dedupe_key      text NOT NULL,
  reason          text NOT NULL CHECK (reason IN ('RAISED','ESCALATED','REMINDER')),
  severity        text NOT NULL CHECK (severity IN ('WARNING','CRITICAL')),
  value           bigint NOT NULL,
  recipient_roles text[] NOT NULL,
  emitted_at      timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, dedupe_key),
  FOREIGN KEY (tenant_id, alert_id) REFERENCES analytics.alert_events (tenant_id, id)
);
CREATE INDEX alert_notifications_alert_ix ON analytics.alert_notifications (tenant_id, alert_id, emitted_at);

SELECT kernel.enable_tenant_rls('analytics.admissions_campaign_facts');
SELECT kernel.enable_tenant_rls('analytics.admissions_stage_facts');
SELECT kernel.enable_tenant_rls('analytics.schoollife_facts');
SELECT kernel.enable_tenant_rls('analytics.alert_rules');
SELECT kernel.enable_tenant_rls('analytics.alert_events');
SELECT kernel.enable_tenant_rls('analytics.alert_notifications');

GRANT SELECT, INSERT, UPDATE, DELETE ON
  analytics.admissions_campaign_facts, analytics.admissions_stage_facts, analytics.schoollife_facts,
  analytics.alert_rules, analytics.alert_events, analytics.alert_notifications
  TO app_user;
