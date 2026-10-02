// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { attendance, enrollment, env, financeSummary, overview, scopes } from "../../owner/_test/fixtures-analytics";
import { DirectionDashboardScreen } from "./Dashboard";
import { EnrollmentScreen } from "./Enrollment";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/direction", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const FEATURES = ["analytics.direction"];
const base = (permissions: string[], features = FEATURES) => ({ ...accessRoutes(permissions, features), "GET /api/v1/analytics/scopes": env(scopes()) });
const calls = (api: ReturnType<typeof setTestApi>, suffix: string) => api.calls.filter((c) => c.path.endsWith(suffix));

describe("Tableau de bord de la direction", () => {
  const perms = ["analytics.read", "analytics.finance.read", "analytics.pedagogy.read"];
  const routes = (extra: Record<string, unknown> = {}) => ({
    ...base(perms),
    "GET /api/v1/analytics/overview": env(overview()),
    "GET /api/v1/analytics/finance/summary": env(financeSummary()),
    ...extra,
  });

  it("effectifs, présence du jour (état en texte), moyenne, enseignants présents, recouvrement et créances", async () => {
    setTestApi(routes());
    renderWithProviders(<DirectionDashboardScreen />);
    const headcount = await screen.findByText("Élèves en scolarité", { selector: "dt" });
    expect(within(headcount.parentElement!).getByText("412")).toBeTruthy();
    expect(within(headcount.parentElement!).getByText("440 inscription(s) au total · 14 classe(s)")).toBeTruthy();
    const attendanceCard = screen.getByText("Présence aujourd'hui", { selector: "dt" });
    expect(within(attendanceCard.parentElement!).getByText(/93,00\s%/)).toBeTruthy();
    expect(within(attendanceCard.parentElement!).getByText("Bon")).toBeTruthy();
    const average = screen.getByText("Moyenne générale", { selector: "dt" });
    expect(within(average.parentElement!).getByText(/11,72/)).toBeTruthy();
    expect(within(average.parentElement!).getByText(/Semestre 1 · 380 résultats clôturés/)).toBeTruthy();
    expect(within(screen.getByText("Taux de validation", { selector: "dt" }).parentElement!).getByText(/70,00\s%/)).toBeTruthy();
    expect(within(screen.getByText("Enseignants et personnel présents", { selector: "dt" }).parentElement!).getByText("31")).toBeTruthy();
    // finance
    const rate = await screen.findByText("Scolarité recouvrée", { selector: "dt" });
    expect(within(rate.parentElement!).getByText(/69,49\s%/)).toBeTruthy();
    expect(within(rate.parentElement!).getByText("À surveiller")).toBeTruthy();
    const outstanding = screen.getByText("Créances (restant dû)", { selector: "dt" });
    expect(within(outstanding.parentElement!).getByText(/18\D000\D000\sF\sCFA/)).toBeTruthy();
    expect(screen.getByText(/dont 7\D500\D000\sF\sCFA en retard \(31 facture\(s\)\)/)).toBeTruthy();
  });

  it("sans analytics.finance.read : la partie financière n'est ni affichée ni demandée", async () => {
    const api = setTestApi({ ...base(["analytics.read"]), "GET /api/v1/analytics/overview": env(overview()), "GET /api/v1/analytics/finance/summary": env(financeSummary()) });
    renderWithProviders(<DirectionDashboardScreen />);
    await screen.findByText("Élèves en scolarité", { selector: "dt" });
    expect(screen.queryByText("Scolarité recouvrée")).toBeNull();
    expect(calls(api, "/finance/summary")).toHaveLength(0);
    expect(screen.queryByText("Masse salariale")).toBeNull(); // raccourci masqué sans permission
  });

  it("indicateurs non mesurés : « Non mesuré », jamais 0 % ; manque déclaré", async () => {
    setTestApi(
      routes({
        "GET /api/v1/analytics/overview": env(
          overview({
            attendanceToday: { day: "2026-03-20", recordsCount: 0, presentCount: 0, absentCount: 0, lateCount: 0, rateBps: null, status: "neutral", measured: false },
            results: { periodId: null, periodLabel: null, generalAverage: null, cohortSize: 0, validatedCount: 0, validationRateBps: null, measured: false, demonstration: false },
            staffToday: { day: "2026-03-20", present: 0, absent: 0, onLeave: 0, measured: false },
          }),
          { gaps: [{ source: "RESULTS", reason: "NEVER_COMPUTED", message: "Résultats : aucune lecture de la source n'a encore eu lieu." }] },
        ),
        "GET /api/v1/analytics/finance/summary": env(financeSummary({ summary: null, currency: null, asOfDate: null, byClassroom: [] })),
      }),
    );
    renderWithProviders(<DirectionDashboardScreen />);
    await waitFor(() => expect(screen.getAllByText("Non mesuré")).toHaveLength(7)); // 4 indicateurs de pilotage + 3 indicateurs financiers
    expect(screen.getByText(/aucune lecture de la source/)).toBeTruthy();
    expect(screen.queryByText(/0,00\s%/)).toBeNull();
  });

  it("erreur de l'API : message, puis nouvelle tentative", async () => {
    let ok = false;
    setTestApi(routes({ "GET /api/v1/analytics/overview": () => (ok ? json(env(overview())) : json({ code: "x", message: "Pilotage indisponible." }, { status: 422 })) }));
    renderWithProviders(<DirectionDashboardScreen />);
    expect(await screen.findByText("Pilotage indisponible.")).toBeTruthy();
    ok = true;
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByText("Élèves en scolarité", { selector: "dt" })).toBeTruthy();
  });

  it("filtre d'année : transmis à l'API, la période et la classe ne sont pas des filtres de cet écran", async () => {
    const api = setTestApi(routes());
    renderWithProviders(<DirectionDashboardScreen />);
    await screen.findByText("Élèves en scolarité", { selector: "dt" });
    expect(screen.queryByLabelText("Période")).toBeNull();
    expect(screen.queryByLabelText("Classe")).toBeNull();
    fireEvent.change(screen.getByLabelText("Année scolaire"), { target: { value: "00000000-0000-4000-8000-00000000000a" } });
    await waitFor(() => expect(calls(api, "/overview").some((c) => c.query.yearId === "00000000-0000-4000-8000-00000000000a")).toBe(true));
  });
});

describe("Effectifs et présences", () => {
  const routes = (permissions = ["analytics.read", "analytics.attendance.read", "analytics.export"], extra: Record<string, unknown> = {}) => ({
    ...base(permissions),
    "GET /api/v1/analytics/enrollment": env(enrollment()),
    "GET /api/v1/analytics/attendance": env(attendance()),
    ...extra,
  });

  it("répartitions en texte et en tableau : sexe, niveau, financement, campus ; classes avec garçons et filles", async () => {
    setTestApi(routes());
    renderWithProviders(<EnrollmentScreen />);
    const inSchooling = await screen.findByText("Élèves en scolarité", { selector: "dt" });
    expect(within(inSchooling.parentElement!).getByText("90")).toBeTruthy();
    const labels = (name: string) => within(screen.getByRole("figure", { name })).getAllByRole("listitem").map((i) => i.textContent);
    expect(labels("Par sexe")).toEqual([expect.stringContaining("Filles"), expect.stringContaining("Garçons"), expect.stringContaining("Non renseigné")]);
    expect(labels("Par type de financement")).toEqual([expect.stringContaining("Famille"), expect.stringContaining("Affecté par l'État")]);
    expect(labels("Par campus")[0]).toContain("Campus Cocody");
    expect(screen.getAllByText("Filles").length).toBeGreaterThan(1); // graphique, alternative tableau et colonne des classes
    const classes = screen.getByRole("table", { name: "Effectifs par classe" });
    expect(within(classes).getByText("6e A")).toBeTruthy();
    const redoublants = screen.getByText("Part de redoublants", { selector: "dt" });
    expect(within(redoublants.parentElement!).getByText(/10,00\s%/)).toBeTruthy();
  });

  it("admissions : créées, confirmées, annulées, taux de confirmation, courbe mensuelle et origines", async () => {
    setTestApi(routes());
    renderWithProviders(<EnrollmentScreen />);
    const created = await screen.findByText("Inscriptions créées", { selector: "dt" });
    expect(within(created.parentElement!).getByText("100")).toBeTruthy();
    expect(within(screen.getByText("Taux de confirmation", { selector: "dt" }).parentElement!).getByText(/90,00\s%/)).toBeTruthy();
    const source = within(screen.getByRole("figure", { name: "Inscriptions par origine" })).getAllByRole("listitem");
    expect(source[0]!.textContent).toContain("Admission");
    expect(source[1]!.textContent).toContain("Saisie manuelle");
    expect(within(screen.getByRole("figure", { name: "Inscriptions créées par mois" })).getByRole("img", { name: /2 mois/ })).toBeTruthy();
  });

  it("présence : taux, absences, états par classe en texte, fenêtre transmise à l'API", async () => {
    const api = setTestApi(routes());
    renderWithProviders(<EnrollmentScreen />);
    const rate = await screen.findByText("Taux de présence", { selector: "dt" });
    expect(within(rate.parentElement!).getByText(/90,00\s%/)).toBeTruthy();
    expect(within(rate.parentElement!).getByText("Bon")).toBeTruthy();
    const table = screen.getByRole("table", { name: "Présence par classe" });
    expect(within(table).getByText("Critique")).toBeTruthy(); // 5e B : 65 % -> critique selon l'API
    fireEvent.change(screen.getByLabelText(/^Du$/), { target: { value: "2026-03-01" } });
    await waitFor(() => expect(calls(api, "/attendance").some((c) => c.query.from === "2026-03-01")).toBe(true));
    expect(screen.getByRole("figure", { name: "Présence du personnel par jour" })).toBeTruthy();
  });

  it("sans analytics.attendance.read : ni section de présence ni appel", async () => {
    const api = setTestApi(routes(["analytics.read"]));
    renderWithProviders(<EnrollmentScreen />);
    await screen.findByText("Élèves en scolarité", { selector: "dt" });
    expect(screen.queryByText("Présences et assiduité")).toBeNull();
    expect(calls(api, "/attendance")).toHaveLength(0);
  });

  it("personnel non mesuré : message au lieu d'un tableau vide trompeur", async () => {
    setTestApi(routes(undefined, { "GET /api/v1/analytics/attendance": env(attendance({ staff: { byDay: [], measured: false } })) }));
    renderWithProviders(<EnrollmentScreen />);
    expect(await screen.findByText("La présence du personnel n'est pas mesurée sur cette fenêtre.")).toBeTruthy();
  });

  it("aucune inscription : états vides explicites", async () => {
    setTestApi(
      routes(["analytics.read"], {
        "GET /api/v1/analytics/enrollment": env(
          enrollment({
            totals: { total: 0, inSchooling: 0, repeaters: 0, repeaterRateBps: null },
            byStatus: [],
            bySex: [],
            byGradeLevel: [],
            byFunding: [],
            byCampus: [],
            byClassroom: [],
            admissions: { created: 0, confirmed: 0, cancelled: 0, confirmationRateBps: null, bySource: [], monthly: [] },
          }),
        ),
      }),
    );
    renderWithProviders(<EnrollmentScreen />);
    expect((await screen.findAllByText("Aucune inscription sur ce périmètre.")).length).toBeGreaterThan(0);
    expect(screen.getByText("Aucune classe sur ce périmètre.")).toBeTruthy();
    expect(screen.getAllByText("Non mesuré").length).toBeGreaterThanOrEqual(2); // taux sans objet : pas 0 %
  });
});
