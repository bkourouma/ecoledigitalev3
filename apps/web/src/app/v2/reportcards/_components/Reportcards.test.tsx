// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { classroom, period } from "../../_test/fixtures";
import { VerifyScreen, normalizeCode } from "../../verify/_components/VerifyScreen";
import { batch, branding, card, config, detail, preflight, signatory, template, uuid, verification } from "../_test/fixtures";
import { CardDetail } from "./CardDetail";
import { CardsScreen } from "./CardsScreen";
import { FamilyScreen } from "./FamilyScreen";
import { IdentityScreen } from "./IdentityScreen";
import { IssueScreen } from "./IssueScreen";
import { SignatoriesScreen } from "./SignatoriesScreen";
import { TemplatesScreen, optionsOf } from "./TemplatesScreen";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);

const C = uuid(500);
const P = uuid(200);
const R = "/api/v1/reportcards";
const CODE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const academic = (extra: Record<string, unknown> = {}) => ({
  [`GET /api/v1/academic/classrooms/${C}`]: classroom(),
  "GET /api/v1/academic/classrooms": { items: [classroom()], total: 1, page: 1, pageSize: 200 },
  [`GET /api/v1/academic/years/${uuid(100)}/periods`]: { items: [period()] },
  ...extra,
});

afterEach(() => vi.restoreAllMocks());

describe("IssueScreen — génération par lot", () => {
  const routes = (perms: string[], extra: Record<string, unknown> = {}) => ({ ...accessRoutes(perms), ...academic(), [`GET ${R}/preflight`]: preflight(), ...extra });

  it("manque bloquant : liste avec lien de correction et aucune génération possible", async () => {
    setTestApi(routes(["reportcard.generate"], { [`GET ${R}/preflight`]: preflight({ ok: false, issues: [{ code: "reportcards.no_branding", message: "L'identité de l'établissement n'est pas renseignée.", blocking: true, fixHref: "/v2/reportcards/identity" }, { code: "reportcards.no_deliberation", message: "Aucune délibération tenue.", blocking: false, fixHref: null }], enrollments: { total: 3, eligible: 2, excluded: 1 } }) }));
    renderWithProviders(<IssueScreen initialClassroomId={C} initialPeriodId={P} />);
    expect(await screen.findByText("Au moins un point bloquant empêche l'émission.")).toBeTruthy();
    expect(screen.getByText("L'identité de l'établissement n'est pas renseignée.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Corriger" }).getAttribute("href")).toBe("/v2/reportcards/identity");
    expect(screen.getByTestId("preflight-counts").textContent).toBe("3 inscriptions : 2 éligibles, 1 exclues.");
    expect((screen.getByRole("button", { name: "Générer les bulletins" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("génère le lot (corps exact), suit la progression, reprend les exclus et publie le lot", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const api = setTestApi(
      routes(["reportcard.generate", "reportcard.publish", "reportcard.read"], {
        [`POST ${R}/batches`]: () => json(batch({ status: "COMPLETED_WITH_ERRORS", issued: 2, excluded: 1, rendered: 1, items: [{ enrollmentId: uuid(2003), outcome: "EXCLUDED", reasonCode: "no_result", message: "Aucun résultat final pour cette inscription.", reportCardId: null }, { enrollmentId: uuid(2001), outcome: "ISSUED", reasonCode: null, message: null, reportCardId: uuid(7001) }] }), { status: 202 }),
        [`POST ${R}/batches/${uuid(7200)}/retry`]: () => json({}),
        [`POST ${R}/publish`]: () => json({ published: 2, alreadyPublished: 0, skipped: [] }),
        [`GET ${R}/batches/${uuid(7200)}`]: batch({ status: "COMPLETED_WITH_ERRORS", issued: 2, excluded: 1, rendered: 1, items: [{ enrollmentId: uuid(2003), outcome: "EXCLUDED", reasonCode: "no_result", message: "Aucun résultat final pour cette inscription.", reportCardId: null }, { enrollmentId: uuid(2001), outcome: "ISSUED", reasonCode: null, message: null, reportCardId: uuid(7001) }] }),
        [`GET ${R}/classrooms/${C}/periods/${P}/pdf`]: { url: "https://stockage.example/combined.pdf", expiresAt: "2026-10-01T08:05:00.000Z", fileName: "classe.pdf", contentType: "application/pdf", sizeBytes: 100, pdfHash: null },
      }),
    );
    renderWithProviders(<IssueScreen initialClassroomId={C} initialPeriodId={P} />);
    await screen.findByText("Tout est prêt : vous pouvez générer les bulletins.");
    fireEvent.click(await screen.findByRole("button", { name: "Générer les bulletins" }));
    await screen.findByTestId("batch-counts");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ classroomId: C, academicPeriodId: P, kind: "REPORT_CARD" });
    expect(screen.getByTestId("batch-counts").textContent).toBe("2 émis sur 3 — 1 exclus, 0 en échec.");
    expect(screen.getByTestId("render-counts").textContent).toBe("1 PDF prêts sur 2 bulletins émis.");
    expect(screen.getByText("Aucun résultat final pour cette inscription.")).toBeTruthy();
    // PDF combiné : l'URL signée est ouverte à la demande
    fireEvent.click(screen.getByRole("button", { name: "PDF de la classe" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://stockage.example/combined.pdf", "_blank", "noopener,noreferrer"));
    // PDF en échec : relance ; reprise du lot : même POST (idempotent)
    fireEvent.click(screen.getByRole("button", { name: "Relancer les PDF en échec" }));
    await screen.findByText("La génération des PDF est relancée.");
    fireEvent.click(screen.getByRole("button", { name: "Reprendre le lot" }));
    await screen.findByText("Le lot est repris : seules les inscriptions non émises sont retraitées.");
    expect(api.calls.filter((c) => c.method === "POST" && c.path === `${R}/batches`)).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Publier le lot aux familles" }));
    await screen.findByText("2 publiés, 0 déjà publiés, 0 non publiés.");
    expect(api.calls.find((c) => c.path === `${R}/publish`)!.body).toEqual({ batchId: uuid(7200) });
  });

  it("réémission : motif exigé (5 caractères) avant l'envoi", async () => {
    const api = setTestApi(routes(["reportcard.generate"], { [`POST ${R}/batches`]: () => json(batch(), { status: 202 }), [`GET ${R}/batches/${uuid(7200)}`]: batch() }));
    renderWithProviders(<IssueScreen initialClassroomId={C} initialPeriodId={P} />);
    await screen.findByText("Tout est prêt : vous pouvez générer les bulletins.");
    fireEvent.click(screen.getByRole("checkbox", { name: /Réémettre les bulletins dont les résultats ont changé/ }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Générer les bulletins" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Générer les bulletins" }));
    expect(await screen.findByText("Le motif doit faire au moins 5 caractères.")).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText(/Motif de la réémission/), { target: { value: "Notes corrigées" } });
    fireEvent.click(screen.getByRole("button", { name: "Générer les bulletins" }));
    await screen.findByTestId("batch-counts");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ classroomId: C, academicPeriodId: P, kind: "REPORT_CARD", reissueReason: "Notes corrigées" });
  });

  it("lot en cours : barres de progression annoncées ; erreur du contrôle préalable avec Réessayer", async () => {
    setTestApi(routes(["reportcard.generate"], { [`POST ${R}/batches`]: () => json(batch({ status: "RENDERING", issued: 3, rendered: 1, combinedPdfReady: false }), { status: 202 }), [`GET ${R}/batches/${uuid(7200)}`]: batch({ status: "RENDERING", issued: 3, rendered: 1, combinedPdfReady: false }) }));
    const { unmount } = renderWithProviders(<IssueScreen initialClassroomId={C} initialPeriodId={P} />);
    await screen.findByText("Tout est prêt : vous pouvez générer les bulletins.");
    fireEvent.click(await screen.findByRole("button", { name: "Générer les bulletins" }));
    const bar = await screen.findByRole("progressbar", { name: "PDF générés" });
    expect(bar.getAttribute("aria-valuenow")).toBe("33");
    expect(screen.queryByRole("button", { name: "Publier le lot aux familles" })).toBeNull();
    unmount();
    setTestApi(routes(["reportcard.generate"], { [`GET ${R}/preflight`]: () => json({ code: "reportcards.port_unavailable", message: "Les résultats ne sont pas disponibles." }, { status: 503 }) }));
    renderWithProviders(<IssueScreen initialClassroomId={C} initialPeriodId={P} />);
    // une erreur serveur (5xx) est relue une fois par react-query avant d'être affichée
    expect((await screen.findByRole("alert", {}, { timeout: 4000 })).textContent).toContain("Une erreur est survenue");
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeTruthy();
  });
});

describe("CardsScreen — liste, publication, retrait, réémission, révocation", () => {
  const ALL = ["reportcard.read", "reportcard.publish", "reportcard.generate", "reportcard.revoke"];
  const routes = (perms: string[], extra: Record<string, unknown> = {}) => ({
    ...accessRoutes(perms),
    ...academic(),
    [`GET ${R}/report-cards`]: { items: [card(1), card(2, { status: "PUBLISHED", publishedAt: "2026-10-02T08:00:00.000Z" }), card(3, { renderStatus: "FAILED" })], nextCursor: null },
    ...extra,
  });

  it("affiche états et rendus, propose les actions de l'état (publication seulement si le PDF est prêt)", async () => {
    const api = setTestApi(routes(ALL));
    renderWithProviders(<CardsScreen initialClassroomId={C} initialPeriodId={P} />);
    const table = await screen.findByRole("table", { name: "Bulletins émis" });
    const aka = (await within(table).findByRole("rowheader", { name: /Aka Marie/ })).closest("tr")!;
    expect(within(aka).getByText("Émis")).toBeTruthy();
    expect(within(aka).getByText("PDF prêt")).toBeTruthy();
    await waitFor(() => expect(within(aka).getByRole("button", { name: "Publier le bulletin de Aka Marie" })).toBeTruthy());
    const bamba = within(table).getByRole("rowheader", { name: /Bamba Yao/ }).closest("tr")!;
    expect(within(bamba).getByRole("button", { name: "Retirer le bulletin de Bamba Yao" })).toBeTruthy();
    const coulibaly = within(table).getByRole("rowheader", { name: /Coulibaly Awa/ }).closest("tr")!;
    expect(within(coulibaly).getByText("PDF en échec")).toBeTruthy();
    expect(within(coulibaly).getByRole("button", { name: "Relancer le PDF de Coulibaly Awa" })).toBeTruthy();
    expect((within(coulibaly).getByRole("button", { name: "Publier le bulletin de Coulibaly Awa" }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.calls.find((c) => c.path === `${R}/report-cards`)!.query).toMatchObject({ classroomId: C, academicPeriodId: P, live: "true" });
  });

  it("publier puis retirer un bulletin", async () => {
    const api = setTestApi(routes(ALL, { [`POST ${R}/report-cards/${uuid(7001)}/publish`]: () => json(card(1, { status: "PUBLISHED" })), [`POST ${R}/report-cards/${uuid(7002)}/withdraw`]: () => json(card(2, { status: "ISSUED" })) }));
    renderWithProviders(<CardsScreen initialClassroomId={C} initialPeriodId={P} />);
    fireEvent.click(await screen.findByRole("button", { name: "Publier le bulletin de Aka Marie" }));
    await screen.findByText("Le bulletin de Aka Marie est publié.");
    fireEvent.click(await screen.findByRole("button", { name: "Retirer le bulletin de Bamba Yao" }));
    await screen.findByText("Le bulletin de Bamba Yao est retiré de la publication.");
    expect(api.calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual([`${R}/report-cards/${uuid(7001)}/publish`, `${R}/report-cards/${uuid(7002)}/withdraw`]);
  });

  it("réémission et révocation exigent un motif de 5 caractères au moins ; refus de l'API affiché", async () => {
    const api = setTestApi(
      routes(ALL, {
        [`POST ${R}/report-cards/${uuid(7001)}/reissue`]: () => json(card(1, { version: 2 }), { status: 201 }),
        [`POST ${R}/report-cards/${uuid(7002)}/revoke`]: () => json({ code: "reportcards.mfa_required", message: "Une authentification forte est requise pour révoquer." }, { status: 403 }),
      }),
    );
    renderWithProviders(<CardsScreen initialClassroomId={C} initialPeriodId={P} />);
    fireEvent.click(await screen.findByRole("button", { name: "Réémettre le bulletin de Aka Marie" }));
    let dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif/), { target: { value: "no" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Réémettre" }));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Motif/), { target: { value: "Correction de la note de physique" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Réémettre" }));
    await screen.findByText("Le bulletin de Aka Marie est réémis.");
    expect(api.calls.find((c) => c.path.endsWith("/reissue"))!.body).toEqual({ reason: "Correction de la note de physique" });

    fireEvent.click(await screen.findByRole("button", { name: "Révoquer le bulletin de Bamba Yao" }));
    dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif/), { target: { value: "Bulletin émis par erreur" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Révoquer" }));
    // Élévation d'authentification : code TOTP demandé ; annuler laisse le message du serveur dans la boîte de dialogue.
    const stepUp = await screen.findByRole("dialog", { name: "Confirmez votre identité" });
    fireEvent.click(within(stepUp).getByRole("button", { name: "Annuler" }));
    await within(dialog).findByText("Une authentification forte est requise pour révoquer.");
  });

  it("téléchargement contrôlé : l'URL signée est demandée à l'API puis ouverte, jamais affichée", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    setTestApi(routes(ALL, { [`GET ${R}/report-cards/${uuid(7001)}/pdf`]: { url: "https://stockage.example/signed?token=abc", expiresAt: "2026-10-01T08:05:00.000Z", fileName: "b.pdf", contentType: "application/pdf", sizeBytes: 10, pdfHash: null } }));
    renderWithProviders(<CardsScreen initialClassroomId={C} initialPeriodId={P} />);
    fireEvent.click(await screen.findByRole("button", { name: "Télécharger le bulletin de Aka Marie" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://stockage.example/signed?token=abc", "_blank", "noopener,noreferrer"));
    expect(screen.queryByText(/token=abc/)).toBeNull();
  });

  it("téléchargement refusé : le message de l'API est affiché sous le bouton", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    setTestApi(routes(ALL, { [`GET ${R}/report-cards/${uuid(7001)}/pdf`]: () => json({ code: "reportcards.render_not_ready", message: "Le PDF n'est pas encore prêt." }, { status: 409 }) }));
    renderWithProviders(<CardsScreen initialClassroomId={C} initialPeriodId={P} />);
    fireEvent.click(await screen.findByRole("button", { name: "Télécharger le bulletin de Aka Marie" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Le PDF n'est pas encore prêt.");
    expect(open).not.toHaveBeenCalled();
  });

  it("publication de la sélection (corps : identifiants) ; sans droit de publier, aucune sélection", async () => {
    const api = setTestApi(routes(ALL, { [`POST ${R}/publish`]: () => json({ published: 1, alreadyPublished: 0, skipped: [] }) }));
    const { unmount } = renderWithProviders(<CardsScreen initialClassroomId={C} initialPeriodId={P} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Sélectionner le bulletin de Aka Marie" }));
    fireEvent.click(await screen.findByRole("button", { name: "Publier la sélection" }));
    await screen.findByText("1 publiés, 0 déjà publiés, 0 non publiés.");
    expect(api.calls.find((c) => c.path === `${R}/publish`)!.body).toEqual({ reportCardIds: [uuid(7001)] });
    unmount();
    setTestApi(routes(["reportcard.read"]));
    renderWithProviders(<CardsScreen initialClassroomId={C} initialPeriodId={P} />);
    await screen.findByRole("rowheader", { name: /Aka Marie/ });
    expect(screen.queryByRole("checkbox", { name: /Sélectionner le bulletin/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Publier/ })).toBeNull();
  });

  it("états vide et erreur", async () => {
    setTestApi(routes(ALL, { [`GET ${R}/report-cards`]: { items: [], nextCursor: null } }));
    const { unmount } = renderWithProviders(<CardsScreen />);
    expect(await screen.findByText("Aucun bulletin.")).toBeTruthy();
    unmount();
    setTestApi(routes(ALL, { [`GET ${R}/report-cards`]: () => json({ code: "FORBIDDEN", message: "Accès refusé aux bulletins." }, { status: 403 }) }));
    renderWithProviders(<CardsScreen />);
    expect((await screen.findByRole("alert")).textContent).toContain("Accès refusé aux bulletins.");
  });
});

describe("CardDetail", () => {
  it("résumé du snapshot (libellés figés), QR de vérification, générations du PDF ; trace à la demande (audit)", async () => {
    setTestApi({
      ...accessRoutes(["reportcard.read", "reportcard.explain"]),
      [`GET ${R}/report-cards/${uuid(7001)}`]: detail(),
      [`GET ${R}/report-cards/${uuid(7001)}/explain`]: { reportCardId: uuid(7001), snapshotHash: "a".repeat(64), explain: [{ lineCode: "UE1", rules: [{ key: "moyenne_ue", position: 0, inputs: {}, output: "12.25" }] }] },
    });
    renderWithProviders(<CardDetail id={uuid(7001)} />);
    expect(await screen.findByText("Assez bien")).toBeTruthy();
    expect(screen.getByText("Admis")).toBeTruthy();
    expect(screen.getByText("2 sur 30")).toBeTruthy();
    expect(screen.getByText("Séance du 30 sept. 2026", { exact: false })).toBeTruthy();
    expect(screen.getByTestId("verification-code").textContent).toBe(CODE);
    await waitFor(() => expect(screen.getByRole("img", { name: "QR code du lien de vérification" })).toBeTruthy());
    expect(screen.getByRole("link", { name: "Ouvrir la page de vérification" }).getAttribute("href")).toBe(`/v2/verify/${CODE}`);
    expect(screen.getByText("1 tentative")).toBeTruthy();
    // trace : jamais chargée sans action explicite
    fireEvent.click(screen.getByRole("button", { name: "Afficher la trace" }));
    expect(await screen.findByText("moyenne_ue = 12.25")).toBeTruthy();
  });

  it("bulletin révoqué ou remplacé : bannière ; erreur 404 de l'API restituée", async () => {
    setTestApi({ ...accessRoutes(["reportcard.read"]), [`GET ${R}/report-cards/${uuid(7001)}`]: detail({ status: "REVOKED", revokedAt: "2026-10-03T08:00:00.000Z" }) });
    const { unmount } = renderWithProviders(<CardDetail id={uuid(7001)} />);
    expect(await screen.findByText(/Ce bulletin a été révoqué le/)).toBeTruthy();
    unmount();
    setTestApi({ ...accessRoutes(["reportcard.read"]), [`GET ${R}/report-cards/${uuid(7001)}`]: () => json({ code: "reportcards.not_found", message: "Bulletin introuvable." }, { status: 404 }) });
    renderWithProviders(<CardDetail id={uuid(7001)} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Bulletin introuvable.");
  });
});

describe("FamilyScreen — bulletins de mes enfants", () => {
  it("regroupe par enfant, téléchargement contrôlé, mention de journalisation", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    setTestApi({
      ...accessRoutes(["reportcard.child.read"]),
      [`GET ${R}/me/report-cards`]: { items: [card(1, { status: "PUBLISHED", publishedAt: "2026-10-02T08:00:00.000Z" }), card(2, { status: "PUBLISHED", publishedAt: "2026-10-02T08:00:00.000Z" })], nextCursor: null },
      [`GET ${R}/report-cards/${uuid(7001)}/pdf`]: { url: "https://stockage.example/a.pdf", expiresAt: "2026-10-01T08:05:00.000Z", fileName: "a.pdf", contentType: "application/pdf", sizeBytes: 1, pdfHash: null },
    });
    renderWithProviders(<FamilyScreen />);
    expect(await screen.findByRole("heading", { name: "Aka Marie" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Bamba Yao" })).toBeTruthy();
    expect(screen.getByText(/Chaque téléchargement est journalisé/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Télécharger Bulletin du semestre 1 de Aka Marie" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://stockage.example/a.pdf", "_blank", "noopener,noreferrer"));
  });

  it("aucun bulletin publié : état vide ; refus : message de l'API", async () => {
    setTestApi({ ...accessRoutes(["reportcard.self.read"]), [`GET ${R}/me/report-cards`]: { items: [], nextCursor: null } });
    const { unmount } = renderWithProviders(<FamilyScreen />);
    expect(await screen.findByText("Aucun bulletin publié.")).toBeTruthy();
    unmount();
    setTestApi({ ...accessRoutes(["reportcard.self.read"]), [`GET ${R}/me/report-cards`]: () => json({ code: "FORBIDDEN", message: "Aucun profil lié à votre compte." }, { status: 403 }) });
    renderWithProviders(<FamilyScreen />);
    expect((await screen.findByRole("alert")).textContent).toContain("Aucun profil lié à votre compte.");
  });
});

describe("VerifyScreen — page publique", () => {
  const verifyPath = (code = CODE) => `GET /api/v1/public/verify/${code}`;

  it("document authentique : statut, établissement, intitulé, date — et aucune donnée personnelle", async () => {
    const api = setTestApi({ [verifyPath()]: verification() });
    renderWithProviders(<VerifyScreen initialCode="abcdefghij klmnopqrs-tuvwxyz" />);
    expect(await screen.findByText("Document authentique")).toBeTruthy();
    expect(screen.getByText("Université test")).toBeTruthy();
    expect(screen.getByText("Bulletin du semestre 1")).toBeTruthy();
    expect(screen.queryByText(/Mention/)).toBeNull();
    const request = api.calls.find((c) => c.path.startsWith("/api/v1/public/verify/"))!;
    expect(request.path).toBe(`/api/v1/public/verify/${CODE}`); // espaces et tirets ignorés, majuscules
    expect(request.headers["x-tenant"]).toBeUndefined(); // aucun établissement imposé
    expect(request.headers.authorization).toBeUndefined(); // aucun jeton
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/Aka|ELV-001/);
  });

  it("remplacé, révoqué : message explicite ; mention seulement si l'établissement l'a activée", async () => {
    setTestApi({ [verifyPath()]: verification({ status: "SUPERSEDED", supersededByIssuedAt: "2026-10-05T08:00:00.000Z", mention: "Assez bien" }) });
    const { unmount } = renderWithProviders(<VerifyScreen initialCode={CODE} />);
    expect(await screen.findByText("Document remplacé par une version plus récente")).toBeTruthy();
    expect(screen.getByText(/Une version plus récente de ce document a été émise le/)).toBeTruthy();
    expect(screen.getByText("Assez bien")).toBeTruthy();
    unmount();
    setTestApi({ [verifyPath()]: verification({ status: "REVOKED", revokedAt: "2026-10-06T08:00:00.000Z" }) });
    renderWithProviders(<VerifyScreen initialCode={CODE} />);
    expect(await screen.findByText("Document révoqué")).toBeTruthy();
    expect(screen.getByText(/Ce document a été révoqué le/)).toBeTruthy();
  });

  it("code inconnu, mal formé ou trop long : une seule et même réponse (404)", async () => {
    setTestApi({ [verifyPath("ZZZ")]: () => json(verification({ status: "UNKNOWN", documentKind: null, institutionName: null, title: null, issuedAt: null, keyId: null, keyFingerprint: null, snapshotHash: null, signature: null, message: "Document inconnu." }), { status: 404 }) });
    renderWithProviders(<VerifyScreen />);
    fireEvent.change(screen.getByLabelText(/Code de vérification/), { target: { value: "zzz" } });
    fireEvent.click(screen.getByRole("button", { name: "Vérifier" }));
    expect(await screen.findByText(/Aucun document ne correspond à ce code/)).toBeTruthy();
    expect(screen.queryByText("Université test")).toBeNull();
  });

  it("limitation de débit : message technique, pas de verdict", async () => {
    setTestApi({ [verifyPath()]: () => json({ code: "reportcards.rate_limited", message: "Trop de vérifications. Réessayez dans une minute." }, { status: 429 }) });
    renderWithProviders(<VerifyScreen initialCode={CODE} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Trop de requêtes");
  });

  it("comparaison d'un PDF : envoi du fichier brut (application/pdf), verdict, refus d'un fichier non PDF", async () => {
    setTestApi({});
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ match: true, status: "AUTHENTIC", institutionName: "Université test", title: "Bulletin du semestre 1", issuedAt: "2026-10-01T08:00:00.000Z", message: "Le fichier est identique au document émis." }), { status: 200, headers: { "content-type": "application/json" } }));
    renderWithProviders(<VerifyScreen />);
    const input = screen.getByLabelText(/Fichier PDF/) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] } });
    expect(await screen.findByText("Le fichier doit être au format PDF.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { files: [new File(["%PDF-1.7"], "bulletin.pdf", { type: "application/pdf" })] } });
    expect(await screen.findByText("Fichier identique")).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/api/v1/public/verify/upload");
    expect((init as RequestInit).method).toBe("POST");
    expect(((init as RequestInit).headers as Record<string, string>)["Content-Type"]).toBe("application/pdf");
  });

  it("normalisation du code saisi", () => {
    expect(normalizeCode(" abcd-efgh ijkl ")).toBe("ABCDEFGHIJKL");
  });
});

describe("IdentityScreen", () => {
  it("valide le nom officiel (contrat) puis envoie l'identité ; réglages enregistrés à la volée", async () => {
    const api = setTestApi({
      ...accessRoutes(["reportcard.branding.manage"], ["reportcard.block-unpaid"]),
      "GET /api/v1/tenancy/institutions": { items: [] },
      [`GET ${R}/branding`]: { items: [] },
      [`PUT ${R}/branding`]: () => json(branding({ version: 1 })),
      [`GET ${R}/settings`]: { blockIfUnpaid: false, requireDeliberation: true, verificationShowsMention: false, updatedAt: null },
      [`PUT ${R}/settings`]: () => json({ blockIfUnpaid: false, requireDeliberation: true, verificationShowsMention: true, updatedAt: null }),
    });
    renderWithProviders(<IdentityScreen />);
    expect(await screen.findByText(/Aucune identité n'est encore renseignée/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer l'identité" }));
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText(/Nom officiel/), { target: { value: "Université test" } });
    fireEvent.change(screen.getByLabelText(/En-tête gauche/), { target: { value: "République\n\nMinistère" } });
    fireEvent.change(screen.getByLabelText(/Couleur principale/), { target: { value: "#112233" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer l'identité" }));
    await screen.findByText("L'identité est enregistrée (version 1).");
    expect(api.calls.find((c) => c.path === `${R}/branding` && c.method === "PUT")!.body).toEqual({
      institutionId: null,
      legalName: "Université test",
      shortName: null,
      headerLeft: ["République", "Ministère"],
      headerRight: [],
      address: null,
      phone: null,
      email: null,
      website: null,
      registrationRef: null,
      logoObjectKey: null,
      emblemObjectKey: null,
      primaryColor: "#112233",
      secondaryColor: null,
      footerText: null,
    });
    fireEvent.click(await screen.findByRole("checkbox", { name: /Afficher la mention sur la page publique/ }));
    await screen.findByText("Réglage enregistré.");
    expect(api.calls.find((c) => c.path === `${R}/settings` && c.method === "PUT")!.body).toEqual({ verificationShowsMention: true });
    expect(screen.getByRole("checkbox", { name: /Bloquer l'accès aux bulletins en cas d'impayé/ })).toBeTruthy();
  });

  it("option « bloquer si impayé » masquée quand elle n'est pas incluse dans l'offre", async () => {
    setTestApi({
      ...accessRoutes(["reportcard.branding.manage"], []),
      "GET /api/v1/tenancy/institutions": { items: [] },
      [`GET ${R}/branding`]: { items: [branding()] },
      [`GET ${R}/settings`]: { blockIfUnpaid: false, requireDeliberation: false, verificationShowsMention: false, updatedAt: null },
    });
    renderWithProviders(<IdentityScreen />);
    await screen.findByText(/Version 1 enregistrée le/);
    await screen.findByRole("checkbox", { name: /Exiger une délibération/ });
    expect(screen.queryByRole("checkbox", { name: /Bloquer l'accès aux bulletins/ })).toBeNull();
  });
});

describe("SignatoriesScreen", () => {
  it("crée un signataire (contrat Zod, corps exact) et désactive un signataire", async () => {
    const api = setTestApi({
      ...accessRoutes(["reportcard.signatory.manage"]),
      [`GET ${R}/signatories`]: { items: [signatory()] },
      [`POST ${R}/signatories`]: ({ body }) => json(signatory({ id: uuid(7301), fullName: (body as { fullName: string }).fullName }), { status: 201 }),
      [`PATCH ${R}/signatories/${uuid(7300)}`]: () => json(signatory({ active: false })),
    });
    renderWithProviders(<SignatoriesScreen />);
    expect(await screen.findByText("M. Konan")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Nouveau signataire" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer le signataire" }));
    await waitFor(() => expect(within(dialog).getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Nom complet/), { target: { value: "Mme Yao" } });
    fireEvent.change(within(dialog).getByLabelText(/Qualité/), { target: { value: "La Secrétaire générale" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer le signataire" }));
    await screen.findByText("Le signataire Mme Yao est enregistré.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ fullName: "Mme Yao", title: "La Secrétaire générale", jobFunction: null, validFrom: null, validTo: null, signatureObjectKey: null });
    fireEvent.click(screen.getByRole("button", { name: "Désactiver M. Konan" }));
    await screen.findByText("Le signataire M. Konan est désactivé.");
    expect(api.calls.find((c) => c.method === "PATCH")!.body).toEqual({ active: false });
  });

  it("état vide", async () => {
    setTestApi({ ...accessRoutes(["reportcard.signatory.manage"]), [`GET ${R}/signatories`]: { items: [] } });
    renderWithProviders(<SignatoriesScreen />);
    expect(await screen.findByText("Aucun signataire.")).toBeTruthy();
  });
});

describe("TemplatesScreen", () => {
  it("configure un modèle : options lues du schéma du modèle, signataire par emplacement, corps exact", async () => {
    const api = setTestApi({
      ...accessRoutes(["reportcard.template.manage"]),
      [`GET ${R}/templates`]: { items: [template()] },
      [`GET ${R}/template-configs`]: { items: [] },
      [`GET ${R}/signatories`]: { items: [signatory()] },
      [`PUT ${R}/template-configs`]: () => json(config()),
    });
    renderWithProviders(<TemplatesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Configurer le modèle de Bulletin" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer la configuration" }));
    await waitFor(() => expect(within(dialog).getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Niveau d'enseignement/), { target: { value: "HIGHER" } });
    fireEvent.change(within(dialog).getByLabelText(/^Modèle/), { target: { value: "bulletin-lmd" } });
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: "Afficher le rang" }));
    fireEvent.change(within(dialog).getByLabelText(/Densité/), { target: { value: "compact" } });
    await within(dialog).findByRole("option", { name: /M\. Konan/ });
    fireEvent.change(within(dialog).getByLabelText(/Direction/), { target: { value: uuid(7300) } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer la configuration" }));
    await screen.findByText("La configuration est enregistrée.");
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({
      documentKind: "REPORT_CARD",
      pack: "HIGHER",
      templateKey: "bulletin-lmd",
      options: { showRank: true, density: "compact" },
      signatureAssignments: [{ slot: "director", signatoryId: uuid(7300) }],
    });
  });

  it("aperçu : le HTML est affiché dans un cadre isolé (sandbox sans permission)", async () => {
    setTestApi({
      ...accessRoutes(["reportcard.template.manage"]),
      [`GET ${R}/templates`]: { items: [template()] },
      [`GET ${R}/template-configs`]: { items: [config()] },
      [`POST ${R}/template-configs/preview`]: () => json({ html: "<p>Aperçu</p><script>alert(1)</script>", pdfBase64: null, templateKey: "bulletin-lmd", templateVersion: 1 }),
    });
    renderWithProviders(<TemplatesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Aperçu du modèle de Bulletin" }));
    const frame = (await screen.findByTitle("Aperçu du modèle")) as HTMLIFrameElement;
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("srcdoc")).toContain("Aperçu");
  });

  it("optionsOf : types simples seulement", () => {
    expect(optionsOf({ properties: { a: { type: "boolean" }, b: { type: "integer", title: "B" }, c: { type: "array" }, d: { type: "string", enum: ["x", 3] } } })).toEqual({ a: { type: "boolean", title: "a" }, b: { type: "number", title: "B" }, d: { type: "string", title: "d", enum: ["x"] } });
  });
});
