/**
 * Aides communes des cas d'usage : établissement visé, identité de l'acteur, validation de références.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { AdmissionsCode, forbidden, notFound, validation } from "../domain/errors";
import { SYSTEM_ACTOR_ID, SYSTEM_ACTOR_NAME, type AdmissionsDeps } from "./deps";

export const nowIso = (deps: AdmissionsDeps): string => deps.clock.now().toISOString();

/** Identifiant de l'utilisateur agissant ; un contexte système n'a pas d'utilisateur (jobs, abonnés). */
export const actorIdOf = (ctx: RequestContext): string | null => ctx.userId;

export function requireUser(ctx: RequestContext): Result<string, AppError> {
  return ctx.userId ? ok(ctx.userId) : err(forbidden(AdmissionsCode.FORBIDDEN, "Cette action exige un utilisateur connecté."));
}

/** Identité FIGÉE dans une décision : nom d'affichage du compte, ou « Système » pour un traitement automatique. */
export async function decider(deps: AdmissionsDeps, ctx: RequestContext): Promise<{ id: string; name: string }> {
  if (!ctx.userId) return { id: SYSTEM_ACTOR_ID, name: SYSTEM_ACTOR_NAME };
  let name: string | null = null;
  try {
    name = (await deps.ports.actors.displayName(ctx, ctx.userId))?.trim() || null;
  } catch {
    name = null;
  }
  return { id: ctx.userId, name: name ?? `Utilisateur ${ctx.userId.slice(0, 8)}` };
}

/**
 * Établissement visé : celui qui est fourni (vérifié par le catalogue), sinon l'unique établissement du tenant.
 * Plusieurs établissements sans choix : `admissions.institution_required`.
 */
export async function resolveInstitution(deps: AdmissionsDeps, ctx: RequestContext, requested?: string | null): Promise<Result<string, AppError>> {
  if (requested) {
    const info = await deps.ports.catalog.getInstitution(ctx, requested);
    return info ? ok(info.id) : err(notFound(AdmissionsCode.INSTITUTION_UNKNOWN, "Établissement", requested));
  }
  const all = await deps.ports.catalog.listInstitutions(ctx);
  if (all.length === 1) return ok((all[0] as { id: string }).id);
  if (all.length === 0) return err(notFound(AdmissionsCode.INSTITUTION_UNKNOWN, "Établissement"));
  return err(validation(AdmissionsCode.INSTITUTION_REQUIRED, "Plusieurs établissements : précisez institutionId.", "institutionId"));
}

/** Date calendaire du jour (UTC) : sert aux contrôles de plausibilité (naissance dans le passé). */
export const todayIso = (deps: AdmissionsDeps): string => deps.clock.now().toISOString().slice(0, 10);

/** Réponse de pagination. */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
