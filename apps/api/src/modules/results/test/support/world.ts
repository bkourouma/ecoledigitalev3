/**
 * Monde de test de `results` : tenant, direction, ports EN MÉMOIRE (curriculum, effectif, notes publiées) et VRAIES règles
 * (catalogue national seedé : CI-HIGHER-LMD, CI-HIGHER-BTS, CI-CLASSIC-SEMESTRE) à travers l'adaptateur du port de règles.
 */
import { ManualClock, newId, noopLogger, unwrap, type RequestContext } from "@ecoledigitale/kernel";
import { createRulesApi, createRulesDeps, ensureNationalCatalog, putBinding, type RulesApi, type RulesDeps } from "../../../rules";
import { createResultsDeps, type ResultsCaps, type ResultsDeps } from "../../application/deps";
import { RecordingAudit, type ResultsPorts } from "../../application/ports";
import { rulesPortFrom } from "../../infrastructure/rules-adapter";
import { InMemoryAssess, InMemoryCurriculum, InMemoryGuardianship, InMemoryNames, InMemoryRoster } from "../../infrastructure/in-memory-ports";
import type { ClassStructure, GradeFact, PeriodFacts, StructureNode } from "../../domain/types";
import { ctxFor, type ResultsTestDb } from "./db";

export const CAPS_ALL: ResultsCaps = {
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

export interface World {
  db: ResultsTestDb;
  tenantId: string;
  clock: ManualClock;
  audit: RecordingAudit;
  deps: ResultsDeps;
  rulesDeps: RulesDeps;
  rulesApi: RulesApi;
  curriculum: InMemoryCurriculum;
  roster: InMemoryRoster;
  assess: InMemoryAssess;
  guardianship: InMemoryGuardianship;
  names: InMemoryNames;
  /** Direction (MFA satisfaite). */
  director: RequestContext;
  /** Seconde personne de la direction (approbations à quatre yeux). */
  second: RequestContext;
}

export async function makeWorld(db: ResultsTestDb, options: { start?: string; seedRules?: boolean; extraPorts?: Partial<ResultsPorts> } = {}): Promise<World> {
  const clock = new ManualClock(options.start ?? "2026-01-15T10:00:00.000Z");
  const audit = new RecordingAudit();
  const curriculum = new InMemoryCurriculum();
  const roster = new InMemoryRoster();
  const assess = new InMemoryAssess();
  const guardianship = new InMemoryGuardianship();
  const names = new InMemoryNames();
  const rulesDeps = createRulesDeps({ db: db.tenantDb, systemDb: db.systemDb, clock, logger: noopLogger });
  if (options.seedRules !== false) await ensureNationalCatalog(rulesDeps);
  const rulesApi = createRulesApi(rulesDeps);
  const tenantId = await db.createTenant();
  const deps = createResultsDeps({ db: db.tenantDb, clock, audit, logger: noopLogger, ports: { curriculum, roster, assess, rules: rulesPortFrom(rulesApi), guardianship, names, ...options.extraPorts } });
  return { db, tenantId, clock, audit, deps, rulesDeps, rulesApi, curriculum, roster, assess, guardianship, names, director: ctxFor(tenantId), second: ctxFor(tenantId) };
}

/** Lie un contrat de règles à un jeu de règles pour le tenant (effet dès la rentrée 2024). */
export async function bind(w: World, contractId: string, ruleSetCode: string, over: { effectiveFrom?: string; levelCode?: string } = {}): Promise<void> {
  unwrap(await putBinding(w.rulesDeps, w.director, { contractId, ruleSetCode, effectiveFrom: over.effectiveFrom ?? "2024-09-01", ...(over.levelCode ? { levelCode: over.levelCode } : {}) }));
}

export const period = (id: string, over: Partial<PeriodFacts> = {}): PeriodFacts => ({ id, rankInYear: 1, countInYear: 2, isSecondSemester: false, startsOn: "2025-09-15", endsOn: "2026-02-15", ...over });

export interface EcueSpec {
  code: string;
  credits: string;
  mode?: "COMPOSED" | "DIRECT";
  resit?: boolean;
}
export interface UeSpec {
  code: string;
  category?: string;
  ecues: EcueSpec[];
}

/** Structure à crédits (UE / ECUE) avec identifiants déterministes. */
export function creditStructure(input: { classroomId: string; yearId: string; period: PeriodFacts; ues: UeSpec[] }): { structure: ClassStructure; ids: Map<string, string> } {
  const ids = new Map<string, string>();
  const nodes: StructureNode[] = [];
  let ordinal = 0;
  for (const ue of input.ues) {
    const ueId = newId();
    ids.set(ue.code, ueId);
    nodes.push({ id: ueId, parentId: null, kind: "UE", code: ue.code, label: ue.code, ordinal: ordinal++, credits: null, coefficient: null, gradingMode: "COMPOSED", resitAllowed: true, countsInAverage: true, sectionKey: null, category: ue.category ?? null });
    for (const e of ue.ecues) {
      const id = newId();
      ids.set(e.code, id);
      nodes.push({ id, parentId: ueId, kind: "ECUE", code: e.code, label: e.code, ordinal: ordinal++, credits: e.credits, coefficient: null, gradingMode: e.mode ?? "COMPOSED", resitAllowed: e.resit ?? (e.mode !== "DIRECT"), countsInAverage: true, sectionKey: null, category: null });
    }
  }
  return {
    structure: { classroomId: input.classroomId, academicYearId: input.yearId, contractId: "credit-semester@1", period: input.period, firstPeriodId: null, terminalExamRequired: false, nodes, yearPeriods: [input.period] },
    ids,
  };
}

export interface SubjectSpec {
  code: string;
  coef: string | null;
  section?: string | null;
  counts?: boolean;
}

export function coefStructure(input: { classroomId: string; yearId: string; period: PeriodFacts; subjects: SubjectSpec[]; terminalExamRequired?: boolean; firstPeriodId?: string | null }): { structure: ClassStructure; ids: Map<string, string> } {
  const ids = new Map<string, string>();
  const nodes: StructureNode[] = input.subjects.map((s, i) => {
    const id = newId();
    ids.set(s.code, id);
    return { id, parentId: null, kind: "SUBJECT" as const, code: s.code, label: s.code, ordinal: i, credits: null, coefficient: s.coef, gradingMode: "COMPOSED" as const, resitAllowed: false, countsInAverage: s.counts ?? true, sectionKey: s.section ?? null, category: null };
  });
  return {
    structure: { classroomId: input.classroomId, academicYearId: input.yearId, contractId: "coef-semester@1", period: input.period, firstPeriodId: input.firstPeriodId ?? null, terminalExamRequired: input.terminalExamRequired ?? false, nodes, yearPeriods: [input.period] },
    ids,
  };
}

let gradeSeq = 0;
export function grade(enrollmentId: string, nodeId: string, score: string | null, over: Partial<GradeFact> = {}): GradeFact {
  gradeSeq += 1;
  return {
    gradeId: newId(),
    assessmentId: over.assessmentId ?? `a0000000-0000-7000-8000-${String(gradeSeq).padStart(12, "0")}`,
    enrollmentId,
    curriculumNodeId: nodeId,
    sessionNo: 1,
    assessedOn: "2025-11-10",
    aggregationGroup: "CONTINUOUS",
    scaleMax: "20.000",
    weight: "1.000",
    score,
    entryStatus: score === null ? "ABSENT_UNEXCUSED" : "ENTERED",
    ...over,
  };
}
