-- =============================================================================
-- 1003 — Module rules : gardes d'intégrité (défense en profondeur)
-- =============================================================================
--
-- Le domaine (TypeScript, `canTransition` du moteur) applique ces règles ; la base les IMPOSE — un bug
-- applicatif ou une requête manuelle ne peut ni réécrire une règle approuvée, ni faire une transition
-- illégale, ni supprimer une version :
--
--   R-RUL-02  une version hors brouillon/simulée est IMMUABLE (règles, paramètres, bornes, source, dates d'effet) ;
--             seuls le statut, les marques d'approbation et la CLÔTURE de `effective_to` évoluent ;
--   AC3.1     les transitions légales sont le miroir SQL de `TRANSITIONS` (packages/rules-engine, governance.ts) ;
--   AC3.2     une transition vers approved/published/retired d'une VARIANTE exige l'acteur `superAdmin` ;
--   AC3.4     séparation des tâches (réglage `national_four_eyes`) ;
--   AC4.5     ni DELETE d'un jeu ou d'une version (les règles d'un brouillon peuvent être retirées) ;
--   journaux  append-only.
--
-- Codes d'erreur : `restrict_violation` (23001). Le message commence par un code stable `rules.*`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Écritures strictement append-only / suppressions interdites
-- -----------------------------------------------------------------------------
CREATE FUNCTION rules.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'rules.immutable: % est immuable (% interdit)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;

CREATE TRIGGER national_version_events_immutable BEFORE UPDATE OR DELETE ON rules.national_version_events
  FOR EACH ROW EXECUTE FUNCTION rules.forbid_mutation();
CREATE TRIGGER version_events_immutable BEFORE UPDATE OR DELETE ON rules.version_events
  FOR EACH ROW EXECUTE FUNCTION rules.forbid_mutation();
CREATE TRIGGER simulation_differences_no_update BEFORE UPDATE ON rules.simulation_differences
  FOR EACH ROW EXECUTE FUNCTION rules.forbid_mutation();
CREATE TRIGGER national_rule_sets_no_delete BEFORE DELETE ON rules.national_rule_sets
  FOR EACH ROW EXECUTE FUNCTION rules.forbid_mutation();
CREATE TRIGGER national_rule_versions_no_delete BEFORE DELETE ON rules.national_rule_versions
  FOR EACH ROW EXECUTE FUNCTION rules.forbid_mutation();
CREATE TRIGGER rule_sets_no_delete BEFORE DELETE ON rules.rule_sets
  FOR EACH ROW EXECUTE FUNCTION rules.forbid_mutation();
CREATE TRIGGER rule_versions_no_delete BEFORE DELETE ON rules.rule_versions
  FOR EACH ROW EXECUTE FUNCTION rules.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Règles d'une version : modifiables uniquement tant que la version est en brouillon ou simulée.
-- Argument : 'national' | 'tenant' (table parente).
-- -----------------------------------------------------------------------------
CREATE FUNCTION rules.definitions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_version uuid;
  v_status  text;
BEGIN
  v_version := CASE WHEN TG_OP = 'DELETE' THEN OLD.rule_version_id ELSE NEW.rule_version_id END;
  IF TG_ARGV[0] = 'national' THEN
    SELECT status INTO v_status FROM rules.national_rule_versions WHERE id = v_version;
  ELSE
    SELECT status INTO v_status FROM rules.rule_versions WHERE id = v_version;
  END IF;

  -- Parente introuvable (ou invisible sous RLS) : la FK tranchera à l'insertion.
  IF v_status IS NOT NULL AND v_status NOT IN ('draft', 'simulated') THEN
    RAISE EXCEPTION 'rules.version_immutable: les règles d''une version « % » ne se modifient pas (créez une nouvelle version)', v_status
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.rule_version_id <> OLD.rule_version_id THEN
    RAISE EXCEPTION 'rules.version_immutable: une règle ne change pas de version' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

CREATE TRIGGER national_rule_definitions_guard BEFORE INSERT OR UPDATE OR DELETE ON rules.national_rule_definitions
  FOR EACH ROW EXECUTE FUNCTION rules.definitions_guard('national');
CREATE TRIGGER rule_definitions_guard BEFORE INSERT OR UPDATE OR DELETE ON rules.rule_definitions
  FOR EACH ROW EXECUTE FUNCTION rules.definitions_guard('tenant');

-- -----------------------------------------------------------------------------
-- Une version naît en brouillon : le chemin vers « publiée » passe par la machine d'états
-- (et laisse donc une trace dans l'historique), même pour les données de départ.
-- -----------------------------------------------------------------------------
CREATE FUNCTION rules.versions_insert_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'draft' THEN
    RAISE EXCEPTION 'rules.transition_forbidden: une version naît en brouillon (reçu : %)', NEW.status
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER national_rule_versions_insert_guard BEFORE INSERT ON rules.national_rule_versions
  FOR EACH ROW EXECUTE FUNCTION rules.versions_insert_guard();
CREATE TRIGGER rule_versions_insert_guard BEFORE INSERT ON rules.rule_versions
  FOR EACH ROW EXECUTE FUNCTION rules.versions_insert_guard();

-- -----------------------------------------------------------------------------
-- Versions (communes aux deux familles) : identité figée, transitions légales (miroir de
-- TRANSITIONS), immuabilité hors brouillon/simulée, séparation des tâches nationale.
-- Argument : 'national' | 'tenant'.
-- -----------------------------------------------------------------------------
CREATE FUNCTION rules.versions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_legal     boolean;
  v_editable  boolean := OLD.status IN ('draft', 'simulated');
  v_reopen    boolean := OLD.status = 'proposed' AND NEW.status = 'draft';
  v_four_eyes boolean;
BEGIN
  IF NEW.id <> OLD.id OR NEW.rule_set_id <> OLD.rule_set_id OR NEW.version <> OLD.version
     OR NEW.contract_id <> OLD.contract_id OR NEW.created_at <> OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'rules.version_immutable: identité de la version figée' USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.status <> OLD.status THEN
    v_legal := CASE OLD.status
      WHEN 'draft'     THEN NEW.status = 'simulated'
      WHEN 'simulated' THEN NEW.status IN ('proposed', 'draft')
      WHEN 'proposed'  THEN NEW.status IN ('approved', 'draft')
      WHEN 'approved'  THEN NEW.status IN ('published', 'retired')
      WHEN 'published' THEN NEW.status = 'retired'
      ELSE false
    END;
    IF NOT v_legal THEN
      RAISE EXCEPTION 'rules.transition_forbidden: % -> % n''est pas une transition légale', OLD.status, NEW.status
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  IF NOT v_editable AND NOT v_reopen THEN
    IF NEW.effective_from <> OLD.effective_from
       OR NEW.source_kind <> OLD.source_kind
       OR NEW.source_reference IS DISTINCT FROM OLD.source_reference
       OR NEW.source_url IS DISTINCT FROM OLD.source_url
       OR NEW.source_description IS DISTINCT FROM OLD.source_description
       OR NEW.definition_hash IS DISTINCT FROM OLD.definition_hash
       OR (to_jsonb(NEW) ->> 'based_on_version_id') IS DISTINCT FROM (to_jsonb(OLD) ->> 'based_on_version_id') THEN
      RAISE EXCEPTION 'rules.version_immutable: le contenu d''une version « % » est immuable', OLD.status
        USING ERRCODE = 'restrict_violation';
    END IF;
    -- la période d'effet ne peut qu'être CLÔTURÉE (jamais prolongée ni rouverte)
    IF NEW.effective_to IS DISTINCT FROM OLD.effective_to
       AND (NEW.effective_to IS NULL OR (OLD.effective_to IS NOT NULL AND NEW.effective_to > OLD.effective_to)) THEN
      RAISE EXCEPTION 'rules.version_immutable: la période d''effet d''une version « % » ne peut qu''être clôturée', OLD.status
        USING ERRCODE = 'restrict_violation';
    END IF;
    -- l'approbateur est posé UNE fois, par la transition d'approbation
    IF NEW.approved_by IS DISTINCT FROM OLD.approved_by AND NOT (OLD.status = 'proposed' AND NEW.status = 'approved') THEN
      RAISE EXCEPTION 'rules.version_immutable: l''approbateur ne change pas' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  -- Séparation des tâches du catalogue national (AC3.4).
  IF TG_ARGV[0] = 'national' AND OLD.status = 'proposed' AND NEW.status = 'approved' THEN
    SELECT coalesce((value)::text = 'true', true) INTO v_four_eyes FROM rules.platform_settings WHERE key = 'national_four_eyes';
    IF coalesce(v_four_eyes, true) AND NEW.created_by IS NOT NULL AND NEW.approved_by = NEW.created_by THEN
      RAISE EXCEPTION 'rules.four_eyes: l''auteur d''une version nationale ne peut pas l''approuver'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER national_rule_versions_guard BEFORE UPDATE ON rules.national_rule_versions
  FOR EACH ROW EXECUTE FUNCTION rules.versions_guard('national');
CREATE TRIGGER rule_versions_guard BEFORE UPDATE ON rules.rule_versions
  FOR EACH ROW EXECUTE FUNCTION rules.versions_guard('tenant');

-- -----------------------------------------------------------------------------
-- Variantes d'établissement : approuver / publier / retirer est réservé au super-administrateur
-- (acteur `superAdmin`, posé par TenantDb pour un contexte d'opérateur). Un administrateur
-- d'établissement qui tenterait `UPDATE … SET status = 'approved'` est refusé ici.
-- -----------------------------------------------------------------------------
CREATE FUNCTION rules.tenant_versions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id THEN
    RAISE EXCEPTION 'rules.version_immutable: le tenant d''une version ne change pas' USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.status <> OLD.status AND NEW.status IN ('approved', 'published', 'retired')
     AND kernel.current_actor() IS DISTINCT FROM 'superAdmin' THEN
    RAISE EXCEPTION 'rules.transition_forbidden: seul un super-administrateur peut passer une variante à « % »', NEW.status
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- La simulation et la confirmation d'impact sont figées avec la proposition.
  IF OLD.status NOT IN ('draft', 'simulated') AND NOT (OLD.status = 'proposed' AND NEW.status = 'draft')
     AND (NEW.last_simulation_id IS DISTINCT FROM OLD.last_simulation_id
          OR NEW.decision_impact_confirmed_by IS DISTINCT FROM OLD.decision_impact_confirmed_by
          OR NEW.decision_impact_confirmed_at IS DISTINCT FROM OLD.decision_impact_confirmed_at) THEN
    RAISE EXCEPTION 'rules.version_immutable: la simulation d''une version « % » est figée', OLD.status
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER rule_versions_tenant_guard BEFORE UPDATE ON rules.rule_versions
  FOR EACH ROW EXECUTE FUNCTION rules.tenant_versions_guard();
