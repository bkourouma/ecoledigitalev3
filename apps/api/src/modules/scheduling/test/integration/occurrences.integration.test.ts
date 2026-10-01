/**
 * Cycle de vie d'une séance et DÉTECTION DE CONFLITS (spec 017 US1, US3, US4) sur une base réelle :
 * enseignant, classe, offre à la carte, salle, équipement ; politique BLOCK/WARN ; dépassement motivé ;
 * double réservation concurrente refusée ; constat, annulation, restauration, remplacement, déclaration.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "@ecoledigitale/kernel";
import { cancelOccurrence, changeOccurrenceRoom, createAccountingOccurrence, createOccurrence, holdOccurrence, overrideConflict, rescheduleOccurrence, restoreOccurrence, setOccurrenceStaff, substituteStaff, unholdOccurrence } from "../../application/occurrences";
import { previewConflicts } from "../../application/aids";
import { setRoomStatus, updateSchedulingSettings, upsertConflictPolicy } from "../../application/reference";
import { getOccurrence, getOccurrenceHistory, listOccurrences, listPendingReplacements } from "../../application/views";
import { adminOne, adminRows, createSchedulingTestDb, describeIntegration, type SchedulingTestDb } from "../support/db";
import { D, addClass, addEquipment, addRoom, addStaff, createWorld, expectErr, outboxTypes, unwrap, type ClassFixture, type World } from "../support/world";

describeIntegration("séances : conflits imposés, cycle de vie, remplacement", () => {
  let db: SchedulingTestDb;
  let w: World;
  let cls: ClassFixture;
  let teacher: string;

  const lesson = (over: Record<string, unknown> = {}) =>
    createOccurrence(w.deps, w.ctx, {
      kind: "LESSON",
      classroomId: cls.classroomId,
      curriculumNodeId: cls.nodeId,
      date: D(5),
      startTime: "08:00",
      endTime: "10:00",
      staff: [{ staffId: teacher, role: "LEAD" }],
      ...over,
    } as Parameters<typeof createOccurrence>[2]);

  beforeAll(async () => {
    db = await createSchedulingTestDb(24);
    w = await createWorld({ db });
    cls = addClass(w, "6e A", { headcount: 30 });
    teacher = addStaff(w, "M. Koné");
    w.people.assign(teacher, cls.classroomId);
  });
  afterAll(async () => {
    await db.drop();
  });

  it("crée un cours : séance PLANNED, intervenant payé, réservations dérivées, journal et événement", async () => {
    const { occurrence, warnings } = unwrap(await lesson({ date: D(5), title: "Algèbre" }));
    expect(occurrence).toMatchObject({ kind: "LESSON", status: "PLANNED", title: "Algèbre", occursOn: D(5), origin: "AD_HOC", claimsClassroom: true });
    expect(occurrence.startsAt.toISOString()).toBe("2026-10-05T08:00:00.000Z");
    expect(occurrence.staff).toHaveLength(1);
    expect(occurrence.staff[0]).toMatchObject({ staffId: teacher, role: "LEAD", isPaidRole: true });
    expect(warnings).toEqual([]);
    const claims = await adminRows<{ resource_kind: string; exclusive: boolean }>(db, "SELECT resource_kind, exclusive FROM scheduling.resource_claims WHERE occurrence_id = $1 ORDER BY resource_kind", [occurrence.id]);
    expect(claims).toEqual([
      { resource_kind: "CLASSROOM", exclusive: true },
      { resource_kind: "STAFF", exclusive: true },
    ]);
    const history = unwrap(await getOccurrenceHistory(w.deps, w.ctx, { occurrenceId: occurrence.id }));
    expect(history.map((h) => h.kind)).toEqual(["CREATED", "STAFF_CHANGED"]);
    expect(await outboxTypes(w, occurrence.id)).toContain("scheduling.occurrence.created");
  });

  describe("détection de conflits, expliquée avant l'écriture et imposée à l'écriture", () => {
    it("enseignant déjà occupé → 409 scheduling.conflict_detected, message clair, séance en conflit désignée ; bout à bout accepté", async () => {
      const first = unwrap(await lesson({ date: D(6), startTime: "08:00", endTime: "10:00" })).occurrence;
      const other = addClass(w, "5e B");
      const err = await expectErr(
        createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: other.classroomId, curriculumNodeId: other.nodeId, date: D(6), startTime: "09:00", endTime: "11:00", staff: [{ staffId: teacher }] }),
        "scheduling.conflict_detected",
      );
      expect(err.httpStatus).toBe(409);
      expect(err.message).toBe("M. Koné est déjà occupé(e) le 06/10/2026 de 08:00 à 10:00.");
      expect((err.details as { conflicts: Array<{ with: { occurrenceId: string } }> }).conflicts[0]?.with.occurrenceId).toBe(first.id);
      // Aucune trace de la tentative refusée.
      const n = await adminOne<{ n: string }>(db, "SELECT count(*)::text AS n FROM scheduling.session_occurrences WHERE classroom_id = $1", [other.classroomId]);
      expect(n.n).toBe("0");
      // Bout à bout : 10:00-12:00 accepté ; deux classes différentes, le même enseignant qui enchaîne.
      unwrap(await createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: other.classroomId, curriculumNodeId: other.nodeId, date: D(6), startTime: "10:00", endTime: "12:00", staff: [{ staffId: teacher }] }));
    });

    it("classe (cohorte) déjà occupée par un autre enseignant", async () => {
      unwrap(await lesson({ date: D(7), startTime: "08:00", endTime: "10:00" }));
      const t2 = addStaff(w, "Mme Traoré");
      const err = await expectErr(lesson({ date: D(7), startTime: "09:00", endTime: "11:00", staff: [{ staffId: t2 }] }), "scheduling.conflict_detected");
      expect(err.message).toContain("La classe 6e A a déjà une séance");
    });

    it("salle déjà réservée, y compris par une réservation de salle sans classe ; une autre salle est libre", async () => {
      const room = await addRoom(w, "A1", 40);
      const room2 = await addRoom(w, "A2", 40);
      unwrap(await createOccurrence(w.deps, w.ctx, { kind: "RESERVATION", roomId: room.id, title: "Réunion parents", date: D(8), startTime: "14:00", endTime: "16:00" }));
      const t2 = addStaff(w, "M. Diallo");
      const c2 = addClass(w, "4e C");
      const err = await expectErr(
        createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: c2.classroomId, curriculumNodeId: c2.nodeId, roomId: room.id, date: D(8), startTime: "15:00", endTime: "17:00", staff: [{ staffId: t2 }] }),
        "scheduling.conflict_detected",
      );
      expect(err.message).toBe("La salle A1 est déjà réservée le 08/10/2026 de 14:00 à 16:00 (« Réunion parents »).");
      unwrap(await createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: c2.classroomId, curriculumNodeId: c2.nodeId, roomId: room2.id, date: D(8), startTime: "15:00", endTime: "17:00", staff: [{ staffId: t2 }] }));
    });

    it("conflits que le legacy ignorait : enseignant partagé entre un cours et un examen / une réunion", async () => {
      const t = addStaff(w, "M. Bamba");
      unwrap(await createOccurrence(w.deps, w.ctx, { kind: "MEETING", title: "Conseil", date: D(9), startTime: "08:00", endTime: "09:30", staff: [{ staffId: t }] }));
      await expectErr(
        createOccurrence(w.deps, w.ctx, { kind: "EXAM", classroomId: cls.classroomId, curriculumNodeId: cls.nodeId, date: D(9), startTime: "09:00", endTime: "10:00", staff: [{ staffId: t, role: "SUPERVISOR" }] }),
        "scheduling.conflict_detected",
      );
    });

    it("offre à la carte : la classe n'est pas réunie (deux offres d'une même classe peuvent se chevaucher) mais une même offre ne tient pas deux séances simultanées", async () => {
      const carte1 = addClass(w, "Licence 1 — Algèbre", { aLaCarte: true });
      const carte2 = addClass(w, "Licence 1 — Algèbre", { aLaCarte: true });
      // Deux offres DISTINCTES, mêmes horaires, enseignants différents : accepté.
      const ta = addStaff(w, "Pr Aka");
      const tb = addStaff(w, "Pr Bakayoko");
      const mk = (c: ClassFixture, t: string, start = "08:00", end = "10:00") =>
        createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: c.classroomId, curriculumNodeId: c.nodeId, offeringId: c.offeringId, claimsClassroom: false, date: D(12), startTime: start, endTime: end, staff: [{ staffId: t }] });
      unwrap(await mk(carte1, ta));
      unwrap(await mk(carte2, tb));
      // Même offre, autre enseignant, chevauchement : refusé.
      const tc = addStaff(w, "Pr Coulibaly");
      const err = await expectErr(mk(carte1, tc, "09:00", "11:00"), "scheduling.conflict_detected");
      expect(err.message).toContain("cours à la carte");
    });

    it("une offre à la carte ne peut pas réserver la classe entière ; une offre fermée ou hors fenêtre n'est pas planifiable", async () => {
      const carte = addClass(w, "Master 1 — Droit", { aLaCarte: true });
      await expectErr(
        createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: carte.classroomId, curriculumNodeId: carte.nodeId, offeringId: carte.offeringId, claimsClassroom: true, date: D(13), startTime: "08:00", endTime: "09:00", staff: [{ staffId: teacher }] }),
        "VALIDATION_FAILED",
      );
      const closed = addClass(w, "Master 2 — Droit", { aLaCarte: true });
      w.academic.offerings.set(closed.offeringId, { ...(w.academic.offerings.get(closed.offeringId) as object), status: "CLOSED" } as never);
      await expectErr(
        createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: closed.classroomId, curriculumNodeId: closed.nodeId, offeringId: closed.offeringId, claimsClassroom: false, date: D(13), startTime: "08:00", endTime: "09:00", staff: [{ staffId: teacher }] }),
        "scheduling.offering_not_schedulable",
      );
      const windowed = addClass(w, "Master 3 — Droit", { aLaCarte: true });
      w.academic.offerings.set(windowed.offeringId, { ...(w.academic.offerings.get(windowed.offeringId) as object), startsOn: "2026-11-01", endsOn: "2026-11-30" } as never);
      await expectErr(
        createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: windowed.classroomId, curriculumNodeId: windowed.nodeId, offeringId: windowed.offeringId, claimsClassroom: false, date: D(13), startTime: "08:00", endTime: "09:00", staff: [{ staffId: teacher }] }),
        "scheduling.offering_not_schedulable",
      );
    });

    it("équipement : somme des quantités ≤ stock sur plages chevauchantes ; au-delà, conflit expliqué", async () => {
      const projector = await addEquipment(w, "VP", 2);
      const mk = (n: number, start: string, end: string) => {
        const c = addClass(w, `Classe E${n}`);
        const t = addStaff(w, `Ens E${n}`);
        return createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: c.classroomId, curriculumNodeId: c.nodeId, date: D(14), startTime: start, endTime: end, staff: [{ staffId: t }], equipment: [{ equipmentId: projector.id, quantity: 1 }] });
      };
      unwrap(await mk(1, "08:00", "10:00"));
      unwrap(await mk(2, "09:00", "11:00"));
      const err = await expectErr(mk(3, "09:30", "10:30"), "scheduling.conflict_detected");
      expect(err.message).toContain("Stock insuffisant");
      unwrap(await mk(4, "11:00", "12:00")); // plage libre
    });

    it("politique WARN : écriture autorisée, réservation non exclusive, avertissement renvoyé", async () => {
      unwrap(await upsertConflictPolicy(w.deps, w.ctx, { institutionId: w.institutionId, resourceKind: "STAFF", mode: "WARN" }));
      try {
        const c1 = addClass(w, "Warn 1");
        const c2 = addClass(w, "Warn 2");
        const t = addStaff(w, "M. Ouattara");
        const base = { kind: "LESSON" as const, date: D(15), startTime: "08:00", endTime: "10:00", staff: [{ staffId: t }] };
        unwrap(await createOccurrence(w.deps, w.ctx, { ...base, classroomId: c1.classroomId, curriculumNodeId: c1.nodeId }));
        const second = unwrap(await createOccurrence(w.deps, w.ctx, { ...base, classroomId: c2.classroomId, curriculumNodeId: c2.nodeId }));
        const busy = second.warnings.find((x) => x.code === "STAFF_BUSY");
        expect(busy?.severity).toBe("WARNING");
        expect(second.warnings.every((x) => x.severity === "WARNING")).toBe(true);
        const claims = await adminRows<{ exclusive: boolean }>(db, "SELECT exclusive FROM scheduling.resource_claims WHERE resource_kind = 'STAFF' AND resource_id = $1", [t]);
        expect(claims).toHaveLength(2);
        expect(claims.every((c) => !c.exclusive)).toBe(true);
      } finally {
        unwrap(await upsertConflictPolicy(w.deps, w.ctx, { institutionId: w.institutionId, resourceKind: "STAFF", mode: "BLOCK" }));
      }
      expect(w.audit.actions()).toContain("scheduling.conflict_policy.changed");
    });

    it("dépassement motivé : motif ≥ 5 caractères, séance non exclusive, journal OVERRIDE, événement et audit sensibles", async () => {
      const t = addStaff(w, "M. Yao");
      const c1 = addClass(w, "Ov 1");
      const c2 = addClass(w, "Ov 2");
      unwrap(await createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: c1.classroomId, curriculumNodeId: c1.nodeId, date: D(16), startTime: "08:00", endTime: "10:00", staff: [{ staffId: t }] }));
      const tooShort = await expectErr(
        createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: c2.classroomId, curriculumNodeId: c2.nodeId, date: D(16), startTime: "09:00", endTime: "10:00", staff: [{ staffId: t }], override: { reason: "non" } }),
        "scheduling.override_reason_required",
      );
      expect(tooShort.httpStatus).toBe(400);
      const r = unwrap(
        await createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: c2.classroomId, curriculumNodeId: c2.nodeId, date: D(16), startTime: "09:00", endTime: "10:00", staff: [{ staffId: t }], override: { reason: "Co-enseignement exceptionnel" } }),
      );
      expect(r.occurrence.conflictOverride).toBe(true);
      const kinds = unwrap(await getOccurrenceHistory(w.deps, w.ctx, { occurrenceId: r.occurrence.id })).map((h) => h.kind);
      expect(kinds).toContain("OVERRIDE");
      expect(await outboxTypes(w, r.occurrence.id)).toContain("scheduling.conflict.overridden");
      const entry = w.audit.entries.find((e) => e.entry.action === "scheduling.conflict.overridden" && e.entry.resourceId === r.occurrence.id);
      expect(entry?.entry).toMatchObject({ sensitive: true, reason: "Co-enseignement exceptionnel" });
    });

    it("overrideConflict sur une séance existante : idempotent, motif obligatoire", async () => {
      const c = addClass(w, "Ov 3");
      const t = addStaff(w, "M. Gnahoré");
      const occ = unwrap(await createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: c.classroomId, curriculumNodeId: c.nodeId, date: D(16), startTime: "14:00", endTime: "15:00", staff: [{ staffId: t }] })).occurrence;
      await expectErr(overrideConflict(w.deps, w.ctx, { occurrenceId: occ.id, reason: "ok" }), "scheduling.override_reason_required");
      const done = unwrap(await overrideConflict(w.deps, w.ctx, { occurrenceId: occ.id, reason: "Salle et enseignant partagés" }));
      expect(done.conflictOverride).toBe(true);
      unwrap(await overrideConflict(w.deps, w.ctx, { occurrenceId: occ.id, reason: "Salle et enseignant partagés" }));
      const kinds = unwrap(await getOccurrenceHistory(w.deps, w.ctx, { occurrenceId: occ.id })).filter((h) => h.kind === "OVERRIDE");
      expect(kinds).toHaveLength(1);
    });
  });

  describe("concurrence : la base arbitre", () => {
    it("8 créations simultanées du même enseignant sur la même plage : exactement une réussit, les autres reçoivent 409 conflict_detected", async () => {
      const t = addStaff(w, "M. Concurrent");
      const attempts = Array.from({ length: 8 }, (_, i) => {
        const c = addClass(w, `Conc ${i}`);
        return createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: c.classroomId, curriculumNodeId: c.nodeId, date: D(19), startTime: "08:00", endTime: "10:00", staff: [{ staffId: t }] });
      });
      const results = await Promise.all(attempts);
      const oks = results.filter((r) => r.ok);
      const errs = results.filter((r) => !r.ok);
      expect(oks).toHaveLength(1);
      expect(errs).toHaveLength(7);
      for (const e of errs) expect(!e.ok && e.error.code).toBe("scheduling.conflict_detected");
      const n = await adminOne<{ n: string }>(db, "SELECT count(*)::text AS n FROM scheduling.resource_claims WHERE resource_kind = 'STAFF' AND resource_id = $1", [t]);
      expect(n.n).toBe("1");
    });

    it("la même salle réclamée en parallèle par des enseignants et des classes différents : une seule réservation", async () => {
      const room = await addRoom(w, "CONC-R", 50);
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) => {
          const c = addClass(w, `ConcR ${i}`);
          const t = addStaff(w, `Ens ConcR ${i}`);
          return createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: c.classroomId, curriculumNodeId: c.nodeId, roomId: room.id, date: D(20), startTime: "08:00", endTime: "09:00", staff: [{ staffId: t }] });
        }),
      );
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.error.code === "scheduling.conflict_detected")).toBe(true);
    });

    it("des plages disjointes d'un même enseignant, en parallèle, réussissent toutes", async () => {
      const t = addStaff(w, "M. Parallèle");
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) => {
          const c = addClass(w, `Disj ${i}`);
          return createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: c.classroomId, curriculumNodeId: c.nodeId, date: D(21), startTime: `${String(8 + i).padStart(2, "0")}:00`, endTime: `${String(9 + i).padStart(2, "0")}:00`, staff: [{ staffId: t }] });
        }),
      );
      expect(results.every((r) => r.ok)).toBe(true);
    });

    it("stock d'équipement sous concurrence : jamais plus que le stock", async () => {
      const item = await addEquipment(w, "KIT", 2);
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) => {
          const c = addClass(w, `ConcE ${i}`);
          const t = addStaff(w, `Ens ConcE ${i}`);
          return createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: c.classroomId, curriculumNodeId: c.nodeId, date: D(22), startTime: "08:00", endTime: "09:00", staff: [{ staffId: t }], equipment: [{ equipmentId: item.id, quantity: 1 }] });
        }),
      );
      expect(results.filter((r) => r.ok)).toHaveLength(2);
      for (const r of results.filter((x) => !x.ok)) expect(!r.ok && ["scheduling.conflict_detected", "scheduling.equipment_conflict"]).toContain(!r.ok && r.error.code);
      const used = await adminOne<{ q: string }>(db, "SELECT coalesce(sum(quantity),0)::text AS q FROM scheduling.occurrence_equipment WHERE equipment_id = $1", [item.id]);
      expect(Number(used.q)).toBe(2);
    });
  });

  describe("aperçu des conflits (previewConflicts)", () => {
    it("couvre enseignant, classe, salle et les avertissements non bloquants (indisponibilité, capacité, compétence, affectation)", async () => {
      const c = addClass(w, "Prev A", { headcount: 45, subjectId: "maths" });
      const t = addStaff(w, "Mme Preview");
      const room = await addRoom(w, "PV1", 30);
      w.people.availabilities.push({ staffId: t, weekday: 1, date: null, startTime: "08:00", endTime: "12:00", kind: "UNAVAILABLE" });
      w.people.competencies.push({ staffId: t, subjectId: "histoire", curriculumNodeId: null });
      const taken = unwrap(await createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: c.classroomId, curriculumNodeId: c.nodeId, date: D(26), startTime: "13:00", endTime: "14:00", staff: [{ staffId: t }] })).occurrence;

      const p = unwrap(
        await previewConflicts(w.deps, w.ctx, {
          kind: "LESSON",
          classroomId: c.classroomId,
          curriculumNodeId: c.nodeId,
          date: D(26),
          startTime: "13:30",
          endTime: "14:30",
          staffIds: [t],
          roomId: room.id,
        }),
      );
      expect(p.blocking).toBe(true);
      expect(p.timezone).toBe("Africa/Abidjan");
      const codes = p.conflicts.map((x) => `${x.severity}:${x.code}`);
      expect(codes).toEqual(expect.arrayContaining(["BLOCKING:STAFF_BUSY", "BLOCKING:CLASSROOM_BUSY", "WARNING:ROOM_TOO_SMALL", "WARNING:COMPETENCY_MISSING", "WARNING:STAFF_NOT_ASSIGNED"]));
      expect(p.conflicts.find((x) => x.code === "STAFF_BUSY")?.with?.occurrenceId).toBe(taken.id);

      // L'enseignant est indisponible le lundi matin : avertissement, jamais un blocage.
      const monday = unwrap(await previewConflicts(w.deps, w.ctx, { kind: "LESSON", classroomId: c.classroomId, curriculumNodeId: c.nodeId, date: D(5), startTime: "09:00", endTime: "10:00", staffIds: [t] }));
      expect(monday.conflicts.find((x) => x.code === "STAFF_UNAVAILABLE")?.severity).toBe("WARNING");

      // En modification : la séance exclue n'entre pas en conflit avec elle-même.
      const self = unwrap(await previewConflicts(w.deps, w.ctx, { excludeOccurrenceId: taken.id, date: D(26), startTime: "13:00", endTime: "14:00" }));
      expect(self.conflicts.filter((x) => x.severity === "BLOCKING")).toEqual([]);
    });

    it("l'aperçu n'écrit rien", async () => {
      const before = await adminOne<{ n: string }>(db, "SELECT count(*)::text AS n FROM scheduling.session_occurrences");
      unwrap(await previewConflicts(w.deps, w.ctx, { kind: "MEETING", date: D(27), startTime: "08:00", endTime: "09:00", staffIds: [teacher] }));
      const after = await adminOne<{ n: string }>(db, "SELECT count(*)::text AS n FROM scheduling.session_occurrences");
      expect(after.n).toBe(before.n);
    });
  });

  describe("salles", () => {
    it("salle hors service : plus réservable, séances futures signalées « à remplacer » (jamais annulées), puis rétablie", async () => {
      const room = await addRoom(w, "HS1", 30);
      const c = addClass(w, "HS A");
      const t = addStaff(w, "M. Hors-Service");
      const occ = unwrap(await createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: c.classroomId, curriculumNodeId: c.nodeId, roomId: room.id, date: D(28), startTime: "08:00", endTime: "09:00", staff: [{ staffId: t }] })).occurrence;
      const r = unwrap(await setRoomStatus(w.deps, w.ctx, { roomId: room.id, status: "OUT_OF_SERVICE", reason: "Inondation" }));
      expect(r.flagged.map((f) => f.occurrenceId)).toEqual([occ.id]);
      const after = unwrap(await getOccurrence(w.deps, w.ctx, { occurrenceId: occ.id }));
      expect(after).toMatchObject({ status: "PLANNED", needsReplacement: true, replacementReason: "ROOM_UNAVAILABLE" });
      expect(await outboxTypes(w, occ.id)).toContain("scheduling.occurrence.replacement_needed");
      const pending = unwrap(await listPendingReplacements(w.deps, w.ctx, {}));
      expect(pending.items.map((o) => o.id)).toContain(occ.id);

      const c2 = addClass(w, "HS B");
      const t2 = addStaff(w, "Mme HS2");
      const refused = await expectErr(
        createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: c2.classroomId, curriculumNodeId: c2.nodeId, roomId: room.id, date: D(29), startTime: "08:00", endTime: "09:00", staff: [{ staffId: t2 }] }),
        "scheduling.conflict_detected",
      );
      expect(refused.message).toContain("hors service");

      // Réaffecter la séance à une autre salle règle le signalement.
      const other = await addRoom(w, "HS2", 30);
      const moved = unwrap(await changeOccurrenceRoom(w.deps, w.ctx, { occurrenceId: occ.id, roomId: other.id, reason: "Salle indisponible" }));
      expect(moved.occurrence).toMatchObject({ roomId: other.id, needsReplacement: false });
    });
  });

  describe("report, intervenants, remplacement", () => {
    it("report : nouvelle plage contrôlée (conflit refusé, plage libre acceptée), journalisé avec le motif", async () => {
      const t = addStaff(w, "M. Report");
      const c1 = addClass(w, "Rep 1");
      const c2 = addClass(w, "Rep 2");
      const a = unwrap(await createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: c1.classroomId, curriculumNodeId: c1.nodeId, date: D(5), startTime: "14:00", endTime: "15:00", staff: [{ staffId: t }] })).occurrence;
      unwrap(await createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: c2.classroomId, curriculumNodeId: c2.nodeId, date: D(5), startTime: "16:00", endTime: "17:00", staff: [{ staffId: t }] }));
      await expectErr(rescheduleOccurrence(w.deps, w.ctx, { occurrenceId: a.id, date: D(5), startTime: "16:30", endTime: "17:30" }), "scheduling.conflict_detected");
      const moved = unwrap(await rescheduleOccurrence(w.deps, w.ctx, { occurrenceId: a.id, date: D(5), startTime: "15:00", endTime: "16:00", reason: "Réunion déplacée" })).occurrence;
      expect(moved.startsAt.toISOString()).toBe("2026-10-05T15:00:00.000Z");
      const h = unwrap(await getOccurrenceHistory(w.deps, w.ctx, { occurrenceId: a.id })).find((x) => x.kind === "RESCHEDULED");
      expect(h?.reason).toBe("Réunion déplacée");
      expect(new Date((h?.fromValue as { startsAt: string }).startsAt).toISOString()).toBe("2026-10-05T14:00:00.000Z");
      expect(await outboxTypes(w, a.id)).toContain("scheduling.occurrence.rescheduled");
    });

    it("remplacement : la ligne du remplacé disparaît (journalisée), le remplaçant désigne le remplacé et reçoit la paie ; motif obligatoire", async () => {
      const titular = addStaff(w, "Titulaire");
      const sub = addStaff(w, "Remplaçant");
      const c = addClass(w, "Sub A");
      const occ = unwrap(await createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: c.classroomId, curriculumNodeId: c.nodeId, date: D(6), startTime: "16:00", endTime: "17:00", staff: [{ staffId: titular }] })).occurrence;
      await expectErr(substituteStaff(w.deps, w.ctx, { occurrenceId: occ.id, originalStaffId: titular, substituteStaffId: sub, reason: "" }), "scheduling.reason_required");
      const r = unwrap(await substituteStaff(w.deps, w.ctx, { occurrenceId: occ.id, originalStaffId: titular, substituteStaffId: sub, reason: "Congé maladie" })).occurrence;
      expect(r.staff).toHaveLength(1);
      expect(r.staff[0]).toMatchObject({ staffId: sub, role: "SUBSTITUTE", replacesStaffId: titular, isPaidRole: true });
      const changes = unwrap(await getOccurrenceHistory(w.deps, w.ctx, { occurrenceId: occ.id }));
      expect(changes.filter((x) => x.kind === "STAFF_CHANGED").map((x) => JSON.stringify(x.fromValue ?? x.toValue))).toHaveLength(3);
      expect(w.audit.actions()).toContain("scheduling.occurrence.staff_substituted");
    });

    it("remplaçant déjà occupé : conflit expliqué ; remplaçant déjà intervenant ou inconnu : refus", async () => {
      const titular = addStaff(w, "Titulaire 2");
      const busy = addStaff(w, "Occupé");
      const c = addClass(w, "Sub B");
      const occ = unwrap(await createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: c.classroomId, curriculumNodeId: c.nodeId, date: D(7), startTime: "16:00", endTime: "17:00", staff: [{ staffId: titular }] })).occurrence;
      const c2 = addClass(w, "Sub B2");
      unwrap(await createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: c2.classroomId, curriculumNodeId: c2.nodeId, date: D(7), startTime: "16:30", endTime: "17:30", staff: [{ staffId: busy }] }));
      await expectErr(substituteStaff(w.deps, w.ctx, { occurrenceId: occ.id, originalStaffId: titular, substituteStaffId: busy, reason: "Absence" }), "scheduling.conflict_detected");
      await expectErr(substituteStaff(w.deps, w.ctx, { occurrenceId: occ.id, originalStaffId: titular, substituteStaffId: titular, reason: "Absence" }), "VALIDATION_FAILED");
      await expectErr(substituteStaff(w.deps, w.ctx, { occurrenceId: occ.id, originalStaffId: titular, substituteStaffId: newId(), reason: "Absence" }), "scheduling.staff_not_eligible");
    });

    it("setOccurrenceStaff : ajoute un co-enseignant et un surveillant NON rémunéré par défaut (réglable), retire un intervenant", async () => {
      const lead = addStaff(w, "Principal");
      const co = addStaff(w, "Co-enseignant");
      const sup = addStaff(w, "Surveillant");
      const c = addClass(w, "Co A");
      const occ = unwrap(await createOccurrence(w.deps, w.ctx, { kind: "EXAM", classroomId: c.classroomId, curriculumNodeId: c.nodeId, date: D(8), startTime: "16:00", endTime: "18:00", staff: [{ staffId: lead }] })).occurrence;
      const r = unwrap(await setOccurrenceStaff(w.deps, w.ctx, { occurrenceId: occ.id, staff: [{ staffId: lead }, { staffId: co, role: "CO_TEACHER" }, { staffId: sup, role: "SUPERVISOR" }] })).occurrence;
      expect(r.staff.map((s) => [s.role, s.isPaidRole])).toEqual(expect.arrayContaining([["LEAD", true], ["CO_TEACHER", true], ["SUPERVISOR", false]]));
      // Réglage de l'établissement : les surveillants sont rémunérés.
      unwrap(await updateSchedulingSettings(w.deps, w.ctx, { institutionId: w.institutionId, patch: { supervisorsPaid: true } }));
      const sup2 = addStaff(w, "Surveillant 2");
      const r2 = unwrap(await setOccurrenceStaff(w.deps, w.ctx, { occurrenceId: occ.id, staff: [{ staffId: lead }, { staffId: sup2, role: "SUPERVISOR" }] })).occurrence;
      expect(r2.staff.find((s) => s.staffId === sup2)?.isPaidRole).toBe(true);
      expect(r2.staff.map((s) => s.staffId).sort()).toEqual([lead, sup2].sort());
      unwrap(await updateSchedulingSettings(w.deps, w.ctx, { institutionId: w.institutionId, patch: { supervisorsPaid: false } }));
    });

    it("intervenant parti ou suspendu : planification refusée (R15)", async () => {
      const gone = addStaff(w, "Parti", { status: "LEFT" });
      const susp = addStaff(w, "Suspendu", { status: "SUSPENDED" });
      const leave = addStaff(w, "En congé", { status: "ON_LEAVE" });
      const c = addClass(w, "Elig A");
      for (const [id, ok] of [[gone, false], [susp, false], [leave, true]] as const) {
        const r = await createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: c.classroomId, curriculumNodeId: c.nodeId, date: D(9), startTime: "18:00", endTime: "19:00", staff: [{ staffId: id }] });
        expect(r.ok).toBe(ok);
        if (!r.ok) expect(r.error.code).toBe("scheduling.staff_not_eligible");
        if (r.ok) await cancelOccurrence(w.deps, w.ctx, { occurrenceId: r.value.occurrence.id, reason: "Test" });
      }
    });
  });

  describe("constat, annulation, restauration", () => {
    it("constat par l'appel : idempotent, source tracée ; une séance annulée n'est pas ressuscitée par un appel tardif", async () => {
      const t = addStaff(w, "M. Constat");
      const c = addClass(w, "Hold A");
      const occ = unwrap(await createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: c.classroomId, curriculumNodeId: c.nodeId, date: D(5), startTime: "18:00", endTime: "19:00", staff: [{ staffId: t }] })).occurrence;
      const sys = w.ctxOf(newId());
      const first = unwrap(await holdOccurrence(w.deps, sys, { occurrenceId: occ.id, source: "ATTENDANCE" }));
      expect(first.alreadyHeld).toBe(false);
      expect(first.occurrence).toMatchObject({ status: "HELD", heldSource: "ATTENDANCE" });
      const again = unwrap(await holdOccurrence(w.deps, sys, { occurrenceId: occ.id, source: "ATTENDANCE" }));
      expect(again.alreadyHeld).toBe(true);
      expect((await outboxTypes(w, occ.id)).filter((x) => x === "scheduling.occurrence.held")).toHaveLength(1);
    });

    it("annulée puis appel tardif : reste annulée ; un constat manuel exige un motif et une séance commencée", async () => {
      const t = addStaff(w, "M. Tardif");
      const c = addClass(w, "Hold C");
      const occ = unwrap(await createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: c.classroomId, curriculumNodeId: c.nodeId, date: D(5), startTime: "17:30", endTime: "18:30", staff: [{ staffId: t }] })).occurrence;
      unwrap(await cancelOccurrence(w.deps, w.ctx, { occurrenceId: occ.id, reason: "Enseignant absent" }));
      const late = unwrap(await holdOccurrence(w.deps, w.ctx, { occurrenceId: occ.id, source: "ATTENDANCE" }));
      expect(late.ignoredCancelled).toBe(true);
      expect(late.occurrence.status).toBe("CANCELLED");
      await expectErr(holdOccurrence(w.deps, w.ctx, { occurrenceId: occ.id, source: "ADMIN", reason: "Rattrapage" }), "scheduling.occurrence_cancelled");
      unwrap(await restoreOccurrence(w.deps, w.ctx, { occurrenceId: occ.id }));
      await expectErr(holdOccurrence(w.deps, w.ctx, { occurrenceId: occ.id, source: "ADMIN" }), "scheduling.reason_required");
      // Passée de 3 mois : constat manuel possible ; dans le futur : refusé.
      const future = unwrap(await createOccurrence(w.deps, w.ctx, { kind: "MEETING", date: D(30), startTime: "08:00", endTime: "09:00" })).occurrence;
      await expectErr(holdOccurrence(w.deps, w.ctx, { occurrenceId: future.id, source: "ADMIN", reason: "Test" }), "VALIDATION_FAILED");
      w.clock.set("2026-10-06T00:00:00.000Z");
      try {
        const done = unwrap(await holdOccurrence(w.deps, w.ctx, { occurrenceId: occ.id, source: "ADMIN", reason: "Constat de la direction" }));
        expect(done.occurrence).toMatchObject({ status: "HELD", heldSource: "ADMIN" });
        // Annuler le constat : motif requis, journalisé.
        await expectErr(unholdOccurrence(w.deps, w.ctx, { occurrenceId: occ.id, reason: "" }), "scheduling.reason_required");
        const un = unwrap(await unholdOccurrence(w.deps, w.ctx, { occurrenceId: occ.id, reason: "Erreur de saisie" }));
        expect(un.status).toBe("PLANNED");
        const kinds = unwrap(await getOccurrenceHistory(w.deps, w.ctx, { occurrenceId: occ.id })).map((h) => h.kind);
        expect(kinds).toEqual(expect.arrayContaining(["HELD", "UNHELD", "CANCELLED"]));
      } finally {
        w.clock.set("2026-10-01T07:00:00.000Z");
      }
    });

    it("constat d'un non-intervenant : avertissement et événement marqué (la direction est notifiée)", async () => {
      const owner = addStaff(w, "Titulaire du cours", { userId: newId() });
      const intruder = addStaff(w, "Autre enseignant", { userId: newId() });
      const c = addClass(w, "Hold D");
      const occ = unwrap(await createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: c.classroomId, curriculumNodeId: c.nodeId, date: D(5), startTime: "06:00", endTime: "07:00", staff: [{ staffId: owner }] })).occurrence;
      w.clock.set("2026-10-06T00:00:00.000Z");
      try {
        const intruderCtx = w.ctxOf(w.people.staff.get(intruder)?.userId as string);
        const r = unwrap(await holdOccurrence(w.deps, intruderCtx, { occurrenceId: occ.id, source: "ADMIN", reason: "J'ai fait l'appel" }));
        expect(r.warnings).toEqual(["NON_PARTICIPANT_HELD"]);
        const ev = await adminOne<{ payload: { heldByNonParticipant: boolean } }>(db, "SELECT payload FROM kernel.domain_events WHERE aggregate_id = $1 AND type = 'scheduling.occurrence.held'", [occ.id]);
        expect(ev.payload.heldByNonParticipant).toBe(true);
      } finally {
        w.clock.set("2026-10-01T07:00:00.000Z");
      }
    });

    it("annulation : motif obligatoire, libère les réservations, événement pour 010 (appel) et 016, idempotente", async () => {
      const t = addStaff(w, "M. Annule");
      const c = addClass(w, "Can A");
      const occ = unwrap(await createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: c.classroomId, curriculumNodeId: c.nodeId, offeringId: c.offeringId, date: D(12), startTime: "18:00", endTime: "19:00", staff: [{ staffId: t }] })).occurrence;
      await expectErr(cancelOccurrence(w.deps, w.ctx, { occurrenceId: occ.id, reason: "" }), "scheduling.reason_required");
      const r = unwrap(await cancelOccurrence(w.deps, w.ctx, { occurrenceId: occ.id, reason: "Grève" }));
      expect(r.occurrence).toMatchObject({ status: "CANCELLED", cancelReason: "Grève" });
      const claims = await adminOne<{ n: string }>(db, "SELECT count(*)::text AS n FROM scheduling.resource_claims WHERE occurrence_id = $1", [occ.id]);
      expect(claims.n).toBe("0");
      const ev = await adminOne<{ payload: Record<string, unknown> }>(db, "SELECT payload FROM kernel.domain_events WHERE aggregate_id = $1 AND type = 'scheduling.occurrence.cancelled'", [occ.id]);
      expect(ev.payload).toMatchObject({ v: 1, occurrenceId: occ.id, classroomId: c.classroomId, offeringId: c.offeringId, staffIds: [t], reason: "Grève" });
      // Le créneau est libre pour la même classe et le même enseignant.
      unwrap(await createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: c.classroomId, curriculumNodeId: c.nodeId, date: D(12), startTime: "18:00", endTime: "19:00", staff: [{ staffId: t }] }));
      expect(unwrap(await cancelOccurrence(w.deps, w.ctx, { occurrenceId: occ.id, reason: "Grève" })).alreadyCancelled).toBe(true);
    });

    it("restauration : contrôle de conflit ; refusée si le créneau a été repris, acceptée sinon", async () => {
      const t = addStaff(w, "M. Restaure");
      const c = addClass(w, "Res A");
      const c2 = addClass(w, "Res B");
      const a = unwrap(await createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: c.classroomId, curriculumNodeId: c.nodeId, date: D(13), startTime: "18:00", endTime: "19:00", staff: [{ staffId: t }] })).occurrence;
      unwrap(await cancelOccurrence(w.deps, w.ctx, { occurrenceId: a.id, reason: "Erreur" }));
      unwrap(await createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: c2.classroomId, curriculumNodeId: c2.nodeId, date: D(13), startTime: "18:30", endTime: "19:30", staff: [{ staffId: t }] }));
      await expectErr(restoreOccurrence(w.deps, w.ctx, { occurrenceId: a.id }), "scheduling.conflict_detected");
      const b = unwrap(await createOccurrence(w.deps, w.ctx, { kind: "MEETING", date: D(14), startTime: "18:00", endTime: "19:00" })).occurrence;
      unwrap(await cancelOccurrence(w.deps, w.ctx, { occurrenceId: b.id, reason: "Test" }));
      const restored = unwrap(await restoreOccurrence(w.deps, w.ctx, { occurrenceId: b.id })).occurrence;
      expect(restored).toMatchObject({ status: "PLANNED", cancelReason: null });
      await expectErr(restoreOccurrence(w.deps, w.ctx, { occurrenceId: b.id }), "scheduling.invalid_transition");
    });
  });

  describe("déclaration par l'enseignant et séance comptable", () => {
    it("un enseignant déclare une séance ponctuelle de SA classe ; hors de ses classes ou sans compte lié : refus", async () => {
      const userId = newId();
      const me = addStaff(w, "Enseignant déclarant", { userId });
      const mine = addClass(w, "Decl A");
      const notMine = addClass(w, "Decl B");
      w.people.assign(me, mine.classroomId);
      const ctx = w.ctxOf(userId);
      const ok = unwrap(
        await createOccurrence(w.deps, ctx, { kind: "LESSON", classroomId: mine.classroomId, curriculumNodeId: mine.nodeId, date: D(5), startTime: "20:00", endTime: "21:00", mode: "DECLARE", staff: [{ staffId: addStaff(w, "usurpé") }] }),
      ).occurrence;
      // L'identité vient du contexte : la liste d'intervenants fournie est ignorée.
      expect(ok.staff.map((s) => s.staffId)).toEqual([me]);
      const refused = await expectErr(
        createOccurrence(w.deps, ctx, { kind: "LESSON", classroomId: notMine.classroomId, curriculumNodeId: notMine.nodeId, date: D(5), startTime: "20:00", endTime: "21:00", mode: "DECLARE" }),
        "scheduling.not_assigned",
      );
      expect(refused.httpStatus).toBe(403);
      await expectErr(createOccurrence(w.deps, ctx, { kind: "MEETING", date: D(5), startTime: "20:00", endTime: "21:00", mode: "DECLARE" }), "scheduling.not_assigned");
      await expectErr(createOccurrence(w.deps, w.ctxOf(newId()), { kind: "LESSON", classroomId: mine.classroomId, curriculumNodeId: mine.nodeId, date: D(6), startTime: "20:00", endTime: "21:00", mode: "DECLARE" }), "scheduling.not_assigned");
    });

    it("déclaration a posteriori (statut HELD) d'une séance déjà tenue", async () => {
      const userId = newId();
      const me = addStaff(w, "Déclarant rattrapage", { userId });
      const c = addClass(w, "Decl C");
      w.people.assign(me, c.classroomId);
      w.clock.set("2026-10-07T12:00:00.000Z");
      try {
        const r = unwrap(await createOccurrence(w.deps, w.ctxOf(userId), { kind: "LESSON", classroomId: c.classroomId, curriculumNodeId: c.nodeId, date: D(7), startTime: "09:00", endTime: "10:00", mode: "DECLARE", status: "HELD" }));
        expect(r.occurrence).toMatchObject({ status: "HELD", heldSource: "ADMIN" });
        await expectErr(
          createOccurrence(w.deps, w.ctxOf(userId), { kind: "LESSON", classroomId: c.classroomId, curriculumNodeId: c.nodeId, date: D(9), startTime: "09:00", endTime: "10:00", mode: "DECLARE", status: "HELD" }),
          "VALIDATION_FAILED",
        );
      } finally {
        w.clock.set("2026-10-01T07:00:00.000Z");
      }
    });

    it("séance comptable : HELD, non validée, origine ACCOUNTING, aucune réservation, jamais de conflit", async () => {
      const t = addStaff(w, "Vacataire");
      const busy = unwrap(await createOccurrence(w.deps, w.ctx, { kind: "MEETING", date: D(5), startTime: "10:00", endTime: "12:00", staff: [{ staffId: t }] })).occurrence;
      void busy;
      w.clock.set("2026-10-06T00:00:00.000Z");
      try {
        const r = unwrap(await createAccountingOccurrence(w.deps, w.ctx, { staffId: t, date: D(5), minutes: 90, title: "Heures de TP" })).occurrence;
        expect(r).toMatchObject({ status: "HELD", origin: "ACCOUNTING", validatedAt: null, kind: "OTHER" });
        expect((r.endsAt.getTime() - r.startsAt.getTime()) / 60_000).toBe(90);
        expect(r.createdBy).toBe(w.ctx.userId);
        const claims = await adminOne<{ n: string }>(db, "SELECT count(*)::text AS n FROM scheduling.resource_claims WHERE occurrence_id = $1", [r.id]);
        expect(claims.n).toBe("0");
        await expectErr(createAccountingOccurrence(w.deps, w.ctx, { staffId: t, date: D(5), minutes: 2000 }), "VALIDATION_FAILED");
        await expectErr(createAccountingOccurrence(w.deps, w.ctx, { staffId: t, date: "2026-11-30", minutes: 60 }), "VALIDATION_FAILED");
        expect(w.audit.actions()).toContain("scheduling.occurrence.accounting_created");
      } finally {
        w.clock.set("2026-10-01T07:00:00.000Z");
      }
    });
  });

  describe("fenêtres horaires et fuseau", () => {
    it("refuse fin ≤ début et une séance qui passe minuit ; accepte deux instants ISO", async () => {
      await expectErr(createOccurrence(w.deps, w.ctx, { kind: "MEETING", date: D(5), startTime: "10:00", endTime: "10:00" }), "VALIDATION_FAILED");
      await expectErr(createOccurrence(w.deps, w.ctx, { kind: "MEETING", startsAt: "2026-10-05T22:00:00Z", endsAt: "2026-10-06T01:00:00Z" }), "VALIDATION_FAILED");
      const r = unwrap(await createOccurrence(w.deps, w.ctx, { kind: "MEETING", startsAt: "2026-10-05T21:00:00Z", endsAt: "2026-10-05T22:30:00Z" })).occurrence;
      expect(r.occursOn).toBe("2026-10-05");
    });

    it("la date civile suit le fuseau de l'établissement (Europe/Paris) et non l'UTC", async () => {
      const paris = await createWorld({ db, timezone: "Europe/Paris" });
      const inst = paris.institutionId;
      const t = addStaff(paris, "Paris");
      const classroom = addClass(paris, "Paris A");
      const r = unwrap(
        await createOccurrence(paris.deps, paris.ctx, { kind: "LESSON", institutionId: inst, classroomId: classroom.classroomId, curriculumNodeId: classroom.nodeId, date: "2026-10-05", startTime: "08:00", endTime: "09:00", staff: [{ staffId: t }] }),
      ).occurrence;
      expect(r.startsAt.toISOString()).toBe("2026-10-05T06:00:00.000Z"); // CEST
      expect(r.occursOn).toBe("2026-10-05");
      // 00:30 locale du lendemain = 22:30 UTC la veille : la date civile est celle du fuseau.
      const night = unwrap(await createOccurrence(paris.deps, paris.ctx, { kind: "MEETING", institutionId: inst, date: "2026-10-06", startTime: "00:30", endTime: "01:30" })).occurrence;
      expect(night.startsAt.toISOString()).toBe("2026-10-05T22:30:00.000Z");
      expect(night.occursOn).toBe("2026-10-06");
      // Janvier (CET) : décalage différent pour la même heure murale.
      const winter = unwrap(await createOccurrence(paris.deps, paris.ctx, { kind: "MEETING", institutionId: inst, date: "2027-01-12", startTime: "08:00", endTime: "09:00" })).occurrence;
      expect(winter.startsAt.toISOString()).toBe("2027-01-12T07:00:00.000Z");
    });
  });

  it("liste filtrée et paginée des séances", async () => {
    const page = unwrap(await listOccurrences(w.deps, w.ctx, { from: D(5), to: D(9), limit: 5 }));
    expect(page.items.length).toBeLessThanOrEqual(5);
    expect(page.total).toBeGreaterThan(5);
    expect(page.hasMore).toBe(true);
    const byStaff = unwrap(await listOccurrences(w.deps, w.ctx, { staffId: teacher, from: D(5), to: D(5) }));
    expect(byStaff.items.every((o) => o.staff.some((s) => s.staffId === teacher))).toBe(true);
  });
});
