-- =============================================================================
-- 0710 — Module academic : CUMUL de financements sur une inscription (O-04)
-- =============================================================================
--
-- Décision du propriétaire : une inscription peut être financée par plusieurs sources à la fois (ex. bourse + État + famille).
-- `academic.enrollments.funding_type` reste le type PRINCIPAL (lu tel quel par les modules voisins : people, analytics, admissions,
-- finance) ; cette table porte les PARTS du cumul :
--
--   share_kind = PERCENT : part en points de base (1..10000) du montant à financer ;
--   share_kind = AMOUNT  : part en montant entier (unité mineure de la devise).
--
-- Le reste est à la charge de la famille (financement privé IMPLICITE : `PRIVATE` n'est jamais une part).
-- Contrôles imposés par la base (valables pour un superutilisateur) :
--   - la somme des parts PERCENT vivantes d'une inscription ne dépasse jamais 10000 points de base (100 %) ;
--   - les parts AMOUNT vivantes d'une inscription partagent la même devise ;
--   - une part vivante par (type, financeur, référence) ;
--   - une part terminée (ENDED) ne se modifie plus ; jamais de DELETE (historique).
-- Additif : aucune ligne n'existe tant que personne ne déclare de cumul ; une inscription sans part se lit comme avant.
-- =============================================================================

CREATE TABLE academic.enrollment_fundings (
  id                    uuid PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES kernel.tenants (id),
  enrollment_id         uuid NOT NULL,
  funding_type          text NOT NULL,
  share_kind            text NOT NULL CHECK (share_kind IN ('PERCENT', 'AMOUNT')),
  share_bps             integer CHECK (share_bps BETWEEN 1 AND 10000),
  share_amount          bigint CHECK (share_amount > 0),
  currency              text CHECK (currency IN ('XOF', 'XAF', 'EUR', 'USD')),
  funder_label          text CHECK (funder_label IS NULL OR length(btrim(funder_label)) > 0),
  assignment_reference  text CHECK (assignment_reference IS NULL OR length(btrim(assignment_reference)) > 0),
  notes                 text,
  status                text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ENDED')),
  created_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  ended_at              timestamptz,
  UNIQUE (tenant_id, id),
  CHECK (funding_type <> 'PRIVATE'),
  CHECK ((share_kind = 'PERCENT' AND share_bps IS NOT NULL AND share_amount IS NULL AND currency IS NULL)
      OR (share_kind = 'AMOUNT' AND share_amount IS NOT NULL AND share_bps IS NULL AND currency IS NOT NULL)),
  CHECK ((status = 'ENDED') = (ended_at IS NOT NULL)),
  FOREIGN KEY (tenant_id, enrollment_id) REFERENCES academic.enrollments (tenant_id, id),
  FOREIGN KEY (tenant_id, funding_type) REFERENCES academic.funding_types (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('academic.enrollment_fundings');
CREATE UNIQUE INDEX enrollment_fundings_one_live
  ON academic.enrollment_fundings (tenant_id, enrollment_id, funding_type, coalesce(funder_label, ''), coalesce(assignment_reference, ''))
  WHERE status = 'ACTIVE';
CREATE INDEX enrollment_fundings_by_enrollment ON academic.enrollment_fundings (tenant_id, enrollment_id, status);
GRANT SELECT, INSERT, UPDATE ON academic.enrollment_fundings TO app_user;

CREATE FUNCTION academic.enrollment_fundings_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_bps      bigint;
  v_currency integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'academic.immutable: enrollment_fundings ne se supprime pas (historique du cumul)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'ENDED' THEN
      RAISE EXCEPTION 'academic.immutable: une part de financement terminée ne se modifie plus' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.enrollment_id <> OLD.enrollment_id OR NEW.funding_type <> OLD.funding_type
       OR NEW.share_kind <> OLD.share_kind OR NEW.share_bps IS DISTINCT FROM OLD.share_bps OR NEW.share_amount IS DISTINCT FROM OLD.share_amount
       OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.funder_label IS DISTINCT FROM OLD.funder_label
       OR NEW.assignment_reference IS DISTINCT FROM OLD.assignment_reference OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'academic.immutable: le contenu d''une part de financement ne se modifie pas (terminer puis recréer)' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- INSERT : sérialise les ajouts concurrents sur la même inscription (verrou de la ligne d'inscription), puis contrôle le cumul.
  PERFORM 1 FROM academic.enrollments e WHERE e.tenant_id = NEW.tenant_id AND e.id = NEW.enrollment_id FOR UPDATE;
  IF NEW.status = 'ACTIVE' THEN
    SELECT coalesce(sum(f.share_bps), 0) INTO v_bps
      FROM academic.enrollment_fundings f
     WHERE f.tenant_id = NEW.tenant_id AND f.enrollment_id = NEW.enrollment_id AND f.status = 'ACTIVE' AND f.share_kind = 'PERCENT';
    IF NEW.share_kind = 'PERCENT' AND v_bps + NEW.share_bps > 10000 THEN
      RAISE EXCEPTION 'academic.funding_shares_exceed: la somme des parts de financement dépasse 100 %% (% + % points de base)', v_bps, NEW.share_bps
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.share_kind = 'AMOUNT' THEN
      SELECT count(DISTINCT f.currency) INTO v_currency
        FROM academic.enrollment_fundings f
       WHERE f.tenant_id = NEW.tenant_id AND f.enrollment_id = NEW.enrollment_id AND f.status = 'ACTIVE' AND f.share_kind = 'AMOUNT' AND f.currency <> NEW.currency;
      IF v_currency > 0 THEN
        RAISE EXCEPTION 'academic.funding_currency_mismatch: les parts en montant d''une inscription partagent la même devise'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER enrollment_fundings_guard BEFORE INSERT OR UPDATE OR DELETE ON academic.enrollment_fundings
  FOR EACH ROW EXECUTE FUNCTION academic.enrollment_fundings_guard();
