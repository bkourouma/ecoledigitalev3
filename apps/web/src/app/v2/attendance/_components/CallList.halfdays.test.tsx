// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { attendanceSyncResultDtoSchema } from "@ecoledigitale/contracts/v2/attendance";
import { openOfflineDb } from "@/platform/offline/idb";
import { OutboxManager } from "@/platform/offline/outbox-manager";
import { OutboxProvider } from "@/platform/offline/OutboxProvider";
import { createFakeIndexedDb } from "@/platform/test/fake-indexeddb";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { renderWithProviders } from "@/platform/test/render";
import { sessionDto, uuid } from "../_test/fixtures";
import { CallListScreen } from "./CallListScreen";

vi.setConfig({ testTimeout: 30_000 });
vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const BASE = "/api/v1/attendance";
const DAY = new Date().toISOString().slice(0, 10); // jour courant : le composant compare les appels au jour réel
const CM2 = uuid(501);
const GS = uuid(502);

const klass = (classroomId: string, classroomName: string, educationLevelCode: string) => ({
  classroomId,
  academicYearId: uuid(100),
  classroomName,
  classroomCode: classroomName,
  educationLevelCode,
  periods: [],
  nodes: [],
  assignments: [{ assignmentId: uuid(900), roleCode: "HOMEROOM", curriculumNodeId: null, nodeLabel: null, coversAllSubjects: true }],
});

const policy = (educationLevelCode: string, callScope: string, dailyCallMode: string) => ({ institutionId: uuid(1), educationLevelCode, callScope, editWindowMinutes: null, lateRequiresMinutes: false, dailyMinutes: null, dailyCallMode });

async function mount(policies: unknown[], sessions: unknown[]) {
  const fake = createFakeIndexedDb();
  const { platformApi } = await import("@/platform/api/default-client");
  const manager = new OutboxManager({
    openDb: () => openOfflineDb({ factory: fake.factory }),
    owner: () => "ecole-test:user-1",
    post: (batch) => platformApi.post(`${BASE}/sync`, batch, { schema: attendanceSyncResultDtoSchema }),
    isOnline: () => true,
    setTimer: () => 1,
    clearTimer: () => undefined,
  });
  setTestApi({
    ...accessRoutes(["attendance.take", "attendance.read", "schedule.own.read"], ["attendance.offline"]),
    "GET /api/v1/people/me/classes": { items: [klass(CM2, "CM2 A", "PRIMARY"), klass(GS, "Grande Section", "PRESCHOOL")] },
    [`GET ${BASE}/reference/call-policies`]: { items: policies },
    "GET /api/v1/scheduling/me/today": { date: DAY, staffId: uuid(4000), items: [] },
    [`GET ${BASE}/sessions`]: { items: sessions, nextCursor: null },
  });
  renderWithProviders(
    <OutboxProvider manager={manager}>
      <CallListScreen />
    </OutboxProvider>,
  );
  await screen.findByText("Appel de la journée");
}

describe("Mes appels : appel du matin et de l'après-midi au primaire (Q-P17)", () => {
  const POLICIES = [policy("PRIMARY", "DAILY", "HALF_DAYS"), policy("PRESCHOOL", "DAILY", "SINGLE"), policy("*", "SESSION", "SINGLE")];

  it("classe de primaire : une ligne par demi-journée avec son état ; classe de maternelle : une seule ligne d'appel du jour", async () => {
    await mount(POLICIES, [sessionDto({ id: uuid(7001), classroomId: CM2, scope: "DAILY", dayPart: "MORNING", occurrenceId: null, status: "SUBMITTED", sessionDate: DAY })]);
    const morning = await screen.findByRole("link", { name: /Appel du matin/ });
    const afternoon = screen.getByRole("link", { name: /Appel de l'après-midi/ });
    expect(morning.getAttribute("href")).toBe(`/v2/attendance/call/daily/${CM2}?date=${DAY}&part=MORNING`);
    expect(afternoon.getAttribute("href")).toBe(`/v2/attendance/call/daily/${CM2}?date=${DAY}&part=AFTERNOON`);
    // Le matin est déjà soumis ; l'après-midi n'a pas encore d'état.
    const rowMorning = morning.closest("li")!;
    expect(within(rowMorning).getByText("Appel soumis")).toBeTruthy();
    expect(within(afternoon.closest("li")!).queryByText("Appel soumis")).toBeNull();
    // Maternelle : appel unique, sans demi-journée dans l'adresse.
    const single = screen.getByRole("link", { name: "Appel du jour" });
    expect(single.getAttribute("href")).toBe(`/v2/attendance/call/daily/${GS}?date=${DAY}`);
  });

  it("politique à appel unique pour tous (non-régression) : aucun lien matin / après-midi", async () => {
    await mount([policy("PRIMARY", "DAILY", "SINGLE"), policy("PRESCHOOL", "DAILY", "SINGLE"), policy("*", "SESSION", "SINGLE")], []);
    await screen.findAllByRole("link", { name: "Appel du jour" });
    expect(screen.queryByRole("link", { name: /Appel du matin/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Appel de l'après-midi/ })).toBeNull();
    expect(screen.getAllByRole("link", { name: "Appel du jour" }).map((a) => a.getAttribute("href"))).toEqual(
      expect.arrayContaining([`/v2/attendance/call/daily/${CM2}?date=${DAY}`, `/v2/attendance/call/daily/${GS}?date=${DAY}`]),
    );
  });
});
