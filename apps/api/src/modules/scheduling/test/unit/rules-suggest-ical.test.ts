import { describe, expect, it } from "vitest";
import { buildIcs, escapeIcsText, foldLine, formatIcsInstant } from "../../domain/ical";
import { defaultPaidRole, editability, isPayable, isValidPaidMinutes, nextStatus, occurrenceMinutes, paidMinutesOf, validationBlocker } from "../../domain/occurrence-rules";
import { rankSubstitutes, suggestSlots, type SlotQuery } from "../../domain/suggest";
import { ResourceBook, type AvailabilityRule } from "../../domain/conflicts";

describe("machine d'états et gel", () => {
  it("PLANNED → HELD | CANCELLED ; HELD → PLANNED | CANCELLED ; CANCELLED → PLANNED seulement", () => {
    expect(nextStatus("PLANNED", "HELD")).toBe("HELD");
    expect(nextStatus("HELD", "HELD")).toBeNull();
    expect(nextStatus("HELD", "UNHELD")).toBe("PLANNED");
    expect(nextStatus("PLANNED", "UNHELD")).toBeNull();
    expect(nextStatus("PLANNED", "CANCELLED")).toBe("CANCELLED");
    expect(nextStatus("HELD", "CANCELLED")).toBe("CANCELLED");
    expect(nextStatus("CANCELLED", "CANCELLED")).toBeNull();
    expect(nextStatus("CANCELLED", "RESTORED")).toBe("PLANNED");
    expect(nextStatus("PLANNED", "RESTORED")).toBeNull();
    expect(nextStatus("CANCELLED", "HELD")).toBeNull();
  });

  it("une séance validée ou aux heures verrouillées est gelée ; verrou prioritaire sur la validation", () => {
    const planned = { status: "PLANNED" as const, validatedAt: null };
    expect(editability(planned, [])).toEqual({ ok: true });
    expect(editability({ status: "HELD", validatedAt: new Date() }, [{ lockedAt: null, lockRef: null }])).toEqual({ ok: false, reason: "VALIDATED" });
    expect(editability({ status: "HELD", validatedAt: new Date() }, [{ lockedAt: new Date(), lockRef: "ref" }])).toEqual({ ok: false, reason: "LOCKED", lockRef: "ref" });
    expect(editability({ status: "CANCELLED", validatedAt: null }, [])).toEqual({ ok: false, reason: "CANCELLED" });
    expect(editability({ status: "CANCELLED", validatedAt: null }, [], { allowCancelled: true })).toEqual({ ok: true });
  });
});

describe("validation et heures payables", () => {
  const held = { status: "HELD" as const, origin: "AD_HOC" as const, createdBy: "u1" };

  it("exige HELD et un intervenant de rôle rémunéré", () => {
    const opts = { actorId: "u2", allowSelfValidation: false };
    expect(validationBlocker(held, [{ isPaidRole: true }], opts)).toBeNull();
    expect(validationBlocker({ ...held, status: "PLANNED" }, [{ isPaidRole: true }], opts)).toBe("NOT_HELD");
    expect(validationBlocker({ ...held, status: "CANCELLED" }, [{ isPaidRole: true }], opts)).toBe("CANCELLED");
    expect(validationBlocker(held, [], opts)).toBe("NO_PAID_STAFF");
    expect(validationBlocker(held, [{ isPaidRole: false }], opts)).toBe("NO_PAID_STAFF");
  });

  it("« quatre yeux » : le créateur d'une séance comptable ne la valide pas (sauf réglage contraire)", () => {
    const accounting = { ...held, origin: "ACCOUNTING" as const };
    expect(validationBlocker(accounting, [{ isPaidRole: true }], { actorId: "u1", allowSelfValidation: false })).toBe("SELF_VALIDATION");
    expect(validationBlocker(accounting, [{ isPaidRole: true }], { actorId: "u1", allowSelfValidation: true })).toBeNull();
    expect(validationBlocker(accounting, [{ isPaidRole: true }], { actorId: "u3", allowSelfValidation: false })).toBeNull();
    // une séance normale n'est pas concernée
    expect(validationBlocker(held, [{ isPaidRole: true }], { actorId: "u1", allowSelfValidation: false })).toBeNull();
  });

  it("durée payée : la dérogation prime, sinon la durée de la séance, en minutes entières", () => {
    const occ = { startsAt: new Date("2026-10-05T08:00:00Z"), endsAt: new Date("2026-10-05T09:50:00Z") };
    expect(occurrenceMinutes(occ.startsAt, occ.endsAt)).toBe(110);
    expect(paidMinutesOf(occ, { paidMinutes: null })).toBe(110);
    expect(paidMinutesOf(occ, { paidMinutes: 90 })).toBe(90);
    expect([0, 1, 1440, 1441, 1.5, -3].map(isValidPaidMinutes)).toEqual([false, true, true, false, false, false]);
  });

  it("prédicat payable : HELD ∧ validée ∧ rôle rémunéré", () => {
    const validated = { status: "HELD" as const, validatedAt: new Date() };
    expect(isPayable(validated, { isPaidRole: true })).toBe(true);
    expect(isPayable(validated, { isPaidRole: false })).toBe(false);
    expect(isPayable({ status: "HELD", validatedAt: null }, { isPaidRole: true })).toBe(false);
    expect(isPayable({ status: "PLANNED", validatedAt: new Date() }, { isPaidRole: true })).toBe(false);
  });

  it("rôle rémunéré par défaut : tous sauf les surveillants (réglable)", () => {
    expect(defaultPaidRole("LEAD", false)).toBe(true);
    expect(defaultPaidRole("CO_TEACHER", false)).toBe(true);
    expect(defaultPaidRole("SUBSTITUTE", false)).toBe(true);
    expect(defaultPaidRole("SUPERVISOR", false)).toBe(false);
    expect(defaultPaidRole("SUPERVISOR", true)).toBe(true);
  });
});

describe("aide au placement : créneaux libres", () => {
  const base = (over: Partial<SlotQuery> = {}): SlotQuery => ({
    window: { from: "2026-10-05", to: "2026-10-09" },
    durationMinutes: 60,
    count: 5,
    timeZone: "Africa/Abidjan",
    weekdays: [1, 2, 3, 4, 5],
    dayStartMinute: 8 * 60,
    dayEndMinute: 12 * 60,
    startMinutes: null,
    stepMinutes: 60,
    campusId: null,
    events: [],
    book: new ResourceBook(),
    staffIds: ["T"],
    classroomKey: "C",
    rooms: [],
    roomRequired: false,
    headcount: null,
    availability: new Map(),
    availabilityMode: "OPEN",
    now: new Date("2026-10-01T00:00:00Z"),
    ...over,
  });
  const t = (iso: string): number => new Date(iso).getTime();

  it("renvoie les N premiers créneaux libres, dans l'ordre jour, heure — déterministe", () => {
    const a = suggestSlots(base());
    const b = suggestSlots(base());
    expect(a.map((s) => `${s.date} ${s.startMinute}`)).toEqual(b.map((s) => `${s.date} ${s.startMinute}`));
    expect(a.map((s) => `${s.date} ${s.startMinute / 60}`)).toEqual(["2026-10-05 8", "2026-10-05 9", "2026-10-05 10", "2026-10-05 11", "2026-10-06 8"]);
  });

  it("évite les créneaux où l'enseignant ou la classe sont pris ; bout à bout autorisé", () => {
    const book = new ResourceBook();
    book.add(ResourceBook.key("STAFF", "T"), { start: t("2026-10-05T08:00:00Z"), end: t("2026-10-05T10:00:00Z"), ref: "x" });
    book.add("CLASSROOM:C", { start: t("2026-10-05T11:00:00Z"), end: t("2026-10-05T12:00:00Z"), ref: "y" });
    const slots = suggestSlots(base({ book, count: 3 }));
    expect(slots.map((s) => `${s.date} ${s.startMinute / 60}`)).toEqual(["2026-10-05 10", "2026-10-06 8", "2026-10-06 9"]);
  });

  it("saute les jours bloquants du calendrier et les jours non ouvrables", () => {
    const events = [{ id: "h", title: "Férié", campusId: null, startsOn: "2026-10-05", endsOn: "2026-10-06", startsTime: null, endsTime: null, blocksTeaching: true }];
    const slots = suggestSlots(base({ events, weekdays: [1, 2, 3], count: 2 }));
    expect(slots.map((s) => s.date)).toEqual(["2026-10-07", "2026-10-07"]);
  });

  it("salle : la plus petite suffisante pour l'effectif, libre ; aucune salle libre → aucun créneau", () => {
    const rooms = [
      { id: "big", code: "B1", capacity: 100, roomTypeCode: "CLASSROOM", features: [] },
      { id: "fit", code: "A1", capacity: 40, roomTypeCode: "CLASSROOM", features: [] },
      { id: "small", code: "S1", capacity: 20, roomTypeCode: "CLASSROOM", features: [] },
    ];
    const first = suggestSlots(base({ rooms, roomRequired: true, headcount: 35, count: 1 }))[0];
    expect(first?.roomId).toBe("fit");
    const book = new ResourceBook();
    book.add("ROOM:fit", { start: t("2026-10-05T08:00:00Z"), end: t("2026-10-05T09:00:00Z"), ref: "z" });
    expect(suggestSlots(base({ rooms, roomRequired: true, headcount: 35, count: 1, book }))[0]?.roomId).toBe("big");
    expect(suggestSlots(base({ rooms: [], roomRequired: true }))).toEqual([]);
  });

  it("préfère, au sein d'un jour, les plages où l'enseignant a déclaré sa disponibilité ; avertit sur les indisponibilités", () => {
    const rules: AvailabilityRule[] = [
      { weekday: 1, date: null, startMinute: 10 * 60, endMinute: 12 * 60, kind: "AVAILABLE" },
      { weekday: 1, date: null, startMinute: 8 * 60, endMinute: 9 * 60, kind: "UNAVAILABLE" },
    ];
    const slots = suggestSlots(base({ availability: new Map([["T", rules]]), availabilityMode: "OPEN", count: 4 }));
    expect(slots.map((s) => s.startMinute / 60)).toEqual([10, 11, 8, 9]); // préférés (10, 11) d'abord
    expect(slots[0]?.preferred).toBe(true);
    expect(slots.find((s) => s.startMinute === 8 * 60)?.warnings.map((w) => w.code)).toEqual(["STAFF_UNAVAILABLE"]);
  });

  it("n'offre jamais un créneau passé ; se cale sur la grille horaire si elle existe", () => {
    const slots = suggestSlots(base({ startMinutes: [8 * 60 + 15, 10 * 60], now: new Date("2026-10-05T09:00:00Z"), count: 2 }));
    expect(slots.map((s) => `${s.date} ${s.startMinute}`)).toEqual(["2026-10-05 600", "2026-10-06 495"]);
  });
});

describe("aide au placement : remplaçants", () => {
  const cand = (staffId: string, over: Record<string, unknown> = {}) => ({
    staffId,
    status: "ACTIVE",
    busy: false,
    availability: "UNDECLARED_AVAILABLE" as const,
    competent: null,
    assignedToClassroom: null,
    weeklyLoadMinutes: 0,
    ...over,
  });

  it("éligibles d'abord ; puis compétents, disponibilité déclarée, affectés, moindre charge, identifiant", () => {
    const ranked = rankSubstitutes([
      cand("d", { busy: true }),
      cand("c", { competent: false }),
      cand("b", { competent: true, weeklyLoadMinutes: 600 }),
      cand("a", { competent: true, weeklyLoadMinutes: 120 }),
      cand("e", { status: "SUSPENDED" }),
      cand("f", { availability: "DECLARED_UNAVAILABLE" }),
    ]);
    expect(ranked.map((r) => r.staffId)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(ranked.slice(0, 3).every((r) => r.eligible)).toBe(true);
    expect(ranked.slice(3).every((r) => !r.eligible)).toBe(true);
    expect(ranked.find((r) => r.staffId === "d")?.reasons).toContain("occupé sur ce créneau");
  });

  it("déterministe à égalité parfaite", () => {
    const a = rankSubstitutes([cand("z"), cand("m"), cand("a")]).map((r) => r.staffId);
    expect(a).toEqual(["a", "m", "z"]);
  });
});

describe("iCalendar", () => {
  it("échappe, plie à 75 octets sans couper un caractère, CRLF, UTC", () => {
    expect(escapeIcsText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    const long = "é".repeat(80);
    const folded = foldLine(`SUMMARY:${long}`);
    for (const line of folded.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(`SUMMARY:${long}`);
    expect(formatIcsInstant(new Date("2026-10-05T08:00:00Z"))).toBe("20261005T080000Z");
  });

  it("construit un VCALENDAR avec statut annulé et fuseau annoncé", () => {
    const text = buildIcs({
      name: "Emploi du temps — 6e A",
      timeZone: "Africa/Abidjan",
      now: new Date("2026-10-01T00:00:00Z"),
      events: [
        { uid: "b", startsAt: new Date("2026-10-06T08:00:00Z"), endsAt: new Date("2026-10-06T09:00:00Z"), summary: "Histoire", status: "CANCELLED", updatedAt: new Date("2026-10-02T00:00:00Z") },
        { uid: "a", startsAt: new Date("2026-10-05T08:00:00Z"), endsAt: new Date("2026-10-05T10:00:00Z"), summary: "Maths, groupe 1", location: "Salle A1", status: "CONFIRMED", updatedAt: new Date("2026-10-01T00:00:00Z") },
      ],
    });
    expect(text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(text).toContain("X-WR-TIMEZONE:Africa/Abidjan");
    expect(text).toContain("SUMMARY:Maths\\, groupe 1");
    expect(text).toContain("STATUS:CANCELLED");
    expect(text.indexOf("UID:a@")).toBeLessThan(text.indexOf("UID:b@")); // trié par début
    expect((text.match(/BEGIN:VEVENT/g) ?? []).length).toBe(2);
  });
});
