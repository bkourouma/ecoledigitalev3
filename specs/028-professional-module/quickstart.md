# Phase 1 — Quickstart: Module Professionnel

**Feature**: 028-professional-module | **Date**: 2026-05-20

Guide de mise en route et de validation manuelle du module, à destination de l'agent qui implémentera et du relecteur humain.

## Prérequis

- Monorepo installé : `pnpm install` à la racine.
- PostgreSQL accessible ; `DATABASE_URL` (ou les variables `DB_*`) configurées dans `apps/api/.env`.
- Les migrations existantes jusqu'à `0060_registration_requests.sql` appliquées (voir mémoire projet : 0060 reste à appliquer).

## 1. Appliquer la migration

```powershell
# Option A — psql direct
psql "$env:DATABASE_URL" -f infra/scripts/migrations/0061_professional_module.sql

# Option B — runner Node dédié (calqué sur scripts/apply-migration-0055-*.js)
node scripts/apply-migration-0061-professional-module.js
```

La migration est idempotente : la rejouer ne produit aucune erreur ni aucune perte de données.

**Vérification** :
```sql
SELECT table_name FROM information_schema.tables
WHERE table_name LIKE 'professional_%' ORDER BY 1;
-- attendu : professional_subjects, professional_subject_prerequisites,
--           professional_subject_sessions, professional_orders,
--           professional_enrollments, professional_payments

SELECT tablename, rowsecurity FROM pg_tables
WHERE tablename LIKE 'professional_%';
-- attendu : rowsecurity = true pour les 6 tables
```

## 2. Lancer l'application

```powershell
pnpm dev            # API (port 8011) + web (port 3000)
# ou séparément :
pnpm --filter @ecoledigitale/api dev
pnpm --filter @ecoledigitale/web dev
```

## 3. Parcours de validation (smoke test)

En-têtes communs : `Authorization: Bearer <jwt>`, `X-Tenant: <slug>`, `Content-Type: application/json`.

### 3a. Côté admin — constituer le catalogue

1. `POST /api/v1/professional/subjects` — créer la matière A (`programme_id` d'un programme existant, `code:"PRO-A"`, `prix:50000`, `nb_uv:3`).
2. `POST /api/v1/professional/subjects` — créer la matière B (même programme, `code:"PRO-B"`).
3. `PUT /api/v1/professional/subjects/{B}/prerequisites` — body `{ "prerequisite_subject_ids": ["{A}"] }`.
4. `POST /api/v1/professional/subjects/{A}/sessions` — session ouverte, fenêtre d'inscription incluant la date courante, `capacite_max: 2`.
5. `POST /api/v1/professional/subjects/{B}/sessions` — idem pour B.
6. `POST /api/v1/professional/sessions/{sessionA}/status` — `{ "statut": "ouvert" }` (idem `sessionB`).

### 3b. Côté étudiant — inscription à la carte

7. `GET /api/v1/professional/student/programmes` → le programme apparaît (≥ 1 matière inscriptible).
8. `GET /api/v1/professional/student/catalog?programme_id={prog}` → A `inscriptible`, B `verrouille:true` avec A en prérequis manquant.
9. `POST /api/v1/professional/student/cart/items` `{ "session_id": "{sessionB}" }` → **rejet `PREREQUISITE_NOT_MET`**.
10. `POST /api/v1/professional/student/cart/items` `{ "session_id": "{sessionA}" }` → ajout OK.
11. `GET /api/v1/professional/student/cart` → `montant_total = 50000`.
12. `POST /api/v1/professional/student/orders` → commande `en_attente_paiement`.
13. `POST /api/v1/professional/student/orders/{order}/payment` `{ "mode":"mobile_money","reference_transaction":"TX-001" }` → commande `payee`, inscription A `confirmee`.
14. Rejouer l'étape 13 à l'identique → **même paiement renvoyé, aucun doublon** (idempotence).

### 3c. Prérequis débloqué

15. `POST /api/v1/professional/enrollments/{enrollmentA}/complete` → inscription A `terminee`.
16. `GET /api/v1/professional/student/catalog?programme_id={prog}` → B devient `inscriptible`.

### 3d. Capacité

17. Inscrire 2 étudiants distincts sur `sessionA` (capacité 2) → la 3ᵉ tentative renvoie **`SESSION_FULL`** ; `GET /sessions/{sessionA}` montre `statut:"complet"`.

## 4. Vérifications de non-régression

- `GET /api/v1/formations-pro` et les routes `/sessions-pro`, `/inscriptions-pro`, `/paiements-pro` répondent comme avant.
- Le module académique classique (`/api/v1/student-enrollments`, paiements `payment_transactions`) est inchangé.
- Aucune table existante n'a été modifiée par la migration `0061`.

## 5. Tests automatisés

```powershell
pnpm --filter @ecoledigitale/api test    # Jest — apps/api/src/__tests__/professional-*.test.ts
```

Couverture attendue (P1/P2) : éligibilité serveur, logique ET des prérequis, détection de cycle, prix figé, total de commande, bascule de statut au paiement, idempotence, capacité/`complet`, unicité d'inscription active, isolation multi-tenant.

## 6. Critères de sortie

Le module est prêt pour la revue quand les 17 étapes du §3 passent, les 15 critères d'acceptation de `spec.md` (§11 du document de référence) sont vérifiés, et les vérifications de non-régression du §4 sont OK.
