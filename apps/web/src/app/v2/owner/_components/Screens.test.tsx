// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { aged, cash, collections, env, financeSummary, freshness, meta, payroll, receivables, results, scopes, teachingLoad } from "../_test/fixtures-analytics";
import { ChargesScreen, FreshnessScreen, PayrollMassScreen } from "./PayrollCharges";
import { PedagogyScreen } from "./Pedagogy";
import { TreasuryScreen, TuitionScreen } from "./Finance";

const csv = vi.hoisted(() => ({ downloadText: vi.fn() }));
vi.mock("@/platform/ui/csv", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/platform/ui/csv")>()), downloadText: csv.downloadText }));
vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/owner/scolarite", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const FEATURES = ["analytics.direction", "analytics.payroll-insights"];
const base = (permissions: string[], features = FEATURES) => ({ ...accessRoutes(permissions, features), "GET /api/v1/analytics/scopes": env(scopes()) });
const calls = (api: ReturnType<typeof setTestApi>, suffix: string) => api.calls.filter((c) => c.path.endsWith(suffix));

describe("fonctionnalité et accès", () => {
  it("sans la fonctionnalité de l'offre : message explicite, aucune requête de données", async () => {
    const api = setTestApi({ ...base(["analytics.finance.read"], []), "GET /api/v1/analytics/finance/summary": env(financeSummary()) });
    renderWithProviders(<TuitionScreen />);
    expect(await screen.findByText(/n'est pas inclus dans l'offre/)).toBeTruthy();
    expect(calls(api, "/finance/summary")).toHaveLength(0);
  });
});

describe("Scolarité", () => {
  const routes = (extra: Record<string, unknown> = {}) => ({
    ...base(["analytics.finance.read", "analytics.export"]),
    "GET /api/v1/analytics/finance/summary": env(financeSummary()),
    "GET /api/v1/analytics/finance/receivables": ({ url }: { url: URL }) => json(env(receivables(url.searchParams.get("by") === "learner" ? "learner" : "class"))),
    ...extra,
  });

  it("indicateurs : montants entiers en F CFA, taux en points de base, état dit en toutes lettres, horodatage asOf", async () => {
    setTestApi(routes());
    renderWithProviders(<TuitionScreen />);
    const billed = await screen.findByText("Facturé", { selector: "dt" });
    expect(within(billed.parentElement!).getByText(/60\D000\D000\sF\sCFA/)).toBeTruthy();
    expect(within(billed.parentElement!).getByText("120 facture(s)")).toBeTruthy();
    const rate = screen.getByText("Taux de recouvrement", { selector: "dt" });
    expect(within(rate.parentElement!).getByText(/69,49\s%/)).toBeTruthy();
    expect(within(rate.parentElement!).getByText("À surveiller")).toBeTruthy(); // l'état vient de l'API (seuils de l'établissement)
    const overdue = screen.getByText("En retard", { selector: "dt" });
    expect(within(overdue.parentElement!).getByText(/7\D500\D000\sF\sCFA/)).toBeTruthy();
    expect(screen.getByText(/Données au/)).toBeTruthy();
  });

  it("graphique par classe : valeurs en texte et alternative tableau", async () => {
    setTestApi(routes());
    renderWithProviders(<TuitionScreen />);
    const figure = await screen.findByRole("figure", { name: "Taux de recouvrement par classe" });
    const items = within(figure).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[1]!.textContent).toMatch(/5e B.*58,62\s%/);
    expect(within(figure).getByText("Afficher les données en tableau")).toBeTruthy();
    expect(within(figure).getByRole("table", { hidden: true })).toBeTruthy();
  });

  it("aucune facture : « Non mesuré » et manque déclaré, jamais un zéro", async () => {
    setTestApi(
      routes({
        "GET /api/v1/analytics/finance/summary": env(financeSummary({ summary: null, currency: null, asOfDate: null, byClassroom: [] }), { asOf: null, stale: true, gaps: [{ source: "FINANCE", reason: "NOT_WIRED", message: "Facturation et créances : source non branchée sur cette plateforme (indisponible)." }] }),
      }),
    );
    renderWithProviders(<TuitionScreen />);
    expect((await screen.findAllByText("Non mesuré")).length).toBeGreaterThan(3);
    expect(screen.getByText(/source non branchée/)).toBeTruthy();
    expect(screen.getByText("Aucune donnée n'a encore été calculée pour cet écran.")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Indicateurs de scolarité" })).queryByText(/(^|\D)0\sF\sCFA/)).toBeNull();
  });

  it("données périmées : alerte de fraîcheur", async () => {
    setTestApi(routes({ "GET /api/v1/analytics/finance/summary": env(financeSummary(), { stale: true }) }));
    renderWithProviders(<TuitionScreen />);
    expect(await screen.findByText(/ne sont peut-être plus à jour/)).toBeTruthy();
  });

  it("créances par apprenant : appel avec by=learner, noms et plus ancienne échéance fournis par l'API", async () => {
    const api = setTestApi(routes());
    renderWithProviders(<TuitionScreen />);
    await screen.findByText("Facturé", { selector: "dt" });
    fireEvent.change(screen.getByLabelText("Regrouper par"), { target: { value: "learner" } });
    expect(await screen.findByText("KONE Mariam")).toBeTruthy();
    await waitFor(() => expect(calls(api, "/finance/receivables").some((c) => c.query.by === "learner" && c.query.onlyOutstanding === "true")).toBe(true));
    expect(screen.getByText(/30 nov\. 2025/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Seulement les restes dus"));
    await waitFor(() => expect(calls(api, "/finance/receivables").some((c) => c.query.onlyOutstanding === "false")).toBe(true));
  });

  it("filtre de campus : transmis à l'API ; les valeurs vides ne sont pas envoyées", async () => {
    const api = setTestApi(routes());
    renderWithProviders(<TuitionScreen />);
    await screen.findByText("Facturé", { selector: "dt" });
    expect(calls(api, "/finance/summary")[0]!.query).toEqual({});
    fireEvent.change(screen.getByLabelText("Campus"), { target: { value: "00000000-0000-4000-8000-000000000002" } });
    await waitFor(() => expect(calls(api, "/finance/summary").some((c) => c.query.campusId === "00000000-0000-4000-8000-000000000002")).toBe(true));
  });

  it("export : le CSV est celui de l'API (audité), enregistré tel quel ; masqué sans analytics.export", async () => {
    csv.downloadText.mockClear();
    const api = setTestApi(routes({ "GET /api/v1/analytics/export/receivables-by-classroom.csv": () => new Response("﻿Classe;Facturé\r\n", { status: 200, headers: { "content-type": "text/csv" } }) }));
    renderWithProviders(<TuitionScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Exporter (CSV)" }));
    await waitFor(() => expect(csv.downloadText).toHaveBeenCalledTimes(1));
    expect(csv.downloadText.mock.calls[0]![0]).toBe("analytics-receivables-by-classroom.csv");
    expect(csv.downloadText.mock.calls[0]![1]).toBe("﻿Classe;Facturé\r\n");
    expect(calls(api, "/export/receivables-by-classroom.csv")).toHaveLength(1);

    setTestApi({ ...base(["analytics.finance.read"]), "GET /api/v1/analytics/finance/summary": env(financeSummary()), "GET /api/v1/analytics/finance/receivables": env(receivables()) });
    renderWithProviders(<TuitionScreen />);
    await screen.findAllByText("Facturé", { selector: "dt" });
    expect(screen.queryAllByRole("button", { name: "Exporter (CSV)" })).toHaveLength(1); // celui du premier rendu seulement
  });

  it("erreur de l'API : message et nouvelle tentative", async () => {
    setTestApi(routes({ "GET /api/v1/analytics/finance/summary": () => json({ code: "analytics.campus_required", message: "Sélectionnez un campus : la facturation est suivie par campus." }, { status: 400 }) }));
    renderWithProviders(<TuitionScreen />);
    expect(await screen.findByText("Sélectionnez un campus : la facturation est suivie par campus.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeTruthy();
  });
});

describe("Trésorerie", () => {
  const routes = () => ({
    ...base(["analytics.treasury.read"]),
    "GET /api/v1/analytics/treasury/collections": env(collections()),
    "GET /api/v1/analytics/treasury/aged": env(aged()),
    "GET /api/v1/analytics/treasury/cash": env(cash()),
  });

  it("encaissements nets, créances âgées (tranches nommées) et écarts de caisse dits en toutes lettres", async () => {
    setTestApi(routes());
    renderWithProviders(<TreasuryScreen />);
    const net = await screen.findByText("Net", { selector: "dt" });
    expect(within(net.parentElement!).getByText(/10\D900\D000\sF\sCFA/)).toBeTruthy();
    const aging = await screen.findByRole("figure", { name: /Restes dus par ancienneté/ });
    const buckets = within(aging).getAllByRole("listitem");
    expect(buckets.map((b) => b.textContent)).toEqual([expect.stringContaining("Non échu"), expect.stringContaining("1 à 30 jours"), expect.stringContaining("31 à 60 jours"), expect.stringContaining("61 à 90 jours"), expect.stringContaining("Plus de 90 jours")]);
    const variance = screen.getByText("Écart net", { selector: "dt" });
    expect(within(variance.parentElement!).getByText(/Il manque 5\D000\sF\sCFA/)).toBeTruthy();
    expect(screen.getByText("Encore ouverte")).toBeTruthy();
    const sessions = screen.getByRole("table", { name: "Sessions de caisse" });
    expect(within(sessions).getByText(/Il manque 5\D000\sF\sCFA/)).toBeTruthy();
    expect(within(sessions).getAllByText("—").length).toBeGreaterThan(0); // session ouverte : ni attendu, ni compté, ni écart
  });

  it("regroupement et fenêtre transmis à l'API", async () => {
    const api = setTestApi(routes());
    renderWithProviders(<TreasuryScreen />);
    await screen.findByText("Net", { selector: "dt" });
    fireEvent.change(screen.getByLabelText("Regroupement"), { target: { value: "week" } });
    fireEvent.change(screen.getByLabelText("Du"), { target: { value: "2026-01-01" } });
    await waitFor(() => expect(calls(api, "/treasury/collections").some((c) => c.query.granularity === "week" && c.query.from === "2026-01-01")).toBe(true));
  });
});

describe("Pédagogie", () => {
  const routes = () => ({
    ...base(["analytics.pedagogy.read"]),
    "GET /api/v1/analytics/pedagogy/results": env(results(), { scope: { institutionId: null, campusId: null, yearId: "00000000-0000-4000-8000-00000000000a", periodId: "00000000-0000-4000-8000-000000000015", from: null, to: null } }),
    "GET /api/v1/analytics/pedagogy/teaching-load": env(teachingLoad()),
  });

  it("moyenne, taux de validation et décisions tels que renvoyés par l'API (FINAL de results)", async () => {
    setTestApi(routes());
    renderWithProviders(<PedagogyScreen />);
    const average = await screen.findByText("Moyenne générale", { selector: "dt" });
    expect(within(average.parentElement!).getByText(/12,35/)).toBeTruthy();
    const validation = screen.getByText("Taux de validation", { selector: "dt" });
    expect(within(validation.parentElement!).getByText(/70,00\s%/)).toBeTruthy();
    const decisions = within(screen.getByRole("figure", { name: "Décisions de la période" })).getAllByRole("listitem");
    expect(decisions[0]!.textContent).toContain("Admis (ADMITTED)");
    const yearEnd = within(screen.getByRole("figure", { name: "Décisions de fin d'année" })).getAllByRole("listitem");
    expect(yearEnd[0]!.textContent).toContain("Redoublement (REPEAT)");
    expect(screen.getByText(/1 classe\(s\) pas encore clôturée\(s\)/)).toBeTruthy();
  });

  it("distribution : l'histogramme est un affichage (échelle et classes), avec son tableau", async () => {
    setTestApi(routes());
    renderWithProviders(<PedagogyScreen />);
    expect(await screen.findByText(/Ce n'est pas un seuil de réussite/)).toBeTruthy();
    const chart = screen.getByRole("figure", { name: "Moyennes par classe de notes" });
    expect(within(chart).getByRole("img", { name: /Répartition de 40 moyennes par tranche/ })).toBeTruthy();
    const rows = within(chart).getAllByRole("row", { hidden: true });
    expect(rows).toHaveLength(11); // en-tête + 10 classes
  });

  it("matières à faible validation : les UE sont exclues du classement, la plus faible en premier", async () => {
    setTestApi(routes());
    renderWithProviders(<PedagogyScreen />);
    const figure = await screen.findByRole("figure", { name: "Matières avec le plus faible taux de validation" });
    const items = within(figure).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain("Mathématiques");
    expect(items[1]!.textContent).toContain("Français");
    expect(within(figure).queryByText("UE Fondamentale")).toBeNull();
    // le tableau complet, lui, contient la UE
    expect(within(screen.getByRole("table", { name: "Résultats clôturés par matière ou unité" })).getByText("UE Fondamentale")).toBeTruthy();
  });

  it("charge d'enseignement : lue côté API, visible avec analytics.pedagogy.read", async () => {
    setTestApi(routes());
    renderWithProviders(<PedagogyScreen />);
    expect(await screen.findByText("Enseignant Un")).toBeTruthy();
    expect(screen.getByText(/1 enseignant\(s\) · 17,5 heures prévues/)).toBeTruthy();
  });

  it("période non demandée : l'écran n'en envoie pas (c'est l'API qui choisit la dernière clôturée)", async () => {
    const api = setTestApi(routes());
    renderWithProviders(<PedagogyScreen />);
    await screen.findByText("Moyenne générale", { selector: "dt" });
    expect(calls(api, "/pedagogy/results")[0]!.query.periodId).toBeUndefined();
    fireEvent.change(screen.getByLabelText("Période"), { target: { value: "00000000-0000-4000-8000-000000000014" } });
    await waitFor(() => expect(calls(api, "/pedagogy/results").some((c) => c.query.periodId === "00000000-0000-4000-8000-000000000014")).toBe(true));
  });
});

describe("Masse salariale (sensible)", () => {
  it("masse comptée, annulés et contestés à part, statuts nommés", async () => {
    setTestApi({ ...base(["analytics.payroll.read", "analytics.export"]), "GET /api/v1/analytics/payroll/mass": env(payroll()) });
    renderWithProviders(<PayrollMassScreen />);
    const counted = await screen.findByText("Masse comptée", { selector: "dt" });
    expect(within(counted.parentElement!).getByText(/3\D000\D000\sF\sCFA/)).toBeTruthy();
    expect(screen.getByText(/annulés et contestés sont exclus du total/)).toBeTruthy();
    expect(screen.getByText(/authentification forte est exigée/i)).toBeTruthy();
    const table = screen.getByRole("table", { name: "Masse salariale par période de paie" });
    expect(within(table).getByText("Février 2026")).toBeTruthy();
    expect(within(table).getAllByText("Payé").length).toBeGreaterThan(0);
    expect(within(table).getAllByText(/1 · 120\D000\sF\sCFA/).length).toBeGreaterThan(0);
  });

  it("sans fonctionnalité de paie : aucune requête", async () => {
    const api = setTestApi({ ...base(["analytics.payroll.read"], ["analytics.direction"]), "GET /api/v1/analytics/payroll/mass": env(payroll()) });
    renderWithProviders(<PayrollMassScreen />);
    expect(await screen.findByText(/n'est pas inclus dans l'offre/)).toBeTruthy();
    expect(calls(api, "/payroll/mass")).toHaveLength(0);
  });

  it("MFA exigée : le message de l'API est affiché", async () => {
    setTestApi({ ...base(["analytics.payroll.read"]), "GET /api/v1/analytics/payroll/mass": () => json({ code: "rbac.mfa_required", message: "Authentification forte (MFA) requise pour cette action." }, { status: 403 }) });
    renderWithProviders(<PayrollMassScreen />);
    expect(await screen.findByText("Authentification forte (MFA) requise pour cette action.")).toBeTruthy();
  });
});

describe("Charges et résultat", () => {
  it("le manque est dit, aucun chiffre n'est affiché", async () => {
    setTestApi({ ...base(["analytics.charges.read"]), "GET /api/v1/analytics/charges": env({ available: false, reason: "MODULE_MISSING" as const, message: "Aucun module de charges n'est disponible." }, { gaps: [{ source: "CHARGES", reason: "MODULE_MISSING", message: "Module de charges et de résultat absent (spec 014/015 non livrées)." }] }) });
    renderWithProviders(<ChargesScreen />);
    expect(await screen.findByText("Module de charges absent")).toBeTruthy();
    expect(screen.getByText("Aucun module de charges n'est disponible.")).toBeTruthy();
    expect(screen.getByText("Compte de résultat (produits moins charges)")).toBeTruthy();
    expect(screen.queryByText(/F\sCFA/)).toBeNull();
  });
});

describe("Fraîcheur et reconstruction", () => {
  it("état de chaque source en français ; reconstruction demandée avec analytics.rebuild", async () => {
    const api = setTestApi({
      ...base(["analytics.read", "analytics.rebuild"]),
      "GET /api/v1/analytics/freshness": env(freshness(), { gaps: [{ source: "PAYROLL", reason: "NOT_WIRED", message: "Paie : source non branchée sur cette plateforme (Source non branchée.)." }] }),
      "POST /api/v1/analytics/rebuild": () => json({ requested: true, requestId: "00000000-0000-4000-8000-0000000000aa", queued: true }, { status: 202 }),
    });
    renderWithProviders(<FreshnessScreen />);
    const table = await screen.findByRole("table", { name: "État de la lecture des sources" });
    expect(within(table).getByText("Inscriptions")).toBeTruthy();
    expect(within(table).getByText("Source indisponible")).toBeTruthy();
    expect(within(table).getByText("Jamais")).toBeTruthy();
    expect(screen.getByText(/En file : 2 · en échec : 1 · source indisponible : 0/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reconstruire depuis les sources" }));
    expect(await screen.findByText(/La reconstruction est en file/)).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "POST" && c.path.endsWith("/rebuild"))).toHaveLength(1);
  });

  it("réglages d'affichage : pourcentages convertis en points de base, incohérence refusée, aucun appel si invalide", async () => {
    let stored: Record<string, unknown> = { collectionGoodBps: 8000, collectionWarningBps: 6000, attendanceGoodBps: 8500, attendanceWarningBps: 7000, staleAfterSeconds: 86_400, source: "DEFAULT" };
    const api = setTestApi({
      ...base(["analytics.read", "analytics.settings.manage"]),
      "GET /api/v1/analytics/freshness": env(freshness()),
      "GET /api/v1/analytics/settings": () => json(stored),
      "PUT /api/v1/analytics/settings": ({ body }: { body: unknown }) => ((stored = { ...(body as object), source: "TENANT" }), json(stored)),
    });
    renderWithProviders(<FreshnessScreen />);
    const good = await screen.findByLabelText(/^Recouvrement : « Bon »/);
    expect((good as HTMLInputElement).value).toBe("80");
    expect(screen.getByText(/Valeurs par défaut de la plateforme/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/^Recouvrement : « À surveiller »/), { target: { value: "95" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les réglages" }));
    expect(await screen.findByText("Le seuil « À surveiller » ne peut pas dépasser le seuil « Bon ».")).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(0);

    fireEvent.change(screen.getByLabelText(/^Recouvrement : « À surveiller »/), { target: { value: "62,5" } });
    fireEvent.change(screen.getByLabelText(/^Donnée « ancienne »/), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les réglages" }));
    expect(await screen.findByText("Les réglages sont enregistrés.")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({ collectionGoodBps: 8000, collectionWarningBps: 6250, attendanceGoodBps: 8500, attendanceWarningBps: 7000, staleAfterSeconds: 43_200 });
    expect(await screen.findByText("Réglages de l'établissement.")).toBeTruthy();
  });

  it("sans analytics.settings.manage : pas de formulaire de réglages", async () => {
    const api = setTestApi({ ...base(["analytics.read"]), "GET /api/v1/analytics/freshness": env(freshness()), "GET /api/v1/analytics/settings": { collectionGoodBps: 8000, collectionWarningBps: 6000, attendanceGoodBps: 8500, attendanceWarningBps: 7000, staleAfterSeconds: 86_400, source: "DEFAULT" } });
    renderWithProviders(<FreshnessScreen />);
    await screen.findByRole("table", { name: "État de la lecture des sources" });
    expect(screen.queryByRole("button", { name: "Enregistrer les réglages" })).toBeNull();
    expect(calls(api, "/settings")).toHaveLength(0);
  });

  it("sans analytics.rebuild : pas de bouton", async () => {
    setTestApi({ ...base(["analytics.read"]), "GET /api/v1/analytics/freshness": env(freshness()) });
    renderWithProviders(<FreshnessScreen />);
    await screen.findByRole("table", { name: "État de la lecture des sources" });
    expect(screen.queryByRole("button", { name: "Reconstruire depuis les sources" })).toBeNull();
    expect(meta().gaps).toEqual([]);
  });
});
