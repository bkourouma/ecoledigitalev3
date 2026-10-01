/** Use cases « établissements » : lecture, création (avec campus par défaut du modèle de pack), modification. */
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type AppError,
  type RequestContext,
  type Result,
} from "@ecoledigitale/kernel";
import { isUniqueViolation } from "@ecoledigitale/database";
import {
  CreateInstitutionSchema,
  UpdateInstitutionSchema,
  type EntityStatus,
} from "@ecoledigitale/contracts/src/v2/tenancy";
import type { CampusRecord, InstitutionRecord } from "../domain/entities";
import { institutionCreatedEvent } from "../domain/events";
import { deriveCode, uniqueCode } from "../domain/provisioning";
import { insertCampus } from "../infrastructure/campuses-repository";
import { findCountry } from "../infrastructure/countries-repository";
import { publishEvents } from "../infrastructure/events";
import {
  getInstitution as getInstitutionRow,
  insertInstitution,
  listInstitutionCodes,
  listInstitutions as listInstitutionRows,
  updateInstitution as updateInstitutionRow,
} from "../infrastructure/institutions-repository";
import { getProfile } from "../infrastructure/profile-repository";
import { parseWith, resolveDeps, runResult, type TenancyDeps } from "./support";

export async function listInstitutions(
  deps: TenancyDeps,
  ctx: RequestContext,
  filter: { status?: EntityStatus } = {},
): Promise<Result<InstitutionRecord[], AppError>> {
  const d = resolveDeps(deps);
  return runResult(d.db, ctx, (tx) => listInstitutionRows(tx, filter), { readOnly: true });
}

export async function getInstitution(
  deps: TenancyDeps,
  ctx: RequestContext,
  id: string,
): Promise<Result<InstitutionRecord, AppError>> {
  const d = resolveDeps(deps);
  return runResult(
    d.db,
    ctx,
    async (tx) => {
      const row = await getInstitutionRow(tx, id);
      if (!row) throw NotFoundError.of("Établissement", id, { code: "tenancy.institution_not_found" });
      return row;
    },
    { readOnly: true },
  );
}

export async function createInstitution(
  deps: TenancyDeps,
  ctx: RequestContext,
  rawInput: unknown,
): Promise<Result<{ institution: InstitutionRecord; defaultCampus: CampusRecord }, AppError>> {
  const d = resolveDeps(deps);
  const parsed = parseWith(CreateInstitutionSchema, rawInput);
  if (!parsed.ok) return parsed;
  const input = parsed.value;

  return runResult(d.db, ctx, async (tx) => {
    const profile = await getProfile(tx, ctx.tenantId);
    if (!profile) {
      throw NotFoundError.of("Profil de l'organisation", ctx.tenantId, { code: "tenancy.profile_not_found" });
    }

    const countryCode = input.countryCode ?? profile.countryCode;
    const country = await findCountry(tx, countryCode);
    if (!country) {
      throw ValidationError.field("countryCode", `Pays inconnu : « ${countryCode} ».`, "tenancy.country_unknown");
    }

    const template = d.templates.get(input.pack);
    if (!template) {
      throw ValidationError.field("pack", `Aucun modèle pour le pack « ${input.pack} ».`, "tenancy.pack_template_missing");
    }

    const taken = await listInstitutionCodes(tx);
    let code: string;
    if (input.code) {
      if (taken.has(input.code)) {
        throw new ConflictError(`Le code d'établissement « ${input.code} » est déjà utilisé.`, {
          code: "tenancy.institution_code_taken",
        });
      }
      code = input.code;
    } else {
      code = uniqueCode(deriveCode(template.institution.code, "institution"), taken);
    }

    const now = d.clock.now();
    const id = d.newId();
    let institution: InstitutionRecord;
    try {
      institution = await insertInstitution(
        tx,
        {
          id,
          tenantId: ctx.tenantId,
          code,
          name: input.name,
          pack: input.pack,
          educationSystem: input.educationSystem ?? country.educationSystem,
          countryCode: country.code,
        },
        now,
      );
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictError(`Le code d'établissement « ${code} » est déjà utilisé.`, {
          code: "tenancy.institution_code_taken",
        });
      }
      throw e;
    }

    const defaultCampus = await insertCampus(
      tx,
      {
        id: d.newId(),
        tenantId: ctx.tenantId,
        institutionId: institution.id,
        code: template.defaultCampus.code,
        name: template.defaultCampus.name,
        isDefault: true,
      },
      now,
    );

    await publishEvents(tx, [
      institutionCreatedEvent(
        { ctx, clock: d.clock },
        {
          institutionId: institution.id,
          code: institution.code,
          name: institution.name,
          pack: institution.pack,
          countryCode: institution.countryCode,
          educationSystem: institution.educationSystem,
          defaultCampusId: defaultCampus.id,
        },
      ),
    ]);
    await d.audit?.record(tx, {
      action: "tenancy.institution.create",
      entity: "institution",
      entityId: institution.id,
      after: { code: institution.code, pack: institution.pack },
    });

    return { institution, defaultCampus };
  });
}

export async function updateInstitution(
  deps: TenancyDeps,
  ctx: RequestContext,
  id: string,
  rawInput: unknown,
): Promise<Result<InstitutionRecord, AppError>> {
  const d = resolveDeps(deps);
  const parsed = parseWith(UpdateInstitutionSchema, rawInput);
  if (!parsed.ok) return parsed;
  const patch = parsed.value;

  return runResult(d.db, ctx, async (tx) => {
    const before = await getInstitutionRow(tx, id);
    if (!before) throw NotFoundError.of("Établissement", id, { code: "tenancy.institution_not_found" });

    // Garde-fou : un tenant garde toujours au moins un établissement actif.
    if (patch.status && patch.status !== "ACTIVE" && before.status === "ACTIVE") {
      const active = (await listInstitutionRows(tx, { status: "ACTIVE" })).filter((i) => i.id !== id);
      if (active.length === 0) {
        throw new ConflictError("Impossible de désactiver le dernier établissement actif de l'organisation.", {
          code: "tenancy.last_active_institution",
        });
      }
    }

    const after = await updateInstitutionRow(tx, id, patch, d.clock.now());
    if (!after) throw NotFoundError.of("Établissement", id, { code: "tenancy.institution_not_found" });

    await d.audit?.record(tx, {
      action: "tenancy.institution.update",
      entity: "institution",
      entityId: id,
      before: { name: before.name, status: before.status, educationSystem: before.educationSystem },
      after: { name: after.name, status: after.status, educationSystem: after.educationSystem },
    });
    return after;
  });
}
