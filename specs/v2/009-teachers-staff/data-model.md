# Modèle de données — 009-teachers-staff (schéma Postgres `people`, partie personnel et affectations)

**Statut** : DDL de référence, exécuté et testé sur PostgreSQL 17 (tests communs à `people`, voir 008). Migrations cibles `apps/api/src/modules/people/migrations/0802`, `0803`, `0805`. **Prérequis** : `0800` (schéma, référentiels `staff_categories` et `contract_types`, `persons`, numérotation, `settings`) et `0804` (fonction `people.forbid_mutation`), décrites dans `specs/v2/008-students-guardians/data-model.md`. Les deux specs se partagent un manifeste unique `people` ; l'ordre d'application suit les numéros.

**Sources** : `docs/architecture/module-conventions.md`, ADR-002/006/007, plan §3.6-3.7, PRD §37 et §40, legacy `teachers`, `teacher_assignments`, `professional_session_ecue_teachers`, `teaching_hours` (inventaire dans `parity.md`).

## 1. Conventions

Celles de `specs/v2/004-academic-core/data-model.md` §1 et de 008. Rappels utiles : références vers `academic` (année, classe, nœud de curriculum, période, matière) et `tenancy` par UUID **sans FK** ; l'intégrité est contrôlée par l'API publique d'`academic` à la création ; FK internes composites ; aucune suppression physique ; **aucune rémunération** dans ce schéma (taux, bulletins, configurations = spec 032).

## 2. Vue d'ensemble

```
persons (008) ─1:0..1─ staff ──< staff_status_history
                         │ ├──< staff_affiliations   (établissement / campus, dates)
                         │ ├──< staff_contracts      (type = donnée, dates, volume contractuel)
                         │ ├──< staff_qualifications (expiration → alerte)
                         │ ├──< staff_competencies   (matière academic, niveaux)
                         │ ├──< staff_availabilities (jour ISO, heures, AVAILABLE | UNAVAILABLE)
                         │ └──< teaching_assignments ──< teaching_assignment_history
                         └── category → staff_categories (can_teach, can_supervise)

teaching_assignments : (staff) x (classe academic) x (nœud academic | tous | aucun pour HOMEROOM) x (période academic?) x rôle
```

## 3. Catalogue des tables (partie 009)

| Table | Rôle | Cardinalité indicative (100 personnes) |
|---|---|---|
| `staff_categories` | Catégories (enseignant, éducateur, administratif…) avec droits d'affectation — donnée de pack | ~6 |
| `contract_types` | Types de contrat — donnée de pack | ~5 |
| `staff` | Fiche du personnel (numéro gapless immuable, statut) | 1 par personne |
| `staff_affiliations` | Établissements/campus d'intervention (non chevauchantes par établissement et campus) | 1 à 3 |
| `staff_contracts` | Relation de travail datée ; **ni tarif ni salaire** | 1 à 5 |
| `staff_qualifications` | Diplômes, certifications, habilitations (expiration) | 0 à 6 |
| `staff_competencies` | Matières enseignables | 0 à 10 |
| `staff_availabilities` | Créneaux hebdomadaires | 0 à 30 |
| `staff_status_history` | Historique de statut | ~2 |
| `teaching_assignments` | Affectations d'enseignement | 3 à 12 par enseignant et par an |
| `teaching_assignment_history` | Journal des affectations (append-only) | ~2 par affectation |

## 4. Décisions de modélisation à connaître

1. **Une seule table `staff`** : enseignant = membre du personnel dont la catégorie `can_teach`. Le legacy avait une fiche `teachers` (avec `user_id` nullable, noms dupliqués avec `users`, `contract_type` libre) et rien pour le personnel administratif.
2. **Affectation ≠ rémunération.** `teaching_assignments` dit qui est **responsable** ; l'intervenant **réel** d'une séance (remplaçant compris) est `scheduling.occurrence_staff`, c'est lui que la paie lit. Cela supprime l'incohérence du legacy où l'écran affichait l'enseignant par cascade séance → ECUE → cohorte alors que seule `se.enseignant_id` était payée.
3. **Un `LEAD` actif par (classe, nœud, période)** : index unique partiel, avec `COALESCE` à un UUID nul pour les périodes/nœuds absents. `CO_TEACHER` libre. `HOMEROOM` unique par classe, sans nœud. `covers_all_subjects` pour l'instituteur généraliste (sans nœud ; valable pour les nœuds non transversaux). `SUBSTITUTE` = remplacement de longue durée, qui désigne l'affectation remplacée (`replaces_assignment_id`, contrainte `role = SUBSTITUTE ⇔ lien renseigné`) ; le remplacement d'une séance est un autre objet (scheduling).
4. **Intégrité hors schéma contrôlée à l'écriture.** Le déclencheur impose la catégorie et l'état du personnel ; la cohérence classe/nœud/période (nœud du curriculum de la classe, non transversal, période de l'année) est vérifiée par le cas d'usage via `AcademicQuery` — jamais par SQL inter-schémas.
5. **Disponibilités sans règle cachée** : `UNAVAILABLE` l'emporte ; l'absence de ligne signifie « disponible » ou « indisponible » selon `scheduling.settings.staff_availability_mode` (`OPEN`/`CLOSED`) ; le module `people` ne tranche pas.
6. **Contrats datés et non chevauchants par type** (contrainte d'exclusion sur le triplet personnel/type/plage, états `DRAFT`/`ACTIVE`).

## 5. DDL de référence

### 5.1 Personnel, contrats, qualifications, disponibilités

<!-- migration: 0802_people_staff.sql -->
```sql
-- =============================================================================
-- 0802 — Module people (spec 009) : personnel, contrats, qualifications, disponibilités
-- =============================================================================
--
-- `people.staff.id` est l'identifiant stable consommé par scheduling, attendance, la paie
-- (spec 032) et les évaluations (assess). Le legacy ne connaissait que `teachers` (une fiche
-- sans disponibilité, sans contrat daté, sans personnel administratif) : tout le personnel est
-- désormais une ligne `staff`, l'enseignant étant un membre du personnel dont la catégorie
-- `can_teach`.
-- =============================================================================

CREATE TABLE people.staff (
  id                     uuid PRIMARY KEY,
  tenant_id              uuid NOT NULL REFERENCES kernel.tenants (id),
  person_id              uuid NOT NULL,
  staff_number           text NOT NULL CHECK (length(btrim(staff_number)) > 0),
  category_code          text NOT NULL,
  job_title              text,
  status                 text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'LEFT')),
  hired_on               date,
  left_on                date,
  primary_institution_id uuid,                    -- tenancy.institutions.id (sans FK)
  primary_campus_id      uuid,                    -- tenancy.campuses.id (sans FK)
  attributes             jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  external_ref           text CHECK (external_ref IS NULL OR length(btrim(external_ref)) > 0),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, person_id),
  UNIQUE (tenant_id, staff_number),
  CHECK (left_on IS NULL OR hired_on IS NULL OR left_on >= hired_on),
  CHECK (status <> 'LEFT' OR left_on IS NOT NULL),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people.persons (tenant_id, id),
  FOREIGN KEY (tenant_id, category_code) REFERENCES people.staff_categories (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('people.staff');
CREATE UNIQUE INDEX staff_external_ref_unique ON people.staff (tenant_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX staff_by_status ON people.staff (tenant_id, status, category_code);
GRANT SELECT, INSERT, UPDATE ON people.staff TO app_user;

-- Établissements / campus où le membre du personnel intervient (un enseignant du collège et du
-- lycée du même groupe). Alimente le périmètre RBAC et les listes par établissement.
CREATE TABLE people.staff_affiliations (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  staff_id       uuid NOT NULL,
  institution_id uuid NOT NULL,
  campus_id      uuid,
  valid_from     date NOT NULL DEFAULT current_date,
  valid_to       date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (valid_to IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (tenant_id, staff_id) REFERENCES people.staff (tenant_id, id),
  EXCLUDE USING gist (
    tenant_id WITH =, staff_id WITH =, institution_id WITH =,
    (coalesce(campus_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    daterange(valid_from, valid_to, '[]') WITH &&
  )
);
SELECT kernel.enable_tenant_rls('people.staff_affiliations');
CREATE INDEX staff_affiliations_by_institution ON people.staff_affiliations (tenant_id, institution_id, staff_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON people.staff_affiliations TO app_user;

-- Contrats DATÉS (le legacy n'avait qu'un `contract_type` libre sur la fiche, sans durée). Les
-- tarifs et la rémunération restent dans la paie (spec 031/032) : ici, la relation de travail.
CREATE TABLE people.staff_contracts (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  staff_id            uuid NOT NULL,
  contract_type_code  text NOT NULL,
  starts_on           date NOT NULL,
  ends_on             date,
  committed_hours     numeric(7, 2) CHECK (committed_hours IS NULL OR committed_hours >= 0),
  committed_hours_unit text CHECK (committed_hours_unit IN ('PER_WEEK', 'PER_YEAR')),
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT', 'ACTIVE', 'ENDED', 'CANCELLED')),
  document_ref        uuid,                        -- documents.documents.id (module 024)
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CHECK ((committed_hours IS NULL) = (committed_hours_unit IS NULL)),
  FOREIGN KEY (tenant_id, staff_id) REFERENCES people.staff (tenant_id, id),
  FOREIGN KEY (tenant_id, contract_type_code) REFERENCES people.contract_types (tenant_id, code),
  EXCLUDE USING gist (
    tenant_id WITH =, staff_id WITH =, contract_type_code WITH =,
    daterange(starts_on, ends_on, '[]') WITH &&
  ) WHERE (status IN ('DRAFT', 'ACTIVE'))
);
SELECT kernel.enable_tenant_rls('people.staff_contracts');
CREATE INDEX staff_contracts_by_staff ON people.staff_contracts (tenant_id, staff_id, starts_on DESC);
GRANT SELECT, INSERT, UPDATE ON people.staff_contracts TO app_user;

-- Qualifications, diplômes, habilitations (avec expiration : alerte « document qui expire »).
CREATE TABLE people.staff_qualifications (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants (id),
  staff_id     uuid NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('DIPLOMA', 'CERTIFICATION', 'AUTHORIZATION', 'OTHER')),
  label        text NOT NULL CHECK (length(btrim(label)) > 0),
  issuer       text,
  obtained_on  date,
  expires_on   date,
  -- Date d'expiration pour laquelle l'alerte `people.staff_qualification.expiring` a déjà été publiée : une alerte par
  -- franchissement de seuil (idempotence du job) ; si l'expiration est repoussée, une nouvelle alerte redevient possible.
  expiry_alerted_for date,
  document_ref uuid,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (expires_on IS NULL OR obtained_on IS NULL OR expires_on >= obtained_on),
  FOREIGN KEY (tenant_id, staff_id) REFERENCES people.staff (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('people.staff_qualifications');
CREATE INDEX staff_qualifications_expiry ON people.staff_qualifications (tenant_id, expires_on) WHERE expires_on IS NOT NULL;
CREATE INDEX staff_qualifications_by_staff ON people.staff_qualifications (tenant_id, staff_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON people.staff_qualifications TO app_user;

-- Compétences d'enseignement : « peut enseigner la matière X (niveaux Y) ». Information de
-- planification (avertissement, jamais blocage) pour l'affectation et l'emploi du temps.
CREATE TABLE people.staff_competencies (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  staff_id          uuid NOT NULL,
  subject_id        uuid NOT NULL,                  -- academic.subjects.id (sans FK)
  grade_level_codes text[] NOT NULL DEFAULT '{}',   -- vide = tous niveaux
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, staff_id, subject_id),
  FOREIGN KEY (tenant_id, staff_id) REFERENCES people.staff (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('people.staff_competencies');
GRANT SELECT, INSERT, UPDATE, DELETE ON people.staff_competencies TO app_user;

-- Disponibilités hebdomadaires (le legacy n'en avait que pour les formateurs Imhotep, supprimés).
-- UNAVAILABLE l'emporte sur AVAILABLE ; aucune ligne = disponible (sauf politique contraire du
-- tenant côté scheduling). Jour ISO 1 (lundi) à 7 (dimanche).
CREATE TABLE people.staff_availabilities (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES kernel.tenants (id),
  staff_id    uuid NOT NULL,
  campus_id   uuid,
  weekday     smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  kind        text NOT NULL DEFAULT 'UNAVAILABLE' CHECK (kind IN ('AVAILABLE', 'UNAVAILABLE')),
  valid_from  date,
  valid_to    date,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (end_time > start_time),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (tenant_id, staff_id) REFERENCES people.staff (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('people.staff_availabilities');
CREATE INDEX staff_availabilities_by_staff ON people.staff_availabilities (tenant_id, staff_id, weekday);
GRANT SELECT, INSERT, UPDATE, DELETE ON people.staff_availabilities TO app_user;

CREATE TABLE people.staff_status_history (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants (id),
  staff_id     uuid NOT NULL,
  from_status  text,
  to_status    text NOT NULL,
  reason_text  text,
  effective_on date NOT NULL DEFAULT current_date,
  changed_by   uuid,
  changed_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, staff_id) REFERENCES people.staff (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('people.staff_status_history');
CREATE INDEX staff_status_history_by_staff ON people.staff_status_history (tenant_id, staff_id, changed_at DESC);
GRANT SELECT, INSERT ON people.staff_status_history TO app_user;
```

### 5.2 Affectations d'enseignement

<!-- migration: 0803_people_teaching.sql -->
```sql
-- =============================================================================
-- 0803 — Module people (spec 009) : affectations d'enseignement
-- =============================================================================
--
-- Une affectation dit QUI est responsable de QUOI : (membre du personnel) x (classe) x (nœud de
-- curriculum) x (période éventuelle). Elle unifie `teacher_assignments` (classique),
-- `professional_session_ecue_teachers` (un titulaire par ECUE et par cohorte) et le « titulaire
-- de classe » (instituteur du primaire, professeur principal).
--
-- ATTENTION — l'affectation n'est PAS le bénéficiaire de la paie. La paie lit l'intervenant
-- réel d'une séance (`scheduling.occurrence_staff`, remplaçant compris), jamais le titulaire
-- (leçon du legacy, professional-seance-validation.service.ts:66-88).
--
-- Références (UUID, vérifiées par l'API publique de academic, sans clé étrangère) :
--   academic_year_id -> academic.academic_years.id      classroom_id -> academic.classrooms.id
--   curriculum_node_id -> academic.curriculum_nodes.id  period_id -> academic.academic_periods.id
-- =============================================================================

CREATE TABLE people.teaching_assignments (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  staff_id            uuid NOT NULL,
  academic_year_id    uuid NOT NULL,
  classroom_id        uuid NOT NULL,
  curriculum_node_id  uuid,
  period_id           uuid,
  role_code           text NOT NULL CHECK (role_code IN ('LEAD', 'CO_TEACHER', 'HOMEROOM', 'SUBSTITUTE', 'SUPERVISOR')),
  replaces_assignment_id uuid,                         -- SUBSTITUTE : l'affectation remplacée (congé de longue durée)
  covers_all_subjects boolean NOT NULL DEFAULT false,
  planned_hours       numeric(7, 2) CHECK (planned_hours IS NULL OR planned_hours >= 0),
  starts_on           date NOT NULL,
  ends_on             date,
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ENDED', 'CANCELLED')),
  source              text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'IMPORT', 'TIMETABLE', 'ROLLOVER')),
  note                text,
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (ends_on IS NULL OR ends_on >= starts_on),
  -- Un titulaire de classe couvre la classe (ou tout son programme au primaire) : pas de nœud précis.
  CHECK (role_code <> 'HOMEROOM' OR curriculum_node_id IS NULL),
  -- Les autres rôles visent une matière ou, pour un généraliste, toutes les matières.
  CHECK (role_code = 'HOMEROOM' OR curriculum_node_id IS NOT NULL OR covers_all_subjects),
  CHECK (NOT covers_all_subjects OR curriculum_node_id IS NULL),
  -- Un remplaçant de longue durée désigne l'affectation qu'il remplace (la paie et l'historique
  -- savent qui couvre qui) ; seul un SUBSTITUTE peut porter ce lien.
  CHECK ((role_code = 'SUBSTITUTE') = (replaces_assignment_id IS NOT NULL)),
  CHECK (replaces_assignment_id IS NULL OR replaces_assignment_id <> id),
  FOREIGN KEY (tenant_id, staff_id) REFERENCES people.staff (tenant_id, id),
  FOREIGN KEY (tenant_id, replaces_assignment_id) REFERENCES people.teaching_assignments (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('people.teaching_assignments');

-- Un seul responsable (LEAD) vivant par (classe, nœud, période) : « un enseignant par (cohorte,
-- ECUE) » du legacy, sans la limite du co-enseignement (CO_TEACHER est libre).
CREATE UNIQUE INDEX teaching_assignments_one_lead
  ON people.teaching_assignments (
    tenant_id, classroom_id,
    (coalesce(curriculum_node_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (coalesce(period_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  WHERE role_code = 'LEAD' AND status = 'ACTIVE';
-- Un seul titulaire de classe vivant par classe.
CREATE UNIQUE INDEX teaching_assignments_one_homeroom
  ON people.teaching_assignments (tenant_id, classroom_id) WHERE role_code = 'HOMEROOM' AND status = 'ACTIVE';
-- Pas de doublon strict d'une même personne sur le même objet et le même rôle.
CREATE UNIQUE INDEX teaching_assignments_no_dup
  ON people.teaching_assignments (
    tenant_id, staff_id, classroom_id, role_code,
    (coalesce(curriculum_node_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (coalesce(period_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  WHERE status = 'ACTIVE';
CREATE INDEX teaching_assignments_by_staff ON people.teaching_assignments (tenant_id, staff_id, academic_year_id, status);
CREATE INDEX teaching_assignments_by_classroom ON people.teaching_assignments (tenant_id, classroom_id, status);
CREATE INDEX teaching_assignments_by_node ON people.teaching_assignments (tenant_id, curriculum_node_id) WHERE curriculum_node_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE ON people.teaching_assignments TO app_user;

-- Journal des changements d'affectation (qui a affecté / retiré / remplacé qui). Append-only.
CREATE TABLE people.teaching_assignment_history (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  assignment_id  uuid NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('CREATED', 'UPDATED', 'ENDED', 'CANCELLED', 'REPLACED')),
  from_value     jsonb,
  to_value       jsonb,
  reason         text,
  actor_id       uuid,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, assignment_id) REFERENCES people.teaching_assignments (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('people.teaching_assignment_history');
CREATE INDEX teaching_assignment_history_by_assignment ON people.teaching_assignment_history (tenant_id, assignment_id, occurred_at);
GRANT SELECT, INSERT ON people.teaching_assignment_history TO app_user;
```

### 5.3 Invariants imposés par la base

<!-- migration: 0805_people_staff_guards.sql -->
```sql
-- =============================================================================
-- 0805 — Module people (spec 009) : invariants du personnel et des affectations
-- =============================================================================
-- Prérequis : 0804 (fonction people.forbid_mutation, spec 008).

CREATE TRIGGER staff_status_history_immutable BEFORE UPDATE OR DELETE ON people.staff_status_history
  FOR EACH ROW EXECUTE FUNCTION people.forbid_mutation();
CREATE TRIGGER teaching_assignment_history_immutable BEFORE UPDATE OR DELETE ON people.teaching_assignment_history
  FOR EACH ROW EXECUTE FUNCTION people.forbid_mutation();

-- Jamais de suppression physique (le legacy `DELETE /teachers/:id` effaçait en cascade
-- évaluations, affectations, bulletins, configurations et tarifs).
CREATE TRIGGER staff_no_delete BEFORE DELETE ON people.staff
  FOR EACH ROW EXECUTE FUNCTION people.forbid_mutation();
CREATE TRIGGER staff_contracts_no_delete BEFORE DELETE ON people.staff_contracts
  FOR EACH ROW EXECUTE FUNCTION people.forbid_mutation();
CREATE TRIGGER teaching_assignments_no_delete BEFORE DELETE ON people.teaching_assignments
  FOR EACH ROW EXECUTE FUNCTION people.forbid_mutation();

-- Personnel : numéro immuable ; ACTIVE <-> ON_LEAVE <-> SUSPENDED ; * -> LEFT (réembauche : LEFT -> ACTIVE).
CREATE FUNCTION people.staff_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_cat people.staff_categories%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.staff_number <> OLD.staff_number OR NEW.person_id <> OLD.person_id THEN
      RAISE EXCEPTION 'people.staff_identity_immutable' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
         (OLD.status IN ('ACTIVE', 'ON_LEAVE', 'SUSPENDED') AND NEW.status IN ('ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'LEFT')) OR
         (OLD.status = 'LEFT' AND NEW.status = 'ACTIVE')) THEN
      RAISE EXCEPTION 'people.staff_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  SELECT * INTO v_cat FROM people.staff_categories WHERE tenant_id = NEW.tenant_id AND code = NEW.category_code;
  IF NOT v_cat.active AND (TG_OP = 'INSERT' OR NEW.category_code <> OLD.category_code) THEN
    RAISE EXCEPTION 'people.staff_category_inactive: la catégorie % est désactivée', NEW.category_code USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER staff_guard BEFORE INSERT OR UPDATE ON people.staff
  FOR EACH ROW EXECUTE FUNCTION people.staff_guard();

-- Affectation : seul un membre du personnel ACTIF (ou en congé) dont la catégorie peut enseigner
-- (ou superviser, pour SUPERVISOR) reçoit une affectation ; les clés d'objet sont figées.
CREATE FUNCTION people.teaching_assignments_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_staff people.staff%ROWTYPE;
  v_cat   people.staff_categories%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.staff_id <> OLD.staff_id OR NEW.academic_year_id <> OLD.academic_year_id OR NEW.classroom_id <> OLD.classroom_id
       OR NEW.curriculum_node_id IS DISTINCT FROM OLD.curriculum_node_id OR NEW.role_code <> OLD.role_code THEN
      RAISE EXCEPTION 'people.assignment_identity_immutable: pour changer d''enseignant, terminer et recréer (REPLACED)'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status <> 'ACTIVE' AND NEW.status = 'ACTIVE' THEN
      RAISE EXCEPTION 'people.assignment_transition: une affectation terminée ne se réactive pas' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO v_staff FROM people.staff WHERE tenant_id = NEW.tenant_id AND id = NEW.staff_id;
  SELECT * INTO v_cat FROM people.staff_categories WHERE tenant_id = NEW.tenant_id AND code = v_staff.category_code;
  IF v_staff.status NOT IN ('ACTIVE', 'ON_LEAVE') THEN
    RAISE EXCEPTION 'people.assignment_staff_not_active: le personnel est %', v_staff.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.role_code = 'SUPERVISOR' THEN
    IF NOT (v_cat.can_supervise OR v_cat.can_teach) THEN
      RAISE EXCEPTION 'people.assignment_category_forbidden: la catégorie % ne peut pas superviser', v_cat.code USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NOT v_cat.can_teach THEN
    RAISE EXCEPTION 'people.assignment_category_forbidden: la catégorie % ne peut pas enseigner', v_cat.code USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER teaching_assignments_guard BEFORE INSERT OR UPDATE ON people.teaching_assignments
  FOR EACH ROW EXECUTE FUNCTION people.teaching_assignments_guard();

-- -----------------------------------------------------------------------------
-- Qualifications qui expirent bientôt (fournie aux alertes de la spec 025 et au job
-- d'événements `people.staff_qualification.expiring`).
-- -----------------------------------------------------------------------------
CREATE FUNCTION people.expiring_qualifications(p_as_of date, p_within_days integer)
RETURNS TABLE (qualification_id uuid, staff_id uuid, label text, expires_on date, days_left integer)
LANGUAGE sql STABLE AS $$
  SELECT q.id, q.staff_id, q.label, q.expires_on, (q.expires_on - p_as_of)::integer
    FROM people.staff_qualifications q
    JOIN people.staff s ON s.tenant_id = q.tenant_id AND s.id = q.staff_id
   WHERE q.tenant_id = kernel.current_tenant_id()
     AND s.status IN ('ACTIVE', 'ON_LEAVE')
     AND q.expires_on IS NOT NULL
     AND q.expires_on BETWEEN p_as_of AND p_as_of + p_within_days
$$;
GRANT EXECUTE ON FUNCTION people.expiring_qualifications(date, integer) TO app_user;
```

## 6. Invariants : qui les garantit

| Invariant | Base (DDL) | Domaine / cas d'usage |
|---|---|---|
| Numéro de personnel immuable, gapless | `staff_guard`, `next_number('STAFF')` | `createStaff` |
| Seul le personnel actif d'une catégorie `can_teach` reçoit une affectation | `teaching_assignments_guard` | `createTeachingAssignment` renvoie `people.assignment_category_forbidden` |
| Un `LEAD` actif par (classe, nœud, période) ; un `HOMEROOM` par classe ; pas de doublon strict | index uniques partiels | message « déjà affecté à X » avec suggestion `CO_TEACHER` |
| Identité d'une affectation figée ; une affectation terminée ne se réactive pas | `teaching_assignments_guard` | `replaceTeachingAssignment` = terminer + créer dans une transaction |
| Nœud transversal jamais affecté | — (hors schéma) | `createTeachingAssignment` via `AcademicQuery.getCurriculumNode().isTransversal` |
| Nœud ∈ curriculum de la classe, période ∈ année | — (hors schéma) | idem |
| Contrats du même type sans chevauchement | `EXCLUDE` sur `daterange` | `addContract` |
| Affiliations sans chevauchement par établissement et campus | `EXCLUDE` | `setAffiliations` |
| Historiques append-only ; pas de suppression | `forbid_mutation` | cas d'usage |
| Qualifications qui expirent | fonction `expiring_qualifications` | job `emitExpiringQualifications` (une alerte par franchissement) |

## 7. Données de référence : modèle de pack

Voir la section `people` de 008 (`staffCategories`, `contractTypes`, `settings.staffNumberPattern`, `settings.expiryAlertDays`). Les catégories portent `canTeach` / `canSupervise` ; un tenant peut ajouter une catégorie (ex. « Intervenant extérieur » avec `canTeach: true`) mais ne peut pas retirer `canTeach` d'une catégorie qui a des affectations actives.

## 8. Chemins d'accès et index

| Besoin | Requête | Index |
|---|---|---|
| Responsable d'un nœud dans une classe | `WHERE classroom_id = $1 AND (curriculum_node_id = $2 OR covers_all_subjects OR role_code = 'HOMEROOM') AND status = 'ACTIVE'` | `teaching_assignments_by_classroom`, `teaching_assignments_one_lead` |
| Classes d'un enseignant (portail) | `WHERE staff_id = $1 AND academic_year_id = $2 AND status = 'ACTIVE'` | `teaching_assignments_by_staff` |
| Charge d'un enseignant | `sum(planned_hours)` sur ses affectations actives | idem |
| Affectations d'un nœud (garde d'offre) | `WHERE curriculum_node_id = ANY($1) AND status = 'ACTIVE'` | `teaching_assignments_by_node` |
| Qualifications qui expirent | `expires_on BETWEEN $1 AND $1 + $2` | `staff_qualifications_expiry` |
| Disponibilités pour la planification | `WHERE staff_id = ANY($1) AND weekday = $2` | `staff_availabilities_by_staff` |
| Contrat en vigueur | `WHERE staff_id = $1 AND status = 'ACTIVE' AND daterange(starts_on, ends_on) @> $2` | `staff_contracts_by_staff` |

## 9. Interfaces de lecture pour la paie, la planification et les évaluations

- **Paie (032)** : `getStaffByIds`, `listContracts`, catégories et types de contrat ; le tarif et la configuration de paie sont dans le module paie, indexés par `staff_id`. Les heures viennent de `scheduling.listPayableHours`, pas de `teaching_assignments.planned_hours`.
- **Planification (017)** : `listAvailabilities`, `listCompetencies`, `listAssignmentsForClassroom`, `isStaffAssignedToClassroom`.
- **Évaluations / présences (011, 010)** : `listAssignmentsForStaff`, `isStaffAssignedToClassroom` pour limiter la saisie de notes et l'appel aux enseignants affectés (règle de domaine de ce module).

## 10. Reprise de l'existant

Aucune donnée n'est reprise (D8). Les tables `teachers`, `teacher_assignments`, `teacher_assignments_audit`, `professional_session_ecue_teachers`, `course_assignments`, `teaching_hours` sont supprimées dans la tranche 2.2 ; les collecteurs d'heures (`hour-collectors/{academic,professional}`) sont réécrits en tranche 2.7 sur `scheduling.listPayableHours`.
