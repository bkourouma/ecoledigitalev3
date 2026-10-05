-- =============================================================================
-- 1409 — Module higher : UE annuelle (offerte sur plusieurs semestres, un résultat commun) — décision O-11
-- =============================================================================
--
-- Une UE peut être suivie sur DEUX semestres (UE annuelle). Elle reste UNE SEULE acquisition au registre de crédits
-- (identité = `annual_ues.ue_node_id`, la lignée « ancre ») mais son résultat est COMMUN : il n'existe qu'une fois les
-- résultats FINAL de TOUS les semestres de l'année reçus, et il est décidé par les RÈGLES (RuleSet, contrat
-- `credit-semester@1` : `moyenne_annuelle`, `credits_ue`, `ue_validee`, `etat_ue`, `session_validation_ue`) — jamais par
-- une formule de ce module.
--
--   annual_ues          déclaration : UE annuelle (ancre) et nombre de semestres attendus (>= 2)
--   annual_ue_members   lignées d'UE qui alimentent l'UE annuelle (la partie du semestre 1, celle du semestre 2…) ;
--                       l'ancre en fait partie ; une lignée n'appartient qu'à UNE UE annuelle
--   annual_ue_parts     résultat FINAL d'une PARTIE (un semestre) reçu de `results`, par étudiant et année ; mis à jour
--                       à chaque reclôture (version supérieure) ; jamais supprimé
--
-- Migration ADDITIVE : sans ligne dans `annual_ues`, le comportement de la capitalisation est strictement inchangé
-- (parité des résultats existants, prouvée par test).
-- =============================================================================

CREATE TABLE higher.annual_ues (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  ue_node_id      uuid NOT NULL,                                -- lignée « ancre » : identité de l'UE annuelle au registre
  parts_expected  smallint NOT NULL DEFAULT 2 CHECK (parts_expected BETWEEN 2 AND 4),
  reason          text NOT NULL CHECK (length(btrim(reason)) >= 5),
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, ue_node_id)
);
SELECT kernel.enable_tenant_rls('higher.annual_ues');
GRANT SELECT, INSERT, UPDATE, DELETE ON higher.annual_ues TO app_user;

CREATE TABLE higher.annual_ue_members (
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  annual_ue_id      uuid NOT NULL,
  member_ue_node_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, member_ue_node_id),                   -- une lignée n'alimente qu'UNE UE annuelle
  FOREIGN KEY (tenant_id, annual_ue_id) REFERENCES higher.annual_ues (tenant_id, id) ON DELETE CASCADE
);
SELECT kernel.enable_tenant_rls('higher.annual_ue_members');
GRANT SELECT, INSERT, DELETE ON higher.annual_ue_members TO app_user;

CREATE TABLE higher.annual_ue_parts (
  id                      uuid PRIMARY KEY,
  tenant_id               uuid NOT NULL REFERENCES kernel.tenants (id),
  annual_ue_id            uuid NOT NULL,
  student_id              uuid NOT NULL,
  enrollment_id           uuid NOT NULL,
  academic_year_id        uuid NOT NULL,
  academic_period_id      uuid NOT NULL,
  part_ue_node_id         uuid NOT NULL,                        -- lignée de la partie telle que publiée par results
  credits                 numeric(8,2) NOT NULL CHECK (credits >= 0),
  average_exact           numeric,
  validated               boolean NOT NULL,
  ue_state                text NOT NULL CHECK (ue_state IN ('VALIDATED', 'RESIT', 'DEBT')),
  session_obtained        smallint CHECK (session_obtained IN (1, 2)),
  via                     text NOT NULL CHECK (via IN ('DIRECT', 'RESIT', 'JURY_OVERRIDE')),
  override_id             uuid,
  compensated_ecue_count  smallint NOT NULL DEFAULT 0 CHECK (compensated_ecue_count >= 0),
  source_result_id        uuid NOT NULL,
  results_version         integer NOT NULL CHECK (results_version >= 0),
  validated_at            timestamptz,
  recorded_at             timestamptz NOT NULL,
  updated_at              timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  -- UN résultat par (UE annuelle, étudiant, année, semestre) : rejouer un événement ne duplique rien
  UNIQUE (tenant_id, annual_ue_id, student_id, academic_year_id, academic_period_id),
  FOREIGN KEY (tenant_id, annual_ue_id) REFERENCES higher.annual_ues (tenant_id, id)
);
CREATE INDEX annual_ue_parts_student_idx ON higher.annual_ue_parts (tenant_id, student_id, annual_ue_id, academic_year_id);
SELECT kernel.enable_tenant_rls('higher.annual_ue_parts');
GRANT SELECT, INSERT, UPDATE ON higher.annual_ue_parts TO app_user;            -- jamais DELETE
