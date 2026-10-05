// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { IDS, paper, typeDto } from "../_test/fixtures";
import { TypesScreen } from "./TypesScreen";

vi.mock("next/navigation", () => ({ usePathname: () => "/v2/examinations/types", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams("") }));
vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);

const E = "/api/v1/examinations";
afterEach(() => vi.restoreAllMocks());

const routes = (permissions: string[], transmitsToAdmission: boolean, extra: Record<string, unknown> = {}) => ({
  ...accessRoutes(permissions),
  [`GET ${E}/exam-types`]: { items: [typeDto({ transmitsToAdmission })] },
  [`GET ${E}/exam-types/${IDS.type}`]: { ...typeDto({ transmitsToAdmission }), tracks: [], papers: [{ ...paper(1), active: true }], requirements: [] },
  ...extra,
});

describe("Type d'examen : transmission du résultat et de la moyenne aux admissions (Q-E18)", () => {
  it("désactivée par défaut : la gestion peut l'activer (corps exact) ; la consultation ne voit qu'un libellé", async () => {
    const read = setTestApi(routes(["exam.type.read"], false));
    const first = renderWithProviders(<TypesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Afficher le détail" }));
    expect(await screen.findByText("Aucune transmission aux admissions")).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Transmettre le résultat et la moyenne aux admissions" })).toBeNull();
    expect(read.calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
    first.unmount();

    const api = setTestApi(routes(["exam.type.read", "exam.type.manage"], false, { [`PATCH ${E}/exam-types/${IDS.type}`]: () => json(typeDto({ transmitsToAdmission: true })) }));
    renderWithProviders(<TypesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Afficher le détail" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Transmettre le résultat et la moyenne aux admissions" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(api.calls.find((c) => c.method === "PATCH")!.body).toEqual({ transmitsToAdmission: true });
    expect(await screen.findByText("Paramètre enregistré.")).toBeTruthy();
  });

  it("activée (CEPE du pack) : l'écran l'affiche et explique que la moyenne n'est lisible que du personnel habilité", async () => {
    setTestApi(routes(["exam.type.read"], true));
    renderWithProviders(<TypesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Afficher le détail" }));
    expect(await screen.findByText("Transmission aux admissions activée")).toBeTruthy();
    expect(screen.getByText(/La moyenne n'est lisible que du personnel d'admission habilité/)).toBeTruthy();
  });
});
