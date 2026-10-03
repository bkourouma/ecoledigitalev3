import { describe, expect, it } from "vitest";
import { MyFeaturesSchema } from "@/platform/access/types";
import type { MenuItem } from "@/platform/navigation/types";
import { BrandingResponseSchema, normalizeBranding } from "./branding";
import { humanizeKey } from "./labels";
import { activeModuleKey, buildBreadcrumb, buildManagementEntries, groupByModule, moduleKeyOf } from "./modules";
import { MANAGEMENT_ROLES, PORTAL_OF_ROLE, resolveShellKind } from "./resolve-shell";

const item = (key: string, href: string, over: Partial<MenuItem> = {}): MenuItem => ({ key, href, label: key, permission: "x.read", portal: "admin", ...over });

describe("choix de la coque : rôle de la session, jamais l'URL", () => {
  it("rôles de gestion -> coque de gestion ; parent / élève / enseignant -> leur portail", () => {
    for (const role of MANAGEMENT_ROLES) expect(resolveShellKind({ activeRole: role })).toEqual({ kind: "management" });
    expect(resolveShellKind({ activeRole: "parent" })).toEqual({ kind: "portal", portal: "parent" });
    expect(resolveShellKind({ activeRole: "eleve" })).toEqual({ kind: "portal", portal: "student" });
    expect(resolveShellKind({ activeRole: "student" })).toEqual({ kind: "portal", portal: "student" });
    expect(resolveShellKind({ activeRole: "teacher" })).toEqual({ kind: "portal", portal: "teacher" });
    expect(resolveShellKind({ activeRole: "instituteur_maternelle" })).toEqual({ kind: "portal", portal: "teacher" });
    expect(Object.keys(PORTAL_OF_ROLE)).toContain("enseignant");
  });

  it("insensible à la casse ; sans rôle actif, le premier rôle de la session", () => {
    expect(resolveShellKind({ activeRole: "PARENT" })).toEqual({ kind: "portal", portal: "parent" });
    expect(resolveShellKind({ roles: ["Enseignant", "directeur"] })).toEqual({ kind: "portal", portal: "teacher" });
    // un compte multi-rôles : le rôle ACTIF décide (changer de rôle change de coque)
    expect(resolveShellKind({ activeRole: "directeur", roles: ["enseignant", "directeur"] })).toEqual({ kind: "management" });
  });

  it("rôle inconnu : les permissions tranchent, la gestion l'emporte, repli sur la gestion", () => {
    expect(resolveShellKind({ activeRole: "role-v2-x" }, ["student.child.read"])).toEqual({ kind: "portal", portal: "parent" });
    expect(resolveShellKind({ activeRole: "role-v2-x" }, ["student.self.read"])).toEqual({ kind: "portal", portal: "student" });
    expect(resolveShellKind({ activeRole: "role-v2-x" }, ["staff.own.read"])).toEqual({ kind: "portal", portal: "teacher" });
    expect(resolveShellKind({ activeRole: "role-v2-x" }, ["staff.own.read", "people.student.read"])).toEqual({ kind: "management" });
    expect(resolveShellKind({ activeRole: "role-v2-x" }, null)).toEqual({ kind: "management" });
    expect(resolveShellKind({})).toEqual({ kind: "management" });
  });
});

describe("menu de gestion : issu de l'API, sans lien mort ni doublon", () => {
  it("garde les portails admin et owner, retire famille et enseignant", () => {
    const entries = buildManagementEntries({
      apiItems: [
        item("finance.invoices", "/v2/finance/invoices"),
        item("analytics.dashboard", "/v2/direction", { portal: "owner" }),
        item("finance.child", "/v2/parent/finance", { portal: "parent" }),
        item("teacher.x", "/v2/teacher", { portal: "teacher" }),
      ],
    });
    expect(entries.map((e) => e.key)).toEqual(["analytics.dashboard", "finance.invoices"]);
  });

  it("masque les entrées sans écran v2 (et seulement elles), réécrit les routes historiques", () => {
    const withoutScreen = ["attendance.settings", "people.settings", "scheduling.calendar", "scheduling.validation"];
    const entries = buildManagementEntries({
      apiItems: [
        item("attendance.settings", "/admin/attendance/parametres"),
        item("people.settings", "/admin/personnes/parametres"),
        item("scheduling.calendar", "/admin/emploi-du-temps/calendrier"),
        item("scheduling.validation", "/admin/emploi-du-temps/validation"),
        item("people.students", "/v2/students"),
        item("payroll.mass", "/owner/masse-salariale", { portal: "owner" }),
      ],
    });
    expect(entries.map((e) => e.key)).toEqual(["payroll.mass", "people.students"]);
    expect(entries.some((e) => withoutScreen.includes(e.key))).toBe(false);
    expect(entries.every((e) => e.href.startsWith("/v2/"))).toBe(true);
  });

  it("dédoublonne les destinations (deux entrées vers le même écran : la première, par ordre)", () => {
    const entries = buildManagementEntries({
      apiItems: [item("results.periods", "/v2/results", { order: 20 }), item("results.class", "/v2/results", { order: 10 }), item("a", "/v2/assessments?status=SUBMITTED"), item("b", "/v2/assessments")],
    });
    expect(entries.map((e) => e.key)).toEqual(["results.class", "a"]);
  });

  it("regroupe par module (préfixe de la clé ; entrées locales v2.* rangées par écran) et trouve le module actif", () => {
    expect(moduleKeyOf({ key: "finance.invoices" })).toBe("finance");
    expect(moduleKeyOf({ key: "v2.settings" })).toBe("tenancy");
    expect(moduleKeyOf({ key: "v2.access.roles" })).toBe("rbac");
    expect(moduleKeyOf({ key: "v2.audit" })).toBe("audit");
    const items = [item("finance.invoices", "/v2/finance/invoices"), item("finance.cash", "/v2/finance/cash"), item("people.students", "/v2/students")];
    const groups = groupByModule(items);
    expect(groups.map((g) => [g.key, g.href, g.items.length])).toEqual([
      ["finance", "/v2/finance/invoices", 2],
      ["people", "/v2/students", 1],
    ]);
    expect(activeModuleKey(items, "/v2/finance/cash/42")).toBe("finance");
    expect(activeModuleKey(items, "/v2/unknown")).toBeNull();
  });
});

describe("fil d'Ariane", () => {
  const items = [item("finance.invoices", "/v2/finance/invoices", { label: "Facturation" }), item("people.students", "/v2/students", { label: "Élèves" })];
  const base = { items, homeLabel: "Accueil", homeHref: "/v2/home", moduleLabelOf: (k: string) => `M:${k}`, detailLabel: "Détail" };

  it("accueil > module > entrée ; détail : l'entrée devient un lien", () => {
    expect(buildBreadcrumb({ ...base, pathname: "/v2/finance/invoices" })).toEqual([{ label: "Accueil", href: "/v2/home" }, { label: "M:finance", href: "/v2/finance/invoices" }, { label: "Facturation" }]);
    expect(buildBreadcrumb({ ...base, pathname: "/v2/finance/invoices/123" })).toEqual([
      { label: "Accueil", href: "/v2/home" },
      { label: "M:finance", href: "/v2/finance/invoices" },
      { label: "Facturation", href: "/v2/finance/invoices" },
      { label: "Détail" },
    ]);
  });

  it("page d'accueil : un seul élément ; page hors menu : aucune étape inventée ; portail : sans étape module", () => {
    expect(buildBreadcrumb({ ...base, pathname: "/v2/home" })).toEqual([{ label: "Accueil" }]);
    expect(buildBreadcrumb({ ...base, pathname: "/v2/finance/me/receipts" })).toEqual([{ label: "Accueil", href: "/v2/home" }]);
    expect(buildBreadcrumb({ ...base, pathname: "/v2/students", withModule: false })).toEqual([{ label: "Accueil", href: "/v2/home" }, { label: "Élèves" }]);
  });
});

describe("marque et fonctionnalités lisibles par tout membre", () => {
  it("normalise le nom (affichage > commercial > raison sociale) et ne garde qu'un logo https ou interne", () => {
    expect(BrandingResponseSchema.parse({ tradeName: "IPAM Académie", legalName: "IPAM SARL", logoUrl: "https://cdn.example/logo.png" })).toEqual({ name: "IPAM Académie", logoUrl: "https://cdn.example/logo.png" });
    expect(BrandingResponseSchema.parse({ legalName: "IPAM SARL", branding: { logoUrl: "/logo.png" } })).toEqual({ name: "IPAM SARL", logoUrl: "/logo.png" });
    expect(normalizeBranding({ name: "  ", logoUrl: "javascript:alert(1)" })).toEqual({ name: null, logoUrl: null });
    expect(normalizeBranding({ name: "X", logoUrl: "//evil.example/x.png" }).logoUrl).toBeNull();
  });

  it("fonctionnalités : liste de clés, objets {key} ou liste nue", () => {
    expect(MyFeaturesSchema.parse({ features: ["a", { key: "b" }], plan: "PRO" })).toEqual({ features: ["a", "b"], plan: "PRO" });
    expect(MyFeaturesSchema.parse(["a", "b"])).toEqual({ features: ["a", "b"] });
    expect(() => MyFeaturesSchema.parse({ nope: true })).toThrow();
  });

  it("libellé de repli lisible pour un module ou un rôle inconnu", () => {
    expect(humanizeKey("primary_school")).toBe("Primary school");
    expect(humanizeKey("x")).toBe("X");
  });
});
