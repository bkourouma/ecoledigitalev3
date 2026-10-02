// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { uuid } from "../../_test/fixtures";
import { batch, payslip, period, pid, report, run } from "../../_test/fixtures-payroll";
import { PeriodDetailScreen, PeriodsScreen } from "./Periods";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/payroll", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const MANAGER = ["payroll.period.manage", "payroll.run.calculate", "payroll.payslip.read", "payroll.payslip.approve", "payroll.payslip.pay"];
const posts = (api: ReturnType<typeof setTestApi>, suffix: string) => api.calls.filter((c) => c.method === "POST" && c.path.endsWith(suffix));
const year = { id: pid(2), institutionId: uuid(1), code: "2026-2027", label: "Année 2026-2027", startsOn: "2026-09-01", endsOn: "2027-08-31", status: "OPEN", isCurrent: true, openedAt: null, closedAt: null, archivedAt: null };

describe("PeriodsScreen", () => {
  it("liste les périodes ; une période en attente de calcul bloque la création", async () => {
    setTestApi({
      ...accessRoutes(MANAGER),
      "GET /api/v1/payroll/periods": { items: [period(), period({ id: pid(3), name: "Novembre 2026", status: "DRAFT", awaitingCalculation: true })], total: 2 },
      "GET /api/v1/payroll/periods/pending": { pending: period({ id: pid(3), name: "Novembre 2026", awaitingCalculation: true }) },
    });
    renderWithProviders(<PeriodsScreen />);
    const table = await screen.findByRole("table", { name: "Périodes de paie" });
    expect(await within(table).findByRole("link", { name: "Octobre 2026" })).toBeTruthy();
    expect(within(table).getByText("En attente de calcul")).toBeTruthy();
    expect(await screen.findByText(/La période « Novembre 2026 » est en attente de calcul/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Nouvelle période" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("création : validation du contrat puis envoi du corps", async () => {
    const api = setTestApi({
      ...accessRoutes(MANAGER),
      "GET /api/v1/payroll/periods": { items: [], total: 0 },
      "GET /api/v1/payroll/periods/pending": { pending: null },
      "GET /api/v1/academic/years": { items: [year] },
      "POST /api/v1/payroll/periods": ({ body }) => json(period({ name: (body as { name: string }).name }), { status: 201 }),
    });
    renderWithProviders(<PeriodsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Nouvelle période" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer la période" }));
    expect((await within(dialog).findAllByRole("alert")).length).toBeGreaterThan(0);
    expect(posts(api, "/periods")).toHaveLength(0);
    await within(dialog).findByRole("option", { name: "Année 2026-2027" });
    fireEvent.change(within(dialog).getByLabelText(/^Nom/), { target: { value: "Octobre 2026" } });
    fireEvent.change(within(dialog).getByLabelText(/^Du/), { target: { value: "2026-10-01" } });
    fireEvent.change(within(dialog).getByLabelText(/^Au/), { target: { value: "2026-10-31" } });
    fireEvent.change(within(dialog).getByLabelText(/^Année scolaire/), { target: { value: pid(2) } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer la période" }));
    await screen.findByText("La période « Octobre 2026 » a été créée.");
    expect(posts(api, "/periods")[0]!.body).toEqual({ name: "Octobre 2026", startDate: "2026-10-01", endDate: "2026-10-31", academicYearId: pid(2) });
  });

  it("sans droit de gestion des périodes : message et lien vers les bulletins, aucun appel", async () => {
    const api = setTestApi(accessRoutes(["payroll.payslip.read"]));
    renderWithProviders(<PeriodsScreen />);
    expect(await screen.findByText("Votre rôle ne permet pas de gérer les périodes de paie.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Voir les bulletins" })).toBeTruthy();
    expect(api.calls.some((c) => c.path.includes("/payroll/periods"))).toBe(false);
  });

  it("erreur de l'API", async () => {
    setTestApi({ ...accessRoutes(MANAGER), "GET /api/v1/payroll/periods": () => json({ code: "x", message: "La paie est momentanément indisponible." }, { status: 422 }), "GET /api/v1/payroll/periods/pending": { pending: null } });
    renderWithProviders(<PeriodsScreen />);
    expect(await screen.findByText("La paie est momentanément indisponible.")).toBeTruthy();
  });
});

describe("PeriodDetailScreen : calcul", () => {
  const base = {
    ...accessRoutes(MANAGER, ["payroll.session-source", "payroll.attendance-source"]),
    [`GET /api/v1/payroll/periods/${pid(1)}`]: period(),
    [`GET /api/v1/payroll/periods/${pid(1)}/runs`]: { items: [run()] },
    "GET /api/v1/payroll/payslips": { items: [payslip()], total: 1 },
  };

  it("aperçu : dryRun transmis, aucun enregistrement annoncé, écartés nommés avec leur motif", async () => {
    const api = setTestApi({ ...base, [`POST /api/v1/payroll/periods/${pid(1)}/calculate`]: () => json(report({ dryRun: true, runId: null })) });
    renderWithProviders(<PeriodDetailScreen id={pid(1)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Aperçu (sans enregistrer)" }));
    expect(await screen.findByText("Aperçu : aucun bulletin n'a été créé ni modifié.")).toBeTruthy();
    expect(posts(api, "/calculate")[0]!.body).toEqual({ scope: "ALL", recalculate: false, dryRun: true });
    expect(screen.getByText("BAMBA Awa")).toBeTruthy();
    expect(screen.getByText("Aucun tarif horaire applicable : ajoutez un tarif du cours ou un tarif par défaut.")).toBeTruthy();
    expect(screen.getByText("Aucun tarif pour Algèbre le 5 octobre.")).toBeTruthy();
    expect(screen.getByText("Aucune configuration de paie valide sur la période.")).toBeTruthy();
    expect(screen.getByText("Bulletin déjà arrêté, versé ou annulé : un recalcul ne le réécrit jamais.")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Résultat par enseignant" })).getByText(/344\D818\sF\sCFA/)).toBeTruthy();
  });

  it("détail d'un aperçu : lignes d'heures avec tarif, majoration et origine du tarif", async () => {
    const preview = {
      kind: "MIXED",
      salary: 200000,
      regularHours: 100000,
      overtime: 44818,
      bonus: 0,
      deduction: 0,
      total: 344818,
      regularMinutes: 2400,
      overtimeMinutes: 120,
      lines: [{ position: 1, source: "SESSION", sourceRefId: pid(31), date: "2026-10-05", startTime: "08:00", minutes: 120, rate: 5000, multiplierPermille: 1500, amount: 15000, isOvertime: true, rateOrigin: "NODE_GENERIC", label: "Algèbre", code: "MATH", classroomLabel: "6e A" }],
      details: {},
    };
    setTestApi({
      ...base,
      [`POST /api/v1/payroll/periods/${pid(1)}/calculate`]: () => json(report({ dryRun: true, runId: null, items: [{ ...report().items[0]!, preview }] })),
    });
    renderWithProviders(<PeriodDetailScreen id={pid(1)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Aperçu (sans enregistrer)" }));
    fireEvent.click(await screen.findByRole("button", { name: /Voir le détail/ }));
    const table = await screen.findByRole("table", { name: /Lignes d'heures — KOUASSI Marc/ });
    expect(within(table).getByText(/^5\D000\sF\sCFA$/)).toBeTruthy();
    expect(within(table).getByText("×1,5")).toBeTruthy();
    expect(within(table).getByText("Tarif générique du cours")).toBeTruthy();
    expect(within(table).getByText("2 h")).toBeTruthy();
  });

  it("calcul puis recalcul (confirmation) avec périmètre et origine", async () => {
    const api = setTestApi({ ...base, [`POST /api/v1/payroll/periods/${pid(1)}/calculate`]: () => json(report()) });
    renderWithProviders(<PeriodDetailScreen id={pid(1)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Lancer le calcul" }));
    await screen.findByText("Compte rendu du calcul");
    expect(posts(api, "/calculate")[0]!.body).toEqual({ scope: "ALL", recalculate: false, dryRun: false });
    fireEvent.change(screen.getByLabelText(/^Origine des heures/), { target: { value: "ATTENDANCE" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Recalculer les bulletins déjà calculés/ }));
    fireEvent.click(screen.getByRole("button", { name: "Recalculer" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Primes et retenues sont conservées/)).toBeTruthy();
    expect(posts(api, "/calculate")).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Recalculer" }));
    await waitFor(() => expect(posts(api, "/calculate")).toHaveLength(2));
    expect(posts(api, "/calculate")[1]!.body).toEqual({ scope: "ATTENDANCE", recalculate: true, dryRun: false });
  });

  it("origines proposées selon l'offre : sans source, seulement « toutes »", async () => {
    setTestApi({ ...base, ...accessRoutes(MANAGER, []) });
    renderWithProviders(<PeriodDetailScreen id={pid(1)} />);
    const select = (await screen.findByLabelText(/^Origine des heures/)) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["ALL"]);
  });

  it("erreur de calcul (verrou, limite…) : message de l'API", async () => {
    setTestApi({ ...base, [`POST /api/v1/payroll/periods/${pid(1)}/calculate`]: () => json({ code: "payroll.run_in_progress", message: "Un calcul est déjà en cours pour cette période." }, { status: 409 }) });
    renderWithProviders(<PeriodDetailScreen id={pid(1)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Lancer le calcul" }));
    expect(await screen.findByText("Un calcul est déjà en cours pour cette période.")).toBeTruthy();
  });

  it("historique des calculs", async () => {
    setTestApi(base);
    renderWithProviders(<PeriodDetailScreen id={pid(1)} />);
    expect(await screen.findByText(/1 calculés · 2 écartés · 1 verrouillés · 0 en échec/)).toBeTruthy();
  });
});

describe("PeriodDetailScreen : arrêt et versement", () => {
  const base = {
    ...accessRoutes(MANAGER, []),
    [`GET /api/v1/payroll/periods/${pid(1)}`]: period(),
    [`GET /api/v1/payroll/periods/${pid(1)}/runs`]: { items: [] },
    "GET /api/v1/payroll/payslips": { items: [payslip(), payslip({ id: pid(11), staffId: pid(21), staffName: "BAMBA Awa", status: "DISPUTED", disputeReason: "Heures contestées", totalAmount: 90000 })], total: 2 },
  };

  it("« Tout arrêter » : sélection faite par le serveur ({ all: true, periodId })", async () => {
    const api = setTestApi({ ...base, "POST /api/v1/payroll/payslips/approve": () => json(batch({ done: [pid(10)] })) });
    renderWithProviders(<PeriodDetailScreen id={pid(1)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Tout arrêter" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/sélection faite par le serveur/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Arrêter" }));
    await screen.findByText("Opération d'arrêt terminée.");
    expect(posts(api, "/payslips/approve")[0]!.body).toEqual({ all: true, periodId: pid(1) });
  });

  it("sélection : seuls les identifiants cochés sont transmis ; refus expliqués (séparation des tâches, seuil propriétaire)", async () => {
    const api = setTestApi({
      ...base,
      "POST /api/v1/payroll/payslips/approve": () =>
        json(
          batch({
            rejected: [
              { payslipId: pid(10), code: "payroll.separation_of_duties", message: "Séparation des tâches : celui qui a calculé le bulletin ne peut pas l'arrêter." },
              { payslipId: pid(11), code: "payroll.owner_approval_required", message: "Ce montant dépasse le seuil : seul le propriétaire peut arrêter ce bulletin." },
            ],
          }),
        ),
    });
    renderWithProviders(<PeriodDetailScreen id={pid(1)} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Sélectionner KOUASSI Marc" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Sélectionner BAMBA Awa" }));
    fireEvent.click(screen.getByRole("button", { name: "Arrêter la sélection (2)" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Arrêter" }));
    const list = await screen.findByRole("list", { name: "Bulletins refusés" });
    expect(posts(api, "/payslips/approve")[0]!.body).toEqual({ payslipIds: [pid(10), pid(11)] });
    expect(within(list).getByText(/Séparation des tâches : celui qui a calculé le bulletin ne peut pas l'arrêter\./)).toBeTruthy();
    expect(within(list).getByText(/faites arrêter ce bulletin par une autre personne/)).toBeTruthy();
    expect(within(list).getByText(/seul le propriétaire peut l'arrêter, depuis « Masse salariale »/)).toBeTruthy();
    expect(within(list).getByText(/KOUASSI Marc/)).toBeTruthy();
  });

  it("versement : mode et référence transmis", async () => {
    const api = setTestApi({ ...base, "POST /api/v1/payroll/payslips/pay": () => json(batch({ done: [pid(10)] })) });
    renderWithProviders(<PeriodDetailScreen id={pid(1)} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Sélectionner KOUASSI Marc" }));
    fireEvent.click(screen.getByRole("button", { name: "Verser la sélection (1)" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Mode de versement/), { target: { value: "BANK_TRANSFER" } });
    fireEvent.change(within(dialog).getByLabelText(/^Référence/), { target: { value: "VIR-2026-10-001" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Constater le versement" }));
    await screen.findByText("Opération de versement terminée.");
    expect(posts(api, "/payslips/pay")[0]!.body).toEqual({ payslipIds: [pid(10)], method: "BANK_TRANSFER", reference: "VIR-2026-10-001" });
  });

  it("bulletins contestés : motif affiché ; sans droit d'arrêt ni de versement : aucun bouton", async () => {
    setTestApi({ ...base, ...accessRoutes(["payroll.period.manage", "payroll.payslip.read"]) });
    renderWithProviders(<PeriodDetailScreen id={pid(1)} />);
    expect(await screen.findByText("Heures contestées")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Tout arrêter" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Tout verser" })).toBeNull();
  });

  it("clôture de la période : confirmation puis PATCH du statut", async () => {
    const api = setTestApi({ ...base, [`PATCH /api/v1/payroll/periods/${pid(1)}`]: () => json(period({ status: "CLOSED" })) });
    renderWithProviders(<PeriodDetailScreen id={pid(1)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Clôturer la période" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clôturer" }));
    await screen.findByText("Le statut de la période a été mis à jour.");
    expect(api.calls.find((c) => c.method === "PATCH")!.body).toEqual({ status: "CLOSED" });
  });
});
