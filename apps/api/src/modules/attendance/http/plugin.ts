/**
 * Plugin Fastify du module attendance — routes SANS préfixe (le registre applique `/api/v1/attendance`, voir
 * `docs/architecture/platform-assembly.md`). Contrat d'assemblage `(app, runtime)` + `setup(app, runtime)` qui décore la
 * RACINE avec le registre de ports (`app.attendancePorts`) que `academic`, `people` et `scheduling` renseignent.
 *
 *  - Authentification : `request.ctx` posé en amont (iam v2 / legacy dérivé). Aucune confiance dans un en-tête client
 *    (le legacy prenait `x-user-id` avant le JWT) : l'identité vient du contexte, la RELATION (tuteur lié, intervenant
 *    de la séance, déposant) est vérifiée par les cas d'usage via les ports.
 *  - Autorisation : `requirePermission('attendance.…')` du module rbac, jamais un rôle codé en dur ; les permissions
 *    sensibles (réouverture, surcharge, décision de congé) exigent la MFA (garde rbac).
 *  - Entitlements : `requireFeature('attendance.staff' | 'attendance.offline' | 'attendance.live-bridge')`.
 *  - Aucun `GET` n'écrit (sauf la lecture AUDITÉE d'une pièce, qui écrit uniquement l'audit).
 *  - Erreurs : `AppError` / Zod -> `toErrorBody` ; codes stables `attendance.*` ; jamais de message interne.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { UnauthorizedError, ValidationError, toAppError, toErrorBody, type RequestContext, type Result } from "@ecoledigitale/kernel";
import {
  attendanceAbsencesQuerySchema,
  attendanceAcceptJustificationBodySchema,
  attendanceAttachDocumentBodySchema,
  attendanceAttachmentParamsSchema,
  attendanceCertificateQuerySchema,
  attendanceCheckInBodySchema,
  attendanceCheckOutBodySchema,
  attendanceChildParamsSchema,
  attendanceComplianceQuerySchema,
  attendanceExternalMarksBodySchema,
  attendanceIdParamsSchema,
  attendanceLeaveDecisionBodySchema,
  attendanceLeaveRejectBodySchema,
  attendanceListConflictsQuerySchema,
  attendanceListJustificationsQuerySchema,
  attendanceListLeavesQuerySchema,
  attendanceListSessionsQuerySchema,
  attendanceListStaffRecordsQuerySchema,
  attendanceMarkRecordsBodySchema,
  attendanceMarkStaffBodySchema,
  attendanceMarkWithJustificationBodySchema,
  attendanceOpenSessionBodySchema,
  attendancePortalQuerySchema,
  attendanceReasonBodySchema,
  attendanceRecomputeBodySchema,
  attendanceRecordParamsSchema,
  attendanceRejectJustificationBodySchema,
  attendanceRemoveOverrideQuerySchema,
  attendanceRequestLeaveBodySchema,
  attendanceResolveConflictBodySchema,
  attendanceRevokeJustificationBodySchema,
  attendanceSetOverrideBodySchema,
  attendanceStaffSummaryQuerySchema,
  attendanceSubmitJustificationBodySchema,
  attendanceSubmitSessionBodySchema,
  attendanceSummaryQuerySchema,
  attendanceSyncBatchSchema,
  attendanceUpsertCallPolicyBodySchema,
  attendanceUpsertLeaveTypeBodySchema,
  attendanceUpsertReasonBodySchema,
  attendanceUpsertSettingsBodySchema,
  attendanceUpsertStatusBodySchema,
} from "@ecoledigitale/contracts/src/v2/attendance";
import type { ModuleRuntime } from "../../../platform/runtime";
import { getRequestCtx } from "../../rbac";
import { createAttendanceDeps, type AttendanceDeps, type CallerCaps } from "../application/deps";
import {
  acceptJustification,
  attachJustificationDocument,
  getJustification,
  getJustificationAttachmentUrl,
  listJustifications,
  markWithJustification,
  rejectJustification,
  removeJustificationAttachment,
  revokeJustification,
  submitJustification,
  withdrawJustification,
} from "../application/justifications";
import type { AttendancePorts } from "../application/ports";
import {
  getAttendanceSettings,
  listCallPolicyDefinitions,
  listJustificationReasons,
  listLeaveTypeDefinitions,
  listStatusDefinitions,
  upsertAttendanceSettings,
  upsertCallPolicy,
  upsertJustificationReason,
  upsertLeaveTypeDefinition,
  upsertStatusDefinition,
} from "../application/reference";
import { exportAbsencesCsv, getAttendanceCertificateData, getCallCompliance, getStudentPortalView, listAbsencesReport } from "../application/reports";
import {
  cancelAttendanceSession,
  getAttendanceSession,
  getRecordHistory,
  listAttendanceSessions,
  listStudentRecords,
  markStudentRecords,
  openAttendanceSession,
  reopenAttendanceSession,
  submitAttendanceSession,
  validateAttendanceSession,
  type OpenSessionInput,
} from "../application/sessions";
import { bulkMarkFromExternal } from "../application/external";
import {
  approveStaffLeave,
  cancelStaffLeave,
  checkInStaff,
  checkOutStaff,
  getStaffAttendanceSummary,
  listStaffLeaves,
  listStaffRecords,
  markStaffAttendance,
  rejectStaffLeave,
  requestStaffLeave,
} from "../application/staff";
import {
  getAttendanceSummary,
  getClassroomAttendanceSummary,
  recomputeSummaries,
  removeSummaryOverride,
  setSummaryOverride,
} from "../application/summaries";
import { listSyncConflicts, resolveSyncConflict, syncOfflineAttendance } from "../application/sync";
import { attendanceAuditAdapter } from "../infrastructure/audit-adapter";
import { createPermissionKit, PERMISSIONS as P, type PermissionKit } from "./guards";
import * as present from "./presenters";

// ---------------------------------------------------------------------------
// Registre de ports (renseigné par academic, people, scheduling…)
// ---------------------------------------------------------------------------

export interface AttendancePortRegistry {
  /** Enregistre (ou remplace) des ports ; les cas d'usage les relisent à chaque appel. */
  register(ports: Partial<AttendancePorts>): void;
  readonly current: Partial<AttendancePorts>;
}

export function createPortRegistry(initial: Partial<AttendancePorts> = {}): AttendancePortRegistry {
  let current: Partial<AttendancePorts> = { ...initial };
  return {
    register(ports) {
      current = { ...current, ...ports };
    },
    get current() {
      return current;
    },
  };
}

declare module "fastify" {
  interface FastifyInstance {
    /** Registre des ports du module attendance (posé par `setup`). */
    attendancePorts: AttendancePortRegistry;
  }
}

/** À appeler par les modules voisins (`academic`, `people`, `scheduling`) dans leur `setup(app, runtime)`. */
export function registerAttendancePorts(app: FastifyInstance, ports: Partial<AttendancePorts>): void {
  if (!app.hasDecorator("attendancePorts")) app.decorate("attendancePorts", createPortRegistry());
  app.attendancePorts.register(ports);
}

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

function zodToValidation(error: ZodError): ValidationError {
  return new ValidationError("Données invalides.", error.issues.map((i) => ({ path: i.path, message: i.message, code: i.code })));
}

function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  throw zodToValidation(result.error);
}

function unwrapOrThrow<T>(result: Result<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

const toDate = (s: string | undefined): Date | undefined => (s ? new Date(s) : undefined);

function maybeFastifyValidation(error: unknown): unknown {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const e = error as { statusCode?: number; code?: string };
    if (e.statusCode === 400) return new ValidationError("Requête invalide.", [], { code: "attendance.bad_request" });
    if (e.statusCode === 413) return new ValidationError("Corps de requête trop volumineux.", [], { code: "attendance.payload_too_large" });
  }
  return error;
}

export interface AttendancePluginOptions {
  deps: AttendanceDeps;
  /** Garde `requirePermission` du module rbac (`runtime.requirePermission`). */
  requirePermission: (permission: string) => preHandlerAsyncHookHandler;
  /** Garde `requireFeature` du module entitlements ; absente = toutes les features actives (tests autonomes). */
  requireFeature?: (featureKey: string) => preHandlerAsyncHookHandler;
  resolveContext?: (request: FastifyRequest) => RequestContext;
}

/** Plafond de transport d'une pièce encodée en base64 (12 Mio) ; la taille métier vient des paramètres d'établissement. */
const ATTACHMENT_BODY_LIMIT = 12 * 1024 * 1024;

export async function attendancePlugin(app: FastifyInstance, options: AttendancePluginOptions): Promise<void> {
  const { deps } = options;
  const kit: PermissionKit = createPermissionKit(options.requirePermission);
  const ctxOf = (request: FastifyRequest): RequestContext => {
    if (options.resolveContext) return options.resolveContext(request);
    const ctx = getRequestCtx(request);
    if (!ctx) throw new UnauthorizedError();
    return ctx;
  };
  const feature = (key: string): preHandlerAsyncHookHandler[] => {
    if (!options.requireFeature) return [];
    const guard = options.requireFeature(key);
    return [
      async function featureGate(this: FastifyInstance, request, reply) {
        return guard.call(this, request, reply);
      },
    ];
  };

  const handleError = (error: unknown, request: FastifyRequest, reply: FastifyReply): void => {
    const appError = error instanceof ZodError ? zodToValidation(error) : toAppError(maybeFastifyValidation(error));
    if (appError.httpStatus >= 500) request.log.error({ err: error }, "attendance : erreur inattendue");
    void reply.status(appError.httpStatus).send(toErrorBody(appError, String(request.id)));
  };

  await app.register(async (scope) => {
    scope.setErrorHandler((error, request, reply) => handleError(error, request, reply));
    const caps = (req: FastifyRequest, reply: FastifyReply, keys: ReadonlyArray<keyof CallerCaps>): Promise<CallerCaps> => kit.capsFor(scope, req, reply, keys);
    const bytesOf = (b64: string): Uint8Array => new Uint8Array(Buffer.from(b64, "base64"));

    // ===== Séances d'appel ===================================================================================
    scope.get("/sessions", { preHandler: kit.anyOf(P.read, P.take) }, async (req) => {
      const q = parse(attendanceListSessionsQuerySchema, req.query);
      const page = unwrapOrThrow(await listAttendanceSessions(deps, ctxOf(req), q));
      return { items: page.items.map(present.sessionDto), nextCursor: page.nextCursor };
    });

    scope.post("/sessions", { preHandler: kit.anyOf(P.take, P.manage) }, async (req, reply) => {
      const b = parse(attendanceOpenSessionBodySchema, req.body);
      const c = await caps(req, reply, ["manage"]);
      const input: OpenSessionInput =
        "occurrenceId" in b
          ? { kind: "occurrence", occurrenceId: b.occurrenceId, clientId: b.clientId, caps: c }
          : "source" in b
            ? {
                kind: "external", classroomId: b.classroomId, date: b.date, curriculumNodeId: b.curriculumNodeId, offeringId: b.offeringId, source: b.source,
                startsAt: toDate(b.startsAt), endsAt: toDate(b.endsAt), durationMinutes: b.durationMinutes, caps: c,
              }
            : { kind: "daily", classroomId: b.classroomId, date: b.date, takenByStaffId: b.takenByStaffId, clientId: b.clientId, caps: c };
      const r = unwrapOrThrow(await openAttendanceSession(deps, ctxOf(req), input));
      return reply.status(r.created ? 201 : 200).send({ session: present.sessionDto(r.session), created: r.created });
    });

    scope.get("/sessions/:id", { preHandler: kit.anyOf(P.read, P.take) }, async (req, reply) => {
      const { id } = parse(attendanceIdParamsSchema, req.params);
      return present.sessionDetailDto(unwrapOrThrow(await getAttendanceSession(deps, ctxOf(req), { sessionId: id, caps: await caps(req, reply, ["manage"]) })));
    });

    scope.put("/sessions/:id/records", { preHandler: kit.anyOf(P.take, P.manage) }, async (req, reply) => {
      const { id } = parse(attendanceIdParamsSchema, req.params);
      const b = parse(attendanceMarkRecordsBodySchema, req.body);
      const r = unwrapOrThrow(
        await markStudentRecords(deps, ctxOf(req), {
          sessionId: id,
          entries: b.entries.map((e) => ({ ...e, arrivedAt: toDate(e.arrivedAt), leftAt: toDate(e.leftAt) })),
          caps: await caps(req, reply, ["manage"]),
        }),
      );
      return { session: present.sessionDto(r.session), created: r.created, updated: r.updated, unchanged: r.unchanged, records: r.records.map(present.recordDto) };
    });

    scope.post("/sessions/:id/records/with-justification", { preHandler: kit.require(P.justificationDecide) }, async (req, reply) => {
      const { id } = parse(attendanceIdParamsSchema, req.params);
      const b = parse(attendanceMarkWithJustificationBodySchema, req.body);
      const r = unwrapOrThrow(await markWithJustification(deps, ctxOf(req), { sessionId: id, ...b, caps: await caps(req, reply, ["manage", "justificationDecide"]) }));
      return reply.status(201).send({ record: present.recordDto(r.record), justification: present.justificationDto(r.justification) });
    });

    scope.get("/sessions/:id/records/:rid/history", { preHandler: kit.require(P.read) }, async (req) => {
      const { id, rid } = parse(attendanceRecordParamsSchema, req.params);
      return present.historyDto(unwrapOrThrow(await getRecordHistory(deps, ctxOf(req), { sessionId: id, recordId: rid })));
    });

    scope.post("/sessions/:id/submit", { preHandler: kit.anyOf(P.take, P.manage) }, async (req, reply) => {
      const { id } = parse(attendanceIdParamsSchema, req.params);
      const b = parse(attendanceSubmitSessionBodySchema, req.body);
      const r = unwrapOrThrow(await submitAttendanceSession(deps, ctxOf(req), { sessionId: id, defaultStatus: b.defaultStatus, allPresent: b.allPresent, caps: await caps(req, reply, ["manage"]) }));
      return { session: present.sessionDto(r.session), alreadySubmitted: r.alreadySubmitted, filledByDefault: r.filledByDefault, absentCount: r.absentCount, lateCount: r.lateCount };
    });

    scope.post("/sessions/:id/validate", { preHandler: kit.require(P.validate) }, async (req, reply) => {
      const { id } = parse(attendanceIdParamsSchema, req.params);
      return present.sessionDto(unwrapOrThrow(await validateAttendanceSession(deps, ctxOf(req), { sessionId: id, caps: await caps(req, reply, ["validate"]) })));
    });

    scope.post("/sessions/:id/cancel", { preHandler: kit.anyOf(P.take, P.manage) }, async (req, reply) => {
      const { id } = parse(attendanceIdParamsSchema, req.params);
      const b = parse(attendanceReasonBodySchema, req.body);
      return present.sessionDto(unwrapOrThrow(await cancelAttendanceSession(deps, ctxOf(req), { sessionId: id, reason: b.reason, caps: await caps(req, reply, ["manage", "reopen"]) })));
    });

    scope.post("/sessions/:id/reopen", { preHandler: kit.require(P.reopen) }, async (req, reply) => {
      const { id } = parse(attendanceIdParamsSchema, req.params);
      const b = parse(attendanceReasonBodySchema, req.body);
      return present.sessionDto(unwrapOrThrow(await reopenAttendanceSession(deps, ctxOf(req), { sessionId: id, reason: b.reason, caps: await caps(req, reply, ["reopen"]) })));
    });

    // ===== Hors-ligne et ponts externes ======================================================================
    scope.post("/sync", { preHandler: [...feature("attendance.offline"), kit.anyOf(P.take, P.manage)] }, async (req, reply) => {
      const b = parse(attendanceSyncBatchSchema, req.body);
      const r = unwrapOrThrow(
        await syncOfflineAttendance(deps, ctxOf(req), {
          batchId: b.batchId,
          deviceId: b.deviceId,
          clientSentAt: new Date(b.clientSentAt),
          clockOffsetMs: b.clockOffsetMs,
          caps: await caps(req, reply, ["manage"]),
          sessions: b.sessions.map((s) => ({
            clientId: s.clientId,
            target: s.target,
            clientOpenedAt: new Date(s.clientOpenedAt),
            submit: s.submit,
            records: s.records.map((x) => ({ ...x, arrivedAt: toDate(x.arrivedAt), leftAt: toDate(x.leftAt), clientMarkedAt: new Date(x.clientMarkedAt) })),
          })),
        }),
      );
      return present.syncResultDto(r);
    });

    scope.get("/sync/conflicts", { preHandler: [...feature("attendance.offline"), kit.require(P.manage)] }, async (req) => {
      const q = parse(attendanceListConflictsQuerySchema, req.query);
      const page = unwrapOrThrow(await listSyncConflicts(deps, ctxOf(req), q));
      return { items: page.items.map(present.conflictDto), nextCursor: page.nextCursor };
    });

    scope.post("/sync/conflicts/:id/resolve", { preHandler: [...feature("attendance.offline"), kit.require(P.manage)] }, async (req, reply) => {
      const { id } = parse(attendanceIdParamsSchema, req.params);
      const b = parse(attendanceResolveConflictBodySchema, req.body);
      return present.conflictDto(unwrapOrThrow(await resolveSyncConflict(deps, ctxOf(req), { conflictId: id, resolution: b.resolution, note: b.note, caps: await caps(req, reply, ["manage"]) })));
    });

    scope.post("/external-marks", { preHandler: [...feature("attendance.live-bridge"), kit.require(P.manage)] }, async (req, reply) => {
      const b = parse(attendanceExternalMarksBodySchema, req.body);
      const r = unwrapOrThrow(await bulkMarkFromExternal(deps, ctxOf(req), { sessionId: b.sessionId, entries: b.entries, caps: await caps(req, reply, ["manage"]) }));
      return { session: present.sessionDto(r.session), results: r.results };
    });

    // ===== Élèves, classes, récapitulatifs ===================================================================
    scope.get("/students/:id/records", { preHandler: kit.require(P.read) }, async (req) => {
      const { id } = parse(attendanceIdParamsSchema, req.params);
      const q = parse(attendancePortalQuerySchema, req.query);
      const page = unwrapOrThrow(await listStudentRecords(deps, ctxOf(req), { studentId: id, from: q.from, to: q.to, limit: q.limit, cursor: q.cursor }));
      return { items: page.items.map(present.absenceRowDto), nextCursor: page.nextCursor };
    });

    scope.get("/students/:id/summary", { preHandler: kit.require(P.read) }, async (req) => {
      const { id } = parse(attendanceIdParamsSchema, req.params);
      const q = parse(attendanceSummaryQuerySchema, req.query);
      const cert = unwrapOrThrow(await getAttendanceCertificateData(deps, ctxOf(req), { studentId: id, periodId: q.periodId }));
      return present.summaryDto(unwrapOrThrow(await getAttendanceSummary(deps, ctxOf(req), { enrollmentId: cert.enrollmentId, periodId: q.periodId })));
    });

    scope.get("/enrollments/:id/summary", { preHandler: kit.require(P.read) }, async (req) => {
      const { id } = parse(attendanceIdParamsSchema, req.params);
      const q = parse(attendanceSummaryQuerySchema, req.query);
      return present.summaryDto(unwrapOrThrow(await getAttendanceSummary(deps, ctxOf(req), { enrollmentId: id, periodId: q.periodId })));
    });

    scope.get("/classrooms/:id/summary", { preHandler: kit.require(P.read) }, async (req) => {
      const { id } = parse(attendanceIdParamsSchema, req.params);
      const q = parse(attendanceSummaryQuerySchema, req.query);
      const r = unwrapOrThrow(await getClassroomAttendanceSummary(deps, ctxOf(req), { classroomId: id, periodId: q.periodId }));
      return { classroomId: r.classroomId, periodId: r.periodId, rows: r.rows.map(present.summaryDto) };
    });

    scope.put("/summary-overrides", { preHandler: kit.require(P.summaryOverride) }, async (req) => {
      const b = parse(attendanceSetOverrideBodySchema, req.body);
      return present.summaryDto(unwrapOrThrow(await setSummaryOverride(deps, ctxOf(req), b)));
    });

    scope.delete("/summary-overrides", { preHandler: kit.require(P.summaryOverride) }, async (req) => {
      const q = parse(attendanceRemoveOverrideQuerySchema, req.query);
      return present.summaryDto(unwrapOrThrow(await removeSummaryOverride(deps, ctxOf(req), q)));
    });

    scope.post("/summaries/recompute", { preHandler: kit.require(P.manage) }, async (req) => {
      const b = parse(attendanceRecomputeBodySchema, req.body);
      return unwrapOrThrow(await recomputeSummaries(deps, ctxOf(req), b));
    });

    // ===== Justificatifs =====================================================================================
    const submitters = [P.justificationSubmit, P.childJustify, P.selfJustify] as const;
    const submitCaps = ["justificationSubmit", "childJustify", "selfJustify", "justificationDecide", "justificationRead"] as const;

    scope.get("/justifications", { preHandler: kit.anyOf(P.justificationRead, ...submitters) }, async (req, reply) => {
      const q = parse(attendanceListJustificationsQuerySchema, req.query);
      const page = unwrapOrThrow(await listJustifications(deps, ctxOf(req), { ...q, caps: await caps(req, reply, submitCaps) }));
      return { items: page.items.map(present.justificationDto), nextCursor: page.nextCursor };
    });

    scope.post("/justifications", { preHandler: kit.anyOf(...submitters) }, async (req, reply) => {
      const b = parse(attendanceSubmitJustificationBodySchema, req.body);
      const r = unwrapOrThrow(await submitJustification(deps, ctxOf(req), { ...b, caps: await caps(req, reply, submitCaps) }));
      return reply.status(201).send(present.justificationDto(r));
    });

    scope.get("/justifications/:id", { preHandler: kit.anyOf(P.justificationRead, P.childRead, P.selfRead, ...submitters) }, async (req, reply) => {
      const { id } = parse(attendanceIdParamsSchema, req.params);
      return present.justificationDto(unwrapOrThrow(await getJustification(deps, ctxOf(req), { justificationId: id, caps: await caps(req, reply, submitCaps) })));
    });

    scope.post("/justifications/:id/accept", { preHandler: kit.require(P.justificationDecide) }, async (req, reply) => {
      const { id } = parse(attendanceIdParamsSchema, req.params);
      const b = parse(attendanceAcceptJustificationBodySchema, req.body);
      return present.justificationDto(unwrapOrThrow(await acceptJustification(deps, ctxOf(req), { justificationId: id, note: b.note, caps: await caps(req, reply, ["justificationDecide"]) })));
    });

    scope.post("/justifications/:id/reject", { preHandler: kit.require(P.justificationDecide) }, async (req, reply) => {
      const { id } = parse(attendanceIdParamsSchema, req.params);
      const b = parse(attendanceRejectJustificationBodySchema, req.body);
      return present.justificationDto(unwrapOrThrow(await rejectJustification(deps, ctxOf(req), { justificationId: id, note: b.note, caps: await caps(req, reply, ["justificationDecide"]) })));
    });

    scope.post("/justifications/:id/revoke", { preHandler: kit.require(P.justificationDecide) }, async (req, reply) => {
      const { id } = parse(attendanceIdParamsSchema, req.params);
      const b = parse(attendanceRevokeJustificationBodySchema, req.body);
      return present.justificationDto(unwrapOrThrow(await revokeJustification(deps, ctxOf(req), { justificationId: id, reason: b.reason, caps: await caps(req, reply, ["justificationDecide"]) })));
    });

    scope.post("/justifications/:id/withdraw", { preHandler: kit.anyOf(...submitters) }, async (req) => {
      const { id } = parse(attendanceIdParamsSchema, req.params);
      return present.justificationDto(unwrapOrThrow(await withdrawJustification(deps, ctxOf(req), { justificationId: id })));
    });

    scope.post("/justifications/:id/attachments", { bodyLimit: ATTACHMENT_BODY_LIMIT, preHandler: kit.anyOf(...submitters, P.justificationDecide) }, async (req, reply) => {
      const { id } = parse(attendanceIdParamsSchema, req.params);
      const b = parse(attendanceAttachDocumentBodySchema, req.body);
      const a = unwrapOrThrow(await attachJustificationDocument(deps, ctxOf(req), { justificationId: id, fileName: b.fileName, content: bytesOf(b.contentBase64), caps: await caps(req, reply, submitCaps) }));
      return reply.status(201).send(present.attachmentDtoOf(a));
    });

    scope.get("/justifications/:id/attachments/:aid", { preHandler: kit.anyOf(P.justificationRead, P.childRead, P.selfRead, ...submitters) }, async (req, reply) => {
      const { id, aid } = parse(attendanceAttachmentParamsSchema, req.params);
      const r = unwrapOrThrow(await getJustificationAttachmentUrl(deps, ctxOf(req), { justificationId: id, attachmentId: aid, caps: await caps(req, reply, submitCaps) }));
      return { url: r.url, expiresAt: r.expiresAt.toISOString(), fileName: r.fileName, detectedMime: r.detectedMime };
    });

    scope.delete("/justifications/:id/attachments/:aid", { preHandler: kit.anyOf(...submitters, P.justificationDecide) }, async (req, reply) => {
      const { id, aid } = parse(attendanceAttachmentParamsSchema, req.params);
      unwrapOrThrow(await removeJustificationAttachment(deps, ctxOf(req), { justificationId: id, attachmentId: aid, caps: await caps(req, reply, submitCaps) }));
      return reply.status(204).send();
    });

    // ===== Personnel : présence et congés ====================================================================
    const staffGate = feature("attendance.staff");

    scope.get("/staff/records", { preHandler: [...staffGate, kit.anyOf(P.staffRead, P.staffRecord, P.ownRead)] }, async (req, reply) => {
      const q = parse(attendanceListStaffRecordsQuerySchema, req.query);
      const page = unwrapOrThrow(await listStaffRecords(deps, ctxOf(req), { ...q, caps: await caps(req, reply, ["staffRead", "staffRecord"]) }));
      return { items: page.items.map(present.staffRecordDto), nextCursor: page.nextCursor };
    });

    scope.put("/staff/records", { preHandler: [...staffGate, kit.anyOf(P.staffRecord, P.ownRecord)] }, async (req, reply) => {
      const b = parse(attendanceMarkStaffBodySchema, req.body);
      const r = unwrapOrThrow(
        await markStaffAttendance(deps, ctxOf(req), { ...b, checkInAt: toDate(b.checkInAt), checkOutAt: toDate(b.checkOutAt), caps: await caps(req, reply, ["staffRecord", "ownRecord"]) }),
      );
      return { record: present.staffRecordDto(r.record), replayed: r.replayed };
    });

    scope.post("/staff/check-in", { preHandler: [...staffGate, kit.anyOf(P.staffRecord, P.ownRecord)] }, async (req, reply) => {
      const b = parse(attendanceCheckInBodySchema, req.body);
      const r = unwrapOrThrow(await checkInStaff(deps, ctxOf(req), { ...b, at: toDate(b.at), caps: await caps(req, reply, ["staffRecord", "ownRecord"]) }));
      return { record: present.staffRecordDto(r.record), replayed: r.replayed };
    });

    scope.post("/staff/check-out", { preHandler: [...staffGate, kit.anyOf(P.staffRecord, P.ownRecord)] }, async (req, reply) => {
      const b = parse(attendanceCheckOutBodySchema, req.body);
      const r = unwrapOrThrow(await checkOutStaff(deps, ctxOf(req), { ...b, at: toDate(b.at), caps: await caps(req, reply, ["staffRecord", "ownRecord"]) }));
      return { record: present.staffRecordDto(r.record), replayed: r.replayed };
    });

    scope.get("/staff/leaves", { preHandler: [...staffGate, kit.anyOf(P.staffRead, P.leaveDecide, P.leaveRequest, P.staffRecord, P.ownRead)] }, async (req, reply) => {
      const q = parse(attendanceListLeavesQuerySchema, req.query);
      const page = unwrapOrThrow(await listStaffLeaves(deps, ctxOf(req), { ...q, caps: await caps(req, reply, ["staffRead", "leaveDecide", "staffRecord"]) }));
      return { items: page.items.map(present.leaveDto), nextCursor: page.nextCursor };
    });

    scope.post("/staff/leaves", { preHandler: [...staffGate, kit.anyOf(P.leaveRequest, P.staffRecord)] }, async (req, reply) => {
      const b = parse(attendanceRequestLeaveBodySchema, req.body);
      const leave = unwrapOrThrow(await requestStaffLeave(deps, ctxOf(req), { ...b, caps: await caps(req, reply, ["leaveRequest", "staffRecord"]) }));
      return reply.status(201).send(present.leaveDto(leave));
    });

    scope.post("/staff/leaves/:id/approve", { preHandler: [...staffGate, kit.require(P.leaveDecide)] }, async (req, reply) => {
      const { id } = parse(attendanceIdParamsSchema, req.params);
      const b = parse(attendanceLeaveDecisionBodySchema, req.body);
      return present.leaveDto(unwrapOrThrow(await approveStaffLeave(deps, ctxOf(req), { leaveId: id, note: b.note, caps: await caps(req, reply, ["leaveDecide"]) })));
    });

    scope.post("/staff/leaves/:id/reject", { preHandler: [...staffGate, kit.require(P.leaveDecide)] }, async (req, reply) => {
      const { id } = parse(attendanceIdParamsSchema, req.params);
      const b = parse(attendanceLeaveRejectBodySchema, req.body);
      return present.leaveDto(unwrapOrThrow(await rejectStaffLeave(deps, ctxOf(req), { leaveId: id, note: b.note, caps: await caps(req, reply, ["leaveDecide"]) })));
    });

    scope.post("/staff/leaves/:id/cancel", { preHandler: [...staffGate, kit.anyOf(P.leaveRequest, P.leaveDecide, P.staffRecord)] }, async (req, reply) => {
      const { id } = parse(attendanceIdParamsSchema, req.params);
      const b = parse(attendanceLeaveDecisionBodySchema, req.body);
      return present.leaveDto(unwrapOrThrow(await cancelStaffLeave(deps, ctxOf(req), { leaveId: id, note: b.note, caps: await caps(req, reply, ["leaveDecide", "staffRecord"]) })));
    });

    // ===== Rapports ==========================================================================================
    scope.get("/reports/absences", { preHandler: kit.require(P.reportRead) }, async (req, reply) => {
      const q = parse(attendanceAbsencesQuerySchema, req.query);
      if (q.format === "csv") {
        const csv = unwrapOrThrow(await exportAbsencesCsv(deps, ctxOf(req), q));
        return reply
          .header("content-type", "text/csv; charset=utf-8")
          .header("content-disposition", 'attachment; filename="absences.csv"')
          .header("x-export-rows", String(csv.rows))
          .header("x-export-truncated", String(csv.truncated))
          .send(csv.csv);
      }
      const page = unwrapOrThrow(await listAbsencesReport(deps, ctxOf(req), q));
      return { items: page.items.map(present.absenceRowDto), nextCursor: page.nextCursor };
    });

    scope.get("/reports/call-compliance", { preHandler: kit.require(P.reportRead) }, async (req) => {
      const q = parse(attendanceComplianceQuerySchema, req.query);
      return unwrapOrThrow(await getCallCompliance(deps, ctxOf(req), q));
    });

    scope.get("/reports/staff-summary", { preHandler: [...staffGate, kit.anyOf(P.reportRead, P.staffRead)] }, async (req, reply) => {
      const q = parse(attendanceStaffSummaryQuerySchema, req.query);
      // `attendance.report.read` donne la même vue d'ensemble que `attendance.staff.read`.
      const broad = (await caps(req, reply, ["staffRead"])).staffRead === true || (await kit.has(scope, req, reply, P.reportRead));
      return unwrapOrThrow(await getStaffAttendanceSummary(deps, ctxOf(req), { ...q, caps: { staffRead: broad } }));
    });

    scope.get("/students/:id/certificate-data", { preHandler: kit.require(P.reportRead) }, async (req) => {
      const { id } = parse(attendanceIdParamsSchema, req.params);
      const q = parse(attendanceCertificateQuerySchema, req.query);
      const c = unwrapOrThrow(await getAttendanceCertificateData(deps, ctxOf(req), { studentId: id, periodId: q.periodId }));
      return { ...c };
    });

    // ===== Portails ==========================================================================================
    const portal = async (req: FastifyRequest, studentId: string, via: "child" | "self") => {
      const q = parse(attendancePortalQuerySchema, req.query);
      const r = unwrapOrThrow(await getStudentPortalView(deps, ctxOf(req), { studentId, via, ...q }));
      return {
        studentId: r.studentId,
        records: r.records.map(present.absenceRowDto),
        justifications: r.justifications.map(present.justificationDto),
        summary: r.summary ? present.summaryDto(r.summary) : null,
        nextCursor: r.nextCursor,
      };
    };

    scope.get("/me/attendance", { preHandler: kit.require(P.selfRead) }, async (req) => {
      const ctx = ctxOf(req);
      const studentId = ctx.userId ? await deps.ports.people.getStudentIdForUser(ctx, ctx.userId) : null;
      if (!studentId) throw new UnauthorizedError("Aucun profil d'élève n'est lié à votre compte.");
      return portal(req, studentId, "self");
    });

    scope.get("/children/:studentId/attendance", { preHandler: kit.require(P.childRead) }, async (req) => {
      const { studentId } = parse(attendanceChildParamsSchema, req.params);
      return portal(req, studentId, "child");
    });

    scope.get("/me/staff-attendance", { preHandler: [...staffGate, kit.require(P.ownRead)] }, async (req) => {
      const q = parse(attendanceListStaffRecordsQuerySchema, { from: "0001-01-01", to: "9999-12-31", ...(req.query as object) });
      const ctx = ctxOf(req);
      const records = unwrapOrThrow(await listStaffRecords(deps, ctx, { ...q, caps: {} }));
      const leaves = unwrapOrThrow(await listStaffLeaves(deps, ctx, { caps: {} }));
      return { records: records.items.map(present.staffRecordDto), leaves: leaves.items.map(present.leaveDto), nextCursor: records.nextCursor };
    });

    // ===== Paramétrage =======================================================================================
    const readRef = kit.anyOf(P.read, P.settingsManage);
    scope.get("/reference/status-definitions", { preHandler: readRef }, async (req) => ({ items: unwrapOrThrow(await listStatusDefinitions(deps, ctxOf(req))).map(present.statusDefinitionDto) }));
    scope.put("/reference/status-definitions", { preHandler: kit.require(P.settingsManage) }, async (req) =>
      present.statusDefinitionDto(unwrapOrThrow(await upsertStatusDefinition(deps, ctxOf(req), parse(attendanceUpsertStatusBodySchema, req.body)))),
    );
    scope.get("/reference/justification-reasons", { preHandler: readRef }, async (req) => ({ items: unwrapOrThrow(await listJustificationReasons(deps, ctxOf(req))).map(present.reasonDto) }));
    scope.put("/reference/justification-reasons", { preHandler: kit.require(P.settingsManage) }, async (req) =>
      present.reasonDto(unwrapOrThrow(await upsertJustificationReason(deps, ctxOf(req), parse(attendanceUpsertReasonBodySchema, req.body)))),
    );
    scope.get("/reference/leave-types", { preHandler: readRef }, async (req) => ({ items: unwrapOrThrow(await listLeaveTypeDefinitions(deps, ctxOf(req))).map(present.leaveTypeDto) }));
    scope.put("/reference/leave-types", { preHandler: kit.require(P.settingsManage) }, async (req) =>
      present.leaveTypeDto(unwrapOrThrow(await upsertLeaveTypeDefinition(deps, ctxOf(req), parse(attendanceUpsertLeaveTypeBodySchema, req.body)))),
    );
    // Politique d'appel : lisible aussi par qui peut faire l'appel (l'écran « Faire l'appel » masque les types d'appel interdits).
    scope.get("/reference/call-policies", { preHandler: kit.anyOf(P.read, P.settingsManage, P.take) }, async (req) => ({ items: unwrapOrThrow(await listCallPolicyDefinitions(deps, ctxOf(req))).map(present.callPolicyDto) }));
    scope.put("/reference/call-policies", { preHandler: kit.require(P.settingsManage) }, async (req) =>
      present.callPolicyDto(unwrapOrThrow(await upsertCallPolicy(deps, ctxOf(req), parse(attendanceUpsertCallPolicyBodySchema, req.body)))),
    );
    scope.get("/reference/settings", { preHandler: readRef }, async (req) => present.settingsDto(unwrapOrThrow(await getAttendanceSettings(deps, ctxOf(req)))));
    scope.put("/reference/settings", { preHandler: kit.require(P.settingsManage) }, async (req) =>
      present.settingsDto(unwrapOrThrow(await upsertAttendanceSettings(deps, ctxOf(req), parse(attendanceUpsertSettingsBodySchema, req.body)))),
    );
  });
}

// ---------------------------------------------------------------------------
// Contrat d'assemblage uniforme (platform/runtime.ts)
// ---------------------------------------------------------------------------

/** Instance RACINE : pose le registre de ports que les modules voisins renseignent (ordre de chargement indifférent). */
export function setup(app: FastifyInstance, _runtime: ModuleRuntime): void {
  if (!app.hasDecorator("attendancePorts")) app.decorate("attendancePorts", createPortRegistry());
}

/** Routes du module, SANS préfixe (le registre applique `/api/v1/attendance`). */
export default async function attendanceModulePlugin(app: FastifyInstance, runtime: ModuleRuntime): Promise<void> {
  if (!app.hasDecorator("attendancePorts")) app.decorate("attendancePorts", createPortRegistry());
  const deps = createAttendanceDeps({
    db: runtime.tenantDb,
    clock: runtime.clock,
    audit: attendanceAuditAdapter(runtime.auditPort),
    logger: runtime.logger,
    portsProvider: () => app.attendancePorts.current,
  });
  await app.register(attendancePlugin, {
    deps,
    requirePermission: (permission) => runtime.requirePermission(permission),
    requireFeature: (featureKey) => runtime.entitlements.requireFeature(featureKey),
    resolveContext: (request) => runtime.resolveContext(request),
  });
}

