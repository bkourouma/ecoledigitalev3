-- =============================================================================
-- 0711 — Module academic : calendrier national des jours fériés (décision O-10)
-- =============================================================================
--
-- La PLATEFORME précharge un calendrier national des jours fériés ivoiriens. Deux tables :
--
--   academic.national_holidays                       référence GLOBALE (sans tenant_id, déclarée dans
--                                                    `isolation-allowlist.academic.ts`) : lecture ouverte à tous,
--                                                    écriture réservée à l'acteur `system` (RLS FORCE), comme
--                                                    `rbac.permissions` et les catalogues de `rules`.
--   academic.institution_national_holiday_settings   PAR TENANT (RLS) : un établissement peut DÉSACTIVER (ou réactiver)
--                                                    un jour férié national ; sans ligne = activé. Pour AJOUTER un jour,
--                                                    l'établissement utilise `academic.institution_holidays` (0708).
--
-- RÈGLE D'OR : AUCUNE date n'est inventée. Ne sont livrés que les jours fériés à DATE FIXE dont la date calendaire est
-- certaine. Toute ligne est `source_kind = 'placeholder'` et `needs_confirmation = true` tant qu'aucun texte officiel
-- n'a été rattaché (`source_kind = 'regulation'` + `source_reference`) : l'écran l'affiche « à confirmer ».
-- Les fêtes MOBILES (Pâques, Ascension, Pentecôte, fêtes musulmanes) sont livrées comme DÉFINITIONS SANS DATE
-- (`recurrence = 'MOVABLE'`, mois et jour absents) : l'établissement saisit leurs dates chaque année dans son calendrier.
-- La liste des jours à confirmer ou à ajouter est consignée dans `specs/v2/004-academic-core/jours-feries-ci.md`.
--
-- Migration ADDITIVE. Le seed est inséré AVANT l'activation de la RLS (le propriétaire est soumis à la RLS FORCE).
-- =============================================================================

CREATE TABLE academic.national_holidays (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code        text NOT NULL DEFAULT 'CI' CHECK (country_code ~ '^[A-Z]{2}$'),
  code                text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  label               text NOT NULL CHECK (length(btrim(label)) > 0 AND length(label) <= 200),
  kind                text NOT NULL DEFAULT 'HOLIDAY' CHECK (kind IN ('HOLIDAY')),
  recurrence          text NOT NULL CHECK (recurrence IN ('FIXED_DATE', 'MOVABLE')),
  month               smallint CHECK (month BETWEEN 1 AND 12),
  day                 smallint CHECK (day BETWEEN 1 AND 31),
  source_kind         text NOT NULL DEFAULT 'placeholder' CHECK (source_kind IN ('placeholder', 'regulation')),
  source_reference    text,
  needs_confirmation  boolean NOT NULL DEFAULT true,
  note                text,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country_code, code),
  -- une fête à date fixe porte un mois et un jour valides ; une fête mobile n'en porte AUCUN (la date est saisie par l'école)
  CONSTRAINT national_holidays_fixed_date_ck CHECK (
    (recurrence = 'FIXED_DATE' AND month IS NOT NULL AND day IS NOT NULL AND day <= (ARRAY[31,29,31,30,31,30,31,31,30,31,30,31])[month])
    OR (recurrence = 'MOVABLE' AND month IS NULL AND day IS NULL)
  ),
  -- une ligne `regulation` cite sa référence ; une ligne confirmée est forcément sourcée
  CONSTRAINT national_holidays_source_ck CHECK (
    (source_kind = 'placeholder' AND needs_confirmation)
    OR (source_kind = 'regulation' AND length(btrim(coalesce(source_reference, ''))) > 0)
  )
);

-- Jours fériés à DATE FIXE dont la date calendaire est certaine (Côte d'Ivoire). Tous « à confirmer ».
INSERT INTO academic.national_holidays (country_code, code, label, recurrence, month, day, source_kind, needs_confirmation, note) VALUES
  ('CI', 'NEW_YEAR',        'Jour de l''An',                 'FIXED_DATE',  1,  1, 'placeholder', true, 'Date fixe. Valeur de démonstration à confirmer par le texte en vigueur.'),
  ('CI', 'LABOUR_DAY',      'Fête du Travail',               'FIXED_DATE',  5,  1, 'placeholder', true, 'Date fixe. Valeur de démonstration à confirmer par le texte en vigueur.'),
  ('CI', 'INDEPENDENCE_DAY','Fête de l''Indépendance',       'FIXED_DATE',  8,  7, 'placeholder', true, 'Date fixe. Valeur de démonstration à confirmer par le texte en vigueur.'),
  ('CI', 'ASSUMPTION',      'Assomption',                    'FIXED_DATE',  8, 15, 'placeholder', true, 'Date fixe. Valeur de démonstration à confirmer par le texte en vigueur.'),
  ('CI', 'ALL_SAINTS',      'Toussaint',                     'FIXED_DATE', 11,  1, 'placeholder', true, 'Date fixe. Valeur de démonstration à confirmer par le texte en vigueur.'),
  ('CI', 'CHRISTMAS',       'Noël',                          'FIXED_DATE', 12, 25, 'placeholder', true, 'Date fixe. Valeur de démonstration à confirmer par le texte en vigueur.');

-- Fêtes MOBILES : définitions SANS date. L'établissement saisit les dates de l'année dans son calendrier (0708).
INSERT INTO academic.national_holidays (country_code, code, label, recurrence, source_kind, needs_confirmation, note) VALUES
  ('CI', 'EASTER_MONDAY',   'Lundi de Pâques',               'MOVABLE', 'placeholder', true, 'Fête mobile : date à saisir chaque année par l''établissement.'),
  ('CI', 'ASCENSION',       'Ascension',                     'MOVABLE', 'placeholder', true, 'Fête mobile : date à saisir chaque année par l''établissement.'),
  ('CI', 'WHIT_MONDAY',     'Lundi de Pentecôte',            'MOVABLE', 'placeholder', true, 'Fête mobile : date à saisir chaque année par l''établissement.'),
  ('CI', 'EID_AL_FITR',     'Aïd el-Fitr (fin du Ramadan)',  'MOVABLE', 'placeholder', true, 'Fête mobile (calendrier lunaire) : date à saisir chaque année par l''établissement.'),
  ('CI', 'EID_AL_ADHA',     'Aïd el-Adha (Tabaski)',         'MOVABLE', 'placeholder', true, 'Fête mobile (calendrier lunaire) : date à saisir chaque année par l''établissement.'),
  ('CI', 'MAWLID',          'Mawlid (Maouloud)',             'MOVABLE', 'placeholder', true, 'Fête mobile (calendrier lunaire) : date à saisir chaque année par l''établissement.');

-- Table GLOBALE : lecture ouverte, écriture réservée à l'acteur `system` (console de la plateforme).
ALTER TABLE academic.national_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE academic.national_holidays FORCE ROW LEVEL SECURITY;
CREATE POLICY national_holidays_read ON academic.national_holidays FOR SELECT USING (true);
CREATE POLICY national_holidays_system_insert ON academic.national_holidays FOR INSERT WITH CHECK (kernel.current_actor() = 'system');
CREATE POLICY national_holidays_system_update ON academic.national_holidays FOR UPDATE
  USING (kernel.current_actor() = 'system') WITH CHECK (kernel.current_actor() = 'system');
GRANT SELECT, INSERT, UPDATE ON academic.national_holidays TO app_user;       -- jamais DELETE : on désactive (`active = false`)

-- Réglage par établissement : désactiver / réactiver un jour férié national (sans ligne = activé).
CREATE TABLE academic.institution_national_holiday_settings (
  id                    uuid PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id        uuid NOT NULL,                                  -- tenancy.institutions.id (sans FK)
  national_holiday_code text NOT NULL CHECK (national_holiday_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  enabled               boolean NOT NULL,
  updated_by            uuid,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, institution_id, national_holiday_code)
);
SELECT kernel.enable_tenant_rls('academic.institution_national_holiday_settings');
GRANT SELECT, INSERT, UPDATE, DELETE ON academic.institution_national_holiday_settings TO app_user;
