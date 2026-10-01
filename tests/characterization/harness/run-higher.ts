import type { Pool } from "pg";
import { ProfessionalAssignmentsService } from "../../../apps/api/src/services/professional-assignments.service";
import { ProfessionalBulletinService } from "../../../apps/api/src/services/professional-bulletin.service";
import { ProfessionalResultsService } from "../../../apps/api/src/services/professional-results.service";
import { ProfessionalSemestreService } from "../../../apps/api/src/services/professional-semestre.service";
import type { GradeDecl, Scenario, Step } from "../scenarios/types";
import type { ScenarioDatabase } from "./db";
import { DefectCollector } from "./defects";
import { detectHigherDefects } from "./oracle-higher";
import { createNormalizer } from "./normalize";
import { seedBase, seedHigher, type SeedContext } from "./seeder";

/**
 * Exécution d'un scénario de la pile « Professional » (BTS / Licence / LMD) sur le VRAI code legacy :
 * ProfessionalResultsService (résultats, rattrapages, clôture), ProfessionalBulletinService (bulletins, rangs,
 * décisions, génération, clôture) et ProfessionalSemestreService (clôture des notes). Aucun calcul n'est refait ici.
 */

type ServiceResult = { success: boolean; data?: unknown; error?: string; message?: string };

/** Date de clôture imposée après coup : `now()` de la base ne doit jamais entrer dans une snapshot. */
export const FROZEN_CLOSURE_TIMESTAMP = "2026-01-31T12:00:00Z";

export interface HigherRun {
  data: unknown;
  defects: DefectCollector;
}

function outcome(r: ServiceResult): unknown {
  return r.success ? { ok: true, data: r.data } : { ok: false, error: r.error, message: r.message };
}

export async function runHigherScenario(db: ScenarioDatabase, scenario: Scenario): Promise<HigherRun> {
  if (!scenario.higher) throw new Error(`Le scénario ${scenario.meta.name} n'a pas de partie « higher »`);
  const ctx = await seedBase(db.pool, scenario);
  await seedHigher(ctx, scenario.higher.higher);

  const runner = new HigherRunner(db.pool, ctx, scenario);
  const steps: Record<string, unknown> = {};
  const observations: Record<string, unknown> = {};
  let n = 0;
  for (const step of scenario.higher.steps) {
    n++;
    const label = `${String(n).padStart(2, "0")}-${labelOf(step)}`;
    if (step.do === "observe") {
      observations[labelOf(step)] = await runner.observe();
    } else {
      steps[label] = await runner.perform(step);
    }
  }
  if (!("final" in observations)) observations.final = await runner.observe();

  const defects = new DefectCollector();
  detectHigherDefects(defects, {
    scenario,
    ctx,
    observationKey: "observations.final",
    observation: observations.final as never,
    grades: runner.applied,
  });

  const { normalize } = createNormalizer(ctx.ids);
  return { data: normalize({ steps, observations }), defects };
}

function labelOf(step: Step): string {
  return "label" in step && step.label ? step.label : step.do;
}

class HigherRunner {
  private readonly results: ProfessionalResultsService;
  private readonly bulletins: ProfessionalBulletinService;
  private readonly semestres: ProfessionalSemestreService;
  private readonly assignments: ProfessionalAssignmentsService;
  /** Notes réellement en base à l'instant courant (déclarées + saisies/modifiées/supprimées par les étapes qui ont abouti). */
  readonly applied: GradeDecl[];

  constructor(
    private readonly pool: Pool,
    private readonly ctx: SeedContext,
    private readonly scenario: Scenario,
  ) {
    this.results = new ProfessionalResultsService(pool);
    this.bulletins = new ProfessionalBulletinService(pool);
    this.semestres = new ProfessionalSemestreService(pool);
    this.assignments = new ProfessionalAssignmentsService(pool);
    this.applied = scenario.higher!.higher.grades.map((g) => ({ ...g }));
  }

  private lastApplied(student: string, ecue: string, group: string, nature: string): GradeDecl | undefined {
    const same = this.applied.filter((g) => g.student === student && g.ecue === ecue && g.group === group && g.nature === nature);
    // même ordre que findNoteId : session la plus haute d'abord
    return [...same].sort((a, b) => (a.session ?? 1) - (b.session ?? 1)).at(-1);
  }

  private recordApplied(g: GradeDecl): void {
    if (g.nature === "examen") {
      const i = this.applied.findIndex(
        (x) =>
          x.student === g.student &&
          x.ecue === g.ecue &&
          x.group === g.group &&
          x.nature === "examen" &&
          (x.session ?? 1) === (g.session ?? 1) &&
          (x.via ?? "manual") === "manual",
      );
      if (i >= 0) this.applied.splice(i, 1);
    }
    this.applied.push({ ...g, via: "manual" });
  }

  private get setup() {
    return this.scenario.higher!.higher;
  }

  private cohortFor(group: string, ecue: string): string {
    const id = this.ctx.cohortOfEcue.get(`${group}:${ecue}`);
    if (!id) throw new Error(`Aucune cohorte pour ${group}/${ecue}`);
    return id;
  }

  async perform(step: Step): Promise<unknown> {
    const { ids, tenantId } = this.ctx;
    switch (step.do) {
      case "recompute": {
        const out: Record<string, unknown> = {};
        const cohorts = [...this.ctx.cohortIds.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
        for (const [key, id] of cohorts) out[key] = outcome(await this.results.recomputeSessionResults(tenantId, id));
        return out;
      }
      case "jury-validate": {
        const cohort = this.cohortFor(step.group, step.ecue);
        const r = await this.pool.query(
          `SELECT id FROM professional_ecue_results WHERE tenant_id=$1 AND ecue_id=$2 AND student_id=$3 AND ue_session_id=$4`,
          [tenantId, ids.id("ecue", step.ecue), ids.id("student", step.student), cohort],
        );
        if (r.rowCount === 0) return { ok: false, error: "NO_RESULT_ROW" };
        return outcome(await this.results.validateEcueResultManually(tenantId, r.rows[0].id, step.validated, this.ctx.adminUserId));
      }
      case "enter-grade": {
        const r = await this.enterGrade(step.grade);
        if (r.success) this.recordApplied(step.grade);
        return outcome(r);
      }
      case "update-grade": {
        const id = await this.findNoteId(step.student, step.ecue, step.group, step.nature);
        if (!id) return { ok: false, error: "NO_NOTE_ROW" };
        const r = await this.results.updateManualEcueNote(tenantId, id, { note: step.value });
        if (r.success) {
          const hit = this.lastApplied(step.student, step.ecue, step.group, step.nature);
          if (hit) hit.value = step.value;
        }
        return outcome(r);
      }
      case "delete-grade": {
        const id = await this.findNoteId(step.student, step.ecue, step.group, step.nature);
        if (!id) return { ok: false, error: "NO_NOTE_ROW" };
        const r = await this.results.deleteManualEcueNote(tenantId, id);
        if (r.success) {
          const hit = this.lastApplied(step.student, step.ecue, step.group, step.nature);
          if (hit) this.applied.splice(this.applied.indexOf(hit), 1);
        }
        return outcome(r);
      }
      case "grade-evaluation": {
        const cohort = this.cohortFor(step.group, step.ecue);
        const a = await this.pool.query(
          `SELECT id FROM professional_assignments WHERE tenant_id=$1 AND ecue_id=$2 AND ue_session_id=$3 AND type=$4 ORDER BY id LIMIT 1`,
          [tenantId, ids.id("ecue", step.ecue), cohort, step.nature === "examen" ? "examen" : "devoir"],
        );
        if (a.rowCount === 0) return { ok: false, error: "NO_ASSIGNMENT_ROW" };
        const studentId = ids.id("student", step.student);
        const r = await this.assignments.grade(tenantId, this.ctx.adminUserId, true, a.rows[0].id, studentId, { note: step.value });
        if (r.success) {
          // Auto-capture : la route réintègre la note dans le résultat d'ECUE.
          await this.results.recomputeAfterGrade(tenantId, a.rows[0].id, studentId);
          const hit = this.applied.find(
            (g) => g.student === step.student && g.ecue === step.ecue && g.group === step.group && g.nature === step.nature && g.via === "assessment",
          );
          if (hit) hit.value = step.value;
        }
        return outcome(r);
      }
      case "generate-bulletins":
        return outcome(await this.bulletins.generateBulletins(tenantId, ids.id("semester", step.semester)));
      case "close-bulletins": {
        const r = outcome(await this.bulletins.cloturerBulletins(tenantId, ids.id("semester", step.semester), this.ctx.adminUserId));
        // Date figée : `now()` ne doit pas entrer dans les messages de clôture ni dans les snapshots.
        await this.pool.query(`UPDATE professional_semestres SET bulletins_clotures_at = $2 WHERE id = $1 AND bulletins_clotures_at IS NOT NULL`, [
          ids.id("semester", step.semester),
          FROZEN_CLOSURE_TIMESTAMP,
        ]);
        return r;
      }
      case "close-grades":
        return outcome(await this.semestres.cloturerSemestre(tenantId, ids.id("semester", step.semester)));
      case "observe":
        return this.observe();
    }
  }

  private async findNoteId(student: string, ecue: string, group: string, nature: string): Promise<string | null> {
    const r = await this.pool.query(
      `SELECT id FROM professional_ecue_notes
       WHERE tenant_id=$1 AND ecue_id=$2 AND student_id=$3 AND ue_session_id=$4 AND nature=$5
       ORDER BY session DESC, created_at DESC, id LIMIT 1`,
      [this.ctx.tenantId, this.ctx.ids.id("ecue", ecue), this.ctx.ids.id("student", student), this.cohortFor(group, ecue), nature],
    );
    return r.rowCount ? r.rows[0].id : null;
  }

  private async enterGrade(g: GradeDecl): Promise<ServiceResult> {
    return this.results.upsertManualEcueNote(
      this.ctx.tenantId,
      {
        ecue_id: this.ctx.ids.id("ecue", g.ecue),
        student_id: this.ctx.ids.id("student", g.student),
        ue_session_id: this.cohortFor(g.group, g.ecue),
        nature: g.nature,
        libelle: g.label ?? null,
        note: g.value,
        note_max: g.max ?? 20,
        session: g.session ?? 1,
      },
      this.ctx.adminUserId,
    );
  }

  /* ----------------------------------------------------------------- */

  async observe(): Promise<unknown> {
    const { ids, tenantId, pool } = this.ctx;
    const studentKeys = [...new Set(this.setup.groups.flatMap((g) => g.students))].sort();
    const semesters = this.setup.programmes.flatMap((p) => p.semesters.map((s) => ({ ...s, programme: p }))).sort((a, b) => (a.key < b.key ? -1 : 1));

    const obs: Record<string, any> = {
      ecueResults: {},
      ueResults: {},
      rosters: {},
      bulletins: {},
      bts: {},
      fullBulletins: {},
      generated: {},
      rattrapages: {},
      studentRattrapages: {},
      conduite: {},
    };

    // Résultats d'ECUE persistés, par cohorte puis (étudiant/ECUE).
    for (const [cohortKey, cohortId] of [...this.ctx.cohortIds.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const r = (await this.results.listSessionResults(tenantId, cohortId)) as ServiceResult;
      const rows = ((r.data as any[]) ?? []).map((row) => ({ ...row }));
      const keyed: Record<string, unknown> = {};
      for (const row of rows) {
        const s = ids.key(row.student_id) ?? row.student_id;
        const e = ids.key(row.ecue_id) ?? row.ecue_id;
        keyed[`${s}/${e}`] = row;
      }
      if (rows.length) obs.ecueResults[cohortKey] = keyed;
    }

    for (const sk of studentKeys) {
      const r = (await this.results.listStudentUeResults(tenantId, ids.id("student", sk))) as ServiceResult;
      const rows = (r.data as any[]) ?? [];
      if (rows.length) obs.ueResults[sk] = rows;
    }

    for (const sem of semesters) {
      const semId = ids.id("semester", sem.key);
      const roster = (await this.bulletins.listRoster(tenantId, semId)) as ServiceResult;
      if (roster.success) {
        const d = roster.data as any;
        const students: Record<string, unknown> = {};
        for (const s of d.students) students[ids.key(s.student_id) ?? s.student_id] = s;
        obs.rosters[sem.key] = { semestre: d.semestre, filiere: d.filiere, students };
      } else {
        obs.rosters[sem.key] = outcome(roster);
      }

      obs.bulletins[sem.key] = {};
      obs.bts[sem.key] = {};
      for (const sk of studentKeys) {
        if (!(roster.data as any)?.students?.some((s: any) => s.student_id === ids.id("student", sk))) continue;
        obs.bulletins[sem.key][sk] = outcome((await this.bulletins.getBulletin(tenantId, semId, ids.id("student", sk))) as ServiceResult);
        if (/licence\s*[12]\b/i.test(sem.programme.name)) {
          obs.bts[sem.key][sk] = outcome((await this.bulletins.getBulletinBts(tenantId, semId, ids.id("student", sk))) as ServiceResult);
        }
      }
      if (Object.keys(obs.bts[sem.key]).length === 0) delete obs.bts[sem.key];

      const full = (await this.bulletins.listFullBulletins(tenantId, semId)) as ServiceResult;
      if (full.success) {
        const m: Record<string, unknown> = {};
        for (const b of full.data as any[]) {
          m[ids.key(b.student.id) ?? b.student.id] = {
            rang: b.rang,
            moyenne_session: b.moyenne_session,
            decision: b.decision,
            statut_etudiant: b.statut_etudiant,
            effectif: b.effectif,
          };
        }
        obs.fullBulletins[sem.key] = m;
      }

      const gen = await pool.query(
        `SELECT student_id, statut, data->>'decision' AS decision, (data->>'moyenne_session') AS moyenne_session,
                data->>'statut_etudiant' AS statut_etudiant
         FROM professional_bulletins WHERE tenant_id=$1 AND semestre_id=$2`,
        [tenantId, semId],
      );
      if (gen.rowCount) {
        const m: Record<string, unknown> = {};
        for (const row of gen.rows) m[ids.key(row.student_id) ?? row.student_id] = { statut: row.statut, decision: row.decision, moyenne_session: row.moyenne_session, statut_etudiant: row.statut_etudiant };
        obs.generated[sem.key] = m;
      }

      const rat = (await this.results.listSemestreRattrapages(tenantId, semId)) as ServiceResult;
      const keyed: Record<string, unknown> = {};
      for (const row of (rat.data as any[]) ?? []) keyed[`${ids.key(row.student_id) ?? row.student_id}/${ids.key(row.ecue_id) ?? row.ecue_id}`] = row;
      if (Object.keys(keyed).length) obs.rattrapages[sem.key] = keyed;
    }

    for (const sk of studentKeys) {
      const r = (await this.results.listStudentRattrapages(tenantId, ids.id("user-student", sk))) as ServiceResult;
      if (r.success && (r.data as any[]).length) obs.studentRattrapages[sk] = r.data;
    }

    // Saisie des conduites : filières et semestres encore ouverts, grille de saisie par semestre.
    const conduite: Record<string, unknown> = {
      filieres: outcome((await this.results.listConduiteFilieres(tenantId)) as ServiceResult),
      semestres: {} as Record<string, unknown>,
      grille: {} as Record<string, unknown>,
    };
    for (const p of this.setup.programmes) {
      (conduite.semestres as Record<string, unknown>)[p.key] = outcome((await this.results.listConduiteSemestres(tenantId, ids.id("programme", p.key))) as ServiceResult);
    }
    for (const sem of semesters) {
      const g = (await this.results.getSemestreConduite(tenantId, ids.id("semester", sem.key))) as ServiceResult;
      const d = g.data as any;
      if (d?.conduite) {
        d.students = (d.students as any[]).map((s) => ({ ...s, student_key: ids.key(s.student_id) })).sort((a, b) => (a.student_key < b.student_key ? -1 : 1));
        (conduite.grille as Record<string, unknown>)[sem.key] = d;
      }
    }
    obs.conduite = conduite;
    return obs;
  }
}
