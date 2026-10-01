import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import {
  acceptJustification,
  attachJustificationDocument,
  getJustification,
  getJustificationAttachmentUrl,
  listJustifications,
  markWithJustification,
  rejectJustification,
  removeJustificationAttachment,
  revokeJustification,
  submitJustification,
  withdrawJustification,
} from "../../application/justifications";
import { upsertAttendanceSettings, upsertJustificationReason } from "../../application/reference";
import { markStudentRecords, openAttendanceSession, submitAttendanceSession, validateAttendanceSession } from "../../application/sessions";
import { getAttendanceSummary } from "../../application/summaries";
import { adminOne, adminRows, createAttendanceTestDb, describeIntegration, type AttendanceTestDb } from "../support/db";
import { CAPS, addOccurrence, makeWorld, seedSchool, type School, type TestWorld } from "../support/world";

const PDF = new Uint8Array([...Buffer.from("%PDF-1.4\n"), ...Buffer.from("contenu de test")]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const EXE = new Uint8Array([...Buffer.from("MZ"), 0x90, 0x00, 3, 0, 0, 0]);

describeIntegration("justificatifs : dépôt, pièces, décision, révocation (Postgres réel)", () => {
  let db: AttendanceTestDb;
  let world: TestWorld;
  let school: School;

  beforeAll(async () => {
    db = await createAttendanceTestDb();
    world = makeWorld(db, "2025-10-01T12:00:00.000Z");
    school = await seedSchool(db, world, { students: 4 });
  });
  afterAll(async () => {
    await db.drop();
  });

  const [A, B] = [0, 1] as const;
  const stu = (i: number) => school.students[i]!;

  /** Appel soumis (et éventuellement validé) d'un jour, avec des statuts donnés. */
  async function callOn(date: string, marks: Array<{ i: number; statusCode: string; minutesLate?: number }>, validate = false) {
    const occ = addOccurrence(world, school, { date });
    const { session } = unwrap(await openAttendanceSession(world.deps, school.teacher.ctx, { kind: "occurrence", occurrenceId: occ.occurrenceId, caps: CAPS.teacher }));
    unwrap(
      await markStudentRecords(world.deps, school.admin.ctx, {
        sessionId: session.id,
        caps: CAPS.admin,
        entries: marks.map((m) => ({ studentId: stu(m.i).studentId, statusCode: m.statusCode, minutesLate: m.minutesLate })),
      }),
    );
    unwrap(await submitAttendanceSession(world.deps, school.admin.ctx, { sessionId: session.id, allPresent: true, caps: CAPS.admin }));
    if (validate) unwrap(await validateAttendanceSession(world.deps, school.admin.ctx, { sessionId: session.id, caps: CAPS.admin }));
    return session.id;
  }
  const recordsOf = async (sessionId: string) =>
    adminRows<any>(db, "SELECT student_id, status_code, original_status_code, excused, justification_id, counted_minutes FROM attendance.student_records WHERE session_id = $1", [sessionId]);

  let s0929: string;
  let s0930: string;
  let justificationId: string;

  it("dépôt par le tuteur lié, l'élève lui-même ou le personnel habilité ; refus de tout autre ; double envoi tolérant", async () => {
    s0929 = await callOn("2025-09-29", [{ i: A, statusCode: "ABSENT" }, { i: B, statusCode: "LATE", minutesLate: 10 }], true);
    s0930 = await callOn("2025-09-30", [{ i: A, statusCode: "ABSENT" }]);

    const input = { studentId: stu(A).studentId, fromDate: "2025-09-29", toDate: "2025-09-30", reasonCode: "ILLNESS", comment: "Paludisme" };
    const mine = unwrap(await submitJustification(world.deps, school.guardian.ctx, { ...input, caps: CAPS.guardian }));
    expect(mine.justification).toMatchObject({ status: "PENDING", submittedByKind: "GUARDIAN", submittedByUser: school.guardian.userId, enrollmentId: stu(A).enrollmentId });
    justificationId = mine.justification.id;

    // Double envoi (téléphone) : la demande en attente est renvoyée, pas dupliquée.
    const again = unwrap(await submitJustification(world.deps, school.guardian.ctx, { ...input, caps: CAPS.guardian }));
    expect(again.justification.id).toBe(justificationId);
    expect(Number((await adminOne<{ n: string }>(db, "SELECT count(*) AS n FROM attendance.justifications")).n)).toBe(1);

    const other = await submitJustification(world.deps, school.otherGuardian.ctx, { ...input, caps: CAPS.guardian });
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.error.code).toBe("attendance.not_guardian");

    // Un enseignant sans capacité ne dépose rien (le legacy laissait tout utilisateur écrire).
    const teacher = await submitJustification(world.deps, school.teacher.ctx, { ...input, caps: CAPS.teacher });
    expect(teacher.ok).toBe(false);

    const self = unwrap(await submitJustification(world.deps, school.pupil.ctx, { ...input, fromDate: "2025-09-15", toDate: "2025-09-15", caps: CAPS.pupil }));
    expect(self.justification.submittedByKind).toBe("STUDENT");
    // L'élève n'agit que pour lui-même.
    const notMe = await submitJustification(world.deps, school.pupil.ctx, { ...input, studentId: stu(B).studentId, caps: CAPS.pupil });
    expect(notMe.ok).toBe(false);

    const staff = unwrap(await submitJustification(world.deps, school.admin.ctx, { ...input, studentId: stu(B).studentId, fromDate: "2025-09-29", toDate: "2025-09-29", reasonCode: "FAMILY_EVENT", caps: CAPS.admin }));
    expect(staff.justification.submittedByKind).toBe("STAFF");
  });

  it("valide la fenêtre (année de l'inscription, pas de futur) et le motif", async () => {
    const base = { studentId: stu(A).studentId, reasonCode: "ILLNESS", caps: CAPS.guardian };
    const future = await submitJustification(world.deps, school.guardian.ctx, { ...base, fromDate: "2025-10-02", toDate: "2025-10-03" });
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.error.code).toBe("attendance.justification_future_not_allowed");
    const beforeYear = await submitJustification(world.deps, school.guardian.ctx, { ...base, fromDate: "2025-08-01", toDate: "2025-08-02" });
    expect(beforeYear.ok).toBe(false);
    if (!beforeYear.ok) expect(beforeYear.error.code).toBe("attendance.justification_window_invalid");
    const reason = await submitJustification(world.deps, school.guardian.ctx, { ...base, reasonCode: "INCONNU", fromDate: "2025-09-20", toDate: "2025-09-20" });
    expect(reason.ok).toBe(false);
    if (!reason.ok) expect(reason.error.code).toBe("attendance.justification_reason_unknown");
    // Une absence prévue n'est possible que si la politique l'autorise ET pour le personnel habilité.
    const staffFuture = await submitJustification(world.deps, school.admin.ctx, { ...base, caps: CAPS.admin, fromDate: "2025-10-06", toDate: "2025-10-06" });
    expect(staffFuture.ok).toBe(false);
    unwrap(await upsertAttendanceSettings(world.deps, school.admin.ctx, { allowFutureJustifications: true }));
    expect((await submitJustification(world.deps, school.admin.ctx, { ...base, caps: CAPS.admin, fromDate: "2025-10-06", toDate: "2025-10-06" })).ok).toBe(true);
    unwrap(await upsertAttendanceSettings(world.deps, school.admin.ctx, { allowFutureJustifications: false }));
  });

  it("pièces jointes : type RÉEL par octets magiques, taille et types des paramètres, empreinte, audit de lecture, URL signée courte", async () => {
    const attach = (content: Uint8Array, fileName = "justificatif.pdf", caps = CAPS.guardian, ctx = school.guardian.ctx) =>
      attachJustificationDocument(world.deps, ctx, { justificationId, fileName, content, caps });

    // Un exécutable renommé .pdf est refusé : le type déclaré n'est jamais cru.
    const fake = await attach(EXE, "ordonnance.pdf");
    expect(fake.ok).toBe(false);
    if (!fake.ok) expect(fake.error.code).toBe("attendance.attachment_type_rejected");

    const pdf = unwrap(await attach(PDF, "../../etc/ordonnance.pdf"));
    expect(pdf).toMatchObject({ detectedMime: "application/pdf", sizeBytes: PDF.byteLength, fileName: "ordonnance.pdf" });
    expect(pdf.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(world.ports.storage.objects.has(pdf.storageKey)).toBe(true);
    expect(pdf.storageKey).toBe(`attendance/${school.tenantId}/justifications/${justificationId}/${pdf.id}.pdf`);

    const png = unwrap(await attach(PNG, "photo.jpg"));
    expect(png.detectedMime).toBe("image/png");

    // Taille maximale et types acceptés = paramètres d'établissement.
    unwrap(await upsertAttendanceSettings(world.deps, school.admin.ctx, { attachmentMaxBytes: 15 }));
    const big = await attach(PDF);
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.error.code).toBe("attendance.attachment_too_large");
    unwrap(await upsertAttendanceSettings(world.deps, school.admin.ctx, { attachmentMaxBytes: 5_242_880, allowedAttachmentTypes: ["application/pdf"] }));
    const notPng = await attach(PNG);
    expect(notPng.ok).toBe(false);
    if (!notPng.ok) expect(notPng.error.code).toBe("attendance.attachment_type_rejected");
    unwrap(await upsertAttendanceSettings(world.deps, school.admin.ctx, { allowedAttachmentTypes: null }));
    const disabled = await attach(PDF);
    expect(disabled.ok).toBe(false);
    if (!disabled.ok) expect(disabled.error.code).toBe("attendance.attachments_disabled");
    unwrap(await upsertAttendanceSettings(world.deps, school.admin.ctx, { allowedAttachmentTypes: ["application/pdf", "image/jpeg", "image/png"] }));

    // Lecture : déposant, tuteur lié, rôle habilité ; JAMAIS un enseignant ni un autre parent.
    const auditBefore = world.audit.entries.length;
    const url = unwrap(await getJustificationAttachmentUrl(world.deps, school.guardian.ctx, { justificationId, attachmentId: pdf.id, caps: CAPS.guardian }));
    expect(url.url).toContain(pdf.storageKey);
    expect(world.ports.storage.signed.at(-1)).toEqual({ key: pdf.storageKey, ttlSeconds: 120 });
    expect(world.audit.entries.slice(auditBefore).map((e) => e.entry.action)).toContain("attendance.justification_attachment.read");
    expect((await getJustificationAttachmentUrl(world.deps, school.admin.ctx, { justificationId, attachmentId: pdf.id, caps: CAPS.admin })).ok).toBe(true);
    for (const who of [school.teacher.ctx, school.otherGuardian.ctx]) {
      const denied = await getJustificationAttachmentUrl(world.deps, who, { justificationId, attachmentId: pdf.id, caps: {} });
      expect(denied.ok).toBe(false);
      if (!denied.ok) expect(denied.error.kind).toBe("not_found");
    }
    const detail = unwrap(await getJustification(world.deps, school.guardian.ctx, { justificationId, caps: CAPS.guardian }));
    expect(detail.attachments).toHaveLength(2);
    expect((await getJustification(world.deps, school.teacher.ctx, { justificationId, caps: {} })).ok).toBe(false);

    // Retrait d'une pièce tant que la demande est en attente : l'objet est supprimé.
    unwrap(await removeJustificationAttachment(world.deps, school.guardian.ctx, { justificationId, attachmentId: png.id, caps: CAPS.guardian }));
    expect(world.ports.storage.objects.has(png.storageKey)).toBe(false);
    expect(unwrap(await getJustification(world.deps, school.guardian.ctx, { justificationId, caps: CAPS.guardian })).attachments).toHaveLength(1);
  });

  it("acceptation : excuse appliquée à TOUTE la fenêtre, y compris sur un appel validé ; récapitulatif « dont justifiées » ; décision sans droit refusée", async () => {
    const denied = await acceptJustification(world.deps, school.guardian.ctx, { justificationId, caps: CAPS.guardian });
    expect(denied.ok).toBe(false);

    const sum0 = unwrap(await getAttendanceSummary(world.deps, school.admin.ctx, { enrollmentId: stu(A).enrollmentId, periodId: school.termId }));
    expect(sum0.derived).toMatchObject({ absentCount: 2, excusedCount: 0, absentMinutes: 120, excusedMinutes: 0 });

    const auditBefore = world.audit.entries.length;
    const accepted = unwrap(await acceptJustification(world.deps, school.admin.ctx, { justificationId, note: "Certificat médical vu", caps: CAPS.admin }));
    expect(accepted.justification).toMatchObject({ status: "ACCEPTED", decidedBy: school.admin.userId, decisionNote: "Certificat médical vu" });
    expect(accepted.coveredRecordCount).toBe(2);

    for (const sessionId of [s0929, s0930]) {
      const r = (await recordsOf(sessionId)).find((x) => x.student_id === stu(A).studentId);
      expect(r).toMatchObject({ status_code: "EXCUSED", original_status_code: "ABSENT", excused: true, justification_id: justificationId, counted_minutes: 60 });
    }
    // Les autres élèves (retard de B) ne sont pas couverts.
    expect((await recordsOf(s0929)).find((x) => x.student_id === stu(B).studentId)).toMatchObject({ status_code: "LATE", excused: false, justification_id: null });
    // L'appel validé reste figé : seule l'excuse a bougé (autre champ = refusé par la base).
    expect(await adminOne(db, "SELECT status FROM attendance.sessions WHERE id = $1", [s0929])).toMatchObject({ status: "VALIDATED" });
    await expect(
      db.tenantDb.run(school.admin.ctx, async (tx) => {
        await tx.query("SELECT set_config('attendance.excuse_apply', 'on', true)");
        await tx.query("UPDATE attendance.student_records SET counted_minutes = 5 WHERE session_id = $1 AND student_id = $2", [s0929, stu(A).studentId]);
      }),
    ).rejects.toThrow(/attendance\.session_locked/);

    // Récapitulatif : 2 absences dont 2 justifiées, 120 minutes dont 120 justifiées ; recalcul à la décision.
    const sum1 = unwrap(await getAttendanceSummary(world.deps, school.admin.ctx, { enrollmentId: stu(A).enrollmentId, periodId: school.termId }));
    expect(sum1.derived).toMatchObject({ absentCount: 2, excusedCount: 2, absentMinutes: 120, excusedMinutes: 120 });
    // Période parente (semestre) : mêmes pointages, aucune double comptabilisation.
    const semester = unwrap(await getAttendanceSummary(world.deps, school.admin.ctx, { enrollmentId: stu(A).enrollmentId, periodId: school.semesterId }));
    expect(semester.derived).toMatchObject({ absentCount: 2, excusedCount: 2, absentMinutes: 120 });

    const entries = world.audit.entries.slice(auditBefore).filter((e) => e.entry.action === "attendance.justification.accepted");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.entry).toMatchObject({ sensitive: true, resourceId: justificationId });
    const evs = await adminRows<any>(db, "SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'attendance.justification.accepted'", [school.tenantId]);
    expect(evs[0].payload).toMatchObject({ v: 1, justificationId, coveredRecordCount: 2 });
    expect(JSON.stringify(evs)).not.toMatch(/Paludisme|Certificat/);

    // Une décision est définitive : pas de seconde acceptation ni de retrait.
    for (const r of [
      await acceptJustification(world.deps, school.admin.ctx, { justificationId, caps: CAPS.admin }),
      await rejectJustification(world.deps, school.admin.ctx, { justificationId, note: "non", caps: CAPS.admin }),
      await withdrawJustification(world.deps, school.guardian.ctx, { justificationId }),
    ]) {
      expect(r.ok).toBe(false);
    }
  });

  it("un ABSENT saisi APRÈS l'acceptation, dans la fenêtre, est excusé d'emblée (AC3.5)", async () => {
    const later = await callOn("2025-09-30", [{ i: A, statusCode: "ABSENT" }, { i: B, statusCode: "ABSENT" }]);
    const rows = await recordsOf(later);
    expect(rows.find((x) => x.student_id === stu(A).studentId)).toMatchObject({ status_code: "EXCUSED", original_status_code: "ABSENT", excused: true, justification_id: justificationId });
    expect(rows.find((x) => x.student_id === stu(B).studentId)).toMatchObject({ status_code: "ABSENT", excused: false });
    expect(Number((await adminOne<{ n: string }>(db, "SELECT count(*) AS n FROM attendance.justification_records WHERE justification_id = $1", [justificationId])).n)).toBe(3);
  });

  it("révocation motivée : les statuts d'origine reviennent, la décision d'acceptation est conservée, la révocation tracée à part", async () => {
    const noReason = await revokeJustification(world.deps, school.admin.ctx, { justificationId, reason: "non", caps: CAPS.admin });
    expect(noReason.ok).toBe(false);
    const revoked = unwrap(await revokeJustification(world.deps, school.admin.ctx, { justificationId, reason: "Certificat contesté par l'infirmerie", caps: CAPS.admin }));
    expect(revoked.justification).toMatchObject({
      status: "REVOKED", decidedBy: school.admin.userId, decisionNote: "Certificat médical vu", revokedBy: school.admin.userId, revocationReason: "Certificat contesté par l'infirmerie",
    });
    for (const sessionId of [s0929, s0930]) {
      const r = (await recordsOf(sessionId)).find((x) => x.student_id === stu(A).studentId);
      expect(r).toMatchObject({ status_code: "ABSENT", original_status_code: null, excused: false, justification_id: null });
    }
    const sum = unwrap(await getAttendanceSummary(world.deps, school.admin.ctx, { enrollmentId: stu(A).enrollmentId, periodId: school.termId }));
    expect(sum.derived).toMatchObject({ absentCount: 3, excusedCount: 0, excusedMinutes: 0 });
    // L'historique du pointage conserve ABSENT -> EXCUSED -> ABSENT (jamais d'écrasement sans trace).
    const rec = await adminOne<{ id: string }>(db, "SELECT id FROM attendance.student_records WHERE session_id = $1 AND student_id = $2", [s0930, stu(A).studentId]);
    const hist = await adminRows<any>(db, "SELECT from_status, to_status FROM attendance.record_history WHERE record_id = $1 ORDER BY changed_at, id", [rec.id]);
    expect(hist.map((h) => [h.from_status, h.to_status])).toEqual([[null, "ABSENT"], ["ABSENT", "EXCUSED"], ["EXCUSED", "ABSENT"]]);
    // Une révocation n'est pas rejouable.
    expect((await revokeJustification(world.deps, school.admin.ctx, { justificationId, reason: "Encore une fois", caps: CAPS.admin })).ok).toBe(false);
  });

  it("retard et départ anticipé justifiés GARDENT leur statut avec le drapeau excused ; rejet avec note ; retrait par le déposant seul", async () => {
    const early = await callOn("2025-09-26", [{ i: B, statusCode: "LATE", minutesLate: 15 }, { i: 2, statusCode: "EARLY_LEAVE" }]);
    const j = unwrap(await submitJustification(world.deps, school.admin.ctx, { studentId: stu(B).studentId, fromDate: "2025-09-26", toDate: "2025-09-26", reasonCode: "TRANSPORT", caps: CAPS.admin }));
    unwrap(await acceptJustification(world.deps, school.admin.ctx, { justificationId: j.justification.id, caps: CAPS.admin }));
    expect((await recordsOf(early)).find((x) => x.student_id === stu(B).studentId)).toMatchObject({ status_code: "LATE", excused: true, original_status_code: null, justification_id: j.justification.id });
    expect((await recordsOf(early)).find((x) => x.student_id === stu(2).studentId)).toMatchObject({ status_code: "EARLY_LEAVE", excused: false });
    const sum = unwrap(await getAttendanceSummary(world.deps, school.admin.ctx, { enrollmentId: stu(B).enrollmentId, periodId: school.termId }));
    expect(sum.derived.excusedLateCount).toBeGreaterThanOrEqual(1);
    expect(sum.derived.lateMinutes).toBeGreaterThanOrEqual(25);

    // Rejet : la note est obligatoire ; redéposer ensuite = NOUVELLE demande (l'historique garde la première).
    const p = unwrap(await submitJustification(world.deps, school.guardian.ctx, { studentId: stu(A).studentId, fromDate: "2025-09-10", toDate: "2025-09-10", reasonCode: "OTHER", caps: CAPS.guardian }));
    expect((await rejectJustification(world.deps, school.admin.ctx, { justificationId: p.justification.id, note: "", caps: CAPS.admin })).ok).toBe(false);
    const rejected = unwrap(await rejectJustification(world.deps, school.admin.ctx, { justificationId: p.justification.id, note: "Motif insuffisant", caps: CAPS.admin }));
    expect(rejected.justification).toMatchObject({ status: "REJECTED", decisionNote: "Motif insuffisant", decidedBy: school.admin.userId });
    const again = unwrap(await submitJustification(world.deps, school.guardian.ctx, { studentId: stu(A).studentId, fromDate: "2025-09-10", toDate: "2025-09-10", reasonCode: "OTHER", caps: CAPS.guardian }));
    expect(again.justification.id).not.toBe(p.justification.id);

    // Retrait : seul le déposant, tant que la demande est en attente.
    const notMine = await withdrawJustification(world.deps, school.admin.ctx, { justificationId: again.justification.id });
    expect(notMine.ok).toBe(false);
    expect(unwrap(await withdrawJustification(world.deps, school.guardian.ctx, { justificationId: again.justification.id })).justification.status).toBe("WITHDRAWN");

    // Le tuteur ne liste que ses propres demandes ; la vie scolaire voit tout.
    const mine = unwrap(await listJustifications(world.deps, school.guardian.ctx, { caps: CAPS.guardian }));
    expect(mine.items.every((v) => v.justification.submittedByUser === school.guardian.userId)).toBe(true);
    const all = unwrap(await listJustifications(world.deps, school.admin.ctx, { caps: CAPS.admin, status: "ACCEPTED" }));
    expect(all.items.length).toBeGreaterThanOrEqual(1);
  });

  it("l'exigence de pièce d'un motif est vérifiée à la décision", async () => {
    unwrap(await upsertJustificationReason(world.deps, school.admin.ctx, { code: "MEDICAL", label: "Certificat médical", requiresAttachment: true }));
    const j = unwrap(await submitJustification(world.deps, school.guardian.ctx, { studentId: stu(A).studentId, fromDate: "2025-09-12", toDate: "2025-09-12", reasonCode: "MEDICAL", caps: CAPS.guardian }));
    const refused = await acceptJustification(world.deps, school.admin.ctx, { justificationId: j.justification.id, caps: CAPS.admin });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("attendance.attachment_required");
    unwrap(await attachJustificationDocument(world.deps, school.guardian.ctx, { justificationId: j.justification.id, fileName: "certificat.pdf", content: PDF, caps: CAPS.guardian }));
    expect(unwrap(await acceptJustification(world.deps, school.admin.ctx, { justificationId: j.justification.id, caps: CAPS.admin })).justification.status).toBe("ACCEPTED");
    // Une pièce ne s'ajoute plus après la décision.
    const late = await attachJustificationDocument(world.deps, school.guardian.ctx, { justificationId: j.justification.id, fileName: "autre.pdf", content: PDF, caps: CAPS.guardian });
    expect(late.ok).toBe(false);
  });

  it("markWithJustification : pointage + justificatif + acceptation en UNE transaction (tout ou rien)", async () => {
    const occ = addOccurrence(world, school, { date: "2025-09-25" });
    const { session } = unwrap(await openAttendanceSession(world.deps, school.teacher.ctx, { kind: "occurrence", occurrenceId: occ.occurrenceId, caps: CAPS.teacher }));
    const guard = await markWithJustification(world.deps, school.teacher.ctx, { sessionId: session.id, studentId: stu(2).studentId, reasonCode: "ILLNESS", caps: CAPS.teacher });
    expect(guard.ok).toBe(false);

    const requiresPiece = await markWithJustification(world.deps, school.admin.ctx, { sessionId: session.id, studentId: stu(2).studentId, reasonCode: "MEDICAL", caps: CAPS.admin });
    expect(requiresPiece.ok).toBe(false);
    expect(await recordsOf(session.id)).toHaveLength(0); // rien d'écrit

    const done = unwrap(await markWithJustification(world.deps, school.admin.ctx, { sessionId: session.id, studentId: stu(2).studentId, reasonCode: "ILLNESS", comment: "Prévenu par téléphone", caps: CAPS.admin }));
    expect(done.record).toMatchObject({ statusCode: "EXCUSED", originalStatusCode: "ABSENT", excused: true });
    expect(done.justification.justification).toMatchObject({ status: "ACCEPTED", fromDate: "2025-09-25", toDate: "2025-09-25", submittedByKind: "STAFF" });
    expect(done.justification.coveredRecordCount).toBe(1);

    // Un élève hors roster fait échouer le tout.
    const none = await markWithJustification(world.deps, school.admin.ctx, { sessionId: session.id, studentId: newId(), reasonCode: "ILLNESS", caps: CAPS.admin });
    expect(none.ok).toBe(false);
  });
});

describe("garde-fous purs", () => {
  it("l'exécutable de test n'a pas de signature de pièce acceptée", () => {
    expect(EXE[0]).toBe(0x4d);
  });
});
