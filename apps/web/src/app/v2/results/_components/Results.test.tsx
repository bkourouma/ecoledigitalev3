// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { classroom, period } from "../../_test/fixtures";
import { STUDENTS } from "../../assessments/_test/fixtures";
import { decision, header, line, matrix, overrideDto, periodView, ruleVersionDetail, STATE_ID, uuid, VERSION_ID } from "../_test/fixtures";
import { DecisionsScreen } from "./DecisionsScreen";
import { ExplainScreen } from "./ExplainScreen";
import { MatrixScreen } from "./MatrixScreen";
import { OverridesScreen } from "./OverridesScreen";
import { PeriodScreen } from "./PeriodScreen";
import { YearResultScreen } from "./YearResultScreen";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);

const C = uuid(500);
const P = uuid(200);
const STATE_PATH = `/api/v1/results/classrooms/${C}/periods/${P}/state`;
const MATRIX_PATH = `/api/v1/results/classrooms/${C}/periods/${P}`;

const common = (extra: Record<string, unknown> = {}) => ({
  [`GET /api/v1/academic/classrooms/${C}`]: classroom(),
  [`GET /api/v1/academic/classrooms/${C}/offerings`]: { items: [] },
  [`GET /api/v1/academic/years/${uuid(100)}/periods`]: { items: [period()] },
  "GET /api/v1/people/students": STUDENTS,
  [`GET /api/v1/rules/rule-versions/${VERSION_ID}`]: ruleVersionDetail(),
  ...extra,
});

describe("PeriodScreen — cycle de période", () => {
  it("période ouverte : état, compteurs, évaluations en attente, et verrouillage forcé avec motif", async () => {
    const api = setTestApi({
      ...accessRoutes(["result.read", "period.lock", "result.recompute"]),
      ...common(),
      [`GET ${STATE_PATH}`]: periodView({ pendingAssessments: [{ id: uuid(800), title: "Devoir 1", status: "SUBMITTED", sessionNo: 1, curriculumNodeId: uuid(510) }] }),
      [`POST /api/v1/results/classrooms/${C}/periods/${P}/lock`]: () => json({ ...periodView().state, status: "GRADING_LOCKED" }),
    });
    renderWithProviders(<PeriodScreen initialClassroomId={C} initialPeriodId={P} />);
    expect(await screen.findByText("1 évaluation n'est pas encore publiée")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Devoir 1" }).getAttribute("href")).toBe(`/v2/assessments/${uuid(800)}`);
    expect(screen.getByText("CI-HIGHER-LMD · v1")).toBeTruthy();
    // pas d'action de clôture ni de réouverture : permissions absentes, et l'état ne s'y prête pas
    expect(screen.queryByRole("button", { name: "Clôturer la période" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Verrouiller les notes" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Verrouiller malgré/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Verrouiller" }));
    await waitFor(() => expect(within(dialog).getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Motif du verrouillage forcé/), { target: { value: "Évaluation reportée au prochain trimestre" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Verrouiller" }));
    await screen.findByText("Les notes de la période sont verrouillées.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ force: true, reason: "Évaluation reportée au prochain trimestre" });
  });

  it("période clôturée : réouverture motivée avec sa nature", async () => {
    const api = setTestApi({
      ...accessRoutes(["result.read", "period.reopen", "period.close"]),
      ...common(),
      [`GET ${STATE_PATH}`]: periodView({ counts: { total: 3, draft: 0, final: 3, error: 0 }, closures: [{ id: uuid(1), resultsVersion: 1, resultsCount: 3, closureHash: "d".repeat(64), closedAt: "2026-10-01T09:00:00.000Z", forcedReason: null }] }, { status: "CLOSED", closedAt: "2026-10-01T09:00:00.000Z" }),
      [`POST /api/v1/results/classrooms/${C}/periods/${P}/reopen`]: () => json({ ...periodView().state, status: "OPEN", reopenCount: 1 }),
    });
    renderWithProviders(<PeriodScreen initialClassroomId={C} initialPeriodId={P} />);
    expect(await screen.findByText(/Version 1 — 3 résultats figés/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clôturer la période" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Rouvrir la période" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Nature de la réouverture/), { target: { value: "RESIT_SESSION" } });
    fireEvent.change(within(dialog).getByLabelText(/Motif de la réouverture/), { target: { value: "court" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rouvrir" }));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Motif de la réouverture/), { target: { value: "Ouverture de la session de rattrapage" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rouvrir" }));
    await screen.findByText("La période est rouverte.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ kind: "RESIT_SESSION", reason: "Ouverture de la session de rattrapage" });
  });

  it("clôture avec inscriptions en erreur : refus tant que le forçage n'est pas motivé", async () => {
    const api = setTestApi({
      ...accessRoutes(["result.read", "period.close"]),
      ...common(),
      [`GET ${STATE_PATH}`]: periodView({ counts: { total: 3, draft: 2, final: 0, error: 1 } }, { status: "DELIBERATED" }),
      [`POST /api/v1/results/classrooms/${C}/periods/${P}/close`]: () => json({ state: periodView().state, closureId: uuid(2), closureHash: "e".repeat(64), resultsVersion: 1, resultsCount: 2, excluded: [{ enrollmentId: uuid(2003), code: "x", message: "Note manquante" }], withoutDeliberation: false }),
    });
    renderWithProviders(<PeriodScreen initialClassroomId={C} initialPeriodId={P} />);
    fireEvent.click(await screen.findByRole("button", { name: "Clôturer la période" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/1 inscription est en erreur/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Clôturer en excluant/ }));
    fireEvent.change(within(dialog).getByLabelText(/Motif de la clôture forcée/), { target: { value: "Étudiante en congé maladie" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Clôturer" }));
    await screen.findByText("Période clôturée : 2 résultats figés (version 1), 1 exclusion.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ force: true, reason: "Étudiante en congé maladie" });
  });

  it("retard de version de règle : bannière, re-pin et rapport d'impact (simulation)", async () => {
    const api = setTestApi({
      ...accessRoutes(["result.read", "period.repin"]),
      ...common(),
      [`GET ${STATE_PATH}`]: periodView({ ruleLag: { pinned: { ruleSetCode: "CI-HIGHER-LMD", ruleVersionNo: 1, definitionHash: "a".repeat(64) }, active: { ruleSetCode: "CI-HIGHER-LMD", ruleVersionNo: 2, definitionHash: "f".repeat(64) }, behind: true } }),
      [`POST /api/v1/results/periods/${STATE_ID}/repin`]: () =>
        json({
          state: { ...periodView().state, ruleVersionNo: 2 },
          changed: true,
          simulation: { from: { ruleSetCode: "CI-HIGHER-LMD", ruleVersionNo: 1, definitionHash: "a".repeat(64) }, to: { ruleSetCode: "CI-HIGHER-LMD", ruleVersionNo: 2, definitionHash: "f".repeat(64) }, computed: 3, changed: 1, unchanged: 2, errors: 0, samples: [{ enrollmentId: uuid(2002), field: "decisionCode", before: "RESIT", after: "ADMITTED" }] },
        }),
    });
    renderWithProviders(<PeriodScreen initialClassroomId={C} initialPeriodId={P} />);
    expect(await screen.findByText("Une règle plus récente est active")).toBeTruthy();
    expect(screen.getByText(/CI-HIGHER-LMD v1 ; la version active à son début est CI-HIGHER-LMD v2/)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Passer à la version active" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Changer la version" }));
    await screen.findByText("La version de règle de la période est mise à jour.");
    expect(api.calls.some((c) => c.method === "POST" && c.path.endsWith("/repin"))).toBe(true);
    expect(screen.getByTestId("repin-counts").textContent).toBe("3 résultats rejoués : 1 modifiés, 2 inchangés, 0 en erreur.");
    expect(screen.getByRole("cell", { name: "decisionCode" })).toBeTruthy();
  });

  it("sans retard de version : aucune bannière ; sans choix de classe : message d'aide", async () => {
    setTestApi({ ...accessRoutes(["result.read"]), ...common(), [`GET ${STATE_PATH}`]: periodView() });
    const { unmount } = renderWithProviders(<PeriodScreen initialClassroomId={C} initialPeriodId={P} />);
    await screen.findByText("État de la période");
    expect(screen.queryByText("Une règle plus récente est active")).toBeNull();
    unmount();
    renderWithProviders(<PeriodScreen />);
    expect(await screen.findByText("Choisissez une classe et une période pour voir son état.")).toBeTruthy();
  });

  it("erreur de l'API (période sans structure) : message du serveur et bouton Réessayer", async () => {
    setTestApi({ ...accessRoutes(["result.read"]), ...common(), [`GET ${STATE_PATH}`]: () => json({ code: "results.state_not_found", message: "Aucun état pour cette période : calculez d'abord les résultats." }, { status: 404 }) });
    renderWithProviders(<PeriodScreen initialClassroomId={C} initialPeriodId={P} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Aucun état pour cette période");
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeTruthy();
  });
});

describe("MatrixScreen — valeurs fournies par l'API", () => {
  const routes = (extra: Record<string, unknown> = {}) => ({
    ...accessRoutes(["result.read", "result.explain"]),
    ...common(),
    [`GET ${MATRIX_PATH}`]: matrix(),
    ...extra,
  });

  it("affiche exactement moyenne d'affichage, rang, mention et décision (libellés des règles) sans rien recalculer", async () => {
    setTestApi(routes());
    renderWithProviders(<MatrixScreen initialClassroomId={C} initialPeriodId={P} />);
    const table = await screen.findByRole("table", { name: "Résultats des élèves de la classe" });
    const aka = (await within(table).findByRole("rowheader", { name: /Aka Marie/ })).closest("tr")!;
    // « 13.50 » est la valeur d'affichage fournie ; la valeur exacte est dans l'infobulle.
    expect(within(aka).getByText("13,50").getAttribute("title")).toBe("Valeur exacte : 13,4999");
    expect(within(aka).getByText("1 sur 3")).toBeTruthy();
    await waitFor(() => expect(within(aka).getByText("Assez bien")).toBeTruthy());
    expect(within(aka).getAllByText("Admis").length).toBeGreaterThan(0); // libellé de la décision + de son issue
    expect(within(aka).getByText("30 / 30")).toBeTruthy();
    const bamba = within(table).getByRole("rowheader", { name: /Bamba Yao/ }).closest("tr")!;
    // 9,995 reste 10,00 à l'affichage tel que fourni : le web n'arrondit pas
    expect(within(bamba).getByText("10,00")).toBeTruthy();
    await waitFor(() => expect(within(bamba).getAllByText("Rattrapage").length).toBeGreaterThan(0));
    expect(within(bamba).getByText("Non validé")).toBeTruthy();
  });

  it("ligne en erreur de calcul : message de l'API ; lien « Pourquoi ? » vers la trace", async () => {
    setTestApi(routes());
    renderWithProviders(<MatrixScreen initialClassroomId={C} initialPeriodId={P} />);
    const table = await screen.findByRole("table", { name: "Résultats des élèves de la classe" });
    const coulibaly = (await within(table).findByRole("rowheader", { name: /Coulibaly Awa/ })).closest("tr")!;
    expect(within(coulibaly).getByText("En erreur")).toBeTruthy();
    expect(within(coulibaly).getByText("Note manquante pour une UE obligatoire.")).toBeTruthy();
    const explain = await screen.findAllByRole("link", { name: /Pourquoi ce résultat pour/ });
    expect(explain[0]!.getAttribute("href")).toBe(`/v2/results/${uuid(6201)}/explain?classroom=${C}`);
  });

  it("tri par rang selon les rangs fournis, sans recalcul", async () => {
    setTestApi(routes({ [`GET ${MATRIX_PATH}`]: matrix([header(1, { rank: 2 }), header(2, { rank: 1 }), header(3, { rank: 3 })]) }));
    renderWithProviders(<MatrixScreen initialClassroomId={C} initialPeriodId={P} />);
    await screen.findByRole("table", { name: "Résultats des élèves de la classe" });
    await screen.findByRole("rowheader", { name: /Aka Marie/ });
    fireEvent.change(screen.getByLabelText("Ordre d'affichage"), { target: { value: "rank" } });
    const names = screen.getAllByRole("rowheader").map((r) => r.textContent ?? "");
    expect(names[0]).toContain("Bamba Yao");
    expect(names[1]).toContain("Aka Marie");
  });

  it("détail par cours : relit la matrice avec lines=true et ajoute une colonne par UE", async () => {
    const api = setTestApi(
      routes({
        [`GET ${MATRIX_PATH}`]: ({ url }: { url: URL }) => json(url.searchParams.get("lines") === "true" ? { ...matrix([header(1)]), rows: [{ header: header(1), lines: [line({ displayValue: "12.25", statusCode: "VALIDATED" })] }] } : matrix([header(1)])),
        [`GET /api/v1/academic/classrooms/${C}/offerings`]: { items: [{ id: uuid(60), classroomId: C, curriculumNodeId: uuid(510), label: "Algèbre", startsOn: "2026-09-01", endsOn: "2027-06-30", registrationOpensAt: null, registrationClosesAt: null, capacity: null, status: "OPEN", heldPlaces: 0 }] },
      }),
    );
    renderWithProviders(<MatrixScreen initialClassroomId={C} initialPeriodId={P} />);
    await screen.findByRole("rowheader", { name: /Aka Marie/ });
    fireEvent.click(screen.getByRole("checkbox", { name: "Afficher le détail par cours" }));
    expect(await screen.findByRole("columnheader", { name: "Algèbre" })).toBeTruthy();
    expect(screen.getByText("12,25")).toBeTruthy();
    expect(api.calls.some((c) => c.path === MATRIX_PATH && c.query.lines === "true")).toBe(true);
  });

  it("état vide et sans permission d'expliquer : pas de lien « Pourquoi ? »", async () => {
    setTestApi({ ...routes({ [`GET ${MATRIX_PATH}`]: matrix([]) }) });
    const { unmount } = renderWithProviders(<MatrixScreen initialClassroomId={C} initialPeriodId={P} />);
    expect(await screen.findByText(/Aucun résultat pour cette période/)).toBeTruthy();
    unmount();
    setTestApi({ ...routes(), ...accessRoutes(["result.read"]) });
    renderWithProviders(<MatrixScreen initialClassroomId={C} initialPeriodId={P} />);
    await screen.findByRole("rowheader", { name: /Aka Marie/ });
    expect(screen.queryByRole("link", { name: /Pourquoi ce résultat pour/ })).toBeNull();
  });
});

describe("ExplainScreen — explicabilité", () => {
  const explainPath = `/api/v1/results/results/${uuid(6201)}/explain`;
  const body = (source: "STORED" | "REPLAY") => ({
    header: header(1, { status: source === "STORED" ? "FINAL" : "DRAFT" }),
    source,
    lines: [
      {
        level: "UE",
        curriculumNodeId: uuid(510),
        value: "12.25",
        statusCode: "VALIDATED",
        overridden: true,
        trace: [
          { ruleKey: "moyenne_ue", value: "12.25", inputsHash: "1".repeat(64), outputsHash: "2".repeat(64), nodesEvaluated: 12, variables: { notes: "12;13", coefficient: "2" }, overridden: { overrideId: uuid(6400), original: "11.5" }, trace: [{ seq: 1, kind: "call", label: "moyenne", source: "avg(notes)", type: "number", value: "12.25" }] },
        ],
      },
    ],
  });

  it("trace stockée d'un résultat définitif : règle, empreintes, étapes, contexte et surcharge", async () => {
    setTestApi({ ...accessRoutes(["result.explain"]), ...common(), [`GET ${explainPath}`]: body("STORED") });
    renderWithProviders(<ExplainScreen resultId={uuid(6201)} classroomId={C} />);
    expect(await screen.findByText("Résultat définitif : trace enregistrée lors de la clôture.")).toBeTruthy();
    expect(screen.getByText("CI-HIGHER-LMD · v1")).toBeTruthy();
    expect(screen.getByText("Surchargée")).toBeTruthy();
    fireEvent.click(screen.getByText(/Unité d'enseignement/));
    expect(await screen.findByText("moyenne_ue")).toBeTruthy();
    expect(screen.getByText("Valeur imposée par une surcharge approuvée (valeur calculée : 11.5).")).toBeTruthy();
    expect(screen.getByText("12 nœuds évalués")).toBeTruthy();
    expect(screen.getByText("avg(notes)")).toBeTruthy();
    expect(screen.getByText("notes")).toBeTruthy();
  });

  it("résultat provisoire : bannière de rejeu ; refus 403 sans droit d'explication", async () => {
    setTestApi({ ...accessRoutes(["result.explain"]), ...common(), [`GET ${explainPath}`]: body("REPLAY") });
    const { unmount } = renderWithProviders(<ExplainScreen resultId={uuid(6201)} />);
    expect(await screen.findByText(/la trace est rejouée avec les données actuelles/)).toBeTruthy();
    unmount();
    setTestApi({ ...accessRoutes([]), ...common(), [`GET ${explainPath}`]: () => json({ code: "results.forbidden", message: "Vous n'avez pas le droit de consulter la trace d'un résultat." }, { status: 403 }) });
    renderWithProviders(<ExplainScreen resultId={uuid(6201)} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Vous n'avez pas le droit de consulter la trace");
  });
});

describe("DecisionsScreen", () => {
  const decisionsPath = "/api/v1/results/decisions";
  const routes = (perms: string[], extra: Record<string, unknown> = {}) => ({
    ...accessRoutes(perms, ["results.deliberation"]),
    ...common(),
    [`GET ${MATRIX_PATH}`]: matrix(),
    [`GET ${decisionsPath}`]: { items: [decision()] },
    "GET /api/v1/results/deliberations": { items: [] },
    ...extra,
  });

  it("confirme la proposition de la règle (corps vide)", async () => {
    const api = setTestApi(routes(["decision.record"], { [`POST /api/v1/results/decisions/${uuid(6300)}/confirm`]: () => json(decision({ status: "CONFIRMED", finalCode: "RESIT" })) }));
    renderWithProviders(<DecisionsScreen initialClassroomId={C} initialPeriodId={P} />);
    fireEvent.click(await screen.findByRole("button", { name: "Confirmer la décision de Bamba Yao" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/Proposition de la règle : Rattrapage/)).toBeTruthy();
    expect(within(dialog).queryByRole("checkbox", { name: "Retenir une autre décision" })).toBeNull(); // droit de modification absent
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmer la décision" }));
    await screen.findByText("La décision est confirmée.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({});
  });

  it("retient une autre décision : motif écrit d'au moins 20 caractères exigé, proposition conservée côté API", async () => {
    const api = setTestApi(routes(["decision.record", "decision.approve"], { [`POST /api/v1/results/decisions/${uuid(6300)}/confirm`]: () => json(decision({ status: "CONFIRMED", finalCode: "ADMITTED" })) }));
    renderWithProviders(<DecisionsScreen initialClassroomId={C} initialPeriodId={P} />);
    fireEvent.click(await screen.findByRole("button", { name: "Confirmer la décision de Bamba Yao" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: "Retenir une autre décision" }));
    await within(dialog).findByRole("option", { name: "Admis" });
    fireEvent.change(within(dialog).getByLabelText(/Décision retenue/), { target: { value: "ADMITTED" } });
    fireEvent.change(within(dialog).getByLabelText(/Motif de la décision/), { target: { value: "trop court" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmer la décision" }));
    await within(dialog).findByText("Le motif doit faire au moins 20 caractères.");
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Motif de la décision/), { target: { value: "Décision du conseil de classe du 30 septembre" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmer la décision" }));
    await screen.findByText("La décision est confirmée.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ finalCode: "ADMITTED", justification: "Décision du conseil de classe du 30 septembre" });
  });

  it("délibérations : liste, planification et changement d'état ; fonction non incluse => message d'offre", async () => {
    const api = setTestApi(
      routes(["decision.record"], {
        "GET /api/v1/results/deliberations": { items: [{ id: uuid(6600), stateId: STATE_ID, classroomId: C, kind: "COUNCIL", heldOn: "2026-10-01", status: "PLANNED", participants: [{ staffId: uuid(910), role: "Président" }], minutesObjectKey: null }] },
        [`PATCH /api/v1/results/deliberations/${uuid(6600)}`]: () => json({ id: uuid(6600), stateId: STATE_ID, classroomId: C, kind: "COUNCIL", heldOn: "2026-10-01", status: "HELD", participants: [], minutesObjectKey: null }),
      }),
    );
    const { unmount } = renderWithProviders(<DecisionsScreen initialClassroomId={C} initialPeriodId={P} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Délibérations" }));
    expect(await screen.findByText(/Conseil de classe — /)).toBeTruthy();
    expect(screen.getByText(/Président/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Marquer comme tenue" }));
    await screen.findByText("La séance est marquée comme tenue.");
    expect(api.calls.find((c) => c.method === "PATCH")!.body).toEqual({ status: "HELD" });
    unmount();
    setTestApi({ ...routes(["decision.record"]), ...accessRoutes(["decision.record"], []) });
    renderWithProviders(<DecisionsScreen initialClassroomId={C} initialPeriodId={P} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Délibérations" }));
    expect(await screen.findByText("Cette fonctionnalité n'est pas incluse dans votre offre.")).toBeTruthy();
  });

  it("appréciation : validation du contrat puis envoi du corps exact", async () => {
    const api = setTestApi(
      routes(["appreciation.write"], {
        "GET /api/v1/results/appreciations": { items: [] },
        "PUT /api/v1/results/appreciations": () => json({ id: uuid(6700), stateId: STATE_ID, enrollmentId: uuid(2001), curriculumNodeId: null, authorStaffId: uuid(910), authorRole: "COUNCIL", body: "Bon trimestre.", updatedAt: "2026-10-01T09:00:00.000Z" }),
      }),
    );
    renderWithProviders(<DecisionsScreen initialClassroomId={C} initialPeriodId={P} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Appréciations" }));
    const form = await screen.findByRole("form", { name: "Rédiger une appréciation" });
    fireEvent.click(within(form).getByRole("button", { name: "Enregistrer l'appréciation" }));
    await waitFor(() => expect(within(form).getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    await within(form).findByRole("option", { name: "Aka Marie" });
    fireEvent.change(within(form).getByLabelText(/Élève/), { target: { value: uuid(2001) } });
    fireEvent.change(within(form).getByLabelText(/Appréciation/), { target: { value: "Bon trimestre." } });
    fireEvent.click(within(form).getByRole("button", { name: "Enregistrer l'appréciation" }));
    await screen.findByText("L'appréciation est enregistrée.");
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({ stateId: STATE_ID, enrollmentId: uuid(2001), authorRole: "COUNCIL", body: "Bon trimestre." });
  });
});

describe("OverridesScreen — quatre yeux", () => {
  const routes = (perms: string[], extra: Record<string, unknown> = {}) => ({
    ...accessRoutes(perms),
    ...common(),
    [`GET ${MATRIX_PATH}`]: matrix(),
    "GET /api/v1/results/overrides": { items: [overrideDto()] },
    ...extra,
  });

  it("liste la surcharge (valeur d'origine → imposée, justification, demandeur) ; approuver exige un autre approbateur côté API", async () => {
    const api = setTestApi(routes(["result.override.approve"], { [`POST /api/v1/results/overrides/${uuid(6400)}/approve`]: () => json({ code: "results.four_eyes_required", message: "L'approbateur doit être différent du demandeur." }, { status: 403 }) }));
    renderWithProviders(<OverridesScreen initialClassroomId={C} initialPeriodId={P} />);
    const card = await screen.findByRole("article", { name: /Surcharge pour/ });
    expect(within(card).getByText("9,995 → 10")).toBeTruthy();
    expect(within(card).getByText(/Erreur matérielle constatée/)).toBeTruthy();
    expect(within(card).getByText(/Demandée par Mme Traoré/)).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: /Approuver la surcharge de/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approuver" }));
    await within(dialog).findByText("L'approbateur doit être différent du demandeur.");
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("rejet motivé et révocation d'une surcharge approuvée", async () => {
    const api = setTestApi(
      routes(["result.override.approve"], {
        "GET /api/v1/results/overrides": { items: [overrideDto(), overrideDto({ id: uuid(6401), status: "APPROVED", decidedByName: "M. Diallo", decidedAt: "2026-10-01T09:00:00.000Z" })] },
        [`POST /api/v1/results/overrides/${uuid(6400)}/reject`]: () => json(overrideDto({ status: "REJECTED" })),
        [`POST /api/v1/results/overrides/${uuid(6401)}/revoke`]: () => json(overrideDto({ id: uuid(6401), status: "REVOKED" })),
      }),
    );
    renderWithProviders(<OverridesScreen initialClassroomId={C} initialPeriodId={P} />);
    fireEvent.click((await screen.findAllByRole("button", { name: /Rejeter la surcharge de/ }))[0]!);
    let dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Rejeter" }));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Motif du rejet/), { target: { value: "Justification insuffisante" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rejeter" }));
    await screen.findByText("La surcharge est rejetée.");
    expect(api.calls.find((c) => c.path.endsWith("/reject"))!.body).toEqual({ comment: "Justification insuffisante" });

    fireEvent.click(await screen.findByRole("button", { name: /Révoquer la surcharge de/ }));
    dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif de la révocation/), { target: { value: "Erreur de saisie corrigée" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Révoquer" }));
    await screen.findByText("La surcharge est révoquée.");
    expect(api.calls.find((c) => c.path.endsWith("/revoke"))!.body).toEqual({ reason: "Erreur de saisie corrigée" });
  });

  it("demande de surcharge : contrat Zod (justification de 20 caractères) puis corps exact", async () => {
    const api = setTestApi(routes(["result.override.request"], { "POST /api/v1/results/overrides": () => json(overrideDto(), { status: 201 }) }));
    renderWithProviders(<OverridesScreen initialClassroomId={C} initialPeriodId={P} />);
    await screen.findByRole("article", { name: /Surcharge pour/ });
    await waitFor(() => expect((screen.getByRole("button", { name: "Demander une surcharge" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Demander une surcharge" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Envoyer la demande" }));
    await waitFor(() => expect(within(dialog).getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    await within(dialog).findByRole("option", { name: "Bamba Yao" });
    fireEvent.change(within(dialog).getByLabelText(/^Élève/), { target: { value: uuid(2002) } });
    fireEvent.change(within(dialog).getByLabelText(/Règle ciblée/), { target: { value: "moyenne_ue" } });
    fireEvent.change(within(dialog).getByLabelText(/Valeur imposée/), { target: { value: "10,5" } });
    fireEvent.change(within(dialog).getByLabelText(/Justification/), { target: { value: "Copie corrigée à nouveau par le second correcteur" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Envoyer la demande" }));
    await screen.findByText(/La demande de surcharge est enregistrée/);
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ stateId: STATE_ID, enrollmentId: uuid(2002), level: "UE", ruleKey: "moyenne_ue", kind: "VALUE", value: "10.5", justification: "Copie corrigée à nouveau par le second correcteur" });
  });

  it("sans permission d'approuver, aucune action ; état vide", async () => {
    setTestApi(routes(["result.override.request"], { "GET /api/v1/results/overrides": { items: [overrideDto()] } }));
    const { unmount } = renderWithProviders(<OverridesScreen initialClassroomId={C} initialPeriodId={P} />);
    await screen.findByRole("article", { name: /Surcharge pour/ });
    expect(screen.queryByRole("button", { name: /Approuver la surcharge/ })).toBeNull();
    unmount();
    setTestApi(routes(["result.override.request"], { "GET /api/v1/results/overrides": { items: [] } }));
    renderWithProviders(<OverridesScreen initialClassroomId={C} initialPeriodId={P} />);
    expect(await screen.findByText("Aucune surcharge.")).toBeTruthy();
  });
});

describe("YearResultScreen", () => {
  it("résultat annuel incomplet : bannière avec les périodes manquantes, valeurs fournies", async () => {
    const yearId = uuid(100);
    setTestApi({
      ...accessRoutes(["result.read"]),
      [`GET /api/v1/academic/years/${yearId}/periods`]: { items: [period(), period({ id: uuid(202), label: "Semestre 2", ordinal: 2 })] },
      "GET /api/v1/rules/rule-sets": { items: [] },
      [`GET /api/v1/results/enrollments/${uuid(2001)}/years/${yearId}`]: {
        enrollmentId: uuid(2001),
        classroomId: C,
        academicYearId: yearId,
        contractId: "credit-semester@1",
        complete: false,
        missingPeriodIds: [uuid(202)],
        periods: [{ academicPeriodId: P, rankInYear: 1, final: true, version: 1, average: "13.4999", averageDisplay: "13.50", creditsAcquired: "30", creditsRequired: "30", validated: true, decisionCode: "ADMITTED" }],
        ruleSetCode: "CI-HIGHER-LMD",
        ruleVersionNo: 1,
        definitionHash: "a".repeat(64),
        average: "13.4999",
        averageDisplay: "13.50",
        rank: 2,
        cohortSize: 30,
        validated: null,
        creditsAcquired: "30",
        creditsRequired: "60",
        mentionCode: null,
        yearDecisionCode: null,
        inputsHash: "b".repeat(64),
      },
    });
    renderWithProviders(<YearResultScreen enrollmentId={uuid(2001)} yearId={yearId} />);
    expect(await screen.findByText("Résultat incomplet : une ou plusieurs périodes ne sont pas clôturées.")).toBeTruthy();
    expect(screen.getByText("Périodes manquantes : Semestre 2.")).toBeTruthy();
    expect(screen.getByText("2 sur 30")).toBeTruthy();
    expect(screen.getAllByText("13,50").length).toBeGreaterThan(0);
    expect(screen.getByText("Définitif")).toBeTruthy();
  });
});
