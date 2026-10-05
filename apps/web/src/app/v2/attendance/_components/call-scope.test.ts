import { describe, expect, it } from "vitest";
import { callScopeAllowed, dailyHalfDays, selectCallPolicy } from "./call-scope";

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

describe("appel du matin et de l'après-midi (décision Q-P17)", () => {
  const HALF = [
    { educationLevelCode: "PRESCHOOL", callScope: "DAILY" as const, dailyCallMode: "SINGLE" as const },
    { educationLevelCode: "PRIMARY", callScope: "DAILY" as const, dailyCallMode: "HALF_DAYS" as const },
    { educationLevelCode: "*", callScope: "SESSION" as const, dailyCallMode: "SINGLE" as const },
  ];

  it("primaire : deux appels par jour proposés (matin puis après-midi) ; maternelle et secondaire : aucun choix de demi-journée", () => {
    expect(dailyHalfDays(HALF, "PRIMARY")).toEqual(["MORNING", "AFTERNOON"]);
    expect(dailyHalfDays(HALF, "PRESCHOOL")).toEqual([]);
    expect(dailyHalfDays(HALF, "SECONDARY_1")).toEqual([]);
  });

  it("politique sans mode (API ancienne), politique inconnue ou vide : appel unique, l'API tranche", () => {
    expect(dailyHalfDays(POLICIES, "PRIMARY")).toEqual([]);
    expect(dailyHalfDays(undefined, "PRIMARY")).toEqual([]);
    expect(dailyHalfDays([], "PRIMARY")).toEqual([]);
    expect(dailyHalfDays(HALF, undefined)).toEqual([]);
  });

  it("l'appel journalier reste permis par la politique du primaire (deux appels = journalier)", () => {
    expect(callScopeAllowed(HALF, "PRIMARY", "DAILY")).toBe(true);
    expect(callScopeAllowed(HALF, "PRIMARY", "SESSION")).toBe(false);
  });
});
