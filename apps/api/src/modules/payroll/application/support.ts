/** Aides communes des cas d'usage : acteur figé, noms du personnel, validations simples. */
import { CURRENCIES, ForbiddenError, UnauthorizedError, err, ok, type CurrencyCode, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { AppError } from "@ecoledigitale/kernel";
import { PayrollCodes, invalid, portUnavailable } from "../domain/errors";
import type { Uuid } from "../domain/types";
import type { PayrollDeps } from "./deps";
import type { StaffDirectoryPort, StaffInfo } from "./ports";
import type { Actor } from "../infrastructure/payslip-repo";

export const MIN_REASON_LENGTH = 3;
export const PAYSLIP_AGGREGATE = "payslip";
export const PERIOD_AGGREGATE = "pay_period";
export const RUN_AGGREGATE = "calculation_run";

export const trimReason = (reason: string | undefined | null): string => (reason ?? "").trim();

export function requireUser(ctx: RequestContext): Result<string, AppError> {
  return ctx.userId ? ok(ctx.userId) : err(new UnauthorizedError("Un utilisateur identifié est requis.", { code: PayrollCodes.forbidden }));
}

export const isCurrency = (code: string): code is CurrencyCode => Object.prototype.hasOwnProperty.call(CURRENCIES, code);

/**
 * Identité FIGÉE de l'acteur au moment de l'acte (R-PAY-15) : nom résolu par le port du personnel quand il existe,
 * sinon un libellé stable construit sur l'identifiant. Le journal survit à toute modification du compte.
 */
export async function resolveActor(deps: PayrollDeps, ctx: RequestContext): Promise<Actor> {
  const id = ctx.userId;
  if (id === null) return { id: null, name: "Système" };
  let name: string | null = null;
  try {
    name = (await deps.ports.staff?.getUserDisplayName?.(ctx, id)) ?? null;
  } catch (e) {
    deps.logger.warn({ err: e instanceof Error ? e.message : String(e) }, "payroll : nom de l'acteur non résolu");
  }
  return { id, name: name && name.trim() ? name.trim() : `Utilisateur ${id.slice(0, 8)}` };
}

export const fallbackStaffName = (staffId: Uuid): string => `Enseignant ${staffId.slice(0, 8)}`;

/** Fiches du personnel par identifiant (port 009) ; absent ou en panne -> repli sur un libellé stable. */
export async function staffInfoMap(deps: PayrollDeps, ctx: RequestContext, staffIds: readonly Uuid[]): Promise<Map<Uuid, StaffInfo>> {
  const out = new Map<Uuid, StaffInfo>();
  const port = deps.ports.staff;
  if (!port || staffIds.length === 0) return out;
  try {
    for (const s of await port.getStaffMany(ctx, [...new Set(staffIds)])) out.set(s.staffId, s);
  } catch (e) {
    deps.logger.warn({ err: e instanceof Error ? e.message : String(e) }, "payroll : annuaire du personnel indisponible, libellés de repli");
  }
  return out;
}

export const staffNameOf = (map: ReadonlyMap<Uuid, StaffInfo>, staffId: Uuid): string => map.get(staffId)?.displayName ?? fallbackStaffName(staffId);

/** L'annuaire est REQUIS (échec fermé) : titulaire d'un bulletin, vérification d'existence. */
export function requireStaffDirectory(deps: PayrollDeps): Result<StaffDirectoryPort, AppError> {
  const port = deps.ports.staff;
  return port ? ok(port) : err(portUnavailable("personnel (009)"));
}

export function forbiddenOwner(): ForbiddenError {
  return new ForbiddenError("Vous ne pouvez consulter que vos propres bulletins.", { code: PayrollCodes.forbidden });
}

export function validateDateRange(startDate: string, endDate: string, path = "endDate"): AppError | null {
  return endDate < startDate ? invalid(path, "La date de fin précède la date de début.") : null;
}

/** Nombre entier de XOF (ou de la devise) : jamais de flottant ni de négatif. */
export function wholeMoney(value: number, path: string): AppError | null {
  return Number.isSafeInteger(value) && value >= 0 ? null : invalid(path, "Le montant doit être un entier positif ou nul.");
}
