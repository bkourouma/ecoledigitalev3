# Phase 1 — Quickstart: Diplômes Professionnels

**Feature**: 029-professional-diplomas | **Date**: 2026-05-22

Guide de mise en route et de validation manuelle de la feature, à destination de l'agent qui implémentera et du relecteur humain.

## Prérequis

- Monorepo installé : `pnpm install` à la racine.
- PostgreSQL accessible ; `DATABASE_URL` (ou variables `DB_*`) configurées dans `apps/api/.env`.
- Le **Module Professionnel `028`** est déployé : migrations `0061`–`0063` appliquées, données de test `028` disponibles (au moins un programme, des matières professionnelles avec `nb_uv`, des sessions, des inscriptions menées jusqu'à `terminee`).

## 1. Appliquer la migration

```powershell
# Option A — psql direct
psql "$env:DATABASE_URL" -f infra/scripts/migrations/0064_professional_diplomas.sql

# Option B — runner Node dédié (calqué sur scripts/apply-migration-*.js)
node scripts/apply-migration-0064-professional-diplomas.js
```

La migration est idempotente : la rejouer ne produit aucune erreur ni perte de données. Elle s'applique sur une base contenant déjà les données `028` sans les altérer.

**Vérification** :
```sql
SELECT table_name FROM information_schema.tables
WHERE table_name LIKE 'professional_diploma%'
   OR table_name = 'student_professional_diplomas'
ORDER BY 1;
-- attendu : professional_diplomas, professional_diploma_requirements,
--           student_professional_diplomas

SELECT tablename, rowsecurity FROM pg_tables
WHERE tablename IN ('professional_diplomas','professional_diploma_requirements','student_professional_diplomas');
-- attendu : rowsecurity = true pour les 3 tables
```

## 2. Lancer l'application

```powershell
pnpm dev            # API (port 8011) + web (port 3000)
# ou séparément :
pnpm --filter @ecoledigitale/api dev
pnpm --filter @ecoledigitale/web dev
```

## 3. Parcours de validation (smoke test)

En-têtes communs : `Authorization: Bearer <jwt>`, `X-Tenant: <slug>`, `Content-Type: application/json`. Préfixe omis : `/api/v1/professional`.

### 3a. Côté admin — définir un diplôme

1. `POST /diplomas` — `{ programme_id, code:"DIP-CAP", libelle:"CAP Professionnel", uv_required: 7 }` → `201`, statut `actif`.
2. `POST /diplomas` à nouveau avec `code:"DIP-CAP"` → **rejet `DUPLICATE_DIPLOMA_CODE`** (409).
3. `POST /diplomas` avec `uv_required: 0` → **rejet `VALIDATION_ERROR`** (422).
4. `PUT /diplomas/{id}/requirements` — body :
   ```json
   { "requirements": [
     { "subject_id": "{matiereA}", "est_obligatoire": true,  "ordre": 0 },
     { "subject_id": "{matiereB}", "est_obligatoire": false, "ordre": 1 }
   ] }
   ```
   (matières A et B du **même programme** que le diplôme) → `200`.
5. `PUT /diplomas/{id}/requirements` avec une matière d'un **autre programme** → **rejet `CROSS_PROGRAMME_REQUIREMENT`** (422).
6. `GET /diplomas/{id}` → détail avec `requirements`, `uv_total_atteignable`, `nb_diplomes_octroyes: 0`.

### 3b. Octroi automatique à l'achèvement

7. Choisir un étudiant `E` qui, une fois la matière A terminée, satisfera le diplôme (matière obligatoire A terminée + cumul d'UV ≥ 7).
8. `POST /enrollments/{enrollmentA}/complete` (rôle admin) → inscription A `terminee`.
9. `GET /diplomas/{id}/awarded` → l'étudiant `E` apparaît au statut `obtenu`, `octroye_par: null` (octroi automatique), `reference` au format `DIP-2026-NNNNNN`, `requirements_snapshot` non nul.
10. `POST /enrollments/{enrollmentB}/complete` (matière B de `E`) → recalcul rejoué → **aucun second octroi** (`GET /diplomas/{id}/awarded` montre toujours une seule ligne pour `E`).

### 3c. Éligibilité refusée — matière obligatoire manquante

11. Pour un étudiant `F` ayant terminé seulement la matière non obligatoire B (cumul d'UV ≥ 7 mais A obligatoire non terminée), `POST /enrollments/{enrollmentB_F}/complete` → **aucun octroi** (la matière obligatoire A manque).
12. `GET /student/diplomas/{id}/progress` (en tant que `F`) → `eligible: false`, `matieres_obligatoires_manquantes` contient A.

### 3d. Octroi & révocation manuels

13. `POST /diplomas/{id}/award` `{ "student_id": "{F}" }` → **rejet `DIPLOMA_NOT_ELIGIBLE`** (422, `F` non éligible, pas de `force`).
14. `POST /diplomas/{id}/award` `{ "student_id": "{F}", "force": true }` → `201`, octroi forcé, `octroye_par` = admin.
15. `POST /diplomas/{id}/award` `{ "student_id": "{E}" }` → **rejet `DIPLOMA_ALREADY_AWARDED`** (409, `E` déjà titulaire).
16. `POST /diplomas/{id}/revoke` `{ "student_id": "{F}" }` (sans `motif`) → **rejet `VALIDATION_ERROR`** (422).
17. `POST /diplomas/{id}/revoke` `{ "student_id": "{F}", "motif": "Erreur de saisie" }` → `200`, statut `revoque`, `date_revocation`/`motif_revocation`/`revoque_par` renseignés.
18. `POST /diplomas/{id}/award` `{ "student_id": "{F}", "force": true }` → `201` — un nouvel octroi est de nouveau possible après révocation.

### 3e. Suppression protégée

19. `DELETE /diplomas/{id}` → **rejet `DIPLOMA_HAS_AWARDS`** (409, octrois non révoqués existants).
20. Sur un diplôme **sans aucun octroi** : `DELETE /diplomas/{autreId}` → `204`, ses exigences sont supprimées en cascade.

### 3f. Snapshot stable

21. Noter le `requirements_snapshot` de l'octroi de `E` (étape 9). `PUT /diplomas/{id}/requirements` avec une liste différente, puis `PATCH /diplomas/{id}` `{ "uv_required": 99 }`.
22. `GET /diplomas/{id}/awarded` → l'octroi de `E` conserve son `requirements_snapshot` et `uv_total_validees` d'origine, statut toujours `obtenu` (aucune révocation automatique).

### 3g. Recompute de masse

23. `POST /diplomas/{id}/recompute` → `{ "awarded": N }` (octrois manquants créés).
24. Rejouer `POST /diplomas/{id}/recompute` → `{ "awarded": 0 }` (idempotent).

### 3h. Étudiant & parent

25. `GET /student/diplomas` (en tant que `E`) → le diplôme apparaît avec `pourcentage: 100`, `statut_octroi: "obtenu"`.
26. `GET /student/diplomas/{id}/attestation` (en tant que `E`) → données structurées de l'attestation.
27. `GET /student/diplomas/{id}/attestation` (en tant que `F` après révocation, sans octroi actif) → **rejet `DIPLOMA_NOT_AWARDED`** (404).
28. `GET /parent/diplomas?child_id={E}` (en tant que parent de `E`) → liste en lecture seule.
29. `GET /parent/diplomas?child_id={E}` (en tant que parent **non** rattaché à `E`) → **rejet `FORBIDDEN`** (403).

### 3i. Cloisonnement rôle & tenant

30. Appeler n'importe quel endpoint `/diplomas/*` avec un JWT de rôle `teacher` → **rejet `FORBIDDEN`** (403).
31. Avec un `X-Tenant` d'un autre établissement, `GET /diplomas/{id}` → `DIPLOMA_NOT_FOUND` (RLS — aucune fuite inter-tenant).

## 4. Vérifications de non-régression

- Le parcours `028` complet (catalogue → panier → commande → paiement → `complete`) répond comme avant.
- `POST /enrollments/{id}/complete` renvoie toujours l'inscription `terminee` **même si** le recalcul de diplômes échoue (le recalcul est best-effort, hors transaction — research R5, FR-020).
- Aucune table `028` ni académique n'a été modifiée par la migration `0064`.
- Les routes `028` (`/subjects`, `/sessions`, `/student/catalog`, `/student/cart`, …) sont inchangées.

## 5. Tests automatisés

```powershell
pnpm --filter @ecoledigitale/api exec jest professional
```

Couverture attendue (`apps/api/src/services/__tests__/professional-diplomas.service.test.ts`, ≥ 30 tests) : validation Zod (code requis, `uv_required > 0`, motif de révocation requis), refus d'exigence cross-programme, refus de suppression avec octrois, calcul d'éligibilité (cumul d'UV, matière obligatoire manquante, matière comptée une fois), octroi automatique sur transition `terminee`, absence de doublon d'octroi, octroi manuel sans/avec `force`, révocation puis nouvel octroi, présence du snapshot, stabilité du snapshot après modification du diplôme, recompute de masse idempotent.

Cible globale : `jest professional` ≥ **100 tests verts** (72 existants de `028` + nouveaux).

## 6. Critères de sortie

La feature est prête pour la revue quand les 31 étapes du §3 passent, les 11 critères de succès `SC-001`–`SC-011` de `spec.md` sont vérifiés, les vérifications de non-régression du §4 sont OK, et `jest professional` est 100 % vert.
