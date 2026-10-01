-- =============================================================================
-- worker 0602 — LISTEN/NOTIFY : réveil immédiat du relais d'outbox
-- =============================================================================
--
-- Après chaque INSERT dans kernel.domain_events, une notification est envoyée sur
-- le canal `ed_domain_events` avec, pour charge utile, le tenant_id du lot inséré
-- (une notification par tenant distinct, dédoublonnée par Postgres au sein de la
-- transaction). Elle n'est délivrée qu'au COMMIT : jamais d'événement fantôme.
--
-- C'est un ACCÉLÉRATEUR de latence, pas un mécanisme de livraison : le relais
-- balaie périodiquement tous les tenants et rattrape tout signal perdu.
-- Trigger par instruction (pas par ligne) : coût négligeable pour un insert en lot.
-- =============================================================================

CREATE OR REPLACE FUNCTION kernel.notify_domain_events()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify('ed_domain_events', t.tenant_id::text)
     FROM (SELECT DISTINCT tenant_id FROM new_rows) AS t;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS domain_events_notify ON kernel.domain_events;
CREATE TRIGGER domain_events_notify
  AFTER INSERT ON kernel.domain_events
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION kernel.notify_domain_events();
