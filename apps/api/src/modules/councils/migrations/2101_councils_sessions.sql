-- =============================================================================
-- 2101 — Module councils : séances de conseil, participants, ordre du jour, propositions,
--        décisions, effets
-- =============================================================================
--
-- Un conseil = une séance pour une classe et une période (ou un bilan de fin d'année).
--   PLANNED  -> OPEN -> CLOSED -> SIGNED ; CANCELLED depuis PLANNED/OPEN.
--   CLOSED et SIGNED sont les états VERROUILLÉS ; le déverrouillage (CLOSED|SIGNED -> OPEN) exige une
--   demande approuvée (`unlock_requests`, migration 2102) et est imposé par la base (2104).
-- Les résultats, absences, discipline et appréciations sont LUS dans `results`, `attendance`,
-- `schoollife` : l'ordre du jour en garde un instantané figé (`agenda_items.facts`) avec son hash.
-- Les propositions des règles sont des SUGGESTIONS (`origin = 'RULE_SUGGESTION'`) ; seule une
-- décision enregistrée par un humain (`decisions`) a une valeur.
-- =============================================================================

CREATE TABLE councils.councils (
  id                       uuid PRIMARY KEY,
  tenant_id                uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id           uuid NOT NULL,                 -- tenancy.institutions.id (sans FK)
  academic_year_id         uuid NOT NULL,                 -- academic.academic_years.id
  classroom_id             uuid NOT NULL,                 -- academic.classrooms.id
  academic_period_id       uuid,                          -- academic.academic_periods.id ; NULL = bilan d'année
  council_type_id          uuid NOT NULL,
  scope                    text NOT NULL CHECK (scope IN ('PERIOD', 'YEAR')),
  results_state_id         uuid,                          -- results.period_states.id (état de la classe)
  results_deliberation_id  uuid,                          -- results.deliberations.id
  status                   text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'OPEN', 'CLOSED', 'SIGNED', 'CANCELLED')),
  title                    text CHECK (title IS NULL OR length(btrim(title)) > 0),
  scheduled_at             timestamptz,
  location                 text,
  held_on                  date,
  opened_at                timestamptz,
  opened_by                uuid,
  closed_at                timestamptz,
  closed_by                uuid,
  signed_at                timestamptz,
  quorum_waived            boolean NOT NULL DEFAULT false,
  quorum_waiver_reason     text,
  reopen_count             integer NOT NULL DEFAULT 0 CHECK (reopen_count >= 0),
  cancel_reason            text,
  row_version              integer NOT NULL DEFAULT 1,
  created_by               uuid NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, council_type_id) REFERENCES councils.council_types (tenant_id, id),
  CHECK ((scope = 'PERIOD') = (academic_period_id IS NOT NULL)),
  CHECK (status NOT IN ('OPEN', 'CLOSED', 'SIGNED') OR held_on IS NOT NULL),
  CHECK (NOT quorum_waived OR length(btrim(coalesce(quorum_waiver_reason, ''))) >= 10),
  CHECK (status <> 'CANCELLED' OR length(btrim(coalesce(cancel_reason, ''))) >= 5)
);
SELECT kernel.enable_tenant_rls('councils.councils');
-- Un seul conseil vivant par (classe, type, période).
CREATE UNIQUE INDEX councils_one_live
  ON councils.councils (tenant_id, classroom_id, council_type_id, coalesce(academic_period_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status <> 'CANCELLED';
CREATE INDEX councils_by_classroom ON councils.councils (tenant_id, classroom_id, status);
CREATE INDEX councils_by_year ON councils.councils (tenant_id, academic_year_id, institution_id, status);
CREATE INDEX councils_by_schedule ON councils.councils (tenant_id, scheduled_at) WHERE status IN ('PLANNED', 'OPEN');
GRANT SELECT, INSERT, UPDATE ON councils.councils TO app_user;

-- Participants : membres du personnel ou personnes externes (délégués), avec présence.
--   council_function : PRESIDENT / SECRETARY (au plus un de chaque par séance).
--   display_name : nom FIGÉ à la convocation (il figure au procès-verbal même si la fiche change).
CREATE TABLE councils.participants (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  council_id       uuid NOT NULL,
  role_code        text NOT NULL,
  council_function text CHECK (council_function IS NULL OR council_function IN ('PRESIDENT', 'SECRETARY')),
  staff_id         uuid,                                  -- people.staff.id
  person_id        uuid,                                  -- people.persons.id (délégués externes)
  display_name     text NOT NULL CHECK (length(btrim(display_name)) > 0),
  is_voting        boolean NOT NULL DEFAULT true,
  presence         text NOT NULL DEFAULT 'INVITED' CHECK (presence IN ('INVITED', 'PRESENT', 'ABSENT', 'EXCUSED')),
  convoked_at      timestamptz,
  notified_at      timestamptz,
  notification_ref uuid,                                  -- messaging : notification envoyée
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (staff_id IS NOT NULL OR person_id IS NOT NULL),
  FOREIGN KEY (tenant_id, council_id) REFERENCES councils.councils (tenant_id, id),
  FOREIGN KEY (tenant_id, role_code) REFERENCES councils.participant_roles (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('councils.participants');
CREATE UNIQUE INDEX participants_one_per_role
  ON councils.participants (tenant_id, council_id, role_code, coalesce(staff_id, person_id));
CREATE UNIQUE INDEX participants_one_president ON councils.participants (tenant_id, council_id) WHERE council_function = 'PRESIDENT';
CREATE UNIQUE INDEX participants_one_secretary ON councils.participants (tenant_id, council_id) WHERE council_function = 'SECRETARY';
CREATE INDEX participants_by_staff ON councils.participants (tenant_id, staff_id) WHERE staff_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON councils.participants TO app_user;   -- DELETE : convocation (PLANNED) seulement (déclencheur)

-- Ordre du jour : un élève de la classe, avec l'INSTANTANÉ des faits utilisés par le conseil.
--   facts : { results:{…}, attendance:{…}, discipline:{…}, appreciations:{…}, conduct:{…}, funding:{…} } ;
--           UNIQUEMENT chaînes, entiers, booléens, null (aucun flottant) ; figé à la clôture.
--   facts_hash / facts_version : posés par la base ; reconstruire l'instantané incrémente la version.
CREATE TABLE councils.agenda_items (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES kernel.tenants (id),
  council_id           uuid NOT NULL,
  enrollment_id        uuid NOT NULL,                     -- academic.enrollments.id
  student_id           uuid NOT NULL,                     -- people.students.id
  student_display_name text NOT NULL CHECK (length(btrim(student_display_name)) > 0),
  position             integer NOT NULL DEFAULT 0,
  status               text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'REVIEWED', 'DECIDED')),
  facts                jsonb NOT NULL DEFAULT '{}'::jsonb,
  facts_hash           text,
  facts_version        integer NOT NULL DEFAULT 0,
  period_result_id     uuid,                              -- results.period_results.id lu
  results_version      integer,
  rule_version_ref     text,                              -- ex. « CI-SECONDARY-PLACEHOLDER@1 »
  prepared_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, council_id, enrollment_id),
  FOREIGN KEY (tenant_id, council_id) REFERENCES councils.councils (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('councils.agenda_items');
CREATE INDEX agenda_items_by_student ON councils.agenda_items (tenant_id, student_id);
CREATE INDEX agenda_items_by_council ON councils.agenda_items (tenant_id, council_id, position);
GRANT SELECT, INSERT, UPDATE, DELETE ON councils.agenda_items TO app_user;   -- DELETE : avant l'ouverture seulement (déclencheur)

-- Propositions : suggestions des règles (RULE_SUGGESTION) et propositions humaines.
--   Une suggestion de règle n'a pas de valeur par elle-même : elle n'est jamais ACCEPTED sans un humain
--   (`resolved_by`), et une proposition humaine porte son auteur.
CREATE TABLE councils.proposals (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  council_id       uuid NOT NULL,
  agenda_item_id   uuid NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('APPRECIATION', 'DISTINCTION', 'DECISION', 'REMARK')),
  code             text CHECK (code IS NULL OR code ~ '^[A-Z][A-Z0-9_]{0,40}$'),
  body             text CHECK (body IS NULL OR length(btrim(body)) BETWEEN 1 AND 1000),
  origin           text NOT NULL CHECK (origin IN ('RULE_SUGGESTION', 'HUMAN')),
  proposed_by      uuid,
  proposed_by_name text,
  status           text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'ACCEPTED', 'MODIFIED', 'REJECTED', 'WITHDRAWN')),
  resolved_by      uuid,
  resolved_at      timestamptz,
  resolution_note  text,
  rule_version_ref text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, council_id) REFERENCES councils.councils (tenant_id, id),
  FOREIGN KEY (tenant_id, agenda_item_id) REFERENCES councils.agenda_items (tenant_id, id),
  CHECK ((origin = 'HUMAN') = (proposed_by IS NOT NULL)),
  CHECK (status = 'PROPOSED' OR (resolved_by IS NOT NULL AND resolved_at IS NOT NULL)),
  CHECK (kind NOT IN ('APPRECIATION', 'REMARK') OR body IS NOT NULL),
  CHECK (kind NOT IN ('DISTINCTION', 'DECISION') OR code IS NOT NULL)
);
SELECT kernel.enable_tenant_rls('councils.proposals');
CREATE INDEX proposals_by_item ON councils.proposals (tenant_id, agenda_item_id, kind, status);
GRANT SELECT, INSERT, UPDATE ON councils.proposals TO app_user;

-- Décisions du conseil : l'acte humain. Le DÉCIDEUR est un participant PRÉSENT habilité
-- (`can_decide`) ; la personne qui SAISIT (`recorded_by`) est l'utilisateur de la session.
--   suggested_code            ce que les règles suggéraient (NULL si aucune suggestion) ;
--   differs_from_suggestion   la décision s'écarte de la suggestion -> justification >= 20 caractères ;
--   decision_type_code, family, exclusive_group : recopiés du type par la base (non falsifiables).
CREATE TABLE councils.decisions (
  id                     uuid PRIMARY KEY,
  tenant_id              uuid NOT NULL REFERENCES kernel.tenants (id),
  council_id             uuid NOT NULL,
  agenda_item_id         uuid NOT NULL,
  enrollment_id          uuid NOT NULL,
  student_id             uuid NOT NULL,
  decision_type_id       uuid NOT NULL,
  decision_type_code     text NOT NULL,
  family                 text NOT NULL,
  exclusive_group        text,
  suggested_code         text,
  suggestion_ref         text,
  differs_from_suggestion boolean NOT NULL DEFAULT false,
  justification          text,
  decision_mode          text NOT NULL CHECK (decision_mode IN ('CONSENSUS', 'VOTE', 'PRESIDENT_CASTING_VOTE')),
  votes_for              integer CHECK (votes_for IS NULL OR votes_for >= 0),
  votes_against          integer CHECK (votes_against IS NULL OR votes_against >= 0),
  votes_abstain          integer CHECK (votes_abstain IS NULL OR votes_abstain >= 0),
  target_program_id      uuid,                            -- academic.programs.id (série visée)
  target_grade_level_id  uuid,                            -- academic.grade_levels.id
  target_label           text,
  decider_participant_id uuid NOT NULL,
  recorded_by            uuid NOT NULL,
  recorded_by_name       text NOT NULL CHECK (length(btrim(recorded_by_name)) > 0),
  facts_version          integer NOT NULL DEFAULT 0,       -- version de l'instantané sur lequel la décision est prise
  facts_hash             text,
  decided_at             timestamptz NOT NULL DEFAULT now(),
  status                 text NOT NULL DEFAULT 'RECORDED' CHECK (status IN ('RECORDED', 'WITHDRAWN', 'SUPERSEDED')),
  withdrawn_reason       text,
  supersedes_id          uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, council_id) REFERENCES councils.councils (tenant_id, id),
  FOREIGN KEY (tenant_id, agenda_item_id) REFERENCES councils.agenda_items (tenant_id, id),
  FOREIGN KEY (tenant_id, decision_type_id) REFERENCES councils.decision_types (tenant_id, id),
  FOREIGN KEY (tenant_id, decider_participant_id) REFERENCES councils.participants (tenant_id, id),
  FOREIGN KEY (tenant_id, supersedes_id) REFERENCES councils.decisions (tenant_id, id),
  CHECK (decision_mode <> 'VOTE' OR (votes_for IS NOT NULL AND votes_against IS NOT NULL AND votes_abstain IS NOT NULL)),
  CHECK (NOT differs_from_suggestion OR length(btrim(coalesce(justification, ''))) >= 20),
  CHECK (status <> 'WITHDRAWN' OR length(btrim(coalesce(withdrawn_reason, ''))) >= 5),
  CHECK ((target_program_id IS NULL AND target_grade_level_id IS NULL) OR target_grade_level_id IS NOT NULL)
);
SELECT kernel.enable_tenant_rls('councils.decisions');
-- Deux décisions d'un même groupe exclusif ne coexistent pas pour un élève et un conseil.
CREATE UNIQUE INDEX decisions_one_per_group
  ON councils.decisions (tenant_id, agenda_item_id, exclusive_group)
  WHERE status = 'RECORDED' AND exclusive_group IS NOT NULL;
CREATE INDEX decisions_by_student ON councils.decisions (tenant_id, student_id, decided_at);
CREATE INDEX decisions_by_council ON councils.decisions (tenant_id, council_id, status);
GRANT SELECT, INSERT, UPDATE ON councils.decisions TO app_user;

-- Effets d'une décision ou d'une proposition ACCEPTÉE (appréciation générale, distinction) : propagation vers
-- results, academic, orientation, people… File idempotente, un effet vivant par (décision ou proposition, nature).
-- 'AWAITING_HUMAN' : l'effet attend l'acte d'un humain habilité (exclusion : changement de statut de l'élève).
CREATE TABLE councils.effects (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  council_id    uuid NOT NULL,
  decision_id   uuid,
  proposal_id   uuid,
  effect_kind   text NOT NULL CHECK (effect_kind IN ('RESULTS_DECISION', 'ENROLLMENT_OUTCOME', 'ORIENTATION_FILE', 'SERIES_TRANSFER', 'STUDENT_STATUS_REQUEST', 'NOTIFY_GUARDIANS',
                                                      'RESULTS_APPRECIATION', 'RESULTS_DISTINCTION')),
  status        text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'AWAITING_HUMAN', 'APPLIED', 'FAILED', 'REVERTED', 'SKIPPED')),
  attempts      integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error    text,
  external_ref  uuid,                                     -- id créé/visé dans le module cible
  irreversible  boolean NOT NULL DEFAULT false,
  applied_at    timestamptz,
  applied_by    uuid,
  reverted_at   timestamptz,
  revert_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, council_id) REFERENCES councils.councils (tenant_id, id),
  FOREIGN KEY (tenant_id, decision_id) REFERENCES councils.decisions (tenant_id, id),
  FOREIGN KEY (tenant_id, proposal_id) REFERENCES councils.proposals (tenant_id, id),
  CHECK ((decision_id IS NULL) <> (proposal_id IS NULL)),
  CHECK ((effect_kind IN ('RESULTS_APPRECIATION', 'RESULTS_DISTINCTION')) = (proposal_id IS NOT NULL)),
  CHECK (status <> 'APPLIED' OR applied_at IS NOT NULL),
  CHECK (status <> 'REVERTED' OR (reverted_at IS NOT NULL AND length(btrim(coalesce(revert_reason, ''))) >= 5))
);
SELECT kernel.enable_tenant_rls('councils.effects');
CREATE UNIQUE INDEX effects_one_live ON councils.effects (tenant_id, coalesce(decision_id, proposal_id), effect_kind) WHERE status NOT IN ('REVERTED', 'SKIPPED');
CREATE INDEX effects_pending ON councils.effects (tenant_id, status) WHERE status IN ('PENDING', 'FAILED', 'AWAITING_HUMAN');
GRANT SELECT, INSERT, UPDATE ON councils.effects TO app_user;
