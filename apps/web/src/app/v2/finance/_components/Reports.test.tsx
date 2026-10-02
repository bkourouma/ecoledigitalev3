// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { agedBalance, cashRegister, cashSession, cashSessionSummary, fid, learnerReceivable, receivableRow, summary, trendPoint, xof } from "../../_test/fixtures-finance";
import { studentDetail } from "../../_test/fixtures-people";
import { CashScreen } from "./Cash";
import { FinanceOverviewScreen, ReportsScreen } from "./Reports";

const csv = vi.hoisted(() => ({ downloadText: vi.fn() }));
vi.mock("@/platform/ui/csv", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/platform/ui/csv")>()), downloadText: csv.downloadText }));
vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/finance/cash", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const learnerRoute = { [`GET /api/v1/people/students/${fid(900)}`]: studentDetail({ id: fid(900), displayName: "KONE Mariam" }) };
const posts = (api: ReturnType<typeof setTestApi>, suffix: string) => api.calls.filter((c) => c.method === "POST" && c.path.endsWith(suffix));

describe("CashScreen", () => {
  const perms = ["finance.cashregister.open", "finance.cashregister.close", "finance.payment.create", "finance.fee.manage"];
  const noSession = { "GET /api/v1/finance/cash-sessions/mine": { session: null }, "GET /api/v1/finance/cash-registers": { items: [cashRegister()] }, "GET /api/v1/finance/cash-sessions": { items: [] } };

  it("ouverture d'une session : fonds de caisse entier transmis", async () => {
    const api = setTestApi({ ...accessRoutes(perms), ...noSession, [`POST /api/v1/finance/cash-registers/${fid(120)}/sessions`]: () => json(cashSession(), { status: 201 }) });
    renderWithProviders(<CashScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Ouvrir une session/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Fonds de caisse/), { target: { value: "50 000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Ouvrir la session" }));
    await screen.findByText("La session de caisse est ouverte.");
    expect(posts(api, "/sessions")[0]!.body).toEqual({ openingFloat: 50000 });
  });

  it("session ouverte : mouvements de l'API, clôture avec comptage, écart calculé par l'API", async () => {
    const closed = cashSessionSummary({
      session: cashSession({ status: "CLOSED", closedAt: "2026-09-02T17:00:00.000Z", expected: xof(200000), counted: xof(195000), variance: xof(-5000) }),
    });
    let isClosed = false;
    const api = setTestApi({
      ...accessRoutes(perms),
      "GET /api/v1/finance/cash-sessions/mine": () => json({ session: isClosed ? null : cashSession() }),
      "GET /api/v1/finance/cash-registers": { items: [cashRegister()] },
      "GET /api/v1/finance/cash-sessions": { items: [] },
      [`GET /api/v1/finance/cash-sessions/${fid(90)}`]: () => json(isClosed ? closed : cashSessionSummary()),
      [`POST /api/v1/finance/cash-sessions/${fid(90)}/close`]: () => ((isClosed = true), json(closed)),
    });
    renderWithProviders(<CashScreen />);
    expect(await screen.findByText(/150\D000\sF\sCFA/)).toBeTruthy(); // encaissé (API)
    fireEvent.click(screen.getByRole("button", { name: "Clôturer la session" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Montant compté/), { target: { value: "195000,5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Clôturer" }));
    expect(await within(dialog).findByText("Le montant est un entier en francs : pas de virgule ni de point.")).toBeTruthy();
    expect(posts(api, "/close")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/^Montant compté/), { target: { value: "195 000" } });
    fireEvent.change(within(dialog).getByLabelText(/^Observation/), { target: { value: "Billet manquant" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Clôturer" }));
    await screen.findByText("La session est clôturée.");
    expect(posts(api, "/close")[0]!.body).toEqual({ countedAmount: 195000, note: "Billet manquant" });
    const result = await screen.findByRole("heading", { name: "Résultat de la clôture" });
    const section = result.closest("section")!;
    expect(await within(section).findByText(/Écart : il manque 5\D000\sF\sCFA en caisse\./)).toBeTruthy();
    expect(within(section).getByText(/200\D000\sF\sCFA/)).toBeTruthy();
    expect(within(section).getByText(/195\D000\sF\sCFA/)).toBeTruthy();
  });

  it("clôture sans écart : message de réussite", async () => {
    setTestApi({
      ...accessRoutes(["finance.cashregister.open"]),
      "GET /api/v1/finance/cash-sessions/mine": { session: null },
      "GET /api/v1/finance/cash-registers": { items: [] },
      "GET /api/v1/finance/cash-sessions": { items: [cashSession({ status: "CLOSED", closedAt: "2026-09-02T17:00:00.000Z", expected: xof(200000), counted: xof(200000), variance: xof(0) })] },
      [`GET /api/v1/finance/cash-sessions/${fid(90)}`]: cashSessionSummary({ session: cashSession({ status: "CLOSED", closedAt: "2026-09-02T17:00:00.000Z", expected: xof(200000), counted: xof(200000), variance: xof(0) }) }),
    });
    renderWithProviders(<CashScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Détails/ }));
    expect(await screen.findByText("Aucun écart : la caisse est juste.")).toBeTruthy();
  });

  it("sans droit de clôture : pas de bouton ; sans caisse : état vide", async () => {
    setTestApi({ ...accessRoutes(["finance.cashregister.open"]), "GET /api/v1/finance/cash-sessions/mine": { session: cashSession() }, "GET /api/v1/finance/cash-registers": { items: [] }, "GET /api/v1/finance/cash-sessions": { items: [] }, [`GET /api/v1/finance/cash-sessions/${fid(90)}`]: cashSessionSummary() });
    renderWithProviders(<CashScreen />);
    await screen.findByText("Ouverte le", { selector: "dt" });
    expect(screen.queryByRole("button", { name: "Clôturer la session" })).toBeNull();
  });

  it("erreur de l'API sur la session", async () => {
    setTestApi({ ...accessRoutes(perms), "GET /api/v1/finance/cash-sessions/mine": () => json({ code: "x", message: "Caisse indisponible." }, { status: 422 }), "GET /api/v1/finance/cash-registers": { items: [] }, "GET /api/v1/finance/cash-sessions": { items: [] } });
    renderWithProviders(<CashScreen />);
    expect(await screen.findByText("Caisse indisponible.")).toBeTruthy();
  });
});

describe("Rapports", () => {
  const perms = ["finance.report.read", "student.read"];
  const base = {
    ...accessRoutes(perms),
    ...learnerRoute,
    "GET /api/v1/academic/years": { items: [] },
    "GET /api/v1/finance/reports/summary": summary(),
    "GET /api/v1/finance/reports/receivables-by-group": { items: [receivableRow(), receivableRow({ key: null, label: null })] },
    "GET /api/v1/finance/reports/receivables-by-learner": { items: [learnerReceivable()], total: 1 },
    "GET /api/v1/finance/reports/aged-balance": agedBalance(),
    "GET /api/v1/finance/reports/collections-trend": { items: [trendPoint(), trendPoint({ bucket: "2026-09-08", collected: xof(6000000) })] },
  };

  it("synthèse : montants formatés et taux de recouvrement en points de base", async () => {
    setTestApi(base);
    renderWithProviders(<ReportsScreen />);
    const billed = await screen.findByText("Facturé", { selector: "dt" });
    expect(within(billed.parentElement!).getByText(/60\D000\D000\sF\sCFA/)).toBeTruthy();
    const rate = screen.getByText("Taux de recouvrement", { selector: "dt" });
    expect(within(rate.parentElement!).getByText(/69,49\s%/)).toBeTruthy();
    const overdue = screen.getByText("En retard", { selector: "dt" });
    expect(within(overdue.parentElement!).getByText(/7\D500\D000\sF\sCFA/)).toBeTruthy();
    expect(within(overdue.parentElement!).getByText("31 factures en retard")).toBeTruthy();
  });

  it("taux sans objet quand l'API renvoie null (rien à recouvrer)", async () => {
    setTestApi({ ...base, "GET /api/v1/finance/reports/summary": summary({ collectionRateBps: null, billed: xof(0), outstanding: xof(0) }) });
    renderWithProviders(<ReportsScreen />);
    const rate = await screen.findByText("Taux de recouvrement", { selector: "dt" });
    expect(within(rate.parentElement!).getByText("Sans objet")).toBeTruthy();
  });

  it("créances par classe : lien vers les factures du groupe ; par apprenant : nom et plus ancien retard", async () => {
    setTestApi(base);
    renderWithProviders(<ReportsScreen />);
    const link = await screen.findByRole("link", { name: "6e A" });
    expect(link.getAttribute("href")).toBe("/v2/finance/invoices?groupKey=6E-A");
    expect(screen.getByText("Sans classe")).toBeTruthy();
    const learners = await screen.findByRole("table", { name: "Créances par apprenant" });
    expect(await within(learners).findByRole("link", { name: "KONE Mariam" })).toBeTruthy();
  });

  it("balance âgée : tranches d'ancienneté et total de l'API", async () => {
    setTestApi(base);
    renderWithProviders(<ReportsScreen />);
    const table = await screen.findByRole("table", { name: "Balance âgée par ancienneté" });
    for (const label of ["Non échu", "1 à 30 jours", "31 à 60 jours", "61 à 90 jours", "Plus de 90 jours"]) expect(within(table).getByText(label)).toBeTruthy();
    expect(within(table).getByText(/9\D000\D000\sF\sCFA/)).toBeTruthy();
    expect(await screen.findByText(/18\D000\D000\sF\sCFA/, { selector: "strong" })).toBeTruthy();
  });

  it("évolution : plage invalide signalée sans appel", async () => {
    const api = setTestApi(base);
    renderWithProviders(<ReportsScreen />);
    await screen.findByRole("table", { name: "Encaissements par période" });
    const before = api.calls.filter((c) => c.path.endsWith("/collections-trend")).length;
    fireEvent.change(screen.getByLabelText("Du", { selector: "#rep-trend input" }), { target: { value: "2030-01-01" } });
    expect(await screen.findByText("La date de début doit précéder la date de fin.")).toBeTruthy();
    expect(api.calls.filter((c) => c.path.endsWith("/collections-trend")).length).toBe(before);
  });

  it("export CSV : lignes de l'API, montants entiers bruts", async () => {
    csv.downloadText.mockClear();
    setTestApi(base);
    renderWithProviders(<ReportsScreen />);
    const section = (await screen.findByRole("heading", { name: "Créances par classe", level: 2 })).closest("section")!;
    await within(section).findByRole("link", { name: "6e A" });
    fireEvent.click(within(section).getByRole("button", { name: "Exporter en CSV" }));
    await waitFor(() => expect(csv.downloadText).toHaveBeenCalled());
    const [filename, content] = csv.downloadText.mock.calls[0] as [string, string];
    expect(filename).toBe("creances-par-classe.csv");
    expect(content).toContain("6e A;30;15000000;10000000;5000000;2000000;6667");
  });

  it("erreur de l'API sur un rapport : message et réessai", async () => {
    setTestApi({ ...base, "GET /api/v1/finance/reports/aged-balance": () => json({ code: "x", message: "Balance indisponible." }, { status: 422 }) });
    renderWithProviders(<ReportsScreen />);
    expect(await screen.findByText("Balance indisponible.")).toBeTruthy();
  });

  it("filtres de période transmis aux rapports", async () => {
    const api = setTestApi(base);
    renderWithProviders(<ReportsScreen />);
    await screen.findByText("Facturé", { selector: "dt" });
    fireEvent.change(screen.getByLabelText("Situation au", { exact: false }), { target: { value: "2026-12-31" } });
    await waitFor(() => expect(api.calls.some((c) => c.path.endsWith("/summary") && c.query.asOf === "2026-12-31")).toBe(true));
  });
});

describe("Vue d'ensemble", () => {
  it("caissier sans droit de rapport : pas d'indicateurs, raccourcis permis seulement", async () => {
    const api = setTestApi(accessRoutes(["finance.payment.create", "finance.cashregister.open"]));
    renderWithProviders(<FinanceOverviewScreen />);
    expect(await screen.findByRole("link", { name: /Encaisser un paiement/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Rapports/ })).toBeNull();
    expect(api.calls.some((c) => c.path.endsWith("/reports/summary"))).toBe(false);
  });

  it("direction : indicateurs de l'API et raccourci vers les factures en retard", async () => {
    setTestApi({ ...accessRoutes(["finance.report.read", "finance.invoice.read"]), "GET /api/v1/finance/reports/summary": summary() });
    renderWithProviders(<FinanceOverviewScreen />);
    expect(await screen.findByText(/41\D000\D000\sF\sCFA/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Factures en retard/ }).getAttribute("href")).toBe("/v2/finance/invoices?status=OVERDUE");
  });
});
