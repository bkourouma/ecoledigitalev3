/**
 * Confirmation d'une inscription et de ses cours par ÉVÉNEMENTS (décision métier validée) :
 *
 *  - `finance.invoice.paid` : confirmation AUTOMATIQUE de l'inscription VISÉE par la facture après paiement des frais
 *    d'inscription (politiques `ON_REGISTRATION_FEE_PAID` / `ON_FULL_PAYMENT`), jamais de « toutes les inscriptions en
 *    attente de l'étudiant » (bugs legacy P-081 / P-089) ; un cours à la carte est confirmé une fois SA ligne soldée
 *    (`sourceRef = enrollmentCourseId`, politique `ON_LINE_PAID`), l'inscription devant être active (sinon le solde est
 *    mémorisé et le cours est confirmé dès que l'inscription l'est) ;
 *  - `people.student.status_changed` : retrait automatique des inscriptions vivantes d'un apprenant sorti.
 *
 * Idempotent par construction (les états sont testés) en plus de l'idempotence par `event.id` du worker.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { AcademicConsumedInvoicePaid, AcademicConsumedStudentStatusChanged } from "@ecoledigitale/contracts/src/v2/academic";
import { STUDENT_STATUSES_THAT_WITHDRAW, courseConfirmationPolicyFor, decideCourseOnLinePaid, invoicePaidConfirmsEnrollment } from "../domain/enrollment";
import { AcademicEvents } from "../domain/events";
import type { Enrollment, EnrollmentCourse } from "../domain/records";
import * as enr from "../infrastructure/enrollment-repository";
import * as cur from "../infrastructure/curriculum-repository";
import { REGISTRATION_FEE_CATEGORY } from "./ports";
import { confirmCourseInTxWithReinstate } from "./courses";
import { EventBuffer, inTx, type AcademicDeps } from "./deps";
import { coursePayload, writeHistory } from "./enrollment-core";
import { transitionEnrollmentInTx } from "./enrollments";
import { loadSettings } from "./reference";

export interface InvoicePaidReport {
  enrollmentConfirmed: string | null;
  coursesConfirmed: string[];
  coursesRemembered: string[];
  coursesReinstated: string[];
  orphans: string[];
  ignored: boolean;
}

/** Faits de la facture : charge utile enrichie par finance, sinon lecture via le port `InvoiceFactsReader`. */
async function factsOf(deps: AcademicDeps, ctx: RequestContext, payload: AcademicConsumedInvoicePaid): Promise<{ enrollmentId: string | null; containsRegistrationFee: boolean | null; sourceRefs: string[] } | null> {
  let enrollmentId = payload.enrollmentId ?? null;
  let containsRegistrationFee: boolean | null = payload.containsRegistrationFee ?? null;
  let sourceRefs = (payload.sourceRefs ?? []).map((s) => s.sourceRef);
  const enriched = payload.enrollmentId !== undefined || payload.sourceRefs !== undefined || payload.containsRegistrationFee !== undefined;
  if (!enriched) {
    const facts = await deps.ports.invoiceFacts.getInvoiceFacts(ctx, payload.invoiceId);
    if (!facts) return null;
    enrollmentId = facts.enrollmentId;
    containsRegistrationFee = facts.lines.some((l) => l.category === REGISTRATION_FEE_CATEGORY);
    sourceRefs = facts.lines.map((l) => l.sourceRef).filter((s): s is string => s !== null);
  }
  return { enrollmentId, containsRegistrationFee, sourceRefs };
}

export async function handleInvoicePaid(deps: AcademicDeps, ctx: RequestContext, payload: AcademicConsumedInvoicePaid): Promise<Result<InvoicePaidReport, AppError>> {
  const facts = await factsOf(deps, ctx, payload);
  const report: InvoicePaidReport = { enrollmentConfirmed: null, coursesConfirmed: [], coursesRemembered: [], coursesReinstated: [], orphans: [], ignored: false };
  if (!facts || (facts.enrollmentId === null && facts.sourceRefs.length === 0)) {
    report.ignored = true;
    return ok(report);
  }
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    let enrollment: Enrollment | null = null;

    // 1. L'inscription visée (et elle seule).
    if (facts.enrollmentId) {
      enrollment = await enr.getEnrollment(tx, facts.enrollmentId, { forUpdate: true });
      if (enrollment) {
        const settings = await loadSettings(tx, enrollment.institutionId);
        if (invoicePaidConfirmsEnrollment(settings.enrollmentConfirmationPolicy, { enrollmentId: facts.enrollmentId, containsRegistrationFee: facts.containsRegistrationFee }, enrollment.status)) {
          const confirmed = await transitionEnrollmentInTx(deps, ctx, tx, events, enrollment, "confirm", facts.containsRegistrationFee ? "frais d'inscription soldés" : "facture d'inscription soldée");
          if (!confirmed.ok) return confirmed;
          enrollment = confirmed.value;
          report.enrollmentConfirmed = enrollment.id;
        }
      }
    }

    // 2. Les lignes de cours soldées (`sourceRef` = identifiant de la sélection).
    for (const ref of facts.sourceRefs) {
      const course = await enr.getCourse(tx, ref, { forUpdate: true });
      if (!course) continue; // la ligne n'est pas une sélection de cours (ex. frais d'inscription)
      const owner = course.enrollmentId === enrollment?.id ? enrollment : await enr.getEnrollment(tx, course.enrollmentId, { forUpdate: true });
      if (!owner) continue;
      const settings = await loadSettings(tx, owner.institutionId);
      const policy = courseConfirmationPolicyFor(course.source, settings.courseConfirmationPolicy);
      const decision = decideCourseOnLinePaid(policy, course.status, owner.status);
      if (decision === "ignore") continue;
      if (decision === "remember_payment") {
        await enr.markCourseLinePaid(tx, course.id);
        report.coursesRemembered.push(course.id);
        continue;
      }
      if (decision === "confirm") {
        const r = await confirmCourseInTxWithReinstate(deps, ctx, tx, events, course, owner, `ligne soldée (facture ${payload.invoiceId})`);
        if (!r.ok) return r;
        if (r.value.kind === "orphan") await recordOrphan(deps, ctx, tx, events, owner, course, payload.invoiceId, report);
        else (r.value.kind === "reinstated" ? report.coursesReinstated : report.coursesConfirmed).push(r.value.course.id);
        continue;
      }
      // Sélection déjà annulée (réservation expirée entre deux écrans) : rétablie si la place existe encore.
      if (owner.status === "ACTIVE" || owner.status === "COMPLETED") {
        const r = await confirmCourseInTxWithReinstate(deps, ctx, tx, events, course, owner, `ligne soldée après expiration (facture ${payload.invoiceId})`);
        if (!r.ok) return r;
        if (r.value.kind === "orphan") await recordOrphan(deps, ctx, tx, events, owner, course, payload.invoiceId, report);
        else report.coursesReinstated.push(r.value.course.id);
      } else {
        await recordOrphan(deps, ctx, tx, events, owner, course, payload.invoiceId, report);
      }
    }
    await events.flush(tx);
    return ok(report);
  });
}

async function recordOrphan(deps: AcademicDeps, ctx: RequestContext, tx: Tx, events: EventBuffer, enrollment: Enrollment, course: EnrollmentCourse, invoiceId: string, report: InvoicePaidReport): Promise<void> {
  const node = await cur.getNode(tx, course.curriculumNodeId);
  await writeHistory(deps, ctx, tx, enrollment.id, { kind: "COURSE", from: { courseId: course.id, status: course.status }, to: { courseId: course.id, paymentOrphan: true, invoiceId }, reason: "paiement reçu sans place disponible" });
  events.add(
    AcademicEvents.COURSE_PAYMENT_ORPHAN,
    { ...coursePayload(enrollment, course, node, null), invoiceId, reason: "Paiement reçu pour une sélection dont la place n'est plus disponible : remboursement ou réaffectation à décider." },
    { type: "enrollment_course", id: course.id },
  );
  report.orphans.push(course.id);
}

// ---------------------------------------------------------------------------
// people.student.status_changed -> retrait automatique des inscriptions vivantes
// ---------------------------------------------------------------------------

export async function handleStudentStatusChanged(deps: AcademicDeps, ctx: RequestContext, payload: AcademicConsumedStudentStatusChanged): Promise<Result<{ withdrawn: string[] }, AppError>> {
  if (!STUDENT_STATUSES_THAT_WITHDRAW.includes(payload.status)) return ok({ withdrawn: [] });
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const withdrawn: string[] = [];
    for (const e of await enr.listLiveEnrollmentsOfStudent(tx, payload.studentId)) {
      const locked = (await enr.getEnrollment(tx, e.id, { forUpdate: true })) as Enrollment;
      const reason = `statut apprenant : ${payload.status}${payload.reason ? ` (${payload.reason})` : ""}`;
      // Un départ vers un autre établissement se note TRANSFERRED_OUT ; une inscription pas encore active est simplement retirée.
      const toTransferred = payload.status === "TRANSFERRED_OUT" && (locked.status === "ACTIVE" || locked.status === "SUSPENDED");
      const r = await transitionEnrollmentInTx(deps, ctx, tx, events, locked, "withdraw", reason, toTransferred ? { toStatus: "TRANSFERRED_OUT" } : {});
      if (!r.ok) return err(r.error);
      withdrawn.push(e.id);
    }
    await events.flush(tx);
    return ok({ withdrawn });
  });
}
