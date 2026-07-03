import { wouldCreateUePrerequisiteCycle } from "../services/professional-ue.service";
import { SetProfessionalUePrerequisitesSchema } from "@ecoledigitale/contracts";

/**
 * Tests — Prérequis entre UE (feature 030, FR-005).
 * Détection de cycle (graphe acyclique) + contrat de définition.
 */

describe("wouldCreateUePrerequisiteCycle", () => {
  it("aucun cycle pour un graphe vide", () => {
    expect(wouldCreateUePrerequisiteCycle([], "A", ["B"])).toBe(false);
  });

  it("détecte un cycle direct (B requiert A ; on ajoute A requiert B)", () => {
    const edges = [{ ue: "B", prerequisite: "A" }];
    expect(wouldCreateUePrerequisiteCycle(edges, "A", ["B"])).toBe(true);
  });

  it("détecte un cycle indirect (C→B→A ; on ajoute A→C)", () => {
    const edges = [
      { ue: "C", prerequisite: "B" },
      { ue: "B", prerequisite: "A" },
    ];
    expect(wouldCreateUePrerequisiteCycle(edges, "A", ["C"])).toBe(true);
  });

  it("autorise une chaîne acyclique (B requiert A ; on ajoute C requiert B)", () => {
    const edges = [{ ue: "B", prerequisite: "A" }];
    expect(wouldCreateUePrerequisiteCycle(edges, "C", ["B"])).toBe(false);
  });

  it("autorise un diamant acyclique", () => {
    const edges = [
      { ue: "D", prerequisite: "B" },
      { ue: "D", prerequisite: "C" },
      { ue: "C", prerequisite: "A" },
    ];
    expect(wouldCreateUePrerequisiteCycle(edges, "B", ["A"])).toBe(false);
  });

  it("détecte un cycle parmi plusieurs nouveaux prérequis", () => {
    const edges = [{ ue: "X", prerequisite: "A" }];
    expect(wouldCreateUePrerequisiteCycle(edges, "A", ["Y", "X"])).toBe(true);
  });
});

describe("SetProfessionalUePrerequisitesSchema", () => {
  it("accepte une liste d'UUID", () => {
    expect(
      SetProfessionalUePrerequisitesSchema.safeParse({
        prerequisite_ue_ids: ["11111111-1111-1111-1111-111111111111"],
      }).success
    ).toBe(true);
  });

  it("accepte une liste vide (aucun prérequis)", () => {
    expect(
      SetProfessionalUePrerequisitesSchema.safeParse({ prerequisite_ue_ids: [] }).success
    ).toBe(true);
  });

  it("applique le défaut (liste vide) si le champ est absent", () => {
    const r = SetProfessionalUePrerequisitesSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.prerequisite_ue_ids).toEqual([]);
  });

  it("rejette un identifiant non-UUID", () => {
    expect(
      SetProfessionalUePrerequisitesSchema.safeParse({
        prerequisite_ue_ids: ["not-a-uuid"],
      }).success
    ).toBe(false);
  });
});
