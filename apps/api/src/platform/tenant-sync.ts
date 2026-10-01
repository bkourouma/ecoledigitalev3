/**
 * Synchronisation À SENS UNIQUE `public.tenants` (legacy) -> `kernel.tenants` (v2).
 *
 * Pendant la coexistence (conventions de modules), `kernel.tenants` est la source de
 * vérité des modules v2 et le legacy reste la source de vérité de l'existence d'un tenant :
 * mêmes UUID, jamais de flux retour. La synchronisation :
 *   - tourne au démarrage de l'API (tous les tenants) ;
 *   - est appelable par le provisioning legacy via `syncTenantToKernel(tenantId)` ;
 *   - est « au mieux » côté provisioning : une panne v2 ne doit JAMAIS faire échouer
 *     la création d'un tenant legacy (l'échec est journalisé, le prochain démarrage rattrape) ;
 *   - est sans effet tant que la plateforme v2 n'est pas configurée (V2_DATABASE_URL absent).
 *
 * Écarts de modèle gérés :
 *   - `kernel.tenants.slug` est contraint (`^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$`) ; les slugs
 *     legacy sont libres : on normalise, et en cas de collision on suffixe par l'UUID ;
 *   - `is_active = false` -> `status = 'suspended'` ; un tenant archivé côté v2 le reste.
 *
 * Ce fichier n'importe NI `pg` NI `@ecoledigitale/database` (types seulement) pour que le
 * provisioning legacy puisse l'importer sans charger les paquets v2.
 */
import type { SystemDb } from "@ecoledigitale/database";
import type { Logger } from "@ecoledigitale/kernel";

export interface LegacyTenantRow {
  id: string;
  slug: string;
  name: string;
  is_active: boolean | null;
}

export interface KernelTenant {
  id: string;
  slug: string;
  name: string;
  status: "active" | "suspended";
}

/** Client legacy minimal : `pg.PoolClient`, `pg.Pool` ou transaction en cours. */
export interface LegacyQueryable {
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
}

export interface LegacyPoolLike {
  connect(): Promise<LegacyQueryable & { release(): void }>;
}

// ---------------------------------------------------------------------------
// Fonctions pures
// ---------------------------------------------------------------------------

const KERNEL_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/;

/** Slug conforme à la contrainte de `kernel.tenants`, déterministe pour un (slug, id) donné. */
export function normalizeKernelSlug(slug: string, id: string): string {
  const fallback = `t-${id.replace(/-/g, "").slice(0, 8).toLowerCase()}`;
  const cleaned = String(slug ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return KERNEL_SLUG_RE.test(cleaned) ? cleaned : fallback;
}

/** Slug de repli en cas de collision d'unicité : base tronquée + 8 premiers caractères de l'UUID. */
export function disambiguateSlug(base: string, id: string): string {
  const suffix = id.replace(/-/g, "").slice(0, 8).toLowerCase();
  return `${base.slice(0, 50 - 1 - suffix.length).replace(/-+$/g, "")}-${suffix}`;
}

export function legacyRowToKernelTenant(row: LegacyTenantRow): KernelTenant {
  const name = String(row.name ?? "").trim() || row.slug || row.id;
  return {
    id: row.id.toLowerCase(),
    slug: normalizeKernelSlug(row.slug, row.id),
    name,
    status: row.is_active === false ? "suspended" : "active",
  };
}

// ---------------------------------------------------------------------------
// Écriture dans kernel.tenants
// ---------------------------------------------------------------------------

const UPSERT_SQL = `
  INSERT INTO kernel.tenants (id, slug, name, status)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (id) DO UPDATE
     SET slug       = EXCLUDED.slug,
         name       = EXCLUDED.name,
         status     = CASE WHEN kernel.tenants.status = 'archived' THEN 'archived' ELSE EXCLUDED.status END,
         updated_at = now()
`;

interface TxLike {
  query(sql: string, params?: readonly unknown[]): Promise<unknown>;
  transaction<T>(fn: (tx: TxLike) => Promise<T>): Promise<T>;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

/** Upsert d'un tenant ; en cas de collision de slug (autre id), retente avec un slug suffixé. */
export async function upsertKernelTenant(tx: TxLike, tenant: KernelTenant): Promise<{ slug: string; disambiguated: boolean }> {
  try {
    await tx.transaction((inner) => inner.query(UPSERT_SQL, [tenant.id, tenant.slug, tenant.name, tenant.status]));
    return { slug: tenant.slug, disambiguated: false };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const slug = disambiguateSlug(tenant.slug, tenant.id);
    await tx.transaction((inner) => inner.query(UPSERT_SQL, [tenant.id, slug, tenant.name, tenant.status]));
    return { slug, disambiguated: true };
  }
}

// ---------------------------------------------------------------------------
// Configuration globale (posée au démarrage par v2-bootstrap)
// ---------------------------------------------------------------------------

export interface TenantSyncConfig {
  systemDb: SystemDb;
  logger: Pick<Logger, "info" | "warn" | "error">;
  /** Utilisé quand l'appelant ne fournit pas de source (au démarrage, rattrapage). */
  legacyPool?: LegacyPoolLike;
}

let config: TenantSyncConfig | null = null;

export function configureTenantSync(next: TenantSyncConfig | null): void {
  config = next;
}

export function isTenantSyncConfigured(): boolean {
  return config !== null;
}

export type SyncOutcome = "synced" | "skipped" | "failed";

const SELECT_ONE = "SELECT id, slug, name, is_active FROM public.tenants WHERE id = $1";
const SELECT_ALL = "SELECT id, slug, name, is_active FROM public.tenants ORDER BY created_at ASC, id ASC";

async function writeTenants(cfg: TenantSyncConfig, rows: readonly LegacyTenantRow[], reason: string) {
  const outcomes: Array<{ id: string; slug: string; disambiguated: boolean }> = [];
  await cfg.systemDb.run(reason, async (tx) => {
    for (const row of rows) {
      const tenant = legacyRowToKernelTenant(row);
      const written = await upsertKernelTenant(tx as unknown as TxLike, tenant);
      outcomes.push({ id: tenant.id, slug: written.slug, disambiguated: written.disambiguated });
    }
  });
  return outcomes;
}

/**
 * Synchronise UN tenant legacy vers `kernel.tenants`.
 *
 * `options.source` : client legacy à utiliser pour lire la ligne `public.tenants`. À fournir
 * quand l'appelant est DANS la transaction qui vient de créer le tenant (la ligne n'est pas
 * encore visible d'une autre connexion). Sans source, le pool legacy configuré est utilisé.
 *
 * Ne lève jamais (sauf `strict: true`) : retourne `skipped` si la plateforme v2 n'est pas
 * configurée, `failed` en cas d'erreur (journalisée).
 */
export async function syncTenantToKernel(
  tenantId: string,
  options: { source?: LegacyQueryable; strict?: boolean } = {},
): Promise<SyncOutcome> {
  const cfg = config;
  if (!cfg) return "skipped";

  try {
    let rows: LegacyTenantRow[];
    if (options.source) {
      rows = (await options.source.query(SELECT_ONE, [tenantId])).rows as LegacyTenantRow[];
    } else if (cfg.legacyPool) {
      const client = await cfg.legacyPool.connect();
      try {
        rows = (await client.query(SELECT_ONE, [tenantId])).rows as LegacyTenantRow[];
      } finally {
        client.release();
      }
    } else {
      cfg.logger.warn({ tenantId }, "tenant-sync : aucune source legacy disponible, synchronisation ignorée");
      return "skipped";
    }

    if (rows.length === 0) {
      cfg.logger.warn({ tenantId }, "tenant-sync : tenant introuvable dans public.tenants, rien à synchroniser");
      return "skipped";
    }
    const [written] = await writeTenants(cfg, rows, "tenant-sync-one");
    if (written?.disambiguated) {
      cfg.logger.warn({ tenantId, slug: written.slug }, "tenant-sync : slug en collision dans kernel.tenants, suffixé par l'UUID");
    }
    return "synced";
  } catch (error) {
    if (options.strict) throw error;
    cfg.logger.error(
      { tenantId, err: error instanceof Error ? error.message : String(error) },
      "tenant-sync : échec de synchronisation vers kernel.tenants (le tenant legacy n'est pas affecté)",
    );
    return "failed";
  }
}

export interface SyncAllReport {
  total: number;
  disambiguated: number;
}

/** Synchronise TOUS les tenants legacy (démarrage). Lève en cas d'erreur : la plateforme v2 est inutilisable. */
export async function syncAllTenantsToKernel(source?: LegacyQueryable): Promise<SyncAllReport> {
  const cfg = config;
  if (!cfg) return { total: 0, disambiguated: 0 };

  let rows: LegacyTenantRow[];
  if (source) {
    rows = (await source.query(SELECT_ALL)).rows as LegacyTenantRow[];
  } else if (cfg.legacyPool) {
    const client = await cfg.legacyPool.connect();
    try {
      rows = (await client.query(SELECT_ALL)).rows as LegacyTenantRow[];
    } finally {
      client.release();
    }
  } else {
    return { total: 0, disambiguated: 0 };
  }

  const written = await writeTenants(cfg, rows, "tenant-sync-all");
  const disambiguated = written.filter((w) => w.disambiguated).length;
  cfg.logger.info({ total: written.length, disambiguated }, `tenant-sync : ${written.length} tenant(s) synchronisé(s) vers kernel.tenants`);
  return { total: written.length, disambiguated };
}
