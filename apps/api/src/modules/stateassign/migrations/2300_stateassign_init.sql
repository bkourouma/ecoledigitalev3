-- =============================================================================
-- 2300 — Module stateassign : élèves affectés par l'État (STATE_ASSIGNED, PRD §20)
-- =============================================================================
--
-- Plage 2300-2399 (docs/architecture/module-conventions.md). Issu du DDL de référence de
-- specs/v2/006-secondary/data-model.md §5.9 (testé par specs/v2/006-secondary/ddl-test/stateassign.test.mjs),
-- avec les ajouts propres à ce module (réglages de planification, `control.due`).
--
-- Ce que ce module ajoute à ce qui existe déjà :
--   - `academic.enrollments` porte `funding_type` et la référence d'affectation (004) ;
--   - `finance` porte les montants FACTURÉS, les parts État / parent (bourses et factures liées) et les paiements ;
--   - `attendance` porte la présence ; `documents` porte les fichiers.
-- Ici : le DOSSIER D'AFFECTATION (référence, autorité, montants DÉCLARÉS par l'acte, vérification humaine, cycle de
-- vie, avenants versionnés), les CONTRÔLES périodiques, les documents (références), le rapprochement avec la
-- facturation et le point d'ancrage de la future couche d'intégration (`source`, `external_*`) derrière un port.
-- Les créances sur l'État (échéances) et les formats d'export sont en 2302.
-- Aucune règle officielle n'est codée : périodicités de contrôle, tolérances, délais sont des paramètres d'établissement.
--
-- Références vers `academic`, `people`, `finance`, documents : UUID sans FK, vérifiés par des ports.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS stateassign;
REVOKE ALL ON SCHEMA stateassign FROM PUBLIC;
GRANT USAGE ON SCHEMA stateassign TO app_user;

CREATE FUNCTION stateassign.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'stateassign.immutable: % est immuable (% interdit)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;

-- Acte HUMAIN : un utilisateur identifié (acteur « user »). Un job, un abonné, un opérateur de plateforme n'en sont pas.
CREATE FUNCTION stateassign.require_human_actor() RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_user uuid := kernel.current_user_id();
BEGIN
  IF v_user IS NULL OR coalesce(kernel.current_actor(), '') <> 'user' THEN
    RAISE EXCEPTION 'stateassign.human_actor_required: cet acte exige un utilisateur identifié (acteur %)', coalesce(kernel.current_actor(), 'inconnu')
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN v_user;
END
$$;

-- Réglages par établissement (une ligne)
--   require_separate_verifier   celui qui enregistre l'affectation n'est pas celui qui la vérifie
--   reconciliation_tolerance    écart toléré (unités mineures) entre montants déclarés et facturés ; 0 par défaut
--   required_control_kinds      natures de contrôle à planifier pour toute affectation active (vide : aucune)
--   control_due_offset_days     échéance d'un contrôle planifié = fin de période (ou vérification) + N jours ;
--                               NULL = AUCUNE planification automatique
--   receivable_grace_days       jours de grâce après l'échéance avant qu'une créance soit « en retard » ; 0 par défaut
CREATE TABLE stateassign.settings (
  tenant_id                  uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id             uuid NOT NULL,
  require_separate_verifier  boolean NOT NULL DEFAULT true,
  reconciliation_tolerance   bigint NOT NULL DEFAULT 0 CHECK (reconciliation_tolerance >= 0),
  required_control_kinds     text[] NOT NULL DEFAULT '{}'
                             CHECK (required_control_kinds <@ ARRAY['ATTENDANCE', 'IDENTITY', 'FINANCE_RECONCILIATION', 'DOCUMENTS', 'OTHER']::text[]),
  control_due_offset_days    integer CHECK (control_due_offset_days IS NULL OR control_due_offset_days BETWEEN 0 AND 366),
  receivable_grace_days      integer NOT NULL DEFAULT 0 CHECK (receivable_grace_days BETWEEN 0 AND 366),
  updated_by                 uuid,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, institution_id)
);
SELECT kernel.enable_tenant_rls('stateassign.settings');
GRANT SELECT, INSERT, UPDATE ON stateassign.settings TO app_user;

-- Dossier d'affectation (versionné : un avenant crée une nouvelle version, l'ancienne passe SUPERSEDED).
--   declared_state_amount / declared_parent_amount : montants DÉCLARÉS par l'acte (entiers, unités mineures) ;
--                          les montants FACTURÉS vivent dans `finance` ; l'écart (facturé − déclaré) est calculé au rapprochement.
--   source : MANUAL (saisie), IMPORT (module imports), GATEWAY (future intégration officielle) — la couche
--            d'intégration est un PORT ; `external_payload_hash` trace l'échange sans stocker de donnée brute.
CREATE TABLE stateassign.assignments (
  id                       uuid PRIMARY KEY,
  tenant_id                uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id           uuid NOT NULL,
  academic_year_id         uuid NOT NULL,
  enrollment_id            uuid NOT NULL,                 -- academic.enrollments.id
  student_id               uuid NOT NULL,                 -- people.students.id
  version                  integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  supersedes_id            uuid,
  assignment_reference     text NOT NULL CHECK (length(btrim(assignment_reference)) > 0),
  issued_on                date,
  issuing_authority        text,
  source                   text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'IMPORT', 'GATEWAY')),
  external_ref             text,
  external_payload_hash    text CHECK (external_payload_hash IS NULL OR external_payload_hash ~ '^[0-9a-f]{64}$'),
  declared_state_amount    bigint CHECK (declared_state_amount IS NULL OR declared_state_amount >= 0),
  declared_parent_amount   bigint CHECK (declared_parent_amount IS NULL OR declared_parent_amount >= 0),
  currency                 text NOT NULL DEFAULT 'XOF' CHECK (currency ~ '^[A-Z]{3}$'),
  status                   text NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED', 'VERIFIED', 'ACTIVE', 'SUSPENDED', 'ENDED', 'REJECTED', 'TRANSFERRED', 'SUPERSEDED')),
  received_by              uuid,
  received_at              timestamptz NOT NULL DEFAULT now(),
  verified_by              uuid,
  verified_at              timestamptz,
  verification_note        text,
  activated_at             timestamptz,
  suspended_at             timestamptz,
  suspension_reason        text,
  ended_on                 date,
  end_reason               text,
  rejection_reason         text,
  finance_scholarship_id   uuid,                          -- finance.scholarships.id (part de l'État)
  finance_state_invoice_id uuid,                          -- finance.invoices.id (facture liée de l'État)
  finance_parent_invoice_id uuid,                         -- finance.invoices.id (part de la famille)
  reconciliation_status    text NOT NULL DEFAULT 'NEVER' CHECK (reconciliation_status IN ('NEVER', 'BALANCED', 'DISCREPANCY')),
  last_reconciled_at       timestamptz,
  reconciled_state_delta   bigint,                        -- facturé − déclaré (part de l'État)
  reconciled_parent_delta  bigint,                        -- facturé − déclaré (part de la famille)
  notes                    text,
  row_version              integer NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, supersedes_id) REFERENCES stateassign.assignments (tenant_id, id),
  CHECK (source = 'MANUAL' AND received_by IS NOT NULL OR source <> 'MANUAL'),
  CHECK (source <> 'GATEWAY' OR external_payload_hash IS NOT NULL),
  CHECK (status NOT IN ('VERIFIED', 'ACTIVE', 'SUSPENDED', 'ENDED', 'TRANSFERRED') OR (verified_by IS NOT NULL AND verified_at IS NOT NULL)),
  CHECK (status <> 'REJECTED' OR length(btrim(coalesce(rejection_reason, ''))) >= 5),
  CHECK (status <> 'SUSPENDED' OR length(btrim(coalesce(suspension_reason, ''))) >= 5),
  CHECK (status NOT IN ('ENDED', 'TRANSFERRED', 'SUPERSEDED') OR (ended_on IS NOT NULL AND length(btrim(coalesce(end_reason, ''))) >= 5)),
  CHECK ((reconciliation_status = 'NEVER') = (last_reconciled_at IS NULL)),
  CHECK ((version = 1) = (supersedes_id IS NULL))
);
SELECT kernel.enable_tenant_rls('stateassign.assignments');
-- Un dossier vivant par inscription ; une référence n'est portée que par un dossier (hors rejeté / remplacé)
-- par établissement et par année.
CREATE UNIQUE INDEX assignments_one_live_per_enrollment
  ON stateassign.assignments (tenant_id, enrollment_id) WHERE status IN ('RECEIVED', 'VERIFIED', 'ACTIVE', 'SUSPENDED');
CREATE UNIQUE INDEX assignments_reference_uq
  ON stateassign.assignments (tenant_id, institution_id, academic_year_id, assignment_reference)
  WHERE status NOT IN ('REJECTED', 'SUPERSEDED');
CREATE INDEX assignments_by_student ON stateassign.assignments (tenant_id, student_id, academic_year_id);
CREATE INDEX assignments_by_enrollment ON stateassign.assignments (tenant_id, enrollment_id, version);
CREATE INDEX assignments_by_year ON stateassign.assignments (tenant_id, academic_year_id, institution_id, status);
CREATE INDEX assignments_unreconciled ON stateassign.assignments (tenant_id, institution_id) WHERE status = 'ACTIVE' AND reconciliation_status <> 'BALANCED';
GRANT SELECT, INSERT, UPDATE ON stateassign.assignments TO app_user;

-- Contrôles périodiques (présence, identité, rapprochement financier, pièces…) : planifiés puis réalisés par un humain.
--   evidence : faits constatés (comptages fournis par `attendance`…), sans donnée personnelle.
--   due_notified_at : l'événement `stateassign.control.due` n'est publié qu'UNE fois.
CREATE TABLE stateassign.controls (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES kernel.tenants (id),
  assignment_id        uuid NOT NULL,
  kind                 text NOT NULL CHECK (kind IN ('ATTENDANCE', 'IDENTITY', 'FINANCE_RECONCILIATION', 'DOCUMENTS', 'OTHER')),
  academic_period_id   uuid,
  due_on               date NOT NULL,
  status               text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'OK', 'ANOMALY', 'WAIVED')),
  performed_by         uuid,
  performed_at         timestamptz,
  findings             text,
  evidence             jsonb NOT NULL DEFAULT '{}'::jsonb,
  anomaly_resolution   text,
  anomaly_resolved_at  timestamptz,
  due_notified_at      timestamptz,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, assignment_id) REFERENCES stateassign.assignments (tenant_id, id),
  CHECK (status = 'PENDING' OR (performed_by IS NOT NULL AND performed_at IS NOT NULL)),
  CHECK (status NOT IN ('ANOMALY', 'WAIVED') OR length(btrim(coalesce(findings, ''))) >= 5)
);
SELECT kernel.enable_tenant_rls('stateassign.controls');
CREATE UNIQUE INDEX controls_one_per_period
  ON stateassign.controls (tenant_id, assignment_id, kind, coalesce(academic_period_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX controls_due ON stateassign.controls (tenant_id, due_on) WHERE status = 'PENDING';
CREATE INDEX controls_anomalies ON stateassign.controls (tenant_id, assignment_id) WHERE status = 'ANOMALY';
GRANT SELECT, INSERT, UPDATE ON stateassign.controls TO app_user;

-- Documents du dossier : RÉFÉRENCES vers la GED / le dossier de l'élève (jamais le fichier).
CREATE TABLE stateassign.documents (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  assignment_id uuid NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('ASSIGNMENT_ORDER', 'ATTENDANCE_CERTIFICATE', 'RECEIPT', 'CORRESPONDENCE', 'OTHER')),
  document_ref  uuid NOT NULL,
  label         text,
  received_on   date,
  added_by      uuid NOT NULL,
  status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'WITHDRAWN')),
  withdrawn_by  uuid,
  withdrawn_at  timestamptz,
  withdrawn_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, assignment_id, document_ref),
  FOREIGN KEY (tenant_id, assignment_id) REFERENCES stateassign.assignments (tenant_id, id),
  CHECK (status <> 'WITHDRAWN' OR (withdrawn_by IS NOT NULL AND length(btrim(coalesce(withdrawn_reason, ''))) >= 5))
);
SELECT kernel.enable_tenant_rls('stateassign.documents');
GRANT SELECT, INSERT, UPDATE ON stateassign.documents TO app_user;

-- Historique du dossier (ajout seul) : alimenté par les déclencheurs (2301).
CREATE TABLE stateassign.assignment_events (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  assignment_id uuid NOT NULL,
  action        text NOT NULL CHECK (action IN ('CREATED', 'STATUS_CHANGED', 'RECONCILED', 'LINKED')),
  from_status   text,
  to_status     text,
  actor_id      uuid,
  actor_kind    text CHECK (actor_kind IS NULL OR actor_kind IN ('user', 'system', 'superAdmin')),
  reason        text,
  data          jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, assignment_id) REFERENCES stateassign.assignments (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('stateassign.assignment_events');
CREATE INDEX assignment_events_by_assignment ON stateassign.assignment_events (tenant_id, assignment_id, occurred_at);
GRANT SELECT, INSERT ON stateassign.assignment_events TO app_user;
