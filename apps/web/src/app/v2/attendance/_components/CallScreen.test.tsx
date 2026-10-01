// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attendanceSyncResultDtoSchema, type AttendanceSyncBatch } from "@ecoledigitale/contracts/v2/attendance";
import { OFFLINE_DB_NAME, openOfflineDb } from "@/platform/offline/idb";
import { OutboxManager } from "@/platform/offline/outbox-manager";
import { OutboxProvider } from "@/platform/offline/OutboxProvider";
import { createFakeIndexedDb } from "@/platform/test/fake-indexeddb";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { IDS, recordDto, sessionDetail, sessionDto, STUDENTS, syncAnswer, uuid } from "../_test/fixtures";
import { CallScreen } from "./CallScreen";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const BASE = "/api/v1/attendance";

/** `navigator.onLine` pilote aussi react-query (requêtes suspendues hors ligne) : toujours explicite dans les tests. */
function setOnline(online: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(online);
  // react-query garde son propre état réseau (singleton) : on le synchronise explicitement, puis on émet les événements.
  onlineManager.setOnline(online);
  act(() => {
    window.dispatchEvent(new Event(online ? "online" : "offline"));
  });
}

beforeEach(() => setOnline(true));
afterEach(() => {
  vi.restoreAllMocks();
});

async function makeManager(fake = createFakeIndexedDb()) {
  const { platformApi } = await import("@/platform/api/default-client");
  const manager = new OutboxManager({
    openDb: () => openOfflineDb({ factory: fake.factory }),
    owner: () => "ecole-test:user-1",
    post: (batch) => platformApi.post(`${BASE}/sync`, batch, { schema: attendanceSyncResultDtoSchema }),
    isOnline: () => navigator.onLine,
    setTimer: () => 1,
    clearTimer: () => undefined,
  });
  return { manager, fake };
}

interface Opts {
  features?: string[];
  detail?: ReturnType<typeof sessionDetail>;
  decide?: Parameters<typeof syncAnswer>[1];
  permissions?: string[];
  sessionStatus?: number;
}

function routes(opts: Opts = {}) {
  const sent: AttendanceSyncBatch[] = [];
  const detail = opts.detail ?? sessionDetail();
  return {
    sent,
    routes: {
      ...accessRoutes(opts.permissions ?? ["attendance.take"], opts.features ?? ["attendance.offline"]),
      [`POST ${BASE}/sessions`]: () => json({ session: detail.session, created: false }),
      [`GET ${BASE}/sessions/${IDS.session}`]: detail,
      // Un enseignant sans `attendance.read` ne peut pas lire les définitions : repli sur les statuts système.
      [`GET ${BASE}/reference/status-definitions`]: () => json({ code: "FORBIDDEN", message: "Interdit" }, { status: 403 }),
      [`POST ${BASE}/sync`]: ({ body }: { body: unknown }) => {
        const batch = body as AttendanceSyncBatch;
        sent.push(batch);
        return json(syncAnswer(batch, opts.decide));
      },
    },
  };
}

async function mount(opts: Opts = {}, manager?: OutboxManager) {
  const made = manager ? { manager } : await makeManager();
  const r = routes(opts);
  const api = setTestApi(r.routes);
  const view = renderWithProviders(
    <OutboxProvider manager={made.manager}>
      <CallScreen kind="occurrence" id={IDS.occurrence} date="2026-10-01" />
    </OutboxProvider>,
  );
  await screen.findByText("KOUASSI Awa");
  return { ...view, ...made, api, sent: r.sent };
}

const toggleOf = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name} :`) });

describe("CallScreen : l'appel en deux gestes", () => {
  it("tout le monde est présent par défaut ; une exception, une soumission : un seul lot envoyé avec clés d'idempotence", async () => {
    const { sent, api } = await mount();
    expect(screen.getAllByText("Présent").length).toBe(3);
    expect(toggleOf("TRAORE Moussa").getAttribute("aria-label")).toContain("Présent");

    fireEvent.click(toggleOf("TRAORE Moussa"));
    await waitFor(() => expect(within(toggleOf("TRAORE Moussa")).getByText("Absent")).toBeTruthy());
    expect(await screen.findByText("En attente d'envoi")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Soumettre l'appel" }));
    expect(await screen.findByText("Appel soumis.")).toBeTruthy();

    expect(sent).toHaveLength(1);
    const session = sent[0]!.sessions[0]!;
    expect(session.target).toEqual({ occurrenceId: IDS.occurrence });
    expect(session.records).toHaveLength(1);
    expect(session.records[0]).toMatchObject({ studentId: STUDENTS[1]!.id, statusCode: "ABSENT" });
    expect(session.records[0]!.clientId).toMatch(/^[0-9a-f-]{36}$/);
    expect(session.clientId).toMatch(/^[0-9a-f-]{36}$/);
    expect(session.submit).toEqual({ defaultStatus: "PRESENT" });
    // L'ouverture de la séance passe par l'API typée, jamais par un calcul local.
    expect(api.calls.find((c) => c.method === "POST" && c.path === `${BASE}/sessions`)!.body).toEqual({ occurrenceId: IDS.occurrence });
  });

  it("autre statut : retard avec minutes, validé côté formulaire avant envoi", async () => {
    const { sent } = await mount();
    fireEvent.click(screen.getByRole("button", { name: "Autre statut pour DIALLO Fanta" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText("En retard"));
    fireEvent.change(within(dialog).getByLabelText(/Minutes de retard/), { target: { value: "0" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Appliquer" }));
    expect(await within(dialog).findByText(/nombre entier de minutes/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Minutes de retard/), { target: { value: "12" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Appliquer" }));
    expect(await screen.findByText("En retard 12 min")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Soumettre l'appel" }));
    await screen.findByText("Appel soumis.");
    expect(sent[0]!.sessions[0]!.records[0]).toMatchObject({ studentId: STUDENTS[2]!.id, statusCode: "LATE", minutesLate: 12 });
  });

  it("HORS LIGNE : la saisie reste sur l'appareil (identifiants seulement), rien n'est envoyé ; à la reconnexion le lot part et l'état passe à « synchronisé »", async () => {
    const { sent, fake } = await mount();
    setOnline(false);
    expect(await screen.findByText(/Hors ligne : vous pouvez continuer/)).toBeTruthy();

    fireEvent.click(toggleOf("TRAORE Moussa"));
    fireEvent.click(toggleOf("DIALLO Fanta"));
    fireEvent.click(screen.getByRole("button", { name: "Soumettre l'appel" }));
    expect(await screen.findByText(/Appel enregistré sur cet appareil\. Il sera envoyé automatiquement/)).toBeTruthy();
    expect(sent).toHaveLength(0);
    expect(await screen.findByText(/Hors ligne : 2 pointages gardés sur cet appareil/)).toBeTruthy();

    // Rien de nominatif n'a été écrit sur l'appareil.
    const stored = JSON.stringify(fake.dump(OFFLINE_DB_NAME, "attendance_calls"));
    expect(stored).not.toMatch(/TRAORE|DIALLO|KOUASSI/);
    expect(stored).toContain(STUDENTS[1]!.id);

    // Retour du réseau : un lot unique, rejouable.
    setOnline(true);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.sessions[0]!.records.map((r) => r.studentId).sort()).toEqual([STUDENTS[1]!.id, STUDENTS[2]!.id]);
    expect(sent[0]!.sessions[0]!.submit).toEqual({ defaultStatus: "PRESENT" });
    expect(await screen.findByText(/En ligne : synchronisé/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("En attente d'envoi")).toBeNull());
  });

  it("CONFLIT renvoyé par l'API : le pointage non appliqué est nommé, signalé à la direction, jamais perdu en silence", async () => {
    const { sent } = await mount({ permissions: ["attendance.take", "attendance.manage"], decide: (r) => (r.studentId === STUDENTS[1]!.id ? "CONFLICT" : "APPLIED") });
    fireEvent.click(toggleOf("TRAORE Moussa"));
    fireEvent.click(toggleOf("DIALLO Fanta"));
    fireEvent.click(screen.getByRole("button", { name: "Soumettre l'appel" }));
    const banner = await screen.findByTestId("call-outcome");
    expect(sent).toHaveLength(1);
    expect(within(banner).getByText("1 pointage n'a pas été appliqué")).toBeTruthy();
    expect(within(banner).getByText("TRAORE Moussa")).toBeTruthy();
    expect(within(banner).getByRole("link", { name: "Ouvrir les conflits à arbitrer" }).getAttribute("href")).toBe("/v2/attendance/conflicts");
    fireEvent.click(within(banner).getByRole("button", { name: "Compris" }));
    await waitFor(() => expect(screen.queryByTestId("call-outcome")).toBeNull());
  });

  it("séance rejetée (annulée) : message explicite, pointages conservés, nouvelle tentative et abandon proposés", async () => {
    const { sent } = await mount({ decide: () => "REJECTED" });
    // Remplace la route par un rejet de séance.
    setTestApi({
      ...routes().routes,
      [`POST ${BASE}/sync`]: ({ body }: { body: unknown }) => {
        const batch = body as AttendanceSyncBatch;
        sent.push(batch);
        return json(syncAnswer(batch, () => "REJECTED", { outcome: "REJECTED", sessionId: null, sessionStatus: null, errorCode: "attendance.occurrence_cancelled" }));
      },
    });
    fireEvent.click(toggleOf("TRAORE Moussa"));
    fireEvent.click(screen.getByRole("button", { name: "Soumettre l'appel" }));
    const banner = await screen.findByTestId("call-outcome");
    expect(within(banner).getByText("Cette séance a été annulée : l'appel ne peut plus être enregistré.")).toBeTruthy();
    expect(within(banner).getByText("Vos pointages sont conservés sur cet appareil.")).toBeTruthy();
    expect(within(banner).getByRole("button", { name: "Réessayer l'envoi" })).toBeTruthy();
    fireEvent.click(within(banner).getByRole("button", { name: "Abandonner cet appel local" }));
    await waitFor(() => expect(screen.queryByTestId("call-outcome")).toBeNull());
  });

  it("RECHARGEMENT : les pointages gardés sur l'appareil survivent et partent d'eux-mêmes dès que la page se rouvre en ligne (mêmes clés, sans doublon)", async () => {
    const first = await makeManager();
    const view = await mount({}, first.manager);
    setOnline(false);
    fireEvent.click(toggleOf("TRAORE Moussa"));
    await screen.findByText("En attente d'envoi");
    const stored = first.fake.dump(OFFLINE_DB_NAME, "attendance_calls") as Array<{ records: Record<string, { clientId: string }> }>;
    const clientId = stored[0]!.records[STUDENTS[1]!.id]!.clientId;
    view.unmount();

    // « Rechargement » : nouveau gestionnaire, même base locale ; la page se rouvre en ligne.
    setOnline(true);
    const second = await makeManager(first.fake);
    const { sent } = await mount({}, second.manager);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.sessions[0]!.records).toEqual([expect.objectContaining({ studentId: STUDENTS[1]!.id, statusCode: "ABSENT", clientId })]);
    await waitFor(() => expect(second.manager.getSnapshot().pending.records).toBe(0));
  });

  it("sans la fonction hors ligne : enregistrement direct (PUT des exceptions puis soumission « tous présents »)", async () => {
    const { api } = await mount({ features: [] });
    // Le mode est connu quand les droits sont chargés : reconstruit les routes complètes.
    setTestApi({
      ...routes({ features: [] }).routes,
      [`PUT ${BASE}/sessions/${IDS.session}/records`]: () => json({ session: sessionDto(), created: 1, updated: 0, unchanged: 0, records: [recordDto(STUDENTS[1]!.id, "ABSENT")] }),
      [`POST ${BASE}/sessions/${IDS.session}/submit`]: () => json({ session: sessionDto({ status: "SUBMITTED" }), alreadySubmitted: false, filledByDefault: 2, absentCount: 1, lateCount: 0 }),
    });
    void api;
    fireEvent.click(toggleOf("TRAORE Moussa"));
    fireEvent.click(screen.getByRole("button", { name: "Soumettre l'appel" }));
    expect(await screen.findByText("Appel soumis : 1 absent, aucun retard.")).toBeTruthy();
  });

  it("appel verrouillé : aucune saisie possible et la raison est affichée", async () => {
    await mount({ detail: sessionDetail({ session: { status: "VALIDATED" }, editable: false }) });
    expect(screen.getByText(/Cet appel est validé/)).toBeTruthy();
    expect((toggleOf("TRAORE Moussa") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Enregistrer les corrections/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("ouverture impossible hors ligne : explication claire et reprise possible, sans écran vide", async () => {
    const { manager } = await makeManager();
    setTestApi({
      ...routes().routes,
      [`POST ${BASE}/sessions`]: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    renderWithProviders(
      <OutboxProvider manager={manager}>
        <CallScreen kind="occurrence" id={IDS.occurrence} date="2026-10-01" />
      </OutboxProvider>,
    );
    expect(await screen.findByText(/la liste de la classe ne peut pas être chargée/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeTruthy();
    expect(screen.getByTestId("offline-indicator")).toBeTruthy();
  });
});

void uuid;
