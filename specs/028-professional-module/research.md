# Phase 0 — Research: Module Professionnel

**Feature**: 028-professional-module | **Date**: 2026-05-20

Ce document consolide les décisions techniques. Les décisions D1–D9 proviennent du journal de décisions (§3 du document de référence `docs/module-professionnel-requirements.md`) ; les décisions R-xx résultent de la confrontation aux conventions réelles du dépôt. Aucune `[NEEDS CLARIFICATION]` ne subsiste.

---

## R1 — Espace de noms du module (reprend D1)

**Decision**: Module dédié et distinct. Tables préfixées `professional_*`, endpoints sous `/api/v1/professional/*`, code web sous `apps/web/src/app/professionnel/`. Aucun réemploi des tables `*_professionnelles` ni des routes `/…-pro` du module « formations professionnelles » existant.

**Rationale**: Sémantique différente (crédits UV, rattachement académique, vente à la carte par matière). Le module « formations professionnelles » existant (`formations_professionnelles`, `/formations-pro`, `formateurs`) reste intact → garantit la non-régression (FR-033).

**Alternatives considered**: Fusion avec le module existant — rejetée : modèles de données incompatibles et risque élevé de régression.

---

## R2 — Modèle de prix des matières (reprend D2)

**Decision**: Prix **explicite** stocké sur `professional_subjects.prix` (`numeric(14,2)`). `nb_uv` est une information purement académique, sans rôle dans le calcul du prix.

**Rationale**: Découplage prix/UV → souplesse tarifaire ; conforme à la règle métier §5.4 (montant = somme des prix).

**Alternatives considered**: Prix dérivé `nb_uv × prix_par_uv` — rejeté au MVP (rigide). Une valeur indicative `prix_par_uv` au niveau tenant pourra, en Phase 2, pré-remplir la saisie sans contraindre.

---

## R3 — Réutilisation pédagogique et financière (affine D3)

**Decision**:
- **Paiements** : nouvelle table `professional_payments` (le modèle existant `payment_transactions` est structurellement couplé au parcours académique — colonnes `enrollment_id → student_enrollments`, `fee_type`, `tuition_installment_id` — donc inadapté).
- **Reçus** : pas de nouvelle table `professional_receipts` au MVP. La table existante `payment_receipts` est **incompatible** (FK `transaction_id NOT NULL → payment_transactions`). Le numéro et l'URL de reçu sont **dénormalisés** sur `professional_payments` (`receipt_number`, `receipt_url`), exactement comme `payment_transactions` met en cache `receipt_url`.
- **Reporting financier** : il n'existe **aucune table** `financial_reports` ; les rapports sont **calculés** par `apps/api/src/services/financial-reports.service.ts` en agrégeant `payment_transactions`. L'intégration consiste à **étendre ce service** pour agréger aussi `professional_payments` (tâche d'intégration, Phase 1 §10.6).
- **Présences / supports / notes** (US6, priorité P3) : rattachement aux sessions professionnelles via les mécanismes pédagogiques existants. Le mécanisme exact d'attache (FK `professional_session_id` nullable sur les tables de présence/supports/notes, ou table de liaison) sera arrêté au moment de l'implémentation de la story P3, contre le schéma réel de ces tables. **Non bloquant** pour P1/P2.

**Rationale**: Le document de référence (D3, note §4.5) prévoit explicitement de créer une table dédiée « uniquement si le modèle receipts est incompatible » — ce qui est le cas. Dénormaliser le reçu sur le paiement évite une table superflue tout en restant homogène avec l'existant.

**Alternatives considered**: Réutiliser `payment_transactions`/`payment_receipts` tels quels — rejeté (couplage au parcours académique). Créer `professional_receipts` — reporté en Phase 2 si un modèle de reçu riche devient nécessaire.

---

## R4 — Modèle de paiement (reprend D4)

**Decision**: Panier → **1 commande** (`professional_orders`) → **1 paiement** (`professional_payments`). L'étudiant peut créer plusieurs commandes successives. Échéanciers et remboursements = Phase 2.

**Rationale**: Simplicité MVP ; couvre le parcours « somme des matières choisies » (§5.4).

**Alternatives considered**: Paiement par matière, ou échéancier dès le MVP — rejetés (complexité prématurée).

---

## R5 — Patron RLS multi-tenant (reprend D7, ancré sur le code réel)

**Decision**: Chaque table `professional_*` :
- porte `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE` ;
- active la RLS : `ALTER TABLE … ENABLE ROW LEVEL SECURITY` ;
- déclare une policy d'isolation dédiée, dans un bloc idempotent :
  ```sql
  DO $$ BEGIN
    CREATE POLICY professional_subjects_tenant_isolation ON professional_subjects
      FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  ```

**Rationale**: C'est le patron exact de la migration la plus récente du dépôt (`0060_registration_requests.sql`). Le contexte tenant est le GUC `app.tenant_id`, positionné automatiquement sur chaque connexion du pool par le plugin `rls-context.ts` (`set_config('app.tenant_id', …)`).

**Alternatives considered**: Helpers `app_current_tenant_id()` / `app_is_super_admin_context()` + `FORCE ROW LEVEL SECURITY` + `WITH CHECK` (patron de `0055_unified_multitenancy.sql`) — variante plus robuste qui honore le contexte super-admin. **Retenue comme renforcement recommandé** : utiliser les helpers et `WITH CHECK` si l'accès super-admin aux données professionnelles est requis. À défaut, le patron `0060` simple suffit au MVP. La migration `0055` réapplique de toute façon une policy uniforme à toute table portant `tenant_id`.

---

## R6 — Référence « étudiant » (correction du document de référence)

**Decision**: `professional_orders.student_id` et `professional_enrollments.student_id` référencent **`student_profiles(id)`**, et non `users(id)`.

**Rationale**: Le document de référence (annexe A) écrivait `REFERENCES users(id)`. Or, dans le dépôt réel, un étudiant est modélisé par un couple `users` + `student_profiles` (1:1), et **toutes** les inscriptions existantes (`student_enrollments.student_id`, `student_parents.student_id`, `payment_transactions.student_id`) référencent `student_profiles(id)`. Aligner le module dessus garantit la cohérence (liaison parent-enfant via `student_parents`, FR-030 ; parcours mixte classique/professionnel, D5/FR-034).

**Alternatives considered**: Référencer `users(id)` — rejeté : romprait l'homogénéité et compliquerait les vues parent.

---

## R7 — Détection de cycle dans le graphe de prérequis

**Decision**: Validation **applicative** dans `professional-catalog.service.ts`. Avant d'insérer une arête `X requiert Y`, le service vérifie, par un parcours en profondeur (DFS) du graphe `professional_subject_prerequisites` du tenant, que `Y` ne peut pas déjà atteindre `X`. Si une telle accessibilité existe, l'arête créerait un cycle → rejet (`409`/`422`). Sont également rejetés : `X = Y` (aussi garanti par un `CHECK` SQL) et `X`, `Y` de programmes différents.

**Rationale**: PostgreSQL ne contraint pas l'acyclicité d'un graphe arbitraire ; la détection applicative est la seule option simple. Le `CHECK (professional_subject_id <> prerequisite_subject_id)` couvre l'auto-référence directe en base.

**Alternatives considered**: Trigger SQL récursif (`WITH RECURSIVE`) — possible mais déporte une logique métier complexe en base et complique les tests ; retenu comme renforcement éventuel, non requis au MVP.

---

## R8 — Automatisation du statut de session (capacité)

**Decision**: Géré dans `professional-enrollment.service.ts`, **dans la transaction** de confirmation/annulation :
- à la confirmation d'inscriptions, si le nombre d'inscriptions actives atteint `capacite_max` → la session passe `complet` ;
- à l'annulation d'une inscription active, si la session était `complet` et que la fenêtre d'inscription est encore valide → retour à `ouvert` ;
- une session sans `capacite_max` (NULL = illimitée) ne passe jamais `complet`.

Le comptage des inscriptions actives utilise un `SELECT … FOR UPDATE` sur la ligne de session pour éviter la sur-réservation en concurrence.

**Rationale**: La règle métier §5.8 et le critère SC-009 (aucune sur-réservation) imposent une cohérence transactionnelle. Verrouiller la session sérialise les confirmations concurrentes.

**Alternatives considered**: Recalcul du statut par un job périodique — rejeté : fenêtre de sur-réservation. Trigger SQL — possible mais la logique de fenêtre d'inscription est plus lisible côté service.

---

## R9 — Numérotation et application de la migration

**Decision**: Fichier `infra/scripts/migrations/0061_professional_module.sql`. La migration la plus haute existante est `0060_registration_requests.sql`. La migration est **idempotente** (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, policies en `DO $$ … EXCEPTION WHEN duplicate_object`) et **non destructive** (aucun `DROP`, aucun `ALTER` de table existante).

Application : il n'existe pas de runner de migration générique. Deux options homogènes avec l'existant — (a) `psql -f infra/scripts/migrations/0061_professional_module.sql`, ou (b) un runner Node `scripts/apply-migration-0061-professional-module.js` calqué sur `scripts/apply-migration-0055-unified-multitenancy.js` (lecture de `DATABASE_URL` / `DB_*`).

**Rationale**: Conventions strictes du dépôt (préfixe 4 chiffres, idempotence systématique).

**Alternatives considered**: Introduire un outil de migration (node-pg-migrate, Prisma Migrate) — hors périmètre, romprait la convention.

---

## R10 — Idempotence du paiement

**Decision**: Contrainte `UNIQUE (tenant_id, reference_transaction)` sur `professional_payments`. Le service `professional-payment.service.ts` traite le paiement en `INSERT … ON CONFLICT (tenant_id, reference_transaction) DO NOTHING` puis relit la ligne : si le paiement existait déjà au statut `confirme`, l'appel renvoie le résultat existant **sans** recréer de commande ni de paiement.

**Rationale**: Critère SC-005 et FR-022 (rejouer une référence ne crée pas de doublon). La contrainte d'unicité est la garantie ultime ; `ON CONFLICT` rend l'endpoint sûr aux rejeux et aux double-clics.

**Alternatives considered**: Idempotence applicative seule (SELECT puis INSERT) — rejetée : fenêtre de course. Clé d'idempotence d'en-tête HTTP — sur-dimensionné pour le MVP.

---

## R11 — Validation et contrats

**Decision**: Schémas Zod dans `packages/contracts/src/professional.ts` (nommage de champs **snake_case**, aligné sur `formations-pro.ts` qui reflète directement les colonnes DB), re-exportés par le barrel `packages/contracts/src/index.ts`. Côté routes Fastify, validation par **JSON-Schema** dans le bloc `schema` (params/body/querystring/response), conformément au module `formations-pro` ; les schémas Zod servent surtout aux **types TypeScript** partagés et peuvent être utilisés en `.parse()` défensif dans les services. Enveloppe de réponse : `{ success: true, data }` / `{ success: false, error, message }`.

**Rationale**: Cohérence avec le module analogue. Éviter d'introduire `fastify-type-provider-zod` non utilisé ailleurs.

**Alternatives considered**: Validation Zod au niveau route — non retenue pour rester homogène avec `formations-pro`.

---

## R12 — Authentification, rôles et contexte tenant

**Decision**:
- Routes enregistrées dans `apps/api/src/index.ts` **après** `authMiddleware`, avec `prefix: "/api/v1/professional"` → authentification JWT obligatoire (le module n'est **pas** ajouté à `skipAuthRoutes`).
- Ajouter `"/api/v1/professional"` au tableau `tenantRequiredPrefixes` de `plugins/tenant-context.ts` → exigence automatique du contexte tenant (`X-Tenant` ou JWT).
- Gardes de rôle : petites fonctions `preHandler` calquées sur `middlewares/requireOwner.ts` (p. ex. `requireAdmin`, `requireStudent`, `requireParent`), ou contrôle inline de `request.user.roles`. Rôles concernés : `admin`, `student`, `parent`, `teacher`.

**Rationale**: Le module manipule des données financières et nominatives → jamais public, contrairement au catalogue `formations-pro` (qui est dans `skipAuthRoutes`). Réutilise l'infrastructure d'auth et de RLS existante sans la modifier.

**Alternatives considered**: Catalogue public (comme `formations-pro`) — rejeté : l'état des prérequis et le panier sont propres à l'étudiant authentifié.

---

## Synthèse des écarts au document de référence

| Point | Document de référence | Décision ancrée sur le code |
|---|---|---|
| FK étudiant | `users(id)` | **`student_profiles(id)`** (R6) |
| Reçus | « réutiliser `receipts` » | Table `receipts` inexistante → reçu dénormalisé sur `professional_payments` (R3) |
| Rapport financier | « réutiliser `financial_reports` » | Table inexistante → **étendre** le service de calcul `financial-reports.service.ts` (R3) |
| Numéro de migration | `00XX` | **`0061`** (R9) |
| Contexte tenant RLS | `current_setting('app.current_tenant')` | GUC réel **`app.tenant_id`** (R5) |

Ces écarts devront être confirmés à la relecture humaine ; ils ne changent pas le périmètre fonctionnel.

---

## R3-addendum — Rattachement pédagogique des sessions professionnelles (US6, tâche T046)

**Investigation** : les sous-systèmes pédagogiques existants sont **étroitement couplés** au modèle académique :
- Présences → `attendance_sessions.class_course_id` + `teacher_id` (`NOT NULL`) ; route `attendance.ts` ~1226 lignes, deux pipelines de présence.
- Supports → `course_materials.course_id` → `courses(id)` (`NOT NULL`).
- Notes → `assignment_submissions` → `assignments.course_id` → `courses(id)` (`NOT NULL`) ; pas de table `grades` dédiée, notation par devoir/cours.
- Liste des cours enseignant → chaîne figée `teacher_assignments → class_courses → courses → classes → programmes`.

Aucune ligne `sessions`/`courses` générique ne peut accueillir un `professional_subject_sessions`.

**Decision** : **ne pas** retrofiter les tables académiques (FK `NOT NULL`, surface de régression trop large — contraire à FR-033). Créer des **tables sœurs dédiées**, clés directement sur `professional_subject_sessions.id`, suivant le patron RLS de la migration 0061 :
- `professional_session_materials` — supports de cours d'une session professionnelle ;
- `professional_session_attendance` — présence par étudiant.

Côté enseignant, exposer les sessions professionnelles via un **endpoint dédié** (`/api/v1/professional/teacher/*`), filtré sur `professional_subject_sessions.enseignant_id` (la FK existe déjà), sans modifier `teacher-courses.ts`.

**Rationale** : changement strictement **additif et isolé** — zéro modification des tables/services académiques, zéro risque de non-régression. Migration `0062_professional_pedagogy.sql`.

**Alternatives considered** : ajouter une colonne `professional_session_id` nullable + assouplir les FK existantes en nullable + CHECK XOR + modifier chaque service académique — rejeté (surface de régression élevée pour une story P3).

**Hors périmètre** : la **notation** des sessions professionnelles (équivalent `assignment_submissions`) n'est pas reprise au MVP — répliquer le système d'évaluation par devoir serait disproportionné pour une story P3 ; reporté en Phase 2, cohérent avec le report de la validation des prérequis par note (§12 du document de référence). US6 livre la **visibilité enseignant + présences + supports** sur les sessions professionnelles.
