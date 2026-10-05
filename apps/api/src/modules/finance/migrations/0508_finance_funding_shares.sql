-- =============================================================================
-- 0508 — Module finance : CUMUL de financements, parts contrôlées (O-04)
-- =============================================================================
--
-- Décision du propriétaire : une inscription peut cumuler plusieurs financements (ex. bourse + État + famille). La facturation
-- savait déjà émettre une facture par financeur (une par bourse) ; ce qui manquait :
--
--   1. une base de calcul explicite pour que les parts se COMPOSENT sans surprise : `share_basis`
--        REMAINING (défaut, comportement historique) : le pourcentage porte sur le reste après les bourses de priorité inférieure ;
--        TOTAL : le pourcentage porte sur le total net à facturer. Deux parts TOTAL de 40 % et 60 % couvrent 100 %, pas 76 % ;
--   2. un CONTRÔLE de la somme : la somme des parts TOTAL en pourcentage, ACTIVES, d'un apprenant pour une année ne dépasse pas
--      100 % (10 000 points de base) ; imposé par la base, pour un superutilisateur aussi ;
--   3. le cumul de types de financement sur le compte de l'apprenant : `additional_funding_types` (le type principal
--      `funding_type` reste lu tel quel par tous les consommateurs).
--
-- Additif : toutes les bourses existantes restent `REMAINING` ; aucun comportement historique ne change.
-- =============================================================================

ALTER TABLE finance.scholarships
  ADD COLUMN share_basis text NOT NULL DEFAULT 'REMAINING' CHECK (share_basis IN ('REMAINING', 'TOTAL'));

ALTER TABLE finance.learner_accounts
  ADD COLUMN additional_funding_types text[] NOT NULL DEFAULT '{}'
  CHECK (additional_funding_types <@ ARRAY['PRIVATE', 'STATE_ASSIGNED', 'SCHOLARSHIP', 'COMPANY', 'STAFF_CHILD', 'OTHER']::text[]);

CREATE FUNCTION finance.scholarship_shares_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_others bigint;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.share_basis IS DISTINCT FROM OLD.share_basis THEN
    RAISE EXCEPTION 'finance.immutable: la base de calcul d''une prise en charge ne change pas (en créer une nouvelle)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status = 'ACTIVE' AND NEW.share_basis = 'TOTAL' AND NEW.coverage_kind = 'PERCENT' THEN
    -- Sérialise les écritures concurrentes d'un même apprenant et d'une même année.
    PERFORM pg_advisory_xact_lock(hashtextextended('finance.scholarship_shares:' || NEW.tenant_id::text || ':' || NEW.learner_id::text || ':' || NEW.academic_year, 0));
    SELECT coalesce(sum(s.coverage_bps), 0) INTO v_others
      FROM finance.scholarships s
     WHERE s.tenant_id = NEW.tenant_id AND s.learner_id = NEW.learner_id AND s.academic_year = NEW.academic_year
       AND s.id <> NEW.id AND s.status = 'ACTIVE' AND s.share_basis = 'TOTAL' AND s.coverage_kind = 'PERCENT';
    IF v_others + NEW.coverage_bps > 10000 THEN
      RAISE EXCEPTION 'finance.funding_shares_exceed: la somme des parts de financement dépasse 100 %% (% + % points de base)', v_others, NEW.coverage_bps
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER scholarship_shares_guard BEFORE INSERT OR UPDATE ON finance.scholarships
  FOR EACH ROW EXECUTE FUNCTION finance.scholarship_shares_guard();
