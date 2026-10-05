// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { fid, payment, refund, xof } from "../../_test/fixtures-finance";
import { FinanceNav } from "./FinanceNav";
import { PendingPaymentsScreen } from "./PendingPayments";
import { RefundsScreen } from "./Refunds";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/finance/payments/pending", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const READER = ["finance.payment.read"];
const VERIFIER = ["finance.payment.read", "finance.payment.create"];
const RECONCILER = ["finance.payment.read", "finance.payment.create", "finance.payment.reconcile"];
const BASE = "/api/v1/finance";
const AT = "2026-10-02T09:00:00.000Z";

const recon = (over: Record<string, unknown> = {}) => ({
  attempts: 0,
  firstAttemptAt: null,
  lastAttemptAt: null,
  nextAttemptAt: AT,
  lastOutcome: null,
  lastErrorCode: null,
  flaggedAt: null,
  flagReason: null,
  ...over,
});

const pendingRow = (over: { payment?: Record<string, unknown>; reconciliation?: unknown; openResolutionId?: string | null } = {}) => ({
  payment: payment({ status: "PENDING", method: "ONLINE", provider: "orange_money", providerRef: null, allocated: xof(0), unallocated: xof(0), confirmedAt: null, cashSessionId: null, ...over.payment }),
  reconciliation: over.reconciliation === undefined ? null : over.reconciliation,
  openResolutionId: over.openResolutionId ?? null,
});

const resolution = (over: Record<string, unknown> = {}) => ({
  id: fid(300),
  paymentId: fid(70),
  refundId: null,
  outcome: "SUCCEEDED",
  reason: "Relevé Orange du 01/10 montrant l'encaissement",
  evidenceRef: "MP251001.1234.A56789",
  status: "REQUESTED",
  requestedBy: fid(500),
  requestedAt: AT,
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
  ...over,
});

const posts = (api: ReturnType<typeof setTestApi>, path: string) => api.calls.filter((c) => c.method === "POST" && c.path === path);

describe("PendingPaymentsScreen (paiements à rapprocher)", () => {
  const flagged = pendingRow({ reconciliation: recon({ attempts: 1, flaggedAt: AT, flagReason: "unverifiable_no_provider_ref" }) });
  const checking = pendingRow({ payment: { id: fid(71), provider: "wave", providerRef: "cos-1", amount: xof(25000) }, reconciliation: recon({ attempts: 3, lastOutcome: "pending" }) });
  const waiting = pendingRow({ payment: { id: fid(72), provider: "mtn_momo", providerRef: "x" } });

  it("signalés d'abord, avec le motif en français ; vérification en cours avec le nombre de contrôles ; jamais de conclusion côté web", async () => {
    setTestApi({
      ...accessRoutes(READER),
      [`GET ${BASE}/payments/pending`]: { items: [flagged, checking, waiting], total: 3 },
      [`GET ${BASE}/resolutions`]: { items: [] },
    });
    renderWithProviders(<PendingPaymentsScreen />);
    await screen.findByText("Pas encore contrôlé"); // les données sont chargées
    const table = screen.getByRole("table", { name: "Paiements en ligne en attente" });
    const rows = within(table).getAllByRole("row");
    expect(within(rows[1]!).getByText("À rapprocher")).toBeTruthy();
    expect(within(rows[1]!).getByText(/Aucune référence du fournisseur/)).toBeTruthy();
    expect(within(rows[2]!).getByText("Vérification en cours")).toBeTruthy();
    expect(within(rows[2]!).getByText("3 vérifications")).toBeTruthy();
    expect(within(rows[3]!).getByText("Pas encore contrôlé")).toBeTruthy();
    // Lecture seule : aucune action.
    expect(screen.queryByRole("button", { name: /Vérifier maintenant/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Résoudre à la main/ })).toBeNull();
    expect(screen.getByText("Aucune demande en attente")).toBeTruthy();
  });

  it("un motif inconnu retombe sur un libellé générique (jamais le code brut)", async () => {
    setTestApi({
      ...accessRoutes(READER),
      [`GET ${BASE}/payments/pending`]: { items: [pendingRow({ reconciliation: recon({ attempts: 1, flaggedAt: AT, flagReason: "motif_inconnu_du_futur" }) })], total: 1 },
      [`GET ${BASE}/resolutions`]: { items: [] },
    });
    renderWithProviders(<PendingPaymentsScreen />);
    expect(await screen.findByText("Une vérification manuelle est nécessaire.")).toBeTruthy();
    expect(screen.queryByText("motif_inconnu_du_futur")).toBeNull();
  });

  it("« Vérifier maintenant » interroge le fournisseur via l'API (aucune conclusion locale)", async () => {
    const api = setTestApi({
      ...accessRoutes(VERIFIER),
      [`GET ${BASE}/payments/pending`]: { items: [checking], total: 1 },
      [`GET ${BASE}/resolutions`]: { items: [] },
      [`POST ${BASE}/payments/${fid(71)}/verify`]: () => json({ payment: payment({ id: fid(71), status: "PENDING" }), receipt: null, allocations: [], replayed: false }),
    });
    renderWithProviders(<PendingPaymentsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Vérifier maintenant/ }));
    await screen.findByText("Le fournisseur répond toujours « en attente ».");
    expect(posts(api, `${BASE}/payments/${fid(71)}/verify`)).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Résoudre à la main/ })).toBeNull(); // pas la permission sensible
  });

  it("Q-PAY-38 — résolution manuelle : motif (10 car.) et preuve obligatoires, envoi avec la preuve, appliquée aussitôt par UNE personne", async () => {
    const api = setTestApi({
      ...accessRoutes(RECONCILER),
      [`GET ${BASE}/payments/pending`]: { items: [flagged], total: 1 },
      [`GET ${BASE}/resolutions`]: { items: [] },
      [`POST ${BASE}/resolutions`]: () => json(resolution({ status: "APPROVED", decidedBy: fid(500), decidedAt: AT }), { status: 201 }),
    });
    renderWithProviders(<PendingPaymentsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Résoudre à la main/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Motif/), { target: { value: "court" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Résoudre le paiement" }));
    expect(await within(dialog).findByText("Le motif doit faire au moins 10 caractères.")).toBeTruthy();
    expect(within(dialog).getByText("Saisissez la preuve (3 caractères au moins).")).toBeTruthy();
    expect(posts(api, `${BASE}/resolutions`)).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText(/^Motif/), { target: { value: "Relevé Orange du 01/10 montrant l'encaissement" } });
    fireEvent.change(within(dialog).getByLabelText(/^Preuve/), { target: { value: "MP251001.1234.A56789" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Résoudre le paiement" }));
    await screen.findByText("La résolution est enregistrée et appliquée.");
    expect(posts(api, `${BASE}/resolutions`)[0]!.body).toEqual({
      paymentId: fid(70),
      outcome: "SUCCEEDED",
      reason: "Relevé Orange du 01/10 montrant l'encaissement",
      evidenceRef: "MP251001.1234.A56789",
    });
  });

  it("Q-PAY-38 — MFA récente exigée : code TOTP demandé, puis la MÊME requête est rejouée une seule fois", async () => {
    let calls = 0;
    const api = setTestApi({
      ...accessRoutes(RECONCILER),
      [`GET ${BASE}/payments/pending`]: { items: [flagged], total: 1 },
      [`GET ${BASE}/resolutions`]: { items: [] },
      [`POST ${BASE}/resolutions`]: () =>
        ++calls === 1
          ? json({ code: "finance.mfa_required", message: "Une vérification MFA récente est exigée pour résoudre un paiement à la main." }, { status: 403 })
          : json(resolution({ status: "APPROVED", decidedBy: fid(500), decidedAt: AT }), { status: 201 }),
      "POST /api/v1/iam/mfa/step-up": { elevated: true, expiresAt: "2026-10-05T10:05:00.000Z", ttlSec: 300 },
    });
    renderWithProviders(<PendingPaymentsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Résoudre à la main/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Motif/), { target: { value: "Relevé Orange du 01/10 montrant l'encaissement" } });
    fireEvent.change(within(dialog).getByLabelText(/^Preuve/), { target: { value: "MP251001.1234.A56789" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Résoudre le paiement" }));
    const stepUp = await screen.findByRole("dialog", { name: "Confirmez votre identité" });
    fireEvent.change(within(stepUp).getByLabelText(/Code à 6 chiffres/), { target: { value: "123456" } });
    fireEvent.click(within(stepUp).getByRole("button", { name: "Confirmer et continuer" }));
    await screen.findByText("La résolution est enregistrée et appliquée.");
    expect(calls).toBe(2);
    expect(posts(api, `${BASE}/resolutions`)).toHaveLength(2);
    expect(posts(api, `${BASE}/resolutions`)[1]!.body).toEqual(posts(api, `${BASE}/resolutions`)[0]!.body);
    expect(api.calls.filter((c) => c.path === "/api/v1/iam/mfa/step-up")).toHaveLength(1);
  });

  it("une demande déjà ouverte remplace le bouton : « Résolution à approuver »", async () => {
    setTestApi({
      ...accessRoutes(RECONCILER),
      [`GET ${BASE}/payments/pending`]: { items: [pendingRow({ reconciliation: recon({ attempts: 1, flaggedAt: AT, flagReason: "attempts_exhausted" }), openResolutionId: fid(300) })], total: 1 },
      [`GET ${BASE}/resolutions`]: { items: [resolution()] },
    });
    renderWithProviders(<PendingPaymentsScreen />);
    expect((await screen.findAllByText("Résolution à approuver")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Résoudre à la main/ })).toBeNull();
  });

  it("clôture d'une demande ouverte avant Q-PAY-38 : la note est facultative ; un refus de l'API est affiché tel quel", async () => {
    const api = setTestApi({
      ...accessRoutes(RECONCILER),
      [`GET ${BASE}/payments/pending`]: { items: [], total: 0 },
      [`GET ${BASE}/resolutions`]: { items: [resolution()] },
      [`POST ${BASE}/resolutions/${fid(300)}/approve`]: () => json({ code: "finance.resolution_not_applicable", message: "Le paiement n'est plus en attente : la résolution n'a plus d'objet." }, { status: 409 }),
    });
    renderWithProviders(<PendingPaymentsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Approuver/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/MP251001\.1234\.A56789/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Approuver" }));
    expect(await within(dialog).findByText("Le paiement n'est plus en attente : la résolution n'a plus d'objet.")).toBeTruthy();
    expect(posts(api, `${BASE}/resolutions/${fid(300)}/approve`)[0]!.body).toEqual({});
  });

  it("refus d'une demande avec note ; sans la permission sensible, aucune action sur les demandes", async () => {
    const api = setTestApi({
      ...accessRoutes(RECONCILER),
      [`GET ${BASE}/payments/pending`]: { items: [], total: 0 },
      [`GET ${BASE}/resolutions`]: { items: [resolution()] },
      [`POST ${BASE}/resolutions/${fid(300)}/reject`]: () => json(resolution({ status: "REJECTED" })),
    });
    const view = renderWithProviders(<PendingPaymentsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Refuser/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Note/), { target: { value: "Preuve insuffisante" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Refuser" }));
    await screen.findByText("La demande est refusée.");
    expect(posts(api, `${BASE}/resolutions/${fid(300)}/reject`)[0]!.body).toEqual({ note: "Preuve insuffisante" });
    view.unmount();

    setTestApi({
      ...accessRoutes(READER),
      [`GET ${BASE}/payments/pending`]: { items: [], total: 0 },
      [`GET ${BASE}/resolutions`]: { items: [resolution()] },
    });
    renderWithProviders(<PendingPaymentsScreen />);
    await screen.findByText("MP251001.1234.A56789");
    expect(screen.queryByRole("button", { name: /Approuver/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Refuser/ })).toBeNull();
  });

  it("le filtre « À rapprocher » transmet `flagged=true` à l'API ; la navigation de la section propose l'écran", async () => {
    const api = setTestApi({
      ...accessRoutes(READER),
      [`GET ${BASE}/payments/pending`]: { items: [], total: 0 },
      [`GET ${BASE}/resolutions`]: { items: [] },
    });
    renderWithProviders(
      <>
        <FinanceNav />
        <PendingPaymentsScreen />
      </>,
    );
    fireEvent.change(await screen.findByLabelText("Rapprochement"), { target: { value: "flagged" } });
    await waitFor(() => expect(api.calls.some((c) => c.method === "GET" && c.path === `${BASE}/payments/pending` && String(JSON.stringify(c.query ?? {})).includes("true"))).toBe(true));
    expect(screen.getByRole("link", { name: "À rapprocher" }).getAttribute("href")).toBe("/v2/finance/payments/pending");
  });
});

describe("RefundsScreen : remboursement chez le fournisseur et repli manuel", () => {
  const perms = [...VERIFIER, "finance.payment.refund"];

  it("statuts du remboursement fournisseur : envoyé (rien d'écrit avant confirmation) et refusé avec son motif", async () => {
    setTestApi({
      ...accessRoutes(perms),
      [`GET ${BASE}/refunds`]: { items: [refund({ id: fid(120), status: "REFUND_PENDING", provider: "mtn_momo" }), refund({ id: fid(121), status: "REFUND_FAILED", failureReason: "payee_not_allowed_to_receive" })] },
    });
    renderWithProviders(<RefundsScreen />);
    expect(await screen.findByText("Motif du refus : payee_not_allowed_to_receive")).toBeTruthy(); // les données sont chargées
    expect(screen.getAllByText("Envoyé au fournisseur").length).toBeGreaterThan(0);
    expect(screen.getByText(/le grand livre n'est écrit qu'à sa confirmation/)).toBeTruthy();
    expect(screen.getAllByText("Refusé par le fournisseur").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Exécuter/ })).toBeNull(); // un remboursement en vol ne se rejoue jamais
  });

  it("fournisseur sans API : l'exécution est refusée (409) puis le repli manuel est proposé, avec preuve obligatoire", async () => {
    const api = setTestApi({
      ...accessRoutes(perms),
      [`GET ${BASE}/refunds`]: { items: [refund({ id: fid(111), status: "APPROVED", amount: xof(5000) })] },
      [`POST ${BASE}/refunds/${fid(111)}/complete`]: (req: { body?: unknown }) => {
        const body = (req.body ?? {}) as { manual?: { reference: string } };
        if (body.manual) return json(refund({ id: fid(111), status: "COMPLETED", executionMode: "MANUAL", manualReference: body.manual.reference }));
        return json({ code: "finance.refund_manual_required", message: "Ce fournisseur ne rembourse pas par API." }, { status: 409 });
      },
    });
    renderWithProviders(<RefundsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Exécuter/ }));
    expect((await screen.findAllByText(/se font à la main chez le fournisseur/)).length).toBeGreaterThan(0);
    fireEvent.click(await screen.findByRole("button", { name: /Confirmer un remboursement manuel/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmer le remboursement" }));
    expect(await within(dialog).findByText("Saisissez la référence de la preuve (3 caractères au moins).")).toBeTruthy();
    expect(posts(api, `${BASE}/refunds/${fid(111)}/complete`).filter((p) => (p.body as { manual?: unknown })?.manual)).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/^Référence de la preuve/), { target: { value: "OM-REMB-250901-55" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmer le remboursement" }));
    await screen.findByText("Le remboursement manuel est enregistré.");
    const manualCall = posts(api, `${BASE}/refunds/${fid(111)}/complete`).find((p) => (p.body as { manual?: unknown })?.manual);
    expect(manualCall!.body).toEqual({ manual: { reference: "OM-REMB-250901-55" } });
  });

  it("approbation + exécution immédiate dont le fournisseur est incapable : approuvé, à confirmer à la main (jamais présenté comme exécuté)", async () => {
    setTestApi({
      ...accessRoutes(perms),
      [`GET ${BASE}/refunds`]: { items: [refund()] },
      [`POST ${BASE}/refunds/${fid(110)}/approve`]: () => json(refund({ status: "APPROVED" })),
    });
    renderWithProviders(<RefundsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Approuver/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approuver" }));
    expect((await screen.findAllByText(/se font à la main chez le fournisseur/)).length).toBeGreaterThan(0);
    expect(screen.queryByText("Le remboursement est approuvé et exécuté.")).toBeNull();
  });
});
