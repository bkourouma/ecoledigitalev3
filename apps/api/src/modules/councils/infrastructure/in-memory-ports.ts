/**
 * Ports en mémoire (tests et modules consommateurs) et ports « indisponibles » (échec FERMÉ).
 *
 * `inMemoryPorts()` fournit un monde simulé complet (classes, effectif, inscriptions, résultats, assiduité, vie scolaire, personnel,
 * tutelle, notifications, documents) qui ENREGISTRE les écritures ; `unavailablePorts()` lève `councils.port_unavailable` à chaque
 * appel : c'est le comportement par défaut tant que la plateforme n'a pas branché de port. Réservé aux tests : aucune simulation
 * silencieuse en production.
 */
import { newId, type RequestContext } from "@ecoledigitale/kernel";
import { portUnavailable } from "../domain/errors";
import { bundledTemplatePort } from "../templates";
import type { AttendanceFacts, DisciplineFacts, ResultsFacts } from "../domain/facts";
import type {
  AcademicPort,
  ClassroomInfo,
  CouncilsPorts,
  DocumentsPort,
  EnrollmentInfo,
  MinutesDocumentRequest,
  PeriodInfo,
  RenderedDocument,
  ResultsStateView,
  RosterEntry,
  StaffAssignmentInfo,
  StudentStatusTarget,
} from "../application/ports";

const unavailable = (name: string) => (): never => {
  throw portUnavailable(name);
};

/** Tous les ports lèvent `councils.port_unavailable`. */
export function unavailablePorts(): CouncilsPorts {
  return {
    academic: { getClassroom: unavailable("academic"), getPeriod: unavailable("academic"), getRoster: unavailable("academic"), getEnrollment: unavailable("academic"), getCurrentEnrollmentOfStudent: unavailable("academic"), getInstitutionName: unavailable("academic") },
    outcomes: { recordOutcome: unavailable("academic"), recordRedirect: unavailable("academic"), transferEnrollment: unavailable("academic") },
    resultsRead: { getStateView: unavailable("results"), getEnrollmentFacts: unavailable("results") },
    resultsWrite: {
      openDeliberation: unavailable("results"),
      markDeliberationHeld: unavailable("results"),
      markDeliberationSigned: unavailable("results"),
      cancelDeliberation: unavailable("results"),
      publishYearDecision: unavailable("results"),
      recordDistinction: unavailable("results"),
      writeAppreciation: unavailable("results"),
    },
    ruleCodes: { allowedYearEndCodes: unavailable("rules") },
    attendance: { summarize: unavailable("attendance") },
    schoollife: { disciplineFacts: unavailable("schoollife") },
    staff: { listAssignmentsForClassroom: unavailable("people"), getStaffNames: unavailable("people"), staffIdOfUser: unavailable("people"), isStaffAssignedToClassroom: unavailable("people"), displayNameOfUser: unavailable("people") },
    family: { isGuardianOfStudent: unavailable("people"), getStudentIdForUser: unavailable("people"), getStudentNames: unavailable("people") },
    studentStatus: { changeStudentStatus: unavailable("people") },
    notifications: { notifyParticipants: unavailable("notifications"), notifyGuardians: unavailable("notifications") },
    documents: { requestMinutes: unavailable("reportcards"), getMinutesDocument: unavailable("reportcards"), signedReadUrl: unavailable("reportcards") },
    storage: { objectExists: unavailable("stockage") },
    templates: bundledTemplatePort,
  };
}

export interface InMemoryWorld extends CouncilsPorts {
  // --- préparation du monde ---
  addClassroom(c: ClassroomInfo): void;
  addPeriod(p: PeriodInfo): void;
  addEnrollment(e: EnrollmentInfo & { displayName: string | null; isRepeating?: boolean; fundingType?: string | null; stateAssigned?: boolean }): void;
  setState(classroomId: string, academicPeriodId: string | null, state: ResultsStateView | null): void;
  setResultsFacts(enrollmentId: string, facts: ResultsFacts): void;
  setAttendance(enrollmentId: string, facts: AttendanceFacts | null): void;
  setDiscipline(enrollmentId: string, facts: DisciplineFacts | null): void;
  addAssignment(classroomId: string, a: StaffAssignmentInfo): void;
  linkUserToStaff(userId: string, staffId: string, name: string): void;
  nameUser(userId: string, name: string): void;
  addGuardian(userId: string, studentId: string): void;
  linkStudentUser(userId: string, studentId: string): void;
  setAllowedYearEndCodes(codes: readonly string[] | null): void;
  // --- observation des écritures ---
  readonly outcomeCalls: Array<Record<string, unknown>>;
  readonly transferCalls: Array<Record<string, unknown>>;
  readonly resultsWrites: Array<{ op: string; input: Record<string, unknown> }>;
  readonly statusChanges: Array<{ studentId: string; status: StudentStatusTarget; reasonText: string; actor: string | undefined }>;
  readonly notified: Array<{ kind: "PARTICIPANTS" | "GUARDIANS"; clientKey: string; ids: readonly string[] }>;
  readonly documentRequests: MinutesDocumentRequest[];
  /** Simule le rendu du PDF par le worker. */
  completeRender(minutesId: string, objectKey?: string, pdfHash?: string): void;
  /** Provoque un échec (`Error`) de l'opération de `results` désignée (« publishYearDecision »…) tant que `fail` n'est pas remis à `null`. */
  failResults: { op: string; error: Error } | null;
  existingObjects: Set<string>;
}

export function inMemoryPorts(): InMemoryWorld {
  const classrooms = new Map<string, ClassroomInfo>();
  const periods = new Map<string, PeriodInfo>();
  const enrollments = new Map<string, EnrollmentInfo & { displayName: string | null; isRepeating: boolean; fundingType: string | null; stateAssigned: boolean }>();
  const states = new Map<string, ResultsStateView>();
  const facts = new Map<string, ResultsFacts>();
  const attendance = new Map<string, AttendanceFacts | null>();
  const discipline = new Map<string, DisciplineFacts | null>();
  const assignments = new Map<string, StaffAssignmentInfo[]>();
  const userStaff = new Map<string, string>();
  const names = new Map<string, string>();
  const staffNames = new Map<string, string>();
  const guardians = new Map<string, Set<string>>();
  const studentUsers = new Map<string, string>();
  const docs = new Map<string, RenderedDocument>();
  let allowedCodes: readonly string[] | null = null;
  const stateKey = (classroomId: string, periodId: string | null): string => `${classroomId}|${periodId ?? "YEAR"}`;

  const world: InMemoryWorld = {
    outcomeCalls: [],
    transferCalls: [],
    resultsWrites: [],
    statusChanges: [],
    notified: [],
    documentRequests: [],
    failResults: null,
    existingObjects: new Set<string>(),
    addClassroom: (c) => void classrooms.set(c.classroomId, c),
    addPeriod: (p) => void periods.set(p.periodId, p),
    addEnrollment: (e) => void enrollments.set(e.enrollmentId, { ...e, isRepeating: e.isRepeating ?? false, fundingType: e.fundingType ?? null, stateAssigned: e.stateAssigned ?? false }),
    setState: (classroomId, periodId, s) => (s ? void states.set(stateKey(classroomId, periodId), s) : void states.delete(stateKey(classroomId, periodId))),
    setResultsFacts: (enrollmentId, f) => void facts.set(enrollmentId, f),
    setAttendance: (id, f) => void attendance.set(id, f),
    setDiscipline: (id, f) => void discipline.set(id, f),
    addAssignment: (classroomId, a) => {
      assignments.set(classroomId, [...(assignments.get(classroomId) ?? []), a]);
      staffNames.set(a.staffId, a.displayName);
    },
    linkUserToStaff: (userId, staffId, name) => {
      userStaff.set(userId, staffId);
      names.set(userId, name);
      staffNames.set(staffId, name);
    },
    nameUser: (userId, name) => void names.set(userId, name),
    addGuardian: (userId, studentId) => void guardians.set(userId, new Set([...(guardians.get(userId) ?? []), studentId])),
    linkStudentUser: (userId, studentId) => void studentUsers.set(userId, studentId),
    setAllowedYearEndCodes: (codes) => void (allowedCodes = codes),
    completeRender(minutesId, objectKey = `councils/test/${minutesId}.pdf`, pdfHash = "a".repeat(64)) {
      const d = docs.get(minutesId);
      if (d) docs.set(minutesId, { ...d, renderStatus: "RENDERED", objectKey, pdfHash });
      world.existingObjects.add(objectKey);
    },

    academic: {
      async getClassroom(_c, id) {
        return classrooms.get(id) ?? null;
      },
      async getPeriod(_c, id) {
        return periods.get(id) ?? null;
      },
      async getRoster(_c, classroomId): Promise<readonly RosterEntry[]> {
        return [...enrollments.values()].filter((e) => e.classroomId === classroomId && e.active).map((e) => ({ enrollmentId: e.enrollmentId, studentId: e.studentId, displayName: e.displayName, isRepeating: e.isRepeating, fundingType: e.fundingType, stateAssigned: e.stateAssigned }));
      },
      async getEnrollment(_c, id) {
        return enrollments.get(id) ?? null;
      },
      async getCurrentEnrollmentOfStudent(_c, studentId) {
        return [...enrollments.values()].filter((e) => e.studentId === studentId && e.active).at(-1) ?? null;
      },
      async getInstitutionName() {
        return "Établissement de démonstration";
      },
    } satisfies AcademicPort,
    outcomes: {
      async recordOutcome(_c, input) {
        world.outcomeCalls.push({ ...input });
      },
      async recordRedirect(_c, input) {
        world.outcomeCalls.push({ ...input, redirect: true });
      },
      async transferEnrollment(_c, input) {
        world.transferCalls.push({ ...input });
        return { enrollmentId: input.enrollmentId };
      },
    },
    resultsRead: {
      async getStateView(_c, { classroomId, academicPeriodId }) {
        return states.get(stateKey(classroomId, academicPeriodId)) ?? null;
      },
      async getEnrollmentFacts(_c, { enrollmentIds }) {
        return new Map(enrollmentIds.filter((id) => facts.has(id)).map((id) => [id, facts.get(id) as ResultsFacts]));
      },
    },
    resultsWrite: {
      async openDeliberation(_c, input) {
        maybeFail("openDeliberation");
        world.resultsWrites.push({ op: "openDeliberation", input: { ...input } });
        return { deliberationId: newId() };
      },
      async markDeliberationHeld(_c, input) {
        maybeFail("markDeliberationHeld");
        world.resultsWrites.push({ op: "markDeliberationHeld", input: { ...input } });
      },
      async markDeliberationSigned(_c, input) {
        maybeFail("markDeliberationSigned");
        world.resultsWrites.push({ op: "markDeliberationSigned", input: { ...input } });
      },
      async cancelDeliberation(_c, input) {
        maybeFail("cancelDeliberation");
        world.resultsWrites.push({ op: "cancelDeliberation", input: { ...input } });
      },
      async publishYearDecision(_c, input) {
        maybeFail("publishYearDecision");
        world.resultsWrites.push({ op: "publishYearDecision", input: { ...input } });
        return { decisionId: newId() };
      },
      async recordDistinction(_c, input) {
        maybeFail("recordDistinction");
        world.resultsWrites.push({ op: "recordDistinction", input: { ...input } });
        return { decisionId: newId() };
      },
      async withdrawDecision(_c, input) {
        maybeFail("withdrawDecision");
        world.resultsWrites.push({ op: "withdrawDecision", input: { ...input } });
      },
      async writeAppreciation(_c, input) {
        maybeFail("writeAppreciation");
        world.resultsWrites.push({ op: "writeAppreciation", input: { ...input } });
        return { appreciationId: newId() };
      },
    },
    ruleCodes: {
      async allowedYearEndCodes() {
        return allowedCodes;
      },
    },
    attendance: {
      async summarize(_c, { enrollmentId }) {
        return attendance.has(enrollmentId) ? (attendance.get(enrollmentId) ?? null) : null;
      },
    },
    schoollife: {
      async disciplineFacts(_c, { enrollmentId }) {
        return discipline.has(enrollmentId) ? (discipline.get(enrollmentId) ?? null) : null;
      },
    },
    staff: {
      async listAssignmentsForClassroom(_c, classroomId) {
        return assignments.get(classroomId) ?? [];
      },
      async getStaffNames(_c, ids) {
        return new Map(ids.filter((i) => staffNames.has(i)).map((i) => [i, staffNames.get(i) as string]));
      },
      async staffIdOfUser(_c, userId) {
        return userStaff.get(userId) ?? null;
      },
      async isStaffAssignedToClassroom(_c, userId, classroomId) {
        const staffId = userStaff.get(userId);
        return staffId !== undefined && (assignments.get(classroomId) ?? []).some((a) => a.staffId === staffId);
      },
      async displayNameOfUser(_c, userId) {
        return names.get(userId) ?? "Utilisateur";
      },
    },
    family: {
      async isGuardianOfStudent(_c, userId, studentId) {
        return guardians.get(userId)?.has(studentId) === true;
      },
      async getStudentIdForUser(_c, userId) {
        return studentUsers.get(userId) ?? null;
      },
      async getStudentNames(_c, ids) {
        return new Map([...enrollments.values()].filter((e) => ids.includes(e.studentId) && e.displayName).map((e) => [e.studentId, e.displayName as string]));
      },
    },
    studentStatus: {
      async changeStudentStatus(ctx: RequestContext, input) {
        world.statusChanges.push({ ...input, actor: ctx.actor });
      },
    },
    notifications: {
      async notifyParticipants(_c, input) {
        world.notified.push({ kind: "PARTICIPANTS", clientKey: input.clientKey, ids: input.staffIds });
        return { recipients: input.staffIds.length, queued: input.staffIds.length };
      },
      async notifyGuardians(_c, input) {
        world.notified.push({ kind: "GUARDIANS", clientKey: input.clientKey, ids: [input.studentId] });
        return { recipients: 1, queued: 1 };
      },
    },
    documents: {
      async requestMinutes(_c, input) {
        world.documentRequests.push(input);
        const existing = docs.get(input.minutesId);
        if (existing) return { documentId: existing.documentId };
        const documentId = newId();
        docs.set(input.minutesId, { documentId, renderStatus: "PENDING", objectKey: null, pdfHash: null });
        return { documentId };
      },
      async getMinutesDocument(_c, minutesId) {
        return docs.get(minutesId) ?? null;
      },
      async signedReadUrl(_c, objectKey, ttlSeconds) {
        return { url: `https://storage.invalid/${objectKey}?ttl=${ttlSeconds}`, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
      },
    } satisfies DocumentsPort,
    storage: {
      async objectExists(_c, key) {
        return world.existingObjects.has(key);
      },
    },
    templates: bundledTemplatePort,
  };

  function maybeFail(op: string): void {
    if (world.failResults && world.failResults.op === op) throw world.failResults.error;
  }
  return world;
}
