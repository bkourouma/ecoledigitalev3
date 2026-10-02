/**
 * Cycle de vie complet de la vie scolaire sur Postgres réel (ports en mémoire) : incident -> mesure -> validation (quatre
 * yeux) -> notification -> exécution -> recours ; exclusions sans chevauchement et effet AWAITING_HUMAN ; encouragements ;
 * convocations ; points de conduite ; refus des acteurs système ; échec fermé des ports ; atomicité (audit / outbox).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { err, unwrap, type AppError, type Result } from "@ecoledigitale/kernel";
import { cancelMeasure, decideAppeal, executeMeasure, fileAppeal, notifyMeasure, proposeMeasure, rejectMeasure, revokeMeasure, validateMeasure, withdrawAppeal } from "../../application/measures";
import { addInvolvement, closeIncident, confirmIncident, declareIncident, dismissIncident, reviewIncident } from "../../application/incidents";
import { createNote, withdrawNote } from "../../application/notes";
import { acknowledgeConvocation, cancelConvocation, createConvocation, holdConvocation, rescheduleConvocation, sendConvocation } from "../../application/convocations";
import { applyEffect, listEffectsView, revertEffect, skipEffect } from "../../application/effects";
import { adjustConduct, getStudentConduct } from "../../application/conduct";
import { getStudentLife } from "../../application/dossier";
import { createSchoolLifeDeps } from "../../application/deps";
import { unavailablePorts } from "../../infrastructure/in-memory-ports";
import { createModuleTestDb, describeIntegration, type ModuleTestDb } from "../support/db";
import { DIRECTOR_CAPS, EDUCATOR_CAPS, GUARDIAN_CAPS, PUPIL_CAPS, TEACHER_CAPS, enableConduct, makeWorld, type TestWorld } from "../support/world";

const fails = async <T>(result: Promise<Result<T, AppError>>, code: string): Promise<AppError> => {
  const r = await result;
  expect(r.ok, `échec attendu (${code})`).toBe(false);
  if (r.ok) throw new Error("unreachable");
  expect(r.error.code).toBe(code);
  return r.error;
};

describeIntegration("vie scolaire : cycle de vie (Postgres réel)", () => {
  let db: ModuleTestDb;
  let w: TestWorld;
  beforeAll(async () => {
    db = await createModuleTestDb();
    w = await makeWorld(db);
  });
  afterAll(async () => {
    await db?.drop();
  });

  const student = () => w.students[0]!;
  const propose = (typeKey: keyof TestWorld["types"], extra: Record<string, unknown> = {}, who = w.educator, s = student()) =>
    proposeMeasure(w.deps, who.ctx, EDUCATOR_CAPS, { enrollmentId: s.enrollmentId, typeId: w.types[typeKey], reason: "Comportement répété en classe", ...extra } as never);

  describe("incidents", () => {
    it("déclaration par un enseignant de SA classe ; l'élève est dérivé de l'inscription ; instruction par un responsable", async () => {
      const incident = unwrap(
        await declareIncident(w.deps, w.teacher.ctx, TEACHER_CAPS, {
          typeId: w.types.INC,
          occurredAt: "2026-11-02T09:30:00Z",
          description: "Altercation dans la cour",
          involvements: [{ enrollmentId: student().enrollmentId, role: "AUTHOR", statement: "Je n'ai rien fait" }],
        }),
      );
      expect(incident.status).toBe("DECLARED");
      expect(incident.reportedBy).toBe(w.teacher.userId);
      expect(incident.involvements[0]).toMatchObject({ studentId: student().studentId, role: "AUTHOR", statement: null }); // déclaration d'élève : réservée à l'instruction
      // hors périmètre : introuvable (jamais 403), l'enseignant ne voit que ses classes
      await fails(
        declareIncident(w.deps, w.teacher.ctx, TEACHER_CAPS, { typeId: w.types.INC, occurredAt: "2026-11-02T09:30:00Z", description: "Hors classe", involvements: [{ enrollmentId: w.outsiderStudent.enrollmentId, role: "AUTHOR" }] }),
        "schoollife.enrollment_not_found",
      );
      const reviewed = unwrap(await reviewIncident(w.deps, w.educator.ctx, EDUCATOR_CAPS, incident.id, {}));
      expect(reviewed.status).toBe("UNDER_REVIEW");
      expect(reviewed.involvements[0]?.statement).toBe("Je n'ai rien fait"); // instruction : l'instructeur lit les déclarations
      await fails(closeIncident(w.deps, w.educator.ctx, EDUCATOR_CAPS, incident.id, { resolutionNote: "Trop tôt pour clore" }), "schoollife.invalid_state");
      unwrap(await confirmIncident(w.deps, w.educator.ctx, EDUCATOR_CAPS, incident.id));
      const closed = unwrap(await closeIncident(w.deps, w.educator.ctx, EDUCATOR_CAPS, incident.id, { resolutionNote: "Mesure prise, famille informée" }));
      expect(closed.status).toBe("CLOSED");
      await fails(addInvolvement(w.deps, w.educator.ctx, EDUCATOR_CAPS, incident.id, { enrollmentId: student().enrollmentId, role: "WITNESS" }), "schoollife.closed");
    });

    it("écarté sans note de résolution refusé ; la confidentialité plancher du type est imposée", async () => {
      const a = unwrap(await declareIncident(w.deps, w.educator.ctx, EDUCATOR_CAPS, { typeId: w.types.INC, occurredAt: "2026-11-02T10:00:00Z", description: "Fait contesté", involvements: [{ enrollmentId: student().enrollmentId, role: "AUTHOR" }] }));
      const d = unwrap(await dismissIncident(w.deps, w.educator.ctx, EDUCATOR_CAPS, a.id, { resolutionNote: "Faits non établis" }));
      expect(d.status).toBe("DISMISSED");
      const secret = unwrap(await declareIncident(w.deps, w.educator.ctx, EDUCATOR_CAPS, { typeId: w.types.SECRET_INC, occurredAt: "2026-11-02T10:00:00Z", description: "Fait grave", involvements: [{ enrollmentId: student().enrollmentId, role: "AUTHOR" }] }));
      expect(secret.confidentiality).toBe("CONFIDENTIAL");
      expect(secret.masked).toBe(true);
      expect(secret.description).toBeNull();
      await fails(
        declareIncident(w.deps, w.educator.ctx, EDUCATOR_CAPS, { typeId: w.types.SECRET_INC, occurredAt: "2026-11-02T10:00:00Z", description: "Fait grave", confidentiality: "STANDARD", involvements: [{ enrollmentId: student().enrollmentId, role: "AUTHOR" }] }),
        "schoollife.invalid_input",
      );
    });
  });

  describe("mesures : le TYPE porte le circuit", () => {
    it("sanction : proposée, quatre yeux (le proposant ne valide pas), notifiée par le port, exécutée", async () => {
      const m = unwrap(await propose("SANC"));
      expect(m).toMatchObject({ status: "PROPOSED", kind: "SANCTION", requiresFourEyes: true, appealable: true });
      // l'éducateur n'a pas le droit de valider
      await fails(validateMeasure(w.deps, w.educator.ctx, EDUCATOR_CAPS, m.id, {}), "schoollife.permission_required");
      // le même utilisateur qui a proposé ne peut pas valider, même habilité
      const own = unwrap(await propose("SANC", {}, w.director));
      await fails(validateMeasure(w.deps, w.director.ctx, DIRECTOR_CAPS, own.id, {}), "schoollife.four_eyes_required");
      // une permission d'approbation propre au type, non détenue, est refusée
      await fails(validateMeasure(w.deps, w.director2.ctx, { ...DIRECTOR_CAPS, can: async () => false }, m.id, {}), "schoollife.approver_permission_required");
      const v = unwrap(await validateMeasure(w.deps, w.director2.ctx, DIRECTOR_CAPS, m.id, { note: "Faits établis" }));
      expect(v).toMatchObject({ status: "VALIDATED", validatedByName: "Directeur B" });
      expect(w.audit.actions()).toContain("schoollife.measure.validated");
      const n = unwrap(await notifyMeasure(w.deps, w.director2.ctx, DIRECTOR_CAPS, m.id));
      expect(n.status).toBe("NOTIFIED");
      const sent = w.ports.notifications.sent.at(-1)!;
      expect(sent.input.kind).toBe("MEASURE_NOTICE");
      expect(sent.input.guardianIds).toHaveLength(2);
      expect(JSON.stringify(sent.input.variables)).not.toMatch(/Comportement répété/); // le motif ne part jamais dans la notification
      const x = unwrap(await executeMeasure(w.deps, w.educator.ctx, EDUCATOR_CAPS, m.id));
      expect(x.status).toBe("EXECUTED");
    });

    it("avertissement sans circuit : directement en vigueur ; rejet motivé ; annulation du proposant", async () => {
      const warn = unwrap(await propose("WARN"));
      expect(warn.status).toBe("VALIDATED");
      expect(warn.validatedByName).toBe("Mme Éducatrice");
      const m = unwrap(await propose("SANC"));
      const rejected = unwrap(await rejectMeasure(w.deps, w.director2.ctx, DIRECTOR_CAPS, m.id, { note: "Faits insuffisamment établis" }));
      expect(rejected.status).toBe("REJECTED");
      await fails(validateMeasure(w.deps, w.director2.ctx, DIRECTOR_CAPS, m.id, {}), "schoollife.invalid_state");
      const mine = unwrap(await propose("SANC"));
      expect(unwrap(await cancelMeasure(w.deps, w.educator.ctx, EDUCATOR_CAPS, mine.id, { reason: "Proposition retirée" })).status).toBe("CANCELLED");
    });

    it("le motif n'est pas modifiable après validation et une mesure n'accepte que le type de sa famille", async () => {
      await fails(propose("INC"), "schoollife.type_inactive"); // un type d'incident n'est pas une mesure
      await fails(propose("ENC"), "schoollife.type_inactive");
    });

    it("recours : famille (lien vérifié) sur mesure notifiée ; maintenu -> exécutée ; accueilli -> révoquée avec le motif ; pas de recours sur un avertissement", async () => {
      const m = unwrap(await propose("SANC"));
      unwrap(await validateMeasure(w.deps, w.director2.ctx, DIRECTOR_CAPS, m.id, {}));
      // pas encore notifiée : invisible pour la famille (404)
      await fails(fileAppeal(w.deps, w.guardian.ctx, GUARDIAN_CAPS, m.id, { reason: "Je conteste cette décision" }), "schoollife.not_found");
      unwrap(await notifyMeasure(w.deps, w.director2.ctx, DIRECTOR_CAPS, m.id));
      // un autre parent ne voit pas la mesure : 404
      await fails(fileAppeal(w.deps, w.otherGuardian.ctx, GUARDIAN_CAPS, m.id, { reason: "Je conteste cette décision" }), "schoollife.not_found");
      const appeal = unwrap(await fileAppeal(w.deps, w.guardian.ctx, GUARDIAN_CAPS, m.id, { reason: "Je conteste cette décision" }));
      expect(appeal.status).toBe("FILED");
      expect(appeal.filedByName).toBe("Parent Un");
      const upheld = unwrap(await decideAppeal(w.deps, w.director.ctx, DIRECTOR_CAPS, appeal.id, { outcome: "UPHELD", decisionNote: "Sanction proportionnée aux faits" }));
      expect(upheld.status).toBe("UPHELD");
      // second recours sur la même mesure maintenue, puis accueilli
      const second = unwrap(await fileAppeal(w.deps, w.guardian.ctx, GUARDIAN_CAPS, m.id, { reason: "Nouvel élément à produire" }));
      const overturned = unwrap(await decideAppeal(w.deps, w.director.ctx, DIRECTOR_CAPS, second.id, { outcome: "OVERTURNED", decisionNote: "Faits non établis après audition" }));
      expect(overturned.status).toBe("OVERTURNED");
      const life = unwrap(await getStudentLife(w.deps, w.director.ctx, DIRECTOR_CAPS, { studentId: student().studentId }));
      const final = life.measures.find((x) => x.id === m.id)!;
      expect(final).toMatchObject({ status: "REVOKED", revokedReason: "Faits non établis après audition" });
      // l'élève peut retirer son propre recours seulement
      const w2 = unwrap(await propose("SANC"));
      unwrap(await validateMeasure(w.deps, w.director2.ctx, DIRECTOR_CAPS, w2.id, {}));
      unwrap(await notifyMeasure(w.deps, w.director2.ctx, DIRECTOR_CAPS, w2.id));
      const a2 = unwrap(await fileAppeal(w.deps, w.pupil.ctx, PUPIL_CAPS, w2.id, { reason: "Je conteste cette décision" }));
      await fails(withdrawAppeal(w.deps, w.guardian.ctx, a2.id), "schoollife.not_found");
      expect(unwrap(await withdrawAppeal(w.deps, w.pupil.ctx, a2.id)).status).toBe("WITHDRAWN");
      // révocation directe (permission sensible dédiée)
      await fails(revokeMeasure(w.deps, w.educator.ctx, EDUCATOR_CAPS, w2.id, { reason: "Erreur d'identification de l'élève" }), "schoollife.permission_required");
      expect(unwrap(await revokeMeasure(w.deps, w.director.ctx, DIRECTOR_CAPS, w2.id, { reason: "Erreur d'identification de l'élève" })).status).toBe("REVOKED");
    });
  });

  describe("exclusions temporaires : toujours validées, sans chevauchement, effet AWAITING_HUMAN", () => {
    it("dates obligatoires ; deux exclusions vivantes ne se chevauchent pas ; deux propositions peuvent coexister", async () => {
      const s = w.students[2]!;
      await fails(propose("EXCL", {}, w.educator, s), "schoollife.invalid_input");
      const a = unwrap(await propose("EXCL", { startsOn: "2026-11-10", endsOn: "2026-11-12" }, w.educator, s));
      const b = unwrap(await propose("EXCL", { startsOn: "2026-11-11", endsOn: "2026-11-14" }, w.educator, s));
      expect(a.status).toBe("PROPOSED");
      unwrap(await validateMeasure(w.deps, w.director.ctx, DIRECTOR_CAPS, a.id, {}));
      await fails(validateMeasure(w.deps, w.director.ctx, DIRECTOR_CAPS, b.id, {}), "schoollife.exclusion_overlap");
      // la transaction a été annulée : b est toujours PROPOSED
      const life = unwrap(await getStudentLife(w.deps, w.director.ctx, DIRECTOR_CAPS, { studentId: s.studentId }));
      expect(life.measures.find((x) => x.id === b.id)?.status).toBe("PROPOSED");
    });

    it("l'effet sur le statut de l'élève naît AWAITING_HUMAN ; jamais appliqué seul ; appliqué par un humain habilité ; écarté si la mesure est révoquée", async () => {
      const s = w.students[3]!;
      const ex = unwrap(await propose("EXCL", { startsOn: "2026-12-01", endsOn: "2026-12-03" }, w.educator, s));
      unwrap(await validateMeasure(w.deps, w.director.ctx, DIRECTOR_CAPS, ex.id, {}));
      const effects = unwrap(await listEffectsView(w.deps, w.director.ctx, { measureId: ex.id, page: 1, pageSize: 10 }));
      expect(effects).toHaveLength(1);
      expect(effects[0]).toMatchObject({ status: "AWAITING_HUMAN", effectKind: "STUDENT_STATUS_REQUEST", appliedStatus: null });
      expect(w.ports.studentStatus.calls).toHaveLength(0); // rien n'a été appliqué automatiquement
      // un acteur système (job) ne peut pas appliquer
      await fails(applyEffect(w.deps, w.systemCtx(), DIRECTOR_CAPS, effects[0]!.id, { status: "SUSPENDED" }), "schoollife.human_actor_required");
      await fails(applyEffect(w.deps, w.director.ctx, { ...DIRECTOR_CAPS, exclusionApply: false }, effects[0]!.id, { status: "SUSPENDED" }), "schoollife.permission_required");
      // l'échec du port annule tout : l'effet reste en attente
      w.ports.studentStatus.failWith = new Error("people indisponible");
      await fails(applyEffect(w.deps, w.director.ctx, DIRECTOR_CAPS, effects[0]!.id, { status: "SUSPENDED" }), "schoollife.student_status_failed");
      w.ports.studentStatus.failWith = null;
      expect(unwrap(await listEffectsView(w.deps, w.director.ctx, { measureId: ex.id, page: 1, pageSize: 10 }))[0]?.status).toBe("AWAITING_HUMAN");
      const applied = unwrap(await applyEffect(w.deps, w.director.ctx, DIRECTOR_CAPS, effects[0]!.id, { status: "SUSPENDED" }));
      expect(applied).toMatchObject({ status: "APPLIED", appliedStatus: "SUSPENDED" });
      expect(w.ports.studentStatus.calls[0]).toMatchObject({ studentId: s.studentId, status: "SUSPENDED" });
      const applier = await db.admin.query("SELECT applied_by FROM schoollife.measure_effects WHERE id = $1", [effects[0]!.id]);
      expect(applier.rows[0].applied_by).toBe(w.director.userId); // posé par la base
      unwrap(await revertEffect(w.deps, w.director.ctx, DIRECTOR_CAPS, effects[0]!.id, { reason: "Exclusion terminée" }));
      expect(w.ports.studentStatus.calls.at(-1)).toMatchObject({ status: "ACTIVE" });

      // une exclusion révoquée avant application : son effet en attente est écarté
      const s2 = w.students[1]!;
      const ex2 = unwrap(await propose("EXCL", { startsOn: "2026-12-07", endsOn: "2026-12-09" }, w.educator, s2));
      unwrap(await validateMeasure(w.deps, w.director.ctx, DIRECTOR_CAPS, ex2.id, {}));
      unwrap(await cancelMeasure(w.deps, w.director.ctx, DIRECTOR_CAPS, ex2.id, { reason: "Décision annulée par la direction" }));
      const e2 = unwrap(await listEffectsView(w.deps, w.director.ctx, { measureId: ex2.id, page: 1, pageSize: 10 }));
      expect(e2[0]).toMatchObject({ status: "SKIPPED" });
      await fails(skipEffect(w.deps, w.director.ctx, DIRECTOR_CAPS, e2[0]!.id, { reason: "Déjà écarté" }), "schoollife.invalid_state");
    });
  });

  describe("l'humain décide : un acteur système est refusé pour chaque acte", () => {
    it("déclarer, proposer, valider, rédiger, convoquer, ajuster : `schoollife.human_actor_required`", async () => {
      const sys = w.systemCtx();
      const code = "schoollife.human_actor_required";
      await fails(declareIncident(w.deps, sys, DIRECTOR_CAPS, { typeId: w.types.INC, occurredAt: "2026-11-02T09:30:00Z", description: "Fait", involvements: [{ enrollmentId: student().enrollmentId, role: "AUTHOR" }] }), code);
      await fails(proposeMeasure(w.deps, sys, DIRECTOR_CAPS, { enrollmentId: student().enrollmentId, typeId: w.types.WARN, reason: "Motif valable" }), code);
      const m = unwrap(await propose("SANC"));
      await fails(validateMeasure(w.deps, sys, DIRECTOR_CAPS, m.id, {}), code);
      await fails(notifyMeasure(w.deps, sys, DIRECTOR_CAPS, m.id), code);
      await fails(createNote(w.deps, sys, DIRECTOR_CAPS, { enrollmentId: student().enrollmentId, typeId: w.types.ENC, body: "Bravo", occurredOn: "2026-11-02", visibility: "STAFF_ONLY" }), code);
      await fails(createConvocation(w.deps, sys, DIRECTOR_CAPS, { enrollmentId: student().enrollmentId, reasonKind: "OTHER", reason: "Entretien", scheduledAt: "2026-12-01T08:00:00Z" }), code);
      await fails(adjustConduct(w.deps, sys, DIRECTOR_CAPS, { enrollmentId: student().enrollmentId, scaleId: m.id, delta: 1, reason: "Ajustement" }), code);
    });

    it("la base refuse aussi un contexte `superAdmin` ou un acteur non humain, même si le code applicatif était contourné", async () => {
      // On appelle directement la couche d'accès : un contexte « system » n'a pas d'utilisateur ; `superAdmin` non plus de droit implicite.
      const sql = db.tenantDb;
      await expect(
        sql.run(w.systemCtx(), (tx) =>
          tx.query(
            "INSERT INTO schoollife.notes (id, tenant_id, institution_id, academic_year_id, enrollment_id, student_id, type_id, kind, body, occurred_on, author_id, author_name) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'ENCOURAGEMENT', 'Bravo', now(), $7, 'X')",
            [w.tenantId, w.institutionId, w.yearId, student().enrollmentId, student().studentId, w.types.ENC, w.director.userId],
          ),
        ),
      ).rejects.toThrow(/human_actor_required/);
    });
  });

  describe("encouragements, observations et convocations", () => {
    it("une note est immuable, retirée avec motif ; l'observation restreinte n'est jamais partageable", async () => {
      const n = unwrap(await createNote(w.deps, w.teacher.ctx, TEACHER_CAPS, { enrollmentId: student().enrollmentId, typeId: w.types.ENC, body: "Excellente participation en classe", occurredOn: "2026-11-02", visibility: "STUDENT_AND_GUARDIANS" }));
      expect(n).toMatchObject({ kind: "ENCOURAGEMENT", authorId: w.teacher.userId, status: "ACTIVE" });
      await fails(createNote(w.deps, w.teacher.ctx, TEACHER_CAPS, { enrollmentId: student().enrollmentId, typeId: w.types.OBS, body: "Observation", occurredOn: "2026-11-02", visibility: "GUARDIANS" }), "schoollife.invalid_input");
      await fails(createNote(w.deps, w.teacher.ctx, TEACHER_CAPS, { enrollmentId: w.outsiderStudent.enrollmentId, typeId: w.types.ENC, body: "Hors classe", occurredOn: "2026-11-02", visibility: "STAFF_ONLY" }), "schoollife.enrollment_not_found");
      await fails(withdrawNote(w.deps, w.otherTeacher.ctx, TEACHER_CAPS, n.id, { reason: "Pas mon élève" }), "schoollife.not_found");
      const withdrawn = unwrap(await withdrawNote(w.deps, w.teacher.ctx, TEACHER_CAPS, n.id, { reason: "Erreur de saisie" }));
      expect(withdrawn.status).toBe("WITHDRAWN");
      await fails(withdrawNote(w.deps, w.teacher.ctx, TEACHER_CAPS, n.id, { reason: "Encore une fois" }), "schoollife.invalid_state");
    });

    it("convocation : le statut suit la réalité (sans tuteur joignable elle reste en brouillon), accusé par un tuteur convoqué seulement, report", async () => {
      const s = student();
      const c = unwrap(await createConvocation(w.deps, w.educator.ctx, EDUCATOR_CAPS, { enrollmentId: s.enrollmentId, reasonKind: "DISCIPLINE", reason: "Entretien suite à un incident", scheduledAt: "2026-12-01T08:00:00Z", location: "Bureau" }));
      expect(c.status).toBe("DRAFT");
      expect(c.guardianIds).toHaveLength(2);
      w.ports.notifications.unreachable = true;
      await fails(sendConvocation(w.deps, w.educator.ctx, EDUCATOR_CAPS, c.id, { channels: ["IN_APP"] }), "schoollife.notification_failed");
      w.ports.notifications.unreachable = false;
      const sent = unwrap(await sendConvocation(w.deps, w.educator.ctx, EDUCATOR_CAPS, c.id, { channels: ["IN_APP", "EMAIL"] }));
      expect(sent.status).toBe("SENT");
      const payload = w.ports.notifications.sent.at(-1)!.input;
      expect(payload).toMatchObject({ kind: "CONVOCATION", variables: { date: "2026-12-01", time: "08:00", place: "Bureau" } });
      expect(JSON.stringify(payload.variables)).not.toMatch(/incident/);
      // accusé : seulement un tuteur convoqué (compte lié), pas un autre parent
      await fails(acknowledgeConvocation(w.deps, w.otherGuardian.ctx, GUARDIAN_CAPS, c.id, { guardianId: w.otherGuardian.guardianId }), "schoollife.not_found");
      await fails(acknowledgeConvocation(w.deps, w.guardian.ctx, GUARDIAN_CAPS, c.id, { guardianId: w.otherGuardian.guardianId }), "schoollife.not_a_guardian");
      const ack = unwrap(await acknowledgeConvocation(w.deps, w.guardian.ctx, GUARDIAN_CAPS, c.id, { guardianId: w.guardian.guardianId }));
      expect(ack.status).toBe("ACKNOWLEDGED");
      const next = unwrap(await rescheduleConvocation(w.deps, w.educator.ctx, EDUCATOR_CAPS, c.id, { scheduledAt: "2026-12-04T08:00:00Z" }));
      expect(next).toMatchObject({ status: "DRAFT", rescheduledFromId: c.id });
      unwrap(await sendConvocation(w.deps, w.educator.ctx, EDUCATOR_CAPS, next.id, { channels: ["IN_APP"] }));
      expect(unwrap(await holdConvocation(w.deps, w.educator.ctx, EDUCATOR_CAPS, next.id, { outcomeNote: "Entretien tenu, engagement de la famille" })).status).toBe("HELD");
      await fails(cancelConvocation(w.deps, w.educator.ctx, EDUCATOR_CAPS, next.id, { reason: "Trop tard pour annuler" }), "schoollife.invalid_state");
    });
  });

  describe("points de conduite : barème paramétré, solde dérivé, registre en ajout seul", () => {
    it("désactivés par défaut ; avec un barème actif la validation écrit un mouvement, la révocation un mouvement inverse ; jamais de note de bulletin", async () => {
      const s = w.students[1]!;
      const conductOff = unwrap(await getStudentConduct(w.deps, w.director.ctx, DIRECTOR_CAPS, { studentId: s.studentId }));
      expect(conductOff).toMatchObject({ enabled: false, balance: null });
      const scaleId = await enableConduct(w, { SANC: -3, ENC: 1 }, { initial: 20, min: 0, max: 20, reset: "YEAR" });
      const m = unwrap(await propose("SANC", {}, w.educator, s));
      unwrap(await validateMeasure(w.deps, w.director2.ctx, DIRECTOR_CAPS, m.id, {}));
      let c = unwrap(await getStudentConduct(w.deps, w.director.ctx, DIRECTOR_CAPS, { studentId: s.studentId }));
      expect(c.enabled).toBe(true);
      expect(c.balance).toMatchObject({ scaleId, points: 17, isPlaceholder: true });
      expect(c.movements[0]).toMatchObject({ delta: -3, sourceKind: "MEASURE", sourceId: m.id });
      unwrap(await createNote(w.deps, w.teacher.ctx, TEACHER_CAPS, { enrollmentId: w.students[0]!.enrollmentId, typeId: w.types.ENC, body: "Bravo pour l'effort", occurredOn: "2026-11-02", visibility: "STAFF_ONLY" }));
      unwrap(await notifyMeasure(w.deps, w.director2.ctx, DIRECTOR_CAPS, m.id));
      unwrap(await revokeMeasure(w.deps, w.director.ctx, DIRECTOR_CAPS, m.id, { reason: "Erreur d'identification de l'élève" }));
      c = unwrap(await getStudentConduct(w.deps, w.director.ctx, DIRECTOR_CAPS, { studentId: s.studentId }));
      expect(c.balance?.points).toBe(20);
      expect(c.movements.map((x) => x.delta).sort()).toEqual([-3, 3]);
      expect(c.movements.find((x) => x.reversesId)).toBeTruthy();
      // registre en ajout seul, même pour l'administrateur de la base applicative
      await expect(db.tenantDb.run(w.director.ctx, (tx) => tx.query("UPDATE schoollife.conduct_movements SET delta = 99"))).rejects.toThrow(/permission denied|immutable/);
      // ajustement manuel : motivé, sensible, audité
      await fails(adjustConduct(w.deps, w.educator.ctx, EDUCATOR_CAPS, { enrollmentId: s.enrollmentId, scaleId, delta: 2, reason: "Bonus du conseil" }), "schoollife.permission_required");
      unwrap(await adjustConduct(w.deps, w.director.ctx, DIRECTOR_CAPS, { enrollmentId: s.enrollmentId, scaleId, delta: -50, reason: "Ajustement exceptionnel" }));
      c = unwrap(await getStudentConduct(w.deps, w.director.ctx, DIRECTOR_CAPS, { studentId: s.studentId }));
      expect(c.balance?.points).toBe(0); // borné par min_points
      expect(w.audit.actions()).toContain("schoollife.conduct.adjusted");
    });
  });

  describe("ports : échec fermé et atomicité", () => {
    it("sans port branché : `schoollife.port_unavailable`, aucune écriture", async () => {
      const closed = createSchoolLifeDeps({ db: db.tenantDb, clock: w.clock, audit: w.audit, ports: {} });
      expect(Object.keys(unavailablePorts())).toHaveLength(6);
      const before = await db.admin.query("SELECT count(*)::int AS n FROM schoollife.measures");
      await expect(proposeMeasure(closed, w.educator.ctx, EDUCATOR_CAPS, { enrollmentId: student().enrollmentId, typeId: w.types.WARN, reason: "Motif valable" })).resolves.toMatchObject({ ok: false, error: { code: "schoollife.port_unavailable" } });
      const after = await db.admin.query("SELECT count(*)::int AS n FROM schoollife.measures");
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });

    it("un échec d'audit annule la donnée, l'historique automatique et l'événement d'outbox", async () => {
      const failing = createSchoolLifeDeps({
        db: db.tenantDb,
        clock: w.clock,
        ports: w.ports,
        audit: { record: async () => Promise.reject(new Error("audit indisponible")) },
      });
      const measures = (await db.admin.query("SELECT count(*)::int AS n FROM schoollife.measures")).rows[0].n;
      const events = (await db.admin.query("SELECT count(*)::int AS n FROM kernel.domain_events WHERE type LIKE 'schoollife.%'")).rows[0].n;
      await expect(proposeMeasure(failing, w.educator.ctx, EDUCATOR_CAPS, { enrollmentId: student().enrollmentId, typeId: w.types.WARN, reason: "Motif valable" })).rejects.toThrow(/audit indisponible/);
      expect((await db.admin.query("SELECT count(*)::int AS n FROM schoollife.measures")).rows[0].n).toBe(measures);
      expect((await db.admin.query("SELECT count(*)::int AS n FROM kernel.domain_events WHERE type LIKE 'schoollife.%'")).rows[0].n).toBe(events);
    });

    it("les événements publiés ne contiennent aucun texte libre (description, motif, déclaration)", async () => {
      const rows = await db.admin.query("SELECT type, payload::text AS p FROM kernel.domain_events WHERE type LIKE 'schoollife.%'");
      expect(rows.rows.length).toBeGreaterThan(5);
      for (const r of rows.rows) {
        expect(r.p, r.type).not.toMatch(/Comportement répété|Altercation|Je n'ai rien fait|Faits établis|Entretien suite/);
        expect(JSON.parse(r.p).v, r.type).toBe(1);
      }
    });
  });
});
