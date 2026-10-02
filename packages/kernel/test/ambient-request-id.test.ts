import { afterEach, describe, expect, it } from "vitest";
import { createRequestContext, createSystemContext, deriveContext, setAmbientRequestIdProvider } from "../src/context";
import { isUuid } from "../src/id";

const T = "11111111-1111-4111-8111-111111111111";
const U = "22222222-2222-4222-8222-222222222222";

afterEach(() => setAmbientRequestIdProvider(undefined));

describe("request_id ambiant (ADR-009)", () => {
  it("sans fournisseur : un UUID v7 est généré (comportement inchangé)", () => {
    expect(isUuid(createSystemContext(T).requestId)).toBe(true);
    expect(createSystemContext(T).requestId).not.toBe(createSystemContext(T).requestId);
  });

  it("avec un fournisseur : un contexte créé SANS requestId en hérite (événements dérivés corrélés à la requête d'origine)", () => {
    setAmbientRequestIdProvider(() => "req-origine-0001");
    expect(createSystemContext(T).requestId).toBe("req-origine-0001");
    expect(createRequestContext({ tenantId: T, userId: U }).requestId).toBe("req-origine-0001");
  });

  it("un requestId explicite l'emporte toujours ; deriveContext conserve celui du contexte de base", () => {
    setAmbientRequestIdProvider(() => "req-ambiant");
    const base = createRequestContext({ tenantId: T, userId: U, requestId: "req-explicite" });
    expect(base.requestId).toBe("req-explicite");
    expect(deriveContext(base, { roles: ["admin"] }).requestId).toBe("req-explicite");
  });

  it("un fournisseur défaillant ou une valeur invalide retombent sur un UUID généré", () => {
    setAmbientRequestIdProvider(() => {
      throw new Error("boom");
    });
    expect(isUuid(createSystemContext(T).requestId)).toBe(true);
    setAmbientRequestIdProvider(() => "x".repeat(201));
    expect(isUuid(createSystemContext(T).requestId)).toBe(true);
    setAmbientRequestIdProvider(() => undefined);
    expect(isUuid(createSystemContext(T).requestId)).toBe(true);
  });
});
