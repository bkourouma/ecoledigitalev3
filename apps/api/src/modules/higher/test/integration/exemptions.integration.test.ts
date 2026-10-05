/**
 * O-14 — dispense d'UE manuelle avec motif (direction) : tracée, révocable, impact sur les crédits selon un PARAMÈTRE de
 * l'établissement (Postgres réel, RLS A/B).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { declareAnnualUe } from "../../application/annual-ue";
import { awardDiploma } from "../../application/awards";
import { createDiploma } from "../../application/diplomas";
import { getExemptionSettings, grantExemption, listExemptions, revokeExemption, setExemptionCreditPolicy } from "../../application/exemptions";
import { capitalizePeriod, getCreditSummary, listAcquiredUe, listDebts } from "../../application/ledger";
import { checkPrerequisites, setPrerequisites } from "../../application/prerequisites";
import { updateHigherSettings } from "../../application/settings";
import { adminOne, adminRows, createHigherTestDb, describeIntegration, type HigherTestDb } from "../support/db";
import { CAPS, makeWorld, scriptRules, seedSchool, ueLine, type School, type TestWorld } from "../support/world";

describeIntegration("O-14 : dispense d'UE manuelle (Postgres réel)", () => {
  let db: HigherTestDb;
  beforeAll(async () => {
    db = await createHigherTestDb();
  });
  afterAll(async () => {
    await db.drop();
  });

  const fresh = async (students = 2): Promise<{ w: TestWorld; s: School }> => {
    const w = makeWorld(db);
    scriptRules(w);
    const s = await seedSchool(db, w, { students });
    return { w, s };
  };
  const input = (s: School, over: Partial<Parameters<typeof grantExemption>[2]> = {}) => ({
    studentId: s.students[0]!.studentId,
    enrollmentId: s.students[0]!.enrollmentId,
    ueNodeId: s.ues[0]!.nodeId,
    academicPeriodId: s.periodId,
    reason: "Équivalence reconnue par la direction des études",
    ...over,
  });
  const codeOf = (r: { ok: boolean; error?: { code: string } }) => (r.ok ? null : (r.error?.code ?? "?"));
  const ledgerRows = (s: School) => adminRows<any>(db, "SELECT ue_node_id, credits::text, acquired_via, session_obtained, status, source_result_id FROM higher.credit_ledger WHERE tenant_id = $1 ORDER BY acquired_at, id", [s.tenantId]);
  const events = (tenantId: string, type: string) => adminRows<{ payload: any }>(db, "SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = $2 ORDER BY occurred_at, id", [tenantId, type]);

  it("politique par défaut RECORD_ONLY : dispense enregistrée et tracée, AUCUN effet sur les crédits ni la validation", async () => {
    const { w, s } = await fresh();
    expect(unwrap(await getExemptionSettings(w.deps, s.admin.ctx))).toEqual({ exemptionCreditPolicy: "RECORD_ONLY" });
    const e = unwrap(await grantExemption(w.deps, s.admin.ctx, input(s)));
    expect(e).toMatchObject({ status: "ACTIVE", creditPolicy: "RECORD_ONLY", ledgerId: null, credits: 6, reason: "Équivalence reconnue par la direction des études", grantedBy: s.admin.userId });
    expect(await ledgerRows(s)).toHaveLength(0);
    expect(unwrap(await getCreditSummary(w.deps, s.admin.ctx, s.students[0]!.studentId)).totalCredits).toBe(0);
    // événement sans donnée d'identité, audit SENSIBLE avec motif
    const [ev] = await events(s.tenantId, "higher.ue.exempted");
    expect(ev!.payload).toEqual({ v: 1, exemptionId: e.id, studentId: s.students[0]!.studentId, ueNodeId: s.ues[0]!.nodeId, enrollmentId: s.students[0]!.enrollmentId, creditPolicy: "RECORD_ONLY", ledgerId: null });
    expect(w.audit.entries.find((x) => x.entry.action === "higher.exemption.granted")?.entry).toMatchObject({ sensitive: true, reason: "Équivalence reconnue par la direction des études", resourceId: e.id });
    expect(unwrap(await listExemptions(w.deps, s.admin.ctx, { studentId: s.students[0]!.studentId }))).toHaveLength(1);
  });

  it("motif obligatoire (10 caractères), UE et inscription vérifiées, une seule dispense active par (étudiant, UE)", async () => {
    const { w, s } = await fresh();
    expect(codeOf(await grantExemption(w.deps, s.admin.ctx, input(s, { reason: "court" })))).toBe("higher.exemption_reason_required");
    expect(codeOf(await grantExemption(w.deps, s.admin.ctx, input(s, { reason: "         " })))).toBe("higher.exemption_reason_required");
    expect(codeOf(await grantExemption(w.deps, s.admin.ctx, input(s, { ueNodeId: newId() })))).toBe("higher.exemption_unknown_ue");
    // inscription d'un AUTRE étudiant
    expect(codeOf(await grantExemption(w.deps, s.admin.ctx, input(s, { enrollmentId: s.students[1]!.enrollmentId })))).toBe("higher.exemption_enrollment_mismatch");
    expect(codeOf(await grantExemption(w.deps, s.admin.ctx, input(s, { enrollmentId: newId() })))).toBe("higher.exemption_enrollment_mismatch");
    // sans utilisateur identifié (contexte système) : refusé
    const noUser = { ...s.admin.ctx, userId: null } as never;
    expect(codeOf(await grantExemption(w.deps, noUser, input(s)))).toBe("higher.invalid_input");
    unwrap(await grantExemption(w.deps, s.admin.ctx, input(s)));
    expect(codeOf(await grantExemption(w.deps, s.admin.ctx, input(s)))).toBe("higher.exemption_exists");
    expect(await adminRows(db, "SELECT 1 FROM higher.ue_exemptions WHERE tenant_id = $1", [s.tenantId])).toHaveLength(1);
  });

  it("politique GRANT_CREDITS : écriture EXEMPTION au registre (crédits figés), événement de capitalisation, dette levée, prérequis satisfait", async () => {
    const { w, s } = await fresh();
    const st = s.students[0]!;
    // une dette ouverte sur l'UE, puis un prérequis qui dépend d'elle
    w.ports.credits.setFinalLines(s.classroomId, s.periodId, [ueLine(s, st, s.ues[0]!, { validated: false, ueState: "DEBT", sessionObtained: null })]);
    unwrap(await capitalizePeriod(w.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId }));
    expect(unwrap(await listDebts(w.deps, s.admin.ctx, st.studentId))).toHaveLength(1);
    unwrap(await setPrerequisites(w.deps, s.admin.ctx, { ueNodeId: s.ues[1]!.nodeId, prerequisites: [{ prerequisiteNodeId: s.ues[0]!.nodeId }] }));
    expect(unwrap(await checkPrerequisites(w.deps, s.admin.ctx, { studentId: st.studentId, ueNodeId: s.ues[1]!.nodeId })).satisfied).toBe(false);

    unwrap(await setExemptionCreditPolicy(w.deps, s.admin.ctx, { exemptionCreditPolicy: "GRANT_CREDITS" }));
    expect(w.audit.entries.find((x) => x.entry.action === "higher.exemption_policy.updated")?.entry).toMatchObject({ sensitive: true, after: { exemptionCreditPolicy: "GRANT_CREDITS" } });
    const e = unwrap(await grantExemption(w.deps, s.admin.ctx, input(s)));
    expect(e).toMatchObject({ creditPolicy: "GRANT_CREDITS", credits: 6 });
    expect(e.ledgerId).not.toBeNull();
    const rows = await ledgerRows(s);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ue_node_id: s.ues[0]!.nodeId, credits: "6.00", acquired_via: "EXEMPTION", session_obtained: 1, status: "ACQUIRED", source_result_id: e.id });
    expect(unwrap(await getCreditSummary(w.deps, s.admin.ctx, st.studentId))).toMatchObject({ totalCredits: 6, acquiredUeCount: 1, openDebtCount: 0 });
    expect(unwrap(await listAcquiredUe(w.deps, s.admin.ctx, st.studentId)).map((x) => x.acquiredVia)).toEqual(["EXEMPTION"]);
    expect(unwrap(await checkPrerequisites(w.deps, s.admin.ctx, { studentId: st.studentId, ueNodeId: s.ues[1]!.nodeId })).satisfied).toBe(true);
    const cap = await events(s.tenantId, "higher.credits.capitalized");
    expect(cap.at(-1)!.payload).toMatchObject({ v: 1, ueNodeId: s.ues[0]!.nodeId, via: "EXEMPTION", sessionObtained: 1, ledgerId: e.ledgerId });
    expect((await events(s.tenantId, "higher.ue.exempted"))[0]!.payload.ledgerId).toBe(e.ledgerId);

    // la politique APPLIQUÉE est figée sur la dispense : changer le paramètre ne la réécrit pas
    unwrap(await setExemptionCreditPolicy(w.deps, s.admin.ctx, { exemptionCreditPolicy: "RECORD_ONLY" }));
    expect(unwrap(await listExemptions(w.deps, s.admin.ctx, { studentId: st.studentId }))[0]).toMatchObject({ creditPolicy: "GRANT_CREDITS", ledgerId: e.ledgerId });
  });

  it("GRANT_CREDITS : refusé si l'UE est déjà acquise ; durée de validité du registre appliquée à l'écriture", async () => {
    const { w, s } = await fresh();
    const st = s.students[0]!;
    unwrap(await setExemptionCreditPolicy(w.deps, s.admin.ctx, { exemptionCreditPolicy: "GRANT_CREDITS" }));
    unwrap(await updateHigherSettings(w.deps, s.admin.ctx, { creditValidityMonths: 24 }));
    expect(unwrap(await getExemptionSettings(w.deps, s.admin.ctx)).exemptionCreditPolicy).toBe("GRANT_CREDITS"); // le réglage des crédits ne réécrit pas la politique de dispense
    w.ports.credits.setFinalLines(s.classroomId, s.periodId, [ueLine(s, st, s.ues[2]!)]);
    unwrap(await capitalizePeriod(w.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId }));
    expect(codeOf(await grantExemption(w.deps, s.admin.ctx, input(s, { ueNodeId: s.ues[2]!.nodeId })))).toBe("higher.exemption_ue_already_acquired");
    unwrap(await grantExemption(w.deps, s.admin.ctx, input(s)));
    const row = await adminOne<{ valid_until: string }>(db, "SELECT to_char(valid_until, 'YYYY-MM-DD') AS valid_until FROM higher.credit_ledger WHERE tenant_id = $1 AND acquired_via = 'EXEMPTION'", [s.tenantId]);
    expect(row.valid_until).toBe("2028-10-01"); // 2026-10-01 (horloge du monde de test) + 24 mois
  });

  it("une clôture ultérieure ne révoque JAMAIS l'écriture d'une dispense (un résultat non validé n'efface pas une décision de la direction)", async () => {
    const { w, s } = await fresh();
    const st = s.students[0]!;
    unwrap(await setExemptionCreditPolicy(w.deps, s.admin.ctx, { exemptionCreditPolicy: "GRANT_CREDITS" }));
    unwrap(await grantExemption(w.deps, s.admin.ctx, input(s)));
    // même UE, même semestre, version supérieure, NON validée
    w.ports.credits.setFinalLines(s.classroomId, s.periodId, [ueLine(s, st, s.ues[0]!, { validated: false, ueState: "DEBT", sessionObtained: null, resultsVersion: 3 })]);
    const report = unwrap(await capitalizePeriod(w.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId }));
    expect(report).toMatchObject({ revoked: 0, debtsOpened: 0 });
    expect((await ledgerRows(s))[0]).toMatchObject({ status: "ACQUIRED", acquired_via: "EXEMPTION" });
    // et un résultat validé ensuite ne double pas l'écriture
    w.ports.credits.setFinalLines(s.classroomId, s.periodId, [ueLine(s, st, s.ues[0]!, { resultsVersion: 4 })]);
    expect(unwrap(await capitalizePeriod(w.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId }))).toMatchObject({ acquired: 0, alreadyAcquired: 1 });
    expect(await ledgerRows(s)).toHaveLength(1);
  });

  it("révocation : motif obligatoire, écriture de crédits révoquée, événements, idempotence refusée ; contenu figé en base", async () => {
    const { w, s } = await fresh();
    const st = s.students[0]!;
    unwrap(await setExemptionCreditPolicy(w.deps, s.admin.ctx, { exemptionCreditPolicy: "GRANT_CREDITS" }));
    const e = unwrap(await grantExemption(w.deps, s.admin.ctx, input(s)));
    expect(codeOf(await revokeExemption(w.deps, s.admin.ctx, { id: e.id, reason: "court" }))).toBe("higher.exemption_reason_required");
    expect(codeOf(await revokeExemption(w.deps, s.admin.ctx, { id: newId(), reason: "Motif suffisamment long" }))).toBe("higher.exemption_not_found");
    const revoked = unwrap(await revokeExemption(w.deps, s.admin.ctx, { id: e.id, reason: "Dispense accordée par erreur" }));
    expect(revoked).toMatchObject({ status: "REVOKED", revokedBy: s.admin.userId, revokeReason: "Dispense accordée par erreur" });
    expect((await ledgerRows(s))[0]).toMatchObject({ status: "REVOKED" });
    expect(unwrap(await getCreditSummary(w.deps, s.admin.ctx, st.studentId)).totalCredits).toBe(0);
    expect((await events(s.tenantId, "higher.credits.revoked")).at(-1)!.payload).toMatchObject({ reason: "exemption_revoked", ueNodeId: s.ues[0]!.nodeId });
    expect((await events(s.tenantId, "higher.ue.exemption_revoked"))[0]!.payload).toEqual({ v: 1, exemptionId: e.id, studentId: st.studentId, ueNodeId: s.ues[0]!.nodeId });
    expect(w.audit.entries.find((x) => x.entry.action === "higher.exemption.revoked")?.entry).toMatchObject({ sensitive: true, reason: "Dispense accordée par erreur" });
    expect(codeOf(await revokeExemption(w.deps, s.admin.ctx, { id: e.id, reason: "Encore une fois svp" }))).toBe("higher.exemption_already_revoked");
    // après révocation, une nouvelle dispense est possible (la contrainte d'unicité ne vise que les dispenses ACTIVES)
    unwrap(await grantExemption(w.deps, s.admin.ctx, input(s)));
    // contenu figé : réécrire le motif, supprimer ou « dérévoquer » est refusé par la base
    await expect(db.admin.query("UPDATE higher.ue_exemptions SET reason = 'réécrit à la main' WHERE id = $1", [e.id])).rejects.toThrow(/higher\.immutable/);
    await expect(db.admin.query("DELETE FROM higher.ue_exemptions WHERE id = $1", [e.id])).rejects.toThrow(/higher\.immutable/);
    await expect(db.admin.query("UPDATE higher.ue_exemptions SET status = 'ACTIVE', revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL WHERE id = $1", [e.id])).rejects.toThrow(/higher\.immutable|ue_exemptions/);
  });

  it("un diplôme octroyé qui s'appuie sur les crédits d'une dispense bloque sa révocation", async () => {
    const { w, s } = await fresh();
    const st = s.students[0]!;
    unwrap(await setExemptionCreditPolicy(w.deps, s.admin.ctx, { exemptionCreditPolicy: "GRANT_CREDITS" }));
    const e = unwrap(await grantExemption(w.deps, s.admin.ctx, input(s)));
    const def = unwrap(await createDiploma(w.deps, s.admin.ctx, { code: "DISP", label: "Diplôme court", gradeCode: "LICENCE", curriculumNodeId: s.cycleNodeId, uvRequired: 6, requirements: [{ ueNodeId: s.ues[0]!.nodeId }] }));
    const award = unwrap(await awardDiploma(w.deps, s.admin.ctx, { definitionId: def.definition.id, studentId: st.studentId, via: "MANUAL", caps: CAPS.admin }));
    expect(award.status).toBe("AWARDED");
    expect(codeOf(await revokeExemption(w.deps, s.admin.ctx, { id: e.id, reason: "Tentative de révocation" }))).toBe("higher.credit_in_use");
    expect(unwrap(await listExemptions(w.deps, s.admin.ctx, { status: "ACTIVE" }))).toHaveLength(1);
  });

  it("UE annuelle (O-11) : la dispense se fait par l'UE principale, crédits = somme des parties ; une partie seule est refusée", async () => {
    const { w, s } = await fresh();
    unwrap(await declareAnnualUe(w.deps, s.admin.ctx, { ueNodeId: s.ues[0]!.nodeId, memberNodeIds: [s.ues[1]!.nodeId], reason: "UE annuelle de test" }));
    unwrap(await setExemptionCreditPolicy(w.deps, s.admin.ctx, { exemptionCreditPolicy: "GRANT_CREDITS" }));
    expect(codeOf(await grantExemption(w.deps, s.admin.ctx, input(s, { ueNodeId: s.ues[1]!.nodeId })))).toBe("higher.exemption_unknown_ue");
    const e = unwrap(await grantExemption(w.deps, s.admin.ctx, input(s)));
    expect(e.credits).toBe(12);
    expect((await ledgerRows(s))[0]).toMatchObject({ ue_node_id: s.ues[0]!.nodeId, credits: "12.00", acquired_via: "EXEMPTION" });
  });

  it("isolation A/B (RLS) : les dispenses et le paramètre d'un tenant sont invisibles et indépendants de l'autre", async () => {
    const a = await fresh(1);
    const b = await fresh(1);
    unwrap(await setExemptionCreditPolicy(a.w.deps, a.s.admin.ctx, { exemptionCreditPolicy: "GRANT_CREDITS" }));
    const e = unwrap(await grantExemption(a.w.deps, a.s.admin.ctx, input(a.s)));
    expect(unwrap(await getExemptionSettings(b.w.deps, b.s.admin.ctx))).toEqual({ exemptionCreditPolicy: "RECORD_ONLY" });
    expect(unwrap(await listExemptions(b.w.deps, b.s.admin.ctx))).toEqual([]);
    expect(codeOf(await revokeExemption(b.w.deps, b.s.admin.ctx, { id: e.id, reason: "Tentative inter-tenant" }))).toBe("higher.exemption_not_found");
    const seenByB = await b.w.deps.db.run(b.s.admin.ctx, (tx) => tx.many("SELECT id FROM higher.ue_exemptions"));
    expect(seenByB).toEqual([]);
    expect((await ledgerRows(b.s))).toEqual([]);
    expect(unwrap(await listExemptions(a.w.deps, a.s.admin.ctx))).toHaveLength(1);
  });
});
