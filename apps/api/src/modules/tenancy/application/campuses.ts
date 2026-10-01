/** Use cases « campus ». Un établissement a toujours exactement un campus par défaut. */
import {
  ConflictError,
  NotFoundError,
  type AppError,
  type RequestContext,
  type Result,
} from "@ecoledigitale/kernel";
import { isUniqueViolation } from "@ecoledigitale/database";
import { CreateCampusSchema, UpdateCampusSchema } from "@ecoledigitale/contracts/src/v2/tenancy";
import type { CampusRecord } from "../domain/entities";
import { deriveCode, uniqueCode } from "../domain/provisioning";
import {
  clearDefaultCampus,
  deleteCampus as deleteCampusRow,
  getCampus as getCampusRow,
  insertCampus,
  listCampusCodes,
  listCampuses as listCampusRows,
  setDefaultCampus,
  updateCampus as updateCampusRow,
} from "../infrastructure/campuses-repository";
import { getInstitution } from "../infrastructure/institutions-repository";
import { parseWith, resolveDeps, runResult, type TenancyDeps } from "./support";

const institutionNotFound = (id: string) =>
  NotFoundError.of("Établissement", id, { code: "tenancy.institution_not_found" });
const campusNotFound = (id: string) => NotFoundError.of("Campus", id, { code: "tenancy.campus_not_found" });

export async function listCampuses(
  deps: TenancyDeps,
  ctx: RequestContext,
  institutionId: string,
): Promise<Result<CampusRecord[], AppError>> {
  const d = resolveDeps(deps);
  return runResult(
    d.db,
    ctx,
    async (tx) => {
      if (!(await getInstitution(tx, institutionId))) throw institutionNotFound(institutionId);
      return listCampusRows(tx, institutionId);
    },
    { readOnly: true },
  );
}

export async function createCampus(
  deps: TenancyDeps,
  ctx: RequestContext,
  institutionId: string,
  rawInput: unknown,
): Promise<Result<CampusRecord, AppError>> {
  const d = resolveDeps(deps);
  const parsed = parseWith(CreateCampusSchema, rawInput);
  if (!parsed.ok) return parsed;
  const input = parsed.value;

  return runResult(d.db, ctx, async (tx) => {
    const institution = await getInstitution(tx, institutionId);
    if (!institution) throw institutionNotFound(institutionId);
    if (institution.status === "ARCHIVED") {
      throw new ConflictError("Cet établissement est archivé : on ne peut plus y ajouter de campus.", {
        code: "tenancy.institution_archived",
      });
    }

    const taken = await listCampusCodes(tx, institutionId);
    if (input.code && taken.has(input.code)) {
      throw new ConflictError(`Le code de campus « ${input.code} » est déjà utilisé.`, { code: "tenancy.campus_code_taken" });
    }
    const code = input.code ?? uniqueCode(deriveCode(input.name, "campus"), taken);

    let campus: CampusRecord;
    try {
      campus = await insertCampus(
        tx,
        {
          id: d.newId(),
          tenantId: ctx.tenantId,
          institutionId,
          code,
          name: input.name,
          address: input.address ?? null,
          city: input.city ?? null,
          phone: input.phone ?? null,
          // Un établissement sans campus (cas limite) reçoit le sien comme campus par défaut.
          isDefault: taken.size === 0,
        },
        d.clock.now(),
      );
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictError(`Le code de campus « ${code} » est déjà utilisé.`, { code: "tenancy.campus_code_taken" });
      }
      throw e;
    }

    await d.audit?.record(tx, {
      action: "tenancy.campus.create",
      entity: "campus",
      entityId: campus.id,
      after: { institutionId, code: campus.code },
    });
    return campus;
  });
}

export async function updateCampus(
  deps: TenancyDeps,
  ctx: RequestContext,
  campusId: string,
  rawInput: unknown,
): Promise<Result<CampusRecord, AppError>> {
  const d = resolveDeps(deps);
  const parsed = parseWith(UpdateCampusSchema, rawInput);
  if (!parsed.ok) return parsed;
  const { isDefault, ...patch } = parsed.value;

  return runResult(d.db, ctx, async (tx) => {
    const before = await getCampusRow(tx, campusId);
    if (!before) throw campusNotFound(campusId);

    if (patch.status && patch.status !== "ACTIVE" && before.isDefault && !isDefault) {
      throw new ConflictError("Le campus par défaut ne peut pas être désactivé : désignez d'abord un autre campus par défaut.", {
        code: "tenancy.campus_default_protected",
      });
    }

    const now = d.clock.now();
    let current: CampusRecord | null = before;
    if (isDefault && !before.isDefault) {
      await clearDefaultCampus(tx, before.institutionId, now);
      current = await setDefaultCampus(tx, campusId, now);
    }
    if (Object.keys(patch).length > 0) {
      current = await updateCampusRow(tx, campusId, patch, now);
    }
    if (!current) throw campusNotFound(campusId);

    await d.audit?.record(tx, {
      action: "tenancy.campus.update",
      entity: "campus",
      entityId: campusId,
      before: { name: before.name, status: before.status, isDefault: before.isDefault },
      after: { name: current.name, status: current.status, isDefault: current.isDefault },
    });
    return current;
  });
}

export async function deleteCampus(
  deps: TenancyDeps,
  ctx: RequestContext,
  campusId: string,
): Promise<Result<{ id: string }, AppError>> {
  const d = resolveDeps(deps);
  return runResult(d.db, ctx, async (tx) => {
    const campus = await getCampusRow(tx, campusId);
    if (!campus) throw campusNotFound(campusId);
    if (campus.isDefault) {
      throw new ConflictError("Le campus par défaut ne peut pas être supprimé : désignez d'abord un autre campus par défaut.", {
        code: "tenancy.campus_default_protected",
      });
    }
    await deleteCampusRow(tx, campusId);
    await d.audit?.record(tx, {
      action: "tenancy.campus.delete",
      entity: "campus",
      entityId: campusId,
      before: { institutionId: campus.institutionId, code: campus.code },
    });
    return { id: campusId };
  });
}
