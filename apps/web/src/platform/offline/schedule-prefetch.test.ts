import { describe, expect, it, vi } from "vitest";
import { createFakeIndexedDb } from "@/platform/test/fake-indexeddb";
import { openOfflineDb } from "./idb";
import { MAX_WINDOWS_PER_OWNER, ScheduleCache, type CachedOccurrence } from "./schedule-cache";
import { canPrefetch, prefetchWindow, type PrefetchWindow } from "./schedule-prefetch";

const CLASS = "00000000-0000-4000-8000-000000000c01";
const occ = (id: string, day: string): CachedOccurrence => ({
  id,
  kind: "COURSE",
  title: "Maths",
  classroomId: CLASS,
  curriculumNodeId: null,
  roomId: null,
  startsAt: `${day}T08:00:00.000Z`,
  endsAt: `${day}T09:00:00.000Z`,
  occursOn: day,
  durationMinutes: 60,
  deliveryMode: "IN_PERSON",
  status: "SCHEDULED",
  needsReplacement: false,
  conflictOverride: false,
  locationLabel: null,
});
const day = (n: number) => new Date(Date.UTC(2026, 9, 5 + n)).toISOString().slice(0, 10);
const win = (weeks: number): PrefetchWindow => ({ from: day(7 * weeks), to: day(7 * weeks + 6), includeCancelled: false });
const ON = { onLine: true, connection: { saveData: false } };

function setup(owner: string | null = "ecole:u1") {
  const fake = createFakeIndexedDb();
  let current = owner;
  const now = new Date("2026-10-05T10:00:00.000Z");
  const cache = openOfflineDb({ factory: fake.factory }).then((db) => new ScheduleCache({ db, owner: () => current, now: () => now }));
  return { cache, setOwner: (o: string | null) => (current = o) };
}
const page = (w: PrefetchWindow) => ({ hasMore: false, items: [occ(`id-${w.from}`, w.from)] });
const labels = { classrooms: { [CLASS]: "6e A" }, rooms: {} };

describe("préchargement de la semaine suivante", () => {
  it("enregistre la semaine suivante (projection minimale, libellés utilisés) pour le propriétaire courant", async () => {
    const { cache } = setup();
    const fetchPage = vi.fn(async (w: PrefetchWindow) => page(w));
    expect(await prefetchWindow({ next: win(1), cache, fetchPage, labels, env: ON })).toBe(true);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    const c = await cache;
    const snap = await c.load(win(1));
    expect(snap?.items).toHaveLength(1);
    expect(snap?.labels.classrooms).toEqual({ [CLASS]: "6e A" });
    expect(snap?.savedAt).toBe("2026-10-05T10:00:00.000Z");
  });

  it("échec silencieux : aucune exception, rien d'enregistré", async () => {
    const { cache } = setup();
    const fetchPage = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(prefetchWindow({ next: win(1), cache, fetchPage, labels, env: ON })).resolves.toBe(false);
    expect(await (await cache).list()).toHaveLength(0);
  });

  it("pas de préchargement hors ligne ni en économie de données (aucune requête émise)", async () => {
    const { cache } = setup();
    const fetchPage = vi.fn(async (w: PrefetchWindow) => page(w));
    expect(await prefetchWindow({ next: win(1), cache, fetchPage, labels, env: { onLine: false, connection: null } })).toBe(false);
    expect(await prefetchWindow({ next: win(1), cache, fetchPage, labels, env: { onLine: true, connection: { saveData: true } } })).toBe(false);
    expect(fetchPage).not.toHaveBeenCalled();
    expect(canPrefetch({ onLine: true, connection: undefined })).toBe(true);
    expect(await (await cache).list()).toHaveLength(0);
  });

  it("sans propriétaire identifié : rien n'est gardé", async () => {
    const { cache } = setup(null);
    expect(await prefetchWindow({ next: win(1), cache, fetchPage: async (w) => page(w), labels, env: ON })).toBe(false);
  });

  it("respecte le plafond de fenêtres par personne (les plus anciennes sont élaguées)", async () => {
    const { cache } = setup();
    for (let w = 0; w < MAX_WINDOWS_PER_OWNER + 3; w++) {
      // même jour d'enregistrement : l'ordre d'écriture départage via la clé ; on avance l'horloge du cache
      await prefetchWindow({ next: win(w % 3), cache, fetchPage: async (x) => page(x), labels, env: ON });
    }
    expect((await (await cache).list()).length).toBeLessThanOrEqual(MAX_WINDOWS_PER_OWNER);
    // fenêtres distinctes au-delà du plafond
    const c = await cache;
    for (let w = 0; w < MAX_WINDOWS_PER_OWNER + 2; w++) {
      await c.save({ ...win(w - 2), hasMore: false, items: [], classrooms: {}, rooms: {} });
    }
    expect((await c.list()).length).toBeLessThanOrEqual(MAX_WINDOWS_PER_OWNER);
  });

  it("isolation : un autre utilisateur ne lit pas la semaine préchargée", async () => {
    const { cache, setOwner } = setup("ecole:u1");
    await prefetchWindow({ next: win(1), cache, fetchPage: async (w) => page(w), labels, env: ON });
    const c = await cache;
    setOwner("ecole:u2");
    expect(await c.load(win(1))).toBeNull();
    expect(await c.list()).toHaveLength(0);
    setOwner("autre:u1");
    expect(await c.load(win(1))).toBeNull();
    setOwner("ecole:u1");
    expect(await c.load(win(1))).not.toBeNull();
  });
});
