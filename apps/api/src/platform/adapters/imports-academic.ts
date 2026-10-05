/**
 * Imports vers `academic` : classes et curriculum (matières, noeuds). Écriture EXCLUSIVEMENT par l'API publique de
 * `academic` (`createClassroom`, `updateClassroom`, `createSubject`, `addCurriculumNode`, `updateCurriculumNode`) et lecture de
 * ses référentiels (programmes, niveaux, types de noeud) : jamais de SQL vers son schéma.
 *
 * Les codes (programme, niveau, type de noeud, matière) sont résolus par l'API publique ; l'état « existe déjà » vient de
 * l'API publique aussi (liste des classes d'une année, noeuds d'une version).
 */
import { unwrap, type RequestContext } from "@ecoledigitale/kernel";
import { AcademicCode, addCurriculumNode, enrollStudent, getAcademicYear, createClassroom, createSubject, getCurriculumVersion, getProgram, listAcademicYears, listClassrooms, listCurriculumNodes, listCurriculumVersions, listEnrollmentsByStudent, listPrograms, listReference, listSubjects, updateClassroom, updateCurriculumNode } from "../../modules/academic";
import { listInstitutions } from "../../modules/tenancy";
import type { ApplyItem, ApplyResult, EnrollmentRow, ImportTargetPort, PlanItem, PlanResult, PlanRun } from "../../modules/imports";
import { resolveStudentRefs } from "../../modules/people";
import { issue, issuesFromError, type ImportWriteEnv } from "./imports-support";

const norm = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();

/** Choix communs : établissements et années (utilisés par plusieurs importeurs). */
export async function institutionChoices(env: ImportWriteEnv, ctx: RequestContext) {
  const r = await listInstitutions({ db: env.kit.tenantDb, clock: env.kit.clock }, ctx);
  return (r.ok ? r.value : []).filter((i) => i.status === "ACTIVE").map((i) => ({ value: i.id, label: i.name }));
}

export async function yearChoices(env: ImportWriteEnv, ctx: RequestContext) {
  const out: Array<{ value: string; label: string }> = [];
  const institutions = await listInstitutions({ db: env.kit.tenantDb, clock: env.kit.clock }, ctx);
  if (!institutions.ok) return out;
  const many = institutions.value.length > 1;
  for (const inst of institutions.value) {
    if (inst.status !== "ACTIVE") continue;
    const years = await listAcademicYears(env.academic, ctx, { institutionId: inst.id });
    if (!years.ok) continue;
    for (const y of years.value) {
      if (y.status === "ARCHIVED") continue;
      out.push({ value: y.id, label: `${y.label}${y.isCurrent ? " (courante)" : ""}${many ? ` — ${inst.name}` : ""}` });
    }
  }
  return out;
}

/** Toutes les classes d'une année (pagination interne de `listClassrooms`). */
export async function classroomsOfYear(env: ImportWriteEnv, ctx: RequestContext, academicYearId: string, institutionId?: string) {
  const all = [];
  for (let page = 1; page <= 100; page += 1) {
    const r = unwrap(await listClassrooms(env.academic, ctx, { academicYearId, institutionId: institutionId ?? null, page, pageSize: 200 }));
    all.push(...r.items);
    if (all.length >= r.total || r.items.length === 0) break;
  }
  return all;
}

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------

interface ClassroomValues {
  code: string;
  name: string;
  programCode: string;
  gradeLevelCode: string;
  capacity?: number;
  startsOn?: string;
  endsOn?: string;
}

export function createClassroomsImportPort(env: ImportWriteEnv): ImportTargetPort<ClassroomValues & Record<string, unknown>> {
  async function lookups(ctx: RequestContext, institutionId: string, yearId: string) {
    const programs = unwrap(await listPrograms(env.academic, ctx, { institutionId }));
    const levels = unwrap(await listReference(env.academic, ctx, "grade-levels"));
    const classrooms = await classroomsOfYear(env, ctx, yearId, institutionId);
    return {
      programs: new Map(programs.map((p) => [norm(p.code), p])),
      levels: new Map(levels.map((l) => [norm(l.code), l])),
      classrooms: new Map(classrooms.map((c) => [norm(c.code), c])),
    };
  }
  return {
    async choices(ctx, optionKey) {
      if (optionKey === "institutionId") return institutionChoices(env, ctx);
      if (optionKey === "academicYearId") return yearChoices(env, ctx);
      return [];
    },
    async checkOptions(ctx, options) {
      const out = [];
      const institution = await env.academic.ports.institutions.getInstitution(ctx, String(options["institutionId"]));
      if (!institution) out.push(issue("institutionId", "imports.options_invalid", "Établissement inconnu."));
      const year = await getAcademicYear(env.academic, ctx, String(options["academicYearId"]));
      if (!year.ok) out.push(issue("academicYearId", "imports.options_invalid", "Année scolaire inconnue."));
      else if (year.value.institutionId !== String(options["institutionId"])) out.push(issue("academicYearId", "imports.options_invalid", "Cette année scolaire n'appartient pas à l'établissement choisi."));
      return out;
    },
    async plan(ctx, items, run) {
      const l = await lookups(ctx, String(run.options["institutionId"]), String(run.options["academicYearId"]));
      const out: PlanResult[] = [];
      for (const item of items) {
        const row = item.row;
        const issues = [];
        if (!l.programs.has(norm(row.programCode))) issues.push(issue("programCode", "imports.reference_unknown", `Programme « ${row.programCode} » inconnu dans cet établissement (programmes : ${[...l.programs.values()].slice(0, 6).map((p) => p.code).join(", ") || "aucun"}).`));
        if (!l.levels.has(norm(row.gradeLevelCode))) issues.push(issue("gradeLevelCode", "imports.reference_unknown", `Niveau « ${row.gradeLevelCode} » inconnu (niveaux : ${[...l.levels.values()].slice(0, 8).map((x) => x.code).join(", ") || "aucun"}).`));
        const existing = l.classrooms.get(norm(row.code));
        if (issues.length > 0) out.push({ rowNo: item.rowNo, action: "ERROR", issues });
        else if (!existing) out.push({ rowNo: item.rowNo, action: "CREATE", issues: [] });
        else out.push({ rowNo: item.rowNo, action: run.onExisting === "UPDATE" ? "UPDATE" : "SKIP", entityId: existing.id, issues: [] });
      }
      return out;
    },
    async apply(ctx, item, run): Promise<ApplyResult> {
      const row = item.row;
      const l = await lookups(ctx, String(run.options["institutionId"]), String(run.options["academicYearId"]));
      const program = l.programs.get(norm(row.programCode));
      const level = l.levels.get(norm(row.gradeLevelCode));
      if (!program || !level) return { rowNo: item.rowNo, outcome: "FAILED", issues: [issue(null, "imports.reference_unknown", "Programme ou niveau inconnu.")] };
      if (item.action === "UPDATE") {
        const existing = l.classrooms.get(norm(row.code));
        if (!existing) return { rowNo: item.rowNo, outcome: "FAILED", issues: [issue(null, AcademicCode.CLASSROOM_NOT_FOUND, "Classe introuvable.")] };
        const r = await updateClassroom(env.academic, ctx, existing.id, { name: row.name, ...(row.capacity !== undefined ? { capacity: row.capacity } : {}), ...(row.startsOn ? { startsOn: row.startsOn } : {}), ...(row.endsOn ? { endsOn: row.endsOn } : {}) });
        return r.ok ? { rowNo: item.rowNo, outcome: "UPDATED", entityId: existing.id, issues: [] } : { rowNo: item.rowNo, outcome: "FAILED", issues: issuesFromError(r.error) };
      }
      const r = await createClassroom(env.academic, ctx, {
        institutionId: String(run.options["institutionId"]),
        academicYearId: String(run.options["academicYearId"]),
        programId: program.id,
        gradeLevelId: level.id,
        code: row.code,
        name: row.name,
        ...(row.capacity !== undefined ? { capacity: row.capacity } : {}),
        ...(row.startsOn ? { startsOn: row.startsOn } : {}),
        ...(row.endsOn ? { endsOn: row.endsOn } : {}),
      });
      return r.ok ? { rowNo: item.rowNo, outcome: "CREATED", entityId: r.value.id, issues: [] } : { rowNo: item.rowNo, outcome: "FAILED", issues: issuesFromError(r.error) };
    },
  };
}

// ---------------------------------------------------------------------------
// Curriculum : matières et noeuds
// ---------------------------------------------------------------------------

interface NodeValues {
  code: string;
  label: string;
  nodeTypeCode: string;
  parentCode?: string;
  subjectCode?: string;
  gradeLevelCode?: string;
  coefficient?: string;
  credits?: string;
  periodTypeCode?: string;
  periodOrdinal?: number;
  ordinal?: number;
  isMandatory?: boolean;
  hoursTotal?: string;
}

export function createCurriculumImportPort(env: ImportWriteEnv): ImportTargetPort<NodeValues & Record<string, unknown>> {
  const keyOf = (versionId: string, code: string): string => `curriculum|${versionId}|${code}`;
  async function lookups(ctx: RequestContext, versionId: string) {
    const version = unwrap(await getCurriculumVersion(env.academic, ctx, versionId));
    const program = unwrap(await getProgram(env.academic, ctx, version.programId));
    const nodes = unwrap(await listCurriculumNodes(env.academic, ctx, versionId));
    const types = unwrap(await listReference(env.academic, ctx, "node-types"));
    const subjects = unwrap(await listSubjects(env.academic, ctx, { institutionId: program.institutionId }));
    const levels = unwrap(await listReference(env.academic, ctx, "grade-levels"));
    return {
      levels: new Map(levels.map((l) => [norm(l.code), l])),
      version,
      program,
      nodes: new Map(nodes.map((n) => [norm(n.code), n])),
      types: new Map(types.map((t) => [norm(t.code), t])),
      subjects: new Map(subjects.map((s) => [norm(s.code), s])),
    };
  }
  return {
    async choices(ctx, optionKey) {
      if (optionKey !== "curriculumVersionId") return [];
      const versions = unwrap(await listCurriculumVersions(env.academic, ctx, { status: "DRAFT" }));
      const out = [];
      for (const v of versions) {
        const program = await getProgram(env.academic, ctx, v.programId);
        out.push({ value: v.id, label: `${program.ok ? program.value.label : v.programId} — brouillon (${v.nodeCount} noeud(s))` });
      }
      return out;
    },
    async checkOptions(ctx, options) {
      const r = await getCurriculumVersion(env.academic, ctx, String(options["curriculumVersionId"]));
      if (!r.ok) return [issue("curriculumVersionId", "imports.options_invalid", "Version de curriculum inconnue.")];
      if (r.value.status !== "DRAFT") return [issue("curriculumVersionId", "imports.options_invalid", "Seule une version en brouillon peut recevoir des noeuds.")];
      return [];
    },
    async plan(ctx, items: readonly PlanItem<NodeValues & Record<string, unknown>>[], run: PlanRun) {
      const versionId = String(run.options["curriculumVersionId"]);
      const l = await lookups(ctx, versionId);
      const out: PlanResult[] = [];
      for (const item of items) {
        const row = item.row;
        const issues = [];
        if (!l.types.has(norm(row.nodeTypeCode))) issues.push(issue("nodeTypeCode", "imports.reference_unknown", `Type de noeud « ${row.nodeTypeCode} » inconnu (types : ${[...l.types.values()].map((t) => t.code).join(", ")}).`));
        if (row.parentCode && !l.nodes.has(norm(row.parentCode)) && !item.inFileDependencies.has(keyOf(versionId, row.parentCode))) {
          issues.push(issue("parentCode", "imports.reference_unknown", `Le parent « ${row.parentCode} » n'existe pas dans la version et n'est pas déclaré plus haut dans le fichier.`));
        }
        if (row.gradeLevelCode && !l.levels.has(norm(row.gradeLevelCode))) issues.push(issue("gradeLevelCode", "imports.reference_unknown", `Niveau « ${row.gradeLevelCode} » inconnu.`));
        if (row.subjectCode && !l.subjects.has(norm(row.subjectCode))) issues.push(issue("subjectCode", "imports.reference_unknown", `La matière « ${row.subjectCode} » n'existe pas : elle sera créée à partir du libellé.`, "WARNING"));
        const existing = l.nodes.get(norm(row.code));
        if (issues.some((i) => i.severity === "ERROR")) out.push({ rowNo: item.rowNo, action: "ERROR", issues });
        else if (!existing) out.push({ rowNo: item.rowNo, action: "CREATE", issues });
        else out.push({ rowNo: item.rowNo, action: run.onExisting === "UPDATE" ? "UPDATE" : "SKIP", entityId: existing.id, issues });
      }
      return out;
    },
    async apply(ctx, item: ApplyItem<NodeValues & Record<string, unknown>>, run: PlanRun): Promise<ApplyResult> {
      const row = item.row;
      const versionId = String(run.options["curriculumVersionId"]);
      const l = await lookups(ctx, versionId);
      let subjectId: string | null = null;
      if (row.subjectCode) {
        const known = l.subjects.get(norm(row.subjectCode));
        if (known) subjectId = known.id;
        else {
          const created = await createSubject(env.academic, ctx, { institutionId: l.program.institutionId, code: row.subjectCode, label: row.label });
          if (!created.ok) return { rowNo: item.rowNo, outcome: "FAILED", issues: issuesFromError(created.error) };
          subjectId = created.value.id;
        }
      }
      const parent = row.parentCode ? l.nodes.get(norm(row.parentCode)) : undefined;
      if (row.parentCode && !parent) return { rowNo: item.rowNo, outcome: "FAILED", issues: [issue("parentCode", "imports.reference_unknown", `Parent « ${row.parentCode} » introuvable.`)] };
      const level = row.gradeLevelCode ? l.levels.get(norm(row.gradeLevelCode)) : undefined;
      const fields = {
        label: row.label,
        ...(level ? { gradeLevelId: level.id } : {}),
        ...(subjectId ? { subjectId } : {}),
        ...(row.coefficient !== undefined ? { coefficient: row.coefficient } : {}),
        ...(row.credits !== undefined ? { credits: row.credits } : {}),
        ...(row.periodTypeCode ? { periodTypeCode: row.periodTypeCode } : {}),
        ...(row.periodOrdinal !== undefined ? { periodOrdinal: row.periodOrdinal } : {}),
        ...(row.ordinal !== undefined ? { ordinal: row.ordinal } : {}),
        ...(row.isMandatory !== undefined ? { isMandatory: row.isMandatory } : {}),
        ...(row.hoursTotal !== undefined ? { hoursTotal: row.hoursTotal } : {}),
      };
      if (item.action === "UPDATE") {
        const existing = l.nodes.get(norm(row.code));
        if (!existing) return { rowNo: item.rowNo, outcome: "FAILED", issues: [issue(null, AcademicCode.NODE_NOT_FOUND, "Noeud introuvable.")] };
        const r = await updateCurriculumNode(env.academic, ctx, existing.id, fields);
        return r.ok ? { rowNo: item.rowNo, outcome: "UPDATED", entityId: existing.id, issues: [] } : { rowNo: item.rowNo, outcome: "FAILED", issues: issuesFromError(r.error) };
      }
      const r = await addCurriculumNode(env.academic, ctx, versionId, { nodeTypeCode: row.nodeTypeCode, code: row.code, parentId: parent?.id ?? null, ...fields });
      return r.ok ? { rowNo: item.rowNo, outcome: "CREATED", entityId: r.value.id, issues: [] } : { rowNo: item.rowNo, outcome: "FAILED", issues: issuesFromError(r.error) };
    },
  };
}

// ---------------------------------------------------------------------------
// Inscriptions (O-13) : des élèves DÉJÀ enregistrés vers les classes d'une année
// ---------------------------------------------------------------------------

const LIVE_ENROLLMENT = new Set(["PENDING", "ACTIVE", "SUSPENDED", "COMPLETED"]);
const OPEN_CLASSROOM = new Set(["DRAFT", "ACTIVE"]);

/**
 * Importeur « inscriptions » : l'élève est désigné par son matricule (d'origine, de la plateforme ou numéro d'inscription), la
 * classe par son code dans l'année choisie. Aucune fiche élève n'est créée ni modifiée. Écriture EXCLUSIVEMENT par
 * `academic.enrollStudent` (classe ouverte, une inscription de classe par année, capacité dure, financement, confirmation).
 *
 * Le PLAN est en lecture seule (aucun cas d'usage d'écriture, même annulé) : élève et classe résolus, statut de l'élève, classe
 * ouverte, financement connu, inscription déjà vivante dans la même classe (ligne ignorée : rejeu sans doublon) ou dans une autre
 * classe de l'année (refus : un changement de classe se fait dans `academic`), effectif prévisible de la classe (avertissement).
 */
export function createEnrollmentsImportPort(env: ImportWriteEnv): ImportTargetPort<EnrollmentRow> {
  const cache = new Map<string, { at: number; byCode: Map<string, Awaited<ReturnType<typeof classroomsOfYear>>[number]>; funding: Set<string> }>();
  async function classesFor(ctx: RequestContext, yearId: string, jobId: string) {
    const hit = cache.get(jobId);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit;
    for (const [k, v] of cache) if (Date.now() - v.at > 30 * 60_000) cache.delete(k);
    const classes = await classroomsOfYear(env, ctx, yearId);
    const funding = await listReference(env.academic, ctx, "funding-types");
    const entry = { at: Date.now(), byCode: new Map(classes.map((c) => [norm(c.code), c])), funding: new Set(funding.ok ? funding.value.map((f) => norm(f.code)) : []) };
    cache.set(jobId, entry);
    return entry;
  }
  async function students(ctx: RequestContext, refs: readonly string[]) {
    const r = await resolveStudentRefs(env.people, ctx, refs);
    return new Map((r.ok ? r.value : []).map((m) => [norm(m.ref), m.studentId]));
  }
  const bodyOf = (row: EnrollmentRow, studentId: string, classroomId: string) => ({
    studentId,
    classroomId,
    sourceKind: "IMPORT" as const,
    ...(row.enrolledOn ? { enrolledOn: row.enrolledOn } : {}),
    ...(row.fundingType ? { fundingType: row.fundingType } : {}),
    ...(row.assignmentReference ? { assignmentReference: row.assignmentReference } : {}),
  });

  async function writeOne(ctx: RequestContext, item: ApplyItem<EnrollmentRow>, run: PlanRun, studentId: string | undefined): Promise<ApplyResult> {
    const row = item.row;
    const classes = await classesFor(ctx, String(run.options["academicYearId"] ?? ""), run.jobId);
    const room = classes.byCode.get(norm(row.classCode));
    if (!studentId) return { rowNo: item.rowNo, outcome: "FAILED", issues: [issue("studentRef", "imports.reference_unknown", `Aucun élève avec le matricule « ${row.studentRef} ».`)] };
    if (!room) return { rowNo: item.rowNo, outcome: "FAILED", issues: [issue("classCode", "imports.reference_unknown", `Classe « ${row.classCode} » inconnue pour cette année scolaire.`)] };
    const r = await enrollStudent(env.academic, ctx, bodyOf(row, studentId, room.id) as never);
    if (r.ok) return { rowNo: item.rowNo, outcome: "CREATED", entityId: r.value.id, issues: [] };
    if (r.error.code === AcademicCode.ALREADY_ENROLLED) return { rowNo: item.rowNo, outcome: "SKIPPED", issues: [issue(null, "imports.already_imported", "L'élève est déjà inscrit dans cette classe : ligne ignorée.", "WARNING")] };
    return { rowNo: item.rowNo, outcome: "FAILED", issues: issuesFromError(r.error) };
  }

  return {
    async choices(ctx, optionKey) {
      return optionKey === "academicYearId" ? yearChoices(env, ctx) : [];
    },
    async checkOptions(ctx, options) {
      const year = await getAcademicYear(env.academic, ctx, String(options["academicYearId"]));
      if (!year.ok) return [issue("academicYearId", "imports.options_invalid", "Année scolaire inconnue.")];
      if (year.value.status !== "DRAFT" && year.value.status !== "OPEN") return [issue("academicYearId", "imports.options_invalid", "Cette année scolaire n'accepte plus d'inscription : choisissez l'année courante ou celle qui s'ouvre.")];
      return [];
    },
    async plan(ctx, items: readonly PlanItem<EnrollmentRow>[], run: PlanRun): Promise<PlanResult[]> {
      const yearId = String(run.options["academicYearId"] ?? "");
      const classes = await classesFor(ctx, yearId, run.jobId);
      const ids = await students(ctx, items.map((i) => i.row.studentRef));
      const incoming = new Map<string, number>(); // effectif prévisible par classe, dans ce lot
      const out: PlanResult[] = [];
      for (const item of items) {
        const row = item.row;
        const issues = [];
        const studentId = ids.get(norm(row.studentRef));
        const room = classes.byCode.get(norm(row.classCode));
        if (!studentId) issues.push(issue("studentRef", "imports.reference_unknown", `Aucun élève avec le matricule « ${row.studentRef} ». L'importeur d'inscriptions ne crée pas de fiche : importez d'abord les élèves.`));
        if (!room) issues.push(issue("classCode", "imports.reference_unknown", `Classe « ${row.classCode} » inconnue pour cette année scolaire.`));
        else if (!OPEN_CLASSROOM.has(room.status)) issues.push(issue("classCode", AcademicCode.CLASSROOM_NOT_OPEN, `La classe « ${row.classCode} » est ${room.status} : elle n'accepte plus d'inscription.`));
        if (row.fundingType && !classes.funding.has(norm(row.fundingType))) issues.push(issue("fundingType", "imports.reference_unknown", `Type de financement « ${row.fundingType} » inconnu.`));
        if (studentId) {
          const student = await env.academic.ports.students.getStudent(ctx, studentId);
          if (!student) issues.push(issue("studentRef", "imports.reference_unknown", `Aucun élève avec le matricule « ${row.studentRef} ».`));
          else if (!env.academic.config.enrollableStudentStatuses.includes(student.status)) issues.push(issue("studentRef", AcademicCode.STUDENT_NOT_ENROLLABLE, `Le dossier de l'élève est ${student.status} : il ne peut pas être inscrit.`));
        }
        let sameClass: string | null = null;
        if (studentId && room && !issues.some((i) => i.severity === "ERROR")) {
          const existing = await listEnrollmentsByStudent(env.academic, ctx, studentId);
          const mine = existing.ok ? existing.value.filter((e) => LIVE_ENROLLMENT.has(e.status)) : [];
          const same = mine.find((e) => e.classroomId === room.id);
          const other = mine.find((e) => e.academicYearId === yearId && e.mode === "CLASS" && e.classroomId !== room.id);
          if (same) sameClass = same.id;
          else if (other) {
            const where = [...classes.byCode.values()].find((c) => c.id === other.classroomId);
            issues.push(issue("classCode", AcademicCode.CLASS_ENROLLMENT_EXISTS, `L'élève est déjà inscrit cette année${where ? ` dans la classe « ${where.code} »` : " dans une autre classe"} : un changement de classe se fait dans les inscriptions, pas par import.`));
          }
        }
        if (issues.some((i) => i.severity === "ERROR")) {
          out.push({ rowNo: item.rowNo, action: "ERROR", issues });
          continue;
        }
        if (sameClass) {
          out.push({ rowNo: item.rowNo, action: "SKIP", entityId: sameClass, issues: [issue(null, "imports.already_imported", "L'élève est déjà inscrit dans cette classe : ligne ignorée.", "WARNING")] });
          continue;
        }
        if (room && room.capacity !== null) {
          const planned = (incoming.get(room.id) ?? 0) + 1;
          incoming.set(room.id, planned);
          if (room.enrolledCount + planned > room.capacity) {
            issues.push(
              room.capacityIsHard
                ? issue("classCode", AcademicCode.CLASSROOM_FULL, `La classe « ${room.code} » (${room.capacity} places, ${room.enrolledCount} inscrits) risque d'être pleine : l'inscription sera refusée si la capacité est atteinte.`, "WARNING")
                : issue("classCode", AcademicCode.CLASSROOM_FULL, `La classe « ${room.code} » dépasse sa capacité indicative (${room.capacity}).`, "WARNING"),
            );
          }
        }
        out.push({ rowNo: item.rowNo, action: "CREATE", issues });
      }
      return out;
    },
    async apply(ctx, item: ApplyItem<EnrollmentRow>, run: PlanRun): Promise<ApplyResult> {
      const ids = await students(ctx, [item.row.studentRef]);
      return writeOne(ctx, item, run, ids.get(norm(item.row.studentRef)));
    },
  };
}
