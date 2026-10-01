import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect } from "vitest";
import type { DefectOccurrence } from "./defects";
import { DEFECT_CATALOG } from "./defects";
import { snapshotsDir } from "./paths";

/**
 * Snapshots JSON de caractérisation.
 *
 * Format (stable, relu par `compare.ts` en Phase 2) :
 *   {
 *     "schemaVersion": 1,
 *     "scenario": "<nom>",
 *     "source": "legacy",
 *     "knownLegacyDefects": [ { id, path, legacy, correct, note? } ],
 *     "defectCatalog": { id: { status, title } }      <- uniquement les défauts référencés
 *     "data": { ... }                                    <- sortie normalisée
 *   }
 *
 * Régénération : EXPLICITE seulement. `pnpm test:characterization -- -u` (ou CHARACTERIZATION_UPDATE=1) écrit les
 * fichiers ; sans cela, une snapshot absente ou différente fait ÉCHOUER le test. Jamais d'écriture automatique.
 */

export const SNAPSHOT_SCHEMA_VERSION = 1;

export interface SnapshotFile {
  schemaVersion: number;
  scenario: string;
  source: "legacy";
  knownLegacyDefects: DefectOccurrence[];
  defectCatalog: Record<string, { status: string; title: string }>;
  data: unknown;
}

export function isUpdateMode(): boolean {
  return process.env.CHARACTERIZATION_UPDATE === "1";
}

export function snapshotFilePath(name: string): string {
  return join(snapshotsDir, `${name}.snapshot.json`);
}

export function buildSnapshotFile(scenario: string, data: unknown, defects: DefectOccurrence[]): SnapshotFile {
  const catalog: SnapshotFile["defectCatalog"] = {};
  for (const d of defects) {
    const entry = DEFECT_CATALOG[d.id];
    catalog[d.id] = { status: entry.status, title: entry.title };
  }
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    scenario,
    source: "legacy",
    knownLegacyDefects: defects,
    defectCatalog: catalog,
    data,
  };
}

export function serializeSnapshot(file: SnapshotFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/**
 * Compare `data` (+ défauts) à la snapshot `name`, ou l'écrit en mode `-u`.
 * `data` doit déjà être normalisé (voir normalize.ts).
 */
export function expectMatchesSnapshot(name: string, scenario: string, data: unknown, defects: DefectOccurrence[]): void {
  const file = buildSnapshotFile(scenario, data, defects);
  const path = snapshotFilePath(name);
  // Passage par JSON : ce que l'on compare est exactement ce qui serait écrit sur disque.
  const actual = JSON.parse(serializeSnapshot(file));

  if (isUpdateMode()) {
    mkdirSync(dirname(path), { recursive: true });
    const text = serializeSnapshot(file);
    if (!existsSync(path) || readFileSync(path, "utf8") !== text) {
      writeFileSync(path, text, "utf8");
      console.log(`[characterization] snapshot écrite : ${name}.snapshot.json`);
    }
    return;
  }

  if (!existsSync(path)) {
    throw new Error(
      `Snapshot absente : ${name}.snapshot.json. Si le scénario est nouveau, générez-la EXPLICITEMENT : ` +
        "`pnpm test:characterization -- -u`, puis relisez le diff avant de committer.",
    );
  }
  const stored = JSON.parse(readFileSync(path, "utf8"));
  try {
    expect(actual).toEqual(stored);
  } catch (e) {
    const err = e as Error;
    err.message =
      `DÉRIVE du comportement legacy figé (${name}). Si le changement est voulu, régénérez avec ` +
      "`pnpm test:characterization -- -u` et justifiez le diff.\n\n" +
      err.message;
    throw err;
  }
}
