# Modèle de données — 007-admissions (schéma Postgres `admissions`)

**Statut** : DDL de référence, **exécuté et testé** sur PostgreSQL 17 (`ddl/run.mjs` : 185 tests de comportement, dont des essais de **concurrence réelle** à plusieurs sessions Postgres via `dblink`). Les fichiers ci-dessous sont les migrations cibles `apps/api/src/modules/admissions/migrations/1900…1903` ; ils font foi sur les noms et les contraintes. Les blocs `<!-- migration: … -->` sont **générés** depuis `ddl/migrations/*.sql` (`node ddl/run.mjs --sync-doc`) et vérifiés par `--check-doc`.

**Sources** : `docs/architecture/module-conventions.md`, ADR-002 (RLS), ADR-005 (types de ligne à la main), ADR-006 (un schéma par module), ADR-007 (UUID, UTC, snake_case anglais), `specs/v2/004-academic-core/data-model.md` (patron), `specs/v2/013-report-cards/data-model.md` (index public global), `specs/v2/008-students-guardians/data-model.md` (numérotation sans trou).

## 1. Conventions appliquées

| Règle | Application dans `admissions` |
|---|---|
| Un module = un schéma | `admissions` ; aucune FK vers un autre schéma que `kernel.tenants(id)`. Établissement, année, élève, inscription, facture, classe, document : **UUID sans FK**, vérifiés par `tenancy`, `academic`, `people`, `finance`, `documents` ; niveaux désignés par leur **code** |
| Toute table de tenant | `tenant_id uuid NOT NULL REFERENCES kernel.tenants(id)` + `kernel.enable_tenant_rls()` + `GRANT` explicite. **Une exception** : `public_form_index` (§4.3), table globale déclarée dans l'allowlist d'isolation avec justification |
| FK internes composites | `(tenant_id, id)` ; l'étape d'un dossier est référencée par `(tenant_id, workflow_id, stage_id)` : une étape d'un **autre** workflow est impossible |
| Identifiants, dates, montants | UUID fournis par l'application (`newId()`), `gen_random_uuid()` seulement dans les déclencheurs de journal ; `timestamptz` UTC ; **aucun montant** (frais d'inscription = `finance`) |
| Constantes réglementaires | **Aucune**. Capacités, priorités, validité d'une offre, délai de paiement, durée de conservation : données ou paramètres d'établissement ; durée de conservation **vide** par défaut |
| Journaux | `decisions`, `transitions`, `import_rows`-like : ajout seul (déclencheur) ; `consents` jamais effacés ; `consent_texts` publiés une fois |
| Audit | Les cas d'usage sensibles (`publishWorkflow`, `decide`, `overrideCapacity`, `anonymize`) appellent `audit.record(tx, …)` dans la même transaction ; **aucune donnée personnelle** dans l'audit ni dans les événements |
| Événements | `kernel.domain_events` via `PgOutboxWriter(tx)`, `{ v: 1, … }`, identifiants et codes seulement |

## 2. Vue d'ensemble

```
settings   priority_classes   decision_reasons   consent_texts           (données d'établissement)
workflows ─< workflow_stages >─ workflow_transitions        (versionné ; publié = figé ; validé à la publication)
    │
campaigns ─< intake_capacities          document_requirements
    │
    └──< applications ─< application_guardians ─< consents
            │   (stage_id, status canonique dérivé par déclencheur)
            ├─< application_documents      ─> document_requirements
            ├─< interviews
            ├─< offers                      (classe visée, lien de réponse : empreinte seule)
            ├─< decisions   (append-only, une par entrée dans une étape « à décision »)
            ├─< transitions (append-only, écrite par déclencheur)
            ├─< duplicate_candidates
            └─< notification_log (idempotente)

prospects (convertis en candidatures)      number_sequences + next_number()   (numérotation sans trou)
public_form_index (GLOBALE)   public_form_sessions   submission_attempts      (formulaire public)
```

## 3. Catalogue des tables

| Table | Rôle | Cardinalité indicative (établissement de 600 élèves, 250 candidatures/an) |
|---|---|---|
| `settings`, `priority_classes`, `decision_reasons`, `consent_texts` | Paramètres et données | 1 ligne ; < 10 ; < 30 ; < 10 |
| `workflows`, `workflow_stages`, `workflow_transitions` | Workflow versionné | 1 à 3 versions ; 10 à 20 étapes ; 15 à 40 transitions |
| `campaigns`, `intake_capacities`, `document_requirements` | Campagnes, capacités, pièces | 1 à 3 campagnes ; 6 à 20 niveaux ; 5 à 15 pièces |
| `prospects` | Contacts avant candidature | 300 à 1 000 |
| `applications` | Candidatures | 250 |
| `application_guardians`, `consents` | Tuteurs et consentements | ≈ 2 par candidature ; ≈ 2 par tuteur |
| `application_documents` | Pièces | ≈ 5 par candidature |
| `interviews`, `offers` | Entretiens, offres | 0 à 2 ; 1 à 2 par candidature acceptée |
| `decisions`, `transitions` | Journaux | ≈ 2 ; ≈ 6 par candidature |
| `duplicate_candidates`, `notification_log` | Doublons, notifications | rares ; ≈ 6 par candidature |
| `public_form_index`, `public_form_sessions`, `submission_attempts` | Formulaire public | 1 ligne par établissement ; purge quotidienne ; purge à 30 jours |

## 4. Les décisions de modélisation à connaître

1. **Étape (donnée) vs statut canonique (contrat).** `applications.stage_id` est la vérité ; `applications.status` est **dérivé** par le déclencheur (`workflow_stages.canonical_status`) et ne peut jamais diverger. Les événements, statistiques et tableaux de bord ne parlent que des 8 statuts du PRD ; les écoles ajoutent des étapes sans toucher au contrat.
2. **Le workflow est de la donnée validée à la publication.** Le déclencheur `workflows_guard` refuse un workflow incohérent (une étape initiale, statuts indispensables, un seul `ENROLLED` terminal atteint seulement depuis l'étape qui crée l'inscription, pas de sortie d'une étape terminale, pas d'impasse, tout atteignable, décisions formelles pour `ACCEPTED` et `REJECTED`). Publié, il est figé (déclencheur `workflow_structure_guard`).
3. **La décision précède la transition, dans la même transaction.** Une étape à décision exige une ligne `decisions` de la même transaction (`xid = txid_current()`), partant de l'étape **courante**, sur une transition **déclarée**, de **type** cohérent avec le statut canonique visé. Personne — pas même un accès SQL direct d'`app_user` — ne peut changer l'étape sans journaliser la décision.
4. **Capacité sérialisée par verrou de ligne.** À l'entrée d'une étape qui réserve une place, la ligne `intake_capacities` est verrouillée (`FOR UPDATE`) ; le décompte est relu après le verrou (READ COMMITTED) : deux sessions concurrentes sur la dernière place → une seule réussit (testé à deux sessions réelles).
5. **Numérotation sans trou transactionnelle.** `next_number(scope)` incrémente dans la transaction de l'appelant : une annulation ne consomme aucun numéro, quatre sessions concurrentes obtiennent 1..N sans doublon (testé). Le **matricule de l'élève** est celui de `people` (008), pas celui-ci.
6. **Preuve du consentement.** `consents` référence un tuteur **habilité** (`can_consent`), garde la version du texte (`consent_texts`, publié une fois) et les empreintes d'IP et d'agent ; un consentement par délégation ou papier exige une pièce justificative ; un retrait est une mise à jour unique.
7. **Données minimales dans le public.** `public_form_index` ne contient aucune donnée personnelle (jeton opaque de ≥ 96 bits) ; `public_form_sessions` ne stocke que l'**empreinte** du jeton ; `submission_attempts` ne stocke que des **empreintes** d'IP et d'agent ; le lien de réponse d'une offre n'est stocké que par son empreinte.
8. **Anonymisation réservée aux dossiers clos sans inscription.** `anonymize_application` neutralise l'identité, généralise la naissance à l'année, neutralise les tuteurs, efface les références de pièces ; décisions, dates et compteurs restent. Idempotente ; refuse un dossier en cours ou inscrit.

## 5. DDL de référence

### 5.1 Schéma, paramètres, workflow, campagnes, capacités

<!-- migration: 1900_admissions_reference.sql -->
```sql
-- =============================================================================
-- 1900 — Module admissions : schéma, paramètres, workflow personnalisable, campagnes et capacités
-- =============================================================================
--
-- Plage de numéros réservée au module admissions : 1900–1999 (numéros GLOBAUX, voir
-- docs/architecture/module-conventions.md ; ligne à inscrire dans ce tableau).
--
-- Règles (module-conventions.md, ADR-002/006/007) :
--   - un module = un schéma ; AUCUNE clé étrangère vers le schéma d'un autre module, sauf
--     `kernel.tenants(id)`. Établissement, année, niveau, élève, inscription, facture : UUID ou codes
--     vérifiés par les API publiques de tenancy / academic / people / finance ;
--   - toute table : `tenant_id uuid NOT NULL REFERENCES kernel.tenants(id)`, `kernel.enable_tenant_rls()`,
--     GRANT explicite à `app_user` (seule exception documentée : `public_form_index`, table de
--     résolution de lien public, voir plus bas) ;
--   - clés étrangères internes COMPOSITES (tenant_id, id) ;
--   - AUCUNE règle académique ou réglementaire : capacités, priorités, durée de validité d'une offre,
--     pièces exigées et étapes du processus sont des DONNÉES de l'établissement.
--
-- Les huit STATUTS CANONIQUES du PRD §9 (DRAFT, SUBMITTED, UNDER_REVIEW, MISSING_DOCUMENT, ACCEPTED,
-- REJECTED, WAITLISTED, ENROLLED) forment le CONTRAT stable (événements, statistiques). Chaque
-- établissement définit ses propres ÉTAPES (`workflow_stages`), chacune rattachée à un statut canonique.
--
-- Exécutée sous `SET ROLE migrator` par le runner.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS admissions;
REVOKE ALL ON SCHEMA admissions FROM PUBLIC;
GRANT USAGE ON SCHEMA admissions TO app_user;

CREATE FUNCTION admissions.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'admissions.append_only: la table % est en ajout seul (% refusé)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;

-- Normalisation d'un nom pour la détection de doublons : minuscules, sans accent courant, sans
-- ponctuation ni espaces multiples. IMMUABLE (colonne générée) ; l'accentuation exhaustive est
-- reprise côté application (`findDuplicateStudents` de people).
CREATE FUNCTION admissions.normalize_name(p_value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(
           translate(lower(coalesce(p_value, '')),
                     'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœæ',
                     'aaaaaaceeeeiiiinooooouuuuyyoa'),
           '[^a-z0-9]+', ' ', 'g'))
$$;

-- -----------------------------------------------------------------------------
-- Paramètres par établissement (une ligne)
--   capacity_policy   HARD  : refus au-delà de la capacité (défaut) ; SOFT : dépassement motivé ; NONE : pas de contrôle
--   duplicate_policy  BLOCK : un doublon non tranché empêche l'inscription ; WARN : simple alerte ; OFF
--   offer_validity_days : durée de validité d'une offre d'admission (politique de l'établissement)
--   payment_deadline_days : délai de paiement des frais d'inscription après acceptation de l'offre ; NULL = pas de délai
--                           (question métier) ; passé ce délai, le travail planifié annule l'inscription en attente
--   waitlist_promotion  MANUAL : le secrétariat propose la place libérée ; AUTO : proposée au premier de la liste
--   rejected_retention_months : NULL = durée de conservation d'un dossier refusé NON DÉTERMINÉE (question métier)
-- -----------------------------------------------------------------------------
CREATE TABLE admissions.settings (
  tenant_id                 uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id            uuid NOT NULL,                       -- tenancy.institutions.id (sans FK)
  public_form_enabled       boolean NOT NULL DEFAULT false,
  capacity_policy           text NOT NULL DEFAULT 'HARD' CHECK (capacity_policy IN ('HARD', 'SOFT', 'NONE')),
  duplicate_policy          text NOT NULL DEFAULT 'WARN' CHECK (duplicate_policy IN ('BLOCK', 'WARN', 'OFF')),
  waitlist_enabled          boolean NOT NULL DEFAULT true,
  consent_required          boolean NOT NULL DEFAULT true,
  consent_text_version      text,
  offer_validity_days       integer NOT NULL DEFAULT 14 CHECK (offer_validity_days BETWEEN 1 AND 365),
  payment_deadline_days     integer CHECK (payment_deadline_days IS NULL OR payment_deadline_days BETWEEN 1 AND 365),
  waitlist_promotion        text NOT NULL DEFAULT 'MANUAL' CHECK (waitlist_promotion IN ('MANUAL', 'AUTO')),
  minimum_form_seconds      integer NOT NULL DEFAULT 5 CHECK (minimum_form_seconds BETWEEN 0 AND 600),
  captcha_required          boolean NOT NULL DEFAULT false,
  submissions_per_10_min    integer NOT NULL DEFAULT 5 CHECK (submissions_per_10_min BETWEEN 1 AND 1000),   -- dépôts par empreinte d'IP et par fenêtre de 10 minutes
  rejected_retention_months integer CHECK (rejected_retention_months IS NULL OR rejected_retention_months > 0),
  application_number_pattern text NOT NULL DEFAULT '{YEAR}-{SEQ:5}'
                             CHECK (length(application_number_pattern) BETWEEN 3 AND 60),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, institution_id),
  CHECK (NOT consent_required OR public_form_enabled IS NOT TRUE OR consent_text_version IS NOT NULL)
);
SELECT kernel.enable_tenant_rls('admissions.settings');
GRANT SELECT, INSERT, UPDATE ON admissions.settings TO app_user;

-- -----------------------------------------------------------------------------
-- Lien public par établissement : résolution `slug -> (tenant, établissement)` AVANT toute
-- connaissance du tenant (route publique). TABLE GLOBALE (allowlist d'isolation, justification :
-- aucune donnée personnelle ; le slug est un jeton opaque de 96 bits au moins, donc non énumérable).
-- Lecture ouverte ; écriture limitée au tenant courant (un tenant ne publie que ses propres liens).
-- -----------------------------------------------------------------------------
CREATE TABLE admissions.public_form_index (
  slug           text PRIMARY KEY CHECK (slug ~ '^[a-z0-9]{16,40}$'),
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id uuid NOT NULL,
  enabled        boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, institution_id)
);
ALTER TABLE admissions.public_form_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE admissions.public_form_index FORCE ROW LEVEL SECURITY;
CREATE POLICY pfi_read   ON admissions.public_form_index FOR SELECT USING (true);
CREATE POLICY pfi_insert ON admissions.public_form_index FOR INSERT WITH CHECK (tenant_id = kernel.current_tenant_id());
CREATE POLICY pfi_update ON admissions.public_form_index FOR UPDATE USING (tenant_id = kernel.current_tenant_id())
  WITH CHECK (tenant_id = kernel.current_tenant_id());
CREATE POLICY pfi_delete ON admissions.public_form_index FOR DELETE USING (tenant_id = kernel.current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON admissions.public_form_index TO app_user;

-- -----------------------------------------------------------------------------
-- Classes de priorité (liste d'attente) et motifs de décision : DONNÉES de l'établissement.
-- `rank` : plus petit = plus prioritaire. Aucune priorité n'est imposée par la plateforme.
-- -----------------------------------------------------------------------------
CREATE TABLE admissions.priority_classes (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id uuid NOT NULL,
  code           text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  label          text NOT NULL CHECK (length(btrim(label)) > 0),
  rank           integer NOT NULL CHECK (rank >= 1),
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, institution_id, code)
);
SELECT kernel.enable_tenant_rls('admissions.priority_classes');
GRANT SELECT, INSERT, UPDATE ON admissions.priority_classes TO app_user;

CREATE TABLE admissions.decision_reasons (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id uuid NOT NULL,
  code       text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  kind       text NOT NULL CHECK (kind IN ('ACCEPT', 'REJECT', 'WAITLIST', 'WITHDRAW', 'RECONSIDER')),
  label      text NOT NULL CHECK (length(btrim(label)) > 0),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, institution_id, code)
);
SELECT kernel.enable_tenant_rls('admissions.decision_reasons');
GRANT SELECT, INSERT, UPDATE ON admissions.decision_reasons TO app_user;

-- -----------------------------------------------------------------------------
-- Textes de consentement : la PREUVE de ce que le parent a accepté. Chaque version est publiée une fois
-- et ne change plus ; `consents.text_version` la désigne. Un texte retiré reste lisible.
-- -----------------------------------------------------------------------------
CREATE TABLE admissions.consent_texts (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id uuid NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('DATA_PROCESSING', 'PHOTO', 'ADMISSION_TERMS', 'COMMUNICATIONS')),
  version        text NOT NULL CHECK (version ~ '^[A-Za-z0-9._-]{1,20}$'),
  language       text NOT NULL DEFAULT 'fr' CHECK (language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  body           text NOT NULL CHECK (length(btrim(body)) BETWEEN 20 AND 20000),
  published_at   timestamptz NOT NULL DEFAULT now(),
  published_by   uuid,
  retired_at     timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, institution_id, kind, version)
);
SELECT kernel.enable_tenant_rls('admissions.consent_texts');
GRANT SELECT, INSERT, UPDATE ON admissions.consent_texts TO app_user;

-- Le corps d'un texte publié ne change jamais ; seul son retrait (une fois) est permis ; pas de suppression.
CREATE FUNCTION admissions.consent_texts_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'admissions.consent_text_immutable: un texte de consentement ne se supprime pas (le retirer)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.body <> OLD.body OR NEW.kind <> OLD.kind OR NEW.version <> OLD.version OR NEW.language <> OLD.language
     OR NEW.institution_id <> OLD.institution_id OR NEW.published_at <> OLD.published_at THEN
    RAISE EXCEPTION 'admissions.consent_text_immutable: un texte publié ne change pas (publier une nouvelle version)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'admissions.consent_text_retired: un texte retiré est figé' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER consent_texts_guard BEFORE UPDATE OR DELETE ON admissions.consent_texts
  FOR EACH ROW EXECUTE FUNCTION admissions.consent_texts_guard();

-- -----------------------------------------------------------------------------
-- Workflow : étapes + transitions, VERSIONNÉ. Brouillon librement modifiable ; publié, il est figé
-- (corriger = nouvelle version). Les dossiers en cours restent épinglés à la version qui les a créés.
-- -----------------------------------------------------------------------------
CREATE TABLE admissions.workflows (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id       uuid NOT NULL,
  code                 text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  version              integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  label                text NOT NULL CHECK (length(btrim(label)) > 0),
  education_level_code text CHECK (education_level_code IS NULL OR education_level_code ~ '^[A-Z][A-Z0-9_]{0,39}$'),  -- NULL = tous les cycles
  status               text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  published_at         timestamptz,
  published_by         uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, institution_id, code, version),
  CHECK ((status = 'DRAFT') = (published_at IS NULL))
);
SELECT kernel.enable_tenant_rls('admissions.workflows');
-- Un seul workflow publié par (établissement, cycle).
CREATE UNIQUE INDEX workflows_one_published
  ON admissions.workflows (tenant_id, institution_id, coalesce(education_level_code, '')) WHERE status = 'PUBLISHED';
GRANT SELECT, INSERT, UPDATE, DELETE ON admissions.workflows TO app_user;   -- DELETE : brouillon (garde)

CREATE TABLE admissions.workflow_stages (
  id                            uuid PRIMARY KEY,
  tenant_id                     uuid NOT NULL REFERENCES kernel.tenants (id),
  workflow_id                   uuid NOT NULL,
  code                          text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  label                         text NOT NULL CHECK (length(btrim(label)) > 0),
  canonical_status              text NOT NULL CHECK (canonical_status IN
                                  ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'MISSING_DOCUMENT', 'ACCEPTED', 'REJECTED', 'WAITLISTED', 'ENROLLED')),
  ordinal                       integer NOT NULL CHECK (ordinal >= 1),
  is_initial                    boolean NOT NULL DEFAULT false,
  is_terminal                   boolean NOT NULL DEFAULT false,
  holds_seat                    boolean NOT NULL DEFAULT false,
  requires_consent              boolean NOT NULL DEFAULT false,
  requires_documents_complete   boolean NOT NULL DEFAULT false,
  requires_interview_done       boolean NOT NULL DEFAULT false,
  requires_decision             boolean NOT NULL DEFAULT false,
  creates_enrollment            boolean NOT NULL DEFAULT false,
  closure_kind                  text CHECK (closure_kind IN ('REJECTED_BY_SCHOOL', 'WITHDRAWN_BY_FAMILY', 'OFFER_EXPIRED', 'NO_SHOW', 'DUPLICATE')),
  sla_hours                     integer CHECK (sla_hours IS NULL OR sla_hours > 0),
  notify_template_code          text,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, workflow_id, id),
  UNIQUE (tenant_id, workflow_id, code),
  UNIQUE (tenant_id, workflow_id, ordinal),
  FOREIGN KEY (tenant_id, workflow_id) REFERENCES admissions.workflows (tenant_id, id),
  CHECK (NOT is_initial OR canonical_status = 'DRAFT'),
  CHECK (canonical_status <> 'DRAFT' OR is_initial),
  CHECK (NOT (is_initial AND is_terminal)),
  CHECK (canonical_status <> 'ENROLLED' OR is_terminal),
  CHECK (NOT (canonical_status = 'REJECTED' AND is_terminal AND closure_kind IS NULL)),
  CHECK (closure_kind IS NULL OR (is_terminal AND canonical_status = 'REJECTED')),
  CHECK (NOT (holds_seat AND canonical_status IN ('DRAFT', 'REJECTED'))),
  CHECK (NOT creates_enrollment OR canonical_status = 'ACCEPTED'),
  CHECK (NOT requires_decision OR canonical_status IN ('ACCEPTED', 'REJECTED', 'WAITLISTED', 'UNDER_REVIEW', 'MISSING_DOCUMENT', 'SUBMITTED'))
);
SELECT kernel.enable_tenant_rls('admissions.workflow_stages');
-- Une seule étape initiale par workflow.
CREATE UNIQUE INDEX workflow_stages_one_initial ON admissions.workflow_stages (tenant_id, workflow_id) WHERE is_initial;
GRANT SELECT, INSERT, UPDATE, DELETE ON admissions.workflow_stages TO app_user;

CREATE TABLE admissions.workflow_transitions (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  workflow_id     uuid NOT NULL,
  from_stage_id   uuid NOT NULL,
  to_stage_id     uuid NOT NULL,
  permission_key  text NOT NULL CHECK (permission_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  requires_reason boolean NOT NULL DEFAULT false,
  is_automatic    boolean NOT NULL DEFAULT false,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, workflow_id, from_stage_id, to_stage_id),
  CHECK (from_stage_id <> to_stage_id),
  FOREIGN KEY (tenant_id, workflow_id, from_stage_id) REFERENCES admissions.workflow_stages (tenant_id, workflow_id, id),
  FOREIGN KEY (tenant_id, workflow_id, to_stage_id) REFERENCES admissions.workflow_stages (tenant_id, workflow_id, id)
);
SELECT kernel.enable_tenant_rls('admissions.workflow_transitions');
GRANT SELECT, INSERT, UPDATE, DELETE ON admissions.workflow_transitions TO app_user;

-- Structure d'un workflow publié : figée.
CREATE FUNCTION admissions.workflow_structure_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
  v_tenant uuid;
  v_wf     uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN v_tenant := OLD.tenant_id; v_wf := OLD.workflow_id;
  ELSE v_tenant := NEW.tenant_id; v_wf := NEW.workflow_id; END IF;
  SELECT status INTO v_status FROM admissions.workflows w WHERE w.tenant_id = v_tenant AND w.id = v_wf;
  IF v_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'admissions.workflow_published_immutable: le workflow est % ; créer une nouvelle version pour le modifier', coalesce(v_status, 'inconnu')
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
CREATE TRIGGER workflow_stages_guard BEFORE INSERT OR UPDATE OR DELETE ON admissions.workflow_stages
  FOR EACH ROW EXECUTE FUNCTION admissions.workflow_structure_guard();
CREATE TRIGGER workflow_transitions_guard BEFORE INSERT OR UPDATE OR DELETE ON admissions.workflow_transitions
  FOR EACH ROW EXECUTE FUNCTION admissions.workflow_structure_guard();

-- Cycle de vie + VALIDATION À LA PUBLICATION. Un workflow publié est cohérent : une étape initiale,
-- les statuts canoniques indispensables, un seul ENROLLED terminal, aucune sortie d'une étape
-- terminale, toute étape non terminale a une issue, tout est atteignable depuis l'étape initiale,
-- ENROLLED est atteignable, exactement une étape « crée l'inscription » et elle précède ENROLLED.
CREATE FUNCTION admissions.workflows_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_n        integer;
  v_unreach  text;
  v_bad      text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'admissions.workflow_delete_forbidden: un workflow % ne se supprime pas', OLD.status USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.code <> OLD.code OR NEW.version <> OLD.version OR NEW.institution_id <> OLD.institution_id THEN
      RAISE EXCEPTION 'admissions.workflow_identity_immutable' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status <> 'DRAFT' AND (NEW.label <> OLD.label OR NEW.education_level_code IS DISTINCT FROM OLD.education_level_code) THEN
      RAISE EXCEPTION 'admissions.workflow_published_immutable: un workflow publié ne se modifie pas' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
         (OLD.status = 'DRAFT' AND NEW.status = 'PUBLISHED') OR
         (OLD.status = 'PUBLISHED' AND NEW.status = 'ARCHIVED')) THEN
      RAISE EXCEPTION 'admissions.workflow_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status = 'PUBLISHED' AND OLD.status = 'DRAFT' THEN
      SELECT count(*) INTO v_n FROM admissions.workflow_stages s WHERE s.tenant_id = NEW.tenant_id AND s.workflow_id = NEW.id AND s.is_initial;
      IF v_n <> 1 THEN
        RAISE EXCEPTION 'admissions.workflow_initial: il faut exactement une étape initiale (trouvé %)', v_n USING ERRCODE = 'check_violation';
      END IF;
      FOR v_bad IN SELECT c FROM unnest(ARRAY['SUBMITTED', 'ACCEPTED', 'REJECTED', 'ENROLLED']) AS c
                    WHERE NOT EXISTS (SELECT 1 FROM admissions.workflow_stages s
                                       WHERE s.tenant_id = NEW.tenant_id AND s.workflow_id = NEW.id AND s.canonical_status = c)
      LOOP
        RAISE EXCEPTION 'admissions.workflow_missing_status: le workflow doit comporter une étape de statut %', v_bad USING ERRCODE = 'check_violation';
      END LOOP;
      SELECT count(*) INTO v_n FROM admissions.workflow_stages s
       WHERE s.tenant_id = NEW.tenant_id AND s.workflow_id = NEW.id AND s.canonical_status = 'ENROLLED';
      IF v_n <> 1 THEN
        RAISE EXCEPTION 'admissions.workflow_enrolled: une seule étape ENROLLED est permise (trouvé %)', v_n USING ERRCODE = 'check_violation';
      END IF;
      SELECT count(*) INTO v_n FROM admissions.workflow_stages s
       WHERE s.tenant_id = NEW.tenant_id AND s.workflow_id = NEW.id AND s.creates_enrollment;
      IF v_n <> 1 THEN
        RAISE EXCEPTION 'admissions.workflow_creates_enrollment: exactement une étape doit créer l''inscription (trouvé %)', v_n USING ERRCODE = 'check_violation';
      END IF;
      -- au moins une étape à décision pour ACCEPTED et pour REJECTED
      FOR v_bad IN SELECT c FROM unnest(ARRAY['ACCEPTED', 'REJECTED']) AS c
                    WHERE NOT EXISTS (SELECT 1 FROM admissions.workflow_stages s
                                       WHERE s.tenant_id = NEW.tenant_id AND s.workflow_id = NEW.id
                                         AND s.canonical_status = c AND s.requires_decision)
      LOOP
        RAISE EXCEPTION 'admissions.workflow_decision_missing: une étape de statut % doit exiger une décision formelle', v_bad USING ERRCODE = 'check_violation';
      END LOOP;
      -- étapes terminales sans sortie ; étapes non terminales avec issue
      SELECT string_agg(s.code, ', ') INTO v_bad
        FROM admissions.workflow_stages s
       WHERE s.tenant_id = NEW.tenant_id AND s.workflow_id = NEW.id AND s.is_terminal
         AND EXISTS (SELECT 1 FROM admissions.workflow_transitions t WHERE t.tenant_id = s.tenant_id AND t.from_stage_id = s.id);
      IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'admissions.workflow_terminal_exit: étape(s) terminale(s) avec sortie : %', v_bad USING ERRCODE = 'check_violation';
      END IF;
      SELECT string_agg(s.code, ', ') INTO v_bad
        FROM admissions.workflow_stages s
       WHERE s.tenant_id = NEW.tenant_id AND s.workflow_id = NEW.id AND NOT s.is_terminal
         AND NOT EXISTS (SELECT 1 FROM admissions.workflow_transitions t WHERE t.tenant_id = s.tenant_id AND t.from_stage_id = s.id);
      IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'admissions.workflow_dead_end: étape(s) sans issue : %', v_bad USING ERRCODE = 'check_violation';
      END IF;
      -- atteignabilité depuis l'étape initiale
      WITH RECURSIVE reach(stage_id) AS (
        SELECT s.id FROM admissions.workflow_stages s WHERE s.tenant_id = NEW.tenant_id AND s.workflow_id = NEW.id AND s.is_initial
        UNION
        SELECT t.to_stage_id FROM admissions.workflow_transitions t JOIN reach r ON r.stage_id = t.from_stage_id
         WHERE t.tenant_id = NEW.tenant_id AND t.workflow_id = NEW.id
      )
      SELECT string_agg(s.code, ', ') INTO v_unreach
        FROM admissions.workflow_stages s
       WHERE s.tenant_id = NEW.tenant_id AND s.workflow_id = NEW.id AND s.id NOT IN (SELECT stage_id FROM reach);
      IF v_unreach IS NOT NULL THEN
        RAISE EXCEPTION 'admissions.workflow_unreachable: étape(s) inatteignable(s) : %', v_unreach USING ERRCODE = 'check_violation';
      END IF;
      -- l'étape qui crée l'inscription précède ENROLLED (ENROLLED n'est atteignable que par elle ou après elle)
      IF EXISTS (SELECT 1 FROM admissions.workflow_transitions t
                   JOIN admissions.workflow_stages e ON e.tenant_id = t.tenant_id AND e.id = t.to_stage_id AND e.canonical_status = 'ENROLLED'
                   JOIN admissions.workflow_stages f ON f.tenant_id = t.tenant_id AND f.id = t.from_stage_id
                  WHERE t.tenant_id = NEW.tenant_id AND t.workflow_id = NEW.id AND NOT f.creates_enrollment) THEN
        RAISE EXCEPTION 'admissions.workflow_enrolled_entry: ENROLLED ne s''atteint que depuis l''étape qui crée l''inscription' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER workflows_guard BEFORE UPDATE OR DELETE ON admissions.workflows
  FOR EACH ROW EXECUTE FUNCTION admissions.workflows_guard();

-- -----------------------------------------------------------------------------
-- Campagnes d'admission (une par année et établissement, ou davantage) et capacités par niveau
-- -----------------------------------------------------------------------------
CREATE TABLE admissions.campaigns (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id   uuid NOT NULL,
  academic_year_id uuid NOT NULL,                         -- academic.academic_years.id (sans FK)
  code             text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
  label            text NOT NULL CHECK (length(btrim(label)) > 0),
  workflow_id      uuid NOT NULL,
  opens_at         timestamptz NOT NULL,
  closes_at        timestamptz NOT NULL,
  status           text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'OPEN', 'CLOSED', 'ARCHIVED')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, institution_id, code),
  CHECK (closes_at > opens_at),
  FOREIGN KEY (tenant_id, workflow_id) REFERENCES admissions.workflows (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('admissions.campaigns');
CREATE INDEX campaigns_by_year ON admissions.campaigns (tenant_id, institution_id, academic_year_id, status);
GRANT SELECT, INSERT, UPDATE ON admissions.campaigns TO app_user;

-- Une campagne n'ouvre qu'avec un workflow PUBLIÉ ; son workflow est figé dès l'ouverture.
CREATE FUNCTION admissions.campaigns_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_wf admissions.workflows%ROWTYPE;
BEGIN
  SELECT * INTO v_wf FROM admissions.workflows w WHERE w.tenant_id = NEW.tenant_id AND w.id = NEW.workflow_id;
  IF v_wf.institution_id <> NEW.institution_id THEN
    RAISE EXCEPTION 'admissions.campaign_workflow_institution: le workflow appartient à un autre établissement' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IN ('OPEN', 'CLOSED') AND v_wf.status NOT IN ('PUBLISHED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'admissions.campaign_workflow_not_published: la campagne ne s''ouvre qu''avec un workflow publié' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.institution_id <> OLD.institution_id OR NEW.academic_year_id <> OLD.academic_year_id THEN
      RAISE EXCEPTION 'admissions.campaign_identity_immutable' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status <> 'DRAFT' AND NEW.workflow_id <> OLD.workflow_id THEN
      RAISE EXCEPTION 'admissions.campaign_workflow_frozen: le workflow d''une campagne ouverte est figé' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
         (OLD.status = 'DRAFT' AND NEW.status = 'OPEN') OR
         (OLD.status = 'OPEN' AND NEW.status IN ('CLOSED', 'DRAFT')) OR
         (OLD.status = 'CLOSED' AND NEW.status IN ('OPEN', 'ARCHIVED'))) THEN
      RAISE EXCEPTION 'admissions.campaign_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER campaigns_guard BEFORE INSERT OR UPDATE ON admissions.campaigns
  FOR EACH ROW EXECUTE FUNCTION admissions.campaigns_guard();

-- Capacités d'accueil par niveau (et, au choix, par programme). Absence de ligne = pas de plafond configuré.
CREATE TABLE admissions.intake_capacities (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  campaign_id       uuid NOT NULL,
  grade_level_code  text NOT NULL CHECK (grade_level_code ~ '^[A-Z0-9][A-Z0-9_]{0,39}$'),
  program_id        uuid,                                  -- academic.programs.id (sans FK)
  seats             integer NOT NULL CHECK (seats >= 0),
  waitlist_limit    integer CHECK (waitlist_limit IS NULL OR waitlist_limit >= 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, campaign_id) REFERENCES admissions.campaigns (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('admissions.intake_capacities');
CREATE UNIQUE INDEX intake_capacities_unique
  ON admissions.intake_capacities (tenant_id, campaign_id, grade_level_code, coalesce(program_id, '00000000-0000-0000-0000-000000000000'::uuid));
GRANT SELECT, INSERT, UPDATE ON admissions.intake_capacities TO app_user;

-- Pièces justificatives exigées (données de l'établissement). `applies_to_funding` : pièce propre à un
-- type de financement (ex. la décision d'affectation pour STATE_ASSIGNED).
CREATE TABLE admissions.document_requirements (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id      uuid NOT NULL,
  code                text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  label               text NOT NULL CHECK (length(btrim(label)) > 0),
  grade_level_code    text,                                -- NULL = tous les niveaux
  applies_to_funding  text CHECK (applies_to_funding IS NULL OR applies_to_funding IN ('PRIVATE', 'STATE_ASSIGNED', 'SCHOLARSHIP', 'COMPANY', 'STAFF_CHILD', 'OTHER')),
  required            boolean NOT NULL DEFAULT true,
  accepts_mime        text[] NOT NULL DEFAULT ARRAY['application/pdf', 'image/jpeg', 'image/png'],
  max_size_kb         integer NOT NULL DEFAULT 5120 CHECK (max_size_kb BETWEEN 1 AND 51200),
  sort_order          integer NOT NULL DEFAULT 0,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, institution_id, code)
);
SELECT kernel.enable_tenant_rls('admissions.document_requirements');
GRANT SELECT, INSERT, UPDATE ON admissions.document_requirements TO app_user;
```

### 5.2 Prospects, candidatures, tuteurs, consentements, pièces, entretiens, offres, décisions, journal, doublons, notifications, anonymisation

<!-- migration: 1901_admissions_applications.sql -->
```sql
-- =============================================================================
-- 1901 — Module admissions : prospects, candidatures, tuteurs, consentements, pièces, entretiens,
--         offres, décisions, journal de transitions, doublons, notifications, numérotation
-- =============================================================================
--
-- Le dossier d'un candidat (applications) est le seul objet qui AVANCE dans le workflow. Toute règle
-- de passage est imposée ici par un déclencheur (`applications_guard`) qui lit le workflow publié :
-- transition déclarée, pièces complètes, consentement, entretien, décision formelle journalisée,
-- capacité, doublons, éléments d'inscription. Les décisions et le journal sont en ajout seul.
--
-- Données personnelles : prénom, nom, naissance du candidat, coordonnées des tuteurs. Elles ne
-- sortent JAMAIS dans un événement (identifiants et codes seulement) ni dans un journal d'audit.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Numérotation transactionnelle SANS TROU : un compteur par portée (ici : campagne). L'incrément
-- est dans la transaction de la candidature : une annulation ne consomme aucun numéro.
-- -----------------------------------------------------------------------------
CREATE TABLE admissions.number_sequences (
  tenant_id  uuid NOT NULL REFERENCES kernel.tenants (id),
  scope_key  text NOT NULL CHECK (length(scope_key) BETWEEN 1 AND 120),
  last_value bigint NOT NULL DEFAULT 0 CHECK (last_value >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, scope_key)
);
SELECT kernel.enable_tenant_rls('admissions.number_sequences');
GRANT SELECT, INSERT, UPDATE ON admissions.number_sequences TO app_user;

CREATE FUNCTION admissions.next_number(p_scope text) RETURNS bigint
LANGUAGE sql AS $$
  INSERT INTO admissions.number_sequences AS s (tenant_id, scope_key, last_value)
  VALUES (kernel.current_tenant_id(), p_scope, 1)
  ON CONFLICT (tenant_id, scope_key) DO UPDATE SET last_value = s.last_value + 1, updated_at = now()
  RETURNING last_value
$$;
GRANT EXECUTE ON FUNCTION admissions.next_number(text) TO app_user;

-- -----------------------------------------------------------------------------
-- Prospects (contacts avant candidature)
-- -----------------------------------------------------------------------------
CREATE TABLE admissions.prospects (
  id                        uuid PRIMARY KEY,
  tenant_id                 uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id            uuid NOT NULL,
  first_name                text NOT NULL CHECK (length(btrim(first_name)) > 0),
  last_name                 text NOT NULL CHECK (length(btrim(last_name)) > 0),
  contact_phone             text CHECK (contact_phone IS NULL OR length(contact_phone) BETWEEN 6 AND 24),
  contact_email             text CHECK (contact_email IS NULL OR contact_email ~ '^[^@\s]+@[^@\s]+$'),
  interested_grade_level_code text,
  source_channel            text NOT NULL DEFAULT 'WALK_IN' CHECK (source_channel ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  referrer_label            text,
  status                    text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'CONTACTED', 'CONVERTED', 'LOST')),
  lost_reason               text,
  assigned_to               uuid,
  converted_application_id  uuid,
  notes                     text CHECK (notes IS NULL OR length(notes) <= 2000),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (contact_phone IS NOT NULL OR contact_email IS NOT NULL),
  CHECK ((status = 'CONVERTED') = (converted_application_id IS NOT NULL)),
  CHECK (status <> 'LOST' OR length(btrim(coalesce(lost_reason, ''))) > 0)
);
SELECT kernel.enable_tenant_rls('admissions.prospects');
-- Un seul prospect actif par e-mail et établissement.
CREATE UNIQUE INDEX prospects_one_active_email
  ON admissions.prospects (tenant_id, institution_id, lower(contact_email))
  WHERE contact_email IS NOT NULL AND status IN ('NEW', 'CONTACTED');
CREATE INDEX prospects_by_status ON admissions.prospects (tenant_id, institution_id, status, created_at DESC);
GRANT SELECT, INSERT, UPDATE ON admissions.prospects TO app_user;

-- -----------------------------------------------------------------------------
-- Candidatures
-- -----------------------------------------------------------------------------
CREATE TABLE admissions.applications (
  id                         uuid PRIMARY KEY,
  tenant_id                  uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id             uuid NOT NULL,
  campaign_id                uuid NOT NULL,
  workflow_id                uuid NOT NULL,
  stage_id                   uuid NOT NULL,
  status                     text NOT NULL DEFAULT 'DRAFT' CHECK (status IN
                               ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'MISSING_DOCUMENT', 'ACCEPTED', 'REJECTED', 'WAITLISTED', 'ENROLLED')),
  application_number         text NOT NULL CHECK (length(btrim(application_number)) > 0),
  created_via                text NOT NULL CHECK (created_via IN ('PUBLIC_FORM', 'STAFF', 'IMPORT', 'PROSPECT')),
  prospect_id                uuid,
  -- candidat (le dossier permanent est créé dans `people` à l'étape qui crée l'inscription)
  applicant_first_name       text NOT NULL CHECK (length(btrim(applicant_first_name)) > 0),
  applicant_last_name        text NOT NULL CHECK (length(btrim(applicant_last_name)) > 0),
  applicant_birth_date       date NOT NULL CHECK (applicant_birth_date > DATE '1950-01-01'),
  applicant_birth_place      text,
  applicant_gender           text CHECK (applicant_gender IN ('FEMALE', 'MALE')),
  applicant_nationality      text,
  previous_school            text,
  previous_grade_level_code  text,
  is_repeating               boolean NOT NULL DEFAULT false,
  identity_key               text GENERATED ALWAYS AS (
                               admissions.normalize_name(applicant_last_name) || '|' ||
                               admissions.normalize_name(applicant_first_name) || '|' || (applicant_birth_date - DATE '1900-01-01')::text
                             ) STORED,
  -- souhait
  desired_grade_level_code   text NOT NULL CHECK (desired_grade_level_code ~ '^[A-Z0-9][A-Z0-9_]{0,39}$'),
  desired_program_id         uuid,
  funding_type_requested     text NOT NULL DEFAULT 'PRIVATE'
                             CHECK (funding_type_requested IN ('PRIVATE', 'STATE_ASSIGNED', 'SCHOLARSHIP', 'COMPANY', 'STAFF_CHILD', 'OTHER')),
  assignment_reference       text CHECK (assignment_reference IS NULL OR length(btrim(assignment_reference)) > 0),
  priority_class_code        text,
  source_channel             text NOT NULL DEFAULT 'WALK_IN' CHECK (source_channel ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  referrer_label             text,
  tracking_code_hash         text CHECK (tracking_code_hash IS NULL OR tracking_code_hash ~ '^[0-9a-f]{64}$'),
  extra                      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(extra) = 'object'),
  -- traitement
  capacity_override_reason   text,
  waitlist_entered_at        timestamptz,
  submitted_at               timestamptz,
  decided_at                 timestamptz,
  closed_at                  timestamptz,
  -- passage à l'inscription (références vers les autres modules, sans FK)
  student_id                 uuid,
  enrollment_id              uuid,
  invoice_id                 uuid,
  enrollment_confirmed_at    timestamptz,
  enrolled_at                timestamptz,
  anonymized_at              timestamptz,
  created_by                 uuid,
  row_version                integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, campaign_id, application_number),
  CHECK (funding_type_requested <> 'STATE_ASSIGNED' OR assignment_reference IS NOT NULL),
  CHECK (status <> 'ENROLLED' OR (student_id IS NOT NULL AND enrollment_id IS NOT NULL AND enrolled_at IS NOT NULL AND enrollment_confirmed_at IS NOT NULL)),
  CHECK ((enrollment_id IS NULL) = (student_id IS NULL)),
  FOREIGN KEY (tenant_id, campaign_id) REFERENCES admissions.campaigns (tenant_id, id),
  FOREIGN KEY (tenant_id, workflow_id, stage_id) REFERENCES admissions.workflow_stages (tenant_id, workflow_id, id)
);
SELECT kernel.enable_tenant_rls('admissions.applications');
-- Une candidature « vivante » par enfant et par campagne (le même enfant ne dépose pas deux dossiers ouverts).
CREATE UNIQUE INDEX applications_one_live_per_child
  ON admissions.applications (tenant_id, campaign_id, identity_key) WHERE status <> 'REJECTED';
CREATE UNIQUE INDEX applications_tracking_code ON admissions.applications (tenant_id, tracking_code_hash) WHERE tracking_code_hash IS NOT NULL;
CREATE INDEX applications_by_campaign_status ON admissions.applications (tenant_id, campaign_id, status, desired_grade_level_code);
CREATE INDEX applications_by_identity ON admissions.applications (tenant_id, identity_key);
CREATE INDEX applications_by_stage ON admissions.applications (tenant_id, stage_id, updated_at);
CREATE INDEX applications_waitlist ON admissions.applications (tenant_id, campaign_id, desired_grade_level_code, waitlist_entered_at) WHERE status = 'WAITLISTED';
GRANT SELECT, INSERT, UPDATE ON admissions.applications TO app_user;

CREATE TABLE admissions.application_guardians (
  id                         uuid PRIMARY KEY,
  tenant_id                  uuid NOT NULL REFERENCES kernel.tenants (id),
  application_id             uuid NOT NULL,
  relationship_code          text NOT NULL CHECK (relationship_code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  first_name                 text NOT NULL CHECK (length(btrim(first_name)) > 0),
  last_name                  text NOT NULL CHECK (length(btrim(last_name)) > 0),
  phone                      text CHECK (phone IS NULL OR length(phone) BETWEEN 6 AND 24),
  email                      text CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+$'),
  profession                 text,
  is_primary                 boolean NOT NULL DEFAULT false,
  is_financial_responsible   boolean NOT NULL DEFAULT false,
  can_consent                boolean NOT NULL DEFAULT true,       -- tuteur légal habilité à consentir
  created_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, application_id, id),
  CHECK (phone IS NOT NULL OR email IS NOT NULL),
  FOREIGN KEY (tenant_id, application_id) REFERENCES admissions.applications (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('admissions.application_guardians');
CREATE UNIQUE INDEX application_guardians_one_primary
  ON admissions.application_guardians (tenant_id, application_id) WHERE is_primary;
GRANT SELECT, INSERT, UPDATE, DELETE ON admissions.application_guardians TO app_user;

-- Consentements : preuve du consentement parental (texte et version), jamais effacée ; un retrait est
-- une ligne mise à jour UNE fois (`withdrawn_at`).
CREATE TABLE admissions.consents (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  application_id  uuid NOT NULL,
  guardian_id     uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('DATA_PROCESSING', 'PHOTO', 'ADMISSION_TERMS', 'COMMUNICATIONS')),
  text_version    text NOT NULL CHECK (length(btrim(text_version)) > 0),
  given_at        timestamptz NOT NULL DEFAULT now(),
  given_via       text NOT NULL CHECK (given_via IN ('PUBLIC_FORM', 'STAFF_ON_BEHALF', 'PAPER')),
  evidence_ref    text,                                  -- pièce justifiant un consentement papier / par délégation
  ip_hash         text CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$'),
  ua_hash         text CHECK (ua_hash IS NULL OR ua_hash ~ '^[0-9a-f]{64}$'),
  withdrawn_at    timestamptz,
  withdrawn_reason text,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, application_id, guardian_id, kind, text_version),
  CHECK (given_via = 'PUBLIC_FORM' OR length(btrim(coalesce(evidence_ref, ''))) > 0),
  CHECK ((withdrawn_at IS NULL) = (withdrawn_reason IS NULL)),
  FOREIGN KEY (tenant_id, application_id, guardian_id) REFERENCES admissions.application_guardians (tenant_id, application_id, id)
);
SELECT kernel.enable_tenant_rls('admissions.consents');
GRANT SELECT, INSERT, UPDATE ON admissions.consents TO app_user;

CREATE FUNCTION admissions.consents_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'admissions.consent_immutable: un consentement ne s''efface pas (le retirer)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.application_id <> OLD.application_id OR NEW.guardian_id <> OLD.guardian_id OR NEW.kind <> OLD.kind
     OR NEW.text_version <> OLD.text_version OR NEW.given_at <> OLD.given_at OR NEW.given_via <> OLD.given_via
     OR NEW.evidence_ref IS DISTINCT FROM OLD.evidence_ref OR NEW.ip_hash IS DISTINCT FROM OLD.ip_hash THEN
    RAISE EXCEPTION 'admissions.consent_immutable: seul le retrait d''un consentement est permis' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'admissions.consent_already_withdrawn' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER consents_guard BEFORE UPDATE OR DELETE ON admissions.consents
  FOR EACH ROW EXECUTE FUNCTION admissions.consents_guard();

-- Le consentement est donné par un tuteur HABILITÉ (can_consent).
CREATE FUNCTION admissions.consents_insert_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admissions.application_guardians g
                  WHERE g.tenant_id = NEW.tenant_id AND g.id = NEW.guardian_id AND g.can_consent) THEN
    RAISE EXCEPTION 'admissions.consent_guardian_not_entitled: ce tuteur n''est pas habilité à consentir' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER consents_insert_guard BEFORE INSERT ON admissions.consents
  FOR EACH ROW EXECUTE FUNCTION admissions.consents_insert_guard();

-- -----------------------------------------------------------------------------
-- Pièces justificatives d'une candidature. Le stockage passe par le port `documents` (spec 024) ;
-- tant qu'il n'est pas livré, `storage_key` pointe le StoragePort. L'un OU l'autre est exigé.
-- -----------------------------------------------------------------------------
CREATE TABLE admissions.application_documents (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  application_id  uuid NOT NULL,
  requirement_id  uuid NOT NULL,
  status          text NOT NULL DEFAULT 'MISSING' CHECK (status IN ('MISSING', 'SUBMITTED', 'ACCEPTED', 'REJECTED')),
  document_ref    uuid,                                  -- documents.documents.id (sans FK)
  storage_key     text,
  content_type    text,
  size_bytes      bigint CHECK (size_bytes IS NULL OR size_bytes > 0),
  sha256          text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  attempts        integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  rejection_reason text,
  reviewed_by     uuid,
  reviewed_at     timestamptz,
  submitted_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, application_id, requirement_id),
  CHECK (status = 'MISSING' OR document_ref IS NOT NULL OR storage_key IS NOT NULL),
  CHECK (status <> 'REJECTED' OR length(btrim(coalesce(rejection_reason, ''))) > 0),
  CHECK (status NOT IN ('ACCEPTED', 'REJECTED') OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  FOREIGN KEY (tenant_id, application_id) REFERENCES admissions.applications (tenant_id, id),
  FOREIGN KEY (tenant_id, requirement_id) REFERENCES admissions.document_requirements (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('admissions.application_documents');
GRANT SELECT, INSERT, UPDATE ON admissions.application_documents TO app_user;

-- Codes des pièces EXIGÉES encore non acceptées (applicabilité : établissement, niveau, financement).
CREATE FUNCTION admissions.missing_required_documents(p_application uuid) RETURNS text[]
LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(r.code ORDER BY r.sort_order, r.code), ARRAY[]::text[])
    FROM admissions.applications a
    JOIN admissions.document_requirements r
      ON r.tenant_id = a.tenant_id AND r.institution_id = a.institution_id AND r.active AND r.required
     AND (r.grade_level_code IS NULL OR r.grade_level_code = a.desired_grade_level_code)
     AND (r.applies_to_funding IS NULL OR r.applies_to_funding = a.funding_type_requested)
    LEFT JOIN admissions.application_documents d
      ON d.tenant_id = a.tenant_id AND d.application_id = a.id AND d.requirement_id = r.id
   WHERE a.tenant_id = kernel.current_tenant_id() AND a.id = p_application
     AND (d.id IS NULL OR d.status <> 'ACCEPTED')
$$;
GRANT EXECUTE ON FUNCTION admissions.missing_required_documents(uuid) TO app_user;

-- Consentement valide : un tuteur habilité a donné DATA_PROCESSING et ne l'a pas retiré.
CREATE FUNCTION admissions.has_valid_consent(p_application uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM admissions.consents c
     WHERE c.tenant_id = kernel.current_tenant_id() AND c.application_id = p_application
       AND c.kind = 'DATA_PROCESSING' AND c.withdrawn_at IS NULL)
$$;
GRANT EXECUTE ON FUNCTION admissions.has_valid_consent(uuid) TO app_user;

-- -----------------------------------------------------------------------------
-- Tests et entretiens (facultatifs). Aucun seuil de réussite : le résultat est SAISI par l'examinateur.
-- -----------------------------------------------------------------------------
CREATE TABLE admissions.interviews (
  id                        uuid PRIMARY KEY,
  tenant_id                 uuid NOT NULL REFERENCES kernel.tenants (id),
  application_id            uuid NOT NULL,
  kind                      text NOT NULL CHECK (kind IN ('TEST', 'INTERVIEW')),
  scheduled_at              timestamptz NOT NULL,
  venue                     text,
  status                    text NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'DONE', 'NO_SHOW', 'CANCELLED')),
  conducted_by_staff_id     uuid,
  score                     numeric(7, 3) CHECK (score IS NULL OR score >= 0),
  scale_max                 numeric(7, 3) CHECK (scale_max IS NULL OR scale_max > 0),
  result_code               text CHECK (result_code IN ('PASSED', 'FAILED', 'NOT_APPLICABLE')),
  notes                     text CHECK (notes IS NULL OR length(notes) <= 2000),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (score IS NULL OR (scale_max IS NOT NULL AND score <= scale_max)),
  CHECK (status <> 'DONE' OR result_code IS NOT NULL),
  FOREIGN KEY (tenant_id, application_id) REFERENCES admissions.applications (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('admissions.interviews');
CREATE INDEX interviews_by_application ON admissions.interviews (tenant_id, application_id, scheduled_at);
GRANT SELECT, INSERT, UPDATE ON admissions.interviews TO app_user;

-- -----------------------------------------------------------------------------
-- Offres d'admission : une offre en attente au plus par candidature
-- -----------------------------------------------------------------------------
CREATE TABLE admissions.offers (
  id                          uuid PRIMARY KEY,
  tenant_id                   uuid NOT NULL REFERENCES kernel.tenants (id),
  application_id              uuid NOT NULL,
  status                      text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN')),
  grade_level_code            text NOT NULL,
  issued_at                   timestamptz NOT NULL DEFAULT now(),
  expires_at                  timestamptz NOT NULL,
  responded_at                timestamptz,
  responded_by_guardian_id    uuid,
  classroom_id                uuid,                              -- academic.classrooms.id : classe visée (sans FK), exigée pour accepter
  response_token_hash         text CHECK (response_token_hash IS NULL OR response_token_hash ~ '^[0-9a-f]{64}$'),   -- empreinte du lien de réponse à usage unique envoyé au tuteur
  response_token_consumed_at  timestamptz,
  conditions                  text CHECK (conditions IS NULL OR length(conditions) <= 2000),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (expires_at > issued_at),
  CHECK (status <> 'ACCEPTED' OR classroom_id IS NOT NULL),
  CHECK (status NOT IN ('ACCEPTED', 'DECLINED') OR (responded_at IS NOT NULL AND responded_by_guardian_id IS NOT NULL)),
  FOREIGN KEY (tenant_id, application_id) REFERENCES admissions.applications (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('admissions.offers');
CREATE UNIQUE INDEX offers_one_pending ON admissions.offers (tenant_id, application_id) WHERE status = 'PENDING';
CREATE UNIQUE INDEX offers_response_token ON admissions.offers (tenant_id, response_token_hash) WHERE response_token_hash IS NOT NULL;
CREATE INDEX offers_to_expire ON admissions.offers (tenant_id, expires_at) WHERE status = 'PENDING';
GRANT SELECT, INSERT, UPDATE ON admissions.offers TO app_user;

-- -----------------------------------------------------------------------------
-- Journal des DÉCISIONS (formelles) et journal des TRANSITIONS (techniques) : ajout seul.
-- Une décision est insérée AVANT le changement d'étape, dans la même transaction (`xid`) ; le
-- déclencheur de la candidature refuse l'entrée dans une étape « à décision » sans elle.
-- -----------------------------------------------------------------------------
CREATE TABLE admissions.decisions (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  application_id   uuid NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('ACCEPT', 'REJECT', 'WAITLIST', 'WITHDRAW', 'RECONSIDER')),
  from_stage_id    uuid NOT NULL,
  to_stage_id      uuid NOT NULL,
  reason_code      text,
  reason_text      text CHECK (reason_text IS NULL OR length(reason_text) <= 2000),
  conditions       text CHECK (conditions IS NULL OR length(conditions) <= 2000),
  offer_id         uuid,
  override_capacity boolean NOT NULL DEFAULT false,
  decided_by       uuid NOT NULL,
  decided_by_name  text NOT NULL CHECK (length(btrim(decided_by_name)) > 0),   -- identité FIGÉE au moment de l'acte
  decided_at       timestamptz NOT NULL DEFAULT now(),
  xid              bigint NOT NULL DEFAULT txid_current(),
  UNIQUE (tenant_id, id),
  CHECK (kind NOT IN ('REJECT', 'WITHDRAW') OR reason_code IS NOT NULL),
  CHECK (NOT override_capacity OR length(btrim(coalesce(reason_text, ''))) >= 10),
  FOREIGN KEY (tenant_id, application_id) REFERENCES admissions.applications (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('admissions.decisions');
CREATE INDEX decisions_by_application ON admissions.decisions (tenant_id, application_id, decided_at);
GRANT SELECT, INSERT ON admissions.decisions TO app_user;
CREATE TRIGGER decisions_append_only BEFORE UPDATE OR DELETE ON admissions.decisions
  FOR EACH ROW EXECUTE FUNCTION admissions.forbid_mutation();

CREATE TABLE admissions.transitions (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  application_id uuid NOT NULL,
  from_stage_id  uuid,
  to_stage_id    uuid NOT NULL,
  from_status    text,
  to_status      text NOT NULL,
  actor_id       uuid,
  actor_kind     text NOT NULL DEFAULT 'USER' CHECK (actor_kind IN ('USER', 'SYSTEM', 'APPLICANT')),
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, application_id) REFERENCES admissions.applications (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('admissions.transitions');
CREATE INDEX transitions_by_application ON admissions.transitions (tenant_id, application_id, occurred_at);
GRANT SELECT, INSERT ON admissions.transitions TO app_user;
CREATE TRIGGER transitions_append_only BEFORE UPDATE OR DELETE ON admissions.transitions
  FOR EACH ROW EXECUTE FUNCTION admissions.forbid_mutation();

-- Doublons détectés (candidatures, élèves existants, prospects)
CREATE TABLE admissions.duplicate_candidates (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  application_id uuid NOT NULL,
  matched_kind   text NOT NULL CHECK (matched_kind IN ('APPLICATION', 'STUDENT', 'PROSPECT')),
  matched_id     uuid NOT NULL,
  score          smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  reasons        text[] NOT NULL DEFAULT '{}',
  status         text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CONFIRMED_DUPLICATE', 'DISMISSED')),
  reviewed_by    uuid,
  reviewed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, application_id, matched_kind, matched_id),
  CHECK (status = 'OPEN' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  FOREIGN KEY (tenant_id, application_id) REFERENCES admissions.applications (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('admissions.duplicate_candidates');
GRANT SELECT, INSERT, UPDATE ON admissions.duplicate_candidates TO app_user;

-- Journal d'envoi des notifications aux familles (canal, gabarit, résultat) : idempotence par `dedupe_key`.
-- L'adresse du destinataire n'est PAS stockée (résolue au moment de l'envoi depuis le tuteur).
CREATE TABLE admissions.notification_log (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  application_id   uuid NOT NULL,
  guardian_id      uuid,
  channel          text NOT NULL CHECK (channel IN ('EMAIL', 'SMS', 'WHATSAPP', 'IN_APP')),
  template_code    text NOT NULL CHECK (template_code ~ '^[A-Z][A-Z0-9_]{1,59}$'),
  dedupe_key       text NOT NULL CHECK (length(dedupe_key) BETWEEN 1 AND 120),
  status           text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'SENT', 'FAILED', 'SKIPPED')),
  provider_ref     text,
  error_code       text,
  queued_at        timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, application_id, template_code, dedupe_key),
  CHECK (status <> 'SENT' OR sent_at IS NOT NULL),
  FOREIGN KEY (tenant_id, application_id) REFERENCES admissions.applications (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('admissions.notification_log');
GRANT SELECT, INSERT, UPDATE ON admissions.notification_log TO app_user;

-- =============================================================================
-- Garde centrale : passage d'une candidature d'une étape à une autre
-- =============================================================================
CREATE FUNCTION admissions.applications_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_stage     admissions.workflow_stages%ROWTYPE;
  v_from      admissions.workflow_stages%ROWTYPE;
  v_camp      admissions.campaigns%ROWTYPE;
  v_set       admissions.settings%ROWTYPE;
  v_cap       admissions.intake_capacities%ROWTYPE;
  v_taken     integer;
  v_wait      integer;
  v_missing   text[];
BEGIN
  SELECT * INTO v_camp FROM admissions.campaigns c WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.campaign_id;
  IF v_camp.institution_id <> NEW.institution_id OR v_camp.workflow_id <> NEW.workflow_id THEN
    RAISE EXCEPTION 'admissions.application_campaign_mismatch: l''établissement et le workflow doivent être ceux de la campagne' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_stage FROM admissions.workflow_stages s WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.stage_id;
  SELECT * INTO v_set FROM admissions.settings st WHERE st.tenant_id = NEW.tenant_id AND st.institution_id = NEW.institution_id;
  -- valeurs par défaut du paramétrage si l'établissement n'a pas encore de ligne
  IF NOT FOUND THEN
    v_set.capacity_policy := 'HARD'; v_set.duplicate_policy := 'WARN'; v_set.consent_required := true;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT v_stage.is_initial THEN
      RAISE EXCEPTION 'admissions.application_initial_stage: une candidature naît à l''étape initiale du workflow' USING ERRCODE = 'check_violation';
    END IF;
    IF v_camp.status NOT IN ('OPEN', 'DRAFT') THEN
      RAISE EXCEPTION 'admissions.campaign_closed: la campagne est % ; aucun dossier ne peut être créé', v_camp.status USING ERRCODE = 'check_violation';
    END IF;
    NEW.status := v_stage.canonical_status;
    RETURN NEW;
  END IF;

  -- ---------------------------------------------------------------- UPDATE
  IF NEW.institution_id <> OLD.institution_id OR NEW.campaign_id <> OLD.campaign_id
     OR NEW.workflow_id <> OLD.workflow_id OR NEW.application_number <> OLD.application_number THEN
    RAISE EXCEPTION 'admissions.application_identity_immutable: établissement, campagne, workflow et numéro sont figés' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.student_id IS NOT NULL AND (
       NEW.applicant_first_name <> OLD.applicant_first_name OR NEW.applicant_last_name <> OLD.applicant_last_name
       OR NEW.applicant_birth_date <> OLD.applicant_birth_date OR NEW.desired_grade_level_code <> OLD.desired_grade_level_code
       OR NEW.student_id IS DISTINCT FROM OLD.student_id OR NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id) THEN
    RAISE EXCEPTION 'admissions.application_frozen_after_enrollment: l''identité est portée par le dossier de l''élève (people) une fois créé' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.anonymized_at IS NOT NULL AND NEW.anonymized_at IS NOT DISTINCT FROM OLD.anonymized_at AND NEW.stage_id <> OLD.stage_id THEN
    RAISE EXCEPTION 'admissions.application_anonymized: une candidature anonymisée ne change plus' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.enrolled_at IS NOT NULL AND NEW.status <> 'ENROLLED' THEN
    RAISE EXCEPTION 'admissions.application_enrolled_final: une candidature inscrite ne change plus d''étape' USING ERRCODE = 'restrict_violation';
  END IF;

  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := now();

  IF NEW.stage_id <> OLD.stage_id THEN
    SELECT * INTO v_from FROM admissions.workflow_stages s WHERE s.tenant_id = OLD.tenant_id AND s.id = OLD.stage_id;
    IF NOT EXISTS (SELECT 1 FROM admissions.workflow_transitions t
                    WHERE t.tenant_id = NEW.tenant_id AND t.workflow_id = NEW.workflow_id
                      AND t.from_stage_id = OLD.stage_id AND t.to_stage_id = NEW.stage_id) THEN
      RAISE EXCEPTION 'admissions.transition_not_allowed: le passage de % à % n''est pas déclaré dans le workflow', v_from.code, v_stage.code USING ERRCODE = 'restrict_violation';
    END IF;
    NEW.status := v_stage.canonical_status;

    IF v_stage.requires_consent AND v_set.consent_required AND NOT admissions.has_valid_consent(NEW.id) THEN
      RAISE EXCEPTION 'admissions.consent_missing: le consentement parental est requis avant l''étape %', v_stage.code USING ERRCODE = 'check_violation';
    END IF;
    IF v_stage.requires_documents_complete THEN
      v_missing := admissions.missing_required_documents(NEW.id);
      IF cardinality(v_missing) > 0 THEN
        RAISE EXCEPTION 'admissions.documents_incomplete: pièces non acceptées : %', array_to_string(v_missing, ', ') USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF v_stage.requires_interview_done AND NOT EXISTS (
         SELECT 1 FROM admissions.interviews i WHERE i.tenant_id = NEW.tenant_id AND i.application_id = NEW.id AND i.status = 'DONE') THEN
      RAISE EXCEPTION 'admissions.interview_missing: un test ou un entretien terminé est requis avant l''étape %', v_stage.code USING ERRCODE = 'check_violation';
    END IF;
    IF v_stage.requires_decision THEN
      IF NOT EXISTS (SELECT 1 FROM admissions.decisions d
                      WHERE d.tenant_id = NEW.tenant_id AND d.application_id = NEW.id
                        AND d.from_stage_id = OLD.stage_id AND d.to_stage_id = NEW.stage_id AND d.xid = txid_current()) THEN
        RAISE EXCEPTION 'admissions.decision_missing: l''étape % exige une décision formelle journalisée dans la même transaction', v_stage.code USING ERRCODE = 'check_violation';
      END IF;
      NEW.decided_at := now();
    END IF;
    IF v_stage.creates_enrollment THEN
      IF NOT EXISTS (SELECT 1 FROM admissions.offers o WHERE o.tenant_id = NEW.tenant_id AND o.application_id = NEW.id
                        AND o.status = 'ACCEPTED' AND o.classroom_id IS NOT NULL) THEN
        RAISE EXCEPTION 'admissions.offer_not_accepted: l''inscription exige une offre acceptée portant la classe visée' USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.student_id IS NULL OR NEW.enrollment_id IS NULL THEN
        RAISE EXCEPTION 'admissions.enrollment_missing: l''élève et l''inscription doivent être créés avant l''étape %', v_stage.code USING ERRCODE = 'check_violation';
      END IF;
      IF v_set.duplicate_policy = 'BLOCK' AND EXISTS (
           SELECT 1 FROM admissions.duplicate_candidates d WHERE d.tenant_id = NEW.tenant_id AND d.application_id = NEW.id AND d.status = 'OPEN') THEN
        RAISE EXCEPTION 'admissions.duplicates_pending: un doublon possible doit être tranché avant l''inscription' USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    -- capacité : entrée dans une étape qui RÉSERVE une place (la ligne de capacité est verrouillée : sérialise les concurrents)
    IF v_stage.holds_seat AND NOT v_from.holds_seat AND v_set.capacity_policy <> 'NONE' THEN
      SELECT * INTO v_cap FROM admissions.intake_capacities c
       WHERE c.tenant_id = NEW.tenant_id AND c.campaign_id = NEW.campaign_id AND c.grade_level_code = NEW.desired_grade_level_code
         AND (c.program_id IS NOT DISTINCT FROM NEW.desired_program_id OR c.program_id IS NULL)
       ORDER BY (c.program_id IS NULL) ASC LIMIT 1 FOR UPDATE;
      IF FOUND THEN
        SELECT count(*) INTO v_taken
          FROM admissions.applications a
          JOIN admissions.workflow_stages s ON s.tenant_id = a.tenant_id AND s.id = a.stage_id
         WHERE a.tenant_id = NEW.tenant_id AND a.campaign_id = NEW.campaign_id AND a.desired_grade_level_code = NEW.desired_grade_level_code
           AND (v_cap.program_id IS NULL OR a.desired_program_id IS NOT DISTINCT FROM v_cap.program_id)
           AND a.id <> NEW.id AND s.holds_seat;
        IF v_taken >= v_cap.seats THEN
          IF v_set.capacity_policy = 'HARD' THEN
            RAISE EXCEPTION 'admissions.capacity_full: % places occupées pour % (niveau %)', v_taken, v_cap.seats, NEW.desired_grade_level_code USING ERRCODE = 'check_violation';
          ELSIF length(btrim(coalesce(NEW.capacity_override_reason, ''))) < 10 THEN
            RAISE EXCEPTION 'admissions.capacity_override_reason: un dépassement de capacité exige un motif d''au moins 10 caractères' USING ERRCODE = 'check_violation';
          END IF;
        END IF;
      END IF;
    END IF;

    -- liste d'attente : horodatage d'entrée et plafond éventuel
    IF NEW.status = 'WAITLISTED' AND OLD.status <> 'WAITLISTED' THEN
      NEW.waitlist_entered_at := now();
      SELECT * INTO v_cap FROM admissions.intake_capacities c
       WHERE c.tenant_id = NEW.tenant_id AND c.campaign_id = NEW.campaign_id AND c.grade_level_code = NEW.desired_grade_level_code
         AND (c.program_id IS NOT DISTINCT FROM NEW.desired_program_id OR c.program_id IS NULL)
       ORDER BY (c.program_id IS NULL) ASC LIMIT 1 FOR UPDATE;
      IF FOUND AND v_cap.waitlist_limit IS NOT NULL THEN
        SELECT count(*) INTO v_wait FROM admissions.applications a
         WHERE a.tenant_id = NEW.tenant_id AND a.campaign_id = NEW.campaign_id
           AND a.desired_grade_level_code = NEW.desired_grade_level_code AND a.status = 'WAITLISTED' AND a.id <> NEW.id;
        IF v_wait >= v_cap.waitlist_limit THEN
          RAISE EXCEPTION 'admissions.waitlist_full: la liste d''attente compte déjà % dossiers (plafond %)', v_wait, v_cap.waitlist_limit USING ERRCODE = 'check_violation';
        END IF;
      END IF;
    END IF;

    IF NEW.status <> 'DRAFT' AND NEW.submitted_at IS NULL THEN NEW.submitted_at := now(); END IF;
    IF v_stage.canonical_status = 'ENROLLED' THEN
      NEW.enrolled_at := coalesce(NEW.enrolled_at, now());
    END IF;
    IF v_stage.is_terminal THEN NEW.closed_at := now(); END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER applications_guard BEFORE INSERT OR UPDATE ON admissions.applications
  FOR EACH ROW EXECUTE FUNCTION admissions.applications_guard();

-- Journal automatique des transitions (création comprise) : complet quel que soit le code appelant.
CREATE FUNCTION admissions.applications_log_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.stage_id <> OLD.stage_id THEN
    INSERT INTO admissions.transitions (id, tenant_id, application_id, from_stage_id, to_stage_id, from_status, to_status, actor_id, actor_kind)
    VALUES (gen_random_uuid(), NEW.tenant_id, NEW.id,
            CASE WHEN TG_OP = 'UPDATE' THEN OLD.stage_id END, NEW.stage_id,
            CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status,
            kernel.current_user_id(),
            CASE WHEN kernel.current_user_id() IS NULL THEN 'SYSTEM' ELSE 'USER' END);
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER applications_log_transition AFTER INSERT OR UPDATE ON admissions.applications
  FOR EACH ROW EXECUTE FUNCTION admissions.applications_log_transition();

-- Garde des décisions : l'étape de départ est l'étape COURANTE du dossier, la transition existe, le type de
-- décision correspond au statut canonique visé ; un refus / retrait cite son motif (si la table des motifs existe).
CREATE FUNCTION admissions.decisions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_app  admissions.applications%ROWTYPE;
  v_to   admissions.workflow_stages%ROWTYPE;
BEGIN
  SELECT * INTO v_app FROM admissions.applications a WHERE a.tenant_id = NEW.tenant_id AND a.id = NEW.application_id;
  IF v_app.stage_id <> NEW.from_stage_id THEN
    RAISE EXCEPTION 'admissions.decision_stale: la décision part d''une étape qui n''est plus l''étape courante du dossier' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM admissions.workflow_transitions t
                  WHERE t.tenant_id = NEW.tenant_id AND t.workflow_id = v_app.workflow_id
                    AND t.from_stage_id = NEW.from_stage_id AND t.to_stage_id = NEW.to_stage_id) THEN
    RAISE EXCEPTION 'admissions.transition_not_allowed: transition non déclarée dans le workflow' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT * INTO v_to FROM admissions.workflow_stages s WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.to_stage_id;
  IF NOT ((NEW.kind = 'ACCEPT'     AND v_to.canonical_status = 'ACCEPTED')
       OR (NEW.kind = 'REJECT'     AND v_to.canonical_status = 'REJECTED' AND v_to.closure_kind IS NOT DISTINCT FROM 'REJECTED_BY_SCHOOL')
       OR (NEW.kind = 'WAITLIST'   AND v_to.canonical_status = 'WAITLISTED')
       OR (NEW.kind = 'WITHDRAW'   AND v_to.canonical_status = 'REJECTED' AND v_to.closure_kind IN ('WITHDRAWN_BY_FAMILY', 'OFFER_EXPIRED', 'NO_SHOW', 'DUPLICATE'))
       OR (NEW.kind = 'RECONSIDER' AND v_to.canonical_status IN ('SUBMITTED', 'UNDER_REVIEW', 'MISSING_DOCUMENT'))) THEN
    RAISE EXCEPTION 'admissions.decision_kind_mismatch: le type de décision % ne correspond pas à l''étape visée (%)', NEW.kind, v_to.code USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER decisions_guard BEFORE INSERT ON admissions.decisions
  FOR EACH ROW EXECUTE FUNCTION admissions.decisions_guard();

-- -----------------------------------------------------------------------------
-- Liste d'attente : ordre = classe de priorité (rang croissant), puis date d'entrée, puis identifiant.
-- Lue sous la RLS de l'appelant. Une priorité absente passe après toutes les classes déclarées.
-- -----------------------------------------------------------------------------
CREATE FUNCTION admissions.waitlist_order(p_campaign uuid, p_grade text)
RETURNS TABLE (queue_position integer, application_id uuid, priority_rank integer, waitlist_entered_at timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT (row_number() OVER (ORDER BY coalesce(pc.rank, 2147483647), a.waitlist_entered_at, a.id))::integer,
         a.id, coalesce(pc.rank, 2147483647), a.waitlist_entered_at
    FROM admissions.applications a
    LEFT JOIN admissions.priority_classes pc
      ON pc.tenant_id = a.tenant_id AND pc.institution_id = a.institution_id AND pc.code = a.priority_class_code AND pc.active
   WHERE a.tenant_id = kernel.current_tenant_id() AND a.campaign_id = p_campaign
     AND a.desired_grade_level_code = p_grade AND a.status = 'WAITLISTED'
   ORDER BY 1
$$;
GRANT EXECUTE ON FUNCTION admissions.waitlist_order(uuid, text) TO app_user;

-- Places restantes pour un niveau : capacité − dossiers qui réservent une place (NULL si aucun plafond).
CREATE FUNCTION admissions.seats_left(p_campaign uuid, p_grade text, p_program uuid DEFAULT NULL) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT c.seats - (SELECT count(*)::integer
                      FROM admissions.applications a
                      JOIN admissions.workflow_stages s ON s.tenant_id = a.tenant_id AND s.id = a.stage_id
                     WHERE a.tenant_id = c.tenant_id AND a.campaign_id = c.campaign_id AND a.desired_grade_level_code = c.grade_level_code
                       AND (c.program_id IS NULL OR a.desired_program_id IS NOT DISTINCT FROM c.program_id) AND s.holds_seat)
    FROM admissions.intake_capacities c
   WHERE c.tenant_id = kernel.current_tenant_id() AND c.campaign_id = p_campaign AND c.grade_level_code = p_grade
     AND (c.program_id IS NOT DISTINCT FROM p_program OR c.program_id IS NULL)
   ORDER BY (c.program_id IS NULL) ASC LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION admissions.seats_left(uuid, text, uuid) TO app_user;

-- -----------------------------------------------------------------------------
-- Anonymisation (droit à l'effacement, fin de conservation) : remplace l'identité du candidat et les
-- coordonnées des tuteurs par des valeurs neutres, vide les champs libres et les références de pièces.
-- Réservée aux dossiers CLOS SANS inscription (REJECTED, y compris retraits et offres expirées) ; les
-- compteurs, statuts, dates et décisions (sans nom) sont conservés pour les statistiques. Les fichiers
-- eux-mêmes sont purgés par l'application (StoragePort / documents) AVANT l'appel.
-- -----------------------------------------------------------------------------
CREATE FUNCTION admissions.anonymize_application(p_application uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_app admissions.applications%ROWTYPE;
BEGIN
  SELECT * INTO v_app FROM admissions.applications a
   WHERE a.tenant_id = kernel.current_tenant_id() AND a.id = p_application FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admissions.application_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_app.status <> 'REJECTED' OR v_app.student_id IS NOT NULL OR v_app.closed_at IS NULL THEN
    RAISE EXCEPTION 'admissions.anonymize_forbidden: seule une candidature close sans inscription s''anonymise (statut %)', v_app.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF v_app.anonymized_at IS NOT NULL THEN RETURN; END IF;
  UPDATE admissions.applications
     SET applicant_first_name = 'ANONYMISÉ', applicant_last_name = 'ANONYMISÉ',
         applicant_birth_date = date_trunc('year', applicant_birth_date)::date,
         applicant_birth_place = NULL, applicant_nationality = NULL, previous_school = NULL, referrer_label = NULL,
         assignment_reference = CASE WHEN funding_type_requested = 'STATE_ASSIGNED' THEN 'ANONYMISÉ' ELSE NULL END,
         extra = '{}'::jsonb, tracking_code_hash = NULL, capacity_override_reason = NULL,
         anonymized_at = now()
   WHERE tenant_id = v_app.tenant_id AND id = v_app.id;
  UPDATE admissions.application_guardians
     SET first_name = 'ANONYMISÉ', last_name = 'ANONYMISÉ', phone = '000000', email = NULL, profession = NULL
   WHERE tenant_id = v_app.tenant_id AND application_id = v_app.id;
  UPDATE admissions.application_documents
     SET status = 'MISSING', document_ref = NULL, storage_key = NULL, content_type = NULL, size_bytes = NULL, sha256 = NULL,
         rejection_reason = NULL, reviewed_by = NULL, reviewed_at = NULL
   WHERE tenant_id = v_app.tenant_id AND application_id = v_app.id;
  UPDATE admissions.interviews SET notes = NULL, venue = NULL WHERE tenant_id = v_app.tenant_id AND application_id = v_app.id;
  UPDATE admissions.offers SET conditions = NULL, response_token_hash = NULL WHERE tenant_id = v_app.tenant_id AND application_id = v_app.id;
  UPDATE admissions.duplicate_candidates SET reasons = '{}' WHERE tenant_id = v_app.tenant_id AND application_id = v_app.id;
END
$$;
GRANT EXECUTE ON FUNCTION admissions.anonymize_application(uuid) TO app_user;
```

### 5.3 Formulaire public

<!-- migration: 1902_admissions_public_form.sql -->
```sql
-- =============================================================================
-- 1902 — Module admissions : formulaire public — jetons à usage unique et journal de tentatives
-- =============================================================================
--
-- Défense contre le spam du formulaire public (l'API pose AUSSI un limiteur de débit adossé à Redis,
-- `runtime.rateLimiter`, et vérifie un CAPTCHA si l'établissement l'exige) :
--   1. Un JETON de formulaire est émis au chargement de la page ; seul son EMPREINTE SHA-256 est stockée.
--   2. Le jeton n'est valable qu'après un DÉLAI MINIMAL (`min_ready_at` : un robot qui poste dans la
--      seconde est refusé), expire, et ne sert QU'UNE FOIS (consommation atomique).
--   3. Chaque tentative est journalisée avec l'empreinte (HMAC) de l'IP et de l'agent, jamais en clair.
-- Aucune donnée sensible n'est exposée par le formulaire : il ne renvoie qu'un code de suivi opaque.
-- =============================================================================

CREATE TABLE admissions.public_form_sessions (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id  uuid NOT NULL,
  token_hash      text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  issued_at       timestamptz NOT NULL DEFAULT now(),
  min_ready_at    timestamptz NOT NULL,
  expires_at      timestamptz NOT NULL,
  consumed_at     timestamptz,
  ip_hash         text CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$'),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, token_hash),
  CHECK (min_ready_at >= issued_at),
  CHECK (expires_at > min_ready_at)
);
SELECT kernel.enable_tenant_rls('admissions.public_form_sessions');
CREATE INDEX public_form_sessions_to_purge ON admissions.public_form_sessions (tenant_id, expires_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON admissions.public_form_sessions TO app_user;   -- DELETE : purge des jetons expirés

-- Consommation ATOMIQUE : vrai si et seulement si le jeton existe, n'est pas expiré, a dépassé son délai
-- minimal et n'a jamais servi. Une seule transaction gagne, même sous concurrence (verrou de ligne).
CREATE FUNCTION admissions.consume_form_session(p_token_hash text) RETURNS boolean
LANGUAGE sql AS $$
  WITH c AS (
    UPDATE admissions.public_form_sessions s
       SET consumed_at = now()
     WHERE s.tenant_id = kernel.current_tenant_id() AND s.token_hash = p_token_hash
       AND s.consumed_at IS NULL AND s.expires_at > now() AND s.min_ready_at <= now()
    RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM c)
$$;
GRANT EXECUTE ON FUNCTION admissions.consume_form_session(text) TO app_user;

-- Un jeton consommé ne change plus.
CREATE FUNCTION admissions.public_form_sessions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'admissions.form_session_consumed: un jeton consommé est figé' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.token_hash <> OLD.token_hash OR NEW.issued_at <> OLD.issued_at OR NEW.min_ready_at <> OLD.min_ready_at OR NEW.expires_at <> OLD.expires_at THEN
    RAISE EXCEPTION 'admissions.form_session_immutable: l''échéance et l''empreinte d''un jeton ne se modifient pas' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER public_form_sessions_guard BEFORE UPDATE ON admissions.public_form_sessions
  FOR EACH ROW EXECUTE FUNCTION admissions.public_form_sessions_guard();

CREATE TABLE admissions.submission_attempts (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id  uuid NOT NULL,
  ip_hash         text NOT NULL CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
  ua_hash         text CHECK (ua_hash IS NULL OR ua_hash ~ '^[0-9a-f]{64}$'),
  outcome         text NOT NULL CHECK (outcome IN ('ACCEPTED', 'REJECTED_RATE', 'REJECTED_BOT', 'REJECTED_TOKEN', 'REJECTED_VALIDATION', 'REJECTED_DUPLICATE')),
  application_id  uuid,
  attempted_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('admissions.submission_attempts');
CREATE INDEX submission_attempts_by_ip ON admissions.submission_attempts (tenant_id, ip_hash, attempted_at DESC);
GRANT SELECT, INSERT, DELETE ON admissions.submission_attempts TO app_user;   -- DELETE : purge (rétention courte)

-- Tentatives récentes d'une empreinte d'IP (décision de refus par l'API, complète le limiteur Redis).
CREATE FUNCTION admissions.recent_attempts(p_ip_hash text, p_window interval) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT count(*)::integer FROM admissions.submission_attempts a
   WHERE a.tenant_id = kernel.current_tenant_id() AND a.ip_hash = p_ip_hash AND a.attempted_at > now() - p_window
$$;
GRANT EXECUTE ON FUNCTION admissions.recent_attempts(text, interval) TO app_user;
```

### 5.4 Résultat d'examen et moyenne reçus d'`examinations` (ajout 1903, décision métier Q-E18)

Ajout au DDL de référence : `exam_results` range, par élève, le résultat (« admis / non admis ») **ET la moyenne** transmis par `examinations` (CEPE vers l'admission en 6e) : une ligne par résultat source, remplacée seulement par une **version plus grande** (correction approuvée), identité figée. Un dossier n'y est rattaché que par son propre élève ou un rapprochement **confirmé** (jamais un rapprochement ouvert). La moyenne n'est lue que par le personnel habilité (`admission.exam_result.read`, lecture tracée).

<!-- migration: 1904_admissions_exam_results.sql -->
```sql
-- =============================================================================
-- 1903 — Module admissions : résultat d'examen ET moyenne reçus de `examinations` (décision métier Q-E18, CEPE -> admission en 6e)
-- =============================================================================
--
-- `examinations` transmet (événement `examinations.result.transmitted`) le résultat « admis / non admis » ET la MOYENNE d'un élève ayant
-- passé un examen qui conditionne l'admission. Ce module les reçoit et les range ICI, par élève : jamais de SQL croisé, jamais de nom.
--
--   * Une ligne par résultat de l'examen (`source_result_id`) ; une correction approuvée après transmission remplace la ligne si sa
--     version (`revision`) est plus grande (jamais l'inverse : un événement tardif ou rejoué ne défait rien).
--   * Un dossier de candidature n'y est rattaché que par un lien SÛR : son propre élève (`applications.student_id`) ou un
--     rapprochement CONFIRMÉ par une personne (`duplicate_candidates.status = 'CONFIRMED_DUPLICATE'`). Un simple rapprochement
--     « ouvert » ne montre jamais la moyenne d'un autre enfant.
--   * La MOYENNE n'est lue que par le personnel d'admission habilité (permission `admission.exam_result.read`, lecture auditée) ;
--     sans cette permission, seul « admis / non admis » est montré.
--   * Aucune durée de conservation n'est inventée : elle suivra la politique de conservation de l'établissement.
-- =============================================================================

CREATE TABLE admissions.exam_results (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id    uuid NOT NULL,
  student_id        uuid NOT NULL,                              -- people.students.id (sans FK)
  source_candidate_id uuid NOT NULL,                            -- examinations.candidates.id (sans FK)
  source_result_id  uuid NOT NULL,                              -- examinations.candidate_results.id (sans FK)
  exam_type_code    text NOT NULL CHECK (exam_type_code ~ '^[A-Z][A-Z0-9_]{1,19}$'),
  session_year      integer NOT NULL CHECK (session_year BETWEEN 2000 AND 2200),
  outcome           text NOT NULL CHECK (outcome IN ('ADMITTED', 'FAILED', 'ABSENT', 'EXCLUDED', 'DEFERRED')),
  admitted          boolean NOT NULL,
  average           numeric(7, 3) CHECK (average IS NULL OR average >= 0),
  revision          integer NOT NULL CHECK (revision >= 1),
  source_event_id   uuid NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, source_result_id),
  CHECK (admitted = (outcome = 'ADMITTED')),
  CHECK (outcome NOT IN ('ABSENT', 'EXCLUDED', 'DEFERRED') OR average IS NULL)
);
SELECT kernel.enable_tenant_rls('admissions.exam_results');
CREATE INDEX exam_results_by_student ON admissions.exam_results (tenant_id, student_id, session_year DESC);
GRANT SELECT, INSERT, UPDATE ON admissions.exam_results TO app_user;      -- jamais de suppression par l'application

-- L'identité d'un résultat reçu est figée ; une mise à jour ne vient que d'une version PLUS GRANDE du même résultat.
CREATE FUNCTION admissions.exam_results_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.student_id <> OLD.student_id OR NEW.source_result_id <> OLD.source_result_id OR NEW.source_candidate_id <> OLD.source_candidate_id
     OR NEW.institution_id <> OLD.institution_id OR NEW.exam_type_code <> OLD.exam_type_code OR NEW.session_year <> OLD.session_year THEN
    RAISE EXCEPTION 'admissions.exam_result_identity_immutable: élève, résultat source, établissement, examen et année sont figés' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.revision <= OLD.revision THEN
    RAISE EXCEPTION 'admissions.exam_result_stale: une correction remplace un résultat reçu seulement si sa version est plus grande (% -> %)', OLD.revision, NEW.revision USING ERRCODE = 'restrict_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER exam_results_guard BEFORE UPDATE ON admissions.exam_results
  FOR EACH ROW EXECUTE FUNCTION admissions.exam_results_guard();
```

## 6. Invariants : qui les garantit

| Invariant | Base (DDL) | Domaine / cas d'usage |
|---|---|---|
| Un workflow publié est cohérent et figé ; un seul publié par établissement et cycle | `workflows_guard`, `workflow_structure_guard`, index `workflows_one_published` | `publishWorkflow` renvoie la liste des défauts avant d'écrire ; éditeur d'écran |
| Une candidature naît à l'étape initiale, dans une campagne ouverte, avec le workflow de la campagne | `applications_guard` (INSERT), FK `(workflow, étape)` | `createApplication` |
| Le statut canonique est dérivé de l'étape | `applications_guard` | — |
| Une transition est déclarée dans le workflow | `applications_guard` + `workflow_transitions` | `transitionApplication` vérifie en plus `requirePermission(permission_key)` |
| Consentement avant le dépôt ; pièces complètes avant l'admission ; entretien terminé si exigé | `applications_guard`, `has_valid_consent`, `missing_required_documents` | messages listant les manques |
| Décision formelle journalisée dans la même transaction, type cohérent, étape de départ courante | `decisions_guard` + `applications_guard` (`xid`) | `recordDecision` insère puis transitionne |
| Journaux en ajout seul ; `app_user` sans `UPDATE`/`DELETE` sur `decisions`, `transitions` | `forbid_mutation` + `GRANT` | audit en plus |
| Capacité par niveau (HARD / SOFT avec motif / NONE) sérialisée | `applications_guard` (verrou de ligne) | `getSeatsLeft` pour l'affichage |
| Plafond de liste d'attente | `applications_guard` | — |
| Une candidature vivante par enfant et par campagne | index unique partiel sur `identity_key` | réponse publique neutre (pas d'énumération) |
| `STATE_ASSIGNED` exige la référence d'affectation | `CHECK` | feature `academic.state-assigned` |
| L'étape qui crée l'inscription exige une offre acceptée avec classe, l'élève, l'inscription, pas de doublon ouvert (BLOCK) | `applications_guard`, `offers` (`CHECK`) | saga `acceptOffer` |
| `ENROLLED` exige la confirmation de l'inscription ; identité figée ensuite ; plus de sortie | `CHECK`, `applications_guard` | consommateur de `academic.enrollment.confirmed` |
| Une seule offre en attente ; accepter = date + tuteur + classe | index partiel, `CHECK` | `issueOffer`, `acceptOffer` |
| Jeton de formulaire : usage unique, délai minimal, expiration ; consommation atomique | `consume_form_session`, `public_form_sessions_guard` | route publique |
| Un tenant ne publie que ses propres liens publics | politiques RLS de `public_form_index` | — |
| Anonymisation : dossiers clos sans inscription seulement | `anonymize_application` | tâche de rétention |
| Isolation tenant | RLS forcée, FK composites | test d'isolation générique (A/B) |

## 7. Tests de comportement livrés (`ddl/tests`)

| Fichier | Tests | Couvre |
|---|---|---|
| `10_workflow.sql` | 44 | contraintes d'étape, **sept** cas de workflow incohérent refusés à la publication, immuabilité, un seul publié par cycle, campagnes, capacités, paramètres, lien public (lecture ouverte, écriture limitée), RLS |
| `20_applications.sql` | 110 | cycle de vie complet, doublons (accents, casse), consentement, pièces, décisions (étape périmée, type incohérent, motif), journaux, capacité HARD/SOFT, liste d'attente et priorités, retrait et redépôt, inscription (offre, élève, confirmation), doublons BLOCK, entretien, plafond d'attente, offres, prospects, notifications, campagne close, numérotation, textes de consentement, anonymisation, RLS et `GRANT` |
| `30_public_form_and_concurrency.sql` | 20 | jetons (trop rapide, valide, rejoué, expiré, figé), empreintes, tentatives, **concurrence réelle** : un seul jeton consommé, une seule admission sur la dernière place, 100 numéros sans trou |
| `40_exam_results.sql` | 11 | résultat d'examen reçu (Q-E18) : une ligne par résultat source, « admis » cohérent avec l'issue, pas de moyenne pour un absent, version croissante seulement, identité figée, RLS et `GRANT` |

Exécution : `node specs/v2/007-admissions/ddl/run.mjs` (Docker requis, conteneur éphémère supprimé, `ED_PG_IMAGE=postgres:17-alpine`). `ED_ONLY=<motif>` limite les fichiers de test ; `ED_VERBOSE=1` détaille les erreurs. Contrôle documentaire : `--check-doc`.

## 8. Chemins d'accès et index

| Besoin | Requête | Index |
|---|---|---|
| Entonnoir d'une campagne | `GROUP BY status, desired_grade_level_code WHERE campaign_id = $1` | `applications_by_campaign_status` |
| Dossiers d'une étape (colonnes du tableau) | `WHERE stage_id = $1 ORDER BY updated_at` | `applications_by_stage` |
| Rapprochement de doublons | `WHERE identity_key = $1` | `applications_by_identity` |
| Ordre de la liste d'attente | `waitlist_order(campaign, niveau)` | `applications_waitlist` (index partiel `WAITLISTED`) |
| Suivi par code | `WHERE tracking_code_hash = $1` | `applications_tracking_code` |
| Offres à expirer | `WHERE status = 'PENDING' AND expires_at < now()` | `offers_to_expire` |
| Historique d'un dossier | `WHERE application_id = $1 ORDER BY occurred_at` | `transitions_by_application`, `decisions_by_application` |
| Résolution d'un lien public | `WHERE slug = $1` | clé primaire de `public_form_index` |
| Purge des jetons expirés | `WHERE expires_at < now()` | `public_form_sessions_to_purge` |
| Tentatives d'une IP | `WHERE ip_hash = $1 AND attempted_at > now() - $2` | `submission_attempts_by_ip` |

## 9. Projections et lectures croisées

Aucune lecture inter-schémas : `admissions` appelle les **ports** `StudentRegistry` (people), `EnrollmentService` (academic), `RegistrationFeeService` (finance), `DocumentStore` (documents), `ApplicantNotifier`, `Captcha`, `IdentityProvisioner`. Les listes d'élèves inscrits passent par la projection de `people`, jamais par une jointure avec `admissions`. Aucune vue SQL ne traverse les schémas ; les tableaux de bord de direction (025) consomment les événements `admissions.*`.

## 10. Rejeu de l'historique et reprise

Aucune donnée de production n'est reprise (D8) : `registration_requests` et `student_provenances` du legacy sont supprimés dans la tranche 2.2 (voir `parity.md`). Les environnements de démonstration, de test et d'e2e sont construits par seeds déterministes (workflow standard, campagne, capacités, 40 candidatures à tous les stades). Les listes d'affectation d'État ou de candidats externes entreront par `031-imports` (`created_via = IMPORT`).
