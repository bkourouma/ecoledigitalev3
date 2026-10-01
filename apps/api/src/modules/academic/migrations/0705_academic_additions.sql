-- =============================================================================
-- 0705 — Module academic : compléments de l'implémentation (écarts consignés dans la spec)
-- =============================================================================
--
-- 0700-0704 sont la copie exacte du DDL testé de `specs/v2/004-academic-core/data-model.md` (98 tests).
-- Cette migration ajoute ce que l'implémentation a révélé nécessaire, sans toucher aux fichiers
-- précédents (leurs sommes de contrôle restent comparables au document) :
--
--   1. `period_plans`      : les plans de périodes (« trois trimestres », « deux semestres »…) sont de la
--                            DONNÉE instanciée depuis le modèle de pack, personnalisable par le tenant ;
--                            `applyPeriodPlan` les lit en base (le DDL d'origine n'avait aucune table).
--   2. `enrollment_courses.source` accepte `RESIT` : inscription de rattrapage créée par le module
--                            higher (`registerCourse`), distincte de la reprise de dette `CARRY_OVER`
--                            (interfaces-publiees.md §4, registre d'inscriptions aux cours).
--   3. `enrollment_courses.line_paid_at` : solde d'une ligne de facture reçu avant la confirmation de
--                            l'inscription (confirmation différée, aucun encaissement perdu).
--   4. Idempotence de la reconduction annuelle sous concurrence : une inscription de reconduction par
--                            inscription d'origine (index unique partiel).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Plans de périodes. `slots` : tableau JSON [{ type, ordinal, label, weight? }] ; `type` référence
--    `period_types.code` (vérifié par le cas d'usage : une FK ne traverse pas un tableau JSON).
-- -----------------------------------------------------------------------------
CREATE TABLE academic.period_plans (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES kernel.tenants (id),
  code       text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label      text NOT NULL CHECK (length(btrim(label)) > 0),
  slots      jsonb NOT NULL CHECK (jsonb_typeof(slots) = 'array' AND jsonb_array_length(slots) BETWEEN 1 AND 24),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('academic.period_plans');
GRANT SELECT, INSERT, UPDATE ON academic.period_plans TO app_user;

-- -----------------------------------------------------------------------------
-- 2. Source de sélection de cours : ajout de RESIT.
-- -----------------------------------------------------------------------------
ALTER TABLE academic.enrollment_courses DROP CONSTRAINT enrollment_courses_source_check;
ALTER TABLE academic.enrollment_courses
  ADD CONSTRAINT enrollment_courses_source_check CHECK (source IN ('OPTION', 'A_LA_CARTE', 'CARRY_OVER', 'RESIT'));

-- -----------------------------------------------------------------------------
-- 2 bis. Paiement d'une ligne de facture reçu AVANT la confirmation de l'inscription (`ON_LINE_PAID`) : la
--        sélection ne peut être CONFIRMED que si l'inscription est ACTIVE (garde 0704) ; le solde de la ligne est
--        mémorisé ici et la sélection est confirmée dès que l'inscription l'est — aucun encaissement perdu.
-- -----------------------------------------------------------------------------
ALTER TABLE academic.enrollment_courses ADD COLUMN line_paid_at timestamptz;

-- -----------------------------------------------------------------------------
-- 2 ter. Suppression d'une matière du catalogue (AC2.6) : refusée par la clé étrangère composite tant qu'un nœud
--        de curriculum la référence (`academic.subject_in_use`) ; permise sinon.
-- -----------------------------------------------------------------------------
GRANT DELETE ON academic.subjects TO app_user;

-- -----------------------------------------------------------------------------
-- 3. Reconduction idempotente : au plus une inscription de reconduction vivante par inscription d'origine.
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX enrollments_one_rollover_per_previous
  ON academic.enrollments (tenant_id, previous_enrollment_id)
  WHERE source_kind = 'ROLLOVER' AND status <> 'CANCELLED';
