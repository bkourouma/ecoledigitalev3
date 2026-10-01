-- =============================================================================
-- 1401 — Module higher : définitions de diplômes et exigences
-- =============================================================================
-- Une définition est rattachée à un NŒUD DE CYCLE du curriculum (plus aucune détection par le nom de la
-- filière). `grade_code` (LICENCE, MASTER, BTS…) est une DONNÉE, jamais déduite d'un libellé.

CREATE TABLE higher.diploma_definitions (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id      uuid,
  code                text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,49}$'),
  label               text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 200),
  grade_code          text NOT NULL CHECK (grade_code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  curriculum_node_id  uuid NOT NULL,                       -- nœud « cycle / diplôme » (academic, sans FK)
  uv_required         numeric(8,2) NOT NULL CHECK (uv_required > 0),
  auto_award          boolean NOT NULL DEFAULT true,
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  description         text,
  last_synced_at      timestamptz,
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
CREATE INDEX diploma_definitions_node_idx ON higher.diploma_definitions (tenant_id, curriculum_node_id) WHERE status = 'ACTIVE';
SELECT kernel.enable_tenant_rls('higher.diploma_definitions');
GRANT SELECT, INSERT, UPDATE, DELETE ON higher.diploma_definitions TO app_user;  -- DELETE refusé par déclencheur s'il existe un octroi (1408)

CREATE TABLE higher.diploma_requirements (
  id                       uuid PRIMARY KEY,
  tenant_id                uuid NOT NULL REFERENCES kernel.tenants (id),
  definition_id            uuid NOT NULL,
  ue_node_id               uuid NOT NULL,                  -- academic.curriculum_nodes.id (UE)
  ue_code                  text,                            -- copie d'affichage, rafraîchie à la synchronisation
  ue_label                 text,
  credits                  numeric(8,2) NOT NULL DEFAULT 0 CHECK (credits >= 0),   -- crédits du curriculum à la synchronisation
  mandatory                boolean NOT NULL DEFAULT true,
  position                 integer NOT NULL DEFAULT 0,
  removed_from_curriculum  boolean NOT NULL DEFAULT false, -- signalé à la synchronisation
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (definition_id, ue_node_id),
  FOREIGN KEY (tenant_id, definition_id) REFERENCES higher.diploma_definitions (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('higher.diploma_requirements');
GRANT SELECT, INSERT, UPDATE, DELETE ON higher.diploma_requirements TO app_user;
