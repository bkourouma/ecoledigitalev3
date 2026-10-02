/**
 * Incidents : un fait signalé (avant toute mesure). Circuit `DECLARED -> UNDER_REVIEW -> CONFIRMED | DISMISSED -> CLOSED`
 * (déclencheurs de la base). Le déclarant est l'utilisateur de la session ; l'élève n'est jamais fourni par le client :
 * il est dérivé de l'inscription (port `academic`). Un incident n'est jamais visible d'une famille (règle SQL).
 */
import { createHash } from "node:crypto";
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { SchoolLifeIncidentCreate, SchoolLifeIncidentDto, SchoolLifeInvolvementInput } from "@ecoledigitale/contracts/src/v2/schoollife";
import { confidentialityRank } from "../domain/confidentiality";
import { SchoolLifeEvents } from "../domain/events";
import { conflict, invalid, notFound, SchoolLifeCode } from "../domain/errors";
import { canTransition, INCIDENT_TRANSITIONS } from "../domain/machines";
import * as repo from "../infrastructure/incidents-repository";
import * as reference from "../infrastructure/reference-repository";
import type { IncidentRow } from "../infrastructure/rows";
import { safely, EventBuffer, inTx, requireHuman, todayOf, type CallerCaps, type SchoolLifeDeps } from "./deps";
import { actorNameOf, assertStudentScope, clampPage, loadTypes, resolveEnrollment, staffMaySee, studentNames, viewerOf } from "./support";
import type { EnrollmentInfo } from "./ports";
import { incidentDto } from "./views";

async function viewOf(deps: SchoolLifeDeps, ctx: RequestContext, tx: import("@ecoledigitale/database").Tx, rows: readonly IncidentRow[], caps: CallerCaps, options: { unmask?: boolean } = {}): Promise<SchoolLifeIncidentDto[]> {
  const involvements = await repo.listInvolvements(tx, rows.map((r) => r.id));
  const types = await loadTypes(tx, rows.map((r) => r.typeId));
  const names = await studentNames(deps, ctx, involvements.map((i) => i.studentId));
  return rows.map((r) => incidentDto(r, involvements, { types, names }, { unmask: options.unmask === true, showStatements: caps.incidentReview === true }));
}

/** Empreinte du CONTENU d'une saisie (hors clé) : détecte la réutilisation d'une clé d'idempotence avec une autre saisie. */
export function incidentFingerprint(input: SchoolLifeIncidentCreate): string {
  const { clientKey: _ignored, ...content } = input;
  const canonical = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, canonical(x)])) : v;
  return createHash("sha256").update(JSON.stringify(canonical({ ...content, occurredAt: new Date(content.occurredAt).toISOString() }))).digest("hex");
}

export async function declareIncident(
  deps: SchoolLifeDeps,
  ctx: RequestContext,
  caps: CallerCaps,
  input: SchoolLifeIncidentCreate,
  options: { onReplay?: () => void } = {},
): Promise<Result<SchoolLifeIncidentDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    // Rejeu d'une saisie rapide (clé d'idempotence) : sérialisé par (déclarant, clé), puis l'incident déjà créé est renvoyé tel quel.
    const fingerprint = input.clientKey ? incidentFingerprint(input) : null;
    if (input.clientKey) {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`schoollife.incident:${ctx.tenantId}:${human.value}:${input.clientKey}`]);
      const previous = await repo.findIncidentByClientKey(tx, human.value, input.clientKey);
      if (previous) {
        if (previous.fingerprint !== fingerprint) return err(conflict(SchoolLifeCode.IDEMPOTENCY_KEY_REUSED, "Cette clé de saisie a déjà servi pour un autre contenu.", { clientKey: input.clientKey }));
        const existing = (await repo.getIncident(tx, previous.id)) as IncidentRow;
        options.onReplay?.();
        return ok((await viewOf(deps, ctx, tx, [existing], caps, { unmask: true }))[0] as SchoolLifeIncidentDto);
      }
    }
    const reporterName = await actorNameOf(deps, ctx);
    const type = (await loadTypes(tx, [input.typeId])).get(input.typeId);
    if (!type) return err(notFound(SchoolLifeCode.TYPE_NOT_FOUND, "Type d'événement", input.typeId));
    if (type.kind !== "INCIDENT" || !type.active) return err(invalid(SchoolLifeCode.TYPE_INACTIVE, "Le type choisi n'est pas un type d'incident actif.", "typeId"));

    // Élèves impliqués : dérivés des inscriptions, dans le périmètre de l'appelant, d'un même établissement et d'une même année.
    const enrollments: EnrollmentInfo[] = [];
    for (const v of input.involvements) {
      const e = await resolveEnrollment(deps, ctx, caps, v.enrollmentId);
      if (!e.ok) return e;
      enrollments.push(e.value);
    }
    const institutionId = enrollments[0]?.institutionId ?? (input.institutionId as string);
    const academicYearId = enrollments[0]?.academicYearId ?? (input.academicYearId as string);
    if (enrollments.some((e) => e.institutionId !== institutionId || e.academicYearId !== academicYearId)) {
      return err(invalid(SchoolLifeCode.INVALID_INPUT, "Les élèves impliqués doivent relever du même établissement et de la même année.", "involvements"));
    }
    if (input.involvements.length === 0 && !caps.readAll) return err(invalid(SchoolLifeCode.INVALID_INPUT, "Désignez au moins un élève de vos classes.", "involvements"));

    const confidentiality = input.confidentiality ?? type.confidentialityDefault;
    if (confidentialityRank(confidentiality) < confidentialityRank(type.confidentialityDefault)) {
      return err(invalid(SchoolLifeCode.INVALID_INPUT, `La confidentialité ne peut pas être inférieure à celle du type (${type.confidentialityDefault}).`, "confidentiality"));
    }
    const severityCode = input.severityCode ?? type.defaultSeverityCode ?? null;
    if (severityCode && !(await reference.getSeverityByCode(tx, severityCode))) return err(invalid(SchoolLifeCode.INVALID_REFERENCE, "Ce niveau de gravité n'existe pas.", "severityCode"));

    const id = deps.newId();
    await repo.insertIncident(tx, {
      id,
      tenantId: ctx.tenantId,
      institutionId,
      academicYearId,
      typeId: type.id,
      severityCode,
      occurredAt: new Date(input.occurredAt),
      location: input.location ?? null,
      description: input.description,
      contextNote: input.contextNote ?? null,
      confidentiality,
      reportedBy: human.value,
      reportedByName: reporterName,
      attendanceSessionId: input.attendanceSessionId ?? null,
      clientKey: input.clientKey ?? null,
      clientFingerprint: fingerprint,
    });
    for (const [i, v] of input.involvements.entries()) {
      const e = enrollments[i] as EnrollmentInfo;
      await repo.insertInvolvement(tx, { id: deps.newId(), tenantId: ctx.tenantId, incidentId: id, enrollmentId: e.enrollmentId, studentId: e.studentId, role: v.role, statement: v.statement ?? null });
    }
    const events = new EventBuffer(deps, ctx);
    events.add(SchoolLifeEvents.INCIDENT_DECLARED, { v: 1, incidentId: id, typeId: type.id, status: "DECLARED", confidentiality, studentIds: enrollments.map((e) => e.studentId) }, { type: "schoollife.incident", id });
    events.audit({ action: "schoollife.incident.declared", resourceType: "incident", resourceId: id, sensitive: confidentiality !== "STANDARD", after: { typeId: type.id, confidentiality, students: enrollments.length } });
    await events.flush(tx);
    const row = (await repo.getIncident(tx, id)) as IncidentRow;
    return ok((await viewOf(deps, ctx, tx, [row], caps))[0] as SchoolLifeIncidentDto);
  });
}

export async function addInvolvement(deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, incidentId: string, input: SchoolLifeInvolvementInput): Promise<Result<SchoolLifeIncidentDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const incident = await repo.getIncident(tx, incidentId, { lock: true });
    if (!incident || !staffMaySee(viewerOf(caps), "INCIDENT", incident.confidentiality, incident.status)) return err(notFound(SchoolLifeCode.NOT_FOUND, "Incident", incidentId));
    const e = await resolveEnrollment(deps, ctx, caps, input.enrollmentId);
    if (!e.ok) return e;
    if (e.value.institutionId !== incident.institutionId || e.value.academicYearId !== incident.academicYearId) {
      return err(invalid(SchoolLifeCode.INVALID_INPUT, "L'élève relève d'un autre établissement ou d'une autre année que l'incident.", "enrollmentId"));
    }
    await repo.insertInvolvement(tx, { id: deps.newId(), tenantId: ctx.tenantId, incidentId, enrollmentId: e.value.enrollmentId, studentId: e.value.studentId, role: input.role, statement: input.statement ?? null });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "schoollife.incident.involvement_added", resourceType: "incident", resourceId: incidentId, after: { role: input.role, studentId: e.value.studentId } });
    await events.flush(tx);
    return ok((await viewOf(deps, ctx, tx, [incident], caps))[0] as SchoolLifeIncidentDto);
  });
}

type IncidentTarget = "UNDER_REVIEW" | "CONFIRMED" | "DISMISSED" | "CLOSED";

async function transitionIncident(
  deps: SchoolLifeDeps,
  ctx: RequestContext,
  caps: CallerCaps,
  incidentId: string,
  to: IncidentTarget,
  patch: { assignedTo?: string | null; resolutionNote?: string | null },
): Promise<Result<SchoolLifeIncidentDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const incident = await repo.getIncident(tx, incidentId, { lock: true });
    // Hors habilitation : introuvable (l'existence d'un élément RESTRICTED / CONFIDENTIAL n'est pas divulguée).
    if (!incident || !staffMaySee(viewerOf(caps), "INCIDENT", incident.confidentiality, incident.status)) return err(notFound(SchoolLifeCode.NOT_FOUND, "Incident", incidentId));
    if (!canTransition(INCIDENT_TRANSITIONS, incident.status, to)) {
      return err(invalid(SchoolLifeCode.INVALID_STATE, `Un incident ${incident.status} ne peut pas passer à ${to}.`));
    }
    await repo.updateIncident(tx, incidentId, { status: to, ...patch });
    const updated = (await repo.getIncident(tx, incidentId)) as IncidentRow;
    const involvements = await repo.listInvolvements(tx, [incidentId]);
    const events = new EventBuffer(deps, ctx);
    events.add(SchoolLifeEvents.INCIDENT_STATUS_CHANGED, { v: 1, incidentId, typeId: incident.typeId, status: to, fromStatus: incident.status, confidentiality: incident.confidentiality, studentIds: involvements.map((i) => i.studentId) }, { type: "schoollife.incident", id: incidentId });
    events.audit({ action: "schoollife.incident.status_changed", resourceType: "incident", resourceId: incidentId, sensitive: to === "DISMISSED" || to === "CLOSED", before: { status: incident.status }, after: { status: to } });
    await events.flush(tx);
    return ok((await viewOf(deps, ctx, tx, [updated], caps))[0] as SchoolLifeIncidentDto);
  });
}

export const reviewIncident = (deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, id: string, input: { assignedTo?: string | undefined }): Promise<Result<SchoolLifeIncidentDto, AppError>> =>
  transitionIncident(deps, ctx, caps, id, "UNDER_REVIEW", { assignedTo: input.assignedTo ?? ctx.userId });
export const confirmIncident = (deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, id: string): Promise<Result<SchoolLifeIncidentDto, AppError>> => transitionIncident(deps, ctx, caps, id, "CONFIRMED", {});
export const dismissIncident = (deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, id: string, input: { resolutionNote: string }): Promise<Result<SchoolLifeIncidentDto, AppError>> =>
  transitionIncident(deps, ctx, caps, id, "DISMISSED", { resolutionNote: input.resolutionNote });
export const closeIncident = (deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, id: string, input: { resolutionNote: string }): Promise<Result<SchoolLifeIncidentDto, AppError>> =>
  transitionIncident(deps, ctx, caps, id, "CLOSED", { resolutionNote: input.resolutionNote });

/** La confidentialité s'ÉLÈVE (jamais ne s'abaisse : refus de la base `confidentiality_lowered`). */
export async function raiseIncidentConfidentiality(deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, incidentId: string, confidentiality: "STANDARD" | "RESTRICTED" | "CONFIDENTIAL"): Promise<Result<SchoolLifeIncidentDto, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  return inTx(deps, ctx, async (tx) => {
    const incident = await repo.getIncident(tx, incidentId, { lock: true });
    if (!incident || !staffMaySee(viewerOf(caps), "INCIDENT", incident.confidentiality, incident.status)) return err(notFound(SchoolLifeCode.NOT_FOUND, "Incident", incidentId));
    await repo.updateIncident(tx, incidentId, { confidentiality });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "schoollife.incident.confidentiality_raised", resourceType: "incident", resourceId: incidentId, sensitive: true, before: { confidentiality: incident.confidentiality }, after: { confidentiality } });
    await events.flush(tx);
    const updated = (await repo.getIncident(tx, incidentId)) as IncidentRow;
    return ok((await viewOf(deps, ctx, tx, [updated], caps))[0] as SchoolLifeIncidentDto);
  });
}

export interface ListIncidentsInput {
  status?: string | undefined;
  studentId?: string | undefined;
  classroomId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  page: number;
  pageSize: number;
}

export function listIncidentsView(deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, input: ListIncidentsInput): Promise<Result<SchoolLifeIncidentDto[], AppError>> {
  return safely(async () => {
  const viewer = viewerOf(caps);
  const { limit, offset } = clampPage(input.page, input.pageSize);
  let enrollmentIds: string[] | undefined;
  let reportedBy: string | undefined;
  if (input.studentId) {
    const scope = await assertStudentScope(deps, ctx, caps, input.studentId);
    if (!scope.ok) return scope;
  } else if (input.classroomId) {
    if (!viewer.readAll && !(ctx.userId && (await deps.ports.people.isStaffAssignedToClassroom(ctx, ctx.userId, input.classroomId)))) return ok([]);
    enrollmentIds = (await deps.ports.enrollments.getRoster(ctx, input.classroomId, todayOf(deps))).map((r) => r.enrollmentId);
  } else if (!viewer.readAll) {
    // Sans portée générale : seulement ses propres déclarations.
    reportedBy = ctx.userId ?? undefined;
  }
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const rows = await repo.listIncidents(tx, { audience: viewer.audience, status: input.status, studentId: input.studentId, enrollmentIds, from: input.from, to: input.to, reportedBy, limit, offset });
      return ok(await viewOf(deps, ctx, tx, rows, caps));
    },
    { readOnly: true },
  );
  });
}

export function getIncidentView(deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, id: string): Promise<Result<SchoolLifeIncidentDto, AppError>> {
  return safely(async () => {
  const viewer = viewerOf(caps);
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const row = await repo.getIncident(tx, id);
      if (!row || !staffMaySee(viewer, "INCIDENT", row.confidentiality, row.status)) return err(notFound(SchoolLifeCode.NOT_FOUND, "Incident", id));
      if (!viewer.readAll && row.reportedBy !== ctx.userId) {
        // Sans portée générale : un incident de ses classes seulement.
        const involved = await repo.listInvolvements(tx, [id]);
        let allowed = false;
        for (const v of involved) if (await deps.ports.people.staffCanReadStudent(ctx, v.studentId)) allowed = true;
        if (!allowed) return err(notFound(SchoolLifeCode.NOT_FOUND, "Incident", id));
      }
      return ok((await viewOf(deps, ctx, tx, [row], caps))[0] as SchoolLifeIncidentDto);
    },
    { readOnly: true },
  );
  });
}
