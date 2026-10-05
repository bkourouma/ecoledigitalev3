// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { conversation, IDS, message, NOW, page, participant, uuid } from "../_test/fixtures";
import { ModerationScreen } from "./ModerationScreen";
import { SettingsScreen } from "./SettingsScreen";

vi.setConfig({ testTimeout: 30_000 });

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/messages/moderation", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const M = "/api/v1/messaging";
const MOD = ["messaging.moderation.read", "messaging.moderation.manage", "messaging.moderation.supervise"];

afterEach(() => vi.restoreAllMocks());

const report = (over: Record<string, unknown> = {}) => ({
  id: IDS.report,
  messageId: IDS.msg,
  conversationId: IDS.conv,
  reporterId: uuid(5),
  reporterName: "KONAN Enseignant",
  reason: "HARASSMENT",
  details: "Propos répétés",
  status: "OPEN",
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
  createdAt: NOW,
  ...over,
});
const reportContext = () => ({
  report: report(),
  subject: "Litige",
  participants: [participant(uuid(5), "KONAN Enseignant"), participant(uuid(6), "KONE Mère")],
  messages: [{ ...message({ id: uuid(209), seq: 1, body: "Bonjour", senderName: "KONAN Enseignant" }), rawBody: "Bonjour" }, { ...message({ id: IDS.msg, seq: 2, senderName: "KONE Mère", body: "Contenu injurieux" }), rawBody: "Contenu injurieux" }],
});

describe("ModerationScreen", () => {
  it("signalements à traiter : examen avec le contexte réel, décision (retrait + restriction) au corps exact", async () => {
    const api = setTestApi({
      ...accessRoutes(MOD),
      [`GET ${M}/moderation/reports`]: page([report()]),
      [`GET ${M}/moderation/reports/${IDS.report}`]: reportContext(),
      [`POST ${M}/moderation/reports/${IDS.report}/decide`]: () => json(report({ status: "ACTIONED", decidedAt: NOW, decisionNote: "Propos confirmés" })),
    });
    renderWithProviders(<ModerationScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Examiner" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Contenu injurieux")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmer la décision" }));
    expect(await within(dialog).findByText(/Le motif de la décision est obligatoire/)).toBeTruthy();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.change(within(dialog).getByLabelText(/Motif de la décision/), { target: { value: "Propos confirmés" } });
    fireEvent.click(within(dialog).getByLabelText("Restreindre l'envoi de l'auteur"));
    fireEvent.change(within(dialog).getByLabelText("Durée de la restriction"), { target: { value: "30" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmer la décision" }));
    expect(await screen.findByText("Décision enregistrée.")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ decision: "ACTION", note: "Propos confirmés", removeMessage: true, restrictSender: { untilDays: 30 } });
  });

  it("rejet : aucune action ; une action sans retrait ni restriction est refusée côté écran", async () => {
    const api = setTestApi({
      ...accessRoutes(MOD),
      [`GET ${M}/moderation/reports`]: page([report()]),
      [`GET ${M}/moderation/reports/${IDS.report}`]: reportContext(),
      [`POST ${M}/moderation/reports/${IDS.report}/decide`]: () => json(report({ status: "DISMISSED", decidedAt: NOW })),
    });
    renderWithProviders(<ModerationScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Examiner" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Contenu injurieux");
    fireEvent.click(within(dialog).getByLabelText("Retirer le message"));
    fireEvent.change(within(dialog).getByLabelText(/Motif de la décision/), { target: { value: "Pas de sanction" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmer la décision" }));
    expect(await within(dialog).findByText(/Précisez l'action/)).toBeTruthy();
    fireEvent.click(within(dialog).getByLabelText("Rejeter le signalement"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmer la décision" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ decision: "DISMISS", note: "Pas de sanction", removeMessage: false });
  });

  it("lecteur sans droit de décision : consultation seule ; signalement traité : note affichée", async () => {
    setTestApi({
      ...accessRoutes(["messaging.moderation.read"]),
      [`GET ${M}/moderation/reports`]: page([report({ status: "DISMISSED", decisionNote: "RAS" })]),
      [`GET ${M}/moderation/reports/${IDS.report}`]: { ...reportContext(), report: report({ status: "DISMISSED", decisionNote: "RAS" }) },
    });
    renderWithProviders(<ModerationScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Consulter" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/Signalement déjà traité\. RAS/)).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Confirmer la décision" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Supervision" })).toBeNull(); // pas de droit de supervision
  });

  it("restrictions : liste et levée", async () => {
    const api = setTestApi({
      ...accessRoutes(MOD),
      [`GET ${M}/moderation/reports`]: page([]),
      [`GET ${M}/moderation/restrictions`]: { items: [{ userId: uuid(6), displayName: "KONE Mère", restrictedUntil: NOW, reason: "Propos répétés", setBy: uuid(1), setAt: NOW }] },
      [`DELETE ${M}/moderation/restrictions/${uuid(6)}`]: () => new Response(null, { status: 204 }),
    });
    renderWithProviders(<ModerationScreen />);
    expect(await screen.findByText("Aucun signalement.")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Restrictions" }));
    expect(await screen.findByText("KONE Mère")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Lever la restriction" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "DELETE")).toBe(true));
  });

  it("supervision : le MOTIF est obligatoire avant toute lecture ; contenu réel en lecture seule", async () => {
    const api = setTestApi({
      ...accessRoutes(MOD),
      [`GET ${M}/moderation/reports`]: page([]),
      [`GET ${M}/moderation/conversations`]: page([conversation({ lastPreview: null, participants: [participant(uuid(5), "KONAN Enseignant"), participant(uuid(6), "KONE Mère")] })]),
      [`GET ${M}/moderation/conversations/${IDS.conv}/messages`]: () =>
        json({ conversation: conversation({ participants: [] }), participants: [], items: [{ ...message({ body: null, removed: true, removalKind: "MODERATOR" }), rawBody: "Contenu retiré mais lisible" }], nextBefore: null }),
    });
    renderWithProviders(<ModerationScreen />);
    fireEvent.click(await screen.findByRole("tab", { name: "Supervision" }));
    expect(await screen.findByText(/exige un motif/)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Lire avec un motif" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif de la consultation/), { target: { value: "ab" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Lire la conversation" }));
    expect(api.calls.some((c) => c.path.includes("/messages"))).toBe(false);
    fireEvent.change(within(dialog).getByLabelText(/Motif de la consultation/), { target: { value: "Enquête parent" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Lire la conversation" }));
    expect(await screen.findByText("Contenu retiré mais lisible")).toBeTruthy();
    expect(api.calls.find((c) => c.path.includes("/messages"))!.query.reason).toBe("Enquête parent");
  });

  it("erreur de chargement : réessayer", async () => {
    let fail = true;
    setTestApi({ ...accessRoutes(MOD), [`GET ${M}/moderation/reports`]: () => (fail ? json({ code: "INTERNAL", message: "x" }, { status: 500 }) : json(page([]))) });
    renderWithProviders(<ModerationScreen />);
    const alert = await screen.findByRole("alert");
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByText("Aucun signalement.")).toBeTruthy();
  });
});

describe("SettingsScreen : paramètres et gabarits", () => {
  const settings = {
    studentPolicy: "TEACHERS_AND_ADMIN",
    adminContactRoles: ["directeur", "secretariat"],
    attachmentsEnabled: true,
    attachmentMaxBytes: 5 * 1024 * 1024,
    attachmentMaxPerItem: 5,
    allowedAttachmentTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
    maxMessagesPerHour: 120,
    maxNewConversationsPerDay: 30,
    maxGroupParticipants: 200,
    maxBroadcastParticipants: 5000,
    messageMaxLength: 5000,
    notificationRetentionDays: 90,
    previousYearWindowDays: 90,
  };
  const templates = { items: [{ code: "attendance.absence", title: "Absence de {{studentName}}", body: "{{studentName}} était absent le {{date}}.", enabled: true, variables: ["studentName", "date"], customized: false }, { code: "attendance.late", title: "Retard de {{studentName}}", body: "Retard le {{date}}.", enabled: false, variables: ["studentName", "date"], customized: false }] };

  it("enregistre les paramètres avec le corps exact (politique élève, rôles, taille en octets, types)", async () => {
    const api = setTestApi({
      ...accessRoutes(["messaging.settings.manage"]),
      [`GET ${M}/settings`]: settings,
      [`GET ${M}/templates`]: templates,
      [`PUT ${M}/settings`]: ({ body }: { body: unknown }) => json({ ...settings, ...(body as object) }),
    });
    renderWithProviders(<SettingsScreen />);
    const form = await screen.findByRole("form", { name: "Paramètres de la messagerie" });
    fireEvent.change(within(form).getByLabelText(/Messagerie des élèves/), { target: { value: "TEACHERS" } });
    fireEvent.change(within(form).getByLabelText(/Rôles des contacts/), { target: { value: "directeur, econome" } });
    fireEvent.change(within(form).getByLabelText(/Taille maximale/), { target: { value: "2,5" } });
    fireEvent.click(within(form).getByLabelText("WebP"));
    fireEvent.change(within(form).getByLabelText(/Messages par heure/), { target: { value: "20" } });
    fireEvent.click(within(form).getByRole("button", { name: "Enregistrer les paramètres" }));
    expect(await screen.findByText("Paramètres enregistrés.")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({
      studentPolicy: "TEACHERS",
      adminContactRoles: ["directeur", "econome"],
      attachmentsEnabled: true,
      attachmentMaxBytes: 2621440,
      attachmentMaxPerItem: 5,
      allowedAttachmentTypes: ["application/pdf", "image/jpeg", "image/png"],
      maxMessagesPerHour: 20,
      maxNewConversationsPerDay: 30,
      maxGroupParticipants: 200,
      maxBroadcastParticipants: 5000,
      messageMaxLength: 5000,
      notificationRetentionDays: 90,
      previousYearWindowDays: 90,
    });
  });

  it("règles de cohérence côté écran : taille invalide, groupe supérieur à la diffusion ; rien n'est envoyé", async () => {
    const api = setTestApi({ ...accessRoutes(["messaging.settings.manage"]), [`GET ${M}/settings`]: settings, [`GET ${M}/templates`]: templates });
    renderWithProviders(<SettingsScreen />);
    const form = await screen.findByRole("form", { name: "Paramètres de la messagerie" });
    fireEvent.change(within(form).getByLabelText(/Taille maximale/), { target: { value: "99" } });
    fireEvent.click(within(form).getByRole("button", { name: "Enregistrer les paramètres" }));
    expect(await screen.findByText(/comprise entre/)).toBeTruthy();
    fireEvent.change(within(form).getByLabelText(/Taille maximale/), { target: { value: "5" } });
    fireEvent.change(within(form).getByLabelText(/Participants d'un message de groupe/), { target: { value: "900" } });
    fireEvent.change(within(form).getByLabelText(/Destinataires d'une diffusion/), { target: { value: "100" } });
    fireEvent.click(within(form).getByRole("button", { name: "Enregistrer les paramètres" }));
    expect(await screen.findByText(/ne peut pas dépasser celui d'une diffusion/)).toBeTruthy();
    expect(api.calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("gabarits : retard désactivé par défaut, activation et texte personnalisé envoyés ; refus de l'API affiché", async () => {
    let refuse = false;
    const api = setTestApi({
      ...accessRoutes(["messaging.settings.manage"]),
      [`GET ${M}/settings`]: settings,
      [`GET ${M}/templates`]: templates,
      [`PUT ${M}/templates/attendance.late`]: ({ body }: { body: unknown }) =>
        refuse ? json({ code: "messaging.invalid_input", message: "Variable(s) inconnue(s) : nope." }, { status: 400 }) : json({ ...templates.items[1]!, ...(body as object), customized: true }),
    });
    renderWithProviders(<SettingsScreen />);
    const late = await screen.findByRole("form", { name: "Retard d'un élève" });
    expect((within(late).getByLabelText("Envoyer ce message automatiquement") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(within(late).getByLabelText("Envoyer ce message automatiquement"));
    fireEvent.change(within(late).getByLabelText("Texte"), { target: { value: "{{studentName}} a eu du retard le {{date}}." } });
    fireEvent.click(within(late).getByRole("button", { name: "Enregistrer ce message" }));
    expect(await within(late).findByText("Message enregistré.")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({ title: "Retard de {{studentName}}", body: "{{studentName}} a eu du retard le {{date}}.", enabled: true });
    refuse = true;
    fireEvent.click(within(late).getByRole("button", { name: "Enregistrer ce message" }));
    expect(await within(late).findByText("Variable(s) inconnue(s) : nope.")).toBeTruthy();
  });
});
