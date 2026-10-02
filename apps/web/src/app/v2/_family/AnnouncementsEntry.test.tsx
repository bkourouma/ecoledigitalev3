// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { renderWithProviders } from "@/platform/test/render";
import { AnnouncementsEntry } from "./FamilySnapshot";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

describe("AnnouncementsEntry : suit la permission du module messaging, plus de drapeau d'environnement", () => {
  it("parent avec messaging.child.read : lien vers les annonces", async () => {
    setTestApi(accessRoutes(["student.child.read", "messaging.child.read"]));
    renderWithProviders(<AnnouncementsEntry portal="parent" />);
    const link = await screen.findByRole("link", { name: "Ouvrir les annonces" });
    expect(link.getAttribute("href")).toBe("/v2/announcements");
  });

  it("élève avec messaging.self.read : lien ; la permission d'un autre portail ne suffit pas", async () => {
    setTestApi(accessRoutes(["student.self.read", "messaging.self.read"]));
    const first = renderWithProviders(<AnnouncementsEntry portal="student" />);
    expect(await screen.findByRole("link", { name: "Ouvrir les annonces" })).toBeTruthy();
    first.unmount();

    setTestApi(accessRoutes(["student.self.read", "messaging.child.read", "messaging.read"]));
    renderWithProviders(<AnnouncementsEntry portal="student" />);
    await waitFor(() => expect(screen.queryByRole("link")).toBeNull());
    expect(screen.queryByText("Annonces")).toBeNull();
  });

  it("sans permission : aucune carte fantôme", async () => {
    const api = setTestApi(accessRoutes(["student.child.read"]));
    renderWithProviders(<AnnouncementsEntry portal="parent" />);
    // Les permissions sont arrivées (la réponse est reçue) : toujours rien à montrer.
    await waitFor(() => expect(api.calls.some((c) => c.path === "/api/v1/rbac/me/permissions")).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Annonces")).toBeNull();
  });
});
