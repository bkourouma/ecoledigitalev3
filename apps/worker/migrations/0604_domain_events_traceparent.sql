-- =============================================================================
-- worker 0604 — contexte de trace W3C dans l'outbox (ADR-009)
-- =============================================================================
--
-- `traceparent` (`00-<trace-id 32 hex>-<span-id 16 hex>-<flags 2 hex>`) porte le contexte de trace de la requête HTTP qui a
-- émis l'événement ; le relais le transmet au job BullMQ et le worker en fait le parent de ses spans : une requête, son
-- événement et ses abonnés forment UNE trace. Aucune donnée personnelle : trois identifiants aléatoires et un drapeau.
--
-- Colonne NULLABLE et additive : renseignée seulement quand le traçage est actif (PgOutboxWriter), absente sinon ; aucun
-- contrat d'événement (payload) n'est touché. Le contenu d'un événement reste immuable : la colonne n'est PAS ajoutée aux
-- colonnes modifiables par app_user (GRANT UPDATE de 0003).
-- =============================================================================

ALTER TABLE kernel.domain_events
  ADD COLUMN IF NOT EXISTS traceparent text
  CHECK (traceparent IS NULL OR traceparent ~ '^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$');
