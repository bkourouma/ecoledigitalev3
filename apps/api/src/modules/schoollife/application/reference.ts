/**
 * Paramètres d'établissement : réglages, niveaux de gravité, types d'événements. Tout est DONNÉE (vide par défaut) : aucun
 * catalogue de fautes ni valeur réglementaire n'est livré par le code. Les modifications sont des actes sensibles et audités.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type {
  SchoolLifeEventTypeDto,
  SchoolLifeEventTypeInput,
  SchoolLifeReferenceDto,
  SchoolLifeSettingsDto,
  SchoolLifeSettingsInput,
  SchoolLifeSeverityDto,
  SchoolLifeSeverityInput,
} from "@ecoledigitale/contracts/src/v2/schoollife";
import { validateTypeFlags } from "../domain/event-type";
import { invalid, SchoolLifeCode } from "../domain/errors";
import * as repo from "../infrastructure/reference-repository";
import { EventBuffer, inTx, requireHuman, type SchoolLifeDeps } from "./deps";
import { eventTypeDto, settingsDto, severityDto } from "./views";

export async function getReference(deps: SchoolLifeDeps, ctx: RequestContext): Promise<Result<SchoolLifeReferenceDto, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => ok({ settings: (await repo.listSettings(tx)).map(settingsDto), severityLevels: (await repo.listSeverities(tx)).map(severityDto), eventTypes: (await repo.listEventTypes(tx)).map(eventTypeDto) }),
    { readOnly: true },
  );
}

export async function upsertSettings(deps: SchoolLifeDeps, ctx: RequestContext, input: SchoolLifeSettingsInput): Promise<Result<SchoolLifeSettingsDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const before = await repo.getSettings(tx, input.institutionId);
    const row = await repo.upsertSettings(tx, ctx.tenantId, input.institutionId, {
      conductPointsEnabled: input.conductPointsEnabled,
      confidentialReadRequiresPurpose: input.confidentialReadRequiresPurpose,
      retentionDays: input.retentionDays,
      convocationReminderHours: input.convocationReminderHours,
      exclusionBoundaryNotices: input.exclusionBoundaryNotices,
    });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "schoollife.settings.updated", resourceType: "settings", resourceId: input.institutionId, sensitive: true, before: before ?? null, after: row });
    await events.flush(tx);
    return ok(settingsDto(row));
  });
}

export async function upsertSeverity(deps: SchoolLifeDeps, ctx: RequestContext, input: SchoolLifeSeverityInput): Promise<Result<SchoolLifeSeverityDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const before = await repo.getSeverityByCode(tx, input.code);
    const row = await repo.upsertSeverity(tx, ctx.tenantId, deps.newId(), input);
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "schoollife.severity.upserted", resourceType: "severity_level", resourceId: row.id, sensitive: true, before: before ?? null, after: row });
    await events.flush(tx);
    return ok(severityDto(row));
  });
}

export async function upsertEventType(deps: SchoolLifeDeps, ctx: RequestContext, input: SchoolLifeEventTypeInput): Promise<Result<SchoolLifeEventTypeDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  const values: repo.EventTypeValues = {
    code: input.code,
    label: input.label,
    kind: input.kind,
    defaultSeverityCode: input.defaultSeverityCode ?? null,
    requiresValidation: input.requiresValidation,
    requiresFourEyes: input.requiresFourEyes,
    approverPermission: input.approverPermission ?? null,
    notifyGuardians: input.notifyGuardians,
    visibleToGuardians: input.visibleToGuardians,
    confidentialityDefault: input.confidentialityDefault,
    requiresDates: input.requiresDates ?? input.kind === "TEMP_EXCLUSION",
    appealable: input.appealable,
    isPlaceholder: input.isPlaceholder,
    sortOrder: input.sortOrder,
    active: input.active,
  };
  const issues = validateTypeFlags(values);
  if (issues.length > 0) {
    const first = issues[0]!;
    return err(invalid(SchoolLifeCode.INVALID_INPUT, first.message, first.field));
  }
  return inTx(deps, ctx, async (tx) => {
    const before = await repo.getEventTypeByCode(tx, input.code);
    if (values.defaultSeverityCode && !(await repo.getSeverityByCode(tx, values.defaultSeverityCode))) {
      return err(invalid(SchoolLifeCode.INVALID_REFERENCE, "Ce niveau de gravité par défaut n'existe pas.", "defaultSeverityCode"));
    }
    const row = await repo.upsertEventType(tx, ctx.tenantId, deps.newId(), values);
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "schoollife.event_type.upserted", resourceType: "event_type", resourceId: row.id, sensitive: true, before: before ?? null, after: row });
    await events.flush(tx);
    return ok(eventTypeDto(row));
  });
}
