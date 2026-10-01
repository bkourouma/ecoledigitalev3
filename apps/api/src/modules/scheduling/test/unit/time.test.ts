import { describe, expect, it } from "vitest";
import {
  addDays,
  assertTimeZone,
  compareDates,
  daysBetween,
  eachDate,
  firstWeekdayOnOrAfter,
  formatTimeOfDay,
  isMonday,
  isoWeekday,
  localDateOf,
  localMinuteOf,
  localToInstant,
  mondayOf,
  offsetMinutesAt,
  parseTimeOfDay,
  spansOverlap,
  weekLabel,
} from "../../domain/time";

describe("dates calendaires", () => {
  it("addDays traverse les mois, les années et les années bissextiles", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(30);
  });

  it("jour ISO : lundi = 1 … dimanche = 7", () => {
    expect(isoWeekday("2026-10-05")).toBe(1); // lundi
    expect(isoWeekday("2026-10-11")).toBe(7); // dimanche
    expect(isMonday("2026-10-05")).toBe(true);
    expect(mondayOf("2026-10-11")).toBe("2026-10-05");
    expect(mondayOf("2026-10-05")).toBe("2026-10-05");
    expect(firstWeekdayOnOrAfter("2026-10-06", 1)).toBe("2026-10-12");
    expect(firstWeekdayOnOrAfter("2026-10-05", 1)).toBe("2026-10-05");
  });

  it("rejette une date invalide", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow(RangeError);
    expect(compareDates("2026-01-01", "2026-01-02")).toBe(-1);
  });

  it("eachDate borne incluse", () => {
    expect([...eachDate("2026-10-30", "2026-11-02")]).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });
});

describe("alternance A/B", () => {
  const anchor = "2026-12-21"; // lundi d'une semaine A

  it("alterne A, B, A… et reste cohérente à la frontière d'année (2026 compte 53 semaines ISO)", () => {
    expect(weekLabel(anchor, "2026-12-21")).toBe("A");
    expect(weekLabel(anchor, "2026-12-27")).toBe("A");
    expect(weekLabel(anchor, "2026-12-28")).toBe("B");
    expect(weekLabel(anchor, "2027-01-03")).toBe("B");
    expect(weekLabel(anchor, "2027-01-04")).toBe("A");
    expect(weekLabel(anchor, "2027-01-11")).toBe("B");
  });

  it("fonctionne avant l'ancre", () => {
    expect(weekLabel(anchor, "2026-12-14")).toBe("B");
    expect(weekLabel(anchor, "2026-12-07")).toBe("A");
  });
});

describe("heures murales", () => {
  it("parse / format", () => {
    expect(parseTimeOfDay("08:30")).toBe(510);
    expect(parseTimeOfDay("23:59")).toBe(1439);
    expect(parseTimeOfDay("08:30:00")).toBe(510);
    expect(formatTimeOfDay(510)).toBe("08:30");
    expect(formatTimeOfDay(1440)).toBe("24:00");
    expect(() => parseTimeOfDay("25:00")).toThrow(RangeError);
    expect(() => parseTimeOfDay("8h30")).toThrow(RangeError);
  });
});

describe("fuseau de l'établissement", () => {
  it("Africa/Abidjan : UTC+0 sans heure d'été", () => {
    expect(localToInstant("2026-10-05", 8 * 60, "Africa/Abidjan").toISOString()).toBe("2026-10-05T08:00:00.000Z");
    expect(localDateOf(new Date("2026-10-05T23:30:00Z"), "Africa/Abidjan")).toBe("2026-10-05");
  });

  it("la date civile suit le fuseau, pas l'UTC", () => {
    // 23:30 UTC = 01:30 le lendemain à Paris (heure d'été, UTC+2).
    expect(localDateOf(new Date("2026-10-05T23:30:00Z"), "Europe/Paris")).toBe("2026-10-06");
    expect(localMinuteOf(new Date("2026-10-05T23:30:00Z"), "Europe/Paris")).toBe(90);
  });

  it("une heure murale constante donne des instants UTC différents de part et d'autre d'un changement d'heure", () => {
    expect(localToInstant("2026-03-28", 8 * 60, "Europe/Paris").toISOString()).toBe("2026-03-28T07:00:00.000Z"); // CET
    expect(localToInstant("2026-03-30", 8 * 60, "Europe/Paris").toISOString()).toBe("2026-03-30T06:00:00.000Z"); // CEST
    expect(localToInstant("2026-10-24", 8 * 60, "Europe/Paris").toISOString()).toBe("2026-10-24T06:00:00.000Z"); // CEST
    expect(localToInstant("2026-10-26", 8 * 60, "Europe/Paris").toISOString()).toBe("2026-10-26T07:00:00.000Z"); // CET
  });

  it("heure inexistante (saut de printemps) : avancée de la durée du saut ; ambiguë (retour d'automne) : première occurrence", () => {
    // 2026-03-29 : 02:00 → 03:00 à Paris. 02:30 n'existe pas.
    expect(localToInstant("2026-03-29", 2 * 60 + 30, "Europe/Paris").toISOString()).toBe("2026-03-29T01:30:00.000Z"); // = 03:30 CEST
    // 2026-10-25 : 03:00 CEST → 02:00 CET. 02:30 arrive deux fois ; on prend la première (CEST).
    expect(localToInstant("2026-10-25", 2 * 60 + 30, "Europe/Paris").toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });

  it("aller-retour : l'heure murale reconstituée est celle demandée (hors trou)", () => {
    for (const [date, minute] of [
      ["2026-03-28", 600],
      ["2026-03-29", 900],
      ["2026-10-25", 900],
      ["2026-07-14", 0],
    ] as const) {
      const inst = localToInstant(date, minute, "Europe/Paris");
      expect(localDateOf(inst, "Europe/Paris")).toBe(date);
      expect(localMinuteOf(inst, "Europe/Paris")).toBe(minute);
    }
  });

  it("autre fuseau à heure d'été (Amérique) et fuseau à demi-heure (Asie)", () => {
    expect(offsetMinutesAt(new Date("2026-07-01T12:00:00Z"), "America/New_York")).toBe(-240);
    expect(offsetMinutesAt(new Date("2026-01-01T12:00:00Z"), "America/New_York")).toBe(-300);
    expect(localToInstant("2026-01-15", 9 * 60, "Asia/Kolkata").toISOString()).toBe("2026-01-15T03:30:00.000Z");
  });

  it("minuit de fin de journée (1440) = 00:00 du lendemain", () => {
    expect(localToInstant("2026-10-05", 1440, "Africa/Abidjan").toISOString()).toBe("2026-10-06T00:00:00.000Z");
  });

  it("fuseau inconnu refusé", () => {
    expect(() => assertTimeZone("Mars/Olympus")).toThrow(RangeError);
    expect(() => assertTimeZone("Africa/Abidjan")).not.toThrow();
  });
});

describe("chevauchement [début, fin)", () => {
  it("deux séances bout à bout ne se chevauchent pas", () => {
    expect(spansOverlap({ start: 8, end: 10 }, { start: 10, end: 12 })).toBe(false);
    expect(spansOverlap({ start: 8, end: 10 }, { start: 9, end: 11 })).toBe(true);
    expect(spansOverlap({ start: 8, end: 12 }, { start: 9, end: 10 })).toBe(true);
    expect(spansOverlap({ start: 8, end: 10 }, { start: 12, end: 14 })).toBe(false);
  });
});
