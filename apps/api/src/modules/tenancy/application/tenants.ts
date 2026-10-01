/**
 * Liste des organisations — réservée à la console plateforme (acteur `system` via `SystemDb`).
 *
 * `kernel.tenants` est une table GLOBALE (sans RLS, colonnes non sensibles) : la liste est lue par une
 * transaction système explicite, jamais par un contexte de tenant. L'autorisation (qui est opérateur de la
 * plateforme) appartient à l'appelant (`SuperAdminAuthorizer`).
 */
import type { AppError, Result } from "@ecoledigitale/kernel";
import { TenantStatusSchema, type TenantStatus } from "@ecoledigitale/contracts/src/v2/tenancy";
import { NotFoundError, ValidationError, err } from "@ecoledigitale/kernel";
import type { TenantRecord } from "../domain/entities";
import { resolveDeps, runSystemResult, type TenancyDeps } from "./support";

export interface TenantListFilter {
  status?: TenantStatus;
  /** Sous-chaîne du slug ou du nom (insensible à la casse). */
  search?: string;
  limit?: number;
  offset?: number;
}

export interface TenantSummary extends TenantRecord {
  createdAt: Date;
}

export interface TenantListPage {
  items: TenantSummary[];
  total: number;
  limit: number;
  offset: number;
}

interface Row {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  created_at: Date;
}

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Une organisation (résumé), ou `NotFoundError`. */
export async function getTenantSummary(deps: TenancyDeps, tenantId: string): Promise<Result<TenantSummary, AppError>> {
  const d = resolveDeps(deps);
  return runSystemResult(
    d.systemDb,
    "tenancy-get-tenant",
    async (tx) => {
      const r = await tx.queryOne<Row>("SELECT id, slug, name, status, created_at FROM kernel.tenants WHERE id = $1", [tenantId]);
      if (!r) throw NotFoundError.of("Organisation", tenantId, { code: "tenancy.tenant_not_found" });
      return { id: r.id, slug: r.slug, name: r.name, status: r.status, createdAt: r.created_at };
    },
    { readOnly: true },
  );
}

export async function listTenants(deps: TenancyDeps, filter: TenantListFilter = {}): Promise<Result<TenantListPage, AppError>> {
  const d = resolveDeps(deps);
  if (filter.status !== undefined && !TenantStatusSchema.safeParse(filter.status).success) {
    return err(ValidationError.field("status", "Statut inconnu.", "tenancy.tenant_status_invalid"));
  }
  const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 50), 1), 200);
  const offset = Math.max(Math.trunc(filter.offset ?? 0), 0);
  const search = filter.search?.trim().slice(0, 100);

  return runSystemResult(
    d.systemDb,
    "tenancy-list-tenants",
    async (tx) => {
      const where: string[] = [];
      const params: unknown[] = [];
      if (filter.status) {
        params.push(filter.status);
        where.push(`status = $${params.length}`);
      }
      if (search) {
        params.push(`%${escapeLike(search)}%`);
        where.push(`(slug ILIKE $${params.length} OR name ILIKE $${params.length})`);
      }
      const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
      const total = await tx.queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM kernel.tenants ${clause}`, params);
      const rows = await tx.many<Row>(
        `SELECT id, slug, name, status, created_at FROM kernel.tenants ${clause}
          ORDER BY created_at, id LIMIT ${limit} OFFSET ${offset}`,
        params,
      );
      return {
        items: rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name, status: r.status, createdAt: r.created_at })),
        total: Number(total?.n ?? 0),
        limit,
        offset,
      };
    },
    { readOnly: true },
  );
}
