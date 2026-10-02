import { describe, expect, it } from "vitest";
import { assertCanGrantRoles, canManageElevatedRoles } from "../application/members";

// SEC-07 : un directeur (iam.user.manage) ne peut pas fabriquer un propriétaire ni toucher à l'un d'eux.
describe("canManageElevatedRoles", () => {
  it.each(["directeur", "secretariat", "econome", "admin", "enseignant"])("%s ne peut pas accorder owner", (actor) => {
    expect(canManageElevatedRoles(actor, ["owner"])).toBe(false);
    expect(canManageElevatedRoles(actor, ["parent", "OWNER"])).toBe(false);
  });
  it("owner peut accorder owner et admin", () => {
    expect(canManageElevatedRoles("owner", ["owner"])).toBe(true);
    expect(canManageElevatedRoles("owner", ["admin"])).toBe(true);
  });
  it("admin peut accorder admin mais pas owner", () => {
    expect(canManageElevatedRoles("admin", ["administrateur"])).toBe(true);
    expect(canManageElevatedRoles("admin", ["owner"])).toBe(false);
  });
  it("directeur ne peut pas accorder admin", () => {
    expect(canManageElevatedRoles("directeur", ["admin"])).toBe(false);
  });
  it("les rôles ordinaires restent libres pour un directeur", () => {
    expect(canManageElevatedRoles("directeur", ["secretariat", "enseignant", "parent"])).toBe(true);
  });
  it("assertCanGrantRoles renvoie une erreur ForbiddenError", () => {
    const r = assertCanGrantRoles({ activeRole: "directeur" }, ["owner"]);
    expect(r.ok).toBe(false);
  });
});
