import { describe, expect, it } from "vitest";
import { defineModule, resolveModuleOrder } from "@ecoledigitale/kernel";
import {
  SYSTEM_ROLE_TEMPLATES,
  buildPermissionCatalog,
  matchesPermissionPattern,
  rbacManifest,
  resolvePatterns,
  resolveSystemRoles,
} from "../index";
import { expandPattern, isValidPermissionPattern } from "../domain/permission-catalog";
import { validateTemplates, ROLE_KEY_RE } from "../domain/system-roles";
import { SYSTEM_ROLE_KEYS, isReservedRoleKey, type SystemRoleTemplate } from "../templates/system-roles";
import { ALL_MANIFESTS, assessManifest, financeManifest, studentManifest } from "./fixtures";

describe("buildPermissionCatalog (pure)", () => {
  it("agrège les permissions de tous les manifestes, triées, avec module d'origine et sensibilité", () => {
    const catalog = buildPermissionCatalog(ALL_MANIFESTS);
    expect(catalog.keys).toEqual([...catalog.keys].sort());
    expect(catalog.byKey.get("grade.publish")).toMatchObject({ moduleKey: "assess", sensitive: true, label: "Publier les notes" });
    expect(catalog.byKey.get("rbac.role.read")).toMatchObject({ moduleKey: "rbac", sensitive: false });
    expect(catalog.byKey.get("rbac.role.manage")?.sensitive).toBe(true);
    expect(catalog.byKey.get("finance.invoice.read")?.description).toBeNull();
    const total = ALL_MANIFESTS.reduce((n, m) => n + m.permissions.length, 0);
    expect(catalog.entries).toHaveLength(total);
  });

  it("est déterministe (indépendant de l'ordre des manifestes)", () => {
    const a = buildPermissionCatalog(ALL_MANIFESTS);
    const b = buildPermissionCatalog([...ALL_MANIFESTS].reverse());
    expect(b.keys).toEqual(a.keys);
  });

  it("ne mute pas ses entrées et renvoie des structures gelées", () => {
    const catalog = buildPermissionCatalog(ALL_MANIFESTS);
    expect(Object.isFrozen(catalog.entries)).toBe(true);
    expect(Object.isFrozen(catalog.entries[0])).toBe(true);
  });

  it("refuse une permission déclarée par deux modules", () => {
    const clone = defineModule({
      key: "clone",
      title: "Clone",
      packs: ["CORE"],
      permissions: [{ key: "grade.read", label: "Doublon" }],
    });
    expect(() => buildPermissionCatalog([assessManifest, clone])).toThrow(/déclarée par "assess" et "clone"/);
  });

  it("accepte un catalogue vide", () => {
    expect(buildPermissionCatalog([]).entries).toHaveLength(0);
  });

  it("le module rbac déclare ses propres permissions et reste sans dépendance", () => {
    expect(rbacManifest.key).toBe("rbac");
    expect(rbacManifest.packs).toEqual(["CORE"]);
    expect(rbacManifest.dependsOn).toEqual([]);
    expect(rbacManifest.permissions.map((p) => p.key).sort()).toEqual(["rbac.assignment.manage", "rbac.role.manage", "rbac.role.read"]);
    expect(rbacManifest.events.publishes).toEqual(["rbac.role.changed", "rbac.assignment.changed"]);
  });

  it("le manifeste rbac s'assemble avec d'autres modules (ordre topologique valide)", () => {
    expect(resolveModuleOrder(ALL_MANIFESTS).map((m) => m.key)).toContain("rbac");
  });
});

describe("motifs de permissions", () => {
  it("valide la grammaire des motifs", () => {
    for (const ok of ["*", "finance.*", "finance.payment.*", "*.self.read", "*.child.*", "student.read", "a.b.c.d"]) {
      expect(isValidPermissionPattern(ok), ok).toBe(true);
    }
    for (const ko of ["", "finance", "Finance.*", "finance.**", "finance..read", "a.b.c.d.e", "finance.*x", ".*", "finance.read ", "fin-ance.read"]) {
      expect(isValidPermissionPattern(ko), ko).toBe(false);
    }
  });

  it("clé exacte : égalité stricte", () => {
    expect(matchesPermissionPattern("student.read", "student.read")).toBe(true);
    expect(matchesPermissionPattern("student.read", "student.read.own")).toBe(false);
    expect(matchesPermissionPattern("student.read", "student.list")).toBe(false);
  });

  it("`ressource.*` : un ou plusieurs segments restants, jamais la ressource seule ni un préfixe partiel", () => {
    expect(matchesPermissionPattern("finance.*", "finance.invoice.read")).toBe(true);
    expect(matchesPermissionPattern("finance.*", "finance.payment.create")).toBe(true);
    expect(matchesPermissionPattern("finance.*", "finance.child.read")).toBe(true);
    expect(matchesPermissionPattern("finance.*", "finances.invoice.read")).toBe(false);
    expect(matchesPermissionPattern("finance.*", "student.read")).toBe(false);
    expect(matchesPermissionPattern("finance.payment.*", "finance.payment.create")).toBe(true);
    expect(matchesPermissionPattern("finance.payment.*", "finance.invoice.read")).toBe(false);
    expect(matchesPermissionPattern("finance.payment.*", "finance.payment")).toBe(false);
  });

  it("`*` non final : exactement un segment", () => {
    expect(matchesPermissionPattern("*.self.read", "grade.self.read")).toBe(true);
    expect(matchesPermissionPattern("*.self.read", "finance.self.read")).toBe(true);
    expect(matchesPermissionPattern("*.self.read", "grade.read")).toBe(false);
    expect(matchesPermissionPattern("*.self.read", "grade.self.write")).toBe(false);
    expect(matchesPermissionPattern("*.self.read", "a.b.self.read")).toBe(false);
  });

  it("`*` seul : tout", () => {
    expect(matchesPermissionPattern("*", "anything.at_all")).toBe(true);
  });

  it("expandPattern ne désigne que des clés du catalogue", () => {
    const catalog = buildPermissionCatalog(ALL_MANIFESTS);
    expect(expandPattern("finance.invoice.*", catalog)).toEqual(["finance.invoice.create", "finance.invoice.read"]);
    expect(expandPattern("student.read", catalog)).toEqual(["student.read"]);
    expect(expandPattern("student.nope", catalog)).toEqual([]);
    expect(expandPattern("*", catalog)).toHaveLength(catalog.keys.length);
  });

  it("resolvePatterns : octrois moins exclusions, motifs sans correspondance en attente", () => {
    const catalog = buildPermissionCatalog(ALL_MANIFESTS);
    const r = resolvePatterns(["finance.*", "grade.read", "payroll.*", "student.imaginary"], ["finance.settings.*", "finance.payment.create"], catalog);
    expect(r.resolved).toContain("finance.invoice.read");
    expect(r.resolved).toContain("grade.read");
    expect(r.resolved).not.toContain("finance.settings.manage");
    expect(r.resolved).not.toContain("finance.payment.create");
    expect(r.pending).toEqual(["payroll.*", "student.imaginary"]);
  });

  it("resolvePatterns : une clé retirée par `except` n'est pas « en attente »", () => {
    const catalog = buildPermissionCatalog(ALL_MANIFESTS);
    const r = resolvePatterns(["finance.payment.create"], ["finance.payment.create"], catalog);
    expect(r.resolved).toEqual([]);
    expect(r.pending).toEqual([]);
  });

  it("resolvePatterns refuse un motif mal formé", () => {
    const catalog = buildPermissionCatalog(ALL_MANIFESTS);
    expect(() => resolvePatterns(["finance"], [], catalog)).toThrow(/Motif de permission invalide/);
    expect(() => resolvePatterns(["finance.*"], ["Bad.*"], catalog)).toThrow(/invalide/);
  });
});

describe("modèles de rôles système", () => {
  it("expose les dix modèles du plan, clés uniques et réservées", () => {
    expect(SYSTEM_ROLE_KEYS).toEqual([
      "owner",
      "directeur",
      "directeur_etudes",
      "secretariat",
      "econome",
      "enseignant",
      "educateur",
      "responsable_pedagogique",
      "parent",
      "eleve",
    ]);
    expect(new Set(SYSTEM_ROLE_KEYS).size).toBe(10);
    for (const key of SYSTEM_ROLE_KEYS) {
      expect(ROLE_KEY_RE.test(key)).toBe(true);
      expect(isReservedRoleKey(key)).toBe(true);
    }
    expect(isReservedRoleKey("comptable")).toBe(false);
  });

  it("tous les modèles sont structurellement valides (libellés en français, motifs bien formés)", () => {
    expect(() => validateTemplates()).not.toThrow();
    for (const t of SYSTEM_ROLE_TEMPLATES) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.permissions.length).toBeGreaterThan(0);
    }
  });

  it("validateTemplates refuse doublon, clé invalide et motif invalide", () => {
    const base: SystemRoleTemplate = { key: "x_role", label: "X", description: "d", permissions: ["a.b"] };
    expect(() => validateTemplates([base, base])).toThrow(/dupliqué/);
    expect(() => validateTemplates([{ ...base, key: "Bad Key" }])).toThrow(/clé invalide/);
    expect(() => validateTemplates([{ ...base, permissions: ["nope"] }])).toThrow(/motif/);
    expect(() => validateTemplates([{ ...base, except: ["N.o"] }])).toThrow(/motif/);
    expect(() => validateTemplates([{ ...base, label: "  " }])).toThrow(/libellé/);
  });

  const catalog = buildPermissionCatalog(ALL_MANIFESTS);
  const roles = new Map(resolveSystemRoles(catalog).map((r) => [r.template.key, r]));
  const perms = (key: string): readonly string[] => roles.get(key)?.permissions ?? [];

  it("owner reçoit TOUT le catalogue", () => {
    expect(perms("owner")).toEqual(catalog.keys);
    expect(roles.get("owner")?.pending).toEqual([]);
  });

  it("directeur : tout sauf abonnement, clôture et définition des rôles", () => {
    expect(perms("directeur")).toContain("grade.publish");
    expect(perms("directeur")).toContain("rbac.assignment.manage");
    expect(perms("directeur")).not.toContain("rbac.role.manage");
    expect(perms("directeur")).not.toContain("tenant.billing.manage");
    expect(perms("directeur")).not.toContain("tenant.close");
  });

  it("econome : finance complète, pas les notes", () => {
    expect(perms("econome")).toContain("finance.payment.create");
    expect(perms("econome")).toContain("finance.settings.manage");
    expect(perms("econome")).toContain("student.read");
    expect(perms("econome")).not.toContain("grade.enter");
  });

  it("enseignant : saisit les notes mais ne les publie pas", () => {
    expect(perms("enseignant")).toContain("grade.enter");
    expect(perms("enseignant")).toContain("assessment.create");
    expect(perms("enseignant")).not.toContain("grade.publish");
    expect(perms("enseignant")).not.toContain("finance.invoice.read");
  });

  it("secrétariat : dossiers élèves et lecture financière, pas d'encaissement", () => {
    expect(perms("secretariat")).toContain("student.create");
    expect(perms("secretariat")).toContain("finance.invoice.read");
    expect(perms("secretariat")).not.toContain("finance.payment.create");
  });

  it("parent et élève : uniquement portail + données .child. / .self.", () => {
    expect(perms("parent")).toEqual(["finance.child.read", "grade.child.read", "portal.parent.access"]);
    expect(perms("eleve")).toEqual(["grade.self.read", "portal.student.access"]);
  });

  it("directeur des études et responsable pédagogique valident les notes ; l'enseignant non", () => {
    expect(perms("directeur_etudes")).toContain("grade.validate");
    expect(perms("responsable_pedagogique")).toContain("grade.validate");
    expect(perms("responsable_pedagogique")).not.toContain("grade.enter");
    expect(perms("enseignant")).not.toContain("grade.validate");
  });

  it("aucun rôle autre que owner/directeur ne reçoit les permissions du module rbac en gestion de rôles", () => {
    for (const t of SYSTEM_ROLE_TEMPLATES) {
      if (t.key === "owner") continue;
      expect(perms(t.key), t.key).not.toContain("rbac.role.manage");
    }
  });

  it("les motifs sans correspondance sont signalés en attente, pas perdus", () => {
    // Le catalogue de test n'a ni `payroll.*`, ni `attendance.*`, ni `curriculum.*`…
    expect(roles.get("econome")?.pending).toContain("payroll.*");
    expect(roles.get("enseignant")?.pending).toEqual(expect.arrayContaining(["attendance.read", "attendance.take", "payroll.own.*"]));
    expect(roles.get("educateur")?.pending).toEqual(expect.arrayContaining(["attendance.*", "discipline.*"]));
  });

  it("une fois le module déclaré, les motifs en attente se résolvent (re-résolution)", () => {
    const attendance = defineModule({
      key: "attendance",
      title: "Présences",
      packs: ["CORE"],
      permissions: [
        { key: "attendance.read", label: "Consulter" },
        { key: "attendance.take", label: "Faire l'appel" },
        { key: "attendance.justify", label: "Justifier" },
      ],
    });
    const before = resolveSystemRoles(catalog).find((r) => r.template.key === "enseignant");
    const after = resolveSystemRoles(buildPermissionCatalog([...ALL_MANIFESTS, attendance])).find((r) => r.template.key === "enseignant");
    expect(before?.permissions).not.toContain("attendance.take");
    expect(after?.permissions).toEqual(expect.arrayContaining(["attendance.read", "attendance.take"]));
    expect(after?.permissions).not.toContain("attendance.justify");
    expect(after?.pending).not.toContain("attendance.take");
  });

  it("resolveSystemRoles est pure et déterministe", () => {
    const a = resolveSystemRoles(catalog).map((r) => [r.template.key, r.permissions, r.pending]);
    const b = resolveSystemRoles(catalog).map((r) => [r.template.key, r.permissions, r.pending]);
    expect(b).toEqual(a);
    // les entrées d'octroi à plus d'un motif ne produisent pas de doublons
    for (const r of resolveSystemRoles(catalog)) expect(new Set(r.permissions).size).toBe(r.permissions.length);
  });

  it("n'accorde jamais une permission absente du catalogue", () => {
    for (const r of resolveSystemRoles(catalog)) {
      for (const p of r.permissions) expect(catalog.byKey.has(p), `${r.template.key}:${p}`).toBe(true);
    }
  });

  it("assess + finance + students suffisent à un catalogue de test cohérent", () => {
    expect([assessManifest, financeManifest, studentManifest].every((m) => m.permissions.length > 0)).toBe(true);
  });
});
