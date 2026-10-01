import { describe, expect, it } from "vitest";
import {
  ABIDJAN_TZ,
  ManualClock,
  abidjanDate,
  abidjanDateTime,
  endOfDayAbidjan,
  formatDateFr,
  isValidIsoDate,
  startOfDayAbidjan,
  startOfDayInZone,
  systemClock,
  zonedParts,
} from "../src/clock";
import {
  createRequestContext,
  createSystemContext,
  deriveContext,
  getRequestContext,
  hasRole,
  requireRequestContext,
  runWithContext,
} from "../src/context";
import { ValidationError } from "../src/errors";
import { __resetIdGeneratorForTests, isUuid, newId, newUuidV4, parseUuid, uuidV7Timestamp } from "../src/id";

const T = "11111111-1111-4111-8111-111111111111";
const U = "22222222-2222-4222-8222-222222222222";
const CAMPUS = "33333333-3333-4333-8333-333333333333";

describe("Id", () => {
  it("newId produit des UUID v7 valides, variante RFC", () => {
    const id = newId();
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe("7");
    expect("89ab").toContain(id[19]);
  });

  it("encode l'horodatage et l'ordre est monotone, même dans la même milliseconde", () => {
    __resetIdGeneratorForTests();
    const ms = Date.UTC(2026, 9, 1, 12, 0, 0);
    const ids = Array.from({ length: 5000 }, () => newId(ms));
    expect(uuidV7Timestamp(ids[0] as string)?.getTime()).toBe(ms);
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reste monotone si l'horloge recule", () => {
    __resetIdGeneratorForTests();
    const a = newId(2_000_000_000_000);
    const b = newId(1_000_000_000_000);
    expect(b > a).toBe(true);
  });

  it("uuidV7Timestamp renvoie null pour un v4", () => {
    expect(uuidV7Timestamp(newUuidV4())).toBeNull();
    expect(uuidV7Timestamp("pas-un-uuid")).toBeNull();
  });

  it("parseUuid normalise et lève ValidationError", () => {
    expect(parseUuid(T.toUpperCase())).toBe(T);
    expect(() => parseUuid("x", "tenantId")).toThrowError(ValidationError);
    expect(() => parseUuid(undefined)).toThrowError(ValidationError);
    expect(isUuid("11111111-1111-4111-8111-11111111111")).toBe(false);
    expect(isUuid(`${T}; DROP TABLE x`)).toBe(false);
  });
});

describe("RequestContext", () => {
  it("construit un contexte gelé avec requestId généré", () => {
    const ctx = createRequestContext({ tenantId: T.toUpperCase(), userId: U, roles: ["teacher", "teacher", " "] });
    expect(ctx.tenantId).toBe(T);
    expect(ctx.actor).toBe("user");
    expect(ctx.roles).toEqual(["teacher"]);
    expect(isUuid(ctx.requestId)).toBe(true);
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(Object.isFrozen(ctx.roles)).toBe(true);
    expect(hasRole(ctx, "teacher")).toBe(true);
  });

  it("refuse un tenantId qui n'est pas un UUID", () => {
    expect(() => createRequestContext({ tenantId: "abc", userId: U })).toThrowError(ValidationError);
    expect(() => createRequestContext({ tenantId: "", userId: U })).toThrowError(ValidationError);
    expect(() => createRequestContext({ tenantId: `${T}'--`, userId: U })).toThrowError(ValidationError);
  });

  it("exige userId pour user/superAdmin et l'interdit pour system", () => {
    expect(() => createRequestContext({ tenantId: T })).toThrowError(/exige un userId/);
    expect(() => createRequestContext({ tenantId: T, actor: "superAdmin" })).toThrowError(/exige un userId/);
    expect(() => createRequestContext({ tenantId: T, actor: "system", userId: U })).toThrowError(/pas de userId/);
    expect(createSystemContext(T).userId).toBeNull();
    expect(createRequestContext({ tenantId: T, userId: U, actor: "superAdmin" }).actor).toBe("superAdmin");
  });

  it("valide institutionId et campusId", () => {
    expect(() => createRequestContext({ tenantId: T, userId: U, campusId: "nope" })).toThrowError(ValidationError);
    const ctx = createRequestContext({ tenantId: T, userId: U, campusId: CAMPUS });
    expect(ctx.campusId).toBe(CAMPUS);
    expect("institutionId" in ctx).toBe(false);
  });

  it("deriveContext ne change ni le tenant ni l'acteur", () => {
    const base = createRequestContext({ tenantId: T, userId: U, roles: ["admin"] });
    const d = deriveContext(base, { campusId: CAMPUS });
    expect(d.tenantId).toBe(T);
    expect(d.userId).toBe(U);
    expect(d.actor).toBe("user");
    expect(d.campusId).toBe(CAMPUS);
    expect(d.requestId).toBe(base.requestId);
    expect(deriveContext(d, { campusId: null }).campusId).toBeUndefined();
  });

  it("se propage à travers les await, timers et Promise.all, sans fuite entre requêtes", async () => {
    const a = createRequestContext({ tenantId: T, userId: U });
    const b = createRequestContext({ tenantId: U, userId: T });
    expect(getRequestContext()).toBeUndefined();

    const read = async (delay: number) => {
      await new Promise((r) => setTimeout(r, delay));
      await Promise.resolve();
      return requireRequestContext().tenantId;
    };
    const [ra, rb] = await Promise.all([
      runWithContext(a, () => read(15)),
      runWithContext(b, () => read(5)),
    ]);
    expect(ra).toBe(T);
    expect(rb).toBe(U);
    expect(getRequestContext()).toBeUndefined();
  });

  it("requireRequestContext lève hors contexte", () => {
    expect(() => requireRequestContext()).toThrowError(/Aucun RequestContext/);
    try {
      requireRequestContext();
    } catch (e) {
      expect((e as { code: string }).code).toBe("CONTEXT_MISSING");
    }
  });

  it("un contexte imbriqué masque puis restaure l'extérieur", () => {
    const a = createRequestContext({ tenantId: T, userId: U });
    const b = createRequestContext({ tenantId: U, userId: T });
    runWithContext(a, () => {
      runWithContext(b, () => expect(requireRequestContext().tenantId).toBe(U));
      expect(requireRequestContext().tenantId).toBe(T);
    });
  });
});

describe("Clock", () => {
  it("systemClock renvoie l'heure courante", () => {
    const before = Date.now();
    const t = systemClock.now().getTime();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(Date.now());
  });

  it("ManualClock est figée et avançable, et rend des copies", () => {
    const c = new ManualClock("2026-10-01T10:00:00Z");
    expect(c.now().toISOString()).toBe("2026-10-01T10:00:00.000Z");
    c.advance(90_000);
    expect(c.now().toISOString()).toBe("2026-10-01T10:01:30.000Z");
    c.now().setFullYear(1999);
    expect(c.now().getUTCFullYear()).toBe(2026);
    c.set("2027-01-01T00:00:00Z");
    expect(c.now().getUTCFullYear()).toBe(2027);
    expect(() => new ManualClock("nope")).toThrowError();
  });

  it("helpers Abidjan : jour calendaire et heure locale (UTC+0)", () => {
    const d = new Date("2026-10-01T23:59:59Z");
    expect(ABIDJAN_TZ).toBe("Africa/Abidjan");
    expect(abidjanDate(d)).toBe("2026-10-01");
    expect(abidjanDateTime(d)).toBe("2026-10-01T23:59:59");
    expect(zonedParts(d).hour).toBe(23);
    expect(abidjanDate(new Date("2026-10-02T00:00:00Z"))).toBe("2026-10-02");
  });

  it("start/end of day à Abidjan", () => {
    expect(startOfDayAbidjan("2026-10-01").toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(endOfDayAbidjan("2026-10-01").toISOString()).toBe("2026-10-01T23:59:59.999Z");
    expect(endOfDayAbidjan("2026-12-31").toISOString()).toBe("2026-12-31T23:59:59.999Z");
    expect(endOfDayAbidjan("2028-02-28").toISOString()).toBe("2028-02-28T23:59:59.999Z");
  });

  it("startOfDayInZone est correct pour un fuseau à décalage (Paris, heure d'été et d'hiver)", () => {
    expect(startOfDayInZone("2026-07-01", "Europe/Paris").toISOString()).toBe("2026-06-30T22:00:00.000Z");
    expect(startOfDayInZone("2026-01-15", "Europe/Paris").toISOString()).toBe("2026-01-14T23:00:00.000Z");
    expect(abidjanDate(new Date("2026-06-30T23:30:00Z"), "Europe/Paris")).toBe("2026-07-01");
  });

  it("valide les dates ISO et refuse les dates invalides", () => {
    expect(isValidIsoDate("2028-02-29")).toBe(true);
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("01/10/2026")).toBe(false);
    expect(() => startOfDayAbidjan("2026-02-30")).toThrowError(TypeError);
    expect(() => abidjanDate(new Date("x"))).toThrowError(TypeError);
  });

  it("formatDateFr produit une date française", () => {
    expect(formatDateFr(new Date("2026-10-01T12:00:00Z"))).toMatch(/octobre 2026/);
  });
});
