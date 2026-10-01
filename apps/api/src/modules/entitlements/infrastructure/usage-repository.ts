import { InternalError } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { UsageMetric } from "@ecoledigitale/contracts/src/v2/entitlements";
import type { UsageCounterRecord } from "../domain/entities";

export type UsageMode = "INCREMENT" | "SET" | "MAX";

interface Row {
  metric: UsageMetric;
  period: string;
  value: string;
  updated_at: Date;
}

const toRecord = (r: Row): UsageCounterRecord => {
  const value = Number(r.value);
  if (!Number.isSafeInteger(value)) {
    throw new InternalError("Compteur d'usage hors de la plage des entiers sûrs.", { code: "entitlements.usage_overflow" });
  }
  return { metric: r.metric, period: r.period, value, updatedAt: r.updated_at };
};

const MERGE: Record<UsageMode, string> = {
  INCREMENT: "entitlements.usage_counters.value + EXCLUDED.value",
  SET: "EXCLUDED.value",
  MAX: "GREATEST(entitlements.usage_counters.value, EXCLUDED.value)",
};

/** `period` : premier jour du mois UTC (`YYYY-MM-DD`). Le mode est choisi parmi 3 fragments SQL FIXES. */
export async function upsertUsage(
  tx: Tx,
  u: { id: string; tenantId: string; metric: UsageMetric; period: string; amount: number; mode: UsageMode },
  now: Date,
): Promise<UsageCounterRecord> {
  const row = await tx.queryOne<Row>(
    `INSERT INTO entitlements.usage_counters (id, tenant_id, metric, period, value, created_at, updated_at)
     VALUES ($1, $2, $3, $4::date, $5, $6, $6)
     ON CONFLICT (tenant_id, metric, period) DO UPDATE
        SET value = ${MERGE[u.mode]}, updated_at = EXCLUDED.updated_at
     RETURNING metric, period::text AS period, value::text AS value, updated_at`,
    [u.id, u.tenantId, u.metric, u.period, u.amount, now],
  );
  return toRecord(row as Row);
}

export async function listUsage(
  tx: Tx,
  range: { from: string; to: string; metric?: UsageMetric },
): Promise<UsageCounterRecord[]> {
  const rows = range.metric
    ? await tx.many<Row>(
        `SELECT metric, period::text AS period, value::text AS value, updated_at
           FROM entitlements.usage_counters
          WHERE period BETWEEN $1::date AND $2::date AND metric = $3
          ORDER BY period, metric`,
        [range.from, range.to, range.metric],
      )
    : await tx.many<Row>(
        `SELECT metric, period::text AS period, value::text AS value, updated_at
           FROM entitlements.usage_counters
          WHERE period BETWEEN $1::date AND $2::date
          ORDER BY period, metric`,
        [range.from, range.to],
      );
  return rows.map(toRecord);
}
