/**
 * Paramètres du module et référentiels (types de liens, catégories de personnel, types de contrat) — `people.settings.manage`.
 * Ce sont des DONNÉES du tenant (libellés, motifs de numéros, préavis d'alerte, délai de conservation) : aucune valeur
 * réglementaire n'est codée dans le module.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type {
  PeopleContractTypeDto,
  PeopleRelationshipTypeDto,
  PeopleSettingsDto,
  PeopleSettingsPatch,
  PeopleStaffCategoryDto,
} from "@ecoledigitale/contracts/src/v2/people";
import { PeopleErrors } from "../domain/errors";
import { validatePattern } from "../domain/number-pattern";
import * as repo from "../infrastructure/reference-repo";
import { EventBuffer, inTx, type PeopleDeps } from "./deps";

const settingsView = (s: repo.SettingsRow): PeopleSettingsDto => ({ ...s });

export async function getSettings(deps: PeopleDeps, ctx: RequestContext): Promise<Result<PeopleSettingsDto, AppError>> {
  // Premier usage : instanciation (idempotente) des paramètres et référentiels par défaut du tenant.
  return inTx(deps, ctx, async (tx) => ok(settingsView(await repo.ensureTenantDefaults(tx, ctx.tenantId, deps.newId, deps.clock.now()))));
}

export async function updateSettings(deps: PeopleDeps, ctx: RequestContext, patch: PeopleSettingsPatch): Promise<Result<PeopleSettingsDto, AppError>> {
  for (const pattern of [patch.studentNumberPattern, patch.staffNumberPattern]) {
    if (pattern !== undefined) {
      const problem = validatePattern(pattern);
      if (problem) return err(problem);
    }
  }
  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const before = await repo.ensureTenantDefaults(tx, ctx.tenantId, deps.newId, now);
    await repo.updateSettings(tx, ctx.tenantId, patch, now);
    const after = (await repo.getSettings(tx, ctx.tenantId)) as repo.SettingsRow;
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "people.settings.updated", entity: "settings", entityId: ctx.tenantId, severity: "notice", before, after, metadata: { fields: Object.keys(patch).sort() } });
    await buffer.flush(tx);
    return ok(settingsView(after));
  });
}

/** Instancie (idempotent) les paramètres et référentiels par défaut : appelé à `tenancy.tenant.provisioned`. */
export async function instantiatePeopleReferenceData(deps: PeopleDeps, ctx: RequestContext): Promise<Result<{ created: boolean }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const existed = (await repo.getSettings(tx, ctx.tenantId)) !== null;
    await repo.ensureTenantDefaults(tx, ctx.tenantId, deps.newId, deps.clock.now());
    return ok({ created: !existed });
  });
}

// --- types de liens -----------------------------------------------------------------------------------------------

export async function listRelationshipTypes(deps: PeopleDeps, ctx: RequestContext): Promise<Result<PeopleRelationshipTypeDto[], AppError>> {
  return inTx(deps, ctx, async (tx) => {
    await repo.ensureTenantDefaults(tx, ctx.tenantId, deps.newId, deps.clock.now());
    return ok(await repo.listRelationshipTypes(tx, ctx.tenantId));
  });
}

export async function upsertRelationshipType(deps: PeopleDeps, ctx: RequestContext, input: { code: string; label: string; kind: "GUARDIAN" | "EMERGENCY" | "OTHER"; sortOrder?: number | undefined; active?: boolean | undefined }): Promise<Result<PeopleRelationshipTypeDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    await repo.ensureTenantDefaults(tx, ctx.tenantId, deps.newId, now);
    const existing = await repo.getRelationshipType(tx, ctx.tenantId, input.code);
    // Un type utilisé par des liens VIVANTS ne change pas de nature : il rendrait l'accès des portails incohérent.
    if (existing && existing.kind !== input.kind) {
      const used = await tx.queryOne<{ n: string }>(`SELECT count(*) AS n FROM people.student_guardians WHERE tenant_id = $1 AND relationship_code = $2 AND valid_to IS NULL`, [ctx.tenantId, input.code]);
      if (Number(used?.n ?? 0) > 0) return err(PeopleErrors.referenceInUse("Ce type de lien est utilisé par des liens vivants : sa nature ne peut pas changer."));
    }
    const row = await repo.upsertRelationshipType(tx, ctx.tenantId, deps.newId(), input, now);
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "people.relationship_type.upserted", entity: "relationship_type", entityId: row.id, metadata: { code: row.code } });
    await buffer.flush(tx);
    return ok(row);
  });
}

// --- catégories de personnel --------------------------------------------------------------------------------------

export async function listStaffCategories(deps: PeopleDeps, ctx: RequestContext): Promise<Result<PeopleStaffCategoryDto[], AppError>> {
  return inTx(deps, ctx, async (tx) => {
    await repo.ensureTenantDefaults(tx, ctx.tenantId, deps.newId, deps.clock.now());
    return ok(await repo.listStaffCategories(tx, ctx.tenantId));
  });
}

export async function upsertStaffCategory(
  deps: PeopleDeps,
  ctx: RequestContext,
  input: { code: string; label: string; canTeach?: boolean | undefined; canSupervise?: boolean | undefined; sortOrder?: number | undefined; active?: boolean | undefined },
): Promise<Result<PeopleStaffCategoryDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    await repo.ensureTenantDefaults(tx, ctx.tenantId, deps.newId, now);
    const existing = await repo.getStaffCategory(tx, ctx.tenantId, input.code);
    // On ne retire pas `can_teach` d'une catégorie qui a des affectations actives (spec 009 data-model §7).
    if (existing?.canTeach && input.canTeach === false) {
      if ((await repo.countActiveTeachingAssignmentsOfCategory(tx, ctx.tenantId, input.code)) > 0) {
        return err(PeopleErrors.referenceInUse("Cette catégorie a des affectations d'enseignement actives : elle ne peut pas perdre le droit d'enseigner."));
      }
    }
    const row = await repo.upsertStaffCategory(tx, ctx.tenantId, deps.newId(), input, now);
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "people.staff_category.upserted", entity: "staff_category", entityId: row.id, metadata: { code: row.code } });
    await buffer.flush(tx);
    return ok(row);
  });
}

// --- types de contrat ---------------------------------------------------------------------------------------------

export async function listContractTypes(deps: PeopleDeps, ctx: RequestContext): Promise<Result<PeopleContractTypeDto[], AppError>> {
  return inTx(deps, ctx, async (tx) => {
    await repo.ensureTenantDefaults(tx, ctx.tenantId, deps.newId, deps.clock.now());
    return ok(await repo.listContractTypes(tx, ctx.tenantId));
  });
}

export async function upsertContractType(deps: PeopleDeps, ctx: RequestContext, input: { code: string; label: string; kind: "PERMANENT" | "FIXED_TERM" | "CASUAL" | "OTHER"; active?: boolean | undefined }): Promise<Result<PeopleContractTypeDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    await repo.ensureTenantDefaults(tx, ctx.tenantId, deps.newId, now);
    const row = await repo.upsertContractType(tx, ctx.tenantId, deps.newId(), input, now);
    const buffer = new EventBuffer(deps, ctx);
    buffer.audit({ action: "people.contract_type.upserted", entity: "contract_type", entityId: row.id, metadata: { code: row.code } });
    await buffer.flush(tx);
    return ok(row);
  });
}
