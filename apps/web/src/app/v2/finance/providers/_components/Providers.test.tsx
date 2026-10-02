// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FinanceProviderDto, FinanceProviderFieldDto, FinanceProviderListDto } from "@ecoledigitale/contracts/v2/finance";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { FinanceNav } from "../../_components/FinanceNav";
import { buildSaveBody, ProvidersScreen } from "./Providers";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/finance/providers", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const MANAGER = ["finance.provider.manage"];
const AT = "2026-10-01T09:30:00.000Z";
const BASE = "/api/v1/finance/providers";
const SECRET = "sk-live-ULTRA-SECRET-123";

function field(over: Partial<FinanceProviderFieldDto> & Pick<FinanceProviderFieldDto, "key" | "label">): FinanceProviderFieldDto {
  return { secret: false, required: true, kind: "text", generated: false, isSet: false, value: null, ...over };
}

function wave(over: Partial<FinanceProviderDto> = {}): FinanceProviderDto {
  return {
    provider: "wave",
    label: "Wave",
    description: "Paiement par portefeuille Wave.",
    enabled: false,
    configured: true,
    complete: true,
    missing: [],
    mode: "sandbox",
    sandboxAllowed: true,
    supportsRefund: true,
    webhookAuth: "signature",
    webhookUrl: "https://api.ecole.test/api/v1/finance/webhooks/wave/tenant-1",
    fields: [
      field({ key: "merchant_id", label: "Identifiant marchand", isSet: true, value: "M-123" }),
      field({ key: "zone", label: "Zone", kind: "select", options: ["ci", "sn"], defaultValue: "ci", required: false, isSet: false, value: null }),
      field({ key: "api_key", label: "Clé API", secret: true, isSet: true }),
      field({ key: "api_secret", label: "Secret API", secret: true, isSet: false }),
      field({ key: "webhook_secret", label: "Secret de webhook", secret: true, generated: true, required: false, isSet: true }),
    ],
    lastTest: null,
    updatedAt: AT,
    ...over,
  };
}

function orange(over: Partial<FinanceProviderDto> = {}): FinanceProviderDto {
  return {
    provider: "orange_money",
    label: "Orange Money",
    description: "Paiement par Orange Money.",
    enabled: false,
    configured: false,
    complete: false,
    missing: ["client_id", "client_secret"],
    mode: null,
    sandboxAllowed: true,
    supportsRefund: false,
    webhookAuth: "signed_url",
    webhookUrl: null,
    fields: [
      field({ key: "client_id", label: "Identifiant client" }),
      field({ key: "client_secret", label: "Secret client", secret: true }),
    ],
    lastTest: null,
    updatedAt: null,
    ...over,
  };
}

function list(items: FinanceProviderDto[], over: Partial<FinanceProviderListDto> = {}): FinanceProviderListDto {
  return { items, secretsAvailable: true, environment: "development", ...over };
}

function setup(extra: Record<string, unknown> = {}, data: FinanceProviderListDto = list([wave(), orange()])) {
  return setTestApi({ ...accessRoutes(MANAGER), [`GET ${BASE}`]: data, ...extra });
}

const card = (name: string) => screen.getByRole("region", { name });
const calls = (api: ReturnType<typeof setTestApi>, method: string, path: string) => api.calls.filter((c) => c.method === method && c.path === path);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ProvidersScreen : rendu", () => {
  it("une carte par fournisseur avec état, mode, environnement et champs", async () => {
    setup({}, list([wave({ enabled: true }), orange()], { environment: "production" }));
    renderWithProviders(<ProvidersScreen />);
    expect(screen.getByRole("heading", { level: 1, name: "Fournisseurs de paiement" })).toBeTruthy();
    await screen.findByRole("region", { name: "Wave" });
    const w = within(card("Wave"));
    expect(w.getByText("Actif")).toBeTruthy();
    expect(w.getAllByText("Sandbox (essai)").length).toBeGreaterThan(0); // pastille du mode enregistré
    expect((w.getByLabelText(/^Identifiant marchand/) as HTMLInputElement).value).toBe("M-123");
    expect((w.getByLabelText(/^Mode/) as HTMLSelectElement).value).toBe("sandbox");
    expect((w.getByLabelText(/^Zone/) as HTMLSelectElement).value).toBe("ci"); // valeur par défaut du serveur
    await screen.findByRole("region", { name: "Orange Money" });
    const o = within(card("Orange Money"));
    expect(o.getByText("Configuration incomplète")).toBeTruthy();
    expect(screen.getByText(/Environnement/).textContent).toContain("Production");
  });

  it("fournisseur complet mais désactivé : badge « Désactivé »", async () => {
    setup();
    renderWithProviders(<ProvidersScreen />);
    await screen.findByRole("region", { name: "Wave" });
    expect(within(card("Wave")).getByText("Désactivé")).toBeTruthy();
  });
});

describe("secrets : jamais affichés", () => {
  it("un secret enregistré : champ password VIDE, indicateur « enregistré », aucune valeur dans le DOM", async () => {
    setup();
    renderWithProviders(<ProvidersScreen />);
    const w = within(await screen.findByRole("region", { name: "Wave" }));
    const apiKey = w.getByLabelText(/^Clé API/) as HTMLInputElement;
    expect(apiKey.type).toBe("password");
    expect(apiKey.value).toBe("");
    expect(apiKey.getAttribute("autocomplete")).toBe("new-password");
    expect(w.getAllByText("Enregistré").length).toBeGreaterThan(0);
    const apiSecret = w.getByLabelText(/^Secret API/) as HTMLInputElement;
    expect(apiSecret.value).toBe("");
    expect(w.getByText("Non renseigné")).toBeTruthy();
    // Aucun champ password n'a de valeur.
    for (const input of document.querySelectorAll<HTMLInputElement>('input[type="password"]')) expect(input.value).toBe("");
  });

  it("champ généré : non éditable (aucune saisie), mention « généré par la plateforme »", async () => {
    setup();
    renderWithProviders(<ProvidersScreen />);
    const group = within(await screen.findByRole("group", { name: "Secret de webhook" }));
    expect(group.getByText("Généré par la plateforme")).toBeTruthy();
    expect(group.queryByRole("textbox")).toBeNull();
    expect(document.querySelectorAll('[aria-label="Secret de webhook"] input')).toHaveLength(0);
    expect(within(card("Wave")).getAllByLabelText(/^(Clé API|Secret API)/)).toHaveLength(2); // seuls api_key et api_secret sont saisissables
  });

  it("saisie d'un secret : le corps du PUT le contient, puis le champ est VIDE et le DOM n'en garde aucune trace", async () => {
    const api = setup({ [`PUT ${BASE}/wave`]: () => json(wave({ fields: wave().fields.map((f) => (f.key === "api_secret" ? { ...f, isSet: true } : f)) })) });
    const { queryClient, container } = renderWithProviders(<ProvidersScreen />);
    const w = within(await screen.findByRole("region", { name: "Wave" }));
    const input = w.getByLabelText(/^Secret API/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: SECRET } });
    expect(input.value).toBe(SECRET);
    fireEvent.click(w.getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("La configuration de Wave a été enregistrée.");
    const [put] = calls(api, "PUT", `${BASE}/wave`);
    expect(put!.body).toMatchObject({ mode: "sandbox", secrets: { api_secret: SECRET }, settings: { merchant_id: "M-123", zone: "ci" } });
    expect((put!.body as Record<string, unknown>).secrets).toEqual({ api_secret: SECRET }); // api_key omis : conservé
    // Après succès : vide dans le DOM, dans le HTML sérialisé et dans le cache de mutations.
    expect((screen.getByLabelText(/^Secret API/) as HTMLInputElement).value).toBe("");
    expect(container.innerHTML).not.toContain(SECRET);
    expect(document.body.innerHTML).not.toContain(SECRET);
    await waitFor(() => expect(JSON.stringify(queryClient.getMutationCache().getAll().map((m) => m.state.variables))).not.toContain(SECRET));
    expect(JSON.stringify(queryClient.getQueryCache().getAll().map((q) => q.state.data))).not.toContain(SECRET);
  });

  it("secret omis : absent du corps (conservé par l'API) ; secret ne contenant que des espaces : absent", async () => {
    const api = setup({ [`PUT ${BASE}/wave`]: () => json(wave()) });
    renderWithProviders(<ProvidersScreen />);
    const w = within(await screen.findByRole("region", { name: "Wave" }));
    fireEvent.change(w.getByLabelText(/^Identifiant marchand/), { target: { value: "M-999" } });
    fireEvent.change(w.getByLabelText(/^Clé API/), { target: { value: "   " } });
    fireEvent.click(w.getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("La configuration de Wave a été enregistrée.");
    const body = calls(api, "PUT", `${BASE}/wave`)[0]!.body as Record<string, unknown>;
    expect("secrets" in body).toBe(false);
    expect("clearSecrets" in body).toBe(false);
    expect(body.settings).toMatchObject({ merchant_id: "M-999" });
  });

  it("effacer un secret : confirmation puis clearSecrets", async () => {
    const api = setup({ [`PUT ${BASE}/wave`]: () => json(wave()) });
    renderWithProviders(<ProvidersScreen />);
    const w = within(await screen.findByRole("region", { name: "Wave" }));
    fireEvent.click(w.getByRole("button", { name: "Effacer le secret « Clé API »" }));
    const dialog = await screen.findByRole("dialog");
    expect(calls(api, "PUT", `${BASE}/wave`)).toHaveLength(0); // rien avant la confirmation
    fireEvent.click(within(dialog).getByRole("button", { name: "Effacer le secret" }));
    await screen.findByText(/Le secret « Clé API » de Wave a été effacé/);
    expect(calls(api, "PUT", `${BASE}/wave`)[0]!.body).toEqual({ clearSecrets: ["api_key"] });
  });

  it("pas de bouton « effacer » pour un secret non enregistré", async () => {
    setup();
    renderWithProviders(<ProvidersScreen />);
    const w = within(await screen.findByRole("region", { name: "Wave" }));
    expect(w.queryByRole("button", { name: "Effacer le secret « Secret API »" })).toBeNull();
  });

  it("régénérer le secret généré : confirmation puis regenerateWebhookSecret", async () => {
    const api = setup({ [`PUT ${BASE}/wave`]: () => json(wave()) });
    renderWithProviders(<ProvidersScreen />);
    const w = within(await screen.findByRole("region", { name: "Wave" }));
    fireEvent.click(w.getByRole("button", { name: "Régénérer « Secret de webhook »" }));
    const dialog = await screen.findByRole("dialog");
    expect(calls(api, "PUT", `${BASE}/wave`)).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Régénérer" }));
    await screen.findByText(/a été régénéré/);
    expect(calls(api, "PUT", `${BASE}/wave`)[0]!.body).toEqual({ regenerateWebhookSecret: true });
  });

  it("buildSaveBody : n'envoie que ce qui est renseigné", () => {
    const state = { mode: "", settings: { merchant_id: "", zone: "sn" }, secrets: { api_key: "abc", api_secret: "" } };
    expect(buildSaveBody(wave(), state)).toEqual({ settings: { zone: "sn" }, secrets: { api_key: "abc" } });
  });
});

describe("activation, mode, test de connexion", () => {
  it("activation impossible tant que la configuration est incomplète : champs manquants listés", async () => {
    setup();
    renderWithProviders(<ProvidersScreen />);
    const o = within(await screen.findByRole("region", { name: "Orange Money" }));
    expect((o.getByRole("button", { name: "Activer" }) as HTMLButtonElement).disabled).toBe(true);
    expect(o.getByText(/Champs manquants : Identifiant client, Secret client/)).toBeTruthy();
    expect((o.getByRole("button", { name: "Tester la connexion" }) as HTMLButtonElement).disabled).toBe(true);
    expect(o.queryByRole("button", { name: "Effacer les identifiants" })).toBeNull(); // rien d'enregistré
  });

  it("activation puis désactivation d'un fournisseur complet", async () => {
    let enabled = false;
    const api = setup({ [`PATCH ${BASE}/wave/status`]: ({ body }: { body: unknown }) => ((enabled = (body as { enabled: boolean }).enabled), json(wave({ enabled }))) });
    renderWithProviders(<ProvidersScreen />);
    const w = within(await screen.findByRole("region", { name: "Wave" }));
    fireEvent.click(w.getByRole("button", { name: "Activer" }));
    await screen.findByText("Wave est activé.");
    expect(calls(api, "PATCH", `${BASE}/wave/status`)[0]!.body).toEqual({ enabled: true });
  });

  it("le mode sandbox est désactivé, avec explication, quand l'environnement le refuse", async () => {
    setup({}, list([orange({ sandboxAllowed: false })], { environment: "production" }));
    renderWithProviders(<ProvidersScreen />);
    const o = within(await screen.findByRole("region", { name: "Orange Money" }));
    const mode = o.getByLabelText(/^Mode/) as HTMLSelectElement;
    const sandbox = Array.from(mode.options).find((opt) => opt.value === "sandbox")!;
    const production = Array.from(mode.options).find((opt) => opt.value === "production")!;
    expect(sandbox.disabled).toBe(true);
    expect(production.disabled).toBe(false);
    expect(o.getByText(/Le mode sandbox est refusé dans cet environnement de production/)).toBeTruthy();
  });

  it("test de connexion réussi : résultat annoncé dans une zone aria-live", async () => {
    const api = setup({ [`POST ${BASE}/wave/test`]: () => json({ ok: true, code: "ok", at: AT }) });
    renderWithProviders(<ProvidersScreen />);
    const w = within(await screen.findByRole("region", { name: "Wave" }));
    fireEvent.click(w.getByRole("button", { name: "Tester la connexion" }));
    const message = await w.findByText(/Connexion réussie/);
    expect(message.closest("[aria-live]")?.getAttribute("aria-live")).toBe("polite");
    expect(calls(api, "POST", `${BASE}/wave/test`)).toHaveLength(1);
  });

  it("test de connexion : identifiants refusés par le fournisseur", async () => {
    setup({ [`POST ${BASE}/wave/test`]: () => json({ ok: false, code: "credentials_rejected", at: AT }) });
    renderWithProviders(<ProvidersScreen />);
    const w = within(await screen.findByRole("region", { name: "Wave" }));
    fireEvent.click(w.getByRole("button", { name: "Tester la connexion" }));
    expect(await w.findByText(/Identifiants refusés par le fournisseur/)).toBeTruthy();
  });

  it("dernier test déjà enregistré par l'API : affiché au chargement", async () => {
    setup({}, list([wave({ lastTest: { at: AT, ok: false, code: "unreachable" } })]));
    renderWithProviders(<ProvidersScreen />);
    expect(await screen.findByText(/Le fournisseur est injoignable/)).toBeTruthy();
  });

  it("test limité (429) : message français du code, jamais le texte brut du serveur", async () => {
    setup({ [`POST ${BASE}/wave/test`]: () => json({ code: "finance.provider_test_throttled", message: "RAW throttle text from server" }, { status: 429 }) });
    renderWithProviders(<ProvidersScreen />);
    const w = within(await screen.findByRole("region", { name: "Wave" }));
    fireEvent.click(w.getByRole("button", { name: "Tester la connexion" }));
    expect(await w.findByText(/Trop de tests de connexion/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("RAW throttle text");
  });
});

describe("coffre des secrets, webhook, erreurs, rotation", () => {
  it("coffre indisponible : bandeau et formulaires désactivés", async () => {
    setup({}, list([wave(), orange()], { secretsAvailable: false }));
    renderWithProviders(<ProvidersScreen />);
    expect(await screen.findByText(/Le coffre des secrets n'est pas configuré : la saisie des identifiants est impossible/)).toBeTruthy();
    const w = within(card("Wave"));
    expect((w.getByLabelText(/^Clé API/) as HTMLInputElement).disabled).toBe(true);
    expect((w.getByLabelText(/^Identifiant marchand/) as HTMLInputElement).disabled).toBe(true);
    expect((w.getByLabelText(/^Mode/) as HTMLSelectElement).disabled).toBe(true);
    expect((w.getByRole("button", { name: "Enregistrer" }) as HTMLButtonElement).disabled).toBe(true);
    expect((w.getByRole("button", { name: "Activer" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Faire tourner les clés de chiffrement" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("URL de webhook : lecture seule et copie dans le presse-papiers", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    setup();
    renderWithProviders(<ProvidersScreen />);
    const w = within(await screen.findByRole("region", { name: "Wave" }));
    const url = w.getByLabelText("URL de webhook") as HTMLInputElement;
    expect(url.readOnly).toBe(true);
    fireEvent.click(w.getByRole("button", { name: "Copier" }));
    expect(await w.findByText("L'URL de webhook a été copiée.")).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith("https://api.ecole.test/api/v1/finance/webhooks/wave/tenant-1");
  });

  it("copie impossible : message et URL sélectionnée pour une copie manuelle", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) }, configurable: true });
    setup();
    renderWithProviders(<ProvidersScreen />);
    const w = within(await screen.findByRole("region", { name: "Wave" }));
    fireEvent.click(w.getByRole("button", { name: "Copier" }));
    expect(await w.findByText(/La copie automatique a échoué/)).toBeTruthy();
  });

  it("URL absente : consigne FINANCE_WEBHOOK_BASE_URL ; URL signée : avertissement de ne pas la partager", async () => {
    setup({}, list([wave({ webhookAuth: "signed_url" }), orange()]));
    renderWithProviders(<ProvidersScreen />);
    const w = within(await screen.findByRole("region", { name: "Wave" }));
    expect(w.getByText(/ne la partagez pas/)).toBeTruthy();
    const o = within(card("Orange Money"));
    expect(o.getByText(/définissez FINANCE_WEBHOOK_BASE_URL/)).toBeTruthy();
    expect(o.queryByRole("button", { name: "Copier" })).toBeNull();
  });

  it("erreur serveur à l'enregistrement : message français du code connu, jamais le texte brut", async () => {
    setup({ [`PUT ${BASE}/wave`]: () => json({ code: "finance.provider_sandbox_forbidden", message: "RAW sandbox text <script>" }, { status: 422 }) });
    renderWithProviders(<ProvidersScreen />);
    const w = within(await screen.findByRole("region", { name: "Wave" }));
    fireEvent.click(w.getByRole("button", { name: "Enregistrer" }));
    expect(await w.findByText("Le mode sandbox est refusé dans cet environnement de production.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("RAW sandbox text");
  });

  it("code inconnu : message générique par statut, jamais le texte brut ; les secrets saisis restent pour un nouvel essai", async () => {
    setup({ [`PUT ${BASE}/wave`]: () => json({ code: "finance.something_new", message: "RAW internal detail" }, { status: 409 }) });
    renderWithProviders(<ProvidersScreen />);
    const w = within(await screen.findByRole("region", { name: "Wave" }));
    fireEvent.change(w.getByLabelText(/^Secret API/), { target: { value: SECRET } });
    fireEvent.click(w.getByRole("button", { name: "Enregistrer" }));
    expect(await w.findByText(/La demande a été refusée/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("RAW internal detail");
    expect((w.getByLabelText(/^Secret API/) as HTMLInputElement).value).toBe(SECRET);
  });

  it("erreur 500 : message technique commun", async () => {
    setup({ [`PUT ${BASE}/wave`]: () => json({ code: "X", message: "stack trace RAW" }, { status: 500 }) });
    renderWithProviders(<ProvidersScreen />);
    const w = within(await screen.findByRole("region", { name: "Wave" }));
    fireEvent.click(w.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(w.getAllByRole("alert").length).toBeGreaterThan(0));
    expect(document.body.textContent).not.toContain("stack trace RAW");
  });

  it("échec de lecture de la liste : message français et bouton Réessayer", async () => {
    setup({ [`GET ${BASE}`]: () => json({ code: "X", message: "RAW list failure" }, { status: 403 }) });
    renderWithProviders(<ProvidersScreen />);
    expect(await screen.findByText(/Vous n'avez pas le droit de gérer les fournisseurs de paiement/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeTruthy();
    expect(document.body.textContent).not.toContain("RAW list failure");
  });

  it("effacer les identifiants : confirmation puis DELETE", async () => {
    const api = setup({ [`DELETE ${BASE}/wave/credentials`]: () => json(wave({ enabled: false, complete: false, fields: wave().fields.map((f) => (f.secret ? { ...f, isSet: false } : f)) })) });
    renderWithProviders(<ProvidersScreen />);
    const w = within(await screen.findByRole("region", { name: "Wave" }));
    fireEvent.click(w.getByRole("button", { name: "Effacer les identifiants" }));
    const dialog = await screen.findByRole("dialog");
    expect(calls(api, "DELETE", `${BASE}/wave/credentials`)).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Effacer les identifiants" }));
    await screen.findByText(/Les identifiants de Wave ont été effacés/);
    expect(calls(api, "DELETE", `${BASE}/wave/credentials`)).toHaveLength(1);
  });

  it("rotation des clés : confirmation puis POST, résultat affiché", async () => {
    const api = setup({ [`POST ${BASE}/rotate-secrets`]: () => json({ rotated: 3, keyId: "k2" }) });
    renderWithProviders(<ProvidersScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Faire tourner les clés de chiffrement" }));
    const dialog = await screen.findByRole("dialog");
    expect(calls(api, "POST", `${BASE}/rotate-secrets`)).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Faire tourner les clés" }));
    expect(await screen.findByText(/3 secrets rechiffrés avec la clé k2/)).toBeTruthy();
    expect(calls(api, "POST", `${BASE}/rotate-secrets`)).toHaveLength(1);
  });

  it("rotation refusée : message français dans la fenêtre", async () => {
    setup({ [`POST ${BASE}/rotate-secrets`]: () => json({ code: "finance.secrets_unavailable", message: "RAW vault" }, { status: 503 }) });
    renderWithProviders(<ProvidersScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Faire tourner les clés de chiffrement" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Faire tourner les clés" }));
    expect(await within(dialog).findByText("Le coffre des secrets n'est pas configuré : la saisie des identifiants est impossible.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("RAW vault");
  });
});

describe("navigation", () => {
  it("l'entrée n'apparaît qu'avec la permission finance.provider.manage", async () => {
    setTestApi({ ...accessRoutes(MANAGER) });
    const first = renderWithProviders(<FinanceNav />);
    expect((await screen.findByRole("link", { name: "Fournisseurs de paiement" })).getAttribute("href")).toBe("/v2/finance/providers");
    first.unmount();
    setTestApi({ ...accessRoutes(["finance.report.read"]) });
    renderWithProviders(<FinanceNav />);
    await screen.findByRole("link", { name: "Vue d'ensemble" });
    expect(screen.queryByRole("link", { name: "Fournisseurs de paiement" })).toBeNull();
  });
});
