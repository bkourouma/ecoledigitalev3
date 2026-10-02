-- =============================================================================
-- 2203 — Module schoollife : effets d'une exclusion temporaire (toujours en attente d'un HUMAIN)
-- =============================================================================
--
-- Une exclusion temporaire VALIDÉE ne change JAMAIS d'elle-même le statut de l'élève (suspension) dans `people` :
-- la base crée un effet `STUDENT_STATUS_REQUEST` en `AWAITING_HUMAN`. Il ne passe `APPLIED` que par l'acte d'un utilisateur
-- identifié et habilité (`applied_by` posé par la base, un job ou le système est refusé) ; il peut être écarté
-- (`SKIPPED`, motivé) ou, une fois appliqué, annulé (`REVERTED`, motivé) par un humain. La révocation ou l'annulation de la
-- mesure écarte l'effet encore en attente. Même schéma que `councils.effects` (spec 006, R-C8).
-- =============================================================================

CREATE TABLE schoollife.measure_effects (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  measure_id     uuid NOT NULL,
  student_id     uuid NOT NULL,
  effect_kind    text NOT NULL CHECK (effect_kind IN ('STUDENT_STATUS_REQUEST')),
  status         text NOT NULL DEFAULT 'AWAITING_HUMAN' CHECK (status IN ('AWAITING_HUMAN', 'APPLIED', 'FAILED', 'SKIPPED', 'REVERTED')),
  applied_status text CHECK (applied_status IS NULL OR applied_status IN ('SUSPENDED', 'EXCLUDED')),   -- statut `people` choisi par l'humain
  attempts       integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error     text,
  applied_at     timestamptz,
  applied_by     uuid,
  skipped_reason text,
  reverted_at    timestamptz,
  reverted_by    uuid,
  revert_reason  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, measure_id) REFERENCES schoollife.measures (tenant_id, id),
  CHECK (status <> 'APPLIED' OR (applied_at IS NOT NULL AND applied_by IS NOT NULL AND applied_status IS NOT NULL)),
  CHECK (status <> 'SKIPPED' OR length(btrim(coalesce(skipped_reason, ''))) >= 5),
  CHECK (status <> 'REVERTED' OR (reverted_by IS NOT NULL AND length(btrim(coalesce(revert_reason, ''))) >= 5))
);
SELECT kernel.enable_tenant_rls('schoollife.measure_effects');
CREATE UNIQUE INDEX measure_effects_one_live ON schoollife.measure_effects (tenant_id, measure_id, effect_kind) WHERE status IN ('AWAITING_HUMAN', 'APPLIED', 'FAILED');
CREATE INDEX measure_effects_open ON schoollife.measure_effects (tenant_id, status, created_at) WHERE status IN ('AWAITING_HUMAN', 'FAILED');
GRANT SELECT, INSERT, UPDATE ON schoollife.measure_effects TO app_user;

CREATE FUNCTION schoollife.measure_effects_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'schoollife.immutable: un effet ne se supprime pas (l''écarter avec un motif)' USING ERRCODE = 'restrict_violation';
  END IF;
  v_user := schoollife.require_human_actor();
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'AWAITING_HUMAN' THEN
      RAISE EXCEPTION 'schoollife.human_application_required: cet effet naît en attente d''un humain habilité' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.measure_id <> OLD.measure_id OR NEW.student_id <> OLD.student_id OR NEW.effect_kind <> OLD.effect_kind THEN
    RAISE EXCEPTION 'schoollife.effect_identity_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  NEW.updated_at := now();
  IF NEW.status = OLD.status THEN
    -- tentative échouée : seuls compteur et dernière erreur évoluent
    IF NEW.applied_status IS DISTINCT FROM OLD.applied_status OR NEW.applied_by IS DISTINCT FROM OLD.applied_by THEN
      RAISE EXCEPTION 'schoollife.effect_frozen' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT ((OLD.status, NEW.status) IN (
        ('AWAITING_HUMAN', 'APPLIED'), ('AWAITING_HUMAN', 'SKIPPED'), ('AWAITING_HUMAN', 'FAILED'),
        ('FAILED', 'APPLIED'), ('FAILED', 'SKIPPED'), ('APPLIED', 'REVERTED'))) THEN
    RAISE EXCEPTION 'schoollife.effect_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status = 'APPLIED' THEN
    NEW.applied_by := v_user;
    NEW.applied_at := now();
  ELSIF NEW.status = 'REVERTED' THEN
    NEW.reverted_by := v_user;
    NEW.reverted_at := now();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER measure_effects_guard BEFORE INSERT OR UPDATE OR DELETE ON schoollife.measure_effects
  FOR EACH ROW EXECUTE FUNCTION schoollife.measure_effects_guard();

-- Une exclusion temporaire validée crée l'effet en attente d'un humain ; la révocation / l'annulation de la mesure écarte
-- l'effet encore en attente (jamais un effet déjà appliqué : il se lève par un acte humain).
CREATE FUNCTION schoollife.measures_effects_after() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'TEMP_EXCLUSION' AND NEW.status = 'VALIDATED' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'VALIDATED') THEN
    INSERT INTO schoollife.measure_effects (id, tenant_id, measure_id, student_id, effect_kind)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, NEW.student_id, 'STUDENT_STATUS_REQUEST');
  ELSIF TG_OP = 'UPDATE' AND NEW.status IN ('REVOKED', 'CANCELLED') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE schoollife.measure_effects
       SET status = 'SKIPPED', skipped_reason = 'Mesure ' || CASE NEW.status WHEN 'REVOKED' THEN 'révoquée' ELSE 'annulée' END
     WHERE tenant_id = NEW.tenant_id AND measure_id = NEW.id AND status IN ('AWAITING_HUMAN', 'FAILED');
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER measures_effects_after AFTER INSERT OR UPDATE ON schoollife.measures
  FOR EACH ROW EXECUTE FUNCTION schoollife.measures_effects_after();
