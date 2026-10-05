// @vitest-environment jsdom
import { configure, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { admissionsExamResultsDtoSchema } from "@ecoledigitale/contracts/v2/admissions";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { IDS, detail, lookups, settings, uuid } from "../_test/fixtures";
import { ApplicationDetailScreen } from "./ApplicationDetailScreen";

vi.setConfig({ testTimeout: 30_000 });
configure({ asyncUtilTimeout: 5000 });

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/admissions", useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams("") }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const A = "/api/v1/admissions";
afterEach(() => vi.restoreAllMocks());

const result = (extra: Record<string, unknown> = {}) => ({
  id: uuid(800), examTypeCode: "CEPE", sessionYear: 2027, outcome: "ADMITTED", admitted: true, average: "12.250", averageHidden: false, matchedBy: "STUDENT", receivedAt: "2027-07-01T08:00:00.000Z", ...extra,
});
const routes = (perms: string[], exam: unknown) => ({
  ...accessRoutes(perms),
  [`GET ${A}/applications/${IDS.app1}`]: detail(),
  [`GET ${A}/lookups`]: lookups,
  [`GET ${A}/settings`]: settings(),
  [`GET ${A}/applications/${IDS.app1}/exam-results`]: exam,
});

describe("Dossier : résultat d'examen transmis (Q-E18)", () => {
  it("les fabriques de test respectent le contrat", () => {
    expect(admissionsExamResultsDtoSchema.safeParse({ canSeeAverage: true, items: [result()] }).success).toBe(true);
    expect(admissionsExamResultsDtoSchema.safeParse({ canSeeAverage: false, items: [result({ average: null, averageHidden: true })] }).success).toBe(true);
  });

  it("personnel habilité : « admis » ET moyenne, lecture annoncée comme tracée", async () => {
    setTestApi(routes(["admission.read", "admission.exam_result.read"], { canSeeAverage: true, items: [result()] }));
    renderWithProviders(<ApplicationDetailScreen applicationId={IDS.app1} />);
    const block = await screen.findByTestId("dossier-exam-results");
    expect(block.textContent).toContain("CEPE 2027");
    expect(block.textContent).toContain("Admis");
    expect(screen.getByTestId("exam-average").textContent).toMatch(/12,25/);
    expect(block.textContent).toContain("L'affichage des moyennes est tracé.");
  });

  it("sans l'habilitation : « non admis » visible, MOYENNE masquée (aucune valeur dans la page)", async () => {
    setTestApi(routes(["admission.read"], { canSeeAverage: false, items: [result({ outcome: "FAILED", admitted: false, average: null, averageHidden: true, matchedBy: "CONFIRMED_DUPLICATE" })] }));
    renderWithProviders(<ApplicationDetailScreen applicationId={IDS.app1} />);
    const block = await screen.findByTestId("dossier-exam-results");
    expect(block.textContent).toContain("Non admis");
    expect(block.textContent).toContain("Moyenne réservée au personnel d'admission habilité");
    expect(block.textContent).toContain("rapprochement confirmé");
    expect(screen.queryByTestId("exam-average")).toBeNull();
    expect(document.body.textContent).not.toMatch(/12,25|8,75/);
  });

  it("aucun résultat reçu : aucun encart ; volet indisponible : simple mention, le dossier reste utilisable", async () => {
    setTestApi(routes(["admission.read"], { canSeeAverage: false, items: [] }));
    const first = renderWithProviders(<ApplicationDetailScreen applicationId={IDS.app1} />);
    expect((await screen.findAllByText(/Documents|Pièces|Historique/i)).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("dossier-exam-results")).toBeNull();
    first.unmount();
    setTestApi(routes(["admission.read"], () => json({ code: "admissions.application_not_found", message: "Introuvable", status: 404 }, { status: 404 })));
    renderWithProviders(<ApplicationDetailScreen applicationId={IDS.app1} />);
    expect(await screen.findByText("Résultat d'examen indisponible pour l'instant.")).toBeTruthy();
  });
});
