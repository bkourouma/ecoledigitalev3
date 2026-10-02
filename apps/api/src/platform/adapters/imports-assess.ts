/**
 * Import vers `assess` : les notes d'UNE évaluation, une ligne par élève (note, ou code ABS / ABJ / DISP). Écriture
 * EXCLUSIVEMENT par `assess.saveGrades` (avec son audit, son idempotence par inscription, ses contrôles de barème et de
 * décimales) ; lecture par `getGradeSheet`, `getAssessmentView`, `getAssessSettings` et `normalizeEntry`.
 *
 * L'import ne calcule RIEN : la note est transmise telle que saisie (chaîne décimale), jamais arrondie ni convertie ; les
 * moyennes, rangs et décisions restent l'affaire de `results` (recalcul déclenché par les événements d'`assess`).
 *
 * Écriture en LOT (`applyBatch`) : une seule feuille lue et un seul `saveGrades` par lot ; si le lot est refusé, repli ligne
 * à ligne (chaque ligne dans son SAVEPOINT) pour isoler les lignes fautives.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import { getAssessSettings, getAssessmentView, getGradeSheet, listAssessmentsView, normalizeEntry, saveGrades } from "../../modules/assess";
import type { ApplyItem, ApplyResult, GradeRow, ImportTargetPort, PlanItem, PlanResult, PlanRun } from "../../modules/imports";
import { resolveStudentRefs } from "../../modules/people";
import { issue, issuesFromError, type ImportWriteEnv } from "./imports-support";

const norm = (s: string): string => s.trim().toUpperCase();
const CAPS = { manage: true } as const;

interface Sheet {
  assessmentId: string;
  status: string;
  scaleMax: string;
  maxDecimals: number;
  /** studentId -> inscription et état actuel de la note. */
  byStudent: Map<string, { enrollmentId: string; gradeId: string | null; rowVersion: number | null; entryStatus: string | null; score: string | null; comment: string | null }>;
}

export function createGradesImportPort(env: ImportWriteEnv): ImportTargetPort<GradeRow> {
  async function loadSheet(ctx: RequestContext, assessmentId: string): Promise<Sheet | { error: ReturnType<typeof issuesFromError> }> {
    const sheet = await getGradeSheet(env.assess, ctx, { assessmentId, caps: CAPS });
    if (!sheet.ok) return { error: issuesFromError(sheet.error) };
    const settings = await getAssessSettings(env.assess, ctx);
    const byStudent: Sheet["byStudent"] = new Map();
    for (const g of sheet.value.grades) byStudent.set(g.studentId, { enrollmentId: g.enrollmentId, gradeId: g.id, rowVersion: g.rowVersion, entryStatus: g.entryStatus, score: g.score, comment: g.comment });
    for (const p of sheet.value.pending) byStudent.set(p.studentId, { enrollmentId: p.enrollmentId, gradeId: null, rowVersion: null, entryStatus: null, score: null, comment: null });
    return { assessmentId, status: sheet.value.assessment.status, scaleMax: sheet.value.assessment.scaleMax, maxDecimals: settings.ok ? settings.value.maxScoreDecimals : 2, byStudent };
  }
  async function students(ctx: RequestContext, refs: readonly string[]) {
    const r = await resolveStudentRefs(env.people, ctx, refs);
    return new Map((r.ok ? r.value : []).map((m) => [norm(m.ref), m.studentId]));
  }
  const entryOf = (row: GradeRow) => ({ ...(row.entry.status === "ENTERED" ? { score: row.entry.score as string } : {}), entryStatus: row.entry.status, ...(row.comment ? { comment: row.comment } : {}) });
  const same = (cur: Sheet["byStudent"] extends Map<string, infer V> ? V : never, row: GradeRow): boolean =>
    cur.entryStatus === row.entry.status && (row.entry.status !== "ENTERED" || Number(cur.score) === Number(row.entry.score)) && (row.comment ?? null) === (cur.comment ?? null);

  async function writeBatch(ctx: RequestContext, items: readonly ApplyItem<GradeRow>[], run: PlanRun, isolate: boolean): Promise<ApplyResult[]> {
    const assessmentId = String(run.options["assessmentId"]);
    const sheet = await loadSheet(ctx, assessmentId);
    if ("error" in sheet) return items.map((i) => ({ rowNo: i.rowNo, outcome: "FAILED" as const, issues: sheet.error }));
    const studentIds = await students(ctx, items.map((i) => i.row.studentRef));
    const results = new Map<number, ApplyResult>();
    const entries: Array<{ item: ApplyItem<GradeRow>; enrollmentId: string; previous: ReturnType<Sheet["byStudent"]["get"]>; entry: Record<string, unknown> }> = [];
    for (const item of items) {
      const studentId = studentIds.get(norm(item.row.studentRef));
      const cur = studentId ? sheet.byStudent.get(studentId) : undefined;
      if (!studentId || !cur) {
        results.set(item.rowNo, { rowNo: item.rowNo, outcome: "FAILED", issues: [issue("studentRef", "imports.reference_unknown", `L'élève « ${item.row.studentRef} » n'est pas inscrit dans la classe de cette évaluation.`)] });
        continue;
      }
      const exists = cur.gradeId !== null && cur.entryStatus !== "NOT_GRADED";
      if (exists && same(cur, item.row)) {
        results.set(item.rowNo, { rowNo: item.rowNo, outcome: "SKIPPED", entityId: cur.gradeId, issues: [] });
        continue;
      }
      if (exists && run.onExisting !== "UPDATE") {
        results.set(item.rowNo, { rowNo: item.rowNo, outcome: "SKIPPED", entityId: cur.gradeId, issues: [issue(null, "imports.already_imported", "Une note existe déjà pour cet élève : ligne ignorée.", "WARNING")] });
        continue;
      }
      entries.push({ item, enrollmentId: cur.enrollmentId, previous: cur, entry: { enrollmentId: cur.enrollmentId, ...entryOf(item.row), ...(cur.rowVersion !== null ? { rowVersion: cur.rowVersion } : {}) } });
    }
    const writeOne = async (e: (typeof entries)[number]): Promise<void> => {
      const r = await saveGrades(env.assess, ctx, { assessmentId, entries: [e.entry as never], caps: CAPS });
      if (!r.ok) results.set(e.item.rowNo, { rowNo: e.item.rowNo, outcome: "FAILED", issues: issuesFromError(r.error) });
      else results.set(e.item.rowNo, { rowNo: e.item.rowNo, outcome: e.previous?.gradeId && e.previous.entryStatus !== "NOT_GRADED" ? "UPDATED" : "CREATED", entityId: r.value.grades[0]?.id ?? null, issues: [] });
    };
    const maxBatch = env.assess.config.maxBatchSize;
    for (let i = 0; i < entries.length; i += maxBatch) {
      const part = entries.slice(i, i + maxBatch);
      if (isolate || part.length === 1) {
        for (const e of part) await writeOne(e);
        continue;
      }
      const r = await saveGrades(env.assess, ctx, { assessmentId, entries: part.map((e) => e.entry as never), caps: CAPS });
      if (r.ok) {
        const ids = new Map(r.value.grades.map((g) => [g.enrollmentId, g.id]));
        for (const e of part) results.set(e.item.rowNo, { rowNo: e.item.rowNo, outcome: e.previous?.gradeId && e.previous.entryStatus !== "NOT_GRADED" ? "UPDATED" : "CREATED", entityId: ids.get(e.enrollmentId) ?? null, issues: [] });
      } else {
        // Lot refusé : on isole la ou les lignes fautives, ligne à ligne.
        for (const e of part) await writeOne(e);
      }
    }
    return items.map((i) => results.get(i.rowNo) ?? { rowNo: i.rowNo, outcome: "FAILED" as const, issues: [issue(null, "imports.write_failed", "Ligne non traitée.")] });
  }

  return {
    async choices(ctx, optionKey) {
      if (optionKey !== "assessmentId") return [];
      const r = await listAssessmentsView(env.assess, ctx, { status: "DRAFT", limit: 100, caps: CAPS });
      return (r.ok ? r.value.items : []).map((a) => ({ value: a.id, label: `${a.title} — ${a.assessedOn} (barème ${a.scaleMax})` }));
    },
    async checkOptions(ctx, options) {
      const r = await getAssessmentView(env.assess, ctx, { assessmentId: String(options["assessmentId"]), caps: CAPS });
      if (!r.ok) return [issue("assessmentId", "imports.options_invalid", "Évaluation inconnue.")];
      if (r.value.status !== "DRAFT") return [issue("assessmentId", "imports.options_invalid", "Les notes de cette évaluation sont figées : retournez la feuille en brouillon avant d'importer.")];
      return [];
    },
    async plan(ctx, items: readonly PlanItem<GradeRow>[], run: PlanRun): Promise<PlanResult[]> {
      const sheet = await loadSheet(ctx, String(run.options["assessmentId"]));
      if ("error" in sheet) return items.map((i) => ({ rowNo: i.rowNo, action: "ERROR" as const, issues: sheet.error }));
      const ids = await students(ctx, items.map((i) => i.row.studentRef));
      const out: PlanResult[] = [];
      for (const item of items) {
        const row = item.row;
        const issues = [];
        if (sheet.status !== "DRAFT") issues.push(issue(null, "assess.grade_frozen", "Les notes de cette évaluation sont figées (la feuille n'est plus en brouillon)."));
        const studentId = ids.get(norm(row.studentRef));
        const cur = studentId ? sheet.byStudent.get(studentId) : undefined;
        if (!studentId) issues.push(issue("studentRef", "imports.reference_unknown", `Aucun élève avec le matricule « ${row.studentRef} ».`));
        else if (!cur) issues.push(issue("studentRef", "imports.reference_unknown", `L'élève « ${row.studentRef} » n'est pas inscrit dans la classe de cette évaluation.`));
        if (cur) {
          const n = normalizeEntry({ enrollmentId: cur.enrollmentId, ...entryOf(row) } as never, sheet.scaleMax, sheet.maxDecimals);
          if (!n.ok) issues.push(issue("entry", n.error.code, n.error.message));
        }
        if (issues.length > 0 || !cur) {
          out.push({ rowNo: item.rowNo, action: "ERROR", issues });
          continue;
        }
        const exists = cur.gradeId !== null && cur.entryStatus !== "NOT_GRADED";
        if (!exists) out.push({ rowNo: item.rowNo, action: "CREATE", issues });
        else if (same(cur, row)) out.push({ rowNo: item.rowNo, action: "SKIP", entityId: cur.gradeId, issues: [issue(null, "imports.already_imported", "La note est identique à celle déjà saisie.", "WARNING")] });
        else out.push({ rowNo: item.rowNo, action: run.onExisting === "UPDATE" ? "UPDATE" : "SKIP", entityId: cur.gradeId, issues: run.onExisting === "UPDATE" ? issues : [issue(null, "imports.already_imported", "Une note différente existe déjà : ligne ignorée (choisissez « mettre à jour » pour la remplacer).", "WARNING")] });
      }
      return out;
    },
    async apply(ctx, item, run) {
      const [r] = await writeBatch(ctx, [item], run, true);
      return r as ApplyResult;
    },
    async applyBatch(ctx, items, run) {
      return writeBatch(ctx, items, run, false);
    },
  };
}
