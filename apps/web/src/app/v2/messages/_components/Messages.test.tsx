// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  messagingAnnouncementDtoSchema,
  messagingConversationDetailDtoSchema,
  messagingConversationSummaryDtoSchema,
  messagingMessageDtoSchema,
  messagingMyAudienceDtoSchema,
  messagingNotificationDtoSchema,
} from "@ecoledigitale/contracts/v2/messaging";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { studentSummary } from "../../_test/fixtures-people";
import { announcement, conversation, conversationDetail, IDS, message, myAudience, notification, NOW, page, participant, uuid } from "../_test/fixtures";
import { ComposeScreen } from "./ComposeScreen";
import { InboxScreen } from "./InboxScreen";
import { NotificationBell } from "./NotificationBell";
import { NotificationsScreen } from "./NotificationsScreen";
import { ThreadScreen } from "./ThreadScreen";

vi.setConfig({ testTimeout: 30_000 });

const nav = vi.hoisted(() => ({ push: vi.fn(), search: "" }));
vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/messages", useRouter: () => ({ push: nav.push, replace: vi.fn() }), useSearchParams: () => new URLSearchParams(nav.search) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const M = "/api/v1/messaging";
const bodyBox = () => screen.getByRole("textbox", { name: /^Message \(obligatoire\)/ }) as HTMLTextAreaElement;
const READ = accessRoutes(["messaging.child.read", "messaging.child.send"]);

beforeEach(() => {
  nav.push.mockClear();
  nav.search = "";
});
afterEach(() => vi.restoreAllMocks());

describe("fabriques de test conformes aux contrats courants", () => {
  it("les données simulées passent les schémas de réponse (aucune dérive silencieuse)", () => {
    expect(messagingConversationSummaryDtoSchema.safeParse(conversation()).success).toBe(true);
    expect(messagingConversationDetailDtoSchema.safeParse(conversationDetail()).success).toBe(true);
    expect(messagingMessageDtoSchema.safeParse(message()).success).toBe(true);
    expect(messagingAnnouncementDtoSchema.safeParse(announcement()).success).toBe(true);
    expect(messagingNotificationDtoSchema.safeParse(notification()).success).toBe(true);
    expect(messagingMyAudienceDtoSchema.safeParse(myAudience()).success).toBe(true);
  });
});

describe("InboxScreen : boîte de réception", () => {
  const rows = [conversation({ unreadCount: 2, priority: "HIGH", starred: true }), conversation({ id: IDS.conv2, kind: "SYSTEM", subject: "Alertes", participants: [], participantCount: 1, lastPreview: "Absence de Awa Koné", allowReplies: false })];

  it("liste les conversations avec non-lus, priorité, favori, fil système ; lien vers le fil", async () => {
    setTestApi({
      ...READ,
      [`GET ${M}/me/audience`]: myAudience({ isGuardian: true }),
      [`GET ${M}/conversations`]: page(rows),
    });
    renderWithProviders(<InboxScreen />);
    const list = await screen.findByRole("list", { name: "Conversations" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText("Devoirs de maths")).toBeTruthy();
    expect(within(items[0]!).getByText("2 non lu(s)")).toBeTruthy();
    expect(within(items[0]!).getByText("Élevée")).toBeTruthy();
    expect(within(items[0]!).getByLabelText("Favori")).toBeTruthy();
    expect(within(items[0]!).getByRole("link").getAttribute("href")).toBe(`/v2/messages/${IDS.conv}`);
    expect(within(items[1]!).getByText("EcoleDigitale — alertes")).toBeTruthy();
    expect(await screen.findByRole("link", { name: "Nouveau message" })).toBeTruthy();
  });

  it("états : chargement, vide par dossier, erreur avec « Réessayer »", async () => {
    let fail = true;
    setTestApi({
      ...READ,
      [`GET ${M}/me/audience`]: myAudience(),
      [`GET ${M}/conversations`]: ({ url }) => {
        if (fail) return json({ code: "INTERNAL", message: "boom" }, { status: 500 });
        return json(page(url.searchParams.get("folder") === "archived" ? [] : rows));
      },
    });
    renderWithProviders(<InboxScreen />);
    expect(screen.getByRole("status")).toBeTruthy();
    const alert = await screen.findByRole("alert");
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Réessayer" }));
    await screen.findByRole("list", { name: "Conversations" });
    fireEvent.click(screen.getByRole("tab", { name: "Archivés" }));
    expect(await screen.findByText("Aucune conversation archivée.")).toBeTruthy();
  });

  it("recherche par objet / personne (paramètre q, temporisé) puis dans le texte des messages", async () => {
    const api = setTestApi({
      ...READ,
      [`GET ${M}/me/audience`]: myAudience(),
      [`GET ${M}/conversations`]: page(rows),
      [`GET ${M}/search`]: { items: [{ conversationId: IDS.conv, messageId: IDS.msg, seq: 1, subject: "Devoirs de maths", senderName: "KONAN Enseignant", snippet: "…la réunion de rentrée…", createdAt: NOW }] },
    });
    renderWithProviders(<InboxScreen />);
    await screen.findByRole("list", { name: "Conversations" });
    fireEvent.change(screen.getByLabelText("Rechercher dans la messagerie"), { target: { value: "konan" } });
    await waitFor(() => expect(api.calls.some((c) => c.path === `${M}/conversations` && c.query.q === "konan")).toBe(true));
    fireEvent.click(screen.getByRole("radio", { name: "Texte des messages" }));
    fireEvent.change(screen.getByLabelText("Rechercher dans la messagerie"), { target: { value: "réunion" } });
    expect(await screen.findByText("…la réunion de rentrée…")).toBeTruthy();
    await waitFor(() => expect(api.calls.some((c) => c.path === `${M}/search` && c.query.q === "réunion")).toBe(true));
  });

  it("pagination par curseur : « Afficher plus » demande la page suivante", async () => {
    const api = setTestApi({
      ...READ,
      [`GET ${M}/me/audience`]: myAudience(),
      [`GET ${M}/conversations`]: ({ url }) => (url.searchParams.get("cursor") ? json(page([conversation({ id: uuid(102), subject: "Seconde page" })])) : json(page([rows[0]], "CURSEUR"))),
    });
    renderWithProviders(<InboxScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Afficher plus" }));
    expect(await screen.findByText("Seconde page")).toBeTruthy();
    expect(api.calls.find((c) => c.query.cursor === "CURSEUR")).toBeTruthy();
  });

  it("ouvre directement le dossier demandé par l'adresse (après une diffusion : « Envoyés »)", async () => {
    nav.search = "folder=sent";
    const api = setTestApi({ ...READ, [`GET ${M}/me/audience`]: myAudience(), [`GET ${M}/conversations`]: page([conversation({ broadcastCount: 24, subject: "Convocation" })]) });
    renderWithProviders(<InboxScreen />);
    expect(await screen.findByText("Diffusion : 24 destinataire(s)")).toBeTruthy();
    expect(api.calls.some((c) => c.path.endsWith("/conversations") && c.query.folder === "sent")).toBe(true);
    expect(screen.getByRole("tab", { name: "Envoyés" }).getAttribute("aria-selected")).toBe("true");
  });

  it("compte restreint : avertissement et pas de bouton d'écriture", async () => {
    setTestApi({
      ...READ,
      [`GET ${M}/me/audience`]: myAudience({ canSend: false, restricted: true }),
      [`GET ${M}/conversations`]: page(rows),
    });
    renderWithProviders(<InboxScreen />);
    expect(await screen.findByText(/temporairement restreint/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Nouveau message" })).toBeNull();
  });
});

describe("ThreadScreen : fil de conversation", () => {
  const thread = (over: { detail?: Record<string, unknown>; conv?: Record<string, unknown>; messages?: unknown[]; nextBefore?: number | null } = {}) => ({
    ...READ,
    [`GET ${M}/conversations/${IDS.conv}`]: conversationDetail(over.detail ?? {}, over.conv ?? {}),
    [`GET ${M}/conversations/${IDS.conv}/messages`]: { items: over.messages ?? [message(), message({ id: uuid(201), seq: 2, mine: true, senderId: IDS.me, senderName: "Moi", body: "Merci !" })], nextBefore: over.nextBefore ?? null },
    [`POST ${M}/conversations/${IDS.conv}/read`]: { lastReadSeq: 2, unreadCount: 0 },
  });

  it("affiche les messages dans l'ordre, marque le fil lu une fois (POST explicite), annonce les nouveaux messages", async () => {
    const api = setTestApi(thread({ conv: { unreadCount: 1 } }));
    renderWithProviders(<ThreadScreen conversationId={IDS.conv} />);
    const log = await screen.findByRole("log", { name: "Messages de la conversation" });
    expect(log.getAttribute("aria-live")).toBe("polite");
    const bubbles = within(log).getAllByRole("article");
    expect(bubbles).toHaveLength(2);
    expect(within(bubbles[0]!).getByText("Bonjour, voici les devoirs.")).toBeTruthy();
    expect(within(bubbles[1]!).getByText("Vous")).toBeTruthy();
    await waitFor(() => expect(api.calls.filter((c) => c.method === "POST" && c.path.endsWith("/read"))).toHaveLength(1));
    expect(screen.getByRole("heading", { level: 1, name: "Devoirs de maths" })).toBeTruthy();
  });

  it("répond : corps exact avec clé d'idempotence, champ vidé ensuite ; une erreur de l'API s'affiche", async () => {
    let fail = false;
    const api = setTestApi({
      ...thread({}),
      [`POST ${M}/conversations/${IDS.conv}/messages`]: ({ body }: { body: unknown }) =>
        fail ? json({ code: "messaging.sender_restricted", message: "Votre envoi de messages est temporairement restreint." }, { status: 403 }) : json({ message: message({ id: uuid(203), seq: 3, mine: true, body: (body as { body: string }).body }), conversation: null }, { status: 201 }),
    });
    renderWithProviders(<ThreadScreen conversationId={IDS.conv} />);
    const box = (await screen.findByLabelText("Votre réponse")) as HTMLTextAreaElement;
    expect((screen.getByRole("button", { name: "Envoyer" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(box, { target: { value: "  Merci pour les informations.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    await waitFor(() => expect(box.value).toBe(""));
    const post = api.calls.find((c) => c.method === "POST" && c.path.endsWith("/messages"))!;
    expect(post.body).toMatchObject({ body: "Merci pour les informations.", attachmentIds: [] });
    expect((post.body as { clientId: string }).clientId).toMatch(/^[0-9a-f-]{36}$/);
    fail = true;
    fireEvent.change(box, { target: { value: "Encore" } });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    expect(await screen.findByText("Votre envoi de messages est temporairement restreint.")).toBeTruthy();
    expect(box.value).toBe("Encore"); // le texte n'est pas perdu
  });

  it("réponse impossible : l'API donne la raison, aucun formulaire", async () => {
    setTestApi(thread({ detail: { canReply: false, replyBlockedReason: "Les réponses sont désactivées dans cette conversation." } }));
    renderWithProviders(<ThreadScreen conversationId={IDS.conv} />);
    expect(await screen.findByText("Les réponses sont désactivées dans cette conversation.")).toBeTruthy();
    expect(screen.queryByLabelText("Votre réponse")).toBeNull();
  });

  it("fil système : pas de réponse, message explicatif", async () => {
    setTestApi(thread({ conv: { kind: "SYSTEM", subject: "Alertes", allowReplies: false }, detail: { canReply: false, replyBlockedReason: "x" }, messages: [message({ kind: "SYSTEM", senderId: null, senderName: null, systemCode: "attendance.absence", body: "Absence de Awa Koné le 02/10/2026" })] }));
    renderWithProviders(<ThreadScreen conversationId={IDS.conv} />);
    expect(await screen.findByText(/alertes automatiques/)).toBeTruthy();
    expect(screen.getByText("Absence de Awa Koné le 02/10/2026")).toBeTruthy();
    expect(screen.queryByLabelText("Votre réponse")).toBeNull();
  });

  it("message retiré : espace réservé sans contenu ; pas de signalement d'un message retiré", async () => {
    setTestApi(thread({ messages: [message({ removed: true, body: null, removalKind: "MODERATOR" })] }));
    renderWithProviders(<ThreadScreen conversationId={IDS.conv} />);
    expect(await screen.findByText("Message retiré par la modération")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Signaler/ })).toBeNull();
  });

  it("signaler un message : motif et précisions envoyés, confirmation", async () => {
    const api = setTestApi({ ...thread({}), [`POST ${M}/messages/${IDS.msg}/report`]: () => json({ reportId: IDS.report }, { status: 201 }) });
    renderWithProviders(<ThreadScreen conversationId={IDS.conv} />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Signaler" }))[0]!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif/), { target: { value: "HARASSMENT" } });
    fireEvent.change(within(dialog).getByLabelText("Précisions"), { target: { value: "Propos répétés" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Signaler" }));
    expect(await screen.findByText(/votre signalement a été transmis/)).toBeTruthy();
    expect(api.calls.find((c) => c.path.endsWith("/report"))!.body).toEqual({ reason: "HARASSMENT", details: "Propos répétés" });
  });

  it("retirer son propre message ; archiver / favori / sourdine envoient l'état par PATCH ; groupe : quitter", async () => {
    const api = setTestApi({
      ...thread({ conv: { kind: "GROUP", participantCount: 3 } }),
      [`DELETE ${M}/messages/${uuid(201)}`]: () => new Response(null, { status: 204 }),
      [`PATCH ${M}/conversations/${IDS.conv}/me`]: ({ body }: { body: unknown }) => json(conversation({ ...(body as object) })),
      [`POST ${M}/conversations/${IDS.conv}/leave`]: () => new Response(null, { status: 204 }),
    });
    renderWithProviders(<ThreadScreen conversationId={IDS.conv} />);
    fireEvent.click(await screen.findByRole("button", { name: "Retirer" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "DELETE")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: /Favori/ }));
    fireEvent.click(screen.getByRole("button", { name: /Sourdine/ }));
    await waitFor(() => expect(api.calls.filter((c) => c.method === "PATCH").map((c) => c.body)).toEqual([{ starred: true }, { muted: true }]));
    fireEvent.click(screen.getByRole("button", { name: "Quitter le groupe" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/v2/messages"));
  });

  it("messages précédents : demande la page antérieure avec `before`", async () => {
    const api = setTestApi({
      ...thread({ nextBefore: 5 }),
      [`GET ${M}/conversations/${IDS.conv}/messages`]: ({ url }) =>
        url.searchParams.get("before") ? json({ items: [message({ id: uuid(210), seq: 3, body: "Ancien message" })], nextBefore: null }) : json({ items: [message({ id: uuid(211), seq: 6, body: "Récent" })], nextBefore: 5 }),
    });
    renderWithProviders(<ThreadScreen conversationId={IDS.conv} />);
    fireEvent.click(await screen.findByRole("button", { name: "Messages précédents" }));
    const log = screen.getByRole("log");
    await waitFor(() => expect(within(log).getAllByRole("article").map((a) => a.textContent)).toEqual([expect.stringContaining("Ancien message"), expect.stringContaining("Récent")]));
    expect(api.calls.find((c) => c.query.before === "5")).toBeTruthy();
  });

  it("pièce jointe : URL signée demandée au clic seulement", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const att = { id: uuid(300), fileName: "bulletin.pdf", mimeType: "application/pdf", sizeBytes: 2048 };
    const api = setTestApi({
      ...thread({ messages: [message({ attachments: [att] })] }),
      [`GET ${M}/attachments/${att.id}/url`]: { url: "https://storage.test/x?sig=1", expiresAt: NOW },
    });
    renderWithProviders(<ThreadScreen conversationId={IDS.conv} />);
    const button = await screen.findByRole("button", { name: /bulletin\.pdf/ });
    expect(api.calls.some((c) => c.path.includes("/attachments/"))).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://storage.test/x?sig=1", "_blank", "noopener,noreferrer"));
  });

  it("fil introuvable : erreur affichée (aucune fuite d'existence)", async () => {
    setTestApi({ ...READ, [`GET ${M}/conversations/${IDS.conv}`]: () => json({ code: "messaging.conversation_not_found", message: "Conversation introuvable." }, { status: 404 }), [`GET ${M}/conversations/${IDS.conv}/messages`]: () => json({ code: "messaging.conversation_not_found", message: "Conversation introuvable." }, { status: 404 }) });
    renderWithProviders(<ThreadScreen conversationId={IDS.conv} />);
    expect(await screen.findByText("Conversation introuvable.")).toBeTruthy();
  });
});

describe("ComposeScreen : composition avec destinataires autorisés", () => {
  const teacherRecipient = { userId: IDS.teacher, displayName: "KONAN Enseignant", kind: "STAFF", relation: "Enseignant — 6ème A", classroomId: IDS.class6A, studentId: null };

  it("parent : un seul type de message, destinataires proposés par l'API, corps exact, redirection vers le fil", async () => {
    const api = setTestApi({
      ...READ,
      [`GET ${M}/me/audience`]: myAudience({ isGuardian: true }),
      "GET /api/v1/people/children": { items: [studentSummary({ id: IDS.student, displayName: "Awa Koné", lastName: "KONE", firstName: "Awa" })] },
      [`GET ${M}/recipients`]: { items: [teacherRecipient, { ...teacherRecipient, userId: uuid(9), displayName: "DIRECTION Marie", kind: "STAFF", relation: "Administration", classroomId: null }] },
      [`POST ${M}/conversations`]: () => json({ conversation: conversation(), message: message({ mine: true }), broadcastId: null, reused: false, recipientCount: 1 }, { status: 201 }),
    });
    renderWithProviders(<ComposeScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /KONAN Enseignant/ }));
    expect(screen.queryByRole("radio", { name: /Diffusion/ })).toBeNull(); // un parent ne diffuse pas
    expect(screen.queryByText("Classes")).toBeNull();
    fireEvent.change(bodyBox(), { target: { value: "Bonjour, une question sur les devoirs." } });
    await screen.findByRole("option", { name: "Awa Koné" });
    fireEvent.change(screen.getByLabelText("À propos de l'enfant"), { target: { value: IDS.student } });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`/v2/messages/${IDS.conv}`));
    const post = api.calls.find((c) => c.method === "POST")!;
    expect(post.body).toMatchObject({ kind: "DIRECT", priority: "NORMAL", body: "Bonjour, une question sur les devoirs.", aboutStudentId: IDS.student, attachmentIds: [], recipients: { userIds: [IDS.teacher], classrooms: [], toAdministration: false } });
  });

  it("recherche d'une personne : paramètre q envoyé, seules les personnes renvoyées sont proposées", async () => {
    const api = setTestApi({
      ...READ,
      [`GET ${M}/me/audience`]: myAudience({ isGuardian: true }),
      "GET /api/v1/people/children": { items: [] },
      [`GET ${M}/recipients`]: ({ url }) => json({ items: url.searchParams.get("q") === "konan" ? [teacherRecipient] : [] }),
    });
    renderWithProviders(<ComposeScreen />);
    expect(await screen.findByText(/Aucune suggestion/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Rechercher une personne/), { target: { value: "konan" } });
    expect(await screen.findByRole("button", { name: /KONAN Enseignant/ })).toBeTruthy();
    await waitFor(() => expect(api.calls.some((c) => c.path.endsWith("/recipients") && c.query.q === "konan")).toBe(true));
  });

  it("validation avec les règles du contrat : destinataire, message, objet d'un groupe ; rien n'est envoyé", async () => {
    const api = setTestApi({
      ...READ,
      [`GET ${M}/me/audience`]: myAudience({ isStaff: true, classrooms: [{ id: IDS.class6A, name: "6ème A" }] }),
      [`GET ${M}/recipients`]: { items: [teacherRecipient] },
    });
    renderWithProviders(<ComposeScreen />);
    await screen.findByRole("radio", { name: /Message direct/ });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    expect(await screen.findByText("Choisissez au moins un destinataire.")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Message de groupe/ }));
    fireEvent.click(await screen.findByRole("button", { name: /KONAN Enseignant/ }));
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    expect(await screen.findByText("Un message de groupe ou de diffusion a un objet.")).toBeTruthy();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("enseignant : diffusion à une de SES classes ; le corps porte les blocs de classe et pas d'audience", async () => {
    const api = setTestApi({
      ...READ,
      [`GET ${M}/me/audience`]: myAudience({ isStaff: true, classrooms: [{ id: IDS.class6A, name: "6ème A" }] }),
      [`GET ${M}/recipients`]: { items: [] },
      [`POST ${M}/conversations`]: () => json({ conversation: null, message: null, broadcastId: uuid(800), reused: false, recipientCount: 2 }, { status: 201 }),
    });
    renderWithProviders(<ComposeScreen />);
    fireEvent.click(await screen.findByRole("radio", { name: /Diffusion/ }));
    fireEvent.change(await screen.findByLabelText("Classe"), { target: { value: IDS.class6A } });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter la classe" }));
    expect(await screen.findByText(/6ème A · Parents et tuteurs/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Objet/), { target: { value: "Convocation" } });
    fireEvent.change(bodyBox(), { target: { value: "Merci de passer au secrétariat." } });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/v2/messages?folder=sent"));
    expect(api.calls.find((c) => c.method === "POST")!.body).toMatchObject({ kind: "BROADCAST", subject: "Convocation", recipients: { userIds: [], classrooms: [{ classroomId: IDS.class6A, include: ["GUARDIANS"] }], toAdministration: false } });
    expect((api.calls.find((c) => c.method === "POST")!.body as { recipients: Record<string, unknown> }).recipients.audience).toBeUndefined();
  });

  it("l'API refuse (403) : le message de l'API est affiché, le formulaire reste rempli", async () => {
    setTestApi({
      ...READ,
      [`GET ${M}/me/audience`]: myAudience({ isGuardian: true }),
      "GET /api/v1/people/children": { items: [] },
      [`GET ${M}/recipients`]: { items: [teacherRecipient] },
      [`POST ${M}/conversations`]: () => json({ code: "messaging.recipient_not_allowed", message: "Vous ne pouvez écrire qu'aux personnes liées à vos enfants, à vos classes ou à l'administration." }, { status: 403 }),
    });
    renderWithProviders(<ComposeScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /KONAN Enseignant/ }));
    fireEvent.change(bodyBox(), { target: { value: "Bonjour" } });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    expect(await screen.findByText(/personnes liées à vos enfants/)).toBeTruthy();
    expect(bodyBox().value).toBe("Bonjour");
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("sans droit d'envoi : message d'explication, aucun formulaire", async () => {
    setTestApi({ ...READ, [`GET ${M}/me/audience`]: myAudience({ canSend: false, isStudent: true }) });
    renderWithProviders(<ComposeScreen />);
    expect(await screen.findByText("Vous ne pouvez pas envoyer de message pour le moment.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Envoyer" })).toBeNull();
  });

  it("pièce jointe : fichier lu en base64, déposé, puis son identifiant joint au message", async () => {
    const att = { id: uuid(900), fileName: "convocation.pdf", mimeType: "application/pdf", sizeBytes: 30 };
    const api = setTestApi({
      ...READ,
      [`GET ${M}/me/audience`]: myAudience({ isGuardian: true }),
      "GET /api/v1/people/children": { items: [] },
      [`GET ${M}/recipients`]: { items: [teacherRecipient] },
      [`POST ${M}/attachments`]: () => json(att, { status: 201 }),
      [`POST ${M}/conversations`]: () => json({ conversation: conversation(), message: message({ mine: true }), broadcastId: null, reused: false, recipientCount: 1 }, { status: 201 }),
    });
    renderWithProviders(<ComposeScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /KONAN Enseignant/ }));
    fireEvent.change(bodyBox(), { target: { value: "Voir la pièce" } });
    const file = new File(["%PDF-1.7 contenu"], "convocation.pdf", { type: "application/pdf" });
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
    expect(await screen.findByRole("list", { name: "Pièces jointes à envoyer" })).toBeTruthy();
    const upload = api.calls.find((c) => c.path.endsWith("/attachments"))!;
    expect(upload.body).toMatchObject({ fileName: "convocation.pdf" });
    expect(Buffer.from((upload.body as { contentBase64: string }).contentBase64, "base64").toString()).toBe("%PDF-1.7 contenu");
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalled());
    expect((api.calls.find((c) => c.method === "POST" && c.path.endsWith("/conversations"))!.body as { attachmentIds: string[] }).attachmentIds).toEqual([att.id]);
  });

  it("pièce refusée par l'API : l'erreur nomme le fichier, rien n'est joint", async () => {
    setTestApi({
      ...READ,
      [`GET ${M}/me/audience`]: myAudience({ isGuardian: true }),
      "GET /api/v1/people/children": { items: [] },
      [`GET ${M}/recipients`]: { items: [] },
      [`POST ${M}/attachments`]: () => json({ code: "messaging.attachment_type_rejected", message: "Type de fichier non accepté (contrôlé sur le contenu réel du fichier)." }, { status: 400 }),
    });
    renderWithProviders(<ComposeScreen />);
    await screen.findByLabelText(/Rechercher une personne/);
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(["MZ"], "facture.pdf", { type: "application/pdf" })] } });
    expect(await screen.findByText(/facture\.pdf : Type de fichier non accepté/)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Pièces jointes à envoyer" })).toBeNull();
  });
});

describe("NotificationBell : cloche", () => {
  const routes = (unread = 3) => ({
    ...READ,
    [`GET ${M}/me/unread`]: { conversations: 1, announcements: 0, notifications: unread },
    [`GET ${M}/notifications`]: page([notification(), notification({ id: uuid(701), title: "Annonce : Réunion", category: "ANNOUNCEMENT", link: `/v2/announcements/${IDS.ann}`, occurrences: 4, readAt: NOW })], null, { unreadCount: unread }),
    [`POST ${M}/notifications/${uuid(700)}/read`]: { unreadCount: unread - 1 },
    [`POST ${M}/notifications/read-all`]: { markedRead: unread },
  });

  it("affiche le compteur (nom accessible), ouvre le menu, lit une notification au clic, tout marquer lu", async () => {
    const api = setTestApi(routes());
    renderWithProviders(<NotificationBell />);
    const bell = await screen.findByRole("button", { name: /3 notifications non lues/ });
    expect(bell.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(bell);
    expect(bell.getAttribute("aria-expanded")).toBe("true");
    const link = await screen.findByRole("link", { name: /Nouveau message de KONAN Enseignant/ });
    expect(link.getAttribute("href")).toBe(`/v2/messages/${IDS.conv}`);
    expect(screen.getByText("(4)")).toBeTruthy(); // compteur d'occurrences
    fireEvent.click(link);
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path.endsWith(`/${uuid(700)}/read`))).toBe(true));
    fireEvent.click(bell);
    fireEvent.click(await screen.findByRole("button", { name: "Tout marquer comme lu" }));
    await waitFor(() => expect(api.calls.some((c) => c.path.endsWith("/read-all"))).toBe(true));
  });

  it("Échap ferme le menu et rend le focus à la cloche ; sans droit de lecture, aucune cloche", async () => {
    setTestApi(routes());
    const { unmount } = renderWithProviders(<NotificationBell />);
    const bell = await screen.findByRole("button", { name: /notifications non lues/ });
    fireEvent.click(bell);
    await screen.findByRole("region", { name: "Notifications" });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Notifications" })).toBeNull());
    expect(document.activeElement).toBe(bell);
    unmount();
    setTestApi({ ...accessRoutes([]) });
    renderWithProviders(<NotificationBell />);
    await waitFor(() => expect(screen.queryByRole("button", { name: /notifications/ })).toBeNull());
  });

  it("aucune notification : état vide", async () => {
    setTestApi({ ...routes(0), [`GET ${M}/notifications`]: page([], null, { unreadCount: 0 }) });
    renderWithProviders(<NotificationBell />);
    fireEvent.click(await screen.findByRole("button", { name: /Aucune notification non lue/ }));
    expect(await screen.findByText("Aucune notification.")).toBeTruthy();
  });
});

describe("NotificationsScreen : liste et préférences", () => {
  it("filtre les non lues (paramètre unread), marque lue, enregistre les préférences avec le corps exact", async () => {
    const api = setTestApi({
      ...READ,
      [`GET ${M}/notifications`]: ({ url }) => json(page(url.searchParams.get("unread") ? [notification()] : [notification(), notification({ id: uuid(702), title: "Ancienne", readAt: NOW })], null, { unreadCount: 1 })),
      [`POST ${M}/notifications/${uuid(700)}/read`]: { unreadCount: 0 },
      [`GET ${M}/me/preferences`]: { items: [{ category: "MESSAGE", inApp: true, externalChannels: ["EMAIL", "SMS"], mutedUntil: null }, { category: "ANNOUNCEMENT", inApp: true, externalChannels: [], mutedUntil: null }, { category: "SYSTEM", inApp: true, externalChannels: [], mutedUntil: null }] },
      [`PUT ${M}/me/preferences`]: () => json({ items: [] }),
    });
    renderWithProviders(<NotificationsScreen />);
    await screen.findByText("Ancienne");
    fireEvent.click(screen.getByLabelText("Non lues seulement"));
    await waitFor(() => expect(screen.queryByText("Ancienne")).toBeNull());
    expect(api.calls.some((c) => c.path.endsWith("/notifications") && c.query.unread === "true")).toBe(true);
    fireEvent.click(await screen.findByRole("button", { name: "Marquer comme lue" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path.endsWith("/read"))).toBe(true));
    const form = await screen.findByRole("form", { name: "Préférences de notification" });
    const messageBox = within(within(form).getByRole("group", { name: "Messages" }));
    fireEvent.click(messageBox.getByLabelText("Notifications dans l'application"));
    fireEvent.click(messageBox.getByLabelText("SMS"));
    fireEvent.click(within(form).getByRole("button", { name: "Enregistrer mes préférences" }));
    expect(await screen.findByText("Vos préférences sont enregistrées.")).toBeTruthy();
    const put = api.calls.find((c) => c.method === "PUT")!;
    expect((put.body as { preferences: Array<Record<string, unknown>> }).preferences[0]).toEqual({ category: "MESSAGE", inApp: false, externalChannels: ["EMAIL"], mutedUntil: null });
  });

  it("aucune notification : états vides ; erreur : réessayer", async () => {
    setTestApi({ ...READ, [`GET ${M}/notifications`]: page([], null, { unreadCount: 0 }), [`GET ${M}/me/preferences`]: () => json({ code: "INTERNAL", message: "x" }, { status: 500 }) });
    renderWithProviders(<NotificationsScreen />);
    expect(await screen.findByText("Aucune notification.")).toBeTruthy();
    expect((await screen.findAllByRole("alert")).length).toBeGreaterThan(0);
  });
});
