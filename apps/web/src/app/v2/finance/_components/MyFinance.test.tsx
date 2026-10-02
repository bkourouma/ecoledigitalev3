// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { fid, invoiceDetail, invoiceSummary, payment, paymentView, receipt, statement, xof } from "../../_test/fixtures-finance";
import { studentDetail, studentSummary } from "../../_test/fixtures-people";
import { MyChildFinanceScreen, MyFinanceScreen } from "./MyFinance";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/finance/me", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const child = studentSummary({ id: fid(900), displayName: "KONE Mariam", currentEnrollment: { enrollmentId: fid(7), academicYearId: fid(8), institutionId: fid(9), classroomId: fid(10), classroomName: "6e A", status: "CONFIRMED", registrationNumber: "R-1" } });
const parent = accessRoutes(["student.child.read", "finance.invoice.read", "finance.receipt.read"], ["finance.online-payment"]);
const finance = (extra: Record<string, unknown> = {}) => ({
  ...parent,
  "GET /api/v1/people/children": { items: [child] },
  [`GET /api/v1/finance/learners/${fid(900)}/statement`]: statement(),
  "GET /api/v1/finance/receipts": { items: [receipt()], total: 1 },
  ...extra,
});
const financeCalls = (api: ReturnType<typeof setTestApi>) => api.calls.filter((c) => c.path.startsWith("/api/v1/finance"));

describe("MyFinanceScreen (parent)", () => {
  it("liste mes enfants avec leur situation financière calculée par l'API", async () => {
    setTestApi(finance());
    renderWithProviders(<MyFinanceScreen />);
    expect(await screen.findByRole("heading", { name: "KONE Mariam" })).toBeTruthy();
    expect(screen.getByText("6e A")).toBeTruthy();
    expect(await screen.findByText(/350\D000\sF\sCFA/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Voir le détail/ }).getAttribute("href")).toBe(`/v2/finance/me/${fid(900)}`);
  });

  it("aucun enfant lié : état vide, aucune lecture financière", async () => {
    const api = setTestApi({ ...parent, "GET /api/v1/people/children": { items: [] } });
    renderWithProviders(<MyFinanceScreen />);
    expect(await screen.findByText("Aucun apprenant")).toBeTruthy();
    expect(financeCalls(api)).toHaveLength(0);
  });

  it("situation indisponible côté finance (droits) : message discret, pas de crash", async () => {
    setTestApi(finance({ [`GET /api/v1/finance/learners/${fid(900)}/statement`]: () => json({ code: "forbidden", message: "Accès refusé." }, { status: 403 }) }));
    renderWithProviders(<MyFinanceScreen />);
    expect(await screen.findByText("La situation financière n'est pas disponible pour le moment.")).toBeTruthy();
  });

  it("élève : son propre dossier", async () => {
    setTestApi({
      ...accessRoutes(["student.self.read", "finance.invoice.read"]),
      "GET /api/v1/people/me/student": studentDetail({ id: fid(900), displayName: "KONE Mariam" }),
      [`GET /api/v1/finance/learners/${fid(900)}/statement`]: statement(),
    });
    renderWithProviders(<MyFinanceScreen />);
    expect(await screen.findByRole("heading", { name: "KONE Mariam" })).toBeTruthy();
  });
});

describe("MyChildFinanceScreen", () => {
  it("apprenant NON rattaché au compte : accès refusé et AUCUN appel finance", async () => {
    const api = setTestApi(finance());
    renderWithProviders(<MyChildFinanceScreen learnerId={fid(901)} />);
    expect(await screen.findByText(/n'est pas rattaché à votre compte/)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 50));
    expect(financeCalls(api)).toHaveLength(0);
  });

  it("enfant lié : totaux, factures dépliables avec échéances, paiements, reçus", async () => {
    setTestApi(
      finance({
        [`GET /api/v1/finance/invoices/${fid(50)}`]: invoiceDetail(),
      }),
    );
    renderWithProviders(<MyChildFinanceScreen learnerId={fid(900)} />);
    expect(await screen.findByRole("heading", { level: 1, name: "KONE Mariam" })).toBeTruthy();
    expect(await screen.findByText(/Reste à payer : 450\D000\sF\sCFA/)).toBeTruthy();
    const summary = screen.getByText("FAC-2026-000001");
    fireEvent.click(summary);
    const table = await screen.findByRole("table", { name: /Échéances de la facture FAC-2026-000001/ });
    expect(within(table).getByText("Tranche 2")).toBeTruthy();
    const link = await screen.findByRole("link", { name: "REC-2026-000001" });
    expect(link.getAttribute("href")).toBe(`/v2/finance/me/${fid(900)}/receipts/${fid(80)}`);
    expect(screen.getByRole("table", { name: "Paiements de l'apprenant" })).toBeTruthy();
  });

  it("paiement en ligne : pré-rempli avec le reste dû de l'API, clé d'idempotence, suivi du statut", async () => {
    const pending = paymentView({ payment: payment({ status: "PENDING", method: "ONLINE", provider: "orange_money", confirmedAt: null }), receipt: null, allocations: [] });
    const api = setTestApi(
      finance({
        "POST /api/v1/finance/payments/online": () => json({ ...pending, instructions: null }, { status: 201 }),
        [`GET /api/v1/finance/payments/${fid(70)}`]: pending,
        "GET /api/v1/finance/invoices": { items: [], total: 0 },
      }),
    );
    renderWithProviders(<MyChildFinanceScreen learnerId={fid(900)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Payer en ligne" }));
    const dialog = await screen.findByRole("dialog");
    expect((within(dialog).getByLabelText(/^Montant à payer/) as HTMLInputElement).value).toBe("450000");
    fireEvent.change(within(dialog).getByLabelText(/^Numéro de téléphone/), { target: { value: "+2250101010101" } });
    const submit = within(dialog).getByRole("button", { name: "Lancer le paiement" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(await screen.findByText(/En attente de la confirmation du fournisseur/)).toBeTruthy();
    const sent = api.calls.filter((c) => c.method === "POST" && c.path === "/api/v1/finance/payments/online");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({ learnerId: fid(900), amount: 450000, provider: "orange_money", invoiceId: fid(50), payer: { phoneNumber: "+2250101010101" } });
    expect(sent[0]!.headers["idempotency-key"]).toBeTruthy();
  });

  it("sans la fonction de paiement en ligne : pas de bouton", async () => {
    setTestApi(finance({ ...accessRoutes(["student.child.read", "finance.invoice.read"], []) }));
    renderWithProviders(<MyChildFinanceScreen learnerId={fid(900)} />);
    await screen.findByRole("heading", { level: 1, name: "KONE Mariam" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Payer en ligne" })).toBeNull());
  });

  it("erreur de l'API sur le relevé : message et réessai", async () => {
    setTestApi(finance({ [`GET /api/v1/finance/learners/${fid(900)}/statement`]: () => json({ code: "x", message: "Relevé indisponible." }, { status: 422 }) }));
    renderWithProviders(<MyChildFinanceScreen learnerId={fid(900)} />);
    expect(await screen.findByText("Relevé indisponible.")).toBeTruthy();
  });

  it("facture sans reste dû : pas de proposition de paiement", async () => {
    setTestApi(
      finance({
        [`GET /api/v1/finance/learners/${fid(900)}/statement`]: statement({ invoices: [invoiceSummary({ status: "PAID", balance: xof(0) })] }),
      }),
    );
    renderWithProviders(<MyChildFinanceScreen learnerId={fid(900)} />);
    await screen.findByText("FAC-2026-000001");
    expect(screen.queryByRole("button", { name: "Payer en ligne" })).toBeNull();
  });
});
