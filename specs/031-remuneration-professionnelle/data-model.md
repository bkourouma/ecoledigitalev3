# Data Model — Rémunération professionnelle (031)

Phase 1. Schéma cible de la migration **`0103_remuneration_professionnelle.sql`**.

> Conventions communes (patron `0069`/`0070`) : `id UUID PK DEFAULT uuid_generate_v4()`,
> `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE` + **RLS**
> (policy `FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID)`
> enveloppée dans `DO $$ … EXCEPTION WHEN duplicate_object THEN NULL; END $$`),
> `created_at`/`updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`.
> La migration est **additive et idempotente** (`IF NOT EXISTS` / `IF EXISTS`
> partout) — contrairement à `0069`, aucun `DROP TABLE`.

## Carte relationnelle cible

```text
                       ┌─────────────────────┐
                       │      teachers       │  identité partagée
                       └──────────┬──────────┘
             ┌────────────────────┼─────────────────────────┐
             ▼                    ▼                         ▼
 teacher_payment_configs   course_hourly_rates    professional_ecue_hourly_rates ➕
   (salary/hourly/mixed)     (académique)              (professionnel)
             │                    │                         │
             └──────────┬─────────┴─────────────────────────┘
                        ▼
                 teacher_payments  ── payment_periods (+ academic_year_id 🔧)
                        │
                        ▼
             payment_hour_details 🔧  (source + 2 FK d'origine, exclusives)
                   │            │
      ┌────────────┘            └────────────────┐
      ▼                                          ▼
teacher_attendance_sessions          professional_ecue_seances 🔧
  (chaîne académique)                   (+ statut, validated_by/at)
                                                 │
                                        professional_ecue / professional_ue_sessions
```

Légende : ➕ nouvelle table · 🔧 table existante altérée · le reste inchangé.

## 1. Table NOUVELLE — `professional_ecue_hourly_rates`

Tarif horaire applicable à une ECUE, éventuellement restreint à un enseignant,
sur une plage de validité. Sœur de `course_hourly_rates`, dont elle reprend la
mécanique anti-chevauchement.

| Champ | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | NOT NULL → `tenants(id)` CASCADE |
| `ecue_id` | uuid | NOT NULL → `professional_ecue(id)` CASCADE |
| `enseignant_id` | uuid | NULL → `teachers(id)` CASCADE — NULL = tarif générique de l'ECUE |
| `montant_horaire` | numeric(12,2) | NOT NULL CHECK (`montant_horaire >= 0`) |
| `devise` | text | NOT NULL DEFAULT `'XOF'` |
| `valide_du` | date | NOT NULL |
| `valide_au` | date | NULL = sans fin |
| `notes` | text | NULL |
| `created_by` | uuid | NULL → `users(id)` |
| `created_at` / `updated_at` | timestamptz | NOT NULL DEFAULT now() |

**Contraintes**

```sql
CHECK (valide_au IS NULL OR valide_au >= valide_du)

-- Pas deux tarifs chevauchants pour le même couple (ECUE, enseignant).
-- Le NULL d'enseignant est neutralisé par COALESCE : le tarif générique
-- constitue son propre couple, distinct de tout tarif nominatif.
EXCLUDE USING gist (
  tenant_id WITH =,
  ecue_id   WITH =,
  COALESCE(enseignant_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
  daterange(valide_du, COALESCE(valide_au, 'infinity'::date), '[]') WITH &&
)
```

> `EXCLUDE USING gist` sur `uuid` requiert **`btree_gist`**
> (`CREATE EXTENSION IF NOT EXISTS btree_gist;`). L'extension est déjà en place —
> `0011` l'exploite pour `course_hourly_rates` — mais la migration la (re)déclare
> par sécurité sur une base reconstruite.

**Index** : `(tenant_id, ecue_id)`, `(tenant_id, enseignant_id)`, `(valide_du, valide_au)`.

**RLS** : activée + policy `professional_ecue_hourly_rates_tenant_isolation`.

## 2. Table ALTÉRÉE — `professional_ecue_seances`

Ajoute le cycle de vie « réalisation » et la validation pour la paie
(D-R4). Aucune colonne existante n'est modifiée ni supprimée.

| Champ ajouté | Type | Contraintes |
|---|---|---|
| `statut` | text | NOT NULL DEFAULT `'planifiee'` CHECK IN (`'planifiee'`,`'realisee'`,`'annulee'`) |
| `statut_modifie_par` | uuid | NULL → `users(id)` |
| `statut_modifie_le` | timestamptz | NULL |
| `validated_by` | uuid | NULL → `users(id)` |
| `validated_at` | timestamptz | NULL |

**Règle de payabilité** (appliquée côté service, exprimée ici comme prédicat de
référence) :

```sql
statut = 'realisee'
AND validated_at  IS NOT NULL
AND enseignant_id IS NOT NULL
AND heure_debut   IS NOT NULL
AND heure_fin     IS NOT NULL
```

**Durée** (jamais stockée, D-R5) :

```sql
EXTRACT(EPOCH FROM (heure_fin - heure_debut)) / 3600.0
```

**Index ajouté** : `(tenant_id, statut, date)` — filtre principal de l'écran de
validation et de la collecte d'heures.
Index de couverture paie : `(tenant_id, enseignant_id, date) WHERE validated_at IS NOT NULL`.

**Initialisation** : toutes les lignes existantes prennent `'planifiee'` via le
`DEFAULT` de la colonne ajoutée. **Aucun backfill** en `'realisee'` (D-R12).

## 3. Table ALTÉRÉE — `payment_hour_details`

Régularise l'écart E4 et porte l'origine de chaque heure (D-R7).

### État actuel (rappel, `0011:110-127`)

```sql
teaching_hours_id uuid NOT NULL REFERENCES teaching_hours(id) ON DELETE CASCADE
CONSTRAINT unique_teaching_hour_per_payment UNIQUE (payment_id, teaching_hours_id)
```

…alors que le calculateur y insère des `teacher_attendance_sessions.id`.

### Cible

| Champ | Évolution |
|---|---|
| `teaching_hours_id` | `NOT NULL` → **NULLABLE** ; FK conservée vers `teaching_hours(id)` |
| `source` | **AJOUT** — text NOT NULL DEFAULT `'academique'` CHECK IN (`'academique'`,`'professionnel'`) |
| `attendance_session_id` | **AJOUT** — uuid NULL → `teacher_attendance_sessions(id)` ON DELETE SET NULL |
| `seance_id` | **AJOUT** — uuid NULL → `professional_ecue_seances(id)` ON DELETE SET NULL |
| `hours_count`, `hourly_rate`, `amount`, `is_overtime` | inchangés — ce sont eux qui **historisent** durée et tarif (FR-023) |

**Contrainte d'exclusivité** — exactement une référence d'origine, cohérente
avec `source` :

```sql
CHECK (
  (source = 'academique'
     AND seance_id IS NULL
     AND (teaching_hours_id IS NOT NULL OR attendance_session_id IS NOT NULL))
  OR
  (source = 'professionnel'
     AND seance_id IS NOT NULL
     AND teaching_hours_id IS NULL
     AND attendance_session_id IS NULL)
)
```

**Unicité** — l'ancienne contrainte devient inopérante dès que
`teaching_hours_id` peut être NULL (en SQL, deux NULL ne sont pas égaux). Elle
est remplacée par trois index uniques **partiels**, un par référence :

```sql
DROP  CONSTRAINT IF EXISTS unique_teaching_hour_per_payment;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_phd_payment_teaching_hour
  ON payment_hour_details (payment_id, teaching_hours_id)     WHERE teaching_hours_id     IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_phd_payment_attendance
  ON payment_hour_details (payment_id, attendance_session_id) WHERE attendance_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_phd_payment_seance
  ON payment_hour_details (payment_id, seance_id)             WHERE seance_id             IS NOT NULL;
```

> **Ordre d'exécution impératif** : `DROP CONSTRAINT` **avant** l'`ALTER COLUMN
> … DROP NOT NULL`, et la FK `payment_hour_details_teaching_hours_id_fkey` est
> traitée en `DROP … IF EXISTS` puis recréée — son existence réelle en base doit
> être constatée avant (D-R7, risque R1).

**Index ajoutés** : `(payment_id, source)`, `(tenant_id, seance_id)`.

## 4. Table ALTÉRÉE — `payment_periods`

Régularise l'écart E5 (D-R8).

| Champ | Évolution |
|---|---|
| `academic_year_id` | **AJOUT** — uuid **NULL** → `academic_years(id)` ON DELETE SET NULL |

**Index** : `(tenant_id, academic_year_id)`.

Volontairement **nullable** : les lignes déjà présentes dans les bases où la
colonne a été créée à la main peuvent l'avoir vide. Le passage à `NOT NULL` fera
l'objet d'une migration ultérieure, une fois le rattrapage constaté.

La contrainte `EXCLUDE` anti-chevauchement des périodes reste **inchangée**
(portée tenant + plage de dates) : deux périodes qui se chevauchent restent
interdites même si elles relèvent d'années académiques différentes.

## 5. Table ALTÉRÉE — `teacher_payments`

| Champ / objet | Évolution |
|---|---|
| `currency` | `SET DEFAULT 'XOF'` (D-R9) — no-op sur les bases issues de `0011_…_fixed`, qui déclare déjà `'XOF'` |
| `unique_teacher_payment_per_period` | **RECRÉÉE** (E7) — absente en base malgré sa déclaration dans `0011` |

Les lignes existantes ne sont **pas** réécrites : un montant approuvé l'a été
avec la devise affichée à l'époque.

```sql
-- E7 : la contrainte declaree par 0011 n'existe pas en base (constat T002).
-- Elle porte la decision D-R2 : un seul paiement par enseignant/periode/type,
-- toutes origines confondues. Sans elle, deux calculs concurrents peuvent
-- inserer deux paiements pour le meme couple.
DO $$
DECLARE dups int;
BEGIN
  SELECT count(*) INTO dups FROM (
    SELECT 1 FROM teacher_payments
    GROUP BY tenant_id, teacher_id, payment_period_id, payment_type
    HAVING count(*) > 1
  ) d;
  IF dups > 0 THEN
    RAISE EXCEPTION
      '0103: % groupe(s) de paiements en double — resoudre avant d''ajouter unique_teacher_payment_per_period', dups;
  END IF;
END $$;

ALTER TABLE teacher_payments
  ADD CONSTRAINT unique_teacher_payment_per_period
  UNIQUE (tenant_id, teacher_id, payment_period_id, payment_type);
```

> Le `RAISE EXCEPTION` est délibéré : mieux vaut un déploiement qui s'arrête
> avec un message actionnable qu'une contrainte silencieusement absente.
> L'ajout est enveloppé côté migration dans un test de présence
> (`IF NOT EXISTS (SELECT … FROM pg_constraint …)`) pour rester rejouable.

## 5bis. Table ALTÉRÉE — `payment_periods` (garde-fou E8)

`payment_periods_no_overlap`, déclarée par `0011`, est **absente en base**. Deux
périodes qui se recouvrent feraient tomber une même séance validée dans les deux
et la feraient **payer deux fois** — risque directement aggravé par l'ajout d'une
source d'heures.

```sql
DO $$
DECLARE overlaps int;
BEGIN
  SELECT count(*) INTO overlaps
  FROM payment_periods a
  JOIN payment_periods b
    ON b.tenant_id = a.tenant_id
   AND b.id <> a.id
   AND b.status <> 'archived'
   AND daterange(a.period_start, a.period_end, '[]')
    && daterange(b.period_start, b.period_end, '[]')
  WHERE a.status <> 'archived';
  IF overlaps > 0 THEN
    RAISE EXCEPTION
      '0103: % periode(s) se chevauchent — resoudre avant d''ajouter payment_periods_no_overlap', overlaps;
  END IF;
END $$;

ALTER TABLE payment_periods
  ADD CONSTRAINT payment_periods_no_overlap EXCLUDE USING gist (
    tenant_id WITH =,
    daterange(period_start, period_end, '[]') WITH &&
  ) WHERE (status <> 'archived');
```

> Le `WHERE (status <> 'archived')` reprend la déclaration d'origine : une
> période archivée ne bloque plus la création d'une nouvelle période sur la même
> plage.

## 6. Extension applicative — `payment_hour_details` enrichi en lecture

Les écrans et le PDF ont besoin du libellé de l'origine. Une **vue** évite de
dupliquer la jointure dans cinq requêtes :

```sql
CREATE OR REPLACE VIEW v_payment_hour_details_enriched AS
SELECT
  phd.*,
  CASE phd.source
    WHEN 'professionnel' THEN se.date
    ELSE tas.session_date
  END                                        AS session_date,
  CASE phd.source
    WHEN 'professionnel' THEN ec.libelle
    ELSE c.name
  END                                        AS intitule,
  CASE phd.source
    WHEN 'professionnel' THEN ec.code
    ELSE c.code
  END                                        AS code,
  us.libelle                                 AS cohorte_libelle
FROM payment_hour_details phd
LEFT JOIN professional_ecue_seances se ON se.id = phd.seance_id
LEFT JOIN professional_ecue          ec ON ec.id = se.ecue_id
LEFT JOIN professional_ue_sessions   us ON us.id = se.ue_session_id
LEFT JOIN teacher_attendance_sessions tas ON tas.id = phd.attendance_session_id
LEFT JOIN class_courses cc ON cc.id = tas.class_course_id
LEFT JOIN courses        c  ON c.id  = cc.course_id;
```

> La vue **n'a pas de RLS propre** : elle hérite de celle des tables sous-jacentes
> (`security_invoker` non requis ici puisqu'elle n'est lue que dans un contexte où
> `app.tenant_id` est positionné). Toute requête sur cette vue doit passer par le
> même helper de contexte tenant que les tables.

## 7. Requête de collecte des heures professionnelles

Contrat de `ProfessionalHourCollector` (D-R3) — **une seule requête par période**,
tous enseignants confondus, pour tenir SC-006 :

```sql
SELECT
  se.id                                                        AS seance_id,
  se.enseignant_id                                             AS teacher_id,
  se.date                                                      AS session_date,
  EXTRACT(EPOCH FROM (se.heure_fin - se.heure_debut)) / 3600.0 AS hours,
  se.ecue_id,
  se.ue_session_id,
  ec.code    AS ecue_code,
  ec.libelle AS ecue_libelle,
  us.libelle AS cohorte_libelle
FROM professional_ecue_seances se
JOIN professional_ecue        ec ON ec.id = se.ecue_id        AND ec.tenant_id = se.tenant_id
JOIN professional_ue_sessions us ON us.id = se.ue_session_id  AND us.tenant_id = se.tenant_id
WHERE se.tenant_id     = $1
  AND se.date BETWEEN $2::date AND $3::date
  AND se.statut        = 'realisee'
  AND se.validated_at  IS NOT NULL
  AND se.enseignant_id IS NOT NULL
  AND se.heure_debut   IS NOT NULL
  AND se.heure_fin     IS NOT NULL
  AND ($4::uuid[] IS NULL OR se.enseignant_id = ANY($4::uuid[]))
ORDER BY se.enseignant_id, se.date, se.heure_debut;
```

## 8. Requête de résolution du tarif (D-R6)

Pour un couple (ECUE, enseignant) et une date de séance — le tri place le tarif
nominatif avant le générique, et le plus récemment ouvert en tête :

```sql
SELECT montant_horaire
FROM professional_ecue_hourly_rates
WHERE tenant_id = $1
  AND ecue_id   = $2
  AND (enseignant_id = $3 OR enseignant_id IS NULL)
  AND valide_du <= $4::date
  AND (valide_au IS NULL OR valide_au >= $4::date)
ORDER BY (enseignant_id IS NULL), valide_du DESC
LIMIT 1;
```

Repli si aucune ligne : `teacher_payment_configs.default_hourly_rate`.
Repli épuisé : **anomalie remontée** dans le compte rendu (FR-013), jamais 0.

## 9. Récapitulatif des objets

| Objet | Nature | Fichier |
|---|---|---|
| `professional_ecue_hourly_rates` | table ➕ | `0103_remuneration_professionnelle.sql` |
| `professional_ecue_seances` (+5 colonnes, +2 index) | table 🔧 | idem |
| `payment_hour_details` (+3 colonnes, FK relâchée, 3 index uniques partiels) | table 🔧 | idem |
| `payment_periods` (+`academic_year_id`, + EXCLUDE `no_overlap` recréé) | table 🔧 | idem |
| `teacher_payments` (défaut devise, + UNIQUE `per_period` recréé) | table 🔧 | idem |
| `v_payment_hour_details_enriched` | vue ➕ | idem |

> **Régularisations ajoutées après le constat T002** ([`_constat.txt`](./_constat.txt)) :
> les deux contraintes des §5 et §5bis sont déclarées par `0011` mais **absentes
> de la base**. Elles ne figuraient pas au périmètre initial de la feature ;
> elles y entrent parce qu'elles garantissent, au niveau base, deux règles dont
> cette feature dépend directement (un seul paiement par enseignant/période ;
> pas de double paiement d'une séance via des périodes qui se recouvrent).

**Rollback** : `DROP VIEW`, `DROP TABLE professional_ecue_hourly_rates`,
`DROP COLUMN` des colonnes ajoutées, restauration du `NOT NULL` sur
`teaching_hours_id` (possible seulement si aucune ligne professionnelle n'a été
écrite). La migration doit donc être considérée comme **réversible avant premier
calcul, irréversible après**.
