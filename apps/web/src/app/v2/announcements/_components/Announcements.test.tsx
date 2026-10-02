// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { announcement, IDS, myAudience, NOW, page, uuid } from "../../messages/_test/fixtures";
import { AnnouncementDetailScreen } from "./AnnouncementDetailScreen";
import { AnnouncementEditor } from "./AnnouncementEditor";
import { AnnouncementsScreen } from "./AnnouncementsScreen";

vi.setConfig({ testTimeout: 30_000 });

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/announcements", useRouter: () => ({ push: nav.push, replace: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const M = "/api/v1/messaging";
const PARENT = accessRoutes(["messaging.child.read"]);

beforeEach(() => nav.push.mockClear());
afterEach(() => vi.restoreAllMocks());

describe("AnnouncementsScreen : liste des annonces", () => {
  it("boîte du destinataire : non lue, accusé à donner, épinglée, expirée ; lien vers le détail ; pas d'onglet de gestion", async () => {
    setTestApi({
      ...PARENT,
      [`GET ${M}/me/audience`]: myAudience({ isGuardian: true }),
      [`GET ${M}/announcements`]: page([
        announcement({ pinned: true, requireAck: true, priority: "URGENT" }),
        announcement({ id: uuid(301), title: "Lue", myReadAt: NOW }),
        announcement({ id: uuid(302), title: "Ancienne", expired: true, expiresAt: NOW, myReadAt: NOW }),
      ]),
    });
    renderWithProviders(<AnnouncementsScreen />);
    const list = await screen.findByRole("list", { name: "Liste des annonces" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText("Réunion des parents")).toBeTruthy();
    expect(within(rows[0]!).getByLabelText("Épinglée")).toBeTruthy();
    expect(within(rows[0]!).getByText("Urgente")).toBeTruthy();
    expect(within(rows[0]!).getByText("Accusé à donner")).toBeTruthy();
    expect(within(rows[2]!).getByText("Expirée")).toBeTruthy();
    expect(within(rows[0]!).getByRole("link").getAttribute("href")).toBe(`/v2/announcements/${IDS.ann}`);
    expect(screen.queryByRole("tab", { name: "Publiées par moi" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Nouvelle annonce" })).toBeNull();
  });

  it("filtres : non lues et expirées sont envoyés à l'API ; état vide et erreur", async () => {
    let fail = false;
    const api = setTestApi({
      ...PARENT,
      [`GET ${M}/me/audience`]: myAudience(),
      [`GET ${M}/announcements`]: () => (fail ? json({ code: "INTERNAL", message: "x" }, { status: 500 }) : json(page([]))),
    });
    renderWithProviders(<AnnouncementsScreen />);
    expect(await screen.findByText("Aucune annonce pour vous pour le moment.")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Non lues seulement"));
    fireEvent.click(screen.getByLabelText("Afficher les annonces expirées"));
    await waitFor(() => expect(api.calls.some((c) => c.path.endsWith("/announcements") && c.query.unread === "true" && c.query.includeExpired === "true")).toBe(true));
    fail = true;
    fireEvent.click(screen.getByLabelText("Non lues seulement"));
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("publieur : onglet « Publiées par moi » (scope=managed) avec statuts et statistiques, lien de création", async () => {
    const api = setTestApi({
      ...accessRoutes(["messaging.read", "messaging.announcement.publish"]),
      [`GET ${M}/me/audience`]: myAudience({ canPublishAnnouncements: true, isStaff: true }),
      [`GET ${M}/announcements`]: ({ url }) =>
        json(page(url.searchParams.get("scope") === "managed" ? [announcement({ status: "SCHEDULED", publishedAt: null, publishAt: NOW, stats: { recipients: 12, read: 4, acknowledged: 2, truncated: false }, isRecipient: false })] : [])),
    });
    renderWithProviders(<AnnouncementsScreen />);
    expect((await screen.findByRole("link", { name: "Nouvelle annonce" })).getAttribute("href")).toBe("/v2/announcements/new");
    fireEvent.click(await screen.findByRole("tab", { name: "Publiées par moi" }));
    expect(await screen.findByText(/12 destinataire\(s\), 4 lu\(s\), 2 accusé\(s\)/)).toBeTruthy();
    expect(screen.getAllByText("Programmée").length).toBeGreaterThan(1); // pastille + option du filtre de statut
    fireEvent.change(screen.getByLabelText("Statut"), { target: { value: "PUBLISHED" } });
    await waitFor(() => expect(api.calls.some((c) => c.query.scope === "managed" && c.query.status === "PUBLISHED")).toBe(true));
  });
});

describe("AnnouncementDetailScreen : lecture, accusé, gestion", () => {
  const A = `${M}/announcements/${IDS.ann}`;

  it("destinataire : lue à l'ouverture (un seul POST), accusé de réception demandé puis donné", async () => {
    let acked = false;
    const api = setTestApi({
      ...PARENT,
      [`GET ${A}`]: () => json(announcement({ requireAck: true, myAcknowledgedAt: acked ? NOW : null, myReadAt: acked ? NOW : null })),
      [`POST ${A}/read`]: { readAt: NOW },
      [`POST ${A}/acknowledge`]: () => {
        acked = true;
        return json({ acknowledgedAt: NOW });
      },
    });
    renderWithProviders(<AnnouncementDetailScreen announcementId={IDS.ann} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Réunion des parents" })).toBeTruthy();
    await waitFor(() => expect(api.calls.filter((c) => c.method === "POST" && c.path.endsWith("/read"))).toHaveLength(1));
    expect(screen.queryByText("Gestion de l'annonce")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "J'ai pris connaissance" }));
    expect(await screen.findByText(/Merci : votre accusé de réception est enregistré\./)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: "J'ai pris connaissance" })).toBeNull());
    expect(screen.getByText(/Vous avez pris connaissance de cette annonce/)).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "POST" && c.path.endsWith("/read"))).toHaveLength(1);
  });

  it("un gestionnaire non destinataire n'envoie aucune lecture ; il voit statistiques, ciblage et accusés filtrables", async () => {
    const api = setTestApi({
      ...accessRoutes(["messaging.announcement.manage"]),
      [`GET ${A}`]: announcement({ isRecipient: false, stats: { recipients: 30, read: 12, acknowledged: 5, truncated: false }, requireAck: true }),
      [`GET ${A}/receipts`]: ({ url }) =>
        json(page(url.searchParams.get("state") === "pending_ack" ? [{ userId: uuid(11), displayName: "KONE Mère", deliveredAt: NOW, readAt: NOW, acknowledgedAt: null }] : [{ userId: uuid(10), displayName: "KONE Père", deliveredAt: NOW, readAt: NOW, acknowledgedAt: NOW }, { userId: uuid(11), displayName: "KONE Mère", deliveredAt: NOW, readAt: NOW, acknowledgedAt: null }])),
    });
    renderWithProviders(<AnnouncementDetailScreen announcementId={IDS.ann} />);
    const manage = await screen.findByRole("region", { name: "Gestion de l'annonce" }).catch(() => null);
    void manage;
    expect(await screen.findByText("Destinataires")).toBeTruthy();
    expect(screen.getByText("30")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText(/Classe/)).toBeTruthy();
    const table = await screen.findByRole("table", { name: "Accusés de lecture" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    fireEvent.change(screen.getByLabelText("Afficher"), { target: { value: "pending_ack" } });
    await waitFor(() => expect(within(screen.getByRole("table", { name: "Accusés de lecture" })).getAllByRole("row")).toHaveLength(2));
    expect(api.calls.some((c) => c.path.endsWith("/receipts") && c.query.state === "pending_ack")).toBe(true);
    expect(api.calls.some((c) => c.method === "POST" && c.path.endsWith("/read"))).toBe(false);
  });

  it("retrait : motif obligatoire (3 caractères au moins), corps exact, confirmation", async () => {
    const api = setTestApi({
      ...accessRoutes(["messaging.announcement.manage"]),
      [`GET ${A}`]: announcement({ isRecipient: false, stats: { recipients: 3, read: 0, acknowledged: 0, truncated: false } }),
      [`GET ${A}/receipts`]: page([]),
      [`POST ${A}/withdraw`]: ({ body }: { body: unknown }) => json(announcement({ status: "WITHDRAWN", withdrawnAt: NOW, isRecipient: false, stats: { recipients: 3, read: 0, acknowledged: 0, truncated: false }, ...(body as object) })),
    });
    renderWithProviders(<AnnouncementDetailScreen announcementId={IDS.ann} />);
    fireEvent.click(await screen.findByRole("button", { name: "Retirer l'annonce" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif du retrait/), { target: { value: "ab" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Retirer l'annonce" }));
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.change(within(dialog).getByLabelText(/Motif du retrait/), { target: { value: "Date erronée" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Retirer l'annonce" }));
    expect(await screen.findByText("L'annonce est retirée.")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ reason: "Date erronée" });
  });

  it("brouillon : publier maintenant, modifier, supprimer ; une annonce publiée ne se modifie plus", async () => {
    const api = setTestApi({
      ...accessRoutes(["messaging.announcement.publish"]),
      [`GET ${A}`]: announcement({ status: "DRAFT", publishedAt: null, isRecipient: false, stats: { recipients: 0, read: 0, acknowledged: 0, truncated: false } }),
      [`POST ${A}/publish`]: () => json(announcement({ isRecipient: false, stats: { recipients: 3, read: 0, acknowledged: 0, truncated: false } })),
      [`DELETE ${A}`]: () => new Response(null, { status: 204 }),
    });
    renderWithProviders(<AnnouncementDetailScreen announcementId={IDS.ann} />);
    expect((await screen.findByRole("link", { name: "Modifier" })).getAttribute("href")).toBe(`/v2/announcements/${IDS.ann}/edit`);
    fireEvent.click(screen.getByRole("button", { name: "Publier maintenant" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path.endsWith("/publish"))).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Supprimer le brouillon" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/v2/announcements"));
  });

  it("annonce publiée : pas de lien « Modifier » ; introuvable (404) : erreur", async () => {
    setTestApi({ ...accessRoutes(["messaging.announcement.manage"]), [`GET ${A}`]: announcement({ isRecipient: false, stats: { recipients: 1, read: 0, acknowledged: 0, truncated: false } }), [`GET ${A}/receipts`]: page([]) });
    const { unmount } = renderWithProviders(<AnnouncementDetailScreen announcementId={IDS.ann} />);
    await screen.findByText("Gestion de l'annonce");
    expect(screen.queryByRole("link", { name: "Modifier" })).toBeNull();
    unmount();
    setTestApi({ ...PARENT, [`GET ${A}`]: () => json({ code: "messaging.announcement_not_found", message: "Annonce introuvable." }, { status: 404 }) });
    renderWithProviders(<AnnouncementDetailScreen announcementId={IDS.ann} />);
    expect(await screen.findByText("Annonce introuvable.")).toBeTruthy();
  });

  it("pièce jointe : lien signé demandé au clic ; priorité et date affichées", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const att = { id: uuid(901), fileName: "calendrier.pdf", mimeType: "application/pdf", sizeBytes: 4096 };
    setTestApi({ ...PARENT, [`GET ${A}`]: announcement({ attachments: [att], priority: "HIGH", myReadAt: NOW }), [`GET ${M}/attachments/${att.id}/url`]: { url: "https://storage.test/a?s=1", expiresAt: NOW } });
    renderWithProviders(<AnnouncementDetailScreen announcementId={IDS.ann} />);
    expect(await screen.findByText("Élevée")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /calendrier\.pdf/ }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://storage.test/a?s=1", "_blank", "noopener,noreferrer"));
  });
});

describe("AnnouncementEditor : création", () => {
  const teacher = (extra: Record<string, unknown> = {}) => ({
    ...accessRoutes(["messaging.read", "messaging.announcement.publish_class"]),
    [`GET ${M}/me/audience`]: myAudience({ canPublishAnnouncements: true, isStaff: true, classrooms: [{ id: IDS.class6A, name: "6ème A" }] }),
    "GET /api/v1/tenancy/institutions": { items: [] },
    ...extra,
  });

  it("validation avec les messages français du contrat : titre, contenu, au moins une cible ; rien n'est envoyé", async () => {
    const api = setTestApi(teacher());
    renderWithProviders(<AnnouncementEditor />);
    fireEvent.click(await screen.findByRole("button", { name: "Publier" }));
    expect(await screen.findAllByText("Ce champ est obligatoire.")).toHaveLength(2);
    expect(screen.getByText("Choisissez au moins une cible.")).toBeTruthy();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("l'enseignant ne voit que « Classe » et SES classes ; le corps de publication est exact", async () => {
    const api = setTestApi(teacher({ [`POST ${M}/announcements`]: () => json(announcement({ id: uuid(310), isRecipient: false, stats: { recipients: 2, read: 0, acknowledged: 0, truncated: false } }), { status: 201 }) }));
    renderWithProviders(<AnnouncementEditor />);
    const kind = (await screen.findByLabelText("Type de cible")) as HTMLSelectElement;
    expect(Array.from(kind.options).map((o) => o.textContent)).toEqual(["Classe"]);
    await screen.findByRole("option", { name: "6ème A" });
    fireEvent.change(screen.getByLabelText("Classe", { selector: "select" }), { target: { value: IDS.class6A } });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter la cible" }));
    expect(within(await screen.findByRole("list", { name: "Cibles choisies" })).getByText("6ème A")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Titre/), { target: { value: "Devoir de maths" } });
    fireEvent.change(screen.getByLabelText(/Contenu/), { target: { value: "À rendre jeudi." } });
    fireEvent.click(screen.getByLabelText("Demander un accusé de réception"));
    fireEvent.click(screen.getByRole("button", { name: "Publier" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`/v2/announcements/${uuid(310)}`));
    expect(api.calls.find((c) => c.method === "POST")!.body).toMatchObject({
      title: "Devoir de maths",
      body: "À rendre jeudi.",
      priority: "NORMAL",
      requireAck: true,
      pinned: false,
      publish: true,
      attachmentIds: [],
      audience: { targets: [{ kind: "CLASSROOM", ref: IDS.class6A }], audiences: ["STUDENTS", "GUARDIANS"] },
    });
  });

  it("brouillon : publish=false ; date future : le bouton devient « Programmer la publication » ; aperçu de l'audience", async () => {
    const api = setTestApi(
      teacher({
        [`POST ${M}/announcements`]: () => json(announcement({ id: uuid(311), status: "DRAFT", publishedAt: null, isRecipient: false, stats: { recipients: 0, read: 0, acknowledged: 0, truncated: false } }), { status: 201 }),
        [`POST ${M}/announcements/audience-preview`]: { count: 42, truncated: false },
      }),
    );
    renderWithProviders(<AnnouncementEditor />);
    await screen.findByRole("option", { name: "6ème A" });
    fireEvent.change(screen.getByLabelText("Classe", { selector: "select" }), { target: { value: IDS.class6A } });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter la cible" }));
    fireEvent.click(await screen.findByRole("button", { name: "Compter les destinataires" }));
    expect(await screen.findByText("42 destinataire(s)")).toBeTruthy();
    expect(api.calls.find((c) => c.path.endsWith("/audience-preview"))!.body).toEqual({ targets: [{ kind: "CLASSROOM", ref: IDS.class6A }], audiences: ["STUDENTS", "GUARDIANS"] });
    const future = new Date(Date.now() + 7 * 86_400_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    fireEvent.change(screen.getByLabelText(/Publier le/), { target: { value: `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T08:00` } });
    expect(screen.getByRole("button", { name: "Programmer la publication" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Titre/), { target: { value: "Rentrée" } });
    fireEvent.change(screen.getByLabelText(/Contenu/), { target: { value: "Texte" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le brouillon" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`/v2/announcements/${uuid(311)}`));
    const post = api.calls.find((c) => c.method === "POST" && c.path.endsWith("/announcements"))!.body as { publish: boolean; publishAt: string };
    expect(post.publish).toBe(false);
    expect(post.publishAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("l'API refuse la cible (403) : message affiché, formulaire conservé", async () => {
    setTestApi(teacher({ [`POST ${M}/announcements`]: () => json({ code: "messaging.target_not_allowed", message: "Vous ne pouvez publier que vers vos classes." }, { status: 403 }) }));
    renderWithProviders(<AnnouncementEditor />);
    await screen.findByRole("option", { name: "6ème A" });
    fireEvent.change(screen.getByLabelText("Classe", { selector: "select" }), { target: { value: IDS.class6A } });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter la cible" }));
    fireEvent.change(screen.getByLabelText(/Titre/), { target: { value: "T" } });
    fireEvent.change(screen.getByLabelText(/Contenu/), { target: { value: "C" } });
    fireEvent.click(screen.getByRole("button", { name: "Publier" }));
    expect(await screen.findByText("Vous ne pouvez publier que vers vos classes.")).toBeTruthy();
    expect((screen.getByLabelText(/Titre/) as HTMLInputElement).value).toBe("T");
  });

  it("administration : toutes les cibles proposées (établissement, établissement scolaire, campus, niveau, classe, rôle)", async () => {
    setTestApi({
      ...accessRoutes(["messaging.read", "messaging.announcement.publish"]),
      [`GET ${M}/me/audience`]: myAudience({ canPublishAnnouncements: true, canSendAny: true }),
      "GET /api/v1/tenancy/institutions": { items: [] },
    });
    renderWithProviders(<AnnouncementEditor />);
    const kind = (await screen.findByLabelText("Type de cible")) as HTMLSelectElement;
    await waitFor(() => expect(Array.from(kind.options).map((o) => o.textContent)).toEqual(["Tout l'établissement", "Établissement scolaire", "Campus", "Niveau", "Classe", "Rôle"]));
    fireEvent.change(kind, { target: { value: "TENANT" } });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter la cible" }));
    expect(await screen.findByRole("list", { name: "Cibles choisies" })).toBeTruthy();
  });
});
