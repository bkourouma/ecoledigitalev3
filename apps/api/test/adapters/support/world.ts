/**
 * Monde d'assemblage : UNE base migrée par toutes les migrations v2 (comme en production), les VRAIS modules branchés par les
 * VRAIS adaptateurs de `platform/adapters` (aucun port en mémoire entre modules), sans HTTP ni Redis.
 *
 *   école supérieure : cycle LICENCE, programme « INFO » (un niveau L1), deux semestres, deux UE de deux ECUE, une classe,
 *   des élèves créés dans `people`, un enseignant lié à un compte, des évaluations saisies, validées et publiées par `assess`,
 *   puis calcul, verrou et clôture par `results` avec les VRAIES règles du catalogue national.
 */
import { Pool } from "pg";
import { ManualClock, createRequestContext, newId, noopLogger, unwrap, type RequestContext } from "@ecoledigitale/kernel";
import { SystemDb, TenantDb } from "@ecoledigitale/database";
import {
  createAssessDeps,
  createAssessment,
  instantiateAssessPack,
  listAssessmentTypes,
  saveGrades,
  transitionAssessment,
  type AssessCaps,
  type AssessDeps,
} from "../../../src/modules/assess";
import { enrollStudent, updateAcademicSettings, type AcademicDeps } from "../../../src/modules/academic";
import { createStaff, createStudent, createTeachingAssignment } from "../../../src/modules/people";
import { putBinding, createRulesDeps, ensureNationalCatalog, type RulesDeps } from "../../../src/modules/rules";
import { closePeriod, lockPeriod, updateResultsSettings, type ResultsCaps } from "../../../src/modules/results";
import { makeWorld as makeAcademicWorld, seedHigher, type HigherSeed, type World as AcademicWorld } from "../../../src/modules/academic/test/support/world";
import type { AcademicTestDb } from "../../../src/modules/academic/test/support/db";
import { buildPlatformPorts, createAdapterKit, type AdapterKit, type PlatformPorts } from "../../../src/platform/adapters";
import { createLoginRole } from "../../../src/platform/v2-login-role";
import { runV2Migrations } from "../../../src/platform/v2-migrations";
import { createEphemeralDb, randomSuffix, type EphemeralDb } from "../../helpers/fixtures";

export const RESULTS_CAPS: ResultsCaps = {
  recompute: true,
  overrideRequest: true,
  overrideApprove: true,
  lock: true,
  close: true,
  repin: true,
  reopen: true,
  decisionRecord: true,
  decisionApprove: true,
  appreciationWrite: true,
  explain: true,
  read: true,
};

const ADMIN_CAPS: AssessCaps = { manage: true, review: true, validate: true, publish: true, reviseRequest: true, reviseApprove: true, typeManage: true };

export interface AssemblyWorld {
  db: EphemeralDb;
  pool: Pool;
  tenantDb: TenantDb;
  systemDb: SystemDb;
  clock: ManualClock;
  tenantId: string;
  /** Direction (MFA satisfaite). */
  director: RequestContext;
  kit: AdapterKit;
  ports: PlatformPorts;
  rulesDeps: RulesDeps;
  /** Monde d'academic (dépendances d'ÉCRITURE branchées sur les ports réels). */
  academic: AcademicWorld;
  drop(): Promise<void>;
}

export const adminRows = async <R = Record<string, any>>(w: Pick<AssemblyWorld, "db">, sql: string, params: unknown[] = []): Promise<R[]> => (await w.db.admin.query(sql, params)).rows as R[];

export function ctxOf(w: Pick<AssemblyWorld, "tenantId">, userId: string = newId(), roles: string[] = ["directeur"], mfa = true): RequestContext {
  return createRequestContext({ tenantId: w.tenantId, userId, roles, mfa });
}

export async function createAssemblyWorld(): Promise<AssemblyWorld> {
  const roleName = `ed_asm_${randomSuffix()}`;
  const db = await createEphemeralDb("asm_test", [roleName]);
  await runV2Migrations({ url: db.adminUrl, logger: noopLogger });
  const appUrl = (await createLoginRole({ adminUrl: db.adminUrl, role: roleName })).applicationUrl;
  const pool = new Pool({ connectionString: appUrl, max: 12 });
  const tenantDb = new TenantDb(pool);
  const systemDb = new SystemDb(tenantDb, { logger: noopLogger });
  const tenantId = newId();
  await db.admin.query("INSERT INTO kernel.tenants (id, slug, name) VALUES ($1, $2, $3)", [tenantId, `asm-${tenantId.slice(-8)}`, "École d'assemblage"]);

  const clock = new ManualClock(new Date());
  const kit = createAdapterKit({ tenantDb, systemDb, clock, logger: noopLogger, env: {} });
  const ports = buildPlatformPorts(kit, null);
  const rulesDeps = createRulesDeps({ db: tenantDb, systemDb, clock, logger: noopLogger });
  await ensureNationalCatalog(rulesDeps);

  const academicDb = {
    name: db.name,
    admin: db.admin,
    appPool: pool,
    tenantDb,
    systemDb,
    createTenant: async () => tenantId,
    drop: async () => undefined,
  } as unknown as AcademicTestDb;
  const academic = makeAcademicWorld(academicDb, tenantId, { ports: ports.academic });
  const director = ctxOf({ tenantId });
  return {
    db,
    pool,
    tenantDb,
    systemDb,
    clock,
    tenantId,
    director,
    kit,
    ports,
    rulesDeps,
    academic: { ...academic, ctx: director },
    async drop() {
      await pool.end().catch(() => undefined);
      await db.drop();
    },
  };
}

export interface Pupil {
  studentId: string;
  enrollmentId: string;
  lastName: string;
}

export interface HigherSchool {
  seed: HigherSeed;
  pupils: Pupil[];
  teacher: { staffId: string; ctx: RequestContext };
  assess: AssessDeps;
  types: Record<string, string>;
  /** Période (semestre 1) : classe + période. */
  ref: { classroomId: string; academicPeriodId: string };
}

/** École supérieure complète jusqu'à l'inscription des élèves et l'affectation de l'enseignant (avant toute note). */
export async function seedHigherSchool(w: AssemblyWorld, options: { pupils?: number } = {}): Promise<HigherSchool> {
  const seed = await seedHigher(w.academic);
  unwrap(await updateAcademicSettings(w.academic.deps, w.director, w.academic.institutionId, { enrollmentConfirmationPolicy: "ON_REGISTRATION_FEE_PAID" }));
  const pupils: Pupil[] = [];
  for (let i = 0; i < (options.pupils ?? 3); i += 1) {
    const lastName = `ETUDIANT${i + 1}`;
    const created = unwrap(await createStudent(w.kit.people, w.director, { person: { lastName, firstName: `Prenom${i + 1}`, sex: i % 2 === 0 ? "F" : "M", birthDate: `2005-0${i + 1}-1${i + 1}`, birthPlace: "Abidjan" } }));
    if (created.kind !== "created") throw new Error("création attendue");
    const e = unwrap(await enrollStudent(w.academic.deps, w.director, { studentId: created.student.id, classroomId: seed.classroomId }));
    if (e.status !== "ACTIVE") throw new Error(`inscription attendue ACTIVE, reçue ${e.status} : aucun frais d'inscription configuré => confirmation immédiate`);
    pupils.push({ studentId: created.student.id, enrollmentId: e.id, lastName });
  }

  // Enseignant : fiche de personnel liée à un compte (liaison explicite), généraliste de la classe.
  const staff = unwrap(await createStaff(w.kit.people, w.director, { person: { lastName: "ENSEIGNANT", firstName: "Un", sex: "M", birthDate: "1985-04-04", email: "ens@example.test" }, categoryCode: "TEACHER" }));
  if (staff.kind !== "created") throw new Error("création attendue");
  const teacherUserId = newId();
  await w.db.admin.query("UPDATE people.persons SET identity_id = $2 WHERE id = $1", [staff.staff.personId, teacherUserId]);
  const yearStart = (await adminRows<{ starts_on: string }>(w, "SELECT starts_on::text FROM academic.academic_years WHERE id = $1", [seed.yearId]))[0]!.starts_on;
  unwrap(await createTeachingAssignment(w.kit.people, w.director, { staffId: staff.staff.id, academicYearId: seed.yearId, classroomId: seed.classroomId, roleCode: "LEAD", coversAllSubjects: true, startsOn: yearStart }));
  const teacher = { staffId: staff.staff.id, ctx: ctxOf(w, teacherUserId, ["enseignant"], false) };

  const assess = createAssessDeps({ db: w.tenantDb, clock: w.clock, logger: noopLogger, ports: w.ports.assess });
  unwrap(await instantiateAssessPack(assess, w.director, { pack: "HIGHER" }));
  const types = Object.fromEntries(unwrap(await listAssessmentTypes(assess, w.director, { includeInactive: true })).map((t) => [t.code, t.id]));
  return { seed, pupils, teacher, assess, types, ref: { classroomId: seed.classroomId, academicPeriodId: seed.periodIds[0]! } };
}

/** Saisit, valide et PUBLIE une évaluation d'un nœud pour tous les élèves (circuit complet d'`assess`). */
export async function publishAssessment(w: AssemblyWorld, school: HigherSchool, input: { typeCode: string; nodeId: string; scores: Array<string | null>; title?: string; sessionNo?: 1 | 2 }) {
  const { assess, teacher, types, seed } = school;
  const assessedOn = (await adminRows<{ d: string }>(w, "SELECT (starts_on + 10)::text AS d FROM academic.academic_periods WHERE id = $1", [school.ref.academicPeriodId]))[0]!.d;
  const a = unwrap(
    await createAssessment(assess, teacher.ctx, {
      typeId: types[input.typeCode] as string,
      classroomId: seed.classroomId,
      curriculumNodeId: input.nodeId,
      academicPeriodId: school.ref.academicPeriodId,
      title: input.title ?? `${input.typeCode} ${input.nodeId.slice(-4)}`,
      assessedOn,
      ...(input.sessionNo ? { sessionNo: input.sessionNo } : {}),
    }),
  );
  unwrap(
    await saveGrades(assess, teacher.ctx, {
      assessmentId: a.id,
      entries: school.pupils.map((p, i) => (input.scores[i] == null ? { enrollmentId: p.enrollmentId, entryStatus: "ABSENT_UNEXCUSED" as const } : { enrollmentId: p.enrollmentId, score: input.scores[i] as string })),
      caps: {},
    }),
  );
  const reviewer = ctxOf(w, newId(), ["responsable_pedagogique"], true);
  const step = async (ctx: RequestContext, to: "SUBMITTED" | "REVIEWED" | "APPROVED" | "PUBLISHED", caps: AssessCaps) => unwrap(await transitionAssessment(assess, ctx, { assessmentId: a.id, to, caps }));
  await step(teacher.ctx, "SUBMITTED", {});
  await step(reviewer, "REVIEWED", { review: true });
  await step(reviewer, "APPROVED", { review: true, validate: true });
  await step(w.director, "PUBLISHED", ADMIN_CAPS);
  return a;
}

/** Lie le contrat `credit-semester@1` au jeu de règles national LMD, sans exigence de délibération. */
export async function bindCreditRules(w: AssemblyWorld): Promise<void> {
  unwrap(await putBinding(w.rulesDeps, w.director, { contractId: "credit-semester@1", ruleSetCode: "CI-HIGHER-LMD", effectiveFrom: "2024-09-01" }));
  unwrap(await updateResultsSettings(w.kit.results, w.director, { requireDeliberation: false }));
}

/** Verrouille puis CLÔTURE le semestre : résultats FINAL calculés par les règles à partir des notes publiées. */
export async function closeSemester(w: AssemblyWorld, school: HigherSchool) {
  unwrap(await lockPeriod(w.kit.results, w.director, { ...school.ref, caps: RESULTS_CAPS }));
  return unwrap(await closePeriod(w.kit.results, w.director, { ...school.ref, caps: RESULTS_CAPS }));
}

export type { AcademicDeps };
