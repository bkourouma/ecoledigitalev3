import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getAtPath, loadSnapshot, type Snapshot } from "../compare";
import { DEFECT_CATALOG } from "../harness/defects";
import { snapshotsDir } from "../harness/paths";
import { extraSnapshotNames, scenarioNames, scenarios } from "../scenarios/index";

/**
 * Intégrité du jeu de snapshots (sans base de données) : chaque scénario a sa snapshot, chaque snapshot a son scénario, chaque bogue
 * connu appartient au catalogue et pointe sur une valeur qui EXISTE dans la sortie figée.
 */
describe("intégrité des snapshots", () => {
  const files = existsSync(snapshotsDir) ? readdirSync(snapshotsDir).filter((f) => f.endsWith(".snapshot.json")) : [];
  const names = files.map((f) => f.replace(/\.snapshot\.json$/, ""));

  it("une snapshot par scénario déclaratif, et aucune snapshot orpheline", () => {
    expect(names.sort()).toEqual([...scenarioNames, ...extraSnapshotNames].sort());
  });

  it("les scénarios sont bien formés (clés uniques, tranches renseignées, règles listées)", () => {
    for (const name of scenarioNames) {
      const s = scenarios[name];
      expect(s.meta.name).toBe(name);
      expect(s.meta.slices.length).toBeGreaterThan(0);
      expect(s.meta.rules.length).toBeGreaterThan(0);
      const keys = s.students.map((x) => x.key);
      expect(new Set(keys).size, `${name} : clés d'étudiants dupliquées`).toBe(keys.length);
      const tkeys = s.teachers.map((x) => x.key);
      expect(new Set(tkeys).size, `${name} : clés d'enseignants dupliquées`).toBe(tkeys.length);
      // Un scénario est de la donnée pure : il doit survivre à un aller-retour JSON.
      expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    }
  });

  for (const name of names) {
    describe(name, () => {
      const snap: Snapshot = loadSnapshot(name);

      it("a la forme attendue et ne contient ni UUID brut ni horodatage", () => {
        expect(snap.scenario).toBe(name);
        expect(snap.source).toBe("legacy");
        const text = JSON.stringify(snap.data);
        expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      });

      it("référence uniquement des bogues du catalogue, avec un chemin qui existe dans la sortie", () => {
        for (const d of snap.knownLegacyDefects) {
          expect(DEFECT_CATALOG[d.id], `${name} : défaut inconnu ${d.id}`).toBeTruthy();
          expect(snap.defectCatalog[d.id], `${name} : ${d.id} absent de defectCatalog`).toBeTruthy();
          const at = getAtPath(snap.data, d.path);
          expect(at.found, `${name} : le chemin ${d.path} n'existe pas`).toBe(true);
          if (at.value !== null && typeof at.value !== "object" && typeof d.legacy === typeof at.value) {
            expect(at.value, `${name} : ${d.path}`).toEqual(d.legacy);
          }
        }
      });
    });
  }
});
