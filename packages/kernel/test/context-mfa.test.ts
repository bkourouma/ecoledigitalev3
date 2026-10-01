import { describe, expect, it } from "vitest";
import { createRequestContext, createSystemContext, deriveContext } from "../src/context";

const T = "11111111-1111-4111-8111-111111111111";
const U = "22222222-2222-4222-8222-222222222222";
const CAMPUS = "33333333-3333-4333-8333-333333333333";

describe("RequestContext.mfa (extension rétro-compatible)", () => {
  it("vaut false quand l'appelant ne le précise pas (code existant inchangé)", () => {
    expect(createRequestContext({ tenantId: T, userId: U }).mfa).toBe(false);
    expect(createRequestContext({ tenantId: T, userId: U, roles: ["admin"], campusId: CAMPUS }).mfa).toBe(false);
    expect(createSystemContext(T).mfa).toBe(false);
  });

  it("n'est vrai que pour exactement true (pas de coercition d'une valeur truthy)", () => {
    expect(createRequestContext({ tenantId: T, userId: U, mfa: true }).mfa).toBe(true);
    expect(createRequestContext({ tenantId: T, userId: U, mfa: false }).mfa).toBe(false);
    expect(createRequestContext({ tenantId: T, userId: U, mfa: "yes" as unknown as boolean }).mfa).toBe(false);
    expect(createRequestContext({ tenantId: T, userId: U, mfa: 1 as unknown as boolean }).mfa).toBe(false);
  });

  it("est conservé par deriveContext, et ne change que sur demande explicite", () => {
    const strong = createRequestContext({ tenantId: T, userId: U, mfa: true });
    expect(deriveContext(strong, { campusId: CAMPUS }).mfa).toBe(true);
    expect(deriveContext(strong, { roles: ["x"] }).mfa).toBe(true);
    const weak = createRequestContext({ tenantId: T, userId: U });
    expect(deriveContext(weak, { campusId: CAMPUS }).mfa).toBe(false);
    expect(deriveContext(strong, { mfa: false }).mfa).toBe(false);
  });

  it("reste gelé", () => {
    const ctx = createRequestContext({ tenantId: T, userId: U, mfa: true });
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(() => {
      (ctx as { mfa: boolean }).mfa = false;
    }).toThrow();
  });
});
