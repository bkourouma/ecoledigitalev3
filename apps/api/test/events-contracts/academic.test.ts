/** Contrats d'événements consommés par `academic` (abonnés : `modules/academic/subscribers.ts`). */
import { describe, expect, it } from "vitest";
import { academicConsumedInvoicePaidSchema, financeInvoicePaidEventPayloadSchema } from "@ecoledigitale/contracts/v2";
import { contracts } from "./academic.contracts";
import { describeContracts } from "./support";

describeContracts("academic", contracts);

describe("finance.invoice.paid -> academic (confirmation automatique de l'inscription, décision métier 2026-10-01)", () => {
  const base = { v: 1, invoiceId: "0b6f3f5e-7c1d-4a52-9b8e-2f4d1c6a8e90", number: "FAC-2026-0001", learnerId: "1b6f3f5e-7c1d-4a52-9b8e-2f4d1c6a8e90", total: { amount: 50000, currency: "XOF" } };

  it("la charge ENRICHIE publiée par finance est lue par academic (inscription visée, frais d'inscription, objets soldés)", () => {
    const payload = { ...base, enrollmentId: "2b6f3f5e-7c1d-4a52-9b8e-2f4d1c6a8e90", containsRegistrationFee: true, sourceRefs: [{ sourceRef: "3b6f3f5e-7c1d-4a52-9b8e-2f4d1c6a8e90", category: "TUITION" }] };
    expect(financeInvoicePaidEventPayloadSchema.safeParse(payload).success).toBe(true);
    const read = academicConsumedInvoicePaidSchema.parse(payload);
    expect(read.enrollmentId).toBe("2b6f3f5e-7c1d-4a52-9b8e-2f4d1c6a8e90");
    expect(read.containsRegistrationFee).toBe(true);
    expect(read.sourceRefs?.[0]?.sourceRef).toBe("3b6f3f5e-7c1d-4a52-9b8e-2f4d1c6a8e90");
  });

  it("une charge ancienne (sans additifs) reste lisible : academic retombe alors sur le port InvoiceFactsReader", () => {
    expect(academicConsumedInvoicePaidSchema.safeParse(base).success).toBe(true);
    expect(academicConsumedInvoicePaidSchema.safeParse({ v: 1 }).success).toBe(false);
  });
});
