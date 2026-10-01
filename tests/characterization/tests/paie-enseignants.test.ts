import { vi } from "vitest";

// La route de création de période journalise tout le corps de la requête : on évite le bruit dans la sortie.
vi.spyOn(console, "log").mockImplementation(() => undefined);

import scenario from "../scenarios/paie-enseignants.scenario";
import { runPayrollScenario } from "../harness/run-payroll";
import { scenarioSuite } from "../harness/scenario-test";

scenarioSuite(scenario, "paie-enseignants", runPayrollScenario);
