/**
 * Portails (visibilité des décisions selon l'établissement, lien tuteur relu, jamais la suggestion / le vote / la justification) et
 * orientation (parcours en données, dérogation motivée, accord de la famille, transfert appliqué à academic, reprise après échec).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { createModuleTestDb, describeIntegration, type ModuleTestDb } from "../support/db";
import { DIRECTOR_CAPS, GUARDIAN_CAPS, PUPIL_CAPS, SECRETARY_CAPS, councilOn, freshClassroom, makeWorld, type FreshClass, type TestWorld } from "../support/world";
import { getAgenda, prepareCouncil } from "../../application/agenda";
import { closeCouncil, listParticipantsView, openCouncil } from "../../application/councils";
import { recordDecision } from "../../application/deliberation";
import { listEffectsOfCouncilView, retryEffect } from "../../application/effects";
import { generateMinutes, signMinutes } from "../../application/minutes";
import { addWish, applyTransfer, cancelTransfer, createFile, createTransfer, listFilesView, listPathsView, recordConsent, upsertPath } from "../../application/orientation";
import { getChildDecisions, getMyDecisions } from "../../application/reads";
import { upsertSettings } from "../../application/reference";

const code = (r: { ok: boolean; error?: { code: string } }): string | undefined => (r.ok ? undefined : r.error?.code);

describeIntegration("portails et orientation (Postgres réel)", () => {
  let db: ModuleTestDb;
  let w: TestWorld;
  beforeAll(async () => {
    db = await createModuleTestDb();
    w = await makeWorld(db);
  }, 120_000);
  afterAll(async () => {
    await db?.drop();
  });

  async function signedCouncil(cls: FreshClass, decisionType: string, extra: Record<string, unknown> = {}) {
    const d = w.director.ctx;
    const council = await councilOn(w, cls, { scope: "YEAR" });
    unwrap(await prepareCouncil(w.deps, d, DIRECTOR_CAPS, council.id));
    unwrap(await openCouncil(w.deps, d, DIRECTOR_CAPS, council.id, {}));
    const president = unwrap(await listParticipantsView(w.deps, d, DIRECTOR_CAPS, council.id)).find((p) => p.councilFunction === "PRESIDENT")!;
    const items = unwrap(await getAgenda(w.deps, d, DIRECTOR_CAPS, council.id)).items;
    const decisions = [];
    for (const it of items) decisions.push(unwrap(await recordDecision(w.deps, d, DIRECTOR_CAPS, it.id, { decisionTypeId: w.decisionTypes[decisionType]!, deciderParticipantId: president.id, mode: "CONSENSUS", ...extra } as never)));
    unwrap(await closeCouncil(w.deps, d, DIRECTOR_CAPS, council.id));
    const minutes = unwrap(await generateMinutes(w.deps, w.secretary.ctx, SECRETARY_CAPS, council.id));
    unwrap(await signMinutes(w.deps, d, DIRECTOR_CAPS, minutes.id));
    unwrap(await signMinutes(w.deps, w.secretary.ctx, SECRETARY_CAPS, minutes.id));
    return { council, items, decisions };
  }

  describe("portails famille / élève", () => {
    it("après notification : le tuteur lié voit la décision de SON enfant, jamais la suggestion, le vote ni la justification ; hors lien : 404", async () => {
      const cls = freshClassroom(w, { students: 2 });
      w.ports.addGuardian(w.guardian.userId, cls.students[0]!.studentId);
      w.ports.addGuardian(w.otherGuardian.userId, cls.students[1]!.studentId);
      w.ports.linkStudentUser(w.pupil.userId, cls.students[0]!.studentId);
      await signedCouncil(cls, "REPEAT", { justification: "Résultats insuffisants constatés pendant toute l'année." });

      const mine = unwrap(await getChildDecisions(w.deps, w.guardian.ctx, GUARDIAN_CAPS, cls.students[0]!.studentId));
      expect(mine.items).toHaveLength(1);
      expect(mine.items[0]).toMatchObject({ decisionTypeLabel: "Redoublement", family: "REPEAT" });
      const text = JSON.stringify(mine);
      expect(text).not.toMatch(/PROMOTED|suggest|votes|justification|Résultats insuffisants|differs|factsHash|decideur|decider/i);
      // un tuteur sans lien avec cet élève : introuvable (jamais 403)
      const foreign = await getChildDecisions(w.deps, w.otherGuardian.ctx, GUARDIAN_CAPS, cls.students[0]!.studentId);
      expect(code(foreign)).toBe("councils.not_found");
      expect(!foreign.ok && foreign.error.httpStatus).toBe(404);
      // l'élève voit ce que sa famille voit, par son COMPTE
      const me = unwrap(await getMyDecisions(w.deps, w.pupil.ctx, PUPIL_CAPS));
      expect(me.studentId).toBe(cls.students[0]!.studentId);
      expect(me.items).toHaveLength(1);
      // un parent n'a pas le portail élève et inversement
      expect(code(await getMyDecisions(w.deps, w.guardian.ctx, GUARDIAN_CAPS))).toBe("councils.permission_required");
    });

    it("guardianVisibility : NEVER masque tout ; AFTER_SIGNATURE montre dès la signature même sans notification ; AFTER_NOTIFICATION attend la notification", async () => {
      const cls = freshClassroom(w, { students: 1 });
      const g = newId();
      w.ports.addGuardian(g, cls.students[0]!.studentId);
      const guardianCtx = w.ctxOf(g);
      // la notification échoue : l'effet NOTIFY_GUARDIANS est FAILED, la décision n'est donc pas « notifiée »
      const original = w.ports.notifications.notifyGuardians;
      w.ports.notifications.notifyGuardians = async () => {
        throw new Error("aucun tuteur joignable");
      };
      try {
        await signedCouncil(cls, "PASSAGE");
      } finally {
        w.ports.notifications.notifyGuardians = original;
      }
      expect(unwrap(await getChildDecisions(w.deps, guardianCtx, GUARDIAN_CAPS, cls.students[0]!.studentId)).items).toHaveLength(0);
      unwrap(await upsertSettings(w.deps, w.director.ctx, { institutionId: w.institutionId, guardianVisibility: "AFTER_SIGNATURE" }));
      expect(unwrap(await getChildDecisions(w.deps, guardianCtx, GUARDIAN_CAPS, cls.students[0]!.studentId)).items).toHaveLength(1);
      unwrap(await upsertSettings(w.deps, w.director.ctx, { institutionId: w.institutionId, guardianVisibility: "NEVER" }));
      expect(unwrap(await getChildDecisions(w.deps, guardianCtx, GUARDIAN_CAPS, cls.students[0]!.studentId)).items).toHaveLength(0);
      unwrap(await upsertSettings(w.deps, w.director.ctx, { institutionId: w.institutionId, guardianVisibility: "AFTER_NOTIFICATION" }));
    });
  });

  describe("orientation : parcours en données, dérogation, accord de la famille, transfert", () => {
    const target = () => ({ programId: newId(), gradeLevelId: newId() });

    it("aucun parcours livré ; un transfert hors parcours exige une dérogation motivée d'une personne habilitée (sensible, auditée)", async () => {
      expect(unwrap(await listPathsView(w.deps, w.director.ctx)).items).toEqual([]);
      const cls = freshClassroom(w, { students: 1 });
      const t = target();
      const base = { enrollmentId: cls.students[0]!.enrollmentId, toProgramId: t.programId, toGradeLevelId: t.gradeLevelId, effectiveKind: "NEXT_YEAR" as const, decidedVia: "DIRECTOR_ACT" as const, actReference: "Note de service n° 12 (démonstration)" };
      // sans le droit de déroger
      expect(code(await createTransfer(w.deps, w.director.ctx, { ...DIRECTOR_CAPS, orientationOverride: false }, { ...base, overrideReason: "Situation exceptionnelle documentée au dossier." }))).toBe("councils.permission_required");
      // dérogation trop courte
      expect(code(await createTransfer(w.deps, w.director.ctx, DIRECTOR_CAPS, { ...base, overrideReason: "trop court" } as never))).toBe("councils.invalid_input");
      const created = unwrap(await createTransfer(w.deps, w.director.ctx, DIRECTOR_CAPS, { ...base, overrideReason: "Situation exceptionnelle documentée au dossier." }));
      expect(created).toMatchObject({ status: "PLANNED", overridden: true, decidedVia: "DIRECTOR_ACT", pathId: null });
      expect(w.audit.entries.some((e) => e.entry.action === "councils.series_transfer.planned" && e.entry.sensitive === true)).toBe(true);
      // un transfert vivant par inscription
      expect(code(await createTransfer(w.deps, w.director.ctx, DIRECTOR_CAPS, { ...base, overrideReason: "Seconde demande motivée pour la même inscription." }))).toBe("councils.duplicate");
      unwrap(await cancelTransfer(w.deps, w.director.ctx, created.id, { reason: "Annulé par la direction." }));

      // en cours d'année : la classe de destination est exigée à l'application et le changement passe par academic
      const mid = unwrap(await createTransfer(w.deps, w.director.ctx, DIRECTOR_CAPS, { ...base, effectiveKind: "MID_YEAR", effectiveOn: "2026-12-01", overrideReason: "Changement de série en cours d'année motivé par le dossier." }));
      expect(code(await applyTransfer(w.deps, w.director.ctx, mid.id, {}))).toBe("councils.transfer_target_required");
      const dest = freshClassroom(w, { students: 0 });
      expect(unwrap(await applyTransfer(w.deps, w.director.ctx, mid.id, { toClassroomId: dest.classroomId })).status).toBe("APPLIED");
      expect(w.ports.transferCalls.at(-1)).toMatchObject({ enrollmentId: cls.students[0]!.enrollmentId, toClassroomId: dest.classroomId, effectiveOn: "2026-12-01" });
    });

    it("un parcours autorisé (donnée) permet le transfert sans dérogation ; l'accord de la famille conditionne l'application ; elle passe par academic", async () => {
      const cls = freshClassroom(w, { students: 1 });
      const t = target();
      const guardian = newId();
      w.ports.addGuardian(guardian, cls.students[0]!.studentId);
      const path = unwrap(await upsertPath(w.deps, w.director.ctx, { institutionId: null, kind: "SERIES_CHANGE", fromProgramId: null, fromGradeLevelId: w.gradeLevelId, toProgramId: t.programId, toGradeLevelId: t.gradeLevelId, label: "Parcours de démonstration", requiresCouncilOpinion: false, requiresGuardianConsent: true, active: true, sourceKind: "placeholder" }));
      const transfer = unwrap(await createTransfer(w.deps, w.director.ctx, DIRECTOR_CAPS, { enrollmentId: cls.students[0]!.enrollmentId, toProgramId: t.programId, toGradeLevelId: t.gradeLevelId, effectiveKind: "NEXT_YEAR", decidedVia: "DIRECTOR_ACT", actReference: "Acte n° 3" }));
      expect(transfer).toMatchObject({ pathId: path.id, overridden: false });
      // accord de la famille en attente : application bloquée
      expect(code(await applyTransfer(w.deps, w.director.ctx, transfer.id, {}))).toBe("councils.consent_required");
      const files = unwrap(await listFilesView(w.deps, w.director.ctx, { page: 1, pageSize: 20 }));
      const file = files.items.find((f) => f.enrollmentId === cls.students[0]!.enrollmentId)!;
      expect(file.guardianConsent).toBe("PENDING");
      // le tuteur lié exprime un vœu (source imposée par son compte) puis REFUSE : l'application reste bloquée
      const wished = unwrap(await addWish(w.deps, w.ctxOf(guardian), GUARDIAN_CAPS, file.id, { rank: 1, toProgramId: t.programId, toGradeLevelId: t.gradeLevelId, optionIds: [], source: "STAFF", comment: "Souhait de la famille" }));
      expect(wished.wishes[0]).toMatchObject({ rank: 1, source: "GUARDIAN", expressedBy: guardian });
      expect(wished.status).toBe("WISHES_COLLECTED");
      // un second vœu au même rang remplace (retire) le premier : jamais supprimé
      const replaced = unwrap(await addWish(w.deps, w.ctxOf(guardian), GUARDIAN_CAPS, file.id, { rank: 1, toProgramId: t.programId, toGradeLevelId: t.gradeLevelId, optionIds: [], source: "GUARDIAN" }));
      expect(replaced.wishes.filter((x) => x.withdrawnAt === null)).toHaveLength(1);
      expect(replaced.wishes).toHaveLength(2);
      // un tuteur sans lien : introuvable
      expect(code(await addWish(w.deps, w.ctxOf(newId()), GUARDIAN_CAPS, file.id, { rank: 2, toProgramId: t.programId, toGradeLevelId: t.gradeLevelId, optionIds: [], source: "GUARDIAN" }))).toBe("councils.not_found");
      unwrap(await recordConsent(w.deps, w.ctxOf(guardian), GUARDIAN_CAPS, file.id, { state: "REFUSED" }));
      expect(code(await applyTransfer(w.deps, w.director.ctx, transfer.id, {}))).toBe("councils.consent_required");
      unwrap(await recordConsent(w.deps, w.ctxOf(guardian), GUARDIAN_CAPS, file.id, { state: "GIVEN" }));

      // échec d'academic : le transfert passe FAILED (diagnostic), puis se reprend
      const outcomes = w.ports.outcomes;
      const original = outcomes.recordRedirect;
      outcomes.recordRedirect = async () => {
        throw new Error("academic indisponible");
      };
      const failed = unwrap(await applyTransfer(w.deps, w.director.ctx, transfer.id, {}));
      outcomes.recordRedirect = original;
      expect(failed).toMatchObject({ status: "FAILED" });
      expect(failed.lastError).toContain("academic indisponible");
      const applied = unwrap(await applyTransfer(w.deps, w.director.ctx, transfer.id, {}));
      expect(applied.status).toBe("APPLIED");
      expect(w.ports.outcomeCalls.at(-1)).toMatchObject({ enrollmentId: cls.students[0]!.enrollmentId, redirect: true, targetProgramId: t.programId });
      expect(code(await cancelTransfer(w.deps, w.director.ctx, transfer.id, { reason: "Trop tard pour annuler." }))).toBe("councils.invalid_state");
    });

    it("en cours d'année la classe de destination est exigée ; une décision du conseil REORIENTATION planifie le dossier et le transfert (échec explicite sans parcours, reprise une fois le parcours créé)", async () => {
      const cls = freshClassroom(w, { students: 1 });
      const t = target();
      const { council, decisions } = await signedCouncil(cls, "REORIENTATION", { justification: "Réorientation souhaitée et justifiée par les résultats.", targetProgramId: t.programId, targetGradeLevelId: t.gradeLevelId, targetLabel: "Série de démonstration" });
      expect(decisions[0]).toMatchObject({ family: "REORIENTATION", targetProgramId: t.programId });
      const effects = unwrap(await listEffectsOfCouncilView(w.deps, w.director.ctx, DIRECTOR_CAPS, council.id)).items;
      const fileEffect = effects.find((e) => e.kind === "ORIENTATION_FILE")!;
      expect(fileEffect.status).toBe("APPLIED");
      const transferEffect = effects.find((e) => e.kind === "SERIES_TRANSFER")!;
      // aucun parcours ne correspond : l'effet est EN ÉCHEC avec un diagnostic clair (jamais un transfert inventé)
      expect(transferEffect).toMatchObject({ status: "FAILED" });
      expect(transferEffect.lastError).toContain("councils.transfer_target_required");
      // la direction crée le parcours (donnée) puis relance : le transfert est planifié, rattaché à la décision du conseil
      unwrap(await upsertPath(w.deps, w.director.ctx, { institutionId: null, kind: "REORIENTATION", fromProgramId: null, fromGradeLevelId: w.gradeLevelId, toProgramId: t.programId, toGradeLevelId: t.gradeLevelId, label: null, requiresCouncilOpinion: true, requiresGuardianConsent: false, active: true, sourceKind: "institution" }));
      expect(unwrap(await retryEffect(w.deps, w.director.ctx, DIRECTOR_CAPS, transferEffect.id)).status).toBe("APPLIED");
      const planned = await db.admin.query("SELECT id, status, decided_via, decision_id FROM councils.series_transfers WHERE enrollment_id = $1", [cls.students[0]!.enrollmentId]);
      expect(planned.rows).toEqual([expect.objectContaining({ status: "PLANNED", decided_via: "COUNCIL", decision_id: decisions[0]!.id })]);
      unwrap(await applyTransfer(w.deps, w.director.ctx, planned.rows[0].id, {}));
      // l'effet qui l'a planifié est désormais irréversible
      const after = unwrap(await listEffectsOfCouncilView(w.deps, w.director.ctx, DIRECTOR_CAPS, council.id)).items.find((e) => e.kind === "SERIES_TRANSFER")!;
      expect(after.irreversible).toBe(true);
    });
  });
});
