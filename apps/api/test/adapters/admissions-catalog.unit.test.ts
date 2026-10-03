/**
 * Catalogue d'etablissements d'`admissions` : le filtre de statut doit etre la valeur MAJUSCULE de l'enumeration
 * (`ACTIVE`), pas `active`. Regression constatee au balayage QA de la demonstration : le filtre en minuscules ne
 * correspondait a aucune ligne, `listInstitutions` renvoyait [] et toutes les routes d'admissions repondaient
 * 404 `admissions.institution_unknown`.
 */
import { describe, expect, it, vi } from "vitest";
import type { RequestContext } from "@ecoledigitale/kernel";

const listInstitutions = vi.fn();
vi.mock("../../src/modules/tenancy", async (importOriginal) => ({ ...(await importOriginal<object>()), listInstitutions: (...args: unknown[]) => listInstitutions(...args), getInstitution: vi.fn() }));

import { createAdmissionsCatalog } from "../../src/platform/adapters/admissions-academic";

describe("admissions -> tenancy : catalogue d'etablissements", () => {
  it("filtre les etablissements par le statut ACTIVE (valeur de l'enumeration)", async () => {
    listInstitutions.mockResolvedValue({ ok: true, value: [{ id: "i1", name: "Collège Le Baobab" }] });
    const catalog = createAdmissionsCatalog({ tenancy: { tag: "tenancy" } } as never);
    const out = await catalog.listInstitutions({} as RequestContext);
    expect(out).toEqual([{ id: "i1", name: "Collège Le Baobab" }]);
    expect(listInstitutions).toHaveBeenCalledTimes(1);
    expect(listInstitutions.mock.calls[0]?.[2]).toEqual({ status: "ACTIVE" });
  });
});
