/**
 * Implémentations des ports : « indisponible » (échec fermé, défaut) et « en mémoire » (tests, modules consommateurs).
 * `InMemoryWorld` est un MONDE minimal cohérent (établissement, classes, élèves, enseignants, résultats, règles, documents) qui
 * applique des règles proches des adaptateurs réels sans jamais les remplacer : les adaptateurs de plateforme sont éprouvés
 * séparément sur les vrais modules.
 */
import { NotFoundError, ValidationError, newId } from "@ecoledigitale/kernel";
import type { RequestContext } from "@ecoledigitale/kernel";
import { portUnavailable } from "../domain/errors";
import type { IsoDate, SourceKind, Uuid } from "../domain/types";
import type {
  AttendanceYearSummary,
  ClassroomInfo,
  ClassroomStaffInfo,
  ConfirmedDecision,
  CouncilOpening,
  DeliberationInfo,
  EnrollmentInfo,
  MinutesRequest,
  PeriodInfo,
  PrimarySchoolPorts,
  ProposalInfo,
  ReviewDocumentRequest,
  RosterEntryInfo,
  YearInfo,
  YearResultInfo,
} from "../application/ports";
import { bundledTemplatePort } from "../templates";

export function unavailablePorts(): PrimarySchoolPorts {
  const fail = (port: string) => async (): Promise<never> => {
    throw portUnavailable(port);
  };
  return {
    classrooms: {
      getClassroom: fail("classes et inscriptions"),
      listRoster: fail("classes et inscriptions"),
      getEnrollment: fail("classes et inscriptions"),
      listPeriods: fail("classes et inscriptions"),
      getYear: fail("classes et inscriptions"),
      listClassrooms: fail("classes et inscriptions"),
      listInstitutions: fail("classes et inscriptions"),
    },
    periods: { getState: fail("états de période"), allPeriodsClosed: fail("états de période") },
    outcomes: { recordOutcome: fail("issues d'inscription") },
    teaching: {
      staffIdForUser: fail("affectations d'enseignement"),
      isAssigned: fail("affectations d'enseignement"),
      isHomeroom: fail("affectations d'enseignement"),
      classroomIdsOfStaff: fail("affectations d'enseignement"),
      hasHomeroom: fail("affectations d'enseignement"),
      listClassroomStaff: fail("affectations d'enseignement"),
      staffNames: fail("affectations d'enseignement"),
    },
    guardianship: { studentIdForUser: fail("tutelle"), isGuardianOf: fail("tutelle"), childrenOf: fail("tutelle") },
    results: {
      openCouncil: fail("résultats et délibérations"),
      getDeliberation: fail("résultats et délibérations"),
      listProposals: fail("résultats et délibérations"),
      confirmDecision: fail("résultats et délibérations"),
      publishManualDecision: fail("résultats et délibérations"),
      getYearResult: fail("résultats et délibérations"),
      getRuleSourceKind: fail("résultats et délibérations"),
      getConfirmedYearDecision: fail("résultats et délibérations"),
    },
    rules: { quorum: fail("règles"), councilFlags: fail("règles") },
    attendance: { summarize: fail("assiduité"), monthlyRegister: fail("assiduité") },
    documents: { publishedPeriodIds: fail("documents officiels"), requestCouncilMinutes: fail("documents officiels"), requestAnnualReview: fail("documents officiels") },
    templates: bundledTemplatePort,
  };
}

// ---------------------------------------------------------------------------
// Monde en mémoire
// ---------------------------------------------------------------------------

const key2 = (a: string, b: string): string => `${a}:${b}`;

export interface WorldEnrollment {
  id: Uuid;
  classroomId: Uuid;
  studentId: Uuid;
  academicYearId: Uuid;
  displayName: string | null;
  isRepeating: boolean;
  status: string;
}

export class InMemoryWorld {
  institutionId: Uuid = newId();
  readonly years = new Map<Uuid, YearInfo>();
  readonly periodsByYear = new Map<Uuid, PeriodInfo[]>();
  readonly classrooms = new Map<Uuid, ClassroomInfo>();
  readonly enrollments = new Map<Uuid, WorldEnrollment>();
  /** `classe:période` verrouillées. */
  readonly locked = new Set<string>();
  /** `classe:année` dont toutes les périodes sont clôturées. */
  readonly yearClosedForClass = new Set<string>();
  readonly staffByUser = new Map<Uuid, Uuid>();
  readonly staffNameById = new Map<Uuid, string>();
  readonly assignments: Array<{ staffId: Uuid; classroomId: Uuid; roleCode: string }> = [];
  readonly studentByUser = new Map<Uuid, Uuid>();
  readonly childrenByUser = new Map<Uuid, Uuid[]>();
  readonly outcomes: Array<{ enrollmentId: Uuid; outcomeCode: string }> = [];
  readonly deliberations = new Map<Uuid, DeliberationInfo & { stateId: Uuid }>();
  /** `classe:période` -> décisions. */
  readonly decisions = new Map<string, ProposalInfo[]>();
  /** `inscription:année` -> résultat d'année. */
  readonly yearResults = new Map<string, YearResultInfo>();
  readonly confirmedYearDecisions = new Map<string, { decisionId: Uuid; finalCode: string }>();
  ruleSourceKind: SourceKind | null = "placeholder";
  /** `null` : aucune règle de quorum liée. */
  quorumRule: ((convened: number, present: number) => boolean) | null = null;
  readonly flags = new Map<Uuid, string[]>();
  readonly attendanceSummaries = new Map<string, AttendanceYearSummary>();
  readonly requestedMinutes: MinutesRequest[] = [];
  readonly requestedReviews: ReviewDocumentRequest[] = [];
  /** Simule la non-livraison des natures de document (reportcards pas encore étendu). */
  documentsAvailable = true;
  /** `inscription` -> périodes dont le bulletin est publié aux familles. */
  readonly publishedPeriods = new Map<Uuid, Uuid[]>();

  // ---- construction -------------------------------------------------------

  addYear(input: { id?: Uuid; closed?: boolean; periods?: number } = {}): Uuid {
    const id = input.id ?? newId();
    this.years.set(id, { id, institutionId: this.institutionId, label: "2026-2027", status: input.closed ? "CLOSED" : "OPEN", closed: input.closed ?? false });
    this.periodsByYear.set(
      id,
      Array.from({ length: input.periods ?? 3 }, (_, i) => ({ id: newId(), label: `Trimestre ${i + 1}`, ordinal: i + 1 })),
    );
    return id;
  }

  addClassroom(input: { yearId: Uuid; gradeLevelCode?: string; educationLevelCode?: string; name?: string; id?: Uuid }): Uuid {
    const id = input.id ?? newId();
    this.classrooms.set(id, {
      id,
      name: input.name ?? "CE1 A",
      institutionId: this.institutionId,
      academicYearId: input.yearId,
      gradeLevelCode: input.gradeLevelCode ?? "CE1",
      educationLevelCode: input.educationLevelCode ?? "PRIMARY",
      status: "ACTIVE",
    });
    return id;
  }

  addStudent(input: { classroomId: Uuid; name?: string; isRepeating?: boolean }): { enrollmentId: Uuid; studentId: Uuid } {
    const classroom = this.classrooms.get(input.classroomId) as ClassroomInfo;
    const enrollmentId = newId();
    const studentId = newId();
    this.enrollments.set(enrollmentId, {
      id: enrollmentId,
      classroomId: input.classroomId,
      studentId,
      academicYearId: classroom.academicYearId,
      displayName: input.name ?? `Élève ${this.enrollments.size + 1}`,
      isRepeating: input.isRepeating ?? false,
      status: "CONFIRMED",
    });
    return { enrollmentId, studentId };
  }

  addTeacher(input: { userId: Uuid; classroomId?: Uuid; roleCode?: string; name?: string }): Uuid {
    const staffId = newId();
    this.staffByUser.set(input.userId, staffId);
    this.staffNameById.set(staffId, input.name ?? "Instituteur");
    if (input.classroomId) this.assignments.push({ staffId, classroomId: input.classroomId, roleCode: input.roleCode ?? "HOMEROOM" });
    return staffId;
  }

  linkGuardian(userId: Uuid, studentId: Uuid): void {
    this.childrenByUser.set(userId, [...(this.childrenByUser.get(userId) ?? []), studentId]);
  }

  lock(classroomId: Uuid, periodId: Uuid, locked = true): void {
    if (locked) this.locked.add(key2(classroomId, periodId));
    else this.locked.delete(key2(classroomId, periodId));
  }

  /** Propositions de la règle pour la classe × période (une par inscription). */
  seedProposals(classroomId: Uuid, periodId: Uuid, codes: Record<Uuid, string | null>): ProposalInfo[] {
    const list = Object.entries(codes).map(([enrollmentId, code]) => ({ decisionId: newId(), enrollmentId, ruleProposalCode: code, finalCode: null, status: "PROPOSED", justification: null }));
    this.decisions.set(key2(classroomId, periodId), list);
    return list;
  }

  seedYearResult(enrollmentId: Uuid, yearId: Uuid, result: Partial<YearResultInfo> = {}): void {
    this.yearResults.set(key2(enrollmentId, yearId), {
      complete: true,
      yearResultRef: newId(),
      ruleVersionRef: newId(),
      ruleSourceKind: "placeholder",
      yearDecisionCode: "PROMOTED",
      ...result,
    });
  }

  // ---- ports --------------------------------------------------------------

  ports(): PrimarySchoolPorts {
    const w = this;
    return {
      classrooms: {
        async getClassroom(_c, id) {
          return w.classrooms.get(id) ?? null;
        },
        async listRoster(_c, classroomId): Promise<RosterEntryInfo[]> {
          return [...w.enrollments.values()]
            .filter((e) => e.classroomId === classroomId && e.status === "CONFIRMED")
            .map((e) => ({ enrollmentId: e.id, studentId: e.studentId, displayName: e.displayName, isRepeating: e.isRepeating }));
        },
        async getEnrollment(_c, id): Promise<EnrollmentInfo | null> {
          const e = w.enrollments.get(id);
          if (!e) return null;
          const gradeLevelCode = w.classrooms.get(e.classroomId)?.gradeLevelCode ?? null;
          return { id: e.id, classroomId: e.classroomId, studentId: e.studentId, academicYearId: e.academicYearId, gradeLevelCode, status: e.status, isRepeating: e.isRepeating };
        },
        async listPeriods(_c, yearId) {
          return w.periodsByYear.get(yearId) ?? [];
        },
        async getYear(_c, yearId) {
          return w.years.get(yearId) ?? null;
        },
        async listClassrooms(_c, f) {
          return [...w.classrooms.values()].filter((c) => (!f.academicYearId || c.academicYearId === f.academicYearId) && (!f.institutionId || c.institutionId === f.institutionId));
        },
        async listInstitutions() {
          return [{ id: w.institutionId, name: "École démonstration" }];
        },
      },
      periods: {
        async getState(_c, { classroomId, periodId }) {
          const locked = w.locked.has(key2(classroomId, periodId));
          return { locked, state: locked ? "CLOSED" : "OPEN" };
        },
        async allPeriodsClosed(_c, { classroomId, academicYearId }) {
          return w.yearClosedForClass.has(key2(classroomId, academicYearId));
        },
      },
      outcomes: {
        async recordOutcome(_c, input) {
          w.outcomes.push(input);
        },
      },
      teaching: {
        async staffIdForUser(_c, userId) {
          return w.staffByUser.get(userId) ?? null;
        },
        async isAssigned(_c, staffId, classroomId) {
          return w.assignments.some((a) => a.staffId === staffId && a.classroomId === classroomId);
        },
        async isHomeroom(_c, staffId, classroomId) {
          return w.assignments.some((a) => a.staffId === staffId && a.classroomId === classroomId && a.roleCode === "HOMEROOM");
        },
        async classroomIdsOfStaff(_c, staffId) {
          return [...new Set(w.assignments.filter((a) => a.staffId === staffId).map((a) => a.classroomId))];
        },
        async hasHomeroom(_c, classroomId) {
          return w.assignments.some((a) => a.classroomId === classroomId && a.roleCode === "HOMEROOM");
        },
        async listClassroomStaff(_c, classroomId): Promise<ClassroomStaffInfo[]> {
          return w.assignments.filter((a) => a.classroomId === classroomId).map((a) => ({ staffId: a.staffId, name: w.staffNameById.get(a.staffId) ?? null, roleCode: a.roleCode }));
        },
        async staffNames(_c, ids) {
          return new Map(ids.filter((id) => w.staffNameById.has(id)).map((id) => [id, w.staffNameById.get(id) as string]));
        },
      },
      guardianship: {
        async studentIdForUser(_c, userId) {
          return w.studentByUser.get(userId) ?? null;
        },
        async isGuardianOf(_c, userId, studentId) {
          return (w.childrenByUser.get(userId) ?? []).includes(studentId);
        },
        async childrenOf(_c, userId) {
          return w.childrenByUser.get(userId) ?? [];
        },
      },
      results: {
        async openCouncil(_c, input): Promise<CouncilOpening> {
          const classroom = w.classrooms.get(input.classroomId);
          if (!classroom) throw NotFoundError.of("Classe", input.classroomId);
          const existing = [...w.deliberations.values()].find((d) => d.classroomId === input.classroomId && d.periodId === input.periodId && d.kind === "COUNCIL");
          if (existing) return { deliberationId: existing.id, stateId: existing.stateId, academicYearId: existing.academicYearId };
          const id = newId();
          const stateId = newId();
          w.deliberations.set(id, {
            id,
            stateId,
            classroomId: input.classroomId,
            periodId: input.periodId,
            academicYearId: classroom.academicYearId,
            kind: "COUNCIL",
            heldOn: input.heldOn ?? null,
            status: "PLANNED",
            participants: input.participants,
          });
          return { deliberationId: id, stateId, academicYearId: classroom.academicYearId };
        },
        async getDeliberation(_c, { deliberationId }): Promise<DeliberationInfo | null> {
          return w.deliberations.get(deliberationId) ?? null;
        },
        async listProposals(_c, { classroomId, periodId }) {
          return w.decisions.get(key2(classroomId, periodId)) ?? [];
        },
        async confirmDecision(_c, input): Promise<ConfirmedDecision> {
          for (const list of w.decisions.values()) {
            const i = list.findIndex((d) => d.decisionId === input.decisionId);
            if (i < 0) continue;
            const d = list[i] as ProposalInfo;
            if (d.status === "CONFIRMED") throw new ValidationError("Décision déjà confirmée.", [{ path: ["decisionId"], message: "déjà confirmée" }]);
            const finalCode = input.finalCode ?? d.ruleProposalCode;
            if (!finalCode) throw new ValidationError("Aucune proposition à confirmer.", [{ path: ["finalCode"], message: "code requis" }]);
            const changed = finalCode !== d.ruleProposalCode;
            if (changed && (input.justification?.trim().length ?? 0) < 20) {
              throw new ValidationError("Une décision différente de la proposition de la règle exige une justification (20 caractères au moins).", [{ path: ["justification"], message: "justification requise" }]);
            }
            list[i] = { ...d, finalCode, status: "CONFIRMED", justification: changed ? (input.justification as string).trim() : null };
            const del = w.deliberations.get(input.deliberationId);
            if (del) w.confirmedYearDecisions.set(key2(d.enrollmentId, del.academicYearId), { decisionId: d.decisionId, finalCode });
            return { decisionId: d.decisionId, enrollmentId: d.enrollmentId, finalCode, ruleProposalCode: d.ruleProposalCode, changedFromProposal: changed };
          }
          throw NotFoundError.of("Décision", input.decisionId);
        },
        async publishManualDecision(_c, input): Promise<ConfirmedDecision> {
          const del = w.deliberations.get(input.deliberationId);
          const decisionId = newId();
          const list = w.decisions.get(key2(input.classroomId, input.periodId)) ?? [];
          w.decisions.set(key2(input.classroomId, input.periodId), [...list, { decisionId, enrollmentId: input.enrollmentId, ruleProposalCode: null, finalCode: input.finalCode, status: "CONFIRMED", justification: input.justification }]);
          if (del) w.confirmedYearDecisions.set(key2(input.enrollmentId, del.academicYearId), { decisionId, finalCode: input.finalCode });
          return { decisionId, enrollmentId: input.enrollmentId, finalCode: input.finalCode, ruleProposalCode: null, changedFromProposal: false };
        },
        async getYearResult(_c, { enrollmentId, academicYearId }): Promise<YearResultInfo> {
          return w.yearResults.get(key2(enrollmentId, academicYearId)) ?? { complete: false, yearResultRef: null, ruleVersionRef: null, ruleSourceKind: null, yearDecisionCode: null };
        },
        async getRuleSourceKind() {
          return w.ruleSourceKind;
        },
        async getConfirmedYearDecision(_c, { enrollmentId, classroomId }) {
          const yearId = w.classrooms.get(classroomId)?.academicYearId;
          return yearId ? (w.confirmedYearDecisions.get(key2(enrollmentId, yearId)) ?? null) : null;
        },
      },
      rules: {
        async quorum(_c, { convened, present }) {
          return w.quorumRule ? { met: w.quorumRule(convened, present) } : null;
        },
        async councilFlags(_c, { enrollmentIds }) {
          return new Map(enrollmentIds.map((id) => [id, w.flags.get(id) ?? []]));
        },
      },
      attendance: {
        async summarize(_c, { enrollmentId, academicYearId }) {
          return w.attendanceSummaries.get(key2(enrollmentId, academicYearId)) ?? { openDays: null, absentDays: null, justifiedAbsentDays: null, lateCount: null };
        },
        async monthlyRegister(_c, { classroomId, month }) {
          const days: IsoDate[] = [`${month}-01`, `${month}-02`];
          const rows = [...w.enrollments.values()]
            .filter((e) => e.classroomId === classroomId)
            .map((e) => ({ enrollmentId: e.id, studentId: e.studentId, displayName: e.displayName, days: Object.fromEntries(days.map((d) => [d, "P"])) as Record<string, string> }));
          return { days, rows };
        },
      },
      documents: {
        async publishedPeriodIds(_c, { enrollmentId }) {
          return w.publishedPeriods.get(enrollmentId) ?? [];
        },
        async requestCouncilMinutes(_c, input) {
          if (!w.documentsAvailable) throw portUnavailable("documents officiels (COUNCIL_MINUTES)");
          w.requestedMinutes.push(input);
          return { documentId: newId() };
        },
        async requestAnnualReview(_c, input) {
          if (!w.documentsAvailable) throw portUnavailable("documents officiels (ANNUAL_REVIEW)");
          w.requestedReviews.push(input);
          return { documentId: newId() };
        },
      },
      templates: bundledTemplatePort,
    };
  }
}

export type { RequestContext };
