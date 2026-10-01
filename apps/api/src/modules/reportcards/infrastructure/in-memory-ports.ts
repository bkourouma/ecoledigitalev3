/**
 * Implémentations EN MÉMOIRE des ports : pour les tests du module et ceux des modules consommateurs (019, 032…). Elles se
 * remplissent à la main. `makeSampleBundle` fabrique un résultat FINAL plausible (aucun nom réel).
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { RequestContext } from "@ecoledigitale/kernel";
import type {
  AttendanceSummary,
  AttendanceSummaryPort,
  GuardianshipPort,
  LearnerStandingPort,
  PdfRenderInput,
  PdfRenderResult,
  PdfRenderer,
  ResultsReadPort,
  UserDirectoryPort,
} from "../application/ports";
import type { FinalResultBundle, Pack, PeriodState, ReportcardSnapshotLine, RosterEntry, Uuid } from "../domain/types";

const key = (a: string, b: string): string => `${a}:${b}`;

export class InMemoryResults implements ResultsReadPort {
  readonly states = new Map<string, PeriodState>();
  readonly rosters = new Map<string, RosterEntry[]>();
  readonly bundles = new Map<string, FinalResultBundle>();
  readonly cumulative = new Map<Uuid, FinalResultBundle>();
  readonly bundleReads: string[] = [];
  /** Enrollments dont la lecture échoue (simule une panne du module results). */
  readonly failingEnrollments = new Set<Uuid>();

  setState(state: PeriodState): this {
    this.states.set(key(state.classroomId, state.academicPeriodId), state);
    return this;
  }
  setRoster(classroomId: Uuid, periodId: Uuid, entries: RosterEntry[]): this {
    this.rosters.set(key(classroomId, periodId), entries);
    return this;
  }
  setBundle(enrollmentId: Uuid, periodId: Uuid, bundle: FinalResultBundle): this {
    this.bundles.set(key(enrollmentId, periodId), bundle);
    return this;
  }
  setCumulative(studentId: Uuid, bundle: FinalResultBundle): this {
    this.cumulative.set(studentId, bundle);
    return this;
  }

  async getPeriodState(_ctx: RequestContext, q: { classroomId: Uuid; academicPeriodId: Uuid }): Promise<PeriodState | null> {
    return this.states.get(key(q.classroomId, q.academicPeriodId)) ?? null;
  }
  async listRoster(_ctx: RequestContext, q: { classroomId: Uuid; academicPeriodId: Uuid }): Promise<readonly RosterEntry[]> {
    return this.rosters.get(key(q.classroomId, q.academicPeriodId)) ?? [];
  }
  async getFinalBundle(_ctx: RequestContext, q: { enrollmentId: Uuid; academicPeriodId: Uuid }): Promise<FinalResultBundle | null> {
    this.bundleReads.push(q.enrollmentId);
    if (this.failingEnrollments.has(q.enrollmentId)) throw new Error("results indisponible");
    return this.bundles.get(key(q.enrollmentId, q.academicPeriodId)) ?? null;
  }
  async getCumulativeBundle(_ctx: RequestContext, q: { studentId: Uuid }): Promise<FinalResultBundle | null> {
    return this.cumulative.get(q.studentId) ?? null;
  }
}

export class InMemoryGuardianship implements GuardianshipPort {
  readonly studentOfUser = new Map<Uuid, Uuid>();
  readonly links = new Set<string>();
  link(userId: Uuid, studentId: Uuid): this {
    this.links.add(key(userId, studentId));
    return this;
  }
  unlink(userId: Uuid, studentId: Uuid): this {
    this.links.delete(key(userId, studentId));
    return this;
  }
  async studentIdOfUser(_ctx: RequestContext, userId: Uuid): Promise<Uuid | null> {
    return this.studentOfUser.get(userId) ?? null;
  }
  async isGuardianOf(_ctx: RequestContext, userId: Uuid, studentId: Uuid): Promise<boolean> {
    return this.links.has(key(userId, studentId));
  }
  async listChildren(_ctx: RequestContext, userId: Uuid): Promise<readonly Uuid[]> {
    return [...this.links].filter((l) => l.startsWith(`${userId}:`)).map((l) => l.slice(userId.length + 1));
  }
}

export class InMemoryAttendance implements AttendanceSummaryPort {
  readonly summaries = new Map<string, AttendanceSummary>();
  async getSummary(_ctx: RequestContext, q: { enrollmentId: Uuid; academicPeriodId: Uuid }): Promise<AttendanceSummary | null> {
    return this.summaries.get(key(q.enrollmentId, q.academicPeriodId)) ?? null;
  }
}

export class InMemoryStanding implements LearnerStandingPort {
  readonly indebted = new Set<Uuid>();
  async hasOutstandingBalance(_ctx: RequestContext, studentId: Uuid): Promise<boolean> {
    return this.indebted.has(studentId);
  }
}

export class InMemoryDirectory implements UserDirectoryPort {
  readonly names = new Map<Uuid, string>();
  async displayName(_ctx: RequestContext, userId: Uuid): Promise<string | null> {
    return this.names.get(userId) ?? null;
  }
}

/**
 * Moteur de rendu de TEST : produit un vrai PDF (pdf-lib) qui contient le titre — ce qui permet de tester tout le pipeline
 * (stockage, hash, publication, téléchargement) sans Chromium. Déterministe : mêmes entrées, mêmes octets.
 */
export class FakePdfRenderer implements PdfRenderer {
  readonly renders: PdfRenderInput[] = [];
  /** Nombre d'échecs à simuler avant de réussir (par appel). */
  failTimes = 0;
  failWith = "Chromium indisponible (simulé)";
  async render(input: PdfRenderInput): Promise<PdfRenderResult> {
    this.renders.push(input);
    if (this.failTimes > 0) {
      this.failTimes -= 1;
      throw new Error(this.failWith);
    }
    const doc = await PDFDocument.create({ updateMetadata: false });
    const page = doc.addPage([595, 842]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText(input.title.replace(/[^\x20-\x7e]/g, "?").slice(0, 90), { x: 40, y: 780, size: 12, font });
    page.drawText(`html-bytes:${input.html.length}`, { x: 40, y: 760, size: 8, font });
    doc.setTitle(input.title);
    doc.setProducer("EcoleDigitale-test");
    doc.setCreationDate(input.issuedAt);
    doc.setModificationDate(input.issuedAt);
    return { pdf: await doc.save({ useObjectStreams: false }), pages: 1, rendererVersion: "fake/1" };
  }
}

// ---------------------------------------------------------------------------
// Jeux de données de test
// ---------------------------------------------------------------------------

export const SAMPLE_HASH = "a".repeat(64);

export interface SampleBundleOptions {
  studentId: Uuid;
  enrollmentId: Uuid | null;
  classroomId: Uuid | null;
  periodId: Uuid | null;
  yearId: Uuid;
  stateId: Uuid;
  ruleVersionId: Uuid;
  pack?: Pack;
  lastName?: string;
  firstNames?: string;
  resultsVersion?: number;
  closureHash?: string;
  deliberationDate?: string | null;
  appreciation?: string | null;
  average?: string;
  /** Nom d'élève hostile (test d'échappement). */
  hostile?: boolean;
}

export function makeSampleBundle(o: SampleBundleOptions): FinalResultBundle {
  const higher = o.pack === "HIGHER";
  const lines: ReportcardSnapshotLine[] = higher
    ? [
        { level: "UE", code: "UE1", label: "Unité d'enseignement 1", parentCode: null, category: null, coefficient: null, credits: "6.00", exact: "12.40", display: "12,40", weighted: null, rank: null, rankOf: null, state: "VALIDATED", session: 1, mention: null, appreciation: null, periodLabel: null },
        { level: "ECUE", code: "UE1-A", label: "Élément A", parentCode: "UE1", category: null, coefficient: "2.00", credits: "4.00", exact: "13.00", display: "13,00", weighted: "26,00", rank: null, rankOf: null, state: "VALIDATED", session: 1, mention: null, appreciation: null, periodLabel: null },
        { level: "ECUE", code: "UE1-B", label: "Élément B", parentCode: "UE1", category: null, coefficient: "1.00", credits: "2.00", exact: "11.20", display: "11,20", weighted: "11,20", rank: null, rankOf: null, state: "VALIDATED", session: 1, mention: null, appreciation: null, periodLabel: null },
      ]
    : [
        { level: "SUBJECT", code: "MATH", label: "Mathématiques", parentCode: null, category: null, coefficient: "3.00", credits: null, exact: "14.50", display: "14,50", weighted: "43,50", rank: 3, rankOf: 30, state: null, session: null, mention: null, appreciation: "Très bon travail", periodLabel: null },
        { level: "SUBJECT", code: "FR", label: "Français", parentCode: null, category: null, coefficient: "3.00", credits: null, exact: "11.25", display: "11,25", weighted: "33,75", rank: 12, rankOf: 30, state: null, session: null, mention: null, appreciation: "Peut mieux faire", periodLabel: null },
        { level: "SUBJECT", code: "HG", label: "Histoire-Géographie", parentCode: null, category: null, coefficient: "2.00", credits: null, exact: "12.00", display: "12,00", weighted: "24,00", rank: 8, rankOf: 30, state: null, session: null, mention: null, appreciation: null, periodLabel: null },
      ];
  return {
    student: {
      id: o.studentId,
      lastName: o.hostile ? `<b>O'Brien</b> "Zoé" & <script>alert(1)</script>` : (o.lastName ?? "TESTEUR"),
      firstNames: o.hostile ? `<img src=x onerror=alert(1)>` : (o.firstNames ?? "Amina"),
      matricule: "MAT-001",
      birthDate: "2010-03-04",
      birthPlace: "Ville Test",
      gender: null,
      nationality: null,
      repeating: false,
    },
    enrollment: {
      id: o.enrollmentId,
      classroomId: o.classroomId,
      classroomLabel: o.classroomId ? "Classe Test A" : null,
      levelLabel: o.classroomId ? "Niveau Test" : null,
      programLabel: higher && o.classroomId ? "Filière Test" : null,
      academicYearId: o.yearId,
      academicYearLabel: "2025-2026",
      periodId: o.periodId,
      periodLabel: o.periodId ? "Semestre 1" : null,
      classSize: o.classroomId ? 30 : null,
    },
    lines,
    summary: {
      averageExact: o.average ?? "12.58",
      averageDisplay: (o.average ?? "12.58").replace(".", ","),
      rank: 7,
      classSize: 30,
      classAverageDisplay: "11,02",
      mention: "ASSEZ_BIEN",
      decisionCode: "ADMITTED",
      decisionOutcome: "PASS",
      creditsAcquired: higher ? "6.00" : null,
      creditsRequired: higher ? "30.00" : null,
      totalCoefficient: higher ? null : "8.00",
      weightedTotal: higher ? null : "101,25",
      distinctions: [],
    },
    annual: null,
    deliberation: o.deliberationDate === null ? null : { heldOn: o.deliberationDate ?? "2026-01-15", nature: higher ? "JURY" : "COUNCIL" },
    generalAppreciation: o.appreciation === undefined ? "Bon semestre, à poursuivre." : o.appreciation,
    attendance: { justifiedMinutes: 150, unjustifiedMinutes: 90, lateCount: 1 },
    rules: {
      ruleSetCode: "TEST-RULES",
      ruleVersionNo: 3,
      ruleVersionId: o.ruleVersionId,
      definitionHash: SAMPLE_HASH,
      contractId: "coef-period@1",
      engineVersion: "1.0.0",
      resultsStateId: o.stateId,
      resultsVersion: o.resultsVersion ?? 1,
      closureHash: o.closureHash ?? "c".repeat(64),
    },
    labels: { ASSEZ_BIEN: "Assez bien", ADMITTED: "Admis", PASS: "Admis", VALIDATED: "Validé", NOT_VALIDATED: "Non validé" },
    explain: [
      { lineCode: higher ? "UE1" : "MATH", rules: [{ key: "period_average", position: 0, inputs: { sum: "43.50", coefficients: "3.00" }, output: "14.50" }] },
    ],
  };
}
