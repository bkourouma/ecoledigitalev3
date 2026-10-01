-- =============================================================================
-- 1303 — Module reportcards : gardes d'intégrité (défense en profondeur)
-- =============================================================================
--
-- L'application applique ces règles ; la base les IMPOSE. Un déclencheur s'exécute pour TOUT rôle, y compris un
-- superutilisateur : un bug applicatif, une requête manuelle ou un compte d'exploitation ne peuvent ni réécrire un snapshot,
-- ni le supprimer, ni faire une transition illégale.
--
--   R-RC-02  un snapshot est immuable ; seuls évoluent : statut (transitions légales), publication / retrait, remplacement,
--            révocation et rendu courant ;
--   R-RC-03  une version supérieure remplace la précédente sans la supprimer (supersession atomique avec l'insertion) ;
--   R-RC-09  le hash est RECALCULÉ ici (JSON canonique, SHA-256) et doit égaler celui que l'application a calculé ;
--   append-only : renders RENDERED, branding_versions, template_configs, journaux.
--
-- Codes d'erreur stables : le message commence par `reportcards.<code>` ; ERRCODE `restrict_violation` (23001).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- JSON canonique : clés triées par ORDRE D'OCTETS UTF-8 (COLLATE "C"), sans espace, chaînes normalisées NFC et échappées
-- comme JSON.stringify, entiers seulement (aucun flottant : les décimaux exacts sont des chaînes). Miroir exact de
-- `domain/canonical.ts` ; les vecteurs de test communs (accents, décimaux, listes ordonnées) vérifient l'égalité.
-- -----------------------------------------------------------------------------
CREATE FUNCTION reportcards.canonical_json(v jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  t text := jsonb_typeof(v);
  r text;
  n text;
BEGIN
  IF t IS NULL THEN
    RAISE EXCEPTION 'reportcards.canonical_null: valeur absente' USING ERRCODE = 'restrict_violation';
  ELSIF t = 'object' THEN
    SELECT '{' || coalesce(string_agg(to_jsonb(e.k)::text || ':' || reportcards.canonical_json(e.val), ',' ORDER BY e.k COLLATE "C"), '') || '}'
      INTO r
      FROM (SELECT normalize(je.key, NFC) AS k, je.value AS val FROM jsonb_each(v) AS je) AS e;
    RETURN r;
  ELSIF t = 'array' THEN
    SELECT '[' || coalesce(string_agg(reportcards.canonical_json(a.val), ',' ORDER BY a.ord), '') || ']'
      INTO r
      FROM jsonb_array_elements(v) WITH ORDINALITY AS a(val, ord);
    RETURN r;
  ELSIF t = 'string' THEN
    RETURN to_jsonb(normalize(v #>> '{}', NFC))::text;
  ELSIF t = 'number' THEN
    n := v #>> '{}';
    IF n !~ '^(0|-?[1-9][0-9]{0,15})$' OR abs(n::numeric) > 9007199254740991 THEN
      RAISE EXCEPTION 'reportcards.canonical_number: seuls les entiers sûrs sont autorisés (reçu %)', n USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN n;
  ELSIF t = 'boolean' THEN
    RETURN CASE WHEN v = 'true'::jsonb THEN 'true' ELSE 'false' END;
  END IF;
  RETURN 'null';
END
$$;

CREATE FUNCTION reportcards.canonical_hash(p_snapshot jsonb, p_explain jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT encode(sha256(convert_to(reportcards.canonical_json(jsonb_build_object('snapshot', p_snapshot, 'explain', p_explain)), 'UTF8')), 'hex')
$$;

-- -----------------------------------------------------------------------------
-- Écritures strictement interdites
-- -----------------------------------------------------------------------------
CREATE FUNCTION reportcards.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'reportcards.immutable: % est immuable (% interdit)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END
$$;

-- Journal des vérifications : append-only ; la purge de rétention (24 mois) est la SEULE suppression permise, sous le
-- réglage de transaction `reportcards.retention = on` posé par le job de purge, et seulement pour des lignes échues.
CREATE FUNCTION reportcards.verification_events_guard() RETURNS trigger
LANGUAGE plpgsql AS $
BEGIN
  IF TG_OP = 'DELETE' AND coalesce(current_setting('reportcards.retention', true), '') = 'on' AND OLD.occurred_at < now() - interval '24 months' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'reportcards.immutable: verification_events est immuable (% interdit)', TG_OP USING ERRCODE = 'restrict_violation';
END
$;
CREATE TRIGGER verification_events_immutable BEFORE UPDATE OR DELETE ON reportcards.verification_events
  FOR EACH ROW EXECUTE FUNCTION reportcards.verification_events_guard();
CREATE TRIGGER access_log_immutable BEFORE UPDATE OR DELETE ON reportcards.access_log
  FOR EACH ROW EXECUTE FUNCTION reportcards.forbid_mutation();
CREATE TRIGGER verification_index_immutable BEFORE UPDATE OR DELETE ON reportcards.verification_index
  FOR EACH ROW EXECUTE FUNCTION reportcards.forbid_mutation();
CREATE TRIGGER file_hash_index_immutable BEFORE UPDATE OR DELETE ON reportcards.file_hash_index
  FOR EACH ROW EXECUTE FUNCTION reportcards.forbid_mutation();
CREATE TRIGGER report_cards_no_delete BEFORE DELETE ON reportcards.report_cards
  FOR EACH ROW EXECUTE FUNCTION reportcards.forbid_mutation();
CREATE TRIGGER renders_no_delete BEFORE DELETE ON reportcards.renders
  FOR EACH ROW EXECUTE FUNCTION reportcards.forbid_mutation();
CREATE TRIGGER platform_templates_no_delete BEFORE DELETE ON reportcards.platform_templates
  FOR EACH ROW EXECUTE FUNCTION reportcards.forbid_mutation();
CREATE TRIGGER signing_keys_no_delete BEFORE DELETE ON reportcards.signing_keys
  FOR EACH ROW EXECUTE FUNCTION reportcards.forbid_mutation();
CREATE TRIGGER branding_versions_no_delete BEFORE DELETE ON reportcards.branding_versions
  FOR EACH ROW EXECUTE FUNCTION reportcards.forbid_mutation();
CREATE TRIGGER template_configs_no_delete BEFORE DELETE ON reportcards.template_configs
  FOR EACH ROW EXECUTE FUNCTION reportcards.forbid_mutation();
CREATE TRIGGER signatories_no_delete BEFORE DELETE ON reportcards.signatories
  FOR EACH ROW EXECUTE FUNCTION reportcards.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Gabarit plateforme : une version publiée est IMMUABLE (seul le passage à RETIRED est permis)
-- -----------------------------------------------------------------------------
CREATE FUNCTION reportcards.platform_templates_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'RETIRED' THEN
    RAISE EXCEPTION 'reportcards.template_retired: un gabarit retiré est terminal' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'PUBLISHED' THEN
    IF NEW.status NOT IN ('PUBLISHED', 'RETIRED')
       OR NEW.key <> OLD.key OR NEW.version <> OLD.version OR NEW.document_kind <> OLD.document_kind OR NEW.pack <> OLD.pack
       OR NEW.snapshot_schema <> OLD.snapshot_schema OR NEW.title <> OLD.title OR NEW.body <> OLD.body OR NEW.css <> OLD.css
       OR NEW.options_schema <> OLD.options_schema OR NEW.signature_slots <> OLD.signature_slots
       OR NEW.content_hash IS DISTINCT FROM OLD.content_hash OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
      RAISE EXCEPTION 'reportcards.template_published_immutable: une version publiée du gabarit % v% est immuable', OLD.key, OLD.version
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_templates_guard BEFORE UPDATE ON reportcards.platform_templates
  FOR EACH ROW EXECUTE FUNCTION reportcards.platform_templates_guard();

-- Clé de signature : seul le retrait évolue ; la clé publique ne change jamais.
CREATE FUNCTION reportcards.signing_keys_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.key_id <> OLD.key_id OR NEW.public_key <> OLD.public_key OR NEW.algorithm <> OLD.algorithm OR NEW.created_at <> OLD.created_at
     OR (OLD.status = 'RETIRED' AND NEW.status <> 'RETIRED') THEN
    RAISE EXCEPTION 'reportcards.signing_key_immutable: la clé publique % est immuable (seul le retrait est permis)', OLD.key_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER signing_keys_guard BEFORE UPDATE ON reportcards.signing_keys
  FOR EACH ROW EXECUTE FUNCTION reportcards.signing_keys_guard();

-- -----------------------------------------------------------------------------
-- Identité et configuration de gabarit : une version est immuable, seul `is_current` passe à false
-- -----------------------------------------------------------------------------
CREATE FUNCTION reportcards.versioned_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'is_current') IS DISTINCT FROM (to_jsonb(OLD) - 'is_current') OR NEW.is_current AND NOT OLD.is_current THEN
    RAISE EXCEPTION 'reportcards.version_immutable: une version de % est immuable (créez-en une nouvelle)', TG_TABLE_NAME
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER branding_versions_guard BEFORE UPDATE ON reportcards.branding_versions
  FOR EACH ROW EXECUTE FUNCTION reportcards.versioned_guard();
CREATE TRIGGER template_configs_guard BEFORE UPDATE ON reportcards.template_configs
  FOR EACH ROW EXECUTE FUNCTION reportcards.versioned_guard();

-- -----------------------------------------------------------------------------
-- Snapshot : contrôle à l'insertion (hash recalculé, cohérence colonnes/contenu)
-- -----------------------------------------------------------------------------
CREATE FUNCTION reportcards.report_cards_insert_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_expected text;
BEGIN
  IF NEW.status <> 'ISSUED' OR NEW.published_at IS NOT NULL OR NEW.withdrawn_at IS NOT NULL OR NEW.revoked_at IS NOT NULL
     OR NEW.superseded_at IS NOT NULL OR NEW.superseded_by_id IS NOT NULL OR NEW.current_render_id IS NOT NULL
     OR NEW.render_status <> 'PENDING' THEN
    RAISE EXCEPTION 'reportcards.insert_state: un snapshot naît ISSUED, non publié, non rendu' USING ERRCODE = 'restrict_violation';
  END IF;
  IF jsonb_typeof(NEW.snapshot) <> 'object' OR jsonb_typeof(NEW.explain) <> 'array' THEN
    RAISE EXCEPTION 'reportcards.snapshot_shape: snapshot (objet) et explain (tableau) attendus' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.snapshot_schema IS DISTINCT FROM NEW.snapshot #>> '{meta,schema}'
     OR NEW.version IS DISTINCT FROM (NEW.snapshot #>> '{meta,version}')::integer
     OR NEW.document_kind IS DISTINCT FROM NEW.snapshot #>> '{meta,kind}'
     OR NEW.scope IS DISTINCT FROM NEW.snapshot #>> '{meta,scope}'
     OR NEW.provisional IS DISTINCT FROM (NEW.snapshot #>> '{meta,provisional}')::boolean
     OR NEW.student_id::text IS DISTINCT FROM NEW.snapshot #>> '{student,id}' THEN
    RAISE EXCEPTION 'reportcards.snapshot_columns: les colonnes ne correspondent pas au contenu du snapshot' USING ERRCODE = 'restrict_violation';
  END IF;
  v_expected := reportcards.canonical_hash(NEW.snapshot, NEW.explain);
  IF NEW.snapshot_hash <> v_expected THEN
    RAISE EXCEPTION 'reportcards.hash_mismatch: le hash fourni ne correspond pas au contenu (attendu %)', v_expected USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER report_cards_1_insert_check BEFORE INSERT ON reportcards.report_cards
  FOR EACH ROW EXECUTE FUNCTION reportcards.report_cards_insert_check();

-- Supersession atomique : une insertion `version > 1` passe l'ancienne version VIVANTE en SUPERSEDED dans la même
-- transaction, AVANT l'insertion (l'index unique des versions vivantes l'exige).
CREATE FUNCTION reportcards.report_cards_supersede_pair() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_old reportcards.report_cards%ROWTYPE;
BEGIN
  IF NEW.version = 1 THEN
    IF NEW.supersedes_id IS NOT NULL THEN
      RAISE EXCEPTION 'reportcards.supersede_first: la version 1 ne remplace rien' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.provisional THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_old FROM reportcards.report_cards WHERE tenant_id = NEW.tenant_id AND id = NEW.supersedes_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reportcards.supersede_missing: la version remplacée est introuvable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF v_old.document_kind <> NEW.document_kind OR v_old.student_id <> NEW.student_id OR v_old.scope <> NEW.scope
     OR v_old.enrollment_id IS DISTINCT FROM NEW.enrollment_id OR v_old.academic_period_id IS DISTINCT FROM NEW.academic_period_id
     OR v_old.version <> NEW.version - 1 THEN
    RAISE EXCEPTION 'reportcards.supersede_mismatch: la version remplacée ne correspond pas à la clé fonctionnelle' USING ERRCODE = 'restrict_violation';
  END IF;
  IF v_old.status IN ('ISSUED', 'PUBLISHED') THEN
    PERFORM set_config('reportcards.supersede', 'on', true);
    UPDATE reportcards.report_cards
       SET status = 'SUPERSEDED', superseded_at = NEW.issued_at, superseded_by_id = NEW.id
     WHERE tenant_id = v_old.tenant_id AND id = v_old.id;
    PERFORM set_config('reportcards.supersede', 'off', true);
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER report_cards_2_supersede BEFORE INSERT ON reportcards.report_cards
  FOR EACH ROW EXECUTE FUNCTION reportcards.report_cards_supersede_pair();

-- -----------------------------------------------------------------------------
-- Snapshot : immuabilité et transitions légales.
-- Mutables : status, published_at/by, withdrawn_at, superseded_at/by_id, revoked_*, render_status, current_render_id.
--   ISSUED -> PUBLISHED | REVOKED | SUPERSEDED ; PUBLISHED -> REVOKED | SUPERSEDED ; SUPERSEDED, REVOKED terminaux ;
--   PUBLISHED -> ISSUED interdit (utiliser withdrawn_at) ; SUPERSEDED seulement via la supersession atomique.
-- -----------------------------------------------------------------------------
CREATE FUNCTION reportcards.report_cards_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_mutable text[] := ARRAY['status', 'published_at', 'published_by', 'withdrawn_at', 'superseded_at', 'superseded_by_id',
                            'revoked_at', 'revoked_by', 'revoked_by_name', 'revoke_reason', 'render_status', 'current_render_id'];
BEGIN
  IF (to_jsonb(NEW) - v_mutable) IS DISTINCT FROM (to_jsonb(OLD) - v_mutable) THEN
    RAISE EXCEPTION 'reportcards.snapshot_immutable: le contenu d''un bulletin émis est immuable (réémettez une nouvelle version)'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.status <> OLD.status THEN
    IF NOT (
         (OLD.status = 'ISSUED'    AND NEW.status IN ('PUBLISHED', 'SUPERSEDED', 'REVOKED')) OR
         (OLD.status = 'PUBLISHED' AND NEW.status IN ('SUPERSEDED', 'REVOKED'))) THEN
      RAISE EXCEPTION 'reportcards.invalid_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status = 'SUPERSEDED' AND coalesce(current_setting('reportcards.supersede', true), '') <> 'on' THEN
      RAISE EXCEPTION 'reportcards.supersede_only_by_successor: un bulletin n''est remplacé que par l''émission de la version suivante'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status = 'PUBLISHED' AND (OLD.provisional OR NEW.published_at IS NULL OR NEW.published_by IS NULL) THEN
      RAISE EXCEPTION 'reportcards.publish_invalid: publication impossible (provisoire ou sans auteur/date)' USING ERRCODE = 'restrict_violation';
    END IF;
  ELSE
    IF NEW.published_at IS DISTINCT FROM OLD.published_at OR NEW.published_by IS DISTINCT FROM OLD.published_by THEN
      RAISE EXCEPTION 'reportcards.publish_immutable: la date et l''auteur de publication sont figés' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.superseded_at IS DISTINCT FROM OLD.superseded_at OR NEW.superseded_by_id IS DISTINCT FROM OLD.superseded_by_id
       OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoked_by IS DISTINCT FROM OLD.revoked_by
       OR NEW.revoked_by_name IS DISTINCT FROM OLD.revoked_by_name OR NEW.revoke_reason IS DISTINCT FROM OLD.revoke_reason THEN
      RAISE EXCEPTION 'reportcards.terminal_immutable: remplacement et révocation sont figés' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  IF NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at AND NEW.status <> 'PUBLISHED' THEN
    RAISE EXCEPTION 'reportcards.withdraw_invalid: seul un bulletin publié peut être retiré aux familles' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER report_cards_immutable BEFORE UPDATE ON reportcards.report_cards
  FOR EACH ROW EXECUTE FUNCTION reportcards.report_cards_immutable();

-- -----------------------------------------------------------------------------
-- Rendus : une ligne RENDERED est immuable (une nouvelle tentative = une nouvelle ligne)
-- -----------------------------------------------------------------------------
CREATE FUNCTION reportcards.renders_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'RENDERED' THEN
    RAISE EXCEPTION 'reportcards.render_immutable: un rendu terminé est immuable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.report_card_id <> OLD.report_card_id THEN
    RAISE EXCEPTION 'reportcards.render_identity: le bulletin d''un rendu est figé' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER renders_guard BEFORE UPDATE ON reportcards.renders
  FOR EACH ROW EXECUTE FUNCTION reportcards.renders_guard();

-- -----------------------------------------------------------------------------
-- Index public : un code ne désigne qu'un document réel du tenant, non provisoire
-- -----------------------------------------------------------------------------
CREATE FUNCTION reportcards.verification_index_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.document_kind IN ('REPORT_CARD', 'TRANSCRIPT') THEN
    PERFORM 1 FROM reportcards.report_cards
     WHERE tenant_id = NEW.tenant_id AND id = NEW.document_id AND verification_code = NEW.code AND document_kind = NEW.document_kind AND NOT provisional;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'reportcards.verification_target: ce code ne correspond à aucun document émis du tenant' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER verification_index_guard BEFORE INSERT ON reportcards.verification_index
  FOR EACH ROW EXECUTE FUNCTION reportcards.verification_index_guard();

CREATE FUNCTION reportcards.file_hash_index_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM reportcards.verification_index WHERE code = NEW.code AND tenant_id = NEW.tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reportcards.file_hash_target: ce code n''appartient pas au tenant courant' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER file_hash_index_guard BEFORE INSERT ON reportcards.file_hash_index
  FOR EACH ROW EXECUTE FUNCTION reportcards.file_hash_index_guard();
