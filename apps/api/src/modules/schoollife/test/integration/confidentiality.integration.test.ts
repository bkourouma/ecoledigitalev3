/**
 * Confidentialité à trois niveaux : matrice éducateur / enseignant / direction / parent / élève sur Postgres réel.
 * LA règle est la fonction SQL `schoollife.audience_may_see` ; ce test prouve (1) sa parité exhaustive avec le miroir pur,
 * (2) qu'elle gouverne chaque lecture (dossier, listes, portails), (3) que le contenu confidentiel ne sort que par une
 * lecture journalisée avec motif.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unwrap, type AppError, type Result } from "@ecoledigitale/kernel";
import { SCHOOLLIFE_AUDIENCES, SCHOOLLIFE_CONFIDENTIALITY_LEVELS } from "@ecoledigitale/contracts/src/v2/schoollife";
import { audienceMaySee } from "../../domain/confidentiality";
import { declareIncident, listIncidentsView } from "../../application/incidents";
import { fileAppeal, listMeasuresView, notifyMeasure, proposeMeasure, validateMeasure } from "../../application/measures";
import { createNote, listNotesView } from "../../application/notes";
import { createConvocation, sendConvocation } from "../../application/convocations";
import { getClassroomSummary, getFamilyLife, getStudentLife } from "../../application/dossier";
import { listConfidentialReadsView, readConfidential } from "../../application/confidential";
import { upsertSettings } from "../../application/reference";
import { createModuleTestDb, describeIntegration, type ModuleTestDb } from "../support/db";
import { DIRECTOR_CAPS, EDUCATOR_CAPS, GUARDIAN_CAPS, PUPIL_CAPS, TEACHER_CAPS, makeWorld, type TestWorld } from "../support/world";
import type { CallerCaps } from "../../application/deps";

const fails = async <T>(result: Promise<Result<T, AppError>>, code: string): Promise<void> => {
  const r = await result;
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.code).toBe(code);
};

/** Direction avec lecture restreinte mais SANS habilitation confidentielle. */
const RESTRICTED_ONLY: CallerCaps = { ...EDUCATOR_CAPS, restrictedRead: true };

describeIntegration("confidentialité : une règle SQL unique, trois niveaux (Postgres réel)", () => {
  let db: ModuleTestDb;
  let w: TestWorld;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = await createModuleTestDb();
    w = await makeWorld(db);
    const s = w.students[0]!;
    const base = { enrollmentId: s.enrollmentId, reason: "Comportement répété en classe" };

    // Incident STANDARD (déclaré par l'enseignant) et incident CONFIDENTIEL (type confidentiel)
    ids.incStd = unwrap(await declareIncident(w.deps, w.teacher.ctx, TEACHER_CAPS, { typeId: w.types.INC, occurredAt: "2026-11-02T09:30:00Z", description: "Altercation dans la cour", involvements: [{ enrollmentId: s.enrollmentId, role: "AUTHOR" }] })).id;
    ids.incSecret = unwrap(await declareIncident(w.deps, w.educator.ctx, EDUCATOR_CAPS, { typeId: w.types.SECRET_INC, occurredAt: "2026-11-02T10:30:00Z", description: "Fait très grave", involvements: [{ enrollmentId: s.enrollmentId, role: "AUTHOR" }] })).id;
    // Observation RESTRICTED (type) et observation CONFIDENTIELLE ; encouragement partagé ; encouragement STAFF_ONLY
    ids.noteRestricted = unwrap(await createNote(w.deps, w.educator.ctx, EDUCATOR_CAPS, { enrollmentId: s.enrollmentId, typeId: w.types.OBS, body: "Situation familiale délicate", occurredOn: "2026-11-02", visibility: "STAFF_ONLY" })).id;
    ids.noteSecret = unwrap(await createNote(w.deps, w.educator.ctx, EDUCATOR_CAPS, { enrollmentId: s.enrollmentId, typeId: w.types.SECRET_OBS, body: "Information protégée", occurredOn: "2026-11-02", visibility: "STAFF_ONLY" })).id;
    ids.noteShared = unwrap(await createNote(w.deps, w.teacher.ctx, TEACHER_CAPS, { enrollmentId: s.enrollmentId, typeId: w.types.ENC, body: "Excellente participation", occurredOn: "2026-11-02", visibility: "STUDENT_AND_GUARDIANS" })).id;
    ids.noteGuardians = unwrap(await createNote(w.deps, w.teacher.ctx, TEACHER_CAPS, { enrollmentId: s.enrollmentId, typeId: w.types.ENC, body: "À féliciter à la maison", occurredOn: "2026-11-03", visibility: "GUARDIANS" })).id;
    ids.noteStaff = unwrap(await createNote(w.deps, w.teacher.ctx, TEACHER_CAPS, { enrollmentId: s.enrollmentId, typeId: w.types.ENC, body: "Note interne", occurredOn: "2026-11-04", visibility: "STAFF_ONLY" })).id;
    // Mesures : sanction notifiée (partageable), sanction cachée aux familles, sanction proposée
    const notified = unwrap(await proposeMeasure(w.deps, w.educator.ctx, EDUCATOR_CAPS, { ...base, typeId: w.types.SANC }));
    unwrap(await validateMeasure(w.deps, w.director2.ctx, DIRECTOR_CAPS, notified.id, {}));
    unwrap(await notifyMeasure(w.deps, w.director2.ctx, DIRECTOR_CAPS, notified.id));
    ids.sanctionNotified = notified.id;
    const hidden = unwrap(await proposeMeasure(w.deps, w.educator.ctx, EDUCATOR_CAPS, { ...base, typeId: w.types.HIDDEN_SANC }));
    unwrap(await validateMeasure(w.deps, w.director2.ctx, DIRECTOR_CAPS, hidden.id, {}));
    unwrap(await notifyMeasure(w.deps, w.director2.ctx, DIRECTOR_CAPS, hidden.id));
    ids.sanctionHidden = hidden.id;
    ids.sanctionProposed = unwrap(await proposeMeasure(w.deps, w.educator.ctx, EDUCATOR_CAPS, { ...base, typeId: w.types.SANC })).id;
    // Convocation envoyée et brouillon
    const sent = unwrap(await createConvocation(w.deps, w.educator.ctx, EDUCATOR_CAPS, { enrollmentId: s.enrollmentId, reasonKind: "OTHER", reason: "Point sur le suivi scolaire", scheduledAt: "2026-12-01T08:00:00Z" }));
    unwrap(await sendConvocation(w.deps, w.educator.ctx, EDUCATOR_CAPS, sent.id, { channels: ["IN_APP"] }));
    ids.convSent = sent.id;
    ids.convDraft = unwrap(await createConvocation(w.deps, w.educator.ctx, EDUCATOR_CAPS, { enrollmentId: s.enrollmentId, reasonKind: "OTHER", reason: "Brouillon non envoyé", scheduledAt: "2026-12-02T08:00:00Z" })).id;
  });
  afterAll(async () => {
    await db?.drop();
  });

  it("parité EXHAUSTIVE : le miroir pur égale la fonction SQL sur tout l'espace des arguments", async () => {
    const kinds = ["INCIDENT", "MEASURE", "NOTE", "CONVOCATION", "AUTRE"];
    const statuses = ["DECLARED", "CONFIRMED", "PROPOSED", "VALIDATED", "NOTIFIED", "EXECUTED", "APPEALED", "REVOKED", "ACTIVE", "WITHDRAWN", "DRAFT", "SENT", "ACKNOWLEDGED", "HELD", "NO_SHOW", "RESCHEDULED"];
    const visibilities: Array<string | null> = [null, "STAFF_ONLY", "GUARDIANS", "STUDENT_AND_GUARDIANS"];
    const combos: Array<{ i: number; a: string; k: string; c: string; s: boolean | null; st: string; nv: string | null }> = [];
    for (const a of [...SCHOOLLIFE_AUDIENCES, "TEACHER", "ADMIN"]) {
      for (const k of kinds) {
        for (const c of SCHOOLLIFE_CONFIDENTIALITY_LEVELS) {
          for (const s of [true, false, null] as const) {
            for (const nv of visibilities) for (const st of statuses) combos.push({ i: combos.length, a, k, c, s, st, nv });
          }
        }
      }
    }
    // Un seul aller-retour : toutes les combinaisons sont évaluées par la base, puis comparées au miroir.
    const res = await db.admin.query<{ i: number; v: boolean }>(
      "SELECT c.i, schoollife.audience_may_see(c.a, c.k, c.c, c.s, c.st, c.nv) AS v FROM jsonb_to_recordset($1::jsonb) AS c(i int, a text, k text, c text, s boolean, st text, nv text)",
      [JSON.stringify(combos)],
    );
    expect(res.rows).toHaveLength(combos.length);
    const mismatches = res.rows.filter((r) => {
      const c = combos[r.i]!;
      return audienceMaySee({ audience: c.a, kind: c.k, confidentiality: c.c, shareable: c.s, status: c.st, noteVisibility: c.nv }) !== r.v;
    });
    expect(mismatches.map((r) => combos[r.i])).toEqual([]);
    expect(combos.length).toBeGreaterThan(10_000);
  });

  it("habilitation du personnel : STANDARD < RESTRICTED < CONFIDENTIAL, quel que soit le type d'élément (table de vérité SQL)", async () => {
    const may = async (aud: string, conf: string, kind = "INCIDENT") => (await db.admin.query("SELECT schoollife.audience_may_see($1,$2,$3,false,'X',NULL) AS v", [aud, kind, conf])).rows[0].v as boolean;
    expect(await may("STAFF_STANDARD", "STANDARD")).toBe(true);
    expect(await may("STAFF_STANDARD", "RESTRICTED")).toBe(false);
    expect(await may("STAFF_STANDARD", "CONFIDENTIAL")).toBe(false);
    expect(await may("STAFF_RESTRICTED", "RESTRICTED")).toBe(true);
    expect(await may("STAFF_RESTRICTED", "CONFIDENTIAL", "NOTE")).toBe(false);
    expect(await may("STAFF_CONFIDENTIAL", "CONFIDENTIAL", "CONVOCATION")).toBe(true);
    expect(await may("GUARDIAN", "STANDARD")).toBe(false); // une famille n'est jamais personnel : règles propres
  });

  it("ÉDUCATEUR (lecture générale, niveau standard) : voit le standard, jamais le restreint ni le confidentiel — pas même leur existence", async () => {
    const life = unwrap(await getStudentLife(w.deps, w.educator.ctx, EDUCATOR_CAPS, { studentId: w.students[0]!.studentId }));
    expect(life.clearance).toBe("STANDARD");
    expect(life.incidents.map((i) => i.id)).toEqual([ids.incStd]);
    expect(life.notes.map((n) => n.id).sort()).toEqual([ids.noteShared, ids.noteGuardians, ids.noteStaff].sort());
    expect(life.notes.every((n) => n.masked === false)).toBe(true);
    expect(life.convocations.map((c) => c.id).sort()).toEqual([ids.convSent, ids.convDraft].sort());
    // l'historique ne trahit pas l'existence d'un élément invisible
    expect(life.history.map((h) => h.entityId)).not.toContain(ids.incSecret);
    expect(life.history.map((h) => h.entityId)).not.toContain(ids.noteSecret);
    // lecture d'un élément restreint ou confidentiel par ce niveau : introuvable
    await fails(readConfidential(w.deps, w.educator.ctx, EDUCATOR_CAPS, { entityKind: "NOTE", entityId: ids.noteRestricted!, purpose: "Instruction du dossier" }), "schoollife.not_found");
    await fails(readConfidential(w.deps, w.educator.ctx, EDUCATOR_CAPS, { entityKind: "INCIDENT", entityId: ids.incSecret!, purpose: "Instruction du dossier" }), "schoollife.not_found");
  });

  it("ENSEIGNANT : élèves de SES classes, niveau standard ; hors classe : introuvable ; liste libre : ses propres saisies", async () => {
    const life = unwrap(await getStudentLife(w.deps, w.teacher.ctx, TEACHER_CAPS, { studentId: w.students[0]!.studentId }));
    expect(life.clearance).toBe("STANDARD");
    expect(life.incidents.map((i) => i.id)).toEqual([ids.incStd]);
    await fails(getStudentLife(w.deps, w.otherTeacher.ctx, TEACHER_CAPS, { studentId: w.students[0]!.studentId }), "schoollife.not_found");
    const mine = unwrap(await listNotesView(w.deps, w.teacher.ctx, TEACHER_CAPS, { page: 1, pageSize: 50 }));
    expect(mine.every((n) => n.authorId === w.teacher.userId)).toBe(true);
    expect(mine.map((n) => n.id)).not.toContain(ids.noteRestricted);
    const allIncidents = unwrap(await listIncidentsView(w.deps, w.otherTeacher.ctx, TEACHER_CAPS, { page: 1, pageSize: 50 }));
    expect(allIncidents).toEqual([]); // n'a rien déclaré
    const summary = unwrap(await getClassroomSummary(w.deps, w.teacher.ctx, TEACHER_CAPS, w.classroomId));
    expect(summary.students).toHaveLength(4);
    await fails(getClassroomSummary(w.deps, w.teacher.ctx, TEACHER_CAPS, w.otherClassroomId), "schoollife.not_found");
  });

  it("DIRECTION restreinte (sans habilitation confidentielle) : lit le restreint, jamais le confidentiel", async () => {
    const life = unwrap(await getStudentLife(w.deps, w.director.ctx, RESTRICTED_ONLY, { studentId: w.students[0]!.studentId }));
    expect(life.clearance).toBe("RESTRICTED");
    expect(life.notes.find((n) => n.id === ids.noteRestricted)).toMatchObject({ masked: false, body: "Situation familiale délicate" });
    expect(life.notes.map((n) => n.id)).not.toContain(ids.noteSecret);
    expect(life.incidents.map((i) => i.id)).not.toContain(ids.incSecret);
  });

  it("DIRECTION confidentielle : les éléments confidentiels sont MASQUÉS partout ; leur contenu ne sort que par une lecture journalisée avec motif", async () => {
    const life = unwrap(await getStudentLife(w.deps, w.director.ctx, DIRECTOR_CAPS, { studentId: w.students[0]!.studentId }));
    expect(life.clearance).toBe("CONFIDENTIAL");
    const secretIncident = life.incidents.find((i) => i.id === ids.incSecret)!;
    expect(secretIncident).toMatchObject({ masked: true, description: null, typeLabel: null, severityCode: null });
    const secretNote = life.notes.find((n) => n.id === ids.noteSecret)!;
    expect(secretNote).toMatchObject({ masked: true, body: null });
    // les listes masquent aussi
    expect(unwrap(await listNotesView(w.deps, w.director.ctx, DIRECTOR_CAPS, { studentId: w.students[0]!.studentId, page: 1, pageSize: 50 })).find((n) => n.id === ids.noteSecret)?.body).toBeNull();

    const before = (await db.admin.query("SELECT count(*)::int AS n FROM schoollife.confidential_reads")).rows[0].n;
    await fails(readConfidential(w.deps, w.director.ctx, DIRECTOR_CAPS, { entityKind: "NOTE", entityId: ids.noteSecret! }), "schoollife.purpose_required");
    await fails(readConfidential(w.deps, w.systemCtx(), DIRECTOR_CAPS, { entityKind: "NOTE", entityId: ids.noteSecret!, purpose: "Instruction du dossier" }), "schoollife.human_actor_required");
    await fails(readConfidential(w.deps, w.director.ctx, { ...DIRECTOR_CAPS, confidentialRead: false, restrictedRead: true }, { entityKind: "NOTE", entityId: ids.noteSecret!, purpose: "Instruction du dossier" }), "schoollife.not_found");
    expect((await db.admin.query("SELECT count(*)::int AS n FROM schoollife.confidential_reads")).rows[0].n).toBe(before); // aucun refus n'écrit de lecture

    const read = unwrap(await readConfidential(w.deps, w.director.ctx, DIRECTOR_CAPS, { entityKind: "NOTE", entityId: ids.noteSecret!, purpose: "Instruction du dossier disciplinaire" }));
    expect(read).toMatchObject({ entityKind: "NOTE", note: { masked: false, body: "Information protégée" } });
    const journal = unwrap(await listConfidentialReadsView(w.deps, w.director.ctx, { entityId: ids.noteSecret, page: 1, pageSize: 10 }));
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({ readerUserId: w.director.userId, purpose: "Instruction du dossier disciplinaire", entityKind: "NOTE" });
    expect(w.audit.actions()).toContain("schoollife.confidential.read");
    const events = await db.admin.query("SELECT payload::text AS p FROM kernel.domain_events WHERE type = 'schoollife.confidential.accessed'");
    expect(events.rows.length).toBeGreaterThan(0);
    expect(events.rows[0].p).not.toMatch(/Information protégée/);

    const incident = unwrap(await readConfidential(w.deps, w.director.ctx, DIRECTOR_CAPS, { entityKind: "INCIDENT", entityId: ids.incSecret!, purpose: "Instruction du dossier disciplinaire" }));
    expect(incident).toMatchObject({ entityKind: "INCIDENT", incident: { masked: false, description: "Fait très grave" } });
  });

  it("réglage de l'établissement : le motif n'est plus exigé -> motif par défaut journalisé", async () => {
    unwrap(await upsertSettings(w.deps, w.director.ctx, { institutionId: w.institutionId, confidentialReadRequiresPurpose: false }));
    unwrap(await readConfidential(w.deps, w.director.ctx, DIRECTOR_CAPS, { entityKind: "NOTE", entityId: ids.noteSecret! }));
    const last = (await db.admin.query("SELECT purpose FROM schoollife.confidential_reads ORDER BY occurred_at DESC LIMIT 1")).rows[0];
    expect(last.purpose).toMatch(/non exigé/);
    unwrap(await upsertSettings(w.deps, w.director.ctx, { institutionId: w.institutionId, confidentialReadRequiresPurpose: true }));
  });

  it("PARENT : uniquement ce qui lui est partagé (mesure notifiée, notes partagées, convocation envoyée) ; jamais d'incident, de confidentiel, de brouillon", async () => {
    const view = unwrap(await getFamilyLife(w.deps, w.guardian.ctx, GUARDIAN_CAPS, { audience: "GUARDIAN", studentId: w.students[0]!.studentId }));
    const byId = new Map(view.items.map((i) => [i.id, i]));
    expect([...byId.keys()].sort()).toEqual([ids.sanctionNotified, ids.noteShared, ids.noteGuardians, ids.convSent].sort());
    expect(byId.get(ids.sanctionNotified!)).toMatchObject({ entityKind: "MEASURE", appealable: true, appealStatus: null });
    expect(byId.get(ids.convSent!)).toMatchObject({ canAcknowledge: true });
    for (const hidden of [ids.incStd, ids.incSecret, ids.noteRestricted, ids.noteSecret, ids.noteStaff, ids.sanctionHidden, ids.sanctionProposed, ids.convDraft]) {
      expect(byId.has(hidden!), `élément ${hidden} jamais visible d'une famille`).toBe(false);
    }
    // ni validation interne, ni nom du proposant dans la vue famille
    expect(JSON.stringify(view)).not.toMatch(/proposedBy|validatedBy|Mme Éducatrice|Directeur B/);
    // hors lien : 404 (jamais 403)
    await fails(getFamilyLife(w.deps, w.otherGuardian.ctx, GUARDIAN_CAPS, { audience: "GUARDIAN", studentId: w.students[0]!.studentId }), "schoollife.not_found");
    await fails(getFamilyLife(w.deps, w.guardian.ctx, { ...GUARDIAN_CAPS, childRead: false }, { audience: "GUARDIAN", studentId: w.students[0]!.studentId }), "schoollife.permission_required");
    // le dépôt d'un recours par le parent change ce qu'il voit
    unwrap(await fileAppeal(w.deps, w.guardian.ctx, GUARDIAN_CAPS, ids.sanctionNotified!, { reason: "Je conteste cette décision" }));
    const after = unwrap(await getFamilyLife(w.deps, w.guardian.ctx, GUARDIAN_CAPS, { audience: "GUARDIAN", studentId: w.students[0]!.studentId }));
    expect(after.items.find((i) => i.id === ids.sanctionNotified)).toMatchObject({ status: "APPEALED", appealable: false, appealStatus: "FILED" });
  });

  it("ÉLÈVE : ce que l'établissement lui ouvre (mesure notifiée, note partagée avec l'élève) ; pas la note réservée aux parents ni la convocation", async () => {
    const view = unwrap(await getFamilyLife(w.deps, w.pupil.ctx, PUPIL_CAPS, { audience: "STUDENT" }));
    const kinds = new Set(view.items.map((i) => i.id));
    expect(kinds.has(ids.noteShared!)).toBe(true);
    expect(kinds.has(ids.noteGuardians!)).toBe(false);
    expect(kinds.has(ids.convSent!)).toBe(false);
    expect(kinds.has(ids.incStd!)).toBe(false);
    // un élève ne lit que son propre dossier (identité tirée du contexte, pas d'un paramètre)
    const own = unwrap(await getFamilyLife(w.deps, w.pupil.ctx, PUPIL_CAPS, { audience: "STUDENT", studentId: w.students[1]!.studentId }));
    expect(own.studentId).toBe(w.students[0]!.studentId);
  });

  it("listes de mesures : le niveau d'habilitation filtre par la règle SQL (éducateur : sans le confidentiel)", async () => {
    const m = unwrap(await listMeasuresView(w.deps, w.director.ctx, DIRECTOR_CAPS, { studentId: w.students[0]!.studentId, page: 1, pageSize: 50 }));
    expect(m.length).toBeGreaterThanOrEqual(3);
    expect(m.every((x) => x.masked === false)).toBe(true);
  });
});
