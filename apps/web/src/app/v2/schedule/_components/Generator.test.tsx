// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { classroom, year } from "../../_test/fixtures";
import { IDS, institution, timetable, uuid } from "../_test/fixtures";
import { GeneratorLaunchScreen } from "./GeneratorLaunchScreen";
import { GeneratorRunScreen } from "./GeneratorRunScreen";
import { GeneratorRunsScreen } from "./GeneratorRunsScreen";

vi.setConfig({ testTimeout: 30_000 });

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/schedule/generator", useRouter: () => ({ push: nav.push, replace: vi.fn() }), useSearchParams: () => new URLSearchParams("") }));

const S = "/api/v1/scheduling";
const RUN = uuid(7000);
const CLASS = uuid(500);
const NODE_MATH = uuid(8001);
const NODE_FR = uuid(8002);
const TEACHER = uuid(4000);
const ROOM = uuid(800);

const runDto = (over: Record<string, unknown> = {}) => ({
  id: RUN,
  institutionId: IDS.institution,
  campusId: null,
  academicYearId: uuid(100),
  periodId: null,
  name: "Proposition de rentrée",
  status: "COMPLETED",
  seed: "graine-test",
  summary: { sessions: 4, placed: 3, unplacedSessions: 1, softCost: 42, requirements: 2 },
  errorCode: null,
  errorMessage: null,
  fixedTimetableId: null,
  appliedTimetableId: null,
  requestedBy: uuid(1),
  requestedAt: "2026-10-01T08:00:00.000Z",
  startedAt: "2026-10-01T08:00:01.000Z",
  completedAt: "2026-10-01T08:00:02.000Z",
  appliedAt: null,
  discardedAt: null,
  params: { validFrom: "2026-09-07", validTo: "2027-01-29", seed: "graine-test", name: "Proposition de rentrée", requirements: [] },
  ...over,
});

const result = (over: Record<string, unknown> = {}) => ({
  grid: {
    weekdays: [1, 2],
    periods: [
      { index: 0, startTime: "08:00", endTime: "09:00", label: null },
      { index: 1, startTime: "09:00", endTime: "10:00", label: null },
    ],
  },
  placements: [
    { requirementId: "req-1", sessionIndex: 0, classroomId: CLASS, curriculumNodeId: NODE_MATH, teacherId: TEACHER, roomId: ROOM, timeSlotId: null, weekday: 1, startPeriod: 0, periods: 2, startTime: "08:00", endTime: "10:00" },
    { requirementId: "req-2", sessionIndex: 0, classroomId: CLASS, curriculumNodeId: NODE_FR, teacherId: null, roomId: null, timeSlotId: null, weekday: 2, startPeriod: 1, periods: 1, startTime: "09:00", endTime: "10:00" },
  ],
  unplaced: [
    { requirementId: "req-2", classroomId: CLASS, curriculumNodeId: NODE_FR, label: "Français — 6e A", requested: 2, missing: 1, reasons: [{ code: "TEACHER_BUSY", count: 3 }, { code: "CLASS_OVERLOADED", count: 1, detail: "5 périodes demandées pour 4 utilisables par semaine" }] },
  ],
  score: { softCost: 42, initialSoftCost: 80, unplacedSessions: 1, breakdown: { gap: 10, teacherGap: 4, spread: 6, balance: 20, preference: 2, teacherChange: 0 } },
  stats: { sessions: 4, placed: 3, iterations: 3000, accepted: 120, improvements: 15, stoppedBy: "ITERATIONS", elapsedMs: 250, seed: "graine-test" },
  warnings: [{ code: "NO_TEACHER", message: "Aucun enseignant candidat pour « Français » : séance placée sans enseignant." }],
  labels: { classrooms: { [CLASS]: "6e A" }, staff: { [TEACHER]: "Mme Koné" }, rooms: { [ROOM]: "S101" }, nodes: { [NODE_MATH]: "Mathématiques", [NODE_FR]: "Français" } },
  publishedTimetable: { id: IDS.timetable, name: "EDT publié 2026" },
  ...over,
});

const defaults = {
  weekdays: [1, 2, 3, 4, 5],
  periods: [
    { index: 0, startTime: "08:00", endTime: "09:00", label: null },
    { index: 1, startTime: "09:00", endTime: "10:00", label: null },
  ],
  gridSource: "REGULAR",
  weights: { gap: 10, teacherGap: 4, spread: 6, balance: 1, preference: 3, teacherChange: 5 },
  timeLimitSeconds: { default: 20, max: 600 },
  maxIterations: { default: 100000, max: 2000000 },
  syncSessionLimit: 250,
  rooms: 3,
  availabilityMode: "OPEN",
  ports: { academic: true, people: true },
};

const node = (id: string, label: string) => ({
  nodeId: id,
  lineageId: id,
  parentId: null,
  nodeTypeCode: "SUBJECT",
  code: label.slice(0, 3).toUpperCase(),
  label,
  subjectId: null,
  coefficient: null,
  credits: null,
  isMandatory: true,
  isTransversal: false,
  categoryCode: null,
  periodTypeCode: null,
  periodOrdinal: null,
  registrationKind: "REGULAR",
  enrollmentCourseId: null,
});

beforeEach(() => {
  nav.push.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("Générateur : liste des propositions", () => {
  it("affiche les propositions, leur état et le bouton de lancement réservé à schedule.manage", async () => {
    setTestApi({
      ...accessRoutes(["schedule.read", "schedule.manage"]),
      [`GET ${S}/autogen/runs`]: { items: [runDto(), runDto({ id: uuid(7001), name: "Brouillon raté", status: "FAILED", errorCode: "x", errorMessage: "Boom", summary: null })] },
    });
    renderWithProviders(<GeneratorRunsScreen />);
    expect(await screen.findByRole("link", { name: "Proposition de rentrée" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Proposition de rentrée" }).getAttribute("href")).toBe(`/v2/schedule/generator/${RUN}`);
    expect(screen.getByText("Proposition prête")).toBeTruthy();
    expect(screen.getByText("Échec")).toBeTruthy();
    expect(screen.getByText(/n'écrase jamais un emploi du temps publié/)).toBeTruthy();
    expect(await screen.findByRole("link", { name: "Nouvelle génération" })).toBeTruthy();
  });

  it("sans permission de gestion : pas de bouton de lancement", async () => {
    setTestApi({ ...accessRoutes(["schedule.read"]), [`GET ${S}/autogen/runs`]: { items: [] } });
    renderWithProviders(<GeneratorRunsScreen />);
    expect(await screen.findByText("Aucune génération pour le moment.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Nouvelle génération" })).toBeNull();
  });
});

describe("Générateur : écran de lancement", () => {
  const routes = () => ({
    ...accessRoutes(["schedule.read", "schedule.manage"]),
    "GET /api/v1/tenancy/institutions": { items: [institution()] },
    "GET /api/v1/academic/years": { items: [year({ isCurrent: true, institutionId: IDS.institution })] },
    "GET /api/v1/academic/classrooms": { items: [classroom({ id: CLASS, name: "6e A" })], total: 1, page: 1, pageSize: 200 },
    [`GET /api/v1/academic/classrooms/${CLASS}/nodes`]: { items: [node(NODE_MATH, "Mathématiques"), node(NODE_FR, "Français")] },
    [`GET ${S}/autogen/defaults`]: defaults,
    [`GET ${S}/timetables`]: { items: [timetable()] },
  });

  it("ajoute les matières d'une classe, envoie la demande validée et ouvre la proposition", async () => {
    const api = setTestApi({ ...routes(), [`POST ${S}/autogen/runs`]: () => json({ run: runDto({ status: "QUEUED" }), executed: false }, { status: 202 }) });
    renderWithProviders(<GeneratorLaunchScreen />);
    expect(await screen.findByText(/5 jours|Jours ouvrés/)).toBeTruthy();
    expect(await screen.findByText(/2 périodes par jour de 08:00 à 10:00/)).toBeTruthy();

    // Aucun besoin : le lancement est bloqué.
    expect((screen.getByRole("button", { name: "Lancer le calcul" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(await screen.findByLabelText("Classe"), { target: { value: CLASS } });
    const addAll = await screen.findByRole("button", { name: "Ajouter toutes ses matières" });
    await waitFor(() => expect((addAll as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(addAll);
    const table = await screen.findByRole("table", { name: "Besoins par matière et par classe" });
    expect(within(table).getByText("Mathématiques")).toBeTruthy();
    expect(screen.getByText("2 besoin(s), 2 séance(s) par semaine à placer.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Séances par semaine : Mathématiques, 6e A"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Périodes par séance : Mathématiques, 6e A"), { target: { value: "2" } });
    expect(screen.getByText("2 besoin(s), 4 séance(s) par semaine à placer.")).toBeTruthy();

    // Nom obligatoire (message du contrat, en français).
    fireEvent.click(screen.getByRole("button", { name: "Lancer le calcul" }));
    expect(await screen.findByText("Le nom est requis.")).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);

    fireEvent.change(screen.getByLabelText(/Nom de la proposition/), { target: { value: "EDT automne" } });
    fireEvent.change(screen.getByLabelText("Graine"), { target: { value: "ma-graine" } });
    fireEvent.change(screen.getByLabelText("Trous des classes"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Lancer le calcul" }));

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`/v2/schedule/generator/${RUN}`));
    const post = api.calls.find((c) => c.method === "POST" && c.path === `${S}/autogen/runs`)!;
    expect(post.body).toMatchObject({
      institutionId: IDS.institution,
      academicYearId: uuid(100),
      name: "EDT automne",
      seed: "ma-graine",
      weights: { gap: 20 },
      validFrom: "2026-09-01",
      validTo: "2027-08-31",
      requirements: [
        { classroomId: CLASS, curriculumNodeId: NODE_MATH, sessionsPerWeek: 3, sessionPeriods: 2, teacherIds: [] },
        { classroomId: CLASS, curriculumNodeId: NODE_FR, sessionsPerWeek: 1, sessionPeriods: 1, teacherIds: [] },
      ],
    });
  });

  it("sans grille horaire ni ouverture : avertissement explicite, rien n'est deviné", async () => {
    setTestApi({ ...routes(), [`GET ${S}/autogen/defaults`]: { ...defaults, gridSource: "NONE", weekdays: [], periods: [] } });
    renderWithProviders(<GeneratorLaunchScreen />);
    expect(await screen.findByText(/Aucune grille horaire n'est enregistrée/)).toBeTruthy();
    // La journée type se saisit directement dans le formulaire (QA C-03-03) ; valeurs proposées par défaut.
    expect((screen.getByLabelText("Début de la journée") as HTMLInputElement).value).toBe("08:00");
    expect((screen.getByLabelText("Fin de la journée") as HTMLInputElement).value).toBe("17:00");
    expect((screen.getByLabelText(/Durée d'une période/) as HTMLInputElement).value).toBe("60");
  });

  it("erreur de l'API (enseignant parti) : message affiché, pas de navigation", async () => {
    setTestApi({
      ...routes(),
      [`POST ${S}/autogen/runs`]: () => json({ status: 422, code: "scheduling.staff_not_eligible", kind: "validation", message: "Intervenant(s) non planifiable(s) : Parti." }, { status: 422 }),
    });
    renderWithProviders(<GeneratorLaunchScreen />);
    await screen.findByRole("option", { name: "6e A" });
    fireEvent.change(screen.getByLabelText("Classe"), { target: { value: CLASS } });
    const addAll = await screen.findByRole("button", { name: "Ajouter toutes ses matières" });
    await waitFor(() => expect((addAll as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(addAll);
    fireEvent.change(await screen.findByLabelText(/Nom de la proposition/), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "Lancer le calcul" }));
    expect(await screen.findByText(/non planifiable/)).toBeTruthy();
    expect(nav.push).not.toHaveBeenCalled();
  });
});

describe("Générateur : examen et application d'une proposition", () => {
  const detail = (run = runDto(), res: unknown = result()) => ({ [`GET ${S}/autogen/runs/${RUN}`]: { run, result: res } });

  it("aperçu hebdomadaire par classe / enseignant / salle, sans identifiant brut", async () => {
    setTestApi({ ...accessRoutes(["schedule.read", "schedule.manage"]), ...detail(), [`GET ${S}/timetables`]: { items: [] } });
    renderWithProviders(<GeneratorRunScreen id={RUN} />);
    expect(await screen.findByRole("heading", { name: "Proposition de rentrée" })).toBeTruthy();
    expect(screen.getByText("Graine : graine-test")).toBeTruthy();
    expect(screen.getByText(/Ceci est une proposition/)).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("80 → 42")).toBeTruthy();

    const grid = await screen.findByRole("table", { name: "Semaine type de 6e A" });
    // La séance de 2 périodes occupe deux lignes (rowSpan) ; le français est placé sans enseignant ni salle.
    expect(within(grid).getByText("Mathématiques").closest("td")!.getAttribute("rowspan")).toBe("2");
    expect(within(grid).getByText("Mme Koné")).toBeTruthy();
    expect(within(grid).getByText("S101")).toBeTruthy();
    expect(within(grid).getByText("Sans enseignant")).toBeTruthy();
    expect(grid.textContent).not.toMatch(/00000000-0000/);

    fireEvent.change(screen.getByLabelText("Vue"), { target: { value: "staff" } });
    expect(await screen.findByRole("table", { name: "Semaine type de Mme Koné" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Vue"), { target: { value: "room" } });
    expect(await screen.findByRole("table", { name: "Semaine type de S101" })).toBeTruthy();
  });

  it("conflits et points d'attention : séances non placées avec leurs causes, avertissements, publié inchangé", async () => {
    setTestApi({ ...accessRoutes(["schedule.read", "schedule.manage"]), ...detail(), [`GET ${S}/timetables`]: { items: [] } });
    renderWithProviders(<GeneratorRunScreen id={RUN} />);
    fireEvent.click(await screen.findByRole("tab", { name: /Conflits et points d'attention \(2\)/ }));
    expect(await screen.findByText(/Aucun conflit enseignant, classe ou salle/)).toBeTruthy();
    const table = screen.getByRole("table", { name: "Séances non placées et causes" });
    expect(within(table).getByText("Français — 6e A")).toBeTruthy();
    expect(within(table).getByText("1 sur 2")).toBeTruthy();
    expect(within(table).getByText("La classe demande plus d'heures que la semaine n'en offre")).toBeTruthy();
    expect(within(table).getByText(/5 périodes demandées pour 4 utilisables/)).toBeTruthy();
    expect(within(table).getByText("Enseignant déjà occupé sur ces créneaux")).toBeTruthy();
    expect(screen.getByText(/Aucun enseignant candidat pour « Français »/)).toBeTruthy();
    expect(screen.getByText(/Un emploi du temps publié existe déjà pour cette année \(« EDT publié 2026 »\)/)).toBeTruthy();
  });

  it("application : confirmation de la proposition incomplète, nouveau brouillon, puis ouverture de l'emploi du temps", async () => {
    const api = setTestApi({
      ...accessRoutes(["schedule.read", "schedule.manage"]),
      ...detail(),
      [`GET ${S}/timetables`]: { items: [timetable({ id: uuid(9501), name: "Brouillon existant" })] },
      [`POST ${S}/autogen/runs/${RUN}/apply`]: () => json({ run: runDto({ status: "APPLIED", appliedTimetableId: uuid(9700), appliedAt: "2026-10-01T09:00:00.000Z" }), timetable: timetable({ id: uuid(9700), name: "EDT automne" }), entriesCreated: 3, entriesReplaced: 0, unplacedSessions: 1, publishedTimetable: null }),
    });
    renderWithProviders(<GeneratorRunScreen id={RUN} />);
    fireEvent.click(await screen.findByRole("button", { name: "Examiner et appliquer" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/ne publie rien et ne touche jamais un emploi du temps publié/)).toBeTruthy();
    expect(within(dialog).getByText(/Un emploi du temps publié existe déjà \(« EDT publié 2026 »\) : il reste inchangé/)).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText(/Nom du brouillon/), { target: { value: "EDT automne" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Appliquer" }));
    expect(await within(dialog).findByText(/Confirmez que vous acceptez 1 séance\(s\) non placée\(s\)/)).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);

    fireEvent.click(within(dialog).getByLabelText(/J'accepte d'appliquer une proposition incomplète/));
    fireEvent.click(within(dialog).getByRole("button", { name: "Appliquer" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`/v2/schedule/timetables/${uuid(9700)}`));
    const post = api.calls.find((c) => c.method === "POST" && c.path.endsWith("/apply"))!;
    expect(post.body).toEqual({ mode: "NEW_DRAFT", name: "EDT automne", validFrom: "2026-09-07", validTo: "2027-01-29", acceptUnplaced: true });
  });

  it("remplacement d'un brouillon : cible et confirmation obligatoires, jamais le publié proposé", async () => {
    const api = setTestApi({
      ...accessRoutes(["schedule.read", "schedule.manage"]),
      ...detail(runDto(), result({ unplaced: [], score: { ...result().score, unplacedSessions: 0 } })),
      [`GET ${S}/timetables`]: ({ url }: { url: URL }) => json({ items: url.searchParams.get("status") === "DRAFT" ? [timetable({ id: uuid(9501), name: "Brouillon existant" })] : [] }),
      [`POST ${S}/autogen/runs/${RUN}/apply`]: () => json({ run: runDto({ status: "APPLIED", appliedTimetableId: uuid(9501), appliedAt: "2026-10-01T09:00:00.000Z" }), timetable: timetable({ id: uuid(9501) }), entriesCreated: 3, entriesReplaced: 5, unplacedSessions: 0, publishedTimetable: null }),
    });
    renderWithProviders(<GeneratorRunScreen id={RUN} />);
    fireEvent.click(await screen.findByRole("button", { name: "Examiner et appliquer" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Destination"), { target: { value: "REPLACE_DRAFT" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Appliquer" }));
    expect(await within(dialog).findByText("Choisissez le brouillon à remplacer.")).toBeTruthy();
    await waitFor(() => expect(within(dialog).getAllByRole("option").map((o) => o.textContent)).toContain("Brouillon existant"));
    fireEvent.change(within(dialog).getByLabelText(/Brouillon à remplacer/), { target: { value: uuid(9501) } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Appliquer" }));
    expect(await within(dialog).findByText("Confirmez le remplacement du brouillon pour continuer.")).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.click(within(dialog).getByLabelText(/Je confirme le remplacement/));
    fireEvent.click(within(dialog).getByRole("button", { name: "Appliquer" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`/v2/schedule/timetables/${uuid(9501)}`));
    expect(api.calls.find((c) => c.path.endsWith("/apply"))!.body).toEqual({ mode: "REPLACE_DRAFT", targetTimetableId: uuid(9501), confirmReplace: true, acceptUnplaced: false });
  });

  it("calcul en cours, en échec, abandonné : états annoncés, aucune action d'application", async () => {
    setTestApi({ ...accessRoutes(["schedule.read", "schedule.manage"]), ...detail(runDto({ status: "RUNNING", summary: { sessions: 10, requirements: 2 } }), null) });
    const first = renderWithProviders(<GeneratorRunScreen id={RUN} />);
    expect(await screen.findByText(/Calcul en cours… Cette page se met à jour toute seule/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Examiner et appliquer" })).toBeNull();
    first.unmount();

    setTestApi({ ...accessRoutes(["schedule.read", "schedule.manage"]), ...detail(runDto({ status: "FAILED", errorCode: "scheduling.not_found", errorMessage: "Classe introuvable.", summary: null }), null) });
    const second = renderWithProviders(<GeneratorRunScreen id={RUN} />);
    expect(await screen.findByText(/Le calcul n'a pas abouti\./)).toBeTruthy();
    expect(screen.getByText(/Classe introuvable\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Examiner et appliquer" })).toBeNull();
    second.unmount();

    setTestApi({ ...accessRoutes(["schedule.read"]), ...detail(runDto({ status: "COMPLETED" })) });
    renderWithProviders(<GeneratorRunScreen id={RUN} />);
    expect(await screen.findByRole("heading", { name: "Proposition de rentrée" })).toBeTruthy();
    // Lecture seule : ni application, ni abandon, ni relance.
    expect(screen.queryByRole("button", { name: "Examiner et appliquer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Abandonner" })).toBeNull();
  });

  it("relance avec une autre graine (même demande, graine retirée) et abandon motivé", async () => {
    const api = setTestApi({
      ...accessRoutes(["schedule.read", "schedule.manage"]),
      ...detail(),
      [`POST ${S}/autogen/runs`]: () => json({ run: runDto({ id: uuid(7002), status: "QUEUED" }), executed: false }, { status: 202 }),
      [`POST ${S}/autogen/runs/${RUN}/discard`]: () => json(runDto({ status: "DISCARDED", discardedAt: "2026-10-01T09:00:00.000Z" })),
    });
    renderWithProviders(<GeneratorRunScreen id={RUN} />);
    fireEvent.click(await screen.findByRole("button", { name: "Relancer avec une autre graine" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`/v2/schedule/generator/${uuid(7002)}`));
    const post = api.calls.find((c) => c.method === "POST" && c.path === `${S}/autogen/runs`)!;
    expect(post.body).not.toHaveProperty("seed");
    expect(post.body).toMatchObject({ name: "Proposition de rentrée (bis)", validFrom: "2026-09-07" });

    fireEvent.click(screen.getByRole("button", { name: "Abandonner" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Abandonner" }));
    await waitFor(() => expect(api.calls.some((c) => c.path.endsWith("/discard"))).toBe(true));
    expect(await screen.findByText("Proposition abandonnée.")).toBeTruthy();
  });
});
