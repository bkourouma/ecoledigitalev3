import { describe, expect, it } from "vitest";
import { buildOpenPeriodBody } from "./offerings-utils";
import { buildForest, computeReorder, countNodes, flattenForest } from "./tree-utils";

describe("buildForest", () => {
  const items = [
    { id: "c", parent: "a", name: "C" },
    { id: "a", parent: null, name: "A" },
    { id: "b", parent: "a", name: "B" },
    { id: "z", parent: "inconnu", name: "Z" },
  ];
  it("construit la forêt, trie les frères et traite un parent absent comme une racine", () => {
    const forest = buildForest(items, (i) => i.id, (i) => i.parent, (x, y) => x.name.localeCompare(y.name));
    expect(forest.map((n) => n.item.id)).toEqual(["a", "z"]);
    expect(forest[0]!.children.map((n) => n.item.id)).toEqual(["b", "c"]);
    expect(countNodes(forest)).toBe(4);
    expect(flattenForest(forest).map((x) => `${x.depth}${x.node.item.id}`)).toEqual(["0a", "1b", "1c", "0z"]);
  });
  it("un nœud qui se désigne comme parent ne disparaît pas", () => {
    const forest = buildForest([{ id: "x", parent: "x" }], (i) => i.id, (i) => i.parent);
    expect(forest).toHaveLength(1);
  });
});

describe("computeReorder", () => {
  const siblings = [
    { id: "a", ordinal: 0 },
    { id: "b", ordinal: 10 },
    { id: "c", ordinal: 20 },
  ];
  it("descend un élément : ne réécrit que les positions qui changent", () => {
    expect(computeReorder(siblings, 0, 1)).toEqual([
      { id: "b", ordinal: 0 },
      { id: "a", ordinal: 10 },
    ]);
  });
  it("renumérote quand les positions existantes sont ex æquo", () => {
    const tied = [
      { id: "a", ordinal: 5 },
      { id: "b", ordinal: 5 },
    ];
    expect(computeReorder(tied, 1, 0)).toEqual([
      { id: "b", ordinal: 0 },
      { id: "a", ordinal: 10 },
    ]);
  });
  it("ne fait rien hors bornes ou sur place", () => {
    expect(computeReorder(siblings, 0, 0)).toEqual([]);
    expect(computeReorder(siblings, 0, 3)).toEqual([]);
    expect(computeReorder(siblings, -1, 1)).toEqual([]);
  });
});

describe("buildOpenPeriodBody", () => {
  it("omet les champs vides et convertit la fenêtre en instants UTC", () => {
    expect(buildOpenPeriodBody({ periodNodeId: "n", startsOn: "2026-09-01", endsOn: "2027-01-31", registrationOpensAt: "", registrationClosesAt: "", capacity: "", open: false })).toEqual({ periodNodeId: "n", startsOn: "2026-09-01", endsOn: "2027-01-31" });
    expect(buildOpenPeriodBody({ periodNodeId: "n", startsOn: "2026-09-01", endsOn: "2027-01-31", registrationOpensAt: "2026-07-01", registrationClosesAt: "2026-09-15", capacity: "30", open: true })).toEqual({
      periodNodeId: "n",
      startsOn: "2026-09-01",
      endsOn: "2027-01-31",
      registrationOpensAt: "2026-07-01T00:00:00.000Z",
      registrationClosesAt: "2026-09-15T23:59:59.000Z",
      capacity: 30,
      open: true,
    });
  });
});
