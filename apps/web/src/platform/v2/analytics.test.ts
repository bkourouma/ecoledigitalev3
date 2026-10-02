import { describe, expect, it } from "vitest";
import { ANALYTICS_PERMISSIONS, analyticsEnvelope, analyticsOverviewDataSchema } from "@ecoledigitale/contracts/v2/analytics";
import { scopeQuery } from "./analytics";

describe("client analytics : filtres", () => {
  it("n'envoie jamais de filtre vide (l'API choisit l'année courante et la dernière période clôturée)", () => {
    expect(scopeQuery({ institutionId: "", campusId: undefined, yearId: "y", periodId: "" })).toEqual({ yearId: "y" });
    expect(scopeQuery({})).toEqual({});
    expect(scopeQuery({ onlyOutstanding: "true" as unknown as string, limit: 50 } as never)).toEqual({ onlyOutstanding: "true", limit: 50 });
  });

  it("l'enveloppe de réponse impose meta et data (une réponse sans asOf est refusée par le contrat)", () => {
    const schema = analyticsEnvelope(analyticsOverviewDataSchema);
    expect(schema.safeParse({ data: {} }).success).toBe(false);
    expect(Object.values(ANALYTICS_PERMISSIONS)).toContain("analytics.payroll.read");
  });
});
