/**
 * Caisses : sessions d'ouverture / clôture par caissier, fonds de caisse, écart
 * attendu / compté. Les paiements espèces sont rattachés à la session ouverte du
 * caissier (cf. `recordManualPayment`).
 */
import { err, ok, Money, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { requiresJustification, settleSession, validateOpeningFloat } from "../domain/cash-register";
import { FinanceCode, conflict, notFound, validation } from "../domain/errors";
import { FinanceEvents } from "../domain/events";
import type { CashRegisterRecord, CashSessionRecord } from "../domain/records";
import type { CashSessionStatus, Uuid } from "../domain/types";
import {
  closeCashSessionRow,
  getCashRegister,
  getCashSession,
  getOpenSessionForCashier,
  insertCashRegister,
  insertCashSession,
  listCashRegisters,
  listCashSessions,
  sessionCashMovements,
} from "../infrastructure/cash-repository";
import { EventBuffer, inTx, insertOrConflict, moneyPayload, type FinanceDeps } from "./deps";

export async function createCashRegister(
  deps: FinanceDeps,
  ctx: RequestContext,
  input: { code: string; name: string; campusId?: Uuid | null },
): Promise<Result<CashRegisterRecord, AppError>> {
  const code = (input.code ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(code)) return err(validation(FinanceCode.INVALID_INPUT, "Code de caisse invalide.", "code"));
  const name = (input.name ?? "").trim();
  if (!name) return err(validation(FinanceCode.INVALID_INPUT, "Libellé de caisse requis.", "name"));
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const inserted = await insertOrConflict(
      tx,
      (sp) => insertCashRegister(sp, ctx.tenantId, { id: deps.newId(), code, name, campusId: input.campusId ?? null }),
      () => conflict(FinanceCode.INVALID_INPUT, `Le code de caisse "${code}" existe déjà.`, { code }),
    );
    if (!inserted.ok) return inserted;
    const register = inserted.value;
    events.audit({ action: "finance.cash_register.created", resourceType: "cash_register", resourceId: register.id, after: register });
    await events.flush(tx);
    return ok(register);
  });
}

export async function listRegisters(deps: FinanceDeps, ctx: RequestContext): Promise<Result<CashRegisterRecord[], AppError>> {
  return inTx(deps, ctx, async (tx) => ok(await listCashRegisters(tx)), { readOnly: true });
}

export interface OpenCashSessionInput {
  registerId: Uuid;
  openingFloat: Money;
}

/** Ouvre la session du caissier (l'utilisateur du contexte) sur une caisse. */
export async function openCashSession(
  deps: FinanceDeps,
  ctx: RequestContext,
  input: OpenCashSessionInput,
): Promise<Result<CashSessionRecord, AppError>> {
  if (!ctx.userId) return err(validation(FinanceCode.INVALID_INPUT, "L'ouverture d'une caisse exige un caissier identifié.", "actor"));
  const floor = validateOpeningFloat(input.openingFloat);
  if (!floor.ok) return floor;
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const register = await getCashRegister(tx, input.registerId);
    if (!register) return err(notFound(FinanceCode.CASH_REGISTER_NOT_FOUND, "Caisse", input.registerId));
    if (!register.active) return err(conflict(FinanceCode.CASH_REGISTER_NOT_FOUND, "Cette caisse est désactivée.", { registerId: register.id }));
    const mine = await getOpenSessionForCashier(tx, ctx.userId!);
    if (mine) {
      return err(conflict(FinanceCode.CASH_SESSION_ALREADY_OPEN, "Vous avez déjà une session de caisse ouverte.", { sessionId: mine.id }));
    }
    let session: CashSessionRecord;
    try {
      // Les index uniques partiels (une session ouverte par caisse et par caissier) tranchent les courses.
      session = await tx.transaction((sp) =>
        insertCashSession(sp, ctx.tenantId, {
          id: deps.newId(),
          registerId: input.registerId,
          cashierId: ctx.userId!,
          openingFloat: input.openingFloat,
          openedAt: deps.clock.now(),
        }),
      );
    } catch (e) {
      if ((e as { code?: string }).code === "23505") {
        return err(conflict(FinanceCode.CASH_SESSION_ALREADY_OPEN, "Cette caisse (ou ce caissier) a déjà une session ouverte.", {}));
      }
      throw e;
    }
    events.add(
      FinanceEvents.CASH_SESSION_OPENED,
      { v: 1, sessionId: session.id, registerId: session.registerId, cashierId: ctx.userId!, openingFloat: moneyPayload(session.openingFloat) },
      { type: "cash_session", id: session.id },
    );
    events.audit({
      action: "finance.cash_session.opened",
      resourceType: "cash_session",
      resourceId: session.id,
      after: { registerId: session.registerId, openingFloat: session.openingFloat.amount },
    });
    await events.flush(tx);
    return ok(session);
  });
}

export interface CloseCashSessionInput {
  sessionId: Uuid;
  countedAmount: Money;
  /** Justification de l'écart (obligatoire au-delà de la tolérance configurée). */
  note?: string;
}

export interface CashSessionSummary {
  session: CashSessionRecord;
  movements: { received: Money; refunded: Money; paymentCount: number; refundCount: number };
}

/**
 * Clôture une session : attendu = fonds + espèces encaissées − espèces remboursées ;
 * écart = compté − attendu. Le caissier ferme sa propre session (sinon permission de
 * gestion de caisse côté HTTP). `FOR UPDATE` attend les encaissements en cours.
 */
export async function closeCashSession(
  deps: FinanceDeps,
  ctx: RequestContext,
  input: CloseCashSessionInput,
): Promise<Result<CashSessionSummary, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const session = await getCashSession(tx, input.sessionId, { forUpdate: true });
    if (!session) return err(notFound(FinanceCode.CASH_SESSION_NOT_FOUND, "Session de caisse", input.sessionId));
    if (session.status !== "OPEN") {
      return err(conflict(FinanceCode.CASH_SESSION_CLOSED, "Cette session est déjà clôturée.", { sessionId: session.id }));
    }
    const currency = session.openingFloat.currency;
    const movements = await sessionCashMovements(tx, session.id, currency);
    const settlement = settleSession(
      { openingFloat: session.openingFloat, cashReceived: movements.received, cashRefunded: movements.refunded },
      input.countedAmount,
    );
    if (!settlement.ok) return settlement;
    const tolerance = Money.of(deps.config.cashVarianceTolerance, currency);
    const note = input.note?.trim() || null;
    if (requiresJustification(settlement.value.variance, tolerance) && !note) {
      return err(
        validation(
          FinanceCode.INVALID_INPUT,
          `Écart de caisse de ${settlement.value.variance.amount} ${currency} : une justification est obligatoire.`,
          "note",
          { variance: settlement.value.variance.amount },
        ),
      );
    }
    const closed = await closeCashSessionRow(tx, session.id, {
      closedAt: deps.clock.now(),
      expected: settlement.value.expected,
      counted: settlement.value.counted,
      variance: settlement.value.variance,
      note,
    });
    events.add(
      FinanceEvents.CASH_SESSION_CLOSED,
      {
        v: 1,
        sessionId: closed.id,
        registerId: closed.registerId,
        cashierId: closed.cashierId,
        openingFloat: moneyPayload(closed.openingFloat),
        expected: moneyPayload(settlement.value.expected),
        counted: moneyPayload(settlement.value.counted),
        variance: moneyPayload(settlement.value.variance),
      },
      { type: "cash_session", id: closed.id },
    );
    events.audit({
      action: "finance.cash_session.closed",
      resourceType: "cash_session",
      resourceId: closed.id,
      after: {
        expected: settlement.value.expected.amount,
        counted: settlement.value.counted.amount,
        variance: settlement.value.variance.amount,
        note,
      },
      sensitive: settlement.value.variance.amount !== 0,
    });
    await events.flush(tx);
    return ok({ session: closed, movements });
  });
}

export async function getCashSessionSummary(deps: FinanceDeps, ctx: RequestContext, sessionId: Uuid): Promise<Result<CashSessionSummary, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const session = await getCashSession(tx, sessionId);
      if (!session) return err(notFound(FinanceCode.CASH_SESSION_NOT_FOUND, "Session de caisse", sessionId));
      return ok({ session, movements: await sessionCashMovements(tx, sessionId, session.openingFloat.currency) });
    },
    { readOnly: true },
  );
}

export async function listSessionPage(
  deps: FinanceDeps,
  ctx: RequestContext,
  filter: { registerId?: Uuid; cashierId?: Uuid; status?: CashSessionStatus; limit?: number; offset?: number } = {},
): Promise<Result<CashSessionRecord[], AppError>> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  return inTx(deps, ctx, async (tx) => ok(await listCashSessions(tx, { ...filter, limit, offset: filter.offset ?? 0 })), { readOnly: true });
}

export async function getMyOpenSession(deps: FinanceDeps, ctx: RequestContext): Promise<Result<CashSessionRecord | null, AppError>> {
  if (!ctx.userId) return ok(null);
  return inTx(deps, ctx, async (tx) => ok(await getOpenSessionForCashier(tx, ctx.userId!)), { readOnly: true });
}
