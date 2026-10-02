/**
 * Primaire et secondaire à N périodes (Phase 4-5) : VRAIES règles fictives du catalogue (`CI-PRIMARY-PLACEHOLDER`,
 * `CI-SECONDARY-PLACEHOLDER`), Postgres réel. On vérifie ce que `results` ORCHESTRE — chaînage `coef-period@1` /
 * `competency-period@1` / `secondary-annual@1`, proposition en quatre codes, cas à examiner, provenance `placeholder`, quorum — et
 * le port d'ÉCRITURE des conseils (décision de passage, distinction, appréciation, séance : tracées, auditées, idempotentes).
 * Les valeurs sont FICTIVES : aucun résultat ne dit ce que dit le règlement.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { computePeriod } from "../../application/compute";
import { markDeliberationHeld, openCouncilDeliberation, publishYearDecision, recordDistinction, writeCouncilAppreciation } from "../../application/council-write";
import { confirmDecisionUseCase, listAppreciationsView, listDecisionsView, updateResultsSettings } from "../../application/governance";
import { closePeriod, deliberatePeriod, lockPeriod } from "../../application/lifecycle";
import { listPromotionOutcomes } from "../../application/promotion";
import type { CompetencyCountersPort, YearFactsPort } from "../../application/ports";
import { evaluateCouncilQuorum } from "../../application/quorum";
import { getEnrollmentResult, getPeriodView, getClassMatrix } from "../../application/reads";
import { getYearResult } from "../../application/year";
import type { ClassStructure, CompetencyCounters, EnrollmentRef, EnrollmentYearFacts, PeriodFacts } from "../../domain/types";
import { adminRows, createResultsTestDb, describeIntegration, type ResultsTestDb } from "../support/db";
import { CAPS_ALL, bind, coefStructure, grade, makeWorld, period, type World } from "../support/world";

const ACTOR = { source: "councils" as const, councilRef: "council-2027-06-class-1" };

class FakeYearFacts implements YearFactsPort {
  readonly facts = new Map<string, EnrollmentYearFacts>();
  async getYearFacts(): Promise<ReadonlyMap<string, EnrollmentYearFacts>> {
    return this.facts;
  }
}
class FakeCounters implements CompetencyCountersPort {
  readonly counters = new Map<string, CompetencyCounters>();
  async getCompetencyCounters(): Promise<ReadonlyMap<string, CompetencyCounters>> {
    return this.counters;
  }
}

describeIntegration("primaire et N périodes (Postgres réel + règles fictives)", () => {
  let db: ResultsTestDb;
  let w: World;
  const yearFacts = new FakeYearFacts();
  const counters = new FakeCounters();

  beforeAll(async () => {
    db = await createResultsTestDb();
    w = await makeWorld(db, { extraPorts: { yearFacts, competencyCounters: counters } });
    await bind(w, "coef-period@1", "CI-PRIMARY-PLACEHOLDER", { effectiveFrom: "2026-09-01" });
    await bind(w, "competency-period@1", "CI-PRIMARY-PLACEHOLDER", { effectiveFrom: "2026-09-01" });
    await bind(w, "secondary-annual@1", "CI-SECONDARY-PLACEHOLDER", { effectiveFrom: "2026-09-01" });
  });
  afterAll(async () => {
    await db.drop();
  });

  const enroll = (classroomId: string, n: number): EnrollmentRef[] => {
    const list = Array.from({ length: n }, () => ({ enrollmentId: newId(), studentId: newId() }));
    for (const e of list) w.roster.entries.push({ ...e, active: true, classroomId });
    return list;
  };
  const ref = (classroomId: string, periodId: string) => ({ classroomId, academicPeriodId: periodId });
  const compute = async (classroomId: string, periodId: string) => unwrap(await computePeriod(w.deps, w.director, ref(classroomId, periodId)));
  const lock = async (classroomId: string, periodId: string) => unwrap(await lockPeriod(w.deps, w.director, { ...ref(classroomId, periodId), caps: CAPS_ALL }));
  const close = async (classroomId: string, periodId: string) => unwrap(await closePeriod(w.deps, w.director, { ...ref(classroomId, periodId), caps: CAPS_ALL }));
  const yearOf = async (e: EnrollmentRef, yearId: string) => unwrap(await getYearResult(w.deps, w.director, { enrollmentId: e.enrollmentId, academicYearId: yearId, caps: CAPS_ALL }));
  const resultOf = async (e: EnrollmentRef, periodId: string) => unwrap(await getEnrollmentResult(w.deps, w.director, { enrollmentId: e.enrollmentId, academicPeriodId: periodId, caps: CAPS_ALL }));
  const setDeliberation = async (required: boolean) => unwrap(await updateResultsSettings(w.deps, w.director, { requireDeliberation: required }));

  // Trois trimestres de l'année 2026-2027 (dates postérieures à l'entrée en vigueur du jeu fictif)
  const periods = (weights: [string, string, string] = ["1", "1", "1"]): [PeriodFacts, PeriodFacts, PeriodFacts] => [
    period(newId(), { rankInYear: 1, countInYear: 3, startsOn: "2026-09-15", endsOn: "2026-12-18", weight: weights[0] }),
    period(newId(), { rankInYear: 2, countInYear: 3, startsOn: "2027-01-05", endsOn: "2027-03-31", weight: weights[1] }),
    period(newId(), { rankInYear: 3, countInYear: 3, isSecondSemester: true, startsOn: "2027-04-10", endsOn: "2027-06-30", weight: weights[2] }),
  ];

  describe("coef-period@1 — trois trimestres, cas à examiner, conseil des maîtres", () => {
    const classroomId = newId();
    const yearId = newId();
    const [t1, t2, t3] = periods();
    let students: EnrollmentRef[];
    let ids: Map<string, string>;
    let stateT3: string;

    beforeAll(async () => {
      const built = coefStructure({ classroomId, yearId, period: t1, subjects: [{ code: "MATH", coef: "2" }, { code: "FR", coef: "1" }] });
      ids = built.ids;
      for (const p of [t1, t2, t3]) w.curriculum.set({ ...built.structure, contractId: "coef-period@1", period: p, yearPeriods: [t1, t2, t3] } as ClassStructure);
      students = enroll(classroomId, 5);
      const [a, b, c, d] = students as [EnrollmentRef, EnrollmentRef, EnrollmentRef, EnrollmentRef];
      const give = (e: EnrollmentRef, math: string, fr: string) => [grade(e.enrollmentId, ids.get("MATH") as string, math), grade(e.enrollmentId, ids.get("FR") as string, fr)];
      // A : 14 ; B : 7 ; C : 10 (au seuil fictif) ; D : 14 mais 25 % de journées d'absence ; E : aucune note
      w.assess.grades = [...give(a, "14", "14"), ...give(b, "7", "7"), ...give(c, "10", "10"), ...give(d, "14", "14")];
      yearFacts.facts.set(a.enrollmentId, { absencesDays: 1, openDays: 100, cycleRepeats: 0 });
      yearFacts.facts.set(b.enrollmentId, { absencesDays: 1, openDays: 100, cycleRepeats: 0 });
      yearFacts.facts.set(c.enrollmentId, { absencesDays: 1, openDays: 100, cycleRepeats: 0 });
      yearFacts.facts.set(d.enrollmentId, { absencesDays: 25, openDays: 100, cycleRepeats: 0 });
      yearFacts.facts.set(students[4]!.enrollmentId, { absencesDays: 0, openDays: 100, cycleRepeats: 0 });
      await setDeliberation(false);
    });

    it("période ordinaire : moyenne, rangs et mention absente (règle optionnelle non définie) ; aucune décision de période", async () => {
      const report = await compute(classroomId, t1.id);
      expect(report).toMatchObject({ computed: 5, created: 5, errors: 0, contractId: "coef-period@1" });
      const a = await resultOf(students[0]!, t1.id);
      expect(a.header).toMatchObject({ status: "DRAFT", contractId: "coef-period@1", ruleSetCode: "CI-PRIMARY-PLACEHOLDER", average: "14", averageDisplay: "14.00", rank: 1, mentionCode: null, decisionCode: null, decisionOutcome: null });
      expect(a.lines.find((l) => l.level === "SUBJECT" && l.curriculumNodeId === ids.get("MATH"))).toMatchObject({ value: "14", rank: 1, coefficient: "2.000" });
      expect(a.lines.some((l) => l.level === "YEAR")).toBe(false);
      expect(a.decisions).toEqual([]);
      // E n'a aucune note : ni moyenne ni rang, jamais 0, jamais d'erreur
      const e = await resultOf(students[4]!, t1.id);
      expect(e.header).toMatchObject({ status: "DRAFT", average: null, rank: null });
      expect(e.header.summary).toMatchObject({ pending: true });
    });

    it("la provenance `placeholder` remonte dans la vue de période (bandeau « règles de démonstration »)", async () => {
      const v = unwrap(await getPeriodView(w.deps, w.director, { ...ref(classroomId, t1.id), caps: CAPS_ALL }));
      expect(v.ruleSourceKind).toBe("placeholder");
      expect(v.state).toMatchObject({ contractId: "coef-period@1", ruleSetCode: "CI-PRIMARY-PLACEHOLDER", ruleVersionNo: 1 });
    });

    it("T1 et T2 se clôturent ; la dernière période porte la moyenne générale annuelle, les cas à examiner et la proposition en quatre codes", async () => {
      await lock(classroomId, t1.id);
      await close(classroomId, t1.id);
      await compute(classroomId, t2.id);
      await lock(classroomId, t2.id);
      await close(classroomId, t2.id);
      await compute(classroomId, t3.id);

      const byCode = new Map<string, { code: string | null; reasons: string[]; mga: string | null; summary: Record<string, unknown> }>();
      for (const [i, s] of students.entries()) {
        const r = await resultOf(s, t3.id);
        const year = r.lines.find((l) => l.level === "YEAR");
        expect(year, `élève ${i}`).toBeDefined();
        byCode.set(String(i), { code: year?.statusCode ?? null, reasons: (year?.outputs.reasons as string[]) ?? [], mga: year?.value ?? null, summary: r.header.summary });
      }
      expect(byCode.get("0")).toMatchObject({ code: "PROMOTED", reasons: [], mga: "14" });
      expect(byCode.get("1")).toMatchObject({ code: "REPEAT", reasons: [], mga: "7" });
      expect(byCode.get("2")).toMatchObject({ code: "COUNCIL_REVIEW", reasons: ["BORDERLINE"], mga: "10" }); // |10 − 10| ≤ marge
      expect(byCode.get("3")).toMatchObject({ code: "COUNCIL_REVIEW", reasons: ["LONG_ABSENCE"], mga: "14" }); // 25 % > 20 %
      expect(byCode.get("4")).toMatchObject({ code: "PENDING", mga: null });
      expect(byCode.get("0")?.summary).toMatchObject({ yearFacts: "AVAILABLE", annual: { average: "14", rank: 1 }, yearDecisionOutcome: "PROMOTED" });
      expect(byCode.get("2")?.summary).toMatchObject({ yearDecisionOutcome: "COUNCIL_REVIEW" });

      const state = unwrap(await getClassMatrix(w.deps, w.director, { ...ref(classroomId, t3.id), caps: CAPS_ALL })).state;
      stateT3 = state.id;
      const decisions = unwrap(await listDecisionsView(w.deps, w.director, { stateId: stateT3, caps: CAPS_ALL }));
      const yearEnd = new Map(decisions.filter((d) => d.kind === "YEAR_END").map((d) => [d.enrollmentId, d]));
      expect(yearEnd.size).toBe(5);
      expect(yearEnd.get(students[2]!.enrollmentId)).toMatchObject({ proposedCode: "COUNCIL_REVIEW", proposedOutcome: "COUNCIL_REVIEW", status: "PROPOSED", scope: "YEAR", origin: "RULE" });
      expect(decisions.every((d) => d.kind !== "COUNCIL")).toBe(true); // pas de décision de période pour ce contrat
    });

    it("« la règle ne tranche pas » n'est JAMAIS une décision finale : refus explicite et aucune confirmation d'office", async () => {
      const decisions = unwrap(await listDecisionsView(w.deps, w.director, { stateId: stateT3, caps: CAPS_ALL }));
      const review = decisions.find((d) => d.enrollmentId === students[2]!.enrollmentId && d.kind === "YEAR_END")!;
      const refused = await confirmDecisionUseCase(w.deps, w.director, { decisionId: review.id, caps: CAPS_ALL });
      expect(refused).toMatchObject({ ok: false, error: { code: "results.decision_not_final" } });
      const refusedExplicit = await confirmDecisionUseCase(w.deps, w.director, { decisionId: review.id, finalCode: "COUNCIL_REVIEW", justification: "Le conseil renvoie le dossier à plus tard.", caps: CAPS_ALL });
      expect(refusedExplicit).toMatchObject({ ok: false, error: { code: "results.decision_not_final" } });
    });

    it("le conseil des maîtres : séance, décisions humaines, distinction, appréciation — tracées et auditées", async () => {
      w.audit.clear();
      const delib = unwrap(await openCouncilDeliberation(w.deps, w.director, { stateId: stateT3, participants: [{ staffId: newId(), role: "HOMEROOM" }], actor: ACTOR }));
      expect(delib).toMatchObject({ kind: "COUNCIL", status: "PLANNED" });
      const held = unwrap(await markDeliberationHeld(w.deps, w.director, { deliberationId: delib.id, heldOn: "2027-06-28", actor: ACTOR }));
      expect(held).toMatchObject({ status: "HELD", heldOn: "2027-06-28" });

      // C (cas limite) : le conseil décide le passage — trancher « la règle ne tranche pas » n'est pas un écart, aucune justification
      const c = unwrap(await publishYearDecision(w.deps, w.director, { stateId: stateT3, enrollmentId: students[2]!.enrollmentId, finalCode: "PROMOTED", deliberationId: delib.id, actor: ACTOR }));
      expect(c).toMatchObject({ status: "CONFIRMED", finalCode: "PROMOTED", finalOutcome: "PROMOTED", proposedCode: "COUNCIL_REVIEW", deliberationId: delib.id, origin: "RULE", councilRef: ACTOR.councilRef });
      // idempotent : même code, même séance ⇒ même décision, aucun événement de plus
      const eventsBefore = (await adminRows<{ n: string }>(db, "SELECT count(*)::text AS n FROM kernel.domain_events WHERE type = 'results.decision.confirmed'"))[0]!.n;
      const again = unwrap(await publishYearDecision(w.deps, w.director, { stateId: stateT3, enrollmentId: students[2]!.enrollmentId, finalCode: "PROMOTED", deliberationId: delib.id, actor: ACTOR }));
      expect(again.id).toBe(c.id);
      expect((await adminRows<{ n: string }>(db, "SELECT count(*)::text AS n FROM kernel.domain_events WHERE type = 'results.decision.confirmed'"))[0]!.n).toBe(eventsBefore);

      // D (absences) : redoublement décidé par le conseil
      const d = unwrap(await publishYearDecision(w.deps, w.director, { stateId: stateT3, enrollmentId: students[3]!.enrollmentId, finalCode: "REPEAT", deliberationId: delib.id, actor: ACTOR }));
      expect(d).toMatchObject({ status: "CONFIRMED", finalCode: "REPEAT" });

      // B : la règle propose REPEAT ; le conseil décide le passage ⇒ écart ⇒ justification obligatoire (R-RES-05)
      const noJustification = await publishYearDecision(w.deps, w.director, { stateId: stateT3, enrollmentId: students[1]!.enrollmentId, finalCode: "PROMOTED", actor: ACTOR });
      expect(noJustification).toMatchObject({ ok: false, error: { code: "results.justification_required" } });
      const b = unwrap(await publishYearDecision(w.deps, w.director, { stateId: stateT3, enrollmentId: students[1]!.enrollmentId, finalCode: "PROMOTED", justification: "Progrès constants au troisième trimestre, avis unanime des maîtres.", actor: ACTOR }));
      expect(b).toMatchObject({ finalCode: "PROMOTED", proposedCode: "REPEAT" });

      // codes refusés : renvoi au conseil, code inconnu du contrat
      expect(await publishYearDecision(w.deps, w.director, { stateId: stateT3, enrollmentId: students[0]!.enrollmentId, finalCode: "COUNCIL_REVIEW", actor: ACTOR })).toMatchObject({ ok: false, error: { code: "results.decision_not_final" } });
      expect(await publishYearDecision(w.deps, w.director, { stateId: stateT3, enrollmentId: students[0]!.enrollmentId, finalCode: "ORIENTED", actor: ACTOR })).toMatchObject({ ok: false, error: { code: "results.invalid_input" } });
      // module ou acte invalide
      expect(await publishYearDecision(w.deps, w.director, { stateId: stateT3, enrollmentId: students[0]!.enrollmentId, finalCode: "PROMOTED", actor: { source: "autre" as never, councilRef: "x" } })).toMatchObject({ ok: false, error: { code: "results.council_write_rejected" } });
      expect(await publishYearDecision(w.deps, w.director, { stateId: stateT3, enrollmentId: students[0]!.enrollmentId, finalCode: "PROMOTED", actor: { source: "councils", councilRef: "" } })).toMatchObject({ ok: false, error: { code: "results.council_write_rejected" } });

      // distinction (décision humaine sans proposition de règle) + appréciation générale du conseil
      const dist = unwrap(await recordDistinction(w.deps, w.director, { stateId: stateT3, enrollmentId: students[0]!.enrollmentId, distinctionCode: "HONOR_ROLL", deliberationId: delib.id, actor: ACTOR }));
      expect(dist).toMatchObject({ kind: "DISTINCTION", origin: "COUNCIL", proposedCode: null, finalCode: "HONOR_ROLL", status: "CONFIRMED", scope: "YEAR", councilRef: ACTOR.councilRef });
      expect(await recordDistinction(w.deps, w.director, { stateId: stateT3, enrollmentId: students[0]!.enrollmentId, distinctionCode: "honor", actor: ACTOR })).toMatchObject({ ok: false, error: { code: "results.invalid_input" } });
      const staff = newId();
      const appreciation = unwrap(await writeCouncilAppreciation(w.deps, w.director, { stateId: stateT3, enrollmentId: students[0]!.enrollmentId, authorStaffId: staff, body: "Élève sérieux, à encourager.", actor: ACTOR }));
      expect(appreciation).toMatchObject({ authorRole: "COUNCIL", curriculumNodeId: null, authorStaffId: staff });
      expect(unwrap(await listAppreciationsView(w.deps, w.director, { stateId: stateT3, enrollmentId: students[0]!.enrollmentId, caps: CAPS_ALL }))).toHaveLength(1);

      // audit : qui, quel module, quel acte — jamais le texte de l'appréciation
      const actions = w.audit.actions();
      expect(actions).toEqual(expect.arrayContaining(["results.deliberation.created", "results.deliberation.held", "results.decision.published_by_council", "results.distinction.recorded_by_council", "results.appreciation.written_by_council"]));
      const published = w.audit.entries.find((e) => e.action === "results.decision.published_by_council");
      expect(published?.metadata).toMatchObject({ source: "councils", councilRef: ACTOR.councilRef });
      expect(JSON.stringify(w.audit.entries)).not.toContain("Élève sérieux");
    });

    it("délibération : les propositions fermes sont confirmées, « la règle ne tranche pas » ne l'est jamais d'office ; la clôture fige tout", async () => {
      // un dossier à examiner non tranché reste PROPOSÉ (E est « en attente » : confirmé tel quel, sans note)
      await lock(classroomId, t3.id);
      unwrap(await deliberatePeriod(w.deps, w.director, { ...ref(classroomId, t3.id), confirmProposed: true, caps: CAPS_ALL }));
      const decisions = unwrap(await listDecisionsView(w.deps, w.director, { stateId: stateT3, caps: CAPS_ALL }));
      const yearEnd = new Map(decisions.filter((d) => d.kind === "YEAR_END").map((d) => [d.enrollmentId, d]));
      expect(yearEnd.get(students[0]!.enrollmentId)).toMatchObject({ status: "CONFIRMED", finalCode: "PROMOTED" });
      expect(yearEnd.get(students[2]!.enrollmentId)).toMatchObject({ status: "CONFIRMED", finalCode: "PROMOTED", origin: "RULE" }); // décidé par le conseil
      expect(yearEnd.get(students[4]!.enrollmentId)).toMatchObject({ status: "CONFIRMED", finalCode: "PENDING" });
      await setDeliberation(true);
      await close(classroomId, t3.id);
      // période close : plus aucune écriture de conseil
      const afterClose = await publishYearDecision(w.deps, w.director, { stateId: stateT3, enrollmentId: students[2]!.enrollmentId, finalCode: "REPEAT", justification: "Tentative de modification après clôture.", actor: ACTOR });
      expect(afterClose).toMatchObject({ ok: false, error: { code: "results.state_closed" } });
    });

    it("l'année : moyenne générale annuelle restituée, décision confirmée lue par academic (passage / redoublement)", async () => {
      const y = await yearOf(students[0]!, yearId);
      expect(y).toMatchObject({ complete: true, contractId: "coef-period@1", average: "14", yearDecisionCode: "PROMOTED", rank: 1, ruleSetCode: "CI-PRIMARY-PLACEHOLDER" });
      const outcomes = new Map(unwrap(await listPromotionOutcomes(w.deps, w.director, { academicYearId: yearId, enrollmentIds: students.map((s) => s.enrollmentId) })).map((o) => [o.enrollmentId, o]));
      expect(outcomes.get(students[0]!.enrollmentId)).toMatchObject({ kind: "ADVANCE", code: "PROMOTED" });
      expect(outcomes.get(students[1]!.enrollmentId)).toMatchObject({ kind: "ADVANCE", code: "PROMOTED" }); // le conseil a tranché contre la proposition
      expect(outcomes.get(students[2]!.enrollmentId)).toMatchObject({ kind: "ADVANCE", code: "PROMOTED" });
      expect(outcomes.get(students[3]!.enrollmentId)).toMatchObject({ kind: "REPEAT", code: "REPEAT" });
      expect(outcomes.has(students[4]!.enrollmentId)).toBe(false); // « en attente » : jamais devinée
    });

    it("reproductibilité : mêmes entrées, même version ⇒ aucune nouvelle version ; les empreintes sont posées", async () => {
      const h = (await resultOf(students[0]!, t2.id)).header;
      expect(h.inputsHash).toMatch(/^[0-9a-f]{64}$/);
      expect(h.outputsHash).toMatch(/^[0-9a-f]{64}$/);
      expect(h.status).toBe("FINAL");
    });
  });

  describe("coef-period@1 — faits d'assiduité indisponibles", () => {
    it("sans port de faits : signalé `UNAVAILABLE`, les cas valent faux, jamais une valeur devinée", async () => {
      const w2 = await makeWorld(db, { extraPorts: {} });
      await bind(w2, "coef-period@1", "CI-PRIMARY-PLACEHOLDER", { effectiveFrom: "2026-09-01" });
      const classroomId = newId();
      const yearId = newId();
      const [t1, t2, t3] = periods();
      const built = coefStructure({ classroomId, yearId, period: t3, subjects: [{ code: "MATH", coef: "1" }] });
      for (const p of [t1, t2, t3]) w2.curriculum.set({ ...built.structure, contractId: "coef-period@1", period: p, yearPeriods: [t1, t2, t3] } as ClassStructure);
      const e: EnrollmentRef = { enrollmentId: newId(), studentId: newId() };
      w2.roster.entries.push({ ...e, active: true, classroomId });
      w2.assess.grades = [grade(e.enrollmentId, built.ids.get("MATH") as string, "15")];
      unwrap(await computePeriod(w2.deps, w2.director, { classroomId, academicPeriodId: t3.id }));
      const r = unwrap(await getEnrollmentResult(w2.deps, w2.director, { enrollmentId: e.enrollmentId, academicPeriodId: t3.id, caps: CAPS_ALL }));
      expect(r.header.summary).toMatchObject({ yearFacts: "UNAVAILABLE" });
      // une seule période notée sur trois ⇒ la règle ne conclut pas (en attente), sans erreur
      expect(r.lines.find((l) => l.level === "YEAR")).toMatchObject({ statusCode: "PENDING", value: "15" });
    });
  });

  describe("competency-period@1 — maternelle, sans note", () => {
    const classroomId = newId();
    const yearId = newId();
    const [t1, t2, t3] = periods();
    let students: EnrollmentRef[];

    beforeAll(() => {
      for (const p of [t1, t2, t3]) {
        const s: ClassStructure = { classroomId, academicYearId: yearId, contractId: "competency-period@1", period: p, firstPeriodId: null, terminalExamRequired: false, nodes: [], yearPeriods: [t1, t2, t3] };
        w.curriculum.set(s);
      }
      students = enroll(classroomId, 2);
      counters.counters.set(students[0]!.enrollmentId, { evaluated: 20, expected: 20 });
      counters.counters.set(students[1]!.enrollmentId, { evaluated: 18, expected: 20 });
      w.assess.grades = [];
    });

    it("hors dernière période : aucune moyenne, aucun rang, aucune décision ; clôture possible", async () => {
      await setDeliberation(false);
      const report = await compute(classroomId, t1.id);
      expect(report).toMatchObject({ computed: 2, errors: 0, contractId: "competency-period@1" });
      const r = await resultOf(students[0]!, t1.id);
      expect(r.header).toMatchObject({ average: null, rank: null, decisionCode: null });
      expect(r.lines.some((l) => l.level === "YEAR")).toBe(false);
      await lock(classroomId, t1.id);
      await close(classroomId, t1.id);
      expect((await resultOf(students[0]!, t1.id)).header.status).toBe("FINAL");
    });

    it("dernière période : à partir des compteurs de compétences — jamais seule : PENDING ou COUNCIL_REVIEW", async () => {
      await compute(classroomId, t2.id);
      await lock(classroomId, t2.id);
      await close(classroomId, t2.id);
      await compute(classroomId, t3.id);
      const a = await resultOf(students[0]!, t3.id);
      const b = await resultOf(students[1]!, t3.id);
      expect(a.lines.find((l) => l.level === "YEAR")).toMatchObject({ statusCode: "COUNCIL_REVIEW", outputs: { competencesEvaluated: 20, competencesExpected: 20 } });
      expect(b.lines.find((l) => l.level === "YEAR")).toMatchObject({ statusCode: "PENDING" });
      const state = unwrap(await getClassMatrix(w.deps, w.director, { ...ref(classroomId, t3.id), caps: CAPS_ALL })).state;
      const decisions = unwrap(await listDecisionsView(w.deps, w.director, { stateId: state.id, caps: CAPS_ALL }));
      expect(decisions.find((d) => d.enrollmentId === students[0]!.enrollmentId)).toMatchObject({ kind: "YEAR_END", proposedCode: "COUNCIL_REVIEW", status: "PROPOSED" });
      // la maternelle : le conseil décide (le contrat ne propose jamais le passage)
      const decided = unwrap(await publishYearDecision(w.deps, w.director, { stateId: state.id, enrollmentId: students[0]!.enrollmentId, finalCode: "PROMOTED", actor: { source: "primary_school", councilRef: "conseil-maternelle-1" } }));
      expect(decided).toMatchObject({ finalCode: "PROMOTED", proposedCode: "COUNCIL_REVIEW", status: "CONFIRMED" });
    });

    it("sans compteurs de compétences à la dernière période : calcul refusé (échec fermé), jamais de décision devinée", async () => {
      const w2 = await makeWorld(db, { extraPorts: {} });
      await bind(w2, "competency-period@1", "CI-PRIMARY-PLACEHOLDER", { effectiveFrom: "2026-09-01" });
      const cid = newId();
      const [, , last] = periods();
      w2.curriculum.set({ classroomId: cid, academicYearId: yearId, contractId: "competency-period@1", period: last, firstPeriodId: null, terminalExamRequired: false, nodes: [], yearPeriods: [last] });
      w2.roster.entries.push({ enrollmentId: newId(), studentId: newId(), active: true, classroomId: cid });
      const r = await computePeriod(w2.deps, w2.director, { classroomId: cid, academicPeriodId: last.id });
      expect(r).toMatchObject({ ok: false, error: { code: "results.curriculum_incomplete" } });
    });
  });

  describe("quorum du conseil des maîtres (règle `quorum_conseil`)", () => {
    const classroomId = newId();
    const yearId = newId();
    const [t1] = periods();

    beforeAll(() => {
      w.curriculum.set({ classroomId, academicYearId: yearId, contractId: "competency-period@1", period: t1, firstPeriodId: null, terminalExamRequired: false, nodes: [], yearPeriods: [t1] });
    });

    it("le seuil est une donnée du jeu de règles : 3 sur 6 atteint, 2 sur 6 non ; provenance remontée", async () => {
      const ok = unwrap(await evaluateCouncilQuorum(w.deps, w.director, { ...{ classroomId, academicPeriodId: t1.id }, convoked: 6, present: 3 }));
      expect(ok).toMatchObject({ reached: true, contractId: "competency-period@1", ruleSourceKind: "placeholder" });
      expect(unwrap(await evaluateCouncilQuorum(w.deps, w.director, { classroomId, academicPeriodId: t1.id, convoked: 6, present: 2 })).reached).toBe(false);
      expect(unwrap(await evaluateCouncilQuorum(w.deps, w.director, { classroomId, academicPeriodId: t1.id, convoked: 0, present: 0 })).reached).toBe(false);
    });

    it("effectifs invalides et contrat sans quorum refusés", async () => {
      expect(await evaluateCouncilQuorum(w.deps, w.director, { classroomId, academicPeriodId: t1.id, convoked: -1, present: 0 })).toMatchObject({ ok: false, error: { code: "results.invalid_input" } });
      const other = newId();
      w.curriculum.set({ classroomId: other, academicYearId: yearId, contractId: "coef-semester@1", period: t1, firstPeriodId: null, terminalExamRequired: false, nodes: [], yearPeriods: [t1] });
      expect(await evaluateCouncilQuorum(w.deps, w.director, { classroomId: other, academicPeriodId: t1.id, convoked: 6, present: 3 })).toMatchObject({ ok: false, error: { code: "results.unsupported_contract" } });
    });
  });

  describe("secondary-annual@1 — N périodes pondérées (secondaire)", () => {
    const classroomId = newId();
    const yearId = newId();
    const [t1, t2, t3] = periods(["1", "1", "2"]);
    let students: EnrollmentRef[];
    let math: string;

    beforeAll(async () => {
      const built = coefStructure({ classroomId, yearId, period: t1, subjects: [{ code: "MATH", coef: "1" }] });
      math = built.ids.get("MATH") as string;
      for (const p of [t1, t2, t3]) w.curriculum.set({ ...built.structure, contractId: "secondary-annual@1", period: p, yearPeriods: [t1, t2, t3] } as ClassStructure);
      students = enroll(classroomId, 2);
      await setDeliberation(false);
    });

    it("trois trimestres de poids 1, 1, 2 : moyenne annuelle (10 + 12 + 2×16)/4 = 13,5, décision sur la dernière période", async () => {
      const [a, b] = students as [EnrollmentRef, EnrollmentRef];
      const marks: Array<[PeriodFacts, string, string | null]> = [[t1, "10", "6"], [t2, "12", null], [t3, "16", "6"]];
      for (const [p, noteA, noteB] of marks) {
        w.assess.grades = [grade(a.enrollmentId, math, noteA), ...(noteB === null ? [] : [grade(b.enrollmentId, math, noteB)])];
        await compute(classroomId, p.id);
        await lock(classroomId, p.id);
        await close(classroomId, p.id);
      }
      const y = await yearOf(a, yearId);
      expect(y).toMatchObject({ complete: true, contractId: "secondary-annual@1", average: "13.5", yearDecisionCode: "PROMOTED", ruleSetCode: "CI-SECONDARY-PLACEHOLDER", rank: 1 });
      // B : trimestre 2 non noté (ignoré, jamais 0) : (6 + 2×6)/3 = 6 ⇒ redoublement proposé
      const yb = await yearOf(b, yearId);
      expect(yb).toMatchObject({ average: "6", yearDecisionCode: "REPEAT", rank: 2 });
      const v = unwrap(await getPeriodView(w.deps, w.director, { ...ref(classroomId, t3.id), caps: CAPS_ALL }));
      expect(v.ruleSourceKind).toBe("placeholder");
      // la période intermédiaire ne porte aucune ligne annuelle
      expect((await resultOf(a, t2.id)).lines.some((l) => l.level === "YEAR")).toBe(false);
    });
  });
});
