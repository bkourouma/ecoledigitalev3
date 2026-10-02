/**
 * Ports de stateassign : implémentations EN MÉMOIRE (tests, développement) et implémentations « indisponibles » (échec fermé).
 *
 *  - `unavailablePorts()` : par défaut, tant que la plateforme n'a rien branché. Les lectures de décoration (noms) renvoient
 *    vide, la tutelle refuse tout, la passerelle est `NotConfigured` (aucun appel externe n'existe en V1) ; tout le reste LÈVE
 *    `stateassign.port_unavailable`.
 *  - `InMemoryWorld` : un monde de test (inscriptions, périodes, facturation, présence, documents, noms, tutelle).
 */
import { Money, err, ok, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { StateassignCode, portUnavailable } from "../domain/errors";
import type {
  AttendanceFacts,
  AttendanceFactsPort,
  DocumentReadCaps,
  DocumentRefPort,
  EnrollmentFacts,
  EnrollmentFundingPort,
  EnrollmentPort,
  FinancePort,
  GatewayAssignment,
  GatewayRefusal,
  GuardianshipPort,
  PeriodFacts,
  SetFundingInput,
  StateFundingBilling,
  StateGateway,
  StateassignPorts,
  StudentNamesPort,
} from "../application/ports";
import type { Uuid } from "../domain/types";

// ---------------------------------------------------------------------------
// Passerelle : adaptateur NotConfigured EXPLICITE
// ---------------------------------------------------------------------------

const NOT_CONFIGURED: GatewayRefusal = Object.freeze({
  code: StateassignCode.GATEWAY_NOT_CONFIGURED,
  message: "Aucune passerelle vers une plateforme publique d'affectation n'est configurée : saisie et import manuels uniquement.",
});

/** Adaptateur par défaut : répond « non disponible », n'appelle RIEN à l'extérieur. */
export const NotConfiguredGateway: StateGateway = Object.freeze({
  adapter: "NotConfigured",
  status: () => ({ configured: false, message: NOT_CONFIGURED.message }),
  async fetchAssignment(): Promise<Result<GatewayAssignment, GatewayRefusal>> {
    return err(NOT_CONFIGURED);
  },
  async pushAttendanceCertificate(): Promise<Result<{ externalRef: string }, GatewayRefusal>> {
    return err(NOT_CONFIGURED);
  },
});

// ---------------------------------------------------------------------------
// Échec fermé
// ---------------------------------------------------------------------------

const unavailable = (name: string) => async (): Promise<never> => {
  throw portUnavailable(name);
};

export function unavailablePorts(): StateassignPorts {
  return {
    enrollments: { getEnrollment: unavailable("academic"), listPeriods: unavailable("academic") },
    funding: { setStateAssignedFunding: unavailable("academic") },
    finance: { getStateFundingBilling: unavailable("finance") },
    attendance: { getFacts: unavailable("attendance") },
    documents: { exists: unavailable("documents") },
    students: { names: async () => new Map() },
    guardianship: {
      async studentIdForUser() {
        return null;
      },
      async isGuardianOf() {
        return false;
      },
      async childrenOf() {
        return [];
      },
    },
    gateway: NotConfiguredGateway,
  };
}

// ---------------------------------------------------------------------------
// Monde en mémoire
// ---------------------------------------------------------------------------

export class InMemoryWorld implements StateassignPorts {
  readonly enrollmentsById = new Map<Uuid, EnrollmentFacts>();
  readonly periodsByYear = new Map<Uuid, PeriodFacts[]>();
  readonly billingByEnrollment = new Map<Uuid, StateFundingBilling>();
  readonly attendanceByKey = new Map<string, AttendanceFacts>();
  readonly documentIds = new Set<Uuid>();
  readonly studentNames = new Map<Uuid, string>();
  readonly ownStudent = new Map<string, Uuid>();
  readonly links = new Map<string, Set<Uuid>>();
  /** Refus programmable d'`academic` (par exemple financement non autorisé). */
  fundingRefusal: { code: string; message: string } | null = null;
  readonly fundingCalls: SetFundingInput[] = [];
  billingFails = false;

  addEnrollment(e: Partial<EnrollmentFacts> & { enrollmentId: Uuid; studentId: Uuid; institutionId: Uuid; academicYearId: Uuid }): EnrollmentFacts {
    const full: EnrollmentFacts = { status: "ACTIVE", fundingType: "PRIVATE", assignmentReference: null, classroomId: null, ...e };
    this.enrollmentsById.set(full.enrollmentId, full);
    return full;
  }

  setBilling(enrollmentId: Uuid, billing: StateFundingBilling): void {
    this.billingByEnrollment.set(enrollmentId, billing);
  }

  setAttendance(enrollmentId: Uuid, periodId: Uuid | null, facts: Omit<AttendanceFacts, "periodId">): void {
    this.attendanceByKey.set(`${enrollmentId}|${periodId ?? ""}`, { ...facts, periodId });
  }

  linkGuardian(userId: string, studentId: Uuid): void {
    const set = this.links.get(userId) ?? new Set<Uuid>();
    set.add(studentId);
    this.links.set(userId, set);
  }

  readonly enrollments: EnrollmentPort = {
    getEnrollment: async (ctx: RequestContext, id) => {
      const e = this.enrollmentsById.get(id) ?? null;
      if (!e) return null;
      if (ctx.institutionId && e.institutionId !== ctx.institutionId) return null;
      return e;
    },
    listPeriods: async (_ctx, yearId) => this.periodsByYear.get(yearId) ?? [],
  };

  readonly funding: EnrollmentFundingPort = {
    setStateAssignedFunding: async (_ctx, input) => {
      this.fundingCalls.push(input);
      if (this.fundingRefusal) return err(this.fundingRefusal);
      const e = this.enrollmentsById.get(input.enrollmentId);
      if (e) this.enrollmentsById.set(e.enrollmentId, { ...e, fundingType: "STATE_ASSIGNED", assignmentReference: input.reference });
      return ok(true as const);
    },
  };

  readonly finance: FinancePort = {
    getStateFundingBilling: async (_ctx, q) => {
      if (this.billingFails) throw portUnavailable("finance");
      return (
        this.billingByEnrollment.get(q.enrollmentId) ?? {
          currency: "XOF",
          stateInvoices: [],
          parentInvoices: [],
          statePayments: [],
          scholarshipIds: [],
        }
      );
    },
  };

  readonly attendance: AttendanceFactsPort = {
    getFacts: async (_ctx, q) => this.attendanceByKey.get(`${q.enrollmentId}|${q.periodId ?? ""}`) ?? null,
  };

  readonly documents: DocumentRefPort = {
    exists: async (_ctx, ref, _caps: DocumentReadCaps) => this.documentIds.has(ref),
  };

  readonly students: StudentNamesPort = {
    names: async (_ctx, ids) => new Map(ids.flatMap((id) => (this.studentNames.has(id) ? [[id, this.studentNames.get(id)!] as const] : []))),
  };

  readonly guardianship: GuardianshipPort = {
    studentIdForUser: async (_ctx, userId) => this.ownStudent.get(userId) ?? null,
    isGuardianOf: async (_ctx, userId, studentId) => this.links.get(userId)?.has(studentId) ?? false,
    childrenOf: async (_ctx, userId) => [...(this.links.get(userId) ?? [])],
  };

  gateway: StateGateway = NotConfiguredGateway;
}

/** Facturation de test : montants entiers XOF, une facture État et une facture famille. */
export function billingOf(input: {
  stateTotal: number;
  statePaid?: number;
  parentTotal: number;
  parentPaid?: number;
  scholarshipId?: Uuid;
  stateInvoiceId?: Uuid;
  parentInvoiceId?: Uuid;
  currency?: "XOF";
  payments?: ReadonlyArray<{ paymentId: Uuid; receivedAt: Date; amount: number; allocated?: number; reference?: string | null }>;
}): StateFundingBilling {
  const cur = input.currency ?? "XOF";
  const scholarshipId = input.scholarshipId ?? "00000000-0000-4000-8000-0000000000a1";
  const mk = (id: string, total: number, paid: number, schol: Uuid | null) => ({
    invoiceId: id,
    number: `FAC-${id.slice(-4)}`,
    status: paid >= total ? "PAID" : paid > 0 ? "PARTIALLY_PAID" : "ISSUED",
    total: Money.of(total, cur),
    paid: Money.of(paid, cur),
    credited: Money.of(0, cur),
    dueDate: "2026-12-01",
    scholarshipId: schol,
  });
  return {
    currency: cur,
    stateInvoices: input.stateTotal > 0 ? [mk(input.stateInvoiceId ?? "00000000-0000-4000-8000-0000000000b1", input.stateTotal, input.statePaid ?? 0, scholarshipId)] : [],
    parentInvoices: input.parentTotal > 0 ? [mk(input.parentInvoiceId ?? "00000000-0000-4000-8000-0000000000b2", input.parentTotal, input.parentPaid ?? 0, null)] : [],
    statePayments: (input.payments ?? []).map((p) => ({
      paymentId: p.paymentId,
      receivedAt: p.receivedAt,
      amount: Money.of(p.amount, cur),
      allocated: Money.of(p.allocated ?? p.amount, cur),
      reference: p.reference ?? null,
    })),
    scholarshipIds: input.stateTotal > 0 ? [scholarshipId] : [],
  };
}
