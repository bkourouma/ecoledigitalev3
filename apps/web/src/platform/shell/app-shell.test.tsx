// @vitest-environment jsdom
import type { ReactNode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { json, Providers, routes } from "@/platform/admin/test-utils";
import { PlatformSidebar } from "@/platform/navigation/PlatformSidebar";
import type { MenuItem } from "@/platform/navigation/types";
import { AppShell } from "./AppShell";
import { moduleKeyOf } from "./modules";

const h = vi.hoisted(() => ({ fetchMock: vi.fn(), requireSession: vi.fn(), fetchPermissions: vi.fn() }));
vi.mock("@/platform/api/default-client", async () => (await import("@/platform/admin/test-utils")).defaultClientModule(h.fetchMock));
vi.mock("@/platform/auth/server", () => ({ requireSession: h.requireSession, fetchPermissions: h.fetchPermissions }));
let pathname = "/v2/finance/me/receipts";
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const perms = (...keys: string[]) => json({ tenantId: "t", userId: "u", mfa: false, permissions: keys.map((key) => ({ key, sensitive: false, scopes: [] })), requiresMfa: [] });

function api(permissions: string[]) {
  routes(h.fetchMock, {
    "GET /api/v1/rbac/me/navigation": json({ portals: { admin: [{ key: "finance.invoices", label: "Facturation", href: "/v2/finance/invoices", portal: "admin", order: 400, permission: "finance.invoice.read" }], owner: [], teacher: [], parent: [], student: [], "super-admin": [] } }),
    "GET /api/v1/rbac/me/permissions": perms(...permissions),
    "GET /api/v1/tenancy/branding": json({ name: "École Les Palmiers" }),
    "GET /api/v1/entitlements/me/features": json({ features: [] }),
  });
}

/** Un même écran de module (`/v2/finance/me/receipts`) servi à la gestion et aux familles. */
async function renderShared(session: { activeRole: string; roles?: string[] }, permissions: string[]) {
  h.requireSession.mockResolvedValue(session);
  api(permissions);
  const element = await AppShell({ children: <p>Écran partagé</p> });
  return render(<Providers>{element}</Providers>);
}

beforeEach(() => {
  h.fetchMock.mockReset();
  h.requireSession.mockReset();
  h.fetchPermissions.mockReset();
  pathname = "/v2/finance/me/receipts";
});

describe("AppShell : la coque dépend de la session, pas de l'URL", () => {
  it("même URL, trois sessions : parent -> portail parent ; élève -> portail élève ; économe -> coque de gestion", async () => {
    const parent = await renderShared({ activeRole: "parent" }, ["student.child.read", "finance.child.read"]);
    expect(await screen.findByRole("navigation", { name: "Navigation de l'espace parent", hidden: true })).toBeTruthy();
    expect(screen.getByText("Écran partagé")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Navigation de l'administration", hidden: true })).toBeNull();
    parent.unmount();

    const student = await renderShared({ activeRole: "eleve" }, ["student.self.read"]);
    expect(await screen.findByRole("navigation", { name: "Navigation de l'espace élève", hidden: true })).toBeTruthy();
    student.unmount();

    await renderShared({ activeRole: "econome" }, ["finance.invoice.read"]);
    expect(await screen.findByRole("navigation", { name: "Navigation de l'administration", hidden: true })).toBeTruthy();
    expect(screen.getByText("Écran partagé")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Navigation de l'espace parent", hidden: true })).toBeNull();
  });

  it("enseignant (instituteur) sur un écran de module partagé : portail enseignant ; propriétaire : gestion", async () => {
    pathname = "/v2/schoollife/saisie";
    const teacher = await renderShared({ activeRole: "instituteur" }, ["staff.own.read"]);
    expect(await screen.findByRole("navigation", { name: "Navigation de l'espace enseignant", hidden: true })).toBeTruthy();
    teacher.unmount();
    await renderShared({ activeRole: "owner" }, ["*"]);
    expect(await screen.findByRole("navigation", { name: "Navigation de l'administration", hidden: true })).toBeTruthy();
  });

  it("rôle inconnu : décidé par les permissions (service indisponible : gestion, dont le menu ne montre que le permis)", async () => {
    h.fetchPermissions.mockResolvedValue(["student.child.read"]);
    const unknown = await renderShared({ activeRole: "role-v2-x" }, ["student.child.read"]);
    expect(await screen.findByRole("navigation", { name: "Navigation de l'espace parent", hidden: true })).toBeTruthy();
    unknown.unmount();
    h.fetchPermissions.mockRejectedValue(new Error("indisponible"));
    await renderShared({ activeRole: "role-v2-x" }, []);
    expect(await screen.findByRole("navigation", { name: "Navigation de l'administration", hidden: true })).toBeTruthy();
  });

  it("session absente : le garde du serveur redirige (AppShell ne rend rien)", async () => {
    h.requireSession.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(AppShell({ children: <p>x</p> })).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("menu latéral groupé par module (coque de gestion)", () => {
  const items: MenuItem[] = [
    ...Array.from({ length: 8 }, (_, i): MenuItem => ({ key: `finance.f${i}`, label: `Finance ${i}`, href: `/v2/finance/f${i}`, permission: "x", portal: "admin", order: i })),
    ...Array.from({ length: 6 }, (_, i): MenuItem => ({ key: `people.p${i}`, label: `Personne ${i}`, href: `/v2/people/p${i}`, permission: "x", portal: "admin", order: 100 + i })),
  ];

  it("un groupe repliable par module ; celui de la page courante est ouvert, les autres se déplient au clavier", async () => {
    render(<PlatformSidebar items={items} activePath="/v2/people/p2" grouping={{ moduleOf: moduleKeyOf, labelOf: (k) => (k === "finance" ? "Finance" : "Personnes") }} />);
    const people = screen.getByRole("button", { name: "Personnes" });
    const finance = screen.getByRole("button", { name: "Finance" });
    expect(people.getAttribute("aria-expanded")).toBe("true");
    expect(finance.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("link", { name: "Personne 2" }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("link", { name: "Finance 0" })).toBeNull();
    finance.click();
    await waitFor(() => expect(within(screen.getByTestId("platform-sidebar")).getByRole("link", { name: "Finance 0" })).toBeTruthy());
  });

  it("peu d'entrées : liste plate, sans groupes", () => {
    render(<PlatformSidebar items={items.slice(0, 3)} activePath="/v2/finance/f0" grouping={{ moduleOf: moduleKeyOf, labelOf: (k) => k }} />);
    expect(screen.queryByRole("button", { name: "finance" })).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });
});
