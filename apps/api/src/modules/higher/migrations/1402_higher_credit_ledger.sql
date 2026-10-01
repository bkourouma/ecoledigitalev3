-- =============================================================================
-- 1402 — Module higher : registre de crédits (capitalisation) et dettes d'UE
-- =============================================================================
-- Le registre ne contient que des ACQUISITIONS (R-HIG-01). UNE seule acquisition valide par (étudiant, UE) :
-- une UE acquise n'est jamais recapitalisée (index unique partiel). Les crédits sont FIGÉS au résultat.
-- Cycle de vie : ACQUIRED -> REVOKED (résultat remplacé) ou EXPIRED (durée de validité dépassée, réglage
-- `higher.settings.credit_validity_months`). Une écriture n'est jamais modifiée ni supprimée (déclencheur, 1408).

CREATE TABLE higher.credit_ledger (
  id                      uuid PRIMARY KEY,
  tenant_id               uuid NOT NULL REFERENCES kernel.tenants (id),
  student_id              uuid NOT NULL,
  enrollment_id           uuid NOT NULL,                    -- inscription au cours de laquelle l'UE a été acquise
  ue_node_id              uuid NOT NULL,
  academic_year_id        uuid NOT NULL,
  academic_period_id      uuid NOT NULL,
  credits                 numeric(8,2) NOT NULL CHECK (credits >= 0),   -- FIGÉS au résultat (AC1.5)
  average_exact           numeric,                          -- moyenne d'UE exacte au moment de l'acquisition
  acquired_via            text NOT NULL CHECK (acquired_via IN ('DIRECT', 'RESIT', 'JURY_OVERRIDE', 'TRANSFER', 'EXEMPTION')),
  session_obtained        smallint NOT NULL CHECK (session_obtained IN (1, 2)),
  status                  text NOT NULL DEFAULT 'ACQUIRED' CHECK (status IN ('ACQUIRED', 'REVOKED', 'EXPIRED')),
  compensated_ecue_count  smallint NOT NULL DEFAULT 0 CHECK (compensated_ecue_count >= 0),
  override_id             uuid,                             -- results.overrides.id si JURY_OVERRIDE
  source_result_id        uuid NOT NULL,                    -- results.period_results.id
  source_results_version  integer NOT NULL CHECK (source_results_version >= 0),
  valid_until             date,                             -- NULL = sans limite
  acquired_at             timestamptz NOT NULL,
  revoked_at              timestamptz,
  revoke_reason           text,
  superseded_by_version   integer,
  expired_at              timestamptz,
  UNIQUE (tenant_id, id),
  CHECK (status <> 'REVOKED' OR (revoked_at IS NOT NULL AND length(btrim(coalesce(revoke_reason, ''))) > 0)),
  CHECK (status <> 'EXPIRED' OR expired_at IS NOT NULL),
  CHECK (acquired_via <> 'JURY_OVERRIDE' OR override_id IS NOT NULL),
  CHECK ((acquired_via = 'RESIT') = (session_obtained = 2) OR acquired_via IN ('TRANSFER', 'EXEMPTION', 'JURY_OVERRIDE'))
);
-- UNE seule acquisition valide par (étudiant, UE)
CREATE UNIQUE INDEX credit_ledger_acquired_uq ON higher.credit_ledger (tenant_id, student_id, ue_node_id) WHERE status = 'ACQUIRED';
CREATE INDEX credit_ledger_student_idx ON higher.credit_ledger (tenant_id, student_id, status);
CREATE INDEX credit_ledger_node_idx    ON higher.credit_ledger (tenant_id, ue_node_id, status);
CREATE INDEX credit_ledger_source_idx  ON higher.credit_ledger (tenant_id, academic_period_id, source_result_id);
CREATE INDEX credit_ledger_expiry_idx  ON higher.credit_ledger (tenant_id, valid_until) WHERE status = 'ACQUIRED' AND valid_until IS NOT NULL;
SELECT kernel.enable_tenant_rls('higher.credit_ledger');
GRANT SELECT, INSERT, UPDATE ON higher.credit_ledger TO app_user;   -- UPDATE : ACQUIRED -> REVOKED | EXPIRED seulement (déclencheur) ; jamais DELETE

-- Dettes d'UE : UE non validée à la clôture, en état « dette » (règle etat_ue). Une dette est levée quand l'UE est
-- acquise plus tard. Aucune inscription automatique (Q-01) : le module 004 PROPOSE la ré-inscription.
CREATE TABLE higher.ue_debts (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  student_id          uuid NOT NULL,
  enrollment_id       uuid NOT NULL,
  ue_node_id          uuid NOT NULL,
  academic_year_id    uuid NOT NULL,
  academic_period_id  uuid NOT NULL,
  source_result_id    uuid,
  status              text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLEARED')),
  detected_at         timestamptz NOT NULL,
  cleared_at          timestamptz,
  cleared_ledger_id   uuid,
  UNIQUE (tenant_id, id),
  CHECK (status <> 'CLEARED' OR cleared_at IS NOT NULL)
);
CREATE UNIQUE INDEX ue_debts_open_uq ON higher.ue_debts (tenant_id, student_id, ue_node_id) WHERE status = 'OPEN';
CREATE INDEX ue_debts_student_idx ON higher.ue_debts (tenant_id, student_id, status);
SELECT kernel.enable_tenant_rls('higher.ue_debts');
GRANT SELECT, INSERT, UPDATE ON higher.ue_debts TO app_user;
