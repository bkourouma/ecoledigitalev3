-- =============================================================================
-- 2100 — Module councils : schéma et référentiels du conseil de classe
-- =============================================================================
--
-- Plage de numéros du module councils : 2100–2199 (numéros GLOBAUX, voir
-- docs/architecture/module-conventions.md).
--
-- Règles (module-conventions.md, ADR-002/006/007) :
--   - un module = un schéma (`councils`) ; AUCUNE clé étrangère vers le schéma d'un autre module,
--     sauf `kernel.tenants(id)`. Les références vers `academic` (classe, période, inscription,
--     programme, niveau), `people` (élève, personnel, personne), `results` (état de période,
--     délibération), `messaging` sont des UUID vérifiés par des PORTS ;
--   - toute table : `tenant_id uuid NOT NULL REFERENCES kernel.tenants(id)`, puis
--     `kernel.enable_tenant_rls()`, puis GRANT explicite à `app_user` ;
--   - clés étrangères internes COMPOSITES (tenant_id, id) ;
--   - AUCUNE règle réglementaire : types de conseil, rôles de participants, quorum, types de
--     décision sont de la DONNÉE (modèle de pack ou établissement). Toutes les valeurs numériques
--     (quorum, seuils) sont NULLables : NULL = pas de contrôle, jamais une valeur « officielle »
--     devinée.
--
-- Exécutée sous `SET ROLE migrator` par le runner.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS councils;
REVOKE ALL ON SCHEMA councils FROM PUBLIC;
GRANT USAGE ON SCHEMA councils TO app_user;

-- -----------------------------------------------------------------------------
-- Gardes communes
-- -----------------------------------------------------------------------------
CREATE FUNCTION councils.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'councils.immutable: % est immuable (% interdit)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;

-- L'application ne décide JAMAIS seule d'un acte réglementaire : une décision, une résolution de
-- proposition ou une signature exige une session d'UTILISATEUR (acteur 'user' avec identifiant).
-- Un job, une règle ou une opération système (acteur 'system') est refusé par la base elle-même.
CREATE FUNCTION councils.require_human_actor() RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_user uuid := kernel.current_user_id();
BEGIN
  IF v_user IS NULL OR coalesce(kernel.current_actor(), '') <> 'user' THEN
    RAISE EXCEPTION 'councils.human_decision_required: cet acte exige un utilisateur identifié (acteur % )', coalesce(kernel.current_actor(), 'inconnu')
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN v_user;
END
$$;

-- -----------------------------------------------------------------------------
-- Rôles de participant (président, secrétaire, professeur principal, délégués…) : DONNÉES.
--   can_decide : peut être le « décideur » d'une décision du conseil (porte la responsabilité).
--   is_external : n'est pas un membre du personnel (délégué des parents, des élèves…).
-- -----------------------------------------------------------------------------
CREATE TABLE councils.participant_roles (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  code              text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label             text NOT NULL CHECK (length(btrim(label)) > 0),
  is_voting         boolean NOT NULL DEFAULT true,
  counts_for_quorum boolean NOT NULL DEFAULT true,
  may_sign          boolean NOT NULL DEFAULT true,
  can_decide        boolean NOT NULL DEFAULT false,
  is_external       boolean NOT NULL DEFAULT false,
  sort_order        integer NOT NULL DEFAULT 0,
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('councils.participant_roles');
GRANT SELECT, INSERT, UPDATE ON councils.participant_roles TO app_user;

-- -----------------------------------------------------------------------------
-- Types de conseil (conseil de période, conseil de fin d'année, conseil exceptionnel…).
--   scope                     PERIOD : rattaché à une période ; YEAR : bilan de fin d'année
--   min_results_status        état minimal de `results` pour ouvrir le conseil (le conseil délibère
--                             sur des résultats au moins verrouillés par défaut)
--   min_participants          quorum (nombre de présents comptant pour le quorum) ; NULL = aucun contrôle
--   required_role_codes       rôles qui doivent être représentés (au moins un PRÉSENT chacun) ; vide = aucun contrôle
--   signer_functions / signer_role_codes   qui doit signer le procès-verbal (au moins un signataire exigé)
--   requires_decision_per_student   la séance ne peut être close que si chaque élève a une décision
-- Aucune valeur par défaut « officielle » : les valeurs viennent du modèle de pack ou de l'établissement.
-- -----------------------------------------------------------------------------
CREATE TABLE councils.council_types (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  code                text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label               text NOT NULL CHECK (length(btrim(label)) > 0),
  scope               text NOT NULL CHECK (scope IN ('PERIOD', 'YEAR')),
  min_results_status  text NOT NULL DEFAULT 'GRADING_LOCKED' CHECK (min_results_status IN ('OPEN', 'GRADING_LOCKED')),
  min_participants    integer CHECK (min_participants IS NULL OR min_participants > 0),
  required_role_codes text[] NOT NULL DEFAULT '{}',
  signer_functions    text[] NOT NULL DEFAULT '{PRESIDENT,SECRETARY}'
                      CHECK (signer_functions <@ ARRAY['PRESIDENT', 'SECRETARY']::text[]),
  signer_role_codes   text[] NOT NULL DEFAULT '{}',
  requires_decision_per_student boolean NOT NULL DEFAULT false,
  sort_order          integer NOT NULL DEFAULT 0,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  -- Un procès-verbal sans aucun signataire exigé n'aurait aucune valeur : au moins une fonction ou un rôle.
  CHECK (cardinality(signer_functions) + cardinality(signer_role_codes) >= 1)
);
SELECT kernel.enable_tenant_rls('councils.council_types');
GRANT SELECT, INSERT, UPDATE ON councils.council_types TO app_user;

-- -----------------------------------------------------------------------------
-- Types de décision (passage, redoublement, orientation, réorientation, exclusion, avis requis,
-- autre) : la FAMILLE pilote les effets, le CODE et le libellé sont des données.
--   exclusive_group           deux décisions du même groupe ne coexistent pas pour un élève
--                             (ex. 'YEAR_OUTCOME' pour passage / redoublement / orientation)
--   results_decision_kind / results_final_code
--                             correspondance vers `results.decisions` (familles PASSAGE et REPEAT
--                             seulement) : le code final DOIT être permis par le contrat de règles
--                             (contrôlé par `results`, pas ici)
--   academic_outcome_code     issue d'inscription à enregistrer dans `academic` (`enrollment_outcomes.code`)
--   needs_human_application   l'effet est une DEMANDE à traiter par un humain habilité (exclusion) :
--                             jamais appliqué automatiquement
-- -----------------------------------------------------------------------------
CREATE TABLE councils.decision_types (
  id                     uuid PRIMARY KEY,
  tenant_id              uuid NOT NULL REFERENCES kernel.tenants (id),
  code                   text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label                  text NOT NULL CHECK (length(btrim(label)) > 0),
  family                 text NOT NULL CHECK (family IN ('PASSAGE', 'REPEAT', 'ORIENTATION', 'REORIENTATION', 'EXCLUSION', 'REQUIRED_OPINION', 'OTHER')),
  applies_to             text NOT NULL DEFAULT 'YEAR' CHECK (applies_to IN ('PERIOD', 'YEAR', 'BOTH')),
  exclusive_group        text CHECK (exclusive_group IS NULL OR exclusive_group ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  requires_justification boolean NOT NULL DEFAULT false,
  requires_vote          boolean NOT NULL DEFAULT false,
  requires_target        boolean NOT NULL DEFAULT false,
  results_decision_kind  text CHECK (results_decision_kind IS NULL OR results_decision_kind ~ '^[A-Z][A-Z0-9_]{1,40}$'),
  results_final_code     text CHECK (results_final_code IS NULL OR results_final_code ~ '^[A-Z][A-Z0-9_]{1,40}$'),
  academic_outcome_code  text CHECK (academic_outcome_code IS NULL OR academic_outcome_code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  needs_human_application boolean NOT NULL DEFAULT false,
  is_system              boolean NOT NULL DEFAULT false,
  sort_order             integer NOT NULL DEFAULT 0,
  active                 boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  CHECK ((results_decision_kind IS NULL) = (results_final_code IS NULL)),
  CHECK (results_decision_kind IS NULL OR family IN ('PASSAGE', 'REPEAT')),
  CHECK (family NOT IN ('ORIENTATION', 'REORIENTATION') OR requires_target),
  CHECK (family <> 'EXCLUSION' OR needs_human_application)
);
SELECT kernel.enable_tenant_rls('councils.decision_types');
GRANT SELECT, INSERT, UPDATE ON councils.decision_types TO app_user;

-- -----------------------------------------------------------------------------
-- Réglages par établissement (une ligne). Politiques d'établissement, pas des règles officielles.
--   require_separate_unlocker  le déverrouillage d'un conseil est approuvé par une AUTRE personne
--   effects_trigger            quand les décisions produisent leurs effets : à la clôture de séance
--                              (CLOSED) ou à la signature complète du procès-verbal (SIGNED)
--   guardian_visibility        quand une famille voit les décisions de son enfant
--   allow_quorum_waiver        ouvrir une séance sans quorum, avec motif, est possible
-- -----------------------------------------------------------------------------
CREATE TABLE councils.settings (
  tenant_id                 uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id            uuid NOT NULL,
  require_separate_unlocker boolean NOT NULL DEFAULT true,
  effects_trigger           text NOT NULL DEFAULT 'SIGNED' CHECK (effects_trigger IN ('CLOSED', 'SIGNED')),
  guardian_visibility       text NOT NULL DEFAULT 'AFTER_NOTIFICATION' CHECK (guardian_visibility IN ('NEVER', 'AFTER_SIGNATURE', 'AFTER_NOTIFICATION')),
  allow_quorum_waiver       boolean NOT NULL DEFAULT true,
  minutes_template_key      text CHECK (minutes_template_key IS NULL OR minutes_template_key ~ '^[a-z][a-z0-9-]{1,60}$'),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, institution_id)
);
SELECT kernel.enable_tenant_rls('councils.settings');
GRANT SELECT, INSERT, UPDATE ON councils.settings TO app_user;
