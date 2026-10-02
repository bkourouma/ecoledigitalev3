/**
 * Implémentations des ports en MÉMOIRE (tests, démonstration) et ports « indisponibles » (échec fermé).
 *
 * `unavailablePorts()` : chaque appel échoue en `examinations.port_unavailable` — c'est l'état du module tant que la
 * plateforme n'a pas branché ses adaptateurs. `inMemoryPorts(world)` : un monde minimal (élèves, inscriptions, classes,
 * évaluations, notes publiées, pièces, stockage, liens de tutelle, documents officiels) pour les tests ; il ne contient AUCUNE
 * règle d'examen (les règles sont un port à part : voir `test/support/fake-rules.ts` pour les valeurs fictives des tests).
 */
import { createHash } from "node:crypto";
import { err, ok, type RequestContext } from "@ecoledigitale/kernel";
import { portUnavailable } from "../domain/errors";
import type {
  AssessPort,
  AssessmentFacts,
  ClassroomRoster,
  EligibilityFacts,
  EligibilityFactsPort,
  EnrollmentFacts,
  ExaminationsPorts,
  FamilyLinks,
  InstitutionDirectory,
  OfficialDocumentPort,
  OfficialDocumentRequest,
  OfficialDocumentState,
  PieceDocumentPort,
  PublishedGradeFact,
  RulesPort,
  StoragePort,
  StoredObject,
  StudentDirectory,
  StudentIdentity,
} from "../application/ports";

/** Tous les ports échouent fermé. */
export function unavailablePorts(): ExaminationsPorts {
  const fail = (port: string) => portUnavailable(port);
  const students: StudentDirectory = {
    async getEnrollment() { throw fail("students"); },
    async getClassroomRoster() { throw fail("students"); },
    async getIdentity() { throw fail("students"); },
  };
  return {
    students,
    eligibility: { async getEligibilityFacts() { return err(fail("eligibility")); } },
    institutions: { async exists() { throw fail("institutions"); }, async nameOf() { throw fail("institutions"); } },
    family: {
      async studentIdForUser() { return null; },
      async childrenOf() { return []; },
      async isGuardianOf() { return false; },
    },
    rules: { async resolve() { return err(fail("rules")); }, async open() { return err(fail("rules")); } },
    assess: { async getAssessment() { throw fail("assess"); }, async listPublishedGrades() { throw fail("assess"); } },
    pieces: { async verify() { throw fail("documents"); } },
    officialDocuments: { async request() { return err(fail("officialDocuments")); }, async read() { return err(fail("officialDocuments")); } },
    storage: {
      async put() { throw fail("storage"); },
      async get() { throw fail("storage"); },
      async delete() { throw fail("storage"); },
      async signedUrl() { throw fail("storage"); },
    },
  };
}

export class InMemoryStorage implements StoragePort {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  async put(key: string, bytes: Uint8Array, options: { contentType: string }): Promise<void> {
    this.objects.set(key, { bytes: new Uint8Array(bytes), contentType: options.contentType });
  }
  async get(key: string): Promise<StoredObject | null> {
    const o = this.objects.get(key);
    return o ? { bytes: o.bytes, contentType: o.contentType } : null;
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
  async signedUrl(key: string, options: { ttlSeconds: number; fileName: string; contentType: string }): Promise<{ url: string; expiresAt: Date }> {
    return { url: `memory://${key}?ttl=${options.ttlSeconds}`, expiresAt: new Date(Date.now() + options.ttlSeconds * 1000) };
  }
}

export interface WorldEnrollment {
  enrollmentId: string;
  studentId: string;
  institutionId: string;
  classroomId: string | null;
  gradeLevelCode: string | null;
  academicYearId?: string | null;
  active?: boolean;
}

export interface WorldAssessment {
  assessmentId: string;
  classroomId: string;
  typeCode: string | null;
  scaleMax: string;
  title?: string;
  published?: boolean;
  grades: Array<{ studentId: string; enrollmentId: string; score: string | null; entryStatus?: string }>;
}

/** Monde minimal des tests : on y déclare ce que les modules voisins fourniraient. */
export class InMemoryWorld {
  readonly identities = new Map<string, StudentIdentity>();
  readonly enrollments = new Map<string, WorldEnrollment>();
  readonly classrooms = new Map<string, { institutionId: string; gradeLevelCode: string | null }>();
  readonly institutions = new Map<string, string>();
  readonly assessments = new Map<string, WorldAssessment>();
  readonly eligibilityFacts = new Map<string, EligibilityFacts>();
  /** Pièces connues : documentId -> élève propriétaire. */
  readonly pieces = new Map<string, string>();
  /** Liens de tutelle : userId -> élèves. */
  readonly guardianship = new Map<string, Set<string>>();
  /** Compte élève : userId -> studentId. */
  readonly studentAccounts = new Map<string, string>();
  readonly storage = new InMemoryStorage();
  readonly officialRequests: OfficialDocumentRequest[] = [];
  readonly officialStates = new Map<string, OfficialDocumentState>();
  /** Si défini, `request` échoue avec ce code de refus (ex. nature de document inconnue de reportcards). */
  officialFailure: string | null = null;
  eligibilityFailure: string | null = null;

  addStudent(identity: StudentIdentity): StudentIdentity {
    this.identities.set(identity.studentId, identity);
    return identity;
  }

  addEnrollment(e: WorldEnrollment): void {
    this.enrollments.set(e.enrollmentId, e);
    if (e.classroomId && !this.classrooms.has(e.classroomId)) this.classrooms.set(e.classroomId, { institutionId: e.institutionId, gradeLevelCode: e.gradeLevelCode });
  }
}

const key = (ctx: RequestContext, ...parts: string[]): string => [ctx.tenantId, ...parts].join(":");

export function inMemoryPorts(world: InMemoryWorld, overrides: Partial<ExaminationsPorts> = {}): ExaminationsPorts {
  const students: StudentDirectory = {
    async getEnrollment(_ctx, enrollmentId): Promise<EnrollmentFacts | null> {
      const e = world.enrollments.get(enrollmentId);
      return e ? { enrollmentId: e.enrollmentId, studentId: e.studentId, institutionId: e.institutionId, classroomId: e.classroomId, gradeLevelCode: e.gradeLevelCode, academicYearId: e.academicYearId ?? null, active: e.active ?? true } : null;
    },
    async getClassroomRoster(_ctx, classroomId): Promise<ClassroomRoster | null> {
      const c = world.classrooms.get(classroomId);
      if (!c) return null;
      const items = [...world.enrollments.values()].filter((e) => e.classroomId === classroomId && (e.active ?? true)).map((e) => ({ enrollmentId: e.enrollmentId, studentId: e.studentId }));
      return { classroomId, institutionId: c.institutionId, gradeLevelCode: c.gradeLevelCode, items };
    },
    async getIdentity(_ctx, studentId) {
      return world.identities.get(studentId) ?? null;
    },
  };
  const eligibility: EligibilityFactsPort = {
    async getEligibilityFacts(_ctx, input) {
      if (world.eligibilityFailure) return err(portUnavailable("eligibility", world.eligibilityFailure));
      const fixed = world.eligibilityFacts.get(input.enrollmentId);
      if (fixed) return ok(fixed);
      const e = world.enrollments.get(input.enrollmentId);
      return ok({ inExamGrade: Boolean(e && input.examGradeLevelCode && e.gradeLevelCode === input.examGradeLevelCode), ageYears: null });
    },
  };
  const institutions: InstitutionDirectory = {
    async exists(_ctx, id) {
      return world.institutions.has(id);
    },
    async nameOf(_ctx, id) {
      return world.institutions.get(id) ?? null;
    },
  };
  const family: FamilyLinks = {
    async studentIdForUser(_ctx, userId) {
      return world.studentAccounts.get(userId) ?? null;
    },
    async childrenOf(_ctx, userId) {
      return [...(world.guardianship.get(userId) ?? [])];
    },
    async isGuardianOf(_ctx, userId, studentId) {
      return world.guardianship.get(userId)?.has(studentId) ?? false;
    },
  };
  const assess: AssessPort = {
    async getAssessment(_ctx, assessmentId): Promise<AssessmentFacts | null> {
      const a = world.assessments.get(assessmentId);
      return a ? { assessmentId, classroomId: a.classroomId, typeCode: a.typeCode, scaleMax: a.scaleMax, title: a.title ?? "Évaluation", published: a.published ?? true } : null;
    },
    async listPublishedGrades(_ctx, input): Promise<PublishedGradeFact[]> {
      const a = world.assessments.get(input.assessmentId);
      if (!a || a.classroomId !== input.classroomId || !(a.published ?? true)) return [];
      return a.grades.map((g) => ({ studentId: g.studentId, enrollmentId: g.enrollmentId, assessmentId: input.assessmentId, score: g.score, entryStatus: g.entryStatus ?? "ENTERED" }));
    },
  };
  const pieces: PieceDocumentPort = {
    async verify(_ctx, { documentId, studentId }) {
      return world.pieces.get(documentId) === studentId;
    },
  };
  const officialDocuments: OfficialDocumentPort = {
    async request(ctx, input) {
      if (world.officialFailure) return err(portUnavailable("officialDocuments", world.officialFailure));
      world.officialRequests.push(input);
      const documentId = deterministicUuid(key(ctx, input.kind, input.sourceId));
      world.officialStates.set(documentId, { documentId, status: "RENDERED", fileName: `${input.kind.toLowerCase()}.pdf`, bytes: new TextEncoder().encode(`%PDF-1.4 ${input.title}`), verificationCode: "TESTCODE" });
      return ok({ documentId });
    },
    async read(_ctx, documentId) {
      return ok(world.officialStates.get(documentId) ?? null);
    },
  };
  return {
    students,
    eligibility,
    institutions,
    family,
    // Aucune règle d'examen dans un monde neutre : un test qui en a besoin fournit son évaluateur.
    rules: unavailablePorts().rules satisfies RulesPort,
    assess,
    pieces,
    officialDocuments,
    storage: world.storage,
    ...overrides,
  };
}

/** UUID déterministe (v4 formaté) dérivé d'une chaîne : identifiant stable d'un document de test. */
export function deterministicUuid(seed: string): string {
  const h = createHash("sha256").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
