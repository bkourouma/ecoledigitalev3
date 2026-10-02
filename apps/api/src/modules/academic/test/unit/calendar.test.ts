import { describe, expect, it } from "vitest";
import {
  alignClassroomStates,
  allocatePeriodPlan,
  canTransitionYear,
  checkPeriodPlacement,
  checkYearPlacement,
  effectivePeriodState,
  gradingIsClosed,
  periodCodeFor,
  periodDatesEditable,
  periodRankInYear,
  periodStateRank,
  periodStep,
  resolvePeriodForDate,
  yearCloseBlockers,
} from "../../domain/calendar";
import { addDays, civilDateOf, compareDates, dateInRange, defaultYearEnd, inclusiveDays, isIsoDate, rangesOverlap } from "../../domain/dates";
import type { AcademicPeriod } from "../../domain/records";

const period = (over: Partial<AcademicPeriod> & Pick<AcademicPeriod, "id">): AcademicPeriod => ({
  academicYearId: "Y",
  parentPeriodId: null,
  periodTypeCode: "TRIMESTER",
  ordinal: 1,
  code: "T1",
  label: "T1",
  startsOn: "2026-09-01",
  endsOn: "2026-12-31",
  status: "PLANNED",
  openedAt: null,
  gradingClosedAt: null,
  closedAt: null,
  closedBy: null,
  reopenedCount: 0,
  ...over,
});

describe("dates civiles", () => {
  it("valide les dates calendaires", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-1-01")).toBe(false);
    expect(isIsoDate(42)).toBe(false);
  });
  it("arithmétique indépendante du fuseau", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(inclusiveDays("2026-09-01", "2026-09-01")).toBe(1);
    expect(inclusiveDays("2026-09-01", "2027-08-31")).toBe(365);
    expect(compareDates("2026-01-01", "2026-01-02")).toBe(-1);
    expect(dateInRange("2026-09-01", "2026-09-01", "2026-09-30")).toBe(true);
    expect(rangesOverlap("2026-01-01", "2026-01-10", "2026-01-10", "2026-01-20")).toBe(true);
    expect(rangesOverlap("2026-01-01", "2026-01-09", "2026-01-10", "2026-01-20")).toBe(false);
  });
  it("une année dure douze mois pleins, y compris à partir d'un 29 février", () => {
    expect(defaultYearEnd("2026-09-01")).toBe("2027-08-31");
    expect(defaultYearEnd("2027-01-01")).toBe("2027-12-31");
    expect(defaultYearEnd("2024-02-29")).toBe("2025-02-28");
    expect(defaultYearEnd("2023-03-01")).toBe("2024-02-29");
  });
  it("date civile d'un instant dans le fuseau de l'établissement", () => {
    const instant = new Date("2026-09-01T23:30:00Z");
    expect(civilDateOf(instant, null)).toBe("2026-09-01");
    expect(civilDateOf(instant, "UTC")).toBe("2026-09-01");
    expect(civilDateOf(instant, "Asia/Tokyo")).toBe("2026-09-02");
    expect(civilDateOf(instant, "America/New_York")).toBe("2026-09-01");
    expect(civilDateOf(instant, "Fuseau/Inconnu")).toBe("2026-09-01");
  });
});

describe("placement d'une année (R1)", () => {
  const existing = [
    { id: "a", startsOn: "2025-09-01", endsOn: "2026-08-31" },
    { id: "c", startsOn: "2027-09-01", endsOn: "2028-08-31" },
  ];
  it("refuse un chevauchement", () => {
    expect(checkYearPlacement({ startsOn: "2026-08-31", endsOn: "2027-08-30" }, existing)).toEqual({ ok: false, code: "overlap", withId: "a" });
  });
  it("refuse un trou avec l'année précédente ou la suivante", () => {
    expect(checkYearPlacement({ startsOn: "2026-09-05", endsOn: "2027-08-31" }, existing)).toMatchObject({ ok: false, code: "gap", side: "previous", gapDays: 4 });
    expect(checkYearPlacement({ startsOn: "2026-09-01", endsOn: "2027-08-20" }, existing)).toMatchObject({ ok: false, code: "gap", side: "next", gapDays: 11 });
  });
  it("accepte une année contiguë (insérée entre deux), la première année, ou une année qui remplace l'actuelle", () => {
    expect(checkYearPlacement({ startsOn: "2026-09-01", endsOn: "2027-08-31" }, existing)).toEqual({ ok: true });
    expect(checkYearPlacement({ startsOn: "2020-01-01", endsOn: "2020-12-31" }, [])).toEqual({ ok: true });
    // modifier une année en l'ignorant elle-même : ses propres dates ne la gênent pas
    const contiguous = [...existing, { id: "b", startsOn: "2026-09-01", endsOn: "2027-08-31" }];
    expect(checkYearPlacement({ startsOn: "2026-09-01", endsOn: "2027-08-31" }, contiguous, "b")).toEqual({ ok: true });
    expect(checkYearPlacement({ startsOn: "2026-09-01", endsOn: "2027-08-31" }, contiguous)).toMatchObject({ ok: false, code: "overlap", withId: "b" });
  });
  it("cycle de vie : DRAFT -> OPEN -> CLOSED -> ARCHIVED, rien d'autre", () => {
    expect(canTransitionYear("DRAFT", "OPEN")).toBe(true);
    expect(canTransitionYear("OPEN", "CLOSED")).toBe(true);
    expect(canTransitionYear("CLOSED", "ARCHIVED")).toBe(true);
    expect(canTransitionYear("DRAFT", "CLOSED")).toBe(false);
    expect(canTransitionYear("CLOSED", "OPEN")).toBe(false);
    expect(canTransitionYear("ARCHIVED", "OPEN")).toBe(false);
  });
  it("clôture d'une année : périodes closes et aucune offre vivante (R5, AC7.4)", () => {
    expect(yearCloseBlockers({ periods: [{ code: "S1", status: "CLOSED" }], liveOfferings: 0 })).toEqual([]);
    expect(yearCloseBlockers({ periods: [], liveOfferings: 0 })).toEqual([]);
    const blockers = yearCloseBlockers({ periods: [{ code: "S1", status: "CLOSED" }, { code: "S2", status: "OPEN" }], liveOfferings: 2 });
    expect(blockers).toHaveLength(2);
    expect(blockers[0]).toContain("S2");
  });
});

describe("plan de périodes (AC1.3)", () => {
  const slots = (n: number, weights?: number[]) => Array.from({ length: n }, (_, i) => ({ type: "TRIMESTER", ordinal: i + 1, label: `P${i + 1}`, ...(weights ? { weight: weights[i] as number } : {}) }));
  const covers = (periods: Array<{ startsOn: string; endsOn: string }>, start: string, end: string): void => {
    expect(periods[0]?.startsOn).toBe(start);
    expect(periods[periods.length - 1]?.endsOn).toBe(end);
    for (let i = 1; i < periods.length; i += 1) expect(addDays((periods[i - 1] as { endsOn: string }).endsOn, 1)).toBe((periods[i] as { startsOn: string }).startsOn);
  };
  it("trois parts sur 365 jours : contiguës, sans trou ni chevauchement, couvrant exactement l'année", () => {
    const r = allocatePeriodPlan("2026-09-01", "2027-08-31", slots(3));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    covers(r.periods, "2026-09-01", "2027-08-31");
    expect(r.periods.map((p) => inclusiveDays(p.startsOn, p.endsOn))).toEqual([121, 122, 122]);
    expect(r.periods.reduce((n, p) => n + inclusiveDays(p.startsOn, p.endsOn), 0)).toBe(365);
  });
  it("deux parts égales ; année bissextile ; une seule part", () => {
    const two = allocatePeriodPlan("2027-09-01", "2028-08-31", slots(2));
    expect(two.ok && two.periods.map((p) => inclusiveDays(p.startsOn, p.endsOn))).toEqual([183, 183]);
    const one = allocatePeriodPlan("2026-09-01", "2027-08-31", slots(1));
    expect(one.ok && one.periods[0]).toMatchObject({ startsOn: "2026-09-01", endsOn: "2027-08-31" });
  });
  it("poids relatifs", () => {
    const r = allocatePeriodPlan("2026-01-01", "2026-12-31", slots(2, [1, 3]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.periods.map((p) => inclusiveDays(p.startsOn, p.endsOn))).toEqual([91, 274]);
    covers(r.periods, "2026-01-01", "2026-12-31");
  });
  it("poids de MOYENNE d'un créneau (`averageWeight`) : copié sur la période, distinct du poids de répartition des dates ; défaut 1", () => {
    const plain = allocatePeriodPlan("2026-09-01", "2027-08-31", slots(3));
    expect(plain.ok && plain.periods.map((p) => p.averageWeight)).toEqual([1, 1, 1]);
    const weighted = allocatePeriodPlan("2026-09-01", "2027-08-31", slots(3).map((s, i) => ({ ...s, averageWeight: [1, 2, 3][i] as number })));
    expect(weighted.ok && weighted.periods.map((p) => p.averageWeight)).toEqual([1, 2, 3]);
    // les dates restent réparties à parts égales : le poids de moyenne ne déplace aucune date
    expect(weighted.ok && plain.ok && weighted.periods.map((p) => p.startsOn)).toEqual(plain.ok ? plain.periods.map((p) => p.startsOn) : []);
  });
  it("refuse un plan impossible", () => {
    expect(allocatePeriodPlan("2026-01-01", "2026-01-02", slots(3)).ok).toBe(false);
    expect(allocatePeriodPlan("2026-01-01", "2026-12-31", []).ok).toBe(false);
    expect(allocatePeriodPlan("2026-01-01", "2026-12-31", [slots(1)[0] as never, slots(1)[0] as never]).ok).toBe(false);
    expect(allocatePeriodPlan("2026-01-01", "2026-01-10", slots(2, [1, 1000])).ok).toBe(false);
  });
  it("le code d'une période vient du type et du numéro, jamais d'un libellé", () => {
    expect(periodCodeFor("TRIMESTER", 2)).toBe("TRIMESTER_2");
  });
});

describe("états de période (R3, R4)", () => {
  it("un seul pas en avant ou en arrière", () => {
    expect(periodStep("PLANNED", "OPEN")).toBe("forward");
    expect(periodStep("OPEN", "GRADING_CLOSED")).toBe("forward");
    expect(periodStep("GRADING_CLOSED", "CLOSED")).toBe("forward");
    expect(periodStep("CLOSED", "GRADING_CLOSED")).toBe("backward");
    expect(periodStep("OPEN", "OPEN")).toBe("same");
    expect(periodStep("PLANNED", "CLOSED")).toBe("illegal");
    expect(periodStep("CLOSED", "OPEN")).toBe("illegal");
  });
  it("dates modifiables tant que PLANNED ou OPEN", () => {
    expect(periodDatesEditable("PLANNED")).toBe(true);
    expect(periodDatesEditable("OPEN")).toBe(true);
    expect(periodDatesEditable("GRADING_CLOSED")).toBe(false);
    expect(periodDatesEditable("CLOSED")).toBe(false);
  });
  it("l'état explicite de la classe SURCHARGE celui de la période, dans les deux sens", () => {
    expect(effectivePeriodState("OPEN", null)).toBe("OPEN");
    expect(effectivePeriodState("OPEN", "CLOSED")).toBe("CLOSED");
    expect(effectivePeriodState("CLOSED", "OPEN")).toBe("OPEN");
    expect(effectivePeriodState("CLOSED", undefined)).toBe("CLOSED");
  });
  it("la saisie est arrêtée dès GRADING_CLOSED", () => {
    expect(gradingIsClosed("OPEN")).toBe(false);
    expect(gradingIsClosed("PLANNED")).toBe(false);
    expect(gradingIsClosed("GRADING_CLOSED")).toBe(true);
    expect(gradingIsClosed("CLOSED")).toBe(true);
    expect(periodStateRank("CLOSED")).toBeGreaterThan(periodStateRank("OPEN"));
  });
  it("clore la période entière aligne pas à pas les états explicites des classes", () => {
    const explicit = [
      { classroomId: "a", status: "OPEN" as const },
      { classroomId: "b", status: "GRADING_CLOSED" as const },
      { classroomId: "c", status: "CLOSED" as const },
    ];
    expect(alignClassroomStates("GRADING_CLOSED", explicit, "close")).toEqual([{ classroomId: "a", steps: ["GRADING_CLOSED"] }]);
    expect(alignClassroomStates("CLOSED", explicit, "close")).toEqual([
      { classroomId: "a", steps: ["GRADING_CLOSED", "CLOSED"] },
      { classroomId: "b", steps: ["CLOSED"] },
    ]);
    expect(alignClassroomStates("GRADING_CLOSED", explicit, "reopen")).toEqual([{ classroomId: "c", steps: ["GRADING_CLOSED"] }]);
    expect(alignClassroomStates("PLANNED", explicit, "reopen")).toEqual([]);
  });
});

describe("placement d'une période", () => {
  const year = { id: "Y", startsOn: "2026-09-01", endsOn: "2027-08-31" };
  const base = { periodTypeCode: "SEMESTER", ordinal: 1, code: "S1", startsOn: "2026-09-01", endsOn: "2027-01-31", year, parent: null, siblings: [], yearCodes: [] };
  it("refuse une période hors de son année, hors de son parent, ou à l'envers", () => {
    expect(checkPeriodPlacement({ ...base, endsOn: "2027-09-01" })).toBe("outside_year");
    expect(checkPeriodPlacement({ ...base, startsOn: "2026-08-31" })).toBe("outside_year");
    expect(checkPeriodPlacement({ ...base, startsOn: "2027-01-02", endsOn: "2027-01-01" })).toBe("dates_invalid");
    const parent = period({ id: "P", academicYearId: "Y", startsOn: "2026-09-01", endsOn: "2027-01-31" });
    expect(checkPeriodPlacement({ ...base, periodTypeCode: "NORMAL_SESSION", code: "N1", parent, startsOn: "2027-01-15", endsOn: "2027-02-10" })).toBe("outside_parent");
    expect(checkPeriodPlacement({ ...base, periodTypeCode: "NORMAL_SESSION", code: "N1", parent: { ...parent, academicYearId: "AUTRE" } })).toBe("parent_other_year");
    expect(checkPeriodPlacement({ ...base, parent, parentDepth: 2 })).toBe("too_deep");
  });
  it("une session peut se poser sous un semestre ; les sœurs de même type ne se chevauchent pas", () => {
    const parent = period({ id: "P", academicYearId: "Y", periodTypeCode: "SEMESTER", startsOn: "2026-09-01", endsOn: "2027-01-31" });
    expect(checkPeriodPlacement({ ...base, periodTypeCode: "NORMAL_SESSION", code: "N1", parent, startsOn: "2027-01-10", endsOn: "2027-01-25" })).toBeNull();
    const sibling = period({ id: "S", periodTypeCode: "SEMESTER", ordinal: 1, startsOn: "2026-09-01", endsOn: "2027-01-31" });
    expect(checkPeriodPlacement({ ...base, ordinal: 2, code: "S2", startsOn: "2027-01-31", endsOn: "2027-08-31", siblings: [sibling] })).toBe("overlap");
    expect(checkPeriodPlacement({ ...base, siblings: [sibling] })).toBe("ordinal_taken");
    expect(checkPeriodPlacement({ ...base, ordinal: 2, code: "S2", startsOn: "2027-02-01", endsOn: "2027-08-31", siblings: [sibling] })).toBeNull();
    // un type différent ne gêne pas (composition et trimestre peuvent se superposer)
    expect(checkPeriodPlacement({ ...base, periodTypeCode: "COMPOSITION", code: "C1", siblings: [sibling] })).toBeNull();
    expect(checkPeriodPlacement({ ...base, ordinal: 2, code: "SX", startsOn: "2027-02-01", endsOn: "2027-08-31", yearCodes: [{ id: "z", code: "SX" }] })).toBe("code_taken");
    expect(checkPeriodPlacement({ ...base, ordinal: 2, code: "SX", startsOn: "2027-02-01", endsOn: "2027-08-31", yearCodes: [{ id: "z", code: "SX" }], ignoreId: "z" })).toBeNull();
  });
});

describe("résolution d'une période pour une date (AC1.5)", () => {
  const s1 = period({ id: "S1", periodTypeCode: "SEMESTER", ordinal: 1, code: "S1", startsOn: "2026-09-01", endsOn: "2027-01-31" });
  const s2 = period({ id: "S2", periodTypeCode: "SEMESTER", ordinal: 2, code: "S2", startsOn: "2027-02-01", endsOn: "2027-08-31" });
  const n1 = period({ id: "N1", periodTypeCode: "NORMAL_SESSION", ordinal: 1, code: "N1", parentPeriodId: "S1", startsOn: "2027-01-10", endsOn: "2027-01-25" });
  const comp = period({ id: "C1", periodTypeCode: "COMPOSITION", ordinal: 1, code: "C1", startsOn: "2026-10-01", endsOn: "2026-10-15" });
  const all = [s1, s2, n1, comp];
  it("0 ou 1 période pour une date et un type", () => {
    expect(resolvePeriodForDate(all, "2026-09-01", "SEMESTER")).toMatchObject({ kind: "found", period: { id: "S1" } });
    expect(resolvePeriodForDate(all, "2027-01-31", "SEMESTER")).toMatchObject({ kind: "found", period: { id: "S1" } });
    expect(resolvePeriodForDate(all, "2027-02-01", "SEMESTER")).toMatchObject({ kind: "found", period: { id: "S2" } });
    expect(resolvePeriodForDate(all, "2025-01-01", "SEMESTER")).toEqual({ kind: "none" });
    expect(resolvePeriodForDate(all, "2027-01-15", "NORMAL_SESSION")).toMatchObject({ kind: "found", period: { id: "N1" } });
  });
  it("sans type : la plus profonde ; ambiguë si deux types se superposent à la même profondeur", () => {
    expect(resolvePeriodForDate(all, "2027-01-15")).toMatchObject({ kind: "found", period: { id: "N1" } });
    expect(resolvePeriodForDate(all, "2027-03-01")).toMatchObject({ kind: "found", period: { id: "S2" } });
    const amb = resolvePeriodForDate(all, "2026-10-05");
    expect(amb.kind).toBe("ambiguous");
  });
  it("rang parmi les périodes sœurs de même type : fait pour les RuleSets", () => {
    expect(periodRankInYear(s2, all)).toEqual({ rank: 2, count: 2, isLast: true });
    expect(periodRankInYear(s1, all)).toEqual({ rank: 1, count: 2, isLast: false });
    expect(periodRankInYear(n1, all)).toEqual({ rank: 1, count: 1, isLast: true });
  });
});
