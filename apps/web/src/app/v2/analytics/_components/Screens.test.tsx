// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { alertDetail, alertMetrics, alertRules, alertsData, aid, attendance, comparison, enrollment, env, financeSummary, funnel, IDS, overview, results, schoolLife, scopes } from "../../owner/_test/fixtures-analytics";
import { AlertRulesScreen } from "./AlertRules";
import { AlertsScreen } from "./Alerts";
import { CompareScreen } from "./Compare";
import { AdmissionsFunnelScreen, SchoolLifeScreen } from "./Funnel";
import { IndicatorsScreen } from "./Indicators";
import { parseThreshold, thresholdToInput } from "./measure";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/analytics", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const FEATURES = ["analytics.direction"];
const base = (permissions: string[], features = FEATURES) => ({ ...accessRoutes(permissions, features), "GET /api/v1/analytics/scopes": env(scopes()) });
const calls = (api: ReturnType<typeof setTestApi>, suffix: string, method = "GET") => api.calls.filter((c) => c.method === method && c.path.endsWith(suffix));

describe("mesures : saisie des seuils par lecture de chaîne", () => {
  it("pourcentage -> points de base, montant entier, comptage ; « 0 » est un seuil, vide n'en est pas un", () => {
    expect(parseThreshold("BPS", "85")).toEqual({ ok: true, value: 8500 });
    expect(parseThreshold("BPS", "87,5 %")).toEqual({ ok: true, value: 8750 });
    expect(parseThreshold("BPS", "0")).toEqual({ ok: true, value: 0 });
    expect(parseThreshold("BPS", "")).toEqual({ ok: true, value: null });
    expect(parseThreshold("BPS", "120")).toEqual({ ok: false, reason: "range" });
    expect(parseThreshold("BPS", "abc")).toEqual({ ok: false, reason: "invalid" });
    expect(parseThreshold("AMOUNT", "5 000 000")).toEqual({ ok: true, value: 5_000_000 });
    expect(parseThreshold("AMOUNT", "1,5")).toEqual({ ok: false, reason: "invalid" }); // jamais de décimale devinée sur un franc CFA
    expect(parseThreshold("COUNT", "0")).toEqual({ ok: true, value: 0 });
    expect(thresholdToInput("BPS", 8750)).toBe("87,5");
    expect(thresholdToInput("BPS", 8500)).toBe("85");
    expect(thresholdToInput("COUNT", null)).toBe("");
  });
});

describe("Indicateurs de direction", () => {
  const all = ["analytics.read", "analytics.attendance.read", "analytics.pedagogy.read", "analytics.finance.read", "analytics.admissions.read", "analytics.schoollife.read", "analytics.alerts.read", "analytics.payroll.read"];
  const routes = (permissions = all, extra: Record<string, unknown> = {}) => ({
    ...base(permissions),
    "GET /api/v1/analytics/enrollment": env(enrollment()),
    "GET /api/v1/analytics/attendance": env(attendance()),
    "GET /api/v1/analytics/pedagogy/results": env(results()),
    "GET /api/v1/analytics/finance/summary": env(financeSummary()),
    "GET /api/v1/analytics/admissions/funnel": env(funnel()),
    "GET /api/v1/analytics/schoollife/summary": env(schoolLife()),
    "GET /api/v1/analytics/alerts": alertsData(),
    "GET /api/v1/analytics/payroll/mass": env({ currency: "XOF", periods: [], counted: { payslips: 0, total: 0 } }),
    ...extra,
  });

  it("tous les blocs : effectifs, assiduité, résultats par période, recouvrement, admissions, vie scolaire, alertes", async () => {
    setTestApi(routes());
    renderWithProviders(<IndicatorsScreen />);
    expect(await screen.findByRole("heading", { name: "Effectifs et inscriptions" })).toBeTruthy();
    expect(await screen.findByText("Taux de présence", { selector: "dt" })).toBeTruthy();
    expect(await screen.findByRole("table", { name: "Résultats clôturés par période de l'année" })).toBeTruthy();
    expect(await screen.findByText("Scolarité recouvrée", { selector: "dt" })).toBeTruthy();
    expect(within((await screen.findByText("Dossiers déposés", { selector: "dt" })).parentElement!).getByText("125")).toBeTruthy();
    expect(within((await screen.findByText("Incidents ouverts", { selector: "dt" })).parentElement!).getByText("7")).toBeTruthy();
    expect(screen.getByText(/aucun élève, aucun motif/)).toBeTruthy();
    expect(within((await screen.findByText("Alertes ouvertes", { selector: "dt" })).parentElement!).getByText("1")).toBeTruthy();
  });

  it("règles de démonstration : bandeau et libellé « Démonstration » sur la période concernée", async () => {
    const stats = { count: 40, average: 12.35, min: 4.5, max: 18.25, validatedCount: 28, validationRateBps: 7000 };
    setTestApi(
      routes(all, {
        "GET /api/v1/analytics/pedagogy/results": env(
          results({
            byPeriod: [
              { periodId: IDS.p1, label: "Semestre 1", ordinal: 1, ...stats, demonstration: true },
              { periodId: IDS.p2, label: "Semestre 2", ordinal: 2, ...stats, demonstration: false },
            ],
            rulesSource: { demonstration: true, finalClassPeriods: 4, placeholderClassPeriods: 2, unknownClassPeriods: 0 },
          }),
        ),
      }),
    );
    renderWithProviders(<IndicatorsScreen />);
    expect(await screen.findByText("Règles de démonstration")).toBeTruthy();
    expect(screen.getByText(/ne sont pas officiels/)).toBeTruthy();
    const table = await screen.findByRole("table", { name: "Résultats clôturés par période de l'année" });
    const rows = within(table).getAllByRole("row");
    expect(within(rows.find((r) => within(r).queryByText("Semestre 1"))!).getByText("Démonstration")).toBeTruthy();
    expect(within(rows.find((r) => within(r).queryByText("Semestre 2"))!).getByText("Officielles")).toBeTruthy();
  });

  it("sans permission de données : le bloc n'est ni affiché ni demandé", async () => {
    const api = setTestApi(routes(["analytics.read"]));
    renderWithProviders(<IndicatorsScreen />);
    await screen.findByRole("heading", { name: "Effectifs et inscriptions" });
    for (const suffix of ["/attendance", "/pedagogy/results", "/finance/summary", "/admissions/funnel", "/schoollife/summary", "/alerts", "/payroll/mass"]) expect(calls(api, suffix), suffix).toHaveLength(0);
    expect(screen.queryByText("Vie scolaire (agrégée)")).toBeNull();
    expect(screen.queryByText("Charge de paie")).toBeNull();
  });

  it("charge de paie (sensible) : jamais lue avant une action explicite", async () => {
    const api = setTestApi(
      routes(all, {
        "GET /api/v1/analytics/payroll/mass": env({
          currency: "XOF",
          periods: [{ periodId: aid(600), name: "Février 2026", startsOn: "2026-02-01", endsOn: "2026-02-28", yearId: IDS.year, byStatus: {}, counted: { payslips: 9, total: 3_100_000 }, cancelled: { payslips: 0, total: 0 }, disputed: { payslips: 1, total: 200_000 } }],
          counted: { payslips: 9, total: 3_100_000 },
        }),
      }),
    );
    renderWithProviders(<IndicatorsScreen />);
    const button = await screen.findByRole("button", { name: "Afficher la masse salariale" });
    expect(screen.getByText(/authentification forte/)).toBeTruthy();
    expect(calls(api, "/payroll/mass")).toHaveLength(0);
    fireEvent.click(button);
    expect(await screen.findByText(/9 bulletin\(s\) calculés, arrêtés ou payés/)).toBeTruthy();
    expect(calls(api, "/payroll/mass")).toHaveLength(1);
  });

  it("sans la fonctionnalité de l'offre : message explicite, aucune donnée demandée", async () => {
    const api = setTestApi({ ...routes(), ...accessRoutes(all, []) });
    renderWithProviders(<IndicatorsScreen />);
    expect(await screen.findByText(/n'est pas inclus dans l'offre/)).toBeTruthy();
    expect(calls(api, "/enrollment")).toHaveLength(0);
  });

  it("erreur d'un bloc : message et nouvelle tentative, les autres blocs restent affichés", async () => {
    let ok = false;
    setTestApi(routes(all, { "GET /api/v1/analytics/attendance": () => (ok ? json(env(attendance())) : json({ code: "x", message: "Présence indisponible." }, { status: 422 })) }));
    renderWithProviders(<IndicatorsScreen />);
    expect(await screen.findByText("Présence indisponible.")).toBeTruthy();
    expect(await screen.findByText("Scolarité recouvrée", { selector: "dt" })).toBeTruthy();
    ok = true;
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByText("Taux de présence", { selector: "dt" })).toBeTruthy();
  });
});

describe("Entonnoir d'admission", () => {
  const routes = (extra: Record<string, unknown> = {}, permissions = ["analytics.admissions.read", "analytics.export"]) => ({ ...base(permissions), "GET /api/v1/analytics/admissions/funnel": env(funnel()), ...extra });

  it("répartition par statut en texte et en tableau, taux, places, étapes par campagne ; aucun candidat", async () => {
    setTestApi(routes());
    renderWithProviders(<AdmissionsFunnelScreen />);
    expect(await screen.findByText(/Répartition à ce jour/)).toBeTruthy();
    expect(within((await screen.findByText("Taux d'acceptation", { selector: "dt" })).parentElement!).getByText(/40,00\s%/)).toBeTruthy();
    expect(within(screen.getByText("Taux d'inscription", { selector: "dt" }).parentElement!).getByText(/60,00\s%/)).toBeTruthy();
    expect(within(screen.getByText("Places offertes", { selector: "dt" }).parentElement!).getByText("120")).toBeTruthy();
    const chart = within(screen.getByRole("figure", { name: "Dossiers par statut" })).getAllByRole("listitem");
    expect(chart).toHaveLength(8);
    expect(chart.some((i) => i.textContent?.includes("Inscrit"))).toBe(true);
    const table = screen.getByRole("table", { name: "Dossiers par étape — Campagne 2026-2027" });
    expect(within(table).getAllByText("En étude").length).toBeGreaterThan(0); // libellé de l'étape et statut canonique
    expect(screen.getByRole("button", { name: "Exporter (CSV)" })).toBeTruthy();
    expect(screen.queryByText(/nom|prénom|téléphone/i)).toBeNull();
  });

  it("aucune campagne : état vide et « Non mesuré », jamais 0", async () => {
    setTestApi(routes({ "GET /api/v1/analytics/admissions/funnel": env(funnel({ campaigns: [], byStatus: [], totals: { applications: 0, submitted: 0, accepted: 0, enrolled: 0, rejected: 0, waitlisted: 0, acceptanceRateBps: null, enrollmentRateBps: null, seats: null, seatsLeft: null } })) }));
    renderWithProviders(<AdmissionsFunnelScreen />);
    expect((await screen.findAllByText("Aucune campagne d'admission lue pour ce périmètre.")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Non mesuré").length).toBeGreaterThanOrEqual(5);
  });

  it("sans analytics.export : pas de bouton d'export", async () => {
    setTestApi(routes({}, ["analytics.admissions.read"]));
    renderWithProviders(<AdmissionsFunnelScreen />);
    await screen.findByText(/Répartition à ce jour/);
    expect(screen.queryByRole("button", { name: "Exporter (CSV)" })).toBeNull();
  });
});

describe("Vie scolaire agrégée", () => {
  it("quatre comptages et la mention de confidentialité ; non mesuré tant que non lu", async () => {
    setTestApi({ ...base(["analytics.schoollife.read"]), "GET /api/v1/analytics/schoollife/summary": env(schoolLife()) });
    const { unmount } = renderWithProviders(<SchoolLifeScreen />);
    expect(await screen.findByText(/aucun élève n'est nommé/)).toBeTruthy();
    expect(within((await screen.findByText("Incidents ouverts", { selector: "dt" })).parentElement!).getByText("7")).toBeTruthy();
    expect(within(screen.getByText("Convocations à tenir", { selector: "dt" }).parentElement!).getByText("3")).toBeTruthy();
    unmount();
    setTestApi({
      ...base(["analytics.schoollife.read"]),
      "GET /api/v1/analytics/schoollife/summary": env(schoolLife({ indicators: [{ indicator: "OPEN_INCIDENTS", value: null, measured: false }, { indicator: "MEASURES_TO_VALIDATE", value: null, measured: false }, { indicator: "ACTIVE_EXCLUSIONS", value: null, measured: false }, { indicator: "CONVOCATIONS_TO_HOLD", value: null, measured: false }] })),
    });
    renderWithProviders(<SchoolLifeScreen />);
    await waitFor(() => expect(screen.getAllByText("Non mesuré")).toHaveLength(4));
  });
});

describe("Comparaisons", () => {
  const routes = (permissions = ["analytics.read", "analytics.finance.read", "analytics.pedagogy.read", "analytics.attendance.read"], extra: Record<string, unknown> = {}) => ({
    ...base(permissions),
    "GET /api/v1/analytics/scopes": env(scopes({ years: [...scopes().years, { id: aid(11), institutionId: IDS.institution, code: "2024-2025", label: "Année 2024-2025", startsOn: "2024-09-16", endsOn: "2025-07-11", status: "ARCHIVED", isCurrent: false }] })),
    "GET /api/v1/analytics/compare/enrollment": env(comparison("enrollment")),
    "GET /api/v1/analytics/compare/finance": env(comparison("finance")),
    ...extra,
  });

  it("aucune requête tant que les deux côtés ne sont pas choisis ; puis écart, variation et « Non mesuré »", async () => {
    const api = setTestApi(routes());
    renderWithProviders(<CompareScreen />);
    expect(await screen.findByText("Choisissez les deux côtés de la comparaison pour l'afficher.")).toBeTruthy();
    expect(calls(api, "/compare/enrollment")).toHaveLength(0);
    fireEvent.change(await screen.findByLabelText(/Année de référence/), { target: { value: aid(11) } });
    expect(calls(api, "/compare/enrollment")).toHaveLength(0); // un seul côté : toujours rien
    fireEvent.change(screen.getByLabelText(/Année comparée/), { target: { value: IDS.year } });
    const table = await screen.findByRole("table", { name: /Comparaison : Année 2024-2025 et Année 2025-2026/ });
    await waitFor(() => expect(calls(api, "/compare/enrollment")[0]?.query).toMatchObject({ baselineYearId: aid(11), targetYearId: IDS.year }));
    const row = (label: string) => within(table).getByText(label).closest("tr")!;
    expect(within(row("Élèves en scolarité")).getByText("+12")).toBeTruthy();
    expect(within(row("Élèves en scolarité")).getByText("+3 %")).toBeTruthy();
    expect(within(row("Part de redoublants")).getByText(/-1,5\spoints/)).toBeTruthy();
    expect(within(row("Redoublants")).getByText("—")).toBeTruthy(); // référence nulle : pas de variation relative inventée
  });

  it("recouvrement : montants en devise, côté non mesuré = « Non mesuré » (jamais zéro)", async () => {
    setTestApi(routes());
    renderWithProviders(<CompareScreen />);
    fireEvent.change(await screen.findByLabelText("Indicateur"), { target: { value: "finance" } });
    fireEvent.change(screen.getByLabelText(/Année de référence/), { target: { value: aid(11) } });
    fireEvent.change(screen.getByLabelText(/Année comparée/), { target: { value: IDS.year } });
    const table = await screen.findByRole("table", { name: /Comparaison/ });
    expect(within(within(table).getByText("Encaissé").closest("tr")!).getByText(/\+3\D000\D000\sF\sCFA/)).toBeTruthy();
    const rate = within(table).getByText("Taux de recouvrement").closest("tr")!;
    expect(within(rate).getAllByText("Non mesuré").length).toBeGreaterThanOrEqual(2);
  });

  it("résultats : le bandeau « règles de démonstration » apparaît si un côté repose sur des règles fictives", async () => {
    setTestApi(routes(undefined, { "GET /api/v1/analytics/compare/results": env(comparison("results", { target: { label: "Semestre 2", yearId: IDS.year, periodId: IDS.p2, from: null, to: null, demonstration: true }, baseline: { label: "Semestre 1", yearId: IDS.year, periodId: IDS.p1, from: null, to: null, demonstration: false }, metrics: [{ key: "average", unit: "DECIMAL", baseline: 11.7, target: 12.4, delta: 0.7, changeBps: 598 }] })) }));
    renderWithProviders(<CompareScreen />);
    fireEvent.change(await screen.findByLabelText("Indicateur"), { target: { value: "results" } });
    fireEvent.change(screen.getByLabelText(/Période de référence/), { target: { value: IDS.p1 } });
    fireEvent.change(screen.getByLabelText(/Période comparée/), { target: { value: IDS.p2 } });
    expect(await screen.findByText("Règles de démonstration")).toBeTruthy();
  });

  it("assiduité : deux fenêtres ; une fenêtre inversée n'est pas envoyée", async () => {
    const api = setTestApi(routes(undefined, { "GET /api/v1/analytics/compare/attendance": env(comparison("attendance", { metrics: [{ key: "rateBps", unit: "BPS", baseline: 9000, target: 9100, delta: 100, changeBps: 111 }] })) }));
    renderWithProviders(<CompareScreen />);
    fireEvent.change(await screen.findByLabelText("Indicateur"), { target: { value: "attendance" } });
    const set = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
    set(/Référence : du/, "2026-03-10");
    set(/Référence : au/, "2026-03-01"); // inversée
    set(/Comparée : du/, "2026-03-11");
    set(/Comparée : au/, "2026-03-20");
    expect(calls(api, "/compare/attendance")).toHaveLength(0);
    set(/Référence : au/, "2026-03-15");
    await waitFor(() => expect(calls(api, "/compare/attendance")).toHaveLength(1));
    expect(calls(api, "/compare/attendance")[0]!.query).toMatchObject({ baselineFrom: "2026-03-10", baselineTo: "2026-03-15", targetFrom: "2026-03-11", targetTo: "2026-03-20" });
  });

  it("les indicateurs proposés suivent les permissions de données", async () => {
    setTestApi(routes(["analytics.read"]));
    renderWithProviders(<CompareScreen />);
    const select = await screen.findByLabelText("Indicateur");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Effectifs"]);
  });

  it("aucune permission comparable : message", async () => {
    setTestApi(routes([]));
    renderWithProviders(<CompareScreen />);
    expect(await screen.findByText("Vous n'avez accès à aucun indicateur comparable.")).toBeTruthy();
  });
});

describe("Alertes de direction", () => {
  const routes = (permissions = ["analytics.alerts.read", "analytics.alerts.acknowledge", "analytics.export"], extra: Record<string, unknown> = {}) => ({
    ...base(permissions),
    "GET /api/v1/analytics/alerts": alertsData(),
    [`GET /api/v1/analytics/alerts/${aid(9001)}`]: alertDetail(),
    ...extra,
  });

  it("actives d'abord, gravité et état en toutes lettres, valeur et seuil, historique des résolues", async () => {
    setTestApi(routes());
    renderWithProviders(<AlertsScreen />);
    const table = await screen.findByRole("table", { name: "Alertes de direction" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText("Critique")).toBeTruthy();
    expect(within(rows[0]!).getByText("Ouverte")).toBeTruthy();
    expect(within(rows[0]!).getByText(/60,00\s%/)).toBeTruthy();
    expect(within(rows[0]!).getByText(/sous le seuil de 70,00\s%/)).toBeTruthy();
    expect(within(rows[1]!).getByText("Accusée de réception")).toBeTruthy();
    expect(within(rows[1]!).getByText(/6\D200\D000\sF\sCFA/)).toBeTruthy();
    expect(within(rows[1]!).getByText(/au-dessus du seuil/)).toBeTruthy();
    expect(within(rows[2]!).getByText("Résolue")).toBeTruthy();
    expect(within(screen.getByText("Résolues", { selector: "dt" }).parentElement!).getByText("historique conservé")).toBeTruthy();
  });

  it("filtres transmis à l'API (état, gravité, indicateur)", async () => {
    const api = setTestApi(routes());
    renderWithProviders(<AlertsScreen />);
    await screen.findByRole("table", { name: "Alertes de direction" });
    fireEvent.change(screen.getByLabelText("État"), { target: { value: "RESOLVED" } });
    fireEvent.change(screen.getByLabelText("Gravité"), { target: { value: "CRITICAL" } });
    fireEvent.change(screen.getByLabelText("Indicateur"), { target: { value: "ATTENDANCE_RATE" } });
    await waitFor(() => expect(calls(api, "/alerts").some((c) => c.query.status === "RESOLVED" && c.query.severity === "CRITICAL" && c.query.metric === "ATTENDANCE_RATE")).toBe(true));
  });

  it("détail : valeurs, historique des notifications (ouverture, rappel) et rappel que la remise respecte les préférences", async () => {
    setTestApi(routes());
    renderWithProviders(<AlertsScreen />);
    const table = await screen.findByRole("table", { name: "Alertes de direction" });
    fireEvent.click(within(within(table).getAllByRole("row")[1]!).getByRole("button", { name: "Détails" }));
    const notifications = await screen.findByRole("table", { name: "Notifications émises pour cette alerte" });
    expect(within(notifications).getByText("Ouverture")).toBeTruthy();
    expect(within(notifications).getByText("Rappel")).toBeTruthy();
    expect(screen.getByText(/respecte les préférences, consentements et heures calmes/)).toBeTruthy();
  });

  it("accusé de réception : note envoyée, alerte relue ; seulement pour une alerte ouverte et avec la permission", async () => {
    let acknowledged = false;
    const api = setTestApi(
      routes(undefined, {
        "GET /api/v1/analytics/alerts": () => json(acknowledged ? alertsData([{ ...alertsData().alerts[0]!, status: "ACKNOWLEDGED", acknowledgedAt: "2026-03-20T09:00:00.000Z" }]) : alertsData()),
        [`POST /api/v1/analytics/alerts/${aid(9001)}/acknowledge`]: ({ body }: { body: unknown }) => {
          acknowledged = true;
          return json({ ...alertsData().alerts[0]!, status: "ACKNOWLEDGED", acknowledgedAt: "2026-03-20T09:00:00.000Z", acknowledgementNote: (body as { note?: string }).note ?? null });
        },
      }),
    );
    renderWithProviders(<AlertsScreen />);
    const table = await screen.findByRole("table", { name: "Alertes de direction" });
    const buttons = within(table).getAllByRole("button", { name: "Accuser réception" });
    expect(buttons).toHaveLength(1); // seule l'alerte ouverte
    fireEvent.click(buttons[0]!);
    fireEvent.change(await screen.findByLabelText("Note (facultative)"), { target: { value: "Pris en charge par la vie scolaire" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmer l'accusé de réception" }));
    await waitFor(() => expect(calls(api, `/alerts/${aid(9001)}/acknowledge`, "POST")).toHaveLength(1));
    expect(calls(api, `/alerts/${aid(9001)}/acknowledge`, "POST")[0]!.body).toEqual({ note: "Pris en charge par la vie scolaire" });
    await waitFor(() => expect(within(screen.getByRole("table", { name: "Alertes de direction" })).queryByRole("button", { name: "Accuser réception" })).toBeNull());
  });

  it("sans analytics.alerts.acknowledge : pas de bouton ; sans analytics.export : pas d'export", async () => {
    setTestApi(routes(["analytics.alerts.read"]));
    renderWithProviders(<AlertsScreen />);
    const table = await screen.findByRole("table", { name: "Alertes de direction" });
    expect(within(table).queryByRole("button", { name: "Accuser réception" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Exporter (CSV)" })).toBeNull();
    expect(screen.getByRole("link", { name: "Règles d'alerte" }).getAttribute("href")).toBe("/v2/analytics/alertes/regles");
  });

  it("aucune alerte : état vide ; erreur de l'API : nouvelle tentative", async () => {
    let ok = false;
    setTestApi(routes(undefined, { "GET /api/v1/analytics/alerts": () => (ok ? json(alertsData([])) : json({ code: "x", message: "Alertes indisponibles." }, { status: 422 })) }));
    renderWithProviders(<AlertsScreen />);
    expect(await screen.findByText("Alertes indisponibles.")).toBeTruthy();
    ok = true;
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByText("Aucune alerte pour ces filtres.")).toBeTruthy();
  });
});

describe("Règles d'alerte", () => {
  const routes = (permissions = ["analytics.alerts.read", "analytics.alerts.manage"], extra: Record<string, unknown> = {}) => ({
    ...base(permissions),
    "GET /api/v1/analytics/alerts/metrics": alertMetrics(),
    "GET /api/v1/analytics/alerts/rules": alertRules(),
    ...extra,
  });

  it("liste : seuils, destinataires par rôle (clés inconnues telles quelles), fréquence, dernière évaluation", async () => {
    setTestApi(routes());
    renderWithProviders(<AlertRulesScreen />);
    const table = await screen.findByRole("table", { name: "Règles d'alerte de l'établissement" });
    const first = within(table).getByText("Présence trop basse").closest("tr")!;
    expect(within(first).getByText(/Attention : sous 85,00\s%/)).toBeTruthy();
    expect(within(first).getByText(/Critique : sous 70,00\s%/)).toBeTruthy();
    expect(within(first).getByText("Directeur, Propriétaire")).toBeTruthy();
    const second = within(table).getByText("Impayés élevés").closest("tr")!;
    expect(within(second).getByText("Économe, equipe_paie")).toBeTruthy();
    expect(within(second).getByText("Au plus un rappel par semaine")).toBeTruthy();
    expect(screen.getByText(/préférences, consentements et heures calmes/)).toBeTruthy();
  });

  it("lecture seule sans analytics.alerts.manage : ni création ni modification", async () => {
    setTestApi(routes(["analytics.alerts.read"]));
    renderWithProviders(<AlertRulesScreen />);
    await screen.findByRole("table", { name: "Règles d'alerte de l'établissement" });
    expect(screen.queryByRole("button", { name: "Nouvelle règle" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Modifier" })).toBeNull();
  });

  it("création : pourcentage converti en points de base, seuils, rôles cochés et rôle personnalisé, fenêtre par défaut", async () => {
    const api = setTestApi(routes(undefined, { "POST /api/v1/analytics/alerts/rules": ({ body }: { body: unknown }) => json({ ...alertRules().rules[0]!, id: aid(8003), ...(body as object) }, { status: 201 }) }));
    renderWithProviders(<AlertRulesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Nouvelle règle" }));
    fireEvent.change(screen.getByLabelText(/Nom de la règle/), { target: { value: "Présence critique" } });
    fireEvent.change(screen.getByLabelText(/Indicateur surveillé/), { target: { value: "ATTENDANCE_RATE" } });
    fireEvent.change(await screen.findByLabelText("Seuil d'attention"), { target: { value: "87,5" } });
    fireEvent.change(screen.getByLabelText("Seuil critique"), { target: { value: "70" } });
    fireEvent.click(screen.getByLabelText("Économe"));
    fireEvent.change(screen.getByLabelText(/Autres rôles/), { target: { value: "equipe_paie, coordination" } });
    fireEvent.change(screen.getByLabelText("Fréquence des rappels"), { target: { value: "WEEKLY" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la règle" }));
    await waitFor(() => expect(calls(api, "/alerts/rules", "POST")).toHaveLength(1));
    expect(calls(api, "/alerts/rules", "POST")[0]!.body).toEqual({
      label: "Présence critique",
      metric: "ATTENDANCE_RATE",
      warningValue: 8750,
      criticalValue: 7000,
      windowDays: 30,
      institutionId: null,
      campusId: null,
      recipientRoles: ["directeur", "econome", "equipe_paie", "coordination"],
      frequency: "WEEKLY",
      enabled: true,
    });
    expect(await screen.findByText("Règle enregistrée.")).toBeTruthy();
  });

  it("montant : saisi en francs entiers, une décimale est refusée", async () => {
    const api = setTestApi(routes(undefined, { "POST /api/v1/analytics/alerts/rules": ({ body }: { body: unknown }) => json({ ...alertRules().rules[1]!, ...(body as object) }, { status: 201 }) }));
    renderWithProviders(<AlertRulesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Nouvelle règle" }));
    fireEvent.change(screen.getByLabelText(/Nom de la règle/), { target: { value: "Impayés bloquants" } });
    fireEvent.change(screen.getByLabelText(/Indicateur surveillé/), { target: { value: "OVERDUE_AMOUNT" } });
    fireEvent.change(await screen.findByLabelText("Seuil d'attention"), { target: { value: "1,5" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la règle" }));
    expect(await screen.findByText("Saisissez un nombre valide.")).toBeTruthy();
    expect(calls(api, "/alerts/rules", "POST")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Seuil d'attention"), { target: { value: "5 000 000" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la règle" }));
    await waitFor(() => expect(calls(api, "/alerts/rules", "POST")).toHaveLength(1));
    expect(calls(api, "/alerts/rules", "POST")[0]!.body).toMatchObject({ metric: "OVERDUE_AMOUNT", warningValue: 5_000_000, criticalValue: null, windowDays: null });
  });

  it("validation avant envoi : seuil critique incohérent, aucun seuil, aucun rôle, nom trop court", async () => {
    const api = setTestApi(routes());
    renderWithProviders(<AlertRulesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Nouvelle règle" }));
    fireEvent.change(screen.getByLabelText(/Nom de la règle/), { target: { value: "ab" } });
    fireEvent.change(screen.getByLabelText(/Indicateur surveillé/), { target: { value: "ATTENDANCE_RATE" } });
    fireEvent.click(await screen.findByLabelText("Directeur")); // décoche le rôle par défaut
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la règle" }));
    expect(await screen.findByText("Le nom doit comporter de 3 à 120 caractères.")).toBeTruthy();
    expect(screen.getByText("Renseignez au moins un seuil (attention ou critique).")).toBeTruthy();
    expect(screen.getByText(/Choisissez de 1 à 8 rôles valides/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Nom de la règle/), { target: { value: "Présence" } });
    fireEvent.change(screen.getByLabelText("Seuil d'attention"), { target: { value: "70" } });
    fireEvent.change(screen.getByLabelText("Seuil critique"), { target: { value: "80" } });
    fireEvent.click(screen.getByLabelText("Directeur"));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la règle" }));
    expect(await screen.findByText("Le seuil critique doit être inférieur ou égal au seuil d'attention.")).toBeTruthy();
    expect(calls(api, "/alerts/rules", "POST")).toHaveLength(0);
  });

  it("modification : seuils relus en pourcentage, version transmise, indicateur non modifiable", async () => {
    const api = setTestApi(routes(undefined, { [`PUT /api/v1/analytics/alerts/rules/${aid(8001)}`]: ({ body }: { body: unknown }) => json({ ...alertRules().rules[0]!, ...(body as object), rowVersion: 2 }) }));
    renderWithProviders(<AlertRulesScreen />);
    const table = await screen.findByRole("table", { name: "Règles d'alerte de l'établissement" });
    fireEvent.click(within(within(table).getByText("Présence trop basse").closest("tr")!).getByRole("button", { name: "Modifier" }));
    expect((await screen.findByLabelText("Seuil d'attention") as HTMLInputElement).value).toBe("85");
    expect((screen.getByLabelText("Seuil critique") as HTMLInputElement).value).toBe("70");
    expect((screen.getByLabelText(/Indicateur surveillé/) as HTMLSelectElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/^Règle active/));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la règle" }));
    await waitFor(() => expect(calls(api, `/alerts/rules/${aid(8001)}`, "PUT")).toHaveLength(1));
    expect(calls(api, `/alerts/rules/${aid(8001)}`, "PUT")[0]!.body).toMatchObject({ rowVersion: 1, enabled: false, warningValue: 8500, criticalValue: 7000, recipientRoles: ["directeur", "owner"] });
  });

  it("conflit de version ou erreur de l'API : message affiché, formulaire conservé", async () => {
    setTestApi(routes(undefined, { "POST /api/v1/analytics/alerts/rules": () => json({ code: "analytics.alert_rule_conflict", message: "La règle a été modifiée entre-temps." }, { status: 409 }) }));
    renderWithProviders(<AlertRulesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Nouvelle règle" }));
    fireEvent.change(screen.getByLabelText(/Nom de la règle/), { target: { value: "Présence" } });
    fireEvent.change(screen.getByLabelText(/Indicateur surveillé/), { target: { value: "ATTENDANCE_RATE" } });
    fireEvent.change(await screen.findByLabelText("Seuil d'attention"), { target: { value: "80" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la règle" }));
    expect(await screen.findByText("La règle a été modifiée entre-temps.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enregistrer la règle" })).toBeTruthy();
  });

  it("le catalogue ne propose que les indicateurs permis par l'API", async () => {
    setTestApi(routes(undefined, { "GET /api/v1/analytics/alerts/metrics": alertMetrics(["SCHOOLLIFE_OPEN_INCIDENTS"]) }));
    renderWithProviders(<AlertRulesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Nouvelle règle" }));
    const select = await screen.findByLabelText(/Indicateur surveillé/);
    await waitFor(() => expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choisir…", "Incidents de vie scolaire ouverts"]));
  });
});
