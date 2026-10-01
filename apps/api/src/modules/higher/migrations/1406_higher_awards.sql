-- =============================================================================
-- 1406 — Module higher : octrois de diplômes
-- =============================================================================
-- Un octroi fige un SNAPSHOT des exigences (UE, crédits, obligatoire, validée), les sorties des règles (éligibilité,
-- moyenne de cycle, mention) et la version de règle : modifier ensuite la définition ou le curriculum ne le change pas
-- (AC5.4). UN seul octroi non révoqué par (définition, étudiant). Un octroi n'est jamais modifié ni supprimé, hors
-- transition terminale OBTAINED -> REVOKED (déclencheur, 1408).

CREATE TABLE higher.diploma_awards (
  id                     uuid PRIMARY KEY,
  tenant_id              uuid NOT NULL REFERENCES kernel.tenants (id),
  definition_id          uuid NOT NULL,
  student_id             uuid NOT NULL,
  last_enrollment_id     uuid,
  academic_year_id       uuid,                                -- année de la dernière inscription du cycle (NULL seulement si forcé)
  reference              text NOT NULL CHECK (reference ~ '^DIP-[0-9]{4}-[0-9]{6,}$'),
  reference_year         integer NOT NULL,
  reference_seq          bigint NOT NULL CHECK (reference_seq > 0),
  status                 text NOT NULL DEFAULT 'OBTAINED' CHECK (status IN ('OBTAINED', 'REVOKED')),
  awarded_via            text NOT NULL CHECK (awarded_via IN ('AUTO', 'MANUAL', 'FORCED')),
  forced_reason          text,
  credits_total          numeric(8,2) NOT NULL CHECK (credits_total >= 0),
  requirements_snapshot  jsonb NOT NULL,                      -- { v, uvRequired, capturedAt, requirements: [{ ueNodeId, code, label, credits, mandatory, validated, ledgerId }] }
  eligibility            jsonb NOT NULL,                      -- sorties de la règle diplome_eligible + empreintes
  cycle_average          numeric,                             -- moyenne de cycle exacte (règle moyenne_annuelle)
  mention_code           text,                                -- code du contrat (PENDING si cycle incomplet)
  rule_set_code          text NOT NULL,
  rule_version_id        uuid NOT NULL,
  rule_version_no        integer NOT NULL,
  definition_hash        text NOT NULL,
  awarded_at             timestamptz NOT NULL,
  awarded_by             uuid,                                -- NULL = système (octroi automatique)
  awarded_by_name        text NOT NULL,
  acquired_date          date,                                -- date de la DERNIÈRE acquisition requise (jamais « aujourd'hui »)
  revoked_at             timestamptz,
  revoked_by             uuid,
  revoked_by_name        text,
  revoke_reason          text,
  predecessor_award_id   uuid,                                -- ré-octroi exceptionnel après révocation (Q-22)
  reaward_decision       text,                                -- décision écrite du directeur général (référence)
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, reference),
  UNIQUE (tenant_id, reference_year, reference_seq),
  FOREIGN KEY (tenant_id, definition_id) REFERENCES higher.diploma_definitions (tenant_id, id),
  CHECK (awarded_via <> 'FORCED' OR length(btrim(coalesce(forced_reason, ''))) >= 20),
  CHECK (status <> 'REVOKED' OR (revoked_at IS NOT NULL AND length(btrim(coalesce(revoke_reason, ''))) >= 10)),
  CHECK (awarded_via = 'AUTO' OR awarded_by IS NOT NULL),
  CHECK (acquired_date IS NOT NULL OR awarded_via = 'FORCED'),
  CHECK (predecessor_award_id IS NULL OR (awarded_via <> 'AUTO' AND length(btrim(coalesce(reaward_decision, ''))) >= 20))
);
-- UN seul octroi non révoqué par (définition, étudiant)
CREATE UNIQUE INDEX diploma_awards_active_uq ON higher.diploma_awards (tenant_id, definition_id, student_id) WHERE status = 'OBTAINED';
CREATE INDEX diploma_awards_student_idx ON higher.diploma_awards (tenant_id, student_id, status);
CREATE INDEX diploma_awards_definition_idx ON higher.diploma_awards (tenant_id, definition_id, status);
SELECT kernel.enable_tenant_rls('higher.diploma_awards');
GRANT SELECT, INSERT, UPDATE ON higher.diploma_awards TO app_user;      -- UPDATE : OBTAINED -> REVOKED seulement ; jamais DELETE
