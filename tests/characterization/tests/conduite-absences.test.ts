import scenario from "../scenarios/conduite-absences.scenario";
import { runHigherScenario } from "../harness/run-higher";
import { scenarioSuite } from "../harness/scenario-test";

scenarioSuite(scenario, "conduite-absences", runHigherScenario);
