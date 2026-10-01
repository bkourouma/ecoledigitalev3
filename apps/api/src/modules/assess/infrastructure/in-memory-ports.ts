/**
 * Implémentations des ports d'`assess` : « indisponibles » (échec fermé, branchement par défaut) et EN MÉMOIRE (tests,
 * scénarios de parité). Aucun SQL : un monde déclaré en JS.
 */
import { InternalError, type RequestContext } from "@ecoledigitale/kernel";
import { AssessCode } from "../domain/errors";
import type {
  ActorNamePort,
  AssessPorts,
  ClassroomInfo,
  CurriculumPort,
  GuardianshipPort,
  NodeInfo,
  PeriodInfo,
  PeriodPort,
  RosterEntry,
  RosterPort,
  TeachingAssignmentPort,
} from "../application/ports";

const unavailable = (port: string): never => {
  throw new InternalError(`Le port « ${port} » n'est pas branché (module fournisseur absent).`, { code: AssessCode.PORT_UNAVAILABLE });
};

/** Ports non branchés : toute utilisation échoue (jamais « tout autorisé »). */
export function unavailablePorts(): AssessPorts {
  return {
    roster: { getClassroom: () => unavailable("roster"), listEnrollments: () => unavailable("roster") },
    periods: { getPeriod: () => unavailable("periods") },
    curriculum: { getNode: () => unavailable("curriculum"), nodeInClassroom: () => unavailable("curriculum") },
    teaching: { staffIdForUser: () => unavailable("teaching"), teaches: () => unavailable("teaching") },
    guardianship: { studentIdForUser: () => unavailable("guardianship"), isGuardianOf: () => unavailable("guardianship") },
    names: { nameOf: async (_ctx, userId) => `Utilisateur ${userId.slice(0, 8)}` },
  };
}

export class InMemoryRoster implements RosterPort {
  readonly classrooms = new Map<string, ClassroomInfo>();
  readonly enrollments: RosterEntry[] = [];
  async getClassroom(_ctx: RequestContext, classroomId: string): Promise<ClassroomInfo | null> {
    return this.classrooms.get(classroomId) ?? null;
  }
  async listEnrollments(_ctx: RequestContext, classroomId: string): Promise<readonly RosterEntry[]> {
    return this.enrollments.filter((e) => e.classroomId === classroomId);
  }
}

export class InMemoryPeriods implements PeriodPort {
  readonly periods = new Map<string, PeriodInfo>();
  async getPeriod(_ctx: RequestContext, periodId: string): Promise<PeriodInfo | null> {
    return this.periods.get(periodId) ?? null;
  }
}

export class InMemoryCurriculum implements CurriculumPort {
  readonly nodes = new Map<string, NodeInfo>();
  /** `classroomId -> nodeIds` ; absent : tout nœud connu est accepté. */
  readonly byClassroom = new Map<string, Set<string>>();
  async getNode(_ctx: RequestContext, nodeId: string): Promise<NodeInfo | null> {
    return this.nodes.get(nodeId) ?? null;
  }
  async nodeInClassroom(_ctx: RequestContext, nodeId: string, classroomId: string): Promise<boolean> {
    const set = this.byClassroom.get(classroomId);
    return set ? set.has(nodeId) : this.nodes.has(nodeId);
  }
}

export class InMemoryTeaching implements TeachingAssignmentPort {
  readonly staffByUser = new Map<string, string>();
  /** `"staffId|nodeId|classroomId"` */
  readonly assignments = new Set<string>();
  async staffIdForUser(_ctx: RequestContext, userId: string): Promise<string | null> {
    return this.staffByUser.get(userId) ?? null;
  }
  async teaches(_ctx: RequestContext, staffId: string, nodeId: string, classroomId: string): Promise<boolean> {
    return this.assignments.has(`${staffId}|${nodeId}|${classroomId}`);
  }
  assign(staffId: string, nodeId: string, classroomId: string): void {
    this.assignments.add(`${staffId}|${nodeId}|${classroomId}`);
  }
}

export class InMemoryGuardianship implements GuardianshipPort {
  readonly studentByUser = new Map<string, string>();
  /** `"userId|studentId"` */
  readonly links = new Set<string>();
  async studentIdForUser(_ctx: RequestContext, userId: string): Promise<string | null> {
    return this.studentByUser.get(userId) ?? null;
  }
  async isGuardianOf(_ctx: RequestContext, userId: string, studentId: string): Promise<boolean> {
    return this.links.has(`${userId}|${studentId}`);
  }
}

export class InMemoryNames implements ActorNamePort {
  readonly names = new Map<string, string>();
  async nameOf(_ctx: RequestContext, userId: string): Promise<string> {
    return this.names.get(userId) ?? `Utilisateur ${userId.slice(0, 8)}`;
  }
}

export interface InMemoryWorld {
  readonly roster: InMemoryRoster;
  readonly periods: InMemoryPeriods;
  readonly curriculum: InMemoryCurriculum;
  readonly teaching: InMemoryTeaching;
  readonly guardianship: InMemoryGuardianship;
  readonly names: InMemoryNames;
}

export function inMemoryPorts(): { world: InMemoryWorld; ports: AssessPorts } {
  const world: InMemoryWorld = {
    roster: new InMemoryRoster(),
    periods: new InMemoryPeriods(),
    curriculum: new InMemoryCurriculum(),
    teaching: new InMemoryTeaching(),
    guardianship: new InMemoryGuardianship(),
    names: new InMemoryNames(),
  };
  return { world, ports: { ...world } };
}
