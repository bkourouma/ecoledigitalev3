// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXAM_FEE_APPLIES_TO, EXAM_FEE_PAYMENT_STATUSES, EXAM_FEE_STATUSES } from "@ecoledigitale/contracts/v2/examinations";
import catalogMessages from "../../../../../messages/fr-CI.json";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { IDS, candidate, paper, sessionDetail, typeDto, uuid } from "../_test/fixtures";
import { CandidateDetailScreen } from "./CandidateDetailScreen";
import { TypesScreen } from "./TypesScreen";

const nav = vi.hoisted(() => ({ search: "", path: "/v2/examinations", push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.path,
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);

const E = "/api/v1/examinations";
const FEE = uuid(901);
const FEE_2 = uuid(902);

beforeEach(() => {
  nav.search = `session=${IDS.session}`;
});
afterEach(() => vi.restoreAllMocks());

const fee = (extra: Record<string, unknown> = {}) => ({
  candidateId: IDS.c1, status: "INVOICED", payerKind: "STUDENT", currency: "XOF", totalMinor: 12_500,
  lines: [{ feeId: FEE, label: "Frais d'examen (fictif)", amountMinor: 10_000 }, { feeId: FEE_2, label: "Frais de dossier (fictif)", amountMinor: 2_500 }],
  invoiceId: uuid(950), invoiceNumber: "FAC-2027-000001", payment: { status: "PARTIAL", paidMinor: 5_000 }, lastErrorCode: null, note: null, refundConfirmedAt: null, ...extra,
});

describe("libellés des frais d'examen", () => {
  it("chaque valeur d'énumération du contrat a son libellé français", () => {
    const get = (path: string): unknown => path.split(".").reduce<unknown>((acc, p) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[p] : undefined), catalogMessages);
    const missing = [
      ...EXAM_FEE_STATUSES.map((s) => `v2ExaminationsFees.candidate.status.${s}`),
      ...EXAM_FEE_PAYMENT_STATUSES.map((s) => `v2ExaminationsFees.candidate.payment.${s}`),
      ...EXAM_FEE_APPLIES_TO.map((s) => `v2ExaminationsFees.items.appliesTo.${s}`),
    ].filter((k) => typeof get(k) !== "string");
    expect(missing).toEqual([]);
  });
});

describe("Barème des frais d'un type", () => {
  const routes = (permissions: string[], items: unknown[] = [], extra: Record<string, unknown> = {}) => ({
    ...accessRoutes(permissions),
    [`GET ${E}/exam-types`]: { items: [typeDto()] },
    [`GET ${E}/exam-types/${IDS.type}`]: { ...typeDto(), tracks: [], papers: [{ ...paper(1), active: true }], requirements: [] },
    [`GET ${E}/exam-types/${IDS.type}/fee-items`]: { items },
    [`GET ${E}/fee-catalog`]: { items: [{ feeId: FEE, code: "EXAM-FICTIF", label: "Frais d'examen (fictif)", currency: "XOF", active: true }, { feeId: FEE_2, code: "DOSSIER", label: "Frais de dossier (fictif)", currency: "XOF", active: true }] },
    ...extra,
  });

  it("barème vide par défaut : le message l'explique ; sans droit de gestion, aucun appel au catalogue ni bouton d'enregistrement", async () => {
    const api = setTestApi(routes(["exam.type.read", "exam.fee.read"]));
    renderWithProviders(<TypesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Afficher le détail" }));
    expect(await screen.findByTestId("fee-items-empty")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Enregistrer le barème" })).toBeNull();
    expect(api.calls.some((c) => c.path.endsWith("/fee-catalog"))).toBe(false);
  });

  it("ajout d'un frais du catalogue puis enregistrement : corps exact, aucun montant dans le corps", async () => {
    const api = setTestApi(routes(["exam.type.read", "exam.fee.read", "exam.fee.manage"], [], { [`PUT ${E}/exam-types/${IDS.type}/fee-items`]: () => json({ items: [{ id: uuid(960), feeId: FEE, appliesTo: "STUDENT", active: true, label: "Frais d'examen (fictif)", currency: "XOF" }] }) }));
    renderWithProviders(<TypesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Afficher le détail" }));
    await screen.findByTestId("fee-items-empty");
    fireEvent.change(await screen.findByLabelText("Ajouter un frais du catalogue"), { target: { value: FEE } });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter au barème" }));
    fireEvent.change(await screen.findByLabelText("S'applique à"), { target: { value: "STUDENT" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le barème" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PUT")).toBe(true));
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({ items: [{ feeId: FEE, appliesTo: "STUDENT", active: true }] });
  });
});

describe("Frais d'examen dans le dossier du candidat", () => {
  const detail = (extra: Record<string, unknown> = {}) => ({
    candidate: candidate(1), eligibilityChecks: [], pieces: [], identifiers: [], assignment: null, history: [], scores: [], result: null, documents: [], ...extra,
  });
  const routes = (permissions: string[], feeRoute: unknown, extra: Record<string, unknown> = {}) => ({
    ...accessRoutes(permissions),
    [`GET ${E}/candidates/${IDS.c1}`]: detail(),
    [`GET ${E}/sessions/${IDS.session}`]: sessionDetail(),
    [`GET ${E}/candidates/${IDS.c1}/fee`]: feeRoute,
    ...extra,
  });

  it("affiche le statut de facturation, le paiement relu en direct et les montants formatés ; rien sans la permission", async () => {
    const without = setTestApi(routes(["exam.candidate.read"], fee()));
    const first = renderWithProviders(<CandidateDetailScreen id={IDS.c1} />);
    await screen.findByText("KOUASSI Awa");
    expect(screen.queryByTestId("candidate-fee")).toBeNull();
    expect(without.calls.some((c) => c.path.endsWith("/fee"))).toBe(false);
    first.unmount();

    setTestApi(routes(["exam.candidate.read", "exam.fee.read"], fee()));
    renderWithProviders(<CandidateDetailScreen id={IDS.c1} />);
    const block = await screen.findByTestId("candidate-fee");
    expect(block.textContent).toContain("Facturé");
    expect(block.textContent).toContain("Payé en partie");
    expect(block.textContent).toContain("FAC-2027-000001");
    expect(block.textContent).toMatch(/12\s?500/);
    expect(block.textContent).toMatch(/5\s?000/);
    expect(screen.queryByRole("button", { name: "Relancer la facturation" })).toBeNull();
  });

  it("facturation en attente : l'erreur est visible et la relance (idempotente) est proposée à la gestion", async () => {
    const api = setTestApi(routes(["exam.candidate.read", "exam.fee.read", "exam.fee.manage"], fee({ status: "PENDING_INVOICE", invoiceId: null, invoiceNumber: null, totalMinor: null, payment: { status: "NONE", paidMinor: null }, lastErrorCode: "examinations.port_unavailable", lines: [{ feeId: FEE, label: null, amountMinor: null }] }),
      { [`POST ${E}/candidates/${IDS.c1}/fee/sync`]: () => json(fee()) }));
    renderWithProviders(<CandidateDetailScreen id={IDS.c1} />);
    expect((await screen.findByTestId("candidate-fee")).textContent).toContain("examinations.port_unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Relancer la facturation" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    expect(api.calls.find((c) => c.method === "POST")!.path).toBe(`${E}/candidates/${IDS.c1}/fee/sync`);
  });

  it("candidat libre : la facture est à établir par la comptabilité (aucun montant inventé)", async () => {
    setTestApi(routes(["exam.candidate.read", "exam.fee.read"], fee({ status: "AWAITING_MANUAL_INVOICE", payerKind: "EXTERNAL", invoiceId: null, invoiceNumber: null, totalMinor: null, payment: { status: "NONE", paidMinor: null }, lines: [{ feeId: FEE, label: "Frais d'examen (fictif)", amountMinor: null }] })));
    renderWithProviders(<CandidateDetailScreen id={IDS.c1} />);
    const block = await screen.findByTestId("candidate-fee");
    expect(block.textContent).toContain("Facture à établir à la main");
    expect(block.textContent).toContain("montant à la facturation");
    expect(block.textContent).toContain("la comptabilité établit la facture");
  });

  it("remboursement dû : confirmation avec note d'au moins 5 caractères, corps exact", async () => {
    const api = setTestApi(routes(["exam.candidate.read", "exam.fee.read", "exam.fee.manage"], fee({ status: "REFUND_DUE", payment: { status: "PAID", paidMinor: 12_500 } }),
      { [`POST ${E}/candidates/${IDS.c1}/fee/refund-done`]: () => json(fee({ status: "REFUND_DONE", payment: { status: "PAID", paidMinor: 12_500 }, refundConfirmedAt: "2027-02-02T09:00:00.000Z" })) }));
    renderWithProviders(<CandidateDetailScreen id={IDS.c1} />);
    fireEvent.click(await screen.findByRole("button", { name: "Confirmer le remboursement" }));
    fireEvent.change(await screen.findByRole("textbox", { name: /Note \(mode/ }), { target: { value: "ok" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmer" }));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(screen.getByRole("textbox", { name: /Note \(mode/ }), { target: { value: "Remboursé par virement VIR-77" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmer" }));
    await waitFor(() => expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(1));
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ note: "Remboursé par virement VIR-77" });
  });

  it("candidat sans obligation (404 fee_not_found) : message neutre, pas d'erreur", async () => {
    setTestApi(routes(["exam.candidate.read", "exam.fee.read"], () => json({ code: "examinations.fee_not_found", message: "Introuvable", status: 404 }, { status: 404 })));
    renderWithProviders(<CandidateDetailScreen id={IDS.c1} />);
    expect(await screen.findByText("Aucun frais d'examen pour ce candidat.")).toBeTruthy();
  });
});
