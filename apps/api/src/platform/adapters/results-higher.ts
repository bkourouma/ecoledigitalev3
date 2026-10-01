/**
 * results (+ academic) -> higher : `CreditsSourcePort` (lignes d'UE FINAL publiées, candidats au rattrapage), `ResitSessionPort`
 * (session 2 d'une période) et `CycleResultsPort` (moyennes de semestre FINAL d'un cycle).
 *
 * Rien n'est recalculé ici : validation d'UE, état LMD, session d'obtention, crédits figés et moyennes viennent des
 * résultats FINAL de `results` (règles du contrat `credit-semester@1`). Les UE sont identifiées par leur LIGNÉE (stable d'une
 * année à l'autre), les nœuds de curriculum de `results` étant ceux de la version de la classe (voir `academic-higher.ts`).
 *
 * Ces adaptateurs agissent au nom de `higher` avec les capacités de lecture / verrou / clôture de `results` : chaque appel est
 * contrôlé en amont par les permissions de `higher` (`higher.resit.manage`…) et reste tracé par `results` (acteur = contexte).
 */
import type { AppError, RequestContext } from "@ecoledigitale/kernel";
import type { ResultsDeps } from "../../modules/results";
import { closePeriod, getClassMatrix, getFinalResult, getStateView, lockPeriod, reopenPeriod } from "../../modules/results";
import {
  getClassroomFacts,
  getCurriculumNode,
  getProgram,
  getResultsStructure,
  listAcademicPeriods,
  listEnrollmentsByStudent,
  type AcademicDeps,
} from "../../modules/academic";
import type { CreditsSourcePort, CycleResults, CycleResultsPort, ResitCandidateLine, ResitSessionPort, UeResultLine } from "../../modules/higher";

const READ = { read: true } as const;

/** Lit un résultat (`Result`) ou lève son erreur : un port de higher qui échoue fait échouer l'opération, jamais un silence. */
function must<T>(r: { ok: true; value: T } | { ok: false; error: AppError }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

/** `lineage_id` du nœud de curriculum (mémorisé pour l'appel) ; `null` si le nœud est inconnu. */
function lineageResolver(academic: AcademicDeps, ctx: RequestContext): (nodeId: string) => Promise<string | null> {
  const cache = new Map<string, Promise<string | null>>();
  return (nodeId) => {
    let p = cache.get(nodeId);
    if (!p) {
      p = getCurriculumNode(academic, ctx, nodeId).then((r) => (r.ok ? r.value.lineageId : null));
      cache.set(nodeId, p);
    }
    return p;
  };
}

const toNumber = (v: string | null): number => (v === null ? 0 : Number(v));

export function createHigherCreditsSource(results: ResultsDeps, academic: AcademicDeps): CreditsSourcePort {
  return {
    async listFinalUeLines(ctx, query): Promise<readonly UeResultLine[]> {
      const matrix = await getClassMatrix(results, ctx, { classroomId: query.classroomId, academicPeriodId: query.academicPeriodId, withLines: true, caps: READ });
      // Pas de structure / d'état : rien à capitaliser (la période n'a jamais été calculée).
      if (!matrix.ok) return [];
      const { state, rows } = matrix.value;
      if (query.resultsVersion !== undefined && state.resultsVersion !== query.resultsVersion) return [];
      const lineage = lineageResolver(academic, ctx);
      const out: UeResultLine[] = [];
      for (const { header, lines } of rows) {
        if (header.status !== "FINAL" || header.scope !== "PERIOD" || !header.academicPeriodId) continue;
        for (const line of lines) {
          if (line.level !== "UE" || !line.curriculumNodeId) continue;
          // Une UE sans état (aucun résultat) n'est ni validée ni en dette : « en attente », rien à enregistrer.
          if (line.statusCode !== "VALIDATED" && line.statusCode !== "RESIT" && line.statusCode !== "DEBT") continue;
          const ueNodeId = await lineage(line.curriculumNodeId);
          if (!ueNodeId) continue;
          const ecues = lines.filter((l) => l.level === "ECUE" && l.parentNodeId === line.curriculumNodeId);
          out.push({
            studentId: header.studentId,
            enrollmentId: header.enrollmentId,
            ueNodeId,
            academicYearId: header.academicYearId,
            academicPeriodId: header.academicPeriodId,
            credits: toNumber(line.credits),
            averageExact: line.value,
            validated: line.validated === true,
            ueState: line.statusCode,
            sessionObtained: line.sessionObtained,
            via: line.overrideId ? "JURY_OVERRIDE" : line.sessionObtained === 2 ? "RESIT" : "DIRECT",
            overrideId: line.overrideId,
            compensatedEcueCount: ecues.filter((e) => e.outputs?.eliminee === true).length,
            sourceResultId: header.id,
            resultsVersion: state.resultsVersion,
            ...(header.finalizedAt ? { validatedAt: header.finalizedAt } : {}),
          });
        }
      }
      return out;
    },

    async listResitCandidates(ctx, query) {
      const matrix = await getClassMatrix(results, ctx, { classroomId: query.classroomId, academicPeriodId: query.academicPeriodId, withLines: true, caps: READ });
      if (!matrix.ok) throw matrix.error;
      const { state, rows } = matrix.value;
      const lineage = lineageResolver(academic, ctx);
      const candidates: ResitCandidateLine[] = [];
      for (const { header, lines } of rows) {
        if (header.status !== "FINAL") continue;
        for (const line of lines) {
          if (line.level !== "ECUE" || line.resitEligible !== true || !line.curriculumNodeId || !line.parentNodeId) continue;
          const [ecueNodeId, ueNodeId] = await Promise.all([lineage(line.curriculumNodeId), lineage(line.parentNodeId)]);
          if (!ecueNodeId || !ueNodeId) continue;
          const s1 = line.outputs?.note_s1;
          candidates.push({ enrollmentId: header.enrollmentId, studentId: header.studentId, ecueNodeId, ueNodeId, session1Average: typeof s1 === "string" ? s1 : line.value });
        }
      }
      return { stateId: state.id, candidates };
    },
  };
}

/**
 * Session 2 : ouverture = réouverture `RESIT_SESSION` de la période (seule la session 2 est déverrouillée, la session 1 reste
 * verrouillée) ; fermeture = verrouillage puis clôture (nouveaux résultats FINAL, version n+1). Idempotent : une période déjà
 * ouverte / déjà close n'est pas rejouée.
 */
export function createHigherResitSession(results: ResultsDeps): ResitSessionPort {
  const caps = { reopen: true, lock: true, close: true } as const;
  return {
    async openResitSession(ctx, input) {
      const state = must(await getStateView(results, ctx, { stateId: input.stateId }));
      if (state.status !== "CLOSED") return; // déjà ouverte (ou pas encore close : rien à rouvrir)
      must(await reopenPeriod(results, ctx, { classroomId: input.classroomId, academicPeriodId: input.academicPeriodId, kind: "RESIT_SESSION", reason: "Ouverture de la session de rattrapage (session 2)", caps }));
    },
    async closeResitSession(ctx, input) {
      const ref = { classroomId: input.classroomId, academicPeriodId: input.academicPeriodId, caps } as const;
      const state = input.stateId ? must(await getStateView(results, ctx, { stateId: input.stateId })) : null;
      if (state?.status === "CLOSED") return;
      if (!state || state.status === "OPEN") must(await lockPeriod(results, ctx, ref));
      must(await closePeriod(results, ctx, ref));
    },
  };
}

/**
 * Résultats FINAL des semestres d'un cycle pour un étudiant : une inscription par niveau du programme (la plus récente en cas
 * de redoublement), chaque période d'enseignement de l'année portant un résultat FINAL. `complete` n'est vrai que si TOUS les
 * niveaux du cycle ont été suivis ET que chacune de leurs périodes a un résultat FINAL : sinon la mention est « en attente ».
 */
export function createHigherCycleResults(results: ResultsDeps, academic: AcademicDeps): CycleResultsPort {
  return {
    async getCycleResults(ctx, input): Promise<CycleResults> {
      const program = must(await getProgram(academic, ctx, input.nodeId));
      const enrollments = must(await listEnrollmentsByStudent(academic, ctx, input.studentId));
      // Une inscription par niveau (la plus récente), dans la portée du cycle (programme et sous-programmes).
      const byLevel = new Map<string, { enrollmentId: string; classroomId: string; academicYearId: string; createdKey: string }>();
      for (const e of enrollments) {
        if (e.status !== "ACTIVE" && e.status !== "COMPLETED") continue;
        const facts = await getClassroomFacts(academic, ctx, e.classroomId);
        if (!facts.ok) continue;
        const inCycle = facts.value.programId === program.id || (await isChildProgram(academic, ctx, facts.value.programId, program.id));
        if (!inCycle) continue;
        const key = facts.value.gradeLevelCode;
        const previous = byLevel.get(key);
        if (!previous || facts.value.academicYearStartsOn > previous.createdKey) {
          byLevel.set(key, { enrollmentId: e.id, classroomId: e.classroomId, academicYearId: e.academicYearId, createdKey: facts.value.academicYearStartsOn });
        }
      }
      const semesters: CycleResults["semesters"][number][] = [];
      let complete = enrollments.length > 0 && byLevel.size >= Math.max(1, program.gradeLevelIds.length);
      for (const level of byLevel.values()) {
        const anyPeriod = await firstPeriodOf(academic, ctx, level.classroomId, level.academicYearId);
        if (!anyPeriod) {
          complete = false;
          continue;
        }
        for (const period of anyPeriod.yearPeriods) {
          const final = must(await getFinalResult(results, ctx, { enrollmentId: level.enrollmentId, academicPeriodId: period.id }));
          if (!final || final.scope !== "PERIOD") {
            complete = false;
            continue;
          }
          semesters.push({ academicPeriodId: period.id, academicYearId: level.academicYearId, average: final.average, credits: toNumber(final.creditsRequired ?? final.creditsAcquired) });
        }
      }
      return { complete: complete && semesters.length > 0, semesters };
    },
  };
}

async function isChildProgram(academic: AcademicDeps, ctx: RequestContext, programId: string, parentId: string): Promise<boolean> {
  const r = await getProgram(academic, ctx, programId);
  return r.ok && r.value.parentProgramId === parentId;
}

/** Périodes d'enseignement de l'année d'une classe (via la structure de calcul, qui connaît le rang des périodes). */
async function firstPeriodOf(academic: AcademicDeps, ctx: RequestContext, classroomId: string, academicYearId: string): Promise<{ yearPeriods: Array<{ id: string }> } | null> {
  const periods = await listAcademicPeriods(academic, ctx, academicYearId);
  if (!periods.ok || periods.value.length === 0) return null;
  const first = periods.value[0] as { id: string };
  const structure = await getResultsStructure(academic, ctx, { classroomId, periodId: first.id });
  return structure.ok ? { yearPeriods: structure.value.yearPeriods } : null;
}
