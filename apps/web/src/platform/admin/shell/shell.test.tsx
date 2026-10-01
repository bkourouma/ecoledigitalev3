// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { json, renderScreen, routes } from "@/platform/admin/test-utils";
import { buildOperatorMenu, buildV2Menu, mapToV2Href, V2_ADMIN_ENTRIES } from "../menu";
import { OperatorShell } from "./OperatorShell";
import { Shell } from "./Shell";
import { TenantAdminShell } from "./TenantAdminShell";
import type { MenuItem } from "@/platform/navigation/types";

const h = vi.hoisted(() => {
  const replace = vi.fn();
  // Le routeur de Next est référentiellement stable : le double doit l'être aussi (sinon les effets bouclent).
  return { fetchMock: vi.fn(), replace, router: { replace, push: vi.fn() } };
});
vi.mock("@/platform/api/default-client", async () => (await import("@/platform/admin/test-utils")).defaultClientModule(h.fetchMock));
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/access/roles", useRouter: () => h.router }));

const item = (over: Partial<MenuItem> & Pick<MenuItem, "key" | "href">): MenuItem => ({
  label: over.key,
  permission: "x.read",
  portal: "admin",
  ...over,
});

describe("menu v2 (fonctions pures)", () => {
  it("réécrit les routes historiques des manifestes vers /v2", () => {
    expect(mapToV2Href("/admin/roles")).toBe("/v2/access/roles");
    expect(mapToV2Href("/admin/roles/attributions")).toBe("/v2/access/assignments");
    expect(mapToV2Href("/admin/audit")).toBe("/v2/audit");
    expect(mapToV2Href("/admin/utilisateurs")).toBe("/admin/utilisateurs");
  });

  it("ajoute les entrées v2 manquantes SEULEMENT si la permission est détenue (échec fermé)", () => {
    const labelOf = (k: string) => `L:${k}`;
    const none = buildV2Menu({ apiItems: [], permissions: null, features: null, labelOf });
    expect(none).toEqual([]);

    const some = buildV2Menu({ apiItems: [], permissions: ["tenancy.institution.read", "audit.read"], features: ["audit.log"], labelOf });
    expect(some.map((i) => i.href)).toEqual(["/v2/settings", "/v2/audit"]);
    expect(some[0]!.label).toBe("L:settings");

    // Feature absente du plan : pas d'entrée d'audit.
    const noFeature = buildV2Menu({ apiItems: [], permissions: ["audit.read"], features: [], labelOf });
    expect(noFeature).toEqual([]);

    // Jokers de permission.
    const wildcard = buildV2Menu({ apiItems: [], permissions: ["*"], features: ["audit.log"], labelOf });
    expect(wildcard).toHaveLength(V2_ADMIN_ENTRIES.length);
  });

  it("l'API fait foi : pas de doublon quand elle renvoie déjà l'entrée (href réécrit)", () => {
    const menu = buildV2Menu({
      apiItems: [item({ key: "rbac.roles", href: "/admin/roles", label: "Rôles et permissions", order: 900 })],
      permissions: ["rbac.role.read"],
      features: [],
      labelOf: (k) => k,
    });
    expect(menu).toHaveLength(1);
    expect(menu[0]).toMatchObject({ key: "rbac.roles", href: "/v2/access/roles", label: "Rôles et permissions" });
  });

  it("menu opérateur statique", () => {
    const menu = buildOperatorMenu((k) => k);
    expect(menu.map((m) => m.href)).toEqual(["/v2/platform/tenants", "/v2/platform/plans", "/v2/platform/audit"]);
    expect(menu.every((m) => m.portal === "super-admin")).toBe(true);
  });
});

describe("Shell", () => {
  const items = [item({ key: "a", href: "/v2/access/roles", label: "Rôles" }), item({ key: "b", href: "/v2/audit", label: "Audit" })];

  it("expose un lien d'évitement, une navigation nommée et marque la page courante", () => {
    renderScreen(
      <Shell items={items} navLabel="Navigation de l'administration" title="Mon école">
        <p>Contenu</p>
      </Shell>,
    );
    expect(screen.getByRole("link", { name: "Aller au contenu" }).getAttribute("href")).toBe("#v2-main");
    const nav = screen.getByRole("navigation", { name: "Navigation de l'administration", hidden: true });
    expect(within(nav).getByRole("link", { name: "Rôles", hidden: true }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: "Audit", hidden: true }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("main").id).toBe("v2-main");
  });

  it("tiroir mobile : bouton accessible, Échap ferme et rend le focus au bouton", () => {
    renderScreen(
      <Shell items={items} navLabel="nav" title="Mon école">
        <p>Contenu</p>
      </Shell>,
    );
    const toggle = screen.getByRole("button", { name: "Ouvrir le menu" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe("v2-sidebar");
    expect(document.getElementById("v2-sidebar")!.className).toContain("invisible");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById("v2-sidebar")!.className).not.toContain("invisible");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
  });

  it("signale un menu indisponible sans bloquer le contenu", () => {
    renderScreen(
      <Shell items={[]} navUnavailable navLabel="nav" title="x">
        <p>Contenu</p>
      </Shell>,
    );
    expect(screen.getByText(/Le menu n'a pas pu être chargé/)).toBeTruthy();
    expect(screen.getByText("Contenu")).toBeTruthy();
  });
});

describe("TenantAdminShell", () => {
  beforeEach(() => h.fetchMock.mockReset());

  it("construit le menu depuis /rbac/me/navigation (forme réelle { portals }) et le nom de l'établissement", async () => {
    routes(h.fetchMock, {
      "GET /api/v1/rbac/me/navigation": json({
        portals: {
          admin: [{ key: "rbac.roles", label: "Rôles et permissions", href: "/admin/roles", portal: "admin", order: 900, moduleKey: "rbac", permission: "rbac.role.read" }],
          teacher: [],
          parent: [],
          student: [],
          owner: [],
          "super-admin": [],
        },
        availablePortals: ["admin"],
      }),
      "GET /api/v1/rbac/me/permissions": json({
        tenantId: "22222222-2222-4222-8222-222222222222",
        userId: "11111111-1111-4111-8111-111111111111",
        mfa: false,
        permissions: [
          { key: "rbac.role.read", sensitive: false, scopes: [{ type: "tenant" }] },
          { key: "tenancy.institution.read", sensitive: false, scopes: [{ type: "tenant" }] },
        ],
        requiresMfa: [],
      }),
      "GET /api/v1/entitlements/me": json({ features: ["audit.log"], planKey: "STARTER" }),
      "GET /api/v1/tenancy/profile": json({
        tenantId: "22222222-2222-4222-8222-222222222222",
        slug: "ipam",
        legalName: "IPAM SARL",
        tradeName: "IPAM Académie",
        countryCode: "CI",
        contactName: null,
        contactEmail: null,
        contactPhone: null,
        address: null,
        branding: { logoUrl: null, primaryColor: "#112233", secondaryColor: null, customDomain: null },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    });
    renderScreen(
      <TenantAdminShell>
        <p>Contenu</p>
      </TenantAdminShell>,
    );
    const nav = await screen.findByRole("navigation", { name: "Navigation de l'administration", hidden: true });
    await waitFor(() => expect(within(nav).getByRole("link", { name: "Rôles et permissions", hidden: true }).getAttribute("href")).toBe("/v2/access/roles"));
    // Entrée v2 absente de l'API mais permise : ajoutée ; entrée refusée (attributions) : absente.
    expect(within(nav).getByRole("link", { name: "Établissement", hidden: true }).getAttribute("href")).toBe("/v2/settings");
    expect(within(nav).queryByRole("link", { name: "Attributions de rôles", hidden: true })).toBeNull();
    expect(await screen.findByText("IPAM Académie")).toBeTruthy();
  });
});

describe("OperatorShell", () => {
  beforeEach(() => {
    h.replace.mockReset();
    localStorage.clear();
  });

  it("sans jeton d'opérateur : redirige vers la connexion et ne rend pas le contenu", async () => {
    renderScreen(
      <OperatorShell>
        <p>Secret</p>
      </OperatorShell>,
    );
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/v2/platform/login"));
    expect(screen.queryByText("Secret")).toBeNull();
  });

  it("avec jeton : coquille, e-mail de l'opérateur et déconnexion", async () => {
    localStorage.setItem("superAdminToken", "tok");
    localStorage.setItem("superAdminEmail", "ops@example.org");
    renderScreen(
      <OperatorShell>
        <p>Console</p>
      </OperatorShell>,
    );
    expect(await screen.findByText("Console")).toBeTruthy();
    expect(screen.getByText("Connecté en tant que ops@example.org")).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Navigation de la console plateforme", hidden: true });
    expect(within(nav).getAllByRole("link", { hidden: true })).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Se déconnecter" }));
    expect(localStorage.getItem("superAdminToken")).toBeNull();
    expect(h.replace).toHaveBeenCalledWith("/v2/platform/login");
  });
});
