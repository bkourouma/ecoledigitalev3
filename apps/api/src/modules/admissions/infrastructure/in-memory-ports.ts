/**
 * Ports en mémoire (développement contre des PORTS, tests) et ports « indisponibles » (échec fermé quand rien n'est branché).
 *
 * `InMemoryWorld` simule people / academic / finance / documents / catalogue : aucun accès disque ni réseau, identifiants
 * déterministes, point d'échec injectable par étape (`failAt`) pour prouver l'atomicité de l'acceptation d'une offre. Ce n'est
 * PAS un double transactionnel : l'état mémoire n'est pas annulé avec la transaction SQL — les tests d'atomicité vérifient donc
 * l'état de la BASE (aucune ligne d'application, d'offre ou d'événement) et les compteurs d'appels.
 */
import { createHash } from "node:crypto";
import { InternalError, type RequestContext } from "@ecoledigitale/kernel";
import { validation } from "../domain/errors";
import { AdmissionsCode, portUnavailable } from "../domain/errors";
import type {
  ActorDirectory,
  AdmissionsPorts,
  ApplicantMessage,
  ApplicantNotifier,
  Captcha,
  ClassroomInfo,
  DeliveryReceipt,
  DocumentStore,
  EnrollmentService,
  InstitutionCatalog,
  InstitutionInfo,
  NewEnrollment,
  NewGuardian,
  NewStudent,
  RegistrationFeeService,
  StoredPiece,
  StudentDuplicate,
  StudentRegistry,
  Uuid,
} from "../application/ports";

// ---------------------------------------------------------------------------
// Ports indisponibles : échec FERMÉ
// ---------------------------------------------------------------------------

const unavailable = (port: string, expected: string) => (): never => {
  throw portUnavailable(port, expected);
};

export function unavailablePorts(): AdmissionsPorts {
  const students = unavailable("people", "createStudent, createGuardian, linkGuardian, findDuplicateStudents, changeStudentStatus (module people)");
  const enrollments = unavailable("academic", "enrollStudent, transitionEnrollment cancel (module academic)");
  const fees = unavailable("finance", "issueInvoiceFromSchedule, cancelInvoice, isRegistrationFeeDue (module finance)");
  const catalog = unavailable("catalog", "getInstitution, listClassrooms (modules tenancy, academic), listRelationshipTypes (people)");
  const documents = unavailable("documents", "stockage d'objets + contrôle de type réel (StoragePort ou module documents)");
  return {
    students: { findDuplicateStudents: students, studentExists: students, createStudent: students, createGuardian: students, linkGuardian: students, changeStudentStatus: students },
    enrollments: { enrollStudent: enrollments, cancelEnrollment: enrollments },
    fees: { issueRegistrationInvoice: fees, cancelInvoice: fees },
    catalog: { listInstitutions: catalog, getInstitution: catalog, gradeLevels: catalog, classroom: catalog, classroomsOf: catalog, relationshipTypes: catalog },
    documents: { store: documents, remove: documents, link: documents, signedUrl: documents },
    notifier: UNAVAILABLE_NOTIFIER,
    captcha: null,
    actors: { async displayName() { return null; } },
  };
}

/** Aucun canal : `send` lève ; le module consigne `SKIPPED` / `CHANNEL_UNAVAILABLE` (jamais de simulation d'envoi). */
export const UNAVAILABLE_NOTIFIER: ApplicantNotifier = Object.freeze({
  async send(): Promise<DeliveryReceipt> {
    throw new InternalError("Aucun canal de notification n'est disponible.", { code: "admissions.channel_unavailable" });
  },
});

// ---------------------------------------------------------------------------
// Monde en mémoire
// ---------------------------------------------------------------------------

export type FailPoint = "findDuplicates" | "createStudent" | "createGuardian" | "linkGuardian" | "enrollStudent" | "issueInvoice" | "cancelEnrollment" | "cancelInvoice" | "changeStudentStatus";

const hex = (n: number): string => n.toString(16).padStart(12, "0");
/** UUID v4 déterministe (variante 8) : stable d'un test à l'autre. */
const uuid = (prefix: string, n: number): string => `${prefix}-0000-4000-8000-${hex(n)}`.replace(/^([0-9a-f]{8})-/, (_m, p: string) => `${p}-`);

export interface WorldStudent {
  id: Uuid;
  number: string;
  status: string;
  externalRef: string;
  input: NewStudent;
  guardians: Array<{ guardianId: Uuid; relationshipCode: string; isPrimaryContact: boolean; isFinancialResponsible: boolean }>;
}

export class InMemoryWorld {
  institutions: InstitutionInfo[] = [];
  grades = new Map<Uuid, Array<{ code: string; label: string }>>();
  classrooms: ClassroomInfo[] = [];
  relationships: Array<{ code: string; label: string }> = [
    { code: "FATHER", label: "Père" },
    { code: "MOTHER", label: "Mère" },
    { code: "GUARDIAN", label: "Tuteur" },
    { code: "OTHER", label: "Autre" },
  ];
  students = new Map<Uuid, WorldStudent>();
  guardiansCreated = new Map<Uuid, NewGuardian>();
  enrollments = new Map<Uuid, { id: Uuid; studentId: Uuid; classroomId: Uuid; status: string; input: NewEnrollment; cancelReason?: string }>();
  invoices = new Map<Uuid, { id: Uuid; enrollmentId: Uuid; cancelled: boolean; key: string }>();
  invoiceByKey = new Map<string, Uuid>();
  pieces = new Map<string, { bytes: Uint8Array; piece: StoredPiece; linkedTo?: Uuid; removed?: boolean }>();
  sent: ApplicantMessage[] = [];
  duplicatesFor: StudentDuplicate[] = [];
  /** Frais d'inscription dus ? (`false` : `issueRegistrationInvoice` renvoie `null` et l'inscription est confirmée d'emblée). */
  feeDue = true;
  /** Étape à faire échouer (une fois consommée, redevient nulle sauf `failAlways`). */
  failAt: FailPoint | null = null;
  failAlways = false;
  notifierEnabled = true;
  actorNames = new Map<Uuid, string>();
  calls: string[] = [];
  private seq = 0;
  private studentSeq = 0;

  private next(): number {
    this.seq += 1;
    return this.seq;
  }
  private id(prefix: string): string {
    return uuid(prefix, this.next());
  }
  private maybeFail(point: FailPoint): void {
    this.calls.push(point);
    if (this.failAt === point) {
      if (!this.failAlways) this.failAt = null;
      throw new InternalError(`Échec injecté à l'étape ${point}.`, { code: "admissions.injected_failure" });
    }
  }

  addInstitution(name: string, id: Uuid = this.id("11111111")): InstitutionInfo {
    const info = { id, name };
    this.institutions.push(info);
    this.grades.set(id, [
      { code: "CP1", label: "Cours préparatoire 1" },
      { code: "CP2", label: "Cours préparatoire 2" },
      { code: "6EME", label: "Sixième" },
    ]);
    return info;
  }

  addClassroom(input: { institutionId: Uuid; academicYearId: Uuid; gradeLevelCode: string; label?: string; open?: boolean; id?: Uuid }): ClassroomInfo {
    const room: ClassroomInfo = { id: input.id ?? this.id("22222222"), label: input.label ?? `${input.gradeLevelCode} A`, institutionId: input.institutionId, academicYearId: input.academicYearId, gradeLevelCode: input.gradeLevelCode, open: input.open ?? true };
    this.classrooms.push(room);
    return room;
  }

  readonly students_: StudentRegistry = {
    findDuplicateStudents: async () => {
      this.maybeFail("findDuplicates");
      return this.duplicatesFor;
    },
    studentExists: async (_ctx, studentId) => this.students.has(studentId),
    createStudent: async (_ctx, input) => {
      this.maybeFail("createStudent");
      const existing = [...this.students.values()].find((s) => s.externalRef === input.externalRef);
      if (existing) return { studentId: existing.id, studentNumber: existing.number, status: existing.status };
      this.studentSeq += 1;
      const student: WorldStudent = { id: this.id("33333333"), number: `MAT-${String(this.studentSeq).padStart(5, "0")}`, status: "INACTIVE", externalRef: input.externalRef, input, guardians: [] };
      this.students.set(student.id, student);
      return { studentId: student.id, studentNumber: student.number, status: student.status };
    },
    createGuardian: async (_ctx, guardian) => {
      this.maybeFail("createGuardian");
      const id = this.id("44444444");
      this.guardiansCreated.set(id, guardian);
      return { guardianId: id };
    },
    linkGuardian: async (_ctx, link) => {
      this.maybeFail("linkGuardian");
      this.students.get(link.studentId)?.guardians.push({ guardianId: link.guardianId, relationshipCode: link.relationshipCode, isPrimaryContact: link.isPrimaryContact, isFinancialResponsible: link.isFinancialResponsible });
    },
    changeStudentStatus: async (_ctx, studentId, status) => {
      this.maybeFail("changeStudentStatus");
      const s = this.students.get(studentId);
      if (s) s.status = status;
    },
  };

  readonly enrollments_: EnrollmentService = {
    enrollStudent: async (_ctx, input) => {
      this.maybeFail("enrollStudent");
      const room = this.classrooms.find((c) => c.id === input.classroomId);
      if (!room) throw validation(AdmissionsCode.CLASSROOM_INVALID, "Classe inconnue.");
      const id = this.id("55555555");
      const status = this.feeDue ? "PENDING" : "ACTIVE";
      this.enrollments.set(id, { id, studentId: input.studentId, classroomId: input.classroomId, status, input });
      return { enrollmentId: id, registrationNumber: `INS-${String(this.enrollments.size).padStart(5, "0")}`, status };
    },
    cancelEnrollment: async (_ctx, enrollmentId, reason) => {
      this.maybeFail("cancelEnrollment");
      const e = this.enrollments.get(enrollmentId);
      if (e) {
        e.status = "CANCELLED";
        e.cancelReason = reason;
      }
    },
  };

  readonly fees_: RegistrationFeeService = {
    issueRegistrationInvoice: async (_ctx, input) => {
      this.maybeFail("issueInvoice");
      if (!this.feeDue) return { invoiceId: null };
      const known = this.invoiceByKey.get(input.idempotencyKey);
      if (known) return { invoiceId: known };
      const id = this.id("66666666");
      this.invoices.set(id, { id, enrollmentId: input.enrollmentId, cancelled: false, key: input.idempotencyKey });
      this.invoiceByKey.set(input.idempotencyKey, id);
      return { invoiceId: id };
    },
    cancelInvoice: async (_ctx, invoiceId) => {
      this.maybeFail("cancelInvoice");
      const inv = this.invoices.get(invoiceId);
      if (inv) inv.cancelled = true;
    },
  };

  readonly catalog_: InstitutionCatalog = {
    listInstitutions: async () => this.institutions,
    getInstitution: async (_c, id) => this.institutions.find((i) => i.id === id) ?? null,
    gradeLevels: async (_c, institutionId) => this.grades.get(institutionId) ?? [],
    classroom: async (_c, id) => this.classrooms.find((c) => c.id === id) ?? null,
    classroomsOf: async (_c, q) => this.classrooms.filter((c) => c.institutionId === q.institutionId && c.academicYearId === q.academicYearId && c.gradeLevelCode === q.gradeLevelCode && c.open),
    relationshipTypes: async () => this.relationships,
  };

  readonly documents_: DocumentStore = {
    store: async (_ctx, input) => {
      const sha = createHash("sha256").update(input.bytes).digest("hex");
      const sniffed = sniff(input.bytes);
      if (!sniffed || !input.acceptsMime.includes(sniffed)) throw validation(AdmissionsCode.FILE_REJECTED, "Type de fichier non accepté pour cette pièce.", "file");
      if (input.bytes.byteLength > input.maxSizeBytes) throw validation(AdmissionsCode.FILE_REJECTED, "Le fichier dépasse la taille maximale.", "file");
      const key = `admissions/${input.applicationId}/${input.requirementId}/${sha}`;
      const piece: StoredPiece = { storageKey: key, documentRef: null, contentType: sniffed, sizeBytes: input.bytes.byteLength, sha256: sha };
      this.pieces.set(key, { bytes: input.bytes, piece });
      return piece;
    },
    remove: async (_ctx, piece) => {
      const p = piece.storageKey ? this.pieces.get(piece.storageKey) : undefined;
      if (p) p.removed = true;
    },
    link: async (_ctx, piece, owner) => {
      const p = piece.storageKey ? this.pieces.get(piece.storageKey) : undefined;
      if (!p) return { linked: false };
      p.linkedTo = owner.id;
      return { linked: true };
    },
    signedUrl: async (_ctx, piece) => ({ url: `memory://${piece.storageKey}`, expiresAt: new Date(Date.now() + 60_000) }),
  };

  readonly notifier_: ApplicantNotifier = {
    send: async (_ctx, message) => {
      if (!this.notifierEnabled) throw new InternalError("Aucun canal.", { code: "admissions.channel_unavailable" });
      this.sent.push(message);
      return { channel: message.recipient.email ? "EMAIL" : "SMS", status: "SENT", providerRef: `mem-${this.sent.length}` };
    },
  };

  readonly actors_: ActorDirectory = { displayName: async (_c, userId) => this.actorNames.get(userId) ?? null };

  captcha: Captcha | null = null;

  ports(overrides: Partial<AdmissionsPorts> = {}): AdmissionsPorts {
    return {
      students: this.students_,
      enrollments: this.enrollments_,
      fees: this.fees_,
      catalog: this.catalog_,
      documents: this.documents_,
      notifier: this.notifier_,
      captcha: this.captcha,
      actors: this.actors_,
      ...overrides,
    };
  }
}

/** Détection minimale des octets magiques (le double de test ; la plateforme réelle utilise `documents.detectFileType`). */
function sniff(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return "application/pdf";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  return null;
}

export type { RequestContext };
