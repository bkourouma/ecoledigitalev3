import { vi } from "vitest";

// Seul maillon remplacé : le rendu HTML -> PDF (Puppeteer). Voir harness/pdf-sink.ts.
vi.mock("../../../apps/api/src/services/report-card-template.service", async () => {
  const { pdfSink } = await import("../harness/pdf-sink");
  return {
    generateReportCardsPdfFromHtml: async (documents: unknown[]) => {
      pdfSink.reportCards.push(documents);
      return Buffer.from("%PDF-1.4 characterization");
    },
  };
});
vi.mock("../../../apps/api/src/services/attendance-certificate-template.service", () => ({
  generateAttendanceCertificatesPdfFromHtml: async () => Buffer.alloc(0),
  generateAttendanceCertificatesPdfFromWordTemplate: async () => Buffer.alloc(0),
}));

import scenario from "../scenarios/classique-flottants.scenario";
import { runClassicScenario } from "../harness/run-classic";
import { scenarioSuite } from "../harness/scenario-test";

scenarioSuite(scenario, "classique-flottants", runClassicScenario);
