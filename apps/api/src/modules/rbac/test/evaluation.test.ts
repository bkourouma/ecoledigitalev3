import { describe, expect, it } from "vitest";
import { createRequestContext } from "@ecoledigitale/kernel";
import {
  ANY_SCOPE,
  TENANT_SCOPE,
  buildPermissionSet,
  campusScope,
  can,
  canAll,
  createAuthorizationContext,
  decide,
  effectivePermissions,
  emptyPermissionSet,
  grantedScopes,
  institutionScope,
  scopeTreeFromPairs,
} from "../index";
import { CAMPUS_A1, CAMPUS_A2, CAMPUS_B1, INST_A, INST_B, NOW, T1, T2, U1, U2, authFor, ctxFor } from "./fixtures";

const TREE = scopeTreeFromPairs({ [CAMPUS_A1]: INST_A, [CAMPUS_A2]: INST_A, [CAMPUS_B1]: INST_B });

describe("can — refus par défaut", () => {
  it("refuse tout sans assignation", () => {
    const auth = authFor([]);
    expect(can(auth, "grade.read")).toBe(false);
    expect(can(auth, "grade.read", ANY_SCOPE)).toBe(false);
    expect(can(auth, "grade.read", campusScope(CAMPUS_A1))).toBe(false);
    expect(decide(auth, "grade.read")).toEqual({ allowed: false, reason: "not_granted" });
  });

  it("refuse une permission inconnue ou mal formée, même si l'utilisateur a des droits ailleurs", () => {
    const auth = authFor([{ permissions: ["grade.read"] }]);
    expect(can(auth, "grade.delete")).toBe(false);
    expect(can(auth, "")).toBe(false);
    expect(can(auth, "*")).toBe(false);
    expect(can(auth, "grade.*")).toBe(false);
  });

  it("n'interprète JAMAIS un motif demandé comme un joker (seules les clés concrètes comptent)", () => {
    const auth = authFor([{ permissions: ["grade.read", "grade.enter"] }]);
    expect(can(auth, "grade.*")).toBe(false);
  });

  it("accorde une permission portée par un rôle tenant", () => {
    const auth = authFor([{ permissions: ["grade.read"] }]);
    expect(can(auth, "grade.read")).toBe(true);
    expect(decide(auth, "grade.read")).toEqual({ allowed: true, reason: "granted" });
    expect(can(auth, "grade.enter")).toBe(false);
  });

  it("canAll exige toutes les permissions", () => {
    const auth = authFor([{ permissions: ["grade.read", "grade.enter"] }]);
    expect(canAll(auth, ["grade.read", "grade.enter"])).toBe(true);
    expect(canAll(auth, ["grade.read", "grade.publish"])).toBe(false);
    expect(canAll(auth, [])).toBe(true);
  });

  it("refuse si le PermissionSet n'est pas celui de l'utilisateur/tenant (défense en profondeur)", () => {
    const auth = authFor([{ permissions: ["grade.read"] }]);
    const forged = { ...auth, userId: U2 };
    expect(can(forged, "grade.read")).toBe(false);
    const forgedTenant = { ...auth, tenantId: T2 };
    expect(can(forgedTenant, "grade.read")).toBe(false);
    expect(grantedScopes(forged, "grade.read")).toEqual([]);
  });

  it("createAuthorizationContext refuse un PermissionSet étranger au contexte", () => {
    const ctx = ctxFor();
    const other = emptyPermissionSet(T1, U2, NOW);
    expect(() => createAuthorizationContext({ ctx, permissionSet: other, now: NOW })).toThrow(/étranger/);
    const otherTenant = emptyPermissionSet(T2, U1, NOW);
    expect(() => createAuthorizationContext({ ctx, permissionSet: otherTenant, now: NOW })).toThrow(/étranger/);
    const system = createRequestContext({ tenantId: T1, actor: "system" });
    expect(() => createAuthorizationContext({ ctx: system, permissionSet: emptyPermissionSet(T1, U1, NOW), now: NOW })).toThrow();
  });
});

describe("can — héritage de périmètre", () => {
  it("tenant couvre établissement et campus", () => {
    const auth = authFor([{ permissions: ["student.read"], scope: TENANT_SCOPE }], { tree: TREE });
    expect(can(auth, "student.read", TENANT_SCOPE)).toBe(true);
    expect(can(auth, "student.read", institutionScope(INST_A))).toBe(true);
    expect(can(auth, "student.read", institutionScope(INST_B))).toBe(true);
    expect(can(auth, "student.read", campusScope(CAMPUS_A1))).toBe(true);
    expect(can(auth, "student.read", campusScope(CAMPUS_B1))).toBe(true);
  });

  it("établissement couvre ses campus et lui-même, pas le tenant ni un autre établissement", () => {
    const auth = authFor([{ permissions: ["student.read"], scope: institutionScope(INST_A) }], { tree: TREE });
    expect(can(auth, "student.read", institutionScope(INST_A))).toBe(true);
    expect(can(auth, "student.read", campusScope(CAMPUS_A1))).toBe(true);
    expect(can(auth, "student.read", campusScope(CAMPUS_A2))).toBe(true);
    expect(can(auth, "student.read", institutionScope(INST_B))).toBe(false);
    expect(can(auth, "student.read", campusScope(CAMPUS_B1))).toBe(false);
    expect(can(auth, "student.read", TENANT_SCOPE)).toBe(false);
    expect(decide(auth, "student.read", TENANT_SCOPE).reason).toBe("out_of_scope");
  });

  it("campus ne couvre que lui-même (ni le frère, ni l'établissement, ni le tenant)", () => {
    const auth = authFor([{ permissions: ["student.read"], scope: campusScope(CAMPUS_A1) }], { tree: TREE });
    expect(can(auth, "student.read", campusScope(CAMPUS_A1))).toBe(true);
    expect(can(auth, "student.read", campusScope(CAMPUS_A2))).toBe(false);
    expect(can(auth, "student.read", institutionScope(INST_A))).toBe(false);
    expect(can(auth, "student.read", TENANT_SCOPE)).toBe(false);
  });

  it("sans arbre de périmètres, une assignation d'établissement ne couvre AUCUN campus (échec fermé)", () => {
    const auth = authFor([{ permissions: ["student.read"], scope: institutionScope(INST_A) }]);
    expect(can(auth, "student.read", campusScope(CAMPUS_A1))).toBe(false);
    expect(can(auth, "student.read", institutionScope(INST_A))).toBe(true);
  });

  it("un campus inconnu de l'arbre n'est couvert par aucun établissement", () => {
    const auth = authFor([{ permissions: ["student.read"], scope: institutionScope(INST_A) }], { tree: TREE });
    expect(can(auth, "student.read", campusScope("d4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4"))).toBe(false);
  });

  it("le contexte de requête suffit à relier campus et établissement quand l'arbre l'ignore", () => {
    const ctx = ctxFor({ campusId: CAMPUS_A1, institutionId: INST_A });
    const auth = authFor([{ permissions: ["student.read"], scope: institutionScope(INST_A) }], { ctx });
    expect(can(auth, "student.read", campusScope(CAMPUS_A1))).toBe(true);
    expect(can(auth, "student.read", campusScope(CAMPUS_A2))).toBe(false);
  });

  it("les identifiants de périmètre sont insensibles à la casse", () => {
    const auth = authFor([{ permissions: ["student.read"], scope: campusScope(CAMPUS_A1.toUpperCase()) }], { tree: TREE });
    expect(can(auth, "student.read", campusScope(CAMPUS_A1))).toBe(true);
  });

  it("deux rôles de périmètres différents s'additionnent", () => {
    const auth = authFor(
      [
        { permissions: ["student.read"], scope: campusScope(CAMPUS_A1) },
        { permissions: ["student.read"], scope: campusScope(CAMPUS_B1) },
      ],
      { tree: TREE },
    );
    expect(can(auth, "student.read", campusScope(CAMPUS_A1))).toBe(true);
    expect(can(auth, "student.read", campusScope(CAMPUS_B1))).toBe(true);
    expect(can(auth, "student.read", campusScope(CAMPUS_A2))).toBe(false);
  });
});

describe("can — cible omise = périmètre actif de la requête", () => {
  it("sans périmètre actif, la cible est le tenant : seule une assignation tenant la couvre", () => {
    const campusOnly = authFor([{ permissions: ["student.read"], scope: campusScope(CAMPUS_A1) }], { tree: TREE });
    expect(can(campusOnly, "student.read")).toBe(false);
    const tenantWide = authFor([{ permissions: ["student.read"], scope: TENANT_SCOPE }]);
    expect(can(tenantWide, "student.read")).toBe(true);
  });

  it("avec un campus actif, un rôle de ce campus suffit", () => {
    const ctx = ctxFor({ campusId: CAMPUS_A1 });
    const auth = authFor([{ permissions: ["student.read"], scope: campusScope(CAMPUS_A1) }], { ctx });
    expect(can(auth, "student.read")).toBe(true);
    const wrongCampus = authFor([{ permissions: ["student.read"], scope: campusScope(CAMPUS_A2) }], { ctx });
    expect(can(wrongCampus, "student.read")).toBe(false);
  });

  it("un campus actif auquel l'utilisateur n'a pas droit ne s'obtient pas en le forgeant dans le contexte", () => {
    const ctx = ctxFor({ campusId: CAMPUS_B1, institutionId: INST_B });
    const auth = authFor([{ permissions: ["student.read"], scope: institutionScope(INST_A) }], { ctx });
    expect(can(auth, "student.read")).toBe(false);
  });

  it("un établissement actif est couvert par un rôle d'établissement ou de tenant", () => {
    const ctx = ctxFor({ institutionId: INST_A });
    expect(can(authFor([{ permissions: ["student.read"], scope: institutionScope(INST_A) }], { ctx }), "student.read")).toBe(true);
    expect(can(authFor([{ permissions: ["student.read"], scope: TENANT_SCOPE }], { ctx }), "student.read")).toBe(true);
    expect(can(authFor([{ permissions: ["student.read"], scope: institutionScope(INST_B) }], { ctx }), "student.read")).toBe(false);
  });
});

describe("can — « n'importe quel périmètre » et périmètres accordés", () => {
  const auth = authFor(
    [
      { permissions: ["student.read", "grade.read"], scope: campusScope(CAMPUS_A1) },
      { permissions: ["student.read"], scope: institutionScope(INST_B) },
    ],
    { tree: TREE },
  );

  it("ANY_SCOPE : détenue quelque part", () => {
    expect(can(auth, "student.read", ANY_SCOPE)).toBe(true);
    expect(can(auth, "grade.read", ANY_SCOPE)).toBe(true);
    expect(can(auth, "grade.enter", ANY_SCOPE)).toBe(false);
  });

  it("grantedScopes liste les périmètres, dédupliqués", () => {
    const scopes = grantedScopes(auth, "student.read");
    expect(scopes).toHaveLength(2);
    expect(scopes).toContainEqual(campusScope(CAMPUS_A1));
    expect(scopes).toContainEqual(institutionScope(INST_B));
    expect(grantedScopes(auth, "grade.read")).toEqual([campusScope(CAMPUS_A1)]);
    expect(grantedScopes(auth, "grade.enter")).toEqual([]);
  });

  it("une assignation tenant réduit la liste à [tenant]", () => {
    const wide = authFor([
      { permissions: ["student.read"], scope: campusScope(CAMPUS_A1) },
      { permissions: ["student.read"], scope: TENANT_SCOPE },
    ]);
    expect(grantedScopes(wide, "student.read")).toEqual([TENANT_SCOPE]);
  });

  it("effectivePermissions liste ce qui est utilisable maintenant, trié", () => {
    expect(effectivePermissions(auth)).toEqual(["grade.read", "student.read"]);
  });
});

describe("can — validité (début / fin / expiration)", () => {
  it("refuse avant le début de validité, accorde pendant, refuse à la fin (borne exclue)", () => {
    const grants = [{ permissions: ["grade.read"], validFrom: "2026-10-02T00:00:00.000Z", validUntil: "2026-10-05T00:00:00.000Z" }];
    const at = (iso: string) => authFor(grants, { now: NOW, evalNow: new Date(iso) });
    expect(can(at("2026-10-01T23:59:59.999Z"), "grade.read")).toBe(false);
    expect(decide(at("2026-10-01T23:59:59.999Z"), "grade.read").reason).toBe("not_active");
    expect(can(at("2026-10-02T00:00:00.000Z"), "grade.read")).toBe(true); // début inclus
    expect(can(at("2026-10-04T23:59:59.999Z"), "grade.read")).toBe(true);
    expect(can(at("2026-10-05T00:00:00.000Z"), "grade.read")).toBe(false); // fin exclue
    expect(decide(at("2026-10-05T00:00:00.000Z"), "grade.read").reason).toBe("not_active");
  });

  it("un set chargé AVANT l'expiration cesse d'accorder après (le cache ne prolonge jamais un droit)", () => {
    const auth = authFor([{ permissions: ["grade.read"], validUntil: "2026-10-01T13:00:00.000Z" }], {
      now: NOW,
      evalNow: new Date("2026-10-01T13:00:01.000Z"),
    });
    expect(can(auth, "grade.read")).toBe(false);
  });

  it("ignore à la construction les assignations déjà expirées", () => {
    const auth = authFor([{ permissions: ["grade.read"], validUntil: "2026-09-01T00:00:00.000Z" }]);
    expect(auth.permissionSet.byPermission.size).toBe(0);
    expect(decide(auth, "grade.read").reason).toBe("not_granted");
  });

  it("une fenêtre active d'un autre rôle suffit même si une autre est expirée", () => {
    const auth = authFor(
      [
        { permissions: ["grade.read"], validFrom: "2026-10-10T00:00:00.000Z" },
        { permissions: ["grade.read"] },
      ],
      { now: NOW },
    );
    expect(can(auth, "grade.read")).toBe(true);
  });

  it("grantedScopes ignore les fenêtres non actives", () => {
    const auth = authFor(
      [
        { permissions: ["student.read"], scope: campusScope(CAMPUS_A1), validFrom: "2026-10-10T00:00:00.000Z" },
        { permissions: ["student.read"], scope: campusScope(CAMPUS_A2) },
      ],
      { tree: TREE },
    );
    expect(grantedScopes(auth, "student.read")).toEqual([campusScope(CAMPUS_A2)]);
  });
});

describe("can — permissions sensibles", () => {
  const grants = [{ permissions: ["grade.publish", "grade.read"] }];
  const sensitive = ["grade.publish"];

  it("refusée sans MFA, avec la raison mfa_required", () => {
    const auth = authFor(grants, { sensitive, mfa: false });
    expect(can(auth, "grade.publish")).toBe(false);
    expect(decide(auth, "grade.publish")).toEqual({ allowed: false, reason: "mfa_required" });
    expect(can(auth, "grade.read")).toBe(true);
  });

  it("accordée avec MFA satisfaite", () => {
    const auth = authFor(grants, { sensitive, mfa: true });
    expect(can(auth, "grade.publish")).toBe(true);
  });

  it("la MFA ne remplace pas le droit : sans assignation, avec MFA, c'est non", () => {
    const auth = authFor([{ permissions: ["grade.read"] }], { sensitive, mfa: true });
    expect(can(auth, "grade.publish")).toBe(false);
    expect(decide(auth, "grade.publish").reason).toBe("not_granted");
  });

  it("hors périmètre prime sur MFA manquante (pas de fuite d'information inutile)", () => {
    const auth = authFor([{ permissions: ["grade.publish"], scope: campusScope(CAMPUS_A1) }], { sensitive, mfa: false, tree: TREE });
    expect(decide(auth, "grade.publish", campusScope(CAMPUS_A2)).reason).toBe("out_of_scope");
    expect(decide(auth, "grade.publish", campusScope(CAMPUS_A1)).reason).toBe("mfa_required");
  });

  it("n'apparaît ni dans grantedScopes ni dans effectivePermissions sans MFA", () => {
    const auth = authFor(grants, { sensitive, mfa: false });
    expect(grantedScopes(auth, "grade.publish")).toEqual([]);
    expect(effectivePermissions(auth)).toEqual(["grade.read"]);
  });

  it("une permission non sensible n'exige pas la MFA", () => {
    const auth = authFor([{ permissions: ["grade.read"] }], { sensitive, mfa: false });
    expect(can(auth, "grade.read")).toBe(true);
  });

  it("le champ mfa ne se lit que sur le contexte (un booléen forgé truthy dans un contexte à la main est ignoré)", () => {
    const ctx = ctxFor();
    const forged = { ...ctx, mfa: "yes" } as unknown as typeof ctx;
    const auth = authFor(grants, { sensitive, ctx: forged });
    expect(auth.mfa).toBe(false);
    expect(can(auth, "grade.publish")).toBe(false);
  });
});

describe("buildPermissionSet", () => {
  it("agrège les permissions de plusieurs rôles et normalise les identifiants", () => {
    const set = buildPermissionSet({
      tenantId: T1.toUpperCase(),
      userId: U1.toUpperCase(),
      assignments: [
        { assignmentId: "a1", roleId: "r1", scope: TENANT_SCOPE, validFrom: null, validUntil: null },
        { assignmentId: "a2", roleId: "r2", scope: campusScope(CAMPUS_A1), validFrom: null, validUntil: null },
      ],
      rolePermissions: new Map([
        ["r1", ["grade.read"]],
        ["r2", ["grade.read", "grade.enter"]],
      ]),
      sensitive: [],
      now: NOW,
    });
    expect(set.tenantId).toBe(T1);
    expect(set.userId).toBe(U1);
    expect(set.byPermission.get("grade.read")).toHaveLength(2);
    expect(set.byPermission.get("grade.enter")).toHaveLength(1);
  });

  it("un rôle sans permission ou inconnu n'accorde rien", () => {
    const set = buildPermissionSet({
      tenantId: T1,
      userId: U1,
      assignments: [{ assignmentId: "a1", roleId: "ghost", scope: TENANT_SCOPE, validFrom: null, validUntil: null }],
      rolePermissions: new Map(),
      sensitive: [],
      now: NOW,
    });
    expect(set.byPermission.size).toBe(0);
  });
});
