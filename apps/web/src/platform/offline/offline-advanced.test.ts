import { describe, expect, it } from "vitest";
import { ApiError, ClientErrorCode } from "@/platform/api/errors";
import { createFakeIndexedDb } from "@/platform/test/fake-indexeddb";
import { DraftLimitError, GradeDrafts, MAX_DRAFT_ASSESSMENTS, MAX_ENTRIES_PER_BATCH, MAX_ENTRIES_PER_DRAFT, type ServerGrade } from "./grade-drafts";
import { GradeSyncManager, type ApiGradeEntry, type AppliedEvent, type GradeSyncDeps, type SaveGradesOutcome } from "./grade-sync-manager";
import { openOfflineDb, OFFLINE_DB_NAME } from "./idb";
import { purgeOfflineData } from "./purge";
import { freshnessOf, MAX_WINDOWS_PER_OWNER, ScheduleCache, type CachedOccurrence } from "./schedule-cache";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A1 = uuid(800);
const A2 = uuid(801);
const E = (n: number) => uuid(2000 + n);

function counter(start = 1) {
  let n = start;
  return () => uuid(n++);
}

const sg = (n: number, over: Partial<ServerGrade> = {}): ServerGrade => ({ enrollmentId: E(n), score: null, entryStatus: "NOT_GRADED", comment: null, rowVersion: 1, ...over });
const entry = (n: number, score: string, baseVersion: number | null = 1, over: Record<string, unknown> = {}) => ({
  enrollmentId: E(n),
  entryStatus: "ENTERED" as const,
  score,
  comment: null,
  baseVersion,
  ...over,
});
const apiErr = (status: number, code: string, details?: unknown) => new ApiError({ code, message: code, status, details });
const netErr = () => new ApiError({ code: ClientErrorCode.NETWORK, message: "network", status: 0 });

/** Faux serveur : applique les lots avec les règles d'idempotence + rowVersion de l'API, pour de vrais scénarios. */
function fakeServer(initial: ServerGrade[] = []) {
  const grades = new Map(initial.map((g) => [g.enrollmentId, { ...g }]));
  const receipts = new Map<string, { payload: string; result: SaveGradesOutcome }>();
  const log: Array<{ assessmentId: string; key: string; entries: ApiGradeEntry[] }> = [];
  const faults: Array<() => Error | null> = [];
  let status = "DRAFT";
  return {
    grades,
    log,
    setStatus: (s: string) => (status = s),
    /** Faute à jouer avant le traitement (consommée une fois). */
    failNext: (f: () => Error) => faults.push(f),
    /** Une autre personne modifie une note côté serveur. */
    externalEdit: (n: number, score: string) => {
      const g = grades.get(E(n)) ?? sg(n, { rowVersion: 0 });
      grades.set(E(n), { ...g, entryStatus: "ENTERED", score, rowVersion: g.rowVersion + 1 });
    },
    put: async (assessmentId: string, entries: ApiGradeEntry[], key: string): Promise<SaveGradesOutcome> => {
      log.push({ assessmentId, key, entries });
      const fault = faults.shift();
      if (fault) throw fault();
      if (status !== "DRAFT") throw apiErr(409, "assess.grade_frozen");
      const payload = JSON.stringify(entries);
      const receipt = receipts.get(key);
      if (receipt) {
        if (receipt.payload !== payload) throw apiErr(409, "assess.idempotency_conflict");
        return { ...receipt.result, replayed: true, grades: receipt.result.grades.map((g) => ({ ...grades.get(g.enrollmentId)! })) };
      }
      const stale = entries.filter((e) => {
        const cur = grades.get(e.enrollmentId);
        const same = cur && e.entryStatus === cur.entryStatus && (e.score ?? null) === cur.score && (e.comment ?? null) === cur.comment;
        if (same) return false;
        return cur ? e.rowVersion !== cur.rowVersion : e.rowVersion !== undefined;
      });
      if (stale.length > 0) throw apiErr(409, "assess.stale_grade", { enrollmentIds: stale.map((s) => s.enrollmentId) });
      const out: ServerGrade[] = [];
      let created = 0;
      let updated = 0;
      for (const e of entries) {
        const cur = grades.get(e.enrollmentId);
        const next: ServerGrade = { enrollmentId: e.enrollmentId, entryStatus: e.entryStatus as ServerGrade["entryStatus"], score: e.score ?? null, comment: e.comment ?? null, rowVersion: (cur?.rowVersion ?? 0) + 1 };
        if (cur) updated += 1;
        else created += 1;
        grades.set(e.enrollmentId, next);
        out.push(next);
      }
      const result: SaveGradesOutcome = { created, updated, unchanged: 0, replayed: false, grades: out };
      receipts.set(key, { payload, result });
      return result;
    },
    fetchSheet: async () => ({ status, grades: [...grades.values()].map((g) => ({ ...g })) }),
  };
}

function setup(options: { owner?: string | null; online?: boolean; server?: ReturnType<typeof fakeServer> } = {}) {
  const fake = createFakeIndexedDb();
  const state = { owner: options.owner === undefined ? ("ecole:user-1" as string | null) : options.owner, online: options.online ?? true, valid: true, now: new Date("2026-10-01T08:00:00.000Z") };
  const server = options.server ?? fakeServer();
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const uuidNext = counter(100);
  const make = (over: Partial<GradeSyncDeps> = {}) =>
    new GradeSyncManager({
      openDb: () => openOfflineDb({ factory: fake.factory }),
      owner: () => state.owner,
      canSync: () => state.valid,
      put: server.put,
      fetchSheet: server.fetchSheet,
      isOnline: () => state.online,
      now: () => state.now,
      uuid: uuidNext,
      setTimer: (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length;
      },
      clearTimer: () => undefined,
      retryBaseMs: 1000,
      ...over,
    });
  const drafts = async () => new GradeDrafts({ db: await openOfflineDb({ factory: fake.factory }), owner: () => state.owner, now: () => state.now, uuid: counter(5000) });
  return { fake, state, server, timers, make, drafts };
}

// ===================================================================================================================
// Copie d'emploi du temps
// ===================================================================================================================

const occ = (n: number, over: Record<string, unknown> = {}): CachedOccurrence & Record<string, unknown> => ({
  id: uuid(n),
  kind: "CLASS",
  title: "Mathématiques",
  classroomId: uuid(500),
  curriculumNodeId: null,
  roomId: uuid(600),
  startsAt: "2026-10-05T08:00:00.000Z",
  endsAt: "2026-10-05T09:00:00.000Z",
  occursOn: "2026-10-05",
  durationMinutes: 60,
  deliveryMode: "IN_PERSON",
  status: "SCHEDULED",
  needsReplacement: false,
  conflictOverride: false,
  locationLabel: null,
  // Champs qui ne doivent JAMAIS être copiés :
  notes: "Parler de l'élève Awa K. à ses parents",
  cancelReason: "Maladie de M. Koné",
  staff: [{ staffId: uuid(9), displayName: "M. Koné" }],
  ...over,
});

const WEEK = { from: "2026-10-05", to: "2026-10-11", includeCancelled: false };

describe("copie hors ligne de l'emploi du temps", () => {
  async function cacheOf(s: ReturnType<typeof setup>, owner: () => string | null = () => s.state.owner) {
    return new ScheduleCache({ db: await openOfflineDb({ factory: s.fake.factory }), owner, now: () => s.state.now });
  }
  const saveWeek = (c: ScheduleCache, items = [occ(1)], window = WEEK) =>
    c.save({ ...window, hasMore: false, items, classrooms: { [uuid(500)]: "6e A", [uuid(501)]: "autre" }, rooms: { [uuid(600)]: "Salle 3" } });

  it("enregistre une projection minimale : ni notes, ni motif d'annulation, ni noms d'autres personnes", async () => {
    const s = setup();
    const cache = await cacheOf(s);
    expect(await saveWeek(cache)).toBe(true);
    const raw = JSON.stringify(s.fake.dump(OFFLINE_DB_NAME, "schedule_cache"));
    expect(raw).not.toContain("Koné");
    expect(raw).not.toContain("Awa");
    expect(raw).not.toContain("cancelReason");
    expect(raw).not.toContain("staff");
    const loaded = await cache.load(WEEK);
    expect(loaded?.items).toHaveLength(1);
    expect(loaded?.items[0]?.title).toBe("Mathématiques");
    // seuls les libellés des classes/salles réellement utilisées sont gardés
    expect(loaded?.labels.classrooms).toEqual({ [uuid(500)]: "6e A" });
    expect(loaded?.labels.rooms).toEqual({ [uuid(600)]: "Salle 3" });
    expect(loaded?.savedAt).toBe("2026-10-01T08:00:00.000Z");
  });

  it("ne lit jamais la copie d'un autre utilisateur ni d'un autre tenant (isolation tenant:utilisateur)", async () => {
    const s = setup();
    await saveWeek(await cacheOf(s));
    expect(await (await cacheOf(s, () => "ecole:user-2")).load(WEEK)).toBeNull();
    expect(await (await cacheOf(s, () => "autre-ecole:user-1")).load(WEEK)).toBeNull();
    expect(await (await cacheOf(s, () => null)).load(WEEK)).toBeNull();
    expect((await (await cacheOf(s, () => "ecole:user-2")).list()).length).toBe(0);
    expect(await (await cacheOf(s)).load(WEEK)).not.toBeNull();
  });

  it("un nouvel utilisateur efface les copies des autres (cache jetable)", async () => {
    const s = setup();
    await saveWeek(await cacheOf(s));
    const other = await cacheOf(s, () => "ecole:user-2");
    expect(await other.purgeForeign()).toBe(1);
    expect(s.fake.dump(OFFLINE_DB_NAME, "schedule_cache")).toHaveLength(0);
  });

  it("ne garde que les dernières semaines consultées et élague les fenêtres trop anciennes", async () => {
    const s = setup();
    const cache = await cacheOf(s);
    for (let i = 0; i < MAX_WINDOWS_PER_OWNER + 3; i++) {
      s.state.now = new Date(Date.parse("2026-10-01T08:00:00.000Z") + i * 60_000);
      const day = String(1 + i).padStart(2, "0");
      await saveWeek(cache, [occ(1)], { from: `2026-10-${day}`, to: `2026-10-${day}`, includeCancelled: false });
    }
    expect((await cache.list()).length).toBe(MAX_WINDOWS_PER_OWNER);
    s.state.now = new Date("2026-12-31T08:00:00.000Z");
    await saveWeek(cache, [occ(1)], { from: "2026-12-28", to: "2026-12-31", includeCancelled: false });
    expect((await cache.list()).map((r) => r.from)).toEqual(["2026-12-28"]);
  });

  it("sans propriétaire : rien n'est écrit ; la purge de déconnexion efface tout", async () => {
    const s = setup();
    expect(await saveWeek(await cacheOf(s, () => null))).toBe(false);
    await saveWeek(await cacheOf(s));
    await purgeOfflineData({ db: await openOfflineDb({ factory: s.fake.factory }) });
    expect(s.fake.dump(OFFLINE_DB_NAME, "schedule_cache")).toHaveLength(0);
  });

  it("fraîcheur : âge en minutes et alerte au-delà de 24 h", () => {
    expect(freshnessOf("2026-10-01T08:00:00.000Z", new Date("2026-10-01T08:42:30.000Z"))).toEqual({ ageMinutes: 42, stale: false });
    expect(freshnessOf("2026-10-01T08:00:00.000Z", new Date("2026-10-02T08:00:01.000Z")).stale).toBe(true);
  });
});

// ===================================================================================================================
// Brouillons de notes
// ===================================================================================================================

describe("brouillons de notes : coupure pendant la saisie et reprise", () => {
  it("la saisie survit au rechargement de la page (réouverture de la base) et se restitue dans la grille", async () => {
    const s = setup({ online: false });
    const m1 = s.make();
    await m1.init();
    expect(await m1.recordEntries(A1, "Contrôle 1", [entry(1, "14", 1), entry(2, "9.5", null)])).toEqual({ ok: true });
    expect(m1.getSnapshot().totals.pending).toBe(2);
    m1.dispose();

    // « rechargement » : nouvelle instance sur la même base
    const m2 = s.make();
    await m2.init();
    expect(m2.getSnapshot().drafts[0]).toMatchObject({ assessmentId: A1, status: "PENDING", pending: 2, label: "Contrôle 1" });
    const rec = await m2.reconcile(A1, { status: "DRAFT", grades: [sg(1, { rowVersion: 1 })], enrollmentIds: [E(1), E(2)] });
    expect(rec.restored.map((r) => [r.enrollmentId, r.score])).toEqual([
      [E(1), "14"],
      [E(2), "9.5"],
    ]);
    expect(rec.conflicts).toEqual([]);
  });

  it("hors ligne : rien n'est envoyé ; au retour du réseau tout part, puis le brouillon disparaît", async () => {
    const s = setup({ online: false, server: fakeServer([sg(1)]) });
    const m = s.make();
    await m.init();
    await m.recordEntries(A1, null, [entry(1, "14"), entry(2, "9", null)]);
    expect((await m.syncNow()).outcome).toBe("offline");
    expect(s.server.log).toHaveLength(0);
    s.state.online = true;
    m.setOnline(true);
    await m.syncNow();
    expect(s.server.log).toHaveLength(1);
    expect(s.server.log[0]!.entries).toEqual([
      { enrollmentId: E(1), entryStatus: "ENTERED", score: "14", comment: null, rowVersion: 1 },
      { enrollmentId: E(2), entryStatus: "ENTERED", score: "9" },
    ]);
    expect(m.getSnapshot().drafts).toEqual([]);
    expect(m.getSnapshot().syncedAt[A1]).toBeTruthy();
    expect(s.fake.dump(OFFLINE_DB_NAME, "grade_drafts")).toHaveLength(0);
  });

  it("la file locale ne contient aucun nom : seulement des identifiants, des notes et des versions", async () => {
    const s = setup({ online: false });
    const m = s.make();
    await m.recordEntries(A1, "Contrôle 1", [entry(1, "14")]);
    const raw = JSON.stringify(s.fake.dump(OFFLINE_DB_NAME, "grade_drafts"));
    expect(raw).toContain(E(1));
    expect(raw).not.toMatch(/nom|name|prenom/i);
  });
});

describe("brouillons de notes : rejeu idempotent", () => {
  it("après une coupure, le MÊME lot est rejoué avec la MÊME clé (même après rechargement) et sans doublon", async () => {
    const s = setup({ server: fakeServer([sg(1)]) });
    // Le serveur applique le lot mais la réponse se perd : on simule en appliquant puis en échouant côté réseau.
    const lossy = s.server.put;
    let lost = true;
    const m1 = s.make({
      put: async (id, entries, key) => {
        const r = await lossy(id, entries, key);
        if (lost) {
          lost = false;
          throw netErr();
        }
        return r;
      },
    });
    await m1.init();
    await m1.recordEntries(A1, null, [entry(1, "14", 1)]);
    const first = await m1.syncNow();
    expect(first.outcome).toBe("retry");
    expect(s.timers).toHaveLength(1);
    m1.dispose();

    // La page est rechargée : le lot en vol (clé + contenu) a été conservé.
    const stored = await (await s.drafts()).get(A1);
    expect(stored?.inflight?.batchKey).toBe(s.server.log[0]!.key);

    const m2 = s.make();
    await m2.init(); // reprise automatique
    await m2.syncNow();
    expect(s.server.log).toHaveLength(2);
    expect(s.server.log[1]!.key).toBe(s.server.log[0]!.key);
    expect(s.server.log[1]!.entries).toEqual(s.server.log[0]!.entries);
    // Une seule écriture côté serveur : version 2, pas 3.
    expect(s.server.grades.get(E(1))?.rowVersion).toBe(2);
    expect(m2.getSnapshot().drafts).toEqual([]);
  });

  it("une saisie faite pendant l'envoi part dans un lot suivant (autre clé) avec la nouvelle version de ligne", async () => {
    const s = setup({ server: fakeServer([sg(1)]) });
    let m!: GradeSyncManager;
    let injected = false;
    m = s.make({
      put: async (id, entries, key) => {
        if (!injected) {
          injected = true;
          // L'enseignant corrige la même note pendant le vol.
          await m.recordEntries(A1, null, [entry(1, "16", 1)]);
        }
        return s.server.put(id, entries, key);
      },
    });
    await m.init();
    await m.recordEntries(A1, null, [entry(1, "14", 1)]);
    const r = await m.syncNow();
    expect(r.batches).toBe(2);
    expect(s.server.log.map((l) => l.entries[0]!.score)).toEqual(["14", "16"]);
    expect(s.server.log[1]!.entries[0]!.rowVersion).toBe(2);
    expect(s.server.log[0]!.key).not.toBe(s.server.log[1]!.key);
    expect(s.server.grades.get(E(1))?.score).toBe("16");
    expect(m.getSnapshot().drafts).toEqual([]);
  });

  it("erreur serveur 503 : reprise avec attente croissante, brouillon intact", async () => {
    const s = setup({ server: fakeServer([sg(1)]) });
    const m = s.make();
    await m.init();
    await m.recordEntries(A1, null, [entry(1, "12", 1)]);
    s.server.failNext(() => apiErr(503, "unavailable"));
    s.server.failNext(() => apiErr(503, "unavailable"));
    expect((await m.syncNow()).outcome).toBe("retry");
    expect((await m.syncNow()).outcome).toBe("retry");
    expect(s.timers.map((t) => t.ms)).toEqual([1000, 2000]);
    expect(m.getSnapshot()).toMatchObject({ failure: "server", totals: { pending: 1 } });
    expect((await m.syncNow()).outcome).toBe("synced");
    expect(new Set(s.server.log.map((l) => l.key)).size).toBe(1);
  });

  it("un lot de plus de MAX_ENTRIES_PER_BATCH lignes est découpé en plusieurs envois", async () => {
    const s = setup();
    const m = s.make();
    await m.init();
    const entries = Array.from({ length: MAX_ENTRIES_PER_BATCH + 5 }, (_, i) => entry(i + 1, "10", null));
    await m.recordEntries(A1, null, entries);
    const r = await m.syncNow();
    expect(r.batches).toBe(2);
    expect(s.server.log.map((l) => l.entries.length)).toEqual([MAX_ENTRIES_PER_BATCH, 5]);
    expect(m.getSnapshot().drafts).toEqual([]);
  });
});

describe("brouillons de notes : conflits (jamais d'écrasement silencieux)", () => {
  it("note modifiée entre-temps : 409 rowVersion -> conflit documenté par la valeur du serveur, rien n'est renvoyé", async () => {
    const s = setup({ server: fakeServer([sg(1), sg(2)]) });
    const events: AppliedEvent[] = [];
    const m = s.make();
    m.onApplied((e) => events.push(e));
    await m.init();
    await m.recordEntries(A1, null, [entry(1, "14", 1), entry(2, "8", 1)]);
    s.server.externalEdit(1, "5"); // quelqu'un d'autre change la note 1 (version 2)
    const r = await m.syncNow();
    expect(r.outcome).toBe("conflict");
    // La note 2 (non périmée) est partie dans un second lot ; la note 1 attend un choix.
    expect(s.server.grades.get(E(2))?.score).toBe("8");
    expect(s.server.grades.get(E(1))?.score).toBe("5");
    const view = m.getSnapshot().drafts[0]!;
    expect(view.status).toBe("CONFLICT");
    expect(view.conflicts[0]).toMatchObject({ enrollmentId: E(1), mine: { score: "14" }, server: { score: "5", rowVersion: 2 } });
    // la grille est remise à la valeur du serveur pour la seule ligne en conflit
    expect(events.some((e) => e.resetEnrollmentIds.includes(E(1)) && e.grades.every((g) => g.enrollmentId === E(1)))).toBe(true);
    // un nouveau passage ne renvoie RIEN tant que l'utilisateur n'a pas choisi
    const calls = s.server.log.length;
    await m.syncNow();
    expect(s.server.log.length).toBe(calls);
    // et la grille ne peut pas ré-enregistrer la ligne en conflit
    await m.recordEntries(A1, null, [entry(1, "14", 1)]);
    expect((await m.syncNow()).outcome).toBe("nothing");
    expect(s.server.log.length).toBe(calls);
  });

  it("« garder la mienne » : renvoyée explicitement sur la version courante du serveur", async () => {
    const s = setup({ server: fakeServer([sg(1)]) });
    const m = s.make();
    await m.init();
    await m.recordEntries(A1, null, [entry(1, "14", 1)]);
    s.server.externalEdit(1, "5");
    await m.syncNow();
    const r = await m.resolveConflict(A1, E(1), "mine");
    expect(r?.entry).toMatchObject({ score: "14", baseVersion: 2 });
    await m.syncNow();
    expect(s.server.grades.get(E(1))).toMatchObject({ score: "14", rowVersion: 3 });
    expect(s.server.log.at(-1)!.entries[0]).toMatchObject({ rowVersion: 2 });
    expect(m.getSnapshot().drafts).toEqual([]);
  });

  it("« prendre le serveur » : ma saisie est abandonnée, rien n'est envoyé", async () => {
    const s = setup({ server: fakeServer([sg(1)]) });
    const m = s.make();
    await m.init();
    await m.recordEntries(A1, null, [entry(1, "14", 1)]);
    s.server.externalEdit(1, "5");
    await m.syncNow();
    const calls = s.server.log.length;
    expect((await m.resolveConflict(A1, E(1), "server"))?.entry).toBeNull();
    await m.syncNow();
    expect(s.server.log.length).toBe(calls);
    expect(s.server.grades.get(E(1))?.score).toBe("5");
    expect(m.getSnapshot().drafts).toEqual([]);
  });

  it("conflit détecté à la réouverture de la feuille (version différente) : saisie mise de côté, pas restituée", async () => {
    const s = setup({ online: false });
    const m = s.make();
    await m.init();
    await m.recordEntries(A1, null, [entry(1, "14", 1), entry(2, "7", 1)]);
    const rec = await m.reconcile(A1, { status: "DRAFT", grades: [sg(1, { score: "5", entryStatus: "ENTERED", rowVersion: 2 }), sg(2, { rowVersion: 1 })], enrollmentIds: [E(1), E(2)] });
    expect(rec.restored.map((r) => r.enrollmentId)).toEqual([E(2)]);
    expect(rec.conflicts).toHaveLength(1);
    expect(rec.conflicts[0]).toMatchObject({ enrollmentId: E(1), mine: { score: "14" }, server: { score: "5", rowVersion: 2 } });
  });

  it("valeur déjà identique côté serveur : pas de conflit, la saisie est simplement abandonnée", async () => {
    const s = setup({ online: false });
    const m = s.make();
    await m.init();
    await m.recordEntries(A1, null, [entry(1, "14", 1)]);
    const rec = await m.reconcile(A1, { status: "DRAFT", grades: [sg(1, { score: "14.000", entryStatus: "ENTERED", rowVersion: 2 })], enrollmentIds: [E(1)] });
    expect(rec.conflicts).toEqual([]);
    expect(rec.restored).toEqual([]);
    expect(m.getSnapshot().drafts).toEqual([]);
  });

  it("deux onglets : le conflit « faux » (le serveur a déjà ma valeur) est abandonné sans arbitrage", async () => {
    const s = setup({ server: fakeServer([sg(1)]) });
    const m = s.make();
    await m.init();
    await m.recordEntries(A1, null, [entry(1, "14", 1)]);
    s.server.externalEdit(1, "14"); // un autre onglet vient d'envoyer exactement la même valeur
    const r = await m.syncNow();
    expect(r.outcome).not.toBe("conflict");
    expect(m.getSnapshot().drafts).toEqual([]);
  });

  it("valeur du serveur illisible (réseau) : le conflit est créé quand même, sans valeur serveur, et « la mienne » est refusée", async () => {
    const s = setup({ server: fakeServer([sg(1)]) });
    const m = s.make({
      fetchSheet: async () => {
        throw netErr();
      },
    });
    await m.init();
    await m.recordEntries(A1, null, [entry(1, "14", 1)]);
    s.server.externalEdit(1, "5");
    await m.syncNow();
    expect(m.getSnapshot().drafts[0]!.conflicts[0]!.server).toBeNull();
    expect(await m.resolveConflict(A1, E(1), "mine")).toBeNull(); // pas d'écrasement à l'aveugle
    expect(m.getSnapshot().drafts[0]!.conflicts).toHaveLength(1);
  });
});

describe("brouillons de notes : évaluations figées", () => {
  it("évaluation validée/clôturée : l'envoi est refusé (409), le brouillon est verrouillé et conservé, sans nouvel essai", async () => {
    const s = setup({ server: fakeServer([sg(1)]) });
    const m = s.make();
    await m.init();
    await m.recordEntries(A1, null, [entry(1, "14", 1)]);
    s.server.setStatus("APPROVED");
    const r = await m.syncNow();
    expect(r).toMatchObject({ outcome: "blocked", blockedCode: "assess.grade_frozen" });
    expect(m.getSnapshot().drafts[0]).toMatchObject({ status: "LOCKED", pending: 1 });
    const calls = s.server.log.length;
    await m.syncNow();
    expect(s.server.log.length).toBe(calls);
    expect(s.timers).toHaveLength(0);
  });

  it("à la réouverture d'une évaluation qui n'est plus en brouillon : verrouillée, rien n'est restitué", async () => {
    const s = setup({ online: false });
    const m = s.make();
    await m.init();
    await m.recordEntries(A1, null, [entry(1, "14", 1)]);
    const rec = await m.reconcile(A1, { status: "PUBLISHED", grades: [sg(1)], enrollmentIds: [E(1)] });
    expect(rec).toMatchObject({ locked: true, restored: [] });
    expect(m.getSnapshot().drafts[0]!.status).toBe("LOCKED");
    // retournée en brouillon : le verrouillage est levé
    const again = await m.reconcile(A1, { status: "DRAFT", grades: [sg(1)], enrollmentIds: [E(1)] });
    expect(again.locked).toBe(false);
    expect(again.restored).toHaveLength(1);
    expect(m.getSnapshot().drafts[0]!.status).toBe("PENDING");
  });

  it("un refus définitif (403) bloque le brouillon sans le perdre ; « Réessayer » le remet en file", async () => {
    const s = setup({ server: fakeServer([sg(1)]) });
    const m = s.make();
    await m.init();
    await m.recordEntries(A1, null, [entry(1, "14", 1)]);
    s.server.failNext(() => apiErr(403, "assess.not_assigned"));
    expect((await m.syncNow()).outcome).toBe("blocked");
    expect(m.getSnapshot().drafts[0]).toMatchObject({ status: "FAILED", blockedCode: "assess.not_assigned", pending: 1 });
    await m.retry(A1);
    await m.syncNow();
    expect(m.getSnapshot().drafts).toEqual([]);
  });
});

describe("brouillons de notes : session expirée et changement d'identité", () => {
  it("jeton expiré : rien n'est envoyé, les brouillons restent ; la reconnexion de la même identité reprend, avec la même clé", async () => {
    const s = setup({ server: fakeServer([sg(1)]) });
    const m = s.make();
    await m.init();
    await m.recordEntries(A1, null, [entry(1, "14", 1)]);
    // 401 en plein envoi : le lot est « en vol », sa clé est conservée
    s.server.failNext(() => apiErr(401, "UNAUTHORIZED"));
    const r = await m.syncNow();
    expect(r.outcome).toBe("auth");
    expect(m.getSnapshot()).toMatchObject({ failure: "auth", totals: { pending: 1 } });
    expect(s.timers).toHaveLength(0); // pas de boucle d'essais avec un jeton mort
    const key = s.server.log[0]!.key;

    // la session est expirée : plus aucun appel
    s.state.valid = false;
    const before = s.server.log.length;
    expect((await m.syncNow()).outcome).toBe("auth");
    expect(s.server.log.length).toBe(before);

    // la saisie continue d'être gardée localement pendant l'expiration
    expect(await m.recordEntries(A1, null, [entry(1, "14", 1), entry(2, "6", null)])).toEqual({ ok: true });

    // reconnexion de la MÊME identité
    s.state.valid = true;
    m.notifySessionRenewed();
    await m.syncNow();
    expect(s.server.log[before]!.key).toBe(key);
    expect(m.getSnapshot().drafts).toEqual([]);
    expect(s.server.grades.get(E(2))?.score).toBe("6");
  });

  it("une AUTRE identité sur le même appareil ne voit ni n'envoie jamais les brouillons ; l'originale les retrouve", async () => {
    const s = setup({ server: fakeServer([sg(1)]) });
    const m1 = s.make();
    await m1.init();
    await m1.recordEntries(A1, "Contrôle 1", [entry(1, "14", 1)]);
    s.server.failNext(() => apiErr(401, "UNAUTHORIZED"));
    await m1.syncNow();
    m1.dispose();

    // autre utilisateur du même tenant
    s.state.owner = "ecole:user-2";
    const m2 = s.make();
    await m2.init();
    expect(m2.getSnapshot().drafts).toEqual([]);
    const before = s.server.log.length;
    expect((await m2.syncNow()).outcome).toBe("nothing");
    expect(s.server.log.length).toBe(before);
    expect(await (await s.drafts()).get(A1)).toBeUndefined();
    // il ne peut pas non plus écraser le brouillon d'autrui en saisissant la même évaluation
    await m2.recordEntries(A1, "Autre", [entry(1, "3", 1)]);
    expect((await (await s.drafts()).get(A1))?.owner).toBe("ecole:user-2");
    await m2.discard(A1);

    // autre tenant, même identifiant utilisateur
    s.state.owner = "autre-ecole:user-1";
    const m3 = s.make();
    await m3.init();
    expect(m3.getSnapshot().drafts).toEqual([]);
    expect((await m3.syncNow()).outcome).toBe("nothing");

    // l'identité d'origine retrouve son brouillon intact
    s.state.owner = "ecole:user-1";
    const m4 = s.make();
    await m4.init();
    expect(m4.getSnapshot().drafts[0]).toMatchObject({ assessmentId: A1, pending: 1, label: "Contrôle 1" });
  });

  it("sans utilisateur identifié (déconnecté) : rien n'est lu ni envoyé", async () => {
    const s = setup({ owner: null });
    const m = s.make();
    await m.init();
    expect(await m.recordEntries(A1, null, [entry(1, "14")])).toEqual({ ok: false, reason: "unavailable" });
    expect((await m.syncNow()).outcome).toBe("unavailable");
    expect(s.server.log).toHaveLength(0);
  });
});

describe("brouillons de notes : limites de la file", () => {
  it(`au plus ${MAX_DRAFT_ASSESSMENTS} évaluations en attente : la suivante est refusée, signalée, et les existantes restent intactes`, async () => {
    const s = setup({ online: false });
    const m = s.make();
    await m.init();
    for (let i = 0; i < MAX_DRAFT_ASSESSMENTS; i++) expect((await m.recordEntries(uuid(7000 + i), null, [entry(1, "10")])).ok).toBe(true);
    expect(await m.recordEntries(uuid(9999), null, [entry(1, "10")])).toEqual({ ok: false, reason: "limit" });
    expect(m.getSnapshot().limitReached).toBe(true);
    expect(m.getSnapshot().drafts).toHaveLength(MAX_DRAFT_ASSESSMENTS);
    // une évaluation déjà en file peut toujours être modifiée
    expect((await m.recordEntries(uuid(7000), null, [entry(1, "11")])).ok).toBe(true);
    expect(m.getSnapshot().limitReached).toBe(false);
  });

  it("trop de lignes pour une évaluation : refusé (DraftLimitError), l'ancien contenu est conservé", async () => {
    const s = setup({ online: false });
    const drafts = await s.drafts();
    await drafts.replaceEntries(A1, null, [entry(1, "10")]);
    const many = Array.from({ length: MAX_ENTRIES_PER_DRAFT + 1 }, (_, i) => entry(i + 1, "10", null));
    await expect(drafts.replaceEntries(A1, null, many)).rejects.toBeInstanceOf(DraftLimitError);
    expect(Object.keys((await drafts.get(A1))!.entries)).toEqual([E(1)]);
  });

  it("stockage refusé (quota) : la saisie est signalée comme non gardée sur l'appareil", async () => {
    const s = setup({ online: false });
    const m = s.make();
    await m.init();
    s.fake.failWrites(1);
    expect(await m.recordEntries(A1, null, [entry(1, "10")])).toEqual({ ok: false, reason: "storage" });
    expect(m.getSnapshot().storageFailed).toBe(true);
    expect((await m.recordEntries(A1, null, [entry(1, "10")])).ok).toBe(true);
    expect(m.getSnapshot().storageFailed).toBe(false);
  });

  it("repli en mémoire (IndexedDB indisponible) : signalé par `persistent: false`", async () => {
    const m = new GradeSyncManager({ openDb: () => openOfflineDb({ factory: null }), owner: () => "ecole:user-1", put: fakeServer().put, fetchSheet: fakeServer().fetchSheet, isOnline: () => false });
    await m.init();
    expect(m.getSnapshot().persistent).toBe(false);
  });
});

describe("déconnexion : purge des données hors ligne", () => {
  it("efface la copie d'emploi du temps ; conserve par défaut les notes non envoyées (rattachées à leur propriétaire)", async () => {
    const s = setup({ online: false });
    const db = await openOfflineDb({ factory: s.fake.factory });
    await new ScheduleCache({ db, owner: () => s.state.owner }).save({ ...WEEK, hasMore: false, items: [occ(1)], classrooms: {}, rooms: {} });
    const m = s.make();
    await m.recordEntries(A1, null, [entry(1, "14")]);
    const report = await purgeOfflineData({ db });
    expect(report).toEqual({ scheduleCleared: true, draftsRemoved: 0, draftsKept: 1 });
    expect(s.fake.dump(OFFLINE_DB_NAME, "schedule_cache")).toHaveLength(0);
    expect(s.fake.dump(OFFLINE_DB_NAME, "grade_drafts")).toHaveLength(1);
    // sans propriétaire (déconnecté) : invisible
    s.state.owner = null;
    expect(await (await s.drafts()).list()).toEqual([]);
  });

  it("`discardUnsynced` efface aussi les brouillons non envoyés (appareil partagé)", async () => {
    const s = setup({ online: false });
    const db = await openOfflineDb({ factory: s.fake.factory });
    const m = s.make();
    await m.recordEntries(A1, null, [entry(1, "14")]);
    await m.recordEntries(A2, null, [entry(2, "12")]);
    expect(await purgeOfflineData({ db, discardUnsynced: true })).toMatchObject({ draftsRemoved: 2, draftsKept: 0 });
    expect(s.fake.dump(OFFLINE_DB_NAME, "grade_drafts")).toHaveLength(0);
  });

  it("migration : une base v1 (file d'appel) reçoit les nouveaux magasins sans perdre les appels", async () => {
    const fake = createFakeIndexedDb();
    // base v1 simulée : on l'ouvre en version 1 avec deux magasins seulement
    await new Promise<void>((resolve) => {
      const req = fake.factory.open(OFFLINE_DB_NAME, 1) as unknown as { onupgradeneeded: (() => void) | null; onsuccess: (() => void) | null; result: { createObjectStore: (n: string, o: { keyPath: string }) => void; transaction: (n: string, m: string) => { objectStore: (n: string) => { put: (v: unknown) => void } } } };
      req.onupgradeneeded = () => {
        req.result.createObjectStore("attendance_calls", { keyPath: "key" });
        req.result.createObjectStore("meta", { keyPath: "key" });
      };
      req.onsuccess = () => {
        req.result.transaction("attendance_calls", "readwrite").objectStore("attendance_calls").put({ key: "occ:1", owner: "ecole:user-1" });
        setTimeout(resolve, 5);
      };
    });
    const db = await openOfflineDb({ factory: fake.factory });
    expect(db.persistent).toBe(true);
    await db.store("grade_drafts").getAll();
    await db.store("schedule_cache").getAll();
    expect(fake.dump(OFFLINE_DB_NAME, "attendance_calls")).toHaveLength(1);
  });
});
