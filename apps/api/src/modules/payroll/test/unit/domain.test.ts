/** Calendrier, payabilité, tarifs, machine d'états, snapshot : règles pures. */
import { describe, expect, it } from "vitest";
import { Money } from "@ecoledigitale/kernel";
import {
  addDays,
  calendarDaysBetween,
  daysInMonth,
  intersect,
  isIsoDate,
  isoWeekday,
  isWorkingDay,
  monthsBetween,
  timeToMinutes,
  weekStart,
  workingDaysBetween,
  workingDaysInMonth,
} from "../../domain/calendar";
import { collectPayable, isPayable, payabilityBlockers, retainedMinutes, toPayable } from "../../domain/payability";
import { RateIndex, resolveRate, type HourlyRateRule } from "../../domain/rates";
import { LEGAL_TRANSITIONS, canTransition, holdsClaims, isFrozen, isTerminal, requiresOwnerApproval, separationOfDutiesAllows } from "../../domain/state";
import { canonicalJson } from "../../domain/snapshot";
import { PAYSLIP_STATUSES, type PayslipStatus } from "../../domain/types";
import { fact, uuid, xof, STAFF } from "../support/builders";

describe("calendrier (dates, jamais d'instants)", () => {
  it("valide les dates, y compris les bissextiles", () => {
    expect(isIsoDate("2026-01-31")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-1-1")).toBe(false);
    expect(isIsoDate(20260101 as unknown)).toBe(false);
  });

  it("jour de la semaine ISO et lundi de la semaine, sans dépendre du fuseau", () => {
    expect(isoWeekday("2026-01-05")).toBe(1); // lundi
    expect(isoWeekday("2026-01-11")).toBe(7); // dimanche
    expect(weekStart("2026-01-11")).toBe("2026-01-05");
    expect(weekStart("2026-01-12")).toBe("2026-01-12");
    expect(weekStart("2026-01-01")).toBe("2025-12-29"); // jeudi → lundi de l'année précédente
    expect(isWorkingDay("2026-01-09")).toBe(true);
    expect(isWorkingDay("2026-01-10")).toBe(false);
  });

  it("jours ouvrés d'un mois (lundi-vendredi)", () => {
    expect(workingDaysInMonth("2026-01")).toBe(22);
    expect(workingDaysInMonth("2026-02")).toBe(20);
    expect(workingDaysInMonth("2026-03")).toBe(22);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(workingDaysBetween("2026-01-05", "2026-01-31")).toHaveLength(20);
    expect(workingDaysBetween("2026-01-10", "2026-01-11")).toEqual([]);
  });

  it("mois touchés, jours civils, intersection, arithmétique de dates", () => {
    expect(monthsBetween("2025-11-20", "2026-02-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(monthsBetween("2026-02-02", "2026-01-01")).toEqual([]);
    expect(calendarDaysBetween("2026-01-05", "2026-01-31")).toBe(27);
    expect(calendarDaysBetween("2026-02-01", "2026-01-31")).toBe(0);
    expect(intersect({ from: "2026-01-01", to: "2026-01-10" }, { from: "2026-01-05", to: "2026-01-31" })).toEqual({ from: "2026-01-05", to: "2026-01-10" });
    expect(intersect({ from: "2026-01-01", to: "2026-01-04" }, { from: "2026-01-05", to: "2026-01-31" })).toBeNull();
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
  });

  it("heures murales", () => {
    expect(timeToMinutes("08:30")).toBe(510);
    expect(timeToMinutes("24:00")).toBeNull();
    expect(timeToMinutes(null)).toBeNull();
    expect(timeToMinutes("8:30")).toBeNull();
  });
});

describe("prédicat de payabilité : réalisée ∧ validée ∧ enseignant ∧ durée", () => {
  it("une séance réalisée, validée, avec enseignant et horaires est payable ; durée = fin − début", () => {
    const f = fact({ startTime: "08:00", endTime: "10:30" });
    expect(isPayable(f)).toBe(true);
    expect(toPayable(f)?.minutes).toBe(150);
  });

  it("T4 — planifiée/annulée, non validée, sans enseignant ou sans durée : AUCUN montant", () => {
    expect(payabilityBlockers(fact({ realized: false }))).toEqual(["NOT_REALIZED"]);
    expect(payabilityBlockers(fact({ validated: false }))).toEqual(["NOT_VALIDATED"]);
    expect(payabilityBlockers(fact({ staffId: null }))).toEqual(["NO_STAFF"]);
    expect(payabilityBlockers(fact({ startTime: null, endTime: null }))).toEqual(["NO_DURATION"]);
    expect(payabilityBlockers(fact({ startTime: "10:00", endTime: "08:00" }))).toEqual(["NO_DURATION"]);
    expect(payabilityBlockers(fact({ startTime: "08:00", endTime: "08:00" }))).toEqual(["NO_DURATION"]);
    expect(payabilityBlockers(fact({ date: "2026-02-30" }))).toContain("INVALID_DATE");
    expect(toPayable(fact({ realized: false }))).toBeNull();
  });

  it("AC1.5 — la dérogation l'emporte sur les horaires, sans les modifier ; durée explicite des présences", () => {
    const f = fact({ startTime: "08:00", endTime: "10:00", paidMinutesOverride: 150 });
    expect(retainedMinutes(f)).toBe(150);
    expect(f.startTime).toBe("08:00");
    expect(retainedMinutes(fact({ startTime: null, endTime: null, paidMinutesOverride: 180 }))).toBe(180); // volume comptable sans horaires
    expect(retainedMinutes(fact({ kind: "ATTENDANCE", startTime: null, endTime: null, durationMinutes: 120 }))).toBe(120);
  });

  it("bornes : entier de 1 à 1 440 minutes ; ni négatif, ni décimal, ni NaN", () => {
    for (const bad of [0, -5, 1441, 12.5, Number.NaN]) {
      expect(retainedMinutes(fact({ paidMinutesOverride: bad }))).toBeNull();
    }
    expect(retainedMinutes(fact({ paidMinutesOverride: 1 }))).toBe(1);
    expect(retainedMinutes(fact({ paidMinutesOverride: 1440 }))).toBe(1440);
  });

  it("collectPayable : fenêtre de dates (la date de la séance, aucun prorata), enseignants demandés, doublons éliminés, rejets motivés", () => {
    const a = fact({ date: "2026-01-12" });
    const dup = { ...a };
    const hors = fact({ date: "2026-02-03" });
    const noStaff = fact({ staffId: null, date: "2026-01-13" });
    const autre = fact({ staffId: uuid(55), date: "2026-01-14" });
    const nonRealisee = fact({ realized: false, date: "2026-01-15" });
    const all = collectPayable([a, dup, hors, noStaff, autre, nonRealisee], { from: "2026-01-05", to: "2026-01-31" });
    expect(all.payable.map((p) => p.refId)).toEqual([a.refId, autre.refId]);
    expect(all.rejected.map((r) => r.blockers)).toEqual([["NO_STAFF"], ["NOT_REALIZED"]]);
    const only = collectPayable([a, autre], { from: "2026-01-05", to: "2026-01-31", staffIds: new Set([STAFF]) });
    expect(only.payable.map((p) => p.refId)).toEqual([a.refId]);
    // même séance, deux enseignants : deux heures distinctes (co-intervenants)
    const co1 = fact({ refId: uuid(77), staffId: STAFF });
    const co2 = { ...co1, staffId: uuid(78) };
    expect(collectPayable([co1, co2], { from: "2026-01-01", to: "2026-01-31" }).payable).toHaveLength(2);
  });
});

describe("résolution du tarif (ordre figé, à la date de la séance)", () => {
  const node = uuid(300);
  const rule = (o: { id: string; rate: number; staffId?: string | null; validFrom?: string; validTo?: string | null }): HourlyRateRule => ({
    id: o.id,
    nodeId: node,
    staffId: o.staffId ?? null,
    rate: xof(o.rate),
    validFrom: o.validFrom ?? "2025-09-01",
    validTo: o.validTo ?? null,
  });
  const resolve = (index: RateIndex, date: string, def: number | null = 1000, type: "HOURLY" | "SALARY" | "MIXED" = "HOURLY", nodeId: string | null = node) =>
    resolveRate({ index, nodeId, staffId: STAFF, date, configType: type, configDefaultRate: def === null ? null : xof(def), zero: Money.zero("XOF") });

  it("nominatif avant générique avant défaut de configuration", () => {
    const idx = new RateIndex([rule({ id: uuid(1), rate: 9000 }), rule({ id: uuid(2), rate: 12_000, staffId: STAFF })]);
    expect(resolve(idx, "2026-01-12")).toEqual({ rate: xof(12_000), origin: "NODE_STAFF" });
    expect(resolveRate({ index: idx, nodeId: node, staffId: uuid(99), date: "2026-01-12", configType: "HOURLY", configDefaultRate: xof(1000), zero: Money.zero("XOF") })).toEqual({ rate: xof(9000), origin: "NODE_GENERIC" });
    expect(resolve(new RateIndex([]), "2026-01-12")).toEqual({ rate: xof(1000), origin: "CONFIG_DEFAULT" });
  });

  it("la DATE DE LA SÉANCE décide (bornes incluses), pas la période", () => {
    const idx = new RateIndex([rule({ id: uuid(1), rate: 9000, validFrom: "2026-01-10", validTo: "2026-01-20" })]);
    expect(resolve(idx, "2026-01-09")?.origin).toBe("CONFIG_DEFAULT");
    expect(resolve(idx, "2026-01-10")?.origin).toBe("NODE_GENERIC");
    expect(resolve(idx, "2026-01-20")?.origin).toBe("NODE_GENERIC");
    expect(resolve(idx, "2026-01-21")?.origin).toBe("CONFIG_DEFAULT");
  });

  it("0 est une valeur (tarif de configuration 0 ≠ absent) ; salarié sans tarif → 0 sans anomalie ; sinon anomalie (null)", () => {
    expect(resolve(new RateIndex([]), "2026-01-12", 0)).toEqual({ rate: xof(0), origin: "CONFIG_DEFAULT" });
    expect(resolve(new RateIndex([]), "2026-01-12", null, "SALARY")).toEqual({ rate: xof(0), origin: "SALARY_ZERO" });
    expect(resolve(new RateIndex([]), "2026-01-12", null, "HOURLY")).toBeNull();
    expect(resolve(new RateIndex([]), "2026-01-12", null, "MIXED")).toBeNull();
    expect(resolve(new RateIndex([rule({ id: uuid(1), rate: 5 })]), "2026-01-12", null, "HOURLY", null)).toBeNull(); // pas de nœud : défaut seul
  });

  it("à égalité défensive : le plus récemment ouvert, puis l'identifiant", () => {
    const idx = new RateIndex([rule({ id: uuid(5), rate: 100, validFrom: "2025-09-01" }), rule({ id: uuid(6), rate: 200, validFrom: "2025-12-01" })]);
    expect(resolve(idx, "2026-01-12")?.rate.amount).toBe(200);
  });
});

describe("machine d'états du bulletin", () => {
  it("transitions légales exactes (AC6.4)", () => {
    const legal: Array<[PayslipStatus, PayslipStatus]> = [
      ["CALCULATED", "APPROVED"],
      ["CALCULATED", "CANCELLED"],
      ["APPROVED", "PAID"],
      ["APPROVED", "DISPUTED"],
      ["APPROVED", "CANCELLED"],
      ["DISPUTED", "APPROVED"],
      ["DISPUTED", "CANCELLED"],
    ];
    for (const from of PAYSLIP_STATUSES) {
      for (const to of PAYSLIP_STATUSES) {
        expect(canTransition(from, to), `${from}->${to}`).toBe(legal.some(([f, t]) => f === from && t === to));
      }
    }
    expect(LEGAL_TRANSITIONS.PAID).toEqual([]);
  });

  it("jamais annulé → payé, jamais calculé → payé, payé → rien", () => {
    expect(canTransition("CANCELLED", "PAID")).toBe(false);
    expect(canTransition("CALCULATED", "PAID")).toBe(false);
    expect(canTransition("PAID", "CALCULATED")).toBe(false);
    expect(canTransition("CANCELLED", "APPROVED")).toBe(false);
    expect(isTerminal("PAID")).toBe(true);
    expect(isTerminal("CANCELLED")).toBe(true);
    expect(isFrozen("CALCULATED")).toBe(false);
    expect(isFrozen("APPROVED")).toBe(true);
    expect(holdsClaims("CANCELLED")).toBe(false);
    expect(holdsClaims("DISPUTED")).toBe(true);
  });

  it("séparation des tâches réglable ; seuil propriétaire", () => {
    expect(separationOfDutiesAllows({ requireSeparateApprover: false, calculatedBy: "a", approver: "a" })).toBe(true);
    expect(separationOfDutiesAllows({ requireSeparateApprover: true, calculatedBy: "a", approver: "a" })).toBe(false);
    expect(separationOfDutiesAllows({ requireSeparateApprover: true, calculatedBy: "a", approver: "b" })).toBe(true);
    expect(separationOfDutiesAllows({ requireSeparateApprover: true, calculatedBy: "a", approver: null })).toBe(false);
    expect(requiresOwnerApproval({ thresholdXof: null, totalXof: 10_000_000 })).toBe(false);
    expect(requiresOwnerApproval({ thresholdXof: 500_000, totalXof: 499_999 })).toBe(false);
    expect(requiresOwnerApproval({ thresholdXof: 500_000, totalXof: 500_000 })).toBe(true);
  });
});

describe("snapshot : forme canonique", () => {
  it("clés triées récursivement, indépendante de l'ordre d'insertion", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[3,{"x":2,"y":1}]},"b":1}');
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});
