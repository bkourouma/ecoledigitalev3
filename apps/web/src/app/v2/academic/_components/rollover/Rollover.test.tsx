// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { academicRolloverPlanDtoSchema, academicRolloverRunDtoSchema } from "@ecoledigitale/contracts/v2/academic";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { uuid, year } from "../../../_test/fixtures";
import { ROLLOVER_FROM, ROLLOVER_TO, rolloverPlan, rolloverReport, rolloverRun } from "../../../_test/fixtures-rollover";
import { RolloverGate } from "./RolloverGate";
import { RolloverHistory } from "./RolloverHistory";
import { RolloverRunView } from "./RolloverRunView";
import { RolloverWizard, targetYearsOf } from "./RolloverWizard";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/academic/rollover", useRouter: () => ({ push: nav.push, replace: vi.fn() }) }));

const ACCESS = accessRoutes(["academic.read", "academic.year.rollover"], ["academic.rollover"]);
const YEARS = {
  "GET /api/v1/academic/years": {
    items: [
      year({ id: ROLLOVER_FROM, label: "Année 2025-2026", code: "2025-2026", status: "CLOSED", startsOn: "2025-09-01", endsOn: "2026-08-31" }),
      year({ id: ROLLOVER_TO, label: "Année 2026-2027", code: "2026-2027", status: "DRAFT", startsOn: "2026-09-01", endsOn: "2027-08-31" }),
      year({ id: uuid(103), label: "Année 2024-2025", code: "2024-2025", status: "DRAFT", startsOn: "2024-09-01", endsOn: "2025-08-31" }),
    ],
  },
};
const PLAN_PATH = `GET /api/v1/academic/years/${ROLLOVER_FROM}/rollover/plan`;
const RUN_ID = uuid(9000);

beforeEach(() => nav.push.mockReset());

describe("fixtures", () => {
  it("l'aperçu et l'exécution de test respectent les contrats", () => {
    expect(academicRolloverPlanDtoSchema.safeParse(rolloverPlan()).success).toBe(true);
    expect(academicRolloverRunDtoSchema.safeParse(rolloverRun({ status: "COMPLETED", report: rolloverReport() })).success).toBe(true);
  });
});

describe("targetYearsOf", () => {
  it("ne propose que des années brouillon ou ouvertes, postérieures à la source", () => {
    const all = YEARS["GET /api/v1/academic/years"].items as never[];
    const from = all[0] as { id: string; startsOn: string };
    const ids = targetYearsOf(all, from as never).map((y) => y.id);
    expect(ids).toEqual([ROLLOVER_TO]);
  });
});

async function selectYears() {
  const from = (await screen.findByLabelText(/Année source/)) as HTMLSelectElement;
  await waitFor(() => expect(from.options.length).toBeGreaterThan(1));
  fireEvent.change(from, { target: { value: ROLLOVER_FROM } });
  await waitFor(() => expect((screen.getByLabelText(/Année cible/) as HTMLSelectElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText(/Année cible/), { target: { value: ROLLOVER_TO } });
  fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
}

describe("RolloverWizard", () => {
  it("parcours complet : années, étapes, aperçu (avertissements, anomalies), confirmation puis lancement avec clé d'idempotence", async () => {
    const api = setTestApi({
      ...ACCESS,
      ...YEARS,
      [PLAN_PATH]: rolloverPlan(),
      [`POST /api/v1/academic/years/${ROLLOVER_FROM}/rollover/runs`]: () => json(rolloverRun({ id: RUN_ID, status: "PENDING", progress: { stage: null, steps: [] } }), { status: 202 }),
    });
    renderWithProviders(<RolloverWizard />);

    // 1) Sans choix, l'assistant refuse d'avancer et nomme le champ manquant.
    fireEvent.click(await screen.findByRole("button", { name: "Suivant" }));
    expect(await screen.findByText("Choisissez l'année source.")).toBeTruthy();
    expect(screen.getByText("Choisissez l'année cible.")).toBeTruthy();

    await selectYears();

    // 2) Étapes : l'offre « à la carte » est masquée (fonction absente) ; toutes les autres sont cochées.
    expect(await screen.findByRole("checkbox", { name: /Calendrier et périodes/ })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /Offres de cours à la carte/ })).toBeNull();
    for (const label of [/Jours fériés/, /Curriculum/, /^Classes/, /Réinscriptions/]) expect((screen.getByRole("checkbox", { name: label }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));

    // 3) Aperçu : requête de plan exacte, sans aucune écriture.
    expect(await screen.findByText("Aperçu en lecture seule : aucune donnée n'a été modifiée.")).toBeTruthy();
    const planCall = api.calls.find((c) => c.path.endsWith("/rollover/plan"))!;
    expect(planCall.query).toEqual({ toAcademicYearId: ROLLOVER_TO, steps: "PERIODS,HOLIDAYS,CURRICULUM,CLASSROOMS,ENROLLMENTS", createMissingClassrooms: "true" });
    // Avertissements bien visibles, avec message du serveur et lien vers la correction.
    const warnings = screen.getAllByRole("alert").find((a) => a.textContent?.includes("avertissements à examiner"))!;
    expect(within(warnings).getByText("Jours à ressaisir (fêtes mobiles)")).toBeTruthy();
    expect(within(warnings).getByText("1 élève sans décision de passage.")).toBeTruthy();
    expect(within(warnings).getAllByRole("link", { name: "Ouvrir l'écran de correction" }).map((l) => l.getAttribute("href"))).toEqual(["/v2/academic/settings?tab=calendar", "/v2/results/decisions"]);
    // Curriculum : action par programme (source manquante signalée).
    const curriculum = screen.getByRole("table", { name: "Curriculum par programme" });
    expect(within(curriculum).getByText("Sera cloné")).toBeTruthy();
    expect(within(curriculum).getByText("Aucune source")).toBeTruthy();
    // Réinscriptions : répartition par issue et anomalie par code avec lien vers l'inscription.
    expect(screen.getByText("ADMIS : 10")).toBeTruthy();
    expect(screen.getByText("Décision de fin d'année manquante : 1")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ouvrir l'inscription" }).getAttribute("href")).toBe(`/v2/enrollments/${uuid(1001)}`);
    expect(api.calls.filter((c) => c.method !== "GET")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));

    // 4) Confirmation explicite : la case « j'ai vérifié l'aperçu » est obligatoire.
    fireEvent.click(await screen.findByRole("button", { name: "Lancer la reconduction" }));
    expect(await screen.findByText("Confirmez que vous avez vérifié l'aperçu.")).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.click(screen.getByRole("checkbox", { name: /J'ai vérifié l'aperçu/ }));
    fireEvent.click(screen.getByRole("button", { name: "Lancer la reconduction" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`/v2/academic/rollover/runs/${RUN_ID}`));
    const post = api.calls.find((c) => c.method === "POST")!;
    expect(post.body).toEqual({ toAcademicYearId: ROLLOVER_TO, steps: ["PERIODS", "HOLIDAYS", "CURRICULUM", "CLASSROOMS", "ENROLLMENTS"], createMissingClassrooms: true });
    expect(post.headers["idempotency-key"]).toMatch(/^rollover-/);
  });

  it("étapes décochées : seules les étapes retenues sont demandées et envoyées ; offres proposées avec la fonction à la carte", async () => {
    const api = setTestApi({
      ...accessRoutes(["academic.read", "academic.year.rollover"], ["academic.rollover", "academic.a-la-carte"]),
      ...YEARS,
      [PLAN_PATH]: rolloverPlan({ steps: ["PERIODS", "OFFERINGS"], warnings: [], enrollments: null, offerings: { toCreate: 8, existing: 1 } }),
      [`POST /api/v1/academic/years/${ROLLOVER_FROM}/rollover/runs`]: () => json(rolloverRun({ id: RUN_ID }), { status: 200 }),
    });
    renderWithProviders(<RolloverWizard />);
    await selectYears();
    await screen.findByRole("checkbox", { name: /Offres de cours à la carte/ });
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /Offres de cours à la carte/ })).toBeTruthy());
    for (const label of [/Jours fériés/, /Curriculum/, /^Classes/, /Réinscriptions/]) fireEvent.click(screen.getByRole("checkbox", { name: label }));
    // Sans réinscriptions, l'option « créer les classes manquantes » disparaît.
    expect(screen.queryByRole("checkbox", { name: /Créer les classes de destination/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    await screen.findByText("Aperçu en lecture seule : aucune donnée n'a été modifiée.");
    expect(api.calls.find((c) => c.path.endsWith("/rollover/plan"))!.query).toEqual({ toAcademicYearId: ROLLOVER_TO, steps: "PERIODS,OFFERINGS" });
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /J'ai vérifié l'aperçu/ }));
    fireEvent.click(screen.getByRole("button", { name: "Lancer la reconduction" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalled());
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ toAcademicYearId: ROLLOVER_TO, steps: ["PERIODS", "OFFERINGS"] });
  });

  it("retenir aucune étape est refusé", async () => {
    setTestApi({ ...ACCESS, ...YEARS });
    renderWithProviders(<RolloverWizard />);
    await selectYears();
    for (const label of [/Calendrier et périodes/, /Jours fériés/, /Curriculum/, /^Classes/, /Réinscriptions/]) fireEvent.click(await screen.findByRole("checkbox", { name: label }));
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    expect(await screen.findByText("Retenez au moins une étape.")).toBeTruthy();
  });

  it("aperçu : une exécution vivante est signalée avec un lien de reprise ; erreur de l'API affichée", async () => {
    setTestApi({ ...ACCESS, ...YEARS, [PLAN_PATH]: rolloverPlan({ liveRunId: RUN_ID }) });
    renderWithProviders(<RolloverWizard />);
    await selectYears();
    fireEvent.click(await screen.findByRole("button", { name: "Suivant" }));
    const link = await screen.findByRole("link", { name: "Reprendre son suivi" });
    expect(link.getAttribute("href")).toBe(`/v2/academic/rollover/runs/${RUN_ID}`);
  });

  it("aperçu en erreur : message du serveur et pas de passage à l'étape suivante", async () => {
    setTestApi({ ...ACCESS, ...YEARS, [PLAN_PATH]: () => json({ code: "academic.rollover_invalid_target", message: "L'année cible est antérieure à l'année source." }, { status: 422 }) });
    renderWithProviders(<RolloverWizard />);
    await selectYears();
    fireEvent.click(await screen.findByRole("button", { name: "Suivant" }));
    expect((await screen.findByText("L'année cible est antérieure à l'année source.")).closest("[role=alert]")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: /J'ai vérifié l'aperçu/ })).toBeNull());
  });

  it("échec du lancement : l'erreur du serveur est affichée au-dessus des boutons", async () => {
    setTestApi({
      ...ACCESS,
      ...YEARS,
      [PLAN_PATH]: rolloverPlan({ warnings: [] }),
      [`POST /api/v1/academic/years/${ROLLOVER_FROM}/rollover/runs`]: () => json({ code: "academic.rollover_target_closed", message: "L'année cible est clôturée." }, { status: 409 }),
    });
    renderWithProviders(<RolloverWizard />);
    await selectYears();
    fireEvent.click(await screen.findByRole("button", { name: "Suivant" }));
    await screen.findByText("Aperçu en lecture seule : aucune donnée n'a été modifiée.");
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /J'ai vérifié l'aperçu/ }));
    fireEvent.click(screen.getByRole("button", { name: "Lancer la reconduction" }));
    expect(await screen.findByText("L'année cible est clôturée.")).toBeTruthy();
    expect(nav.push).not.toHaveBeenCalled();
  });
});

describe("RolloverRunView", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("PENDING puis RUNNING puis COMPLETED : relecture toutes les 2 s, progression par étape, rapport, arrêt du polling", async () => {
    let hits = 0;
    const frames = [
      rolloverRun({ status: "PENDING", startedAt: null, progress: { stage: null, steps: [] } }),
      rolloverRun({ status: "RUNNING" }),
      rolloverRun({
        status: "COMPLETED",
        finishedAt: "2026-10-01T08:01:00.000Z",
        progress: { stage: null, steps: [{ key: "PERIODS", status: "DONE", done: 4, total: 4, message: null }, { key: "CURRICULUM", status: "DONE", done: 2, total: 2, message: "2 versions clonées" }] },
        report: rolloverReport(),
      }),
    ];
    const api = setTestApi({
      ...ACCESS,
      ...YEARS,
      [`GET /api/v1/academic/rollover/runs/${RUN_ID}`]: () => json(frames[Math.min(hits++, frames.length - 1)]),
    });
    renderWithProviders(<RolloverRunView runId={RUN_ID} />);

    // PENDING : « en attente du worker ».
    expect((await screen.findAllByText("En attente du worker")).length).toBeGreaterThan(0);
    expect(screen.getByText(/Vous pouvez quitter cette page/)).toBeTruthy();
    expect(screen.getByText("Aucune étape n'a encore démarré.")).toBeTruthy();

    // RUNNING : barre de progression de l'étape (2 sur 4).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    const bar = await screen.findByRole("progressbar", { name: "Progression : Calendrier et périodes" });
    expect(bar.getAttribute("aria-valuenow")).toBe("2");
    expect(bar.getAttribute("aria-valuemax")).toBe("4");
    expect(screen.getAllByText("En cours").length).toBeGreaterThan(0);

    // COMPLETED : rapport (créés / déjà présents / ignorés), avertissements, anomalie avec lien.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(await screen.findByRole("heading", { name: "Rapport de reconduction" })).toBeTruthy();
    expect(screen.getByText("Créés : Réinscriptions des élèves").nextElementSibling?.textContent).toBe("120");
    expect(screen.getByText("Réinscriptions déjà présentes").nextElementSibling?.textContent).toBe("7");
    expect(screen.getByText("Éléments ignorés").nextElementSibling?.textContent).toBe("3");
    expect(screen.getByText("La classe L1-A existe déjà.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ouvrir l'inscription" }).getAttribute("href")).toBe(`/v2/enrollments/${uuid(1002)}`);
    expect(screen.getByText("2 versions clonées", { exact: false })).toBeTruthy();
    expect(screen.getByText(/De Année 2025-2026 vers Année 2026-2027/)).toBeTruthy();

    // Terminée : plus aucune relecture automatique.
    const before = api.calls.filter((c) => c.path.includes("/rollover/runs/")).length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(api.calls.filter((c) => c.path.includes("/rollover/runs/")).length).toBe(before);
    expect(screen.queryByText(/relu automatiquement/)).toBeNull();
  });

  it("FAILED : message du serveur et bouton Relancer (POST retry), puis suivi de la reprise", async () => {
    let failed = true;
    const api = setTestApi({
      ...ACCESS,
      ...YEARS,
      [`GET /api/v1/academic/rollover/runs/${RUN_ID}`]: () =>
        json(failed ? rolloverRun({ status: "FAILED", errorMessage: "Connexion à la base interrompue pendant les classes.", attempts: 2, progress: { stage: "CLASSROOMS", steps: [{ key: "CLASSROOMS", status: "FAILED", done: 1, total: 5, message: "Échec" }] } }) : rolloverRun({ status: "PENDING", progress: { stage: null, steps: [] } })),
      [`POST /api/v1/academic/rollover/runs/${RUN_ID}/retry`]: () => {
        failed = false;
        return json(rolloverRun({ status: "PENDING", progress: { stage: null, steps: [] } }), { status: 202 });
      },
    });
    renderWithProviders(<RolloverRunView runId={RUN_ID} />);
    expect(await screen.findByText("Connexion à la base interrompue pendant les classes.")).toBeTruthy();
    expect(screen.getByText("2 tentatives", { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Relancer" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path.endsWith("/retry"))).toBe(true));
    expect((await screen.findAllByText("En attente du worker")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Relancer" })).toBeNull();
  });

  it("le bouton Actualiser relit l'exécution ; une erreur de chargement est affichée", async () => {
    let hits = 0;
    const api = setTestApi({
      ...ACCESS,
      ...YEARS,
      [`GET /api/v1/academic/rollover/runs/${RUN_ID}`]: () => (hits++ === 0 ? json({ code: "academic.rollover_run_not_found", message: "Exécution introuvable." }, { status: 404 }) : json(rolloverRun({ status: "COMPLETED", report: rolloverReport({ anomalies: [], warnings: [] }) }))),
    });
    renderWithProviders(<RolloverRunView runId={RUN_ID} />);
    expect(await screen.findByText("Exécution introuvable.")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Actualiser" })[0]!);
    expect(await screen.findByText("Aucune anomalie.")).toBeTruthy();
    expect(api.calls.filter((c) => c.path.includes("/rollover/runs/")).length).toBe(2);
  });
});

describe("RolloverHistory", () => {
  it("liste les exécutions de l'année source et propose de reprendre une exécution vivante", async () => {
    setTestApi({
      ...ACCESS,
      ...YEARS,
      [`GET /api/v1/academic/years/${ROLLOVER_FROM}/rollover/runs`]: {
        items: [
          rolloverRun({ id: uuid(9001), status: "FAILED", errorMessage: "x", requestedAt: "2026-09-20T08:00:00.000Z" }),
          rolloverRun({ id: uuid(9002), status: "RUNNING", requestedAt: "2026-10-01T08:00:00.000Z", steps: ["PERIODS", "ENROLLMENTS"] }),
        ],
      },
    });
    renderWithProviders(<RolloverHistory initialFromId={ROLLOVER_FROM} />);
    const table = await screen.findByRole("table", { name: "Reconductions de l'année source" });
    expect(await within(table).findByText("En échec")).toBeTruthy();
    expect(within(table).getByText("En cours")).toBeTruthy();
    expect(within(table).getByText(/Calendrier et périodes, Réinscriptions des élèves/)).toBeTruthy();
    const resume = within(table).getByRole("link", { name: /Reprendre le suivi — / });
    expect(resume.getAttribute("href")).toBe(`/v2/academic/rollover/runs/${uuid(9002)}`);
    expect(screen.getByText("Une reconduction est en attente ou en cours.")).toBeTruthy();
    expect(within(table).getByRole("link", { name: /Ouvrir — / }).getAttribute("href")).toBe(`/v2/academic/rollover/runs/${uuid(9001)}`);
  });

  it("sans année choisie : invite à en choisir une ; année sans exécution : état vide", async () => {
    setTestApi({ ...ACCESS, ...YEARS, [`GET /api/v1/academic/years/${ROLLOVER_FROM}/rollover/runs`]: { items: [] } });
    renderWithProviders(<RolloverHistory />);
    expect(await screen.findByText("Choisissez une année source pour voir ses reconductions.")).toBeTruthy();
    const select = await screen.findByLabelText("Année source");
    await waitFor(() => expect(within(select as HTMLSelectElement).getAllByRole("option").length).toBeGreaterThan(1));
    fireEvent.change(select, { target: { value: ROLLOVER_FROM } });
    expect(await screen.findByText("Aucune reconduction pour cette année.")).toBeTruthy();
  });
});

describe("RolloverGate", () => {
  it("sans la permission : accès refusé, l'écran n'est pas rendu", async () => {
    setTestApi({ ...accessRoutes(["academic.read"], ["academic.rollover"]), ...YEARS });
    renderWithProviders(
      <RolloverGate>
        <p>contenu protégé</p>
      </RolloverGate>,
    );
    expect(await screen.findByText("Vous n'avez pas les droits nécessaires pour cette action.")).toBeTruthy();
    expect(screen.queryByText("contenu protégé")).toBeNull();
  });

  it("fonction de l'offre absente : message explicite", async () => {
    setTestApi({ ...accessRoutes(["academic.year.rollover"], []), ...YEARS });
    renderWithProviders(
      <RolloverGate>
        <p>contenu protégé</p>
      </RolloverGate>,
    );
    expect(await screen.findByText("La reconduction annuelle n'est pas incluse dans l'offre de votre établissement.")).toBeTruthy();
    expect(screen.queryByText("contenu protégé")).toBeNull();
  });

  it("permission et fonction accordées : l'écran est rendu", async () => {
    setTestApi({ ...ACCESS, ...YEARS });
    renderWithProviders(
      <RolloverGate>
        <p>contenu protégé</p>
      </RolloverGate>,
    );
    expect(await screen.findByText("contenu protégé")).toBeTruthy();
  });
});

