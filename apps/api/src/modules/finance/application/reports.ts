/**
 * Requêtes de reporting (lecture seule) : facturé, encaissé, restant dû, retard, taux de
 * recouvrement, créances par classe et par apprenant, évolution des encaissements,
 * balance âgée. Les définitions sont celles de `infrastructure/reports-repository.ts`.
 */
import { err, ok, type AppError, type CurrencyCode, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { assertIsoDate, diffDays } from "../domain/dates";
import { FinanceCode, validation } from "../domain/errors";
import type { IsoDate } from "../domain/types";
import {
  agedBalance,
  agedBalanceByLearner,
  collectionsTrend,
  financeSummary,
  receivablesByGroup,
  receivablesByLearner,
  type AgedBalanceReport,
  type AgedLearnerRow,
  type FinanceSummary,
  type LearnerReceivableRow,
  type ReceivableRow,
  type ReportScope,
  type TrendGranularity,
  type TrendPoint,
} from "../infrastructure/reports-repository";
import { todayOf } from "./billing-core";
import { inTx, type FinanceDeps } from "./deps";

export interface ReportFilter {
  academicYear?: string;
  campusId?: string;
  groupKey?: string;
  /** Date de référence des retards (défaut : aujourd'hui à Abidjan). */
  asOf?: IsoDate;
  currency?: CurrencyCode;
}

export function scopeOf(deps: FinanceDeps, filter: ReportFilter): Result<ReportScope, AppError> {
  const asOf = filter.asOf ?? todayOf(deps);
  try {
    assertIsoDate(asOf, "asOf");
  } catch {
    return err(validation(FinanceCode.INVALID_INPUT, "Date de référence invalide.", "asOf"));
  }
  return ok({
    currency: filter.currency ?? deps.config.defaultCurrency,
    asOf,
    ...(filter.academicYear ? { academicYear: filter.academicYear } : {}),
    ...(filter.campusId ? { campusId: filter.campusId } : {}),
    ...(filter.groupKey ? { groupKey: filter.groupKey } : {}),
  });
}

export async function getFinanceSummary(deps: FinanceDeps, ctx: RequestContext, filter: ReportFilter = {}): Promise<Result<FinanceSummary, AppError>> {
  const scope = scopeOf(deps, filter);
  if (!scope.ok) return scope;
  return inTx(deps, ctx, async (tx) => ok(await financeSummary(tx, scope.value)), { readOnly: true });
}

export async function getReceivablesByGroup(deps: FinanceDeps, ctx: RequestContext, filter: ReportFilter = {}): Promise<Result<ReceivableRow[], AppError>> {
  const scope = scopeOf(deps, filter);
  if (!scope.ok) return scope;
  return inTx(deps, ctx, async (tx) => ok(await receivablesByGroup(tx, scope.value)), { readOnly: true });
}

export async function getReceivablesByLearner(
  deps: FinanceDeps,
  ctx: RequestContext,
  filter: ReportFilter & { limit?: number; offset?: number; onlyOutstanding?: boolean } = {},
): Promise<Result<{ items: LearnerReceivableRow[]; total: number }, AppError>> {
  const scope = scopeOf(deps, filter);
  if (!scope.ok) return scope;
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
  return inTx(
    deps,
    ctx,
    async (tx) => ok(await receivablesByLearner(tx, scope.value, { limit, offset: filter.offset ?? 0, onlyOutstanding: filter.onlyOutstanding ?? true })),
    { readOnly: true },
  );
}

export async function getCollectionsTrend(
  deps: FinanceDeps,
  ctx: RequestContext,
  input: { from: IsoDate; to: IsoDate; granularity?: TrendGranularity; currency?: CurrencyCode },
): Promise<Result<TrendPoint[], AppError>> {
  try {
    assertIsoDate(input.from, "from");
    assertIsoDate(input.to, "to");
  } catch {
    return err(validation(FinanceCode.INVALID_INPUT, "Période invalide (dates ISO attendues).", "from"));
  }
  if (input.to < input.from) return err(validation(FinanceCode.INVALID_INPUT, "La fin de période précède le début.", "to"));
  const granularity = input.granularity ?? "day";
  if (!["day", "week", "month"].includes(granularity)) {
    return err(validation(FinanceCode.INVALID_INPUT, "Granularité inconnue (day, week, month).", "granularity"));
  }
  // Borne la taille de la réponse : au plus 800 seaux.
  const span = diffDays(input.from, input.to) + 1;
  const buckets = granularity === "day" ? span : granularity === "week" ? Math.ceil(span / 7) + 1 : Math.ceil(span / 28) + 1;
  if (buckets > 800) return err(validation(FinanceCode.INVALID_INPUT, "Période trop longue pour cette granularité.", "to"));
  return inTx(
    deps,
    ctx,
    async (tx) => ok(await collectionsTrend(tx, { currency: input.currency ?? deps.config.defaultCurrency, from: input.from, to: input.to, granularity })),
    { readOnly: true },
  );
}

export async function getAgedBalance(
  deps: FinanceDeps,
  ctx: RequestContext,
  filter: ReportFilter & { byLearner?: number } = {},
): Promise<Result<AgedBalanceReport & { learners: AgedLearnerRow[] }, AppError>> {
  const scope = scopeOf(deps, filter);
  if (!scope.ok) return scope;
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const report = await agedBalance(tx, scope.value);
      const learners = filter.byLearner ? await agedBalanceByLearner(tx, scope.value, Math.min(filter.byLearner, 500)) : [];
      return ok({ ...report, learners });
    },
    { readOnly: true },
  );
}

