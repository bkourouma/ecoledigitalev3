/**
 * Parcours complet du conseil sur Postgres RÉEL (ports en mémoire) : préparer -> convoquer -> ouvrir -> décider -> clore -> PV -> signer
 * -> effets -> déverrouillage motivé -> réouverture -> reclôture (version 2). Les invariants sont ceux de la BASE (déclencheurs).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unwrap } from "@ecoledigitale/kernel";
import { createModuleTestDb, describeIntegration, type ModuleTestDb } from "../support/db";
import { DIRECTOR_CAPS, SECRETARY_CAPS, makeWorld, plannedCouncil, type TestWorld } from "../support/world";
import { getAgenda, getAgendaItemDetail, prepareCouncil } from "../../application/agenda";
import { cancelCouncil, closeCouncil, convokeCouncil, getCouncilDetail, listParticipantsView, openCouncil } from "../../application/councils";
import { addProposal, recordDecision, resolveProposal } from "../../application/deliberation";
import { listEffectsOfCouncilView, onResultsReopened, planCouncilEffects, revertEffect } from "../../application/effects";
import { generateMinutes, getMinutesDetail, getMinutesPdf, signMinutes } from "../../application/minutes";
import { approveUnlock, reopenCouncil, requestUnlock } from "../../application/unlock";
import { getCouncilDecisionsForEnrollment } from "../../application/reads";

describeIntegration("parcours du conseil de classe (Postgres réel)", () => {
  let db: ModuleTestDb;
  let w: TestWorld;
  beforeAll(async () => {
    db = await createModuleTestDb();
    w = await makeWorld(db);
  }, 120_000);
  afterAll(async () => {
    await db?.drop();
  });

  it("préparer -> convoquer -> ouvrir -> décider -> clore -> PV -> signer -> effets -> réouverture motivée -> reclôture (version 2)", async () => {
    const d = w.director.ctx;
    // bilan de fin d'année : les décisions de passage s'y prennent (type PASSAGE de portée YEAR)
    const council = await plannedCouncil(w, { scope: "YEAR" });
    expect(council.status).toBe("PLANNED");
    expect(council.ruleSourceKind).toBe("placeholder");

    // --- préparation : un élément par inscription active, instantané figé, suggestions de règle matérialisées ---
    const report = unwrap(await prepareCouncil(w.deps, d, DIRECTOR_CAPS, council.id));
    expect(report).toMatchObject({ created: 4, rebuilt: 0, unchanged: 0 });
    const again = unwrap(await prepareCouncil(w.deps, d, DIRECTOR_CAPS, council.id));
    expect(again).toMatchObject({ created: 0, unchanged: 4 }); // idempotent : la version n'augmente pas
    const agenda = unwrap(await getAgenda(w.deps, d, DIRECTOR_CAPS, council.id));
    expect(agenda.items).toHaveLength(4);
    expect(agenda.items.every((i) => i.factsVersion === 1 && i.factsHash?.length === 64)).toBe(true);
    const detail0 = unwrap(await getAgendaItemDetail(w.deps, d, DIRECTOR_CAPS, agenda.items[0]!.id));
    expect(detail0.facts?.results?.average).toBe("12.50"); // chaîne décimale exacte, aucun flottant
    expect(detail0.proposals.some((p) => p.origin === "RULE_SUGGESTION" && p.kind === "DECISION" && p.code === "PROMOTED" && p.status === "PROPOSED")).toBe(true);

    // --- convocation : une notification par participant, idempotente ---
    const convoked = unwrap(await convokeCouncil(w.deps, d, council.id, {}));
    expect(convoked).toMatchObject({ convoked: 4, notified: 4 });
    const replay = unwrap(await convokeCouncil(w.deps, d, council.id, {}));
    expect(replay.notified).toBe(0);
    expect(w.ports.notified.filter((n) => n.kind === "PARTICIPANTS")).toHaveLength(4);

    // --- ouverture : président présent ; la délibération de results est ouverte ---
    const opened = unwrap(await openCouncil(w.deps, d, DIRECTOR_CAPS, council.id, {}));
    expect(opened.council.status).toBe("OPEN");
    expect(opened.council.heldOn).toBe("2026-11-02");
    expect(opened.council.resultsDeliberationId).not.toBeNull();
    expect(w.ports.resultsWrites.map((x) => x.op)).toContain("openDeliberation");

    // --- propositions humaines + décisions ---
    const participants = unwrap(await listParticipantsView(w.deps, d, DIRECTOR_CAPS, council.id));
    const president = participants.find((p) => p.councilFunction === "PRESIDENT")!;
    const items = (await Promise.resolve(agenda.items)) as typeof agenda.items;
    const appreciation = unwrap(await addProposal(w.deps, w.homeroom.ctx, { proposalWrite: true }, items[0]!.id, { kind: "APPRECIATION", body: "Bon trimestre, à encourager." }));
    expect(appreciation).toMatchObject({ origin: "HUMAN", status: "PROPOSED", proposedBy: w.homeroom.userId });
    const distinction = unwrap(await addProposal(w.deps, w.homeroom.ctx, { proposalWrite: true }, items[0]!.id, { kind: "DISTINCTION", code: "HONOR_ROLL" }));
    unwrap(await resolveProposal(w.deps, d, DIRECTOR_CAPS, appreciation.id, "ACCEPTED", {}));
    unwrap(await resolveProposal(w.deps, d, DIRECTOR_CAPS, distinction.id, "ACCEPTED", {}));
    for (const it of items) {
      const decision = unwrap(await recordDecision(w.deps, d, DIRECTOR_CAPS, it.id, { decisionTypeId: w.decisionTypes.PASSAGE!, deciderParticipantId: president.id, mode: "CONSENSUS" }));
      expect(decision).toMatchObject({ family: "PASSAGE", suggestedCode: "PROMOTED", differsFromSuggestion: false, factsVersion: 1, status: "RECORDED" });
    }

    // --- clôture : la délibération de results est marquée tenue (date réelle) ---
    const closed = unwrap(await closeCouncil(w.deps, d, DIRECTOR_CAPS, council.id));
    expect(closed.council.status).toBe("CLOSED");
    expect(w.ports.resultsWrites.find((x) => x.op === "markDeliberationHeld")?.input).toMatchObject({ heldOn: "2026-11-02" });
    // aucun effet avant la signature (déclencheur SIGNED par défaut)
    expect(unwrap(await listEffectsOfCouncilView(w.deps, d, DIRECTOR_CAPS, council.id)).items).toHaveLength(0);

    // --- procès-verbal : snapshot immuable, hash calculé par la base ---
    const minutes = unwrap(await generateMinutes(w.deps, w.secretary.ctx, SECRETARY_CAPS, council.id));
    expect(minutes).toMatchObject({ version: 1, status: "GENERATED", renderStatus: "PENDING" });
    expect(minutes.placeholderNotice).toContain("démonstration");
    expect(minutes.missingSigners.map((m) => m.roleCode).sort()).toEqual(["PRESIDENT", "SECRETARY"]);
    const check = await db.admin.query("SELECT councils.minutes_hash(snapshot) = snapshot_hash AS ok FROM councils.minutes WHERE id = $1", [minutes.id]);
    expect(check.rows[0].ok).toBe(true);
    const detail = unwrap(await getMinutesDetail(w.deps, d, DIRECTOR_CAPS, minutes.id));
    expect(detail.snapshot.students).toHaveLength(4);
    expect(detail.snapshot.students[0]!.appreciation).toBe("Bon trimestre, à encourager.");
    expect(detail.snapshot.students[0]!.distinctions).toEqual(["HONOR_ROLL"]);
    expect(detail.snapshot.placeholderNotice).not.toBeNull();
    // PDF : pas prêt tant que le worker n'a pas rendu
    const pending = await getMinutesPdf(w.deps, d, DIRECTOR_CAPS, minutes.id);
    expect(pending.ok).toBe(false);
    expect(!pending.ok && pending.error.code).toBe("councils.minutes_not_rendered");

    // --- signatures : la 2e (dernière) passe PV puis séance à SIGNED, et déclenche les effets ---
    const first = unwrap(await signMinutes(w.deps, d, DIRECTOR_CAPS, minutes.id));
    expect(first.status).toBe("GENERATED");
    expect(first.missingSigners).toHaveLength(1);
    const dup = await signMinutes(w.deps, d, DIRECTOR_CAPS, minutes.id);
    expect(!dup.ok && dup.error.code).toBe("councils.duplicate");
    const second = unwrap(await signMinutes(w.deps, w.secretary.ctx, SECRETARY_CAPS, minutes.id));
    expect(second.status).toBe("SIGNED");
    expect(unwrap(await getCouncilDetail(w.deps, d, DIRECTOR_CAPS, council.id)).council.status).toBe("SIGNED");
    expect(w.ports.resultsWrites.map((x) => x.op)).toContain("markDeliberationSigned");

    const effects = unwrap(await listEffectsOfCouncilView(w.deps, d, DIRECTOR_CAPS, council.id));
    const byKind = (k: string) => effects.items.filter((e) => e.kind === k);
    expect(byKind("RESULTS_DECISION")).toHaveLength(4);
    expect(byKind("ENROLLMENT_OUTCOME")).toHaveLength(4);
    expect(byKind("NOTIFY_GUARDIANS")).toHaveLength(4);
    expect(byKind("RESULTS_APPRECIATION")).toHaveLength(1);
    expect(byKind("RESULTS_DISTINCTION")).toHaveLength(1);
    expect(effects.items.every((e) => e.status === "APPLIED")).toBe(true);
    const published = w.ports.resultsWrites.filter((x) => x.op === "publishYearDecision");
    expect(published).toHaveLength(4);
    expect(published[0]!.input).toMatchObject({ finalCode: "PROMOTED", stateId: w.yearStateId });
    expect(w.ports.outcomeCalls).toHaveLength(4);
    // rejouer la planification ne crée aucun doublon
    expect(unwrap(await planCouncilEffects(w.deps, d, council.id)).items).toHaveLength(effects.items.length);

    // --- les faits publiés aux autres modules ---
    const facts = unwrap(await getCouncilDecisionsForEnrollment(w.deps, d, { enrollmentId: w.students[0]!.enrollmentId }));
    expect(facts).toMatchObject({ appreciation: "Bon trimestre, à encourager.", distinctions: ["HONOR_ROLL"] });
    expect(facts.decisions[0]).toMatchObject({ decisionTypeCode: "PASSAGE", family: "PASSAGE", councilStatus: "SIGNED" });

    // --- déverrouillage : refusé sans demande approuvée ; quatre yeux ; refusé tant qu'un effet est appliqué ---
    const noRequest = await reopenCouncil(w.deps, d, DIRECTOR_CAPS, council.id);
    expect(!noRequest.ok && noRequest.error.code).toBe("councils.unlock_not_approved");
    const shortReason = await requestUnlock(w.deps, w.secretary.ctx, SECRETARY_CAPS, council.id, { reason: "trop court" });
    expect(shortReason.ok).toBe(false);
    const request = unwrap(await requestUnlock(w.deps, w.secretary.ctx, SECRETARY_CAPS, council.id, { reason: "Erreur de saisie découverte dans la décision d'un élève." }));
    const selfApprove = await approveUnlock(w.deps, w.secretary.ctx, { ...SECRETARY_CAPS, unlockApprove: true }, request.id, {});
    expect(!selfApprove.ok && selfApprove.error.code).toBe("councils.four_eyes_required");
    unwrap(await approveUnlock(w.deps, d, DIRECTOR_CAPS, request.id, { note: "Accord de la direction." }));
    const blocked = await reopenCouncil(w.deps, d, DIRECTOR_CAPS, council.id);
    expect(!blocked.ok && blocked.error.code).toBe("councils.effect_irreversible");

    // results rouvre la période : ses décisions sont retirées, les effets correspondants enregistrés REVERTED, direction alertée
    unwrap(await onResultsReopened(w.deps, w.systemCtx(), { stateId: w.yearStateId, occurredAt: w.clock.now() }));
    const afterReopen = unwrap(await listEffectsOfCouncilView(w.deps, d, DIRECTOR_CAPS, council.id));
    expect(afterReopen.items.filter((e) => e.kind === "RESULTS_DECISION").every((e) => e.status === "REVERTED")).toBe(true);
    // les autres effets appliqués s'annulent par un acte humain motivé ; sans motif : refusé
    const noReason = await revertEffect(w.deps, d, DIRECTOR_CAPS, afterReopen.items.find((e) => e.kind === "ENROLLMENT_OUTCOME")!.id, { reason: "" });
    expect(noReason.ok).toBe(false);
    for (const e of afterReopen.items.filter((x) => x.status === "APPLIED")) unwrap(await revertEffect(w.deps, d, DIRECTOR_CAPS, e.id, { reason: "Correction après réouverture des résultats." }));

    // --- réouverture : PV remplacé, effets non appliqués écartés ---
    const reopened = unwrap(await reopenCouncil(w.deps, d, DIRECTOR_CAPS, council.id));
    expect(reopened.council).toMatchObject({ status: "OPEN", reopenCount: 1, closedAt: null, signedAt: null });
    const superseded = await db.admin.query("SELECT status FROM councils.minutes WHERE id = $1", [minutes.id]);
    expect(superseded.rows[0].status).toBe("SUPERSEDED");
    // le déverrouillage est consommé : une seule réouverture par demande
    const unlocks = await db.admin.query("SELECT status FROM councils.unlock_requests WHERE council_id = $1", [council.id]);
    expect(unlocks.rows.map((r) => r.status)).toEqual(["CONSUMED"]);

    // --- reclôture : version 2 du PV, signatures à recommencer ---
    unwrap(await closeCouncil(w.deps, d, DIRECTOR_CAPS, council.id));
    const v2 = unwrap(await generateMinutes(w.deps, w.secretary.ctx, SECRETARY_CAPS, council.id));
    expect(v2).toMatchObject({ version: 2, supersedesId: minutes.id, status: "GENERATED" });
    unwrap(await signMinutes(w.deps, d, DIRECTOR_CAPS, v2.id));
    expect(unwrap(await signMinutes(w.deps, w.secretary.ctx, SECRETARY_CAPS, v2.id)).status).toBe("SIGNED");
    const reEffects = unwrap(await listEffectsOfCouncilView(w.deps, d, DIRECTOR_CAPS, council.id));
    expect(reEffects.items.filter((e) => e.status === "APPLIED")).toHaveLength(4 + 4 + 4 + 1 + 1);
  }, 120_000);

  it("une séance planifiée s'annule avec un motif (la place est libérée) ", async () => {
    const council = await plannedCouncil(w);
    const noReason = await cancelCouncil(w.deps, w.director.ctx, council.id, { reason: "x" });
    expect(noReason.ok).toBe(false);
    const cancelled = unwrap(await cancelCouncil(w.deps, w.director.ctx, council.id, { reason: "Réunion déplacée par la direction." }));
    expect(cancelled).toMatchObject({ status: "CANCELLED", cancelReason: "Réunion déplacée par la direction." });
    // la place est libre : un nouveau conseil du même type peut être planifié
    const again = await plannedCouncil(w);
    expect(again.id).not.toBe(council.id);
    const events = await db.admin.query("SELECT kind FROM councils.events WHERE council_id = $1 ORDER BY occurred_at", [council.id]);
    expect(events.rows.map((r) => r.kind)).toEqual(["CREATED", "CANCELLED"]);
  });
});
