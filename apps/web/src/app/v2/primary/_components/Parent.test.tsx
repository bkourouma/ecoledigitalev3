// @vitest-environment jsdom
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { studentDetail, studentSummary } from "../../_test/fixtures-people";
import { apiErrorBody, enrollment, HASH, ID, NOW, P, review, student, summary } from "../_test/fixtures";
import { ParentScreen } from "./ParentScreen";
import { PlaceholderNotice, PrimaryError, RuleBanner } from "./shared";
import { permissionsLoaded } from "../_test/helpers";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);

const CHILD_PERMS = ["primary.bilan.child.read", "primary.competency.child.read"];
const kid = (over: Record<string, unknown> = {}) =>
  studentSummary({
    id: student(1),
    displayName: "AKA Marie",
    currentEnrollment: { enrollmentId: enrollment(1), academicYearId: ID.year, institutionId: ID.institution, classroomId: ID.classroom, classroomName: "CE1 A", status: "ACTIVE", registrationNumber: "R-1" },
    ...over,
  });

function childRoutes(over: Record<string, unknown> = {}, permissions: string[] = CHILD_PERMS) {
  return {
    ...accessRoutes(permissions, []),
    "GET /api/v1/people/children": { items: [kid()] },
    [`GET ${P}/children/${student(1)}/annual-reviews`]: { items: [] },
    [`GET ${P}/children/${student(1)}/enrollments/${enrollment(1)}/competency-summary`]: summary({ summary: {}, periodIds: null }),
    ...over,
  };
}

describe("Bulletin et compétences de mon enfant", () => {
  it("rien n'est publié : message clair, sans calcul ni donnée inventée", async () => {
    setTestApi(childRoutes());
    renderWithProviders(<ParentScreen />);
    expect(await screen.findByRole("heading", { level: 1, name: "Bulletin et compétences de mon enfant" })).toBeTruthy();
    expect(await screen.findByText("Aucun bilan annuel publié pour le moment.")).toBeTruthy();
    expect(screen.getByText("Le bilan apparaît ici dès que l'établissement l'a scellé et publié.")).toBeTruthy();
    expect(await screen.findByText("Aucune compétence validée à afficher pour le moment.")).toBeTruthy();
  });

  it("affiche le bilan scellé et publié, ses compteurs, la mention de démonstration et la synthèse des périodes publiées", async () => {
    setTestApi(
      childRoutes({
        [`GET ${P}/children/${student(1)}/annual-reviews`]: { items: [review(1, { status: "SEALED", contentHash: HASH, sealedAt: NOW, outcomeCode: "PROMOTED", competencySummary: { D1: { N3: 2, N2: 1 } } })] },
        [`GET ${P}/children/${student(1)}/enrollments/${enrollment(1)}/competency-summary`]: summary(),
      }),
    );
    renderWithProviders(<ParentScreen />);
    const article = await screen.findByRole("article", { name: "Bilan annuel CE1, version 1" });
    expect(within(article).getByText("Scellé")).toBeTruthy();
    expect(within(article).getByText("Passage en classe supérieure")).toBeTruthy();
    expect(within(article).getByText("aaaaaaaaaaaa…")).toBeTruthy();
    expect(screen.getAllByText("Règles de démonstration — document sans valeur officielle").length).toBeGreaterThan(0);
    // Compteurs des périodes publiées : domaine x niveau, jamais de pourcentage ni de moyenne.
    const tables = await screen.findAllByRole("table");
    expect(tables.length).toBe(2);
    for (const t of tables) expect(t.textContent).not.toMatch(/%|moyenne/i);
  });

  it("plusieurs enfants : le parent choisit ; 404 hors lien de tutelle : message neutre", async () => {
    setTestApi(
      childRoutes({
        "GET /api/v1/people/children": { items: [kid(), kid({ id: student(2), displayName: "AKA Yao", currentEnrollment: null })] },
        [`GET ${P}/children/${student(2)}/annual-reviews`]: () => json(apiErrorBody("NOT_FOUND", "Élève introuvable.", {}), { status: 404 }),
      }),
    );
    renderWithProviders(<ParentScreen />);
    expect(await screen.findByText("Choisissez un enfant pour afficher son bilan et ses compétences.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Enfant"), { target: { value: student(2) } });
    expect(await screen.findByText("Cet élément est introuvable ou hors de votre périmètre.")).toBeTruthy();
    expect(screen.queryByText("Élève introuvable.")).toBeNull();
  });

  it("aucun enfant lié : message explicatif", async () => {
    setTestApi(childRoutes({ "GET /api/v1/people/children": { items: [] } }));
    renderWithProviders(<ParentScreen />);
    expect(await screen.findByText("Aucun enfant n'est lié à votre compte.")).toBeTruthy();
  });

  it("élève : ses propres bilans publiés et ses compteurs", async () => {
    setTestApi({
      ...accessRoutes(["primary.bilan.self.read", "primary.competency.self.read"], []),
      [`GET ${P}/me/annual-reviews`]: { items: [] },
      "GET /api/v1/people/me/student": studentDetail({ currentEnrollment: kid().currentEnrollment }),
      [`GET ${P}/enrollments/${enrollment(1)}/competency-summary`]: summary(),
    });
    renderWithProviders(<ParentScreen />);
    expect(await screen.findByRole("heading", { level: 1, name: "Mon bilan et mes compétences" })).toBeTruthy();
    expect(await screen.findByText("Aucun bilan annuel publié pour le moment.")).toBeTruthy();
    expect(await screen.findByRole("table")).toBeTruthy();
  });

  it("sans aucun droit de lecture : accès refusé expliqué", async () => {
    const api = setTestApi({ ...accessRoutes([], []) });
    renderWithProviders(<ParentScreen />);
    await permissionsLoaded(api);
    expect(await screen.findByText("Votre profil n'a pas accès à cet espace.")).toBeTruthy();
  });
});

describe("Bandeau « Règles de démonstration » et erreurs", () => {
  it("bandeau permanent tant que le RuleSet lié est fictif (texte de la constante du contrat)", async () => {
    setTestApi({ [`GET ${P}/rule-banner`]: { ruleSourceKind: "placeholder", isPlaceholder: true } });
    renderWithProviders(<RuleBanner />);
    const note = await screen.findByRole("note", { name: "Règles de démonstration" });
    expect(note.textContent).toContain("Règles de démonstration — document sans valeur officielle");
  });

  it("aucun bandeau quand les règles sont officielles", async () => {
    const api = setTestApi({ [`GET ${P}/rule-banner`]: { ruleSourceKind: "regulation", isPlaceholder: false } });
    renderWithProviders(<RuleBanner />);
    await vi.waitFor(() => expect(api.calls.some((c) => c.path.endsWith("/rule-banner"))).toBe(true));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("état des règles illisible : on le dit au lieu de masquer la mention", async () => {
    setTestApi({ [`GET ${P}/rule-banner`]: () => json(apiErrorBody("primary_school.port_unavailable", "indisponible"), { status: 500 }) });
    renderWithProviders(<RuleBanner />);
    expect(await screen.findByText(/Impossible de vérifier si les règles employées sont des règles de démonstration/)).toBeTruthy();
  });

  it("mention fixe réutilisable sur un document", () => {
    renderWithProviders(<PlaceholderNotice compact />);
    expect(screen.getByTestId("placeholder-notice").textContent).toBe("Règles de démonstration — document sans valeur officielle");
  });

  it("PrimaryError : message de l'API tel quel + piste d'action ; 404 neutre ; service indisponible expliqué", async () => {
    const { ApiError } = await import("@/platform/api/errors");
    const { unmount } = renderWithProviders(<PrimaryError error={new ApiError({ code: "primary_school.period_locked", message: "La saisie est arrêtée pour cette classe et cette période.", status: 409 })} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("La saisie est arrêtée pour cette classe et cette période.");
    expect(alert.textContent).toContain("vos saisies restent affichées");
    unmount();
    const second = renderWithProviders(<PrimaryError error={new ApiError({ code: "NOT_FOUND", message: "Classe 1234 introuvable.", status: 404 })} />);
    expect(screen.getByRole("alert").textContent).toBe("Cet élément est introuvable ou hors de votre périmètre.");
    second.unmount();
    renderWithProviders(<PrimaryError error={new ApiError({ code: "primary_school.port_unavailable", message: "Le service « x » n'est pas disponible", status: 500 })} />);
    expect(screen.getByRole("alert").textContent).toContain("Ce document ou ce service n'est pas disponible pour le moment");
  });
});
