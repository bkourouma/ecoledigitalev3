// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { higherDocumentDtoSchema } from "@ecoledigitale/contracts/v2/higher";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { uuid } from "../../_test/fixtures";
import { studentSummary } from "../../_test/fixtures-people";
import { award, document, studentDetail } from "../_test/fixtures";
import { AwardDocuments } from "./AwardDocuments";
import { DocumentPdfActions, pdfStateOf } from "./DocumentPdf";
import { DocumentsScreen } from "./DocumentsScreen";
import { MyDocumentsScreen } from "./MyDocumentsScreen";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const H = "/api/v1/higher";
const STAFF = ["higher.document.read", "higher.document.issue"];
const READY_DOC = document(1);
const PDF = (id: number) => `GET ${H}/documents/${uuid(8500 + id)}/pdf`;
const ready = { status: "READY", url: "https://stockage.test/diplome.pdf?sig=SECRET", expiresInSec: 300, fileName: "diplome.pdf", contentType: "application/pdf", pdfHash: "c".repeat(64) };

describe("états du PDF", () => {
  it("fixtures conformes ; état lu dans le DTO (révoqué l'emporte)", () => {
    expect(higherDocumentDtoSchema.safeParse(READY_DOC).success).toBe(true);
    expect(pdfStateOf({ status: "ISSUED", renderStatus: "RENDERED" })).toBe("ready");
    expect(pdfStateOf({ status: "ISSUED", renderStatus: "PENDING" })).toBe("preparing");
    expect(pdfStateOf({ status: "ISSUED", renderStatus: "RENDERING" })).toBe("preparing");
    expect(pdfStateOf({ status: "ISSUED", renderStatus: "FAILED" })).toBe("failed");
    expect(pdfStateOf({ status: "REVOKED", renderStatus: "RENDERED" })).toBe("revoked");
  });
});

describe("DocumentsScreen — colonne PDF", () => {
  it("Prêt / En préparation / Échec / Révoqué, mention scellé, lien de vérification publique ; Relancer seulement sur l'échec", async () => {
    setTestApi({
      ...accessRoutes(STAFF, ["higher.diplomas"]),
      [`GET ${H}/documents`]: {
        items: [
          document(1),
          document(2, { renderStatus: "PENDING", sealed: false }),
          document(3, { renderStatus: "FAILED" }),
          document(4, { status: "REVOKED", revokedAt: "2026-10-01T08:00:00.000Z", revokeReason: "Erreur" }),
        ],
        nextCursor: null,
      },
      [`GET /api/v1/people/students/${uuid(3001)}`]: studentDetail(1, "Aka Marie"),
    });
    renderWithProviders(<DocumentsScreen />);
    const table = await screen.findByRole("table", { name: "Documents officiels" });
    await within(table).findAllByText("Aka Marie");
    expect(within(table).getByText("PDF prêt")).toBeTruthy();
    expect(within(table).getByText("PDF en préparation")).toBeTruthy();
    expect(within(table).getByText("PDF en échec")).toBeTruthy();
    expect(within(table).getAllByText("Révoqué")).toHaveLength(2); // état du document et état du PDF
    expect(within(table).getAllByText("Scellé").length).toBeGreaterThan(0);
    expect(within(table).getByText("Non scellé")).toBeTruthy();
    expect(within(table).getAllByRole("link", { name: "Page de vérification publique" })[0]!.getAttribute("href")).toBe("/v2/verify/ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    // Télécharger : tous sauf le révoqué ; Relancer : seulement le PDF en échec.
    expect(within(table).getAllByRole("button", { name: /Télécharger le PDF — / })).toHaveLength(3);
    expect(within(table).getByText("Document révoqué : le PDF n'est plus fourni.")).toBeTruthy();
    expect(within(table).getAllByRole("button", { name: /Relancer — / })).toHaveLength(1);
    expect(within(table).getByRole("button", { name: "Relancer — DOC-2026-003" })).toBeTruthy();
  });

  it("sans higher.document.issue : pas de bouton Relancer, message adapté", async () => {
    setTestApi({
      ...accessRoutes(["higher.document.read"], ["higher.diplomas"]),
      [`GET ${H}/documents`]: { items: [document(3, { renderStatus: "FAILED" })], nextCursor: null },
      [`GET /api/v1/people/students/${uuid(3001)}`]: studentDetail(1, "Aka Marie"),
    });
    renderWithProviders(<DocumentsScreen />);
    await screen.findByRole("button", { name: /Télécharger le PDF —/ });
    await waitFor(() => expect(screen.getByText(/Contactez le secrétariat pour la relancer/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Relancer/ })).toBeNull();
  });
});

describe("DocumentPdfActions", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());
  const tick = (ms = 3000) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  it("PDF prêt : l'URL signée est demandée au clic, ouverte dans un nouvel onglet et jamais affichée", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const api = setTestApi({ ...accessRoutes(STAFF), [PDF(1)]: ready });
    renderWithProviders(<DocumentPdfActions doc={READY_DOC as never} />);
    expect(api.calls.some((c) => c.path.endsWith("/pdf"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Télécharger le PDF/ }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://stockage.test/diplome.pdf?sig=SECRET", "_blank", "noopener,noreferrer"));
    expect(globalThis.document.body.innerHTML).not.toContain("SECRET");
  });

  it("202 : « en préparation », relecture toutes les 3 s, puis PDF prêt (pas d'ouverture automatique) ; un nouveau clic ouvre l'URL", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    let calls = 0;
    const frames: Array<[number, unknown]> = [
      [202, { status: "PENDING" }],
      [202, { status: "RENDERING" }],
      [200, ready],
    ];
    const api = setTestApi({
      ...accessRoutes(STAFF),
      [PDF(1)]: () => {
        const [status, body] = frames[Math.min(calls++, frames.length - 1)]!;
        return json(body, { status });
      },
    });
    renderWithProviders(<DocumentPdfActions doc={document(1, { renderStatus: "PENDING" }) as never} />);
    fireEvent.click(screen.getByRole("button", { name: /Télécharger le PDF/ }));
    expect(await screen.findByText(/Le PDF est en préparation/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Télécharger le PDF/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.calls.filter((c) => c.path.endsWith("/pdf"))).toHaveLength(1);
    await tick();
    expect(api.calls.filter((c) => c.path.endsWith("/pdf"))).toHaveLength(2);
    await tick();
    expect(await screen.findByText(/Le PDF est prêt/)).toBeTruthy();
    expect(api.calls.filter((c) => c.path.endsWith("/pdf"))).toHaveLength(3);
    expect(open).not.toHaveBeenCalled();
    // Plus de relecture ensuite.
    await tick(9000);
    expect(api.calls.filter((c) => c.path.endsWith("/pdf"))).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: /Télécharger le PDF/ }));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
  });

  it("toujours en préparation : la relecture s'arrête après 20 tentatives avec un message", async () => {
    const api = setTestApi({ ...accessRoutes(STAFF), [PDF(1)]: () => json({ status: "RENDERING" }, { status: 202 }) });
    renderWithProviders(<DocumentPdfActions doc={document(1, { renderStatus: "PENDING" }) as never} />);
    fireEvent.click(screen.getByRole("button", { name: /Télécharger le PDF/ }));
    await screen.findByText(/Le PDF est en préparation/);
    for (let i = 0; i < 25; i += 1) await tick();
    expect(await screen.findByText(/toujours en préparation/)).toBeTruthy();
    const count = api.calls.filter((c) => c.path.endsWith("/pdf")).length;
    expect(count).toBe(21); // 1 clic + 20 relectures
    await tick(9000);
    expect(api.calls.filter((c) => c.path.endsWith("/pdf"))).toHaveLength(count);
    expect((screen.getByRole("button", { name: /Télécharger le PDF/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("échec du rendu : message et Relancer (POST /render) puis suivi de la reprise jusqu'au PDF prêt", async () => {
    let rendering = false;
    let polls = 0;
    const api = setTestApi({
      ...accessRoutes(STAFF),
      [PDF(1)]: () => {
        if (!rendering) return json({ status: "FAILED" }, { status: 202 });
        polls += 1;
        return polls < 2 ? json({ status: "RENDERING" }, { status: 202 }) : json(ready);
      },
      [`POST ${H}/documents/${uuid(8501)}/render`]: () => {
        rendering = true;
        return json(document(1, { renderStatus: "PENDING" }), { status: 202 });
      },
    });
    renderWithProviders(<DocumentPdfActions doc={document(1, { renderStatus: "PENDING" }) as never} />);
    fireEvent.click(screen.getByRole("button", { name: /Télécharger le PDF/ }));
    expect(await screen.findByText(/La production du PDF a échoué\. Vous pouvez relancer/)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /Relancer — DOC-2026-001/ }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path.endsWith("/render"))).toBe(true));
    expect(await screen.findByText(/Le PDF est en préparation/)).toBeTruthy();
    await tick();
    await tick();
    expect(await screen.findByText(/Le PDF est prêt/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Relancer/ })).toBeNull();
  });

  it("document révoqué (409) : message du serveur affiché, rien n'est ouvert", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    setTestApi({ ...accessRoutes(STAFF), [PDF(1)]: () => json({ code: "higher.document_revoked", message: "Ce document est révoqué : il ne peut plus être téléchargé." }, { status: 409 }) });
    renderWithProviders(<DocumentPdfActions doc={READY_DOC as never} />);
    fireEvent.click(screen.getByRole("button", { name: /Télécharger le PDF/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("Ce document est révoqué : il ne peut plus être téléchargé.");
    expect(open).not.toHaveBeenCalled();
  });

  it("accès refusé (403) : message de l'API", async () => {
    setTestApi({ ...accessRoutes([]), [PDF(1)]: () => json({ code: "FORBIDDEN", message: "Ce document n'est pas encore publié." }, { status: 403 }) });
    renderWithProviders(<DocumentPdfActions doc={READY_DOC as never} />);
    fireEvent.click(screen.getByRole("button", { name: /Télécharger le PDF/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("Ce document n'est pas encore publié.");
  });

  it("document révoqué dans la liste : aucun bouton de téléchargement", () => {
    setTestApi({ ...accessRoutes(STAFF) });
    renderWithProviders(<DocumentPdfActions doc={document(1, { status: "REVOKED" }) as never} />);
    expect(screen.queryByRole("button", { name: /Télécharger/ })).toBeNull();
    expect(screen.getByText("Document révoqué : le PDF n'est plus fourni.")).toBeTruthy();
  });
});

describe("AwardDocuments (détail d'un diplôme)", () => {
  it("charge à la demande les documents de l'octroi, avec PDF, scellé, vérification publique", async () => {
    const api = setTestApi({
      ...accessRoutes(STAFF),
      [`GET ${H}/documents`]: { items: [document(1), document(2, { awardId: uuid(8402), documentKind: "ATTESTATION_AUTHENTICITY" })], nextCursor: null },
    });
    renderWithProviders(<AwardDocuments award={award(1) as never} />);
    expect(api.calls.some((c) => c.path === `${H}/documents`)).toBe(false);
    fireEvent.click(await screen.findByRole("button", { name: /Documents émis — / }));
    const list = await screen.findByRole("list", { name: /Documents de l'octroi/ });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(within(list).getByText("PDF prêt")).toBeTruthy();
    expect(within(list).getByText("Scellé")).toBeTruthy();
    expect(within(list).getByRole("link", { name: "Page de vérification publique" }).getAttribute("href")).toBe("/v2/verify/ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    expect(api.calls.find((c) => c.path === `${H}/documents`)!.query.studentId).toBe(uuid(3001));
  });

  it("sans higher.document.read : rien n'est proposé", async () => {
    setTestApi({ ...accessRoutes(["higher.award.read"]) });
    renderWithProviders(<AwardDocuments award={award(1) as never} />);
    await waitFor(() => expect(screen.queryByRole("button", { name: /Documents émis/ })).toBeNull());
  });
});

describe("MyDocumentsScreen", () => {
  it("étudiant : ses documents publiés avec PDF, scellé et lien de vérification ; jamais de bouton Relancer", async () => {
    setTestApi({
      ...accessRoutes(["higher.self.read"]),
      [`GET ${H}/me/documents`]: { items: [document(1, { publishedAt: "2026-10-01T08:00:00.000Z" }), document(3, { renderStatus: "FAILED", publishedAt: "2026-10-01T08:00:00.000Z" }), document(4, { status: "REVOKED", revokeReason: "Erreur de saisie", publishedAt: "2026-10-01T08:00:00.000Z" })] },
    });
    renderWithProviders(<MyDocumentsScreen />);
    const list = await screen.findByRole("list", { name: "Mes documents" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).getByText("PDF prêt")).toBeTruthy();
    expect(within(list).getByText("PDF en échec")).toBeTruthy();
    expect(within(list).getByText("Document révoqué : Erreur de saisie")).toBeTruthy();
    expect(within(list).getAllByRole("link", { name: "Page de vérification publique" })).toHaveLength(3);
    expect(within(list).getAllByRole("button", { name: /Télécharger le PDF — / })).toHaveLength(2);
    expect(within(list).queryByRole("button", { name: /Relancer/ })).toBeNull();
    expect(within(list).getByText(/Contactez le secrétariat/)).toBeTruthy();
  });

  it("tuteur : documents de chaque enfant ; état vide pour un enfant sans document", async () => {
    setTestApi({
      ...accessRoutes(["higher.child.read", "student.child.read"]),
      "GET /api/v1/people/children": { items: [studentSummary({ id: uuid(3001), displayName: "AKA Marie" }), studentSummary({ id: uuid(3002), displayName: "AKA Paul" })] },
      [`GET ${H}/children/${uuid(3001)}/documents`]: { items: [document(1, { publishedAt: "2026-10-01T08:00:00.000Z" })] },
      [`GET ${H}/children/${uuid(3002)}/documents`]: { items: [] },
    });
    renderWithProviders(<MyDocumentsScreen />);
    expect(await screen.findByRole("heading", { name: "Documents de AKA Marie" })).toBeTruthy();
    expect(await screen.findByRole("list", { name: "Documents de AKA Marie" })).toBeTruthy();
    expect(await screen.findByText("Aucun document publié.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Mes documents" })).toBeNull();
  });

  it("enfant d'un autre tuteur : le refus de l'API est affiché ; sans permission : accès refusé", async () => {
    setTestApi({
      ...accessRoutes(["higher.child.read"]),
      "GET /api/v1/people/children": { items: [studentSummary({ id: uuid(3001), displayName: "AKA Marie" })] },
      [`GET ${H}/children/${uuid(3001)}/documents`]: () => json({ code: "higher.not_guardian", message: "Cet étudiant n'est pas lié à votre compte." }, { status: 403 }),
    });
    const { unmount } = renderWithProviders(<MyDocumentsScreen />);
    expect(await screen.findByText("Cet étudiant n'est pas lié à votre compte.")).toBeTruthy();
    unmount();
    setTestApi({ ...accessRoutes([]) });
    renderWithProviders(<MyDocumentsScreen />);
    expect(await screen.findByText("Vous n'avez pas les droits nécessaires pour cette action.")).toBeTruthy();
  });
});
