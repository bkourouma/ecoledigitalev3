import scenario from "../scenarios/licence-rattrapage.scenario";
import { runHigherScenario } from "../harness/run-higher";
import { scenarioSuite } from "../harness/scenario-test";

scenarioSuite(scenario, "licence-rattrapage", runHigherScenario);
