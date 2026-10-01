/**
 * Configurations de paie des enseignants (datées, sans chevauchement — EXCLUDE en base) et tarifs horaires par
 * nœud de curriculum, nominatifs ou génériques (sans chevauchement du même couple), avec leur simulateur.
 * Seuil d'heures supplémentaires et majoration : valeurs de la configuration (défauts = réglages du tenant) —
 * aucune constante dans le code.
 */
import { Money, err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { isIsoDate } from "../domain/calendar";
import { invalid, notFound } from "../domain/errors";
import { RateIndex, resolveRate, type ResolvedRate } from "../domain/rates";
import type { HourlyRateRecord, PayConfigRecord } from "../domain/records";
import type { ConfigType, IsoDate, Uuid } from "../domain/types";
import * as repo from "../infrastructure/setup-repo";
import { EventBuffer, inTx, type PayrollDeps } from "./deps";
import { requireUser, validateDateRange, wholeMoney } from "./support";

export type ConfigState = "ACTIVE" | "EXPIRED" | "FUTURE" | "ABSENT";

/**
 * État calculé de la configuration d'un enseignant à une date (4 valeurs, jamais « configuré » tout court) :
 * `ACTIVE` valide ce jour, `FUTURE` pas encore, `EXPIRED` échue, `ABSENT` aucune (piège n°8 de la portabilité).
 */
export function configState(configs: readonly Pick<PayConfigRecord, "effectiveFrom" | "effectiveTo">[], onDate: IsoDate): ConfigState {
  if (configs.length === 0) return "ABSENT";
  if (configs.some((c) => c.effectiveFrom <= onDate && (c.effectiveTo === null || c.effectiveTo >= onDate))) return "ACTIVE";
  if (configs.some((c) => c.effectiveFrom > onDate)) return "FUTURE";
  return "EXPIRED";
}

export interface ConfigInput {
  staffId: Uuid;
  type: ConfigType;
  monthlySalary?: number | null | undefined;
  annualSalary?: number | null | undefined;
  /** 0 est une valeur (taux nul) ; `null`/absent = pas de tarif par défaut. */
  defaultHourlyRate?: number | null | undefined;
  overtimeThresholdMinutes?: number | undefined;
  overtimeMultiplierPermille?: number | undefined;
  effectiveFrom: IsoDate;
  effectiveTo?: IsoDate | null | undefined;
}

function validateConfig(i: Omit<ConfigInput, "staffId">): AppError | null {
  if (!isIsoDate(i.effectiveFrom)) return invalid("effectiveFrom", "Date de début de validité invalide.");
  if (i.effectiveTo != null) {
    if (!isIsoDate(i.effectiveTo)) return invalid("effectiveTo", "Date de fin de validité invalide.");
    const bad = validateDateRange(i.effectiveFrom, i.effectiveTo, "effectiveTo");
    if (bad) return bad;
  }
  for (const [path, v] of [["monthlySalary", i.monthlySalary], ["annualSalary", i.annualSalary], ["defaultHourlyRate", i.defaultHourlyRate]] as const) {
    if (v != null) {
      const bad = wholeMoney(v, path);
      if (bad) return bad;
    }
  }
  if (i.type === "HOURLY" && (i.monthlySalary != null || i.annualSalary != null)) return invalid("type", "Une configuration horaire ne porte pas de salaire.");
  if (i.type !== "HOURLY" && i.monthlySalary == null && i.annualSalary == null) return invalid("monthlySalary", "Une configuration salariale ou mixte exige un salaire mensuel ou annuel.");
  return null;
}

export async function createPayConfig(deps: PayrollDeps, ctx: RequestContext, input: ConfigInput): Promise<Result<PayConfigRecord, AppError>> {
  const user = requireUser(ctx);
  if (!user.ok) return user;
  const bad = validateConfig(input);
  if (bad) return err(bad);
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const settings = await repo.ensureSettings(tx, ctx.tenantId);
    const threshold = input.overtimeThresholdMinutes ?? settings.defaultOvertimeThresholdMinutes;
    const multiplier = input.overtimeMultiplierPermille ?? settings.defaultOvertimeMultiplierPermille;
    if (!Number.isInteger(threshold) || threshold <= 0) return err(invalid("overtimeThresholdMinutes", "Le seuil est un nombre entier de minutes strictement positif."));
    if (!Number.isInteger(multiplier) || multiplier < 1000 || multiplier > 5000) return err(invalid("overtimeMultiplierPermille", "La majoration est comprise entre 1 000 ‰ et 5 000 ‰."));
    const id = deps.newId();
    const config = await repo.insertConfig(
      tx,
      id,
      ctx.tenantId,
      {
        staffId: input.staffId,
        type: input.type,
        monthlySalary: input.monthlySalary ?? null,
        annualSalary: input.annualSalary ?? null,
        defaultHourlyRate: input.defaultHourlyRate ?? null,
        overtimeThresholdMinutes: threshold,
        overtimeMultiplierPermille: multiplier,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
      },
      user.value,
      deps.clock.now(),
      settings.currency,
    );
    buf.audit({ action: "payroll.config.created", resourceType: "pay_config", resourceId: id, sensitive: true, after: configAudit(config) });
    await buf.flush(tx);
    return ok(config);
  });
}

export async function updatePayConfig(deps: PayrollDeps, ctx: RequestContext, input: Omit<ConfigInput, "staffId"> & { configId: Uuid }): Promise<Result<PayConfigRecord, AppError>> {
  const user = requireUser(ctx);
  if (!user.ok) return user;
  const bad = validateConfig(input);
  if (bad) return err(bad);
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const settings = await repo.ensureSettings(tx, ctx.tenantId);
    const before = await repo.getConfig(tx, input.configId, settings.currency);
    if (!before) return err(notFound("Configuration de paie", input.configId));
    const after = await repo.updateConfig(
      tx,
      input.configId,
      {
        type: input.type,
        monthlySalary: input.monthlySalary ?? null,
        annualSalary: input.annualSalary ?? null,
        defaultHourlyRate: input.defaultHourlyRate ?? null,
        overtimeThresholdMinutes: input.overtimeThresholdMinutes ?? before.overtimeThresholdMinutes,
        overtimeMultiplierPermille: input.overtimeMultiplierPermille ?? before.overtimeMultiplierPermille,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
      },
      deps.clock.now(),
      settings.currency,
    );
    buf.audit({ action: "payroll.config.updated", resourceType: "pay_config", resourceId: input.configId, sensitive: true, before: configAudit(before), after: configAudit(after) });
    await buf.flush(tx);
    return ok(after);
  });
}

const configAudit = (c: PayConfigRecord) => ({
  staffId: c.staffId,
  type: c.type,
  monthlySalary: c.monthlySalary?.amount ?? null,
  annualSalary: c.annualSalary?.amount ?? null,
  defaultHourlyRate: c.defaultHourlyRate?.amount ?? null,
  overtimeThresholdMinutes: c.overtimeThresholdMinutes,
  overtimeMultiplierPermille: c.overtimeMultiplierPermille,
  effectiveFrom: c.effectiveFrom,
  effectiveTo: c.effectiveTo,
});

export async function listPayConfigs(
  deps: PayrollDeps,
  ctx: RequestContext,
  input: { staffId?: Uuid | undefined; activeOn?: IsoDate | undefined; limit?: number | undefined; offset?: number | undefined },
): Promise<Result<{ items: PayConfigRecord[]; total: number }, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const settings = await repo.getSettings(tx);
      return ok(await repo.listConfigs(tx, { staffId: input.staffId, activeOn: input.activeOn, limit: input.limit ?? 100, offset: input.offset ?? 0 }, settings?.currency ?? "XOF"));
    },
    { readOnly: true },
  );
}

export async function getPayConfig(deps: PayrollDeps, ctx: RequestContext, configId: Uuid): Promise<Result<PayConfigRecord, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const settings = await repo.getSettings(tx);
      const c = await repo.getConfig(tx, configId, settings?.currency ?? "XOF");
      return c ? ok(c) : err(notFound("Configuration de paie", configId));
    },
    { readOnly: true },
  );
}

/** Configuration d'un enseignant en vigueur à `onDate` et son état calculé. */
export async function getCurrentConfig(deps: PayrollDeps, ctx: RequestContext, input: { staffId: Uuid; onDate: IsoDate }): Promise<Result<{ state: ConfigState; config: PayConfigRecord | null }, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const settings = await repo.getSettings(tx);
      const all = await repo.listConfigs(tx, { staffId: input.staffId, limit: 500, offset: 0 }, settings?.currency ?? "XOF");
      const state = configState(all.items, input.onDate);
      const config = all.items.find((c) => c.effectiveFrom <= input.onDate && (c.effectiveTo === null || c.effectiveTo >= input.onDate)) ?? null;
      return ok({ state, config });
    },
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------
// Tarifs horaires
// ---------------------------------------------------------------------------

export interface RateInput {
  curriculumNodeId: Uuid;
  /** `null` = tarif générique du nœud. */
  staffId?: Uuid | null | undefined;
  rate: number;
  validFrom: IsoDate;
  validTo?: IsoDate | null | undefined;
  notes?: string | null | undefined;
}

function validateRate(i: Pick<RateInput, "rate" | "validFrom" | "validTo">): AppError | null {
  const money = wholeMoney(i.rate, "rate");
  if (money) return money;
  if (!isIsoDate(i.validFrom)) return invalid("validFrom", "Date de début de validité invalide.");
  if (i.validTo != null) {
    if (!isIsoDate(i.validTo)) return invalid("validTo", "Date de fin de validité invalide.");
    return validateDateRange(i.validFrom, i.validTo, "validTo");
  }
  return null;
}

export async function createHourlyRate(deps: PayrollDeps, ctx: RequestContext, input: RateInput): Promise<Result<HourlyRateRecord, AppError>> {
  const user = requireUser(ctx);
  if (!user.ok) return user;
  const bad = validateRate(input);
  if (bad) return err(bad);
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const settings = await repo.ensureSettings(tx, ctx.tenantId);
    const id = deps.newId();
    const created = await repo.insertRate(
      tx,
      id,
      ctx.tenantId,
      { curriculumNodeId: input.curriculumNodeId, staffId: input.staffId ?? null, rate: input.rate, validFrom: input.validFrom, validTo: input.validTo ?? null, notes: input.notes?.trim() || null },
      user.value,
      deps.clock.now(),
      settings.currency,
    );
    buf.audit({ action: "payroll.rate.created", resourceType: "hourly_rate", resourceId: id, sensitive: true, after: { nodeId: input.curriculumNodeId, staffId: input.staffId ?? null, rate: input.rate, validFrom: input.validFrom, validTo: input.validTo ?? null } });
    await buf.flush(tx);
    return ok(created);
  });
}

export async function updateHourlyRate(deps: PayrollDeps, ctx: RequestContext, input: Pick<RateInput, "rate" | "validFrom" | "validTo" | "notes"> & { rateId: Uuid }): Promise<Result<HourlyRateRecord, AppError>> {
  const user = requireUser(ctx);
  if (!user.ok) return user;
  const bad = validateRate(input);
  if (bad) return err(bad);
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const settings = await repo.ensureSettings(tx, ctx.tenantId);
    const before = await repo.getRate(tx, input.rateId, settings.currency);
    if (!before) return err(notFound("Tarif horaire", input.rateId));
    const after = await repo.updateRate(tx, input.rateId, { rate: input.rate, validFrom: input.validFrom, validTo: input.validTo ?? null, notes: input.notes?.trim() || null }, deps.clock.now(), settings.currency);
    buf.audit({
      action: "payroll.rate.updated",
      resourceType: "hourly_rate",
      resourceId: input.rateId,
      sensitive: true,
      before: { rate: before.rate.amount, validFrom: before.validFrom, validTo: before.validTo },
      after: { rate: after.rate.amount, validFrom: after.validFrom, validTo: after.validTo },
    });
    await buf.flush(tx);
    return ok(after);
  });
}

/** Un tarif utilisé reste lisible via les lignes de bulletin qui le figent : les montants approuvés ne bougent jamais (AC2.7). */
export async function deleteHourlyRate(deps: PayrollDeps, ctx: RequestContext, rateId: Uuid): Promise<Result<{ deleted: true }, AppError>> {
  const user = requireUser(ctx);
  if (!user.ok) return user;
  return inTx(deps, ctx, async (tx) => {
    const buf = new EventBuffer(deps, ctx);
    const settings = await repo.ensureSettings(tx, ctx.tenantId);
    const before = await repo.getRate(tx, rateId, settings.currency);
    if (!before) return err(notFound("Tarif horaire", rateId));
    await repo.deleteRate(tx, rateId);
    buf.audit({ action: "payroll.rate.deleted", resourceType: "hourly_rate", resourceId: rateId, sensitive: true, before: { nodeId: before.curriculumNodeId, staffId: before.staffId, rate: before.rate.amount } });
    await buf.flush(tx);
    return ok({ deleted: true as const });
  });
}

export async function listHourlyRates(
  deps: PayrollDeps,
  ctx: RequestContext,
  input: { nodeId?: Uuid | undefined; staffId?: Uuid | undefined; generic?: boolean | undefined; activeOn?: IsoDate | undefined; limit?: number | undefined; offset?: number | undefined },
): Promise<Result<{ items: HourlyRateRecord[]; total: number }, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const settings = await repo.getSettings(tx);
      return ok(await repo.listRates(tx, { ...input, limit: input.limit ?? 100, offset: input.offset ?? 0 }, settings?.currency ?? "XOF"));
    },
    { readOnly: true },
  );
}

/** Simulateur (`GET /rates/resolve`) : le montant retenu et son origine pour (nœud, enseignant, date). */
export async function simulateRate(deps: PayrollDeps, ctx: RequestContext, input: { nodeId: Uuid | null; staffId: Uuid; date: IsoDate }): Promise<Result<{ rate: number | null; origin: ResolvedRate["origin"] | null; configState: ConfigState }, AppError>> {
  if (!isIsoDate(input.date)) return err(invalid("date", "Date invalide (AAAA-MM-JJ)."));
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const settings = await repo.getSettings(tx);
      const currency = settings?.currency ?? "XOF";
      const configs = await repo.listConfigs(tx, { staffId: input.staffId, limit: 500, offset: 0 }, currency);
      const state = configState(configs.items, input.date);
      const config = configs.items.find((c) => c.effectiveFrom <= input.date && (c.effectiveTo === null || c.effectiveTo >= input.date)) ?? null;
      const rates = await repo.listRatesOverlapping(tx, input.date, input.date, currency);
      const resolved = resolveRate({
        index: new RateIndex(rates.map((r) => ({ id: r.id, nodeId: r.curriculumNodeId, staffId: r.staffId, rate: r.rate, validFrom: r.validFrom, validTo: r.validTo }))),
        nodeId: input.nodeId,
        staffId: input.staffId,
        date: input.date,
        configType: config?.type ?? "HOURLY",
        configDefaultRate: config?.defaultHourlyRate ?? null,
        zero: Money.zero(currency),
      });
      // Aucun taux publié s'il n'est pas calculable (pas de « 0 F/h » inventé, AC7.3).
      return ok({ rate: resolved ? resolved.rate.amount : null, origin: resolved ? resolved.origin : null, configState: state });
    },
    { readOnly: true },
  );
}
