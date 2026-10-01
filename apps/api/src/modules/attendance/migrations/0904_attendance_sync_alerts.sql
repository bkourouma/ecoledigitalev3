-- =============================================================================
-- 0904 — Module attendance (spec 010) : synchronisation hors-ligne, alertes, compléments
-- =============================================================================
--
-- Compléments à 0900-0903 (DDL de référence de la spec, testé) pour l'API de synchronisation idempotente
-- (PRD §59) et les alertes configurables :
--
--   * `sync_ops`        registre d'idempotence des opérations rejouables (séance ou pointage porté par un
--                       `clientId` généré par l'appareil). Append-only : rejouer un lot ne produit aucun doublon
--                       et renvoie le résultat d'origine.
--   * `sync_conflicts`  file de conflits à arbitrer (séance verrouillée, fenêtre de correction close, pointage
--                       plus récent déjà présent) : rien n'est écrit silencieusement, rien n'est perdu.
--   * `alert_states`    état « seuil franchi » par (inscription, période, règle) pour n'émettre l'événement
--                       d'alerte qu'au franchissement. Les SEUILS ne sont jamais ici : ils viennent des paramètres
--                       d'établissement (`settings.alert_rules`, alimentés par le modèle de pack / un RuleSet).
--   * colonnes          `student_records.client_marked_at` (horodatage appareil, à comparer à `marked_at` serveur),
--                       `settings.allow_future_justifications`, `settings.alert_rules`,
--                       `summary_overrides.removed_by`, `justifications.revoked_*`.
-- =============================================================================

ALTER TABLE attendance.student_records ADD COLUMN client_marked_at timestamptz;

-- Politique d'établissement : un justificatif peut-il couvrir des dates futures (absence prévue) ?
ALTER TABLE attendance.settings ADD COLUMN allow_future_justifications boolean NOT NULL DEFAULT false;

-- Règles d'alerte d'assiduité de l'établissement : tableau JSON validé par le domaine
-- ({ code, metric, threshold, active }). Vide par défaut : AUCUN seuil n'est livré par le module.
ALTER TABLE attendance.settings ADD COLUMN alert_rules jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(alert_rules) = 'array');

ALTER TABLE attendance.summary_overrides ADD COLUMN removed_by uuid;

-- La RÉVOCATION d'un justificatif accepté ne réécrit pas la décision d'origine (auteur, date, note de l'acceptation) :
-- elle est tracée à part (« une décision ne s'efface pas »).
ALTER TABLE attendance.justifications ADD COLUMN revoked_by uuid;
ALTER TABLE attendance.justifications ADD COLUMN revoked_at timestamptz;
ALTER TABLE attendance.justifications ADD COLUMN revocation_reason text;
ALTER TABLE attendance.justifications ADD CONSTRAINT justifications_revocation_traced
  CHECK (status <> 'REVOKED' OR (revoked_by IS NOT NULL AND revoked_at IS NOT NULL AND length(btrim(revocation_reason)) >= 5));

-- -----------------------------------------------------------------------------
-- Historique des pointages : ordre TOTAL fiable. `changed_at` (now()) est l'instant de DÉBUT de transaction : deux
-- transactions concurrentes sur le même pointage peuvent donc s'entrelacer ; `seq` suit l'ordre réel d'écriture (les
-- mises à jour d'une même ligne sont sérialisées par son verrou) et `changed_at` devient l'instant réel de la modification.
-- -----------------------------------------------------------------------------
ALTER TABLE attendance.record_history ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY;
CREATE INDEX record_history_by_seq ON attendance.record_history (tenant_id, record_id, seq);

CREATE OR REPLACE FUNCTION attendance.student_records_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO attendance.record_history (id, tenant_id, record_id, session_id, from_status, to_status, actor_id, changed_at)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, NEW.session_id, NULL, NEW.status_code, kernel.current_user_id(), clock_timestamp());
  ELSIF NEW.status_code <> OLD.status_code THEN
    INSERT INTO attendance.record_history (id, tenant_id, record_id, session_id, from_status, to_status, actor_id, changed_at)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, NEW.session_id, OLD.status_code, NEW.status_code, kernel.current_user_id(), clock_timestamp());
  END IF;
  RETURN NEW;
END
$$;

-- -----------------------------------------------------------------------------
-- Registre d'idempotence de la synchronisation hors-ligne
-- -----------------------------------------------------------------------------
CREATE TABLE attendance.sync_ops (
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  client_id     uuid NOT NULL,                         -- identifiant généré par l'appareil
  kind          text NOT NULL CHECK (kind IN ('SESSION', 'RECORD')),
  payload_hash  text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  outcome       text NOT NULL CHECK (outcome IN ('OPENED', 'EXISTING', 'APPLIED', 'UNCHANGED', 'CONFLICT')),
  session_id    uuid,
  record_id     uuid,
  conflict_id   uuid,
  device_id     text CHECK (device_id IS NULL OR length(device_id) BETWEEN 1 AND 64),
  user_id       uuid,
  client_at     timestamptz,                           -- horodatage de l'appareil (informatif)
  received_at   timestamptz NOT NULL DEFAULT now(),    -- horodatage serveur (fait foi)
  PRIMARY KEY (tenant_id, client_id)
);
SELECT kernel.enable_tenant_rls('attendance.sync_ops');
CREATE INDEX sync_ops_by_session ON attendance.sync_ops (tenant_id, session_id) WHERE session_id IS NOT NULL;
GRANT SELECT, INSERT ON attendance.sync_ops TO app_user;

CREATE TRIGGER sync_ops_immutable BEFORE UPDATE OR DELETE ON attendance.sync_ops
  FOR EACH ROW EXECUTE FUNCTION attendance.forbid_mutation();

-- -----------------------------------------------------------------------------
-- File de conflits de synchronisation
-- -----------------------------------------------------------------------------
CREATE TABLE attendance.sync_conflicts (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  kind             text NOT NULL CHECK (kind IN ('SESSION_LOCKED', 'WINDOW_CLOSED', 'STALE')),
  session_id       uuid NOT NULL,
  enrollment_id    uuid NOT NULL,
  student_id       uuid NOT NULL,
  client_op_id     uuid NOT NULL,                      -- clientId du pointage refusé
  incoming         jsonb NOT NULL,                     -- ce que l'appareil voulait écrire
  existing         jsonb,                              -- ce qui est en base au moment du conflit
  device_id        text CHECK (device_id IS NULL OR length(device_id) BETWEEN 1 AND 64),
  submitted_by     uuid NOT NULL,
  client_marked_at timestamptz,
  received_at      timestamptz NOT NULL DEFAULT now(),
  status           text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED')),
  resolution       text CHECK (resolution IS NULL OR resolution IN ('ACCEPT_INCOMING', 'KEEP_EXISTING')),
  resolved_by      uuid,
  resolved_at      timestamptz,
  resolution_note  text,
  UNIQUE (tenant_id, id),
  CHECK (status = 'OPEN' OR (resolution IS NOT NULL AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL))
);
SELECT kernel.enable_tenant_rls('attendance.sync_conflicts');
CREATE UNIQUE INDEX sync_conflicts_one_per_op ON attendance.sync_conflicts (tenant_id, client_op_id);
CREATE INDEX sync_conflicts_open ON attendance.sync_conflicts (tenant_id, status, received_at) WHERE status = 'OPEN';
CREATE INDEX sync_conflicts_by_session ON attendance.sync_conflicts (tenant_id, session_id);
GRANT SELECT, INSERT, UPDATE ON attendance.sync_conflicts TO app_user;

CREATE TRIGGER sync_conflicts_no_delete BEFORE DELETE ON attendance.sync_conflicts
  FOR EACH ROW EXECUTE FUNCTION attendance.forbid_mutation();

-- -----------------------------------------------------------------------------
-- État des alertes d'assiduité (franchissement de seuil)
-- -----------------------------------------------------------------------------
CREATE TABLE attendance.alert_states (
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  enrollment_id  uuid NOT NULL,
  period_id      uuid NOT NULL,
  rule_code      text NOT NULL CHECK (rule_code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  student_id     uuid NOT NULL,
  metric         text NOT NULL,
  threshold      integer NOT NULL CHECK (threshold >= 0),
  last_value     integer NOT NULL CHECK (last_value >= 0),
  triggered_at   timestamptz NOT NULL DEFAULT now(),
  cleared_at     timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, enrollment_id, period_id, rule_code)
);
SELECT kernel.enable_tenant_rls('attendance.alert_states');
CREATE INDEX alert_states_active ON attendance.alert_states (tenant_id, period_id) WHERE cleared_at IS NULL;
GRANT SELECT, INSERT, UPDATE ON attendance.alert_states TO app_user;
