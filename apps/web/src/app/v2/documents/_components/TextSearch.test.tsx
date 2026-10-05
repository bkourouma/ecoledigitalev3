// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { documentDetailDtoSchema, documentTextHitDtoSchema, documentTextIndexDtoSchema, documentTextIndexStatusDtoSchema, documentTextSearchPageDtoSchema } from "@ecoledigitale/contracts/v2/documents";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { category, context, detail, IDS, page, summary, textHit } from "../_test/fixtures";
import { DocumentDetailScreen } from "./DocumentDetailScreen";
import { DocumentsNav } from "./DocumentsShell";
import { TextSearchScreen } from "./TextSearchScreen";

vi.setConfig({ testTimeout: 30_000 });

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/documents/search", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams("") }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const D = "/api/v1/documents";

beforeEach(() => undefined);
afterEach(() => vi.restoreAllMocks());

const base = (extra: Record<string, unknown> = {}) => ({
  ...accessRoutes(["documents.read"]),
  [`GET ${D}/me/context`]: context(),
  [`GET ${D}/categories`]: { items: [category()] },
  ...extra,
});

const type = (value: string) => fireEvent.change(screen.getByRole("searchbox", { name: /Mots recherchés/ }), { target: { value } });

describe("fabriques conformes aux contrats", () => {
  it("les données simulées passent les schémas de réponse", () => {
    expect(documentTextHitDtoSchema.safeParse(textHit()).success).toBe(true);
    expect(documentTextSearchPageDtoSchema.safeParse(page([textHit()])).success).toBe(true);
    expect(documentTextIndexDtoSchema.safeParse({ status: "INDEXED", versionNo: 1, pageCount: 3, pagesIndexed: 3, truncated: false, indexedAt: "2026-10-02T09:00:00.000Z", errorCode: null }).success).toBe(true);
    expect(documentTextIndexStatusDtoSchema.safeParse({ counts: { PENDING: 0, INDEXED: 1, NO_TEXT: 2, FAILED: 3 }, failures: [{ errorCode: "corrupt", count: 3 }] }).success).toBe(true);
    // le détail d'un document sans état d'indexation reste valide (champ facultatif)
    expect(documentDetailDtoSchema.safeParse(detail()).success).toBe(true);
  });
});

describe("DocumentsNav : l'onglet de recherche suit la permission de lecture", () => {
  it("présent pour qui peut lire, absent sans permission documentaire", async () => {
    setTestApi(accessRoutes(["documents.read"]));
    const { unmount } = renderWithProviders(<DocumentsNav />);
    expect(await screen.findByRole("link", { name: "Recherche dans les PDF" })).toBeTruthy();
    unmount();
    setTestApi(accessRoutes([]));
    renderWithProviders(<DocumentsNav />);
    await waitFor(() => expect(screen.queryByRole("link", { name: "Recherche dans les PDF" })).toBeNull());
  });
});

describe("TextSearchScreen : recherche dans le contenu", () => {
  it("invite à chercher, refuse une saisie trop courte sans appeler l'API", async () => {
    const calls: string[] = [];
    setTestApi(base({ [`GET ${D}/search`]: ({ url }: { url: URL }) => (calls.push(url.search), json(page([]))) }));
    renderWithProviders(<TextSearchScreen />);
    expect(await screen.findByText("Saisissez des mots à chercher")).toBeTruthy();
    type("a");
    expect(await screen.findByText("Saisissez au moins 2 caractères.", { selector: "[role]" }).catch(() => screen.findByText("Saisissez au moins 2 caractères.", { selector: "*" }))).toBeTruthy();
    await new Promise((r) => setTimeout(r, 450));
    expect(calls).toEqual([]);
  });

  it("affiche les résultats avec les mots trouvés surlignés (<mark>), jamais interprétés comme du HTML", async () => {
    const hostile = textHit({
      document: summary({ id: IDS.doc2, title: "Note <b>piégée</b>" }),
      snippet: [
        { text: "contenu avec <img src=x onerror=alert(1)> et ", match: false },
        { text: "<script>alert(1)</script>", match: true },
      ],
    });
    const seen: string[] = [];
    setTestApi(base({ [`GET ${D}/search`]: ({ url }: { url: URL }) => (seen.push(url.search), json(page([textHit(), hostile]))) }));
    renderWithProviders(<TextSearchScreen />);
    type("certificat");
    const list = await screen.findByRole("list", { name: "Résultats de la recherche" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    const marks = list.querySelectorAll("mark");
    expect([...marks].map((m) => m.textContent)).toEqual(["certificat", "<script>alert(1)</script>"]);
    // aucune balise du contenu n'est entrée dans le DOM
    expect(list.querySelector("script, img, b")).toBeNull();
    expect(within(items[1]!).getByText("Note <b>piégée</b>")).toBeTruthy();
    expect(items[0]!.querySelector("a")?.getAttribute("href")).toBe(`/v2/documents/${IDS.doc}`);
    expect(seen[0]).toContain("q=certificat");
    expect(seen[0]).toContain("limit=20");
  });

  it("filtre par catégorie, pagination « Afficher plus », état vide et état d'erreur avec « Réessayer »", async () => {
    let fail = true;
    const seen: URL[] = [];
    setTestApi(
      base({
        [`GET ${D}/search`]: ({ url }: { url: URL }) => {
          seen.push(url);
          if (fail) return json({ code: "INTERNAL", message: "boom" }, { status: 500 });
          const q = url.searchParams.get("q");
          if (q === "rien") return json(page([]));
          return json(url.searchParams.get("cursor") ? page([textHit({ document: summary({ id: IDS.doc3, title: "Page deux" }) })]) : page([textHit()], "curseur-2"));
        },
      }),
    );
    renderWithProviders(<TextSearchScreen />);
    type("certificat");
    expect(await screen.findByRole("alert")).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    await screen.findByRole("list", { name: "Résultats de la recherche" });
    fireEvent.click(screen.getByRole("button", { name: "Afficher plus de résultats" }));
    expect(await screen.findByText("Page deux")).toBeTruthy();
    expect(seen.some((u) => u.searchParams.get("cursor") === "curseur-2")).toBe(true);
    fireEvent.change(await screen.findByLabelText("Catégorie"), { target: { value: IDS.catIdentity } });
    await waitFor(() => expect(seen.some((u) => u.searchParams.get("categoryId") === IDS.catIdentity)).toBe(true));
    type("rien");
    expect(await screen.findByText("Aucun document ne contient ces mots.")).toBeTruthy();
  });

  it("signale qu'un PDF n'a été lu qu'en partie", async () => {
    setTestApi(base({ [`GET ${D}/search`]: page([textHit({ truncated: true, pagesIndexed: 200, pageCount: 480 })]) }));
    renderWithProviders(<TextSearchScreen />);
    type("certificat");
    expect(await screen.findByText(/Seules 200 pages sur 480 ont été lues/)).toBeTruthy();
  });

  it("l'état de l'index n'est montré qu'à la gestion ; relancer les échecs rend compte du nombre de PDF remis en file", async () => {
    const posted: unknown[] = [];
    setTestApi(
      base({
        ...accessRoutes(["documents.read", "documents.manage"]),
        [`GET ${D}/me/context`]: context({}, { manage: true }),
        [`GET ${D}/search`]: page([]),
        [`GET ${D}/search/status`]: { counts: { PENDING: 2, INDEXED: 40, NO_TEXT: 5, FAILED: 3 }, failures: [{ errorCode: "corrupt", count: 2 }, { errorCode: "encrypted", count: 1 }] },
        [`POST ${D}/search/reindex`]: ({ body }: { body: unknown }) => (posted.push(body), json({ queued: 3 })),
      }),
    );
    renderWithProviders(<TextSearchScreen />);
    const panel = await screen.findByRole("region", { name: "Index du texte des PDF" });
    expect(await within(panel).findByText("40")).toBeTruthy();
    expect(within(panel).getByText("Sans texte (scans)")).toBeTruthy();
    expect(within(panel).getByText("2 documents : fichier abîmé")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Relancer les échecs" }));
    expect(await within(panel).findByText("3 PDF remis en file de lecture.")).toBeTruthy();
    expect(posted).toEqual([{ scope: "FAILED" }]);
    // « Tout réindexer » exige une confirmation explicite avant d'écrire quoi que ce soit
    fireEvent.click(within(panel).getByRole("button", { name: "Tout réindexer" }));
    expect(within(panel).getByText(/Tout l'index est vidé puis reconstruit/)).toBeTruthy();
    expect(posted).toHaveLength(1);
    fireEvent.click(within(panel).getByRole("button", { name: "Oui, tout réindexer" }));
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1]).toEqual({ scope: "ALL" });
  });

  it("sans droit de gestion, aucun panneau d'administration de l'index", async () => {
    setTestApi(base({ [`GET ${D}/search`]: page([]) }));
    renderWithProviders(<TextSearchScreen />);
    await screen.findByText("Saisissez des mots à chercher");
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("region", { name: "Index du texte des PDF" })).toBeNull();
  });
});

describe("DocumentDetailScreen : état de lecture du texte", () => {
  const show = async (textIndex: unknown) => {
    setTestApi(
      base({
        [`GET ${D}/documents/${IDS.doc}`]: detail({ textIndex: textIndex as never }),
        [`GET ${D}/documents/${IDS.doc}/history`]: { items: [], nextCursor: null },
      }),
    );
    renderWithProviders(<DocumentDetailScreen documentId={IDS.doc} />);
    await screen.findByRole("heading", { name: "CNI de Awa" });
  };
  const idx = (over: Record<string, unknown>) => ({ status: "INDEXED", versionNo: 1, pageCount: 3, pagesIndexed: 3, truncated: false, indexedAt: "2026-10-02T09:00:00.000Z", errorCode: null, ...over });

  it("texte cherchable : pastille seule", async () => {
    await show(idx({}));
    expect(screen.getByText("Texte cherchable")).toBeTruthy();
  });
  it("PDF sans texte : explique l'absence d'OCR", async () => {
    await show(idx({ status: "NO_TEXT", pagesIndexed: 3 }));
    expect(screen.getByText("Sans texte")).toBeTruthy();
    expect(screen.getByText(/pas de reconnaissance de caractères/)).toBeTruthy();
  });
  it("échec : cause lisible, le document reste consultable", async () => {
    await show(idx({ status: "FAILED", errorCode: "encrypted" }));
    expect(screen.getByText("Texte illisible")).toBeTruthy();
    expect(screen.getByText(/fichier protégé par un mot de passe/)).toBeTruthy();
  });
  it("document qui n'est pas un PDF : aucune pastille de texte", async () => {
    await show(null);
    expect(screen.queryByText("Texte cherchable")).toBeNull();
    expect(screen.queryByText("Sans texte")).toBeNull();
  });
});
