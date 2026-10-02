// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { createFakeIndexedDb, type FakeIndexedDb } from "@/platform/test/fake-indexeddb";
import { renderWithProviders } from "@/platform/test/render";
import { openOfflineDb, OFFLINE_DB_NAME } from "@/platform/offline/idb";
import { ScheduleCache } from "@/platform/offline/schedule-cache";
import { IDS, occurrence, page } from "../_test/fixtures";
import { TimetableScreen } from "./TimetableScreen";

vi.setConfig({ testTimeout: 30_000 });
vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
const holder = vi.hoisted(() => ({ cache: null as Promise<unknown> | null }));
vi.mock("@/platform/offline/browser-schedule-cache", () => ({ browserScheduleCache: () => holder.cache }));

const S = "/api/v1/scheduling";
let fake: FakeIndexedDb;
let owner: string | null;
let cacheNow: Date;

function useCache() {
  holder.cache = openOfflineDb({ factory: fake.factory }).then((db) => new ScheduleCache({ db, owner: () => owner, now: () => cacheNow }));
}

const ownRoutes = (mine: unknown) => ({
  ...accessRoutes(["schedule.own.read"]),
  [`GET ${S}/me/timetable`]: mine,
});
const week = (over: Record<string, unknown> = {}) => ({
  ...page([
    occurrence({ id: "00000000-0000-4000-8000-000000009001", title: "Mathématiques", notes: "Prévenir les parents d'Awa", cancelReason: null }),
    occurrence({ id: "00000000-0000-4000-8000-000000009002", title: "Sport", status: "CANCELLED", cancelReason: "Maladie de M. Koné", startsAt: "2026-10-01T12:00:00.000Z", endsAt: "2026-10-01T13:00:00.000Z" }),
  ]),
  subject: "STAFF",
  subjectId: IDS.staff,
  ...over,
});
const down = () => {
  throw new TypeError("Failed to fetch");
};

beforeEach(() => {
  fake = createFakeIndexedDb();
  owner = "ecole:user-1";
  cacheNow = new Date("2026-10-01T09:30:00.000Z");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-01T10:00:00.000Z"));
  useCache();
});
afterEach(() => {
  vi.useRealTimers();
  holder.cache = null;
});

describe("emploi du temps personnel hors ligne", () => {
  it("en ligne, la semaine affichée est enregistrée sur l'appareil (copie minimale) ; réseau coupé, elle se relit en lecture seule avec sa fraîcheur", async () => {
    setTestApi(ownRoutes(() => new Response(JSON.stringify(week()), { status: 200, headers: { "content-type": "application/json" } })));
    const first = renderWithProviders(<TimetableScreen />);
    expect(await screen.findAllByText("Mathématiques")).not.toHaveLength(0);
    await waitFor(() => expect(fake.dump(OFFLINE_DB_NAME, "schedule_cache")).toHaveLength(1));
    // ni les notes, ni le motif d'annulation (données potentiellement personnelles) ne sont gardés
    const raw = JSON.stringify(fake.dump(OFFLINE_DB_NAME, "schedule_cache"));
    expect(raw).not.toContain("Awa");
    expect(raw).not.toContain("Koné");
    expect(screen.queryByTestId("offline-copy-notice")).toBeNull();
    first.unmount();

    // le réseau est tombé : la même semaine se lit depuis la copie
    setTestApi(ownRoutes(down));
    renderWithProviders(<TimetableScreen />);
    const notice = await screen.findByTestId("offline-copy-notice");
    expect(notice.textContent).toContain("Hors ligne : vous consultez la copie de votre emploi du temps enregistrée il y a 30 minutes");
    expect(notice.textContent).toContain("Lecture seule");
    expect((await screen.findAllByText("Mathématiques")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sport").length).toBeGreaterThan(0);
    // pas de motif d'annulation sur la copie
    expect(screen.queryByText(/Maladie/)).toBeNull();
    expect(screen.queryByText(/Prévenir/)).toBeNull();
    expect(screen.queryByText(/Choisissez ce que vous voulez consulter/)).toBeNull();
  });

  it("copie ancienne (plus de 24 h) : avertissement explicite", async () => {
    cacheNow = new Date("2026-09-29T08:00:00.000Z");
    setTestApi(ownRoutes(() => new Response(JSON.stringify(week()), { status: 200, headers: { "content-type": "application/json" } })));
    const first = renderWithProviders(<TimetableScreen />);
    await screen.findAllByText("Mathématiques");
    await waitFor(() => expect(fake.dump(OFFLINE_DB_NAME, "schedule_cache")).toHaveLength(1));
    first.unmount();
    setTestApi(ownRoutes(down));
    renderWithProviders(<TimetableScreen />);
    const notice = await screen.findByTestId("offline-copy-notice");
    expect(notice.textContent).toContain("il y a 2 jours");
    expect(notice.textContent).toContain("plus de 24 h");
  });

  it("jamais la copie d'un autre utilisateur : sans copie à soi, un message l'explique", async () => {
    setTestApi(ownRoutes(() => new Response(JSON.stringify(week()), { status: 200, headers: { "content-type": "application/json" } })));
    const first = renderWithProviders(<TimetableScreen />);
    await screen.findAllByText("Mathématiques");
    await waitFor(() => expect(fake.dump(OFFLINE_DB_NAME, "schedule_cache")).toHaveLength(1));
    first.unmount();

    owner = "ecole:user-2";
    useCache();
    setTestApi(ownRoutes(down));
    renderWithProviders(<TimetableScreen />);
    expect(await screen.findByText(/aucune copie de cette période n'est enregistrée sur cet appareil/)).toBeTruthy();
    expect(screen.queryByText("Mathématiques")).toBeNull();
    expect(screen.queryByTestId("offline-copy-notice")).toBeNull();
  });

  it("un autre sujet que « moi » n'est jamais gardé sur l'appareil", async () => {
    setTestApi({
      ...accessRoutes(["schedule.read"]),
      [`GET ${S}/views/classroom/${IDS.classroom}`]: week(),
    });
    renderWithProviders(<TimetableScreen />);
    await screen.findByText("Choisissez ce que vous voulez consulter");
    await new Promise((r) => setTimeout(r, 200));
    expect(fake.dump(OFFLINE_DB_NAME, "schedule_cache")).toHaveLength(0);
  });
});
