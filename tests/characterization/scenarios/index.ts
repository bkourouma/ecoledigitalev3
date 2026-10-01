import bts from "./bts-premiere-annee.scenario";
import conduite from "./conduite-absences.scenario";
import classiqueFlottants from "./classique-flottants.scenario";
import classiqueNommage from "./classique-nommage-periodes.scenario";
import classiqueTerminale from "./classique-terminale.scenario";
import cloture from "./cloture-semestre.scenario";
import licence from "./licence-rattrapage.scenario";
import notesLimites from "./notes-limites.scenario";
import paie from "./paie-enseignants.scenario";
import type { Scenario } from "./types";

/**
 * Registre des scénarios déclaratifs. Un nouveau scénario s'ajoute ici ET dans `tests/<nom>.test.ts` (voir README).
 * Les scénarios sont de simples données : un seeder v2 les consomme sans jamais importer de code legacy.
 */
export const scenarios = {
  "bts-premiere-annee": bts,
  "licence-rattrapage": licence,
  "classique-terminale": classiqueTerminale,
  "classique-flottants": classiqueFlottants,
  "classique-nommage-periodes": classiqueNommage,
  "conduite-absences": conduite,
  "cloture-semestre": cloture,
  "paie-enseignants": paie,
  "notes-limites": notesLimites,
} as const satisfies Record<string, Scenario>;

export type ScenarioName = keyof typeof scenarios;

export const scenarioNames = Object.keys(scenarios) as ScenarioName[];

/** Snapshots qui ne correspondent pas à un scénario déclaratif (fonctions pures exécutées directement). */
export const extraSnapshotNames = ["bulletin-calc-pure"] as const;
