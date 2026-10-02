// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { uuid } from "../../_test/fixtures";
import { batch, ownerMass, payslip, payslipData, period, pid, summaryReport } from "../../_test/fixtures-payroll";
import { HistoryScreen, MyPayslipScreen, MyPayslipsScreen, OwnerScreen, PayrollReportsScreen } from "./PayrollReports";

const csv = vi.hoisted(() => ({ downloadText: vi.fn() }));
vi.mock("@/platform/ui/csv", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/platform/ui/csv")>()), downloadText: csv.downloadText }));
vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/payroll/history", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const year = { id: pid(2), institutionId: uuid(1), code: "2026-2027", label: "Année 2026-2027", startsOn: "2026-09-01", endsOn: "2027-08-31", status: "OPEN", isCurrent: true, openedAt: null, closedAt: null, archivedAt: null };
const common = { "GET /api/v1/academic/years": { items: [year] }, "GET /api/v1/payroll/periods": { items: [period()], total: 1 } };

describe("HistoryScreen", () => {
  const paid = payslip({ status: "PAID", paidAt: "2026-10-05T10:00:00.000Z", paidByName: "Comptable", paymentMethod: "MOBILE_MONEY", approvedAt: "2026-10-02T08:00:00.000Z", approvedByName: "Directeur" });

  it("liste les bulletins arrêtés avec arrêt, versement et montant ; « impayé » tant que non versé", async () => {
    setTestApi({ ...accessRoutes(["payroll.payslip.read"]), ...common, "GET /api/v1/payroll/history": { items: [paid, payslip({ id: pid(11), staffName: "BAMBA Awa", status: "APPROVED", approvedAt: "2026-10-02T08:00:00.000Z", approvedByName: "Directeur" })], total: 2 } });
    renderWithProviders(<HistoryScreen />);
    const table = await screen.findByRole("table", { name: "Historique des bulletins arrêtés" });
    expect(await within(table).findByText("Versé")).toBeTruthy();
    expect(within(table).getByText("Arrêté (impayé)")).toBeTruthy();
    expect(within(table).getAllByText(/344\D818\sF\sCFA/).length).toBe(2);
    expect(within(table).getByText(/par Comptable \(Mobile money\)/)).toBeTruthy();
  });

  it("changer d'année réinitialise la période", async () => {
    const api = setTestApi({ ...accessRoutes(["payroll.payslip.read"]), ...common, "GET /api/v1/payroll/history": { items: [], total: 0 } });
    renderWithProviders(<HistoryScreen />);
    await screen.findByText("Aucun bulletin arrêté");
    await screen.findByRole("option", { name: "Octobre 2026" });
    fireEvent.change(screen.getByLabelText("Période"), { target: { value: pid(1) } });
    await waitFor(() => expect(api.calls.some((c) => c.path.endsWith("/history") && c.query.periodId === pid(1))).toBe(true));
    await screen.findByRole("option", { name: "Année 2026-2027" });
    fireEvent.change(screen.getByLabelText("Année scolaire"), { target: { value: pid(2) } });
    await waitFor(() => expect(api.calls.at(-1)!.query.periodId).toBeUndefined());
    expect(api.calls.at(-1)!.query.academicYearId).toBe(pid(2));
  });

  it("export CSV produit par l'API (texte), téléchargé tel quel", async () => {
    csv.downloadText.mockClear();
    const api = setTestApi({
      ...accessRoutes(["payroll.payslip.read"]),
      ...common,
      "GET /api/v1/payroll/history": { items: [paid], total: 1 },
      "GET /api/v1/payroll/history/export": () => new Response("﻿Enseignant;Montant\r\nKOUASSI Marc;344818\r\n", { status: 200, headers: { "content-type": "text/csv; charset=utf-8" } }),
    });
    renderWithProviders(<HistoryScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Exporter en CSV" }));
    await waitFor(() => expect(csv.downloadText).toHaveBeenCalled());
    expect(csv.downloadText.mock.calls[0]).toEqual(["historique-paie.csv", "﻿Enseignant;Montant\r\nKOUASSI Marc;344818\r\n"]);
    expect(api.calls.some((c) => c.path.endsWith("/history/export"))).toBe(true);
  });

  it("export refusé (droits, limite de débit) : message sans téléchargement", async () => {
    csv.downloadText.mockClear();
    setTestApi({
      ...accessRoutes(["payroll.payslip.read"]),
      ...common,
      "GET /api/v1/payroll/history": { items: [], total: 0 },
      "GET /api/v1/payroll/history/export": () => json({ code: "payroll.rate_limited", message: "Trop de requêtes." }, { status: 409 }),
    });
    renderWithProviders(<HistoryScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Exporter en CSV" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(csv.downloadText).not.toHaveBeenCalled();
  });
});

describe("PayrollReportsScreen", () => {
  it("ventilation par statut et origine, total filtré et heures par origine tels que calculés par l'API", async () => {
    setTestApi({ ...accessRoutes(["payroll.report.read"]), ...common, "GET /api/v1/payroll/reports/summary": summaryReport() });
    renderWithProviders(<PayrollReportsScreen />);
    const table = await screen.findByRole("table", { name: "Bulletins par statut" });
    expect(within(table).getByText("Arrêté (impayé)")).toBeTruthy();
    expect(within(table).getByText("Versé")).toBeTruthy();
    expect(within(table).getAllByText(/900\D000\sF\sCFA/).length).toBeGreaterThan(0);
    const sources = await screen.findByRole("table", { name: "Heures par origine" });
    expect(within(sources).getByText("200 h")).toBeTruthy();
    expect(within(sources).getByText("150 h")).toBeTruthy();
    expect(screen.getByText("Total de l'origine filtrée :").parentElement!.textContent).toMatch(/900\D000\sF\sCFA/);
  });

  it("filtre d'origine transmis ; export CSV du rapport", async () => {
    csv.downloadText.mockClear();
    const api = setTestApi({
      ...accessRoutes(["payroll.report.read"]),
      ...common,
      "GET /api/v1/payroll/reports/summary": summaryReport(),
      "GET /api/v1/payroll/reports/export": () => new Response("a;b\r\n", { status: 200 }),
    });
    renderWithProviders(<PayrollReportsScreen />);
    await screen.findByRole("table", { name: "Bulletins par statut" });
    fireEvent.change(screen.getByLabelText(/^Origine des heures/), { target: { value: "ATTENDANCE" } });
    await waitFor(() => expect(api.calls.some((c) => c.path.endsWith("/summary") && c.query.source === "ATTENDANCE")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Exporter en CSV" }));
    await waitFor(() => expect(csv.downloadText).toHaveBeenCalledWith("rapport-paie.csv", "\ufeffa;b\r\n"));
    expect(api.calls.find((c) => c.path.endsWith("/reports/export"))!.query).toMatchObject({ source: "ATTENDANCE" });
  });

  it("erreur de l'API", async () => {
    setTestApi({ ...accessRoutes(["payroll.report.read"]), ...common, "GET /api/v1/payroll/reports/summary": () => json({ code: "x", message: "Rapport indisponible." }, { status: 422 }) });
    renderWithProviders(<PayrollReportsScreen />);
    expect(await screen.findByText("Rapport indisponible.")).toBeTruthy();
  });
});

describe("OwnerScreen (masse salariale)", () => {
  const perms = ["payroll.report.read", "payroll.payslip.approve"];

  it("masse comptée, statuts et annulés/contestés montrés à part", async () => {
    setTestApi({ ...accessRoutes(perms, ["payroll.owner-validation"]), "GET /api/v1/payroll/owner/mass": ownerMass() });
    renderWithProviders(<OwnerScreen />);
    const total = (await screen.findByRole("heading", { name: "Masse salariale comptée" })).closest("section")!;
    expect(within(total).getByText(/1\D944\D818\sF\sCFA/)).toBeTruthy();
    expect(screen.getByText(/annulés : 50\D000\sF\sCFA \(1\) · contestés : 80\D000\sF\sCFA \(1\)/)).toBeTruthy();
    expect(screen.getByText("Calculé")).toBeTruthy();
  });

  it("validation d'un bulletin : même action d'arrêt ; refus par seuil expliqué", async () => {
    let attempt = 0;
    const api = setTestApi({
      ...accessRoutes(perms, ["payroll.owner-validation"]),
      "GET /api/v1/payroll/owner/mass": ownerMass(),
      "GET /api/v1/payroll/payslips": { items: [payslip()], total: 1 },
      [`POST /api/v1/payroll/owner/payslips/${pid(10)}/validate`]: () => {
        attempt += 1;
        return json(attempt === 1 ? batch({ rejected: [{ payslipId: pid(10), code: "payroll.owner_approval_required", message: "Ce montant dépasse le seuil : seul le propriétaire peut arrêter ce bulletin." }] }) : batch({ done: [pid(10)] }));
      },
    });
    renderWithProviders(<OwnerScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Bulletins à valider/ }));
    await waitFor(() => expect(api.calls.some((c) => c.path.endsWith("/payslips") && c.query.status === "CALCULATED" && c.query.periodId === pid(1))).toBe(true));
    const button = await screen.findByRole("button", { name: /^Valider/ });
    fireEvent.click(button);
    expect(await screen.findByText("Ce montant dépasse le seuil : seul le propriétaire peut arrêter ce bulletin.")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /^Valider/ }));
    await screen.findByText("Le bulletin est validé.");
  });

  it("fonction de l'offre absente : message", async () => {
    setTestApi({ ...accessRoutes(perms, []) });
    renderWithProviders(<OwnerScreen />);
    expect(await screen.findByText(/ne sont pas incluses dans l'offre/)).toBeTruthy();
  });

  it("sans droit de validation : pas de liste de bulletins à valider", async () => {
    setTestApi({ ...accessRoutes(["payroll.report.read"], ["payroll.owner-validation"]), "GET /api/v1/payroll/owner/mass": ownerMass() });
    renderWithProviders(<OwnerScreen />);
    await screen.findByRole("heading", { name: "Masse salariale comptée" });
    expect(screen.queryByRole("button", { name: /Bulletins à valider/ })).toBeNull();
  });
});

describe("Espace enseignant", () => {
  const perms = ["payroll.payslip.read_own"];

  it("mes bulletins : montants arrêtés, versé ou non ; bulletin contesté signalé", async () => {
    setTestApi({
      ...accessRoutes(perms),
      "GET /api/v1/payroll/my/payslips": {
        items: [
          payslip({ status: "PAID", paidAt: "2026-10-05T10:00:00.000Z", approvedAt: "2026-10-02T08:00:00.000Z" }),
          payslip({ id: pid(11), status: "APPROVED", approvedAt: "2026-11-02T08:00:00.000Z", totalAmount: 120000 }),
          payslip({ id: pid(12), status: "DISPUTED", approvedAt: "2026-12-02T08:00:00.000Z", disputeReason: "x" }),
        ],
        total: 3,
      },
    });
    renderWithProviders(<MyPayslipsScreen />);
    const table = await screen.findByRole("table", { name: "Mes bulletins de paie" });
    expect((await within(table).findAllByText("Pas encore versé")).length).toBe(2);
    expect(within(table).getByText(/120\D000\sF\sCFA/)).toBeTruthy();
    expect(await screen.findByText(/Un de vos bulletins est contesté/)).toBeTruthy();
    expect(screen.getByText(/un brouillon calculé reste réservé à la gestion/)).toBeTruthy();
  });

  it("aucun bulletin arrêté : état vide", async () => {
    setTestApi({ ...accessRoutes(perms), "GET /api/v1/payroll/my/payslips": { items: [], total: 0 } });
    renderWithProviders(<MyPayslipsScreen />);
    expect(await screen.findByText("Aucun bulletin")).toBeTruthy();
  });

  it("accès refusé à un bulletin d'un autre : message de l'API", async () => {
    setTestApi({ ...accessRoutes(perms), [`GET /api/v1/payroll/my/payslips/${pid(99)}`]: () => json({ code: "payroll.forbidden", message: "Ce bulletin ne vous appartient pas." }, { status: 403 }) });
    renderWithProviders(<MyPayslipScreen id={pid(99)} />);
    expect(await screen.findByText("Ce bulletin ne vous appartient pas.")).toBeTruthy();
  });

  it("détail : document figé, mode de versement, consigne de contestation", async () => {
    setTestApi({
      ...accessRoutes(perms),
      [`GET /api/v1/payroll/my/payslips/${pid(10)}`]: payslipData({ status: "PAID", watermark: null, payment: { paidAt: "2026-10-05T10:00:00.000Z", paidByName: "Comptable", method: "MOBILE_MONEY", reference: "OM-123" } }),
    });
    renderWithProviders(<MyPayslipScreen id={pid(10)} />);
    expect(await screen.findByText("Bulletin arrêté")).toBeTruthy();
    expect(screen.getByText(/344\D818\sF\sCFA/, { selector: "td" })).toBeTruthy();
    expect(screen.getByText(/Versé le .* par Comptable \(Mobile money\)/)).toBeTruthy();
    expect(screen.getByText(/Contactez la gestion/)).toBeTruthy();
  });
});
