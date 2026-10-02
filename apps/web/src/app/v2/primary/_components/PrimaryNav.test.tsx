// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { renderWithProviders } from "@/platform/test/render";
import { permissionsLoaded } from "../_test/helpers";
import { PRIMARY_ANY_PERMISSION, PRIMARY_GUARDS, type PrimarySection } from "./guards";
import { PrimaryNav } from "./PrimaryNav";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/primary/classe" }));

const PRIMARY_DIR = path.resolve(__dirname, "..");

describe("navigation du pack Primary", () => {
  it("n'affiche que les entrées dont une permission est détenue", async () => {
    const api = setTestApi(accessRoutes(["primary.competency.record", "primary.phrase.read", "primary.council.prepare"], ["primary.competencies"]));
    renderWithProviders(<PrimaryNav />);
    await screen.findByRole("link", { name: "Ma classe" });
    await permissionsLoaded(api);
    const names = screen.getAllByRole("link").map((a) => a.textContent);
    expect(names).toEqual(["Ma classe", "Compétences", "Appréciations", "Conseil des maîtres"]);
    expect(screen.getByRole("link", { name: "Ma classe" }).getAttribute("aria-current")).toBe("page");
  });

  it("la direction voit avancement, bilans, archives, états et paramètres", async () => {
    const api = setTestApi(accessRoutes(["primary.report.read", "primary.class.read_all", "primary.bilan.read", "primary.archive.prepare", "primary.settings.manage", "primary.council.manage"], []));
    renderWithProviders(<PrimaryNav />);
    await screen.findByRole("link", { name: "Paramètres" });
    await permissionsLoaded(api);
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["Ma classe", "Conseil des maîtres", "Avancement", "Bilans annuels", "Archives", "États", "Paramètres"]);
  });

  it("un parent ne voit que son espace", async () => {
    const api = setTestApi(accessRoutes(["primary.bilan.child.read"], []));
    renderWithProviders(<PrimaryNav />);
    await screen.findByRole("link", { name: "Bulletin et compétences" });
    await permissionsLoaded(api);
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});

describe("gardes serveur des sections", () => {
  const sections = Object.keys(PRIMARY_GUARDS) as PrimarySection[];

  it("chaque section a un layout.tsx qui applique SA garde (requireAnyPermission, fail-closed) et une page mince", () => {
    for (const section of sections) {
      const layout = fs.readFileSync(path.join(PRIMARY_DIR, section, "layout.tsx"), "utf8");
      expect(layout, section).toContain("requireAnyPermission");
      expect(layout, section).toMatch(new RegExp(`PRIMARY_GUARDS(\\.${section.replace("-", "\\-")}|\\["${section}"\\])`));
      expect(fs.existsSync(path.join(PRIMARY_DIR, section, "page.tsx")), section).toBe(true);
    }
  });

  it("le layout racine exige l'une des permissions du pack et pose le <main>", () => {
    const root = fs.readFileSync(path.join(PRIMARY_DIR, "layout.tsx"), "utf8");
    expect(root).toContain("requireAnyPermission(...PRIMARY_ANY_PERMISSION)");
    expect(root).toContain("<main");
    for (const permissions of Object.values(PRIMARY_GUARDS)) for (const p of permissions) expect(PRIMARY_ANY_PERMISSION).toContain(p);
  });

  it("toutes les permissions des gardes existent dans le manifeste de l'API", () => {
    const manifest = fs.readFileSync(path.resolve(__dirname, "../../../../../../api/src/modules/primary_school/manifest.ts"), "utf8");
    const declared = new Set([...manifest.matchAll(/key: "(primary\.[a-z_.]+)"/g)].map((m) => m[1]));
    const unknown = PRIMARY_ANY_PERMISSION.filter((p) => !declared.has(p));
    expect(unknown).toEqual([]);
  });

  it("les routes du manifeste (menus) correspondent aux sections livrées", () => {
    const manifest = fs.readFileSync(path.resolve(__dirname, "../../../../../../api/src/modules/primary_school/manifest.ts"), "utf8");
    const hrefs = [...manifest.matchAll(/href: "\/v2\/primary\/([a-z-]+)"/g)].map((m) => m[1]!);
    expect(hrefs.length).toBeGreaterThan(5);
    for (const h of hrefs) expect(sections, h).toContain(h);
  });
});
