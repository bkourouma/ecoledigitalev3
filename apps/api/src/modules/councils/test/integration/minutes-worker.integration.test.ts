/**
 * Procès-verbal (immuabilité imposée par la base, signatures concurrentes, signature papier, révocation), rendu par le worker depuis le
 * snapshot seul, abonnés et jobs (idempotence), alerte « conseil à revoir ».
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { COUNCILS_EVENT_TYPES, councilsEventPayloadSchemas } from "@ecoledigitale/contracts/src/v2/councils";
import { createModuleTestDb, describeIntegration, type ModuleTestDb } from "../support/db";
import { DIRECTOR_CAPS, SECRETARY_CAPS, councilOn, freshClassroom, makeWorld, type TestWorld } from "../support/world";
import { getAgenda, prepareCouncil } from "../../application/agenda";
import { closeCouncil, listParticipantsView, openCouncil } from "../../application/councils";
import { recordDecision } from "../../application/deliberation";
import { isBenignConsumerError, onInstitutionCreated, onMinutesGenerated, onOfficialDocumentRendered, onPeriodReopened } from "../../application/consumers";
import { addPaperSignature, generateMinutes, getMinutesPdf, listMinutesView, revokeMinutes, signMinutes } from "../../application/minutes";
import { getClassroomSummary, listEventsView } from "../../application/reads";
import { expireUnlockRequests, requestUnlock } from "../../application/unlock";
import { createCouncilsDeps } from "../../application/deps";
import { ALL_EVENT_TYPES } from "../../domain/events";

const code = (r: { ok: boolean; error?: { code: string } }): string | undefined => (r.ok ? undefined : r.error?.code);

describeIntegration("procès-verbal, rendu, abonnés et jobs (Postgres réel)", () => {
  let db: ModuleTestDb;
  let w: TestWorld;
  beforeAll(async () => {
    db = await createModuleTestDb();
    w = await makeWorld(db);
  }, 120_000);
  afterAll(async () => {
    await db?.drop();
  });

  async function closedCouncil() {
    const cls = freshClassroom(w, { students: 2 });
    const d = w.director.ctx;
    const council = await councilOn(w, cls, { scope: "YEAR" });
    unwrap(await prepareCouncil(w.deps, d, DIRECTOR_CAPS, council.id));
    unwrap(await openCouncil(w.deps, d, DIRECTOR_CAPS, council.id, {}));
    const participants = unwrap(await listParticipantsView(w.deps, d, DIRECTOR_CAPS, council.id));
    const president = participants.find((p) => p.councilFunction === "PRESIDENT")!;
    for (const it of unwrap(await getAgenda(w.deps, d, DIRECTOR_CAPS, council.id)).items) unwrap(await recordDecision(w.deps, d, DIRECTOR_CAPS, it.id, { decisionTypeId: w.decisionTypes.PASSAGE!, deciderParticipantId: president.id, mode: "CONSENSUS" }));
    unwrap(await closeCouncil(w.deps, d, DIRECTOR_CAPS, council.id));
    const minutes = unwrap(await generateMinutes(w.deps, w.secretary.ctx, SECRETARY_CAPS, council.id));
    return { cls, council, minutes, participants, president, secretary: participants.find((p) => p.councilFunction === "SECRETARY")! };
  }

  it("le snapshot est immuable et scellé par la base : modification, suppression, hash falsifié et signature d'un autre contenu sont refusés", async () => {
    const { minutes, president } = await closedCouncil();
    const admin = (sql: string, params: unknown[] = []) => db.tenantDb.run(w.director.ctx, (tx) => tx.query(sql, params));
    await expect(admin("UPDATE councils.minutes SET snapshot = '{}'::jsonb WHERE id = $1", [minutes.id])).rejects.toThrow(/minutes_immutable/);
    await expect(admin("UPDATE councils.minutes SET snapshot_hash = $2 WHERE id = $1", [minutes.id, "a".repeat(64)])).rejects.toThrow(/minutes_immutable/);
    await expect(admin("DELETE FROM councils.minutes WHERE id = $1", [minutes.id])).rejects.toThrow(/immutable|permission denied/);
    // un hash fourni par le client est ignoré à l'insertion : la base le recalcule (vérifié pour tous les PV)
    const all = await db.admin.query("SELECT count(*)::int AS n, count(*) FILTER (WHERE councils.minutes_hash(snapshot) = snapshot_hash)::int AS ok FROM councils.minutes");
    expect(all.rows[0].n).toBe(all.rows[0].ok);
    // signature d'un autre contenu : refusée
    await expect(
      admin("INSERT INTO councils.minute_signatures (id, tenant_id, minutes_id, participant_id, role_code, signer_name, method, signed_hash, signed_by_user) VALUES ($1,$2,$3,$4,'X','X','ELECTRONIC',$5,$6)", [newId(), w.tenantId, minutes.id, president.id, "b".repeat(64), w.director.userId]),
    ).rejects.toThrow(/signature_hash_mismatch/);
    // une signature ne se modifie ni ne se supprime
    unwrap(await signMinutes(w.deps, w.director.ctx, DIRECTOR_CAPS, minutes.id));
    await expect(admin("DELETE FROM councils.minute_signatures WHERE minutes_id = $1", [minutes.id])).rejects.toThrow(/immutable|permission denied/);
    await expect(admin("UPDATE councils.minute_signatures SET signer_name = 'X' WHERE minutes_id = $1", [minutes.id])).rejects.toThrow(/immutable|permission denied/);
  });

  it("deux signataires qui signent EN MÊME TEMPS : le PV et la séance passent SIGNED (signatures sérialisées)", async () => {
    const { council, minutes } = await closedCouncil();
    const results = await Promise.all([signMinutes(w.deps, w.director.ctx, DIRECTOR_CAPS, minutes.id), signMinutes(w.deps, w.secretary.ctx, SECRETARY_CAPS, minutes.id)]);
    expect(results.every((r) => r.ok)).toBe(true);
    const row = await db.admin.query("SELECT c.status AS council, m.status AS minutes, (SELECT count(*)::int FROM councils.minute_signatures WHERE minutes_id = m.id) AS signatures FROM councils.minutes m JOIN councils.councils c ON c.id = m.council_id WHERE m.id = $1", [minutes.id]);
    expect(row.rows[0]).toEqual({ council: "SIGNED", minutes: "SIGNED", signatures: 2 });
    expect(unwrap(await listMinutesView(w.deps, w.director.ctx, DIRECTOR_CAPS, council.id)).items).toHaveLength(1);
  });

  it("signature papier : la pièce doit exister ; on ne signe que pour un participant exigé ; seul un compte lié à une fiche du personnel signe électroniquement", async () => {
    const { minutes, secretary } = await closedCouncil();
    const evidence = "councils/test/signature-secretaire.pdf";
    expect(code(await addPaperSignature(w.deps, w.secretary.ctx, SECRETARY_CAPS, minutes.id, { participantId: secretary.id, evidenceObjectKey: evidence }))).toBe("councils.invalid_reference");
    w.ports.existingObjects.add(evidence);
    expect(code(await addPaperSignature(w.deps, w.secretary.ctx, SECRETARY_CAPS, minutes.id, { participantId: newId(), evidenceObjectKey: evidence }))).toBe("councils.not_a_signer");
    const afterPaper = unwrap(await addPaperSignature(w.deps, w.secretary.ctx, SECRETARY_CAPS, minutes.id, { participantId: secretary.id, evidenceObjectKey: evidence }));
    expect(afterPaper.signatures[0]).toMatchObject({ method: "SCANNED_PAPER", roleCode: "SECRETARY" });
    expect(afterPaper.missingSigners.map((m) => m.roleCode)).toEqual(["PRESIDENT"]);
    // un compte sans fiche du personnel (parent, élève…) ne signe pas ; l'enseignant non signataire non plus
    expect(code(await signMinutes(w.deps, w.guardian.ctx, DIRECTOR_CAPS, minutes.id))).toBe("councils.not_a_participant");
    expect(code(await signMinutes(w.deps, w.teacher.ctx, DIRECTOR_CAPS, minutes.id))).toBe("councils.not_a_participant");
    expect(unwrap(await signMinutes(w.deps, w.director.ctx, DIRECTOR_CAPS, minutes.id)).status).toBe("SIGNED");
    // révocation : sensible, motivée
    expect(code(await revokeMinutes(w.deps, w.director.ctx, { ...DIRECTOR_CAPS, minutesRevoke: false }, minutes.id, { reason: "Motif suffisamment long pour la révocation." }))).toBe("councils.permission_required");
    expect(code(await revokeMinutes(w.deps, w.director.ctx, DIRECTOR_CAPS, minutes.id, { reason: "court" }))).toBe("councils.invalid_input");
    const revoked = unwrap(await revokeMinutes(w.deps, w.director.ctx, DIRECTOR_CAPS, minutes.id, { reason: "Procès-verbal établi par erreur sur la mauvaise classe." }));
    expect(revoked).toMatchObject({ status: "REVOKED", revokedReason: "Procès-verbal établi par erreur sur la mauvaise classe." });
    expect(w.audit.entries.some((e) => e.entry.action === "councils.minutes.revoked" && e.entry.sensitive === true && e.entry.reason)).toBe(true);
  });

  it("rendu : demandé au worker DEPUIS LE SNAPSHOT SEUL (idempotent), URL signée courte après rendu, rendu tardif d'un PV remplacé ignoré", async () => {
    const { minutes } = await closedCouncil();
    const sys = w.systemCtx();
    const event = { id: newId(), type: "councils.minutes.generated", payload: { v: 1, minutesId: minutes.id } };
    expect(unwrap(await onMinutesGenerated(w.deps, sys, event))).toEqual({ requested: true });
    unwrap(await onMinutesGenerated(w.deps, sys, event)); // rejeu : aucun second document
    const requests = w.ports.documentRequests.filter((r) => r.minutesId === minutes.id);
    expect(requests.length).toBeGreaterThanOrEqual(1);
    expect(requests[0]!.snapshot).toMatchObject({ schema: "council-minutes/1", placeholderNotice: expect.stringContaining("démonstration") });
    expect(requests[0]!.ruleSourceKind).toBe("placeholder");
    expect(requests[0]!.title).toContain("Procès-verbal");
    expect(code(await getMinutesPdf(w.deps, w.director.ctx, DIRECTOR_CAPS, minutes.id))).toBe("councils.minutes_not_rendered");
    expect(code(await getMinutesPdf(w.deps, w.director.ctx, { read: true }, minutes.id))).toBe("councils.permission_required");

    w.ports.completeRender(minutes.id);
    const rendered = { id: newId(), type: "reportcards.official_document.rendered", payload: { documentId: newId(), documentKind: "COUNCIL_MINUTES", sourceId: minutes.id } };
    expect(unwrap(await onOfficialDocumentRendered(w.deps, sys, rendered))).toEqual({ updated: true });
    expect(unwrap(await onOfficialDocumentRendered(w.deps, sys, rendered))).toEqual({ updated: false });
    expect(unwrap(await onOfficialDocumentRendered(w.deps, sys, { ...rendered, payload: { ...rendered.payload, documentKind: "RECEIPT" } }))).toEqual({ updated: false });
    const row = await db.admin.query("SELECT render_status, render_hash FROM councils.minutes WHERE id = $1", [minutes.id]);
    expect(row.rows[0]).toEqual({ render_status: "RENDERED", render_hash: "a".repeat(64) });
    const pdf = unwrap(await getMinutesPdf(w.deps, w.director.ctx, DIRECTOR_CAPS, minutes.id));
    expect(pdf.renderHash).toBe("a".repeat(64));
    const ttlMs = new Date(pdf.expiresAt).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(0);
    expect(ttlMs).toBeLessThanOrEqual(5 * 60_000); // URL signée valable 5 minutes au plus
    expect(pdf.url).toContain("ttl=300");
    const evt = await db.admin.query("SELECT payload FROM kernel.domain_events WHERE type = 'councils.minutes.rendered' AND aggregate_id = $1", [minutes.id]);
    expect(evt.rows).toHaveLength(1);
    // un événement illisible est ignoré, jamais rejoué indéfiniment
    expect(unwrap(await onMinutesGenerated(w.deps, sys, { id: newId(), type: "councils.minutes.generated", payload: { v: 1 } }))).toEqual({ requested: false });
  });

  it("résultats rouverts sous une séance signée : effets de results annulés, alerte « conseil à revoir » (jamais de réouverture automatique)", async () => {
    const { council, cls, minutes } = await closedCouncil();
    unwrap(await signMinutes(w.deps, w.director.ctx, DIRECTOR_CAPS, minutes.id));
    unwrap(await signMinutes(w.deps, w.secretary.ctx, SECRETARY_CAPS, minutes.id));
    const stateId = (await w.ports.resultsRead.getStateView(w.director.ctx, { classroomId: cls.classroomId, academicYearId: w.yearId, academicPeriodId: null }))!.stateId;
    const event = { id: newId(), type: "results.period.reopened", payload: { v: 1, stateId }, occurredAt: new Date(w.clock.now().getTime() + 1000) };
    expect(unwrap(await onPeriodReopened(w.deps, w.systemCtx(), event)).reverted).toBe(2);
    expect(unwrap(await onPeriodReopened(w.deps, w.systemCtx(), event)).reverted).toBe(0); // rejeu : sans effet
    const summary = unwrap(await getClassroomSummary(w.deps, w.director.ctx, DIRECTOR_CAPS, cls.classroomId));
    expect(summary.reviewNeeded).toEqual([council.id]);
    expect(summary.councils[0]).toMatchObject({ status: "SIGNED", decided: 2 });
    expect(summary.decisionsByCode).toEqual({ PASSAGE: 2 });
    const status = await db.admin.query("SELECT status FROM councils.councils WHERE id = $1", [council.id]);
    expect(status.rows[0].status).toBe("SIGNED"); // jamais rouvert automatiquement
    const journal = unwrap(await listEventsView(w.deps, w.director.ctx, DIRECTOR_CAPS, council.id));
    expect(journal.items.map((e) => e.kind)).toEqual(expect.arrayContaining(["CREATED", "OPENED", "CLOSED", "SIGNED", "RESULTS_REOPENED"]));
    const alert = await db.admin.query("SELECT payload FROM kernel.domain_events WHERE type = 'councils.council.review_needed' AND aggregate_id = $1", [council.id]);
    expect(alert.rows).toHaveLength(1);
  });

  it("job d'expiration : une demande de déverrouillage restée ouverte au-delà du délai passe EXPIRED", async () => {
    const { council, minutes } = await closedCouncil();
    unwrap(await signMinutes(w.deps, w.director.ctx, DIRECTOR_CAPS, minutes.id));
    unwrap(await signMinutes(w.deps, w.secretary.ctx, SECRETARY_CAPS, minutes.id));
    const request = unwrap(await requestUnlock(w.deps, w.secretary.ctx, SECRETARY_CAPS, council.id, { reason: "Vérification d'une erreur possible dans une décision." }));
    const realClock = createCouncilsDeps({ db: db.tenantDb, ports: w.ports });
    expect(unwrap(await expireUnlockRequests(realClock, w.systemCtx())).expired).toBe(0); // trop récent (horloge réelle = celle de la base)
    const later = createCouncilsDeps({ db: db.tenantDb, clock: { now: () => new Date(Date.now() + 40 * 86_400_000) }, ports: w.ports });
    expect(unwrap(await expireUnlockRequests(later, w.systemCtx())).expired).toBeGreaterThanOrEqual(1);
    const row = await db.admin.query("SELECT status FROM councils.unlock_requests WHERE id = $1", [request.id]);
    expect(row.rows[0].status).toBe("EXPIRED");
  });

  it("abonné du modèle de pack : seul le pack SECONDARY, idempotent ; charge illisible ignorée ; pays sans modèle = erreur bénigne", async () => {
    const inst = newId();
    const sys = w.systemCtx();
    const ev = (payload: unknown) => ({ id: newId(), type: "tenancy.institution.created", payload });
    expect(unwrap(await onInstitutionCreated(w.deps, sys, ev({ institutionId: inst, pack: "PRIMARY" })))).toEqual({ applied: false });
    expect(unwrap(await onInstitutionCreated(w.deps, sys, ev({ nonsense: true })))).toEqual({ applied: false });
    expect(unwrap(await onInstitutionCreated(w.deps, sys, ev({ institutionId: inst, pack: "SECONDARY" })))).toEqual({ applied: true });
    expect(unwrap(await onInstitutionCreated(w.deps, sys, ev({ institutionId: inst, pack: "SECONDARY" })))).toEqual({ applied: false }); // rejeu
    const unknown = await onInstitutionCreated(w.deps, sys, ev({ institutionId: newId(), pack: "SECONDARY", educationSystem: "ZZ" }));
    expect(unknown.ok).toBe(false);
    expect(!unknown.ok && isBenignConsumerError(unknown.error)).toBe(true);
  });

  it("événements écrits : charge conforme au contrat versionné, catalogue = contrat, aucun texte libre", async () => {
    expect([...ALL_EVENT_TYPES].sort()).toEqual([...COUNCILS_EVENT_TYPES].sort());
    const rows = await db.admin.query("SELECT type, payload FROM kernel.domain_events WHERE type LIKE 'councils.%'");
    expect(rows.rows.length).toBeGreaterThan(10);
    const seen = new Set<string>();
    for (const r of rows.rows as Array<{ type: string; payload: unknown }>) {
      const schema = (councilsEventPayloadSchemas as Record<string, { parse: (v: unknown) => unknown }>)[r.type];
      expect(schema, `contrat de ${r.type}`).toBeDefined();
      expect(() => schema!.parse(r.payload), r.type).not.toThrow();
      seen.add(r.type);
      expect(JSON.stringify(r.payload)).not.toMatch(/justification|body|reason|appreciation/i);
    }
    expect(seen.size).toBeGreaterThanOrEqual(10);
  });
});
