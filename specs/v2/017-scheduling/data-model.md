# Modèle de données — 017-scheduling (schéma Postgres `scheduling`)

**Statut** : DDL de référence, exécuté et testé sur PostgreSQL 17 (22 tests de comportement : conflits enseignant/classe/offre à la carte/salle/équipement imposés par la base, politique WARN, bout à bout accepté, verrous de paie, journal, heures payables, RLS). Migrations cibles `apps/api/src/modules/scheduling/migrations/1000…1003` (plage 1000-1099 à inscrire dans `module-conventions.md`).

**Sources** : `docs/architecture/module-conventions.md`, ADR-002/004/006/007, PRD §35 et §37, plan §3.7 et §4 (tranches 2.3 et 2.7), `docs/workflow-paie-enseignants.md`, inventaire legacy (`parity.md`).

## 1. Conventions appliquées

Celles de `specs/v2/004-academic-core/data-model.md` §1. Particularités :

| Règle | Application |
|---|---|
| Références hors schéma sans FK | `institution_id`, `campus_id` → `tenancy` ; `academic_year_id`, `classroom_id`, `curriculum_node_id`, `offering_id` → `academic` ; `staff_id` → `people`. Vérifiées par les API publiques à l'écriture. |
| Salle ≠ classe | `scheduling.rooms` = lieu physique ; `academic.classrooms` = groupe d'apprenants. Le legacy appelait `classrooms` la salle et stockait la salle des séances en texte libre (`'TBD'`). |
| Temps | `starts_at`/`ends_at` en `timestamptz` UTC ; `occurs_on` (date civile) dans le fuseau de l'établissement (`settings.timezone`, copié du `CountryProfile`) ; plages `[début, fin)` (deux séances bout à bout ne se chevauchent pas, critère conservé du legacy). Plus de `Europe/Paris` en dur. |
| Conflits | **Imposés par la base** : `resource_claims` (dérivée, maintenue par déclencheurs `SECURITY DEFINER`, l'application n'a que `SELECT`) porte une contrainte d'exclusion `DEFERRABLE INITIALLY DEFERRED`. Politique par ressource (`conflict_policies`) : `BLOCK` (exclusive) ou `WARN` (réservation non exclusive). |
| Pas de suppression | Aucune occurrence ne se supprime : on annule (`CANCELLED`) ; les journaux sont append-only. |
| Heures payables | Fonction SQL `payable_hours` + verrous `locked_at`/`lock_ref` posés par la paie ; **aucun montant, aucun taux** dans ce schéma. |
| Seuils | Aucun, hormis des garde-fous techniques documentés (`max_generation_weeks`, `paid_minutes ≤ 1 journée`). Amplitude d'ouverture des salles = donnée (`settings.opening_*`). |

## 2. Vue d'ensemble

```
rooms ─< (réservées par) ─┐          equipment_items (stock)
time_slots (grille, facultative)      │
calendar_events (plages, bloquent ou non l'enseignement)
                                      │
timetables (DRAFT → PUBLISHED → ARCHIVED) ─< timetable_entries (patron récurrent)
        │                                     ├─< timetable_entry_staff
        └─< generation_runs                   └─< timetable_entry_equipment
                          │ generateOccurrences (patron → dates, hors jours bloqués)
                          ▼
session_occurrences (PLANNED → HELD → validée | CANCELLED) ─< occurrence_staff (intervenant réel, verrou paie)
        │                                            ├─< occurrence_equipment
        ├─< occurrence_changes (journal automatique) └─  resource_claims (dérivée : STAFF | CLASSROOM | ROOM, exclusion)
        └─ kind : LESSON | EXAM | MEETING | EVENT | RESERVATION | COUNCIL | OTHER
```

## 3. Catalogue des tables

| Table | Rôle | Cardinalité indicative (1 500 apprenants, 60 enseignants) |
|---|---|---|
| `room_types`, `calendar_event_kinds` | Référentiels de pack | ~10 |
| `settings`, `conflict_policies` | Fuseau, mode de disponibilité, validation « quatre yeux », ouverture ; politique de conflit | 1 par établissement ; 4 lignes |
| `rooms`, `equipment_items`, `time_slots` | Salles, stock d'équipements, grille horaire | 20 à 200 ; 10 à 100 ; 8 à 14 |
| `calendar_events` | Fériés, vacances, fermetures, examens, réunions en **plage** de dates | 30 à 100 par an |
| `timetables`, `timetable_entries`, `timetable_entry_staff`, `timetable_entry_equipment` | Patrons hebdomadaires | 1 à 3 emplois du temps ; 300 à 3 000 patrons |
| `generation_runs` | Journal des générations | quelques dizaines |
| `session_occurrences` | Séances datées (toutes natures) | 100 à 600 par jour ouvré → 100 000 par an |
| `occurrence_staff`, `occurrence_equipment` | Intervenants réels, équipements | ≈ 1,1 × occurrences ; rare |
| `resource_claims` | Réservations de ressources exclusives (dérivée) | ≈ 3 × occurrences non annulées |
| `occurrence_changes` | Journal automatique | ≈ 2 × occurrences |

## 4. Décisions de modélisation à connaître

1. **Un agrégat « séance »**, pas trois couches non synchronisées. Le legacy Professional avait une grille hebdomadaire (`professional_emploi_temps`), un planning ponctuel (`professional_course_plannings`) et la séance réalisée (`professional_ecue_seances`) sans lien codé entre elles (« séances manquantes » reconstitué par rapprochement en lecture) ; l'académique avait un objet daté (`session_instances`) et un assistant de génération cassé. Désormais : **patron récurrent → occurrence datée** (génération idempotente par `UNIQUE (patron, date, heure)`), plus des occurrences ponctuelles (`timetable_entry_id` nul : séance ad hoc, examen, réservation, séance comptable).
2. **Machine d'états unique** : `PLANNED → HELD` (constat : appel soumis, ou action admin) `→ validée` (`validated_at`, acte de gestion distinct, sous MFA) ; `CANCELLED` (motif). Une occurrence validée ne se modifie ni ne s'annule : on la **dévalide** d'abord (le legacy modifiait silencieusement les heures d'une séance validée, et laissait un enseignant réaffecter une séance payée).
3. **Le bénéficiaire de la paie est l'intervenant réel** (`occurrence_staff`), remplaçant compris (`SUBSTITUTE` avec `replaces_staff_id`) — jamais le titulaire d'affectation. `paid_minutes` est la dérogation comptable (« durée payée »), distincte de la durée planifiée ; `locked_at` et `lock_ref` sont posés par la paie à l'inclusion des heures dans un bulletin non annulé (verrou plus strict que le legacy, qui ne verrouillait que `approved`/`paid` et laissait l'heure « consommée » sans verrou en `disputed`).
4. **Conflits imposés, explicables et configurables.** Le domaine calcule et explique (aperçu `previewConflicts`) ; la base garantit au COMMIT qu'aucun enseignant, aucune classe, aucune salle n'est réservé deux fois si la politique est `BLOCK`. Un dépassement motivé (`conflict_override`, permission sensible, journalisé) produit des réservations non exclusives. Les conflits de **cohorte** et de **salle** du Professional, jamais détectés à l'écriture dans le legacy, le sont désormais. L'équipement est un **stock** (somme des quantités sur plages chevauchantes ≤ quantité), sérialisé par verrou de ligne.
5. **Offre à la carte** : `claims_classroom = false` — la classe n'est pas réunie, donc pas de réservation exclusive de la classe ; le conflit se vérifie au niveau de l'apprenant à l'inscription via le port `ScheduleConflictChecker`.
6. **Séance « comptable »** (heures déclarées depuis l'écran de paie sans plage réelle) : `origin = 'ACCOUNTING'`, fenêtre synthétique, **aucune** réservation de ressource ; validation par une autre personne que le créateur (`settings.allow_self_validation = false`).
7. **Disponibilités et capacités sont des avertissements**, jamais des blocages : une indisponibilité déclarée (`people.staff_availabilities`) ou une salle trop petite sont signalées par `previewConflicts` mais n'empêchent pas la planification.

## 5. DDL de référence

### 5.1 Schéma, référentiels, salles, équipements, grille, calendrier

<!-- migration: 1000_scheduling_reference.sql -->
```sql
-- =============================================================================
-- 1000 — Module scheduling : schéma, référentiels, salles, équipements, grille, calendrier
-- =============================================================================
--
-- Plage de numéros réservée au module scheduling : 1000–1099 (numéros GLOBAUX, voir
-- docs/architecture/module-conventions.md ; plage à inscrire dans ce tableau).
--
-- Trois couches du legacy Professional (grille hebdomadaire `professional_emploi_temps`,
-- planning ponctuel `professional_course_plannings`, séance réalisée `professional_ecue_seances`)
-- et l'unique objet daté de l'académique (`session_instances`) deviennent :
--     timetable_entries  (patron récurrent)  ->  session_occurrences  (instance datée)
-- avec des conflits imposés par la base (resource_claims). Les salles sont des clés (plus de
-- texte libre « TBD »), le fuseau vient de l'établissement (plus de `Europe/Paris` en dur).
-- Références inter-modules par UUID, sans FK : tenancy (établissement, campus), academic
-- (année, classe, nœud, offre), people (personnel).
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS scheduling;
REVOKE ALL ON SCHEMA scheduling FROM PUBLIC;
GRANT USAGE ON SCHEMA scheduling TO app_user;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Types de salle (salle de classe, laboratoire, amphithéâtre, gymnase…), donnée de pack.
CREATE TABLE scheduling.room_types (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES kernel.tenants (id),
  code       text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label      text NOT NULL CHECK (length(btrim(label)) > 0),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('scheduling.room_types');
GRANT SELECT, INSERT, UPDATE ON scheduling.room_types TO app_user;

-- Types d'événements de calendrier (férié, vacances, fermeture, examen, réunion…).
CREATE TABLE scheduling.calendar_event_kinds (
  id                      uuid PRIMARY KEY,
  tenant_id               uuid NOT NULL REFERENCES kernel.tenants (id),
  code                    text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label                   text NOT NULL CHECK (length(btrim(label)) > 0),
  blocks_teaching_default boolean NOT NULL DEFAULT false,
  active                  boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('scheduling.calendar_event_kinds');
GRANT SELECT, INSERT, UPDATE ON scheduling.calendar_event_kinds TO app_user;

-- Paramètres par établissement (une ligne).
--   timezone : fuseau IANA de l'établissement (copié du CountryProfile à la création) ;
--   staff_availability_mode : OPEN = disponible sauf indisponibilité déclarée ; CLOSED =
--       indisponible sauf disponibilité déclarée ;
--   max_generation_weeks : garde-fou technique de la génération d'occurrences (pas une règle
--       métier : la génération est bornée par la période / validité réelle) ;
--   allow_self_validation : false = « quatre yeux » : celui qui crée une séance comptable ne peut
--       pas la valider (le legacy tolérait le cumul, seulement tracé par `saisie_comptable`) ;
--   opening_* : amplitude d'ouverture des salles (dénominateur du taux d'occupation) ; NULL =
--       taux d'occupation indisponible (le legacy codait 12 h x 6 j = 72 h par semaine).
CREATE TABLE scheduling.settings (
  tenant_id               uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id          uuid NOT NULL,
  timezone                text NOT NULL DEFAULT 'Africa/Abidjan',
  staff_availability_mode text NOT NULL DEFAULT 'OPEN' CHECK (staff_availability_mode IN ('OPEN', 'CLOSED')),
  max_generation_weeks    integer NOT NULL DEFAULT 60 CHECK (max_generation_weeks BETWEEN 1 AND 120),
  allow_self_validation   boolean NOT NULL DEFAULT false,
  opening_start           time,
  opening_end             time,
  opening_weekdays        smallint[] CHECK (opening_weekdays IS NULL OR opening_weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  CHECK ((opening_start IS NULL) = (opening_end IS NULL) AND (opening_start IS NULL OR opening_end > opening_start)),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, institution_id)
);
SELECT kernel.enable_tenant_rls('scheduling.settings');
GRANT SELECT, INSERT, UPDATE ON scheduling.settings TO app_user;

-- Politique de conflit par ressource : BLOCK (refus à l'écriture, imposé par la base) ou WARN
-- (autorisé, signalé). Absence de ligne = BLOCK.
CREATE TABLE scheduling.conflict_policies (
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id uuid NOT NULL,
  resource_kind  text NOT NULL CHECK (resource_kind IN ('STAFF', 'CLASSROOM', 'ROOM', 'EQUIPMENT')),
  mode           text NOT NULL CHECK (mode IN ('BLOCK', 'WARN')),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, institution_id, resource_kind)
);
SELECT kernel.enable_tenant_rls('scheduling.conflict_policies');
GRANT SELECT, INSERT, UPDATE ON scheduling.conflict_policies TO app_user;

-- -----------------------------------------------------------------------------
-- Salles (physiques). NE PAS confondre avec academic.classrooms (la classe).
-- Une salle hors service refuse toute nouvelle réservation (garde dans 1003).
-- -----------------------------------------------------------------------------
CREATE TABLE scheduling.rooms (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id uuid NOT NULL,
  campus_id      uuid NOT NULL,
  code           text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
  name           text NOT NULL CHECK (length(btrim(name)) > 0),
  room_type_code text NOT NULL,
  capacity       integer CHECK (capacity IS NULL OR capacity > 0),
  building       text,
  floor_label    text,
  features       text[] NOT NULL DEFAULT '{}',        -- équipements fixes (vidéoprojecteur, tableau…), aide au placement
  status         text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'OUT_OF_SERVICE', 'ARCHIVED')),
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, campus_id, code),
  FOREIGN KEY (tenant_id, room_type_code) REFERENCES scheduling.room_types (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('scheduling.rooms');
CREATE INDEX rooms_by_institution ON scheduling.rooms (tenant_id, institution_id, status);
GRANT SELECT, INSERT, UPDATE ON scheduling.rooms TO app_user;

-- Équipements réservables (vidéoprojecteurs, kits de TP…) : un STOCK par campus, le conflit
-- est un dépassement de quantité sur un créneau (et non une exclusivité).
CREATE TABLE scheduling.equipment_items (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id uuid NOT NULL,
  campus_id      uuid NOT NULL,
  code           text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
  label          text NOT NULL CHECK (length(btrim(label)) > 0),
  quantity       integer NOT NULL CHECK (quantity >= 1),
  status         text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'OUT_OF_SERVICE', 'ARCHIVED')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, campus_id, code)
);
SELECT kernel.enable_tenant_rls('scheduling.equipment_items');
GRANT SELECT, INSERT, UPDATE ON scheduling.equipment_items TO app_user;

-- Grille horaire (cloches) de l'établissement. Facultative : le supérieur planifie en plages
-- libres, les conflits se calculent sur les heures réelles, jamais sur le créneau nominal.
CREATE TABLE scheduling.time_slots (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id uuid NOT NULL,
  campus_id      uuid,
  code           text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
  label          text NOT NULL CHECK (length(btrim(label)) > 0),
  starts_time    time NOT NULL,
  ends_time      time NOT NULL,
  is_break       boolean NOT NULL DEFAULT false,
  ordinal        integer NOT NULL DEFAULT 0 CHECK (ordinal >= 0),
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (ends_time > starts_time)
);
SELECT kernel.enable_tenant_rls('scheduling.time_slots');
CREATE UNIQUE INDEX time_slots_code_unique
  ON scheduling.time_slots (tenant_id, institution_id, (coalesce(campus_id, '00000000-0000-0000-0000-000000000000'::uuid)), code);
GRANT SELECT, INSERT, UPDATE ON scheduling.time_slots TO app_user;

-- -----------------------------------------------------------------------------
-- Calendrier de l'établissement : événements en PLAGE de dates (le legacy ne stockait qu'une
-- date par événement) ; `blocks_teaching` retire les jours de la génération des occurrences et
-- signale les occurrences existantes.
-- -----------------------------------------------------------------------------
CREATE TABLE scheduling.calendar_events (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id  uuid NOT NULL,
  campus_id       uuid,
  academic_year_id uuid,
  kind_code       text NOT NULL,
  title           text NOT NULL CHECK (length(btrim(title)) > 0),
  description     text,
  starts_on       date NOT NULL,
  ends_on         date NOT NULL,
  starts_time     time,
  ends_time       time,
  blocks_teaching boolean NOT NULL DEFAULT false,
  audience        text[] NOT NULL DEFAULT ARRAY['STAFF', 'STUDENTS', 'GUARDIANS'],
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (ends_on >= starts_on),
  CHECK ((starts_time IS NULL) = (ends_time IS NULL)),
  CHECK (audience <@ ARRAY['STAFF', 'STUDENTS', 'GUARDIANS']),
  FOREIGN KEY (tenant_id, kind_code) REFERENCES scheduling.calendar_event_kinds (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('scheduling.calendar_events');
CREATE INDEX calendar_events_by_range ON scheduling.calendar_events USING gist (tenant_id, institution_id, daterange(starts_on, ends_on, '[]'));
GRANT SELECT, INSERT, UPDATE, DELETE ON scheduling.calendar_events TO app_user;
```

### 5.2 Emplois du temps (patrons récurrents)

<!-- migration: 1001_scheduling_timetables.sql -->
```sql
-- =============================================================================
-- 1001 — Module scheduling (spec 017) : emplois du temps (patrons récurrents)
-- =============================================================================

-- Un emploi du temps = un jeu de patrons hebdomadaires pour un établissement et une année (ou
-- une période). Brouillon -> publié (visible des portails) -> archivé. Plusieurs brouillons
-- peuvent coexister ; un seul publié par (établissement, année, période).
CREATE TABLE scheduling.timetables (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id  uuid NOT NULL,
  campus_id       uuid,
  academic_year_id uuid NOT NULL,
  period_id       uuid,                                -- academic.academic_periods.id
  name            text NOT NULL CHECK (length(btrim(name)) > 0),
  status          text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  valid_from      date NOT NULL,
  valid_to        date NOT NULL,
  week_a_anchor   date,                                -- lundi d'une « semaine A » (alternance A/B)
  cloned_from_id  uuid,
  published_at    timestamptz,
  published_by    uuid,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (valid_to >= valid_from),
  CHECK (week_a_anchor IS NULL OR extract(isodow FROM week_a_anchor) = 1),
  CHECK ((status = 'DRAFT') = (published_at IS NULL)),
  FOREIGN KEY (tenant_id, cloned_from_id) REFERENCES scheduling.timetables (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('scheduling.timetables');
CREATE UNIQUE INDEX timetables_one_published
  ON scheduling.timetables (tenant_id, institution_id, academic_year_id, (coalesce(period_id, '00000000-0000-0000-0000-000000000000'::uuid)), (coalesce(campus_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  WHERE status = 'PUBLISHED';
CREATE INDEX timetables_by_year ON scheduling.timetables (tenant_id, institution_id, academic_year_id, status);
GRANT SELECT, INSERT, UPDATE ON scheduling.timetables TO app_user;

-- Patron récurrent : « chaque lundi de 08:00 à 10:00, classe X, matière Y, salle Z ».
--   weekday      jour ISO 1 (lundi) à 7 (dimanche) — le dimanche est permis (UI limitée à lundi-samedi
--                dans le legacy, jamais le schéma)
--   week_pattern EVERY | WEEK_A | WEEK_B (alternance relative à timetables.week_a_anchor)
--   valid_from/valid_to : bornes propres au patron (sinon celles de l'emploi du temps)
CREATE TABLE scheduling.timetable_entries (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  timetable_id        uuid NOT NULL,
  kind                text NOT NULL DEFAULT 'LESSON' CHECK (kind IN ('LESSON', 'EXAM', 'MEETING', 'EVENT', 'OTHER')),
  classroom_id        uuid,                              -- academic.classrooms.id
  curriculum_node_id  uuid,                              -- academic.curriculum_nodes.id
  offering_id         uuid,                              -- academic.classroom_offerings.id
  claims_classroom    boolean NOT NULL DEFAULT true,
  weekday             smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  starts_time         time NOT NULL,
  ends_time           time NOT NULL,
  time_slot_id        uuid,
  room_id             uuid,
  week_pattern        text NOT NULL DEFAULT 'EVERY' CHECK (week_pattern IN ('EVERY', 'WEEK_A', 'WEEK_B')),
  valid_from          date,
  valid_to            date,
  delivery_mode       text NOT NULL DEFAULT 'IN_PERSON' CHECK (delivery_mode IN ('IN_PERSON', 'ONLINE', 'HYBRID')),
  title               text,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (ends_time > starts_time),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  CHECK (kind <> 'LESSON' OR (classroom_id IS NOT NULL AND curriculum_node_id IS NOT NULL)),
  FOREIGN KEY (tenant_id, timetable_id) REFERENCES scheduling.timetables (tenant_id, id),
  FOREIGN KEY (tenant_id, time_slot_id) REFERENCES scheduling.time_slots (tenant_id, id),
  FOREIGN KEY (tenant_id, room_id) REFERENCES scheduling.rooms (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('scheduling.timetable_entries');
CREATE INDEX timetable_entries_by_timetable ON scheduling.timetable_entries (tenant_id, timetable_id, weekday, starts_time);
CREATE INDEX timetable_entries_by_class ON scheduling.timetable_entries (tenant_id, classroom_id) WHERE classroom_id IS NOT NULL;
CREATE INDEX timetable_entries_by_room ON scheduling.timetable_entries (tenant_id, room_id) WHERE room_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON scheduling.timetable_entries TO app_user;

CREATE TABLE scheduling.timetable_entry_staff (
  tenant_id  uuid NOT NULL REFERENCES kernel.tenants (id),
  entry_id   uuid NOT NULL,
  staff_id   uuid NOT NULL,                              -- people.staff.id
  role       text NOT NULL DEFAULT 'LEAD' CHECK (role IN ('LEAD', 'CO_TEACHER', 'SUPERVISOR')),
  PRIMARY KEY (tenant_id, entry_id, staff_id),
  FOREIGN KEY (tenant_id, entry_id) REFERENCES scheduling.timetable_entries (tenant_id, id) ON DELETE CASCADE
);
SELECT kernel.enable_tenant_rls('scheduling.timetable_entry_staff');
CREATE INDEX timetable_entry_staff_by_staff ON scheduling.timetable_entry_staff (tenant_id, staff_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON scheduling.timetable_entry_staff TO app_user;

CREATE TABLE scheduling.timetable_entry_equipment (
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants (id),
  entry_id     uuid NOT NULL,
  equipment_id uuid NOT NULL,
  quantity     integer NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  PRIMARY KEY (tenant_id, entry_id, equipment_id),
  FOREIGN KEY (tenant_id, entry_id) REFERENCES scheduling.timetable_entries (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, equipment_id) REFERENCES scheduling.equipment_items (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('scheduling.timetable_entry_equipment');
GRANT SELECT, INSERT, UPDATE, DELETE ON scheduling.timetable_entry_equipment TO app_user;

-- Journal des générations d'occurrences (traçabilité, rejeu idempotent).
CREATE TABLE scheduling.generation_runs (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  timetable_id    uuid NOT NULL,
  from_date       date NOT NULL,
  to_date         date NOT NULL,
  created_count   integer NOT NULL DEFAULT 0 CHECK (created_count >= 0),
  skipped_blocked integer NOT NULL DEFAULT 0 CHECK (skipped_blocked >= 0),
  skipped_conflict integer NOT NULL DEFAULT 0 CHECK (skipped_conflict >= 0),
  warnings        jsonb NOT NULL DEFAULT '[]'::jsonb,
  requested_by    uuid,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (to_date >= from_date),
  FOREIGN KEY (tenant_id, timetable_id) REFERENCES scheduling.timetables (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('scheduling.generation_runs');
GRANT SELECT, INSERT ON scheduling.generation_runs TO app_user;
```

### 5.3 Occurrences, intervenants, réservations de ressources, journal

<!-- migration: 1002_scheduling_occurrences.sql -->
```sql
-- =============================================================================
-- 1002 — Module scheduling (spec 017) : occurrences, intervenants, réservations de ressources
-- =============================================================================
--
-- UN SEUL agrégat « séance » : planification, constat de réalisation, validation pour la paie,
-- avec une machine d'états explicite :
--
--     PLANNED --constat (appel soumis ou action admin)--> HELD --validation--> HELD + validated_at
--        \--> CANCELLED (depuis PLANNED, ou HELD non validée)
--
-- La validation (`validated_at`) est un acte de gestion DISTINCT du constat pédagogique
-- (parité : professional-seance-validation). Le bénéficiaire de la paie est l'INTERVENANT RÉEL
-- (`occurrence_staff`, remplaçant compris), jamais le titulaire de l'affectation d'enseignement.
-- =============================================================================

CREATE TABLE scheduling.session_occurrences (
  id                    uuid PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id        uuid NOT NULL,
  campus_id             uuid,
  academic_year_id      uuid NOT NULL,
  timetable_entry_id    uuid,
  kind                  text NOT NULL DEFAULT 'LESSON' CHECK (kind IN ('LESSON', 'EXAM', 'MEETING', 'EVENT', 'RESERVATION', 'COUNCIL', 'OTHER')),
  title                 text,
  classroom_id          uuid,                              -- academic.classrooms.id
  curriculum_node_id    uuid,                              -- academic.curriculum_nodes.id
  offering_id           uuid,                              -- academic.classroom_offerings.id
  claims_classroom      boolean NOT NULL DEFAULT true,     -- false pour une offre à la carte (la classe n'est pas réunie)
  room_id               uuid,
  starts_at             timestamptz NOT NULL,
  ends_at               timestamptz NOT NULL,
  occurs_on             date NOT NULL,                     -- date civile dans le fuseau de l'établissement
  during                tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED,
  delivery_mode         text NOT NULL DEFAULT 'IN_PERSON' CHECK (delivery_mode IN ('IN_PERSON', 'ONLINE', 'HYBRID')),
  virtual_session_ref   uuid,                              -- classe virtuelle (modules 022/023)
  status                text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'HELD', 'CANCELLED')),
  held_at               timestamptz,
  held_source           text CHECK (held_source IN ('ATTENDANCE', 'ADMIN', 'AUTO')),
  held_by               uuid,
  cancelled_at          timestamptz,
  cancel_reason         text,
  validated_at          timestamptz,
  validated_by          uuid,
  origin                text NOT NULL DEFAULT 'GENERATED' CHECK (origin IN ('GENERATED', 'AD_HOC', 'ACCOUNTING', 'IMPORT')),
  conflict_override     boolean NOT NULL DEFAULT false,
  conflict_override_reason text,
  conflict_override_by  uuid,
  needs_replacement     boolean NOT NULL DEFAULT false,
  notes                 text,
  location_label        text,                              -- lieu libre hors salle du référentiel (sortie, examen délocalisé)
  attributes            jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),   -- ex. type d'examen, surveillants
  created_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (ends_at > starts_at),
  CHECK (abs(occurs_on - (starts_at AT TIME ZONE 'UTC')::date) <= 1),
  CHECK (kind <> 'LESSON' OR (classroom_id IS NOT NULL AND curriculum_node_id IS NOT NULL)),
  CHECK (status <> 'HELD' OR (held_at IS NOT NULL AND held_source IS NOT NULL)),
  CHECK (status <> 'CANCELLED' OR (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL)),
  CHECK (validated_at IS NULL OR status = 'HELD'),
  CHECK ((validated_at IS NULL) = (validated_by IS NULL)),
  CHECK (NOT conflict_override OR (conflict_override_reason IS NOT NULL AND conflict_override_by IS NOT NULL)),
  FOREIGN KEY (tenant_id, timetable_entry_id) REFERENCES scheduling.timetable_entries (tenant_id, id),
  FOREIGN KEY (tenant_id, room_id) REFERENCES scheduling.rooms (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('scheduling.session_occurrences');
-- Génération idempotente : un patron ne produit qu'une occurrence par date et heure de début.
CREATE UNIQUE INDEX occurrences_entry_date ON scheduling.session_occurrences (tenant_id, timetable_entry_id, occurs_on, starts_at) WHERE timetable_entry_id IS NOT NULL;
CREATE INDEX occurrences_by_date ON scheduling.session_occurrences (tenant_id, institution_id, occurs_on, starts_at);
CREATE INDEX occurrences_by_class ON scheduling.session_occurrences (tenant_id, classroom_id, occurs_on) WHERE classroom_id IS NOT NULL;
CREATE INDEX occurrences_by_room ON scheduling.session_occurrences (tenant_id, room_id, occurs_on) WHERE room_id IS NOT NULL;
CREATE INDEX occurrences_by_node ON scheduling.session_occurrences (tenant_id, curriculum_node_id, occurs_on) WHERE curriculum_node_id IS NOT NULL;
CREATE INDEX occurrences_to_hold ON scheduling.session_occurrences (tenant_id, occurs_on) WHERE status = 'PLANNED';
CREATE INDEX occurrences_to_validate ON scheduling.session_occurrences (tenant_id, occurs_on) WHERE status = 'HELD' AND validated_at IS NULL;
GRANT SELECT, INSERT, UPDATE ON scheduling.session_occurrences TO app_user;

-- Intervenants d'une occurrence. `paid_minutes` = dérogation comptable (« durée payée »), la
-- durée planifiée restant intacte. `locked_at` : posé par la paie quand les heures sont
-- consommées par un bulletin approuvé ou payé ; une ligne verrouillée ne change plus.
CREATE TABLE scheduling.occurrence_staff (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  occurrence_id      uuid NOT NULL,
  staff_id           uuid NOT NULL,                        -- people.staff.id
  role               text NOT NULL DEFAULT 'LEAD' CHECK (role IN ('LEAD', 'CO_TEACHER', 'SUBSTITUTE', 'SUPERVISOR')),
  replaces_staff_id  uuid,
  is_paid_role       boolean NOT NULL DEFAULT true,
  paid_minutes       integer CHECK (paid_minutes IS NULL OR paid_minutes BETWEEN 1 AND 1440),   -- au plus une journée (garde-fou technique, pas un plafond de paie)
  paid_minutes_by    uuid,
  paid_minutes_at    timestamptz,
  locked_at          timestamptz,
  lock_ref           uuid,                                  -- identifiant du bulletin / de la ligne de paie
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, occurrence_id, staff_id),
  CHECK (role <> 'SUBSTITUTE' OR replaces_staff_id IS NOT NULL),
  CHECK (replaces_staff_id IS NULL OR replaces_staff_id <> staff_id),
  CHECK ((paid_minutes IS NULL) = (paid_minutes_by IS NULL)),
  CHECK ((locked_at IS NULL) = (lock_ref IS NULL)),
  FOREIGN KEY (tenant_id, occurrence_id) REFERENCES scheduling.session_occurrences (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('scheduling.occurrence_staff');
CREATE INDEX occurrence_staff_by_staff ON scheduling.occurrence_staff (tenant_id, staff_id);
CREATE INDEX occurrence_staff_locked ON scheduling.occurrence_staff (tenant_id, lock_ref) WHERE locked_at IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON scheduling.occurrence_staff TO app_user;

CREATE TABLE scheduling.occurrence_equipment (
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  occurrence_id uuid NOT NULL,
  equipment_id  uuid NOT NULL,
  quantity      integer NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  PRIMARY KEY (tenant_id, occurrence_id, equipment_id),
  FOREIGN KEY (tenant_id, occurrence_id) REFERENCES scheduling.session_occurrences (tenant_id, id),
  FOREIGN KEY (tenant_id, equipment_id) REFERENCES scheduling.equipment_items (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('scheduling.occurrence_equipment');
GRANT SELECT, INSERT, UPDATE, DELETE ON scheduling.occurrence_equipment TO app_user;

-- -----------------------------------------------------------------------------
-- Réservations de ressources exclusives (enseignant, classe, salle). Table DÉRIVÉE, maintenue
-- exclusivement par les déclencheurs SECURITY DEFINER de 1003 (l'application n'a que SELECT) ;
-- c'est elle qui rend le double-booking IMPOSSIBLE même sous concurrence : la contrainte
-- d'exclusion est vérifiée au COMMIT (DEFERRABLE) pour permettre d'échanger deux enseignants
-- dans la même transaction. `exclusive = false` pour une politique WARN ou un dépassement
-- autorisé (`conflict_override`, motivé et audité).
-- -----------------------------------------------------------------------------
CREATE TABLE scheduling.resource_claims (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  occurrence_id  uuid NOT NULL,
  resource_kind  text NOT NULL CHECK (resource_kind IN ('STAFF', 'CLASSROOM', 'ROOM')),
  resource_id    uuid NOT NULL,
  during         tstzrange NOT NULL,
  exclusive      boolean NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, occurrence_id, resource_kind, resource_id),
  FOREIGN KEY (tenant_id, occurrence_id) REFERENCES scheduling.session_occurrences (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT resource_claims_no_overlap EXCLUDE USING gist (
    tenant_id WITH =, resource_kind WITH =, resource_id WITH =, during WITH &&
  ) WHERE (exclusive) DEFERRABLE INITIALLY DEFERRED
);
SELECT kernel.enable_tenant_rls('scheduling.resource_claims');
CREATE INDEX resource_claims_by_resource ON scheduling.resource_claims (tenant_id, resource_kind, resource_id);
GRANT SELECT ON scheduling.resource_claims TO app_user;

-- Journal des changements d'une occurrence (heure, salle, intervenant, statut, validation) :
-- le legacy ne gardait aucune trace des séances modifiées après validation. Append-only.
CREATE TABLE scheduling.occurrence_changes (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  occurrence_id  uuid NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('CREATED', 'RESCHEDULED', 'ROOM_CHANGED', 'STAFF_CHANGED', 'HELD', 'UNHELD', 'CANCELLED', 'VALIDATED', 'UNVALIDATED', 'PAID_MINUTES', 'OVERRIDE', 'OTHER')),
  from_value     jsonb,
  to_value       jsonb,
  reason         text,
  actor_id       uuid,
  changed_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, occurrence_id) REFERENCES scheduling.session_occurrences (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('scheduling.occurrence_changes');
CREATE INDEX occurrence_changes_by_occurrence ON scheduling.occurrence_changes (tenant_id, occurrence_id, changed_at);
GRANT SELECT, INSERT ON scheduling.occurrence_changes TO app_user;
```

### 5.4 Conflits, verrous de paie, journal, heures payables

<!-- migration: 1003_scheduling_guards.sql -->
```sql
-- =============================================================================
-- 1003 — Module scheduling : conflits imposés par la base, verrous de paie, journal, heures payables
-- =============================================================================
--
-- Défense en profondeur : le domaine (TypeScript) détecte et explique les conflits AVANT l'écriture
-- (aperçu), la base les IMPOSE au COMMIT. Après chaque série d'écritures, les cas d'usage exécutent
--     SET CONSTRAINTS scheduling.resource_claims_no_overlap IMMEDIATE
-- pour convertir un 23P01 en erreur `scheduling.conflict_detected` dans la transaction.
-- =============================================================================

CREATE FUNCTION scheduling.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'scheduling.immutable: % est immuable (% interdit)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;
CREATE TRIGGER occurrence_changes_immutable BEFORE UPDATE OR DELETE ON scheduling.occurrence_changes
  FOR EACH ROW EXECUTE FUNCTION scheduling.forbid_mutation();
CREATE TRIGGER generation_runs_immutable BEFORE UPDATE OR DELETE ON scheduling.generation_runs
  FOR EACH ROW EXECUTE FUNCTION scheduling.forbid_mutation();
CREATE TRIGGER occurrences_no_delete BEFORE DELETE ON scheduling.session_occurrences
  FOR EACH ROW EXECUTE FUNCTION scheduling.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Maintenance des réservations de ressources (SECURITY DEFINER : l'application n'a qu'un SELECT
-- sur resource_claims). Le tenant vient du contexte de transaction, jamais d'un paramètre.
-- Les entrées « comptables » (heures sans plage réelle) ne réservent rien.
-- -----------------------------------------------------------------------------
CREATE FUNCTION scheduling.sync_occurrence_claims(p_occurrence uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, scheduling, kernel AS $$
DECLARE
  o        scheduling.session_occurrences%ROWTYPE;
  v_mode   text;
BEGIN
  SELECT * INTO o FROM scheduling.session_occurrences
   WHERE tenant_id = kernel.current_tenant_id() AND id = p_occurrence;
  IF NOT FOUND THEN RETURN; END IF;

  DELETE FROM scheduling.resource_claims WHERE tenant_id = o.tenant_id AND occurrence_id = o.id;
  IF o.status = 'CANCELLED' OR o.origin = 'ACCOUNTING' THEN RETURN; END IF;

  -- Groupe d'apprenants : la classe quand elle est réunie ; sinon (offre à la carte) l'OFFRE elle-même,
  -- pour qu'une même offre ne tienne pas deux séances simultanées. Même famille « CLASSROOM » et
  -- même politique ; les identifiants (classe / offre) sont des UUID distincts.
  IF o.kind IN ('LESSON', 'EXAM')
     AND ((o.claims_classroom AND o.classroom_id IS NOT NULL) OR (NOT o.claims_classroom AND o.offering_id IS NOT NULL)) THEN
    SELECT coalesce((SELECT mode FROM scheduling.conflict_policies
                      WHERE tenant_id = o.tenant_id AND institution_id = o.institution_id AND resource_kind = 'CLASSROOM'), 'BLOCK')
      INTO v_mode;
    INSERT INTO scheduling.resource_claims (id, tenant_id, occurrence_id, resource_kind, resource_id, during, exclusive)
    VALUES (gen_random_uuid(), o.tenant_id, o.id, 'CLASSROOM',
            CASE WHEN o.claims_classroom THEN o.classroom_id ELSE o.offering_id END,
            o.during, v_mode = 'BLOCK' AND NOT o.conflict_override);
  END IF;

  IF o.room_id IS NOT NULL THEN
    SELECT coalesce((SELECT mode FROM scheduling.conflict_policies
                      WHERE tenant_id = o.tenant_id AND institution_id = o.institution_id AND resource_kind = 'ROOM'), 'BLOCK')
      INTO v_mode;
    INSERT INTO scheduling.resource_claims (id, tenant_id, occurrence_id, resource_kind, resource_id, during, exclusive)
    VALUES (gen_random_uuid(), o.tenant_id, o.id, 'ROOM', o.room_id, o.during, v_mode = 'BLOCK' AND NOT o.conflict_override);
  END IF;

  SELECT coalesce((SELECT mode FROM scheduling.conflict_policies
                    WHERE tenant_id = o.tenant_id AND institution_id = o.institution_id AND resource_kind = 'STAFF'), 'BLOCK')
    INTO v_mode;
  INSERT INTO scheduling.resource_claims (id, tenant_id, occurrence_id, resource_kind, resource_id, during, exclusive)
  SELECT gen_random_uuid(), o.tenant_id, o.id, 'STAFF', s.staff_id, o.during, v_mode = 'BLOCK' AND NOT o.conflict_override
    FROM scheduling.occurrence_staff s
   WHERE s.tenant_id = o.tenant_id AND s.occurrence_id = o.id;
END
$$;
REVOKE ALL ON FUNCTION scheduling.sync_occurrence_claims(uuid) FROM PUBLIC;

CREATE FUNCTION scheduling.occurrences_claims_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, scheduling, kernel AS $$
BEGIN
  PERFORM scheduling.sync_occurrence_claims(NEW.id);
  RETURN NULL;
END
$$;
CREATE TRIGGER occurrences_claims AFTER INSERT OR UPDATE OF starts_at, ends_at, status, room_id, classroom_id, offering_id, claims_classroom, conflict_override, kind, origin
  ON scheduling.session_occurrences FOR EACH ROW EXECUTE FUNCTION scheduling.occurrences_claims_trigger();

CREATE FUNCTION scheduling.occurrence_staff_claims_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, scheduling, kernel AS $$
BEGIN
  PERFORM scheduling.sync_occurrence_claims(coalesce(NEW.occurrence_id, OLD.occurrence_id));
  RETURN NULL;
END
$$;
CREATE TRIGGER occurrence_staff_claims AFTER INSERT OR UPDATE OF staff_id OR DELETE
  ON scheduling.occurrence_staff FOR EACH ROW EXECUTE FUNCTION scheduling.occurrence_staff_claims_trigger();

-- -----------------------------------------------------------------------------
-- Occurrence : identité figée, transitions légales, validation = verrou sur l'horaire,
-- salle disponible.
--   PLANNED -> HELD | CANCELLED ; HELD -> CANCELLED | PLANNED (si non validée) ; CANCELLED -> PLANNED
--   Une séance VALIDÉE ne change ni d'horaire ni de statut : on la dévalide d'abord (le legacy
--   modifiait silencieusement les heures d'une séance validée).
--   Une séance dont un intervenant a ses heures verrouillées par la paie ne bouge plus du tout.
-- -----------------------------------------------------------------------------
CREATE FUNCTION scheduling.occurrences_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_room_status text;
BEGIN
  IF NEW.room_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.room_id IS DISTINCT FROM OLD.room_id) THEN
    SELECT status INTO v_room_status FROM scheduling.rooms WHERE tenant_id = NEW.tenant_id AND id = NEW.room_id;
    IF v_room_status <> 'AVAILABLE' THEN
      RAISE EXCEPTION 'scheduling.room_unavailable: la salle est %', v_room_status USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;

  IF NEW.institution_id <> OLD.institution_id OR NEW.academic_year_id <> OLD.academic_year_id
     OR NEW.timetable_entry_id IS DISTINCT FROM OLD.timetable_entry_id OR NEW.kind <> OLD.kind THEN
    RAISE EXCEPTION 'scheduling.occurrence_identity_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'PLANNED'   AND NEW.status IN ('HELD', 'CANCELLED')) OR
       (OLD.status = 'HELD'      AND NEW.status IN ('CANCELLED', 'PLANNED')) OR
       (OLD.status = 'CANCELLED' AND NEW.status = 'PLANNED')) THEN
    RAISE EXCEPTION 'scheduling.occurrence_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.validated_at IS NOT NULL AND NEW.validated_at IS NOT NULL
     AND (NEW.starts_at <> OLD.starts_at OR NEW.ends_at <> OLD.ends_at OR NEW.status <> OLD.status OR NEW.room_id IS DISTINCT FROM OLD.room_id) THEN
    RAISE EXCEPTION 'scheduling.occurrence_validated: dévalider la séance avant de la modifier' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.starts_at <> OLD.starts_at OR NEW.ends_at <> OLD.ends_at OR NEW.status <> OLD.status
      OR NEW.validated_at IS DISTINCT FROM OLD.validated_at) AND EXISTS (
       SELECT 1 FROM scheduling.occurrence_staff s
        WHERE s.tenant_id = OLD.tenant_id AND s.occurrence_id = OLD.id AND s.locked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'scheduling.occurrence_locked: des heures de cette séance sont verrouillées par la paie' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER occurrences_guard BEFORE INSERT OR UPDATE ON scheduling.session_occurrences
  FOR EACH ROW EXECUTE FUNCTION scheduling.occurrences_guard();

-- -----------------------------------------------------------------------------
-- Intervenants : pas d'écriture sur une séance validée ; une ligne verrouillée par la paie est
-- gelée (déverrouillage seulement via `scheduling.payroll_unlock = on`, posé par l'API publique
-- `releaseHoursLock`).
-- -----------------------------------------------------------------------------
CREATE FUNCTION scheduling.occurrence_staff_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_validated timestamptz;
  v_unlock    boolean := coalesce(current_setting('scheduling.payroll_unlock', true), '') = 'on';
  v_row       scheduling.occurrence_staff%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;
  SELECT validated_at INTO v_validated FROM scheduling.session_occurrences
   WHERE tenant_id = v_row.tenant_id AND id = v_row.occurrence_id;

  IF TG_OP = 'UPDATE' AND OLD.locked_at IS NOT NULL THEN
    IF v_unlock AND NEW.locked_at IS NULL AND NEW.lock_ref IS NULL
       AND NEW.staff_id = OLD.staff_id AND NEW.role = OLD.role AND NEW.paid_minutes IS NOT DISTINCT FROM OLD.paid_minutes THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'scheduling.hours_locked: heures verrouillées par la paie (%)', OLD.lock_ref USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' AND OLD.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'scheduling.hours_locked: heures verrouillées par la paie (%)', OLD.lock_ref USING ERRCODE = 'restrict_violation';
  END IF;
  IF v_validated IS NOT NULL AND NOT (TG_OP = 'UPDATE' AND NEW.locked_at IS NOT NULL AND OLD.locked_at IS NULL) THEN
    RAISE EXCEPTION 'scheduling.occurrence_validated: dévalider la séance avant de changer ses intervenants' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER occurrence_staff_guard BEFORE INSERT OR UPDATE OR DELETE ON scheduling.occurrence_staff
  FOR EACH ROW EXECUTE FUNCTION scheduling.occurrence_staff_guard();

-- -----------------------------------------------------------------------------
-- Équipement : la somme des quantités réservées sur des plages qui se chevauchent ne dépasse
-- pas le stock (verrou de ligne sur l'article : les réservations concurrentes se sérialisent).
-- -----------------------------------------------------------------------------
CREATE FUNCTION scheduling.occurrence_equipment_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_item    scheduling.equipment_items%ROWTYPE;
  v_occ     scheduling.session_occurrences%ROWTYPE;
  v_mode    text;
  v_used    integer;
BEGIN
  SELECT * INTO v_item FROM scheduling.equipment_items
   WHERE tenant_id = NEW.tenant_id AND id = NEW.equipment_id FOR UPDATE;
  SELECT * INTO v_occ FROM scheduling.session_occurrences WHERE tenant_id = NEW.tenant_id AND id = NEW.occurrence_id;
  IF v_item.status <> 'AVAILABLE' THEN
    RAISE EXCEPTION 'scheduling.equipment_unavailable: l''équipement est %', v_item.status USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce((SELECT mode FROM scheduling.conflict_policies
                    WHERE tenant_id = v_occ.tenant_id AND institution_id = v_occ.institution_id AND resource_kind = 'EQUIPMENT'), 'BLOCK')
    INTO v_mode;
  IF v_mode = 'BLOCK' AND NOT v_occ.conflict_override AND v_occ.status <> 'CANCELLED' THEN
    SELECT coalesce(sum(e.quantity), 0)::integer INTO v_used
      FROM scheduling.occurrence_equipment e
      JOIN scheduling.session_occurrences o ON o.tenant_id = e.tenant_id AND o.id = e.occurrence_id
     WHERE e.tenant_id = NEW.tenant_id AND e.equipment_id = NEW.equipment_id
       AND e.occurrence_id <> NEW.occurrence_id AND o.status <> 'CANCELLED' AND o.during && v_occ.during;
    IF v_used + NEW.quantity > v_item.quantity THEN
      RAISE EXCEPTION 'scheduling.equipment_conflict: stock % dépassé (% déjà réservés, % demandés)', v_item.quantity, v_used, NEW.quantity
        USING ERRCODE = 'exclusion_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER occurrence_equipment_guard BEFORE INSERT OR UPDATE ON scheduling.occurrence_equipment
  FOR EACH ROW EXECUTE FUNCTION scheduling.occurrence_equipment_guard();

-- -----------------------------------------------------------------------------
-- Journal automatique des changements (qui, quoi, pourquoi). Motif lu dans le réglage de
-- transaction `scheduling.change_reason`, posé par les cas d'usage.
-- -----------------------------------------------------------------------------
CREATE FUNCTION scheduling.occurrences_journal() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_actor  uuid := kernel.current_user_id();
  v_reason text := nullif(current_setting('scheduling.change_reason', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO scheduling.occurrence_changes (id, tenant_id, occurrence_id, kind, to_value, reason, actor_id)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, 'CREATED',
            jsonb_build_object('startsAt', NEW.starts_at, 'endsAt', NEW.ends_at, 'roomId', NEW.room_id, 'origin', NEW.origin), v_reason, v_actor);
    RETURN NULL;
  END IF;
  IF NEW.starts_at <> OLD.starts_at OR NEW.ends_at <> OLD.ends_at THEN
    INSERT INTO scheduling.occurrence_changes (id, tenant_id, occurrence_id, kind, from_value, to_value, reason, actor_id)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, 'RESCHEDULED',
            jsonb_build_object('startsAt', OLD.starts_at, 'endsAt', OLD.ends_at), jsonb_build_object('startsAt', NEW.starts_at, 'endsAt', NEW.ends_at), v_reason, v_actor);
  END IF;
  IF NEW.room_id IS DISTINCT FROM OLD.room_id THEN
    INSERT INTO scheduling.occurrence_changes (id, tenant_id, occurrence_id, kind, from_value, to_value, reason, actor_id)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, 'ROOM_CHANGED', to_jsonb(OLD.room_id), to_jsonb(NEW.room_id), v_reason, v_actor);
  END IF;
  IF NEW.status <> OLD.status THEN
    INSERT INTO scheduling.occurrence_changes (id, tenant_id, occurrence_id, kind, from_value, to_value, reason, actor_id)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id,
            CASE NEW.status WHEN 'HELD' THEN 'HELD' WHEN 'CANCELLED' THEN 'CANCELLED' ELSE 'UNHELD' END,
            to_jsonb(OLD.status), to_jsonb(NEW.status), coalesce(NEW.cancel_reason, v_reason), v_actor);
  END IF;
  IF NEW.validated_at IS DISTINCT FROM OLD.validated_at THEN
    INSERT INTO scheduling.occurrence_changes (id, tenant_id, occurrence_id, kind, from_value, to_value, reason, actor_id)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id,
            CASE WHEN NEW.validated_at IS NULL THEN 'UNVALIDATED' ELSE 'VALIDATED' END,
            to_jsonb(OLD.validated_at), to_jsonb(NEW.validated_at), v_reason, v_actor);
  END IF;
  IF NEW.conflict_override AND NOT OLD.conflict_override THEN
    INSERT INTO scheduling.occurrence_changes (id, tenant_id, occurrence_id, kind, to_value, reason, actor_id)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, 'OVERRIDE', jsonb_build_object('reason', NEW.conflict_override_reason), NEW.conflict_override_reason, NEW.conflict_override_by);
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER occurrences_journal AFTER INSERT OR UPDATE ON scheduling.session_occurrences
  FOR EACH ROW EXECUTE FUNCTION scheduling.occurrences_journal();

CREATE FUNCTION scheduling.occurrence_staff_journal() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_actor  uuid := kernel.current_user_id();
  v_reason text := nullif(current_setting('scheduling.change_reason', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO scheduling.occurrence_changes (id, tenant_id, occurrence_id, kind, to_value, reason, actor_id)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.occurrence_id, 'STAFF_CHANGED', jsonb_build_object('added', NEW.staff_id, 'role', NEW.role, 'replaces', NEW.replaces_staff_id), v_reason, v_actor);
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO scheduling.occurrence_changes (id, tenant_id, occurrence_id, kind, from_value, reason, actor_id)
    VALUES (gen_random_uuid(), OLD.tenant_id, OLD.occurrence_id, 'STAFF_CHANGED', jsonb_build_object('removed', OLD.staff_id, 'role', OLD.role), v_reason, v_actor);
  ELSIF NEW.paid_minutes IS DISTINCT FROM OLD.paid_minutes THEN
    INSERT INTO scheduling.occurrence_changes (id, tenant_id, occurrence_id, kind, from_value, to_value, reason, actor_id)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.occurrence_id, 'PAID_MINUTES', to_jsonb(OLD.paid_minutes), to_jsonb(NEW.paid_minutes), v_reason, v_actor);
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER occurrence_staff_journal AFTER INSERT OR UPDATE OR DELETE ON scheduling.occurrence_staff
  FOR EACH ROW EXECUTE FUNCTION scheduling.occurrence_staff_journal();

-- -----------------------------------------------------------------------------
-- Heures payables : une heure est payable si la séance est RÉALISÉE (HELD), VALIDÉE, et que
-- l'intervenant est de rôle rémunéré. Durée payée = dérogation, sinon durée de la séance. C'est
-- le prédicat unique que la paie (032) lit ; l'exclusion « une heure ne se paie qu'une fois »
-- reste à la charge de la paie via le verrou `locked_at` / `lock_ref`.
-- -----------------------------------------------------------------------------
CREATE FUNCTION scheduling.payable_hours(p_from date, p_to date, p_staff uuid[] DEFAULT NULL)
RETURNS TABLE (
  occurrence_id uuid, staff_id uuid, occurs_on date, minutes integer, kind text,
  classroom_id uuid, curriculum_node_id uuid, offering_id uuid, title text,
  locked boolean, lock_ref uuid)
LANGUAGE sql STABLE AS $$
  SELECT o.id, s.staff_id, o.occurs_on,
         coalesce(s.paid_minutes, round(extract(epoch FROM (o.ends_at - o.starts_at)) / 60)::integer),
         o.kind, o.classroom_id, o.curriculum_node_id, o.offering_id, o.title,
         s.locked_at IS NOT NULL, s.lock_ref
    FROM scheduling.session_occurrences o
    JOIN scheduling.occurrence_staff s ON s.tenant_id = o.tenant_id AND s.occurrence_id = o.id
   WHERE o.tenant_id = kernel.current_tenant_id()
     AND o.status = 'HELD' AND o.validated_at IS NOT NULL AND s.is_paid_role
     AND o.occurs_on BETWEEN p_from AND p_to
     AND (p_staff IS NULL OR s.staff_id = ANY (p_staff))
$$;
GRANT EXECUTE ON FUNCTION scheduling.payable_hours(date, date, uuid[]) TO app_user;

-- -----------------------------------------------------------------------------
-- Conflits d'une plage candidate (aperçu, avant écriture) : renvoie les réservations qui
-- chevauchent, y compris non exclusives (politique WARN) pour l'affichage des avertissements.
-- -----------------------------------------------------------------------------
CREATE FUNCTION scheduling.find_conflicts(
  p_during tstzrange, p_staff uuid[], p_classroom uuid, p_room uuid, p_exclude_occurrence uuid DEFAULT NULL)
RETURNS TABLE (resource_kind text, resource_id uuid, occurrence_id uuid, during tstzrange, exclusive boolean)
LANGUAGE sql STABLE AS $$
  SELECT c.resource_kind, c.resource_id, c.occurrence_id, c.during, c.exclusive
    FROM scheduling.resource_claims c
   WHERE c.tenant_id = kernel.current_tenant_id()
     AND c.during && p_during
     AND (p_exclude_occurrence IS NULL OR c.occurrence_id <> p_exclude_occurrence)
     AND ((c.resource_kind = 'STAFF' AND c.resource_id = ANY (coalesce(p_staff, ARRAY[]::uuid[])))
       OR (c.resource_kind = 'CLASSROOM' AND c.resource_id = p_classroom)
       OR (c.resource_kind = 'ROOM' AND c.resource_id = p_room))
$$;
GRANT EXECUTE ON FUNCTION scheduling.find_conflicts(tstzrange, uuid[], uuid, uuid, uuid) TO app_user;
```

## 6. Invariants : qui les garantit

| Invariant | Base (DDL) | Domaine / cas d'usage |
|---|---|---|
| Pas de double réservation d'un enseignant / d'une classe / d'une salle (politique `BLOCK`) ; une séance qui ne réunit pas la classe entière (`claims_classroom = false`, offre à la carte) réserve l'**offre** (famille `CLASSROOM`, identifiant = `offering_id`) : une même offre ne tient pas deux séances simultanées, mais deux offres d'une même classe peuvent se chevaucher | `resource_claims_no_overlap` (exclusion différée) alimentée par déclencheurs | `previewConflicts` explique avant écriture ; les cas d'usage exécutent `SET CONSTRAINTS … IMMEDIATE` et traduisent le 23P01 en `scheduling.conflict_detected` avec le détail |
| Stock d'équipement | `occurrence_equipment_guard` (verrou de l'article) | idem |
| Salle hors service non réservable | `occurrences_guard` | `setRoomStatus` signale les occurrences futures concernées (événement, pas d'annulation automatique) |
| Occurrence validée : horaire, statut, salle et intervenants figés | `occurrences_guard`, `occurrence_staff_guard` | `unvalidateOccurrence` d'abord (journal) |
| Heures verrouillées par la paie | `occurrence_staff_guard` (déverrouillage via `scheduling.payroll_unlock = on`) | `lockHours` / `releaseHoursLock` réservés à la paie (`schedule.hours.lock`) |
| Génération idempotente | index unique `(patron, date, début)` | `generateOccurrences` borne par la validité du patron et la période, saute les jours bloqués (`calendar_events.blocks_teaching`) |
| Remplaçant désigne le remplacé | CHECK | `substituteStaff` supprime la ligne du titulaire (journalisée) et crée la ligne `SUBSTITUTE` |
| Journal automatique (horaire, salle, intervenant, statut, validation, dérogation) | déclencheurs `occurrences_journal`, `occurrence_staff_journal` | motif via le réglage `scheduling.change_reason` |
| Durée payée bornée à une journée | CHECK `paid_minutes ≤ 1440` | garde-fou technique, pas un plafond de paie |
| Pas de suppression physique d'occurrence ni de journal | `forbid_mutation` | annulation |

## 7. Données de référence : modèle de pack

Section `scheduling` (`tenancy/templates/scheduling/<educationSystem>/<pack>.json`), appliquée de façon idempotente :

```json
{
  "section": "scheduling",
  "schemaVersion": 1,
  "educationSystem": "CI",
  "roomTypes": [
    { "code": "CLASSROOM", "label": "Salle de classe" },
    { "code": "LAB", "label": "Laboratoire" },
    { "code": "AMPHITHEATER", "label": "Amphithéâtre" },
    { "code": "WORKSHOP", "label": "Atelier" },
    { "code": "SPORTS", "label": "Salle de sport" },
    { "code": "OTHER", "label": "Autre" }
  ],
  "calendarEventKinds": [
    { "code": "HOLIDAY", "label": "Jour férié", "blocksTeaching": true },
    { "code": "VACATION", "label": "Vacances", "blocksTeaching": true },
    { "code": "CLOSURE", "label": "Fermeture", "blocksTeaching": true },
    { "code": "EXAM_PERIOD", "label": "Période d'examens", "blocksTeaching": false },
    { "code": "MEETING", "label": "Réunion" },
    { "code": "EVENT", "label": "Événement" }
  ],
  "conflictPolicies": { "STAFF": "BLOCK", "CLASSROOM": "BLOCK", "ROOM": "BLOCK", "EQUIPMENT": "BLOCK" },
  "settings": { "staffAvailabilityMode": "OPEN", "allowSelfValidation": false }
}
```

Les jours fériés officiels et les calendriers scolaires nationaux ne sont **pas** des données de pack : ils sont saisis par l'établissement (ou publiés plus tard comme référentiel pays validé), jamais codés (question O-10).

## 8. Chemins d'accès et index

| Besoin | Requête | Index |
|---|---|---|
| Emploi du temps d'une classe / d'un enseignant / d'une salle sur une semaine | `WHERE occurs_on BETWEEN … AND classroom_id = …` (enseignant : jointure `occurrence_staff`) | `occurrences_by_class`, `occurrence_staff_by_staff`, `occurrences_by_room` |
| Séances à constater / à valider | `WHERE status = 'PLANNED' AND occurs_on < current_date` ; `WHERE status = 'HELD' AND validated_at IS NULL` | `occurrences_to_hold`, `occurrences_to_validate` |
| Conflits d'une plage candidate | `scheduling.find_conflicts(plage, enseignants, classe, salle)` | `resource_claims_no_overlap` (GiST), `resource_claims_by_resource` |
| Heures payables d'une période | `scheduling.payable_hours(from, to, staff[])` | `occurrences_by_date` + `occurrence_staff` |
| Calendrier d'un établissement | `daterange && …` | `calendar_events_by_range` (GiST) |
| Rapprochement patron → occurrences | `(timetable_entry_id, occurs_on, starts_at)` | `occurrences_entry_date` |
| Journal d'une séance | `WHERE occurrence_id = $1 ORDER BY changed_at` | `occurrence_changes_by_occurrence` |

## 9. Volumétrie et exploitation

100 000 occurrences et 300 000 réservations par an et par établissement de 1 500 apprenants : sans partitionnement jusqu'à plusieurs millions de lignes. La génération s'exécute en job (`generateOccurrences` par lots de semaines) ; le contrôle d'exclusion est vérifié au COMMIT par lot (une transaction par semaine et par classe pour borner les verrous). Les occurrences d'années closes sont en lecture seule (statut `CANCELLED`/`HELD` figé par l'archivage de l'emploi du temps).
