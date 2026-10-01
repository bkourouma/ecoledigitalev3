-- =============================================================================
-- worker 0601 — kernel.processed_events : idempotence des abonnés d'événements
-- =============================================================================
--
-- La livraison des événements est « au moins une fois » (ADR-004). Un abonné qui
-- utilise le wrapper idempotent() réserve (subscriber, event_id) ici, DANS la
-- transaction de son traitement : un doublon rencontre la clé primaire et est
-- ignoré ; un échec annule la réservation avec le reste, l'événement redevient
-- rejouable. event_id est un UUID global (v7) : la clé n'a pas besoin du tenant.
--
-- Table de tenant comme les autres (tenant_id + RLS forcée). Les marques de plus
-- de OUTBOX_RETENTION_DAYS jours sont purgées par le job outbox-cleanup.
--
-- Numérotation : plage 0600-0699 réservée à apps/worker (docs/architecture/module-conventions.md).
-- =============================================================================

CREATE TABLE IF NOT EXISTS kernel.processed_events (
  tenant_id    uuid        NOT NULL REFERENCES kernel.tenants (id) ON DELETE RESTRICT,
  subscriber   text        NOT NULL CHECK (subscriber ~ '^[a-z][a-z0-9_.-]{0,62}$'),
  event_id     uuid        NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subscriber, event_id)
);

-- Purge par âge, tenant par tenant (première colonne = tenant_id, exigé par le test d'isolation).
CREATE INDEX IF NOT EXISTS processed_events_age_idx
  ON kernel.processed_events (tenant_id, processed_at);

SELECT kernel.enable_tenant_rls('kernel.processed_events');

-- Une marque est écrite, lue et purgée ; jamais modifiée.
REVOKE ALL ON kernel.processed_events FROM app_user;
GRANT SELECT, INSERT, DELETE ON kernel.processed_events TO app_user;
