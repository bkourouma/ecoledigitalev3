import { describe, expect, it, vi } from "vitest";
import { attendanceSyncBatchSchema, attendanceSyncResultDtoSchema, type AttendanceSyncBatch, type AttendanceSyncResultDto } from "@ecoledigitale/contracts/v2/attendance";
import { ApiError, ClientErrorCode } from "@/platform/api/errors";
import { createFakeIndexedDb } from "@/platform/test/fake-indexeddb";
import { AttendanceOutbox, callKey, MAX_RECORDS_PER_SESSION, OutboxUnavailableError, type CallTarget } from "./attendance-outbox";
import { createMemoryDb, openOfflineDb, OFFLINE_DB_NAME } from "./idb";
import { OutboxManager } from "./outbox-manager";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OCC: CallTarget = { kind: "occurrence", occurrenceId: uuid(900) };
const DAILY: CallTarget = { kind: "daily", classroomId: uuid(901), date: "2026-10-01" };

function counter(start = 1) {
  let n = start;
  return () => uuid(n++);
}

/** Réponse de l'API construite à partir du lot reçu : `decide` choisit le résultat de chaque pointage. */
function answer(
  batch: AttendanceSyncBatch,
  decide: (record: { clientId: string; studentId: string }, sessionClientId: string) => AttendanceSyncResultDto["sessions"][number]["records"][number]["outcome"] = () => "APPLIED",
  session: Partial<AttendanceSyncResultDto["sessions"][number]> = {},
  receivedAt = batch.clientSentAt,
): AttendanceSyncResultDto {
  const sessions = batch.sessions.map((s) => ({
    clientId: s.clientId,
    outcome: "OPENED" as const,
    sessionId: uuid(7000),
    sessionStatus: s.submit ? ("SUBMITTED" as const) : ("OPEN" as const),
    submitted: Boolean(s.submit),
    errorCode: null,
    records: s.records.map((r) => {
      const outcome = decide(r, s.clientId);
      return { clientId: r.clientId, outcome, recordId: outcome === "CONFLICT" ? null : uuid(8000), conflictId: outcome === "CONFLICT" ? uuid(9000) : null, errorCode: outcome === "REJECTED" ? "attendance.invalid_status" : null };
    }),
    ...session,
  }));
  const all = sessions.flatMap((s) => s.records);
  const count = (o: string) => all.filter((r) => r.outcome === o).length;
  return attendanceSyncResultDtoSchema.parse({
    batchId: batch.batchId ?? null,
    receivedAt,
    sessions,
    totals: { applied: count("APPLIED"), unchanged: count("UNCHANGED"), replayed: count("REPLAYED"), conflicts: count("CONFLICT"), rejected: count("REJECTED") },
  });
}

function setup(owner: string | null = "ecole:user-1") {
  const fake = createFakeIndexedDb();
  const state = { owner, now: new Date("2026-10-01T08:00:00.000Z") };
  const next = counter();
  const open = () => openOfflineDb({ factory: fake.factory });
  const outboxOf = async () => new AttendanceOutbox({ db: await open(), owner: () => state.owner, now: () => state.now, uuid: next });
  return { fake, state, next, open, outboxOf };
}

describe("idb : repli et persistance", () => {
  it("écrit, relit, supprime ; les données survivent à une réouverture", async () => {
    const { fake, open } = setup();
    const db = await open();
    expect(db.persistent).toBe(true);
    const store = db.store<{ key: string; n: number }>("meta");
    await store.put({ key: "a", n: 1 });
    await store.put({ key: "b", n: 2 });
    await store.delete("a");
    expect(await store.getAll()).toEqual([{ key: "b", n: 2 }]);
    const again = (await open()).store<{ key: string; n: number }>("meta");
    expect(await again.get("b")).toEqual({ key: "b", n: 2 });
    expect(fake.dump(OFFLINE_DB_NAME, "meta")).toHaveLength(1);
  });

  it("bascule sur la mémoire si IndexedDB est absent ou refuse l'ouverture", async () => {
    const none = await openOfflineDb({ factory: null });
    expect(none.persistent).toBe(false);
    const fake = createFakeIndexedDb();
    fake.failNextOpen();
    const failed = await openOfflineDb({ factory: fake.factory });
    expect(failed.persistent).toBe(false);
    const store = failed.store<{ key: string }>("meta");
    await store.put({ key: "x" });
    expect(await store.get("x")).toEqual({ key: "x" });
  });
});

describe("AttendanceOutbox", () => {
  it("ne stocke QUE des identifiants et des codes : aucune donnée nominative", async () => {
    const { fake, outboxOf } = setup();
    const outbox = await outboxOf();
    await outbox.recordMark({ target: OCC, label: "6e A · Mathématiques", date: "2026-10-01", studentId: uuid(11), statusCode: "ABSENT" });
    await outbox.recordMark({ target: OCC, date: "2026-10-01", studentId: uuid(12), statusCode: "LATE", minutesLate: 10 });
    const rows = fake.dump(OFFLINE_DB_NAME, "attendance_calls") as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    const call = rows[0] as { records: Record<string, Record<string, unknown>> };
    expect(Object.keys(call.records[uuid(11)]!).sort()).toEqual(["clientId", "clientMarkedAt", "statusCode", "studentId"]);
    expect(call.records[uuid(12)]).toMatchObject({ statusCode: "LATE", minutesLate: 10 });
    // Tout texte stocké est un UUID, un code, une date, le libellé neutre de l'appel ou l'identité technique du propriétaire.
    const strings = JSON.stringify(rows).match(/"[^"]*"/g)!.map((s) => s.slice(1, -1));
    for (const s of strings) {
      const plausible = /^[0-9a-f-]{36}$/.test(s) || /^[A-Z_]+$/.test(s) || /^\d{4}-\d{2}-\d{2}/.test(s) || /^[a-zA-Z]+$/.test(s) || ["6e A · Mathématiques", "ecole:user-1", "occ:" + uuid(900)].includes(s);
      expect(plausible, s).toBe(true);
    }
  });

  it("renouvelle la clé d'idempotence à chaque modification d'un pointage", async () => {
    const { outboxOf } = setup();
    const outbox = await outboxOf();
    const first = await outbox.recordMark({ target: OCC, date: "2026-10-01", studentId: uuid(11), statusCode: "ABSENT" });
    const second = await outbox.recordMark({ target: OCC, date: "2026-10-01", studentId: uuid(11), statusCode: "PRESENT" });
    expect(second.records[uuid(11)]!.clientId).not.toBe(first.records[uuid(11)]!.clientId);
    expect(second.sessionClientId).toBe(first.sessionClientId);
    expect(Object.keys(second.records)).toHaveLength(1);
  });

  it("cloisonne par propriétaire : un autre utilisateur ne voit ni n'envoie rien", async () => {
    const { state, outboxOf } = setup("ecole:user-1");
    const outbox = await outboxOf();
    await outbox.recordMark({ target: OCC, date: "2026-10-01", studentId: uuid(11), statusCode: "ABSENT" });
    state.owner = "ecole:user-2";
    expect(await outbox.list()).toEqual([]);
    expect(await outbox.prepareBatch()).toBeNull();
    state.owner = null;
    await expect(outbox.recordMark({ target: OCC, date: "2026-10-01", studentId: uuid(11), statusCode: "ABSENT" })).rejects.toBeInstanceOf(OutboxUnavailableError);
    state.owner = "ecole:user-1";
    expect(await outbox.list()).toHaveLength(1);
  });

  it("compose un lot conforme au contrat (cible occurrence ou journalière, soumission, déduction)", async () => {
    const { outboxOf } = setup();
    const outbox = await outboxOf();
    await outbox.recordMark({ target: OCC, date: "2026-10-01", studentId: uuid(11), statusCode: "ABSENT" });
    await outbox.requestSubmit({ target: OCC, date: "2026-10-01", defaultStatus: "PRESENT" });
    await outbox.requestSubmit({ target: DAILY, date: "2026-10-01", defaultStatus: "PRESENT" });
    const prepared = (await outbox.prepareBatch())!;
    expect(attendanceSyncBatchSchema.safeParse(prepared.batch).success).toBe(true);
    expect(prepared.batch.sessions).toHaveLength(2);
    const bySession = Object.fromEntries(prepared.batch.sessions.map((s) => ["occurrenceId" in s.target ? "occ" : "day", s]));
    expect(bySession.occ!.target).toEqual({ occurrenceId: uuid(900) });
    expect(bySession.occ!.submit).toEqual({ defaultStatus: "PRESENT" });
    expect(bySession.day!.target).toEqual({ scope: "DAILY", classroomId: uuid(901), date: "2026-10-01" });
    expect(bySession.day!.records).toEqual([]);
    expect(prepared.batch.deviceId).toMatch(/^web-/);
    // Les appels sont « en vol » : un second lot est vide tant que le premier n'est pas résolu.
    expect(await outbox.prepareBatch()).toBeNull();
  });

  it("découpe un appel de plus de 500 pointages et ne soumet qu'avec le dernier morceau", async () => {
    const { outboxOf } = setup();
    const outbox = await outboxOf();
    for (let i = 0; i < MAX_RECORDS_PER_SESSION + 5; i++) {
      await outbox.recordMark({ target: OCC, date: "2026-10-01", studentId: uuid(20_000 + i), statusCode: "ABSENT" });
    }
    await outbox.requestSubmit({ target: OCC, date: "2026-10-01", defaultStatus: "PRESENT" });
    const first = (await outbox.prepareBatch())!;
    expect(first.batch.sessions[0]!.records).toHaveLength(MAX_RECORDS_PER_SESSION);
    expect(first.batch.sessions[0]!.submit).toBeUndefined();
    await outbox.applyResult(first.snapshot, answer(first.batch));
    const second = (await outbox.prepareBatch())!;
    expect(second.batch.sessions[0]!.records).toHaveLength(5);
    expect(second.batch.sessions[0]!.submit).toEqual({ defaultStatus: "PRESENT" });
  }, 20_000);

  it("une donnée locale corrompue ne part jamais : l'appel passe en attention", async () => {
    const { outboxOf } = setup();
    const outbox = await outboxOf();
    await outbox.recordMark({ target: OCC, date: "2026-10-01", studentId: "pas-un-uuid", statusCode: "ABSENT" });
    expect(await outbox.prepareBatch()).toBeNull();
    const [call] = await outbox.list();
    expect(call!.state).toBe("ATTENTION");
    expect(call!.lastError?.code).toBe("local.invalid_batch");
  });

  it("purge les appels terminés anciens, relance les envois interrompus", async () => {
    const { state, outboxOf } = setup();
    const outbox = await outboxOf();
    await outbox.recordMark({ target: OCC, date: "2026-10-01", studentId: uuid(11), statusCode: "ABSENT" });
    const prepared = (await outbox.prepareBatch())!;
    expect((await outbox.list())[0]!.state).toBe("SYNCING");
    // Rechargement de la page en plein envoi.
    const reopened = await outboxOf();
    expect(await reopened.recoverInterrupted()).toBe(1);
    expect((await reopened.list())[0]!.state).toBe("PENDING");
    // Le rejeu du même appel réutilise les mêmes clés d'idempotence.
    const again = (await reopened.prepareBatch())!;
    expect(again.batch.sessions[0]!.records[0]!.clientId).toBe(prepared.batch.sessions[0]!.records[0]!.clientId);
    expect(again.batch.sessions[0]!.clientId).toBe(prepared.batch.sessions[0]!.clientId);
    await reopened.applyResult(again.snapshot, answer(again.batch));
    expect((await reopened.list())[0]!.state).toBe("DONE");
    state.now = new Date("2026-10-03T08:00:00.000Z");
    expect(await reopened.purgeDone(24 * 3_600_000)).toBe(1);
    expect(await reopened.list()).toEqual([]);
  });

  it("décalage d'horloge : borné, négligé sous 5 secondes", async () => {
    const { outboxOf } = setup();
    const outbox = await outboxOf();
    expect(await outbox.setClockOffsetFromResult("2026-10-01T08:00:00.000Z", "2026-10-01T08:00:02.000Z")).toBe(0);
    expect(await outbox.setClockOffsetFromResult("2026-10-01T08:00:00.000Z", "2026-10-01T08:10:00.000Z")).toBe(600_000);
    expect(await outbox.setClockOffsetFromResult("2026-10-01T08:00:00.000Z", "2027-10-01T08:00:00.000Z")).toBe(86_400_000);
    expect(await outbox.clockOffsetMs()).toBe(86_400_000);
  });
});

describe("OutboxManager : hors ligne, reconnexion, rejeu, conflits", () => {
  function manager(over: { post?: (b: AttendanceSyncBatch) => Promise<AttendanceSyncResultDto>; online?: boolean } = {}) {
    const ctx = setup();
    const online = { value: over.online ?? true };
    const post = vi.fn(over.post ?? (async (b: AttendanceSyncBatch) => answer(b)));
    const m = new OutboxManager({
      openDb: ctx.open,
      owner: () => ctx.state.owner,
      post,
      isOnline: () => online.value,
      now: () => ctx.state.now,
      uuid: ctx.next,
      setTimer: () => 1,
      clearTimer: () => undefined,
    });
    return { ...ctx, m, post, online };
  }

  const mark = (m: OutboxManager, studentId: string, statusCode = "ABSENT") => m.mark({ target: OCC, date: "2026-10-01", studentId, statusCode });

  it("saisie hors ligne : rien n'est envoyé ; à la reconnexion un seul lot part, puis la file est vide", async () => {
    const { m, post } = manager({ online: false });
    await m.init();
    await mark(m, uuid(11));
    await mark(m, uuid(12), "LATE");
    expect(await m.submit({ target: OCC, date: "2026-10-01", defaultStatus: "PRESENT" })).toBeNull();
    expect(post).not.toHaveBeenCalled();
    expect(m.getSnapshot().pending).toEqual({ calls: 1, records: 2 });
    expect(m.getSnapshot().online).toBe(false);

    m.setOnline(true);
    await vi.waitFor(() => expect(m.getSnapshot().calls[0]?.state).toBe("DONE"));
    expect(post).toHaveBeenCalledTimes(1);
    const batch = post.mock.calls[0]![0];
    expect(batch.sessions[0]!.records.map((r) => r.studentId).sort()).toEqual([uuid(11), uuid(12)]);
    expect(batch.sessions[0]!.submit).toEqual({ defaultStatus: "PRESENT" });
    expect(m.getSnapshot().pending).toEqual({ calls: 0, records: 0 });
    expect(m.getSnapshot().calls[0]).toMatchObject({ submitted: true, appliedCount: 2, sessionId: uuid(7000) });
    expect(m.getSnapshot().lastSyncAt).not.toBeNull();
  });

  it("coupure réseau en plein envoi : rien n'est perdu, le rejeu réutilise les MÊMES clés d'idempotence", async () => {
    let attempt = 0;
    const { m, post } = manager({
      post: async (b) => {
        attempt += 1;
        if (attempt === 1) throw new ApiError({ code: ClientErrorCode.NETWORK, message: "réseau" });
        return answer(b, () => "REPLAYED");
      },
    });
    await m.init();
    await mark(m, uuid(11));
    const first = await m.syncNow();
    expect(first.failure).toBe("network");
    expect(m.getSnapshot().failure).toBe("network");
    expect(m.getSnapshot().nextRetryAt).not.toBeNull();
    expect(m.getSnapshot().pending.records).toBe(1);
    expect(m.getSnapshot().calls[0]!.state).toBe("PENDING");

    const second = await m.syncNow();
    expect(second.failure).toBeNull();
    const [a, b] = post.mock.calls.map((c) => c[0]);
    expect(b!.sessions[0]!.records[0]!.clientId).toBe(a!.sessions[0]!.records[0]!.clientId);
    expect(b!.sessions[0]!.clientId).toBe(a!.sessions[0]!.clientId);
    expect(m.getSnapshot().calls[0]!.state).toBe("DONE");
    expect(m.getSnapshot().failure).toBeNull();
  });

  it("un seul envoi à la fois : les appels concurrents partagent le même résultat", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const { m, post } = manager({ post: async (b) => (await gate, answer(b)) });
    await m.init();
    await mark(m, uuid(11));
    const p1 = m.syncNow();
    const p2 = m.syncNow();
    release();
    await Promise.all([p1, p2]);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("modification pendant l'envoi : la version plus récente reste en file et repart", async () => {
    let first = true;
    let manager_!: OutboxManager;
    const { m, post } = manager({
      post: async (b) => {
        if (first) {
          first = false;
          // L'enseignant change d'avis pendant que le lot est en vol.
          await manager_.mark({ target: OCC, date: "2026-10-01", studentId: uuid(11), statusCode: "PRESENT" });
        }
        return answer(b);
      },
    });
    manager_ = m;
    await m.init();
    await mark(m, uuid(11), "ABSENT");
    await m.syncNow();
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0]![0].sessions[0]!.records[0]!.statusCode).toBe("ABSENT");
    expect(post.mock.calls[1]![0].sessions[0]!.records[0]!.statusCode).toBe("PRESENT");
    expect(post.mock.calls[1]![0].sessions[0]!.records[0]!.clientId).not.toBe(post.mock.calls[0]![0].sessions[0]!.records[0]!.clientId);
    expect(m.getSnapshot().calls[0]!.state).toBe("DONE");
  });

  it("conflit renvoyé par l'API : le pointage quitte la file mais l'appel passe en « attention » avec la note", async () => {
    const { m } = manager({ post: async (b) => answer(b, (r) => (r.studentId === uuid(12) ? "CONFLICT" : "APPLIED")) });
    await m.init();
    await mark(m, uuid(11));
    await mark(m, uuid(12));
    await m.syncNow();
    const call = m.getSnapshot().calls[0]!;
    expect(call.state).toBe("ATTENTION");
    expect(call.conflicts).toEqual([{ studentId: uuid(12), conflictId: uuid(9000) }]);
    expect(call.appliedCount).toBe(1);
    expect(m.getSnapshot().pending.records).toBe(0);
    // Prise de connaissance : l'appel disparaît de la file.
    await m.dismiss(OCC);
    expect(m.getSnapshot().calls).toEqual([]);
  });

  it("pointage rejeté (statut refusé) : signalé, non rejoué ; séance rejetée : attention et reprise manuelle", async () => {
    const rejected = manager({ post: async (b) => answer(b, () => "REJECTED") });
    await rejected.m.init();
    await mark(rejected.m, uuid(11));
    await rejected.m.syncNow();
    expect(rejected.m.getSnapshot().calls[0]).toMatchObject({ state: "ATTENTION", rejected: [{ studentId: uuid(11), code: "attendance.invalid_status" }] });
    expect(rejected.post).toHaveBeenCalledTimes(1);

    const session = manager({ post: async (b) => answer(b, () => "REJECTED", { outcome: "REJECTED", sessionId: null, sessionStatus: null, errorCode: "attendance.occurrence_cancelled" }) });
    await session.m.init();
    await mark(session.m, uuid(11));
    await session.m.syncNow();
    const call = session.m.getSnapshot().calls[0]!;
    expect(call.state).toBe("ATTENTION");
    expect(call.lastError).toEqual({ code: "attendance.occurrence_cancelled" });
    expect(Object.keys(call.records)).toEqual([uuid(11)]); // conservé pour que l'utilisateur décide
    await session.m.syncNow();
    expect(session.post).toHaveBeenCalledTimes(1); // pas de boucle d'envoi sur un rejet
    await session.m.discard(OCC);
    expect(session.m.getSnapshot().calls).toEqual([]);
  });

  it("soumission refusée (élèves non pointés) : pointages conservés, erreur visible, pas de nouvelle tentative automatique", async () => {
    const { m, post } = manager({ post: async (b) => answer(b, () => "APPLIED", { submitted: false, sessionStatus: "OPEN", errorCode: "attendance.unmarked_students" }) });
    await m.init();
    await mark(m, uuid(11));
    await m.submit({ target: OCC, date: "2026-10-01", defaultStatus: "PRESENT" });
    const call = m.getSnapshot().calls[0]!;
    expect(call).toMatchObject({ state: "ATTENTION", submitted: false, submit: null, lastError: { code: "attendance.unmarked_students" } });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("session expirée (401) : pointages conservés, aucune reprise automatique ; autre refus : appel en attention", async () => {
    const auth = manager({ post: async () => { throw new ApiError({ code: "UNAUTHORIZED", message: "x", status: 401 }); } });
    await auth.m.init();
    await mark(auth.m, uuid(11));
    expect((await auth.m.syncNow()).failure).toBe("auth");
    expect(auth.m.getSnapshot().nextRetryAt).toBeNull();
    expect(auth.m.getSnapshot().pending.records).toBe(1);
    expect(auth.m.getSnapshot().calls[0]!.state).toBe("PENDING");

    const forbidden = manager({ post: async () => { throw new ApiError({ code: "FEATURE_DISABLED", message: "x", status: 403 }); } });
    await forbidden.m.init();
    await mark(forbidden.m, uuid(11));
    await forbidden.m.syncNow();
    expect(forbidden.m.getSnapshot().calls[0]).toMatchObject({ state: "ATTENTION", lastError: { code: "FEATURE_DISABLED" } });
  });

  it("réponse sans les séances envoyées : arrêt sans boucle infinie", async () => {
    const { m, post } = manager({ post: async (b) => ({ ...answer(b), sessions: [] }) });
    await m.init();
    await mark(m, uuid(11));
    const summary = await m.syncNow();
    expect(summary.failure).toBe("server");
    expect(post).toHaveBeenCalledTimes(1);
    expect(m.getSnapshot().pending.records).toBe(1);
  });

  it("rechargement : la file persistée est relue et l'envoi reprend sans doublon d'identifiants", async () => {
    const ctx = setup();
    const sent: AttendanceSyncBatch[] = [];
    const build = (online: boolean) =>
      new OutboxManager({
        openDb: ctx.open,
        owner: () => ctx.state.owner,
        post: async (b) => {
          sent.push(b);
          return answer(b);
        },
        isOnline: () => online,
        now: () => ctx.state.now,
        uuid: ctx.next,
        setTimer: () => 1,
        clearTimer: () => undefined,
      });
    const offline = build(false);
    await offline.init();
    await mark(offline, uuid(11));
    expect(sent).toHaveLength(0);

    const reloaded = build(true);
    await reloaded.init();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.sessions[0]!.records[0]).toMatchObject({ studentId: uuid(11), statusCode: "ABSENT" });
    await vi.waitFor(() => expect(reloaded.getSnapshot().calls[0]?.state).toBe("DONE"));
  });

  it("deux appels distincts (séance et journalier) partent dans le même lot", async () => {
    const { m, post } = manager();
    await m.init();
    await mark(m, uuid(11));
    await m.mark({ target: DAILY, date: "2026-10-01", studentId: uuid(21), statusCode: "ABSENT" });
    await m.syncNow();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]![0].sessions).toHaveLength(2);
    expect(m.getSnapshot().calls.map((c) => c.key).sort()).toEqual([callKey(DAILY), callKey(OCC)].sort());
  });
});

describe("mémoire", () => {
  it("le repli en mémoire clone les valeurs (pas de partage d'état)", async () => {
    const db = createMemoryDb();
    const store = db.store<{ key: string; list: number[] }>("meta");
    const value = { key: "k", list: [1] };
    await store.put(value);
    value.list.push(2);
    expect((await store.get("k"))!.list).toEqual([1]);
  });
});
