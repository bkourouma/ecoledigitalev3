/**
 * SystemDb : accès EXPLICITE pour les jobs et les opérations de plateforme.
 *
 * Contrairement à l'ancien comportement (« pas de contexte ⇒ super-admin »),
 * rien n'est implicite ici :
 *   - chaque appel déclare une RAISON, journalisée (début, fin, durée, issue) et
 *     posée dans `app.reason` pour les journaux Postgres/triggers d'audit ;
 *   - l'acteur est `system` ; il N'EXISTE PAS de super-utilisateur caché : la
 *     RLS s'applique exactement comme pour un tenant ;
 *   - `run(reason)` n'a AUCUN tenant : il ne voit que les tables globales
 *     (`kernel.tenants`) ; les tables de tenant y apparaissent vides ;
 *   - pour travailler sur des données de tenant : `runForTenant` (un tenant) ou
 *     `forEachTenant` (une transaction par tenant, isolation préservée).
 */
import {
  ValidationError,
  consoleLogger,
  isUuid,
  newId,
  runWithContext,
  createSystemContext,
  type Logger,
} from "@ecoledigitale/kernel";
import type { SessionSettings } from "./executor";
import type { TenantDb } from "./tenant-db";
import type { RunOptions, Tx } from "./types";

export interface SystemDbOptions {
  logger?: Logger;
}

export interface TenantRef {
  id: string;
  slug: string;
}

export interface ForEachTenantReport<R> {
  succeeded: Array<{ tenantId: string; slug: string; result: R }>;
  failed: Array<{ tenantId: string; slug: string; error: unknown }>;
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function validateReason(reason: unknown): string {
  if (typeof reason !== "string") {
    throw ValidationError.field("reason", "Une raison explicite est obligatoire pour SystemDb.", "reason_required");
  }
  const r = reason.trim();
  if (r.length < 5 || r.length > 200 || CONTROL_CHARS.test(r)) {
    throw ValidationError.field(
      "reason",
      "La raison doit faire 5 à 200 caractères, sans caractère de contrôle (ex. « outbox-relay »).",
      "reason_invalid",
    );
  }
  return r;
}

export class SystemDb {
  private readonly logger: Logger;

  constructor(
    private readonly tenantDb: TenantDb,
    options: SystemDbOptions = {},
  ) {
    this.logger = options.logger ?? consoleLogger;
  }

  /** Transaction système SANS tenant (tables globales uniquement). */
  async run<T>(reason: string, fn: (tx: Tx) => Promise<T>, options?: RunOptions): Promise<T> {
    const r = validateReason(reason);
    const settings: SessionSettings = {
      tenantId: "",
      userId: "",
      actor: "system",
      requestId: newId(),
      reason: r,
    };
    return await this.audited(r, undefined, settings, fn, options);
  }

  /** Transaction système sur UN tenant (la RLS filtre sur ce tenant). */
  async runForTenant<T>(
    reason: string,
    tenantId: string,
    fn: (tx: Tx) => Promise<T>,
    options?: RunOptions,
  ): Promise<T> {
    const r = validateReason(reason);
    if (!isUuid(tenantId)) {
      throw ValidationError.field("tenantId", "tenantId doit être un UUID valide.", "invalid_uuid");
    }
    const ctx = createSystemContext(tenantId);
    const settings: SessionSettings = {
      tenantId: ctx.tenantId,
      userId: "",
      actor: "system",
      requestId: ctx.requestId,
      reason: r,
    };
    return await this.audited(r, ctx.tenantId, settings, fn, options, (inner) => runWithContext(ctx, inner));
  }

  /**
   * Exécute `fn` une fois par tenant ACTIF, chacun dans SA transaction (un
   * échec n'annule pas les autres). Les échecs sont journalisés et rapportés,
   * jamais avalés en silence : à l'appelant de décider quoi en faire.
   */
  async forEachTenant<R>(
    reason: string,
    fn: (tx: Tx, tenant: TenantRef) => Promise<R>,
    options: { continueOnError?: boolean } = {},
  ): Promise<ForEachTenantReport<R>> {
    const r = validateReason(reason);
    const tenants = await this.run(
      `${r} :: list-tenants`.slice(0, 200),
      (tx) => tx.many<TenantRef>("SELECT id, slug FROM kernel.tenants WHERE status = 'active' ORDER BY created_at, id"),
      { readOnly: true },
    );

    const report: ForEachTenantReport<R> = { succeeded: [], failed: [] };
    for (const tenant of tenants) {
      try {
        const result = await this.runForTenant(r, tenant.id, (tx) => fn(tx, tenant));
        report.succeeded.push({ tenantId: tenant.id, slug: tenant.slug, result });
      } catch (error) {
        report.failed.push({ tenantId: tenant.id, slug: tenant.slug, error });
        if (options.continueOnError === false) throw error;
      }
    }
    return report;
  }

  private async audited<T>(
    reason: string,
    tenantId: string | undefined,
    settings: SessionSettings,
    fn: (tx: Tx) => Promise<T>,
    options: RunOptions | undefined,
    wrap?: <R>(inner: () => R) => R,
  ): Promise<T> {
    const startedAt = Date.now();
    const base = { event: "system_db", reason, requestId: settings.requestId, ...(tenantId ? { tenantId } : {}) };
    this.logger.info({ ...base, phase: "start" }, "SystemDb: début");
    try {
      const result = await this.tenantDb.executor.execute(settings, fn, options, wrap);
      this.logger.info({ ...base, phase: "end", outcome: "committed", durationMs: Date.now() - startedAt }, "SystemDb: fin");
      return result;
    } catch (error) {
      this.logger.warn(
        {
          ...base,
          phase: "end",
          outcome: "rolled_back",
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        },
        "SystemDb: annulée",
      );
      throw error;
    }
  }
}
