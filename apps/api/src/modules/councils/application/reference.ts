/**
 * Référentiels d'établissement : rôles de participants, types de conseil, types de décision, réglages. Tout est DONNÉE (vide par
 * défaut, ou fournie par le modèle de pack marqué `placeholder`) : aucun quorum, rôle exigé ou signataire officiel n'est livré par le
 * code. Les modifications sont des actes sensibles et audités.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type {
  CouncilsCouncilTypeDto,
  CouncilsCouncilTypeInput,
  CouncilsDecisionTypeDto,
  CouncilsDecisionTypeInput,
  CouncilsParticipantRoleDto,
  CouncilsParticipantRoleInput,
  CouncilsReferenceDto,
  CouncilsSettingsDto,
  CouncilsSettingsInput,
} from "@ecoledigitale/contracts/src/v2/councils";
import { normalizeDecisionType, validateDecisionTypeShape } from "../domain/decision-type";
import { CouncilsCode, conflict, invalid } from "../domain/errors";
import * as repo from "../infrastructure/reference-repository";
import { EventBuffer, inTx, requireHuman, safely, type CouncilsDeps } from "./deps";
import { councilTypeDto, decisionTypeDto, roleDto, settingsDto } from "./views";

export async function getReference(deps: CouncilsDeps, ctx: RequestContext): Promise<Result<CouncilsReferenceDto, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) =>
      ok({
        roles: (await repo.listRoles(tx)).map(roleDto),
        councilTypes: (await repo.listCouncilTypes(tx)).map(councilTypeDto),
        decisionTypes: (await repo.listDecisionTypes(tx)).map(decisionTypeDto),
        settings: (await repo.listSettings(tx)).map(settingsDto),
      }),
    { readOnly: true },
  );
}

export async function upsertRole(deps: CouncilsDeps, ctx: RequestContext, input: CouncilsParticipantRoleInput): Promise<Result<CouncilsParticipantRoleDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const before = await repo.getRoleByCode(tx, input.code);
    const row = await repo.upsertRole(tx, ctx.tenantId, deps.newId(), input);
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "councils.participant_role.upserted", resourceType: "participant_role", resourceId: row.id, sensitive: true, before: before ?? null, after: row });
    await events.flush(tx);
    return ok(roleDto(row));
  });
}

export async function upsertCouncilType(deps: CouncilsDeps, ctx: RequestContext, input: CouncilsCouncilTypeInput): Promise<Result<CouncilsCouncilTypeDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const before = await repo.getCouncilTypeByCode(tx, input.code);
    if (before && before.scope !== input.scope) {
      // La portée d'un type utilisé ne change plus (la base impose l'égalité type/séance) : on crée un autre type.
      if ((await repo.countCouncilsOfType(tx, before.id)) > 0) return err(conflict(CouncilsCode.INVALID_STATE, "La portée d'un type de conseil déjà utilisé ne change plus : créez un autre type et désactivez celui-ci."));
    }
    const roles = new Map((await repo.listRoles(tx)).map((r) => [r.code, r]));
    const unknown = [...input.requiredRoleCodes, ...input.signerRoleCodes].filter((c) => !roles.has(c));
    if (unknown.length > 0) return err(invalid(CouncilsCode.INVALID_REFERENCE, `Rôle(s) de participant inconnu(s) : ${[...new Set(unknown)].join(", ")}.`, "requiredRoleCodes"));
    if (input.signerFunctions.length + input.signerRoleCodes.length < 1) return err(invalid(CouncilsCode.INVALID_INPUT, "Un procès-verbal exige au moins un signataire (fonction ou rôle).", "signerFunctions"));
    const row = await repo.upsertCouncilType(tx, ctx.tenantId, deps.newId(), { ...input });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "councils.council_type.upserted", resourceType: "council_type", resourceId: row.id, sensitive: true, before: before ?? null, after: row });
    await events.flush(tx);
    return ok(councilTypeDto(row));
  });
}

export async function upsertDecisionType(deps: CouncilsDeps, ctx: RequestContext, input: CouncilsDecisionTypeInput): Promise<Result<CouncilsDecisionTypeDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  const shape = normalizeDecisionType({
    ...input,
    requiresTarget: input.requiresTarget ?? false,
    needsHumanApplication: input.needsHumanApplication ?? false,
  });
  const issues = validateDecisionTypeShape(shape);
  if (issues.length > 0) {
    const first = issues[0]!;
    return err(invalid(CouncilsCode.INVALID_INPUT, first.message, first.field));
  }
  // Un code final de résultats doit être PERMIS par le contrat de règles : refusé à la configuration, avant le conseil (AC6.4).
  if (shape.resultsFinalCode !== null) {
    const allowed = await safely(async () => ok(await deps.ports.ruleCodes.allowedYearEndCodes(ctx)));
    if (!allowed.ok) return allowed;
    if (allowed.value !== null && !allowed.value.includes(shape.resultsFinalCode)) {
      return err(invalid(CouncilsCode.CODE_NOT_ALLOWED, `« ${shape.resultsFinalCode} » n'est pas un code permis par le contrat de règles (${allowed.value.join(", ")}).`, "resultsFinalCode"));
    }
  }
  return inTx(deps, ctx, async (tx) => {
    const before = await repo.getDecisionTypeByCode(tx, input.code);
    if (before && before.family !== shape.family) {
      if ((await repo.countDecisionsOfType(tx, before.id)) > 0) return err(conflict(CouncilsCode.INVALID_STATE, "La famille d'un type de décision déjà utilisé ne change plus : créez un autre type et désactivez celui-ci."));
    }
    const row = await repo.upsertDecisionType(tx, ctx.tenantId, deps.newId(), {
      code: shape.code,
      label: shape.label,
      family: shape.family,
      appliesTo: shape.appliesTo,
      exclusiveGroup: shape.exclusiveGroup,
      requiresJustification: shape.requiresJustification,
      requiresVote: shape.requiresVote,
      requiresTarget: shape.requiresTarget,
      resultsDecisionKind: shape.resultsDecisionKind,
      resultsFinalCode: shape.resultsFinalCode,
      academicOutcomeCode: shape.academicOutcomeCode,
      needsHumanApplication: shape.needsHumanApplication,
      studentStatus: shape.studentStatus,
      sortOrder: shape.sortOrder,
      active: shape.active,
    });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "councils.decision_type.upserted", resourceType: "decision_type", resourceId: row.id, sensitive: true, before: before ?? null, after: row });
    await events.flush(tx);
    return ok(decisionTypeDto(row));
  });
}

export async function upsertSettings(deps: CouncilsDeps, ctx: RequestContext, input: CouncilsSettingsInput): Promise<Result<CouncilsSettingsDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const before = await repo.getSettings(tx, input.institutionId);
    const row = await repo.upsertSettings(tx, ctx.tenantId, input.institutionId, {
      requireSeparateUnlocker: input.requireSeparateUnlocker,
      effectsTrigger: input.effectsTrigger,
      guardianVisibility: input.guardianVisibility,
      allowQuorumWaiver: input.allowQuorumWaiver,
      minutesTemplateKey: input.minutesTemplateKey,
    });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "councils.settings.updated", resourceType: "settings", resourceId: input.institutionId, sensitive: true, before: before ?? null, after: row });
    await events.flush(tx);
    return ok(settingsDto(row));
  });
}
