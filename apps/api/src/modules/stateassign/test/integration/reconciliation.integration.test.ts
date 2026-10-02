/**
 * Rapprochement avec `finance` (port en mémoire) sur une base réelle : cohérence des parts État / parent (la facture de la famille
 * ne porte QUE la part parent), statut CALCULÉ par la base, tolérance d'établissement, créances sur l'État (échéances, versements
 * affectés dans l'ordre, retards signalés une fois), historique, échec fermé, jobs.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Money } from "@ecoledigitale/kernel";
import { actOnAssignment, getAssignmentDetail, recordAssignment } from "../../application/assignments";
import { cancelReceivable, flagOverdueReceivables, getReceivableHistory, getReceivablesAging, listReceivablePage, scheduleReceivable, updateReceivable } from "../../application/receivables";
import { reconcileAssignment, reconcileEnrollment, reconcileStudent, reconcileTenant } from "../../application/reconciliation";
import { getSummary, getReconciliationReport } from "../../application/reports";
import { billingOf } from "../../infrastructure/in-memory-ports";
import { PEOPLE, createEnv, errorCodeOf, outboxPayloads, outboxTypes, unwrapOk, uuid, type Env } from "../support/harness";
import { describeIntegration } from "../support/db";

let env: Env;
beforeAll(async () => {
  env = await createEnv({ startAt: "2026-10-15T09:00:00.000Z" });
});
afterAll(async () => {
  await env?.close();
});

/** Dossier ACTIF : 400 000 XOF à la charge de l'État, 100 000 à la charge de la famille. */
async function activeDossier(t: string, over: { state?: number; parent?: number; institutionId?: string; yearId?: string; reference?: string } = {}) {
  const e = env.enroll({ ...(over.institutionId ? { institutionId: over.institutionId } : {}), ...(over.yearId ? { yearId: over.yearId } : {}), studentName: "DIABATE Fanta" });
  const a = unwrapOk(await recordAssignment(env.deps, env.user(t, PEOPLE.secretary), { enrollmentId: e.enrollmentId, reference: over.reference ?? `AFF-${uuid().slice(0, 6)}`, declaredStateAmount: over.state ?? 400000, declaredParentAmount: over.parent ?? 100000, issuingAuthority: "Autorité" }));
  unwrapOk(await actOnAssignment(env.deps, env.user(t, PEOPLE.bursar), a.id, "verify", {}));
  const active = unwrapOk(await actOnAssignment(env.deps, env.user(t, PEOPLE.bursar), a.id, "activate", {}));
  return { ...e, id: active.id };
}

const human = (t: string) => env.user(t, PEOPLE.bursar);
const reconcileEvents = async (id: string) => (await env.db.admin.query("SELECT count(*)::int AS n FROM stateassign.assignment_events WHERE assignment_id = $1 AND action = 'RECONCILED'", [id])).rows[0].n as number;

describeIntegration("stateassign : rapprochement des parts État / parent avec finance", () => {
  it("BALANCED quand la facturation égale l'acte : écarts nuls, liens finance posés, aucune alerte", async () => {
    const t = await env.tenant();
    const d = await activeDossier(t);
    env.world.setBilling(d.enrollmentId, billingOf({ stateTotal: 400000, parentTotal: 100000 }));
    const r = unwrapOk(await reconcileAssignment(env.deps, human(t), d.id));
    expect(r.assignment.reconciliation).toMatchObject({ status: "BALANCED", stateDelta: { amount: 0 }, parentDelta: { amount: 0 }, stateBilled: { amount: 400000 }, parentBilled: { amount: 100000 } });
    expect(r.assignment.finance.stateInvoiceId).toBe("00000000-0000-4000-8000-0000000000b1");
    expect(r.assignment.finance.parentInvoiceId).toBe("00000000-0000-4000-8000-0000000000b2");
    expect(r.assignment.finance.scholarshipId).toBe("00000000-0000-4000-8000-0000000000a1");
    expect(r.linkedScholarship).toBe(true);
    expect(r.warnings).toEqual([]);
    expect(await outboxTypes(env.db, d.id)).not.toContain("stateassign.reconciliation.discrepancy");
    expect(env.audit.entries.at(-1)).toMatchObject({ action: "stateassign.assignment.reconciled" });
  });

  it("la facture de la famille ne porte que la part parent : si elle porte aussi la part de l'État, l'écart apparaît et alerte l'économe", async () => {
    const t = await env.tenant();
    const d = await activeDossier(t);
    env.world.setBilling(d.enrollmentId, billingOf({ stateTotal: 400000, parentTotal: 500000 }));
    const r = unwrapOk(await reconcileAssignment(env.deps, human(t), d.id));
    expect(r.assignment.reconciliation).toMatchObject({ status: "DISCREPANCY", stateDelta: { amount: 0 }, parentDelta: { amount: 400000 }, parentBilled: { amount: 500000 } });
    expect(await outboxTypes(env.db, d.id)).toContain("stateassign.reconciliation.discrepancy");
    const payload = (await outboxPayloads(env.db, "stateassign.reconciliation.discrepancy")).find((p) => p.assignmentId === d.id)!;
    expect(payload).toMatchObject({ v: 1, status: "DISCREPANCY", stateDelta: { amount: 0, currency: "XOF" }, parentDelta: { amount: 400000, currency: "XOF" }, enrollmentId: d.enrollmentId });
  });

  it("sans facture de l'État : écart = montant déclaré (négatif), DISCREPANCY, avertissement ; la correction de la facturation rétablit BALANCED", async () => {
    const t = await env.tenant();
    const d = await activeDossier(t);
    env.world.setBilling(d.enrollmentId, billingOf({ stateTotal: 0, parentTotal: 100000 }));
    const bad = unwrapOk(await reconcileAssignment(env.deps, human(t), d.id));
    expect(bad.assignment.reconciliation).toMatchObject({ status: "DISCREPANCY", stateDelta: { amount: -400000 }, stateBilled: { amount: 0 } });
    expect(bad.warnings.join(" ")).toMatch(/Aucune facture de l'État/);
    env.world.setBilling(d.enrollmentId, billingOf({ stateTotal: 400000, parentTotal: 100000 }));
    const good = unwrapOk(await reconcileAssignment(env.deps, human(t), d.id));
    expect(good.assignment.reconciliation.status).toBe("BALANCED");
    expect(good.warnings).toEqual([]);
  });

  it("tolérance d'établissement : un écart ≤ tolérance est BALANCED, au-delà DISCREPANCY ; le statut est celui de la base", async () => {
    const t = await env.tenant();
    const inst = uuid();
    await env.db.tenantDb.run(env.user(t, PEOPLE.director), (tx) => tx.query("INSERT INTO stateassign.settings (tenant_id, institution_id, reconciliation_tolerance) VALUES ($1,$2,500)", [t, inst]));
    const d = await activeDossier(t, { institutionId: inst });
    env.world.setBilling(d.enrollmentId, billingOf({ stateTotal: 400000, parentTotal: 99500 }));
    expect(unwrapOk(await reconcileAssignment(env.deps, human(t), d.id)).assignment.reconciliation).toMatchObject({ status: "BALANCED", parentDelta: { amount: -500 } });
    env.world.setBilling(d.enrollmentId, billingOf({ stateTotal: 400000, parentTotal: 99499 }));
    expect(unwrapOk(await reconcileAssignment(env.deps, human(t), d.id)).assignment.reconciliation.status).toBe("DISCREPANCY");
  });

  it("le facturé est net d'avoirs ; plusieurs factures de l'État sont additionnées sans poser de lien de facture", async () => {
    const t = await env.tenant();
    const d = await activeDossier(t);
    const base = billingOf({ stateTotal: 400000, parentTotal: 100000 });
    const credited = { ...base, stateInvoices: [{ ...base.stateInvoices[0]!, credited: Money.of(10000, "XOF") }] };
    env.world.setBilling(d.enrollmentId, credited);
    expect(unwrapOk(await reconcileAssignment(env.deps, human(t), d.id)).assignment.reconciliation).toMatchObject({ status: "DISCREPANCY", stateDelta: { amount: -10000 } });
    const split = { ...base, stateInvoices: [{ ...base.stateInvoices[0]!, total: Money.of(250000, "XOF") }, { ...base.stateInvoices[0]!, invoiceId: uuid(), total: Money.of(150000, "XOF") }] };
    env.world.setBilling(d.enrollmentId, split);
    const r = unwrapOk(await reconcileAssignment(env.deps, human(t), d.id));
    expect(r.assignment.reconciliation).toMatchObject({ status: "BALANCED", stateDelta: { amount: 0 } });
    expect(r.assignment.finance.stateInvoiceId).toBeNull();
    expect(r.warnings.join(" ")).toMatch(/Plusieurs factures de l'État/);
  });

  it("idempotent : un second rapprochement le même jour, sans changement, n'écrit rien (l'historique n'enfle pas) ; une action explicite force l'écriture", async () => {
    const t = await env.tenant();
    const d = await activeDossier(t);
    env.world.setBilling(d.enrollmentId, billingOf({ stateTotal: 400000, parentTotal: 100000 }));
    unwrapOk(await reconcileEnrollment(env.deps, env.system(t), d.enrollmentId));
    expect(await reconcileEvents(d.id)).toBe(1);
    const auditBefore = env.audit.entries.length;
    unwrapOk(await reconcileEnrollment(env.deps, env.system(t), d.enrollmentId));
    expect(await reconcileEvents(d.id)).toBe(1);
    expect(env.audit.entries.length).toBe(auditBefore);
    env.clock.advance(1000);
    unwrapOk(await reconcileAssignment(env.deps, human(t), d.id, { force: true }));
    expect(await reconcileEvents(d.id)).toBe(2);
    // le lendemain, le rapprochement est réécrit (date de dernier rapprochement à jour)
    env.clock.advance(24 * 3_600_000);
    unwrapOk(await reconcileEnrollment(env.deps, env.system(t), d.enrollmentId));
    expect(await reconcileEvents(d.id)).toBe(3);
    env.clock.advance(-24 * 3_600_000);
  });

  it("un dossier RECEIVED ou REJECTED ne se rapproche pas ; un dossier inconnu répond 404", async () => {
    const t = await env.tenant();
    const e = env.enroll();
    const a = unwrapOk(await recordAssignment(env.deps, env.user(t, PEOPLE.secretary), { enrollmentId: e.enrollmentId, reference: "R-RECV", declaredStateAmount: 10 }));
    expect(errorCodeOf(await reconcileAssignment(env.deps, human(t), a.id))).toBe("stateassign.transition_invalid");
    expect(errorCodeOf(await reconcileAssignment(env.deps, human(t), uuid()))).toBe("stateassign.assignment_not_found");
  });

  it("échec FERMÉ : sans finance, le rapprochement est refusé (port_unavailable) et rien n'est écrit", async () => {
    const t = await env.tenant();
    const d = await activeDossier(t);
    env.world.billingFails = true;
    expect(errorCodeOf(await reconcileAssignment(env.deps, human(t), d.id))).toBe("stateassign.port_unavailable");
    env.world.billingFails = false;
    const row = await env.db.admin.query("SELECT reconciliation_status, last_reconciled_at FROM stateassign.assignments WHERE id = $1", [d.id]);
    expect(row.rows[0]).toMatchObject({ reconciliation_status: "NEVER", last_reconciled_at: null });
  });

  it("états : tableau de bord et état de rapprochement (compteurs, écarts) calculés côté serveur", async () => {
    const t = await env.tenant();
    const inst = uuid();
    const year = uuid();
    const ok = await activeDossier(t, { institutionId: inst, yearId: year });
    const ko = await activeDossier(t, { institutionId: inst, yearId: year });
    await activeDossier(t, { institutionId: inst, yearId: year });
    env.world.setBilling(ok.enrollmentId, billingOf({ stateTotal: 400000, parentTotal: 100000 }));
    env.world.setBilling(ko.enrollmentId, billingOf({ stateTotal: 300000, parentTotal: 100000 }));
    unwrapOk(await reconcileAssignment(env.deps, human(t), ok.id));
    unwrapOk(await reconcileAssignment(env.deps, human(t), ko.id));
    const report = unwrapOk(await getReconciliationReport(env.deps, human(t), { institutionId: inst, academicYearId: year, page: 1, pageSize: 50 }));
    expect(report.counts).toEqual({ never: 1, balanced: 1, discrepancy: 1 });
    expect(report.items.map((i) => i.id)).toEqual([ko.id]);
    expect(report.items[0]!.reconciliation.stateDelta).toEqual({ amount: -100000, currency: "XOF" });
    expect(report.items[0]!.studentName).toBe("DIABATE Fanta");
    const sum = unwrapOk(await getSummary(env.deps, human(t), { institutionId: inst, academicYearId: year }));
    expect(sum.assignmentsByStatus).toEqual({ ACTIVE: 3 });
    expect(sum.declaredState).toEqual({ amount: 1_200_000, currency: "XOF" });
    expect(sum.declaredParent).toEqual({ amount: 300_000, currency: "XOF" });
    expect(sum.reconciliation).toEqual({ never: 1, balanced: 1, discrepancy: 1 });
  });
});

describeIntegration("stateassign : créances sur l'État (échéances, versements, retards)", () => {
  async function dossierWithSchedule(t: string, schedule: Array<[string, string, number]> = [["1er versement", "2026-11-15", 150000], ["2e versement", "2027-02-15", 250000]]) {
    const d = await activeDossier(t);
    const rows = [];
    for (const [label, dueOn, expectedAmount] of schedule) rows.push(unwrapOk(await scheduleReceivable(env.deps, human(t), d.id, { label, dueOn, expectedAmount })));
    return { ...d, receivables: rows };
  }

  it("planifier : numéro d'ordre posé par la base, statut OPEN, événement et audit ; le total ne dépasse pas le montant déclaré", async () => {
    const t = await env.tenant();
    const d = await dossierWithSchedule(t);
    expect(d.receivables.map((r) => [r.seq, r.status, r.expected.amount, r.received.amount])).toEqual([[1, "OPEN", 150000, 0], [2, "OPEN", 250000, 0]]);
    expect(await outboxTypes(env.db, d.receivables[0]!.id)).toEqual(["stateassign.receivable.scheduled"]);
    expect(errorCodeOf(await scheduleReceivable(env.deps, human(t), d.id, { label: "3e", dueOn: "2027-05-15", expectedAmount: 1 }))).toBe("stateassign.receivable_exceeds_declared");
    expect(errorCodeOf(await scheduleReceivable(env.deps, env.system(t), d.id, { label: "x", dueOn: "2027-05-15", expectedAmount: 1 }))).toBe("stateassign.human_actor_required");
    const e = env.enroll();
    const received = unwrapOk(await recordAssignment(env.deps, env.user(t, PEOPLE.secretary), { enrollmentId: e.enrollmentId, reference: "R-NV", declaredStateAmount: 1000 }));
    expect(errorCodeOf(await scheduleReceivable(env.deps, human(t), received.id, { label: "x", dueOn: "2027-05-15", expectedAmount: 1 }))).toBe("stateassign.receivable_state");
  });

  it("les versements de l'État reçus chez finance sont affectés aux échéances DANS L'ORDRE ; le statut est calculé par la base ; le surplus est non affecté", async () => {
    const t = await env.tenant();
    const d = await dossierWithSchedule(t);
    env.world.setBilling(d.enrollmentId, billingOf({ stateTotal: 400000, statePaid: 200000, parentTotal: 100000, payments: [{ paymentId: uuid(), receivedAt: new Date("2026-11-20T10:00:00Z"), amount: 200000, reference: "VIR-001" }] }));
    const r = unwrapOk(await reconcileAssignment(env.deps, human(t), d.id));
    expect(r.receivables.map((x) => [x.seq, x.status, x.received.amount, x.outstanding.amount])).toEqual([[1, "RECEIVED", 150000, 0], [2, "PARTIALLY_RECEIVED", 50000, 200000]]);
    expect(r.unallocated.amount).toBe(0);
    expect(r.billing.statePayments).toHaveLength(1);
    expect(r.billing.statePayments[0]).toMatchObject({ amount: { amount: 200000 }, reference: "VIR-001" });
    expect(await outboxTypes(env.db, d.receivables[0]!.id)).toEqual(["stateassign.receivable.scheduled", "stateassign.receivable.received"]);
    expect(await outboxTypes(env.db, d.receivables[1]!.id)).toEqual(["stateassign.receivable.scheduled"]);
    // le solde de l'État arrive : tout est reçu, rien n'est publié deux fois
    env.world.setBilling(d.enrollmentId, billingOf({ stateTotal: 400000, statePaid: 400000, parentTotal: 100000 }));
    const done = unwrapOk(await reconcileAssignment(env.deps, human(t), d.id));
    expect(done.receivables.map((x) => x.status)).toEqual(["RECEIVED", "RECEIVED"]);
    expect(await outboxTypes(env.db, d.receivables[0]!.id)).toEqual(["stateassign.receivable.scheduled", "stateassign.receivable.received"]);
    expect(await outboxTypes(env.db, d.receivables[1]!.id)).toEqual(["stateassign.receivable.scheduled", "stateassign.receivable.received"]);
    const history = unwrapOk(await getReceivableHistory(env.deps, human(t), d.receivables[1]!.id));
    expect(history.items.map((h) => h.action)).toEqual(["CREATED", "RECEIVED_UPDATED", "STATUS_CHANGED", "RECEIVED_UPDATED", "STATUS_CHANGED"]);
    expect(history.items.find((h) => h.action === "RECEIVED_UPDATED")).toMatchObject({ actorKind: "user", fromAmount: { amount: 0 }, toAmount: { amount: 50000 } });
  });

  it("un versement supérieur au calendrier planifié n'est jamais perdu : il est « non affecté » et visible", async () => {
    const t = await env.tenant();
    const d = await dossierWithSchedule(t, [["Seul versement", "2026-11-15", 100000]]);
    env.world.setBilling(d.enrollmentId, billingOf({ stateTotal: 400000, statePaid: 400000, parentTotal: 100000 }));
    const r = unwrapOk(await reconcileAssignment(env.deps, human(t), d.id));
    expect(r.receivables[0]).toMatchObject({ status: "RECEIVED", received: { amount: 100000 } });
    expect(r.unallocated.amount).toBe(300000);
    const detail = unwrapOk(await getAssignmentDetail(env.deps, human(t), d.id));
    expect(detail.receivablesSummary).toMatchObject({ expected: { amount: 100000 }, received: { amount: 100000 }, outstanding: { amount: 0 }, unscheduled: { amount: 300000 } });
  });

  it("retard : dérivé à la date de lecture (échéance + jours de grâce) ; l'alerte n'est publiée qu'UNE fois ; un report la réinitialise", async () => {
    const t = await env.tenant();
    const inst = uuid();
    await env.db.tenantDb.run(env.user(t, PEOPLE.director), (tx) => tx.query("INSERT INTO stateassign.settings (tenant_id, institution_id, receivable_grace_days) VALUES ($1,$2,10)", [t, inst]));
    const e = env.enroll({ institutionId: inst });
    const a = unwrapOk(await recordAssignment(env.deps, env.user(t, PEOPLE.secretary), { enrollmentId: e.enrollmentId, reference: "R-LATE", declaredStateAmount: 300000 }));
    unwrapOk(await actOnAssignment(env.deps, human(t), a.id, "verify", {}));
    const r1 = unwrapOk(await scheduleReceivable(env.deps, human(t), a.id, { label: "1er", dueOn: "2026-10-01", expectedAmount: 100000 }));
    const r2 = unwrapOk(await scheduleReceivable(env.deps, human(t), a.id, { label: "2e", dueOn: "2026-12-01", expectedAmount: 100000 }));
    // 15 octobre : échéance du 1er octobre + 10 jours de grâce = 11 octobre -> en retard de 4 jours
    const list = unwrapOk(await listReceivablePage(env.deps, human(t), { institutionId: inst, page: 1, pageSize: 50 }));
    expect(list.asOf).toBe("2026-10-15");
    expect(list.items.map((x) => [x.seq, x.overdue, x.daysOverdue, x.agingBucket])).toEqual([[1, true, 4, "D1_30"], [2, false, 0, "NOT_DUE"]]);
    expect(unwrapOk(await listReceivablePage(env.deps, human(t), { institutionId: inst, overdueOnly: "true", page: 1, pageSize: 50 })).items.map((x) => x.id)).toEqual([r1.id]);
    expect((await flagOverdueReceivables(env.deps, env.system(t))).flagged).toBe(1);
    expect((await flagOverdueReceivables(env.deps, env.system(t))).flagged).toBe(0);
    const overdue = (await outboxPayloads(env.db, "stateassign.receivable.overdue")).filter((p) => p.receivableId === r1.id);
    expect(overdue).toHaveLength(1);
    expect(overdue[0]).toMatchObject({ v: 1, daysOverdue: 4, expected: { amount: 100000 }, received: { amount: 0 }, status: "OPEN", dueOn: "2026-10-01" });
    // report par un humain : le marqueur est réinitialisé, l'échéance sera signalée de nouveau si elle redevient en retard
    const moved = unwrapOk(await updateReceivable(env.deps, human(t), r1.id, { dueOn: "2026-10-02", rowVersion: r1.id ? (await env.db.admin.query("SELECT row_version FROM stateassign.receivables WHERE id = $1", [r1.id])).rows[0].row_version : 1 }));
    expect(moved.overdueFlaggedAt).toBeNull();
    expect((await flagOverdueReceivables(env.deps, env.system(t))).flagged).toBe(1);
    expect(r2.id).toBeTruthy();
  });

  it("annuler une échéance : humain, motivé ; refusé quand un versement est rapproché ; l'historique est conservé", async () => {
    const t = await env.tenant();
    const d = await dossierWithSchedule(t);
    const [first, second] = d.receivables;
    env.world.setBilling(d.enrollmentId, billingOf({ stateTotal: 400000, statePaid: 100000, parentTotal: 100000 }));
    unwrapOk(await reconcileAssignment(env.deps, human(t), d.id));
    const rv = async (id: string) => (await env.db.admin.query("SELECT row_version FROM stateassign.receivables WHERE id = $1", [id])).rows[0].row_version as number;
    expect(errorCodeOf(await cancelReceivable(env.deps, human(t), first!.id, { reason: "Erreur de saisie", rowVersion: await rv(first!.id) }))).toBe("stateassign.receivable_cancel_received");
    expect(errorCodeOf(await cancelReceivable(env.deps, human(t), second!.id, { reason: "ko", rowVersion: 1 }))).toBe("stateassign.invalid_input");
    expect(errorCodeOf(await cancelReceivable(env.deps, human(t), second!.id, { reason: "Erreur de saisie", rowVersion: 99 }))).toBe("stateassign.version_conflict");
    expect(errorCodeOf(await cancelReceivable(env.deps, env.system(t), second!.id, { reason: "Erreur de saisie", rowVersion: await rv(second!.id) }))).toBe("stateassign.human_actor_required");
    const cancelled = unwrapOk(await cancelReceivable(env.deps, human(t), second!.id, { reason: "Erreur de saisie", rowVersion: await rv(second!.id) }));
    expect(cancelled).toMatchObject({ status: "CANCELLED", cancelReason: "Erreur de saisie", outstanding: { amount: 0 }, overdue: false });
    expect(await outboxTypes(env.db, second!.id)).toEqual(["stateassign.receivable.scheduled", "stateassign.receivable.cancelled"]);
    expect(errorCodeOf(await cancelReceivable(env.deps, human(t), second!.id, { reason: "Encore une fois", rowVersion: await rv(second!.id) }))).toBe("stateassign.receivable_state");
    // l'échéance annulée libère le montant déclaré
    unwrapOk(await scheduleReceivable(env.deps, human(t), d.id, { label: "Remplaçant", dueOn: "2027-04-15", expectedAmount: 250000 }));
  });

  it("ancienneté et totaux des créances : tranches, reçu, reste à recevoir, en retard — entiers, calculés en base", async () => {
    const t = await env.tenant();
    const inst = uuid();
    const year = uuid();
    const d1 = await activeDossier(t, { institutionId: inst, yearId: year });
    unwrapOk(await scheduleReceivable(env.deps, human(t), d1.id, { label: "A", dueOn: "2026-10-10", expectedAmount: 100000 })); // 5 jours de retard
    unwrapOk(await scheduleReceivable(env.deps, human(t), d1.id, { label: "B", dueOn: "2026-07-01", expectedAmount: 100000 })); // 106 jours
    unwrapOk(await scheduleReceivable(env.deps, human(t), d1.id, { label: "C", dueOn: "2027-01-01", expectedAmount: 100000 })); // à venir
    env.world.setBilling(d1.enrollmentId, billingOf({ stateTotal: 400000, statePaid: 50000, parentTotal: 100000 }));
    unwrapOk(await reconcileAssignment(env.deps, human(t), d1.id));
    const aging = unwrapOk(await getReceivablesAging(env.deps, human(t), { institutionId: inst, academicYearId: year }));
    const by = Object.fromEntries(aging.buckets.map((b) => [b.bucket, [b.count, b.outstanding.amount]]));
    // l'échéance du 1er juillet (la plus ancienne) reçoit les 50 000 d'abord
    expect(by).toEqual({ NOT_DUE: [1, 100000], D1_30: [1, 100000], D31_60: [0, 0], D61_90: [0, 0], D91_PLUS: [1, 50000] });
    expect(aging.totals).toMatchObject({ expected: { amount: 300000 }, received: { amount: 50000 }, outstanding: { amount: 250000 }, overdue: { amount: 150000 }, receivables: 3, overdueReceivables: 2 });
    const sum = unwrapOk(await getSummary(env.deps, human(t), { institutionId: inst, academicYearId: year }));
    expect(sum.receivables).toMatchObject({ expected: { amount: 300000 }, overdue: { amount: 150000 } });
  });
});

describeIntegration("stateassign : jobs et abonnés de rapprochement", () => {
  it("reconcileTenant rapproche tous les dossiers à suivre (y compris un dossier terminé avec une créance ouverte), un dossier en échec n'arrête pas les autres", async () => {
    const t = await env.tenant();
    const a = await activeDossier(t);
    const b = await activeDossier(t);
    const ended = await activeDossier(t);
    unwrapOk(await scheduleReceivable(env.deps, human(t), ended.id, { label: "Reste dû", dueOn: "2026-11-01", expectedAmount: 100000 }));
    unwrapOk(await actOnAssignment(env.deps, human(t), ended.id, "end", { endedOn: "2026-10-10", reason: "Départ de l'établissement" }));
    const none = await activeDossier(t); // pas de facturation connue : sans facture, DISCREPANCY (écart = déclaré)
    env.world.setBilling(a.enrollmentId, billingOf({ stateTotal: 400000, parentTotal: 100000 }));
    env.world.setBilling(b.enrollmentId, billingOf({ stateTotal: 400000, parentTotal: 100000 }));
    env.world.setBilling(ended.enrollmentId, billingOf({ stateTotal: 400000, statePaid: 100000, parentTotal: 100000 }));
    const report = await reconcileTenant(env.deps, env.system(t));
    expect(report).toEqual({ examined: 4, reconciled: 4, failed: 0 });
    const status = async (id: string) => (await env.db.admin.query("SELECT reconciliation_status s FROM stateassign.assignments WHERE id = $1", [id])).rows[0].s as string;
    expect([await status(a.id), await status(b.id), await status(none.id), await status(ended.id)]).toEqual(["BALANCED", "BALANCED", "DISCREPANCY", "BALANCED"]);
    const rec = await env.db.admin.query("SELECT received_amount::text r, status FROM stateassign.receivables WHERE enrollment_id = $1", [ended.enrollmentId]);
    expect(rec.rows[0]).toEqual({ r: "100000", status: "RECEIVED" });
    // finance indisponible : chaque dossier échoue FERMÉ, le job le compte sans lever
    env.world.billingFails = true;
    const down = await reconcileTenant(env.deps, env.system(t));
    env.world.billingFails = false;
    expect(down).toEqual({ examined: 3, reconciled: 0, failed: 3 }); // le dossier terminé, soldé, n'est plus à suivre
  });

  it("reconcileStudent (abonné aux paiements de l'État) rapproche les dossiers de l'élève ; rien à faire sans dossier", async () => {
    const t = await env.tenant();
    const d = await activeDossier(t);
    env.world.setBilling(d.enrollmentId, billingOf({ stateTotal: 400000, parentTotal: 100000 }));
    expect(unwrapOk(await reconcileStudent(env.deps, env.system(t), d.studentId))).toEqual({ reconciled: 1 });
    expect(unwrapOk(await reconcileStudent(env.deps, env.system(t), uuid()))).toEqual({ reconciled: 0 });
    expect(unwrapOk(await reconcileEnrollment(env.deps, env.system(t), uuid()))).toEqual({ reconciled: false });
  });
});
