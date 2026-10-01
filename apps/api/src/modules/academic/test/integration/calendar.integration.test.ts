/** US1 (calendrier typé) et US6 (clôture en deux temps, par classe) sur Postgres réel. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequestContext, newId, unwrap } from "@ecoledigitale/kernel";
import {
  applyPeriodPlan,
  archiveAcademicYear,
  closeAcademicYear,
  closeClassroomPeriod,
  closeClassroomPeriodGrading,
  closePeriod,
  closePeriodGrading,
  createAcademicYear,
  createPeriod,
  deletePeriod,
  findYearGaps,
  getAcademicPeriod,
  getAcademicYear,
  getCurrentAcademicYear,
  getEffectivePeriodState,
  listAcademicPeriods,
  listAcademicYears,
  openAcademicYear,
  openPeriod,
  reopenClassroomPeriod,
  reopenPeriod,
  resolvePeriodForDate,
  setCurrentAcademicYear,
  updateAcademicYear,
  updatePeriod,
  classroomAction,
  createClassroom,
  RecordingAudit,
} from "../../index";
import { addDays, inclusiveDays } from "../../domain/dates";
import { adminOne, createAcademicTestDb, describeIntegration, type AcademicTestDb } from "../support/db";
import { applyTemplate, assertEventsValid, codeOf, currentYearDates, eventsOf, makeWorld, seedHigher, type World } from "../support/world";
import { neverBlock, refuseClosure } from "../support/ports";

describeIntegration("calendrier académique et clôtures (Postgres réel)", () => {
  let db: AcademicTestDb;
  beforeAll(async () => {
    db = await createAcademicTestDb();
  });
  afterAll(async () => {
    await db.drop();
  });
  const newWorld = async (ports = {}): Promise<World> => makeWorld(db, await db.createTenant(), { ports });

  describe("années (AC1.1, AC1.2, AC1.5)", () => {
    it("une année couvre douze mois pleins par défaut ; la première année d'un établissement est libre", async () => {
      const w = await newWorld();
      await applyTemplate(w);
      const y = unwrap(await createAcademicYear(w.deps, w.ctx, { institutionId: w.institutionId, code: "2026-2027", label: "2026-2027", startsOn: "2026-09-01" }));
      expect(y).toMatchObject({ startsOn: "2026-09-01", endsOn: "2027-08-31", status: "DRAFT", isCurrent: false });
      expect(unwrap(await getAcademicYear(w.deps, w.ctx, y.id)).id).toBe(y.id);
    });
    it("chevauchement refusé (409 academic.year_overlap) ; trou refusé (409 academic.year_gap) ; années contiguës acceptées avant et après", async () => {
      const w = await newWorld();
      unwrap(await createAcademicYear(w.deps, w.ctx, { institutionId: w.institutionId, code: "A", label: "A", startsOn: "2026-09-01", endsOn: "2027-08-31" }));
      const overlap = await createAcademicYear(w.deps, w.ctx, { institutionId: w.institutionId, code: "B", label: "B", startsOn: "2027-08-31", endsOn: "2028-08-30" });
      expect(codeOf(overlap)).toBe("academic.year_overlap");
      expect(!overlap.ok && overlap.error.httpStatus).toBe(409);
      const gap = await createAcademicYear(w.deps, w.ctx, { institutionId: w.institutionId, code: "C", label: "C", startsOn: "2027-09-05", endsOn: "2028-08-31" });
      expect(codeOf(gap)).toBe("academic.year_gap");
      expect(!gap.ok && gap.error.details).toMatchObject({ gapDays: 4 });
      unwrap(await createAcademicYear(w.deps, w.ctx, { institutionId: w.institutionId, code: "D", label: "D", startsOn: "2027-09-01", endsOn: "2028-08-31" }));
      unwrap(await createAcademicYear(w.deps, w.ctx, { institutionId: w.institutionId, code: "Z", label: "Z", startsOn: "2025-09-01", endsOn: "2026-08-31" })); // avant la première, contiguë
      expect(codeOf(await createAcademicYear(w.deps, w.ctx, { institutionId: w.institutionId, code: "A", label: "A bis", startsOn: "2029-09-01" }))).toBe("academic.year_gap");
      expect(unwrap(await findYearGaps(w.deps, w.ctx))).toEqual([]); // find_year_gaps() renvoie 0 ligne
      // un autre établissement a son propre calendrier
      unwrap(await createAcademicYear(w.deps, w.ctx, { institutionId: newId(), code: "A", label: "A", startsOn: "2026-09-01", endsOn: "2027-08-31" }));
    });
    it("dates inversées et code déjà pris dans l'établissement", async () => {
      const w = await newWorld();
      expect(codeOf(await createAcademicYear(w.deps, w.ctx, { institutionId: w.institutionId, code: "A", label: "A", startsOn: "2026-09-01", endsOn: "2026-09-01" }))).toBe("academic.year_dates_invalid");
      unwrap(await createAcademicYear(w.deps, w.ctx, { institutionId: w.institutionId, code: "A", label: "A", startsOn: "2026-09-01", endsOn: "2027-08-31" }));
      // le même code sur une plage disjointe et contiguë : refusé par l'unicité (code, établissement)
      expect(codeOf(await createAcademicYear(w.deps, w.ctx, { institutionId: w.institutionId, code: "A", label: "A", startsOn: "2027-09-01", endsOn: "2028-08-31" }))).toBe("academic.year_code_taken");
    });
    it("deux années qui se chevauchent créées CONCURREMMENT : une seule est acceptée (contrainte d'exclusion)", async () => {
      const w = await newWorld();
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) => createAcademicYear(w.deps, w.ctx, { institutionId: w.institutionId, code: `K${i}`, label: `K${i}`, startsOn: addDays("2026-09-01", i), endsOn: addDays("2027-08-31", i) })),
      );
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.error.code === "academic.year_overlap")).toBe(true);
    });
    it("modification des dates tant que l'année est brouillon ou ouverte, sans période close", async () => {
      const w = await newWorld();
      await applyTemplate(w);
      const y = unwrap(await createAcademicYear(w.deps, w.ctx, { institutionId: w.institutionId, code: "Y", label: "Y", startsOn: "2026-09-01" }));
      unwrap(await openAcademicYear(w.deps, w.ctx, y.id));
      const periods = unwrap(await applyPeriodPlan(w.deps, w.ctx, y.id, "TWO_SEMESTERS"));
      expect(unwrap(await updateAcademicYear(w.deps, w.ctx, y.id, { label: "Nouveau libellé" })).label).toBe("Nouveau libellé");
      expect(codeOf(await updateAcademicYear(w.deps, w.ctx, y.id, { endsOn: "2027-01-01" }))).toBe("academic.period_outside_year"); // S2 sortirait
      expect(unwrap(await updateAcademicYear(w.deps, w.ctx, y.id, { endsOn: "2027-09-15" })).endsOn).toBe("2027-09-15");
      unwrap(await openPeriod(w.deps, w.ctx, periods[0]!.id));
      unwrap(await closePeriodGrading(w.deps, w.ctx, periods[0]!.id));
      expect(codeOf(await updateAcademicYear(w.deps, w.ctx, y.id, { endsOn: "2027-08-31" }))).toBe("academic.year_not_editable");
      expect(codeOf(await updateAcademicYear(w.deps, w.ctx, y.id, { startsOn: "2027-10-01" }))).toBe("academic.year_dates_invalid");
    });
    it("une seule année courante par établissement : la bascule est atomique ; seule une année OUVERTE peut l'être", async () => {
      const w = await newWorld();
      const a = unwrap(await createAcademicYear(w.deps, w.ctx, { institutionId: w.institutionId, code: "A", label: "A", startsOn: "2026-09-01" }));
      const b = unwrap(await createAcademicYear(w.deps, w.ctx, { institutionId: w.institutionId, code: "B", label: "B", startsOn: "2027-09-01" }));
      expect(codeOf(await setCurrentAcademicYear(w.deps, w.ctx, a.id))).toBe("academic.year_not_open");
      unwrap(await openAcademicYear(w.deps, w.ctx, a.id));
      unwrap(await openAcademicYear(w.deps, w.ctx, b.id));
      expect(codeOf(await getCurrentAcademicYear(w.deps, w.ctx, w.institutionId))).toBe("academic.year_not_found");
      expect(unwrap(await setCurrentAcademicYear(w.deps, w.ctx, a.id)).isCurrent).toBe(true);
      // bascules concurrentes : à la fin, UNE seule année courante
      await Promise.all([setCurrentAcademicYear(w.deps, w.ctx, b.id), setCurrentAcademicYear(w.deps, w.ctx, a.id), setCurrentAcademicYear(w.deps, w.ctx, b.id)]);
      const years = unwrap(await listAcademicYears(w.deps, w.ctx, { institutionId: w.institutionId }));
      expect(years.filter((y) => y.isCurrent)).toHaveLength(1);
      expect(unwrap(await getCurrentAcademicYear(w.deps, w.ctx, w.institutionId)).isCurrent).toBe(true);
      expect(unwrap(await listAcademicYears(w.deps, w.ctx, { institutionId: w.institutionId, status: "DRAFT" }))).toEqual([]);
    });
    it("cycle de vie : DRAFT -> OPEN -> CLOSED -> ARCHIVED, sans raccourci", async () => {
      const w = await newWorld();
      const y = unwrap(await createAcademicYear(w.deps, w.ctx, { institutionId: w.institutionId, code: "A", label: "A", startsOn: "2026-09-01" }));
      expect(codeOf(await closeAcademicYear(w.deps, w.ctx, y.id))).toBe("academic.year_transition");
      expect(codeOf(await archiveAcademicYear(w.deps, w.ctx, y.id))).toBe("academic.year_transition");
      unwrap(await openAcademicYear(w.deps, w.ctx, y.id));
      expect(codeOf(await openAcademicYear(w.deps, w.ctx, y.id))).toBe("academic.year_transition");
      const closed = unwrap(await closeAcademicYear(w.deps, w.ctx, y.id, "fin d'exercice"));
      expect(closed).toMatchObject({ status: "CLOSED", isCurrent: false });
      expect(closed.closedAt).not.toBeNull();
      expect(unwrap(await archiveAcademicYear(w.deps, w.ctx, y.id)).archivedAt).not.toBeNull();
      expect(codeOf(await createPeriod(w.deps, w.ctx, y.id, { periodTypeCode: "TRIMESTER", ordinal: 1, code: "T1", label: "T1", startsOn: "2026-09-01", endsOn: "2026-11-30" }))).toBe("academic.year_not_editable");
    });
    it("hors périmètre : un contexte rattaché à un autre établissement reçoit 404 (jamais 403)", async () => {
      const w = await newWorld();
      const y = unwrap(await createAcademicYear(w.deps, w.ctx, { institutionId: w.institutionId, code: "A", label: "A", startsOn: "2026-09-01" }));
      const outsider = createRequestContext({ tenantId: w.tenantId, userId: newId(), roles: [], institutionId: newId() });
      const r = await getAcademicYear(w.deps, outsider, y.id);
      expect(codeOf(r)).toBe("academic.year_not_found");
      expect(!r.ok && r.error.httpStatus).toBe(404);
      expect(unwrap(await listAcademicYears(w.deps, outsider))).toEqual([]);
      expect(codeOf(await createAcademicYear(w.deps, outsider, { institutionId: w.institutionId, code: "Q", label: "Q", startsOn: "2030-01-01" }))).toBe("academic.institution_not_found");
    });
  });

  describe("périodes typées et plans (AC1.3, AC1.4)", () => {
    it("un plan de trois trimestres crée trois périodes TRIMESTER couvrant exactement l'année, sans trou ni chevauchement", async () => {
      const w = await newWorld();
      await applyTemplate(w);
      const y = unwrap(await createAcademicYear(w.deps, w.ctx, { institutionId: w.institutionId, code: "A", label: "A", startsOn: "2026-09-01" }));
      const periods = unwrap(await applyPeriodPlan(w.deps, w.ctx, y.id, "THREE_TERMS"));
      expect(periods.map((p) => [p.periodTypeCode, p.ordinal, p.code, p.status])).toEqual([
        ["TRIMESTER", 1, "TRIMESTER_1", "PLANNED"],
        ["TRIMESTER", 2, "TRIMESTER_2", "PLANNED"],
        ["TRIMESTER", 3, "TRIMESTER_3", "PLANNED"],
      ]);
      expect(periods[0]!.startsOn).toBe(y.startsOn);
      expect(periods[2]!.endsOn).toBe(y.endsOn);
      expect(addDays(periods[0]!.endsOn, 1)).toBe(periods[1]!.startsOn);
      expect(addDays(periods[1]!.endsOn, 1)).toBe(periods[2]!.startsOn);
      expect(periods.reduce((n, p) => n + inclusiveDays(p.startsOn, p.endsOn), 0)).toBe(inclusiveDays(y.startsOn, y.endsOn));
      expect(unwrap(await listAcademicPeriods(w.deps, w.ctx, y.id))).toHaveLength(3);
      // le plan ne s'applique pas deux fois, et un plan inconnu est introuvable
      expect(codeOf(await applyPeriodPlan(w.deps, w.ctx, y.id, "THREE_TERMS"))).toBe("academic.period_plan_conflict");
      expect(codeOf(await applyPeriodPlan(w.deps, w.ctx, y.id, "NEUF_PERIODES"))).toBe("academic.period_plan_unknown");
    });
    it("deux semestres produisent deux périodes ; les dates restent modifiables tant que PLANNED ou OPEN", async () => {
      const w = await newWorld();
      await applyTemplate(w);
      const y = unwrap(await createAcademicYear(w.deps, w.ctx, { institutionId: w.institutionId, code: "A", label: "A", startsOn: "2026-09-01" }));
      unwrap(await openAcademicYear(w.deps, w.ctx, y.id));
      const [s1, s2] = unwrap(await applyPeriodPlan(w.deps, w.ctx, y.id, "TWO_SEMESTERS"));
      // raccourcir S1 laisse un trou voulu ; l'avancer sur S2 chevauche
      expect(codeOf(await updatePeriod(w.deps, w.ctx, s1!.id, { endsOn: addDays(s2!.startsOn, 5) }))).toBe("academic.period_overlap");
      expect(unwrap(await updatePeriod(w.deps, w.ctx, s1!.id, { endsOn: addDays(s1!.endsOn, -7), label: "Premier semestre" })).label).toBe("Premier semestre");
      unwrap(await openPeriod(w.deps, w.ctx, s1!.id));
      expect(unwrap(await updatePeriod(w.deps, w.ctx, s1!.id, { endsOn: addDays(s1!.endsOn, -3) })).endsOn).toBe(addDays(s1!.endsOn, -3)); // OPEN : encore modifiable
      unwrap(await closePeriodGrading(w.deps, w.ctx, s1!.id));
      expect(codeOf(await updatePeriod(w.deps, w.ctx, s1!.id, { endsOn: addDays(s1!.endsOn, -1) }))).toBe("academic.period_closed_dates");
      expect(unwrap(await updatePeriod(w.deps, w.ctx, s1!.id, { label: "Libellé seul" })).label).toBe("Libellé seul"); // le libellé, lui, reste modifiable
    });
    it("une session se pose sous un semestre ; hors année, hors parent, chevauchement, type inconnu : refusés", async () => {
      const w = await newWorld();
      await applyTemplate(w);
      const y = unwrap(await createAcademicYear(w.deps, w.ctx, { institutionId: w.institutionId, code: "A", label: "A", startsOn: "2026-09-01" }));
      const [s1] = unwrap(await applyPeriodPlan(w.deps, w.ctx, y.id, "TWO_SEMESTERS"));
      const session = unwrap(
        await createPeriod(w.deps, w.ctx, y.id, { periodTypeCode: "NORMAL_SESSION", parentPeriodId: s1!.id, ordinal: 1, code: "SN1", label: "Session normale S1", startsOn: addDays(s1!.endsOn, -20), endsOn: s1!.endsOn }),
      );
      expect(session).toMatchObject({ parentPeriodId: s1!.id, periodTypeCode: "NORMAL_SESSION" });
      const base = { periodTypeCode: "NORMAL_SESSION", ordinal: 2, code: "SN2", label: "x", startsOn: addDays(s1!.endsOn, -10), endsOn: s1!.endsOn };
      expect(codeOf(await createPeriod(w.deps, w.ctx, y.id, { ...base, parentPeriodId: s1!.id }))).toBe("academic.period_overlap");
      expect(codeOf(await createPeriod(w.deps, w.ctx, y.id, { ...base, startsOn: "2020-01-01", endsOn: "2020-02-01" }))).toBe("academic.period_outside_year");
      expect(codeOf(await createPeriod(w.deps, w.ctx, y.id, { ...base, parentPeriodId: s1!.id, startsOn: addDays(s1!.endsOn, 1), endsOn: addDays(s1!.endsOn, 5) }))).toBe("academic.period_outside_parent");
      expect(codeOf(await createPeriod(w.deps, w.ctx, y.id, { ...base, periodTypeCode: "SEMAINE_ROSE", parentPeriodId: s1!.id }))).toBe("academic.period_type_unknown");
      expect(codeOf(await createPeriod(w.deps, w.ctx, y.id, { ...base, parentPeriodId: s1!.id, startsOn: s1!.startsOn, endsOn: addDays(s1!.startsOn, 3), code: "SN1" }))).toBe("academic.period_code_taken");
      expect(codeOf(await createPeriod(w.deps, w.ctx, y.id, { ...base, parentPeriodId: newId() }))).toBe("academic.period_not_found");
    });
    it("suppression : seulement PLANNED et sans sous-période", async () => {
      const w = await newWorld();
      await applyTemplate(w);
      const y = unwrap(await createAcademicYear(w.deps, w.ctx, { institutionId: w.institutionId, code: "A", label: "A", startsOn: "2026-09-01" }));
      unwrap(await openAcademicYear(w.deps, w.ctx, y.id));
      const [s1, s2] = unwrap(await applyPeriodPlan(w.deps, w.ctx, y.id, "TWO_SEMESTERS"));
      unwrap(await createPeriod(w.deps, w.ctx, y.id, { periodTypeCode: "NORMAL_SESSION", parentPeriodId: s2!.id, ordinal: 1, code: "SN", label: "x", startsOn: s2!.startsOn, endsOn: addDays(s2!.startsOn, 5) }));
      expect(codeOf(await deletePeriod(w.deps, w.ctx, s2!.id))).toBe("academic.period_delete_forbidden"); // a une sous-période
      unwrap(await openPeriod(w.deps, w.ctx, s1!.id));
      expect(codeOf(await deletePeriod(w.deps, w.ctx, s1!.id))).toBe("academic.period_delete_forbidden"); // OPEN
      const sub = unwrap(await listAcademicPeriods(w.deps, w.ctx, y.id)).find((p) => p.code === "SN")!;
      unwrap(await deletePeriod(w.deps, w.ctx, sub.id));
      unwrap(await deletePeriod(w.deps, w.ctx, s2!.id));
      expect(codeOf(await getAcademicPeriod(w.deps, w.ctx, s2!.id))).toBe("academic.period_not_found");
    });
    it("resolvePeriodForDate renvoie 0 ou 1 période pour une date et un type ; ambiguë sans type si deux types se superposent", async () => {
      const w = await newWorld();
      await applyTemplate(w);
      const y = unwrap(await createAcademicYear(w.deps, w.ctx, { institutionId: w.institutionId, code: "A", label: "A", startsOn: "2026-09-01" }));
      const [s1, s2] = unwrap(await applyPeriodPlan(w.deps, w.ctx, y.id, "TWO_SEMESTERS"));
      unwrap(await createPeriod(w.deps, w.ctx, y.id, { periodTypeCode: "COMPOSITION", ordinal: 1, code: "C1", label: "Composition 1", startsOn: "2026-10-01", endsOn: "2026-10-15" }));
      const at = async (date: string, type?: string) => unwrap(await resolvePeriodForDate(w.deps, w.ctx, { institutionId: w.institutionId, date, typeCode: type ?? null }));
      expect((await at("2026-09-01", "SEMESTER"))?.id).toBe(s1!.id);
      expect((await at(s2!.startsOn, "SEMESTER"))?.id).toBe(s2!.id);
      expect(await at("2025-01-01", "SEMESTER")).toBeNull();
      expect(await at("2030-01-01")).toBeNull();
      expect((await at("2026-10-05", "COMPOSITION"))?.periodTypeCode).toBe("COMPOSITION");
      expect(codeOf(await resolvePeriodForDate(w.deps, w.ctx, { institutionId: w.institutionId, date: "2026-10-05" }))).toBe("academic.period_ambiguous");
      expect((await at("2027-06-01"))?.id).toBe(s2!.id);
    });
  });

  describe("clôture de période en deux temps (AC6.1, AC6.3)", () => {
    it("PLANNED -> OPEN -> GRADING_CLOSED -> CLOSED, aucun saut, année ouverte exigée", async () => {
      const w = await newWorld();
      await applyTemplate(w);
      const y = unwrap(await createAcademicYear(w.deps, w.ctx, { institutionId: w.institutionId, code: "A", label: "A", startsOn: "2026-09-01" }));
      const [s1] = unwrap(await applyPeriodPlan(w.deps, w.ctx, y.id, "TWO_SEMESTERS"));
      expect(codeOf(await openPeriod(w.deps, w.ctx, s1!.id))).toBe("academic.year_not_open");
      unwrap(await openAcademicYear(w.deps, w.ctx, y.id));
      expect(codeOf(await closePeriodGrading(w.deps, w.ctx, s1!.id))).toBe("academic.period_transition"); // PLANNED
      expect(unwrap(await openPeriod(w.deps, w.ctx, s1!.id)).openedAt).not.toBeNull();
      expect(codeOf(await openPeriod(w.deps, w.ctx, s1!.id))).toBe("academic.period_transition");
      expect(codeOf(await closePeriod(w.deps, w.ctx, s1!.id))).toBe("academic.period_transition"); // pas de saut OPEN -> CLOSED
      const gc = unwrap(await closePeriodGrading(w.deps, w.ctx, s1!.id));
      expect(gc.status).toBe("GRADING_CLOSED");
      expect(gc.gradingClosedAt).not.toBeNull();
      const closed = unwrap(await closePeriod(w.deps, w.ctx, s1!.id));
      expect(closed).toMatchObject({ status: "CLOSED", closedBy: w.ctx.userId });
      expect(closed.closedAt).not.toBeNull();
      expect(codeOf(await closePeriod(w.deps, w.ctx, s1!.id))).toBe("academic.period_transition");
    });
    it("PeriodClosureGuard (011/013) peut refuser la clôture : 409 academic.period_close_refused, rien n'est écrit", async () => {
      const w = await newWorld({ periodGuard: refuseClosure("ASSESS_PENDING", "Des notes ne sont pas toutes publiées.") });
      const s = await seedHigher(w);
      const r = await closePeriodGrading(w.deps, w.ctx, s.periodIds[0]!);
      expect(codeOf(r)).toBe("academic.period_close_refused");
      expect(!r.ok && r.error.details).toMatchObject({ guardCode: "ASSESS_PENDING" });
      expect(unwrap(await getAcademicPeriod(w.deps, w.ctx, s.periodIds[0]!)).status).toBe("OPEN");
      const w2 = await newWorld({ periodGuard: neverBlock });
      const s2 = await seedHigher(w2);
      expect(unwrap(await closePeriodGrading(w2.deps, w2.ctx, s2.periodIds[0]!)).status).toBe("GRADING_CLOSED");
    });
    it("réouverture d'un pas : motif obligatoire, sensible (audit), reopened_count, événement `reopened`", async () => {
      const w = await newWorld();
      const s = await seedHigher(w);
      const p = s.periodIds[0]!;
      expect(codeOf(await reopenPeriod(w.deps, w.ctx, p, "x"))).toBe("academic.enrollment_reason_required");
      unwrap(await closePeriodGrading(w.deps, w.ctx, p));
      unwrap(await closePeriod(w.deps, w.ctx, p));
      const back = unwrap(await reopenPeriod(w.deps, w.ctx, p, "Erreur de saisie découverte au conseil"));
      expect(back).toMatchObject({ status: "GRADING_CLOSED", reopenedCount: 1, closedAt: null });
      const again = unwrap(await reopenPeriod(w.deps, w.ctx, p, "Une note à corriger encore"));
      expect(again).toMatchObject({ status: "OPEN", reopenedCount: 2, gradingClosedAt: null });
      const planned = unwrap(await reopenPeriod(w.deps, w.ctx, p, "Retour en planification"));
      expect(planned.status).toBe("PLANNED");
      expect(codeOf(await reopenPeriod(w.deps, w.ctx, p, "Plus rien à rouvrir"))).toBe("academic.period_transition");
      const audited = (w.audit as RecordingAudit).entries.filter((e) => e.entry.action === "academic.period.reopened");
      expect(audited).toHaveLength(3);
      expect(audited[0]!.entry).toMatchObject({ sensitive: true, reason: "Erreur de saisie découverte au conseil", before: { status: "CLOSED" }, after: { status: "GRADING_CLOSED" } });
      const ev = await eventsOf(w, "academic.period.reopened");
      expect(ev).toHaveLength(3);
      expect(ev[0]!.payload).toMatchObject({ status: "GRADING_CLOSED", previousStatus: "CLOSED", reason: "Erreur de saisie découverte au conseil" });
      await assertEventsValid(w);
    });
  });

  describe("clôture PAR CLASSE (AC6.2, R4)", () => {
    async function twoClasses() {
      const w = await newWorld();
      const s = await seedHigher(w);
      const b = unwrap(
        await createClassroom(w.deps, w.ctx, { institutionId: w.institutionId, academicYearId: s.yearId, programId: s.programId, gradeLevelId: s.gradeLevelId, curriculumVersionId: s.versionId, code: "L1-B", name: "Licence 1 B" }),
      );
      unwrap(await classroomAction(w.deps, w.ctx, b.id, "activate"));
      return { w, s, a: s.classroomId, b: b.id, p: s.periodIds[0]! };
    }
    it("clore la période d'une classe ne clôt PAS celle d'une autre classe", async () => {
      const { w, a, b, p } = await twoClasses();
      const r = unwrap(await closeClassroomPeriodGrading(w.deps, w.ctx, a, p));
      expect(r).toMatchObject({ state: "GRADING_CLOSED", explicit: true });
      expect(unwrap(await getEffectivePeriodState(w.deps, w.ctx, { classroomId: a, periodId: p })).state).toBe("GRADING_CLOSED");
      expect(unwrap(await getEffectivePeriodState(w.deps, w.ctx, { classroomId: b, periodId: p })).state).toBe("OPEN");
      expect(unwrap(await getAcademicPeriod(w.deps, w.ctx, p)).status).toBe("OPEN"); // la période entière reste ouverte
      unwrap(await closeClassroomPeriod(w.deps, w.ctx, a, p));
      expect(unwrap(await getEffectivePeriodState(w.deps, w.ctx, { classroomId: a, periodId: p })).state).toBe("CLOSED");
      expect(codeOf(await closeClassroomPeriod(w.deps, w.ctx, a, p))).toBe("academic.classroom_period_transition");
      expect(codeOf(await closeClassroomPeriod(w.deps, w.ctx, b, p))).toBe("academic.classroom_period_transition"); // il faut d'abord clore les notes
      await assertEventsValid(w);
      expect((await eventsOf(w, "academic.classroom_period.grading_closed"))[0]!.payload).toMatchObject({ classroomId: a, periodId: p });
    });
    it("l'état explicite d'une classe SURCHARGE celui de la période : rouvrir UNE classe après une clôture globale", async () => {
      const { w, a, b, p } = await twoClasses();
      unwrap(await closePeriodGrading(w.deps, w.ctx, p));
      expect(unwrap(await getEffectivePeriodState(w.deps, w.ctx, { classroomId: a, periodId: p })).state).toBe("GRADING_CLOSED");
      expect(unwrap(await getEffectivePeriodState(w.deps, w.ctx, { classroomId: a, periodId: p })).explicit).toBe(false);
      expect(codeOf(await reopenClassroomPeriod(w.deps, w.ctx, a, p, "ok"))).toBe("academic.enrollment_reason_required");
      const reopened = unwrap(await reopenClassroomPeriod(w.deps, w.ctx, a, p, "Rattrapage de saisie pour la classe A"));
      expect(reopened).toMatchObject({ state: "OPEN", explicit: true });
      expect(unwrap(await getEffectivePeriodState(w.deps, w.ctx, { classroomId: b, periodId: p })).state).toBe("GRADING_CLOSED"); // B reste close
      expect(codeOf(await reopenClassroomPeriod(w.deps, w.ctx, a, p, "Déjà ouverte"))).toBe("academic.classroom_period_transition");
      const audited = (w.audit as RecordingAudit).entries.filter((e) => e.entry.action === "academic.classroom_period.reopened");
      expect(audited).toHaveLength(1);
      expect(audited[0]!.entry.sensitive).toBe(true);
    });
    it("clore la période entière aligne en une opération les états explicites des classes", async () => {
      const { w, a, b, p } = await twoClasses();
      unwrap(await closeClassroomPeriodGrading(w.deps, w.ctx, a, p)); // A est déjà aux notes closes
      unwrap(await closePeriodGrading(w.deps, w.ctx, p));
      unwrap(await closePeriod(w.deps, w.ctx, p));
      expect(unwrap(await getEffectivePeriodState(w.deps, w.ctx, { classroomId: a, periodId: p })).state).toBe("CLOSED");
      expect(unwrap(await getEffectivePeriodState(w.deps, w.ctx, { classroomId: b, periodId: p })).state).toBe("CLOSED");
      // une classe rouverte individuellement est ramenée avec la période quand celle-ci recule d'un pas
      unwrap(await reopenPeriod(w.deps, w.ctx, p, "Retour d'un pas pour toute la période"));
      expect(unwrap(await getEffectivePeriodState(w.deps, w.ctx, { classroomId: a, periodId: p })).state).toBe("GRADING_CLOSED");
    });
    it("une classe annulée est ignorée ; une période pas encore ouverte ne se clôt pas ; périodes d'une autre année refusées", async () => {
      const { w, s, a, p } = await twoClasses();
      const cancelled = unwrap(
        await createClassroom(w.deps, w.ctx, { institutionId: w.institutionId, academicYearId: s.yearId, programId: s.programId, gradeLevelId: s.gradeLevelId, code: "L1-X", name: "Licence 1 X" }),
      );
      unwrap(await classroomAction(w.deps, w.ctx, cancelled.id, "cancel", "Classe jamais ouverte"));
      expect(unwrap(await closeClassroomPeriodGrading(w.deps, w.ctx, cancelled.id, p))).toMatchObject({ explicit: false });
      expect(codeOf(await closeClassroomPeriodGrading(w.deps, w.ctx, a, s.periodIds[1]!))).toBe("academic.period_not_open"); // S2 planifiée
      // la période d'une AUTRE année que celle de la classe est refusée
      const next = unwrap(await createAcademicYear(w.deps, w.ctx, { institutionId: w.institutionId, code: "ZZ", label: "ZZ", startsOn: addDays(currentYearDates(w).endsOn, 1) }));
      const [foreign] = unwrap(await applyPeriodPlan(w.deps, w.ctx, next.id, "TWO_SEMESTERS"));
      expect(codeOf(await closeClassroomPeriodGrading(w.deps, w.ctx, a, foreign!.id))).toBe("academic.classroom_period_other_year");
    });
    it("PeriodClosureGuard est aussi consulté pour une clôture par classe", async () => {
      const w = await newWorld({ periodGuard: refuseClosure("PENDING_GRADES", "Notes non publiées pour cette classe.") });
      const s = await seedHigher(w);
      const r = await closeClassroomPeriodGrading(w.deps, w.ctx, s.classroomId, s.periodIds[0]!);
      expect(codeOf(r)).toBe("academic.period_close_refused");
      expect(unwrap(await getEffectivePeriodState(w.deps, w.ctx, { classroomId: s.classroomId, periodId: s.periodIds[0]! })).state).toBe("OPEN");
    });
  });

  describe("clôture d'une année (AC7.4, R5)", () => {
    it("exige des périodes closes et aucune offre vivante ; verrouille les curriculums publiés ; audit sensible ; événements", async () => {
      const w = await newWorld();
      const s = await seedHigher(w);
      const blocked = await closeAcademicYear(w.deps, w.ctx, s.yearId, "fin d'année");
      expect(codeOf(blocked)).toBe("academic.year_close_blocked");
      expect(!blocked.ok && (blocked.error.details?.blockers as string[])[0]).toContain("période");
      for (const p of s.periodIds) {
        if (p === s.periodIds[1]) unwrap(await openPeriod(w.deps, w.ctx, p));
        unwrap(await closePeriodGrading(w.deps, w.ctx, p));
        unwrap(await closePeriod(w.deps, w.ctx, p));
      }
      const closed = unwrap(await closeAcademicYear(w.deps, w.ctx, s.yearId, "fin d'année validée par la direction"));
      expect(closed.status).toBe("CLOSED");
      const version = await adminOne<{ status: string; locked_at: Date | null }>(db, "SELECT status, locked_at FROM academic.curriculum_versions WHERE id = $1", [s.versionId]);
      expect(version.status).toBe("LOCKED");
      expect(version.locked_at).not.toBeNull();
      expect((await eventsOf(w, "academic.curriculum.locked"))[0]!.payload).toMatchObject({ versionId: s.versionId, status: "LOCKED" });
      expect((await eventsOf(w, "academic.year.closed"))[0]!.payload).toMatchObject({ yearId: s.yearId, status: "CLOSED" });
      const audit = (w.audit as RecordingAudit).entries.find((e) => e.entry.action === "academic.year.closed");
      expect(audit?.entry).toMatchObject({ sensitive: true, reason: "fin d'année validée par la direction" });
      await assertEventsValid(w);
    });
  });

  it("l'état de la base : aucun trou d'année après tous ces scénarios (find_year_gaps pour le tenant)", async () => {
    const w = await newWorld();
    unwrap(await createAcademicYear(w.deps, w.ctx, { institutionId: w.institutionId, code: "A", label: "A", startsOn: "2026-09-01" }));
    expect(unwrap(await findYearGaps(w.deps, w.ctx))).toEqual([]);
  });
});
