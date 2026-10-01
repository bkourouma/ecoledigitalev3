import scenario from "../scenarios/bts-premiere-annee.scenario";
import { runHigherScenario } from "../harness/run-higher";
import { scenarioSuite } from "../harness/scenario-test";

scenarioSuite(scenario, "bts-premiere-annee", runHigherScenario);
