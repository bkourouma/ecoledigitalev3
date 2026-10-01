import { describe, expect, it } from "vitest";
import { compareWithTolerance, getAtPath, joinPath, loadScenario, loadSnapshot, parsePath, pathMatches, type Snapshot } from "../compare";

/** Tests de l'API de comparaison réutilisée en Phase 2 (sans base de données). */

const synthetic = (data: unknown, defects: Snapshot["knownLegacyDefects"] = []): Snapshot => ({
  schemaVersion: 1,
  scenario: "synthetique",
  source: "legacy",
  knownLegacyDefects: defects,
  defectCatalog: {},
  data,
});

describe("chemins", () => {
  it("analyse et reconstruit les chemins avec indices et clés exotiques", () => {
    expect(parsePath("a.b[2].c")).toEqual(["a", "b", "[2]", "c"]);
    expect(parsePath('ecue["devoirs 0.13 / examen 16.58"].validee')).toEqual(["ecue", "devoirs 0.13 / examen 16.58", "validee"]);
    expect(joinPath(joinPath("", "a"), "b.c")).toBe('a["b.c"]');
    expect(joinPath("a", 3)).toBe("a[3]");
  });

  it("applique les motifs *, segment à joker et **", () => {
    expect(pathMatches("a.*.c", "a.x.c")).toBe(true);
    expect(pathMatches("a.*.c", "a.x.y.c")).toBe(false);
    expect(pathMatches("a.fatou/*.**", "a.fatou/E101A.validee")).toBe(true);
    expect(pathMatches("a.**", "a")).toBe(true);
    expect(pathMatches("a.b", "a.b.c")).toBe(false);
  });

  it("lit une valeur par chemin", () => {
    expect(getAtPath({ a: [{ b: 1 }] }, "a[0].b")).toEqual({ found: true, value: 1 });
    expect(getAtPath({ a: 1 }, "a.b").found).toBe(false);
  });
});

describe("compareWithTolerance", () => {
  it("identique -> égal, aucune divergence", () => {
    const r = compareWithTolerance({ a: 1, b: ["x", { c: true }] }, synthetic({ a: 1, b: ["x", { c: true }] }));
    expect(r).toMatchObject({ equal: true, differences: [], acceptedDivergences: [] });
  });

  it("tolère les écarts numériques sous le seuil et les décimaux en chaîne", () => {
    const snap = synthetic({ x: 10, total: "55000.00" });
    expect(compareWithTolerance({ x: 10 + 1e-12, total: "55000" }, snap).equal).toBe(true);
    expect(compareWithTolerance({ x: 10.001, total: "55000" }, snap).equal).toBe(false);
    expect(compareWithTolerance({ x: 10.001, total: "55000" }, snap, { tolerance: 0.01 }).equal).toBe(true);
  });

  it("rapporte valeurs différentes, clés manquantes et clés en trop", () => {
    const r = compareWithTolerance({ a: 2, extra: 1 }, synthetic({ a: 1, gone: 1 }));
    expect(r.equal).toBe(false);
    expect(r.differences.map((d) => `${d.kind}:${d.path}`).sort()).toEqual(["extra:extra", "missing:gone", "value:a"]);
  });

  const defect = {
    id: "FLOAT_ECUE_VALIDATION_10",
    path: "r.validee",
    legacy: false,
    correct: true,
    scope: ["r.statut", "autres.*.rang"],
  };
  const snap = synthetic({ r: { validee: false, statut: "insuffisant" }, autres: { x: { rang: 2 } }, intact: 1 }, [defect]);

  it("accepte la correction d'un bogue connu au chemin et dans sa portée, et la signale comme corrigée", () => {
    const r = compareWithTolerance({ r: { validee: true, statut: "valide" }, autres: { x: { rang: 3 } }, intact: 1 }, snap);
    expect(r.equal).toBe(true);
    expect(r.acceptedDivergences.map((d) => `${d.defect}:${d.via}:${d.path}`).sort()).toEqual([
      "FLOAT_ECUE_VALIDATION_10:path:r.validee",
      "FLOAT_ECUE_VALIDATION_10:scope:autres.x.rang",
      "FLOAT_ECUE_VALIDATION_10:scope:r.statut",
    ]);
    expect(r.corrected).toHaveLength(1);
    expect(r.stillDefective).toHaveLength(0);
  });

  it("signale un bogue que la v2 reproduit encore", () => {
    const r = compareWithTolerance({ r: { validee: false, statut: "insuffisant" }, autres: { x: { rang: 2 } }, intact: 1 }, snap);
    expect(r.equal).toBe(true);
    expect(r.stillDefective).toHaveLength(1);
  });

  it("une dérive hors portée reste une dérive, même avec un bogue connu à côté", () => {
    const r = compareWithTolerance({ r: { validee: true, statut: "valide" }, autres: { x: { rang: 2 } }, intact: 99 }, snap);
    expect(r.equal).toBe(false);
    expect(r.differences.map((d) => d.path)).toEqual(["intact"]);
  });

  it("knownDefects: none refuse toute divergence", () => {
    const r = compareWithTolerance({ r: { validee: true, statut: "valide" }, autres: { x: { rang: 2 } }, intact: 1 }, snap, { knownDefects: "none" });
    expect(r.equal).toBe(false);
  });

  it("les quirks ne sont tolérés qu'avec knownDefects: all", () => {
    const quirk = synthetic({ n: 4 }, [{ id: "SESSION2_REPLACES_EVEN_IF_LOWER", path: "n", legacy: 4, correct: "à arbitrer", scope: [] }]);
    expect(compareWithTolerance({ n: 12 }, quirk).equal).toBe(false);
    expect(compareWithTolerance({ n: 12 }, quirk, { knownDefects: "all" }).equal).toBe(true);
  });

  it("charge un scénario et sa snapshot réelle et se compare identique à elle-même", () => {
    const scenario = loadScenario("notes-limites");
    expect(scenario.meta.name).toBe("notes-limites");
    const snap = loadSnapshot("notes-limites");
    const r = compareWithTolerance(JSON.parse(JSON.stringify(snap.data)), snap);
    expect(r.equal).toBe(true);
    expect(r.acceptedDivergences).toEqual([]);
    // Comparée à elle-même, la sortie legacy reproduit tous ses bogues : aucun n'est « corrigé » ni « ailleurs ».
    expect(r.corrected).toEqual([]);
    expect(r.divergedElsewhere).toEqual([]);
    expect(r.stillDefective.length + r.unverified.length).toBe(snap.knownLegacyDefects.length);
    expect(r.stillDefective.length).toBeGreaterThan(30);
  });
});
