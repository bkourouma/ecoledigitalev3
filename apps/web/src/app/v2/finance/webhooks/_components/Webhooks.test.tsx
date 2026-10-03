// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { fid } from "../../../_test/fixtures-finance";
import { FinanceNav } from "../../_components/FinanceNav";
import { WebhooksScreen } from "./Webhooks";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/finance/webhooks", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const READER = ["finance.webhook.read"];
const REPLAYER = ["finance.webhook.read", "finance.webhook.replay"];
const BASE = "/api/v1/finance/webhook-events";
const AT = "2026-10-02T09:00:00.000Z";

const event = (over: Record<string, unknown> = {}) => ({
  id: fid(400),
  provider: "wave",
  eventId: "evt-1",
  eventType: "checkout.completed",
  status: "FAILED",
  paymentId: fid(70),
  error: "finance.provider_amount_mismatch",
  attempts: 2,
  receivedAt: AT,
  processedAt: null,
  ...over,
});

const posts = (api: ReturnType<typeof setTestApi>, path: string) => api.calls.filter((c) => c.method === "POST" && c.path === path);

describe("WebhooksScreen (webhooks en échec)", () => {
  it("liste les événements en échec avec un motif en français, sans action de rejeu pour un lecteur", async () => {
    const api = setTestApi({ ...accessRoutes(READER), [`GET ${BASE}`]: { items: [event(), event({ id: fid(401), eventId: "evt-2", error: "motif\nbrut du futur" })], total: 2 } });
    renderWithProviders(<WebhooksScreen />);
    expect(await screen.findByText("Le montant annoncé diffère de celui du paiement.")).toBeTruthy();
    expect(screen.getAllByText("Une vérification manuelle est nécessaire.").length).toBe(1); // jamais le code brut
    expect(screen.queryByText(/motif/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Rejouer/ })).toBeNull();
    expect(api.calls.find((c) => c.method === "GET" && c.path === BASE)!.query.status).toBe("FAILED");
  });

  it("filtre par statut, fournisseur et paiement (identifiant invalide non transmis)", async () => {
    const api = setTestApi({ ...accessRoutes(READER), [`GET ${BASE}`]: { items: [], total: 0 } });
    renderWithProviders(<WebhooksScreen />);
    await screen.findByText("Aucun webhook en échec");
    fireEvent.change(screen.getByLabelText("Fournisseur"), { target: { value: "wave" } });
    fireEvent.change(screen.getByLabelText("Statut"), { target: { value: "PROCESSED" } });
    await screen.findByText("Aucun événement pour ce filtre");
    fireEvent.change(screen.getByLabelText(/^Paiement/), { target: { value: "pas-un-uuid" } });
    expect(await screen.findByText("Identifiant de paiement invalide.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Paiement/), { target: { value: fid(70) } });
    await waitFor(() => expect(api.calls.some((c) => c.query.paymentId === fid(70) && c.query.provider === "wave" && c.query.status === "PROCESSED")).toBe(true));
    expect(api.calls.some((c) => c.query.paymentId === "pas-un-uuid")).toBe(false);
  });

  it("détail : champs de suivi, jamais de charge brute", async () => {
    setTestApi({ ...accessRoutes(READER), [`GET ${BASE}`]: { items: [event()], total: 1 }, [`GET ${BASE}/${fid(400)}`]: event() });
    renderWithProviders(<WebhooksScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /Détail/ }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("evt-1")).toBeTruthy();
    expect(within(dialog).getByText("Le montant annoncé diffère de celui du paiement.")).toBeTruthy();
    expect(within(dialog).getByText(/Aucun contenu brut ni secret/)).toBeTruthy();
    expect(within(dialog).queryByText(/payload|signature/i)).toBeNull();
  });

  it("rejeu : confirmation explicite obligatoire, note facultative, résultat lisible, aucune issue imposée", async () => {
    const api = setTestApi({
      ...accessRoutes(REPLAYER),
      [`GET ${BASE}`]: { items: [event()], total: 1 },
      [`POST ${BASE}/${fid(400)}/replay`]: { replayed: false, resolved: true, event: event({ status: "PROCESSED", error: null }), paymentStatus: "CONFIRMED" },
    });
    renderWithProviders(<WebhooksScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /^Rejouer/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/authentification renforcée/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Rejouer l'événement" }));
    expect(await within(dialog).findByText("Cochez la case pour confirmer le rejeu.")).toBeTruthy();
    expect(posts(api, `${BASE}/${fid(400)}/replay`)).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText(/Motif/), { target: { value: "  Relevé vérifié  " } });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Rejouer l'événement" }));
    await screen.findByText("Le rejeu a abouti : l'événement est réglé.");
    expect(posts(api, `${BASE}/${fid(400)}/replay`)[0]!.body).toEqual({ note: "Relevé vérifié" });
    expect(screen.getByText(/Statut du paiement : CONFIRMED/)).toBeTruthy();
  });

  it("rejeu sans abouti, et déjà traité : messages distincts", async () => {
    setTestApi({
      ...accessRoutes(REPLAYER),
      [`GET ${BASE}`]: { items: [event()], total: 1 },
      [`POST ${BASE}/${fid(400)}/replay`]: { replayed: false, resolved: false, event: event({ attempts: 3 }), paymentStatus: "PENDING" },
    });
    renderWithProviders(<WebhooksScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /^Rejouer/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Rejouer l'événement" }));
    expect(await screen.findByText(/reste en échec/)).toBeTruthy();
  });

  it("MFA requise : message dédié, la fenêtre reste ouverte pour réessayer", async () => {
    setTestApi({
      ...accessRoutes(REPLAYER),
      [`GET ${BASE}`]: { items: [event()], total: 1 },
      [`POST ${BASE}/${fid(400)}/replay`]: () => json({ code: "rbac.mfa_required", message: "Authentification forte (MFA) requise pour cette action." }, { status: 403 }),
    });
    renderWithProviders(<WebhooksScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /^Rejouer/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Rejouer l'événement" }));
    // Élévation d'authentification : le code TOTP est demandé ; annuler garde le message dédié, la fenêtre reste ouverte.
    const stepUp = await screen.findByRole("dialog", { name: "Confirmez votre identité" });
    fireEvent.click(within(stepUp).getByRole("button", { name: "Annuler" }));
    expect(await within(dialog).findByText(/authentification renforcée est requise/)).toBeTruthy();
  });

  it("MFA requise : confirmation du code TOTP puis rejeu relancé UNE fois (même requête), résultat affiché", async () => {
    let replays = 0;
    const api = setTestApi({
      ...accessRoutes(REPLAYER),
      [`GET ${BASE}`]: { items: [event()], total: 1 },
      [`POST ${BASE}/${fid(400)}/replay`]: () =>
        ++replays === 1
          ? json({ code: "rbac.mfa_required", message: "Authentification forte (MFA) requise pour cette action." }, { status: 403 })
          : json({ replayed: false, resolved: true, event: event({ status: "PROCESSED", error: null }), paymentStatus: "CONFIRMED" }),
      "POST /api/v1/iam/mfa/step-up": { elevated: true, expiresAt: "2026-10-02T10:05:00.000Z", ttlSec: 300 },
    });
    renderWithProviders(<WebhooksScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /^Rejouer/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Rejouer l'événement" }));
    const stepUp = await screen.findByRole("dialog", { name: "Confirmez votre identité" });
    fireEvent.change(within(stepUp).getByLabelText(/Code à 6 chiffres/), { target: { value: "123456" } });
    fireEvent.click(within(stepUp).getByRole("button", { name: "Confirmer et continuer" }));
    await screen.findByText("Le rejeu a abouti : l'événement est réglé.");
    expect(replays).toBe(2);
    expect(posts(api, `${BASE}/${fid(400)}/replay`)).toHaveLength(2);
    expect(api.calls.filter((c) => c.path === "/api/v1/iam/mfa/step-up")).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("un événement déjà réglé n'a pas de bouton de rejeu", async () => {
    setTestApi({ ...accessRoutes(REPLAYER), [`GET ${BASE}`]: { items: [event({ status: "PROCESSED", error: null })], total: 1 } });
    renderWithProviders(<WebhooksScreen />);
    await screen.findByRole("button", { name: /Détail/ });
    expect(screen.queryByRole("button", { name: /^Rejouer/ })).toBeNull();
  });

  it("menu : l'entrée n'apparaît qu'avec finance.webhook.read", async () => {
    setTestApi(accessRoutes(READER));
    renderWithProviders(<FinanceNav />);
    expect(await screen.findByRole("link", { name: "Webhooks en échec" })).toBeTruthy();
    setTestApi(accessRoutes(["finance.payment.read"]));
    renderWithProviders(<FinanceNav />);
    await screen.findAllByRole("link", { name: "Encaissements" });
    expect(screen.getAllByRole("link", { name: "Webhooks en échec" })).toHaveLength(1); // celui du premier rendu seulement
  });
});
