// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { institution } from "../../_test/fixtures";
import {
  IDS,
  batch,
  candidate,
  center,
  exportFormat,
  exportRun,
  familyExam,
  group,
  importFormat,
  issuedDoc,
  overview,
  page,
  paper,
  result,
  revision,
  scoreMatrix,
  session,
  sessionDetail,
  statistics,
  typeDto,
  uuid,
} from "../_test/fixtures";
import { AssignmentsScreen } from "./AssignmentsScreen";
import { CandidateDetailScreen } from "./CandidateDetailScreen";
import { CandidatesScreen } from "./CandidatesScreen";
import { CentersScreen } from "./CentersScreen";
import { CorrectionsScreen } from "./CorrectionsScreen";
import { ExaminationsNav } from "./ExaminationsNav";
import { ExportsScreen } from "./ExportsScreen";
import { FamilyScreen } from "./FamilyScreen";
import { ImportsScreen } from "./ImportsScreen";
import { MockScreen } from "./MockScreen";
import { ResultsScreen } from "./ResultsScreen";
import { SessionDetailScreen } from "./SessionDetailScreen";
import { SessionsScreen } from "./SessionsScreen";
import { StatisticsScreen } from "./StatisticsScreen";
import { TypesScreen } from "./TypesScreen";

const nav = vi.hoisted(() => ({ search: "", path: "/v2/examinations", push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.path,
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);

const E = "/api/v1/examinations";
const S = `${E}/sessions/${IDS.session}`;

beforeEach(() => {
  nav.search = `session=${IDS.session}`;
  nav.push.mockClear();
  nav.replace.mockClear();
});
afterEach(() => vi.restoreAllMocks());

/** Routes communes d'un écran rattaché à une session : liste (sélecteur) et détail. */
const scope = (permissions: string[], extra: Record<string, unknown> = {}, detail: Record<string, unknown> = {}) => ({
  ...accessRoutes(permissions),
  [`GET ${E}/sessions`]: page([session()]),
  [`GET ${S}`]: sessionDetail(detail),
  ...extra,
});

describe("Sessions", () => {
  it("liste les sessions, signale les données de démonstration et ne propose la création qu'à la gestion", async () => {
    setTestApi({ ...accessRoutes(["exam.session.read"]), [`GET ${E}/sessions`]: page([session(), session({ id: IDS.mockSession, label: "CEPE blanc", sessionKind: "MOCK", demoRules: false })]) });
    renderWithProviders(<SessionsScreen />);
    expect(await screen.findByRole("link", { name: "CEPE 2027" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "CEPE blanc" })).toBeTruthy();
    expect(screen.getAllByText("Démonstration")).toHaveLength(1);
    expect(screen.getAllByText("Examen blanc").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Nouvelle session" })).toBeNull();
  });

  it("crée une session : corps exact validé par le contrat, puis ouverture du détail", async () => {
    const api = setTestApi({
      ...accessRoutes(["exam.session.read", "exam.session.manage"]),
      [`GET ${E}/sessions`]: page([]),
      [`GET ${E}/exam-types`]: { items: [typeDto()] },
      "GET /api/v1/tenancy/institutions": { items: [institution] },
      [`POST ${E}/sessions`]: () => json(session(), { status: 201 }),
    });
    renderWithProviders(<SessionsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Nouvelle session" }));
    await screen.findByRole("option", { name: /CEPE — / });
    fireEvent.change(await screen.findByLabelText(/^Type d'examen/), { target: { value: IDS.type } });
    await waitFor(() => expect(api.calls.some((c) => c.path === "/api/v1/tenancy/institutions")).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 50));
    fireEvent.change(screen.getByLabelText(/^Code/), { target: { value: "cepe-2028" } });
    fireEvent.change(screen.getByLabelText(/^Libellé/), { target: { value: "CEPE 2028" } });
    fireEvent.change(screen.getByLabelText(/^Année de la session/), { target: { value: "2028" } });
    fireEvent.click(screen.getByRole("button", { name: "Créer la session" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`/v2/examinations/sessions/${IDS.session}`));
    expect(api.calls.find((c) => c.method === "POST")!.body).toMatchObject({ examTypeId: IDS.type, institutionId: institution.id, code: "CEPE-2028", label: "CEPE 2028", sessionKind: "OFFICIAL", sessionYear: 2028 });
  });

  it("refuse un code invalide avant tout envoi", async () => {
    const api = setTestApi({ ...accessRoutes(["exam.session.read", "exam.session.manage"]), [`GET ${E}/sessions`]: page([]), [`GET ${E}/exam-types`]: { items: [typeDto()] }, "GET /api/v1/tenancy/institutions": { items: [institution] } });
    renderWithProviders(<SessionsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Nouvelle session" }));
    await screen.findByRole("option", { name: /CEPE — / });
    fireEvent.change(await screen.findByLabelText(/^Type d'examen/), { target: { value: IDS.type } });
    fireEvent.change(screen.getByLabelText(/^Code/), { target: { value: "code invalide!" } });
    fireEvent.change(screen.getByLabelText(/^Libellé/), { target: { value: "CEPE" } });
    fireEvent.click(screen.getByRole("button", { name: "Créer la session" }));
    expect((await screen.findAllByRole("alert")).length).toBeGreaterThan(0);
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });
});

describe("Détail d'une session", () => {
  it("affiche effectifs, épreuves figées et le point bloquant renvoyé par l'API (transition désactivée)", async () => {
    setTestApi({ ...accessRoutes(["exam.session.read", "exam.session.manage"]), [`GET ${S}`]: sessionDetail({ blockers: { REGISTRATION_CLOSED: ["Aucun candidat inscrit pour clore."] } }) });
    renderWithProviders(<SessionDetailScreen id={IDS.session} />);
    expect(await screen.findByTestId("count-registered")).toBeTruthy();
    expect(screen.getByTestId("count-registered").textContent).toBe("2");
    expect(screen.getByText("Épreuve 1 (fictive)")).toBeTruthy();
    expect(screen.getByText("Règles de démonstration")).toBeTruthy();
    expect(await screen.findByText("Aucun candidat inscrit pour clore.")).toBeTruthy();
    expect(((await screen.findByRole("button", { name: "Passer à : Inscriptions closes" })) as HTMLButtonElement).disabled).toBe(true);
  });

  it("publication : confirmation explicite puis transition (corps exact)", async () => {
    const api = setTestApi({
      ...accessRoutes(["exam.session.read", "exam.session.manage"]),
      [`GET ${S}`]: sessionDetail({ status: "RESULTS_ENTERED", progress: { index: 4, total: 7, percent: 66, next: "PUBLISHED", allowedNext: ["PUBLISHED"] } }),
      [`POST ${S}/transition`]: () => json(session({ status: "PUBLISHED" })),
    });
    renderWithProviders(<SessionDetailScreen id={IDS.session} />);
    fireEvent.click(await screen.findByRole("button", { name: "Passer à : Résultats publiés" }));
    expect(await screen.findByText("Publier les résultats")).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Publier" }));
    await screen.findByText("La session est maintenant : Résultats publiés.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ to: "PUBLISHED" });
  });

  it("sans gestion de session, aucune action n'est proposée", async () => {
    setTestApi({ ...accessRoutes(["exam.session.read"]), [`GET ${S}`]: sessionDetail() });
    renderWithProviders(<SessionDetailScreen id={IDS.session} />);
    await screen.findByTestId("count-registered");
    expect(screen.queryByRole("heading", { name: "Actions" })).toBeNull();
  });

  it("copie la définition d'un type quand elle n'est pas figée", async () => {
    const api = setTestApi({
      ...accessRoutes(["exam.session.read", "exam.session.manage"]),
      [`GET ${S}`]: sessionDetail({ definitionLockedAt: null, papers: [] }),
      [`POST ${S}/instantiate`]: () => json({ session: session(), paperCount: 3 }),
    });
    renderWithProviders(<SessionDetailScreen id={IDS.session} />);
    fireEvent.click(await screen.findByRole("button", { name: "Copier et figer la définition" }));
    await screen.findByText("Définition copiée : 3 épreuve(s).");
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });
});

describe("Types, centres", () => {
  it("charge le pack du primaire et rappelle qu'il est fictif", async () => {
    const api = setTestApi({
      ...accessRoutes(["exam.type.read", "exam.type.manage"]),
      [`GET ${E}/exam-types`]: { items: [typeDto()] },
      [`POST ${E}/exam-types/instantiate-pack`]: () => json({ pack: "PRIMARY", notice: "Données FICTIVES de démonstration.", createdTypes: ["CEPE"], existingTypes: [], createdExportFormats: [], createdImportFormats: [] }),
    });
    renderWithProviders(<TypesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Charger le pack du primaire (fictif)" }));
    expect(await screen.findByText("Données FICTIVES de démonstration.")).toBeTruthy();
    expect(screen.getByText("Pack chargé : 1 type(s) créé(s), 0 déjà présent(s).")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ pack: "PRIMARY" });
  });

  it("détail d'un type : épreuves et bandeau de démonstration", async () => {
    setTestApi({
      ...accessRoutes(["exam.type.read"]),
      [`GET ${E}/exam-types`]: { items: [typeDto()] },
      [`GET ${E}/exam-types/${IDS.type}`]: { ...typeDto(), tracks: [], papers: [{ ...paper(1), active: true }], requirements: [] },
    });
    renderWithProviders(<TypesScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Afficher le détail" }));
    expect(await screen.findByTestId("type-detail")).toBeTruthy();
    expect(screen.getByText("Épreuve 1 (fictive)")).toBeTruthy();
    expect(screen.getByText("Règles de démonstration")).toBeTruthy();
  });

  it("crée un centre (corps exact)", async () => {
    const api = setTestApi({ ...accessRoutes(["exam.center.manage"]), [`GET ${E}/centers`]: { items: [] }, [`POST ${E}/centers`]: () => json(center(), { status: 201 }) });
    renderWithProviders(<CentersScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Nouveau centre" }));
    fireEvent.change(await screen.findByLabelText(/^Code\*/), { target: { value: "c2" } });
    fireEvent.change(screen.getByLabelText(/^Nom/), { target: { value: "Collège hôte" } });
    fireEvent.change(screen.getByLabelText(/^Nature/), { target: { value: "HOST" } });
    fireEvent.click(screen.getByRole("button", { name: "Créer le centre" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ code: "C2", name: "Collège hôte", kind: "HOST", authorityCode: null, locality: null });
  });
});

describe("Candidats", () => {
  const routes = (permissions: string[], extra: Record<string, unknown> = {}) =>
    scope(permissions, { [`GET ${S}/candidates`]: page([candidate(1), candidate(2), candidate(3)]), ...extra });

  it("liste les candidats avec leurs pièces manquantes ; l'évaluation en lot appelle la règle de l'API", async () => {
    const api = setTestApi(
      routes(["exam.session.read", "exam.candidate.read", "exam.eligibility.evaluate"], {
        [`POST ${S}/eligibility/evaluate-all`]: () => json({ evaluated: 3, byResult: { ELIGIBLE: 3 }, failed: [] }),
      }),
    );
    renderWithProviders(<CandidatesScreen />);
    expect(await screen.findByText("KOUASSI Awa")).toBeTruthy();
    expect(screen.getByText("1 pièce(s) manquante(s)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Évaluer l'éligibilité de tous" }));
    await screen.findByText("3 candidat(s) évalué(s) par la règle.");
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Inscrire la sélection/ })).toBeNull();
  });

  it("inscription par lot : sélection exacte et refus ligne par ligne affichés", async () => {
    const api = setTestApi(
      routes(["exam.session.read", "exam.candidate.read", "exam.candidate.manage"], {
        [`POST ${S}/candidates/register-batch`]: () => json({ registered: [], failed: [{ candidateId: IDS.c3, code: "examinations.documents_incomplete", message: "Des pièces obligatoires manquent." }] }),
      }),
    );
    renderWithProviders(<CandidatesScreen />);
    fireEvent.click(await screen.findByLabelText("Sélectionner DIALLO Fatou"));
    fireEvent.click(screen.getByRole("button", { name: "Inscrire la sélection (1)" }));
    expect(await screen.findByText("Des pièces obligatoires manquent.")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ candidateIds: [IDS.c3] });
  });
});

describe("Dossier d'un candidat", () => {
  const detail = (extra: Record<string, unknown> = {}) => ({
    candidate: candidate(1),
    eligibilityChecks: [{ id: uuid(500), result: "ELIGIBLE", reasons: [], ruleVersionRef: uuid(501), evaluatedBy: uuid(900), evaluatedAt: "2027-02-01T08:00:00.000Z", overridden: false, overrideReason: null }],
    pieces: [{ requirementId: uuid(600), code: "ACTE_NAISSANCE", label: "Acte de naissance", required: true, status: "SUBMITTED", documentRef: uuid(601), rejectionReason: null, reviewedAt: null }],
    identifiers: [],
    assignment: null,
    history: [],
    scores: [],
    result: null,
    documents: [],
    ...extra,
  });
  const routes = (permissions: string[], extra: Record<string, unknown> = {}) => ({
    ...accessRoutes(permissions),
    [`GET ${E}/candidates/${IDS.c1}`]: detail(),
    [`GET ${S}`]: sessionDetail(),
    ...extra,
  });

  it("évalue par la règle (corps exact) et affiche l'origine de l'évaluation", async () => {
    const api = setTestApi(routes(["exam.candidate.read", "exam.eligibility.evaluate"], { [`POST ${E}/candidates/${IDS.c1}/eligibility`]: () => json({ candidate: candidate(1), check: detail().eligibilityChecks[0] }) }));
    renderWithProviders(<CandidateDetailScreen id={IDS.c1} />);
    expect(await screen.findByText("Évaluée par la règle")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Évaluer par la règle" }));
    await screen.findByText("Éligibilité évaluée par la règle.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ mode: "EVALUATE" });
  });

  it("dérogation : motif de 10 caractères exigé, puis corps exact", async () => {
    const api = setTestApi(routes(["exam.candidate.read", "exam.eligibility.evaluate", "exam.eligibility.override"], { [`POST ${E}/candidates/${IDS.c1}/eligibility`]: () => json({ candidate: candidate(1), check: detail().eligibilityChecks[0] }) }));
    renderWithProviders(<CandidateDetailScreen id={IDS.c1} />);
    fireEvent.click(await screen.findByRole("button", { name: "Accorder une dérogation" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif de la dérogation/), { target: { value: "court" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Accorder la dérogation" }));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Motif de la dérogation/), { target: { value: "Décision du directeur régional du 12 mars." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Accorder la dérogation" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ mode: "OVERRIDE", reason: "Décision du directeur régional du 12 mars." });
  });

  it("sans permission d'évaluation, les actions d'éligibilité sont masquées", async () => {
    setTestApi(routes(["exam.candidate.read"]));
    renderWithProviders(<CandidateDetailScreen id={IDS.c1} />);
    await screen.findByText("Évaluée par la règle");
    expect(screen.queryByRole("button", { name: "Évaluer par la règle" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Accorder une dérogation" })).toBeNull();
  });

  it("refus d'une pièce : motif exigé, corps exact", async () => {
    const api = setTestApi(routes(["exam.candidate.read", "exam.candidate.manage"], { [`PUT ${E}/candidates/${IDS.c1}/documents/${uuid(600)}`]: () => json({ pieces: [], missing: [] }) }));
    renderWithProviders(<CandidateDetailScreen id={IDS.c1} />);
    fireEvent.click(await screen.findByRole("button", { name: "Refuser" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif du refus/), { target: { value: "Illisible" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Refuser la pièce" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PUT")).toBe(true));
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({ action: "REJECT", rejectionReason: "Illisible" });
  });
});

describe("Répartition", () => {
  it("lance la répartition automatique (corps exact) et affiche le bilan", async () => {
    const api = setTestApi(scope(["exam.session.read", "exam.center.manage"], { [`GET ${S}/centers`]: overview(), [`POST ${S}/assignments/auto`]: () => json({ assigned: 1, alreadyAssigned: 1, capacity: 30 }) }));
    renderWithProviders(<AssignmentsScreen />);
    expect(await screen.findByTestId("assign-unassigned")).toBeTruthy();
    expect(screen.getByTestId("assign-capacity").textContent).toBe("30");
    fireEvent.click(await screen.findByRole("button", { name: "Répartir automatiquement" }));
    await screen.findByText("1 candidat(s) placé(s), 1 déjà placé(s).");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ reassign: false });
  });

  it("répartition figée : actions désactivées ; capacité insuffisante signalée", async () => {
    setTestApi(scope(["exam.session.read", "exam.center.manage"], { [`GET ${S}/centers`]: overview({ frozen: true, capacity: 1, registered: 4, unassigned: 3 }) }));
    renderWithProviders(<AssignmentsScreen />);
    expect(await screen.findByText("La répartition est figée à ce stade de la session.")).toBeTruthy();
    expect(screen.getByText("Capacité insuffisante : il manque 3 place(s).")).toBeTruthy();
    expect(((await screen.findByRole("button", { name: "Répartir automatiquement" })) as HTMLButtonElement).disabled).toBe(true);
  });

  it("retire la place d'un candidat", async () => {
    const api = setTestApi(scope(["exam.session.read", "exam.center.manage"], { [`GET ${S}/centers`]: overview(), [`DELETE ${E}/assignments/${IDS.c1}`]: () => json({}) }));
    renderWithProviders(<AssignmentsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Retirer la place" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "DELETE")).toBe(true));
  });
});

describe("Examens blancs", () => {
  it("calcule par la règle et trace la version de règle utilisée", async () => {
    nav.search = `session=${IDS.mockSession}`;
    const detail = sessionDetail({ id: IDS.mockSession, sessionKind: "MOCK", label: "CEPE blanc" });
    const api = setTestApi({
      ...accessRoutes(["exam.mock.manage"]),
      [`GET ${E}/sessions`]: page([session({ id: IDS.mockSession, sessionKind: "MOCK", label: "CEPE blanc" })]),
      [`GET ${E}/sessions/${IDS.mockSession}`]: detail,
      [`GET ${E}/sessions/${IDS.mockSession}/mock/links`]: { items: [] },
      [`POST ${E}/sessions/${IDS.mockSession}/mock/compute`]: () => json({ computed: 2, skippedPublished: 0, failed: [], ruleVersionId: uuid(700), ruleSetCode: "CI-EXAM-PLACEHOLDER", demoRules: true }),
    });
    renderWithProviders(<MockScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Calculer par la règle" }));
    expect(await screen.findByTestId("mock-trace")).toBeTruthy();
    expect(screen.getByTestId("mock-trace").textContent).toContain("CI-EXAM-PLACEHOLDER");
    expect(screen.getByText("Le calcul a utilisé des règles de démonstration.")).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });
});

describe("Notes et résultats", () => {
  const routes = (permissions: string[], extra: Record<string, unknown> = {}) =>
    scope(permissions, { [`GET ${S}/results`]: page([result(1), result(2, { status: "PUBLISHED", source: "IMPORTED" })]), [`GET ${S}/scores`]: scoreMatrix(), [`GET ${S}/candidates`]: page([candidate(1), candidate(2)]), ...extra });

  it("liste les résultats ; la publication n'est offerte qu'avec la permission", async () => {
    setTestApi(routes(["exam.session.read", "exam.result.read"]));
    renderWithProviders(<ResultsScreen />);
    expect(await screen.findByText("KOUASSI Awa")).toBeTruthy();
    expect(screen.getAllByText("Admis").length).toBeGreaterThan(0);
    expect(screen.getByText("Importé de l'autorité")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Publier le résultat/ })).toBeNull();
  });

  it("publie un résultat non publié", async () => {
    const api = setTestApi(routes(["exam.session.read", "exam.result.read", "exam.result.publish"], { [`POST ${E}/results/${IDS.result1}/publish`]: () => json(result(1, { status: "PUBLISHED" })) }));
    renderWithProviders(<ResultsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Publier le résultat de KOUASSI Awa" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
  });

  it("saisie d'un résultat officiel : corps exact (moyenne décimale exacte)", async () => {
    const api = setTestApi(routes(["exam.session.read", "exam.result.read", "exam.result.enter"], { [`PUT ${S}/results`]: () => json({ saved: 1, failed: [] }) }));
    renderWithProviders(<ResultsScreen />);
    await screen.findByRole("option", { name: /TRAORE Moussa/ });
    fireEvent.change(await screen.findByLabelText(/^Candidat/), { target: { value: IDS.c2 } });
    fireEvent.change(screen.getByLabelText(/^Moyenne/), { target: { value: "13,25" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le résultat" }));
    await screen.findByText("1 résultat(s) enregistré(s).");
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({ items: [{ candidateId: IDS.c2, resultCode: "ADMITTED", average: "13.25" }] });
  });

  it("saisie des notes : seules les cellules modifiées partent, virgule convertie, échecs affichés", async () => {
    const api = setTestApi(
      routes(["exam.session.read", "exam.result.read", "exam.score.enter"], {
        [`PUT ${S}/scores/bulk`]: () => json({ saved: 0, unchanged: 0, failed: [{ index: 0, candidateId: IDS.c2, paperId: IDS.paper2, code: "examinations.score_above_scale", message: "La note dépasse le barème." }] }),
      }),
    );
    renderWithProviders(<ResultsScreen />);
    fireEvent.click(await screen.findByRole("tab", { name: "Notes par épreuve" }));
    fireEvent.change(await screen.findByLabelText("Note de TRAORE Moussa en EP2"), { target: { value: "25,5" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les notes modifiées (1)" }));
    expect(await screen.findByText("La note dépasse le barème.")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({ items: [{ candidateId: IDS.c2, paperId: IDS.paper2, status: "ENTERED", score: "25.5" }] });
  });
});

describe("Imports", () => {
  const routes = (extra: Record<string, unknown> = {}) =>
    scope(["exam.session.read", "exam.import.manage", "exam.result.release"], { [`GET ${E}/import-formats`]: { items: [importFormat()] }, [`GET ${S}/imports`]: { items: [batch()] }, [`GET ${E}/imports/${IDS.batch}`]: { batch: batch(), rows: page([{ id: uuid(800), lineNo: 3, status: "ERROR", errorCode: "RESULT_CODE_UNKNOWN", candidateNumber: "CEPE-2027-0002", payload: {} }]) }, ...extra });

  it("un fichier avec des erreurs : lignes en erreur lisibles, application impossible", async () => {
    setTestApi(routes());
    renderWithProviders(<ImportsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Ouvrir" }));
    expect(await screen.findByTestId("batch-counts")).toBeTruthy();
    expect(screen.getByTestId("batch-counts").textContent).toBe("3 ligne(s) : 2 valide(s), 1 en erreur.");
    expect(await screen.findByText("Code de résultat inconnu.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Appliquer l'import" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/un import comportant des erreurs ne s'applique pas/)).toBeTruthy();
  });

  it("un fichier sans erreur : application atomique après analyse", async () => {
    const clean = batch({ errorCount: 0, okCount: 3 });
    const api = setTestApi(
      routes({
        [`GET ${S}/imports`]: { items: [clean] },
        [`GET ${E}/imports/${IDS.batch}`]: { batch: clean, rows: page([]) },
        [`POST ${E}/imports/${IDS.batch}/apply`]: () => json(batch({ status: "APPLIED", errorCount: 0 })),
      }),
    );
    renderWithProviders(<ImportsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Ouvrir" }));
    fireEvent.click(await screen.findByRole("button", { name: "Appliquer l'import" }));
    await screen.findByText("Import appliqué.");
    expect(api.calls.find((c) => c.method === "POST")!.path).toBe(`${E}/imports/${IDS.batch}/apply`);
  });

  it("dépôt : le contenu part en base64 avec le format choisi", async () => {
    const api = setTestApi(routes({ [`POST ${S}/imports`]: () => json(batch({ status: "UPLOADED" }), { status: 201 }) }));
    renderWithProviders(<ImportsScreen />);
    await screen.findByRole("option", { name: /Résultats de l'autorité/ });
    fireEvent.change(await screen.findByLabelText(/^Format du fichier/), { target: { value: IDS.format } });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["numero;resultat\nX;A\n"], "resultats.csv", { type: "text/csv" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    const body = api.calls.find((c) => c.method === "POST")!.body as { kind: string; formatId: string; fileName: string; contentBase64: string };
    expect(body.kind).toBe("RESULTS");
    expect(body.formatId).toBe(IDS.format);
    expect(body.fileName).toBe("resultats.csv");
    expect(atob(body.contentBase64)).toBe("numero;resultat\nX;A\n");
  });
});

describe("Corrections (quatre yeux)", () => {
  const routes = (permissions: string[], extra: Record<string, unknown> = {}) =>
    scope(permissions, { [`GET ${S}/revision-requests`]: page([revision()]), [`GET ${S}/results`]: page([result(1)]), [`GET ${S}/scores`]: scoreMatrix(), ...extra });

  it("affiche valeur actuelle et proposée ; l'approbation refusée par l'API (même personne) est affichée", async () => {
    const api = setTestApi(
      routes(["exam.session.read", "exam.result.read", "exam.result.revise"], {
        [`POST ${E}/revision-requests/${IDS.revision}/approve`]: () => json({ code: "examinations.revision_same_person", message: "Vous ne pouvez pas approuver votre propre demande de correction." }, { status: 409 }),
      }),
    );
    renderWithProviders(<CorrectionsScreen />);
    expect(await screen.findByText("Valeur proposée")).toBeTruthy();
    expect(screen.getByText("Erreur de saisie constatée lors de la vérification.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approuver" }));
    expect(await screen.findByText("Vous ne pouvez pas approuver votre propre demande de correction.")).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("rejet : motif exigé, corps exact", async () => {
    const api = setTestApi(routes(["exam.session.read", "exam.result.read", "exam.result.revise"], { [`POST ${E}/revision-requests/${IDS.revision}/reject`]: () => json(revision({ status: "REJECTED" })) }));
    renderWithProviders(<CorrectionsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Rejeter" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif du rejet/), { target: { value: "Justificatif absent." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rejeter" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ note: "Justificatif absent." });
  });

  it("sans permission de révision, ni approbation ni rejet", async () => {
    setTestApi(routes(["exam.session.read", "exam.result.read"]));
    renderWithProviders(<CorrectionsScreen />);
    await screen.findByText("Valeur proposée");
    expect(screen.queryByRole("button", { name: "Approuver" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Rejeter" })).toBeNull();
  });

  it("nouvelle demande sur un résultat : motif de 10 caractères, corps exact", async () => {
    const api = setTestApi(routes(["exam.session.read", "exam.result.read", "exam.result.enter"], { [`POST ${E}/results/${IDS.result1}/revisions`]: () => json(revision(), { status: 201 }) }));
    renderWithProviders(<CorrectionsScreen />);
    fireEvent.change(await screen.findByLabelText(/^Résultat concerné/), { target: { value: IDS.result1 } });
    fireEvent.change(screen.getByLabelText(/^Résultat proposé/), { target: { value: "FAILED" } });
    fireEvent.change(screen.getByLabelText(/^Moyenne proposée/), { target: { value: "9,5" } });
    fireEvent.change(screen.getByLabelText(/^Motif/), { target: { value: "court" } });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer la demande" }));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText(/^Motif/), { target: { value: "Erreur de transcription de la moyenne." } });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer la demande" }));
    await screen.findByText("Demande envoyée : une autre personne doit l'approuver.");
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ resultCode: "FAILED", average: "9.5", reason: "Erreur de transcription de la moyenne." });
  });
});

describe("Statistiques", () => {
  it("affiche les taux calculés par la règle sans les recalculer", async () => {
    setTestApi(scope(["exam.session.read", "exam.statistics.read"], { [`GET ${S}/statistics`]: statistics({ groups: [group("F", { rate: "75.500" }), group("M", { rate: "50.000" })], total: group("ALL", { rate: "62.750" }), groupBy: "SEX" }) }));
    renderWithProviders(<StatisticsScreen />);
    expect(await screen.findByTestId("rate-total")).toBeTruthy();
    expect(screen.getByTestId("rate-total").textContent).toBe("62,750 %");
    expect(screen.getByText("75,500 %")).toBeTruthy();
    expect(screen.getByText("Filles")).toBeTruthy();
  });

  it("taux indisponible : explication de l'API, aucun taux inventé", async () => {
    setTestApi(scope(["exam.session.read", "exam.statistics.read"], { [`GET ${S}/statistics`]: statistics({ rateAvailable: false, rateNote: "Aucune règle de taux n'est épinglée.", groups: [group("ALL", { rate: null })], total: group("ALL", { rate: null }) }) }));
    renderWithProviders(<StatisticsScreen />);
    expect(await screen.findByText("Aucune règle de taux n'est épinglée.")).toBeTruthy();
    expect(screen.getByTestId("rate-total").textContent).toBe("—");
  });
});

describe("Exports et documents", () => {
  const routes = (extra: Record<string, unknown> = {}) =>
    scope(["exam.session.read", "exam.export.run", "exam.document.issue"], {
      [`GET ${E}/export-formats`]: { items: [exportFormat()] },
      [`GET ${S}/exports`]: { items: [exportRun()] },
      [`GET ${S}/issued-documents`]: page([issuedDoc()]),
      ...extra,
    });

  it("lance un export (corps exact) et suit l'URL signée à la demande, sans l'afficher", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const api = setTestApi(
      routes({
        [`POST ${S}/exports`]: () => json(exportRun(), { status: 201 }),
        [`GET ${E}/exports/${IDS.exportRun}/download`]: { url: "https://stockage.example/liste.csv", expiresAt: "2027-06-20T09:05:00.000Z", fileName: "liste.csv", contentType: "text/csv", sha256: "b".repeat(64), rowCount: 2 },
      }),
    );
    renderWithProviders(<ExportsScreen />);
    await screen.findByRole("option", { name: /Liste des candidats/ });
    fireEvent.change(await screen.findByLabelText(/^Format d'export/), { target: { value: IDS.format } });
    fireEvent.click(screen.getByRole("button", { name: "Lancer l'export" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ formatId: IDS.format, filters: {} });
    fireEvent.click(await screen.findByRole("button", { name: "Télécharger" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://stockage.example/liste.csv", "_blank", "noopener,noreferrer"));
    expect(screen.queryByText(/stockage\.example/)).toBeNull();
  });

  it("révocation d'un document : motif de 10 caractères exigé", async () => {
    const api = setTestApi(routes({ [`POST ${E}/issued-documents/${IDS.doc}/revoke`]: () => json(issuedDoc({ status: "REVOKED", revokedReason: "Erreur d'identité" })) }));
    renderWithProviders(<ExportsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Révoquer" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Motif de la révocation/), { target: { value: "Erreur d'identité constatée au guichet." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Révoquer" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ reason: "Erreur d'identité constatée au guichet." });
  });

  it("sans permission d'émission, la section documents est masquée", async () => {
    setTestApi({ ...scope(["exam.session.read", "exam.export.run"]), [`GET ${E}/export-formats`]: { items: [exportFormat()] }, [`GET ${S}/exports`]: { items: [] } });
    renderWithProviders(<ExportsScreen />);
    await screen.findByText("Aucun export");
    expect(screen.queryByRole("heading", { name: "Documents" })).toBeNull();
  });
});

describe("Examen de l'enfant / de l'élève", () => {
  it("parent : inscription, place, résultat en attente et documents ; jamais de notes", async () => {
    setTestApi({ ...accessRoutes(["exam.document.child.read"]), [`GET ${E}/family/exams`]: { items: [familyExam()] } });
    renderWithProviders(<FamilyScreen />);
    expect(await screen.findByTestId("family-exam")).toBeTruthy();
    expect(screen.getByText("Examen de mon enfant")).toBeTruthy();
    expect(screen.getByText("CEPE-2027-0001")).toBeTruthy();
    expect(screen.getByText("École test (fictive), salle S1, place 7")).toBeTruthy();
    expect(screen.getByText("Le résultat n'est pas encore publié.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Télécharger Convocation de Awa KOUASSI" })).toBeTruthy();
    expect(screen.queryByText(/Moyenne/)).toBeNull();
    expect(screen.getByText("Règles de démonstration")).toBeTruthy();
  });

  it("élève : son examen, issue publiée affichée", async () => {
    setTestApi({ ...accessRoutes(["exam.document.self.read"]), [`GET ${E}/me/exams`]: { items: [familyExam({ outcome: "ADMITTED", documents: [] })] } });
    renderWithProviders(<FamilyScreen />);
    expect(await screen.findByText("Mon examen")).toBeTruthy();
    expect((await screen.findAllByText("Admis")).length).toBeGreaterThan(0);
  });

  it("aucun examen : état vide", async () => {
    setTestApi({ ...accessRoutes(["exam.document.child.read"]), [`GET ${E}/family/exams`]: { items: [] } });
    renderWithProviders(<FamilyScreen />);
    expect(await screen.findByText("Aucun examen")).toBeTruthy();
  });
});

describe("Navigation", () => {
  it("n'affiche que les entrées permises", async () => {
    nav.path = "/v2/examinations";
    setTestApi(accessRoutes(["exam.session.read", "exam.statistics.read"]));
    renderWithProviders(<ExaminationsNav />);
    expect(await screen.findByRole("link", { name: "Sessions" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Statistiques" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Imports" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Centres et salles" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Examen de l'élève" })).toBeNull();
  });
});
