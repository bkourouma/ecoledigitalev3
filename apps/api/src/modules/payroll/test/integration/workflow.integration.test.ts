/**
 * Cycle de vie d'un bulletin (spec 032 US6-US7, T14/T15/T20) : arrêter n'est pas verser, transitions imposées,
 * actions de masse partielles et idempotentes, annulation sans résurrection, séparation des tâches, seuil
 * propriétaire, journal à auteur figé, événements, audit, snapshot immuable.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "@ecoledigitale/kernel";
import { calculatePeriod } from "../../application/calculate";
import { adjustPayslip, approvePayslips, cancelPayslip, disputePayslip, notifyPayslip, payPayslips } from "../../application/workflow";
import { getPayslipData } from "../../application/queries";
import { getPayrollSettings, updatePayrollSettings } from "../../application/settings";
import { snapshotHash } from "../../application/snapshots";
import { PayrollCodes } from "../../domain/errors";
import { adminRows, createPayrollTestDb, describeIntegration, type PayrollTestDb } from "../support/db";
import { addConfig, addPeriod, addStaff, createWorld, expectErr, payslipRows, releasePending, session, unwrap, type World } from "../support/world";

const NO_OWNER = { ownerApproval: false } as const;

describeIntegration("cycle de vie des bulletins (Postgres réel)", () => {
  let db: PayrollTestDb;
  let w: World;

  beforeAll(async () => {
    db = await createPayrollTestDb(24);
  });
  afterAll(async () => {
    await db.drop();
  });

  /** Un tenant, un enseignant, une période, UN bulletin calculé de 20 000 F (2 h à 10 000). */
  async function oneCalculated(opts: { name?: string; userId?: string; minutes?: number } = {}) {
    w = await createWorld({ db });
    const staff = addStaff(w, opts.name ?? "Awa Sanogo", opts.userId ? { userId: opts.userId } : {});
    await addConfig(w, { staffId: staff });
    const period = await addPeriod(w);
    w.mem.sessions.add(session(staff, "2026-01-06", opts.minutes ?? 120));
    unwrap(await calculatePeriod(w.deps, w.ctxOf(), { periodId: period.id }));
    const [p] = await payslipRows(w);
    return { staff, period, payslipId: p?.id as string };
  }
  const approve = (ids: string[], caps = NO_OWNER, user?: string) => approvePayslips(w.deps, w.ctxOf(user), { selection: { payslipIds: ids }, caps });
  const pay = (ids: string[], user?: string) => payPayslips(w.deps, w.ctxOf(user), { selection: { payslipIds: ids }, method: "MOBILE_MONEY", reference: "OM-2026-0001" });

  it("T14 — arrêter : CALCULATED → APPROVED, approved_at/by posés, paid_at NON renseigné, snapshot figé, idempotent (ne redate pas)", async () => {
    const { payslipId, staff } = await oneCalculated({ userId: newId() });
    const director = newId();
    w.mem.staff.nameUser(director, "Directeur Koffi");
    const r = unwrap(await approve([payslipId], NO_OWNER, director));
    expect(r).toEqual({ done: [payslipId], unchanged: [], rejected: [] });
    const [p] = await payslipRows(w);
    expect(p).toMatchObject({ status: "APPROVED", approved_by: director, approved_by_name: "Directeur Koffi", paid_at: null, paid_by: null });
    expect(p?.approved_at).toBeInstanceOf(Date);
    expect(p?.snapshot_hash).toMatch(/^[0-9a-f]{64}$/);
    // le snapshot est la forme canonique de ce qui a été arrêté ; son empreinte se revérifie
    expect(snapshotHash(p?.snapshot)).toBe(p?.snapshot_hash);
    expect(p?.snapshot).toMatchObject({ v: 1, payslipId, staff: { id: staff, displayName: "Awa Sanogo" }, amounts: { total: 20_000, salary: 0, regularHours: 20_000, overtime: 0 }, approvedByName: "Directeur Koffi" });
    // idempotent : un second arrêt ne redate rien
    const approvedAt = p?.approved_at;
    w.clock.advance(3_600_000);
    expect(unwrap(await approve([payslipId], NO_OWNER, director))).toEqual({ done: [], unchanged: [payslipId], rejected: [] });
    expect((await payslipRows(w))[0]?.approved_at).toEqual(approvedAt);
    // journal à auteur FIGÉ + audit + événement avec le destinataire
    const ev = await adminRows<{ action: string; actor_name: string }>(db, "SELECT action, actor_name FROM payroll.payslip_events WHERE payslip_id=$1 ORDER BY occurred_at, id", [payslipId]);
    expect(ev.map((e) => [e.action, e.actor_name])).toEqual([["CALCULATED", "Comptable Test"], ["APPROVED", "Directeur Koffi"]]);
    expect(w.audit.actions()).toContain("payroll.payslip.approved");
    const out = await adminRows<{ payload: any }>(db, "SELECT payload FROM kernel.domain_events WHERE tenant_id=$1 AND type='payroll.payslip.approved'", [w.tenantId]);
    expect(out).toHaveLength(1);
    expect(out[0]?.payload).toMatchObject({ v: 1, payslipId, staffId: staff, amount: 20_000, currency: "XOF" });
    expect(out[0]?.payload.recipientUserId).toBeTypeOf("string");
    // les heures sont gelées côté source (AC1.4)
    expect(w.mem.sessions.lockCalls).toEqual([payslipId]);
  });

  it("l'acteur du journal est le compte authentifié ; son nom est FIGÉ à l'instant de chaque acte", async () => {
    const { payslipId } = await oneCalculated();
    const user = newId();
    w.mem.staff.nameUser(user, "Nom d'origine");
    unwrap(await approve([payslipId], NO_OWNER, user));
    w.mem.staff.nameUser(user, "Nom modifié depuis");
    unwrap(await pay([payslipId], user));
    const ev = await adminRows<{ action: string; actor_id: string; actor_name: string }>(db, "SELECT action, actor_id, actor_name FROM payroll.payslip_events WHERE payslip_id=$1 AND action IN ('APPROVED','PAID') ORDER BY occurred_at, id", [payslipId]);
    expect(ev.map((e) => [e.action, e.actor_id, e.actor_name])).toEqual([["APPROVED", user, "Nom d'origine"], ["PAID", user, "Nom modifié depuis"]]);
    // chaque acte fige le nom au MOMENT de l'acte : l'arrêt garde « Nom d'origine » malgré le changement de nom
    const [p] = await payslipRows(w);
    expect(p).toMatchObject({ approved_by: user, approved_by_name: "Nom d'origine", paid_by: user, paid_by_name: "Nom modifié depuis" });
  });

  it("T15 — verser : seulement APPROVED ; un bulletin CALCULÉ est refusé ; idempotent ; pose paid_at/by, mode et référence", async () => {
    const { payslipId, staff } = await oneCalculated({ userId: newId() });
    const refused = unwrap(await pay([payslipId]));
    expect(refused.done).toEqual([]);
    expect(refused.rejected).toEqual([{ payslipId, code: PayrollCodes.invalidTransition, message: expect.stringMatching(/CALCULATED/) }]);
    expect((await payslipRows(w))[0]?.status).toBe("CALCULATED");
    unwrap(await approve([payslipId]));
    expect(unwrap(await pay([payslipId]))).toEqual({ done: [payslipId], unchanged: [], rejected: [] });
    const [p] = await payslipRows(w);
    expect(p).toMatchObject({ status: "PAID", payment_method: "MOBILE_MONEY", payment_reference: "OM-2026-0001" });
    expect(p?.paid_at).toBeInstanceOf(Date);
    expect(p?.approved_at.getTime()).toBeLessThanOrEqual(p?.paid_at.getTime());
    const paidAt = p?.paid_at;
    w.clock.advance(60_000);
    expect(unwrap(await pay([payslipId]))).toEqual({ done: [], unchanged: [payslipId], rejected: [] });
    expect((await payslipRows(w))[0]?.paid_at).toEqual(paidAt);
    const ev = await adminRows<{ payload: any }>(db, "SELECT payload FROM kernel.domain_events WHERE tenant_id=$1 AND type='payroll.payslip.paid'", [w.tenantId]);
    expect(ev).toHaveLength(1);
    expect(ev[0]?.payload).toMatchObject({ payslipId, staffId: staff, amount: 20_000, currency: "XOF", method: "MOBILE_MONEY", reference: "OM-2026-0001" });
    expect(ev[0]?.payload.paidAt).toBeTypeOf("string");
  });

  it("T20 — « tout approuver / tout payer » = { all: true, periodId } calculé côté serveur ; une liste vide ne vaut JAMAIS « tout »", async () => {
    w = await createWorld({ db });
    const a = addStaff(w, "Alpha");
    const b = addStaff(w, "Bravo");
    const c = addStaff(w, "Charlie");
    for (const s of [a, b, c]) await addConfig(w, { staffId: s });
    const p1 = await addPeriod(w, { startDate: "2026-01-05", endDate: "2026-01-31" });
    w.mem.sessions.add(session(a, "2026-01-06", 60), session(b, "2026-01-06", 60), session(c, "2026-01-06", 60));
    unwrap(await calculatePeriod(w.deps, w.ctxOf(), { periodId: p1.id }));
    // vide : refusé, et rien n'a changé
    await expectErr(approvePayslips(w.deps, w.ctxOf(), { selection: { payslipIds: [] }, caps: NO_OWNER }), PayrollCodes.emptySelection);
    await expectErr(payPayslips(w.deps, w.ctxOf(), { selection: { payslipIds: [] }, method: "CASH" }), PayrollCodes.emptySelection);
    expect((await payslipRows(w)).every((p) => p.status === "CALCULATED")).toBe(true);
    // une annulation avant : le bulletin annulé n'est pas éligible à « tout approuver »
    const slips = await payslipRows(w);
    unwrap(await cancelPayslip(w.deps, w.ctxOf(), { payslipId: slips[2]?.id, reason: "Doublon de saisie" }));
    const all = unwrap(await approvePayslips(w.deps, w.ctxOf(), { selection: { all: true, periodId: p1.id }, caps: NO_OWNER }));
    expect(all.done).toHaveLength(2);
    expect(all.rejected).toEqual([]);
    expect((await payslipRows(w)).map((p) => p.status).sort()).toEqual(["APPROVED", "APPROVED", "CANCELLED"]);
    // tout payer : les 2 arrêtés ; l'annulé reste annulé
    const paid = unwrap(await payPayslips(w.deps, w.ctxOf(), { selection: { all: true, periodId: p1.id }, method: "BANK_TRANSFER" }));
    expect(paid.done).toHaveLength(2);
    expect((await payslipRows(w)).map((p) => p.status).sort()).toEqual(["CANCELLED", "PAID", "PAID"]);
    // un enseignant avec DEUX bulletins ouverts (deux périodes) : les deux sont traités, un par période
    await releasePending(w);
    const p2 = await addPeriod(w, { startDate: "2026-02-02", endDate: "2026-02-27" });
    w.mem.sessions.add(session(a, "2026-02-03", 60));
    unwrap(await calculatePeriod(w.deps, w.ctxOf(), { periodId: p2.id }));
    expect(unwrap(await approvePayslips(w.deps, w.ctxOf(), { selection: { all: true, periodId: p2.id }, caps: NO_OWNER })).done).toHaveLength(1);
  });

  it("bogue corrigée — « tout archiver » ne ressuscite PLUS un bulletin annulé ; un annulé n'est jamais éligible, ni payable", async () => {
    const { payslipId } = await oneCalculated();
    unwrap(await cancelPayslip(w.deps, w.ctxOf(), { payslipId, reason: "Erreur de période" }));
    const approveCancelled = unwrap(await approve([payslipId]));
    expect(approveCancelled).toMatchObject({ done: [], rejected: [{ payslipId, code: PayrollCodes.invalidTransition }] });
    const payCancelled = unwrap(await pay([payslipId]));
    expect(payCancelled).toMatchObject({ done: [], rejected: [{ payslipId, code: PayrollCodes.invalidTransition }] });
    expect((await payslipRows(w))[0]?.status).toBe("CANCELLED");
    // et la base refuse aussi l'écrivain qui contournerait l'application
    await expect(db.admin.query("UPDATE payroll.payslips SET status='APPROVED', approved_at=now(), approved_by=$2, approved_by_name='X', snapshot='{}', snapshot_hash=repeat('a',64) WHERE id=$1", [payslipId, newId()])).rejects.toThrow(/payroll\.invalid_transition: CANCELLED -> APPROVED/);
  });

  it("bogue corrigée — pas de statut libre : calculé → payé, annulé → payé impossibles ; l'auteur est l'utilisateur authentifié, jamais un UUID codé en dur", async () => {
    const { payslipId } = await oneCalculated();
    expect(unwrap(await pay([payslipId])).rejected[0]?.code).toBe(PayrollCodes.invalidTransition);
    unwrap(await cancelPayslip(w.deps, w.ctxOf(), { payslipId, reason: "Annulation test" }));
    expect(unwrap(await pay([payslipId])).rejected[0]?.code).toBe(PayrollCodes.invalidTransition);
    const hardcoded = "634a57fe-0000-0000-0000-000000000000";
    expect((await adminRows(db, "SELECT 1 FROM payroll.payslips WHERE approved_by::text LIKE '634a57fe%' OR paid_by::text LIKE '634a57fe%'")).length).toBe(0);
    void hardcoded;
  });

  it("annuler : motif obligatoire, relâche les heures (réclamations) et libère la source ; un bulletin PAYÉ ne s'annule pas", async () => {
    const { payslipId } = await oneCalculated();
    await expectErr(cancelPayslip(w.deps, w.ctxOf(), { payslipId, reason: "  " }), PayrollCodes.reasonRequired);
    unwrap(await approve([payslipId]));
    expect(w.mem.sessions.locks.has(payslipId)).toBe(true);
    const cancelled = unwrap(await cancelPayslip(w.deps, w.ctxOf(), { payslipId, reason: "Le montant était faux" }));
    expect(cancelled).toMatchObject({ status: "CANCELLED", cancelReason: "Le montant était faux" });
    expect((await adminRows(db, "SELECT 1 FROM payroll.hour_claims WHERE payslip_id=$1", [payslipId])).length).toBe(0);
    expect(w.mem.sessions.releaseCalls).toEqual([payslipId]);
    expect(w.mem.sessions.locks.has(payslipId)).toBe(false);
    const ev = await adminRows<{ action: string; reason: string | null }>(db, "SELECT action, reason FROM payroll.payslip_events WHERE payslip_id=$1 AND action='CANCELLED'", [payslipId]);
    expect(ev).toEqual([{ action: "CANCELLED", reason: "Le montant était faux" }]);
    // un payé ne s'annule pas
    const second = await oneCalculated();
    unwrap(await approve([second.payslipId]));
    unwrap(await pay([second.payslipId]));
    await expectErr(cancelPayslip(w.deps, w.ctxOf(), { payslipId: second.payslipId, reason: "Trop tard pour annuler" }), PayrollCodes.invalidTransition);
  });

  it("contester : APPROVED → DISPUTED (motif), puis ré-arrêt DISPUTED → APPROVED ; jamais DISPUTED → PAID", async () => {
    const { payslipId } = await oneCalculated();
    await expectErr(disputePayslip(w.deps, w.ctxOf(), { payslipId, reason: "Heures contestées" }), PayrollCodes.invalidTransition); // pas encore arrêté
    unwrap(await approve([payslipId]));
    const d = unwrap(await disputePayslip(w.deps, w.ctxOf(), { payslipId, reason: "Heures contestées par l'enseignant" }));
    expect(d).toMatchObject({ status: "DISPUTED", disputeReason: "Heures contestées par l'enseignant" });
    expect(unwrap(await pay([payslipId])).rejected[0]?.code).toBe(PayrollCodes.invalidTransition);
    const hashBefore = (await payslipRows(w))[0]?.snapshot_hash;
    expect(unwrap(await approve([payslipId]))).toMatchObject({ done: [payslipId] });
    const [p] = await payslipRows(w);
    expect(p).toMatchObject({ status: "APPROVED" });
    expect(p?.snapshot_hash).toBe(hashBefore); // le snapshot reste celui de l'arrêt initial
  });

  it("primes et retenues : sur un bulletin CALCULATED seulement, tracées (auteur, motif), total recalculé ; jamais un total négatif", async () => {
    const { payslipId } = await oneCalculated();
    const p = unwrap(await adjustPayslip(w.deps, w.ctxOf(), { payslipId, add: [{ kind: "BONUS", amount: 5000, label: "Prime" }, { kind: "DEDUCTION", amount: 2000, label: "Avance", reason: "Acompte" }] }));
    expect(p).toMatchObject({ bonusAmount: expect.anything(), deductionAmount: expect.anything() });
    expect([p.bonusAmount.amount, p.deductionAmount.amount, p.totalAmount.amount]).toEqual([5000, 2000, 23_000]);
    const adj = await adminRows<{ id: string; created_by_name: string; kind: string }>(db, "SELECT id, created_by_name, kind FROM payroll.payslip_adjustments WHERE payslip_id=$1 ORDER BY kind", [payslipId]);
    expect(adj.map((a) => [a.kind, a.created_by_name])).toEqual([["BONUS", "Comptable Test"], ["DEDUCTION", "Comptable Test"]]);
    // retirer une retenue
    const removed = unwrap(await adjustPayslip(w.deps, w.ctxOf(), { payslipId, removeIds: [adj[1]?.id as string] }));
    expect(removed.totalAmount.amount).toBe(25_000);
    // total négatif refusé, rien n'est modifié
    await expectErr(adjustPayslip(w.deps, w.ctxOf(), { payslipId, add: [{ kind: "DEDUCTION", amount: 999_999, label: "Énorme" }] }), PayrollCodes.negativeTotal);
    expect((await payslipRows(w))[0]?.total_amount).toBe("25000");
    // plus rien après l'arrêt
    unwrap(await approve([payslipId]));
    await expectErr(adjustPayslip(w.deps, w.ctxOf(), { payslipId, add: [{ kind: "BONUS", amount: 100, label: "Tard" }] }), PayrollCodes.payslipLocked);
  });

  it("séparation des tâches (réglable) : celui qui a calculé ne peut pas arrêter ; un autre le peut", async () => {
    const { payslipId } = await oneCalculated();
    unwrap(await updatePayrollSettings(w.deps, w.ctxOf(), { requireSeparateApprover: true }));
    const r = unwrap(await approve([payslipId], NO_OWNER, w.accountant));
    expect(r.rejected).toMatchObject([{ code: PayrollCodes.separationOfDuties }]);
    expect((await payslipRows(w))[0]?.status).toBe("CALCULATED");
    expect(unwrap(await approve([payslipId], NO_OWNER, newId())).done).toEqual([payslipId]);
  });

  it("seuil propriétaire : au-delà, seul l'acteur investi de l'arrêt « propriétaire » arrête ; la base le vérifie aussi", async () => {
    const { payslipId } = await oneCalculated({ minutes: 120 }); // 20 000
    unwrap(await updatePayrollSettings(w.deps, w.ctxOf(), { ownerApprovalThreshold: 15_000 }));
    expect(unwrap(await approve([payslipId], { ownerApproval: false })).rejected).toMatchObject([{ code: PayrollCodes.ownerApprovalRequired }]);
    // même un écrivain qui contourne la vérification applicative est arrêté par le déclencheur
    await expect(db.admin.query("UPDATE payroll.payslips SET status='APPROVED', approved_at=now(), approved_by=$2, approved_by_name='X', snapshot='{}', snapshot_hash=repeat('a',64) WHERE id=$1", [payslipId, newId()])).rejects.toThrow(/payroll\.owner_approval_required/);
    expect(unwrap(await approve([payslipId], { ownerApproval: true })).done).toEqual([payslipId]);
  });

  it("une source qui refuse de geler les heures empêche l'arrêt : le bulletin reste CALCULATED, signalé", async () => {
    const { payslipId } = await oneCalculated();
    w.mem.sessions.failLockWith = new Error("séance dévalidée entre-temps");
    const r = unwrap(await approve([payslipId]));
    expect(r.done).toEqual([]);
    expect(r.rejected[0]).toMatchObject({ payslipId, code: PayrollCodes.concurrentUpdate });
    expect(r.rejected[0]?.message).toMatch(/gelées à la source/);
    expect((await payslipRows(w))[0]?.status).toBe("CALCULATED");
    w.mem.sessions.failLockWith = null;
    expect(unwrap(await approve([payslipId])).done).toEqual([payslipId]);
  });

  it("lot PARTIEL : les éligibles passent, les autres reviennent avec leur motif (annulé, déjà payé, inconnu)", async () => {
    w = await createWorld({ db });
    const staff = [addStaff(w, "Un"), addStaff(w, "Deux"), addStaff(w, "Trois"), addStaff(w, "Quatre")];
    for (const s of staff) await addConfig(w, { staffId: s });
    const period = await addPeriod(w);
    for (const s of staff) w.mem.sessions.add(session(s, "2026-01-06", 60));
    unwrap(await calculatePeriod(w.deps, w.ctxOf(), { periodId: period.id }));
    const slips = await payslipRows(w);
    const [good, toCancel, toPay, again] = slips.map((p) => p.id as string) as [string, string, string, string];
    unwrap(await cancelPayslip(w.deps, w.ctxOf(), { payslipId: toCancel, reason: "Doublon de saisie" }));
    unwrap(await approve([toPay, again]));
    unwrap(await pay([toPay]));
    const ghost = newId();
    const r = unwrap(await approve([good, toCancel, toPay, again, ghost]));
    expect(r.done).toEqual([good]);
    expect(r.unchanged).toEqual([again]); // déjà arrêté : idempotent
    expect(r.rejected.map((x) => [x.payslipId, x.code]).sort()).toEqual(
      [
        [toCancel, PayrollCodes.invalidTransition],
        [toPay, PayrollCodes.invalidTransition], // PAYÉ : on ne revient pas en arrière
        [ghost, PayrollCodes.notFound],
      ].sort(),
    );
  });

  it("notification : réservée à un bulletin arrêté ou payé ; émet un événement pour le titulaire et journalise NOTIFIED", async () => {
    const { payslipId } = await oneCalculated({ userId: newId() });
    await expectErr(notifyPayslip(w.deps, w.ctxOf(), payslipId), PayrollCodes.invalidTransition);
    unwrap(await approve([payslipId]));
    unwrap(await notifyPayslip(w.deps, w.ctxOf(), payslipId));
    const ev = await adminRows<{ payload: any }>(db, "SELECT payload FROM kernel.domain_events WHERE tenant_id=$1 AND type='payroll.payslip.notification_requested'", [w.tenantId]);
    expect(ev).toHaveLength(1);
    expect(ev[0]?.payload.recipientUserId).toBeTypeOf("string");
    expect((await adminRows(db, "SELECT 1 FROM payroll.payslip_events WHERE payslip_id=$1 AND action='NOTIFIED'", [payslipId])).length).toBe(1);
  });

  it("le snapshot est la source du rendu : il ne bouge pas quand le compte de l'enseignant ou la configuration changent", async () => {
    const { payslipId, staff } = await oneCalculated({ name: "Nom Initial" });
    unwrap(await approve([payslipId]));
    const caps = { readAll: true, readOwn: false };
    const before = unwrap(await getPayslipData(w.deps, w.ctxOf(), { payslipId, caps }));
    expect(before).toMatchObject({ final: true, watermark: "NON VERSÉ", intact: true });
    w.mem.staff.add({ staffId: staff, displayName: "Nom Changé" });
    await db.admin.query("UPDATE payroll.pay_configs SET default_hourly_rate = 99999 WHERE tenant_id=$1", [w.tenantId]);
    const after = unwrap(await getPayslipData(w.deps, w.ctxOf(), { payslipId, caps }));
    expect(after.document).toEqual(before.document);
    expect((after.document as any).staff.displayName).toBe("Nom Initial");
    unwrap(await pay([payslipId]));
    const paid = unwrap(await getPayslipData(w.deps, w.ctxOf(), { payslipId, caps }));
    expect(paid).toMatchObject({ final: true, watermark: null, payment: { method: "MOBILE_MONEY", reference: "OM-2026-0001" } });
    expect(paid.document).toEqual(before.document);
    // un brouillon calculé n'est pas un document final
    const other = await oneCalculated();
    const draft = unwrap(await getPayslipData(w.deps, w.ctxOf(), { payslipId: other.payslipId, caps }));
    expect(draft).toMatchObject({ final: false, intact: null, watermark: "NON VERSÉ" });
  });

  it("réglages : devise figée dès qu'un bulletin existe ; valeurs validées (entiers, bornes) ; auditée", async () => {
    await oneCalculated();
    const s = unwrap(await getPayrollSettings(w.deps, w.ctxOf()));
    expect(s).toMatchObject({ currency: "XOF", defaultOvertimeThresholdMinutes: 2400, defaultOvertimeMultiplierPermille: 1500, requireSeparateApprover: false });
    await expectErr(updatePayrollSettings(w.deps, w.ctxOf(), { currency: "EUR" }), PayrollCodes.currencyLocked);
    await expectErr(updatePayrollSettings(w.deps, w.ctxOf(), { defaultOvertimeMultiplierPermille: 999 }), PayrollCodes.invalidInput);
    await expectErr(updatePayrollSettings(w.deps, w.ctxOf(), { defaultOvertimeThresholdMinutes: 0 }), PayrollCodes.invalidInput);
    await expectErr(updatePayrollSettings(w.deps, w.ctxOf(), { ownerApprovalThreshold: 12.5 }), PayrollCodes.invalidInput);
    const u = unwrap(await updatePayrollSettings(w.deps, w.ctxOf(), { defaultOvertimeThresholdMinutes: 2100, ownerApprovalThreshold: 500_000 }));
    expect(u).toMatchObject({ defaultOvertimeThresholdMinutes: 2100 });
    expect(u.ownerApprovalThreshold?.amount).toBe(500_000);
    expect(w.audit.actions()).toContain("payroll.settings.updated");
    // la nouvelle configuration reprend les défauts du tenant
    const s2 = addStaff(w, "Autre");
    const cfg = await addConfig(w, { staffId: s2 });
    expect([cfg.overtimeThresholdMinutes, cfg.overtimeMultiplierPermille]).toEqual([2100, 1500]);
  });
});
