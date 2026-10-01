import { describe, expect, it } from "vitest";
import {
  rbacCloneRoleBodySchema,
  rbacCreateAssignmentBodySchema,
  rbacCreateRoleBodySchema,
  rbacListAssignmentsQuerySchema,
  rbacMyPermissionsResponseSchema,
  rbacNavigationResponseSchema,
  rbacScopeSchema,
  rbacUpdateAssignmentBodySchema,
  rbacUpdateRoleBodySchema,
} from "@ecoledigitale/contracts/src/v2/rbac";
import * as v2 from "@ecoledigitale/contracts/src/v2";
import { buildNavigation, entitlementsFromKeys } from "../index";
import { presentMyPermissions, presentNavigation } from "../http/presenters";
import { ALL_MANIFESTS, CAMPUS_A1, INST_A, T1, U1, authFor } from "./fixtures";
import { campusScope, institutionScope } from "../index";

describe("contrats Zod rbac", () => {
  it("le réexport v2/index.ts expose les schémas", () => {
    expect(v2.rbacScopeSchema).toBe(rbacScopeSchema);
  });

  it("scope : tenant sans id, institution/campus avec UUID, rien d'autre", () => {
    expect(rbacScopeSchema.parse({ type: "tenant" })).toEqual({ type: "tenant" });
    expect(rbacScopeSchema.parse({ type: "campus", id: CAMPUS_A1 })).toEqual({ type: "campus", id: CAMPUS_A1 });
    expect(rbacScopeSchema.safeParse({ type: "tenant", id: CAMPUS_A1 }).success).toBe(false);
    expect(rbacScopeSchema.safeParse({ type: "campus" }).success).toBe(false);
    expect(rbacScopeSchema.safeParse({ type: "campus", id: "pas-un-uuid" }).success).toBe(false);
    expect(rbacScopeSchema.safeParse({ type: "classroom", id: CAMPUS_A1 }).success).toBe(false);
  });

  it("création de rôle : libellé obligatoire, permissions au bon format, champs inconnus refusés", () => {
    const ok = rbacCreateRoleBodySchema.parse({ label: "  Comptable  ", permissions: ["finance.invoice.read"] });
    expect(ok.label).toBe("Comptable");
    expect(rbacCreateRoleBodySchema.parse({ label: "X" }).permissions).toEqual([]);
    expect(rbacCreateRoleBodySchema.safeParse({ label: "" }).success).toBe(false);
    expect(rbacCreateRoleBodySchema.safeParse({ label: "X", permissions: ["finance.*"] }).success).toBe(false);
    expect(rbacCreateRoleBodySchema.safeParse({ label: "X", isSystem: true }).success).toBe(false);
    expect(rbacCreateRoleBodySchema.safeParse({ label: "X", key: "Bad Key" }).success).toBe(false);
  });

  it("clonage et modification", () => {
    expect(rbacCloneRoleBodySchema.safeParse({ label: "Copie" }).success).toBe(true);
    expect(rbacCloneRoleBodySchema.safeParse({}).success).toBe(false);
    expect(rbacUpdateRoleBodySchema.safeParse({}).success).toBe(false);
    expect(rbacUpdateRoleBodySchema.safeParse({ description: null }).success).toBe(true);
    expect(rbacUpdateRoleBodySchema.safeParse({ permissions: [] }).success).toBe(true);
  });

  it("assignation : périmètre tenant par défaut, validité ordonnée", () => {
    const base = { userId: U1, roleId: T1 };
    expect(rbacCreateAssignmentBodySchema.parse(base).scope).toEqual({ type: "tenant" });
    expect(
      rbacCreateAssignmentBodySchema.safeParse({ ...base, validFrom: "2026-10-02T00:00:00Z", validUntil: "2026-10-01T00:00:00Z" }).success,
    ).toBe(false);
    expect(
      rbacCreateAssignmentBodySchema.safeParse({ ...base, validFrom: "2026-10-01T00:00:00Z", validUntil: "2026-10-02T00:00:00Z" }).success,
    ).toBe(true);
    expect(rbacCreateAssignmentBodySchema.safeParse({ ...base, validUntil: "demain" }).success).toBe(false);
    expect(rbacCreateAssignmentBodySchema.safeParse({ userId: "x", roleId: T1 }).success).toBe(false);
    expect(rbacUpdateAssignmentBodySchema.safeParse({}).success).toBe(false);
    expect(rbacUpdateAssignmentBodySchema.safeParse({ validUntil: null }).success).toBe(true);
  });

  it("requête de liste : bornes et coercition", () => {
    expect(rbacListAssignmentsQuerySchema.parse({}).limit).toBe(200);
    expect(rbacListAssignmentsQuerySchema.parse({ limit: "50", offset: "10" })).toMatchObject({ limit: 50, offset: 10 });
    expect(rbacListAssignmentsQuerySchema.safeParse({ limit: "9999" }).success).toBe(false);
    expect(rbacListAssignmentsQuerySchema.safeParse({ userId: "x" }).success).toBe(false);
  });

  it("les présentateurs produisent des réponses conformes au contrat", () => {
    const auth = authFor(
      [
        { permissions: ["grade.read", "grade.publish"], scope: institutionScope(INST_A) },
        { permissions: ["student.list", "grade.enter"], scope: campusScope(CAMPUS_A1) },
      ],
      { sensitive: ["grade.publish"], mfa: false },
    );
    const mine = presentMyPermissions(auth);
    expect(rbacMyPermissionsResponseSchema.parse(mine)).toEqual(mine);
    expect(mine.requiresMfa).toEqual(["grade.publish"]);
    expect(mine.permissions.map((p) => p.key)).toEqual(["grade.enter", "grade.read", "student.list"]);

    const nav = presentNavigation(buildNavigation(ALL_MANIFESTS, auth, entitlementsFromKeys(["assess.advanced-reports"])));
    expect(rbacNavigationResponseSchema.parse(nav)).toEqual(nav);
    expect(nav.availablePortals).toEqual(["admin", "teacher"]);
  });
});
