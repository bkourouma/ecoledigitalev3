// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { apiErrorBody, archive, HASH, ID, myClassroom, NOW, P, review, reviewId } from "../_test/fixtures";
import { permissionsLoaded } from "../_test/helpers";
import { ArchivesScreen } from "./ArchivesScreen";
import { ReviewsScreen } from "./ReviewsScreen";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);

const REVIEWS = `GET ${P}/annual-reviews`;

function reviewRoutes(over: Record<string, unknown> = {}, permissions: string[] = ["primary.bilan.read", "primary.bilan.prepare", "primary.bilan.seal", "primary.bilan.reissue"]) {
  return {
    ...accessRoutes(permissions, ["primary.annual-review"]),
    [`GET ${P}/my-classrooms`]: { items: [myClassroom()] },
    [`GET ${P}/rule-banner`]: { ruleSourceKind: "placeholder", isPlaceholder: true },
    [REVIEWS]: {
      items: [review(1, { status: "READY" }), review(2, { status: "SEALED", contentHash: HASH, sealedAt: NOW }), review(3, { status: "SUPERSEDED", version: 1 })],
    },
    ...over,
  };
}

async function openReviews(ready: string | null = "Préparer les brouillons") {
  renderWithProviders(<ReviewsScreen />);
  await screen.findByRole("table", { name: "Bilans annuels de la classe" });
  if (ready) await screen.findByRole("button", { name: ready });
}

describe("Bilans annuels", () => {
  it("liste statuts, version, empreinte et mention des règles de démonstration", async () => {
    setTestApi(reviewRoutes());
    await openReviews();
    const table = screen.getByRole("table", { name: "Bilans annuels de la classe" });
    expect(within(table).getByText("Prêt à sceller")).toBeTruthy();
    expect(within(table).getByText("Scellé")).toBeTruthy();
    expect(within(table).getByText("Remplacé par une version plus récente")).toBeTruthy();
    expect(within(table).getByText("aaaaaaaaaaaa…")).toBeTruthy();
    expect(within(table).getAllByText("Règles de démonstration").length).toBe(3);
    // Bandeau permanent + mention de la constante du contrat.
    expect(screen.getAllByText("Règles de démonstration — document sans valeur officielle").length).toBeGreaterThan(0);
  });

  it("sceller : confirmation, puis les manques renvoyés par l'API en 409 sont affichés", async () => {
    let attempts = 0;
    const api = setTestApi(
      reviewRoutes({
        [`POST ${P}/annual-reviews/${reviewId(1)}/seal`]: () => {
          attempts += 1;
          if (attempts === 1)
            return json(
              apiErrorBody("primary_school.review_needs_decision", "Le bilan ne se scelle qu'avec la décision du conseil des maîtres.", {
                details: { blockers: [{ code: "primary_school.review_needs_decision", message: "La décision du conseil n'est pas confirmée." }, { code: "primary_school.review_needs_results", message: "Une période de l'année n'est pas close." }] },
              }),
              { status: 409 },
            );
          return json(review(1, { status: "SEALED", contentHash: HASH, sealedAt: NOW }));
        },
      }),
    );
    await openReviews();
    fireEvent.click(screen.getByRole("button", { name: "Sceller le bilan de Aka Marie" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Le bilan devient immuable/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Sceller le bilan" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain("Le bilan ne se scelle qu'avec la décision du conseil des maîtres.");
    expect(alert.textContent).toContain("La décision du conseil n'est pas confirmée.");
    expect(alert.textContent).toContain("Une période de l'année n'est pas close.");
    // Rien n'a été scellé : on peut corriger puis réessayer.
    fireEvent.click(within(dialog).getByRole("button", { name: "Sceller le bilan" }));
    await screen.findByText("Bilan de Aka Marie scellé.");
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(2);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("réémettre : motif de 10 caractères au moins, version n+1", async () => {
    const api = setTestApi(reviewRoutes({ [`POST ${P}/annual-reviews/${reviewId(2)}/reissue`]: () => json(review(2, { status: "DRAFT", version: 2, supersedesId: reviewId(2), supersedeReason: "Erreur de saisie corrigée" }), { status: 201 }) }));
    await openReviews();
    fireEvent.click(screen.getByRole("button", { name: "Réémettre le bilan de Bamba Yao" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif de la réémission/), { target: { value: "court" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Réémettre" }));
    await waitFor(() => expect(within(dialog).getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Motif de la réémission/), { target: { value: "Erreur de saisie corrigée" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Réémettre" }));
    await screen.findByText(/Nouvelle version du bilan de Bamba Yao créée/);
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ reason: "Erreur de saisie corrigée" });
  });

  it("les actions sensibles sont masquées sans permission (seule la lecture reste)", async () => {
    const api = setTestApi(reviewRoutes({}, ["primary.bilan.read"]));
    await openReviews(null);
    await screen.findByText("Scellé");
    await permissionsLoaded(api);
    expect(screen.queryByRole("button", { name: "Préparer les brouillons" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Sceller le bilan de/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Réémettre le bilan de/ })).toBeNull();
  });

  it("prépare les brouillons d'une classe et d'une année", async () => {
    const api = setTestApi(reviewRoutes({ [`POST ${P}/annual-reviews/prepare`]: () => json({ created: 3, refreshed: 0, skippedSealed: 0, reviews: [review(1), review(2), review(3)] }) }));
    await openReviews();
    fireEvent.click(screen.getByRole("button", { name: "Préparer les brouillons" }));
    await screen.findByText("Brouillons préparés : 3 créés, 0 actualisés, 0 scellés laissés intacts.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ classroomId: ID.classroom, academicYearId: ID.year });
  });

  it("liste vide : message explicatif", async () => {
    setTestApi(reviewRoutes({ [REVIEWS]: { items: [] } }));
    renderWithProviders(<ReviewsScreen />);
    expect(await screen.findByText("Aucun bilan pour cette classe et cette année.")).toBeTruthy();
  });
});

describe("Archives d'année", () => {
  const ARCHIVES = `GET ${P}/year-archives`;
  const archiveRoutes = (items: unknown[], over: Record<string, unknown> = {}, permissions: string[] = ["primary.archive.prepare", "primary.archive.freeze", "primary.bilan.read"]) => ({
    ...accessRoutes(permissions, ["primary.year-archive"]),
    [`GET ${P}/my-classrooms`]: { items: [myClassroom()] },
    [`GET ${P}/rule-banner`]: { ruleSourceKind: "placeholder", isPlaceholder: true },
    [ARCHIVES]: { items },
    ...over,
  });

  it("préparer l'archive ; état, manifeste et manques sont affichés", async () => {
    const api = setTestApi(archiveRoutes([archive()], { [`POST ${P}/year-archives/prepare`]: () => json(archive()) }));
    renderWithProviders(<ArchivesScreen />);
    expect(await screen.findByText("En préparation")).toBeTruthy();
    expect(screen.getByTestId("archive-counts").textContent).toBe("2 bilans scellés sur 3");
    expect(screen.getByRole("alert").textContent).toContain("1 bilan(s) non scellé(s).");
    // Pas de gel tant que l'archive n'est pas prête.
    expect(screen.queryByRole("button", { name: "Geler l'archive" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Préparer l'archive" }));
    await screen.findByText("Archive préparée.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ academicYearId: ID.year });
  });

  it("geler : confirmation explicite d'une action IRRÉVERSIBLE (case à cocher) avant l'appel", async () => {
    const api = setTestApi(archiveRoutes([archive({ status: "READY", reviewsSealed: 3, manifestHash: HASH, blockers: [] })], { [`POST ${P}/year-archives/${archive().id}/freeze`]: () => json(archive({ status: "FROZEN", reviewsSealed: 3, manifestHash: HASH, frozenAt: NOW, blockers: [] })) }));
    renderWithProviders(<ArchivesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Geler l'archive" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Action irréversible/)).toBeTruthy();
    const confirm = within(dialog).getByRole("button", { name: "Geler définitivement" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Je comprends que le gel est irréversible" }));
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await screen.findByText("Archive gelée.");
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("sans la permission sensible de gel : aucun bouton de gel", async () => {
    setTestApi(archiveRoutes([archive({ status: "READY", reviewsSealed: 3, manifestHash: HASH, blockers: [] })], {}, ["primary.archive.prepare", "primary.bilan.read"]));
    renderWithProviders(<ArchivesScreen />);
    await screen.findByText("Prête à geler");
    await screen.findByRole("button", { name: "Préparer l'archive" });
    expect(screen.queryByRole("button", { name: "Geler l'archive" })).toBeNull();
  });

  it("archive gelée : mention du gel, aucune action", async () => {
    setTestApi(archiveRoutes([archive({ status: "FROZEN", reviewsSealed: 3, frozenAt: NOW, manifestHash: HASH, blockers: [] })]));
    renderWithProviders(<ArchivesScreen />);
    expect(await screen.findByText("Cette année est gelée : plus aucun bilan ne peut être écrit.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Geler l'archive" })).toBeNull();
  });

  it("l'erreur de l'API est affichée telle quelle", async () => {
    setTestApi(archiveRoutes([], { [`POST ${P}/year-archives/prepare`]: () => json(apiErrorBody("primary_school.archive_year_not_closed", "L'année doit être close avant d'être archivée."), { status: 409 }) }));
    renderWithProviders(<ArchivesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Préparer l'archive" }));
    expect((await screen.findByRole("alert")).textContent).toContain("L'année doit être close avant d'être archivée.");
  });
});
