// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { familyInstallment, familyStatement, NOT_FOUND } from "../../_test/fixtures-family";
import { fid, invoiceDetail, invoiceSummary, payment, paymentView, receipt, xof } from "../../_test/fixtures-finance";
import { MyChildFinanceScreen, MyFinanceScreen } from "./MyFinance";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/finance/me", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const L = fid(900);
const parent = accessRoutes(["finance.child.read", "finance.child.pay"], ["finance.online-payment"]);
const learners = { items: [{ learnerId: L, relation: "GUARDIAN", displayName: "KONE Mariam" }] };
const finance = (extra: Record<string, unknown> = {}) => ({
  ...parent,
  "GET /api/v1/finance/me/learners": learners,
  [`GET /api/v1/finance/me/learners/${L}/statement`]: familyStatement(L),
  [`GET /api/v1/finance/me/learners/${L}/installments`]: { items: [familyInstallment()] },
  [`GET /api/v1/finance/me/learners/${L}/receipts`]: { items: [receipt()], total: 1 },
  ...extra,
});
const financeCalls = (api: ReturnType<typeof setTestApi>) => api.calls.filter((c) => c.path.startsWith("/api/v1/finance"));

describe("MyFinanceScreen (routes famille /finance/me/*)", () => {
  it("liste les apprenants de la finance avec leur situation calculée par l'API ; ne lit jamais les anciennes routes", async () => {
    const api = setTestApi(finance());
    renderWithProviders(<MyFinanceScreen />);
    expect(await screen.findByRole("heading", { name: "KONE Mariam" })).toBeTruthy();
    expect(await screen.findByText(/350\D000\sF\sCFA/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Voir le détail/ }).getAttribute("href")).toBe(`/v2/finance/me/${L}`);
    expect(financeCalls(api).every((c) => c.path.startsWith("/api/v1/finance/me/"))).toBe(true);
  });

  it("élève : son propre dossier (relation SELF)", async () => {
    setTestApi(finance({ ...accessRoutes(["finance.self.read"]), "GET /api/v1/finance/me/learners": { items: [{ learnerId: L, relation: "SELF", displayName: "KONE Mariam" }] } }));
    renderWithProviders(<MyFinanceScreen />);
    expect(await screen.findByRole("heading", { name: "KONE Mariam" })).toBeTruthy();
  });

  it("aucun apprenant : état vide, aucune lecture de situation", async () => {
    const api = setTestApi(finance({ "GET /api/v1/finance/me/learners": { items: [] } }));
    renderWithProviders(<MyFinanceScreen />);
    expect(await screen.findByText("Aucun apprenant")).toBeTruthy();
    expect(financeCalls(api).map((c) => c.path)).toEqual(["/api/v1/finance/me/learners"]);
  });

  it("refus de l'API (403) sur la liste : message et réessai", async () => {
    setTestApi(finance({ "GET /api/v1/finance/me/learners": () => json({ code: "forbidden", message: "Accès refusé." }, { status: 403 }) }));
    renderWithProviders(<MyFinanceScreen />);
    expect(await screen.findByText("Accès refusé.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeTruthy();
  });

  it("situation indisponible (404 uniforme) : message discret, pas de crash", async () => {
    setTestApi(finance({ [`GET /api/v1/finance/me/learners/${L}/statement`]: () => json(NOT_FOUND, { status: 404 }) }));
    renderWithProviders(<MyFinanceScreen />);
    expect(await screen.findByText("La situation financière n'est pas disponible pour le moment.")).toBeTruthy();
  });
});

describe("MyChildFinanceScreen", () => {
  it("apprenant NON rattaché au compte : accès refusé et AUCUNE lecture de sa situation", async () => {
    const api = setTestApi(finance());
    renderWithProviders(<MyChildFinanceScreen learnerId={fid(901)} />);
    expect(await screen.findByText(/n'est pas rattaché à votre compte/)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 50));
    expect(financeCalls(api).map((c) => c.path)).toEqual(["/api/v1/finance/me/learners"]);
  });

  it("apprenant lié : totaux, échéances, factures dépliables, paiements, reçus", async () => {
    setTestApi(finance({ [`GET /api/v1/finance/me/learners/${L}/invoices/${fid(50)}`]: invoiceDetail() }));
    renderWithProviders(<MyChildFinanceScreen learnerId={L} />);
    expect(await screen.findByRole("heading", { level: 1, name: "KONE Mariam" })).toBeTruthy();
    expect((await screen.findAllByText(/Reste à payer : 450\D000\sF\sCFA/)).length).toBeGreaterThan(0);
    fireEvent.click(document.querySelector("details > summary")!);
    const table = await screen.findByRole("table", { name: /Échéances de la facture FAC-2026-000001/ });
    expect(within(table).getByText("Tranche 2")).toBeTruthy();
    const link = await screen.findByRole("link", { name: "REC-2026-000001" });
    expect(link.getAttribute("href")).toBe(`/v2/finance/me/${L}/receipts/${fid(80)}`);
    expect(screen.getByRole("table", { name: "Paiements effectués" })).toBeTruthy();
  });

  it("paiement en ligne : route famille, facture obligatoire, clé d'idempotence, double clic = une seule demande", async () => {
    const pending = paymentView({ payment: payment({ status: "PENDING", method: "ONLINE", provider: "orange_money", confirmedAt: null }), receipt: null, allocations: [] });
    let posts = 0;
    const api = setTestApi(
      finance({
        [`POST /api/v1/finance/me/learners/${L}/payments/online`]: () => {
          posts += 1;
          return json({ ...pending, instructions: null }, { status: 201 });
        },
        [`GET /api/v1/finance/me/learners/${L}/payments/${fid(70)}`]: pending,
      }),
    );
    renderWithProviders(<MyChildFinanceScreen learnerId={L} />);
    fireEvent.click(await screen.findByRole("button", { name: "Payer en ligne" }));
    const dialog = await screen.findByRole("dialog");
    expect((within(dialog).getByLabelText(/^Montant/) as HTMLInputElement).value).toBe("450000");
    fireEvent.change(within(dialog).getByLabelText(/^Numéro de téléphone/), { target: { value: "+2250101010101" } });
    const submit = within(dialog).getByRole("button", { name: "Payer" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(await screen.findByText(/En attente de confirmation par l'opérateur/)).toBeTruthy();
    expect(posts).toBe(1);
    const sent = api.calls.find((c) => c.method === "POST")!;
    expect(sent.body).toMatchObject({ amount: 450000, provider: "orange_money", invoiceId: fid(50), payer: { phoneNumber: "+2250101010101" } });
    expect(sent.headers["idempotency-key"]).toBeTruthy();
  });

  it("sans la fonction de paiement en ligne : pas de bouton", async () => {
    setTestApi(finance({ ...accessRoutes(["finance.child.read", "finance.child.pay"], []) }));
    renderWithProviders(<MyChildFinanceScreen learnerId={L} />);
    await screen.findByRole("heading", { level: 1, name: "KONE Mariam" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Payer en ligne" })).toBeNull());
  });

  it("erreur de l'API sur le relevé : message affiché", async () => {
    setTestApi(finance({ [`GET /api/v1/finance/me/learners/${L}/statement`]: () => json({ code: "x", message: "Relevé indisponible." }, { status: 422 }) }));
    renderWithProviders(<MyChildFinanceScreen learnerId={L} />);
    expect(await screen.findByText("Relevé indisponible.")).toBeTruthy();
  });

  it("facture sans reste dû : pas de proposition de paiement", async () => {
    setTestApi(finance({ [`GET /api/v1/finance/me/learners/${L}/statement`]: familyStatement(L, { invoices: [invoiceSummary({ status: "PAID", balance: xof(0) })] }) }));
    renderWithProviders(<MyChildFinanceScreen learnerId={L} />);
    await screen.findAllByText("FAC-2026-000001");
    expect(screen.queryByRole("button", { name: "Payer en ligne" })).toBeNull();
  });
});
