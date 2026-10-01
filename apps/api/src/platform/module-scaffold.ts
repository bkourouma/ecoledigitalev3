/**
 * Générateur de squelette de module conforme à `docs/architecture/module-conventions.md`
 * (utilisé par `pnpm module:new <key>`).
 *
 * Crée, sous `apps/api/src/modules/<key>/` : manifest, index (API publique), migration 0001
 * (schéma + table d'exemple de tenant + `enable_tenant_rls` + droits), domain / application /
 * infrastructure / http, et un test Vitest. Le squelette est un EXEMPLE minimal (entité `item`)
 * à remplacer ; il passe les règles de frontières et le test d'isolation tel quel.
 *
 * Il n'existe volontairement AUCUN `modules/_template` actif : le gabarit vit dans ce code.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DEFAULT_MODULES_DIR } from "../modules/registry-discovery";

export const MODULE_KEY_RE = /^[a-z][a-z0-9_]{1,29}$/;
const RESERVED_KEYS = new Set(["kernel", "public", "information_schema", "test", "registry", "platform", "node_modules"]);

export class ScaffoldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScaffoldError";
  }
}

export function validateModuleKey(key: string): void {
  if (!MODULE_KEY_RE.test(key)) {
    throw new ScaffoldError(
      `Clé de module invalide : "${key}". Attendu : minuscules, chiffres et "_", 2 à 30 caractères, commençant par une lettre ` +
        "(c'est aussi le nom du schéma Postgres).",
    );
  }
  if (RESERVED_KEYS.has(key) || key.startsWith("pg_")) {
    throw new ScaffoldError(`Clé de module réservée : "${key}".`);
  }
}

function titleOf(key: string): string {
  const words = key.split("_").filter(Boolean).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Contenu des fichiers du squelette, indexé par chemin relatif au dossier du module. */
export function renderModuleFiles(key: string): Record<string, string> {
  validateModuleKey(key);
  const title = titleOf(key);
  const label = title.toLowerCase();

  const files: Record<string, string> = {};

  files["manifest.ts"] = `import { defineModule } from "@ecoledigitale/kernel";

/**
 * Manifeste du module "${key}" : source de vérité de ses permissions, features, menus et événements
 * (le RBAC, les entitlements et la navigation se génèrent à partir de là). Le nom du dossier,
 * la clé et le schéma Postgres sont identiques.
 */
export default defineModule({
  key: "${key}",
  title: "${title}",
  packs: ["CORE"],
  dependsOn: [],
  permissions: [
    { key: "${key}.item.read", label: "Consulter les éléments (${label})" },
    { key: "${key}.item.create", label: "Créer un élément (${label})" },
  ],
  features: [],
  menus: [],
  events: {
    publishes: ["${key}.item.created"],
    consumes: [],
  },
});
`;

  files["index.ts"] = `/**
 * API publique du module "${key}" : SEUL point d'import autorisé pour les autres modules
 * (règle dependency-cruiser \`pnpm check:boundaries\`). N'exportez que ce qui est destiné aux autres.
 */
export type { Item } from "./domain/item";
export { createItem, listItems, type ItemsDeps } from "./application/items";
`;

  files["migrations/0001_init.sql"] = `-- =============================================================================
-- 0001 — Module ${key} : schéma et table d'exemple
-- =============================================================================
-- Exécutée par le runner de @ecoledigitale/database sous le rôle \`migrator\`.
-- Règles (docs/architecture/module-conventions.md) :
--   - un module = un schéma du même nom ;
--   - toute table métier : tenant_id uuid NOT NULL REFERENCES kernel.tenants(id),
--     puis kernel.enable_tenant_rls(...), puis GRANT ... TO app_user ;
--   - jamais de clé étrangère vers le schéma d'un autre module (seul kernel.tenants est admis) ;
--   - une table globale (sans tenant_id) se déclare dans isolation-allowlist.${key}.ts avec sa justification.
-- Un fichier appliqué ne se modifie JAMAIS : corrigez par une nouvelle migration (0002_...).
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

  files["domain/item.ts"] = `/**
 * Domaine : entités et règles PURES. Aucun import de pg, fastify ou d'infrastructure
 * (imposé par \`pnpm check:boundaries\`).
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

  files["infrastructure/item-repository.ts"] = `/**
 * Infrastructure : SQL via le \`Tx\` d'un \`TenantDb.run\` (jamais de pool direct). La RLS isole par tenant ;
 * on écrit quand même \`tenant_id\` à l'insertion (colonne NOT NULL, WITH CHECK de la policy).
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

  files["application/items.ts"] = `/**
 * Application : un cas d'usage = une fonction \`(deps, ctx, input) => Promise<Result<T, E>>\`.
 * La transaction (TenantDb.run) et l'événement d'outbox sont écrits ensemble.
 */
import { PgOutboxWriter, type TenantDb } from "@ecoledigitale/database";
import { createDomainEvent, newId, ok, type AppError, type Clock, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { normalizeLabel, type Item } from "../domain/item";
import { insertItem, selectItems } from "../infrastructure/item-repository";

export interface ItemsDeps {
  tenantDb: TenantDb;
  clock: Clock;
}

export async function createItem(deps: ItemsDeps, ctx: RequestContext, input: { label: unknown }): Promise<Result<Item, AppError>> {
  const label = normalizeLabel(input.label);
  if (!label.ok) return label;

  const item: Item = { id: newId(), tenantId: ctx.tenantId, label: label.value, createdAt: deps.clock.now() };
  await deps.tenantDb.run(ctx, async (tx) => {
    await insertItem(tx, item);
    await new PgOutboxWriter(tx).append([
      createDomainEvent({
        type: "${key}.item.created",
        ctx,
        clock: deps.clock,
        aggregateType: "${key}.item",
        aggregateId: item.id,
        payload: { v: 1, itemId: item.id },
      }),
    ]);
  });
  return ok(item);
}

export async function listItems(deps: ItemsDeps, ctx: RequestContext): Promise<Item[]> {
  return await deps.tenantDb.run(ctx, (tx) => selectItems(tx), { readOnly: true });
}
`;

  files["http/plugin.ts"] = `/**
 * Plugin Fastify du module "${key}", chargé automatiquement par le registre sous /api/v1/${key}.
 * Le registre fournit : gestionnaire d'erreurs (kernel -> HTTP) et garde « request.ctx présent ».
 *
 * TODO(contracts) : déplacer les schémas Zod dans packages/contracts/src/v2/${key}.ts
 * et les réexporter depuis packages/contracts/src/v2/index.ts (convention n°9).
 * TODO(rbac) : ajouter \`preHandler: requirePermission("${key}.item.read")\` dès que le module rbac est disponible.
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ValidationError, systemClock } from "@ecoledigitale/kernel";
import { createItem, listItems } from "../application/items";

const createItemBody = z.object({ label: z.string() });

const plugin: FastifyPluginAsync = async (app) => {
  const deps = { tenantDb: app.v2.tenantDb, clock: systemClock };

  app.get("/items", async (request) => ({ items: await listItems(deps, request.ctx) }));

  app.post("/items", async (request, reply) => {
    const body = createItemBody.safeParse(request.body);
    if (!body.success) {
      throw new ValidationError(
        "Données invalides.",
        body.error.issues.map((i) => ({ path: i.path, message: i.message, code: i.code })),
      );
    }
    const result = await createItem(deps, request.ctx, body.data);
    if (!result.ok) throw result.error;
    return reply.status(201).send(result.value);
  });
};

export default plugin;
`;

  files[`test/${key}.test.ts`] = `import { describe, expect, it } from "vitest";
import { resolveModuleOrder } from "@ecoledigitale/kernel";
import manifest from "../manifest";
import { normalizeLabel } from "../domain/item";

describe("module ${key}", () => {
  it("déclare un manifeste valide dont les permissions sont préfixées par la clé", () => {
    expect(manifest.key).toBe("${key}");
    expect(manifest.permissions.length).toBeGreaterThan(0);
    for (const permission of manifest.permissions) expect(permission.key.startsWith("${key}.")).toBe(true);
    expect(() => resolveModuleOrder([manifest])).not.toThrow();
  });

  it("normalise et valide le libellé d'un élément", () => {
    expect(normalizeLabel("  Mon   élément ")).toEqual({ ok: true, value: "Mon élément" });
    expect(normalizeLabel("   ").ok).toBe(false);
    expect(normalizeLabel("x".repeat(500)).ok).toBe(false);
  });
});
`;

  return files;
}

export interface ScaffoldOptions {
  key: string;
  modulesDir?: string;
}

export interface ScaffoldResult {
  dir: string;
  files: string[];
}

/** Écrit le squelette ; refuse d'écraser un module existant. */
export function scaffoldModule(options: ScaffoldOptions): ScaffoldResult {
  validateModuleKey(options.key);
  const modulesDir = resolve(options.modulesDir ?? DEFAULT_MODULES_DIR);
  const dir = join(modulesDir, options.key);
  if (existsSync(dir)) {
    throw new ScaffoldError(`Le module "${options.key}" existe déjà (${dir}) : rien n'a été écrit.`);
  }

  const files = renderModuleFiles(options.key);
  for (const [relative, content] of Object.entries(files)) {
    const target = join(dir, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, { encoding: "utf8", flag: "wx" });
  }
  return { dir, files: Object.keys(files).sort() };
}
