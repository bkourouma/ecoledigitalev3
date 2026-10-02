// @vitest-environment jsdom
import { Blob as NodeBlob } from "node:buffer";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  documentCategoryDtoSchema,
  documentDetailDtoSchema,
  documentMyContextDtoSchema,
  documentQuarantineDtoSchema,
  documentSettingsDtoSchema,
  documentSummaryDtoSchema,
  documentUsageDtoSchema,
} from "@ecoledigitale/contracts/v2/documents";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { category, context, detail, IDS, page, quarantineItem, settings, share, summary, usage, version, SHA } from "../_test/fixtures";
import { CategoriesScreen } from "./CategoriesScreen";
import { DocumentDetailScreen } from "./DocumentDetailScreen";
import { DocumentsNav } from "./DocumentsShell";
import { ExpirationsScreen } from "./ExpirationsScreen";
import { ExplorerScreen } from "./ExplorerScreen";
import { QuarantineScreen } from "./QuarantineScreen";
import { SettingsScreen } from "./SettingsScreen";

vi.setConfig({ testTimeout: 30_000 });

const nav = vi.hoisted(() => ({ push: vi.fn(), search: "" }));
vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/documents", useRouter: () => ({ push: nav.push, replace: vi.fn() }), useSearchParams: () => new URLSearchParams(nav.search) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const D = "/api/v1/documents";
const pdfFile = (name = "cni.pdf", size = 600) => new File([new Uint8Array(size)], name, { type: "application/pdf" });

beforeEach(() => {
  nav.push.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("fabriques de test conformes aux contrats courants", () => {
  it("les données simulées passent les schémas de réponse (aucune dérive silencieuse)", () => {
    expect(documentCategoryDtoSchema.safeParse(category()).success).toBe(true);
    expect(documentSummaryDtoSchema.safeParse(summary()).success).toBe(true);
    expect(documentDetailDtoSchema.safeParse(detail({ shares: [share()], versions: [version(), version({ versionNo: 2, current: false })] })).success).toBe(true);
    expect(documentMyContextDtoSchema.safeParse(context()).success).toBe(true);
    expect(documentSettingsDtoSchema.safeParse(settings()).success).toBe(true);
    expect(documentUsageDtoSchema.safeParse(usage()).success).toBe(true);
    expect(documentQuarantineDtoSchema.safeParse(quarantineItem()).success).toBe(true);
  });
});

describe("DocumentsNav : onglets selon les permissions", () => {
  it("le personnel voit l'explorateur et les échéances ; la gestion voit en plus catégories, quarantaine et paramètres", async () => {
    setTestApi(accessRoutes(["documents.read"]));
    const { unmount } = renderWithProviders(<DocumentsNav />);
    expect(await screen.findByRole("link", { name: "Documents" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Échéances" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Catégories" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Quarantaine" })).toBeNull();
    unmount();
    setTestApi(accessRoutes(["documents.manage", "documents.category.manage", "documents.quarantine.manage", "documents.settings.manage"]));
    renderWithProviders(<DocumentsNav />);
    expect(await screen.findByRole("link", { name: "Catégories" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Quarantaine" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Paramètres" })).toBeTruthy();
  });
});

describe("ExplorerScreen : explorateur", () => {
  const rows = [
    summary({ expiresOn: "2026-10-07", expiryState: "EXPIRING", daysToExpiry: 5, versionCount: 3 }),
    summary({ id: IDS.doc2, title: "Dossier médical", confidentiality: "CONFIDENTIAL", visibility: "PRIVATE", categoryLabel: "Dossier médical", expiryState: "EXPIRED", expiresOn: "2026-09-01", daysToExpiry: -31 }),
  ];
  const base = (extra: Record<string, unknown> = {}) => ({
    ...accessRoutes(["documents.read"]),
    [`GET ${D}/me/context`]: context(),
    [`GET ${D}/categories`]: { items: [category(), category({ id: IDS.catMedical, code: "STUDENT_MEDICAL", label: "Dossier médical", canUpload: false })] },
    ...extra,
  });

  it("liste les documents avec niveau, visibilité, échéance (texte), versions ; lien vers le détail", async () => {
    setTestApi(base({ [`GET ${D}/documents`]: page(rows) }));
    renderWithProviders(<ExplorerScreen />);
    const list = await screen.findByRole("list", { name: "Documents" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText("CNI de Awa")).toBeTruthy();
    expect(within(items[0]!).getByText("Restreint")).toBeTruthy();
    expect(within(items[0]!).getByText("Expire dans 5 jours")).toBeTruthy();
    expect(within(items[0]!).getByText(/3 versions/)).toBeTruthy();
    expect(within(items[0]!).getByRole("link").getAttribute("href")).toBe(`/v2/documents/${IDS.doc}`);
    expect(within(items[1]!).getByText("Confidentiel")).toBeTruthy();
    expect(within(items[1]!).getByText("Privé")).toBeTruthy();
    expect(within(items[1]!).getByText(/Échu le/)).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Déposer un document" })).toBeTruthy();
  });

  it("filtres : recherche temporisée, catégorie, type, portée, échéance sont transmis à l'API (l'API reste l'autorité)", async () => {
    const api = setTestApi(base({ [`GET ${D}/documents`]: page(rows) }));
    renderWithProviders(<ExplorerScreen />);
    await screen.findByRole("list", { name: "Documents" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Rechercher" }), { target: { value: "naissance" } });
    fireEvent.change(screen.getByLabelText("Catégorie"), { target: { value: IDS.catIdentity } });
    fireEvent.change(screen.getByLabelText("Type de document"), { target: { value: "FINANCIAL" } });
    fireEvent.change(screen.getByLabelText("Échéance"), { target: { value: "expired" } });
    await waitFor(() => {
      const last = api.calls.filter((c) => c.path === `${D}/documents`).at(-1)!;
      expect(last.query).toMatchObject({ q: "naissance", categoryId: IDS.catIdentity, kind: "FINANCIAL", expiry: "expired", limit: "30" });
    });
    // les portées « enfants », « moi », « mon dossier » n'existent que si le compte porte ces liens
    expect(within(screen.getByLabelText("Portée")).queryByRole("option", { name: "Mes enfants" })).toBeNull();
    expect(within(screen.getByLabelText("Portée")).getByRole("option", { name: "Mes dépôts" })).toBeTruthy();
    // la gestion seule filtre sur les archivés
    expect(screen.queryByLabelText("État")).toBeNull();
  });

  it("un parent : portée « Mes enfants », pas de filtre de propriétaire ; dépôt proposé seulement si une catégorie l'autorise", async () => {
    setTestApi({
      ...accessRoutes(["documents.child.read", "documents.child.upload"]),
      [`GET ${D}/me/context`]: context({ links: { studentId: null, studentName: null, childStudentIds: [IDS.child], children: [{ id: IDS.child, displayName: "KONÉ Awa" }], staffId: null, staffName: null } }, { upload: false, read: false, readRestricted: false, childRead: true, childUpload: true }),
      [`GET ${D}/categories`]: { items: [category({ canUpload: false })] },
      [`GET ${D}/documents`]: page([summary({ access: { write: false, share: false, archive: false, history: false, via: ["GUARDIAN"] } })]),
    });
    renderWithProviders(<ExplorerScreen />);
    await screen.findByRole("list", { name: "Documents" });
    expect(within(screen.getByLabelText("Portée")).getByRole("option", { name: "Mes enfants" })).toBeTruthy();
    expect(screen.queryByLabelText("Concerne")).toBeNull();
    expect(screen.queryByRole("button", { name: "Déposer un document" })).toBeNull();
  });

  it("états : vide avec invitation à déposer, erreur avec « Réessayer », pagination", async () => {
    let fail = true;
    let pageNo = 0;
    setTestApi(
      base({
        [`GET ${D}/documents`]: ({ url }) => {
          if (fail) return json({ code: "INTERNAL", message: "boom" }, { status: 500 });
          if (url.searchParams.get("q") === "rien") return json(page([]));
          pageNo += 1;
          return json(url.searchParams.get("cursor") ? page([summary({ id: IDS.doc3, title: "Page deux" })]) : page(rows, "curseur-2"));
        },
      }),
    );
    renderWithProviders(<ExplorerScreen />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    await screen.findByRole("list", { name: "Documents" });
    fireEvent.click(screen.getByRole("button", { name: "Afficher plus de documents" }));
    expect(await screen.findByText("Page deux")).toBeTruthy();
    expect(pageNo).toBe(2);
    fireEvent.change(screen.getByRole("searchbox", { name: "Rechercher" }), { target: { value: "rien" } });
    expect(await screen.findByText("Aucun document ne correspond.")).toBeTruthy();
    expect(screen.getByText(/Déposez un premier document/)).toBeTruthy();
  });
});

describe("UploadDialog : dépôt (glisser-déposer et sélecteur de fichier accessible)", () => {
  const staffRoutes = (extra: Record<string, unknown> = {}) => ({
    ...accessRoutes(["documents.read", "documents.upload"]),
    [`GET ${D}/me/context`]: context(),
    [`GET ${D}/categories`]: { items: [category(), category({ id: IDS.catRegulation, code: "INSTITUTION_REGULATION", label: "Règlement intérieur", kind: "INSTITUTION", audienceOwner: false, audienceGuardians: false, ownerUpload: false, confidentiality: "INTERNAL" }), category({ id: IDS.catMedical, label: "Dossier médical", canUpload: false })] },
    [`GET ${D}/documents`]: page([]),
    ...extra,
  });
  const open = async () => {
    renderWithProviders(<ExplorerScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Déposer un document" }));
    return screen.findByRole("dialog");
  };

  it("n'offre que les catégories où le dépôt est possible ; erreurs de formulaire annoncées avant tout envoi", async () => {
    const api = setTestApi(staffRoutes());
    const dialog = await open();
    const select = (await within(dialog).findByLabelText(/Catégorie/)) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["Choisir une catégorie", "Pièces d'identité de l'élève", "Règlement intérieur"]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Déposer" }));
    expect((await within(dialog).findAllByRole("alert")).map((a) => a.textContent)).toEqual(expect.arrayContaining(["Choisissez une catégorie.", "Choisissez un fichier."]));
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("personnel : catégorie élève -> élève à rechercher ; envoi multipart puis ouverture du document déposé", async () => {
    const created = detail({ id: IDS.doc3 });
    const api = setTestApi(
      staffRoutes({
        [`GET ${D}/people`]: ({ url }) => json({ items: url.searchParams.get("kind") === "STUDENT" ? [{ id: IDS.child, displayName: "KONÉ Awa", kind: "STUDENT", detail: "E-2026-001" }] : [] }),
        [`POST ${D}/documents`]: created,
      }),
    );
    const dialog = await open();
    fireEvent.change(await within(dialog).findByLabelText(/Catégorie/), { target: { value: IDS.catIdentity } });
    // glisser-déposer ou sélecteur : ici le sélecteur (champ fichier relié à la zone)
    const input = within(dialog).getByTestId("dropzone-input");
    expect(within(dialog).getByText(/Formats : pdf, jpg, jpeg, png\./)).toBeTruthy();
    fireEvent.change(input, { target: { files: [pdfFile("acte-naissance.pdf")] } });
    expect(within(dialog).getByText(/Fichier retenu : acte-naissance\.pdf/)).toBeTruthy();
    // élève : recherche par nom
    const owner = within(dialog).getByRole("combobox", { name: /Élève concerné/ });
    fireEvent.focus(owner);
    fireEvent.change(owner, { target: { value: "Koné" } });
    fireEvent.click(await within(dialog).findByRole("option", { name: /KONÉ Awa/ }));
    fireEvent.change(within(dialog).getByLabelText("Étiquettes"), { target: { value: "identité, 2026" } });
    fireEvent.change(within(dialog).getByLabelText("Visibilité"), { target: { value: "STAFF_ONLY" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Déposer" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`/v2/documents/${IDS.doc3}`));
    const post = api.calls.find((c) => c.method === "POST" && c.path === `${D}/documents`)!;
    expect(post.body).toMatchObject({
      categoryId: IDS.catIdentity,
      title: "acte-naissance", // titre par défaut : nom du fichier sans extension
      ownerType: "STUDENT",
      ownerId: IDS.child,
      visibility: "STAFF_ONLY",
      tags: JSON.stringify(["identité", "2026"]),
      file: { fileName: "acte-naissance.pdf", size: 600 },
    });
  });

  it("catégorie d'établissement : aucun propriétaire demandé ; catégorie à échéance obligatoire : date exigée", async () => {
    const api = setTestApi(staffRoutes({ [`POST ${D}/documents`]: detail() }));
    const dialog = await open();
    fireEvent.change(await within(dialog).findByLabelText(/Catégorie/), { target: { value: IDS.catRegulation } });
    expect(within(dialog).queryByRole("combobox", { name: /Élève concerné/ })).toBeNull();
    fireEvent.change(within(dialog).getByTestId("dropzone-input"), { target: { files: [pdfFile("reglement.pdf")] } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Déposer" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    expect(api.calls.find((c) => c.method === "POST")!.body).toMatchObject({ ownerType: "NONE" });
  });

  it("échéance obligatoire : refus local tant que la date manque", async () => {
    const api = setTestApi(
      staffRoutes({
        [`GET ${D}/categories`]: { items: [category({ id: IDS.catRegulation, kind: "INSTITUTION", code: "INSTITUTION_INSURANCE", label: "Assurances", requiresExpiry: true, audienceOwner: false, audienceGuardians: false, ownerUpload: false })] },
        [`POST ${D}/documents`]: detail(),
      }),
    );
    const dialog = await open();
    fireEvent.change(await within(dialog).findByLabelText(/Catégorie/), { target: { value: IDS.catRegulation } });
    fireEvent.change(within(dialog).getByTestId("dropzone-input"), { target: { files: [pdfFile("assurance.pdf")] } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Déposer" }));
    expect(await within(dialog).findByText("La date d'expiration est obligatoire pour cette catégorie.")).toBeTruthy();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.change(within(dialog).getByLabelText(/Date d'expiration/), { target: { value: "2027-06-30" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Déposer" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.body).toMatchObject({ expiresOn: "2027-06-30" }));
  });

  it("parent : l'enfant lié est imposé (liste de ses enfants), aucune recherche, aucune visibilité", async () => {
    const api = setTestApi({
      ...accessRoutes(["documents.child.read", "documents.child.upload"]),
      [`GET ${D}/me/context`]: context({ links: { studentId: null, studentName: null, childStudentIds: [IDS.child], children: [{ id: IDS.child, displayName: "KONÉ Awa" }], staffId: null, staffName: null } }, { upload: false, read: false, readRestricted: false, childRead: true, childUpload: true }),
      [`GET ${D}/categories`]: { items: [category()] },
      [`GET ${D}/documents`]: page([]),
      [`POST ${D}/documents`]: detail({ id: IDS.doc3 }),
    });
    const dialog = await open();
    fireEvent.change(await within(dialog).findByLabelText(/Catégorie/), { target: { value: IDS.catIdentity } });
    const child = within(dialog).getByLabelText(/Enfant concerné/) as HTMLSelectElement;
    expect([...child.options].map((o) => o.textContent)).toEqual(["KONÉ Awa"]);
    expect(within(dialog).queryByLabelText("Visibilité")).toBeNull();
    fireEvent.change(within(dialog).getByTestId("dropzone-input"), { target: { files: [pdfFile("certificat.pdf")] } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Déposer" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.body).toMatchObject({ ownerType: "STUDENT", ownerId: IDS.child }));
  });

  it("l'API refuse (415 : type réel différent) : le message est affiché, la fenêtre reste ouverte", async () => {
    setTestApi(
      staffRoutes({
        [`GET ${D}/people`]: { items: [] },
        [`POST ${D}/documents`]: () => json({ code: "documents.type_mismatch", kind: "validation", message: "Le contenu du fichier ne correspond pas à l'extension « .pdf » (contenu réel : image JPEG)." }, { status: 415 }),
      }),
    );
    const dialog = await open();
    fireEvent.change(await within(dialog).findByLabelText(/Catégorie/), { target: { value: IDS.catRegulation } });
    fireEvent.change(within(dialog).getByTestId("dropzone-input"), { target: { files: [pdfFile("scan.pdf")] } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Déposer" }));
    expect(await within(dialog).findByText(/contenu réel : image JPEG/)).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(nav.push).not.toHaveBeenCalled();
  });
});

describe("DocumentDetailScreen : détail, versions, aperçu, partages, historique", () => {
  const two = [version({ versionNo: 2, current: true, fileName: "cni-v2.pdf", note: "scan plus net" }), version({ versionNo: 1, current: false, fileName: "cni-v1.pdf" })];
  const routes = (doc = detail({ versions: two, versionCount: 2, currentVersionNo: 2, fileName: "cni-v2.pdf", shares: [] }), extra: Record<string, unknown> = {}) => ({
    ...accessRoutes(["documents.read"]),
    [`GET ${D}/me/context`]: context({}, { manage: false }),
    [`GET ${D}/categories`]: { items: [category()] },
    [`GET ${D}/documents/${IDS.doc}`]: doc,
    [`GET ${D}/documents/${IDS.doc}/history`]: page([{ id: IDS.share, action: "DOWNLOADED", versionNo: 2, actorId: IDS.user, actorName: "Secrétariat", occurredAt: "2026-10-02T09:10:00.000Z", detail: {} }]),
    ...extra,
  });

  it("descripteurs, versions (historique complet) et empreinte ; actions selon les droits sur CE document", async () => {
    setTestApi(routes());
    renderWithProviders(<DocumentDetailScreen documentId={IDS.doc} />);
    expect(await screen.findByRole("heading", { level: 1, name: "CNI de Awa" })).toBeTruthy();
    expect(screen.getByText("KONÉ Awa")).toBeTruthy();
    expect(screen.getByText("CI-123")).toBeTruthy(); // métadonnée libre
    expect(screen.getByText(SHA)).toBeTruthy();
    const versions = screen.getByRole("list", { name: "2 versions" });
    expect(within(versions).getAllByRole("listitem")).toHaveLength(2);
    expect(within(versions).getByText(/Version 2 · version actuelle/)).toBeTruthy();
    expect(within(versions).getByText("scan plus net")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Nouvelle version" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Modifier" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Archiver" })).toBeNull(); // pas le droit d'archiver
    expect(await screen.findByText("Téléchargé")).toBeTruthy(); // historique visible : droit d'historique
  });

  it("un parent (lecture seule) ne voit ni action d'écriture, ni partages, ni historique", async () => {
    setTestApi(routes(detail({ shares: null, access: { write: false, share: false, archive: false, history: false, via: ["GUARDIAN"] } })));
    renderWithProviders(<DocumentDetailScreen documentId={IDS.doc} />);
    await screen.findByRole("heading", { level: 1, name: "CNI de Awa" });
    expect(screen.getByRole("button", { name: "Télécharger" })).toBeTruthy();
    for (const name of ["Nouvelle version", "Modifier", "Archiver", "Restaurer"]) expect(screen.queryByRole("button", { name })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Partages" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Historique" })).toBeNull();
  });

  it("téléchargement : URL signée demandée à l'API puis suivie aussitôt ; erreur affichée", async () => {
    const clicks: Array<{ href: string; download: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ href: this.href, download: this.download });
    });
    let fail = false;
    setTestApi(
      routes(undefined, {
        [`GET ${D}/documents/${IDS.doc}/versions/1/download-url`]: () => (fail ? json({ code: "documents.object_missing", kind: "conflict", message: "Le fichier est introuvable dans le stockage." }, { status: 410 }) : json({ url: "https://stockage.test/objet?sig=abc", expiresAt: "2026-10-02T09:01:00.000Z", fileName: "cni-v1.pdf", mime: "application/pdf", versionNo: 1 })),
      }),
    );
    renderWithProviders(<DocumentDetailScreen documentId={IDS.doc} />);
    await screen.findByRole("heading", { level: 1, name: "CNI de Awa" });
    fireEvent.click(screen.getByRole("button", { name: "Télécharger la version 1" }));
    await waitFor(() => expect(clicks).toHaveLength(1));
    expect(clicks[0]).toEqual({ href: "https://stockage.test/objet?sig=abc", download: "cni-v1.pdf" });
    fail = true;
    fireEvent.click(screen.getByRole("button", { name: "Télécharger la version 1" }));
    expect(await screen.findByText("Le fichier est introuvable dans le stockage.")).toBeTruthy();
  });

  describe("prévisualisation sûre (octets servis par l'API, jamais d'HTML)", () => {
    beforeEach(() => {
      vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:test-1"), revokeObjectURL: vi.fn() }));
    });
    afterEach(() => vi.unstubAllGlobals());
    // `Blob` de Node (comme celui que renvoie `response.blob()` en production) : le `Blob` de jsdom n'est pas compris par `Response`.
    const blobRoute = (type: string, body: string) => () => new Response(new NodeBlob([body], { type }), { status: 200, headers: { "content-type": type } });

    it("PDF : visionneur du navigateur, uniquement sur demande ; aucune requête avant le clic", async () => {
      const api = setTestApi(routes(undefined, { [`GET ${D}/documents/${IDS.doc}/versions/2/preview`]: blobRoute("application/pdf", "%PDF-1.4") }));
      renderWithProviders(<DocumentDetailScreen documentId={IDS.doc} />);
      await screen.findByRole("heading", { level: 1, name: "CNI de Awa" });
      expect(api.calls.some((c) => c.path.endsWith("/preview"))).toBe(false);
      fireEvent.click(screen.getByRole("button", { name: "Prévisualiser la version 2" }));
      const frame = await screen.findByTitle("Aperçu PDF de cni-v2.pdf");
      expect(frame.tagName).toBe("IFRAME");
      expect(frame.getAttribute("src")).toBe("blob:test-1");
      expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    });

    it("image dans <img> avec texte alternatif ; texte dans <pre> échappé (jamais interprété)", async () => {
      const img = detail({ versions: [version({ fileName: "photo.jpg", mime: "image/jpeg", previewKind: "IMAGE" })] });
      setTestApi(routes(img, { [`GET ${D}/documents/${IDS.doc}/versions/1/preview`]: blobRoute("image/jpeg", "jpegdata") }));
      const { unmount } = renderWithProviders(<DocumentDetailScreen documentId={IDS.doc} />);
      await screen.findByRole("heading", { level: 1, name: "CNI de Awa" });
      fireEvent.click(screen.getByRole("button", { name: "Prévisualiser la version 1" }));
      expect(((await screen.findByAltText("Aperçu de photo.jpg")) as HTMLImageElement).getAttribute("src")).toBe("blob:test-1");
      unmount();
      const txt = detail({ versions: [version({ fileName: "note.txt", mime: "text/plain", previewKind: "TEXT" })] });
      setTestApi(routes(txt, { [`GET ${D}/documents/${IDS.doc}/versions/1/preview`]: blobRoute("text/plain; charset=utf-8", "<script>alert(1)</script> Article 1") }));
      renderWithProviders(<DocumentDetailScreen documentId={IDS.doc} />);
      await screen.findByRole("heading", { level: 1, name: "CNI de Awa" });
      fireEvent.click(screen.getByRole("button", { name: "Prévisualiser la version 1" }));
      const pre = await screen.findByLabelText("Contenu de note.txt");
      expect(pre.textContent).toBe("<script>alert(1)</script> Article 1");
      expect(pre.querySelector("script")).toBeNull();
    });

    it("type sans aperçu : message, aucune requête ; erreur de l'API (415 Office désactivé) : message et « Réessayer »", async () => {
      const office = detail({ versions: [version({ fileName: "reglement.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", previewKind: "OFFICE" })] });
      setTestApi(routes(office, { [`GET ${D}/documents/${IDS.doc}/versions/1/preview`]: () => json({ code: "documents.preview_unavailable", kind: "validation", message: "La prévisualisation des documents Office n'est pas activée : téléchargez le fichier." }, { status: 415 }) }));
      renderWithProviders(<DocumentDetailScreen documentId={IDS.doc} />);
      await screen.findByRole("heading", { level: 1, name: "CNI de Awa" });
      fireEvent.click(screen.getByRole("button", { name: "Prévisualiser la version 1" }));
      expect(await screen.findByText(/La prévisualisation des documents Office n'est pas activée/)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Réessayer" })).toBeTruthy();
    });

    it("version sans aperçu possible (NONE) ou purgée : mention explicite", async () => {
      const api = setTestApi(routes(detail({ versions: [version({ fileName: "tableau.tiff", mime: "image/tiff", previewKind: "NONE" })] })));
      renderWithProviders(<DocumentDetailScreen documentId={IDS.doc} />);
      await screen.findByRole("heading", { level: 1, name: "CNI de Awa" });
      fireEvent.click(screen.getByRole("button", { name: "Prévisualiser la version 1" }));
      expect(await screen.findByText("Aucune prévisualisation pour ce type de fichier : téléchargez-le.")).toBeTruthy();
      expect(api.calls.some((c) => c.path.endsWith("/preview"))).toBe(false);
    });
  });

  it("nouvelle version : fichier choisi, note, version de base transmise (détection d'un dépôt concurrent)", async () => {
    const api = setTestApi(routes(undefined, { [`POST ${D}/documents/${IDS.doc}/versions`]: detail({ currentVersionNo: 3 }) }));
    renderWithProviders(<DocumentDetailScreen documentId={IDS.doc} />);
    await screen.findByRole("heading", { level: 1, name: "CNI de Awa" });
    fireEvent.click(screen.getByRole("button", { name: "Nouvelle version" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/La version 3 remplacera la version actuelle/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Déposer la version" }));
    expect(await within(dialog).findByText("Choisissez un fichier.")).toBeTruthy();
    fireEvent.change(within(dialog).getByTestId("dropzone-input"), { target: { files: [pdfFile("cni-v3.pdf")] } });
    fireEvent.change(within(dialog).getByLabelText("Note de version"), { target: { value: "recadrée" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Déposer la version" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.calls.find((c) => c.method === "POST" && c.path.endsWith("/versions"))!.body).toMatchObject({ note: "recadrée", baseVersion: "2", file: { fileName: "cni-v3.pdf" } });
  });

  it("catégorie à échéance obligatoire et document échu : la nouvelle version doit porter une nouvelle date", async () => {
    const expired = detail({ expiresOn: "2026-01-01", expiryState: "EXPIRED", daysToExpiry: -274 });
    const api = setTestApi(
      routes(expired, { [`GET ${D}/categories`]: { items: [category({ requiresExpiry: true })] }, [`POST ${D}/documents/${IDS.doc}/versions`]: detail() }),
    );
    renderWithProviders(<DocumentDetailScreen documentId={IDS.doc} />);
    await screen.findByRole("heading", { level: 1, name: "CNI de Awa" });
    fireEvent.click(screen.getByRole("button", { name: "Nouvelle version" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByText(/Obligatoire si le document est échu/)).toBeTruthy());
    fireEvent.change(within(dialog).getByTestId("dropzone-input"), { target: { files: [pdfFile("renouvelee.pdf")] } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Déposer la version" }));
    expect(await within(dialog).findByText("Indiquez la nouvelle date d'expiration.")).toBeTruthy();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("modification : seuls les champs changés partent ; la visibilité n'est proposée qu'au personnel", async () => {
    const api = setTestApi(routes(undefined, { [`PATCH ${D}/documents/${IDS.doc}`]: detail({ title: "CNI (corrigée)" }) }));
    renderWithProviders(<DocumentDetailScreen documentId={IDS.doc} />);
    await screen.findByRole("heading", { level: 1, name: "CNI de Awa" });
    fireEvent.click(screen.getByRole("button", { name: "Modifier" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Titre"), { target: { value: "CNI (corrigée)" } });
    fireEvent.change(within(dialog).getByLabelText("Étiquettes"), { target: { value: "identité, vérifié" } });
    fireEvent.change(within(dialog).getByLabelText("Visibilité"), { target: { value: "PRIVATE" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.calls.find((c) => c.method === "PATCH")!.body).toEqual({ title: "CNI (corrigée)", description: null, tags: ["identité", "vérifié"], visibility: "PRIVATE" });
  });

  it("archivage motivé (droit d'archiver) puis restauration par la gestion", async () => {
    const api = setTestApi(
      routes(detail({ access: { write: true, share: true, archive: true, history: true, via: ["MANAGER"] } }), {
        [`GET ${D}/me/context`]: context({}, { manage: true, archive: true }),
        [`POST ${D}/documents/${IDS.doc}/archive`]: { id: IDS.doc, status: "ARCHIVED", archivedAt: "2026-10-02T09:00:00.000Z", purgeAfter: null },
      }),
    );
    const { unmount } = renderWithProviders(<DocumentDetailScreen documentId={IDS.doc} />);
    await screen.findByRole("heading", { level: 1, name: "CNI de Awa" });
    fireEvent.click(screen.getByRole("button", { name: "Archiver" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Archiver" })); // sans motif
    expect(api.calls.some((c) => c.method === "POST" && c.path.endsWith("/archive"))).toBe(false);
    fireEvent.change(within(dialog).getByLabelText(/Motif de l'archivage/), { target: { value: "pièce périmée" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Archiver" }));
    await waitFor(() => expect(api.calls.find((c) => c.path.endsWith("/archive"))?.body).toEqual({ reason: "pièce périmée" }));
    expect(await screen.findByText(/Document archivé/)).toBeTruthy();
    unmount();

    const restored = setTestApi(
      routes(detail({ status: "ARCHIVED", archivedAt: "2026-10-02T09:00:00.000Z", archiveReason: "doublon", access: { write: true, share: true, archive: true, history: true, via: ["MANAGER"] } }), {
        [`GET ${D}/me/context`]: context({}, { manage: true }),
        [`POST ${D}/documents/${IDS.doc}/restore`]: detail(),
      }),
    );
    renderWithProviders(<DocumentDetailScreen documentId={IDS.doc} />);
    expect(await screen.findByText(/Ce document est archivé\. Motif : doublon/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Nouvelle version" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Restaurer" }));
    await waitFor(() => expect(restored.calls.some((c) => c.method === "POST" && c.path.endsWith("/restore"))).toBe(true));
    expect(await screen.findByText("Document restauré.")).toBeTruthy();
  });

  it("partages : liste, retrait, ajout d'une personne (niveau, fin, note) et partage rapide avec les tuteurs", async () => {
    const api = setTestApi(
      routes(detail({ shares: [share(), share({ id: IDS.doc2, userId: IDS.user, userName: "Ancien partage", active: false })] }), {
        [`GET ${D}/people`]: { items: [{ id: IDS.user, displayName: "M. Traoré", kind: "USER", detail: "personnel" }] },
        [`GET ${D}/students/${IDS.child}/guardians`]: { items: [{ id: IDS.guardian, displayName: "Mme Koné", kind: "USER", detail: "tuteur" }] },
        [`POST ${D}/documents/${IDS.doc}/shares`]: share({ id: IDS.doc3 }),
        [`DELETE ${D}/documents/${IDS.doc}/shares/${IDS.share}`]: () => new Response(null, { status: 204 }),
      }),
    );
    renderWithProviders(<DocumentDetailScreen documentId={IDS.doc} />);
    const list = await screen.findByRole("list", { name: "Personnes ayant accès par partage" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1); // le partage retiré n'est pas listé
    expect(within(list).getByText("Mme Koné")).toBeTruthy();
    fireEvent.click(within(list).getByRole("button", { name: "Retirer le partage de Mme Koné" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "DELETE")).toBe(true));

    const person = screen.getByRole("combobox", { name: /Partager avec/ });
    fireEvent.focus(person);
    fireEvent.change(person, { target: { value: "Tra" } });
    fireEvent.click(await screen.findByRole("option", { name: /M\. Traoré/ }));
    fireEvent.change(screen.getByLabelText("Droit accordé"), { target: { value: "WRITE" } });
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "pour le conseil" } });
    fireEvent.click(screen.getByRole("button", { name: "Partager" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST" && c.path.endsWith("/shares"))?.body).toEqual({ userId: IDS.user, level: "WRITE", note: "pour le conseil" }));
    expect(await screen.findByText("Document partagé avec M. Traoré.")).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: "Partager avec Mme Koné" }));
    await waitFor(() => expect(api.calls.filter((c) => c.method === "POST" && c.path.endsWith("/shares")).at(-1)?.body).toMatchObject({ userId: IDS.guardian }));
  });

  it("document introuvable ou invisible : erreur avec « Réessayer »", async () => {
    setTestApi({ ...accessRoutes(["documents.read"]), [`GET ${D}/me/context`]: context(), [`GET ${D}/documents/${IDS.doc}`]: () => json({ code: "documents.document_not_found", kind: "not_found", message: "Document introuvable." }, { status: 404 }) });
    renderWithProviders(<DocumentDetailScreen documentId={IDS.doc} />);
    expect(await screen.findByText("Document introuvable.")).toBeTruthy();
  });
});

describe("ExpirationsScreen", () => {
  it("compteurs, onglets (à échoir / échus / sans échéance), horizon transmis à l'API, états vides", async () => {
    const api = setTestApi({
      ...accessRoutes(["documents.read"]),
      [`GET ${D}/summary`]: { expiring: 3, expired: 2, missingExpiry: 1, total: 20, quarantineHeld: null, withinDays: 30 },
      [`GET ${D}/documents`]: ({ url }) => json(page(url.searchParams.get("expiry") === "missing" ? [] : [summary({ expiryState: "EXPIRING", expiresOn: "2026-10-07", daysToExpiry: 5 })])),
    });
    renderWithProviders(<ExpirationsScreen />);
    expect(await screen.findByLabelText("À échoir sous 30 jours : 3")).toBeTruthy();
    expect(screen.getByLabelText("Échus : 2")).toBeTruthy();
    expect(screen.getByLabelText("Sans échéance (exigée) : 1")).toBeTruthy();
    expect(await screen.findByText("CNI de Awa")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Horizon"), { target: { value: "90" } });
    await waitFor(() => expect(api.calls.some((c) => c.path === `${D}/summary` && c.query.withinDays === "90")).toBe(true));
    fireEvent.click(screen.getByRole("tab", { name: "Échus" }));
    await waitFor(() => expect(api.calls.some((c) => c.path === `${D}/documents` && c.query.expiry === "expired" && c.query.sort === "expiresOn" && c.query.dir === "desc")).toBe(true));
    fireEvent.click(screen.getByRole("tab", { name: "Sans échéance" }));
    expect(await screen.findByText("Aucun document sans échéance exigée.")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Sans échéance" }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("CategoriesScreen", () => {
  const cats = [
    category({ documentCount: 4 }),
    category({ id: IDS.catMedical, code: "STUDENT_MEDICAL", label: "Dossier médical", confidentiality: "CONFIDENTIAL", audienceOwner: false, requiresExpiry: true, documentCount: 0 }),
    category({ id: IDS.catRegulation, code: "INSTITUTION_REGULATION", label: "Règlement intérieur", kind: "INSTITUTION", confidentiality: "INTERNAL", status: "ARCHIVED", audienceOwner: false, audienceGuardians: false, ownerUpload: false }),
  ];
  const base = (extra: Record<string, unknown> = {}) => ({
    ...accessRoutes(["documents.category.manage"]),
    [`GET ${D}/me/context`]: context({}, { categoryManage: true }),
    [`GET ${D}/categories`]: { items: cats },
    ...extra,
  });

  it("catégories groupées par type avec niveau, audiences, extensions et compteurs ; archivée signalée", async () => {
    const api = setTestApi(base());
    renderWithProviders(<CategoriesScreen />);
    const student = await screen.findByRole("list", { name: "Dossier d'élève" });
    expect(within(student).getAllByRole("listitem")).toHaveLength(2);
    expect(within(student).getByText("Confidentiel")).toBeTruthy();
    expect(within(student).getByText("Échéance obligatoire")).toBeTruthy();
    expect(within(student).getByText(/4 documents/)).toBeTruthy();
    expect(within(student).getAllByText(/\.pdf \.jpg \.jpeg \.png/)).toHaveLength(2);
    expect(within(screen.getByRole("list", { name: "Établissement" })).getByText("Archivée")).toBeTruthy();
    expect(api.calls.find((c) => c.path === `${D}/categories`)!.query).toMatchObject({ includeArchived: "true" });
    expect(screen.getByText(/aussitôt qui peut voir ses documents/)).toBeTruthy();
  });

  it("création : code et libellé validés avant envoi ; corps conforme au contrat", async () => {
    const api = setTestApi(base({ [`POST ${D}/categories`]: category({ id: IDS.doc3, code: "STUDENT_SPORT", label: "Certificats sportifs" }) }));
    renderWithProviders(<CategoriesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Nouvelle catégorie" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    expect((await within(dialog).findAllByRole("alert")).map((a) => a.textContent).join(" ")).toContain("Code invalide");
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.change(within(dialog).getByLabelText(/^Code/), { target: { value: "student_sport" } });
    fireEvent.change(within(dialog).getByLabelText(/^Libellé/), { target: { value: "Certificats sportifs" } });
    fireEvent.change(within(dialog).getByLabelText("Niveau de confidentialité"), { target: { value: "INTERNAL" } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: ".docx" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Les tuteurs liés peuvent lire/ }));
    fireEvent.change(within(dialog).getByLabelText("Taille maximale (Mo)"), { target: { value: "5" } });
    fireEvent.change(within(dialog).getByLabelText(/Seuils d'alerte/), { target: { value: "15, 3" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.calls.find((c) => c.method === "POST" && c.path === `${D}/categories`)!.body).toMatchObject({
      code: "STUDENT_SPORT",
      kind: "STUDENT",
      label: "Certificats sportifs",
      confidentiality: "INTERNAL",
      allowedExtensions: ["pdf", "jpg", "jpeg", "png", "docx"],
      audienceGuardians: true,
      maxBytes: 5 * 1024 * 1024,
      alertDays: [15, 3],
    });
  });

  it("modification (code et type figés), archivage et restauration", async () => {
    const api = setTestApi(
      base({
        [`PATCH ${D}/categories/${IDS.catMedical}`]: category(),
        [`POST ${D}/categories/${IDS.catMedical}/archive`]: category({ status: "ARCHIVED" }),
        [`POST ${D}/categories/${IDS.catRegulation}/restore`]: category(),
      }),
    );
    renderWithProviders(<CategoriesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Modifier la catégorie Dossier médical" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText(/^Code/)).toBeNull();
    fireEvent.change(within(dialog).getByLabelText(/^Libellé/), { target: { value: "Dossier médical et vaccins" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "PATCH")?.body).toMatchObject({ label: "Dossier médical et vaccins", confidentiality: "CONFIDENTIAL" }));
    fireEvent.click(await screen.findByRole("button", { name: "Archiver la catégorie Dossier médical" }));
    await waitFor(() => expect(api.calls.some((c) => c.path.endsWith(`${IDS.catMedical}/archive`))).toBe(true));
    fireEvent.click(await screen.findByRole("button", { name: "Restaurer la catégorie Règlement intérieur" }));
    await waitFor(() => expect(api.calls.some((c) => c.path.endsWith(`${IDS.catRegulation}/restore`))).toBe(true));
  });

  it("droits par personne : liste, ajout (lecture / dépôt, fin, note) et retrait", async () => {
    const api = setTestApi(
      base({
        [`GET ${D}/categories/${IDS.catMedical}/grants`]: { items: [{ id: IDS.share, categoryId: IDS.catMedical, userId: IDS.user, userName: "Dr Bamba", level: "READ", expiresAt: null, note: null, createdBy: IDS.user, createdAt: "2026-10-02T09:00:00.000Z", revokedAt: null, active: true }] },
        [`GET ${D}/people`]: { items: [{ id: IDS.guardian, displayName: "Mme Koné", kind: "USER", detail: null }] },
        [`POST ${D}/categories/${IDS.catMedical}/grants`]: { id: IDS.doc3, categoryId: IDS.catMedical, userId: IDS.guardian, userName: "Mme Koné", level: "WRITE", expiresAt: null, note: null, createdBy: IDS.user, createdAt: "2026-10-02T09:00:00.000Z", revokedAt: null, active: true },
        [`DELETE ${D}/categories/${IDS.catMedical}/grants/${IDS.share}`]: () => new Response(null, { status: 204 }),
      }),
    );
    renderWithProviders(<CategoriesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Droits par personne sur la catégorie Dossier médical" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Dr Bamba")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Retirer le droit de Dr Bamba" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "DELETE")).toBe(true));
    const person = within(dialog).getByRole("combobox", { name: /Personne/ });
    fireEvent.focus(person);
    fireEvent.change(person, { target: { value: "Kon" } });
    fireEvent.click(await within(dialog).findByRole("option", { name: /Mme Koné/ }));
    fireEvent.change(within(dialog).getByLabelText("Droit accordé"), { target: { value: "WRITE" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Accorder le droit" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST" && c.path.endsWith("/grants"))?.body).toEqual({ userId: IDS.guardian, level: "WRITE" }));
  });
});

describe("QuarantineScreen", () => {
  it("liste, libération motivée (3 caractères minimum), destruction, états par onglet", async () => {
    const api = setTestApi({
      ...accessRoutes(["documents.quarantine.manage"]),
      [`GET ${D}/quarantine`]: ({ url }) => json(page(url.searchParams.get("status") === "RELEASED" ? [] : [quarantineItem()])),
      [`POST ${D}/quarantine/${IDS.quarantine}/release`]: detail(),
      [`DELETE ${D}/quarantine/${IDS.quarantine}`]: () => new Response(null, { status: 204 }),
    });
    renderWithProviders(<QuarantineScreen />);
    const list = await screen.findByRole("list", { name: "Fichiers en quarantaine" });
    expect(within(list).getByText("facture.pdf")).toBeTruthy();
    expect(within(list).getByText(/Eicar-Test-Signature/)).toBeTruthy();
    expect(within(list).getByText("Dépôt d'un nouveau document")).toBeTruthy();
    expect(screen.getByText(/décision motivée, auditée/)).toBeTruthy();
    expect(api.calls.find((c) => c.path === `${D}/quarantine`)!.query).toMatchObject({ status: "HELD" });

    fireEvent.click(within(list).getByRole("button", { name: "Libérer le fichier facture.pdf" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif de la décision/), { target: { value: "ab" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Libérer" }));
    expect(api.calls.some((c) => c.method === "POST")).toBe(false); // motif trop court
    fireEvent.change(within(dialog).getByLabelText(/Motif de la décision/), { target: { value: "Faux positif confirmé" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Libérer" }));
    await waitFor(() => expect(api.calls.find((c) => c.path.endsWith("/release"))?.body).toEqual({ note: "Faux positif confirmé" }));
    expect(await screen.findByText("Fichier facture.pdf libéré.")).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: "Détruire le fichier facture.pdf" }));
    const del = await screen.findByRole("dialog");
    fireEvent.change(within(del).getByLabelText(/Motif de la décision/), { target: { value: "Malware confirmé" } });
    fireEvent.click(within(del).getByRole("button", { name: "Détruire" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "DELETE")?.body).toEqual({ note: "Malware confirmé" }));

    fireEvent.click(screen.getByRole("tab", { name: "Libérés" }));
    expect(await screen.findByText("Aucun fichier.")).toBeTruthy();
  });
});

describe("SettingsScreen", () => {
  it("usage de stockage (barre de progression) et réglages validés ; corps conforme au contrat", async () => {
    const api = setTestApi({
      ...accessRoutes(["documents.settings.manage"]),
      [`GET ${D}/settings`]: settings(),
      [`GET ${D}/usage`]: usage({ usedBytes: 1_700_000_000, quotaBytes: 2_000_000_000, planQuotaBytes: 2_000_000_000 }),
      [`PUT ${D}/settings`]: settings({ maxBytes: 10 * 1024 * 1024 }),
    });
    renderWithProviders(<SettingsScreen />);
    const meter = await screen.findByRole("progressbar", { name: "Part du quota de stockage utilisée" });
    expect(meter.getAttribute("aria-valuenow")).toBe("85");
    expect(screen.getByText(/utilisés sur/)).toBeTruthy();
    expect((await screen.findByLabelText(/Taille maximale d'un fichier/) as HTMLInputElement).value).toBe("15");

    fireEvent.change(screen.getByLabelText(/Taille maximale d'un fichier/), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText(/Seuils d'alerte/), { target: { value: "30, abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect((await screen.findAllByRole("alert")).length).toBeGreaterThanOrEqual(2);
    expect(api.calls.some((c) => c.method === "PUT")).toBe(false);

    fireEvent.change(screen.getByLabelText(/Taille maximale d'un fichier/), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/Seuils d'alerte/), { target: { value: "60, 30, 7" } });
    fireEvent.change(screen.getByLabelText(/Quota de stockage de l'établissement/), { target: { value: "1024" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "PUT")?.body).toEqual({
      maxBytes: 10 * 1024 * 1024,
      storageQuotaBytes: 1024 * 1024 * 1024,
      defaultAlertDays: [60, 30, 7],
      archiveRetentionDays: 365,
      quarantineRetentionDays: 30,
      maxVersions: 50,
    }));
    expect(await screen.findByText("Paramètres enregistrés.")).toBeTruthy();
  });
});
