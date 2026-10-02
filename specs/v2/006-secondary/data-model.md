# Modèle de données — 006-secondary (schémas Postgres `councils`, `schoollife`, `stateassign`)

**Statut** : DDL de référence, **exécuté et testé sur PostgreSQL 17** (84 tests de comportement : isolation RLS, droits `app_user`, machines à états, acteur humain obligatoire, quorum, signatures, déverrouillage motivé, séparation des tâches, concurrence). Les blocs ci-dessous sont les migrations cibles ; ils font foi sur les noms et les contraintes. Les blocs `<!-- migration: … -->` sont **extraits tels quels** par `ddl-test/` (le document est la source de vérité, aucune copie) :

```bash
node specs/v2/006-secondary/ddl-test/run.mjs            # Postgres éphémère dans Docker (ED_PG_IMAGE=postgres:17-alpine), supprimé à la fin
TEST_DATABASE_URL=postgres://… node specs/v2/006-secondary/ddl-test/run.mjs   # serveur jetable existant (sans Docker)
```

**Sources** : `docs/architecture/module-conventions.md`, ADR-002 (RLS), ADR-004 (outbox), ADR-006 (un schéma par module), ADR-007 ; PRD §19, §20, §34 ; plan §3.7 ; `specs/v2/004-academic-core/data-model.md` (conventions reprises à l'identique) ; `011-assessments-grades/data-model.md` (`results.deliberations`, `results.decisions`, `results.appreciations`) ; `013-report-cards/spec.md` (snapshot, hash, rendu) ; `010-attendance` (récapitulatifs).

## 1. Conventions appliquées

| Règle | Application |
|---|---|
| Un module = un schéma | `councils` (conseil de classe + orientation), `schoollife` (vie scolaire), `stateassign` (élèves affectés par l'État). Aucune FK vers un autre schéma que `kernel.tenants(id)`. Les références vers `academic` (classe, période, inscription, programme, niveau), `people` (élève, personnel, tuteur), `results` (état de période, délibération), `finance` (bourse, factures), la GED sont des UUID **sans FK**, validées par l'API publique du module concerné (ports). |
| Toute table de tenant | `tenant_id uuid NOT NULL REFERENCES kernel.tenants(id)` + `kernel.enable_tenant_rls()` (ENABLE + FORCE, policy unique, index en tête sur `tenant_id`) + `GRANT` explicite à `app_user`. **Aucune table globale** : les trois allowlists d'isolation (`isolation-allowlist.{councils,schoollife,stateassign}.ts`) sont vides. |
| FK internes composites | `(tenant_id, id)` partout. Chaque table porte `UNIQUE (tenant_id, id)`. |
| Identifiants, dates, montants | `uuid` fourni par l'application (`newId()`) ; `timestamptz` UTC pour les instants ; `date` pour les dates civiles ; montants en **entiers** (`bigint`, unités mineures, XOF = franc) dans `stateassign` seulement (`councils` et `schoollife` n'ont aucun montant). |
| Constantes réglementaires | **Aucune.** Quorum, rôles exigés, signataires, gravités, types d'événements, barèmes de points, parcours d'orientation, tolérances de rapprochement sont des **données** (modèle de pack marqué `placeholder`, ou établissement) ; toute valeur numérique de contrôle est NULLable (`NULL` = pas de contrôle). |
| Suppression | Aucun `DELETE` applicatif sur les tables de conseil, de vie scolaire et d'affectation : statut + motif + historique. Exceptions étroites : participants et ordre du jour d'une séance **planifiée**, valeurs d'un barème **brouillon**. |
| Acteur humain | Les actes réglementaires et disciplinaires (décision, résolution de proposition, signature, ouverture/clôture/annulation de séance, déverrouillage, mesure, validation, vérification d'affectation…) exigent `app.actor = 'user'` **et** un `app.user_id` : un job, une règle ou un super-administrateur « système » est **refusé par la base** (`*.human_decision_required` / `*.human_actor_required`). La personne enregistrée (`recorded_by`, `proposed_by`, `verified_by`…) est **toujours** l'utilisateur de la session, recopié par la base. |
| Audit | Les cas d'usage sensibles appellent `audit.record(tx, …)` dans la même transaction (liste en spec §Audit). L'historique propre au module (`councils.events`, `schoollife.life_events`, `stateassign.assignment_events`) est **append-only**, alimenté par déclencheurs, indépendamment de l'audit. |
| Événements | Écrits dans `kernel.domain_events` par `PgOutboxWriter(tx)` dans la transaction de la donnée (spec §Événements). |
| Plages de migrations (proposées) | `councils` 1800-1899, `schoollife` 1900-1999, `stateassign` 2000-2099. Le générateur `pnpm module:new` attribue la plage définitive dans l'ordre de création ; **renuméroter les fichiers** si une autre spec (005, 007, 018) a pris la plage entre-temps (voir `plan.md` R-3). |

## 2. Vue d'ensemble

```
academic.classrooms / academic_periods / enrollments ─────────────┐   (UUID, sans FK)
results.period_states / deliberations / decisions / appreciations │
attendance (getClassroomAttendanceSummary)                        │
schoollife (getClassroomLifeSummary)                              ▼
                                                    councils.councils ─< participants (rôle, présence, fonction)
                                                         │          ─< agenda_items (élève + instantané de faits hashé)
                                                         │          ─< proposals (suggestion de règle | proposition humaine)
                                                         │          ─< decisions (acte humain : décideur présent et habilité)
                                                         │          ─< effects (propagation idempotente : results, academic, orientation, people)
                                                         │          ─< minutes (PV : snapshot immuable + hash) ─< minute_signatures
                                                         │          ─< unlock_requests (déverrouillage motivé) ; events (journal)
        données : participant_roles, council_types, decision_types, settings
                                                         └─ orientation_paths (parcours autorisés, VIDE par défaut)
                                                            orientation_files ─< orientation_wishes ; series_transfers

schoollife.incidents ─< incident_involvements          schoollife.measures (sanction | avertissement | exclusion temporaire)
        │                                                    ├─< measure_appeals (recours)        ┌ conduct_scales ─< conduct_scale_items
        └──────────────────────────────────────────────────  └─ conduct_movements (registre) ─────┘   (barème = PARAMÈTRE)
schoollife.notes (encouragement, observation) ; convocations (tuteurs, via messaging) ;
        life_events (historique auto) ; confidential_reads (lectures confidentielles)
        données : settings, severity_levels, event_types

stateassign.assignments (versionné) ─< controls ; documents (références) ; assignment_events ; settings
        ⇄ finance (bourse, factures liées, créances) par UUID ; ⇄ academic (type de financement, référence) par port
```

## 3. Catalogue des tables

| Schéma | Table | Rôle | Cardinalité indicative (établissement de 1 500 élèves) |
|---|---|---|---|
| `councils` | `participant_roles`, `council_types`, `decision_types`, `settings` | Référentiels et réglages (données) | < 50 lignes chacun |
| | `councils` | Une séance par classe, type et période | 30 classes × (3 périodes + 1 bilan) ≈ 120 / an |
| | `participants` | Présents et convoqués, nom figé | ≈ 8 par séance |
| | `agenda_items` | Un élève de la classe + instantané de faits (JSON, hash) | 1 500 × 4 = 6 000 / an |
| | `proposals` | Suggestions de règles et propositions humaines | ≈ 3 par élève et séance |
| | `decisions` | Décisions enregistrées par un humain | ≈ 1 par élève et séance |
| | `effects` | File de propagation (une par décision et nature) | ≈ 2 par décision |
| | `minutes`, `minute_signatures` | PV versionné et signatures datées | 1-2 PV par séance ; 2-4 signatures |
| | `unlock_requests`, `events` | Déverrouillages motivés ; journal | rares ; ≈ 8 événements par séance |
| | `orientation_paths` | Parcours autorisés (données) | 0 à 100 |
| | `orientation_files`, `orientation_wishes`, `series_transfers` | Dossier d'orientation, vœux, transferts de série | ≈ 1 dossier par élève de fin de cycle |
| `schoollife` | `settings`, `severity_levels`, `event_types` | Paramètres (données) | < 100 |
| | `conduct_scales`, `conduct_scale_items` | Barèmes de points de conduite | 0 à 10 barèmes |
| | `incidents`, `incident_involvements` | Faits signalés | 1 000 à 5 000 / an |
| | `measures`, `measure_appeals` | Sanctions, avertissements, exclusions temporaires, recours | 500 à 3 000 / an |
| | `notes` | Encouragements et observations | 2 000 à 10 000 / an |
| | `convocations` | Convocations des tuteurs | 200 à 1 500 / an |
| | `conduct_movements` | Registre des points | 1 par mesure ou encouragement valorisé |
| | `life_events`, `confidential_reads` | Historique et lectures confidentielles | ≈ 3 lignes par événement ; lectures auditées |
| `stateassign` | `settings` | Réglages d'établissement | 1 par établissement |
| | `assignments` | Dossiers d'affectation (versionnés) | 0 à 100 % des élèves selon l'établissement |
| | `controls`, `documents`, `assignment_events` | Contrôles, références de pièces, historique | ≈ 3 contrôles par an et par dossier |

## 4. Les décisions de modélisation à connaître

1. **Composition, pas duplication : `councils` ne possède aucun résultat, aucune absence, aucune note.** Il LIT `results` (moyennes, rangs, mentions, suggestions de décision, appréciations de matière), `attendance` (récapitulatifs) et `schoollife` (synthèse) et en garde un **instantané figé** par élève et par séance (`agenda_items.facts`, `facts_hash`, `facts_version`). Une décision est prise sur une version connue de l'instantané (`decisions.facts_version`) ; reconstruire l'instantané est interdit dès qu'une décision en dépend.
2. **Source de vérité des décisions.** Le conseil est le lieu de la décision **humaine** (`councils.decisions` : décideur présent et habilité, mode consensus / vote, justification d'un écart avec la suggestion). Les familles `PASSAGE` et `REPEAT` sont **propagées** à `results.decisions` (portée année) par l'effet `RESULTS_DECISION` : c'est `results` qui reste l'unique source lue par `academic` (reconduction), `reportcards` et `higher`. Les autres familles (orientation, réorientation, exclusion, avis requis, autre) n'ont pas de code dans les contrats de règles : elles restent dans `councils` et alimentent leurs effets propres. **Les appréciations** (matière, générale du conseil) restent dans `results.appreciations` (copiées dans le snapshot de bulletin par 013) : le conseil en écrit la version « conseil » par le port, il n'en possède pas de copie vivante.
3. **L'application ne décide jamais seule.** Trois verrous : (a) `proposals.origin = 'RULE_SUGGESTION'` n'a pas d'auteur humain et **ne devient jamais « acceptée » sans `resolved_by`** ; (b) `decisions` exige un utilisateur de session (acteur `user`), un décideur participant `PRESENT` dont le rôle a `can_decide` ; (c) les effets d'une décision d'exclusion naissent `AWAITING_HUMAN` et ne passent `APPLIED` que par un humain (`applied_by` posé par la base).
4. **Verrouillage = clôture de séance.** `CLOSED` et `SIGNED` verrouillent participants, ordre du jour, propositions, décisions. Le **déverrouillage** (`CLOSED|SIGNED → OPEN`) exige une demande motivée (≥ 20 caractères) **approuvée** (par une autre personne si le réglage l'exige), **consommée** par une seule réouverture, sans effet appliqué restant ; le PV précédent passe `SUPERSEDED` et la reclôture crée la version n+1.
5. **PV = snapshot immuable.** `councils.minutes.snapshot` (schéma `council-minutes/1` : chaînes, entiers, booléens, null) est scellé par un hash **calculé par la base** (`councils.minutes_hash`, SHA-256 du texte `jsonb`) ; les signatures portent ce hash ; quand tous les signataires exigés par le type de conseil (fonctions et rôles, présents) ont signé, la base passe PV et séance à `SIGNED`. Le PDF est rendu par le worker depuis le snapshot (013, port `DocumentRenderer`, type de document `COUNCIL_MINUTES` à enregistrer).
6. **Vie scolaire : le type porte le circuit.** `event_types` (données) fixe, par type, la validation, la séparation des tâches, la visibilité aux familles, la confidentialité plancher, l'éventuel recours ; la **famille** (`kind`) reste une énumération car elle pilote les tables. Une exclusion temporaire exige toujours une validation (contrainte). Les retards et absences ne sont pas recopiés : `attendance` reste la source.
7. **Barèmes de points de conduite = paramètres versionnés.** Un barème (`conduct_scales`) se crée en brouillon, s'active avec ses valeurs (`conduct_scale_items`) puis ne change plus ; un seul barème actif par établissement, niveau et période d'effet (contrainte d'exclusion). Le **solde se dérive** (`schoollife.conduct_balance`) du barème et du registre en ajout seul (`conduct_movements`) ; chaque mouvement doit égaler la valeur du barème pour le type de l'événement source. Aucun barème n'est livré ; le jeu de démonstration est marqué `source_kind = 'placeholder'`.
8. **Orientation : des parcours en données.** Séries, options et langues sont des programmes, nœuds `GROUP` et matières d'`academic` : **rien n'est figé ici**. `orientation_paths` (vide par défaut) dit quels passages sont autorisés ; un transfert hors parcours exige une dérogation motivée (≥ 20 caractères) de l'utilisateur de la session ; un transfert n'existe que par une décision humaine (décision du conseil dont la cible correspond, ou acte de la direction avec référence).
9. **Affectation par l'État : un dossier versionné, vérifié par un humain.** `stateassign.assignments` porte la référence, l'autorité, les montants **déclarés** par l'acte ; `finance` porte les montants **facturés**. Le **statut de rapprochement est calculé par la base** à partir des écarts et de la tolérance d'établissement. Un avenant = remplacer (SUPERSEDED, motif, date) puis créer la version n+1. `source` et `external_payload_hash` sont le point d'ancrage de la future intégration officielle derrière un port.

## 5. DDL de référence

### 5.1 `councils` — référentiels

<!-- migration: 1800_councils_reference.sql -->
```sql
-- =============================================================================
-- 1800 — Module councils : schéma et référentiels du conseil de classe
-- =============================================================================
--
-- Plage de numéros proposée au module councils : 1800–1899 (numéros GLOBAUX, voir
-- docs/architecture/module-conventions.md ; la plage définitive est attribuée par
-- `pnpm module:new` dans l'ordre de création).
--
-- Règles (module-conventions.md, ADR-002/006/007) :
--   - un module = un schéma (`councils`) ; AUCUNE clé étrangère vers le schéma d'un autre module,
--     sauf `kernel.tenants(id)`. Les références vers `academic` (classe, période, inscription,
--     programme, niveau), `people` (élève, personnel, personne), `results` (état de période,
--     délibération), `messaging` sont des UUID vérifiés par des PORTS ;
--   - toute table : `tenant_id uuid NOT NULL REFERENCES kernel.tenants(id)`, puis
--     `kernel.enable_tenant_rls()`, puis GRANT explicite à `app_user` ;
--   - clés étrangères internes COMPOSITES (tenant_id, id) ;
--   - AUCUNE règle réglementaire : types de conseil, rôles de participants, quorum, types de
--     décision sont de la DONNÉE (modèle de pack ou établissement). Toutes les valeurs numériques
--     (quorum, seuils) sont NULLables : NULL = pas de contrôle, jamais une valeur « officielle »
--     devinée.
--
-- Exécutée sous `SET ROLE migrator` par le runner.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS councils;
REVOKE ALL ON SCHEMA councils FROM PUBLIC;
GRANT USAGE ON SCHEMA councils TO app_user;

-- -----------------------------------------------------------------------------
-- Gardes communes
-- -----------------------------------------------------------------------------
CREATE FUNCTION councils.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'councils.immutable: % est immuable (% interdit)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;

-- L'application ne décide JAMAIS seule d'un acte réglementaire : une décision, une résolution de
-- proposition ou une signature exige une session d'UTILISATEUR (acteur 'user' avec identifiant).
-- Un job, une règle ou une opération système (acteur 'system') est refusé par la base elle-même.
CREATE FUNCTION councils.require_human_actor() RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_user uuid := kernel.current_user_id();
BEGIN
  IF v_user IS NULL OR coalesce(kernel.current_actor(), '') <> 'user' THEN
    RAISE EXCEPTION 'councils.human_decision_required: cet acte exige un utilisateur identifié (acteur % )', coalesce(kernel.current_actor(), 'inconnu')
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN v_user;
END
$$;

-- -----------------------------------------------------------------------------
-- Rôles de participant (président, secrétaire, professeur principal, délégués…) : DONNÉES.
--   can_decide : peut être le « décideur » d'une décision du conseil (porte la responsabilité).
--   is_external : n'est pas un membre du personnel (délégué des parents, des élèves…).
-- -----------------------------------------------------------------------------
CREATE TABLE councils.participant_roles (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  code              text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label             text NOT NULL CHECK (length(btrim(label)) > 0),
  is_voting         boolean NOT NULL DEFAULT true,
  counts_for_quorum boolean NOT NULL DEFAULT true,
  may_sign          boolean NOT NULL DEFAULT true,
  can_decide        boolean NOT NULL DEFAULT false,
  is_external       boolean NOT NULL DEFAULT false,
  sort_order        integer NOT NULL DEFAULT 0,
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('councils.participant_roles');
GRANT SELECT, INSERT, UPDATE ON councils.participant_roles TO app_user;

-- -----------------------------------------------------------------------------
-- Types de conseil (conseil de période, conseil de fin d'année, conseil exceptionnel…).
--   scope                     PERIOD : rattaché à une période ; YEAR : bilan de fin d'année
--   min_results_status        état minimal de `results` pour ouvrir le conseil (le conseil délibère
--                             sur des résultats au moins verrouillés par défaut)
--   min_participants          quorum (nombre de présents comptant pour le quorum) ; NULL = aucun contrôle
--   required_role_codes       rôles qui doivent être représentés (au moins un PRÉSENT chacun) ; vide = aucun contrôle
--   signer_functions / signer_role_codes   qui doit signer le procès-verbal (au moins un signataire exigé)
--   requires_decision_per_student   la séance ne peut être close que si chaque élève a une décision
-- Aucune valeur par défaut « officielle » : les valeurs viennent du modèle de pack ou de l'établissement.
-- -----------------------------------------------------------------------------
CREATE TABLE councils.council_types (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  code                text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label               text NOT NULL CHECK (length(btrim(label)) > 0),
  scope               text NOT NULL CHECK (scope IN ('PERIOD', 'YEAR')),
  min_results_status  text NOT NULL DEFAULT 'GRADING_LOCKED' CHECK (min_results_status IN ('OPEN', 'GRADING_LOCKED')),
  min_participants    integer CHECK (min_participants IS NULL OR min_participants > 0),
  required_role_codes text[] NOT NULL DEFAULT '{}',
  signer_functions    text[] NOT NULL DEFAULT '{PRESIDENT,SECRETARY}'
                      CHECK (signer_functions <@ ARRAY['PRESIDENT', 'SECRETARY']::text[]),
  signer_role_codes   text[] NOT NULL DEFAULT '{}',
  requires_decision_per_student boolean NOT NULL DEFAULT false,
  sort_order          integer NOT NULL DEFAULT 0,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  -- Un procès-verbal sans aucun signataire exigé n'aurait aucune valeur : au moins une fonction ou un rôle.
  CHECK (cardinality(signer_functions) + cardinality(signer_role_codes) >= 1)
);
SELECT kernel.enable_tenant_rls('councils.council_types');
GRANT SELECT, INSERT, UPDATE ON councils.council_types TO app_user;

-- -----------------------------------------------------------------------------
-- Types de décision (passage, redoublement, orientation, réorientation, exclusion, avis requis,
-- autre) : la FAMILLE pilote les effets, le CODE et le libellé sont des données.
--   exclusive_group           deux décisions du même groupe ne coexistent pas pour un élève
--                             (ex. 'YEAR_OUTCOME' pour passage / redoublement / orientation)
--   results_decision_kind / results_final_code
--                             correspondance vers `results.decisions` (familles PASSAGE et REPEAT
--                             seulement) : le code final DOIT être permis par le contrat de règles
--                             (contrôlé par `results`, pas ici)
--   academic_outcome_code     issue d'inscription à enregistrer dans `academic` (`enrollment_outcomes.code`)
--   needs_human_application   l'effet est une DEMANDE à traiter par un humain habilité (exclusion) :
--                             jamais appliqué automatiquement
-- -----------------------------------------------------------------------------
CREATE TABLE councils.decision_types (
  id                     uuid PRIMARY KEY,
  tenant_id              uuid NOT NULL REFERENCES kernel.tenants (id),
  code                   text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label                  text NOT NULL CHECK (length(btrim(label)) > 0),
  family                 text NOT NULL CHECK (family IN ('PASSAGE', 'REPEAT', 'ORIENTATION', 'REORIENTATION', 'EXCLUSION', 'REQUIRED_OPINION', 'OTHER')),
  applies_to             text NOT NULL DEFAULT 'YEAR' CHECK (applies_to IN ('PERIOD', 'YEAR', 'BOTH')),
  exclusive_group        text CHECK (exclusive_group IS NULL OR exclusive_group ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  requires_justification boolean NOT NULL DEFAULT false,
  requires_vote          boolean NOT NULL DEFAULT false,
  requires_target        boolean NOT NULL DEFAULT false,
  results_decision_kind  text CHECK (results_decision_kind IS NULL OR results_decision_kind ~ '^[A-Z][A-Z0-9_]{1,40}$'),
  results_final_code     text CHECK (results_final_code IS NULL OR results_final_code ~ '^[A-Z][A-Z0-9_]{1,40}$'),
  academic_outcome_code  text CHECK (academic_outcome_code IS NULL OR academic_outcome_code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  needs_human_application boolean NOT NULL DEFAULT false,
  is_system              boolean NOT NULL DEFAULT false,
  sort_order             integer NOT NULL DEFAULT 0,
  active                 boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  CHECK ((results_decision_kind IS NULL) = (results_final_code IS NULL)),
  CHECK (results_decision_kind IS NULL OR family IN ('PASSAGE', 'REPEAT')),
  CHECK (family NOT IN ('ORIENTATION', 'REORIENTATION') OR requires_target),
  CHECK (family <> 'EXCLUSION' OR needs_human_application)
);
SELECT kernel.enable_tenant_rls('councils.decision_types');
GRANT SELECT, INSERT, UPDATE ON councils.decision_types TO app_user;

-- -----------------------------------------------------------------------------
-- Réglages par établissement (une ligne). Politiques d'établissement, pas des règles officielles.
--   require_separate_unlocker  le déverrouillage d'un conseil est approuvé par une AUTRE personne
--   effects_trigger            quand les décisions produisent leurs effets : à la clôture de séance
--                              (CLOSED) ou à la signature complète du procès-verbal (SIGNED)
--   guardian_visibility        quand une famille voit les décisions de son enfant
--   allow_quorum_waiver        ouvrir une séance sans quorum, avec motif, est possible
-- -----------------------------------------------------------------------------
CREATE TABLE councils.settings (
  tenant_id                 uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id            uuid NOT NULL,
  require_separate_unlocker boolean NOT NULL DEFAULT true,
  effects_trigger           text NOT NULL DEFAULT 'SIGNED' CHECK (effects_trigger IN ('CLOSED', 'SIGNED')),
  guardian_visibility       text NOT NULL DEFAULT 'AFTER_NOTIFICATION' CHECK (guardian_visibility IN ('NEVER', 'AFTER_SIGNATURE', 'AFTER_NOTIFICATION')),
  allow_quorum_waiver       boolean NOT NULL DEFAULT true,
  minutes_template_key      text CHECK (minutes_template_key IS NULL OR minutes_template_key ~ '^[a-z][a-z0-9-]{1,60}$'),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, institution_id)
);
SELECT kernel.enable_tenant_rls('councils.settings');
GRANT SELECT, INSERT, UPDATE ON councils.settings TO app_user;
```

### 5.2 `councils` — séances, ordre du jour, propositions, décisions, effets

<!-- migration: 1801_councils_sessions.sql -->
```sql
-- =============================================================================
-- 1801 — Module councils : séances de conseil, participants, ordre du jour, propositions,
--        décisions, effets
-- =============================================================================
--
-- Un conseil = une séance pour une classe et une période (ou un bilan de fin d'année).
--   PLANNED  -> OPEN -> CLOSED -> SIGNED ; CANCELLED depuis PLANNED/OPEN.
--   CLOSED et SIGNED sont les états VERROUILLÉS ; le déverrouillage (CLOSED|SIGNED -> OPEN) exige une
--   demande approuvée (`unlock_requests`, migration 1802) et est imposé par la base (1804).
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

-- Effets d'une décision (propagation vers results, academic, orientation, people…) : file idempotente,
-- un effet vivant par (décision, nature). 'AWAITING_HUMAN' : l'effet attend l'acte d'un humain habilité
-- (exclusion : changement de statut de l'élève).
CREATE TABLE councils.effects (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  council_id    uuid NOT NULL,
  decision_id   uuid NOT NULL,
  effect_kind   text NOT NULL CHECK (effect_kind IN ('RESULTS_DECISION', 'ENROLLMENT_OUTCOME', 'ORIENTATION_FILE', 'SERIES_TRANSFER', 'STUDENT_STATUS_REQUEST', 'NOTIFY_GUARDIANS')),
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
  CHECK (status <> 'APPLIED' OR applied_at IS NOT NULL),
  CHECK (status <> 'REVERTED' OR (reverted_at IS NOT NULL AND length(btrim(coalesce(revert_reason, ''))) >= 5))
);
SELECT kernel.enable_tenant_rls('councils.effects');
CREATE UNIQUE INDEX effects_one_live ON councils.effects (tenant_id, decision_id, effect_kind) WHERE status NOT IN ('REVERTED', 'SKIPPED');
CREATE INDEX effects_pending ON councils.effects (tenant_id, status) WHERE status IN ('PENDING', 'FAILED', 'AWAITING_HUMAN');
GRANT SELECT, INSERT, UPDATE ON councils.effects TO app_user;
```

### 5.3 `councils` — procès-verbal, signatures, déverrouillage, journal

<!-- migration: 1802_councils_minutes.sql -->
```sql
-- =============================================================================
-- 1802 — Module councils : procès-verbal (snapshot immuable), signatures datées,
--        demandes de déverrouillage, journal
-- =============================================================================
--
-- Le procès-verbal est un INSTANTANÉ (`snapshot`, schéma `council-minutes/1`) pris à la clôture de la
-- séance, scellé par un hash calculé PAR LA BASE (`councils.minutes_hash`). Le PDF est rendu dans le
-- worker depuis ce snapshot seul (spec 013, port `DocumentRenderer`). Chaque signature porte le hash
-- signé et sa date ; une fois toutes les signatures exigées recueillies, la base passe le procès-verbal
-- puis la séance à SIGNED (1804). Aucune suppression, aucune modification du contenu.
-- =============================================================================

-- Hash canonique d'un snapshot : SHA-256 du texte jsonb (ordre des clés déterministe côté Postgres).
-- Le snapshot ne contient que chaînes, entiers, booléens et null (jamais de flottant).
CREATE FUNCTION councils.minutes_hash(p_snapshot jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(p_snapshot::text, 'UTF8')), 'hex')
$$;

CREATE TABLE councils.minutes (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  council_id        uuid NOT NULL,
  version           integer NOT NULL CHECK (version >= 1),
  status            text NOT NULL DEFAULT 'GENERATED' CHECK (status IN ('GENERATED', 'SIGNED', 'SUPERSEDED', 'REVOKED')),
  schema_name       text NOT NULL DEFAULT 'council-minutes/1' CHECK (schema_name ~ '^[a-z][a-z-]*/[0-9]+$'),
  snapshot          jsonb NOT NULL,
  snapshot_hash     text NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  generated_at      timestamptz NOT NULL DEFAULT now(),
  generated_by      uuid NOT NULL,
  render_status     text NOT NULL DEFAULT 'PENDING' CHECK (render_status IN ('PENDING', 'RENDERED', 'FAILED')),
  render_object_key text,                                 -- StoragePort : PDF rendu
  render_hash       text CHECK (render_hash IS NULL OR render_hash ~ '^[0-9a-f]{64}$'),
  signed_at         timestamptz,
  supersedes_id     uuid,
  revoked_reason    text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, council_id, version),
  FOREIGN KEY (tenant_id, council_id) REFERENCES councils.councils (tenant_id, id),
  FOREIGN KEY (tenant_id, supersedes_id) REFERENCES councils.minutes (tenant_id, id),
  CHECK (status <> 'SIGNED' OR signed_at IS NOT NULL),
  CHECK (status <> 'REVOKED' OR length(btrim(coalesce(revoked_reason, ''))) >= 10),
  CHECK (render_status <> 'RENDERED' OR (render_object_key IS NOT NULL AND render_hash IS NOT NULL))
);
SELECT kernel.enable_tenant_rls('councils.minutes');
-- Une seule version vivante (non remplacée, non révoquée) par séance.
CREATE UNIQUE INDEX minutes_one_live ON councils.minutes (tenant_id, council_id) WHERE status IN ('GENERATED', 'SIGNED');
CREATE INDEX minutes_by_hash ON councils.minutes (tenant_id, snapshot_hash);
GRANT SELECT, INSERT, UPDATE ON councils.minutes TO app_user;

-- Signatures datées. `signed_hash` = hash du snapshot signé (contrôlé par la base). Une signature
-- électronique est celle de l'utilisateur de la session ; une signature papier numérisée porte sa pièce.
CREATE TABLE councils.minute_signatures (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  minutes_id          uuid NOT NULL,
  participant_id      uuid NOT NULL,
  role_code           text NOT NULL,
  signer_name         text NOT NULL CHECK (length(btrim(signer_name)) > 0),
  method              text NOT NULL CHECK (method IN ('ELECTRONIC', 'SCANNED_PAPER')),
  signed_hash         text NOT NULL CHECK (signed_hash ~ '^[0-9a-f]{64}$'),
  signed_at           timestamptz NOT NULL DEFAULT now(),
  signed_by_user      uuid NOT NULL,
  evidence_object_key text,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, minutes_id, participant_id),
  FOREIGN KEY (tenant_id, minutes_id) REFERENCES councils.minutes (tenant_id, id),
  FOREIGN KEY (tenant_id, participant_id) REFERENCES councils.participants (tenant_id, id),
  CHECK (method <> 'SCANNED_PAPER' OR evidence_object_key IS NOT NULL)
);
SELECT kernel.enable_tenant_rls('councils.minute_signatures');
GRANT SELECT, INSERT ON councils.minute_signatures TO app_user;          -- append-only

-- Demandes de déverrouillage : motivées, approuvées (par une autre personne si le réglage l'exige),
-- consommées par UNE réouverture.
CREATE TABLE councils.unlock_requests (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  council_id       uuid NOT NULL,
  requested_by     uuid NOT NULL,
  requested_by_name text NOT NULL,
  requested_at     timestamptz NOT NULL DEFAULT now(),
  reason           text NOT NULL CHECK (length(btrim(reason)) >= 20),
  status           text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'APPROVED', 'REJECTED', 'CONSUMED', 'EXPIRED')),
  decided_by       uuid,
  decided_by_name  text,
  decided_at       timestamptz,
  decision_note    text,
  four_eyes_waived boolean NOT NULL DEFAULT false,
  consumed_at      timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, council_id) REFERENCES councils.councils (tenant_id, id),
  CHECK (status = 'REQUESTED' OR status = 'EXPIRED' OR decided_by IS NOT NULL),
  CHECK (decided_by IS NULL OR four_eyes_waived OR decided_by <> requested_by),
  CHECK (status <> 'CONSUMED' OR consumed_at IS NOT NULL)
);
SELECT kernel.enable_tenant_rls('councils.unlock_requests');
CREATE UNIQUE INDEX unlock_requests_one_open ON councils.unlock_requests (tenant_id, council_id) WHERE status IN ('REQUESTED', 'APPROVED');
GRANT SELECT, INSERT, UPDATE ON councils.unlock_requests TO app_user;

-- Journal de la séance (append-only) : transitions, convocations, quorum, signatures, effets…
CREATE TABLE councils.events (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES kernel.tenants (id),
  council_id  uuid NOT NULL,
  kind        text NOT NULL CHECK (kind ~ '^[A-Z][A-Z0-9_]{1,40}$'),
  actor_id    uuid,
  actor_kind  text CHECK (actor_kind IS NULL OR actor_kind IN ('user', 'system', 'superAdmin')),
  reason      text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, council_id) REFERENCES councils.councils (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('councils.events');
CREATE INDEX events_by_council ON councils.events (tenant_id, council_id, occurred_at);
GRANT SELECT, INSERT ON councils.events TO app_user;                      -- append-only
```

### 5.4 `councils` — orientation et passage d'une série à l'autre

<!-- migration: 1803_councils_orientation.sql -->
```sql
-- =============================================================================
-- 1803 — Module councils : orientation, réorientation, passage d'une série à l'autre
-- =============================================================================
--
-- Les séries, options et langues sont des DONNÉES de `academic` (programmes enfants d'un programme
-- « lycée », nœuds GROUP à choix {min,max}, matières du catalogue) : ce module n'en fige aucune.
-- Il ajoute ce qui MANQUE : (1) les parcours AUTORISÉS d'une série/niveau vers une autre
-- (`orientation_paths`, donnée de l'établissement ou du pack, VIDE par défaut : aucun parcours
-- officiel n'est inventé) ; (2) le dossier d'orientation d'un élève avec les vœux de la famille ;
-- (3) le transfert de série, qui n'existe que par une décision HUMAINE (décision du conseil ou
-- acte de la direction), appliqué à `academic` par un port.
-- =============================================================================

CREATE TABLE councils.orientation_paths (
  id                        uuid PRIMARY KEY,
  tenant_id                 uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id            uuid,                         -- NULL = tout l'établissement du tenant
  kind                      text NOT NULL CHECK (kind IN ('ORIENTATION', 'REORIENTATION', 'SERIES_CHANGE')),
  from_program_id           uuid,                         -- academic.programs.id ; NULL = toute série de départ
  from_grade_level_id       uuid NOT NULL,                -- academic.grade_levels.id
  to_program_id             uuid NOT NULL,
  to_grade_level_id         uuid NOT NULL,
  label                     text,
  requires_council_opinion  boolean NOT NULL DEFAULT true,
  requires_guardian_consent boolean NOT NULL DEFAULT false,
  active                    boolean NOT NULL DEFAULT true,
  source_kind               text NOT NULL DEFAULT 'institution' CHECK (source_kind IN ('regulation', 'institution', 'placeholder')),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('councils.orientation_paths');
CREATE UNIQUE INDEX orientation_paths_uq ON councils.orientation_paths
  (tenant_id, coalesce(institution_id, '00000000-0000-0000-0000-000000000000'::uuid), kind,
   coalesce(from_program_id, '00000000-0000-0000-0000-000000000000'::uuid), from_grade_level_id, to_program_id, to_grade_level_id);
GRANT SELECT, INSERT, UPDATE ON councils.orientation_paths TO app_user;

-- Dossier d'orientation : un par inscription.
--   guardian_consent : exigé ou non par le parcours retenu (donnée du parcours).
CREATE TABLE councils.orientation_files (
  id                    uuid PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id        uuid NOT NULL,
  academic_year_id      uuid NOT NULL,
  enrollment_id         uuid NOT NULL,                    -- academic.enrollments.id
  student_id            uuid NOT NULL,
  current_program_id    uuid NOT NULL,
  current_grade_level_id uuid NOT NULL,
  status                text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'WISHES_COLLECTED', 'PROPOSED', 'DECIDED', 'APPLIED', 'CLOSED', 'CANCELLED')),
  guardian_consent      text NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (guardian_consent IN ('NOT_REQUIRED', 'PENDING', 'GIVEN', 'REFUSED')),
  consent_recorded_by   uuid,
  consent_recorded_at   timestamptz,
  decision_id           uuid,                             -- décision du conseil retenue
  notes                 text,
  created_by            uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, enrollment_id),
  FOREIGN KEY (tenant_id, decision_id) REFERENCES councils.decisions (tenant_id, id),
  CHECK (guardian_consent NOT IN ('GIVEN', 'REFUSED') OR (consent_recorded_by IS NOT NULL AND consent_recorded_at IS NOT NULL)),
  CHECK (status NOT IN ('DECIDED', 'APPLIED') OR decision_id IS NOT NULL)
);
SELECT kernel.enable_tenant_rls('councils.orientation_files');
CREATE INDEX orientation_files_by_year ON councils.orientation_files (tenant_id, academic_year_id, institution_id, status);
GRANT SELECT, INSERT, UPDATE ON councils.orientation_files TO app_user;

-- Vœux (par ordre de préférence) ; les options choisies (langue vivante, option…) sont des identifiants
-- de matières / nœuds `academic`, jamais des libellés.
CREATE TABLE councils.orientation_wishes (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  file_id           uuid NOT NULL,
  rank              integer NOT NULL CHECK (rank >= 1),
  to_program_id     uuid NOT NULL,
  to_grade_level_id uuid NOT NULL,
  option_ids        jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(option_ids) = 'array'),
  source            text NOT NULL CHECK (source IN ('GUARDIAN', 'STUDENT', 'STAFF', 'COUNSELLOR')),
  expressed_by      uuid NOT NULL,
  expressed_at      timestamptz NOT NULL DEFAULT now(),
  comment           text,
  withdrawn_at      timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, file_id) REFERENCES councils.orientation_files (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('councils.orientation_wishes');
CREATE UNIQUE INDEX orientation_wishes_rank ON councils.orientation_wishes (tenant_id, file_id, rank) WHERE withdrawn_at IS NULL;
GRANT SELECT, INSERT, UPDATE ON councils.orientation_wishes TO app_user;

-- Transfert de série (passage d'une série à l'autre). Il n'existe que par une DÉCISION HUMAINE :
--   decided_via = 'COUNCIL'       -> `decision_id` (décision du conseil) obligatoire ;
--   decided_via = 'DIRECTOR_ACT'  -> `act_reference` obligatoire (acte de la direction hors séance).
-- Le parcours doit exister dans `orientation_paths`, sinon dérogation motivée (>= 20 caractères) par un
-- utilisateur ; contrôlé par la base (1804).
CREATE TABLE councils.series_transfers (
  id                    uuid PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id        uuid NOT NULL,
  enrollment_id         uuid NOT NULL,
  student_id            uuid NOT NULL,
  from_program_id       uuid NOT NULL,
  from_grade_level_id   uuid NOT NULL,
  to_program_id         uuid NOT NULL,
  to_grade_level_id     uuid NOT NULL,
  effective_kind        text NOT NULL CHECK (effective_kind IN ('NEXT_YEAR', 'MID_YEAR')),
  effective_on          date,
  decided_via           text NOT NULL CHECK (decided_via IN ('COUNCIL', 'DIRECTOR_ACT')),
  decision_id           uuid,
  act_reference         text,
  act_issued_by         uuid,
  path_id               uuid,
  path_override_reason  text,
  path_override_by      uuid,
  status                text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'APPLIED', 'CANCELLED', 'FAILED')),
  applied_at            timestamptz,
  applied_ref           uuid,                             -- academic : placement ou inscription créé(e)
  last_error            text,
  cancel_reason         text,
  created_by            uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, decision_id) REFERENCES councils.decisions (tenant_id, id),
  FOREIGN KEY (tenant_id, path_id) REFERENCES councils.orientation_paths (tenant_id, id),
  CHECK ((decided_via = 'COUNCIL') = (decision_id IS NOT NULL)),
  CHECK ((decided_via = 'DIRECTOR_ACT') = (act_reference IS NOT NULL AND act_issued_by IS NOT NULL)),
  CHECK (effective_kind <> 'MID_YEAR' OR effective_on IS NOT NULL),
  CHECK (path_id IS NOT NULL OR length(btrim(coalesce(path_override_reason, ''))) >= 20),
  CHECK (path_override_reason IS NULL OR path_override_by IS NOT NULL),
  CHECK (status <> 'APPLIED' OR (applied_at IS NOT NULL AND applied_ref IS NOT NULL)),
  CHECK (status <> 'CANCELLED' OR length(btrim(coalesce(cancel_reason, ''))) >= 5),
  CHECK (from_program_id <> to_program_id OR from_grade_level_id <> to_grade_level_id)
);
SELECT kernel.enable_tenant_rls('councils.series_transfers');
-- Un transfert vivant par inscription.
CREATE UNIQUE INDEX series_transfers_one_live ON councils.series_transfers (tenant_id, enrollment_id) WHERE status IN ('PLANNED', 'APPLIED');
CREATE INDEX series_transfers_by_student ON councils.series_transfers (tenant_id, student_id);
GRANT SELECT, INSERT, UPDATE ON councils.series_transfers TO app_user;
```

### 5.5 `councils` — invariants imposés par la base

<!-- migration: 1804_councils_guards.sql -->
```sql
-- =============================================================================
-- 1804 — Module councils : invariants imposés par la base
-- =============================================================================
--
-- Défense en profondeur (même esprit que academic/0704, results/1203) : le domaine TypeScript applique
-- ces règles, la base les IMPOSE — un bug applicatif ou une requête manuelle ne peut pas les contourner
-- (valables aussi pour un superutilisateur : ce sont des déclencheurs, pas des droits).
--
--   1. l'application ne décide JAMAIS seule : décision, résolution de proposition, signature, ouverture,
--      clôture, déverrouillage exigent une session d'UTILISATEUR identifié (`require_human_actor`) ;
--   2. machine à états de la séance, quorum et président imposés à l'ouverture ;
--   3. séance verrouillée (CLOSED, SIGNED) : plus aucune écriture sur participants, ordre du jour,
--      propositions, décisions ; déverrouillage = demande motivée APPROUVÉE, consommée une fois ;
--   4. décisions : décideur PRÉSENT et habilité, justification d'écart, groupe exclusif, instantané
--      de faits référencé ; propositions de règles jamais acceptées sans humain ;
--   5. procès-verbal : snapshot immuable, hash calculé par la base, signatures datées sur CE hash,
--      passage automatique à SIGNED quand tous les signataires exigés ont signé ;
--   6. effets : file idempotente ; effets d'exclusion = demande à traiter par un humain ;
--   7. journal de séance en ajout seul.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Calculs de séance (lecture seule)
-- -----------------------------------------------------------------------------
CREATE FUNCTION councils.check_quorum(
  p_council uuid,
  OUT met boolean, OUT present_count integer, OUT required_min integer,
  OUT missing_roles text[], OUT president_present boolean
) LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_type councils.council_types%ROWTYPE;
BEGIN
  SELECT t.* INTO v_type
    FROM councils.councils c
    JOIN councils.council_types t ON t.tenant_id = c.tenant_id AND t.id = c.council_type_id
   WHERE c.id = p_council;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'councils.not_found: conseil introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT count(*)::integer INTO present_count
    FROM councils.participants p
    JOIN councils.participant_roles r ON r.tenant_id = p.tenant_id AND r.code = p.role_code
   WHERE p.council_id = p_council AND p.presence = 'PRESENT' AND r.counts_for_quorum;
  required_min := v_type.min_participants;
  SELECT coalesce(array_agg(rc ORDER BY rc), '{}'::text[]) INTO missing_roles
    FROM unnest(v_type.required_role_codes) AS rc
   WHERE NOT EXISTS (SELECT 1 FROM councils.participants p
                      WHERE p.council_id = p_council AND p.role_code = rc AND p.presence = 'PRESENT');
  president_present := EXISTS (SELECT 1 FROM councils.participants p
                                WHERE p.council_id = p_council AND p.council_function = 'PRESIDENT' AND p.presence = 'PRESENT');
  met := (required_min IS NULL OR present_count >= required_min) AND cardinality(missing_roles) = 0;
END
$$;

-- Participants PRÉSENTS dont la signature du procès-verbal est exigée (fonctions et rôles du type de conseil).
CREATE FUNCTION councils.required_signers(p_council uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE AS $$
  SELECT p.id
    FROM councils.councils c
    JOIN councils.council_types t ON t.tenant_id = c.tenant_id AND t.id = c.council_type_id
    JOIN councils.participants p ON p.tenant_id = c.tenant_id AND p.council_id = c.id
   WHERE c.id = p_council AND p.presence = 'PRESENT'
     AND (p.council_function = ANY (t.signer_functions) OR p.role_code = ANY (t.signer_role_codes))
$$;

CREATE FUNCTION councils.missing_signers(p_minutes uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE AS $$
  SELECT s
    FROM councils.minutes m, LATERAL councils.required_signers(m.council_id) AS s
   WHERE m.id = p_minutes
     AND NOT EXISTS (SELECT 1 FROM councils.minute_signatures g WHERE g.minutes_id = m.id AND g.participant_id = s)
$$;

-- Un effet est-il une application qui exige un humain ? (décision dont le type `needs_human_application`)
CREATE FUNCTION councils.effect_needs_human(p_tenant uuid, p_decision uuid, p_kind text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT p_kind <> 'NOTIFY_GUARDIANS' AND coalesce(
    (SELECT t.needs_human_application
       FROM councils.decisions d
       JOIN councils.decision_types t ON t.tenant_id = d.tenant_id AND t.id = d.decision_type_id
      WHERE d.tenant_id = p_tenant AND d.id = p_decision), false)
$$;

-- -----------------------------------------------------------------------------
-- Séance : machine à états, quorum, verrouillage, déverrouillage motivé
-- -----------------------------------------------------------------------------
CREATE FUNCTION councils.councils_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_type councils.council_types%ROWTYPE;
  v_set  councils.settings%ROWTYPE;
  v_req  councils.unlock_requests%ROWTYPE;
  q      record;
  v_n    integer;
BEGIN
  SELECT * INTO v_type FROM councils.council_types WHERE tenant_id = NEW.tenant_id AND id = NEW.council_type_id;
  IF NEW.scope <> v_type.scope THEN
    RAISE EXCEPTION 'councils.scope_mismatch: le type % est de portée % (conseil : %)', v_type.code, v_type.scope, NEW.scope
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_set FROM councils.settings WHERE tenant_id = NEW.tenant_id AND institution_id = NEW.institution_id;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PLANNED' THEN
      RAISE EXCEPTION 'councils.initial_status: un conseil se crée PLANNED' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT v_type.active THEN
      RAISE EXCEPTION 'councils.type_inactive: le type de conseil % est désactivé', v_type.code USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.institution_id <> OLD.institution_id OR NEW.academic_year_id <> OLD.academic_year_id
     OR NEW.classroom_id <> OLD.classroom_id OR NEW.academic_period_id IS DISTINCT FROM OLD.academic_period_id
     OR NEW.council_type_id <> OLD.council_type_id OR NEW.scope <> OLD.scope THEN
    RAISE EXCEPTION 'councils.identity_immutable: établissement, année, classe, période et type d''un conseil sont figés'
      USING ERRCODE = 'restrict_violation';
  END IF;
  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := now();

  IF NEW.status = OLD.status THEN
    IF OLD.status IN ('CLOSED', 'SIGNED', 'CANCELLED')
       AND (to_jsonb(NEW) - 'row_version' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'row_version' - 'updated_at') THEN
      RAISE EXCEPTION 'councils.locked: la séance (%) est verrouillée', OLD.status USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT ((OLD.status, NEW.status) IN (
        ('PLANNED', 'OPEN'), ('PLANNED', 'CANCELLED'), ('OPEN', 'CLOSED'), ('OPEN', 'CANCELLED'),
        ('CLOSED', 'SIGNED'), ('CLOSED', 'OPEN'), ('SIGNED', 'OPEN'))) THEN
    RAISE EXCEPTION 'councils.transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status = 'PLANNED' AND NEW.status = 'OPEN' THEN
    NEW.opened_by := councils.require_human_actor();
    NEW.opened_at := now();
    SELECT * INTO q FROM councils.check_quorum(NEW.id);
    IF NOT q.president_present THEN
      RAISE EXCEPTION 'councils.president_required: un président PRÉSENT est nécessaire pour ouvrir la séance' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT q.met THEN
      IF NOT NEW.quorum_waived THEN
        RAISE EXCEPTION 'councils.quorum_not_met: % présent(s) pour un quorum de % ; rôles manquants : %',
          q.present_count, coalesce(q.required_min::text, 'aucun'), coalesce(array_to_string(q.missing_roles, ','), '-')
          USING ERRCODE = 'check_violation';
      END IF;
      IF v_set.tenant_id IS NOT NULL AND NOT v_set.allow_quorum_waiver THEN
        RAISE EXCEPTION 'councils.quorum_waiver_forbidden: l''établissement n''autorise pas l''ouverture sans quorum' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  ELSIF OLD.status = 'OPEN' AND NEW.status = 'CLOSED' THEN
    NEW.closed_by := councils.require_human_actor();
    NEW.closed_at := now();
    IF v_type.requires_decision_per_student THEN
      SELECT count(*) INTO v_n FROM councils.agenda_items a WHERE a.council_id = NEW.id AND a.status <> 'DECIDED';
      IF v_n > 0 THEN
        RAISE EXCEPTION 'councils.undecided_students: % élève(s) sans décision', v_n USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  ELSIF OLD.status = 'CLOSED' AND NEW.status = 'SIGNED' THEN
    IF NOT EXISTS (SELECT 1 FROM councils.minutes m WHERE m.tenant_id = NEW.tenant_id AND m.council_id = NEW.id AND m.status = 'SIGNED') THEN
      RAISE EXCEPTION 'councils.minutes_not_signed: aucun procès-verbal signé pour cette séance' USING ERRCODE = 'check_violation';
    END IF;
    NEW.signed_at := coalesce(NEW.signed_at, now());
  ELSIF OLD.status IN ('CLOSED', 'SIGNED') AND NEW.status = 'OPEN' THEN
    PERFORM councils.require_human_actor();
    SELECT * INTO v_req FROM councils.unlock_requests
     WHERE tenant_id = NEW.tenant_id AND council_id = NEW.id AND status = 'APPROVED' FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'councils.unlock_not_approved: le déverrouillage exige une demande motivée approuvée' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_req.four_eyes_waived AND coalesce(v_set.require_separate_unlocker, true) THEN
      RAISE EXCEPTION 'councils.four_eyes_required: l''approbation doit venir d''une autre personne que le demandeur' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF EXISTS (SELECT 1 FROM councils.effects e WHERE e.tenant_id = NEW.tenant_id AND e.council_id = NEW.id AND e.status = 'APPLIED') THEN
      RAISE EXCEPTION 'councils.effect_irreversible: des effets appliqués doivent d''abord être annulés (REVERTED)' USING ERRCODE = 'restrict_violation';
    END IF;
    UPDATE councils.unlock_requests SET status = 'CONSUMED', consumed_at = now() WHERE id = v_req.id;
    NEW.reopen_count := OLD.reopen_count + 1;
    NEW.closed_at := NULL;
    NEW.closed_by := NULL;
    NEW.signed_at := NULL;
  ELSIF NEW.status = 'CANCELLED' THEN
    PERFORM councils.require_human_actor();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER councils_guard BEFORE INSERT OR UPDATE ON councils.councils
  FOR EACH ROW EXECUTE FUNCTION councils.councils_guard();

-- Journal automatique + effets de bord d'une réouverture (procès-verbal remplacé, effets non appliqués écartés).
CREATE FUNCTION councils.councils_after() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_kind   text;
  v_reason text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_kind := 'CREATED';
  ELSIF NEW.status = OLD.status THEN
    RETURN NEW;
  ELSIF NEW.status = 'OPEN' AND OLD.status = 'PLANNED' THEN
    v_kind := 'OPENED';
    IF NEW.quorum_waived THEN v_reason := NEW.quorum_waiver_reason; END IF;
  ELSIF NEW.status = 'OPEN' THEN
    v_kind := 'REOPENED';
    SELECT u.reason INTO v_reason FROM councils.unlock_requests u
     WHERE u.tenant_id = NEW.tenant_id AND u.council_id = NEW.id AND u.status = 'CONSUMED'
     ORDER BY u.consumed_at DESC LIMIT 1;
    UPDATE councils.minutes SET status = 'SUPERSEDED'
     WHERE tenant_id = NEW.tenant_id AND council_id = NEW.id AND status IN ('GENERATED', 'SIGNED');
    UPDATE councils.effects SET status = 'SKIPPED', updated_at = now()
     WHERE tenant_id = NEW.tenant_id AND council_id = NEW.id AND status IN ('PENDING', 'AWAITING_HUMAN', 'FAILED');
  ELSIF NEW.status = 'CLOSED' THEN
    v_kind := 'CLOSED';
  ELSIF NEW.status = 'SIGNED' THEN
    v_kind := 'SIGNED';
  ELSIF NEW.status = 'CANCELLED' THEN
    v_kind := 'CANCELLED';
    v_reason := NEW.cancel_reason;
  END IF;
  INSERT INTO councils.events (id, tenant_id, council_id, kind, actor_id, actor_kind, reason, data)
  VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, v_kind, kernel.current_user_id(), kernel.current_actor(), v_reason,
          jsonb_build_object('status', NEW.status, 'reopenCount', NEW.reopen_count));
  RETURN NEW;
END
$$;
CREATE TRIGGER councils_after AFTER INSERT OR UPDATE ON councils.councils
  FOR EACH ROW EXECUTE FUNCTION councils.councils_after();

-- -----------------------------------------------------------------------------
-- Participants
-- -----------------------------------------------------------------------------
CREATE FUNCTION councils.participants_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_council councils.councils%ROWTYPE;
  v_role    councils.participant_roles%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT * INTO v_council FROM councils.councils WHERE tenant_id = OLD.tenant_id AND id = OLD.council_id;
    IF v_council.status <> 'PLANNED' THEN
      RAISE EXCEPTION 'councils.participants_frozen: on ne retire un participant que d''une séance planifiée' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  SELECT * INTO v_council FROM councils.councils WHERE tenant_id = NEW.tenant_id AND id = NEW.council_id;
  IF v_council.status NOT IN ('PLANNED', 'OPEN') THEN
    RAISE EXCEPTION 'councils.participants_frozen: séance %', v_council.status USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT * INTO v_role FROM councils.participant_roles WHERE tenant_id = NEW.tenant_id AND code = NEW.role_code;
  IF v_role.tenant_id IS NULL THEN
    RAISE EXCEPTION 'councils.role_unknown: rôle de participant % inconnu', NEW.role_code USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT v_role.active THEN
      RAISE EXCEPTION 'councils.role_inactive: le rôle % est désactivé', NEW.role_code USING ERRCODE = 'check_violation';
    END IF;
    NEW.is_voting := NEW.is_voting AND v_role.is_voting;
  ELSE
    IF NEW.council_id <> OLD.council_id OR NEW.role_code <> OLD.role_code OR NEW.staff_id IS DISTINCT FROM OLD.staff_id
       OR NEW.person_id IS DISTINCT FROM OLD.person_id OR NEW.display_name <> OLD.display_name THEN
      RAISE EXCEPTION 'councils.participant_identity_immutable: rôle, personne et nom d''un participant sont figés' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.presence = 'PRESENT' AND NEW.presence <> 'PRESENT' AND EXISTS (
         SELECT 1 FROM councils.decisions d
          WHERE d.tenant_id = NEW.tenant_id AND d.decider_participant_id = NEW.id AND d.status = 'RECORDED') THEN
      RAISE EXCEPTION 'councils.decider_has_decisions: ce participant est le décideur de décisions enregistrées' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF NEW.council_function = 'PRESIDENT' AND NOT v_role.can_decide THEN
    RAISE EXCEPTION 'councils.president_role: le rôle % ne peut pas présider (can_decide = false)', NEW.role_code USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER participants_guard BEFORE INSERT OR UPDATE OR DELETE ON councils.participants
  FOR EACH ROW EXECUTE FUNCTION councils.participants_guard();

-- -----------------------------------------------------------------------------
-- Ordre du jour : instantané de faits hashé par la base, figé par les décisions
-- -----------------------------------------------------------------------------
CREATE FUNCTION councils.agenda_items_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
  v_has    boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO v_status FROM councils.councils WHERE tenant_id = OLD.tenant_id AND id = OLD.council_id;
    IF v_status <> 'PLANNED' THEN
      RAISE EXCEPTION 'councils.agenda_frozen: l''ordre du jour ne se réduit qu''avant l''ouverture' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  SELECT status INTO v_status FROM councils.councils WHERE tenant_id = NEW.tenant_id AND id = NEW.council_id;
  IF v_status NOT IN ('PLANNED', 'OPEN') THEN
    RAISE EXCEPTION 'councils.agenda_frozen: séance %', v_status USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' THEN
      RAISE EXCEPTION 'councils.agenda_initial_status' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.facts <> '{}'::jsonb THEN
      NEW.facts_hash := councils.minutes_hash(NEW.facts);
      NEW.facts_version := 1;
      NEW.prepared_at := coalesce(NEW.prepared_at, now());
    ELSE
      NEW.facts_hash := NULL;
      NEW.facts_version := 0;
    END IF;
  ELSE
    IF NEW.council_id <> OLD.council_id OR NEW.enrollment_id <> OLD.enrollment_id OR NEW.student_id <> OLD.student_id THEN
      RAISE EXCEPTION 'councils.agenda_identity_immutable' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.facts IS DISTINCT FROM OLD.facts THEN
      IF EXISTS (SELECT 1 FROM councils.decisions d WHERE d.tenant_id = NEW.tenant_id AND d.agenda_item_id = NEW.id AND d.status = 'RECORDED') THEN
        RAISE EXCEPTION 'councils.facts_locked_by_decision: des décisions reposent sur cet instantané' USING ERRCODE = 'restrict_violation';
      END IF;
      NEW.facts_hash := councils.minutes_hash(NEW.facts);
      NEW.facts_version := OLD.facts_version + 1;
      NEW.prepared_at := now();
    ELSE
      NEW.facts_hash := OLD.facts_hash;
      NEW.facts_version := OLD.facts_version;
      NEW.prepared_at := OLD.prepared_at;
    END IF;
    -- DECIDED <=> au moins une décision enregistrée.
    v_has := EXISTS (SELECT 1 FROM councils.decisions d WHERE d.tenant_id = NEW.tenant_id AND d.agenda_item_id = NEW.id AND d.status = 'RECORDED');
    IF NEW.status = 'DECIDED' AND NOT v_has THEN
      RAISE EXCEPTION 'councils.no_decision: aucune décision enregistrée pour cet élève' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> 'DECIDED' AND v_has THEN
      RAISE EXCEPTION 'councils.item_has_decisions: des décisions enregistrées existent pour cet élève' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER agenda_items_guard BEFORE INSERT OR UPDATE OR DELETE ON councils.agenda_items
  FOR EACH ROW EXECUTE FUNCTION councils.agenda_items_guard();

-- -----------------------------------------------------------------------------
-- Propositions : suggestion des règles ≠ décision
-- -----------------------------------------------------------------------------
CREATE FUNCTION councils.proposals_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
  v_user   uuid;
BEGIN
  SELECT status INTO v_status FROM councils.councils WHERE tenant_id = NEW.tenant_id AND id = NEW.council_id;
  IF v_status NOT IN ('PLANNED', 'OPEN') THEN
    RAISE EXCEPTION 'councils.proposals_frozen: séance %', v_status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM councils.agenda_items a WHERE a.tenant_id = NEW.tenant_id AND a.id = NEW.agenda_item_id AND a.council_id = NEW.council_id) THEN
    RAISE EXCEPTION 'councils.item_mismatch: l''élève de l''ordre du jour n''appartient pas à cette séance' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PROPOSED' THEN
      RAISE EXCEPTION 'councils.proposal_initial_status' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.origin = 'HUMAN' THEN
      v_user := councils.require_human_actor();
      IF NEW.proposed_by <> v_user THEN
        RAISE EXCEPTION 'councils.proposer_mismatch: l''auteur doit être l''utilisateur de la session' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
  ELSE
    IF NEW.council_id <> OLD.council_id OR NEW.agenda_item_id <> OLD.agenda_item_id OR NEW.kind <> OLD.kind
       OR NEW.code IS DISTINCT FROM OLD.code OR NEW.body IS DISTINCT FROM OLD.body OR NEW.origin <> OLD.origin
       OR NEW.proposed_by IS DISTINCT FROM OLD.proposed_by OR NEW.rule_version_ref IS DISTINCT FROM OLD.rule_version_ref THEN
      RAISE EXCEPTION 'councils.proposal_immutable: le contenu d''une proposition ne change pas (en créer une nouvelle)' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status <> 'PROPOSED' THEN
      RAISE EXCEPTION 'councils.proposal_resolved: proposition déjà traitée (%)', OLD.status USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status <> OLD.status THEN
      v_user := councils.require_human_actor();
      IF NEW.resolved_by IS DISTINCT FROM v_user THEN
        RAISE EXCEPTION 'councils.resolver_mismatch: la résolution doit venir de l''utilisateur de la session' USING ERRCODE = 'insufficient_privilege';
      END IF;
      NEW.resolved_at := coalesce(NEW.resolved_at, now());
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER proposals_guard BEFORE INSERT OR UPDATE ON councils.proposals
  FOR EACH ROW EXECUTE FUNCTION councils.proposals_guard();
CREATE TRIGGER proposals_no_delete BEFORE DELETE ON councils.proposals
  FOR EACH ROW EXECUTE FUNCTION councils.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Décisions : l'acte humain
-- -----------------------------------------------------------------------------
CREATE FUNCTION councils.decisions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user    uuid;
  v_council councils.councils%ROWTYPE;
  v_item    councils.agenda_items%ROWTYPE;
  v_type    councils.decision_types%ROWTYPE;
  v_part    councils.participants%ROWTYPE;
  v_role    councils.participant_roles%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'councils.immutable: une décision ne se supprime pas (la retirer avec un motif)' USING ERRCODE = 'restrict_violation';
  END IF;
  v_user := councils.require_human_actor();
  SELECT * INTO v_council FROM councils.councils WHERE tenant_id = NEW.tenant_id AND id = NEW.council_id;
  IF v_council.status <> 'OPEN' THEN
    RAISE EXCEPTION 'councils.not_open: les décisions se prennent séance ouverte (séance %)', v_council.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.council_id <> OLD.council_id OR NEW.agenda_item_id <> OLD.agenda_item_id OR NEW.enrollment_id <> OLD.enrollment_id
       OR NEW.student_id <> OLD.student_id OR NEW.decision_type_id <> OLD.decision_type_id
       OR NEW.decision_type_code <> OLD.decision_type_code OR NEW.family <> OLD.family
       OR NEW.exclusive_group IS DISTINCT FROM OLD.exclusive_group OR NEW.suggested_code IS DISTINCT FROM OLD.suggested_code
       OR NEW.suggestion_ref IS DISTINCT FROM OLD.suggestion_ref OR NEW.differs_from_suggestion <> OLD.differs_from_suggestion
       OR NEW.justification IS DISTINCT FROM OLD.justification OR NEW.decision_mode <> OLD.decision_mode
       OR NEW.votes_for IS DISTINCT FROM OLD.votes_for OR NEW.votes_against IS DISTINCT FROM OLD.votes_against
       OR NEW.votes_abstain IS DISTINCT FROM OLD.votes_abstain
       OR NEW.target_program_id IS DISTINCT FROM OLD.target_program_id OR NEW.target_grade_level_id IS DISTINCT FROM OLD.target_grade_level_id
       OR NEW.target_label IS DISTINCT FROM OLD.target_label OR NEW.decider_participant_id <> OLD.decider_participant_id
       OR NEW.recorded_by <> OLD.recorded_by OR NEW.recorded_by_name <> OLD.recorded_by_name
       OR NEW.facts_version <> OLD.facts_version OR NEW.facts_hash IS DISTINCT FROM OLD.facts_hash
       OR NEW.decided_at <> OLD.decided_at OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id THEN
      RAISE EXCEPTION 'councils.decision_immutable: une décision enregistrée ne se modifie pas (la retirer puis en enregistrer une autre)'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status <> 'RECORDED' THEN
      RAISE EXCEPTION 'councils.decision_final: décision déjà %', OLD.status USING ERRCODE = 'restrict_violation';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- INSERT
  IF NEW.recorded_by <> v_user THEN
    RAISE EXCEPTION 'councils.recorder_mismatch: l''enregistrant doit être l''utilisateur de la session' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status <> 'RECORDED' THEN
    RAISE EXCEPTION 'councils.decision_initial_status' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_item FROM councils.agenda_items WHERE tenant_id = NEW.tenant_id AND id = NEW.agenda_item_id;
  IF v_item.council_id <> NEW.council_id OR v_item.enrollment_id <> NEW.enrollment_id OR v_item.student_id <> NEW.student_id THEN
    RAISE EXCEPTION 'councils.item_mismatch: l''élève ne correspond pas à l''ordre du jour' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_type FROM councils.decision_types WHERE tenant_id = NEW.tenant_id AND id = NEW.decision_type_id;
  IF NOT v_type.active THEN
    RAISE EXCEPTION 'councils.decision_type_inactive: type % désactivé', v_type.code USING ERRCODE = 'check_violation';
  END IF;
  IF v_type.applies_to <> 'BOTH' AND v_type.applies_to <> v_council.scope THEN
    RAISE EXCEPTION 'councils.decision_scope: le type % ne s''applique pas à un conseil de portée %', v_type.code, v_council.scope USING ERRCODE = 'check_violation';
  END IF;
  NEW.decision_type_code := v_type.code;
  NEW.family := v_type.family;
  NEW.exclusive_group := v_type.exclusive_group;

  SELECT * INTO v_part FROM councils.participants WHERE tenant_id = NEW.tenant_id AND id = NEW.decider_participant_id;
  IF v_part.council_id <> NEW.council_id OR v_part.presence <> 'PRESENT' THEN
    RAISE EXCEPTION 'councils.decider_not_present: le décideur doit être un participant PRÉSENT de la séance' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_role FROM councils.participant_roles WHERE tenant_id = NEW.tenant_id AND code = v_part.role_code;
  IF NOT v_role.can_decide THEN
    RAISE EXCEPTION 'councils.decider_not_allowed: le rôle % ne peut pas porter une décision', v_part.role_code USING ERRCODE = 'check_violation';
  END IF;
  IF v_type.requires_vote AND NEW.decision_mode <> 'VOTE' THEN
    RAISE EXCEPTION 'councils.vote_required: ce type de décision exige un vote' USING ERRCODE = 'check_violation';
  END IF;
  IF v_type.requires_justification AND length(btrim(coalesce(NEW.justification, ''))) < 10 THEN
    RAISE EXCEPTION 'councils.justification_required: ce type de décision exige une justification (10 caractères au moins)' USING ERRCODE = 'check_violation';
  END IF;
  IF v_type.requires_target AND NEW.target_grade_level_id IS NULL THEN
    RAISE EXCEPTION 'councils.target_required: ce type de décision exige une série / un niveau visé' USING ERRCODE = 'check_violation';
  END IF;
  NEW.facts_version := v_item.facts_version;
  NEW.facts_hash := v_item.facts_hash;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER decisions_guard BEFORE INSERT OR UPDATE OR DELETE ON councils.decisions
  FOR EACH ROW EXECUTE FUNCTION councils.decisions_guard();

CREATE FUNCTION councils.decisions_after() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE councils.agenda_items SET status = 'DECIDED' WHERE tenant_id = NEW.tenant_id AND id = NEW.agenda_item_id AND status <> 'DECIDED';
  ELSIF NEW.status <> OLD.status AND NOT EXISTS (
          SELECT 1 FROM councils.decisions d WHERE d.tenant_id = NEW.tenant_id AND d.agenda_item_id = NEW.agenda_item_id AND d.status = 'RECORDED') THEN
    UPDATE councils.agenda_items SET status = 'REVIEWED' WHERE tenant_id = NEW.tenant_id AND id = NEW.agenda_item_id AND status = 'DECIDED';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER decisions_after AFTER INSERT OR UPDATE ON councils.decisions
  FOR EACH ROW EXECUTE FUNCTION councils.decisions_after();

-- -----------------------------------------------------------------------------
-- Effets : file idempotente, exclusion = demande à traiter par un humain
-- -----------------------------------------------------------------------------
CREATE FUNCTION councils.effects_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_council councils.councils%ROWTYPE;
  v_dec     councils.decisions%ROWTYPE;
  v_set     councils.settings%ROWTYPE;
  v_trigger text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_council FROM councils.councils WHERE tenant_id = NEW.tenant_id AND id = NEW.council_id;
    SELECT * INTO v_dec FROM councils.decisions WHERE tenant_id = NEW.tenant_id AND id = NEW.decision_id;
    IF v_dec.council_id <> NEW.council_id OR v_dec.status <> 'RECORDED' THEN
      RAISE EXCEPTION 'councils.effect_decision: la décision doit être enregistrée dans cette séance' USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO v_set FROM councils.settings WHERE tenant_id = NEW.tenant_id AND institution_id = v_council.institution_id;
    v_trigger := coalesce(v_set.effects_trigger, 'SIGNED');
    IF (v_trigger = 'SIGNED' AND v_council.status <> 'SIGNED') OR (v_trigger = 'CLOSED' AND v_council.status NOT IN ('CLOSED', 'SIGNED')) THEN
      RAISE EXCEPTION 'councils.effects_too_early: les effets ne naissent qu''à l''état % (séance %)', v_trigger, v_council.status USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status NOT IN ('PENDING', 'AWAITING_HUMAN') THEN
      RAISE EXCEPTION 'councils.effect_initial_status' USING ERRCODE = 'check_violation';
    END IF;
    IF councils.effect_needs_human(NEW.tenant_id, NEW.decision_id, NEW.effect_kind) AND NEW.status <> 'AWAITING_HUMAN' THEN
      RAISE EXCEPTION 'councils.human_application_required: cet effet attend l''acte d''un humain habilité' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.council_id <> OLD.council_id OR NEW.decision_id <> OLD.decision_id OR NEW.effect_kind <> OLD.effect_kind THEN
    RAISE EXCEPTION 'councils.effect_identity_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  NEW.updated_at := now();
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF NOT ((OLD.status, NEW.status) IN (
        ('PENDING', 'APPLIED'), ('PENDING', 'FAILED'), ('PENDING', 'SKIPPED'),
        ('FAILED', 'PENDING'), ('FAILED', 'APPLIED'), ('FAILED', 'SKIPPED'),
        ('AWAITING_HUMAN', 'APPLIED'), ('AWAITING_HUMAN', 'SKIPPED'),
        ('APPLIED', 'REVERTED'), ('SKIPPED', 'PENDING'), ('SKIPPED', 'AWAITING_HUMAN'))) THEN
    RAISE EXCEPTION 'councils.effect_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status = 'REVERTED' AND OLD.irreversible THEN
    RAISE EXCEPTION 'councils.effect_irreversible: cet effet ne peut plus être annulé' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'AWAITING_HUMAN' AND NEW.status = 'APPLIED' THEN
    NEW.applied_by := councils.require_human_actor();
  END IF;
  IF NEW.status = 'PENDING' AND councils.effect_needs_human(NEW.tenant_id, NEW.decision_id, NEW.effect_kind) THEN
    RAISE EXCEPTION 'councils.human_application_required: cet effet attend l''acte d''un humain habilité' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER effects_guard BEFORE INSERT OR UPDATE ON councils.effects
  FOR EACH ROW EXECUTE FUNCTION councils.effects_guard();
CREATE TRIGGER effects_no_delete BEFORE DELETE ON councils.effects
  FOR EACH ROW EXECUTE FUNCTION councils.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Procès-verbal : snapshot immuable, hash par la base
-- -----------------------------------------------------------------------------
CREATE FUNCTION councils.minutes_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user   uuid;
  v_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'councils.immutable: un procès-verbal ne se supprime pas' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_user := councils.require_human_actor();
    IF NEW.generated_by <> v_user THEN
      RAISE EXCEPTION 'councils.generator_mismatch: l''auteur doit être l''utilisateur de la session' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT status INTO v_status FROM councils.councils WHERE tenant_id = NEW.tenant_id AND id = NEW.council_id;
    IF v_status <> 'CLOSED' THEN
      RAISE EXCEPTION 'councils.not_closed: le procès-verbal se génère séance close (séance %)', v_status USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM councils.required_signers(NEW.council_id)) THEN
      RAISE EXCEPTION 'councils.no_signer: aucun signataire exigé n''est présent' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> 'GENERATED' THEN
      RAISE EXCEPTION 'councils.minutes_initial_status' USING ERRCODE = 'check_violation';
    END IF;
    SELECT coalesce(max(version), 0) + 1 INTO NEW.version FROM councils.minutes WHERE tenant_id = NEW.tenant_id AND council_id = NEW.council_id;
    SELECT id INTO NEW.supersedes_id FROM councils.minutes
     WHERE tenant_id = NEW.tenant_id AND council_id = NEW.council_id ORDER BY version DESC LIMIT 1;
    NEW.snapshot_hash := councils.minutes_hash(NEW.snapshot);
    RETURN NEW;
  END IF;

  IF NEW.council_id <> OLD.council_id OR NEW.version <> OLD.version OR NEW.schema_name <> OLD.schema_name
     OR NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.snapshot_hash <> OLD.snapshot_hash
     OR NEW.generated_at <> OLD.generated_at OR NEW.generated_by <> OLD.generated_by
     OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id THEN
    RAISE EXCEPTION 'councils.minutes_immutable: le contenu d''un procès-verbal ne change jamais' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status IN ('SUPERSEDED', 'REVOKED') AND (to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)) THEN
    RAISE EXCEPTION 'councils.minutes_final: procès-verbal %', OLD.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status = OLD.status THEN
    IF NEW.signed_at IS DISTINCT FROM OLD.signed_at OR NEW.revoked_reason IS DISTINCT FROM OLD.revoked_reason THEN
      RAISE EXCEPTION 'councils.minutes_immutable: signature et révocation ne changent que par transition' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'GENERATED' AND NEW.status = 'SIGNED' THEN
    IF NOT EXISTS (SELECT 1 FROM councils.minute_signatures g WHERE g.minutes_id = NEW.id)
       OR EXISTS (SELECT 1 FROM councils.missing_signers(NEW.id)) THEN
      RAISE EXCEPTION 'councils.signatures_missing: toutes les signatures exigées ne sont pas recueillies' USING ERRCODE = 'check_violation';
    END IF;
    NEW.signed_at := coalesce(NEW.signed_at, now());
  ELSIF OLD.status IN ('GENERATED', 'SIGNED') AND NEW.status = 'SUPERSEDED' THEN
    SELECT status INTO v_status FROM councils.councils WHERE tenant_id = NEW.tenant_id AND id = NEW.council_id;
    IF v_status <> 'OPEN' THEN
      RAISE EXCEPTION 'councils.supersede_requires_reopen: un procès-verbal n''est remplacé qu''après réouverture motivée de la séance' USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF OLD.status IN ('GENERATED', 'SIGNED') AND NEW.status = 'REVOKED' THEN
    PERFORM councils.require_human_actor();
  ELSE
    RAISE EXCEPTION 'councils.minutes_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER minutes_guard BEFORE INSERT OR UPDATE OR DELETE ON councils.minutes
  FOR EACH ROW EXECUTE FUNCTION councils.minutes_guard();

CREATE FUNCTION councils.signatures_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user uuid;
  v_min  councils.minutes%ROWTYPE;
  v_part councils.participants%ROWTYPE;
BEGIN
  v_user := councils.require_human_actor();
  IF NEW.signed_by_user <> v_user THEN
    RAISE EXCEPTION 'councils.signer_mismatch: la signature est celle de l''utilisateur de la session' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Les signatures d'un même procès-verbal se SÉRIALISENT : deux signataires concurrents ne laissent jamais
  -- la séance non signée parce que chacun ne voyait pas la signature, non validée, de l'autre.
  SELECT * INTO v_min FROM councils.minutes WHERE tenant_id = NEW.tenant_id AND id = NEW.minutes_id FOR UPDATE;
  IF v_min.status <> 'GENERATED' THEN
    RAISE EXCEPTION 'councils.minutes_not_signable: procès-verbal %', v_min.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.signed_hash <> v_min.snapshot_hash THEN
    RAISE EXCEPTION 'councils.signature_hash_mismatch: la signature porte sur un autre contenu que le procès-verbal' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_part FROM councils.participants WHERE tenant_id = NEW.tenant_id AND id = NEW.participant_id;
  IF v_part.council_id <> v_min.council_id THEN
    RAISE EXCEPTION 'councils.participant_not_in_council' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM councils.required_signers(v_min.council_id) rs WHERE rs = NEW.participant_id) THEN
    RAISE EXCEPTION 'councils.not_a_signer: ce participant n''est pas un signataire exigé (ou n''est pas présent)' USING ERRCODE = 'check_violation';
  END IF;
  NEW.role_code := v_part.role_code;
  NEW.signer_name := v_part.display_name;
  NEW.signed_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER signatures_guard BEFORE INSERT ON councils.minute_signatures
  FOR EACH ROW EXECUTE FUNCTION councils.signatures_guard();
CREATE TRIGGER signatures_immutable BEFORE UPDATE OR DELETE ON councils.minute_signatures
  FOR EACH ROW EXECUTE FUNCTION councils.forbid_mutation();

-- Toutes les signatures exigées recueillies : procès-verbal puis séance passent à SIGNED.
CREATE FUNCTION councils.signatures_after() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_council uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM councils.missing_signers(NEW.minutes_id)) THEN
    UPDATE councils.minutes SET status = 'SIGNED' WHERE tenant_id = NEW.tenant_id AND id = NEW.minutes_id AND status = 'GENERATED'
      RETURNING council_id INTO v_council;
    IF v_council IS NOT NULL THEN
      UPDATE councils.councils SET status = 'SIGNED', signed_at = now() WHERE tenant_id = NEW.tenant_id AND id = v_council AND status = 'CLOSED';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER signatures_after AFTER INSERT ON councils.minute_signatures
  FOR EACH ROW EXECUTE FUNCTION councils.signatures_after();

-- -----------------------------------------------------------------------------
-- Demandes de déverrouillage
-- -----------------------------------------------------------------------------
CREATE FUNCTION councils.unlock_requests_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user   uuid;
  v_status text;
  v_set    councils.settings%ROWTYPE;
  v_inst   uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'councils.immutable: une demande de déverrouillage ne se supprime pas' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_user := councils.require_human_actor();
    IF NEW.requested_by <> v_user THEN
      RAISE EXCEPTION 'councils.requester_mismatch' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status <> 'REQUESTED' THEN
      RAISE EXCEPTION 'councils.unlock_initial_status' USING ERRCODE = 'check_violation';
    END IF;
    SELECT status INTO v_status FROM councils.councils WHERE tenant_id = NEW.tenant_id AND id = NEW.council_id;
    IF v_status NOT IN ('CLOSED', 'SIGNED') THEN
      RAISE EXCEPTION 'councils.unlock_not_needed: la séance n''est pas verrouillée (%)', v_status USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.council_id <> OLD.council_id OR NEW.requested_by <> OLD.requested_by OR NEW.requested_at <> OLD.requested_at OR NEW.reason <> OLD.reason THEN
    RAISE EXCEPTION 'councils.unlock_immutable: demandeur, date et motif sont figés' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF NOT ((OLD.status, NEW.status) IN (('REQUESTED', 'APPROVED'), ('REQUESTED', 'REJECTED'), ('REQUESTED', 'EXPIRED'),
                                       ('APPROVED', 'CONSUMED'), ('APPROVED', 'EXPIRED'))) THEN
    RAISE EXCEPTION 'councils.unlock_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status IN ('APPROVED', 'REJECTED') THEN
    v_user := councils.require_human_actor();
    IF NEW.decided_by IS DISTINCT FROM v_user THEN
      RAISE EXCEPTION 'councils.decider_mismatch: la décision est celle de l''utilisateur de la session' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT institution_id INTO v_inst FROM councils.councils WHERE tenant_id = NEW.tenant_id AND id = NEW.council_id;
    SELECT * INTO v_set FROM councils.settings WHERE tenant_id = NEW.tenant_id AND institution_id = v_inst;
    IF NEW.four_eyes_waived AND coalesce(v_set.require_separate_unlocker, true) THEN
      RAISE EXCEPTION 'councils.four_eyes_required: l''approbation doit venir d''une autre personne que le demandeur' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.decided_at := coalesce(NEW.decided_at, now());
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER unlock_requests_guard BEFORE INSERT OR UPDATE OR DELETE ON councils.unlock_requests
  FOR EACH ROW EXECUTE FUNCTION councils.unlock_requests_guard();

-- -----------------------------------------------------------------------------
-- Journal de séance : ajout seul
-- -----------------------------------------------------------------------------
CREATE TRIGGER events_immutable BEFORE UPDATE OR DELETE ON councils.events
  FOR EACH ROW EXECUTE FUNCTION councils.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Orientation : transfert de série = acte humain sur un parcours autorisé
-- -----------------------------------------------------------------------------
CREATE FUNCTION councils.series_transfers_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user uuid;
  v_path councils.orientation_paths%ROWTYPE;
  v_dec  councils.decisions%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'councils.immutable: un transfert de série ne se supprime pas (l''annuler avec un motif)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_user := councils.require_human_actor();
    IF NEW.created_by <> v_user THEN
      RAISE EXCEPTION 'councils.creator_mismatch' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status <> 'PLANNED' THEN
      RAISE EXCEPTION 'councils.transfer_initial_status' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.path_id IS NOT NULL THEN
      SELECT * INTO v_path FROM councils.orientation_paths WHERE tenant_id = NEW.tenant_id AND id = NEW.path_id;
      IF NOT v_path.active
         OR v_path.from_grade_level_id <> NEW.from_grade_level_id
         OR (v_path.from_program_id IS NOT NULL AND v_path.from_program_id <> NEW.from_program_id)
         OR v_path.to_program_id <> NEW.to_program_id OR v_path.to_grade_level_id <> NEW.to_grade_level_id THEN
        RAISE EXCEPTION 'councils.path_mismatch: le parcours désigné ne correspond pas au transfert (ou est désactivé)' USING ERRCODE = 'check_violation';
      END IF;
    ELSIF NEW.path_override_by IS DISTINCT FROM v_user THEN
      RAISE EXCEPTION 'councils.override_actor: la dérogation de parcours est celle de l''utilisateur de la session' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.decided_via = 'COUNCIL' THEN
      SELECT * INTO v_dec FROM councils.decisions WHERE tenant_id = NEW.tenant_id AND id = NEW.decision_id;
      IF v_dec.status <> 'RECORDED' OR v_dec.enrollment_id <> NEW.enrollment_id
         OR v_dec.target_grade_level_id IS DISTINCT FROM NEW.to_grade_level_id
         OR v_dec.target_program_id IS DISTINCT FROM NEW.to_program_id THEN
        RAISE EXCEPTION 'councils.decision_target_mismatch: la décision du conseil ne vise pas cette série / ce niveau pour cette inscription' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.enrollment_id <> OLD.enrollment_id OR NEW.student_id <> OLD.student_id OR NEW.from_program_id <> OLD.from_program_id
     OR NEW.from_grade_level_id <> OLD.from_grade_level_id OR NEW.to_program_id <> OLD.to_program_id
     OR NEW.to_grade_level_id <> OLD.to_grade_level_id OR NEW.decided_via <> OLD.decided_via
     OR NEW.decision_id IS DISTINCT FROM OLD.decision_id OR NEW.act_reference IS DISTINCT FROM OLD.act_reference
     OR NEW.path_id IS DISTINCT FROM OLD.path_id OR NEW.effective_kind <> OLD.effective_kind THEN
    RAISE EXCEPTION 'councils.transfer_immutable: le transfert ne change pas (l''annuler et en créer un autre)' USING ERRCODE = 'restrict_violation';
  END IF;
  NEW.updated_at := now();
  IF NEW.status <> OLD.status AND NOT ((OLD.status, NEW.status) IN (
        ('PLANNED', 'APPLIED'), ('PLANNED', 'CANCELLED'), ('PLANNED', 'FAILED'), ('FAILED', 'PLANNED'), ('FAILED', 'CANCELLED'))) THEN
    RAISE EXCEPTION 'councils.transfer_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status = 'CANCELLED' AND OLD.status <> 'CANCELLED' THEN
    PERFORM councils.require_human_actor();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER series_transfers_guard BEFORE INSERT OR UPDATE OR DELETE ON councils.series_transfers
  FOR EACH ROW EXECUTE FUNCTION councils.series_transfers_guard();

-- Dossier d'orientation : DECIDED / APPLIED reposent sur une décision enregistrée de la même inscription ;
-- un transfert dont le parcours exige l'accord de la famille ne s'applique pas sans accord donné.
CREATE FUNCTION councils.orientation_files_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_dec councils.decisions%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF NEW.enrollment_id <> OLD.enrollment_id OR NEW.student_id <> OLD.student_id OR NEW.academic_year_id <> OLD.academic_year_id THEN
    RAISE EXCEPTION 'councils.orientation_identity_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  NEW.updated_at := now();
  IF NEW.decision_id IS NOT NULL AND NEW.decision_id IS DISTINCT FROM OLD.decision_id THEN
    SELECT * INTO v_dec FROM councils.decisions WHERE tenant_id = NEW.tenant_id AND id = NEW.decision_id;
    IF v_dec.enrollment_id <> NEW.enrollment_id OR v_dec.status <> 'RECORDED' THEN
      RAISE EXCEPTION 'councils.orientation_decision: la décision retenue doit être enregistrée pour cette inscription' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.status = 'APPLIED' AND OLD.status <> 'APPLIED' AND NEW.guardian_consent <> 'GIVEN' AND EXISTS (
       SELECT 1 FROM councils.series_transfers t
         JOIN councils.orientation_paths p ON p.tenant_id = t.tenant_id AND p.id = t.path_id
        WHERE t.tenant_id = NEW.tenant_id AND t.enrollment_id = NEW.enrollment_id AND t.status IN ('PLANNED', 'APPLIED')
          AND p.requires_guardian_consent) THEN
    RAISE EXCEPTION 'councils.consent_required: le parcours exige l''accord de la famille' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER orientation_files_guard BEFORE INSERT OR UPDATE ON councils.orientation_files
  FOR EACH ROW EXECUTE FUNCTION councils.orientation_files_guard();
CREATE TRIGGER orientation_files_no_delete BEFORE DELETE ON councils.orientation_files
  FOR EACH ROW EXECUTE FUNCTION councils.forbid_mutation();
CREATE TRIGGER council_types_no_delete BEFORE DELETE ON councils.council_types
  FOR EACH ROW EXECUTE FUNCTION councils.forbid_mutation();
```

### 5.6 `schoollife` — paramètres, types d'événements, barèmes de conduite

<!-- migration: 1900_schoollife_reference.sql -->
```sql
-- =============================================================================
-- 1900 — Module schoollife : schéma, paramètres, types d'événements, barèmes de points de conduite
-- =============================================================================
--
-- Plage de numéros proposée au module schoollife : 1900–1999 (plage définitive attribuée par
-- `pnpm module:new` dans l'ordre de création ; voir docs/architecture/module-conventions.md).
--
-- Vie scolaire (PRD §34) : incidents, avertissements, sanctions, exclusions temporaires, encouragements,
-- observations, convocations, points de conduite. Les retards et absences NE sont PAS dupliqués : ils
-- restent dans `attendance` (010), le module en publie une VUE (aucune table ici).
--
-- Règles : un module = un schéma ; aucune FK vers un autre schéma que `kernel.tenants` (élèves,
-- inscriptions, classes, tuteurs = UUID vérifiés par des ports) ; RLS forcée ; FK internes composites.
-- AUCUNE valeur réglementaire : types d'événements, niveaux de gravité, barèmes de points sont des DONNÉES
-- d'établissement (ou de modèle de pack marqué `placeholder`), jamais des constantes du code.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS schoollife;
REVOKE ALL ON SCHEMA schoollife FROM PUBLIC;
GRANT USAGE ON SCHEMA schoollife TO app_user;

-- Pour les contraintes d'exclusion (exclusions temporaires qui se chevauchent, barèmes actifs concurrents).
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE FUNCTION schoollife.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'schoollife.immutable: % est immuable (% interdit)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;

-- Un acte disciplinaire (proposer, valider, notifier, révoquer, rédiger une observation) exige une session
-- d'UTILISATEUR identifié : jamais un job ni une règle.
CREATE FUNCTION schoollife.require_human_actor() RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_user uuid := kernel.current_user_id();
BEGIN
  IF v_user IS NULL OR coalesce(kernel.current_actor(), '') <> 'user' THEN
    RAISE EXCEPTION 'schoollife.human_actor_required: cet acte exige un utilisateur identifié (acteur %)', coalesce(kernel.current_actor(), 'inconnu')
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN v_user;
END
$$;

-- Rang d'un niveau de confidentialité (STANDARD < RESTRICTED < CONFIDENTIAL).
CREATE FUNCTION schoollife.confidentiality_rank(p_level text) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_level WHEN 'STANDARD' THEN 1 WHEN 'RESTRICTED' THEN 2 WHEN 'CONFIDENTIAL' THEN 3 END
$$;

-- -----------------------------------------------------------------------------
-- Réglages par établissement (une ligne)
--   conduct_points_enabled  active les points de conduite (barèmes ci-dessous) ; faux par défaut
--   retention_days          durée de conservation des données disciplinaires ; NULL = non définie
--                           (aucune durée légale codée : à fixer par l'établissement, question ouverte)
-- -----------------------------------------------------------------------------
CREATE TABLE schoollife.settings (
  tenant_id                    uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id               uuid NOT NULL,
  conduct_points_enabled       boolean NOT NULL DEFAULT false,
  confidential_read_requires_purpose boolean NOT NULL DEFAULT true,
  retention_days               integer CHECK (retention_days IS NULL OR retention_days > 0),
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, institution_id)
);
SELECT kernel.enable_tenant_rls('schoollife.settings');
GRANT SELECT, INSERT, UPDATE ON schoollife.settings TO app_user;

-- Niveaux de gravité (données) : le rang ordonne, le code et le libellé sont libres.
CREATE TABLE schoollife.severity_levels (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES kernel.tenants (id),
  code       text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label      text NOT NULL CHECK (length(btrim(label)) > 0),
  rank       integer NOT NULL CHECK (rank >= 1),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, rank)
);
SELECT kernel.enable_tenant_rls('schoollife.severity_levels');
GRANT SELECT, INSERT, UPDATE ON schoollife.severity_levels TO app_user;

-- -----------------------------------------------------------------------------
-- Types d'événements de vie scolaire. `kind` = la FAMILLE (PRD §34) ; code et libellé = données.
--   requires_validation    la mesure (sanction, exclusion) n'est effective qu'après validation par une autre étape
--   requires_four_eyes     le validateur n'est pas le proposant
--   approver_permission    permission exigée du validateur (contrôlée par l'application via le RBAC)
--   notify_guardians       une notification est préparée pour les tuteurs lors de la notification de la mesure
--   visible_to_guardians   les tuteurs peuvent voir l'événement (sous réserve de confidentialité)
--   requires_dates         exclusion temporaire : dates de début et de fin obligatoires
--   appealable             la mesure peut faire l'objet d'un recours
--   is_placeholder         type générique de démonstration (modèle de pack), à remplacer par l'établissement
-- Une exclusion temporaire exige TOUJOURS une validation (contrainte de table).
-- -----------------------------------------------------------------------------
CREATE TABLE schoollife.event_types (
  id                     uuid PRIMARY KEY,
  tenant_id              uuid NOT NULL REFERENCES kernel.tenants (id),
  code                   text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label                  text NOT NULL CHECK (length(btrim(label)) > 0),
  kind                   text NOT NULL CHECK (kind IN ('INCIDENT', 'SANCTION', 'WARNING', 'ENCOURAGEMENT', 'TEMP_EXCLUSION', 'OBSERVATION')),
  default_severity_code  text,
  requires_validation    boolean NOT NULL DEFAULT false,
  requires_four_eyes     boolean NOT NULL DEFAULT false,
  approver_permission    text CHECK (approver_permission IS NULL OR approver_permission ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  notify_guardians       boolean NOT NULL DEFAULT false,
  visible_to_guardians   boolean NOT NULL DEFAULT true,
  confidentiality_default text NOT NULL DEFAULT 'STANDARD' CHECK (confidentiality_default IN ('STANDARD', 'RESTRICTED', 'CONFIDENTIAL')),
  requires_dates         boolean NOT NULL DEFAULT false,
  appealable             boolean NOT NULL DEFAULT false,
  is_placeholder         boolean NOT NULL DEFAULT false,
  sort_order             integer NOT NULL DEFAULT 0,
  active                 boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, default_severity_code) REFERENCES schoollife.severity_levels (tenant_id, code),
  CHECK (requires_dates = (kind = 'TEMP_EXCLUSION')),
  CHECK (NOT requires_four_eyes OR requires_validation),
  CHECK (kind <> 'TEMP_EXCLUSION' OR requires_validation),
  CHECK (kind NOT IN ('INCIDENT', 'ENCOURAGEMENT', 'OBSERVATION') OR (NOT requires_validation AND NOT appealable)),
  CHECK (kind IN ('SANCTION', 'TEMP_EXCLUSION') OR NOT appealable)
);
SELECT kernel.enable_tenant_rls('schoollife.event_types');
GRANT SELECT, INSERT, UPDATE ON schoollife.event_types TO app_user;

-- -----------------------------------------------------------------------------
-- Barèmes de points de conduite : PARAMÈTRES d'établissement, jamais du code.
--   Une échelle = points initiaux, bornes facultatives, périmètre de remise à zéro, période d'effet.
--   Un seul barème ACTIF par (établissement, niveau ou « tous niveaux ») et par période d'effet.
--   Un barème ACTIF ou RETIRÉ ne change plus (on en crée un nouveau) : les mouvements restent expliquables.
--   source_kind : 'regulation' | 'institution' | 'placeholder' (jeu de démonstration, jamais réglementaire).
-- -----------------------------------------------------------------------------
CREATE TABLE schoollife.conduct_scales (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id  uuid NOT NULL,
  code            text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label           text NOT NULL CHECK (length(btrim(label)) > 0),
  grade_level_id  uuid,                                   -- academic.grade_levels.id ; NULL = tous les niveaux
  initial_points  integer NOT NULL,
  min_points      integer,
  max_points      integer,
  reset_scope     text NOT NULL CHECK (reset_scope IN ('PERIOD', 'YEAR', 'NEVER')),
  effective_from  date NOT NULL,
  effective_to    date,
  status          text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
  source_kind     text NOT NULL DEFAULT 'institution' CHECK (source_kind IN ('regulation', 'institution', 'placeholder')),
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, institution_id, code),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (min_points IS NULL OR max_points IS NULL OR min_points <= max_points),
  CHECK (min_points IS NULL OR initial_points >= min_points),
  CHECK (max_points IS NULL OR initial_points <= max_points),
  EXCLUDE USING gist (
    tenant_id WITH =,
    institution_id WITH =,
    (coalesce(grade_level_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  ) WHERE (status = 'ACTIVE')
);
SELECT kernel.enable_tenant_rls('schoollife.conduct_scales');
GRANT SELECT, INSERT, UPDATE ON schoollife.conduct_scales TO app_user;

-- Valeur d'un type d'événement dans un barème (points en moins pour une sanction, en plus pour un encouragement).
CREATE TABLE schoollife.conduct_scale_items (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  scale_id       uuid NOT NULL,
  event_type_id  uuid NOT NULL,
  points_delta   integer NOT NULL CHECK (points_delta <> 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, scale_id, event_type_id),
  FOREIGN KEY (tenant_id, scale_id) REFERENCES schoollife.conduct_scales (tenant_id, id),
  FOREIGN KEY (tenant_id, event_type_id) REFERENCES schoollife.event_types (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('schoollife.conduct_scale_items');
GRANT SELECT, INSERT, UPDATE, DELETE ON schoollife.conduct_scale_items TO app_user;   -- brouillon seulement (déclencheur 1902)
```

### 5.7 `schoollife` — incidents, mesures, recours, notes, convocations, registre, historique

<!-- migration: 1901_schoollife_records.sql -->
```sql
-- =============================================================================
-- 1901 — Module schoollife : incidents, mesures, observations, convocations, points de conduite,
--        recours, historique, journal des lectures confidentielles
-- =============================================================================
--
-- Principes :
--   - tout est HISTORISÉ : aucune suppression, correction = nouvelle ligne ou transition motivée ;
--   - les mesures (sanction, avertissement, exclusion temporaire) suivent un circuit de validation
--     défini par leur TYPE (données) ; la base impose la séparation des tâches quand le type l'exige ;
--   - confidentialité : STANDARD / RESTRICTED / CONFIDENTIAL ; un élément CONFIDENTIAL n'est jamais
--     visible d'un élève ni d'un tuteur ; chaque lecture d'un élément CONFIDENTIAL est journalisée
--     (`confidential_reads`) ;
--   - les retards et absences restent dans `attendance` (010) : une vue, pas une copie.
-- =============================================================================

-- Incidents : un fait signalé (avant toute mesure).
CREATE TABLE schoollife.incidents (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id   uuid NOT NULL,
  campus_id        uuid,
  academic_year_id uuid NOT NULL,
  type_id          uuid NOT NULL,
  severity_code    text,
  occurred_at      timestamptz NOT NULL,
  location         text,
  description      text NOT NULL CHECK (length(btrim(description)) >= 5),
  context_note     text,
  status           text NOT NULL DEFAULT 'DECLARED' CHECK (status IN ('DECLARED', 'UNDER_REVIEW', 'CONFIRMED', 'DISMISSED', 'CLOSED')),
  confidentiality  text NOT NULL DEFAULT 'STANDARD' CHECK (confidentiality IN ('STANDARD', 'RESTRICTED', 'CONFIDENTIAL')),
  reported_by      uuid NOT NULL,
  reported_by_name text NOT NULL CHECK (length(btrim(reported_by_name)) > 0),
  assigned_to      uuid,
  resolution_note  text,
  attendance_session_id uuid,                              -- attendance.sessions.id (contexte), sans FK
  closed_at        timestamptz,
  row_version      integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, type_id) REFERENCES schoollife.event_types (tenant_id, id),
  FOREIGN KEY (tenant_id, severity_code) REFERENCES schoollife.severity_levels (tenant_id, code),
  CHECK (status NOT IN ('DISMISSED', 'CLOSED') OR length(btrim(coalesce(resolution_note, ''))) >= 5),
  CHECK (status <> 'CLOSED' OR closed_at IS NOT NULL)
);
SELECT kernel.enable_tenant_rls('schoollife.incidents');
CREATE INDEX incidents_by_year ON schoollife.incidents (tenant_id, academic_year_id, institution_id, status);
CREATE INDEX incidents_by_date ON schoollife.incidents (tenant_id, occurred_at DESC);
GRANT SELECT, INSERT, UPDATE ON schoollife.incidents TO app_user;

-- Élèves impliqués (auteur, victime, témoin) ; la déclaration d'un élève reste CONFIDENTIELLE par nature
-- (la visibilité d'un élève sur un incident passe par les mesures, pas par ses involvements).
CREATE TABLE schoollife.incident_involvements (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  incident_id    uuid NOT NULL,
  enrollment_id  uuid NOT NULL,                            -- academic.enrollments.id
  student_id     uuid NOT NULL,                            -- people.students.id
  role           text NOT NULL CHECK (role IN ('AUTHOR', 'VICTIM', 'WITNESS', 'OTHER')),
  statement      text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, incident_id, student_id, role),
  FOREIGN KEY (tenant_id, incident_id) REFERENCES schoollife.incidents (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('schoollife.incident_involvements');
CREATE INDEX incident_involvements_by_student ON schoollife.incident_involvements (tenant_id, student_id);
GRANT SELECT, INSERT, UPDATE ON schoollife.incident_involvements TO app_user;

-- Mesures disciplinaires : sanction, avertissement, exclusion temporaire.
--   kind : recopié du type par la base ; PROPOSED -> VALIDATED -> NOTIFIED -> EXECUTED ;
--   REJECTED / CANCELLED avant validation ; REVOKED / APPEALED après ; aucune suppression.
--   Une exclusion temporaire ne chevauche jamais une autre exclusion vivante du même élève.
CREATE TABLE schoollife.measures (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id   uuid NOT NULL,
  academic_year_id uuid NOT NULL,
  enrollment_id    uuid NOT NULL,
  student_id       uuid NOT NULL,
  classroom_id     uuid,                                   -- classe au moment des faits
  type_id          uuid NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('SANCTION', 'WARNING', 'TEMP_EXCLUSION')),
  incident_id      uuid,
  severity_code    text,
  reason           text NOT NULL CHECK (length(btrim(reason)) >= 5),
  starts_on        date,
  ends_on          date,
  status           text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'VALIDATED', 'NOTIFIED', 'EXECUTED', 'APPEALED', 'REVOKED', 'REJECTED', 'CANCELLED')),
  proposed_by      uuid NOT NULL,
  proposed_by_name text NOT NULL CHECK (length(btrim(proposed_by_name)) > 0),
  proposed_at      timestamptz NOT NULL DEFAULT now(),
  validated_by     uuid,
  validated_by_name text,
  validated_at     timestamptz,
  validation_note  text,
  notified_at      timestamptz,
  notified_by      uuid,
  notification_ref uuid,                                   -- messaging : notification envoyée aux tuteurs
  executed_at      timestamptz,
  revoked_at       timestamptz,
  revoked_by       uuid,
  revoked_reason   text,
  cancel_reason    text,
  visible_to_guardians boolean NOT NULL DEFAULT true,
  confidentiality  text NOT NULL DEFAULT 'STANDARD' CHECK (confidentiality IN ('STANDARD', 'RESTRICTED', 'CONFIDENTIAL')),
  row_version      integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, type_id) REFERENCES schoollife.event_types (tenant_id, id),
  FOREIGN KEY (tenant_id, incident_id) REFERENCES schoollife.incidents (tenant_id, id),
  FOREIGN KEY (tenant_id, severity_code) REFERENCES schoollife.severity_levels (tenant_id, code),
  CHECK (ends_on IS NULL OR (starts_on IS NOT NULL AND ends_on >= starts_on)),
  CHECK (kind <> 'TEMP_EXCLUSION' OR (starts_on IS NOT NULL AND ends_on IS NOT NULL)),
  CHECK (status <> 'REJECTED' OR length(btrim(coalesce(validation_note, ''))) >= 5),
  CHECK (status <> 'REVOKED' OR length(btrim(coalesce(revoked_reason, ''))) >= 10),
  CHECK (status <> 'CANCELLED' OR length(btrim(coalesce(cancel_reason, ''))) >= 5),
  CHECK (confidentiality <> 'CONFIDENTIAL' OR NOT visible_to_guardians),
  EXCLUDE USING gist (
    tenant_id WITH =,
    enrollment_id WITH =,
    daterange(starts_on, ends_on, '[]') WITH &&
  ) WHERE (kind = 'TEMP_EXCLUSION' AND status IN ('VALIDATED', 'NOTIFIED', 'EXECUTED', 'APPEALED'))
);
SELECT kernel.enable_tenant_rls('schoollife.measures');
CREATE INDEX measures_by_student ON schoollife.measures (tenant_id, student_id, academic_year_id, status);
CREATE INDEX measures_by_year ON schoollife.measures (tenant_id, academic_year_id, institution_id, kind, status);
CREATE INDEX measures_pending ON schoollife.measures (tenant_id, institution_id, proposed_at) WHERE status = 'PROPOSED';
GRANT SELECT, INSERT, UPDATE ON schoollife.measures TO app_user;

-- Recours contre une mesure (tuteur ou élève selon l'établissement) ; l'issue remet la mesure en vigueur
-- (UPHELD -> EXECUTED) ou la révoque (OVERTURNED).
CREATE TABLE schoollife.measure_appeals (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES kernel.tenants (id),
  measure_id    uuid NOT NULL,
  filed_by      uuid NOT NULL,                             -- utilisateur (tuteur, élève, direction)
  filed_by_name text NOT NULL CHECK (length(btrim(filed_by_name)) > 0),
  filed_at      timestamptz NOT NULL DEFAULT now(),
  reason        text NOT NULL CHECK (length(btrim(reason)) >= 10),
  status        text NOT NULL DEFAULT 'FILED' CHECK (status IN ('FILED', 'UPHELD', 'OVERTURNED', 'WITHDRAWN')),
  decided_by    uuid,
  decided_by_name text,
  decided_at    timestamptz,
  decision_note text,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, measure_id) REFERENCES schoollife.measures (tenant_id, id),
  CHECK (status = 'FILED' OR status = 'WITHDRAWN' OR (decided_by IS NOT NULL AND length(btrim(coalesce(decision_note, ''))) >= 10))
);
SELECT kernel.enable_tenant_rls('schoollife.measure_appeals');
CREATE UNIQUE INDEX measure_appeals_one_open ON schoollife.measure_appeals (tenant_id, measure_id) WHERE status = 'FILED';
GRANT SELECT, INSERT, UPDATE ON schoollife.measure_appeals TO app_user;

-- Encouragements et observations (notes de vie scolaire) : simples, immuables, retirables avec motif.
CREATE TABLE schoollife.notes (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id   uuid NOT NULL,
  academic_year_id uuid NOT NULL,
  enrollment_id    uuid NOT NULL,
  student_id       uuid NOT NULL,
  type_id          uuid NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('ENCOURAGEMENT', 'OBSERVATION')),
  body             text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  occurred_on      date NOT NULL,
  visibility       text NOT NULL DEFAULT 'STAFF_ONLY' CHECK (visibility IN ('STAFF_ONLY', 'GUARDIANS', 'STUDENT_AND_GUARDIANS')),
  confidentiality  text NOT NULL DEFAULT 'STANDARD' CHECK (confidentiality IN ('STANDARD', 'RESTRICTED', 'CONFIDENTIAL')),
  author_id        uuid NOT NULL,
  author_name      text NOT NULL CHECK (length(btrim(author_name)) > 0),
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'WITHDRAWN')),
  withdrawn_by     uuid,
  withdrawn_at     timestamptz,
  withdrawn_reason text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, type_id) REFERENCES schoollife.event_types (tenant_id, id),
  CHECK (confidentiality <> 'CONFIDENTIAL' OR visibility = 'STAFF_ONLY'),
  CHECK (status <> 'WITHDRAWN' OR (withdrawn_by IS NOT NULL AND length(btrim(coalesce(withdrawn_reason, ''))) >= 5))
);
SELECT kernel.enable_tenant_rls('schoollife.notes');
CREATE INDEX notes_by_student ON schoollife.notes (tenant_id, student_id, academic_year_id, occurred_on DESC);
GRANT SELECT, INSERT, UPDATE ON schoollife.notes TO app_user;

-- Convocations des tuteurs (envoi par `notifications` via un port ; le statut suit la réalité).
CREATE TABLE schoollife.convocations (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id   uuid NOT NULL,
  academic_year_id uuid NOT NULL,
  enrollment_id    uuid NOT NULL,
  student_id       uuid NOT NULL,
  guardian_ids     uuid[] NOT NULL CHECK (cardinality(guardian_ids) >= 1),   -- people.guardians.id
  reason_kind      text NOT NULL CHECK (reason_kind IN ('DISCIPLINE', 'ABSENCES', 'ACADEMIC', 'HEALTH', 'OTHER')),
  reason           text NOT NULL CHECK (length(btrim(reason)) >= 5),
  related_measure_id  uuid,
  related_incident_id uuid,
  scheduled_at     timestamptz NOT NULL,
  location         text,
  status           text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SENT', 'ACKNOWLEDGED', 'HELD', 'NO_SHOW', 'CANCELLED', 'RESCHEDULED')),
  convened_by      uuid NOT NULL,
  convened_by_name text NOT NULL CHECK (length(btrim(convened_by_name)) > 0),
  sent_at          timestamptz,
  notification_ref uuid,
  acknowledged_at  timestamptz,
  acknowledged_by_guardian_id uuid,
  held_at          timestamptz,
  outcome_note     text,
  cancel_reason    text,
  rescheduled_from_id uuid,
  confidentiality  text NOT NULL DEFAULT 'STANDARD' CHECK (confidentiality IN ('STANDARD', 'RESTRICTED', 'CONFIDENTIAL')),
  row_version      integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, related_measure_id) REFERENCES schoollife.measures (tenant_id, id),
  FOREIGN KEY (tenant_id, related_incident_id) REFERENCES schoollife.incidents (tenant_id, id),
  FOREIGN KEY (tenant_id, rescheduled_from_id) REFERENCES schoollife.convocations (tenant_id, id),
  CHECK (status NOT IN ('SENT', 'ACKNOWLEDGED', 'HELD', 'NO_SHOW') OR sent_at IS NOT NULL),
  CHECK (status <> 'ACKNOWLEDGED' OR acknowledged_at IS NOT NULL),
  CHECK (status <> 'HELD' OR held_at IS NOT NULL),
  CHECK (status <> 'CANCELLED' OR length(btrim(coalesce(cancel_reason, ''))) >= 5)
);
SELECT kernel.enable_tenant_rls('schoollife.convocations');
CREATE INDEX convocations_by_student ON schoollife.convocations (tenant_id, student_id, scheduled_at DESC);
CREATE INDEX convocations_due ON schoollife.convocations (tenant_id, scheduled_at) WHERE status IN ('SENT', 'ACKNOWLEDGED');
GRANT SELECT, INSERT, UPDATE ON schoollife.convocations TO app_user;

-- Mouvements de points de conduite (registre en ajout seul). Le solde se DÉRIVE du barème et des mouvements
-- (`schoollife.conduct_balance`) ; une correction est un mouvement inverse (`reverses_id`).
CREATE TABLE schoollife.conduct_movements (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  scale_id         uuid NOT NULL,
  enrollment_id    uuid NOT NULL,
  student_id       uuid NOT NULL,
  academic_year_id uuid NOT NULL,
  academic_period_id uuid,
  delta            integer NOT NULL CHECK (delta <> 0),
  reason           text NOT NULL CHECK (length(btrim(reason)) >= 3),
  source_kind      text NOT NULL CHECK (source_kind IN ('MEASURE', 'NOTE', 'MANUAL_ADJUSTMENT')),
  source_id        uuid,
  reverses_id      uuid,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, scale_id) REFERENCES schoollife.conduct_scales (tenant_id, id),
  FOREIGN KEY (tenant_id, reverses_id) REFERENCES schoollife.conduct_movements (tenant_id, id),
  CHECK (source_kind = 'MANUAL_ADJUSTMENT' OR source_id IS NOT NULL OR reverses_id IS NOT NULL)
);
SELECT kernel.enable_tenant_rls('schoollife.conduct_movements');
CREATE UNIQUE INDEX conduct_movements_one_reversal ON schoollife.conduct_movements (tenant_id, reverses_id) WHERE reverses_id IS NOT NULL;
CREATE UNIQUE INDEX conduct_movements_one_per_source ON schoollife.conduct_movements (tenant_id, scale_id, source_kind, source_id)
  WHERE source_id IS NOT NULL AND reverses_id IS NULL;
CREATE INDEX conduct_movements_by_student ON schoollife.conduct_movements (tenant_id, student_id, scale_id, academic_year_id);
GRANT SELECT, INSERT ON schoollife.conduct_movements TO app_user;      -- append-only

-- Historique (ajout seul) : alimenté par les déclencheurs (1902) à chaque création et changement de statut.
CREATE TABLE schoollife.life_events (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES kernel.tenants (id),
  entity_kind text NOT NULL CHECK (entity_kind IN ('INCIDENT', 'MEASURE', 'NOTE', 'CONVOCATION', 'APPEAL', 'SCALE')),
  entity_id   uuid NOT NULL,
  student_id  uuid,
  action      text NOT NULL CHECK (action IN ('CREATED', 'STATUS_CHANGED')),
  from_status text,
  to_status   text,
  actor_id    uuid,
  actor_kind  text CHECK (actor_kind IS NULL OR actor_kind IN ('user', 'system', 'superAdmin')),
  reason      text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('schoollife.life_events');
CREATE INDEX life_events_by_entity ON schoollife.life_events (tenant_id, entity_kind, entity_id, occurred_at);
CREATE INDEX life_events_by_student ON schoollife.life_events (tenant_id, student_id, occurred_at DESC) WHERE student_id IS NOT NULL;
GRANT SELECT, INSERT ON schoollife.life_events TO app_user;

-- Journal des lectures d'éléments CONFIDENTIELS (qui, quand, pourquoi) : ajout seul.
CREATE TABLE schoollife.confidential_reads (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  entity_kind    text NOT NULL CHECK (entity_kind IN ('INCIDENT', 'MEASURE', 'NOTE', 'CONVOCATION')),
  entity_id      uuid NOT NULL,
  reader_user_id uuid NOT NULL,
  purpose        text NOT NULL CHECK (length(btrim(purpose)) >= 5),
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('schoollife.confidential_reads');
CREATE INDEX confidential_reads_by_entity ON schoollife.confidential_reads (tenant_id, entity_kind, entity_id, occurred_at);
GRANT SELECT, INSERT ON schoollife.confidential_reads TO app_user;      -- append-only
```

### 5.8 `schoollife` — invariants imposés par la base

<!-- migration: 1902_schoollife_guards.sql -->
```sql
-- =============================================================================
-- 1902 — Module schoollife : invariants imposés par la base
-- =============================================================================
--
-- Valables pour tout rôle, superutilisateur compris (déclencheurs) :
--   1. un acte disciplinaire exige un UTILISATEUR identifié (jamais un job ni une règle) ;
--   2. machines à états des incidents, mesures, recours, convocations, barèmes ;
--   3. séparation des tâches : le validateur d'une mesure n'est pas son proposant quand le type l'exige ;
--   4. contenu figé après validation ; confidentialité jamais abaissée ; recours encadrés ;
--   5. barèmes de points : ACTIF/RETIRÉ figés ; mouvements en ajout seul, conformes au barème, inversibles ;
--   6. historique automatique en ajout seul ; lectures confidentielles journalisées en ajout seul.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Visibilité : QUI VOIT QUOI (source unique de la règle, appelée par les lectures des portails)
--   audience : 'GUARDIAN' ou 'STUDENT'
--   élément CONFIDENTIAL : jamais visible d'un tuteur ni d'un élève ; incident : jamais visible d'une famille ;
--   mesure : visible une fois NOTIFIÉE (puis exécutée / en recours), si l'événement est partageable ;
--   note : visibilité choisie par l'auteur (GUARDIANS ou STUDENT_AND_GUARDIANS) ; convocation : envoyée.
-- -----------------------------------------------------------------------------
CREATE FUNCTION schoollife.audience_may_see(
  p_audience text, p_kind text, p_confidentiality text, p_shareable boolean, p_status text, p_note_visibility text DEFAULT NULL
) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_audience NOT IN ('GUARDIAN', 'STUDENT') THEN false
    WHEN p_confidentiality = 'CONFIDENTIAL' THEN false
    WHEN NOT coalesce(p_shareable, false) THEN false
    WHEN p_kind = 'INCIDENT' THEN false
    WHEN p_kind = 'MEASURE' THEN p_status IN ('NOTIFIED', 'EXECUTED', 'APPEALED')
    WHEN p_kind = 'NOTE' THEN p_status = 'ACTIVE' AND (
      (p_audience = 'GUARDIAN' AND p_note_visibility IN ('GUARDIANS', 'STUDENT_AND_GUARDIANS'))
      OR (p_audience = 'STUDENT' AND p_note_visibility = 'STUDENT_AND_GUARDIANS'))
    WHEN p_kind = 'CONVOCATION' THEN p_audience = 'GUARDIAN' AND p_status IN ('SENT', 'ACKNOWLEDGED', 'HELD', 'NO_SHOW', 'RESCHEDULED')
    ELSE false
  END
$$;

-- Solde de points de conduite : points initiaux + mouvements du périmètre de remise à zéro du barème, borné.
CREATE FUNCTION schoollife.conduct_balance(p_student uuid, p_scale uuid, p_year uuid, p_period uuid DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_scale schoollife.conduct_scales%ROWTYPE;
  v_sum   integer;
BEGIN
  SELECT * INTO v_scale FROM schoollife.conduct_scales WHERE id = p_scale;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'schoollife.scale_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT coalesce(sum(m.delta), 0)::integer INTO v_sum
    FROM schoollife.conduct_movements m
   WHERE m.scale_id = p_scale AND m.student_id = p_student
     AND CASE v_scale.reset_scope
           WHEN 'PERIOD' THEN m.academic_period_id IS NOT DISTINCT FROM p_period AND m.academic_year_id = p_year
           WHEN 'YEAR' THEN m.academic_year_id = p_year
           ELSE true
         END;
  RETURN least(coalesce(v_scale.max_points, 2147483647), greatest(coalesce(v_scale.min_points, -2147483648), v_scale.initial_points + v_sum));
END
$$;

-- -----------------------------------------------------------------------------
-- Types d'événements : la famille ne change plus dès qu'un enregistrement l'utilise
-- -----------------------------------------------------------------------------
CREATE FUNCTION schoollife.event_types_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind <> OLD.kind AND (
       EXISTS (SELECT 1 FROM schoollife.incidents WHERE tenant_id = OLD.tenant_id AND type_id = OLD.id)
    OR EXISTS (SELECT 1 FROM schoollife.measures WHERE tenant_id = OLD.tenant_id AND type_id = OLD.id)
    OR EXISTS (SELECT 1 FROM schoollife.notes WHERE tenant_id = OLD.tenant_id AND type_id = OLD.id)) THEN
    RAISE EXCEPTION 'schoollife.type_kind_locked: la famille d''un type utilisé ne change plus (en créer un autre et désactiver celui-ci)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER event_types_guard BEFORE UPDATE ON schoollife.event_types
  FOR EACH ROW EXECUTE FUNCTION schoollife.event_types_guard();
CREATE TRIGGER event_types_no_delete BEFORE DELETE ON schoollife.event_types
  FOR EACH ROW EXECUTE FUNCTION schoollife.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Incidents
-- -----------------------------------------------------------------------------
CREATE FUNCTION schoollife.incidents_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user uuid;
  v_type schoollife.event_types%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'schoollife.immutable: un incident ne se supprime pas' USING ERRCODE = 'restrict_violation';
  END IF;
  v_user := schoollife.require_human_actor();
  IF TG_OP = 'INSERT' THEN
    IF NEW.reported_by <> v_user THEN
      RAISE EXCEPTION 'schoollife.reporter_mismatch: le déclarant est l''utilisateur de la session' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status <> 'DECLARED' THEN
      RAISE EXCEPTION 'schoollife.initial_status: un incident se déclare DECLARED' USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO v_type FROM schoollife.event_types WHERE tenant_id = NEW.tenant_id AND id = NEW.type_id;
    IF v_type.kind IS DISTINCT FROM 'INCIDENT' OR NOT v_type.active THEN
      RAISE EXCEPTION 'schoollife.type_kind: le type doit être un type d''incident actif' USING ERRCODE = 'check_violation';
    END IF;
    IF schoollife.confidentiality_rank(NEW.confidentiality) < schoollife.confidentiality_rank(v_type.confidentiality_default) THEN
      RAISE EXCEPTION 'schoollife.confidentiality_floor: la confidentialité ne peut pas être inférieure à celle du type (%)', v_type.confidentiality_default
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.institution_id <> OLD.institution_id OR NEW.academic_year_id <> OLD.academic_year_id OR NEW.type_id <> OLD.type_id
     OR NEW.occurred_at <> OLD.occurred_at OR NEW.reported_by <> OLD.reported_by THEN
    RAISE EXCEPTION 'schoollife.incident_identity_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'CLOSED' THEN
    RAISE EXCEPTION 'schoollife.closed: l''incident est clos' USING ERRCODE = 'restrict_violation';
  END IF;
  IF schoollife.confidentiality_rank(NEW.confidentiality) < schoollife.confidentiality_rank(OLD.confidentiality) THEN
    RAISE EXCEPTION 'schoollife.confidentiality_lowered: la confidentialité ne s''abaisse pas' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.description <> OLD.description AND OLD.status <> 'DECLARED' THEN
    RAISE EXCEPTION 'schoollife.description_frozen: la description ne change plus après l''ouverture de l''instruction' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT ((OLD.status, NEW.status) IN (('DECLARED', 'UNDER_REVIEW'), ('DECLARED', 'DISMISSED'), ('UNDER_REVIEW', 'CONFIRMED'),
                                         ('UNDER_REVIEW', 'DISMISSED'), ('CONFIRMED', 'CLOSED'), ('DISMISSED', 'CLOSED'))) THEN
      RAISE EXCEPTION 'schoollife.incident_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status = 'CLOSED' THEN
      NEW.closed_at := now();
    END IF;
  END IF;
  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER incidents_guard BEFORE INSERT OR UPDATE OR DELETE ON schoollife.incidents
  FOR EACH ROW EXECUTE FUNCTION schoollife.incidents_guard();

CREATE FUNCTION schoollife.involvements_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'schoollife.immutable: une implication ne se supprime pas' USING ERRCODE = 'restrict_violation';
  END IF;
  PERFORM schoollife.require_human_actor();
  SELECT status INTO v_status FROM schoollife.incidents WHERE tenant_id = NEW.tenant_id AND id = NEW.incident_id;
  IF v_status IN ('CLOSED', 'DISMISSED') THEN
    RAISE EXCEPTION 'schoollife.closed: l''incident est %', v_status USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.incident_id <> OLD.incident_id OR NEW.student_id <> OLD.student_id OR NEW.enrollment_id <> OLD.enrollment_id OR NEW.role <> OLD.role) THEN
    RAISE EXCEPTION 'schoollife.involvement_identity_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER involvements_guard BEFORE INSERT OR UPDATE OR DELETE ON schoollife.incident_involvements
  FOR EACH ROW EXECUTE FUNCTION schoollife.involvements_guard();

-- -----------------------------------------------------------------------------
-- Mesures : circuit de validation défini par le type, séparation des tâches, exclusions sans chevauchement
-- -----------------------------------------------------------------------------
CREATE FUNCTION schoollife.measures_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user uuid;
  v_type schoollife.event_types%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'schoollife.immutable: une mesure ne se supprime pas (la révoquer ou l''annuler avec un motif)' USING ERRCODE = 'restrict_violation';
  END IF;
  v_user := schoollife.require_human_actor();
  SELECT * INTO v_type FROM schoollife.event_types WHERE tenant_id = NEW.tenant_id AND id = NEW.type_id;

  IF TG_OP = 'INSERT' THEN
    IF NEW.proposed_by <> v_user THEN
      RAISE EXCEPTION 'schoollife.proposer_mismatch: le proposant est l''utilisateur de la session' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_type.kind NOT IN ('SANCTION', 'WARNING', 'TEMP_EXCLUSION') OR NOT v_type.active THEN
      RAISE EXCEPTION 'schoollife.type_kind: le type doit être un type de mesure actif (sanction, avertissement, exclusion temporaire)' USING ERRCODE = 'check_violation';
    END IF;
    NEW.kind := v_type.kind;
    IF v_type.requires_dates AND (NEW.starts_on IS NULL OR NEW.ends_on IS NULL) THEN
      RAISE EXCEPTION 'schoollife.dates_required: ce type de mesure exige des dates de début et de fin' USING ERRCODE = 'check_violation';
    END IF;
    IF v_type.requires_validation AND NEW.status <> 'PROPOSED' THEN
      RAISE EXCEPTION 'schoollife.validation_required: ce type de mesure se propose, puis se valide' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status NOT IN ('PROPOSED', 'VALIDATED') THEN
      RAISE EXCEPTION 'schoollife.initial_status' USING ERRCODE = 'check_violation';
    END IF;
    IF schoollife.confidentiality_rank(NEW.confidentiality) < schoollife.confidentiality_rank(v_type.confidentiality_default) THEN
      RAISE EXCEPTION 'schoollife.confidentiality_floor: la confidentialité ne peut pas être inférieure à celle du type (%)', v_type.confidentiality_default
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.visible_to_guardians := NEW.visible_to_guardians AND v_type.visible_to_guardians AND NEW.confidentiality <> 'CONFIDENTIAL';
    IF NEW.incident_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM schoollife.incident_involvements i
          WHERE i.tenant_id = NEW.tenant_id AND i.incident_id = NEW.incident_id AND i.student_id = NEW.student_id AND i.role IN ('AUTHOR', 'OTHER')) THEN
      RAISE EXCEPTION 'schoollife.not_involved: l''élève n''est pas désigné comme auteur de l''incident' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'VALIDATED' THEN
      NEW.validated_by := v_user;
      NEW.validated_at := now();
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.institution_id <> OLD.institution_id OR NEW.academic_year_id <> OLD.academic_year_id OR NEW.enrollment_id <> OLD.enrollment_id
     OR NEW.student_id <> OLD.student_id OR NEW.type_id <> OLD.type_id OR NEW.kind <> OLD.kind
     OR NEW.incident_id IS DISTINCT FROM OLD.incident_id OR NEW.proposed_by <> OLD.proposed_by OR NEW.proposed_at <> OLD.proposed_at THEN
    RAISE EXCEPTION 'schoollife.measure_identity_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status IN ('REJECTED', 'CANCELLED', 'REVOKED') THEN
    RAISE EXCEPTION 'schoollife.measure_final: mesure %', OLD.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'PROPOSED' AND (NEW.reason <> OLD.reason OR NEW.severity_code IS DISTINCT FROM OLD.severity_code) THEN
    RAISE EXCEPTION 'schoollife.measure_frozen: motif et gravité ne changent plus après la validation' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status IN ('NOTIFIED', 'EXECUTED', 'APPEALED') AND (NEW.starts_on IS DISTINCT FROM OLD.starts_on OR NEW.ends_on IS DISTINCT FROM OLD.ends_on) THEN
    RAISE EXCEPTION 'schoollife.measure_frozen: les dates ne changent plus après la notification' USING ERRCODE = 'restrict_violation';
  END IF;
  IF schoollife.confidentiality_rank(NEW.confidentiality) < schoollife.confidentiality_rank(OLD.confidentiality) THEN
    RAISE EXCEPTION 'schoollife.confidentiality_lowered: la confidentialité ne s''abaisse pas' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.visible_to_guardians AND NOT OLD.visible_to_guardians THEN
    RAISE EXCEPTION 'schoollife.visibility_widened: une mesure cachée aux familles ne leur est pas rendue visible' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT ((OLD.status, NEW.status) IN (
          ('PROPOSED', 'VALIDATED'), ('PROPOSED', 'REJECTED'), ('PROPOSED', 'CANCELLED'),
          ('VALIDATED', 'NOTIFIED'), ('VALIDATED', 'EXECUTED'), ('VALIDATED', 'CANCELLED'),
          ('NOTIFIED', 'EXECUTED'), ('NOTIFIED', 'APPEALED'), ('NOTIFIED', 'REVOKED'),
          ('EXECUTED', 'APPEALED'), ('EXECUTED', 'REVOKED'),
          ('APPEALED', 'EXECUTED'), ('APPEALED', 'REVOKED'))) THEN
      RAISE EXCEPTION 'schoollife.measure_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status = 'VALIDATED' THEN
      IF v_type.requires_four_eyes AND v_user = OLD.proposed_by THEN
        RAISE EXCEPTION 'schoollife.four_eyes_required: la validation doit venir d''une autre personne que le proposant' USING ERRCODE = 'insufficient_privilege';
      END IF;
      NEW.validated_by := v_user;
      NEW.validated_at := now();
    ELSIF NEW.status = 'NOTIFIED' THEN
      NEW.notified_by := v_user;
      NEW.notified_at := now();
    ELSIF NEW.status = 'EXECUTED' THEN
      NEW.executed_at := coalesce(OLD.executed_at, now());
    ELSIF NEW.status = 'REVOKED' THEN
      NEW.revoked_by := v_user;
      NEW.revoked_at := now();
    ELSIF NEW.status = 'APPEALED' THEN
      IF NOT v_type.appealable OR NOT EXISTS (
           SELECT 1 FROM schoollife.measure_appeals a WHERE a.tenant_id = NEW.tenant_id AND a.measure_id = NEW.id AND a.status = 'FILED') THEN
        RAISE EXCEPTION 'schoollife.not_appealable: un recours déposé sur une mesure susceptible de recours est nécessaire' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER measures_guard BEFORE INSERT OR UPDATE OR DELETE ON schoollife.measures
  FOR EACH ROW EXECUTE FUNCTION schoollife.measures_guard();

-- Recours : dépôt (mesure notifiée ou exécutée, type susceptible de recours) puis issue
CREATE FUNCTION schoollife.appeals_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user uuid;
  v_m    schoollife.measures%ROWTYPE;
  v_t    schoollife.event_types%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'schoollife.immutable: un recours ne se supprime pas' USING ERRCODE = 'restrict_violation';
  END IF;
  v_user := schoollife.require_human_actor();
  IF TG_OP = 'INSERT' THEN
    IF NEW.filed_by <> v_user THEN
      RAISE EXCEPTION 'schoollife.filer_mismatch' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status <> 'FILED' THEN
      RAISE EXCEPTION 'schoollife.initial_status' USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO v_m FROM schoollife.measures WHERE tenant_id = NEW.tenant_id AND id = NEW.measure_id;
    SELECT * INTO v_t FROM schoollife.event_types WHERE tenant_id = v_m.tenant_id AND id = v_m.type_id;
    IF NOT v_t.appealable OR v_m.status NOT IN ('NOTIFIED', 'EXECUTED') THEN
      RAISE EXCEPTION 'schoollife.not_appealable: la mesure n''est pas susceptible de recours dans son état (%)', v_m.status USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.measure_id <> OLD.measure_id OR NEW.filed_by <> OLD.filed_by OR NEW.filed_at <> OLD.filed_at OR NEW.reason <> OLD.reason THEN
    RAISE EXCEPTION 'schoollife.appeal_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'FILED' THEN
    RAISE EXCEPTION 'schoollife.appeal_final: recours déjà %', OLD.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status IN ('UPHELD', 'OVERTURNED') THEN
    IF NEW.decided_by IS DISTINCT FROM v_user THEN
      RAISE EXCEPTION 'schoollife.decider_mismatch: l''issue du recours est celle de l''utilisateur de la session' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.decided_at := now();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER appeals_guard BEFORE INSERT OR UPDATE OR DELETE ON schoollife.measure_appeals
  FOR EACH ROW EXECUTE FUNCTION schoollife.appeals_guard();

-- Effets du recours sur la mesure : dépôt -> APPEALED ; confirmé ou retiré -> EXECUTED ; annulé -> REVOKED
CREATE FUNCTION schoollife.appeals_after() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE schoollife.measures SET status = 'APPEALED' WHERE tenant_id = NEW.tenant_id AND id = NEW.measure_id;
  ELSIF NEW.status = 'UPHELD' OR NEW.status = 'WITHDRAWN' THEN
    UPDATE schoollife.measures SET status = 'EXECUTED' WHERE tenant_id = NEW.tenant_id AND id = NEW.measure_id AND status = 'APPEALED';
  ELSIF NEW.status = 'OVERTURNED' THEN
    UPDATE schoollife.measures SET status = 'REVOKED', revoked_reason = NEW.decision_note
     WHERE tenant_id = NEW.tenant_id AND id = NEW.measure_id AND status = 'APPEALED';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER appeals_after AFTER INSERT OR UPDATE ON schoollife.measure_appeals
  FOR EACH ROW EXECUTE FUNCTION schoollife.appeals_after();

-- -----------------------------------------------------------------------------
-- Encouragements et observations
-- -----------------------------------------------------------------------------
CREATE FUNCTION schoollife.notes_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user uuid;
  v_type schoollife.event_types%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'schoollife.immutable: une note ne se supprime pas (la retirer avec un motif)' USING ERRCODE = 'restrict_violation';
  END IF;
  v_user := schoollife.require_human_actor();
  IF TG_OP = 'INSERT' THEN
    IF NEW.author_id <> v_user THEN
      RAISE EXCEPTION 'schoollife.author_mismatch: l''auteur est l''utilisateur de la session' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO v_type FROM schoollife.event_types WHERE tenant_id = NEW.tenant_id AND id = NEW.type_id;
    IF v_type.kind NOT IN ('ENCOURAGEMENT', 'OBSERVATION') OR NOT v_type.active THEN
      RAISE EXCEPTION 'schoollife.type_kind: le type doit être un type d''encouragement ou d''observation actif' USING ERRCODE = 'check_violation';
    END IF;
    NEW.kind := v_type.kind;
    IF NEW.visibility <> 'STAFF_ONLY' AND NOT v_type.visible_to_guardians THEN
      RAISE EXCEPTION 'schoollife.visibility_forbidden: ce type d''événement n''est pas partageable avec les familles' USING ERRCODE = 'check_violation';
    END IF;
    IF schoollife.confidentiality_rank(NEW.confidentiality) < schoollife.confidentiality_rank(v_type.confidentiality_default) THEN
      RAISE EXCEPTION 'schoollife.confidentiality_floor: la confidentialité ne peut pas être inférieure à celle du type (%)', v_type.confidentiality_default
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.body <> OLD.body OR NEW.kind <> OLD.kind OR NEW.type_id <> OLD.type_id OR NEW.student_id <> OLD.student_id
     OR NEW.enrollment_id <> OLD.enrollment_id OR NEW.author_id <> OLD.author_id OR NEW.occurred_on <> OLD.occurred_on
     OR NEW.visibility <> OLD.visibility OR NEW.confidentiality <> OLD.confidentiality THEN
    RAISE EXCEPTION 'schoollife.note_immutable: une note ne change pas (la retirer et en écrire une autre)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'WITHDRAWN' THEN
    RAISE EXCEPTION 'schoollife.note_withdrawn' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status = 'WITHDRAWN' THEN
    NEW.withdrawn_by := v_user;
    NEW.withdrawn_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER notes_guard BEFORE INSERT OR UPDATE OR DELETE ON schoollife.notes
  FOR EACH ROW EXECUTE FUNCTION schoollife.notes_guard();

-- -----------------------------------------------------------------------------
-- Convocations
-- -----------------------------------------------------------------------------
CREATE FUNCTION schoollife.convocations_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'schoollife.immutable: une convocation ne se supprime pas (l''annuler avec un motif)' USING ERRCODE = 'restrict_violation';
  END IF;
  v_user := schoollife.require_human_actor();
  IF TG_OP = 'INSERT' THEN
    IF NEW.convened_by <> v_user THEN
      RAISE EXCEPTION 'schoollife.convener_mismatch' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'schoollife.initial_status: une convocation se crée DRAFT' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.student_id <> OLD.student_id OR NEW.enrollment_id <> OLD.enrollment_id OR NEW.convened_by <> OLD.convened_by
     OR NEW.academic_year_id <> OLD.academic_year_id OR NEW.institution_id <> OLD.institution_id THEN
    RAISE EXCEPTION 'schoollife.convocation_identity_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'DRAFT' AND (NEW.guardian_ids <> OLD.guardian_ids OR NEW.reason <> OLD.reason OR NEW.reason_kind <> OLD.reason_kind) THEN
    RAISE EXCEPTION 'schoollife.convocation_frozen: destinataires et motif ne changent plus après l''envoi' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status IN ('HELD', 'NO_SHOW', 'CANCELLED', 'RESCHEDULED') THEN
    RAISE EXCEPTION 'schoollife.convocation_final: convocation %', OLD.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT ((OLD.status, NEW.status) IN (
          ('DRAFT', 'SENT'), ('DRAFT', 'CANCELLED'),
          ('SENT', 'ACKNOWLEDGED'), ('SENT', 'HELD'), ('SENT', 'NO_SHOW'), ('SENT', 'CANCELLED'), ('SENT', 'RESCHEDULED'),
          ('ACKNOWLEDGED', 'HELD'), ('ACKNOWLEDGED', 'NO_SHOW'), ('ACKNOWLEDGED', 'CANCELLED'), ('ACKNOWLEDGED', 'RESCHEDULED'))) THEN
      RAISE EXCEPTION 'schoollife.convocation_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status = 'SENT' THEN
      NEW.sent_at := now();
    ELSIF NEW.status = 'ACKNOWLEDGED' THEN
      IF NEW.acknowledged_by_guardian_id IS NULL OR NOT (NEW.acknowledged_by_guardian_id = ANY (NEW.guardian_ids)) THEN
        RAISE EXCEPTION 'schoollife.acknowledger: l''accusé de réception doit venir d''un tuteur convoqué' USING ERRCODE = 'check_violation';
      END IF;
      NEW.acknowledged_at := now();
    ELSIF NEW.status = 'HELD' THEN
      NEW.held_at := now();
    END IF;
  END IF;
  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER convocations_guard BEFORE INSERT OR UPDATE OR DELETE ON schoollife.convocations
  FOR EACH ROW EXECUTE FUNCTION schoollife.convocations_guard();

-- -----------------------------------------------------------------------------
-- Barèmes de points de conduite
-- -----------------------------------------------------------------------------
CREATE FUNCTION schoollife.conduct_scales_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'schoollife.immutable: un barème ne se supprime pas (le retirer)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'schoollife.initial_status: un barème se crée DRAFT' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.institution_id <> OLD.institution_id OR NEW.code <> OLD.code THEN
    RAISE EXCEPTION 'schoollife.scale_identity_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'DRAFT' AND (NEW.initial_points <> OLD.initial_points OR NEW.min_points IS DISTINCT FROM OLD.min_points
       OR NEW.max_points IS DISTINCT FROM OLD.max_points OR NEW.reset_scope <> OLD.reset_scope
       OR NEW.grade_level_id IS DISTINCT FROM OLD.grade_level_id OR NEW.effective_from <> OLD.effective_from
       OR NEW.source_kind <> OLD.source_kind) THEN
    RAISE EXCEPTION 'schoollife.scale_frozen: un barème actif ou retiré ne change plus (en créer un nouveau)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'RETIRED' AND to_jsonb(NEW) - 'updated_at' IS DISTINCT FROM to_jsonb(OLD) - 'updated_at' THEN
    RAISE EXCEPTION 'schoollife.scale_frozen: barème retiré' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT ((OLD.status, NEW.status) IN (('DRAFT', 'ACTIVE'), ('DRAFT', 'RETIRED'), ('ACTIVE', 'RETIRED'))) THEN
      RAISE EXCEPTION 'schoollife.scale_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status = 'ACTIVE' THEN
      PERFORM schoollife.require_human_actor();
      IF NOT EXISTS (SELECT 1 FROM schoollife.conduct_scale_items i WHERE i.tenant_id = NEW.tenant_id AND i.scale_id = NEW.id) THEN
        RAISE EXCEPTION 'schoollife.scale_empty: un barème actif contient au moins une valeur' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER conduct_scales_guard BEFORE INSERT OR UPDATE OR DELETE ON schoollife.conduct_scales
  FOR EACH ROW EXECUTE FUNCTION schoollife.conduct_scales_guard();

CREATE FUNCTION schoollife.conduct_scale_items_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_row  schoollife.conduct_scale_items%ROWTYPE;
  v_stat text;
  v_kind text;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  SELECT status INTO v_stat FROM schoollife.conduct_scales WHERE tenant_id = v_row.tenant_id AND id = v_row.scale_id;
  IF v_stat <> 'DRAFT' THEN
    RAISE EXCEPTION 'schoollife.scale_frozen: les valeurs d''un barème ne se modifient qu''en brouillon (barème %)', v_stat USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT kind INTO v_kind FROM schoollife.event_types WHERE tenant_id = NEW.tenant_id AND id = NEW.event_type_id;
    IF v_kind IN ('INCIDENT', 'OBSERVATION') THEN
      RAISE EXCEPTION 'schoollife.type_kind: seuls les mesures et les encouragements ont une valeur en points' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END
$$;
CREATE TRIGGER conduct_scale_items_guard BEFORE INSERT OR UPDATE OR DELETE ON schoollife.conduct_scale_items
  FOR EACH ROW EXECUTE FUNCTION schoollife.conduct_scale_items_guard();

-- Mouvements : conformes au barème et à la source, jamais sans les points de conduite activés
CREATE FUNCTION schoollife.conduct_movements_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user   uuid;
  v_scale  schoollife.conduct_scales%ROWTYPE;
  v_set    schoollife.settings%ROWTYPE;
  v_orig   schoollife.conduct_movements%ROWTYPE;
  v_type   uuid;
  v_status text;
  v_enr    uuid;
  v_points integer;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'schoollife.immutable: le registre des points de conduite est en ajout seul (corriger par un mouvement inverse)' USING ERRCODE = 'restrict_violation';
  END IF;
  v_user := schoollife.require_human_actor();
  IF NEW.created_by <> v_user THEN
    RAISE EXCEPTION 'schoollife.author_mismatch' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_scale FROM schoollife.conduct_scales WHERE tenant_id = NEW.tenant_id AND id = NEW.scale_id;
  IF v_scale.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'schoollife.scale_not_active: barème %', v_scale.status USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_set FROM schoollife.settings WHERE tenant_id = NEW.tenant_id AND institution_id = v_scale.institution_id;
  IF v_set.tenant_id IS NULL OR NOT v_set.conduct_points_enabled THEN
    RAISE EXCEPTION 'schoollife.conduct_disabled: les points de conduite ne sont pas activés pour cet établissement' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.reverses_id IS NOT NULL THEN
    SELECT * INTO v_orig FROM schoollife.conduct_movements WHERE tenant_id = NEW.tenant_id AND id = NEW.reverses_id;
    IF v_orig.reverses_id IS NOT NULL OR v_orig.scale_id <> NEW.scale_id OR v_orig.enrollment_id <> NEW.enrollment_id
       OR v_orig.student_id <> NEW.student_id OR NEW.delta <> -v_orig.delta THEN
      RAISE EXCEPTION 'schoollife.reversal_mismatch: un mouvement inverse annule exactement un mouvement du même barème et du même élève' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.source_kind = 'MEASURE' THEN
    SELECT m.type_id, m.status, m.enrollment_id INTO v_type, v_status, v_enr FROM schoollife.measures m WHERE m.tenant_id = NEW.tenant_id AND m.id = NEW.source_id;
    IF v_status IS NULL OR v_status NOT IN ('VALIDATED', 'NOTIFIED', 'EXECUTED') OR v_enr <> NEW.enrollment_id THEN
      RAISE EXCEPTION 'schoollife.source_invalid: la mesure doit être validée et concerner cette inscription' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.source_kind = 'NOTE' THEN
    SELECT n.type_id, n.status, n.enrollment_id INTO v_type, v_status, v_enr FROM schoollife.notes n WHERE n.tenant_id = NEW.tenant_id AND n.id = NEW.source_id;
    IF v_status IS NULL OR v_status <> 'ACTIVE' OR v_enr <> NEW.enrollment_id THEN
      RAISE EXCEPTION 'schoollife.source_invalid: la note doit être active et concerner cette inscription' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.source_kind IN ('MEASURE', 'NOTE') THEN
    SELECT i.points_delta INTO v_points FROM schoollife.conduct_scale_items i WHERE i.tenant_id = NEW.tenant_id AND i.scale_id = NEW.scale_id AND i.event_type_id = v_type;
    IF v_points IS NULL OR v_points <> NEW.delta THEN
      RAISE EXCEPTION 'schoollife.delta_not_in_scale: les points doivent être ceux du barème pour ce type d''événement' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    -- ajustement manuel : réservé au motif explicite, la valeur reste libre mais jamais nulle
    NULL;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER conduct_movements_guard BEFORE INSERT OR UPDATE OR DELETE ON schoollife.conduct_movements
  FOR EACH ROW EXECUTE FUNCTION schoollife.conduct_movements_guard();

-- -----------------------------------------------------------------------------
-- Historique automatique (ajout seul) et lectures confidentielles
-- -----------------------------------------------------------------------------
CREATE FUNCTION schoollife.log_life_event() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_json   jsonb := to_jsonb(NEW);
  v_reason text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM (to_jsonb(OLD)->>'status') THEN
    RETURN NEW;
  END IF;
  v_reason := coalesce(v_json->>'revoked_reason', v_json->>'cancel_reason', v_json->>'resolution_note',
                       v_json->>'withdrawn_reason', v_json->>'validation_note', v_json->>'decision_note');
  INSERT INTO schoollife.life_events (id, tenant_id, entity_kind, entity_id, student_id, action, from_status, to_status, actor_id, actor_kind, reason)
  VALUES (gen_random_uuid(), NEW.tenant_id, TG_ARGV[0], NEW.id, NULLIF(v_json->>'student_id', '')::uuid,
          CASE WHEN TG_OP = 'INSERT' THEN 'CREATED' ELSE 'STATUS_CHANGED' END,
          CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD)->>'status' END, v_json->>'status',
          kernel.current_user_id(), kernel.current_actor(), v_reason);
  RETURN NEW;
END
$$;
CREATE TRIGGER incidents_log AFTER INSERT OR UPDATE ON schoollife.incidents
  FOR EACH ROW EXECUTE FUNCTION schoollife.log_life_event('INCIDENT');
CREATE TRIGGER measures_log AFTER INSERT OR UPDATE ON schoollife.measures
  FOR EACH ROW EXECUTE FUNCTION schoollife.log_life_event('MEASURE');
CREATE TRIGGER notes_log AFTER INSERT OR UPDATE ON schoollife.notes
  FOR EACH ROW EXECUTE FUNCTION schoollife.log_life_event('NOTE');
CREATE TRIGGER convocations_log AFTER INSERT OR UPDATE ON schoollife.convocations
  FOR EACH ROW EXECUTE FUNCTION schoollife.log_life_event('CONVOCATION');
CREATE TRIGGER appeals_log AFTER INSERT OR UPDATE ON schoollife.measure_appeals
  FOR EACH ROW EXECUTE FUNCTION schoollife.log_life_event('APPEAL');
CREATE TRIGGER conduct_scales_log AFTER INSERT OR UPDATE ON schoollife.conduct_scales
  FOR EACH ROW EXECUTE FUNCTION schoollife.log_life_event('SCALE');

CREATE TRIGGER life_events_immutable BEFORE UPDATE OR DELETE ON schoollife.life_events
  FOR EACH ROW EXECUTE FUNCTION schoollife.forbid_mutation();
CREATE TRIGGER confidential_reads_immutable BEFORE UPDATE OR DELETE ON schoollife.confidential_reads
  FOR EACH ROW EXECUTE FUNCTION schoollife.forbid_mutation();

CREATE FUNCTION schoollife.confidential_reads_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user uuid := schoollife.require_human_actor();
BEGIN
  IF NEW.reader_user_id <> v_user THEN
    RAISE EXCEPTION 'schoollife.reader_mismatch: le lecteur journalisé est l''utilisateur de la session' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER confidential_reads_guard BEFORE INSERT ON schoollife.confidential_reads
  FOR EACH ROW EXECUTE FUNCTION schoollife.confidential_reads_guard();
```

### 5.9 `stateassign` — dossiers d'affectation, contrôles, documents

<!-- migration: 2000_stateassign_init.sql -->
```sql
-- =============================================================================
-- 2000 — Module stateassign : élèves affectés par l'État (STATE_ASSIGNED, PRD §20)
-- =============================================================================
--
-- Plage de numéros proposée : 2000–2099 (plage définitive attribuée par `pnpm module:new`).
--
-- Ce que ce module ajoute à ce qui existe déjà :
--   - `academic.enrollments` porte `funding_type` et la référence d'affectation (004) ;
--   - `finance` porte les montants facturés, les parts État / parent (bourses et factures liées) et les
--     créances (014) ;
--   - `attendance` porte la présence (010) ; la GED (024) ou `people` portent les fichiers.
-- Ici : le DOSSIER D'AFFECTATION (référence, autorité, montants DÉCLARÉS par l'acte d'affectation,
-- vérification humaine, cycle de vie, avenants versionnés), les CONTRÔLES périodiques, les documents
-- (références), le rapprochement avec la facturation, et le point d'ancrage de la future couche d'intégration
-- (`source`, `external_*`) derrière un port. Aucune règle officielle n'est codée : les périodicités de contrôle
-- et les tolérances sont des paramètres d'établissement.
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
CREATE TABLE stateassign.settings (
  tenant_id                  uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id             uuid NOT NULL,
  require_separate_verifier  boolean NOT NULL DEFAULT true,
  reconciliation_tolerance   bigint NOT NULL DEFAULT 0 CHECK (reconciliation_tolerance >= 0),
  required_control_kinds     text[] NOT NULL DEFAULT '{}'
                             CHECK (required_control_kinds <@ ARRAY['ATTENDANCE', 'IDENTITY', 'FINANCE_RECONCILIATION', 'DOCUMENTS', 'OTHER']::text[]),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, institution_id)
);
SELECT kernel.enable_tenant_rls('stateassign.settings');
GRANT SELECT, INSERT, UPDATE ON stateassign.settings TO app_user;

-- Dossier d'affectation (versionné : un avenant crée une nouvelle version, l'ancienne passe SUPERSEDED).
--   declared_state_amount / declared_parent_amount : montants DÉCLARÉS par l'acte (entiers, unités mineures) ;
--                          les montants FACTURÉS vivent dans `finance` ; l'écart est calculé au rapprochement.
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
  reconciled_state_delta   bigint,
  reconciled_parent_delta  bigint,
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
CREATE INDEX assignments_by_year ON stateassign.assignments (tenant_id, academic_year_id, institution_id, status);
CREATE INDEX assignments_unreconciled ON stateassign.assignments (tenant_id, institution_id) WHERE status = 'ACTIVE' AND reconciliation_status <> 'BALANCED';
GRANT SELECT, INSERT, UPDATE ON stateassign.assignments TO app_user;

-- Contrôles périodiques (présence, identité, rapprochement financier, pièces…) : planifiés puis réalisés par un humain.
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
  evidence             jsonb NOT NULL DEFAULT '{}'::jsonb,   -- faits constatés (comptages), sans donnée personnelle
  anomaly_resolution   text,
  anomaly_resolved_at  timestamptz,
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

-- Historique du dossier (ajout seul) : alimenté par les déclencheurs (2001).
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
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, assignment_id) REFERENCES stateassign.assignments (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('stateassign.assignment_events');
CREATE INDEX assignment_events_by_assignment ON stateassign.assignment_events (tenant_id, assignment_id, occurred_at);
GRANT SELECT, INSERT ON stateassign.assignment_events TO app_user;
```

### 5.10 `stateassign` — invariants imposés par la base

<!-- migration: 2001_stateassign_guards.sql -->
```sql
-- =============================================================================
-- 2001 — Module stateassign : invariants imposés par la base
-- =============================================================================
--
--   1. la VÉRIFICATION d'une affectation, son activation, son rejet, sa suspension, sa fin sont des actes
--      HUMAINS (un job ne peut que RAPPROCHER et enregistrer des affectations importées) ;
--   2. séparation des tâches : celui qui enregistre n'est pas celui qui vérifie (réglage) ;
--   3. contenu figé dès la vérification : un avenant crée une NOUVELLE VERSION (l'ancienne est d'abord
--      remplacée), jamais une modification en place ;
--   4. rapprochement : le statut est CALCULÉ par la base depuis les écarts et la tolérance d'établissement ;
--   5. contrôles réalisés par un humain, anomalies résolues avec motif ; journal en ajout seul.
-- =============================================================================

CREATE FUNCTION stateassign.assignments_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user uuid;
  v_set  stateassign.settings%ROWTYPE;
  v_prev stateassign.assignments%ROWTYPE;
  v_only_links boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stateassign.immutable: un dossier d''affectation ne se supprime pas' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT * INTO v_set FROM stateassign.settings WHERE tenant_id = NEW.tenant_id AND institution_id = NEW.institution_id;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'RECEIVED' THEN
      RAISE EXCEPTION 'stateassign.initial_status: un dossier se crée RECEIVED' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.source = 'MANUAL' THEN
      v_user := stateassign.require_human_actor();
      IF NEW.received_by IS DISTINCT FROM v_user THEN
        RAISE EXCEPTION 'stateassign.receiver_mismatch: l''enregistrant est l''utilisateur de la session' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
    NEW.assignment_reference := btrim(NEW.assignment_reference);
    IF NEW.supersedes_id IS NOT NULL THEN
      SELECT * INTO v_prev FROM stateassign.assignments WHERE tenant_id = NEW.tenant_id AND id = NEW.supersedes_id;
      IF v_prev.status <> 'SUPERSEDED' OR v_prev.enrollment_id <> NEW.enrollment_id OR NEW.version <> v_prev.version + 1
         OR v_prev.academic_year_id <> NEW.academic_year_id THEN
        RAISE EXCEPTION 'stateassign.amendment_invalid: un avenant suit une version REMPLACÉE de la même inscription (version + 1)' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.institution_id <> OLD.institution_id OR NEW.academic_year_id <> OLD.academic_year_id OR NEW.enrollment_id <> OLD.enrollment_id
     OR NEW.student_id <> OLD.student_id OR NEW.version <> OLD.version OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id
     OR NEW.source <> OLD.source OR NEW.external_ref IS DISTINCT FROM OLD.external_ref
     OR NEW.external_payload_hash IS DISTINCT FROM OLD.external_payload_hash
     OR NEW.received_by IS DISTINCT FROM OLD.received_by OR NEW.received_at <> OLD.received_at THEN
    RAISE EXCEPTION 'stateassign.identity_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'RECEIVED' AND (NEW.assignment_reference <> OLD.assignment_reference OR NEW.issued_on IS DISTINCT FROM OLD.issued_on
       OR NEW.issuing_authority IS DISTINCT FROM OLD.issuing_authority
       OR NEW.declared_state_amount IS DISTINCT FROM OLD.declared_state_amount
       OR NEW.declared_parent_amount IS DISTINCT FROM OLD.declared_parent_amount OR NEW.currency <> OLD.currency) THEN
    RAISE EXCEPTION 'stateassign.content_frozen: référence, autorité et montants déclarés ne changent plus après vérification (créer un avenant)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  NEW.assignment_reference := btrim(NEW.assignment_reference);
  IF OLD.status IN ('REJECTED', 'SUPERSEDED') AND to_jsonb(NEW) - 'updated_at' - 'row_version' IS DISTINCT FROM to_jsonb(OLD) - 'updated_at' - 'row_version' THEN
    RAISE EXCEPTION 'stateassign.final: dossier %', OLD.status USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.status <> OLD.status THEN
    IF NOT ((OLD.status, NEW.status) IN (
          ('RECEIVED', 'VERIFIED'), ('RECEIVED', 'REJECTED'), ('RECEIVED', 'SUPERSEDED'),
          ('VERIFIED', 'ACTIVE'), ('VERIFIED', 'REJECTED'), ('VERIFIED', 'SUPERSEDED'),
          ('ACTIVE', 'SUSPENDED'), ('ACTIVE', 'ENDED'), ('ACTIVE', 'TRANSFERRED'), ('ACTIVE', 'SUPERSEDED'),
          ('SUSPENDED', 'ACTIVE'), ('SUSPENDED', 'ENDED'), ('SUSPENDED', 'SUPERSEDED'))) THEN
      RAISE EXCEPTION 'stateassign.transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
    v_user := stateassign.require_human_actor();
    IF NEW.status = 'VERIFIED' THEN
      IF coalesce(v_set.require_separate_verifier, true) AND OLD.received_by IS NOT DISTINCT FROM v_user THEN
        RAISE EXCEPTION 'stateassign.four_eyes_required: la vérification doit venir d''une autre personne que l''enregistrant' USING ERRCODE = 'insufficient_privilege';
      END IF;
      NEW.verified_by := v_user;
      NEW.verified_at := now();
    ELSIF NEW.status = 'ACTIVE' THEN
      NEW.activated_at := coalesce(OLD.activated_at, now());
      NEW.suspended_at := NULL;
    ELSIF NEW.status = 'SUSPENDED' THEN
      NEW.suspended_at := now();
    END IF;
  END IF;

  -- Rapprochement : le statut est CALCULÉ (écarts et tolérance d'établissement), jamais saisi.
  IF NEW.last_reconciled_at IS DISTINCT FROM OLD.last_reconciled_at OR NEW.reconciled_state_delta IS DISTINCT FROM OLD.reconciled_state_delta
     OR NEW.reconciled_parent_delta IS DISTINCT FROM OLD.reconciled_parent_delta THEN
    IF NEW.last_reconciled_at IS NULL OR NEW.reconciled_state_delta IS NULL OR NEW.reconciled_parent_delta IS NULL THEN
      RAISE EXCEPTION 'stateassign.reconciliation_incomplete: date et écarts État / parent sont requis ensemble' USING ERRCODE = 'check_violation';
    END IF;
    NEW.reconciliation_status := CASE
      WHEN abs(NEW.reconciled_state_delta) <= coalesce(v_set.reconciliation_tolerance, 0)
       AND abs(NEW.reconciled_parent_delta) <= coalesce(v_set.reconciliation_tolerance, 0) THEN 'BALANCED' ELSE 'DISCREPANCY' END;
  ELSE
    NEW.reconciliation_status := OLD.reconciliation_status;
  END IF;

  -- Toute autre modification de fond exige un humain ; le rapprochement et les liens finance peuvent venir d'un job.
  v_only_links := (to_jsonb(NEW) - 'updated_at' - 'row_version' - 'last_reconciled_at' - 'reconciled_state_delta' - 'reconciled_parent_delta'
                   - 'reconciliation_status' - 'finance_scholarship_id' - 'finance_state_invoice_id' - 'finance_parent_invoice_id')
                  IS NOT DISTINCT FROM
                  (to_jsonb(OLD) - 'updated_at' - 'row_version' - 'last_reconciled_at' - 'reconciled_state_delta' - 'reconciled_parent_delta'
                   - 'reconciliation_status' - 'finance_scholarship_id' - 'finance_state_invoice_id' - 'finance_parent_invoice_id');
  IF NOT v_only_links AND NEW.status = OLD.status THEN
    PERFORM stateassign.require_human_actor();
  END IF;
  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER assignments_guard BEFORE INSERT OR UPDATE OR DELETE ON stateassign.assignments
  FOR EACH ROW EXECUTE FUNCTION stateassign.assignments_guard();

-- Historique automatique
CREATE FUNCTION stateassign.log_assignment_event() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_reason text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO stateassign.assignment_events (id, tenant_id, assignment_id, action, to_status, actor_id, actor_kind, data)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, 'CREATED', NEW.status, kernel.current_user_id(), kernel.current_actor(),
            jsonb_build_object('version', NEW.version, 'source', NEW.source));
    RETURN NEW;
  END IF;
  IF NEW.status <> OLD.status THEN
    v_reason := coalesce(NEW.rejection_reason, NEW.suspension_reason, NEW.end_reason, NEW.verification_note);
    INSERT INTO stateassign.assignment_events (id, tenant_id, assignment_id, action, from_status, to_status, actor_id, actor_kind, reason)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, 'STATUS_CHANGED', OLD.status, NEW.status, kernel.current_user_id(), kernel.current_actor(), v_reason);
  END IF;
  IF NEW.last_reconciled_at IS DISTINCT FROM OLD.last_reconciled_at THEN
    INSERT INTO stateassign.assignment_events (id, tenant_id, assignment_id, action, actor_id, actor_kind, data)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, 'RECONCILED', kernel.current_user_id(), kernel.current_actor(),
            jsonb_build_object('stateDelta', NEW.reconciled_state_delta::text, 'parentDelta', NEW.reconciled_parent_delta::text, 'status', NEW.reconciliation_status));
  END IF;
  IF NEW.finance_scholarship_id IS DISTINCT FROM OLD.finance_scholarship_id OR NEW.finance_state_invoice_id IS DISTINCT FROM OLD.finance_state_invoice_id
     OR NEW.finance_parent_invoice_id IS DISTINCT FROM OLD.finance_parent_invoice_id THEN
    INSERT INTO stateassign.assignment_events (id, tenant_id, assignment_id, action, actor_id, actor_kind)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id, 'LINKED', kernel.current_user_id(), kernel.current_actor());
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER assignments_log AFTER INSERT OR UPDATE ON stateassign.assignments
  FOR EACH ROW EXECUTE FUNCTION stateassign.log_assignment_event();
CREATE TRIGGER assignment_events_immutable BEFORE UPDATE OR DELETE ON stateassign.assignment_events
  FOR EACH ROW EXECUTE FUNCTION stateassign.forbid_mutation();

-- Contrôles : planifiés (humain ou job), réalisés par un humain, anomalie résolue avec motif
CREATE FUNCTION stateassign.controls_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user uuid;
  v_stat text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stateassign.immutable: un contrôle ne se supprime pas' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT status INTO v_stat FROM stateassign.assignments WHERE tenant_id = NEW.tenant_id AND id = NEW.assignment_id;
  IF TG_OP = 'INSERT' THEN
    IF v_stat NOT IN ('VERIFIED', 'ACTIVE', 'SUSPENDED') THEN
      RAISE EXCEPTION 'stateassign.control_state: un contrôle se planifie sur un dossier vérifié, actif ou suspendu (dossier %)', v_stat USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> 'PENDING' THEN
      RAISE EXCEPTION 'stateassign.initial_status: un contrôle se planifie PENDING' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.assignment_id <> OLD.assignment_id OR NEW.kind <> OLD.kind OR NEW.academic_period_id IS DISTINCT FROM OLD.academic_period_id OR NEW.due_on <> OLD.due_on THEN
    RAISE EXCEPTION 'stateassign.control_identity_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT ((OLD.status, NEW.status) IN (('PENDING', 'OK'), ('PENDING', 'ANOMALY'), ('PENDING', 'WAIVED'), ('ANOMALY', 'OK'))) THEN
      RAISE EXCEPTION 'stateassign.control_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
    v_user := stateassign.require_human_actor();
    IF OLD.status = 'PENDING' THEN
      NEW.performed_by := v_user;
      NEW.performed_at := now();
    ELSE
      IF length(btrim(coalesce(NEW.anomaly_resolution, ''))) < 5 THEN
        RAISE EXCEPTION 'stateassign.resolution_required: une anomalie se résout avec un motif' USING ERRCODE = 'check_violation';
      END IF;
      NEW.anomaly_resolved_at := now();
    END IF;
  ELSIF OLD.status IN ('OK', 'WAIVED') THEN
    RAISE EXCEPTION 'stateassign.control_final: contrôle %', OLD.status USING ERRCODE = 'restrict_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER controls_guard BEFORE INSERT OR UPDATE OR DELETE ON stateassign.controls
  FOR EACH ROW EXECUTE FUNCTION stateassign.controls_guard();

-- Documents : références seulement, retrait motivé
CREATE FUNCTION stateassign.documents_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stateassign.immutable: un document ne se supprime pas (le retirer avec un motif)' USING ERRCODE = 'restrict_violation';
  END IF;
  v_user := stateassign.require_human_actor();
  IF TG_OP = 'INSERT' THEN
    IF NEW.added_by <> v_user THEN
      RAISE EXCEPTION 'stateassign.adder_mismatch' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.assignment_id <> OLD.assignment_id OR NEW.kind <> OLD.kind OR NEW.document_ref <> OLD.document_ref OR NEW.added_by <> OLD.added_by THEN
    RAISE EXCEPTION 'stateassign.document_immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'WITHDRAWN' THEN
    RAISE EXCEPTION 'stateassign.document_withdrawn' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status = 'WITHDRAWN' THEN
    NEW.withdrawn_by := v_user;
    NEW.withdrawn_at := now();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER documents_guard BEFORE INSERT OR UPDATE OR DELETE ON stateassign.documents
  FOR EACH ROW EXECUTE FUNCTION stateassign.documents_guard();
```

## 6. Invariants : qui les garantit

| Invariant | Base | Domaine (TypeScript) | Test |
|---|---|---|---|
| Isolation par tenant, FK composites | RLS forcée, `kernel.enable_tenant_rls`, FK `(tenant_id, id)` | `TenantDb` uniquement | `councils` : isolation et droits ; test d'isolation générique de la plateforme (37 tables, allowlists vides) |
| Aucune décision sans humain | `require_human_actor` dans chaque garde ; `recorded_by` = `kernel.current_user_id()` | refus 403 `*.human_decision_required` avant même la requête | acteur `system` / `superAdmin` refusé sur ouverture, décision, résolution, signature, mesure, vérification |
| Décideur présent et habilité | `decisions_guard` (présence, `can_decide`, appartenance à la séance) | contrôle de rôle d'`rbac` (`council.decision.record`) | « le décideur est un participant PRÉSENT et habilité » |
| Écart avec la suggestion justifié | CHECK ≥ 20 caractères | affichage de la suggestion | « écart avec la suggestion de la règle… » |
| Quorum, président, rôles exigés | `check_quorum` + `councils_guard` (NULL = pas de contrôle) | message d'aide, dérogation motivée si le réglage l'autorise | « quorum », « rôles exigés » |
| Séance verrouillée | `councils_guard`, gardes des tables filles | écrans en lecture seule | « la séance verrouillée fige… » |
| Déverrouillage motivé, approuvé, consommé | `unlock_requests_guard` + `councils_guard` | permission sensible `council.unlock` (MFA), audit | « déverrouillage motivé… » |
| PV immuable, hash base, signatures sur ce hash | `minutes_guard`, `signatures_guard`, `minutes_hash` | rendu PDF dans le worker | « procès-verbal immuable », « signatures… » |
| Signatures concurrentes | verrou de ligne du PV (`FOR UPDATE`) | — | « deux signataires qui signent en même temps » |
| Exclusion = application humaine | `effects_guard` (`AWAITING_HUMAN`, `applied_by`) | acte `student.status.update` de `people` | « l'exclusion n'est JAMAIS appliquée automatiquement » |
| Un seul conseil vivant par classe, type, période | index unique partiel | message `councils.duplicate` | test de concurrence |
| Mesures : validation, quatre yeux, exclusions sans chevauchement | `measures_guard`, contrainte d'exclusion | permission du type (`approver_permission`) | « mesures : circuit de validation… » |
| Confidentialité jamais abaissée ; jamais visible d'une famille | `confidentiality_rank`, gardes, `audience_may_see` | filtre des lectures de portail ; journal des lectures confidentielles | « qui voit quoi » |
| Barème actif unique, figé ; mouvements conformes | contrainte d'exclusion, gardes | calcul du solde, jamais d'arrondi caché | « barèmes de points de conduite » |
| Rapprochement calculé | `assignments_guard` | job de rapprochement (port `finance`) | « rapprochement avec la facturation » |
| Avenant versionné | `assignments_guard` (supersedes, version + 1) | cas d'usage `amendAssignment` | « avenant » |

## 7. Données de départ (modèle de pack `SECONDARY`)

Instanciées au provisioning par les abonnés `councils.instantiate-reference-data`, `schoollife.instantiate-reference-data` (événement `tenancy.tenant.provisioned`, idempotents, sans écraser une ligne personnalisée). **Tout est générique et marqué de démonstration** : aucun quorum, aucun barème, aucun parcours d'orientation, aucune règle de passage officiels (voir `regulatory-sources-needed.md`). Les codes de résultats (`PROMOTED`, `REPEAT`) et d'issues d'inscription (`PROMOTED`, `REPEATED`, `ORIENTED`, `REORIENTED`, `EXCLUDED`) sont ceux des contrats `coef-semester@1` de `rules` et du modèle de pack `academic/templates/CI/secondary.json` : ce sont des **codes d'intégration**, pas des règles.

```json
{
  "section": "councils",
  "schemaVersion": 1,
  "templateVersion": 1,
  "educationSystem": "CI",
  "pack": "SECONDARY",
  "participantRoles": [
    { "code": "PRESIDENT",        "label": "Président du conseil",  "canDecide": true,  "isVoting": true,  "countsForQuorum": true },
    { "code": "SECRETARY",        "label": "Secrétaire de séance",  "canDecide": false, "isVoting": false, "countsForQuorum": true },
    { "code": "HOMEROOM_TEACHER", "label": "Professeur principal",  "canDecide": false, "isVoting": true,  "countsForQuorum": true },
    { "code": "TEACHER",          "label": "Enseignant de la classe", "canDecide": false, "isVoting": true, "countsForQuorum": true },
    { "code": "EDUCATOR",         "label": "Éducateur / vie scolaire", "canDecide": false, "isVoting": false, "countsForQuorum": false },
    { "code": "STUDENT_REP",      "label": "Délégué des élèves",    "isExternal": true, "isVoting": false, "countsForQuorum": false },
    { "code": "PARENT_REP",       "label": "Délégué des parents",   "isExternal": true, "isVoting": false, "countsForQuorum": false }
  ],
  "councilTypes": [
    { "code": "PERIOD_COUNCIL",   "label": "Conseil de classe de période", "scope": "PERIOD", "minResultsStatus": "GRADING_LOCKED", "minParticipants": null, "requiredRoleCodes": [], "signerFunctions": ["PRESIDENT", "SECRETARY"], "requiresDecisionPerStudent": false },
    { "code": "YEAR_END_COUNCIL", "label": "Conseil de classe de fin d'année", "scope": "YEAR", "minResultsStatus": "GRADING_LOCKED", "minParticipants": null, "requiredRoleCodes": [], "signerFunctions": ["PRESIDENT", "SECRETARY"], "requiresDecisionPerStudent": true }
  ],
  "decisionTypes": [
    { "code": "PASSAGE",       "label": "Passage en classe supérieure", "family": "PASSAGE", "appliesTo": "YEAR", "exclusiveGroup": "YEAR_OUTCOME", "resultsDecisionKind": "YEAR_END", "resultsFinalCode": "PROMOTED", "academicOutcomeCode": "PROMOTED" },
    { "code": "REPEAT",        "label": "Redoublement", "family": "REPEAT", "appliesTo": "YEAR", "exclusiveGroup": "YEAR_OUTCOME", "requiresJustification": true, "resultsDecisionKind": "YEAR_END", "resultsFinalCode": "REPEAT", "academicOutcomeCode": "REPEATED" },
    { "code": "ORIENTATION",   "label": "Orientation", "family": "ORIENTATION", "appliesTo": "YEAR", "exclusiveGroup": "YEAR_OUTCOME", "requiresTarget": true, "academicOutcomeCode": "ORIENTED" },
    { "code": "REORIENTATION", "label": "Réorientation", "family": "REORIENTATION", "appliesTo": "BOTH", "requiresTarget": true, "requiresJustification": true, "academicOutcomeCode": "REORIENTED" },
    { "code": "EXCLUSION",     "label": "Exclusion (recommandation du conseil)", "family": "EXCLUSION", "appliesTo": "BOTH", "requiresJustification": true, "needsHumanApplication": true, "academicOutcomeCode": "EXCLUDED" },
    { "code": "REQUIRED_OPINION", "label": "Avis requis du conseil", "family": "REQUIRED_OPINION", "appliesTo": "BOTH" },
    { "code": "OTHER",         "label": "Autre décision", "family": "OTHER", "appliesTo": "BOTH", "requiresJustification": true }
  ],
  "settings": { "requireSeparateUnlocker": true, "effectsTrigger": "SIGNED", "guardianVisibility": "AFTER_NOTIFICATION", "allowQuorumWaiver": true },
  "orientationPaths": []
}
```

```json
{
  "section": "schoollife",
  "schemaVersion": 1,
  "templateVersion": 1,
  "educationSystem": "CI",
  "pack": "SECONDARY",
  "severityLevels": [
    { "code": "LOW", "label": "Faible", "rank": 1 }, { "code": "MEDIUM", "label": "Moyenne", "rank": 2 }, { "code": "HIGH", "label": "Élevée", "rank": 3 }
  ],
  "eventTypes": [
    { "code": "INCIDENT_GENERIC",    "label": "Incident (générique)", "kind": "INCIDENT", "isPlaceholder": true },
    { "code": "WARNING_GENERIC",     "label": "Avertissement (générique)", "kind": "WARNING", "notifyGuardians": true, "isPlaceholder": true },
    { "code": "SANCTION_GENERIC",    "label": "Sanction (générique)", "kind": "SANCTION", "requiresValidation": true, "requiresFourEyes": true, "approverPermission": "schoollife.measure.validate", "notifyGuardians": true, "appealable": true, "isPlaceholder": true },
    { "code": "TEMP_EXCLUSION_GENERIC", "label": "Exclusion temporaire (générique)", "kind": "TEMP_EXCLUSION", "requiresValidation": true, "requiresFourEyes": true, "requiresDates": true, "approverPermission": "schoollife.exclusion.validate", "notifyGuardians": true, "appealable": true, "isPlaceholder": true },
    { "code": "ENCOURAGEMENT_GENERIC", "label": "Encouragement (générique)", "kind": "ENCOURAGEMENT", "isPlaceholder": true },
    { "code": "OBSERVATION_GENERIC", "label": "Observation (générique)", "kind": "OBSERVATION", "visibleToGuardians": false, "confidentialityDefault": "RESTRICTED", "isPlaceholder": true }
  ],
  "settings": { "conductPointsEnabled": false, "confidentialReadRequiresPurpose": true, "retentionDays": null },
  "conductScales": []
}
```

Les **types réels** (bavardage, retard répété, violence…), les **gravités** et les **barèmes** de points sont à fournir par l'établissement ou par le propriétaire du produit (`open-questions.md` Q6-14 à Q6-18) ; aucune liste n'est reprise du code legacy (il n'en existe pas : seule la note de conduite /20 par semestre du pack Professional existe, voir `parity.md`).

## 8. Chemins d'accès et index

| Besoin | Requête | Index |
|---|---|---|
| Conseils d'une classe, d'un établissement | `WHERE classroom_id = $1 AND status` / `WHERE academic_year_id = $1 AND institution_id = $2` | `councils_by_classroom`, `councils_by_year` |
| Séances à venir (agenda) | `WHERE scheduled_at >= now() AND status IN ('PLANNED','OPEN')` | `councils_by_schedule` |
| Ordre du jour d'une séance | `WHERE council_id = $1 ORDER BY position` | `agenda_items_by_council` |
| Historique de décisions d'un élève | `WHERE student_id = $1 ORDER BY decided_at` | `decisions_by_student` |
| Effets à traiter | `WHERE status IN ('PENDING','FAILED','AWAITING_HUMAN')` | `effects_pending` |
| Fiche de vie scolaire d'un élève | `WHERE student_id = $1 AND academic_year_id = $2` | `measures_by_student`, `notes_by_student`, `convocations_by_student` |
| Mesures à valider | `WHERE institution_id = $1 AND status = 'PROPOSED'` | `measures_pending` |
| Convocations à échéance | `WHERE scheduled_at < now() + interval '1 day' AND status IN ('SENT','ACKNOWLEDGED')` | `convocations_due` |
| Solde de conduite | `schoollife.conduct_balance(student, scale, year, period)` | `conduct_movements_by_student` |
| Dossiers à rapprocher | `WHERE status = 'ACTIVE' AND reconciliation_status <> 'BALANCED'` | `assignments_unreconciled` |
| Contrôles à faire / anomalies | `WHERE due_on < $1 AND status = 'PENDING'` / `status = 'ANOMALY'` | `controls_due`, `controls_anomalies` |

## 9. Projections et lectures croisées

- `councils` lit `results` (`getClassMatrix`, `listDecisions`, `listAppreciations`), `attendance` (`getClassroomAttendanceSummary`), `schoollife` (`getClassroomLifeSummary`), `people` (`listAssignmentsForClassroom` pour proposer les participants), `academic` (`getRoster`, `listNodesForClassroom`) **par ports**, jamais par SQL inter-schéma.
- `schoollife` lit `academic` (inscription, classe) et `people` (tuteurs) par ports ; publie `getStudentLifeSummary`, `getClassroomLifeSummary` (comptages, jamais le détail confidentiel), `getConductPoints`, `getDisciplineFacts` (faits pour 018).
- `stateassign` lit `academic` (inscription, financement), `finance` (`LearnerStandingPort`, factures liées) et `attendance` (comptages pour le contrôle de présence) par ports ; écrit `academic.changeEnrollmentFunding` à la **vérification** (une seule source de la référence d'affectation).

## 10. Conservation, volumétrie et archivage

| Donnée | Conservation proposée | Remarque |
|---|---|---|
| Séances, décisions, PV, signatures | **Durée de vie du tenant** | Valeur probante ; export contrôlé ; jamais purgés |
| Mesures disciplinaires, incidents, notes de vie scolaire | Paramètre `retention_days` (NULL = non défini : **aucune durée légale n'est codée**) | Question ouverte Q6-17 ; après échéance : anonymisation de l'élève, pas suppression des comptages |
| Mouvements de points | Avec la mesure source | Ajout seul |
| Lectures confidentielles, historiques | Durée de vie du tenant | Preuve d'accès |
| Dossiers d'affectation et pièces (références) | Durée de vie du tenant | Contrôle par l'État possible plusieurs années après |

Partitionnement : non nécessaire en V1 (< 100 000 lignes par table et par an) ; `life_events` et `confidential_reads` seront partitionnables par année si la volumétrie l'exige.

## 11. Demandes aux autres modules (non faites ici)

1. **`rules` (012)** : ajouter `placeholder` aux valeurs de `source_kind` (`rule_sets`, `rule_versions`, `national_rule_versions`) et à la gouvernance (un jeu `placeholder` n'est jamais publié comme règlement ; bandeau obligatoire sur résultats, PV et bulletins) ; contrat `secondary-annual@1` pour un nombre quelconque de périodes (voir `spec.md` §6.4).
2. **`reportcards` (013)** : enregistrer le type de document `COUNCIL_MINUTES` (schéma `council-minutes/1`, gabarit plateforme `council-minutes`), réutiliser signature des documents et QR de vérification si le tenant l'active.
3. **`results` (011)** : exposer un port d'écriture `DecisionPublisher` (création d'une `decision` `PROPOSED` à la préparation, confirmation à l'effet `RESULTS_DECISION`) et `writeAppreciation` pour `author_role = COUNCIL` ; accepter qu'une délibération soit ouverte par `councils` (`createDeliberation`) et marquée `HELD` à la clôture de séance.
4. **`academic` (004)** : `recordEnrollmentOutcome` pour les issues `REDIRECT` (déjà prévue) ; `transferEnrollment` entre programmes d'un même niveau (passage de série en cours d'année) ; `changeEnrollmentFunding` appelable par `stateassign`.
5. **`people` (008/009)** : `changeStudentStatus(EXCLUDED | SUSPENDED)` appelé par l'acte humain qui applique une exclusion ; `listAssignmentsForClassroom` pour proposer les participants ; rôle `HOMEROOM` pour le professeur principal.
6. **`messaging` (016)** : gabarits système `council.convocation`, `schoollife.convocation`, `schoollife.measure.notified` ; port `NotificationChannel` pour les convocations (e-mail/SMS/WhatsApp quand les canaux externes existeront).
7. **`rbac` (002)** : permissions de la spec 006 (§10) et rôles système (`directeur_etudes`, `educateur`, `enseignant`, `parent`, `eleve`) ; test « parent / élève reçoivent exactement les permissions `child` / `self` ».
8. **`tenancy` (001/003)** : sections `councils` et `schoollife` du modèle de pack ; événement `tenancy.tenant.provisioned` déjà consommé.

## 12. Tests de comportement (exécutés)

`ddl-test/` : `harness.mjs` (base dédiée par fichier, baseline réelle `packages/database/migrations/0001-0003`, migrations extraites de ce document, exécution sous `app_user`), `councils.test.mjs` (44), `schoollife.test.mjs` (28), `stateassign.test.mjs` (12). Correspondance avec les critères de la spec : AC1.x (préparation, hash des faits), AC2.x (quorum, président, rôles), AC3.x (propositions, décisions, humain décideur), AC4.x (clôture, PV, signatures), AC5.x (déverrouillage motivé), AC6.x (effets, exclusion humaine), AC7.x (orientation), AC8.x (mesures, recours, convocations), AC9.x (barèmes, solde), AC10.x (affectation, rapprochement, contrôles) — voir `spec.md` §4 pour le détail. Le test d'isolation générique de la plateforme (`pnpm test:isolation`) s'applique aux 37 tables (18 + 14 + 5) avec trois allowlists vides.
