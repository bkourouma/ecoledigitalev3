/**
 * Gabarits du générateur de module (`pnpm module:new`) : contenu des fichiers du squelette.
 *
 * Le squelette suit le contrat d'assemblage ACTUEL (`platform/runtime.ts`, `docs/architecture/platform-assembly.md`) :
 *  - plugin HTTP à la signature `(app, runtime)`, routes SANS préfixe, `setup(app, runtime)` facultatif ;
 *  - permissions vérifiées par `runtime.requirePermission(...)` (jamais de rôle codé en dur) ;
 *  - audit par `runtime.auditPort` dans la transaction du use case, en dernier ;
 *  - événements dans l'outbox (`PgOutboxWriter`) dans la même transaction ;
 *  - `subscribers.ts` et `jobs.ts` découverts par le worker (exemples commentés) ;
 *  - `isolation-allowlist.<key>.ts` (à la racine de modules/, hors du dossier du module) ;
 *  - migrations dans la plage réservée au module (conventions de numérotation).
 *
 * Aucun backtick dans le code généré (hors README, où « ¤ » est remplacé par un backtick) : ça garde les gabarits lisibles.
 * Le squelette est un EXEMPLE minimal (entité « item ») à remplacer ; il passe tel quel les contrôles de la plateforme.
 */

export interface RenderOptions {
  /** Premier numéro de la plage de migrations réservée au module (ex. 1600 -> 1600-1699). */
  rangeStart?: number;
}

export const DEFAULT_RANGE_START = 1600;
export const RANGE_WIDTH = 100;

const pad4 = (n: number): string => String(n).padStart(4, "0");

export function titleOf(key: string): string {
  const words = key.split("_").filter(Boolean).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Nom du fichier de migration initiale d'un module pour une plage donnée. */
export function initialMigrationName(key: string, rangeStart: number): string {
  return `${pad4(rangeStart)}_${key}_init.sql`;
}

/** Fichiers du squelette, indexés par chemin relatif au DOSSIER du module (`modules/<key>/`). */
export function renderModuleFiles(key: string, options: RenderOptions = {}): Record<string, string> {
  const start = options.rangeStart ?? DEFAULT_RANGE_START;
  const end = start + RANGE_WIDTH - 1;
  const title = titleOf(key);
  const label = title.toLowerCase();
  const files: Record<string, string> = {};

  // ---------------------------------------------------------------------------------------------------------------
  files["manifest.ts"] = `import { defineModule } from "@ecoledigitale/kernel";
import { ALL_EVENT_TYPES } from "./domain/events";

/**
 * Manifeste du module "${key}" : source de vérité de ses permissions, features, menus et événements
 * (le RBAC, les entitlements et la navigation se génèrent à partir de là). Le nom du dossier, la clé
 * et le schéma Postgres sont identiques. Voir docs/architecture/new-module-guide.md.
 */
export default defineModule({
  key: "${key}",
  title: "${title}",
  // Packs qui incluent le module par défaut (CORE = toujours actif). Les features ci-dessous affinent par pack.
  packs: ["CORE"],
  // Ordre de chargement/migration uniquement (jamais nécessaire pour utiliser runtime.requirePermission,
  // runtime.auditPort, runtime.entitlements : le runtime les fournit). Exemple : dependsOn: ["rbac"] si vous
  // importez rbac/index.ts.
  dependsOn: [],
  permissions: [
    { key: "${key}.item.read", label: "Consulter les éléments (${label})" },
    { key: "${key}.item.create", label: "Créer un élément (${label})" },
    // Permission sensible (MFA exigée, toujours auditée) :
    // { key: "${key}.item.delete", label: "Supprimer un élément (${label})", sensitive: true },
  ],
  // Features contrôlées par les entitlements (plan / pack / surcharge). Une route les exige par
  // runtime.entitlements.requireFeature("${key}.premium") ; un menu les référence par "feature".
  features: [
    // { key: "${key}.premium", label: "Option premium (${label})", packs: ["HIGHER"] },
  ],
  // Entrées de navigation (le menu doit référencer une permission DE CE MODULE).
  menus: [
    // { key: "${key}.items", label: "${title}", href: "/admin/${key}", permission: "${key}.item.read", portal: "admin", icon: "list", order: 900 },
  ],
  events: {
    publishes: [...ALL_EVENT_TYPES],
    // Événements d'AUTRES modules consommés (documentation ; l'abonnement réel est dans subscribers.ts).
    consumes: [],
  },
});
`;

  // ---------------------------------------------------------------------------------------------------------------
  files["index.ts"] = `/**
 * API publique du module "${key}" : SEUL point d'import autorisé pour les autres modules
 * (règle dependency-cruiser, pnpm check:boundaries). N'exportez que ce qui est destiné aux autres.
 */
export type { Item } from "./domain/item";
export { ITEM_CREATED, ALL_EVENT_TYPES, type ItemCreatedPayload } from "./domain/events";
export { createItem, listItems } from "./application/items";
export type { AuditEntry, AuditPort, ItemsDeps } from "./application/ports";
`;

  // ---------------------------------------------------------------------------------------------------------------
  files[`migrations/${initialMigrationName(key, start)}`] = `-- =============================================================================
-- ${pad4(start)} — Module ${key} : schéma et table d'exemple
-- =============================================================================
-- Plage de numéros réservée au module : ${pad4(start)}-${pad4(end)} (docs/architecture/module-conventions.md).
-- Un fichier hors de cette plage est refusé en revue ; les versions sont globales à tous les dossiers.
-- Exécutée par le runner de @ecoledigitale/database sous le rôle migrator.
-- Règles :
--   - un module = un schéma du même nom ;
--   - toute table métier : tenant_id uuid NOT NULL REFERENCES kernel.tenants(id),
--     puis kernel.enable_tenant_rls(...), puis GRANT ... TO app_user ;
--   - jamais de clé étrangère vers le schéma d'un autre module (seul kernel.tenants est admis) ;
--   - une table globale (sans tenant_id) se déclare dans modules/isolation-allowlist.${key}.ts avec sa justification.
-- Un fichier appliqué ne se modifie JAMAIS : corrigez par une nouvelle migration (${pad4(start + 1)}_...).
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS ${key};
REVOKE ALL ON SCHEMA ${key} FROM PUBLIC;
GRANT USAGE ON SCHEMA ${key} TO app_user;

-- Exemple de table de tenant : à remplacer par le vrai modèle du module.
CREATE TABLE ${key}.items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES kernel.tenants(id),
  label      text NOT NULL CHECK (length(btrim(label)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

SELECT kernel.enable_tenant_rls('${key}.items');

GRANT SELECT, INSERT, UPDATE, DELETE ON ${key}.items TO app_user;
`;

  // ---------------------------------------------------------------------------------------------------------------
  files["domain/events.ts"] = `/**
 * Événements du module "${key}" : noms <module>.<entité>.<verbe-passé>, payload JSON versionné { v: 1, ... }.
 * Domaine pur : aucun import d'infrastructure.
 */
export const ITEM_CREATED = "${key}.item.created" as const;

/** Tous les événements PUBLIÉS par le module (repris par manifest.ts). */
export const ALL_EVENT_TYPES: readonly string[] = [ITEM_CREATED];

export interface ItemCreatedPayload {
  v: 1;
  itemId: string;
}
`;

  files["domain/item.ts"] = `/**
 * Domaine : entités et règles PURES. Aucun import de pg, fastify ou d'infrastructure
 * (imposé par pnpm check:boundaries).
 */
import { ValidationError, err, ok, type Result } from "@ecoledigitale/kernel";

export interface Item {
  id: string;
  tenantId: string;
  label: string;
  createdAt: Date;
}

/** Longueur maximale du libellé (contrainte de saisie, pas une règle réglementaire). */
export const ITEM_LABEL_MAX = 200;

/** Normalise (espaces) et valide le libellé d'un élément. */
export function normalizeLabel(raw: unknown): Result<string, ValidationError> {
  const label = typeof raw === "string" ? raw.trim().replace(/\\s+/g, " ") : "";
  if (label.length === 0) return err(ValidationError.field("label", "Le libellé est obligatoire.", "label_required"));
  if (label.length > ITEM_LABEL_MAX) {
    return err(ValidationError.field("label", "Le libellé est trop long.", "label_too_long"));
  }
  return ok(label);
}
`;

  // ---------------------------------------------------------------------------------------------------------------
  files["infrastructure/item-repository.ts"] = `/**
 * Infrastructure : SQL via le Tx d'un TenantDb.run (jamais de pool direct). La RLS isole par tenant ;
 * on écrit quand même tenant_id à l'insertion (colonne NOT NULL, WITH CHECK de la policy).
 */
import type { Tx } from "@ecoledigitale/database";
import type { Item } from "../domain/item";

interface ItemRow {
  id: string;
  tenant_id: string;
  label: string;
  created_at: Date;
}

export async function insertItem(tx: Tx, item: Item): Promise<void> {
  await tx.query("INSERT INTO ${key}.items (id, tenant_id, label, created_at) VALUES ($1, $2, $3, $4)", [
    item.id,
    item.tenantId,
    item.label,
    item.createdAt,
  ]);
}

export async function selectItems(tx: Tx): Promise<Item[]> {
  const rows = await tx.many<ItemRow>(
    "SELECT id, tenant_id, label, created_at FROM ${key}.items ORDER BY created_at DESC, id LIMIT 200",
  );
  return rows.map((r) => ({ id: r.id, tenantId: r.tenant_id, label: r.label, createdAt: r.created_at }));
}
`;

  // ---------------------------------------------------------------------------------------------------------------
  files["application/ports.ts"] = `/**
 * Ports du module (ce que l'application attend de l'extérieur), décrits structurellement.
 * Le plugin HTTP les satisfait avec le ModuleRuntime (platform/runtime.ts) : runtime.auditPort est un AuditPort.
 */
import type { Tx, TenantDb } from "@ecoledigitale/database";
import type { Clock } from "@ecoledigitale/kernel";

/** Entrée d'audit : tenant, acteur et requête sont dérivés du contexte de la transaction. */
export interface AuditEntry {
  /** entité.verbe, ex. ${key}.item.create */
  action: string;
  /** Type d'objet (snake_case), ex. item */
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  severity?: "info" | "notice" | "warning" | "critical";
}

export interface AuditPort {
  record(tx: Tx, entry: AuditEntry): Promise<unknown>;
}

export interface ItemsDeps {
  tenantDb: TenantDb;
  clock: Clock;
  audit: AuditPort;
}
`;

  files["application/items.ts"] = `/**
 * Application : un cas d'usage = une fonction (deps, ctx, input) => Promise<Result<T, E>>.
 * Écriture, événement d'outbox et audit sont validés ou annulés ENSEMBLE (une seule transaction).
 */
import { PgOutboxWriter } from "@ecoledigitale/database";
import { createDomainEvent, newId, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { ITEM_CREATED, type ItemCreatedPayload } from "../domain/events";
import { normalizeLabel, type Item } from "../domain/item";
import { insertItem, selectItems } from "../infrastructure/item-repository";
import type { ItemsDeps } from "./ports";

export async function createItem(deps: ItemsDeps, ctx: RequestContext, input: { label: unknown }): Promise<Result<Item, AppError>> {
  const label = normalizeLabel(input.label);
  if (!label.ok) return label;

  const item: Item = { id: newId(), tenantId: ctx.tenantId, label: label.value, createdAt: deps.clock.now() };
  await deps.tenantDb.run(ctx, async (tx) => {
    await insertItem(tx, item);

    const payload: ItemCreatedPayload = { v: 1, itemId: item.id };
    await new PgOutboxWriter(tx).append([
      createDomainEvent({
        type: ITEM_CREATED,
        ctx,
        clock: deps.clock,
        aggregateType: "${key}.item",
        aggregateId: item.id,
        payload,
      }),
    ]);

    // Audit EN DERNIER dans la transaction : un échec d'audit annule l'opération entière.
    await deps.audit.record(tx, {
      action: "${key}.item.create",
      entity: "item",
      entityId: item.id,
      after: { label: item.label },
    });
  });
  return ok(item);
}

export async function listItems(deps: ItemsDeps, ctx: RequestContext): Promise<Item[]> {
  return await deps.tenantDb.run(ctx, (tx) => selectItems(tx), { readOnly: true });
}
`;

  // ---------------------------------------------------------------------------------------------------------------
  files["http/schemas.ts"] = `/**
 * Schémas Zod des entrées HTTP du module.
 *
 * TODO(contracts) : les schémas partagés avec le front vivent dans packages/contracts/src/v2/${key}.ts
 * (réexportés par packages/contracts/src/v2/index.ts, convention n°9) ; déplacez-les là dès qu'ils sont stables.
 */
import { z } from "zod";

export const createItemBody = z.object({ label: z.string() });
`;

  files["http/plugin.ts"] = `/**
 * Plugin Fastify du module "${key}", chargé automatiquement par le registre.
 *
 * Contrat d'assemblage (platform/runtime.ts) :
 *  - export default async function (app, runtime) : routes SANS préfixe ; le registre applique /api/v1/${key}
 *    et fournit le gestionnaire d'erreurs (kernel -> JSON) et la garde « request.ctx présent » (401 sinon) ;
 *  - export function setup(app, runtime) : FACULTATIF, appelé avant, sur l'instance RACINE (décorateurs partagés
 *    avec d'autres modules). Inutile pour un module qui n'expose rien aux autres.
 *
 * Une route sans contexte tenant (login, webhook signé) déclare { config: { public: true } } et s'authentifie elle-même.
 */
import type { FastifyInstance } from "fastify";
import { ValidationError } from "@ecoledigitale/kernel";
import type { ModuleRuntime } from "../../../platform/runtime";
import { createItem, listItems } from "../application/items";
import type { ItemsDeps } from "../application/ports";
import { createItemBody } from "./schemas";

// export function setup(app: FastifyInstance, runtime: ModuleRuntime): void {
//   app.decorate("${key}", { ... }); // lu par les AUTRES modules à la requête
// }

export default async function modulePlugin(app: FastifyInstance, runtime: ModuleRuntime): Promise<void> {
  // runtime.auditPort est structurellement un AuditPort (audit.record dans la transaction du use case).
  const deps: ItemsDeps = { tenantDb: runtime.tenantDb, clock: runtime.clock, audit: runtime.auditPort };

  // Gardes : permission du manifeste (rbac), puis éventuellement une feature (entitlements) :
  //   preHandler: [runtime.requirePermission("${key}.item.read"), runtime.entitlements.requireFeature("${key}.premium")]
  // Un contrôle visant UNE ressource passe son périmètre : runtime.requirePermission(perm, { scope: ... }).
  app.get("/items", { preHandler: runtime.requirePermission("${key}.item.read") }, async (request) => ({
    items: await listItems(deps, runtime.resolveContext(request)),
  }));

  app.post("/items", { preHandler: runtime.requirePermission("${key}.item.create") }, async (request, reply) => {
    const body = createItemBody.safeParse(request.body);
    if (!body.success) {
      throw new ValidationError(
        "Données invalides.",
        body.error.issues.map((i) => ({ path: i.path, message: i.message, code: i.code })),
      );
    }
    const result = await createItem(deps, runtime.resolveContext(request), body.data);
    if (!result.ok) throw result.error;
    return reply.status(201).send(result.value);
  });
}
`;

  // ---------------------------------------------------------------------------------------------------------------
  files["subscribers.ts"] = `/**
 * Abonnés du module "${key}" pour apps/worker (découverts automatiquement : modules/<key>/subscribers.ts).
 * Le worker consomme l'outbox (kernel.domain_events) : chaque abonné reçoit les événements dont le type correspond
 * à son motif. Aucun abonné par défaut : le tableau vide est valide.
 *
 * En production le worker EMBARQUE les modules dans son bundle : après avoir ajouté ou modifié un abonné,
 * reconstruisez-le (pnpm --filter @ecoledigitale/worker build).
 *
 * Règles : nom STABLE et unique (clé d'idempotence), handler idempotent (idempotent(...) réserve
 * (abonné, id d'événement) dans la même transaction), effets externes (e-mail, HTTP) hors transaction ou avec
 * leur propre clé d'idempotence, aucun import d'un autre module autre que son index.ts.
 */

// import { defineSubscriber, idempotent } from "@ecoledigitale/worker/sdk";
//
// export default [
//   defineSubscriber({
//     name: "${key}.on-tenant-provisioned",
//     pattern: "tenancy.tenant.provisioned", // type exact, motif ("tenancy.*", "tenancy.**") ou RegExp
//     retry: { attempts: 5, backoffMs: 1_000, maxBackoffMs: 60_000 },
//     handler: idempotent("${key}.on-tenant-provisioned", async (event, ctx, tx) => {
//       // tx : transaction du tenant de l'événement (RLS). ctx.logger, ctx.tenantId, ctx.tenantDb disponibles.
//       await tx.query("SELECT 1");
//     }),
//   }),
// ];

export default [];
`;

  files["jobs.ts"] = `/**
 * Jobs planifiés du module "${key}" pour apps/worker (découverts automatiquement : modules/<key>/jobs.ts).
 * Aucun job par défaut : le tableau vide est valide. Fuseau des expressions cron : WORKER_TZ.
 *
 * En production le worker EMBARQUE les modules dans son bundle : reconstruisez-le après modification
 * (pnpm --filter @ecoledigitale/worker build).
 *
 * Règles : nom stable et unique, traitement idempotent (le planificateur peut rejouer), perTenant: true pour
 * exécuter le handler une fois par tenant actif (ctx.db est alors lié au tenant), sinon ctx.systemDb explicite.
 */

// import { defineScheduledJob } from "@ecoledigitale/worker/sdk";
//
// export default [
//   defineScheduledJob({
//     name: "${key}.nightly-cleanup",
//     cron: "20 2 * * *", // 5 champs, ou 6 avec les secondes
//     perTenant: true,
//     handler: async ({ tenant, db, logger }) => {
//       await db.run(async (tx) => {
//         await tx.query("SELECT 1");
//       });
//       logger.info({ tenant: tenant.id }, "${key} : nettoyage terminé");
//     },
//   }),
// ];

export default [];
`;

  // ---------------------------------------------------------------------------------------------------------------
  files["test/support/fakes.ts"] = `/**
 * Doublures sans base de données pour les tests unitaires : TenantDb, Tx et port d'audit enregistreurs.
 */
import type { QueryResult, TenantDb, Tx } from "@ecoledigitale/database";
import type { AuditEntry, AuditPort } from "../../application/ports";

export interface RecordedQuery {
  sql: string;
  params: readonly unknown[];
}

export interface FakeDb {
  db: TenantDb;
  queries: RecordedQuery[];
  /** Ordre des écritures (SQL résumé et audit) pour vérifier « audit en dernier ». */
  order: string[];
  audit: AuditPort;
  auditEntries: AuditEntry[];
}

export function makeFakeDb(options: { failAudit?: boolean } = {}): FakeDb {
  const queries: RecordedQuery[] = [];
  const order: string[] = [];
  const auditEntries: AuditEntry[] = [];

  const tx: Tx = {
    async query<R = Record<string, any>>(sql: string, params: readonly unknown[] = []): Promise<QueryResult<R>> {
      queries.push({ sql, params });
      order.push(/^\\s*INSERT INTO kernel\\.domain_events/i.test(sql) ? "outbox" : "sql");
      return { rows: [], rowCount: 1 };
    },
    async queryOne() {
      return null;
    },
    async many() {
      return [];
    },
    async transaction(fn) {
      return await fn(tx);
    },
  };

  const db = { run: async (_ctx: unknown, fn: (t: Tx) => Promise<unknown>) => await fn(tx) } as unknown as TenantDb;
  const audit: AuditPort = {
    async record(_tx, entry) {
      order.push("audit");
      if (options.failAudit) throw new Error("audit indisponible");
      auditEntries.push(entry);
    },
  };
  return { db, queries, order, audit, auditEntries };
}
`;

  files["test/support/db.ts"] = `/**
 * Aides d'intégration : base jetable, migrations (baseline + module), rôle applicatif NON propriétaire.
 * Les tests qui l'utilisent s'ignorent sans TEST_DATABASE_URL. Postgres éphémère dans Docker :
 *
 *   ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --root apps/api src/modules/${key}/test
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe } from "vitest";
import { Client, Pool } from "pg";
import { noopLogger } from "@ecoledigitale/kernel";
import { TenantDb, migrate } from "@ecoledigitale/database";

function repoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("Racine du dépôt introuvable (pnpm-workspace.yaml).");
}

export const BASELINE_DIR = resolve(repoRoot(), "packages/database/migrations");
export const MODULE_MIGRATIONS = resolve(__dirname, "../../migrations");

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const describeIntegration: typeof describe = describe.skipIf(!TEST_DATABASE_URL) as unknown as typeof describe;

const rand = (n = 4): string => randomBytes(n).toString("hex");

function urlFor(database: string, user?: string, password?: string): string {
  const u = new URL(TEST_DATABASE_URL as string);
  u.pathname = "/" + database;
  if (user) u.username = user;
  if (password) u.password = password;
  return u.toString();
}

export interface ModuleTestDb {
  /** Connexion propriétaire/administrateur (préparer ou lire les données hors RLS). */
  admin: Client;
  /** Pool d'un rôle membre de app_user (ni propriétaire, ni superuser, ni BYPASSRLS) : la RLS s'applique. */
  appPool: Pool;
  tenantDb: TenantDb;
  createTenant(slug: string): Promise<string>;
  drop(): Promise<void>;
}

export async function createModuleTestDb(): Promise<ModuleTestDb> {
  const name = "ed_it_" + rand() + "_test";
  const maintenance = new Client({ connectionString: TEST_DATABASE_URL });
  await maintenance.connect();
  await maintenance.query('CREATE DATABASE "' + name + '"');

  const admin = new Client({ connectionString: urlFor(name) });
  await admin.connect();
  await migrate({ client: admin, dirs: [BASELINE_DIR, MODULE_MIGRATIONS], role: "migrator", logger: noopLogger });

  const role = "it_app_" + rand();
  const password = rand(16);
  await admin.query('CREATE ROLE "' + role + '" LOGIN PASSWORD \\'' + password + "' IN ROLE app_user");
  const appPool = new Pool({ connectionString: urlFor(name, role, password), max: 4 });

  return {
    admin,
    appPool,
    tenantDb: new TenantDb(appPool),
    async createTenant(slug) {
      const id = (await admin.query("SELECT gen_random_uuid() AS id")).rows[0].id as string;
      await admin.query("INSERT INTO kernel.tenants (id, slug, name) VALUES ($1, $2, $3)", [id, slug, slug]);
      return id;
    },
    async drop() {
      await appPool.end().catch(() => undefined);
      await admin.end().catch(() => undefined);
      try {
        await maintenance.query('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)');
        await maintenance.query('DROP ROLE IF EXISTS "' + role + '"');
      } finally {
        await maintenance.end().catch(() => undefined);
      }
    },
  };
}
`;

  files[`test/${key}.test.ts`] = `/**
 * Tests unitaires (sans base de données) : manifeste, domaine, use case avec doublures, et chargement du plugin
 * PAR LE REGISTRE (signature (app, runtime), préfixe /api/v1/${key}, gardes de permission, garde de contexte).
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  ForbiddenError,
  createRequestContext,
  resolveModuleOrder,
  systemClock,
  type RequestContext,
} from "@ecoledigitale/kernel";
import { registerModules, resetRegistryForTests, type DiscoveredModule } from "../../registry";
import type { ModuleRuntime } from "../../../platform/runtime";
import { createItem } from "../application/items";
import { ITEM_CREATED } from "../domain/events";
import { normalizeLabel } from "../domain/item";
import manifest from "../manifest";
import { makeFakeDb } from "./support/fakes";

const TENANT = "0192f0a4-7b1e-7c3a-8d2e-0000000000a1";
const USER = "0192f0a4-7b1e-7c3a-8d2e-0000000000b1";
const ctx: RequestContext = createRequestContext({ tenantId: TENANT, userId: USER });

describe("module ${key} : manifeste", () => {
  it("déclare un manifeste valide dont les permissions sont préfixées par la clé", () => {
    expect(manifest.key).toBe("${key}");
    expect(manifest.permissions.length).toBeGreaterThan(0);
    for (const permission of manifest.permissions) expect(permission.key.startsWith("${key}.")).toBe(true);
    expect(() => resolveModuleOrder([manifest])).not.toThrow();
  });

  it("publie des événements <module>.<entité>.<verbe> et ses fichiers conventionnels existent", () => {
    for (const type of manifest.events.publishes) expect(type).toMatch(/^${key}\\.[a-z_]+\\.[a-z_]+$/);
    const dir = resolve(__dirname, "..");
    for (const file of ["manifest.ts", "index.ts", "subscribers.ts", "jobs.ts", "http/plugin.ts"]) {
      expect(existsSync(resolve(dir, file)), file).toBe(true);
    }
  });
});

describe("module ${key} : domaine", () => {
  it("normalise et valide le libellé d'un élément", () => {
    expect(normalizeLabel("  Mon   élément ")).toEqual({ ok: true, value: "Mon élément" });
    expect(normalizeLabel("   ").ok).toBe(false);
    expect(normalizeLabel("x".repeat(500)).ok).toBe(false);
  });
});

describe("module ${key} : use case createItem (doublures)", () => {
  it("écrit la ligne, l'événement d'outbox puis l'audit, dans cet ordre", async () => {
    const fake = makeFakeDb();
    const result = await createItem({ tenantDb: fake.db, clock: systemClock, audit: fake.audit }, ctx, { label: " Premier " });
    expect(result.ok).toBe(true);
    expect(fake.order).toEqual(["sql", "outbox", "audit"]);
    expect(fake.auditEntries).toHaveLength(1);
    expect(fake.auditEntries.at(0)).toMatchObject({ action: "${key}.item.create", entity: "item", after: { label: "Premier" } });
    const outbox = fake.queries.find((q) => /kernel\\.domain_events/.test(q.sql));
    expect(outbox?.params).toContain(ITEM_CREATED);
  });

  it("refuse un libellé invalide sans rien écrire", async () => {
    const fake = makeFakeDb();
    const result = await createItem({ tenantDb: fake.db, clock: systemClock, audit: fake.audit }, ctx, { label: "  " });
    expect(result.ok).toBe(false);
    expect(fake.queries).toEqual([]);
    expect(fake.auditEntries).toEqual([]);
  });

  it("propage l'échec d'audit (la transaction réelle est alors annulée)", async () => {
    const fake = makeFakeDb({ failAudit: true });
    await expect(createItem({ tenantDb: fake.db, clock: systemClock, audit: fake.audit }, ctx, { label: "A" })).rejects.toThrow(
      /audit indisponible/,
    );
  });
});

describe("module ${key} : chargé par le registre", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    resetRegistryForTests();
    await app?.close();
    app = undefined;
  });

  const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };

  async function boot(grant: string[] = []) {
    const fake = makeFakeDb();
    const guarded: string[] = [];
    const runtime = {
      tenantDb: fake.db,
      clock: systemClock,
      auditPort: { record: fake.audit.record, recordPlatform: async () => undefined },
      resolveContext: (request: { ctx?: unknown }) => request.ctx as RequestContext,
      requirePermission: (permission: string) => async () => {
        guarded.push(permission);
        if (!grant.includes(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
      },
    } as unknown as ModuleRuntime;

    app = Fastify({ logger: false });
    app.decorate("v2", {} as never); // exigé par le registre (posé en vrai par le plugin v2-context)
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (request) => {
      if (request.headers["x-tenant"]) (request as unknown as { ctx: RequestContext }).ctx = ctx;
    });

    const dir = resolve(__dirname, "..");
    const discovered: DiscoveredModule = {
      key: "${key}",
      dir,
      manifestPath: resolve(dir, "manifest.ts"),
      manifest,
      pluginPath: resolve(dir, "http", "plugin.ts"),
      migrationsDir: resolve(dir, "migrations"),
    };
    const loaded = await registerModules(app, { enabled: true, discovered: [discovered], runtime, logger: quiet });
    return { app, fake, guarded, loaded };
  }

  it("monte les routes sous /api/v1/${key} avec la signature (app, runtime)", async () => {
    const { app: instance, loaded } = await boot(["${key}.item.read"]);
    expect(loaded.map((m) => m.prefix)).toEqual(["/api/v1/${key}"]);
    const res = await instance.inject({ method: "GET", url: "/api/v1/${key}/items", headers: { "x-tenant": TENANT } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
    // Pas de double préfixe : la route sans préfixe n'existe pas à la racine.
    expect((await instance.inject({ method: "GET", url: "/items", headers: { "x-tenant": TENANT } })).statusCode).toBe(404);
  });

  it("refuse sans contexte (401) et sans permission (403), avec les permissions du manifeste", async () => {
    const { app: instance, guarded } = await boot(["${key}.item.read"]);
    expect((await instance.inject({ method: "GET", url: "/api/v1/${key}/items" })).statusCode).toBe(401);
    const denied = await instance.inject({
      method: "POST",
      url: "/api/v1/${key}/items",
      headers: { "x-tenant": TENANT },
      payload: { label: "x" },
    });
    expect(denied.statusCode).toBe(403);
    expect(guarded).toContain("${key}.item.create");
    for (const permission of guarded) expect(manifest.permissions.map((p) => p.key)).toContain(permission);
  });

  it("crée un élément (201), valide le corps (400) et audite dans la même transaction", async () => {
    const { app: instance, fake } = await boot(["${key}.item.create"]);
    const ok = await instance.inject({ method: "POST", url: "/api/v1/${key}/items", headers: { "x-tenant": TENANT }, payload: { label: "Alpha" } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ label: "Alpha", tenantId: TENANT });
    expect(fake.order).toEqual(["sql", "outbox", "audit"]);

    const bad = await instance.inject({ method: "POST", url: "/api/v1/${key}/items", headers: { "x-tenant": TENANT }, payload: { label: "   " } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ kind: "validation" });
    const missing = await instance.inject({ method: "POST", url: "/api/v1/${key}/items", headers: { "x-tenant": TENANT }, payload: {} });
    expect(missing.statusCode).toBe(400);
  });
});
`;

  files[`test/${key}.integration.test.ts`] = `/**
 * Test d'intégration (Postgres réel, rôle applicatif soumis à la RLS). S'ignore sans TEST_DATABASE_URL.
 * Contient le contrôle d'isolation multi-tenant du module : assertTenantIsolation (structure + comportement A/B).
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { assertTenantIsolation } from "@ecoledigitale/database";
import { createRequestContext, systemClock, unwrap } from "@ecoledigitale/kernel";
import allowlist from "../../isolation-allowlist.${key}";
import { createItem, listItems } from "../application/items";
import type { AuditEntry } from "../application/ports";
import { createModuleTestDb, describeIntegration, type ModuleTestDb } from "./support/db";

describeIntegration("module ${key} : base réelle", () => {
  let db: ModuleTestDb;
  let tenantA: string;
  let tenantB: string;
  const audited: AuditEntry[] = [];
  const USER = "0192f0a4-7b1e-7c3a-8d2e-0000000000b1";

  const ctxOf = (tenantId: string) => createRequestContext({ tenantId, userId: USER });
  const deps = (failAudit = false) => ({
    tenantDb: db.tenantDb,
    clock: systemClock,
    audit: {
      record: async (_tx: unknown, entry: AuditEntry) => {
        if (failAudit) throw new Error("audit indisponible");
        audited.push(entry);
      },
    },
  });

  beforeAll(async () => {
    db = await createModuleTestDb();
    tenantA = await db.createTenant("tenant-a");
    tenantB = await db.createTenant("tenant-b");
  });
  afterAll(async () => {
    await db?.drop();
  });

  it("assertTenantIsolation : chaque table du schéma ${key} est isolée par tenant (RLS forcée)", async () => {
    const report = await assertTenantIsolation({
      pool: db.appPool,
      schemas: ["${key}"],
      allowlist: allowlist.map((entry) => entry.table),
    });
    expect(report.violations).toEqual([]);
    expect(report.staleAllowlist).toEqual([]);
    expect(report.behavioural).toContain("${key}.items");
  });

  it("n'expose les éléments d'un tenant qu'à ce tenant", async () => {
    unwrap(await createItem(deps(), ctxOf(tenantA), { label: "Alpha" }));
    unwrap(await createItem(deps(), ctxOf(tenantB), { label: "Beta" }));
    expect((await listItems(deps(), ctxOf(tenantA))).map((i) => i.label)).toEqual(["Alpha"]);
    expect((await listItems(deps(), ctxOf(tenantB))).map((i) => i.label)).toEqual(["Beta"]);
    expect(audited.map((a) => a.action)).toContain("${key}.item.create");
  });

  it("écrit l'événement d'outbox avec la ligne, et annule les deux si l'audit échoue", async () => {
    const created = unwrap(await createItem(deps(), ctxOf(tenantA), { label: "Avec événement" }));
    const events = await db.admin.query("SELECT type, tenant_id, payload FROM kernel.domain_events WHERE aggregate_id = $1", [created.id]);
    expect(events.rows).toHaveLength(1);
    expect(events.rows.at(0)).toMatchObject({ type: "${key}.item.created", tenant_id: tenantA, payload: { v: 1, itemId: created.id } });

    await expect(createItem(deps(true), ctxOf(tenantA), { label: "Annulé" })).rejects.toThrow(/audit indisponible/);
    const leftovers = await db.admin.query("SELECT 1 FROM ${key}.items WHERE label = 'Annulé'");
    expect(leftovers.rows).toHaveLength(0);
    const orphanEvents = await db.admin.query("SELECT 1 FROM kernel.domain_events WHERE type = '${key}.item.created' AND tenant_id = $1", [tenantA]);
    expect(orphanEvents.rows).toHaveLength(2); // « Alpha » et « Avec événement » seulement
  });
});
`;

  // ---------------------------------------------------------------------------------------------------------------
  files["README.md"] = readme(key, title, start, end);

  return files;
}

/**
 * Fichiers à placer à la RACINE de modules/ (hors du dossier du module), indexés par chemin relatif à modules/.
 * Le chargeur du test d'isolation les découvre par leur nom : isolation-allowlist.<key>.ts.
 */
export function renderModulesRootFiles(key: string): Record<string, string> {
  return {
    [`isolation-allowlist.${key}.ts`]: `/**
 * Tables GLOBALES du schéma "${key}" (sans tenant_id, hors RLS) pour le test d'isolation
 * (pnpm test:isolation et assertTenantIsolation). Fichier découvert automatiquement.
 *
 * AUCUNE : la table d'exemple ${key}.items porte tenant_id NOT NULL REFERENCES kernel.tenants(id) et la RLS forcée
 * (kernel.enable_tenant_rls). Une table n'a sa place ici QUE si elle est volontairement commune à tous les tenants
 * (référentiel). Chaque entrée porte alors une justification d'au moins 20 caractères, et le schéma de la table est
 * celui du module (aucune table d'un autre module). Une entrée qui ne correspond à aucune table est une erreur.
 *
 * Exemple :
 *   { table: "${key}.currencies", reason: "Référentiel ISO 4217 identique pour tous les tenants, sans donnée de tenant." },
 *
 * Valeurs imposées pour fabriquer une ligne de test dans une table à CHECK exotique (sinon contrôle de structure seul) :
 *   export const fixtures = { "${key}.items": { label: "isolation" } };
 */
import type { AllowlistEntry } from "./isolation-allowlist";

const entries: AllowlistEntry[] = [];

export default entries;
`,
  };
}

function readme(key: string, title: string, start: number, end: number): string {
  const md = `# Module ¤${key}¤ — ${title}

Squelette généré par ¤pnpm module:new ${key}¤. Conforme à ¤docs/architecture/module-conventions.md¤ et au contrat d'assemblage
(¤docs/architecture/platform-assembly.md¤). Pas à pas : ¤docs/architecture/new-module-guide.md¤.

**À remplacer** : l'entité d'exemple ¤item¤ (table ¤${key}.items¤, routes ¤/items¤, événement ¤${key}.item.created¤) par le vrai modèle du module,
puis écrire ici ce que le module fait réellement (domaine, règles, tables, routes, événements).

- Schéma Postgres : ¤${key}¤ — migrations ¤${String(start).padStart(4, "0")}-${String(end).padStart(4, "0")}¤ (plage réservée, inscrite dans le tableau de ¤module-conventions.md¤).
- Packs : ¤CORE¤ (à ajuster dans ¤manifest.ts¤).

## Arborescence

¤¤¤
manifest.ts          permissions, features, menus, événements (source de vérité)
index.ts             API publique : SEUL point d'import pour les autres modules
migrations/          ${String(start).padStart(4, "0")}_${key}_init.sql (schéma, table de tenant, RLS, droits)
domain/              règles pures (aucun import pg/fastify) : item.ts, events.ts
application/         cas d'usage (deps, ctx, input) => Result ; ports.ts (audit)
infrastructure/      SQL via le Tx de TenantDb
http/                plugin.ts : export default async (app, runtime) [+ setup facultatif] ; schemas.ts (Zod)
subscribers.ts       abonnés du worker (exemple commenté)
jobs.ts              jobs planifiés du worker (exemple commenté)
test/                unitaires (sans base), intégration (TEST_DATABASE_URL), support/
../isolation-allowlist.${key}.ts   tables globales justifiées (vide)
¤¤¤

## Contrat d'assemblage utilisé

| Besoin | Mécanisme |
|---|---|
| Routes | ¤export default async function (app, runtime)¤, sans préfixe ; le registre applique ¤/api/v1/${key}¤ |
| Permissions | ¤runtime.requirePermission("${key}.item.read")¤ en ¤preHandler¤ ; clés déclarées dans ¤manifest.ts¤ |
| Features | ¤runtime.entitlements.requireFeature("${key}.<feature>")¤ ; déclarées dans ¤manifest.ts¤ |
| Audit | ¤runtime.auditPort.record(tx, …)¤ dans la transaction du use case, EN DERNIER (port ¤AuditPort¤) |
| Événements | ¤PgOutboxWriter(tx).append([...])¤ dans la même transaction ; payload ¤{ v: 1, … }¤ |
| Contexte | ¤runtime.resolveContext(request)¤ |
| Données | ¤runtime.tenantDb.run(ctx, fn)¤ uniquement (RLS) |

## Permissions

| Clé | Rôle |
|---|---|
| ¤${key}.item.read¤ | consulter les éléments |
| ¤${key}.item.create¤ | créer un élément |

## Événements publiés

| Type | Payload |
|---|---|
| ¤${key}.item.created¤ | ¤{ v: 1, itemId }¤ |

## Tests

¤¤¤bash
pnpm --filter @ecoledigitale/api exec vitest run src/modules/${key}          # unitaires (+ intégration ignorée sans base)
ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --root apps/api src/modules/${key}/test   # intégration
pnpm check:boundaries && pnpm --filter @ecoledigitale/api type-check:v2 && pnpm test:isolation
¤¤¤

## Avant la revue

Cochez la checklist de ¤docs/architecture/new-module-guide.md¤ (README réécrit, plus d'« item » d'exemple, schémas Zod déplacés vers ¤packages/contracts¤,
migrations dans la plage, abonnés/jobs réels ou fichiers vides conservés, worker reconstruit).
`;
  return md.replaceAll("¤", "`");
}
