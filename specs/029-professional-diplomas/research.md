# Phase 0 — Research: Diplômes Professionnels

**Feature**: 029-professional-diplomas | **Date**: 2026-05-22

Ce document consolide les décisions techniques. Les décisions D1–D11 proviennent du brief de feature (résolues en *Assumptions* de `spec.md`) ; les décisions R-xx résultent de la confrontation aux conventions réelles du Module Professionnel `028` (migrations `0061`–`0063`, services `professional-*.service.ts`, contrats `packages/contracts/src/professional.ts`, routes `apps/api/src/routes/professional.ts`). Aucune `[NEEDS CLARIFICATION]` ne subsiste.

---

## R1 — Extension du Module Professionnel `028` (pas un module distinct)

**Decision**: La feature est une **extension additive** de `028`, pas un module distinct. Tables préfixées `professional_diploma*`, endpoints sous le préfixe **existant** `/api/v1/professional`, code web sous `apps/web/src/app/professionnel/` et `apps/web/src/app/parent/professionnel/`. Le nouveau service `ProfessionalDiplomasService` **hérite de `ProfessionalBaseService`** (`apps/api/src/services/professional-base.service.ts`) pour réutiliser `withTenant` / `withTenantTx` et les enveloppes `ok` / `fail`.

**Rationale**: Les diplômes consomment directement les concepts de `028` (programme, matière `professional_subjects`, inscription `professional_enrollments` au statut `terminee`). Les greffer sur le même socle garantit la cohérence et la non-régression (FR-038). Le préfixe `/api/v1/professional` est déjà dans `tenantRequiredPrefixes` et déjà enregistré après `authMiddleware` — **aucune modification d'infrastructure d'auth/tenant n'est nécessaire**.

**Alternatives considered**: Nouveau module/préfixe dédié — rejeté : duplication du socle, dérive du domaine, et le couplage métier aux entités `028` rend l'isolation artificielle.

---

## R2 — Génération des UUID : `uuid_generate_v4()`

**Decision**: Les clés primaires utilisent `DEFAULT uuid_generate_v4()` (extension `uuid-ossp`), **pas** `gen_random_uuid()`.

**Rationale**: Toutes les migrations `professional_*` (`0061`) déclarent `id UUID PRIMARY KEY DEFAULT uuid_generate_v4()` et la migration commence par `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`. Le brief mentionnait `gen_random_uuid()` ; on s'aligne sur la convention réelle du dépôt pour l'homogénéité.

**Alternatives considered**: `gen_random_uuid()` (`pgcrypto`) — fonctionnel mais romprait l'homogénéité avec les 6 tables `028`.

---

## R3 — Numérotation et application de la migration

**Decision**: Fichier `infra/scripts/migrations/0064_professional_diplomas.sql`. La migration la plus haute existante est `0063_professional_subject_bilan_type.sql`. La migration est **idempotente** (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, policies en `DO $$ … EXCEPTION WHEN duplicate_object`) et **non destructive** (aucun `DROP`, aucun `ALTER` de table existante).

Application : pas de runner générique dans le dépôt — `psql "$env:DATABASE_URL" -f infra/scripts/migrations/0064_professional_diplomas.sql`, ou un runner Node optionnel calqué sur les `scripts/apply-migration-*.js` existants.

**Rationale**: Conventions strictes du dépôt (préfixe 4 chiffres séquentiel, idempotence systématique). La migration `0064` s'applique proprement sur une base contenant déjà les données `028` (critère d'acceptation §14 du brief).

**Alternatives considered**: Introduire un outil de migration — hors périmètre, romprait la convention.

---

## R4 — Patron RLS multi-tenant

**Decision**: Chaque table `professional_diploma*` :
- porte `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE` ;
- active la RLS : `ALTER TABLE … ENABLE ROW LEVEL SECURITY` ;
- déclare une policy d'isolation `{table}_tenant_isolation` dans un bloc idempotent :
  ```sql
  DO $$ BEGIN
    CREATE POLICY professional_diplomas_tenant_isolation ON professional_diplomas
      FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  ```

**Rationale**: C'est le patron **exact** de `0061_professional_module.sql`. Le contexte tenant est le GUC `app.tenant_id`, positionné par `ProfessionalBaseService.withTenant` (`SELECT set_config('app.tenant_id', $1, true)`). Réutiliser ce socle garantit l'isolation sans nouveau mécanisme (D10, FR-034).

**Alternatives considered**: Helpers `app_current_tenant_id()` + `FORCE ROW LEVEL SECURITY` + `WITH CHECK` (patron `0055`) — non retenu au MVP pour rester strictement homogène avec `028` ; la migration `0055` réapplique de toute façon une policy uniforme à toute table portant `tenant_id`.

---

## R5 — Point d'intégration du recalcul automatique (hook `terminee`)

**Investigation**: La transition d'une inscription vers `terminee` a **un seul** point d'entrée dans `028` : la méthode `completeEnrollment(tenantId, enrollmentId)` de `apps/api/src/services/professional-enrollment.service.ts` (lignes 624-649). Elle exécute `UPDATE professional_enrollments SET statut='terminee' … WHERE … statut='confirmee'` et `RETURNING id, session_id, student_id, statut`. Elle est appelée par la route `POST /enrollments/:id/complete` (garde `requireAdminOrTeacher`). Le service `professional-teacher.service.ts` ne possède **pas** de méthode d'achèvement propre — il ne lit `terminee` qu'en `SELECT`.

**Decision**:
1. `completeEnrollment` est étendue de façon **additive** : le `RETURNING` joint `professional_subject_sessions` pour exposer aussi `subject_id` (= `professional_subject_id` de la session). Aucun autre changement de comportement.
2. Dans le **handler de route** `POST /enrollments/:id/complete`, **après** que `completeEnrollment` a réussi (transition committée), on appelle `ProfessionalDiplomasService.recomputeForStudent(tenantId, studentId, subjectId)` enveloppé dans un `try/catch` **best-effort** : toute erreur du recalcul est journalisée mais **ne modifie pas** la réponse de l'achèvement.

**Rationale**: FR-020 impose qu'une défaillance du recalcul n'empêche ni n'annule l'achèvement. Placer le recalcul **hors** de la transaction de `completeEnrollment` (et non dedans) est donc nécessaire : la transition `terminee` est déjà committée et durable quand le recalcul s'exécute. `recomputeForStudent` ouvre sa propre transaction (`withTenantTx`). Un seul point d'intégration (une route) suffit puisque `completeEnrollment` est l'unique transition `→ terminee`.

**Alternatives considered**:
- Recalcul **dans** la transaction de `completeEnrollment` — rejeté : un échec annulerait l'achèvement (viole FR-020).
- Trigger SQL `AFTER UPDATE` sur `professional_enrollments` — rejeté : déporte la logique métier (snapshot, génération de référence, idempotence) en base, complique les tests Jest, et un échec du trigger annulerait l'`UPDATE`.
- Job périodique de recalcul — rejeté : latence d'octroi non conforme à SC-001 (octroi « dès l'achèvement »). Le endpoint `POST /diplomas/:id/recompute` couvre le besoin de rattrapage de masse.

---

## R6 — Calcul de l'éligibilité (SQL)

**Decision**: Une matière exigée est **validée** par un étudiant s'il existe au moins une `professional_enrollments` au statut `terminee` reliée (via `professional_subject_sessions`) à cette matière. L'éligibilité à un diplôme se calcule en une requête agrégée :

```sql
-- matières exigées validées par l'étudiant (DISTINCT par matière)
WITH req AS (
  SELECT r.subject_id, r.est_obligatoire, s.nb_uv
  FROM professional_diploma_requirements r
  JOIN professional_subjects s ON s.id = r.subject_id
  WHERE r.diploma_id = $1
),
validees AS (
  SELECT DISTINCT sess.professional_subject_id AS subject_id
  FROM professional_enrollments e
  JOIN professional_subject_sessions sess ON sess.id = e.session_id
  WHERE e.student_id = $2 AND e.statut = 'terminee'
)
SELECT
  COALESCE(SUM(req.nb_uv) FILTER (WHERE v.subject_id IS NOT NULL), 0) AS uv_validees,
  bool_and(req.est_obligatoire IS FALSE OR v.subject_id IS NOT NULL)   AS obligatoires_ok
FROM req LEFT JOIN validees v ON v.subject_id = req.subject_id;
```

L'étudiant est **éligible** si `obligatoires_ok` est vrai **et** `uv_validees >= diploma.uv_required`. Le `DISTINCT` sur `professional_subject_id` garantit qu'une matière terminée sur plusieurs sessions n'est comptée qu'une fois (edge case du `spec.md`).

**Rationale**: Logique exprimable en SQL pur, testable et performante grâce aux index `028` (`idx_prof_enroll_student (tenant_id, student_id, statut)`). La RLS borne automatiquement chaque CTE au tenant courant.

**Alternatives considered**: Calcul applicatif en TypeScript après chargement des lignes — équivalent fonctionnellement ; la version SQL est retenue pour la concision et la cohérence transactionnelle. La fonction d'**évaluation pure** (entrées : liste d'exigences + ensemble des matières validées → sortie : `{uv_validees, obligatoires_ok, eligible}`) est néanmoins isolée comme **fonction testable unitairement** sans base, pour couvrir les tests Jest sur « logique pure ».

---

## R7 — Snapshot des exigences à l'octroi

**Decision**: À chaque octroi (automatique ou manuel), la colonne JSONB `requirements_snapshot` de `student_professional_diplomas` reçoit un tableau figé des exigences au moment T :

```jsonc
{
  "uv_required": 12,
  "captured_at": "2026-05-22T10:00:00.000Z",
  "requirements": [
    { "subject_id": "uuid", "code": "PRO-A", "libelle": "...", "nb_uv": 4, "est_obligatoire": true,  "ordre": 0, "validee": true },
    { "subject_id": "uuid", "code": "PRO-B", "libelle": "...", "nb_uv": 3, "est_obligatoire": false, "ordre": 1, "validee": true }
  ]
}
```

`uv_total_validees` reçoit en parallèle le cumul d'UV au moment de l'octroi. Modifier ensuite le diplôme ou ses exigences **ne touche pas** ce snapshot (FR-018, D5).

**Rationale**: Traçabilité : on doit pouvoir justifier *a posteriori* pourquoi un diplôme a été octroyé, même après refonte du référentiel. JSONB évite une table d'historique dédiée superflue au MVP.

**Alternatives considered**: Table `student_professional_diploma_requirement_snapshots` normalisée — rejetée : sur-ingénierie pour un MVP, le snapshot est en lecture seule et toujours lu en bloc.

---

## R8 — Génération de la référence `DIP-{année}-{séquence}`

**Decision**: La référence d'un diplôme octroyé suit le format `DIP-{AAAA}-{NNNNNN}` (séquence sur 6 chiffres, zéro-paddée), unique par tenant. Elle est générée **dans la transaction d'octroi** : `SELECT count(*) FROM student_professional_diplomas WHERE tenant_id = $1 AND reference LIKE 'DIP-{année}-%'`, puis `séquence = count + 1`. L'unicité ultime est garantie par l'index `UNIQUE (tenant_id, reference)` ; en cas de collision (concurrence), l'octroi est rejoué.

**Rationale**: Reprend le patron de `028` pour `professional_orders.reference` (`PRO-{année}-{séquence}`, généré côté service avec garde d'unicité en base). L'année est celle de l'octroi (`date_obtention`).

**Alternatives considered**: Séquence PostgreSQL globale — rejetée : non bornée par tenant ni par année, romprait le format lisible attendu (D6).

---

## R9 — Cohérence de programme des exigences

**Decision**: Validation **applicative** dans `ProfessionalDiplomasService` : avant d'insérer/remplacer les exigences, le service vérifie que **chaque** `subject_id` référencé pointe vers une `professional_subjects` dont `programme_id` = `programme_id` du diplôme. Sinon → erreur `CROSS_PROGRAMME_REQUIREMENT` (422). La requête de remplacement vérifie l'ensemble en un seul `SELECT … WHERE id = ANY($ids) AND programme_id = $programme` et compare le compte.

**Rationale**: Reprend le patron de `028` (la cohérence de programme des prérequis y est aussi vérifiée côté service, pas par contrainte SQL — un `CHECK` ne peut pas porter sur une autre table). Le brief mentionnait « trigger ou contrainte applicative » : la voie applicative est cohérente avec `028` et plus testable.

**Alternatives considered**: Trigger SQL `BEFORE INSERT` joignant `professional_subjects` et `professional_diplomas` — possible mais déporte la logique métier en base ; retenu seulement comme renforcement éventuel, non requis au MVP.

---

## R10 — Remplacement atomique des exigences

**Decision**: `PUT /diplomas/:id/requirements` remplace **intégralement** la liste, dans une transaction (`withTenantTx`) : `DELETE FROM professional_diploma_requirements WHERE diploma_id = $1` puis `INSERT` des nouvelles lignes. La validation de cohérence de programme (R9) et l'unicité `(diploma_id, subject_id)` sont vérifiées avant le commit.

**Rationale**: FR-007 exige une substitution atomique. La transaction garantit qu'un échec partiel ne laisse pas le diplôme dans un état d'exigences incohérent.

**Alternatives considered**: `upsert` différentiel (calcul ajout/suppression) — rejeté : plus complexe, sans bénéfice pour une liste de taille modérée.

---

## R11 — Unicité d'un octroi actif & du référencement

**Decision**: Sur `student_professional_diplomas` :
- index partiel `UNIQUE (diploma_id, student_id) WHERE statut <> 'revoque'` — un étudiant ne peut détenir qu'un seul octroi non révoqué par diplôme (FR-016, FR-024), tout en autorisant un nouvel octroi après révocation (FR-028) ;
- index `UNIQUE (tenant_id, reference)` — référence lisible unique par établissement (FR-039).

Le contrôle applicatif `SELECT … WHERE diploma_id = $1 AND student_id = $2 AND statut <> 'revoque'` précède chaque octroi pour renvoyer un code métier propre (`DIPLOMA_ALREADY_AWARDED`, 409) ; l'index partiel reste le filet de sécurité contre les courses (octroi automatique et manuel concurrents).

**Rationale**: Reprend le patron des index partiels uniques de `028` (`uniq_prof_enroll_active … WHERE statut <> 'annulee'`). L'index partiel est la garantie ultime ; le contrôle applicatif soigne le message d'erreur.

**Alternatives considered**: Contrainte `UNIQUE (diploma_id, student_id)` simple — rejetée : interdirait tout nouvel octroi après révocation (viole FR-028).

---

## R12 — Authentification, rôles et contexte tenant

**Decision**:
- Les routes diplômes sont ajoutées au fichier **existant** `apps/api/src/routes/professional.ts`, donc enregistrées sous `/api/v1/professional`, **après `authMiddleware`** — JWT obligatoire.
- `/api/v1/professional` est **déjà** dans `tenantRequiredPrefixes` → contexte tenant exigé automatiquement, **aucune modification** de `plugins/tenant-context.ts`.
- Gardes de rôle : réutilisation **telle quelle** des `preHandler` existants de `apps/api/src/middlewares/professional-guards.ts` — `requireAdmin` (CRUD diplômes, exigences, octroi/révocation/recompute), `requireStudent` (suivi de progression), `requireParent` (consultation enfant). **Aucune** route diplôme n'utilise `requireTeacher` / `requireAdminOrTeacher` → un enseignant n'a aucun accès (FR-036, SC-011).

**Rationale**: Les diplômes sont des données nominatives et sensibles → jamais publics. Réutilise intégralement l'infrastructure d'auth/RBAC/RLS de `028` sans la modifier.

**Alternatives considered**: Nouveau fichier de routes séparé `professional-diplomas.ts` enregistré séparément — possible, mais ajouter au fichier `professional.ts` existant (comme demandé par le brief) évite un `register` supplémentaire et garde la table `ERROR_STATUS` centralisée.

---

## R13 — Contrats Zod et validation

**Decision**: Nouveau fichier `packages/contracts/src/professional-diplomas.ts` (nommage des champs **snake_case**, dates/timestamps en chaînes ISO — convention de `professional.ts`), re-exporté par le barrel `packages/contracts/src/index.ts`. Côté routes Fastify, validation des entrées par les schémas Zod (`.parse()` / `.safeParse()`), erreurs mappées en `VALIDATION_ERROR` (422). Enveloppe de réponse `{ success: true, data }` / `{ success: false, error, message }` via `ok` / `fail`.

Nouveaux codes d'erreur à ajouter à la table `ERROR_STATUS` de `professional.ts` : `DIPLOMA_NOT_FOUND` (404), `DUPLICATE_DIPLOMA_CODE` (409), `CROSS_PROGRAMME_REQUIREMENT` (422), `DIPLOMA_HAS_AWARDS` (409), `DIPLOMA_ALREADY_AWARDED` (409), `DIPLOMA_NOT_ELIGIBLE` (422), `DIPLOMA_NOT_AWARDED` (404), `INVALID_DIPLOMA_STATUS_TRANSITION` (422).

**Rationale**: Cohérence stricte avec `028`. Un fichier de contrats dédié (plutôt que d'étendre `professional.ts`) garde le domaine « diplômes » lisible et facilite le re-export ciblé.

**Alternatives considered**: Étendre `professional.ts` — fonctionnel mais alourdit un fichier déjà conséquent ; le brief autorise explicitement le fichier dédié.

---

## R14 — Statut `en_cours` réservé (forward-compat)

**Decision**: La colonne `statut` de `student_professional_diplomas` accepte `('en_cours','obtenu','revoque')` dans son `CHECK`, mais le MVP **ne crée jamais** de ligne au statut `en_cours` : aucune ligne d'octroi n'existe tant que le diplôme n'est pas obtenu. La progression d'un étudiant non titulaire est **calculée à la volée** (R6) à partir des inscriptions et des exigences courantes.

**Rationale**: D11 du brief. Conserver `en_cours` dans le `CHECK` évite une migration ultérieure si un suivi de progression pré-matérialisé est introduit en Phase 2, sans coût au MVP.

**Alternatives considered**: `CHECK (statut IN ('obtenu','revoque'))` strict — rejeté : imposerait une migration de schéma pour le cas d'usage futur explicitement anticipé par D11.

---

## Synthèse des écarts au brief de feature

| Point | Brief | Décision ancrée sur le code `028` |
|---|---|---|
| Génération UUID | `gen_random_uuid()` | **`uuid_generate_v4()`** (extension `uuid-ossp`) — R2 |
| Emplacement des routes | « nouvelles routes dans `professional.ts` » | Confirmé — fichier existant, préfixe `/api/v1/professional` — R12 |
| Hook recompute | « dans `professional-enrollment.service.ts` ou `professional-teacher.service.ts` » | Point unique = `completeEnrollment` (enrollment service) ; appel **best-effort dans le handler de route**, hors transaction — R5 |
| Trigger cohérence programme | « trigger ou contrainte applicative » | **Applicative** dans le service (cohérent avec la validation des prérequis `028`) — R9 |

Ces écarts ne changent pas le périmètre fonctionnel ; ils alignent l'implémentation sur les conventions réelles du dépôt.
