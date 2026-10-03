/**
 * Dossier d'orientation vu par la famille et par l'élève (lecture), Postgres réel + RLS : lien tuteur relu (404 hors lien), jamais de
 * notes internes, de vœux du personnel, de décision avant sa visibilité, ni de données d'un autre élève ; isolation entre tenants.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { councilsFamilyOrientationDtoSchema } from "@ecoledigitale/contracts/src/v2/councils";
import { createModuleTestDb, describeIntegration, type ModuleTestDb } from "../support/db";
import { DIRECTOR_CAPS, GUARDIAN_CAPS, PUPIL_CAPS, SECRETARY_CAPS, councilOn, freshClassroom, makeWorld, type FreshClass, type TestWorld } from "../support/world";
import { getAgenda, prepareCouncil } from "../../application/agenda";
import { closeCouncil, listParticipantsView, openCouncil } from "../../application/councils";
import { recordDecision } from "../../application/deliberation";
import { getChildOrientation, getMyOrientation } from "../../application/family-orientation";
import { generateMinutes, signMinutes } from "../../application/minutes";
import { addWish, createFile, recordConsent, upsertPath } from "../../application/orientation";
import { upsertSettings } from "../../application/reference";

const code = (r: { ok: boolean; error?: { code: string } }): string | undefined => (r.ok ? undefined : r.error?.code);
const SECRET_NOTE = "NOTE-INTERNE-CONFIDENTIELLE: avis defavorable du conseiller";
const STAFF_COMMENT = "AVIS-INTERNE-DU-PERSONNEL";

describeIntegration("orientation vue par la famille et l'élève (Postgres réel, RLS)", () => {
  let db: ModuleTestDb;
  let a: TestWorld;
  let b: TestWorld;
  beforeAll(async () => {
    db = await createModuleTestDb();
    a = await makeWorld(db);
    b = await makeWorld(db);
  }, 120_000);
  afterAll(async () => {
    await db?.drop();
  });

  async function signedReorientation(w: TestWorld, cls: FreshClass, target: { programId: string; gradeLevelId: string }) {
    const d = w.director.ctx;
    const council = await councilOn(w, cls, { scope: "YEAR" });
    unwrap(await prepareCouncil(w.deps, d, DIRECTOR_CAPS, council.id));
    unwrap(await openCouncil(w.deps, d, DIRECTOR_CAPS, council.id, {}));
    const president = unwrap(await listParticipantsView(w.deps, d, DIRECTOR_CAPS, council.id)).find((p) => p.councilFunction === "PRESIDENT")!;
    const items = unwrap(await getAgenda(w.deps, d, DIRECTOR_CAPS, council.id)).items;
    for (const it of items) {
      unwrap(await recordDecision(w.deps, d, DIRECTOR_CAPS, it.id, { decisionTypeId: w.decisionTypes.REORIENTATION!, deciderParticipantId: president.id, mode: "CONSENSUS", justification: "Réorientation souhaitée et justifiée par les résultats.", targetProgramId: target.programId, targetGradeLevelId: target.gradeLevelId, targetLabel: "Série de démonstration" } as never));
    }
    unwrap(await closeCouncil(w.deps, d, DIRECTOR_CAPS, council.id));
    const minutes = unwrap(await generateMinutes(w.deps, w.secretary.ctx, SECRETARY_CAPS, council.id));
    unwrap(await signMinutes(w.deps, d, DIRECTOR_CAPS, minutes.id));
    unwrap(await signMinutes(w.deps, w.secretary.ctx, SECRETARY_CAPS, minutes.id));
    return council;
  }

  it("le tuteur lié lit le dossier de SON enfant : vœux de la famille seulement, parcours proposés, jamais notes ni avis du personnel ; hors lien : 404", async () => {
    const cls = freshClassroom(a, { students: 2 });
    const [mine, other] = [cls.students[0]!, cls.students[1]!];
    const guardian = newId();
    a.ports.addGuardian(guardian, mine.studentId);
    const guardianCtx = a.ctxOf(guardian);
    const t = { programId: newId(), gradeLevelId: newId() };
    unwrap(await upsertPath(a.deps, a.director.ctx, { institutionId: null, kind: "ORIENTATION", fromProgramId: null, fromGradeLevelId: a.gradeLevelId, toProgramId: t.programId, toGradeLevelId: t.gradeLevelId, label: "Parcours de démonstration", requiresCouncilOpinion: false, requiresGuardianConsent: true, active: true, sourceKind: "placeholder" }));
    // un parcours INACTIF et un parcours d'un autre niveau ne sont pas proposés
    unwrap(await upsertPath(a.deps, a.director.ctx, { institutionId: null, kind: "ORIENTATION", fromProgramId: null, fromGradeLevelId: a.gradeLevelId, toProgramId: newId(), toGradeLevelId: newId(), label: "Inactif", requiresCouncilOpinion: false, requiresGuardianConsent: false, active: false, sourceKind: "placeholder" }));
    unwrap(await upsertPath(a.deps, a.director.ctx, { institutionId: null, kind: "ORIENTATION", fromProgramId: null, fromGradeLevelId: newId(), toProgramId: newId(), toGradeLevelId: newId(), label: "Autre niveau", requiresCouncilOpinion: false, requiresGuardianConsent: false, active: true, sourceKind: "placeholder" }));

    const file = unwrap(await createFile(a.deps, a.director.ctx, { enrollmentId: mine.enrollmentId, notes: SECRET_NOTE }));
    const otherFile = unwrap(await createFile(a.deps, a.director.ctx, { enrollmentId: other.enrollmentId, notes: "Dossier de l'autre élève" }));
    unwrap(await addWish(a.deps, a.director.ctx, DIRECTOR_CAPS, file.id, { rank: 2, toProgramId: t.programId, toGradeLevelId: t.gradeLevelId, optionIds: [], source: "STAFF", comment: STAFF_COMMENT }));
    unwrap(await addWish(a.deps, a.director.ctx, DIRECTOR_CAPS, file.id, { rank: 3, toProgramId: t.programId, toGradeLevelId: t.gradeLevelId, optionIds: [], source: "COUNSELLOR", comment: STAFF_COMMENT }));

    // la famille exprime un vœu ; la réponse de l'écriture est elle-même expurgée
    const wished = unwrap(await addWish(a.deps, guardianCtx, GUARDIAN_CAPS, file.id, { rank: 1, toProgramId: t.programId, toGradeLevelId: t.gradeLevelId, optionIds: [], source: "STAFF", comment: "Souhait de la famille" }));
    expect(wished.notes).toBeNull();
    expect(wished.decisionId).toBeNull();
    expect(JSON.stringify(wished)).not.toContain(STAFF_COMMENT);
    expect(JSON.stringify(wished)).not.toContain("SECRET");

    const view = unwrap(await getChildOrientation(a.deps, guardianCtx, GUARDIAN_CAPS, mine.studentId));
    expect(councilsFamilyOrientationDtoSchema.safeParse(view).success).toBe(true);
    expect(view.studentId).toBe(mine.studentId);
    expect(view.file).toMatchObject({ id: file.id, stage: "WISHES_COLLECTED", guardianConsent: "NOT_REQUIRED", wishesOpen: true, consentOpen: false });
    expect(view.file!.wishes).toHaveLength(1);
    expect(view.file!.wishes[0]).toMatchObject({ rank: 1, source: "GUARDIAN", targetLabel: "Parcours de démonstration", comment: "Souhait de la famille" });
    expect(view.options).toEqual([expect.objectContaining({ label: "Parcours de démonstration", toProgramId: t.programId, requiresGuardianConsent: true })]);
    const text = JSON.stringify(view);
    for (const forbidden of [SECRET_NOTE, STAFF_COMMENT, "notes", "decisionId", "expressedBy", "withdrawnAt", otherFile.id, "Dossier de l'autre", "Inactif", "Autre niveau"]) expect(text, forbidden).not.toContain(forbidden);

    // hors lien (autre tuteur, élève du même établissement, identifiant inconnu) : 404 uniforme, jamais 403
    const stranger = await getChildOrientation(a.deps, a.ctxOf(newId()), GUARDIAN_CAPS, mine.studentId);
    expect(code(stranger)).toBe("councils.not_found");
    expect(!stranger.ok && stranger.error.httpStatus).toBe(404);
    const otherChild = await getChildOrientation(a.deps, guardianCtx, GUARDIAN_CAPS, other.studentId);
    expect(!otherChild.ok && otherChild.error.httpStatus).toBe(404);
    const unknown = await getChildOrientation(a.deps, guardianCtx, GUARDIAN_CAPS, newId());
    expect(!unknown.ok && unknown.error.httpStatus).toBe(404);
    expect(JSON.stringify(otherChild)).toBe(JSON.stringify(stranger).replace(mine.studentId, other.studentId));
    // sans la permission « enfant » : refusé (le garde de route l'exige aussi)
    expect(code(await getChildOrientation(a.deps, guardianCtx, SECRETARY_CAPS, mine.studentId))).toBe("councils.permission_required");
  });

  it("l'accord de la famille : visible et modifiable tant que le dossier n'est pas appliqué ; la réponse reste expurgée", async () => {
    const cls = freshClassroom(a, { students: 1 });
    const s = cls.students[0]!;
    const guardian = newId();
    a.ports.addGuardian(guardian, s.studentId);
    const file = unwrap(await createFile(a.deps, a.director.ctx, { enrollmentId: s.enrollmentId, notes: SECRET_NOTE }));
    const gctx = a.ctxOf(guardian);
    // l'accord n'est demandé que lorsqu'un parcours qui l'exige est retenu : on simule ce passage par la base d'administration
    await db.admin.query("UPDATE councils.orientation_files SET guardian_consent = 'PENDING' WHERE id = $1", [file.id]);
    expect(unwrap(await getChildOrientation(a.deps, gctx, GUARDIAN_CAPS, s.studentId)).file).toMatchObject({ guardianConsent: "PENDING", consentOpen: true });
    const given = unwrap(await recordConsent(a.deps, gctx, GUARDIAN_CAPS, file.id, { state: "GIVEN" }));
    expect(given.notes).toBeNull();
    const after = unwrap(await getChildOrientation(a.deps, gctx, GUARDIAN_CAPS, s.studentId));
    expect(after.file).toMatchObject({ guardianConsent: "GIVEN", consentOpen: true });
    expect(after.file!.consentRecordedAt).not.toBeNull();
    expect(JSON.stringify(after)).not.toContain(guardian); // jamais l'identifiant de qui a enregistré l'accord
  });

  it("visibilité de la décision : l'état reste « vœux recueillis » tant que l'établissement ne l'ouvre pas à la famille (NEVER / AFTER_SIGNATURE)", async () => {
    const cls = freshClassroom(a, { students: 1 });
    const s = cls.students[0]!;
    const guardian = newId();
    a.ports.addGuardian(guardian, s.studentId);
    const gctx = a.ctxOf(guardian);
    const t = { programId: newId(), gradeLevelId: newId() };
    unwrap(await createFile(a.deps, a.director.ctx, { enrollmentId: s.enrollmentId, notes: SECRET_NOTE }));
    unwrap(await upsertSettings(a.deps, a.director.ctx, { institutionId: a.institutionId, guardianVisibility: "NEVER" }));
    // la notification des tuteurs échoue : la décision n'est jamais « notifiée »
    const original = a.ports.notifications.notifyGuardians;
    a.ports.notifications.notifyGuardians = async () => {
      throw new Error("aucun tuteur joignable");
    };
    try {
      await signedReorientation(a, cls, t);
    } finally {
      a.ports.notifications.notifyGuardians = original;
    }
    const real = await db.admin.query("SELECT status, decision_id FROM councils.orientation_files WHERE student_id = $1", [s.studentId]);
    expect(real.rows[0]).toMatchObject({ status: "DECIDED" });
    expect(real.rows[0].decision_id).toBeTruthy();

    for (const visibility of ["NEVER", "AFTER_NOTIFICATION"] as const) {
      unwrap(await upsertSettings(a.deps, a.director.ctx, { institutionId: a.institutionId, guardianVisibility: visibility }));
      const hidden = unwrap(await getChildOrientation(a.deps, gctx, GUARDIAN_CAPS, s.studentId));
      expect(hidden.file!.stage, visibility).toBe("WISHES_COLLECTED");
      expect(JSON.stringify(hidden)).not.toContain(real.rows[0].decision_id);
    }
    unwrap(await upsertSettings(a.deps, a.director.ctx, { institutionId: a.institutionId, guardianVisibility: "AFTER_SIGNATURE" }));
    const shown = unwrap(await getChildOrientation(a.deps, gctx, GUARDIAN_CAPS, s.studentId));
    expect(shown.file!.stage).toBe("DECIDED");
    expect(JSON.stringify(shown)).not.toContain(real.rows[0].decision_id); // même visible : jamais l'identifiant de la décision
    unwrap(await upsertSettings(a.deps, a.director.ctx, { institutionId: a.institutionId, guardianVisibility: "AFTER_NOTIFICATION" }));
  });

  it("l'élève lit SON dossier par son compte, en lecture seule (pas de vœux ni d'accord à modifier, pas de destinations) ; un compte sans dossier : 404", async () => {
    const cls = freshClassroom(a, { students: 2 });
    const [me, other] = [cls.students[0]!, cls.students[1]!];
    a.ports.linkStudentUser(a.pupil.userId, me.studentId);
    unwrap(await upsertPath(a.deps, a.director.ctx, { institutionId: null, kind: "ORIENTATION", fromProgramId: null, fromGradeLevelId: a.gradeLevelId, toProgramId: newId(), toGradeLevelId: newId(), label: "Parcours élève", requiresCouncilOpinion: false, requiresGuardianConsent: false, active: true, sourceKind: "placeholder" }));
    const file = unwrap(await createFile(a.deps, a.director.ctx, { enrollmentId: me.enrollmentId, notes: SECRET_NOTE }));
    unwrap(await createFile(a.deps, a.director.ctx, { enrollmentId: other.enrollmentId, notes: "Dossier du voisin" }));
    unwrap(await addWish(a.deps, a.director.ctx, DIRECTOR_CAPS, file.id, { rank: 1, toProgramId: newId(), toGradeLevelId: newId(), optionIds: [], source: "STUDENT", comment: "Mon vœu" }));
    const view = unwrap(await getMyOrientation(a.deps, a.pupil.ctx, PUPIL_CAPS));
    expect(view.studentId).toBe(me.studentId);
    expect(view.file).toMatchObject({ id: file.id, wishesOpen: false, consentOpen: false });
    expect(view.file!.wishes).toEqual([expect.objectContaining({ rank: 1, source: "STUDENT", comment: "Mon vœu" })]);
    expect(view.options).toEqual([]);
    const text = JSON.stringify(view);
    expect(text).not.toContain(SECRET_NOTE);
    expect(text).not.toContain("Dossier du voisin");
    // un parent n'a pas le portail élève ; l'élève ne lit pas par l'identifiant d'un autre ; un compte sans fiche élève : 404
    expect(code(await getMyOrientation(a.deps, a.guardian.ctx, GUARDIAN_CAPS))).toBe("councils.permission_required");
    const nobody = await getMyOrientation(a.deps, a.ctxOf(newId()), PUPIL_CAPS);
    expect(!nobody.ok && nobody.error.httpStatus).toBe(404);
    // l'élève ne peut ni exprimer de vœu ni donner l'accord (permission « enfant » requise : 404, jamais l'existence du dossier)
    const wish = await addWish(a.deps, a.pupil.ctx, PUPIL_CAPS, file.id, { rank: 2, toProgramId: newId(), toGradeLevelId: newId(), optionIds: [], source: "STUDENT" });
    expect(code(wish)).toBe("councils.not_found");
  });

  it("isolation A/B (RLS) : le tenant B ne voit rien du dossier du tenant A, même avec un lien tuteur forgé dans B", async () => {
    const cls = freshClassroom(a, { students: 1 });
    const s = cls.students[0]!;
    const file = unwrap(await createFile(a.deps, a.director.ctx, { enrollmentId: s.enrollmentId, notes: SECRET_NOTE }));
    const guardian = newId();
    a.ports.addGuardian(guardian, s.studentId);
    unwrap(await addWish(a.deps, a.ctxOf(guardian), GUARDIAN_CAPS, file.id, { rank: 1, toProgramId: newId(), toGradeLevelId: newId(), optionIds: [], source: "GUARDIAN" }));
    expect(unwrap(await getChildOrientation(a.deps, a.ctxOf(guardian), GUARDIAN_CAPS, s.studentId)).file).not.toBeNull();

    // sans lien dans B : 404
    const noLink = await getChildOrientation(b.deps, b.ctxOf(guardian), GUARDIAN_CAPS, s.studentId);
    expect(!noLink.ok && noLink.error.httpStatus).toBe(404);
    // lien forgé dans le port de B (cas adversaire) : la base (RLS) ne rend aucune ligne du tenant A
    b.ports.addGuardian(guardian, s.studentId);
    const forged = unwrap(await getChildOrientation(b.deps, b.ctxOf(guardian), GUARDIAN_CAPS, s.studentId));
    expect(forged.file).toBeNull();
    expect(forged.options).toEqual([]);
    // ni l'écriture : le dossier de A est introuvable depuis B
    const write = await addWish(b.deps, b.ctxOf(guardian), GUARDIAN_CAPS, file.id, { rank: 2, toProgramId: newId(), toGradeLevelId: newId(), optionIds: [], source: "GUARDIAN" });
    expect(code(write)).toBe("councils.not_found");
    // et rien n'a fui dans la base du tenant A
    const rows = await db.admin.query("SELECT count(*)::int AS n FROM councils.orientation_wishes WHERE file_id = $1 AND tenant_id = $2", [file.id, a.tenantId]);
    expect(rows.rows[0].n).toBe(1);
  });
});
