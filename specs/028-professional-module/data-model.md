# Phase 1 — Data Model: Module Professionnel

**Feature**: 028-professional-module | **Date**: 2026-05-20 | **Migration**: `infra/scripts/migrations/0061_professional_module.sql`

Conventions communes à toutes les nouvelles tables :
- `id UUID PRIMARY KEY DEFAULT uuid_generate_v4()`
- `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- Row-Level Security **activée**, policy d'isolation `..._tenant_isolation` (voir research R5)
- Migration **idempotente** et **non destructive** (research R9)

Tables existantes référencées (non modifiées) : `tenants`, `programmes`, `teachers`, `classrooms`, `student_profiles`.

---

## Diagramme relationnel (logique)

```text
programmes ───< professional_subjects ───< professional_subject_sessions ───< professional_enrollments >─── professional_orders ───< professional_payments
                      │   ▲                         │                                  │
                      │   │ (graphe prérequis)      │ enseignant_id → teachers          │ student_id → student_profiles
                      └───┴ professional_subject_prerequisites      classroom_id → classrooms
```

---

## 4.1 `professional_subjects` — Matière professionnelle

| Champ | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | NOT NULL → `tenants(id)` ON DELETE CASCADE |
| `programme_id` | uuid | NOT NULL → `programmes(id)` |
| `code` | text | NOT NULL ; **UNIQUE (`tenant_id`, `code`)** |
| `libelle` | text | NOT NULL |
| `description` | text | NULL |
| `nb_uv` | integer | NOT NULL DEFAULT 0 ; `CHECK (nb_uv >= 0)` |
| `prix` | numeric(14,2) | NOT NULL DEFAULT 0 ; `CHECK (prix >= 0)` |
| `statut` | text | NOT NULL DEFAULT `'actif'` ; `CHECK (statut IN ('actif','inactif'))` |
| `created_at` / `updated_at` | timestamptz | NOT NULL DEFAULT now() |

**Règles** : `programme_id` obligatoire (D8). Une matière `inactif` n'accepte plus de nouvelles sessions (FR-004, contrôle applicatif). Le `prix` est la base de calcul du montant (R2).

**Index** : `idx_professional_subjects_tenant_programme (tenant_id, programme_id)` ; `idx_professional_subjects_tenant_statut (tenant_id, statut)`.

---

## 4.2 `professional_subject_prerequisites` — Prérequis entre matières

| Champ | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | NOT NULL → `tenants(id)` ON DELETE CASCADE |
| `professional_subject_id` | uuid | NOT NULL → `professional_subjects(id)` ON DELETE CASCADE — la matière **qui exige** |
| `prerequisite_subject_id` | uuid | NOT NULL → `professional_subjects(id)` ON DELETE CASCADE — la matière **prérequise** |
| `created_at` | timestamptz | NOT NULL DEFAULT now() |

**Contraintes** :
- `CHECK (professional_subject_id <> prerequisite_subject_id)` — pas d'auto-référence.
- `UNIQUE (tenant_id, professional_subject_id, prerequisite_subject_id)` — pas de doublon d'arête.
- **Validation applicative** (`professional-catalog.service.ts`) : les deux matières doivent appartenir au **même programme** ; l'ajout de l'arête **ne doit pas créer de cycle** (DFS, research R7).

**Index** : `idx_prof_prereq_subject (tenant_id, professional_subject_id)` ; `idx_prof_prereq_prerequisite (tenant_id, prerequisite_subject_id)`.

**Sémantique** : une matière a 0..n prérequis ; tous doivent être satisfaits (logique **ET**, FR-008).

---

## 4.3 `professional_subject_sessions` — Session / Cours professionnel

| Champ | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | NOT NULL → `tenants(id)` ON DELETE CASCADE |
| `professional_subject_id` | uuid | NOT NULL → `professional_subjects(id)` ON DELETE CASCADE |
| `libelle` | text | NOT NULL (ex. « Session Janvier 2026 ») |
| `date_debut` | date | NOT NULL |
| `date_fin` | date | NOT NULL ; `CHECK (date_fin >= date_debut)` |
| `inscription_ouverte_le` | timestamptz | NOT NULL |
| `inscription_fermee_le` | timestamptz | NOT NULL ; `CHECK (inscription_fermee_le >= inscription_ouverte_le)` |
| `capacite_max` | integer | NULL = illimité ; `CHECK (capacite_max IS NULL OR capacite_max > 0)` |
| `enseignant_id` | uuid | NULL → `teachers(id)` (optionnel au MVP, D6) |
| `classroom_id` | uuid | NULL → `classrooms(id)` (optionnel, D3) |
| `statut` | text | NOT NULL DEFAULT `'brouillon'` ; `CHECK (statut IN ('brouillon','ouvert','complet','en_cours','termine','annule'))` |
| `created_at` / `updated_at` | timestamptz | NOT NULL DEFAULT now() |

**Machine à états** (transitions pilotées par admin sauf `ouvert↔complet` automatique — R8) :

```text
brouillon ──> ouvert ──> en_cours ──> termine
                │  ▲          
                ▼  │ (place libérée, fenêtre valide)
              complet
   (depuis brouillon/ouvert/complet) ──> annule
```

- `ouvert → complet` : automatique quand inscriptions actives = `capacite_max`.
- `complet → ouvert` : automatique quand une place se libère et `now ∈ [ouverte_le, fermee_le]`.
- `annule` : terminal ; refuse toute nouvelle inscription.

**Index** : `idx_prof_sessions_subject (tenant_id, professional_subject_id)` ; `idx_prof_sessions_enrollable (tenant_id, statut, inscription_ouverte_le, inscription_fermee_le)`.

---

## 4.4 `professional_orders` — Commande / Panier

| Champ | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | NOT NULL → `tenants(id)` ON DELETE CASCADE |
| `student_id` | uuid | NOT NULL → **`student_profiles(id)`** (R6) |
| `reference` | text | NOT NULL ; **UNIQUE (`tenant_id`, `reference`)** ; format lisible `PRO-{année}-{séquence 6 chiffres}` (généré côté service) |
| `montant_total` | numeric(14,2) | NOT NULL DEFAULT 0 ; `CHECK (montant_total >= 0)` ; = Σ `professional_enrollments.prix_unitaire` |
| `devise` | text | NOT NULL DEFAULT `'XOF'` |
| `statut` | text | NOT NULL DEFAULT `'brouillon'` ; `CHECK (statut IN ('brouillon','en_attente_paiement','payee','annulee'))` |
| `created_at` / `updated_at` | timestamptz | NOT NULL DEFAULT now() |

**Machine à états** : `brouillon` (panier) ──validation──> `en_attente_paiement` ──paiement confirmé──> `payee` ; `annulee` accessible depuis `brouillon`/`en_attente_paiement` uniquement (FR-023).

**Règle** : un étudiant a **au plus une** commande `brouillon` active à la fois (son panier courant) — contrôle applicatif. `montant_total` recalculé à chaque modification du panier.

**Index** : `idx_prof_orders_student (tenant_id, student_id, statut)` ; index partiel unique du panier courant `uniq_prof_order_cart ON (tenant_id, student_id) WHERE statut = 'brouillon'`.

---

## 4.5 `professional_enrollments` — Inscription (ligne de commande)

| Champ | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | NOT NULL → `tenants(id)` ON DELETE CASCADE |
| `order_id` | uuid | NOT NULL → `professional_orders(id)` ON DELETE CASCADE |
| `student_id` | uuid | NOT NULL → **`student_profiles(id)`** (dénormalisé pour les requêtes, R6) |
| `session_id` | uuid | NOT NULL → `professional_subject_sessions(id)` |
| `prix_unitaire` | numeric(14,2) | NOT NULL ; `CHECK (prix_unitaire >= 0)` ; **figé** = `prix` de la matière au moment de l'ajout au panier (FR-015) |
| `statut` | text | NOT NULL DEFAULT `'en_attente_paiement'` ; `CHECK (statut IN ('en_attente_paiement','confirmee','terminee','annulee'))` |
| `created_at` / `updated_at` | timestamptz | NOT NULL DEFAULT now() |

**Unicité** : index partiel `uniq_prof_enroll_active ON (tenant_id, student_id, session_id) WHERE statut <> 'annulee'` — une seule inscription active par couple (étudiant, session) (FR-027).

**Machine à états** : `en_attente_paiement` ──commande payée──> `confirmee` ──achèvement──> `terminee` ; `annulee` accessible tant que le paiement n'est pas confirmé.

**Règles** : le statut `confirmee` débloque l'accès au contenu (FR-024) ; le statut `terminee` d'une matière satisfait les prérequis qui la visent (FR-009, D9).

**Index** : `idx_prof_enroll_order (tenant_id, order_id)` ; `idx_prof_enroll_session (tenant_id, session_id, statut)` ; `idx_prof_enroll_student (tenant_id, student_id, statut)`.

---

## 4.6 `professional_payments` — Paiement

| Champ | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | NOT NULL → `tenants(id)` ON DELETE CASCADE |
| `order_id` | uuid | NOT NULL → `professional_orders(id)` ON DELETE CASCADE |
| `montant` | numeric(14,2) | NOT NULL ; `CHECK (montant >= 0)` ; = `montant_total` de la commande |
| `mode` | text | NOT NULL ; `CHECK (mode IN ('especes','mobile_money','virement','autre'))` |
| `reference_transaction` | text | NULL ; **UNIQUE (`tenant_id`, `reference_transaction`)** — idempotence (R10) |
| `statut` | text | NOT NULL DEFAULT `'initie'` ; `CHECK (statut IN ('initie','confirme','echoue','rembourse'))` |
| `paid_at` | timestamptz | NULL |
| `receipt_number` | text | NULL ; renseigné à la confirmation ; UNIQUE (`tenant_id`, `receipt_number`) |
| `receipt_url` | text | NULL ; reçu dénormalisé (R3) |
| `created_at` / `updated_at` | timestamptz | NOT NULL DEFAULT now() |

**Machine à états** : `initie` ──> `confirme` (génère `receipt_number`/`receipt_url`, bascule commande `payee` + inscriptions `confirmee`) ; `initie` ──> `echoue` ; `rembourse` = Phase 2.

**Règle** : 1 paiement par commande au MVP (D4). `INSERT … ON CONFLICT (tenant_id, reference_transaction) DO NOTHING` pour l'idempotence (R10).

**Index** : `idx_prof_payments_order (tenant_id, order_id)`.

---

## Tables existantes — intégrations (non modifiées au MVP)

| Table existante | Intégration |
|---|---|
| `programmes` | Source de `professional_subjects.programme_id`. Le catalogue étudiant ne remonte que les programmes ayant ≥ 1 matière inscriptible (D8, FR-010). |
| `teachers` | Source de `professional_subject_sessions.enseignant_id` (D6). |
| `classrooms` | Source de `professional_subject_sessions.classroom_id`. |
| `student_profiles` | Source de `student_id` des commandes et inscriptions (R6). |
| `financial-reports.service.ts` | **Étendu** (pas la base) pour agréger `professional_payments` dans les rapports de revenus (R3). |
| Présences / supports / notes | Rattachement aux sessions professionnelles — story P3 (US6) ; mécanisme arrêté à l'implémentation (R3). |

---

## Règles de validation transverses (résumé pour les contrats Zod)

- `programme_id` requis sur une matière ; `code` non vide.
- `nb_uv >= 0`, `prix >= 0`.
- `date_fin >= date_debut` ; `inscription_fermee_le >= inscription_ouverte_le`.
- `capacite_max > 0` si fournie (sinon NULL = illimité).
- Prérequis : `professional_subject_id <> prerequisite_subject_id` ; même programme ; graphe acyclique.
- `prix_unitaire` figé à l'ajout au panier.
- `montant_total` = Σ `prix_unitaire` des inscriptions de la commande.
- `reference_transaction` unique par tenant.

## Volumétrie & performance

Volumétrie par tenant attendue : dizaines de matières, centaines de sessions, milliers d'inscriptions/an. Les index ci-dessus couvrent les accès critiques : catalogue par programme, sessions inscriptibles, comptage des inscriptions actives par session, commandes par étudiant. Objectif catalogue < 1 s (plan, *Performance Goals*).
