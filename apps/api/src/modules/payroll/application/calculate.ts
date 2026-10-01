/**
 * Calcul de la paie d'une période (spec 032 US2, AC2.*, R-PAY-02/04/05, T1-T12, T17).
 *
 *   collecte (ports, UNE lecture par origine pour toute la période)  →  prédicat de payabilité (domain/payability)
 *   →  tarifs préchargés  →  PAR ENSEIGNANT, dans sa propre transaction et sous un verrou consultatif :
 *      heures déjà réclamées exclues → calcul pur → bulletin + lignes + RÉCLAMATIONS (hour_claims, salary_day_claims)
 *   →  compte rendu CONSERVÉ (calculation_runs / items), événements, audit.
 *
 * Garanties :
 *  - une heure ne se paie qu'une fois : la clé primaire de hour_claims l'impose ; le verrou par enseignant évite
 *    même l'échec (deux calculs de périodes chevauchantes se SÉRIALISENT par enseignant) ; une collision résiduelle
 *    est rejouée après relecture ;
 *  - un jour de salaire ne se paie qu'une fois (salary_day_claims) : la seconde période qui en recouvre une autre ne
 *    verse que les jours restants (le legacy versait deux salaires entiers) ;
 *  - un recalcul reconstruit lignes ET réclamations d'un bulletin CALCULATED, en CONSERVANT primes et retenues ;
 *    il ne touche jamais un bulletin APPROVED/PAID/DISPUTED (signalé `PAYSLIP_LOCKED`) ;
 *  - un enseignant écarté l'est TOUJOURS avec son motif (jamais absent en silence) ;
 *  - panne d'un port : calcul refusé (aucun résultat partiel silencieux) ;
 *  - un aperçu (`dryRun`) calcule sans rien écrire : une seule transaction en lecture seule.
 */
import { Money, err, isAppError, ok, type AppError, type CurrencyCode, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { computePayslip, isEmptyComputation, type CalcDetails, type PayslipComputation } from "../domain/calculation";
import { PayrollCodes, conflict, notFound, portUnavailable } from "../domain/errors";
import { PayrollEvents } from "../domain/events";
import { RateIndex, resolveRate } from "../domain/rates";
import { collectPayable, hourKey } from "../domain/payability";
import type { PayConfigRecord, PayPeriodRecord, PayslipRecord, RunOutcome, RunScope } from "../domain/records";
import { HOUR_SOURCE_KINDS, type HourFact, type HourSourceKind, type PayConfig, type PayableHour, type PayslipLineDraft, type PricedHour, type SkipReason, type Uuid } from "../domain/types";
import { isClaimCollision, mapDbError } from "../infrastructure/db-errors";
import * as repo from "../infrastructure/payslip-repo";
import * as setup from "../infrastructure/setup-repo";
import { EventBuffer, inTx, lockStaff, type PayrollDeps } from "./deps";
import type { HoursSourcePort } from "./ports";
import { PAYSLIP_AGGREGATE, RUN_AGGREGATE, fallbackStaffName, requireUser, resolveActor, staffInfoMap } from "./support";

/** Un calcul « mort » (processus interrompu) est abandonné après ce délai : il libère le verrou fonctionnel. */
export const STALE_RUN_MS = 15 * 60_000;
const MAX_CLAIM_RETRIES = 3;
/** Enseignants calculés en parallèle (une transaction chacun) : borne le nombre de connexions utilisées par un calcul. */
const STAFF_CONCURRENCY = 4;

/** `Promise.all` borné : au plus `limit` tâches simultanées, résultats DANS L'ORDRE des entrées. */
async function mapPool<T, R>(inputs: readonly T[], limit: number, fn: (input: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(inputs.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const i = next++;
      if (i >= inputs.length) return;
      out[i] = await fn(inputs[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, inputs.length) }, worker));
  return out;
}

export interface CalculateInput {
  periodId: Uuid;
  /** Restreint le calcul à ces enseignants. */
  staffIds?: readonly Uuid[] | undefined;
  /** Origines autorisées par le plan du tenant (features `payroll.session-source` / `payroll.attendance-source`). Défaut : les deux. */
  enabledSources?: readonly HourSourceKind[] | undefined;
  scope?: RunScope | undefined;
  recalculate?: boolean | undefined;
  dryRun?: boolean | undefined;
}

export interface PayslipPreview {
  readonly kind: PayslipComputation["kind"];
  readonly salary: Money;
  readonly regularHours: Money;
  readonly overtime: Money;
  readonly bonus: Money;
  readonly deduction: Money;
  readonly total: Money;
  readonly regularMinutes: number;
  readonly overtimeMinutes: number;
  readonly lines: readonly PayslipLineDraft[];
  readonly details: CalcDetails;
}

export interface StaffOutcome {
  readonly staffId: Uuid;
  readonly staffName: string;
  readonly outcome: RunOutcome;
  readonly skipReason: SkipReason | null;
  readonly message: string | null;
  readonly payslipId: Uuid | null;
  readonly minutesBySource: Partial<Record<HourSourceKind, number>> | null;
  readonly total: Money | null;
  readonly preview: PayslipPreview | null;
}

export interface CalculationReport {
  readonly runId: string | null;
  readonly periodId: Uuid;
  readonly dryRun: boolean;
  readonly scope: RunScope;
  readonly recalculate: boolean;
  readonly calculated: number;
  readonly skipped: number;
  readonly locked: number;
  readonly failed: number;
  readonly durationMs: number;
  readonly items: readonly StaffOutcome[];
  readonly warnings: readonly string[];
}

interface Shared {
  readonly tenantId: string;
  readonly period: PayPeriodRecord;
  readonly currency: CurrencyCode;
  readonly configs: ReadonlyMap<Uuid, readonly PayConfigRecord[]>;
  readonly rateIndex: RateIndex;
  readonly hoursByStaff: ReadonlyMap<Uuid, readonly PayableHour[]>;
  readonly pendingValidation: ReadonlyMap<Uuid, number>;
  readonly recalculate: boolean;
  /** Aperçu : prévisualise la reconstruction d'un bulletin CALCULATED même sans `recalculate` (rien n'est écrit). */
  readonly dryRun: boolean;
  readonly actor: { id: Uuid; name: string };
  readonly names: ReadonlyMap<Uuid, string>;
}

const nameOf = (shared: Shared, staffId: Uuid): string => shared.names.get(staffId) ?? fallbackStaffName(staffId);

export function toPayConfig(c: PayConfigRecord): PayConfig {
  return {
    id: c.id,
    staffId: c.staffId,
    type: c.type,
    monthlySalary: c.monthlySalary,
    annualSalary: c.annualSalary,
    defaultHourlyRate: c.defaultHourlyRate,
    overtimeThresholdMinutes: c.overtimeThresholdMinutes,
    overtimeMultiplierPermille: c.overtimeMultiplierPermille,
    effectiveFrom: c.effectiveFrom,
    effectiveTo: c.effectiveTo,
  };
}

export const configSnapshotOf = (c: PayConfigRecord): Record<string, unknown> => ({
  id: c.id,
  type: c.type,
  monthlySalary: c.monthlySalary?.amount ?? null,
  annualSalary: c.annualSalary?.amount ?? null,
  defaultHourlyRate: c.defaultHourlyRate?.amount ?? null,
  overtimeThresholdMinutes: c.overtimeThresholdMinutes,
  overtimeMultiplierPermille: c.overtimeMultiplierPermille,
  effectiveFrom: c.effectiveFrom,
  effectiveTo: c.effectiveTo,
});

function sourcesFor(input: CalculateInput): HourSourceKind[] {
  const enabled = new Set<HourSourceKind>(input.enabledSources ?? HOUR_SOURCE_KINDS);
  const scope = input.scope ?? "ALL";
  return HOUR_SOURCE_KINDS.filter((k) => enabled.has(k) && (scope === "ALL" || scope === k));
}

function portFor(deps: PayrollDeps, kind: HourSourceKind): HoursSourcePort | null {
  return kind === "SESSION" ? deps.ports.sessionHours : deps.ports.attendanceHours;
}

const SOURCE_LABEL: Record<HourSourceKind, string> = { SESSION: "séances (017)", ATTENDANCE: "présences enseignants (010)" };

// ---------------------------------------------------------------------------
// Un enseignant
// ---------------------------------------------------------------------------

type Planned =
  | { kind: "outcome"; outcome: StaffOutcome }
  | {
      kind: "write";
      staffId: Uuid;
      configRecord: PayConfigRecord;
      existing: PayslipRecord | null;
      computation: PayslipComputation;
      bonus: Money;
      deduction: Money;
      total: Money;
      minutesBySource: Partial<Record<HourSourceKind, number>>;
      note: string | null;
    };

const skipped = (shared: Shared, staffId: Uuid, reason: SkipReason, message: string, extra: Partial<StaffOutcome> = {}): Planned => ({
  kind: "outcome",
  outcome: { staffId, staffName: nameOf(shared, staffId), outcome: "SKIPPED", skipReason: reason, message, payslipId: null, minutesBySource: null, total: null, preview: null, ...extra },
});

/** Planifie le bulletin d'un enseignant (lectures seulement). `lock` : verrou consultatif + ligne verrouillée. */
async function planStaff(tx: Tx, shared: Shared, staffId: Uuid, lock: boolean): Promise<Planned> {
  const configs = shared.configs.get(staffId) ?? [];
  const configRecord = configs[0];
  if (!configRecord) return skipped(shared, staffId, "NO_CONFIG", "Aucune configuration de paie valide sur la période.");
  if (lock) await lockStaff(tx, shared.tenantId, staffId);

  const existing = await repo.liveForStaffPeriod(tx, shared.period.id, staffId, { forUpdate: lock });
  if (existing && existing.status !== "CALCULATED") {
    return {
      kind: "outcome",
      outcome: {
        staffId,
        staffName: nameOf(shared, staffId),
        outcome: "LOCKED",
        skipReason: "PAYSLIP_LOCKED",
        message: `Bulletin ${existing.status} : non réécrit par le calcul.`,
        payslipId: existing.id,
        minutesBySource: null,
        total: existing.totalAmount,
        preview: null,
      },
    };
  }
  if (existing && !shared.recalculate && !shared.dryRun) {
    return skipped(shared, staffId, "ALREADY_CALCULATED", "Un bulletin calculé existe déjà : relancez avec « recalculer » pour le reconstruire.", { payslipId: existing.id, total: existing.totalAmount });
  }

  const config = toPayConfig(configRecord);
  const payable = shared.hoursByStaff.get(staffId) ?? [];
  const claimed = await repo.claimedElsewhere(tx, staffId, payable, existing?.id ?? null);
  const available = payable.filter((h) => !claimed.has(hourKey(h)));
  const alreadyPaid = payable.length - available.length;
  const pending = shared.pendingValidation.get(staffId) ?? 0;
  const pendingNote = pending > 0 ? `${pending} séance(s) réalisée(s) non validée(s) n'y figurent pas.` : null;

  if (config.type === "HOURLY" && available.length === 0) {
    return alreadyPaid > 0
      ? skipped(shared, staffId, "NOTHING_TO_PAY", `Toutes les heures validées (${alreadyPaid}) sont déjà portées par un autre bulletin.${pendingNote ? ` ${pendingNote}` : ""}`)
      : skipped(shared, staffId, "NO_HOURS", `Aucune heure validée sur la période.${pendingNote ? ` ${pendingNote}` : ""}`);
  }

  // --- tarification : l'ordre figé de `resolveRate`, à la date de la séance -------------------------------
  const zero = Money.zero(shared.currency);
  const priced: PricedHour[] = [];
  for (const h of available) {
    const resolved = resolveRate({ index: shared.rateIndex, nodeId: h.nodeId, staffId, date: h.date, configType: config.type, configDefaultRate: config.defaultHourlyRate, zero });
    if (!resolved) {
      return skipped(shared, staffId, "NO_RATE_RESOLVED", `Aucun tarif applicable pour « ${h.code ?? h.label ?? h.refId} » le ${h.date}, ni tarif horaire par défaut.`);
    }
    priced.push({ ...h, rate: resolved.rate, rateOrigin: resolved.origin });
  }

  const paysSalary = config.type !== "HOURLY";
  const claimedDays = paysSalary ? await repo.salaryDaysClaimedElsewhere(tx, staffId, shared.period.startDate, shared.period.endDate, existing?.id ?? null) : new Set<string>();
  const computation = computePayslip({ period: shared.period, config, hours: priced, claimedSalaryDays: claimedDays, currency: shared.currency });
  if (paysSalary && isEmptyComputation(computation)) {
    return skipped(shared, staffId, "NOTHING_TO_PAY", "Le salaire de la période est déjà porté par un autre bulletin (périodes qui se chevauchent) et aucune heure n'est à payer.");
  }

  // primes et retenues déjà saisies : CONSERVÉES au recalcul
  const sums = existing ? await repo.sumAdjustments(tx, existing.id) : { bonus: 0n, deduction: 0n };
  const bonus = Money.of(sums.bonus, shared.currency);
  const deduction = Money.of(sums.deduction, shared.currency);
  const total = computation.grossAmount.add(bonus).subtract(deduction);
  if (total.isNegative()) {
    return {
      kind: "outcome",
      outcome: {
        staffId,
        staffName: nameOf(shared, staffId),
        outcome: "FAILED",
        skipReason: null,
        message: `Les retenues (${deduction.amount}) dépassent le montant calculé (${computation.grossAmount.amount + bonus.amount}) : ajustez-les avant de recalculer.`,
        payslipId: existing?.id ?? null,
        minutesBySource: computation.minutesBySource,
        total: null,
        preview: null,
      },
    };
  }

  const notes: string[] = [];
  if (configs.length > 1) notes.push(`${configs.length} configurations couvrent la période : la plus récente s'applique à toute la période.`);
  if (alreadyPaid > 0) notes.push(`${alreadyPaid} heure(s) déjà payée(s) par un autre bulletin ont été exclues.`);
  if (pendingNote) notes.push(pendingNote);
  return {
    kind: "write",
    staffId,
    configRecord,
    existing,
    computation,
    bonus,
    deduction,
    total,
    minutesBySource: computation.minutesBySource,
    note: notes.length ? notes.join(" ") : null,
  };
}

const previewOf = (p: Extract<Planned, { kind: "write" }>): PayslipPreview => ({
  kind: p.computation.kind,
  salary: p.computation.salaryAmount,
  regularHours: p.computation.regularHoursAmount,
  overtime: p.computation.overtimeAmount,
  bonus: p.bonus,
  deduction: p.deduction,
  total: p.total,
  regularMinutes: p.computation.regularMinutes,
  overtimeMinutes: p.computation.overtimeMinutes,
  lines: p.computation.lines,
  details: p.computation.details,
});

async function writePlan(tx: Tx, deps: PayrollDeps, ctx: RequestContext, shared: Shared, p: Extract<Planned, { kind: "write" }>): Promise<StaffOutcome> {
  const buf = new EventBuffer(deps, ctx);
  const now = deps.clock.now();
  const c = p.computation;
  const amounts: repo.PayslipAmounts = {
    kind: c.kind,
    salary: c.salaryAmount.amount,
    base: c.baseAmount.amount,
    overtime: c.overtimeAmount.amount,
    bonus: p.bonus.amount,
    deduction: p.deduction.amount,
    total: p.total.amount,
    currency: shared.currency,
    regularMinutes: c.regularMinutes,
    overtimeMinutes: c.overtimeMinutes,
    calcDetails: c.details,
    configSnapshot: configSnapshotOf(p.configRecord),
    configId: p.configRecord.id,
    calculatedBy: shared.actor.id,
    calculatedByName: shared.actor.name,
    calculatedAt: now,
  };

  let payslipId: Uuid;
  let action: "CALCULATED" | "RECALCULATED";
  if (p.existing) {
    payslipId = p.existing.id;
    action = "RECALCULATED";
    await repo.deleteHourClaims(tx, payslipId);
    await repo.deleteSalaryDays(tx, payslipId);
    await repo.deleteLines(tx, payslipId);
    await repo.updatePayslipCalculation(tx, payslipId, amounts);
  } else {
    payslipId = deps.newId();
    action = "CALCULATED";
    const replaces = await repo.latestCancelledId(tx, shared.period.id, p.staffId);
    await repo.insertPayslip(tx, payslipId, shared.tenantId, shared.period.id, p.staffId, amounts, replaces);
  }
  await repo.insertLines(tx, shared.tenantId, payslipId, c.lines, deps.newId);
  const minutesByRef = new Map<string, repo.ClaimInsert>();
  for (const l of c.lines) {
    const key = `${l.sourceKind}|${l.sourceRefId}`;
    const cur = minutesByRef.get(key);
    minutesByRef.set(key, { kind: l.sourceKind, refId: l.sourceRefId, staffId: p.staffId, minutes: (cur?.minutes ?? 0) + l.minutes });
  }
  await repo.insertHourClaims(tx, shared.tenantId, payslipId, [...minutesByRef.values()]);
  await repo.insertSalaryDays(tx, shared.tenantId, payslipId, p.staffId, c.salaryDays);

  await repo.insertEvent(tx, {
    id: deps.newId(),
    tenantId: shared.tenantId,
    payslipId,
    action,
    oldValues: p.existing ? { total: p.existing.totalAmount.amount, status: p.existing.status } : undefined,
    newValues: { total: p.total.amount, base: c.baseAmount.amount, overtime: c.overtimeAmount.amount, bonus: p.bonus.amount, deduction: p.deduction.amount, lines: c.lines.length, periodId: shared.period.id },
    reason: p.note,
    actor: shared.actor,
    at: now,
  });
  buf.add(
    PayrollEvents.payslipCalculated,
    { v: 1, payslipId, periodId: shared.period.id, staffId: p.staffId, amount: p.total.amount, currency: shared.currency, recalculated: action === "RECALCULATED" },
    { type: PAYSLIP_AGGREGATE, id: payslipId },
  );
  buf.audit({
    action: action === "RECALCULATED" ? "payroll.payslip.recalculated" : "payroll.payslip.calculated",
    resourceType: "payslip",
    resourceId: payslipId,
    sensitive: true,
    ...(p.existing ? { before: { total: p.existing.totalAmount.amount } } : {}),
    after: { total: p.total.amount, periodId: shared.period.id, staffId: p.staffId, lines: c.lines.length },
  });
  await buf.flush(tx);
  return {
    staffId: p.staffId,
    staffName: nameOf(shared, p.staffId),
    outcome: "CALCULATED",
    skipReason: null,
    message: p.note,
    payslipId,
    minutesBySource: p.minutesBySource,
    total: p.total,
    preview: previewOf(p),
  };
}

/** Persiste un enseignant dans SA transaction ; une collision de réclamation résiduelle est rejouée après relecture. */
async function persistStaff(deps: PayrollDeps, ctx: RequestContext, shared: Shared, staffId: Uuid): Promise<StaffOutcome> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await deps.db.run(ctx, async (tx) => {
        const planned = await planStaff(tx, shared, staffId, true);
        if (planned.kind === "outcome") return planned.outcome;
        return writePlan(tx, deps, ctx, shared, planned);
      });
    } catch (e) {
      if (isClaimCollision(e) && attempt < MAX_CLAIM_RETRIES) continue;
      const mapped = isAppError(e) ? e : mapDbError(e);
      if (!mapped) throw e;
      return {
        staffId,
        staffName: nameOf(shared, staffId),
        outcome: "FAILED",
        skipReason: null,
        message: mapped.message,
        payslipId: null,
        minutesBySource: null,
        total: null,
        preview: null,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// La période
// ---------------------------------------------------------------------------

async function collectFacts(deps: PayrollDeps, ctx: RequestContext, sources: readonly HourSourceKind[], query: { from: string; to: string; staffIds: readonly Uuid[] | undefined }): Promise<Result<HourFact[], AppError>> {
  const facts: HourFact[] = [];
  for (const kind of sources) {
    const port = portFor(deps, kind);
    if (!port) return err(portUnavailable(SOURCE_LABEL[kind]));
    try {
      facts.push(...(await port.collect(ctx, query)));
    } catch (e) {
      deps.logger.error({ source: kind, err: e instanceof Error ? e.message : String(e) }, "payroll : source d'heures en échec");
      return err(portUnavailable(SOURCE_LABEL[kind]));
    }
  }
  return ok(facts);
}

export async function calculatePeriod(deps: PayrollDeps, ctx: RequestContext, input: CalculateInput): Promise<Result<CalculationReport, AppError>> {
  const user = requireUser(ctx);
  if (!user.ok) return user;
  const startedAt = deps.clock.now().getTime();
  const dryRun = input.dryRun === true;
  const recalculate = input.recalculate === true;
  const scope: RunScope = input.scope ?? "ALL";
  const sources = sourcesFor(input);
  const restrict = input.staffIds && input.staffIds.length > 0 ? [...new Set(input.staffIds)] : null;

  // 1. Données du tenant (lecture seule) ---------------------------------------------------------------
  const loaded = await inTx(
    deps,
    ctx,
    async (tx) => {
      const settings = (await settingsCurrency(tx)) ?? null;
      const currency = settings ?? "XOF";
      const period = await setup.getPeriod(tx, input.periodId);
      if (!period) return err(notFound("Période de paie", input.periodId));
      const configs = await setup.listConfigsOverlapping(tx, period.startDate, period.endDate, null, currency);
      const rates = await setup.listRatesOverlapping(tx, period.startDate, period.endDate, currency);
      return ok({ currency, period, configs, rates });
    },
    { readOnly: true },
  );
  if (!loaded.ok) return loaded;
  const { currency, period, configs, rates } = loaded.value;
  if (period.status === "ARCHIVED" || (period.status === "CLOSED" && !dryRun)) {
    return err(conflict(PayrollCodes.periodClosed, "La période est clôturée ou archivée : le calcul est refusé."));
  }

  // 2. Périmètre ---------------------------------------------------------------------------------------
  const targeted = period.targetStaffIds.length > 0;
  const targetSet = new Set(period.targetStaffIds);
  const outOfScope = restrict && targeted ? restrict.filter((s) => !targetSet.has(s)) : [];
  const scopeFilter: readonly Uuid[] | null = targeted ? (restrict ? restrict.filter((s) => targetSet.has(s)) : [...targetSet]) : restrict;

  // 3. Collecte des heures (ports, hors transaction) ------------------------------------------------------
  const facts = await collectFacts(deps, ctx, sources, { from: period.startDate, to: period.endDate, staffIds: scopeFilter ?? undefined });
  if (!facts.ok) return facts;
  const window = { from: period.startDate, to: period.endDate, staffIds: scopeFilter ? new Set(scopeFilter) : null };
  const collected = collectPayable(facts.value, window);
  const hoursByStaff = new Map<Uuid, PayableHour[]>();
  for (const h of collected.payable) {
    const list = hoursByStaff.get(h.staffId);
    if (list) list.push(h);
    else hoursByStaff.set(h.staffId, [h]);
  }
  const pendingValidation = new Map<Uuid, number>();
  for (const r of collected.rejected) {
    const onlyValidation = r.blockers.length === 1 && r.blockers[0] === "NOT_VALIDATED";
    if (onlyValidation && r.fact.staffId) pendingValidation.set(r.fact.staffId, (pendingValidation.get(r.fact.staffId) ?? 0) + 1);
  }

  const configsByStaff = new Map<Uuid, PayConfigRecord[]>();
  for (const c of configs) {
    const list = configsByStaff.get(c.staffId);
    if (list) list.push(c);
    else configsByStaff.set(c.staffId, [c]);
  }

  // 4. Enseignants à traiter : ciblés, sinon configurés ∪ ayant des heures ∪ annuaire des payables ------------
  const candidates = new Set<Uuid>();
  if (scopeFilter) for (const s of scopeFilter) candidates.add(s);
  else {
    for (const s of configsByStaff.keys()) candidates.add(s);
    for (const s of hoursByStaff.keys()) candidates.add(s);
    try {
      for (const s of (await deps.ports.staff?.listPayableStaff?.(ctx)) ?? []) candidates.add(s.staffId);
    } catch (e) {
      deps.logger.warn({ err: e instanceof Error ? e.message : String(e) }, "payroll : annuaire des payables indisponible, périmètre réduit aux enseignants connus");
    }
  }
  const staffIds = [...candidates].sort();
  const infos = await staffInfoMap(deps, ctx, [...staffIds, ...outOfScope]);
  const names = new Map<Uuid, string>([...infos].map(([id, info]) => [id, info.displayName]));
  const actor = await resolveActor(deps, ctx);

  const shared: Shared = {
    tenantId: ctx.tenantId,
    period,
    currency,
    configs: configsByStaff,
    rateIndex: new RateIndex(rates.map((r) => ({ id: r.id, nodeId: r.curriculumNodeId, staffId: r.staffId, rate: r.rate, validFrom: r.validFrom, validTo: r.validTo }))),
    hoursByStaff,
    pendingValidation,
    recalculate,
    dryRun,
    actor: { id: user.value, name: actor.name },
    names,
    // `names` est complété ci-dessous pour les hors périmètre
  };

  const items: StaffOutcome[] = [];
  for (const s of outOfScope) {
    items.push({ staffId: s, staffName: nameOf(shared, s), outcome: "SKIPPED", skipReason: "OUT_OF_SCOPE", message: "Enseignant non ciblé par cette période.", payslipId: null, minutesBySource: null, total: null, preview: null });
  }

  // 5a. Aperçu : une transaction en lecture seule, rien n'est écrit ---------------------------------------------
  if (dryRun) {
    const outcomes = await inTx(
      deps,
      ctx,
      async (tx) => {
        const out: StaffOutcome[] = [];
        for (const staffId of staffIds) {
          const planned = await planStaff(tx, shared, staffId, false);
          out.push(
            planned.kind === "outcome"
              ? planned.outcome
              : { staffId, staffName: nameOf(shared, staffId), outcome: "CALCULATED", skipReason: null, message: planned.note, payslipId: planned.existing?.id ?? null, minutesBySource: planned.minutesBySource, total: planned.total, preview: previewOf(planned) },
          );
        }
        return ok(out);
      },
      { readOnly: true },
    );
    if (!outcomes.ok) return outcomes;
    items.push(...outcomes.value);
    return ok(report(null, input.periodId, true, scope, recalculate, items, deps.clock.now().getTime() - startedAt));
  }

  // 5b. Calcul réel : compte rendu RUNNING (verrou fonctionnel par période), puis un enseignant à la fois ------------
  const runId = deps.newId();
  const started = await inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    await repo.failStaleRuns(tx, period.id, new Date(now.getTime() - STALE_RUN_MS), now);
    await repo.insertRun(tx, { id: runId, tenantId: ctx.tenantId, periodId: period.id, scope, recalculate, dryRun: false, staffFilter: restrict, requestedBy: user.value, now });
    await setup.updatePeriod(tx, period.id, { awaitingCalculation: false, ...(period.status === "DRAFT" ? { status: "ACTIVE" as const } : {}) }, now);
    return ok(true);
  });
  if (!started.ok) return started;

  try {
    // quelques enseignants en parallèle (chacun dans SA transaction, sous SON verrou) ; l'ordre du compte rendu reste celui des identifiants
    items.push(...(await mapPool(staffIds, STAFF_CONCURRENCY, (staffId) => persistStaff(deps, ctx, shared, staffId))));
  } catch (e) {
    await inTx(deps, ctx, async (tx) => {
      await repo.finishRun(tx, runId, { status: "FAILED", calculated: 0, skipped: 0, locked: 0, failed: 0, durationMs: deps.clock.now().getTime() - startedAt, error: e instanceof Error ? e.message.slice(0, 500) : "Erreur inattendue", now: deps.clock.now() });
      return ok(true);
    }).catch(() => undefined);
    throw e;
  }

  const durationMs = deps.clock.now().getTime() - startedAt;
  const final = report(runId, input.periodId, false, scope, recalculate, items, durationMs);
  const finished = await inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    await repo.insertRunItems(
      tx,
      ctx.tenantId,
      runId,
      items.map((i) => ({
        id: deps.newId(),
        staffId: i.staffId,
        staffName: i.staffName,
        outcome: i.outcome,
        skipReason: i.skipReason,
        message: i.message,
        payslipId: i.payslipId,
        minutesBySource: i.minutesBySource,
        totalAmount: i.total ? i.total.amount : null,
      })),
    );
    await repo.finishRun(tx, runId, { status: "COMPLETED", calculated: final.calculated, skipped: final.skipped, locked: final.locked, failed: final.failed, durationMs, error: null, now: deps.clock.now() });
    buf.add(
      PayrollEvents.runCompleted,
      {
        v: 1,
        runId,
        periodId: period.id,
        calculated: final.calculated,
        skipped: items.filter((i) => i.outcome === "SKIPPED").map((i) => ({ staffId: i.staffId, reason: i.skipReason })),
        locked: items.filter((i) => i.outcome === "LOCKED").map((i) => i.staffId),
        failed: final.failed,
      },
      { type: RUN_AGGREGATE, id: runId },
    );
    buf.audit({
      action: "payroll.run.completed",
      resourceType: "calculation_run",
      resourceId: runId,
      sensitive: true,
      metadata: { periodId: period.id, calculated: final.calculated, skipped: final.skipped, locked: final.locked, failed: final.failed, recalculate },
    });
    await buf.flush(tx);
    return ok(true);
  });
  if (!finished.ok) return finished;
  return ok(final);
}

/** Devise des réglages, lue SANS créer la ligne (aperçu en lecture seule) ; `null` si les réglages n'existent pas encore. */
async function settingsCurrency(tx: Tx): Promise<CurrencyCode | null> {
  const s = await setup.getSettings(tx);
  return s ? s.currency : null;
}

function report(runId: string | null, periodId: Uuid, dryRun: boolean, scope: RunScope, recalculate: boolean, items: readonly StaffOutcome[], durationMs: number): CalculationReport {
  const count = (o: RunOutcome): number => items.filter((i) => i.outcome === o).length;
  return { runId, periodId, dryRun, scope, recalculate, calculated: count("CALCULATED"), skipped: count("SKIPPED"), locked: count("LOCKED"), failed: count("FAILED"), durationMs, items, warnings: [] };
}
