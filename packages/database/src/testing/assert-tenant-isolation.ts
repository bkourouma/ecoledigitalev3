/**
 * Test d'isolation générique (plan §3.4 / §7) : à brancher en BLOCAGE CI.
 *
 *   await assertTenantIsolation({
 *     pool,                         // pool connecté avec le rôle APPLICATIF (app_user)
 *     schemas: ["kernel", "academic"],
 *     allowlist: ["kernel.tenants"], // tables globales, nommées une à une
 *   });
 *
 * 1. CONTRÔLE STRUCTUREL de chaque table des schémas (hors liste blanche) :
 *    colonne `tenant_id uuid NOT NULL`, RLS activée ET forcée, policy
 *    `tenant_isolation` unique (permissive, FOR ALL, USING + WITH CHECK sur
 *    `kernel.current_tenant_id()`), index dont la 1re colonne est `tenant_id`.
 *    Les vues sont ignorées (elles s'exécutent sous la RLS des tables) ; les
 *    vues matérialisées et tables étrangères, non protégeables, sont refusées
 *    hors liste blanche.
 * 2. CONTRÔLE COMPORTEMENTAL, table par table, quand une ligne minimale peut
 *    être fabriquée : insère en tant que tenant A puis, en tant que B, vérifie
 *    qu'on ne lit rien de A, qu'UPDATE/DELETE ne touchent rien, qu'un INSERT
 *    portant le tenant de A est refusé par la RLS ; sans tenant ou avec un
 *    tenant mal formé, on ne voit rien. Si aucune ligne valide n'est
 *    fabricable (FK composite, CHECK complexe, type exotique, droits), la table
 *    est RAPPORTÉE « structure seule » avec la raison : jamais déclarée testée.
 *
 * Tout se passe dans UNE transaction annulée à la fin : aucune donnée ne subsiste.
 * Le pool DOIT utiliser un rôle ni superuser ni BYPASSRLS, sinon le test serait
 * sans valeur : il échoue immédiatement dans ce cas.
 */
import { newId } from "@ecoledigitale/kernel";
import { isRlsViolation, pgErrorCode } from "../pg-errors";
import type { PgPoolLike, PoolClientLike } from "../types";

export type Fixtures = Record<string, Record<string, unknown>>;

export interface TenantIsolationOptions {
  pool: PgPoolLike;
  /** Schémas à auditer (ex. `["kernel", "academic"]`). */
  schemas: readonly string[];
  /** Tables autorisées à ne PAS être des tables de tenant, au format `schema.table`. */
  allowlist?: readonly string[];
  /**
   * Valeurs imposées pour fabriquer une ligne, par table `schema.table` puis par
   * colonne (valeur, ou fonction `(n) => valeur` appelée à chaque insertion).
   * À fournir pour les colonnes sous CHECK/format que le générateur ne peut pas
   * deviner ; sans cela la table est rapportée « structure seule ».
   * `tenant_id` et les clés étrangères restent gérés automatiquement.
   */
  fixtures?: Fixtures;
  /** Table des tenants pour fabriquer A et B (défaut `kernel.tenants`). Doit accepter (id, slug, name). */
  tenantsTable?: string;
}

export interface Violation {
  table: string;
  problem: string;
}

export interface TenantIsolationReport {
  role: string;
  /** Tables vérifiées structurellement ET comportementalement. */
  behavioural: string[];
  /** Tables vérifiées structurellement seulement, avec la raison. */
  structuralOnly: Array<{ table: string; reason: string }>;
  allowlisted: string[];
  /** Entrées de liste blanche ne correspondant à aucune table (liste périmée). */
  staleAllowlist: string[];
  violations: Violation[];
}

export class TenantIsolationError extends Error {
  readonly report: TenantIsolationReport;
  constructor(report: TenantIsolationReport) {
    super(
      `Isolation multi-tenant violée (${report.violations.length}) :\n` +
        report.violations.map((v) => `  - ${v.table} : ${v.problem}`).join("\n"),
    );
    this.name = "TenantIsolationError";
    this.report = report;
  }
}

interface TableInfo {
  oid: number;
  schema: string;
  name: string;
  relkind: string;
  rls: boolean;
  forced: boolean;
  qualified: string;
}

interface ColumnInfo {
  attnum: number;
  name: string;
  typname: string;
  typoid: number;
  /** `regtype::text` : nom qualifié correct pour un cast, ex. `good.mood`, `text[]`. */
  fulltype: string;
  typtype: string;
  basetype: string | null;
  typmod: number;
  notnull: boolean;
  hasdefault: boolean;
  generated: boolean;
  identity: boolean;
}

interface FkInfo {
  columns: number[];
  refTable: string;
  refColumns: number[];
  refOid: number;
}

const q = (ident: string): string => `"${ident.replace(/"/g, '""')}"`;
const qt = (t: { schema: string; name: string }): string => `${q(t.schema)}.${q(t.name)}`;

export async function checkTenantIsolation(options: TenantIsolationOptions): Promise<TenantIsolationReport> {
  const allowlist = new Set(options.allowlist ?? []);
  const tenantsTable = options.tenantsTable ?? "kernel.tenants";
  const client = await options.pool.connect();
  const report: TenantIsolationReport = {
    role: "",
    behavioural: [],
    structuralOnly: [],
    allowlisted: [],
    staleAllowlist: [],
    violations: [],
  };

  try {
    // 0. Le rôle de test doit être soumis à la RLS, sinon tout est sans valeur.
    const me = (
      await client.query(
        `SELECT current_user AS role, r.rolsuper, r.rolbypassrls
           FROM pg_roles r WHERE r.rolname = current_user`,
      )
    ).rows[0];
    report.role = me.role;
    if (me.rolsuper || me.rolbypassrls) {
      throw new Error(
        `assertTenantIsolation : le rôle "${me.role}" est ${me.rolsuper ? "SUPERUSER" : "BYPASSRLS"} — ` +
          "il contourne la RLS, le test n'aurait aucune valeur. Connectez le pool avec un rôle membre de app_user.",
      );
    }

    // 1. Inventaire des tables.
    const tables = (
      await client.query(
        `SELECT c.oid::int AS oid, n.nspname AS schema, c.relname AS name, c.relkind,
                c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = ANY($1::text[]) AND c.relkind IN ('r','p','m','f')
          ORDER BY n.nspname, c.relname`,
        [options.schemas],
      )
    ).rows.map((r): TableInfo => ({ ...r, qualified: `${r.schema}.${r.name}` }));

    const seen = new Set(tables.map((t) => t.qualified));
    report.staleAllowlist = [...allowlist].filter((a) => !seen.has(a));

    const toCheck: TableInfo[] = [];
    for (const t of tables) {
      if (allowlist.has(t.qualified)) {
        report.allowlisted.push(t.qualified);
        continue;
      }
      if (t.relkind === "m" || t.relkind === "f") {
        report.violations.push({
          table: t.qualified,
          problem: `${t.relkind === "m" ? "vue matérialisée" : "table étrangère"} : la RLS ne s'y applique pas (liste blanche ou refonte requise)`,
        });
        continue;
      }
      toCheck.push(t);
    }

    // 2. Contrôle structurel.
    const structurallyOk: TableInfo[] = [];
    for (const t of toCheck) {
      const before = report.violations.length;
      await checkStructure(client, t, report.violations);
      if (report.violations.length === before) structurallyOk.push(t);
    }

    // 3. Contrôle comportemental dans une transaction annulée.
    if (structurallyOk.length > 0) {
      await client.query("BEGIN");
      try {
        const tenants = await createTwoTenants(client, tenantsTable);
        for (const t of structurallyOk) {
          const outcome = await behaviouralCheck(client, t, tenants, report.violations, options.fixtures ?? {});
          if (outcome === "ok") report.behavioural.push(t.qualified);
          else report.structuralOnly.push({ table: t.qualified, reason: outcome });
        }
      } finally {
        await client.query("ROLLBACK");
      }
    }
  } finally {
    client.release();
  }

  return report;
}

/** Lève `TenantIsolationError` s'il y a au moins une violation ; renvoie le rapport sinon. */
export async function assertTenantIsolation(options: TenantIsolationOptions): Promise<TenantIsolationReport> {
  const report = await checkTenantIsolation(options);
  if (report.violations.length > 0) throw new TenantIsolationError(report);
  return report;
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

async function checkStructure(client: PoolClientLike, t: TableInfo, out: Violation[]): Promise<void> {
  const fail = (problem: string): void => void out.push({ table: t.qualified, problem });

  const col = (
    await client.query(
      `SELECT a.attnum, a.attnotnull, a.atttypid = 'uuid'::regtype AS is_uuid
         FROM pg_attribute a
        WHERE a.attrelid = $1 AND a.attname = 'tenant_id' AND NOT a.attisdropped`,
      [t.oid],
    )
  ).rows[0];

  if (!col) fail("colonne tenant_id absente");
  else {
    if (!col.is_uuid) fail("tenant_id n'est pas de type uuid");
    if (!col.attnotnull) fail("tenant_id n'est pas NOT NULL");
  }

  if (!t.rls) fail("ROW LEVEL SECURITY non activée");
  if (!t.forced) fail("FORCE ROW LEVEL SECURITY absent (le propriétaire de la table contournerait la RLS)");

  const policies = (
    await client.query(
      `SELECT polname, polpermissive, polcmd, polroles::int[] AS roles,
              pg_get_expr(polqual, polrelid) AS qual,
              pg_get_expr(polwithcheck, polrelid) AS withcheck
         FROM pg_policy WHERE polrelid = $1`,
      [t.oid],
    )
  ).rows;

  if (policies.length === 0) fail("aucune policy");
  for (const p of policies) {
    if (p.polname !== "tenant_isolation") {
      fail(`policy étrangère "${p.polname}" (tenant_isolation doit être la seule)`);
      continue;
    }
    if (!p.polpermissive) fail("tenant_isolation doit être PERMISSIVE");
    if (p.polcmd !== "*") fail("tenant_isolation doit couvrir FOR ALL");
    if (!(p.roles.length === 1 && p.roles[0] === 0)) fail("tenant_isolation doit s'appliquer à PUBLIC");
    const ok = (expr: string | null): boolean =>
      !!expr && /tenant_id/.test(expr) && /current_tenant_id\(\)/.test(expr) && !/\bOR\b/i.test(expr);
    if (!ok(p.qual)) fail(`USING de tenant_isolation inattendu : ${p.qual ?? "(absent)"}`);
    if (!ok(p.withcheck)) fail(`WITH CHECK de tenant_isolation inattendu : ${p.withcheck ?? "(absent)"}`);
  }

  if (col) {
    const idx = (
      await client.query(
        `SELECT 1 FROM pg_index i
          WHERE i.indrelid = $1 AND i.indisvalid AND i.indpred IS NULL AND i.indkey[0] = $2`,
        [t.oid, col.attnum],
      )
    ).rows;
    if (idx.length === 0) fail("aucun index dont la première colonne est tenant_id");
  }
}

// ---------------------------------------------------------------------------
// Comportement
// ---------------------------------------------------------------------------

interface TwoTenants {
  a: string;
  b: string;
}

async function setTenant(client: PoolClientLike, tenantId: string | null): Promise<void> {
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId ?? ""]);
}

async function createTwoTenants(client: PoolClientLike, tenantsTable: string): Promise<TwoTenants> {
  const a = newId();
  const b = newId();
  const sp = "iso_tenants";
  await client.query(`SAVEPOINT ${sp}`);
  try {
    for (const [id, tag] of [
      [a, "a"],
      [b, "b"],
    ] as const) {
      await client.query(`INSERT INTO ${tenantsTable} (id, slug, name) VALUES ($1, $2, $3)`, [
        id,
        `iso-${tag}-${id.slice(-8)}`,
        `Isolation ${tag.toUpperCase()}`,
      ]);
    }
    await client.query(`RELEASE SAVEPOINT ${sp}`);
  } catch {
    // Pas de table de tenants utilisable : les tables à FK vers elle seront « structure seule ».
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
  }
  return { a, b };
}

let counter = 0;

async function loadColumns(client: PoolClientLike, oid: number): Promise<ColumnInfo[]> {
  return (
    await client.query(
      `SELECT a.attnum, a.attname AS name, t.typname, t.typtype, bt.typname AS basetype,
              a.atttypid::int AS typoid, a.atttypid::regtype::text AS fulltype,
              a.atttypmod AS typmod, a.attnotnull AS notnull, a.atthasdef AS hasdefault,
              (a.attgenerated <> '') AS generated, (a.attidentity <> '') AS identity
         FROM pg_attribute a
         JOIN pg_type t ON t.oid = a.atttypid
         LEFT JOIN pg_type bt ON bt.oid = t.typbasetype
        WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum`,
      [oid],
    )
  ).rows;
}

async function loadFks(client: PoolClientLike, oid: number): Promise<FkInfo[]> {
  return (
    await client.query(
      `SELECT conkey::int[] AS columns, confrelid::regclass::text AS "refTable",
              confkey::int[] AS "refColumns", confrelid::int AS "refOid"
         FROM pg_constraint WHERE conrelid = $1 AND contype = 'f'`,
      [oid],
    )
  ).rows;
}

async function synthValue(client: PoolClientLike, c: ColumnInfo): Promise<{ value: unknown; cast?: string } | undefined> {
  const n = ++counter;
  let type = c.typtype === "d" && c.basetype ? c.basetype : c.typname;
  if (c.typtype === "e") {
    const label = (
      await client.query(
        `SELECT e.enumlabel FROM pg_enum e WHERE e.enumtypid = $1 ORDER BY e.enumsortorder LIMIT 1`,
        [c.typoid],
      )
    ).rows[0]?.enumlabel;
    return label === undefined ? undefined : { value: label, cast: `::${c.fulltype}` };
  }
  if (type.startsWith("_")) return { value: "{}", cast: `::${c.fulltype}` };
  switch (type) {
    case "uuid":
      return { value: newId() };
    case "text":
    case "citext":
    case "name":
      return { value: `iso${n}` };
    case "varchar":
    case "bpchar": {
      const max = c.typmod > 4 ? c.typmod - 4 : 40;
      const s = `iso${n}`.slice(0, Math.max(max, 1));
      return { value: s };
    }
    case "int2":
      return { value: n % 30000 };
    case "int4":
    case "int8":
    case "numeric":
    case "float4":
    case "float8":
    case "oid":
      return { value: n };
    case "bool":
      return { value: false };
    case "date":
      return { value: "2026-01-01" };
    case "timestamp":
    case "timestamptz":
      return { value: new Date().toISOString() };
    case "time":
    case "timetz":
      return { value: "00:00:00" };
    case "interval":
      return { value: "1 day" };
    case "json":
    case "jsonb":
      return { value: "{}", cast: "::jsonb" };
    case "bytea":
      return { value: "\\x00", cast: "::bytea" };
    default:
      return undefined;
  }
}

/** Insère une ligne minimale pour `tenantId` (FK parentes créées au besoin) ; lève `Unseedable`. */
class Unseedable extends Error {}

async function insertMinimal(
  client: PoolClientLike,
  t: { oid: number; schema: string; name: string; qualified: string },
  tenantId: string,
  depth: number,
  fixtures: Fixtures,
): Promise<Record<string, unknown>> {
  if (depth > 3) throw new Unseedable("chaîne de clés étrangères trop profonde");
  const tableFixtures = fixtures[t.qualified] ?? {};
  const cols = await loadColumns(client, t.oid);
  const fks = await loadFks(client, t.oid);

  const names: string[] = [];
  const placeholders: string[] = [];
  const params: unknown[] = [];

  const add = (name: string, value: unknown, cast = ""): void => {
    params.push(value);
    names.push(q(name));
    placeholders.push(`$${params.length}${cast}`);
  };

  for (const c of cols) {
    if (c.name === "tenant_id") {
      add("tenant_id", tenantId);
      continue;
    }
    if (c.generated || c.identity) continue;

    if (Object.prototype.hasOwnProperty.call(tableFixtures, c.name)) {
      const f = tableFixtures[c.name];
      add(c.name, typeof f === "function" ? (f as (seq: number) => unknown)(++counter) : f);
      continue;
    }

    const fk = fks.find((f) => f.columns.includes(c.attnum));
    if (fk) {
      if (!c.notnull) continue; // FK facultative : laissée à NULL
      if (fk.columns.length !== 1) throw new Unseedable(`clé étrangère composite vers ${fk.refTable}`);
      const parentCols = await loadColumns(client, fk.refOid);
      const refCol = parentCols.find((p) => p.attnum === fk.refColumns[0]);
      if (!refCol) throw new Unseedable(`colonne référencée introuvable (${fk.refTable})`);
      const [schema, name] = splitQualified(fk.refTable);
      const parent = await insertMinimal(
        client,
        { oid: fk.refOid, schema, name, qualified: `${schema}.${name}` },
        tenantId,
        depth + 1,
        fixtures,
      );
      add(c.name, parent[refCol.name]);
      continue;
    }
    if (c.notnull && !c.hasdefault) {
      const v = await synthValue(client, c);
      if (!v) throw new Unseedable(`colonne obligatoire « ${c.name} » de type ${c.typname} non fabricable`);
      add(c.name, v.value, v.cast ?? "");
    }
  }

  const sql =
    names.length === 0
      ? `INSERT INTO ${qt(t)} DEFAULT VALUES RETURNING *`
      : `INSERT INTO ${qt(t)} (${names.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`;
  const res = await client.query(sql, params);
  return res.rows[0] as Record<string, unknown>;
}

function splitQualified(name: string): [string, string] {
  // regclass::text renvoie `schema.table` (guillemets si nécessaire) ou `table` si dans le search_path.
  const parts = name.match(/"[^"]+"|[^.]+/g) ?? [name];
  const unq = (s: string): string => s.replace(/^"|"$/g, "").replace(/""/g, '"');
  return parts.length === 2 ? [unq(parts[0] as string), unq(parts[1] as string)] : ["public", unq(parts[0] as string)];
}

async function behaviouralCheck(
  client: PoolClientLike,
  t: TableInfo,
  { a, b }: TwoTenants,
  violations: Violation[],
  fixtures: Fixtures,
): Promise<"ok" | string> {
  const fail = (problem: string): void => void violations.push({ table: t.qualified, problem });
  const T = qt(t);
  const sp = "iso_table";
  await client.query(`SAVEPOINT ${sp}`);

  try {
    // Fabrication de la ligne de A.
    await setTenant(client, a);
    try {
      await insertMinimal(client, t, a, 0, fixtures);
    } catch (e) {
      await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
      return e instanceof Unseedable
        ? `ligne minimale non fabricable : ${e.message}`
        : `insertion de test impossible : ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`;
    }

    // A voit sa ligne.
    const own = Number((await client.query(`SELECT count(*)::int AS n FROM ${T}`)).rows[0].n);
    if (own < 1) fail("le tenant A ne voit pas sa propre ligne (policy trop restrictive ?)");

    // B ne voit rien de A.
    await setTenant(client, b);
    const seenA = Number(
      (await client.query(`SELECT count(*)::int AS n FROM ${T} WHERE tenant_id = $1`, [a])).rows[0].n,
    );
    if (seenA !== 0) fail(`FUITE : le tenant B lit ${seenA} ligne(s) du tenant A`);
    const foreign = Number(
      (await client.query(`SELECT count(*)::int AS n FROM ${T} WHERE tenant_id IS DISTINCT FROM $1`, [b])).rows[0].n,
    );
    if (foreign !== 0) fail(`FUITE : le tenant B voit ${foreign} ligne(s) qui ne sont pas les siennes`);

    // B ne peut ni modifier ni supprimer les lignes de A.
    // Un refus de PRIVILÈGE (42501 hors RLS : pas de GRANT UPDATE/DELETE) est un état légitime
    // (table append-only) : l'écriture est impossible, donc rien à fuiter.
    const probe = async (verb: "modifié" | "supprimé", sql: string): Promise<void> => {
      await client.query("SAVEPOINT iso_probe");
      try {
        const res = await client.query(sql, [a]);
        if ((res.rowCount ?? 0) !== 0) fail(`ÉCRITURE : le tenant B a ${verb} ${res.rowCount} ligne(s) du tenant A`);
        await client.query("RELEASE SAVEPOINT iso_probe");
      } catch (e) {
        await client.query("ROLLBACK TO SAVEPOINT iso_probe");
        if (pgErrorCode(e) !== "42501") throw e;
      }
    };
    await probe("modifié", `UPDATE ${T} SET tenant_id = tenant_id WHERE tenant_id = $1`);
    await probe("supprimé", `DELETE FROM ${T} WHERE tenant_id = $1`);

    // B ne peut pas insérer une ligne au nom de A (WITH CHECK).
    await client.query(`SAVEPOINT iso_forge`);
    try {
      await insertMinimal(client, t, a, 0, fixtures);
      fail("ÉCRITURE : le tenant B a pu insérer une ligne portant le tenant_id de A (WITH CHECK absent)");
    } catch (e) {
      if (e instanceof Unseedable || !isRlsViolation(e)) {
        // Refus pour une autre raison que la RLS : on ne peut pas conclure, on ne le prétend pas.
        await client.query(`ROLLBACK TO SAVEPOINT iso_forge`);
        const why = e instanceof Error ? e.message.split("\n")[0] : String(e);
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        return `insertion croisée non concluante (refus hors RLS : ${why})`;
      }
      await client.query(`ROLLBACK TO SAVEPOINT iso_forge`);
    }

    // A conserve ses lignes (B n'a rien détruit).
    await setTenant(client, a);
    const still = Number((await client.query(`SELECT count(*)::int AS n FROM ${T}`)).rows[0].n);
    if (still < 1) fail("les lignes de A ont disparu après les tentatives de B");

    // Échec fermé : sans tenant, ou avec un tenant mal formé, rien n'est visible.
    for (const bad of [null, "pas-un-uuid", "' OR 1=1 --"]) {
      await setTenant(client, bad);
      const n = Number((await client.query(`SELECT count(*)::int AS n FROM ${T}`)).rows[0].n);
      if (n !== 0) fail(`FUITE : ${n} ligne(s) visibles avec app.tenant_id = ${bad === null ? "(vide)" : JSON.stringify(bad)}`);
    }

    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    return "ok";
  } catch (e) {
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => undefined);
    return `contrôle comportemental interrompu : ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`;
  }
}
