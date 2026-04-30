# Data Model: Espace Propriétaire (Owner)

**Date**: 2026-04-17 | **Spec**: [spec.md](./spec.md)

## 1. Rôle applicatif (existant + extension)

### `roles` (existant)

| Champ | Type | Notes |
|-------|------|--------|
| `id` | UUID | PK |
| `tenant_id` | UUID | FK → `tenants` |
| `key` | varchar(50) | **Nouvelle valeur** : `owner` |
| `name` | varchar(255) | Libellé UI, ex. « Propriétaire » |
| `created_at` / `updated_at` | timestamptz | |

**Contrainte**: `UNIQUE(tenant_id, key)` — migration idempotente avec `ON CONFLICT DO NOTHING` ou `WHERE NOT EXISTS`.

### `user_roles` (existant)

| Relation | Description |
|----------|-------------|
| `user_id` | Utilisateur du tenant |
| `role_id` | Référence vers `roles.id` où `key = 'owner'` |

**Règle métier**: Un petit nombre de comptes owner par tenant (souvent 1) — enforcement applicative optionnelle (pas obligatoire en DB sauc decision produit).

---

## 2. Données lues (agrégations — tables existantes)

Aucun nouveau schéma obligatoire pour les **lectures** si les agrégats sont calculés en requête. Tables typiques (à confirmer par migration au moment du dev) :

| Domaine | Tables / objets |
|---------|-----------------|
| Finances | `student_payments`, `tuition_schedules`, `payment_periods`, `enrollments`, `cycles` |
| Rémunérations | `teacher_payments`, `teaching_hours`, `payment_hour_details`, `payment_audit_log` |
| Académique | `semester_averages`, `classes`, `assignment_submissions`, tables présences / `attendance_*` |
| Formations pro | modules `formations` / `sessions` / inscriptions selon tenant (cf. `usesSessionBasedProfessionalTraining`) |
| Utilisateurs | `users`, `user_roles`, `roles` |

Toutes les requêtes **filtrent** `tenant_id = current tenant context` (RLS + paramètres explicites dans le code API).

---

## 3. Nouvelle entité optionnelle : alertes pilotage

### `owner_pilotage_alerts` (proposé)

| Champ | Type | Règles |
|-------|------|--------|
| `id` | UUID | PK |
| `tenant_id` | UUID | NOT NULL, FK tenants, RLS |
| `severity` | enum / texte contraint | `high` \| `medium` \| `low` |
| `message` | text | NOT NULL |
| `domain` | varchar | ex. `finances`, `academic`, `staff` |
| `created_at` | timestamptz | défaut now() |
| `acknowledged_at` | timestamptz | NULL si en attente |
| `acknowledged_by_user_id` | UUID NULL | FK `users` |

**Transitions**:

- Création : système (job) ou endpoint interne / calcul à l’affichage + upsert.
- Acquittement : `acknowledged_at` et `acknowledged_by_user_id` renseignés ; pas de suppression métier obligatoire.

**Index**: `(tenant_id, acknowledged_at)`, `(tenant_id, severity, created_at DESC)`.

---

## 4. Validation rémunération (existant)

### `teacher_payments`

Champs pertinents : `status`, `approved_by`, `approved_at`, `paid_at`, `tenant_id`, `teacher_id`.

**Transition owner** (à caler sur l’enum `payment_status` réel) : depuis un état « en attente validation propriétaire » ou équivalent métier, vers état approuvé + `approved_by` / `approved_at` + entrée `payment_audit_log`.

---

## 5. Exports

Pas de table dédiée obligatoire ; fichiers générés à la volée. Métadonnées optionnelles futures : table `export_jobs` — **hors scope** sauf besoin async.

---

## 6. Validation rules (rappel spec)

- Owner **ne modifie pas** tables notes, devoirs, cours, inscriptions (pas d’INSERT/UPDATE via routes owner).
- Owner **peut** UPDATE limité : `owner_pilotage_alerts` (acquittement), `teacher_payments` / workflow paie, `user_roles` (dans bornes métier), et exports en lecture seule côté données sources.
