/**
 * Plugin Fastify du module scheduling — préfixe `/api/v1/scheduling` (appliqué par le registre).
 *
 *   export default async function (app, runtime)   // contrat d'assemblage `(app, runtime)`
 *   export async function schedulingPlugin(app, { deps, requirePermission, … })   // tests et câblages dédiés
 *
 * - Authentification : `request.ctx` (RequestContext) posé EN AMONT (iam / authentification historique).
 * - Autorisation : `requirePermission('schedule.…')` du module rbac. Les routes que plusieurs profils
 *   peuvent appeler (vues personnelles, déclaration d'une séance) essaient les permissions dans l'ordre et
 *   en déduisent l'accès (`ALL` / `OWN`), jamais un rôle codé en dur.
 * - Entitlements : `scheduling.equipment`, `scheduling.generation`.
 * - Les routes de paie (`lockHours`, `releaseHoursLock`) sont INTERNES (appel de module) : aucun endpoint.
 * - Route publique : `GET /export/timetable.ics` (jeton d'abonnement révocable, limité en lecture).
 * - Erreurs : `AppError` / Zod → `toErrorBody` ; jamais de message interne exposé.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { ZodError, type ZodTypeAny, type z } from "zod";
import {
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
  toAppError,
  toErrorBody,
  type RequestContext,
  type Result,
} from "@ecoledigitale/kernel";
import {
  schedulingAccountingBodySchema,
  schedulingCalendarEventBodySchema,
  schedulingCalendarEventPatchSchema,
  schedulingCancelBodySchema,
  schedulingChangeRoomBodySchema,
  schedulingCloneTimetableBodySchema,
  schedulingConflictPolicyBodySchema,
  schedulingCreateOccurrenceBodySchema,
  schedulingEntryBatchBodySchema,
  schedulingEntryBodySchema,
  schedulingEntryParamsSchema,
  schedulingEquipmentBodySchema,
  schedulingEquipmentPatchSchema,
  schedulingEventKindBodySchema,
  schedulingGenerateBodySchema,
  schedulingHoldBodySchema,
  schedulingIcsDownloadQuerySchema,
  schedulingIcsQuerySchema,
  schedulingIcsTokenBodySchema,
  schedulingIcsTokensQuerySchema,
  schedulingIdParamsSchema,
  schedulingInstitutionQuerySchema,
  schedulingListCalendarEventsQuerySchema,
  schedulingListEquipmentQuerySchema,
  schedulingListOccurrencesQuerySchema,
  schedulingListRoomsQuerySchema,
  schedulingListTimeSlotsQuerySchema,
  schedulingListTimetablesQuerySchema,
  schedulingMissingQuerySchema,
  schedulingOverrideBodySchema,
  schedulingPaidMinutesBodySchema,
  schedulingPendingQuerySchema,
  schedulingPreviewBodySchema,
  schedulingRangeQuerySchema,
  schedulingRescheduleBodySchema,
  schedulingRestoreBodySchema,
  schedulingRoomBodySchema,
  schedulingRoomOccupancyQuerySchema,
  schedulingRoomPatchSchema,
  schedulingRoomStatusBodySchema,
  schedulingRoomTypeBodySchema,
  schedulingSetStaffBodySchema,
  schedulingSettingsBodySchema,
  schedulingStaffLoadQuerySchema,
  schedulingStaffParamsSchema,
  schedulingStudentParamsSchema,
  schedulingSubstituteBodySchema,
  schedulingSuggestSlotsBodySchema,
  schedulingSuggestSubstitutesBodySchema,
  schedulingTimeSlotBodySchema,
  schedulingTimetableBodySchema,
  schedulingTimetablePatchSchema,
  schedulingUnholdBodySchema,
  schedulingUnvalidateBodySchema,
  schedulingUpdateOccurrenceBodySchema,
  schedulingValidateBatchBodySchema,
  schedulingWindowQuerySchema,
} from "@ecoledigitale/contracts/src/v2/scheduling";
import type { ModuleRuntime } from "../../../platform/runtime";
import { registryPorts } from "../ports-registry";
import { createSchedulingDeps, type SchedulingDeps } from "../application/deps";
import { previewConflicts, suggestSlots, suggestSubstitutes } from "../application/aids";
import * as occ from "../application/occurrences";
import * as ref from "../application/reference";
import * as tt from "../application/timetables";
import * as views from "../application/views";
import * as val from "../application/validation";
import { generateOccurrences, listExpectedWithoutOccurrence } from "../application/generation";
import { schedulingAuditAdapter } from "../infrastructure/audit-adapter";
import * as present from "./presenters";

export const SCHEDULING_ROUTES_PREFIX = "/api/v1/scheduling";
const EQUIPMENT_FEATURE = "scheduling.equipment";

export interface PluginRateLimiter {
  hit(key: string, rule: { limit: number; windowMs: number }): Promise<{ allowed: boolean; retryAfterMs: number }>;
}

export interface SchedulingPluginOptions {
  deps: SchedulingDeps;
  prefix?: string;
  /** Garde de permission (défaut : celle du module rbac injectée par le runtime). */
  requirePermission: (permission: string) => preHandlerAsyncHookHandler;
  /** Garde de route `requireFeature(key)` du module entitlements (403 `entitlements.feature_not_available`). */
  requireFeature?: (featureKey: string) => preHandlerAsyncHookHandler;
  /** Contexte de requête (défaut : `request.ctx`, 401 sinon). */
  resolveContext?: (request: FastifyRequest) => RequestContext;
  /** Limiteur de débit de la route publique d'abonnement (facultatif). */
  rateLimiter?: PluginRateLimiter;
  icsRateLimit?: { limit: number; windowMs: number };
}

function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  throw zodToValidation(result.error);
}

function zodToValidation(error: ZodError): ValidationError {
  return new ValidationError(
    "Données invalides.",
    error.issues.map((i) => ({ path: i.path, message: i.message, code: i.code })),
  );
}

function unwrapOrThrow<T>(result: Result<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

function maybeFastifyValidation(error: unknown): unknown {
  const e = error as { validation?: unknown; statusCode?: number; message?: string } | null;
  if (e && typeof e === "object" && e.validation) return new ValidationError("Requête invalide.");
  if (e && typeof e === "object" && typeof e.statusCode === "number" && e.statusCode === 400) return new ValidationError("Requête invalide.");
  return error;
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

type Grant = { permission: string };
const GRANT = Symbol("schedulingGrant");

export async function schedulingPlugin(app: FastifyInstance, options: SchedulingPluginOptions): Promise<void> {
  const { deps } = options;
  const perm = options.requirePermission;
  const ctxOf = (request: FastifyRequest): RequestContext => {
    if (options.resolveContext) return options.resolveContext(request);
    const ctx = (request as unknown as { ctx?: RequestContext }).ctx;
    if (!ctx) throw new UnauthorizedError();
    return ctx;
  };

  /** Teste une permission sans faire échouer la requête (le garde rbac LÈVE `ForbiddenError`). */
  const has = async (request: FastifyRequest, reply: FastifyReply, permission: string): Promise<boolean> => {
    try {
      await perm(permission).call(request.server, request, reply);
      return true;
    } catch (e) {
      if (e instanceof ForbiddenError) return false;
      throw e;
    }
  };

  /** Autorise si l'UNE des permissions est accordée ; mémorise laquelle (`grantOf`). */
  const anyOf = (...permissions: string[]): preHandlerAsyncHookHandler =>
    async function anyOfGuard(request, reply) {
      for (const p of permissions) {
        if (await has(request, reply, p)) {
          (request as unknown as Record<symbol, Grant>)[GRANT] = { permission: p };
          return;
        }
      }
      throw new ForbiddenError("Action non autorisée.", { details: { permission: permissions.join(" | ") } });
    };
  const grantOf = (request: FastifyRequest): string => ((request as unknown as Record<symbol, Grant | undefined>)[GRANT]?.permission ?? "");

  /** Permission PUIS fonctionnalité du plan (403 `entitlements.feature_not_available` avant lecture du corps). */
  const withFeature = (permissions: string | string[], feature: string): preHandlerAsyncHookHandler[] => {
    const list = Array.isArray(permissions) ? permissions : [permissions];
    const guards: preHandlerAsyncHookHandler[] = [list.length === 1 ? perm(list[0] as string) : anyOf(...list)];
    if (options.requireFeature) {
      const featureGuard = options.requireFeature(feature);
      guards.push(async function featureGate(request, reply) {
        return featureGuard.call(request.server, request, reply);
      });
    }
    return guards;
  };

  const handleError = (error: unknown, request: FastifyRequest, reply: FastifyReply): void => {
    const appError = error instanceof ZodError ? zodToValidation(error) : toAppError(maybeFastifyValidation(error));
    if (appError.httpStatus >= 500) request.log.error({ err: error }, "scheduling : erreur inattendue");
    void reply.status(appError.httpStatus).send(toErrorBody(appError, String(request.id)));
  };

  const requireOverridePermission = async (request: FastifyRequest, reply: FastifyReply, hasOverride: boolean): Promise<void> => {
    if (!hasOverride) return;
    if (!(await has(request, reply, "schedule.conflict.override"))) {
      throw new ForbiddenError("Le dépassement d'un conflit exige la permission « schedule.conflict.override ».", { details: { permission: "schedule.conflict.override" } });
    }
  };

  await app.register(
    async (scope) => {
      scope.setErrorHandler((error, request, reply) => handleError(error, request, reply));

      const page = <T>(p: { items: T[]; hasMore: boolean; total?: number }, map: (x: T) => unknown) => ({
        items: p.items.map(map),
        hasMore: p.hasMore,
        ...(p.total !== undefined ? { total: p.total } : {}),
      });
      const asOccurrenceList = (p: { items: Parameters<typeof present.occurrenceDto>[0][]; hasMore: boolean; total?: number }) => page(p, (o) => present.occurrenceDto(o));
      const occurrenceResult = (r: occ.OccurrenceResult) => ({ occurrence: present.occurrenceDto(r.occurrence), warnings: r.warnings });

      // ===== Types de salle, types d'événement, politiques, paramètres ===================================
      scope.get("/reference/room-types", { preHandler: perm("schedule.read") }, async (req) => ({ items: unwrapOrThrow(await ref.listRoomTypes(deps, ctxOf(req))) }));
      scope.put("/reference/room-types", { preHandler: perm("schedule.manage") }, async (req) => unwrapOrThrow(await ref.upsertRoomType(deps, ctxOf(req), parse(schedulingRoomTypeBodySchema, req.body))));
      scope.get("/reference/calendar-event-kinds", { preHandler: perm("schedule.read") }, async (req) => ({ items: unwrapOrThrow(await ref.listEventKinds(deps, ctxOf(req))) }));
      scope.put("/reference/calendar-event-kinds", { preHandler: perm("schedule.manage") }, async (req) => unwrapOrThrow(await ref.upsertEventKind(deps, ctxOf(req), parse(schedulingEventKindBodySchema, req.body))));
      scope.post("/reference/seed", { preHandler: perm("schedule.manage") }, async (req) => unwrapOrThrow(await ref.seedReference(deps, ctxOf(req))));
      scope.get("/reference/conflict-policies", { preHandler: perm("schedule.read") }, async (req) => {
        const q = parse(schedulingInstitutionQuerySchema, req.query);
        return unwrapOrThrow(await ref.getConflictPolicies(deps, ctxOf(req), q));
      });
      scope.put("/reference/conflict-policies", { preHandler: perm("schedule.manage") }, async (req) => unwrapOrThrow(await ref.upsertConflictPolicy(deps, ctxOf(req), parse(schedulingConflictPolicyBodySchema, req.body))));
      scope.get("/reference/settings", { preHandler: perm("schedule.read") }, async (req) => {
        const q = parse(schedulingInstitutionQuerySchema, req.query);
        return present.settingsDto(unwrapOrThrow(await ref.getSchedulingSettings(deps, ctxOf(req), q)));
      });
      scope.put("/reference/settings", { preHandler: perm("schedule.manage") }, async (req) => {
        const { institutionId, ...patch } = parse(schedulingSettingsBodySchema, req.body);
        return present.settingsDto(unwrapOrThrow(await ref.updateSchedulingSettings(deps, ctxOf(req), { institutionId, patch: stripUndefined(patch) as ref.SettingsPatch })));
      });

      // ===== Salles ==========================================================================================
      scope.get("/rooms", { preHandler: perm("schedule.read") }, async (req) => {
        const q = parse(schedulingListRoomsQuerySchema, req.query);
        const items = unwrapOrThrow(await ref.listRooms(deps, ctxOf(req), stripUndefined({ institutionId: q.institutionId, campusId: q.campusId, roomTypeCode: q.roomType, status: q.status, building: q.building })));
        return { items: items.map(present.roomDto) };
      });
      scope.post("/rooms", { preHandler: perm("schedule.room.manage") }, async (req, reply) => {
        const room = unwrapOrThrow(await ref.createRoom(deps, ctxOf(req), parse(schedulingRoomBodySchema, req.body)));
        return reply.status(201).send(present.roomDto(room));
      });
      scope.get("/rooms/:id", { preHandler: perm("schedule.read") }, async (req) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        return present.roomDto(unwrapOrThrow(await ref.getRoom(deps, ctxOf(req), { roomId: id })));
      });
      scope.patch("/rooms/:id", { preHandler: perm("schedule.room.manage") }, async (req) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        return present.roomDto(unwrapOrThrow(await ref.updateRoom(deps, ctxOf(req), { roomId: id, ...stripUndefined(parse(schedulingRoomPatchSchema, req.body)) })));
      });
      scope.post("/rooms/:id/status", { preHandler: perm("schedule.room.manage") }, async (req) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        const b = parse(schedulingRoomStatusBodySchema, req.body);
        const r = unwrapOrThrow(await ref.setRoomStatus(deps, ctxOf(req), { roomId: id, status: b.status, ...(b.reason ? { reason: b.reason } : {}) }));
        return { room: present.roomDto(r.room), flagged: r.flagged, cleared: r.cleared };
      });

      // ===== Équipements (feature scheduling.equipment) =====================================================
      scope.get("/equipment", { preHandler: withFeature("schedule.read", EQUIPMENT_FEATURE) }, async (req) => {
        const items = unwrapOrThrow(await ref.listEquipmentItems(deps, ctxOf(req), stripUndefined(parse(schedulingListEquipmentQuerySchema, req.query))));
        return { items: items.map(present.equipmentDto) };
      });
      scope.post("/equipment", { preHandler: withFeature("schedule.room.manage", EQUIPMENT_FEATURE) }, async (req, reply) => {
        const item = unwrapOrThrow(await ref.createEquipmentItem(deps, ctxOf(req), parse(schedulingEquipmentBodySchema, req.body)));
        return reply.status(201).send(present.equipmentDto(item));
      });
      scope.patch("/equipment/:id", { preHandler: withFeature("schedule.room.manage", EQUIPMENT_FEATURE) }, async (req) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        const r = unwrapOrThrow(await ref.updateEquipmentItem(deps, ctxOf(req), { equipmentId: id, ...stripUndefined(parse(schedulingEquipmentPatchSchema, req.body)) }));
        return { item: present.equipmentDto(r.item), overbooked: r.overbooked.map((o) => ({ occurrenceId: o.occurrenceId, startsAt: o.startsAt.toISOString(), requested: o.requested })) };
      });

      // ===== Grille horaire ===================================================================================
      scope.get("/time-slots", { preHandler: perm("schedule.read") }, async (req) => {
        const q = parse(schedulingListTimeSlotsQuerySchema, req.query);
        const items = unwrapOrThrow(await ref.listTimeSlots(deps, ctxOf(req), stripUndefined({ institutionId: q.institutionId, campusId: q.campusId, activeOnly: q.activeOnly })));
        return { items: items.map(present.timeSlotDto) };
      });
      scope.put("/time-slots", { preHandler: perm("schedule.manage") }, async (req) => present.timeSlotDto(unwrapOrThrow(await ref.upsertTimeSlot(deps, ctxOf(req), parse(schedulingTimeSlotBodySchema, req.body)))));
      scope.post("/time-slots/:id/deactivate", { preHandler: perm("schedule.manage") }, async (req) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        return present.timeSlotDto(unwrapOrThrow(await ref.deactivateTimeSlot(deps, ctxOf(req), { timeSlotId: id })));
      });

      // ===== Calendrier de l'établissement ===================================================================
      scope.get("/calendar-events", { preHandler: perm("schedule.read") }, async (req) => {
        const q = parse(schedulingListCalendarEventsQuerySchema, req.query);
        const items = unwrapOrThrow(await ref.listCalendarEvents(deps, ctxOf(req), stripUndefined(q)));
        return { items: items.map(present.calendarEventDto) };
      });
      scope.post("/calendar-events", { preHandler: perm("schedule.calendar.manage") }, async (req, reply) => {
        const r = unwrapOrThrow(await ref.createCalendarEvent(deps, ctxOf(req), parse(schedulingCalendarEventBodySchema, req.body)));
        return reply.status(201).send({ event: present.calendarEventDto(r.event), affectedOccurrences: r.affectedOccurrences, duplicates: r.duplicates });
      });
      scope.patch("/calendar-events/:id", { preHandler: perm("schedule.calendar.manage") }, async (req) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        const r = unwrapOrThrow(await ref.updateCalendarEvent(deps, ctxOf(req), { ...parse(schedulingCalendarEventPatchSchema, req.body), eventId: id }));
        return { event: present.calendarEventDto(r.event), affectedOccurrences: r.affectedOccurrences, duplicates: r.duplicates };
      });
      scope.delete("/calendar-events/:id", { preHandler: perm("schedule.calendar.manage") }, async (req) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        return unwrapOrThrow(await ref.deleteCalendarEvent(deps, ctxOf(req), { eventId: id }));
      });

      // ===== Emplois du temps et patrons =====================================================================
      scope.get("/timetables", { preHandler: perm("schedule.read") }, async (req) => {
        const items = unwrapOrThrow(await tt.listTimetables(deps, ctxOf(req), stripUndefined(parse(schedulingListTimetablesQuerySchema, req.query))));
        return { items: items.map(present.timetableDto) };
      });
      scope.post("/timetables", { preHandler: perm("schedule.manage") }, async (req, reply) => {
        const t = unwrapOrThrow(await tt.createTimetable(deps, ctxOf(req), parse(schedulingTimetableBodySchema, req.body)));
        return reply.status(201).send(present.timetableDto(t));
      });
      scope.get("/timetables/:id", { preHandler: perm("schedule.read") }, async (req) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        const r = unwrapOrThrow(await tt.getTimetable(deps, ctxOf(req), { timetableId: id }));
        return { timetable: present.timetableDto(r.timetable), entries: r.entries.map(present.entryDto) };
      });
      scope.patch("/timetables/:id", { preHandler: perm("schedule.manage") }, async (req) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        return present.timetableDto(unwrapOrThrow(await tt.updateTimetable(deps, ctxOf(req), { timetableId: id, ...stripUndefined(parse(schedulingTimetablePatchSchema, req.body)) })));
      });
      scope.get("/timetables/:id/entries", { preHandler: perm("schedule.read") }, async (req) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        const r = unwrapOrThrow(await tt.getTimetable(deps, ctxOf(req), { timetableId: id }));
        return { items: r.entries.map(present.entryDto) };
      });

      const entryResultDto = (r: tt.EntryResult) => ({ entry: present.entryDto(r.entry), conflicts: r.conflicts, warnings: r.warnings, propagation: r.propagation });
      scope.post("/timetables/:id/entries", { preHandler: perm("schedule.manage") }, async (req, reply) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        const body = parse(schedulingEntryBodySchema, req.body);
        await requireOverridePermission(req, reply, body.overrideReason !== undefined);
        return reply.status(201).send(entryResultDto(unwrapOrThrow(await tt.upsertTimetableEntry(deps, ctxOf(req), { ...stripUndefined(body), timetableId: id } as tt.EntryInput))));
      });
      scope.post("/timetables/:id/entries/batch", { preHandler: perm("schedule.manage") }, async (req, reply) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        const body = parse(schedulingEntryBatchBodySchema, req.body);
        await requireOverridePermission(req, reply, body.overrideReason !== undefined);
        const rs = unwrapOrThrow(await tt.upsertTimetableEntries(deps, ctxOf(req), { timetableId: id, entries: body.entries.map((e) => stripUndefined(e)) as Omit<tt.EntryInput, "timetableId">[], ...(body.overrideReason ? { overrideReason: body.overrideReason } : {}) }));
        return reply.status(201).send({ items: rs.map(entryResultDto) });
      });
      scope.patch("/timetables/:id/entries/:entryId", { preHandler: perm("schedule.manage") }, async (req, reply) => {
        const { id, entryId } = parse(schedulingEntryParamsSchema, req.params);
        const body = parse(schedulingEntryBodySchema, req.body);
        await requireOverridePermission(req, reply, body.overrideReason !== undefined);
        return entryResultDto(unwrapOrThrow(await tt.upsertTimetableEntry(deps, ctxOf(req), { ...stripUndefined(body), timetableId: id, entryId } as tt.EntryInput)));
      });
      scope.delete("/timetables/:id/entries/:entryId", { preHandler: perm("schedule.manage") }, async (req) => {
        const { entryId } = parse(schedulingEntryParamsSchema, req.params);
        return unwrapOrThrow(await tt.removeTimetableEntry(deps, ctxOf(req), { entryId }));
      });
      scope.post("/timetables/:id/publish", { preHandler: perm("schedule.publish") }, async (req) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        return present.timetableDto(unwrapOrThrow(await tt.publishTimetable(deps, ctxOf(req), { timetableId: id })));
      });
      scope.post("/timetables/:id/archive", { preHandler: perm("schedule.publish") }, async (req) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        return present.timetableDto(unwrapOrThrow(await tt.archiveTimetable(deps, ctxOf(req), { timetableId: id })));
      });
      scope.post("/timetables/:id/clone", { preHandler: perm("schedule.manage") }, async (req, reply) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        const r = unwrapOrThrow(await tt.cloneTimetable(deps, ctxOf(req), { ...stripUndefined(parse(schedulingCloneTimetableBodySchema, req.body)), sourceId: id } as tt.CloneInput));
        return reply.status(201).send({ timetable: present.timetableDto(r.timetable), copied: r.copied, unmapped: r.unmapped });
      });
      scope.post("/timetables/:id/generate", { preHandler: withFeature("schedule.manage", "scheduling.generation") }, async (req) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        return unwrapOrThrow(await generateOccurrences(deps, ctxOf(req), { ...stripUndefined(parse(schedulingGenerateBodySchema, req.body)), timetableId: id }));
      });
      scope.get("/timetables/:id/conflicts", { preHandler: perm("schedule.read") }, async (req) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        return { items: unwrapOrThrow(await tt.getTimetableConflicts(deps, ctxOf(req), { timetableId: id })) };
      });
      scope.get("/timetables/:id/generation-runs", { preHandler: perm("schedule.read") }, async (req) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        return { items: unwrapOrThrow(await tt.listGenerationRuns(deps, ctxOf(req), { timetableId: id })).map(present.generationRunDto) };
      });
      scope.get("/timetables/:id/missing", { preHandler: perm("schedule.read") }, async (req) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        const q = parse(schedulingMissingQuerySchema, req.query);
        const items = unwrapOrThrow(await listExpectedWithoutOccurrence(deps, ctxOf(req), { timetableId: id, ...q }));
        return { items: items.map((m) => ({ entryId: m.entryId, date: m.date, startsAt: m.startsAt.toISOString(), endsAt: m.endsAt.toISOString() })) };
      });

      // ===== Files de travail (statiques, avant `/occurrences/:id`) ===========================================
      scope.get("/occurrences/pending-validation", { preHandler: perm("schedule.read") }, async (req) => {
        const q = parse(schedulingPendingQuerySchema, req.query);
        return asOccurrenceList(unwrapOrThrow(await views.listPendingValidation(deps, ctxOf(req), stripUndefined(q))));
      });
      scope.get("/occurrences/unrealized", { preHandler: perm("schedule.read") }, async (req) => {
        const q = parse(schedulingPendingQuerySchema, req.query);
        return asOccurrenceList(unwrapOrThrow(await views.listUnrealizedOccurrences(deps, ctxOf(req), stripUndefined(q))));
      });
      scope.get("/occurrences/pending-replacements", { preHandler: perm("schedule.read") }, async (req) => {
        const q = parse(schedulingPendingQuerySchema, req.query);
        return asOccurrenceList(unwrapOrThrow(await views.listPendingReplacements(deps, ctxOf(req), stripUndefined(q))));
      });
      scope.post("/occurrences/validate-batch", { preHandler: perm("schedule.occurrence.validate") }, async (req) => {
        const b = parse(schedulingValidateBatchBodySchema, req.body);
        return unwrapOrThrow(await val.validateOccurrencesBatch(deps, ctxOf(req), { occurrenceIds: b.occurrenceIds }));
      });
      scope.post("/occurrences/accounting", { preHandler: perm("schedule.accounting.create") }, async (req, reply) => {
        const r = unwrapOrThrow(await occ.createAccountingOccurrence(deps, ctxOf(req), stripUndefined(parse(schedulingAccountingBodySchema, req.body)) as occ.CreateAccountingOccurrenceInput));
        return reply.status(201).send(occurrenceResult(r));
      });

      // ===== Séances ======================================================================================
      scope.get("/occurrences", { preHandler: perm("schedule.read") }, async (req) => {
        const q = parse(schedulingListOccurrencesQuerySchema, req.query);
        const { status, validated, kind, ...rest } = q;
        const input = stripUndefined({ ...rest, ...(status ? { statuses: [status] } : {}), ...(kind ? { kinds: [kind] } : {}), ...(validated ? { validated: validated === "true" } : {}) });
        return asOccurrenceList(unwrapOrThrow(await views.listOccurrences(deps, ctxOf(req), input as views.ListOccurrencesInput)));
      });
      scope.post("/occurrences", { preHandler: anyOf("schedule.manage", "schedule.room.book", "schedule.occurrence.declare") }, async (req, reply) => {
        const body = parse(schedulingCreateOccurrenceBodySchema, req.body);
        const granted = grantOf(req);
        await requireOverridePermission(req, reply, body.override !== undefined);
        let mode: "MANAGE" | "DECLARE" = "MANAGE";
        if (granted === "schedule.room.book") {
          // Réserver une salle ne donne pas le droit de planifier un cours.
          if (body.kind !== "RESERVATION") throw new ForbiddenError("« schedule.room.book » ne permet que les réservations de salle.", { details: { permission: "schedule.manage" } });
        } else if (granted === "schedule.occurrence.declare") {
          mode = "DECLARE";
          // Un enseignant qui réserve une salle en plus de sa séance doit en avoir le droit explicite.
          if (body.roomId && !(await has(req, reply, "schedule.room.book"))) {
            throw new ForbiddenError("Réserver une salle exige la permission « schedule.room.book ».", { details: { permission: "schedule.room.book" } });
          }
        }
        const r = unwrapOrThrow(await occ.createOccurrence(deps, ctxOf(req), { ...(stripUndefined(body) as unknown as occ.CreateOccurrenceInput), mode }));
        return reply.status(201).send(occurrenceResult(r));
      });
      scope.get("/occurrences/:id", { preHandler: perm("schedule.read") }, async (req) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        const v = unwrapOrThrow(await views.getOccurrence(deps, ctxOf(req), { occurrenceId: id }));
        return present.occurrenceDto(v, { attendanceSubmitted: v.attendanceSubmitted });
      });
      scope.patch("/occurrences/:id", { preHandler: perm("schedule.manage") }, async (req) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        return present.occurrenceDto(unwrapOrThrow(await occ.updateOccurrenceDetails(deps, ctxOf(req), { occurrenceId: id, ...stripUndefined(parse(schedulingUpdateOccurrenceBodySchema, req.body)) })));
      });
      scope.get("/occurrences/:id/history", { preHandler: perm("schedule.read") }, async (req) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        return { items: unwrapOrThrow(await views.getOccurrenceHistory(deps, ctxOf(req), { occurrenceId: id })).map(present.changeDto) };
      });
      scope.post("/occurrences/:id/reschedule", { preHandler: perm("schedule.manage") }, async (req, reply) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        const body = parse(schedulingRescheduleBodySchema, req.body);
        await requireOverridePermission(req, reply, body.override !== undefined);
        return occurrenceResult(unwrapOrThrow(await occ.rescheduleOccurrence(deps, ctxOf(req), { ...(stripUndefined(body) as Omit<occ.RescheduleInput, "occurrenceId">), occurrenceId: id })));
      });
      scope.post("/occurrences/:id/room", { preHandler: perm("schedule.manage") }, async (req, reply) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        const body = parse(schedulingChangeRoomBodySchema, req.body);
        await requireOverridePermission(req, reply, body.override !== undefined);
        return occurrenceResult(unwrapOrThrow(await occ.changeOccurrenceRoom(deps, ctxOf(req), { ...(stripUndefined(body) as Omit<occ.ChangeRoomInput, "occurrenceId">), occurrenceId: id })));
      });
      scope.post("/occurrences/:id/staff", { preHandler: perm("schedule.manage") }, async (req, reply) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        const body = parse(schedulingSetStaffBodySchema, req.body);
        await requireOverridePermission(req, reply, body.override !== undefined);
        return occurrenceResult(unwrapOrThrow(await occ.setOccurrenceStaff(deps, ctxOf(req), { ...(stripUndefined(body) as unknown as Omit<occ.SetStaffInput, "occurrenceId">), occurrenceId: id })));
      });
      scope.post("/occurrences/:id/substitute", { preHandler: perm("schedule.manage") }, async (req, reply) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        const body = parse(schedulingSubstituteBodySchema, req.body);
        await requireOverridePermission(req, reply, body.override !== undefined);
        return occurrenceResult(unwrapOrThrow(await occ.substituteStaff(deps, ctxOf(req), { ...(stripUndefined(body) as Omit<occ.SubstituteInput, "occurrenceId">), occurrenceId: id })));
      });
      scope.post("/occurrences/:id/cancel", { preHandler: perm("schedule.manage") }, async (req) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        const r = unwrapOrThrow(await occ.cancelOccurrence(deps, ctxOf(req), { occurrenceId: id, reason: parse(schedulingCancelBodySchema, req.body).reason }));
        return { occurrence: present.occurrenceDto(r.occurrence), alreadyCancelled: r.alreadyCancelled };
      });
      scope.post("/occurrences/:id/restore", { preHandler: perm("schedule.manage") }, async (req, reply) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        const body = parse(schedulingRestoreBodySchema, req.body);
        await requireOverridePermission(req, reply, body.override !== undefined);
        return occurrenceResult(unwrapOrThrow(await occ.restoreOccurrence(deps, ctxOf(req), { ...(stripUndefined(body) as Omit<Parameters<typeof occ.restoreOccurrence>[2], "occurrenceId">), occurrenceId: id })));
      });
      scope.post("/occurrences/:id/hold", { preHandler: anyOf("schedule.occurrence.hold", "schedule.manage") }, async (req) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        const body = parse(schedulingHoldBodySchema, req.body);
        const r = unwrapOrThrow(await occ.holdOccurrence(deps, ctxOf(req), { occurrenceId: id, source: "ADMIN", ...(body.reason ? { reason: body.reason } : {}) }));
        return { occurrence: present.occurrenceDto(r.occurrence), alreadyHeld: r.alreadyHeld, warnings: r.warnings };
      });
      scope.post("/occurrences/:id/unhold", { preHandler: anyOf("schedule.occurrence.hold", "schedule.manage") }, async (req) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        return present.occurrenceDto(unwrapOrThrow(await occ.unholdOccurrence(deps, ctxOf(req), { occurrenceId: id, reason: parse(schedulingUnholdBodySchema, req.body).reason })));
      });
      scope.post("/occurrences/:id/override", { preHandler: perm("schedule.conflict.override") }, async (req) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        return present.occurrenceDto(unwrapOrThrow(await occ.overrideConflict(deps, ctxOf(req), { occurrenceId: id, reason: parse(schedulingOverrideBodySchema, req.body).reason })));
      });
      scope.post("/occurrences/:id/validate", { preHandler: perm("schedule.occurrence.validate") }, async (req) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        return unwrapOrThrow(await val.validateOccurrence(deps, ctxOf(req), { occurrenceId: id }));
      });
      scope.post("/occurrences/:id/unvalidate", { preHandler: perm("schedule.occurrence.validate") }, async (req) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        return unwrapOrThrow(await val.unvalidateOccurrence(deps, ctxOf(req), { occurrenceId: id, reason: parse(schedulingUnvalidateBodySchema, req.body).reason }));
      });
      scope.put("/occurrences/:id/staff/:staffId/paid-minutes", { preHandler: perm("schedule.occurrence.validate") }, async (req) => {
        const { id, staffId } = parse(schedulingStaffParamsSchema, req.params);
        const b = parse(schedulingPaidMinutesBodySchema, req.body);
        return present.staffDto(unwrapOrThrow(await val.setPaidMinutes(deps, ctxOf(req), { occurrenceId: id, staffId, minutes: b.minutes, ...(b.reason ? { reason: b.reason } : {}) })));
      });
      scope.post("/occurrences/:id/substitutes/suggest", { preHandler: perm("schedule.read") }, async (req) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        const b = parse(schedulingSuggestSubstitutesBodySchema, req.body);
        return { items: unwrapOrThrow(await suggestSubstitutes(deps, ctxOf(req), { occurrenceId: id, ...(b.count ? { count: b.count } : {}) })) };
      });

      // ===== Aides au placement ============================================================================
      scope.post("/conflicts/preview", { preHandler: perm("schedule.read") }, async (req) => unwrapOrThrow(await previewConflicts(deps, ctxOf(req), stripUndefined(parse(schedulingPreviewBodySchema, req.body)) as Parameters<typeof previewConflicts>[2])));
      scope.post("/slots/suggest", { preHandler: perm("schedule.read") }, async (req) => {
        const slots = unwrapOrThrow(await suggestSlots(deps, ctxOf(req), stripUndefined(parse(schedulingSuggestSlotsBodySchema, req.body)) as Parameters<typeof suggestSlots>[2]));
        return {
          items: slots.map((s) => ({
            date: s.date,
            startMinute: s.startMinute,
            endMinute: s.endMinute,
            startsAt: s.startsAt.toISOString(),
            endsAt: s.endsAt.toISOString(),
            roomId: s.roomId,
            roomCode: s.roomCode,
            preferred: s.preferred,
            warnings: s.warnings,
          })),
        };
      });

      // ===== Vues ============================================================================================
      const windowOf = (q: z.infer<typeof schedulingWindowQuerySchema>) =>
        stripUndefined({ from: q.from, to: q.to, includeCancelled: q.includeCancelled === "true" ? true : undefined, limit: q.limit, offset: q.offset }) as views.WindowInput;
      scope.get("/views/classroom/:id", { preHandler: perm("schedule.read") }, async (req) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        return asOccurrenceList(unwrapOrThrow(await views.listOccurrencesForClassroom(deps, ctxOf(req), { ...windowOf(parse(schedulingWindowQuerySchema, req.query)), classroomId: id })));
      });
      scope.get("/views/room/:id", { preHandler: perm("schedule.read") }, async (req) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        return asOccurrenceList(unwrapOrThrow(await views.listOccurrencesForRoom(deps, ctxOf(req), { ...windowOf(parse(schedulingWindowQuerySchema, req.query)), roomId: id })));
      });
      scope.get("/views/staff/:id", { preHandler: anyOf("schedule.read", "schedule.own.read") }, async (req) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        const access: views.ViewAccess = grantOf(req) === "schedule.read" ? "ALL" : "OWN";
        return asOccurrenceList(unwrapOrThrow(await views.listOccurrencesForStaff(deps, ctxOf(req), { ...windowOf(parse(schedulingWindowQuerySchema, req.query)), staffId: id, access })));
      });
      scope.get("/views/student/:id", { preHandler: anyOf("schedule.read", "schedule.self.read", "schedule.child.read") }, async (req) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        const g = grantOf(req);
        const access: views.StudentAccess = g === "schedule.read" ? "MANAGER" : g === "schedule.self.read" ? "SELF" : "GUARDIAN";
        return asOccurrenceList(unwrapOrThrow(await views.listOccurrencesForStudent(deps, ctxOf(req), { ...windowOf(parse(schedulingWindowQuerySchema, req.query)), studentId: id, access })));
      });
      scope.get("/me/today", { preHandler: perm("schedule.own.read") }, async (req) => {
        const r = unwrapOrThrow(await views.listMyToday(deps, ctxOf(req)));
        return { date: r.date, staffId: r.staffId, items: r.items.map((o) => present.occurrenceDto(o)) };
      });
      scope.get("/me/timetable", { preHandler: anyOf("schedule.own.read", "schedule.self.read") }, async (req) => {
        const r = unwrapOrThrow(await views.listMyTimetable(deps, ctxOf(req), windowOf(parse(schedulingWindowQuerySchema, req.query))));
        return { subject: r.subject, subjectId: r.subjectId, ...asOccurrenceList(r.page) };
      });
      scope.get("/children/:studentId/timetable", { preHandler: perm("schedule.child.read") }, async (req) => {
        const { studentId } = parse(schedulingStudentParamsSchema, req.params);
        return asOccurrenceList(unwrapOrThrow(await views.listOccurrencesForStudent(deps, ctxOf(req), { ...windowOf(parse(schedulingWindowQuerySchema, req.query)), studentId, access: "GUARDIAN" })));
      });

      // ===== Rapports =========================================================================================
      scope.get("/reports/overlaps", { preHandler: perm("schedule.read") }, async (req) => {
        const q = parse(schedulingRangeQuerySchema, req.query);
        return { items: unwrapOrThrow(await val.findValidatedOverlaps(deps, ctxOf(req), { from: q.from, to: q.to, ...(q.staffId ? { staffIds: [q.staffId] } : {}) })).map(present.overlapDto) };
      });
      scope.get("/reports/room-occupancy", { preHandler: perm("schedule.read") }, async (req) => unwrapOrThrow(await views.getRoomOccupancy(deps, ctxOf(req), parse(schedulingRoomOccupancyQuerySchema, req.query))));
      scope.get("/reports/staff-load", { preHandler: anyOf("schedule.read", "schedule.own.read") }, async (req) => {
        const q = parse(schedulingStaffLoadQuerySchema, req.query);
        if (grantOf(req) !== "schedule.read") {
          // Un membre du personnel ne consulte que sa propre charge.
          const own = deps.ports.people && ctxOf(req).userId ? await deps.ports.people.resolveStaffForUser(ctxOf(req), ctxOf(req).userId as string) : null;
          if (own !== q.staffId) throw new ForbiddenError("Vous ne pouvez consulter que votre propre charge.", { details: { permission: "schedule.read" } });
        }
        return unwrapOrThrow(await views.getStaffWeeklyLoad(deps, ctxOf(req), { staffId: q.staffId, weekOf: q.week }));
      });

      // ===== iCalendar =======================================================================================
      scope.get("/export/download.ics", { preHandler: anyOf("schedule.read", "schedule.own.read", "schedule.self.read", "schedule.child.read") }, async (req, reply) => {
        const q = parse(schedulingIcsDownloadQuerySchema, req.query);
        const access: views.ViewAccess = grantOf(req) === "schedule.read" ? "ALL" : "OWN";
        const text = unwrapOrThrow(await views.exportTimetableIcs(deps, ctxOf(req), { ...stripUndefined(q), access } as Parameters<typeof views.exportTimetableIcs>[2]));
        return reply.header("content-type", "text/calendar; charset=utf-8").header("content-disposition", 'attachment; filename="emploi-du-temps.ics"').send(text);
      });
      scope.post("/export/tokens", { preHandler: anyOf("schedule.read", "schedule.own.read", "schedule.self.read", "schedule.child.read") }, async (req, reply) => {
        const b = parse(schedulingIcsTokenBodySchema, req.body);
        const access: views.ViewAccess = grantOf(req) === "schedule.read" ? "ALL" : "OWN";
        const r = unwrapOrThrow(await views.createIcsToken(deps, ctxOf(req), { ...stripUndefined(b), access } as Parameters<typeof views.createIcsToken>[2]));
        return reply.status(201).send({
          tokenId: r.tokenId,
          token: r.token,
          expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
          path: `${SCHEDULING_ROUTES_PREFIX}/export/timetable.ics?scope=${b.scope}&token=${r.token}`,
        });
      });
      scope.get("/export/tokens", { preHandler: anyOf("schedule.read", "schedule.own.read", "schedule.self.read", "schedule.child.read") }, async (req) => {
        const q = parse(schedulingIcsTokensQuerySchema, req.query);
        const access: views.ViewAccess = grantOf(req) === "schedule.read" ? "ALL" : "OWN";
        return { items: unwrapOrThrow(await views.listIcsTokens(deps, ctxOf(req), { ...q, access })).map(present.icsTokenDto) };
      });
      scope.delete("/export/tokens/:id", { preHandler: anyOf("schedule.read", "schedule.own.read", "schedule.self.read", "schedule.child.read") }, async (req) => {
        const { id } = parse(schedulingIdParamsSchema, req.params);
        const access: views.ViewAccess = grantOf(req) === "schedule.read" ? "ALL" : "OWN";
        return unwrapOrThrow(await views.revokeIcsToken(deps, ctxOf(req), { tokenId: id, access }));
      });
      // PUBLIQUE : le jeton d'abonnement (secret, révocable, limité à UN sujet et en lecture) fait foi.
      scope.get("/export/timetable.ics", { config: { public: true } }, async (req, reply) => {
        const q = parse(schedulingIcsQuerySchema, req.query);
        if (options.rateLimiter) {
          const rule = options.icsRateLimit ?? { limit: 60, windowMs: 60_000 };
          const hit = await options.rateLimiter.hit(`scheduling:ics:${req.ip}`, rule);
          if (!hit.allowed) {
            return reply.status(429).header("retry-after", String(Math.ceil(hit.retryAfterMs / 1000))).send(toErrorBody(new ConflictError("Trop de requêtes.", { code: "scheduling.rate_limited" }), String(req.id)));
          }
        }
        const feed = unwrapOrThrow(await views.readIcsFeed(deps, { token: q.token, scope: q.scope }));
        return reply.header("content-type", "text/calendar; charset=utf-8").header("cache-control", "private, max-age=300").send(feed.ics);
      });
    },
    options.prefix !== undefined ? { prefix: options.prefix } : {},
  );
}

/**
 * Contrat d'assemblage uniforme (`platform/runtime.ts`) : `(app, runtime)`, routes sans préfixe (le registre
 * applique `/api/v1/scheduling`). Les ports `AcademicQuery` / `PeopleQuery` / `AttendanceQuery` viennent du
 * registre de ports du module (`registerSchedulingPorts`, appelé par le câblage des modules voisins).
 */
export default async function schedulingModulePlugin(app: FastifyInstance, runtime: ModuleRuntime): Promise<void> {
  const deps = createSchedulingDeps({
    db: runtime.tenantDb,
    clock: runtime.clock,
    audit: schedulingAuditAdapter(runtime.auditPort),
    logger: runtime.logger,
    ports: registryPorts,
  });
  await app.register(schedulingPlugin, {
    deps,
    prefix: "",
    requirePermission: (permission) => runtime.requirePermission(permission),
    requireFeature: (featureKey) => runtime.entitlements.requireFeature(featureKey),
    resolveContext: (request) => runtime.resolveContext(request),
    rateLimiter: {
      hit: async (key, rule) => {
        const d = await runtime.rateLimiter.hit(key, rule);
        return { allowed: d.allowed, retryAfterMs: d.retryAfterMs };
      },
    },
  });
}
