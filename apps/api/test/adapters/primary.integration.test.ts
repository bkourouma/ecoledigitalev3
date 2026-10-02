/**
 * Adaptateurs du pack Primary sur les VRAIS modules (Postgres réel, monde d'assemblage : people + academic + results + rules +
 * attendance + reportcards, aucun port en mémoire). La classe est celle d'une école SUPÉRIEURE : les adaptateurs ne dépendent pas du
 * pack, sauf les listes « classes du primaire » qui doivent l'EXCLURE. Vérifie les traductions des API publiques vers les ports de
 * `primary_school` et l'ÉCHEC FERMÉ de ce qui n'est pas encore livré (natures de document, contrats de règles du primaire).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { closeClassroomPeriodGrading } from "../../src/modules/academic";
import { lockPeriod } from "../../src/modules/results";
import { describeIntegration } from "../helpers/fixtures";
import { RESULTS_CAPS, adminRows, bindCreditRules, createAssemblyWorld, seedHigherSchool, type AssemblyWorld, type HigherSchool } from "./support/world";

describeIntegration("adaptateurs du pack Primary : academic, people, results, rules, attendance, reportcards -> primary_school", () => {
  let w: AssemblyWorld;
  let school: HigherSchool;
  const ports = () => w.ports.primary_school;

  beforeAll(async () => {
    w = await createAssemblyWorld();
    await bindCreditRules(w);
    school = await seedHigherSchool(w, { pupils: 3 });
  }, 300_000);
  afterAll(async () => {
    await w?.drop();
  });

  it("tous les ports du pack sont branchés par la plateforme (rien n'est « non branché » à l'assemblage)", () => {
    expect(Object.keys(ports()).sort()).toEqual(["attendance", "classrooms", "documents", "guardianship", "outcomes", "periods", "results", "rules", "teaching"]);
  });

  it("academic -> ClassroomPort : classe, effectif NOMMÉ (noms de people), inscription, périodes d'enseignement, année", async () => {
    const { classroomId } = school.ref;
    const c = (await ports().classrooms!.getClassroom(w.director, classroomId))!;
    expect(c).toMatchObject({ id: classroomId, institutionId: w.academic.institutionId, academicYearId: school.seed.yearId, status: "ACTIVE" });
    expect(c.name).toBeTruthy();
    expect(c.gradeLevelCode).toBeTruthy();
    const roster = await ports().classrooms!.listRoster(w.director, classroomId);
    expect(roster.map((r) => r.enrollmentId).sort()).toEqual(school.pupils.map((p) => p.enrollmentId).sort());
    for (const r of roster) expect(r.displayName?.toUpperCase()).toContain("ETUDIANT");
    expect(roster.every((r) => r.isRepeating === false)).toBe(true);
    const e = (await ports().classrooms!.getEnrollment(w.director, school.pupils[0]!.enrollmentId))!;
    expect(e).toMatchObject({ id: school.pupils[0]!.enrollmentId, classroomId, studentId: school.pupils[0]!.studentId, status: "ACTIVE" });
    expect(await ports().classrooms!.getEnrollment(w.director, newId())).toBeNull();
    expect(await ports().classrooms!.getClassroom(w.director, newId())).toBeNull();
    const periods = await ports().classrooms!.listPeriods(w.director, school.seed.yearId);
    expect(periods.map((p) => p.ordinal)).toEqual([1, 2]);
    expect(periods.map((p) => p.id)).toEqual(school.seed.periodIds);
    expect(await ports().classrooms!.getYear(w.director, school.seed.yearId)).toMatchObject({ id: school.seed.yearId, closed: false });
    // le pack Primary ne liste QUE ses classes et ses établissements : une école supérieure n'y figure pas
    expect(await ports().classrooms!.listClassrooms(w.director, { academicYearId: school.seed.yearId })).toEqual([]);
    expect(await ports().classrooms!.listInstitutions(w.director)).toEqual([]);
  });

  it("academic -> PeriodStatePort : verrou lu sur l'état EFFECTIF (notation arrêtée = verrouillé) ; clôture d'année fermée tant que tout n'est pas clos", async () => {
    const { classroomId, academicPeriodId } = school.ref;
    expect(await ports().periods!.getState(w.director, { classroomId, periodId: academicPeriodId })).toMatchObject({ locked: false });
    expect(await ports().periods!.allPeriodsClosed(w.director, { classroomId, academicYearId: school.seed.yearId })).toBe(false);
    unwrap(await closeClassroomPeriodGrading(w.academic.deps, w.director, classroomId, academicPeriodId));
    expect(await ports().periods!.getState(w.director, { classroomId, periodId: academicPeriodId })).toMatchObject({ locked: true });
    // échec fermé : une classe inconnue est « verrouillée », jamais « ouverte »
    expect(await ports().periods!.getState(w.director, { classroomId: newId(), periodId: academicPeriodId })).toMatchObject({ locked: true, state: "UNKNOWN" });
  });

  it("academic -> OutcomePort : l'issue d'inscription est enregistrée avec la décision source ; une issue inconnue échoue", async () => {
    const p = school.pupils[0]!;
    await ports().outcomes!.recordOutcome(w.director, { enrollmentId: p.enrollmentId, outcomeCode: "PROMOTED", decisionRef: newId() });
    const rows = await adminRows<{ outcome_code: string | null }>(w, "SELECT outcome_code FROM academic.enrollments WHERE id = $1", [p.enrollmentId]);
    expect(rows[0]!.outcome_code).toBe("PROMOTED");
    await expect(ports().outcomes!.recordOutcome(w.director, { enrollmentId: p.enrollmentId, outcomeCode: "INCONNUE" })).rejects.toMatchObject({ kind: "validation" });
  });

  it("people -> TeachingPort et GuardianshipPort : instituteur d'un compte, affectation, titulaire (HOMEROOM), équipe ; comptes sans fiche = aucun droit", async () => {
    const { classroomId } = school.ref;
    const t = ports().teaching!;
    expect(await t.staffIdForUser(school.teacher.ctx, school.teacher.ctx.userId as string)).toBe(school.teacher.staffId);
    expect(await t.staffIdForUser(w.director, newId())).toBeNull();
    expect(await t.isAssigned(w.director, school.teacher.staffId, classroomId)).toBe(true);
    expect(await t.isAssigned(w.director, newId(), classroomId)).toBe(false);
    expect(await t.classroomIdsOfStaff(w.director, school.teacher.staffId)).toContain(classroomId);
    // l'enseignant du monde est LEAD (pas titulaire) : la classe n'a pas de titulaire
    expect(await t.isHomeroom(w.director, school.teacher.staffId, classroomId)).toBe(false);
    expect(await t.hasHomeroom(w.director, classroomId)).toBe(false);
    const staff = await t.listClassroomStaff(w.director, classroomId);
    expect(staff).toEqual([expect.objectContaining({ staffId: school.teacher.staffId, roleCode: "LEAD" })]);
    expect((await t.staffNames(w.director, [school.teacher.staffId])).get(school.teacher.staffId)).toBeTruthy();
    const g = ports().guardianship!;
    expect(await g.studentIdForUser(w.director, newId())).toBeNull();
    expect(await g.isGuardianOf(w.director, newId(), school.pupils[0]!.studentId)).toBe(false);
    expect(await g.childrenOf(w.director, newId())).toEqual([]);
  });

  it("results -> ResultsPort : conseil sur la période (délibération COUNCIL, idempotent), détail, origine du jeu de règles, aucune décision de fin d'année", async () => {
    const { classroomId, academicPeriodId } = school.ref;
    // période sans état de résultats : l'ouverture d'un conseil est refusée (les résultats ne sont pas calculés)
    await expect(ports().results!.openCouncil(w.director, { classroomId, periodId: academicPeriodId, participants: [] })).rejects.toMatchObject({ kind: "not_found" });
    expect(await ports().results!.getRuleSourceKind(w.director, { classroomId, periodId: academicPeriodId })).toBeNull();

    // le verrou de la période crée l'état de résultats (règle épinglée) ; le conseil se tient AVANT la clôture
    unwrap(await lockPeriod(w.kit.results, w.director, { ...school.ref, caps: RESULTS_CAPS }));
    const opened = await ports().results!.openCouncil(w.director, { classroomId, periodId: academicPeriodId, heldOn: "2026-10-02", participants: [{ staffId: school.teacher.staffId, role: "HOMEROOM" }] });
    expect(opened.academicYearId).toBe(school.seed.yearId);
    const again = await ports().results!.openCouncil(w.director, { classroomId, periodId: academicPeriodId, participants: [] });
    expect(again.deliberationId).toBe(opened.deliberationId);
    const d = (await ports().results!.getDeliberation(w.director, { deliberationId: opened.deliberationId, classroomId, periodId: academicPeriodId }))!;
    expect(d).toMatchObject({ id: opened.deliberationId, kind: "COUNCIL", status: "PLANNED", heldOn: "2026-10-02", academicYearId: school.seed.yearId });
    expect(d.participants).toEqual([{ staffId: school.teacher.staffId, role: "HOMEROOM" }]);
    expect(await ports().results!.getDeliberation(w.director, { deliberationId: newId(), classroomId, periodId: academicPeriodId })).toBeNull();
    // origine du jeu de règles : lue sur la version ÉPINGLÉE (le catalogue national n'est jamais « placeholder »)
    const kind = await ports().results!.getRuleSourceKind(w.director, { classroomId, periodId: academicPeriodId });
    expect(kind === null || ["regulation", "platform", "institution"].includes(kind)).toBe(true);
    // pas de résultat d'année tant que toutes les périodes ne sont pas FINAL ; aucune décision de fin d'année confirmée
    const year = await ports().results!.getYearResult(w.director, { enrollmentId: school.pupils[0]!.enrollmentId, academicYearId: school.seed.yearId, lastPeriodId: school.seed.periodIds[1]! });
    expect(year).toMatchObject({ complete: false, yearResultRef: null, ruleVersionRef: null });
    expect(await ports().results!.getConfirmedYearDecision(w.director, { enrollmentId: school.pupils[0]!.enrollmentId, classroomId, periodId: school.seed.periodIds[1]! })).toBeNull();
    expect(await ports().results!.listProposals(w.director, { classroomId, periodId: academicPeriodId })).toEqual([]);
    // confirmer une décision inconnue : refus typé de results (jamais une confirmation silencieuse)
    await expect(ports().results!.confirmDecision(w.director, { decisionId: newId(), deliberationId: opened.deliberationId })).rejects.toMatchObject({ kind: "not_found" });
  });

  it("rules -> RulesPort : aucun contrat du primaire publié : quorum non bloquant (null) et aucun motif d'examen inventé", async () => {
    const { classroomId, academicPeriodId } = school.ref;
    expect(await ports().rules!.quorum(w.director, { classroomId, periodId: academicPeriodId, convened: 6, present: 3 })).toBeNull();
    const flags = await ports().rules!.councilFlags(w.director, { classroomId, periodId: academicPeriodId, enrollmentIds: school.pupils.map((p) => p.enrollmentId) });
    expect(flags.size).toBe(0);
  });

  it("attendance -> AttendancePort : récapitulatif d'année (comptages, jamais de seuil) et registre mensuel sans appel", async () => {
    const e = school.pupils[0]!.enrollmentId;
    const summary = await ports().attendance!.summarize(w.director, { enrollmentId: e, academicYearId: school.seed.yearId });
    expect(summary).toEqual({ openDays: 0, absentDays: 0, justifiedAbsentDays: 0, lateCount: 0 });
    const reg = await ports().attendance!.monthlyRegister(w.director, { classroomId: school.ref.classroomId, month: "2026-10" });
    expect(reg).toEqual({ days: [], rows: [] });
  });

  it("reportcards -> DocumentsPort : natures livrées ; sans clé de signature configurée => échec FERMÉ (aucun faux document) ; périodes publiées vides", async () => {
    const d = ports().documents!;
    await expect(
      d.requestCouncilMinutes(w.director, { minutesId: newId(), deliberationId: newId(), classroomId: school.ref.classroomId, title: "PV", issuedAt: new Date(), content: { schema: 1 }, contentHash: "a".repeat(64), ruleSourceKind: "placeholder" }),
    ).rejects.toMatchObject({ code: "reportcards.signing_key_missing" });
    await expect(d.requestAnnualReview(w.director, { reviewId: newId(), title: "Bilan", issuedAt: new Date(), content: { schema: 1 }, contentHash: "b".repeat(64), ruleSourceKind: null })).rejects.toMatchObject({ code: "reportcards.signing_key_missing" });
    expect(await d.publishedPeriodIds(w.director, { studentId: school.pupils[0]!.studentId, enrollmentId: school.pupils[0]!.enrollmentId })).toEqual([]);
  });
});
