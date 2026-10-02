/**
 * Cas d'usage du dossier d'affectation sur une base réelle (ports en mémoire) : enregistrement, vérification HUMAINE avec séparation
 * des tâches, rattachement de l'inscription (une seule source de la référence), avenant versionné, refus d'un acteur non humain,
 * périmètre d'établissement, vue famille limitée, événements d'outbox et audit dans la même transaction.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequestContext } from "@ecoledigitale/kernel";
import { actOnAssignment, amendAssignment, getAssignmentDetail, getChildAssignment, listAssignmentPage, recordAssignment, updateAssignment } from "../../application/assignments";
import { createStateassignDeps } from "../../application/deps";
import { fetchFromGateway, getGatewayStatus } from "../../application/reports";
import { RecordingAudit } from "../../application/ports";
import { PEOPLE, createEnv, errorCodeOf, outboxPayloads, outboxTypes, unwrapOk, uuid, type Env } from "../support/harness";
import { describeIntegration } from "../support/db";

let env: Env;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(async () => {
  await env?.close();
});

const record = (tenant: string, enrollmentId: string, who: string = PEOPLE.secretary, over: Record<string, unknown> = {}) =>
  recordAssignment(env.deps, env.user(tenant, who), { enrollmentId, reference: `AFF-${uuid().slice(0, 6)}`, declaredStateAmount: 400000, declaredParentAmount: 100000, issuingAuthority: "Autorité", issuedOn: "2026-09-15", ...over } as never);

describeIntegration("stateassign : dossier d'affectation (cas d'usage)", () => {
  it("enregistre un dossier RECEIVED : montants entiers, enregistrant = utilisateur de la session, événement et audit dans la même transaction", async () => {
    const t = await env.tenant();
    const e = env.enroll({ studentName: "KOUASSI Awa" });
    const dto = unwrapOk(await record(t, e.enrollmentId, PEOPLE.secretary, { reference: "  AFF-2026-001 " }));
    expect(dto).toMatchObject({ status: "RECEIVED", version: 1, reference: "AFF-2026-001", source: "MANUAL", receivedBy: PEOPLE.secretary, declaredState: { amount: 400000, currency: "XOF" }, declaredParent: { amount: 100000, currency: "XOF" } });
    expect(dto.institutionId).toBe(e.institutionId);
    expect(dto.studentId).toBe(e.studentId);
    expect(await outboxTypes(env.db, dto.id)).toEqual(["stateassign.assignment.received"]);
    expect(env.audit.entries.at(-1)).toMatchObject({ action: "stateassign.assignment.received", resourceType: "assignment", resourceId: dto.id });
    const payload = (await outboxPayloads(env.db, "stateassign.assignment.received")).at(-1)!;
    expect(payload).toMatchObject({ v: 1, assignmentId: dto.id, enrollmentId: e.enrollmentId, status: "RECEIVED", previousStatus: null, source: "MANUAL" });
    expect(JSON.stringify(payload)).not.toContain("AFF-2026-001"); // aucune référence d'acte dans un événement
  });

  it("refuse un montant flottant ou négatif, une référence vide, une inscription inconnue ou annulée", async () => {
    const t = await env.tenant();
    const e = env.enroll();
    expect(errorCodeOf(await record(t, e.enrollmentId, PEOPLE.secretary, { declaredStateAmount: 100.5 }))).toBe("stateassign.invalid_input");
    expect(errorCodeOf(await record(t, e.enrollmentId, PEOPLE.secretary, { declaredParentAmount: -1 }))).toBe("stateassign.invalid_input");
    expect(errorCodeOf(await record(t, e.enrollmentId, PEOPLE.secretary, { reference: "   " }))).toBe("stateassign.invalid_input");
    expect(errorCodeOf(await record(t, uuid()))).toBe("stateassign.enrollment_not_found");
    const cancelled = env.enroll({ status: "CANCELLED" });
    expect(errorCodeOf(await record(t, cancelled.enrollmentId))).toBe("stateassign.enrollment_not_eligible");
  });

  it("un seul dossier vivant par inscription et une référence par établissement et année : conflits stables, sans 500", async () => {
    const t = await env.tenant();
    const e = env.enroll();
    unwrapOk(await record(t, e.enrollmentId, PEOPLE.secretary, { reference: "R-1" }));
    expect(errorCodeOf(await record(t, e.enrollmentId, PEOPLE.secretary, { reference: "R-2" }))).toBe("stateassign.duplicate_live_assignment");
    const e2 = env.enroll({ institutionId: e.institutionId, yearId: e.yearId });
    expect(errorCodeOf(await record(t, e2.enrollmentId, PEOPLE.secretary, { reference: "R-1" }))).toBe("stateassign.duplicate_reference");
  });

  it("la VÉRIFICATION est humaine : un job, un opérateur de plateforme et l'enregistrant lui-même sont refusés ; aucune trace laissée", async () => {
    const t = await env.tenant();
    const e = env.enroll();
    const a = unwrapOk(await record(t, e.enrollmentId));
    const before = env.world.fundingCalls.length;
    expect(errorCodeOf(await actOnAssignment(env.deps, env.system(t), a.id, "verify", {}))).toBe("stateassign.human_actor_required");
    const operator = createRequestContext({ tenantId: t, userId: PEOPLE.director, actor: "superAdmin" });
    expect(errorCodeOf(await actOnAssignment(env.deps, operator, a.id, "verify", {}))).toBe("stateassign.human_actor_required");
    expect(errorCodeOf(await actOnAssignment(env.deps, env.user(t, PEOPLE.secretary), a.id, "verify", {}))).toBe("stateassign.four_eyes_required");
    expect(env.world.fundingCalls.length).toBe(before);
    expect((await getAssignmentDetail(env.deps, env.user(t, PEOPLE.bursar), a.id)).ok).toBe(true);
    const detail = unwrapOk(await getAssignmentDetail(env.deps, env.user(t, PEOPLE.bursar), a.id));
    expect(detail.assignment.status).toBe("RECEIVED");
    expect(detail.assignment.verifiedBy).toBeNull();
  });

  it("la base refuse aussi une vérification faite hors du cas d'usage par un acteur non humain (défense en profondeur)", async () => {
    const t = await env.tenant();
    const e = env.enroll();
    const a = unwrapOk(await record(t, e.enrollmentId));
    await expect(env.deps.db.run(env.system(t), (tx) => tx.query("UPDATE stateassign.assignments SET status = 'VERIFIED' WHERE id = $1", [a.id]))).rejects.toThrow(/human_actor_required/);
  });

  it("vérifier : autre personne que l'enregistrant ; vérificateur et date posés par la base ; la référence est transmise à academic (une seule source)", async () => {
    const t = await env.tenant();
    const e = env.enroll();
    const a = unwrapOk(await record(t, e.enrollmentId, PEOPLE.secretary, { reference: "AFF-VER-1", issuingAuthority: "Direction régionale" }));
    const v = unwrapOk(await actOnAssignment(env.deps, env.user(t, PEOPLE.bursar), a.id, "verify", { note: "Pièces conformes", rowVersion: a.rowVersion }));
    expect(v).toMatchObject({ status: "VERIFIED", verifiedBy: PEOPLE.bursar, verificationNote: "Pièces conformes" });
    expect(v.verifiedAt).toBeTruthy();
    const call = env.world.fundingCalls.at(-1)!;
    expect(call).toMatchObject({ enrollmentId: e.enrollmentId, reference: "AFF-VER-1", funderLabel: "Direction régionale", issuedOn: "2026-09-15" });
    expect(env.world.enrollmentsById.get(e.enrollmentId)).toMatchObject({ fundingType: "STATE_ASSIGNED", assignmentReference: "AFF-VER-1" });
    expect(await outboxTypes(env.db, a.id)).toEqual(["stateassign.assignment.received", "stateassign.assignment.verified"]);
    expect(env.audit.entries.at(-1)).toMatchObject({ action: "stateassign.assignment.verified", sensitive: true });
    const detail = unwrapOk(await getAssignmentDetail(env.deps, env.user(t, PEOPLE.bursar), a.id));
    expect(detail.enrollment).toMatchObject({ fundingType: "STATE_ASSIGNED", assignmentReference: "AFF-VER-1", referenceMatchesAssignment: true });
  });

  it("un refus d'academic ANNULE la vérification (aucune demi-vérification) ; la réglage « séparation des tâches » désactivé laisse l'enregistrant vérifier", async () => {
    const t = await env.tenant();
    const e = env.enroll();
    const a = unwrapOk(await record(t, e.enrollmentId));
    env.world.fundingRefusal = { code: "academic.funding_funder_required", message: "le financement exige l'identification du financeur" };
    const refused = await actOnAssignment(env.deps, env.user(t, PEOPLE.bursar), a.id, "verify", {});
    expect(errorCodeOf(refused)).toBe("stateassign.enrollment_funding_refused");
    env.world.fundingRefusal = null;
    const still = unwrapOk(await getAssignmentDetail(env.deps, env.user(t, PEOPLE.bursar), a.id));
    expect(still.assignment.status).toBe("RECEIVED");
    expect(await outboxTypes(env.db, a.id)).toEqual(["stateassign.assignment.received"]);
    // réglage : l'enregistrant peut alors vérifier (acte humain tout de même)
    await env.db.tenantDb.run(env.user(t, PEOPLE.director), (tx) => tx.query("INSERT INTO stateassign.settings (tenant_id, institution_id, require_separate_verifier) VALUES ($1,$2,false)", [t, e.institutionId]));
    const self = unwrapOk(await actOnAssignment(env.deps, env.user(t, PEOPLE.secretary), a.id, "verify", {}));
    expect(self.status).toBe("VERIFIED");
  });

  it("cycle de vie complet par des humains : activer, suspendre (motif), reprendre, terminer (date et motif) ; transitions invalides refusées", async () => {
    const t = await env.tenant();
    const e = env.enroll();
    const a = unwrapOk(await record(t, e.enrollmentId));
    const human = env.user(t, PEOPLE.bursar);
    expect(errorCodeOf(await actOnAssignment(env.deps, human, a.id, "activate", {}))).toBe("stateassign.transition_invalid");
    unwrapOk(await actOnAssignment(env.deps, human, a.id, "verify", {}));
    expect(unwrapOk(await actOnAssignment(env.deps, human, a.id, "activate", {})).status).toBe("ACTIVE");
    expect(errorCodeOf(await actOnAssignment(env.deps, human, a.id, "suspend", { reason: "" }))).toBe("stateassign.invalid_input");
    expect(unwrapOk(await actOnAssignment(env.deps, human, a.id, "suspend", { reason: "Pièces à renouveler" })).status).toBe("SUSPENDED");
    expect(errorCodeOf(await actOnAssignment(env.deps, human, a.id, "activate", {}))).toBe("stateassign.transition_invalid");
    expect(unwrapOk(await actOnAssignment(env.deps, human, a.id, "resume", {})).status).toBe("ACTIVE");
    expect(errorCodeOf(await actOnAssignment(env.deps, human, a.id, "end", { reason: "Fin d'année" }))).toBe("stateassign.invalid_input"); // date de fin requise
    const ended = unwrapOk(await actOnAssignment(env.deps, human, a.id, "end", { reason: "Fin de l'année scolaire", endedOn: "2027-06-30" }));
    expect(ended).toMatchObject({ status: "ENDED", endedOn: "2027-06-30" });
    expect(errorCodeOf(await actOnAssignment(env.deps, human, a.id, "resume", {}))).toBe("stateassign.transition_invalid");
    expect(await outboxTypes(env.db, a.id)).toEqual([
      "stateassign.assignment.received",
      "stateassign.assignment.verified",
      "stateassign.assignment.activated",
      "stateassign.assignment.suspended",
      "stateassign.assignment.resumed",
      "stateassign.assignment.ended",
    ]);
  });

  it("rejet motivé ; rejeter un dossier déjà vérifié laisse l'inscription telle quelle (marqué dans l'audit) ; la référence est libérée", async () => {
    const t = await env.tenant();
    const e = env.enroll();
    const a = unwrapOk(await record(t, e.enrollmentId, PEOPLE.secretary, { reference: "R-REJ" }));
    expect(errorCodeOf(await actOnAssignment(env.deps, env.user(t, PEOPLE.bursar), a.id, "reject", { reason: "ko" }))).toBe("stateassign.invalid_input");
    unwrapOk(await actOnAssignment(env.deps, env.user(t, PEOPLE.bursar), a.id, "verify", {}));
    const rejected = unwrapOk(await actOnAssignment(env.deps, env.user(t, PEOPLE.director), a.id, "reject", { reason: "Acte non reconnu par l'autorité" }));
    expect(rejected).toMatchObject({ status: "REJECTED", rejectionReason: "Acte non reconnu par l'autorité" });
    expect(env.audit.entries.at(-1)).toMatchObject({ action: "stateassign.assignment.rejected", metadata: { enrollmentFundingUnchanged: true } });
    // l'inscription n'est pas modifiée automatiquement : un humain décidera
    expect(env.world.enrollmentsById.get(e.enrollmentId)!.fundingType).toBe("STATE_ASSIGNED");
    unwrapOk(await record(t, e.enrollmentId, PEOPLE.secretary, { reference: "R-REJ" }));
  });

  it("correction avant vérification (concurrence optimiste) ; après vérification, le fond est figé : avenant obligatoire", async () => {
    const t = await env.tenant();
    const e = env.enroll();
    const a = unwrapOk(await record(t, e.enrollmentId));
    const human = env.user(t, PEOPLE.secretary);
    const fixed = unwrapOk(await updateAssignment(env.deps, human, a.id, { declaredStateAmount: 450000, rowVersion: a.rowVersion }));
    expect(fixed.declaredState!.amount).toBe(450000);
    expect(errorCodeOf(await updateAssignment(env.deps, human, a.id, { declaredStateAmount: 460000, rowVersion: a.rowVersion }))).toBe("stateassign.version_conflict");
    unwrapOk(await actOnAssignment(env.deps, env.user(t, PEOPLE.bursar), a.id, "verify", {}));
    expect(errorCodeOf(await updateAssignment(env.deps, human, a.id, { declaredStateAmount: 500000, rowVersion: 99 }))).toMatch(/content_frozen|version_conflict/);
    const fresh = unwrapOk(await getAssignmentDetail(env.deps, human, a.id)).assignment;
    expect(errorCodeOf(await updateAssignment(env.deps, human, a.id, { declaredStateAmount: 500000, rowVersion: fresh.rowVersion }))).toBe("stateassign.content_frozen");
    // les notes restent modifiables
    expect(unwrapOk(await updateAssignment(env.deps, human, a.id, { notes: "Dossier complet", rowVersion: fresh.rowVersion })).notes).toBe("Dossier complet");
  });

  it("avenant : remplace la version courante puis crée la version n+1 (RECEIVED) ; l'historique des versions est conservé ; la référence d'academic ne change qu'à la vérification de la v2", async () => {
    const t = await env.tenant();
    const e = env.enroll();
    const a = unwrapOk(await record(t, e.enrollmentId, PEOPLE.secretary, { reference: "AFF-77" }));
    unwrapOk(await actOnAssignment(env.deps, env.user(t, PEOPLE.bursar), a.id, "verify", {}));
    const v1 = unwrapOk(await actOnAssignment(env.deps, env.user(t, PEOPLE.bursar), a.id, "activate", {}));
    const secretary = env.user(t, PEOPLE.secretary);
    expect(errorCodeOf(await amendAssignment(env.deps, secretary, a.id, { reason: "Rien ne change", effectiveOn: "2026-11-01", rowVersion: v1.rowVersion }))).toBe("stateassign.amendment_empty");
    expect(errorCodeOf(await amendAssignment(env.deps, secretary, a.id, { reason: "ko", effectiveOn: "2026-11-01", declaredStateAmount: 1, rowVersion: v1.rowVersion }))).toBe("stateassign.invalid_input");
    const out = unwrapOk(await amendAssignment(env.deps, secretary, a.id, { reason: "Avenant n°2 : montant État révisé", effectiveOn: "2026-11-01", declaredStateAmount: 450000, reference: "AFF-77-B", rowVersion: v1.rowVersion }));
    expect(out.superseded).toMatchObject({ id: a.id, status: "SUPERSEDED", endedOn: "2026-11-01" });
    expect(out.current).toMatchObject({ version: 2, status: "RECEIVED", supersedesId: a.id, reference: "AFF-77-B", declaredState: { amount: 450000 }, declaredParent: { amount: 100000 }, receivedBy: PEOPLE.secretary });
    // academic porte encore la référence de la v1 jusqu'à la vérification de la v2
    expect(env.world.enrollmentsById.get(e.enrollmentId)!.assignmentReference).toBe("AFF-77");
    unwrapOk(await actOnAssignment(env.deps, env.user(t, PEOPLE.bursar), out.current.id, "verify", {}));
    expect(env.world.enrollmentsById.get(e.enrollmentId)!.assignmentReference).toBe("AFF-77-B");
    const detail = unwrapOk(await getAssignmentDetail(env.deps, env.user(t, PEOPLE.bursar), out.current.id));
    expect(detail.versions.map((x) => [x.version, x.status])).toEqual([[1, "SUPERSEDED"], [2, "VERIFIED"]]);
    expect(await outboxTypes(env.db, out.current.id)).toContain("stateassign.assignment.received");
    expect(await outboxTypes(env.db, a.id)).toContain("stateassign.assignment.superseded");
    expect(env.audit.entries.find((x) => x.action === "stateassign.assignment.amended")).toMatchObject({ sensitive: true, reason: "Avenant n°2 : montant État révisé" });
    // un avenant ne s'applique pas à un dossier RECEIVED
    expect(errorCodeOf(await amendAssignment(env.deps, secretary, out.superseded.id, { reason: "Encore un avenant", effectiveOn: "2026-12-01", declaredStateAmount: 1, rowVersion: 1 }))).toBe("stateassign.transition_invalid");
  });

  it("amender est un acte humain ; un job ne peut ni amender ni modifier", async () => {
    const t = await env.tenant();
    const e = env.enroll();
    const a = unwrapOk(await record(t, e.enrollmentId));
    unwrapOk(await actOnAssignment(env.deps, env.user(t, PEOPLE.bursar), a.id, "verify", {}));
    expect(errorCodeOf(await amendAssignment(env.deps, env.system(t), a.id, { reason: "Avenant automatique", effectiveOn: "2026-11-01", declaredStateAmount: 1, rowVersion: 2 }))).toBe("stateassign.human_actor_required");
    expect(errorCodeOf(await updateAssignment(env.deps, env.system(t), a.id, { notes: "x", rowVersion: 2 }))).toBe("stateassign.human_actor_required");
  });

  it("un import (acteur système) enregistre sans vérifier ; la vérification reste à un humain", async () => {
    const t = await env.tenant();
    const e = env.enroll();
    const imp = unwrapOk(await recordAssignment(env.deps, env.system(t), { enrollmentId: e.enrollmentId, reference: "IMP-1", declaredStateAmount: 1000, source: "IMPORT" }));
    expect(imp).toMatchObject({ status: "RECEIVED", source: "IMPORT", receivedBy: null });
    expect(errorCodeOf(await actOnAssignment(env.deps, env.system(t), imp.id, "verify", {}))).toBe("stateassign.human_actor_required");
    // le premier humain qui vérifie n'a pas enregistré : la séparation des tâches ne bloque pas un import
    expect(unwrapOk(await actOnAssignment(env.deps, env.user(t, PEOPLE.secretary), imp.id, "verify", {})).status).toBe("VERIFIED");
    // la passerelle exige l'empreinte de l'échange
    const e2 = env.enroll();
    expect(errorCodeOf(await recordAssignment(env.deps, env.system(t), { enrollmentId: e2.enrollmentId, reference: "GW-1", source: "GATEWAY" }))).toBe("stateassign.invalid_input");
    const gw = unwrapOk(await recordAssignment(env.deps, env.system(t), { enrollmentId: e2.enrollmentId, reference: "GW-1", source: "GATEWAY", externalPayloadHash: "b".repeat(64), externalRef: "EXT-9" }));
    expect(gw).toMatchObject({ source: "GATEWAY", externalRef: "EXT-9" });
  });

  it("périmètre : un contexte lié à un établissement ne voit ni ne touche les dossiers d'un autre (404, listes filtrées)", async () => {
    const t = await env.tenant();
    const e1 = env.enroll();
    const e2 = env.enroll();
    const a1 = unwrapOk(await record(t, e1.enrollmentId));
    const a2 = unwrapOk(await record(t, e2.enrollmentId));
    const scoped = env.user(t, PEOPLE.bursar, { institutionId: e1.institutionId });
    expect(unwrapOk(await getAssignmentDetail(env.deps, scoped, a1.id)).assignment.id).toBe(a1.id);
    expect(errorCodeOf(await getAssignmentDetail(env.deps, scoped, a2.id))).toBe("stateassign.assignment_not_found");
    expect(errorCodeOf(await actOnAssignment(env.deps, scoped, a2.id, "verify", {}))).toBe("stateassign.assignment_not_found");
    const page = unwrapOk(await listAssignmentPage(env.deps, scoped, { page: 1, pageSize: 50 } as never));
    expect(page.items.map((i) => i.id)).toEqual([a1.id]);
    const other = unwrapOk(await listAssignmentPage(env.deps, scoped, { page: 1, pageSize: 50, institutionId: e2.institutionId } as never));
    expect(other.items).toEqual([]);
    expect(errorCodeOf(await record(t, e2.enrollmentId, PEOPLE.bursar))).toBeDefined();
    expect(errorCodeOf(await recordAssignment(env.deps, scoped, { enrollmentId: e2.enrollmentId, reference: "X-1" }))).toBe("stateassign.enrollment_not_found");
  });

  it("liste : filtres (statut, recherche de référence, historique exclu par défaut) et noms décorés ; un annuaire en panne ne casse pas la liste", async () => {
    const t = await env.tenant();
    const inst = uuid();
    const year = uuid();
    const e1 = env.enroll({ institutionId: inst, yearId: year, studentName: "TRAORE Moussa" });
    const e2 = env.enroll({ institutionId: inst, yearId: year });
    const a1 = unwrapOk(await record(t, e1.enrollmentId, PEOPLE.secretary, { reference: "ALPHA-001" }));
    unwrapOk(await record(t, e2.enrollmentId, PEOPLE.secretary, { reference: "BETA_002" }));
    unwrapOk(await actOnAssignment(env.deps, env.user(t, PEOPLE.bursar), a1.id, "verify", {}));
    const human = env.user(t, PEOPLE.bursar);
    const all = unwrapOk(await listAssignmentPage(env.deps, human, { institutionId: inst, page: 1, pageSize: 50 } as never));
    expect(all.total).toBe(2);
    expect(all.items.find((i) => i.id === a1.id)!.studentName).toBe("TRAORE Moussa");
    expect(unwrapOk(await listAssignmentPage(env.deps, human, { institutionId: inst, status: "VERIFIED", page: 1, pageSize: 50 } as never)).items.map((i) => i.reference)).toEqual(["ALPHA-001"]);
    expect(unwrapOk(await listAssignmentPage(env.deps, human, { institutionId: inst, q: "beta_", page: 1, pageSize: 50 } as never)).items.map((i) => i.reference)).toEqual(["BETA_002"]);
    expect(unwrapOk(await listAssignmentPage(env.deps, human, { institutionId: inst, q: "%", page: 1, pageSize: 50 } as never)).items).toEqual([]); // le % n'est pas un joker
    const broken = createStateassignDeps({
      db: env.db.tenantDb,
      clock: env.clock,
      audit: new RecordingAudit(),
      ports: { ...env.world, students: { names: async () => { throw new Error("people indisponible"); } } },
    });
    expect(unwrapOk(await listAssignmentPage(broken, human, { institutionId: inst, page: 1, pageSize: 50 } as never)).items.every((i) => i.studentName === null)).toBe(true);
  });

  it("vue FAMILLE : le statut seulement, jamais les montants, les échéances, les écarts ni les contrôles", async () => {
    const t = await env.tenant();
    const e = env.enroll();
    const a = unwrapOk(await record(t, e.enrollmentId, PEOPLE.secretary, { reference: "FAM-1" }));
    const none = unwrapOk(await getChildAssignment(env.deps, env.user(t, PEOPLE.parent), uuid()));
    expect(none).toMatchObject({ hasAssignment: false, status: null, verified: false });
    const before = unwrapOk(await getChildAssignment(env.deps, env.user(t, PEOPLE.parent), e.studentId));
    expect(before).toMatchObject({ hasAssignment: true, status: "RECEIVED", verified: false, reference: "FAM-1" });
    unwrapOk(await actOnAssignment(env.deps, env.user(t, PEOPLE.bursar), a.id, "verify", {}));
    const after = unwrapOk(await getChildAssignment(env.deps, env.user(t, PEOPLE.parent), e.studentId));
    expect(after).toMatchObject({ status: "VERIFIED", verified: true });
    expect(Object.keys(after).sort()).toEqual(["academicYearId", "hasAssignment", "issuedOn", "reference", "status", "studentId", "verified"]);
    expect(JSON.stringify(after)).not.toMatch(/amount|delta|declared|control|receivable/i);
  });

  it("passerelle : adaptateur NotConfigured explicite, aucun appel externe, refus stable", async () => {
    const t = await env.tenant();
    expect(getGatewayStatus(env.deps)).toMatchObject({ configured: false, adapter: "NotConfigured" });
    expect(errorCodeOf(await fetchFromGateway(env.deps, env.user(t, PEOPLE.secretary), "AFF-1"))).toBe("stateassign.gateway_not_configured");
    expect(errorCodeOf(await fetchFromGateway(env.deps, env.system(t), "AFF-1"))).toBe("stateassign.human_actor_required");
  });

  it("échec fermé : sans port `academic`, enregistrer ou vérifier est refusé (stateassign.port_unavailable) et rien n'est écrit", async () => {
    const t = await env.tenant();
    const bare = createStateassignDeps({ db: env.db.tenantDb, clock: env.clock, audit: new RecordingAudit() });
    expect(errorCodeOf(await recordAssignment(bare, env.user(t, PEOPLE.secretary), { enrollmentId: uuid(), reference: "X" }))).toBe("stateassign.port_unavailable");
    const n = await env.db.admin.query("SELECT count(*)::int AS n FROM stateassign.assignments WHERE tenant_id = $1", [t]);
    expect(n.rows[0].n).toBe(0);
  });

  it("un échec d'audit annule tout (donnée, historique, événement)", async () => {
    const t = await env.tenant();
    const e = env.enroll();
    const failing = createStateassignDeps({ db: env.db.tenantDb, clock: env.clock, audit: { record: async () => { throw new Error("audit indisponible"); } }, ports: env.world });
    await expect(recordAssignment(failing, env.user(t, PEOPLE.secretary), { enrollmentId: e.enrollmentId, reference: "NOAUDIT" })).rejects.toThrow(/audit indisponible/);
    const rows = await env.db.admin.query("SELECT 1 FROM stateassign.assignments WHERE tenant_id = $1", [t]);
    expect(rows.rows).toHaveLength(0);
    const events = await env.db.admin.query("SELECT 1 FROM kernel.domain_events WHERE tenant_id = $1", [t]);
    expect(events.rows).toHaveLength(0);
  });
});
