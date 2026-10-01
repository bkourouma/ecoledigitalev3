# Modèle de données — module `rules` (012-rules-engine)

**Statut** : DDL de **référence** (la migration réelle peut réordonner ou affiner, pas affaiblir une contrainte). Schéma Postgres `rules`. Migrations **`1000-1099`** (plage proposée ; `docs/architecture/module-conventions.md` à compléter par le lead). Conforme à `module-conventions.md` : `tenant_id uuid NOT NULL REFERENCES kernel.tenants(id)` + `kernel.enable_tenant_rls()` sur toute table de tenant ; seules références inter-modules : `kernel.tenants`. Les identifiants du cœur (`curriculum_node_id`, `institution_id`…) sont des **UUID sans FK**.

## 1. Décision de structure : deux familles de tables

Le moteur modélise un `RuleSet` de portée `national` ou `tenant` (`RuleScopeSchema`). `kernel.enable_tenant_rls()` impose `tenant_id NOT NULL` et **une seule** policy ; elle ne sait pas exposer des lignes « nationales » à tous les tenants. Au lieu d'une table à portée mixte avec policy sur mesure (non couverte par le test d'isolation générique), on sépare :

| Famille | Tables | `tenant_id` | RLS | Écriture |
|---|---|---|---|---|
| **Nationale** (catalogue plateforme) | `national_rule_sets`, `national_rule_versions`, `national_rule_definitions`, `national_version_events`, `platform_settings` | aucun | policy `SELECT USING (true)` ; écriture `kernel.current_actor() = 'system'` (même patron que `rbac.permissions`) | `SystemDb` (console super-admin), jamais un tenant |
| **Tenant** (variantes, liaisons, simulations) | `rule_sets`, `rule_versions`, `rule_definitions`, `version_events`, `rule_bindings`, `simulations`, `simulation_differences`, `evaluation_failures` | oui | `tenant_isolation` générée | `app_user` via `TenantDb` |

Les cinq tables nationales sont à inscrire dans `isolation-allowlist.rules.ts` avec la justification « catalogue réglementaire identique pour tous les tenants, sans donnée de tenant ni donnée personnelle ; écriture réservée à l'acteur `system` ».

## 2. Famille nationale (migration `1001_rules_national.sql`)

```sql
CREATE SCHEMA rules;
CREATE EXTENSION IF NOT EXISTS btree_gist;       -- migrator ; contrainte d'exclusion

CREATE TABLE rules.platform_settings (
  key         text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_.]*$'),
  value       jsonb NOT NULL,
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- clés : decision_impact_confirm_percent (défaut 5), national_four_eyes (défaut true), replay_sample_percent (défaut 1)

CREATE TABLE rules.national_rule_sets (
  id               uuid PRIMARY KEY,
  code             text NOT NULL UNIQUE CHECK (code ~ '^[A-Z][A-Z0-9_-]{2,63}$'),   -- ex. CI-HIGHER-LMD
  name             text NOT NULL CHECK (length(btrim(name)) > 0),
  country_code     text NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  regulation       text,
  education_system text,
  level            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rules.national_rule_versions (
  id                 uuid PRIMARY KEY,
  rule_set_id        uuid NOT NULL REFERENCES rules.national_rule_sets (id),
  version            integer NOT NULL CHECK (version >= 1),
  status             text NOT NULL CHECK (status IN ('draft','simulated','proposed','approved','published','retired')),
  contract_id        text NOT NULL CHECK (contract_id ~ '^[a-z][a-z0-9-]*@[0-9]+$'),   -- ex. credit-semester@1
  effective_from     date NOT NULL,
  effective_to       date,                                   -- inclusive ; NULL = sans fin
  source_kind        text NOT NULL CHECK (source_kind IN ('regulation','institution','platform')),
  source_reference   text,
  source_url         text,
  source_description text,
  definition_hash    text CHECK (definition_hash IS NULL OR definition_hash ~ '^[0-9a-f]{64}$'),
  notes              text,
  created_by         uuid,
  approved_by        uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_set_id, version),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  -- le hash existe dès la proposition ; approbation signée
  CHECK (status IN ('draft','simulated') OR definition_hash IS NOT NULL),
  CHECK (status NOT IN ('approved','published') OR approved_by IS NOT NULL),
  -- deux versions actives d'un même jeu et d'un même contrat ne se chevauchent jamais
  EXCLUDE USING gist (
    rule_set_id WITH =, contract_id WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  ) WHERE (status IN ('approved','published'))
);
CREATE INDEX national_rule_versions_active_idx ON rules.national_rule_versions (rule_set_id, effective_from)
  WHERE status IN ('approved','published');

CREATE TABLE rules.national_rule_definitions (
  id              uuid PRIMARY KEY,
  rule_version_id uuid NOT NULL REFERENCES rules.national_rule_versions (id),
  key             text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]*$' AND length(key) <= 64),
  type            text NOT NULL CHECK (type IN ('grading_scale','assessment_aggregation','period_average','annual_average',
                    'ranking','rounding','mention','promotion','repetition','orientation','credit_validation',
                    'compensation','eliminatory_grade')),
  position        integer NOT NULL CHECK (position >= 0),       -- ordre stable (hash déterministe)
  expression      text NOT NULL CHECK (length(expression) BETWEEN 1 AND 10000),
  description     text,
  parameters      jsonb NOT NULL DEFAULT '{}'::jsonb,           -- Record<string, ParameterSpec>
  input_schema    jsonb,                                         -- RuleSchemaSpec ; NULL = schéma du contrat
  result_type     text CHECK (result_type IN ('number','number?','string','string?','boolean','boolean?')),
  label_map       jsonb NOT NULL DEFAULT '{}'::jsonb,           -- { "<code>": { "fr": "Très bien" } }
  is_optional     boolean NOT NULL DEFAULT false,               -- règle optionnelle du contrat, non appelée en v1
  UNIQUE (rule_version_id, key)
);
```

Gardes (même migration, `rules.*`) :

- `national_rule_definitions_guard` `BEFORE INSERT OR UPDATE OR DELETE` : refuse toute écriture si la version parente n'est pas `draft` ou `simulated` (`ERRCODE restrict_violation`, message `rules.version_immutable`).
- `national_rule_versions_guard` `BEFORE UPDATE` : (a) transitions légales — miroir SQL de `TRANSITIONS` de `governance.ts` (`draft→simulated`, `simulated→proposed|draft`, `proposed→approved|draft`, `approved→published|retired`, `published→retired`, `retired→∅`) ; (b) hors `draft/simulated`, seuls `status`, `effective_to`, `approved_by`, `updated_at`, `notes` peuvent changer ; (c) `proposed` exige `definition_hash` recalculé = hash stocké (fonction `rules.compute_definition_hash(version_id)` : SHA-256 du JSON canonique ordonné par `position`) ; (d) si `platform_settings.national_four_eyes` et `status → approved` : `approved_by <> created_by`.
- `*_no_delete` `BEFORE DELETE` sur les trois tables : jamais de suppression (version `retired` conservée, AC4.5).
- Écriture réservée à l'acteur `system` :

```sql
ALTER TABLE rules.national_rule_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rules.national_rule_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY nrv_read   ON rules.national_rule_versions FOR SELECT USING (true);
CREATE POLICY nrv_insert ON rules.national_rule_versions FOR INSERT WITH CHECK (kernel.current_actor() = 'system');
CREATE POLICY nrv_update ON rules.national_rule_versions FOR UPDATE USING (kernel.current_actor() = 'system')
                                                         WITH CHECK (kernel.current_actor() = 'system');
GRANT SELECT, INSERT, UPDATE ON rules.national_rule_versions TO app_user;   -- (idem pour les autres tables nationales ; DELETE jamais)
```

```sql
CREATE TABLE rules.national_version_events (
  id              uuid PRIMARY KEY,
  rule_version_id uuid NOT NULL REFERENCES rules.national_rule_versions (id),
  from_status     text,
  to_status       text NOT NULL,
  actor_id        uuid,
  actor_name      text NOT NULL,          -- identité FIGÉE au moment de l'acte
  comment         text,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);
-- append-only : trigger rules.forbid_mutation() ; policies read/insert comme ci-dessus.
```

## 3. Famille tenant (migration `1002_rules_tenant.sql`)

```sql
CREATE TABLE rules.rule_sets (                         -- variantes d'établissement
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  code               text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_-]{2,63}$'),   -- = code du RuleSet national dérivé
  name               text NOT NULL,
  country_code       text NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  regulation         text,
  education_system   text,
  level              text,
  based_on_set_id    uuid REFERENCES rules.national_rule_sets (id),   -- FK vers table GLOBALE (même module)
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('rules.rule_sets');
GRANT SELECT, INSERT, UPDATE ON rules.rule_sets TO app_user;

CREATE TABLE rules.rule_versions (
  id                      uuid PRIMARY KEY,
  tenant_id               uuid NOT NULL REFERENCES kernel.tenants (id),
  rule_set_id             uuid NOT NULL,
  version                 integer NOT NULL CHECK (version >= 1),
  status                  text NOT NULL CHECK (status IN ('draft','simulated','proposed','approved','published','retired')),
  contract_id             text NOT NULL CHECK (contract_id ~ '^[a-z][a-z0-9-]*@[0-9]+$'),
  based_on_version_id     uuid REFERENCES rules.national_rule_versions (id),   -- version nationale copiée
  effective_from          date NOT NULL,
  effective_to            date,
  source_kind             text NOT NULL DEFAULT 'institution' CHECK (source_kind IN ('regulation','institution','platform')),
  source_reference        text,
  source_url              text,
  source_description      text,
  definition_hash         text CHECK (definition_hash IS NULL OR definition_hash ~ '^[0-9a-f]{64}$'),
  last_simulation_id      uuid,                       -- simulation COMPLETED valable pour le hash courant
  decision_impact_confirmed_by uuid,                  -- AC2.5
  decision_impact_confirmed_at timestamptz,
  notes                   text,
  created_by              uuid NOT NULL,
  approved_by             uuid,                       -- super-admin (id d'identité globale, sans FK)
  row_version             integer NOT NULL DEFAULT 1,  -- verrou optimiste
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (rule_set_id, version),
  FOREIGN KEY (tenant_id, rule_set_id) REFERENCES rules.rule_sets (tenant_id, id),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (status IN ('draft','simulated') OR definition_hash IS NOT NULL),
  CHECK (status NOT IN ('approved','published') OR approved_by IS NOT NULL),
  CHECK (status <> 'proposed' OR last_simulation_id IS NOT NULL),
  EXCLUDE USING gist (
    rule_set_id WITH =, contract_id WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  ) WHERE (status IN ('approved','published'))
);
SELECT kernel.enable_tenant_rls('rules.rule_versions');
CREATE INDEX rule_versions_active_idx ON rules.rule_versions (tenant_id, rule_set_id, effective_from)
  WHERE status IN ('approved','published');
GRANT SELECT, INSERT, UPDATE ON rules.rule_versions TO app_user;

CREATE TABLE rules.rule_definitions (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  rule_version_id uuid NOT NULL,
  key             text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]*$' AND length(key) <= 64),
  type            text NOT NULL,                 -- mêmes valeurs que national_rule_definitions.type (CHECK identique)
  position        integer NOT NULL CHECK (position >= 0),
  expression      text NOT NULL CHECK (length(expression) BETWEEN 1 AND 10000),
  description     text,
  parameters      jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_schema    jsonb,
  result_type     text CHECK (result_type IN ('number','number?','string','string?','boolean','boolean?')),
  label_map       jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_optional     boolean NOT NULL DEFAULT false,
  UNIQUE (tenant_id, id),
  UNIQUE (rule_version_id, key),
  FOREIGN KEY (tenant_id, rule_version_id) REFERENCES rules.rule_versions (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('rules.rule_definitions');
GRANT SELECT, INSERT, UPDATE, DELETE ON rules.rule_definitions TO app_user;   -- DELETE gardé par trigger (brouillon seulement)

CREATE TABLE rules.version_events (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  rule_version_id uuid NOT NULL,
  from_status     text,
  to_status       text NOT NULL,
  actor_id        uuid,
  actor_name      text NOT NULL,                -- identité figée
  actor_kind      text NOT NULL CHECK (actor_kind IN ('tenant_admin','super_admin','system')),
  comment         text,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, rule_version_id) REFERENCES rules.rule_versions (tenant_id, id)
);
CREATE INDEX version_events_version_idx ON rules.version_events (tenant_id, rule_version_id, occurred_at);
SELECT kernel.enable_tenant_rls('rules.version_events');
GRANT SELECT, INSERT ON rules.version_events TO app_user;     -- append-only (trigger)
```

Les gardes de la famille tenant sont les mêmes que celles de la famille nationale (immuabilité hors `draft/simulated`, miroir SQL des transitions, hash, `no_delete`), plus : **la transition `approved` d'une variante exige `actor_kind = 'super_admin'`** (posée par `SystemDb.runForTenant` ; un `app_user` ordinaire ne peut pas poser `approved_by`) — un administrateur d'établissement qui tenterait `UPDATE … SET status='approved'` est rejeté par le trigger (`rules.transition_forbidden`).

### 3.1 Liaisons (quel jeu de règles pour quel périmètre)

```sql
CREATE TABLE rules.rule_bindings (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  contract_id        text NOT NULL CHECK (contract_id ~ '^[a-z][a-z0-9-]*@[0-9]+$'),
  rule_set_code      text NOT NULL,                  -- code du RuleSet (national ou variante du tenant)
  institution_id     uuid,                           -- périmètre : NULL = tout le tenant
  curriculum_node_id uuid,                           -- nœud (programme/cycle) : le plus spécifique
  level_code         text,                           -- niveau (ex. 'BTS', 'LICENCE')
  effective_from     date NOT NULL,
  effective_to       date,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  -- spécificité : au plus un seul des trois critères de périmètre précis
  CHECK ((curriculum_node_id IS NOT NULL)::int + (level_code IS NOT NULL)::int <= 1),
  EXCLUDE USING gist (
    tenant_id WITH =, contract_id WITH =,
    coalesce(institution_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
    coalesce(curriculum_node_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
    coalesce(level_code, '') WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  )
);
SELECT kernel.enable_tenant_rls('rules.rule_bindings');
GRANT SELECT, INSERT, UPDATE, DELETE ON rules.rule_bindings TO app_user;
```

Résolution (`resolve`) : candidats = liaisons valides à la date ; ordre de spécificité **nœud > niveau > établissement > tenant** ; le `rule_set_code` retenu alimente `resolveRuleSet(ruleSets, { tenantId, countryCode, educationSystem, level, code, date })` du moteur (la variante active du tenant l'emporte sur le national). Les liaisons par défaut sont posées au provisioning du pack (`tenancy.tenant.provisioned`).

### 3.2 Simulations

```sql
CREATE TABLE rules.simulations (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  target_version_kind text NOT NULL CHECK (target_version_kind IN ('TENANT','NATIONAL')),
  target_version_id  uuid NOT NULL,                  -- polymorphe, sans FK ; vérifié par l'application
  base_version_kind  text NOT NULL CHECK (base_version_kind IN ('TENANT','NATIONAL')),
  base_version_id    uuid NOT NULL,
  target_definition_hash text NOT NULL,              -- la simulation n'est valable que pour CE hash
  contract_id        text NOT NULL,
  dataset            jsonb NOT NULL,                 -- { periodIds[], classroomIds?[], sample? }
  status             text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','COMPLETED','FAILED','CANCELLED')),
  progress_percent   smallint NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  cases_count        integer,
  summary            jsonb,                          -- SimulationReport.summary
  rule_stats         jsonb,                          -- RuleSimulationStats[]
  decision_changed_percent numeric(7,4),             -- pour AC2.5
  differences_truncated boolean NOT NULL DEFAULT false,
  error              text,
  requested_by       uuid NOT NULL,
  started_at         timestamptz,
  completed_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('rules.simulations');
GRANT SELECT, INSERT, UPDATE ON rules.simulations TO app_user;

CREATE TABLE rules.simulation_differences (            -- ≤ 1 000 lignes par simulation (compteurs exacts dans simulations.summary)
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  simulation_id uuid NOT NULL,
  case_ref      text NOT NULL,                       -- "<enrollment_id>:<academic_period_id>" (opaque, pour le lien)
  rule_key      text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('value_changed','error_introduced','error_resolved','error_changed')),
  old_outcome   jsonb NOT NULL,
  new_outcome   jsonb NOT NULL,
  delta         text,                                -- décimal exact
  FOREIGN KEY (tenant_id, simulation_id) REFERENCES rules.simulations (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX simulation_differences_idx ON rules.simulation_differences (tenant_id, simulation_id, rule_key);
SELECT kernel.enable_tenant_rls('rules.simulation_differences');
GRANT SELECT, INSERT ON rules.simulation_differences TO app_user;

CREATE TABLE rules.evaluation_failures (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  rule_version_kind text NOT NULL, rule_version_id uuid NOT NULL,
  rule_key       text NOT NULL,
  error_code     text NOT NULL,                      -- BUDGET_NOEUDS_DEPASSE, DONNEE_MANQUANTE, …
  message        text NOT NULL,                      -- français, sans donnée personnelle
  inputs_hash    text,
  request_id     text,
  occurred_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evaluation_failures_idx ON rules.evaluation_failures (tenant_id, occurred_at DESC);
SELECT kernel.enable_tenant_rls('rules.evaluation_failures');
GRANT SELECT, INSERT, DELETE ON rules.evaluation_failures TO app_user;      -- purge 90 jours (job)
```

## 4. Hash de définition

`definition_hash = SHA-256( JSON canonique { contract_id, rules: [ {key, type, position, expression, parameters, input_schema, result_type, label_map, is_optional} … ordonnées par position ] } )`, clés triées, chaînes Unicode normalisées NFC, nombres des paramètres en notation décimale canonique. Calculé par l'application (cohérent avec `audit`) **et** vérifiable en SQL (`rules.compute_definition_hash`) pour le trigger de proposition ; un test de contrat garantit l'égalité des deux implémentations.

## 5. Volumétrie et rétention

| Table | Volume attendu | Rétention |
|---|---|---|
| `national_*` | ~10 RuleSets × ~5 versions × ≤ 40 règles | illimitée |
| `rule_*` (tenant) | 0 à ~10 variantes par tenant | illimitée (reproductibilité) |
| `version_events` | quelques dizaines par version | illimitée |
| `simulations` / `simulation_differences` | par tenant, qq dizaines par an ; ≤ 1 000 différences chacune | 24 mois (job), les rapports liés à une version `approved/published` sont conservés |
| `evaluation_failures` | variable | 90 jours |

## 6. Données de seed (migration `1090_rules_seed.sql`)

La migration pose `SELECT set_config('app.actor', 'system', true)` (la RLS `FORCE` s'applique aussi au propriétaire) puis un script de données déterministe insère : `national_rule_sets` (`CI-HIGHER-LMD`, `CI-HIGHER-BTS`, `CI-CLASSIC-SEMESTRE`), leur `national_rule_versions` v1 (`published`, `effective_from = 2024-09-01`, `source_kind = 'platform'`, `source_reference` = fichier legacy porté), leurs `national_rule_definitions` (générées depuis les fixtures du package par un script `pnpm rules:seed` — **une seule source**, jamais deux copies), `platform_settings` par défaut. Le script vérifie que le hash calculé égale le hash stocké et que chaque règle compile (échec de migration sinon).
