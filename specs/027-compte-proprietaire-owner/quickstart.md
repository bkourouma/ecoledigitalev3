# Quickstart: Espace Propriétaire (Owner)

**Date**: 2026-04-17

## Prérequis

- PostgreSQL avec migrations EcoleDigitale appliquées.
- API `apps/api` et web `apps/web` configurés comme d’habitude (`DATABASE_URL`, JWT, tenant de test).

## 1. Appliquer la migration du rôle

Fichiers livrés :

- `infra/scripts/migrations/0052_add_owner_role.sql`
- `infra/scripts/migrations/0053_owner_pilotage_alerts.sql`

1. Exécuter ces migrations sur la base de développement (outil ou script déjà utilisé par l’équipe).
2. Vérifier : `SELECT id, key, name FROM roles WHERE key = 'owner' AND tenant_id = '<uuid tenant test>';`

## 2. Attribuer le rôle à un utilisateur de test

1. Récupérer `role_id` du rôle `owner` pour le tenant :

```sql
SELECT id AS role_id FROM roles WHERE tenant_id = '<UUID_TENANT>' AND key = 'owner' LIMIT 1;
```

2. Lier l’utilisateur test (recommandé : compte **sans** rôle `admin` pour les tests 403 croisés) :

```sql
INSERT INTO user_roles (user_id, role_id)
VALUES ('<UUID_USER>', '<UUID_ROLE_OWNER>')
ON CONFLICT (user_id, role_id) DO NOTHING;
```

3. Se **reconnecter** (ou refresh token) pour que le JWT contienne `"owner"` dans `roles` (le middleware auth compare aussi `role_updated_at` vs `iat`).

## 3. Obtenir un JWT

Se connecter via le flux auth existant (login) avec ce compte ; vérifier dans le payload décodé que `roles` contient `"owner"`.

## 4. Appeler l’API

Exemples (adapter host et token) :

```http
GET /api/v1/owner/dashboard
X-Tenant: <slug ou identifiant attendu par le plugin tenant>
Authorization: Bearer <access_token>
```

Attendu : **200** avec corps conforme au contrat ; avec un token **admin** sans rôle owner : **403**.

## 5. Vérifier le front

1. Se connecter avec le compte owner.
2. Ouvrir **`/owner/dashboard`** (routes sous `apps/web/src/app/owner/` — préfixe `/owner` pour éviter le conflit avec `/dashboard` générique).
3. Confirmer : sidebar, KPIs, absence de formulaires de modification académique.
4. Se connecter avec un **parent** ou **enseignant** : ouvrir `/owner/dashboard` → redirection vers **`/unauthorized`**.

## 6. Checklist rapide sécurité

- [ ] Aucune route `/api/v1/owner/*` sans `requireOwner` (voir `apps/api/src/routes/owner/index.ts`, `preHandler` sur chaque handler).
- [ ] Comptes **admin / teacher / student / parent / formateur** sans rôle **owner** → **403** sur `GET /api/v1/owner/*` ; avec **owner** → **200** (tests Jest : `apps/api/src/__tests__/require-owner.test.ts`, `owner-routes.test.ts`).
- [ ] **PATCH** sensibles owner uniquement : acquittement alertes, validation paie enseignant, rôles utilisateurs — voir § 6.1. Les **GET** owner restent des lectures ; pas de mutation pédagogique (notes, cours, classes).
- [ ] **auth-middleware** : `PATCH` est traité comme opération sensible (`isSensitiveOperation`) ; alignement attendu : lectures **GET** avec token valide + tenant cohérent ; écritures **PATCH** avec les mêmes garde-fous + **requireOwner** sur le préfixe owner.
- [ ] Export CSV/PDF finances : pas de nom complet élève sur lignes impayés (référence anonymisée).
- [ ] Blacklist JWT : token révoqué → **401** avant d’atteindre `requireOwner`.

### 6.1 Inventaire des écritures `PATCH` sous `/api/v1/owner`

| Route | Rôle |
|-------|------|
| `PATCH .../alerts/:id/acknowledge` | Acquittement alerte pilotage |
| `PATCH .../payroll/:id/validate` | Approbation fiche paie (`calculated` → `approved`) |
| `PATCH .../users/:userId/roles` | Rôles gérables (hors `owner`) |

Aucun **POST/PUT/PATCH** sur ressources académiques (notes, devoirs, cours, classes) sous ce préfixe — test de surface : `apps/api/src/__tests__/owner-api-surface.test.ts`.
