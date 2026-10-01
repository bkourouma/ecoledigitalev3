/** Contrats d'événements consommés par `academic` (abonnés : `modules/academic/subscribers.ts`). */
import { describe, expect, it } from "vitest";
import { academicConsumedInvoicePaidSchema } from "@ecoledigitale/contracts/v2";
import { contracts } from "./academic.contracts";
import { describeContracts, producerSchemas } from "./support";

describeContracts("academic", contracts);

describe("finance.invoice.paid -> academic (traitée par l'assemblage, branche platform/adapters)", () => {
  it("le schéma consommateur existe et exige l'identifiant de la facture", () => {
    expect(academicConsumedInvoicePaidSchema.safeParse({ v: 1, invoiceId: "0b6f3f5e-7c1d-4a52-9b8e-2f4d1c6a8e90" }).success).toBe(true);
    expect(academicConsumedInvoicePaidSchema.safeParse({ v: 1 }).success).toBe(false);
  });

  // Dès que le producteur publie son schéma de charge (`financeEventPayloadSchemas`), il doit exposer `invoiceId`.
  const producer = producerSchemas().get("finance.invoice.paid");
  if (producer) {
    describeContracts("academic", [
      { consumer: "academic", event: "finance.invoice.paid", reads: [{ field: "invoiceId", kind: "uuid" }], reader: (p) => academicConsumedInvoicePaidSchema.safeParse(p).success },
    ]);
  }
});
