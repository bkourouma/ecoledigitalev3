import { describe, expect, it } from "vitest";
import { callScopeAllowed, selectCallPolicy } from "./call-scope";

const POLICIES = [
  { educationLevelCode: "PRESCHOOL", callScope: "DAILY" as const },
  { educationLevelCode: "PRIMARY", callScope: "DAILY" as const },
  { educationLevelCode: "*", callScope: "SESSION" as const },
];

describe("politique d'appel du cycle (masquage des actions d'appel)", () => {
  it("secondaire : la politique par défaut (`*`) interdit l'appel journalier", () => {
    expect(callScopeAllowed(POLICIES, "SECONDARY_1", "DAILY")).toBe(false);
    expect(callScopeAllowed(POLICIES, "SECONDARY_1", "SESSION")).toBe(true);
  });

  it("primaire et maternelle : appel journalier seulement", () => {
    expect(callScopeAllowed(POLICIES, "PRIMARY", "DAILY")).toBe(true);
    expect(callScopeAllowed(POLICIES, "PRIMARY", "SESSION")).toBe(false);
    expect(callScopeAllowed(POLICIES, "PRESCHOOL", "SESSION")).toBe(false);
  });

  it("BOTH autorise les deux ; sans politique connue tout est proposé (l'API tranche)", () => {
    expect(callScopeAllowed([{ educationLevelCode: "*", callScope: "BOTH" }], "X", "DAILY")).toBe(true);
    expect(callScopeAllowed([{ educationLevelCode: "*", callScope: "BOTH" }], "X", "SESSION")).toBe(true);
    expect(callScopeAllowed(undefined, "SECONDARY_1", "DAILY")).toBe(true);
    expect(callScopeAllowed([], "SECONDARY_1", "DAILY")).toBe(true);
    expect(callScopeAllowed([{ educationLevelCode: "PRIMARY", callScope: "DAILY" }], "SECONDARY_1", "SESSION")).toBe(true);
  });

  it("même sélection que l'API : niveau de la classe, sinon `*`", () => {
    expect(selectCallPolicy(POLICIES, "PRIMARY")?.callScope).toBe("DAILY");
    expect(selectCallPolicy(POLICIES, "UNKNOWN")?.callScope).toBe("SESSION");
    expect(selectCallPolicy(POLICIES.slice(0, 2), "UNKNOWN")).toBeNull();
  });
});
