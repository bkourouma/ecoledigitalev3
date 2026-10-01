/**
 * scheduling -> payroll : `HoursSourcePort` d'origine SESSION (séances réalisées ET validées, gel des heures à l'arrêt du
 * bulletin) ;
 * attendance (+ scheduling) -> payroll : `HoursSourcePort` d'origine ATTENDANCE (présences du personnel terminées, rattachées
 * à leur séance quand elle existe pour hériter du nœud de curriculum, donc du tarif).
 *
 * Contrat (voir `payroll/application/ports.ts`) : un fournisseur qui ne sait renvoyer que du payable
 * (`scheduling.listPayableHours` : HELD ∧ validée ∧ rôle rémunéré) marque ses faits `realized` et `validated` ; la paie
 * applique elle-même le prédicat unique de payabilité. `lock` / `release` sont ATOMIQUES : un refus de gel (heure déjà
 * réclamée par un autre bulletin) LÈVE, ce qui empêche l'arrêt du bulletin.
 */
import type { AppError, RequestContext } from "@ecoledigitale/kernel";
import { listCompletedStaffPresence, type AttendanceDeps } from "../../modules/attendance";
import { getOccurrence, listPayableHours, lockHours, releaseHoursLock, type SchedulingDeps } from "../../modules/scheduling";
import type { HoursSourcePort } from "../../modules/payroll";

export class PayrollSourceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PayrollSourceError";
  }
}

function throwOf(error: AppError): never {
  throw Object.assign(new PayrollSourceError(error.code, error.message), { cause: error });
}

export function createPayrollSessionHours(scheduling: SchedulingDeps): HoursSourcePort {
  return {
    kind: "SESSION",
    async collect(ctx: RequestContext, query) {
      const r = await listPayableHours(scheduling, ctx, { from: query.from, to: query.to, ...(query.staffIds ? { staffIds: [...query.staffIds] } : {}) });
      if (!r.ok) throwOf(r.error);
      return r.value.map((l) => ({
        kind: "SESSION" as const,
        refId: l.occurrenceId,
        staffId: l.staffId,
        date: l.occursOn,
        startTime: null,
        endTime: null,
        durationMinutes: l.minutes,
        paidMinutesOverride: null,
        realized: true,
        validated: true,
        nodeId: l.nodeId,
        classroomId: l.classroomId,
        label: l.title,
        code: null,
        classroomLabel: null,
      }));
    },
    async lock(ctx: RequestContext, input) {
      const r = await lockHours(scheduling, ctx, { lockRef: input.lockRef, lines: input.lines.map((l) => ({ occurrenceId: l.refId, staffId: l.staffId })) });
      if (!r.ok) throwOf(r.error);
    },
    async release(ctx: RequestContext, input) {
      const r = await releaseHoursLock(scheduling, ctx, { lockRef: input.lockRef });
      if (!r.ok) throwOf(r.error);
    },
  };
}

export function createPayrollAttendanceHours(attendance: AttendanceDeps, scheduling: SchedulingDeps): HoursSourcePort {
  return {
    kind: "ATTENDANCE",
    async collect(ctx: RequestContext, query) {
      const r = await listCompletedStaffPresence(attendance, ctx, { from: query.from, to: query.to, ...(query.staffIds ? { staffIds: [...query.staffIds] } : {}) });
      if (!r.ok) throwOf(r.error);
      const facts = [];
      for (const p of r.value) {
        // Séance liée : le nœud et la classe de la séance déterminent le tarif ; sinon présence journalière (tarif par défaut).
        const occurrence = p.occurrenceId ? await getOccurrence(scheduling, ctx, { occurrenceId: p.occurrenceId }) : null;
        const o = occurrence && occurrence.ok ? occurrence.value : null;
        facts.push({
          kind: "ATTENDANCE" as const,
          refId: p.attendanceId,
          staffId: p.staffId,
          date: p.date,
          startTime: null,
          endTime: null,
          durationMinutes: p.durationMinutes,
          paidMinutesOverride: null,
          realized: true,
          validated: true,
          nodeId: o?.curriculumNodeId ?? null,
          classroomId: o?.classroomId ?? null,
          label: o?.title ?? null,
          code: null,
          classroomLabel: null,
        });
      }
      return facts;
    },
  };
}
