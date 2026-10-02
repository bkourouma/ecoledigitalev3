/**
 * Lectures transverses : journal de séance, synthèse de classe, portails famille / élève, faits publiés pour les autres modules.
 *
 *  - PORTAILS : un tuteur lit uniquement les décisions des enfants avec lesquels il a un lien VIVANT (relu à chaque lecture ; hors lien :
 *    introuvable, jamais 403) ; la visibilité suit `guardian_visibility` (jamais / après signature / après notification) ; JAMAIS la suggestion
 *    de la règle, le vote, la justification interne ni le détail des autres élèves.
 *  - Faits pour les autres modules (`getCouncilDecisionsForEnrollment`) : décision, appréciation générale, distinctions — jamais de calcul.
 */
import { err, isAppError, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { CouncilsClassroomSummaryDto, CouncilsEnrollmentDecisionsDto, CouncilsFamilyDecisionsDto } from "@ecoledigitale/contracts/src/v2/councils";
import { CouncilsCode, forbidden, notFound } from "../domain/errors";
import * as repo from "../infrastructure/councils-repository";
import * as effectsRepo from "../infrastructure/effects-repository";
import * as minutesRepo from "../infrastructure/minutes-repository";
import * as reference from "../infrastructure/reference-repository";
import type { CouncilRow } from "../infrastructure/rows";
import { inTx, type CallerCaps, type CouncilsDeps } from "./deps";
import { assertMayView, loadCouncil } from "./support";
import { eventDto } from "./views";

export async function listEventsView(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, councilId: string): Promise<Result<{ items: ReturnType<typeof eventDto>[] }, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const council = await loadCouncil(tx, councilId);
      if (!council.ok) return council;
      const may = await assertMayView(deps, ctx, caps, council.value);
      if (!may.ok) return may;
      return ok({ items: (await minutesRepo.listEvents(tx, councilId)).map(eventDto) });
    },
    { readOnly: true },
  );
}

export async function getClassroomSummary(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, classroomId: string): Promise<Result<CouncilsClassroomSummaryDto, AppError>> {
  if (!caps.read && !caps.manage) return err(forbidden(CouncilsCode.PERMISSION_REQUIRED, "La synthèse d'une classe exige l'autorisation de consultation."));
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const councils = await repo.listCouncilsOfClassroom(tx, classroomId);
      const counts = await repo.countsOfCouncils(tx, councils.map((c) => c.id));
      const decisions = await repo.decisionCountsOfClassroom(tx, classroomId);
      const effects = await effectsRepo.effectCountsOfClassroom(tx, classroomId);
      const types = new Map((await reference.listCouncilTypes(tx)).map((t) => [t.id, t]));
      return ok({
        classroomId,
        councils: councils.map((c) => ({ id: c.id, councilTypeCode: types.get(c.councilTypeId)?.code ?? "", academicPeriodId: c.academicPeriodId, status: c.status, heldOn: c.heldOn, agendaItems: counts.get(c.id)?.agendaItems ?? 0, decided: counts.get(c.id)?.decided ?? 0, reopenCount: c.reopenCount })),
        decisionsByCode: Object.fromEntries(decisions.map((d) => [d.code, d.n])),
        effects,
        reviewNeeded: await minutesRepo.reviewNeededCouncilIds(tx, classroomId),
      });
    },
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Portails
// ---------------------------------------------------------------------------------------------------------------------

async function visibleDecisions(deps: CouncilsDeps, ctx: RequestContext, tx: Tx, studentId: string): Promise<CouncilsFamilyDecisionsDto["items"]> {
  const decisions = await repo.listDecisionsOfStudent(tx, studentId);
  if (decisions.length === 0) return [];
  const councils = new Map<string, CouncilRow>();
  for (const d of decisions) if (!councils.has(d.councilId)) councils.set(d.councilId, (await repo.getCouncil(tx, d.councilId)) as CouncilRow);
  const types = new Map((await reference.listDecisionTypes(tx)).map((t) => [t.id, t]));
  const councilTypes = new Map((await reference.listCouncilTypes(tx)).map((t) => [t.id, t]));
  const notified = await effectsRepo.notifiedDecisionIds(tx, decisions.map((d) => d.id));
  const settingsByInstitution = new Map<string, Awaited<ReturnType<typeof reference.getSettings>>>();
  const itemIds = decisions.map((d) => d.agendaItemId);
  const accepted = await repo.listAcceptedProposalsOfItems(tx, itemIds);
  const out: CouncilsFamilyDecisionsDto["items"] = [];
  for (const d of decisions) {
    const c = councils.get(d.councilId);
    if (!c || (c.status !== "SIGNED" && c.status !== "CLOSED")) continue;
    if (!settingsByInstitution.has(c.institutionId)) settingsByInstitution.set(c.institutionId, await reference.getSettings(tx, c.institutionId));
    const visibility = settingsByInstitution.get(c.institutionId)?.guardianVisibility ?? "AFTER_NOTIFICATION";
    const visible = visibility === "NEVER" ? false : visibility === "AFTER_SIGNATURE" ? c.status === "SIGNED" : notified.has(d.id);
    if (!visible) continue;
    let periodLabel: string | null = null;
    if (c.academicPeriodId) {
      try {
        periodLabel = (await deps.ports.academic.getPeriod(ctx, c.academicPeriodId))?.label ?? null;
      } catch (e) {
        if (!isAppError(e)) throw e;
      }
    }
    const mine = accepted.filter((p) => p.agendaItemId === d.agendaItemId);
    out.push({
      councilId: c.id,
      councilTypeLabel: councilTypes.get(c.councilTypeId)?.label ?? "",
      periodLabel,
      heldOn: c.heldOn,
      decisionTypeLabel: types.get(d.decisionTypeId)?.label ?? d.decisionTypeCode,
      family: d.family,
      targetLabel: d.targetLabel,
      appreciation: mine.filter((p) => p.kind === "APPRECIATION").at(-1)?.body ?? null,
      distinctions: [...new Set(mine.filter((p) => p.kind === "DISTINCTION" && p.code !== null).map((p) => p.code as string))],
    });
  }
  return out;
}

async function namesOf(deps: CouncilsDeps, ctx: RequestContext, studentId: string): Promise<string | null> {
  try {
    return (await deps.ports.family.getStudentNames(ctx, [studentId])).get(studentId) ?? null;
  } catch (e) {
    if (isAppError(e)) return null;
    throw e;
  }
}

/** Portail élève : le dossier du COMPTE connecté (jamais un identifiant fourni par la requête). */
export async function getMyDecisions(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps): Promise<Result<CouncilsFamilyDecisionsDto, AppError>> {
  if (!caps.selfRead || !ctx.userId) return err(forbidden(CouncilsCode.PERMISSION_REQUIRED, "Ce portail est réservé à l'élève."));
  const studentId = await deps.ports.family.getStudentIdForUser(ctx, ctx.userId);
  if (!studentId) return err(notFound(CouncilsCode.NOT_FOUND, "Dossier élève"));
  return inTx(deps, ctx, async (tx) => ok({ studentId, studentName: await namesOf(deps, ctx, studentId), items: await visibleDecisions(deps, ctx, tx, studentId) }), { readOnly: true });
}

/** Portail parent : lien tuteur ↔ élève RELU à chaque lecture ; hors lien : introuvable (jamais 403, l'existence n'est pas divulguée). */
export async function getChildDecisions(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, studentId: string): Promise<Result<CouncilsFamilyDecisionsDto, AppError>> {
  if (!caps.childRead || !ctx.userId) return err(forbidden(CouncilsCode.PERMISSION_REQUIRED, "Ce portail est réservé aux parents."));
  if (!(await deps.ports.family.isGuardianOfStudent(ctx, ctx.userId, studentId))) return err(notFound(CouncilsCode.NOT_FOUND, "Élève", studentId));
  return inTx(deps, ctx, async (tx) => ok({ studentId, studentName: await namesOf(deps, ctx, studentId), items: await visibleDecisions(deps, ctx, tx, studentId) }), { readOnly: true });
}

// ---------------------------------------------------------------------------------------------------------------------
// Faits publiés pour les autres modules (bulletins, examens, analytics)
// ---------------------------------------------------------------------------------------------------------------------

/** Décisions du conseil, appréciation générale et distinctions d'une inscription (aucun calcul ; décisions retirées exclues). */
export async function getCouncilDecisionsForEnrollment(deps: CouncilsDeps, ctx: RequestContext, input: { enrollmentId: string }): Promise<Result<CouncilsEnrollmentDecisionsDto, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const decisions = (await repo.listDecisionsOfEnrollment(tx, input.enrollmentId)).filter((d) => d.status === "RECORDED");
      const councils = new Map<string, CouncilRow>();
      for (const d of decisions) if (!councils.has(d.councilId)) councils.set(d.councilId, (await repo.getCouncil(tx, d.councilId)) as CouncilRow);
      const item = decisions[0] ? await repo.getAgendaItem(tx, decisions[0].agendaItemId) : null;
      const accepted = item ? await repo.listAcceptedProposalsOfItems(tx, [item.id]) : [];
      return ok({
        enrollmentId: input.enrollmentId,
        decisions: decisions.map((d) => ({ councilId: d.councilId, decisionTypeCode: d.decisionTypeCode, family: d.family, status: d.status, councilStatus: (councils.get(d.councilId) as CouncilRow).status, decidedAt: d.decidedAt.toISOString() })),
        appreciation: accepted.filter((p) => p.kind === "APPRECIATION").at(-1)?.body ?? null,
        distinctions: [...new Set(accepted.filter((p) => p.kind === "DISTINCTION" && p.code !== null).map((p) => p.code as string))],
      });
    },
    { readOnly: true },
  );
}
