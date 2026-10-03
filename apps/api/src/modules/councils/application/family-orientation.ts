/**
 * Dossier d'orientation vu par la FAMILLE (tuteur lié) et par l'ÉLÈVE (compte de l'élève, lecture seule) — spec 006 US7 / AC12.2 / AC12.4.
 *
 * Règle de minimisation (la même que les décisions du conseil des portails, `reads.ts`) :
 *  - le tuteur ne lit que les élèves avec lesquels il a un lien VIVANT (relu à chaque lecture) ; hors lien : introuvable (404 uniforme,
 *    jamais 403 : l'existence d'un dossier n'est pas divulguée) ; l'élève ne lit que le dossier du COMPTE connecté (jamais un
 *    identifiant fourni par la requête) ;
 *  - JAMAIS : notes internes, décision du conseil (identifiant), vœux du personnel ou du conseiller d'orientation (avis internes),
 *    vœux retirés, auteur des vœux, ni quoi que ce soit d'un autre élève ;
 *  - l'état est MASQUÉ tant que la décision du conseil n'est pas visible de la famille selon `guardian_visibility` (jamais / après
 *    signature / après notification) : un dossier « décidé » ou « appliqué » reste alors vu comme « vœux recueillis » ;
 *  - les destinations proposées (`options`) sont des DONNÉES de l'établissement (parcours autorisés actifs pour la situation de l'élève),
 *    vides tant que l'établissement n'en a saisi aucun : aucune règle d'orientation officielle n'est inventée ici.
 */
import { err, isAppError, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { CouncilsFamilyOrientationDto, CouncilsFamilyOrientationFileDto, CouncilsFamilyOrientationOptionDto, CouncilsOrientationFileDto } from "@ecoledigitale/contracts/src/v2/councils";
import { CouncilsCode, forbidden, notFound } from "../domain/errors";
import * as repo from "../infrastructure/councils-repository";
import * as effectsRepo from "../infrastructure/effects-repository";
import * as orientation from "../infrastructure/orientation-repository";
import * as reference from "../infrastructure/reference-repository";
import type { OrientationFileRow, OrientationPathRow, WishRow } from "../infrastructure/rows";
import { inTx, type CallerCaps, type CouncilsDeps } from "./deps";

type FileStatus = OrientationFileRow["status"];
type FamilyStage = CouncilsFamilyOrientationFileDto["stage"];

/** La décision du conseil est-elle visible de la famille ? (même prédicat que `visibleDecisions` : signature / notification selon l'établissement). */
export async function familyMaySeeDecision(tx: Tx, decisionId: string | null): Promise<boolean> {
  if (!decisionId) return false;
  const d = await repo.getDecision(tx, decisionId);
  if (!d || d.status !== "RECORDED") return false;
  const council = await repo.getCouncil(tx, d.councilId);
  if (!council || (council.status !== "SIGNED" && council.status !== "CLOSED")) return false;
  const visibility = (await reference.getSettings(tx, council.institutionId))?.guardianVisibility ?? "AFTER_NOTIFICATION";
  if (visibility === "NEVER") return false;
  if (visibility === "AFTER_SIGNATURE") return council.status === "SIGNED";
  return (await effectsRepo.notifiedDecisionIds(tx, [d.id])).has(d.id);
}

/** État tel que la famille a le droit de le voir (jamais « proposé » : c'est un avis interne ; jamais « décidé » avant la visibilité). */
export function familyStage(status: FileStatus, decisionVisible: boolean): FamilyStage {
  switch (status) {
    case "OPEN":
    case "WISHES_COLLECTED":
      return status;
    case "PROPOSED":
      return "WISHES_COLLECTED";
    case "DECIDED":
    case "APPLIED":
      return decisionVisible ? status : "WISHES_COLLECTED";
    case "CLOSED":
      return decisionVisible ? "CLOSED" : "WISHES_COLLECTED";
    case "CANCELLED":
      return "CANCELLED";
  }
}

const FAMILY_SOURCES = new Set<WishRow["source"]>(["GUARDIAN", "STUDENT"]);

/** Vœux exposables : ceux de la famille et de l'élève, non retirés, classés. */
function visibleWishes(wishes: readonly WishRow[], fileId: string): WishRow[] {
  return wishes.filter((w) => w.fileId === fileId && w.withdrawnAt === null && FAMILY_SOURCES.has(w.source)).sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0)); // ordre d'affichage des vœux (aucun calcul)
}

/** Parcours autorisés actifs qui s'appliquent à la situation courante du dossier (donnée de l'établissement). */
export function pathsForFile(paths: readonly OrientationPathRow[], file: OrientationFileRow): OrientationPathRow[] {
  return paths.filter((p) => p.active && (p.institutionId === null || p.institutionId === file.institutionId) && p.fromGradeLevelId === file.currentGradeLevelId && (p.fromProgramId === null || p.fromProgramId === file.currentProgramId));
}

const iso = (d: Date): string => d.toISOString();

function familyFile(file: OrientationFileRow, wishes: readonly WishRow[], paths: readonly OrientationPathRow[], stage: FamilyStage, guardian: boolean): CouncilsFamilyOrientationFileDto {
  const labelOf = (w: WishRow): string | null => paths.find((p) => p.toProgramId === w.toProgramId && p.toGradeLevelId === w.toGradeLevelId && p.label)?.label ?? null;
  const live = stage === "OPEN" || stage === "WISHES_COLLECTED" || stage === "DECIDED";
  return {
    id: file.id,
    academicYearId: file.academicYearId,
    stage,
    guardianConsent: file.guardianConsent,
    consentRecordedAt: file.consentRecordedAt ? iso(file.consentRecordedAt) : null,
    wishesOpen: guardian && live,
    consentOpen: guardian && file.guardianConsent !== "NOT_REQUIRED" && live,
    wishes: visibleWishes(wishes, file.id).map((w) => ({
      id: w.id,
      rank: w.rank,
      toProgramId: w.toProgramId,
      toGradeLevelId: w.toGradeLevelId,
      targetLabel: labelOf(w),
      optionIds: w.optionIds,
      source: w.source as "GUARDIAN" | "STUDENT",
      expressedAt: iso(w.expressedAt),
      comment: w.comment,
    })),
  };
}

function optionsOf(paths: readonly OrientationPathRow[]): CouncilsFamilyOrientationOptionDto[] {
  return paths.map((p) => ({ pathId: p.id, label: p.label, kind: p.kind, toProgramId: p.toProgramId, toGradeLevelId: p.toGradeLevelId, requiresGuardianConsent: p.requiresGuardianConsent }));
}

async function namesOf(deps: CouncilsDeps, ctx: RequestContext, studentId: string): Promise<string | null> {
  try {
    return (await deps.ports.family.getStudentNames(ctx, [studentId])).get(studentId) ?? null;
  } catch (e) {
    if (isAppError(e)) return null;
    throw e;
  }
}

async function build(deps: CouncilsDeps, ctx: RequestContext, tx: Tx, studentId: string, guardian: boolean): Promise<CouncilsFamilyOrientationDto> {
  const { rows } = await orientation.listFiles(tx, { studentId }, { limit: 1, offset: 0 });
  const file = rows[0] ?? null;
  const studentName = await namesOf(deps, ctx, studentId);
  if (!file) return { studentId, studentName, file: null, options: [] };
  const wishes = await orientation.listWishes(tx, [file.id]);
  const paths = pathsForFile(await orientation.listPaths(tx, { activeOnly: true }), file);
  const stage = familyStage(file.status, await familyMaySeeDecision(tx, file.decisionId));
  return { studentId, studentName, file: familyFile(file, wishes, paths, stage, guardian), options: guardian ? optionsOf(paths) : [] };
}

/** Portail parent : lien tuteur ↔ élève RELU à chaque lecture ; hors lien : introuvable (jamais 403). */
export async function getChildOrientation(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps, studentId: string): Promise<Result<CouncilsFamilyOrientationDto, AppError>> {
  if (!caps.childRead || !ctx.userId) return err(forbidden(CouncilsCode.PERMISSION_REQUIRED, "Ce portail est réservé aux parents."));
  if (!(await deps.ports.family.isGuardianOfStudent(ctx, ctx.userId, studentId))) return err(notFound(CouncilsCode.NOT_FOUND, "Élève", studentId));
  return inTx(deps, ctx, async (tx) => ok(await build(deps, ctx, tx, studentId, true)), { readOnly: true });
}

/** Portail élève : le dossier du COMPTE connecté, en lecture seule (jamais un identifiant fourni par la requête). */
export async function getMyOrientation(deps: CouncilsDeps, ctx: RequestContext, caps: CallerCaps): Promise<Result<CouncilsFamilyOrientationDto, AppError>> {
  if (!caps.selfRead || !ctx.userId) return err(forbidden(CouncilsCode.PERMISSION_REQUIRED, "Ce portail est réservé à l'élève."));
  const studentId = await deps.ports.family.getStudentIdForUser(ctx, ctx.userId);
  if (!studentId) return err(notFound(CouncilsCode.NOT_FOUND, "Dossier élève"));
  return inTx(deps, ctx, async (tx) => ok(await build(deps, ctx, tx, studentId, false)), { readOnly: true });
}

/**
 * Réponse d'une écriture de la FAMILLE (vœu, accord) : même forme que le DTO du personnel, mais expurgée — plus de notes, de
 * décision, de vœux du personnel ni de vœux retirés d'autrui, et un état masqué selon la visibilité.
 */
export async function redactFileForFamily(tx: Tx, file: OrientationFileRow, dto: CouncilsOrientationFileDto): Promise<CouncilsOrientationFileDto> {
  const stage = familyStage(file.status, await familyMaySeeDecision(tx, file.decisionId));
  return {
    ...dto,
    status: stage,
    notes: null,
    decisionId: null,
    wishes: dto.wishes.filter((w) => FAMILY_SOURCES.has(w.source as WishRow["source"])),
  };
}
