// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { catalogEntry, channelHealth, delivery, NOW, preferences, ruleView, settings, templateView, uuid } from "../_test/fixtures";
import { AccountNotificationsScreen } from "./AccountNotificationsScreen";
import { ChannelsScreen } from "./ChannelsScreen";
import { JournalScreen } from "./JournalScreen";
import { RulesScreen } from "./RulesScreen";
import { SendScreen } from "./SendScreen";
import { TemplatesScreen } from "./TemplatesScreen";
import { UnsubscribeScreen } from "./UnsubscribeScreen";

vi.setConfig({ testTimeout: 30_000 });

const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/notifications", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams(nav.search) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const N = "/api/v1/notifications";
const ADMIN = ["notifications.read", "notifications.templates.manage", "notifications.rules.manage", "notifications.settings.manage"];

afterEach(() => {
  vi.restoreAllMocks();
  nav.search = "";
});

describe("JournalScreen", () => {
  it("liste les envois (destinataire masqué, statut, erreur), filtre par canal et pagine", async () => {
    const api = setTestApi({
      ...accessRoutes(ADMIN),
      [`GET ${N}/deliveries/stats`]: { since: NOW, byStatus: { SENT: 3, FAILED: 1 }, byChannel: { EMAIL: 3, SMS: 1 } },
      [`GET ${N}/deliveries`]: ({ url }: { url: URL }) => {
        if (url.searchParams.get("cursor") === "c2") return json({ items: [delivery({ id: uuid(3), recipient: "+225 ** ** ** 34", channel: "SMS" })], nextCursor: null });
        return json({
          items: [
            delivery({ id: uuid(1) }),
            delivery({ id: uuid(2), status: "FAILED", channel: "SMS", recipient: "+225 ** ** ** 78", errorCode: "sms.provider_unavailable", errorMessage: "Fournisseur injoignable", attempts: 5 }),
          ],
          nextCursor: url.searchParams.get("channel") ? null : "c2",
        });
      },
    });
    renderWithProviders(<JournalScreen />);
    expect(await screen.findByText("k***@gmail.com")).toBeTruthy();
    expect(screen.getByText("+225 ** ** ** 78")).toBeTruthy();
    expect(screen.getByText("sms.provider_unavailable", { exact: false })).toBeTruthy();
    expect(screen.getByText("5 sur 5")).toBeTruthy();
    // Statistiques par statut.
    expect((await screen.findAllByText("Échec")).length).toBeGreaterThan(1);

    fireEvent.click(screen.getByRole("button", { name: "Voir plus" }));
    expect(await screen.findByText("+225 ** ** ** 34")).toBeTruthy();
    expect(api.calls.some((c) => c.path === `${N}/deliveries` && c.query.cursor === "c2")).toBe(true);

    fireEvent.change(screen.getByLabelText("Canal"), { target: { value: "SMS" } });
    await waitFor(() => expect(api.calls.some((c) => c.path === `${N}/deliveries` && c.query.channel === "SMS")).toBe(true));
  });

  it("filtre de période : bornes en instants UTC ; aucun résultat : message adapté", async () => {
    const api = setTestApi({
      ...accessRoutes(ADMIN),
      [`GET ${N}/deliveries/stats`]: { since: NOW, byStatus: {}, byChannel: {} },
      [`GET ${N}/deliveries`]: { items: [], nextCursor: null },
    });
    renderWithProviders(<JournalScreen />);
    expect(await screen.findByText("Aucun envoi pour le moment")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Du"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("Au"), { target: { value: "2026-09-30" } });
    expect(await screen.findByText("Aucun envoi ne correspond")).toBeTruthy();
    const last = [...api.calls].reverse().find((c) => c.path === `${N}/deliveries`)!;
    expect(last.query.from).toBe("2026-09-01T00:00:00.000Z");
    expect(last.query.to).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("TemplatesScreen", () => {
  const routes = (perms: string[]) => ({
    ...accessRoutes(perms),
    [`GET ${N}/catalog`]: { items: [catalogEntry()] },
    [`GET ${N}/templates`]: { items: [templateView(), templateView({ channel: "SMS", subject: null, body: "Convocation le {{date}}", variables: ["date"] })] },
    [`GET ${N}/templates/convocation/versions`]: { items: [{ version: 2, subject: "S2", body: "Corps v2", note: "Ton plus formel", createdBy: null, createdAt: NOW, active: true }, { version: 1, subject: "S1", body: "Corps v1", note: null, createdBy: null, createdAt: NOW, active: false }] },
  });

  it("aperçu du brouillon (corps exact envoyé), publication, versions et retour arrière", async () => {
    const api = setTestApi({
      ...routes(ADMIN),
      [`POST ${N}/templates/convocation/preview`]: () => json({ subject: "Convocation : Entretien", text: "Bonjour, vous êtes convoqué le 9 octobre 2026.", html: "<p>Bonjour</p>", segments: null, warnings: ["Variable inutilisée"] }),
      [`POST ${N}/templates/convocation`]: () => json({ version: 3 }),
      [`POST ${N}/templates/convocation/activate`]: () => json({ version: 1 }),
    });
    renderWithProviders(<TemplatesScreen />);
    const body = (await screen.findByLabelText(/Texte du message/)) as HTMLTextAreaElement;
    expect(body.value).toContain("vous êtes convoqué");
    fireEvent.change(body, { target: { value: "Bonjour, entretien le {{date}}." } });

    fireEvent.click(screen.getByRole("button", { name: "Aperçu" }));
    expect(await screen.findByText("Variable inutilisée")).toBeTruthy();
    const frame = screen.getByTitle("Aperçu du message e-mail") as HTMLIFrameElement;
    expect(frame.getAttribute("sandbox")).toBe("");
    const preview = api.calls.find((c) => c.path.endsWith("/preview"))!;
    expect(preview.body).toEqual({ channel: "EMAIL", locale: "fr-CI", subject: "Convocation : {{subject}}", body: "Bonjour, entretien le {{date}}." });

    fireEvent.click(screen.getByRole("button", { name: "Publier une nouvelle version" }));
    expect(await screen.findByText("Version 3 publiée et activée.")).toBeTruthy();
    const publish = api.calls.find((c) => c.method === "POST" && c.path === `${N}/templates/convocation`)!;
    expect(publish.body).toEqual({ channel: "EMAIL", locale: "fr-CI", subject: "Convocation : {{subject}}", body: "Bonjour, entretien le {{date}}." });

    // Versions : charger dans l'éditeur, activer une version précédente.
    const versions = await screen.findByRole("region", { name: "Versions" }).catch(() => null);
    expect(versions ?? screen.getByText("Version 2")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Charger dans l'éditeur" })[1]!);
    expect((screen.getByLabelText(/Texte du message/) as HTMLTextAreaElement).value).toBe("Corps v1");
    fireEvent.click(screen.getByRole("button", { name: "Activer cette version" }));
    await waitFor(() => expect(api.calls.some((c) => c.path.endsWith("/activate"))).toBe(true));
    expect(api.calls.find((c) => c.path.endsWith("/activate"))!.body).toEqual({ channel: "EMAIL", locale: "fr-CI", version: 1 });
  });

  it("canal SMS : pas d'objet ; sans droit de gestion : consultation et aperçu seulement", async () => {
    setTestApi({ ...routes(["notifications.read"]), [`GET ${N}/templates/convocation/versions`]: { items: [] } });
    renderWithProviders(<TemplatesScreen />);
    await screen.findByLabelText(/Texte du message/);
    expect(screen.queryByRole("button", { name: "Publier une nouvelle version" })).toBeNull();
    expect((screen.getByLabelText(/Texte du message/) as HTMLTextAreaElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "SMS" }));
    await waitFor(() => expect(screen.queryByLabelText(/^Objet/)).toBeNull());
    expect(screen.getByRole("button", { name: "Aperçu" })).toBeTruthy();
  });

  it("une variable s'insère dans le texte", async () => {
    setTestApi({ ...routes(ADMIN), [`GET ${N}/templates/convocation/versions`]: { items: [] } });
    renderWithProviders(<TemplatesScreen />);
    const body = (await screen.findByLabelText(/Texte du message/)) as HTMLTextAreaElement;
    fireEvent.change(body, { target: { value: "Début " } });
    body.setSelectionRange(6, 6);
    fireEvent.click(screen.getByRole("button", { name: /\{\{note\}\}/ }));
    expect((screen.getByLabelText(/Texte du message/) as HTMLTextAreaElement).value).toBe("Début {{note}}");
  });
});

describe("RulesScreen", () => {
  const routes = () => ({
    ...accessRoutes(ADMIN),
    [`GET ${N}/rules`]: {
      items: [
        ruleView(),
        ruleView({ key: "attendance.absence", label: "Absence signalée", kind: "EVENT", trigger: "attendance.absence.recorded", conditions: {}, audience: { kind: "STUDENT_GUARDIANS", financialFirst: false, fallbackToStudent: true }, templateCode: "absence", channels: ["IN_APP"], strategy: "ALL" }),
      ],
    },
    [`GET ${N}/triggers`]: { items: [{ eventType: "attendance.absence.recorded", label: "Absence enregistrée", audiences: ["STUDENT_GUARDIANS", "STUDENT"] }] },
    [`GET ${N}/catalog`]: { items: [catalogEntry({ code: "payment_reminder", label: "Relance de paiement", manual: false }), catalogEntry({ code: "absence", label: "Absence", manual: false })] },
  });

  it("modifie les paliers de relance : corps exact ; paliers invalides refusés avant l'envoi", async () => {
    const api = setTestApi({ ...routes(), [`PUT ${N}/rules/dunning.default`]: (r: { body: unknown }) => json({ ...ruleView({ source: "TENANT" }), ...(r.body as object), key: "dunning.default", label: "Relance des impayés", kind: "DUNNING", trigger: "dunning", custom: false, updatedAt: NOW }) });
    renderWithProviders(<RulesScreen />);
    expect(await screen.findByText("paliers J+3, J+10, J+30")).toBeTruthy();
    expect(screen.getByText("Déclencheur : Absence enregistrée")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Modifier la règle Relance des impayés" }));
    const dialog = await screen.findByRole("dialog");

    const stages = within(dialog).getByLabelText(/Paliers de relance/);
    fireEvent.change(stages, { target: { value: "10, 3" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer la règle" }));
    expect(await within(dialog).findByText("Les paliers doivent être strictement croissants.")).toBeTruthy();
    fireEvent.change(stages, { target: { value: "3, x" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer la règle" }));
    expect(await within(dialog).findByText(/Indiquez un à six paliers/)).toBeTruthy();
    expect(api.calls.some((c) => c.method === "PUT")).toBe(false);

    fireEvent.change(stages, { target: { value: "2, 7, 21, 45" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer la règle" }));
    expect(await screen.findByText("Règle enregistrée.")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({
      enabled: true,
      templateCode: "payment_reminder",
      audience: { kind: "STUDENT_GUARDIANS", financialFirst: true, fallbackToStudent: false },
      channels: ["EMAIL", "SMS"],
      strategy: "FIRST_REACHABLE",
      urgent: false,
      conditions: { stages: [2, 7, 21, 45] },
    });
  });

  it("aucun canal : refusé côté écran ; règle modifiée : retour à la règle livrée", async () => {
    const api = setTestApi({
      ...routes(),
      [`GET ${N}/rules`]: { items: [ruleView({ source: "TENANT", updatedAt: NOW })] },
      [`DELETE ${N}/rules/dunning.default`]: () => new Response(null, { status: 204 }),
    });
    renderWithProviders(<RulesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Modifier la règle Relance des impayés" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText("E-mail"));
    fireEvent.click(within(dialog).getByLabelText("SMS"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer la règle" }));
    expect(await within(dialog).findByText("Choisissez au moins un canal.")).toBeTruthy();
    expect(api.calls.some((c) => c.method === "PUT")).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Rétablir la règle livrée" }));
    expect(await screen.findByText("Règle livrée rétablie.")).toBeTruthy();
    expect(api.calls.some((c) => c.method === "DELETE" && c.path === `${N}/rules/dunning.default`)).toBe(true);
  });

  it("sans droit de gestion : aucune modification proposée", async () => {
    setTestApi({ ...routes(), ...accessRoutes(["notifications.read"]) });
    renderWithProviders(<RulesScreen />);
    await screen.findByText("Relance des impayés");
    expect(screen.queryByRole("button", { name: /Modifier la règle/ })).toBeNull();
  });
});

describe("ChannelsScreen", () => {
  const routes = (perms = ADMIN) => ({
    ...accessRoutes(perms),
    [`GET ${N}/channels`]: {
      simulation: false,
      items: [
        channelHealth(),
        channelHealth({ channel: "SMS", provider: null, configured: false, state: "NOT_CONFIGURED", missing: ["SMS_HTTP_URL", "SMS_HTTP_BODY"], lastErrorCode: "notifications.channel_not_configured", lastErrorAt: NOW }),
      ],
    },
    [`GET ${N}/settings`]: settings(),
  });

  it("santé des canaux : variables manquantes (noms seulement), essai d'envoi, plafond", async () => {
    const api = setTestApi({ ...routes(), [`POST ${N}/channels/test`]: () => json({ queued: 1, skipped: 0 }, { status: 202 }) });
    renderWithProviders(<ChannelsScreen />);
    expect(await screen.findByText("SMS_HTTP_URL, SMS_HTTP_BODY")).toBeTruthy();
    expect(screen.getByText("Non configuré")).toBeTruthy();
    expect(screen.getAllByText("12 sur 500").length).toBeGreaterThan(0);
    // Un canal non configuré ne peut pas être essayé.
    expect((screen.getByRole("button", { name: "Envoyer un essai par SMS" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Envoyer un essai par E-mail" }));
    expect(await screen.findByText(/Essai en file : 1 message/)).toBeTruthy();
    expect(api.calls.find((c) => c.path === `${N}/channels/test`)!.body).toEqual({ channels: ["EMAIL"] });
  });

  it("mode simulation signalé ; réglages enregistrés avec les bornes de saisie", async () => {
    const api = setTestApi({
      ...routes(),
      [`GET ${N}/channels`]: { simulation: true, items: [channelHealth()] },
      [`PUT ${N}/settings`]: (r: { body: unknown }) => json({ ...settings(), ...(r.body as object) }),
    });
    renderWithProviders(<ChannelsScreen />);
    expect(await screen.findByText(/Mode simulation actif/)).toBeTruthy();
    const form = await screen.findByRole("form", { name: "Réglages de l'établissement" });

    fireEvent.change(within(form).getByLabelText("Indicatif téléphonique par défaut"), { target: { value: "+225" } });
    fireEvent.click(within(form).getByRole("button", { name: "Enregistrer les réglages" }));
    expect(await within(form).findByText("L'indicatif doit comporter de 1 à 4 chiffres.")).toBeTruthy();
    expect(api.calls.some((c) => c.method === "PUT")).toBe(false);

    fireEvent.change(within(form).getByLabelText("Indicatif téléphonique par défaut"), { target: { value: "225" } });
    fireEvent.change(within(form).getByLabelText("Plafond SMS"), { target: { value: "200" } });
    fireEvent.change(within(form).getByLabelText("Consentement SMS"), { target: { value: "IMPLIED" } });
    fireEvent.click(within(form).getByLabelText("WhatsApp"));
    fireEvent.click(within(form).getByRole("button", { name: "Enregistrer les réglages" }));
    expect(await screen.findByText("Réglages enregistrés.")).toBeTruthy();
    const body = api.calls.find((c) => c.method === "PUT")!.body as Record<string, unknown>;
    expect(body.dailyCaps).toEqual({ EMAIL: 500, SMS: 200 });
    expect((body.consentModels as Record<string, string>).SMS).toBe("IMPLIED");
    expect(body.enabledChannels).toEqual(["IN_APP", "EMAIL", "WHATSAPP"]);
    expect(body.senderName).toBe("Lycée Moderne");
    expect(body.replyTo).toBeNull();
    expect(body.legalFooter).toBeNull();
  });

  it("lecture seule : champs désactivés, aucun bouton d'essai ni d'enregistrement", async () => {
    setTestApi(routes(["notifications.read"]));
    renderWithProviders(<ChannelsScreen />);
    await screen.findByText("SMS_HTTP_URL, SMS_HTTP_BODY");
    expect(screen.queryByRole("button", { name: /Envoyer un essai/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Enregistrer les réglages" })).toBeNull();
    expect((await screen.findByLabelText("Indicatif téléphonique par défaut")).matches(":disabled")).toBe(true);
  });
});

describe("SendScreen", () => {
  const routes = (perms: string[]) => ({
    ...accessRoutes(perms),
    [`GET ${N}/catalog`]: { items: [catalogEntry({ code: "urgent_notice", label: "Avis urgent", category: "URGENT", variables: [{ name: "title", label: "Objet", type: "string", required: true, sample: "x" }, { name: "message", label: "Message", type: "text", required: true, sample: "y" }], channels: ["EMAIL", "SMS", "IN_APP"] })] },
    [`GET ${N}/channels`]: { simulation: false, items: [channelHealth(), channelHealth({ channel: "SMS", provider: null, configured: false, state: "NOT_CONFIGURED" }), channelHealth({ channel: "IN_APP", provider: "messaging" })] },
  });

  it("envoi à des rôles : validations, confirmation, corps exact (urgence réservée à la permission sensible)", async () => {
    const api = setTestApi({ ...routes(["notifications.send", "notifications.send.urgent"]), [`POST ${N}/send`]: () => json({ recipients: 4, deliveries: 4, skipped: 0, reused: false }, { status: 202 }) });
    renderWithProviders(<SendScreen />);
    await screen.findByLabelText("Type de message");
    // Canal non configuré : désactivé.
    expect((screen.getByLabelText(/^SMS/) as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Choisir par"), { target: { value: "ROLES" } });
    fireEvent.click(screen.getByRole("button", { name: "Vérifier avant l'envoi" }));
    expect(await screen.findByText("Choisissez au moins un canal.")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("E-mail"));
    fireEvent.click(screen.getByRole("button", { name: "Vérifier avant l'envoi" }));
    expect(await screen.findByText(/Indiquez au moins un rôle valide/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Rôles/), { target: { value: "teacher, accountant" } });
    fireEvent.click(screen.getByRole("button", { name: "Vérifier avant l'envoi" }));
    expect(await screen.findByText("Renseignez « Objet ».")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Objet/), { target: { value: "Fermeture" } });
    fireEvent.change(screen.getByLabelText(/^Message\* /), { target: { value: "École fermée demain." } });
    fireEvent.click(screen.getByLabelText(/Message urgent/));
    fireEvent.click(screen.getByRole("button", { name: "Vérifier avant l'envoi" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Envoi urgent")).toBeTruthy();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Envoyer maintenant" }));
    expect(await screen.findByText(/4 destinataire\(s\), 4 envoi\(s\)/)).toBeTruthy();
    const body = api.calls.find((c) => c.method === "POST")!.body as Record<string, unknown>;
    expect(body).toMatchObject({
      templateCode: "urgent_notice",
      audience: { kind: "ROLES", roleKeys: ["teacher", "accountant"] },
      variables: { title: "Fermeture", message: "École fermée demain." },
      channels: ["EMAIL"],
      strategy: "ALL",
      urgent: true,
    });
    expect(typeof body.clientKey).toBe("string");
  });

  it("sans permission d'urgence : case absente, jamais d'urgence dans le corps", async () => {
    const api = setTestApi({ ...routes(["notifications.send"]), [`POST ${N}/send`]: () => json({ recipients: 1, deliveries: 1, skipped: 0, reused: false }, { status: 202 }) });
    renderWithProviders(<SendScreen />);
    await screen.findByLabelText("Type de message");
    expect(screen.queryByLabelText(/Message urgent/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Choisir par"), { target: { value: "ROLES" } });
    fireEvent.click(screen.getByLabelText("E-mail"));
    fireEvent.change(screen.getByLabelText(/^Rôles/), { target: { value: "teacher" } });
    fireEvent.change(screen.getByLabelText(/^Objet/), { target: { value: "Info" } });
    fireEvent.change(screen.getByLabelText(/^Message\* /), { target: { value: "Bonjour" } });
    fireEvent.click(screen.getByRole("button", { name: "Vérifier avant l'envoi" }));
    fireEvent.click(await screen.findByRole("button", { name: "Envoyer maintenant" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    expect((api.calls.find((c) => c.method === "POST")!.body as { urgent: boolean }).urgent).toBe(false);
  });
});

describe("AccountNotificationsScreen", () => {
  const routes = () => ({
    ...accessRoutes(["notifications.own.manage"]),
    [`GET ${N}/me/preferences`]: preferences(),
    [`GET ${N}/me/push/vapid-key`]: { publicKey: "BPk" + "A".repeat(80), configured: true },
    [`GET ${N}/me/push/devices`]: { items: [{ id: uuid(9), deviceLabel: "Téléphone de Awa", createdAt: NOW, lastUsedAt: null }] },
  });

  it("une case = une préférence enregistrée aussitôt (canal, catégorie) ; canal indisponible expliqué", async () => {
    const api = setTestApi({ ...routes(), [`PUT ${N}/me/preferences`]: () => json(preferences()) });
    renderWithProviders(<AccountNotificationsScreen />);
    expect(await screen.findByText("Ce canal n'est pas disponible dans votre établissement.")).toBeTruthy();
    const finance = screen.getByLabelText("Finances par E-mail") as HTMLInputElement;
    expect(finance.checked).toBe(false);
    fireEvent.click(finance);
    await waitFor(() => expect(api.calls.some((c) => c.method === "PUT")).toBe(true));
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({ channels: [{ channel: "EMAIL", category: "FINANCE", enabled: true }] });

    fireEvent.click(screen.getByLabelText("Recevoir des messages par SMS"));
    await waitFor(() => expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(2));
    expect(api.calls.filter((c) => c.method === "PUT")[1]!.body).toEqual({ channels: [{ channel: "SMS", category: "*", enabled: true }] });
  });

  it("heures calmes : héritage de l'établissement ou plage personnelle validée", async () => {
    const api = setTestApi({ ...routes(), [`PUT ${N}/me/preferences`]: () => json(preferences()) });
    renderWithProviders(<AccountNotificationsScreen />);
    const inherit = await screen.findByLabelText("Utiliser les heures calmes de l'établissement");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les heures calmes" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PUT")).toBe(true));
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({ quietHours: { inherit: true } });

    fireEvent.click(inherit);
    fireEvent.change(screen.getByLabelText("Début"), { target: { value: "22:30" } });
    fireEvent.change(screen.getByLabelText("Fin"), { target: { value: "05:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les heures calmes" }));
    await waitFor(() => expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(2));
    expect(api.calls.filter((c) => c.method === "PUT")[1]!.body).toEqual({ quietHours: { inherit: false, enabled: true, start: "22:30", end: "05:30" } });
  });

  it("appareils push : liste, retrait ; navigateur sans Web Push : explication, aucune demande d'autorisation", async () => {
    const api = setTestApi({ ...routes(), [`DELETE ${N}/me/push/devices/${uuid(9)}`]: () => new Response(null, { status: 204 }) });
    renderWithProviders(<AccountNotificationsScreen />);
    expect(await screen.findByText("Téléphone de Awa")).toBeTruthy();
    expect(screen.getByText("Ce navigateur ne permet pas les notifications push.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Activer sur cet appareil" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retirer Téléphone de Awa" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "DELETE")).toBe(true));
  });

  it("push non configuré côté établissement : information, pas de bouton", async () => {
    setTestApi({ ...routes(), [`GET ${N}/me/push/vapid-key`]: { publicKey: null, configured: false } });
    renderWithProviders(<AccountNotificationsScreen />);
    expect(await screen.findByText("Les notifications push ne sont pas encore activées pour cet établissement.")).toBeTruthy();
  });
});

describe("UnsubscribeScreen", () => {
  const TOKEN = "t".repeat(40);

  it("ouvrir le lien n'écrit rien : la désinscription n'est appliquée qu'à la confirmation, sans jeton ni établissement", async () => {
    nav.search = `t=${TOKEN}`;
    const api = setTestApi({
      [`GET ${N}/public/unsubscribe`]: { channel: "EMAIL", applied: false, organization: "Lycée Moderne" },
      [`POST ${N}/public/unsubscribe`]: () => json({ channel: "EMAIL", applied: true, organization: "Lycée Moderne" }),
    });
    renderWithProviders(<UnsubscribeScreen />);
    expect(await screen.findByText("Voulez-vous ne plus recevoir de messages par e-mail de Lycée Moderne ?")).toBeTruthy();
    expect(api.calls.every((c) => c.method === "GET")).toBe(true);
    expect(api.calls[0]!.query.t).toBe(TOKEN);
    expect(api.calls[0]!.headers.authorization).toBeUndefined();
    expect(api.calls[0]!.headers["x-tenant-id"]).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Me désinscrire" }));
    expect(await screen.findByText("C'est fait : vous ne recevrez plus de messages par e-mail de Lycée Moderne.")).toBeTruthy();
    const post = api.calls.find((c) => c.method === "POST")!;
    expect(post.query.t).toBe(TOKEN);
    expect(post.headers.authorization).toBeUndefined();
  });

  it("lien absent ou invalide : message clair, aucun bouton", async () => {
    nav.search = "";
    setTestApi({});
    const first = renderWithProviders(<UnsubscribeScreen />);
    expect(await screen.findByText(/Ce lien n'est pas valide/)).toBeTruthy();
    first.unmount();

    nav.search = `t=${TOKEN}`;
    setTestApi({ [`GET ${N}/public/unsubscribe`]: () => json({ code: "notifications.token_invalid", message: "Ce lien de désinscription n'est plus valide." }, { status: 400 }) });
    renderWithProviders(<UnsubscribeScreen />);
    expect(await screen.findByText("Ce lien de désinscription n'est plus valide.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Me désinscrire" })).toBeNull();
  });

  it("lien déjà appliqué : confirmation directe", async () => {
    nav.search = `t=${TOKEN}`;
    setTestApi({ [`GET ${N}/public/unsubscribe`]: { channel: "SMS", applied: true, organization: null } });
    renderWithProviders(<UnsubscribeScreen />);
    expect(await screen.findByText("C'est fait : vous ne recevrez plus de messages par SMS.")).toBeTruthy();
  });
});
