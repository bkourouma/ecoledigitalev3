# @ecoledigitale/database

Accès aux données de la plateforme v2 : isolation multi-tenant **effective**
(RLS forcée + rôle non propriétaire), `TenantDb` / `SystemDb`, runner de
migrations à checksum, outbox transactionnelle, test d'isolation générique.

## Le défaut que ce design corrige

Dans la base historique la RLS « existait » mais n'isolait rien : l'API se
connectait avec un super-utilisateur ou avec le propriétaire des tables, qui
contournent les policies (le propriétaire sans `FORCE`, le superuser toujours).
L'isolation reposait sur des `WHERE tenant_id = $1` écrits à la main.

Ici, trois verrous indépendants :

1. l'application se connecte avec un rôle **membre de `app_user`** : ni
   propriétaire, ni superuser, ni `BYPASSRLS` ;
2. toute table de tenant passe par `kernel.enable_tenant_rls()` :
   `ENABLE` **+ `FORCE`** ROW LEVEL SECURITY, une unique policy `tenant_isolation`
   (`USING` et `WITH CHECK` sur `kernel.current_tenant_id()`), index sur `tenant_id` ;
3. **aucune échappatoire super-admin** dans les policies. Les opérations
   inter-tenants itèrent les tenants un par un (`SystemDb.forEachTenant`).

Échec fermé : sans `app.tenant_id` valide, aucune ligne n'est visible ni insérable.
La preuve exécutable est `test/rls-proof.integration.test.ts`.

> Limite incompressible : **un super-utilisateur Postgres contourne tout**, même
> `FORCE`. Ne jamais connecter l'API ni un job avec un superuser. `assertTenantIsolation`
> refuse d'ailleurs un pool superuser ou `BYPASSRLS`.

## Rôles

| Rôle | Attributs | Usage |
|---|---|---|
| `migrator` | `NOLOGIN NOBYPASSRLS`, propriétaire des objets | exécute les migrations (`SET ROLE`) |
| `app_user` | `NOLOGIN NOBYPASSRLS`, jamais propriétaire | API et jobs |

`0001_roles.sql` les crée de façon idempotente et **ne contient jamais de mot de
passe ni de `LOGIN`**. Les rôles de connexion se créent hors migrations, avec un
secret injecté :

```sql
CREATE ROLE api_login    LOGIN PASSWORD :'secret' IN ROLE app_user;
CREATE ROLE deploy_login LOGIN PASSWORD :'secret' IN ROLE migrator;
```

## TenantDb

```ts
import { Pool } from "pg";
import { TenantDb, SystemDb } from "@ecoledigitale/database";
import { createRequestContext } from "@ecoledigitale/kernel";

const pool = new Pool({ connectionString: process.env.DATABASE_URL }); // rôle api_login
const tenantDb = new TenantDb(pool, { statementTimeoutMs: 15_000 });

const ctx = createRequestContext({ tenantId, userId, roles: ["teacher"] });
const rows = await tenantDb.run(ctx, async (tx) => {
  await tx.query("INSERT INTO academic.classes (id, tenant_id, label) VALUES ($1,$2,$3)", [id, ctx.tenantId, "6e A"]);
  return tx.many("SELECT id, label FROM academic.classes ORDER BY label");
});
```

`run(ctx, fn, { readOnly? })` :

- ouvre une transaction et pose, **en portée transaction** (`set_config(..., true)`,
  équivalent `SET LOCAL`), `app.tenant_id`, `app.user_id`, `app.actor`,
  `app.request_id` — toujours en **paramètres** `$n`, jamais interpolés ;
- refuse un `tenantId` qui n'est pas un UUID, **avant** d'ouvrir une connexion ;
- `COMMIT`, ou `ROLLBACK` si `fn` lève (l'erreur d'origine est relancée telle quelle ;
  si le `ROLLBACK` échoue, la connexion est détruite) ;
- le client `tx` offre `query`, `queryOne` (lève si > 1 ligne), `many`,
  `transaction` (SAVEPOINT) ; il est inutilisable après la fin du `run` ;
- imbrication : un `run` du **même** contexte dans un `run` devient un savepoint ;
  un autre tenant / utilisateur / acteur est refusé (`TX_IDENTITY_SWITCH`) ;
- pendant `fn`, `getRequestContext()` renvoie `ctx`.

Ne pas lancer deux `tx.transaction` en parallèle sur le même `tx`.

## SystemDb (jobs)

```ts
const systemDb = new SystemDb(tenantDb, { logger });

await systemDb.run("purge-sessions-expirees", (tx) => ...);          // sans tenant : tables globales seulement
await systemDb.runForTenant("recalcul-moyennes", tenantId, (tx) => ...);
const report = await systemDb.forEachTenant("relais-outbox", (tx, tenant) => ...); // 1 transaction / tenant
```

- une **raison** obligatoire (5–200 caractères), journalisée au début et à la fin
  (durée, issue) et posée dans `app.reason` ;
- `app.actor = 'system'` ; **pas de repli silencieux en super-admin** : `run`
  n'a aucun tenant et voit les tables de tenant vides ;
- `forEachTenant` ne parcourt que les tenants `active`, rapporte les échecs
  (`report.failed`) sans arrêter les autres.

## Outbox transactionnelle

`kernel.domain_events` (tenant_id + RLS forcée). `PgOutboxWriter(tx).append(events)`
écrit dans la transaction de la donnée : validé ou annulé avec elle. Le contenu
est immuable pour l'application (`GRANT UPDATE` limité à `published_at`,
`attempts`, `last_error`, `available_at`). Aides pour le futur relais :
`fetchPendingEvents` (`FOR UPDATE SKIP LOCKED`), `markEventsPublished`,
`markEventFailed`. Le relais lit **par tenant** (`forEachTenant`).

## Migrations

Fichiers `NNNN_nom_en_minuscules.sql` (≥ 4 chiffres). Table `schema_migrations(version, name, checksum, applied_at)`.

```bash
pnpm --filter @ecoledigitale/database migrate -- --dir packages/database/migrations --url "$DATABASE_URL"
```

| Option | Rôle |
|---|---|
| `--dir <d>` | dossier(s) (répétable ; numéros globaux). Défaut `./migrations` |
| `--url <u>` | défaut : variable `DATABASE_URL` (jamais affichée en clair) |
| `--yes` | **obligatoire** si le nom de la base ne finit pas par `_test`, `_dev` ou `_local` |
| `--dry-run` | liste ce qui serait appliqué, n'écrit rien |
| `--role <r>` / `--no-role` | rôle d'exécution (`SET ROLE`), défaut `migrator` ; ignoré s'il n'existe pas encore (bootstrap) |
| `--allow-out-of-order` | accepte une migration numérotée avant l'historique |
| `--lock-timeout <ms>` | attente maximale du verrou (défaut 60 000) |

Garanties :

- **immuabilité** : le SHA-256 du contenu (BOM et CRLF normalisés) est comparé à chaque
  exécution ; un fichier appliqué modifié, **ou disparu**, fait échouer le run avant toute écriture ;
- **verrou advisory** de session : un seul runner à la fois, le second attend puis
  échoue proprement (`MIGRATION_LOCK_TIMEOUT`) ;
- **une transaction par fichier**, l'enregistrement dans la même transaction ;
  un `BEGIN`/`COMMIT` explicite est refusé ;
- `-- no-transaction` en tête de fichier (`CREATE INDEX CONCURRENTLY`…) : instructions
  exécutées une à une en autocommit ; le fichier doit alors être **idempotent** ;
- `up` seulement : on corrige par une nouvelle migration ;
- nommage strict : un `.sql` mal nommé ou un doublon de version est une erreur, jamais ignoré.

### Baseline v2 (`migrations/`)

| Fichier | Contenu |
|---|---|
| `0001_roles.sql` | rôles `migrator`, `app_user` (NOLOGIN, NOBYPASSRLS), droits sur la base |
| `0002_kernel.sql` | schéma `kernel`, `current_tenant_id()` (cast sûr), `current_user_id()`, `current_actor()`, `enable_tenant_rls()`, `kernel.tenants`, droits par défaut |
| `0003_outbox.sql` | `kernel.domain_events` + RLS |

Dans une migration de module :

```sql
CREATE TABLE academic.classes (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES kernel.tenants(id),
  ...
);
SELECT kernel.enable_tenant_rls('academic.classes');
GRANT SELECT, INSERT, UPDATE, DELETE ON academic.classes TO app_user;
```

## Test d'isolation générique (blocage CI)

```ts
await assertTenantIsolation({
  pool,                       // pool connecté en tant que rôle applicatif
  schemas: ["kernel", "academic"],
  allowlist: ["kernel.tenants"], // tables globales, une par une
});
```

1. **Structure** de chaque table : `tenant_id uuid NOT NULL`, RLS activée **et forcée**,
   policy `tenant_isolation` unique (permissive, `FOR ALL`, `USING`+`WITH CHECK` sans `OR`),
   index en tête sur `tenant_id`. Vues matérialisées et tables étrangères refusées hors liste blanche.
2. **Comportement** quand une ligne minimale est fabricable (FK parentes créées, enum,
   `varchar(n)`, tableaux…) : A insère ; B ne lit rien de A, ne peut ni modifier ni supprimer
   ses lignes, ne peut pas insérer au nom de A ; sans tenant ou avec un tenant mal formé on ne
   voit rien. Sinon la table est rapportée en **« structure seule »** avec la raison
   (`report.structuralOnly`) — jamais déclarée testée.

Tout s'exécute dans une transaction annulée. `checkTenantIsolation` renvoie le rapport sans lever.

## Tests

```bash
pnpm --filter @ecoledigitale/database test               # unitaires ; l'intégration est ignorée avec un message
pnpm --filter @ecoledigitale/database test:integration   # Postgres 17 jetable dans Docker
```

`test:integration` (`scripts/with-postgres.mjs`) démarre un conteneur nommé
`ed-pg-it-<aléa>` sur un port libre de 127.0.0.1, avec un mot de passe aléatoire,
lance vitest avec `TEST_DATABASE_URL`, puis supprime le conteneur.
Pour viser une autre instance : `TEST_DATABASE_URL=postgres://… pnpm --filter @ecoledigitale/database test`
(l'utilisateur doit pouvoir `CREATE DATABASE` et `CREATE ROLE` ; **instance jetable uniquement** :
chaque fichier de test crée puis supprime sa propre base `ed_it_*_test` et ses rôles de test).
