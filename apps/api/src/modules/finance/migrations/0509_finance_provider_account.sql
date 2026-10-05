-- =============================================================================
-- 0509 — Module finance : compte fournisseur utilisé par un paiement en ligne (Q-PAY-30)
-- =============================================================================
--
-- Décision du 2026-10-05 : chaque école configure SON compte fournisseur de paiement
-- (`finance.provider_configs`, secrets scellés) ; une école qui n'en a pas retombe sur le compte de la PLATEFORME
-- (configuration d'environnement). Pour que le rapprochement et les rapports restent SÉPARÉS par école et que l'argent
-- soit toujours interrogé là où il est parti, le compte utilisé est ENREGISTRÉ sur le paiement à l'initiation :
--
--   TENANT   compte marchand propre de l'établissement ;
--   PLATFORM compte marchand de la plateforme (partagé entre établissements : seul `tenant_id` — RLS — rattache
--            l'argent à une école) ;
--   NULL     paiement hors ligne, ou paiement en ligne antérieur à cette migration (compte non tracé : résolution
--            par défaut, comme avant).
--
-- La valeur est figée à l'insertion (déclencheur + `GRANT UPDATE` colonne par colonne déjà restrictif).
-- Additif : aucune donnée existante n'est modifiée.
-- =============================================================================

ALTER TABLE finance.payments
  ADD COLUMN provider_account text;

ALTER TABLE finance.payments
  ADD CONSTRAINT payments_provider_account_check
    CHECK (provider_account IS NULL OR provider_account IN ('TENANT', 'PLATFORM')),
  ADD CONSTRAINT payments_provider_account_online_check
    CHECK (provider_account IS NULL OR method = 'ONLINE');

-- Rapport « par compte » : paiements en ligne d'un tenant regroupés par fournisseur et compte.
CREATE INDEX payments_provider_account_idx ON finance.payments (tenant_id, provider, provider_account)
  WHERE method = 'ONLINE';

-- Le compte d'un paiement ne change jamais (même pour un superutilisateur) : l'argent est parti là.
CREATE FUNCTION finance.payments_account_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.provider_account IS DISTINCT FROM OLD.provider_account THEN
    RAISE EXCEPTION 'finance.payment_immutable: le compte fournisseur d''un paiement est figé' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER payments_account_guard BEFORE UPDATE ON finance.payments
  FOR EACH ROW EXECUTE FUNCTION finance.payments_account_guard();
