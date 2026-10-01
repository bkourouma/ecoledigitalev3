/**
 * Monde de test : un tenant avec ses référentiels (modèle de pack instancié), une année ouverte, des périodes,
 * un programme, un curriculum publié et une classe active. Construit UNIQUEMENT par les cas d'usage publics.
 */
import { ManualClock, newId, unwrap, type RequestContext } from "@ecoledigitale/kernel";
import {
  applyPeriodPlan,
  addCurriculumNode,
  classroomAction,
  createAcademicYear,
  createAcademicDeps,
  createClassroom,  createCurriculumVersion,
  createProgram,
  createSubject,
  InMemoryStudentDirectory,
  instantiatePackReferenceData,
  listReference,
  openAcademicYear,
  openPeriod,
  publishCurriculumVersion,
  RecordingAudit,
  setCurrentAcademicYear,
  type AcademicDeps,
  type AcademicPorts,
  type StudentSummary,
} from "../../index";
import { addDays, defaultYearEnd } from "../../domain/dates";
import { ctxFor, type AcademicTestDb } from "./db";

export interface World {
  db: AcademicTestDb;
  deps: AcademicDeps;
  clock: ManualClock;
  audit: RecordingAudit;
  students: InMemoryStudentDirectory;
  tenantId: string;
  ctx: RequestContext;
  institutionId: string;
}

export function makeWorld(db: AcademicTestDb, tenantId: string, options: { ports?: Partial<AcademicPorts>; institutionId?: string; ctx?: RequestContext } = {}): World {
  const clock = new ManualClock(new Date());
  const audit = new RecordingAudit();
  const students = new InMemoryStudentDirectory();
  const deps = createAcademicDeps({ db: db.tenantDb, clock, audit, ports: { students, ...options.ports } });
  return { db, deps, clock, audit, students, tenantId, ctx: options.ctx ?? ctxFor(tenantId, newId(), ["admin"], { mfa: true }), institutionId: options.institutionId ?? newId() };
}

/** Date civile (UTC) du jour de l'horloge du monde. */
export const todayOf = (w: World): string => w.clock.now().toISOString().slice(0, 10);

/** Année de douze mois qui CONTIENT aujourd'hui (début : 100 jours avant). */
export function currentYearDates(w: World): { startsOn: string; endsOn: string } {
  const startsOn = addDays(todayOf(w), -100);
  return { startsOn, endsOn: defaultYearEnd(startsOn) };
}

/** Année CONTIGUË à celle qui se termine le `afterEndsOn` (la règle « pas de trou » est appliquée par le cas d'usage). */
export async function createNextYear(w: World, afterEndsOn: string, code: string) {
  return unwrap(await createAcademicYear(w.deps, w.ctx, { institutionId: w.institutionId, code, label: code, startsOn: addDays(afterEndsOn, 1) }));
}

/**
 * Numéros d'ordre des dossiers (spec 008) : UNIQUES par établissement, donc jamais tirés au hasard — un tirage dans
 * [1, 90 000] fait collisionner deux élèves de 200 (anniversaire, ≈ 20 %), donc deux numéros d'inscription égaux
 * (`academic.registration_number_conflict`) : un test intermittent dont la cause est la donnée, pas le module.
 * Départ à 100 000 pour ne jamais heurter les numéros explicites (`sequenceNumber: 7`…).
 */
let nextStudentSequence = 100_000;

export function addStudent(w: World, overrides: Partial<StudentSummary> = {}, userId?: string): StudentSummary {
  const id = overrides.studentId ?? newId();
  const s: StudentSummary = { studentId: id, status: "ACTIVE", displayName: `Élève ${id.slice(-4)}`, studentNumber: null, sequenceNumber: (nextStudentSequence += 1), ...overrides };
  w.students.add(s, userId);
  return s;
}

export async function applyTemplate(w: World, pack: "PRIMARY" | "SECONDARY" | "HIGHER" | "VIRTUAL" = "HIGHER"): Promise<void> {
  unwrap(await instantiatePackReferenceData(w.deps, w.ctx, w.institutionId, { pack, educationSystem: "CI" }));
}

export interface HigherSeed {
  yearId: string;
  periodIds: string[];
  programId: string;
  gradeLevelId: string;
  versionId: string;
  levelNodeId: string;
  periodNodeId: string;
  ue1: { id: string; lineageId: string; ecueIds: string[] };
  ue2: { id: string; lineageId: string; ecueIds: string[] };
  subjectIds: string[];
  classroomId: string;
}

/**
 * Supérieur (LMD) : licence 1, deux semestres ouverts, deux UE de six crédits (deux ECUE chacune), curriculum publié,
 * classe active de capacité 100. Les codes de nœuds et de matières sont des DONNÉES de test.
 */
export async function seedHigher(w: World, options: { capacity?: number | null; classroomCode?: string; openPeriod?: boolean } = {}): Promise<HigherSeed> {
  await applyTemplate(w, "HIGHER");
  const { startsOn, endsOn } = currentYearDates(w);
  const year = unwrap(await createAcademicYear(w.deps, w.ctx, { institutionId: w.institutionId, code: `${startsOn.slice(0, 4)}-${endsOn.slice(0, 4)}`, label: "Année test", startsOn, endsOn }));
  unwrap(await openAcademicYear(w.deps, w.ctx, year.id));
  unwrap(await setCurrentAcademicYear(w.deps, w.ctx, year.id));
  const periods = unwrap(await applyPeriodPlan(w.deps, w.ctx, year.id, "TWO_SEMESTERS"));
  if (options.openPeriod !== false) unwrap(await openPeriod(w.deps, w.ctx, periods[0]!.id));

  const grades = unwrap(await listReference(w.deps, w.ctx, "grade-levels"));
  const levels = unwrap(await listReference(w.deps, w.ctx, "education-levels"));
  const l1 = grades.find((g) => g.code === "L1")!;
  const licence = levels.find((l) => l.code === "LICENCE")!;
  const program = unwrap(
    await createProgram(w.deps, w.ctx, { institutionId: w.institutionId, educationLevelId: licence.id, code: "INFO", label: "Informatique", gradeLevelIds: [l1.id] }),
  );

  const subjectIds: string[] = [];
  for (const code of ["ALGO", "PROG", "MATH", "STAT"]) {
    subjectIds.push(unwrap(await createSubject(w.deps, w.ctx, { institutionId: w.institutionId, code, label: `Matière ${code}` })).id);
  }
  const version = unwrap(await createCurriculumVersion(w.deps, w.ctx, { programId: program.id, academicYearId: year.id }));
  const level = unwrap(await addCurriculumNode(w.deps, w.ctx, version.id, { nodeTypeCode: "LEVEL", code: "L1", label: "Licence 1", gradeLevelId: l1.id }));
  const periodNode = unwrap(
    await addCurriculumNode(w.deps, w.ctx, version.id, { parentId: level.id, nodeTypeCode: "PERIOD", code: "S1", label: "Semestre 1", periodTypeCode: "SEMESTER", periodOrdinal: 1 }),
  );
  const mkUe = async (code: string, ecues: Array<{ code: string; subject: number; credits: string; coef: string }>): Promise<{ id: string; lineageId: string; ecueIds: string[] }> => {
    const credits = ecues.reduce((n, e) => n + Number(e.credits), 0);
    const ue = unwrap(await addCurriculumNode(w.deps, w.ctx, version.id, { parentId: periodNode.id, nodeTypeCode: "UE", code, label: `UE ${code}`, credits: String(credits) }));
    const ecueIds: string[] = [];
    for (const e of ecues) {
      ecueIds.push(unwrap(await addCurriculumNode(w.deps, w.ctx, version.id, { parentId: ue.id, nodeTypeCode: "ECUE", code: e.code, label: `ECUE ${e.code}`, subjectId: subjectIds[e.subject]!, credits: e.credits, coefficient: e.coef })).id);
    }
    return { id: ue.id, lineageId: ue.lineageId, ecueIds };
  };
  const ue1 = await mkUe("UE1", [
    { code: "E11", subject: 0, credits: "3", coef: "2" },
    { code: "E12", subject: 1, credits: "3", coef: "1.5" },
  ]);
  const ue2 = await mkUe("UE2", [
    { code: "E21", subject: 2, credits: "4", coef: "2" },
    { code: "E22", subject: 3, credits: "2", coef: "1" },
  ]);
  unwrap(await publishCurriculumVersion(w.deps, w.ctx, version.id));

  const classroom = unwrap(
    await createClassroom(w.deps, w.ctx, {
      institutionId: w.institutionId,
      academicYearId: year.id,
      programId: program.id,
      gradeLevelId: l1.id,
      curriculumVersionId: version.id,
      code: options.classroomCode ?? "L1-A",
      name: "Licence 1 A",
      capacity: options.capacity === undefined ? 100 : options.capacity,
    }),
  );
  unwrap(await classroomAction(w.deps, w.ctx, classroom.id, "activate"));
  return {
    yearId: year.id,
    periodIds: periods.map((p) => p.id),
    programId: program.id,
    gradeLevelId: l1.id,
    versionId: version.id,
    levelNodeId: level.id,
    periodNodeId: periodNode.id,
    ue1,
    ue2,
    subjectIds,
    classroomId: classroom.id,
  };
}

/** Code d'erreur d'un résultat (`null` s'il a réussi). */
export const codeOf = (r: { ok: boolean; error?: { code: string } }): string | null => (r.ok ? null : (r.error?.code ?? "?"));

export interface PublishedEvent {
  id: string;
  type: string;
  version: number;
  payload: Record<string, any>;
  aggregateType: string | null;
  aggregateId: string | null;
}

/** Événements écrits dans l'outbox du tenant (lecture administrateur), du plus ancien au plus récent. */
export async function eventsOf(w: World, type?: string | RegExp): Promise<PublishedEvent[]> {
  const res = await w.db.admin.query("SELECT id, type, version, payload, aggregate_type, aggregate_id FROM kernel.domain_events WHERE tenant_id = $1 ORDER BY id", [w.tenantId]);
  const all: PublishedEvent[] = res.rows.map((r: any) => ({ id: r.id, type: r.type, version: r.version, payload: r.payload, aggregateType: r.aggregate_type, aggregateId: r.aggregate_id }));
  if (!type) return all;
  return all.filter((e) => (typeof type === "string" ? e.type === type : type.test(e.type)));
}

/** Chaque événement publié respecte son schéma versionné `{ v: 1, … }` (contrat d'API pour les consommateurs). */
export async function assertEventsValid(w: World): Promise<number> {
  const { academicEventPayloadSchemas } = await import("@ecoledigitale/contracts/src/v2/academic");
  const events = await eventsOf(w, /^academic\./);
  for (const e of events) {
    const schema = (academicEventPayloadSchemas as Record<string, { safeParse(v: unknown): { success: boolean; error?: unknown } }>)[e.type];
    if (!schema) throw new Error(`Événement sans schéma : ${e.type}`);
    const r = schema.safeParse(e.payload);
    if (!r.success) throw new Error(`Charge utile invalide pour ${e.type} : ${JSON.stringify((r as { error: unknown }).error)} — ${JSON.stringify(e.payload)}`);
    if (e.version !== 1 || e.payload.v !== 1) throw new Error(`Version inattendue pour ${e.type}`);
  }
  return events.length;
}

/** Lit toutes les lignes d'une table sous le tenant du monde (RLS), pour des vérifications indépendantes des cas d'usage. */
export async function rows<R = Record<string, any>>(w: World, sql: string, params: unknown[] = []): Promise<R[]> {
  return w.deps.db.run(w.ctx, (tx) => tx.many<R>(sql, params));
}
