/**
 * Programmes (filière, série, spécialité, parcours — arbre à deux niveaux), niveaux couverts, catalogue de
 * matières réutilisables. Plus aucune détection par expression régulière sur le nom (« licence 1 »…) : le cycle est
 * `education_level_id`, le niveau est un `grade_levels`.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { AcademicCreateProgramBody, AcademicCreateSubjectBody } from "@ecoledigitale/contracts/src/v2/academic";
import { AcademicCode, conflict, notFound, validation } from "../domain/errors";
import type { Program, Subject } from "../domain/records";
import * as cur from "../infrastructure/curriculum-repository";
import * as ref from "../infrastructure/reference-repository";
import { assertInstitutionScope, inReadTx, inScope, inTx, type AcademicDeps } from "./deps";

export async function listPrograms(deps: AcademicDeps, ctx: RequestContext, filter: { institutionId?: string | null; status?: string | null; educationLevelId?: string | null } = {}): Promise<Result<Program[], AppError>> {
  return inReadTx(deps, ctx, async (tx) => ok(await cur.listPrograms(tx, { ...filter, institutionId: filter.institutionId ?? ctx.institutionId ?? null })));
}

export async function getProgram(deps: AcademicDeps, ctx: RequestContext, id: string): Promise<Result<Program, AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const p = await cur.getProgram(tx, id);
    return p && inScope(ctx, p) ? ok(p) : err(notFound(AcademicCode.PROGRAM_NOT_FOUND, "Programme", id));
  });
}

export async function createProgram(deps: AcademicDeps, ctx: RequestContext, input: AcademicCreateProgramBody): Promise<Result<Program, AppError>> {
  const scope = assertInstitutionScope(ctx, input.institutionId);
  if (!scope.ok) return scope;
  const info = await deps.ports.institutions.getInstitution(ctx, input.institutionId);
  if (!info) return err(notFound(AcademicCode.INSTITUTION_NOT_FOUND, "Établissement", input.institutionId));
  return inTx(deps, ctx, async (tx) => {
    if (!(await ref.getEducationLevel(tx, input.educationLevelId))) return err(notFound(AcademicCode.EDUCATION_LEVEL_NOT_FOUND, "Cycle", input.educationLevelId));
    if (input.parentProgramId) {
      const parent = await cur.getProgram(tx, input.parentProgramId);
      if (!parent) return err(notFound(AcademicCode.PROGRAM_NOT_FOUND, "Programme parent", input.parentProgramId));
      if (parent.institutionId !== input.institutionId) return err(validation(AcademicCode.PROGRAM_PARENT_OTHER_INSTITUTION, "Le programme parent est d'un autre établissement.", "parentProgramId"));
      if (parent.parentProgramId) return err(validation(AcademicCode.PROGRAM_TOO_DEEP, "Deux niveaux de programmes au plus (série > spécialité).", "parentProgramId"));
    }
    const id = deps.newId();
    await cur.insertProgram(tx, {
      id,
      institutionId: input.institutionId,
      educationLevelId: input.educationLevelId,
      parentProgramId: input.parentProgramId ?? null,
      code: input.code,
      label: input.label,
      kindCode: input.kindCode ?? "PROGRAM",
      domainCode: input.domainCode ?? null,
      description: input.description ?? null,
      durationMonths: input.durationMonths ?? null,
      attributes: input.attributes ?? {},
    });
    if (input.gradeLevelIds && input.gradeLevelIds.length > 0) {
      const levels = await checkGradeLevels(tx, input.gradeLevelIds);
      if (!levels.ok) return levels;
      await cur.replaceProgramGradeLevels(tx, id, input.gradeLevelIds);
    }
    return ok((await cur.getProgram(tx, id)) as Program);
  });
}

async function checkGradeLevels(tx: Tx, ids: readonly string[]): Promise<Result<void, AppError>> {
  if (new Set(ids).size !== ids.length) return err(validation(AcademicCode.INVALID_INPUT, "Niveau en double.", "gradeLevelIds"));
  const known = new Set((await ref.listGradeLevels(tx)).map((g) => g.id));
  const unknown = ids.find((id) => !known.has(id));
  return unknown ? err(notFound(AcademicCode.GRADE_LEVEL_NOT_FOUND, "Niveau", unknown)) : ok(undefined);
}

export async function updateProgram(
  deps: AcademicDeps,
  ctx: RequestContext,
  id: string,
  patch: { label?: string | undefined; kindCode?: string | undefined; domainCode?: string | null | undefined; description?: string | null | undefined; durationMonths?: number | null | undefined; attributes?: Record<string, unknown> | undefined; status?: "ACTIVE" | "ARCHIVED" | undefined },
): Promise<Result<Program, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const program = await cur.getProgram(tx, id);
    if (!program || !inScope(ctx, program)) return err(notFound(AcademicCode.PROGRAM_NOT_FOUND, "Programme", id));
    const clean: Parameters<typeof cur.updateProgram>[2] = {};
    if (patch.label !== undefined) clean.label = patch.label;
    if (patch.kindCode !== undefined) clean.kindCode = patch.kindCode;
    if (patch.domainCode !== undefined) clean.domainCode = patch.domainCode;
    if (patch.description !== undefined) clean.description = patch.description;
    if (patch.durationMonths !== undefined) clean.durationMonths = patch.durationMonths;
    if (patch.attributes !== undefined) clean.attributes = patch.attributes;
    if (patch.status !== undefined) clean.status = patch.status;
    await cur.updateProgram(tx, id, clean);
    return ok((await cur.getProgram(tx, id)) as Program);
  });
}

/** Remplace les niveaux couverts ; retirer un niveau déjà utilisé (classe, nœud `LEVEL`) est refusé. */
export async function setProgramGradeLevels(deps: AcademicDeps, ctx: RequestContext, id: string, gradeLevelIds: readonly string[]): Promise<Result<Program, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const program = await cur.getProgram(tx, id);
    if (!program || !inScope(ctx, program)) return err(notFound(AcademicCode.PROGRAM_NOT_FOUND, "Programme", id));
    const checked = await checkGradeLevels(tx, gradeLevelIds);
    if (!checked.ok) return checked;
    const removed = program.gradeLevelIds.filter((g) => !gradeLevelIds.includes(g));
    for (const g of removed) {
      if (await cur.gradeLevelInUseByProgram(tx, id, g)) {
        return err(conflict("academic.grade_level_in_use", "Un niveau retiré est utilisé par une classe ou un curriculum du programme.", { gradeLevelId: g }));
      }
    }
    await cur.replaceProgramGradeLevels(tx, id, gradeLevelIds);
    return ok((await cur.getProgram(tx, id)) as Program);
  });
}

// ---------------------------------------------------------------------------
// Matières
// ---------------------------------------------------------------------------

export async function listSubjects(deps: AcademicDeps, ctx: RequestContext, filter: { institutionId?: string | null; status?: string | null; search?: string | null } = {}): Promise<Result<Subject[], AppError>> {
  return inReadTx(deps, ctx, async (tx) => ok(await cur.listSubjects(tx, { ...filter, institutionId: filter.institutionId ?? ctx.institutionId ?? null })));
}

export async function getSubject(deps: AcademicDeps, ctx: RequestContext, id: string): Promise<Result<Subject, AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const s = await cur.getSubject(tx, id);
    return s && (!s.institutionId || inScope(ctx, { institutionId: s.institutionId })) ? ok(s) : err(notFound(AcademicCode.SUBJECT_NOT_FOUND, "Matière", id));
  });
}

export async function createSubject(deps: AcademicDeps, ctx: RequestContext, input: AcademicCreateSubjectBody): Promise<Result<Subject, AppError>> {
  if (input.institutionId) {
    const scope = assertInstitutionScope(ctx, input.institutionId);
    if (!scope.ok) return scope;
  }
  return inTx(deps, ctx, async (tx) => {
    const id = deps.newId();
    await cur.insertSubject(tx, {
      id,
      institutionId: input.institutionId ?? null,
      code: input.code,
      label: input.label,
      shortLabel: input.shortLabel ?? null,
      domainCode: input.domainCode ?? null,
      description: input.description ?? null,
      attributes: input.attributes ?? {},
    });
    return ok((await cur.getSubject(tx, id)) as Subject);
  });
}

export async function updateSubject(
  deps: AcademicDeps,
  ctx: RequestContext,
  id: string,
  patch: { label?: string | undefined; shortLabel?: string | null | undefined; domainCode?: string | null | undefined; description?: string | null | undefined; attributes?: Record<string, unknown> | undefined; status?: "ACTIVE" | "INACTIVE" | undefined },
): Promise<Result<Subject, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const s = await cur.getSubject(tx, id);
    if (!s || (s.institutionId && !inScope(ctx, { institutionId: s.institutionId }))) return err(notFound(AcademicCode.SUBJECT_NOT_FOUND, "Matière", id));
    const clean: Parameters<typeof cur.updateSubject>[2] = {};
    if (patch.label !== undefined) clean.label = patch.label;
    if (patch.shortLabel !== undefined) clean.shortLabel = patch.shortLabel;
    if (patch.domainCode !== undefined) clean.domainCode = patch.domainCode;
    if (patch.description !== undefined) clean.description = patch.description;
    if (patch.attributes !== undefined) clean.attributes = patch.attributes;
    if (patch.status !== undefined) clean.status = patch.status;
    await cur.updateSubject(tx, id, clean);
    return ok((await cur.getSubject(tx, id)) as Subject);
  });
}

/** AC2.6 : refusé tant qu'un nœud de curriculum référence la matière (clé étrangère composite). */
export async function deleteSubject(deps: AcademicDeps, ctx: RequestContext, id: string): Promise<Result<void, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const s = await cur.getSubject(tx, id);
    if (!s || (s.institutionId && !inScope(ctx, { institutionId: s.institutionId }))) return err(notFound(AcademicCode.SUBJECT_NOT_FOUND, "Matière", id));
    await cur.deleteSubject(tx, id);
    return ok(undefined);
  });
}
