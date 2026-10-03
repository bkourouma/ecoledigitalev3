// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { renderWithProviders } from "@/platform/test/render";
import { PortalShell } from "./PortalShell";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/parent", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn(), useSession: () => ({ status: "authenticated", data: null }) }));

/** Forme exacte de `GET /api/v1/tenancy/branding` (`TenantBrandingSchema`) : aucun champ manquant, aucun en trop. */
const BRANDING = {
  slug: "palmiers",
  displayName: "Collège Les Palmiers",
  theme: { logoUrl: null, primaryColor: "#112233", secondaryColor: "#445566" },
  locale: "fr-CI",
  timezone: "Africa/Abidjan",
  currencyCode: "XOF",
};

const PARENT_PERMISSIONS = [
  "student.child.read",
  "primary.bilan.child.read",
  "schoollife.child.read",
  "council.child.read",
  "stateassign.child.read",
  "exam.document.child.read",
];
const TEACHER_PERMISSIONS = ["staff.own.read", "schedule.own.read", "attendance.own.read", "schoollife.read", "council.read"];

const linkHrefs = (nav: HTMLElement) => within(nav).getAllByRole("link", { hidden: true }).map((a) => a.getAttribute("href"));

describe("PortalShell : vues minimales ouvertes à tout membre (marque et fonctionnalités)", () => {
  it("parent sans permission de gestion : nom de l'établissement et entrées conditionnées par une fonctionnalité active, sans requête en 403", async () => {
    const api = setTestApi({
      ...accessRoutes(PARENT_PERMISSIONS, ["primary.annual-review", "schoollife.core", "councils.core", "stateassign.core", "examinations.core"]),
      "GET /api/v1/tenancy/branding": BRANDING,
    });
    renderWithProviders(<PortalShell portal="parent">contenu</PortalShell>);

    expect(await screen.findByText("Collège Les Palmiers")).toBeTruthy();
    const nav = await screen.findByRole("navigation", { name: "Navigation de l'espace parent", hidden: true });
    await waitFor(() => expect(linkHrefs(nav)).toContain("/v2/examinations/family"));
    expect(linkHrefs(nav)).toEqual(
      expect.arrayContaining(["/v2/primary/mon-enfant", "/v2/schoollife/famille", "/v2/councils/famille", "/v2/stateassign/family", "/v2/examinations/family"]),
    );

    // Les routes réservées à la gestion ne sont jamais appelées : plus de 403 systématique à chaque page.
    const paths = api.calls.map((c) => c.path);
    expect(paths).toContain("/api/v1/tenancy/branding");
    expect(paths).toContain("/api/v1/entitlements/me/features");
    expect(paths).not.toContain("/api/v1/tenancy/profile");
    expect(paths).not.toContain("/api/v1/entitlements/me");
  });

  it("enseignant : les entrées conditionnées par une fonctionnalité apparaissent quand elle est active, et disparaissent sinon", async () => {
    setTestApi({
      ...accessRoutes(TEACHER_PERMISSIONS, ["attendance.staff", "schoollife.core", "councils.core"]),
      "GET /api/v1/tenancy/branding": BRANDING,
    });
    const on = renderWithProviders(<PortalShell portal="teacher">contenu</PortalShell>);
    const navOn = await screen.findByRole("navigation", { name: "Navigation de l'espace enseignant", hidden: true });
    await waitFor(() => expect(linkHrefs(navOn)).toEqual(expect.arrayContaining(["/v2/schoollife/saisie", "/v2/councils", "/v2/teacher/leaves"])));
    const withFeatures = linkHrefs(navOn);
    on.unmount();

    setTestApi({ ...accessRoutes(TEACHER_PERMISSIONS, []), "GET /api/v1/tenancy/branding": BRANDING });
    renderWithProviders(<PortalShell portal="teacher">contenu</PortalShell>);
    expect(await screen.findByText("Collège Les Palmiers")).toBeTruthy();
    const navOff = await screen.findByRole("navigation", { name: "Navigation de l'espace enseignant", hidden: true });
    await waitFor(() => expect(linkHrefs(navOff).length).toBeGreaterThan(0));
    expect(linkHrefs(navOff).length).toBeLessThan(withFeatures.length);
  });

  it("vraie erreur de la vue des fonctionnalités : repli « échec fermé » (entrées conditionnées masquées), le reste du menu demeure", async () => {
    setTestApi({
      "GET /api/v1/rbac/me/permissions": { permissions: PARENT_PERMISSIONS },
      "GET /api/v1/entitlements/me/features": () => new Response(JSON.stringify({ status: 500, code: "INTERNAL", message: "Erreur." }), { status: 500, headers: { "content-type": "application/json" } }),
      "GET /api/v1/tenancy/branding": BRANDING,
    });
    renderWithProviders(<PortalShell portal="parent">contenu</PortalShell>);
    const nav = await screen.findByRole("navigation", { name: "Navigation de l'espace parent", hidden: true });
    await waitFor(() => expect(linkHrefs(nav)).toContain("/v2/parent"));
    expect(linkHrefs(nav)).not.toContain("/v2/examinations/family");
    expect(linkHrefs(nav)).not.toContain("/v2/schoollife/famille");
  });
});
