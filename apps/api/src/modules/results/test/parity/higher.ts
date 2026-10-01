/**
 * ADAPTATEUR DE PARITÉ — pile « supérieur à crédits » (BTS / Licence / LMD).
 *
 * Lit un scénario DÉCLARATIF de `tests/characterization/scenarios` (aucun schéma legacy), le traduit en ports EN MÉMOIRE de
 * `results` (curriculum, effectif, notes publiées), joue ses étapes (`recompute`, `enter-grade`, `jury-validate`,
 * `close-bulletins`…) à travers les VRAIS cas d'usage de `results` et les VRAIES règles du catalogue national (CI-HIGHER-LMD),
 * puis PROJETTE les résultats sur la forme observée dans la snapshot du legacy (`observations.<étape>.ecueResults / ueResults /
 * bulletins / fullBulletins`), afin que `compareWithTolerance` les compare champ à champ.
 *
 * Traductions (toutes documentées ici, rien d'implicite) :
 *   - groupe (promotion) → classe ; semestre du programme → période ; UE / ECUE → nœuds du curriculum ; une ECUE d'une UE de
 *     conduite (`conduct`) → mode DIRECT (note brute /20, sans pondération devoirs/examen), rattrapage non autorisé ;
 *   - `devoir` → groupe d'agrégation `CONTINUOUS` ; `examen` → groupe `EXAM` (seul le groupe `EXAM` alimente l'examen retenu) ;
 *   - `max` → barème (`scaleMax`) ; `session` 1|2 → `sessionNo` ; notes et barèmes en CHAÎNES décimales exactes ;
 *   - `jury-validate` → surcharge `VALIDATION` sur `ecue_validee`, demandée puis APPROUVÉE par une seconde personne (quatre yeux) ;
 *   - `close-bulletins` → `lockPeriod` (le verrou de notes d'`assess` est simulé par le port : toute saisie ultérieure sur la période est
 *     refusée, comme « Le semestre a été clôturé » du legacy) ; `generate-bulletins` n'a pas d'équivalent de calcul (les bulletins sont
 *     des vues de `results`, dérivées à la demande) mais conserve la garde « bulletins générés avant clôture » du scénario ;
 *   - une saisie refusée par le legacy (note > barème, période clôturée) n'est pas appliquée.
 *
 * Projection vers le legacy (présentation, pas calcul) :
 *   - valeurs affichées = `displayValue` des règles (arrondi demi-supérieur à 2 décimales) ; devoirs / examen arrondis de même ;
 *   - codes → libellés courts du legacy (`VALIDATED` → `valide`, `RESIT` → `rattrapage`, `ADMITTED` → `admis`…) ;
 *   - le legacy refuse le BULLETIN d'un étudiant « en attente de session 2 » (`SESSION2_PENDING`) : c'est une politique de
 *     disponibilité du document, projetée ici depuis la décision `RESIT` ; les résultats de calcul restent comparés par ailleurs.
 */
import { newId, unwrap } from "@ecoledigitale/kernel";
import type { GradeDecl, ProgrammeDecl, Scenario, Step } from "../../../../../../../tests/characterization/scenarios/types";
import { approveOverride, requestOverride } from "../../application/governance";
import { computePeriod } from "../../application/compute";
import { lockPeriod } from "../../application/lifecycle";
import { getClassMatrix, getPeriodView, type ClassMatrix } from "../../application/reads";
import type { ClassStructure, EnrollmentRef, GradeFact, PeriodFacts, StructureNode } from "../../domain/types";
import { CAPS_ALL, type World } from "../support/world";
import { round2, toNumber } from "./decimal";

type Obj = Record<string, any>;

const ECUE_STATUS: Record<string, string> = { VALIDATED: "valide", COMPENSATED: "compense", INSUFFICIENT: "insuffisant", ELIMINATORY: "insuffisant", PENDING: "en_cours" };
const UE_STATE: Record<string, string> = { VALIDATED: "validee", RESIT: "rattrapage", DEBT: "dette" };
const DECISION: Record<string, string> = { ADMITTED: "admis", RESIT: "rattrapage", ADJOURNED: "ajourne" };
const STUDENT_STATUS: Record<string, string> = { ADMITTED: "valide", RESIT: "session2", ADJOURNED: "dette" };

interface SemesterWorld {
  groupKey: string;
  semKey: string;
  programme: ProgrammeDecl;
  classroomId: string;
  period: PeriodFacts;
  structure: ClassStructure;
  ueKeys: string[];
}

interface AppliedGrade extends GradeDecl {
  seq: number;
}

export interface HigherParityOptions {
  /** Désactive la garde « bulletins générés avant clôture » (pour des scénarios qui ne la jouent pas). */
  strictClosure?: boolean;
}

export class HigherParity {
  readonly students = new Map<string, string>();
  readonly enrollments = new Map<string, EnrollmentRef>();
  readonly nodeIds = new Map<string, string>();
  readonly semesters: SemesterWorld[] = [];
  readonly applied: AppliedGrade[] = [];
  readonly generated = new Set<string>();
  readonly observations: Record<string, Obj> = {};
  /** Codes des UE de conduite (hors résultats d'ECUE et de `ueResults` dans le legacy). */
  readonly conductUeCodes: ReadonlySet<string>;
  /** Refus joués par le scénario : `[étiquette de l'étape, raison]`. */
  readonly refusals: Array<[string, string]> = [];
  private seq = 0;

  constructor(
    private readonly w: World,
    private readonly scenario: Scenario,
  ) {
    const setup = scenario.higher!.higher;
    this.conductUeCodes = new Set(setup.programmes.flatMap((p) => p.ues.filter((u) => u.conduct).map((u) => u.code)));
    for (const g of setup.grades) this.applied.push({ ...g, seq: this.seq++ });
    for (const s of scenario.students) this.students.set(s.key, newId());
    for (const group of setup.groups) {
      const programme = setup.programmes.find((p) => p.key === group.programme) as ProgrammeDecl;
      const classroomId = newId();
      const yearId = newId();
      for (const st of group.students) {
        const ref = { enrollmentId: newId(), studentId: this.students.get(st) as string };
        this.enrollments.set(`${group.key}/${st}`, ref);
        w.roster.entries.push({ ...ref, active: true, classroomId });
      }
      for (const e of programme.ecues) this.nodeIds.set(`${group.key}/${e.key}`, newId());
      for (const u of programme.ues) this.nodeIds.set(`${group.key}/${u.key}`, newId());
      programme.semesters.forEach((sem, index) => {
        const period: PeriodFacts = { id: newId(), rankInYear: index + 1, countInYear: programme.semesters.length, isSecondSemester: programme.semesters.length > 1 && index === programme.semesters.length - 1, startsOn: group.start, endsOn: group.end };
        const nodes: StructureNode[] = [];
        let ordinal = 0;
        for (const ueKey of sem.ues) {
          const ue = programme.ues.find((u) => u.key === ueKey)!;
          nodes.push({ id: this.nodeIds.get(`${group.key}/${ue.key}`)!, parentId: null, kind: "UE", code: ue.code, label: ue.label, ordinal: ordinal++, credits: null, coefficient: null, gradingMode: "COMPOSED", resitAllowed: true, countsInAverage: true, sectionKey: null, category: ue.category ?? null });
          for (const ek of ue.ecues) {
            const ecue = programme.ecues.find((e) => e.key === ek)!;
            nodes.push({
              id: this.nodeIds.get(`${group.key}/${ecue.key}`)!,
              parentId: this.nodeIds.get(`${group.key}/${ue.key}`)!,
              kind: "ECUE",
              code: ecue.code,
              label: ecue.label,
              ordinal: ordinal++,
              credits: ecue.credits === null ? null : String(ecue.credits),
              coefficient: null,
              gradingMode: ue.conduct ? "DIRECT" : "COMPOSED",
              resitAllowed: !ue.conduct,
              countsInAverage: true,
              sectionKey: null,
              category: null,
            });
          }
        }
        const structure: ClassStructure = { classroomId, academicYearId: yearId, contractId: "credit-semester@1", period, firstPeriodId: null, terminalExamRequired: false, nodes, yearPeriods: [period] };
        w.curriculum.set(structure);
        this.semesters.push({ groupKey: group.key, semKey: sem.key, programme, classroomId, period, structure, ueKeys: sem.ues });
      });
    }
  }

  /* --------------------------------------------------------------------------------------------- notes */

  private semesterOfEcue(group: string, ecue: string): SemesterWorld | undefined {
    return this.semesters.find((s) => s.groupKey === group && s.ueKeys.some((u) => s.programme.ues.find((x) => x.key === u)?.ecues.includes(ecue)));
  }

  private factsOf(sw: SemesterWorld): GradeFact[] {
    const facts: GradeFact[] = [];
    for (const g of this.applied) {
      if (g.group !== sw.groupKey) continue;
      const enrollment = this.enrollments.get(`${g.group}/${g.student}`);
      const node = this.nodeIds.get(`${g.group}/${g.ecue}`);
      if (!enrollment || !node || this.semesterOfEcue(g.group, g.ecue) !== sw) continue;
      const day = new Date(Date.UTC(2025, 9, 1) + g.seq * 86_400_000).toISOString().slice(0, 10);
      facts.push({
        gradeId: `00000000-0000-7000-8000-${String(g.seq).padStart(12, "0")}`,
        assessmentId: `a0000000-0000-7000-8000-${String(g.seq).padStart(12, "0")}`,
        enrollmentId: enrollment.enrollmentId,
        curriculumNodeId: node,
        sessionNo: g.nature === "examen" ? (g.session ?? 1) : 1,
        assessedOn: day,
        aggregationGroup: g.nature === "examen" ? "EXAM" : "CONTINUOUS",
        scaleMax: String(g.max ?? 20),
        weight: "1",
        score: String(g.value),
        entryStatus: "ENTERED",
      });
    }
    return facts;
  }

  private locked(sw: SemesterWorld): boolean {
    return this.w.assess.locks.has(`${sw.classroomId}:${sw.period.id}`);
  }

  async computeAll(): Promise<void> {
    for (const sw of this.semesters) {
      this.w.assess.grades = this.factsOf(sw);
      unwrap(await computePeriod(this.w.deps, this.w.director, { classroomId: sw.classroomId, academicPeriodId: sw.period.id }));
    }
  }

  /* --------------------------------------------------------------------------------------------- étapes */

  async play(): Promise<void> {
    for (const step of this.scenario.higher!.steps) await this.perform(step);
    if (!("final" in this.observations)) this.observations.final = await this.observe();
  }

  private refuse(step: Step, reason: string): void {
    this.refusals.push([("label" in step && step.label) || step.do, reason]);
  }

  private async perform(step: Step): Promise<void> {
    switch (step.do) {
      case "recompute":
        await this.computeAll();
        return;
      case "observe":
        this.observations[step.label] = await this.observe();
        return;
      case "enter-grade": {
        const g = step.grade;
        const sw = this.semesterOfEcue(g.group, g.ecue);
        if (!sw) return this.refuse(step, "ECUE hors semestre");
        if (this.locked(sw)) return this.refuse(step, "période clôturée");
        if (g.value < 0 || g.value > (g.max ?? 20)) return this.refuse(step, "note hors barème");
        if (g.nature === "examen") {
          const i = this.applied.findIndex((x) => x.student === g.student && x.ecue === g.ecue && x.group === g.group && x.nature === "examen" && (x.session ?? 1) === (g.session ?? 1) && (x.via ?? "manual") === "manual");
          if (i >= 0) this.applied.splice(i, 1);
        }
        this.applied.push({ ...g, via: "manual", seq: this.seq++ });
        return;
      }
      case "update-grade":
      case "delete-grade": {
        const hit = this.lastApplied(step.student, step.ecue, step.group, step.nature);
        const sw = this.semesterOfEcue(step.group, step.ecue);
        if (!hit || !sw) return this.refuse(step, "aucune note");
        if (this.locked(sw)) return this.refuse(step, "période clôturée");
        if (step.do === "update-grade") hit.value = step.value;
        else this.applied.splice(this.applied.indexOf(hit), 1);
        return;
      }
      case "grade-evaluation": {
        const sw = this.semesterOfEcue(step.group, step.ecue);
        const hit = this.applied.find((g) => g.student === step.student && g.ecue === step.ecue && g.group === step.group && g.nature === step.nature && g.via === "assessment");
        if (!hit || !sw) return this.refuse(step, "aucune copie");
        if (this.locked(sw)) return this.refuse(step, "période clôturée");
        hit.value = step.value;
        return;
      }
      case "jury-validate":
        return this.jury(step);
      case "generate-bulletins": {
        for (const sw of this.semesters.filter((s) => s.semKey === step.semester)) {
          if (this.locked(sw)) this.refuse(step, "semestre clôturé");
          else this.generated.add(`${sw.groupKey}/${sw.semKey}`);
        }
        return;
      }
      case "close-bulletins": {
        const targets = this.semesters.filter((s) => s.semKey === step.semester);
        if (targets.some((sw) => !this.generated.has(`${sw.groupKey}/${sw.semKey}`))) return this.refuse(step, "bulletins non générés");
        await this.computeAll();
        for (const sw of targets) unwrap(await lockPeriod(this.w.deps, this.w.director, { classroomId: sw.classroomId, academicPeriodId: sw.period.id, caps: CAPS_ALL }));
        return;
      }
      case "close-grades":
        return; // clôture des NOTES (cohortes « terminé ») : n'arrête aucune saisie dans le legacy non plus
    }
  }

  private lastApplied(student: string, ecue: string, group: string, nature: string): AppliedGrade | undefined {
    const same = this.applied.filter((g) => g.student === student && g.ecue === ecue && g.group === group && g.nature === nature);
    return [...same].sort((a, b) => (a.session ?? 1) - (b.session ?? 1)).at(-1);
  }

  private async jury(step: Extract<Step, { do: "jury-validate" }>): Promise<void> {
    if (!step.validated) throw new Error("jury-validate validated=false : non utilisé par les scénarios de parité");
    await this.computeAll();
    const sw = this.semesterOfEcue(step.group, step.ecue) as SemesterWorld;
    const enrollment = this.enrollments.get(`${step.group}/${step.student}`) as EnrollmentRef;
    const stateId = unwrap(await getPeriodView(this.w.deps, this.w.director, { classroomId: sw.classroomId, academicPeriodId: sw.period.id, caps: CAPS_ALL })).state.id;
    const req = unwrap(
      await requestOverride(this.w.deps, this.w.director, {
        stateId,
        enrollmentId: enrollment.enrollmentId,
        level: "ECUE",
        curriculumNodeId: this.nodeIds.get(`${step.group}/${step.ecue}`) as string,
        ruleKey: "ecue_validee",
        kind: "VALIDATION",
        flag: true,
        justification: "Validation de l'ECUE par le jury après examen du dossier de l'étudiant.",
        caps: CAPS_ALL,
      }),
    );
    unwrap(await approveOverride(this.w.deps, this.w.second, { overrideId: req.id, comment: "Conforme au procès-verbal du jury.", caps: CAPS_ALL }));
    await this.computeAll();
  }

  /* --------------------------------------------------------------------------------------------- projection */

  private async matrixOf(sw: SemesterWorld): Promise<ClassMatrix> {
    return unwrap(await getClassMatrix(this.w.deps, this.w.director, { classroomId: sw.classroomId, academicPeriodId: sw.period.id, withLines: true, caps: CAPS_ALL }));
  }

  async observe(): Promise<Obj> {
    await this.computeAll();
    const setup = this.scenario.higher!.higher;
    const matrices = new Map<SemesterWorld, ClassMatrix>();
    for (const sw of this.semesters) matrices.set(sw, await this.matrixOf(sw));

    const out: Obj = { ecueResults: {}, ueResults: {}, bulletins: {}, fullBulletins: {} };
    const rowOf = (sw: SemesterWorld, student: string) => {
      const enrollment = this.enrollments.get(`${sw.groupKey}/${student}`);
      return enrollment ? matrices.get(sw)!.rows.find((r) => r.header.enrollmentId === enrollment.enrollmentId) : undefined;
    };

    for (const sw of this.semesters) {
      const group = setup.groups.find((g) => g.key === sw.groupKey)!;
      for (const ueKey of sw.ueKeys) {
        const ue = sw.programme.ues.find((u) => u.key === ueKey)!;
        if (ue.conduct) continue; // la conduite est exclue des résultats d'ECUE (règle du legacy)
        const cohort: Obj = {};
        for (const student of [...group.students].sort()) {
          const row = rowOf(sw, student);
          if (!row) continue;
          for (const ek of ue.ecues) {
            const line = row.lines.find((l) => l.level === "ECUE" && l.curriculumNodeId === this.nodeIds.get(`${sw.groupKey}/${ek}`));
            if (!line) continue; // le legacy matérialise une ligne par (étudiant, ECUE), vide (tout à null) quand aucune note n'existe
            cohort[`${student}/${ek}`] = {
              moyenne: round2(line.value),
              moyenne_devoirs: round2(line.outputs.moyenne_devoirs as string | null),
              note_examen: round2(line.outputs.note_examen as string | null),
              eliminee: line.outputs.eliminee === true,
              validee: line.validated === true,
              validee_manuellement: line.outputs.validation_manuelle === true,
            };
          }
        }
        if (Object.keys(cohort).length) out.ecueResults[`${sw.groupKey}:${ueKey}`] = cohort;
      }
    }

    // UE persistées de chaque étudiant (toutes les UE de son programme, dans l'ordre déclaré).
    for (const student of [...new Set(setup.groups.flatMap((g) => g.students))].sort()) {
      const rows: Obj[] = [];
      for (const sw of this.semesters.filter((s) => this.enrollments.has(`${s.groupKey}/${student}`))) {
        const row = rowOf(sw, student);
        for (const ueKey of sw.ueKeys) {
          const ue = sw.programme.ues.find((u) => u.key === ueKey)!;
          if (ue.conduct) continue;
          const line = row?.lines.find((l) => l.level === "UE" && l.curriculumNodeId === this.nodeIds.get(`${sw.groupKey}/${ueKey}`));
          const ecueLines = row?.lines.filter((l) => l.level === "ECUE" && l.parentNodeId === line?.curriculumNodeId) ?? [];
          const pending = ecueLines.length === 0 || ecueLines.some((l) => l.statusCode === "PENDING");
          const validated = line?.validated === true;
          rows.push({ ue_code: ue.code, statut: validated ? "validee" : pending ? "en_cours" : "echec", uv_acquises: validated ? Number(line?.credits) : 0 });
        }
      }
      out.ueResults[student] = rows;
    }

    // Bulletins par semestre de programme (étudiants de toutes les promotions du programme).
    const bySemester = new Map<string, SemesterWorld[]>();
    for (const sw of this.semesters) bySemester.set(sw.semKey, [...(bySemester.get(sw.semKey) ?? []), sw]);
    for (const [semKey, list] of [...bySemester.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const bulletins: Obj = {};
      const full: Obj = {};
      for (const sw of list) {
        const group = setup.groups.find((g) => g.key === sw.groupKey)!;
        for (const student of [...group.students].sort()) {
          const row = rowOf(sw, student);
          if (!row) continue;
          const h = row.header;
          if (h.decisionCode === "RESIT" || h.decisionCode === null) {
            bulletins[student] = { ok: false, error: "SESSION2_PENDING" };
            continue;
          }
          const ues: Obj[] = [];
          for (const ueKey of sw.ueKeys) {
            const ue = sw.programme.ues.find((u) => u.key === ueKey)!;
            const ueLine = row.lines.find((l) => l.level === "UE" && l.curriculumNodeId === this.nodeIds.get(`${sw.groupKey}/${ueKey}`));
            if (!ueLine) continue;
            const ecues: Obj[] = [];
            for (const ek of ue.ecues) {
              const ecue = sw.programme.ecues.find((e) => e.key === ek)!;
              const l = row.lines.find((x) => x.level === "ECUE" && x.curriculumNodeId === this.nodeIds.get(`${sw.groupKey}/${ek}`));
              if (!l || (l.outputs.moyenne_devoirs == null && l.outputs.note_examen == null)) continue;
              ecues.push({
                code: ecue.code,
                moyenne_devoirs: round2(l.outputs.moyenne_devoirs as string | null),
                note_examen: round2(l.outputs.note_examen as string | null),
                note_ecue: round2(l.value),
                validee: l.validated === true,
                validee_manuellement: l.outputs.validation_manuelle === true,
                statut: ECUE_STATUS[l.statusCode ?? ""] ?? l.statusCode,
                session_obtention: l.sessionObtained,
              });
            }
            if (ecues.length === 0) continue; // UE sans aucun résultat : absente du bulletin (comme la conduite non notée)
            ues.push({
              code: ue.code,
              credits: toNumber(ueLine.credits),
              moyenne_ue: round2(ueLine.value),
              validee: ueLine.validated === true,
              etat: UE_STATE[ueLine.statusCode ?? ""] ?? ueLine.statusCode,
              session_validation: ueLine.sessionObtained,
              ecues,
            });
          }
          bulletins[student] = {
            ok: true,
            data: {
              moyenne_session: round2(h.average),
              rang: h.rank,
              effectif: (h.summary as Obj).classSize ?? null,
              credits_valides: toNumber(h.creditsAcquired),
              credits_total: toNumber(h.creditsRequired),
              decision: DECISION[h.decisionCode ?? ""] ?? h.decisionCode,
              statut_etudiant: STUDENT_STATUS[h.decisionCode ?? ""] ?? null,
              semestre_valide: h.validated === true,
              ues,
            },
          };
          full[student] = { rang: h.rank, moyenne_session: round2(h.average), decision: DECISION[h.decisionCode ?? ""] ?? h.decisionCode, statut_etudiant: STUDENT_STATUS[h.decisionCode ?? ""] ?? null, effectif: (h.summary as Obj).classSize ?? null };
        }
      }
      out.bulletins[semKey] = bulletins;
      out.fullBulletins[semKey] = full;
    }
    return out;
  }
}

/** Sous-ensemble de l'observation legacy comparable à `HigherParity.observe()` (même forme, mêmes champs). */
export function pickLegacyObservation(o: Obj, conductUeCodes: ReadonlySet<string> = new Set()): Obj {
  const out: Obj = { ecueResults: {}, ueResults: {}, bulletins: {}, fullBulletins: {} };
  for (const [cohort, rows] of Object.entries<Obj>(o.ecueResults ?? {})) {
    out.ecueResults[cohort] = Object.fromEntries(
      Object.entries<Obj>(rows).map(([k, r]) => [k, { moyenne: r.moyenne, moyenne_devoirs: r.moyenne_devoirs, note_examen: r.note_examen, eliminee: r.eliminee, validee: r.validee, validee_manuellement: r.validee_manuellement }]),
    );
  }
  for (const [student, rows] of Object.entries<Obj[]>(o.ueResults ?? {})) {
    out.ueResults[student] = rows.filter((r) => !conductUeCodes.has(r.ue_code)).map((r) => ({ ue_code: r.ue_code, statut: r.statut, uv_acquises: r.uv_acquises }));
  }
  for (const [sem, students] of Object.entries<Obj>(o.bulletins ?? {})) {
    out.bulletins[sem] = {};
    for (const [student, b] of Object.entries<Obj>(students)) {
      if (!b.ok) {
        out.bulletins[sem][student] = { ok: false, error: b.error };
        continue;
      }
      const d = b.data;
      out.bulletins[sem][student] = {
        ok: true,
        data: {
          moyenne_session: d.moyenne_session,
          rang: d.rang,
          effectif: d.effectif,
          credits_valides: d.credits_valides,
          credits_total: d.credits_total,
          decision: d.decision,
          statut_etudiant: d.statut_etudiant,
          semestre_valide: d.semestre_valide,
          ues: d.ues.map((u: Obj) => ({
            code: u.code,
            credits: u.credits,
            moyenne_ue: u.moyenne_ue,
            validee: u.validee,
            etat: u.etat,
            session_validation: u.session_validation,
            ecues: u.ecues.map((e: Obj) => ({ code: e.code, moyenne_devoirs: e.moyenne_devoirs, note_examen: e.note_examen, note_ecue: e.note_ecue, validee: e.validee, validee_manuellement: e.validee_manuellement, statut: e.statut, session_obtention: e.session_obtention })),
          })),
        },
      };
    }
  }
  for (const [sem, students] of Object.entries<Obj>(o.fullBulletins ?? {})) {
    out.fullBulletins[sem] = Object.fromEntries(Object.entries<Obj>(students).map(([k, b]) => [k, { rang: b.rang, moyenne_session: b.moyenne_session, decision: b.decision, statut_etudiant: b.statut_etudiant, effectif: b.effectif }]));
  }
  return out;
}
