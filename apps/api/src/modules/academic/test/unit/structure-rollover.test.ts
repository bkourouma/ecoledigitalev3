/** Reconduction annuelle : planificateurs PURS de la structure (périodes, jours fériés, classes, offres). */
import { describe, expect, it } from "vitest";
import {
  classroomCodeKey,
  planClassrooms,
  planHolidays,
  planPeriods,
  shiftDate,
  shiftInstant,
  shiftOffering,
  shiftYears,
  type SourceClassroom,
  type SourcePeriod,
} from "../../domain/structure-rollover";

const from = { startsOn: "2025-09-01", endsOn: "2026-08-31" };
const to = { startsOn: "2026-09-01", endsOn: "2027-08-31" };

describe("décalage de dates", () => {
  it("décale d'un nombre entier d'années quand les deux années commencent le même jour civil", () => {
    expect(shiftDate("2026-01-05", from.startsOn, to.startsOn)).toBe("2027-01-05");
    expect(shiftDate("2025-12-25", from.startsOn, to.startsOn)).toBe("2026-12-25");
  });

  it("décale du nombre de jours qui sépare les débuts sinon", () => {
    expect(shiftDate("2025-10-01", "2025-09-01", "2026-09-15")).toBe("2026-10-15");
  });

  it("le 29 février d'une année non bissextile devient le 28", () => {
    expect(shiftYears("2024-02-29", 1)).toBe("2025-02-28");
    expect(shiftYears("2024-02-29", 4)).toBe("2028-02-29");
  });

  it("conserve l'heure d'un instant", () => {
    expect(shiftInstant("2025-08-15T08:30:00.000Z", from.startsOn, to.startsOn)).toBe("2026-08-15T08:30:00.000Z");
  });
});

describe("planPeriods", () => {
  const src = (id: string, code: string, type: string, ordinal: number, startsOn: string, endsOn: string, parent: string | null = null): SourcePeriod => ({
    id,
    parentPeriodId: parent,
    periodTypeCode: type,
    ordinal,
    code,
    label: `Libellé ${code}`,
    startsOn,
    endsOn,
  });
  const periods = [
    src("s2", "S2", "SEMESTER", 2, "2026-02-01", "2026-08-31"),
    src("s1", "S1", "SEMESTER", 1, "2025-09-01", "2026-01-31"),
    src("n1", "S1-N", "NORMAL_SESSION", 1, "2026-01-10", "2026-01-31", "s1"),
  ];

  it("reporte les périodes (parents d'abord), mêmes types, numéros et libellés", () => {
    const plan = planPeriods(periods, from, to, []);
    expect(plan.toCreate.map((p) => [p.code, p.parentCode, p.startsOn, p.endsOn])).toEqual([
      ["S1", null, "2026-09-01", "2027-01-31"],
      ["S2", null, "2027-02-01", "2027-08-31"],
      ["S1-N", "S1", "2027-01-10", "2027-01-31"],
    ]);
    expect(plan.existing).toBe(0);
    expect(plan.dropped).toEqual([]);
  });

  it("est rejouable : une période déjà présente (code, ou type + numéro + parent) est comptée, jamais recréée", () => {
    const plan = planPeriods(periods, from, to, [
      { code: "S1", periodTypeCode: "SEMESTER", ordinal: 1, parentCode: null },
      { code: "AUTRE", periodTypeCode: "SEMESTER", ordinal: 2, parentCode: null },
    ]);
    expect(plan.existing).toBe(2);
    expect(plan.toCreate.map((p) => p.code)).toEqual(["S1-N"]);
  });

  it("borne les dates à l'année cible", () => {
    const longer = [src("a", "A", "SEMESTER", 1, "2025-09-01", "2026-08-31")];
    const plan = planPeriods(longer, from, { startsOn: "2026-09-01", endsOn: "2027-06-30" }, []);
    expect(plan.toCreate[0]).toMatchObject({ startsOn: "2026-09-01", endsOn: "2027-06-30", clamped: true });
  });
});

describe("planHolidays", () => {
  const fixed = { label: "Fête du travail", kind: "HOLIDAY" as const, startsOn: "2026-05-01", endsOn: "2026-05-01", recursYearly: true, blocksTeaching: true };
  const movable = { label: "Lundi de Pâques", kind: "HOLIDAY" as const, startsOn: "2026-04-06", endsOn: "2026-04-06", recursYearly: false, blocksTeaching: true };
  const outside = { label: "Hors année", kind: "HOLIDAY" as const, startsOn: "2024-05-01", endsOn: "2024-05-01", recursYearly: true, blocksTeaching: true };

  it("ne reporte que les jours à date fixe ; compte les autres (à ressaisir) et ignore ceux hors de l'année source", () => {
    const plan = planHolidays([fixed, movable, outside], from, to, []);
    expect(plan.toCreate).toEqual([{ ...fixed, startsOn: "2027-05-01", endsOn: "2027-05-01" }]);
    expect(plan.notRecurring).toBe(1);
    expect(plan.existing).toBe(0);
  });

  it("est rejouable", () => {
    const again = planHolidays([fixed], from, to, [{ ...fixed, startsOn: "2027-05-01", endsOn: "2027-05-01" }]);
    expect(again.toCreate).toEqual([]);
    expect(again.existing).toBe(1);
  });
});

describe("planClassrooms", () => {
  const c = (id: string, code: string, status = "ACTIVE", program = "p1", grade = "g1"): SourceClassroom => ({
    id,
    programId: program,
    gradeLevelId: grade,
    kind: "CLASS",
    code,
    name: `Classe ${code}`,
    capacity: 40,
    capacityIsHard: true,
    campusId: null,
    startsOn: null,
    endsOn: null,
    status,
  });

  it("reconduit les classes vivantes, jamais une classe annulée ou archivée", () => {
    const plan = planClassrooms([c("1", "A"), c("2", "B", "CANCELLED"), c("3", "C", "ARCHIVED"), c("4", "D", "COMPLETED")], from, to, [], null);
    expect(plan.toCreate.map((x) => x.code)).toEqual(["A", "D"]);
  });

  it("l'unicité est (programme, niveau, code) : un même code dans un autre programme n'est pas un doublon", () => {
    const plan = planClassrooms([c("1", "A", "ACTIVE", "p1"), c("2", "A", "ACTIVE", "p2")], from, to, [{ programId: "p1", gradeLevelId: "g1", code: "A", name: "Classe A" }], null);
    expect(plan.existing).toBe(1);
    expect(plan.toCreate.map((x) => x.programId)).toEqual(["p2"]);
    expect(classroomCodeKey({ programId: "p1", gradeLevelId: "g1", code: "A" })).not.toBe(classroomCodeKey({ programId: "p2", gradeLevelId: "g1", code: "A" }));
  });

  it("respecte le filtre de classes sources", () => {
    const plan = planClassrooms([c("1", "A"), c("2", "B")], from, to, [], new Set(["2"]));
    expect(plan.toCreate.map((x) => x.code)).toEqual(["B"]);
  });
});

describe("shiftOffering", () => {
  it("décale les dates et la fenêtre d'inscription, conserve libellé et capacité", () => {
    const r = shiftOffering(
      { label: "ECUE", startsOn: "2025-10-01", endsOn: "2026-01-31", registrationOpensAt: "2025-09-01T00:00:00.000Z", registrationClosesAt: "2025-09-30T23:59:00.000Z", capacity: 30 },
      from,
      to,
    );
    expect(r).toMatchObject({ label: "ECUE", startsOn: "2026-10-01", endsOn: "2027-01-31", registrationOpensAt: "2026-09-01T00:00:00.000Z", registrationClosesAt: "2026-09-30T23:59:00.000Z", capacity: 30, clamped: false });
  });

  it("refuse une offre qui ne tient pas dans l'année cible", () => {
    expect(shiftOffering({ label: "X", startsOn: "2026-08-01", endsOn: "2026-08-31", registrationOpensAt: null, registrationClosesAt: null, capacity: null }, from, { startsOn: "2026-09-01", endsOn: "2026-09-30" })).toBeNull();
  });
});
