-- =============================================================================
-- 2302 — Module stateassign : créances sur l'État (échéances) et formats d'export
-- =============================================================================
--
-- Ce que la spec 006 (§5.4 R-A6) pose : « les créances, reçus, paiements de l'État sont ceux de `finance` ;
-- `stateassign` n'écrit aucun montant facturé ». Ici, donc, pas de grand livre : le CALENDRIER ATTENDU des versements
-- de l'État (échéances annoncées par l'acte d'affectation ou convenues avec l'administration) et leur SUIVI :
--
--   - `receivables.expected_amount`  ce que l'État doit verser à l'échéance (entier, unités mineures) ;
--   - `receivables.received_amount`  ce qui a été REÇU (rapprochement des paiements `finance` sur la facture de l'État,
--                                    imputés dans l'ordre des échéances) : écrit par le rapprochement, jamais saisi ;
--   - le STATUT (OPEN / PARTIALLY_RECEIVED / RECEIVED) est CALCULÉ par la base depuis les deux montants ;
--     l'annulation (CANCELLED) est un acte humain motivé, refusé dès qu'un versement est rapproché ;
--   - le RETARD est dérivé (échéance + jours de grâce de l'établissement < date du jour) ; `overdue_flagged_at` mémorise
--     que l'alerte `stateassign.receivable.overdue` a été publiée (une seule fois par échéance) ;
--   - la somme des échéances non annulées d'une inscription ne dépasse pas le montant État DÉCLARÉ du dossier (2303).
--
-- Les créances suivent l'INSCRIPTION (et non une version du dossier) : un avenant ne perd ni n'invente aucun versement.
-- =============================================================================

CREATE TABLE stateassign.receivables (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  assignment_id      uuid NOT NULL,                      -- version du dossier sous laquelle l'échéance a été planifiée
  institution_id     uuid NOT NULL,
  academic_year_id   uuid NOT NULL,
  enrollment_id      uuid NOT NULL,
  student_id         uuid NOT NULL,
  seq                integer NOT NULL CHECK (seq >= 1),
  label              text NOT NULL CHECK (length(btrim(label)) > 0),
  due_on             date NOT NULL,
  expected_amount    bigint NOT NULL CHECK (expected_amount > 0),
  received_amount    bigint NOT NULL DEFAULT 0 CHECK (received_amount >= 0),
  currency           text NOT NULL DEFAULT 'XOF' CHECK (currency ~ '^[A-Z]{3}$'),
  status             text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED')),
  last_reconciled_at timestamptz,
  overdue_flagged_at timestamptz,
  cancel_reason      text,
  cancelled_by       uuid,
  cancelled_at       timestamptz,
  created_by         uuid NOT NULL,
  row_version        integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, enrollment_id, seq),
  FOREIGN KEY (tenant_id, assignment_id) REFERENCES stateassign.assignments (tenant_id, id),
  CHECK (received_amount <= expected_amount),
  CHECK (status <> 'CANCELLED' OR (cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL
         AND length(btrim(coalesce(cancel_reason, ''))) >= 5 AND received_amount = 0))
);
SELECT kernel.enable_tenant_rls('stateassign.receivables');
CREATE INDEX receivables_by_assignment ON stateassign.receivables (tenant_id, assignment_id);
CREATE INDEX receivables_by_student ON stateassign.receivables (tenant_id, student_id, academic_year_id);
CREATE INDEX receivables_by_year ON stateassign.receivables (tenant_id, academic_year_id, institution_id, due_on);
CREATE INDEX receivables_open ON stateassign.receivables (tenant_id, due_on) WHERE status IN ('OPEN', 'PARTIALLY_RECEIVED');
-- Aucun DELETE : une échéance se ANNULE (motif) et son historique reste.
GRANT SELECT, INSERT, UPDATE ON stateassign.receivables TO app_user;

-- Historique des créances (ajout seul) : alimenté par les déclencheurs (2303).
CREATE TABLE stateassign.receivable_events (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  receivable_id uuid NOT NULL,
  action        text NOT NULL CHECK (action IN ('CREATED', 'RESCHEDULED', 'AMOUNT_CHANGED', 'RECEIVED_UPDATED', 'STATUS_CHANGED', 'OVERDUE_FLAGGED', 'CANCELLED')),
  from_status   text,
  to_status     text,
  from_amount   bigint,
  to_amount     bigint,
  actor_id      uuid,
  actor_kind    text CHECK (actor_kind IS NULL OR actor_kind IN ('user', 'system', 'superAdmin')),
  reason        text,
  data          jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, receivable_id) REFERENCES stateassign.receivables (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('stateassign.receivable_events');
CREATE INDEX receivable_events_by_receivable ON stateassign.receivable_events (tenant_id, receivable_id, occurred_at);
GRANT SELECT, INSERT ON stateassign.receivable_events TO app_user;

-- Formats d'export pour l'administration : DONNÉES par établissement (aucun format officiel n'est codé).
--   columns : [{ "key": "<colonne du catalogue du jeu>", "header": "<en-tête>" }, …] ; les clés sont validées par
--   l'application contre le catalogue du jeu (ASSIGNMENTS, RECEIVABLES, CONTROLS). Vide par défaut : aucune ligne livrée.
CREATE TABLE stateassign.export_formats (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id uuid NOT NULL,
  code           text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_-]{1,39}$'),
  label          text NOT NULL CHECK (length(btrim(label)) > 0),
  dataset        text NOT NULL CHECK (dataset IN ('ASSIGNMENTS', 'RECEIVABLES', 'CONTROLS')),
  columns        jsonb NOT NULL CHECK (jsonb_typeof(columns) = 'array' AND jsonb_array_length(columns) BETWEEN 1 AND 40),
  delimiter      text NOT NULL DEFAULT ';' CHECK (delimiter IN (';', ',', E'\t')),
  include_bom    boolean NOT NULL DEFAULT true,
  active         boolean NOT NULL DEFAULT true,
  created_by     uuid,
  updated_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, institution_id, code)
);
SELECT kernel.enable_tenant_rls('stateassign.export_formats');
GRANT SELECT, INSERT, UPDATE ON stateassign.export_formats TO app_user;
