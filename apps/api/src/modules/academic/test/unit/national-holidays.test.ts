import { describe, expect, it } from "vitest";
import { civilDate, expandNationalHolidays, mergeHolidays, type NationalHoliday } from "../../domain/national-holidays";
import { OVERRIDE_REASON_MIN_LENGTH, PAYMENT_LINKED_CONFIRMATION_POLICIES, manualConfirmationMode } from "../../domain/enrollment";

const fixed = (code: string, month: number, day: number): NationalHoliday => ({
  code, countryCode: "CI", label: code, recurrence: "FIXED_DATE", month, day, sourceKind: "placeholder", sourceReference: null, needsConfirmation: true, note: null, active: true,
});
const movable = (code: string): NationalHoliday => ({ ...fixed(code, 1, 1), recurrence: "MOVABLE", month: null, day: null });

describe("O-10 : fêtes nationales étendues sur une plage", () => {
  const all = [fixed("NEW_YEAR", 1, 1), fixed("LEAP_DAY", 2, 29), movable("EASTER_MONDAY"), fixed("CHRISTMAS", 12, 25)];

  it("n'étend que les fêtes à date fixe, bornes incluses, triées", () => {
    const out = expandNationalHolidays(all, new Set(), { from: "2026-12-25", to: "2027-01-01" });
    expect(out.map((h) => `${h.startsOn}:${h.ref}`)).toEqual(["2026-12-25:CHRISTMAS", "2027-01-01:NEW_YEAR"]);
  });
  it("une fête mobile ne produit jamais de date", () => {
    expect(expandNationalHolidays([movable("EASTER_MONDAY")], new Set(), { from: "2026-01-01", to: "2030-12-31" })).toEqual([]);
  });
  it("un jour désactivé par l'établissement ou une ligne inactive disparaît", () => {
    expect(expandNationalHolidays(all, new Set(["CHRISTMAS"]), { from: "2026-01-01", to: "2026-12-31" }).map((h) => h.ref)).toEqual(["NEW_YEAR"]);
    expect(expandNationalHolidays([{ ...fixed("NEW_YEAR", 1, 1), active: false }], new Set(), { from: "2026-01-01", to: "2026-12-31" })).toEqual([]);
  });
  it("le 29 février n'existe que les années bissextiles", () => {
    expect(civilDate(2027, 2, 29)).toBeNull();
    expect(civilDate(2028, 2, 29)).toBe("2028-02-29");
    expect(expandNationalHolidays(all, new Set(), { from: "2027-01-01", to: "2027-12-31" }).map((h) => h.ref)).not.toContain("LEAP_DAY");
    expect(expandNationalHolidays(all, new Set(), { from: "2028-01-01", to: "2028-12-31" }).map((h) => h.ref)).toContain("LEAP_DAY");
  });
  it("plusieurs années : une occurrence par année", () => {
    const out = expandNationalHolidays([fixed("NEW_YEAR", 1, 1)], new Set(), { from: "2026-06-01", to: "2028-06-01" });
    expect(out.map((h) => h.startsOn)).toEqual(["2027-01-01", "2028-01-01"]);
    expect(out.every((h) => h.needsConfirmation && h.origin === "NATIONAL")).toBe(true);
  });
  it("la fusion trie par date puis libellé", () => {
    const national = expandNationalHolidays([fixed("NEW_YEAR", 1, 1)], new Set(), { from: "2027-01-01", to: "2027-01-01" });
    const own = [{ origin: "INSTITUTION" as const, ref: "i1", label: "Vacances", kind: "BREAK" as const, startsOn: "2026-12-20", endsOn: "2027-01-03", blocksTeaching: true, needsConfirmation: false }];
    expect(mergeHolidays(national, own).map((h) => h.ref)).toEqual(["i1", "NEW_YEAR"]);
  });
});

describe("O-01 : mode d'une confirmation manuelle", () => {
  it("les politiques liées au paiement font de la confirmation manuelle une dérogation", () => {
    expect(PAYMENT_LINKED_CONFIRMATION_POLICIES).toEqual(["ON_REGISTRATION_FEE_PAID", "ON_FULL_PAYMENT"]);
    expect(manualConfirmationMode("ON_REGISTRATION_FEE_PAID")).toBe("OVERRIDE");
    expect(manualConfirmationMode("ON_FULL_PAYMENT")).toBe("OVERRIDE");
  });
  it("politique MANUAL (ou AUTO) : confirmation ordinaire, sans dérogation", () => {
    expect(manualConfirmationMode("MANUAL")).toBe("MANUAL");
    expect(manualConfirmationMode("AUTO")).toBe("MANUAL");
  });
  it("le motif d'une dérogation compte au moins 5 caractères", () => {
    expect(OVERRIDE_REASON_MIN_LENGTH).toBe(5);
  });
});
