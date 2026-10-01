-- =============================================================================
-- worker 0603 — index de purge des événements publiés
-- =============================================================================
--
-- Le job outbox-cleanup supprime, par tenant et par lots, les événements publiés
-- depuis plus de N jours. Sans cet index chaque lot parcourrait tous les événements
-- du tenant. Index partiel : il ne contient que les lignes publiées (les lignes en
-- attente restent servies par domain_events_pending_idx).
-- =============================================================================

CREATE INDEX IF NOT EXISTS domain_events_published_idx
  ON kernel.domain_events (tenant_id, published_at)
  WHERE published_at IS NOT NULL;
