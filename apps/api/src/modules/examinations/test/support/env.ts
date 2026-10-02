/**
 * Environnement des tests d'intégration : deux tenants A et B sur une base réelle (rôle soumis à la RLS), un monde en mémoire pour
 * les ports (élèves, inscriptions, évaluations, pièces, stockage, tutelle), un audit enregistreur et des règles FICTIVES de test.
 */
import { createRequestContext, unwrap, type RequestContext } from "@ecoledigitale/kernel";
import { newId } from "@ecoledigitale/kernel";
import { createExaminationsDeps, type ExaminationsDeps } from "../../application/deps";
import { instantiatePack } from "../../application/reference";
import { createSession, instantiateSession, transitionSession } from "../../application/sessions";
import { RecordingAudit, type ExaminationsPorts } from "../../application/ports";
import { InMemoryWorld, inMemoryPorts } from "../../infrastructure/in-memory-ports";
import { fakeRules, type FakeRulesOptions } from "./fake-rules";
import { createModuleTestDb, type ModuleTestDb } from "./db";
import { registerCandidate, createCandidate } from "../../application/candidates";
import { evaluateEligibility } from "../../application/eligibility";
import { actOnPiece } from "../../application/pieces";
import type { ExamSessionDto } from "@ecoledigitale/contracts/src/v2/examinations";

export interface Env {
  db: ModuleTestDb;
  tenantA: string;
  tenantB: string;
  institutionA: string;
  institutionB: string;
  userA1: string;
  userA2: string;
  userB1: string;
  world: InMemoryWorld;
  audit: RecordingAudit;
  rules: ReturnType<typeof fakeRules>;
  ctxA(user?: string): RequestContext;
  ctxB(): RequestContext;
  deps(overrides?: Partial<ExaminationsPorts>): ExaminationsDeps;
  drop(): Promise<void>;
}

export async function setupEnv(options: { rules?: FakeRulesOptions; poolSize?: number } = {}): Promise<Env> {
  const db = await createModuleTestDb(options.poolSize ? { poolSize: options.poolSize } : {});
  const tenantA = await db.createTenant("exam-a");
  const tenantB = await db.createTenant("exam-b");
  const world = new InMemoryWorld();
  const audit = new RecordingAudit();
  const rules = fakeRules(options.rules);
  const institutionA = newId();
  const institutionB = newId();
  world.institutions.set(institutionA, "École A");
  world.institutions.set(institutionB, "École B");
  const userA1 = newId();
  const userA2 = newId();
  const userB1 = newId();
  const env: Env = {
    db, tenantA, tenantB, institutionA, institutionB, userA1, userA2, userB1, world, audit, rules,
    ctxA: (user = userA1) => createRequestContext({ tenantId: tenantA, userId: user, institutionId: institutionA }),
    ctxB: () => createRequestContext({ tenantId: tenantB, userId: userB1, institutionId: institutionB }),
    deps: (overrides = {}) => createExaminationsDeps({ db: db.tenantDb, audit, ports: { ...inMemoryPorts(world, { rules }), ...overrides } }),
    drop: () => db.drop(),
  };
  return env;
}

export interface Pupil {
  studentId: string;
  enrollmentId: string;
}

/** Ajoute `n` élèves de CM2 (identité complète) inscrits dans une classe de l'établissement. */
export function addPupils(env: Env, n: number, options: { institutionId?: string; classroomId?: string; gradeLevelCode?: string; prefix?: string } = {}): { classroomId: string; pupils: Pupil[] } {
  const classroomId = options.classroomId ?? newId();
  const institutionId = options.institutionId ?? env.institutionA;
  const pupils: Pupil[] = [];
  for (let i = 1; i <= n; i += 1) {
    const studentId = newId();
    const enrollmentId = newId();
    env.world.addStudent({ studentId, lastName: `${options.prefix ?? "ELEVE"}${i}`, firstName: `Prénom${i}`, birthDate: "2016-05-05", birthPlace: "Abidjan", sex: i % 2 === 0 ? "F" : "M" });
    env.world.addEnrollment({ enrollmentId, studentId, institutionId, classroomId, gradeLevelCode: options.gradeLevelCode ?? "CM2" });
    pupils.push({ studentId, enrollmentId });
  }
  return { classroomId, pupils };
}

export async function seedPack(env: Env, ctx: RequestContext = env.ctxA()): Promise<void> {
  unwrap(await instantiatePack(env.deps(), ctx, "PRIMARY"));
}

/** Session officielle ou blanche du CEPE fictif, définition figée, inscriptions ouvertes. */
export async function openSession(env: Env, code: string, options: { kind?: "OFFICIAL" | "MOCK"; mockOf?: string; year?: number; ctx?: RequestContext; startsOn?: string } = {}): Promise<ExamSessionDto> {
  const ctx = options.ctx ?? env.ctxA();
  const deps = env.deps();
  const types = await env.db.admin.query("SELECT id FROM examinations.exam_types WHERE tenant_id = $1 AND code = 'CEPE'", [ctx.tenantId]);
  const typeId = types.rows[0].id as string;
  const institutionId = ctx.institutionId as string;
  const created = unwrap(
    await createSession(deps, ctx, {
      examTypeId: typeId, institutionId, code, label: `Session ${code}`, sessionKind: options.kind ?? "OFFICIAL", attemptKind: "NORMAL", sessionYear: options.year ?? 2027,
      mockOfSessionId: options.mockOf ?? null, startsOn: options.startsOn ?? null,
    }),
  );
  unwrap(await instantiateSession(deps, ctx, created.id));
  return unwrap(await transitionSession(deps, ctx, created.id, "REGISTRATION_OPEN"));
}

/**
 * Crée, qualifie et inscrit un candidat : éligibilité par la règle, pièce acceptée (session officielle), puis inscription.
 * Renvoie l'identifiant du candidat et son numéro.
 */
export async function registerPupil(env: Env, ctx: RequestContext, sessionId: string, pupil: Pupil, options: { official?: boolean } = {}): Promise<{ candidateId: string; number: string }> {
  const deps = env.deps();
  const c = unwrap(await createCandidate(deps, ctx, sessionId, { studentId: pupil.studentId, enrollmentId: pupil.enrollmentId }));
  if (options.official !== false) {
    const pieces = await env.db.admin.query(
      "SELECT r.id FROM examinations.document_requirements r JOIN examinations.sessions s ON s.exam_type_id = r.exam_type_id WHERE s.id = $1 AND r.active AND r.required",
      [sessionId],
    );
    for (const row of pieces.rows) {
      const documentId = newId();
      env.world.pieces.set(documentId, pupil.studentId);
      unwrap(await actOnPiece(deps, ctx, c.id, row.id as string, { action: "SUBMIT", documentRef: documentId }));
      unwrap(await actOnPiece(deps, ctx, c.id, row.id as string, { action: "ACCEPT" }));
    }
    unwrap(await evaluateEligibility(deps, ctx, c.id, { mode: "EVALUATE" }));
  }
  const r = unwrap(await registerCandidate(deps, ctx, c.id));
  return { candidateId: c.id, number: r.candidateNumber as string };
}
