/** Contrats d'événements consommés par `admissions` + schémas des événements qu'il PUBLIE (aucune donnée personnelle). */
import { describe, expect, it } from "vitest";
import { admissionsEventPayloadSchemas } from "@ecoledigitale/contracts/v2";
import { ALL_ADMISSIONS_EVENT_TYPES } from "../../src/modules/admissions";
import { contracts } from "./admissions.contracts";
import { describeContracts } from "./support";
import { sampleOf } from "../helpers/zod-sample";

describeContracts("admissions", contracts);

describe("événements publiés par admissions", () => {
  it("chaque événement du manifeste a un schéma de charge, et réciproquement", () => {
    expect([...Object.keys(admissionsEventPayloadSchemas)].sort()).toEqual([...ALL_ADMISSIONS_EVENT_TYPES].sort());
  });

  it("aucune charge ne porte de nom, de date de naissance ni de contact (identifiants et codes seulement)", () => {
    const FORBIDDEN = /(first|last|full)_?name|birth|email|phone|address|nom|prenom|contact/i;
    const bad: string[] = [];
    for (const [type, schema] of Object.entries(admissionsEventPayloadSchemas)) {
      for (const variant of ["full", "minimal"] as const) {
        for (const key of Object.keys(sampleOf(schema, variant) as Record<string, unknown>)) if (FORBIDDEN.test(key)) bad.push(`${type}.${key}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
