// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { institution, period, uuid, year } from "../../_test/fixtures";
import { YearsScreen, YearTimeline } from "./YearsScreen";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);

const ALL = accessRoutes(["academic.year.read", "academic.year.manage", "academic.year.close", "academic.period.read", "academic.period.manage", "academic.period.close", "academic.period.reopen"]);

const periodTypes = { items: [{ id: uuid(950), code: "SEMESTER", label: "Semestre", kind: "TEACHING_PERIOD", active: true }] };

describe("YearsScreen", () => {
  it("liste les années avec leur état et propose les actions de l'état courant", async () => {
    setTestApi({
      ...ALL,
      "GET /api/v1/academic/years": { items: [year({ id: uuid(101), label: "Année 2025-2026", status: "DRAFT" }), year({ id: uuid(102), label: "Année 2026-2027", status: "OPEN", isCurrent: true })] },
      "GET /api/v1/tenancy/institutions": { items: [institution] },
    });
    renderWithProviders(<YearsScreen />);
    const table = await screen.findByRole("table", { name: "Années académiques" });
    expect(await within(table).findByText("Année 2025-2026")).toBeTruthy();
    expect(within(table).getByText("Brouillon")).toBeTruthy();
    expect(within(table).getByText("Courante")).toBeTruthy();
    // Brouillon : « Ouvrir » ; ouverte : « Clôturer » et « Définir comme courante ».
    await waitFor(() => expect(within(table).getByRole("button", { name: /Ouvrir — Année 2025-2026/ })).toBeTruthy());
    expect(within(table).getByRole("button", { name: /Clôturer — Année 2026-2027/ })).toBeTruthy();
    expect(within(table).queryByRole("button", { name: /Ouvrir — Année 2026-2027/ })).toBeNull();
  });

  it("sans permission de gestion, aucune action d'écriture n'est proposée", async () => {
    setTestApi({
      ...accessRoutes(["academic.year.read"]),
      "GET /api/v1/academic/years": { items: [year({ status: "DRAFT" })] },
    });
    renderWithProviders(<YearsScreen />);
    await screen.findByText("Année 2026-2027");
    // Laisse les permissions se charger puis vérifie qu'aucun bouton d'écriture n'est apparu.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Nouvelle année" })).toBeNull());
    expect(screen.queryByRole("button", { name: /Ouvrir —/ })).toBeNull();
  });

  it("ouvrir une année envoie POST /years/:id/open puis affiche la confirmation", async () => {
    const api = setTestApi({
      ...ALL,
      "GET /api/v1/academic/years": { items: [year({ id: uuid(101), label: "Année 2025-2026", status: "DRAFT" })] },
      [`POST /api/v1/academic/years/${uuid(101)}/open`]: year({ id: uuid(101), label: "Année 2025-2026", status: "OPEN" }),
    });
    renderWithProviders(<YearsScreen />);
    const button = await screen.findByRole("button", { name: /Ouvrir — Année 2025-2026/ });
    fireEvent.click(button);
    await screen.findByText("L'année Année 2025-2026 est ouverte.");
    expect(api.calls.some((c) => c.method === "POST" && c.path.endsWith("/open"))).toBe(true);
  });

  it("création : valide avec le contrat Zod (sans appel) puis envoie le corps exact", async () => {
    const api = setTestApi({
      ...ALL,
      "GET /api/v1/academic/years": { items: [] },
      "GET /api/v1/tenancy/institutions": { items: [institution] },
      "POST /api/v1/academic/years": ({ body }) => json(year({ code: (body as { code: string }).code, label: (body as { label: string }).label }), { status: 201 }),
    });
    const { queryClient } = renderWithProviders(<YearsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Nouvelle année" }));
    const dialog = await screen.findByRole("dialog", { name: "Créer une année académique" });
    await waitFor(() => expect(queryClient.getQueryState(["api", "ecole-test", "tenancy", "institutions"])?.status).toBe("success"));
    // Envoi à vide : erreurs de champ, aucune requête d'écriture.
    fireEvent.click(within(dialog).getByRole("button", { name: "Nouvelle année" }));
    await waitFor(() => expect(within(dialog).getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText(/Code/), { target: { value: "2026-2027" } });
    fireEvent.change(within(dialog).getByLabelText(/Libellé/), { target: { value: "Année 2026-2027" } });
    fireEvent.change(within(dialog).getByLabelText(/Début/), { target: { value: "2026-09-01" } });
    await waitFor(() => expect(api.calls.some((c) => c.path === "/api/v1/tenancy/institutions")).toBe(true));
    fireEvent.click(within(dialog).getByRole("button", { name: "Nouvelle année" }));
    await waitFor(() => expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(1), { timeout: 3000 }).catch(() => {
      throw new Error(`Aucun POST ; alertes : ${within(dialog).queryAllByRole("alert").map((a) => a.textContent).join(" | ")}`);
    });
    await screen.findByText("L'année Année 2026-2027 a été créée.");
    const post = api.calls.find((c) => c.method === "POST")!;
    // Un seul établissement : sélectionné d'office ; la fin (facultative) n'est pas envoyée.
    expect(post.body).toEqual({ institutionId: institution.id, code: "2026-2027", label: "Année 2026-2027", startsOn: "2026-09-01" });
  });

  it("clôture : la boîte de dialogue envoie le motif saisi", async () => {
    const api = setTestApi({
      ...ALL,
      "GET /api/v1/academic/years": { items: [year({ id: uuid(102), label: "Année 2026-2027", status: "OPEN" })] },
      [`POST /api/v1/academic/years/${uuid(102)}/close`]: year({ id: uuid(102), status: "CLOSED" }),
    });
    renderWithProviders(<YearsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Clôturer — Année 2026-2027/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif/), { target: { value: "Fin de l'exercice" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Clôturer" }));
    await screen.findByText("L'année Année 2026-2027 est clôturée.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ reason: "Fin de l'exercice" });
  });

  it("affiche l'erreur de l'API quand le chargement échoue", async () => {
    setTestApi({ ...ALL, "GET /api/v1/academic/years": () => json({ code: "FORBIDDEN", message: "Accès refusé aux années." }, { status: 403 }) });
    renderWithProviders(<YearsScreen />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Accès refusé aux années.");
  });

  it("sélection d'une année : périodes, frise et actions par état", async () => {
    setTestApi({
      ...ALL,
      "GET /api/v1/academic/years": { items: [year()] },
      [`GET /api/v1/academic/years/${uuid(100)}/periods`]: { items: [period({ id: uuid(201), status: "OPEN" }), period({ id: uuid(202), label: "Semestre 2", ordinal: 2, code: "S2", startsOn: "2027-02-01", endsOn: "2027-07-31", status: "CLOSED" })] },
      "GET /api/v1/academic/reference/period-types": periodTypes,
    });
    renderWithProviders(<YearsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Périodes" }));
    const table = await screen.findByRole("table", { name: "Périodes de l'année Année 2026-2027" });
    expect(within(table).getByRole("button", { name: /Clore les notes — Semestre 1/ })).toBeTruthy();
    expect(within(table).getByRole("button", { name: /Rouvrir — Semestre 2/ })).toBeTruthy();
    expect(screen.getByRole("figure", { name: "Frise de l'année" })).toBeTruthy();
  });
});

describe("YearTimeline", () => {
  it("positionne les périodes en pourcentage de la durée de l'année", () => {
    renderWithProviders(<YearTimeline year={year({ startsOn: "2026-01-01", endsOn: "2026-12-31" }) as never} periods={[period({ startsOn: "2026-01-01", endsOn: "2026-06-30" }) as never]} />);
    const item = screen.getByRole("listitem");
    expect(parseFloat(item.style.left)).toBeCloseTo(0, 1);
    expect(parseFloat(item.style.width)).toBeGreaterThan(49);
    expect(parseFloat(item.style.width)).toBeLessThan(51);
  });
});
