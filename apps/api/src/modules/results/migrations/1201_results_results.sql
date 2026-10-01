-- =============================================================================
-- 1201 — Module results : résultats calculés (en-têtes versionnés et lignes)
-- =============================================================================

CREATE TABLE results.period_results (                -- en-tête : une version de résultats d'une inscription pour une période (ou une année)
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  state_id            uuid NOT NULL,
  enrollment_id       uuid NOT NULL,
  student_id          uuid NOT NULL,
  classroom_id        uuid NOT NULL,
  academic_period_id  uuid,
  academic_year_id    uuid NOT NULL,
  scope               text NOT NULL CHECK (scope IN ('PERIOD', 'YEAR')),
  version             integer NOT NULL CHECK (version >= 1),
  status              text NOT NULL CHECK (status IN ('DRAFT', 'FINAL', 'SUPERSEDED', 'ERROR')),
  -- reproductibilité
  contract_id         text NOT NULL,
  rule_version_kind   text NOT NULL,
  rule_version_id     uuid NOT NULL,
  rule_set_code       text NOT NULL,
  rule_version_no     integer NOT NULL,
  definition_hash     text NOT NULL,
  engine_version      text NOT NULL,
  inputs_hash         text NOT NULL CHECK (inputs_hash ~ '^[0-9a-f]{64}$'),
  outputs_hash        text CHECK (outputs_hash IS NULL OR outputs_hash ~ '^[0-9a-f]{64}$'),
  inputs              jsonb,                           -- contexte canonique (FINAL seulement ; sans identité)
  error               jsonb,                           -- diagnostic si status = ERROR
  -- synthèse typée (valeurs exactes + valeur d'affichage séparée)
  average             numeric,                         -- exact
  average_display     numeric(6, 2),                   -- sortie de arrondi_affichage (jamais réinjectée)
  rank                integer CHECK (rank IS NULL OR rank >= 1),
  cohort_size         integer CHECK (cohort_size IS NULL OR cohort_size >= 0),
  mention_code        text,
  decision_code       text,
  decision_outcome    text CHECK (decision_outcome IS NULL OR decision_outcome IN
                        ('PROMOTED', 'REPEAT', 'PENDING', 'EXAM_REFERRAL', 'ADMITTED', 'RESIT', 'ADJOURNED', 'OTHER')),
  credits_acquired    numeric(8, 2),
  credits_required    numeric(8, 2),
  validated           boolean,
  summary             jsonb NOT NULL DEFAULT '{}'::jsonb,   -- autres sorties de synthèse (distinction, appréciation…) : codes
  closure_id          uuid,                            -- clôture qui a produit ce FINAL
  line_count          integer,                         -- nombre de lignes attendues (FINAL : scellé)
  computed_at         timestamptz NOT NULL DEFAULT now(),
  finalized_at        timestamptz,
  superseded_at       timestamptz,
  supersedes_id       uuid,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, state_id) REFERENCES results.period_states (tenant_id, id),
  FOREIGN KEY (tenant_id, closure_id) REFERENCES results.closures (tenant_id, id),
  CHECK ((scope = 'PERIOD') = (academic_period_id IS NOT NULL)),
  CHECK (status <> 'FINAL' OR (finalized_at IS NOT NULL AND outputs_hash IS NOT NULL AND inputs IS NOT NULL AND closure_id IS NOT NULL AND line_count IS NOT NULL)),
  CHECK (status <> 'SUPERSEDED' OR superseded_at IS NOT NULL),
  CHECK (status <> 'ERROR' OR error IS NOT NULL)
);
CREATE UNIQUE INDEX period_results_version_uq ON results.period_results (tenant_id, state_id, enrollment_id, version);
CREATE UNIQUE INDEX period_results_final_uq   ON results.period_results (tenant_id, state_id, enrollment_id) WHERE status = 'FINAL';
CREATE UNIQUE INDEX period_results_draft_uq   ON results.period_results (tenant_id, state_id, enrollment_id) WHERE status IN ('DRAFT', 'ERROR');
CREATE INDEX period_results_student_idx       ON results.period_results (tenant_id, student_id, academic_year_id) WHERE status = 'FINAL';
CREATE INDEX period_results_rank_idx          ON results.period_results (tenant_id, state_id, rank) WHERE status IN ('DRAFT', 'FINAL');
SELECT kernel.enable_tenant_rls('results.period_results');
GRANT SELECT, INSERT, UPDATE, DELETE ON results.period_results TO app_user;    -- DELETE : brouillons seulement (déclencheur)

CREATE TABLE results.line_results (                  -- détail par nœud
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  period_result_id   uuid NOT NULL,
  level              text NOT NULL CHECK (level IN ('ECUE', 'SUBJECT', 'UE', 'SECTION', 'PERIOD', 'YEAR')),
  curriculum_node_id uuid,
  parent_node_id     uuid,
  value              numeric,                        -- moyenne/note exacte ; NULL = non notée
  display_value      numeric(6, 2),
  credits            numeric(8, 2),
  coefficient        numeric(8, 3),
  validated          boolean,
  status_code        text,                           -- ex. VALIDATED, COMPENSATED, ELIMINATORY, PENDING
  session_obtained   smallint CHECK (session_obtained IS NULL OR session_obtained IN (1, 2)),
  resit_eligible     boolean,
  rank               integer CHECK (rank IS NULL OR rank >= 1),
  cohort_size        integer,
  overridden         boolean NOT NULL DEFAULT false,
  override_id        uuid,
  outputs            jsonb NOT NULL DEFAULT '{}'::jsonb,   -- autres sorties de règle (codes)
  trace              jsonb,                          -- trace du moteur (FINAL seulement)
  position           integer NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, period_result_id) REFERENCES results.period_results (tenant_id, id),
  CHECK ((level IN ('PERIOD', 'YEAR')) = (curriculum_node_id IS NULL)),
  CHECK (NOT overridden OR override_id IS NOT NULL)
);
CREATE UNIQUE INDEX line_results_node_uq ON results.line_results
  (tenant_id, period_result_id, level, coalesce(curriculum_node_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX line_results_node_idx ON results.line_results (tenant_id, curriculum_node_id, level);
SELECT kernel.enable_tenant_rls('results.line_results');
GRANT SELECT, INSERT, UPDATE, DELETE ON results.line_results TO app_user;      -- UPDATE/DELETE : brouillon seulement (déclencheur)
