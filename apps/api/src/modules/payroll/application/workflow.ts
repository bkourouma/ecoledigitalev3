/**
 * Cycle de vie d'un bulletin (spec 032 US6-US7) : arrêter (approuver), verser (payer), contester, annuler,
 * saisir primes et retenues, notifier. Trois actes, trois traces : calculer, arrêter, verser — chacun avec son
 * auteur et sa date ; arrêter n'est JAMAIS verser.
 *
 *  - transitions : CALCULATED → APPROVED → PAID ; contestation ; annulation. Le domaine répond proprement, la
 *    base (déclencheur `payslips_guard`) refuse tout le reste, quel que soit l'écrivain : jamais annulé → payé,
 *    jamais de statut libre, et l'auteur est TOUJOURS l'utilisateur authentifié (le legacy codait un UUID en dur) ;
 *  - actions de masse : `{ payslipIds }` explicite OU `{ all: true, periodId }` calculé CÔTÉ SERVEUR ; une liste
 *    vide ne vaut JAMAIS « tout » ; chaque bulletin est traité dans sa transaction, le lot est PARTIEL (les
 *    éligibles passent, les autres reviennent avec leur motif) et IDEMPOTENT (arrêter un bulletin déjà arrêté
 *    ne redate rien) ;
 *  - « tout archiver » du legacy ressuscitait des bulletins annulés : ici un bulletin annulé est terminal et n'est
 *    jamais éligible ;
 *  - séparation des tâches (réglable) et seuil propriétaire : contrôlés ici ET par la base ;
 *  - identité de l'acteur FIGÉE dans le journal ; événements outbox ; audit dans la même transaction.
 */
import { err, isAppError, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { PayrollCodes, conflict, invalid, invalidTransition, notFound, payslipLocked, reasonRequired } from "../domain/errors";
import { PayrollEvents, type PayslipEventPayload } from "../domain/events";
import type { PayPeriodRecord, PayslipRecord } from "../domain/records";
import { canTransition, requiresOwnerApproval, separationOfDutiesAllows } from "../domain/state";
import { HOUR_SOURCE_KINDS, type AdjustmentKind, type HourSourceKind, type PaymentMethod, type PayslipStatus, type Uuid } from "../domain/types";
import { mapDbError } from "../infrastructure/db-errors";
import * as repo from "../infrastructure/payslip-repo";
import * as setup from "../infrastructure/setup-repo";
import { EventBuffer, inTx, setOwnerApproval, type PayrollDeps } from "./deps";
import type { HoursSourcePort } from "./ports";
import { buildSnapshot, snapshotHash } from "./snapshots";
import { MIN_REASON_LENGTH, PAYSLIP_AGGREGATE, requireUser, resolveActor, staffInfoMap, trimReason } from "./support";

export const MAX_BATCH = 500;

export type Selection = { payslipIds: readonly Uuid[] } | { all: true; periodId: Uuid };

export interface BatchRejection {
  readonly payslipId: Uuid;
  readonly code: string;
  readonly message: string;
}

export interface BatchResult {
  /** Bulletins dont l'état vient de changer. */
  readonly done: readonly Uuid[];
  /** Déjà dans l'état demandé : idempotent, rien n'est redaté. */
  readonly unchanged: readonly Uuid[];
  readonly rejected: readonly BatchRejection[];
}

const reject = (payslipId: Uuid, e: AppError): BatchRejection => ({ payslipId, code: e.code, message: e.message });

/** Capacités de l'appelant, déduites des permissions par la couche HTTP (jamais d'un rôle codé en dur). */
export interface ApprovalCaps {
  /** `payroll.payslip.approve_owner` : peut arrêter un bulletin au-delà du seuil propriétaire. */
  readonly ownerApproval: boolean;
}

async function resolveIds(deps: PayrollDeps, ctx: RequestContext, selection: Selection, status: PayslipStatus): Promise<Result<Uuid[], AppError>> {
  if ("all" in selection) {
    return inTx(deps, ctx, async (tx) => ok(await repo.idsByPeriodStatus(tx, selection.periodId, status)), { readOnly: true });
  }
  const ids = [...new Set(selection.payslipIds)];
  if (ids.length === 0) return err(invalid("payslipIds", "Aucun bulletin sélectionné : une liste vide ne vaut jamais « tout » (utilisez { all: true, periodId }).", PayrollCodes.emptySelection));
  if (ids.length > MAX_BATCH) return err(invalid("payslipIds", `Un lot compte au plus ${MAX_BATCH} bulletins.`));
  return ok(ids.sort());
}

function sessionPort(deps: PayrollDeps, kind: HourSourceKind): HoursSourcePort | null {
  return kind === "SESSION" ? deps.ports.sessionHours : deps.ports.attendanceHours;
}

/** Gèle côté source les heures du bulletin arrêté (AC1.4). Lève si une source refuse : le bulletin n'est alors pas arrêté. */
async function lockSources(deps: PayrollDeps, ctx: RequestContext, payslipId: Uuid, staffId: Uuid, lines: readonly { sourceKind: HourSourceKind; sourceRefId: Uuid }[]): Promise<void> {
  for (const kind of HOUR_SOURCE_KINDS) {
    const port = sessionPort(deps, kind);
    if (!port?.lock) continue;
    const refs = [...new Set(lines.filter((l) => l.sourceKind === kind).map((l) => l.sourceRefId))];
    if (refs.length === 0) continue;
    await port.lock(ctx, { lockRef: payslipId, lines: refs.map((refId) => ({ refId, staffId })) });
  }
}

async function releaseSources(deps: PayrollDeps, ctx: RequestContext, payslipId: Uuid): Promise<void> {
  for (const kind of HOUR_SOURCE_KINDS) {
    const port = sessionPort(deps, kind);
    if (!port?.release) continue;
    try {
      await port.release(ctx, { lockRef: payslipId });
    } catch (e) {
      deps.logger.error({ payslipId, source: kind, err: e instanceof Error ? e.message : String(e) }, "payroll : libération des heures en échec (à reprendre)");
    }
  }
}

function eventPayload(p: PayslipRecord, recipientUserId: Uuid | null): PayslipEventPayload {
  return { v: 1, payslipId: p.id, periodId: p.periodId, staffId: p.staffId, recipientUserId, amount: p.totalAmount.amount, currency: p.currency };
}

// ---------------------------------------------------------------------------
// Arrêter (approuver)
// ---------------------------------------------------------------------------

export interface ApproveInput {
  selection: Selection;
  caps: ApprovalCaps;
}

/**
 * Arrête le montant : CALCULATED → APPROVED (ou ré-arrêt DISPUTED → APPROVED). Pose `approved_at/by` et le
 * SNAPSHOT immuable ; ne renseigne JAMAIS `paid_at`. Idempotent. C'est la MÊME action pour l'écran du gestionnaire
 * et celui du propriétaire (AC7.1).
 */
export async function approvePayslips(deps: PayrollDeps, ctx: RequestContext, input: ApproveInput): Promise<Result<BatchResult, AppError>> {
  const user = requireUser(ctx);
  if (!user.ok) return user;
  const ids = await resolveIds(deps, ctx, input.selection, "CALCULATED");
  if (!ids.ok) return ids;
  const actor = await resolveActor(deps, ctx);

  const pre = await inTx(
    deps,
    ctx,
    async (tx) => {
      const settings = await setup.getSettings(tx);
      const payslips = await repo.getPayslipsByIds(tx, ids.value);
      const periods = new Map<Uuid, PayPeriodRecord>();
      for (const p of payslips) if (!periods.has(p.periodId)) periods.set(p.periodId, (await setup.getPeriod(tx, p.periodId)) as PayPeriodRecord);
      return ok({ settings, payslips, periods });
    },
    { readOnly: true },
  );
  if (!pre.ok) return pre;
  const { settings, payslips, periods } = pre.value;
  const infos = await staffInfoMap(deps, ctx, payslips.map((p) => p.staffId));
  const byId = new Map(payslips.map((p) => [p.id, p]));

  const done: Uuid[] = [];
  const unchanged: Uuid[] = [];
  const rejected: BatchRejection[] = [];

  for (const id of ids.value) {
    const p = byId.get(id);
    if (!p) {
      rejected.push(reject(id, notFound("Bulletin de paie", id)));
      continue;
    }
    if (p.status === "APPROVED") {
      unchanged.push(id);
      continue;
    }
    if (!canTransition(p.status, "APPROVED")) {
      rejected.push(reject(id, invalidTransition(p.status, "APPROVED")));
      continue;
    }
    if (!separationOfDutiesAllows({ requireSeparateApprover: settings?.requireSeparateApprover ?? false, calculatedBy: p.calculatedBy, approver: user.value })) {
      rejected.push(reject(id, conflict(PayrollCodes.separationOfDuties, "Séparation des tâches : celui qui a calculé le bulletin ne peut pas l'arrêter.")));
      continue;
    }
    const needsOwner = requiresOwnerApproval({ thresholdXof: settings?.ownerApprovalThreshold?.amount ?? null, totalXof: p.totalAmount.amount });
    if (needsOwner && !input.caps.ownerApproval) {
      rejected.push(reject(id, conflict(PayrollCodes.ownerApprovalRequired, "Ce montant dépasse le seuil : seul le propriétaire peut arrêter ce bulletin.")));
      continue;
    }

    const firstApproval = p.status === "CALCULATED";
    try {
      const lines = await inTx(deps, ctx, async (tx) => ok(await repo.listLines(tx, id, p.currency)), { readOnly: true });
      if (!lines.ok) {
        rejected.push(reject(id, lines.error));
        continue;
      }
      if (firstApproval) {
        try {
          await lockSources(deps, ctx, id, p.staffId, lines.value);
        } catch (e) {
          rejected.push({ payslipId: id, code: PayrollCodes.concurrentUpdate, message: `Les heures du bulletin ne peuvent pas être gelées à la source : ${e instanceof Error ? e.message : "source indisponible"}.` });
          continue;
        }
      }
      const result = await inTx(deps, ctx, async (tx) => {
        const buf = new EventBuffer(deps, ctx);
        const locked = await repo.getPayslip(tx, id, { forUpdate: true });
        if (!locked) return err(notFound("Bulletin de paie", id));
        if (locked.status === "APPROVED") return ok("unchanged" as const);
        if (!canTransition(locked.status, "APPROVED")) return err(invalidTransition(locked.status, "APPROVED"));
        await setOwnerApproval(tx, input.caps.ownerApproval);
        const now = deps.clock.now();
        let snapshot: unknown = null;
        let hash: string | null = null;
        if (locked.status === "CALCULATED") {
          const [adjustments, freshLines] = [await repo.listAdjustments(tx, id, locked.currency), await repo.listLines(tx, id, locked.currency)];
          snapshot = buildSnapshot({ payslip: locked, period: periods.get(locked.periodId) as PayPeriodRecord, lines: freshLines, adjustments, staff: infos.get(locked.staffId), approvedAt: now, approvedByName: actor.name });
          hash = snapshotHash(snapshot);
        }
        const changed = await repo.markApproved(tx, id, locked.status, actor, now, snapshot, hash);
        if (!changed) return err(conflict(PayrollCodes.concurrentUpdate, "Le bulletin a changé pendant l'opération : réessayez."));
        await repo.insertEvent(tx, { id: deps.newId(), tenantId: ctx.tenantId, payslipId: id, action: "APPROVED", oldValues: { status: locked.status }, newValues: { status: "APPROVED", total: locked.totalAmount.amount, snapshotHash: hash }, actor, at: now });
        buf.add(PayrollEvents.payslipApproved, eventPayload(locked, infos.get(locked.staffId)?.userId ?? null), { type: PAYSLIP_AGGREGATE, id });
        buf.audit({ action: "payroll.payslip.approved", resourceType: "payslip", resourceId: id, sensitive: true, before: { status: locked.status }, after: { status: "APPROVED", total: locked.totalAmount.amount, snapshotHash: hash } });
        await buf.flush(tx);
        return ok("done" as const);
      });
      if (!result.ok) {
        if (firstApproval) await releaseSources(deps, ctx, id);
        rejected.push(reject(id, result.error));
      } else if (result.value === "done") done.push(id);
      else unchanged.push(id);
    } catch (e) {
      const mapped = isAppError(e) ? e : mapDbError(e);
      if (!mapped) throw e;
      if (firstApproval) await releaseSources(deps, ctx, id);
      rejected.push(reject(id, mapped));
    }
  }
  return ok({ done, unchanged, rejected });
}

// ---------------------------------------------------------------------------
// Verser (payer)
// ---------------------------------------------------------------------------

export interface PayInput {
  selection: Selection;
  method: PaymentMethod;
  reference?: string | undefined;
}

/** Constate le versement : n'agit que sur APPROVED ; un bulletin calculé ou annulé est refusé ; idempotent. */
export async function payPayslips(deps: PayrollDeps, ctx: RequestContext, input: PayInput): Promise<Result<BatchResult, AppError>> {
  const user = requireUser(ctx);
  if (!user.ok) return user;
  const ids = await resolveIds(deps, ctx, input.selection, "APPROVED");
  if (!ids.ok) return ids;
  const actor = await resolveActor(deps, ctx);
  const reference = input.reference?.trim() || null;

  const pre = await inTx(deps, ctx, async (tx) => ok(await repo.getPayslipsByIds(tx, ids.value)), { readOnly: true });
  if (!pre.ok) return pre;
  const infos = await staffInfoMap(deps, ctx, pre.value.map((p) => p.staffId));
  const known = new Set(pre.value.map((p) => p.id));

  const done: Uuid[] = [];
  const unchanged: Uuid[] = [];
  const rejected: BatchRejection[] = [];
  for (const id of ids.value) {
    if (!known.has(id)) {
      rejected.push(reject(id, notFound("Bulletin de paie", id)));
      continue;
    }
    try {
      const result = await inTx(deps, ctx, async (tx) => {
        const buf = new EventBuffer(deps, ctx);
        const p = await repo.getPayslip(tx, id, { forUpdate: true });
        if (!p) return err(notFound("Bulletin de paie", id));
        if (p.status === "PAID") return ok("unchanged" as const);
        if (!canTransition(p.status, "PAID")) return err(invalidTransition(p.status, "PAID"));
        const now = deps.clock.now();
        if (!(await repo.markPaid(tx, id, actor, now, input.method, reference))) return err(conflict(PayrollCodes.concurrentUpdate, "Le bulletin a changé pendant l'opération : réessayez."));
        await repo.insertEvent(tx, { id: deps.newId(), tenantId: ctx.tenantId, payslipId: id, action: "PAID", oldValues: { status: "APPROVED" }, newValues: { status: "PAID", method: input.method, reference, total: p.totalAmount.amount }, actor, at: now });
        buf.add(
          PayrollEvents.payslipPaid,
          { ...eventPayload(p, infos.get(p.staffId)?.userId ?? null), paidAt: now.toISOString(), method: input.method, reference },
          { type: PAYSLIP_AGGREGATE, id },
        );
        buf.audit({ action: "payroll.payslip.paid", resourceType: "payslip", resourceId: id, sensitive: true, before: { status: "APPROVED" }, after: { status: "PAID", method: input.method, reference, total: p.totalAmount.amount } });
        await buf.flush(tx);
        return ok("done" as const);
      });
      if (!result.ok) rejected.push(reject(id, result.error));
      else if (result.value === "done") done.push(id);
      else unchanged.push(id);
    } catch (e) {
      const mapped = isAppError(e) ? e : mapDbError(e);
      if (!mapped) throw e;
      rejected.push(reject(id, mapped));
    }
  }
  return ok({ done, unchanged, rejected });
}

// ---------------------------------------------------------------------------
// Annuler, contester
// ---------------------------------------------------------------------------

/** Annule (motif obligatoire) : relâche les heures et les jours de salaire dans la même transaction. Un bulletin PAYÉ ne s'annule pas. */
export async function cancelPayslip(deps: PayrollDeps, ctx: RequestContext, input: { payslipId: Uuid; reason: string }): Promise<Result<PayslipRecord, AppError>> {
  const user = requireUser(ctx);
  if (!user.ok) return user;
  const reason = trimReason(input.reason);
  if (reason.length < MIN_REASON_LENGTH) return err(reasonRequired("annuler un bulletin"));
  const actor = await resolveActor(deps, ctx);
  const result = await inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const p = await repo.getPayslip(tx, input.payslipId, { forUpdate: true });
    if (!p) return err(notFound("Bulletin de paie", input.payslipId));
    if (!canTransition(p.status, "CANCELLED")) return err(invalidTransition(p.status, "CANCELLED"));
    const now = deps.clock.now();
    if (!(await repo.markCancelled(tx, p.id, p.status, actor, now, reason))) return err(conflict(PayrollCodes.concurrentUpdate, "Le bulletin a changé pendant l'opération : réessayez."));
    await repo.insertEvent(tx, { id: deps.newId(), tenantId: ctx.tenantId, payslipId: p.id, action: "CANCELLED", oldValues: { status: p.status }, newValues: { status: "CANCELLED", total: p.totalAmount.amount }, reason, actor, at: now });
    buf.add(PayrollEvents.payslipCancelled, { ...eventPayload(p, null), reason }, { type: PAYSLIP_AGGREGATE, id: p.id });
    buf.audit({ action: "payroll.payslip.cancelled", resourceType: "payslip", resourceId: p.id, sensitive: true, reason, before: { status: p.status, total: p.totalAmount.amount }, after: { status: "CANCELLED" } });
    await buf.flush(tx);
    return ok({ previous: p.status, updated: (await repo.getPayslip(tx, p.id)) as PayslipRecord });
  });
  if (!result.ok) return result;
  if (result.value.previous !== "CALCULATED") await releaseSources(deps, ctx, input.payslipId);
  return ok(result.value.updated);
}

/** Conteste un bulletin arrêté (motif obligatoire) : APPROVED → DISPUTED ; il se ré-arrête ou s'annule ensuite. */
export async function disputePayslip(deps: PayrollDeps, ctx: RequestContext, input: { payslipId: Uuid; reason: string }): Promise<Result<PayslipRecord, AppError>> {
  const user = requireUser(ctx);
  if (!user.ok) return user;
  const reason = trimReason(input.reason);
  if (reason.length < MIN_REASON_LENGTH) return err(reasonRequired("contester un bulletin"));
  const actor = await resolveActor(deps, ctx);
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const p = await repo.getPayslip(tx, input.payslipId, { forUpdate: true });
    if (!p) return err(notFound("Bulletin de paie", input.payslipId));
    if (!canTransition(p.status, "DISPUTED")) return err(invalidTransition(p.status, "DISPUTED"));
    const now = deps.clock.now();
    if (!(await repo.markDisputed(tx, p.id, now, reason))) return err(conflict(PayrollCodes.concurrentUpdate, "Le bulletin a changé pendant l'opération : réessayez."));
    await repo.insertEvent(tx, { id: deps.newId(), tenantId: ctx.tenantId, payslipId: p.id, action: "DISPUTED", oldValues: { status: p.status }, newValues: { status: "DISPUTED" }, reason, actor, at: now });
    buf.add(PayrollEvents.payslipDisputed, { ...eventPayload(p, null), reason }, { type: PAYSLIP_AGGREGATE, id: p.id });
    buf.audit({ action: "payroll.payslip.disputed", resourceType: "payslip", resourceId: p.id, sensitive: true, reason, before: { status: p.status }, after: { status: "DISPUTED" } });
    await buf.flush(tx);
    return ok((await repo.getPayslip(tx, p.id)) as PayslipRecord);
  });
}

// ---------------------------------------------------------------------------
// Primes et retenues
// ---------------------------------------------------------------------------

export interface AdjustmentInput {
  kind: AdjustmentKind;
  amount: number;
  label: string;
  reason?: string | null | undefined;
}

export interface AdjustInput {
  payslipId: Uuid;
  add?: readonly AdjustmentInput[] | undefined;
  removeIds?: readonly Uuid[] | undefined;
}

/**
 * Saisie MANUELLE de primes et retenues (lignes tracées : libellé, motif, auteur) sur un bulletin CALCULATED
 * uniquement. Elles vivent dans leur table : un RECALCUL les CONSERVE (le legacy les remettait à zéro).
 */
export async function adjustPayslip(deps: PayrollDeps, ctx: RequestContext, input: AdjustInput): Promise<Result<PayslipRecord, AppError>> {
  const user = requireUser(ctx);
  if (!user.ok) return user;
  const add = input.add ?? [];
  const remove = [...new Set(input.removeIds ?? [])];
  if (add.length === 0 && remove.length === 0) return err(invalid("add", "Aucun ajustement à appliquer."));
  for (const a of add) {
    if (!Number.isSafeInteger(a.amount) || a.amount <= 0) return err(invalid("amount", "Un montant d'ajustement est un entier strictement positif."));
    if (a.label.trim().length === 0 || a.label.trim().length > 160) return err(invalid("label", "Le libellé compte de 1 à 160 caractères."));
  }
  const actor = await resolveActor(deps, ctx);
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const p = await repo.getPayslip(tx, input.payslipId, { forUpdate: true });
    if (!p) return err(notFound("Bulletin de paie", input.payslipId));
    if (p.status !== "CALCULATED") return err(payslipLocked(p.status));
    const now = deps.clock.now();
    for (const id of remove) {
      if (!(await repo.deleteAdjustment(tx, p.id, id))) return err(notFound("Ajustement", id));
    }
    for (const a of add) {
      await repo.insertAdjustment(tx, deps.newId(), ctx.tenantId, p.id, { kind: a.kind, amount: a.amount, label: a.label.trim(), reason: a.reason?.trim() || null }, { id: user.value, name: actor.name }, now);
    }
    const sums = await repo.sumAdjustments(tx, p.id);
    const gross = BigInt(p.baseAmount.amount) + BigInt(p.overtimeAmount.amount);
    const total = gross + sums.bonus - sums.deduction;
    if (total < 0n) return err(conflict(PayrollCodes.negativeTotal, "Les retenues dépassent le montant du bulletin.", { gross: Number(gross), deduction: Number(sums.deduction) }));
    await repo.setAdjustmentTotals(tx, p.id, { bonus: Number(sums.bonus), deduction: Number(sums.deduction), total: Number(total) }, now);
    await repo.insertEvent(tx, {
      id: deps.newId(),
      tenantId: ctx.tenantId,
      payslipId: p.id,
      action: "ADJUSTED",
      oldValues: { bonus: p.bonusAmount.amount, deduction: p.deductionAmount.amount, total: p.totalAmount.amount },
      newValues: { bonus: Number(sums.bonus), deduction: Number(sums.deduction), total: Number(total), added: add.length, removed: remove.length },
      actor,
      at: now,
    });
    buf.add(PayrollEvents.payslipAdjusted, { ...eventPayload(p, null), total: Number(total), bonus: Number(sums.bonus), deduction: Number(sums.deduction) }, { type: PAYSLIP_AGGREGATE, id: p.id });
    buf.audit({
      action: "payroll.payslip.adjusted",
      resourceType: "payslip",
      resourceId: p.id,
      sensitive: true,
      before: { bonus: p.bonusAmount.amount, deduction: p.deductionAmount.amount, total: p.totalAmount.amount },
      after: { bonus: Number(sums.bonus), deduction: Number(sums.deduction), total: Number(total) },
    });
    await buf.flush(tx);
    return ok((await repo.getPayslip(tx, p.id)) as PayslipRecord);
  });
}

// ---------------------------------------------------------------------------
// Notifier le titulaire
// ---------------------------------------------------------------------------

/** Demande l'envoi du bulletin à son titulaire (réservé à la gestion) : événement consommé par 016 (communications). */
export async function notifyPayslip(deps: PayrollDeps, ctx: RequestContext, payslipId: Uuid): Promise<Result<{ requested: true }, AppError>> {
  const user = requireUser(ctx);
  if (!user.ok) return user;
  const actor = await resolveActor(deps, ctx);
  const pre = await inTx(deps, ctx, async (tx) => ok(await repo.getPayslip(tx, payslipId)), { readOnly: true });
  if (!pre.ok) return pre;
  if (!pre.value) return err(notFound("Bulletin de paie", payslipId));
  const infos = await staffInfoMap(deps, ctx, [pre.value.staffId]);
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const p = await repo.getPayslip(tx, payslipId);
    if (!p) return err(notFound("Bulletin de paie", payslipId));
    if (p.status !== "APPROVED" && p.status !== "PAID") return err(conflict(PayrollCodes.invalidTransition, "Seul un bulletin arrêté ou payé peut être envoyé à son titulaire.", { status: p.status }));
    const now = deps.clock.now();
    await repo.insertEvent(tx, { id: deps.newId(), tenantId: ctx.tenantId, payslipId, action: "NOTIFIED", newValues: { status: p.status }, actor, at: now });
    buf.add(PayrollEvents.payslipNotificationRequested, eventPayload(p, infos.get(p.staffId)?.userId ?? null), { type: PAYSLIP_AGGREGATE, id: payslipId });
    buf.audit({ action: "payroll.payslip.notified", resourceType: "payslip", resourceId: payslipId });
    await buf.flush(tx);
    return ok({ requested: true as const });
  });
}

