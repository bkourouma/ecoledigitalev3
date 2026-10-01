/**
 * Mesure d'usage (apprenants actifs, stockage, SMS) par mois UTC. Le socle ne
 * facture pas et ne bloque pas : il compte (plan §3.5).
 *
 * Mode d'agrégation par défaut, selon la nature de la mesure :
 *   ACTIVE_LEARNERS -> MAX       (pic du mois)
 *   STORAGE_BYTES   -> SET       (jauge : dernière valeur connue)
 *   SMS_SENT        -> INCREMENT (cumul)
 */
import { ValidationError, err, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { RecordUsageSchema, UsageQuerySchema, type UsageMetric } from "@ecoledigitale/contracts/src/v2/entitlements";
import type { UsageCounterRecord } from "../domain/entities";
import { listUsage, upsertUsage, type UsageMode } from "../infrastructure/usage-repository";
import { parseWith, resolveDeps, runResult, type EntitlementsDeps } from "./support";

export const DEFAULT_USAGE_MODE: Readonly<Record<UsageMetric, UsageMode>> = Object.freeze({
  ACTIVE_LEARNERS: "MAX",
  STORAGE_BYTES: "SET",
  SMS_SENT: "INCREMENT",
});

const pad = (n: number): string => String(n).padStart(2, "0");

/** Premier jour du mois UTC de `date`, `YYYY-MM-DD`. */
export function periodOf(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-01`;
}

/** `YYYY-MM` ou `YYYY-MM-DD` -> premier jour du mois, ou `null` si invalide. */
export function parsePeriod(value: string): string | null {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12 || year < 2000 || year > 2200) return null;
  return `${m[1]}-${m[2]}-01`;
}

/** Mois précédent `n` fois (UTC), premier jour. */
export function monthsBefore(period: string, n: number): string {
  const [y, m] = period.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return periodOf(d);
}

export async function recordUsage(
  deps: EntitlementsDeps,
  ctx: RequestContext,
  rawInput: unknown,
): Promise<Result<UsageCounterRecord, AppError>> {
  const d = resolveDeps(deps);
  const parsed = parseWith(RecordUsageSchema, rawInput);
  if (!parsed.ok) return parsed;
  const input = parsed.value;
  const mode = input.mode ?? DEFAULT_USAGE_MODE[input.metric];
  const now = d.clock.now();

  return runResult(d.db, ctx, (tx) =>
    upsertUsage(
      tx,
      { id: d.newId(), tenantId: ctx.tenantId, metric: input.metric, period: periodOf(now), amount: input.amount, mode },
      now,
    ),
  );
}

export async function getUsage(
  deps: EntitlementsDeps,
  ctx: RequestContext,
  rawQuery: unknown = {},
): Promise<Result<UsageCounterRecord[], AppError>> {
  const d = resolveDeps(deps);
  const parsed = parseWith(UsageQuerySchema, rawQuery ?? {});
  if (!parsed.ok) return parsed;
  const q = parsed.value;

  const current = periodOf(d.clock.now());
  const to = q.to ? parsePeriod(q.to) : current;
  const from = q.from ? parsePeriod(q.from) : monthsBefore(to ?? current, 11);
  if (!to || !from) return err(ValidationError.field("period", "Période invalide (AAAA-MM).", "entitlements.period_invalid"));
  if (from > to) return err(ValidationError.field("from", "`from` doit précéder `to`.", "entitlements.period_invalid"));

  return runResult(
    d.db,
    ctx,
    (tx) => listUsage(tx, { from, to, ...(q.metric ? { metric: q.metric } : {}) }),
    { readOnly: true },
  );
}
