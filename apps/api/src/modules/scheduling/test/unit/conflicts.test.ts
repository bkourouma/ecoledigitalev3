import { describe, expect, it } from "vitest";
import {
  ResourceBook,
  availabilityStatus,
  classifyClaimHits,
  defaultLabels,
  describeEntryConflict,
  describeSpan,
  detectEntryConflicts,
  equipmentShortage,
  hasBlocking,
  roomCapacityWarning,
  staffAvailabilityWarning,
  type AvailabilityRule,
  type ClaimHit,
} from "../../domain/conflicts";
import { DEFAULT_CONFLICT_POLICIES, type TimetableEntry } from "../../domain/types";

const tz = "Africa/Abidjan";
const hit = (over: Partial<ClaimHit> = {}): ClaimHit => ({
  resourceKind: "STAFF",
  resourceId: "11111111-1111-1111-1111-111111111111",
  occurrenceId: "22222222-2222-2222-2222-222222222222",
  startsAt: new Date("2026-10-05T08:00:00Z"),
  endsAt: new Date("2026-10-05T10:00:00Z"),
  exclusive: true,
  title: "Mathématiques",
  classroomId: "33333333-3333-3333-3333-333333333333",
  ...over,
});
const labels = { ...defaultLabels, staff: () => "M. Koné", room: () => "la salle A1", classroom: () => "la classe 6e A" };

describe("classement des chevauchements de réservation", () => {
  it("BLOCK + réservation existante exclusive → bloquant, expliqué (qui, quand, quoi)", () => {
    const [c] = classifyClaimHits({ hits: [hit()], policies: DEFAULT_CONFLICT_POLICIES, override: false, classroomIsOffering: false, labels, timeZone: tz });
    expect(c?.severity).toBe("BLOCKING");
    expect(c?.code).toBe("STAFF_BUSY");
    expect(c?.message).toBe("M. Koné est déjà occupé(e) le 05/10/2026 de 08:00 à 10:00 (« Mathématiques »).");
    expect(c?.with?.occurrenceId).toBe("22222222-2222-2222-2222-222222222222");
  });

  it("politique WARN → simple avertissement (la base ne bloquera pas : réservation non exclusive)", () => {
    const policies = { ...DEFAULT_CONFLICT_POLICIES, STAFF: "WARN" as const };
    const [c] = classifyClaimHits({ hits: [hit()], policies, override: false, classroomIsOffering: false, labels, timeZone: tz });
    expect(c?.severity).toBe("WARNING");
    expect(hasBlocking([c!])).toBe(false);
  });

  it("dépassement motivé → avertissement ; contre une réservation non exclusive existante → avertissement", () => {
    expect(classifyClaimHits({ hits: [hit()], policies: DEFAULT_CONFLICT_POLICIES, override: true, classroomIsOffering: false, labels, timeZone: tz })[0]?.severity).toBe("WARNING");
    expect(classifyClaimHits({ hits: [hit({ exclusive: false })], policies: DEFAULT_CONFLICT_POLICIES, override: false, classroomIsOffering: false, labels, timeZone: tz })[0]?.severity).toBe("WARNING");
  });

  it("salle, classe et offre à la carte ont leur propre code et leur propre libellé", () => {
    const views = classifyClaimHits({
      hits: [hit({ resourceKind: "ROOM" }), hit({ resourceKind: "CLASSROOM", resourceId: "44444444-4444-4444-4444-444444444444" })],
      policies: DEFAULT_CONFLICT_POLICIES,
      override: false,
      classroomIsOffering: false,
      labels,
      timeZone: tz,
    });
    expect(views.map((v) => v.code).sort()).toEqual(["CLASSROOM_BUSY", "ROOM_BUSY"]);
    const offer = classifyClaimHits({ hits: [hit({ resourceKind: "CLASSROOM" })], policies: DEFAULT_CONFLICT_POLICIES, override: false, classroomIsOffering: true, labels, timeZone: tz });
    expect(offer[0]?.code).toBe("OFFERING_BUSY");
  });

  it("le tri est déterministe : bloquants d'abord", () => {
    const views = classifyClaimHits({
      hits: [hit({ exclusive: false, resourceId: "a0000000-0000-0000-0000-000000000000" }), hit({ resourceId: "b0000000-0000-0000-0000-000000000000" })],
      policies: DEFAULT_CONFLICT_POLICIES,
      override: false,
      classroomIsOffering: false,
      labels,
      timeZone: tz,
    });
    expect(views.map((v) => v.severity)).toEqual(["BLOCKING", "WARNING"]);
  });

  it("describeSpan suit le fuseau de l'établissement", () => {
    expect(describeSpan(new Date("2026-10-05T23:30:00Z"), new Date("2026-10-06T00:30:00Z"), "Europe/Paris")).toBe("le 06/10/2026 de 01:30 à 02:30");
    expect(describeSpan(new Date("2026-10-05T23:00:00Z"), new Date("2026-10-06T23:00:00Z"), "Africa/Abidjan")).toBe("du 05/10/2026 23:00 au 06/10/2026 23:00");
  });
});

describe("équipement (stock)", () => {
  it("dépassement du stock = conflit ; dans le stock = rien ; WARN ou dérogation = avertissement", () => {
    const base = { equipmentId: "e", total: 2, requested: 1, labels };
    expect(equipmentShortage({ ...base, inUse: 1, mode: "BLOCK", override: false })).toBeNull();
    expect(equipmentShortage({ ...base, inUse: 2, mode: "BLOCK", override: false })?.severity).toBe("BLOCKING");
    expect(equipmentShortage({ ...base, inUse: 2, mode: "WARN", override: false })?.severity).toBe("WARNING");
    expect(equipmentShortage({ ...base, inUse: 2, mode: "BLOCK", override: true })?.severity).toBe("WARNING");
  });
});

describe("disponibilité de l'intervenant (toujours un avertissement)", () => {
  const rule = (over: Partial<AvailabilityRule>): AvailabilityRule => ({ weekday: 1, date: null, startMinute: 480, endMinute: 720, kind: "AVAILABLE", ...over });
  const MONDAY = "2026-10-05";

  it("UNAVAILABLE l'emporte sur AVAILABLE", () => {
    const rules = [rule({}), rule({ kind: "UNAVAILABLE", startMinute: 540, endMinute: 600 })];
    expect(availabilityStatus(rules, "OPEN", MONDAY, 480, 660)).toBe("DECLARED_UNAVAILABLE");
  });

  it("mode OPEN : sans déclaration, disponible ; mode CLOSED : indisponible sauf plage déclarée couvrant tout le créneau", () => {
    expect(availabilityStatus([], "OPEN", MONDAY, 480, 600)).toBe("UNDECLARED_AVAILABLE");
    expect(availabilityStatus([], "CLOSED", MONDAY, 480, 600)).toBe("UNDECLARED_UNAVAILABLE");
    expect(availabilityStatus([rule({})], "CLOSED", MONDAY, 480, 600)).toBe("DECLARED_AVAILABLE");
    expect(availabilityStatus([rule({})], "CLOSED", MONDAY, 600, 780)).toBe("UNDECLARED_UNAVAILABLE"); // dépasse 12:00
    // deux plages contiguës couvrent ensemble le créneau
    expect(availabilityStatus([rule({ endMinute: 600 }), rule({ startMinute: 600, endMinute: 780 })], "CLOSED", MONDAY, 540, 720)).toBe("DECLARED_AVAILABLE");
  });

  it("une règle de date précise ne vaut que ce jour-là ; une règle hebdomadaire vise le jour ISO", () => {
    expect(availabilityStatus([rule({ weekday: null, date: "2026-10-12", kind: "UNAVAILABLE" })], "OPEN", MONDAY, 480, 600)).toBe("UNDECLARED_AVAILABLE");
    expect(availabilityStatus([rule({ weekday: null, date: MONDAY, kind: "UNAVAILABLE" })], "OPEN", MONDAY, 480, 600)).toBe("DECLARED_UNAVAILABLE");
    expect(availabilityStatus([rule({ weekday: 2, kind: "UNAVAILABLE" })], "OPEN", MONDAY, 480, 600)).toBe("UNDECLARED_AVAILABLE");
  });

  it("avertissements non bloquants rédigés pour l'utilisateur", () => {
    const w = staffAvailabilityWarning({ staffId: "s", rules: [rule({ kind: "UNAVAILABLE" })], mode: "OPEN", date: MONDAY, startMinute: 480, endMinute: 600, labels });
    expect(w?.severity).toBe("WARNING");
    expect(w?.code).toBe("STAFF_UNAVAILABLE");
    expect(w?.message).toContain("indisponibilité");
    expect(staffAvailabilityWarning({ staffId: "s", rules: [], mode: "OPEN", date: MONDAY, startMinute: 480, endMinute: 600, labels })).toBeNull();
  });

  it("salle trop petite : avertissement seulement quand la capacité et l'effectif sont connus", () => {
    expect(roomCapacityWarning({ roomId: "r", capacity: 30, headcount: 35, labels })?.code).toBe("ROOM_TOO_SMALL");
    expect(roomCapacityWarning({ roomId: "r", capacity: 30, headcount: 30, labels })).toBeNull();
    expect(roomCapacityWarning({ roomId: "r", capacity: null, headcount: 99, labels })).toBeNull();
    expect(roomCapacityWarning({ roomId: "r", capacity: 30, headcount: null, labels })).toBeNull();
  });
});

describe("carnet de réservations en mémoire", () => {
  it("reproduit la sémantique de la contrainte d'exclusion : par ressource, [) ", () => {
    const book = new ResourceBook();
    const key = ResourceBook.key("STAFF", "t1");
    book.add(key, { start: 8, end: 10, ref: "a" });
    expect(book.firstOverlap(key, { start: 9, end: 11 })?.ref).toBe("a");
    expect(book.firstOverlap(key, { start: 10, end: 12 })).toBeNull(); // bout à bout
    expect(book.firstOverlap(ResourceBook.key("STAFF", "t2"), { start: 9, end: 11 })).toBeNull();
    expect(book.firstOverlap(ResourceBook.key("ROOM", "t1"), { start: 9, end: 11 })).toBeNull();
  });
});

describe("conflits entre patrons d'un même emploi du temps", () => {
  const tt = { validFrom: "2026-09-07", validTo: "2027-06-25" };
  const e = (over: Partial<TimetableEntry>): TimetableEntry => ({
    id: "e",
    timetableId: "t",
    kind: "LESSON",
    classroomId: "c1",
    curriculumNodeId: "n1",
    offeringId: null,
    claimsClassroom: true,
    weekday: 1,
    startMinute: 480,
    endMinute: 600,
    timeSlotId: null,
    roomId: null,
    weekPattern: "EVERY",
    validFrom: null,
    validTo: null,
    deliveryMode: "IN_PERSON",
    title: null,
    notes: null,
    endedAt: null,
    staff: [],
    equipment: [],
    ...over,
  });

  it("même enseignant, même jour, plages qui se recouvrent → conflit ; bout à bout → aucun", () => {
    const a = e({ id: "a", staff: [{ staffId: "T", role: "LEAD" }] });
    const overlap = e({ id: "b", classroomId: "c2", startMinute: 540, endMinute: 600, staff: [{ staffId: "T", role: "LEAD" }] });
    const adjacent = e({ id: "c", classroomId: "c3", startMinute: 600, endMinute: 720, staff: [{ staffId: "T", role: "LEAD" }] });
    const conflicts = detectEntryConflicts([a, overlap, adjacent], tt);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ entryA: "a", entryB: "b", resourceKind: "STAFF", resourceId: "T", startMinute: 540, endMinute: 600 });
  });

  it("classe (cohorte), salle : détectés ; deux jours différents ou deux ressources différentes : non", () => {
    const a = e({ id: "a", roomId: "R" });
    const sameClass = e({ id: "b", startMinute: 500, endMinute: 560 });
    const sameRoom = e({ id: "c", classroomId: "c9", roomId: "R", startMinute: 500, endMinute: 560 });
    const otherDay = e({ id: "d", weekday: 2, roomId: "R" });
    const kinds = detectEntryConflicts([a, sameClass, sameRoom, otherDay], tt).map((c) => `${c.entryA}${c.entryB}:${c.resourceKind}`);
    expect(kinds).toContain("ab:CLASSROOM");
    expect(kinds).toContain("ac:ROOM");
    expect(kinds.some((k) => k.includes("d"))).toBe(false);
  });

  it("alternance : WEEK_A et WEEK_B ne sont jamais en conflit, EVERY l'est avec les deux", () => {
    const base = { staff: [{ staffId: "T", role: "LEAD" as const }] };
    const a = e({ id: "a", weekPattern: "WEEK_A", ...base });
    const b = e({ id: "b", weekPattern: "WEEK_B", classroomId: "c2", ...base });
    const every = e({ id: "c", weekPattern: "EVERY", classroomId: "c3", ...base });
    const c = detectEntryConflicts([a, b, every], tt).map((x) => `${x.entryA}${x.entryB}`);
    expect(c).not.toContain("ab");
    expect(c).toContain("ac");
    expect(c).toContain("bc");
  });

  it("validités disjointes ou patron terminé : aucun conflit", () => {
    const base = { staff: [{ staffId: "T", role: "LEAD" as const }] };
    const a = e({ id: "a", validTo: "2026-10-31", ...base });
    const b = e({ id: "b", classroomId: "c2", validFrom: "2026-11-01", ...base });
    const ended = e({ id: "c", classroomId: "c3", endedAt: new Date(), ...base });
    expect(detectEntryConflicts([a, b, ended], tt)).toHaveLength(0);
  });

  it("offre à la carte : ne réserve pas la classe, réserve l'offre", () => {
    const a = e({ id: "a", claimsClassroom: false, offeringId: "o1" });
    const sameClassOtherOffer = e({ id: "b", claimsClassroom: false, offeringId: "o2" });
    const sameOffer = e({ id: "c", claimsClassroom: false, offeringId: "o1", startMinute: 500 });
    const c = detectEntryConflicts([a, sameClassOtherOffer, sameOffer], tt);
    expect(c.map((x) => `${x.entryA}${x.entryB}`)).toEqual(["ac"]);
  });

  it("explication lisible, sévérité selon la politique de la ressource", () => {
    const [c] = detectEntryConflicts(
      [e({ id: "a", staff: [{ staffId: "T", role: "LEAD" }] }), e({ id: "b", classroomId: "c2", staff: [{ staffId: "T", role: "LEAD" }] })],
      tt,
    );
    const v = describeEntryConflict(c!, labels, DEFAULT_CONFLICT_POLICIES);
    expect(v.severity).toBe("BLOCKING");
    expect(v.message).toBe("M. Koné est placé(e) sur deux créneaux qui se chevauchent le lundi de 08:00 à 10:00.");
    expect(describeEntryConflict(c!, labels, { ...DEFAULT_CONFLICT_POLICIES, STAFF: "WARN" }).severity).toBe("WARNING");
  });
});
