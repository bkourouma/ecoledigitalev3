/** Aides communes des cas d'usage : chargement et périmètre d'une séance, noms figés, contexte d'affichage. */
import { err, ok, isAppError, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { CouncilsCode, forbidden, notFound } from "../domain/errors";
import * as councilsRepo from "../infrastructure/councils-repository";
import * as reference from "../infrastructure/reference-repository";
import type { CouncilRow, CouncilTypeRow, RoleRow } from "../infrastructure/rows";
import type { CallerCaps, CouncilsDeps } from "./deps";
import type { RuleSourceKind } from "./ports";
import type { CouncilContext } from "./views";

/** Séance, ou « introuvable ». `lock` : `SELECT … FOR UPDATE` (sérialise deux sessions simultanées sur la même séance). */
export async function loadCouncil(tx: Tx, id: string, options: { lock?: boolean } = {}): Promise<Result<CouncilRow, AppError>> {
  const row = await councilsRepo.getCouncil(tx, id, options);
  return row ? ok(row) : err(notFound(CouncilsCode.NOT_FOUND, "Conseil", id));
}

/**
 * Périmètre de lecture d'une séance : `council.read` voit toutes les séances ; un enseignant (`council.proposal.write`) ne voit que
 * celles de SES classes (affectation vérifiée par `people`). Hors périmètre : introuvable (jamais 403 : l'existence n'est pas divulguée).
 */
export async function assertMayView(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, council: CouncilRow): Promise<Result<void, AppError>> {
  if (caps.read || caps.manage) return ok(undefined);
  if (caps.proposalWrite && ctx.userId && (await deps.ports.staff.isStaffAssignedToClassroom(ctx, ctx.userId, council.classroomId))) return ok(undefined);
  return err(notFound(CouncilsCode.NOT_FOUND, "Conseil", council.id));
}

export async function actorNameOf(deps: CouncilsDeps, ctx: RequestContext): Promise<string> {
  if (!ctx.userId) return "Utilisateur";
  const name = (await deps.ports.staff.displayNameOfUser(ctx, ctx.userId)).trim();
  return name.length > 0 ? name : "Utilisateur";
}

export async function loadRoles(tx: Tx): Promise<Map<string, RoleRow>> {
  return new Map((await reference.listRoles(tx)).map((r) => [r.code, r]));
}

/** Origine du jeu de règles épinglé ; `null` si `results` ne la fournit pas (jamais déduite). Un port absent dégrade, ne bloque pas. */
export async function ruleSourceOf(deps: CouncilsDeps, ctx: RequestContext, council: CouncilRow): Promise<RuleSourceKind | null> {
  try {
    const view = await deps.ports.resultsRead.getStateView(ctx, { classroomId: council.classroomId, academicYearId: council.academicYearId, academicPeriodId: council.academicPeriodId });
    return view?.ruleSourceKind ?? null;
  } catch (e) {
    if (isAppError(e)) return null;
    throw e;
  }
}

/** Nom de la classe et libellé de la période (confort d'affichage) : un port indisponible dégrade vers `null`. */
export async function displayContext(deps: CouncilsDeps, ctx: RequestContext, council: CouncilRow, type: CouncilTypeRow | undefined, counts: councilsRepo.CouncilCounts | undefined, options: { withRuleSource?: boolean } = {}): Promise<CouncilContext> {
  let classroomName: string | null = null;
  let periodLabel: string | null = null;
  try {
    classroomName = (await deps.ports.academic.getClassroom(ctx, council.classroomId))?.name ?? null;
    if (council.academicPeriodId) periodLabel = (await deps.ports.academic.getPeriod(ctx, council.academicPeriodId))?.label ?? null;
  } catch (e) {
    if (!isAppError(e)) throw e;
  }
  const ruleSourceKind = options.withRuleSource === false ? null : await ruleSourceOf(deps, ctx, council);
  return { type, classroomName, periodLabel, ruleSourceKind, counts };
}

export const forbiddenFor = (permission: string): AppError => forbidden(CouncilsCode.PERMISSION_REQUIRED, `Cette action exige l'autorisation « ${permission} ».`);

export const clampPage = (page: number, pageSize: number): { limit: number; offset: number } => {
  const size = Math.min(200, Math.max(1, pageSize));
  return { limit: size, offset: (Math.max(1, page) - 1) * size };
};

/** Référence OPAQUE de l'acte du conseil tracée par `results` : « council:<séance> » ou « decision:<décision> ». */
export const councilRefOf = (councilId: string): string => `council:${councilId}`;
export const decisionRefOf = (decisionId: string): string => `decision:${decisionId}`;
export const proposalRefOf = (proposalId: string): string => `proposal:${proposalId}`;
