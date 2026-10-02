// Harnais de test du DDL de référence de specs/v2/006-secondary/data-model.md.
//
// - Postgres : TEST_DATABASE_URL (superutilisateur d'un serveur jetable) ou, à défaut, `run.mjs` lance un conteneur
//   éphémère (ED_PG_IMAGE, défaut postgres:17-alpine) et l'exporte.
// - Chaque fichier de test crée SA base (rôles migrator / app_user globaux, convergés par 0001_roles.sql).
// - Les migrations sont EXTRAITES de data-model.md (blocs `<!-- migration: NNNN_nom.sql -->` + ```sql) : le document est la
//   source de vérité, aucune copie. `DDL_DIR` (développement) lit des fichiers .sql à la place.
// - Les tests s'exécutent sous le rôle `app_user` (NOBYPASSRLS, non propriétaire), comme l'API.
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
export const { Client } = require("pg");

const here = dirname(fileURLToPath(import.meta.url));
const specDir = resolve(here, "..");
const repoRoot = resolve(here, "..", "..", "..", "..");

export function adminUrl() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL absente : lancez `node specs/v2/006-secondary/ddl-test/run.mjs`.");
  return url;
}

function withDatabase(url, name) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

/** Blocs de migration d'un fichier Markdown : [{ name, sql }] dans l'ordre du document. */
export function extractMigrations(mdPath) {
  const md = readFileSync(mdPath, "utf8").replace(/\r\n/g, "\n"); // tolère les fins de ligne CRLF d'un dépôt Windows
  const out = [];
  const re = /<!--\s*migration:\s*([A-Za-z0-9_.-]+\.sql)\s*-->\s*```sql\n([\s\S]*?)\n```/g;
  let m;
  while ((m = re.exec(md)) !== null) out.push({ name: m[1], sql: m[2] });
  return out;
}

function loadMigrationsFor(prefixes) {
  const dir = process.env.DDL_DIR;
  let all;
  if (dir) {
    all = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => ({ name: f, sql: readFileSync(join(dir, f), "utf8") }));
  } else {
    all = extractMigrations(join(specDir, "data-model.md"));
  }
  return all.filter((mig) => prefixes.some((p) => mig.name.startsWith(p)));
}

/** Baseline de la plateforme (rôles, kernel, outbox) : fichiers RÉELS de packages/database/migrations. */
function kernelMigrations() {
  const dir = join(repoRoot, "packages", "database", "migrations");
  return readdirSync(dir)
    .filter((f) => /^000[1-3]_.*\.sql$/.test(f))
    .sort()
    .map((f) => ({ name: f, sql: readFileSync(join(dir, f), "utf8") }));
}

/**
 * Crée une base dédiée, applique la baseline puis les migrations dont le nom commence par un des préfixes.
 * Les migrations s'exécutent sous `SET ROLE migrator` (sauf 0001, directive `-- no-role`).
 * Retourne { url, admin, close }.
 */
export async function createDatabase(label, prefixes) {
  const base = adminUrl();
  const dbName = `ed_006_${label}_${randomBytes(3).toString("hex")}`;
  const admin = new Client({ connectionString: base });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = withDatabase(base, dbName);
  const db = new Client({ connectionString: url });
  await db.connect();
  const close = async () => {
    await db.end().catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  };
  try {
    for (const mig of [...kernelMigrations(), ...loadMigrationsFor(prefixes)]) {
      const noRole = /^--\s*no-role/m.test(mig.sql);
      try {
        await db.query("BEGIN");
        if (!noRole) await db.query("SET LOCAL ROLE migrator");
        await db.query(mig.sql);
        await db.query("COMMIT");
      } catch (e) {
        await db.query("ROLLBACK").catch(() => undefined);
        throw new Error(`Migration ${mig.name} en échec : ${e.message}${e.position ? ` (position ${e.position})` : ""}`);
      }
    }
  } catch (e) {
    await close(); // jamais de connexion orpheline : un échec de migration ne doit pas bloquer le processus de test
    throw e;
  }
  return { url, db, close };
}

export const uuid = () => randomUUID();

/**
 * Contrôle STRUCTUREL d'isolation d'un schéma, identique à celui du test générique de la plateforme
 * (`assertTenantIsolation`) : `tenant_id uuid NOT NULL`, RLS activée ET forcée, policy `tenant_isolation` UNIQUE,
 * index dont la 1re colonne est `tenant_id`, droit SELECT pour `app_user`. Retourne les tables en infraction.
 */
export async function structuralIsolationViolations(db, schema) {
  const { rows } = await db.query(
    `SELECT c.relname AS table_name,
            c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
            (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
            (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation') AS own_policy,
            EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND a.attnotnull AND a.atttypid = 'uuid'::regtype AND NOT a.attisdropped) AS has_tenant_id,
            EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisvalid AND i.indpred IS NULL
                      AND i.indkey[0] = (SELECT attnum FROM pg_attribute WHERE attrelid = c.oid AND attname = 'tenant_id')) AS has_tenant_index,
            has_table_privilege('app_user', c.oid, 'SELECT') AS app_can_select
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'p')
      ORDER BY c.relname`,
    [schema],
  );
  const problems = [];
  for (const r of rows) {
    if (!r.has_tenant_id) problems.push(`${schema}.${r.table_name} : tenant_id uuid NOT NULL absent`);
    if (!r.rls || !r.forced) problems.push(`${schema}.${r.table_name} : RLS non forcée`);
    if (r.policies !== 1 || r.own_policy !== 1) problems.push(`${schema}.${r.table_name} : la policy tenant_isolation doit être la seule`);
    if (!r.has_tenant_index) problems.push(`${schema}.${r.table_name} : aucun index en tête sur tenant_id`);
    if (!r.app_can_select) problems.push(`${schema}.${r.table_name} : app_user sans SELECT`);
  }
  return { tables: rows.map((r) => r.table_name), problems };
}

/** Crée un tenant (table globale kernel.tenants). */
export async function newTenant(db, slug) {
  const id = uuid();
  await db.query("INSERT INTO kernel.tenants (id, slug, name) VALUES ($1, $2, $3)", [id, `${slug}-${id.slice(0, 6)}`, `Tenant ${slug}`]);
  return id;
}

/**
 * Exécute `fn(tx)` dans une transaction sous `app_user`, avec le contexte posé comme TenantDb
 * (app.tenant_id, app.user_id, app.actor). `commit: true` valide ; sinon ROLLBACK (isolation entre tests).
 * `tx.q(sql, params)` renvoie les lignes ; `tx.fail(sql, params, pattern)` attend une erreur dont le message
 * correspond (sous SAVEPOINT : la transaction reste utilisable) ; `tx.as({ userId, actor })` change l'identité
 * de session au milieu du scénario (comme deux requêtes successives d'une même transaction de test).
 */
export async function inTenant(db, ctx, fn, { commit = false } = {}) {
  const state = { tenantId: ctx.tenantId, userId: ctx.userId ?? "", actor: ctx.actor ?? "user" };
  const apply = async () => {
    await db.query("SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true), set_config('app.actor', $3, true)", [
      state.tenantId,
      state.userId,
      state.actor,
    ]);
  };
  await db.query("BEGIN");
  try {
    await db.query("SET LOCAL ROLE app_user");
    await apply();
    let sp = 0;
    const tx = {
      tenantId: state.tenantId,
      async q(sql, params = []) {
        const r = await db.query(sql, params);
        return r.rows;
      },
      async one(sql, params = []) {
        const r = await db.query(sql, params);
        if (r.rows.length !== 1) throw new Error(`Une ligne attendue, ${r.rows.length} reçue(s) pour : ${sql}`);
        return r.rows[0];
      },
      async fail(sql, params, pattern) {
        const name = `sp_${++sp}`;
        await db.query(`SAVEPOINT ${name}`);
        try {
          await db.query(sql, params);
        } catch (e) {
          await db.query(`ROLLBACK TO SAVEPOINT ${name}`);
          const text = `${e.code ?? ""} ${e.message}`;
          if (pattern && !(pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern))) {
            throw new Error(`Erreur inattendue : ${text} (attendu : ${pattern})`);
          }
          return e;
        }
        await db.query(`ROLLBACK TO SAVEPOINT ${name}`);
        throw new Error(`Une erreur était attendue pour : ${sql}`);
      },
      /** Comme `fail` mais pour une fonction asynchrone (plusieurs requêtes) : sous SAVEPOINT, erreur attendue. */
      async attempt(fn, pattern) {
        const name = `sp_${++sp}`;
        await db.query(`SAVEPOINT ${name}`);
        try {
          await fn();
        } catch (e) {
          await db.query(`ROLLBACK TO SAVEPOINT ${name}`);
          const text = `${e.code ?? ""} ${e.message}`;
          if (pattern && !(pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern))) {
            throw new Error(`Erreur inattendue : ${text} (attendu : ${pattern})`);
          }
          return e;
        }
        await db.query(`ROLLBACK TO SAVEPOINT ${name}`);
        throw new Error("Une erreur était attendue.");
      },
      async as(next) {
        if (next.userId !== undefined) state.userId = next.userId ?? "";
        if (next.actor !== undefined) state.actor = next.actor;
        await apply();
      },
    };
    const result = await fn(tx);
    await db.query(commit ? "COMMIT" : "ROLLBACK");
    return result;
  } catch (e) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw e;
  }
}

/** Insère une ligne et retourne son id ; `cols` : { colonne: valeur }. */
export async function insert(tx, table, cols) {
  const keys = Object.keys(cols);
  const vals = keys.map((k) => cols[k]);
  const ph = keys.map((_, i) => `$${i + 1}`);
  const rows = await tx.q(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${ph.join(", ")}) RETURNING id`, vals);
  return rows[0]?.id;
}
