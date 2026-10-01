/**
 * Implémentations EN MÉMOIRE des ports du module payroll : pour les tests (de ce module et des modules
 * consommateurs) et pour les assemblages sans 017 / 010 / 009. Elles respectent le contrat des ports
 * (`application/ports.ts`) ; `failWith` simule la panne d'un fournisseur (le calcul doit alors être refusé).
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import type {
  CurriculumLabel,
  CurriculumLabelPort,
  HourLockLine,
  HoursQuery,
  HoursSourcePort,
  PayrollPortsInput,
  StaffDirectoryPort,
  StaffInfo,
} from "../application/ports";
import type { HourFact, HourSourceKind, Uuid } from "../domain/types";

export class InMemoryHoursSource implements HoursSourcePort {
  readonly facts: HourFact[] = [];
  /** `lockRef` -> lignes gelées (assertions des tests). */
  readonly locks = new Map<string, readonly HourLockLine[]>();
  readonly lockCalls: string[] = [];
  readonly releaseCalls: string[] = [];
  failWith: Error | null = null;
  failLockWith: Error | null = null;
  collectCalls = 0;

  constructor(readonly kind: HourSourceKind, initial: readonly HourFact[] = []) {
    this.facts.push(...initial);
  }

  add(...facts: HourFact[]): this {
    this.facts.push(...facts);
    return this;
  }

  clear(): this {
    this.facts.length = 0;
    return this;
  }

  async collect(_ctx: RequestContext, q: HoursQuery): Promise<readonly HourFact[]> {
    this.collectCalls += 1;
    if (this.failWith) throw this.failWith;
    const staff = q.staffIds ? new Set(q.staffIds) : null;
    return this.facts.filter((f) => f.date >= q.from && f.date <= q.to && (staff === null || (f.staffId !== null && staff.has(f.staffId))));
  }

  async lock(_ctx: RequestContext, input: { lockRef: Uuid; lines: readonly HourLockLine[] }): Promise<void> {
    if (this.failLockWith) throw this.failLockWith;
    this.lockCalls.push(input.lockRef);
    this.locks.set(input.lockRef, input.lines);
  }

  async release(_ctx: RequestContext, input: { lockRef: Uuid }): Promise<void> {
    this.releaseCalls.push(input.lockRef);
    this.locks.delete(input.lockRef);
  }
}

export class InMemoryStaffDirectory implements StaffDirectoryPort {
  private readonly staff = new Map<Uuid, StaffInfo>();
  private readonly userNames = new Map<Uuid, string>();
  failWith: Error | null = null;

  add(info: Partial<StaffInfo> & { staffId: Uuid }): this {
    this.staff.set(info.staffId, { displayName: `Enseignant ${info.staffId.slice(0, 4)}`, matricule: null, active: true, userId: null, ...info });
    return this;
  }

  nameUser(userId: Uuid, name: string): this {
    this.userNames.set(userId, name);
    return this;
  }

  async getStaff(_ctx: RequestContext, staffId: Uuid): Promise<StaffInfo | null> {
    if (this.failWith) throw this.failWith;
    return this.staff.get(staffId) ?? null;
  }

  async getStaffMany(_ctx: RequestContext, staffIds: readonly Uuid[]): Promise<readonly StaffInfo[]> {
    if (this.failWith) throw this.failWith;
    return staffIds.map((id) => this.staff.get(id)).filter((s): s is StaffInfo => s !== undefined);
  }

  async getStaffIdForUser(_ctx: RequestContext, userId: Uuid): Promise<Uuid | null> {
    if (this.failWith) throw this.failWith;
    for (const s of this.staff.values()) if (s.userId === userId) return s.staffId;
    return null;
  }

  async getUserDisplayName(_ctx: RequestContext, userId: Uuid): Promise<string | null> {
    return this.userNames.get(userId) ?? null;
  }

  async listPayableStaff(): Promise<readonly StaffInfo[]> {
    return [...this.staff.values()];
  }
}

export class InMemoryCurriculum implements CurriculumLabelPort {
  private readonly labels = new Map<Uuid, CurriculumLabel>();
  set(nodeId: Uuid, label: CurriculumLabel): this {
    this.labels.set(nodeId, label);
    return this;
  }
  async getLabels(_ctx: RequestContext, nodeIds: readonly Uuid[]): Promise<ReadonlyMap<Uuid, CurriculumLabel>> {
    return new Map(nodeIds.flatMap((id) => (this.labels.has(id) ? [[id, this.labels.get(id) as CurriculumLabel] as const] : [])));
  }
}

export interface InMemoryPayrollWorld {
  readonly sessions: InMemoryHoursSource;
  readonly attendance: InMemoryHoursSource;
  readonly staff: InMemoryStaffDirectory;
  readonly curriculum: InMemoryCurriculum;
  readonly ports: PayrollPortsInput;
}

/** Jeu complet de doublures (séances, présences, personnel, libellés), prêt à passer à `registerPayrollPorts`. */
export function inMemoryPorts(): InMemoryPayrollWorld {
  const sessions = new InMemoryHoursSource("SESSION");
  const attendance = new InMemoryHoursSource("ATTENDANCE");
  const staff = new InMemoryStaffDirectory();
  const curriculum = new InMemoryCurriculum();
  return { sessions, attendance, staff, curriculum, ports: { sessionHours: sessions, attendanceHours: attendance, staff, curriculum } };
}
