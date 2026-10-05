/**
 * Implémentations des ports :
 *  - EN MÉMOIRE : pour les tests du module et ceux des modules consommateurs ; elles se remplissent à la main
 *    (`addUe`, `setFinalLines`, `addSignatory`…) ;
 *  - `unavailablePorts` : ports par défaut du plugin tant que `academic`, `people`, `results`, `rules` et `reportcards` ne
 *    sont pas branchés — le module échoue FERMÉ (`higher.port_unavailable`), jamais en silence.
 *
 * Le port des RÈGLES en mémoire (`ScriptedRules`) ne contient AUCUNE formule : il rend ce que le test lui fait rendre.
 * La règle réelle (`diplome_eligible`, `moyenne_annuelle`, `mention_diplome`) vit dans le RuleSet du module rules ; la
 * parité est prouvée par un test d'intégration qui évalue le vrai RuleSet.
 */
import { createHash } from "node:crypto";
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { portUnavailable } from "../domain/errors";
import type { DecimalString, Uuid } from "../domain/types";
import type {
  ActorDirectory,
  AnnualUeEvaluation,
  AnnualUeEvaluationInput,
  CreditsSourcePort,
  CurriculumNodeInfo,
  CurriculumPort,
  CycleEnrollment,
  CycleEvaluation,
  CycleResults,
  CycleResultsPort,
  DiplomaRulesPort,
  DocumentFilesPort,
  EligibilityEvaluation,
  EnrollmentDirectory,
  EnrollmentInfo,
  HigherPorts,
  InstitutionPort,
  InstitutionProfile,
  LastEnrollment,
  ListFinalLinesQuery,
  RenderedDocumentFile,
  ResitCandidateLine,
  ResitCandidates,
  ResitSessionPort,
  RuleRef,
  RuleScope,
  SealedDocumentInfo,
  SignatoryDirectory,
  SignatoryInfo,
  StudentDirectory,
  StudentIdentity,
  UeInfo,
  UeResultLine,
} from "../application/ports";

// ---------------------------------------------------------------------------
// Ports indisponibles (échec fermé)
// ---------------------------------------------------------------------------

function unavailable<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get(_t, prop) {
      if (prop === "then") return undefined; // ne pas se faire passer pour une promesse
      return () => Promise.reject(portUnavailable(`${name}.${String(prop)}`));
    },
  });
}

export function unavailablePorts(overrides: Partial<HigherPorts> = {}): HigherPorts {
  return {
    documents: unavailable<DocumentFilesPort>("DocumentFilesPort"),
    credits: unavailable<CreditsSourcePort>("CreditsSourcePort"),
    resitSession: unavailable<ResitSessionPort>("ResitSessionPort"),
    cycleResults: unavailable<CycleResultsPort>("CycleResultsPort"),
    curriculum: unavailable<CurriculumPort>("CurriculumPort"),
    enrollments: unavailable<EnrollmentDirectory>("EnrollmentDirectory"),
    students: unavailable<StudentDirectory>("StudentDirectory"),
    actors: unavailable<ActorDirectory>("ActorDirectory"),
    signatories: unavailable<SignatoryDirectory>("SignatoryDirectory"),
    institution: unavailable<InstitutionPort>("InstitutionPort"),
    rules: unavailable<DiplomaRulesPort>("DiplomaRulesPort"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// results
// ---------------------------------------------------------------------------

const key2 = (a: Uuid, b: Uuid): string => `${a}|${b}`;

export class InMemoryCredits implements CreditsSourcePort {
  private readonly lines = new Map<string, UeResultLine[]>();
  private readonly resit = new Map<string, ResitCandidates>();
  /** Nombre d'appels, pour prouver l'absence de recalcul. */
  calls = 0;

  /** Remplace les lignes FINAL d'une classe × période (la reclôture publie une version supérieure). */
  setFinalLines(classroomId: Uuid, academicPeriodId: Uuid, lines: readonly UeResultLine[]): void {
    this.lines.set(key2(classroomId, academicPeriodId), [...lines]);
  }

  setResitCandidates(classroomId: Uuid, academicPeriodId: Uuid, value: ResitCandidates): void {
    this.resit.set(key2(classroomId, academicPeriodId), value);
  }

  async listFinalUeLines(_ctx: RequestContext, query: ListFinalLinesQuery): Promise<readonly UeResultLine[]> {
    this.calls += 1;
    const all = this.lines.get(key2(query.classroomId, query.academicPeriodId)) ?? [];
    if (query.resultsVersion === undefined) return all;
    return all.filter((l) => l.resultsVersion === query.resultsVersion);
  }

  async listResitCandidates(_ctx: RequestContext, query: { classroomId: Uuid; academicPeriodId: Uuid }): Promise<ResitCandidates> {
    return this.resit.get(key2(query.classroomId, query.academicPeriodId)) ?? { stateId: "00000000-0000-7000-8000-00000000dead", candidates: [] };
  }
}

export class InMemoryResitSession implements ResitSessionPort {
  readonly opened: Array<{ stateId: Uuid; classroomId: Uuid; academicPeriodId: Uuid; nodeIds: readonly Uuid[] }> = [];
  readonly closed: Array<{ stateId: Uuid | null; classroomId: Uuid; academicPeriodId: Uuid }> = [];
  failOnOpen: AppError | null = null;
  async openResitSession(_ctx: RequestContext, input: { stateId: Uuid; classroomId: Uuid; academicPeriodId: Uuid; nodeIds: readonly Uuid[] }): Promise<void> {
    if (this.failOnOpen) throw this.failOnOpen;
    this.opened.push(input);
  }
  async closeResitSession(_ctx: RequestContext, input: { stateId: Uuid | null; classroomId: Uuid; academicPeriodId: Uuid }): Promise<void> {
    this.closed.push(input);
  }
}

export class InMemoryCycleResults implements CycleResultsPort {
  private readonly byKey = new Map<string, CycleResults>();
  set(studentId: Uuid, nodeId: Uuid, value: CycleResults): void {
    this.byKey.set(key2(studentId, nodeId), value);
  }
  async getCycleResults(_ctx: RequestContext, input: { studentId: Uuid; nodeId: Uuid }): Promise<CycleResults> {
    return this.byKey.get(key2(input.studentId, input.nodeId)) ?? { complete: false, semesters: [] };
  }
}

// ---------------------------------------------------------------------------
// academic
// ---------------------------------------------------------------------------

export class InMemoryCurriculum implements CurriculumPort {
  private readonly nodes = new Map<Uuid, CurriculumNodeInfo>();
  private readonly ues = new Map<Uuid, UeInfo>();
  private readonly cycleUes = new Map<Uuid, Uuid[]>();

  addProgram(nodeId: Uuid, code: string, label = code): void {
    this.nodes.set(nodeId, { nodeId, code, label, isCycle: false, isProgram: true });
  }
  addCycle(nodeId: Uuid, code: string, label = code): void {
    this.nodes.set(nodeId, { nodeId, code, label, isCycle: true, isProgram: false });
  }
  /** Ajoute une UE à un programme et, si fourni, à un cycle. */
  addUe(ue: UeInfo, cycleNodeId?: Uuid): void {
    this.ues.set(ue.nodeId, ue);
    if (cycleNodeId) this.cycleUes.set(cycleNodeId, [...(this.cycleUes.get(cycleNodeId) ?? []), ue.nodeId]);
  }
  /** Retire une UE du curriculum (cas « UE retirée »). */
  removeUe(nodeId: Uuid): void {
    this.ues.delete(nodeId);
    for (const [k, v] of this.cycleUes) this.cycleUes.set(k, v.filter((x) => x !== nodeId));
  }
  updateCredits(nodeId: Uuid, credits: number): void {
    const ue = this.ues.get(nodeId);
    if (ue) this.ues.set(nodeId, { ...ue, credits });
  }

  async getNode(_ctx: RequestContext, nodeId: Uuid): Promise<CurriculumNodeInfo | null> {
    return this.nodes.get(nodeId) ?? null;
  }
  async getUe(_ctx: RequestContext, ueNodeId: Uuid): Promise<UeInfo | null> {
    return this.ues.get(ueNodeId) ?? null;
  }
  async listCycleUe(_ctx: RequestContext, cycleNodeId: Uuid): Promise<readonly UeInfo[]> {
    return (this.cycleUes.get(cycleNodeId) ?? []).map((id) => this.ues.get(id)).filter((u): u is UeInfo => Boolean(u));
  }
  async listProgramUe(_ctx: RequestContext, programNodeId: Uuid): Promise<readonly UeInfo[]> {
    return [...this.ues.values()].filter((u) => u.programNodeId === programNodeId);
  }
}

export class InMemoryEnrollments implements EnrollmentDirectory {
  private readonly cycle = new Map<Uuid, CycleEnrollment[]>();
  private readonly last = new Map<string, LastEnrollment>();
  private readonly enrollments = new Map<Uuid, EnrollmentInfo>();
  private readonly registrants = new Map<Uuid, Uuid[]>();
  private readonly attended = new Set<string>();

  addCycleEnrollment(cycleNodeId: Uuid, e: CycleEnrollment, lastLabel: string | null = null): void {
    this.cycle.set(cycleNodeId, [...(this.cycle.get(cycleNodeId) ?? []), e]);
    this.enrollments.set(e.enrollmentId, { ...e, active: true });
    this.last.set(key2(e.studentId, cycleNodeId), { enrollmentId: e.enrollmentId, academicYearId: e.academicYearId, academicYearLabel: lastLabel });
  }
  setLastEnrollment(studentId: Uuid, nodeId: Uuid, value: LastEnrollment): void {
    this.last.set(key2(studentId, nodeId), value);
  }
  addEnrollment(info: EnrollmentInfo): void {
    this.enrollments.set(info.enrollmentId, info);
  }
  addRegistrant(ueNodeId: Uuid, studentId: Uuid): void {
    this.registrants.set(ueNodeId, [...(this.registrants.get(ueNodeId) ?? []), studentId]);
  }
  markAttended(studentId: Uuid, ueNodeId: Uuid): void {
    this.attended.add(key2(studentId, ueNodeId));
  }

  async listCycleEnrollments(_ctx: RequestContext, cycleNodeId: Uuid): Promise<readonly CycleEnrollment[]> {
    return this.cycle.get(cycleNodeId) ?? [];
  }
  async getLastEnrollment(_ctx: RequestContext, input: { studentId: Uuid; nodeId: Uuid }): Promise<LastEnrollment | null> {
    return this.last.get(key2(input.studentId, input.nodeId)) ?? null;
  }
  async getEnrollment(_ctx: RequestContext, enrollmentId: Uuid): Promise<EnrollmentInfo | null> {
    return this.enrollments.get(enrollmentId) ?? null;
  }
  async listUeRegistrants(_ctx: RequestContext, ueNodeId: Uuid): Promise<readonly Uuid[]> {
    return this.registrants.get(ueNodeId) ?? [];
  }
  async hasAttendedUe(_ctx: RequestContext, input: { studentId: Uuid; ueNodeId: Uuid }): Promise<boolean> {
    return this.attended.has(key2(input.studentId, input.ueNodeId));
  }
}

// ---------------------------------------------------------------------------
// people, reportcards
// ---------------------------------------------------------------------------

export class InMemoryStudents implements StudentDirectory {
  private readonly identities = new Map<Uuid, StudentIdentity>();
  private readonly userToStudent = new Map<Uuid, Uuid>();
  private readonly guardians = new Set<string>();
  add(identity: StudentIdentity, userId?: Uuid): void {
    this.identities.set(identity.studentId, identity);
    if (userId) this.userToStudent.set(userId, identity.studentId);
  }
  addGuardian(userId: Uuid, studentId: Uuid): void {
    this.guardians.add(key2(userId, studentId));
  }
  async getIdentity(_ctx: RequestContext, studentId: Uuid): Promise<StudentIdentity | null> {
    return this.identities.get(studentId) ?? null;
  }
  async getStudentIdForUser(_ctx: RequestContext, userId: Uuid): Promise<Uuid | null> {
    return this.userToStudent.get(userId) ?? null;
  }
  async isGuardianOf(_ctx: RequestContext, input: { userId: Uuid; studentId: Uuid }): Promise<boolean> {
    return this.guardians.has(key2(input.userId, input.studentId));
  }
}

export class InMemoryActors implements ActorDirectory {
  private readonly names = new Map<Uuid, string>();
  set(userId: Uuid, name: string): void {
    this.names.set(userId, name);
  }
  async displayName(_ctx: RequestContext, userId: Uuid): Promise<string | null> {
    return this.names.get(userId) ?? null;
  }
}

export class InMemorySignatories implements SignatoryDirectory {
  private readonly byId = new Map<Uuid, SignatoryInfo>();
  add(info: SignatoryInfo): void {
    this.byId.set(info.signatoryId, info);
  }
  deactivate(signatoryId: Uuid): void {
    const s = this.byId.get(signatoryId);
    if (s) this.byId.set(signatoryId, { ...s, active: false });
  }
  async getSignatory(_ctx: RequestContext, signatoryId: Uuid): Promise<SignatoryInfo | null> {
    return this.byId.get(signatoryId) ?? null;
  }
}

export class InMemoryInstitution implements InstitutionPort {
  constructor(private profile: InstitutionProfile = { name: "Établissement de test" }) {}
  set(profile: InstitutionProfile): void {
    this.profile = profile;
  }
  async getInstitution(): Promise<InstitutionProfile> {
    return this.profile;
  }
}

// ---------------------------------------------------------------------------
// rules : AUCUNE formule ici
// ---------------------------------------------------------------------------

export const SCRIPTED_RULE_REF: RuleRef = Object.freeze({
  ruleSetCode: "SCRIPTED-TEST",
  ruleVersionId: "00000000-0000-7000-8000-0000000000a1",
  versionNo: 1,
  definitionHash: "0".repeat(64),
});

type EligibilityInput = { exigences: ReadonlyArray<{ valide: boolean; obligatoire: boolean; uv: number }>; uvRequises: number; scope: RuleScope };
type CycleInput = { semestres: ReadonlyArray<{ moyenne: DecimalString | null; credits: number }>; scope: RuleScope };
type AnnualUeScript = (input: AnnualUeEvaluationInput) => Omit<AnnualUeEvaluation, "rule">;

/**
 * Port de règles « scénarisé » : le test fournit les décisions (`onEligibility`, `onCycle`). Sans script il échoue fermé
 * (`higher.rules_unavailable`) : ce module ne devine jamais une décision réglementaire.
 */
export class ScriptedRules implements DiplomaRulesPort {
  onEligibility: ((input: EligibilityInput) => boolean) | null = null;
  onCycle: ((input: CycleInput) => { average: DecimalString | null; mentionCode: string }) | null = null;
  /** O-11 : décision de la règle de l'UE annuelle, dictée par le test (aucune formule ici). */
  onAnnualUe: AnnualUeScript | null = null;
  readonly annualUeCalls: AnnualUeEvaluationInput[] = [];
  /** Panne injectée (test d'isolation capitalisation / éligibilité). */
  failWith: AppError | null = null;
  readonly eligibilityCalls: EligibilityInput[] = [];
  readonly cycleCalls: CycleInput[] = [];

  async evaluateEligibility(_ctx: RequestContext, input: EligibilityInput): Promise<Result<EligibilityEvaluation, AppError>> {
    this.eligibilityCalls.push(input);
    if (this.failWith) return err(this.failWith);
    if (!this.onEligibility) return Promise.reject(portUnavailable("DiplomaRulesPort.evaluateEligibility (non scénarisé)"));
    return ok({ eligible: this.onEligibility(input), rule: SCRIPTED_RULE_REF, inputsHash: "1".repeat(64), outputsHash: "2".repeat(64) });
  }

  async evaluateCycle(_ctx: RequestContext, input: CycleInput): Promise<Result<CycleEvaluation, AppError>> {
    this.cycleCalls.push(input);
    if (this.failWith) return err(this.failWith);
    if (!this.onCycle) return Promise.reject(portUnavailable("DiplomaRulesPort.evaluateCycle (non scénarisé)"));
    const r = this.onCycle(input);
    return ok({ average: r.average, mentionCode: r.mentionCode, rule: SCRIPTED_RULE_REF });
  }

  async evaluateAnnualUe(_ctx: RequestContext, input: AnnualUeEvaluationInput): Promise<Result<AnnualUeEvaluation, AppError>> {
    this.annualUeCalls.push(input);
    if (this.failWith) return err(this.failWith);
    if (!this.onAnnualUe) return Promise.reject(portUnavailable("DiplomaRulesPort.evaluateAnnualUe (non scénarisé)"));
    return ok({ ...this.onAnnualUe(input), rule: SCRIPTED_RULE_REF });
  }
}

// ---------------------------------------------------------------------------
// reportcards : scellement et PDF (factices, déterministes)
// ---------------------------------------------------------------------------

/**
 * Scellement et rendu FACTICES pour les tests du module : la « signature » est une chaîne dérivée de l'empreinte, le « PDF »
 * est un petit fichier `%PDF-` qui contient le titre. Le vrai scellement (Ed25519) et le vrai rendu (gabarit, Chromium) sont
 * ceux de `reportcards`, branchés par la plateforme (`platform/adapters/reportcards-higher.ts`).
 */
export class InMemoryDocumentFiles implements DocumentFilesPort {
  readonly sealed: Array<{ documentId: Uuid; kind: string; snapshotHash: string; verificationCode: string }> = [];
  readonly rendered: Array<{ documentId: Uuid; templateKey: string; context: Readonly<Record<string, unknown>> }> = [];
  readonly files = new Map<string, Uint8Array>();
  failRenderWith: AppError | null = null;
  failSealWith: AppError | null = null;

  prepared = 0;

  async prepareSeal(): Promise<Result<void, AppError>> {
    this.prepared += 1;
    return ok(undefined);
  }

  async seal(_ctx: RequestContext, _tx: unknown, input: { documentId: Uuid; kind: string; snapshotHash: string; verificationCode: string; issuedAt: Date }): Promise<Result<SealedDocumentInfo, AppError>> {
    if (this.failSealWith) return err(this.failSealWith);
    this.sealed.push({ documentId: input.documentId, kind: input.kind, snapshotHash: input.snapshotHash, verificationCode: input.verificationCode });
    return ok({ signingKeyId: "test-key-0001", signature: `sig:${input.snapshotHash.slice(0, 16)}:${input.verificationCode.slice(0, 8)}` });
  }

  async render(_ctx: RequestContext, input: { documentId: Uuid; kind: string; templateKey: string; title: string; context: Readonly<Record<string, unknown>>; verificationCode: string; issuedAt: Date; logoRef: string | null }): Promise<Result<RenderedDocumentFile, AppError>> {
    if (this.failRenderWith) return err(this.failRenderWith);
    this.rendered.push({ documentId: input.documentId, templateKey: input.templateKey, context: input.context });
    const bytes = new TextEncoder().encode(`%PDF-1.4\n% ${input.title}\n${input.verificationCode}\n%%EOF`);
    const objectKey = `memory/${input.documentId}.pdf`;
    this.files.set(objectKey, bytes);
    return ok({ objectKey, pdfHash: createHash("sha256").update(bytes).digest("hex"), pages: 1, templateKey: input.templateKey, templateVersion: 1 });
  }

  async signedUrl(_ctx: RequestContext, objectKey: string, options: { ttlSec: number; fileName: string }): Promise<string> {
    return `https://files.example.test/${objectKey}?ttl=${options.ttlSec}&name=${encodeURIComponent(options.fileName)}`;
  }
}

// ---------------------------------------------------------------------------
// Monde complet
// ---------------------------------------------------------------------------

export interface InMemoryWorld extends HigherPorts {
  readonly documents: InMemoryDocumentFiles;
  readonly credits: InMemoryCredits;
  readonly resitSession: InMemoryResitSession;
  readonly cycleResults: InMemoryCycleResults;
  readonly curriculum: InMemoryCurriculum;
  readonly enrollments: InMemoryEnrollments;
  readonly students: InMemoryStudents;
  readonly actors: InMemoryActors;
  readonly signatories: InMemorySignatories;
  readonly institution: InMemoryInstitution;
  readonly rules: ScriptedRules;
}

export function inMemoryPorts(): InMemoryWorld {
  return {
    documents: new InMemoryDocumentFiles(),
    credits: new InMemoryCredits(),
    resitSession: new InMemoryResitSession(),
    cycleResults: new InMemoryCycleResults(),
    curriculum: new InMemoryCurriculum(),
    enrollments: new InMemoryEnrollments(),
    students: new InMemoryStudents(),
    actors: new InMemoryActors(),
    signatories: new InMemorySignatories(),
    institution: new InMemoryInstitution(),
    rules: new ScriptedRules(),
  };
}
