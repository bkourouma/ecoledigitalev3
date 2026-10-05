/**
 * États et rapports du primaire — LECTURE SEULE (R1 à R7). Chaque rapport est un tableau `{ columns, rows }` reproductible
 * (paramètres renvoyés), exportable en CSV, borné par le périmètre du demandeur (un instituteur ne voit que ses classes).
 *
 * R8 (états destinés à l'administration) n'est pas livré : les formats officiels sont inconnus (question Q-P12). Les rapports
 * ci-dessous ne contiennent aucune moyenne, aucun rang ni aucun seuil ; ils comptent.
 * Les colonnes « sexe », « âge » et « financement » de R2 attendent un port de statistiques d'inscription (non livré).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { PrimaryProgressDto, PrimaryReportKey, PrimaryReportQuery } from "@ecoledigitale/contracts/src/v2/primary_school";
import { PrimaryCode, forbidden, validation } from "../domain/errors";
import type { CallerCaps, SourceKind, Uuid } from "../domain/types";
import { countByStatus } from "../infrastructure/assessments-repository";
import { listFrameworkRows } from "../infrastructure/reference-repository";
import { reviewCounts } from "../infrastructure/reviews-repository";
import { requireClassAccess } from "./access";
import { getCouncil } from "./council";
import { getCompetencySheet, listMyClassrooms } from "./competencies";
import { inTx, type PrimarySchoolDeps } from "./deps";
import type { ClassroomInfo } from "./ports";
import { ruleSourceOfClass } from "./reviews";

export type ReportCell = string | number | boolean | null;

export interface Report {
  key: PrimaryReportKey;
  title: string;
  generatedAt: string;
  parameters: Record<string, string | null>;
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, ReportCell>>;
}

const yesNo = (v: boolean): string => (v ? "Oui" : "Non");

/** Libellé d'une colonne du registre d'appel : le jour du mois, suivi de la demi-journée quand l'appel se fait le matin et l'après-midi (Q-P17). */
export function registerColumnLabel(slot: string): string {
  const day = slot.slice(8, 10);
  if (slot.endsWith(":MORNING")) return `${day} matin`;
  if (slot.endsWith(":AFTERNOON")) return `${day} après-midi`;
  return day;
}

/** CSV (séparateur `;`, guillemets doublés, BOM pour Excel). Une cellule qui commence par `= + - @` est neutralisée (injection de formule). */
export function reportToCsv(report: Report): string {
  const esc = (v: ReportCell): string => {
    let s = v === null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = report.columns.map((c) => esc(c.label)).join(";");
  const lines = report.rows.map((r) => report.columns.map((c) => esc(r[c.key] ?? null)).join(";"));
  return `﻿${[head, ...lines].join("\r\n")}\r\n`;
}

export async function buildReport(deps: PrimarySchoolDeps, ctx: RequestContext, key: PrimaryReportKey, q: PrimaryReportQuery, caps: CallerCaps): Promise<Result<Report, AppError>> {
  const base = { key, generatedAt: deps.clock.now().toISOString(), parameters: { classroomId: q.classroomId ?? null, periodId: q.periodId ?? null, yearId: q.yearId ?? null, month: q.month ?? null, deliberationId: q.deliberationId ?? null } };
  const need = (value: string | undefined, name: string): Result<string, AppError> | null => (value ? null : err(validation(PrimaryCode.INVALID_INPUT, `Paramètre « ${name} » requis pour ce rapport.`, name)));

  switch (key) {
    case "class-list": {
      const miss = need(q.classroomId, "classroomId");
      if (miss) return miss as Result<never, AppError>;
      const access = await requireClassAccess(deps, ctx, q.classroomId as Uuid, caps);
      if (!access.ok) return access;
      const roster = await deps.ports.classrooms.listRoster(ctx, access.value.classroom.id);
      return ok({
        ...base,
        title: `Liste de classe — ${access.value.classroom.name ?? ""}`.trim(),
        columns: [{ key: "n", label: "N°" }, { key: "student", label: "Élève" }, { key: "repeating", label: "Redoublant" }],
        rows: roster.map((r, i) => ({ n: i + 1, student: r.displayName, repeating: yesNo(r.isRepeating) })),
      });
    }
    case "enrollment-stats":
    case "repeaters": {
      if (!caps.allClasses) return err(forbidden("Ce rapport est réservé à la direction."));
      const classrooms = await deps.ports.classrooms.listClassrooms(ctx, { academicYearId: q.yearId });
      const rows: Report["rows"] = [];
      for (const c of classrooms) {
        const roster = await deps.ports.classrooms.listRoster(ctx, c.id);
        if (key === "enrollment-stats") rows.push({ classroom: c.name, grade: c.gradeLevelCode, students: roster.length, repeaters: roster.filter((r) => r.isRepeating).length });
        else for (const r of roster.filter((x) => x.isRepeating)) rows.push({ classroom: c.name, grade: c.gradeLevelCode, student: r.displayName });
      }
      return ok(
        key === "enrollment-stats"
          ? { ...base, title: "Effectifs par niveau et par classe", columns: [{ key: "grade", label: "Niveau" }, { key: "classroom", label: "Classe" }, { key: "students", label: "Élèves" }, { key: "repeaters", label: "Redoublants" }], rows }
          : { ...base, title: "Redoublants", columns: [{ key: "grade", label: "Niveau" }, { key: "classroom", label: "Classe" }, { key: "student", label: "Élève" }], rows },
      );
    }
    case "attendance-register": {
      const miss = need(q.classroomId, "classroomId") ?? need(q.month, "month");
      if (miss) return miss as Result<never, AppError>;
      const access = await requireClassAccess(deps, ctx, q.classroomId as Uuid, caps);
      if (!access.ok) return access;
      const reg = await deps.ports.attendance.monthlyRegister(ctx, { classroomId: access.value.classroom.id, month: q.month as string });
      return ok({
        ...base,
        title: `Registre d'appel — ${q.month}`,
        columns: [{ key: "student", label: "Élève" }, ...reg.days.map((d) => ({ key: d, label: registerColumnLabel(d) }))],
        rows: reg.rows.map((r) => ({ student: r.displayName, ...Object.fromEntries(reg.days.map((d) => [d, r.days[d] ?? ""])) })),
      });
    }
    case "competency-coverage": {
      const miss = need(q.classroomId, "classroomId") ?? need(q.periodId, "periodId");
      if (miss) return miss as Result<never, AppError>;
      const sheet = await getCompetencySheet(deps, ctx, { classroomId: q.classroomId as Uuid, periodId: q.periodId as Uuid }, caps);
      if (!sheet.ok) return sheet;
      const s = sheet.value;
      const perStudent = new Map(s.completeness.byEnrollment.map((b) => [b.enrollmentId, b]));
      const perStudentExpected = s.framework ? s.framework.domains.reduce((n, d) => n + d.competencies.length, 0) : 0;
      return ok({
        ...base,
        title: "Couverture des compétences",
        columns: [{ key: "student", label: "Élève" }, { key: "expected", label: "Attendues" }, { key: "recorded", label: "Saisies" }, { key: "validated", label: "Validées" }, { key: "missing", label: "Non évaluées" }],
        rows: s.students.map((st) => {
          const b = perStudent.get(st.enrollmentId);
          return { student: st.displayName, expected: perStudentExpected, recorded: b?.recorded ?? 0, validated: b?.validated ?? 0, missing: Math.max(perStudentExpected - (b?.recorded ?? 0), 0) };
        }),
      });
    }
    case "council-pack": {
      const miss = need(q.deliberationId, "deliberationId");
      if (miss) return miss as Result<never, AppError>;
      const council = await getCouncil(deps, ctx, q.deliberationId as Uuid, caps);
      if (!council.ok) return council;
      return ok({
        ...base,
        title: "Dossier du conseil des maîtres",
        columns: [
          { key: "student", label: "Élève" },
          { key: "reasons", label: "Motifs d'examen" },
          { key: "ruleProposal", label: "Proposition de la règle" },
          { key: "teacherProposal", label: "Proposition de l'instituteur" },
          { key: "status", label: "Statut" },
          { key: "final", label: "Décision" },
        ],
        rows: council.value.cases.map((c) => ({ student: c.studentName, reasons: c.reasonCodes.join(", "), ruleProposal: c.ruleProposalCode, teacherProposal: c.proposalCode, status: c.status, final: c.finalCode })),
      });
    }
    case "progress": {
      if (!caps.allClasses) return err(forbidden("Ce rapport est réservé à la direction."));
      const progress = await getProgress(deps, ctx, { yearId: q.yearId }, caps);
      if (!progress.ok) return progress;
      return ok({
        ...base,
        title: "Avancement des classes",
        columns: [{ key: "classroom", label: "Classe" }, { key: "locked", label: "Période verrouillée" }, { key: "students", label: "Élèves" }, { key: "expected", label: "Compétences attendues" }, { key: "recorded", label: "Saisies" }, { key: "validated", label: "Validées" }, { key: "reviewsSealed", label: "Bilans scellés" }, { key: "reviewsTotal", label: "Bilans" }],
        rows: progress.value.map((p) => ({ classroom: p.name, locked: yesNo(p.locked), students: p.studentCount, expected: p.competencies.expected, recorded: p.competencies.recorded, validated: p.competencies.validated, reviewsSealed: p.reviews.sealed, reviewsTotal: p.reviews.total })),
      });
    }
    default:
      return err(validation(PrimaryCode.REPORT_UNKNOWN, `Rapport inconnu : ${String(key)}.`, "key"));
  }
}

/**
 * Bandeau permanent « Règles de démonstration » : `isPlaceholder` dès qu'une classe visible est calculée avec un jeu de règles FICTIF
 * (`source_kind = placeholder`). Sans classe visible ou sans règle liée : `null`, pas de bandeau.
 */
export async function getRuleBanner(deps: PrimarySchoolDeps, ctx: RequestContext, input: { classroomId?: Uuid | undefined }, caps: CallerCaps): Promise<Result<{ ruleSourceKind: SourceKind | null; isPlaceholder: boolean }, AppError>> {
  const classrooms: ClassroomInfo[] = [];
  if (input.classroomId) {
    const access = await requireClassAccess(deps, ctx, input.classroomId, caps);
    if (!access.ok) return access;
    classrooms.push(access.value.classroom);
  } else {
    const mine = await listMyClassrooms(deps, ctx, caps);
    if (!mine.ok) return mine;
    for (const m of mine.value) {
      const c = await deps.ports.classrooms.getClassroom(ctx, m.classroomId);
      if (c) classrooms.push(c);
    }
  }
  let found: SourceKind | null = null;
  for (const c of classrooms) {
    const kind = await ruleSourceOfClass(deps, ctx, c);
    if (kind === "placeholder") return ok({ ruleSourceKind: "placeholder", isPlaceholder: true });
    found ??= kind;
  }
  return ok({ ruleSourceKind: found, isPlaceholder: false });
}

/**
 * Avancement des classes (direction) : comptages BRUTS par classe × période — saisies attendues / saisies / validées, bilans scellés,
 * verrou de période. Les « feux » (vert, orange, rouge) de l'écran se déduisent de ces comptages côté interface ; aucun seuil ici.
 */
export async function getProgress(deps: PrimarySchoolDeps, ctx: RequestContext, filter: { yearId?: Uuid | undefined }, caps: CallerCaps): Promise<Result<PrimaryProgressDto[], AppError>> {
  if (!caps.allClasses) return err(forbidden("L'avancement de toutes les classes est réservé à la direction."));
  const classrooms = await deps.ports.classrooms.listClassrooms(ctx, { academicYearId: filter.yearId });
  const out: PrimaryProgressDto[] = [];
  for (const c of classrooms) {
    const periods = await deps.ports.classrooms.listPeriods(ctx, c.academicYearId);
    const roster = await deps.ports.classrooms.listRoster(ctx, c.id);
    for (const p of periods) {
      const state = await deps.ports.periods.getState(ctx, { classroomId: c.id, periodId: p.id });
      const counted = await inTx(
        deps,
        ctx,
        async (tx) => {
          const fws = (await listFrameworkRows(tx, { status: "PUBLISHED" })).filter((f) => c.gradeLevelCode === null || f.gradeLevelCodes.includes(c.gradeLevelCode));
          const perStudentExpected = fws.reduce((n, f) => n + f.competencyCount, 0);
          const status = await countByStatus(tx, { classroomId: c.id, periodId: p.id });
          const reviews = await reviewCounts(tx, { classroomId: c.id, yearId: c.academicYearId });
          return ok({ expected: perStudentExpected * roster.length, recorded: status.draft + status.validated, validated: status.validated, reviews });
        },
        { readOnly: true },
      );
      if (!counted.ok) return counted;
      out.push({
        classroomId: c.id,
        name: c.name,
        periodId: p.id,
        locked: state.locked,
        studentCount: roster.length,
        competencies: { expected: counted.value.expected, recorded: counted.value.recorded, validated: counted.value.validated },
        reviews: counted.value.reviews,
      });
    }
  }
  return ok(out);
}
