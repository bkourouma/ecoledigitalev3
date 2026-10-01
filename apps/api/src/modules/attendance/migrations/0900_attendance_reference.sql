-- =============================================================================
-- 0900 — Module attendance : schéma et référentiels pilotés par les modèles de pack
-- =============================================================================
--
-- Plage de numéros réservée au module attendance : 0900–0949 (numéros GLOBAUX, voir
-- docs/architecture/module-conventions.md, tableau des plages).
--
-- UN SEUL modèle d'appel remplace les quatre systèmes du legacy (attendance_sessions +
-- student_attendance, teacher_attendance_*, professional_ecue_attendance, récaps saisis à la
-- main) : une SÉANCE D'APPEL (`sessions`) porte des POINTAGES (`student_records`) par
-- inscription. Les statuts sont des DONNÉES (`status_definitions`) dont les drapeaux
-- (compte comme présence / absence / retard) pilotent les comptages — aucune règle de seuil
-- ni d'équivalence (« 3 retards = 1 absence ») n'est dans ce module : elles relèvent des
-- RuleSets et des politiques des modules consommateurs.
-- Références inter-modules par UUID, sans FK : academic (année, classe, inscription, nœud),
-- people (élève, personnel), scheduling (occurrence).
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS attendance;
REVOKE ALL ON SCHEMA attendance FROM PUBLIC;
GRANT USAGE ON SCHEMA attendance TO app_user;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Statuts de présence. Codes système verrouillés (is_system) : PRESENT, ABSENT, LATE, EXCUSED,
-- EARLY_LEAVE (élèves, PRD §33) ; PRESENT, ABSENT, LATE, ON_LEAVE (personnel). Un tenant peut
-- AJOUTER des statuts (ex. MEDICAL_LEAVE) mais pas modifier la sémantique des statuts système.
CREATE TABLE attendance.status_definitions (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  subject_kind       text NOT NULL CHECK (subject_kind IN ('STUDENT', 'STAFF')),
  code               text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label              text NOT NULL CHECK (length(btrim(label)) > 0),
  counts_as_present  boolean NOT NULL DEFAULT false,
  counts_as_absence  boolean NOT NULL DEFAULT false,
  counts_as_late     boolean NOT NULL DEFAULT false,
  is_justified       boolean NOT NULL DEFAULT false,
  requires_justification boolean NOT NULL DEFAULT false,
  sort_order         integer NOT NULL DEFAULT 0,
  is_system          boolean NOT NULL DEFAULT false,
  active             boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, subject_kind, code),
  CHECK (NOT (counts_as_present AND counts_as_absence)),
  CHECK (NOT is_justified OR counts_as_absence OR counts_as_late)
);
SELECT kernel.enable_tenant_rls('attendance.status_definitions');
GRANT SELECT, INSERT, UPDATE ON attendance.status_definitions TO app_user;

-- Motifs de justification d'absence (maladie, famille, transport…), donnée de pack.
CREATE TABLE attendance.justification_reasons (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES kernel.tenants (id),
  code                 text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label                text NOT NULL CHECK (length(btrim(label)) > 0),
  requires_attachment  boolean NOT NULL DEFAULT false,
  sort_order           integer NOT NULL DEFAULT 0,
  active               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('attendance.justification_reasons');
GRANT SELECT, INSERT, UPDATE ON attendance.justification_reasons TO app_user;

-- Types de congé du personnel. `is_paid` est une information pour la paie (spec 031/032).
CREATE TABLE attendance.leave_types (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES kernel.tenants (id),
  code                 text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label                text NOT NULL CHECK (length(btrim(label)) > 0),
  is_paid              boolean NOT NULL DEFAULT true,
  requires_approval    boolean NOT NULL DEFAULT true,
  requires_attachment  boolean NOT NULL DEFAULT false,
  active               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('attendance.leave_types');
GRANT SELECT, INSERT, UPDATE ON attendance.leave_types TO app_user;

-- Politique d'appel par cycle d'enseignement : appel journalier (primaire : l'instituteur fait
-- l'appel du matin) ou par séance (secondaire, supérieur), fenêtre de correction après
-- soumission. Ce sont des politiques d'établissement, pas des règles réglementaires.
CREATE TABLE attendance.call_policies (
  tenant_id            uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id       uuid NOT NULL,
  education_level_code text NOT NULL,                    -- academic.education_levels.code ('*' = défaut)
  call_scope           text NOT NULL DEFAULT 'SESSION' CHECK (call_scope IN ('DAILY', 'SESSION', 'BOTH')),
  edit_window_minutes  integer CHECK (edit_window_minutes IS NULL OR edit_window_minutes >= 0),
  late_requires_minutes boolean NOT NULL DEFAULT false,
  -- Durée (minutes) comptée pour une absence constatée à l'appel JOURNALIER (sans durée de
  -- séance) ; NULL = on ne compte que des jours (counted_minutes reste NULL).
  daily_minutes        integer CHECK (daily_minutes IS NULL OR daily_minutes > 0),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, institution_id, education_level_code)
);
SELECT kernel.enable_tenant_rls('attendance.call_policies');
GRANT SELECT, INSERT, UPDATE ON attendance.call_policies TO app_user;

-- Paramètres du tenant (une ligne) : pièces jointes acceptées pour les justificatifs et congés.
-- NULL = dépôt de pièces désactivé tant que le modèle de pack ou le tenant n'a rien fixé.
CREATE TABLE attendance.settings (
  tenant_id                uuid PRIMARY KEY REFERENCES kernel.tenants (id),
  attachment_max_bytes     integer CHECK (attachment_max_bytes IS NULL OR attachment_max_bytes > 0),
  allowed_attachment_types text[] CHECK (allowed_attachment_types IS NULL OR allowed_attachment_types <@ ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
SELECT kernel.enable_tenant_rls('attendance.settings');
GRANT SELECT, INSERT, UPDATE ON attendance.settings TO app_user;
