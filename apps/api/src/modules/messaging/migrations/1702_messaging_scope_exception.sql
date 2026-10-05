-- =============================================================================
-- 1702 — Module messaging : fil ouvert HORS de la portée habituelle (décision Q-13, 2026-10-05)
-- =============================================================================
--
-- Un membre du personnel qui détient la permission explicite `messaging.send.any_family` (accordée par la direction) peut écrire
-- aux tuteurs de TOUTE famille de l'établissement, pas seulement à ceux de ses classes. Chaque envoi hors de la portée habituelle
-- est journalisé dans l'audit (module `audit`, même transaction) ; pour que les messages SUIVANTS du même fil le soient aussi, le
-- fil porte la règle d'exception qui l'a ouvert. Aucune donnée de message n'est copiée : seule la règle (code) est conservée.
-- Colonne additive, nullable : les fils existants (portée habituelle) restent NULL.
-- =============================================================================

ALTER TABLE messaging.conversations
  ADD COLUMN scope_exception text CHECK (scope_exception IS NULL OR scope_exception IN ('SEND_ANY_FAMILY'));

CREATE INDEX conversations_scope_exception_idx ON messaging.conversations (tenant_id, created_by) WHERE scope_exception IS NOT NULL;
