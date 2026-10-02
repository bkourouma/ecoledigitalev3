/**
 * Ports de `academic` : ce que le module consomme d'AUTRES modules, sans en importer le code (ADR-001, D-20).
 * Les implémentations sont branchées au câblage ; un port non câblé a un COMPORTEMENT DE REPLI EXPLICITE ET SÛR
 * (documenté ici et dans le README).
 *
 *   StudentDirectory        people     repli : refus (`student_not_found`) — on n'inscrit pas un inconnu
 *   PeriodClosureGuard      011, 013   repli : aucun refus
 *   CurriculumUsageGuard    011, 019   repli : « utilisé » (refus de tout amendement structurel) — sûr
 *   OfferingReadinessGuard  people     repli : aucun refus
 *   CompletionLookup        011, 019   repli : sélections `COMPLETED` (lecture locale)
 *   ScheduleConflictChecker scheduling repli : aucun conflit
 *   TemplateProvider        tenancy    repli : modèles livrés avec le module (`templates/CI/*.json`)
 *   InstitutionDirectory    tenancy    repli : accepte tout UUID, fuseau UTC
 *   RegistrationFeeProbe    finance    repli : inconnu (`null`) -> inscription `PENDING`
 *   InvoiceFactsReader      finance    repli : aucun fait -> la facture ne confirme rien
 *   GuardianshipPort        people     repli : jamais tuteur
 */
import type { RequestContext, Result } from "@ecoledigitale/kernel";
import { ok } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { AcademicPack } from "@ecoledigitale/contracts/src/v2/academic";
import type { AcademicPackTemplate } from "../domain/template";
import { defaultAcademicTemplates, getAcademicTemplate } from "../templates";

// ---------------------------------------------------------------------------
// Audit (même transaction que l'opération sensible, convention n° 8)
// ---------------------------------------------------------------------------

export interface AuditEntry {
  /** `academic.<entité>.<verbe>` — ex. `academic.period.reopened`. */
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  /** Opération sensible (réouverture de période, amendement, financement affecté, modèle de pack, reconduction…). */
  readonly sensitive?: boolean;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly reason?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AuditPort {
  record(tx: Tx, ctx: RequestContext, entry: AuditEntry): Promise<void>;
}

export const noopAudit: AuditPort = Object.freeze({
  async record(): Promise<void> {
    /* le module audit n'est pas branché */
  },
});

/** Collecteur en mémoire, pour les tests. */
export class RecordingAudit implements AuditPort {
  readonly entries: Array<{ ctx: RequestContext; entry: AuditEntry }> = [];
  async record(_tx: Tx, ctx: RequestContext, entry: AuditEntry): Promise<void> {
    this.entries.push({ ctx, entry });
  }
  actions(): string[] {
    return this.entries.map((e) => e.entry.action);
  }
}

// ---------------------------------------------------------------------------
// people
// ---------------------------------------------------------------------------

export interface StudentSummary {
  studentId: string;
  /** Statut du dossier (`ACTIVE`, `WITHDRAWN`, …) : défini par le module people. */
  status: string;
  displayName: string;
  studentNumber: string | null;
  /** Numéro d'ordre figé du dossier (jeton `{STUDENT_SEQ:n}` du numéro d'inscription). */
  sequenceNumber: number | null;
}

export interface StudentDirectory {
  /** `null` si l'apprenant n'existe pas dans le tenant du contexte. */
  getStudent(ctx: RequestContext, studentId: string): Promise<StudentSummary | null>;
  /** Dossier lié à un compte utilisateur (portail élève) ; absent = pas de portail. */
  findStudentByUserId?(ctx: RequestContext, userId: string): Promise<{ studentId: string } | null>;
}

export const refuseUnknownStudents: StudentDirectory = Object.freeze({
  async getStudent(): Promise<StudentSummary | null> {
    return null;
  },
});

/** Annuaire en mémoire (tests, développement). */
export class InMemoryStudentDirectory implements StudentDirectory {
  private readonly byId = new Map<string, StudentSummary>();
  private readonly byUser = new Map<string, string>();
  constructor(students: ReadonlyArray<StudentSummary> = []) {
    for (const s of students) this.byId.set(s.studentId, s);
  }
  add(student: StudentSummary, userId?: string): void {
    this.byId.set(student.studentId, student);
    if (userId) this.byUser.set(userId, student.studentId);
  }
  setStatus(studentId: string, status: string): void {
    const s = this.byId.get(studentId);
    if (s) this.byId.set(studentId, { ...s, status });
  }
  async getStudent(_ctx: RequestContext, studentId: string): Promise<StudentSummary | null> {
    return this.byId.get(studentId) ?? null;
  }
  async findStudentByUserId(_ctx: RequestContext, userId: string): Promise<{ studentId: string } | null> {
    const id = this.byUser.get(userId);
    return id ? { studentId: id } : null;
  }
}

export interface GuardianshipPort {
  isGuardianOfStudent(ctx: RequestContext, userId: string, studentId: string): Promise<boolean>;
}
export const noGuardianship: GuardianshipPort = Object.freeze({
  async isGuardianOfStudent(): Promise<boolean> {
    return false;
  },
});

export interface OfferingReadinessGuard {
  /** Un responsable d'enseignement pour chaque nœud obligatoire non transversal. */
  check(ctx: RequestContext, offeringId: string): Promise<Result<void, { missing: string[] }>>;
}
export const alwaysReady: OfferingReadinessGuard = Object.freeze({
  async check(): Promise<Result<void, { missing: string[] }>> {
    return ok(undefined);
  },
});

// ---------------------------------------------------------------------------
// assess / results / reportcards / higher
// ---------------------------------------------------------------------------

export interface PeriodClosureGuard {
  canClose(
    ctx: RequestContext,
    input: { periodId: string; classroomId: string | null; to: "GRADING_CLOSED" | "CLOSED" },
  ): Promise<Result<void, { code: string; reason: string }>>;
}
export const neverBlockClosure: PeriodClosureGuard = Object.freeze({
  async canClose(): Promise<Result<void, { code: string; reason: string }>> {
    return ok(undefined);
  },
});

export interface CurriculumUsageGuard {
  /** Une note, une évaluation ou un résultat dépend-il de ce nœud ? */
  isNodeInUse(ctx: RequestContext, nodeId: string): Promise<boolean>;
}
/** Repli SÛR : sans le module qui sait, on considère le nœud utilisé (aucun amendement structurel). */
export const assumeNodesInUse: CurriculumUsageGuard = Object.freeze({
  async isNodeInUse(): Promise<boolean> {
    return true;
  },
});

export interface CompletionLookup {
  hasValidated(ctx: RequestContext, input: { studentId: string; lineageId: string }): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// scheduling
// ---------------------------------------------------------------------------

export interface ScheduleConflictChecker {
  checkStudentOffering(ctx: RequestContext, input: { enrollmentId: string; offeringId: string }): Promise<{ conflicts: Array<{ description: string }> }>;
}
export const noScheduleConflicts: ScheduleConflictChecker = Object.freeze({
  async checkStudentOffering(): Promise<{ conflicts: Array<{ description: string }> }> {
    return { conflicts: [] };
  },
});

// ---------------------------------------------------------------------------
// tenancy
// ---------------------------------------------------------------------------

export interface TemplateProvider {
  getSection(pack: AcademicPack, educationSystem: string, section: "academic"): AcademicPackTemplate | undefined;
}
export const bundledTemplates: TemplateProvider = Object.freeze({
  getSection(pack: AcademicPack, educationSystem: string): AcademicPackTemplate | undefined {
    return getAcademicTemplate(educationSystem, pack, defaultAcademicTemplates());
  },
});

export interface InstitutionInfo {
  id: string;
  pack: AcademicPack | null;
  educationSystem: string | null;
  countryCode: string | null;
  /** Fuseau IANA de l'établissement (profil du pays) ; `null` = UTC. */
  timezone: string | null;
}
export interface InstitutionDirectory {
  getInstitution(ctx: RequestContext, institutionId: string): Promise<InstitutionInfo | null>;
}
export const anyInstitution: InstitutionDirectory = Object.freeze({
  async getInstitution(_ctx: RequestContext, institutionId: string): Promise<InstitutionInfo> {
    return { id: institutionId, pack: null, educationSystem: null, countryCode: null, timezone: null };
  },
});

// ---------------------------------------------------------------------------
// finance
// ---------------------------------------------------------------------------

export interface RegistrationFeeProbe {
  /**
   * Des frais d'inscription sont-ils dus pour cette inscription ? `false` = AUCUN frais (confirmation immédiate
   * sous la politique `ON_REGISTRATION_FEE_PAID`, équivalent de la correction 0127 du legacy) ; `null` = inconnu.
   */
  registrationFeeDue(
    ctx: RequestContext,
    input: { studentId: string; classroomId: string; institutionId: string; academicYearId: string; programId: string; gradeLevelId: string; fundingType: string },
  ): Promise<boolean | null>;
}
export const unknownRegistrationFee: RegistrationFeeProbe = Object.freeze({
  async registrationFeeDue(): Promise<boolean | null> {
    return null;
  },
});

export interface InvoiceFacts {
  invoiceId: string;
  learnerId: string;
  enrollmentId: string | null;
  lines: Array<{ category: string; sourceRef: string | null }>;
}
export interface InvoiceFactsReader {
  getInvoiceFacts(ctx: RequestContext, invoiceId: string): Promise<InvoiceFacts | null>;
}
export const noInvoiceFacts: InvoiceFactsReader = Object.freeze({
  async getInvoiceFacts(): Promise<InvoiceFacts | null> {
    return null;
  },
});

/** Catégorie de ligne de facture qui désigne les frais d'inscription (convention de finance : `REGISTRATION`). */
export const REGISTRATION_FEE_CATEGORY = "REGISTRATION";

// ---------------------------------------------------------------------------
// results
// ---------------------------------------------------------------------------

/**
 * Décision de passage de fin d'année d'une inscription, telle que `results` l'a CONFIRMÉE. academic ne la calcule jamais :
 * il la lit (reconduction annuelle) quand l'inscription n'a pas d'issue enregistrée à la main.
 */
export interface PromotionDecision {
  enrollmentId: string;
  /** Nature de la décision : passage au niveau suivant, redoublement, sortie. */
  kind: "ADVANCE" | "REPEAT" | "EXIT";
  /** Code de la décision côté `results` (traçabilité), jamais un libellé. */
  sourceCode: string | null;
}

export interface PromotionDecisionPort {
  /** Décisions confirmées de l'année source pour ces inscriptions ; une inscription sans décision confirmée est omise. */
  listDecisions(ctx: RequestContext, input: { academicYearId: string; enrollmentIds: readonly string[] }): Promise<PromotionDecision[]>;
}
export const noPromotionDecisions: PromotionDecisionPort = Object.freeze({
  async listDecisions(): Promise<PromotionDecision[]> {
    return [];
  },
});

export interface AcademicPorts {
  students: StudentDirectory;
  guardianship: GuardianshipPort;
  periodGuard: PeriodClosureGuard;
  usageGuard: CurriculumUsageGuard;
  readiness: OfferingReadinessGuard;
  /** `undefined` = repli local (sélections `COMPLETED`). */
  completion: CompletionLookup | undefined;
  schedule: ScheduleConflictChecker;
  templates: TemplateProvider;
  institutions: InstitutionDirectory;
  registrationFee: RegistrationFeeProbe;
  invoiceFacts: InvoiceFactsReader;
  promotions: PromotionDecisionPort;
}

export const DEFAULT_PORTS: AcademicPorts = Object.freeze({
  students: refuseUnknownStudents,
  guardianship: noGuardianship,
  periodGuard: neverBlockClosure,
  usageGuard: assumeNodesInUse,
  readiness: alwaysReady,
  completion: undefined,
  schedule: noScheduleConflicts,
  templates: bundledTemplates,
  institutions: anyInstitution,
  registrationFee: unknownRegistrationFee,
  invoiceFacts: noInvoiceFacts,
  promotions: noPromotionDecisions,
});
