/**
 * Ports de `results` « indisponibles » (échec fermé, branchement par défaut) et EN MÉMOIRE (tests, adaptateur de scénarios
 * de caractérisation). Aucun SQL : un monde déclaré en JS.
 */
import { ConflictError, err, InternalError, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { ResultsCode } from "../domain/errors";
import type { ClassStructure, GradeFact } from "../domain/types";
import type {
  ActorNamePort,
  AssessPort,
  CurriculumPort,
  GuardianshipPort,
  LockOutcome,
  PendingAssessmentInfo,
  ResultsPorts,
  RosterEntry,
  RosterPort,
} from "../application/ports";

const unavailable = (port: string): never => {
  throw new InternalError(`Le port « ${port} » n'est pas branché (module fournisseur absent).`, { code: ResultsCode.PORT_UNAVAILABLE });
};

export function unavailableResultsPorts(): ResultsPorts {
  return {
    curriculum: { getStructure: () => unavailable("curriculum") },
    roster: { listEnrollments: () => unavailable("roster") },
    assess: {
      listPublished: () => unavailable("assess"),
      lock: () => unavailable("assess"),
      unlock: () => unavailable("assess"),
      releaseSession2: () => unavailable("assess"),
      listPending: () => unavailable("assess"),
    },
    rules: { resolve: () => unavailable("rules"), open: () => unavailable("rules") },
    guardianship: { studentIdForUser: () => unavailable("guardianship"), isGuardianOf: () => unavailable("guardianship") },
    names: { nameOf: async (_ctx, userId) => `Utilisateur ${userId.slice(0, 8)}`, staffIdForUser: async () => null },
  };
}

export class InMemoryCurriculum implements CurriculumPort {
  readonly structures = new Map<string, ClassStructure>();
  set(structure: ClassStructure): void {
    this.structures.set(`${structure.classroomId}:${structure.period.id}`, structure);
  }
  async getStructure(_ctx: RequestContext, input: { classroomId: string; academicPeriodId: string }): Promise<ClassStructure | null> {
    return this.structures.get(`${input.classroomId}:${input.academicPeriodId}`) ?? null;
  }
}

export class InMemoryRoster implements RosterPort {
  readonly entries: RosterEntry[] = [];
  async listEnrollments(_ctx: RequestContext, classroomId: string): Promise<readonly RosterEntry[]> {
    return this.entries.filter((e) => e.classroomId === classroomId);
  }
}

/** Notes publiées en mémoire + verrous simulés (le vrai verrou est testé avec l'adaptateur `assess`). */
export class InMemoryAssess implements AssessPort {
  grades: GradeFact[] = [];
  pending: PendingAssessmentInfo[] = [];
  readonly locks = new Map<string, readonly (1 | 2)[]>();
  readonly calls: string[] = [];

  private key = (c: string, p: string): string => `${c}:${p}`;
  async listPublished(_ctx: RequestContext, _tx: Tx, _input: { classroomId: string; academicPeriodId: string }): Promise<readonly GradeFact[]> {
    return this.grades;
  }
  async lock(_ctx: RequestContext, _tx: Tx, input: { classroomId: string; academicPeriodId: string; sessions: readonly (1 | 2)[]; force: boolean; reason: string | null }): Promise<Result<LockOutcome, AppError>> {
    this.calls.push("lock");
    if (this.pending.length > 0 && !input.force) {
      return err(new ConflictError("Des évaluations ne sont pas publiées.", { code: "assess.period_locked", details: { pending: this.pending } }));
    }
    const k = this.key(input.classroomId, input.academicPeriodId);
    const already = this.locks.has(k);
    this.locks.set(k, input.sessions);
    return ok({ alreadyLocked: already, pending: [...this.pending] });
  }
  async unlock(_ctx: RequestContext, _tx: Tx, input: { classroomId: string; academicPeriodId: string; reason: string }): Promise<Result<void, AppError>> {
    this.calls.push("unlock");
    this.locks.delete(this.key(input.classroomId, input.academicPeriodId));
    return ok(undefined);
  }
  async releaseSession2(_ctx: RequestContext, _tx: Tx, input: { classroomId: string; academicPeriodId: string; reason: string }): Promise<Result<void, AppError>> {
    this.calls.push("releaseSession2");
    const k = this.key(input.classroomId, input.academicPeriodId);
    if (this.locks.has(k)) this.locks.set(k, [1]);
    return ok(undefined);
  }
  async listPending(): Promise<readonly PendingAssessmentInfo[]> {
    return this.pending;
  }
}

export class InMemoryGuardianship implements GuardianshipPort {
  readonly studentByUser = new Map<string, string>();
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
  readonly staff = new Map<string, string>();
  async nameOf(_ctx: RequestContext, userId: string): Promise<string> {
    return this.names.get(userId) ?? `Utilisateur ${userId.slice(0, 8)}`;
  }
  async staffIdForUser(_ctx: RequestContext, userId: string): Promise<string | null> {
    return this.staff.get(userId) ?? null;
  }
}
