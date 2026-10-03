// @vitest-environment jsdom
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SessionContext } from "next-auth/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, json, Providers, routes } from "@/platform/admin/test-utils";
import { PortalShell } from "@/platform/portal/PortalShell";
import { TenantAdminShell } from "@/platform/admin/shell/TenantAdminShell";
import { expectNoBlockingViolations } from "@/platform/test/axe";

const h = vi.hoisted(() => {
  const replace = vi.fn();
  const refresh = vi.fn();
  return {
    fetchMock: vi.fn(),
    replace,
    refresh,
    router: { replace, push: vi.fn(), refresh },
    session: null as null | { activeRole: string; roles: string[]; shape: string },
    permissionsFor: vi.fn(),
  };
});
vi.mock("@/platform/api/default-client", async () => (await import("@/platform/admin/test-utils")).defaultClientModule(h.fetchMock));
let pathname = "/v2/finance/invoices";
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => h.router }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/platform/auth/iam-config", () => ({ isAuthV2: () => true }));
vi.mock("@/lib/jwt-storage", () => ({ saveToken: vi.fn(), removeToken: vi.fn() }));
const signOutMock = vi.hoisted(() => vi.fn());
vi.mock("@/platform/offline/purge", () => ({ purgeOfflineDataBestEffort: () => Promise.resolve() }));
vi.mock("next-auth/react", async () => {
  const actual = await vi.importActual<typeof import("next-auth/react")>("next-auth/react");
  return { ...actual, signOut: signOutMock, getSession: async () => ({ jwtToken: "t", activeRole: "enseignant" }) };
});

const nav = (items: Array<Record<string, unknown>>) => json({ portals: { admin: items, owner: [], teacher: [], parent: [], student: [], "super-admin": [] }, availablePortals: ["admin"] });
const entry = (key: string, label: string, href: string, order = 100, extra: Record<string, unknown> = {}) => ({ key, label, href, portal: "admin", order, permission: "x.read", ...extra });
const perms = (...keys: string[]) => json({ tenantId: "t", userId: "u", mfa: false, permissions: keys.map((key) => ({ key, sensitive: false, scopes: [] })), requiresMfa: [] });

const ECONOME_NAV = [
  entry("finance.invoices", "Facturation", "/admin/finance/factures", 400),
  entry("finance.cash", "Caisse", "/admin/finance/caisse", 420),
  entry("people.students", "Élèves", "/admin/eleves", 100),
  // Entrées sans écran v2 : jamais affichées.
  entry("attendance.settings", "Paramètres de présence", "/admin/attendance/parametres", 500),
  entry("scheduling.calendar", "Calendrier de l'établissement", "/admin/emploi-du-temps/calendrier", 510),
];

function econome(overrides: Record<string, Response | ((...a: never[]) => Response)> = {}) {
  routes(h.fetchMock, {
    "GET /api/v1/rbac/me/navigation": nav(ECONOME_NAV),
    "GET /api/v1/rbac/me/permissions": perms("finance.invoice.read"),
    // Marque minimale lisible par tout membre : le profil complet (403 pour ce rôle) n'est JAMAIS demandé.
    "GET /api/v1/tenancy/branding": json({ name: "École Les Palmiers", logoUrl: null }),
    "GET /api/v1/tenancy/profile": apiError(403, "FORBIDDEN", "Refusé"),
    "GET /api/v1/entitlements/me/features": json({ features: ["finance.online-payment"] }),
    "GET /api/v1/entitlements/me": apiError(403, "FORBIDDEN", "Refusé"),
    ...(overrides as never),
  });
}

function withSession(ui: ReactNode, session?: { name?: string; email?: string; activeRole: string; availableRoles?: string[]; tenantId?: string; tenants?: Array<{ id: string; slug: string; name: string }>; update?: (d?: unknown) => Promise<unknown> }) {
  const value = session
    ? { data: { user: { name: session.name ?? "Awa Koné", email: session.email ?? "awa@ecole.test" }, activeRole: session.activeRole, availableRoles: session.availableRoles ?? [session.activeRole], tenantId: session.tenantId ?? "t1", tenants: session.tenants ?? [] }, status: "authenticated" as const, update: session.update ?? (async () => null) }
    : undefined;
  return render(<SessionContext.Provider value={value as never}><Providers>{ui}</Providers></SessionContext.Provider>);
}

beforeEach(() => {
  h.fetchMock.mockReset();
  h.replace.mockReset();
  h.refresh.mockReset();
  signOutMock.mockReset();
  pathname = "/v2/finance/invoices";
});

describe("coque de gestion (TenantAdminShell)", () => {
  it("économe : en-tête avec le nom de l'établissement, menu de l'API sans entrée sans écran, module et fil d'Ariane", async () => {
    econome();
    withSession(
      <TenantAdminShell>
        <p>Contenu</p>
      </TenantAdminShell>,
      { activeRole: "econome" },
    );
    expect(await screen.findByText("École Les Palmiers")).toBeTruthy();
    const nav = await screen.findByRole("navigation", { name: "Navigation de l'administration", hidden: true });
    await waitFor(() => expect(within(nav).getAllByRole("link", { hidden: true }).length).toBeGreaterThan(0));
    // Menu groupé par module : les groupes sont des boutons ; le module courant (finance) est ouvert.
    expect(within(nav).getByRole("link", { name: "Facturation", hidden: true }).getAttribute("href")).toBe("/v2/finance/invoices");
    expect(within(nav).getByRole("link", { name: "Facturation", hidden: true }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: "Caisse", hidden: true }).getAttribute("href")).toBe("/v2/finance/cash");
    expect(within(nav).queryByRole("link", { name: /Paramètres de présence|Calendrier de l'établissement/, hidden: true })).toBeNull();
    // Fil d'Ariane : Accueil > Finance > Facturation (page courante, jamais un lien).
    const crumbs = screen.getByRole("navigation", { name: "Fil d'Ariane" });
    expect(within(crumbs).getByRole("link", { name: "Accueil" }).getAttribute("href")).toBe("/v2/home");
    expect(within(crumbs).getByRole("link", { name: "Finance" }).getAttribute("href")).toBe("/v2/finance/invoices");
    expect(within(crumbs).getByText("Facturation").getAttribute("aria-current")).toBe("page");
    // Déconnexion toujours visible.
    expect(screen.getByRole("button", { name: "Se déconnecter" })).toBeTruthy();
    expect(screen.getByText("Contenu")).toBeTruthy();
    // Aucune requête condamnée à un 403 : ni profil complet ni abonnement complet.
    const paths = h.fetchMock.mock.calls.map((c) => String(c[0]));
    expect(paths.some((p) => p.endsWith("/tenancy/profile"))).toBe(false);
    expect(paths.some((p) => p.endsWith("/entitlements/me"))).toBe(false);
  });

  it("changement de module : liste des modules accessibles, module courant marqué", async () => {
    econome();
    withSession(
      <TenantAdminShell>
        <p>Contenu</p>
      </TenantAdminShell>,
      { activeRole: "econome" },
    );
    const button = await screen.findByRole("button", { name: "Modules" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Modules" })).toBeTruthy());
    fireEvent.click(button);
    const panel = screen.getByRole("group", { name: "Modules" });
    const links = within(panel).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Personnes", "Finance"]);
    expect(within(panel).getByRole("link", { name: "Finance" }).getAttribute("aria-current")).toBe("true");
    expect(within(panel).getByRole("link", { name: "Personnes" }).getAttribute("href")).toBe("/v2/students");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Modules" })).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("marque indisponible (403/404) et rôle sans droit sur le profil : nom générique, rien ne casse", async () => {
    econome({ "GET /api/v1/tenancy/branding": apiError(403, "FORBIDDEN", "Refusé") });
    withSession(
      <TenantAdminShell>
        <p>Contenu</p>
      </TenantAdminShell>,
      { activeRole: "econome" },
    );
    expect(await screen.findByText("Administration")).toBeTruthy();
    expect(screen.getByText("Contenu")).toBeTruthy();
    await waitFor(() => expect(h.fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/rbac/me/permissions"))).toBe(true));
    expect(h.fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/tenancy/profile"))).toBe(false);
  });

  it("repli : sans point de marque, le profil complet est lu seulement si le compte en a le droit ; abonnement complet en repli des fonctionnalités", async () => {
    routes(h.fetchMock, {
      "GET /api/v1/rbac/me/navigation": nav([entry("finance.online-payments", "Paiements en ligne", "/v2/finance/payments/online", 415, { feature: "finance.online-payment" })]),
      "GET /api/v1/rbac/me/permissions": perms("tenancy.institution.read"),
      "GET /api/v1/tenancy/profile": json({ tenantId: "22222222-2222-4222-8222-222222222222", slug: "ipam", legalName: "IPAM SARL", tradeName: "IPAM Académie", countryCode: "CI", contactName: null, contactEmail: null, contactPhone: null, address: null, branding: { logoUrl: null, primaryColor: null, secondaryColor: null, customDomain: null }, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }),
      "GET /api/v1/entitlements/me": json({ features: ["finance.online-payment"] }),
    });
    withSession(
      <TenantAdminShell>
        <p>Contenu</p>
      </TenantAdminShell>,
      { activeRole: "directeur" },
    );
    expect(await screen.findByText("IPAM Académie")).toBeTruthy();
  });

  it("compte : rôle actif, changement de rôle (nouvelle session puis atterrissage du rôle), changement d'établissement", async () => {
    econome();
    const update = vi.fn(async (data?: unknown) => ((data as { action?: string })?.action === "switch-role" ? {} : null));
    withSession(
      <TenantAdminShell>
        <p>Contenu</p>
      </TenantAdminShell>,
      { activeRole: "econome", availableRoles: ["econome", "enseignant"], tenants: [{ id: "t1", slug: "a", name: "École A" }, { id: "t2", slug: "b", name: "École B" }], update },
    );
    fireEvent.click(await screen.findByRole("button", { name: "Mon compte" }));
    const panel = screen.getByRole("group", { name: "Mon compte" });
    expect(within(panel).getByText("Awa Koné")).toBeTruthy();
    expect(within(panel).getByText("Économe")).toBeTruthy();
    expect(within(panel).getByRole("link", { name: "Sécurité du compte" }).getAttribute("href")).toBe("/v2/account/security");
    expect(within(panel).getByRole("link", { name: "Mes établissements" }).getAttribute("href")).toBe("/v2/account/tenants");
    expect(within(panel).getByRole("button", { name: "École B" })).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: "École A" })).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Enseignant" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ action: "switch-role", activeRole: "enseignant" }));
    await waitFor(() => expect(h.refresh).toHaveBeenCalled());
    expect(h.replace).toHaveBeenCalled();
  });

  it("compte avec un seul rôle et un seul établissement : aucune action de changement", async () => {
    econome();
    withSession(
      <TenantAdminShell>
        <p>Contenu</p>
      </TenantAdminShell>,
      { activeRole: "econome" },
    );
    fireEvent.click(await screen.findByRole("button", { name: "Mon compte" }));
    const panel = screen.getByRole("group", { name: "Mon compte" });
    expect(within(panel).queryByText("Changer de rôle")).toBeNull();
    expect(within(panel).queryByText("Changer d'établissement")).toBeNull();
  });

  it("déconnexion : ferme la session NextAuth vers /login", async () => {
    econome();
    withSession(
      <TenantAdminShell>
        <p>Contenu</p>
      </TenantAdminShell>,
      { activeRole: "econome" },
    );
    fireEvent.click(await screen.findByRole("button", { name: "Se déconnecter" }));
    await waitFor(() => expect(signOutMock).toHaveBeenCalledWith({ callbackUrl: "/login" }));
  });

  it("accessibilité (axe) : coque de gestion, panneau du compte ouvert", async () => {
    econome();
    const { container } = withSession(
      <TenantAdminShell>
        <h1>Facturation</h1>
      </TenantAdminShell>,
      { activeRole: "econome", availableRoles: ["econome", "enseignant"] },
    );
    await screen.findByText("École Les Palmiers");
    await waitFor(() => expect(screen.getByRole("button", { name: "Modules" })).toBeTruthy());
    await expectNoBlockingViolations(container);
    fireEvent.click(screen.getByRole("button", { name: "Mon compte" }));
    await expectNoBlockingViolations(container);
  });
});

describe("coque de portail (PortalShell) : mêmes éléments de navigation pour la famille et l'enseignant", () => {
  const portalRoutes = (permissions: string[], features: string[]) =>
    routes(h.fetchMock, {
      "GET /api/v1/rbac/me/permissions": perms(...permissions),
      "GET /api/v1/tenancy/branding": json({ name: "École Les Palmiers" }),
      "GET /api/v1/entitlements/me/features": json({ features }),
    });

  it("parent : nom de l'établissement, menu selon permissions ET fonctionnalités (sans /entitlements/me), déconnexion, fil d'Ariane", async () => {
    pathname = "/v2/parent/children/c1/results";
    portalRoutes(["student.child.read", "schoollife.child.read", "council.child.read"], ["schoollife.core"]);
    withSession(
      <PortalShell portal="parent">
        <p>Contenu</p>
      </PortalShell>,
      { activeRole: "parent" },
    );
    expect(await screen.findByText("École Les Palmiers")).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Navigation de l'espace parent", hidden: true });
    await waitFor(() => expect(within(nav).getByRole("link", { name: "Vie scolaire", hidden: true })).toBeTruthy());
    // Conseils : permission détenue mais fonctionnalité `councils.core` absente de l'offre -> pas d'entrée.
    expect(within(nav).queryByRole("link", { name: "Décisions du conseil", hidden: true })).toBeNull();
    expect(within(nav).getByRole("link", { name: "Mes enfants", hidden: true }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Se déconnecter" })).toBeTruthy();
    const crumbs = screen.getByRole("navigation", { name: "Fil d'Ariane" });
    expect(within(crumbs).getByRole("link", { name: "Espace parent" }).getAttribute("href")).toBe("/v2/parent");
  });

  it("enseignant : entrées vie scolaire / conseils visibles grâce aux fonctionnalités lisibles par tout membre", async () => {
    pathname = "/v2/schoollife/saisie";
    portalRoutes(["staff.own.read", "schedule.own.read", "schoollife.read", "council.read"], ["schoollife.core", "councils.core"]);
    withSession(
      <PortalShell portal="teacher">
        <p>Écran partagé</p>
      </PortalShell>,
      { activeRole: "enseignant" },
    );
    const nav = screen.getByRole("navigation", { name: "Navigation de l'espace enseignant", hidden: true });
    await waitFor(() => expect(within(nav).getByRole("link", { name: "Saisie vie scolaire", hidden: true }).getAttribute("aria-current")).toBe("page"));
    expect(within(nav).getByRole("link", { name: "Conseils de classe", hidden: true })).toBeTruthy();
  });

  it("accessibilité (axe) : portail parent", async () => {
    pathname = "/v2/parent";
    portalRoutes(["student.child.read"], []);
    const { container } = withSession(
      <PortalShell portal="parent">
        <h1>Mes enfants</h1>
      </PortalShell>,
      { activeRole: "parent" },
    );
    await screen.findByText("École Les Palmiers");
    await expectNoBlockingViolations(container);
  });
});

describe("focus et défilement à chaque changement de page", () => {
  it("le focus passe au contenu (main) quand le chemin change, pas au premier rendu", async () => {
    econome();
    const ui = (
      <TenantAdminShell>
        <p>Contenu</p>
      </TenantAdminShell>
    );
    const { rerender } = withSession(ui, { activeRole: "econome" });
    await screen.findByText("École Les Palmiers");
    expect(document.activeElement).not.toBe(screen.getByRole("main"));
    pathname = "/v2/finance/cash";
    rerender(<SessionContext.Provider value={undefined as never}><Providers>{ui}</Providers></SessionContext.Provider>);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("main")));
  });
});
