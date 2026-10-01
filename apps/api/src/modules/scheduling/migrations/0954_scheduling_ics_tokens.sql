-- =============================================================================
-- 0954 — Module scheduling (spec 017, AC6.4) : jetons d'abonnement iCalendar révocables
-- =============================================================================
--
-- Un agenda externe (Google, Outlook, téléphone) s'abonne à l'emploi du temps d'une classe, d'un
-- enseignant, d'un enfant ou d'une salle par une URL portant un jeton secret. Le jeton n'est
-- JAMAIS stocké en clair (SHA-256), il est limité en lecture à UN sujet, et révocable : une fois
-- `revoked_at` posé, il ne donne plus aucun accès. Le tenant est le préfixe du jeton (route
-- publique : aucun contexte n'existe avant la résolution du jeton).
-- =============================================================================

CREATE TABLE scheduling.ics_tokens (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  scope         text NOT NULL CHECK (scope IN ('CLASSROOM', 'STAFF', 'STUDENT', 'ROOM')),
  subject_id    uuid NOT NULL,
  label         text,
  token_hash    text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz,
  revoked_at    timestamptz,
  revoked_by    uuid,
  last_used_at  timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, token_hash),
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
SELECT kernel.enable_tenant_rls('scheduling.ics_tokens');
CREATE INDEX ics_tokens_by_subject ON scheduling.ics_tokens (tenant_id, scope, subject_id);
GRANT SELECT, INSERT, UPDATE ON scheduling.ics_tokens TO app_user;
