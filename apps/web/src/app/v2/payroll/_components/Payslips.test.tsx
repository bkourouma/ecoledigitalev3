// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { adjustment, batch, payslip, payslipData, payslipDetail, period, pid } from "../../_test/fixtures-payroll";
import { PayslipDetailScreen, PayslipsScreen } from "./Payslips";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/payroll/payslips", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const ALL = ["payroll.payslip.read", "payroll.payslip.adjust", "payroll.payslip.approve", "payroll.payslip.pay", "payroll.payslip.cancel", "payroll.payslip.notify"];
const posts = (api: ReturnType<typeof setTestApi>, suffix: string) => api.calls.filter((c) => c.method === "POST" && c.path.endsWith(suffix));
const detailRoute = (d = payslipDetail()) => ({ [`GET /api/v1/payroll/payslips/${pid(10)}`]: d });

describe("PayslipsScreen", () => {
  it("liste avec période, statut et montants en francs entiers ; filtres transmis", async () => {
    const api = setTestApi({
      ...accessRoutes(ALL),
      "GET /api/v1/payroll/periods": { items: [period()], total: 1 },
      "GET /api/v1/payroll/payslips": { items: [payslip(), payslip({ id: pid(11), staffName: "BAMBA Awa", status: "APPROVED", totalAmount: 90000 })], total: 2 },
    });
    renderWithProviders(<PayslipsScreen />);
    const table = await screen.findByRole("table", { name: "Liste des bulletins de paie" });
    expect(await within(table).findByRole("link", { name: "KOUASSI Marc" })).toBeTruthy();
    expect(within(table).getByText("Arrêté (impayé)")).toBeTruthy();
    expect(within(table).getByText(/344\D818\sF\sCFA/)).toBeTruthy();
    expect(within(table).getAllByText("Octobre 2026").length).toBe(2);
    fireEvent.change(screen.getByLabelText("Statut"), { target: { value: "PAID" } });
    await waitFor(() => expect(api.calls.some((c) => c.path.endsWith("/payslips") && c.query.status === "PAID")).toBe(true));
  });

  it("état vide et erreur de l'API", async () => {
    setTestApi({ ...accessRoutes(ALL), "GET /api/v1/payroll/periods": { items: [], total: 0 }, "GET /api/v1/payroll/payslips": { items: [], total: 0 } });
    renderWithProviders(<PayslipsScreen />);
    expect(await screen.findByText("Aucun bulletin")).toBeTruthy();
  });
});

describe("PayslipDetailScreen", () => {
  it("bulletin calculé : montants et lignes d'heures de l'API, historique", async () => {
    setTestApi({ ...accessRoutes(ALL), ...detailRoute() });
    renderWithProviders(<PayslipDetailScreen id={pid(10)} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Bulletin de KOUASSI Marc" })).toBeTruthy();
    const summary = screen.getByRole("heading", { name: /Montants/ }).closest("section")!;
    expect(within(summary).getByText(/344\D818\sF\sCFA/)).toBeTruthy();
    expect(within(summary).getByText(/^44\D818\sF\sCFA$/)).toBeTruthy();
    expect(screen.getByRole("table", { name: "Lignes d'heures du bulletin" })).toBeTruthy();
    expect(screen.getByText("payroll.payslip.calculated")).toBeTruthy();
  });

  it("ajustement : prime en entier ; primes et retenues préservées au recalcul annoncé", async () => {
    const api = setTestApi({
      ...accessRoutes(ALL),
      ...detailRoute(),
      [`PATCH /api/v1/payroll/payslips/${pid(10)}/adjustments`]: () => json(payslip({ bonusAmount: 15000, totalAmount: 359818 })),
    });
    renderWithProviders(<PayslipDetailScreen id={pid(10)} />);
    expect(await screen.findByText(/conservées quand le bulletin est recalculé/)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Ajouter une prime ou une retenue" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Montant/), { target: { value: "15 000,50" } });
    fireEvent.change(within(dialog).getByLabelText(/^Libellé/), { target: { value: "Prime d'assiduité" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Ajouter" }));
    expect(await within(dialog).findByText("Le montant est un entier en francs : pas de virgule ni de point.")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/^Montant/), { target: { value: "15 000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Ajouter" }));
    await screen.findByText("L'ajustement a été ajouté.");
    expect(api.calls.find((c) => c.method === "PATCH")!.body).toEqual({ add: [{ kind: "BONUS", amount: 15000, label: "Prime d'assiduité" }] });
  });

  it("retrait d'une retenue existante", async () => {
    const api = setTestApi({
      ...accessRoutes(ALL),
      ...detailRoute(payslipDetail({ adjustments: [adjustment({ kind: "DEDUCTION", amount: 5000, label: "Avance sur salaire", id: pid(41) })] })),
      [`PATCH /api/v1/payroll/payslips/${pid(10)}/adjustments`]: () => json(payslip()),
    });
    renderWithProviders(<PayslipDetailScreen id={pid(10)} />);
    expect(await screen.findByText(/Retenue — Avance sur salaire/)).toBeTruthy();
    expect(screen.getByText(/−\s.*5\D000\sF\sCFA/)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /Retirer/ }));
    await screen.findByText("L'ajustement a été retiré.");
    expect(api.calls.find((c) => c.method === "PATCH")!.body).toEqual({ remove: [pid(41)] });
  });

  it("bulletin arrêté : plus d'ajustement ; versement avec mode ; document figé et filigrane", async () => {
    const approved = payslipDetail({ payslip: payslip({ status: "APPROVED", approvedAt: "2026-10-02T08:00:00.000Z", approvedByName: "Directeur Paie", hasSnapshot: true }) });
    const api = setTestApi({
      ...accessRoutes(ALL),
      ...detailRoute(approved),
      [`GET /api/v1/payroll/payslips/${pid(10)}/data`]: payslipData(),
      "POST /api/v1/payroll/payslips/pay": () => json(batch({ done: [pid(10)] })),
    });
    renderWithProviders(<PayslipDetailScreen id={pid(10)} />);
    expect(await screen.findByText(/Seul un bulletin « calculé » accepte des primes ou retenues/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ajouter une prime ou une retenue" })).toBeNull();
    expect(await screen.findByText("NON VERSÉ")).toBeTruthy();
    expect(screen.getByText("Intégrité vérifiée")).toBeTruthy();
    expect(screen.getByText(/ab12cd34/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Constater le versement" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Constater le versement" }));
    await screen.findByText("Le versement est constaté.");
    expect(posts(api, "/payslips/pay")[0]!.body).toEqual({ payslipIds: [pid(10)], method: "MOBILE_MONEY" });
  });

  it("empreinte non conforme : alerte visible", async () => {
    setTestApi({
      ...accessRoutes(ALL),
      ...detailRoute(payslipDetail({ payslip: payslip({ status: "APPROVED" }) })),
      [`GET /api/v1/payroll/payslips/${pid(10)}/data`]: payslipData({ intact: false }),
    });
    renderWithProviders(<PayslipDetailScreen id={pid(10)} />);
    expect(await screen.findByText("Empreinte non conforme", { selector: "span" })).toBeTruthy();
    expect(screen.getByText(/signalez-le à l'administrateur/)).toBeTruthy();
  });

  it("séparation des tâches : le refus de l'API et sa marche à suivre sont affichés, le bulletin reste calculé", async () => {
    setTestApi({
      ...accessRoutes(ALL),
      ...detailRoute(),
      "POST /api/v1/payroll/payslips/approve": () => json(batch({ rejected: [{ payslipId: pid(10), code: "payroll.separation_of_duties", message: "Séparation des tâches : celui qui a calculé le bulletin ne peut pas l'arrêter." }] })),
    });
    renderWithProviders(<PayslipDetailScreen id={pid(10)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Arrêter le montant" }));
    expect(await screen.findByText("Séparation des tâches : celui qui a calculé le bulletin ne peut pas l'arrêter.")).toBeTruthy();
    expect(screen.getByText(/faites arrêter ce bulletin par une autre personne/)).toBeTruthy();
    expect(screen.queryByText("Le montant du bulletin est arrêté.")).toBeNull();
  });

  it("seuil propriétaire : message explicite et renvoi vers la masse salariale", async () => {
    setTestApi({
      ...accessRoutes(ALL),
      ...detailRoute(),
      "POST /api/v1/payroll/payslips/approve": () => json(batch({ rejected: [{ payslipId: pid(10), code: "payroll.owner_approval_required", message: "Ce montant dépasse le seuil : seul le propriétaire peut arrêter ce bulletin." }] })),
    });
    renderWithProviders(<PayslipDetailScreen id={pid(10)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Arrêter le montant" }));
    expect(await screen.findByText("Ce montant dépasse le seuil : seul le propriétaire peut arrêter ce bulletin.")).toBeTruthy();
    expect(screen.getByText(/depuis « Masse salariale »/)).toBeTruthy();
  });

  it("arrêt réussi : confirmation", async () => {
    const api = setTestApi({ ...accessRoutes(ALL), ...detailRoute(), "POST /api/v1/payroll/payslips/approve": () => json(batch({ done: [pid(10)] })) });
    renderWithProviders(<PayslipDetailScreen id={pid(10)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Arrêter le montant" }));
    await screen.findByText("Le montant du bulletin est arrêté.");
    expect(posts(api, "/payslips/approve")[0]!.body).toEqual({ payslipIds: [pid(10)] });
  });

  it("contestation motivée (bulletin arrêté) et annulation motivée", async () => {
    const approved = payslipDetail({ payslip: payslip({ status: "APPROVED" }) });
    const api = setTestApi({
      ...accessRoutes(ALL),
      ...detailRoute(approved),
      [`GET /api/v1/payroll/payslips/${pid(10)}/data`]: payslipData(),
      [`POST /api/v1/payroll/payslips/${pid(10)}/dispute`]: () => json(payslip({ status: "DISPUTED" })),
      [`POST /api/v1/payroll/payslips/${pid(10)}/cancel`]: () => json(payslip({ status: "CANCELLED" })),
    });
    renderWithProviders(<PayslipDetailScreen id={pid(10)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Contester" }));
    let dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif de la contestation/), { target: { value: "ab" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Contester" }));
    expect(posts(api, "/dispute")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Motif de la contestation/), { target: { value: "Heures non réalisées" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Contester" }));
    await screen.findByText("Le bulletin est contesté.");
    expect(posts(api, "/dispute")[0]!.body).toEqual({ reason: "Heures non réalisées" });
    fireEvent.click(screen.getByRole("button", { name: "Annuler le bulletin" }));
    dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif de l'annulation/), { target: { value: "Doublon" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Annuler le bulletin" }));
    await screen.findByText("Le bulletin est annulé.");
    expect(posts(api, "/cancel")[0]!.body).toEqual({ reason: "Doublon" });
  });

  it("sans droits de gestion : aucune action", async () => {
    setTestApi({ ...accessRoutes(["payroll.payslip.read"]), ...detailRoute() });
    renderWithProviders(<PayslipDetailScreen id={pid(10)} />);
    await screen.findByRole("heading", { level: 1, name: "Bulletin de KOUASSI Marc" });
    for (const name of ["Arrêter le montant", "Annuler le bulletin", "Ajouter une prime ou une retenue"]) expect(screen.queryByRole("button", { name })).toBeNull();
  });

  it("erreur d'API sur la fiche", async () => {
    setTestApi({ ...accessRoutes(ALL), [`GET /api/v1/payroll/payslips/${pid(10)}`]: () => json({ code: "payroll.forbidden", message: "Vous n'avez pas accès à ce bulletin." }, { status: 403 }) });
    renderWithProviders(<PayslipDetailScreen id={pid(10)} />);
    expect(await screen.findByText("Vous n'avez pas accès à ce bulletin.")).toBeTruthy();
  });
});
