import { describe, expect, it } from "vitest";
import { HourCapLedger, blockingEventFor, effectiveRange, expandEntry, type PatternSource, type PatternTimetable } from "../../domain/recurrence";

const entry = (over: Partial<PatternSource> = {}): PatternSource => ({
  id: "e1",
  weekday: 1,
  startMinute: 8 * 60,
  endMinute: 10 * 60,
  weekPattern: "EVERY",
  validFrom: null,
  validTo: null,
  ...over,
});
const timetable = (over: Partial<PatternTimetable> = {}): PatternTimetable => ({
  validFrom: "2026-09-07",
  validTo: "2027-06-25",
  weekAAnchor: null,
  campusId: null,
  ...over,
});
const dates = (r: ReturnType<typeof expandEntry>): string[] => r.candidates.map((c) => c.generatedFor);

describe("expansion d'un patron en occurrences", () => {
  it("un patron du lundi produit un lundi sur deux dates consécutives de 7 jours, bornes incluses", () => {
    const r = expandEntry(entry(), timetable(), { from: "2026-10-05", to: "2026-10-26" }, "Africa/Abidjan", []);
    expect(dates(r)).toEqual(["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
    expect(r.candidates[0]?.startsAt.toISOString()).toBe("2026-10-05T08:00:00.000Z");
    expect(r.candidates[0]?.endsAt.toISOString()).toBe("2026-10-05T10:00:00.000Z");
  });

  it("la première date est le premier jour voulu à partir du début de fenêtre (pas de glissement)", () => {
    const r = expandEntry(entry({ weekday: 3 }), timetable(), { from: "2026-10-06", to: "2026-10-20" }, "Africa/Abidjan", []);
    expect(dates(r)).toEqual(["2026-10-07", "2026-10-14"]);
  });

  it("le dimanche est permis, à la minute (08:05-08:50)", () => {
    const r = expandEntry(entry({ weekday: 7, startMinute: 8 * 60 + 5, endMinute: 8 * 60 + 50 }), timetable(), { from: "2026-10-04", to: "2026-10-11" }, "Africa/Abidjan", []);
    expect(dates(r)).toEqual(["2026-10-04", "2026-10-11"]);
    expect(r.candidates[0]?.startsAt.toISOString()).toBe("2026-10-04T08:05:00.000Z");
    expect(r.candidates[0]?.endsAt.toISOString()).toBe("2026-10-04T08:50:00.000Z");
  });

  it("intersection : fenêtre ∩ emploi du temps ∩ patron", () => {
    const e = entry({ validFrom: "2026-10-12", validTo: "2026-10-19" });
    const r = expandEntry(e, timetable({ validFrom: "2026-10-01", validTo: "2026-10-31" }), { from: "2026-09-01", to: "2026-12-31" }, "Africa/Abidjan", []);
    expect(dates(r)).toEqual(["2026-10-12", "2026-10-19"]);
    expect(effectiveRange(e, timetable({ validFrom: "2026-10-01", validTo: "2026-10-31" }), { from: "2026-10-15", to: "2026-12-31" })).toEqual({ from: "2026-10-15", to: "2026-10-19" });
    expect(effectiveRange(e, timetable(), { from: "2027-01-01", to: "2027-02-01" })).toBeNull();
  });

  it("alternance A/B : deux patrons complémentaires ne se recouvrent jamais, y compris à la frontière d'année", () => {
    const tt = timetable({ weekAAnchor: "2026-12-21", validTo: "2027-02-28" });
    const a = expandEntry(entry({ id: "a", weekPattern: "WEEK_A" }), tt, { from: "2026-12-21", to: "2027-01-18" }, "Africa/Abidjan", []);
    const b = expandEntry(entry({ id: "b", weekPattern: "WEEK_B" }), tt, { from: "2026-12-21", to: "2027-01-18" }, "Africa/Abidjan", []);
    expect(dates(a)).toEqual(["2026-12-21", "2027-01-04", "2027-01-18"]);
    expect(dates(b)).toEqual(["2026-12-28", "2027-01-11"]);
  });

  it("une alternance sans ancre est refusée", () => {
    expect(() => expandEntry(entry({ weekPattern: "WEEK_A" }), timetable(), { from: "2026-10-05", to: "2026-10-12" }, "Africa/Abidjan", [])).toThrow(RangeError);
  });

  it("jours fériés / vacances (données du tenant) : sautés et comptés ; un événement qui ne bloque pas est ignoré", () => {
    const events = [
      { id: "h1", title: "Fête nationale", campusId: null, startsOn: "2026-10-12", endsOn: "2026-10-12", startsTime: null, endsTime: null, blocksTeaching: true },
      { id: "v1", title: "Vacances", campusId: null, startsOn: "2026-10-26", endsOn: "2026-11-01", startsTime: null, endsTime: null, blocksTeaching: true },
      { id: "x", title: "Réunion", campusId: null, startsOn: "2026-10-19", endsOn: "2026-10-19", startsTime: null, endsTime: null, blocksTeaching: false },
    ];
    const r = expandEntry(entry(), timetable(), { from: "2026-10-05", to: "2026-11-02" }, "Africa/Abidjan", events);
    expect(dates(r)).toEqual(["2026-10-05", "2026-10-19", "2026-11-02"]);
    expect(r.blocked.map((b) => [b.date, b.eventTitle])).toEqual([
      ["2026-10-12", "Fête nationale"],
      ["2026-10-26", "Vacances"],
    ]);
  });

  it("un événement horaire ne bloque que le recouvrement ; un événement de campus ne touche pas un autre campus", () => {
    const morningOnly = { id: "m", title: "Cérémonie", campusId: null, startsOn: "2026-10-05", endsOn: "2026-10-05", startsTime: "07:00", endsTime: "09:00", blocksTeaching: true };
    expect(blockingEventFor("2026-10-05", 8 * 60, 10 * 60, [morningOnly], null)?.id).toBe("m");
    expect(blockingEventFor("2026-10-05", 9 * 60, 10 * 60, [morningOnly], null)).toBeNull(); // bout à bout : libre
    expect(blockingEventFor("2026-10-05", 14 * 60, 16 * 60, [morningOnly], null)).toBeNull();
    const campusB = { id: "c", title: "Fermeture campus B", campusId: "B", startsOn: "2026-10-05", endsOn: "2026-10-05", startsTime: null, endsTime: null, blocksTeaching: true };
    expect(blockingEventFor("2026-10-05", 480, 600, [campusB], "A")).toBeNull();
    expect(blockingEventFor("2026-10-05", 480, 600, [campusB], "B")?.id).toBe("c");
  });

  it("fuseau à heure d'été : l'heure murale reste 08:00, les instants UTC changent (changement d'heure)", () => {
    const r = expandEntry(entry(), timetable({ validFrom: "2026-03-01", validTo: "2026-06-30" }), { from: "2026-03-23", to: "2026-04-06" }, "Europe/Paris", []);
    expect(r.candidates.map((c) => c.startsAt.toISOString())).toEqual([
      "2026-03-23T07:00:00.000Z", // CET (UTC+1)
      "2026-03-30T06:00:00.000Z", // CEST (UTC+2) : le changement d'heure a eu lieu le 29
      "2026-04-06T06:00:00.000Z",
    ]);
    expect(r.candidates.every((c) => c.endsAt.getTime() - c.startsAt.getTime() === 2 * 3_600_000)).toBe(true);
  });

  it("une séance le jour même du changement d'heure garde sa durée murale", () => {
    // Dimanche 2026-03-29 : 01:00 → 04:00 local traverse le saut de 02:00 à 03:00 : 2 h d'horloge, 3 h murales.
    const r = expandEntry(entry({ weekday: 7, startMinute: 60, endMinute: 4 * 60 }), timetable({ validFrom: "2026-03-01", validTo: "2026-06-30" }), { from: "2026-03-29", to: "2026-03-29" }, "Europe/Paris", []);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]?.endsAt.getTime() - (r.candidates[0]?.startsAt.getTime() ?? 0)).toBe(2 * 3_600_000);
  });

  it("rejouer l'expansion donne exactement les mêmes clés d'idempotence", () => {
    const a = expandEntry(entry(), timetable(), { from: "2026-10-05", to: "2026-12-14" }, "Africa/Abidjan", []);
    const b = expandEntry(entry(), timetable(), { from: "2026-10-05", to: "2026-12-14" }, "Africa/Abidjan", []);
    expect(dates(a)).toEqual(dates(b));
    expect(new Set(dates(a)).size).toBe(dates(a).length);
  });
});

describe("plafond d'heures par nœud", () => {
  const caps = new Map<string, number | null>([
    ["c|n", 300],
    ["c|free", null],
  ]);

  it("refuse ce qui dépasse le volume du nœud, accepte ensuite un créneau plus court qui tient", () => {
    const ledger = new HourCapLedger(new Map([["c|n", 120]]), caps);
    expect(ledger.tryConsume("c|n", 120)).toBe(true); // 240
    expect(ledger.tryConsume("c|n", 120)).toBe(false); // 360 > 300
    expect(ledger.tryConsume("c|n", 60)).toBe(true); // 300
    expect(ledger.tryConsume("c|n", 1)).toBe(false);
    expect(ledger.usedMinutes("c|n")).toBe(300);
  });

  it("une clé sans plafond n'est jamais plafonnée ; le registre initial n'est pas modifié", () => {
    const used = new Map([["c|n", 0]]);
    const ledger = new HourCapLedger(used, caps);
    expect(ledger.tryConsume("c|free", 100_000)).toBe(true);
    expect(ledger.tryConsume("autre", 5)).toBe(true);
    ledger.tryConsume("c|n", 100);
    expect(used.get("c|n")).toBe(0);
    expect(ledger.snapshot().get("c|n")).toBe(100);
  });
});
