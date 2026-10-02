/**
 * Aides communes des cas d'usage : habilitation (audience SQL), périmètre d'élève, résolution d'inscription, noms figés.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { SchoolLifeAudience, SchoolLifeConfidentiality } from "@ecoledigitale/contracts/src/v2/schoollife";
import { audienceMaySee, clearanceOf, staffAudience } from "../domain/confidentiality";
import { forbidden, notFound, SchoolLifeCode } from "../domain/errors";
import * as reference from "../infrastructure/reference-repository";
import type { EventTypeRow } from "../infrastructure/rows";
import { clearanceOfCaps, type CallerCaps, type SchoolLifeDeps } from "./deps";
import type { EnrollmentInfo } from "./ports";

export interface Viewer {
  readonly clearance: SchoolLifeConfidentiality;
  readonly audience: SchoolLifeAudience;
  readonly readAll: boolean;
}

export const viewerOf = (caps: CallerCaps): Viewer => {
  const clearance = clearanceOfCaps(caps);
  return { clearance, audience: staffAudience(clearance), readAll: caps.readAll === true };
};

/** Un élément de cette confidentialité est-il VISIBLE (existence comprise) pour cette habilitation de personnel ? Règle SQL miroir. */
export const staffMaySee = (viewer: Viewer, kind: string, confidentiality: string, status: string): boolean =>
  audienceMaySee({ audience: viewer.audience, kind, confidentiality, shareable: true, status });

/**
 * Périmètre d'élève du personnel : tous les élèves (`schoollife.read.all`) ou ceux de SES classes (affectation vérifiée par
 * `people`, même règle que `student.class.read`). Hors périmètre : introuvable (jamais 403 : l'existence n'est pas divulguée).
 */
export async function assertStudentScope(deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, studentId: string): Promise<Result<void, AppError>> {
  if (caps.readAll) return ok(undefined);
  if (await deps.ports.people.staffCanReadStudent(ctx, studentId)) return ok(undefined);
  return err(notFound(SchoolLifeCode.NOT_FOUND, "Élève", studentId));
}

/** Inscription (port academic) dans le périmètre de l'appelant. */
export async function resolveEnrollment(
  deps: SchoolLifeDeps,
  ctx: RequestContext,
  caps: CallerCaps,
  enrollmentId: string,
  options: { requireActive?: boolean } = {},
): Promise<Result<EnrollmentInfo, AppError>> {
  const enrollment = await deps.ports.enrollments.getEnrollment(ctx, enrollmentId);
  if (!enrollment) return err(notFound(SchoolLifeCode.ENROLLMENT_NOT_FOUND, "Inscription", enrollmentId));
  const scope = await assertStudentScope(deps, ctx, caps, enrollment.studentId);
  if (!scope.ok) return err(notFound(SchoolLifeCode.ENROLLMENT_NOT_FOUND, "Inscription", enrollmentId));
  if (options.requireActive !== false && !enrollment.active) {
    return err(forbidden(SchoolLifeCode.ENROLLMENT_INACTIVE, "Cette inscription n'est plus active : aucun enregistrement de vie scolaire n'y est accepté."));
  }
  return ok(enrollment);
}

export async function actorNameOf(deps: SchoolLifeDeps, ctx: RequestContext): Promise<string> {
  if (!ctx.userId) return "Utilisateur";
  const name = (await deps.ports.people.displayNameOfUser(ctx, ctx.userId)).trim();
  return name.length > 0 ? name : "Utilisateur";
}

export async function loadTypes(tx: Tx, ids: readonly string[]): Promise<Map<string, EventTypeRow>> {
  const unique = [...new Set(ids)];
  return new Map((await reference.getEventTypesByIds(tx, unique)).map((t) => [t.id, t]));
}

export async function studentNames(deps: SchoolLifeDeps, ctx: RequestContext, studentIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const unique = [...new Set(studentIds)];
  if (unique.length === 0) return new Map();
  try {
    return await deps.ports.people.getStudentNames(ctx, unique);
  } catch (e) {
    // Les noms sont un confort d'affichage : sans le port `people`, on dégrade (identifiants seuls) plutôt que de bloquer une lecture.
    deps.logger.warn({ err: e }, "schoollife : noms d'élèves indisponibles");
    return new Map();
  }
}

export const clearanceOfViewer = (caps: CallerCaps): SchoolLifeConfidentiality => clearanceOf({ restricted: caps.restrictedRead === true, confidential: caps.confidentialRead === true });

/** Seuils d'habilitation : rang minimal de lecture d'un niveau. */
export function isoOf(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

export const clampPage = (page: number, pageSize: number): { limit: number; offset: number } => ({ limit: Math.min(200, Math.max(1, pageSize)), offset: (Math.max(1, page) - 1) * Math.min(200, Math.max(1, pageSize)) });
