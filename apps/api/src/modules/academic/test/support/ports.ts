/** Doubles de test pour les ports d'academic (people, assess, results, higher, scheduling, finance, tenancy). */
import { err, ok } from "@ecoledigitale/kernel";
import type {
  CompletionLookup,
  CurriculumUsageGuard,
  GuardianshipPort,
  InstitutionDirectory,
  InvoiceFacts,
  InvoiceFactsReader,
  OfferingReadinessGuard,
  PeriodClosureGuard,
  RegistrationFeeProbe,
  ScheduleConflictChecker,
} from "../../index";

export const neverBlock: PeriodClosureGuard = { canClose: async () => ok(undefined) };

export const refuseClosure = (code: string, reason: string): PeriodClosureGuard => ({ canClose: async () => err({ code, reason }) });

/** `CurriculumUsageGuard` : seuls les nœuds listés sont « utilisés » (notes, évaluations…). */
export const usedNodes = (ids: Iterable<string>): CurriculumUsageGuard & { ids: Set<string> } => {
  const set = new Set(ids);
  return { ids: set, isNodeInUse: async (_ctx, nodeId) => set.has(nodeId) };
};
export const nothingInUse: CurriculumUsageGuard = { isNodeInUse: async () => false };

/** `CompletionLookup` (011/019) : les lignées « validées » par apprenant. */
export class FakeCompletion implements CompletionLookup {
  private readonly done = new Set<string>();
  validate(studentId: string, lineageId: string): void {
    this.done.add(`${studentId}:${lineageId}`);
  }
  async hasValidated(_ctx: unknown, input: { studentId: string; lineageId: string }): Promise<boolean> {
    return this.done.has(`${input.studentId}:${input.lineageId}`);
  }
}

export const readyUnless = (notReady: Set<string>): OfferingReadinessGuard => ({
  check: async (_ctx, offeringId) => (notReady.has(offeringId) ? err({ missing: ["ECUE sans responsable d'enseignement"] }) : ok(undefined)),
});
export const neverReady: OfferingReadinessGuard = { check: async () => err({ missing: ["ECUE sans responsable d'enseignement"]}) };

export const conflictingSchedule = (description: string): ScheduleConflictChecker => ({ checkStudentOffering: async () => ({ conflicts: [{ description }] }) });

export class FakeGuardianship implements GuardianshipPort {
  private readonly links = new Set<string>();
  link(userId: string, studentId: string): void {
    this.links.add(`${userId}:${studentId}`);
  }
  async isGuardianOfStudent(_ctx: unknown, userId: string, studentId: string): Promise<boolean> {
    return this.links.has(`${userId}:${studentId}`);
  }
}

/** `RegistrationFeeProbe` (finance) : par classe, des frais d'inscription sont dus ou non. */
export const feeDue = (due: boolean | null): RegistrationFeeProbe => ({ registrationFeeDue: async () => due });

export class FakeInvoiceFacts implements InvoiceFactsReader {
  private readonly byId = new Map<string, InvoiceFacts>();
  add(facts: InvoiceFacts): void {
    this.byId.set(facts.invoiceId, facts);
  }
  async getInvoiceFacts(_ctx: unknown, invoiceId: string): Promise<InvoiceFacts | null> {
    return this.byId.get(invoiceId) ?? null;
  }
}

export const institutionOf = (info: { pack?: "PRIMARY" | "SECONDARY" | "HIGHER" | "VIRTUAL" | null; educationSystem?: string | null; timezone?: string | null }): InstitutionDirectory => ({
  getInstitution: async (_ctx, id) => ({ id, pack: info.pack ?? null, educationSystem: info.educationSystem ?? null, countryCode: null, timezone: info.timezone ?? null }),
});
