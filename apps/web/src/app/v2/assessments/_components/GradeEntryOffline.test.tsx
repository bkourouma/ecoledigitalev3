// @vitest-environment jsdom
import { onlineManager } from "@tanstack/react-query";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { createFakeIndexedDb, type FakeIndexedDb } from "@/platform/test/fake-indexeddb";
import { json, renderWithProviders } from "@/platform/test/render";
import { GradeSyncProvider, gradeSyncApi } from "@/platform/offline/GradeSyncProvider";
import { GradeSyncManager } from "@/platform/offline/grade-sync-manager";
import { openOfflineDb, OFFLINE_DB_NAME } from "@/platform/offline/idb";
import { classroom } from "../../_test/fixtures";
import { assessment, assessmentType, grade, SETTINGS, STUDENTS, uuid } from "../_test/fixtures";
import { GradeEntryScreen } from "./GradeEntry";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.setConfig({ testTimeout: 30_000 });

const SHEET_PATH = `GET /api/v1/assess/assessments/${uuid(800)}/grades`;
const PUT_PATH = `PUT /api/v1/assess/assessments/${uuid(800)}/grades`;

let fake: FakeIndexedDb;
let serverGrade: Record<string, unknown>;
let sheetStatus: string;
let putHandler: (body: { entries: Array<Record<string, unknown>> }, n: number) => Response;
let puts = 0;

function routes() {
  return {
    ...accessRoutes(["grade.enter", "grade.read", "assessment.read"]),
    [SHEET_PATH]: () => json({ assessment: assessment({ status: sheetStatus }), grades: [serverGrade, grade(2)], pending: [{ enrollmentId: uuid(2003), studentId: uuid(3003) }] }),
    [PUT_PATH]: ({ body }: { body: unknown }) => {
      puts += 1;
      return putHandler(body as { entries: Array<Record<string, unknown>> }, puts);
    },
    "GET /api/v1/people/students": STUDENTS,
    "GET /api/v1/assess/settings": SETTINGS,
    "GET /api/v1/assess/assessment-types": { items: [assessmentType()] },
    [`GET /api/v1/academic/classrooms/${uuid(500)}`]: classroom(),
    [`GET /api/v1/academic/classrooms/${uuid(500)}/offerings`]: { items: [] },
    [`GET /api/v1/assess/classrooms/${uuid(500)}/periods/${uuid(200)}/lock`]: { lock: null },
  };
}

const saved = (n: number, over: Record<string, unknown> = {}) => grade(n, { rowVersion: 2, ...over });
const ok = (grades: Array<Record<string, unknown>>) => json({ assessmentId: uuid(800), created: 0, updated: grades.length, unchanged: 0, replayed: false, grades });

function net(online: boolean, query = online) {
  Object.defineProperty(navigator, "onLine", { value: online, configurable: true });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
  onlineManager.setOnline(query);
}

function makeManager(owner = "ecole:user-1") {
  return new GradeSyncManager({
    ...gradeSyncApi(),
    openDb: () => openOfflineDb({ factory: fake.factory }),
    owner: () => owner,
    canSync: () => true,
    isOnline: () => navigator.onLine,
    retryBaseMs: 20,
  });
}

function renderScreen(manager: GradeSyncManager) {
  return renderWithProviders(
    <GradeSyncProvider manager={manager}>
      <GradeEntryScreen assessmentId={uuid(800)} />
    </GradeSyncProvider>,
  );
}

const cell = (name: string) => screen.getByLabelText(`Note de ${name}`) as HTMLInputElement;
const indicator = () => screen.getByTestId("grade-sync-indicator");
const drafts = () => fake.dump(OFFLINE_DB_NAME, "grade_drafts");

beforeEach(() => {
  fake = createFakeIndexedDb();
  serverGrade = grade(1, { score: "12", entryStatus: "ENTERED", rowVersion: 1 });
  sheetStatus = "DRAFT";
  puts = 0;
  putHandler = () => ok([saved(1, { score: "15", entryStatus: "ENTERED" })]);
  net(true);
});

afterEach(() => {
  net(true);
});

describe("grille de notes hors ligne", () => {
  it("coupure pendant la saisie : saisie gardée sur l'appareil, restituée au rechargement, puis envoyée en lot idempotent", async () => {
    const api = setTestApi(routes());
    const first = renderScreen(makeManager());
    await screen.findByLabelText("Note de Aka Marie");
    net(false, true); // plus de réseau, mais la page est déjà chargée
    fireEvent.change(cell("Aka Marie"), { target: { value: "15" } });
    await waitFor(() => expect(drafts()).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(indicator().getAttribute("data-kind")).toBe("offline"));
    expect(indicator().textContent).toContain("1 note gardée sur cet appareil");
    expect(screen.getByTestId("save-indicator").textContent).toContain("saisies gardées sur cet appareil");
    expect(api.calls.some((c) => c.method === "PUT")).toBe(false);

    // la page est fermée puis rouverte (le réseau est de retour pour charger la feuille, mais l'envoi attend)
    first.unmount();
    renderScreen(makeManager());
    await screen.findByLabelText("Note de Aka Marie");
    await screen.findByText(/1 saisie hors ligne restaurée/);
    expect(cell("Aka Marie").value).toBe("15");
    expect(api.calls.some((c) => c.method === "PUT")).toBe(false);

    // retour du réseau : l'envoi part tout seul avec la clé d'idempotence et la version de ligne lue
    net(true);
    await waitFor(() => expect(indicator().getAttribute("data-kind")).toBe("synced"));
    const put = api.calls.find((c) => c.method === "PUT")!;
    expect(put.headers["idempotency-key"]).toMatch(/.{8,}/);
    expect(put.body).toEqual({ entries: [{ enrollmentId: uuid(2001), entryStatus: "ENTERED", score: "15", comment: null, rowVersion: 1 }] });
    expect(indicator().textContent).toContain("Notes synchronisées");
    expect(drafts()).toHaveLength(0);
  });

  it("l'indicateur est une zone vivante (role=status, aria-live=polite) qui nomme l'état", async () => {
    setTestApi(routes());
    renderScreen(makeManager());
    await screen.findByLabelText("Note de Aka Marie");
    const live = indicator();
    expect(live.getAttribute("role")).toBe("status");
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.getAttribute("aria-label")).toBe("Synchronisation des notes");
    fireEvent.change(cell("Aka Marie"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(indicator().getAttribute("data-kind")).toBe("synced"));
    expect(screen.getByTestId("save-indicator").textContent).toContain("Enregistré à");
  });

  it("conflit (409 rowVersion) : les deux valeurs sont montrées, rien n'est renvoyé ni écrasé avant le choix", async () => {
    const api = setTestApi(routes());
    putHandler = (_b, n) => {
      if (n === 1) {
        // quelqu'un d'autre a mis 5 entre-temps
        serverGrade = grade(1, { score: "5", entryStatus: "ENTERED", rowVersion: 2 });
        return json({ code: "assess.stale_grade", message: "périmée", details: { enrollmentIds: [uuid(2001)] } }, { status: 409 });
      }
      return ok([saved(1, { score: "15", entryStatus: "ENTERED", rowVersion: 3 })]);
    };
    renderScreen(makeManager());
    await screen.findByLabelText("Note de Aka Marie");
    fireEvent.change(cell("Aka Marie"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    const panel = await screen.findByTestId("grade-conflicts");
    expect(indicator().getAttribute("data-kind")).toBe("conflict");
    expect(within(panel).getByText("15")).toBeTruthy(); // ma saisie
    expect(within(panel).getByText("5")).toBeTruthy(); // la valeur du serveur
    // la grille montre la valeur du serveur : ma saisie est en lieu sûr, elle ne sera pas renvoyée seule
    await waitFor(() => expect(cell("Aka Marie").value).toBe("5"));
    expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(1);
    fireEvent.click(within(panel).getByRole("button", { name: "Voir les deux valeurs pour Aka Marie" }));
    expect(within(panel).getByText(/version 2/)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 400)); // rien ne repart tout seul (persistance, battement…)
    expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(1);

    // « Garder la mienne » : renvoyée explicitement sur la version courante (2) du serveur
    fireEvent.click(within(panel).getByRole("button", { name: "Garder ma saisie pour Aka Marie" }));
    await waitFor(() => expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(2));
    expect((api.calls.filter((c) => c.method === "PUT")[1]!.body as { entries: Array<{ rowVersion: number; score: string }> }).entries[0]).toMatchObject({ rowVersion: 2, score: "15" });
    await waitFor(() => expect(screen.queryByTestId("grade-conflicts")).toBeNull());
    await waitFor(() => expect(indicator().getAttribute("data-kind")).toBe("synced"));
    expect(cell("Aka Marie").value).toBe("15");
  });

  it("conflit : « Prendre celle du serveur » abandonne ma saisie sans aucun nouvel envoi", async () => {
    const api = setTestApi(routes());
    putHandler = () => {
      serverGrade = grade(1, { score: "5", entryStatus: "ENTERED", rowVersion: 2 });
      return json({ code: "assess.stale_grade", message: "périmée", details: { enrollmentIds: [uuid(2001)] } }, { status: 409 });
    };
    renderScreen(makeManager());
    await screen.findByLabelText("Note de Aka Marie");
    fireEvent.change(cell("Aka Marie"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    const panel = await screen.findByTestId("grade-conflicts");
    fireEvent.click(within(panel).getByRole("button", { name: "Prendre la valeur du serveur pour Aka Marie" }));
    await waitFor(() => expect(screen.queryByTestId("grade-conflicts")).toBeNull());
    expect(cell("Aka Marie").value).toBe("5");
    await waitFor(() => expect(drafts()).toHaveLength(0));
    expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(1);
  });

  it("conflit détecté à la réouverture (version changée pendant l'absence) : arbitrage proposé, grille à la valeur du serveur", async () => {
    setTestApi(routes());
    const first = renderScreen(makeManager());
    await screen.findByLabelText("Note de Aka Marie");
    net(false, true);
    fireEvent.change(cell("Aka Marie"), { target: { value: "15" } });
    await waitFor(() => expect(drafts()).toHaveLength(1));
    first.unmount();
    serverGrade = grade(1, { score: "5", entryStatus: "ENTERED", rowVersion: 2 });
    setTestApi(routes());
    renderScreen(makeManager());
    const panel = await screen.findByTestId("grade-conflicts");
    expect(within(panel).getByRole("button", { name: "Garder ma saisie pour Aka Marie" })).toBeTruthy();
    expect(cell("Aka Marie").value).toBe("5");
    expect(screen.queryByText(/saisie hors ligne restaurée/)).toBeNull();
  });

  it("évaluation clôturée/validée : l'envoi est refusé, les saisies sont conservées et verrouillées, sans nouvel essai", async () => {
    const api = setTestApi(routes());
    putHandler = () => json({ code: "assess.grade_frozen", message: "figée" }, { status: 409 });
    renderScreen(makeManager());
    await screen.findByLabelText("Note de Aka Marie");
    fireEvent.change(cell("Aka Marie"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(indicator().getAttribute("data-kind")).toBe("locked"));
    expect(indicator().textContent).toContain("Évaluation figée ou période verrouillée");
    expect(drafts()).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 300));
    expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(1);
  });

  it("feuille plus en brouillon à la réouverture : saisies hors ligne verrouillées, grille en lecture seule", async () => {
    setTestApi(routes());
    const first = renderScreen(makeManager());
    await screen.findByLabelText("Note de Aka Marie");
    net(false, true);
    fireEvent.change(cell("Aka Marie"), { target: { value: "15" } });
    await waitFor(() => expect(drafts()).toHaveLength(1));
    first.unmount();
    sheetStatus = "APPROVED";
    setTestApi(routes());
    renderScreen(makeManager());
    await screen.findByLabelText("Note de Aka Marie");
    await waitFor(() => expect(indicator().getAttribute("data-kind")).toBe("locked"));
    expect(cell("Aka Marie").readOnly).toBe(true);
    expect(cell("Aka Marie").value).toBe("12");
  });

  it("session expirée pendant l'envoi : brouillon conservé, message explicite, reprise sous la même identité seulement", async () => {
    const api = setTestApi(routes());
    let expired = true;
    putHandler = () => (expired ? json({ code: "UNAUTHORIZED", message: "expirée" }, { status: 401 }) : ok([saved(1, { score: "15", entryStatus: "ENTERED" })]));
    const manager = makeManager();
    renderScreen(manager);
    await screen.findByLabelText("Note de Aka Marie");
    fireEvent.change(cell("Aka Marie"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(indicator().getAttribute("data-kind")).toBe("auth"));
    expect(indicator().textContent).toContain("Session expirée");
    expect(drafts()).toHaveLength(1);
    expect(cell("Aka Marie").value).toBe("15");

    // une AUTRE identité sur le même appareil ne voit ni n'envoie ce brouillon
    const stranger = makeManager("ecole:user-2");
    await stranger.init();
    expect(stranger.getSnapshot().drafts).toEqual([]);
    await stranger.syncNow();
    expect(api.calls.filter((c) => c.method === "PUT")).toHaveLength(1);

    // reconnexion de la même identité : même clé, même contenu
    expired = false;
    manager.notifySessionRenewed();
    await waitFor(() => expect(indicator().getAttribute("data-kind")).toBe("synced"));
    const [a, b] = api.calls.filter((c) => c.method === "PUT");
    expect(b!.headers["idempotency-key"]).toBe(a!.headers["idempotency-key"]);
    expect(b!.body).toEqual(a!.body);
  });
});
