-- =============================================================================
-- 0708 — Module academic : calendrier de l'établissement (jours fériés, vacances, fermetures)
-- =============================================================================
--
-- Une ligne = une plage de dates civiles (un jour : `starts_on = ends_on`) qui interrompt l'enseignement. AUCUN jour
-- férié n'est livré par le module : les dates sont une DONNÉE de l'établissement (les fêtes mobiles changent chaque
-- année ; une fête fixe est marquée `recurs_yearly` et reportée par la reconduction annuelle à la même date civile).
-- Les autres modules (emploi du temps, appel) lisent cette table par `listHolidays` ; ils ne la modifient pas.
-- =============================================================================

CREATE TABLE academic.institution_holidays (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id  uuid NOT NULL,                                   -- tenancy.institutions.id (sans FK)
  label           text NOT NULL CHECK (length(btrim(label)) > 0 AND length(label) <= 200),
  kind            text NOT NULL DEFAULT 'HOLIDAY' CHECK (kind IN ('HOLIDAY', 'BREAK', 'CLOSURE')),
  starts_on       date NOT NULL,
  ends_on         date NOT NULL,
  recurs_yearly   boolean NOT NULL DEFAULT false,
  blocks_teaching boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, institution_id, starts_on, ends_on, label),
  CHECK (ends_on >= starts_on),
  CHECK (ends_on - starts_on < 366)
);
SELECT kernel.enable_tenant_rls('academic.institution_holidays');
CREATE INDEX institution_holidays_by_date ON academic.institution_holidays (tenant_id, institution_id, starts_on);
GRANT SELECT, INSERT, UPDATE, DELETE ON academic.institution_holidays TO app_user;
