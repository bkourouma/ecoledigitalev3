-- =============================================================================
-- 1400 — Module higher : schéma, réglages, utilitaires d'immuabilité
-- =============================================================================
--
-- Plage de numéros réservée au module higher : 1400–1499 (numéros GLOBAUX, voir
-- docs/architecture/module-conventions.md, tableau des plages).
--
-- Enseignement supérieur (spec v2/019) : registre de crédits (capitalisation), prérequis entre UE,
-- rattrapage (session 2), définitions de diplômes, octrois, documents officiels (snapshots immuables),
-- emplacements de signature datés, compteurs de numérotation sans trou, dettes d'UE.
--
-- Références vers le cœur académique, les personnes et les résultats : UUID SANS clé étrangère
-- (academic.curriculum_nodes, academic.enrollments, people.students, results.*, reportcards.signatories),
-- vérifiées par des PORTS. Seule FK inter-schémas : kernel.tenants(id).
-- AUCUNE constante réglementaire ni seuil académique dans ce schéma : l'éligibilité, la mention et
-- l'état d'UE sont des règles (RuleSets, module rules).
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS higher;
REVOKE ALL ON SCHEMA higher FROM PUBLIC;
GRANT USAGE ON SCHEMA higher TO app_user;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Table append-only / sans suppression : l'exception porte un SQLSTATE `restrict_violation`.
CREATE FUNCTION higher.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'higher.immutable: % est immuable (% interdit)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;

-- Réglages du module, par tenant (une ligne). `credit_validity_months` : durée de validité d'une UE capitalisée
-- (NULL = sans limite, Q-25) — un PARAMÈTRE de l'établissement, jamais une constante.
CREATE TABLE higher.settings (
  tenant_id               uuid PRIMARY KEY REFERENCES kernel.tenants (id),
  credit_validity_months  integer CHECK (credit_validity_months IS NULL OR credit_validity_months BETWEEN 1 AND 1200),
  updated_by              uuid,
  updated_at              timestamptz NOT NULL DEFAULT now()
);
SELECT kernel.enable_tenant_rls('higher.settings');
GRANT SELECT, INSERT, UPDATE ON higher.settings TO app_user;
