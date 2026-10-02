import { describe, expect, it } from "vitest";
import { newId, type RequestContext } from "@ecoledigitale/kernel";
import { PORTAL_ROLES, provisionPortalAccount } from "../../application/accounts";
import type { PeopleDeps } from "../../application/deps";

// SEC-06 : une invitation de portail ne doit jamais accorder un rôle d'administration (escalade vers owner).
describe("provisionPortalAccount : liste blanche de rôles de portail", () => {
  const deps = { accounts: { invite: async () => { throw new Error("ne doit pas être appelé"); }, grantRole: async () => { throw new Error("ne doit pas être appelé"); } } } as unknown as PeopleDeps;
  const ctx = { tenantId: newId(), userId: newId() } as unknown as RequestContext;

  it.each(["owner", "admin", "directeur", "secretariat", "super_admin"])("refuse le rôle %s sans toucher à iam / rbac", async (role) => {
    const r = await provisionPortalAccount(deps, ctx, { personId: newId(), role });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(JSON.stringify(r.error)).toContain("role_not_portal");
  });

  it("la liste blanche ne contient aucun rôle d'administration", () => {
    expect([...PORTAL_ROLES].sort()).toEqual(["educateur", "eleve", "enseignant", "instituteur", "parent"]);
  });
});
