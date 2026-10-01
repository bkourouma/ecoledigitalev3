-- =============================================================================
-- 0003 — Outbox transactionnelle : kernel.domain_events
-- =============================================================================
--
-- Les événements de domaine sont écrits DANS LA TRANSACTION de la donnée
-- métier (PgOutboxWriter) : validés ou annulés ensemble. Un relais (futur
-- apps/worker) les lit ensuite par tenant et les pousse vers la file de jobs.
--
-- Table de tenant comme les autres : tenant_id NOT NULL + RLS forcée. Le relais
-- n'a donc pas de vue globale : il itère les tenants (SystemDb.forEachTenant).
--
-- L'application ne peut modifier que l'état de livraison (published_at,
-- attempts, last_error, available_at) : le contenu d'un événement est
-- immuable par construction (GRANT UPDATE par colonne).
-- =============================================================================

CREATE TABLE IF NOT EXISTS kernel.domain_events (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id) ON DELETE RESTRICT,
  type           text NOT NULL
                 CHECK (type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  version        integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  aggregate_type text,
  aggregate_id   text,
  actor_id       uuid,
  request_id     text,
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at    timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz,
  attempts       integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error     text,
  available_at   timestamptz NOT NULL DEFAULT now()
);

-- File d'attente du relais : événements non publiés, par ordre d'identifiant (v7 = ordre de création).
CREATE INDEX IF NOT EXISTS domain_events_pending_idx
  ON kernel.domain_events (tenant_id, available_at, id)
  WHERE published_at IS NULL;

SELECT kernel.enable_tenant_rls('kernel.domain_events');

-- Contenu immuable : on retire l'UPDATE global posé par les droits par défaut,
-- puis on n'accorde que les colonnes d'état de livraison.
REVOKE UPDATE ON kernel.domain_events FROM app_user;
GRANT UPDATE (published_at, attempts, last_error, available_at)
  ON kernel.domain_events TO app_user;
