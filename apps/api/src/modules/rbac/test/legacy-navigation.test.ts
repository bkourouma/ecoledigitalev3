import { describe, expect, it } from "vitest";
import {
  PORTALS,
  buildNavigation,
  buildPermissionCatalog,
  campusScope,
  coreOnlyEntitlements,
  entitlementsFromKeys,
  legacyRoleToTemplate,
  permissionsForLegacyRoles,
  resolveLegacyRoles,
  scopeTreeFromPairs,
} from "../index";
import { defineModule } from "@ecoledigitale/kernel";
import { ALL_MANIFESTS, CAMPUS_A1, INST_A, authFor } from "./fixtures";

describe("compatibilité legacy", () => {
  it("mappe chaque rôle legacy sur ses modèles v2", () => {
    expect(legacyRoleToTemplate("owner")).toEqual(["owner"]);
    expect(legacyRoleToTemplate("admin")).toEqual(["directeur", "secretariat", "econome"]);
    expect(legacyRoleToTemplate("administrateur")).toEqual(["directeur", "secretariat", "econome"]);
    expect(legacyRoleToTemplate("teacher")).toEqual(["enseignant"]);
    expect(legacyRoleToTemplate("formateur")).toEqual(["enseignant"]);
    expect(legacyRoleToTemplate("student")).toEqual(["eleve"]);
    expect(legacyRoleToTemplate("parent")).toEqual(["parent"]);
  });

  it("est insensible à la casse et aux espaces", () => {
    expect(legacyRoleToTemplate("  Admin ")).toEqual(["directeur", "secretariat", "econome"]);
    expect(legacyRoleToTemplate("TEACHER")).toEqual(["enseignant"]);
  });

  it("super_admin et les rôles inconnus ne donnent RIEN (refus par défaut)", () => {
    expect(legacyRoleToTemplate("super_admin")).toEqual([]);
    expect(legacyRoleToTemplate("root")).toEqual([]);
    expect(legacyRoleToTemplate("")).toEqual([]);
    expect(legacyRoleToTemplate("__proto__")).toEqual([]);
    expect(legacyRoleToTemplate("constructor")).toEqual([]);
    expect(legacyRoleToTemplate(undefined as unknown as string)).toEqual([]);
  });

  it("accepte aussi une clé de modèle v2 telle quelle", () => {
    expect(legacyRoleToTemplate("econome")).toEqual(["econome"]);
    expect(legacyRoleToTemplate("educateur")).toEqual(["educateur"]);
  });

  it("le résultat est une copie (le mapping interne n'est pas mutable)", () => {
    const r = legacyRoleToTemplate("admin");
    r.push("owner");
    expect(legacyRoleToTemplate("admin")).toEqual(["directeur", "secretariat", "econome"]);
  });

  const catalog = buildPermissionCatalog(ALL_MANIFESTS);

  it("permissionsForLegacyRoles : union des modèles, résolue contre le catalogue", () => {
    const admin = permissionsForLegacyRoles(["admin"], catalog);
    expect(admin).toEqual(expect.arrayContaining(["student.create", "finance.payment.create", "grade.publish"]));
    expect(admin).not.toContain("rbac.role.manage");
    expect(admin).not.toContain("entitlements.manage");
    expect(admin).toEqual([...admin].sort());

    const teacher = permissionsForLegacyRoles(["teacher"], catalog);
    expect(teacher).toContain("grade.enter");
    expect(teacher).not.toContain("finance.invoice.read");

    // owner ⊇ admin
    const owner = permissionsForLegacyRoles(["owner"], catalog);
    for (const p of admin) expect(owner).toContain(p);
    expect(owner).toContain("rbac.role.manage");
  });

  it("cumule plusieurs rôles legacy sans doublon", () => {
    const both = permissionsForLegacyRoles(["teacher", "parent"], catalog);
    expect(new Set(both).size).toBe(both.length);
    expect(both).toContain("grade.enter");
    expect(both).toContain("grade.child.read");
  });

  it("resolveLegacyRoles signale les rôles non mappés et les motifs en attente", () => {
    const r = resolveLegacyRoles(["admin", "super_admin", "weird"], catalog);
    expect(r.unmappedRoles).toEqual(["super_admin", "weird"]);
    expect(r.templates).toEqual(["directeur", "econome", "secretariat"]);
    expect(r.pending.length).toBeGreaterThan(0);
    expect(resolveLegacyRoles([], catalog).permissions).toEqual([]);
  });

  it("n'élargit jamais : un rôle legacy ne reçoit rien qui ne soit dans le catalogue", () => {
    for (const role of ["owner", "admin", "teacher", "student", "parent", "formateur"]) {
      for (const p of permissionsForLegacyRoles([role], catalog)) expect(catalog.byKey.has(p)).toBe(true);
    }
  });
});

describe("buildNavigation (pure)", () => {
  const withFeature = (...features: string[]) => entitlementsFromKeys(features);

  it("montre une entrée si la permission est détenue (quelque part) et la feature activée", () => {
    const auth = authFor([{ permissions: ["grade.enter", "student.list", "finance.payment.read", "grade.read"] }]);
    const nav = buildNavigation(ALL_MANIFESTS, auth, withFeature("assess.advanced-reports"));
    expect(nav.portals.teacher.map((i) => i.key)).toEqual(["assess.grades"]);
    expect(nav.portals.admin.map((i) => i.key)).toEqual(["students.list", "assess.reports", "finance.payments"]);
    expect(nav.availablePortals).toEqual(["admin", "teacher"]);
  });

  it("masque l'entrée dont la feature n'est pas activée, même avec la permission", () => {
    const auth = authFor([{ permissions: ["grade.read"] }]);
    expect(buildNavigation(ALL_MANIFESTS, auth, withFeature()).portals.admin).toEqual([]);
    expect(buildNavigation(ALL_MANIFESTS, auth, withFeature("assess.advanced-reports")).portals.admin.map((i) => i.key)).toEqual(["assess.reports"]);
  });

  it("masque l'entrée sans permission, même avec la feature", () => {
    const auth = authFor([{ permissions: ["student.list"] }]);
    const nav = buildNavigation(ALL_MANIFESTS, auth, withFeature("assess.advanced-reports"));
    expect(nav.portals.admin.map((i) => i.key)).toEqual(["students.list"]);
  });

  it("aucun droit = aucun menu, pour tous les portails", () => {
    const nav = buildNavigation(ALL_MANIFESTS, authFor([]), withFeature("assess.advanced-reports"));
    for (const p of PORTALS) expect(nav.portals[p]).toEqual([]);
    expect(nav.availablePortals).toEqual([]);
  });

  it("une permission détenue sur un seul campus fait apparaître le menu (périmètre « any »)", () => {
    const auth = authFor([{ permissions: ["student.list"], scope: campusScope(CAMPUS_A1) }], { tree: scopeTreeFromPairs({ [CAMPUS_A1]: INST_A }) });
    expect(buildNavigation(ALL_MANIFESTS, auth, withFeature()).portals.admin.map((i) => i.key)).toEqual(["students.list"]);
  });

  it("une permission sensible sans MFA masque le menu qui en dépend", () => {
    const sensitiveMenu = defineModule({
      key: "payroll",
      title: "Paie",
      packs: ["CORE"],
      permissions: [{ key: "payroll.run", label: "Lancer la paie", sensitive: true }],
      menus: [{ key: "payroll.run", label: "Paie", href: "/admin/paie", permission: "payroll.run", portal: "admin" }],
    });
    const manifests = [...ALL_MANIFESTS, sensitiveMenu];
    const noMfa = authFor([{ permissions: ["payroll.run"] }], { sensitive: ["payroll.run"], mfa: false });
    const mfa = authFor([{ permissions: ["payroll.run"] }], { sensitive: ["payroll.run"], mfa: true });
    expect(buildNavigation(manifests, noMfa, withFeature()).portals.admin).toEqual([]);
    expect(buildNavigation(manifests, mfa, withFeature()).portals.admin.map((i) => i.key)).toEqual(["payroll.run"]);
  });

  it("trie par ordre puis libellé, avec ordre par défaut en fin de liste", () => {
    const m = defineModule({
      key: "nav",
      title: "Nav",
      packs: ["CORE"],
      permissions: [{ key: "nav.use", label: "Utiliser" }],
      menus: [
        { key: "nav.z", label: "Zèbre", href: "/z", permission: "nav.use", portal: "owner" },
        { key: "nav.a", label: "Abeille", href: "/a", permission: "nav.use", portal: "owner" },
        { key: "nav.first", label: "Premier", href: "/f", permission: "nav.use", portal: "owner", order: 1 },
      ],
    });
    const nav = buildNavigation([m], authFor([{ permissions: ["nav.use"] }]), withFeature());
    expect(nav.portals.owner.map((i) => i.key)).toEqual(["nav.first", "nav.a", "nav.z"]);
  });

  it("ne renvoie pas deux fois une clé de menu dupliquée", () => {
    const a = defineModule({ key: "a", title: "A", packs: ["CORE"], permissions: [{ key: "a.use", label: "x" }], menus: [{ key: "dup", label: "A", href: "/a", permission: "a.use", portal: "admin" }] });
    const b = defineModule({ key: "b", title: "B", packs: ["CORE"], permissions: [{ key: "b.use", label: "x" }], menus: [{ key: "dup", label: "B", href: "/b", permission: "b.use", portal: "admin" }] });
    const nav = buildNavigation([a, b], authFor([{ permissions: ["a.use", "b.use"] }]), withFeature());
    expect(nav.portals.admin).toHaveLength(1);
  });

  it("propage les métadonnées (module, permission, feature, icône)", () => {
    const auth = authFor([{ permissions: ["grade.read"] }]);
    const item = buildNavigation(ALL_MANIFESTS, auth, withFeature("assess.advanced-reports")).portals.admin[0];
    expect(item).toMatchObject({ moduleKey: "assess", permission: "grade.read", feature: "assess.advanced-reports", portal: "admin", order: 20 });
  });

  it("coreOnlyEntitlements : seules les features CORE sont actives par défaut", () => {
    const m = defineModule({
      key: "f",
      title: "F",
      packs: ["CORE"],
      features: [
        { key: "f.core", label: "Core", packs: ["CORE", "HIGHER"] },
        { key: "f.higher", label: "Higher", packs: ["HIGHER"] },
      ],
    });
    const ent = coreOnlyEntitlements([m]);
    expect(ent.isEnabled("f.core")).toBe(true);
    expect(ent.isEnabled("f.higher")).toBe(false);
    expect(ent.isEnabled("unknown")).toBe(false);
  });

  it("construit les menus d'un propriétaire à partir du seul catalogue du module rbac", () => {
    const catalog = buildPermissionCatalog(ALL_MANIFESTS);
    const auth = authFor([{ permissions: catalog.keys }], { sensitive: catalog.entries.filter((e) => e.sensitive).map((e) => e.key), mfa: true });
    const nav = buildNavigation(ALL_MANIFESTS, auth, withFeature("assess.advanced-reports"));
    expect(nav.portals.admin.map((i) => i.key)).toEqual(expect.arrayContaining(["rbac.roles", "rbac.assignments"]));
  });
});
