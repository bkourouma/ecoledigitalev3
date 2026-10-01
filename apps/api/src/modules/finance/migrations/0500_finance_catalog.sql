-- =============================================================================
-- 0500 — Module finance : schéma, numérotation, catalogue, barèmes, remises, bourses
-- =============================================================================
--
-- Plage de numéros réservée au module finance : 0500–0599 (les numéros de migration
-- sont GLOBAUX à tous les modules : voir packages/database, loader.ts).
--
-- Règles (docs/architecture/module-conventions.md) :
--   - un module = un schéma (`finance`) ; aucune FK vers le schéma d'un autre module,
--     sauf `kernel.tenants(id)` ;
--   - toute table de tenant : `tenant_id uuid NOT NULL REFERENCES kernel.tenants(id)`
--     + `kernel.enable_tenant_rls()` + GRANT explicite à `app_user` ;
--   - montants : `bigint` en unités mineures (XOF : le franc), jamais de flottant,
--     toujours accompagnés d'un code devise ISO 4217 ;
--   - les clés étrangères internes au module sont COMPOSITES (tenant_id, id) : une ligne
--     ne peut pas référencer la ligne d'un autre tenant, même en connaissant son UUID
--     (les contrôles de FK contournent la RLS, d'où cette garde).
--
-- Exécutée sous `SET ROLE migrator` par le runner.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS finance;

REVOKE ALL ON SCHEMA finance FROM PUBLIC;
GRANT USAGE ON SCHEMA finance TO app_user;

-- -----------------------------------------------------------------------------
-- Numérotation séquentielle par tenant, par type de document et par année.
--
-- SANS TROU, SANS DOUBLON sous concurrence : `next_number` incrémente la ligne de
-- compteur par `INSERT … ON CONFLICT DO UPDATE`. Cette instruction verrouille la ligne
-- jusqu'à la fin de la transaction appelante : deux transactions concurrentes sont
-- SÉRIALISÉES sur le compteur, et si la transaction qui a pris le numéro n est annulée,
-- l'incrément l'est aussi — le numéro n est réattribué à la suivante. Il faut donc appeler
-- `next_number` DANS la transaction qui insère le document, le plus tard possible
-- (le verrou est tenu jusqu'au COMMIT).
-- -----------------------------------------------------------------------------
CREATE TABLE finance.number_sequences (
  tenant_id  uuid   NOT NULL REFERENCES kernel.tenants (id),
  kind       text   NOT NULL CHECK (kind IN ('INVOICE', 'RECEIPT', 'CREDIT_NOTE')),
  year       integer NOT NULL CHECK (year BETWEEN 2000 AND 9999),
  last_value bigint NOT NULL DEFAULT 0 CHECK (last_value >= 0),
  PRIMARY KEY (tenant_id, kind, year)
);
SELECT kernel.enable_tenant_rls('finance.number_sequences');
GRANT SELECT, INSERT, UPDATE ON finance.number_sequences TO app_user;

-- Le compteur ne peut qu'avancer d'UN pas à la fois (aucun saut, aucun retour arrière).
CREATE FUNCTION finance.number_sequences_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.kind <> OLD.kind OR NEW.year <> OLD.year THEN
    RAISE EXCEPTION 'finance.sequence_immutable_key: la clé d''un compteur ne change pas'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.last_value <> OLD.last_value + 1 THEN
    RAISE EXCEPTION 'finance.sequence_step: un compteur avance d''un pas exactement (% -> %)', OLD.last_value, NEW.last_value
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER number_sequences_guard BEFORE UPDATE ON finance.number_sequences
  FOR EACH ROW EXECUTE FUNCTION finance.number_sequences_guard();

-- Le tenant vient du contexte de transaction (`app.tenant_id`), jamais d'un paramètre :
-- un appelant ne peut pas consommer la séquence d'un autre tenant.
CREATE FUNCTION finance.next_number(p_kind text, p_year integer) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_tenant uuid := kernel.current_tenant_id();
  v_value  bigint;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'finance.next_number: contexte de tenant absent' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO finance.number_sequences AS s (tenant_id, kind, year, last_value)
  VALUES (v_tenant, p_kind, p_year, 1)
  ON CONFLICT (tenant_id, kind, year) DO UPDATE SET last_value = s.last_value + 1
  RETURNING s.last_value INTO v_value;
  RETURN v_value;
END
$$;
REVOKE ALL ON FUNCTION finance.next_number(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finance.next_number(text, integer) TO app_user;

-- -----------------------------------------------------------------------------
-- Catalogue des frais
-- -----------------------------------------------------------------------------
CREATE TABLE finance.fees (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES kernel.tenants (id),
  code        text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'),
  name        text NOT NULL CHECK (length(btrim(name)) > 0),
  category    text NOT NULL CHECK (category IN (
                'REGISTRATION', 'TUITION', 'CANTEEN', 'TRANSPORT', 'UNIFORM', 'DOCUMENTS',
                'EXAMS', 'ACTIVITIES', 'DEFENSE', 'LIBRARY', 'OTHER')),
  description text,
  currency    text NOT NULL DEFAULT 'XOF' CHECK (currency IN ('XOF', 'XAF', 'EUR', 'USD')),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('finance.fees');
GRANT SELECT, INSERT, UPDATE ON finance.fees TO app_user;

-- Plans d'échéancier réutilisables (étapes en JSON validé par le domaine).
CREATE TABLE finance.installment_plans (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES kernel.tenants (id),
  code       text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'),
  name       text NOT NULL CHECK (length(btrim(name)) > 0),
  currency   text NOT NULL DEFAULT 'XOF' CHECK (currency IN ('XOF', 'XAF', 'EUR', 'USD')),
  steps      jsonb NOT NULL CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) BETWEEN 1 AND 60),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('finance.installment_plans');
GRANT SELECT, INSERT, UPDATE ON finance.installment_plans TO app_user;

-- Barèmes : montant d'un frais selon établissement / campus / niveau / filière / année /
-- type d'apprenant, avec dates d'effet. Une dimension NULL = « toutes valeurs ».
CREATE TABLE finance.fee_schedules (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  fee_id         uuid NOT NULL,
  academic_year  text NOT NULL CHECK (length(btrim(academic_year)) > 0),
  institution_id uuid,
  campus_id      uuid,
  level_key      text,
  track_key      text,
  learner_type   text,
  amount         bigint NOT NULL CHECK (amount >= 0),
  currency       text NOT NULL DEFAULT 'XOF' CHECK (currency IN ('XOF', 'XAF', 'EUR', 'USD')),
  effective_from date NOT NULL,
  effective_to   date,
  plan_id        uuid,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, fee_id) REFERENCES finance.fees (tenant_id, id),
  FOREIGN KEY (tenant_id, plan_id) REFERENCES finance.installment_plans (tenant_id, id)
);
CREATE INDEX fee_schedules_lookup_idx ON finance.fee_schedules (tenant_id, fee_id, academic_year) WHERE active;
SELECT kernel.enable_tenant_rls('finance.fee_schedules');
GRANT SELECT, INSERT, UPDATE ON finance.fee_schedules TO app_user;

-- Remises (catalogue). Pourcentage en points de base (1 % = 100) ou montant fixe.
CREATE TABLE finance.discounts (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES kernel.tenants (id),
  code       text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'),
  name       text NOT NULL CHECK (length(btrim(name)) > 0),
  kind       text NOT NULL CHECK (kind IN ('PERCENT', 'AMOUNT')),
  bps        integer CHECK (bps BETWEEN 1 AND 10000),
  amount     bigint CHECK (amount > 0),
  cap_amount bigint CHECK (cap_amount > 0),
  currency   text NOT NULL DEFAULT 'XOF' CHECK (currency IN ('XOF', 'XAF', 'EUR', 'USD')),
  categories text[],
  stackable  boolean NOT NULL DEFAULT false,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'PERCENT' AND bps IS NOT NULL AND amount IS NULL)
      OR (kind = 'AMOUNT' AND amount IS NOT NULL AND bps IS NULL)),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('finance.discounts');
GRANT SELECT, INSERT, UPDATE ON finance.discounts TO app_user;

-- Compte financier de l'apprenant : porte le type de financement (PRD §20).
CREATE TABLE finance.learner_accounts (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  learner_id     uuid NOT NULL,
  funding_type   text NOT NULL DEFAULT 'PRIVATE' CHECK (funding_type IN (
                   'PRIVATE', 'STATE_ASSIGNED', 'SCHOLARSHIP', 'COMPANY', 'STAFF_CHILD', 'OTHER')),
  assignment_ref text,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, learner_id)
);
SELECT kernel.enable_tenant_rls('finance.learner_accounts');
GRANT SELECT, INSERT, UPDATE ON finance.learner_accounts TO app_user;

-- Bourses et prises en charge (part État / part parent pour les élèves STATE_ASSIGNED).
CREATE TABLE finance.scholarships (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  learner_id      uuid NOT NULL,
  academic_year   text NOT NULL CHECK (length(btrim(academic_year)) > 0),
  funder_kind     text NOT NULL CHECK (funder_kind IN ('STATE', 'COMPANY', 'INSTITUTION', 'FOUNDATION', 'OTHER')),
  funder_name     text NOT NULL CHECK (length(btrim(funder_name)) > 0),
  reference       text,
  coverage_kind   text NOT NULL CHECK (coverage_kind IN ('PERCENT', 'FIXED')),
  coverage_bps    integer CHECK (coverage_bps BETWEEN 1 AND 10000),
  coverage_amount bigint CHECK (coverage_amount > 0),
  cap_amount      bigint CHECK (cap_amount > 0),
  currency        text NOT NULL DEFAULT 'XOF' CHECK (currency IN ('XOF', 'XAF', 'EUR', 'USD')),
  categories      text[],
  status          text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'ENDED')),
  priority        integer NOT NULL DEFAULT 100,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((coverage_kind = 'PERCENT' AND coverage_bps IS NOT NULL AND coverage_amount IS NULL)
      OR (coverage_kind = 'FIXED' AND coverage_amount IS NOT NULL AND coverage_bps IS NULL)),
  UNIQUE (tenant_id, id)
);
CREATE INDEX scholarships_learner_idx ON finance.scholarships (tenant_id, learner_id, academic_year);
SELECT kernel.enable_tenant_rls('finance.scholarships');
GRANT SELECT, INSERT, UPDATE ON finance.scholarships TO app_user;
