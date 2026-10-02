/**
 * Jauges métier lues en base, sans donnée personnelle (ADR-009) : paiements restés `PENDING`.
 *
 * EXCEPTION ASSUMÉE à la règle « aucune requête SQL ne touche le schéma d'un autre module » : une lecture agrégée (nombre,
 * âge) de `finance.payments`, depuis l'infrastructure d'exploitation, une transaction courte par tenant sous la RLS du tenant
 * (`SystemDb.forEachTenant`). Le contrat est figé par un test contre le vrai schéma migré (test/observability) : si finance
 * renomme `status` ou `created_at`, il échoue. Une table absente (module non déployé) désactive la jauge sans erreur.
 */
import type { SystemDb } from "@ecoledigitale/database";
import type { Logger } from "../logger";
import type { PaymentsPending } from "./metrics";

export const PAYMENTS_PENDING_SQL = `
  SELECT count(*)::int AS pending,
         count(*) FILTER (WHERE created_at < now() - ($1::int * interval '1 minute'))::int AS stale,
         COALESCE(EXTRACT(EPOCH FROM (now() - min(created_at))), 0)::float8 AS oldest_seconds
    FROM finance.payments
   WHERE status = 'PENDING'`;

export interface BusinessGaugesOptions {
  systemDb: SystemDb;
  logger: Logger;
  intervalMs: number;
  staleMinutes: number;
}

export class BusinessGauges {
  private payments: PaymentsPending | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private warned = false;

  constructor(private readonly options: BusinessGaugesOptions) {}

  paymentsPending(): PaymentsPending | null {
    return this.payments;
  }

  /** Un passage sur tous les tenants (exposé pour les tests). */
  async refresh(): Promise<void> {
    this.running ??= this.compute().finally(() => {
      this.running = null;
    });
    await this.running;
  }

  private async compute(): Promise<void> {
    const { systemDb, logger, staleMinutes } = this.options;
    try {
      const present = await systemDb.run("metrics:payments-pending:probe", (tx) => tx.queryOne<{ ok: boolean }>("SELECT to_regclass('finance.payments') IS NOT NULL AS ok"), { readOnly: true });
      if (!present?.ok) {
        this.payments = null; // module non déployé : pas de série
        return;
      }
      let count = 0;
      let stale = 0;
      let oldest = 0;
      const report = await systemDb.forEachTenant(
        "metrics:payments-pending",
        async (tx) => {
          const row = await tx.queryOne<{ pending: number; stale: number; oldest_seconds: number }>(PAYMENTS_PENDING_SQL, [staleMinutes]);
          return { pending: row?.pending ?? 0, stale: row?.stale ?? 0, oldest: row?.oldest_seconds ?? 0 };
        },
      );
      for (const ok of report.succeeded) {
        count += ok.result.pending;
        stale += ok.result.stale;
        oldest = Math.max(oldest, ok.result.oldest);
      }
      // Un tenant en échec laisse la valeur précédente en place plutôt que d'annoncer « 0 » à tort.
      if (report.failed.length === 0 || this.payments === null) this.payments = { count, stale, oldestSeconds: oldest };
      if (report.failed.length > 0 && !this.warned) {
        this.warned = true;
        logger.warn({ tenantsFailed: report.failed.length }, "jauges métier : lecture des paiements en attente incomplète");
      }
    } catch (err) {
      if (!this.warned) {
        this.warned = true;
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, "jauges métier : paiements en attente indisponibles");
      }
    }
  }

  start(): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.options.intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running?.catch(() => undefined);
  }
}
