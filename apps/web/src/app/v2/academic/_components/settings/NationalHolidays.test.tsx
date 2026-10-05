// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { institution } from "../../../_test/fixtures";
import { NationalHolidaysSection } from "./NationalHolidaysSection";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);

const base = { countryCode: "CI", sourceReference: null, sourceKind: "placeholder", needsConfirmation: true, note: null, active: true, enabled: true };
const national = [
  { ...base, code: "NEW_YEAR", label: "Jour de l'An", recurrence: "FIXED_DATE", month: 1, day: 1 },
  { ...base, code: "ALL_SAINTS", label: "Toussaint", recurrence: "FIXED_DATE", month: 11, day: 1, enabled: false },
  { ...base, code: "EASTER_MONDAY", label: "Lundi de Pâques", recurrence: "MOVABLE", month: null, day: null },
];
const LIST = "GET /api/v1/academic/national-holidays";

describe("Jours fériés nationaux (O-10)", () => {
  it("liste les fêtes préchargées « à confirmer » ; une fête mobile n'a aucune date et renvoie vers le calendrier de l'établissement", async () => {
    const api = setTestApi({ ...accessRoutes(["academic.read", "academic.settings.manage"]), [LIST]: { items: national } });
    renderWithProviders(<NationalHolidaysSection institutionId={institution.id} canManage />);
    const list = await screen.findByRole("list", { name: "Jours fériés nationaux" });
    expect(within(list).getByText("Chaque année le 1 janvier")).toBeTruthy();
    expect(within(list).getByText("Chaque année le 1 novembre")).toBeTruthy();
    expect(within(list).getByText("Fête mobile : date à saisir chaque année")).toBeTruthy();
    expect(within(list).getAllByText("À confirmer")).toHaveLength(3);
    expect(within(list).getAllByText("Désactivé")).toHaveLength(1);
    expect(screen.getByText(/valeurs de démonstration à confirmer/)).toBeTruthy();
    expect(api.calls.find((c) => c.path === "/api/v1/academic/national-holidays")!.query).toEqual({ institutionId: institution.id });
  });

  it("désactiver une fête envoie PUT {institutionId, enabled:false} ; réactiver une fête désactivée envoie enabled:true", async () => {
    const api = setTestApi({
      ...accessRoutes(["academic.read", "academic.settings.manage"]),
      [LIST]: { items: national },
      "PUT /api/v1/academic/national-holidays/NEW_YEAR": () => json({ ...national[0]!, enabled: false }),
      "PUT /api/v1/academic/national-holidays/ALL_SAINTS": () => json({ ...national[1]!, enabled: true }),
    });
    renderWithProviders(<NationalHolidaysSection institutionId={institution.id} canManage />);
    fireEvent.click(await screen.findByRole("button", { name: "Désactiver — Jour de l'An" }));
    await screen.findByText("« Jour de l'An » est désactivé.");
    fireEvent.click(screen.getByRole("button", { name: "Activer — Toussaint" }));
    await waitFor(() => expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(2));
    const puts = api.calls.filter((c) => c.method === "PUT");
    expect(puts[0]!.path).toBe("/api/v1/academic/national-holidays/NEW_YEAR");
    expect(puts[0]!.body).toEqual({ institutionId: institution.id, enabled: false });
    expect(puts[1]!.body).toEqual({ institutionId: institution.id, enabled: true });
  });

  it("lecture seule : aucune action d'activation", async () => {
    setTestApi({ ...accessRoutes(["academic.read"]), [LIST]: { items: national } });
    renderWithProviders(<NationalHolidaysSection institutionId={institution.id} canManage={false} />);
    await screen.findByRole("list", { name: "Jours fériés nationaux" });
    expect(screen.queryByRole("button", { name: /Désactiver|Activer/ })).toBeNull();
  });

  it("calendrier non chargé : état vide explicite", async () => {
    setTestApi({ ...accessRoutes(["academic.read"]), [LIST]: { items: [] } });
    renderWithProviders(<NationalHolidaysSection institutionId={institution.id} canManage={false} />);
    expect(await screen.findByText("Aucun jour férié national disponible")).toBeTruthy();
  });
});
