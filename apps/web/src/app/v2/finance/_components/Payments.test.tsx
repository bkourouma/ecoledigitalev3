// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { cashSession, fid, installment, invoiceDetail, invoiceSummary, payment, paymentView, receipt, refund, xof } from "../../_test/fixtures-finance";
import { studentDetail } from "../../_test/fixtures-people";
import { NewPaymentScreen, OnlinePaymentScreen } from "./PaymentForm";
import { PaymentDetailScreen, PaymentsScreen } from "./Payments";
import { PaymentTracker } from "./PaymentTracker";
import { ReceiptDetailScreen, ReceiptsScreen } from "./Receipts";
import { RefundsScreen } from "./Refunds";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/finance/payments", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const CASHIER = ["finance.payment.read", "finance.payment.create", "finance.invoice.read", "finance.receipt.read", "finance.cashregister.open", "student.read"];
const learnerRoute = { [`GET /api/v1/people/students/${fid(900)}`]: studentDetail({ id: fid(900), displayName: "KONE Mariam" }) };
const openInvoices = { "GET /api/v1/finance/invoices": { items: [invoiceSummary()], total: 1 } };
const posts = (api: ReturnType<typeof setTestApi>, path: string) => api.calls.filter((c) => c.method === "POST" && c.path === path);

describe("NewPaymentScreen (encaissement manuel)", () => {
  const session = { "GET /api/v1/finance/cash-sessions/mine": { session: cashSession() } };

  function fill(amount: string) {
    fireEvent.change(screen.getByLabelText(/^Montant encaissé/), { target: { value: amount } });
  }

  it("espèces sans session de caisse ouverte : avertissement et encaissement impossible", async () => {
    setTestApi({ ...accessRoutes(CASHIER), ...openInvoices, "GET /api/v1/finance/cash-sessions/mine": { session: null } });
    renderWithProviders(<NewPaymentScreen initialLearnerId={fid(900)} />);
    expect(await screen.findByText(/Aucune session de caisse ouverte/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Vérifier et encaisser" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("link", { name: "Ouvrir une session de caisse" }).getAttribute("href")).toBe("/v2/finance/cash");
    // Un autre mode de paiement lève le blocage.
    fireEvent.change(screen.getByLabelText(/^Mode de paiement/), { target: { value: "MOBILE_MONEY" } });
    await waitFor(() => expect((screen.getByRole("button", { name: "Vérifier et encaisser" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("montant décimal ou vide refusé : aucun envoi", async () => {
    const api = setTestApi({ ...accessRoutes(CASHIER), ...openInvoices, ...session });
    renderWithProviders(<NewPaymentScreen initialLearnerId={fid(900)} />);
    await screen.findByText("Factures ouvertes");
    fill("1500,50");
    fireEvent.click(screen.getByRole("button", { name: "Vérifier et encaisser" }));
    expect(await screen.findAllByText("Le montant est un entier en francs : pas de virgule ni de point.")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(posts(api, "/api/v1/finance/payments")).toHaveLength(0);
  });

  it("relecture, confirmation puis envoi : clé d'idempotence en en-tête ET dans le corps, reçu affiché", async () => {
    const api = setTestApi({
      ...accessRoutes(CASHIER),
      ...openInvoices,
      ...session,
      "POST /api/v1/finance/payments": () => json(paymentView(), { status: 201 }),
    });
    renderWithProviders(<NewPaymentScreen initialLearnerId={fid(900)} />);
    await screen.findByText("Factures ouvertes");
    fill("150 000");
    fireEvent.change(screen.getByLabelText(/^Référence/), { target: { value: "CH-0042" } });
    fireEvent.click(screen.getByRole("button", { name: "Vérifier et encaisser" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/150\D000\sF\sCFA/)).toBeTruthy();
    expect(posts(api, "/api/v1/finance/payments")).toHaveLength(0); // rien n'est envoyé avant la confirmation
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmer l'encaissement" }));
    await screen.findByText(/Le paiement de .* a été enregistré/);
    const [post] = posts(api, "/api/v1/finance/payments");
    const body = post!.body as { idempotencyKey: string };
    expect(body).toMatchObject({ learnerId: fid(900), amount: 150000, method: "CASH", reference: "CH-0042", allocation: { mode: "AUTO" } });
    expect(Number.isInteger((body as unknown as { amount: number }).amount)).toBe(true);
    expect(post!.headers["idempotency-key"]).toBe(body.idempotencyKey);
    expect(body.idempotencyKey).toMatch(/^pay-[A-Za-z0-9-]{8,}$/);
    expect(screen.getByRole("link", { name: "REC-2026-000001" })).toBeTruthy();
  });

  it("DOUBLE CLIC sur « Confirmer » : une seule requête, un seul paiement", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const api = setTestApi({
      ...accessRoutes(CASHIER),
      ...openInvoices,
      ...session,
      "POST /api/v1/finance/payments": async () => {
        await gate;
        return json(paymentView(), { status: 201 });
      },
    });
    renderWithProviders(<NewPaymentScreen initialLearnerId={fid(900)} />);
    await screen.findByText("Factures ouvertes");
    fill("50000");
    fireEvent.click(screen.getByRole("button", { name: "Vérifier et encaisser" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Confirmer l'encaissement" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.doubleClick(confirm);
    release();
    await screen.findByText(/Le paiement de .* a été enregistré/);
    expect(posts(api, "/api/v1/finance/payments")).toHaveLength(1);
  });

  it("incident réseau puis nouvel essai : la MÊME clé est renvoyée (le serveur rejoue, jamais deux paiements)", async () => {
    let attempt = 0;
    const api = setTestApi({
      ...accessRoutes(CASHIER),
      ...openInvoices,
      ...session,
      "POST /api/v1/finance/payments": () => {
        attempt += 1;
        if (attempt === 1) return json({ code: "X", message: "Le serveur est momentanément indisponible." }, { status: 500 });
        return json(paymentView({ replayed: true }), { status: 200 });
      },
    });
    renderWithProviders(<NewPaymentScreen initialLearnerId={fid(900)} />);
    await screen.findByText("Factures ouvertes");
    fill("50000");
    fireEvent.click(screen.getByRole("button", { name: "Vérifier et encaisser" }));
    let dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmer l'encaissement" }));
    expect(await within(dialog).findByRole("alert")).toBeTruthy();
    dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmer l'encaissement" }));
    await screen.findByText(/aucun doublon/);
    const sent = posts(api, "/api/v1/finance/payments");
    expect(sent).toHaveLength(2);
    expect(sent[0]!.headers["idempotency-key"]).toBe(sent[1]!.headers["idempotency-key"]);
    expect((sent[0]!.body as { idempotencyKey: string }).idempotencyKey).toBe((sent[1]!.body as { idempotencyKey: string }).idempotencyKey);
  });

  it("montant corrigé après un refus : nouvelle clé (l'API refuserait une clé réutilisée avec un autre contenu)", async () => {
    let attempt = 0;
    const api = setTestApi({
      ...accessRoutes(CASHIER),
      ...openInvoices,
      ...session,
      "POST /api/v1/finance/payments": () => {
        attempt += 1;
        return attempt === 1 ? json({ code: "finance.invalid_allocation", message: "Le montant dépasse le reste dû." }, { status: 422 }) : json(paymentView(), { status: 201 });
      },
    });
    renderWithProviders(<NewPaymentScreen initialLearnerId={fid(900)} />);
    await screen.findByText("Factures ouvertes");
    fill("900000");
    fireEvent.click(screen.getByRole("button", { name: "Vérifier et encaisser" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Confirmer l'encaissement" }));
    expect(await screen.findByText(/Le montant dépasse le reste dû\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Revenir au formulaire" }));
    fill("90000");
    fireEvent.click(screen.getByRole("button", { name: "Vérifier et encaisser" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Confirmer l'encaissement" }));
    await screen.findByText(/a été enregistré/);
    const sent = posts(api, "/api/v1/finance/payments");
    expect(sent[0]!.headers["idempotency-key"]).not.toBe(sent[1]!.headers["idempotency-key"]);
  });

  it("imputation manuelle : seuls les montants entiers saisis par échéance sont transmis", async () => {
    const inv = invoiceDetail();
    const api = setTestApi({
      ...accessRoutes(CASHIER),
      ...openInvoices,
      ...session,
      [`GET /api/v1/finance/invoices/${fid(50)}`]: inv,
      "POST /api/v1/finance/payments": () => json(paymentView(), { status: 201 }),
    });
    renderWithProviders(<NewPaymentScreen initialLearnerId={fid(900)} />);
    await screen.findByText("Factures ouvertes");
    fireEvent.click(screen.getByRole("radio", { name: "Manuelle" }));
    fireEvent.click(await screen.findByText(/Facture FAC-2026-000001/));
    fireEvent.change(await screen.findByLabelText(/Montant à imputer — Tranche 2/), { target: { value: "20 000" } });
    fill("20000");
    fireEvent.click(screen.getByRole("button", { name: "Vérifier et encaisser" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Confirmer l'encaissement" }));
    await screen.findByText(/a été enregistré/);
    expect((posts(api, "/api/v1/finance/payments")[0]!.body as { allocation: unknown }).allocation).toEqual({ mode: "MANUAL", items: [{ installmentId: fid(41), amount: 20000 }] });
  });
});

describe("OnlinePaymentScreen et suivi de statut", () => {
  it("sans la fonction de l'offre : message explicite, lancement impossible", async () => {
    setTestApi({ ...accessRoutes(CASHIER, []), ...openInvoices });
    renderWithProviders(<OnlinePaymentScreen initialLearnerId={fid(900)} />);
    expect(await screen.findByText("Le paiement en ligne n'est pas inclus dans l'offre de l'établissement.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Lancer le paiement" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("initiation avec clé d'idempotence, instructions affichées, suivi du statut", async () => {
    const pending = paymentView({ payment: payment({ status: "PENDING", method: "ONLINE", provider: "orange_money", receivedAt: "2026-09-02T09:00:00.000Z", confirmedAt: null, cashSessionId: null }), receipt: null, allocations: [] });
    const api = setTestApi({
      ...accessRoutes(CASHIER, ["finance.online-payment"]),
      ...openInvoices,
      "POST /api/v1/finance/payments/online": () => json({ ...pending, instructions: { ussdCode: "#144#", instructions: "Validez sur votre téléphone." } }, { status: 201 }),
      [`GET /api/v1/finance/payments/${fid(70)}`]: pending,
    });
    renderWithProviders(<OnlinePaymentScreen initialLearnerId={fid(900)} />);
    fireEvent.change(await screen.findByLabelText(/^Montant/), { target: { value: "25000" } });
    fireEvent.change(screen.getByLabelText(/^Téléphone du payeur/), { target: { value: "+2250707070707" } });
    const submit = screen.getByRole("button", { name: "Lancer le paiement" });
    // La fonction de l'offre est lue d'abord sur /entitlements/me/features puis, en repli, sur /entitlements/me : le bouton reste
    // inactif tant que la fonctionnalité est inconnue.
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(await screen.findByText("Validez sur votre téléphone.")).toBeTruthy();
    expect(screen.getByText("#144#")).toBeTruthy();
    const sent = posts(api, "/api/v1/finance/payments/online");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({ learnerId: fid(900), amount: 25000, provider: "orange_money", payer: { phoneNumber: "+2250707070707" } });
    expect(sent[0]!.headers["idempotency-key"]).toMatch(/^ol-/);
    expect(await screen.findByText(/En attente de la confirmation du fournisseur/)).toBeTruthy();
  });

  it("le suivi vérifie auprès de l'API puis affiche l'issue décidée par le fournisseur", async () => {
    let verified = false;
    const pending = paymentView({ payment: payment({ status: "PENDING", method: "ONLINE", provider: "wave", confirmedAt: null }), receipt: null, allocations: [] });
    const confirmed = paymentView({ payment: payment({ method: "ONLINE", provider: "wave" }) });
    const api = setTestApi({
      ...accessRoutes(CASHIER, ["finance.online-payment"]),
      [`GET /api/v1/finance/payments/${fid(70)}`]: () => json(verified ? confirmed : pending),
      [`POST /api/v1/finance/payments/${fid(70)}/verify`]: () => ((verified = true), json(confirmed)),
    });
    renderWithProviders(<PaymentTracker paymentId={fid(70)} intervalMs={30} />);
    expect(await screen.findByText(/En attente de la confirmation/)).toBeTruthy();
    expect(await screen.findByText("Paiement confirmé par le fournisseur.")).toBeTruthy();
    expect(posts(api, `/api/v1/finance/payments/${fid(70)}/verify`).length).toBeGreaterThanOrEqual(1);
  });

  it("échec du fournisseur : motif affiché, plus de vérification", async () => {
    const failed = paymentView({ payment: payment({ status: "FAILED", method: "ONLINE", provider: "wave", failureReason: "Solde insuffisant" }), receipt: null, allocations: [] });
    const api = setTestApi({ ...accessRoutes(CASHIER), [`GET /api/v1/finance/payments/${fid(70)}`]: failed });
    renderWithProviders(<PaymentTracker paymentId={fid(70)} intervalMs={20} />);
    expect(await screen.findByText(/Paiement échoué : Solde insuffisant/)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 80));
    expect(posts(api, `/api/v1/finance/payments/${fid(70)}/verify`)).toHaveLength(0);
  });
});

describe("PaymentsScreen et fiche", () => {
  it("liste : montants en francs entiers, apprenant nommé, export CSV", async () => {
    setTestApi({
      ...accessRoutes([...CASHIER, "finance.payment.create"], ["finance.online-payment"]),
      ...learnerRoute,
      "GET /api/v1/finance/payments": { items: [payment(), payment({ id: fid(71), status: "PENDING", method: "MOBILE_MONEY", amount: xof(20013), unallocated: xof(20013), allocated: xof(0) })], total: 2 },
    });
    renderWithProviders(<PaymentsScreen />);
    const table = await screen.findByRole("table", { name: "Liste des paiements" });
    await waitFor(() => expect(within(table).getAllByText("KONE Mariam")).toHaveLength(2));
    expect(within(table).getAllByText(/150\D000\sF\sCFA/).length).toBeGreaterThan(0);
    expect(within(table).getAllByText(/20\D013\sF\sCFA/).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Paiement en ligne" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Exporter en CSV" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("fiche : imputations, demande de remboursement avec clé d'idempotence", async () => {
    const api = setTestApi({
      ...accessRoutes([...CASHIER, "finance.payment.refund"]),
      ...learnerRoute,
      [`GET /api/v1/finance/payments/${fid(70)}`]: paymentView(),
      "GET /api/v1/finance/refunds": { items: [] },
      [`POST /api/v1/finance/payments/${fid(70)}/refunds`]: () => json(refund(), { status: 201 }),
    });
    renderWithProviders(<PaymentDetailScreen id={fid(70)} />);
    expect(await screen.findByRole("heading", { level: 1, name: /Paiement de/ })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Demander un remboursement" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Montant à rembourser/), { target: { value: "20 000" } });
    fireEvent.change(within(dialog).getByLabelText(/^Motif/), { target: { value: "Erreur de saisie du caissier" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Envoyer la demande" }));
    await screen.findByText(/doit l'approuver/);
    const [post] = posts(api, `/api/v1/finance/payments/${fid(70)}/refunds`);
    expect(post!.body).toMatchObject({ amount: 20000, reason: "Erreur de saisie du caissier" });
    expect(post!.headers["idempotency-key"]).toBe((post!.body as { idempotencyKey: string }).idempotencyKey);
  });

  it("sans droit de remboursement : pas de bouton", async () => {
    setTestApi({ ...accessRoutes(CASHIER), ...learnerRoute, [`GET /api/v1/finance/payments/${fid(70)}`]: paymentView(), "GET /api/v1/finance/refunds": { items: [] } });
    renderWithProviders(<PaymentDetailScreen id={fid(70)} />);
    await screen.findByRole("heading", { level: 1, name: /Paiement de/ });
    expect(screen.queryByRole("button", { name: "Demander un remboursement" })).toBeNull();
  });

  it("solde non imputé : imputation automatique", async () => {
    const view = paymentView({ payment: payment({ allocated: xof(0), unallocated: xof(150000) }), allocations: [] });
    const api = setTestApi({
      ...accessRoutes(CASHIER),
      ...learnerRoute,
      ...openInvoices,
      [`GET /api/v1/finance/payments/${fid(70)}`]: view,
      "GET /api/v1/finance/refunds": { items: [] },
      [`POST /api/v1/finance/payments/${fid(70)}/allocations`]: () => json(paymentView()),
    });
    renderWithProviders(<PaymentDetailScreen id={fid(70)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Imputer le solde" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Imputer" }));
    await screen.findByText("L'imputation a été enregistrée.");
    expect(posts(api, `/api/v1/finance/payments/${fid(70)}/allocations`)[0]!.body).toEqual({ allocation: { mode: "AUTO" } });
  });
});

describe("Reçus", () => {
  it("liste des reçus", async () => {
    setTestApi({ ...accessRoutes(CASHIER), ...learnerRoute, "GET /api/v1/finance/receipts": { items: [receipt()], total: 1 } });
    renderWithProviders(<ReceiptsScreen />);
    expect(await screen.findByRole("link", { name: "REC-2026-000001" })).toBeTruthy();
  });

  it("reçu imprimable : instantané de l'API, solde après paiement, impression", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    setTestApi({
      ...accessRoutes(CASHIER),
      ...learnerRoute,
      [`GET /api/v1/finance/receipts/${fid(80)}`]: receipt(),
      "GET /api/v1/tenancy/profile": { tenantId: fid(1), slug: "demo", legalName: "Collège Les Palmiers", tradeName: null, countryCode: "CI", contactName: null, contactEmail: null, contactPhone: null, address: null, branding: { logoUrl: null, primaryColor: null, secondaryColor: null, customDomain: null }, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    });
    renderWithProviders(<ReceiptDetailScreen id={fid(80)} />);
    const doc = await screen.findByRole("article", { name: "Reçu de paiement" });
    expect(await within(doc).findByText("Collège Les Palmiers")).toBeTruthy();
    expect(within(doc).getByText("REC-2026-000001")).toBeTruthy();
    expect(within(doc).getAllByText(/150\D000\sF\sCFA/).length).toBeGreaterThan(0);
    expect(within(doc).getByText(/350\D000\sF\sCFA/)).toBeTruthy(); // reste dû après paiement (instantané)
    fireEvent.click(screen.getByRole("button", { name: "Imprimer ou enregistrer en PDF" }));
    expect(print).toHaveBeenCalled();
  });
});

describe("RefundsScreen (quatre yeux)", () => {
  const perms = [...CASHIER, "finance.payment.refund"];

  it("approbation immédiate : corps { complete: true }", async () => {
    const api = setTestApi({
      ...accessRoutes(perms),
      "GET /api/v1/finance/refunds": { items: [refund()] },
      [`POST /api/v1/finance/refunds/${fid(110)}/approve`]: () => json(refund({ status: "COMPLETED" })),
    });
    renderWithProviders(<RefundsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Approuver/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approuver" }));
    await screen.findByText("Le remboursement est approuvé et exécuté.");
    expect(posts(api, `/api/v1/finance/refunds/${fid(110)}/approve`)[0]!.body).toEqual({ complete: true });
  });

  it("auto-approbation : le message clair de l'API est affiché tel quel", async () => {
    setTestApi({
      ...accessRoutes(perms),
      "GET /api/v1/finance/refunds": { items: [refund()] },
      [`POST /api/v1/finance/refunds/${fid(110)}/approve`]: () => json({ code: "finance.self_approval_forbidden", message: "Vous ne pouvez pas approuver votre propre demande de remboursement." }, { status: 403 }),
    });
    renderWithProviders(<RefundsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Approuver/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approuver" }));
    expect(await within(dialog).findByText("Vous ne pouvez pas approuver votre propre demande de remboursement.")).toBeTruthy();
  });

  it("refus motivé et exécution d'un remboursement approuvé", async () => {
    const api = setTestApi({
      ...accessRoutes(perms),
      "GET /api/v1/finance/refunds": { items: [refund(), refund({ id: fid(111), status: "APPROVED", amount: xof(5000) })] },
      [`POST /api/v1/finance/refunds/${fid(110)}/reject`]: () => json(refund({ status: "REJECTED" })),
      [`POST /api/v1/finance/refunds/${fid(111)}/complete`]: () => json(refund({ id: fid(111), status: "COMPLETED" })),
    });
    renderWithProviders(<RefundsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Refuser/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif du refus/), { target: { value: "Pièces justificatives absentes" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Refuser" }));
    await screen.findByText("Le remboursement est refusé.");
    expect(posts(api, `/api/v1/finance/refunds/${fid(110)}/reject`)[0]!.body).toEqual({ reason: "Pièces justificatives absentes" });
    fireEvent.click(await screen.findByRole("button", { name: /Exécuter/ }));
    await screen.findByText("Le remboursement a été exécuté.");
  });

  it("sans droit : aucune action", async () => {
    setTestApi({ ...accessRoutes(CASHIER), "GET /api/v1/finance/refunds": { items: [refund()] } });
    renderWithProviders(<RefundsScreen />);
    await screen.findByRole("table", { name: "Liste des remboursements" });
    expect(screen.queryByRole("button", { name: /Approuver/ })).toBeNull();
  });
});

void installment;
