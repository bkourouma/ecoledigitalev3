/**
 * Séance : président présent, quorum et dérogation (données, jamais une valeur officielle), acteur HUMAIN imposé par le module ET par la
 * base, règles de décision (décideur présent et habilité, justification d'écart, groupe exclusif, cible), instantané de faits figé.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unwrap } from "@ecoledigitale/kernel";
import { createModuleTestDb, describeIntegration, type ModuleTestDb } from "../support/db";
import { DIRECTOR_CAPS, SAMPLE_RESULTS, TEACHER_CAPS, councilOn, freshClassroom, makeWorld, type TestWorld } from "../support/world";
import { getAgendaItemDetail, prepareCouncil, rebuildAgendaItem, reviewAgendaItem, getAgenda } from "../../application/agenda";
import { closeCouncil, listParticipantsView, openCouncil, getCouncilDetail } from "../../application/councils";
import { addProposal, recordDecision, resolveProposal, withdrawDecision } from "../../application/deliberation";
import { getReference, upsertCouncilType, upsertSettings } from "../../application/reference";
import { applyEffect } from "../../application/effects";
import { signMinutes } from "../../application/minutes";
import { requestUnlock } from "../../application/unlock";
import { cancelCouncil } from "../../application/councils";

const code = (r: { ok: boolean; error?: { code: string } }): string | undefined => (r.ok ? undefined : r.error?.code);

describeIntegration("séance : quorum, acteur humain, décisions (Postgres réel)", () => {
  let db: ModuleTestDb;
  let w: TestWorld;
  beforeAll(async () => {
    db = await createModuleTestDb();
    w = await makeWorld(db);
  }, 120_000);
  afterAll(async () => {
    await db?.drop();
  });

  describe("ouverture : président présent, quorum et dérogation", () => {
    it("sans président présent l'ouverture est refusée", async () => {
      const cls = freshClassroom(w, { students: 1 });
      const council = await councilOn(w, cls, { roles: [{ person: w.secretary, roleCode: "SECRETARY", fn: "SECRETARY" }, { person: w.teacher, roleCode: "TEACHER" }] });
      const r = await openCouncil(w.deps, w.director.ctx, DIRECTOR_CAPS, council.id, {});
      expect(code(r)).toBe("councils.president_required");
      // un président est désigné mais absent : même refus
      const cls2 = freshClassroom(w, { students: 1 });
      const council2 = await councilOn(w, cls2, { present: false });
      expect(code(await openCouncil(w.deps, w.director.ctx, DIRECTOR_CAPS, council2.id, {}))).toBe("councils.president_required");
    });

    it("le quorum est une DONNÉE du type : refus indiquant présents / seuil / rôles manquants ; dérogation motivée (10 caractères) si l'établissement l'autorise", async () => {
      const type = unwrap(await upsertCouncilType(w.deps, w.director.ctx, { code: "QUORUM_DEMO", label: "Conseil de démonstration (quorum)", scope: "PERIOD", minResultsStatus: "GRADING_LOCKED", minParticipants: 5, requiredRoleCodes: ["EDUCATOR"], signerFunctions: ["PRESIDENT", "SECRETARY"], signerRoleCodes: [], requiresDecisionPerStudent: false, sortOrder: 0, active: true }));
      const cls = freshClassroom(w, { students: 1 });
      const council = await councilOn(w, cls, { typeId: type.id });
      const refused = await openCouncil(w.deps, w.director.ctx, DIRECTOR_CAPS, council.id, {});
      expect(code(refused)).toBe("councils.quorum_not_met");
      expect(!refused.ok && refused.error.details).toMatchObject({ presentCount: 4, required: 5, missingRoles: ["EDUCATOR"] });
      expect(code(await openCouncil(w.deps, w.director.ctx, DIRECTOR_CAPS, council.id, { quorumWaiverReason: "court" }))).toBe("councils.quorum_not_met");

      // l'établissement n'autorise pas la dérogation
      unwrap(await upsertSettings(w.deps, w.director.ctx, { institutionId: w.institutionId, allowQuorumWaiver: false }));
      expect(code(await openCouncil(w.deps, w.director.ctx, DIRECTOR_CAPS, council.id, { quorumWaiverReason: "Réunion urgente avant la fin de la période." }))).toBe("councils.quorum_not_met");
      unwrap(await upsertSettings(w.deps, w.director.ctx, { institutionId: w.institutionId, allowQuorumWaiver: true }));

      const opened = unwrap(await openCouncil(w.deps, w.director.ctx, DIRECTOR_CAPS, council.id, { quorumWaiverReason: "Réunion urgente avant la fin de la période." }));
      expect(opened.council).toMatchObject({ status: "OPEN", quorumWaived: true, quorumWaiverReason: "Réunion urgente avant la fin de la période." });
      const waived = await db.admin.query("SELECT payload FROM kernel.domain_events WHERE type = 'councils.quorum.waived' AND aggregate_id = $1", [council.id]);
      expect(waived.rows).toHaveLength(1);
      const journal = await db.admin.query("SELECT reason FROM councils.events WHERE council_id = $1 AND kind = 'OPENED'", [council.id]);
      expect(journal.rows[0].reason).toBe("Réunion urgente avant la fin de la période.");
    });

    it("quorum à NULL : aucun contrôle ; un seuil inférieur aux présents est atteint sans dérogation", async () => {
      const type = unwrap(await upsertCouncilType(w.deps, w.director.ctx, { code: "QUORUM_SMALL", label: "Conseil de démonstration (petit quorum)", scope: "PERIOD", minResultsStatus: "GRADING_LOCKED", minParticipants: 3, requiredRoleCodes: [], signerFunctions: ["PRESIDENT", "SECRETARY"], signerRoleCodes: [], requiresDecisionPerStudent: false, sortOrder: 0, active: true }));
      const cls = freshClassroom(w, { students: 1 });
      const council = await councilOn(w, cls, { typeId: type.id });
      expect(unwrap(await openCouncil(w.deps, w.director.ctx, DIRECTOR_CAPS, council.id, {})).council.quorumWaived).toBe(false);
      const cls2 = freshClassroom(w, { students: 1 });
      const none = await councilOn(w, cls2);
      expect(unwrap(await getCouncilDetail(w.deps, w.director.ctx, DIRECTOR_CAPS, none.id)).quorum).toMatchObject({ met: true, requiredMin: null, presidentPresent: true });
    });
  });

  describe("l'humain décide : un acteur système est refusé par le module ET par la base", () => {
    it("ouvrir, clore, décider, signer, résoudre, appliquer, annuler, demander un déverrouillage", async () => {
      const cls = freshClassroom(w, { students: 1 });
      const council = await councilOn(w, cls);
      const sys = w.systemCtx();
      const item0 = unwrap(await prepareCouncil(w.deps, w.director.ctx, DIRECTOR_CAPS, council.id));
      expect(item0.created).toBe(1);
      const agenda = unwrap(await getAgenda(w.deps, w.director.ctx, DIRECTOR_CAPS, council.id));
      const refused = [
        await openCouncil(w.deps, sys, DIRECTOR_CAPS, council.id, {}),
        await closeCouncil(w.deps, sys, DIRECTOR_CAPS, council.id),
        await recordDecision(w.deps, sys, DIRECTOR_CAPS, agenda.items[0]!.id, { decisionTypeId: w.decisionTypes.PASSAGE!, deciderParticipantId: w.director.userId, mode: "CONSENSUS" }),
        await signMinutes(w.deps, sys, DIRECTOR_CAPS, w.director.userId),
        await resolveProposal(w.deps, sys, DIRECTOR_CAPS, w.director.userId, "ACCEPTED", {}),
        await applyEffect(w.deps, sys, DIRECTOR_CAPS, w.director.userId),
        await cancelCouncil(w.deps, sys, council.id, { reason: "tentative automatique" }),
        await requestUnlock(w.deps, sys, DIRECTOR_CAPS, council.id, { reason: "tentative automatique sans humain identifié" }),
      ];
      expect(refused.map(code)).toEqual(Array(8).fill("councils.human_decision_required"));
      // super-administrateur : jamais non plus
      const superAdmin = { ...w.director.ctx, actor: "superAdmin" as const };
      expect(code(await openCouncil(w.deps, superAdmin, DIRECTOR_CAPS, council.id, {}))).toBe("councils.human_decision_required");
    });

    it("la base elle-même refuse un job (acteur système) : ouverture, signature, résolution, décision", async () => {
      const cls = freshClassroom(w, { students: 1 });
      const council = await councilOn(w, cls);
      const sys = w.systemCtx();
      await expect(db.tenantDb.run(sys, (tx) => tx.query("UPDATE councils.councils SET status = 'OPEN' WHERE id = $1", [council.id]))).rejects.toThrow(/human_decision_required/);
      await expect(db.tenantDb.run(sys, (tx) => tx.query("UPDATE councils.councils SET status = 'CANCELLED', cancel_reason = 'automatique' WHERE id = $1", [council.id]))).rejects.toThrow(/human_decision_required/);
    });
  });

  describe("décisions : décideur présent et habilité, justification, groupe exclusif, cible", () => {
    let council: Awaited<ReturnType<typeof councilOn>>;
    let items: Array<{ id: string; enrollmentId: string }>;
    let participants: Awaited<ReturnType<typeof listParticipantsView>> extends infer R ? (R extends { ok: true; value: infer V } ? V : never) : never;
    const d = () => w.director.ctx;

    beforeAll(async () => {
      const cls = freshClassroom(w, { students: 3 });
      // élève 3 : aucun résultat exploitable ; élève 2 : suggestion de redoublement (non ferme pour tester l'absence d'écart ailleurs)
      w.ports.setResultsFacts(cls.students[2]!.enrollmentId, { ...SAMPLE_RESULTS(), status: "ERROR", average: null, averageDisplay: null, rank: null, suggestions: [] });
      council = await councilOn(w, cls, { scope: "YEAR" });
      unwrap(await prepareCouncil(w.deps, d(), DIRECTOR_CAPS, council.id));
      unwrap(await openCouncil(w.deps, d(), DIRECTOR_CAPS, council.id, {}));
      items = unwrap(await getAgenda(w.deps, d(), DIRECTOR_CAPS, council.id)).items.map((i) => ({ id: i.id, enrollmentId: i.enrollmentId }));
      participants = unwrap(await listParticipantsView(w.deps, d(), DIRECTOR_CAPS, council.id)) as never;
    }, 60_000);

    const president = () => (participants as Array<{ id: string; councilFunction: string | null; roleCode: string }>).find((p) => p.councilFunction === "PRESIDENT")!;
    const secretary = () => (participants as Array<{ id: string; councilFunction: string | null; roleCode: string }>).find((p) => p.councilFunction === "SECRETARY")!;
    const teacher = () => (participants as Array<{ id: string; councilFunction: string | null; roleCode: string }>).find((p) => p.roleCode === "TEACHER")!;
    const decide = (item: number, type: string, extra: Record<string, unknown> = {}, by = () => president().id) => recordDecision(w.deps, d(), DIRECTOR_CAPS, items[item]!.id, { decisionTypeId: w.decisionTypes[type]!, deciderParticipantId: by(), mode: "CONSENSUS", ...extra } as never);

    it("le décideur est un participant PRÉSENT dont le rôle porte can_decide", async () => {
      expect(code(await decide(0, "PASSAGE", {}, () => secretary().id))).toBe("councils.decider_not_allowed");
      unwrap(await (await import("../../application/councils")).setPresence(w.deps, d(), council.id, teacher().id, "ABSENT"));
      expect(code(await decide(0, "PASSAGE", {}, () => teacher().id))).toBe("councils.decider_not_present");
      expect(code(await decide(0, "PASSAGE", {}, () => "00000000-0000-4000-8000-000000000000"))).toBe("councils.not_a_participant");
    });

    it("s'écarter de la suggestion de la règle exige une justification de 20 caractères ; la suggestion est conservée à côté", async () => {
      const short = await decide(0, "REPEAT", { justification: "Motif de 12 c" });
      expect(code(short)).toBe("councils.justification_required");
      const ok = unwrap(await decide(0, "REPEAT", { justification: "Trop d'absences non justifiées au long de l'année." }));
      expect(ok).toMatchObject({ family: "REPEAT", suggestedCode: "PROMOTED", differsFromSuggestion: true, factsVersion: 1 });
    });

    it("un seul résultat par groupe exclusif : remplacer exige de retirer la première décision avec un motif", async () => {
      const conflictResult = await decide(0, "PASSAGE");
      expect(code(conflictResult)).toBe("councils.duplicate");
      const first = unwrap(await getAgendaItemDetail(w.deps, d(), DIRECTOR_CAPS, items[0]!.id)).decisions.find((x) => x.status === "RECORDED")!;
      const noReason = await decide(0, "PASSAGE", { supersedesDecisionId: first.id });
      expect(noReason.ok).toBe(false);
      const replaced = unwrap(await decide(0, "PASSAGE", { supersedesDecisionId: first.id, supersedeReason: "Erreur de saisie corrigée en séance." }));
      expect(replaced).toMatchObject({ family: "PASSAGE", supersedesId: first.id, differsFromSuggestion: false });
      const detail = unwrap(await getAgendaItemDetail(w.deps, d(), DIRECTOR_CAPS, items[0]!.id));
      expect(detail.decisions.map((x) => x.status).sort()).toEqual(["RECORDED", "WITHDRAWN"]);
      expect(detail.item.status).toBe("DECIDED");
    });

    it("un élève sans résultat exploitable : passage ou redoublement exigent une justification ; une cible est exigée pour l'orientation", async () => {
      const detail = unwrap(await getAgendaItemDetail(w.deps, d(), DIRECTOR_CAPS, items[2]!.id));
      expect(detail.item.missingResults).toBe(true);
      expect(code(await decide(2, "PASSAGE"))).toBe("councils.justification_required");
      expect(unwrap(await decide(2, "PASSAGE", { justification: "Résultats saisis sur papier, décision prise sur dossier." })).family).toBe("PASSAGE");
      expect(code(await decide(1, "ORIENTATION"))).toBe("councils.target_required");
    });

    it("l'instantané ne se reconstruit plus sous une décision ; il se reconstruit si le contenu change (version + 1) et jamais « examiné » à la main sous décision", async () => {
      const locked = await rebuildAgendaItem(w.deps, d(), DIRECTOR_CAPS, items[0]!.id);
      expect(code(locked)).toBe("councils.facts_locked_by_decision");
      w.ports.setResultsFacts(items[1]!.enrollmentId, { ...SAMPLE_RESULTS(), average: "14.00", averageDisplay: "14,00" });
      const rebuilt = unwrap(await rebuildAgendaItem(w.deps, d(), DIRECTOR_CAPS, items[1]!.id));
      expect(rebuilt.item.factsVersion).toBe(2);
      expect(rebuilt.facts?.results?.average).toBe("14.00");
      const same = unwrap(await rebuildAgendaItem(w.deps, d(), DIRECTOR_CAPS, items[1]!.id));
      expect(same.item.factsVersion).toBe(2); // contenu identique : la version n'augmente pas
      expect(unwrap(await reviewAgendaItem(w.deps, d(), DIRECTOR_CAPS, items[1]!.id)).status).toBe("REVIEWED");
      expect(code(await reviewAgendaItem(w.deps, d(), DIRECTOR_CAPS, items[0]!.id))).toBe("councils.invalid_state");
    });

    it("retirer une décision exige un motif ; l'élève repasse « examiné » ; la clôture exige une décision par élève (type YEAR)", async () => {
      const d2 = unwrap(await decide(1, "PASSAGE"));
      expect(code(await withdrawDecision(w.deps, d(), DIRECTOR_CAPS, d2.id, { reason: "x" }))).toBe("councils.invalid_input");
      unwrap(await withdrawDecision(w.deps, d(), DIRECTOR_CAPS, d2.id, { reason: "Décision à reprendre en séance." }));
      expect(unwrap(await getAgendaItemDetail(w.deps, d(), DIRECTOR_CAPS, items[1]!.id)).item.status).toBe("REVIEWED");
      const closed = await closeCouncil(w.deps, d(), DIRECTOR_CAPS, council.id);
      expect(code(closed)).toBe("councils.undecided_students");
      expect(!closed.ok && closed.error.details).toMatchObject({ undecided: 1 });
      unwrap(await decide(1, "PASSAGE"));
      expect(unwrap(await closeCouncil(w.deps, d(), DIRECTOR_CAPS, council.id)).council.status).toBe("CLOSED");
      // séance close : plus aucune décision ni proposition
      expect(code(await decide(1, "PASSAGE"))).toBe("councils.invalid_state");
      expect(code(await addProposal(w.deps, d(), DIRECTOR_CAPS, items[1]!.id, { kind: "REMARK", body: "tardif" }))).toBe("councils.invalid_state");
    });
  });

  describe("propositions et périmètre", () => {
    it("une suggestion de règle ne se résout que par un humain habilité, une seule fois ; un enseignant d'une autre classe ne voit rien (404)", async () => {
      const cls = freshClassroom(w, { students: 1, teachers: [w.teacher] });
      const council = await councilOn(w, cls, { scope: "YEAR" });
      unwrap(await prepareCouncil(w.deps, w.director.ctx, DIRECTOR_CAPS, council.id));
      unwrap(await openCouncil(w.deps, w.director.ctx, DIRECTOR_CAPS, council.id, {}));
      const item = unwrap(await getAgenda(w.deps, w.director.ctx, DIRECTOR_CAPS, council.id)).items[0]!;
      const suggestion = unwrap(await getAgendaItemDetail(w.deps, w.director.ctx, DIRECTOR_CAPS, item.id)).proposals.find((p) => p.origin === "RULE_SUGGESTION")!;
      expect(suggestion).toMatchObject({ status: "PROPOSED", proposedBy: null });
      // l'enseignant (proposition seulement) ne résout pas
      expect(code(await resolveProposal(w.deps, w.teacher.ctx, TEACHER_CAPS, suggestion.id, "ACCEPTED", {}))).toBe("councils.permission_required");
      const accepted = unwrap(await resolveProposal(w.deps, w.director.ctx, DIRECTOR_CAPS, suggestion.id, "ACCEPTED", { note: "Suggestion retenue." }));
      expect(accepted).toMatchObject({ status: "ACCEPTED", resolvedBy: w.director.userId });
      expect(code(await resolveProposal(w.deps, w.director.ctx, DIRECTOR_CAPS, suggestion.id, "REJECTED", {}))).toBe("councils.proposal_resolved");
      // enseignant affecté : voit sa classe ; enseignant d'une autre classe : introuvable
      expect((await getAgenda(w.deps, w.teacher.ctx, TEACHER_CAPS, council.id)).ok).toBe(true);
      expect(code(await getAgenda(w.deps, w.outsiderTeacher.ctx, TEACHER_CAPS, council.id))).toBe("councils.not_found");
      expect(code(await getAgendaItemDetail(w.deps, w.outsiderTeacher.ctx, TEACHER_CAPS, item.id))).toBe("councils.not_found");
      const reference = unwrap(await getReference(w.deps, w.director.ctx));
      expect(reference.roles.length).toBeGreaterThan(0);
    });
  });
});
