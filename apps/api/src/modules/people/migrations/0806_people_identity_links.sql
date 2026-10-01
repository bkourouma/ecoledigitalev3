-- =============================================================================
-- 0806 — Module people : projection des accès IAM (liaison identité <-> personne)
-- =============================================================================
--
-- `persons.identity_id` désigne l'identité de connexion (module `iam`, schéma qu'on ne lit jamais : ADR-001/006).
-- Pour pouvoir (1) refuser de lier une personne à une identité qui n'a aucun accès dans CE tenant, (2) afficher
-- l'état du compte de portail d'une personne (actif / suspendu / aucun) sans jointure inter-schémas, le module
-- tient une PROJECTION minimale des accès, alimentée par les événements `iam.membership.created|changed`
-- (abonné `people.project-membership`, idempotent, insensible à l'ordre de livraison).
--
-- Aucune donnée personnelle : des UUID, un statut et des clés de rôle. Table de tenant (RLS forcée).
-- =============================================================================

CREATE TABLE people.identity_memberships (
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  identity_id        uuid NOT NULL,
  membership_id      uuid,
  status             text NOT NULL CHECK (status IN ('active', 'suspended', 'revoked', 'invited', 'unknown')),
  roles              text[] NOT NULL DEFAULT '{}',
  source_event_id    uuid NOT NULL,
  source_occurred_at timestamptz NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, identity_id)
);
SELECT kernel.enable_tenant_rls('people.identity_memberships');
GRANT SELECT, INSERT, UPDATE ON people.identity_memberships TO app_user;
