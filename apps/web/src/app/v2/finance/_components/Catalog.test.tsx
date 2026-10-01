// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { discount, fee, fid, plan, schedule } from "../../_test/fixtures-finance";
import { DiscountsScreen, FeesScreen, PlansScreen, SchedulesScreen } from "./Catalog";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/finance/fees" }));

const MANAGE = ["finance.fee.read", "finance.fee.manage"];
const institutions = { items: [] };

describe("FeesScreen", () => {
  it("liste les frais avec leur catégorie et leur statut", async () => {
    setTestApi({ ...accessRoutes(MANAGE), "GET /api/v1/finance/fees": { items: [fee(), fee({ id: fid(2), code: "CANT", name: "Cantine", category: "CANTEEN", active: false })] } });
    renderWithProviders(<FeesScreen />);
    const table = await screen.findByRole("table", { name: "Catalogue des frais" });
    expect(await within(table).findByText("Scolarité 6e")).toBeTruthy();
    expect(within(table).getAllByText("Cantine")).toHaveLength(2); // libellé et catégorie
    expect(within(table).getByText("Inactif")).toBeTruthy();
  });

  it("création : validation du contrat puis envoi du corps exact", async () => {
    const api = setTestApi({
      ...accessRoutes(MANAGE),
      "GET /api/v1/finance/fees": { items: [] },
      "POST /api/v1/finance/fees": ({ body }) => json({ ...fee(), ...(body as object), id: fid(5), active: true, description: null, currency: "XOF" }, { status: 201 }),
    });
    renderWithProviders(<FeesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Nouveau frais" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer" }));
    expect((await within(dialog).findAllByRole("alert")).length).toBeGreaterThan(0);
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.change(within(dialog).getByLabelText(/^Code/), { target: { value: "UNI-1" } });
    fireEvent.change(within(dialog).getByLabelText(/^Libellé/), { target: { value: "Uniforme" } });
    fireEvent.change(within(dialog).getByLabelText(/^Catégorie/), { target: { value: "UNIFORM" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer" }));
    await screen.findByText("Le frais « Uniforme » a été créé.");
    expect(api.calls.filter((c) => c.method === "POST").at(-1)!.body).toEqual({ code: "UNI-1", name: "Uniforme", category: "UNIFORM" });
  });

  it("désactivation d'un frais : PATCH du statut", async () => {
    const api = setTestApi({
      ...accessRoutes(MANAGE),
      "GET /api/v1/finance/fees": { items: [fee()] },
      [`PATCH /api/v1/finance/fees/${fid(1)}/status`]: ({ body }) => json({ ...fee(), active: (body as { active: boolean }).active }),
    });
    renderWithProviders(<FeesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Désactiver/ }));
    await screen.findByText("Le frais « Scolarité 6e » est désactivé.");
    expect(api.calls.find((c) => c.method === "PATCH")!.body).toEqual({ active: false });
  });

  it("sans droit de gestion : aucun bouton de création ni d'activation", async () => {
    setTestApi({ ...accessRoutes(["finance.fee.read"]), "GET /api/v1/finance/fees": { items: [fee()] } });
    renderWithProviders(<FeesScreen />);
    await screen.findByText("Scolarité 6e");
    expect(screen.queryByRole("button", { name: "Nouveau frais" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Désactiver/ })).toBeNull();
  });

  it("erreur de l'API : message et bouton Réessayer", async () => {
    setTestApi({ ...accessRoutes(MANAGE), "GET /api/v1/finance/fees": () => json({ code: "X", message: "Service indisponible pour le moment." }, { status: 422 }) });
    renderWithProviders(<FeesScreen />);
    expect(await screen.findByText("Service indisponible pour le moment.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeTruthy();
  });
});

describe("SchedulesScreen", () => {
  const base = {
    ...accessRoutes(MANAGE),
    "GET /api/v1/finance/fees": { items: [fee()] },
    "GET /api/v1/tenancy/institutions": institutions,
    "GET /api/v1/academic/years": { items: [] },
    "GET /api/v1/academic/reference/grade-levels": { items: [] },
    "GET /api/v1/finance/installment-plans": { items: [plan()] },
  };

  it("affiche le montant formaté en francs entiers et le périmètre", async () => {
    setTestApi({ ...base, "GET /api/v1/finance/fee-schedules": { items: [schedule()] } });
    renderWithProviders(<SchedulesScreen />);
    const table = await screen.findByRole("table", { name: "Barèmes de frais" });
    await waitFor(() => expect(within(table).getByText(/450\D000\sF\sCFA/)).toBeTruthy());
    expect(within(table).getByText("Niveau 6E")).toBeTruthy();
  });

  it("création : le montant décimal est refusé, un entier est envoyé tel quel", async () => {
    const api = setTestApi({
      ...base,
      "GET /api/v1/finance/fee-schedules": { items: [] },
      "POST /api/v1/finance/fee-schedules": ({ body }) => json({ ...schedule(), amount: { amount: (body as { amount: number }).amount, currency: "XOF" } }, { status: 201 }),
    });
    renderWithProviders(<SchedulesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Nouveau barème" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("option", { name: "Scolarité 6e" });
    fireEvent.change(within(dialog).getByLabelText(/^Frais/), { target: { value: fid(1) } });
    fireEvent.change(within(dialog).getByLabelText(/^Année scolaire/), { target: { value: "2026-2027" } });
    fireEvent.change(within(dialog).getByLabelText(/^Montant/), { target: { value: "450,5" } });
    fireEvent.change(within(dialog).getByLabelText(/^En vigueur à partir du/), { target: { value: "2026-09-01" } });
    fireEvent.change(within(dialog).getByLabelText(/Niveau \(clé\)/), { target: { value: "6E" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer le barème" }));
    expect(await within(dialog).findByText("Le montant est un entier en francs : pas de virgule ni de point.")).toBeTruthy();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.change(within(dialog).getByLabelText(/^Montant/), { target: { value: "450 000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer le barème" }));
    await screen.findByText("Le barème a été créé.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({
      feeId: fid(1),
      academicYear: "2026-2027",
      amount: 450000,
      effectiveFrom: "2026-09-01",
      levelKey: "6E",
    });
  });

  it("résolveur : le montant applicable est celui renvoyé par l'API", async () => {
    const api = setTestApi({
      ...base,
      "GET /api/v1/finance/fee-schedules": { items: [] },
      "GET /api/v1/finance/fee-schedules/resolve": schedule({ amount: { amount: 420000, currency: "XOF" } }),
    });
    renderWithProviders(<SchedulesScreen />);
    const section = (await screen.findByRole("heading", { name: "Quel montant s'applique ?" })).closest("section")!;
    await within(section).findByRole("option", { name: "Scolarité 6e" });
    fireEvent.change(within(section).getByLabelText(/^Frais/), { target: { value: fid(1) } });
    fireEvent.change(within(section).getByLabelText(/^Année scolaire/), { target: { value: "2026-2027" } });
    fireEvent.click(within(section).getByRole("button", { name: "Résoudre" }));
    expect(await within(section).findByText(/420\D000\sF\sCFA/)).toBeTruthy();
    expect(api.calls.find((c) => c.path.endsWith("/resolve"))!.query).toMatchObject({ feeId: fid(1), academicYear: "2026-2027" });
  });
});

describe("PlansScreen", () => {
  it("fonction non incluse dans l'offre : message et pas de bouton de création", async () => {
    setTestApi({ ...accessRoutes(MANAGE, []), "GET /api/v1/finance/installment-plans": { items: [plan()] } });
    renderWithProviders(<PlansScreen />);
    expect(await screen.findByText("Les échéanciers ne sont pas inclus dans l'offre de l'établissement.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Nouveau plan" })).toBeNull();
    expect(screen.getByText("Trois tranches")).toBeTruthy();
  });

  it("création d'un plan : parts pondérées et fixes envoyées en entiers", async () => {
    const api = setTestApi({
      ...accessRoutes(MANAGE, ["finance.installments"]),
      "GET /api/v1/finance/installment-plans": { items: [] },
      "POST /api/v1/finance/installment-plans": () => json(plan(), { status: 201 }),
    });
    renderWithProviders(<PlansScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Nouveau plan" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Code/), { target: { value: "TRI-3" } });
    fireEvent.change(within(dialog).getByLabelText(/^Libellé(?! de l)/), { target: { value: "Trois tranches" } });
    fireEvent.change(within(dialog).getByLabelText(/^Libellé de l'échéance/), { target: { value: "Inscription" } });
    fireEvent.change(within(dialog).getByLabelText(/^Type de part/), { target: { value: "FIXED" } });
    fireEvent.change(within(dialog).getByLabelText(/^Montant fixe/), { target: { value: "100 000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer le plan" }));
    await screen.findByText("Le plan « Trois tranches » a été créé.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({
      code: "TRI-3",
      name: "Trois tranches",
      steps: [{ label: "Inscription", share: { kind: "FIXED", amount: 100000 }, due: { type: "OFFSET_DAYS", days: 0 } }],
    });
  });
});

describe("DiscountsScreen", () => {
  it("remise en pourcentage : 12,5 % est envoyé en 1250 points de base", async () => {
    const api = setTestApi({
      ...accessRoutes(MANAGE),
      "GET /api/v1/finance/discounts": { items: [discount()] },
      "POST /api/v1/finance/discounts": () => json(discount({ id: fid(31), code: "MER", name: "Mérite", bps: 1250 }), { status: 201 }),
    });
    renderWithProviders(<DiscountsScreen />);
    expect(await screen.findByText("10,00 %")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Nouvelle remise" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Code/), { target: { value: "MER" } });
    fireEvent.change(within(dialog).getByLabelText(/^Libellé/), { target: { value: "Mérite" } });
    fireEvent.change(within(dialog).getByLabelText(/^Pourcentage/), { target: { value: "12,5" } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Cumulable/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer" }));
    await screen.findByText("La remise « Mérite » a été créée.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ code: "MER", name: "Mérite", kind: "PERCENT", bps: 1250, stackable: true });
  });

  it("pourcentage hors plage : message, aucun envoi", async () => {
    const api = setTestApi({ ...accessRoutes(MANAGE), "GET /api/v1/finance/discounts": { items: [] } });
    renderWithProviders(<DiscountsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Nouvelle remise" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Code/), { target: { value: "X" } });
    fireEvent.change(within(dialog).getByLabelText(/^Libellé/), { target: { value: "Trop" } });
    fireEvent.change(within(dialog).getByLabelText(/^Pourcentage/), { target: { value: "150" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer" }));
    expect(await within(dialog).findByText("Le pourcentage doit être compris entre 0,01 et 100.")).toBeTruthy();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
  });
});
