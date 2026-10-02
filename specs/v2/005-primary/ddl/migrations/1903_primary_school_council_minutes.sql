-- =============================================================================
-- 1903 — Module primary_school : période du conseil des maîtres et procès-verbal FIGÉ
-- =============================================================================
--
-- Additif à 1902 (ajouté à l'implémentation, spec 005 §7) :
--   - `council_cases.academic_period_id` : la délibération de `results` est portée par une classe × période ; le dossier
--     retient la période pour que la liste et la lecture d'un conseil ne demandent pas au module `results` de la retrouver.
--     Colonne NULLABLE (les lignes antérieures à cette migration n'ont pas de période).
--   - `council_minutes` : le contenu FIGÉ du procès-verbal (date réelle de séance, participants, décisions, justifications) et
--     son empreinte. Le document est rendu par `reportcards` depuis ce contenu, jamais depuis les tables vivantes. Ajout seul :
--     seul l'identifiant du document émis se renseigne, UNE fois ; un nouveau contenu est la version n+1.
-- =============================================================================

ALTER TABLE primary_school.council_cases ADD COLUMN academic_period_id uuid;      -- academic.academic_periods.id (sans FK)
CREATE INDEX council_cases_by_class_period ON primary_school.council_cases (tenant_id, classroom_id, academic_period_id);

CREATE TABLE primary_school.council_minutes (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  deliberation_id     uuid NOT NULL,                  -- results.deliberations.id (sans FK)
  classroom_id        uuid NOT NULL,
  academic_period_id  uuid,
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  content             jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  content_hash        text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  rule_source_kind    text CHECK (rule_source_kind IS NULL OR rule_source_kind IN ('regulation', 'institution', 'platform', 'placeholder')),
  document_id         uuid,                           -- reportcards : document officiel émis (renseigné une fois)
  requested_by        uuid NOT NULL,
  requested_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, deliberation_id, version),
  UNIQUE (tenant_id, deliberation_id, content_hash)
);
SELECT kernel.enable_tenant_rls('primary_school.council_minutes');
CREATE INDEX council_minutes_by_deliberation ON primary_school.council_minutes (tenant_id, deliberation_id, version DESC);
GRANT SELECT, INSERT, UPDATE ON primary_school.council_minutes TO app_user;

CREATE FUNCTION primary_school.council_minutes_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'primary_school.append_only: les procès-verbaux ne se suppriment pas' USING ERRCODE = 'restrict_violation';
  END IF;
  -- seul permis : renseigner UNE fois l'identifiant du document émis
  IF OLD.document_id IS NULL
     AND NEW.document_id IS NOT NULL
     AND ROW(NEW.deliberation_id, NEW.classroom_id, NEW.academic_period_id, NEW.version, NEW.content, NEW.content_hash, NEW.rule_source_kind, NEW.requested_by, NEW.requested_at)
         IS NOT DISTINCT FROM
         ROW(OLD.deliberation_id, OLD.classroom_id, OLD.academic_period_id, OLD.version, OLD.content, OLD.content_hash, OLD.rule_source_kind, OLD.requested_by, OLD.requested_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'primary_school.append_only: un procès-verbal est figé (nouvelle version pour un nouveau contenu)' USING ERRCODE = 'restrict_violation';
END
$$;
CREATE TRIGGER council_minutes_guard BEFORE UPDATE OR DELETE ON primary_school.council_minutes
  FOR EACH ROW EXECUTE FUNCTION primary_school.council_minutes_guard();
