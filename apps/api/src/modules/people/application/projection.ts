/**
 * Projections alimentées par événements : inscriptions (`academic.enrollment.*` → `student_enrollment_summaries`) et accès
 * IAM (`iam.membership.*` → `identity_memberships`). Les fonctions `apply*` reçoivent la transaction de l'abonné idempotent
 * du worker ; elles sont insensibles à l'ordre de livraison (horodatage de l'événement) et rejouables.
 */
import { err, ok, ValidationError, type AppError, type DomainEvent, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { isEnrollmentEvent, parseEnrollmentPayload, statusForEvent } from "../domain/enrollment-projection";
import { PeopleErrors } from "../domain/errors";
import { deleteAllEnrollmentSummaries, getMembership, snapshotEnrollmentSummaries, studentExists, upsertEnrollmentSummary, upsertMembership } from "../infrastructure/projection-repo";
import { setFirstEnrolledOn } from "../infrastructure/students-repo";
import { inTx, type PeopleDeps } from "./deps";

export type ProjectionOutcome = "applied" | "ignored_old" | "ignored_unusable" | "ignored_unknown_student";

/** Applique un événement `academic.enrollment.*` à la projection. N'écrit jamais dans le schéma d'academic. */
export async function applyEnrollmentEvent(deps: PeopleDeps, tx: Tx, event: DomainEvent): Promise<ProjectionOutcome> {
  if (!isEnrollmentEvent(event.type)) return "ignored_unusable";
  const facts = parseEnrollmentPayload(event.payload);
  if (!facts) return "ignored_unusable";
  if (!(await studentExists(tx, event.tenantId, facts.studentId))) {
    deps.logger.warn({ eventId: event.id, type: event.type }, "people : inscription d'un élève inconnu, événement ignoré");
    return "ignored_unknown_student";
  }
  const occurredAt = new Date(event.occurredAt);
  const result = await upsertEnrollmentSummary(tx, event.tenantId, facts, { status: statusForEvent(event.type, facts.status), eventId: event.id, occurredAt });
  if (!result.applied) return "ignored_old";
  if (facts.enrolledOn) await setFirstEnrolledOn(tx, event.tenantId, facts.studentId, facts.enrolledOn);
  return "applied";
}

export interface MembershipEventPayload {
  identityId?: unknown;
  membershipId?: unknown;
  roles?: unknown;
  status?: unknown;
  after?: { status?: unknown; roles?: unknown } | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ["active", "suspended", "revoked", "invited"] as const;

/** Applique `iam.membership.created|changed` à la projection des accès (liaison identité <-> personne). */
export async function applyMembershipEvent(tx: Tx, event: DomainEvent): Promise<ProjectionOutcome> {
  const p = (event.payload ?? {}) as MembershipEventPayload;
  if (typeof p.identityId !== "string" || !UUID_RE.test(p.identityId)) return "ignored_unusable";
  const rawStatus = event.type.endsWith(".changed") ? (p.after?.status ?? p.status) : p.status;
  const status = typeof rawStatus === "string" && (STATUSES as readonly string[]).includes(rawStatus) ? (rawStatus as (typeof STATUSES)[number]) : "unknown";
  const rawRoles = event.type.endsWith(".changed") ? (p.after?.roles ?? p.roles) : p.roles;
  const roles = Array.isArray(rawRoles) ? rawRoles.filter((r): r is string => typeof r === "string") : null;
  const membershipId = typeof p.membershipId === "string" && UUID_RE.test(p.membershipId) ? p.membershipId : null;
  const applied = await upsertMembership(tx, event.tenantId, { identityId: p.identityId, membershipId, status, roles }, event.id, new Date(event.occurredAt));
  return applied ? "applied" : "ignored_old";
}

/**
 * Reconstruit la projection d'inscriptions depuis academic (`AcademicQuery.listEnrollmentsByStudent`) : supprime puis
 * réécrit, dans UNE transaction. Renvoie si le résultat est identique à l'état précédent (test de comparaison).
 */
export async function rebuildEnrollmentProjection(deps: PeopleDeps, ctx: RequestContext, options: { yearId?: string | undefined } = {}): Promise<Result<{ students: number; enrollments: number; identical: boolean }, AppError>> {
  const academic = deps.academic;
  if (!academic?.listEnrollmentsByStudent) return err(PeopleErrors.academicUnavailable());
  const listEnrollments = academic.listEnrollmentsByStudent.bind(academic);
  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const before = await snapshotEnrollmentSummaries(tx, ctx.tenantId);
    await deleteAllEnrollmentSummaries(tx, ctx.tenantId, { academicYearId: options.yearId });
    const students = await tx.many<{ id: string }>(`SELECT id FROM people.students WHERE tenant_id = $1 ORDER BY id`, [ctx.tenantId]);
    let enrollments = 0;
    for (const s of students) {
      for (const e of await listEnrollments(ctx, s.id)) {
        if (options.yearId && e.academicYearId !== options.yearId) continue;
        const r = await upsertEnrollmentSummary(
          tx,
          ctx.tenantId,
          {
            enrollmentId: e.enrollmentId,
            studentId: s.id,
            academicYearId: e.academicYearId,
            institutionId: e.institutionId,
            classroomId: e.classroomId,
            classroomName: e.classroomName ?? null,
            mode: e.mode ?? "CLASS",
            fundingType: e.fundingType ?? "PRIVATE",
            registrationNumber: e.registrationNumber ?? null,
            enrolledOn: e.enrolledOn,
          },
          { status: e.status, eventId: deps.newId(), occurredAt: now },
        );
        if (r.applied) {
          enrollments += 1;
          await setFirstEnrolledOn(tx, ctx.tenantId, s.id, e.enrolledOn);
        }
      }
    }
    const after = await snapshotEnrollmentSummaries(tx, ctx.tenantId);
    return ok({ students: students.length, enrollments, identical: JSON.stringify(before) === JSON.stringify(after) });
  });
}

/** État de l'accès IAM d'une identité d'après la projection (`null` si inconnue). */
export async function getMembershipStatus(deps: PeopleDeps, ctx: RequestContext, identityId: string): Promise<string | null> {
  return deps.db.run(ctx, async (tx) => (await getMembership(tx, ctx.tenantId, identityId))?.status ?? null, { readOnly: true });
}

void ValidationError;
