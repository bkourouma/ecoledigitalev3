// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeIndexedDb, type FakeIndexedDb } from "@/platform/test/fake-indexeddb";
import { OfflineSchedulePanel, type OfflineScheduleLabels } from "./OfflineSchedulePanel";
import { openOfflineDb } from "./idb";
import { ScheduleCache, type CachedOccurrence } from "./schedule-cache";

const holder = vi.hoisted(() => ({ cache: null as Promise<unknown> | null }));
vi.mock("./browser-schedule-cache", () => ({ browserScheduleCache: () => holder.cache }));

const labels: OfflineScheduleLabels = {
  title: "Mon emploi du temps (copie hors ligne)",
  savedAt: "Copie en lecture seule enregistrée le {time}.",
  stale: "Cette copie date de plus de 24 h",
  period: "Période enregistrée",
  empty: "Aucune séance dans cette période.",
  cancelled: "Annulée",
  truncated: "Copie incomplète",
};

const occ = (id: string, over: Partial<CachedOccurrence> = {}): CachedOccurrence => ({
  id,
  kind: "LESSON",
  title: "Mathématiques",
  classroomId: "c1",
  curriculumNodeId: null,
  roomId: "r1",
  startsAt: "2026-10-05T08:00:00.000Z",
  endsAt: "2026-10-05T09:00:00.000Z",
  occursOn: "2026-10-05",
  durationMinutes: 60,
  deliveryMode: "IN_PERSON",
  status: "PLANNED",
  needsReplacement: false,
  conflictOverride: false,
  locationLabel: null,
  ...over,
});

let fake: FakeIndexedDb;
let owner: string | null;
function setCache() {
  holder.cache = openOfflineDb({ factory: fake.factory }).then((db) => new ScheduleCache({ db, owner: () => owner, now: () => new Date() }));
}

beforeEach(() => {
  fake = createFakeIndexedDb();
  owner = "ecole:user-1";
  setCache();
});
afterEach(() => {
  holder.cache = null;
});

describe("page /offline : copie de l'emploi du temps", () => {
  it("affiche la copie de la personne connectée, en lecture seule, avec les libellés enregistrés", async () => {
    const cache = (await holder.cache) as ScheduleCache;
    await cache.save({ from: "2026-10-05", to: "2026-10-11", includeCancelled: false, hasMore: false, items: [occ("s1"), occ("s2", { title: "Sport", status: "CANCELLED", startsAt: "2026-10-05T10:00:00.000Z", endsAt: "2026-10-05T11:00:00.000Z" })], classrooms: { c1: "6e A" }, rooms: { r1: "Salle 3" } });
    render(<OfflineSchedulePanel labels={labels} />);
    const section = await screen.findByTestId("offline-schedule");
    expect(section.textContent).toContain("Mon emploi du temps (copie hors ligne)");
    expect(section.textContent).toContain("Mathématiques");
    expect(section.textContent).toContain("6e A · Salle 3");
    expect(section.textContent).toContain("Annulée");
    expect(section.textContent).toMatch(/enregistrée le .*2026/);
    expect(screen.queryByRole("combobox")).toBeNull(); // une seule période : pas de sélecteur
  });

  it("n'affiche rien sans copie, et rien pour une autre identité", async () => {
    const cache = (await holder.cache) as ScheduleCache;
    await cache.save({ from: "2026-10-05", to: "2026-10-11", includeCancelled: false, hasMore: false, items: [occ("s1")], classrooms: {}, rooms: {} });
    owner = "ecole:user-2";
    setCache();
    render(<OfflineSchedulePanel labels={labels} />);
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByTestId("offline-schedule")).toBeNull();
    owner = null;
    setCache();
    render(<OfflineSchedulePanel labels={labels} />);
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByTestId("offline-schedule")).toBeNull();
  });

  it("plusieurs périodes : sélecteur étiqueté ; une copie ancienne est signalée", async () => {
    const old = new ScheduleCache({ db: await openOfflineDb({ factory: fake.factory }), owner: () => owner, now: () => new Date(Date.now() - 3 * 86_400_000) });
    await old.save({ from: "2026-09-28", to: "2026-10-04", includeCancelled: false, hasMore: false, items: [occ("s0", { occursOn: "2026-09-29", title: "Histoire" })], classrooms: {}, rooms: {} });
    await old.save({ from: "2026-10-05", to: "2026-10-11", includeCancelled: false, hasMore: true, items: [occ("s1")], classrooms: {}, rooms: {} });
    render(<OfflineSchedulePanel labels={labels} />);
    await screen.findByTestId("offline-schedule");
    const select = await screen.findByLabelText("Période enregistrée");
    expect((select as HTMLSelectElement).options).toHaveLength(2);
    await waitFor(() => expect(screen.getByTestId("offline-schedule").textContent).toContain("plus de 24 h"));
    const second = Array.from((select as HTMLSelectElement).options).find((o) => o.text.includes("2026-10-05"))!;
    fireEvent.change(select, { target: { value: second.value } });
    await waitFor(() => expect(screen.getByTestId("offline-schedule").textContent).toContain("Copie incomplète"));
  });
});
