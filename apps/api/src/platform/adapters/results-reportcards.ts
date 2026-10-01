/**
 * results (+ academic, people, rules) -> reportcards : `ResultsReadPort` — états de période, effectif avec l'état du résultat,
 * résultats FINAL d'une inscription prêts à figer dans un bulletin (snapshot `reportcard/1`), relevé cumulé.
 *
 * Aucune formule : les valeurs exactes et d'AFFICHAGE, les rangs, mentions, décisions, états viennent des résultats FINAL
 * (calculés par les règles) ; ce fichier ne fait que NOMMER (codes et libellés du curriculum, de la classe, de l'année, du
 * niveau, du programme, de l'élève) et METTRE EN FORME pour le contrat du snapshot. Les totaux « moyenne × coefficient » ne
 * sont pas produits par les règles : ils restent vides (le gabarit ne les imprime alors pas).
 *
 * Les décimaux exacts du snapshot sont limités à 6 décimales par son contrat : une valeur plus longue est ARRONDIE (demi
 * supérieur, sur la chaîne, sans flottant) — la valeur d'affichage reste celle des règles.
 */
import type { AppError, RequestContext } from "@ecoledigitale/kernel";
import {
  getAcademicPeriod,
  getClassroomFacts,
  getEnrollment,
  getResultsStructure,
  listAcademicPeriods,
  listClassroomEnrollments,
  listEnrollmentsByStudent,
  type AcademicDeps,
  type ClassroomFacts,
  type ResultsStructure,
} from "../../modules/academic";
import { getStudent, type PeopleDeps } from "../../modules/people";
import type { RulesApi } from "../../modules/rules";
import {
  getClassMatrix,
  getFinalResult,
  getPeriodView,
  getStateView,
  getYearResult,
  listAppreciations,
  listDeliberations,
  type LineRecord,
  type ResultHeader,
  type ResultsDeps,
} from "../../modules/results";
import type { FinalResultBundle, PeriodState, ReportcardSnapshot, ResultsReadPort, RosterEntry } from "../../modules/reportcards";

type ReportcardSnapshotLine = ReportcardSnapshot["results"]["lines"][number];

const READ = { read: true } as const;
const ZERO_HASH = "0".repeat(64);

export interface ReportcardsResultsDeps {
  readonly results: ResultsDeps;
  readonly academic: AcademicDeps;
  readonly people: PeopleDeps;
  readonly rules: RulesApi;
}

function must<T>(r: { ok: true; value: T } | { ok: false; error: AppError }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

/** Arrondit une chaîne décimale à `scale` décimales (demi supérieur, valeur absolue), sans passer par un flottant. */
export function fitDecimal(value: string | null, scale = 6): string | null {
  if (value === null) return null;
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) return null;
  const [, sign = "", int = "0", frac = ""] = m;
  if (frac.length <= scale) return `${sign}${int.replace(/^0+(?=\d)/, "")}${frac ? `.${frac}` : ""}`;
  const keep = frac.slice(0, scale);
  const roundUp = Number(frac[scale]) >= 5;
  let digits = BigInt(int + keep);
  if (roundUp) digits += 1n;
  const s = digits.toString().padStart(scale + 1, "0");
  const head = s.slice(0, s.length - scale).replace(/^0+(?=\d)/, "");
  const tail = s.slice(s.length - scale).replace(/0+$/, "");
  const isZero = digits === 0n;
  return `${isZero ? "" : sign}${head}${tail ? `.${tail}` : ""}`;
}

const truncate = (s: string | null | undefined, max: number): string | null => (s && s.trim() ? s.trim().slice(0, max) : null);

const STATUS: Readonly<Record<string, PeriodState["status"]>> = Object.freeze({ OPEN: "OPEN", GRADING_LOCKED: "LOCKED", DELIBERATED: "DELIBERATED", CLOSED: "CLOSED" });

/** Entrées d'une trace -> scalaires (le snapshot n'accepte que chaînes, entiers, booléens, null) ; le reste est sérialisé. */
function scalar(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isSafeInteger(v) ? v : String(v);
  if (typeof v === "string") return v.slice(0, 500);
  return JSON.stringify(v).slice(0, 500);
}

function explainOf(lineCode: string, trace: unknown): { lineCode: string; rules: Array<{ key: string; position: number; inputs: Record<string, string | number | boolean | null>; output: string | number | boolean | null }> } | null {
  if (!Array.isArray(trace) || trace.length === 0) return null;
  const rules = (trace as Array<{ ruleKey?: unknown; value?: unknown; variables?: unknown }>).slice(0, 60).map((t, position) => {
    const inputs: Record<string, string | number | boolean | null> = {};
    if (t.variables && typeof t.variables === "object") for (const [k, v] of Object.entries(t.variables as Record<string, unknown>).slice(0, 40)) inputs[k.slice(0, 80)] = scalar(v);
    return { key: String(t.ruleKey ?? "").slice(0, 80) || "rule", position, inputs, output: scalar(t.value) };
  });
  return { lineCode: lineCode.slice(0, 64), rules };
}

export function createReportcardsResultsRead(deps: ReportcardsResultsDeps): ResultsReadPort {
  const { results, academic, people, rules } = deps;

  async function labelsOf(ctx: RequestContext, ruleVersionId: string): Promise<Record<string, string>> {
    const loaded = await rules.loadVersion(ctx, ruleVersionId);
    if (!loaded.ok) return {};
    const out: Record<string, string> = {};
    for (const rule of loaded.value.rules) for (const table of Object.values(rule.labelMap)) for (const [code, label] of Object.entries(table)) out[code.slice(0, 200)] = String(label).slice(0, 200);
    return out;
  }

  function nodeName(structure: ResultsStructure | null): (nodeId: string | null) => { code: string; label: string; parentCode: string | null; category: string | null } | null {
    const byId = new Map((structure?.nodes ?? []).map((n) => [n.id, n]));
    return (nodeId) => {
      const n = nodeId ? byId.get(nodeId) : undefined;
      if (!n) return null;
      return { code: n.code.slice(0, 64), label: n.label.slice(0, 200), parentCode: n.parentId ? (byId.get(n.parentId)?.code.slice(0, 64) ?? null) : null, category: n.categoryCode };
    };
  }

  /** Lignes du snapshot (SECTION, UE, ECUE, SUBJECT) et trace d'explicabilité d'un résultat FINAL. */
  function linesOf(header: ResultHeader & { lines: LineRecord[] }, structure: ResultsStructure | null, appreciations: Map<string | null, string>, labels: Record<string, string>) {
    const name = nodeName(structure);
    const lines: ReportcardSnapshotLine[] = [];
    const explain: NonNullable<ReturnType<typeof explainOf>>[] = [];
    const ordered = [...header.lines].sort((a, b) => a.position - b.position);

    const period = ordered.find((l) => l.level === "PERIOD");
    const sections = period && period.outputs && typeof period.outputs.sections === "object" && period.outputs.sections ? (period.outputs.sections as Record<string, { value?: string | null; display?: string | null; rank?: number | null; cohortSize?: number | null }>) : {};
    for (const [key, s] of Object.entries(sections)) {
      lines.push({
        level: "SECTION", code: key.slice(0, 64), label: (labels[key] ?? key).slice(0, 200), parentCode: null, category: null, coefficient: null, credits: null,
        exact: fitDecimal(s.value ?? null), display: truncate(s.display, 40), weighted: null, rank: s.rank ?? null, rankOf: s.rank == null ? null : (s.cohortSize ?? null),
        state: null, session: null, mention: null, appreciation: null, periodLabel: null,
      });
    }

    for (const l of ordered) {
      if (l.level === "PERIOD" || l.level === "YEAR") {
        const e = explainOf(l.level, l.trace);
        if (e) explain.push(e);
        continue;
      }
      const node = name(l.curriculumNodeId);
      const code = node?.code ?? `node-${(l.curriculumNodeId ?? "x").slice(0, 8)}`;
      const section = l.level === "SUBJECT" && typeof l.outputs?.section === "string" ? (l.outputs.section as string) : null;
      lines.push({
        level: l.level as "UE" | "ECUE" | "SUBJECT" | "SECTION",
        code,
        label: node?.label ?? code,
        parentCode: l.level === "SUBJECT" ? section : (node?.parentCode ?? null),
        category: node?.category ?? null,
        coefficient: fitDecimal(l.coefficient),
        credits: fitDecimal(l.credits),
        exact: fitDecimal(l.value),
        display: truncate(l.displayValue, 40),
        weighted: null,
        rank: l.rank,
        rankOf: l.rank === null ? null : l.cohortSize,
        state: truncate(l.statusCode, 40),
        session: l.sessionObtained,
        mention: null,
        appreciation: truncate(appreciations.get(l.curriculumNodeId), 500),
        periodLabel: null,
      });
      const e = explainOf(code, l.trace);
      if (e) explain.push(e);
    }
    return { lines, explain };
  }

  return {
    async getPeriodState(ctx, query): Promise<PeriodState | null> {
      const [view, facts] = await Promise.all([
        getPeriodView(results, ctx, { classroomId: query.classroomId, academicPeriodId: query.academicPeriodId, caps: READ }),
        getClassroomFacts(academic, ctx, query.classroomId),
      ]);
      if (!view.ok || !facts.ok) return null;
      const { state, closures, deliberations } = view.value;
      const closure = closures.find((c) => c.resultsVersion === state.resultsVersion) ?? closures[closures.length - 1];
      const held = deliberations.filter((d) => (d.status === "HELD" || d.status === "SIGNED") && d.heldOn).sort((a, b) => (b.heldOn ?? "").localeCompare(a.heldOn ?? ""));
      return {
        classroomId: query.classroomId,
        academicPeriodId: query.academicPeriodId,
        pack: facts.value.pack ?? "CORE",
        institutionId: facts.value.institutionId,
        stateId: state.id,
        status: STATUS[state.status] ?? "OPEN",
        resultsVersion: state.resultsVersion,
        // Pas de clôture (période non close, bulletin provisoire) : empreinte nulle, jamais une valeur inventée.
        closureHash: closure?.closureHash ?? ZERO_HASH,
        deliberationHeld: held.length > 0,
        deliberationDate: held[0]?.heldOn ?? null,
      };
    },

    async listRoster(ctx, query): Promise<readonly RosterEntry[]> {
      const [enrollments, matrix] = await Promise.all([
        listClassroomEnrollments(academic, ctx, query.classroomId),
        getClassMatrix(results, ctx, { classroomId: query.classroomId, academicPeriodId: query.academicPeriodId, caps: READ }),
      ]);
      if (!enrollments.ok) return [];
      const byEnrollment = new Map(matrix.ok ? matrix.value.rows.map((r) => [r.header.enrollmentId, r.header] as const) : []);
      return enrollments.value
        .filter((e) => e.active)
        .map((e): RosterEntry => {
          const h = byEnrollment.get(e.enrollmentId);
          if (!h) return { enrollmentId: e.enrollmentId, studentId: e.studentId, outcome: "MISSING", reason: "Aucun résultat pour cette inscription." };
          if (h.status === "FINAL") return { enrollmentId: e.enrollmentId, studentId: e.studentId, outcome: "FINAL" };
          if (h.status === "ERROR") {
            const code = (h.error as { code?: string } | null)?.code ?? "results.error";
            return { enrollmentId: e.enrollmentId, studentId: e.studentId, outcome: "ERROR", reason: code };
          }
          return { enrollmentId: e.enrollmentId, studentId: e.studentId, outcome: "MISSING", reason: "Résultat non définitif (brouillon)." };
        });
    },

    async getFinalBundle(ctx, query): Promise<FinalResultBundle | null> {
      const finalR = await getFinalResult(results, ctx, { enrollmentId: query.enrollmentId, academicPeriodId: query.academicPeriodId });
      const header = finalR.ok ? finalR.value : null;
      if (!header || header.scope !== "PERIOD") return null;
      return buildBundle(ctx, header, query.academicPeriodId);
    },

    async getCumulativeBundle(ctx, query): Promise<FinalResultBundle | null> {
      const enrollments = must(await listEnrollmentsByStudent(academic, ctx, query.studentId));
      const wanted = query.academicYearIds ? new Set(query.academicYearIds) : null;
      const finals: Array<{ header: ResultHeader & { lines: LineRecord[] }; periodLabel: string; startsOn: string }> = [];
      for (const e of enrollments) {
        if (wanted && !wanted.has(e.academicYearId)) continue;
        const periods = await listAcademicPeriods(academic, ctx, e.academicYearId);
        if (!periods.ok) continue;
        for (const p of periods.value) {
          const f = await getFinalResult(results, ctx, { enrollmentId: e.id, academicPeriodId: p.id });
          if (f.ok && f.value && f.value.scope === "PERIOD") finals.push({ header: f.value, periodLabel: p.label, startsOn: p.startsOn });
        }
      }
      finals.sort((a, b) => a.startsOn.localeCompare(b.startsOn));
      const latest = finals[finals.length - 1];
      if (!latest) return null;
      const base = await buildBundle(ctx, latest.header, latest.header.academicPeriodId as string);
      const lines: ReportcardSnapshotLine[] = [];
      const explain = [...base.explain];
      for (const f of finals) {
        const structure = await structureOf(ctx, f.header);
        const one = linesOf(f.header, structure, new Map(), base.labels);
        lines.push(...one.lines.filter((l) => l.level !== "SECTION").map((l) => ({ ...l, periodLabel: f.periodLabel.slice(0, 120) })));
        if (f !== latest) explain.push(...one.explain.map((e) => ({ ...e, lineCode: `${e.lineCode}`.slice(0, 64) })));
      }
      // Relevé cumulé : lignes de chaque période FINAL ; aucun total n'est recalculé ici (crédits capitalisés : module higher).
      return {
        ...base,
        enrollment: { ...base.enrollment, periodId: null, periodLabel: null },
        lines,
        summary: { averageExact: null, averageDisplay: null, rank: null, classSize: null, classAverageDisplay: null, mention: null, decisionCode: null, decisionOutcome: null, creditsAcquired: null, creditsRequired: null, totalCoefficient: null, weightedTotal: null, distinctions: [] },
        annual: null,
        deliberation: null,
        generalAppreciation: null,
        explain: explain.slice(0, 1500),
      };
    },
  };

  async function structureOf(ctx: RequestContext, header: ResultHeader): Promise<ResultsStructure | null> {
    if (!header.academicPeriodId) return null;
    const s = await getResultsStructure(academic, ctx, { classroomId: header.classroomId, periodId: header.academicPeriodId });
    return s.ok ? s.value : null;
  }

  async function buildBundle(ctx: RequestContext, header: ResultHeader & { lines: LineRecord[] }, periodId: string): Promise<FinalResultBundle> {
    const [state, facts, structure, studentR, enrollmentR, period] = await Promise.all([
      getStateView(results, ctx, { stateId: header.stateId }),
      getClassroomFacts(academic, ctx, header.classroomId),
      structureOf(ctx, header),
      getStudent(people, ctx, header.studentId, "FULL"),
      getEnrollment(academic, ctx, header.enrollmentId),
      getAcademicPeriod(academic, ctx, periodId),
    ]);
    const s = must(state);
    const f: ClassroomFacts | null = facts.ok ? facts.value : null;
    const student = studentR.ok ? studentR.value : null;
    if (!student) throw must({ ok: false as const, error: studentR.ok ? ({ code: "adapters.student_missing", message: "Élève introuvable." } as never) : studentR.error });

    const view = await getPeriodView(results, ctx, { classroomId: header.classroomId, academicPeriodId: periodId, caps: READ });
    const closures = view.ok ? view.value.closures : [];
    const closure = closures.find((c) => c.resultsVersion === s.resultsVersion) ?? closures[closures.length - 1];

    const deliberations = must(await listDeliberations(results, ctx, { stateId: header.stateId, caps: READ }));
    const held = deliberations.filter((d) => (d.status === "HELD" || d.status === "SIGNED") && d.heldOn).sort((a, b) => (b.heldOn ?? "").localeCompare(a.heldOn ?? ""))[0];
    const appr = must(await listAppreciations(results, ctx, { stateId: header.stateId, enrollmentId: header.enrollmentId, caps: READ }));
    const byNode = new Map<string | null, string>();
    for (const a of appr) if (!byNode.has(a.curriculumNodeId) || a.authorRole !== "TEACHER") byNode.set(a.curriculumNodeId, a.body);
    const general = [...appr].filter((a) => a.curriculumNodeId === null).sort((a, b) => (a.authorRole === "TEACHER" ? 1 : 0) - (b.authorRole === "TEACHER" ? 1 : 0))[0];

    const labels = await labelsOf(ctx, header.ruleVersionId);
    const { lines, explain } = linesOf(header, structure, byNode, labels);

    // Bilan annuel : seulement à la dernière période d'enseignement, quand l'année est complète.
    let annual: FinalResultBundle["annual"] = null;
    if (structure?.period.isLast) {
      const year = await getYearResult(results, ctx, { enrollmentId: header.enrollmentId, academicYearId: header.academicYearId, caps: READ });
      if (year.ok && year.value.complete) {
        const periods = await listAcademicPeriods(academic, ctx, header.academicYearId);
        const labelOf = new Map(periods.ok ? periods.value.map((p) => [p.id, p.label] as const) : []);
        annual = {
          rows: year.value.periods.slice(0, 12).map((p) => ({ label: (labelOf.get(p.academicPeriodId) ?? `Période ${p.rankInYear}`).slice(0, 120), display: truncate(p.averageDisplay, 40), weight: null })),
          averageDisplay: truncate(year.value.averageDisplay, 40),
          rank: year.value.rank,
          classSize: year.value.cohortSize,
          decisionCode: truncate(year.value.yearDecisionCode ?? year.value.mentionCode, 60),
        };
      }
    }

    const summary = header.summary as { classSize?: unknown; distinction?: unknown };
    const classSize = typeof summary.classSize === "number" ? summary.classSize : header.cohortSize;
    return {
      student: {
        id: student.id,
        lastName: student.lastName.slice(0, 120),
        firstNames: [student.firstName, student.otherNames].filter(Boolean).join(" ").slice(0, 160),
        matricule: truncate(student.studentNumber, 60),
        birthDate: student.birthDate,
        birthPlace: truncate(student.birthPlace, 120),
        gender: truncate(student.sex, 30),
        nationality: truncate(student.nationality, 80),
        repeating: enrollmentR.ok ? enrollmentR.value.isRepeating : null,
      },
      enrollment: {
        id: header.enrollmentId,
        classroomId: header.classroomId,
        classroomLabel: truncate(f?.name, 120),
        levelLabel: truncate(f?.gradeLevelLabel, 120),
        programLabel: truncate(f?.programLabel, 160),
        academicYearId: header.academicYearId,
        academicYearLabel: (f?.academicYearLabel ?? header.academicYearId).slice(0, 60),
        periodId,
        periodLabel: period.ok ? truncate(period.value.label, 120) : null,
        classSize,
      },
      lines,
      summary: {
        averageExact: fitDecimal(header.average),
        averageDisplay: truncate(header.averageDisplay, 40),
        rank: header.rank,
        classSize,
        classAverageDisplay: null,
        mention: truncate(header.mentionCode, 40),
        decisionCode: truncate(header.decisionCode, 60),
        decisionOutcome: truncate(header.decisionOutcome, 40),
        creditsAcquired: fitDecimal(header.creditsAcquired),
        creditsRequired: fitDecimal(header.creditsRequired),
        totalCoefficient: null,
        weightedTotal: null,
        distinctions: typeof summary.distinction === "string" && summary.distinction ? [summary.distinction.slice(0, 120)] : [],
      },
      annual,
      deliberation: held?.heldOn ? { heldOn: held.heldOn, nature: held.kind } : null,
      generalAppreciation: truncate(general?.body, 1000),
      attendance: null,
      rules: {
        ruleSetCode: header.ruleSetCode.slice(0, 80),
        ruleVersionNo: header.ruleVersionNo,
        ruleVersionId: header.ruleVersionId,
        definitionHash: header.definitionHash,
        contractId: header.contractId.slice(0, 80),
        engineVersion: header.engineVersion.slice(0, 40),
        resultsStateId: header.stateId,
        resultsVersion: s.resultsVersion,
        closureHash: closure?.closureHash ?? ZERO_HASH,
      },
      labels,
      explain,
    };
  }
}
