# Modèle de données — 005-primary (schéma Postgres `primary_school`)

**Statut** : DDL de référence, **exécuté et testé** sur PostgreSQL 17 (`ddl/run.mjs` : 118 tests de comportement, dont 14 pour l'ajout `1803` — publication et immuabilité des référentiels, FK composites, verrou de période, révisions à trace obligatoire, synthèse par compteurs, bilan scellé et versions, archive gelée, RLS A/B). Les fichiers ci-dessous sont les migrations cibles `apps/api/src/modules/primary_school/migrations/1800…1803` (plage `1800–1899` : `imports` a pris `1800`) ; ils font foi sur les noms et les contraintes. Les blocs `<!-- migration: … -->` sont **générés** depuis `ddl/migrations/*.sql` (`node ddl/run.mjs --sync-doc`) et vérifiés par `--check-doc`.

**Sources** : `docs/architecture/module-conventions.md`, ADR-002 (RLS), ADR-005 (types de ligne à la main), ADR-006 (un schéma par module), ADR-007 (UUID, UTC, snake_case anglais), `specs/v2/004-academic-core/data-model.md` (patron), `specs/v2/011-assessments-grades` (révisions), `specs/v2/013-report-cards` (instantanés).

## 1. Conventions appliquées

| Règle | Application dans `primary_school` |
|---|---|
| Un module = un schéma | `primary_school` (PRIMARY est un mot réservé de SQL, d'où le nom) ; aucune FK vers un autre schéma que `kernel.tenants(id)`. Établissement, classe, période, inscription, élève, enseignant, délibération, décision, résultat d'année, document : **UUID sans FK**, vérifiés par les API publiques de `academic`, `people`, `results`, `reportcards` ; les niveaux par leur **code** |
| Toute table de tenant | `tenant_id uuid NOT NULL REFERENCES kernel.tenants(id)` + `kernel.enable_tenant_rls()` + `GRANT` explicite à `app_user`. **Aucune table globale** : allowlist d'isolation vide (`isolation-allowlist.primary_school.ts`) |
| FK internes composites | `(tenant_id, id)` partout : une ligne ne peut pas pointer une ligne d'un autre tenant (testé : FK refusée) |
| Identifiants, dates, montants | UUID fournis par l'application (`newId()`) ; `timestamptz` UTC ; **aucun montant** dans ce module |
| Constantes réglementaires | **Aucune**. Échelles, référentiels, phrases : données portant leur origine (`source_kind` ∈ `regulation`, `institution`, `platform`, `placeholder` ; `regulation` exige `source_reference`) |
| Suppression | Pas de `DELETE` applicatif sur les bilans scellés, archives, révisions, présences signées ; un référentiel publié ne se supprime pas |
| Journaux | `competency_revisions` : ajout seul (déclencheur) ; trace **obligatoire avant** correction (`xid`) |
| Audit | Les cas d'usage sensibles (`revise`, `seal`, `reissue`, `freeze`, `template.apply`) appellent `audit.record(tx, …)` dans la même transaction ; aucune appréciation ni note dans l'audit |
| Événements | `kernel.domain_events` via `PgOutboxWriter(tx)`, payload `{ v: 1, … }` sans contenu pédagogique |

## 2. Vue d'ensemble

```
academic (UUID, sans FK) : classroom_id, academic_period_id, enrollment_id, academic_year_id, grade_level (code)
people   (UUID, sans FK) : student_id, staff_id          results (UUID) : deliberation_id, decision_ref, year_result_ref

rating_scales ─< rating_levels
      │
      └── competency_frameworks ─< framework_grade_levels (codes de niveaux)
                │   (DRAFT -> PUBLISHED -> RETIRED, structure figée une fois publié)
                ├─< competency_domains ─< competencies
                └─ competency_assessments (élève × période × compétence) ─< competency_revisions (append-only)
                          ▲
                   period_locks (classe × période ; miroir des événements academic)

council_cases (délibération × inscription)      council_attendance (délibération × maître)
annual_reviews (inscription × année × version)  year_archives (établissement × année)
appreciation_phrases    settings    template_applications
```

## 3. Catalogue des tables

| Table | Rôle | Cardinalité indicative (école de 600 élèves, 15 classes) |
|---|---|---|
| `rating_scales`, `rating_levels` | Échelles d'appréciation | 1 à 3 échelles ; 3 à 6 niveaux |
| `competency_frameworks`, `framework_grade_levels`, `competency_domains`, `competencies` | Référentiels versionnés | 2 à 6 référentiels ; 5 à 20 domaines ; 30 à 150 compétences |
| `competency_assessments` | Évaluations par compétences | 600 élèves × 3 périodes × 30 compétences ≈ 54 000 lignes par an |
| `competency_revisions` | Corrections tracées | < 1 % des lignes |
| `period_locks` | Verrous de saisie | 15 classes × 3 périodes |
| `appreciation_phrases` | Banque de phrases | 20 à 200 |
| `council_cases`, `council_attendance` | Dossiers et présence du conseil | 600 dossiers par conseil de fin d'année ; 20 présences |
| `council_minutes` | Procès-verbal FIGÉ du conseil (contenu, empreinte, versions) — ajout `1803` | 1 à 3 par conseil |
| `annual_reviews` | Bilans annuels | 600 par an (+ réémissions) |
| `year_archives` | Archives | 1 par an et établissement |
| `settings`, `template_applications` | Paramètres, idempotence | quelques lignes |

## 4. Les décisions de modélisation à connaître

1. **Référentiel versionné, structure figée à la publication.** Les compétences ne se corrigent pas : on publie la version suivante (copie en brouillon). Évite qu'un libellé change sous des centaines d'évaluations validées. Imposé par déclencheurs (`competency_frameworks_guard`, `framework_structure_guard`, `rating_levels_guard`) : testé.
2. **Appréciation validée = correction par révision seulement.** La révision (`competency_revisions`) est insérée **avant** et dans la **même transaction** que la correction ; le déclencheur de l'appréciation exige cette ligne (`xid = txid_current()`, ancien et nouveau niveau identiques). Une révision d'une transaction antérieure ne couvre jamais une nouvelle correction (testé).
3. **Compteurs, jamais de moyenne.** `summarize_competencies(enrollment, periods?)` renvoie `{domaine: {niveau: n}}` pour les lignes validées. L'interprétation (« acquis ») est un affichage ou une règle future, pas une colonne.
4. **Bilan annuel = instantané scellé, versionné.** Scellé, il est immuable (contenu, empreinte, décision) ; seul l'identifiant du PDF se renseigne **une fois**. Une correction crée la version n+1 (`supersedes_id`, motif ≥ 10 caractères) ; une seule version vivante par inscription et par année (index partiel). Le scellement exige un résultat d'année FINAL et, selon le paramètre de l'établissement, la décision du conseil (`council_required_for_bilan`).
5. **Archive gelable.** `READY` exige un manifeste, son empreinte et **tous** les bilans comptés scellés ; `FROZEN` est irréversible et interdit toute écriture de bilan de l'année pour l'établissement (`year_frozen`).
6. **Verrou de période local.** `period_locks` est alimenté par les événements `academic.classroom_period.*` ; l'API contrôle en plus l'état effectif par le port `PeriodStatePort` (échec fermé). Le verrou SQL est une défense en profondeur.
7. **Conseil des maîtres : on ne duplique pas `results`.** Les dossiers et la présence référencent `results.deliberations` / `results.decisions` par UUID ; le quorum n'est **jamais** une contrainte SQL (c'est la règle `quorum_conseil`).

## 5. DDL de référence

### 5.1 Schéma, échelles, référentiels, paramètres

<!-- migration: 1800_primary_school_reference.sql -->
```sql
-- =============================================================================
-- 1800 — Module primary_school : schéma, paramètres, échelles d'appréciation, référentiels de compétences
-- =============================================================================
--
-- Plage de numéros réservée au module primary_school : 1800–1899 (numéros GLOBAUX, voir
-- docs/architecture/module-conventions.md ; ligne à inscrire dans ce tableau).
--
-- Pourquoi `primary_school` et non `primary` : PRIMARY est un mot réservé de SQL (`PRIMARY KEY`) ;
-- un schéma `primary` obligerait à citer l'identifiant partout. La clé de module (manifest) est la
-- même : `primary_school` (route `/api/v1/primary_school`).
--
-- Règles (module-conventions.md, ADR-002/006/007) :
--   - un module = un schéma ; AUCUNE clé étrangère vers le schéma d'un autre module, sauf
--     `kernel.tenants(id)`. Établissement, année, période, classe, inscription, élève, enseignant,
--     délibération : UUID vérifiés par les API publiques de academic / people / results ;
--   - toute table : `tenant_id uuid NOT NULL REFERENCES kernel.tenants(id)`, puis
--     `kernel.enable_tenant_rls()`, puis GRANT explicite à `app_user` ;
--   - clés étrangères internes COMPOSITES (tenant_id, id) ;
--   - AUCUNE règle réglementaire : ce module ne calcule ni moyenne, ni rang, ni passage. Il porte
--     des DONNÉES pédagogiques (compétences, échelles d'appréciation) et des journaux. Toute valeur
--     de ces données porte son origine (`source_kind`) ; `placeholder` = valeur fictive de démonstration.
--
-- Exécutée sous `SET ROLE migrator` par le runner.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS primary_school;
REVOKE ALL ON SCHEMA primary_school FROM PUBLIC;
GRANT USAGE ON SCHEMA primary_school TO app_user;

-- Garde commune : table en ajout seul (journaux).
CREATE FUNCTION primary_school.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'primary_school.append_only: la table % est en ajout seul (% refusé)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;

-- -----------------------------------------------------------------------------
-- Échelles d'appréciation (ex. niveaux de maîtrise). Données de pack ou de l'établissement ; le
-- modèle de pack ne livre qu'une échelle `placeholder` tant que le référentiel officiel n'est pas fourni.
-- -----------------------------------------------------------------------------
CREATE TABLE primary_school.rating_scales (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  code             text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  label            text NOT NULL CHECK (length(btrim(label)) > 0),
  source_kind      text NOT NULL DEFAULT 'institution'
                   CHECK (source_kind IN ('regulation', 'institution', 'platform', 'placeholder')),
  source_reference text,
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  -- un référentiel déclaré « réglementaire » cite son texte
  CHECK (source_kind <> 'regulation' OR length(btrim(coalesce(source_reference, ''))) > 0)
);
SELECT kernel.enable_tenant_rls('primary_school.rating_scales');
GRANT SELECT, INSERT, UPDATE ON primary_school.rating_scales TO app_user;

-- `meets_expectation` : drapeau PÉDAGOGIQUE servant aux synthèses (« compétences atteintes ») ; ce n'est
-- ni un seuil de passage ni une règle : le module ne décide rien avec.
CREATE TABLE primary_school.rating_levels (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  scale_id           uuid NOT NULL,
  code               text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_]{0,39}$'),
  label              text NOT NULL CHECK (length(btrim(label)) > 0),
  ordinal            integer NOT NULL CHECK (ordinal >= 1),
  meets_expectation  boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, scale_id, id),
  UNIQUE (tenant_id, scale_id, code),
  UNIQUE (tenant_id, scale_id, ordinal),
  FOREIGN KEY (tenant_id, scale_id) REFERENCES primary_school.rating_scales (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('primary_school.rating_levels');
GRANT SELECT, INSERT, UPDATE ON primary_school.rating_levels TO app_user;

-- -----------------------------------------------------------------------------
-- Paramètres par établissement (une ligne). Politiques d'établissement, PAS des règles réglementaires.
--   require_homeroom_for_activation : une classe du primaire ne s'active qu'avec un titulaire (HOMEROOM)
--   council_required_for_bilan      : le bilan annuel ne se scelle qu'avec une décision du conseil des maîtres
--   archive_retention_years         : NULL = durée de conservation non déterminée (question métier)
-- -----------------------------------------------------------------------------
CREATE TABLE primary_school.settings (
  tenant_id                       uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id                  uuid NOT NULL,                 -- tenancy.institutions.id (sans FK)
  require_homeroom_for_activation boolean NOT NULL DEFAULT true,
  council_required_for_bilan      boolean NOT NULL DEFAULT true,
  phrase_bank_enabled             boolean NOT NULL DEFAULT true,
  default_rating_scale_id         uuid,
  archive_retention_years         integer CHECK (archive_retention_years IS NULL OR archive_retention_years > 0),
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, institution_id),
  FOREIGN KEY (tenant_id, default_rating_scale_id) REFERENCES primary_school.rating_scales (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('primary_school.settings');
GRANT SELECT, INSERT, UPDATE ON primary_school.settings TO app_user;

-- Versions de modèle de pack appliquées (idempotence de instantiatePrimaryReferenceData).
CREATE TABLE primary_school.template_applications (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id   uuid NOT NULL,
  education_system text NOT NULL,
  template_version integer NOT NULL CHECK (template_version >= 1),
  applied_at       timestamptz NOT NULL DEFAULT now(),
  applied_by       uuid,
  summary          jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, institution_id, education_system, template_version)
);
SELECT kernel.enable_tenant_rls('primary_school.template_applications');
GRANT SELECT, INSERT ON primary_school.template_applications TO app_user;

-- -----------------------------------------------------------------------------
-- Référentiels de compétences. Un référentiel est VERSIONNÉ : une fois publié, sa structure (domaines,
-- compétences) ne change plus ; corriger = nouvelle version (copie). Les niveaux (PS, CP1…) sont
-- désignés par leur CODE (`academic.grade_levels.code`) : pas de FK inter-schémas.
-- -----------------------------------------------------------------------------
CREATE TABLE primary_school.competency_frameworks (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  code             text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  version          integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  label            text NOT NULL CHECK (length(btrim(label)) > 0),
  scale_id         uuid NOT NULL,
  status           text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
  source_kind      text NOT NULL DEFAULT 'institution'
                   CHECK (source_kind IN ('regulation', 'institution', 'platform', 'placeholder')),
  source_reference text,
  published_at     timestamptz,
  published_by     uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code, version),
  CHECK ((status = 'DRAFT') = (published_at IS NULL)),
  CHECK (source_kind <> 'regulation' OR length(btrim(coalesce(source_reference, ''))) > 0),
  FOREIGN KEY (tenant_id, scale_id) REFERENCES primary_school.rating_scales (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('primary_school.competency_frameworks');
-- Une seule version publiée par code de référentiel.
CREATE UNIQUE INDEX competency_frameworks_one_published
  ON primary_school.competency_frameworks (tenant_id, code) WHERE status = 'PUBLISHED';
GRANT SELECT, INSERT, UPDATE, DELETE ON primary_school.competency_frameworks TO app_user;   -- DELETE : brouillon seulement (garde)

CREATE TABLE primary_school.framework_grade_levels (
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  framework_id     uuid NOT NULL,
  grade_level_code text NOT NULL CHECK (grade_level_code ~ '^[A-Z0-9][A-Z0-9_]{0,39}$'),
  PRIMARY KEY (tenant_id, framework_id, grade_level_code),
  FOREIGN KEY (tenant_id, framework_id) REFERENCES primary_school.competency_frameworks (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('primary_school.framework_grade_levels');
GRANT SELECT, INSERT, DELETE ON primary_school.framework_grade_levels TO app_user;

CREATE TABLE primary_school.competency_domains (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants (id),
  framework_id uuid NOT NULL,
  code         text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
  label        text NOT NULL CHECK (length(btrim(label)) > 0),
  ordinal      integer NOT NULL CHECK (ordinal >= 1),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, framework_id, id),
  UNIQUE (tenant_id, framework_id, code),
  UNIQUE (tenant_id, framework_id, ordinal),
  FOREIGN KEY (tenant_id, framework_id) REFERENCES primary_school.competency_frameworks (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('primary_school.competency_domains');
GRANT SELECT, INSERT, UPDATE, DELETE ON primary_school.competency_domains TO app_user;

CREATE TABLE primary_school.competencies (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES kernel.tenants (id),
  framework_id uuid NOT NULL,
  domain_id    uuid NOT NULL,
  code         text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
  label        text NOT NULL CHECK (length(btrim(label)) > 0),
  description  text,
  ordinal      integer NOT NULL CHECK (ordinal >= 1),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, framework_id, id),
  UNIQUE (tenant_id, framework_id, code),
  UNIQUE (tenant_id, domain_id, ordinal),
  FOREIGN KEY (tenant_id, framework_id, domain_id)
    REFERENCES primary_school.competency_domains (tenant_id, framework_id, id)
);
SELECT kernel.enable_tenant_rls('primary_school.competencies');
GRANT SELECT, INSERT, UPDATE, DELETE ON primary_school.competencies TO app_user;

-- Banque d'appréciations : phrases réutilisables proposées à l'instituteur (jamais appliquées seules).
CREATE TABLE primary_school.appreciation_phrases (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  code              text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,59}$'),
  scope             text NOT NULL CHECK (scope IN ('PERIOD', 'YEAR', 'COMPETENCY')),
  body              text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 300),
  rating_level_code text,
  grade_level_code  text,
  source_kind       text NOT NULL DEFAULT 'institution'
                    CHECK (source_kind IN ('regulation', 'institution', 'platform', 'placeholder')),
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
SELECT kernel.enable_tenant_rls('primary_school.appreciation_phrases');
GRANT SELECT, INSERT, UPDATE ON primary_school.appreciation_phrases TO app_user;

-- =============================================================================
-- Gardes
-- =============================================================================

-- Cycle de vie d'un référentiel : DRAFT -> PUBLISHED -> RETIRED. À la publication : au moins une
-- compétence, un niveau d'application, et une échelle d'au moins deux niveaux. Identité figée ensuite.
CREATE FUNCTION primary_school.competency_frameworks_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_n integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'primary_school.framework_delete_forbidden: le référentiel % v% est % ; il ne peut plus être supprimé', OLD.code, OLD.version, OLD.status
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.code <> OLD.code OR NEW.version <> OLD.version THEN
      RAISE EXCEPTION 'primary_school.framework_identity_immutable: code et version sont figés' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status <> 'DRAFT' AND (NEW.scale_id <> OLD.scale_id OR NEW.label <> OLD.label
        OR NEW.source_kind <> OLD.source_kind OR NEW.source_reference IS DISTINCT FROM OLD.source_reference) THEN
      RAISE EXCEPTION 'primary_school.framework_published_immutable: un référentiel publié ne se modifie pas (créer une nouvelle version)'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
         (OLD.status = 'DRAFT' AND NEW.status = 'PUBLISHED') OR
         (OLD.status = 'PUBLISHED' AND NEW.status = 'RETIRED')) THEN
      RAISE EXCEPTION 'primary_school.framework_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status = 'PUBLISHED' AND OLD.status = 'DRAFT' THEN
      SELECT count(*) INTO v_n FROM primary_school.competencies c
       WHERE c.tenant_id = NEW.tenant_id AND c.framework_id = NEW.id;
      IF v_n = 0 THEN
        RAISE EXCEPTION 'primary_school.framework_empty: un référentiel sans compétence ne se publie pas' USING ERRCODE = 'check_violation';
      END IF;
      SELECT count(*) INTO v_n FROM primary_school.framework_grade_levels g
       WHERE g.tenant_id = NEW.tenant_id AND g.framework_id = NEW.id;
      IF v_n = 0 THEN
        RAISE EXCEPTION 'primary_school.framework_no_level: indiquer au moins un niveau d''application' USING ERRCODE = 'check_violation';
      END IF;
      SELECT count(*) INTO v_n FROM primary_school.rating_levels l
       WHERE l.tenant_id = NEW.tenant_id AND l.scale_id = NEW.scale_id;
      IF v_n < 2 THEN
        RAISE EXCEPTION 'primary_school.scale_too_small: l''échelle doit compter au moins deux niveaux' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER competency_frameworks_guard BEFORE UPDATE OR DELETE ON primary_school.competency_frameworks
  FOR EACH ROW EXECUTE FUNCTION primary_school.competency_frameworks_guard();

-- Structure d'un référentiel (domaines, compétences, niveaux d'application) : brouillon seulement.
CREATE FUNCTION primary_school.framework_structure_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
  v_tenant uuid;
  v_fw     uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_tenant := OLD.tenant_id; v_fw := OLD.framework_id;
  ELSE
    v_tenant := NEW.tenant_id; v_fw := NEW.framework_id;
  END IF;
  SELECT status INTO v_status FROM primary_school.competency_frameworks f WHERE f.tenant_id = v_tenant AND f.id = v_fw;
  IF v_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'primary_school.framework_published_immutable: la structure d''un référentiel % est figée (créer une nouvelle version)', coalesce(v_status, 'inconnu')
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
CREATE TRIGGER competency_domains_guard BEFORE INSERT OR UPDATE OR DELETE ON primary_school.competency_domains
  FOR EACH ROW EXECUTE FUNCTION primary_school.framework_structure_guard();
CREATE TRIGGER competencies_guard BEFORE INSERT OR UPDATE OR DELETE ON primary_school.competencies
  FOR EACH ROW EXECUTE FUNCTION primary_school.framework_structure_guard();
CREATE TRIGGER framework_grade_levels_guard BEFORE INSERT OR UPDATE OR DELETE ON primary_school.framework_grade_levels
  FOR EACH ROW EXECUTE FUNCTION primary_school.framework_structure_guard();

-- Niveaux d'une échelle : modifiables tant qu'aucun référentiel PUBLIÉ ne l'emploie (une échelle publiée est figée).
CREATE FUNCTION primary_school.rating_levels_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_tenant uuid;
  v_scale  uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN v_tenant := OLD.tenant_id; v_scale := OLD.scale_id;
  ELSE v_tenant := NEW.tenant_id; v_scale := NEW.scale_id; END IF;
  IF EXISTS (SELECT 1 FROM primary_school.competency_frameworks f
              WHERE f.tenant_id = v_tenant AND f.scale_id = v_scale AND f.status IN ('PUBLISHED', 'RETIRED')) THEN
    RAISE EXCEPTION 'primary_school.scale_in_use: l''échelle est employée par un référentiel publié ; créer une nouvelle échelle'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
CREATE TRIGGER rating_levels_guard BEFORE INSERT OR UPDATE OR DELETE ON primary_school.rating_levels
  FOR EACH ROW EXECUTE FUNCTION primary_school.rating_levels_guard();
GRANT DELETE ON primary_school.rating_levels TO app_user;   -- garde ci-dessus
```

### 5.2 Évaluation par compétences

<!-- migration: 1801_primary_school_competency_assessments.sql -->
```sql
-- =============================================================================
-- 1801 — Module primary_school : évaluation par compétences (maternelle et primaire)
-- =============================================================================
--
-- `assess` ne porte que des notes chiffrées (score ≤ barème). L'évaluation par compétences — niveau
-- de maîtrise d'une compétence, observation de l'instituteur — est un autre objet : elle est portée
-- ici. Elle ne produit AUCUNE moyenne : `competency_summary` se contente de COMPTER des niveaux par
-- domaine ; toute interprétation chiffrée serait une règle (RuleSet), donc hors de ce module.
--
-- Cycle d'une appréciation : DRAFT -> VALIDATED (par l'instituteur ou la direction). Une appréciation
-- VALIDÉE ne se corrige que par une RÉVISION tracée (`competency_revisions`, motif ≥ 10 caractères) ;
-- aucune écriture n'est possible dans une classe × période verrouillée (`period_locks`, alimentée par
-- les événements `academic.classroom_period.*`).
-- =============================================================================

-- Verrou de saisie par classe × période : miroir local de l'état effectif de la période (academic).
CREATE TABLE primary_school.period_locks (
  tenant_id          uuid NOT NULL REFERENCES kernel.tenants (id),
  classroom_id       uuid NOT NULL,
  academic_period_id uuid NOT NULL,
  status             text NOT NULL CHECK (status IN ('LOCKED', 'OPEN')),
  changed_at         timestamptz NOT NULL DEFAULT now(),
  source_event_id    uuid,
  PRIMARY KEY (tenant_id, classroom_id, academic_period_id)
);
SELECT kernel.enable_tenant_rls('primary_school.period_locks');
GRANT SELECT, INSERT, UPDATE ON primary_school.period_locks TO app_user;

CREATE TABLE primary_school.competency_assessments (
  id                     uuid PRIMARY KEY,
  tenant_id              uuid NOT NULL REFERENCES kernel.tenants (id),
  classroom_id           uuid NOT NULL,                 -- academic.classrooms.id (sans FK)
  academic_period_id     uuid NOT NULL,                 -- academic.academic_periods.id (sans FK)
  enrollment_id          uuid NOT NULL,                 -- academic.enrollments.id (sans FK)
  student_id             uuid NOT NULL,                 -- people.students.id (sans FK)
  framework_id           uuid NOT NULL,
  competency_id          uuid NOT NULL,
  scale_id               uuid NOT NULL,                 -- redondant : impose « le niveau appartient à l'échelle du référentiel »
  rating_level_id        uuid NOT NULL,
  observed_on            date NOT NULL,
  recorded_by_staff_id   uuid NOT NULL,                 -- people.staff.id (sans FK)
  note                   text CHECK (note IS NULL OR length(note) <= 500),
  status                 text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'VALIDATED')),
  validated_by           uuid,
  validated_at           timestamptz,
  row_version            integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, enrollment_id, academic_period_id, competency_id),
  CHECK ((status = 'VALIDATED') = (validated_at IS NOT NULL AND validated_by IS NOT NULL)),
  FOREIGN KEY (tenant_id, framework_id, competency_id)
    REFERENCES primary_school.competencies (tenant_id, framework_id, id),
  FOREIGN KEY (tenant_id, scale_id, rating_level_id)
    REFERENCES primary_school.rating_levels (tenant_id, scale_id, id)
);
SELECT kernel.enable_tenant_rls('primary_school.competency_assessments');
CREATE INDEX competency_assessments_by_class_period
  ON primary_school.competency_assessments (tenant_id, classroom_id, academic_period_id, status);
CREATE INDEX competency_assessments_by_enrollment
  ON primary_school.competency_assessments (tenant_id, enrollment_id, academic_period_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON primary_school.competency_assessments TO app_user;   -- DELETE : brouillon seulement (garde)

-- Révisions d'une appréciation validée : append-only. `xid` lie la révision à la transaction qui
-- applique la correction : un UPDATE d'une appréciation validée n'est accepté que si la révision
-- correspondante a été insérée dans la MÊME transaction (la trace précède toujours la correction).
CREATE TABLE primary_school.competency_revisions (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES kernel.tenants (id),
  assessment_id  uuid NOT NULL,
  from_level_id  uuid NOT NULL,
  to_level_id    uuid NOT NULL,
  reason         text NOT NULL CHECK (length(btrim(reason)) >= 10),
  requested_by   uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  xid            bigint NOT NULL DEFAULT txid_current(),
  UNIQUE (tenant_id, id),
  CHECK (from_level_id <> to_level_id),
  FOREIGN KEY (tenant_id, assessment_id) REFERENCES primary_school.competency_assessments (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('primary_school.competency_revisions');
CREATE INDEX competency_revisions_by_assessment ON primary_school.competency_revisions (tenant_id, assessment_id, created_at);
GRANT SELECT, INSERT ON primary_school.competency_revisions TO app_user;
CREATE TRIGGER competency_revisions_append_only BEFORE UPDATE OR DELETE ON primary_school.competency_revisions
  FOR EACH ROW EXECUTE FUNCTION primary_school.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Garde des appréciations
-- -----------------------------------------------------------------------------
CREATE FUNCTION primary_school.competency_assessments_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_fw     primary_school.competency_frameworks%ROWTYPE;
  v_locked boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'primary_school.assessment_delete_forbidden: une appréciation validée ne se supprime pas (réviser)'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  SELECT * INTO v_fw FROM primary_school.competency_frameworks f
   WHERE f.tenant_id = NEW.tenant_id AND f.id = NEW.framework_id;
  IF v_fw.status IS DISTINCT FROM 'PUBLISHED' THEN
    RAISE EXCEPTION 'primary_school.framework_not_published: seul un référentiel publié s''évalue (état : %)', coalesce(v_fw.status, 'inconnu')
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.scale_id <> v_fw.scale_id THEN
    RAISE EXCEPTION 'primary_school.scale_mismatch: le niveau n''appartient pas à l''échelle du référentiel'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT EXISTS (SELECT 1 FROM primary_school.period_locks l
                  WHERE l.tenant_id = NEW.tenant_id AND l.classroom_id = NEW.classroom_id
                    AND l.academic_period_id = NEW.academic_period_id AND l.status = 'LOCKED')
    INTO v_locked;
  IF v_locked THEN
    RAISE EXCEPTION 'primary_school.period_locked: la saisie est arrêtée pour cette classe et cette période'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.classroom_id <> OLD.classroom_id OR NEW.academic_period_id <> OLD.academic_period_id
       OR NEW.enrollment_id <> OLD.enrollment_id OR NEW.student_id <> OLD.student_id
       OR NEW.framework_id <> OLD.framework_id OR NEW.competency_id <> OLD.competency_id THEN
      RAISE EXCEPTION 'primary_school.assessment_identity_immutable: élève, classe, période et compétence sont figés'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status = 'VALIDATED' AND NEW.status <> 'VALIDATED' THEN
      RAISE EXCEPTION 'primary_school.assessment_transition: VALIDATED -> % interdit (réviser)', NEW.status
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status = 'VALIDATED'
       AND (NEW.rating_level_id <> OLD.rating_level_id OR NEW.note IS DISTINCT FROM OLD.note OR NEW.observed_on <> OLD.observed_on) THEN
      -- la correction exige une révision insérée dans cette même transaction, pour ce changement précis
      IF NOT EXISTS (SELECT 1 FROM primary_school.competency_revisions r
                      WHERE r.tenant_id = OLD.tenant_id AND r.assessment_id = OLD.id
                        AND r.from_level_id = OLD.rating_level_id AND r.to_level_id = NEW.rating_level_id
                        AND r.xid = txid_current()) THEN
        RAISE EXCEPTION 'primary_school.validated_frozen: une appréciation validée ne se corrige que par une révision motivée'
          USING ERRCODE = 'restrict_violation';
      END IF;
    END IF;
    NEW.row_version := OLD.row_version + 1;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER competency_assessments_guard BEFORE INSERT OR UPDATE OR DELETE ON primary_school.competency_assessments
  FOR EACH ROW EXECUTE FUNCTION primary_school.competency_assessments_guard();

-- -----------------------------------------------------------------------------
-- Synthèse : COMPTE les niveaux VALIDÉS par domaine pour une inscription (et, au choix, un jeu de
-- périodes). Aucune moyenne, aucun seuil : { "<domaine>": { "<niveau>": n } }. Lue sous la RLS de l'appelant.
-- -----------------------------------------------------------------------------
CREATE FUNCTION primary_school.summarize_competencies(p_enrollment uuid, p_periods uuid[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH counts AS (
    SELECT d.code AS domain_code, l.code AS level_code, count(*)::int AS n
      FROM primary_school.competency_assessments a
      JOIN primary_school.competencies c ON c.tenant_id = a.tenant_id AND c.id = a.competency_id
      JOIN primary_school.competency_domains d ON d.tenant_id = c.tenant_id AND d.id = c.domain_id
      JOIN primary_school.rating_levels l ON l.tenant_id = a.tenant_id AND l.id = a.rating_level_id
     WHERE a.tenant_id = kernel.current_tenant_id()
       AND a.enrollment_id = p_enrollment
       AND a.status = 'VALIDATED'
       AND (p_periods IS NULL OR a.academic_period_id = ANY (p_periods))
     GROUP BY d.code, l.code
  )
  SELECT coalesce(jsonb_object_agg(domain_code, per_level), '{}'::jsonb)
    FROM (SELECT domain_code, jsonb_object_agg(level_code, n) AS per_level FROM counts GROUP BY domain_code) x
$$;
GRANT EXECUTE ON FUNCTION primary_school.summarize_competencies(uuid, uuid[]) TO app_user;
```

### 5.3 Conseil des maîtres, bilan annuel, archivage

<!-- migration: 1802_primary_school_council_bilan.sql -->
```sql
-- =============================================================================
-- 1802 — Module primary_school : conseil des maîtres, bilan annuel, archivage des années
-- =============================================================================
--
-- Le conseil des maîtres RÉUTILISE `results.deliberations` (kind = COUNCIL) et `results.decisions` :
-- la proposition vient d'une règle, la décision finale est confirmée en séance (spec 011). Ce module
-- n'ajoute que ce qui est propre au primaire : le DOSSIER de séance par élève (cas à examiner,
-- proposition de l'instituteur, notes de discussion) et la feuille de présence des maîtres.
--
-- Le bilan annuel est un instantané : il RASSEMBLE des résultats déjà calculés (results), la synthèse
-- des compétences (compteurs), l'assiduité et la décision du conseil ; il ne calcule rien. Scellé,
-- il est immuable ; une correction crée la version n+1 (même patron que `reportcards`).
-- =============================================================================

CREATE TABLE primary_school.council_cases (
  id                    uuid PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES kernel.tenants (id),
  deliberation_id       uuid NOT NULL,                  -- results.deliberations.id (sans FK)
  classroom_id          uuid NOT NULL,
  enrollment_id         uuid NOT NULL,
  student_id            uuid NOT NULL,
  -- pourquoi le dossier est examiné (codes issus d'une règle `cas_a_examiner` ou posés à la main)
  reason_codes          text[] NOT NULL DEFAULT '{}',
  proposal_code         text CHECK (proposal_code IS NULL OR proposal_code ~ '^[A-Z][A-Z0-9_]{1,40}$'),   -- code d'issue (academic.enrollment_outcomes)
  proposal_note         text CHECK (proposal_note IS NULL OR length(proposal_note) <= 1000),
  discussion_note       text CHECK (discussion_note IS NULL OR length(discussion_note) <= 2000),
  proposed_by_staff_id  uuid,
  status                text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'DECIDED', 'DEFERRED')),
  decision_ref          uuid,                           -- results.decisions.id (sans FK)
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, deliberation_id, enrollment_id),
  CHECK (status <> 'DECIDED' OR decision_ref IS NOT NULL)
);
SELECT kernel.enable_tenant_rls('primary_school.council_cases');
CREATE INDEX council_cases_by_enrollment ON primary_school.council_cases (tenant_id, enrollment_id);
GRANT SELECT, INSERT, UPDATE ON primary_school.council_cases TO app_user;

-- Feuille de présence du conseil. Le quorum est une RÈGLE (contrat coef-period@1, clé `quorum_conseil`),
-- jamais une constante : ce module ne fait que compter convoqués et présents.
CREATE TABLE primary_school.council_attendance (
  tenant_id        uuid NOT NULL REFERENCES kernel.tenants (id),
  deliberation_id  uuid NOT NULL,
  staff_id         uuid NOT NULL,                       -- people.staff.id (sans FK)
  role_code        text NOT NULL CHECK (role_code IN ('CHAIR', 'HOMEROOM', 'TEACHER', 'SPECIALIST', 'DIRECTOR', 'SECRETARY', 'OTHER')),
  convened         boolean NOT NULL DEFAULT true,
  present          boolean,
  signed_at        timestamptz,
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, deliberation_id, staff_id),
  CHECK (signed_at IS NULL OR present IS TRUE)
);
SELECT kernel.enable_tenant_rls('primary_school.council_attendance');
CREATE UNIQUE INDEX council_attendance_one_chair
  ON primary_school.council_attendance (tenant_id, deliberation_id) WHERE role_code = 'CHAIR';
CREATE UNIQUE INDEX council_attendance_one_secretary
  ON primary_school.council_attendance (tenant_id, deliberation_id) WHERE role_code = 'SECRETARY';
GRANT SELECT, INSERT, UPDATE, DELETE ON primary_school.council_attendance TO app_user;

-- Après signature du procès-verbal, la feuille de présence est figée (déclencheur).
CREATE FUNCTION primary_school.council_attendance_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.signed_at IS NOT NULL THEN
      RAISE EXCEPTION 'primary_school.attendance_signed: une présence signée ne se supprime pas' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.signed_at IS NOT NULL
     AND (NEW.signed_at IS DISTINCT FROM OLD.signed_at OR NEW.present IS DISTINCT FROM OLD.present
          OR NEW.role_code <> OLD.role_code OR NEW.staff_id <> OLD.staff_id) THEN
    RAISE EXCEPTION 'primary_school.attendance_signed: une présence signée ne se modifie plus' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER council_attendance_guard BEFORE UPDATE OR DELETE ON primary_school.council_attendance
  FOR EACH ROW EXECUTE FUNCTION primary_school.council_attendance_guard();

-- -----------------------------------------------------------------------------
-- Bilan annuel (instantané par inscription et par année)
--   DRAFT -> READY -> SEALED -> SUPERSEDED (par la version n+1)
-- -----------------------------------------------------------------------------
CREATE TABLE primary_school.annual_reviews (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id      uuid NOT NULL,
  academic_year_id    uuid NOT NULL,
  enrollment_id       uuid NOT NULL,
  student_id          uuid NOT NULL,
  classroom_id        uuid NOT NULL,
  grade_level_code    text NOT NULL CHECK (grade_level_code ~ '^[A-Z0-9][A-Z0-9_]{0,39}$'),
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  status              text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'READY', 'SEALED', 'SUPERSEDED')),
  year_result_ref     uuid,                              -- results.period_results.id (résultat d'année FINAL)
  decision_ref        uuid,                              -- results.decisions.id (décision confirmée)
  outcome_code        text CHECK (outcome_code IS NULL OR outcome_code ~ '^[A-Z][A-Z0-9_]{1,40}$'),
  competency_summary  jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(competency_summary) = 'object'),
  attendance_summary  jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attendance_summary) = 'object'),
  rule_version_ref    uuid,                              -- version de règle épinglée par results
  content_hash        text CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'),
  sealed_at           timestamptz,
  sealed_by           uuid,
  reportcard_id       uuid,                              -- reportcards.report_cards.id une fois le PDF émis
  supersedes_id       uuid,
  supersede_reason    text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, enrollment_id, academic_year_id, version),
  CHECK (status NOT IN ('SEALED', 'SUPERSEDED') OR (content_hash IS NOT NULL AND sealed_at IS NOT NULL AND sealed_by IS NOT NULL)),
  CHECK (supersedes_id IS NULL OR (version > 1 AND length(btrim(coalesce(supersede_reason, ''))) >= 10)),
  FOREIGN KEY (tenant_id, supersedes_id) REFERENCES primary_school.annual_reviews (tenant_id, id)
);
SELECT kernel.enable_tenant_rls('primary_school.annual_reviews');
-- Une seule version vivante par inscription et par année.
CREATE UNIQUE INDEX annual_reviews_one_live
  ON primary_school.annual_reviews (tenant_id, enrollment_id, academic_year_id) WHERE status <> 'SUPERSEDED';
CREATE INDEX annual_reviews_by_class ON primary_school.annual_reviews (tenant_id, classroom_id, status);
CREATE INDEX annual_reviews_by_year ON primary_school.annual_reviews (tenant_id, academic_year_id, institution_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON primary_school.annual_reviews TO app_user;   -- DELETE : brouillon seulement (garde)

-- Archivage d'une année (par établissement) : PREPARING -> READY -> FROZEN. READY exige un manifeste
-- et un bilan scellé pour CHAQUE inscription comptée ; FROZEN est irréversible.
CREATE TABLE primary_school.year_archives (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES kernel.tenants (id),
  institution_id    uuid NOT NULL,
  academic_year_id  uuid NOT NULL,
  status            text NOT NULL DEFAULT 'PREPARING' CHECK (status IN ('PREPARING', 'READY', 'FROZEN')),
  reviews_total     integer NOT NULL DEFAULT 0 CHECK (reviews_total >= 0),
  reviews_sealed    integer NOT NULL DEFAULT 0 CHECK (reviews_sealed >= 0),
  manifest          jsonb CHECK (manifest IS NULL OR jsonb_typeof(manifest) = 'object'),
  manifest_hash     text CHECK (manifest_hash IS NULL OR manifest_hash ~ '^[0-9a-f]{64}$'),
  storage_key       text,
  prepared_by       uuid,
  prepared_at       timestamptz,
  frozen_at         timestamptz,
  frozen_by         uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, institution_id, academic_year_id),
  CHECK (reviews_sealed <= reviews_total),
  CHECK (status = 'PREPARING' OR (manifest IS NOT NULL AND manifest_hash IS NOT NULL AND reviews_sealed = reviews_total)),
  CHECK ((status = 'FROZEN') = (frozen_at IS NOT NULL))
);
SELECT kernel.enable_tenant_rls('primary_school.year_archives');
GRANT SELECT, INSERT, UPDATE ON primary_school.year_archives TO app_user;

-- -----------------------------------------------------------------------------
-- Gardes : bilan annuel
-- -----------------------------------------------------------------------------
CREATE FUNCTION primary_school.annual_reviews_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_council_required boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'primary_school.review_delete_forbidden: un bilan % ne se supprime pas', OLD.status USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  -- Année figée par l'archivage : plus aucune écriture.
  IF EXISTS (SELECT 1 FROM primary_school.year_archives a
              WHERE a.tenant_id = NEW.tenant_id AND a.institution_id = NEW.institution_id
                AND a.academic_year_id = NEW.academic_year_id AND a.status = 'FROZEN') THEN
    RAISE EXCEPTION 'primary_school.year_frozen: l''année est archivée, plus aucun bilan ne peut être écrit' USING ERRCODE = 'restrict_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.enrollment_id <> OLD.enrollment_id OR NEW.academic_year_id <> OLD.academic_year_id
       OR NEW.student_id <> OLD.student_id OR NEW.institution_id <> OLD.institution_id OR NEW.version <> OLD.version THEN
      RAISE EXCEPTION 'primary_school.review_identity_immutable: inscription, année et version sont figées' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status IN ('SEALED', 'SUPERSEDED') THEN
      -- seuls permis : SEALED -> SUPERSEDED, et le renseignement UNIQUE de l'identifiant du PDF
      IF NEW.status = OLD.status
         AND NEW.reportcard_id IS DISTINCT FROM OLD.reportcard_id AND OLD.reportcard_id IS NULL
         AND ROW(NEW.competency_summary, NEW.attendance_summary, NEW.content_hash, NEW.outcome_code, NEW.decision_ref,
                 NEW.year_result_ref, NEW.sealed_at, NEW.classroom_id, NEW.grade_level_code)
             IS NOT DISTINCT FROM
             ROW(OLD.competency_summary, OLD.attendance_summary, OLD.content_hash, OLD.outcome_code, OLD.decision_ref,
                 OLD.year_result_ref, OLD.sealed_at, OLD.classroom_id, OLD.grade_level_code) THEN
        NEW.updated_at := now();
        RETURN NEW;
      END IF;
      IF OLD.status = 'SEALED' AND NEW.status = 'SUPERSEDED'
         AND ROW(NEW.competency_summary, NEW.attendance_summary, NEW.content_hash, NEW.outcome_code, NEW.decision_ref,
                 NEW.year_result_ref, NEW.sealed_at, NEW.reportcard_id)
             IS NOT DISTINCT FROM
             ROW(OLD.competency_summary, OLD.attendance_summary, OLD.content_hash, OLD.outcome_code, OLD.decision_ref,
                 OLD.year_result_ref, OLD.sealed_at, OLD.reportcard_id) THEN
        NEW.updated_at := now();
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'primary_school.review_sealed: un bilan scellé est immuable (créer la version suivante)' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
         (OLD.status = 'DRAFT' AND NEW.status IN ('READY', 'SEALED')) OR
         (OLD.status = 'READY' AND NEW.status IN ('DRAFT', 'SEALED'))) THEN
      RAISE EXCEPTION 'primary_school.review_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  IF NEW.status = 'SEALED' AND (TG_OP = 'INSERT' OR OLD.status <> 'SEALED') THEN
    SELECT coalesce((SELECT s.council_required_for_bilan FROM primary_school.settings s
                      WHERE s.tenant_id = NEW.tenant_id AND s.institution_id = NEW.institution_id), true)
      INTO v_council_required;
    IF v_council_required AND (NEW.decision_ref IS NULL OR NEW.outcome_code IS NULL) THEN
      RAISE EXCEPTION 'primary_school.review_needs_decision: le bilan ne se scelle qu''avec la décision du conseil des maîtres' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.year_result_ref IS NULL THEN
      RAISE EXCEPTION 'primary_school.review_needs_results: le bilan ne se scelle qu''avec un résultat d''année FINAL' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.supersedes_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM primary_school.annual_reviews p
                    WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.supersedes_id
                      AND p.enrollment_id = NEW.enrollment_id AND p.academic_year_id = NEW.academic_year_id
                      AND p.version = NEW.version - 1) THEN
      RAISE EXCEPTION 'primary_school.review_supersedes_mismatch: la version remplacée doit être n-1 de la même inscription et année' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN NEW.updated_at := now(); END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER annual_reviews_guard BEFORE INSERT OR UPDATE OR DELETE ON primary_school.annual_reviews
  FOR EACH ROW EXECUTE FUNCTION primary_school.annual_reviews_guard();

-- -----------------------------------------------------------------------------
-- Gardes : archives d'année
-- -----------------------------------------------------------------------------
CREATE FUNCTION primary_school.year_archives_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.institution_id <> OLD.institution_id OR NEW.academic_year_id <> OLD.academic_year_id THEN
      RAISE EXCEPTION 'primary_school.archive_identity_immutable' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status = 'FROZEN' THEN
      RAISE EXCEPTION 'primary_school.archive_frozen: une année archivée est figée' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
         (OLD.status = 'PREPARING' AND NEW.status = 'READY') OR
         (OLD.status = 'READY' AND NEW.status IN ('PREPARING', 'FROZEN'))) THEN
      RAISE EXCEPTION 'primary_school.archive_transition: % -> % interdit', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER year_archives_guard BEFORE UPDATE ON primary_school.year_archives
  FOR EACH ROW EXECUTE FUNCTION primary_school.year_archives_guard();

-- Pas de suppression d'une archive.
CREATE TRIGGER year_archives_no_delete BEFORE DELETE ON primary_school.year_archives
  FOR EACH ROW EXECUTE FUNCTION primary_school.forbid_mutation();
```

### 5.4 Période du conseil et procès-verbal figé (ajout de l'implémentation)

<!-- migration: 1803_primary_school_council_minutes.sql -->
```sql
-- =============================================================================
-- 1803 — Module primary_school : période du conseil des maîtres et procès-verbal FIGÉ
-- =============================================================================
--
-- Additif à 1802 (ajouté à l'implémentation, spec 005 §7) :
--   - `council_cases.academic_period_id` : la délibération de `results` est portée par une classe × période ; le dossier
--     retient la période pour que la liste et la lecture d'un conseil ne demandent pas au module `results` de la retrouver.
--     Colonne NULLABLE (les lignes antérieures à cette migration n'ont pas de période).
--   - `council_minutes` : le contenu FIGÉ du procès-verbal (date réelle de séance, participants, décisions, justifications) et
--     son empreinte. Le document est rendu par `reportcards` depuis ce contenu, jamais depuis les tables vivantes. Ajout seul :
--     seul l'identifiant du document émis se renseigne, UNE fois ; un nouveau contenu est la version n+1.
-- =============================================================================

ALTER TABLE primary_school.council_cases ADD COLUMN academic_period_id uuid;      -- academic.academic_periods.id (sans FK)
CREATE INDEX council_cases_by_class_period ON primary_school.council_cases (tenant_id, classroom_id, academic_period_id);

CREATE TABLE primary_school.council_minutes (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES kernel.tenants (id),
  deliberation_id     uuid NOT NULL,                  -- results.deliberations.id (sans FK)
  classroom_id        uuid NOT NULL,
  academic_period_id  uuid,
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  content             jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  content_hash        text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  rule_source_kind    text CHECK (rule_source_kind IS NULL OR rule_source_kind IN ('regulation', 'institution', 'platform', 'placeholder')),
  document_id         uuid,                           -- reportcards : document officiel émis (renseigné une fois)
  requested_by        uuid NOT NULL,
  requested_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, deliberation_id, version),
  UNIQUE (tenant_id, deliberation_id, content_hash)
);
SELECT kernel.enable_tenant_rls('primary_school.council_minutes');
CREATE INDEX council_minutes_by_deliberation ON primary_school.council_minutes (tenant_id, deliberation_id, version DESC);
GRANT SELECT, INSERT, UPDATE ON primary_school.council_minutes TO app_user;

CREATE FUNCTION primary_school.council_minutes_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'primary_school.append_only: les procès-verbaux ne se suppriment pas' USING ERRCODE = 'restrict_violation';
  END IF;
  -- seul permis : renseigner UNE fois l'identifiant du document émis
  IF OLD.document_id IS NULL
     AND NEW.document_id IS NOT NULL
     AND ROW(NEW.deliberation_id, NEW.classroom_id, NEW.academic_period_id, NEW.version, NEW.content, NEW.content_hash, NEW.rule_source_kind, NEW.requested_by, NEW.requested_at)
         IS NOT DISTINCT FROM
         ROW(OLD.deliberation_id, OLD.classroom_id, OLD.academic_period_id, OLD.version, OLD.content, OLD.content_hash, OLD.rule_source_kind, OLD.requested_by, OLD.requested_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'primary_school.append_only: un procès-verbal est figé (nouvelle version pour un nouveau contenu)' USING ERRCODE = 'restrict_violation';
END
$$;
CREATE TRIGGER council_minutes_guard BEFORE UPDATE OR DELETE ON primary_school.council_minutes
  FOR EACH ROW EXECUTE FUNCTION primary_school.council_minutes_guard();
```

## 6. Invariants : qui les garantit

| Invariant | Base (DDL) | Domaine / cas d'usage |
|---|---|---|
| Un référentiel publié a ≥ 1 compétence, ≥ 1 niveau d'application, échelle ≥ 2 niveaux ; il est immuable ensuite | `competency_frameworks_guard`, `framework_structure_guard`, `rating_levels_guard` | `publishFramework` renvoie la liste des manques avant d'écrire |
| Une seule version publiée par code de référentiel | index unique partiel `competency_frameworks_one_published` | `newFrameworkVersion` copie en brouillon, `publish` retire l'ancienne (`RETIRED`) |
| Une appréciation vise un référentiel publié, un niveau de **son** échelle, une compétence de **son** référentiel | FK composites `(framework, compétence)` et `(échelle, niveau)` + `competency_assessments_guard` | grille générée côté API : l'interface ne propose que des combinaisons valides |
| Pas d'écriture dans une classe × période verrouillée | `competency_assessments_guard` + `period_locks` | `PeriodStatePort` (échec fermé) |
| Appréciation validée figée ; correction = révision tracée dans la même transaction | `competency_assessments_guard`, `competency_revisions` (append-only) | `reviseCompetencyAssessment` (permission sensible, motif ≥ 10 caractères) |
| Une appréciation par (inscription, période, compétence) | `UNIQUE` | saisie en lot idempotente (`Idempotency-Key`, `rowVersion`) |
| Un président et un secrétaire au plus par conseil ; on ne signe pas absent ; présence signée figée | index uniques partiels, `CHECK`, `council_attendance_guard` | `recordCouncilAttendance` |
| Dossier décidé ⇒ décision référencée | `CHECK` | `confirmCouncilDecision` (appelle `results.confirmDecision`) |
| Bilan : scellé immuable ; une version vivante ; sceller exige résultat d'année FINAL (+ décision selon paramètre) | `annual_reviews_guard`, index `annual_reviews_one_live` | `sealAnnualReview` calcule l'empreinte canonique côté application |
| Année archivée : plus de bilan écrit ; archive non supprimable | `annual_reviews_guard` (`year_frozen`), `year_archives_guard`, `year_archives_no_delete` | `freezeYearArchive` (sensible) |
| Isolation tenant | RLS forcée (`tenant_isolation`) sur toutes les tables, FK composites | test d'isolation générique (A/B) |

## 7. Tests de comportement livrés (`ddl/tests`)

| Fichier | Tests | Couvre |
|---|---|---|
| `10_reference.sql` | 29 | origine des données, FK composites inter-tenants, publication (manques), immuabilité (structure, échelle, identité), une version publiée, RLS et `GRANT` |
| `20_competency_assessments.sql` | 34 | échelle et référentiel cohérents, unicité, validation, gel, révisions (même transaction seulement, ajout seul), verrou de période, brouillon supprimable, synthèse par compteurs, RLS |
| `30_council_bilan.sql` | 41 | dossier de conseil, présence (président, secrétaire, signature), bilan (conditions de scellement, immuabilité, version n+1, réglage de l'établissement), archive (READY, FROZEN, année gelée), RLS et `GRANT` |
| `40_council_minutes.sql` | 14 | période du dossier, procès-verbal figé (unicité de version et d'empreinte, contenu et empreinte immuables, document émis renseigné une fois, suppression refusée), RLS et `GRANT` |

Exécution : `node specs/v2/005-primary/ddl/run.mjs` (Docker requis ; conteneur éphémère supprimé en fin d'essai ; `ED_PG_IMAGE=postgres:17-alpine`). Contrôle documentaire : `node ddl/run.mjs --check-doc`.

## 8. Chemins d'accès et index

| Besoin | Requête | Index |
|---|---|---|
| Grille d'une classe pour une période | `WHERE classroom_id = $1 AND academic_period_id = $2` | `competency_assessments_by_class_period` |
| Compétences d'un élève | `WHERE enrollment_id = $1 [AND academic_period_id = ANY($2)]` | `competency_assessments_by_enrollment` |
| Référentiel publié d'un niveau | `framework_grade_levels` ⨝ `competency_frameworks WHERE status = 'PUBLISHED'` | PK de `framework_grade_levels`, `competency_frameworks_one_published` |
| Historique d'une appréciation | `WHERE assessment_id = $1 ORDER BY created_at` | `competency_revisions_by_assessment` |
| Dossiers d'un élève | `WHERE enrollment_id = $1` | `council_cases_by_enrollment` |
| Bilans d'une classe / d'une année | `WHERE classroom_id = $1` ; `WHERE academic_year_id = $1` | `annual_reviews_by_class`, `annual_reviews_by_year` |

## 9. Projections et lectures croisées

Le module ne lit aucune table d'un autre schéma. Ses lectures croisées passent par des **ports** : `AcademicQuery` (classe, période, état effectif, inscriptions actives, niveau suivant), `PeopleQuery` (noms, titulaires, tuteurs), `ResultsQuery` (résultat d'année FINAL, décisions, délibération), `AttendanceQuery` (récapitulatifs), `ReportcardsPort` (documents officiels), `StoragePort` (manifeste d'archive). Aucune vue SQL ne traverse les schémas.

## 10. Rejeu de l'historique et reprise

Aucune donnée de production n'est reprise (D8) : le legacy n'a **aucun** objet primaire. Les environnements de démonstration, de test et d'e2e sont construits par seeds déterministes (`pack-template.md` §9). Les champs legacy `student_enrollments.lv2`, `scholarship_level`, `cepe_code`… ne sont pas portés ici (voir `parity.md`) : ils relèvent de 004 (`enrollments`) et de 018 (`candidate_identifiers`).
