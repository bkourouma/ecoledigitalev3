/**
 * Constat, validation et heures payables, verrous de paie (spec 017 US5, critères de sortie 4) :
 * parcours bout en bout « appel ⇒ HELD ⇒ validation ⇒ listPayableHours ⇒ lockHours ⇒ modification refusée ⇒
 * releaseHoursLock rouvre » ; « une heure ne se paie qu'une fois » entre deux périodes qui se chevauchent,
 * y compris sous concurrence ; parité avec le prédicat TypeScript.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "@ecoledigitale/kernel";
import { cancelOccurrence, changeOccurrenceRoom, createAccountingOccurrence, createOccurrence, holdOccurrence, rescheduleOccurrence, setOccurrenceStaff, substituteStaff } from "../../application/occurrences";
import { updateSchedulingSettings, upsertConflictPolicy } from "../../application/reference";
import { findValidatedOverlaps, listPayableHours, lockHours, releaseHoursLock, setPaidMinutes, unvalidateOccurrence, validateOccurrence, validateOccurrencesBatch } from "../../application/validation";
import { getOccurrence, getOccurrenceHistory, listPendingValidation, listUnrealizedOccurrences } from "../../application/views";
import { isPayable, paidMinutesOf } from "../../domain/occurrence-rules";
import { adminRows, createSchedulingTestDb, describeIntegration, type SchedulingTestDb } from "../support/db";
import { D, addClass, addRoom, addStaff, createWorld, expectErr, outboxTypes, unwrap, type World } from "../support/world";

describeIntegration("heures payables, validation et verrous de paie", () => {
  let db: SchedulingTestDb;
  let w: World;
  const accountant = newId();
  const accountantCtx = (): ReturnType<World["ctxOf"]> => w.ctxOf(accountant);

  /** Séance de cours réalisée (constatée par l'appel), non validée. */
  async function heldLesson(teacher: string, date: string, start = "08:00", end = "10:00", extraStaff: Array<{ staffId: string; role?: "SUPERVISOR" | "CO_TEACHER" }> = []) {
    const c = addClass(w, `Classe ${date} ${start} ${teacher.slice(0, 4)}`);
    const occ = unwrap(
      await createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: c.classroomId, curriculumNodeId: c.nodeId, date, startTime: start, endTime: end, staff: [{ staffId: teacher }, ...extraStaff] }),
    ).occurrence;
    unwrap(await holdOccurrence(w.deps, w.ctx, { occurrenceId: occ.id, source: "ATTENDANCE" }));
    return occ;
  }
  const validated = async (teacher: string, date: string, start?: string, end?: string) => {
    const occ = await heldLesson(teacher, date, start, end);
    unwrap(await validateOccurrence(w.deps, accountantCtx(), { occurrenceId: occ.id }));
    return occ;
  };

  beforeAll(async () => {
    db = await createSchedulingTestDb(24);
    w = await createWorld({ db });
  });
  afterAll(async () => {
    await db.drop();
  });

  it("parcours bout en bout : appel ⇒ HELD ⇒ validation ⇒ heures payables ⇒ verrou ⇒ séance gelée ⇒ déverrouillage rouvre", async () => {
    const t = addStaff(w, "Prof Parcours");
    const c = addClass(w, "Parcours A");
    const room = await addRoom(w, "PARC", 30);
    const occ = unwrap(
      await createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: c.classroomId, curriculumNodeId: c.nodeId, roomId: room.id, date: D(5), startTime: "08:00", endTime: "10:00", staff: [{ staffId: t }] }),
    ).occurrence;
    const range = { from: D(1), to: D(31), staffIds: [t] };

    expect(unwrap(await listPayableHours(w.deps, w.ctx, range))).toEqual([]); // planifiée seulement
    await expectErr(validateOccurrence(w.deps, accountantCtx(), { occurrenceId: occ.id }), "scheduling.not_validatable"); // pas encore constatée
    unwrap(await holdOccurrence(w.deps, w.ctx, { occurrenceId: occ.id, source: "ATTENDANCE" }));
    expect(unwrap(await listPayableHours(w.deps, w.ctx, range))).toEqual([]); // constatée, pas validée
    const v = unwrap(await validateOccurrence(w.deps, accountantCtx(), { occurrenceId: occ.id }));
    expect(v).toEqual({ occurrenceId: occ.id, alreadyValidated: false });

    const lines = unwrap(await listPayableHours(w.deps, w.ctx, range));
    expect(lines).toEqual([{ occurrenceId: occ.id, staffId: t, occursOn: D(5), minutes: 120, kind: "LESSON", classroomId: c.classroomId, nodeId: c.nodeId, offeringId: null, title: null, locked: false, lockRef: null }]);

    const lockRef = newId();
    expect(unwrap(await lockHours(w.deps, w.ctx, { lines: [{ occurrenceId: occ.id, staffId: t }], lockRef }))).toEqual({ locked: 1, alreadyLockedSameRef: 0 });
    expect(unwrap(await listPayableHours(w.deps, w.ctx, range))[0]).toMatchObject({ locked: true, lockRef });

    // La séance est INTÉGRALEMENT gelée (horaire, salle, intervenants, statut, validation, durée payée).
    const frozen = "scheduling.hours_locked";
    await expectErr(rescheduleOccurrence(w.deps, w.ctx, { occurrenceId: occ.id, date: D(5), startTime: "09:00", endTime: "11:00" }), frozen);
    await expectErr(changeOccurrenceRoom(w.deps, w.ctx, { occurrenceId: occ.id, roomId: null }), frozen);
    await expectErr(setOccurrenceStaff(w.deps, w.ctx, { occurrenceId: occ.id, staff: [] }), frozen);
    await expectErr(substituteStaff(w.deps, w.ctx, { occurrenceId: occ.id, originalStaffId: t, substituteStaffId: addStaff(w, "Remplaçant tardif"), reason: "Test" }), frozen);
    await expectErr(cancelOccurrence(w.deps, w.ctx, { occurrenceId: occ.id, reason: "Erreur" }), frozen);
    await expectErr(unvalidateOccurrence(w.deps, accountantCtx(), { occurrenceId: occ.id, reason: "Erreur" }), frozen);
    await expectErr(setPaidMinutes(w.deps, accountantCtx(), { occurrenceId: occ.id, staffId: t, minutes: 60 }), frozen);
    // La base le garantit aussi pour un écrivain qui contourne les cas d'usage (déclencheurs de gel).
    await expect(db.admin.query(`UPDATE scheduling.session_occurrences SET ends_at = ends_at + interval '1 hour' WHERE id = $1`, [occ.id])).rejects.toThrow(/scheduling\.occurrence_(validated|locked)/);
    await expect(db.admin.query(`DELETE FROM scheduling.occurrence_staff WHERE occurrence_id = $1`, [occ.id])).rejects.toThrow(/scheduling\.hours_locked/);

    // La paie annule/recalcule son bulletin : elle libère, la séance se rouvre.
    expect(unwrap(await releaseHoursLock(w.deps, w.ctx, { lockRef }))).toEqual({ released: 1 });
    expect(unwrap(await releaseHoursLock(w.deps, w.ctx, { lockRef }))).toEqual({ released: 0 }); // idempotent
    expect(unwrap(await listPayableHours(w.deps, w.ctx, range))[0]).toMatchObject({ locked: false, lockRef: null });
    unwrap(await unvalidateOccurrence(w.deps, accountantCtx(), { occurrenceId: occ.id, reason: "Heures contestées" }));
    expect(unwrap(await listPayableHours(w.deps, w.ctx, range))).toEqual([]);
    const moved = unwrap(await rescheduleOccurrence(w.deps, w.ctx, { occurrenceId: occ.id, date: D(5), startTime: "09:00", endTime: "11:00" })).occurrence;
    expect(moved.startsAt.toISOString()).toBe("2026-10-05T09:00:00.000Z");

    // Journal complet et événements.
    const kinds = unwrap(await getOccurrenceHistory(w.deps, w.ctx, { occurrenceId: occ.id })).map((h) => h.kind);
    expect(kinds).toEqual(expect.arrayContaining(["CREATED", "HELD", "VALIDATED", "LOCKED", "UNLOCKED", "UNVALIDATED", "RESCHEDULED"]));
    expect(await outboxTypes(w, occ.id)).toEqual(expect.arrayContaining(["scheduling.occurrence.validated", "scheduling.occurrence.unvalidated"]));
    expect(await outboxTypes(w, lockRef)).toEqual(["scheduling.hours.locked", "scheduling.hours.released"]);
    const sensitive = w.audit.entries.filter((e) => e.entry.sensitive).map((e) => e.entry.action);
    expect(sensitive).toEqual(expect.arrayContaining(["scheduling.occurrence.validated", "scheduling.occurrence.unvalidated", "scheduling.hours.locked", "scheduling.hours.released"]));
  });

  describe("une heure ne se paie qu'une fois (périodes qui se chevauchent)", () => {
    it("une ligne déjà verrouillée sous un AUTRE lockRef fait échouer TOUT le lot ; rien n'est verrouillé à moitié", async () => {
      const t = addStaff(w, "Prof Double");
      const [x, y, z] = [await validated(t, D(6), "08:00", "09:00"), await validated(t, D(6), "09:00", "10:00"), await validated(t, D(6), "10:00", "11:00")];
      const refA = newId();
      const refB = newId();
      expect(unwrap(await lockHours(w.deps, w.ctx, { lines: [x, y].map((o) => ({ occurrenceId: o.id, staffId: t })), lockRef: refA })).locked).toBe(2);
      const err = await expectErr(lockHours(w.deps, w.ctx, { lines: [y, z].map((o) => ({ occurrenceId: o.id, staffId: t })), lockRef: refB }), "scheduling.hours_already_locked");
      expect(err.httpStatus).toBe(409);
      expect((err.details as { lines: Array<{ occurrenceId: string; lockRef: string }> }).lines).toEqual([{ occurrenceId: y.id, staffId: t, lockRef: refA }]);
      const lines = unwrap(await listPayableHours(w.deps, w.ctx, { from: D(6), to: D(6), staffIds: [t] }));
      expect(lines.find((l) => l.occurrenceId === z.id)).toMatchObject({ locked: false, lockRef: null }); // Z n'a PAS été verrouillée
      expect(lines.filter((l) => l.lockRef === refA)).toHaveLength(2);
      // Rejeu idempotent du MÊME bulletin ; puis, après libération du premier, le second passe.
      expect(unwrap(await lockHours(w.deps, w.ctx, { lines: [x, y].map((o) => ({ occurrenceId: o.id, staffId: t })), lockRef: refA }))).toEqual({ locked: 0, alreadyLockedSameRef: 2 });
      unwrap(await releaseHoursLock(w.deps, w.ctx, { lockRef: refA }));
      expect(unwrap(await lockHours(w.deps, w.ctx, { lines: [y, z].map((o) => ({ occurrenceId: o.id, staffId: t })), lockRef: refB })).locked).toBe(2);
    });

    it("deux bulletins concurrents qui réclament les mêmes heures : exactement un gagne, jamais de double paiement", async () => {
      const t = addStaff(w, "Prof Concurrent");
      const occs = await Promise.all(["08:00", "09:00", "10:00", "11:00"].map((s, i) => validated(t, D(7), s, `${String(9 + i).padStart(2, "0")}:00`)));
      const lines = occs.map((o) => ({ occurrenceId: o.id, staffId: t }));
      const refs = Array.from({ length: 5 }, () => newId());
      const results = await Promise.all(refs.map((lockRef, i) => lockHours(w.deps, w.ctx, { lines: i % 2 === 0 ? lines : [...lines].reverse(), lockRef })));
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      for (const r of results.filter((x) => !x.ok)) expect(!r.ok && r.error.code).toBe("scheduling.hours_already_locked");
      const owners = await adminRows<{ lock_ref: string }>(db, "SELECT DISTINCT lock_ref FROM scheduling.occurrence_staff WHERE staff_id = $1 AND lock_ref IS NOT NULL", [t]);
      expect(owners).toHaveLength(1);
      // Des périodes qui se chevauchent avec des lignes partiellement communes : un seul bulletin garde chaque heure.
      const t2 = addStaff(w, "Prof Chevauchement");
      const o2 = await Promise.all(["08:00", "09:00", "10:00"].map((s, i) => validated(t2, D(8), s, `${String(9 + i).padStart(2, "0")}:00`)));
      const [a, b, c] = o2.map((o) => ({ occurrenceId: o.id, staffId: t2 }));
      const res = await Promise.all([
        lockHours(w.deps, w.ctx, { lines: [a!, b!], lockRef: newId() }),
        lockHours(w.deps, w.ctx, { lines: [b!, c!], lockRef: newId() }),
      ]);
      expect(res.filter((r) => r.ok)).toHaveLength(1);
      const perLine = await adminRows<{ n: string }>(db, "SELECT count(*)::text AS n FROM scheduling.occurrence_staff WHERE staff_id = $1 AND lock_ref IS NOT NULL", [t2]);
      expect(Number(perLine[0]?.n)).toBe(2);
    });

    it("on ne verrouille que des heures payables et existantes", async () => {
      const t = addStaff(w, "Prof Non Payable");
      const planned = unwrap(await createOccurrence(w.deps, w.ctx, { kind: "MEETING", date: D(9), startTime: "08:00", endTime: "09:00", staff: [{ staffId: t }] })).occurrence;
      const held = await heldLesson(t, D(9), "09:00", "10:00"); // constatée, non validée
      const ref = newId();
      const e1 = await expectErr(lockHours(w.deps, w.ctx, { lines: [{ occurrenceId: planned.id, staffId: t }], lockRef: ref }), "scheduling.hours_not_payable");
      expect(e1.httpStatus).toBe(409);
      await expectErr(lockHours(w.deps, w.ctx, { lines: [{ occurrenceId: held.id, staffId: t }], lockRef: ref }), "scheduling.hours_not_payable");
      await expectErr(lockHours(w.deps, w.ctx, { lines: [{ occurrenceId: held.id, staffId: newId() }], lockRef: ref }), "scheduling.not_found");
      await expectErr(lockHours(w.deps, w.ctx, { lines: [], lockRef: ref }), "VALIDATION_FAILED");
      const n = await adminRows<{ n: string }>(db, "SELECT count(*)::text AS n FROM scheduling.occurrence_staff WHERE lock_ref = $1", [ref]);
      expect(n[0]?.n).toBe("0");
    });
  });

  describe("validation", () => {
    it("exige une séance constatée avec un intervenant rémunéré ; séance annulée refusée ; second validateur : idempotent", async () => {
      const t = addStaff(w, "Prof Valid");
      const c = addClass(w, "Valid A");
      const planned = unwrap(await createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: c.classroomId, curriculumNodeId: c.nodeId, date: D(10), startTime: "08:00", endTime: "09:00", staff: [{ staffId: t }] })).occurrence;
      expect((await expectErr(validateOccurrence(w.deps, accountantCtx(), { occurrenceId: planned.id }), "scheduling.not_validatable")).details).toMatchObject({ blocker: "NOT_HELD" });
      unwrap(await cancelOccurrence(w.deps, w.ctx, { occurrenceId: planned.id, reason: "Annulée" }));
      expect((await expectErr(validateOccurrence(w.deps, accountantCtx(), { occurrenceId: planned.id }), "scheduling.not_validatable")).details).toMatchObject({ blocker: "CANCELLED" });
      // Sans intervenant : valide pédagogiquement, non payable, validation refusée.
      const noStaff = unwrap(await createOccurrence(w.deps, w.ctx, { kind: "MEETING", date: D(10), startTime: "10:00", endTime: "11:00" })).occurrence;
      unwrap(await holdOccurrence(w.deps, w.ctx, { occurrenceId: noStaff.id, source: "ATTENDANCE" }));
      expect((await expectErr(validateOccurrence(w.deps, accountantCtx(), { occurrenceId: noStaff.id }), "scheduling.not_validatable")).details).toMatchObject({ blocker: "NO_PAID_STAFF" });
      // Deux validateurs simultanés : un seul valide, l'autre reçoit `alreadyValidated`.
      const ok = await heldLesson(t, D(10), "13:00", "14:00");
      const [r1, r2] = await Promise.all([validateOccurrence(w.deps, w.ctxOf(newId()), { occurrenceId: ok.id }), validateOccurrence(w.deps, w.ctxOf(newId()), { occurrenceId: ok.id })]);
      const flags = [unwrap(r1).alreadyValidated, unwrap(r2).alreadyValidated].sort();
      expect(flags).toEqual([false, true]);
      expect((await outboxTypes(w, ok.id)).filter((x) => x === "scheduling.occurrence.validated")).toHaveLength(1);
    });

    it("lot PARTIEL : les éligibles passent, les autres reviennent avec leur motif ; limite de 500", async () => {
      const t = addStaff(w, "Prof Lot");
      const good = await Promise.all(["08:00", "09:00", "10:00"].map((s, i) => heldLesson(t, D(12), s, `${String(9 + i).padStart(2, "0")}:00`)));
      const c = addClass(w, "Lot A");
      const planned = unwrap(await createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: c.classroomId, curriculumNodeId: c.nodeId, date: D(12), startTime: "15:00", endTime: "16:00", staff: [{ staffId: t }] })).occurrence;
      const noStaff = unwrap(await createOccurrence(w.deps, w.ctx, { kind: "MEETING", date: D(12), startTime: "16:00", endTime: "17:00" })).occurrence;
      unwrap(await holdOccurrence(w.deps, w.ctx, { occurrenceId: noStaff.id, source: "ATTENDANCE" }));
      const missing = newId();
      const already = good[0]!;
      unwrap(await validateOccurrence(w.deps, accountantCtx(), { occurrenceId: already.id }));
      const r = unwrap(await validateOccurrencesBatch(w.deps, accountantCtx(), { occurrenceIds: [...good.map((g) => g.id), planned.id, noStaff.id, missing] }));
      expect(r.validated.sort()).toEqual([good[1]!.id, good[2]!.id].sort());
      expect(r.alreadyValidated).toEqual([already.id]);
      expect(r.rejected.map((x) => [x.id, x.reason]).sort()).toEqual(
        [
          [planned.id, "NOT_HELD"],
          [noStaff.id, "NO_PAID_STAFF"],
          [missing, "NOT_FOUND"],
        ].sort(),
      );
      expect(r.rejected.every((x) => x.message.length > 0)).toBe(true);
      await expectErr(validateOccurrencesBatch(w.deps, accountantCtx(), { occurrenceIds: Array.from({ length: 501 }, () => newId()) }), "VALIDATION_FAILED");
      await expectErr(validateOccurrencesBatch(w.deps, accountantCtx(), { occurrenceIds: [] }), "VALIDATION_FAILED");
    });

    it("« quatre yeux » : le créateur d'une séance comptable ne la valide pas, sauf réglage contraire de l'établissement", async () => {
      const t = addStaff(w, "Vacataire 4 yeux");
      const creator = w.ctxOf(newId());
      const other = w.ctxOf(newId());
      w.clock.set("2026-10-20T00:00:00.000Z");
      try {
        const acc = unwrap(await createAccountingOccurrence(w.deps, creator, { staffId: t, date: D(13), minutes: 120 })).occurrence;
        const e = await expectErr(validateOccurrence(w.deps, creator, { occurrenceId: acc.id }), "scheduling.self_validation_forbidden");
        expect(e.httpStatus).toBe(403);
        unwrap(await validateOccurrence(w.deps, other, { occurrenceId: acc.id }));
        // Réglable : l'établissement peut autoriser le cumul.
        unwrap(await updateSchedulingSettings(w.deps, w.ctx, { institutionId: w.institutionId, patch: { allowSelfValidation: true } }));
        const acc2 = unwrap(await createAccountingOccurrence(w.deps, creator, { staffId: t, date: D(14), minutes: 60 })).occurrence;
        unwrap(await validateOccurrence(w.deps, creator, { occurrenceId: acc2.id }));
        expect(unwrap(await listPayableHours(w.deps, w.ctx, { from: D(13), to: D(14), staffIds: [t] })).map((l) => l.minutes)).toEqual([120, 60]);
      } finally {
        unwrap(await updateSchedulingSettings(w.deps, w.ctx, { institutionId: w.institutionId, patch: { allowSelfValidation: false } }));
        w.clock.set("2026-10-01T07:00:00.000Z");
      }
    });
  });

  describe("durée payée", () => {
    it("dérogation avant validation : prioritaire, bornée, tracée, retirable ; refusée après validation", async () => {
      const t = addStaff(w, "Prof Durée");
      const occ = await heldLesson(t, D(15), "08:00", "10:00");
      await expectErr(setPaidMinutes(w.deps, accountantCtx(), { occurrenceId: occ.id, staffId: t, minutes: 0 }), "VALIDATION_FAILED");
      await expectErr(setPaidMinutes(w.deps, accountantCtx(), { occurrenceId: occ.id, staffId: t, minutes: 1441 }), "VALIDATION_FAILED");
      await expectErr(setPaidMinutes(w.deps, accountantCtx(), { occurrenceId: occ.id, staffId: newId(), minutes: 30 }), "scheduling.not_found");
      const row = unwrap(await setPaidMinutes(w.deps, accountantCtx(), { occurrenceId: occ.id, staffId: t, minutes: 90, reason: "Retard de 30 min" }));
      expect(row).toMatchObject({ paidMinutes: 90, paidMinutesBy: accountant });
      unwrap(await validateOccurrence(w.deps, accountantCtx(), { occurrenceId: occ.id }));
      expect(unwrap(await listPayableHours(w.deps, w.ctx, { from: D(15), to: D(15), staffIds: [t] }))[0]?.minutes).toBe(90);
      // Après validation : refus (le legacy l'autorisait) — on dévalide d'abord.
      await expectErr(setPaidMinutes(w.deps, accountantCtx(), { occurrenceId: occ.id, staffId: t, minutes: 100 }), "scheduling.occurrence_validated");
      unwrap(await unvalidateOccurrence(w.deps, accountantCtx(), { occurrenceId: occ.id, reason: "Correction" }));
      const cleared = unwrap(await setPaidMinutes(w.deps, accountantCtx(), { occurrenceId: occ.id, staffId: t, minutes: null }));
      expect(cleared.paidMinutes).toBeNull();
      unwrap(await validateOccurrence(w.deps, accountantCtx(), { occurrenceId: occ.id }));
      expect(unwrap(await listPayableHours(w.deps, w.ctx, { from: D(15), to: D(15), staffIds: [t] }))[0]?.minutes).toBe(120);
      const audit = w.audit.entries.find((e) => e.entry.action === "scheduling.occurrence.paid_minutes_set" && e.entry.resourceId === occ.id);
      expect(audit?.entry).toMatchObject({ sensitive: true, before: { minutes: null }, after: { minutes: 90 } });
      expect(unwrap(await getOccurrenceHistory(w.deps, w.ctx, { occurrenceId: occ.id })).map((h) => h.kind)).toContain("PAID_MINUTES");
    });
  });

  describe("bénéficiaire de la paie = intervenant réel", () => {
    it("le remplaçant est payé, pas le titulaire ; un surveillant n'est payé que si l'établissement le décide", async () => {
      const titular = addStaff(w, "Titulaire payé");
      const sub = addStaff(w, "Remplaçant payé");
      const sup = addStaff(w, "Surveillant");
      const c = addClass(w, "Réel A");
      const occ = unwrap(
        await createOccurrence(w.deps, w.ctx, { kind: "EXAM", classroomId: c.classroomId, curriculumNodeId: c.nodeId, date: D(16), startTime: "08:00", endTime: "10:00", staff: [{ staffId: titular }, { staffId: sup, role: "SUPERVISOR" }] }),
      ).occurrence;
      unwrap(await substituteStaff(w.deps, w.ctx, { occurrenceId: occ.id, originalStaffId: titular, substituteStaffId: sub, reason: "Maladie" }));
      unwrap(await holdOccurrence(w.deps, w.ctx, { occurrenceId: occ.id, source: "ATTENDANCE" }));
      unwrap(await validateOccurrence(w.deps, accountantCtx(), { occurrenceId: occ.id }));
      const lines = unwrap(await listPayableHours(w.deps, w.ctx, { from: D(16), to: D(16) }));
      expect(lines.map((l) => l.staffId)).toEqual([sub]); // ni le titulaire (retiré) ni le surveillant (non rémunéré)
      expect(lines[0]?.minutes).toBe(120);
    });
  });

  describe("parité avec le prédicat TypeScript (heures payables)", () => {
    it("pour un mélange de séances (planifiées, constatées, validées, annulées, dérogations, rôles), la fonction SQL et le prédicat TS rendent exactement les mêmes lignes", async () => {
      const staffA = addStaff(w, "Parité A");
      const staffB = addStaff(w, "Parité B");
      let seed = 42;
      const rnd = (n: number): number => {
        seed = (seed * 48271) % 2147483647;
        return seed % n;
      };
      const created: string[] = [];
      for (let i = 0; i < 70; i += 1) {
        const t = rnd(2) === 0 ? staffA : staffB;
        const date = D(17 + rnd(4));
        const start = 8 + rnd(10);
        const c = addClass(w, `Parité ${i}`);
        const created1 = await createOccurrence(w.deps, w.ctx, {
          kind: "LESSON",
          classroomId: c.classroomId,
          curriculumNodeId: c.nodeId,
          date,
          startTime: `${String(start).padStart(2, "0")}:00`,
          endTime: `${String(start).padStart(2, "0")}:${rnd(2) === 0 ? "50" : "30"}`,
          staff: [{ staffId: t }, ...(rnd(4) === 0 ? [{ staffId: addStaff(w, `Surv ${i}`), role: "SUPERVISOR" as const }] : [])],
        });
        if (!created1.ok) continue; // conflit entre tirages : ignoré
        const id = created1.value.occurrence.id;
        created.push(id);
        const stage = rnd(5);
        if (stage >= 1) unwrap(await holdOccurrence(w.deps, w.ctx, { occurrenceId: id, source: "ATTENDANCE" }));
        if (stage >= 2 && rnd(2) === 0) unwrap(await setPaidMinutes(w.deps, accountantCtx(), { occurrenceId: id, staffId: t, minutes: 15 + rnd(100) }));
        if (stage >= 3) unwrap(await validateOccurrence(w.deps, accountantCtx(), { occurrenceId: id }));
        if (stage === 0 && rnd(2) === 0) unwrap(await cancelOccurrence(w.deps, w.ctx, { occurrenceId: id, reason: "Annulée" }));
      }
      expect(created.length).toBeGreaterThan(20);
      const fromSql = unwrap(await listPayableHours(w.deps, w.ctx, { from: D(17), to: D(20) })).map((l) => `${l.occurrenceId}|${l.staffId}|${l.minutes}`).sort();
      const fromTs: string[] = [];
      for (const id of created) {
        const o = unwrap(await getOccurrence(w.deps, w.ctx, { occurrenceId: id }));
        for (const s of o.staff) if (isPayable(o, s)) fromTs.push(`${o.id}|${s.staffId}|${paidMinutesOf(o, s)}`);
      }
      expect(fromSql).toEqual(fromTs.sort());
      expect(fromSql.length).toBeGreaterThan(0);
    });
  });

  describe("files de travail et rapprochements", () => {
    it("séances à valider : passé d'abord (du plus récent au plus ancien) puis futur ; séances non constatées ; chevauchements validés (information)", async () => {
      const t = addStaff(w, "Prof Files");
      const policyBefore = unwrap(await upsertConflictPolicy(w.deps, w.ctx, { institutionId: w.institutionId, resourceKind: "STAFF", mode: "WARN" }));
      expect(policyBefore.STAFF).toBe("WARN");
      try {
        w.clock.set("2026-11-10T09:00:00.000Z");
        const d1 = await heldLesson(t, "2026-11-02", "08:00", "10:00");
        const d2 = await heldLesson(t, "2026-11-04", "08:00", "10:00");
        const future = await heldLesson(t, "2026-11-20", "08:00", "10:00"); // constatée par anticipation (appel soumis en avance)
        const c = addClass(w, "Files A");
        const unrealized = unwrap(await createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: c.classroomId, curriculumNodeId: c.nodeId, date: "2026-11-03", startTime: "08:00", endTime: "09:00", staff: [{ staffId: addStaff(w, "Absent du suivi") }] })).occurrence;
        const pending = unwrap(await listPendingValidation(w.deps, w.ctx, { staffId: t }));
        expect(pending.items.map((o) => o.id)).toEqual([d2.id, d1.id, future.id]);

        const un = unwrap(await listUnrealizedOccurrences(w.deps, w.ctx, { from: "2026-11-01", to: "2026-11-09" }));
        expect(un.items.map((o) => o.id)).toContain(unrealized.id);
        expect(un.items.every((o) => o.status === "PLANNED")).toBe(true);

        // Deux séances validées du même enseignant qui se chevauchent (politique WARN) : signalées pour la paie.
        const overlapA = await heldLesson(t, "2026-11-05", "08:00", "10:00");
        const overlapB = await heldLesson(t, "2026-11-05", "09:00", "11:00");
        unwrap(await validateOccurrence(w.deps, accountantCtx(), { occurrenceId: overlapA.id }));
        unwrap(await validateOccurrence(w.deps, accountantCtx(), { occurrenceId: overlapB.id }));
        const overlaps = unwrap(await findValidatedOverlaps(w.deps, w.ctx, { from: "2026-11-01", to: "2026-11-30", staffIds: [t] }));
        expect(overlaps).toHaveLength(1);
        expect(overlaps[0]).toMatchObject({ staffId: t });
        expect([overlaps[0]?.occurrenceA, overlaps[0]?.occurrenceB].sort()).toEqual([overlapA.id, overlapB.id].sort());
        expect((overlaps[0]?.overlapEnd.getTime() ?? 0) - (overlaps[0]?.overlapStart.getTime() ?? 0)).toBe(3_600_000);
      } finally {
        unwrap(await upsertConflictPolicy(w.deps, w.ctx, { institutionId: w.institutionId, resourceKind: "STAFF", mode: "BLOCK" }));
        w.clock.set("2026-10-01T07:00:00.000Z");
      }
    });
  });
});
